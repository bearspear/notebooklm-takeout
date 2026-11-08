// Source import cards (1.9.6): a chat answer's a2ui-source-import-card
// ("Report & Outside sources (5)", the source names, "All sources
// imported", a row of remote favicons) is written as one line of text,
// never as favicon images. Also: a -with-images version never keeps a
// remote image. Tests have no DOM: a fake Turndown runs the real
// importCard rule of takeout-markdown.js on a fake card node, and the real
// convertChatToMarkdown of sidebar-chat.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const CARD = { heading: 'Report & Outside sources (5)', names: 'Research Report, Open Logic Project, and nLab, +2', status: 'All sources imported' };
const CARD_LINE = '*Report & Outside sources (5): Research Report, Open Logic Project, and nLab, +2. All sources imported.*';
const FAVICON = 'https://www.google.com/s2/favicons?domain=https%3A%2F%2Fncatlab.org%2Fnlab&sz=64';

// ---------- NLME.importCardMarkdown ----------

test('importCardMarkdown: heading, names and status as one italic line', () => {
  assert.equal(NLME.importCardMarkdown(CARD), CARD_LINE);
});

test('importCardMarkdown: missing parts are left out; nothing gives ""', () => {
  assert.equal(NLME.importCardMarkdown({ heading: 'Outside sources (3)', status: 'All sources imported' }), '*Outside sources (3). All sources imported.*');
  assert.equal(NLME.importCardMarkdown({ heading: 'Outside sources (3)', names: 'nLab' }), '*Outside sources (3): nLab.*');
  assert.equal(NLME.importCardMarkdown({ heading: 'Outside sources (3)' }), '*Outside sources (3).*');
  assert.equal(NLME.importCardMarkdown({ names: 'nLab', status: 'Importing' }), '*nLab. Importing.*');
  assert.equal(NLME.importCardMarkdown({}), '');
  assert.equal(NLME.importCardMarkdown(), '');
});

test('importCardMarkdown: no doubled stop, whitespace collapsed, Markdown characters escaped', () => {
  assert.equal(NLME.importCardMarkdown({ heading: ' Sources\n(2) ', names: 'A, and B.', status: 'Done!' }), '*Sources (2): A, and B. Done!*');
  assert.equal(NLME.importCardMarkdown({ heading: 'x_y *z* [1]' }), '*x\\_y \\*z\\* \\[1\\].*');
});

test('importCardFromLines: first line heading, a status-like last line the status, the rest names', () => {
  assert.deepEqual(NLME.importCardFromLines(['Report & Outside sources (5)', 'Research Report, Open Logic Project, and nLab, +2', 'All sources imported']), CARD);
  assert.deepEqual(NLME.importCardFromLines(['Outside sources (5)', 'All sources imported']), { heading: 'Outside sources (5)', names: '', status: 'All sources imported' });
  assert.deepEqual(NLME.importCardFromLines(['Outside sources (5)', 'nLab, +4']), { heading: 'Outside sources (5)', names: 'nLab, +4', status: '' });
  assert.deepEqual(NLME.importCardFromLines([' ', 'Sources (1)', '', 'nLab', ' Importing… ']), { heading: 'Sources (1)', names: 'nLab', status: 'Importing…' });
  // Icon names never reach the line
  assert.deepEqual(NLME.importCardFromLines(['Sources (1)', 'nLab', 'All sources imported', 'check_circle']), { heading: 'Sources (1)', names: 'nLab', status: 'All sources imported' });
  assert.deepEqual(NLME.importCardFromLines([]), { heading: '', names: '', status: '' });
});

// ---------- remote images in a -with-images version ----------

test('isFaviconServiceUrl: Google favicon services only', () => {
  assert.equal(NLME.isFaviconServiceUrl(FAVICON), true);
  assert.equal(NLME.isFaviconServiceUrl('https://google.com/s2/favicons?domain=x'), true);
  assert.equal(NLME.isFaviconServiceUrl('https://t0.gstatic.com/faviconV2?client=SOCIAL&url=http://x'), true);
  assert.equal(NLME.isFaviconServiceUrl('https://lh3.googleusercontent.com/abc=w800'), false);
  assert.equal(NLME.isFaviconServiceUrl('https://example.com/s2/favicons.png'), false);
  assert.equal(NLME.isFaviconServiceUrl('data:image/png;base64,AAAA'), false);
  assert.equal(NLME.isFaviconServiceUrl('not a url'), false);
});

test('finishRemoteImages: a remote image left after embedding becomes a link; a favicon goes; data and relative images stay', () => {
  const md = [
    'A ![](data:image/png;base64,AAAA) b',
    `![](${FAVICON})![](${FAVICON})`,
    '![chart](https://lh3.googleusercontent.com/abc=w800)',
    '![x](images/local.png)',
    'text [link](https://example.com) end'
  ].join('\n');
  assert.equal(NLME.finishRemoteImages(md), [
    'A ![](data:image/png;base64,AAAA) b',
    '',
    '[image](https://lh3.googleusercontent.com/abc=w800)',
    '![x](images/local.png)',
    'text [link](https://example.com) end'
  ].join('\n'));
  assert.equal(NLME.finishRemoteImages('no images'), 'no images');
});

test('embedImagesForVersion: embeds first, then no remote image stays', () => {
  const url = 'https://lh3.googleusercontent.com/ok';
  const failed = 'https://lh3.googleusercontent.com/failed';
  const md = `![](${url}) ![](${failed}) ![](${FAVICON})`;
  assert.equal(NLME.embedImagesForVersion(md, new Map([[url, 'data:image/png;base64,QQ']])),
    '![](data:image/png;base64,QQ) [image](https://lh3.googleusercontent.com/failed) ');
  // With nothing remote, exactly applyImageEmbeds
  const local = '![](data:image/png;base64,QQ) text';
  assert.equal(NLME.embedImagesForVersion(local, new Map()), NLME.applyImageEmbeds(local, new Map()));
});

test('every -with-images pass goes through embedImagesForVersion', () => {
  for (const file of ['sidebar-chat.js', 'sidebar-notes.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /NLME\.applyImageEmbeds\(/, file);
    assert.match(src, /NLME\.embedImagesForVersion\(/, file);
  }
});

// ---------- the chat converter ----------

// A card node as the page draws it: summary lines in divs, a check_circle
// mat-icon next to the status, and a favicon row of <img>s
const el = (nodeName, children = [], attrs = {}) => {
  const node = { nodeType: 1, nodeName, childNodes: children, attrs };
  children.forEach(c => { c.parentNode = node; });
  node.getAttribute = name => attrs[name] ?? null;
  node.cloneNode = () => el(nodeName, children.map(c => c.cloneNode()), attrs);
  Object.defineProperty(node, 'textContent', { get: () => node.childNodes.map(c => c.textContent).join('') });
  node.querySelectorAll = selector => {
    const names = selector.split(',').map(s => s.trim().toUpperCase());
    const out = [];
    const walk = n => n.childNodes.forEach(c => { if (c.nodeType === 1) { if (names.includes(c.nodeName)) out.push(c); walk(c); } });
    walk(node);
    return out;
  };
  node.remove = () => { const p = node.parentNode; if (p) p.childNodes = p.childNodes.filter(c => c !== node); };
  return node;
};
const txt = text => ({ nodeType: 3, nodeName: '#text', textContent: text, cloneNode() { return txt(text); } });
const card = () => el('A2UI-SOURCE-IMPORT-CARD', [el('DIV', [el('DIV', [
  el('DIV', [txt('Report & Outside sources (5)')]),
  el('DIV', [el('DIV', [el('IMG', [], { src: FAVICON }), el('IMG', [], { src: FAVICON })]), el('SPAN', [txt('Research Report, Open Logic Project, ')]), el('SPAN', [txt('and nLab, +2')])]),
  el('DIV', [txt(' All sources imported '), el('MAT-ICON', [txt('check_circle')])])
])])]);

class FakeTurndown {
  constructor(options) { this.options = options; this.rules = {}; }
  escape(text) { return text; }
  addRule(name, rule) { this.rules[name] = rule; }
  // Parts: '<p>text</p>' strings, or the card (through the real importCard rule)
  turndown(parts) {
    return parts.map(part => {
      if (typeof part !== 'string') {
        assert.equal(this.rules.importCard.filter(part), true);
        return this.rules.importCard.replacement('', part);
      }
      return `\n\n${part.replace(/<\/?p>/g, '')}\n\n`;
    }).join('').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
  }
}

function loadConverter() {
  const sandbox = {
    TurndownService: FakeTurndown, NLME, console: { log() {} }, logger: { info() {} }, settings: {},
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

test('importCardLines reads the card a line per block, icons and images left out', () => {
  const { NLMEMarkdown } = loadConverter();
  assert.deepEqual([...NLMEMarkdown.importCardLines(card())], ['Report & Outside sources (5)', 'Research Report, Open Logic Project, and nLab, +2', 'All sources imported']);
});

test('a chat answer with an import card: the line in place of the card, in the base and code-blocks conversions, and no favicon', () => {
  const sandbox = loadConverter();
  const messages = [{ userMessage: 'Q', aiResponseHTML: ['<p>Before.</p>', card(), '<p>After.</p>'], sources: [] }];
  for (const codeBlocks of [false, true]) {
    const md = sandbox.convertChatToMarkdown('Book', null, messages, codeBlocks);
    assert.match(md, new RegExp(`\\*\\*A:\\*\\*\\nBefore\\.\\n\\n${CARD_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\nAfter\\.\\n\\n$`));
    assert.doesNotMatch(md, /s2\/favicons|check_circle/);
    // and the -with-images version of it
    assert.doesNotMatch(NLME.embedImagesForVersion(md, new Map()), /s2\/favicons|!\[/);
  }
});

test('the notes converter has no import card rule', () => {
  const sandbox = loadConverter();
  assert.equal(sandbox.NLMEMarkdown.createConverter({ variant: 'note' }).turndownService.rules.importCard, undefined);
});
