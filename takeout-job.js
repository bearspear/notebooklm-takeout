// One DOM-free runner behind every export (notes, sources, chat, Studio
// artifacts): batching, cancel/stop, error collection, and the guarantee that
// the errors reach exactly one package. failedItems: the items whose
// extractOne threw, in order (warnings do not count); the Retry button re-runs them.
(function (root) {
  const NLME = root.NLME || require('./takeout-shared.js');

  async function runExportJob(opts) {
    const {
      kind, items, extractOne, afterEach, packageBatch, isCancelled, onProgress,
      perZip = Infinity,
      // Errors known before the first item (e.g. chat messages that could
      // not be read); they lead the error list
      seedErrors = [],
      titleOf = item => item.title ?? item.label ?? ''
    } = opts;

    const size = Math.min(perZip, items.length) || 1;
    const totalBatches = Math.ceil(items.length / size);
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
        partial: cancelled || stopped,
        errors: isLast ? [...errors] : [],
        errorsOnly: false,
        ...extra
      });
    };

    for (let b = 0; b < totalBatches && !cancelled && !stopped; b++) {
      endingBatch = b + 1;
      const results = [];
      const batchItems = items.slice(b * size, (b + 1) * size);

      for (const item of batchItems) {
        if (isCancelled()) {
          cancelled = true;
          errors.push(NLME.cancellationNote({ kind, done: attempted, total: items.length }));
          break;
        }
        if (onProgress) onProgress({ done: attempted, total: items.length, batchIndex: b + 1, totalBatches, item });

        const ctx = {
          index: attempted,
          // Strings and { source, type, message } objects stay as they are
          // (buildErrorReport groups objects by type); anything else becomes text
          warn: error => { errors.push(typeof error === 'string' || (error && typeof error === 'object') ? error : String(error)); },
          stop: reason => { stopped = true; errors.push(reason); }
        };
        attempted++;
        try {
          results.push(await extractOne(item, ctx));
          exported++;
        } catch (err) {
          failedItems.push(item);
          errors.push(`[${titleOf(item)}] ${(err && err.message) || err}`);
        }
        if (afterEach) {
          try { await afterEach(item); } catch (_) { /* cleanup must never fail the item */ }
        }
        if (stopped) break;
      }

      const isLast = b === totalBatches - 1 || cancelled || stopped;
      if (results.length) await deliver(results, b + 1, isLast);
    }

    // Errors exist but the last batch had no successes to carry them; use the
    // batch the job ended in; it never delivered, so its index is unused
    if (errors.length && !errorsDelivered) {
      await deliver([], endingBatch, true, { errorsOnly: true });
    }

    return { attempted, exported, failed: attempted - exported, cancelled, stopped, errors, failedItems };
  }

  NLME.runExportJob = runExportJob;
  root.NLME = NLME;
  if (typeof module === 'object' && module.exports) module.exports = NLME;
})(globalThis);
