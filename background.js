// NotebookLM Takeout - Background Service Worker

// Handle extension icon click - open sidebar
chrome.action.onClicked.addListener(async (tab) => {
  // Open the side panel for the current window
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Enable sidebar on NotebookLM pages
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete' && tab.url?.includes('notebooklm.google.com')) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidebar.html',
      enabled: true
    });
  }
});

// Store captured artifacts
const capturedArtifacts = {
  audio: [],
  slides: [],
  infographics: [],
  notebooks: []
};

// Store pending download name for renaming
let pendingDownloadName = null;
let pendingDownloadType = null;

// Batch download mode - capture URLs instead of downloading
let batchDownloadMode = false;
let capturedDownload = null;
let batchStatus = '';

// Single download intercept mode - capture and re-download without opening tab
let interceptMode = false;
let interceptedDownload = null;
let redownloadInfo = null; // Track re-download to handle in onDeterminingFilename

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ARTIFACT_DETECTED':
      handleArtifactDetected(message.data);
      sendResponse({ success: true });
      break;

    case 'GET_ARTIFACTS':
      sendResponse({ artifacts: capturedArtifacts });
      break;

    case 'DOWNLOAD_ARTIFACT':
      downloadArtifact(message.data);
      sendResponse({ success: true });
      break;

    case 'CLEAR_ARTIFACTS':
      clearArtifacts();
      sendResponse({ success: true });
      break;

    case 'SET_PENDING_DOWNLOAD':
      // Store the name for the next download from NotebookLM
      pendingDownloadName = message.name;
      pendingDownloadType = message.artifactType;
      console.log('[Background] Pending download set:', pendingDownloadName, pendingDownloadType);
      // Clear after 30 seconds if not used
      setTimeout(() => {
        pendingDownloadName = null;
        pendingDownloadType = null;
      }, 30000);
      sendResponse({ success: true });
      break;

    case 'START_INTERCEPT_DOWNLOAD':
      // Enable intercept mode - capture next download and re-download without tab
      interceptMode = true;
      interceptedDownload = null;
      pendingDownloadName = message.name;
      pendingDownloadType = message.artifactType;
      console.log('[Background] Intercept mode enabled for:', pendingDownloadName);
      // Clear after 15 seconds if not used
      setTimeout(() => {
        if (interceptMode) {
          interceptMode = false;
          console.log('[Background] Intercept mode timeout');
        }
      }, 15000);
      sendResponse({ success: true });
      break;

    case 'GET_INTERCEPTED_DOWNLOAD':
      // Check if download was intercepted
      if (interceptedDownload) {
        const result = { ...interceptedDownload };
        interceptedDownload = null;
        sendResponse({ success: true, ...result });
      } else {
        sendResponse({ success: false });
      }
      break;

    case 'CANCEL_INTERCEPT':
      // Cancel intercept mode (wasn't needed)
      if (interceptMode) {
        interceptMode = false;
        console.log('[Background] Intercept mode cancelled');
      }
      sendResponse({ success: true });
      break;

    case 'START_BATCH_DOWNLOAD':
      // Only reset if not already in batch mode (prevents double-click issues)
      if (!batchDownloadMode) {
        batchDownloadMode = true;
        capturedDownload = null;
        console.log('[Background] Batch download mode started');
      } else {
        console.log('[Background] Already in batch mode, skipping reset');
      }
      sendResponse({ success: true });
      break;

    case 'END_BATCH_DOWNLOAD':
      batchDownloadMode = false;
      capturedDownload = null;
      console.log('[Background] Batch download mode ended');
      sendResponse({ success: true });
      break;

    case 'GET_CAPTURED_DOWNLOAD':
      if (capturedDownload) {
        const result = { captured: true, ...capturedDownload };
        capturedDownload = null; // Clear after retrieval
        sendResponse(result);
      } else {
        sendResponse({ captured: false });
      }
      break;

    case 'FETCH_FILE_CONTENT':
      // Fetch file content from URL (with cookies/auth)
      fetchFileContent(message.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true; // Keep channel open for async

    case 'BATCH_DOWNLOAD_ALL':
      // Run batch download entirely in background (popup may close)
      runBatchDownload(message.tabId, message.items)
        .then(result => {
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

    case 'GET_BATCH_STATUS':
      sendResponse({
        inProgress: batchDownloadMode,
        status: batchStatus
      });
      break;
  }
  return true; // Keep channel open for async response
});

// Capture downloads as soon as they're created (backup method)
chrome.downloads.onCreated.addListener((downloadItem) => {
  const isFromNotebookLM = downloadItem.url?.includes('notebooklm') ||
                           downloadItem.url?.includes('googleusercontent') ||
                           downloadItem.referrer?.includes('notebooklm');

  console.log('[Background] Download created:', downloadItem.id, 'URL:', downloadItem.url?.substring(0, 100), 'batchMode:', batchDownloadMode, 'interceptMode:', interceptMode);

  // INTERCEPT MODE - Capture, cancel, and re-download without opening tab
  if (interceptMode && isFromNotebookLM && downloadItem.url) {
    console.log('[Background] Intercepting download in intercept mode');

    // Determine file extension BEFORE async operations
    let extension = '';

    // Try to get extension from filename
    if (downloadItem.filename) {
      const match = downloadItem.filename.match(/\.[^.]+$/);
      extension = match ? match[0] : '';
    }

    // Fallback: use MIME type or artifact type
    if (!extension) {
      if (downloadItem.mime) {
        const mimeExtensions = {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'application/pdf': '.pdf',
          'audio/wav': '.wav',
          'audio/mpeg': '.mp3'
        };
        extension = mimeExtensions[downloadItem.mime] || '';
      }

      // Last resort: use artifact type
      if (!extension && pendingDownloadType === 'Infographic') {
        extension = '.png';
      } else if (!extension && pendingDownloadType === 'Slides') {
        extension = '.pdf';
      } else if (!extension && pendingDownloadType === 'Audio Overview') {
        extension = '.wav';
      }
    }

    // Create new filename
    const newFilename = sanitizeFilename(pendingDownloadName || 'download') + extension;
    console.log('[Background] Re-downloading as:', newFilename, '(extension from:', downloadItem.filename ? 'filename' : downloadItem.mime ? 'mime' : 'type', ')');

    // CRITICAL: Disable intercept mode BEFORE re-downloading to prevent loop
    interceptMode = false;

    // Store re-download info for onDeterminingFilename handler
    redownloadInfo = {
      filename: newFilename,
      originalId: downloadItem.id
    };

    // Clear pending download variables (no longer needed)
    pendingDownloadName = null;
    pendingDownloadType = null;

    // Immediately cancel the download SYNCHRONOUSLY to prevent tab opening
    chrome.downloads.cancel(downloadItem.id).then(() => {
      console.log('[Background] Cancelled original download:', downloadItem.id);
    }).catch((e) => {
      console.error('[Background] Failed to cancel download:', e);
    });

    // Wrap re-download in IIFE
    (async () => {

      // Re-download directly (this won't open a tab)
      const newDownloadId = await chrome.downloads.download({
        url: downloadItem.url,
        saveAs: false
        // Don't set filename here - let onDeterminingFilename handle it
      });

      console.log('[Background] Re-download started:', newDownloadId);

      // Store info for retrieval
      interceptedDownload = {
        originalId: downloadItem.id,
        newId: newDownloadId,
        filename: newFilename,
        url: downloadItem.url
      };

      // Erase the cancelled download from history
      setTimeout(() => {
        chrome.downloads.erase({ id: downloadItem.id }).catch(() => {});
      }, 1000);
    })();

    return;
  }

  // BATCH MODE - Existing batch download logic
  if (batchDownloadMode && isFromNotebookLM && downloadItem.url) {
    // Capture the URL and download ID - don't cancel yet, we need to fetch first
    if (!capturedDownload) {
      capturedDownload = {
        url: downloadItem.url,
        downloadId: downloadItem.id,
        mime: downloadItem.mime,
        name: pendingDownloadName,
        type: pendingDownloadType
      };
      console.log('[Background] Captured download via onCreated:', capturedDownload.url?.substring(0, 100));
      // Don't cancel here - let the fetch happen first
    }
  }
});

// Intercept downloads from NotebookLM and rename them
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  // Check if this download is from NotebookLM
  const isFromNotebookLM = downloadItem.url?.includes('notebooklm') ||
                           downloadItem.referrer?.includes('notebooklm') ||
                           downloadItem.finalUrl?.includes('googleusercontent');

  console.log('[Background] Download intercepted:', downloadItem.id, downloadItem.filename, 'from NotebookLM:', isFromNotebookLM, 'batchMode:', batchDownloadMode, 'pendingName:', pendingDownloadName, 'redownloadInfo:', redownloadInfo?.filename);

  // Check if this is the ORIGINAL download being cancelled (skip it)
  if (redownloadInfo && downloadItem.id === redownloadInfo.originalId) {
    console.log('[Background] Skipping original download (will be cancelled)');
    return false; // Let it use default name, we'll cancel it anyway
  }

  // Check if this is a re-download from intercept mode
  if (redownloadInfo && isFromNotebookLM) {
    const filename = redownloadInfo.filename;
    redownloadInfo = null; // Clear after use
    console.log('[Background] Renaming re-download to:', filename);
    suggest({ filename: filename });
    return true;
  }

  // Skip if no pending download name (not ours)
  if (!pendingDownloadName) {
    console.log('[Background] Skipping rename - no pending download name');
    return false;
  }

  if (isFromNotebookLM && pendingDownloadName) {
    // Determine file extension
    let extension = '';
    const originalFilename = downloadItem.filename || '';

    if (originalFilename.includes('.')) {
      extension = originalFilename.substring(originalFilename.lastIndexOf('.'));
    } else if (downloadItem.mime) {
      // Guess extension from MIME type
      const mimeExtensions = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/svg+xml': '.svg',
        'application/pdf': '.pdf',
        'audio/wav': '.wav',
        'audio/mpeg': '.mp3',
        'video/mp4': '.mp4'
      };
      extension = mimeExtensions[downloadItem.mime] || '';
    }

    // Create new filename
    const newFilename = sanitizeFilename(pendingDownloadName) + extension;
    console.log('[Background] Renaming download to:', newFilename);

    // In batch mode, onCreated already handled this - just prevent the download
    if (batchDownloadMode) {
      // Update captured download with filename if we have it
      if (capturedDownload && capturedDownload.downloadId === downloadItem.id) {
        capturedDownload.filename = newFilename;
      }
      console.log('[Background] Batch mode - skipping rename, download will be cancelled');

      // Clear pending name
      pendingDownloadName = null;
      pendingDownloadType = null;

      // Don't suggest anything - let onCreated handle the cancel
      return false;
    }

    // Clear pending name
    pendingDownloadName = null;
    pendingDownloadType = null;

    suggest({ filename: newFilename });
    return true; // We handled this
  }

  // Let the download proceed with original name
  return false;
});

function handleArtifactDetected(data) {
  const { type, artifact } = data;

  if (capturedArtifacts[type]) {
    // Check for duplicates
    const exists = capturedArtifacts[type].some(a => a.id === artifact.id);
    if (!exists) {
      capturedArtifacts[type].push({
        ...artifact,
        capturedAt: Date.now()
      });

      // Update badge
      updateBadge();

      // Store in chrome.storage for persistence
      chrome.storage.local.set({ capturedArtifacts });
    }
  }
}

function updateBadge() {
  const total = Object.values(capturedArtifacts).reduce((sum, arr) => sum + arr.length, 0);
  chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
}

async function downloadArtifact(data) {
  const { url, filename, type } = data;

  try {
    if (type === 'blob' || type === 'dataurl') {
      // Data URLs can be downloaded directly
      chrome.downloads.download({
        url: url,
        filename: sanitizeFilename(filename),
        saveAs: true
      });
    } else {
      // Direct URL download
      chrome.downloads.download({
        url: url,
        filename: sanitizeFilename(filename),
        saveAs: true
      });
    }
  } catch (error) {
    console.error('Download failed:', error);
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
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

function clearArtifacts() {
  capturedArtifacts.audio = [];
  capturedArtifacts.slides = [];
  capturedArtifacts.infographics = [];
  capturedArtifacts.notebooks = [];
  chrome.storage.local.set({ capturedArtifacts });
  updateBadge();
}

// Restore artifacts from storage on startup
chrome.storage.local.get(['capturedArtifacts'], (result) => {
  if (result.capturedArtifacts) {
    Object.assign(capturedArtifacts, result.capturedArtifacts);
    updateBadge();
  }
});

// Run batch download entirely in background
async function runBatchDownload(tabId, items) {
  console.log('[Background] Starting batch download for', items.length, 'items');

  batchDownloadMode = true;
  batchStatus = 'Starting...';
  const downloadedFiles = [];
  const errors = [];

  // We'll collect files as base64 and create zip at the end
  const fileContents = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    batchStatus = `Downloading ${i + 1}/${items.length}: ${item.label}`;
    console.log('[Background]', batchStatus);

    try {
      // Set pending name
      pendingDownloadName = item.label;
      pendingDownloadType = item.type;
      capturedDownload = null;

      // Trigger the download via content script
      await chrome.scripting.executeScript({
        target: { tabId },
        func: clickDownloadForItemInPage,
        args: [item.index]
      });

      // Wait for download to be captured
      const captured = await waitForCapture(8000);

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
          const extension = getExtensionFromMime(fetchResult.mime) || getExtensionFromType(item.type);
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

  batchDownloadMode = false;
  batchStatus = 'Creating ZIP...';
  console.log('[Background] Creating ZIP with', fileContents.length, 'files');

  // Create ZIP and download
  if (fileContents.length > 0) {
    try {
      const zipBase64 = await createZipFromFiles(fileContents);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      // Download the ZIP
      chrome.downloads.download({
        url: `data:application/zip;base64,${zipBase64}`,
        filename: `notebooklm-export-${timestamp}.zip`,
        saveAs: true
      });

      batchStatus = `Complete: ${downloadedFiles.length} files`;
      return { success: true, count: downloadedFiles.length };
    } catch (zipError) {
      console.error('[Background] ZIP creation failed:', zipError);
      batchStatus = 'ZIP creation failed';
      return { success: false, error: zipError.message };
    }
  } else {
    batchStatus = 'No files downloaded';
    return { success: false, error: 'No files downloaded', errors };
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

// Function to inject into page to click download
function clickDownloadForItemInPage(itemIndex) {
  const moreButtons = document.querySelectorAll('button[aria-label="More"]');
  console.log('[NotebookLM Takeout] Clicking More button at index', itemIndex);

  const btn = moreButtons[itemIndex];
  if (!btn) {
    console.error('[NotebookLM Takeout] Button not found at index', itemIndex);
    return;
  }

  btn.click();

  // Wait for menu, then click Download
  setTimeout(() => {
    const menuItems = document.querySelectorAll('.mat-mdc-menu-item');
    for (const item of menuItems) {
      const textSpan = item.querySelector('.mat-mdc-menu-item-text');
      const text = (textSpan?.textContent || '').trim().toLowerCase();
      if (text === 'download') {
        console.log('[NotebookLM Takeout] Clicking Download');
        item.click();
        return;
      }
    }
    // Close menu if no download found
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }, 400);
}

// Function to inject into page to fetch file with credentials
async function fetchFileInPage(url) {
  try {
    console.log('[NotebookLM Takeout] Fetching:', url.substring(0, 80));

    const response = await fetch(url, {
      credentials: 'include'
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Convert to base64
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);

    console.log('[NotebookLM Takeout] Fetched:', uint8Array.length, 'bytes, mime:', blob.type);

    return {
      success: true,
      data: base64,
      mime: blob.type,
      size: uint8Array.length
    };
  } catch (error) {
    console.error('[NotebookLM Takeout] Fetch error:', error);
    return { success: false, error: error.message };
  }
}

// Helper functions for batch download
function getExtensionFromMime(mimeType) {
  const mimeMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'audio/wav': '.wav',
    'audio/mpeg': '.mp3',
    'video/mp4': '.mp4'
  };
  return mimeMap[mimeType] || '';
}

function getExtensionFromType(type) {
  const typeMap = {
    'Slides': '.pdf',
    'Infographic': '.png',
    'Audio Overview': '.wav'
  };
  return typeMap[type] || '.bin';
}

// Simple ZIP creation using only base64 (no external library needed in service worker)
async function createZipFromFiles(files) {
  // We need to create a ZIP file manually since we can't use JSZip in service worker
  // Use a simple ZIP format

  const encoder = new TextEncoder();
  const chunks = [];

  // Local file headers and data
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const filenameBytes = encoder.encode(file.filename);
    const fileData = base64ToUint8Array(file.data);

    // Local file header
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed
    view.setUint16(6, 0, true); // Flags
    view.setUint16(8, 0, true); // Compression (store)
    view.setUint16(10, 0, true); // Mod time
    view.setUint16(12, 0, true); // Mod date
    view.setUint32(14, crc32(fileData), true); // CRC-32
    view.setUint32(18, fileData.length, true); // Compressed size
    view.setUint32(22, fileData.length, true); // Uncompressed size
    view.setUint16(26, filenameBytes.length, true); // Filename length
    view.setUint16(28, 0, true); // Extra field length

    localHeader.set(filenameBytes, 30);

    chunks.push(localHeader);
    chunks.push(fileData);

    // Store info for central directory
    centralDirectory.push({
      filename: filenameBytes,
      crc: crc32(fileData),
      size: fileData.length,
      offset: offset
    });

    offset += localHeader.length + fileData.length;
  }

  // Central directory
  const centralStart = offset;
  for (const entry of centralDirectory) {
    const centralHeader = new Uint8Array(46 + entry.filename.length);
    const view = new DataView(centralHeader.buffer);

    view.setUint32(0, 0x02014b50, true); // Central directory signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed
    view.setUint16(8, 0, true); // Flags
    view.setUint16(10, 0, true); // Compression
    view.setUint16(12, 0, true); // Mod time
    view.setUint16(14, 0, true); // Mod date
    view.setUint32(16, entry.crc, true); // CRC-32
    view.setUint32(20, entry.size, true); // Compressed size
    view.setUint32(24, entry.size, true); // Uncompressed size
    view.setUint16(28, entry.filename.length, true); // Filename length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // Comment length
    view.setUint16(34, 0, true); // Disk number
    view.setUint16(36, 0, true); // Internal attributes
    view.setUint32(38, 0, true); // External attributes
    view.setUint32(42, entry.offset, true); // Offset

    centralHeader.set(entry.filename, 46);
    chunks.push(centralHeader);
    offset += centralHeader.length;
  }

  // End of central directory
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true); // End signature
  endView.setUint16(4, 0, true); // Disk number
  endView.setUint16(6, 0, true); // Central directory disk
  endView.setUint16(8, centralDirectory.length, true); // Entries on this disk
  endView.setUint16(10, centralDirectory.length, true); // Total entries
  endView.setUint32(12, offset - centralStart, true); // Central directory size
  endView.setUint32(16, centralStart, true); // Central directory offset
  endView.setUint16(20, 0, true); // Comment length

  chunks.push(endRecord);

  // Combine all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const zipData = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    zipData.set(chunk, pos);
    pos += chunk.length;
  }

  // Convert to base64
  let binary = '';
  for (let i = 0; i < zipData.length; i++) {
    binary += String.fromCharCode(zipData[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// CRC-32 calculation
function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = getCRC32Table();
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function getCRC32Table() {
  if (!getCRC32Table.table) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    getCRC32Table.table = table;
  }
  return getCRC32Table.table;
}
