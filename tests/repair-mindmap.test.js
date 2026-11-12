const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'tools', 'repair_mindmap_json.js');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'repair-mm-'));
const node = (name, level, childCount, children = []) => ({ name, level, expanded: true, children, childCount });

// v1 shape: R -> A(2), B(1); a1, a2 under A; b1 under B. Broken: all leaves under last branch.
function brokenFile() {
  const R = node('R', 1, 2), A = node('A', 2, 2), B = node('B', 2, 1);
  const a1 = node('a1', 3, 0), a2 = node('a2', 3, 0), b1 = node('b1', 3, 0);
  R.children = [A, B]; B.children = [a1, a2, b1];
  return { title: 'T', extra: 42, root: R, nodes: [R, A, B, a1, a2, b1] };
}
function goodFile() {
  const R = node('R', 1, 2), A = node('A', 2, 2), B = node('B', 2, 1);
  const a1 = node('a1', 3, 0), a2 = node('a2', 3, 0), b1 = node('b1', 3, 0);
  R.children = [A, B]; A.children = [a1, a2]; B.children = [b1];
  return { title: 'T', root: R, nodes: [R, A, B, a1, a2, b1] };
}
function put(dir, rel, obj) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  return p;
}

test('broken file: dry run reports fixed and leaves bytes; --write fixes, then ok', () => {
  const dir = tmp();
  const p = put(dir, 'artifacts/mind-maps/m.json', brokenFile());
  const before = fs.readFileSync(p);
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^fixed .*m\.json$/m);
  assert.deepEqual(fs.readFileSync(p), before);
  const w = run(dir, '--write');
  assert.equal(w.status, 0);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(j.title, 'T');
  assert.equal(j.extra, 42);
  for (const n of j.nodes) assert.equal(n.children.length, n.childCount);
  assert.deepEqual(j.root.children.map(c => c.children.length), [2, 1]);
  assert.match(run(dir).stdout, /^ok .*m\.json$/m);
});

test('already correct file: ok and not rewritten', () => {
  const dir = tmp();
  const p = put(dir, 'artifacts/mind-maps/m.json', goodFile());
  const before = fs.readFileSync(p);
  const past = new Date(Date.now() - 100000);
  fs.utimesSync(p, past, past);
  const mt = fs.statSync(p).mtimeMs;
  const r = run(p, '--write');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ok /m);
  assert.deepEqual(fs.readFileSync(p), before);
  assert.equal(fs.statSync(p).mtimeMs, mt);
});

test('counts that do not add up: skipped, exit 1, no write', () => {
  const dir = tmp();
  const f = brokenFile();
  f.nodes[0].childCount = 1; // root claims 1 child but 2 branches follow
  const p = put(dir, 'artifacts/mind-maps/m.json', f);
  const before = fs.readFileSync(p);
  const r = run(dir, '--write');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^skipped .*m\.json: /m);
  assert.deepEqual(fs.readFileSync(p), before);
});

test('unreadable JSON and missing nodes are skipped', () => {
  const dir = tmp();
  put(dir, 'artifacts/mind-maps/bad.json', '{nope');
  put(dir, 'artifacts/mind-maps/none.json', { title: 'x' });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^skipped .*bad\.json: /m);
  assert.match(r.stdout, /^skipped .*none\.json: /m);
});

test('Full Takeout layout: finds part-N files, ignores others, leaves svg alone', () => {
  const dir = tmp();
  const p = put(dir, 'part-1/artifacts/mind-maps/x.json', brokenFile());
  const svg = put(dir, 'part-1/artifacts/mind-maps/x.svg', '<svg/>');
  put(dir, 'part-1/notes/n.json', brokenFile());
  put(dir, '.hidden/artifacts/mind-maps/h.json', brokenFile());
  const r = run(dir, '--write');
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^fixed .*x\.json$/);
  assert.equal(fs.readFileSync(svg, 'utf8'), '<svg/>');
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).root.children[0].children.length, 2);
});

test('no arguments: exit 2', () => {
  assert.equal(run().status, 2);
});

test('mixed run: fixes one, skips malformed, leaves ok file, no temp files', () => {
  const dir = tmp();
  const fixed = put(dir, 'artifacts/mind-maps/a.json', brokenFile());
  const bad = put(dir, 'artifacts/mind-maps/b.json', '{nope');
  const ok = put(dir, 'artifacts/mind-maps/c.json', goodFile());
  const badBytes = fs.readFileSync(bad), okBytes = fs.readFileSync(ok);
  const r = run(dir, '--write');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^fixed .*a\.json$/m);
  assert.match(r.stdout, /^skipped .*b\.json: /m);
  assert.match(r.stdout, /^ok .*c\.json$/m);
  assert.deepEqual(fs.readFileSync(bad), badBytes);
  assert.deepEqual(fs.readFileSync(ok), okBytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(fixed, 'utf8')).root.children.map(c => c.children.length), [2, 1]);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'artifacts/mind-maps')).filter(f => f.includes('.tmp-repair')), []);
});
