const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../viewer/viewer-app.js');

const texts = (p) => p.terms.map(t => [t.text, !!t.phrase, !!t.negate]);

test('parseQuery reads words, phrases and exclusions', () => {
  const p = app.parseQuery('venus "sulphur dioxide" -acid');
  assert.deepEqual(texts(p), [['venus', false, false], ['sulphur dioxide', true, false], ['acid', false, true]]);
  assert.equal(p.plain, false);
  assert.deepEqual(app.parseQuery('-"sulphur dioxide"').terms, [{ text: 'sulphur dioxide', phrase: true, negate: true }]);
});

test('parseQuery groups OR (upper case only) and ANDs the rest', () => {
  const p = app.parseQuery('cat OR dog bird');
  assert.deepEqual(p.anyOf.map(g => g.map(t => t.text)), [['cat', 'dog']]);
  assert.deepEqual(texts(p), [['bird', false, false]]);
  assert.equal(p.plain, false);
  const lower = app.parseQuery('cat or dog');
  assert.deepEqual(lower.anyOf, []);
  assert.deepEqual(lower.terms.map(t => t.text), ['cat', 'or', 'dog']);
  assert.equal(lower.plain, true);
  assert.deepEqual(app.parseQuery('a OR b OR c').anyOf.map(g => g.map(t => t.text)), [['a', 'b', 'c']]);
});

test('parseQuery reads scopes, source and type filters', () => {
  assert.deepEqual(app.parseQuery('in:chat x').scopes, ['chat']);
  assert.deepEqual(app.parseQuery('in:notes x').scopes, ['studio']);
  assert.deepEqual(app.parseQuery('in:studio x').scopes, ['studio']);
  assert.deepEqual(app.parseQuery('IN:Sources x').scopes, ['source']);
  assert.equal(app.parseQuery('source:henkin x').sourceTitle, 'henkin');
  assert.equal(app.parseQuery('source:"de gaulle" x').sourceTitle, 'de gaulle');
  assert.deepEqual(app.parseQuery('type:pdf type:web x').types, ['pdf', 'web']);
  assert.deepEqual(app.parseQuery('TYPE:PDF x').types, ['pdf']);
  assert.deepEqual(app.parseQuery('in:chat x').terms.map(t => t.text), ['x']);
  assert.equal(app.parseQuery('in:chat x').plain, false);
});

test('parseQuery treats malformed input as plain words and never throws', () => {
  for (const q of ['"open quote', '-', '--x', 'OR', 'a OR', 'OR a', 'a OR OR b', 'in:', 'in:nope x', 'type:zip x', 'source:', '""', '"" x', ':', '(((', '[a-', '\\']) {
    const p = app.parseQuery(q);
    assert.ok(Array.isArray(p.terms), q);
  }
  assert.deepEqual(app.parseQuery('"open quote').terms.map(t => t.text), ['open', 'quote']);
  assert.deepEqual(app.parseQuery('a OR').terms.map(t => t.text.toLowerCase()), ['a', 'or']);
  assert.deepEqual(app.parseQuery('in:nope x').terms.map(t => t.text), ['in:nope', 'x']);
  assert.deepEqual(app.parseQuery('type:zip x').terms.map(t => t.text), ['type:zip', 'x']);
  assert.equal(app.parseQuery('-').terms[0].text, '-');
});

test('parseQuery: plain only when no operator is used', () => {
  assert.equal(app.parseQuery('just some words').plain, true);
  assert.equal(app.parseQuery('').plain, true);
  assert.equal(app.parseQuery('"phrase"').plain, false);
  assert.equal(app.parseQuery('-x').plain, false);
  assert.equal(app.parseQuery('type:pdf').plain, false);
});

test('matchQuery: terms AND anywhere, phrase contiguous, negation excludes, OR needs any', () => {
  const m = (q, t, item) => app.matchQuery(app.parseQuery(q), t, item).ok;
  assert.equal(m('venus acid', 'Acid on Venus'), true);
  assert.equal(m('venus zebra', 'Acid on Venus'), false);
  assert.equal(m('"acid venus"', 'Acid on Venus'), false);
  assert.equal(m('"on venus"', 'Acid on Venus'), true);
  assert.equal(m('venus -acid', 'Acid on Venus'), false);
  assert.equal(m('venus -zebra', 'Acid on Venus'), true);
  assert.equal(m('cat OR dog', 'a dog'), true);
  assert.equal(m('cat OR dog', 'a bird'), false);
  assert.equal(m('cat OR dog bird', 'a dog'), false);
  assert.equal(m('cat OR dog bird', 'a dog bird'), true);
  assert.equal(m('a.c', 'abc'), false);
  assert.equal(m('a.c', 'a.c'), true);
  assert.equal(m('c++ (x', 'c++ (x'), true);
});

test('matchQuery: filters use the item', () => {
  const m = (q, t, item) => app.matchQuery(app.parseQuery(q), t, item).ok;
  const chat = { kind: 'chat', title: 'Q' }, src = { kind: 'source', title: 'Henkin 1999.pdf', type: 'pdf' };
  assert.equal(m('in:chat x', 'x', chat), true);
  assert.equal(m('in:chat x', 'x', src), false);
  assert.equal(m('in:notes x', 'x', { kind: 'studio', title: 't' }), true);
  assert.equal(m('source:henkin x', 'x', src), true);
  assert.equal(m('source:henkin x', 'x', { kind: 'source', title: 'Other', type: '' }), false);
  assert.equal(m('source:henkin x', 'x', chat), false);
  assert.equal(m('type:pdf x', 'x', src), true);
  assert.equal(m('type:web x', 'x', src), false);
  assert.equal(m('type:pdf type:web x', 'x', { kind: 'source', title: 'http://a.b', type: '' }), true);
  assert.equal(m('type:pdf x', 'x', chat), false);
  assert.equal(m('type:youtube x', 'x', { kind: 'source', title: 'v', type: '', url: 'https://youtu.be/1' }), true);
  assert.equal(m('x', 'x', chat), true);
  assert.equal(m('in:chat x', 'x'), true);
});

test('matchQuery: spans cover every positive match, merged when overlapping', () => {
  const s = (q, t) => app.matchQuery(app.parseQuery(q), t).spans;
  assert.deepEqual(s('ab', 'ab xx AB'), [[0, 2], [6, 8]]);
  assert.deepEqual(s('abc bcd', 'abcd'), [[0, 4]]);
  assert.deepEqual(s('"sulphur dioxide" venus', 'Venus: sulphur dioxide.'), [[0, 5], [7, 22]]);
  assert.deepEqual(s('cat OR dog', 'dog cat'), [[0, 3], [4, 7]]);
  assert.deepEqual(s('x -z', 'x y'), [[0, 1]]);
  assert.deepEqual(s('a.c', 'a.c abc'), [[0, 3]]);
});

test('filterPairs uses operators; a plain query is unchanged', () => {
  const pairs = [{ q: 'cat', a: 'sat' }, { q: 'dog', a: 'ran far' }, { q: 'cat dog', a: 'slept' }];
  assert.deepEqual(app.filterPairs(pairs, 'cat -dog'), [0]);
  assert.deepEqual(app.filterPairs(pairs, 'sat OR ran'), [0, 1]);
  assert.deepEqual(app.filterPairs(pairs, '"dog ran"'), [1]);
  assert.deepEqual(app.filterPairs(pairs, 'in:source cat'), [0, 2]);
  assert.deepEqual(app.filterPairs(pairs, 'ran far'), [1]);
  assert.deepEqual(app.filterPairs(pairs, 'far ran'), []);
});

test('searchArchive uses operators and filters', () => {
  const data = {
    sources: [{ title: 'Henkin 1999.pdf', type: 'pdf', md: 'venus has sulphur dioxide clouds' }, { title: 'Page', type: 'web', md: 'venus and acid' }],
    studio: [{ title: 'Note', md: 'venus note' }],
    pairs: [{ q: 'about venus', a: 'sulphur dioxide' }]
  };
  const idx = app.buildSearchIndex(data);
  const keys = (q) => app.searchArchive(idx, q).groups.map(g => g.key + ':' + g.hits.map(h => h.i).join(''));
  assert.deepEqual(keys('venus -acid'), ['source:0', 'studio:0', 'chat:0']);
  assert.deepEqual(keys('in:chat venus'), ['chat:0']);
  assert.deepEqual(keys('type:pdf venus'), ['source:0']);
  assert.deepEqual(keys('type:web venus'), ['source:1']);
  assert.deepEqual(keys('source:henkin sulphur'), ['source:0']);
  assert.deepEqual(keys('"sulphur dioxide"'), ['source:0', 'chat:0']);
  assert.deepEqual(keys('note OR acid'), ['source:1', 'studio:0']);
  const hit = app.searchArchive(idx, '"sulphur dioxide" in:source').groups[0].hits[0];
  assert.equal(hit.match, 'sulphur dioxide');
  assert.equal(hit.count, 1);
  assert.equal(app.searchArchive(idx, 'venus acid').total, 1);
});

test('the sources list filters on titles with type, and the help popover exists', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-app.js'), 'utf8');
  assert.match(src, /parseQuery\(srcQ\)/);
  assert.match(src, /id="qhelp"/);
  assert.doesNotMatch(src.slice(src.indexOf('id="qhelp"'), src.indexOf('id="qhelp"') + 1500), /NotebookLM/);
});
