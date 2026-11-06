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
  if (resultsEl) resultsEl.innerHTML = '<p class="scanning">Scanning generated items...</p>';
}

async function scanStudioPage() {
  const resultsEl = document.getElementById('studio-scan-results');
  if (!resultsEl) return;

  const seq = ++_studioScanSeq;
  // A live list is not blanked while rescanning: the redraw (if any) happens below
  const listLive = () => !!_studioListController && !!resultsEl.querySelector('.studio-list');
  if (!listLive()) resultsEl.innerHTML = '<p class="scanning">Scanning generated items...</p>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (seq !== _studioScanSeq) return;
    if (!isNotebookUrl(tab?.url)) {
      dropStudioList();
      resultsEl.innerHTML = '<p class="empty-message">Please open NotebookLM first.</p>';
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
    const response = await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.SCAN_STUDIO_ITEMS });
    const items = [...(response?.items || [])];

    // Notes in the Sources panel's "Notes" group are not in the Studio list. If this
    // extra scan fails, the Studio items still render.
    let notes = [];
    try {
      notes = await scanNotesData(tab.id);
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

    if (seq !== _studioScanSeq) return;
    const signature = NLME.generatedSignature(tab, items);
    if (listLive() && signature === _studioSignature) {
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
    console.error('[NotebookLM Takeout] Generated scan failed:', error);
    if (seq !== _studioScanSeq) return;
    dropStudioList();
    setTabCount('studio', null);
    resultsEl.innerHTML = `<p class="error-message">Generated scan failed: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

function renderStudioList(items) {
  const resultsEl = document.getElementById('studio-scan-results');
  if (!resultsEl) return;

  dropStudioList();
  setTabCount('studio', items.length);

  if (items.length === 0) {
    resultsEl.innerHTML = '<p class="empty-message">No generated items found. Generate content in NotebookLM first.</p>';
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
      const idx = parseInt(downloadBtn.dataset.idx, 10);
      runExclusive('Generated download', () => handleStudioDownloadRow(idx, downloadBtn));
      return;
    }
    const deleteBtn = e.target.closest('.studio-delete-btn');
    if (deleteBtn) {
      runExclusive('Generated delete', () => handleStudioDeleteRow(parseInt(deleteBtn.dataset.idx, 10), deleteBtn));
    }
  });
}

// Every Generated item can be deleted: Studio items by label, Sources-panel
// notes (kind 'source-note') by sourceIndex + title.
function isStudioItemDeletable(item) {
  return !!item;
}

// An untitled Studio item only has a made-up label ("Item 3"): deleting by it
// could hit a real item with that title, so a bulk delete skips it. The bulk
// button's count and the confirm both use this.
function isStudioItemUntitled(item) {
  return !!item && item.untitled === true && item.kind !== 'source-note';
}

// One delete request for a Generated item; throws on failure. Bulk delete passes
// useIndex false for Studio items: by label only, a stale index could hit another item.
async function sendStudioDelete(item, { useIndex = true } = {}) {
  const message = item.kind === 'source-note'
    ? { type: NLME.MSG.DELETE_SOURCE_NOTE, data: { sourceIndex: item.sourceIndex, title: item.label } }
    : { type: NLME.MSG.DELETE_STUDIO_ITEM, data: useIndex ? { label: item.label, combinedIndex: item.combinedIndex } : { label: item.label } };
  const response = await chrome.tabs.sendMessage(_studioTabId, message);
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
  const deleteCount = selected.filter(item => isStudioItemDeletable(item) && !isStudioItemUntitled(item)).length;
  const plan = NLME.generatedExportPlan(selected);
  const n = plan.artifacts.length + plan.notes.length;
  setTabAction('studio', { label: NLME.actionLabel(n, 'item'), disabled: n === 0, onClick: exportSelectedGenerated });
  const deleteBulkBtn = document.getElementById('studio-delete-selected-btn');
  if (deleteBulkBtn) {
    deleteBulkBtn.hidden = !controller || openPanelTab() !== 'studio';
    deleteBulkBtn.disabled = deletableN === 0 || !!jobLock.current();
    setButtonLabel(deleteBulkBtn, deleteCount > 0 ? `Delete Selected (${deleteCount})` : 'Delete Selected');
  }
}

// The two sides of a Generated export, in this order. Each is the ordinary export
// with its own job record, on the tab the list was scanned on.
const GENERATED_EXPORT_STEPS = [
  { name: 'Artifacts', run: (items, tabId) => downloadAllArtifacts(tabId, items) },
  { name: 'Notes', run: (items, tabId) => exportNotesAsMarkdown(items, { tabId }) }
];

// The Generated action: exports what the current list has selected. It runs as a
// chain, so a Cancel (or a declined health check) in the first side stops the
// second, and each side's results survive the other: with both sides there is one
// combined panel. Its Retry covers items that failed and a side that did not run.
// Artifacts a Cancel left unstarted are in no failedItems: only the job record's
// Resume has them. The headline counts all of it (NLME.generatedExportMessage).
function exportSelectedGenerated() {
  const plan = NLME.generatedExportPlan(_studioListController ? _studioListController.selectedItems() : []);
  if (plan.artifacts.length + plan.notes.length === 0) return;
  const tabId = _studioTabId;
  return runExclusive('Generated export', () => runChain(async () => {
    const { steps, notRun } = await runRetryChain({ Artifacts: plan.artifacts, Notes: plan.notes }, tabId, 'Export', GENERATED_EXPORT_STEPS);
    // Nothing ran (declined, tab closed: already said), or one side ran alone: its own panel stands
    if (steps.length === 0 || (steps.length === 1 && notRun.length === 0)) return;
    const combined = NLME.combineRetryOutcomes({ steps, notRun });
    showTakeoutResults({
      message: NLME.generatedExportMessage({ steps, notRun, total: plan.artifacts.length + plan.notes.length }),
      level: combined.level,
      lines: combined.lines,
      saved: combined.saved,
      errors: combined.errors
    }, combined.remaining, tabId);
  }));
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

async function handleStudioDownloadRow(idx, btn) {
  const item = _studioItems[idx];
  if (!item || NLME.isStudioItemUnavailable(item)) return;
  setStudioRowStatus(btn, 'pending');
  try {
    if (item.kind === 'artifact') {
      // moreIndex: same index space as DOWNLOAD_ARTIFACT. With retries; says its own failure
      await triggerItemDownload(_studioTabId, item.moreIndex, item.label, item.type);
    } else if (item.kind === 'source-note') {
      // A note from the Sources panel: EXTRACT_NOTE opens it by sourceIndex (as the Notes tab does)
      await exportSingleNote({ index: -1, sourceIndex: item.sourceIndex, title: item.label, type: item.type });
    } else {
      // kind === 'note' — regular note or mindmap
      await exportSingleNote({ index: item.kindIndex, title: item.label, type: item.type });
    }
    setStudioRowStatus(btn, 'success');
  } catch (error) {
    console.error('[NotebookLM Takeout] Generated download failed:', error);
    if (item.kind !== 'artifact') showToast(`Failed to download ${item.label}: ${error.message || error}`, 'error');
    setStudioRowStatus(btn, 'error');
  }
}

async function handleStudioDeleteRow(idx, btn) {
  const item = _studioItems[idx];
  if (!item || !isStudioItemDeletable(item)) return;

  if (!confirm(`Delete "${item.label}"? This cannot be undone.`)) return;

  if (btn) btn.disabled = true;
  try {
    await sendStudioDelete(item);
    showToast(`Deleted "${item.label}"`, 'success');
    // Refresh the list so indices are re-aligned with the DOM (always a redraw).
    _studioSignature = null;
    await scanStudioPage();
  } catch (error) {
    console.error('[NotebookLM Takeout] Generated delete failed:', error);
    showToast(`Failed to delete ${item.label}: ${error.message || error}`, 'error');
    if (btn) btn.disabled = false;
  }
}

async function handleStudioBulkDelete() {
  // Only what is selected (and so visible) is deleted; the dialog names that count.
  const selectedItems = _studioListController ? _studioListController.selectedItems() : [];
  const skippedUntitled = selectedItems.filter(isStudioItemUntitled).length;
  const deletable = selectedItems.filter(item => isStudioItemDeletable(item) && !isStudioItemUntitled(item));
  if (deletable.length === 0) {
    if (skippedUntitled > 0) showToast(`Skipped ${skippedUntitled} untitled item(s): delete them one by one`, 'warning');
    return;
  }

  const skippedNote = skippedUntitled > 0 ? `\n\n${skippedUntitled} untitled item(s) will be skipped; delete those one by one.` : '';
  if (!confirm(`Delete ${deletable.length} item(s)? This cannot be undone.${skippedNote}`)) return;

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
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      await sendStudioDelete(item, { useIndex: false });
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

  const skippedText = skippedUntitled > 0 ? `, skipped ${skippedUntitled} untitled` : '';
  showToast(`Deleted ${okCount}/${queue.length} generated item(s)${skippedText}`, okCount === queue.length && skippedUntitled === 0 ? 'success' : 'warning');
  _studioSignature = null; // always a redraw
  await scanStudioPage();
}
