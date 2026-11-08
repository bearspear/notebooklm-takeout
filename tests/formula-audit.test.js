// The formula audit (1.9.5): "written" is what the converter wrote, counted
// once per KaTeX node that reaches the final text, not a regex over the
// Markdown. Tests have no DOM: a fake Turndown runs the real KaTeX rule and
// convert() of takeout-markdown.js, and the real countPageContent and
// convertCounted of sidebar-core.js read fake KaTeX nodes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

const ROOT = path.join(__dirname, '..');

// A KaTeX node as the page draws it: inline, its LaTeX on the host's data-math
const katex = tex => ({
  nodeName: 'SPAN',
  textContent: tex,
  classList: { contains: c => c === 'katex' },
  closest: selector => (selector === '[data-math]' ? { getAttribute: () => tex } : null),
  querySelector: () => null
});

// Content is a list of text strings, KaTeX nodes, lists (ul) and tables.
// Lists and tables go through the real listsWithWrappers and tables rules,
// which convert each item or cell again (turndown(li.innerHTML)) after
// Turndown has converted their content, which the rules throw away
const ul = (...items) => {
  const node = { nodeName: 'UL', fake: 'list' };
  const lis = items.map(parts => ({ parentElement: node, innerHTML: parts }));
  node.querySelectorAll = () => lis;
  return node;
};
const table = (...rows) => ({
  nodeName: 'TABLE',
  fake: 'table',
  querySelectorAll: () => rows.map(cells => ({ querySelectorAll: () => cells.map(parts => ({ innerHTML: parts })) }))
});
const childParts = node => (node.fake === 'list'
  ? node.querySelectorAll('li').flatMap(li => li.innerHTML)
  : node.querySelectorAll('tr').flatMap(tr => tr.querySelectorAll('th, td').flatMap(c => c.innerHTML)));

class FakeTurndown {
  constructor(options) { this.options = options; this.rules = {}; }
  escape(text) { return text; }
  addRule(name, rule) { this.rules[name] = rule; }
  turndown(parts) {
    return parts.map(part => {
      if (typeof part === 'string') return part;
      if (part.fake) {
        const content = this.turndown(childParts(part));
        const rule = part.fake === 'list' ? this.rules.listsWithWrappers : this.rules.tables;
        return rule.replacement(content, part, { bulletListMarker: '*' });
      }
      return this.rules.katexMath.replacement('', part);
    }).join('');
  }
}

function loadPanel() {
  const sandbox = { TurndownService: FakeTurndown, NLME };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'takeout-markdown.js'), 'utf8'), sandbox);
  const core = fs.readFileSync(path.join(ROOT, 'sidebar-core.js'), 'utf8');
  const fn = name => {
    const start = core.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} not found`);
    return core.slice(start, core.indexOf('\n}\n', start) + 3);
  };
  const katexNodes = parts => parts.flatMap(p => (typeof p === 'string' ? [] : p.fake ? katexNodes(childParts(p)) : [p]));
  sandbox.DOMParser = class {
    parseFromString(parts) {
      return { querySelectorAll: selector => (selector === '.katex' ? katexNodes(parts || []) : []) };
    }
  };
  vm.runInContext(`${fn('countPageContent')}\n${fn('convertCounted')}\nthis.convertCounted = convertCounted;`, sandbox);
  return sandbox;
}

// One conversion's audit: [written, expected] and the Markdown
function audit(parts) {
  const panel = loadPanel();
  const counts = { expected: { formulas: 0 }, written: { formulas: 0 } };
  const converter = panel.NLMEMarkdown.createConverter();
  const markdown = panel.convertCounted(counts, parts, () => converter.convert(parts));
  return { markdown, formulas: [counts.written.formulas, counts.expected.formulas] };
}

test('a formula touching a number counts, and a price in the text does not', () => {
  const r = audit([
    '1 millimetre (mm): 10-3 m ', katex('1 micron (μm): 10-6 m'), '1 nanometre (nm): 10-9 m. ',
    'It cost US$3.5 billion; … later US$4.7 billion.'
  ]);
  assert.equal(r.markdown, '1 millimetre (mm): 10-3 m $1 micron (μm): 10-6 m$1 nanometre (nm): 10-9 m. It cost US$3.5 billion; … later US$4.7 billion.');
  assert.deepEqual(r.formulas, [1, 1]);
});

test('a price range the page drew as math counts on neither side', () => {
  const r = audit(['Between ', katex('3-'), '4 million in total.']);
  assert.equal(r.markdown, 'Between $3-$4 million in total.');
  assert.deepEqual(r.formulas, [0, 0]);
});

test('adjacent formulas count one each', () => {
  const r = audit([katex('a'), katex('b'), ' and ', katex('c'), 'word']);
  assert.equal(r.markdown, '$a$$b$ and $c$word');
  assert.deepEqual(r.formulas, [3, 3]);
});

test('a formula in a nested list counts once, though the list rules convert it again', () => {
  const r = audit([ul(['Top ', katex('a+b'), ul(['Inner ', katex('c_1')])], ['Second ', katex('e')])]);
  // (the fake Turndown leaves the blank lines its postprocess would trim)
  assert.equal(r.markdown.trim(), '* Top $a+b$\n  * Inner $c_1$\n* Second $e$');
  assert.deepEqual(r.formulas, [3, 3]);
});

test('a formula in a table cell, and in a list in a cell, counts once', () => {
  const r = audit([table([['Name'], ['Value']], [[katex('\\alpha')], [ul([katex('b|c')])]])]);
  assert.equal(r.markdown.trim(), '| Name | Value |\n| --- | --- |\n| $\\alpha$ | * $b\\|c$ |');
  assert.deepEqual(r.formulas, [2, 2]);
});

test('the Venus Sheehan source: all four page formulas count, where the regex found three', () => {
  // The live page drew exactly these four; the lines are the export's own
  // (sources/Venus-William-Sheehan.pdf.md, Venus takeout 2026-11-08)
  const r = audit([
    'on which the ', katex('now-famous Y- and ψ-shaped markings figure prominently. It looks'), 'at least vaguely similar\n\n',
    '## 1 kilometre (km): 103 m = 0.621371 miles 1 mile\\* (mi.): 1.609344 km 1 centimetre (cm): 10-1 m = 0.393701 inches 1 millimetre (mm): 10-3 m ',
    katex('1 micron (μm): 10-6 m'), '1 nanometre (nm): 10-9 m 1 angstrom\\* (Å): 0.1 nm\n\n',
    '## ', katex('2π radians = 360o'), '\n\n',
    'pp. 1263–6. ', katex('J. Lecacheux et al., ‘Detection of the Surface of Venus at 1.0 μm from Ground-Based'), 'Observations’, Planetary'
  ]);
  const lines = r.markdown.split('\n');
  assert.ok(lines.includes('## 1 kilometre (km): 103 m = 0.621371 miles 1 mile\\* (mi.): 1.609344 km 1 centimetre (cm): 10-1 m = 0.393701 inches 1 millimetre (mm): 10-3 m $1 micron (μm): 10-6 m$1 nanometre (nm): 10-9 m 1 angstrom\\* (Å): 0.1 nm'));
  assert.ok(lines.includes('## $2π radians = 360o$'));
  assert.deepEqual(r.formulas, [4, 4]);
  assert.equal(NLME.countMarkdownFormulas(r.markdown), 3, 'the old counter missed the micron formula');
});

test('convert() leaves no formula mark in its text', () => {
  const panel = loadPanel();
  const md = panel.NLMEMarkdown.createConverter({ citations: 'footnotes' }).convert(['x ', katex('y'), ' z']);
  assert.equal(md, 'x $y$ z');
  assert.doesNotMatch(md, /[-]/);
});

test('markWrittenFormula marks a written formula, not an empty one or a price range', () => {
  assert.equal(NLME.markWrittenFormula('$x$', 'x'), '$x$');
  assert.equal(NLME.markWrittenFormula('$x$', undefined), '$x$');
  assert.equal(NLME.markWrittenFormula('', 'x'), '');
  assert.equal(NLME.markWrittenFormula('$3-$', '3-'), '$3-$');
});

test("a U+E002 in the page's own text stays in the export and is not counted", () => {
  const r = audit(['warning \uE002 sign, ', katex('x'), ' and \uE002 again']);
  assert.equal(r.markdown, 'warning \uE002 sign, $x$ and \uE002 again');
  assert.deepEqual(r.formulas, [1, 1]);
  assert.deepEqual(NLME.takeFormulaMarks('\uE002 a \uE002\uE002$y$ \uE002'), { text: '\uE002 a \uE002$y$ \uE002', formulas: 1 });
});

test('convertCounted refuses an asynchronous convert', () => {
  const panel = loadPanel();
  const counts = { expected: { formulas: 0 }, written: { formulas: 0 } };
  assert.throws(() => panel.convertCounted(counts, [], () => Promise.resolve('')), /must be synchronous/);
});

test('takeFormulaMarks counts the marks and takes them out', () => {
  assert.deepEqual(NLME.takeFormulaMarks('a $x$$y$ b'), { text: 'a $x$$y$ b', formulas: 2 });
  assert.deepEqual(NLME.takeFormulaMarks('US$3.5 billion; US$4.7'), { text: 'US$3.5 billion; US$4.7', formulas: 0 });
  assert.deepEqual(NLME.takeFormulaMarks(undefined), { text: '', formulas: 0 });
});
