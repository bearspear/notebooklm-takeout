// Chat Thoughts (1.9.6): the reasoning behind a collapsed "Thoughts" section
// of a chat answer. The page script reads it (content.js) and leaves a
// placeholder where the section was; the chat converter writes
// NLME.thoughtsMarkdown there. Tests have no DOM: a fake Turndown runs the
// real chatThoughts rule of takeout-markdown.js and the real
// convertChatToMarkdown of sidebar-chat.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ---------- NLME.thoughtsMarkdown ----------

test('thoughtsMarkdown: an empty or missing list writes nothing', () => {
  assert.equal(NLME.thoughtsMarkdown([]), '');
  assert.equal(NLME.thoughtsMarkdown(), '');
  assert.equal(NLME.thoughtsMarkdown(null), '');
  assert.equal(NLME.thoughtsMarkdown([{ title: '  ', body: '' }]), '');
});

test('thoughtsMarkdown: one blockquote section, titles bold, bodies quoted, thoughts separated by ">"', () => {
  const md = NLME.thoughtsMarkdown([
    { title: 'Investigating Paul Cohen', body: 'I am looking at forcing.\n\nThen the continuum hypothesis.' },
    { title: 'Searched your sources', body: '' },
    { title: 'Drafting the answer', body: 'One line.' }
  ]);
  assert.equal(md, [
    '> **Thoughts**',
    '>',
    '> **Investigating Paul Cohen**',
    '>',
    '> I am looking at forcing.',
    '>',
    '> Then the continuum hypothesis.',
    '>',
    '> **Searched your sources**',
    '>',
    '> **Drafting the answer**',
    '>',
    '> One line.'
  ].join('\n'));
});

test('thoughtsMarkdown: whitespace in titles collapses, body edges are trimmed, a body without a title stays', () => {
  const md = NLME.thoughtsMarkdown([{ title: '  Two\n words ', body: '\n\n  text  \n\n' }, { title: '', body: 'Untitled body' }]);
  assert.equal(md, '> **Thoughts**\n>\n> **Two words**\n>\n> text\n>\n> Untitled body');
});

test('thoughtsMarkdown: Material icon names never appear', () => {
  const md = NLME.thoughtsMarkdown([
    { title: 'neurology', body: '' },
    { title: 'document_search', body: '' },
    { title: 'Searched your sources', body: '' }
  ]);
  assert.equal(md, '> **Thoughts**\n>\n> **Searched your sources**');
  assert.doesNotMatch(md, /neurology|document_search/);
  // A thought whose only content is an icon name is dropped entirely
  assert.equal(NLME.thoughtsMarkdown([{ title: 'neurology', body: '' }]), '');
  // An icon name as the title of a real thought: the body stays, the name goes
  assert.equal(NLME.thoughtsMarkdown([{ title: 'neurology', body: 'Body' }]), '> **Thoughts**\n>\n> Body');
});

test('isMaterialIconName: snake_case ligature names, never a sentence', () => {
  for (const name of ['neurology', 'document_search', 'expand_more', 'keyboard_arrow_down']) {
    assert.equal(NLME.isMaterialIconName(name), true, name);
  }
  for (const text of ['Searched your sources', 'Thoughts', 'Investigating Paul Cohen', '', 'x'.repeat(60), 'C++']) {
    assert.equal(NLME.isMaterialIconName(text), false, text);
  }
});

// ---------- scan warnings ----------

test('chatScanErrors: skipped messages, collapsed groups, then unread Thoughts', () => {
  const stats = {
    skipped: ['Message 2 could not be read and was skipped'],
    collapsedRemaining: 1,
    thoughtsUnread: ['Message 4: Thoughts could not be read']
  };
  assert.deepEqual(NLME.chatScanErrors(stats, 'quotes'), [
    { type: 'message_skipped', message: 'Message 2 could not be read and was skipped' },
    { type: 'collapsed_citations', message: '1 citation group(s) were still collapsed after the scan; their citations are missing' },
    { type: 'thoughts_unread', message: 'Message 4: Thoughts could not be read' }
  ]);
  // 'none' drops citations on purpose; Thoughts are still missing
  assert.deepEqual(NLME.chatScanErrors(stats, 'none').map(e => e.type), ['message_skipped', 'thoughts_unread']);
  assert.deepEqual(NLME.chatScanErrors({}, 'quotes'), []);
  assert.deepEqual(NLME.chatScanErrors(undefined, 'quotes'), []);
});

// ---------- the chat converter ----------

const PLACEHOLDER = NLME.THOUGHTS_PLACEHOLDER_HTML;

// Turndown stand-in: <p>text</p> blocks, a citation <sup>, and the Thoughts
// placeholder (a DIV node through the real chatThoughts rule). Blocks are
// joined the way Turndown joins block output: one blank line.
class FakeTurndown {
  constructor(options) { this.options = options; this.rules = {}; }
  escape(text) { return text; }
  addRule(name, rule) { this.rules[name] = rule; }
  turndown(html) {
    const placeholderNode = {
      nodeName: 'DIV',
      textContent: 'Thoughts',
      hasAttribute: name => name === 'data-nlme-thoughts',
      getAttribute: () => '',
      classList: { contains: () => false }
    };
    const parts = [];
    const re = new RegExp(`${PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|<p>([\\s\\S]*?)</p>`, 'g');
    let m;
    while ((m = re.exec(html))) {
      if (m[0] === PLACEHOLDER) {
        assert.equal(this.rules.chatThoughts.filter(placeholderNode), true);
        parts.push(this.rules.chatThoughts.replacement('Thoughts', placeholderNode));
      } else {
        parts.push(`\n\n${m[1]}\n\n`);
      }
    }
    return parts.join('').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
  }
}

function loadConverter() {
  const sandbox = {
    TurndownService: FakeTurndown,
    NLME,
    console: { log() {} },
    logger: { info() {} },
    settings: {},
    Date: class extends Date { toLocaleString() { return 'NOW'; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('takeout-markdown.js'), sandbox);
  const src = read('sidebar-chat.js');
  const start = src.indexOf('function convertChatToMarkdown(');
  vm.runInContext(src.slice(start, src.indexOf('\n}\n', start) + 3), sandbox);
  return sandbox;
}

// The export time reads "NOW" (loadConverter's Date)
const fixedDate = fn => fn();

test('a chat answer with Thoughts: the section sits where "Thoughts" was, without the stray word', () => {
  const sandbox = loadConverter();
  const thoughts = [{ title: 'Investigating Paul Cohen', body: 'Forcing.' }, { title: 'Searched your sources', body: '' }];
  const md = fixedDate(() => sandbox.convertChatToMarkdown('Book', null, [
    { userMessage: 'Expand on Skolem’s paradox.', aiResponseHTML: `${PLACEHOLDER}<p>Skolem’s paradox stems from…</p>`, thoughts, sources: [] }
  ], false));
  assert.match(md, /\*\*A:\*\*\n> \*\*Thoughts\*\*\n>\n> \*\*Investigating Paul Cohen\*\*\n>\n> Forcing\.\n>\n> \*\*Searched your sources\*\*\n\nSkolem’s paradox stems from…\n\n$/);
  assert.doesNotMatch(md, /^Thoughts$/m);
});

test('a chat answer whose Thoughts could not be read: no section and no stray "Thoughts" line', () => {
  const sandbox = loadConverter();
  const md = fixedDate(() => sandbox.convertChatToMarkdown('Book', null, [
    { userMessage: 'Q', aiResponseHTML: `${PLACEHOLDER}<p>Answer</p>`, thoughts: [], sources: [] }
  ], false));
  assert.match(md, /\*\*A:\*\*\nAnswer\n\n$/);
  assert.doesNotMatch(md, /Thoughts/);
});

test('Thoughts belong to their own answer only', () => {
  const sandbox = loadConverter();
  const md = fixedDate(() => sandbox.convertChatToMarkdown('Book', null, [
    { userMessage: 'Q1', aiResponseHTML: `${PLACEHOLDER}<p>A1</p>`, thoughts: [{ title: 'First', body: '' }], sources: [] },
    { userMessage: 'Q2', aiResponseHTML: '<p>A2</p>', sources: [] },
    { userMessage: 'Q3', aiResponseHTML: `${PLACEHOLDER}<p>A3</p>`, thoughts: [{ title: 'Third', body: '' }], sources: [] }
  ], false));
  const answers = md.split('## Q: ').slice(1);
  assert.match(answers[0], /\*\*First\*\*/);
  assert.doesNotMatch(answers[1], /Thoughts/);
  assert.match(answers[2], /\*\*Third\*\*/);
  assert.doesNotMatch(answers[2], /First/);
});

test('an answer without Thoughts converts as before (no thoughts key, empty list, or a list with no placeholder)', () => {
  const sandbox = loadConverter();
  const base = { userMessage: 'Q', aiResponseHTML: '<p>Plain answer</p>', sources: [] };
  const outputs = [base, { ...base, thoughts: [] }, { ...base, thoughts: [{ title: 'Ignored', body: 'x' }] }]
    .map(msg => fixedDate(() => sandbox.convertChatToMarkdown('Book', null, [msg], false)));
  assert.equal(outputs[0], '# Book\n\n**Chat Export**\n\nExported: NOW\n\nTotal Messages: 1\n\n---\n\n## Q: Q\n\n**A:**\nPlain answer\n\n');
  assert.equal(outputs[1], outputs[0]);
  assert.equal(outputs[2], outputs[0]);
});

test('the notes converter has no Thoughts rule (the placeholder only exists in chat answers)', () => {
  const sandbox = loadConverter();
  const note = sandbox.NLMEMarkdown.createConverter({ variant: 'note' });
  assert.equal(note.turndownService.rules.chatThoughts, undefined);
  const chat = sandbox.NLMEMarkdown.createConverter({ variant: 'chat' });
  assert.equal(typeof chat.turndownService.rules.chatThoughts.replacement, 'function');
});

// ---------- the page script ----------

test('content.js reads Thoughts during the chat scan and collapses them again in a finally', () => {
  const src = read('content.js');
  const start = src.indexOf('  async function readChatThoughts(');
  assert.ok(start >= 0, 'readChatThoughts not found in content.js');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.match(body, /finally/);
  assert.match(body, /isExportCancelled\(\)/);
  assert.match(body, /isThoughtsOpen\(view\)/);
  // scanChat reads them after the citation groups are open and before extraction
  const scan = src.slice(src.indexOf('  async function scanChat('));
  const order = ['expandCollapsedCitations()', 'readChatThoughts(', 'extractChatMessages('].map(s => scan.indexOf(s));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], `scan order ${order}`);
});

test('the placeholder keeps the word "Thoughts" (any other converter writes what 1.9.5 wrote)', () => {
  assert.match(PLACEHOLDER, /^<div data-nlme-thoughts="">Thoughts<\/div>$/);
});
