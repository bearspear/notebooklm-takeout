const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../viewer/viewer-app.js');

// total = width of the main grid: 12px padding each side and two 12px gaps leave total - 48 for the panes.

test('clampColumns leaves widths alone when chat keeps 360', () => {
  assert.deepEqual(app.clampColumns(1400, { l: 340, r: 400 }), { l: 340, r: 400 });
});

test('clampColumns raises side panes to 220', () => {
  assert.deepEqual(app.clampColumns(1400, { l: 100, r: 50 }), { l: 220, r: 220 });
});

test('clampColumns shrinks the right pane first, then the left, so chat keeps 360', () => {
  // space 1000 - 360 = 640 for the sides
  assert.deepEqual(app.clampColumns(1048, { l: 500, r: 500 }), { l: 420, r: 220 });
  assert.deepEqual(app.clampColumns(1048, { l: 600, r: 300 }), { l: 420, r: 220 });
  // the stacked layout applies up to 850px (max-width: 850px), so the grid starts at 851; 850 is a boundary the clamp must still handle: 802 - 360 leaves 442 for the sides
  assert.deepEqual(app.clampColumns(850, { l: 500, r: 500 }), { l: 222, r: 220 });
});

test('a collapsed pane is a 44px rail and gives its room to the others', () => {
  assert.deepEqual(app.clampColumns(1400, { l: 340, r: 400, lc: true }), { l: 44, r: 400 });
  assert.deepEqual(app.clampColumns(1400, { l: 340, r: 400, lc: true, rc: true }), { l: 44, r: 44 });
  // 1048 - 48 - 44 - 360 = 596 left for the right pane
  assert.deepEqual(app.clampColumns(1048, { l: 340, r: 900, lc: true }), { l: 44, r: 596 });
});

test('dragColumn clamps to 220 and to what leaves chat 360', () => {
  const cols = { l: 340, r: 400 };
  assert.equal(app.dragColumn(1400, cols, 'l', 100), 220);
  assert.equal(app.dragColumn(1400, cols, 'l', 500), 500);
  assert.equal(app.dragColumn(1400, cols, 'l', 900), 592); // 1352 - 360 - 400
  assert.equal(app.dragColumn(1400, cols, 'r', 900), 652); // 1352 - 360 - 340
  assert.equal(app.dragColumn(1400, cols, 'r', 10), 220);
});

test('dragColumn counts a collapsed neighbour as 44px', () => {
  assert.equal(app.dragColumn(1400, { l: 44, r: 400, lc: true }, 'r', 2000), 948); // 1352 - 360 - 44
});

test('serializeCols keeps only whole widths of at least 220 and the collapsed flags', () => {
  assert.equal(app.serializeCols({ l: 301.6, r: null, lc: true, rc: false }), '{"l":302,"r":null,"lc":true,"rc":false}');
  assert.equal(app.serializeCols({ l: 100, r: 'x' }), '{"l":null,"r":null,"lc":false,"rc":false}');
});

test('parseCols round-trips and rejects bad input', () => {
  const s = { l: 300, r: 450, lc: false, rc: true };
  assert.deepEqual(app.parseCols(app.serializeCols(s)), s);
  const empty = { l: null, r: null, lc: false, rc: false };
  for (const bad of [null, '', 'nope', '[1]', '"x"', '{"l":"9","r":-5,"lc":1,"rc":"yes"}']) assert.deepEqual(app.parseCols(bad), empty);
  assert.deepEqual(app.parseCols('{"l":99999,"r":219}'), { l: 4000, r: null, lc: false, rc: false });
});

test('chat keeps 360 at every width above the 850px stacked breakpoint with both sides open', () => {
  for (let total = 850; total <= 2400; total++) {
    for (const [l, r] of [[340, 400], [220, 220], [900, 900], [4000, 4000], [0, 0], [1200, 220]]) {
      const w = app.clampColumns(total, { l, r });
      assert.ok(w.l >= 220 && w.r >= 220, `${total} ${l} ${r}`);
      assert.ok(total - 48 - w.l - w.r >= 360, `${total} ${l} ${r}`);
    }
  }
  const edge = app.clampColumns(850, { l: 340, r: 400 });
  assert.equal(850 - 48 - edge.l - edge.r, 360);
});

function fakeDoc(execResult) {
  const area = { style: {}, select() {}, remove() {}, value: '' };
  return { area, body: { appendChild() {} }, createElement: () => area, execCommand: () => execResult };
}

test('copyText uses the clipboard, and the old copy command when it is refused', async () => {
  const written = [];
  const clipboard = { writeText: async text => { written.push(text); } };
  assert.equal(await app.copyText('a', clipboard, fakeDoc(false)), true);
  assert.deepEqual(written, ['a']);
  const refused = { writeText: async () => { throw new Error('denied'); } };
  assert.equal(await app.copyText('a', refused, fakeDoc(true)), true);
  assert.equal(await app.copyText('a', undefined, fakeDoc(true)), true);
  assert.equal(await app.copyText('a', refused, fakeDoc(false)), false);
});

test('showCopyResult says what happened on the button, then puts it back', () => {
  const attrs = { 'aria-label': 'Copy answer', title: 'Copy answer' };
  const btn = {
    innerHTML: 'copy-icon', style: {},
    getAttribute: name => attrs[name],
    setAttribute: (name, value) => { attrs[name] = value; }
  };
  let restore;
  const later = fn => { restore = fn; return 1; };
  app.showCopyResult(btn, true, { ok: 'tick', fail: 'cross' }, later, () => {});
  assert.equal(btn.innerHTML, 'tick');
  assert.equal(attrs['aria-label'], 'Copied');
  assert.equal(attrs.title, 'Copied');
  // A second click while it shows must not save "Copied" as the resting label
  app.showCopyResult(btn, false, { ok: 'tick', fail: 'cross' }, later, () => {});
  assert.equal(btn.innerHTML, 'cross');
  assert.equal(attrs.title, 'Copy failed');
  restore();
  assert.equal(btn.innerHTML, 'copy-icon');
  assert.equal(attrs['aria-label'], 'Copy answer');
  assert.equal(attrs.title, 'Copy answer');
});
test('sourceKind reads every icon name seen on the page', () => {
  const kind = (type, title = 'x', url = '') => app.sourceKind(type, title, url);
  assert.equal(kind('video_youtube'), 'youtube');
  assert.equal(kind('video_audio_call', 'dec18.m4a'), 'audio');
  assert.equal(kind('drive_pdf'), 'pdf');
  assert.equal(kind('image'), 'image');
  assert.equal(kind('markdown'), 'markdown');
  assert.equal(kind('description'), 'text');
  assert.equal(kind('article'), 'text');
});

test('sourceKind reads icon names Google is likely to use next', () => {
  const kind = type => app.sourceKind(type, 'x', '');
  assert.equal(kind('web'), 'web');
  assert.equal(kind('language'), 'web');
  assert.equal(kind('drive_presentation'), 'slides');
  assert.equal(kind('drive_spreadsheet'), 'sheet');
  assert.equal(kind('drive_document'), 'doc');
  assert.equal(kind('movie'), 'video');
  assert.equal(kind('mic'), 'audio');
});

test('sourceKind falls back to the title extension, then the url, then a plain document', () => {
  const kind = (type, title, url = '') => app.sourceKind(type, title, url);
  for (const [title, expected] of [
    ['a.PDF', 'pdf'], ['a.mp3', 'audio'], ['a.m4a', 'audio'], ['a.wav', 'audio'], ['a.mp4', 'video'], ['a.mov', 'video'],
    ['a.jpeg', 'image'], ['a.png', 'image'], ['a.webp', 'image'], ['a.heic', 'image'], ['a.md', 'markdown'],
    ['a.txt', 'text'], ['a.rtf', 'text'], ['a.docx', 'doc'], ['a.doc', 'doc'], ['a.pptx', 'slides'],
    ['a.xlsx', 'sheet'], ['a.csv', 'sheet'], ['a.html', 'web'], ['https://example.com/page', 'web']
  ]) assert.equal(kind('', title), expected, title);
  // A generic icon does not hide a more exact extension
  assert.equal(kind('description', 'plan.docx'), 'doc');
  assert.equal(kind('', 'a talk', 'https://www.youtube.com/watch?v=x'), 'youtube');
  assert.equal(kind('', 'no clue'), 'document');
  assert.equal(kind('document', 'no clue'), 'document');
  assert.equal(kind('something_new', 'no clue'), 'document');
  assert.equal(app.sourceKind(undefined, undefined, undefined), 'document');
});

test('every link the viewer writes itself opens in a new tab', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'viewer', 'viewer-app.js'), 'utf8');
  const links = src.split('\n').filter(line => /<a (class|href)=/.test(line));
  assert.ok(links.length >= 2);
  for (const line of links) assert.match(line, /target="_blank" rel="noopener"/, line.trim().slice(0, 80));
});

const archive = () => ({
  sources: [
    { title: 'feb23_part1.m4a', md: '## Content\n\nWe toured **Alberta Bible** College, which has a gym.\n\nThe gym needs work. Another gym too.' },
    { title: 'Budget.pdf', md: 'Tuition rises. See [the plan](https://x/y) and ![pic](images/a.png).' }
  ],
  studio: [
    { kind: 'note', title: 'Minutes on Alberta', md: 'Resolved to visit.<sup><a href="#src-1">[1]</a></sup>' },
    { kind: 'tables', title: 'Costs', rows: [['Site', 'Cost'], ['Fatima', '$1M']] },
    { kind: 'slides', title: 'Deck', files: { pdf: 'a.pdf' } }
  ],
  pairs: [{ q: 'where is the gym?', a: 'It’s at the college <button class="cite" data-c="1">1</button>.' }]
});

test('searchText leaves readable text: no marks, tags, urls or citation chips', () => {
  assert.equal(app.searchText('**Bold** [link](https://x) ![p](a.png)  <sup>[1]</sup>\n\nend'), 'Bold link [1] end');
  assert.equal(app.searchText('a <button class="cite" data-c="1">3</button> b'), 'a b');
  assert.equal(app.searchText('it’s “ok”'), 'it\'s "ok"');
  assert.equal(app.searchText(null), '');
});

test('searchArchive finds text inside sources, notes, tables and chat, grouped', () => {
  const index = app.buildSearchIndex(archive());
  const found = app.searchArchive(index, 'gym');
  assert.deepEqual(found.groups.map(g => [g.key, g.hits.length]), [['source', 1], ['chat', 1]]);
  assert.equal(found.total, 2);
  const hit = found.groups[0].hits[0];
  assert.deepEqual([hit.kind, hit.i, hit.title, hit.count], ['source', 0, 'feb23_part1.m4a', 3]);
  assert.equal(hit.match, 'gym');
  assert.match(hit.before, /College, which has a $/);
  assert.equal(app.searchArchive(index, 'fatima').groups[0].key, 'studio');
});

test('searchArchive ignores case and punctuation in the text, and matches across bold', () => {
  const index = app.buildSearchIndex(archive());
  assert.equal(app.searchArchive(index, 'ALBERTA BIBLE COLLEGE').total, 1);
  assert.equal(app.searchArchive(index, 'it\'s at').total, 1);
});

test('searchArchive needs every word, but not next to each other, and titles count', () => {
  const index = app.buildSearchIndex(archive());
  assert.equal(app.searchArchive(index, 'college work').total, 1);
  assert.equal(app.searchArchive(index, 'college zebra').total, 0);
  const title = app.searchArchive(index, 'deck');
  assert.equal(title.groups[0].hits[0].match, '');
  // A title match comes first
  const first = app.searchArchive(index, 'alberta').groups;
  assert.deepEqual(first.map(g => g.key), ['source', 'studio']);
});

test('searchArchive keeps a large result short and says how many there are', () => {
  const data = { sources: Array.from({ length: 40 }, (_, i) => ({ title: `s${i}`, md: 'needle' })), studio: [], pairs: [] };
  const found = app.searchArchive(app.buildSearchIndex(data), 'needle', 30);
  assert.equal(found.groups[0].hits.length, 30);
  assert.equal(found.groups[0].total, 40);
  assert.equal(found.total, 40);
});

test('searchArchive ignores a query too short to mean anything', () => {
  const index = app.buildSearchIndex(archive());
  assert.deepEqual(app.searchArchive(index, ' a ').groups, []);
  assert.deepEqual(app.searchArchive(index, '').groups, []);
});

test('searchArchive is quick on a large archive', () => {
  const md = 'word '.repeat(200000);
  const index = app.buildSearchIndex({ sources: Array.from({ length: 50 }, (_, i) => ({ title: `s${i}`, md })), studio: [], pairs: [] });
  const start = Date.now();
  app.searchArchive(index, 'nothing here');
  assert.ok(Date.now() - start < 500);
});

test('findQuote can ignore case, for a search match', () => {
  assert.equal(app.findQuote('Alberta College', 'alberta'), null);
  assert.deepEqual(app.findQuote('Alberta College', 'alberta', true), { at: 0, length: 7 });
});

test('the view state round-trips and rejects anything else', () => {
  assert.equal(app.formatViewState({ source: 3, art: null }), 's3');
  assert.equal(app.formatViewState({ source: null, art: 2 }), 'a2');
  assert.equal(app.formatViewState({ source: 3, art: 2 }), 's3,a2');
  assert.equal(app.formatViewState({ source: null, art: null }), '');
  assert.deepEqual(app.parseViewState('#s3,a2'), { source: 3, art: 2 });
  assert.deepEqual(app.parseViewState('#a2'), { source: null, art: 2 });
  assert.deepEqual(app.parseViewState(''), { source: null, art: null });
  assert.deepEqual(app.parseViewState('#x9,<b>,s-1'), { source: null, art: null });
});
