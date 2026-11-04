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
