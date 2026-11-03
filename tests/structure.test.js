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

test('every non-IIFE sidebar script yields top-level names', () => {
  // Guards the scan above: a file the regex cannot read would pass it silently
  const empty = sidebarScripts()
    .filter(file => path.basename(file).startsWith('sidebar'))
    .filter(file => topLevelDeclarations(fs.readFileSync(path.join(ROOT, file), 'utf8')).length === 0);
  assert.deepEqual(empty, [], `No top-level names found in: ${empty.join(', ')}`);
});

function contentScriptBlocks() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  return manifest.content_scripts.map(block => block.js);
}

test('content scripts load takeout-shared and takeout-markdown before content.js', () => {
  assert.deepEqual(contentScriptBlocks(), [
    ['takeout-shared.js', 'takeout-markdown.js', 'mindmap-extract.js', 'content.js'],
    ['takeout-shared.js', 'injected.js']
  ]);
});

test('the side panel re-injects the same content scripts as the manifest', () => {
  // ensureContentScriptLoaded injects these after a reload; a file missing
  // there leaves content.js without NLME or NLMEMarkdown
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const m = core.match(/files:\s*\[([^\]]*content\.js[^\]]*)\]/);
  assert.ok(m, 'content script injection list not found in sidebar-core.js');
  const files = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(files, contentScriptBlocks()[0]);
});

test('content scripts declare each top-level name once', () => {
  // Content scripts of one block share a global scope, like the sidebar
  for (const block of contentScriptBlocks()) {
    const owners = new Map();
    const problems = [];
    for (const file of block.filter(f => !VENDORED.test(f))) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const name of topLevelDeclarations(source)) {
        if (owners.has(name)) problems.push(`${name} declared in both ${owners.get(name)} and ${file}`);
        else owners.set(name, file);
      }
    }
    assert.deepEqual(problems, [], `Duplicate top-level declarations:\n  ${problems.join('\n  ')}`);
  }
});

test('takeout-markdown.js exposes the converter API without needing Turndown at load', () => {
  // Content scripts load it without turndown.min.js: nothing may touch
  // TurndownService until createTurndownService / createConverter is called
  const vm = require('node:vm');
  const sandbox = { globalThis: null, NLME: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'takeout-markdown.js'), 'utf8'), sandbox);
  const api = sandbox.NLMEMarkdown;
  for (const fn of ['createTurndownService', 'convertKatexNodeToLatex', 'createConverter', 'htmlToMarkdownPlain']) {
    assert.equal(typeof api[fn], 'function', fn);
  }
  assert.equal(api.htmlToMarkdownPlain(null), '');
});
