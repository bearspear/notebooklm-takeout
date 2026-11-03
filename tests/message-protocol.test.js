// Guards the extension's message protocol: every message type that some
// context handles must be sent somewhere, and every type that is sent must
// be handled. Dead handlers and orphaned senders fail this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NLME = require('../takeout-shared.js');

const ROOT = path.join(__dirname, '..');
const FILES = ['content.js', 'sidebar-core.js', 'sidebar-artifacts.js', 'sidebar-notes.js', 'sidebar-sources.js', 'sidebar-chat.js', 'sidebar-generated.js', 'sidebar.js', 'sidebar-list.js', 'sidebar-results.js', 'sidebar-takeout.js', 'background.js', 'injected.js', 'mindmap-extract.js'];

// Delivered by window.postMessage between page world and content script
const EXTERNAL = new Set(['NLME_DOWNLOAD_URL_INTERCEPTED']);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
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
    for (const m of code.matchAll(/message\.type === '([A-Z][A-Z0-9_]+)'/g)) add(handled, m[1], file);
    if (file === 'background.js') {
      for (const m of code.matchAll(/case '([A-Z][A-Z0-9_]+)':/g)) add(handled, m[1], file);
    }
    for (const m of code.matchAll(/type:\s*'([A-Z][A-Z0-9_]+)'/g)) add(sent, m[1], file);
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
