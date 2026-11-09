const test = require('node:test');
const assert = require('node:assert/strict');
const { findMath } = require('../viewer/viewer-app.js');
const cases = require('./fixtures/math-spans.json');

for (const c of cases) {
  test('findMath: ' + JSON.stringify(c.text), () => {
    const got = findMath(c.text);
    assert.deepEqual(got.map((m) => m.src), c.formulas);
    got.forEach((m) => assert.equal(c.text.slice(m.start, m.end), m.src));
  });
}

test('findMath marks $$…$$ as block and $…$ as inline', () => {
  assert.equal(findMath('$$a$$')[0].block, true);
  assert.equal(findMath('$a$')[0].block, false);
});
