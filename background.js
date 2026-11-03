// NotebookLM Takeout - Background Service Worker

// Google renamed NotebookLM to "Gemini Notebook" and moved it from
// notebooklm.google.com to notebook.google.com (Jul 2026). The old host 301s to
// the new one; keep both so users mid-rollout still work.

// Shared DOM-free helpers (globalThis.NLME)
importScripts('takeout-shared.js');

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

// Names for downloads the extension starts itself (blob: / data: URLs).
// Chrome drops the `filename` given to chrome.downloads.download whenever an
// onDeterminingFilename listener exists and doesn't suggest a name, so the
// listener applies these (url -> filename). Milestone 1, Task 8b.
const namedDownloads = new Map();
function nameNextDownload(url, filename) {
  namedDownloads.set(url, filename);
  setTimeout(() => namedDownloads.delete(url), 60000);
}

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


    case NLME.MSG.START_INTERCEPT_DOWNLOAD:
      // Add to pending downloads queue with intercept flag
      const interceptRequestId = nextRequestId++;
      const interceptDownload = {
        name: message.name,
        type: message.artifactType,
        timestamp: Date.now(),
        requestId: interceptRequestId,
        intercept: true,  // Flag to intercept and re-download
        folder: message.folder || ''
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

    case NLME.MSG.GET_INTERCEPTED_DOWNLOAD:
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

    case NLME.MSG.CANCEL_INTERCEPT:
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

    case NLME.MSG.EXTRACT_MINDMAP_FRAME:
      extractMindmapFromAppFrame(message.tabId)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case NLME.MSG.NAME_NEXT_DOWNLOAD:
      nameNextDownload(message.url, message.filename);
      sendResponse({ success: true });
      break;

    case NLME.MSG.DIRECT_DOWNLOAD_URL:
      // Direct download from intercepted URL (no tab opened)
      // Start download and use onDeterminingFilename to rename
      (async () => {
        try {
          console.log('[Background] Direct download requested:', message.filename);
          console.log('[Background] URL:', message.url?.substring(0, 100));

          // The URL names the real file (e.g. .pptx vs .pdf); without this the
          // name fell back to the artifact type's default (.pdf for slides)
          // Only Gemini Notebook download hosts (the URL comes from the page)
          if (!NLME.isAllowedDownloadUrl(message.url)) {
            throw new Error('Not a Gemini Notebook download URL');
          }
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
  // Only Gemini Notebook downloads (allowed host, notebook referrer); never
  // the extension's own downloads or downloads from other tabs (Milestone 2)
  const isFromNotebookLM = !downloadItem.byExtensionId && NLME.isNotebookDownload(downloadItem);

  // Check if this download matches a pending intercept request
  const hasInterceptRequest = pendingDownloads.some(d => d.intercept);

  // Check if this is a re-download we initiated (skip interception to avoid loops)
  const isOurRedownload = activeRedownloadUrls.has(downloadItem.url);
  console.log('[Background] Download created:', downloadItem.id, 'URL:', downloadItem.url?.substring(0, 100), 'hasInterceptRequest:', hasInterceptRequest, 'isOurRedownload:', isOurRedownload);

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
    let newFilename = NLME.downloadFolderPath(pendingRequest.folder,
      `[${typePrefix}]_${sanitizeFilename(pendingRequest.name || 'download')}${extension}`);

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
});

// Intercept downloads from NotebookLM and rename them
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  // Gemini Notebook downloads only (allowed host, notebook referrer)
  const isFromNotebookLM = NLME.isNotebookDownload(downloadItem);

  // Extension-started downloads with a registered name (folder mode)
  const namedFile = namedDownloads.get(downloadItem.url) || namedDownloads.get(downloadItem.finalUrl);
  if (namedFile) {
    namedDownloads.delete(downloadItem.url);
    if (downloadItem.finalUrl) namedDownloads.delete(downloadItem.finalUrl);
    suggest({ filename: namedFile, conflictAction: 'uniquify' });
    return true;
  }

  // Check if this download has redownload info in the Map
  const redownloadInfo = redownloadRequests.get(downloadItem.id);
  console.log('[Background] Download intercepted:', downloadItem.id, downloadItem.filename, 'from NotebookLM:', isFromNotebookLM, 'hasRedownloadInfo:', !!redownloadInfo);

  // Check if this is the ORIGINAL download being cancelled (skip it)
  if (redownloadInfo && downloadItem.id === redownloadInfo.originalId) {
    console.log('[Background] Skipping original download (will be cancelled)');
    return false; // Let it use default name, we'll cancel it anyway
  }

  // Check if this is a direct download (from URL interception - no tab opened)
  const directInfo = directDownloads.get(downloadItem.id);
  if (directInfo) {
    // The side panel names the file with the extension it expects (URL,
    // then type); the actual download's own name or MIME type wins when it
    // is another known type (Slides as .pptx), then a per-type default
    const realExt = downloadItem.filename?.match(/\.[a-z0-9]{2,5}$/i)?.[0] || NLME.extensionFor({ mime: downloadItem.mime });
    let filename = NLME.withRealExtension(directInfo.filename, realExt);
    if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename += NLME.extensionFor({ type: directInfo.artifactType });
    console.log('[Background] Direct download - using filename:', filename);

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

// The toolbar badge counted artifacts found by the removed page polling
// (Nov 2026). Clear what earlier versions stored so no stale count remains.
chrome.storage.local.remove('capturedArtifacts');
chrome.action.setBadgeText({ text: '' });

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
    chrome.tabs.sendMessage(tabId, { type: NLME.MSG.NAVIGATE_BACK }).catch(() => {});
  }
}
