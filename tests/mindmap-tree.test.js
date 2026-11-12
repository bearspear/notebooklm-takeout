const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('../mindmap-extract.js');
const M = globalThis.__nlmeMindmap;

const mk = (name, level, childCount) => ({ name, level, expanded: true, children: [], childCount });
const names = n => n.children.map(c => c.name);

// A stub svg: only querySelectorAll and getAttribute are used
function stubSvg(specs) {
  const nodes = specs.map(([name, level, count]) => {
    const attrs = {
      'aria-label': `${name}, ${count} children`,
      'aria-level': String(level),
      'aria-expanded': 'true'
    };
    return { getAttribute: k => (k in attrs ? attrs[k] : null) };
  });
  return { querySelectorAll: () => nodes };
}

test('breadth-first order: children land under the right parent', () => {
  const [R, A, B, a1, a2, b1] = [mk('R', 1, 2), mk('A', 2, 2), mk('B', 2, 1), mk('a1', 3, 0), mk('a2', 3, 0), mk('b1', 3, 0)];
  const r = M.rebuildMindmapTree([R, A, B, a1, a2, b1]);
  assert.equal(r.ok, true);
  assert.deepEqual(names(R), ['A', 'B']);
  assert.deepEqual(names(A), ['a1', 'a2']);
  assert.deepEqual(names(B), ['b1']);
});

test('four levels: a level-4 node sits under the right level-3 parent', () => {
  const [R, A, B, a1, b1, x, y] = [mk('R', 1, 2), mk('A', 2, 1), mk('B', 2, 1), mk('a1', 3, 1), mk('b1', 3, 1), mk('x', 4, 0), mk('y', 4, 0)];
  const r = M.rebuildMindmapTree([R, A, B, a1, b1, x, y]);
  assert.equal(r.ok, true);
  assert.deepEqual(names(a1), ['x']);
  assert.deepEqual(names(b1), ['y']);
});

test('counts that do not add up: flat result, ok false, flagged in metadata', () => {
  const [R, A, a1, a2] = [mk('R', 1, 1), mk('A', 2, 3), mk('a1', 3, 0), mk('a2', 3, 0)];
  const r = M.rebuildMindmapTree([R, A, a1, a2]);
  assert.equal(r.ok, false);
  assert.deepEqual(names(R), ['A', 'a1', 'a2']);
  assert.deepEqual(A.children, []);
  assert.deepEqual(a1.children, []);

  const tree = M.extractMindmapTreeData(stubSvg([['R', 1, 1], ['A', 2, 3], ['a1', 3, 0], ['a2', 3, 0]]));
  assert.equal(tree.metadata.structureUnreadable, true);
  assert.deepEqual(names(tree.root), ['A', 'a1', 'a2']);
});

test('a node whose level does not follow its parent is unreadable', () => {
  const [R, A, c] = [mk('R', 1, 1), mk('A', 2, 1), mk('c', 4, 0)];
  assert.equal(M.rebuildMindmapTree([R, A, c]).ok, false);
});

test('first node not level 1 is unreadable', () => {
  const [A, a1] = [mk('A', 2, 1), mk('a1', 3, 0)];
  assert.equal(M.rebuildMindmapTree([A, a1]).ok, false);
});

test('real-shaped fixture: 10 branches x 4 leaves, breadth-first', () => {
  const specs = [['Root', 1, 10]];
  for (let b = 1; b <= 10; b++) specs.push([`B${b}`, 2, 4]);
  for (let b = 1; b <= 10; b++) for (let l = 1; l <= 4; l++) specs.push([`B${b}L${l}`, 3, 0]);
  const tree = M.extractMindmapTreeData(stubSvg(specs));
  assert.equal(tree.nodes.length, 51);
  assert.equal(tree.metadata.structureUnreadable, undefined);
  assert.equal(tree.root.children.length, 10);
  tree.root.children.forEach((br, i) => {
    assert.equal(br.children.length, br.childCount);
    assert.equal(br.children.length, 4);
    assert.deepEqual(names(br), [1, 2, 3, 4].map(l => `B${i + 1}L${l}`));
  });
});

test('edge cases: root only, empty input, childCount 0', () => {
  const R = mk('R', 1, 0);
  assert.deepEqual(M.rebuildMindmapTree([R]), { ok: true });
  assert.deepEqual(R.children, []);

  assert.equal(M.rebuildMindmapTree([]).ok, false);
  const empty = M.extractMindmapTreeData(stubSvg([]));
  assert.equal(empty.root, undefined);
  assert.deepEqual(empty.nodes, []);

  // a childCount 0 node never takes children: the extra node has no parent
  const [R2, A, extra] = [mk('R', 1, 1), mk('A', 2, 0), mk('extra', 3, 0)];
  assert.equal(M.rebuildMindmapTree([R2, A, extra]).ok, false);
  assert.deepEqual(A.children, []);
});

test('errors.md warning text for an unreadable tree', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidebar-core.js'), 'utf8');
  const start = src.indexOf('function mindmapWarning(');
  assert.ok(start >= 0, 'mindmapWarning missing');
  const fn = src.slice(start, src.indexOf('\n}\n', start) + 3);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fn + '\nthis.mindmapWarning = mindmapWarning;', sandbox);
  assert.equal(
    sandbox.mindmapWarning({ metadata: { structureUnreadable: true } }, 'Maths'),
    'Mind map structure could not be read: Maths (the .json lists its nodes flat; the .svg and .html are complete)'
  );
  assert.equal(
    sandbox.mindmapWarning({ metadata: { structureUnreadable: true } }),
    'Mind map structure could not be read (the .json lists its nodes flat; the .svg and .html are complete)'
  );
  assert.equal(sandbox.mindmapWarning({ metadata: {} }, 'Maths'), null);
  assert.equal(sandbox.mindmapWarning(null, 'Maths'), null);
  assert.doesNotMatch(sandbox.mindmapWarning({ metadata: { structureUnreadable: true } }, 'x'), /NotebookLM/);
});

test('callers pass the warning to errors.md', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('sidebar-notes.js'), /mindmapWarning\(noteData\.treeData\)/);
  assert.match(read('sidebar-artifacts.js'), /mindmapWarning\(response\.treeData\)/);
  assert.match(read('sidebar-artifacts.js'), /fetched\.warnings/);
});
