// The shared file writer and export shell behind every export (Milestone 3a).
//
// saveFiles / fetchDownload: one way to write files (one ZIP, a Downloads
// subfolder, or single downloads). withExportShell: the pre-flight, progress,
// cancel, results-panel outcome and cleanup every export needs, written once.
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
 * @param {{ tabId?: number, isAllowed?: Function, blobProblem?: Function, fallbackAfter?: Function }} [options]
 *   tabId: tab whose content script serves the fallback; defaults to the
 *   running export shell's tab, then the active tab
 *   isAllowed: replaces the host check
 *   blobProblem: blob => a reason to refuse it, or null. A refused blob counts
 *   as a failed attempt: refused direct, the fallback still runs.
 *   fallbackAfter: status => false to skip the fallback after that direct status
 * @returns {Promise<Blob>}
 * @throws {Error} 'Fetch failed: <reason>' when both attempts fail, with
 *   .status and .retryAfter from the last response that had a status
 */
async function fetchDownload(url, { tabId, isAllowed = NLME.isAllowedDownloadUrl, blobProblem = () => null, fallbackAfter = () => true } = {}) {
  if (!isAllowed(url)) {
    throw new Error('Fetch failed: not a Gemini Notebook download URL');
  }

  let directReason;
  let status;
  let retryAfter;
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (response.ok) {
      const blob = await response.blob();
      directReason = blobProblem(blob);
      if (!directReason) return blob;
    } else {
      directReason = `HTTP ${response.status}`;
      status = response.status;
      retryAfter = response.headers?.get('Retry-After') ?? null;
    }
  } catch (error) {
    directReason = error.message || String(error);
  }

  const failed = reason => Object.assign(new Error(`Fetch failed: ${directReason}; page fetch: ${reason}`), { status, retryAfter });
  if (status !== undefined && !fallbackAfter(status)) throw failed('not tried');

  // Fallback: the content script fetches with the page's credentials
  let fallbackReason;
  try {
    let targetTab = tabId ?? activeShellTabId;
    if (targetTab == null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTab = tab?.id;
    }
    if (targetTab == null) throw new Error('no notebook tab');
    const result = await chrome.tabs.sendMessage(targetTab, { type: NLME.MSG.FETCH_FILE, url });
    if (result && result.success && result.data != null) {
      const blob = base64ToBlob(result.data, result.mime);
      fallbackReason = blobProblem(blob);
      if (!fallbackReason) return blob;
    } else {
      fallbackReason = (result && result.error) || 'no data';
      if (result && result.status !== undefined) {
        status = result.status;
        retryAfter = result.retryAfter ?? null;
      }
    }
  } catch (error) {
    fallbackReason = error.message || String(error);
  }
  throw failed(fallbackReason);
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
    await chrome.runtime.sendMessage({ type: NLME.MSG.NAME_NEXT_DOWNLOAD, url: blobUrl, filename: target });
    await chrome.downloads.download({ url: blobUrl, filename: target, conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

// Have the background download a url entry to Downloads/<target>. Returns
// the Chrome download id (null if the background did not report one).
async function downloadUrlTo(entry, target) {
  const response = await chrome.runtime.sendMessage({
    type: NLME.MSG.DIRECT_DOWNLOAD_URL,
    url: entry.url,
    filename: target
  });
  if (!response || !response.success) {
    throw new Error(`Download failed for ${entry.path}: ${(response && response.error) || 'no response'}`);
  }
  return response.downloadId ?? null;
}

// The size of a finished download, read from chrome.downloads (fileSize), for
// the manifest of a folder-mode export. Polls until the download completes,
// is interrupted or is gone, up to timeoutMs. Never rejects and never blocks
// a job: null means "not available" (the manifest keeps null, as before).
async function downloadSizeWhenDone(downloadId, { timeoutMs = 120000, intervalMs = 500 } = {}) {
  if (downloadId == null) return null;
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [item] = await chrome.downloads.search({ id: downloadId });
      const status = NLME.downloadSizeStatus(item);
      if (status.done) return status.bytes;
      if (Date.now() >= deadline) return null;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not read a download size:', error);
    return null;
  }
}

// Where a URL download really landed: its path with the name Chrome gave it,
// once Chrome has settled that. Falls back to the planned path; never rejects.
async function landedUrlPath(path, downloadId, { timeoutMs = 3000, intervalMs = 100 } = {}) {
  if (downloadId == null) return path;
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (!item || item.filename || item.state === 'interrupted') return NLMEViewer.landedPath(path, item && item.filename);
      if (Date.now() >= deadline) return path;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not read a download name:', error);
    return path;
  }
}

// Tell the capture about a saved file. Its trouble is never the save's.
function reportSaved(capture, path, data) {
  try {
    capture(path, typeof data === 'string' ? data : null);
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not capture a file for the viewer:', error);
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
 * capture (Full Takeout only): called with (path, text|null) for each entry once
 * it is saved, with the path it landed on; text for string data, else null. In ZIP
 * mode that is after the ZIP is saved, so a failed ZIP captures nothing.
 *
 * @param {Array<{path: string, data?: string|Blob|Uint8Array, url?: string}>} files
 * @param {{ zipName?: string, folder?: string, capture?: ((path: string, text: string|null) => void)|null }} [options]
 * @returns {Promise<{ saved: number, zipped: boolean, sizes?: Array<Promise<number|null>|undefined> }>}
 *   sizes (folder mode): per entry, in order, a promise of the downloaded file's
 *   size for url entries (downloadSizeWhenDone; resolves null when unknown),
 *   undefined for data entries. Not awaited here: downloads finish on their own.
 */
async function saveFiles(files, { zipName, folder, capture = null } = {}) {
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
    if (capture) for (const entry of files) reportSaved(capture, entry.path, entry.data);
    return { saved: files.length, zipped: true };
  }

  if (folder) {
    let saved = 0;
    const sizes = [];
    for (const entry of files) {
      const target = NLME.downloadFolderPath(folder, entry.path);
      if (entry.data !== undefined) {
        await downloadBlobToFolderPath(entryBlob(entry), target);
        sizes.push(undefined);
        if (capture) reportSaved(capture, entry.path, entry.data);
      } else {
        const downloadId = await downloadUrlTo(entry, target);
        sizes.push(downloadSizeWhenDone(downloadId));
        if (capture) reportSaved(capture, await landedUrlPath(entry.path, downloadId), null);
      }
      saved++;
    }
    return { saved, zipped: false, sizes };
  }

  let saved = 0;
  for (const entry of files) {
    if (entry.data !== undefined) {
      await downloadBlob(entryBlob(entry), entry.path);
      if (capture) reportSaved(capture, entry.path, entry.data);
    } else {
      const downloadId = await downloadUrlTo(entry, entry.path);
      if (capture) reportSaved(capture, await landedUrlPath(entry.path, downloadId), null);
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
 *   finishing()                // the rest cannot be cancelled: no Cancel button
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
 *                              // Returns the outcome { kind, selected, message,
 *                              // level, result, saved, errors }
 * }
 *
 * Returns what `run` returns (the export functions return shell.finish's
 * outcome, so a chained retry can combine them), or { declined: true } when
 * the user declined the DOM-health dialog, or { aborted: true } when the tab
 * was gone or the export threw (a toast says so). Callers that ignore the
 * return value are unaffected.
 *
 * @param {{ label: string, healthType?: string, preflight?: string, overlayMessage?: string, tabId?: number }} options
 *   label names the export in logs; healthType ('notes', 'sources', ...) runs
 *   the DOM health check first; preflight ('chat') shows preflightWarn's
 *   toast after the tab lookup; tabId: the tab the items were scanned on
 *   (the Generated action, every Retry), used instead of the active tab, also for
 *   shell.meta (notebook title and URL). Omitted: the active tab.
 * @param {(shell: object) => Promise<any>} run
 * @returns {Promise<any>} see above
 */
async function withExportShell({ label, healthType, preflight, overlayMessage, tabId: requestedTabId }, run) {
  let tab = null;
  let overlayShown = false;
  let panelShown = false;
  let cancelled = false;
  let finishingStarted = false;
  const cancelBtn = document.getElementById('cancel-download-btn');
  let cancelListener = null;
  let outcome;

  const progressPanel = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  try {
    // The tab the caller scanned (tabId), else the one in front. Everything below
    // (project name, URL, health check, overlay) comes from this tab
    try {
      tab = requestedTabId != null ? await chrome.tabs.get(requestedTabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    } catch (error) {
      tab = null; // a closed tab: chrome.tabs.get rejects
    }
    if (!tab || (requestedTabId != null && !isNotebookUrl(tab.url))) {
      // Before hideResults: a retry on a closed tab keeps the panel and its Retry button
      showToast(requestedTabId != null
        ? 'The notebook tab for this export is closed. Open it and try again.'
        : 'Please open NotebookLM first', 'error');
      return { aborted: true };
    }

    // A new export replaces the last one's results (only once the tab is known to be there)
    hideResults();

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
      await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.RESET_DOM_TRACKER });
      // The Studio list is not in the page while a note is open: the check
      // would warn, and a takeout would scan no notes and no artifacts
      if (healthType === 'notes') {
        await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.NAVIGATE_BACK })
          .catch(error => console.warn('[NotebookLM Takeout] Could not close the open viewer:', error.message));
      }
      const healthCheck = await chrome.tabs.sendMessage(tab.id, {
        type: NLME.MSG.CHECK_DOM_HEALTH,
        data: { type: healthType }
      });
      if (healthCheck && !healthCheck.healthy) {
        const proceed = await showDOMWarningDialog(healthCheck.issues);
        if (!proceed) {
          showToast('Export cancelled', 'info');
          return { declined: true };
        }
      }
    }

    // Overlay on the page
    await chrome.tabs.sendMessage(tab.id, {
      type: NLME.MSG.SHOW_EXPORT_OVERLAY,
      message: overlayMessage || 'Preparing to export...'
    });
    overlayShown = true;

    // Progress panel in the side panel
    progressPanel.style.display = 'block';
    progressPanel.scrollIntoView({ block: 'nearest' }); // it sits below a long list
    panelShown = true;
    progressText.textContent = 'Preparing export...';
    progressFill.style.width = '0%';

    // Listen for cancellation (overlay Cancel or side-panel Cancel)
    cancelListener = (message) => {
      if (message.type === NLME.MSG.CANCEL_EXPORT) cancelled = true;
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
      // The final save runs to the end, so an unfinished takeout still has its
      // index: take Cancel away rather than leave a button that does nothing
      finishing() {
        finishingStarted = true;
        cancelBtn.disabled = true;
        cancelBtn.title = 'Finishing: saving what was exported';
        chrome.tabs.sendMessage(tabId, { type: NLME.MSG.UPDATE_EXPORT_OVERLAY, hideCancel: true }).catch(() => {});
      },
      progress(text, fraction) {
        const percent = Math.max(0, Math.min(1, fraction || 0)) * 100;
        progressFill.style.width = `${percent}%`;
        progressText.textContent = text;
        chrome.tabs.sendMessage(tabId, {
          type: NLME.MSG.UPDATE_EXPORT_OVERLAY,
          message: text,
          progress: percent
        }).catch(() => {}); // overlay is cosmetic; never abort the job
      },
      finish({ kind, selected, result = {}, auditOk = true, stoppedMessage, errorNote, saved = [], retry = null } = {}) {
        // The outcome stays in the results panel; a stopped job's message
        // leads it, and the errors still follow
        const composed = stoppedMessage
          ? { message: stoppedMessage, level: 'error' }
          : NLME.composeOutcome({ kind, selected, result, auditOk, errorNote });
        const errors = result.errors || [];
        showResults({ message: composed.message, level: composed.level, saved, errors, retry });
        return { kind, selected, message: composed.message, level: composed.level, result, saved, errors };
      }
    };

    outcome = await run(shell);
  } catch (error) {
    console.error(`${label} export failed:`, error);
    showToast('Export failed. Please try again.', 'error');
    outcome = { aborted: true };
  } finally {
    if (cancelListener) chrome.runtime.onMessage.removeListener(cancelListener);
    activeShellTabId = null;

    // Hide page overlay
    if (overlayShown) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.HIDE_EXPORT_OVERLAY });
      } catch (error) {
        console.error('[NotebookLM Takeout] Failed to hide overlay:', error);
      }
    }

    if (finishingStarted) {
      cancelBtn.disabled = false;
      cancelBtn.title = 'Cancel';
    }

    // Hide sidebar progress panel
    if (panelShown) progressPanel.style.display = 'none';
  }
  return outcome;
}

// ---- Full Takeout (Milestone 3a) ----

// Home's Export everything: the sheet, then the run on what it chose. Each count is
// what Home knows; chat is known only once loaded.
function openExportEverythingSheet() {
  openExportSheet({
    title: 'Export everything',
    counts: NLME.homeEstimateCounts(_tabCounts, window._currentChatData?.messagePairs?.length),
    offerSaveAs: true,
    start: ({ overrides, zip }) => runExclusive('Export everything', () => withRunSettings(overrides, () => runFullTakeout({ zip })))
  });
}

const VIEWER_FILE = 'viewer.html';
const VIEWER_ERROR = { type: 'viewer', message: 'The offline viewer could not be built' };
const IMAGES_ERROR = { type: 'viewer', message: 'Some images for the offline viewer could not be saved' };

// viewer.html for the files captured so far. The side panel reads its own packaged
// files, which needs no permission. Links are relative to the takeout root.
// savedImages: the images/ paths that exist; other image links are left out.
// The notebook's emoji for the viewer's cover; none is not a failure
async function getNotebookEmoji(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.GET_NOTEBOOK_EMOJI });
    return response?.emoji || '';
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not read the notebook emoji:', error.message);
    return '';
  }
}

async function buildViewerHtml(files, meta, savedImages = new Set()) {
  const [template, app, marked, katex, css] = await Promise.all(NLMEViewer.VIEWER_ASSETS.map(async asset => {
    const response = await fetch(chrome.runtime.getURL(asset));
    if (!response.ok) throw new Error(`${asset}: HTTP ${response.status}`);
    return response.text();
  }));
  const data = NLMEViewer.buildViewerData(files, { notebook: meta.notebook, exported: meta.exported, savedImages, emoji: meta.emoji });
  return NLMEViewer.assembleViewer({ template, css, marked, katex, app, data });
}

// Image files into ZIPs of about maxBytes (Blobs, as artifacts are; a ZIP may pass the
// cap by one image).
function imageZipBatches(entries, maxBytes) {
  const batches = [];
  let bytes = Infinity;
  for (const entry of entries) {
    if (bytes >= maxBytes) { batches.push([]); bytes = 0; }
    batches[batches.length - 1].push(entry);
    bytes += entry.data.size;
  }
  return batches;
}

/**
 * Save a takeout's images: into the folder, or into ZIPs named by zipNameFor. Saved
 * first of the root files, so the viewer links only what is really there. Folder mode
 * saves one image per call and ZIP mode one batch per ZIP; a save that fails is logged
 * here and costs only its own image or ZIP.
 *
 * @param {Map<string, Blob>} images images/ path -> bytes
 * @param {{ root: string, folder: string|null, zipNameFor: (part: number, totalParts: number) => string }} target
 * @returns {Promise<{ paths: Set<string>, zips: string[], failed: boolean }>} the images/ paths saved
 */
async function saveTakeoutImages(images, { root, folder, zipNameFor }) {
  const paths = new Set();
  const zips = [];
  let failed = false;
  const entries = [...images].map(([path, data]) => ({ path: `${root}/${path}`, data }));
  const capture = path => paths.add(path.slice(root.length + 1));
  const batches = folder ? entries.map(e => [e]) : imageZipBatches(entries, ARTIFACT_ZIP_MAX_BYTES);
  for (const [i, batch] of batches.entries()) {
    if (!batch.length) continue;
    try {
      const zipName = folder ? null : zipNameFor(i + 1, batches.length);
      await saveFiles(batch, folder ? { folder, capture } : { zipName, capture });
      if (zipName) zips.push(zipName);
    } catch (error) {
      console.error('[NotebookLM Takeout] Full Takeout: images failed:', error);
      failed = true;
    }
  }
  return { paths, zips, failed };
}

// The files at a takeout's root. viewerHtml null: no viewer, and nothing names one.
function takeoutRootFiles({ meta, summary, errors, partial, viewerHtml }) {
  const viewerFile = viewerHtml === null ? null : VIEWER_FILE;
  const errorsFile = errors.length ? 'errors.md' : null;
  const rootFiles = [{
    path: '_index.md',
    data: NLME.buildRootIndex({ meta, categories: summary, errorsFile, viewerFile }) + timingSummary()
  }, {
    path: '_index.html',
    data: NLME.buildRootIndexHtml({ meta, categories: summary, errorsFile, viewerFile })
  }];
  if (viewerFile) rootFiles.push({ path: viewerFile, data: viewerHtml });
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
        meta,
        kind: 'takeout',
        partial,
        files: rootFiles.slice(), // _index.md, _index.html, viewer.html, errors.md (not itself)
        counts: Object.fromEntries(summary.map(c => [c.folder, c.exported])),
        errorCount: NLME.countExportErrors(errors)
      }),
      categories: summary
    }, null, 2)
  });
  return rootFiles;
}

/**
 * One-click Full Takeout: a notebook's sources, notes, chat and artifacts in
 * one run and one layout: <root>/{sources,notes,chat,artifacts}/ plus
 * <root>/images/, _index.md, viewer.html, manifest.json and errors.md (root = sanitized
 * notebook name). A category written in several batches has part-N/ folders.
 *
 * - zip true: each category's batches go to
 *   <Notebook>-takeout-<category>-<ts>[-PARTIAL][-partNofM|-partN].zip, images to
 *   <Notebook>-takeout-images-<ts>[-PARTIAL][-partNofM].zip, the root files to
 *   <Notebook>-takeout-index-<ts>.zip; unzipped into one folder they form one tree.
 * - zip false: everything goes to Downloads/<Notebook> takeout <ts>/; artifacts
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
 * viewer.html (offline viewer) is built from what the runners saved: a capture
 * through the target notes each file as saveFiles writes it. A failed build or
 * save is an errors.md line and a warning, never a failed takeout: the other root
 * files are written without naming the viewer. A cancelled takeout gets a viewer
 * of what exists.
 *
 * Images embedded in the -with-images files become files in images/, not data in
 * viewer.html: the capture keeps them as Blobs, they are saved before the viewer is
 * built, and the viewer links only those that were saved. Images that fail follow the
 * same rule; the viewer shows a placeholder there. If the viewer fails after that,
 * the images stay as plain files nothing links.
 *
 * One combined results panel at the end (showResults): shell.finish reports a
 * single category's outcome, so the takeout does not use it. It lists the ZIPs
 * (or the folder) and the combined errors, and offers "Retry N failed" for the
 * Sources, Notes and Artifacts items that failed (never chat). A retry is an
 * ordinary tab export of those items (own ZIPs or folders) on the tab the takeout
 * ran on; it does not rewrite the takeout or its index. It marks its items on the
 * takeout's job record (updateRecord) without replacing it.
 *
 * It reads `settings` directly and wraps nothing itself: the caller runs it through
 * withRunSettings, which is what turns the image copies on under Archive. zip: the
 * export sheet's Save as, for this run only.
 *
 * @param {{ zip?: boolean }} [options]
 */
async function runFullTakeout({ zip = NLME.takeoutZipChoice(settings) } = {}) {
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
  const zipMode = zip;
  const citationMode = NLME.chatCitationMode(settings);

  await withExportShell({ label: 'takeout', healthType: 'notes', overlayMessage: 'Preparing to export everything...', tabId: tab.id }, async shell => {
    const tabId = shell.tab.id;
    const root = NLME.fileStem(shell.projectName, { obsidian: !!settings.obsidianNames });
    // Obsidian-friendly names also cover the folder (its name is part of every link path)
    const folderName = settings.obsidianNames ? (NLME.obsidianSafeName(shell.projectName) || 'notebook') : shell.projectName;
    const folder = zipMode ? null : NLME.takeoutFolderName(folderName, shell.timestamp);
    console.log(`[NotebookLM Takeout] Full Takeout (${zipMode ? 'ZIP' : `folder "${folder}"`})`);

    const categories = [
      {
        name: 'Sources', folder: 'sources',
        scan: async () => {
          const sources = (await scanSourcesData(tabId)).sources;
          stampJobKeys('sources', sources);
          return sources;
        },
        // itemDir '': the category folder is already sources/ (notes/), no second one inside it
        run: (catShell, items, target) => runSourcesJob(catShell, items, { ...target, itemDir: '' })
      },
      {
        name: 'Notes', folder: 'notes',
        scan: async () => {
          const notes = await scanNotesData(tabId, { strict: true });
          stampJobKeys('notes', notes);
          return notes;
        },
        run: (catShell, items, target) => runNotesJob(catShell, items, { ...target, itemDir: '' })
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
        run: (catShell, chatData, target) => runChatJob(catShell, chatData, { ...target, citationMode, forceZip: true })
      },
      {
        name: 'Artifacts', folder: 'artifacts',
        // Keys over the whole list, disabled items included (the Generated tab's
        // list), then only the enabled items are exported and recorded
        scan: async () => {
          const all = await scanArtifactsData(tabId);
          stampJobKeys('artifacts', all);
          return all.filter(item => !item.disabled);
        },
        run: (catShell, items, target) => runArtifactsJob(catShell, items, { ...target, bothSlideFormats: true })
      }
    ].map(c => ({ ...c, status: null, selected: 0, exported: 0, failed: 0, zips: [], parts: 0, packages: 0, errors: [], auditOk: true, items: null, failedItems: [] }));
    const takeoutErrors = []; // not tied to one category
    // Relative path -> text the viewer reads, null for the rest (NLMEViewer.captureEntry)
    let viewerFiles = {};
    // images/ path -> Blob, from the -with-images files; saved with the root files
    const images = new Map();
    const addImage = (path, base64, mime) => {
      try {
        images.set(path, base64ToBlob(base64, mime));
      } catch (error) {
        console.warn('[NotebookLM Takeout] Could not read an embedded image:', error); // no file, so no link
      }
    };
    const capture = (path, text) => NLMEViewer.captureEntry(viewerFiles, path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path, text, addImage);
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

    // Job record (Milestone 3c): one for the whole takeout, made from the scanned
    // items. A category that is empty, failed to scan or was never scanned
    // (cancelled during the scan) has an empty list; chat is never recorded.
    const recordedItems = name => {
      const c = categories.find(cat => cat.name === name);
      return !c.status && c.items ? c.items : [];
    };
    const tracker = stopRest ? null : await startJobRecord(shell, 'takeout', 'Export everything', {
      sources: recordedItems('Sources'),
      notes: recordedItems('Notes'),
      artifacts: recordedItems('Artifacts')
    }, { zip: zipMode });
    let uncleanEnd = false; // a runner was cancelled or stopped

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
        const out = await c.run(catShell, c.items, { pathPrefix: `${root}/${c.folder}/`, zipKind: `takeout-${c.folder}`, folder, written, tracker, capture });
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
        if (out.result.cancelled || out.result.stopped) uncleanEnd = true;
        if (out.result.cancelled) stopRest = true;
      } catch (error) {
        // A package that could not be written: this category fails, the
        // others still run
        console.error(`[NotebookLM Takeout] Full Takeout: ${c.name} failed:`, error);
        c.status = 'failed';
        c.errors.push(`Export failed: ${error.message || error}`);
        if (tracker) tracker.discard(); // successes staged for a package that was never saved
      }
      c.zips = written.zips;
      c.parts = written.parts;
      c.packages = written.count;
      c.items = null; // free the scan data before the next category
    }

    // Clean end: nothing cancelled, stopped or skipped. The record goes only when
    // every recorded item is done (a failed item or a failed category keeps it)
    if (tracker) await tracker.finish(!stopRest && !uncleanEnd);

    // 3. Root files, also after a cancel
    const summary = categories.map(({ name, folder: catFolder, status, selected, exported, failed, zips, parts, packages }) =>
      ({ name, folder: catFolder, status, selected, exported, failed, zips, parts, packages }));
    const cancelled = summary.some(c => c.status === 'partial' || c.status === 'skipped');

    shell.finishing();
    // Images before the viewer: it may only link what was saved
    shell.progress('Saving images...', 1);
    const savedImages = await saveTakeoutImages(images, {
      root,
      folder,
      zipNameFor: (part, totalParts) => NLME.zipName({ notebook: shell.projectName, kind: 'takeout-images', timestamp: shell.timestamp, partial: cancelled, part, totalParts })
    });
    images.clear();
    if (savedImages.failed) takeoutErrors.push(IMAGES_ERROR);

    let viewerHtml = null;
    shell.progress('Building the offline viewer...', 1);
    try {
      viewerHtml = await buildViewerHtml(viewerFiles, { ...shell.meta, emoji: await getNotebookEmoji(tabId) }, savedImages.paths);
    } catch (error) {
      console.error('[NotebookLM Takeout] Full Takeout: viewer failed:', error);
      takeoutErrors.push(VIEWER_ERROR);
    }
    viewerFiles = null; // the texts are in viewerHtml now

    const allErrors = () => [
      ...NLME.prefixExportErrors('Takeout', takeoutErrors),
      ...categories.flatMap(c => NLME.prefixExportErrors(c.name, c.errors))
    ];
    const rootFilesWith = html => takeoutRootFiles({ meta: shell.meta, summary, errors: allErrors(), partial: cancelled, viewerHtml: html });

    shell.progress('Writing the takeout index...', 1);
    let rootWritten = true;
    let indexZip = null;
    const saveRoot = async files => {
      const placed = files.map(f => ({ ...f, path: `${root}/${f.path}` }));
      if (folder) {
        await saveFiles(placed, { folder });
      } else {
        const zipName = NLME.zipName({ notebook: shell.projectName, kind: 'takeout-index', timestamp: shell.timestamp, partial: cancelled });
        await saveFiles(placed, { zipName });
        indexZip = zipName;
      }
    };
    // Folder mode: viewer.html goes first and alone, so the files that name it are
    // only written once it is known to be there
    if (folder && viewerHtml !== null) {
      try {
        await saveRoot([{ path: VIEWER_FILE, data: viewerHtml }]);
      } catch (error) {
        console.error('[NotebookLM Takeout] Full Takeout: viewer.html failed:', error);
        viewerHtml = null;
        takeoutErrors.push(VIEWER_ERROR);
      }
    }
    try {
      const rootFiles = rootFilesWith(viewerHtml);
      await saveRoot(folder ? rootFiles.filter(f => f.path !== VIEWER_FILE) : rootFiles);
    } catch (error) {
      console.error('[NotebookLM Takeout] Full Takeout: root files failed:', error);
      rootWritten = false;
      // ZIP mode: one package, so the viewer may be what sank it. Try without it; if
      // that fails too, the viewer was not the reason and is not blamed
      if (!folder && viewerHtml !== null) {
        takeoutErrors.push(VIEWER_ERROR);
        try {
          await saveRoot(rootFilesWith(null));
          rootWritten = true;
        } catch (retryError) {
          console.error('[NotebookLM Takeout] Full Takeout: root files failed without the viewer:', retryError);
          takeoutErrors.pop();
        }
      }
    }
    viewerHtml = null;
    const errors = allErrors();

    // 4. One results panel for the whole takeout
    let { message, level } = NLME.summarizeTakeoutOutcome({
      categories: summary.map((c, i) => ({ ...c, errorCount: NLME.countExportErrors(categories[i].errors) })),
      auditOk: categories.every(c => c.auditOk)
    });
    if (!rootWritten) {
      message += ' — the takeout index could not be written';
      if (level !== 'error') level = 'warning';
    }
    if (takeoutErrors.includes(VIEWER_ERROR)) {
      message += ' — the offline viewer could not be built';
      if (level !== 'error') level = 'warning';
    }
    if (takeoutErrors.includes(IMAGES_ERROR)) {
      message += ' — some images could not be saved';
      if (level !== 'error') level = 'warning';
    }
    console.log('[NotebookLM Takeout] Full Takeout finished:', message);
    const saved = folder ? [folder] : [...categories.flatMap(c => c.zips), ...savedImages.zips, ...(indexZip ? [indexZip] : [])];

    // Retry: Sources, Notes and Artifacts items that failed (chat is never retried)
    const failedOf = name => categories.find(c => c.name === name).failedItems;
    const failedSources = failedOf('Sources');
    const failedNotes = failedOf('Notes');
    const failedArtifacts = failedOf('Artifacts');
    showTakeoutResults({ message, level, saved, errors },
      { Sources: failedSources, Notes: failedNotes, Artifacts: failedArtifacts }, tabId, zipMode);
  });
}

// The Full Takeout's "Retry N failed" chain, in this order. Each step is an
// ordinary tab export of the failed items on the takeout's tab, and returns
// its outcome (see withExportShell) so the chain can combine them.
const TAKEOUT_RETRY_STEPS = [
  { name: 'Sources', run: (items, tabId) => exportSources(items, { tabId, updateRecord: true }) },
  { name: 'Notes', run: (items, tabId) => exportNotesAsMarkdown(items, { tabId, updateRecord: true }) },
  { name: 'Artifacts', run: (items, tabId, zip) => downloadAllArtifacts(tabId, items, { updateRecord: true, zip }) }
];

// Show a takeout-level results panel with "Retry N failed" for `failed`
// ({ Sources: [...], Notes: [...], Artifacts: [...] }; chat is never retried).
// zip: the run's save choice, for the Artifacts step of its Retry.
function showTakeoutResults(panel, failed, tabId, zip) {
  const shown = { ...panel, retry: takeoutRetry(failed, tabId, () => showResults({ ...shown, notify: false }), zip) };
  showResults(shown);
}

/**
 * Run `fn` as a Retry / Resume chain: while it runs, requestCancel (sidebar.js)
 * notes a Cancel on the chain, so one pressed between two steps (no shell
 * active) still stops it. The flag is reset when the chain starts and ends.
 */
async function runChain(fn) {
  chainActive = true;
  chainCancelRequested = false;
  try {
    return await fn();
  } finally {
    chainActive = false;
    chainCancelRequested = false;
  }
}

/**
 * The steps shared by the takeout Retry and Resume, in TAKEOUT_RETRY_STEPS order
 * (chainSteps: the Generated export's own steps), each an ordinary tab export of
 * `itemsByName[step.name]` on `tabId`. Empty
 * categories are skipped. zip: the run's save choice, which the Artifacts step
 * takes; undefined leaves it on its default. A cancel (the step's own, or the chain flag set between
 * steps), a declined health-check dialog or an aborted step ends the chain: later
 * categories do not run. Call it inside runChain.
 *
 * @returns {{ steps: object[], notRun: object[] }} the inputs of
 *   NLME.combineRetryOutcomes
 */
async function runRetryChain(itemsByName, tabId, verb = 'Retry', chainSteps = TAKEOUT_RETRY_STEPS, zip) {
  const steps = [];
  const notRun = [];
  let stopped = false;
  for (const step of chainSteps) {
    const items = itemsByName[step.name] || [];
    if (items.length === 0) continue;
    if (chainCancelRequested) stopped = true;
    if (stopped) { notRun.push({ name: step.name, failedItems: items }); continue; }
    let out;
    try {
      out = await step.run(items, tabId, zip);
    } catch (error) {
      console.error(`[NotebookLM Takeout] ${verb} ${step.name} failed:`, error);
      showToast('Export failed. Please try again.', 'error');
    }
    if (!out || !out.result) { // declined, aborted (tab closed, export threw)
      stopped = true;
      notRun.push({ name: step.name, failedItems: items });
      continue;
    }
    steps.push({
      name: step.name,
      message: out.message,
      level: out.level,
      saved: out.saved,
      errors: out.errors,
      failedItems: out.result.failedItems || [],
      exported: out.result.exported,
      stopped: !!(out.result.cancelled || out.result.stopped)
    });
    if (out.result.cancelled) stopped = true;
  }
  return { steps, notRun };
}

/**
 * The takeout panel's Retry: runs the failed Sources, Notes and Artifacts
 * exports one after another under one job lock, on the tab the takeout
 * scanned (not whichever tab is active now). A cancel or a declined
 * health-check dialog in one step ends the chain: later categories do not run.
 * It ends in ONE combined results panel (NLME.combineRetryOutcomes): a line
 * per category, the worst level, every ZIP and error, and a Retry for
 * everything still failed (including categories that did not run). When no
 * category ran at all, `restore` puts the previous panel back.
 *
 * @returns {{ count: number, run: () => Promise<any> }|null}
 */
function takeoutRetry(failed, tabId, restore, zip) {
  const count = TAKEOUT_RETRY_STEPS.reduce((sum, step) => sum + (failed[step.name] || []).length, 0);
  if (count === 0) return null;
  const rerun = rememberRunSettings();
  return {
    count,
    run: () => runExclusive('Retry failed', () => rerun(async () => {
      const { steps, notRun } = await runChain(() => runRetryChain(failed, tabId, 'Retry', TAKEOUT_RETRY_STEPS, zip));
      if (steps.length === 0) {
        restore(); // the first step never ran: keep the panel and its Retry
        return;
      }
      const combined = NLME.combineRetryOutcomes({ steps, notRun });
      showTakeoutResults({
        message: combined.message,
        level: combined.level,
        lines: combined.lines,
        saved: combined.saved,
        errors: combined.errors
      }, combined.remaining, tabId, zip);
    }))
  };
}

// ---- Resume (Milestone 3c) ----

// Resume's fresh scan per job-record category (full lists, like the tab lists).
const RESUME_CATEGORIES = [
  { category: 'sources', name: 'Sources', scan: async tabId => (await scanSourcesData(tabId)).sources },
  // Studio notes and the Sources panel's notes are drawn separately: a key is gone
  // only if the scan shows its own region (see NLME.planResume)
  { category: 'notes', name: 'Notes', scan: tabId => scanNotesData(tabId, { strict: true }), regionOfType: type => (type === 'Note (Sources panel)' ? 'sources-panel' : 'studio') },
  { category: 'artifacts', name: 'Artifacts', scan: tabId => scanArtifactsData(tabId) }
];

// The notebook's stored record, only when it is still `record` (same id) and usable.
async function loadResumableRecord(record) {
  try {
    const key = NLME.jobRecordKey(record.notebookId);
    const stored = (await chrome.storage.local.get(key))[key];
    return stored && stored.id === record.id && NLME.jobRecordUsable(stored, record.notebookId) ? stored : null;
  } catch (error) {
    console.warn('[NotebookLM Takeout] Job record not read:', error);
    return null;
  }
}

// Keys a resume found gone from the notebook are resolved: cleared from the
// record (the banner stops offering them); the record is removed when that was
// everything. Awaited before the exports start, which load the record themselves.
// Never throws: on a storage failure the keys simply stay in the record.
async function clearMissingFromRecord(record, missingByCategory) {
  try {
    const key = NLME.jobRecordKey(record.notebookId);
    const stored = (await chrome.storage.local.get(key))[key];
    if (!stored || stored.id !== record.id || !NLME.jobRecordUsable(stored, record.notebookId)) return;
    let next = stored;
    const now = Date.now();
    for (const [category, keys] of Object.entries(missingByCategory)) next = NLME.markJobItems(next, category, keys, { now });
    if (next === stored) return;
    if (NLME.jobRecordFinished(next)) await chrome.storage.local.remove(key);
    else await chrome.storage.local.set({ [key]: next });
  } catch (error) {
    console.warn('[NotebookLM Takeout] Job record not updated:', error);
  }
}

/**
 * The banner's Resume: re-runs what an unfinished export left (remaining +
 * failed) as the same chain as the takeout Retry (sources, notes, artifacts), on
 * the active tab, which must show the record's notebook. Items are found again by
 * key in a fresh scan of each category (NLME.matchResumeItems, keys stamped over
 * the FULL scan, artifacts over the unfiltered one); keys no longer in the
 * notebook are cleared from the record and listed in the panel as "not_found".
 * The exports run with updateRecord, so the record ends as the outcome: successes
 * cleared, failures kept. Like a retry it makes ordinary tab exports; it never
 * writes back into the original takeout's files. One combined results panel.
 */
function resumeJob(record) {
  return runExclusive('Resume', () => withRunSettings(NLME.jobRecordOverrides(record, settings), () => runChain(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !isNotebookUrl(tab.url) || NLME.notebookIdFromUrl(tab.url) !== record.notebookId) {
      showToast('Open the notebook this export was running on to resume it', 'warning');
      return;
    }
    const tabId = tab.id;
    const live = await loadResumableRecord(record);
    if (!live) {
      showToast('That earlier export is no longer pending', 'info');
      return;
    }

    // Find the items again, category by category
    // The tab must still show the record's notebook right before each scan and
    // again after it (in-app navigation changes the URL before the page is drawn)
    const onNotebook = async () => {
      try {
        const now = await chrome.tabs.get(tabId);
        return isNotebookUrl(now.url) && NLME.notebookIdFromUrl(now.url) === record.notebookId;
      } catch (_) { return false; }
    };
    const itemsByName = {};
    const missingByCategory = {};
    const extraErrors = [];
    // No export shell is active while the categories are scanned, so show the
    // progress panel with its Cancel button here (requestCancel sets
    // chainCancelRequested, checked before each scan and again after the last).
    // The finally hides it on every path: return, throw or normal end. The
    // export steps that follow show it again through their own shells.
    const scanPanel = document.getElementById('download-progress');
    const scanFill = document.getElementById('progress-fill');
    const scanText = document.getElementById('progress-text');
    const scanSteps = RESUME_CATEGORIES.filter(c => NLME.jobResumeKeys(live, c.category).length > 0).length;
    let scanDone = 0;
    scanPanel.style.display = 'block';
    scanText.textContent = 'Checking what is left\u2026';
    scanFill.style.width = '0%';
    try {
      for (const { category, name, scan, regionOfType } of RESUME_CATEGORIES) {
        const keys = NLME.jobResumeKeys(live, category);
        if (keys.length === 0) continue;
        scanText.textContent = `Checking ${name.toLowerCase()}\u2026`;
        scanFill.style.width = `${(scanDone++ / scanSteps) * 100}%`;
        if (chainCancelRequested) { showToast('Resume cancelled', 'info'); return; }
        if (!(await onNotebook())) {
          showToast('The tab left that notebook; resume stopped', 'warning');
          return;
        }
        let items;
        try {
          items = await scan(tabId);
        } catch (error) {
          console.error(`[NotebookLM Takeout] Resume: ${name} scan failed:`, error);
          extraErrors.push({ type: 'scan_failed', title: name, message: `Could not scan ${name.toLowerCase()} (${(error && error.message) || error}); its items stay in the list to resume` });
          continue;
        }
        if (!(await onNotebook())) {
          showToast('The tab left that notebook; resume stopped', 'warning');
          return;
        }
        stampJobKeys(category, items); // over the full scan, before any subset is cut
        // NLME.planResume: a scan that matches nothing (empty, still drawing, the wrong
        // page) or lacks a whole region (Studio notes not drawn) cannot say a key is
        // gone; those keys are `unknown`, reported and kept in the record
        const { matched, missing, unknown } = NLME.planResume(keys, items, { ...JOB_KEY_ACCESSORS[category], regionOfType });
        let runnable = matched;
        if (category === 'artifacts') {
          runnable = matched.filter(item => !item.disabled);
          for (const item of matched.filter(item => item.disabled)) {
            extraErrors.push({ type: 'not_ready', title: name, message: `${item.label} is not ready to download; it stays in the list to resume` });
          }
        }
        if (runnable.length) itemsByName[name] = runnable;
        if (unknown.length) {
          for (const key of unknown) extraErrors.push({ type: 'scan_failed', title: name, message: `${NLME.jobKeyTitle(key)} could not be checked (the ${name.toLowerCase()} list looks incomplete; the page may still be loading); it stays in the list to resume` });
        }
        if (missing.length) {
          missingByCategory[category] = missing;
          for (const key of missing) extraErrors.push({ type: 'not_found', title: name, message: `${NLME.jobKeyTitle(key)} is no longer in the notebook` });
        }
      }
    } finally {
      scanPanel.style.display = 'none';
    }
    if (chainCancelRequested) { showToast('Resume cancelled', 'info'); return; }
    await clearMissingFromRecord(live, missingByCategory);

    const zip = NLME.jobRecordZip(live);
    const { steps, notRun } = await runRetryChain(itemsByName, tabId, 'Resume', TAKEOUT_RETRY_STEPS, zip);
    if (steps.length === 0 && notRun.length === 0 && extraErrors.length === 0) {
      showToast('Nothing left to resume', 'info');
      return;
    }
    if (steps.length === 0 && extraErrors.length === 0) {
      showToast('Resume stopped', 'info'); // cancelled or declined before any step ran
      return;
    }
    const combined = NLME.combineRetryOutcomes({ steps, notRun, verb: 'Resume', extraErrors });
    if (steps.length === 0 && notRun.length === 0) combined.message = 'Nothing was resumed'; // only notes about items
    showTakeoutResults({
      message: combined.message,
      level: combined.level,
      lines: combined.lines,
      saved: combined.saved,
      errors: combined.errors
    }, combined.remaining, tabId, zip);
  })));
}
