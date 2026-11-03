// One DOM-free runner behind every export (notes, sources, chat, Studio
// artifacts): batching, cancel/stop, error collection, and the guarantee that
// the errors reach exactly one package. afterEach(item, { failed }) runs after every
// item that ran, failed says whether extractOne threw. failedItems: the items whose
// extractOne threw, in order (warnings do not count); the Retry button re-runs them.
// packageBatch's info: batchIndex, totalBatches, isLast, partial, errors (the last
// package only), errorsOnly, exported and failed (items so far), and multi (this
// job has or will have more than one package).
// Size-based batching: with maxBatchBytes and sizeOf(result) a batch is packaged as
// soon as its accumulated size reaches the cap (a package may pass it by one item;
// one item over the cap gets its own). totalBatches is then null (unknown).
(function (root) {
  const NLME = root.NLME || require('./takeout-shared.js');

  async function runExportJob(opts) {
    const {
      kind, items, extractOne, afterEach, packageBatch, isCancelled, onProgress,
      perZip = Infinity,
      maxBatchBytes = 0, sizeOf = null,
      // Errors known before the first item (e.g. chat messages that could
      // not be read); they lead the error list
      seedErrors = [],
      titleOf = item => item.title ?? item.label ?? ''
    } = opts;

    const bySize = maxBatchBytes > 0 && typeof sizeOf === 'function';
    const size = Math.min(perZip, items.length) || 1;
    const totalBatches = bySize ? null : Math.ceil(items.length / size);
    const errors = [...seedErrors];
    const failedItems = [];
    let attempted = 0, exported = 0;
    let cancelled = false, stopped = false;
    let errorsDelivered = false;
    let endingBatch = 1;

    const deliver = async (results, batchIndex, isLast, extra = {}) => {
      if (isLast) errorsDelivered = true;
      await packageBatch(results, {
        batchIndex, totalBatches, isLast,
        multi: bySize ? (batchIndex > 1 || !isLast) : totalBatches > 1,
        partial: cancelled || stopped,
        errors: isLast ? [...errors] : [],
        errorsOnly: false,
        // Items exported / failed so far; final on the last package
        exported, failed: attempted - exported,
        ...extra
      });
    };

    // Runs one item; returns { result } on success, {} on failure. Sets
    // cancelled/stopped; returns null when cancelled before the item ran.
    const runItem = async (item, batchIndex) => {
      if (isCancelled()) {
        cancelled = true;
        errors.push(NLME.cancellationNote({ kind, done: attempted, total: items.length }));
        return null;
      }
      if (onProgress) onProgress({ done: attempted, total: items.length, batchIndex, totalBatches, item });

      const ctx = {
        index: attempted,
        // Strings and { source, type, message } objects stay as they are
        // (buildErrorReport groups objects by type); anything else becomes text
        warn: error => { errors.push(typeof error === 'string' || (error && typeof error === 'object') ? error : String(error)); },
        stop: reason => { stopped = true; errors.push(reason); }
      };
      attempted++;
      let out = {};
      let failed = false;
      try {
        out = { result: await extractOne(item, ctx) };
        exported++;
      } catch (err) {
        failed = true;
        failedItems.push(item);
        errors.push(`[${titleOf(item)}] ${(err && err.message) || err}`);
      }
      if (afterEach) {
        try { await afterEach(item, { failed }); } catch (_) { /* cleanup must never fail the item */ }
      }
      return out;
    };

    if (bySize) {
      let results = [], bytes = 0, nextIndex = 1;
      for (let i = 0; i < items.length && !cancelled && !stopped; i++) {
        const out = await runItem(items[i], nextIndex);
        if (!out) break;
        if ('result' in out) {
          results.push(out.result);
          bytes += Number(sizeOf(out.result)) || 0;
        }
        const isLast = i === items.length - 1 || cancelled || stopped;
        if (results.length && (isLast || bytes >= maxBatchBytes)) {
          await deliver(results, nextIndex++, isLast);
          // Drop the delivered results so their data can be freed
          results = [];
          bytes = 0;
        }
      }
      // Cancelled before the first item of a batch, or a tail that only
      // failed: the pending results (if any) go out as the last package
      if (results.length) {
        await deliver(results, nextIndex++, true);
        results = [];
      }
      endingBatch = nextIndex;
    } else {
      for (let b = 0; b < totalBatches && !cancelled && !stopped; b++) {
        endingBatch = b + 1;
        const results = [];
        const batchItems = items.slice(b * size, (b + 1) * size);

        for (const item of batchItems) {
          const out = await runItem(item, b + 1);
          if (!out) break;
          if ('result' in out) results.push(out.result);
          if (stopped) break;
        }

        const isLast = b === totalBatches - 1 || cancelled || stopped;
        if (results.length) await deliver(results, b + 1, isLast);
      }
    }

    // Errors exist but the last batch had no successes to carry them; use the
    // batch the job ended in; it never delivered, so its index is unused
    if (errors.length && !errorsDelivered) {
      await deliver([], endingBatch, true, { errorsOnly: true });
    }

    return { attempted, exported, failed: attempted - exported, cancelled, stopped, errors, failedItems };
  }

  /**
   * The per-notebook job record writer (Milestone 3c). DOM-free; `storage` has
   * get / set / remove returning promises (chrome.storage.local). Every storage
   * call is caught and logged: recording never affects the export.
   *
   * - start(): writes the record. fail(category, key): marks a failed item.
   * - done(category, key) stages a success, commit() applies the staged ones. Call
   *   commit() once the package holding those items is saved, so a record never
   *   claims an item that is not on disk yet.
   * - Writes are throttled to one per intervalMs; the rest wait for the next
   *   change or finish().
   * - finish({ clean }): clean and finished removes the record, but only when the
   *   stored id is still this job's; otherwise a final write of the held-back state.
   */
  function createJobRecorder({ storage, record, now = Date.now, intervalMs = 1000, log = console.warn }) {
    const key = NLME.jobRecordKey(record.notebookId);
    let current = record;
    let staged = [];
    let dirty = false;
    let lastWrite = -Infinity;
    let queue = Promise.resolve();

    const enqueue = op => {
      queue = queue.then(async () => {
        try { await op(); } catch (error) { log('[NotebookLM Takeout] Job record storage failed:', error); }
      });
      return queue;
    };
    const write = () => {
      dirty = false;
      lastWrite = now();
      const snapshot = current;
      return enqueue(() => storage.set({ [key]: snapshot }));
    };
    const changed = () => {
      dirty = true;
      if (now() - lastWrite >= intervalMs) write();
    };

    return {
      start() { return write(); },
      idle() { return queue; },
      done(category, itemKey) { staged.push([category, itemKey]); },
      commit() {
        if (!staged.length) return;
        const t = now();
        for (const [category, itemKey] of staged) current = NLME.markJobItem(current, category, itemKey, { now: t });
        staged = [];
        changed();
      },
      fail(category, itemKey) {
        current = NLME.markJobItem(current, category, itemKey, { failed: true, now: now() });
        changed();
      },
      async finish({ clean = false } = {}) {
        if (clean && NLME.jobRecordFinished(current)) {
          dirty = false;
          await enqueue(async () => {
            const stored = (await storage.get(key))[key];
            if (stored && stored.id === current.id) await storage.remove(key);
          });
        } else if (dirty) {
          await write();
        }
        await queue;
      }
    };
  }

  NLME.runExportJob = runExportJob;
  NLME.createJobRecorder = createJobRecorder;
  root.NLME = NLME;
  if (typeof module === 'object' && module.exports) module.exports = NLME;
})(globalThis);
