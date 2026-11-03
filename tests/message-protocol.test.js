// Guards the extension's message protocol: every message type that some
// context handles must be sent somewhere, and every type that is sent must
// be handled. Dead handlers and orphaned senders fail this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['content.js', 'sidebar.js', 'sidebar-takeout.js', 'background.js', 'injected.js', 'mindmap-extract.js'];

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
