const test = require('node:test');
const assert = require('node:assert/strict');
const { refsHtml } = require('../viewer/viewer-app.js');

test('table references render under the table, escaped', () => {
  assert.equal(refsHtml([[1, 'One.md'], [2, 'Two <b>.md']]),
    '<h3>References</h3><p class="tref">[1] One.md</p><p class="tref">[2] Two &lt;b&gt;.md</p>');
});

test('no references, no section', () => {
  assert.equal(refsHtml(undefined), '');
  assert.equal(refsHtml([]), '');
});
