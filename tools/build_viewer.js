#!/usr/bin/env node
// Usage: node tools/build_viewer.js <takeout-root> <out.html> [--allow-downloads]
// Builds the offline viewer page for an unzipped Full Takeout folder.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
require('../takeout-viewer.js');
const V = globalThis.NLMEViewer;

function fail(msg) { console.error(msg); process.exit(1); }

const args = process.argv.slice(2);
const allowDownloads = args.includes('--allow-downloads');
const pos = args.filter(a => !a.startsWith('--'));
if (pos.length !== 2) fail('Usage: node tools/build_viewer.js <takeout-root> <out.html> [--allow-downloads]');
const root = path.resolve(pos[0]);
const out = path.resolve(pos[1]);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('Not a folder: ' + root);

const downloads = path.join(os.homedir(), 'Downloads');
const inside = (dir, p) => { const r = path.relative(dir, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
if (inside(downloads, out) && !allowDownloads) fail('Refusing to write inside ' + downloads + ' (pass --allow-downloads to override).');

const files = {};
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
    else if (e.isFile()) {
      const text = V.wantsText(r) || r === 'artifacts/manifest.json' || /(^|\/)part-\d+\/artifacts\/manifest\.json$/.test(r);
      files[r] = text ? fs.readFileSync(path.join(dir, e.name), 'utf8') : null;
    }
  }
})(root, '');

let notebook = '', exported = '';
try {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  notebook = typeof m.notebook === 'string' ? m.notebook : (m.notebook && m.notebook.title) || '';
  exported = m.exported || '';
} catch (e) { /* no manifest: untitled */ }

let rel = path.relative(path.dirname(out), root).split(path.sep).filter(Boolean).map(encodeURIComponent).join('/');
const mediaBase = rel ? rel + '/' : '';

const base = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');
const [template, app, marked, katex, css] = ['viewer/viewer-template.html', 'viewer/viewer-app.js', 'viewer/marked.min.js', 'viewer/katex.min.js', 'viewer/katex-inline.css'].map(read);
const data = V.buildViewerData(files, { notebook, exported, mediaBase });
const html = V.assembleViewer({ template, css, marked, katex, app, data });

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${data.sources.length} sources, ${data.studio.length} studio items, ${data.pairs.length} Q&A, ${data.pairs.reduce((n, p) => n + p.n, 0)} chat citations, ${data.cites.length} unique citation records`);
