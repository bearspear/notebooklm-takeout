// The export sheet: one export's options, at the moment of export. A modal over the
// panel. A caller gives it what the export is; choosing changes only that run, never
// a default, and nothing here writes settings. Its state lives in `_sheet`, not in
// the DOM, so what `start` gets cannot depend on the page after the sheet closes, and
// a rescan or tab event under the sheet leaves the choices and the focus alone.

let _sheet = null; // { opener, counts, start, choice, startLostFocus } while open

// Why Start cannot run right now, for the line above it; '' when it can
function sheetBlockedReason() {
  if (jobLock.current()) return `${jobLock.current()} is still running`;
  if (!homeNotebookOpen) return 'Open the notebook to export it';
  if (settleWaits > 0) return 'The notebook is still loading';
  return '';
}

function paintSheetChoice() {
  const { choice, counts } = _sheet;
  const panel = document.getElementById('export-sheet-panel');
  panel.querySelectorAll('input[name="sheet-preset"]').forEach(radio => { radio.checked = radio.value === choice.preset; });
  panel.querySelectorAll('input[name="sheet-save"]').forEach(radio => { radio.checked = (radio.value === 'zip') === choice.zip; });
  document.getElementById('sheet-custom').hidden = choice.preset !== 'custom';
  document.getElementById('sheet-citations').value = NLME.chatCitationMode(choice);
  document.getElementById('sheet-images').checked = choice.images;
  document.getElementById('sheet-obsidian').checked = choice.obsidianNames;
  const { citationDetail } = NLME.sheetOverrides(choice, realSettings()).overrides;
  document.getElementById('sheet-estimate').textContent = NLME.estimateLine(counts, citationDetail);
}

// Start follows the job lock, the tab and a settle wait. A disabled button drops the
// focus, so the panel holds it meanwhile and Start gets it back.
function syncExportSheet() {
  if (!_sheet) return;
  const reason = sheetBlockedReason();
  const startBtn = document.getElementById('sheet-start');
  if (reason && document.activeElement === startBtn) {
    _sheet.startLostFocus = true;
    document.getElementById('export-sheet-panel').focus({ preventScroll: true });
  }
  startBtn.disabled = !!reason;
  const line = document.getElementById('sheet-blocked');
  if (line.textContent !== reason) line.textContent = reason;
  if (!reason && _sheet.startLostFocus) {
    _sheet.startLostFocus = false;
    if (document.activeElement === document.getElementById('export-sheet-panel')) startBtn.focus({ preventScroll: true });
  }
}

/**
 * Open the sheet, unless a job runs, no notebook is open, or Settings or Health Check
 * shows.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {object} options.counts for NLME.estimateLine
 * @param {boolean} [options.offerSaveAs] show the Folder or ZIP choice
 * @param {(run: { overrides: object, zip: boolean }) => any} options.start runs the
 *   job, called once with the sheet already closed: withRunSettings(overrides, ...)
 *   inside runExclusive. What it exports it decides then, from the current list.
 * @returns {boolean} whether it opened
 */
function openExportSheet({ title, counts, offerSaveAs = false, start }) {
  if (_sheet) return false;
  if (jobLock.current()) {
    showToast(`${jobLock.current()} is still running`, 'warning');
    return false;
  }
  if (!homeNotebookOpen) {
    showToast('Open a notebook first.', 'error');
    return false;
  }
  // A cover (Settings, the health check) would sit over the sheet
  if (['settings-panel', 'health-check-panel'].some(id => getComputedStyle(document.getElementById(id)).display !== 'none')) {
    showToast('Close this panel to export', 'warning');
    return false;
  }
  _sheet = { opener: document.activeElement, counts, start, choice: NLME.sheetChoice(realSettings()), startLostFocus: false };
  document.getElementById('export-sheet-title').textContent = title;
  document.getElementById('sheet-save').hidden = !offerSaveAs;
  paintSheetChoice();
  syncExportSheet();
  document.getElementById('export-sheet').hidden = false;
  syncCoverInert();
  document.addEventListener('keydown', handleSheetKey, true);
  document.getElementById('export-sheet-body').scrollTop = 0;
  document.querySelector('#export-sheet-panel input[name="sheet-preset"]:checked').focus({ preventScroll: true });
  return true;
}

// Back to the button that opened the sheet, or if it went away, to the open view
function returnSheetFocus(opener) {
  const usable = opener && opener.isConnected && !opener.disabled && opener.getClientRects().length > 0;
  if (usable) opener.focus({ preventScroll: true });
  else focusView(panelView);
}

// switched: a notebook switch. The opener belongs to the old notebook and Export
// everything goes off for the settle, so the focus goes to the view.
function closeExportSheet({ switched = false } = {}) {
  if (!_sheet) return;
  const { opener } = _sheet;
  _sheet = null;
  document.removeEventListener('keydown', handleSheetKey, true);
  document.getElementById('export-sheet').hidden = true;
  syncCoverInert();
  returnSheetFocus(switched ? null : opener);
}

// Close first, then the job: a second click finds the sheet closed. The one wait before
// `start` is the last look at the tab, which tab events can lag behind.
async function startExportSheet() {
  if (!_sheet || sheetBlockedReason()) return;
  const { opener, choice, start } = _sheet;
  const run = NLME.sheetOverrides(choice, realSettings());
  closeExportSheet();
  try {
    if (await tabStillOnPanelNotebook()) await start(run);
  } catch (error) {
    console.error('[NotebookLM Takeout] Export failed:', error);
    showToast('Export failed. Please try again.', 'error');
  }
  // The job disabled the opener, which dropped the focus
  if (!_sheet && document.activeElement === document.body) returnSheetFocus(opener);
}

function sheetTabStops() {
  return Array.from(document.querySelectorAll('#export-sheet-panel button, #export-sheet-panel input, #export-sheet-panel select'))
    .filter(el => !el.disabled && el.getClientRects().length > 0 && !(el.type === 'radio' && !el.checked));
}

// The panel behind is inert, so without this Tab would leave for the browser's own UI
function handleSheetKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeExportSheet();
    return;
  }
  if (event.key !== 'Tab') return;
  const stops = sheetTabStops();
  const [first, last] = [stops[0], stops[stops.length - 1]];
  const now = document.activeElement;
  const edge = event.shiftKey ? first : last;
  if (now === edge || !stops.includes(now)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
}

function handleSheetChange({ target }) {
  if (!_sheet) return;
  const { choice } = _sheet;
  if (target.name === 'sheet-preset') choice.preset = target.value;
  else if (target.name === 'sheet-save') choice.zip = target.value === 'zip';
  else if (target.id === 'sheet-citations') choice.citationDetail = target.value;
  else if (target.id === 'sheet-images') choice.images = target.checked;
  else if (target.id === 'sheet-obsidian') choice.obsidianNames = target.checked;
  paintSheetChoice();
}

function setupExportSheet() {
  document.getElementById('export-sheet-panel').addEventListener('change', handleSheetChange);
  document.getElementById('sheet-start').addEventListener('click', startExportSheet);
  document.getElementById('sheet-close').addEventListener('click', () => closeExportSheet());
  document.getElementById('export-sheet-scrim').addEventListener('click', () => closeExportSheet());
}
