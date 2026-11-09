// 1.9.9: text that Turndown escapes into something it never was: a year line
// ("1790) to ..."), a divider paragraph (dashes), a bracketed name before a colon.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NLME = require('../takeout-shared.js');

const turndownSrc = fs.readFileSync(path.join(__dirname, '..', 'turndown.min.js'), 'utf8');
function load(Service) {
  const sandbox = { NLME, window: { DOMParser: class {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(turndownSrc, sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'takeout-markdown.js'), 'utf8'), sandbox);
  return sandbox;
}
const sb = load();
const service = () => sb.NLMEMarkdown.createTurndownService();

test('a line starting "1790)" is escaped like "1790."', () => {
  const s = service();
  assert.equal(s.escape('1790) to Baudouin dating from 1783–85'), '1790\\) to Baudouin dating from 1783–85');
  assert.equal(s.escape('1790. to Baudouin'), '1790\\. to Baudouin');
  assert.equal(s.escape('in 1790) to'), 'in 1790) to');
});

test('brackets before a colon are plain text unless at a line start', () => {
  const relax = NLME.relaxBracketEscapes;
  assert.equal(relax('Dr. W. L. \\[Walter Lutz\\]: Sterne'), 'Dr. W. L. [Walter Lutz]: Sterne');
  assert.equal(relax('\\[x\\]: y'), '\\[x\\]: y');
  assert.equal(relax('\\[Walter Lutz\\]: y'), '\\[Walter Lutz\\]: y');
  assert.equal(relax('a\n\\[x\\]: y'), 'a\n\\[x\\]: y');
  assert.equal(relax('a \\[b\\]: c and \\[d\\] e'), 'a [b]: c and [d] e');
  assert.equal(relax('* \\[ \\] task'), '* \\[ \\] task');
});

test('the service escape frees the bracketed name', () => {
  assert.equal(service().escape('Dr. W. L. [Walter Lutz]: Sterne'), 'Dr. W. L. [Walter Lutz]: Sterne');
  assert.equal(service().escape('[x]: y'), '\\[x\\]: y');
});

class FakeTurndown {
  constructor(options) { this.options = options; this.rules = {}; }
  escape(text) { return text; }
  addRule(name, rule) { this.rules[name] = rule; }
}
function rules() {
  const sandbox = { TurndownService: FakeTurndown, NLME };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'takeout-markdown.js'), 'utf8'), sandbox);
  return sandbox.NLMEMarkdown.createConverter({ variant: 'note' }).turndownService.rules;
}
const D = '-'.repeat(80);
const rule = () => sb.NLMEMarkdown.dividerLines;

test('a line of only a dash, em dash, underscore or equals run is a rule', () => {
  const f = rule();
  for (const t of [D, '\\' + D.slice(1), '\\-\\-\\-', '—'.repeat(40), '\\_\\_\\_', '___', '\\===', '='.repeat(50), '\\=\\=\\=']) {
    assert.equal(f('a\n\n' + t + '\n\nb'), 'a\n\n---\n\nb', t);
  }
  assert.equal(f(D), '---');
  assert.equal(f(D + '\n\nb'), '---\n\nb');
  assert.equal(f('a\n\n' + D), 'a\n\n---');
});

test('runs that touch text, fences, tables or are too short stay as they are', () => {
  const f = rule();
  for (const t of [
    'a\n' + D + '\n\nb', 'a\n\n' + D + '\nb', '--', '\\--', 'a\n\n- - -\n\nb', 'a\n\n--- x\n\nb',
    '```\n\n' + D + '\n\n```', '~~~\n\n\\---\n\n~~~', '| a |\n| --- |', '* ' + D, 'a\n\n' + D + 'x\n\nb'
  ]) assert.equal(f(t), t, t);
  assert.equal(f('```\n\n---\n\n```\n\n' + D + '\n\nz'), '```\n\n---\n\n```\n\n---\n\nz');
});

test('convert applies it whatever element held the run', () => {
  const conv = sb.NLMEMarkdown.createConverter({ variant: 'note' });
  conv.turndownService.turndown = h => h.replace(/<[^>]+>/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim().replace(/^-/, '\\-');
  assert.equal(conv.convert('<div>a</div><div>' + D + '</div><div>b</div>'), 'a\n\n---\n\nb');
});
