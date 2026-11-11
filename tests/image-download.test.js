// Notebook image downloads (Task 7). Runs the real sidebar and content script
// functions against a stubbed fetch and chrome: real-browser behaviour (cookies,
// CORS, Google's redirects) cannot be proven here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// A top-level sidebar function, or a function nested in content.js's IIFE
function topLevelFn(file, name) {
  const src = read(file);
  let start = src.indexOf(`async function ${name}(`);
  if (start < 0) start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
}
function nestedFn(file, name) {
  const src = read(file);
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  return src.slice(start, src.indexOf('\n  }\n', start) + 5);
}

class FakeFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend();
    });
  }
}

const imageResponse = (type = 'image/png') => ({ ok: true, status: 200, blob: async () => new Blob(['img'], { type }) });
const htmlResponse = () => ({ ok: true, status: 200, blob: async () => new Blob(['<html>Sign in</html>'], { type: 'text/html' })});
const pageImage = { success: true, data: Buffer.from('img').toString('base64'), mime: 'image/jpeg' };
const pageHtml = { success: true, data: Buffer.from('<html>Sign in</html>').toString('base64'), mime: 'text/html' };

// sidebar-takeout.js (fetchDownload) plus the sidebar functions under test
function sidePanel({ fetchImpl, pageResult = { success: false, error: 'HTTP 403' }, extra = {} } = {}) {
  const log = { fetches: [], pageFetches: [], warned: [] };
  const sandbox = {
    NLME, console: { log() {}, warn() {}, error() {} }, URL, Blob, atob, FileReader: FakeFileReader,
    setTimeout, document: {},
    fetch: async (url, options) => { log.fetches.push({ url, options }); return fetchImpl(url); },
    chrome: {
      tabs: {
        query: async () => [{ id: 5 }],
        sendMessage: async (tabId, message) => {
          if (message.type === NLME.MSG.FETCH_FILE) {
            log.pageFetches.push({ tabId, url: message.url });
            return pageResult;
          }
          return extra.tabMessage ? extra.tabMessage(message) : undefined;
        }
      }
    },
    ...extra.globals
  };
  vm.createContext(sandbox);
  vm.runInContext(read('sidebar-takeout.js'), sandbox);
  vm.runInContext(topLevelFn('sidebar-core.js', 'downloadImageAsBase64'), sandbox);
  sandbox.imageSession = null;
  for (const fn of ['beginImageSession', 'endImageSession', 'fetchJobImage']) {
    vm.runInContext(topLevelFn('sidebar-core.js', fn), sandbox);
  }
  return { sandbox, log };
}

test('summarizeImageFailures gives one entry per item that names the count', () => {
  const entries = NLME.summarizeImageFailures([
    { item: 'Venus', url: 'https://a/1', reason: 'HTTP 403' },
    { item: 'Venus', url: 'https://a/2', reason: 'HTTP 403' },
    { item: 'Venus', url: 'https://a/3', reason: 'not an image (text/html)' },
    { item: 'Mars', url: 'https://a/4', reason: 'HTTP 500' }
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'image_download_failed');
  assert.equal(entries[0].source, 'Venus');
  assert.equal(entries[0].count, 3);
  assert.match(entries[0].message, /3 images/);
  assert.match(entries[0].message, /HTTP 403/);
  assert.match(entries[0].message, /1 other reason/);
  assert.equal(entries[0].url, 'https://a/1');
  assert.equal(entries[1].count, 1);
  assert.match(entries[1].message, /Failed to download image: HTTP 500/);
});

test('summarizeImageFailures counts an image once, shortens the url and survives nothing', () => {
  const long = `https://lh3.googleusercontent.com/notebooklm/${'x'.repeat(200)}`;
  const [entry] = NLME.summarizeImageFailures([{ item: 'A', url: long }, { item: 'A', url: long }]);
  assert.equal(entry.count, 1);
  assert.match(entry.message, /unknown error/);
  assert.equal(entry.url, `${long.slice(0, 100)}...`);
  assert.deepEqual(NLME.summarizeImageFailures(undefined), []);
  assert.deepEqual(NLME.summarizeImageFailures([]), []);
});

test('imageBlobProblem accepts only a non-empty image', () => {
  assert.equal(NLME.imageBlobProblem({ type: 'image/webp', size: 3 }), null);
  assert.equal(NLME.imageBlobProblem({ type: 'IMAGE/PNG', size: 3 }), null);
  assert.match(NLME.imageBlobProblem({ type: 'text/html', size: 3 }), /not an image \(text\/html\)/);
  assert.match(NLME.imageBlobProblem({ type: '', size: 3 }), /not an image/);
  assert.match(NLME.imageBlobProblem({ type: 'image/png', size: 0 }), /empty/);
});

test('isAllowedImageUrl adds lh3.google.com, and only for images', () => {
  assert.equal(NLME.isAllowedImageUrl('https://lh3.googleusercontent.com/notebooklm/x'), true);
  assert.equal(NLME.isAllowedImageUrl('https://lh3.google.com/rd-notebooklm/x'), true);
  assert.equal(NLME.isAllowedImageUrl('http://lh3.google.com/x'), false);
  assert.equal(NLME.isAllowedImageUrl('https://evil.com/?q=lh3.google.com'), false);
  assert.equal(NLME.isAllowedImageUrl('https://lh3.google.com.evil.com/x'), false);
  // The download trust list stays as it was
  assert.equal(NLME.isAllowedDownloadUrl('https://lh3.google.com/rd-notebooklm/x'), false);
});

test('downloadImageAsBase64 sends the sign-in and embeds an image', async () => {
  const { sandbox, log } = sidePanel({ fetchImpl: async () => imageResponse() });
  const uri = await sandbox.downloadImageAsBase64('https://lh3.googleusercontent.com/notebooklm/a');
  assert.match(uri, /^data:image\/png;base64,/);
  assert.equal(log.fetches[0].options.credentials, 'include');
  assert.equal(log.pageFetches.length, 0);
});

test('downloadImageAsBase64 accepts lh3.google.com', async () => {
  const { sandbox } = sidePanel({ fetchImpl: async () => imageResponse() });
  assert.match(await sandbox.downloadImageAsBase64('https://lh3.google.com/rd-notebooklm/a'), /^data:image\//);
});

test('downloadImageAsBase64 falls back to the page when the direct fetch throws, in the asking tab', async () => {
  const { sandbox, log } = sidePanel({
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
    pageResult: pageImage
  });
  const uri = await sandbox.downloadImageAsBase64('https://lh3.googleusercontent.com/notebooklm/a', { tabId: 9 });
  assert.match(uri, /^data:image\/jpeg;base64,/);
  assert.deepEqual(log.pageFetches.map(f => f.tabId), [9]);
});

test('a sign-in page from the direct fetch is not embedded: the page fetch still gets its turn', async () => {
  const { sandbox, log } = sidePanel({ fetchImpl: async () => htmlResponse(), pageResult: pageImage });
  const uri = await sandbox.downloadImageAsBase64('https://lh3.googleusercontent.com/notebooklm/a');
  assert.match(uri, /^data:image\/jpeg;base64,/);
  assert.equal(log.pageFetches.length, 1);
});

test('a sign-in page from both fetches is a failure and names the reason', async () => {
  const { sandbox } = sidePanel({ fetchImpl: async () => htmlResponse(), pageResult: pageHtml });
  await assert.rejects(
    sandbox.downloadImageAsBase64('https://lh3.googleusercontent.com/notebooklm/a'),
    /not an image \(text\/html\).*not an image \(text\/html\)/
  );
});

test('a non-OK response is a failure', async () => {
  const { sandbox } = sidePanel({ fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(
    sandbox.downloadImageAsBase64('https://lh3.googleusercontent.com/notebooklm/a'),
    /HTTP 403/
  );
});

test('an image host outside the list is refused before any request carries the sign-in', async () => {
  const { sandbox, log } = sidePanel({ fetchImpl: async () => imageResponse() });
  await assert.rejects(sandbox.downloadImageAsBase64('https://evil.com/a.png'));
  assert.equal(log.fetches.length + log.pageFetches.length, 0);
});

test('fetchDownload is unchanged for artifact downloads: any file type, and no lh3.google.com', async () => {
  const { sandbox } = sidePanel({ fetchImpl: async () => htmlResponse() });
  const blob = await sandbox.fetchDownload('https://lh3.googleusercontent.com/notebooklm/report');
  assert.equal(blob.type, 'text/html');
  await assert.rejects(sandbox.fetchDownload('https://lh3.google.com/rd-notebooklm/a'), /not a Gemini Notebook download URL/);
});

// The embed pass notes and chat share with sources
function loadImagePass(sandbox) {
  vm.runInContext(topLevelFn('sidebar-sources.js', 'embedImagesInMarkdown'), sandbox);
  vm.runInContext(topLevelFn('sidebar-sources.js', 'embedAndReportImages'), sandbox);
  loadLastTry(sandbox);
}
// reportImageFailures and the last try before a package (1.9.15)
function loadLastTry(sandbox) {
  for (const fn of ['reportImageFailures', 'deferImageFailures', 'retryMissingImages', 'addRetriedEmbeds']) {
    vm.runInContext(topLevelFn('sidebar-core.js', fn), sandbox);
  }
}
function loadChat(sandbox) {
  loadImagePass(sandbox);
  vm.runInContext(topLevelFn('sidebar-chat.js', 'readChatPair'), sandbox);
  vm.runInContext(topLevelFn('sidebar-chat.js', 'extractChatPair'), sandbox);
}

function sourcesPanel(fetchImpl) {
  const panel = sidePanel({ fetchImpl });
  vm.runInContext(topLevelFn('sidebar-sources.js', 'embedImagesInMarkdown'), panel.sandbox);
  vm.runInContext(topLevelFn('sidebar-sources.js', 'buildSourceData'), panel.sandbox);
  vm.runInContext(topLevelFn('sidebar-sources.js', 'embedAndReportImages'), panel.sandbox);
  vm.runInContext(topLevelFn('sidebar-sources.js', 'applySourceImageTry'), panel.sandbox);
  loadLastTry(panel.sandbox);
  Object.assign(panel.sandbox, {
    settings: {},
    addContentCoverage() {}, countPageContent: () => ({}), convertCounted: (a, h, run) => run(), convertToMarkdown: h => h,
    stripImagesFromMarkdown: md => md, cleanOcrArtifacts: t => t, cleanOCRArtifacts: t => t, htmlToPlainMarkdown: h => h
  });
  return panel;
}

test('embedImagesInMarkdown keeps a failed image as a link and reports url and reason', async () => {
  const { sandbox } = sourcesPanel(async () => htmlResponse());
  const md = '![a](https://lh3.googleusercontent.com/notebooklm/1) ![b](https://lh3.google.com/rd-notebooklm/2)';
  const out = await sandbox.embedImagesInMarkdown(md, 'Venus');
  assert.equal(out.imagesFound, 2);
  assert.equal(out.imagesEmbedded, 0);
  assert.equal(out.markdown, md);
  assert.deepEqual(JSON.parse(JSON.stringify(out.failures)).map(f => [f.item, f.url]), [
    ['Venus', 'https://lh3.googleusercontent.com/notebooklm/1'],
    ['Venus', 'https://lh3.google.com/rd-notebooklm/2']
  ]);
  assert.match(out.failures[0].reason, /not an image/);
  assert.doesNotMatch(out.markdown, /data:text/);
});

test('embedImagesInMarkdown fetches one image at a time', async () => {
  let active = 0;
  let peak = 0;
  const { sandbox } = sourcesPanel(async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return imageResponse();
  });
  const md = [1, 2, 3].map(n => `![](https://lh3.googleusercontent.com/notebooklm/${n})`).join('\n');
  const out = await sandbox.embedImagesInMarkdown(md, 'Venus');
  assert.equal(out.imagesEmbedded, 3);
  assert.equal(peak, 1);
});

test('reportImageFailures sends one summary per item to the job', () => {
  const { sandbox } = sourcesPanel(async () => imageResponse());
  const warned = [];
  sandbox.reportImageFailures([{ url: 'https://a/1', reason: 'x' }, { url: 'https://a/2', reason: 'x' }], 'Venus', e => warned.push(e));
  assert.equal(warned.length, 1);
  assert.equal(warned[0].type, 'image_download_failed');
  assert.equal(warned[0].source, 'Venus');
  assert.equal(warned[0].count, 2);
  sandbox.reportImageFailures(undefined, 'Venus', e => warned.push(e));
  assert.equal(warned.length, 1);
});

test('a source reports a failure from the plus-meta pass too, once per image', async () => {
  let calls = 0;
  const { sandbox } = sourcesPanel(async url => {
    calls++;
    return url.endsWith('/meta') ? htmlResponse() : imageResponse();
  });
  const original = sandbox.embedImagesInMarkdown;
  const warned = [];
  // Base holds image 1; plus-meta also holds an image of its own
  sandbox.embedImagesInMarkdown = (md, title) => original(md.includes('META')
    ? '![](https://lh3.googleusercontent.com/notebooklm/1) ![](https://lh3.googleusercontent.com/notebooklm/meta)'
    : '![](https://lh3.googleusercontent.com/notebooklm/1)', title);
  const data = {
    html: 'x', markdown: 'body', content: 'body', guideMarkdown: 'META', keyTopics: ['t'], sourceTitle: 'Venus'
  };
  const built = await sandbox.buildSourceData(
    { title: 'Venus', index: 0 }, data, { warn: e => warned.push(e) }, {}, true,
    { exportSourceWithImages: true, exportSourcePlusMetaWithImages: true }
  );
  assert.ok(calls >= 3);
  assert.equal(built.imagesFound, 1);
  assert.equal(warned.filter(e => e.type === 'image_download_failed').length, 0); // kept for the last try
  await sandbox.retryMissingImages([built], { apply: sandbox.applySourceImageTry });
  const images = warned.filter(e => e.type === 'image_download_failed');
  assert.equal(images.length, 1);
  assert.equal(images[0].count, 1);
  assert.match(images[0].url, /\/meta$/);
});

test('a source guide still being written at the cap gets the summary warning', async () => {
  const { sandbox } = sourcesPanel(async () => imageResponse());
  const build = async extra => {
    const warned = [];
    const data = { html: 'x', guideMarkdown: 'Half a sum', keyTopics: [], sourceTitle: 'Venus', ...extra };
    await sandbox.buildSourceData({ title: 'Venus', index: 0 }, data, { warn: e => warned.push(e) }, {}, true,
      { exportSourcePlusMeta: true });
    return warned.filter(e => e.type === 'missing_summary');
  };
  const unsettled = await build({ guideStillChanging: true });
  assert.equal(unsettled.length, 1);
  assert.match(unsettled[0].message, /still being written/);
  assert.equal((await build({})).length, 0);
});

test('a note hands its image failures to the job as one summary', async () => {
  const { sandbox } = sidePanel({
    fetchImpl: async () => imageResponse(),
    extra: {
      tabMessage: () => ({
        html: '<p>x</p>', sources: [], errors: [],
        imageFailures: [{ url: 'https://a/1', reason: 'HTTP 403' }, { url: 'https://a/2', reason: 'HTTP 403' }]
      }),
      globals: {
        settings: { citationDetail: 'quotes' },
        mergeTiming() {}, countPageContent: () => ({ citationNumbers: [] }), convertCounted: (a, h, run) => run(),
        convertToMarkdown: h => h, addCitationCoverage() {}
      }
    }
  });
  loadImagePass(sandbox);
  vm.runInContext(topLevelFn('sidebar-notes.js', 'extractNoteItem'), sandbox);
  const warned = [];
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, { exportNoteWithImages: true });
  assert.equal(warned.length, 0); // kept for the last try before the package
  assert.ok(!Object.keys(note).includes('_imageFailures'));
  await sandbox.retryMissingImages([note]);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].type, 'image_download_failed');
  assert.equal(warned[0].source, 'Note');
  assert.equal(warned[0].count, 2);
});

test('a chat message hands its image failures to the job, not as citation errors', async () => {
  const button = { querySelector: () => ({ textContent: '1', getAttribute: () => '' }) };
  const { sandbox } = sidePanel({
    fetchImpl: async () => imageResponse(),
    extra: {
      tabMessage: () => ({
        sourcesByIndex: { 1: { text: 'S', quote: 'q' } }, errors: [],
        imageFailures: [{ url: 'https://a/1', reason: 'HTTP 403' }, { url: 'https://a/2', reason: 'HTTP 403' }]
      }),
      globals: {
        settings: {}, exportTimer: null, mergeTiming() {}, tallyCitationCache() {},
        convertChatToMarkdown: () => '',
        document: { createElement: () => ({ set innerHTML(v) {}, querySelectorAll: () => [button] }) }
      }
    }
  });
  loadChat(sandbox);
  const warned = [];
  const out = await sandbox.extractChatPair(
    { tab: { id: 5 }, progress() {} }, { userMessage: 'Why?', aiResponseHTML: '' },
    { index: 0, warn: e => warned.push(e) },
    { citationMode: 'quotes', total: 1, variantSettings: { exportNoteWithImages: true } }
  );
  assert.equal(out.stats.failedExtractions, 0);
  assert.equal(warned.length, 0); // kept for the last try before the package
  await sandbox.retryMissingImages([out]);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].type, 'image_download_failed');
  assert.equal(warned[0].userQuestion, 'Why?');
  assert.match(warned[0].message, /2 images/);
});

// content.js's image conversion, on a stand-in element
function contentScript({ sidebarResponse, fetchImpl, isExportCancelled = () => false } = {}) {
  const sandbox = {
    NLME, isExportCancelled, URL, Blob, FileReader: FakeFileReader, console: { log() {}, warn() {}, error() {} },
    NLMEMarkdown: { htmlToMarkdownPlain: element => element.images.map(i => i.src).join(' ') },
    fetch: async url => fetchImpl(url),
    chrome: { runtime: { sendMessage: async () => (typeof sidebarResponse === 'function' ? sidebarResponse() : sidebarResponse) } }
  };
  vm.createContext(sandbox);
  vm.runInContext(nestedFn('content.js', 'imageToBase64'), sandbox);
  vm.runInContext(nestedFn('content.js', 'htmlToMarkdownWithImages'), sandbox);
  return sandbox;
}
const fakeElement = (...srcs) => {
  const images = srcs.map(src => ({ src, setAttribute(name, value) { if (name === 'src') this.src = value; } }));
  return { images, querySelectorAll: () => images };
};
const REMOTE = 'https://lh3.googleusercontent.com/notebooklm/a';

test('content script embeds what the side panel returns', async () => {
  const sandbox = contentScript({ sidebarResponse: { success: true, dataUri: 'data:image/png;base64,AA' } });
  const failures = [];
  const md = await sandbox.htmlToMarkdownWithImages(fakeElement(REMOTE), true, failures);
  assert.equal(md, 'data:image/png;base64,AA');
  assert.deepEqual(failures, []);
});

test('content script reports a side panel failure and keeps the link', async () => {
  const sandbox = contentScript({ sidebarResponse: { success: false, error: 'Fetch failed: HTTP 403' } });
  const failures = [];
  const md = await sandbox.htmlToMarkdownWithImages(fakeElement(REMOTE), true, failures);
  assert.equal(md, REMOTE);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].url, REMOTE);
  assert.equal(failures[0].reason, 'Fetch failed: HTTP 403');
});

test('content script reports a closed side panel and a rejected message', async () => {
  const none = contentScript({ sidebarResponse: undefined });
  const failures = [];
  await none.htmlToMarkdownWithImages(fakeElement(REMOTE), true, failures);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].reason);

  const rejected = contentScript({ sidebarResponse: () => { throw new Error('Receiving end does not exist'); } });
  const more = [];
  await rejected.htmlToMarkdownWithImages(fakeElement(REMOTE), true, more);
  assert.match(more[0].reason, /Receiving end/);
});

test('content script never embeds a non-image from a host it fetches itself', async () => {
  const OTHER = 'https://images.example.com/a.png';
  for (const [response, reason] of [[htmlResponse(), /not an image/], [{ ok: false, status: 404 }, /HTTP 404/]]) {
    const sandbox = contentScript({ fetchImpl: async () => response });
    const failures = [];
    const md = await sandbox.htmlToMarkdownWithImages(fakeElement(OTHER), true, failures);
    assert.equal(md, OTHER);
    assert.match(failures[0].reason, reason);
  }
});

test('content script reports an oversized image instead of keeping the link silently', async () => {
  const OTHER = 'https://images.example.com/a.png';
  const big = { ok: true, status: 200, blob: async () => new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/png' }) };
  const sandbox = contentScript({ fetchImpl: async () => big });
  const failures = [];
  await sandbox.htmlToMarkdownWithImages(fakeElement(OTHER), true, failures);
  assert.match(failures[0].reason, /too large/);
});

test('a lookalike url goes to the plain fetch, never to the signed-in side panel', async () => {
  const OTHER = 'https://evil.com/google.com/a.png';
  const sandbox = contentScript({
    sidebarResponse: () => { throw new Error('side panel used'); },
    fetchImpl: async () => imageResponse()
  });
  const failures = [];
  const md = await sandbox.htmlToMarkdownWithImages(fakeElement(OTHER), true, failures);
  assert.match(md, /^data:image\/png/);
  assert.deepEqual(failures, []);
});

test('content script passes image failures from a citation to the job', () => {
  const inner = nestedFn('content.js', 'extractSingleCitationWithRetryInner');
  assert.match(inner, /const imageFailures = \[\];/);
  assert.match(inner, /htmlToMarkdownWithImages\(textEl, includeImages, imageFailures\)/);
  assert.match(inner, /htmlToMarkdownWithImages\(element, includeImages, imageFailures\)/);
  assert.match(inner, /sourceIndex: spanIndex \},\s+imageFailures\s+\}/);
  const tailwind = nestedFn('content.js', 'extractTailwindNoteCitations');
  assert.match(tailwind, /imageFailures\.push\(\.\.\.result\.imageFailures\)/);
  assert.match(tailwind, /imageFailures\s*\n?\s*\}/);
  const chat = nestedFn('content.js', 'extractMessageCitations');
  assert.match(chat, /imageFailures\.push\(\.\.\.result\.imageFailures\)/);
});

test('applyImageEmbeds swaps image urls only, and is safe with no embeds', () => {
  const url = 'https://lh3.googleusercontent.com/notebooklm/a';
  const embeds = new Map([[url, 'data:image/png;base64,$&AA']]);
  assert.equal(
    NLME.applyImageEmbeds(`![x](${url}) [link](${url}) ![y](https://lh3.google.com/other)`, embeds),
    `![x](data:image/png;base64,$&AA) [link](${url}) ![y](https://lh3.google.com/other)`
  );
  assert.equal(NLME.applyImageEmbeds('![x](u)', null), '![x](u)');
  assert.equal(NLME.applyImageEmbeds('![x](u)', new Map()), '![x](u)');
});

test('embedImagesInMarkdown downloads a repeated image once and returns what it embedded', async () => {
  let calls = 0;
  const { sandbox } = sourcesPanel(async () => { calls++; return imageResponse(); });
  const url = 'https://lh3.googleusercontent.com/notebooklm/1';
  const out = await sandbox.embedImagesInMarkdown(`![a](${url}) ![b](${url})`, 'T');
  assert.equal(calls, 1);
  assert.equal(out.imagesEmbedded, 2);
  assert.doesNotMatch(out.markdown, /https:/);
  assert.match(out.embeds.get(url), /^data:image\/png/);
});

const OK_URL = 'https://lh3.googleusercontent.com/notebooklm/ok';
const BAD_URL = 'https://lh3.googleusercontent.com/notebooklm/bad';
// The <img> is what NLME.noteHasImages looks for in a note's HTML
const BODY = `<img alt=""> Intro ![fig](${OK_URL}) mid ![fig2](${BAD_URL}) ![fig3](${BAD_URL}2) end`;
const byUrl = async url => (url === OK_URL ? imageResponse() : { ok: false, status: 403 });
const imagesGone = md => assert.doesNotMatch(md, /!\[|data:|https:/);

function notesPanel({ fetchImpl = byUrl, noteData, notesSettings = { exportNoteWithImages: true } } = {}) {
  const downloads = [];
  const toasts = [];
  const panel = sidePanel({
    fetchImpl,
    extra: {
      tabMessage: message => (message.type === NLME.MSG.EXTRACT_NOTE ? noteData : undefined),
      globals: {
        settings: { citationDetail: 'quotes', ...notesSettings },
        mergeTiming() {}, countPageContent: () => ({ citationNumbers: [] }), convertCounted: (a, h, run) => run(),
        convertToMarkdown: h => h, addCitationCoverage() {}, tallyCitationCache() {},
        noteFrontMatter: () => '', timingSummary: () => '', variantName: suffix => suffix.replace('-', '') || 'base',
        stripImagesFromMarkdown: md => md.replace(/!\[([^\]]*)\]\([^\)]+\)/g, ''),
        isNotebookUrl: () => true, ensureContentScriptLoaded: async () => {},
        getProjectName: async () => 'P', showToast: (text, level) => toasts.push([text, level]),
        downloadBlob: async (blob, name) => downloads.push([name, await blob.text()])
      }
    }
  });
  const { sandbox } = panel;
  sandbox.chrome.tabs.query = async () => [{ id: 5, url: 'https://notebooklm.google.com/notebook/1' }];
  sandbox.chrome.runtime = { getManifest: () => ({ version: '1' }) };
  loadImagePass(sandbox);
  vm.runInContext(topLevelFn('sidebar-notes.js', 'extractNoteItem'), sandbox);
  vm.runInContext(topLevelFn('sidebar-notes.js', 'getEnabledNoteVersions'), sandbox);
  vm.runInContext(topLevelFn('sidebar-notes.js', 'exportSingleNote'), sandbox);
  // exportSingleNote starts its own session with the real sleep; the 403
  // backoffs it would wait out (5 s, 15 s per image) are not what these tests check
  const begin = sandbox.beginImageSession;
  sandbox.beginImageSession = (tabId, isCancelled, sleep = null) => begin(tabId, isCancelled, sleep || (async () => {}));
  vm.runInContext(topLevelFn('sidebar-notes.js', 'buildNotesFiles'), sandbox);
  return { ...panel, downloads, toasts };
}
const META = { notebook: 'P', exported: 'now' };

test('a note body image reaches the with-images files, and base files stay byte-identical', async () => {
  const { sandbox, log } = notesPanel({ noteData: { html: BODY, sources: [], errors: [] } });
  const warned = [];
  const settingsOn = { exportNoteWithImages: true, exportNoteCodeBlocks: true };
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, settingsOn);
  await sandbox.retryMissingImages([note]);

  const quote = [{ text: 'S', quote: 'q' }];
  const files = sandbox.buildNotesFiles([{ ...note, sources: quote }], { meta: META, variantSettings: settingsOn });
  const data = name => files.find(f => f.path === name).data;
  for (const name of ['notes/Note-with-images.md', 'combined-notes-with-images.md']) {
    assert.match(data(name), /!\[fig\]\(data:image\/png;base64,/, name);
    assert.ok(data(name).includes(`[fig2](${BAD_URL})`), `${name} keeps the failed image as a plain link (1.9.6)`);
  }
  const without = sandbox.buildNotesFiles([{ ...note, sources: quote, imageEmbeds: null }], { meta: META, variantSettings: settingsOn });
  const unstamped = text => text.replace(/^Exported: .*$/m, '');
  for (const name of ['notes/Note.md', 'notes/Note-code-blocks.md', 'combined-notes.md', 'combined-notes-code-blocks.md']) {
    imagesGone(data(name).replace(/^Exported: .*$/m, ''));
    assert.equal(unstamped(data(name)), unstamped(without.find(f => f.path === name).data), name);
  }

  assert.equal(warned.length, 1);
  assert.equal(warned[0].type, 'image_download_failed');
  assert.equal(warned[0].source, 'Note');
  assert.equal(warned[0].count, 2);
  // Sequential: every request in document order
  assert.deepEqual(log.fetches.slice(0, 2).map(f => f.url), [OK_URL, BAD_URL]);
});

test('a note runs no embed pass with image versions off', async () => {
  const { sandbox, log } = notesPanel({ noteData: { html: BODY, sources: [], errors: [] }, notesSettings: { exportNoteWithImages: false } });
  const warned = [];
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, { exportNoteWithImages: false });
  assert.equal(log.fetches.length, 0);
  assert.equal(warned.length, 0);
  assert.ok(!note.imageEmbeds);
});

test('a note from the citation cache still gets its body images', async () => {
  const { sandbox } = notesPanel({ noteData: { html: BODY, sources: [], errors: [], fromCache: true } });
  const warned = [];
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, { exportNoteWithImages: true });
  assert.ok(note.imageEmbeds.has(OK_URL));
  await sandbox.retryMissingImages([note]);
  assert.equal(warned.length, 1);
});

test('a citation image that failed in the page counts once, or not at all if the pass gets it', async () => {
  const { sandbox } = notesPanel({
    noteData: {
      html: BODY, sources: [], errors: [],
      imageFailures: [{ url: OK_URL, reason: 'HTTP 500' }, { url: BAD_URL, reason: 'HTTP 403' }]
    }
  });
  const warned = [];
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, { exportNoteWithImages: true });
  await sandbox.retryMissingImages([note]);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].count, 2); // BAD_URL and BAD_URL2; OK_URL recovered
  assert.doesNotMatch(warned[0].message, /HTTP 500/);
});

test('a single note download embeds body images and shows its failures', async () => {
  const { sandbox, downloads, toasts } = notesPanel({ noteData: { html: BODY, sources: [], errors: [] } });
  await sandbox.exportSingleNote({ title: 'Note', index: 0 });
  await new Promise(resolve => setTimeout(resolve, 5));
  const withImages = downloads.find(([name]) => /with-images/.test(name))[1];
  const base = downloads.find(([name]) => !/with-images/.test(name))[1];
  assert.match(withImages, /!\[fig\]\(data:image\/png/);
  assert.ok(withImages.includes(`[fig2](${BAD_URL})`));
  imagesGone(base);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /Note: Failed to download 2 images/);
  assert.equal(toasts[0][1], 'warning');
});

function chatPanel({ fetchImpl = byUrl, chatResponse } = {}) {
  const button = { querySelector: () => ({ textContent: '1', getAttribute: () => '' }) };
  const panel = sidePanel({
    fetchImpl,
    extra: {
      tabMessage: () => chatResponse,
      globals: {
        settings: {}, exportTimer: null, mergeTiming() {}, tallyCitationCache() {}, logger: { info() {} },
        document: { createElement: () => ({ set innerHTML(v) {}, querySelectorAll: () => [button] }) },
        convertChatToMarkdown: (t, s, messages) => messages.map(m => m.aiResponseHTML).join('\n'),
        stripImagesFromMarkdown: md => md.replace(/!\[([^\]]*)\]\([^\)]+\)/g, ''),
        timingSummary: () => '', variantName: suffix => suffix.replace('-', '') || 'base'
      }
    }
  });
  loadChat(panel.sandbox);
  vm.runInContext(read('sidebar-chat.js').match(/const CHAT_VERSION_INFO = \{[\s\S]*?\n\};\n/)[0].replace('const ', 'var '), panel.sandbox);
  vm.runInContext(topLevelFn('sidebar-chat.js', 'buildChatFiles'), panel.sandbox);
  return panel;
}
const CHAT_META = { notebook: 'P', notebook_url: 'u', notebook_id: 'i', exporter: 'e', exported: 'now' };
const chatFilesFor = (sandbox, messages, on) => sandbox.buildChatFiles(messages, {
  meta: CHAT_META, chatData: { notebookTitle: 'P' }, auditDoc: { ok: true, text: '' }, forceZip: false,
  errors: [{ type: 'x', message: 'y' }], variantSettings: { exportNoteWithImages: on, exportNoteCodeBlocks: false }
}).files;

for (const citationMode of ['quotes', 'titles', 'none']) {
  test(`a chat body image reaches chat-with-images only (${citationMode})`, async () => {
    const { sandbox } = chatPanel({ chatResponse: { sourcesByIndex: { 1: { text: 'S', quote: 'q' } }, errors: [] } });
    const warned = [];
    const on = { exportNoteWithImages: true };
    const message = await sandbox.extractChatPair(
      { tab: { id: 5 }, progress() {} }, { userMessage: 'Why?', aiResponseHTML: BODY },
      { index: 0, warn: e => warned.push(e) }, { citationMode, total: 1, variantSettings: on }
    );
    await sandbox.retryMissingImages([message]);
    assert.equal(warned.length, 1);
    assert.equal(warned[0].type, 'image_download_failed');
    assert.equal(warned[0].userQuestion, 'Why?');
    assert.equal(warned[0].messageIndex, 1);
    assert.match(warned[0].message, /2 images/);

    const files = chatFilesFor(sandbox, [message], true);
    const data = name => files.find(f => f.path === name).data;
    assert.match(data('chat-with-images.md'), /!\[fig\]\(data:image\/png/);
    assert.ok(data('chat-with-images.md').includes(`[fig2](${BAD_URL})`));
    const without = chatFilesFor(sandbox, [{ ...message, imageEmbeds: null }], true);
    assert.equal(data('chat.md'), without.find(f => f.path === 'chat.md').data);
    assert.doesNotMatch(data('chat.md'), /!\[|data:image/);
  });
}

test('chat runs no embed pass with image versions off', async () => {
  const { sandbox, log } = chatPanel({ chatResponse: { sourcesByIndex: {}, errors: [] } });
  const warned = [];
  const message = await sandbox.extractChatPair(
    { tab: { id: 5 }, progress() {} }, { userMessage: 'Why?', aiResponseHTML: BODY },
    { index: 0, warn: e => warned.push(e) }, { citationMode: 'none', total: 1, variantSettings: {} }
  );
  assert.equal(log.fetches.length, 0);
  assert.equal(warned.length, 0);
  assert.ok(!message.imageEmbeds);
});

test('a chat message whose citations failed outright still gets its body images', async () => {
  const { sandbox } = chatPanel({ chatResponse: undefined });
  sandbox.chrome.tabs.sendMessage = async () => { throw new Error('tab gone'); };
  const warned = [];
  const message = await sandbox.extractChatPair(
    { tab: { id: 5 }, progress() {} }, { userMessage: 'Why?', aiResponseHTML: BODY },
    { index: 0, warn: e => warned.push(e) }, { citationMode: 'quotes', total: 1, variantSettings: { exportNoteWithImages: true } }
  );
  assert.ok(message.imageEmbeds.has(OK_URL));
  await sandbox.retryMissingImages([message]);
  assert.ok(warned.some(e => e.type === 'image_download_failed'));
});

test('with image versions on, chat and notes never read the citation cache', () => {
  assert.match(read('sidebar-chat.js'), /const cacheOn = settings\.reuseCitations !== false && !variantSettings\.exportNoteWithImages;/);
  assert.match(read('content.js'), /const cacheUsable = reuseCitations && !includeCitationImages && buttonsByIndex\.size > 0;/);
});

// ---- Task 7b: safeguards ----

// A session around a scripted download. script(url, callNumber) returns a data
// URI or throws; sleeps are recorded, never waited.
function imageSession({ script, isCancelled, now } = {}) {
  const calls = [];
  const sleeps = [];
  const session = NLME.createImageSession({
    download: async url => { calls.push(url); return script(url, calls.length); },
    sleep: async ms => { sleeps.push(ms); },
    isCancelled,
    now
  });
  return { session, calls, sleeps };
}
const http = (status, retryAfter = null) => Object.assign(new Error(`Fetch failed: HTTP ${status}`), { status, retryAfter });
const fails = (promise, pattern = /./) => assert.rejects(promise, pattern);

test('retryAfterMs reads seconds and dates, and ignores anything else', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  assert.equal(NLME.retryAfterMs('7', now), 7000);
  assert.equal(NLME.retryAfterMs('0', now), 0);
  assert.equal(NLME.retryAfterMs('Wed, 04 Nov 2026 12:00:05 GMT', now), 5000);
  assert.equal(NLME.retryAfterMs('Wed, 04 Nov 2026 11:00:00 GMT', now), 0);
  for (const none of [null, undefined, '', 'soon', '-3']) assert.equal(NLME.retryAfterMs(none, now), null);
});

test('a 429 retries after 2 s, and a success ends it', async () => {
  const { session, calls, sleeps } = imageSession({ script: (u, n) => { if (n === 1) throw http(429); return 'data:image/png;base64,A'; } });
  assert.equal(await session.get('u'), 'data:image/png;base64,A');
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('a 503 retries twice, 2 s then 4 s, then fails with its reason', async () => {
  const { session, calls, sleeps } = imageSession({ script: () => { throw http(503); } });
  await fails(session.get('u'), /HTTP 503/);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 4000]);
});

test('Retry-After replaces the backoff', async () => {
  const { session, sleeps } = imageSession({ script: (u, n) => { if (n < 3) throw http(429, n === 1 ? '7' : '1'); return 'x'; } });
  await session.get('u');
  assert.deepEqual(sleeps, [7000, 1000]);
});

test('a Retry-After too long to wait fails the image without asking again early', async () => {
  const { session, calls, sleeps } = imageSession({ script: () => { throw http(429, '3600'); } });
  await fails(session.get('u'));
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('other failures do not retry', async () => {
  for (const error of [http(404), http(403), http(500), new Error('Failed to fetch')]) {
    const { session, calls, sleeps } = imageSession({ script: () => { throw error; } });
    await fails(session.get('u'));
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  }
});

test('no delay between successful downloads', async () => {
  const { session, sleeps } = imageSession({ script: url => `data:${url}` });
  for (const url of ['a', 'b', 'c']) await session.get(url);
  assert.deepEqual(sleeps, []);
});

const limitedSleeps = n => Array.from({ length: n }, () => [2000, 4000]).flat();

test('5 limited images pause 30 s once; limiting on means the rest are skipped, in one summary', async () => {
  const { session, calls, sleeps } = imageSession({ script: () => { throw http(429); } });
  for (const url of ['1', '2', '3', '4']) await fails(session.get(url));
  assert.deepEqual(sleeps, limitedSleeps(4));
  await fails(session.get('5'));
  assert.deepEqual(sleeps, [...limitedSleeps(5), 30000]);
  await fails(session.get('6')); // still limited after the pause: last request of the job
  assert.equal(calls.length, 18);
  assert.deepEqual(sleeps, [...limitedSleeps(5), 30000, 2000, 4000]);

  const warned = [];
  await assert.rejects(session.get('7'), error => error.skipped === true);
  await assert.rejects(session.get('8'), error => error.skipped === true);
  await assert.rejects(session.get('8'), error => error.skipped === true);
  assert.equal(calls.length, 18);
  session.reportSkipped(e => warned.push(e));
  session.reportSkipped(e => warned.push(e));
  assert.equal(warned.length, 1);
  assert.equal(warned[0].type, 'image_download_failed');
  assert.match(warned[0].message, /2 images were skipped because Google limited requests/);

  // The same object sits in the job's errors, so a later skip still counts
  await fails(session.get('9'));
  assert.match(warned[0].message, /3 images/);
  assert.equal(warned[0].count, 3);
});

test('nothing skipped, nothing reported', () => {
  const { session } = imageSession({ script: () => 'x' });
  const warned = [];
  session.reportSkipped(e => warned.push(e));
  assert.deepEqual(warned, []);
});

test('a success after the pause carries on, and the pause is not taken twice', async () => {
  let limited = true;
  const { session, sleeps } = imageSession({ script: () => { if (limited) throw http(429); return 'x'; } });
  for (const url of ['1', '2', '3', '4', '5']) await fails(session.get(url));
  limited = false;
  assert.equal(await session.get('6'), 'x');
  limited = true;
  for (const url of ['7', '8', '9', '10', '11']) await fails(session.get(url));
  assert.equal(sleeps.filter(ms => ms === 30000).length, 1);
  await assert.rejects(session.get('12'), error => error.skipped === true);
});

test('limited images must be consecutive: a 404 between them restarts the count', async () => {
  const { session, sleeps } = imageSession({ script: url => { throw url === 'x' ? http(404) : http(429); } });
  for (const url of ['1', '2', '3', '4', 'x', '5', '6', '7', '8']) await fails(session.get(url));
  assert.equal(sleeps.includes(30000), false);
});

test('one session asks for a url once, a success, until the batch ends', async () => {
  const { session, calls } = imageSession({ script: url => { if (url === 'bad') throw http(404); return `data:${url}`; } });
  assert.equal(await session.get('a'), 'data:a');
  assert.equal(await session.get('a'), 'data:a');
  await fails(session.get('bad'), /HTTP 404/);
  await fails(session.get('bad'), /HTTP 404/); // a failure is asked again
  assert.deepEqual(calls, ['a', 'bad', 'bad']);
  session.endBatch();
  await session.get('a');
  assert.deepEqual(calls, ['a', 'bad', 'bad', 'a']);
});

test('cancel stops before the next request and during a backoff, and is not remembered', async () => {
  let cancelled = false;
  const { session, calls } = imageSession({
    script: (u, n) => { if (n === 1) { cancelled = true; throw http(429); } return 'x'; },
    isCancelled: () => cancelled
  });
  await assert.rejects(session.get('a'), error => error.cancelled === true);
  assert.equal(calls.length, 1);
  await assert.rejects(session.get('b'), error => error.cancelled === true);
  assert.equal(calls.length, 1);
  cancelled = false;
  assert.equal(await session.get('a'), 'x');
});

test('fetchDownload carries status and Retry-After, and an image stops at a limit', async () => {
  const limited = async () => ({ ok: false, status: 429, headers: { get: name => (name === 'Retry-After' ? '9' : null) } });
  const { sandbox, log } = sidePanel({ fetchImpl: limited });
  await assert.rejects(sandbox.downloadImageAsBase64('https://lh3.googleusercontent.com/notebooklm/a'), error => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, '9');
    return true;
  });
  assert.equal(log.pageFetches.length, 0, 'a limited image must not spend a second request through the page');
});

test('a page fetch that is limited is seen too', async () => {
  const { sandbox } = sidePanel({
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
    pageResult: { success: false, error: 'HTTP 503', status: 503, retryAfter: '4' }
  });
  await assert.rejects(sandbox.downloadImageAsBase64('https://lh3.googleusercontent.com/notebooklm/a'), error => {
    assert.equal(error.status, 503);
    assert.equal(error.retryAfter, '4');
    return true;
  });
});

test('an artifact download still falls back after a 429', async () => {
  const { sandbox, log } = sidePanel({ fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => null } }), pageResult: pageImage });
  await sandbox.fetchDownload('https://lh3.googleusercontent.com/notebooklm/report');
  assert.equal(log.pageFetches.length, 1);
});

test('the content script passes status and Retry-After back from its fetch', async () => {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: false, status: 429, headers: { get: name => (name === 'Retry-After' ? '3' : null) } })
  };
  vm.createContext(sandbox);
  vm.runInContext(nestedFn('content.js', 'fetchFileWithCredentials'), sandbox);
  const result = await sandbox.fetchFileWithCredentials('https://x/y');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: false, error: 'HTTP 429', status: 429, retryAfter: '3' });
});

test('citation images convert one at a time', async () => {
  let active = 0;
  let peak = 0;
  const seen = [];
  const sandbox = contentScript({
    sidebarResponse: async () => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      seen.push(1);
      return { success: true, dataUri: 'data:image/png;base64,AA' };
    }
  });
  await sandbox.htmlToMarkdownWithImages(fakeElement(`${REMOTE}/1`, `${REMOTE}/2`, `${REMOTE}/3`), true, []);
  assert.equal(seen.length, 3);
  assert.equal(peak, 1);
});

test('cancel stops the citation images and keeps the converted ones', async () => {
  let cancelled = false;
  const sandbox = contentScript({
    sidebarResponse: () => { cancelled = true; return { success: true, dataUri: 'data:image/png;base64,AA' }; },
    isExportCancelled: () => cancelled
  });
  const failures = [];
  const md = await sandbox.htmlToMarkdownWithImages(fakeElement(`${REMOTE}/1`, `${REMOTE}/2`), true, failures);
  assert.equal(md, `data:image/png;base64,AA ${REMOTE}/2`);
  assert.deepEqual(failures, []);
});

test('the content script keeps the side panel\'s skipped and cancelled marks', async () => {
  for (const mark of ['skipped', 'cancelled']) {
    const sandbox = contentScript({ sidebarResponse: { success: false, error: 'x', [mark]: true } });
    const failures = [];
    await sandbox.htmlToMarkdownWithImages(fakeElement(REMOTE), true, failures);
    assert.equal(failures[0][mark], true);
  }
});

test('reportImageFailures leaves skipped and cancelled images to the job summary', () => {
  const { sandbox } = sourcesPanel(async () => imageResponse());
  const warned = [];
  sandbox.reportImageFailures(
    [{ url: 'a', reason: 'x', skipped: true }, { url: 'b', reason: 'x', cancelled: true }, { url: 'c', reason: 'HTTP 404' }],
    'Venus', e => warned.push(e)
  );
  assert.equal(warned.length, 1);
  assert.equal(warned[0].count, 1);
  assert.match(warned[0].message, /HTTP 404/);
});

test('a skipped image in a job stays a link and reaches errors once', async () => {
  const limited = async () => ({ ok: false, status: 429, headers: { get: name => (name === 'Retry-After' ? '0' : null) } });
  const { sandbox, log } = sourcesPanel(limited);
  sandbox.beginImageSession(5, () => false, async () => {});
  const urls = Array.from({ length: 9 }, (_, i) => `https://lh3.googleusercontent.com/notebooklm/${i}`);
  const md = urls.map(url => `![](${url})`).join('\n');
  const warned = [];
  const out = await sandbox.embedAndReportImages(md, 'Venus', [], e => warned.push(e));
  sandbox.endImageSession();
  assert.equal(out.size, 0);
  assert.equal(log.fetches.length, 6 * 3);
  const summaries = warned.filter(e => /skipped because Google limited/.test(e.message));
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].count, 3);
  assert.equal(warned.filter(e => e.source === 'Venus').length, 1);
  assert.equal(warned.find(e => e.source === 'Venus').count, 6);
});

test('cancel stops the embed pass and keeps what is done', async () => {
  let cancelled = false;
  const { sandbox, log } = sourcesPanel(async () => { cancelled = true; return imageResponse(); });
  sandbox.beginImageSession(5, () => cancelled);
  const first = 'https://lh3.googleusercontent.com/notebooklm/1';
  const second = 'https://lh3.googleusercontent.com/notebooklm/2';
  const out = await sandbox.embedImagesInMarkdown(`![](${first}) ![](${second})`, 'Venus');
  sandbox.endImageSession();
  assert.equal(log.fetches.length, 1);
  assert.equal(out.imagesEmbedded, 1);
  assert.match(out.markdown, /^!\[\]\(data:image/);
  assert.ok(out.markdown.includes(second));
  assert.deepEqual(out.failures.length, 0);
});

test('a source with both image variants downloads each image once', async () => {
  const { sandbox, log } = sourcesPanel(async () => imageResponse());
  sandbox.beginImageSession(5, () => false);
  const url = 'https://lh3.googleusercontent.com/notebooklm/1';
  sandbox.convertToMarkdown = () => `![](${url})`;
  const built = await sandbox.buildSourceData(
    { title: 'Venus', index: 0 }, { html: 'x', guideMarkdown: 'G', keyTopics: ['t'] },
    { warn() {} }, {}, true, { exportSourceWithImages: true, exportSourcePlusMetaWithImages: true }
  );
  sandbox.endImageSession();
  assert.equal(log.fetches.length, 1);
  assert.match(built.versions.withImages, /data:image/);
  assert.match(built.versions.plusMetaWithImages, /data:image/);
});

test('the side panel answers a page image request through the job session', async () => {
  const { sandbox, log } = sidePanel({ fetchImpl: async () => imageResponse() });
  sandbox.beginImageSession(5, () => false);
  const url = 'https://lh3.googleusercontent.com/notebooklm/1';
  await sandbox.fetchJobImage(url, { tabId: 9 });
  await sandbox.fetchJobImage(url, { tabId: 9 });
  sandbox.endImageSession();
  assert.equal(log.fetches.length, 1);
  await sandbox.fetchJobImage(url, { tabId: 9 });
  assert.equal(log.fetches.length, 2);
  assert.match(read('sidebar-core.js'), /fetchJobImage\(message\.url, \{ tabId: sender\.tab\?\.id \}\)/);
});

test('every job opens a session, closes it, and frees it with each batch', () => {
  for (const [file, fn] of [['sidebar-notes.js', 'runNotesJob'], ['sidebar-sources.js', 'runSourcesJob'], ['sidebar-chat.js', 'runChatJob']]) {
    const body = topLevelFn(file, fn);
    assert.match(body, /beginImageSession\(shell\.tab\.id,/, fn);
    assert.match(body, /\.finally\(endImageSession\)/, fn);
  }
  for (const [file, fn] of [['sidebar-notes.js', 'runNotesJob'], ['sidebar-sources.js', 'runSourcesJob']]) {
    assert.match(topLevelFn(file, fn), /imageSession\?\.endBatch\(\)/, fn);
  }
  const single = topLevelFn('sidebar-notes.js', 'exportSingleNote');
  assert.match(single, /beginImageSession\(tab\.id, \(\) => false\)/);
  assert.match(single, /endImageSession\(\)/);
});

// ---- Task 7b fix round: wait budget ----

const total = sleeps => sleeps.reduce((sum, ms) => sum + ms, 0);
// Odd numbers are limited, even ones succeed, so the streak never builds
const alternating = retryAfter => (url => {
  if (Number(url) % 2 === 1) throw http(429, retryAfter);
  return 'x';
});

test('retryAfterMs takes only digits or an HTTP date', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  for (const bad of ['1.5', '1e3', '+5', '5 s', '2026-11-04', 'Nov 4 2026', 'Xxx, 99 Foo 2026 12:00:05 GMT', 'Wed, 04 Nov 2026 12:00:05 PST']) {
    assert.equal(NLME.retryAfterMs(bad, now), null, bad);
  }
  assert.equal(NLME.retryAfterMs(' 5 ', now), 5000);
});

test('a Retry-After of 1.5 falls back to the normal backoff', async () => {
  const { session, sleeps } = imageSession({ script: (u, n) => { if (n < 3) throw http(429, '1.5'); return 'x'; } });
  await session.get('u');
  assert.deepEqual(sleeps, [2000, 4000]);
});

test('alternating limited and fine images reach the 5 minute budget and skip the rest', async () => {
  const { session, calls, sleeps } = imageSession({ script: alternating(null) });
  let url = 0;
  let skippedAt = null;
  while (url < 200) {
    url++;
    try {
      await session.get(String(url));
    } catch (error) {
      if (error.skipped) { skippedAt = url; break; }
    }
  }
  // 50 limited images at 6 s land exactly on the budget: the very next one skips
  assert.equal(skippedAt, 100);
  assert.equal(sleeps.includes(30000), false, 'the streak never reached the pause');
  assert.equal(total(sleeps), 300000);

  const before = calls.length;
  await assert.rejects(session.get('999'), error => error.skipped === true);
  assert.equal(calls.length, before);

  const warned = [];
  session.reportSkipped(e => warned.push(e));
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /skipped because Google limited requests/);
  assert.match(warned[0].message, /5 minute/);
});

test('a wait that would pass the budget is not taken', async () => {
  const { session, sleeps } = imageSession({ script: alternating('7') });
  let tripped = false;
  for (let url = 1; url < 200 && !tripped; url++) {
    await session.get(String(url)).catch(error => { tripped = !!error.skipped; });
  }
  assert.equal(tripped, true);
  assert.ok(total(sleeps) <= 300000);
  assert.ok(total(sleeps) > 290000);
});

test('the 30 s pause counts against the budget', async () => {
  const { session, sleeps } = imageSession({ script: () => { throw http(429, '50'); } });
  for (let url = 1; url <= 5; url++) await session.get(String(url)).catch(() => {});
  await assert.rejects(session.get('6'), error => error.skipped === true);
  // 50 s + 50 s per image hits 300 s inside image 3: the pause never fits
  assert.ok(total(sleeps) <= 300000);
  assert.equal(sleeps.includes(30000), false);
});

test('a taken pause uses up budget', async () => {
  // 5 limited images and the pause are 60 s; 40 more limited images at 6 s fill it
  const { session, sleeps } = imageSession({
    script: url => {
      const n = Number(url);
      if (n <= 5 || (n > 6 && n % 2 === 1)) throw http(429);
      return 'x';
    }
  });
  let skippedAt = null;
  for (let url = 1; url < 200 && !skippedAt; url++) {
    await session.get(String(url)).catch(error => { if (error.skipped) skippedAt = url; });
  }
  assert.equal(sleeps.filter(ms => ms === 30000).length, 1);
  assert.equal(total(sleeps), 300000);
  assert.equal(skippedAt, 86); // the 40th is image 85
});

test('the budget message stays plain when limiting alone caused the skip', async () => {
  const { session } = imageSession({ script: () => { throw http(429); } });
  for (let url = 1; url <= 6; url++) await session.get(String(url)).catch(() => {});
  await session.get('7').catch(() => {});
  const warned = [];
  session.reportSkipped(e => warned.push(e));
  assert.doesNotMatch(warned[0].message, /5 minute/);
});

test('a cancel during the 30 s pause reports as cancelled, and is not remembered', async () => {
  let cancelled = false;
  const calls = [];
  const session = NLME.createImageSession({
    download: async url => {
      calls.push(url);
      if (cancelled) return 'x';
      throw http(429);
    },
    sleep: async ms => { if (ms === 30000) cancelled = true; },
    isCancelled: () => cancelled
  });
  for (const url of ['1', '2', '3', '4']) await session.get(url).catch(() => {});
  await assert.rejects(session.get('5'), error => error.cancelled === true);
  cancelled = false;
  assert.equal(await session.get('5').catch(() => 'failed'), 'failed'); // asked again, still limited
  assert.equal(calls.filter(url => url === '5').length, 6);
});

test('an unexpected throw from the embed pass leaves the note with links, not a failed note', async () => {
  const { sandbox } = notesPanel({ noteData: { html: BODY, sources: [], errors: [] } });
  sandbox.embedAndReportImages = async () => { throw new Error('boom'); };
  const warned = [];
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, { exportNoteWithImages: true });
  assert.ok(note.markdown, 'the note is still written');
  assert.ok(!note.imageEmbeds, 'no embeds: images stay links');
  assert.ok(warned.some(w => /boom/.test(typeof w === 'string' ? w : JSON.stringify(w))), 'the failure is reported');
});

// Task 12: image requests leave out authuser (the cause of lh3's occasional 403s is not known)
const AU = 'https://lh3.googleusercontent.com/notebooklm/AB-c=w800-h600';

test('imageFetchUrl drops authuser and keeps the rest', () => {
  assert.equal(NLME.imageFetchUrl(`${AU}?authuser=0`), AU);
  assert.equal(NLME.imageFetchUrl(`${AU}?authuser=0&sz=2`), `${AU}?sz=2`);
  assert.equal(NLME.imageFetchUrl(`${AU}?sz=2&authuser=1`), `${AU}?sz=2`);
  assert.equal(NLME.imageFetchUrl('https://lh3.google.com/rd-notebooklm/x?authuser=0'), 'https://lh3.google.com/rd-notebooklm/x');
  assert.equal(NLME.imageFetchUrl(AU), AU);
  assert.equal(NLME.imageFetchUrl('https://example.com/a.png?authuser=0'), 'https://example.com/a.png?authuser=0');
  assert.equal(NLME.imageFetchUrl('not a url'), 'not a url');
});

test('downloadImageAsBase64 fetches without authuser', async () => {
  const { sandbox, log } = sidePanel({ fetchImpl: async () => imageResponse() });
  await sandbox.downloadImageAsBase64(`${AU}?authuser=0`);
  assert.deepEqual(log.fetches.map(f => f.url), [AU]);
});

test('downloadImageAsBase64 makes one request on 403: no original url, no page fallback', async () => {
  const { sandbox, log } = sidePanel({
    fetchImpl: async () => ({ ok: false, status: 403, headers: { get: () => null } })
  });
  await assert.rejects(sandbox.downloadImageAsBase64(`${AU}?authuser=0`), e => e.status === 403);
  assert.deepEqual(log.fetches.map(f => f.url), [AU]);
});

test('downloadImageAsBase64 takes no extra attempt after 429', async () => {
  const { sandbox, log } = sidePanel({
    fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => null } })
  });
  await assert.rejects(sandbox.downloadImageAsBase64(`${AU}?authuser=0`), e => e.status === 429);
  assert.deepEqual(log.fetches.map(f => f.url), [AU]);
});

test('session: authuser variants download once and the embed replaces the original link', async () => {
  const { sandbox, log } = sidePanel({ fetchImpl: async () => imageResponse() });
  sandbox.beginImageSession(5, () => false, async () => {});
  const original = `${AU}?authuser=0`;
  const [a, b] = await Promise.all([sandbox.fetchJobImage(original), sandbox.fetchJobImage(AU)]);
  assert.equal(a, b);
  assert.equal(log.fetches.length, 1);
  const md = NLME.applyImageEmbeds(`![x](${original})`, new Map([[original, a]]));
  assert.match(md, /^!\[x\]\(data:image\/png;base64,/);
});

// ---- 403 handling (Task 13) ----

test('a failed get is not remembered: the next get asks again and can succeed', async () => {
  let n = 0;
  const { session, calls } = imageSession({ script: () => { if (++n === 1) throw http(500); return 'data:ok'; } });
  await fails(session.get('u'));
  assert.equal(await session.get('u'), 'data:ok');
  assert.equal(calls.length, 2);
});

test('a success is still cached until endBatch', async () => {
  const { session, calls } = imageSession({ script: () => 'data:ok' });
  await session.get('u');
  await session.get('u');
  assert.equal(calls.length, 1);
  session.endBatch();
  await session.get('u');
  assert.equal(calls.length, 2);
});

test('patient get retries 403 after 5 s and 15 s', async () => {
  const { session, calls, sleeps } = imageSession({ script: (u, n) => { if (n < 3) throw http(403); return 'data:ok'; } });
  assert.equal(await session.get('u', { patient: true }), 'data:ok');
  assert.deepEqual(sleeps, [5000, 15000]);
  assert.equal(calls.length, 3);
});

test('patient get gives up after three 403s with the 403 error', async () => {
  const { session, calls } = imageSession({ script: () => { throw http(403); } });
  await assert.rejects(session.get('u', { patient: true }), e => e.status === 403);
  assert.equal(calls.length, 3);
});

test('a non-patient 403 is one download and no wait', async () => {
  const { session, calls, sleeps } = imageSession({ script: () => { throw http(403); } });
  await assert.rejects(session.get('u'), e => e.status === 403);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('a used up forbidden budget fails the image at once and later images still download', async () => {
  const { session, calls, sleeps } = imageSession({ script: url => { if (url.startsWith('bad')) throw http(403); return 'data:ok'; } });
  for (let i = 0; i < 30; i++) await session.get(`bad${i}`, { patient: true }).catch(() => {});
  assert.equal(sleeps.length, 60);
  const callsBefore = calls.length;
  await assert.rejects(session.get('bad-late', { patient: true }), e => e.status === 403);
  assert.equal(calls.length, callsBefore + 1);
  assert.equal(sleeps.length, 60);
  assert.equal(await session.get('fine', { patient: true }), 'data:ok');
  const warned = [];
  session.reportSkipped(e => warned.push(e));
  assert.deepEqual(warned, []);
});

test('403 leaves the 429 streak and skipping alone', async () => {
  const { session, sleeps } = imageSession({ script: url => {
    if (url.startsWith('f')) throw http(403);
    throw http(429);
  } });
  for (let i = 1; i <= 4; i++) {
    await session.get(`l${i}`).catch(() => {});
    await session.get(`f${i}`, { patient: true }).catch(() => {}); // a 403 between limited images
  }
  assert.equal(sleeps.includes(30000), false);
  await session.get('l5').catch(() => {});
  assert.equal(sleeps.filter(ms => ms === 30000).length, 1); // streak survived the 403s
});

test('a cancel during a forbidden wait rejects as cancelled', async () => {
  let cancelled = false;
  const session = NLME.createImageSession({
    download: async () => { throw http(403); },
    sleep: async () => { cancelled = true; },
    isCancelled: () => cancelled
  });
  await assert.rejects(session.get('u', { patient: true }), e => e.cancelled === true);
});

test('a patient get joining a failed non-patient request makes its own attempt', async () => {
  let n = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const session = NLME.createImageSession({
    download: async () => { if (++n === 1) { await gate; throw http(403); } return 'data:ok'; },
    sleep: async () => {}
  });
  const hover = session.get('u');
  const embed = session.get('u', { patient: true });
  hover.catch(() => {});
  release();
  await assert.rejects(hover, e => e.status === 403);
  assert.equal(await embed, 'data:ok');
  assert.equal(n, 2);
});

test('fetchJobImage passes patient to the session, and a hover failure that is embedded later is not reported', async () => {
  const url = 'https://lh3.googleusercontent.com/notebooklm/1';
  let hoverPhase = true;
  const { sandbox } = sourcesPanel(async () => (hoverPhase ? { ok: false, status: 403, headers: { get: () => null } } : imageResponse()));
  sandbox.beginImageSession(5, () => false, async () => {});
  const hover = await sandbox.fetchJobImage(url, { tabId: 5 }).then(() => null, e => e);
  assert.equal(hover.status, 403);
  hoverPhase = false;
  const warned = [];
  const embeds = await sandbox.embedAndReportImages(`![a](${url})`, 'Venus', [{ url, reason: hover.message }], e => warned.push(e));
  assert.match(embeds.get(url), /^data:image\/png/);
  assert.deepEqual(warned, []);
});

test('an image still a link after the embed pass is reported once per item', async () => {
  const url = 'https://lh3.googleusercontent.com/notebooklm/2';
  const { sandbox } = sourcesPanel(async () => ({ ok: false, status: 403, headers: { get: () => null } }));
  sandbox.beginImageSession(5, () => false, async () => {});
  const warned = [];
  const embeds = await sandbox.embedAndReportImages(`![a](${url})`, 'Venus', [{ url, reason: 'HTTP 403' }], e => warned.push(e));
  assert.equal(embeds.size, 0);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].source, 'Venus');
});

test('concurrent failing gets share one download', async () => {
  const { session, calls } = imageSession({ script: async () => { throw http(500); } });
  const results = await Promise.allSettled([session.get('u'), session.get('u')]);
  assert.equal(calls.length, 1);
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
});

test('a patient get for a url that gave up on 403 rejects at once, until endBatch', async () => {
  const { session, calls, sleeps } = imageSession({ script: () => { throw http(403); } });
  await assert.rejects(session.get('u', { patient: true }), e => e.status === 403);
  const calls1 = calls.length, sleeps1 = sleeps.length;
  await assert.rejects(session.get('u', { patient: true }), e => e.status === 403);
  assert.equal(calls.length, calls1);
  assert.equal(sleeps.length, sleeps1);
  await assert.rejects(session.get('u'), e => e.status === 403); // non-patient may still ask once
  assert.equal(calls.length, calls1 + 1);
  session.endBatch();
  await assert.rejects(session.get('u', { patient: true }), e => e.status === 403);
  assert.equal(calls.length, calls1 + 4); // asked again: three patient attempts
});

test('the embed pass is patient: it outlasts a 403 that a hover would stop at', async () => {
  const url = 'https://lh3.googleusercontent.com/notebooklm/9';
  let slept = false;
  const { sandbox } = sourcesPanel(async () => (slept ? imageResponse() : { ok: false, status: 403, headers: { get: () => null } }));
  sandbox.beginImageSession(5, () => false, async () => { slept = true; });
  const out = await sandbox.embedImagesInMarkdown(`![a](${url})`, 'Venus');
  assert.equal(out.imagesEmbedded, 1);
});

test('the DOWNLOAD_IMAGE_AS_BASE64 handler stays non-patient', async () => {
  const url = 'https://lh3.googleusercontent.com/notebooklm/10';
  let slept = false;
  const { sandbox } = sourcesPanel(async () => (slept ? imageResponse() : { ok: false, status: 403, headers: { get: () => null } }));
  sandbox.beginImageSession(5, () => false, async () => { slept = true; });
  let listener;
  sandbox.chrome.runtime = { onMessage: { addListener: fn => { listener = fn; } } };
  sandbox.document = { addEventListener() {} };
  sandbox.init = () => {};
  const src = read('sidebar-core.js');
  const start = src.indexOf('chrome.runtime.onMessage.addListener(');
  vm.runInContext(src.slice(start, src.indexOf('\n});\n', start) + 5), sandbox);
  const reply = await new Promise(resolve => listener({ type: NLME.MSG.DOWNLOAD_IMAGE_AS_BASE64, url }, { tab: { id: 5 } }, resolve));
  assert.equal(reply.success, false);
  assert.equal(slept, false);
});

// ---- 1.9.15: the last try before a package is written ----

const entry = (url, reason = 'Fetch failed: HTTP 403', item = 'Venus') => ({ item, url, reason });
const sum = list => list.reduce((a, b) => a + b, 0);

test('the last-try constants', () => {
  assert.equal(NLME.IMAGE_FINAL_COOLDOWN_MS, 60000);
  assert.equal(NLME.IMAGE_FINAL_WAIT_BUDGET_MS, 3 * 60000);
});

test('finalTry cools down once per call, whatever the number of entries', async () => {
  const { session, sleeps, calls } = imageSession({ script: url => `data:${url}` });
  const { fetched, still } = await session.finalTry([entry('a'), entry('b'), entry('c')], { cooldownMs: 60000 });
  assert.deepEqual(sleeps, [60000]);
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(fetched.size, 3);
  assert.deepEqual(still, []);
});

test('finalTry: a url that now succeeds goes to fetched; one that keeps failing 403 stays with its first reason', async () => {
  const { session, calls } = imageSession({ script: url => { if (url === 'bad') throw http(403); return `data:${url}`; } });
  const bad = entry('bad', 'first reason');
  const { fetched, still } = await session.finalTry([entry('ok'), bad], { cooldownMs: 1 });
  assert.equal(fetched.get('ok'), 'data:ok');
  assert.ok(!fetched.has('bad'));
  assert.equal(still.length, 1);
  assert.equal(still[0], bad);
  assert.equal(still[0].reason, 'first reason');
  assert.equal(calls.filter(u => u === 'bad').length, 3); // patient: the session's 403 waits
});

test('finalTry asks for a url once even when two entries name it', async () => {
  const { session, calls } = imageSession({ script: url => { if (url === 'bad') throw http(404); return `data:${url}`; } });
  const { fetched, still } = await session.finalTry(
    [entry('ok', 'x', 'A'), entry('ok', 'x', 'B'), entry('bad', 'y', 'A'), entry('bad', 'y', 'B')], { cooldownMs: 1 });
  assert.deepEqual(calls, ['ok', 'bad']);
  assert.equal(fetched.size, 1);
  assert.deepEqual(still.map(e => e.item), ['A', 'B']);
});

test('finalTry: cancel during the cool-down gives no downloads and everything in still', async () => {
  let cancelled = false;
  const calls = [];
  const session = NLME.createImageSession({
    download: async url => { calls.push(url); return 'x'; },
    sleep: async () => { cancelled = true; }
  });
  const entries = [entry('a'), entry('b')];
  const { fetched, still } = await session.finalTry(entries, { cooldownMs: 60000, isCancelled: () => cancelled });
  assert.equal(calls.length, 0);
  assert.equal(fetched.size, 0);
  assert.deepEqual(still, entries);
});

test('finalTry never waits past its budget, and leaves the rest in still', async () => {
  const { session, sleeps, calls } = imageSession({ script: () => { throw http(403); } });
  const entries = Array.from({ length: 30 }, (_, i) => entry(`u${i}`));
  const { fetched, still } = await session.finalTry(entries, { cooldownMs: NLME.IMAGE_FINAL_COOLDOWN_MS });
  assert.ok(sum(sleeps) <= NLME.IMAGE_FINAL_WAIT_BUDGET_MS + NLME.IMAGE_FINAL_COOLDOWN_MS, `slept ${sum(sleeps)}`);
  assert.ok(sum(sleeps) > NLME.IMAGE_FINAL_COOLDOWN_MS);
  assert.equal(fetched.size, 0);
  assert.deepEqual(still, entries);
  assert.ok(calls.length >= 9 && calls.length < 90);
});

test('finalTry tries each url once even after the job spent its 403 wait budget', async () => {
  let now = 'forbidden';
  const { session, sleeps, calls } = imageSession({ script: url => { if (now === 'forbidden' || url === 'bad') throw http(403); return `data:${url}`; } });
  // 30 patient images of 20 s each spend the job's 10 minutes of 403 waits
  for (let i = 0; i < 31; i++) await fails(session.get(`spent${i}`, { patient: true }), /403/);
  assert.equal(sum(sleeps), 10 * 60 * 1000);
  now = 'fine';
  const before = sleeps.length;
  calls.length = 0;
  const { fetched, still } = await session.finalTry([entry('ok'), entry('bad')], { cooldownMs: 5 });
  assert.equal(fetched.get('ok'), 'data:ok');
  assert.equal(still.length, 1);
  assert.deepEqual(calls, ['ok', 'bad', 'bad', 'bad']);
  assert.deepEqual(sleeps.slice(before), [5, 5000, 15000]);
});

test('finalTry with nothing to try neither sleeps nor downloads', async () => {
  const { session, sleeps, calls } = imageSession({ script: () => 'x' });
  const { fetched, still } = await session.finalTry([], { cooldownMs: 60000 });
  assert.deepEqual([sleeps, calls, fetched.size, still], [[], [], 0, []]);
});

// The last try, wired: what it gets reaches the with-images files, and the
// summary counts only what is still missing
const IMG1 = 'https://lh3.googleusercontent.com/notebooklm/one';
const IMG2 = 'https://lh3.googleusercontent.com/notebooklm/two';
const forbidden = () => ({ ok: false, status: 403, headers: { get: () => null } });

test('a source image the last try gets is embedded; the other stays a link and counts once', async () => {
  let lastTry = false;
  const { sandbox } = sourcesPanel(async url => (lastTry && url === IMG1 ? imageResponse() : forbidden()));
  const sleeps = [];
  sandbox.beginImageSession(5, () => false, async ms => { sleeps.push(ms); });
  const warned = [];
  const data = { html: 'x', markdown: '', guideMarkdown: 'Sum', keyTopics: ['t'], sourceTitle: 'Venus' };
  sandbox.convertToMarkdown = () => `![a](${IMG1}) text ![b](${IMG2})`;
  const built = await sandbox.buildSourceData({ title: 'Venus', index: 0 }, data, { warn: e => warned.push(e) }, {}, true,
    { exportSourceWithImages: true, exportSourcePlusMetaWithImages: true });
  assert.equal(built.imagesEmbedded, 0);
  assert.equal(warned.filter(e => e.type === 'image_download_failed').length, 0);
  assert.ok(!Object.keys(built).some(key => key.startsWith('_')), 'nothing extra reaches the files');

  lastTry = true;
  const progress = [];
  sleeps.length = 0;
  await sandbox.retryMissingImages([built], { progress: text => progress.push(text), apply: sandbox.applySourceImageTry });
  assert.deepEqual(progress, ['Trying 2 missing images again…']);
  assert.equal(sleeps[0], NLME.IMAGE_FINAL_COOLDOWN_MS);
  for (const version of [built.versions.withImages, built.versions.plusMetaWithImages]) {
    assert.equal((version.match(/data:image\/png;base64,/g) || []).length, 1);
    assert.ok(version.includes(`[b](${IMG2})`), 'the missing image stays a plain link');
    assert.doesNotMatch(version, /!\[b\]/);
  }
  assert.equal(built.imagesEmbedded, 1);
  const images = warned.filter(e => e.type === 'image_download_failed');
  assert.equal(images.length, 1);
  assert.equal(images[0].count, 1);
  assert.equal(images[0].source, 'Venus');
  assert.ok(!('_imageFailures' in built) && !('_imageMarkdown' in built));
});

test('a note image the last try gets reaches the with-images files', async () => {
  let lastTry = false;
  const { sandbox } = notesPanel({
    fetchImpl: async url => (url === OK_URL || (lastTry && url === BAD_URL) ? imageResponse() : forbidden()),
    noteData: { html: BODY, sources: [], errors: [] }
  });
  sandbox.beginImageSession(5, () => false, async () => {});
  const warned = [];
  const settingsOn = { exportNoteWithImages: true };
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, settingsOn);
  assert.equal(warned.length, 0);
  lastTry = true;
  await sandbox.retryMissingImages([note]);
  const files = sandbox.buildNotesFiles([note], { meta: META, variantSettings: settingsOn });
  const md = files.find(f => f.path === 'notes/Note-with-images.md').data;
  assert.match(md, /!\[fig2\]\(data:image\/png/);
  assert.ok(md.includes(`[fig3](${BAD_URL}2)`));
  assert.equal(warned.length, 1);
  assert.equal(warned[0].count, 1);
});

test('notes keep the earlier-failures rule through the last try', async () => {
  const { sandbox } = notesPanel({
    fetchImpl: async url => (url === OK_URL ? imageResponse() : forbidden()),
    noteData: {
      html: BODY, sources: [], errors: [],
      imageFailures: [{ url: OK_URL, reason: 'HTTP 500' }, { url: BAD_URL, reason: 'HTTP 403' }]
    }
  });
  sandbox.beginImageSession(5, () => false, async () => {});
  const warned = [];
  const note = await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, { exportNoteWithImages: true });
  await sandbox.retryMissingImages([note]);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].count, 2);
  assert.doesNotMatch(warned[0].message, /HTTP 500/);
});

test('a chat image the last try gets reaches chat-with-images, and the message summary keeps its fields', async () => {
  let lastTry = false;
  const { sandbox } = chatPanel({
    fetchImpl: async url => (url === OK_URL || (lastTry && url === BAD_URL) ? imageResponse() : forbidden()),
    chatResponse: { sourcesByIndex: { 1: { text: 'S', quote: 'q' } }, errors: [] }
  });
  sandbox.beginImageSession(5, () => false, async () => {});
  const warned = [];
  const message = await sandbox.extractChatPair(
    { tab: { id: 5 }, progress() {} }, { userMessage: 'Why?', aiResponseHTML: BODY },
    { index: 0, warn: e => warned.push(e) }, { citationMode: 'quotes', total: 1, variantSettings: { exportNoteWithImages: true } }
  );
  assert.equal(warned.length, 0);
  lastTry = true;
  await sandbox.retryMissingImages([message]);
  const md = chatFilesFor(sandbox, [message], true).find(f => f.path === 'chat-with-images.md').data;
  assert.match(md, /!\[fig2\]\(data:image\/png/);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].userQuestion, 'Why?');
  assert.equal(warned[0].messageIndex, 1);
  assert.match(warned[0].message, /Failed to download image/);
});

test('the three job runners hand their batch to the last try before packaging', () => {
  for (const file of ['sidebar-sources.js', 'sidebar-notes.js', 'sidebar-chat.js']) {
    assert.match(read(file), /beforePackage: [\s\S]{0,120}retryMissingImages\(/, file);
  }
});

test('finalTry does not cool down when limiting already stopped the job\'s downloads', async () => {
  const { session, sleeps, calls } = imageSession({ script: () => { throw http(429); } });
  for (let i = 0; i < 5; i++) await fails(session.get(`l${i}`));
  for (let i = 5; i < 10; i++) await fails(session.get(`l${i}`));
  await fails(session.get('next'), /Skipped/);
  sleeps.length = 0;
  calls.length = 0;
  const entries = [entry('a')];
  const { fetched, still } = await session.finalTry(entries, { cooldownMs: 60000 });
  assert.deepEqual([sleeps, calls, fetched.size, still], [[], [], 0, entries]);
});
