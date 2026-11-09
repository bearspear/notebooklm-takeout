// 1.9.9: an image whose alt text is its own address is written with no alt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

const URL_A = 'https://lh3.googleusercontent.com/notebooklm/ANabc=w512';

test('cleanImageAlt: an address as alt text is dropped', () => {
  assert.equal(NLME.cleanImageAlt(URL_A, 'data:image/png;base64,aa'), '');
  assert.equal(NLME.cleanImageAlt('http://a.org/x.png', URL_A), '');
  assert.equal(NLME.cleanImageAlt('  https://a.org/x.png ', 'x'), '');
});

test('cleanImageAlt: alt equal to the src is dropped, a real alt is kept', () => {
  assert.equal(NLME.cleanImageAlt('img.png', 'img.png'), '');
  assert.equal(NLME.cleanImageAlt('Surface of Venus', URL_A), 'Surface of Venus');
  assert.equal(NLME.cleanImageAlt('See https://a.org here', URL_A), 'See https://a.org here');
  assert.equal(NLME.cleanImageAlt('', URL_A), '');
  assert.equal(NLME.cleanImageAlt(null, URL_A), '');
});

test('the converter writes images through cleanImageAlt, so the data-URI src stays', () => {
  const sandbox = { globalThis: null, NLME, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'takeout-markdown.js'), 'utf8'), sandbox);
  const el = (tag, attrs, kids = []) => ({
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: kids, children: kids,
    getAttribute: n => (n in attrs ? attrs[n] : null), hasAttribute: n => n in attrs,
    classList: { contains: () => false }, closest: () => null, querySelector: () => null, querySelectorAll: () => []
  });
  const out = sandbox.NLMEMarkdown.htmlToMarkdownPlain(el('div', {}, [
    el('img', { src: 'data:image/png;base64,aa', alt: URL_A }),
    el('img', { src: 'data:image/png;base64,bb', alt: 'Venus' })
  ]));
  assert.match(out, /!\[\]\(data:image\/png;base64,aa\)/);
  assert.match(out, /!\[Venus\]\(data:image\/png;base64,bb\)/);
});

// Review round: the Turndown converters (notes, sources, chat) have their own image rule
class FakeTurndown {
  constructor(options) { this.options = options; this.rules = {}; }
  escape(text) { return text; }
  addRule(name, rule) { this.rules[name] = rule; }
}
const imgNode = attrs => ({ nodeName: 'IMG', getAttribute: n => (n in attrs ? attrs[n] : null) });
for (const variant of ['note', 'chat']) {
  test(`${variant}: Turndown image rule drops an address as alt, otherwise writes what Turndown writes`, () => {
    const sandbox = { TurndownService: FakeTurndown, NLME };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'takeout-markdown.js'), 'utf8'), sandbox);
    const r = sandbox.NLMEMarkdown.createConverter({ variant }).turndownService.rules.images;
    assert.ok(r, 'images rule exists');
    assert.equal(r.filter, 'img');
    assert.equal(r.replacement('', imgNode({ src: URL_A, alt: URL_A })), `![](${URL_A})`);
    assert.equal(r.replacement('', imgNode({ src: URL_A, alt: 'Surface\n  of Venus', title: 'T\n x' })), `![Surface\nof Venus](${URL_A} "T\nx")`);
    assert.equal(r.replacement('', imgNode({ src: URL_A })), `![](${URL_A})`);
    assert.equal(r.replacement('', imgNode({ alt: 'x' })), '');
  });
}

test('embedImagesInMarkdown keeps an empty alt', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidebar-sources.js'), 'utf8');
  assert.ok(src.includes('([^\\]]*)'), 'alt pattern accepts an empty alt');
  const re = /!\[([^\]]*)\]\((https:\/\/lh3\.google(?:usercontent)?\.com\/[^\)]+)\)/g;
  const m = [...`![](${URL_A})`.matchAll(re)];
  assert.equal(m.length, 1);
  assert.equal(`![${m[0][1]}](data:x)`, '![](data:x)');
});
