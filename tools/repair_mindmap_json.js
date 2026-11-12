#!/usr/bin/env node
// Usage: node tools/repair_mindmap_json.js <export-or-takeout-folder | file.json> [--write]
// Repairs the parent links in artifacts/mind-maps/*.json written by v1 before 1.9.17
// (every deeper node sat under the last branch). Dry run unless --write is given.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('../mindmap-extract.js');
const { rebuildMindmapTree } = globalThis.__nlmeMindmap;

const args = process.argv.slice(2);
const write = args.includes('--write');
const pos = args.filter(a => !a.startsWith('--'));
if (pos.length !== 1 || args.some(a => a.startsWith('--') && a !== '--write')) {
  console.error('Usage: node tools/repair_mindmap_json.js <folder | file.json> [--write]');
  process.exit(2);
}
const target = path.resolve(pos[0]);
if (!fs.existsSync(target)) { console.error('Not found: ' + target); process.exit(2); }

function findFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, out);
    else if (e.isFile() && e.name.endsWith('.json') &&
      path.basename(dir) === 'mind-maps' && path.basename(path.dirname(dir)) === 'artifacts') out.push(p);
  }
  return out;
}

// Structure only: names and levels down the tree
const shape = n => n && { name: n.name, level: n.level, children: Array.isArray(n.children) ? n.children.map(shape) : [] };

function process1(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return 'skipped ' + file + ': unreadable JSON (' + e.message + ')'; }
  if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return 'skipped ' + file + ': no nodes list';
  const list = data.nodes.map(n => ({
    name: n && n.name, level: n && n.level, expanded: n && n.expanded,
    children: [], childCount: n && n.childCount
  }));
  if (list.some(n => !Number.isInteger(n.level) || !Number.isInteger(n.childCount))) {
    return 'skipped ' + file + ': nodes lack level or childCount';
  }
  const r = rebuildMindmapTree(list);
  if (!r || !r.ok) return 'skipped ' + file + ": counts don't add up";
  if (JSON.stringify(shape(list[0])) === JSON.stringify(shape(data.root))) return 'ok ' + file;
  if (write) {
    data.root = list[0];
    data.nodes = list;
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  return 'fixed ' + file;
}

const files = fs.statSync(target).isDirectory() ? findFiles(target, []).sort() : [target];
let skipped = 0;
for (const f of files) {
  const line = process1(f);
  if (line.startsWith('skipped')) skipped++;
  console.log(line);
}
process.exit(skipped ? 1 : 0);
