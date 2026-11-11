// NotebookLM Takeout - Sidebar: Generated tab (list, row and bulk download/delete)
// Classic script, loads after sidebar-chat.js. Shared helpers live in sidebar-core.js.

let _studioItems = [];
// ==================== GENERATED TAB (internal id 'studio') ====================
// Lists everything Gemini Notebook generated: Studio panel items (SCAN_STUDIO_ITEMS)
// plus the notes in the Sources panel's "Notes" group (the source-note entries of
// SCAN_NOTES, download only).

let _studioTabId = null;
// The Generated tab's list controller (sidebar-list.js); replaced on every redraw
let _studioListController = null;
// What the list on screen was built from. startAutoRefresh rescans every few
// seconds: when the scan finds the same items the list is left alone, so typing in
// the filter box and the selection are never interrupted.
let _studioSignature = null;
// The newest scan: an older one still waiting on the page must not draw
let _studioScanSeq = 0;

function dropStudioList() {
  if (_studioListController) {
    _studioListController.destroy();
    _studioListController = null;
  }
  _studioSignature = null;
  updateStudioBulkButtonsState();
}

// The notebook changed: the list, and any scan still running, belong to the old one
function forgetStudioList() {
  _studioScanSeq++;
  dropStudioList();
  const resultsEl = document.getElementById('studio-scan-results');
  if (resultsEl) resultsEl.innerHTML = '<p class="scanning">Scanning Studio items...</p>';
}

// The Generated list's items, no UI (the list, and its count on Home, so the two
// cannot differ): SCAN_STUDIO_ITEMS plus the notes in the Sources panel's "Notes"
// group, which are not in the Studio list. Throws when the Studio scan fails, so a
// failure never reads as an empty list. If the extra notes scan fails, the Studio
// items still render.
async function scanGeneratedItems(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.SCAN_STUDIO_ITEMS });
  if (!response) throw new Error('No response from the page');
  if (response.error) throw new Error(response.error);
  const items = [...(response.items || [])];

  let notes = [];
  try {
    notes = await scanNotesData(tabId, { strict: true });
    stampJobKeys('notes', notes);
    for (const note of notes) {
      if (note.elementType !== 'source-note') continue;
      items.push({
        kind: 'source-note',
        label: note.title,
        type: note.type || 'Note (Sources panel)',
        sourceIndex: note.sourceIndex,
        jobKey: note._listKey
      });
    }
  } catch (noteError) {
    console.warn('[NotebookLM Takeout] Sources-panel notes scan failed; listing Studio items only:', noteError);
  }
  NLME.stampGeneratedJobKeys(items, notes);
  return items;
}

async function scanStudioPage() {
  const resultsEl = document.getElementById('studio-scan-results');
  if (!resultsEl) return;

  const seq = ++_studioScanSeq;
  // A live list is not blanked while rescanning: the redraw (if any) happens below
  const listLive = () => !!_studioListController && !!resultsEl.querySelector('.studio-list');
  if (!listLive()) resultsEl.innerHTML = '<p class="scanning">Scanning Studio items...</p>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (seq !== _studioScanSeq) return;
    if (!isNotebookUrl(tab?.url)) {
      dropStudioList();
      resultsEl.innerHTML = '<p class="empty-message">Open a notebook first.</p>';
      setTabCount('studio', null);
      return;
    }

    await ensureContentScriptLoaded(tab.id);
    const viewerOpen = await studioViewerOpen(tab.id);
    if (seq !== _studioScanSeq) return;
    if (viewerOpen) {
      dropStudioList();
      resultsEl.innerHTML = STUDIO_ITEM_OPEN_HTML;
      setTabCount('studio', null);
      return;
    }
    const items = await scanGeneratedItems(tab.id);

    if (seq !== _studioScanSeq) return;
    const signature = NLME.generatedSignature(tab, items);
    if (listLive() && signature === _studioSignature) {
      setTabCount('studio', items.length); // a Home scan may have cleared it
      return; // unchanged: keep the list, its focus, caret, scroll and selection
    }

    // A redraw must not cost the user their place: keep the scroll position and,
    // if they are typing in the filter box, focus and caret
    const scrollTop = resultsEl.scrollTop;
    const active = document.activeElement;
    const searchHadFocus = !!active && active.classList && active.classList.contains('list-search') && resultsEl.contains(active);
    const caret = searchHadFocus ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;

    _studioItems = items;
    _studioTabId = tab.id;
    renderStudioList(items);
    _studioSignature = signature;

    resultsEl.scrollTop = scrollTop;
    if (caret) {
      const search = resultsEl.querySelector('.list-search');
      if (search) {
        search.focus({ preventScroll: true });
        try { search.setSelectionRange(caret[0], caret[1], caret[2] || 'none'); } catch (_) { /* not a text field */ }
      }
    }
  } catch (error) {
    console.error('[NotebookLM Takeout] Studio scan failed:', error);
    if (seq !== _studioScanSeq) return;
    dropStudioList();
    setTabCount('studio', null);
    resultsEl.innerHTML = `<p class="error-message">Studio scan failed: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

function renderStudioList(items) {
  const resultsEl = document.getElementById('studio-scan-results');
  if (!resultsEl) return;

  dropStudioList();
  setTabCount('studio', items.length);

  if (items.length === 0) {
    resultsEl.innerHTML = '<p class="empty-message">No Studio items found. Create something in Studio first.</p>';
    return;
  }

  resultsEl.innerHTML = '<div class="studio-list"></div>';
  const listEl = resultsEl.querySelector('.studio-list');

  const rowHtml = (item, idx) => {
    const iconSvg = getIconForType(item.type);
    const detailsStr = item.details ? ` · ${escapeHtml(item.details)}` : '';
    const unavailable = NLME.studioItemUnavailableReason(item);
    return `
        <div class="scan-item-icon">${iconSvg}</div>
        <div class="scan-item-info">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.type)}${detailsStr}</small>
        </div>
        <button class="btn-icon download-single-btn studio-download-btn" data-idx="${idx}" title="${escapeHtml(unavailable || `Download ${item.label}`)}" aria-label="Download ${escapeHtml(item.label)}"${unavailable ? ' disabled' : ''}>
          ${icon('download')}
          <span class="download-status"></span>
        </button>
        <button class="btn-icon studio-delete-btn" data-idx="${idx}" title="Delete ${escapeHtml(item.label)}" aria-label="Delete ${escapeHtml(item.label)}">
          ${icon('trash')}
        </button>
      `;
  };

  _studioListController = createListController({
    tab: 'studio',
    container: listEl,
    items,
    titleOf: item => item.label,
    typeOf: item => item.type,
    defaultSelected: 'none',
    rowHtml,
    onChange: controller => updateStudioBulkButtonsState(controller)
  });

  // Row buttons (the list controller ignores clicks on buttons, so they never toggle the row)
  listEl.addEventListener('click', (e) => {
    const downloadBtn = e.target.closest('.studio-download-btn');
    if (downloadBtn) {
      // The item now: a rescan may replace _studioItems while the job lock is awaited
      const item = _studioItems[parseInt(downloadBtn.dataset.idx, 10)];
      runRowExport('Studio download', () => handleStudioDownloadRow(item, downloadBtn));
      return;
    }
    const deleteBtn = e.target.closest('.studio-delete-btn');
    if (deleteBtn) {
      const item = _studioItems[parseInt(deleteBtn.dataset.idx, 10)];
      runExclusive('Studio delete', () => handleStudioDeleteRow(item, deleteBtn));
    }
  });
}

// Every Generated item can be deleted: Studio items by label, Sources-panel
// notes (kind 'source-note') by sourceIndex + title.
function isStudioItemDeletable(item) {
  return !!item;
}

// The notebook and tab a delete is asked about, to check again after the dialog: the
// notebook the tab's URL names (NLME.deleteTarget), so a delete asked before the panel
// has its notebook id is not refused once the id arrives for the same notebook
async function studioDeleteTarget() {
  const tabId = _studioTabId;
  let url = '';
  try {
    url = (await chrome.tabs.get(tabId))?.url || '';
  } catch (_) { /* no tab: no notebook, so the check refuses */ }
  return NLME.deleteTarget({ tabId, url, panelNotebookId: lastPanelNotebookId });
}

// False, with a warning, when the panel moved to another notebook or tab
async function studioDeleteStillValid(asked) {
  if (NLME.sameDeleteTarget(asked, await studioDeleteTarget())) return true;
  showToast('The notebook changed, so nothing was deleted', 'warning');
  return false;
}

// One delete request for a Generated item; throws on failure. Bulk delete passes
// useIndex false for Studio items: by label only, a stale index could hit another item.
async function sendStudioDelete(item, { useIndex = true, tabId = _studioTabId } = {}) {
  const message = item.kind === 'source-note'
    ? { type: NLME.MSG.DELETE_SOURCE_NOTE, data: { sourceIndex: item.sourceIndex, title: item.label } }
    : { type: NLME.MSG.DELETE_STUDIO_ITEM, data: useIndex ? { label: item.label, combinedIndex: item.combinedIndex } : { label: item.label } };
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response || !response.success) {
    throw new Error(response?.error || 'Delete failed');
  }
}

// Both follow the selection. The action counts what can be exported; Delete is
// enabled while anything deletable is selected, but its count K is what the bulk
// delete will remove: untitled Studio items are left out, as in the confirm.
function updateStudioBulkButtonsState(controller = _studioListController) {
  const selected = controller ? controller.selectedItems() : [];
  const deletableN = selected.filter(isStudioItemDeletable).length;
  const deleteCount = NLME.bulkDeletePlan(selected.filter(isStudioItemDeletable), _studioItems).deletable.length;
  const plan = NLME.generatedExportPlan(selected, _studioItems);
  const n = plan.artifacts.length + plan.notes.length;
  setTabAction('studio', { label: NLME.generatedActionLabel(plan), disabled: n === 0, onClick: exportSelectedGenerated });
  const deleteBulkBtn = document.getElementById('studio-delete-selected-btn');
  if (deleteBulkBtn) {
    deleteBulkBtn.hidden = !controller || openPanelTab() !== 'studio';
    deleteBulkBtn.disabled = deletableN === 0 || !!jobLock.current();
    setButtonLabel(deleteBulkBtn, deleteCount > 0 ? `Delete Selected (${deleteCount})` : 'Delete Selected');
  }
}

// The two sides of a Generated export, in this order. Each is the ordinary export
// with its own job record, on the tab the list was scanned on.
// seedErrors: the skipped artifacts' warnings, for the side that writes them;
// recordFailed: those artifacts, kept in the artifacts record as failed.
const GENERATED_EXPORT_STEPS = [
  { name: 'Artifacts', run: (items, tabId, zip, { seedErrors, recordFailed } = {}) => downloadAllArtifacts(tabId, items, { zip, seedErrors, recordFailed }) },
  { name: 'Notes', run: (items, tabId, zip, { seedErrors } = {}) => exportNotesAsMarkdown(items, { tabId, seedErrors }) }
];

// The Generated action: opens the sheet, whose title says what goes and what cannot.
// Save as is for the artifacts: a selection of notes has nothing to choose.
function exportSelectedGenerated() {
  const plan = NLME.generatedExportPlan(_studioListController ? _studioListController.selectedItems() : [], _studioItems);
  const n = plan.artifacts.length + plan.notes.length;
  if (n === 0) return;
  openExportSheet({
    title: NLME.generatedActionLabel(plan),
    counts: { generated: n },
    offerSaveAs: plan.artifacts.length > 0,
    start: ({ overrides, zip }) => runExclusive('Studio export', () => withRunSettings(overrides, () => runGeneratedExport(zip)))
  });
}

// Exports what the current list has selected now: a rescan may have redrawn it under
// the sheet. It runs as a chain, so a Cancel (or a declined health check) in the first side stops the
// second, and each side's results survive the other: with both sides there is one
// combined panel. Its Retry covers items that failed and a side that did not run.
// Unstarted items are in no failedItems: artifacts a Cancel left are in the job
// record's Resume, and with an artifacts record pending, notes a Cancel left are in
// neither (jobRecordMode). The headline counts all of it. Items the export cannot
// take always reach that panel, as a warning, even with one side:
// NLME.generatedExportOutcome.
function runGeneratedExport(zip) {
  const plan = NLME.generatedExportPlan(_studioListController ? _studioListController.selectedItems() : [], _studioItems);
  if (plan.artifacts.length + plan.notes.length === 0) {
    showToast('Nothing is selected now, so nothing was exported', 'warning');
    return;
  }
  const tabId = _studioTabId;
  // Artifacts skipped for having no More button go to errors.md too: the artifacts
  // side's (and its record, as failed, for a later Resume), or with none the notes
  // side's, named as Studio items there
  const skipWarnings = plan.noMenuWarnings;
  const seeds = !skipWarnings.length ? {}
    : plan.artifacts.length ? { Artifacts: { seedErrors: skipWarnings, recordFailed: plan.noMenu } }
      : { Notes: { seedErrors: skipWarnings.map(w => ({ ...w, title: `Studio: ${w.title}`, prefixed: true })) } };
  return runChain(async () => {
    const { steps, notRun } = await runRetryChain({ Artifacts: plan.artifacts, Notes: plan.notes }, tabId, 'Export', GENERATED_EXPORT_STEPS, zip, seeds);
    // Nothing ran (declined, tab closed: already said), or one side ran alone with
    // nothing left out: its own panel stands
    const leftOut = plan.skipped.length > 0;
    if (steps.length === 0 || (steps.length === 1 && notRun.length === 0 && !leftOut)) {
      showHeldStepResults();
      return;
    }
    const outcome = NLME.generatedExportOutcome({ steps, notRun, total: plan.artifacts.length + plan.notes.length, skipped: plan.skipped });
    showTakeoutResults({
      message: outcome.message,
      count: outcome.count,
      level: outcome.level,
      lines: outcome.lines,
      saved: outcome.saved,
      errors: outcome.errors
    }, outcome.remaining, tabId, zip, outcome.imagesMissing);
  });
}

function setStudioRowStatus(btn, state) {
  if (!btn) return;
  const statusSpan = btn.querySelector('.download-status');
  if (!statusSpan) return;
  if (state === 'pending') {
    statusSpan.innerHTML = icon('refresh');
    statusSpan.className = 'download-status downloading';
    btn.disabled = true;
  } else if (state === 'success') {
    statusSpan.innerHTML = icon('check');
    statusSpan.className = 'download-status success';
    setTimeout(() => { statusSpan.textContent = ''; statusSpan.className = 'download-status'; btn.disabled = false; }, 3000);
  } else if (state === 'error') {
    statusSpan.innerHTML = icon('close');
    statusSpan.className = 'download-status error';
    setTimeout(() => { statusSpan.textContent = ''; statusSpan.className = 'download-status'; btn.disabled = false; }, 3000);
  }
}

async function handleStudioDownloadRow(item, btn) {
  if (!item || NLME.isStudioItemUnavailable(item)) return;
  setStudioRowStatus(btn, 'pending');
  try {
    // The row's place among rows of its title in the whole list, so the page can
    // tell a shifted list (NLME.generatedExportPlan stamps it)
    const planned = NLME.generatedExportPlan([item], _studioItems);
    if (item.kind === 'artifact') {
      // moreIndex: same index space as DOWNLOAD_ARTIFACT. With retries; says its own failure
      await triggerItemDownload(_studioTabId, item.moreIndex, item.label, item.type, NLME.titlePlace(planned.artifacts[0]));
    } else if (item.kind === 'source-note') {
      // A note from the Sources panel: EXTRACT_NOTE opens it by sourceIndex (as the Notes tab does)
      await exportSingleNote({ index: -1, sourceIndex: item.sourceIndex, title: item.label, type: item.type });
    } else {
      // kind === 'note' — regular note or mindmap
      await exportSingleNote(planned.notes[0] || { index: item.kindIndex, title: item.label, type: item.type });
    }
    setStudioRowStatus(btn, 'success');
  } catch (error) {
    console.error('[NotebookLM Takeout] Studio download failed:', error);
    if (item.kind !== 'artifact') showToast(`Failed to download ${item.label}: ${error.message || error}`, 'error');
    setStudioRowStatus(btn, 'error');
  }
}

async function handleStudioDeleteRow(item, btn) {
  if (!item || !isStudioItemDeletable(item)) return;

  const target = await studioDeleteTarget();
  const sure = await showDialog({
    title: `Delete "${item.label}"?`,
    body: 'It is removed from the notebook. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true
  });
  if (!sure || !await studioDeleteStillValid(target)) return;

  if (btn) btn.disabled = true;
  try {
    await sendStudioDelete(item, { tabId: target.tabId });
    showToast(`Deleted "${item.label}"`, 'success');
    if (item.kind !== 'artifact') setTabCount('notes', null); // recounted when Notes rescans
    // Refresh the list so indices are re-aligned with the DOM (always a redraw).
    _studioSignature = null;
    await scanStudioPage();
  } catch (error) {
    console.error('[NotebookLM Takeout] Studio delete failed:', error);
    showToast(`Failed to delete ${item.label}: ${error.message || error}`, 'error');
    if (btn) btn.disabled = false;
  }
}

async function handleStudioBulkDelete() {
  // Only what is selected (and so visible) is deleted; the dialog names that count.
  const selectedItems = _studioListController ? _studioListController.selectedItems() : [];
  const deletePlan = NLME.bulkDeletePlan(selectedItems.filter(isStudioItemDeletable), _studioItems);
  const { deletable } = deletePlan;
  const skipText = NLME.bulkDeleteSkipText(deletePlan);
  if (deletable.length === 0) {
    if (skipText) showToast(`Skipped ${skipText}: delete them one by one`, 'warning');
    return;
  }

  const n = deletable.length;
  const skippedNote = skipText ? `\n\n${skipText} will be skipped; delete those one by one.` : '';
  const target = await studioDeleteTarget();
  const sure = await showDialog({
    title: n === 1 ? 'Delete 1 item?' : `Delete ${n} items?`,
    body: `${n === 1 ? 'It is' : 'They are'} removed from the notebook. This cannot be undone.${skippedNote}`,
    confirmLabel: `Delete ${n}`,
    danger: true
  });
  if (!sure || !await studioDeleteStillValid(target)) return;

  const bulkBtn = document.getElementById('studio-delete-selected-btn');
  if (bulkBtn) bulkBtn.disabled = true;

  // Studio items first (resolved by label each time, to survive index shifts),
  // then Sources-panel notes from the highest sourceIndex down so the lower
  // indexes stay valid while rows disappear.
  const studioItems = deletable.filter(item => item.kind !== 'source-note');
  const sourceNotes = deletable.filter(item => item.kind === 'source-note')
    .sort((a, b) => (b.sourceIndex ?? -1) - (a.sourceIndex ?? -1));
  const queue = [...studioItems, ...sourceNotes];

  let okCount = 0;
  let stopped = false;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (!NLME.sameDeleteTarget(target, await studioDeleteTarget())) {
      showToast(`The notebook changed: deleted ${okCount}/${queue.length}, stopped there`, 'warning');
      stopped = true; // still rescanned below: the list and Delete Selected show what is left
      break;
    }
    try {
      await sendStudioDelete(item, { useIndex: false, tabId: target.tabId });
      okCount++;
    } catch (e) {
      console.warn('[NotebookLM Takeout] Bulk delete skipped:', item.label, e?.message || e);
    }
    // Let NotebookLM's undo toast dismiss and the list re-render before the next
    // lookup. Skip the delay on the last iteration.
    if (i < queue.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!stopped) {
    const skippedText = skipText ? `, skipped ${skipText}` : '';
    showToast(`Deleted ${okCount}/${queue.length} Studio item(s)${skippedText}`, okCount === queue.length && !skipText ? 'success' : 'warning');
  }
  if (queue.some(item => item.kind !== 'artifact')) setTabCount('notes', null); // recounted when Notes rescans
  _studioSignature = null; // always a redraw
  await scanStudioPage();
}
