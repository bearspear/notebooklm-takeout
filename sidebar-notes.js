// NotebookLM Takeout - Sidebar: Notes tab (note scanning, list, note export jobs, notes files)
// Classic script, loads after sidebar-artifacts.js. Shared helpers live in sidebar-core.js.

// ==================== NOTE SCANNING ====================


// Notes from SCAN_NOTES, no UI (Notes tab, Home, Generated; Export everything and
// Resume wait for the list with scanNotesSettled)
// strict: throw when the page gave no list, instead of reading that as no notes
// (everything but the Notes tab, whose own message says so).
// @returns {Promise<Array<{ index, title, ... }>>} as the content script sends them
async function scanNotesData(tabId, { strict = false } = {}) {
  await ensureContentScriptLoaded(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.SCAN_NOTES });
  if (strict && !Array.isArray(response?.notes)) throw new Error(response?.error || 'No response from the page');
  return stampNoteOrdinals(response?.notes || []);
}

// Studio notes get their place among notes of their title, which the page checks
// before it trusts a scanned index (NLME.pickByIndexThenTitleStrict)
function stampNoteOrdinals(notes) {
  return NLME.stampTitleOrdinals(notes, { titleOf: n => n.title, indexOf: n => (n.elementType === 'source-note' ? -1 : n.index) });
}

// Notes for Export everything and Resume: SCAN_NOTES again every pollMs until the
// list settles (NLME.notesSettleDecision), at most about 8 s. Notes found or a
// drawn empty list return the array; a list that never drew, or a page that never
// answered, throws, so the caller reports a failed scan, not "none in notebook".
// Notes found while the Studio list never drew (Sources-panel notes) are returned
// too, and onPartial(message) says Studio notes may be missing.
// isCancelled: ends the wait early by throwing.
async function scanNotesSettled(tabId, { isCancelled = () => false, onPartial = () => {}, timing = NLME.NOTES_SETTLE, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const reads = [];
  const started = now();
  for (;;) {
    let response = null;
    try {
      await ensureContentScriptLoaded(tabId);
      response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.SCAN_NOTES });
    } catch (error) {
      console.warn('[NotebookLM Takeout] Notes scan: no answer yet:', error);
    }
    reads.push({ at: now() - started, notes: Array.isArray(response?.notes) ? response.notes : null, list: response?.list });
    const decision = NLME.notesSettleDecision(reads, timing);
    if (decision.state === 'partial') onPartial(decision.message);
    if (['found', 'empty', 'partial'].includes(decision.state)) return stampNoteOrdinals(reads[reads.length - 1].notes);
    if (decision.state === 'failed') throw new Error(decision.message);
    if (isCancelled()) throw new Error('Cancelled while reading the notes list');
    await sleep(timing.pollMs);
  }
}

// Sidebar function to trigger note scan
async function scanNotesPage() {
  const notesResults = document.getElementById('notes-results');
  const seq = ++_notesScanSeq;

  notesResults.innerHTML = '<p class="scanning">Scanning for notes...</p>';
  idleTabAction('notes'); // the list that was here is gone

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (seq !== _notesScanSeq) return;

    if (!isNotebookUrl(tab?.url)) {
      renderNotesList([]);
      notesResults.innerHTML = NOTEBOOK_PROMPT_HTML;
      setTabCount('notes', null);
      return;
    }

    const notes = await scanNotesData(tab.id);
    console.log('[NotebookLM Takeout] Scanned notes:', notes);

    const viewerOpen = await studioViewerOpen(tab.id);
    if (seq !== _notesScanSeq) return;
    if (viewerOpen) {
      renderNotesList([]);
      notesResults.innerHTML = STUDIO_ITEM_OPEN_HTML;
      setTabCount('notes', null);
      return;
    }

    renderNotesList(notes);

  } catch (error) {
    if (seq !== _notesScanSeq) return;
    console.error('Error scanning for notes:', error);
    notesResults.innerHTML = '<p class="error-message">Failed to scan for notes. Please refresh the notebook page and try again.</p>';
    setTabCount('notes', null);
  }
}

// The Notes tab's list controller (sidebar-list.js); replaced on every redraw
let _notesListController = null;
// The newest scan: an older one still waiting on the page must not draw
let _notesScanSeq = 0;

// Single-note export from a row button: loose .md files, no ZIP
async function handleNoteRowExport(note) {
  // JOB_BUSY: runExclusive has already shown the "still running" toast
  await runRowExport('Note export', async () => {
    try {
      await exportSingleNote(note);
      showToast(`Exported "${note.title}"`, 'success');
    } catch (error) {
      console.error('[NotebookLM Takeout] Note export failed:', error);
      showToast(`Failed to export ${note.title}: ${error.message || error}`, 'error');
    }
  });
}

// Render notes list with filter toolbar and checkboxes
function renderNotesList(notes) {
  const notesResults = document.getElementById('notes-results');

  if (_notesListController) {
    _notesListController.destroy();
    _notesListController = null;
  }

  if (notes.length === 0) {
    notesResults.innerHTML = '<p class="empty-message">No notes found. Add source materials to your notebook.</p>';
    setTabCount('notes', 0);
    idleTabAction('notes');
    return;
  }

  setTabCount('notes', notes.length);

  notesResults.innerHTML = '<div class="notes-list"></div>';
  const listEl = notesResults.querySelector('.notes-list');

  const rowHtml = (note, idx) => {
    // Choose icon based on note type
    const isMindmap = note.type === 'Mindmap';

    return `
        <div class="scan-item-icon">${icon(isMindmap ? 'map' : 'note')}</div>
        <div class="scan-item-info">
          <strong>${escapeHtml(note.title)}</strong>
          <small>${escapeHtml(note.type)}</small>
        </div>
        <button class="btn-icon note-download-btn" data-index="${idx}" title="Export ${escapeHtml(note.title)}" aria-label="Export ${escapeHtml(note.title)}">
          ${icon('download')}
        </button>
      `;
  };

  _notesListController = createListController({
    tab: 'notes',
    container: listEl,
    items: notes,
    titleOf: note => note.title,
    typeOf: note => note.type,
    defaultSelected: 'none',
    rowHtml,
    onChange: controller => {
      const n = controller.selectedCount();
      setTabAction('notes', {
        label: NLME.actionLabel(n, 'note'),
        disabled: n === 0,
        onClick: exportSelectedNotes
      });
    }
  });

  // Row export buttons (the list controller ignores clicks on buttons, so they never toggle the row)
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.note-download-btn');
    if (!btn) return;
    e.stopPropagation();
    const note = notes[parseInt(btn.dataset.index, 10)];
    if (note) handleNoteRowExport(note);
  });

}

// The Notes action: opens the sheet for the selection. Start exports what the list
// has selected then: a rescan may have redrawn it under the sheet.
function exportSelectedNotes() {
  const n = _notesListController ? _notesListController.selectedCount() : 0;
  if (n === 0) {
    showToast('Please select at least one note', 'error');
    return;
  }
  openExportSheet({
    title: NLME.actionLabel(n, 'note'),
    counts: { notes: n },
    start: ({ overrides }) => runExclusive('Notes export', () => withRunSettings(overrides, async () => {
      const selected = _notesListController ? _notesListController.selectedItems() : [];
      if (selected.length === 0) {
        showToast('Nothing is selected now, so nothing was exported', 'warning');
        return;
      }
      await exportNotesAsMarkdown(selected);
    }))
  });
}

// Notes export (Milestone 3a): the shared export shell around runNotesJob.
// Each batch becomes one <Notebook>-notes-<ts>.zip from buildNotesFiles.
// options.tabId: the tab the notes were scanned on (a retry); default the active tab.
// Returns withExportShell's outcome ({ result, message, level, saved, errors } or
// { declined } / { aborted }); the Full Takeout retry chain reads it.
// seedErrors: warnings that lead errors.md (a Studio export's skipped artifacts
// when it has no artifact side to carry them).
async function exportNotesAsMarkdown(selectedNotes, { tabId, updateRecord = false, seedErrors = [] } = {}) {
  startExportTiming();
  console.log('[NotebookLM Takeout] Starting export for notes:', selectedNotes.length);

  return withExportShell({ label: 'notes', healthType: 'notes', overlayMessage: 'Preparing to export notes...', tabId }, async shell => {
    const { result, zips, auditOk } = await withJobRecord(shell, 'notes', 'Notes', 'notes', selectedNotes,
      tracker => runNotesJob(shell, selectedNotes, { tracker, seedErrors }), { update: updateRecord });

    return shell.finish({
      kind: 'notes',
      selected: selectedNotes.length,
      result,
      auditOk,
      stoppedMessage: result.stopped
        ? `Stopped after ${result.exported} of ${selectedNotes.length} notes: citations could not be read (Gemini Notebook may have changed). Run the health check; details in errors.md.`
        : undefined,
      saved: zips,
      retry: retryFor(result.failedItems, 'Notes export', failed => exportNotesAsMarkdown(failed, { tabId: shell.tab.id, updateRecord: true }))
    });
  });
}

/**
 * Run the notes job (extract, batch, package) inside an export shell.
 *
 * @param {object} shell withExportShell's shell (tab, meta, progress, isCancelled)
 * @param {object[]} selectedNotes notes as SCAN_NOTES returns them
 * @param {CategoryTarget} [target]
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean, parts: number, packages: number }>}
 *   zips/parts/packages: what target.written holds (see newWritten)
 *   result: runExportJob's result
 */
async function runNotesJob(shell, selectedNotes, { pathPrefix = '', zipKind = 'notes', folder = null, variantSettings = settings, itemDir = 'notes/', written = newWritten(), tracker = null, capture = null, seedErrors = [] } = {}) {
  // File names already used by an earlier part of this job: every part of one
  // export unzips into one folder, so a repeat is numbered, not overwritten.
  // Mind maps have their own folder, so their own set.
  const takenStems = { notes: new Set(), mindmaps: new Set() };
  const perZip = settings.notesPerZip;
  // Shared by every extractNoteItem call: audit counters, early-stop
  // counters, and the DOM-warning decision
  const state = {
    audit: newAudit(),
    notesWithMarkers: 0,
    unreadNotes: 0,
    failures: 0,
    domWarningShown: false,
    declined: false // user declined the DOM warning: stops like a Cancel
  };
  let packaged = 0; // notes written to ZIPs so far
  // Snapshot of the run-wide audit when the previous part was packaged, and
  // the items attempted by then: a part's audit is the difference
  let lastPartAudit = newAudit();
  let lastPartAttempted = 0;

  // Item counts go in last, once every written note is known
  const finalAudit = () => {
    state.audit.expected.items = selectedNotes.length;
    state.audit.written.items = packaged;
    return state.audit;
  };

  console.log(`[NotebookLM Takeout] Will create ${Math.ceil(selectedNotes.length / perZip)} ZIP(s) for ${selectedNotes.length} notes (${perZip} per ZIP)`);

  beginImageSession(shell.tab.id, () => shell.isCancelled() || state.declined);
  const result = await NLME.runExportJob({
    kind: 'notes',
    items: selectedNotes,
    seedErrors,
    perZip,
    extractOne: (note, ctx) => extractNoteItem(shell, note, ctx, state, variantSettings),
    // Always close the note viewer, even if extraction failed
    afterEach: async (note, { failed }) => {
      if (tracker) (failed ? tracker.fail : tracker.done)('notes', note);
      try {
        const backResponse = await chrome.tabs.sendMessage(shell.tab.id, { type: NLME.MSG.NAVIGATE_BACK });
        console.log('[NotebookLM Takeout] Navigate back response:', backResponse);
        // NAVIGATE_BACK resolves once the viewer is closed and the list is
        // back; the next EXTRACT_NOTE waits for a stable list itself
        // (Milestone 1: was a fixed 3 s per note)
      } catch (backError) {
        console.error('[NotebookLM Takeout] Failed to navigate back:', backError);
        // Continue: EXTRACT_NOTE fails the next note cleanly if a viewer is stuck
      }
    },
    packageBatch: async (notes, info) => {
      packaged += notes.length;
      shell.progress(`Creating ZIP ${info.batchIndex}/${info.totalBatches}...`);
      // Every part gets an _audit.md for its own items (what was added since
      // the previous part); the last part (an errors-only ZIP too: the outcome
      // toast may point at it) adds the run-wide totals as a second section.
      // An unsplit export keeps the single run-wide audit.
      const runAudit = finalAudit();
      const totalNow = info.exported + info.failed;
      const partAudit = NLME.partAudit(runAudit, lastPartAudit, { attempted: totalNow - lastPartAttempted, written: notes.length });
      lastPartAudit = JSON.parse(JSON.stringify(runAudit));
      lastPartAttempted = totalNow;
      const auditText = info.multi
        ? auditMarkdown(`Notes Export (part ${info.batchIndex} of ${info.totalBatches})`, partAudit, { runTotals: info.isLast ? runAudit : null }).text
        : auditMarkdown('Notes Export', runAudit).text;
      const files = buildNotesFiles(notes, {
        meta: shell.meta,
        errors: info.errors,
        auditText,
        batchIndex: info.batchIndex,
        totalBatches: info.totalBatches,
        partial: info.partial,
        variantSettings,
        itemDir,
        takenStems
      });
      await saveCategoryBatch(shell, files, info, { prefix: batchPrefix(pathPrefix, info), zipKind, folder, written, capture });
      console.log(`[NotebookLM Takeout] Downloaded notes ZIP ${info.batchIndex}/${info.totalBatches}`);
      if (tracker) tracker.commit(); // these notes are on disk now

      // CRITICAL: free each batch's memory before the next one
      await new Promise(resolve => setTimeout(resolve, 500));
      notes.forEach(note => {
        note.markdown = null;
        note.html = null;
        note.sources = null;
        note.imageEmbeds = null;
        note.svgContent = null;
        note.treeData = null;
      });
      imageSession?.endBatch();
      // Give GC time to work between batches
      if (!info.isLast) await new Promise(resolve => setTimeout(resolve, 1000));
    },
    isCancelled: () => shell.isCancelled() || state.declined,
    onProgress: ({ done, total, batchIndex, totalBatches, item }) => {
      const batchStart = (batchIndex - 1) * perZip;
      const batchSize = Math.min(perZip, total - batchStart);
      shell.progress(`Batch ${batchIndex}/${totalBatches}: Processing ${done - batchStart + 1}/${batchSize}: ${item.title}`,
        { done, total, item: item.title });
      console.log(`[NotebookLM Takeout] Processing note ${done + 1}/${total}:`, item.title, 'index:', item.index);
    }
  }).finally(endImageSession);

  return { result, zips: written.zips, errors: result.errors, auditOk: NLME.auditExport(finalAudit()).ok, parts: written.parts, packages: written.count };
}

/**
 * Extract one note for the job runner: EXTRACT_NOTE, then a mind map entry or
 * the note's Markdown with audit counts. Non-fatal note errors go to
 * ctx.warn; a failed note throws (the runner records "[<title>] <message>").
 * Stops the job (ctx.stop) when the first three notes with citation markers
 * all came back without sources.
 *
 * @param {object} shell withExportShell's shell (tab)
 * @param {{index: number, title: string, sourceIndex?: number}} note
 * @param {{warn: Function, stop: Function}} ctx
 * @param {object} state counters shared across notes (see exportNotesAsMarkdown)
 * @param {object} [variantSettings] where the export* variant settings come from (default `settings`)
 * @returns {Promise<object>} NoteData: { title, markdown, html, sources } or
 *   { title, isMindmap: true, svgContent, treeData }
 */
async function extractNoteItem(shell, note, ctx, state, variantSettings = settings) {
  let noteData;
  try {
    noteData = await chrome.tabs.sendMessage(shell.tab.id, {
      type: NLME.MSG.EXTRACT_NOTE,
      data: {
        noteIndex: note.index,
        noteTitle: note.title,
        sourceIndex: note.sourceIndex,
        // the scan's place among notes of this title (NLME.stampTitleOrdinals)
        ...(Number.isInteger(note._titleOrdinal) ? { titleOrdinal: note._titleOrdinal } : {}),
        // Only download images if user has enabled an image version
        includeCitationImages: !!variantSettings.exportNoteWithImages,
        citationDetail: settings.citationDetail,
        reuseCitations: settings.reuseCitations !== false
      }
    });
    console.log('[NotebookLM Takeout] Note data received:', noteData);
    mergeTiming(noteData);

    if (noteData && !noteData.error) {
      (noteData.errors || []).forEach(err => ctx.warn(`[${note.title}] ${err}`));

      if (noteData.isMindmap) {
        return {
          title: note.title,
          isMindmap: true,
          svgContent: noteData.svgContent,
          treeData: noteData.treeData
        };
      }

      // Convert to markdown (without noteId for individual files),
      // counting citations and formulas for the audit
      const notePage = countPageContent(noteData.html);
      const markdown = convertCounted(state.audit, noteData.html,
        () => convertToMarkdown(noteData.html, noteData.sources, note.title, false, false, null, true, settings.citationDetail === 'none'), notePage);
      // 'none' drops citations on purpose: nothing to audit there
      if (settings.citationDetail !== 'none') {
        addCitationCoverage(state.audit, noteData.html, noteData.sources, settings.citationDetail === 'quotes', notePage);
      }
      // The files are built from the HTML later: keep the downloads for -with-images
      let imageEmbeds = null;
      if (variantSettings.exportNoteWithImages) {
        try {
          imageEmbeds = await embedAndReportImages(markdown, note.title, noteData.imageFailures, ctx.warn);
        } catch (error) {
          // Images stay links; the note itself is fine
          console.error(`[NotebookLM Takeout] [${note.title}] Error embedding images:`, error);
          ctx.warn(`[${note.title}] Failed to embed images: ${error.message}`);
        }
      }
      if (notePage.citationNumbers.length > 0 && settings.citationDetail === 'quotes') {
        const fromCache = noteData.fromCache === true;
        tallyCitationCache(fromCache, state.audit);
        // Only hovered notes can show drift: a cache hit always has sources, so
        // counting it would keep this guard from ever firing
        if (!fromCache) {
          state.notesWithMarkers++;
          if ((noteData.sources || []).length === 0) state.unreadNotes++;
        }
      }
      if (state.notesWithMarkers === 3 && state.unreadNotes === 3) {
        // The first three notes with citations all failed: the page has
        // probably changed. Stop instead of exporting 150 notes without
        // sources. This note is still written.
        ctx.stop(`[${note.title}] Citations could not be read in the first 3 notes that have them; export stopped (Gemini Notebook may have changed — run the health check)`);
      }

      return {
        title: note.title,
        markdown,
        // Raw data for combined-notes.md (which needs unique noteIds)
        html: noteData.html,
        sources: noteData.sources,
        imageEmbeds
      };
    }
  } catch (error) {
    console.error(`Failed to process note: ${note.title}`, error);
    showToast(`Error processing: ${note.title}`, 'error');
    throw await itemFailed(shell, state, `Exception during extraction: ${error.message || error.toString()}`);
  }

  console.error(`Failed to extract note: ${note.title}`, noteData?.error);
  showToast(`Skipped: ${note.title} (${noteData?.error || 'unknown error'})`, 'warning');
  throw await itemFailed(shell, state, `Failed to extract: ${noteData?.error || 'unknown error'}`);
}

/**
 * Return the list of note export "versions" the user currently has enabled.
 * Matches the variant set built by buildNotesFiles.
 */
// Versions for one note (NLME.noteVariants): base always, the others only
// when they would differ from base
function getEnabledNoteVersions({ hasQuotes = false, hasImages = false } = {}) {
  return NLME.noteVariants(settings, { hasQuotes, hasImages }).map(v => ({
    fileSuffix: v.suffix,
    variant: variantName(v.suffix),
    citationsCodeBlock: v.codeBlocks,
    stripImages: !v.images
  }));
}

/**
 * Trigger a download of a blob as a single file (no ZIP, no user save-as dialog).
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Give the browser a moment to queue the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Export one note (regular or mindmap) as individual file(s) — no ZIP.
 * Honors the user's enabled note export versions; always includes citations.
 *
 * @param {{index: number, title: string, type?: string}} note
 * @returns {Promise<{success: boolean, filesWritten: number}>}
 */
async function exportSingleNote(note) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isNotebookUrl(tab?.url)) {
    throw new Error('The notebook tab is not active');
  }

  await ensureContentScriptLoaded(tab.id);

  // Notebook metadata for the notes' front matter
  const meta = NLME.exportMeta({
    notebookTitle: await getProjectName(tab.id),
    tabUrl: tab.url,
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date()
  });
  const needsImages = !!settings.exportNoteWithImages;

  // One note, no job of its own to collect errors: say failures here
  beginImageSession(tab.id, () => false);
  let noteData;
  let imageEmbeds = null;
  try {
    try {
      noteData = await chrome.tabs.sendMessage(tab.id, {
        type: NLME.MSG.EXTRACT_NOTE,
        data: {
          noteIndex: note.index,
          noteTitle: note.title,
          sourceIndex: note.sourceIndex,
          includeCitationImages: needsImages,
          citationDetail: settings.citationDetail,
          reuseCitations: settings.reuseCitations !== false
        }
      });
    } finally {
      // Always close the note viewer so the next action has a clean page.
      try { await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.NAVIGATE_BACK }); } catch (_) { /* noop */ }
    }

    if (!noteData || noteData.error) {
      throw new Error(noteData?.error || 'Failed to extract note');
    }

    if (needsImages && !noteData.isMindmap) {
      imageEmbeds = await embedAndReportImages(
        convertToMarkdown(noteData.html, noteData.sources, note.title, false, true, null, true, settings.citationDetail === 'none', settings.citationStyle),
        note.title, noteData.imageFailures, failure => {
          console.warn(`[NotebookLM Takeout] "${note.title}": ${failure.message}`, failure.url);
          showToast(`${note.title}: ${failure.message}`, 'warning');
        });
    }
  } finally {
    endImageSession();
  }

  const obsidian = !!settings.obsidianNames;
  let filesWritten = 0;

  if (noteData.isMindmap) {
    const files = await mindmapFiles(NLME.prefixedStem('mind-map', note.title, { obsidian }), noteData.svgContent, noteData.treeData, note.title);
    await saveFiles(files);
    return { success: true, filesWritten: files.length };
  }

  // Regular note — produce enabled markdown versions, each as its own .md file.
  const versions = getEnabledNoteVersions({
    hasQuotes: (noteData.sources || []).some(src => src.quote && src.quote.trim()),
    hasImages: NLME.noteHasImages(noteData) // body or citation quotes
  });
  for (const version of versions) {
    let markdown = convertToMarkdown(
      noteData.html,
      noteData.sources,
      note.title,
      version.citationsCodeBlock,
      true, // skipTitleIfPresent
      null,
      true,
      settings.citationDetail === 'none',
      settings.citationStyle
    );
    markdown = version.stripImages ? stripImagesFromMarkdown(markdown) : NLME.applyImageEmbeds(markdown, imageEmbeds);
    markdown = noteFrontMatter(meta, { title: note.title, variant: version.variant }) + markdown;
    const filename = `${NLME.prefixedStem('NOTE', note.title, { obsidian })}${version.fileSuffix}.md`;
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
    filesWritten++;
  }

  return { success: true, filesWritten };
}

/**
 * Files for one notes ZIP: notes/ (every enabled variant), combined-notes
 * files, mind-maps/, errors.md, _audit.md, _index.md and manifest.json (last).
 *
 * @param {object[]} notes NoteData from extractNoteItem (may be empty for an
 *   errors-only ZIP)
 * @param {{ meta: object, errors?: Array, auditText?: string|null,
 *   batchIndex?: number, totalBatches?: number, partial?: boolean,
 *   variantSettings?: object, itemDir?: string }} options
 *   errors: ALL errors of the run, passed only to the last ZIP it writes
 *   variantSettings: where noteVariants reads the export* settings (default `settings`)
 *   takenStems: { notes, mindmaps } Sets of names earlier parts of the job used (runNotesJob)
 *   itemDir: folder of the note files ('notes/'; '' puts them next to the
 *   combined files)
 * @returns {Array<{path: string, data: string, title?: string, variant?: string, itemKind?: string}>}
 */
function buildNotesFiles(notes, { meta, errors = [], auditText = null, batchIndex = 1, totalBatches = 1, partial = false, variantSettings = settings, itemDir = 'notes/', takenStems = { notes: new Set(), mindmaps: new Set() } }) {
  const files = [];
  const indexFiles = []; // Track all files for _index.md

  // Separate notes and mindmaps
  const regularNotes = notes.filter(n => !n.isMindmap);
  const mindmaps = notes.filter(n => n.isMindmap);

  // Which versions to write (NLME.noteVariants): base always; code blocks
  // only if some note in this ZIP has quotes; with-images only if some note
  // has images. Otherwise those files would be identical to base.
  const NOTE_VERSION_INFO = {
    '': { fileSuffix: '', combinedSuffix: '', citationsCodeBlock: false, stripImages: true,
      title: 'Base (markdown, no images)', description: 'Citations rendered as markdown, images stripped' },
    '-code-blocks': { fileSuffix: '-code-blocks', combinedSuffix: '-code-blocks', citationsCodeBlock: true, stripImages: true,
      title: 'Code blocks (no images)', description: 'Citation quotes in code blocks, images stripped' },
    '-with-images': { fileSuffix: '-with-images', combinedSuffix: '-with-images', citationsCodeBlock: false, stripImages: false,
      title: 'With images (markdown)', description: 'Citations rendered as markdown, with base64 images' }
  };
  const hasQuotes = notes.some(n => (n.sources || []).some(src => src.quote && src.quote.trim()));
  const hasImages = notes.some(n => NLME.noteHasImages(n)); // body or citation quotes
  const versions = NLME.noteVariants(variantSettings, { hasQuotes, hasImages })
    .map(v => ({ ...NOTE_VERSION_INFO[v.suffix], variant: variantName(v.suffix) }));

  // Process regular notes (all versions in single notes/ folder with
  // suffixes); every variant of one note shares one stem, and no stem may
  // equal another note's stem+variant name
  if (regularNotes.length > 0) {
    // Next to the package files (itemDir ''), no note may take the name of
    // errors.md, _audit.md or a combined-notes file
    const reserved = itemDir ? [] : ['errors', '_index', '_audit', ...versions.map(v => `combined-notes${v.combinedSuffix}`)];
    const stems = NLME.uniqueStems(regularNotes.map(n => n.title),
      versions.map(v => v.fileSuffix).filter(Boolean), reserved, { obsidian: !!settings.obsidianNames, taken: takenStems.notes });

    versions.forEach(version => {
      // Individual note files with version suffix
      regularNotes.forEach((note, idx) => {
        // Generate markdown with appropriate settings
        // Use skipTitleIfPresent=true to avoid duplicate titles
        let markdown = convertToMarkdown(
          note.html,
          note.sources,
          note.title,
          version.citationsCodeBlock,
          true, // skipTitleIfPresent
          null,
          true,
          settings.citationDetail === 'none',
          settings.citationStyle
        );

        // Strip images, or embed the ones extractNoteItem downloaded
        markdown = version.stripImages ? stripImagesFromMarkdown(markdown) : NLME.applyImageEmbeds(markdown, note.imageEmbeds);

        const path = `${itemDir}${stems[idx]}${version.fileSuffix}.md`;
        files.push({
          path,
          data: noteFrontMatter(meta, { title: note.title, variant: version.variant }) + markdown,
          title: note.title,
          variant: version.variant,
          itemKind: 'note'
        });
        indexFiles.push({
          path,
          title: note.title,
          version: version.title,
          versionDescription: version.description,
          itemType: 'Notes',
          kind: 'note'
        });
      });

      // Combined markdown file for this version
      let combinedMarkdown = noteFrontMatter(meta, { title: `Notes — ${meta.notebook}`, kind: 'combined-notes', variant: version.variant });
      combinedMarkdown += `# Notes — ${meta.notebook}\n\n`;
      combinedMarkdown += `Exported: ${new Date().toLocaleString()}\n\n`;
      combinedMarkdown += `Total Notes: ${regularNotes.length}\n`;
      combinedMarkdown += `Version: ${version.title}\n\n`;
      combinedMarkdown += '---\n\n';

      regularNotes.forEach((note, idx) => {
        // Re-convert with unique noteId to prevent citation anchor collisions
        const noteId = idx + 1;
        let noteMarkdown = convertToMarkdown(
          note.html,
          note.sources,
          note.title,
          version.citationsCodeBlock,
          false, // skipTitleIfPresent
          noteId, // unique ID for this note's anchors
          true,
          settings.citationDetail === 'none',
          settings.citationStyle
        );

        // Strip images, or embed the ones extractNoteItem downloaded
        noteMarkdown = version.stripImages ? stripImagesFromMarkdown(noteMarkdown) : NLME.applyImageEmbeds(noteMarkdown, note.imageEmbeds);

        combinedMarkdown += noteMarkdown + '\n\n';
        if (idx < regularNotes.length - 1) {
          combinedMarkdown += '---\n\n';
        }
      });

      const combinedFilename = `combined-notes${version.combinedSuffix}.md`;
      files.push({
        path: combinedFilename,
        data: combinedMarkdown,
        title: `Combined Notes - ${version.title}`,
        variant: version.variant,
        itemKind: 'combined-notes'
      });
      indexFiles.push({
        path: combinedFilename,
        title: `Combined Notes - ${version.title}`,
        version: version.title,
        versionDescription: version.description,
        itemType: 'Notes',
        kind: 'combined'
      });
    });
  }

  // Mind map SVG, JSON and interactive HTML files
  if (mindmaps.length > 0) {
    const stems = NLME.uniqueStems(mindmaps.map(m => m.title), [], [], { obsidian: !!settings.obsidianNames, taken: takenStems.mindmaps });

    mindmaps.forEach((mindmap, idx) => {
      const base = `mind-maps/${stems[idx]}`;
      const entries = [
        [`${base}.svg`, mindmap.svgContent, `${mindmap.title} (SVG)`],
        [`${base}.json`, JSON.stringify(mindmap.treeData, null, 2), `${mindmap.title} (JSON)`],
        [`${base}.html`, generateMindmapHTMLSync(mindmap.svgContent, mindmap.title), `${mindmap.title} (Interactive HTML)`]
      ];
      for (const [path, data, indexTitle] of entries) {
        files.push({ path, data, title: mindmap.title, itemKind: 'mindmap' });
        indexFiles.push({ path, title: indexTitle });
      }
    });
  }

  // errors.md when the caller passes errors (it passes ALL errors to the
  // last ZIP the run writes: the final batch, or the one it ended in)
  if (errors.length > 0) {
    files.push({
      path: 'errors.md',
      data: NLME.buildErrorReport({
        title: 'Notes Export',
        generatedAt: new Date().toLocaleString(),
        errors
      })
    });
    indexFiles.push({ path: 'errors.md', title: 'Export Errors' });
  }

  if (auditText) {
    files.push({ path: '_audit.md', data: auditText });
  }

  // Generate _index.md with links to all files
  let indexContent = NLME.categoryIndexFrontMatter(meta, { title: `Notes — ${meta.notebook}`, category: 'notes', part: totalBatches > 1 ? batchIndex : undefined }) +
    `# Notes — ${meta.notebook}\n\n`;
  indexContent += `Generated: ${new Date().toLocaleString()}\n\n`;

  if (totalBatches > 1) {
    indexContent += `**Part ${batchIndex} of ${totalBatches}**\n\n`;
  }

  indexContent += `Total Notes: ${regularNotes.length}\n`;
  indexContent += `Total Mindmaps: ${mindmaps.length}\n`;
  indexContent += `Total Files: ${indexFiles.length}\n\n`;
  indexContent += '---\n\n';

  // Generate Notes section (with versions)
  if (regularNotes.length > 0) {
    indexContent += `# Notes\n\n`;
    indexContent += `Total: ${regularNotes.length}\n`;
    indexContent += `Versions: ${versions.length}\n\n`;

    // Combined files section
    const combinedFiles = indexFiles.filter(f => f.kind === 'combined');
    if (combinedFiles.length > 0) {
      indexContent += `## Combined Notes (All in One File)\n\n`;
      indexContent += `Available in ${combinedFiles.length} version(s):\n\n`;
      combinedFiles.forEach(file => {
        indexContent += `- **[${file.title}](${encodeURI(file.path)})**\n`;
        if (file.versionDescription) {
          indexContent += `  - ${file.versionDescription}\n`;
        }
      });
      indexContent += '\n';
    }

    // Individual notes section - grouped by note title
    const noteFiles = indexFiles.filter(f => f.kind === 'note');
    if (noteFiles.length > 0) {
      indexContent += `## Individual Notes\n\n`;
      indexContent += `All versions available in ${itemDir ? 'the `' + itemDir + '` folder' : 'this folder'} with suffixes:\n\n`;

      // Group by note title
      const notesByTitle = new Map();
      noteFiles.forEach(file => {
        if (!notesByTitle.has(file.title)) {
          notesByTitle.set(file.title, []);
        }
        notesByTitle.get(file.title).push(file);
      });

      // List each note with its versions
      notesByTitle.forEach((titleFiles, title) => {
        indexContent += `### ${title}\n\n`;
        titleFiles.forEach(file => {
          const versionLabel = file.version ? ` (${file.version})` : '';
          indexContent += `- [${file.path.split('/').pop()}](${encodeURI(file.path)})${versionLabel}\n`;
        });
        indexContent += '\n';
      });
    }
  }

  if (mindmaps.length > 0) {
    indexContent += '# Mindmaps\n\n';
    indexContent += `Total: ${mindmaps.length}\n\n`;
    indexFiles.filter(f => f.path.startsWith('mind-maps/')).forEach(file => {
      indexContent += `- [${file.title}](${encodeURI(file.path)})\n`;
    });
    indexContent += '\n';
  }

  if (errors.length > 0) {
    indexContent += '# Errors\n\n';
    const errorFile = indexFiles.find(f => f.path === 'errors.md');
    if (errorFile) {
      indexContent += `- [${errorFile.title}](${encodeURI(errorFile.path)})\n\n`;
    }
  }

  files.push({ path: '_index.md', data: indexContent + timingSummary() });
  files.push({
    path: '_index.html',
    data: NLME.buildIndexHtml({
      meta,
      heading: `Notes — ${meta.notebook}`,
      files,
      links: [
        { href: '_index.md', label: 'Markdown index' },
        ...(errors.length > 0 ? [{ href: 'errors.md', label: 'Errors' }] : []),
        ...(auditText ? [{ href: '_audit.md', label: 'Audit' }] : [])
      ]
    })
  });

  // manifest.json last: it lists every file above (not itself)
  files.push({
    path: 'manifest.json',
    data: JSON.stringify(NLME.buildManifest({
      meta,
      kind: 'notes',
      part: batchIndex,
      totalParts: totalBatches,
      partial,
      files,
      counts: { notes: regularNotes.length, mindmaps: mindmaps.length },
      errorCount: errors.length
    }), null, 2)
  });

  return files;
}
