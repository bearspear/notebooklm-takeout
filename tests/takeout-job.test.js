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

test('runExportJob keeps ctx.warn objects intact for the error report', async () => {
  const calls = [];
  const warning = { source: 'S1', type: 'missing_summary', message: 'Source guide/summary not found or empty' };
  await NLME.runExportJob({
    kind: 'sources', items: [{ title: 'S1' }],
    extractOne: async (item, ctx) => { ctx.warn(warning); return 'data'; },
    packageBatch: async (results, info) => { calls.push([...info.errors]); },
    isCancelled: () => false
  });
  assert.deepEqual(calls, [[warning]]);
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

test('runExportJob puts seedErrors ahead of item errors', async () => {
  const calls = [];
  await NLME.runExportJob({ kind: 'messages', items: [{ title: 'Q1' }], seedErrors: ['2 messages skipped'],
    extractOne: async () => { throw new Error('x'); }, packageBatch: async (r, info) => calls.push(info.errors), isCancelled: () => false });
  assert.deepEqual(calls[0], ['2 messages skipped', '[Q1] x']);
});

test('runExportJob delivers seedErrors with the last batch when every item succeeds', async () => {
  const calls = [];
  const seedErrors = ['2 messages skipped'];
  const result = await NLME.runExportJob({ kind: 'messages', items: [{ title: 'Q1' }, { title: 'Q2' }], perZip: 1, seedErrors,
    extractOne: async item => item.title,
    packageBatch: async (r, info) => calls.push({ r, errors: info.errors, isLast: info.isLast, errorsOnly: info.errorsOnly }),
    isCancelled: () => false });
  assert.deepEqual(calls, [
    { r: ['Q1'], errors: [], isLast: false, errorsOnly: false },
    { r: ['Q2'], errors: ['2 messages skipped'], isLast: true, errorsOnly: false }
  ]);
  assert.deepEqual(result.errors, ['2 messages skipped']);
  assert.deepEqual(seedErrors, ['2 messages skipped'], 'the caller array is not mutated');
});

test('runExportJob returns the items that threw as failedItems', async () => {
  const items = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  const r = await NLME.runExportJob({
    kind: 'notes', items, isCancelled: () => false, packageBatch: async () => {},
    extractOne: async (item, ctx) => { if (item.title === 'b') throw new Error('x'); if (item.title === 'c') ctx.warn('w'); return item; }
  });
  assert.deepEqual(r.failedItems, [items[1]]);
});

test('runExportJob tells packageBatch how many items were exported and failed so far', async () => {
  const { run, calls } = harness({ items: items(5), perZip: 2, fail: ['N2', 'N5'] });
  await run;
  assert.deepEqual(calls.map(c => [c.exported, c.failed]), [[1, 1], [3, 1], [3, 2]]);
});

test('runExportJob counts on an errors-only package too', async () => {
  const { run, calls } = harness({ items: items(2), fail: ['N1', 'N2'] });
  await run;
  assert.deepEqual(calls.map(c => [c.errorsOnly, c.exported, c.failed]), [[true, 0, 2]]);
});
