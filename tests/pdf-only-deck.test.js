// PDF-only decks (Task 10): a PPTX request for a deck whose menu lists no
// PowerPoint item is skipped with one Info line. Runs the real sidebar
// functions against a stubbed message reply.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function fn(file, name) {
  const src = read(file);
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
}

// replies: DOWNLOAD_ARTIFACT answers by requested preference
function sandbox(reply) {
  const sent = [];
  const logs = [];
  const ctx = vm.createContext({
    NLME, setTimeout: f => { f(); return 0; }, Promise, Error, console,
    settings: { slidesFormat: 'pdf' },
    logger: { info: () => {}, warn: () => {}, error: (...a) => logs.push(a), download: () => {} },
    ensureContentScriptLoaded: async () => {},
    chrome: {
      runtime: { sendMessage: async () => ({}) },
      tabs: { sendMessage: async (_tab, msg) => { sent.push(msg.data); return reply(msg.data); } }
    }
  });
  vm.runInContext([fn('sidebar-core.js', 'retryDownload'), fn('sidebar-artifacts.js', 'fetchArtifactFiles'), fn('sidebar-artifacts.js', 'fetchSlideFormats')].join('\n') +
    '\nthis.retryDownload = retryDownload; this.fetchArtifactFiles = fetchArtifactFiles; this.fetchSlideFormats = fetchSlideFormats;', ctx);
  return { ctx, sent, logs };
}

const item = { index: 0, type: 'Slides', label: 'Deck' };
const pdfReply = { success: true, method: 'url_intercepted', url: 'https://contribution.usercontent.google.com/d.pdf', title: 'Deck' };
const notOffered = { success: false, error: NLME.FORMAT_NOT_OFFERED };

test('fetchArtifactFiles reads the missing format from an { error } reply', async () => {
  const { ctx, sent } = sandbox(() => notOffered);
  await assert.rejects(ctx.fetchArtifactFiles(1, item, { stem: 'S', mode: 'folder', slidesFormat: 'pptx', onlyIfOffered: true }),
    e => e.formatNotOffered === true && e.message === NLME.FORMAT_NOT_OFFERED);
  assert.equal(sent[0].requireFormat, true);
  // not asked for: an ordinary failure
  await assert.rejects(ctx.fetchArtifactFiles(1, item, { stem: 'S', mode: 'folder', slidesFormat: 'pptx' }), e => !e.formatNotOffered);
  assert.equal(sent[1].requireFormat, undefined);
});

async function run(reply, formats = ['pdf', 'pptx']) {
  const { ctx, sent } = sandbox(reply);
  const warns = [];
  const fetchOne = format => ctx.retryDownload(() => ctx.fetchArtifactFiles(1, item, {
    stem: 'S', mode: 'folder', slidesFormat: format, ...(format === 'pptx' && formats.length > 1 ? { onlyIfOffered: true } : {})
  }), 3, 'Deck');
  try {
    const fetched = await ctx.fetchSlideFormats(item, formats, fetchOne, { warn: m => warns.push(m) });
    return { fetched, warns, sent };
  } catch (error) {
    return { error, warns, sent };
  }
}

test('a PDF-only deck: PPTX is skipped once, with one Info line, no retry, no second PDF', async () => {
  const { fetched, warns, sent, error } = await run(d => (d.downloadPreference === 'pptx' ? notOffered : pdfReply));
  assert.equal(error, undefined);
  assert.deepEqual([...fetched.files.map(f => f.path)], ['S.pdf']);
  assert.equal(sent.filter(d => d.downloadPreference === 'pptx').length, 1);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /^\[Deck\] Info: no PowerPoint version offered/);
});

test('a deck with both formats saves both and warns nothing', async () => {
  const { fetched, warns } = await run(d => ({ ...pdfReply, url: `https://contribution.usercontent.google.com/d.${d.downloadPreference}` }));
  assert.deepEqual([...fetched.files.map(f => f.path)], ['S.pdf', 'S.pptx']);
  assert.equal(warns.length, 0);
});

test('a PDF failure plus a PPTX skip still fails the item', async () => {
  const { error, warns } = await run(d => (d.downloadPreference === 'pptx' ? notOffered : { success: false, error: 'boom' }));
  assert.equal(error.message, 'boom');
  assert.equal(warns.length, 0);
});

test('a PPTX failure other than a missing format warns and keeps the PDF', async () => {
  const { fetched, warns } = await run(d => (d.downloadPreference === 'pptx' ? { success: false, error: 'boom' } : pdfReply));
  assert.equal(fetched.files.length, 1);
  assert.match(warns[0], /PPTX version failed: boom/);
});

test('a single PPTX request keeps the fallback and never asks for an exact match', async () => {
  const { fetched, sent } = await run(() => pdfReply, ['pptx']);
  assert.equal(fetched.files.length, 1);
  assert.equal(sent[0].requireFormat, undefined);
});

// content.js clickArtifactDownloadButton, run against a stubbed menu
function clickSandbox(labels, closeResult = true) {
  const src = read('content.js');
  const start = src.indexOf('  async function clickArtifactDownloadButton(');
  const body = src.slice(start, src.indexOf('\n  }\n', start) + 5);
  const items = labels.map(textContent => ({ textContent, click() {} }));
  const panel = { querySelectorAll: () => items };
  const calls = [];
  const ctx = vm.createContext({
    NLME, console, Error, Date, CustomEvent: class {}, calls,
    document: { dispatchEvent() {}, querySelectorAll: () => [] }, // stale menus are not this item's
    closeOpenMenus: async () => { calls.push('close'); return closeResult; },
    openMenuForTrigger: async () => { calls.push('open'); return panel; },
    findDownloadButton: async (preference, exact, inPanel) => {
      const i = NLME.pickDownloadMenuIndex(Array.from(inPanel.querySelectorAll()).map(x => x.textContent), preference, { exact });
      return i === -1 ? null : items[i];
    },
    waitForInterceptedUrl: async () => 'https://contribution.usercontent.google.com/d.pdf'
  });
  vm.runInContext(body + '\nthis.click = clickArtifactDownloadButton;', ctx);
  return ctx;
}

test('FORMAT_NOT_OFFERED only when the menu lists a Download item but no PowerPoint', async () => {
  const ctx = clickSandbox(['Download PDF']);
  await assert.rejects(ctx.click({ click() {} }, 'pptx', true), e => e.message === NLME.FORMAT_NOT_OFFERED);
});

test('a menu with no Download item yet stays a retryable "not found" error', async () => {
  const ctx = clickSandbox(['Rename', 'Delete']);
  await assert.rejects(ctx.click({ click() {} }, 'pptx', true), e => e.message === 'Download button not found in menu');
  const empty = clickSandbox([]);
  await assert.rejects(empty.click({ click() {} }, 'pptx', true), e => e.message === 'Download button not found in menu');
});

test('a menu left open is closed before the next item opens its own, and after a miss', async () => {
  const ctx = clickSandbox(['Download PDF']);
  await assert.rejects(ctx.click({ click() {} }, 'pptx', true), e => e.message === NLME.FORMAT_NOT_OFFERED);
  assert.deepEqual(Array.from(ctx.calls), ['close', 'open', 'close']);
});

test('a menu that will not close stops the item instead of clicking in the wrong menu', async () => {
  const ctx = clickSandbox(['Download'], false);
  await assert.rejects(ctx.click({ click() {} }, 'pdf', false), /menu/i);
  assert.deepEqual(Array.from(ctx.calls), ['close']);
});

test('findDownloadButton reads only the given menu, never a stale one on the page', async () => {
  const src = read('content.js');
  const start = src.indexOf('  async function findDownloadButton(');
  const body = src.slice(start, src.indexOf('\n  }\n', start) + 5);
  const stale = { textContent: 'drive_pdfDownload PDF Document (.pdf)' };
  const own = { textContent: 'save_alt Download' };
  const ctx = vm.createContext({
    NLME, console,
    document: { querySelectorAll: () => [stale, own] },
    panel: { querySelectorAll: () => [own] }
  });
  vm.runInContext(body + '\nthis.find = findDownloadButton;', ctx);
  assert.equal(await ctx.find('pdf', false, ctx.panel), own);
});
