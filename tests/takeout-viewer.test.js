const test = require('node:test');
const assert = require('node:assert/strict');
const NLME = require('../takeout-shared.js');
require('../takeout-viewer.js');
const V = globalThis.NLMEViewer;

const manifestOpts = { notebook: 'Demo', exported: '2026-01-02' };

const link = (n, id) => `<a id="ref-${id}" href="#${id}">[${n}]</a>`;
const src = (n, title, quote) => `<a id="src-${n}"></a>\n**[[${n}]](#ref-src-${n})** ${title}\n> ${quote}\n`;

const CHAT = [
  '# Chat', '',
  '**Notebook Summary**', 'A short summary.', '', '---', '**Chat Export** extra', '',
  '## 2026-03-04', '',
  '## Q: What is it?', '', '**A:** It is a thing.' + `<sup>${link(1, 'src-1')}</sup>` + ' More' + `<sup>${link(1, 'src-1')} ${link(2, 'src-2')}</sup>`, '',
  '**Sources:**', '', src(1, 'Alpha', 'quote a'), src(2, 'Beta', 'quote b'), '---', '',
  '## Q: Second?', '', '**A:** Plain answer, no cites.', '', '---', ''
].join('\n');

test('buildViewerData reads questions, answers, dates and the summary from chat.md', () => {
  const d = V.buildViewerData({ 'chat/chat.md': CHAT }, manifestOpts);
  assert.equal(d.notebook, 'Demo');
  assert.equal(d.exported, '2026-01-02');
  assert.equal(d.summary, 'A short summary.');
  assert.equal(d.pairs.length, 2);
  assert.equal(d.pairs[0].date, '2026-03-04');
  assert.equal(d.pairs[0].q, 'What is it?');
  assert.match(d.pairs[0].a, /^It is a thing\./);
  assert.equal(d.pairs[0].n, 2);
  assert.equal(d.pairs[1].a, 'Plain answer, no cites.');
  assert.equal(d.pairs[1].n, 0);
});

test('citation markers become chips, alone and grouped in one <sup>', () => {
  const d = V.buildViewerData({ 'chat/chat.md': CHAT }, manifestOpts);
  const a = d.pairs[0].a;
  assert.equal((a.match(/<button class="cite" data-c="\d+">/g) || []).length, 3);
  assert.match(a, /<button class="cite" data-c="0">1<\/button>/);
  assert.match(a, /<button class="cite" data-c="0">1<\/button> <button class="cite" data-c="1">2<\/button>/);
  assert.doesNotMatch(a, /src-|<sup>|<a /);
  assert.deepEqual(d.cites, [{ t: 'Alpha', q: 'quote a' }, { t: 'Beta', q: 'quote b' }]);
});

test('footnote markers become chips', () => {
  const defs = NLME.footnoteDefinitions(
    [{ number: 1, text: 'Gamma *x*', quote: 'line one\nline two' }, { number: 2, text: 'Delta', quote: '' }],
    n => String(n));
  const note = `# Note\n\nClaim [^1] and more [^1] [^2].\n\n---\n\n${defs}`;
  const d = V.buildViewerData({ 'notes/n.md': `---\ntitle: "N"\n---\n${note}` }, manifestOpts);
  const md = d.studio[0].md;
  assert.match(md, /Claim <button class="cite" data-c="0">1<\/button> and more <button class="cite" data-c="0">1<\/button> <button class="cite" data-c="1">2<\/button>\.$/);
  assert.doesNotMatch(md, /\[\^|Gamma|---/);
  assert.deepEqual(d.cites, [{ t: 'Gamma *x*', q: 'line one\nline two' }, { t: 'Delta', q: '' }]);
});

test('titles-only and no-citation chats still parse', () => {
  const titlesOnly = '**Notebook Summary**\nS\n\n## Q: One?\n\n## Q: Two?\n\n**A:** Two.\n';
  const d = V.buildViewerData({ 'chat/chat.md': titlesOnly }, manifestOpts);
  assert.deepEqual(d.pairs.map(p => [p.q, p.a]), [['One?', ''], ['Two?', 'Two.']]);
  const none = V.buildViewerData({ 'chat/chat.md': '## Q: Hi\n\n**A:** Yo\n' }, manifestOpts);
  assert.equal(none.pairs[0].a, 'Yo');
  assert.deepEqual(none.cites, []);
  assert.equal(V.buildViewerData({}, manifestOpts).summary, '');
});

test('sources prefer plus-meta, and variants never appear as extra sources', () => {
  const d = V.buildViewerData({
    'sources/a.md': '# A\n\nplain body',
    'sources/a-plus-meta.md': '---\ntitle: "Alpha"\nyoutube_url: "https://y/1"\n---\n# A\n\nmeta body',
    'sources/a-with-images.md': '# A\n\nimg body',
    'sources/a-code-blocks.md': '# A\n\ncode body',
    'sources/b.md': '# B\n\nb body',
    'sources/_index.md': 'x'
  }, manifestOpts);
  assert.deepEqual(d.sources.map(s => s.title), ['Alpha', 'b']);
  assert.equal(d.sources[0].url, 'https://y/1');
  assert.equal(d.sources[0].md, 'meta body');
});

test('notes in part-1 and part-2 are all listed once', () => {
  const d = V.buildViewerData({
    'part-1/notes/one.md': '# One\n\nfirst',
    'part-2/notes/two.md': '# Two\n\nsecond!',
    'part-2/notes/combined-notes.md': 'skip',
    'part-1/notes/one-with-images.md': 'skip'
  }, manifestOpts);
  assert.deepEqual(d.studio.map(s => s.title).sort(), ['one', 'two']);
});

test('artifacts group by stem and kind, with encoded relative links', () => {
  const d = V.buildViewerData({
    'artifacts/slides/A, b é.pdf': null,
    'artifacts/slides/A, b é.md': '# T\n\nbody',
    'artifacts/audio/talk.m4a': null
  }, manifestOpts);
  const slides = d.studio.find(s => s.kind === 'slides');
  assert.equal(slides.files.pdf, 'artifacts/slides/A%2C%20b%20%C3%A9.pdf');
  assert.equal(slides.files.md, 'artifacts/slides/A%2C%20b%20%C3%A9.md');
  assert.equal(slides.md, 'body');
  assert.equal(d.studio.filter(s => s.kind === 'slides').length, 1);
  assert.equal(d.studio.find(s => s.kind === 'audio').files.m4a, 'artifacts/audio/talk.m4a');
});

test('csv tables parse quoted commas and a BOM', () => {
  const csv = '﻿a,b\r\n"x, y","say ""hi"""\r\n';
  const d = V.buildViewerData({ 'artifacts/data-table/t.csv': csv }, manifestOpts);
  assert.deepEqual(d.studio[0].rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('escapeJson leaves no </script> or <!--', () => {
  const out = V.escapeJson({ a: '</script><!-- x', b: '\u2028' });
  assert.doesNotMatch(out, /<\/script|<!--|\u2028/);
  assert.deepEqual(JSON.parse(out), { a: '</script><!-- x', b: '\u2028' });
});

test('wantsText skips image and code-block variants', () => {
  for (const p of ['chat/chat.md', 'sources/a-plus-meta.md', 'artifacts/t/x.csv', 'part-1/notes/n.md']) assert.equal(V.wantsText(p), true, p);
  for (const p of ['a-with-images.md', 'a-code-blocks.md', 'notes/combined-notes.md', 'notes/combined-notes-2.md',
    '_index.md', 'sources/_index-2.md', '_audit.md', 'errors.md', 'a.pdf', 'manifest.json']) assert.equal(V.wantsText(p), false, p);
});

test('hostile footnote labels are not turned into chips or markup', () => {
  const note = '# N\n\nHi [^<img src=x onerror=1>] and [^a"b].\n\n[^<img src=x onerror=1>]: **T** — q\n[^a"b]: **U**\n';
  const d = V.buildViewerData({ 'notes/n.md': note }, manifestOpts);
  assert.doesNotMatch(d.studio[0].md, /<button/);
  assert.doesNotMatch(d.studio[0].md, /<img[^]*<\/button>/);
});

test('notes dedupe on full body: real duplicates collapse, same-length different notes stay', () => {
  const d = V.buildViewerData({
    'part-1/notes/a.md': '---\ntitle: "T"\n---\n# T\n\nsame body',
    'part-2/notes/a.md': '---\ntitle: "T"\n---\n# T\n\nsame body',
    'part-1/notes/b.md': '---\ntitle: "U"\n---\n# U\n\nabcd',
    'part-2/notes/b.md': '---\ntitle: "U"\n---\n# U\n\nwxyz'
  }, manifestOpts);
  assert.deepEqual(d.studio.map(s => s.title + ':' + s.md).sort(), ['T:same body', 'U:abcd', 'U:wxyz']);
});

test('same-named sources and artifacts in two parts both survive', () => {
  const d = V.buildViewerData({
    'part-1/sources/s.md': '# S\n\none',
    'part-2/sources/s.md': '# S\n\ntwo',
    'part-1/artifacts/slides/x.pdf': null,
    'part-2/artifacts/slides/x.pdf': null,
    'part-2/artifacts/slides/x.md': '# X\n\nbody'
  }, manifestOpts);
  assert.deepEqual(d.sources.map(s => s.md).sort(), ['one', 'two']);
  const links = d.studio.map(a => a.files.pdf).sort();
  assert.deepEqual(links, ['part-1/artifacts/slides/x.pdf', 'part-2/artifacts/slides/x.pdf']);
  assert.equal(d.studio.length, 2);
});

test('an h2 heading inside an answer stays in the answer', () => {
  const chat = '## Q: Why?\n\n**A:** Intro\n\n## Details\n\nMore text\n\n---\n\n## Q: Next?\n\n**A:** ok\n';
  const d = V.buildViewerData({ 'chat/chat.md': chat }, manifestOpts);
  assert.equal(d.pairs.length, 2);
  assert.match(d.pairs[0].a, /Intro\n\n## Details\n\nMore text$/);
});

test('artifact files merge only within their own directory, whatever the order', () => {
  const d = V.buildViewerData({
    'part-2/artifacts/slides/x.md': '# X\n\ntwo',
    'part-1/artifacts/slides/x.pdf': null,
    'part-2/artifacts/slides/x.pdf': null
  }, manifestOpts);
  assert.equal(d.studio.length, 2);
  const withMd = d.studio.find(a => a.md);
  assert.equal(withMd.md, 'two');
  assert.equal(withMd.files.pdf, 'part-2/artifacts/slides/x.pdf');
  assert.equal(d.studio.find(a => !a.md).files.pdf, 'part-1/artifacts/slides/x.pdf');
});
