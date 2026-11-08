// Web sources (1.9.6): a web or web-PDF source shows no type icon in the
// source list, only a favicon whose src carries the original URL
// (https://www.google.com/s2/favicons?domain=<URL-encoded original>). The
// export records source_type "web" / "web_pdf" and source_url; the favicon
// URL itself is never written.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');
require('../takeout-viewer.js');
const V = globalThis.NLMEViewer;

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const fav = value => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(value)}&sz=32`;

const PDF = 'https://builds.openlogicproject.org/content/first-order-logic/completeness/downward-ls.pdf';
const NLAB = 'https://ncatlab.org/nlab/show/L%C3%B6wenheim-Skolem+theorem';

test('sourceUrlFromFavicon decodes the original URL', () => {
  assert.equal(NLME.sourceUrlFromFavicon(fav(PDF)), PDF);
  assert.equal(NLME.sourceUrlFromFavicon(fav(NLAB)), NLAB);
  assert.equal(NLME.sourceUrlFromFavicon(fav('https://en.wikipedia.org/wiki/Skolem%27s_paradox')), 'https://en.wikipedia.org/wiki/Skolem%27s_paradox');
  // a bare host: its root
  assert.equal(NLME.sourceUrlFromFavicon(fav('ncatlab.org')), 'https://ncatlab.org/');
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?domain=ncatlab.org'), 'https://ncatlab.org/');
  assert.equal(NLME.sourceUrlFromFavicon(fav('http://example.org')), 'http://example.org/');
});

test('sourceUrlFromFavicon: anything not http(s), or no domain, is null', () => {
  assert.equal(NLME.sourceUrlFromFavicon(fav('javascript:alert(1)')), null);
  assert.equal(NLME.sourceUrlFromFavicon(fav('ftp://example.org/x')), null);
  assert.equal(NLME.sourceUrlFromFavicon(fav('data:text/html,hi')), null);
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?sz=32'), null);
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?domain='), null);
  assert.equal(NLME.sourceUrlFromFavicon(fav('not a host')), null);
  assert.equal(NLME.sourceUrlFromFavicon(''), null);
  assert.equal(NLME.sourceUrlFromFavicon(null), null);
  assert.equal(NLME.sourceUrlFromFavicon('not a url'), null);
  assert.equal(NLME.sourceUrlFromFavicon('data:image/png;base64,AAAA'), null);
});

test('webSourceType: web_pdf when the path ends in .pdf', () => {
  assert.equal(NLME.webSourceType(PDF), 'web_pdf');
  assert.equal(NLME.webSourceType('https://x.org/a.PDF?dl=1#p2'), 'web_pdf');
  assert.equal(NLME.webSourceType(NLAB), 'web');
  assert.equal(NLME.webSourceType('https://x.org/pdf/view'), 'web');
});

test('sourceTypeFields: a web source gets web/web_pdf and its URL; others as before', () => {
  assert.deepEqual(NLME.sourceTypeFields({ type: 'document', webUrl: PDF }), { sourceType: 'web_pdf', sourceUrl: PDF });
  assert.deepEqual(NLME.sourceTypeFields({ type: 'document', webUrl: NLAB }), { sourceType: 'web', sourceUrl: NLAB });
  // before 1.9.6: the icon, the scan default 'document' left out
  assert.deepEqual(NLME.sourceTypeFields({ type: 'video_youtube' }), { sourceType: 'video_youtube', sourceUrl: null });
  assert.deepEqual(NLME.sourceTypeFields({ type: 'document' }), { sourceType: null, sourceUrl: null });
  assert.deepEqual(NLME.sourceTypeFields({ type: '' }), { sourceType: null, sourceUrl: null });
  assert.deepEqual(NLME.sourceTypeFields({}), { sourceType: null, sourceUrl: null });
});

// sidebar-sources.js's sourceFrontMatter, run as is
function sourceFrontMatter() {
  const src = read('sidebar-sources.js');
  const start = src.indexOf('function sourceFrontMatter(');
  const sandbox = { NLME };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, src.indexOf('\n}\n', start) + 3), sandbox);
  return sandbox.sourceFrontMatter;
}
const META = { notebook: 'New Math', notebook_url: 'u', notebook_id: 'i', exporter: 'e', exported: 'now' };

test('front matter: source_type and source_url for a web source, after the fields before 1.9.6', () => {
  const fm = sourceFrontMatter()(META, { title: 'downward-ls', variant: 'base', sourceType: 'web_pdf', sourceUrl: PDF });
  assert.equal(fm, `---\ntitle: "downward-ls"\nnotebook: "New Math"\nnotebook_url: "u"\nnotebook_id: "i"\nexporter: "e"\nexported: "now"\nkind: "source"\nvariant: "base"\nsource_type: "web_pdf"\nsource_url: "${PDF}"\n---\n\n`);
  assert.doesNotMatch(fm, /favicons/);
});

test('front matter: YouTube and typed sources are byte-identical to 1.9.5', () => {
  const make = sourceFrontMatter();
  assert.equal(make(META, { title: 'T', variant: 'base', youtubeUrl: 'https://youtu.be/x', sourceType: 'video_youtube' }),
    '---\ntitle: "T"\nnotebook: "New Math"\nnotebook_url: "u"\nnotebook_id: "i"\nexporter: "e"\nexported: "now"\nkind: "source"\nvariant: "base"\nyoutube_url: "https://youtu.be/x"\nsource_type: "video_youtube"\n---\n\n');
  assert.equal(make(META, { title: 'T', variant: 'base', sourceType: 'drive_pdf' }),
    '---\ntitle: "T"\nnotebook: "New Math"\nnotebook_url: "u"\nnotebook_id: "i"\nexporter: "e"\nexported: "now"\nkind: "source"\nvariant: "base"\nsource_type: "drive_pdf"\n---\n\n');
  assert.equal(make(META, { title: 'T', variant: 'base' }),
    '---\ntitle: "T"\nnotebook: "New Math"\nnotebook_url: "u"\nnotebook_id: "i"\nexporter: "e"\nexported: "now"\nkind: "source"\nvariant: "base"\n---\n\n');
});

test('sourceOriginalLine: the _index.md line, a link the checker skips', () => {
  assert.equal(NLME.sourceOriginalLine(PDF), `**Original:** [${PDF}](${PDF})\n\n`);
  // parentheses in the target are encoded, the text shows them
  assert.equal(NLME.sourceOriginalLine('https://en.wikipedia.org/wiki/X_(y)'), '**Original:** [https://en.wikipedia.org/wiki/X\\_(y)](https://en.wikipedia.org/wiki/X_%28y%29)\n\n');
  assert.equal(NLME.sourceOriginalLine(null), '');
  assert.equal(NLME.sourceOriginalLine(''), '');
});

test('the scan reads the favicon only where there is no type icon, and keeps only the decoded URL', () => {
  const src = read('content.js');
  const start = src.indexOf('  async function scanForSources(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.match(body, /img\.favicon-icon/);
  assert.match(body, /NLME\.sourceUrlFromFavicon\(/);
  assert.match(body, /if \(!iconEl\)/);
  // the source object never holds the favicon src
  assert.doesNotMatch(body, /favicon: |faviconSrc|\.src\b(?!\))/);
  const sidebar = read('sidebar-sources.js');
  assert.match(sidebar, /NLME\.sourceTypeFields\(source\)/);
  assert.match(sidebar, /sourceUrl: source\.sourceUrl/);
  assert.match(sidebar, /NLME\.sourceOriginalLine\(source\.sourceUrl\)/);
});

test('viewer data: a web source carries its URL; YouTube keeps its own', () => {
  const opts = { notebook: 'N', exported: 'x', exporter: 'e' };
  const d = V.buildViewerData({
    'sources/w.md': `---\ntitle: "W"\nsource_type: "web_pdf"\nsource_url: "${PDF}"\n---\n# W\n\nbody`,
    'sources/y.md': '---\ntitle: "Y"\nyoutube_url: "https://youtu.be/x"\nsource_type: "video_youtube"\n---\n# Y\n\nbody'
  }, opts);
  assert.equal(d.sources.find(s => s.title === 'W').url, PDF);
  assert.equal(d.sources.find(s => s.title === 'W').type, 'web_pdf');
  assert.equal(d.sources.find(s => s.title === 'Y').url, 'https://youtu.be/x');
});

test('viewer: web is the web icon, web_pdf the pdf icon, and a non-YouTube link is not called a video', () => {
  const app = require('../viewer/viewer-app.js');
  assert.equal(app.sourceKind('web', 'Skolem’s paradox', NLAB), 'web');
  assert.equal(app.sourceKind('web_pdf', 'downward-ls', PDF), 'pdf');
  const src = read('viewer/viewer-app.js');
  assert.match(src, /Open original video/);
  assert.match(src, /Open original page/);
});

// ---------- review M1/M2 ----------

test('sourceUrlFromFavicon: the live favicon carries the URL raw; a raw + stays a +', () => {
  // seen live: domain= holds the original URL as is, not percent-encoded
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?domain=https://www.cs.nmsu.edu/historical-projects/Projects/Skolem.pdf&sz=32'),
    'https://www.cs.nmsu.edu/historical-projects/Projects/Skolem.pdf');
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?domain=https://ncatlab.org/nlab/show/L%C3%B6wenheim-Skolem+theorem&sz=32'),
    'https://ncatlab.org/nlab/show/L%C3%B6wenheim-Skolem+theorem');
  // a raw URL with its own query string: up to &sz=
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?domain=https://x.org/a?b=1&c=2&sz=32'), 'https://x.org/a?b=1&c=2');
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?domain=https://x.org/a?b=1&c=2'), 'https://x.org/a?b=1&c=2');
  // encoded (as in chat favicons): decoded once; an encoded + is a +
  assert.equal(NLME.sourceUrlFromFavicon(`https://www.google.com/s2/favicons?domain=${encodeURIComponent('https://ncatlab.org/nlab/show/Skolem+theorem')}&sz=32`),
    'https://ncatlab.org/nlab/show/Skolem+theorem');
  assert.equal(NLME.sourceUrlFromFavicon('https://www.google.com/s2/favicons?sz=32&domain=ncatlab.org'), 'https://ncatlab.org/');
});

test('sourceUrlFromFavicon: Google-hosted download and redirect links are never a source_url', () => {
  for (const url of [
    'https://contribution.usercontent.google.com/download?c=Cgpub3&filename=r.md',
    'https://lh3.googleusercontent.com/abc',
    'https://doc-0k-4c-docs.googleusercontent.com/docs/securesc/x',
    'https://www.google.com/url?q=https://example.org',
    'https://google.com/url?q=x',
    'https://drive.google.com/uc?export=download&id=1',
    'https://docs.google.com/document/d/1/export?format=pdf&download=1'
  ]) {
    assert.equal(NLME.sourceUrlFromFavicon(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(url)}&sz=32`), null, url);
    assert.equal(NLME.sourceUrlFromFavicon(`https://www.google.com/s2/favicons?domain=${url}`), null, `${url} (raw)`);
  }
  // an ordinary Google page is fine
  assert.equal(NLME.sourceUrlFromFavicon(fav('https://research.google.com/pubs/x')), 'https://research.google.com/pubs/x');
});
