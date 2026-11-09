const test = require('node:test');
const assert = require('node:assert/strict');
const { protectMath, restoreMath, restoreMathAttrs, texForKatex, sanitizeHtml } = require('../viewer/viewer-app.js');
const { marked } = require('../viewer/marked.min.js');
const katex = require('../viewer/katex.min.js');
const { treeParser, elementsOf } = require('./fixtures/tree-parser.js');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// md() as the page runs it: formulas out, marked, sanitize, and formulas back into the sanitized tree
const parser = treeParser();
function mdWith(text, draw) {
  const p = protectMath(text);
  return sanitizeHtml(marked.parse(p.text, { gfm: true }), parser, p.math, draw);
}
const render = text => mdWith(text, (src, block, m) => '[[' + (block ? 'B:' : '') + esc(m) + ']]');

test('bold beside a formula closes on the formula, with no literal **', () => {
  assert.equal(render('**sulphur dioxide (**$SO_2$**)**').trim(), '<p><strong>sulphur dioxide (</strong>[[$SO_2$]]<strong>)</strong></p>');
  assert.equal(render('**Carbon Dioxide (**$CO_2$**):**').trim(), '<p><strong>Carbon Dioxide (</strong>[[$CO_2$]]<strong>):</strong></p>');
  assert.equal(render("$M$**'s internal domain**").trim(), "<p>[[$M$]]<strong>'s internal domain</strong></p>");
  assert.equal(render('_$x$_').trim(), '<p><em>[[$x$]]</em></p>');
  assert.match(render('[$x$](https://a.b)'), /<a href="https:\/\/a\.b" target="_blank" rel="noopener">\[\[\$x\$\]\]<\/a>/);
});

test('block formulas and untouched text survive', () => {
  assert.match(render('$$a<b$$'), /\[\[B:\$\$a&lt;b\$\$\]\]/);
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

// Formulas go into the page's text only, through its DOM: a formula in an attribute value comes back
// as its own source text, and markup in a value can never become an element.
const drawK = (src, block, m) => '<span class="k">' + esc(m) + '</span>';
const tags = html => elementsOf(html).filter(e => e.getAttribute('class') !== 'k').map(e => e.localName);
const onAttrs = html => elementsOf(html).flatMap(e => e.attributes.filter(a => /^on/i.test(a.name)).map(a => e.localName + ' ' + a.name));
const EXPLOITS = [
  '<p x" title="$a$ <img src=x onerror=alert(document.domain) $b$">hi</p>',
  '<p x" title="$a$ <img src=x onerror=alert(1) $b$">hi</p>',
  '<div x" title="$a$ <img src=x onerror=alert(1) $b$">\n\nhi\n\n</div>',
  'Some source text.\n\n<p x" title="$a$ <img src=x onerror=alert(document.domain) $b$">hi</p>\n\nmore text with "quotes" here > ok',
  '<p x" title="$a$">hi</p> and later " quote',
  '<p x" title="$x$ <img src=x onerror=alert(1)>">hi</p>',
  '<span a"b title="$x$ <img src=x onerror=alert(1)>">q</span>',
  '<p a<b="1" title="$a$ <img src=x onerror=alert(1) $b$">x</p>',
  '<!-- " --><p title="$a$ <img src=x onerror=alert(1) $b$">x</p>',
  '<a title="$a$ <img src=x onerror=alert(1)>">q</a>',
  '<span title="$a$ &lt;img src=x onerror=alert(1)&gt;">q</span>',
  '[q](http://x "$a$ <img src=x onerror=alert(1)>")',
  '![$a$ <img src=x onerror=alert(1)>](images/x.png)',
  '<xmp>$a</xmp><img src=x onerror=alert(1)>$</xmp>',
  '<noembed>$a</noembed><img src=x onerror=alert(1)>$</noembed>',
  '<!-- $a --><img src=x onerror=alert(1)>b$ -->',
  '<textarea>$a</textarea><img src=x onerror=alert(1)>$</textarea>',
  '<svg><text>$a</text></svg><img src=x onerror=alert(1)>$</text></svg>',
  '`$a</code><img src=x onerror=alert(1)>$`'
];
test('formulas never turn attribute values or raw text into elements', () => {
  for (const t of EXPLOITS) {
    const out = mdWith(t, drawK);
    assert.deepEqual(onAttrs(out), [], t + ' -> ' + out);
    // the elements the Markdown asked for, with the formulas left out as placeholders
    const asked = sanitizeHtml(marked.parse(protectMath(t).text, { gfm: true }), parser);
    assert.deepEqual(tags(out), tags(asked), t + ' -> ' + out);
    // every formula comes back, except in raw text and comments, where the serializer escapes nothing
    if (!/<(xmp|noembed)>|<!--/.test(t)) assert.doesNotMatch(out, /XMATHX/, t + ' -> ' + out);
  }
});

test('a formula in an attribute value reads as its source', () => {
  const attr = (html, tag, name) => elementsOf(html).find(e => e.localName === tag).getAttribute(name);
  assert.equal(attr(mdWith('[a](http://x/$y$)', drawK), 'a', 'href'), 'http://x/$y$');
  assert.equal(attr(mdWith('[q](http://x "$a$ b")', drawK), 'a', 'title'), '$a$ b');
  assert.equal(attr(mdWith('<span title="$a$">q</span>', drawK), 'span', 'title'), '$a$');
  assert.equal(attr(mdWith('<p x" title="$a$ <img src=x onerror=alert(1) $b$">hi</p>', drawK), 'p', 'title'), '$a$ <img src=x onerror=alert(1) $b$');
});

test('code, svg and math keep a formula as its source text', () => {
  assert.equal(mdWith('`$a$`', drawK).trim(), '<p><code>$a$</code></p>');
  assert.equal(mdWith('```\n$a$ and $$b$$\n```', drawK).trim(), '<pre><code>$a$ and $$b$$\n</code></pre>');
  assert.equal(mdWith('<code>$a<b$</code>', drawK).trim(), '<p><code>$a&lt;b$</code></p>');
  assert.equal(mdWith('<svg><text>$a$</text></svg>', drawK).trim(), '<p><svg><text>$a$</text></svg></p>');
  assert.equal(mdWith('<textarea>$a$</textarea>', drawK).trim(), '<textarea>$a$</textarea>');
  assert.equal(mdWith('see $a$ and `$b$`', drawK).trim(), '<p>see <span class="k">$a$</span> and <code>$b$</code></p>');
});

test('formulas in text still render, beside bold too', () => {
  assert.match(mdWith('see $a$ and **$b$**', drawK), /<p>see <span class="k">\$a\$<\/span> and <strong><span class="k">\$b\$<\/span><\/strong><\/p>/);
  assert.match(mdWith('**sulphur dioxide (**$SO_2$**)**', drawK), /<strong>sulphur dioxide \(<\/strong><span class="k">\$SO_2\$<\/span><strong>\)<\/strong>/);
  assert.match(mdWith('a $$x^2$$ b', (src, block) => '<span class="k">' + block + ':' + esc(src) + '</span>'), /<span class="k">true:x\^2<\/span>/);
  // KaTeX's own output goes in as elements, with its style and MathML
  const out = mdWith('a $x^2$ b', (src, block) => katex.renderToString(texForKatex(src), { displayMode: block, throwOnError: false }));
  assert.ok(elementsOf(out).some(e => e.getAttribute('class') === 'katex'), out);
  assert.ok(elementsOf(out).some(e => e.localName === 'math'), out);
  assert.match(out, /style="/);
  // a formula placeholder with no formula behind it stays as typed
  const body = parser.parseFromString('<p title="$XMATHX7XEND$">a $XMATHX7XEND$ b $XMATHX0XEND$</p>').body;
  restoreMathAttrs(body, ['$x$']);
  restoreMath(body, ['$x$'], drawK, parser);
  assert.equal(body.innerHTML, '<p title="$XMATHX7XEND$">a $XMATHX7XEND$ b <span class="k">$x$</span></p>');
});

test('rendered formula markup loses handlers and scripts', () => {
  const out = mdWith('a $x$ b', () => '<span class="k" onclick="x()" onmouseover="y()"><script>z()</script>x</span>');
  assert.deepEqual(onAttrs(out), [], out);
  assert.doesNotMatch(out, /<script/, out);
  assert.match(out, /<span class="k">x<\/span>/, out);
});

test('attribute checks see the value with its formulas put back', () => {
  const styles = html => elementsOf(html).map(e => e.getAttribute('style')).filter(v => v != null);
  for (const t of ['<p style="color:red/*$x*/background:url(//evil.example/x.png);/*$*/">s</p>',
    '<p style="color:red\\/*$x*/;background:u\\rl(images/x.png)/*$*/">s</p>',
    '<p style="a:b/*$x*/;@import x;/*$*/">s</p>']) {
    const out = mdWith(t, drawK);
    assert.deepEqual(styles(out).filter(v => /url\s*\(|\\|@import/i.test(v)), [], t + ' -> ' + out);
  }
  const attr = (html, tag, name) => (elementsOf(html).find(e => e.localName === tag) || { getAttribute: () => null }).getAttribute(name);
  assert.equal(attr(mdWith('<a href="javascript:alert($x$)">q</a>', drawK), 'a', 'href'), null);
  assert.equal(attr(mdWith('<img src="//evil.example/$x$.png" alt="a">', drawK), 'img', 'src'), null);
  assert.equal(attr(mdWith('<img src="images/$x$.png" alt="a">', drawK), 'img', 'src'), 'images/$x$.png');
  assert.equal(attr(mdWith('<p style="color:red/*$x$*/">s</p>', drawK), 'p', 'style'), 'color:red/*$x$*/');
});

test('sanitizeHtml drops attributes whose name is not a plain name', () => {
  const out = sanitizeHtml('<p x" title="t" a<b="1" ok-1="2" xlink:href="#a">hi</p>', parser);
  assert.equal(out, '<p title="t" ok-1="2" xlink:href="#a">hi</p>');
});
