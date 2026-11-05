// Guards the extension's message protocol: every message type that some
// context handles must be sent somewhere, and every type that is sent must
// be handled. Dead handlers and orphaned senders fail this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NLME = require('../takeout-shared.js');

const ROOT = path.join(__dirname, '..');
// The side panel is split into sidebar-*.js; read the directory so a new
// sidebar file is covered without editing this list.
const SIDEBAR_FILES = fs.readdirSync(ROOT).filter(f => /^sidebar-[a-z-]+\.js$/.test(f)).sort();
const FILES = ['content.js', ...SIDEBAR_FILES, 'background.js', 'injected.js', 'mindmap-extract.js'];

// Delivered by window.postMessage between page world and content script
const EXTERNAL = new Set(['NLME_DOWNLOAD_URL_INTERCEPTED']);

// Zero-match guard: the scan must find at least as many distinct types as it
// did on the 1.6.0 code (handled 30, sent 31). A regex that silently stops
// matching would otherwise make every protocol test pass vacuously.
const BASELINE_HANDLED_TYPES = 30;
const BASELINE_SENT_TYPES = 31;

// content.js handler table, taken from the 1.6.0 if/else chain: the branches
// that ended in an explicit `return true` (response arrives after the listener
// returns, or the branch kept the channel open) are async; the rest respond
// synchronously.
const ASYNC_HANDLERS = [
  'FETCH_FILE', 'EXTRACT_NOTE', 'SCAN_SOURCES', 'EXTRACT_SOURCE', 'NAVIGATE_BACK',
  'SHOW_EXPORT_OVERLAY', 'UPDATE_EXPORT_OVERLAY', 'HIDE_EXPORT_OVERLAY',
  'DOWNLOAD_ARTIFACT', 'SCAN_CHAT', 'EXTRACT_MESSAGE_CITATIONS',
  'RUN_COMPREHENSIVE_HEALTH_CHECK', 'DELETE_STUDIO_ITEM', 'DELETE_SOURCE_NOTE'
];
const SYNC_HANDLERS = [
  'PING', 'GET_PROJECT_NAME', 'REQUEST_EXPORT_CANCEL', 'SCAN_NOTES',
  'CHECK_DOM_HEALTH', 'GET_DOM_ERRORS', 'RESET_DOM_TRACKER', 'SCAN_STUDIO_ITEMS',
  'IS_STUDIO_VIEWER_OPEN', 'GET_NOTEBOOK_EMOJI'
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

// A message type is written as 'X' or as NLME.MSG.X; both forms are scanned.
const TYPE = String.raw`(?:'([A-Z][A-Z0-9_]+)'|NLME\.MSG\.([A-Z][A-Z0-9_]+))`;

// Scans one file's source; returns { handled: [type], sent: [type], tableKeys: [type] }.
function scanSource(code, file) {
  const types = re => [...code.matchAll(re)].map(m => m[1] || m[2]);
  const handled = types(new RegExp(String.raw`message\.type === ` + TYPE, 'g'));
  // case labels: background.js's switch and content.js's page-world postMessage switch
  if (file === 'background.js' || file === 'content.js') handled.push(...types(new RegExp(String.raw`case ` + TYPE + ':', 'g')));
  // handler-table entries: `[NLME.MSG.X]: {` or `'X': {`
  const tableKeys = [
    ...[...code.matchAll(/\[NLME\.MSG\.([A-Z][A-Z0-9_]+)\]\s*:\s*\{\s*async\b/g)].map(m => m[1]),
    ...[...code.matchAll(/'([A-Z][A-Z0-9_]+)'\s*:\s*\{\s*async\b/g)].map(m => m[1])
  ];
  handled.push(...tableKeys);
  const sent = types(new RegExp(String.raw`type:\s*` + TYPE, 'g'));
  return { handled, sent, tableKeys };
}

function collect() {
  const handled = new Map();
  const sent = new Map();
  const add = (map, type, where) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(where);
  };
  for (const file of FILES) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const found = scanSource(code, file);
    for (const t of found.handled) add(handled, t, file);
    for (const t of found.sent) add(sent, t, file);
  }
  return { handled, sent };
}

test('every handled message type has a sender', () => {
  const { handled, sent } = collect();
  const unsent = [...handled.keys()].filter(t => !sent.has(t) && !EXTERNAL.has(t))
    .map(t => `${t} (handled in ${[...new Set(handled.get(t))].join(', ')})`);
  assert.deepEqual(unsent, [], `Handled but never sent:\n  ${unsent.join('\n  ')}`);
});

test('every sent message type has a handler', () => {
  const { handled, sent } = collect();
  const unhandled = [...sent.keys()].filter(t => !handled.has(t) && !EXTERNAL.has(t))
    .map(t => `${t} (sent from ${[...new Set(sent.get(t))].join(', ')})`);
  assert.deepEqual(unhandled, [], `Sent but never handled:\n  ${unhandled.join('\n  ')}`);
});

test('background no longer builds ZIPs', () => {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.doesNotMatch(bg, /jszip/i);
  assert.doesNotMatch(bg, /BATCH_DOWNLOAD_ALL|GET_BATCH_STATUS|CANCEL_BATCH_DOWNLOAD|createZipFromFiles/);
});

test('NLME.MSG lists every message type found by the scan, with equal values', () => {
  const { handled, sent } = collect();
  const found = new Set([...handled.keys(), ...sent.keys()]);
  const missing = [...found].filter(t => NLME.MSG[t] !== t);
  assert.deepEqual(missing, [], `Not in NLME.MSG (or value differs):\n  ${missing.join('\n  ')}`);
  const extra = Object.keys(NLME.MSG).filter(k => !found.has(k) || NLME.MSG[k] !== k);
  assert.deepEqual(extra, [], `In NLME.MSG but never sent or handled:\n  ${extra.join('\n  ')}`);
});

test('the scan understands NLME.MSG.X, string literals and handler-table keys', () => {
  const code = `
    chrome.tabs.sendMessage(id, { type: NLME.MSG.AAA });
    chrome.tabs.sendMessage(id, { type: 'BBB' });
    if (message.type === NLME.MSG.CCC) {}
    if (message.type === 'DDD') {}
    const HANDLERS = { [NLME.MSG.EEE]: { async: true, run() {} }, 'FFF': { async: false, run() {} } };
    switch (x) { case NLME.MSG.GGG: break; case 'HHH': break; }`;
  const found = scanSource(code, 'background.js');
  assert.deepEqual([...found.sent].sort(), ['AAA', 'BBB']);
  assert.deepEqual([...found.handled].sort(), ['CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH']);
  assert.deepEqual([...found.tableKeys].sort(), ['EEE', 'FFF']);
});

test('the scan finds at least as many message types as on the 1.6.0 code', () => {
  const { handled, sent } = collect();
  assert.ok(sent.size > 0, 'scan found no sent types');
  assert.ok(handled.size >= BASELINE_HANDLED_TYPES, `handled types ${handled.size} < baseline ${BASELINE_HANDLED_TYPES}`);
  assert.ok(sent.size >= BASELINE_SENT_TYPES, `sent types ${sent.size} < baseline ${BASELINE_SENT_TYPES}`);
});

test('the sidebar file list comes from the directory', () => {
  assert.ok(SIDEBAR_FILES.includes('sidebar-core.js') && SIDEBAR_FILES.includes('sidebar-takeout.js'));
  assert.ok(!SIDEBAR_FILES.some(f => !f.startsWith('sidebar-')));
});

test('every NLME.MSG.X reference names an existing key', () => {
  const bad = [];
  for (const file of FILES) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const m of code.matchAll(/NLME\.MSG\.([A-Za-z0-9_]+)/g)) {
      if (NLME.MSG[m[1]] !== m[1]) bad.push(`${m[1]} (${file})`);
    }
  }
  assert.deepEqual(bad, [], `Unknown NLME.MSG keys:\n  ${bad.join('\n  ')}`);
});

test('every handler table entry is sent and every sent type has an entry', () => {
  const { handled, sent } = collect();
  const contentTable = scanSource(stripComments(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8')), 'content.js').tableKeys;
  assert.equal(new Set(contentTable).size, contentTable.length, 'duplicate handler table keys in content.js');
  const table = new Set(contentTable);
  // every entry is sent from somewhere
  const unsent = [...table].filter(t => !sent.has(t));
  assert.deepEqual(unsent, [], `Handler table entries never sent:\n  ${unsent.join('\n  ')}`);
  // every sent type has a content.js entry, unless another context handles it
  const handledElsewhere = t => (handled.get(t) || []).some(f => f !== 'content.js');
  const orphan = [...sent.keys()].filter(t => !table.has(t) && !handledElsewhere(t) && !EXTERNAL.has(t));
  assert.deepEqual(orphan, [], `Sent but neither in the handler table nor handled elsewhere:\n  ${orphan.join('\n  ')}`);
  // the table is exactly the 1.6.0 branch list
  assert.deepEqual([...table].sort(), [...ASYNC_HANDLERS, ...SYNC_HANDLERS].sort());
});

test('handler table async flags match the 1.6.0 branches that returned true', () => {
  const code = stripComments(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'));
  const flags = new Map([...code.matchAll(/\[NLME\.MSG\.([A-Z][A-Z0-9_]+)\]\s*:\s*\{\s*async:\s*(true|false)\b/g)].map(m => [m[1], m[2] === 'true']));
  assert.equal(flags.size, ASYNC_HANDLERS.length + SYNC_HANDLERS.length, 'handler table not found in content.js');
  for (const t of ASYNC_HANDLERS) assert.equal(flags.get(t), true, `${t} must be async: true`);
  for (const t of SYNC_HANDLERS) assert.equal(flags.get(t), false, `${t} must be async: false`);
});
