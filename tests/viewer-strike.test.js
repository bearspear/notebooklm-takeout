const test = require('node:test');
const assert = require('node:assert/strict');
const { strictStrike } = require('../viewer/viewer-app.js');
const { marked } = require('../viewer/marked.min.js');

strictStrike(marked);
const html = t => marked.parse(t, { gfm: true }).trim();

test('a single tilde is an approximate value, not strikethrough', () => {
  assert.equal(html('Orcus (~910 km) and Vanth (~443 km) match'), '<p>Orcus (~910 km) and Vanth (~443 km) match</p>');
  assert.equal(html('~1 and ~2'), '<p>~1 and ~2</p>');
  assert.equal(html('**a (~1 km) b (~2 km)**'), '<p><strong>a (~1 km) b (~2 km)</strong></p>');
});

test('double tildes still strike through', () => {
  assert.equal(html('a ~~gone~~ b'), '<p>a <del>gone</del> b</p>');
  assert.equal(html('~~two words~~ and ~3 km'), '<p><del>two words</del> and ~3 km</p>');
  assert.equal(html('~~**bold** inside~~'), '<p><del><strong>bold</strong> inside</del></p>');
});

test('tildes in code and fenced blocks are untouched', () => {
  assert.equal(html('`~a~`'), '<p><code>~a~</code></p>');
  assert.match(html('~~~\nx ~1~ y\n~~~'), /<pre><code>x ~1~ y\n<\/code><\/pre>/);
});

test('strictStrike can be applied twice', () => {
  strictStrike(marked);
  assert.equal(html('(~1) (~2)'), '<p>(~1) (~2)</p>');
});
