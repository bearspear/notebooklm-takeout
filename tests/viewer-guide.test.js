const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../viewer/viewer-app.js');

const HENKIN = '**Web PDF:** <https://x.example/c.pdf>\n\n## Summary\n\nThe text explores **Henkin’s method** and more.\n\n## Key Topics\n\n- Henkin’s method\n- Completeness theorem\n- First-order logic\n- Syntax and semantics\n- Gödel\n\n## Content\n\nBody text.\n\n## Summary\n\nA heading inside the content.\n';

test('splitSourceGuide takes the summary and topics before the content', () => {
  const g = app.splitSourceGuide(HENKIN);
  assert.equal(g.summary, 'The text explores **Henkin’s method** and more.');
  assert.deepEqual(g.topics, ['Henkin’s method', 'Completeness theorem', 'First-order logic', 'Syntax and semantics', 'Gödel']);
  assert.equal(g.rest, '**Web PDF:** <https://x.example/c.pdf>\n\n## Content\n\nBody text.\n\n## Summary\n\nA heading inside the content.\n');
});

test('splitSourceGuide copes with a missing summary or missing topics', () => {
  const noSummary = app.splitSourceGuide('## Key Topics\n\n- A\n- B\n\n## Content\n\nText\n');
  assert.equal(noSummary.summary, null);
  assert.deepEqual(noSummary.topics, ['A', 'B']);
  assert.equal(noSummary.rest, '## Content\n\nText\n');
  const noTopics = app.splitSourceGuide('## Summary\n\nOnly this.\n\n## Content\n\nText\n');
  assert.equal(noTopics.summary, 'Only this.');
  assert.deepEqual(noTopics.topics, []);
  assert.equal(noTopics.rest, '## Content\n\nText\n');
});

test('splitSourceGuide leaves a source without a guide untouched', () => {
  for (const md of ['Just text.\n', '## Content\n\n## Summary\n\nInside the content.\n', '', '## Summary\n\n## Key Topics\n\n']) {
    const g = app.splitSourceGuide(md);
    assert.deepEqual([g.summary, g.topics, g.rest], [null, [], md]);
  }
});

test('guideHtml builds (summary is already-sanitized HTML) an accessible card from escaped parts', () => {
  const html = app.guideHtml('<p>Short <strong>summary</strong></p>', ['Alpha <b>', 'say "hi"']);
  assert.match(html, /class="guide"/);
  assert.match(html, /<button[^>]*aria-expanded="true"/);
  assert.match(html, /Source guide/);
  assert.match(html, /<svg/);
  assert.equal((html.match(/<button class="topic"/g) || []).length, 2);
  assert.match(html, /Alpha &lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.equal(app.guideHtml(null, []), '');
});

test('splitSourceGuide without a Content heading only takes a guide at the very start', () => {
  const lead = '**Web Page:** <https://x.example/>\n\n## Summary\n\nS.\n\n## Key Topics\n\n- A\n\nBody after.\n';
  const g = app.splitSourceGuide(lead);
  assert.equal(g.summary, 'S.');
  assert.deepEqual(g.topics, ['A']);
  for (const md of ['Intro paragraph.\n\n## Summary\n\nNot a guide.\n', '# Notes\n\n## Intro\n\ntext\n\n## Summary\n\nLater.\n\n## Key Topics\n\n- A\n']) {
    const r = app.splitSourceGuide(md);
    assert.deepEqual([r.summary, r.topics, r.rest], [null, [], md]);
  }
});

test('the guide icon is a neutral cluster of straight-edged sparkles', () => {
  const html = app.guideHtml('<p>x</p>', []);
  assert.doesNotMatch(html, /var\(--accent\)/);
  assert.doesNotMatch(html.split('chev')[0], / c[-.\d]/);
  assert.match(html, /class="spark"/);
});

test('splitSourceGuide keeps prose that follows the topics list', () => {
  const g = app.splitSourceGuide('## Key Topics\n\n- A\n\nBody after.\n');
  assert.deepEqual(g.topics, ['A']);
  assert.match(g.rest, /Body after\./);
});
