const test = require('node:test');
const assert = require('node:assert/strict');
const NLME = require('../takeout-job.js');

function harness({ items, perZip = Infinity, fail = [], cancelAfter = Infinity, stopAt = -1 }) {
  const calls = []; const after = []; let done = 0;
  const run = NLME.runExportJob({
    kind: 'notes', items, perZip,
    extractOne: async (item, ctx) => {
      done++;
      if (item.title === stopAt) ctx.stop('stopped: page changed');
      if (fail.includes(item.title)) throw new Error('boom');
      return item.title;
    },
    afterEach: async item => { after.push(item.title); if (item.title === 'T') throw new Error('ignored'); },
    packageBatch: async (results, info) => { calls.push({ results, ...info, errors: [...info.errors] }); },
    isCancelled: () => done >= cancelAfter
  });
  return { run, calls, after };
}
const items = n => Array.from({ length: n }, (_, i) => ({ title: `N${i + 1}` }));

test('runExportJob batches by perZip and passes errors only to the last batch', async () => {
  const { run, calls } = harness({ items: items(5), perZip: 2, fail: ['N2'] });
  const r = await run;
  assert.deepEqual(calls.map(c => [c.results, c.batchIndex, c.totalBatches, c.isLast]), [
    [['N1'], 1, 3, false], [['N3', 'N4'], 2, 3, false], [['N5'], 3, 3, true]]);
  assert.deepEqual(calls[0].errors, []);
  assert.deepEqual(calls[2].errors, ['[N2] boom']);
  assert.deepEqual([r.attempted, r.exported, r.failed, r.cancelled], [5, 4, 1, false]);
});

test('runExportJob cancel packages the current batch as partial with one cancellation note', async () => {
  const { run, calls } = harness({ items: items(5), perZip: 2, cancelAfter: 3 });
  const r = await run;
  assert.deepEqual(calls.map(c => [c.results, c.isLast, c.partial]), [[['N1', 'N2'], false, false], [['N3'], true, true]]);
  assert.equal(calls[1].errors.length, 1);
  assert.match(calls[1].errors[0], /Cancelled by user after 3 of 5 notes/);
  assert.deepEqual([r.attempted, r.exported, r.cancelled], [3, 3, true]);
});

test('runExportJob stop ends after the current item without a cancellation note', async () => {
  const { run, calls } = harness({ items: items(4), stopAt: 'N2' });
  const r = await run;
  assert.deepEqual(calls[0].results, ['N1', 'N2']);
  assert.deepEqual(calls[0].errors, ['stopped: page changed']);
  assert.equal(calls[0].partial, true);
  assert.deepEqual([r.stopped, r.cancelled, r.attempted], [true, false, 2]);
});

test('runExportJob writes an errors-only package when nothing in the last batch succeeded', async () => {
  const { run, calls } = harness({ items: items(3), perZip: 2, fail: ['N3'] });
  await run;
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[1].results, calls[1].errorsOnly, calls[1].isLast], [[], true, true]);
  assert.deepEqual(calls[1].errors, ['[N3] boom']);
});

test('runExportJob with every item failing still writes the errors', async () => {
  const { run, calls } = harness({ items: items(2), fail: ['N1', 'N2'] });
  const r = await run;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].errorsOnly, true);
  assert.equal(calls[0].errors.length, 2);
  assert.deepEqual([r.exported, r.failed], [0, 2]);
});

test('runExportJob with no items packages nothing', async () => {
  const { run, calls } = harness({ items: [] });
  const r = await run;
  assert.equal(calls.length, 0);
  assert.deepEqual([r.attempted, r.exported], [0, 0]);
});

test('runExportJob always runs afterEach and ignores its errors', async () => {
  const { run, after } = harness({ items: [{ title: 'T' }, { title: 'U' }], fail: ['T'] });
  const r = await run;
  assert.deepEqual(after, ['T', 'U']);
  assert.equal(r.exported, 1);
});

test('runExportJob keeps an item that called ctx.warn and reports the warning', async () => {
  const calls = [];
  const r = await NLME.runExportJob({
    kind: 'notes', items: [{ title: 'N1' }],
    extractOne: async (item, ctx) => { ctx.warn('[N1] missing summary'); return 'data'; },
    packageBatch: async (results, info) => { calls.push({ results, errors: [...info.errors] }); },
    isCancelled: () => false
  });
  assert.equal(r.exported, 1);
  assert.deepEqual(calls, [{ results: ['data'], errors: ['[N1] missing summary'] }]);
});

test('runExportJob cancel at a batch boundary sends errors in a new batch index', async () => {
  const { run, calls } = harness({ items: items(5), perZip: 2, cancelAfter: 2 });
  await run;
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[0].results, calls[0].batchIndex, calls[0].isLast], [['N1', 'N2'], 1, false]);
  assert.deepEqual(
    [calls[1].results, calls[1].batchIndex, calls[1].totalBatches, calls[1].isLast, calls[1].partial, calls[1].errorsOnly],
    [[], 2, 3, true, true, true]);
  assert.match(calls[1].errors[0], /Cancelled by user after 2 of 5 notes/);
});

test('runExportJob errors-only call after a skipped batch uses the ending batch index', async () => {
  const { run, calls } = harness({ items: items(5), perZip: 2, fail: ['N1', 'N2', 'N5'] });
  await run;
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[0].results, calls[0].batchIndex, calls[0].isLast], [['N3', 'N4'], 2, false]);
  assert.deepEqual(
    [calls[1].results, calls[1].batchIndex, calls[1].totalBatches, calls[1].isLast, calls[1].errorsOnly, calls[1].errors],
    [[], 3, 3, true, true, ['[N1] boom', '[N2] boom', '[N5] boom']]);
});
