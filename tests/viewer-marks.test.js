const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../viewer/viewer-app.js');
const { treeParser, elementsOf } = require('./fixtures/tree-parser.js');

const body = html => treeParser().parseFromString(html).body;
const marks = root => { const out = []; (function w(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { if (c.localName === 'mark') out.push(c); w(c); } }); })(root); return out; };
const q = s => app.parseQuery(s);

test('markMatches wraps every match of every positive term and counts them', () => {
  const root = body('<p>The Profile of a profile and <b>more PROFILE</b> here, venus too</p>');
  assert.equal(app.markMatches(root, q('profile OR venus')), 4);
  const m = marks(root);
  assert.deepEqual(m.map(x => x.textContent), ['Profile', 'profile', 'PROFILE', 'venus']);
  assert.ok(m.every(x => x.className === 'hit'));
  assert.equal(root.textContent, 'The Profile of a profile and more PROFILE here, venus too');
});

test('a plain query marks the whole query as one phrase', () => {
  const root = body('<p>sulphur dioxide and sulphur, dioxide</p>');
  assert.equal(app.markMatches(root, q('sulphur dioxide')), 1);
  assert.equal(marks(root)[0].textContent, 'sulphur dioxide');
});

test('OR terms are marked, excluded terms are not', () => {
  const root = body('<p>cat dog acid</p>');
  assert.equal(app.markMatches(root, q('cat OR dog -acid')), 2);
  assert.deepEqual(marks(root).map(x => x.textContent), ['cat', 'dog']);
});

test('formulas are never marked', () => {
  const root = body('<p>x profile <span class="katex"><span>profile</span></span> profile</p>');
  assert.equal(app.markMatches(root, q('profile')), 2);
  const k = elementsOf('<p>.</p>');
  assert.ok(k.length);
  (function w(n, inKatex) { n.childNodes.forEach(c => { if (c.nodeType === 1) { const kx = inKatex || /katex/.test(c.className); if (kx) assert.notEqual(c.localName, 'mark'); w(c, kx); } }); })(root, false);
});

test('a match inside a closed details opens it', () => {
  const root = body('<details><summary>Thoughts</summary><p>a profile</p></details><details><p>nothing</p></details>');
  assert.equal(app.markMatches(root, q('profile')), 1);
  const d = root.childNodes;
  assert.equal(d[0].open, true);
  assert.notEqual(d[1].open, true);
});

test('regex characters are literal', () => {
  const root = body('<p>a.b a+b (x) a.b</p>');
  assert.equal(app.markMatches(root, q('"a.b"')), 2);
  assert.equal(app.markMatches(body('<p>axb</p>'), q('"a.b"')), 0);
  assert.equal(app.markMatches(body('<p>f(x) [y]</p>'), q('"(x)" "[y]"')), 2);
});

test('clearMarks restores the text, so marking again gives the same count', () => {
  const root = body('<p>profile and profile</p>');
  assert.equal(app.markMatches(root, q('profile')), 2);
  app.clearMarks(root);
  assert.equal(marks(root).length, 0);
  assert.equal(root.childNodes[0].childNodes.length, 1);
  assert.equal(app.markMatches(root, q('profile')), 2);
});

test('scripts, styles and an empty query are left alone', () => {
  const root = body('<p>profile</p><style>profile{}</style>');
  assert.equal(app.markMatches(root, q('profile')), 1);
  assert.equal(app.markMatches(body('<p>x</p>'), q('')), 0);
});
