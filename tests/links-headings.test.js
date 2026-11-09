// 1.9.9: Google redirect links are written as their real address, and headings
// carry no bold markers. Pure logic is NLME.unwrapGoogleRedirect and
// NLME.plainHeading; the Turndown rules run against a fake Turndown.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

test('unwrapGoogleRedirect: q= target decoded once', () => {
  assert.equal(
    NLME.unwrapGoogleRedirect('https://www.google.com/url?sa=E&q=https%3A%2F%2Fncatlab.org%2Fnlab%2Fshow%2FL%25C3%25B6wenheim'),
    'https://ncatlab.org/nlab/show/L%C3%B6wenheim');
});

test('unwrapGoogleRedirect: url= param and google.com without www', () => {
  assert.equal(NLME.unwrapGoogleRedirect('https://www.google.com/url?url=https%3A%2F%2Fa.org%2Fx&sa=D'), 'https://a.org/x');
  assert.equal(NLME.unwrapGoogleRedirect('https://google.com/url?q=https%3A%2F%2Fa.org%2Fx'), 'https://a.org/x');
});

test('unwrapGoogleRedirect: anything else is unchanged', () => {
  const same = [
    'https://www.google.com/url?sa=E',
    'https://www.google.com/url?q=javascript%3Aalert(1)',
    'https://www.google.com/url?q=%2Frelative%2Fpath',
    'https://ncatlab.org/nlab/show/x?q=https%3A%2F%2Fb.org',
    'https://www.google.com/search?q=https%3A%2F%2Fb.org',
    '#src-1', '', 'not a url'
  ];
  for (const href of same) assert.equal(NLME.unwrapGoogleRedirect(href), href);
  assert.equal(NLME.unwrapGoogleRedirect(undefined), undefined);
});

test('plainHeading: bold markers dropped, whitespace joined', () => {
  assert.equal(NLME.plainHeading('**Henkin’s Method and the Completeness** **Theorem**'), 'Henkin’s Method and the Completeness Theorem');
  assert.equal(NLME.plainHeading('**Atmospheric Mysteries**'), 'Atmospheric Mysteries');
  assert.equal(NLME.plainHeading('**1 Introduction**'), '1 Introduction');
  assert.equal(NLME.plainHeading('The **key** idea'), 'The key idea');
  assert.equal(NLME.plainHeading('**See** [the **link**](http://a.org) and `code`'), 'See [the link](http://a.org) and `code`');
});

test('plainHeading: headings without bold are unchanged', () => {
  for (const s of ['Plain  heading', '1\\. Escaped', 'a \\*\\*b\\*\\* c', '`a**b` code', '_em_ text', '[l](http://a.org)']) {
    assert.equal(NLME.plainHeading(s), s);
  }
});

// ---------- the rules ----------

class FakeTurndown {
  constructor(options) { this.options = options; this.rules = {}; }
  escape(text) { return text; }
  addRule(name, rule) { this.rules[name] = rule; }
}
function rules(variant) {
  const sandbox = { TurndownService: FakeTurndown, NLME };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'takeout-markdown.js'), 'utf8'), sandbox);
  return sandbox.NLMEMarkdown.createConverter({ variant }).turndownService.rules;
}
const a = (href, title) => ({ nodeName: 'A', getAttribute: n => (n === 'href' ? href : n === 'title' ? title || null : null) });
const h = tag => ({ nodeName: tag });

for (const variant of ['note', 'chat']) {
  test(`${variant}: link rule writes the real address, other links are left to Turndown`, () => {
    const r = rules(variant).googleRedirectLinks;
    const wrapped = a('https://www.google.com/url?sa=E&q=https%3A%2F%2Fncatlab.org%2Fnlab%2Fshow%2FL%25C3%25B6wenheim');
    assert.equal(r.filter(wrapped), true);
    assert.equal(r.replacement('nLab', wrapped), '[nLab](https://ncatlab.org/nlab/show/L%C3%B6wenheim)');
    assert.equal(r.replacement('x', a('https://www.google.com/url?q=https%3A%2F%2Fa.org%2Fa_(b)', 'T "q"')), '[x](https://a.org/a_\\(b\\) "T \\"q\\"")');
    assert.equal(r.filter(a('https://ncatlab.org/x')), false);
    assert.equal(r.filter(a('https://www.google.com/url?sa=E')), false);
    assert.equal(r.filter({ nodeName: 'A', getAttribute: () => null }), false);
  });

  test(`${variant}: heading rule drops bold`, () => {
    const r = rules(variant).plainHeadings;
    assert.deepEqual(Array.from(r.filter), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    assert.equal(r.replacement('**1 Introduction**', h('H2')), '\n\n## 1 Introduction\n\n');
    assert.equal(r.replacement('**A** **B**', h('H1')), '\n\n# A B\n\n');
  });

  test(`${variant}: report role=heading rule drops bold too`, () => {
    const r = rules(variant).reportHeadings;
    const node = { nodeName: 'DIV', getAttribute: () => '2' };
    assert.equal(r.replacement('**Atmospheric** **Mysteries**', node), '\n## Atmospheric Mysteries\n\n');
    assert.equal(r.replacement('Plain', node), '\n## Plain\n\n');
  });
}

test('plainHeading: bold markers inside formulas stay', () => {
  assert.equal(NLME.plainHeading('Dual **space** $V^{**}$'), 'Dual space $V^{**}$');
  assert.equal(NLME.plainHeading('**A** $$x^{**}$$ **B**'), 'A $$x^{**}$$ B');
  assert.equal(NLME.plainHeading('**A** $a**b$'), 'A $a**b$');
});

test('unwrapGoogleRedirect: spaces and angle brackets in the target are percent-encoded', () => {
  assert.equal(NLME.unwrapGoogleRedirect('https://www.google.com/url?q=https%3A%2F%2Fex.org%2Fa%20b%3Cc%3E'), 'https://ex.org/a%20b%3Cc%3E');
  assert.equal(NLME.unwrapGoogleRedirect('https://www.google.com/url?q=https://ex.org/a%20b'), 'https://ex.org/a%20b');
});
