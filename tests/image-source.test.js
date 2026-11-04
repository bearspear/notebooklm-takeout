// Image sources and the citations that point at them (Task 9). Runs the real
// content script and sidebar functions against fake panels and popovers: a real
// popover for an image source has not been reached, so its shape is unproven.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');
const { runExportJob } = require('../takeout-job.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const URL_A = 'https://lh3.googleusercontent.com/notebooklm/ANabc=w512';
const IMAGE_DATA = 'data:image/png;base64,aW1n';

function slice(file, name, end) {
  const src = read(file);
  let start = src.indexOf(`async function ${name}(`);
  if (start < 0) start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  return src.slice(start, src.indexOf(end, start) + end.length);
}
const topLevelFn = (file, name) => slice(file, name, '\n}\n');
const nestedFn = (file, name) => slice(file, name, '\n  }\n');

// ========== Pure parts ==========

test('isImageSourceUrl takes only https lh3 notebooklm images', () => {
  assert.equal(NLME.isImageSourceUrl(URL_A), true);
  assert.equal(NLME.isImageSourceUrl('http://lh3.googleusercontent.com/notebooklm/a'), false);
  assert.equal(NLME.isImageSourceUrl('https://lh3.googleusercontent.com/a/avatar'), false);
  assert.equal(NLME.isImageSourceUrl('https://evil.example/lh3.googleusercontent.com/notebooklm/a'), false);
  assert.equal(NLME.isImageSourceUrl('data:image/png;base64,aa'), false);
  assert.equal(NLME.isImageSourceUrl(''), false);
  assert.equal(NLME.isImageSourceUrl(undefined), false);
});

test('imageSourceUrls keeps notebook images once, in page order', () => {
  assert.deepEqual(NLME.imageSourceUrls([URL_A, 'https://www.gstatic.com/icon.png', `${URL_A}2`, URL_A]), [URL_A, `${URL_A}2`]);
  assert.deepEqual(NLME.imageSourceUrls(null), []);
});

test('imageSourceMarkdown writes the note and an image link the embed pass can match', () => {
  const md = NLME.imageSourceMarkdown('Chart [v2].png', ['https://lh3.googleusercontent.com/notebooklm/a(b)']);
  assert.ok(md.includes(NLME.IMAGE_SOURCE_NOTE));
  assert.ok(md.includes('![Chart v2.png](https://lh3.googleusercontent.com/notebooklm/a%28b%29)'));
  // No text around it may be taken for the link's end
  const link = /!\[([^\]]*)\]\((https:\/\/lh3\.google(?:usercontent)?\.com\/[^\)]+)\)/.exec(md);
  assert.equal(link[2], 'https://lh3.googleusercontent.com/notebooklm/a%28b%29');
});

test('isImageCitation needs a title, no quote, and evidence', () => {
  assert.equal(NLME.isImageCitation({ title: 'Paper', hasImage: true }), true);
  assert.equal(NLME.isImageCitation({ title: 'Paper', knownImageTitles: new Set(['Paper']) }), true);
  assert.equal(NLME.isImageCitation({ title: 'Paper', knownImageTitles: new Set(['Other']) }), false);
  assert.equal(NLME.isImageCitation({ title: 'Paper' }), false);
  assert.equal(NLME.isImageCitation({ title: '', hasImage: true }), false);
  assert.equal(NLME.isImageCitation({ title: 'Chart.png', quoteText: 'x' }), false);
  assert.equal(NLME.isImageCitation({}), false);
});

test('isImageCitation takes each image extension, in any case, at the end only', () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tiff', 'PNG']) {
    assert.equal(NLME.isImageCitation({ title: `Chart.${ext}` }), true, ext);
  }
  for (const title of ['Chart.pdf', 'png', 'Chart.png notes', 'Chart.png.txt']) {
    assert.equal(NLME.isImageCitation({ title }), false, title);
  }
});

test('an image citation keeps its title and note, counts as read, and is not cached', () => {
  const sources = [{ sourceIndex: '1', text: 'Chart.png', quote: NLME.IMAGE_CITATION_NOTE }];
  assert.deepEqual(NLME.buildCitationEntries(sources, ['1']), [
    { number: '1', text: 'Chart.png', quote: NLME.IMAGE_CITATION_NOTE, missing: false }
  ]);
  assert.deepEqual(NLME.citationCoverage({ markerNumbers: ['1'], sources, needQuotes: true }), { expected: 1, written: 1 });
  // A guess from an empty popover is read again next time, never stored
  assert.equal(NLME.citationSourcesComplete(sources, 1), false);
});

// ========== content.js: deciding that a panel is an image source ==========

const TEXT_BODY = '.scroll-container, labs-tailwind-doc-viewer, .ql-editor';

// body: the text the panel's body shows now; images: the img src values
function fakeViewer(state) {
  const log = [];
  const viewer = {
    log,
    querySelector(selector) {
      assert.equal(selector, TEXT_BODY);
      if (state.body == null) return null;
      return {
        textContent: state.body,
        querySelector: () => (state.nestedGuide ? { textContent: state.nestedGuide } : null)
      };
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'img');
      log.push('read images');
      return (state.images || []).map(src => ({ src }));
    }
  };
  return viewer;
}

function sourceWait({ whileWaiting = () => {}, settled = null } = {}) {
  const log = { waits: [], warned: [] };
  const sandbox = {
    NLME,
    console: { log() {}, warn() {}, error() {} },
    // The real wait returns true on stable text, false at the 10 s timeout
    waitForStable: async (measure, options) => {
      log.waits.push(options);
      whileWaiting();
      return settled ? settled(measure()) : measure() >= options.minLength;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`var SOURCE_BODY_WAIT = ${read('content.js').match(/const SOURCE_BODY_WAIT = (\{[^}]*\})/)[1]};`, sandbox);
  vm.runInContext(nestedFn('content.js', 'sourceBodyTextLength'), sandbox);
  vm.runInContext(nestedFn('content.js', 'waitForSourceBody'), sandbox);
  vm.runInContext(nestedFn('content.js', 'recheckImageSource'), sandbox);
  return { sandbox, log };
}

test('an image and no text after the full wait is an image source', async () => {
  const { sandbox, log } = sourceWait();
  const viewer = fakeViewer({ body: '', images: [URL_A, 'https://www.gstatic.com/x.png'] });
  const body = await sandbox.waitForSourceBody(viewer);
  assert.deepEqual(JSON.parse(JSON.stringify(body)), { imageUrls: [URL_A] });
  // Same 10 s wait a text source gets
  assert.equal(log.waits.length, 1);
  assert.equal(log.waits[0].timeout, 10000);
  assert.equal(log.waits[0].minLength, 50);
});

test('the image is looked at only after the wait has run out', async () => {
  const order = [];
  const viewer = fakeViewer({ body: '', images: [URL_A] });
  const original = viewer.querySelectorAll;
  viewer.querySelectorAll = selector => { order.push('images'); return original(selector); };
  const { sandbox } = sourceWait({ whileWaiting: () => order.push('wait') });
  await sandbox.waitForSourceBody(viewer);
  assert.deepEqual(order, ['wait', 'images']);
});

test('text that arrives during the wait is a text source, image or not', async () => {
  const state = { body: '', images: [URL_A] };
  const { sandbox } = sourceWait({ whileWaiting: () => { state.body = 'x'.repeat(5000); } });
  const body = await sandbox.waitForSourceBody(fakeViewer(state));
  assert.deepEqual(JSON.parse(JSON.stringify(body)), { imageUrls: [] });
});

test('a short text under the wait limit stays a text source', async () => {
  const { sandbox } = sourceWait();
  const body = await sandbox.waitForSourceBody(fakeViewer({ body: 'Short note.', images: [URL_A] }));
  assert.deepEqual(JSON.parse(JSON.stringify(body)), { imageUrls: [] });
});

test('no text and no notebook image is still the existing error', async () => {
  const { sandbox } = sourceWait();
  for (const state of [{ body: '', images: [] }, { body: null }, { body: '', images: ['https://www.gstatic.com/icon.png'] }]) {
    const body = await sandbox.waitForSourceBody(fakeViewer(state));
    assert.equal(body.error, 'Source content did not load');
  }
});

test('guide text inside the body is not source text', async () => {
  const guide = 'A generated summary of the picture. '.repeat(5);
  const { sandbox } = sourceWait();
  const viewer = fakeViewer({ body: guide, nestedGuide: guide, images: [URL_A] });
  assert.equal(sandbox.sourceBodyTextLength(viewer), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(await sandbox.waitForSourceBody(viewer))), { imageUrls: [URL_A] });
});

test('text that shows up during the guide wait undoes the image decision', async () => {
  const { sandbox, log } = sourceWait();
  const late = await sandbox.recheckImageSource(fakeViewer({ body: 'x'.repeat(500), images: [URL_A] }), [URL_A]);
  assert.deepEqual(JSON.parse(JSON.stringify(late)), []);
  assert.equal(log.waits.length, 1); // lets the late text settle
});

test('a panel still without text stays an image source, with no second wait', async () => {
  const { sandbox, log } = sourceWait();
  const kept = await sandbox.recheckImageSource(fakeViewer({ body: '', images: [URL_A] }), [URL_A]);
  assert.deepEqual(JSON.parse(JSON.stringify(kept)), [URL_A]);
  assert.equal(log.waits.length, 0);
});

test('extractSourceContent uses the wait, keeps the error, and reports the image urls', () => {
  const code = nestedFn('content.js', 'extractSourceContent');
  assert.match(code, /await waitForSourceBody\(sourceViewer\)/);
  assert.match(code, /if \(body\.error\) return \{ error: body\.error \}/);
  assert.match(code, /await recheckImageSource\(sourceViewer, body\.imageUrls\)/);
  assert.match(code, /if \(imageUrls\.length > 0\) rememberImageSource\(sourceTitle\)/);
  assert.match(code, /\bimageUrls\b[^\n]*\n\s*\};\n/);
});

// ========== content.js: a citation popover with no text ==========

const NOTEBOOK_A = 'https://notebooklm.google.com/notebook/aaaaaaaa-1111';
const NOTEBOOK_B = 'https://notebooklm.google.com/notebook/bbbbbbbb-2222';

function citationPage({ popovers, knownImageTitles = [] }) {
  const page = { hovers: 0, open: null, tracked: [] };
  const el = text => ({ textContent: text });
  const tooltipFor = spec => ({
    querySelector(selector) {
      if (selector === '.citation-tooltip-text') return spec.quote == null ? null : { ...el(spec.quote), querySelectorAll: () => [] };
      if (selector === '.citation-tooltip-header') return spec.title == null ? null : el(spec.title);
      if (selector === '.citation-tooltip-title') return spec.title == null ? null : el(spec.title);
      if (selector === 'img') return spec.img ? {} : null;
      return null;
    }
  });
  const button = {
    getBoundingClientRect: () => ({ width: 10, top: 1, bottom: 2 }),
    closest: () => null,
    scrollIntoView() {},
    dispatchEvent(event) {
      if (event.type === 'mouseenter') page.open = tooltipFor(popovers[Math.min(page.hovers++, popovers.length - 1)]);
      if (event.type === 'mouseleave') page.open = null;
      return true;
    }
  };
  class Ev { constructor(type) { this.type = type; } }
  const sandbox = {
    NLME,
    console: { log() {}, warn() {}, error() {} },
    window: { innerHeight: 100, getComputedStyle: () => ({ opacity: '1' }) },
    document: { body: {}, querySelector: () => page.open, dispatchEvent() {} },
    MouseEvent: Ev, PointerEvent: Ev, KeyboardEvent: Ev,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout, clearTimeout,
    sleep: async () => {},
    waitForElement: async () => page.open,
    location: { href: NOTEBOOK_A },
    DOMHealthTracker: { track: (...args) => page.tracked.push(args) },
    htmlToMarkdownWithImages: async element => element.textContent
  };
  vm.createContext(sandbox);
  vm.runInContext('var knownImageSources = new Map();', sandbox);
  vm.runInContext(nestedFn('content.js', 'rememberImageSource'), sandbox);
  vm.runInContext(nestedFn('content.js', 'imageSourcesHere'), sandbox);
  vm.runInContext(nestedFn('content.js', 'extractSingleCitationWithRetryInner'), sandbox);
  knownImageTitles.forEach(title => sandbox.rememberImageSource(title));
  return { page, sandbox, read: retries => sandbox.extractSingleCitationWithRetryInner(button, '3', false, retries) };
}

test('a title ending .png and no text gives the title and the note, with no error', async () => {
  const { page, read } = citationPage({ popovers: [{ title: 'Chart.png', quote: '' }] });
  const result = await read(2);
  assert.equal(result.success, true);
  assert.equal(result.data.text, 'Chart.png');
  assert.equal(result.data.quote, NLME.IMAGE_CITATION_NOTE);
  assert.equal(result.data.noQuote, true);
  assert.deepEqual([...result.imageFailures], []);
  assert.equal(page.tracked.length, 0);
});

test('an img in the popover and no text gives the note', async () => {
  const result = await citationPage({ popovers: [{ title: 'Holiday snaps', img: true }] }).read(2);
  assert.equal(result.success, true);
  assert.equal(result.data.text, 'Holiday snaps');
  assert.equal(result.data.quote, NLME.IMAGE_CITATION_NOTE);
});

test('a title found to be an image source gives the note', async () => {
  const result = await citationPage({ popovers: [{ title: 'Holiday snaps' }], knownImageTitles: ['Holiday snaps'] }).read(2);
  assert.equal(result.data.quote, NLME.IMAGE_CITATION_NOTE);
});

test('an image title known in one notebook is no evidence in another', async () => {
  const { sandbox, read } = citationPage({ popovers: [{ title: 'Holiday snaps' }], knownImageTitles: ['Holiday snaps'] });
  sandbox.location.href = NOTEBOOK_B;
  const elsewhere = await read(2);
  assert.equal(elsewhere.success, false);
  assert.match(elsewhere.error, /Tooltip content did not load/);
  sandbox.location.href = NOTEBOOK_A;
  assert.equal((await read(2)).data.quote, NLME.IMAGE_CITATION_NOTE);
});

test('a page with no notebook id remembers nothing', async () => {
  const { sandbox, read } = citationPage({ popovers: [{ title: 'Holiday snaps' }] });
  sandbox.location.href = 'https://notebooklm.google.com/';
  sandbox.rememberImageSource('Holiday snaps');
  assert.equal((await read(2)).success, false);
});

test('a fully empty popover stays an error', async () => {
  const { page, read } = citationPage({ popovers: [{}] });
  const result = await read(2);
  assert.equal(result.success, false);
  assert.match(result.error, /Tooltip content did not load/);
  assert.equal(page.tracked.length, 1);
});

test('a title and an empty body with no evidence stays an error', async () => {
  const result = await citationPage({ popovers: [{ title: 'Paper.pdf', quote: '' }] }).read(3);
  assert.equal(result.success, false);
  assert.match(result.error, /Tooltip content did not load/);
});

test('an img with no title stays an error', async () => {
  const result = await citationPage({ popovers: [{ img: true }] }).read(2);
  assert.equal(result.success, false);
});

test('a popover slow to fill gets every retry and keeps its real quote', async () => {
  const { page, read } = citationPage({ popovers: [{ title: 'Chart.png' }, { title: 'Chart.png', quote: 'The real quote.' }] });
  const result = await read(3);
  assert.equal(result.data.quote, 'The real quote.');
  assert.equal(result.data.noQuote, undefined);
  assert.equal(page.hovers, 2);
});

test('a short real quote is a quote', async () => {
  const result = await citationPage({ popovers: [{ title: 'Chart.png', quote: 'Yes.' }] }).read(2);
  assert.equal(result.data.quote, 'Yes.');
});

test('a popover with images and text keeps the text', async () => {
  const result = await citationPage({ popovers: [{ title: 'Paper.pdf', quote: 'Figure one shows it.', img: true }] }).read(2);
  assert.equal(result.data.quote, 'Figure one shows it.');
});

test('the note comes only after the last attempt', async () => {
  const { page, read } = citationPage({ popovers: [{ title: 'Chart.png' }] });
  await read(3);
  assert.equal(page.hovers, 3);
});

test('the health check does not call an image citation a read quote', () => {
  const code = nestedFn('content.js', 'checkCitationWorkflow');
  assert.match(code, /noQuote/);
});

// ========== sidebar: the files of an image source ==========

const imageExtract = { html: '', imageUrls: [URL_A], guideMarkdown: 'A chart of rainfall.', keyTopics: ['Rain'], sources: [] };

function sourcesSidebar({ variant = { exportSourceWithImages: true }, download = async () => IMAGE_DATA } = {}) {
  const log = { converted: 0, downloads: [] };
  const sandbox = {
    NLME,
    console: { log() {}, warn() {}, error() {} },
    settings: {},
    imageSession: null,
    fetchJobImage: url => { log.downloads.push(url); return download(url); },
    convertCounted: (a, h, run) => { log.converted++; return run(); },
    convertToMarkdown: h => h
  };
  vm.createContext(sandbox);
  vm.runInContext(topLevelFn('sidebar-core.js', 'stripImagesFromMarkdown'), sandbox);
  vm.runInContext(topLevelFn('sidebar-core.js', 'reportImageFailures'), sandbox);
  vm.runInContext(topLevelFn('sidebar-sources.js', 'embedImagesInMarkdown'), sandbox);
  vm.runInContext(topLevelFn('sidebar-sources.js', 'buildSourceData'), sandbox);
  const build = async (extract, needsMeta = false, settings = variant) => {
    const warned = [];
    const data = await sandbox.buildSourceData({ title: 'Chart.png' }, extract, { warn: e => warned.push(e) },
      { expected: {}, written: {} }, needsMeta, settings);
    return { data, warned, ...data.versions };
  };
  return { sandbox, log, build };
}

test('an image source with a guide and no text builds a markdown file', async () => {
  const { log, build } = sourcesSidebar();
  const { data, base, withImages, warned } = await build(imageExtract);
  assert.ok(base.startsWith('# Chart.png\n'));
  assert.ok(base.includes(NLME.IMAGE_SOURCE_NOTE));
  assert.doesNotMatch(base, /!\[/);
  assert.ok(withImages.includes(`![Chart.png](${IMAGE_DATA})`));
  assert.equal(data.hasImages, true);
  assert.equal(data.imagesFound, 1);
  assert.equal(data.imagesEmbedded, 1);
  assert.equal(data.summary, 'A chart of rainfall.');
  assert.equal(log.converted, 0); // there is no page HTML to convert
  assert.deepEqual(warned, []);
});

test('the guide of an image source lands in the metadata versions', async () => {
  const { build } = sourcesSidebar({ variant: { exportSourceWithImages: true, exportSourcePlusMetaWithImages: true } });
  const { plusMeta, plusMetaWithImages } = await build(imageExtract, true);
  assert.ok(plusMeta.includes('## Summary\n\nA chart of rainfall.'));
  assert.ok(plusMeta.includes('- Rain'));
  assert.ok(plusMetaWithImages.includes('A chart of rainfall.'));
  assert.ok(plusMetaWithImages.includes(IMAGE_DATA));
});

test('a failed image source download is reported and stays a link', async () => {
  const { build } = sourcesSidebar({ download: async () => { throw new Error('HTTP 403'); } });
  const { withImages, warned } = await build(imageExtract);
  assert.ok(withImages.includes(URL_A));
  assert.equal(warned.length, 1);
  assert.equal(warned[0].type, 'image_download_failed');
  assert.equal(warned[0].source, 'Chart.png');
});

test('an image source says so when no version would hold its image', async () => {
  const { log, build } = sourcesSidebar({ variant: {} });
  const { data, base, warned } = await build(imageExtract);
  assert.ok(base.includes(NLME.IMAGE_SOURCE_NOTE));
  assert.equal(data.hasImages, false);
  assert.deepEqual(log.downloads, []);
  assert.deepEqual(warned.map(w => w.type), ['image_source_not_saved']);
});

test('a text source goes through the converter as before', async () => {
  const { log, build } = sourcesSidebar({ variant: {} });
  const { base, warned } = await build({ html: 'Body text', sources: [] });
  assert.equal(log.converted, 1);
  assert.ok(base.endsWith('## Content\n\nBody text'));
  assert.deepEqual(warned, []);
});

test('the with-images file of an image source gives the viewer a file in images/', async () => {
  const { extractImages } = require('../takeout-viewer.js');
  const { build } = sourcesSidebar();
  const { withImages } = await build(imageExtract);
  const added = [];
  const out = extractImages(withImages, (file, base64, mime) => added.push({ file, base64, mime }));
  assert.equal(added.length, 1);
  assert.match(added[0].file, /^images\/[0-9a-f]{16}\.png$/);
  assert.ok(out.includes(`![Chart.png](${added[0].file})`));
  assert.doesNotMatch(out, /data:image/);
});

// ========== sidebar: the job counts it ==========

async function sourcesJob(extractFor) {
  const titles = Array.from({ length: 17 }, (_, i) => (i === 7 ? 'Chart.png' : `Doc ${i}`));
  const audit = { expected: { items: 0, citations: 0, formulas: 0 }, written: { items: 0, citations: 0, formulas: 0 }, cacheHits: 0, cachedItems: 0 };
  const texts = [];
  const sandbox = {
    NLME: { ...NLME, runExportJob },
    console: { log() {}, warn() {}, error() {} },
    settings: { sourcesPerZip: 25, exportSourceBase: true, exportSourceWithImages: true },
    setTimeout: fn => setTimeout(fn, 0),
    imageSession: null,
    newAudit: () => audit,
    newWritten: () => ({ zips: [], count: 0, multi: false, parts: 0 }),
    beginImageSession() {}, endImageSession() {}, showToast() {}, mergeTiming() {},
    retryOperation: op => op(),
    itemFailed: async (shell, state, message) => { state.failures++; return new Error(message); },
    fetchJobImage: async () => IMAGE_DATA,
    convertCounted: (a, h, run) => run(), convertToMarkdown: h => h,
    auditMarkdown: (title, value) => { texts.push(title); return { text: '' }; },
    buildSourcesFiles: () => [], saveCategoryBatch: async () => {}, batchPrefix: () => '',
    chrome: { tabs: { sendMessage: async (tab, message) => {
      if (message.type !== NLME.MSG.EXTRACT_SOURCE) return { success: true };
      return extractFor(message.data.title);
    } } }
  };
  vm.createContext(sandbox);
  for (const [file, name] of [
    ['sidebar-core.js', 'stripImagesFromMarkdown'], ['sidebar-core.js', 'reportImageFailures'],
    ['sidebar-sources.js', 'embedImagesInMarkdown'], ['sidebar-sources.js', 'buildSourceData'],
    ['sidebar-sources.js', 'extractSourceItem'], ['sidebar-sources.js', 'runSourcesJob']
  ]) vm.runInContext(topLevelFn(file, name), sandbox);
  const shell = { tab: { id: 1 }, isCancelled: () => false, progress() {}, meta: {} };
  const out = await sandbox.runSourcesJob(shell, titles.map((title, index) => ({ title, index })));
  return { out, lines: NLME.auditExport(audit).lines };
}

test('an image source counts as exported: 17 of 17', async () => {
  const { out, lines } = await sourcesJob(title => (title === 'Chart.png'
    ? imageExtract
    : { html: `Text of ${title}`, sources: [] }));
  assert.equal(out.auditOk, true);
  assert.equal(out.result.failed, 0);
  assert.ok(lines.includes('- items: 17 of 17'), lines.join('\n'));
});

test('a real load failure is not exported: 16 of 17 with the existing error', async () => {
  const { out, lines } = await sourcesJob(title => (title === 'Chart.png'
    ? { error: 'Source content did not load' }
    : { html: `Text of ${title}`, sources: [] }));
  assert.equal(out.auditOk, false);
  assert.ok(lines.includes('- ⚠️ items: 16 of 17'), lines.join('\n'));
  assert.match(JSON.stringify(out.errors), /Source content did not load/);
});
