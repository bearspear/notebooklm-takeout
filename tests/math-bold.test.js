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

test('texForKatex leaves fractions alone inside text-mode groups', () => {
  assert.equal(texForKatex('\\text{½ cup}'), '\\text{½ cup}');
  assert.equal(texForKatex('½ + \\text{½}'), '\\frac{1}{2} + \\text{½}');
  assert.equal(texForKatex('\\mathrm{a{½}b} ¼'), '\\mathrm{a{½}b} \\frac{1}{4}');
  for (const c of ['textrm', 'textit', 'textbf', 'mathrm', 'operatorname', 'mbox']) assert.equal(texForKatex('\\' + c + '{½}'), '\\' + c + '{½}');
  const html = katex.renderToString(texForKatex('\\text{½ cup}'), { throwOnError: false });
  assert.doesNotMatch(html, /katex-error|#cc0000/);
});

// Formulas go into text only. Sanitized attribute values keep "<" raw, so KaTeX markup in an attribute would turn live.
function renderSafe(text) {
  const p = protectMath(text);
  const html = marked.parse(p.text, { gfm: true });
  return restoreMath(html, p.math, (src, block, m) => '<K>' + m.replace(/"/g, '&quot;') + '</K>');
}
test('formulas in attributes come back as their plain source, never as markup', () => {
  for (const t of ['<a title="$a$ <img src=x onerror=alert(1)>">q</a>', '[q](http://x "$a$ <img src=x onerror=alert(1)>")', '![$a$ <img src=x onerror=alert(1)>](images/x.png)', '<span title="$a$ &lt;img src=x onerror=alert(1)&gt;">q</span>']) {
    const out = renderSafe(t);
    const bare = out.replace(/"[^"]*"/g, '""');
    assert.doesNotMatch(bare, /\son\w+=/i, out);
    assert.ok((bare.match(/<img/gi) || []).length <= (t[0] === '!' ? 1 : 0), out);
    assert.ok(!/="[^"]*<K>/.test(out), out);
  }
  assert.match(renderSafe('[q](http://x "$a$ b")'), /title="\$a\$ b"/);
  assert.match(renderSafe('[a](http://x/$y$)'), /href="http:\/\/x\/\$y\$"/);
  assert.match(renderSafe('see $a$ and **$b$**'), /<p>see <K>\$a\$<\/K> and <strong><K>\$b\$<\/K><\/strong><\/p>/);
});
