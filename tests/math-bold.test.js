const test = require('node:test');
const assert = require('node:assert/strict');
const { protectMath, restoreMath, texForKatex } = require('../viewer/viewer-app.js');
const { marked } = require('../viewer/marked.min.js');
const katex = require('../viewer/katex.min.js');

const render = (text) => {
  const p = protectMath(text);
  const html = marked.parse(p.text, { gfm: true });
  return restoreMath(html, p.math, (src, block, m) => '[[' + (block ? 'B:' : '') + m + ']]');
};

test('bold beside a formula closes on the formula, with no literal **', () => {
  assert.equal(render('**sulphur dioxide (**$SO_2$**)**').trim(), '<p><strong>sulphur dioxide (</strong>[[$SO_2$]]<strong>)</strong></p>');
  assert.equal(render('**Carbon Dioxide (**$CO_2$**):**').trim(), '<p><strong>Carbon Dioxide (</strong>[[$CO_2$]]<strong>):</strong></p>');
  assert.equal(render("$M$**'s internal domain**").trim(), '<p>[[$M$]]<strong>&#39;s internal domain</strong></p>');
  assert.equal(render('_$x$_').trim(), '<p><em>[[$x$]]</em></p>');
  assert.match(render('[$x$](https://a.b)'), /<a href="https:\/\/a\.b">\[\[\$x\$\]\]<\/a>/);
});

test('block formulas and untouched text survive', () => {
  assert.match(render('$$a<b$$'), /\[\[B:\$\$a<b\$\$\]\]/);
  assert.equal(render('plain XMATHX0XEND').trim(), '<p>plain XMATHX0XEND</p>');
});

test('texForKatex draws vulgar fractions', () => {
  assert.equal(texForKatex('½ + ¼ + ⅛'), '\\frac{1}{2} + \\frac{1}{4} + \\frac{1}{8}');
  for (const [c, t] of [['¾', '\\frac{3}{4}'], ['⅓', '\\frac{1}{3}'], ['⅔', '\\frac{2}{3}'], ['⅜', '\\frac{3}{8}'], ['⅝', '\\frac{5}{8}'], ['⅞', '\\frac{7}{8}'], ['⅕', '\\frac{1}{5}']]) assert.equal(texForKatex('a ' + c + ' b'), 'a ' + t + ' b');
  assert.equal(texForKatex('x^2 + y'), 'x^2 + y');
});

test('a formula with fractions renders without a KaTeX error', () => {
  const html = katex.renderToString(texForKatex('½ + ¼ + ⅛'), { throwOnError: false });
  assert.doesNotMatch(html, /katex-error|#cc0000/);
});
