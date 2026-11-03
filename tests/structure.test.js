// Guards the extension's script structure. Sidebar scripts are classic
// scripts sharing one global scope, so a top-level name declared twice either
// throws a SyntaxError (let/const/class) or silently overwrites (var/function).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VENDORED = /^(jszip|turndown)(\.min)?\.js$/;

// Order of <script src> tags in sidebar.html, minus vendored libraries
function sidebarScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map(m => m[1])
    .filter(src => !VENDORED.test(path.basename(src)));
}

// Names declared at column 0. takeout-shared.js and takeout-job.js are IIFEs
// (their declarations are indented, so they never match) and only expose
// globalThis.NLME / globalThis.NLMETakeoutJob, which is not a declaration.
function topLevelDeclarations(source) {
  const names = [];
  const re = /^(?:async\s+function\s*\*?|function\s*\*?|class|let|const|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of source.matchAll(re)) names.push(m[1]);
  return names;
}

test('classic scripts declare each top-level name once', () => {
  const owners = new Map();
  const problems = [];
  for (const file of sidebarScripts()) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const name of topLevelDeclarations(source)) {
      if (owners.has(name)) {
        const first = owners.get(name);
        problems.push(first === file
          ? `${name} declared twice in ${file}`
          : `${name} declared in both ${first} and ${file}`);
      } else {
        owners.set(name, file);
      }
    }
  }
  assert.deepEqual(problems, [], `Duplicate top-level declarations:\n  ${problems.join('\n  ')}`);
});

test('content scripts load takeout-shared before content.js', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const js = manifest.content_scripts.map(block => block.js);
  assert.deepEqual(js, [
    ['takeout-shared.js', 'mindmap-extract.js', 'content.js'],
    ['takeout-shared.js', 'injected.js']
  ]);
});
