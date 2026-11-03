// The shared file writer and export shell behind every export (Milestone 3a).
//
// saveFiles / fetchDownload: one way to write files (one ZIP, a Downloads
// subfolder, or single downloads). withExportShell: the pre-flight, progress,
// cancel, outcome-toast and cleanup every export needs, written once.
// runFullTakeout: the whole notebook (sources, notes, chat, artifacts) in one
// shell, through the per-category runners in sidebar.js (runSourcesJob, ...).
//
// Classic script loaded after sidebar.js: it calls sidebar.js functions
// (generateZipTimed, getProjectName, showDOMWarningDialog, showToast,
// downloadBlob) at call time, and sidebar.js calls saveFiles.

// Tab of the running export shell; fetchDownload uses it for the FETCH_FILE
// fallback when no tabId is passed. One job runs at a time (job lock).
let activeShellTabId = null;

// Decode the content script's base64 FETCH_FILE payload into a Blob.
function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/**
 * Fetch a Gemini Notebook download URL as a Blob.
 * Refuses hosts outside NLME.isAllowedDownloadUrl. Tries the side panel's own
 * fetch first; if that fails (CORS, auth), asks the content script to fetch it
 * with the page's credentials (FETCH_FILE).
 *
 * @param {string} url
 * @param {{ tabId?: number }} [options] tab whose content script serves the
 *   fallback; defaults to the running export shell's tab, then the active tab
 * @returns {Promise<Blob>}
 * @throws {Error} 'Fetch failed: <reason>' when both attempts fail
 */
async function fetchDownload(url, { tabId } = {}) {
  if (!NLME.isAllowedDownloadUrl(url)) {
    throw new Error('Fetch failed: not a Gemini Notebook download URL');
  }

  let directReason;
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (response.ok) return await response.blob();
    directReason = `HTTP ${response.status}`;
  } catch (error) {
    directReason = error.message || String(error);
  }

  // Fallback: the content script fetches with the page's credentials
  let fallbackReason;
  try {
    let targetTab = tabId ?? activeShellTabId;
    if (targetTab == null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTab = tab?.id;
    }
    if (targetTab == null) throw new Error('no notebook tab');
    const result = await chrome.tabs.sendMessage(targetTab, { type: 'FETCH_FILE', url });
    if (result && result.success && result.data != null) {
      return base64ToBlob(result.data, result.mime);
    }
    fallbackReason = (result && result.error) || 'no data';
  } catch (error) {
    fallbackReason = error.message || String(error);
  }
  throw new Error(`Fetch failed: ${directReason}; page fetch: ${fallbackReason}`);
}

// Blob for a data entry (string, Blob or Uint8Array). Strings and bytes get a
// type from the path so Chrome keeps the suggested extension; a Blob (fetched
// media) already carries its type.
function entryBlob(entry) {
  const data = entry.data;
  return data instanceof Blob ? data : new Blob([data], { type: NLME.mimeForPath(entry.path) });
}

// Save one Blob to Downloads/<target> through chrome.downloads. Register the
// name first: Chrome drops `filename` while the background's
// onDeterminingFilename listener exists.
async function downloadBlobToFolderPath(blob, target) {
  const blobUrl = URL.createObjectURL(blob);
  try {
    await chrome.runtime.sendMessage({ type: 'NAME_NEXT_DOWNLOAD', url: blobUrl, filename: target });
    await chrome.downloads.download({ url: blobUrl, filename: target, conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

// Have the background download a url entry to Downloads/<target>.
async function downloadUrlTo(entry, target) {
  const response = await chrome.runtime.sendMessage({
    type: 'DIRECT_DOWNLOAD_URL',
    url: entry.url,
    filename: target
  });
  if (!response || !response.success) {
    throw new Error(`Download failed for ${entry.path}: ${(response && response.error) || 'no response'}`);
  }
}

/**
 * Write files: one ZIP, a Downloads subfolder, or single downloads.
 *
 * FileEntry: { path, data } or { path, url }. `data` is a string, Blob or
 * Uint8Array; `url` is a Gemini Notebook download URL fetched with
 * fetchDownload (ZIP) or downloaded by the background (folder, single).
 *
 * - zipName set: one ZIP via JSZip, downloaded with downloadBlob. Strings are
 *   DEFLATEd; Blob/Uint8Array (media, already compressed) are STOREd.
 * - folder set (no zipName): each entry is saved to Downloads/<folder>/<path>.
 * - neither: each entry is a single download to Downloads/<path>: data via
 *   downloadBlob, url via the background (DIRECT_DOWNLOAD_URL streams large
 *   media to disk and fixes the extension from the real download).
 *
 * @param {Array<{path: string, data?: string|Blob|Uint8Array, url?: string}>} files
 * @param {{ zipName?: string, folder?: string }} [options]
 * @returns {Promise<{ saved: number, zipped: boolean }>}
 */
async function saveFiles(files, { zipName, folder } = {}) {
  if (zipName) {
    const zip = new JSZip();
    for (const entry of files) {
      let data = entry.data;
      if (data === undefined && entry.url) data = await fetchDownload(entry.url);
      if (typeof data === 'string') {
        zip.file(entry.path, data, { compression: 'DEFLATE' });
      } else {
        zip.file(entry.path, data, { compression: 'STORE' });
      }
    }
    const blob = await generateZipTimed(zip);
    await downloadBlob(blob, zipName);
    return { saved: files.length, zipped: true };
  }

  if (folder) {
    let saved = 0;
    for (const entry of files) {
      const target = NLME.downloadFolderPath(folder, entry.path);
      if (entry.data !== undefined) {
        await downloadBlobToFolderPath(entryBlob(entry), target);
      } else {
        await downloadUrlTo(entry, target);
      }
      saved++;
    }
    return { saved, zipped: false };
  }

  let saved = 0;
  for (const entry of files) {
    if (entry.data !== undefined) {
      await downloadBlob(entryBlob(entry), entry.path);
    } else {
      await downloadUrlTo(entry, entry.path);
    }
    saved++;
  }
  return { saved, zipped: false };
}

/**
 * The shared wrapper around every export: pre-flight, progress, cancel,
 * outcome (results panel), cleanup. Runs `run(shell)` once.
 *
 * shell = {
 *   tab, projectName, timestamp, meta,
 *   isCancelled()              // true after Cancel (overlay or side panel)
 *   progress(text, fraction)   // fraction 0..1: side-panel bar + page overlay
 *   finish({ kind, selected, result, auditOk = true, stoppedMessage, errorNote, saved = [], retry = null })
 *                              // Shows the outcome in the results panel
 *                              // (showResults), not a toast.
 *                              // result: { exported, failed, cancelled,
 *                              // errors }; stoppedMessage replaces the
 *                              // outcome line (level error) when the
 *                              // extension stopped the job itself; the
 *                              // errors are listed either way
 *                              // errorNote ('2 citation error(s), see
 *                              // errors.md'): errors on items that were
 *                              // still exported; appended in brackets and
 *                              // raises success to warning (not on cancel)
 *                              // saved: ZIP names or the Downloads folder
 *                              // retry: { count, run } for "Retry N failed"
 *                              // (runFullTakeout builds its own results panel
 *                              // and does not call finish)
 * }
 *
 * @param {{ label: string, healthType?: string, preflight?: string, overlayMessage?: string, tabId?: number }} options
 *   label names the export in logs; healthType ('notes', 'sources', ...) runs
 *   the DOM health check first; preflight ('chat') shows preflightWarn's
 *   toast after the tab lookup; tabId: the tab the items were scanned on
 *   (Download All, every Retry), used instead of the active tab, also for
 *   shell.meta (notebook title and URL). Omitted: the active tab.
 * @param {(shell: object) => Promise<void>} run
 */
async function withExportShell({ label, healthType, preflight, overlayMessage, tabId: requestedTabId }, run) {
  let tab = null;
  let overlayShown = false;
  let panelShown = false;
  let cancelled = false;
  let cancelListener = null;

  const progressPanel = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  // A new export replaces the last one's results
  hideResults();

  try {
    // The tab the caller scanned (tabId), else the one in front. Everything below
    // (project name, URL, health check, overlay) comes from this tab
    tab = requestedTabId != null ? await chrome.tabs.get(requestedTabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

    // Pre-flight warning (the DOM-health type, e.g. 'chat'): after the tab lookup, inside
    // the shell, so its cleanup covers it
    if (preflight) await preflightWarn(tab.id, preflight);

    // Project name and timestamp once (same for every batch)
    const projectName = await getProjectName(tab.id);
    const timestamp = NLME.exportTimestamp();
    const meta = NLME.exportMeta({
      notebookTitle: projectName,
      tabUrl: tab.url,
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date()
    });
    console.log(`[NotebookLM Takeout] Starting ${label} export. Timestamp:`, timestamp, 'Project:', projectName);

    // Reset DOM tracker and run the pre-export health check
    if (healthType) {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESET_DOM_TRACKER' });
      const healthCheck = await chrome.tabs.sendMessage(tab.id, {
        type: 'CHECK_DOM_HEALTH',
        data: { type: healthType }
      });
      if (healthCheck && !healthCheck.healthy) {
        const proceed = await showDOMWarningDialog(healthCheck.issues);
        if (!proceed) {
          showToast('Export cancelled', 'info');
          return;
        }
      }
    }

    // Overlay on the page
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_EXPORT_OVERLAY',
      message: overlayMessage || 'Preparing to export...'
    });
    overlayShown = true;

    // Progress panel in the side panel
    progressPanel.style.display = 'block';
    panelShown = true;
    progressText.textContent = 'Preparing export...';
    progressFill.style.width = '0%';

    // Listen for cancellation (overlay Cancel or side-panel Cancel)
    cancelListener = (message) => {
      if (message.type === 'CANCEL_EXPORT') cancelled = true;
    };
    chrome.runtime.onMessage.addListener(cancelListener);

    activeShellTabId = tab.id;
    const tabId = tab.id;

    const shell = {
      tab,
      projectName,
      timestamp,
      meta,
      isCancelled: () => cancelled,
      progress(text, fraction) {
        const percent = Math.max(0, Math.min(1, fraction || 0)) * 100;
        progressFill.style.width = `${percent}%`;
        progressText.textContent = text;
        chrome.tabs.sendMessage(tabId, {
          type: 'UPDATE_EXPORT_OVERLAY',
          message: text,
          progress: percent
        }).catch(() => {}); // overlay is cosmetic; never abort the job
      },
      finish({ kind, selected, result = {}, auditOk = true, stoppedMessage, errorNote, saved = [], retry = null } = {}) {
        // The outcome stays in the results panel; a stopped job's message
        // leads it, and the errors still follow
        const outcome = stoppedMessage
          ? { message: stoppedMessage, level: 'error' }
          : NLME.composeOutcome({ kind, selected, result, auditOk, errorNote });
        showResults({ message: outcome.message, level: outcome.level, saved, errors: result.errors || [], retry });
      }
    };

    await run(shell);
  } catch (error) {
    console.error(`${label} export failed:`, error);
    showToast('Export failed. Please try again.', 'error');
  } finally {
    if (cancelListener) chrome.runtime.onMessage.removeListener(cancelListener);
    activeShellTabId = null;

    // Hide page overlay
    if (overlayShown) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
      } catch (error) {
        console.error('[NotebookLM Takeout] Failed to hide overlay:', error);
      }
    }

    // Hide sidebar progress panel
    if (panelShown) progressPanel.style.display = 'none';
  }
}

// ---- Full Takeout (Milestone 3a) ----

// The ZIP setting: the Artifacts tab's Zip checkbox when that tab has been
// scanned (the checkbox is rendered with its results), else the saved setting
function takeoutZipEnabled() {
  const checkbox = document.getElementById('zip-checkbox');
  return checkbox ? checkbox.checked : !!settings.autoZip;
}

/**
 * One-click Full Takeout: a notebook's sources, notes, chat and artifacts in
 * one run and one layout: <root>/{sources,notes,chat,artifacts}/ plus
 * <root>/_index.md, manifest.json and errors.md (root = sanitized notebook
 * name). A category written in several batches has part-N/ folders.
 *
 * - ZIP on (takeoutZipEnabled): each category's batches go to
 *   <Notebook>-takeout-<category>-<ts>[-PARTIAL][-partNofM].zip, the root
 *   files to <Notebook>-takeout-index-<ts>.zip; unzipped into one folder
 *   they form one tree.
 * - ZIP off: everything goes to Downloads/<Notebook> takeout <ts>/; artifacts
 *   run in folder mode (CDN media straight to disk).
 *
 * Every category is scanned first (0 items: 'empty', nothing written; a scan
 * error: 'failed'; chat with only unreadable messages still runs, so they
 * reach errors.md), then runs on its own runner (runSourcesJob, runNotesJob,
 * runChatJob, runArtifactsJob) in that order, unchanged builders included.
 * Status after a runner: NLME.takeoutCategoryStatus. Cancel ends the current
 * category as 'partial' (its ZIP -PARTIAL), or (between categories) adds a
 * takeout-level note to errors.md, and marks every later one 'skipped'; the
 * root files are written anyway.
 *
 * One combined results panel at the end (showResults): shell.finish reports a
 * single category's outcome, so the takeout does not use it. It lists the ZIPs
 * (or the folder) and the combined errors, and offers "Retry N failed" for the
 * Sources, Notes and Artifacts items that failed (never chat). A retry is an
 * ordinary tab export of those items (own ZIPs or folders) on the tab the takeout
 * ran on; it does not rewrite the takeout or its index.
 */
async function runFullTakeout() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isNotebookUrl(tab?.url)) {
    showToast('Please open NotebookLM first', 'error');
    return;
  }
  // The shell's health check needs the content script (first action after a reload)
  try {
    await ensureContentScriptLoaded(tab.id);
  } catch (error) {
    console.error('[NotebookLM Takeout] Full Takeout: content script unavailable:', error);
    showToast('Export failed. Please refresh the NotebookLM page and try again.', 'error');
    return;
  }

  startExportTiming();
  const zipMode = takeoutZipEnabled();
  const citationMode = NLME.chatCitationMode(settings);
  // A takeout always includes the with-images versions, whatever the tab exports tick
  const variantSettings = NLME.takeoutVariantSettings(settings);

  await withExportShell({ label: 'takeout', healthType: 'notes', overlayMessage: 'Preparing Full Takeout...', tabId: tab.id }, async shell => {
    const tabId = shell.tab.id;
    const root = sanitizeFilename(shell.projectName);
    const folder = zipMode ? null : `${shell.projectName} takeout ${shell.timestamp}`;
    console.log(`[NotebookLM Takeout] Full Takeout (${zipMode ? 'ZIP' : `folder "${folder}"`})`);

    const categories = [
      {
        name: 'Sources', folder: 'sources',
        scan: async () => (await scanSourcesData(tabId)).sources,
        // itemDir '': the category folder is already sources/ (notes/), no second one inside it
        run: (catShell, items, target) => runSourcesJob(catShell, items, { ...target, variantSettings, itemDir: '' })
      },
      {
        name: 'Notes', folder: 'notes',
        scan: () => scanNotesData(tabId),
        run: (catShell, items, target) => runNotesJob(catShell, items, { ...target, variantSettings, itemDir: '' })
      },
      {
        name: 'Chat', folder: 'chat',
        scan: async () => {
          const chatData = await scanChatData(tabId);
          exportTimer.merge(lastChatScanTiming);
          return chatData;
        },
        // "0 of N" for a chat of only unreadable messages: N = messages on the page
        count: chatData => NLME.chatSelectedCount(chatData),
        // Messages that could not be read are not "none in notebook": the
        // job still runs and writes them to errors.md
        isEmpty: chatData => NLME.chatScanIsEmpty(chatData),
        run: (catShell, chatData, target) => runChatJob(catShell, chatData, { ...target, citationMode, forceZip: true, variantSettings })
      },
      {
        name: 'Artifacts', folder: 'artifacts',
        scan: async () => (await scanArtifactsData(tabId)).filter(item => !item.disabled),
        run: (catShell, items, target) => runArtifactsJob(catShell, items, { ...target, bothSlideFormats: true })
      }
    ].map(c => ({ ...c, status: null, selected: 0, exported: 0, failed: 0, zips: [], parts: 0, packages: 0, errors: [], auditOk: true, items: null, failedItems: [] }));
    const takeoutErrors = []; // not tied to one category
    // Set once a cancellation is on record (scan, a runner's own note, or
    // between categories): every later category is skipped
    let stopRest = false;

    // 1. Scan everything up front
    for (const [i, c] of categories.entries()) {
      if (shell.isCancelled()) {
        takeoutErrors.push({ type: 'cancelled', message: 'Cancelled by user during the scan; the remaining categories were skipped' });
        stopRest = true;
        break;
      }
      shell.progress(`Scanning ${c.name.toLowerCase()}…`, i / categories.length);
      try {
        c.items = await c.scan();
        c.selected = c.count ? c.count(c.items) : c.items.length;
        if (c.isEmpty ? c.isEmpty(c.items) : c.selected === 0) c.status = 'empty';
      } catch (error) {
        console.error(`[NotebookLM Takeout] Full Takeout: ${c.name} scan failed:`, error);
        c.status = 'failed';
        c.errors.push(`Scan failed: ${error.message || error}`);
      }
    }
    console.log('[NotebookLM Takeout] Full Takeout scan:', categories.map(c => `${c.name} ${c.selected}`).join(', '));

    // 2. One runner per category, in order; a cancel skips the rest
    for (const c of categories) {
      if (c.status) continue; // empty, or the scan failed
      if (stopRest || shell.isCancelled()) {
        if (!stopRest) {
          // Cancelled between two categories: no runner wrote a note
          takeoutErrors.push({ type: 'cancelled', message: `Cancelled by user before ${c.name.toLowerCase()}; the remaining categories were skipped` });
          stopRest = true;
        }
        c.status = 'skipped';
        c.items = null;
        continue;
      }
      const catShell = { ...shell, progress: (text, fraction) => shell.progress(`${c.name}: ${text}`, fraction) };
      // Filled by the runner as each package is saved: read after a throw too,
      // so the index still links the parts already written
      const written = newWritten();
      try {
        const out = await c.run(catShell, c.items, { pathPrefix: `${root}/${c.folder}/`, zipKind: `takeout-${c.folder}`, folder, written });
        c.exported = out.result.exported;
        c.failed = out.result.failed;
        c.errors.push(...out.errors);
        c.failedItems = out.result.failedItems || []; // small; kept past `c.items = null`, for Retry
        c.auditOk = out.auditOk;
        // Nothing exported but items failed or errors recorded (e.g. chat
        // messages that could not be read): 'failed', not "complete"
        c.status = NLME.takeoutCategoryStatus({
          selected: c.selected,
          exported: c.exported,
          failed: c.failed,
          errorCount: c.errors.length,
          cancelled: out.result.cancelled,
          stopped: out.result.stopped
        });
        if (out.result.cancelled) stopRest = true;
      } catch (error) {
        // A package that could not be written: this category fails, the
        // others still run
        console.error(`[NotebookLM Takeout] Full Takeout: ${c.name} failed:`, error);
        c.status = 'failed';
        c.errors.push(`Export failed: ${error.message || error}`);
      }
      c.zips = written.zips;
      c.parts = written.parts;
      c.packages = written.count;
      c.items = null; // free the scan data before the next category
    }

    // 3. Root files, also after a cancel
    const summary = categories.map(({ name, folder: catFolder, status, selected, exported, failed, zips, parts, packages }) =>
      ({ name, folder: catFolder, status, selected, exported, failed, zips, parts, packages }));
    const errors = [
      ...NLME.prefixExportErrors('Takeout', takeoutErrors),
      ...categories.flatMap(c => NLME.prefixExportErrors(c.name, c.errors))
    ];
    const cancelled = summary.some(c => c.status === 'partial' || c.status === 'skipped');
    const errorsFile = errors.length ? 'errors.md' : null;
    const rootFiles = [{
      path: '_index.md',
      data: NLME.buildRootIndex({ meta: shell.meta, categories: summary, errorsFile }) + timingSummary()
    }, {
      path: '_index.html',
      data: NLME.buildRootIndexHtml({ meta: shell.meta, categories: summary, errorsFile })
    }];
    if (errors.length) {
      rootFiles.push({
        path: 'errors.md',
        data: NLME.buildErrorReport({
          title: 'Takeout',
          generatedAt: new Date().toLocaleString(),
          errors,
          stats: Object.fromEntries(summary.map(c => [c.name, `${c.exported} of ${c.selected} (${c.status})`]))
        })
      });
    }
    rootFiles.push({
      path: 'manifest.json',
      data: JSON.stringify({
        ...NLME.buildManifest({
          meta: shell.meta,
          kind: 'takeout',
          partial: cancelled,
          files: rootFiles.slice(), // _index.md, _index.html, errors.md (not itself)
          counts: Object.fromEntries(summary.map(c => [c.folder, c.exported])),
          errorCount: errors.length
        }),
        categories: summary
      }, null, 2)
    });

    shell.progress('Writing the takeout index...', 1);
    let rootWritten = true;
    let indexZip = null;
    try {
      const placed = rootFiles.map(f => ({ ...f, path: `${root}/${f.path}` }));
      if (folder) {
        await saveFiles(placed, { folder });
      } else {
        const zipName = NLME.zipName({ notebook: shell.projectName, kind: 'takeout-index', timestamp: shell.timestamp, partial: cancelled });
        await saveFiles(placed, { zipName });
        indexZip = zipName;
      }
    } catch (error) {
      console.error('[NotebookLM Takeout] Full Takeout: root files failed:', error);
      rootWritten = false;
    }

    // 4. One results panel for the whole takeout
    let { message, level } = NLME.summarizeTakeoutOutcome({
      categories: summary.map((c, i) => ({ ...c, errorCount: categories[i].errors.length })),
      auditOk: categories.every(c => c.auditOk)
    });
    if (!rootWritten) {
      message += ' — the takeout index could not be written';
      if (level !== 'error') level = 'warning';
    }
    console.log('[NotebookLM Takeout] Full Takeout finished:', message);
    const saved = folder ? [folder] : [...categories.flatMap(c => c.zips), ...(indexZip ? [indexZip] : [])];

    // Retry: Sources, Notes and Artifacts items that failed (chat is never retried)
    const failedOf = name => categories.find(c => c.name === name).failedItems;
    const failedSources = failedOf('Sources');
    const failedNotes = failedOf('Notes');
    const failedArtifacts = failedOf('Artifacts');
    const retryCount = failedSources.length + failedNotes.length + failedArtifacts.length;
    showResults({
      message,
      level,
      saved,
      errors,
      retry: retryCount > 0 ? {
        count: retryCount,
        // Each export replaces the panel, so the last one retried stays visible
        run: () => runExclusive('Retry failed', async () => {
          // On the tab the takeout scanned, not whichever tab is active now
          if (failedSources.length) await exportSources(failedSources, { tabId });
          if (failedNotes.length) await exportNotesAsMarkdown(failedNotes, { tabId });
          if (failedArtifacts.length) await downloadAllArtifacts(tabId, failedArtifacts);
        })
      } : null
    });
  });
}
