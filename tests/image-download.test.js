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
    /HTTP 403.*HTTP 403/
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

function sourcesPanel(fetchImpl) {
  const panel = sidePanel({ fetchImpl });
  vm.runInContext(topLevelFn('sidebar-sources.js', 'embedImagesInMarkdown'), panel.sandbox);
  vm.runInContext(topLevelFn('sidebar-sources.js', 'buildSourceData'), panel.sandbox);
  vm.runInContext(topLevelFn('sidebar-core.js', 'reportImageFailures'), panel.sandbox);
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
  const images = warned.filter(e => e.type === 'image_download_failed');
  assert.equal(images.length, 1);
  assert.equal(images[0].count, 1);
  assert.match(images[0].url, /\/meta$/);
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
  vm.runInContext(topLevelFn('sidebar-notes.js', 'extractNoteItem'), sandbox);
  vm.runInContext(topLevelFn('sidebar-core.js', 'reportImageFailures'), sandbox);
  const warned = [];
  await sandbox.extractNoteItem({ tab: { id: 5 } }, { title: 'Note', index: 0 }, { warn: e => warned.push(e) }, {}, { exportNoteWithImages: true });
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
        document: { createElement: () => ({ set innerHTML(v) {}, querySelectorAll: () => [button] }) }
      }
    }
  });
  vm.runInContext(topLevelFn('sidebar-chat.js', 'extractChatPair'), sandbox);
  vm.runInContext(topLevelFn('sidebar-core.js', 'reportImageFailures'), sandbox);
  const warned = [];
  const out = await sandbox.extractChatPair(
    { tab: { id: 5 }, progress() {} }, { userMessage: 'Why?', aiResponseHTML: '' },
    { index: 0, warn: e => warned.push(e) },
    { citationMode: 'quotes', total: 1, variantSettings: { exportNoteWithImages: true } }
  );
  assert.equal(out.stats.failedExtractions, 0);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].type, 'image_download_failed');
  assert.equal(warned[0].userQuestion, 'Why?');
  assert.match(warned[0].message, /2 images/);
});

// content.js's image conversion, on a stand-in element
function contentScript({ sidebarResponse, fetchImpl } = {}) {
  const sandbox = {
    NLME, URL, Blob, FileReader: FakeFileReader, console: { log() {}, warn() {}, error() {} },
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
  assert.deepEqual(JSON.parse(JSON.stringify(failures)), [{ url: REMOTE, reason: 'Fetch failed: HTTP 403' }]);
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

test('a single note download reports its failed images too', () => {
  const single = read('sidebar-notes.js');
  assert.equal(single.match(/reportImageFailures\(noteData\.imageFailures/g).length, 2);
  assert.match(single, /showToast\(`\$\{note\.title\}: \$\{failure\.message\}`, 'warning'\)/);
});
