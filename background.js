// NotebookLM Takeout - Background Service Worker

// Google renamed NotebookLM to "Gemini Notebook" and moved it from
// notebooklm.google.com to notebook.google.com (Jul 2026). The old host 301s to
// the new one; keep both so users mid-rollout still work.

// Shared DOM-free helpers (globalThis.NLME)
importScripts('takeout-shared.js', 'jszip.min.js');

function isNotebookUrl(url) {
  return NLME.isNotebookUrl(url);
}

// Handle extension icon click - open sidebar
chrome.action.onClicked.addListener(async (tab) => {
  // Open the side panel for the current window
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Enable sidebar on NotebookLM pages
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete' && isNotebookUrl(tab.url)) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidebar.html',
      enabled: true
    });
  }
});

// Store pending download name for renaming
// ==== DOWNLOAD STATE MANAGEMENT (Prevents race conditions) ====
// Use Maps to track state per download instead of global variables

// Queue of pending downloads (FIFO) - prevents race conditions
const pendingDownloads = []; // Array of {name, type, timestamp, requestId}
let nextRequestId = 1;

// Batch download mode - capture URLs instead of downloading
// Names for downloads the extension starts itself (blob: / data: URLs).
// Chrome drops the `filename` given to chrome.downloads.download whenever an
// onDeterminingFilename listener exists and doesn't suggest a name, so the
// listener applies these (url -> filename). Milestone 1, Task 8b.
const namedDownloads = new Map();
function nameNextDownload(url, filename) {
  namedDownloads.set(url, filename);
  setTimeout(() => namedDownloads.delete(url), 60000);
}

let batchDownloadMode = false;
let lastBatchResult = null; // final {success, count, errors} of the last batch
let capturedDownload = null;
let batchStatus = '';
let batchCancelRequested = false;

// Track intercepted downloads by ID instead of global state
const interceptedDownloads = new Map(); // downloadId -> {originalId, newId, filename, url}
const redownloadRequests = new Map(); // downloadId -> {filename, originalId}
const activeRedownloadUrls = new Set(); // URLs currently being re-downloaded (to avoid double interception)
const directDownloads = new Map(); // downloadId -> {filename, artifactType} for direct URL downloads

/**
 * Get artifact type prefix for filenames
 */
function getArtifactTypePrefix(artifactType) {
  return NLME.artifactTypePrefix(artifactType);
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {


    case 'START_INTERCEPT_DOWNLOAD':
      // Add to pending downloads queue with intercept flag
      const interceptRequestId = nextRequestId++;
      const interceptDownload = {
        name: message.name,
        type: message.artifactType,
        timestamp: Date.now(),
        requestId: interceptRequestId,
        intercept: true  // Flag to intercept and re-download
      };
      pendingDownloads.push(interceptDownload);
      console.log('[Background] Intercept download queued:', interceptDownload.name, 'ID:', interceptRequestId);

      // Clean up after 20 seconds if not used
      setTimeout(() => {
        const index = pendingDownloads.findIndex(d => d.requestId === interceptRequestId);
        if (index !== -1) {
          console.log('[Background] Cleaning up expired intercept request:', pendingDownloads[index].name);
          pendingDownloads.splice(index, 1);
        }
      }, 20000);

      sendResponse({ success: true, requestId: interceptRequestId });
      break;

    case 'GET_INTERCEPTED_DOWNLOAD':
      // Check if any downloads were intercepted (return most recent)
      if (interceptedDownloads.size > 0) {
        // Get the most recent intercepted download
        const downloadIds = Array.from(interceptedDownloads.keys());
        const latestId = downloadIds[downloadIds.length - 1];
        const result = { ...interceptedDownloads.get(latestId) };

        // Clean up - remove from map after retrieval
        interceptedDownloads.delete(latestId);

        sendResponse({ success: true, ...result });
      } else {
        sendResponse({ success: false });
      }
      break;

    case 'CANCEL_INTERCEPT':
      // Remove all intercept requests from queue
      const cancelledCount = pendingDownloads.filter(d => d.intercept).length;
      if (cancelledCount > 0) {
        // Remove intercept downloads from queue
        for (let i = pendingDownloads.length - 1; i >= 0; i--) {
          if (pendingDownloads[i].intercept) {
            console.log('[Background] Removing intercept request:', pendingDownloads[i].name);
            pendingDownloads.splice(i, 1);
          }
        }
        console.log('[Background] Cancelled', cancelledCount, 'intercept requests');
      }
      sendResponse({ success: true });
      break;


    case 'BATCH_DOWNLOAD_ALL':
      lastBatchResult = null;
      if (batchDownloadMode) {
        sendResponse({ started: false, success: false, error: 'A batch download is already running' });
        break;
      }
      // Run batch download entirely in background (popup may close)
      runBatchDownload(message.tabId, message.items, message.downloadPreference || 'pdf')
        .catch(error => ({ success: false, count: 0, error: error.message, errors: [error.message] }))
        .then(result => {
          lastBatchResult = result;
          // Notify via notification since popup may be closed
          if (result.success) {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'NotebookLM Export Complete',
              message: `Downloaded ${result.count} files as ZIP`
            });
          }
        });
      sendResponse({ started: true });
      break;

    case 'EXTRACT_MINDMAP_FRAME':
      extractMindmapFromAppFrame(message.tabId)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'CANCEL_BATCH_DOWNLOAD':
      // Checked between items; the item in progress finishes first
      batchCancelRequested = true;
      sendResponse({ success: true });
      break;

    case 'NAME_NEXT_DOWNLOAD':
      nameNextDownload(message.url, message.filename);
      sendResponse({ success: true });
      break;

    case 'GET_BATCH_STATUS':
      sendResponse({
        inProgress: batchDownloadMode,
        status: batchStatus,
        result: lastBatchResult
      });
      break;

    case 'DIRECT_DOWNLOAD_URL':
      // Direct download from intercepted URL (no tab opened)
      // Start download and use onDeterminingFilename to rename
      (async () => {
        try {
          console.log('[Background] Direct download requested:', message.filename);
          console.log('[Background] URL:', message.url?.substring(0, 100));

          // The URL names the real file (e.g. .pptx vs .pdf); without this the
          // name fell back to the artifact type's default (.pdf for slides)
          let directFilename = message.filename;
          if (!/\.[a-z0-9]{2,5}$/i.test(directFilename)) {
            directFilename += NLME.extensionFromDownloadUrl(message.url);
          }

          // Start the download
          const downloadId = await chrome.downloads.download({
            url: message.url,
            saveAs: false
          });

          console.log('[Background] Direct download started:', downloadId);

          // Store filename for onDeterminingFilename to use
          directDownloads.set(downloadId, {
            filename: directFilename,
            artifactType: message.artifactType
          });

          // Clean up after 30 seconds
          setTimeout(() => {
            directDownloads.delete(downloadId);
          }, 30000);

          sendResponse({ success: true, downloadId: downloadId });
        } catch (error) {
          console.error('[Background] Direct download failed:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true; // Keep channel open for async
  }
  return true; // Keep channel open for async response
});

// Capture downloads as soon as they're created (backup method)
chrome.downloads.onCreated.addListener((downloadItem) => {
  // 'notebook' matches both the new host and the legacy 'notebooklm' URLs
  const isFromNotebookLM = downloadItem.url?.includes('notebook') ||
                           downloadItem.url?.includes('googleusercontent') ||
                           downloadItem.referrer?.includes('notebook');

  // Check if this download matches a pending intercept request
  const hasInterceptRequest = pendingDownloads.some(d => d.intercept);

  // Check if this is a re-download we initiated (skip interception to avoid loops)
  const isOurRedownload = activeRedownloadUrls.has(downloadItem.url);
  console.log('[Background] Download created:', downloadItem.id, 'URL:', downloadItem.url?.substring(0, 100), 'batchMode:', batchDownloadMode, 'hasInterceptRequest:', hasInterceptRequest, 'isOurRedownload:', isOurRedownload);

  // INTERCEPT MODE - Capture, cancel, and re-download without opening tab
  // Skip if this is our own re-download to prevent double interception
  if (hasInterceptRequest && isFromNotebookLM && downloadItem.url && !isOurRedownload) {
    // Find and remove the intercept request from queue (FIFO - take first intercept request)
    const interceptIndex = pendingDownloads.findIndex(d => d.intercept);
    if (interceptIndex === -1) {
      console.warn('[Background] Intercept request not found in queue (race condition)');
      return;
    }

    const pendingRequest = pendingDownloads[interceptIndex];
    pendingDownloads.splice(interceptIndex, 1); // Remove from queue immediately
    console.log('[Background] Intercepting download for:', pendingRequest.name, 'requestId:', pendingRequest.requestId);

    // Determine file extension BEFORE async operations
    let extension = '';
    console.log('[Background] Determining extension for:', pendingRequest.type);
    console.log('[Background] downloadItem.filename:', downloadItem.filename);
    console.log('[Background] downloadItem.mime:', downloadItem.mime);

    // Try to get extension from filename
    if (downloadItem.filename) {
      const match = downloadItem.filename.match(/\.[^.]+$/);
      extension = match ? match[0] : '';
      if (extension) {
        console.log('[Background] Extension from filename:', extension);
      }
    }

    // Fallback: use MIME type or artifact type
    if (!extension) {
      if (downloadItem.mime) {
        const mimeExtensions = {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'application/pdf': '.pdf',
          'audio/wav': '.wav',
          'audio/mpeg': '.mp3',
          'audio/mp4': '.m4a',
          'audio/x-m4a': '.m4a',
          'video/mp4': '.mp4'
        };
        extension = mimeExtensions[downloadItem.mime] || '';
        if (extension) {
          console.log('[Background] Extension from MIME type:', extension, 'for MIME:', downloadItem.mime);
        } else if (downloadItem.mime) {
          console.warn('[Background] Unknown MIME type (no mapping):', downloadItem.mime);
        }
      }

      // Last resort: use artifact type from pending request
      if (!extension && pendingRequest.type === 'Infographic') {
        extension = '.png';
        console.log('[Background] Extension from artifact type (Infographic):', extension);
      } else if (!extension && pendingRequest.type === 'Slides') {
        extension = '.pdf';
        console.log('[Background] Extension from artifact type (Slides):', extension);
      } else if (!extension && pendingRequest.type === 'Audio Overview') {
        extension = '.m4a';
        console.log('[Background] Extension from artifact type (Audio Overview):', extension);
      }
    }

    if (!extension) {
      console.error('[Background] Could not determine extension! Type:', pendingRequest.type, 'MIME:', downloadItem.mime, 'Filename:', downloadItem.filename);
      console.log('[Background] Will wait for onDeterminingFilename to get extension from original filename');
    }

    // Create new filename with type prefix
    const typePrefix = getArtifactTypePrefix(pendingRequest.type);
    console.log('[Background] Artifact type:', pendingRequest.type, '-> prefix:', typePrefix);
    let newFilename = `[${typePrefix}]_${sanitizeFilename(pendingRequest.name || 'download')}${extension}`;

    // Safety check: if still no extension, we'll try to get it in onDeterminingFilename
    if (!extension) {
      console.log('[Background] No extension determined yet - will extract from original filename later');
    }
    console.log('[Background] Re-downloading as:', newFilename, '(extension from:', downloadItem.filename ? 'filename' : downloadItem.mime ? 'mime' : 'type', ')');
    console.log('[Background] Full filename with prefix:', newFilename);

    // Store re-download info for onDeterminingFilename handler (use download ID as key)
    redownloadRequests.set(downloadItem.id, {
      filename: newFilename,
      originalId: downloadItem.id,
      requestId: pendingRequest.requestId
    });

    // Wrap entire intercept flow in IIFE with proper error handling
    (async () => {
      try {
        // CRITICAL: Wait for cancel to complete before re-downloading
        await chrome.downloads.cancel(downloadItem.id);
        console.log('[Background] Cancelled original download:', downloadItem.id);

        // Mark this URL as our re-download to prevent double interception
        activeRedownloadUrls.add(downloadItem.url);
        console.log('[Background] Added URL to activeRedownloadUrls:', downloadItem.url?.substring(0, 80));

        // Re-download directly (this won't open a tab)
        const newDownloadId = await chrome.downloads.download({
          url: downloadItem.url,
          saveAs: false
          // Don't set filename here - let onDeterminingFilename handle it
        });

        console.log('[Background] Re-download started:', newDownloadId);

        // Clean up activeRedownloadUrls after a short delay (download should be created by now)
        setTimeout(() => {
          activeRedownloadUrls.delete(downloadItem.url);
          console.log('[Background] Removed URL from activeRedownloadUrls:', downloadItem.url?.substring(0, 80));
        }, 2000);

        // Store intercepted download info in Map (use newDownloadId as key)
        interceptedDownloads.set(newDownloadId, {
          originalId: downloadItem.id,
          newId: newDownloadId,
          filename: newFilename,
          url: downloadItem.url,
          requestId: pendingRequest.requestId
        });

        // Erase the cancelled download from history
        setTimeout(() => {
          chrome.downloads.erase({ id: downloadItem.id }).catch(() => {});
        }, 1000);

      } catch (error) {
        console.error('[Background] Intercept mode failed:', error);
        // Clean up on error
        redownloadRequests.delete(downloadItem.id);
        activeRedownloadUrls.delete(downloadItem.url);
      }
    })();

    return;
  }

  // BATCH MODE - Existing batch download logic
  if (batchDownloadMode && isFromNotebookLM && downloadItem.url) {
    // Only intercept requests are queued now (SET_PENDING_DOWNLOAD was removed)
    const pendingInfo = null;

    // Capture the URL and download ID - don't cancel yet, we need to fetch first
    if (!capturedDownload) {
      capturedDownload = {
        url: downloadItem.url,
        downloadId: downloadItem.id,
        mime: downloadItem.mime,
        name: pendingInfo?.name || 'download',
        type: pendingInfo?.type || 'unknown',
        requestId: pendingInfo?.requestId
      };
      console.log('[Background] Captured download via onCreated:', capturedDownload.url?.substring(0, 100));
      // Don't cancel here - let the fetch happen first
    }
  }
});

// Intercept downloads from NotebookLM and rename them
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  // Check if this download is from NotebookLM
  // 'notebook' matches both the new host and the legacy 'notebooklm' URLs
  const isFromNotebookLM = downloadItem.url?.includes('notebook') ||
                           downloadItem.referrer?.includes('notebook') ||
                           downloadItem.finalUrl?.includes('googleusercontent');

  // Extension-started downloads with a registered name (folder mode, batch ZIP)
  const namedFile = namedDownloads.get(downloadItem.url) || namedDownloads.get(downloadItem.finalUrl);
  if (namedFile) {
    namedDownloads.delete(downloadItem.url);
    suggest({ filename: namedFile, conflictAction: 'uniquify' });
    return true;
  }

  // Check if this download has redownload info in the Map
  const redownloadInfo = redownloadRequests.get(downloadItem.id);
  console.log('[Background] Download intercepted:', downloadItem.id, downloadItem.filename, 'from NotebookLM:', isFromNotebookLM, 'batchMode:', batchDownloadMode, 'hasRedownloadInfo:', !!redownloadInfo);

  // Check if this is the ORIGINAL download being cancelled (skip it)
  if (redownloadInfo && downloadItem.id === redownloadInfo.originalId) {
    console.log('[Background] Skipping original download (will be cancelled)');
    return false; // Let it use default name, we'll cancel it anyway
  }

  // Check if this is a direct download (from URL interception - no tab opened)
  const directInfo = directDownloads.get(downloadItem.id);
  if (directInfo) {
    let filename = directInfo.filename;
    console.log('[Background] Direct download - using filename:', filename);

    // Take the extension from the actual download: server filename first,
    // then MIME type, then a per-type default
    if (!filename.match(/\.[a-z0-9]{2,5}$/i)) {
      const originalExt = downloadItem.filename?.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '';
      const extension = originalExt || getExtensionFromMime(downloadItem.mime) || getExtensionFromType(directInfo.artifactType);
      filename = filename + extension;
      console.log('[Background] Added extension:', extension);
    }

    suggest({ filename: filename });
    directDownloads.delete(downloadItem.id); // Clean up
    return true;
  }

  // Check if this download is an intercepted download in our Map
  // Priority check: If it's in our Map, rename it regardless of URL detection
  const interceptInfo = interceptedDownloads.get(downloadItem.id);
  if (interceptInfo) {
    let filename = interceptInfo.filename;
    console.log('[Background] Intercepted download - stored filename:', filename);
    console.log('[Background] Original downloadItem.filename:', downloadItem.filename);

    // If filename doesn't have an extension, extract it from the original download filename
    if (!filename.match(/\.[^.]+$/)) {
      console.log('[Background] Filename missing extension, extracting from original...');
      const originalExt = downloadItem.filename?.match(/\.[^.]+$/)?.[0] || '';
      if (originalExt) {
        filename = filename + originalExt;
        console.log('[Background] Added extension from original filename:', originalExt, '-> new filename:', filename);
      } else {
        console.warn('[Background] Could not determine extension for:', filename);
      }
    } else {
      console.log('[Background] Filename already has extension');
    }

    console.log('[Background] Final filename for rename:', filename);
    suggest({ filename: filename });
    return true;
  }

  // No registered rename for this download: Chrome keeps its name
  return false;
});

function sanitizeFilename(filename) {
  return NLME.sanitizeFilename(filename);
}

// Fetch file content and return as base64
async function fetchFileContent(url) {
  try {
    console.log('[Background] Fetching file:', url);

    // Get cookies for the URL domain
    const urlObj = new URL(url);
    const cookies = await chrome.cookies.getAll({ domain: urlObj.hostname });
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    console.log('[Background] Got', cookies.length, 'cookies for', urlObj.hostname);

    const response = await fetch(url, {
      credentials: 'include',
      headers: cookieHeader ? { 'Cookie': cookieHeader } : {}
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Convert to base64
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    console.log('[Background] Fetched file, size:', uint8Array.length, 'mime:', blob.type);

    return {
      success: true,
      data: base64,
      mime: blob.type,
      size: uint8Array.length
    };
  } catch (error) {
    console.error('[Background] Fetch failed:', error);
    return { success: false, error: error.message };
  }
}

// The toolbar badge counted artifacts found by the removed page polling
// (Nov 2026). Clear what earlier versions stored so no stale count remains.
chrome.storage.local.remove('capturedArtifacts');
chrome.action.setBadgeText({ text: '' });

// Run batch download entirely in background
async function runBatchDownload(tabId, items, downloadPreference = 'pdf') {
  console.log('[Background] Starting batch download for', items.length, 'items');

  batchDownloadMode = true;
  batchCancelRequested = false;
  let batchWasCancelled = false;
  batchStatus = 'Starting...';
  const downloadedFiles = [];
  const errors = [];

  // We'll collect files as base64 and create zip at the end
  const fileContents = [];

  try {

  for (let i = 0; i < items.length; i++) {
    if (batchCancelRequested) {
      // Keep what was fetched: it becomes a -PARTIAL ZIP below
      console.log('[Background] Batch download cancelled by user');
      batchStatus = 'Cancelled';
      batchWasCancelled = true;
      errors.push(NLME.cancellationNote({ kind: 'artifacts', done: i, total: items.length }));
      break;
    }

    const item = items[i];
    batchStatus = `Downloading ${i + 1}/${items.length}: ${item.label}`;
    console.log('[Background]', batchStatus);

    try {
      // Use the same content-script path as single downloads: it resolves the
      // item among artifact-library-item rows only, extracts Reports/Data Tables
      // as HTML, and returns the CDN URL that injected.js intercepts from
      // window.open (no Chrome download is created for those).
      const extractable = item.type === 'Report' || item.type === 'Data Table' || item.type === 'Mind Map';
      capturedDownload = null;
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'DOWNLOAD_ARTIFACT',
        data: {
          artifactIndex: item.index,
          artifactType: item.type,
          artifactName: item.label,
          skipMoreButton: extractable,
          downloadPreference
        }
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Download failed');
      }

      if (response.method === 'mindmap_app_frame') {
        const frame = await extractMindmapFromAppFrame(tabId);
        if (!frame.success) throw new Error(frame.error);
        const base = sanitizeFilename(item.label);
        for (const [filename, text] of [
          [`${base}.svg`, frame.svgContent || ''],
          [`${base}.json`, JSON.stringify(frame.treeData || {}, null, 2)]
        ]) {
          const data = utf8ToBase64(text);
          fileContents.push({ filename, data, size: data.length });
          downloadedFiles.push(filename);
        }
        console.log('[Background] Added mind map (app frame) to collection:', base);
        continue;
      }

      if (response.method === 'mindmap_extraction') {
        const base = sanitizeFilename(item.label);
        for (const [filename, text] of [
          [`${base}.svg`, response.svgContent || ''],
          [`${base}.json`, JSON.stringify(response.treeData || {}, null, 2)]
        ]) {
          const data = utf8ToBase64(text);
          fileContents.push({ filename, data, size: data.length });
          downloadedFiles.push(filename);
        }
        console.log('[Background] Added mind map to collection:', base);
        continue;
      }

      if (response.method === 'content_extraction') {
        const data = utf8ToBase64(response.data || '');
        const filename = sanitizeFilename(item.label) + '.html';
        fileContents.push({ filename, data, size: data.length });
        downloadedFiles.push(filename);
        console.log('[Background] Added extracted content to collection:', filename);
        continue;
      }

      // Intercepted URL, or (fallback) a real Chrome download captured in onCreated
      const captured = response.url ? { url: response.url } : await waitForCapture(8000);

      if (captured && captured.url) {
        console.log('[Background] Captured URL:', captured.url.substring(0, 80));

        // Try fetching directly from background first (no CORS restrictions)
        console.log('[Background] Starting fetch from background...');
        let fetchResult = await fetchFileContent(captured.url);

        // If background fetch fails, try via content script
        if (!fetchResult.success) {
          console.log('[Background] Background fetch failed, trying content script...');
          fetchResult = await fetchViaContentScript(tabId, captured.url);
        }
        console.log('[Background] Fetch result:', fetchResult.success, fetchResult.error || fetchResult.size);

        // Now cancel the download (after fetch attempt)
        if (captured.downloadId) {
          chrome.downloads.cancel(captured.downloadId).then(() => {
            console.log('[Background] Cancelled download:', captured.downloadId);
            chrome.downloads.erase({ id: captured.downloadId });
          }).catch(() => {});
        }

        if (fetchResult.success) {
          const extension = NLME.extensionFromDownloadUrl(captured.url) || getExtensionFromMime(fetchResult.mime) || getExtensionFromType(item.type);
          const filename = sanitizeFilename(item.label) + extension;

          fileContents.push({
            filename,
            data: fetchResult.data,
            size: fetchResult.size
          });
          downloadedFiles.push(filename);
          console.log('[Background] Added to collection:', filename, fetchResult.size, 'bytes');
        } else {
          errors.push(`${item.label}: Fetch failed - ${fetchResult.error}`);
        }
      } else {
        errors.push(`${item.label}: Could not capture download URL`);
      }
    } catch (error) {
      console.error('[Background] Error downloading', item.label, error);
      errors.push(`${item.label}: ${error.message}`);
    }

    // Delay between downloads
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

    batchStatus = 'Creating ZIP...';
    console.log('[Background] Creating ZIP with', fileContents.length, 'files');

    // Create ZIP and download
    if (fileContents.length > 0) {
    // Same-title artifacts (spec R8) would otherwise overwrite each other
    const uniqueNames = NLME.uniqueFilenames(fileContents.map(f => f.filename));
    fileContents.forEach((f, i) => { f.filename = uniqueNames[i]; });
    try {
      const zipBase64 = await createZipFromFiles(fileContents, errors);
      const timestamp = NLME.exportTimestamp();

      // Download the ZIP (awaited: a failure here is a failed batch)
      const zipUrl = `data:application/zip;base64,${zipBase64}`;
      const zipName = `notebooklm-export-${timestamp}${batchWasCancelled ? '-PARTIAL' : ''}.zip`;
      nameNextDownload(zipUrl, zipName);
      await chrome.downloads.download({
        url: zipUrl,
        filename: zipName,
        saveAs: true
      });

      batchStatus = `Complete: ${downloadedFiles.length} files`;
      return { success: true, cancelled: batchWasCancelled, count: downloadedFiles.length, errors };
    } catch (zipError) {
      console.error('[Background] ZIP creation failed:', zipError);
      console.log('[Background] Falling back to individual file downloads...');

      // FALLBACK: Download files individually to prevent data loss
      batchStatus = 'Downloading files individually...';
      let successCount = 0;
      const fallbackErrors = [];

      for (let i = 0; i < fileContents.length; i++) {
        const file = fileContents[i];
        try {
          // Determine MIME type from filename extension
          const ext = file.filename.split('.').pop().toLowerCase();
          const mimeTypes = {
            'pdf': 'application/pdf',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'wav': 'audio/wav',
            'mp3': 'audio/mpeg',
            'm4a': 'audio/mp4',
            'mp4': 'video/mp4',
            'csv': 'text/csv',
            'md': 'text/markdown',
            'txt': 'text/plain'
          };
          const mimeType = mimeTypes[ext] || 'application/octet-stream';

          // Register the name: Chrome drops `filename` while our
          // onDeterminingFilename listener exists (see NAME_NEXT_DOWNLOAD)
          const fileUrl = `data:${mimeType};base64,${file.data}`;
          nameNextDownload(fileUrl, file.filename);
          await chrome.downloads.download({
            url: fileUrl,
            filename: file.filename,
            saveAs: false
          });
          successCount++;
          console.log(`[Background] Downloaded ${i + 1}/${fileContents.length}: ${file.filename}`);

          // Small delay between downloads to avoid overwhelming the system
          if (i < fileContents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (downloadError) {
          console.error(`[Background] Failed to download ${file.filename}:`, downloadError);
          fallbackErrors.push(`${file.filename}: ${downloadError.message}`);
        }
      }

      batchStatus = `Complete: ${successCount}/${fileContents.length} files (individual downloads)`;

      if (successCount > 0) {
        return {
          success: true,
          count: successCount,
          warning: `ZIP creation failed. Downloaded ${successCount} files individually.`,
          errors: fallbackErrors
        };
      } else {
        return {
          success: false,
          error: 'ZIP creation failed and all individual downloads failed',
          errors: [...errors, ...fallbackErrors]
        };
      }
    }
  } else {
    batchStatus = 'No files downloaded';
    // Never lose the reasons: an errors-only ZIP
    if (errors.length > 0) {
      try {
        const timestamp = NLME.exportTimestamp();
        const errUrl = `data:application/zip;base64,${await createZipFromFiles([], errors)}`;
        const errName = `notebooklm-export-${timestamp}${batchWasCancelled ? '-PARTIAL' : ''}-errors.zip`;
        nameNextDownload(errUrl, errName);
        await chrome.downloads.download({ url: errUrl, filename: errName, saveAs: false });
      } catch (e) {
        console.error('[Background] Could not save errors-only ZIP:', e);
      }
    }
    return { success: false, cancelled: batchWasCancelled, error: 'No files downloaded', count: 0, errors };
  }

  } finally {
    // CRITICAL: Always reset batchDownloadMode, even on error
    batchDownloadMode = false;
    console.log('[Background] Batch download mode reset');
  }
}

// Fetch file via content script (has page cookies)
async function fetchViaContentScript(tabId, url) {
  console.log('[Background] Sending FETCH_FILE to content script, tabId:', tabId);

  return new Promise((resolve) => {
    let resolved = false;

    // Send message to content script
    chrome.tabs.sendMessage(tabId, {
      type: 'FETCH_FILE',
      url: url
    }, (response) => {
      if (resolved) return;
      resolved = true;

      if (chrome.runtime.lastError) {
        console.error('[Background] Content script message error:', chrome.runtime.lastError.message);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else if (response) {
        console.log('[Background] Got response from content script:', response.success, response.size || response.error);
        resolve(response);
      } else {
        console.error('[Background] No response from content script');
        resolve({ success: false, error: 'No response from content script' });
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.error('[Background] Content script fetch timeout');
        resolve({ success: false, error: 'Fetch timeout' });
      }
    }, 30000);
  });
}

// Wait for a download to be captured
function waitForCapture(timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      if (capturedDownload) {
        const result = { ...capturedDownload };
        capturedDownload = null;
        resolve(result);
      } else if (Date.now() - startTime < timeout) {
        setTimeout(check, 100);
      } else {
        resolve(null);
      }
    };
    setTimeout(check, 500); // Start after menu has time to open
  });
}

// Extract an open mind map from its sandboxed app iframe (*.scf.usercontent.goog)
// by injecting mindmap-extract.js into the frame and running the same SVG/tree
// extraction used for in-page mind maps. Polls while the frame loads, then
// closes the viewer.
async function extractMindmapFromAppFrame(tabId) {
  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['mindmap-extract.js']
      }).catch(() => {});
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: async () => {
          if (window === window.top) return null;
          const svgNode = document.querySelector('svg g.node');
          if (!svgNode || !globalThis.__nlmeMindmap) return null;
          const root = svgNode.ownerSVGElement.parentElement || document.body;
          const result = await globalThis.__nlmeMindmap.extractMindmapSVG(root);
          return { svgContent: result.svgContent, treeData: result.treeData };
        }
      }).catch(() => []);
      const extracted = results.map(r => r.result).find(Boolean);
      if (extracted) {
        return { success: true, ...extracted };
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    return { success: false, error: 'Mind map not found in app frame (check *.scf.usercontent.goog permission)' };
  } finally {
    chrome.tabs.sendMessage(tabId, { type: 'NAVIGATE_BACK' }).catch(() => {});
  }
}

// Base64-encode a string as UTF-8 (chunked to avoid call-stack limits)
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Helper functions for batch download
function getExtensionFromMime(mimeType) {
  const mimeMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/json': '.json',
    'text/csv': '.csv',
    'text/markdown': '.md',
    'text/plain': '.txt',
    'audio/wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'video/mp4': '.mp4',
    'video/webm': '.webm'
  };
  const baseType = (mimeType || '').split(';')[0].trim().toLowerCase();
  return mimeMap[baseType] || '';
}

function getExtensionFromType(type) {
  const typeMap = {
    'Slides': '.pdf',
    'Infographic': '.png',
    'Audio Overview': '.m4a',
    'Video Overview': '.mp4'
  };
  return typeMap[type] || '.bin';
}

// Batch ZIP via the bundled JSZip (Milestone 1): UTF-8 file names, real
// dates, and errors.txt when any item failed. Replaces the hand-written
// writer, which garbled non-ASCII names and zeroed all dates.
async function createZipFromFiles(files, errors = []) {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, file.data, { base64: true });
  }
  if (errors.length > 0) {
    zip.file('errors.txt', NLME.formatErrorsTxt({
      title: 'Download All',
      generatedAt: new Date().toLocaleString(),
      errors
    }));
  }
  return zip.generateAsync({ type: 'base64' });
}
