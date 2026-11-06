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

test('content scripts never assign the same shared global twice', () => {
  // Content scripts of one block share a global scope. All of them are IIFEs;
  // what they share is what they assign onto globalThis (NLME, NLMEMarkdown,
  // __nlmeMindmap), so two files must never claim the same name
  const assigned = /(?:\bglobalThis|\broot|\bwindow)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  for (const block of contentScriptBlocks()) {
    const owners = new Map();
    const problems = [];
    for (const file of block.filter(f => !VENDORED.test(f))) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const names = new Set([...source.matchAll(assigned)].map(m => m[1]));
      for (const name of names) {
        if (owners.has(name)) problems.push(`${name} assigned in both ${owners.get(name)} and ${file}`);
        else owners.set(name, file);
      }
    }
    assert.ok(owners.has('NLME'), 'scan found no shared globals (NLME missing)');
    assert.deepEqual(problems, [], `Shared global collisions:\n  ${problems.join('\n  ')}`);
  }
});

test('sidebar.html loads takeout-markdown.js after takeout-shared.js and before the sidebar scripts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  const order = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  const at = name => order.indexOf(name);
  assert.ok(at('takeout-markdown.js') > at('takeout-shared.js'), 'takeout-markdown.js must follow takeout-shared.js');
  const firstSidebar = order.findIndex(src => /^sidebar-/.test(src));
  assert.ok(at('takeout-markdown.js') >= 0 && at('takeout-markdown.js') < firstSidebar,
    'takeout-markdown.js must load before the sidebar scripts');
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

test('every setting saveSettings writes has a shipped default, and the panel starts from DEFAULT_SETTINGS', () => {
  const NLME = require('../takeout-shared.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidebar-core.js'), 'utf8');
  const start = src.indexOf('async function saveSettings(');
  assert.ok(start >= 0, 'saveSettings not found');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const keys = [...new Set([...body.matchAll(/settings\.([A-Za-z]+)\s*=(?!=)/g)].map(m => m[1]))];
  assert.ok(keys.length >= 15, `expected the saved settings, found ${keys.length}`);
  for (const k of keys) assert.ok(k in NLME.DEFAULT_SETTINGS, `${k} has no default in NLME.DEFAULT_SETTINGS`);
  assert.match(src, /let settings = NLME\.resetSettings\(\);/);
});

test('every VIEWER_ASSETS file exists', () => {
  require('../takeout-viewer.js');
  const assets = globalThis.NLMEViewer && globalThis.NLMEViewer.VIEWER_ASSETS;
  assert.ok(Array.isArray(assets) && assets.length === 5, 'five viewer assets');
  for (const f of assets) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
});

test('sidebar.html loads takeout-viewer.js right after takeout-job.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  const order = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(order.indexOf('takeout-viewer.js'), order.indexOf('takeout-job.js') + 1);
});

test('the runners hand the capture to every category save; tab-only saves pass none', () => {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['sidebar-sources.js', 'sidebar-notes.js', 'sidebar-chat.js', 'sidebar-artifacts.js']) {
    for (const [call] of read(f).matchAll(/saveCategoryBatch\(.*\);/g)) assert.match(call, /\bcapture\b/, `${f}: ${call}`);
  }
  const artifacts = read('sidebar-artifacts.js');
  const folderSaves = [...artifacts.matchAll(/saveFiles\(place\(.*\);/g)].map(m => m[0]);
  assert.equal(folderSaves.length, 2);
  for (const call of folderSaves) assert.match(call, /\bcapture\b/, call);
  // Tab exports: the single chat file, one artifact, one note
  assert.match(read('sidebar-chat.js'), /await saveFiles\(\[\{ \.\.\.single, path: [^\n]*\.md` \}\]\);/);
  assert.match(artifacts, /saveFiles\(pkg\.entries, \{ zipName: pkg\.zipName \}\);\n\s*else await saveFiles\(files\);/);
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(!manifest.web_accessible_resources, 'the side panel fetches its own files; nothing is exposed to pages');
});

test('manifest grants lh3.google.com, where notebook image URLs redirect', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://lh3.google.com/*'));
  // The approval covers this host only
  assert.equal(manifest.host_permissions.filter(h => /google\.com/.test(h) && !/usercontent/.test(h)).length, 3);
  assert.equal(manifest.host_permissions.length, 6);
});

test('createTurndownService runs text through relaxBracketEscapes', () => {
  const vm = require('node:vm');
  class TurndownService {
    constructor(options) { this.options = options; }
    escape(text) { return `escaped(${text})`; }
  }
  const sandbox = { globalThis: null, TurndownService, NLME: { relaxBracketEscapes: text => `relaxed(${text})` } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'takeout-markdown.js'), 'utf8'), sandbox);
  assert.equal(sandbox.NLMEMarkdown.createTurndownService().escape('x'), 'relaxed(escaped(x))');
});

test('the download hook replaces a stale one, and installs once per takeout-shared', () => {
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(ROOT, 'injected.js'), 'utf8');
  const run = (window, NLME) => vm.runInNewContext(src, Object.assign(Object.create(null), {
    window, document: { addEventListener() {} }, console, Date, URL, CustomEvent: class {},
    globalThis: { NLME }
  }));
  const NLME = { MSG: {}, createInterceptArm: () => ({ arm() {}, shouldIntercept: () => false }) };
  const staleOpen = () => 'stale';
  // A tab left open across an update: the old hook marked itself with `true`
  const window = { __nlmeDownloadHook: true, open: staleOpen, postMessage() {} };
  run(window, NLME);
  const installed = window.open;
  assert.notEqual(installed, staleOpen);
  run(window, NLME);
  assert.equal(window.open, installed);
  run(window, { ...NLME });
  assert.notEqual(window.open, installed);
});

test('an export of notes closes an open note before the health check and the scans', () => {
  // The Studio list is not in the page while a note is open: the check would
  // warn, and a takeout scan would find no notes and no artifacts
  const src = fs.readFileSync(path.join(ROOT, 'sidebar-takeout.js'), 'utf8');
  const shell = src.slice(src.indexOf('async function withExportShell('));
  const close = shell.indexOf('NLME.MSG.NAVIGATE_BACK');
  assert.ok(close > 0, 'withExportShell must close the viewer');
  assert.ok(close < shell.indexOf('NLME.MSG.CHECK_DOM_HEALTH'));
  assert.match(shell.slice(0, close), /healthType === 'notes'/);
});

test('countPageContent leaves price ranges drawn as math out of the formula count', () => {
  const vm = require('node:vm');
  const NLME = require('../takeout-shared.js');
  const src = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const start = src.indexOf('function countPageContent(');
  const body = src.slice(start, src.indexOf('\n}\n', start) + 3);
  const katex = math => ({ closest: () => ({ getAttribute: () => math }) });
  const formulas = [katex('3-'), katex('1-'), katex('x^2'), { closest: () => null }];
  class DOMParser {
    parseFromString() { return { querySelectorAll: selector => (selector === '.katex' ? formulas : []) }; }
  }
  const ctx = vm.createContext({ NLME, DOMParser });
  vm.runInContext(body + '\nthis.count = countPageContent;', ctx);
  assert.equal(ctx.count('').formulas, 2);
});

test('the Turndown list rule writes items through listItemMarkdown', () => {
  const src = fs.readFileSync(path.join(ROOT, 'takeout-markdown.js'), 'utf8');
  const rule = src.slice(src.indexOf("addRule('listsWithWrappers'"), src.indexOf("addRule('tables'"));
  assert.match(rule, /NLME\.listItemMarkdown\(marker, /);
});
test('the Notes, Artifacts and Generated tabs say when an open item hides the Studio list', () => {
  const scans = { 'sidebar-notes.js': 'scanNotesPage', 'sidebar-artifacts.js': 'scanPage', 'sidebar-generated.js': 'scanStudioPage' };
  for (const [file, name] of Object.entries(scans)) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const start = src.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} not found in ${file}`);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    assert.match(body, /await studioViewerOpen\(tab\.id\)/, file);
    assert.match(body, /STUDIO_ITEM_OPEN_HTML/, file);
  }
});

test('a citation popup is closed by mouseleave, not Escape, which does nothing to it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  const start = src.indexOf('async function extractSingleCitationWithRetryInner(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.doesNotMatch(body, /Escape'/);
  // A popup left by the previous citation belongs to that citation's button
  assert.match(body, /leaveCitation\(lastCitationButton \|\| button\)/);
  assert.match(body, /lastCitationButton = button/);
});

test('Full Takeout takes Cancel away before its final save, and gives it back', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sidebar-takeout.js'), 'utf8');
  const finishing = src.indexOf('shell.finishing()');
  assert.ok(finishing > 0 && finishing < src.indexOf("shell.progress('Saving images...', 1)"));
  const shell = src.slice(src.indexOf('async function withExportShell('), src.indexOf('// ---- Full Takeout (Milestone 3a)'));
  assert.match(shell, /finishing\(\) \{/);
  const cleanup = shell.slice(shell.indexOf('finally'));
  assert.match(cleanup, /cancelBtn\.disabled = false/);
});

test('artifact and takeout manifests count errors, not notices', () => {
  for (const file of ['sidebar-artifacts.js', 'sidebar-takeout.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(src, /errorCount: NLME\.countExportErrors\(errors\)/, file);
    assert.doesNotMatch(src, /errorCount: errors\.length/, file);
  }
});

test('a source file records the type the page shows, and leaves out the scan default', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sidebar-sources.js'), 'utf8');
  assert.match(src, /source_type: sourceType/);
  assert.match(src, /sourceFrontMatter\(meta, \{ title: source\.title, variant, youtubeUrl: source\.youtubeUrl, sourceType: source\.sourceType \}\)/);
  assert.match(src, /sourceType: source\.type === 'document' \? null : source\.type \|\| null/);
});

test('Full Takeout gives the viewer the notebook emoji, shown on the cover and the tab', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'sidebar-takeout.js'), 'utf8');
  assert.match(panel, /emoji: meta\.emoji/);
  assert.match(panel, /emoji: await getNotebookEmoji\(tabId\)/);
  const app = fs.readFileSync(path.join(ROOT, 'viewer', 'viewer-app.js'), 'utf8');
  assert.match(app, /class="nb-emoji">' \+ esc\(D\.emoji\)/);
  assert.match(app, /document\.title = \(D\.emoji \? D\.emoji \+ ' ' : ''\)/);
});

test('styles.css has no colour outside the theme blocks', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const rest = css.replace(/\/\* theme:start \*\/[\s\S]*?\/\* theme:end \*\//, '');
  assert.deepEqual(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g), null);
  // Named colours (with an optional shade prefix) used as a declaration value.
  // Pieces ending in `{` are selectors, so they are skipped; one-line rules are covered.
  const NAMED = /(?<![\w-])(?:(?:light|dark|medium|pale|deep)?(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver|navy|teal|maroon|lime|aqua|brown|gold)|whitesmoke|coral|tan|indigo|ivory|beige|khaki|violet|crimson|salmon)(?![\w-])/i;
  const named = [];
  for (const m of rest.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)([{};])/g)) {
    if (m[2] === '{') continue;
    const decl = m[1].match(/^\s*[a-z-]+\s*:([\s\S]*)$/i);
    if (decl && NAMED.test(decl[1].replace(/var\([^)]*\)/g, ''))) named.push(m[1].trim());
  }
  assert.deepEqual(named, []);
});

test('every id the sidebar scripts look up is declared', () => {
  const files = ['sidebar.html', ...fs.readdirSync(ROOT).filter(f => /^sidebar-.*\.js$/.test(f))];
  const text = files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const declared = new Set();
  for (const m of text.matchAll(/\bid=["']([\w-]+)["']/g)) declared.add(m[1]);
  for (const m of text.matchAll(/\.id\s*=\s*['"`]([\w-]+)['"`]/g)) declared.add(m[1]);
  // Looked up but declared nowhere; each is optional (guarded with ?. or a null check)
  const KNOWN_GAPS = {};
  const missing = new Set();
  for (const m of text.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    if (!declared.has(m[1]) && !(m[1] in KNOWN_GAPS)) missing.add(m[1]);
  }
  assert.deepEqual([...missing], []);
});
