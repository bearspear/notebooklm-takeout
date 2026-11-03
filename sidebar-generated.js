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

function dropStudioList() {
  if (_studioListController) {
    _studioListController.destroy();
    _studioListController = null;
  }
  updateStudioBulkButtonsState();
}

async function scanStudioPage() {
  const resultsEl = document.getElementById('studio-scan-results');
  const countBadge = document.getElementById('studio-count');
  if (!resultsEl || !countBadge) return;

  dropStudioList();
  resultsEl.innerHTML = '<p class="scanning">Scanning generated items...</p>';
  countBadge.textContent = '0';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isNotebookUrl(tab?.url)) {
      resultsEl.innerHTML = '<p class="empty-message">Please open NotebookLM first.</p>';
      return;
    }

    await ensureContentScriptLoaded(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_STUDIO_ITEMS' });
    const items = [...(response?.items || [])];

    // Notes in the Sources panel's "Notes" group are not in the Studio list. If this
    // extra scan fails, the Studio items still render.
    try {
      const notes = await scanNotesData(tab.id);
      for (const note of notes) {
        if (note.elementType !== 'source-note') continue;
        items.push({
          kind: 'source-note',
          label: note.title,
          type: note.type || 'Note (Sources panel)',
          sourceIndex: note.sourceIndex
        });
      }
    } catch (noteError) {
      console.warn('[NotebookLM Takeout] Sources-panel notes scan failed; listing Studio items only:', noteError);
    }

    _studioItems = items;
    _studioTabId = tab.id;

    renderStudioList(items);
  } catch (error) {
    console.error('[NotebookLM Takeout] Generated scan failed:', error);
    resultsEl.innerHTML = `<p class="error-message">Generated scan failed: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

function renderStudioList(items) {
  const resultsEl = document.getElementById('studio-scan-results');
  const countBadge = document.getElementById('studio-count');
  const downloadBulkBtn = document.getElementById('studio-download-selected-btn');
  const deleteBulkBtn = document.getElementById('studio-delete-selected-btn');
  if (!resultsEl || !countBadge) return;

  dropStudioList();
  countBadge.textContent = items.length;

  if (items.length === 0) {
    resultsEl.innerHTML = '<p class="empty-message">No generated items found. Generate content in NotebookLM first.</p>';
    if (downloadBulkBtn) downloadBulkBtn.style.display = 'none';
    if (deleteBulkBtn) deleteBulkBtn.style.display = 'none';
    return;
  }

  if (downloadBulkBtn) downloadBulkBtn.style.display = '';
  if (deleteBulkBtn) deleteBulkBtn.style.display = '';

  resultsEl.innerHTML = '<div class="studio-list"></div>';
  const listEl = resultsEl.querySelector('.studio-list');

  const rowHtml = (item, idx) => {
    const iconSvg = getIconForType(item.type);
    const detailsStr = item.details ? ` · ${escapeHtml(item.details)}` : '';
    return `
        <div class="scan-item-icon">${iconSvg}</div>
        <div class="scan-item-info">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.type)}${detailsStr}</small>
        </div>
        <button class="btn-icon download-single-btn studio-download-btn" data-idx="${idx}" title="Download ${escapeHtml(item.label)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <span class="download-status"></span>
        </button>
        <button class="btn-icon studio-delete-btn" data-idx="${idx}" title="Delete ${escapeHtml(item.label)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
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

// One delete request for a Generated item; throws on failure. Bulk delete passes
// useIndex false for Studio items: by label only, a stale index could hit another item.
async function sendStudioDelete(item, { useIndex = true } = {}) {
  const message = item.kind === 'source-note'
    ? { type: 'DELETE_SOURCE_NOTE', data: { sourceIndex: item.sourceIndex, title: item.label } }
    : { type: 'DELETE_STUDIO_ITEM', data: useIndex ? { label: item.label, combinedIndex: item.combinedIndex } : { label: item.label } };
  const response = await chrome.tabs.sendMessage(_studioTabId, message);
  if (!response || !response.success) {
    throw new Error(response?.error || 'Delete failed');
  }
}

// The bulk buttons follow the selection: disabled at 0, otherwise "... Selected (K)".
// Delete counts the deletable selected items (all of them).
function updateStudioBulkButtonsState(controller = _studioListController) {
  const n = controller ? controller.selectedCount() : 0;
  const deletableN = controller ? controller.selectedItems().filter(isStudioItemDeletable).length : 0;
  const downloadBulkBtn = document.getElementById('studio-download-selected-btn');
  const deleteBulkBtn = document.getElementById('studio-delete-selected-btn');
  if (downloadBulkBtn) {
    downloadBulkBtn.disabled = n === 0;
    setButtonLabel(downloadBulkBtn, n > 0 ? `Download Selected (${n})` : 'Download Selected');
  }
  if (deleteBulkBtn) {
    deleteBulkBtn.disabled = deletableN === 0;
    setButtonLabel(deleteBulkBtn, deletableN > 0 ? `Delete Selected (${deletableN})` : 'Delete Selected');
  }
}

function setStudioRowStatus(btn, state) {
  if (!btn) return;
  const statusSpan = btn.querySelector('.download-status');
  if (!statusSpan) return;
  if (state === 'pending') {
    statusSpan.textContent = '⏳';
    statusSpan.className = 'download-status downloading';
    btn.disabled = true;
  } else if (state === 'success') {
    statusSpan.textContent = '✓';
    statusSpan.className = 'download-status success';
    setTimeout(() => { statusSpan.textContent = ''; statusSpan.className = 'download-status'; btn.disabled = false; }, 3000);
  } else if (state === 'error') {
    statusSpan.textContent = '✗';
    statusSpan.className = 'download-status error';
    setTimeout(() => { statusSpan.textContent = ''; statusSpan.className = 'download-status'; btn.disabled = false; }, 3000);
  }
}

async function handleStudioDownloadRow(idx, btn) {
  const item = _studioItems[idx];
  if (!item) return;
  setStudioRowStatus(btn, 'pending');
  try {
    if (item.kind === 'artifact') {
      // moreIndex: same index space as the Artifacts tab and DOWNLOAD_ARTIFACT
      await downloadArtifact(_studioTabId, item.moreIndex, item.type, item.label);
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
    showToast(`✗ Failed to download ${item.label}: ${error.message || error}`, 'error');
    setStudioRowStatus(btn, 'error');
    throw error;
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
    // Refresh the list so indices are re-aligned with the DOM.
    await scanStudioPage();
  } catch (error) {
    console.error('[NotebookLM Takeout] Generated delete failed:', error);
    showToast(`✗ Failed to delete ${item.label}: ${error.message || error}`, 'error');
    if (btn) btn.disabled = false;
  }
}

async function handleStudioBulkDownload() {
  const selected = _studioListController ? _studioListController.selectedItems() : [];
  const selectedIdxs = selected.map(item => _studioItems.indexOf(item)).filter(n => n >= 0);
  if (selectedIdxs.length === 0) return;

  const bulkBtn = document.getElementById('studio-download-selected-btn');
  if (bulkBtn) bulkBtn.disabled = true;

  let okCount = 0;
  for (const idx of selectedIdxs) {
    const rowBtn = document.querySelector(`#studio-scan-results .studio-download-btn[data-idx="${idx}"]`);
    try {
      await handleStudioDownloadRow(idx, rowBtn);
      okCount++;
    } catch (_) {
      // errors already surfaced per-row
    }
  }

  showToast(`Downloaded ${okCount}/${selectedIdxs.length} generated item(s)`, okCount === selectedIdxs.length ? 'success' : 'warning');
  updateStudioBulkButtonsState();
}

async function handleStudioBulkDelete() {
  // Only what is selected (and so visible) is deleted; the dialog names that count.
  const selectedItems = _studioListController ? _studioListController.selectedItems() : [];
  // An untitled Studio item only has a made-up label ("Item 3"): deleting by it
  // could hit a real item with that title, so a bulk delete skips it
  const skippedUntitled = selectedItems.filter(item => item && item.untitled === true && item.kind !== 'source-note').length;
  const deletable = selectedItems.filter(item => isStudioItemDeletable(item) && !(item.untitled === true && item.kind !== 'source-note'));
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
  await scanStudioPage();
}
