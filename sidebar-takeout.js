// The shared file writer and export shell behind every export (Milestone 3a).
//
// saveFiles / fetchDownload: one way to write files (one ZIP, a Downloads
// subfolder, or single downloads). withExportShell: the pre-flight, progress,
// cancel, outcome-toast and cleanup every export needs, written once.
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

// Blob for a data entry (string, Blob or Uint8Array).
function entryBlob(data) {
  return data instanceof Blob ? data : new Blob([data]);
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

/**
 * Write files: one ZIP, a Downloads subfolder, or single downloads.
 *
 * FileEntry: { path, data } or { path, url }. `data` is a string, Blob or
 * Uint8Array; `url` is a Gemini Notebook download URL fetched with
 * fetchDownload (ZIP) or downloaded by the background (folder).
 *
 * - zipName set: one ZIP via JSZip, downloaded with downloadBlob. Strings are
 *   DEFLATEd; Blob/Uint8Array (media, already compressed) are STOREd.
 * - folder set (no zipName): each entry is saved to Downloads/<folder>/<path>.
 * - neither: each entry is a single download via downloadBlob. (downloadBlob
 *   itself routes to the folder branch only while Download All folder mode is
 *   active; that branch never calls downloadBlob, so there is no loop.)
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
        await downloadBlobToFolderPath(entryBlob(entry.data), target);
      } else {
        const response = await chrome.runtime.sendMessage({
          type: 'DIRECT_DOWNLOAD_URL',
          url: entry.url,
          filename: target
        });
        if (!response || !response.success) {
          throw new Error(`Download failed for ${entry.path}: ${(response && response.error) || 'no response'}`);
        }
      }
      saved++;
    }
    return { saved, zipped: false };
  }

  let saved = 0;
  for (const entry of files) {
    const blob = entry.data !== undefined ? entryBlob(entry.data) : await fetchDownload(entry.url);
    await downloadBlob(blob, entry.path);
    saved++;
  }
  return { saved, zipped: false };
}

/**
 * The shared wrapper around every export: pre-flight, progress, cancel,
 * outcome toast, cleanup. Runs `run(shell)` once.
 *
 * shell = {
 *   tab, projectName, timestamp, meta,
 *   isCancelled()              // true after Cancel (overlay or side panel)
 *   progress(text, fraction)   // fraction 0..1: side-panel bar + page overlay
 *   finish({ kind, selected, result, auditOk = true, stoppedMessage })
 *                              // result: { exported, failed, cancelled };
 *                              // stoppedMessage replaces the outcome toast
 *                              // when the extension stopped the job itself
 * }
 *
 * @param {{ label: string, healthType?: string, overlayMessage?: string }} options
 *   label names the export in logs; healthType ('notes', 'sources', ...) runs
 *   the DOM health check first
 * @param {(shell: object) => Promise<void>} run
 */
async function withExportShell({ label, healthType, overlayMessage }, run) {
  let tab = null;
  let overlayShown = false;
  let panelShown = false;
  let cancelled = false;
  let cancelListener = null;

  const progressPanel = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

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
      finish({ kind, selected, result = {}, auditOk = true, stoppedMessage } = {}) {
        if (stoppedMessage) {
          showToast(stoppedMessage, 'error');
          return;
        }
        const outcome = NLME.summarizeExportOutcome({
          kind,
          selected,
          exported: result.exported,
          failed: result.failed,
          cancelled: result.cancelled
        });
        showToast(auditOk ? outcome.message : `${outcome.message} — some content is missing, see _audit.md`,
          auditOk ? outcome.level : (outcome.level === 'error' ? 'error' : 'warning'));
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
