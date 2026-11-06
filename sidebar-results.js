// The results panel (#results-panel, below the progress panel): where an
// export's outcome stays until the next export starts or the user dismisses
// it. Classic script, DOM only; the pure parts are NLME.composeOutcome and
// NLME.groupErrorsForPanel (takeout-shared.js). See AGENT.md "Milestone 3b
// contracts".

/**
 * Show an export's outcome in the results panel (replacing what it showed).
 *
 * @param {object} options
 * @param {string} options.message the outcome line (NLME.composeOutcome)
 * @param {string[]} [options.lines] more lines under it, one per category
 *   (a Full Takeout retry's combined panel); plain text, escaped here
 * @param {'success'|'warning'|'error'|'info'} [options.level] its colour
 * @param {string[]} [options.saved] ZIP names, or the Downloads folder name
 * @param {Array} [options.errors] the runner's errors (strings and objects)
 * @param {{ count: number, run: () => Promise<void> }|null} [options.retry]
 *   a "Retry N failed" button; `run` starts the retry (it clears this panel
 *   itself by starting an export)
 * @param {boolean} [options.notify] show the short "finished" toast (default
 *   true; false when an earlier panel is put back)
 *
 * The panel can sit below a long list: it is scrolled into view and a short
 * toast points at it (the panel holds the detail).
 */
function showResults({ message, lines = [], level = 'info', saved = [], errors = [], retry = null, notify = true } = {}) {
  const panel = document.getElementById('results-panel');
  if (!panel) return;
  const esc = NLME.escapeHtml;

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
    <p class="results-message results-${esc(level)}">${esc(message || '')}</p>
    ${linesHtml}
    ${savedHtml}
    ${groupsHtml}
    <div class="results-actions">
      ${retryHtml}
      <button type="button" class="btn btn-secondary results-dismiss">Dismiss</button>
    </div>`;
  panel.style.display = 'block';
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (notify) showToast('Export finished \u2014 see results below', level);

  panel.querySelector('.results-dismiss').addEventListener('click', hideResults);

  const retryBtn = panel.querySelector('.results-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      try {
        await retry.run();
      } catch (error) {
        console.error('[NotebookLM Takeout] Retry failed:', error);
      } finally {
        // A started retry has already replaced the panel (this button is
        // detached then); a refused one (another job running) leaves it
        retryBtn.disabled = false;
      }
    });
  }
}

function hideResults() {
  const panel = document.getElementById('results-panel');
  if (!panel) return;
  panel.style.display = 'none';
  panel.innerHTML = '';
}

/**
 * Show the "earlier export stopped" banner on Home (its own element, so a new
 * results panel does not wipe it). On a list, the Back button carries a dot.
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
