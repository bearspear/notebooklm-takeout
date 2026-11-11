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

test('sidebar.html loads the export sheet right after the core', () => {
  const scripts = sidebarScripts();
  assert.ok(scripts.includes('sidebar-sheet.js'));
  assert.ok(scripts.indexOf('sidebar-sheet.js') > scripts.indexOf('sidebar-core.js'));
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
  const close = shell.indexOf('await closeOpenStudioItem(tab.id)');
  assert.ok(close > 0, 'withExportShell must close the viewer');
  assert.ok(close < shell.indexOf('NLME.MSG.CHECK_DOM_HEALTH'));
  assert.match(shell.slice(0, close), /healthType === 'notes'/);
  assert.match(fnSource('sidebar-takeout.js', 'closeOpenStudioItem'), /type: NLME\.MSG\.NAVIGATE_BACK/);
});

test('Resume closes an open Studio item before it scans notes or artifacts', () => {
  const resume = fnSource('sidebar-takeout.js', 'resumeJob');
  const close = resume.indexOf('await closeOpenStudioItem(tabId)');
  assert.ok(close > 0 && close < resume.indexOf('for (const { category, name, scan, regionOfType } of RESUME_CATEGORIES)'));
});

test('countPageContent leaves price ranges drawn as math out of the formula count', () => {
  const vm = require('node:vm');
  const NLME = require('../takeout-shared.js');
  const src = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const start = src.indexOf('function countPageContent(');
  const body = src.slice(start, src.indexOf('\n}\n', start) + 3);
  const katex = math => ({ closest: () => ({ getAttribute: () => math }) });
  const formulas = [katex('3-'), katex('1-'), katex('x^2'), katex('Printed on acid-free paper. TCF'), { closest: () => null }];
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
test('the Notes and Generated tabs say when an open item hides the Studio list', () => {
  const scans = { 'sidebar-notes.js': 'scanNotesPage', 'sidebar-generated.js': 'scanStudioPage' };
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
  assert.ok(finishing > 0 && finishing < src.indexOf("shell.progress('Saving images...')"));
  const shell = src.slice(src.indexOf('async function withExportShell('), src.indexOf('// ---- Full Takeout (Milestone 3a)'));
  assert.match(shell, /finishing\(\) \{/);
  const cleanup = shell.slice(shell.indexOf('finally'));
  assert.match(cleanup, /cancelBtn\.disabled = false/);
  assert.match(cleanup, /cancelBtn\.hidden = false/);
  assert.match(shell.slice(shell.indexOf('finishing() {')), /cancelBtn\.hidden = true/);
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
  assert.match(src, /sourceFrontMatter\(meta, \{ title: source\.title, variant, youtubeUrl: source\.youtubeUrl, sourceType: source\.sourceType, sourceUrl: source\.sourceUrl \}\)/);
  // the scan default 'document' left out (web sources: tests/web-source.test.js)
  assert.match(src, /const typeFields = NLME\.sourceTypeFields\(source\);/);
  assert.match(src, /\.\.\.typeFields,/);
  assert.deepEqual(NLME.sourceTypeFields({ type: 'document' }), { sourceType: null, sourceUrl: null });
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

test('panel has no emoji in its markup', () => {
  // The panel uses one stroke icon set (icon() in sidebar-core.js). Emoji and
  // check marks in panel UI are replaced; exported content is not panel UI and
  // may keep them, but must be listed here with a reason.
  const ALLOWED = [
    // { file: 'sidebar-x.js', text: '...', reason: '...' }
  ];
  const EMOJI = /[\p{Extended_Pictographic}✓✗✔✖️]/u;
  const files = ['sidebar.html', ...fs.readdirSync(ROOT).filter(f => /^sidebar-.*\.js$/.test(f))];
  const problems = [];
  for (const file of files) {
    fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      if (!EMOJI.test(line)) return;
      if (ALLOWED.some(a => a.file === file && line.includes(a.text))) return;
      problems.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(problems, [], `Emoji in panel files:\n  ${problems.join('\n  ')}`);
});

// ---- Generated tab: the parts a person cannot afford to get wrong ----

const vmModule = require('node:vm');

function fnSource(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} not found in ${file}`);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
}

function generatedChain() {
  const generated = fs.readFileSync(path.join(ROOT, 'sidebar-generated.js'), 'utf8');
  const steps = generated.slice(generated.indexOf('const GENERATED_EXPORT_STEPS'), generated.indexOf('];\n', generated.indexOf('const GENERATED_EXPORT_STEPS')) + 3);
  const calls = [];
  const ctx = vmModule.createContext({ calls, console, showToast() {}, TAKEOUT_RETRY_STEPS: [] });
  vmModule.runInContext(`
    let chainActive = false, chainCancelRequested = false, chainHolds = 0, chainProgress = null, holdStepResults = false, heldStepResults = null;
    const hideProgressView = () => {};
    const chainTabOnRunNotebook = async () => true;
    const ok = message => ({ result: { failedItems: [] }, message, level: 'success', saved: [], errors: [] });
    this.cancelAfterArtifacts = false;
    const downloadAllArtifacts = async (...args) => {
      calls.push(['artifacts', ...args]);
      if (this.cancelAfterArtifacts) chainCancelRequested = true;
      return ok('a');
    };
    const exportNotesAsMarkdown = async (...args) => { calls.push(['notes', ...args]); return ok('n'); };
    ${fnSource('sidebar-takeout.js', 'runChain')}
    ${fnSource('sidebar-takeout.js', 'runRetryChain')}
    ${steps}
    this.run = (items, seeds) => runChain(() => runRetryChain(items, 7, 'Export', GENERATED_EXPORT_STEPS, undefined, seeds));
  `, ctx);
  return { ctx, calls };
}

test('a Generated export runs artifacts, then notes, as fresh exports on the scanned tab', async () => {
  const { ctx, calls } = generatedChain();
  const { steps, notRun } = await ctx.run({ Artifacts: ['a1'], Notes: ['n1'] });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['artifacts', 7, ['a1'], {}], ['notes', ['n1'], { tabId: 7 }]]);
  assert.deepEqual([steps.length, notRun.length], [2, 0]);
});

test('a Generated export hands the skipped items\' warnings to the side named for them', async () => {
  const warning = { type: 'skipped_ambiguous', title: 'Deck', message: 'still being generated or has no menu' };
  const { ctx, calls } = generatedChain();
  await ctx.run({ Artifacts: ['a1'], Notes: ['n1'] }, { Artifacts: { seedErrors: [warning], recordFailed: ['a2'] } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['artifacts', 7, ['a1'], { seedErrors: [warning], recordFailed: ['a2'] }], ['notes', ['n1'], { tabId: 7 }]]);
  const notesOnly = generatedChain();
  await notesOnly.ctx.run({ Artifacts: [], Notes: ['n1'] }, { Notes: { seedErrors: [warning] } });
  assert.deepEqual(JSON.parse(JSON.stringify(notesOnly.calls)), [['notes', ['n1'], { tabId: 7, seedErrors: [warning] }]]);
});

test('the Studio export seeds its no-More skips: artifacts side (and its record) first, else notes as Studio items', () => {
  const run = fnSource('sidebar-generated.js', 'runGeneratedExport');
  assert.match(run, /NLME\.generatedExportPlan\(_studioListController \? _studioListController\.selectedItems\(\) : \[\], _studioItems\)/);
  // Every plan in the Studio tab sees the whole list, for the shared titles
  const generated = fs.readFileSync(path.join(ROOT, 'sidebar-generated.js'), 'utf8');
  assert.equal([...generated.matchAll(/NLME\.generatedExportPlan\(/g)].length, [...generated.matchAll(/NLME\.generatedExportPlan\([^\n]*, _studioItems\)/g)].length);
  assert.match(run, /const skipWarnings = plan\.noMenuWarnings;/);
  assert.match(run, /plan\.artifacts\.length \? \{ Artifacts: \{ seedErrors: skipWarnings, recordFailed: plan\.noMenu \} \}/);
  assert.match(run, /\{ Notes: \{ seedErrors: skipWarnings\.map\(w => \(\{ \.\.\.w, title: `Studio: \$\{w\.title\}`, prefixed: true \}\)\) \} \}/);
  const artifacts = fnSource('sidebar-artifacts.js', 'downloadAllArtifacts');
  assert.match(artifacts, /withJobRecord\(shell, 'artifacts', 'Artifacts', 'artifacts', \[\.\.\.items, \.\.\.recordFailed\]/);
  assert.match(artifacts, /recordFailed\.forEach\(item => tracker\.fail\('artifacts', item\)\)/);
  assert.match(run, /runRetryChain\(\{ Artifacts: plan\.artifacts, Notes: plan\.notes \}, tabId, 'Export', GENERATED_EXPORT_STEPS, zip, seeds\)/);
});

test('a Cancel between the artifact side and the note side stops the notes', async () => {
  const { ctx, calls } = generatedChain();
  ctx.cancelAfterArtifacts = true;
  const { steps, notRun } = await ctx.run({ Artifacts: ['a1'], Notes: ['n1'] });
  assert.deepEqual(calls.map(c => c[0]), ['artifacts']);
  assert.equal(steps.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(notRun)), [{ name: 'Notes', failedItems: ['n1'] }]);
});

test('a Generated export with one side empty runs only the other', async () => {
  const { ctx, calls } = generatedChain();
  await ctx.run({ Artifacts: [], Notes: ['n1'] });
  assert.deepEqual(calls.map(c => c[0]), ['notes']);
});

test('Generated keeps the delete guards', () => {
  const send = fnSource('sidebar-generated.js', 'sendStudioDelete');
  assert.match(send, /useIndex \? \{ label: item\.label, combinedIndex: item\.combinedIndex \} : \{ label: item\.label \}/);
  assert.match(fnSource('sidebar-generated.js', 'handleStudioBulkDelete'), /useIndex: false/);
  assert.match(fnSource('sidebar-generated.js', 'handleStudioBulkDelete'), /NLME\.bulkDeletePlan\(/);
  // Both deletes ask first, in the panel's own danger dialog
  const row = fnSource('sidebar-generated.js', 'handleStudioDeleteRow');
  assert.match(row, /await showDialog\(\{\s*title: `Delete "\$\{item\.label\}"\?`[\s\S]*danger: true[\s\S]*if \(!sure \|\| !await studioDeleteStillValid\(target\)\) return;/);
  const bulkDelete = fnSource('sidebar-generated.js', 'handleStudioBulkDelete');
  assert.match(bulkDelete, /await showDialog\(\{[\s\S]*\$\{skippedNote\}[\s\S]*confirmLabel: `Delete \$\{n\}`[\s\S]*danger: true[\s\S]*if \(!sure \|\| !await studioDeleteStillValid\(target\)\) return;/);
  // Hidden with its tab; off during a job
  const bulk = fnSource('sidebar-generated.js', 'updateStudioBulkButtonsState');
  assert.match(bulk, /deleteBulkBtn\.hidden = !controller \|\| openPanelTab\(\) !== 'studio'/);
  assert.match(bulk, /deleteBulkBtn\.disabled = deletableN === 0 \|\| !!jobLock\.current\(\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8'), /\.tab-content select, #action-btn, #studio-delete-selected-btn/);
});

test('the panel has one tab per list, in order, and nothing left of the Artifacts tab', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/class="tab-btn[^"]*" data-tab="(\w+)"/g)].map(m => m[1]), ['sources', 'notes', 'studio', 'chat']);
  assert.doesNotMatch(html, /data-tab="studio" hidden|data-tab-content="studio" hidden|data-tab(-content)?="artifacts"/);
  const files = ['sidebar.html', 'styles.css', ...fs.readdirSync(ROOT).filter(f => /^sidebar-.*\.js$/.test(f))];
  const text = files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.doesNotMatch(text, /\bscanPage\b|dropArtifactsList|updateArtifactsDownloadBtn|applyStudioTabVisibility|show-studio-tab-checkbox|download-all-btn|studio-download-selected-btn|"zip-checkbox|'zip-checkbox|artifact-count|export-controls/);
});

test('the first paint is Home: no tab active, no action bar, Back hidden', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  assert.doesNotMatch(html, /tab-btn active|tab-content active/);
  assert.match(html, /<div class="tabs"[^>]* hidden>/);
  assert.match(html, /<div id="action-bar" class="action-bar" hidden>/);
  assert.match(html, /<button id="back-btn"[^>]* aria-label="Back to Home" hidden>/);
  assert.ok(html.indexOf('id="home-view"') < html.indexOf('class="tabs"'), 'Home comes before the tabs');
  for (const id of ['full-takeout-btn', 'resume-banner']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > html.indexOf('id="home-view"') && at < html.indexOf('class="tabs"'), `${id} is on Home`);
  }
  // A job's panels show in every view: outside Home and outside every tab
  const lastTab = html.lastIndexOf('data-tab-content=');
  for (const id of ['download-progress', 'results-panel']) assert.ok(html.indexOf(`id="${id}"`) > lastTab, id);
  assert.doesNotMatch(html + fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'), /takeout-row/);
});

test('Home counts with the lists\' own data and never scans the chat', () => {
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const scans = core.slice(core.indexOf('const HOME_SCANS'), core.indexOf('const homeGate'));
  for (const name of ['scanSourcesData', 'scanNotesData', 'scanGeneratedItems']) assert.ok(scans.includes(name), name);
  assert.doesNotMatch(scans, /scanArtifactsData|scanChat/); // artifacts only: not the Generated list
  assert.match(fnSource('sidebar-generated.js', 'scanStudioPage'), /await scanGeneratedItems\(tab\.id\)/);
  const refresh = fnSource('sidebar-core.js', 'refreshHome') + fnSource('sidebar-core.js', 'readHomeCounts');
  assert.doesNotMatch(refresh, /scanChat|scrollTo|\.click\(/);
  assert.match(refresh, /jobLock\.current\(\)/);
  assert.match(refresh, /settleWaits/);
  assert.match(fnSource('sidebar-core.js', 'setTabCount'), /paintHomeRow\(tab\)/);
});

test('settings reach storage through one guarded write', () => {
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  assert.equal([...core.matchAll(/storage\.local\.set\(\{ settings \}\)/g)].length, 1);
  assert.match(fnSource('sidebar-core.js', 'writeSettings'), /if \(settingsStored\) \{\s+try \{\s+await chrome\.storage\.local\.set\(\{ settings \}\)/);
});

test('a refused settings write says so, undoes what asked to, and never rejects', async () => {
  const vm = require('node:vm');
  const toasts = [];
  let undone = 0;
  const sandbox = {
    settingsStored: true, realSettings: () => ({}), console: { warn() {} }, showToast: text => toasts.push(text),
    chrome: { storage: { local: { set: async () => { throw new Error('refused'); } } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource('sidebar-core.js', 'writeSettings'), sandbox);
  assert.equal(await sandbox.writeSettings({ undo: () => { undone++; } }), false);
  assert.equal(await sandbox.writeSettings(), false);
  assert.equal(undone, 1);
  assert.deepEqual(toasts, ['Could not save settings', 'Could not save settings']);
});

test('the retired Settings controls and the chat citation line are gone, with their readers', () => {
  const pages = ['sidebar.html', 'styles.css', 'sidebar-core.js', 'sidebar-chat.js', 'sidebar-takeout.js', 'sidebar-results.js']
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  for (const gone of ['auto-zip-checkbox', 'export-note-with-images-checkbox', 'export-source-with-images-checkbox', 'chat-citation-info', 'updateChatCitationInfo', 'hideResults', 'results-dismiss']) {
    assert.ok(!pages.includes(gone), gone);
  }
});

test('Default preset and Default save reach settings through saveSettings only', () => {
  const save = fnSource('sidebar-core.js', 'saveSettings');
  assert.match(save, /settings\.exportPreset = document\.getElementById\('default-preset-select'\)\.value/);
  assert.match(save, /settings\.takeoutZip = document\.getElementById\('default-save-select'\)\.value === 'zip'/);
  assert.match(save, /await writeSettings\(\{ undo \}\)/);
  assert.doesNotMatch(save, /autoZip|exportNoteWithImages|exportSourceWithImages/);
  assert.doesNotMatch(fnSource('sidebar-core.js', 'applySettingsToUi'), /autoZip|exportNoteWithImages|exportSourceWithImages/);
});

test('Artifacts with no sheet choice take the default save', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'sidebar-artifacts.js'), 'utf8'), /async function downloadAllArtifacts\(tabId, items, \{ updateRecord = false, zip = NLME\.takeoutZipChoice\(settings\), seedErrors = \[\], recordFailed = \[\] \} = \{\}\)/);
});

test('the progress view keeps its ids, and only its text is a live region', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  const view = html.slice(html.indexOf('id="download-progress"'), html.indexOf('id="results-panel"'));
  for (const id of ['progress-fill', 'progress-text', 'progress-count', 'progress-left', 'cancel-download-btn']) assert.ok(view.includes(`id="${id}"`), id);
  assert.equal([...view.matchAll(/aria-live/g)].length, 1);
  assert.match(view, /id="progress-text"[^>]*aria-live="polite"/);
  assert.match(view, /Keep this notebook tab visible\. Chrome slows hidden tabs\./);
});

test('the view under the dock cannot be moved, so no hidden scan starts', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  for (const hidden of ['body.docked .tabs', 'body.docked #back-btn']) assert.ok(css.includes(hidden), hidden);
});

test('a chain shows its combined results before it lets the view go', () => {
  const retry = fnSource('sidebar-takeout.js', 'takeoutRetry');
  assert.ok(retry.indexOf('showTakeoutResults(') < retry.lastIndexOf('})'));
  assert.match(retry, /runChain\(async \(\) => \{[^]*restore\(\);[^]*showTakeoutResults\(/);
});

test('every Retry goes through the one check of the run\'s notebook', () => {
  const results = fs.readFileSync(path.join(ROOT, 'sidebar-results.js'), 'utf8');
  assert.match(results, /if \(await retryMayStart\(\)\) await retry\.run\(\);/);
  assert.equal([...results.matchAll(/retry\.run\(/g)].length, 1);
});

test('Full Takeout and Resume wait for the notes list; Home and Generated ask for the strict scan', () => {
  const takeout = fs.readFileSync(path.join(ROOT, 'sidebar-takeout.js'), 'utf8');
  assert.match(takeout, /await scanNotesSettled\(tabId, \{\s+isCancelled: shell\.isCancelled,\s+onPartial:/);
  assert.match(takeout, /scan: \(tabId, \{ onPartial \} = \{\}\) => scanNotesSettled\(tabId, \{ isCancelled: \(\) => chainCancelRequested, onPartial \}\)/);
  assert.doesNotMatch(takeout, /scanNotesData\(/);
  assert.match(fnSource('sidebar-generated.js', 'scanGeneratedItems'), /scanNotesData\(tabId, \{ strict: true \}\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8'), /scanNotesData\(tabId, \{ strict: true \}\)/);
});

test('a failed scan never reads as an empty list', async () => {
  const vm = require('node:vm');
  let answers = {};
  const sandbox = {
    NLME: { MSG: { SCAN_NOTES: 'n', SCAN_STUDIO_ITEMS: 's' }, stampGeneratedJobKeys() {}, stampTitleOrdinals: list => list },
    chrome: { tabs: { sendMessage: async (id, m) => answers[m.type] } },
    ensureContentScriptLoaded: async () => {}, stampJobKeys() {}, console: { warn() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource('sidebar-notes.js', 'scanNotesData') + fnSource('sidebar-notes.js', 'stampNoteOrdinals') + fnSource('sidebar-generated.js', 'scanGeneratedItems'), sandbox);
  const { scanNotesData, scanGeneratedItems } = sandbox;
  answers = { n: undefined };
  assert.equal((await scanNotesData(1)).length, 0); // the default the Notes tab keeps
  await assert.rejects(scanNotesData(1, { strict: true }), /No response/);
  answers = { n: { error: 'boom' } };
  await assert.rejects(scanNotesData(1, { strict: true }), /boom/);
  answers = { n: { notes: [] } };
  assert.equal((await scanNotesData(1, { strict: true })).length, 0); // a real empty list
  answers = { s: undefined };
  await assert.rejects(scanGeneratedItems(1), /No response/);
  answers = { s: { items: [], error: 'boom' } };
  await assert.rejects(scanGeneratedItems(1), /boom/);
  answers = { s: { items: [{ kind: 'artifact' }] }, n: undefined };
  assert.equal((await scanGeneratedItems(1)).length, 1); // a failed notes side-scan lists Studio items only
});

test('the export sheet is a labelled modal outside what it covers, with native radios', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  const start = html.indexOf('id="export-sheet"');
  assert.ok(start > 0, 'export sheet markup');
  const sheet = html.slice(start, html.indexOf('<script', start));
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /aria-modal="true"/);
  assert.match(sheet, /aria-labelledby="export-sheet-title"/);
  assert.match(sheet, /id="export-sheet-title"/);
  for (const preset of ['archive', 'ai', 'custom']) assert.match(sheet, new RegExp(`<input type="radio" name="sheet-preset" value="${preset}"`));
  for (const copy of ['Full quotes and image copies', 'Source titles only, no image copies', 'Choose citations and file options', 'Start export']) assert.ok(sheet.includes(copy), copy);
  // Settings' own wording for the three citation choices
  for (const option of ['Full quotes (slower)', 'Source titles only (fast)', 'No citations (plain text, fast)']) {
    assert.ok(sheet.includes(option), option);
    assert.ok(html.slice(0, start).includes(option), `${option} in Settings`);
  }
  // A modal covers the panel: .container goes inert under it, so it must be outside
  const before = html.slice(0, html.lastIndexOf('<div', start));
  const depth = before.match(/<div\b/g).length - before.match(/<\/div>/g).length;
  assert.equal(depth, 0, 'the sheet sits at the top of body');
});

test('the retired ZIP tick is gone, with its reader', () => {
  const files = ['sidebar.html', 'styles.css', 'AGENT.md', 'README.md', ...sidebarScripts()];
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(src, /takeout-zip-checkbox|takeoutZipEnabled|\.takeout-zip\b|class="takeout-zip"/, file);
  }
});

test('every export reaches its job through the sheet or the run settings, under the lock', () => {
  const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
  // A list's action opens the sheet; the job itself is the sheet's start
  for (const [file, name] of [['sidebar-notes.js', 'exportSelectedNotes'], ['sidebar-sources.js', 'exportSelectedSources'], ['sidebar-generated.js', 'exportSelectedGenerated'], ['sidebar-chat.js', 'openChatExportSheet'], ['sidebar-takeout.js', 'openExportEverythingSheet']]) {
    const src = read(file);
    const at = src.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
    assert.ok(at >= 0, name);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    assert.match(body, /openExportSheet\(\{/, name);
    assert.match(body, /runExclusive\([^]*withRunSettings\(overrides/, name);
  }
  // Row downloads have no sheet: the default preset, Custom's values included
  assert.match(fnSource('sidebar-core.js', 'runRowExport'), /runExclusive\(name, async \(\) => \{\s+if \(await rowMayStart\(\)\) return withRunSettings\(NLME\.runOverrides\(settings\), fn\);/);
  assert.match(read('sidebar-notes.js'), /runRowExport\('Note export', /);
  assert.match(read('sidebar-sources.js'), /runRowExport\('Sources export', \(\) => exportSources\(\[source\], \{ record: false \}\)\)/);
  assert.match(read('sidebar-generated.js'), /runRowExport\('Studio download', \(\) => handleStudioDownloadRow\(item, downloadBtn\)\)/);
  assert.doesNotMatch(read('sidebar-notes.js') + read('sidebar-sources.js') + read('sidebar-generated.js'), /presetOverrides/);
});

test('an export rechecks the tab at Start and at the Export everything click', () => {
  const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.match(read('sidebar-sheet.js'), /if \(await tabStillOnPanelNotebook\(\)\) outcome = await start\(run\);/);
  const takeout = read('sidebar-takeout.js');
  const at = takeout.indexOf('async function openExportEverythingSheet(');
  assert.ok(at >= 0);
  assert.ok(takeout.indexOf('tabStillOnPanelNotebook', at) < takeout.indexOf('openExportSheet({', at));
});

test('a full page load holds the export buttons, and every way out lets go', () => {
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const fn = name => {
    const start = core.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
    return core.slice(start, core.indexOf('\n}\n', start));
  };
  assert.match(fn('handleTabUpdate'), /if \(changeInfo\.url\) notePageMove\(changeInfo\);/);
  assert.match(fn('applyAction'), /!!pageLoadHold/);
  for (const name of ['handleTabChange', 'resetChatPanel', 'handleTabUpdate', 'notePageMove', 'endStalledPageLoad']) assert.match(fn(name), /releasePageLoad\(\)/, name);
  assert.match(fn('holdForPageLoad'), /setTimeout\(\(\) => endStalledPageLoad\(hold\), PAGE_LOAD_HOLD_MS\)/);
});

test('a notebook switch closes the sheet, and Settings and Health Check do too', () => {
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const switched = core.slice(core.indexOf('function resetChatPanel('), core.indexOf('\n}\n', core.indexOf('function resetChatPanel(')));
  assert.match(switched, /closeExportSheet\(\{ switched: true \}\)/);
  assert.match(core, /'settings-btn'\)\.addEventListener\('click', \(\) => \{\s+closeExportSheet\(\);/);
  const health = fs.readFileSync(path.join(ROOT, 'sidebar-health.js'), 'utf8');
  assert.match(health.slice(health.indexOf('function runHealthCheck(')), /^[^]*?closeExportSheet\(\);/);
});

test('side panel scripts use no native confirm, alert or prompt', () => {
  const problems = [];
  for (const file of fs.readdirSync(ROOT).filter(f => /^sidebar-.*\.js$/.test(f))) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const name of ['confirm', 'alert', 'prompt']) {
      const re = new RegExp(`(^|[^\\w.$])(window\\.)?${name}\\(`, 'm');
      if (re.test(source)) problems.push(`${file} calls ${name}()`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the page overlay lives in a shadow root with the new scrim', () => {
  const source = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  assert.match(source, /attachShadow\(/);
  assert.equal(source.includes('rgba(0, 0, 0, 0.7)'), false);
});

test('toast rules in styles.css use only colour tokens', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const problems = [];
  for (const m of css.matchAll(/([^{}]*\.toast[^{}]*)\{([^}]*)\}/g)) {
    const selector = m[1].trim();
    for (const decl of m[2].split(';')) {
      const [prop, ...rest] = decl.split(':');
      if (!prop || !/color|background|border|fill|stroke|shadow|outline/.test(prop)) continue;
      const value = rest.join(':');
      if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black)\b/i.test(value)) problems.push(`${selector} { ${decl.trim()} }`);
    }
  }
  assert.deepEqual(problems, []);
});

// The overlay cannot read styles.css, so it carries copies of the panel tokens
test('the page overlay colours match the panel tokens, light and dark', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  const tokens = block => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))));
  const darkStart = css.indexOf(':root[data-theme="dark"] {');
  const dark = tokens(css.slice(darkStart, css.indexOf('}', darkStart)));
  const style = content.slice(content.indexOf('const OVERLAY_STYLE'), content.indexOf('`;', content.indexOf('const OVERLAY_STYLE')));
  const scrimStart = style.indexOf('.scrim {');
  const overlayLight = tokens(style.slice(scrimStart, style.indexOf('}', scrimStart)));
  const mediaStart = style.indexOf('@media (prefers-color-scheme: dark)');
  const overlayDark = tokens(style.slice(mediaStart, style.indexOf('}', mediaStart)));
  assert.ok(Object.keys(overlayLight).length >= 8, Object.keys(overlayLight).join());
  assert.deepEqual(Object.keys(overlayDark).sort(), Object.keys(overlayLight).sort());
  for (const [name, value] of Object.entries(overlayLight)) assert.equal(value, light[name], `light ${name}`);
  for (const [name, value] of Object.entries(overlayDark)) assert.equal(value, dark[name], `dark ${name}`);
});

test('the page overlay is modal to assistive tech and focuses Cancel without scrolling', () => {
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  assert.match(content, /card\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(content, /querySelector\('\.cancel'\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(content, /\.inert\s*=/);
});

test('a delete reaches only the tab and notebook it was asked about', () => {
  for (const name of ['handleStudioDeleteRow', 'handleStudioBulkDelete']) {
    const src = fnSource('sidebar-generated.js', name);
    const asked = src.indexOf('const target = await studioDeleteTarget()');
    const dialog = src.indexOf('await showDialog(');
    assert.ok(asked >= 0 && asked < dialog, `${name} captures its target before the dialog`);
    assert.match(src, /if \(!sure \|\| !await studioDeleteStillValid\(target\)\) return;/);
    assert.match(src, /sendStudioDelete\(item, \{[^}]*tabId: target\.tabId \}\)/);
  }
  assert.match(fnSource('sidebar-generated.js', 'handleStudioBulkDelete'), /if \(!NLME\.sameDeleteTarget\(target, await studioDeleteTarget\(\)\)\)/);
  // The notebook comes from the tab's URL, not only the panel's id (still '' at panel start)
  assert.match(fnSource('sidebar-generated.js', 'studioDeleteTarget'), /chrome\.tabs\.get\(tabId\)[\s\S]*NLME\.deleteTarget\(\{ tabId, url, panelNotebookId: lastPanelNotebookId \}\)/);
  // A notebook switch closes every open dialog, answering false
  assert.match(fnSource('sidebar-core.js', 'resetChatPanel'), /closePanelDialogs\(\);/);
  assert.match(fnSource('sidebar-core.js', 'notePageMove'), /closePanelDialogs\(\);/);
});

// 1.9.5: the tab leaving the notebook closes the dialogs, as a switch does
test('the tab leaving the notebook closes the panel dialogs', () => {
  const vm = require('node:vm');
  const closed = [];
  let released = 0;
  const context = {
    NLME: require(path.join(ROOT, 'takeout-shared.js')),
    lastPanelNotebookId: 'aaaa',
    isNotebookUrl: url => /^https:\/\/notebook\.google\.com\//.test(url),
    releasePageLoad: () => { released++; },
    closePanelDialogs: kind => closed.push(kind ?? 'all'),
    closeExportSheet: () => closed.push('sheet'),
    holdForPageLoad: () => {}
  };
  vm.createContext(context);
  vm.runInContext(fnSource('sidebar-core.js', 'notePageMove'), context);
  context.notePageMove({ url: 'https://notebook.google.com/notebook/aaaa?x=1' });
  assert.deepEqual(closed, [], 'the same notebook keeps them');
  context.notePageMove({ url: 'https://example.com/' });
  assert.deepEqual(closed, ['all'], 'another site closes them');
  context.notePageMove({ url: 'https://notebook.google.com/' });
  assert.deepEqual(closed, ['all', 'all'], 'the notebook list closes them');
  context.notePageMove({ url: 'https://notebook.google.com/notebook/bbbb' });
  assert.deepEqual(closed, ['all', 'all', 'sheet', 'all'], 'another notebook closes the sheet and them');
  assert.equal(released, 3);
});

// 1.9.5: a bulk delete that stops because the target changed still rescans
test('a stopped bulk delete rescans the list', () => {
  const bulk = fnSource('sidebar-generated.js', 'handleStudioBulkDelete');
  assert.match(bulk, /stopped there`, 'warning'\);\s*stopped = true;[^\n]*\n\s*break;/);
  assert.doesNotMatch(bulk.slice(bulk.indexOf('let stopped')), /\breturn;/);
  assert.match(bulk, /_studioSignature = null;[^\n]*\n\s*await scanStudioPage\(\);\s*\}\s*$/);
});

test('an export that is cancelled or over closes its mid-export dialog', () => {
  const shell = fnSource('sidebar-takeout.js', 'withExportShell');
  assert.match(shell, /cancelled = true;\s*closePanelDialogs\('mid-export'\)/);
  assert.match(shell, /\} finally \{[\s\S]*closePanelDialogs\('mid-export'\)/);
  assert.match(fnSource('sidebar-core.js', 'showDOMWarningDialog'), /kind: 'mid-export'/);
});

test('the dialog backdrop closes only on a press and click both on the backdrop', () => {
  const src = fnSource('sidebar-core.js', 'showDialog');
  assert.match(src, /addEventListener\('mousedown', \(e\) => \{ pressedBackdrop = e\.target === dialog; \}\)/);
  assert.match(src, /if \(pressedBackdrop && e\.target === dialog\) dialog\.close\(\);/);
});

// ---- Motion, focus and the tab list (Task 9) ----

const PANEL_CSS = () => fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The overlay's own stylesheet in content.js: the template literal OVERLAY_STYLE
function overlayCss() {
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  const start = content.indexOf('OVERLAY_STYLE = `');
  assert.ok(start >= 0, 'OVERLAY_STYLE not found in content.js');
  return content.slice(start, content.indexOf('`;', start));
}
// Loaders that loop are the one kind of motion allowed to run longer
const LOOPS = new Set(['spin', 'slide']);

function declarations(css, property) {
  return [...css.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g'))].map(m => m[1].trim());
}
function durationsMs(value) {
  return [...value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map(m => Number(m[1]) * (m[2] === 's' ? 1000 : 1));
}
function checkMotion(css, where) {
  for (const value of declarations(css, 'transition')) {
    if (/^none\b/.test(value)) continue;
    for (const ms of durationsMs(value)) assert.ok(ms >= 120 && ms <= 160, `${where}: transition "${value}" is ${ms}ms, not 120 to 160ms`);
    assert.ok(durationsMs(value).length > 0, `${where}: transition "${value}" has no duration`);
  }
  for (const value of declarations(css, 'animation')) {
    if (/^none\b/.test(value)) continue;
    const name = value.split(/\s+/).find(word => /^[a-z][\w-]*$/i.test(word) && !/^(ease|ease-in|ease-out|ease-in-out|linear|infinite|forwards|backwards|both|alternate)$/.test(word));
    if (/\binfinite\b/.test(value)) {
      assert.ok(LOOPS.has(name), `${where}: "${value}" loops but is not a loader`);
      continue;
    }
    for (const ms of durationsMs(value)) assert.ok(ms >= 120 && ms <= 160, `${where}: animation "${value}" is ${ms}ms, not 120 to 160ms`);
  }
}
function reducedMotionBlocks(css) {
  const blocks = [];
  let at = css.indexOf('@media (prefers-reduced-motion: reduce)');
  while (at >= 0) {
    let depth = 0, i = css.indexOf('{', at);
    const open = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    blocks.push(css.slice(open + 1, i));
    at = css.indexOf('@media (prefers-reduced-motion: reduce)', i);
  }
  return blocks;
}

test('panel motion runs 120 to 160ms; only loaders loop', () => {
  checkMotion(PANEL_CSS(), 'styles.css');
});

test('reduced motion stops every animation and transition in the panel', () => {
  const blocks = reducedMotionBlocks(PANEL_CSS());
  assert.equal(blocks.length, 1, 'one reduced-motion block, for the whole panel');
  const [block] = blocks;
  assert.match(block, /\*,\s*\*::before,\s*\*::after,\s*::backdrop\s*\{/);
  assert.match(block, /animation:\s*none\s*!important/);
  assert.match(block, /transition:\s*none\s*!important/);
});

test('the page overlay keeps the same motion rules in its own stylesheet', () => {
  const css = overlayCss();
  checkMotion(css, 'content.js overlay');
  const blocks = reducedMotionBlocks(css);
  assert.equal(blocks.length, 1);
  for (const property of ['transition', 'animation']) {
    for (const rule of [...css.matchAll(new RegExp(`([^{}]+)\\{[^}]*${property}\\s*:\\s*(?!none)[^;}]+`, 'g'))]) {
      const selector = rule[1].trim();
      if (selector.startsWith('@') || /^(from|to)\b/.test(selector)) continue;
      // every selector that moves is stopped under reduced motion
      for (const one of selector.split(',').map(s => s.trim()).filter(Boolean)) {
        assert.ok(blocks[0].includes(one), `overlay: "${one}" has ${property} but reduced motion leaves it on`);
      }
    }
  }
});

test('one focus ring for every control, drawn from the theme', () => {
  const css = PANEL_CSS();
  const ring = css.match(/:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/);
  assert.ok(ring, 'a :where(...):focus-visible ring');
  for (const control of ['button', 'a', 'input', 'select', 'textarea', 'summary', '[tabindex]']) {
    assert.ok(ring[1].split(',').map(s => s.trim()).includes(control), `the ring covers ${control}`);
  }
  assert.match(ring[2], /outline:\s*2px solid var\(--ring\)/);
  assert.match(ring[2], /outline-offset:\s*2px/);
  assert.match(css, /:root\s*\{[^}]*--ring:\s*var\(--accent\)/);
  // No control draws its own ring; a label may wear its input's ring
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*outline[^}]*)\}/g)) {
    const selector = rule[1].trim();
    if (selector.startsWith(':where(')) continue;
    if (/:has\(input:focus-visible\)/.test(selector)) { assert.match(rule[2], /var\(--ring\)/); continue; }
    assert.match(rule[2], /outline:\s*none/, `${selector} sets its own outline`);
  }
  // Nothing turns the ring off on a control the keyboard reaches
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*outline:\s*none[^}]*)\}/g)) {
    const selector = rule[1].trim();
    assert.ok(/^\.sheet-option input:focus-visible,\s*\.sheet-check input:focus-visible$/.test(selector) || selector === '.export-sheet-panel',
      `${selector} hides the focus ring`);
  }
});

test('one destructive button family: solid, and tinted for Delete Selected', () => {
  const readers = ['styles.css', 'sidebar.html', ...fs.readdirSync(ROOT).filter(f => /^sidebar-.*\.js$/.test(f))];
  for (const file of readers) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /btn-danger/, `${file} still names btn-danger`);
  }
  const css = PANEL_CSS();
  assert.match(css, /\.btn-destructive\s*\{\s*background: var\(--danger\);/);
  // The tinted form is a modifier of the same class, from the tokens, so dark mode follows
  const soft = css.match(/\.btn-destructive\.btn-destructive-soft\s*\{([^}]*)\}/);
  assert.ok(soft, 'the tinted form');
  assert.match(soft[1], /background: color-mix\(in srgb, var\(--danger\) \d+%, var\(--bg\)\);/);
  assert.match(soft[1], /color: var\(--danger\);/);
  assert.match(css, /\.btn-destructive\.btn-destructive-soft:hover:not\(:disabled\)\s*\{/);
  assert.match(fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8'), /id="studio-delete-selected-btn" class="btn btn-destructive btn-destructive-soft"/);
  // A dialog's confirm stays solid
  assert.match(fnSource('sidebar-core.js', 'showDialog'), /confirmBtn\.className = danger \? 'btn btn-destructive' : 'btn btn-primary';/);
});

// 1.9.5: one type scale for the panel and the page overlay
test('every font size is on the type scale (11.5, 13, 15, 26px)', () => {
  const SCALE = new Set(['11.5', '13', '15', '26']);
  const sources = {
    'styles.css': fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'),
    'sidebar.html': fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8'),
    'content.js': fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8')
  };
  for (const f of fs.readdirSync(ROOT).filter(f => /^sidebar-.*\.js$/.test(f))) sources[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let seen = 0;
  for (const [file, text] of Object.entries(sources)) {
    // CSS declarations and inline styles: font-size: N, and the font shorthand with a size
    for (const m of text.matchAll(/font-size:\s*([^;"'`}\n]+)/g)) {
      seen++;
      const value = m[1].trim();
      if (value === 'inherit') continue;
      const px = value.match(/^([\d.]+)px$/);
      assert.ok(px && SCALE.has(px[1]), `${file}: font-size ${value} is off the scale`);
    }
    for (const m of text.matchAll(/\bfont:\s*([^;"'`}\n]+)/g)) {
      assert.match(m[1].trim(), /^inherit$/, `${file}: font shorthand ${m[1]}`);
    }
    assert.doesNotMatch(text, /\.style\.fontSize\s*=/, `${file} sets a size from script`);
    // setProperty('font-size', …) too (cssText strings are covered by the font-size: scan)
    for (const m of text.matchAll(/setProperty\(\s*['"`]font-size['"`]\s*,\s*['"`]([^'"`]+)['"`]/g)) {
      const px = m[1].trim().match(/^([\d.]+)px$/);
      assert.ok(px && SCALE.has(px[1]), `${file}: setProperty font-size ${m[1]} is off the scale`);
    }
    assert.doesNotMatch(text, /setProperty\(\s*['"`]font-size['"`]\s*,\s*[^'"`\s]/, `${file} sets a computed font size`);
  }
  assert.ok(seen > 50);
  // Headings stay larger than body text
  const css = PANEL_CSS();
  const size = selector => {
    const rule = css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, selector);
    return parseFloat(rule[1].match(/font-size:\s*([\d.]+)px/)[1]);
  };
  const body = size('body');
  // Controls inherit it, not the browser's own 13.33px
  assert.match(css, /button, input, select, textarea \{\s*font: inherit;\s*\}/);
  for (const heading of ['.settings-header h2', '.health-check-header h2']) assert.ok(size(heading) > body, `${heading} is larger than body`);
  const overlay = overlayCss();
  assert.ok(parseFloat(overlay.match(/\.heading \{[^}]*font-size: ([\d.]+)px/)[1]) > parseFloat(overlay.match(/\.line \{[^}]*font-size: ([\d.]+)px/)[1]));
});

test('every class and id the panel stylesheet names has a reader', () => {
  const css = PANEL_CSS();
  const readers = ['sidebar.html', ...fs.readdirSync(ROOT).filter(f => /^(sidebar-|takeout-).*\.js$/.test(f))]
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const names = new Set();
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const selector = m[1].trim();
    if (selector.startsWith('@') || /^(from|to|\d+%)\b/.test(selector)) continue;
    for (const t of selector.matchAll(/[.#]([A-Za-z_][\w-]*)/g)) names.add(t[1]);
  }
  // Built by concatenation: toast-${type}, results-${level}
  const built = /^(toast|results)-(success|info|warning|error)$/;
  const dead = [...names].filter(name => !built.test(name) && !new RegExp(`(^|[^\\w-])${name}($|[^\\w-])`).test(readers));
  assert.deepEqual(dead, []);
});

test('the list tabs are a tablist with a roving tabindex and arrow keys', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  assert.match(html, /<div class="tabs" role="tablist" aria-label="Lists" hidden>/);
  for (const tab of ['sources', 'notes', 'studio', 'chat']) {
    const button = html.match(new RegExp(`<button[^>]*data-tab="${tab}"[^>]*>`));
    assert.ok(button, `tab ${tab}`);
    assert.match(button[0], /role="tab"/);
    assert.match(button[0], new RegExp(`id="tab-${tab}"`));
    assert.match(button[0], new RegExp(`aria-controls="panel-${tab}"`));
    assert.match(button[0], /aria-selected="false"/);
    assert.match(button[0], /tabindex="-1"/);
    const panel = html.match(new RegExp(`<div[^>]*data-tab-content="${tab}"[^>]*>`));
    assert.match(panel[0], new RegExp(`id="panel-${tab}"`));
    assert.match(panel[0], /role="tabpanel"/);
    assert.match(panel[0], new RegExp(`aria-labelledby="tab-${tab}"`));
  }
  const show = fnSource('sidebar-core.js', 'showView');
  assert.match(show, /btn\.setAttribute\('aria-selected', String\(on\)\)/);
  assert.match(show, /btn\.tabIndex = on \? 0 : -1/);
  const keys = fnSource('sidebar-core.js', 'handleTabKey');
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.ok(keys.includes(`'${key}'`), key);
  assert.match(fnSource('sidebar-core.js', 'setupTabSwitching'), /tabList\.addEventListener\('keydown', handleTabKey\)/);
});

test('the header status speaks only when it changes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8');
  assert.match(html, /<div id="status" class="status" aria-live="polite">/);
  const check = fnSource('sidebar-core.js', 'checkStatus');
  assert.doesNotMatch(check, /statusText\.textContent = /);
  assert.match(fnSource('sidebar-core.js', 'setStatusText'), /if \(el\.textContent !== text\) el\.textContent = text;/);
});

test('Settings and the health check take the keyboard in and give it back', () => {
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  assert.doesNotMatch(core, /getElementById\('(settings-panel|health-check-panel)'\)\.style\.display = /);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'sidebar-health.js'), 'utf8'), /panel\.style\.display = 'block'/);
  const open = fnSource('sidebar-core.js', 'openCover');
  assert.match(open, /syncCoverInert\(\)/);
  assert.match(open, /focus\(\{ preventScroll: true \}\)/);
  const close = fnSource('sidebar-core.js', 'closeCover');
  assert.match(close, /syncCoverInert\(\)/);
  assert.match(fnSource('sidebar-core.js', 'handleCoverKey'), /'Escape'/);
  // The export sheet gives inert back through the same rule, so a cover stays modal
  assert.match(fnSource('sidebar-sheet.js', 'closeExportSheet'), /syncCoverInert\(\)/);
});

test('a health-check category opens from the keyboard and says whether it is open', () => {
  const src = fnSource('sidebar-health.js', 'displayHealthCheckResults');
  assert.match(src, /const headerEl = document\.createElement\('button'\);\s*headerEl\.type = 'button';/);
  assert.match(src, /headerEl\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(src, /headerEl\.setAttribute\('aria-expanded', String\(expanded\)\)/);
  assert.match(src, /headerEl\.setAttribute\('aria-controls', `health-checks-\$\{categoryKey\}`\)/);
  assert.match(src, /checksEl\.id = `health-checks-\$\{categoryKey\}`/);
  // A failed category starts open, and says so
  assert.match(src, /categoryEl\.classList\.add\('expanded'\);\s*headerEl\.setAttribute\('aria-expanded', 'true'\);/);
});

test('a disabled button does not change on hover', () => {
  const css = PANEL_CSS();
  for (const name of ['btn-primary', 'btn-secondary', 'btn-destructive', 'header-icon-btn', 'btn-icon', 'btn-icon-small']) {
    assert.doesNotMatch(css, new RegExp(`^\\.${name}:hover\\s*\\{`, 'm'), `.${name}:hover needs :not(:disabled)`);
    assert.match(css, new RegExp(`\\.${name}:hover:not\\(:disabled\\)\\s*\\{`));
  }
});

test('the list is called Studio wherever a person reads it (1.9.4)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  // Text between tags, and the attributes a person reads or hears
  const text = [...html.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/>([^<]+)</g)].map(m => m[1]).join(' ');
  const attrs = [...html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[1]).join(' ');
  assert.doesNotMatch(text + ' ' + attrs, /\bGenerated\b/);
  assert.match(html, /<span class="home-label">Studio<\/span>/);
  assert.match(html, /data-tab="studio"[^>]*>Studio <span class="tab-count"/);
  const generated = fs.readFileSync(path.join(ROOT, 'sidebar-generated.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  // Strings a person sees: list states, busy names, toasts
  const strings = [...generated.matchAll(/(['`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2]).filter(s => !s.startsWith('[NotebookLM Takeout]'));
  assert.deepEqual(strings.filter(s => /\b[Gg]enerated\b/.test(s) && !/^Generated: /.test(s)), []);
});

test('the panel says Gemini Notebook, not NotebookLM (1.9.4)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sidebar.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(html, /NotebookLM/);
  assert.match(html, /<title>Takeout for Gemini Notebook<\/title>/);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Takeout for Gemini Notebook');
  assert.match(manifest.description, /Gemini Notebook \(formerly NotebookLM\)/);
  assert.ok(manifest.description.length <= 132);
  // Every string in the panel scripts. Kept: the console prefix, and the bare
  // 'NotebookLM' fallback name, which goes into export file and folder names.
  const kept = new Set(['NotebookLM']);
  for (const file of fs.readdirSync(ROOT).filter(f => /^sidebar-.*\.js$/.test(f))) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    const strings = [...src.matchAll(/(['`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2])
      .filter(s => /NotebookLM/.test(s) && !s.startsWith('[NotebookLM Takeout]') && !kept.has(s));
    assert.deepEqual(strings, [], file);
  }
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  assert.match(content, /el\('p', 'label', 'Takeout for Gemini Notebook'\)/);
  // Export output keeps the old name, byte for byte
  assert.match(fs.readFileSync(path.join(ROOT, 'takeout-shared.js'), 'utf8'), /exporter: `NotebookLM Takeout \$\{version\}`/);
});

// content.js is one indented IIFE: its functions start at two spaces
function contentFn(name) {
  const src = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  const start = src.search(new RegExp(`^  function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} not found in content.js`);
  return src.slice(start, src.indexOf('\n  }\n', start) + 4);
}

test('an overlay Cancel never leaves a dead card when the extension was reloaded', () => {
  // The send is guarded: no extension id, or a throw, means the context is gone
  const send = contentFn('sendCancelExport');
  assert.match(send, /if \(!chrome\.runtime\?\.id\) return false;/);
  assert.match(send, /try \{[\s\S]*chrome\.runtime\.sendMessage\(\{ type: NLME\.MSG\.CANCEL_EXPORT \}\)[\s\S]*\} catch \(_\) \{\s*return false;\s*\}/);
  assert.match(send, /\.catch\(\(\) => \{\}\)/);
  // The card goes first, then the send; a lost context leaves a note, not the card
  const overlay = contentFn('createExportOverlay');
  assert.match(overlay, /exportCancelled = true;\s*removeExportOverlay\(\);\s*if \(!sendCancelExport\(\)\) showReloadedNote\(\);/);
  assert.doesNotMatch(overlay, /chrome\.runtime\.sendMessage/);
  const note = contentFn('showReloadedNote');
  assert.match(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'), /const RELOADED_TEXT = 'This export stopped when the extension was reloaded\. Refresh the page to use Takeout again\.';/);
  // Announced: the status region is in the page empty, then filled; Dismiss is described by it
  assert.match(note, /document\.body\.appendChild\(host\);[\s\S]*setTimeout\(\(\) => \{ text\.textContent = RELOADED_TEXT; \}, 100\);/);
  assert.match(note, /dismiss\.setAttribute\('aria-describedby', 'reloaded-text'\)/);
  // It waits while the pointer or focus is on it
  for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) assert.ok(note.includes(`'${event}'`), event);
  assert.doesNotMatch(note, /dismiss\.focus\(/); // focus on it would hold it open
  assert.match(note, /attachShadow/);
  assert.match(note, /timer = setTimeout\(remove, left\)/);
  assert.match(note, /'Dismiss'/);
  assert.match(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'), /const RELOADED_NOTE_MS = 6000;/);
  // The side panel's Cancel goes through the same guard
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  const handler = content.slice(content.indexOf('[NLME.MSG.REQUEST_EXPORT_CANCEL]'), content.indexOf('[NLME.MSG.EXTRACT_NOTE]'));
  assert.match(handler, /exportCancelled = true;\s*removeExportOverlay\(\);\s*sendCancelExport\(\);/);
});

// 1.9.5: Export everything and Resume poll the notes list until it settles
function settledScan(answers) {
  const vm = require('node:vm');
  let clock = 0;
  const asked = [];
  const sandbox = {
    NLME: require('../takeout-shared.js'),
    chrome: { tabs: { sendMessage: async () => { asked.push(clock); const a = answers(clock); if (a instanceof Error) throw a; return a; } } },
    ensureContentScriptLoaded: async () => {}, console: { warn() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource('sidebar-notes.js', 'scanNotesSettled') + fnSource('sidebar-notes.js', 'stampNoteOrdinals'), sandbox);
  const run = (opts = {}) => sandbox.scanNotesSettled(1, { now: () => clock, sleep: async ms => { clock += ms; }, ...opts });
  return { run, asked };
}

test('scanNotesSettled waits for an undrawn list and returns the notes it draws', async () => {
  const note = { index: 0, title: 'N', elementType: 'note' };
  const { run, asked } = settledScan(at => (at < 2000
    ? { notes: [], list: { items: 0, library: false, loading: false } }
    : { notes: [note], list: { items: 1, library: true, loading: false } }));
  assert.deepEqual(JSON.parse(JSON.stringify(await run())), [note]);
  assert.ok(asked.length > 2 && asked[asked.length - 1] < 8000);
});

test('scanNotesSettled: a truly empty notebook is empty within the bound; one that never draws fails', async () => {
  const empty = settledScan(() => ({ notes: [], list: { items: 0, library: true, loading: false } }));
  assert.deepEqual(JSON.parse(JSON.stringify(await empty.run())), []);
  assert.ok(empty.asked[empty.asked.length - 1] <= 4400);
  const never = settledScan(() => ({ notes: [], list: { items: 0, library: false, loading: false } }));
  await assert.rejects(never.run(), /The Studio list did not appear within 8 s\. Close any open Studio item/);
  assert.ok(never.asked[never.asked.length - 1] >= 8000 && never.asked[never.asked.length - 1] < 8400);
  const silent = settledScan(() => new Error('Could not establish connection'));
  await assert.rejects(silent.run(), /No answer from the page/);
});

test('scanNotesSettled stops on a Cancel', async () => {
  const { run, asked } = settledScan(() => ({ notes: [], list: { items: 0, library: false, loading: false } }));
  await assert.rejects(run({ isCancelled: () => true }), /Cancelled/);
  assert.equal(asked.length, 1);
});

test('Resume skips no-More artifacts like Export everything and seeds the warnings into the artifacts step', () => {
  const resume = fnSource('sidebar-takeout.js', 'resumeJob');
  assert.match(resume, /const plan = NLME\.artifactExportPlan\(matched, \{ all: items \}\);/);
  assert.match(resume, /if \(scanWarnings\[name\]\) seeds\[name\] = \{ seedErrors: scanWarnings\[name\] \};/);
  assert.match(resume, /runRetryChain\(itemsByName, tabId, 'Resume', TAKEOUT_RETRY_STEPS, zip, seeds\)/);
  // A step that did not run puts its warnings in the panel
  assert.match(resume, /if \(!steps\.some\(step => step\.name === name\)\) extraErrors\.push\(/);
  assert.match(fnSource('sidebar-takeout.js', 'runRetryChain'), /step\.run\(items, tabId, zip, seeds\[step\.name\] \|\| \{\}\)/);
});

test('the page says with its notes whether the Studio list has drawn', () => {
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  assert.match(content, /sendResponse\(\{ notes, list: notesListState\(\) \}\)/);
  const state = content.slice(content.indexOf('function notesListState()'), content.indexOf('function scanForNotes()'));
  assert.match(state, /artifact-library-item, artifact-library-note/);
  assert.match(state, /return \{ items, library: !!container, loading: /);
});

test('an item with no More button that fails says it is still being generated', async () => {
  const vm = require('node:vm');
  const sandbox = { NLME: require('../takeout-shared.js'), console: { warn() {} } };
  vm.createContext(sandbox);
  vm.runInContext(fnSource('sidebar-artifacts.js', 'fetchNoMenuSafe'), sandbox);
  const broke = async () => { throw new Error('Item changed: expected "Fresh"'); };
  await assert.rejects(sandbox.fetchNoMenuSafe({ index: -1, label: 'Fresh' }, broke), /^Error: Still being generated\. Try again when it is ready \(Resume will retry it\)\.$/);
  await assert.rejects(sandbox.fetchNoMenuSafe({ index: -1, label: 'Fresh' }, broke), err => err.detail === 'Item changed: expected "Fresh"');
  await assert.rejects(sandbox.fetchNoMenuSafe({ index: 2, label: 'Fresh' }, broke), /Item changed/);
  // A refused same-title pick keeps its own words
  const twin = async () => { throw new Error(sandbox.NLME.SAME_TITLE_REFUSED); };
  await assert.rejects(sandbox.fetchNoMenuSafe({ index: -1, label: 'Twin' }, twin), err => err.message === sandbox.NLME.SAME_TITLE_REFUSED && !err.detail);
  assert.equal(await sandbox.fetchNoMenuSafe({ index: -1 }, async () => 'ok'), 'ok');
  assert.match(fnSource('sidebar-artifacts.js', 'runArtifactsJob'), /const fetched = await fetchNoMenuSafe\(item, \(\) => fetchSlideFormats\(/);
});

test('Resume reports a notes list read without the Studio list once, not once per Studio note', () => {
  const resume = fnSource('sidebar-takeout.js', 'resumeJob');
  assert.match(resume, /if \(unknown\.length && !scanWarnings\[name\]\) \{/);
});

test('artifact, note and source picks all go through the strict resolver, and the note path keeps its refusal', () => {
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  assert.match(content, /NLME\.pickByIndexThenTitleStrict\(rowTitles, artifactIndex, artifactName, requestTitleOrdinal\)/);
  assert.match(content, /NLME\.pickByIndexThenTitleStrict\(titles, artifactIndex, title, requestTitleOrdinal\)/);
  assert.match(content, /NLME\.pickByIndexThenTitleStrict\(containerTitles, sourceIndex, expectedTitle, requestTitleOrdinal\)/);
  assert.match(content, /pick = NLME\.pickByIndexThenTitleStrict\(noteTitles, noteIndex, noteTitle, requestTitleOrdinal\);\s+\} catch \(e\) \{[^}]*if \(NLME\.isSameTitleRefusal\(e\)\) throw e;\s+pick = -1;/);
  // Every request that resolves an item sets the ordinal it was sent (or none)
  assert.equal([...content.matchAll(/requestTitleOrdinal = titleOrdinalOf\(message\.data\);/g)].length, 3);
  // The panel stamps the scans and sends the ordinal with the job's requests
  assert.match(fs.readFileSync(path.join(ROOT, 'sidebar-artifacts.js'), 'utf8'), /return NLME\.stampTitleOrdinals\(items, \{ titleOf: item => item\.label, indexOf: item => item\.index \}\);/);
  assert.match(fs.readFileSync(path.join(ROOT, 'sidebar-sources.js'), 'utf8'), /NLME\.stampTitleOrdinals\(response\.sources \|\| \[\], \{ titleOf: s => s\.title, indexOf: s => s\.index, titles: Array\.isArray\(response\.titles\) \? response\.titles : null \}\)/);
  // The page sends the list its source resolver counts over, hidden rows included
  const scan = content.slice(content.indexOf('async function scanForSources()'), content.indexOf('function waitForElement('));
  assert.match(scan, /const titles = Array\.from\(sourceContainers\)\.map\(c => \(isNoteSourceContainer\(c\) \? '' : getSourceContainerTitle\(c\)\)\);/);
  assert.match(scan, /return \{ sources: sources, skippedNotes, titles \};/);
  // The page reads the count with the ordinal
  assert.match(content, /\? \{ ordinal: data\.titleOrdinal, count: Number\.isInteger\(data\.titleCount\) \? data\.titleCount : null \}/);
  assert.match(fnSource('sidebar-notes.js', 'scanNotesData'), /return stampNoteOrdinals\(/);
  assert.match(fnSource('sidebar-notes.js', 'scanNotesSettled'), /return stampNoteOrdinals\(/);
  assert.match(fnSource('sidebar-artifacts.js', 'fetchArtifactFiles'), /const ordinal = NLME\.titlePlace\(item\);/);
  for (const [file, fn] of [['sidebar-notes.js', 'extractNoteItem'], ['sidebar-notes.js', 'exportSingleNote'], ['sidebar-sources.js', 'extractSourceItem']]) {
    assert.match(fnSource(file, fn), /\.\.\.NLME\.titlePlace\(\w+\)/, fn);
  }
  // Single-row downloads send it too: the Studio row through the plan over the whole list
  const row = fnSource('sidebar-generated.js', 'handleStudioDownloadRow');
  assert.match(row, /const planned = NLME\.generatedExportPlan\(\[item\], _studioItems\);/);
  assert.match(row, /triggerItemDownload\(_studioTabId, item\.moreIndex, item\.label, item\.type, NLME\.titlePlace\(planned\.artifacts\[0\]\)\)/);
  assert.match(row, /exportSingleNote\(planned\.notes\[0\] \|\|/);
  assert.match(fnSource('sidebar-artifacts.js', 'downloadArtifact'), /NLME\.setTitlePlace\(item, place\.titleOrdinal, place\.titleCount\)/);
  assert.match(fnSource('sidebar-artifacts.js', 'triggerItemDownload'), /downloadArtifact\(tabId, itemIndex, artifactType, artifactName, place\)/);
  assert.equal([...content.matchAll(/pickByIndexThenTitleStrict\(/g)].length, 4);
  assert.match(fnSource('sidebar-artifacts.js', 'fetchNoMenuSafe'), /NLME\.isSameTitleRefusal\(error\)/);
});

test('a pick refused for a shared title is not retried', () => {
  assert.match(fnSource('sidebar-core.js', 'retryDownload'), /if \(error && \(error\.formatNotOffered \|\| NLME\.isSameTitleRefusal\(error\)\)\) throw error;/);
});

// 1.9.5: Start puts the focus straight on the progress view's Cancel
test('Start in the export sheet hands the focus to the progress view', () => {
  const start = fnSource('sidebar-sheet.js', 'startExportSheet');
  assert.match(start, /closeExportSheet\(\{ starting: true \}\);\s*showProgressView\(\{ title \}\);/);
  assert.ok(start.indexOf('showProgressView(') < start.indexOf('tabStillOnPanelNotebook'), 'the view is up before the first wait');
  assert.match(start, /hideProgressView\(\);\s*\/\/[^\n]*\n\s*if \(!_sheet && document\.activeElement === document\.body\) returnSheetFocus\(opener\);/);
  assert.match(fnSource('sidebar-sheet.js', 'closeExportSheet'), /if \(!starting\) returnSheetFocus\(switched \? null : opener\);/);
  // A Cancel before the shell listens is kept, and the shell reads it before it begins
  assert.match(fnSource('sidebar-core.js', 'requestCancel'), /if \(sheetStarting && activeShellTabId === null\) startCancelRequested = true;\s*if \(!jobLock\.current\(\)\) return;/);
  // Another job took the lock during the tab check (JOB_BUSY): this start's view goes too
  assert.match(start, /if \(await tabStillOnPanelNotebook\(\)\) outcome = await start\(run\);/);
  assert.match(start, /if \(!jobLock\.current\(\) \|\| \(outcome === JOB_BUSY && activeShellTabId === null\)\) hideProgressView\(\);/);
  const shell = fnSource('sidebar-takeout.js', 'withExportShell');
  assert.equal((shell.match(/if \(startCancelled\(\)\) return \{ declined: true \};/g) || []).length, 2);
  assert.ok(shell.indexOf('startCancelled()') < shell.indexOf('preflightWarn('));
  assert.ok(shell.lastIndexOf('startCancelled()') < shell.indexOf('SHOW_EXPORT_OVERLAY'));
  assert.match(shell, /addListener\(cancelListener\);\s*if \(startCancelRequested\) cancelled = true;/);
});

// 1.9.5: the time left ticks between counts and stops with the run
test('the time left ticks each second and stops on finish, cancel and hide', () => {
  assert.match(fnSource('sidebar-results.js', 'progressLeftText'), /NLME\.tickedTimeLeft\(run\.left, \(Date\.now\(\) - run\.leftAt\) \/ 1000\)/);
  const tick = fnSource('sidebar-results.js', 'startProgressTick');
  assert.match(tick, /setInterval\(/);
  assert.match(tick, /progressRun !== run \|\| dockMode !== 'progress' \|\| run\.finishing/);
  assert.match(fnSource('sidebar-results.js', 'showProgressView'), /progressRun = newProgressRun\(\);\s*startProgressTick\(progressRun\);/);
  for (const [file, name] of [['sidebar-results.js', 'setProgressFinishing'], ['sidebar-results.js', 'hideProgressView'], ['sidebar-core.js', 'requestCancel']]) {
    assert.match(fnSource(file, name), /stopProgressTick\(\)/, name);
  }
  // A Cancel stops the countdown only once it reached the page
  const cancel = fnSource('sidebar-core.js', 'requestCancel');
  assert.match(cancel, /await chrome\.tabs\.sendMessage\(target, \{ type: NLME\.MSG\.REQUEST_EXPORT_CANCEL \}\);\s*stopProgressTick\(\);/);
  assert.equal((cancel.match(/stopProgressTick\(\)/g) || []).length, 1);
});

// 1.9.5: the reload note gives the focus back when it goes with it
test('the reload note returns the focus it held', () => {
  const note = contentFn('showReloadedNote');
  assert.match(note, /const hadFocus = document\.activeElement === host;\s*host\.remove\(\);/);
  assert.match(note, /cameFrom\?\.isConnected[^\n]*cameFrom\.focus\(\{ preventScroll: true \}\)/);
  assert.match(note, /e\.relatedTarget && !host\.contains\(e\.relatedTarget\)/);
});

// ---- 1.9.15: "Retry N with missing images" ----

// showResults on a stand-in panel: buttons are found by class in its markup
function resultsPanel({ mayStart = true } = {}) {
  const NLME = require('../takeout-shared.js');
  const buttons = new Map();
  const panel = {
    _html: '',
    set innerHTML(html) {
      this._html = html;
      buttons.clear();
      for (const m of html.matchAll(/<button[^>]*class="([^"]+)"[^>]*>([^<]*)<\/button>/g)) {
        const handlers = [];
        buttons.set(m[1], { text: m[2], disabled: false, handlers, addEventListener: (type, fn) => handlers.push(fn) });
      }
    },
    get innerHTML() { return this._html; },
    querySelector: sel => [...buttons].find(([cls]) => cls.split(' ').includes(sel.slice(1)))?.[1] || null
  };
  const ctx = vmModule.createContext({
    NLME, console,
    document: { getElementById: id => (id === 'results-panel' ? panel : null) },
    clearTimeout() {}, setDock() {}, keepDockFocus() {}, showToast() {}, closeResults() {},
    retryMayStart: async () => mayStart
  });
  vmModule.runInContext(`
    let holdStepResults = false, heldStepResults = null, progressRun = null;
    ${fnSource('sidebar-results.js', 'showResults')}
    this.showResults = showResults;
  `, ctx);
  return { ctx, panel, buttons };
}

test('the results panel shows Retry failed and Retry with missing images, each with its count', () => {
  const { ctx, buttons } = resultsPanel();
  ctx.showResults({ message: 'm', retry: { count: 2, run() {} }, retryImages: { count: 3, run() {} } });
  assert.equal(buttons.get('btn btn-primary results-retry').text, 'Retry 2 failed');
  assert.equal(buttons.get('btn btn-secondary results-retry-images').text, 'Retry 3 with missing images');
});

test('with one list empty, only the other Retry shows', () => {
  const { ctx, buttons } = resultsPanel();
  ctx.showResults({ message: 'm', retry: null, retryImages: { count: 1, run() {} } });
  assert.deepEqual([...buttons.keys()].filter(k => k.includes('retry')), ['btn btn-secondary results-retry-images']);
  assert.equal(buttons.get('btn btn-secondary results-retry-images').text, 'Retry 1 with missing images');
  ctx.showResults({ message: 'm', retry: { count: 4, run() {} }, retryImages: null });
  assert.deepEqual([...buttons.keys()].filter(k => k.includes('retry')), ['btn btn-primary results-retry']);
  ctx.showResults({ message: 'm', retry: { count: 4, run() {} }, retryImages: { count: 0, run() {} } });
  assert.deepEqual([...buttons.keys()].filter(k => k.includes('retry')), ['btn btn-primary results-retry']);
});

test('the missing-images Retry runs its own list, and is refused off the run\'s notebook', async () => {
  const runs = [];
  const { ctx, panel } = resultsPanel();
  ctx.showResults({ message: 'm', retry: { count: 1, run: async () => runs.push('failed') }, retryImages: { count: 1, run: async () => runs.push('images') } });
  for (const fn of panel.querySelector('.results-retry-images').handlers) await fn();
  assert.deepEqual(runs, ['images']);
  const refused = resultsPanel({ mayStart: false });
  const refusedRuns = [];
  refused.ctx.showResults({ message: 'm', retryImages: { count: 1, run: async () => refusedRuns.push('images') } });
  for (const fn of refused.panel.querySelector('.results-retry-images').handlers) await fn();
  assert.deepEqual(refusedRuns, []);
});

test('a Full Takeout with missing images in Sources and Notes retries only those, with those items', async () => {
  const takeout = fs.readFileSync(path.join(ROOT, 'sidebar-takeout.js'), 'utf8');
  const steps = takeout.slice(takeout.indexOf('const TAKEOUT_RETRY_STEPS'), takeout.indexOf('];\n', takeout.indexOf('const TAKEOUT_RETRY_STEPS')) + 3);
  const calls = [];
  const shown = [];
  const ctx = vmModule.createContext({ calls, shown, console, showToast() {}, NLME: require('../takeout-shared.js') });
  vmModule.runInContext(`
    let chainActive = false, chainCancelRequested = false, chainHolds = 0, chainProgress = null, holdStepResults = false, heldStepResults = null;
    const hideProgressView = () => {};
    const chainTabOnRunNotebook = async () => true;
    const runExclusive = (name, fn) => fn();
    const rememberRunSettings = () => fn => fn();
    const showResults = options => shown.push(options);
    const ok = (items, missing = []) => ({ result: { failedItems: [], imageFailedItems: missing, exported: items.length }, selected: items.length, message: 'ok', level: 'success', saved: [], errors: [] });
    const exportSources = async (items, opts) => { calls.push(['sources', items, opts]); return ok(items, items.slice(0, 1)); };
    const exportNotesAsMarkdown = async (items, opts) => { calls.push(['notes', items, opts]); return ok(items); };
    const downloadAllArtifacts = async (...args) => { calls.push(['artifacts', ...args]); return ok([]); };
    ${fnSource('sidebar-takeout.js', 'showTakeoutResults')}
    ${fnSource('sidebar-takeout.js', 'runChain')}
    ${fnSource('sidebar-takeout.js', 'runRetryChain')}
    ${fnSource('sidebar-takeout.js', 'takeoutRetry')}
    ${steps}
    this.show = showTakeoutResults;
  `, ctx);
  ctx.show({ message: 'm' }, { Sources: ['f1'], Notes: [], Artifacts: ['a1'] }, 7, true, { Sources: ['s1', 's2'], Notes: ['n1'] });
  assert.equal(shown[0].retry.count, 2);
  assert.equal(shown[0].retryImages.count, 3);
  await shown[0].retryImages.run();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['sources', ['s1', 's2'], { tabId: 7, updateRecord: true }],
    ['notes', ['n1'], { tabId: 7, updateRecord: true }]
  ]);
  // The combined panel offers the images still missing after the retry
  const after = shown[shown.length - 1];
  assert.equal(after.retry, null);
  assert.equal(after.retryImages.count, 1);
});

test('sources and notes offer a Retry with missing images through the export they retry with', () => {
  const sources = fnSource('sidebar-sources.js', 'exportSources');
  assert.match(sources, /retryImages: retryFor\(result\.imageFailedItems, 'Sources export', failed => exportSources\(failed, \{ tabId: shell\.tab\.id, updateRecord: true \}\)\)/);
  const notes = fnSource('sidebar-notes.js', 'exportNotesAsMarkdown');
  assert.match(notes, /retryImages: retryFor\(result\.imageFailedItems, 'Notes export', failed => exportNotesAsMarkdown\(failed, \{ tabId: shell\.tab\.id, updateRecord: true \}\)\)/);
  for (const [file, name] of [['sidebar-sources.js', 'runSourcesJob'], ['sidebar-notes.js', 'runNotesJob']]) {
    assert.match(fnSource(file, name), /beforePackage: \([a-z]+, \{ markImagesMissing \}\) => retryMissingImages\([a-z]+, \{[^}]*markMissing: markImagesMissing/, name);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'sidebar-takeout.js'), 'utf8'), /saved = \[\], retry = null, retryImages = null \} = \{\}\) \{[^]*?showResults\(\{[^}]*errors, retry, retryImages \}\)/);
});

test('the last try marks an item only when images are still missing', async () => {
  const marked = [];
  const ctx = vmModule.createContext({ NLME: { IMAGE_FINAL_COOLDOWN_MS: 0 }, console, marked });
  vmModule.runInContext(`
    const reportImageFailures = () => {};
    const addRetriedEmbeds = () => {};
    const imageSession = { finalTry: async entries => ({ fetched: new Map([['ok', 'data']]), still: entries.filter(e => e.url !== 'ok') }) };
    ${fnSource('sidebar-core.js', 'retryMissingImages')}
    this.run = items => retryMissingImages(items, { markMissing: item => marked.push(item.name) });
  `, ctx);
  const withFailures = (name, urls) => {
    const item = { name };
    Object.defineProperty(item, '_imageFailures', { value: { label: name, warn() {}, failures: urls.map(url => ({ url, reason: 'r' })) }, configurable: true, writable: true, enumerable: false });
    return item;
  };
  await ctx.run([withFailures('A', ['ok']), withFailures('B', ['ok', 'gone']), { name: 'C' }]);
  assert.deepEqual(marked, ['B']);
});

test('the chat\'s image summary says to re-export the chat; sources and notes do not', () => {
  assert.match(fnSource('sidebar-chat.js', 'extractChatPair'), /failure\.type === 'image_download_failed' \? `\$\{failure\.message\} \(re-export the chat to try again\)` : failure\.message/);
  for (const file of ['sidebar-sources.js', 'sidebar-notes.js', 'sidebar-core.js', 'takeout-shared.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /re-export the chat/, file);
  }
});
