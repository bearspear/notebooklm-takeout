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

// Content is a list of text strings, KaTeX nodes and { list: [...] }. A list
// converts its children, throws that away and converts them again, as the
// list and table rules do (turndown(li.innerHTML))
class FakeTurndown {
  constructor(options) { this.options = options; this.rules = {}; }
  escape(text) { return text; }
  addRule(name, rule) { this.rules[name] = rule; }
  turndown(parts) {
    return parts.map(part => {
      if (typeof part === 'string') return part;
      if (part.list) {
        this.turndown(part.list);
        return this.turndown(part.list);
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
  const katexNodes = parts => parts.flatMap(p => (typeof p === 'string' ? [] : p.list ? katexNodes(p.list) : [p]));
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

test('a formula in a nested list counts once, though the list converts it twice', () => {
  const r = audit([{ list: ['Top ', katex('a+b'), { list: ['Inner ', katex('c_1')] }] }]);
  assert.equal(r.markdown, 'Top $a+b$Inner $c_1$');
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

test('takeFormulaMarks counts the marks and takes them out', () => {
  assert.deepEqual(NLME.takeFormulaMarks('a $x$$y$ b'), { text: 'a $x$$y$ b', formulas: 2 });
  assert.deepEqual(NLME.takeFormulaMarks('US$3.5 billion; US$4.7'), { text: 'US$3.5 billion; US$4.7', formulas: 0 });
  assert.deepEqual(NLME.takeFormulaMarks(undefined), { text: '', formulas: 0 });
});
