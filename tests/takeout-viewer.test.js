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

// ---- viewer page ----
const fs = require('node:fs');
const path = require('node:path');
const app = (() => { try { return require('../viewer/viewer-app.js'); } catch (e) { return {}; } })();

test('assembleViewer keeps dollar patterns intact', () => {
  const data = { notebook: "cost $& and $1 and $$ and $` and $'", n: '/*APP_JS*/' };
  const html = V.assembleViewer({
    template: '<style>/*KATEX_CSS*/</style><script id="data" type="application/json">/*DATA_JSON*/</script><script>/*MARKED_JS*/</script><script>/*KATEX_JS*/</script><script>/*APP_JS*/</script>',
    css: 'a{}', marked: 'var m="$&";', katex: 'var k="$1";', app: 'var a=1;</script>', data
  });
  const json = /<script id="data"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.deepEqual(JSON.parse(json), data);
  assert.ok(html.includes('var m="$&";') && html.includes('var k="$1";'));
  assert.ok(!html.includes('var a=1;</script>'));
});

test('findQuote matches across line breaks and curly quotes', () => {
  const text = 'Intro.\nHe said “it’s  fine”,\nand left.';
  const hit = app.findQuote(text, 'He said "it\'s fine", and left.');
  assert.ok(hit);
  assert.equal(text.slice(hit.at, hit.at + hit.length), 'He said “it’s  fine”,\nand left');
});

test('findQuote falls back to the first 60 characters', () => {
  const head = 'abcdefghij'.repeat(6);
  const hit = app.findQuote('xx ' + head + ' end', head + ' but the rest differs completely');
  assert.deepEqual(hit, { at: 3, length: 60 });
});

test('findQuote returns null for text that is absent', () => {
  assert.equal(app.findQuote('some text', 'nothing like it'), null);
  assert.equal(app.findQuote('some text', '  ...  '), null);
});

// Minimal stand-in for DOMParser: flat tag soup with attributes, enough for sanitizeHtml.
function fakeParser() {
  const VOID = /^(img|br|hr|input|source|track|link|meta|base|use|image)$/i;
  return { parseFromString(html) {
    const nodes = [];
    const re = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
    let m, stack = [];
    const doc = {
      createTextNode: text => ({ text, isText: true }),
      querySelectorAll(sel) {
        const names = sel === '*' ? null : sel.split(',');
        return nodes.filter(n => !n.gone && !n.isText && (!names || names.includes(n.tagName.toLowerCase())));
      },
      body: { get innerHTML() { return nodes.filter(n => !n.gone).map(n => n.isText ? n.text : n.open() + (VOID.test(n.tagName) ? '' : '')).join('') + stack.map(t => `</${t}>`).join(''); } }
    };
    const closeTag = (name) => { const i = stack.lastIndexOf(name); if (i >= 0) stack = stack.slice(0, i); };
    while ((m = re.exec(html))) {
      if (m[3] !== undefined) { nodes.push({ text: m[3], isText: true }); continue; }
      if (m[0][1] === '/') { nodes.push({ close: m[1], isText: true, text: `</${m[1]}>` }); closeTag(m[1]); continue; }
      const attrs = [];
      m[2].replace(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (_, k, a, b, c) => { attrs.push({ name: k, value: a ?? b ?? c ?? '' }); return ''; });
      const el = {
        tagName: m[1].toUpperCase(), attributes: attrs,
        getAttribute(k) { const a = attrs.find(x => x.name === k); return a ? a.value : null; },
        removeAttribute(k) { const i = attrs.findIndex(x => x.name === k); if (i >= 0) attrs.splice(i, 1); },
        remove() { el.gone = true; },
        replaceWith(t) { el.gone = true; nodes.splice(nodes.indexOf(el) + 1, 0, t); },
        open() { return `<${el.tagName.toLowerCase()}${attrs.map(a => ` ${a.name}="${a.value}"`).join('')}${el.target ? ` target="${el.target}" rel="${el.rel}"` : ''}>`; }
      };
      nodes.push(el);
    }
    return doc;
  } };
}
const clean = html => app.sanitizeHtml(html, fakeParser());

test('viewer app removes scripts and handlers', () => {
  assert.equal(typeof app.sanitizeHtml, 'function');
  let out = clean('<p>hi</p><script>alert(1)</script><b onclick="x()" title="t">b</b>');
  assert.ok(!/<script/i.test(out), out);
  assert.ok(!/onclick/i.test(out) && /title="t"/.test(out), out);
  out = clean('<img src="x.png" onerror="alert(1)">');
  assert.ok(!/onerror/.test(out) && /src="x\.png"/.test(out), out);
  out = clean('<a href="javascript:alert(1)">x</a><a href=" JavaScript:alert(1)">y</a>');
  assert.ok(!/javascript/i.test(out), out);
  out = clean('<a href="https://example.org/p">ok</a>');
  assert.match(out, /href="https:\/\/example\.org\/p"/);
  assert.match(out, /rel="noopener"/);
  // every markdown render passes through sanitize
  const src = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-app.js'), 'utf8');
  assert.match(src, /var html = sanitize\(marked\.parse\(/);
  assert.equal((src.match(/marked\.parse\(/g) || []).length, 1);
});

test('sanitizeHtml drops remote loads and keeps local ones', () => {
  let out = clean('<img src="https://h.example/a.png" alt="A chart">');
  assert.ok(!/https/.test(out) && !/<img/.test(out) && /A chart/.test(out), out);
  out = clean('<img src="//h.example/a.png">');
  assert.ok(!/h\.example/.test(out) && !/<img/.test(out), out);
  out = clean('<img src="a/b.png" alt="x"><img src="data:image/png;base64,AAAA">');
  assert.match(out, /src="a\/b\.png"/);
  assert.match(out, /src="data:image\/png;base64,AAAA"/);
  for (const html of [
    '<video src="http://h.example/v.mp4" poster="http://h.example/p.png"></video>',
    '<audio src="https://h.example/a.mp3"></audio>',
    '<source src="https://h.example/a.mp4">',
    '<img srcset="https://h.example/a.png 2x" src="ok.png">',
    '<svg><image href="https://h.example/a.png"></image><use href="https://h.example/s.svg#a"></use></svg>',
    '<p style="background:url(https://h.example/b.png)">t</p>',
    '<p style="background:URL( \'https://h.example/b.png\')">t</p>'
  ]) assert.ok(!/h\.example/.test(clean(html)), clean(html));
});

test('viewer page makes no remote requests', () => {
  for (const f of ['viewer-template.html', 'viewer-app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'viewer', f), 'utf8');
    assert.ok(!/(src|href)="https?:|url\(https?:|@import|fetch\(|XMLHttpRequest/.test(src), f);
  }
});

// ---- tools/build_viewer.js ----
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const CLI = path.join(__dirname, '..', 'tools', 'build_viewer.js');

function makeTakeout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nlme-take-'));
  const put = (p, c) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), c); };
  put('manifest.json', JSON.stringify({ notebook: { title: 'Zebra Notebook' }, exported: '2026-05-06T00:00:00Z' }));
  put('notes/My Note Title.md', '# My Note Title\n\nbody text here');
  put('artifacts/slides/deck one.pdf', 'PDF');
  put('artifacts/manifest.json', JSON.stringify({ files: [{ path: 'slides/deck one.pdf', title: 'Pretty Deck' }] }));
  return root;
}

test('buildViewerData prefixes media links with mediaBase, default stays root-relative', () => {
  const files = { 'artifacts/slides/a b.pdf': null };
  assert.equal(V.buildViewerData(files, {}).studio[0].files.pdf, 'artifacts/slides/a%20b.pdf');
  assert.equal(V.buildViewerData(files, { mediaBase: '../t/' }).studio[0].files.pdf, '../t/artifacts/slides/a%20b.pdf');
});

test('build_viewer writes a page from a temp takeout', () => {
  const root = makeTakeout();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlme-out-'));
  const out = path.join(outDir, 'sub', 'viewer.html');
  const r = spawnSync(process.execPath, [CLI, root, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('My Note Title'));
  assert.ok(html.includes('Zebra Notebook'));
  assert.ok(html.includes('Pretty Deck'));
  const rel = path.relative(path.dirname(out), root).split(path.sep).map(encodeURIComponent).join('/');
  assert.ok(html.includes(rel + '/artifacts/slides/deck%20one.pdf'), 'media link relative to out folder');
});

test('build_viewer prints per-answer chat citations and unique records separately', () => {
  const root = makeTakeout();
  fs.mkdirSync(path.join(root, 'chat'), { recursive: true });
  fs.writeFileSync(path.join(root, 'chat', 'chat.md'), CHAT + '\n## Q: Third?\n\n**A:** Again.' + `<sup>${link(1, 'src-1')}</sup>` + '\n\n**Sources:**\n\n' + src(1, 'Alpha', 'quote a') + '\n---\n');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nlme-out-')), 'v.html');
  const r = spawnSync(process.execPath, [CLI, root, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 chat citations, 2 unique citation records/);
});

test('build_viewer requires out and refuses ~/Downloads without the flag (fake HOME)', () => {
  const root = makeTakeout();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nlme-home-'));
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home });
  assert.notEqual(spawnSync(process.execPath, [CLI, root], { encoding: 'utf8', env }).status, 0);
  const dl = path.join(home, 'Downloads', 'sub', 'v.html');
  const r = spawnSync(process.execPath, [CLI, root, dl], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /allow-downloads/);
  assert.ok(!fs.existsSync(dl));
  const ok = spawnSync(process.execPath, [CLI, root, dl, '--allow-downloads'], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(dl));
});

// ---- Full Takeout: what the viewer captures, and the on-disk layout ----

test('takeout layout: notes, sources and artifacts in <category>/part-N/ reach the viewer', () => {
  const d = V.buildViewerData({
    'notes/part-1/one.md': '# One\n\nfirst',
    'notes/part-2/two.md': '# Two\n\nsecond!',
    'notes/part-2/one-with-images.md': 'skip',
    'notes/part-2/_index.md': 'skip',
    'sources/part-2/s.md': '# S\n\nbody',
    'artifacts/part-1/manifest.json': JSON.stringify({ files: [{ path: 'slides/deck.pdf', title: 'Pretty Deck' }] }),
    'artifacts/part-1/slides/deck.pdf': null,
    'artifacts/part-2/manifest.json': JSON.stringify({ files: [{ path: 'audio/a b.m4a', title: 'Talk' }] }),
    'artifacts/part-2/audio/a b.m4a': null,
    'artifacts/part-2/_index.md': null
  }, manifestOpts);
  assert.deepEqual(d.sources.map(s => s.title), ['s']);
  assert.deepEqual(d.studio.filter(s => s.kind === 'note').map(s => s.title), ['one', 'two']);
  const art = d.studio.filter(s => s.kind !== 'note');
  assert.deepEqual(art.map(a => [a.kind, a.title]), [['audio', 'Talk'], ['slides', 'Pretty Deck']]);
  assert.equal(art[0].files.m4a, 'artifacts/part-2/audio/a%20b.m4a');
  assert.equal(art[1].files.pdf, 'artifacts/part-1/slides/deck.pdf');
});

test('a note named like a part folder is not mistaken for one', () => {
  const d = V.buildViewerData({ 'notes/part-1.md': '# P\n\nbody' }, manifestOpts);
  assert.deepEqual(d.studio.map(s => s.title), ['part-1']);
});

test('captureEntry keeps text only for wanted strings', () => {
  const store = {};
  V.captureEntry(store, 'notes/a.md', 'note');
  V.captureEntry(store, 'artifacts/data-tables/t.csv', 'a,b');
  V.captureEntry(store, 'chat/chat.md', 'chat');
  assert.deepEqual(store, { 'notes/a.md': 'note', 'artifacts/data-tables/t.csv': 'a,b', 'chat/chat.md': 'chat' });
});

test('captureEntry never keeps -with-images, combined or index text', () => {
  const store = {};
  const huge = 'data:image/png;base64,AAAA';
  const skipped = ['notes/a-with-images.md', 'sources/part-2/b-plus-meta-with-images.md', 'chat/chat-with-images.md',
    'notes/combined-notes.md', 'notes/_index.md', 'notes/_audit.md', 'notes/errors.md', 'sources/youtube-urls.txt', 'artifacts/_index.html'];
  for (const p of skipped) V.captureEntry(store, p, huge);
  assert.deepEqual(Object.keys(store), skipped);
  for (const p of skipped) assert.equal(store[p], null, p);
});

test('captureEntry stores null for binary and URL-only entries, keeping the path', () => {
  const store = {};
  V.captureEntry(store, 'artifacts/audio/a.m4a', undefined);
  V.captureEntry(store, 'artifacts/audio/b.m4a', null);
  V.captureEntry(store, 'artifacts/slides/c.pdf', new Uint8Array(4));
  V.captureEntry(store, 'artifacts/reports/d.md', new Uint8Array(4));
  assert.deepEqual(store, { 'artifacts/audio/a.m4a': null, 'artifacts/audio/b.m4a': null, 'artifacts/slides/c.pdf': null, 'artifacts/reports/d.md': null });
});

test('captureEntry keeps the artifacts manifest, also from a part, and no other manifest', () => {
  const store = {};
  for (const p of ['artifacts/manifest.json', 'artifacts/part-2/manifest.json', 'notes/manifest.json', 'manifest.json']) V.captureEntry(store, p, '{}');
  assert.deepEqual(store, { 'artifacts/manifest.json': '{}', 'artifacts/part-2/manifest.json': '{}', 'notes/manifest.json': null, 'manifest.json': null });
});

test('landedPath takes the name Chrome really used', () => {
  assert.equal(V.landedPath('r/artifacts/slides/x.pdf', '/Users/me/Downloads/t/r/artifacts/slides/x.pptx'), 'r/artifacts/slides/x.pptx');
  assert.equal(V.landedPath('r/artifacts/slides/x.pdf', 'C:\\Users\\me\\Downloads\\t\\x (1).pdf'), 'r/artifacts/slides/x (1).pdf');
  assert.equal(V.landedPath('x.pdf', '/d/y.pdf'), 'y.pdf');
  assert.equal(V.landedPath('r/x.pdf', ''), 'r/x.pdf');
  assert.equal(V.landedPath('r/x.pdf', undefined), 'r/x.pdf');
});

test('an artifact saved beside the takeout root keeps a link that resolves from viewer.html', () => {
  const rel = 'artifacts/' + V.outsidePath('slides', 'Downloads-folder/[slides]_My Deck.pdf');
  assert.equal(rel, 'artifacts/slides/../../../[slides]_My Deck.pdf');
  const d = V.buildViewerData({ [rel]: null }, manifestOpts);
  assert.equal(d.studio[0].kind, 'slides');
  const url = new URL(d.studio[0].files.pdf, 'file:///d/t/root/viewer.html');
  assert.equal(decodeURIComponent(url.pathname), '/d/t/[slides]_My Deck.pdf');
});

test('build_viewer reads the manifest of artifacts/part-N/', () => {
  const root = makeTakeout();
  fs.mkdirSync(path.join(root, 'artifacts/part-2/slides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/part-2/slides/second.pdf'), 'PDF');
  fs.writeFileSync(path.join(root, 'artifacts/part-2/manifest.json'), JSON.stringify({ files: [{ path: 'slides/second.pdf', title: 'Second Deck' }] }));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nlme-out-')), 'viewer.html');
  const r = spawnSync(process.execPath, [CLI, root, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(out, 'utf8').includes('Second Deck'));
});

// ---- saveFiles and the viewer build, run in a stubbed side panel ----
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');

function sidePanel({ fetchFile, downloadItem = () => [{ filename: '/d/x', state: 'complete' }] } = {}) {
  const log = { zips: [], downloads: [], direct: [], zipped: {}, panels: [] };
  class JSZip { file(p, d) { log.zipped[p] = d; } }
  const sandbox = {
    NLME, NLMEViewer: V, JSZip, Blob, URL, console: { log() {}, warn() {}, error() {} },
    // The 60 s blob-URL revoke must not hold the test process open
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (ms >= 1000) t.unref(); return t; },
    generateZipTimed: async zip => zip,
    downloadBlob: async (blob, name) => { log.zips.push(name); },
    fetch: async url => {
      if (fetchFile) return fetchFile(url);
      return { ok: true, blob: async () => new Blob(['media']) };
    },
    chrome: {
      runtime: {
        getURL: p => 'chrome-extension://id/' + p,
        sendMessage: async m => {
          if (m.type === NLME.MSG.DIRECT_DOWNLOAD_URL) { log.direct.push(m.filename); return { success: true, downloadId: 7 }; }
          return {};
        }
      },
      downloads: {
        download: async o => { log.downloads.push(o.filename); return 1; },
        search: async ({ id }) => downloadItem(id)
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sidebar-takeout.js'), 'utf8'), sandbox);
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const start = core.indexOf('async function saveCategoryBatch(');
  vm.runInContext(core.slice(start, core.indexOf('\n}\n', start) + 3), sandbox);
  return { sandbox, log };
}

const mixedEntries = () => [
  { path: 'R/notes/a.md', data: 'text' },
  { path: 'R/notes/a.bin', data: new Uint8Array(2) },
  { path: 'R/artifacts/audio/b.m4a', url: 'https://lh3.googleusercontent.com/notebooklm/x' }
];
const capturing = () => { const seen = []; return { seen, capture: (p, t) => seen.push([p, t]) }; };
const EXPECT_SEEN = [['R/notes/a.md', 'text'], ['R/notes/a.bin', null], ['R/artifacts/audio/b.m4a', null]];

test('saveFiles reports every entry to capture in ZIP mode, after the ZIP is saved', async () => {
  const { sandbox, log } = sidePanel();
  const { seen, capture } = capturing();
  let zipsAtCapture = null;
  await sandbox.saveFiles(mixedEntries(), { zipName: 'a.zip', capture: (p, t) => { zipsAtCapture = log.zips.length; capture(p, t); } });
  assert.deepEqual(seen, EXPECT_SEEN);
  assert.equal(zipsAtCapture, 1);
});

test('saveFiles captures nothing for a ZIP that failed', async () => {
  const { sandbox } = sidePanel();
  sandbox.downloadBlob = async () => { throw new Error('disk full'); };
  const { seen, capture } = capturing();
  await assert.rejects(sandbox.saveFiles(mixedEntries(), { zipName: 'a.zip', capture }));
  assert.deepEqual(seen, []);
});

test('saveFiles reports every entry to capture in folder mode, with the name the download really got', async () => {
  const { sandbox, log } = sidePanel({ downloadItem: () => [{ filename: '/Users/me/Downloads/T/R/artifacts/audio/b (1).mp3', state: 'complete' }] });
  const { seen, capture } = capturing();
  await sandbox.saveFiles(mixedEntries(), { folder: 'T', capture });
  assert.deepEqual(seen.slice(0, 2), EXPECT_SEEN.slice(0, 2));
  assert.deepEqual(seen[2], ['R/artifacts/audio/b (1).mp3', null]);
  assert.deepEqual(log.direct, ['T/R/artifacts/audio/b.m4a']);
});

test('saveFiles keeps the planned name when Chrome never reports one', async () => {
  const { sandbox } = sidePanel({ downloadItem: () => [{ filename: '', state: 'interrupted' }] });
  const { seen, capture } = capturing();
  await sandbox.saveFiles(mixedEntries(), { folder: 'T', capture });
  assert.deepEqual(seen, EXPECT_SEEN);
});

test('saveFiles reports every entry to capture for single downloads', async () => {
  const { sandbox } = sidePanel({ downloadItem: () => [{ filename: '/d/b.m4a' }] });
  const { seen, capture } = capturing();
  await sandbox.saveFiles(mixedEntries(), { capture });
  assert.deepEqual(seen, EXPECT_SEEN);
});

test('saveFiles without capture never asks where a download landed', async () => {
  let searched = 0;
  const { sandbox } = sidePanel({ downloadItem: () => { searched++; return [{}]; } });
  await sandbox.saveFiles([{ path: 'a.md', data: 'x' }, { path: 'b.m4a', url: 'https://lh3.googleusercontent.com/notebooklm/x' }]);
  assert.equal(searched, 0);
});

test('a capture that throws never fails a save', async () => {
  for (const options of [{ zipName: 'a.zip' }, { folder: 'T' }, {}]) {
    const { sandbox } = sidePanel();
    const out = await sandbox.saveFiles(mixedEntries(), { ...options, capture: () => { throw new Error('boom'); } });
    assert.equal(out.saved, 3);
  }
});

test('saveCategoryBatch hands the capture on, in both modes, with the final part-N path', async () => {
  const shell = { projectName: 'N', timestamp: 'T' };
  const info = { multi: true, batchIndex: 2, totalBatches: 3, partial: false };
  for (const folder of [null, 'T']) {
    const { sandbox } = sidePanel();
    const { seen, capture } = capturing();
    await sandbox.saveCategoryBatch(shell, [{ path: 'a.md', data: 'x' }], info,
      { prefix: 'R/notes/part-2/', zipKind: 'takeout-notes', folder, written: { zips: [], count: 0 }, capture });
    assert.deepEqual(seen, [['R/notes/part-2/a.md', 'x']]);
  }
});

test('buildViewerHtml makes one page from the packaged files and the captured store', async () => {
  const requested = [];
  const { sandbox } = sidePanel({
    fetchFile: url => {
      requested.push(url);
      const file = url.replace('chrome-extension://id/', '');
      return { ok: true, text: async () => fs.readFileSync(path.join(ROOT, file), 'utf8') };
    }
  });
  const store = {};
  V.captureEntry(store, 'notes/part-2/Mine.md', '# Mine\n\nnote body');
  V.captureEntry(store, 'artifacts/part-3/audio/a b.m4a', undefined);
  const html = await sandbox.buildViewerHtml(store, { notebook: 'Zebra Notebook', exported: '2026-05-06T00:00:00Z' });
  assert.deepEqual(requested, V.VIEWER_ASSETS.map(p => 'chrome-extension://id/' + p));
  for (const text of ['Zebra Notebook', '2026-05-06T00:00:00Z', 'note body', 'artifacts/part-3/audio/a%20b.m4a']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /\/\*(KATEX_CSS|DATA_JSON|MARKED_JS|KATEX_JS|APP_JS)\*\//);
});

test('buildViewerHtml works for a takeout that wrote nothing', async () => {
  const { sandbox } = sidePanel({
    fetchFile: url => ({ ok: true, text: async () => fs.readFileSync(path.join(ROOT, url.replace('chrome-extension://id/', '')), 'utf8') })
  });
  assert.ok((await sandbox.buildViewerHtml({}, { notebook: 'N', exported: 'T' })).includes('"studio":[]'));
});

test('buildViewerHtml throws when a packaged file cannot be read', async () => {
  const { sandbox } = sidePanel({ fetchFile: () => ({ ok: false, status: 404 }) });
  await assert.rejects(sandbox.buildViewerHtml({}, { notebook: 'N', exported: 'T' }), /404/);
});

// runFullTakeout itself, with the page, the shell and the runners stubbed. Each runner
// saves through the real saveCategoryBatch, under the target it was handed.
function takeoutPanel({ zip = true, fetchFile, cancelAfter = null, notesThrow = false } = {}) {
  const readAsset = url => ({ ok: true, text: async () => fs.readFileSync(path.join(ROOT, url.replace('chrome-extension://id/', '')), 'utf8') });
  const { sandbox, log } = sidePanel({ fetchFile: fetchFile || readAsset, downloadItem: () => [{ filename: '/d/x.m4a', state: 'complete' }] });
  let cancelled = false;
  const stepsRun = [];
  const batch = name => async (shell, items, target) => {
    stepsRun.push(name);
    if (name === 'notes' && notesThrow) throw new Error('notes broke');
    const info = { multi: name === 'notes', batchIndex: 2, totalBatches: 2, partial: false };
    const prefix = name === 'notes' ? `${target.pathPrefix}part-2/` : target.pathPrefix;
    const files = {
      sources: [{ path: 'S.md', data: '# S\n\nsource body' }],
      notes: [{ path: 'N.md', data: '# N\n\nnote body' }, { path: 'N-with-images.md', data: 'IMAGE-TEXT' }],
      chat: [{ path: 'chat.md', data: '# Chat\n' }],
      artifacts: [{ path: 'audio/a.m4a', data: new Uint8Array(1) }, { path: 'manifest.json', data: '{"files":[{"path":"audio/a.m4a","title":"Pretty Audio"}]}' }]
    }[name];
    await sandbox.saveCategoryBatch(shell, files, info, { prefix, zipKind: target.zipKind, folder: target.folder, written: target.written, capture: target.capture });
    if (cancelAfter === name) cancelled = true;
    return { result: { exported: 1, failed: 0, cancelled: cancelAfter === name }, errors: [], auditOk: true };
  };
  Object.assign(sandbox, {
    settings: { ...NLME.DEFAULT_SETTINGS }, exportTimer: { merge() {} }, lastChatScanTiming: null,
    document: { getElementById: () => ({ checked: zip }) },
    isNotebookUrl: () => true, ensureContentScriptLoaded: async () => {}, startExportTiming() {}, stampJobKeys() {},
    showToast() {}, timingSummary: () => '', showResults: panel => log.panels.push(panel),
    startJobRecord: async () => null, newWritten: () => ({ zips: [], count: 0, multi: false, parts: 0 }),
    scanSourcesData: async () => ({ sources: [{}] }), scanNotesData: async () => [{}], scanArtifactsData: async () => [{}],
    scanChatData: async () => ({ messagePairs: [{}], stats: {} }),
    runSourcesJob: batch('sources'), runNotesJob: batch('notes'), runChatJob: batch('chat'), runArtifactsJob: batch('artifacts'),
    withExportShell: (opts, run) => run({
      tab: { id: 1 }, projectName: 'Book', timestamp: 'T', isCancelled: () => cancelled, progress() {},
      meta: { notebook: 'Book Title', notebook_url: '', notebook_id: '', exporter: 'NotebookLM Takeout 1.8.0', exported: 'EXPORTED-AT' }
    })
  });
  sandbox.chrome.tabs = { query: async () => [{ id: 1, url: 'https://notebooklm.google.com/notebook/x' }] };
  return { sandbox, log, stepsRun };
}

test('Full Takeout writes viewer.html with what was saved, lists it and links it', async () => {
  const { sandbox, log } = takeoutPanel();
  await sandbox.runFullTakeout();
  const html = log.zipped['Book/viewer.html'];
  assert.equal(typeof html, 'string');
  for (const text of ['Book Title', 'EXPORTED-AT', 'source body', 'note body', 'Pretty Audio', 'artifacts/audio/a.m4a']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('IMAGE-TEXT'), '-with-images text is never kept');
  const manifest = JSON.parse(log.zipped['Book/manifest.json']);
  assert.ok(manifest.files.some(f => f.path === 'viewer.html' && f.bytes > 0));
  assert.match(log.zipped['Book/_index.md'], /\(viewer\.html\)/);
  assert.match(log.zipped['Book/_index.html'], /href="viewer\.html"/);
  assert.equal(log.zipped['Book/errors.md'], undefined);
});

test('Full Takeout with ZIP off writes viewer.html into the folder', async () => {
  const { sandbox, log } = takeoutPanel({ zip: false });
  await sandbox.runFullTakeout();
  assert.ok(log.downloads.some(p => p.endsWith('/Book/viewer.html')), log.downloads.join());
  assert.equal(log.zips.length, 0);
});

test('a viewer that cannot be built is an errors.md line, not a failed takeout', async () => {
  const { sandbox, log } = takeoutPanel({ fetchFile: () => ({ ok: false, status: 500 }) });
  await sandbox.runFullTakeout();
  assert.equal(log.zipped['Book/viewer.html'], undefined);
  assert.match(log.zipped['Book/errors.md'], /The offline viewer could not be built/);
  assert.doesNotMatch(log.zipped['Book/_index.md'], /viewer\.html/);
  assert.doesNotMatch(log.zipped['Book/_index.html'], /viewer\.html/);
  assert.ok(!JSON.parse(log.zipped['Book/manifest.json']).files.some(f => f.path === 'viewer.html'));
  assert.equal(log.panels.length, 1);
  assert.ok(log.panels[0].errors.some(e => /offline viewer/.test(e.message)));
  assert.equal(typeof log.zipped['Book/notes/part-2/N.md'], 'string', 'the categories are all there');
});

test('a cancelled takeout still writes a viewer of what exists', async () => {
  const { sandbox, log, stepsRun } = takeoutPanel({ cancelAfter: 'notes' });
  await sandbox.runFullTakeout();
  assert.deepEqual(stepsRun, ['sources', 'notes']);
  const html = log.zipped['Book/viewer.html'];
  assert.ok(html.includes('source body') && html.includes('note body'));
  assert.ok(!html.includes('Pretty Audio'));
});

test('a category that fails leaves the others in the viewer', async () => {
  const { sandbox, log } = takeoutPanel({ notesThrow: true });
  await sandbox.runFullTakeout();
  const html = log.zipped['Book/viewer.html'];
  assert.ok(html.includes('source body') && html.includes('Pretty Audio'));
});
