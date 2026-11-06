// Where an export shows: while it runs, the progress view (#download-progress), then its
// outcome (#results-panel), which stays until Done or the next export. Both take the
// place of the open view (setDock). Classic script, DOM only; the pure parts are in
// takeout-shared.js (NLME.progressFigures, NLME.composeOutcome, NLME.groupErrorsForPanel).
// See AGENT.md "Progress and results".

// 'progress', 'results' or null. Both hide the view with body.docked: the list stays in
// the page, so its selection and filter are there afterwards.
let dockMode = null;
// The view Done returns to, and where the page was scrolled: hiding a list shortens
// the page, which resets the scroll. Both stay through a Retry.
let dockOrigin = null;
let dockScroll = 0;
// The notebook of the export being shown: { id, tabId, name }
let dockRun = null;

// A chain (runChain) keeps the progress view up between its exports. chainProgress:
// where the running chain has got to, { base, total }, so "N of M" counts over all of
// it. While its steps run, each one's outcome waits in heldStepResults instead of
// showing: the chain ends in one panel, or in the one step's own.
let chainHolds = 0;
let chainProgress = null;
let holdStepResults = false;
let heldStepResults = null;

function setDock(mode) {
  if (mode && !dockMode && dockOrigin === null) {
    dockOrigin = panelView;
    dockScroll = window.scrollY;
  }
  const leaving = !mode && dockOrigin !== null ? dockScroll : null;
  dockMode = mode;
  document.body.classList.toggle('docked', !!mode);
  document.getElementById('download-progress').style.display = mode === 'progress' ? 'block' : 'none';
  document.getElementById('results-panel').style.display = mode === 'results' ? 'block' : 'none';
  if (!mode) dockOrigin = null;
  if (leaving !== null) window.scrollTo(0, leaving);
}

// What the keyboard lands on while the view is docked: Cancel is gone in the final save
function dockFocusTarget() {
  return dockMode === 'results'
    ? document.querySelector('#results-panel .results-done')
    : document.getElementById('cancel-download-btn');
}

// The element holding the focus has just been hidden: give it to the view that took over
function keepDockFocus() {
  const held = document.activeElement;
  if (!held || held === document.body || held.getClientRects().length === 0) dockFocusTarget()?.focus({ preventScroll: true });
}

// A notebook switch while the results show: the view they came from has gone, and they
// say whose they are now. Called with the panel still on them.
function resultsLeftNotebook() {
  if (dockOrigin === null) return;
  dockOrigin = 'home';
  dockScroll = 0;
  const panel = document.getElementById('results-panel');
  if (dockMode !== 'results' || !dockRun?.name || panel.querySelector('.results-notebook')) return;
  const line = document.createElement('p');
  line.className = 'results-notebook';
  line.textContent = `From ${dockRun.name}`;
  panel.prepend(line);
}

// ---- Progress view ----

const PROGRESS_ANNOUNCE_MS = 4000;
// One run, across the exports of a chain. startedAt: the first count, so a takeout's
// scan does not slow the pace. left, leftAt: the time last shown and when.
// spokenAt, textTimer: #progress-text's throttle.
let progressRun = null;

function newProgressRun() {
  return { done: 0, total: 0, percent: 0, startedAt: null, left: null, leftAt: null, finishing: false, spokenAt: null, textTimer: null };
}

// #progress-text is the live region, so it changes once in PROGRESS_ANNOUNCE_MS at most
// and ends on the newest text. The count and the bar beside it are free to move.
function paintProgressText(text) {
  const run = progressRun;
  if (!run) return;
  clearTimeout(run.textTimer);
  run.textTimer = null;
  const wait = NLME.announceDelay(run.spokenAt, Date.now(), PROGRESS_ANNOUNCE_MS);
  const write = () => {
    run.spokenAt = Date.now();
    document.getElementById('progress-text').textContent = text;
  };
  if (wait === 0) write();
  else run.textTimer = setTimeout(write, wait);
}

function paintProgressCount() {
  const run = progressRun;
  const { count, percent } = NLME.progressFigures(run.done, run.total);
  run.percent = percent;
  document.getElementById('progress-count').textContent = count;
  document.getElementById('progress-fill').style.width = `${percent}%`;
  document.getElementById('progress-left').textContent = NLME.progressLeftLine(run.done, run.total, run.left, { finishing: run.finishing });
}

/**
 * Open the progress view, or keep it if a chain already has it. It replaces results
 * that are showing, in one step, so the list does not show between the two.
 *
 * @param {string} [title] defaults to the running job's name
 * @param {string} [text] the first line
 */
function showProgressView({ title = jobLock.current() || 'Export', text = 'Preparing export...' } = {}) {
  document.getElementById('results-panel').innerHTML = '';
  const fresh = dockMode !== 'progress';
  if (fresh) {
    clearTimeout(progressRun?.textTimer);
    progressRun = newProgressRun();
    document.getElementById('progress-title').textContent = title;
    document.getElementById('progress-text').textContent = '';
    paintProgressCount();
    setDock('progress');
    keepDockFocus();
  }
  paintProgressText(text);
}

/**
 * Count one step of a run. Text-only calls leave the count where it is.
 *
 * @param {number} done items finished, in this export
 * @param {number} total items in this export
 * @returns {number} the bar's percent
 */
function setProgressCount(done, total) {
  const run = progressRun;
  if (!run) return 0;
  const now = Date.now();
  const before = run.done;
  run.done = (chainProgress?.base ?? 0) + done;
  run.total = chainProgress?.total ?? total;
  if (run.startedAt === null) run.startedAt = now;
  if (run.done !== before) {
    const waited = run.leftAt === null ? 0 : (now - run.leftAt) / 1000;
    run.left = NLME.calmTimeLeft(run.left, NLME.timeLeft(run.done, run.total, (now - run.startedAt) / 1000), waited);
    run.leftAt = now;
  }
  paintProgressCount();
  return run.percent;
}

// The final save: no time to give, and no Cancel
function setProgressFinishing() {
  if (!progressRun) return;
  progressRun.finishing = true;
  paintProgressCount();
}

// Off, unless a chain is keeping it for its next export
function hideProgressView() {
  if (chainHolds === 0 && dockMode === 'progress') {
    clearTimeout(progressRun?.textTimer);
    setDock(null);
  }
}

// ---- Results ----

/**
 * Show an export's outcome in place of the list (replacing what was there).
 *
 * @param {object} options
 * @param {string} options.message the outcome line (NLME.composeOutcome)
 * @param {{ done: number, total: number }|null} [options.count] the "N of M" above it
 * @param {string[]} [options.lines] more lines under it, one per category
 *   (a retry's combined panel); plain text, escaped here
 * @param {'success'|'warning'|'error'|'info'} [options.level] its colour
 * @param {string[]} [options.saved] ZIP names, or the Downloads folder name
 * @param {Array} [options.errors] the runner's errors (strings and objects)
 * @param {{ count: number, run: () => Promise<void> }|null} [options.retry]
 *   a "Retry N failed" button; `run` starts the retry, and refuses first if the
 *   tab has left the run's notebook (retryMayStart)
 * @param {boolean} [options.notify] show the short toast (default
 *   true; false when an earlier panel is put back)
 */
function showResults(options = {}) {
  if (holdStepResults) { heldStepResults = options; return; }
  const { message, count = null, lines = [], level = 'info', saved = [], errors = [], retry = null, notify = true } = options;
  heldStepResults = null;
  const panel = document.getElementById('results-panel');
  if (!panel) return;
  const esc = NLME.escapeHtml;

  const countHtml = count && count.total > 0
    ? `<p class="results-count">${esc(`${count.done} of ${count.total}`)}</p>`
    : '';
  const linesHtml = lines.length
    ? `<ul class="results-lines">${lines.map(line => `<li>${esc(String(line))}</li>`).join('')}</ul>`
    : '';
  const groups = NLME.groupErrorsForPanel(errors);
  const savedHtml = saved.length
    ? `<div class="results-saved"><strong>Saved:</strong><ul>${saved.map(name => `<li>${esc(String(name))}</li>`).join('')}</ul></div>`
    : '';
  const groupsHtml = groups.map(g => `
    <details class="results-group">
      <summary>${esc(g.heading)} (${g.count})</summary>
      <ul>${g.entries.map(e => `<li>${e.item ? `<strong>${esc(e.item)}</strong>: ` : ''}${esc(e.message)}</li>`).join('')}</ul>
      ${g.more > 0 ? `<p class="results-more">+${g.more} more — see errors.md</p>` : ''}
    </details>`).join('');
  const retryHtml = retry && retry.count > 0
    ? `<button type="button" class="btn btn-primary results-retry">Retry ${esc(String(retry.count))} failed</button>`
    : '';

  panel.innerHTML = `
    ${countHtml}
    <p class="results-message results-${esc(level)}">${esc(message || '')}</p>
    ${linesHtml}
    ${savedHtml}
    <div class="results-actions">
      ${retryHtml}
      <button type="button" class="btn btn-secondary results-done">Done</button>
    </div>
    ${groupsHtml}`;
  clearTimeout(progressRun?.textTimer);
  setDock('results');
  keepDockFocus();
  if (notify) showToast(NLME.resultsToast(level), level);

  panel.querySelector('.results-done').addEventListener('click', closeResults);

  const retryBtn = panel.querySelector('.results-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      try {
        if (await retryMayStart()) await retry.run();
      } catch (error) {
        console.error('[NotebookLM Takeout] Retry failed:', error);
      } finally {
        // A started retry has already replaced the panel (this button is
        // detached then); a refused one leaves it
        retryBtn.disabled = false;
      }
    });
  }
}

// One step of a chain ended it alone: its own panel stands
function showHeldStepResults() {
  if (heldStepResults) showResults(heldStepResults);
}

// Done: back to the view the export started from, as it was
function closeResults() {
  const origin = dockOrigin ?? panelView;
  const scroll = dockScroll;
  document.getElementById('results-panel').innerHTML = '';
  setDock(null);
  showView(origin, { focus: true });
  window.scrollTo(0, scroll);
}

/**
 * Show the "earlier export stopped" banner on Home (its own element, so a new
 * results do not wipe it). On a list, the Back button carries a dot.
 *
 * @param {object} record the job record (NLME.resumeBannerView words it)
 * @param {object} handlers
 * @param {() => Promise<void>|void} handlers.onResume starts the resume; the
 *   banner hides itself first (the finished job shows it again if items are left)
 * @param {() => Promise<void>|void} handlers.onDiscard drops the record; the
 *   banner hides itself after
 * @param {boolean} [handlers.running] a job holds the lock: Resume is disabled
 *
 * Every string is escaped; the record is storage data, not trusted.
 */
function showResumeBanner(record, { onResume, onDiscard, running = false } = {}) {
  const banner = document.getElementById('resume-banner');
  if (!banner) return;
  const esc = NLME.escapeHtml;
  // Stopped: "stopped at N of M" + Resume; only failed keys left: "finished with
  // N failed" + Retry. Both re-run the same keys.
  const view = NLME.resumeBannerView(record);

  banner.innerHTML = `
    <p class="resume-text">${esc(view.text)}</p>
    <div class="resume-actions">
      <button type="button" class="btn btn-primary resume-go"${running ? ' disabled' : ''}>${esc(view.actionLabel)}</button>
      <button type="button" class="btn btn-secondary resume-discard">Discard</button>
    </div>`;
  banner.style.display = 'block';
  setResumeIndicator(true, record.id);

  const resumeBtn = banner.querySelector('.resume-go');
  const discardBtn = banner.querySelector('.resume-discard');
  resumeBtn.addEventListener('click', async () => {
    if (resumeBtn.disabled) return;
    resumeBtn.disabled = true;
    discardBtn.disabled = true;
    hideResumeBanner();
    try {
      if (onResume) await onResume();
    } catch (error) {
      console.error('[NotebookLM Takeout] Resume failed:', error);
    }
  });
  discardBtn.addEventListener('click', async () => {
    discardBtn.disabled = true;
    resumeBtn.disabled = true;
    try {
      if (onDiscard) await onDiscard();
    } catch (error) {
      console.error('[NotebookLM Takeout] Discard failed:', error);
    } finally {
      hideResumeBanner();
    }
  });
}

function hideResumeBanner() {
  const banner = document.getElementById('resume-banner');
  if (!banner) return;
  banner.style.display = 'none';
  banner.innerHTML = '';
  setResumeIndicator(false);
}
