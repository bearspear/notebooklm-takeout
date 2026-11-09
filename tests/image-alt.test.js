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
