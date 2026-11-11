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

// Size-based batching: flush a batch once its accumulated size reaches the cap
function sizeHarness({ sizes, max = 500, fail = [], cancelAfter = Infinity }) {
  const calls = []; let done = 0;
  const its = sizes.map((size, i) => ({ title: String.fromCharCode(97 + i), size }));
  const run = NLME.runExportJob({
    kind: 'artifacts', items: its, perZip: Infinity, maxBatchBytes: max, sizeOf: r => r.size,
    extractOne: async item => { done++; if (fail.includes(item.title)) throw new Error('boom'); return item; },
    packageBatch: async (results, info) => { calls.push({ results: results.map(r => r.title), ...info, errors: [...info.errors] }); },
    isCancelled: () => done >= cancelAfter
  });
  return { run, calls };
}

test('size batching flushes when the batch reaches the cap and numbers the packages', async () => {
  const { run, calls } = sizeHarness({ sizes: [300, 300, 300] });
  await run;
  assert.deepEqual(calls.map(c => [c.results, c.batchIndex, c.isLast, c.multi, c.totalBatches]), [
    [['a', 'b'], 1, false, true, null], [['c'], 2, true, true, null]]);
});

test('size batching under the cap is one single, non-multi package', async () => {
  const { run, calls } = sizeHarness({ sizes: [100, 100] });
  await run;
  assert.deepEqual(calls.map(c => [c.results, c.batchIndex, c.isLast, c.multi, c.totalBatches]), [
    [['a', 'b'], 1, true, false, null]]);
});

test('size batching gives an item bigger than the cap a package of its own', async () => {
  const { run, calls } = sizeHarness({ sizes: [900, 10] });
  await run;
  assert.deepEqual(calls.map(c => [c.results, c.isLast, c.multi]), [[['a'], false, true], [['b'], true, true]]);
});

test('size batching flushes after the very last item as the last package', async () => {
  const { run, calls } = sizeHarness({ sizes: [10, 600] });
  await run;
  assert.deepEqual(calls.map(c => [c.results, c.isLast, c.multi]), [[['a', 'b'], true, false]]);
});

test('size batching delivers errors only in the last package', async () => {
  const { run, calls } = sizeHarness({ sizes: [300, 300, 300, 300], fail: ['a'] });
  const r = await run;
  assert.deepEqual(calls.map(c => [c.results, c.errors, c.exported, c.failed]), [
    [['b', 'c'], [], 2, 1], [['d'], ['[a] boom'], 3, 1]]);
  assert.deepEqual(r.errors, ['[a] boom']);
});

test('size batching writes an errors-only last package when the rest all failed', async () => {
  const { run, calls } = sizeHarness({ sizes: [600, 10], fail: ['b'] });
  await run;
  assert.deepEqual(calls.map(c => [c.results, c.batchIndex, c.isLast, c.errorsOnly, c.multi, c.errors]), [
    [['a'], 1, false, false, true, []], [[], 2, true, true, true, ['[b] boom']]]);
});

test('size batching cancel during the second batch delivers it as partial with the note', async () => {
  const { run, calls } = sizeHarness({ sizes: [300, 300, 300, 300, 300], cancelAfter: 3 });
  const r = await run;
  assert.deepEqual(calls.map(c => [c.results, c.batchIndex, c.isLast, c.partial]), [
    [['a', 'b'], 1, false, false], [['c'], 2, true, true]]);
  assert.equal(calls[1].errors.length, 1);
  assert.match(calls[1].errors[0], /Cancelled by user after 3 of 5/);
  assert.equal(r.cancelled, true);
});

test('size batching without sizeOf keeps count-based batching and totalBatches', async () => {
  const calls = [];
  await NLME.runExportJob({
    kind: 'notes', items: items(3), perZip: 2, maxBatchBytes: 10,
    extractOne: async i => i, isCancelled: () => false,
    packageBatch: async (r, info) => calls.push([r.length, info.totalBatches, info.multi])
  });
  assert.deepEqual(calls, [[2, 2, true], [1, 2, true]]);
});

test('count-based batching reports multi from totalBatches', async () => {
  const { run, calls } = harness({ items: items(3), perZip: 2 });
  await run;
  assert.deepEqual(calls.map(c => c.multi), [true, true]);
  const one = harness({ items: items(3) });
  await one.run;
  assert.deepEqual(one.calls.map(c => c.multi), [false]);
});

test('size batching drops delivered results so memory can be freed', async () => {
  const seen = [];
  await NLME.runExportJob({
    kind: 'artifacts', items: [{ n: 1 }, { n: 2 }, { n: 3 }], maxBatchBytes: 5, sizeOf: () => 5,
    extractOne: async i => ({ ...i }), isCancelled: () => false,
    packageBatch: async results => { seen.push(results); }
  });
  assert.equal(seen.length, 3);
  assert.equal(seen[0].length, 1);
  assert.notEqual(seen[0], seen[1]);
});

test('afterEach learns whether the item failed', async () => {
  const seen = [];
  await NLME.runExportJob({
    kind: 'notes', items: [{ title: 'ok' }, { title: 'bad' }, { title: 'ok2' }],
    extractOne: async item => { if (item.title === 'bad') throw new Error('boom'); return item.title; },
    afterEach: async (item, outcome) => { seen.push([item.title, outcome.failed]); },
    packageBatch: async () => {},
    isCancelled: () => false
  });
  assert.deepEqual(seen, [['ok', false], ['bad', true], ['ok2', false]]);
});

// ---- createJobRecorder ----

function fakeStorage({ failOn = [] } = {}) {
  const data = {}; const log = [];
  const guard = op => { if (failOn.includes(op)) throw new Error(`${op} failed`); };
  return {
    data, log,
    async get(key) { guard('get'); return key in data ? { [key]: data[key] } : {}; },
    async set(obj) { guard('set'); log.push('set'); Object.assign(data, JSON.parse(JSON.stringify(obj))); },
    async remove(key) { guard('remove'); log.push('remove'); delete data[key]; }
  };
}

function recorderFor(storage, clock, keys = { notes: ['a', 'b', 'c'] }, id = 'notes-1') {
  const record = NLME.newJobRecord({ id, kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: keys, now: clock.t });
  return NLME.createJobRecorder({ storage, record, now: () => clock.t, log: () => {} });
}

test('recorder writes the record at start and holds back writes inside a second', async () => {
  const storage = fakeStorage(); const clock = { t: 1000 };
  const rec = recorderFor(storage, clock);
  await rec.start();
  assert.equal(storage.log.length, 1);
  rec.done('notes', 'a'); rec.commit();
  clock.t += 200;
  rec.fail('notes', 'b');
  await rec.idle();
  assert.equal(storage.log.length, 1); // throttled
  clock.t += 900;
  rec.done('notes', 'c'); rec.commit();
  await rec.idle();
  assert.equal(storage.log.length, 2);
  assert.deepEqual(storage.data['nlme.job.nb'].remaining.notes, []);
  assert.deepEqual(storage.data['nlme.job.nb'].failed.notes, ['b']);
});

// A fake timer pair: fire() runs the pending callbacks the way the clock would.
function fakeTimers() {
  const pending = new Map(); let next = 1;
  return {
    pending,
    setTimer: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimer: id => { pending.delete(id); },
    fire() { for (const [id, t] of [...pending]) { pending.delete(id); t.fn(); } }
  };
}

test('recorder writes a held-back change on a trailing timer for the rest of the interval', async () => {
  const storage = fakeStorage(); const clock = { t: 1000 }; const timers = fakeTimers();
  const record = NLME.newJobRecord({ id: 'notes-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a', 'b'] }, now: 1000 });
  const rec = NLME.createJobRecorder({ storage, record, now: () => clock.t, log: () => {}, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await rec.start();
  clock.t += 300;
  rec.done('notes', 'a'); rec.commit(); // inside the window: held back
  assert.equal(storage.log.length, 1);
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0].ms, 700);
  rec.fail('notes', 'b'); // a second change does not add a second timer
  assert.equal(timers.pending.size, 1);
  timers.fire();
  await rec.idle();
  assert.equal(storage.log.length, 2);
  assert.deepEqual(storage.data['nlme.job.nb'].remaining.notes, []);
  assert.deepEqual(storage.data['nlme.job.nb'].failed.notes, ['b']);
  assert.equal(timers.pending.size, 0);
});

test('recorder finish clears the trailing timer so a removed record never comes back', async () => {
  const storage = fakeStorage(); const clock = { t: 1000 }; const timers = fakeTimers();
  const record = NLME.newJobRecord({ id: 'notes-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1000 });
  const rec = NLME.createJobRecorder({ storage, record, now: () => clock.t, log: () => {}, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await rec.start();
  clock.t += 100;
  rec.done('notes', 'a'); rec.commit();
  assert.equal(timers.pending.size, 1);
  await rec.finish({ clean: true });
  assert.equal('nlme.job.nb' in storage.data, false);
  assert.equal(timers.pending.size, 0);
  timers.fire();
  await rec.idle();
  assert.equal('nlme.job.nb' in storage.data, false);
  assert.equal(storage.log.filter(x => x === 'set').length, 1);
});

test('recorder only counts staged successes once commit is called', async () => {
  const storage = fakeStorage(); const clock = { t: 0 };
  const rec = recorderFor(storage, clock);
  await rec.start();
  rec.done('notes', 'a');
  clock.t += 5000;
  rec.fail('notes', 'b'); // writes now; 'a' is staged but not saved to disk yet
  await rec.idle();
  assert.deepEqual(storage.data['nlme.job.nb'].remaining.notes, ['a', 'c']);
  await rec.finish({ clean: false }); // an unclean end never commits staged items
  assert.deepEqual(storage.data['nlme.job.nb'].remaining.notes, ['a', 'c']);
});

test('recorder final flush writes the held-back state when the job does not finish cleanly', async () => {
  const storage = fakeStorage(); const clock = { t: 0 };
  const rec = recorderFor(storage, clock);
  await rec.start();
  rec.done('notes', 'a'); rec.commit();
  await rec.finish({ clean: false });
  assert.deepEqual(storage.data['nlme.job.nb'].remaining.notes, ['b', 'c']);
  assert.equal(storage.log.at(-1), 'set');
});

test('recorder removes a finished record only when the stored id is still its own', async () => {
  const clock = { t: 0 };
  const own = fakeStorage();
  const rec = recorderFor(own, clock, { notes: ['a'] });
  await rec.start();
  rec.done('notes', 'a'); rec.commit();
  await rec.finish({ clean: true });
  assert.equal('nlme.job.nb' in own.data, false);

  const other = fakeStorage();
  const rec2 = recorderFor(other, clock, { notes: ['a'] });
  await rec2.start();
  other.data['nlme.job.nb'] = { id: 'sources-2' }; // another export replaced it
  rec2.done('notes', 'a'); rec2.commit();
  await rec2.finish({ clean: true });
  assert.equal(other.data['nlme.job.nb'].id, 'sources-2');
  assert.equal(other.log.includes('remove'), false);
});

test('recorder keeps the record on a clean end that still has remaining or failed keys', async () => {
  const storage = fakeStorage(); const clock = { t: 0 };
  const rec = recorderFor(storage, clock, { notes: ['a', 'b'] });
  await rec.start();
  rec.done('notes', 'a'); rec.commit();
  rec.fail('notes', 'b');
  await rec.finish({ clean: true });
  assert.deepEqual(storage.data['nlme.job.nb'].failed.notes, ['b']);
});

test('recorder never throws when storage fails', async () => {
  const storage = fakeStorage({ failOn: ['get', 'set', 'remove'] }); const clock = { t: 0 };
  const rec = recorderFor(storage, clock, { notes: ['a'] });
  await rec.start();
  rec.done('notes', 'a'); rec.commit();
  rec.fail('notes', 'z');
  await rec.finish({ clean: true });
  await rec.finish({ clean: false });
});

test('recorder on an existing record marks known keys only and writes nothing for unknown ones', async () => {
  const storage = fakeStorage(); const clock = { t: 0 };
  const stored = NLME.newJobRecord({ id: 'takeout-1', kind: 'takeout', label: 'Full Takeout', notebookId: 'nb', keysByCategory: { sources: ['s1'], notes: ['n1'] }, now: 0 });
  storage.data['nlme.job.nb'] = stored;
  const rec = NLME.createJobRecorder({ storage, record: stored, now: () => clock.t, log: () => {} });
  rec.fail('sources', 'other'); // not in the record
  rec.done('notes', 'other'); rec.commit();
  await rec.finish({ clean: true });
  assert.equal(storage.log.length, 0);
  rec.done('sources', 's1'); rec.commit();
  await rec.finish({ clean: true });
  assert.deepEqual(storage.data['nlme.job.nb'].remaining, { sources: [], notes: ['n1'] }); // not finished: kept
  rec.done('notes', 'n1'); rec.commit();
  await rec.finish({ clean: true });
  assert.equal('nlme.job.nb' in storage.data, false);
});

test('staged items are not committed by a later commit after discard', async () => {
  const storage = fakeStorage(); const clock = { t: 0 };
  const rec = recorderFor(storage, clock, { sources: ['s1', 's2'], notes: ['n1'] });
  await rec.start();
  rec.done('sources', 's1'); rec.commit();
  rec.done('sources', 's2'); // its package fails to save
  rec.discard();
  rec.done('notes', 'n1'); clock.t += 5000; rec.commit();
  await rec.finish({ clean: true });
  assert.deepEqual(storage.data['nlme.job.nb'].remaining, { sources: ['s2'], notes: [] });
});

test('a failure with a detail keeps it as the second line of errors.md', async () => {
  const NLME = require('../takeout-shared.js');
  require('../takeout-job.js');
  const failure = new Error('Still being generated. Try again when it is ready (Resume will retry it).');
  failure.detail = 'Item changed: expected "Fresh"';
  const result = await NLME.runExportJob({
    kind: 'artifacts', items: [{ label: 'Fresh' }, { label: 'Plain' }], titleOf: i => i.label,
    extractOne: async item => { throw item.label === 'Fresh' ? failure : new Error('broke'); },
    packageBatch: async () => {}, isCancelled: () => false
  });
  assert.deepEqual(result.errors, [
    { type: 'error', title: 'Fresh', message: failure.message, stack: 'Item changed: expected "Fresh"' },
    '[Plain] broke'
  ]);
  assert.match(NLME.buildErrorReport({ errors: result.errors }), /^- Fresh: Still being generated\. Try again when it is ready \(Resume will retry it\)\.\n  Item changed: expected "Fresh"$/m);
});

// ---- 1.9.15: beforePackage, the last try at missing images ----

function hookHarness({ items: list, perZip = Infinity, fail = [], hook, maxBatchBytes = 0 }) {
  const log = [];
  const run = NLME.runExportJob({
    kind: 'sources', items: list, perZip,
    maxBatchBytes, sizeOf: maxBatchBytes ? () => 1 : null,
    extractOne: async item => {
      if (fail.includes(item.title)) throw new Error('boom');
      return item.title;
    },
    beforePackage: async (results, ctx) => { log.push(['before', [...results], ctx.isLast]); if (hook) await hook(results, ctx); },
    packageBatch: async (results, info) => { log.push(['package', [...results], info.isLast, [...info.errors], info.errorsOnly]); },
    isCancelled: () => false
  });
  return { run, log };
}

test('beforePackage runs before each packageBatch with that batch\'s results, in order', async () => {
  const { run, log } = hookHarness({ items: items(3), perZip: 2 });
  await run;
  assert.deepEqual(log.map(l => l.slice(0, 3)), [
    ['before', ['N1', 'N2'], false], ['package', ['N1', 'N2'], false],
    ['before', ['N3'], true], ['package', ['N3'], true]
  ]);
});

test('a beforePackage warning lands in the errors of the last delivery', async () => {
  const { run, log } = hookHarness({
    items: items(3), perZip: 2,
    hook: (results, { warn }) => warn(`missing in ${results[0]}`)
  });
  const r = await run;
  const packages = log.filter(l => l[0] === 'package');
  assert.deepEqual(packages[0][3], []);
  assert.deepEqual(packages[1][3], ['missing in N1', 'missing in N3']);
  assert.deepEqual(r.errors, ['missing in N1', 'missing in N3']);
});

test('a warning from the hook of a non-last batch reaches a later errors-only delivery', async () => {
  const { run, log } = hookHarness({
    items: items(3), perZip: 2, fail: ['N3'],
    hook: (results, { warn }) => warn({ source: results[0], type: 'image_download_failed', message: 'x' })
  });
  await run;
  const last = log[log.length - 1];
  assert.equal(last[0], 'package');
  assert.equal(last[4], true); // errorsOnly
  assert.equal(last[3].length, 2);
  assert.deepEqual(last[3][0], { source: 'N1', type: 'image_download_failed', message: 'x' });
});

test('beforePackage is not called for an errors-only delivery', async () => {
  const { run, log } = hookHarness({ items: items(2), fail: ['N1', 'N2'] });
  await run;
  assert.deepEqual(log.map(l => l[0]), ['package']);
  assert.equal(log[0][4], true);
});

test('a throwing beforePackage still delivers the package, and its error is kept', async () => {
  const originalWarn = console.warn;
  const logged = [];
  console.warn = (...args) => logged.push(args);
  try {
    const { run, log } = hookHarness({ items: items(1), hook: async () => { throw new Error('final try broke'); } });
    const r = await run;
    assert.deepEqual(log.map(l => l[0]), ['before', 'package']);
    assert.equal(log[1][3].length, 1);
    assert.match(String(log[1][3][0]), /final try broke/);
    assert.equal(r.exported, 1);
    assert.ok(logged.length >= 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('size batching: split jobs call beforePackage once per package, in order', async () => {
  const { run, log } = hookHarness({ items: items(4), maxBatchBytes: 2 });
  await run;
  assert.deepEqual(log.map(l => l.slice(0, 3)), [
    ['before', ['N1', 'N2'], false], ['package', ['N1', 'N2'], false],
    ['before', ['N3', 'N4'], true], ['package', ['N3', 'N4'], true]
  ]);
});
