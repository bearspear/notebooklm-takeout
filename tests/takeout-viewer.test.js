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
    'sources/a-plus-meta.md': '---\ntitle: "Alpha"\nyoutube_url: "https://y/1"\nsource_type: "video_youtube"\n---\n# A\n\nmeta body',
    'sources/a-with-images.md': '# A\n\nimg body',
    'sources/a-code-blocks.md': '# A\n\ncode body',
    'sources/b.md': '# B\n\nb body',
    'sources/_index.md': 'x'
  }, manifestOpts);
  assert.deepEqual(d.sources.map(s => s.title), ['Alpha', 'b']);
  assert.equal(d.sources[0].url, 'https://y/1');
  assert.equal(d.sources[0].type, 'video_youtube');
  assert.equal(V.buildViewerData({}, { emoji: '♾️' }).emoji, '♾️');
  assert.equal(V.buildViewerData({}).emoji, '');
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

test('wantsText skips code-block variants and files that are not items', () => {
  for (const p of ['chat/chat.md', 'sources/a-plus-meta.md', 'artifacts/t/x.csv', 'part-1/notes/n.md']) assert.equal(V.wantsText(p), true, p);
  for (const p of ['a-code-blocks.md', 'notes/combined-notes.md', 'notes/combined-notes-2.md',
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
      createElement: tag => ({ isText: true, get text() { return `<${tag} class="${this.className}">${this.textContent}</${tag}>`; } }),
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
        setAttribute(k, v) { const a = attrs.find(x => x.name === k); if (a) a.value = v; else attrs.push({ name: k, value: v }); },
        remove() { el.gone = true; },
        replaceWith(t) { el.gone = true; nodes.splice(nodes.indexOf(el) + 1, 0, t); },
        open() { return `<${el.tagName.toLowerCase()}${attrs.map(a => ` ${a.name}="${a.value}"`).join('')}>`; }
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
  const dir = path.join(__dirname, '..', 'viewer');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  for (const f of ['viewer-template.html', 'viewer-app.js']) {
    assert.ok(!/(src|href)="https?:|url\(https?:|@import|fetch\(|XMLHttpRequest/.test(read(f)), f);
  }
  // the three vendored files that assembleViewer inlines
  for (const f of ['katex-inline.css', 'katex.min.js', 'marked.min.js']) {
    assert.ok(!/url\(\s*["']?(https?:)?\/\//i.test(read(f)), `${f}: remote url(`);
    assert.ok(!/@import/.test(read(f)), `${f}: @import`);
  }
  assert.ok(!/(src|href)=["']?https?:/.test(read('katex-inline.css')));
  // KaTeX's parser has a harmless method named fetch(), so only a bare fetch(argument) counts
  for (const f of ['katex.min.js', 'marked.min.js']) {
    assert.ok(!/XMLHttpRequest|(?<![.\w])fetch\s*\(\s*[^)\s]|\b(?:window|self|globalThis)\.fetch\b|new WebSocket|importScripts|sendBeacon|\bimport\s*\(|<script[^>]*\ssrc\s*=/.test(read(f)), `${f}: network call`);
  }
  // and the page as assembled
  const page = V.assembleViewer({ template: read('viewer-template.html'), data: {}, app: read('viewer-app.js'), css: read('katex-inline.css'), katex: read('katex.min.js'), marked: read('marked.min.js') });
  assert.ok(!/(src|href)="https?:|url\(\s*["']?https?:|@import/.test(page));
});

test('literal XMATHX token in text renders as text and never throws', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-app.js'), 'utf8');
  assert.match(src, /m === undefined\) return _;/);
  // same logic as md(): a token beyond the formula count must come back unchanged
  const math = ['$x$'];
  const out = 'a XMATHX7XEND b XMATHX0XEND'.replace(/XMATHX(\d+)XEND/g, (_, i) => { const m = math[+i]; if (m === undefined) return _; return m; });
  assert.equal(out, 'a XMATHX7XEND b $x$');
});

test('viewer data: odd data:image forms go, and unclosed starts stay fast', () => {
  const clean = text => V.buildViewerData({ 'notes/a.md': text }, { notebook: 'N', exported: 'x' });
  for (const html of [
    '<img src="data:image/png;base64, AAAA">',
    '<img src="data:image/svg+xml,%3Csvg%3E">',
    "<img src='data:image/gif;base64,R0lG'>",
    '![a](data:image/png;base64,QUJD)'
  ]) assert.ok(!JSON.stringify(clean(html)).includes('data:image'), html);
  const started = Date.now();
  clean('](data:image/'.repeat(30000));
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test('prose that mentions a data:image uri survives the viewer data intact', () => {
  const text = 'Use `data:image/png;base64,iVBORw0KGgo=` in CSS, then keep going.';
  const md = V.buildViewerData({ 'notes/N.md': `# N\n\n${text}` }, manifestOpts).studio[0].md;
  assert.ok(md.includes(text), md);
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
    'notes/part-1/one-with-images.md': 'skip',
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

test('captureEntry never keeps code-blocks, combined or index text', () => {
  const store = {};
  const huge = 'data:image/png;base64,AAAA';
  const skipped = ['notes/a-code-blocks.md', 'notes/a-code-blocks-with-images.md', 'notes/combined-notes-with-images.md',
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
  const log = { zips: [], downloads: [], direct: [], zipped: {}, compression: {}, panels: [] };
  class JSZip { file(p, d, o) { log.zipped[p] = d; log.compression[p] = o && o.compression; } }
  const sandbox = {
    NLME, NLMEViewer: V, JSZip, Blob, URL, atob, console: { log() {}, warn() {}, error() {} },
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
function takeoutPanel({ zip = true, fetchFile, cancelAfter = null, notesThrow = false, noteImages = '# N\n\nnote body IMAGE-TEXT', chatImages = null, zipMaxBytes = 500 * 1024 * 1024, artifacts = [{ index: 0, label: 'A' }], notesScan = null, record = null } = {}) {
  const readAsset = url => ({ ok: true, text: async () => fs.readFileSync(path.join(ROOT, url.replace('chrome-extension://id/', '')), 'utf8') });
  const { sandbox, log } = sidePanel({ fetchFile: fetchFile || readAsset, downloadItem: () => [{ filename: '/d/x.m4a', state: 'complete' }] });
  let cancelled = false;
  const stepsRun = [];
  const runnerArgs = {};
  const batch = name => async (shell, items, target) => {
    stepsRun.push(name);
    runnerArgs[name] = { items, seedErrors: target.seedErrors };
    if (name === 'notes' && notesThrow) throw new Error('notes broke');
    const info = { multi: name === 'notes', batchIndex: 2, totalBatches: 2, partial: false };
    const prefix = name === 'notes' ? `${target.pathPrefix}part-2/` : target.pathPrefix;
    const files = {
      sources: [{ path: 'S.md', data: '# S\n\nsource body' }],
      notes: [{ path: 'N.md', data: '# N\n\nnote body' }, { path: 'N-with-images.md', data: noteImages }],
      chat: chatImages ? [{ path: 'chat.md', data: '# Chat\n' }, { path: 'chat-with-images.md', data: chatImages }] : [{ path: 'chat.md', data: '# Chat\n' }],
      artifacts: [{ path: 'audio/a.m4a', data: new Uint8Array(1) }, { path: 'manifest.json', data: '{"files":[{"path":"audio/a.m4a","title":"Pretty Audio"}]}' }]
    }[name];
    await sandbox.saveCategoryBatch(shell, files, info, { prefix, zipKind: target.zipKind, folder: target.folder, written: target.written, capture: target.capture });
    if (cancelAfter === name) cancelled = true;
    // Like runExportJob: seed errors lead the runner's errors
    return { result: { exported: items.length ? 1 : 0, failed: 0, cancelled: cancelAfter === name }, errors: [...(target.seedErrors || [])], auditOk: true };
  };
  Object.assign(sandbox, {
    settings: { ...NLME.DEFAULT_SETTINGS, takeoutZip: zip }, exportTimer: { merge() {} }, lastChatScanTiming: null, ARTIFACT_ZIP_MAX_BYTES: zipMaxBytes,
    isNotebookUrl: () => true, ensureContentScriptLoaded: async () => {}, startExportTiming() {}, stampJobKeys() {},
    showToast() {}, timingSummary: () => '', showResults: panel => log.panels.push(panel),
    startJobRecord: async (shell, kind, label, items) => (record ? record(items) : null), newWritten: () => ({ zips: [], count: 0, multi: false, parts: 0 }),
    scanSourcesData: async () => ({ sources: [{}] }), scanNotesData: async () => [{}], scanNotesSettled: notesScan || (async () => [{}]), scanArtifactsData: async () => artifacts,
    scanChatData: async () => ({ messagePairs: [{}], stats: {} }),
    runSourcesJob: batch('sources'), runNotesJob: batch('notes'), runChatJob: batch('chat'), runArtifactsJob: batch('artifacts'),
    withExportShell: (opts, run) => run({
      tab: { id: 1 }, projectName: 'Book', timestamp: 'T', isCancelled: () => cancelled, finishing() {}, progress() {},
      meta: { notebook: 'Book Title', notebook_url: '', notebook_id: '', exporter: 'NotebookLM Takeout 1.8.0', exported: 'EXPORTED-AT' }
    })
  });
  sandbox.chrome.tabs = { query: async () => [{ id: 1, url: 'https://notebooklm.google.com/notebook/x' }] };
  return { sandbox, log, stepsRun, runnerArgs, cancel: () => { cancelled = true; } };
}

test('Full Takeout writes viewer.html with what was saved, lists it and links it', async () => {
  const { sandbox, log } = takeoutPanel();
  await sandbox.runFullTakeout();
  const html = log.zipped['Book/viewer.html'];
  assert.equal(typeof html, 'string');
  for (const text of ['Book Title', 'EXPORTED-AT', 'source body', 'note body', 'Pretty Audio', 'artifacts/audio/a.m4a']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('IMAGE-TEXT'), 'the -with-images text wins');
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
  assert.equal(log.panels[0].level, 'warning');
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

// saveFiles that fails for any batch holding `failing`; what it did save lands in `written`
function failSavesOf(sandbox, failing) {
  const realSave = sandbox.saveFiles;
  const written = {};
  const attempts = [];
  sandbox.saveFiles = async (files, options) => {
    attempts.push([...files].map(f => f.path));
    if (files.some(f => f.path === failing)) throw new Error('disk full');
    const out = await realSave(files, options);
    for (const f of files) written[f.path] = f.data;
    return out;
  };
  return { written, attempts };
}

for (const zip of [true, false]) {
  const mode = zip ? 'ZIP' : 'folder';

  test(`viewer.html that cannot be saved costs nothing else (${mode} mode)`, async () => {
    const { sandbox, log } = takeoutPanel({ zip });
    const { written, attempts } = failSavesOf(sandbox, 'Book/viewer.html');
    await sandbox.runFullTakeout();
    assert.equal(written['Book/viewer.html'], undefined);
    for (const f of ['_index.md', '_index.html', 'manifest.json', 'errors.md']) assert.equal(typeof written[`Book/${f}`], 'string', f);
    assert.match(written['Book/errors.md'], /The offline viewer could not be built/);
    assert.doesNotMatch(written['Book/_index.md'], /viewer\.html/);
    assert.doesNotMatch(written['Book/_index.html'], /viewer\.html/);
    const manifest = JSON.parse(written['Book/manifest.json']);
    assert.ok(!manifest.files.some(f => f.path === 'viewer.html'));
    assert.ok(manifest.files.some(f => f.path === 'errors.md'));
    assert.equal(manifest.errorCount, 1);
    assert.equal(log.panels[0].level, 'warning');
    assert.ok(log.panels[0].errors.some(e => e.type === 'viewer'));
    if (!zip) assert.deepEqual(attempts.filter(a => a.includes('Book/viewer.html')), [['Book/viewer.html']], 'first, alone');
  });

  test(`a root save failure that is not the viewer reports as before (${mode} mode)`, async () => {
    const { sandbox, log } = takeoutPanel({ zip });
    failSavesOf(sandbox, 'Book/_index.md');
    await sandbox.runFullTakeout();
    assert.equal(log.panels.length, 1);
    assert.match(log.panels[0].message, /the takeout index could not be written/);
    assert.equal(log.panels[0].level, 'warning');
    assert.doesNotMatch(log.panels[0].message, /viewer/);
    assert.deepEqual([...log.panels[0].errors], [], 'the viewer is not blamed');
  });
}

test('folder mode: a saved viewer is still claimed, and nothing is saved twice', async () => {
  const { sandbox } = takeoutPanel({ zip: false });
  const { written, attempts } = failSavesOf(sandbox, 'none');
  await sandbox.runFullTakeout();
  const roots = attempts.filter(a => a.some(p => /^Book\/[^/]+$/.test(p)));
  assert.deepEqual(roots.map(a => a[0]), ['Book/viewer.html', 'Book/_index.md']);
  assert.equal(roots.flat().filter(p => p === 'Book/viewer.html').length, 1);
  assert.ok(JSON.parse(written['Book/manifest.json']).files.some(f => f.path === 'viewer.html' && f.bytes > 0));
  assert.match(written['Book/_index.md'], /\(viewer\.html\)/);
});

// ---- final review fixes ----
test('grouped Titles-mode sources (several numbers on one line) become chips in a chat', () => {
  const grouped = NLME.groupedSourcesMarkdown(
    [{ number: 1, text: 'Alpha' }, { number: 2, text: 'Beta' }, { number: 3, text: 'Alpha' }], 'msg-0-');
  const body = '**A:** Claim' + `<sup>${link(1, 'msg-0-src-1')} ${link(2, 'msg-0-src-2')}</sup>` + ' and' +
    `<sup>${link(3, 'msg-0-src-3')}</sup>`;
  const chat = `## Q: Grouped?\n\n${body}\n\n**Sources:**\n\n${grouped}---\n`;
  const d = V.buildViewerData({ 'chat/chat.md': chat }, manifestOpts);
  const a = d.pairs[0].a;
  assert.equal((a.match(/<button class="cite"/g) || []).length, 3, a);
  assert.doesNotMatch(a, /<a |Sources|src-/);
  assert.deepEqual(d.cites, [{ t: 'Alpha', q: '' }, { t: 'Beta', q: '' }]);
  assert.match(a, /data-c="0">1<\/button> <button class="cite" data-c="1">2<\/button>/);
  assert.match(a, /data-c="0">3<\/button>/);
});

test('grouped Titles-mode sources become chips in a note', () => {
  const grouped = NLME.groupedSourcesMarkdown(
    [{ number: 1, text: 'Alpha' }, { number: 2, text: 'Alpha' }], '');
  const note = `# Note\n\nClaim<sup>${link(1, 'src-1')} ${link(2, 'src-2')}</sup>.\n\n---\n\n## Sources\n\n${grouped}`;
  const d = V.buildViewerData({ 'notes/n.md': `---\ntitle: "N"\n---\n${note}` }, manifestOpts);
  const md = d.studio[0].md;
  assert.match(md, /Claim<button class="cite" data-c="0">1<\/button> <button class="cite" data-c="0">2<\/button>\.$/);
  assert.doesNotMatch(md, /<a |Sources|src-/);
  assert.deepEqual(d.cites, [{ t: 'Alpha', q: '' }]);
});

test('sanitizeHtml checks control-character-split script URLs, SVG links, ping, SMIL and background', () => {
  let out = clean('<a href="java\tscript:alert(1)">x</a><a href="jav\nascript:1">y</a>');
  assert.doesNotMatch(out, /script:/i, out);
  out = clean('<a ping="https://x" href="https://y">b</a>');
  assert.doesNotMatch(out, /ping/, out);
  assert.match(out, /href="https:\/\/y"/);
  out = clean('<svg><animate attributeName="href" values="javascript:1"></animate><set to="x"></set><animateTransform></animateTransform><animateMotion></animateMotion></svg>');
  assert.doesNotMatch(out, /<(animate|set)/i, out);
  out = clean('<table background="https://h.example/b.png"><tr><td background="x.png">c</td></tr></table>');
  assert.doesNotMatch(out, /background/, out);
  // anchors get target and rel through setAttribute (the only way on SVG anchors)
  out = clean('<svg><a href="https://y">l</a></svg>');
  assert.match(out, /<a [^>]*href="https:\/\/y"[^>]*target="_blank"[^>]*rel="noopener"/, out);
});

test('assembleViewer escapes <!-- in inlined scripts', () => {
  const out = V.assembleViewer({ template: '/*APP_JS*/', css: '', marked: '', katex: '', app: 'var s = "<!-- x </script>";', data: {} });
  assert.doesNotMatch(out, /<!--/);
  assert.match(out, /<\\!-- x <\\\/script>/);
});

// ---- images: files in the takeout, never data inside viewer.html ----
const b64 = text => Buffer.from(text).toString('base64');
const dataImage = (text, mime = 'image/png', alt = 'A chart') => `![${alt}](data:${mime};base64,${b64(text)})`;
const collector = () => { const added = []; const addImage = (p, base64, mime) => added.push({ p, base64, mime }); return { added, addImage }; };
const front2 = title => `---\ntitle: "${title}"\n---\n`;
const REMOTE = 'https://lh3.googleusercontent.com/notebooklm/abc';

test('extractImages turns an embedded image into a file link', () => {
  const { added, addImage } = collector();
  const out = V.extractImages(`before ${dataImage('one')} after`, addImage);
  assert.equal(added.length, 1);
  assert.match(added[0].p, /^images\/[0-9a-f]{16}\.png$/);
  assert.equal(added[0].base64, b64('one'));
  assert.equal(added[0].mime, 'image/png');
  assert.equal(out, `before ![A chart](${added[0].p}) after`);
});

test('extractImages dedupes the same image across files and keeps different ones apart', () => {
  const { added, addImage } = collector();
  const a = V.extractImages(dataImage('same') + dataImage('same'), addImage);
  const b = V.extractImages(dataImage('same') + dataImage('other'), addImage);
  assert.equal(added.length, 2);
  assert.notEqual(added[0].p, added[1].p);
  assert.ok(a.includes(added[0].p) && b.includes(added[0].p) && b.includes(added[1].p));
});

test('extractImages names a file from its content alone, with the extension of its type', () => {
  const first = collector(), second = collector();
  V.extractImages(dataImage('x'), first.addImage);
  V.extractImages(dataImage('x'), second.addImage);
  assert.equal(first.added[0].p, second.added[0].p);
  const ext = mime => { const c = collector(); V.extractImages(dataImage('x', mime), c.addImage); return c.added[0].p.split('.').pop(); };
  assert.equal(ext('image/jpeg'), 'jpg');
  assert.equal(ext('image/webp'), 'webp');
  assert.equal(ext('image/svg+xml'), 'svg');
  assert.equal(ext('IMAGE/PNG'), 'png');
  assert.equal(ext('image/strange'), 'img');
});

test('extractImages leaves remote images and other text alone', () => {
  const { added, addImage } = collector();
  const text = `![${REMOTE}](${REMOTE}) and ![x](pics/a.png)`;
  assert.equal(V.extractImages(text, addImage), text);
  assert.equal(added.length, 0);
});

test('extractImages handles an alt text with brackets and a data URI with parameters', () => {
  const { added, addImage } = collector();
  const out = V.extractImages(`![fig \\[1\\]](data:image/png;name=a.png;base64,${b64('p')})`, addImage);
  assert.equal(added.length, 1);
  assert.equal(out, `![fig \\[1\\]](${added[0].p})`);
});

test('wantsText accepts -with-images files, not code-blocks ones', () => {
  assert.equal(V.wantsText('notes/a-with-images.md'), true);
  assert.equal(V.wantsText('sources/part-2/b-plus-meta-with-images.md'), true);
  assert.equal(V.wantsText('chat/chat-with-images.md'), true);
  assert.equal(V.wantsText('notes/a-code-blocks.md'), false);
  assert.equal(V.wantsText('notes/a-code-blocks-with-images.md'), false);
  assert.equal(V.wantsText('notes/combined-notes-with-images.md'), false);
});

test('captureEntry holds no base64: the image goes to addImage straight away', () => {
  const store = {};
  const { added, addImage } = collector();
  V.captureEntry(store, 'notes/a-with-images.md', dataImage('pic'), addImage);
  assert.equal(added.length, 1);
  assert.equal(store['notes/a-with-images.md'], `![A chart](${added[0].p})`);
  assert.doesNotMatch(JSON.stringify(store), /base64/);
});

test('captureEntry leaves a file that is not a -with-images file as it is', () => {
  const store = {};
  const { added, addImage } = collector();
  V.captureEntry(store, 'notes/a.md', dataImage('pic'), addImage);
  assert.equal(added.length, 0);
  assert.equal(store['notes/a.md'], dataImage('pic'));
});

test('with-images text wins for notes, sources and chat, and nothing is listed twice', () => {
  const d = V.buildViewerData({
    'notes/part-2/N.md': `${front2('N')}# N\n\nbase note`,
    'notes/part-2/N-with-images.md': `${front2('N')}# N\n\nimage note`,
    'notes/Plain.md': `${front2('Plain')}# Plain\n\nplain note`,
    'sources/S.md': `${front2('S')}# S\n\nbase source`,
    'sources/S-with-images.md': `${front2('S')}# S\n\nimage source`,
    'chat/chat.md': '## Q: One?\n\n**A:** base answer\n',
    'chat/chat-with-images.md': '## Q: One?\n\n**A:** image answer\n'
  }, manifestOpts);
  assert.deepEqual(d.studio.map(s => [s.title, s.md]), [['N', 'image note'], ['Plain', 'plain note']]);
  assert.deepEqual(d.sources.map(s => [s.title, s.md]), [['S', 'image source']]);
  assert.deepEqual(d.pairs.map(p => p.a), ['image answer']);
});

test('a note really named like a variant keeps its own place', () => {
  const d = V.buildViewerData({
    'notes/N.md': `${front2('N')}# N\n\nfirst`,
    'notes/N-with-images.md': `${front2('N with images')}# N with images\n\nsecond`,
    'notes/Solo-with-images.md': `${front2('Solo')}# Solo\n\nthird`
  }, manifestOpts);
  assert.deepEqual(d.studio.map(s => s.md).sort(), ['first', 'second', 'third']);
});

test('a source keeps the summary of its plus-meta file and shows the images of its with-images file', () => {
  const meta = `${front2('S')}# S\n\n## Summary\n\nthe summary\n\n## Content\n\nplain body`;
  const pics = `${front2('S')}# S\n\n## Content\n\n![a](images/0123456789abcdef.png)\nbody`;
  const d = V.buildViewerData({ 'sources/S.md': `${front2('S')}# S\n\n## Content\n\nplain body`, 'sources/S-plus-meta.md': meta, 'sources/S-with-images.md': pics }, manifestOpts);
  assert.equal(d.sources.length, 1);
  assert.equal(d.sources[0].md, '## Summary\n\nthe summary\n\n## Content\n\n![a](images/0123456789abcdef.png)\nbody');
});

test('a plus-meta-with-images file wins over everything for its source', () => {
  const d = V.buildViewerData({
    'sources/S.md': `${front2('S')}# S\n\nbase`,
    'sources/S-plus-meta.md': `${front2('S')}# S\n\nmeta`,
    'sources/S-with-images.md': `${front2('S')}# S\n\nimages`,
    'sources/S-plus-meta-with-images.md': `${front2('S')}# S\n\nboth`
  }, manifestOpts);
  assert.deepEqual(d.sources.map(s => s.md), ['both']);
});

test('base64 never reaches the viewer data', () => {
  const files = {};
  const { added, addImage } = collector();
  for (const [p, text] of [
    ['notes/N.md', `${front2('N')}# N\n\nbase`],
    ['notes/N-with-images.md', `${front2('N')}# N\n\n${dataImage('pic')}`],
    ['sources/S-with-images.md', `${front2('S')}# S\n\n${dataImage('pic2')}`],
    ['chat/chat-with-images.md', `## Q: One?\n\n**A:** ${dataImage('pic3')}\n`]
  ]) V.captureEntry(files, p, text, addImage);
  assert.equal(added.length, 3);
  const json = V.escapeJson(V.buildViewerData(files, manifestOpts));
  assert.doesNotMatch(json, /base64|data:image/);
  for (const a of added) assert.ok(json.includes(a.p), a.p);
});

test('a link to an image that was not saved is emptied, and only then', () => {
  const kept = 'images/aaaaaaaaaaaaaaaa.png', lost = 'images/bbbbbbbbbbbbbbbb.jpg';
  const files = { 'notes/N-with-images.md': `${front2('N')}# N\n\n![one](${kept})\n\n![two](${lost})\n\n![mine](images/fig.png)` };
  assert.equal(V.buildViewerData(files, { savedImages: new Set([kept]) }).studio[0].md, `![one](${kept})\n\n![two]()\n\n![mine](images/fig.png)`);
  assert.ok(V.buildViewerData(files, {}).studio[0].md.includes(lost), 'no list: every link stays');
});

const QUOTE_CHAT = (a, b) => [
  '## Q: One?', '', '**A:** Yes.' + `<sup>${link(1, 'src-1')} ${link(2, 'src-2')}</sup>`, '',
  '**Sources:**', '', `<a id="src-1"></a>\n**[[1]](#ref-src-1)** Alpha\n> before\n>\n> ${a}\n>\n> after\n`, `<a id="src-2"></a>\n**[[2]](#ref-src-2)** Beta\n> ${b}\n`, '---', ''
].join('\n');

test('a citation quote holds text only: its images go to imgs, the ones not available are counted', () => {
  const pic = 'images/cccccccccccccccc.jpg';
  const d = V.buildViewerData({ 'chat/chat-with-images.md': QUOTE_CHAT(`![${REMOTE}](${pic})`, `![${REMOTE}](${REMOTE})`) }, manifestOpts);
  assert.deepEqual(d.cites, [{ t: 'Alpha', q: 'before\n\nafter', imgs: [pic] }, { t: 'Beta', q: '', lost: 1 }]);
});

test('a citation image that was not saved counts as not available', () => {
  const pic = 'images/cccccccccccccccc.jpg';
  const d = V.buildViewerData({ 'chat/chat-with-images.md': QUOTE_CHAT(`![](${pic})`, 'text') }, { savedImages: new Set() });
  assert.deepEqual(d.cites[0], { t: 'Alpha', q: 'before\n\nafter', lost: 1 });
});

test('the citation popover shows images and never a link', () => {
  const html = app.citeHtml({ t: 'A<b', q: 'quote', imgs: ['images/cccccccccccccccc.jpg'], lost: 2 }, true);
  assert.match(html, /<img alt="" src="images\/cccccccccccccccc\.jpg">/);
  assert.match(html, /<span class="no-image">2 images not available offline<\/span>/);
  assert.match(app.citeHtml({ t: 'A', q: '', lost: 1 }, false), /<span class="no-image">Image not available offline<\/span>/);
  assert.match(html, /A&lt;b/);
  assert.match(html, /Click the number/);
  assert.doesNotMatch(app.citeHtml({ t: 'A', q: 'quote' }, false), /<img|not available|Click/);
});

test('citeHtml renders the quote as Markdown when given a renderer', () => {
  const render = q => '<h2>' + q + '</h2>';
  const html = app.citeHtml({ t: 'A<b', q: 'Q&1', imgs: ['images/cccccccccccccccc.jpg'], lost: 1 }, true, render);
  assert.match(html, /^<b>A&lt;b<\/b><div class="md"><h2>Q&1<\/h2><\/div>/);
  assert.doesNotMatch(html, /<p>Q/);
  assert.match(html, /<img alt="" src="images\/cccccccccccccccc\.jpg">/);
  assert.match(html, /Click the number/);
  assert.equal(app.citeHtml({ t: 'A', q: 'x<y' }, false), '<b>A</b><p>x&lt;y</p>');
});

test('the app passes its sanitizing renderer to citeHtml and styles the popup Markdown', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-app.js'), 'utf8'), /citeHtml\(c, srcByTitle\[norm\(c\.t\)\] !== undefined, md\)/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-template.html'), 'utf8');
  assert.match(css, /#pop \.md h1[^{]*\{[^}]*font-size/);
  assert.match(css, /#pop \.md table[^{]*\{[^}]*overflow-x: auto/);
});

test('images/ links survive sanitizeHtml', () => {
  const out = clean('<img src="images/0123456789abcdef.png" alt="A chart">');
  assert.match(out, /<img[^>]*src="images\/0123456789abcdef\.png"/);
  assert.match(out, /alt="A chart"/);
});

test('a URL is never shown as alt text', () => {
  const lost = clean(`<img src="${REMOTE}" alt="${REMOTE}">`);
  assert.doesNotMatch(lost, /https|<img/, lost);
  assert.match(lost, /Image not available offline/);
  const kept = clean(`<img src="images/0123456789abcdef.png" alt="${REMOTE}">`);
  assert.doesNotMatch(kept, /https/, kept);
  assert.match(kept, /src="images\/0123456789abcdef\.png"/);
  assert.match(clean('<img src="https://h.example/a.png" alt="see www.example.org/a">'), /Image not available offline/);
});

test('an image without a file falls to its alt text, else to the placeholder', () => {
  const { marked } = require('../viewer/marked.min.js');
  assert.match(clean(marked.parse('![]()')), /Image not available offline/);
  assert.equal(clean(marked.parse('![A chart]()')).includes('<img'), false);
  assert.match(clean(marked.parse('![A chart]()')), /A chart/);
  assert.match(clean('<img src="https://h.example/a.png">'), /Image not available offline/);
});

test('build_viewer writes images/ beside out, and the page holds none of them', () => {
  const root = makeTakeout();
  fs.writeFileSync(path.join(root, 'notes/My Note Title-with-images.md'), `# My Note Title\n\n${dataImage('picture bytes')}`);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nlme-out-')), 'sub', 'v.html');
  const r = spawnSync(process.execPath, [CLI, root, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 image files/);
  const names = fs.readdirSync(path.join(path.dirname(out), 'images'));
  assert.equal(names.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(out), 'images', names[0]), 'utf8'), 'picture bytes');
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes(`images/${names[0]}`));
  assert.ok(!html.includes(b64('picture bytes')));
  assert.equal(fs.existsSync(path.join(root, 'images')), false, 'the takeout is only read');
});

test('build_viewer writes no images inside ~/Downloads without the flag (fake HOME)', () => {
  const root = makeTakeout();
  fs.writeFileSync(path.join(root, 'notes/My Note Title-with-images.md'), `# My Note Title\n\n${dataImage('pic')}`);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nlme-home-'));
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home });
  const dl = path.join(home, 'Downloads', 'sub', 'v.html');
  assert.notEqual(spawnSync(process.execPath, [CLI, root, dl], { encoding: 'utf8', env }).status, 0);
  assert.ok(!fs.existsSync(path.join(home, 'Downloads')));
  assert.equal(spawnSync(process.execPath, [CLI, root, dl, '--allow-downloads'], { encoding: 'utf8', env }).status, 0);
  assert.equal(fs.readdirSync(path.join(path.dirname(dl), 'images')).length, 1);
});

const imagePath = text => { const c = collector(); V.extractImages(dataImage(text), c.addImage); return c.added[0].p; };
const imageNote = (...texts) => `# N\n\nnote body\n\n${texts.map(t => dataImage(t)).join('\n\n')}`;

test('Full Takeout, ZIP on: images land in their own ZIP, stored, and the viewer links them', async () => {
  const { sandbox, log } = takeoutPanel({ noteImages: imageNote('one', 'two') });
  await sandbox.runFullTakeout();
  const name = 'Book-takeout-images-T.zip';
  assert.ok(log.zips.includes(name), log.zips.join());
  const inZip = `Book/${imagePath('one')}`;
  assert.ok(log.zipped[inZip] instanceof Blob);
  assert.equal(log.zipped[inZip].type, 'image/png');
  assert.equal(log.compression[inZip], 'STORE');
  assert.equal(await log.zipped[inZip].text(), 'one');
  assert.ok(log.zips.indexOf(name) < log.zips.indexOf('Book-takeout-index-T.zip'), 'images first: the viewer must know what was saved');
  const html = log.zipped['Book/viewer.html'];
  assert.ok(html.includes(imagePath('one')) && html.includes(imagePath('two')));
  assert.ok(!html.includes(b64('one')));
  assert.ok(log.panels[0].saved.includes(name));
  assert.equal(log.zipped['Book/errors.md'], undefined);
  assert.ok(!JSON.parse(log.zipped['Book/manifest.json']).files.some(f => f.path.startsWith('images/')));
});

test('Full Takeout, ZIP on: images split near the size cap', async () => {
  const { sandbox, log } = takeoutPanel({ noteImages: imageNote('aaaa', 'bbbb', 'cccc'), zipMaxBytes: 8 });
  await sandbox.runFullTakeout();
  const names = [...log.panels[0].saved].filter(n => n.includes('takeout-images'));
  assert.deepEqual(names, ['Book-takeout-images-T-part1of2.zip', 'Book-takeout-images-T-part2of2.zip']);
  for (const t of ['aaaa', 'bbbb', 'cccc']) assert.ok(log.zipped[`Book/${imagePath(t)}`], t);
});

test('Full Takeout, ZIP on: a takeout without images has no images ZIP', async () => {
  const { sandbox, log } = takeoutPanel();
  await sandbox.runFullTakeout();
  assert.ok(!log.zips.some(n => n.includes('takeout-images')));
});

test('Full Takeout, ZIP on: a cancelled takeout marks its images ZIP partial', async () => {
  const { sandbox, log } = takeoutPanel({ noteImages: imageNote('one'), cancelAfter: 'notes' });
  await sandbox.runFullTakeout();
  assert.ok(log.zips.includes('Book-takeout-images-T-PARTIAL.zip'), log.zips.join());
});

test('Full Takeout, ZIP off: images go to <root>/images/, before viewer.html', async () => {
  const { sandbox, log } = takeoutPanel({ zip: false, noteImages: imageNote('one') });
  await sandbox.runFullTakeout();
  const at = log.downloads.findIndex(p => p.endsWith(`/Book/${imagePath('one')}`));
  assert.ok(at >= 0, log.downloads.join());
  assert.ok(at < log.downloads.findIndex(p => p.endsWith('/Book/viewer.html')));
  assert.ok(!log.zips.length);
  assert.deepEqual([...log.panels[0].saved], ['Book takeout T']);
});

test('images in a citation quote of the chat are saved too', async () => {
  const chat = QUOTE_CHAT(dataImage('quoted'), 'text');
  const { sandbox, log } = takeoutPanel({ chatImages: chat });
  await sandbox.runFullTakeout();
  assert.ok(log.zipped[`Book/${imagePath('quoted')}`]);
  assert.ok(log.zipped['Book/viewer.html'].includes(`"imgs":["${imagePath('quoted')}"]`));
});

test('an image that cannot be decoded costs that image only', async () => {
  const { sandbox, log } = takeoutPanel({ noteImages: `# N\n\nnote body\n\n![bad](data:image/png;base64,A)\n\n${dataImage('good')}` });
  await sandbox.runFullTakeout();
  assert.ok(log.zipped[`Book/${imagePath('good')}`]);
  assert.ok(log.zipped['Book/viewer.html'].includes('![bad]()'), 'its link is gone');
  assert.ok(log.zipped['Book/viewer.html'].includes(imagePath('good')));
});

for (const zip of [true, false]) {
  const mode = zip ? 'ZIP' : 'folder';

  test(`images that cannot be saved cost nothing else, and the viewer links none (${mode} mode)`, async () => {
    const { sandbox, log } = takeoutPanel({ zip, noteImages: imageNote('one') });
    const { written } = failSavesOf(sandbox, `Book/${imagePath('one')}`);
    await sandbox.runFullTakeout();
    for (const f of ['_index.md', '_index.html', 'manifest.json', 'errors.md', 'viewer.html']) assert.equal(typeof written[`Book/${f}`], 'string', f);
    assert.match(written['Book/errors.md'], /images for the offline viewer could not be saved/i);
    assert.ok(!written['Book/viewer.html'].includes(imagePath('one')), 'the link is gone');
    assert.ok(written['Book/viewer.html'].includes('![A chart]()'), 'the placeholder takes over');
    assert.equal(log.panels.length, 1);
    assert.equal(log.panels[0].level, 'warning');
    assert.match(log.panels[0].message, /images could not be saved/);
    assert.ok(log.panels[0].errors.some(e => e.type === 'viewer'));
    assert.ok(!log.panels[0].saved.some(n => n.includes('takeout-images')));
  });
}

test('ZIP mode: one images ZIP that fails leaves the other one and its links', async () => {
  const { sandbox, log } = takeoutPanel({ noteImages: imageNote('aaaa', 'bbbb'), zipMaxBytes: 4 });
  const { written } = failSavesOf(sandbox, `Book/${imagePath('aaaa')}`);
  await sandbox.runFullTakeout();
  const html = written['Book/viewer.html'];
  assert.ok(!html.includes(imagePath('aaaa')));
  assert.ok(html.includes(imagePath('bbbb')));
  assert.deepEqual([...log.panels[0].saved].filter(n => n.includes('takeout-images')), ['Book-takeout-images-T-part2of2.zip']);
  assert.equal(log.panels[0].level, 'warning');
});

test('folder mode: images saved before a failure keep their links', async () => {
  const { sandbox, log } = takeoutPanel({ zip: false, noteImages: imageNote('aaaa', 'bbbb') });
  sandbox.chrome.downloads.download = async o => {
    if (o.filename.endsWith(imagePath('bbbb'))) throw new Error('disk full');
    log.downloads.push(o.filename);
    return 1;
  };
  const { written } = failSavesOf(sandbox, 'none');
  await sandbox.runFullTakeout();
  assert.ok(written['Book/viewer.html'].includes(imagePath('aaaa')));
  assert.ok(!written['Book/viewer.html'].includes(imagePath('bbbb')));
  assert.equal(log.panels[0].level, 'warning');
});

// ---- fix round 1 ----
const PAYLOAD = b64('secret picture bytes');
test('extractImages takes every Markdown form of an embedded image', () => {
  const uri = `data:image/png;base64,${PAYLOAD}`;
  for (const [form, alt] of [
    [`![two\nlines](${uri})`, 'two\nlines'],
    [`![ends in a slash\\](${uri})`, 'ends in a slash\\'],
    [`![t](${uri} "a title")`, 't'],
    [`![t](${uri} 'a title')`, 't'],
    [`![t](${uri} (a title))`, 't'],
    [`![t](<${uri}>)`, 't'],
    [`![t]( ${uri} )`, 't']
  ]) {
    const { added, addImage } = collector();
    const out = V.extractImages(form, addImage);
    assert.equal(added.length, 1, form);
    assert.equal(out, `![${alt}](${added[0].p})`);
  }
});

const LEFTOVERS = [
  `![wrapped](data:image/png;base64,${PAYLOAD.slice(0, 8)}\n${PAYLOAD.slice(8)})`,
  `<img src="data:image/png;base64,${PAYLOAD}">`,
  `<img alt="x" src='data:image/png;base64,${PAYLOAD}'>`,
  `<img src=data:image/png;base64,${PAYLOAD}>`,
  `[link](data:image/png;base64,${PAYLOAD})`,
  `![ref][id]\n\n[id]: data:image/png;base64,${PAYLOAD}`,
  `![t](DATA:IMAGE/PNG;BASE64,${PAYLOAD})`,
  `![t](data:image/svg+xml,${PAYLOAD})`
];

test('extractImages empties what it cannot take, so no store holds image data', () => {
  for (const form of LEFTOVERS) {
    const out = V.extractImages(form, () => {});
    assert.ok(!out.includes(PAYLOAD.slice(8)), out);
    assert.doesNotMatch(out, /data:image/i, out);
  }
});

test('viewer data holds no image data, from any file', () => {
  for (const form of LEFTOVERS) {
    const files = { 'notes/N.md': `${front2('N')}# N\n\n${form}`, 'sources/S.md': `${front2('S')}# S\n\n${form}`, 'chat/chat.md': `## Q: One?\n\n**A:** ${form}\n` };
    const json = V.escapeJson(V.buildViewerData(files, manifestOpts));
    assert.ok(!json.includes(PAYLOAD.slice(8)), form);
    assert.doesNotMatch(json, /data:image/i, form);
  }
});

test('an emptied <img src> falls to the placeholder', () => {
  const md = V.buildViewerData({ 'notes/N.md': `# N\n\n<img src="data:image/png;base64,${PAYLOAD}">` }, manifestOpts).studio[0].md;
  assert.match(clean(md), /Image not available offline/);
});

test('an odd image type never makes an odd file name', () => {
  for (const type of ['constructor', 'toString', '__proto__', 'hasownproperty']) {
    const { added, addImage } = collector();
    V.extractImages(`![a](data:image/${type};base64,${PAYLOAD})`, addImage);
    assert.equal(added.length, 1, type);
    assert.match(added[0].p, /^images\/[0-9a-f]{16}\.img$/);
  }
});

test('a title or a line break in the alt does not hide an image from the saved list or the quote', () => {
  const lost = 'images/bbbbbbbbbbbbbbbb.jpg';
  const files = { 'notes/N-with-images.md': `# N\n\n![two\nlines](${lost})\n\n![t](${lost} "title")` };
  const md = V.buildViewerData(files, { savedImages: new Set() }).studio[0].md;
  assert.ok(!md.includes(lost), md);
  const chat = QUOTE_CHAT(`![${REMOTE}](${REMOTE} "title")`, 'text');
  assert.equal(V.buildViewerData({ 'chat/chat-with-images.md': chat }, manifestOpts).cites[0].lost, 1);
});

const SPAN = t => `<span class="no-image">${t}</span>`;

test('a placeholder is a muted span, and alt text is too', () => {
  assert.ok(clean(`<img src="${REMOTE}">`).includes(SPAN('Image not available offline')));
  assert.ok(clean('<img src="https://h.example/a.png" alt="A chart">').includes(SPAN('A chart')));
  const css = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-template.html'), 'utf8');
  assert.match(css, /\.no-image \{[^}]*color: var\(--muted\)/);
});

test('adjacent placeholders collapse into one, also across paragraphs', () => {
  const one = SPAN('Image not available offline');
  assert.equal(app.collapseNoImage(`${one} ${one}<br>${one}`), SPAN('3 images not available offline'));
  assert.equal(app.collapseNoImage(`<p>${one}</p>\n<p>${one}</p>`), `<p>${SPAN('2 images not available offline')}</p>`);
  assert.equal(app.collapseNoImage(`${SPAN('2 images not available offline')}\n${one}`), SPAN('3 images not available offline'));
  assert.equal(app.collapseNoImage(`${one} text ${one}`), `${one} text ${one}`);
  assert.equal(app.collapseNoImage(`${SPAN('A chart')} ${one}`), `${SPAN('A chart')} ${one}`);
  assert.equal((clean(`<img src="${REMOTE}"> <img src="${REMOTE}">`).match(/not available/g) || []).length, 1);
});

test('a linked image whose file is missing becomes the placeholder', () => {
  const doc = { createElement: () => ({}) };
  const image = src => ({ tagName: 'IMG', getAttribute: () => src, replaced: null, replaceWith(n) { this.replaced = n; } });
  const lost = image('images/0123456789abcdef.png');
  assert.equal(app.replaceFailedImage(lost, doc), true);
  assert.equal(lost.replaced.className, 'no-image');
  assert.equal(lost.replaced.textContent, 'Image not available offline');
  const other = image('artifacts/slides/a.png');
  assert.equal(app.replaceFailedImage(other, doc), false);
  assert.equal(other.replaced, null);
  assert.equal(app.replaceFailedImage({ tagName: 'VIDEO', getAttribute: () => 'images/a.png' }, doc), false);
  assert.equal(app.replaceFailedImage(null, doc), false);
  const src = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-app.js'), 'utf8');
  assert.match(src, /document\.addEventListener\('error', [\s\S]*?\}, true\);/, 'error events do not bubble: capture phase');
});

test('text full of unclosed image marks stays fast', () => {
  const started = Date.now();
  for (const mark of ['![a ', '(data:image/ ', '"data:image/ ']) {
    V.extractImages(mark.repeat(200000), () => {});
    V.buildViewerData({ 'notes/N.md': mark.repeat(200000) }, { savedImages: new Set() });
  }
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
});

// ---- fix round 2 ----
for (const [name, text] of [
  ['before the url', `![a](${' '.repeat(200000)}x`],
  ['after the url', `![a](x${' '.repeat(200000)}y`],
  ['after embedded data', `![a](data:image/png;base64,AAAA${' '.repeat(200000)}x`]
]) {
  test(`a whitespace run ${name} stays fast`, () => {
    const timed = fn => { const started = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - started) / 1e6; };
    const extract = timed(() => V.extractImages(text, () => {}));
    assert.ok(extract < 200, `extractImages: ${extract} ms`);
    const build = timed(() => V.buildViewerData({ 'notes/N.md': text }, { savedImages: new Set() }));
    assert.ok(build < 200, `buildViewerData: ${build} ms`);
  });
}

test('an image with space around its url and title is still one image', () => {
  const lost = 'images/bbbbbbbbbbbbbbbb.jpg';
  for (const form of [`![a](  ${lost}  )`, `![a](${lost}   "t"  )`, `![a](<${lost}>)`]) {
    const md = V.buildViewerData({ 'notes/N.md': `# N\n\n${form}` }, { savedImages: new Set() }).studio[0].md;
    assert.equal(md, '![a]()', form);
  }
  assert.equal(V.buildViewerData({ 'notes/N.md': '# N\n\n![a](   )' }, { savedImages: new Set() }).studio[0].md, '![a](   )');
  const { added, addImage } = collector();
  const out = V.extractImages(`![a](  data:image/png;base64,${PAYLOAD}   "t"  )`, addImage);
  assert.equal(out, `![a](${added[0].p})`);
});

test('a quoted data URI in a sentence leaves the words around it', () => {
  const uri = `data:image/png;base64,${PAYLOAD}`;
  for (const [text, expected] of [
    [`He wrote "${uri}" and then left.`, 'He wrote "" and then left.'],
    [`He wrote "${uri} and then left.`, 'He wrote " and then left.'],
    [`He wrote "${uri} and then left" she said.`, 'He wrote " and then left" she said.'],
    [`It's '${uri}' here, isn't it.`, `It's '' here, isn't it.`],
    ['A "data:image/png" type, and "more" words.', 'A "data:image/png" type, and "more" words.']
  ]) assert.equal(V.extractImages(text, () => {}), expected);
});

test('a quoted data URI wrapped over lines goes whole', () => {
  const out = V.extractImages(`<img src="data:image/png;base64,${PAYLOAD.slice(0, 8)}\n  ${PAYLOAD.slice(8)}"> after`, () => {});
  assert.equal(out, '<img src=""> after');
});

test('folder mode saves each image on its own, so one failed download costs only itself', async () => {
  const { sandbox } = sidePanel();
  const calls = [];
  sandbox.saveFiles = async (files, options) => {
    calls.push([...files].map(f => f.path));
    if (files.some(f => f.path === 'R/images/b.png')) throw new Error('blocked');
    for (const f of files) options.capture(f.path, null);
    return {};
  };
  const images = new Map([['images/a.png', new Blob(['a'])], ['images/b.png', new Blob(['b'])], ['images/c.png', new Blob(['c'])]]);
  const out = await sandbox.saveTakeoutImages(images, { root: 'R', folder: 'T', zipNameFor: () => 'z.zip' });
  assert.deepEqual(calls, [['R/images/a.png'], ['R/images/b.png'], ['R/images/c.png']]);
  assert.deepEqual([...out.paths].sort(), ['images/a.png', 'images/c.png']);
  assert.equal(out.failed, true);
});


// ---- 1.9.5: Export everything skips no-More artifacts and waits for the notes list ----

test('Full Takeout skips a no-More artifact that shares a ready title, exports both ready items, and names the skip in errors.md', async () => {
  const recorded = { failed: [] };
  const record = items => { recorded.items = items; return { fail: (cat, item) => recorded.failed.push([cat, item.index, item.label]), done() {}, commit() {}, discard() {}, finish: async () => {} }; };
  const { sandbox, log, runnerArgs } = takeoutPanel({ record, artifacts: [
    { index: 0, label: 'Deck', type: 'Slides' },
    { index: 1, label: 'Deck', type: 'Slides' },
    { index: -1, label: 'Deck', type: 'Slides' },
    { index: -1, label: 'Fresh', type: 'Report' }
  ] });
  await sandbox.runFullTakeout();
  // The unique-title no-More item is tried, as in 1.9.4
  assert.deepEqual(runnerArgs.artifacts.items.map(i => [i.index, i.label]), [[0, 'Deck'], [1, 'Deck'], [-1, 'Fresh']]);
  const warning = { type: 'skipped_ambiguous', title: 'Deck', message: 'still being generated or has no menu; a ready item has the same title' };
  assert.deepEqual(JSON.parse(JSON.stringify(runnerArgs.artifacts.seedErrors)), [warning]);
  // Kept in the record, as failed, for a later Resume
  assert.deepEqual(JSON.parse(JSON.stringify(recorded.items.artifacts.map(i => [i.index, i.label]))), [[0, 'Deck'], [1, 'Deck'], [-1, 'Fresh'], [-1, 'Deck']]);
  assert.deepEqual(recorded.failed, [['artifacts', -1, 'Deck']]);
  const errors = log.zipped['Book/errors.md'];
  assert.match(errors, /^## Skipped: same title as another item \(1\)\n\n- Artifacts: Deck: still being generated or has no menu; a ready item has the same title$/m);
  assert.match(errors, /^- Artifacts: 1 of 3 \(done, 1 skipped\)$/m);
  const panel = log.panels[0];
  assert.equal(panel.level, 'warning');
  assert.ok(panel.errors.some(e => e.type === 'skipped_ambiguous' && e.title === 'Artifacts: Deck'));
  assert.equal(panel.count.total, 6, 'the skip is in neither N nor M'); // sources, notes, chat 1 each + 3 artifacts
  assert.match(panel.message, /artifacts 1\/3 \(1 skipped\)/);
  const manifest = JSON.parse(log.zipped['Book/manifest.json']);
  assert.equal(manifest.categories.find(c => c.name === 'Artifacts').skipped, 1);
});

test('Full Takeout with nothing skipped hands the runner no warnings, writes no errors.md and no skipped field', async () => {
  const { sandbox, log, runnerArgs } = takeoutPanel();
  await sandbox.runFullTakeout();
  assert.deepEqual(JSON.parse(JSON.stringify(runnerArgs.artifacts.seedErrors)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(runnerArgs.notes.seedErrors)), []);
  assert.equal(log.zipped['Book/errors.md'], undefined);
  assert.ok(JSON.parse(log.zipped['Book/manifest.json']).categories.every(c => !('skipped' in c)));
});

test('Full Takeout with one ready item and its no-More namesake writes the skip, and the category is not "none"', async () => {
  const { sandbox, log, runnerArgs } = takeoutPanel({ artifacts: [{ index: -1, label: 'Deck', type: 'Report' }, { index: 0, label: 'Deck', type: 'Report' }] });
  await sandbox.runFullTakeout();
  assert.deepEqual(JSON.parse(JSON.stringify(runnerArgs.artifacts.items.map(i => i.index))), [0]);
  assert.match(log.zipped['Book/errors.md'], /- Artifacts: Deck: still being generated/);
  assert.doesNotMatch(log.panels[0].message, /artifacts none/);
});

test('Full Takeout tries a lone no-More artifact, as in 1.9.4', async () => {
  const lone = takeoutPanel({ artifacts: [{ index: -1, label: 'Fresh', type: 'Report' }] });
  await lone.sandbox.runFullTakeout();
  assert.deepEqual(JSON.parse(JSON.stringify(lone.runnerArgs.artifacts.items.map(i => i.index))), [-1]);
  assert.equal(lone.log.zipped['Book/errors.md'], undefined);
});

test('Full Takeout skips a no-More artifact whose namesake is a Flashcards or Quiz row with a menu: the title pick lands there', async () => {
  for (const type of ['Flashcards', 'Quiz']) {
    const { sandbox, log, runnerArgs } = takeoutPanel({ artifacts: [{ index: 0, label: 'Deck', type, disabled: true }, { index: -1, label: 'Deck', type: 'Report' }] });
    await sandbox.runFullTakeout();
    assert.deepEqual(JSON.parse(JSON.stringify(runnerArgs.artifacts.items)), [], type);
    assert.match(log.zipped['Book/errors.md'], /^## Skipped: same title as another item \(1\)\n\n- Artifacts: Deck: still being generated/m, type);
    assert.match(log.panels[0].message, /artifacts 0\/0 \(1 skipped\)/, type);
  }
});

test('Full Takeout: notes read without the Studio list are exported with a warning in errors.md', async () => {
  const message = "The Studio list wasn't visible, so notes saved only there may be missing. Close any open Studio item and export again.";
  const { sandbox, log, runnerArgs } = takeoutPanel({ notesScan: async (tabId, { onPartial }) => { onPartial(message); return [{ index: -1, title: 'S', elementType: 'source-note' }]; } });
  await sandbox.runFullTakeout();
  assert.deepEqual(JSON.parse(JSON.stringify(runnerArgs.notes.seedErrors)), [{ type: 'scan_incomplete', message }]);
  assert.match(log.zipped['Book/errors.md'], /^## SCAN INCOMPLETE \(1\)\n\n- Notes: The Studio list wasn't visible/m);
  assert.match(log.panels[0].message, /notes 1\/1/);
});

test('Full Takeout: a notes list that never settles is a failed scan with its reason, not "none in notebook"', async () => {
  const { sandbox, log, stepsRun } = takeoutPanel({ notesScan: async () => { throw new Error('The Studio list did not appear within 8 s. Close any open Studio item (or reload the notebook) and export again'); } });
  await sandbox.runFullTakeout();
  assert.ok(!stepsRun.includes('notes'));
  assert.match(log.zipped['Book/errors.md'], /- Notes: Scan failed: The Studio list did not appear within 8 s\. Close any open Studio item/);
  assert.match(log.panels[0].message, /notes failed/);
  assert.doesNotMatch(log.panels[0].message, /notes none/);
});

test('Full Takeout: a Cancel during the notes wait cancels the takeout, it is not a failed scan', async () => {
  const { sandbox, log, stepsRun, cancel } = takeoutPanel({ notesScan: async (tabId, { isCancelled }) => { cancel(); assert.equal(isCancelled(), true); throw new Error('Cancelled while reading the notes list'); } });
  await sandbox.runFullTakeout();
  assert.deepEqual(stepsRun, []);
  assert.match(log.zipped['Book/errors.md'], /Cancelled by user during the scan/);
  assert.doesNotMatch(log.zipped['Book/errors.md'], /Scan failed/);
});

test('Full Takeout skips two no-More twins, keeps them failed in the record, and tries a lone one', async () => {
  const recorded = { failed: [] };
  const record = items => { recorded.items = items; return { fail: (cat, item) => recorded.failed.push(item.label), done() {}, commit() {}, discard() {}, finish: async () => {} }; };
  const { sandbox, log, runnerArgs } = takeoutPanel({ record, artifacts: [
    { index: -1, label: 'Twin', type: 'Report' }, { index: -1, label: 'Twin', type: 'Report' }, { index: -1, label: 'Solo', type: 'Report' }
  ] });
  await sandbox.runFullTakeout();
  assert.deepEqual(JSON.parse(JSON.stringify(runnerArgs.artifacts.items.map(i => i.label))), ['Solo']);
  assert.deepEqual(recorded.failed, ['Twin', 'Twin']);
  assert.match(log.zipped['Book/errors.md'], /^## Skipped: same title as another item \(2\)\n\n- Artifacts: Twin: still being generated or has no menu; another item being generated has the same title$/m);
  assert.match(log.panels[0].message, /artifacts 1\/1 \(2 skipped\)/);
});

// ---------- offline policy (1.9.6) ----------

// 'self': an export served over http (a local server, a NAS) loads its own files too
const VIEWER_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: file: blob:; media-src 'self' file: blob:; font-src data:; frame-src 'self' file:; object-src 'self' file:";

test('the assembled viewer starts its <head> with the offline Content-Security-Policy', () => {
  const dir = path.join(__dirname, '..', 'viewer');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const page = V.assembleViewer({ template: read('viewer-template.html'), data: {}, app: read('viewer-app.js'), css: read('katex-inline.css'), katex: read('katex.min.js'), marked: read('marked.min.js') });
  const head = /<head>\s*([\s\S]*?)<\/head>/.exec(page)[1];
  assert.equal(head.split('\n')[0], `<meta http-equiv="Content-Security-Policy" content="${VIEWER_CSP}">`);
  assert.equal((page.match(/Content-Security-Policy/g) || []).length, 1);
  // within the first 1024 bytes the charset is still declared
  assert.ok(page.indexOf('<meta charset="utf-8">') < 1024);
});

test('viewer data holds no remote image: Markdown images become the offline placeholder, <img> loses its src, favicons go', () => {
  const d = V.buildViewerData({
    'sources/s.md': '# S\n\nA ![fig](https://lh3.googleusercontent.com/x) b ![](https://x.org/i_(1).png "t")\n\n<img alt="x" src="https://x.org/y.png"> ![](https://www.google.com/s2/favicons?domain=x.org)\n\nkeep ![local](images/0123456789abcdef.png) and [a link](https://x.org)',
    'chat/chat.md': '## Q: Hi\n\n**A:** see ![](http://x.org/a.png)\n'
  }, manifestOpts);
  const all = JSON.stringify(d);
  assert.doesNotMatch(all, /!\[[^\]]*\]\(\s*<?https?:/);
  assert.doesNotMatch(all, /<img[^>]*src=\\?["']?https?:/i);
  assert.doesNotMatch(all, /s2\/favicons/);
  assert.match(d.sources[0].md, /A !\[fig\]\(\) b !\[\]\(\)/);
  assert.match(d.sources[0].md, /<img alt="x" src="">/);
  assert.match(d.sources[0].md, /keep !\[local\]\(images\/0123456789abcdef\.png\) and \[a link\]\(https:\/\/x\.org\)/);
  assert.match(d.pairs[0].a, /see !\[\]\(\)/);
});

test('viewer data without remote images is unchanged by the offline pass', () => {
  const files = { 'sources/s.md': '# S\n\nplain ![l](images/0123456789abcdef.png) [x](https://x.org) `![c](https://x.org/c.png)`' };
  const d = V.buildViewerData(files, manifestOpts);
  assert.equal(d.sources[0].md, 'plain ![l](images/0123456789abcdef.png) [x](https://x.org) `![c](https://x.org/c.png)`');
});

test('mind map files (shown in the viewer\'s frame) make no remote requests', () => {
  for (const f of ['mindmap-extract.js', 'mindmap-template.html']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/https?:\/\/www\.w3\.org\/[\w/.]+/g, '');
    assert.doesNotMatch(src, /@import|url\(\s*["']?https?:|(src|href)\s*=\s*["']https?:|https?:\/\/fonts\./i, f);
  }
});

test('viewer data: a remote <img> inside code stays as written', () => {
  const md = 'Use `<img src="https://x.org/a.png">` like this:\n\n```html\n<img alt="b" src="https://x.org/b.png">\n```\n\n<img alt="c" src="https://x.org/c.png">';
  const out = V.buildViewerData({ 'sources/s.md': `# S\n\n${md}` }, manifestOpts).sources[0].md;
  assert.ok(out.includes('`<img src="https://x.org/a.png">`'), out);
  assert.ok(out.includes('<img alt="b" src="https://x.org/b.png">\n```'), out);
  assert.ok(out.includes('<img alt="c" src="">'), out);
});

test('build_viewer warns when a framed mind map of an older export fetches a web font', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build_viewer.js'), 'utf8');
  assert.match(src, /fonts\\\.googleapis/);
  assert.match(src, /console\.warn\(/);
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /build_viewer\.js[^\n]*web font|web font[^\n]*build_viewer\.js/);
});

// ---------- collapsed Thoughts (1.9.7) ----------

const THOUGHTS_ANSWER = '<details>\n<summary>Thoughts</summary>\n\n**Defining Sizing Concepts**\n\nI am now exploring sizing.\n\n**Searched your sources**\n\n</details>\n\nSizing is the cardinality of a model.';

test('sanitizeHtml keeps <details>/<summary> and strips every attribute, so the section is closed on load', () => {
  assert.equal(clean('<details><summary>Thoughts</summary><p>x</p></details>'), '<details><summary>Thoughts</summary><p>x</p></details>');
  const out = clean('<details open ontoggle="alert(1)" class="c" id="d"><summary onclick="x()" style="color:red" title="t">Thoughts</summary><p title="k">x</p></details>');
  assert.equal(out, '<details><summary>Thoughts</summary><p title="k">x</p></details>');
  assert.doesNotMatch(out, /open|ontoggle|onclick|style/);
});

test('viewer data: an answer with Thoughts keeps the section as written, so Copy gives it as Markdown', () => {
  const chat = ['# Chat', '', '## Q: What does sizing mean?', '', '**A:**', '', THOUGHTS_ANSWER, '', '---', ''].join('\n');
  const d = V.buildViewerData({ 'chat/chat.md': chat }, manifestOpts);
  assert.equal(d.pairs[0].a, THOUGHTS_ANSWER);
  assert.equal(app.copyMarkdown(d.pairs[0].a), THOUGHTS_ANSWER);
});

test('viewer page styles the Thoughts section (muted summary, chevron that turns when open)', () => {
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-template.html'), 'utf8');
  assert.match(tpl, /\.md summary \{[^}]*color: var\(--muted\)/);
  assert.match(tpl, /\.md summary::before \{[^}]*border-right/);
  assert.match(tpl, /\.md details\[open\] > summary::before \{ transform: rotate\(45deg\)/);
  // the rule and indent sit on the open section, so lists and code inside keep their own padding
  assert.match(tpl, /\.md details \{ margin: 0 0 12px; padding-left: 14px; border-left: 3px solid transparent; \}/);
  assert.match(tpl, /\.md details\[open\] \{ border-left-color: var\(--line\); \}/);
  assert.match(tpl, /\.md details > :not\(summary\) \{ color: var\(--muted\); \}/);
  assert.match(tpl, /\.md summary::-webkit-details-marker \{ display: none; \}/);
});

test('Search this chat matches the text, not the Thoughts markup', () => {
  const pairs = [
    { q: 'What does sizing mean?', a: THOUGHTS_ANSWER },
    { q: 'Second?', a: 'A summary of the details.' },
    { q: 'Third?', a: '**Bold** answer about *sizing*' }
  ];
  assert.deepEqual(app.filterPairs(pairs, 'summary'), [1]);
  assert.deepEqual(app.filterPairs(pairs, 'details'), [1]);
  assert.deepEqual(app.filterPairs(pairs, 'Sizing'), [0, 2]);
  assert.deepEqual(app.filterPairs(pairs, 'searched your sources'), [0]);
  assert.deepEqual(app.filterPairs(pairs, 'bold answer'), [2]);
  assert.deepEqual(app.filterPairs(pairs, ''), [0, 1, 2]);
  // the cache gives the same result
  const flat = [];
  assert.deepEqual(app.filterPairs(pairs, 'summary', flat), [1]);
  assert.deepEqual(app.filterPairs(pairs, 'summary', flat), [1]);
  const src = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'viewer-app.js'), 'utf8');
  assert.match(src, /idx = filterPairs\(D\.pairs, q \|\| '', pairText\)/);
});
