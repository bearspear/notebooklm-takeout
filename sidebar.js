// NotebookLM Takeout - Sidebar Script

// Enhanced logging utility for structured logging
const logger = {
  info: (context, message, data) => {
    console.log(`[NotebookLM Takeout] [${context}] ${message}`, data || '');
  },
  warn: (context, message, data) => {
    console.warn(`[NotebookLM Takeout] [${context}] ${message}`, data || '');
  },
  error: (context, message, error) => {
    console.error(`[NotebookLM Takeout] [${context}] ${message}`, error || '');
  },
  download: (itemName, status, details) => {
    const statusIcon = status === 'success' ? '✓' : status === 'error' ? '✗' : '⏳';
    console.log(`[NotebookLM Takeout] [Download] ${statusIcon} ${itemName}`, details || '');
  }
};

let currentTabId = null;
let autoRefreshInterval = null;
let settings = {
  autoZip: false,
  showNotifications: true,
  refreshInterval: 10
};

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  await loadSettings();
  await checkStatus();
  setupEventListeners();
  setupTabSwitching();
  await scanSourcesPage(); // Start with Sources tab since it's now the default

  // Monitor tab changes
  chrome.tabs.onActivated.addListener(handleTabChange);
  chrome.tabs.onUpdated.addListener(handleTabUpdate);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['settings']);
  if (stored.settings) {
    settings = { ...settings, ...stored.settings };
  }

  // Apply settings to UI
  document.getElementById('auto-zip-checkbox').checked = settings.autoZip;
  document.getElementById('show-notifications-checkbox').checked = settings.showNotifications;
  document.getElementById('refresh-interval-input').value = settings.refreshInterval;
}

async function saveSettings() {
  settings.autoZip = document.getElementById('auto-zip-checkbox').checked;
  settings.showNotifications = document.getElementById('show-notifications-checkbox').checked;
  settings.refreshInterval = parseInt(document.getElementById('refresh-interval-input').value) || 10;

  await chrome.storage.local.set({ settings });
}

function setupEventListeners() {
  document.getElementById('rescan-btn').addEventListener('click', scanPage);

  document.getElementById('auto-refresh-checkbox').addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').style.display = 'block';
  });

  document.getElementById('close-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').style.display = 'none';
    saveSettings();
  });

  // Settings inputs
  document.querySelectorAll('#settings-panel input').forEach(input => {
    input.addEventListener('change', saveSettings);
  });

  // Sources scan button
  const scanSourcesBtn = document.getElementById('scan-sources-btn');
  if (scanSourcesBtn) {
    scanSourcesBtn.addEventListener('click', scanSourcesPage);
  }
}

function setupTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetTab = btn.dataset.tab;

      // Update button states
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content visibility
      tabContents.forEach(content => {
        if (content.dataset.tabContent === targetTab) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });

      // Trigger scan for the active tab
      if (targetTab === 'notes') {
        await scanNotesPage();
      } else if (targetTab === 'artifacts') {
        await scanPage();
      } else if (targetTab === 'sources') {
        await scanSourcesPage();
      }
    });
  });
}

function startAutoRefresh() {
  stopAutoRefresh(); // Clear any existing interval

  const interval = settings.refreshInterval * 1000;
  autoRefreshInterval = setInterval(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('notebooklm.google.com')) {
      await scanPage();
    }
  }, interval);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

async function handleTabChange(activeInfo) {
  currentTabId = activeInfo.tabId;
  await checkStatus();
  await scanPage();
}

async function handleTabUpdate(tabId, changeInfo, tab) {
  // Only update if this is the active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id === tabId) {
    if (changeInfo.status === 'complete') {
      await checkStatus();
      await scanPage();
    }
  }
}

// ==================== RETRY LOGIC ====================

/**
 * Retry a download function with exponential backoff
 * @param {Function} downloadFn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {string} itemName - Name of item being downloaded (for logging)
 * @returns {Promise} Result from downloadFn or throws after all retries
 */
async function retryDownload(downloadFn, maxRetries = 3, itemName = 'item') {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.download(itemName, 'progress', `Attempt ${attempt}/${maxRetries}`);
      const result = await downloadFn();

      if (result && result.success !== false) {
        logger.download(itemName, 'success', `Succeeded on attempt ${attempt}`);
        return result;
      }

      // If result has success: false, treat as error
      lastError = new Error(result.error || 'Download returned failure');
      logger.warn('Download', `Attempt ${attempt} failed for ${itemName}`, lastError.message);

    } catch (error) {
      lastError = error;
      logger.warn('Download', `Attempt ${attempt} failed for ${itemName}`, error.message);
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s - max 5s)
    if (attempt < maxRetries) {
      const delayMs = Math.min(Math.pow(2, attempt - 1) * 1000, 5000);
      logger.info('Download', `Waiting ${delayMs}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries failed
  logger.error('Download', `All ${maxRetries} attempts failed for ${itemName}`, lastError);
  throw lastError || new Error('Download failed after all retries');
}

// ==================== MESSAGE-BASED DOWNLOAD ====================

/**
 * Download artifact using message passing (NEW PATTERN)
 * Replaces script injection with content script messaging
 */
async function downloadArtifact(tabId, artifactIndex, artifactType, artifactName) {
  logger.info('Download', `Downloading artifact ${artifactIndex} (${artifactType})`, artifactName);

  try {
    // Ensure content script is loaded
    await ensureContentScriptLoaded(tabId);

    // For Reports and Data Tables, skip More button entirely - content script will click artifact directly
    let response;
    if (artifactType === 'Report' || artifactType === 'Data Table') {
      logger.info('Download', `${artifactType} detected - skipping More button, extracting content directly`);

      response = await chrome.tabs.sendMessage(tabId, {
        type: 'DOWNLOAD_ARTIFACT',
        data: {
          artifactIndex: artifactIndex,
          artifactType: artifactType,
          artifactName: artifactName,
          skipMoreButton: true
        }
      });
    } else {
      // For non-Report artifacts: Click the More button in page context
      logger.info('Download', `Clicking More button for artifact ${artifactIndex}...`);
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: clickArtifactMoreButton,
        args: [artifactIndex]
      });

      if (!clickResult || !clickResult[0]?.result?.success) {
        throw new Error(clickResult[0]?.result?.error || 'Failed to click More button');
      }

      // Wait for menu to appear
      await new Promise(resolve => setTimeout(resolve, 500));

      // For non-extractable artifacts, enable intercept mode BEFORE clicking download button
      // This prevents tabs from opening for slides and infographics
      logger.info('Download', `Enabling intercept mode (preventive) for: "${artifactName}"`);
      await chrome.runtime.sendMessage({
        type: 'START_INTERCEPT_DOWNLOAD',
        name: artifactName,
        artifactType: artifactType
      });

      // Send download message to content script
      response = await chrome.tabs.sendMessage(tabId, {
        type: 'DOWNLOAD_ARTIFACT',
        data: {
          artifactIndex: artifactIndex,
          artifactType: artifactType,
          artifactName: artifactName,
          moreButtonAlreadyClicked: true
        }
      });
    }

    // Handle response (common for both Reports and other artifacts)
    if (!response || !response.success) {
      throw new Error(response?.error || 'Download failed');
    }

    logger.download(artifactName, 'success', `Method: ${response.method}, Duration: ${response.duration}ms`);

    // Handle different download methods
    if (response.method === 'content_extraction') {
      // Content extraction (Reports and Data Tables)
      const filename = response.title || artifactName || 'report';

      // For Data Tables, convert to CSV
      if (artifactType === 'Data Table') {
        logger.info('Download', `Downloading extracted content as CSV: "${filename}"`);

        // Convert HTML table to CSV
        let csvContent;
        if (response.format === 'html') {
          logger.info('Download', `Converting HTML table to CSV for: "${filename}"`);
          csvContent = convertTableToCSV(response.data);
        } else {
          csvContent = response.data;
        }

        // Create CSV blob and download
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(filename) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Cancel intercept mode (wasn't needed)
        chrome.runtime.sendMessage({ type: 'CANCEL_INTERCEPT' }).catch(() => {});

        logger.download(filename, 'success', `Downloaded as CSV (${csvContent.length} chars)`);
      } else {
        // For Reports and other content, convert to markdown
        logger.info('Download', `Downloading extracted content as markdown: "${filename}"`);

        // Convert HTML to markdown (content.js returns HTML, we convert it here)
        let markdownContent;
        if (response.format === 'html') {
          logger.info('Download', `Converting HTML to markdown for: "${filename}"`);
          markdownContent = convertToMarkdown(response.data, [], filename);
        } else {
          // Already markdown
          markdownContent = response.data;
        }

        // Create markdown blob and download
        const blob = new Blob([markdownContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(filename) + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Cancel intercept mode (wasn't needed)
        chrome.runtime.sendMessage({ type: 'CANCEL_INTERCEPT' }).catch(() => {});

        logger.download(filename, 'success', `Downloaded as markdown (${markdownContent.length} chars)`);
      }
    } else if (response.method === 'svg_extract' || response.method === 'canvas_export') {
      // Direct extraction - download the data URL
      // Use title from response (extracted from page) or fall back to artifactName parameter
      const filename = response.title || artifactName || 'infographic';
      logger.info('Download', `Using filename: "${filename}"`, { from: response.title ? 'response' : 'parameter' });
      await handleSVGDownload(response.data, filename, response.format);

      // Cancel intercept mode (wasn't needed)
      chrome.runtime.sendMessage({ type: 'CANCEL_INTERCEPT' }).catch(() => {});
    } else if (response.method === 'button_click') {
      // Button click - intercept mode was already enabled, wait for completion
      const filename = response.title || artifactName;

      logger.info('Download', `Waiting for background intercept to complete...`);

      // Wait for interception to complete
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Check if download was intercepted successfully
      const result = await chrome.runtime.sendMessage({
        type: 'GET_INTERCEPTED_DOWNLOAD'
      });

      if (result && result.success) {
        logger.download(filename, 'success', `Downloaded without tab: ${result.filename}`);
      } else {
        logger.warn('Download', 'Interception may have failed');
      }
    }

    return response;

  } catch (error) {
    logger.error('Download', `Failed to download ${artifactName}`, error);
    throw error;
  }
}

/**
 * Handle SVG/Canvas data URL downloads
 * Converts data URL to blob and triggers download
 */
async function handleSVGDownload(dataUrl, filename, format) {
  // Validate and sanitize filename
  if (!filename || filename.trim() === '') {
    filename = `infographic-${Date.now()}`;
    logger.warn('Download', 'Empty filename provided, using default', filename);
  }

  logger.info('Download', `Handling ${format} download`, filename);

  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Create download URL
    const url = URL.createObjectURL(blob);

    // Trigger download
    const extension = format === 'svg' ? 'svg' : 'png';
    const sanitizedFilename = sanitizeFilename(filename) + '.' + extension;

    logger.info('Download', `Sanitized filename: "${sanitizedFilename}"`);

    await chrome.downloads.download({
      url: url,
      filename: sanitizedFilename,
      saveAs: false
    });

    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    logger.download(filename, 'success', `${format.toUpperCase()} downloaded as ${sanitizedFilename}`);

  } catch (error) {
    logger.error('Download', `Failed to handle ${format} download`, error);
    throw error;
  }
}

/**
 * Wait for Chrome download to complete
 * Uses chrome.downloads API to verify download
 */
async function waitForChromeDownload(expectedFilename, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let downloadId = null;

    const timeoutId = setTimeout(() => {
      if (listener) {
        chrome.downloads.onCreated.removeListener(listener);
      }
      logger.warn('Download', `Timeout waiting for download: ${expectedFilename}`);
      resolve(); // Don't reject - download might still succeed
    }, timeout);

    const listener = (downloadItem) => {
      // Check if this download matches our expected filename
      const filename = downloadItem.filename || '';
      const matches = filename.toLowerCase().includes(expectedFilename.toLowerCase().substring(0, 20));

      if (matches) {
        downloadId = downloadItem.id;
        logger.info('Download', `Chrome download started: ${downloadItem.filename}`);

        // Monitor download progress
        const progressListener = (delta) => {
          if (delta.id === downloadId && delta.state) {
            if (delta.state.current === 'complete') {
              clearTimeout(timeoutId);
              chrome.downloads.onChanged.removeListener(progressListener);
              chrome.downloads.onCreated.removeListener(listener);
              logger.download(expectedFilename, 'success', `Downloaded in ${Date.now() - startTime}ms`);
              resolve();
            } else if (delta.state.current === 'interrupted') {
              clearTimeout(timeoutId);
              chrome.downloads.onChanged.removeListener(progressListener);
              chrome.downloads.onCreated.removeListener(listener);
              reject(new Error('Download interrupted'));
            }
          }
        };

        chrome.downloads.onChanged.addListener(progressListener);
      }
    };

    chrome.downloads.onCreated.addListener(listener);
  });
}

// ==================== STATUS CHECK ====================

async function checkStatus() {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('status-text');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;

    if (tab && tab.url && tab.url.includes('notebooklm.google.com')) {
      statusDot.classList.remove('inactive');
      statusDot.classList.add('active');
      statusText.textContent = 'Connected to NotebookLM';
    } else {
      statusDot.classList.remove('active');
      statusDot.classList.add('inactive');
      statusText.textContent = 'Not on NotebookLM';
    }
  } catch (error) {
    statusDot.classList.remove('active');
    statusDot.classList.add('inactive');
    statusText.textContent = 'Unable to check status';
  }
}

async function scanPage() {
  const resultsEl = document.getElementById('scan-results');
  const countBadge = document.getElementById('artifact-count');
  resultsEl.innerHTML = '<p class="scanning">Scanning...</p>';
  countBadge.textContent = '0';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url?.includes('notebooklm.google.com')) {
      resultsEl.innerHTML = '<p class="error">Please open NotebookLM first</p>';
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPageForItems
    });

    const items = results[0]?.result || [];

    if (items.length === 0) {
      resultsEl.innerHTML = '<p class="empty-message">No downloadable artifacts found.<br><span class="hint">Make sure you have generated content in Studio.</span></p>';
      return;
    }

    const enabledItems = items.filter(i => !i.disabled);
    countBadge.textContent = enabledItems.length;

    resultsEl.innerHTML = `
      ${items.map((item, idx) => `
        <div class="scan-item${item.disabled ? ' disabled' : ''}">
          <div class="scan-item-icon">
            ${getIconForType(item.type)}
          </div>
          <div class="scan-item-info">
            <strong>${escapeHtml(item.label)}</strong>
            <small>${escapeHtml(item.type)}${item.details ? ' · ' + escapeHtml(item.details) : ''}</small>
          </div>
          <button class="btn-icon download-single-btn" data-index="${item.index}" data-item-idx="${idx}" ${item.disabled ? 'disabled title="Study Guides not supported yet"' : `title="Download ${escapeHtml(item.label)}"`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            <span class="download-status"></span>
          </button>
        </div>
      `).join('')}
      ${enabledItems.length > 0 ? `
        <div class="download-all-controls">
          <button id="download-all-btn" class="btn btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            Download All (${enabledItems.length})
          </button>
          <label class="zip-checkbox">
            <input type="checkbox" id="zip-checkbox" ${settings.autoZip ? 'checked' : ''}> Zip
          </label>
        </div>
      ` : ''}
    `;

    // Store items for handlers
    window._scanItems = items;
    window._enabledItems = enabledItems;
    window._currentTabId = tab.id;

    // Add click handlers for individual download buttons with status feedback
    resultsEl.querySelectorAll('button[data-index]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index);
        const itemIdx = parseInt(btn.dataset.itemIdx);
        const item = items[itemIdx];
        const statusSpan = btn.querySelector('.download-status');

        // Disable button and show downloading status
        btn.disabled = true;
        if (statusSpan) {
          statusSpan.textContent = '⏳';
          statusSpan.className = 'download-status downloading';
        }

        try {
          await triggerItemDownload(tab.id, idx, item.label, item.type);

          // Show success status
          if (statusSpan) {
            statusSpan.textContent = '✓';
            statusSpan.className = 'download-status success';
          }

          // Re-enable button after delay
          setTimeout(() => {
            btn.disabled = false;
            if (statusSpan) {
              statusSpan.textContent = '';
              statusSpan.className = 'download-status';
            }
          }, 3000);

        } catch (error) {
          // Show error status
          if (statusSpan) {
            statusSpan.textContent = '✗';
            statusSpan.className = 'download-status error';
          }

          // Re-enable button after delay
          setTimeout(() => {
            btn.disabled = false;
            if (statusSpan) {
              statusSpan.textContent = '';
              statusSpan.className = 'download-status';
            }
          }, 3000);
        }
      });
    });

    // Add handler for Download All button
    const downloadAllBtn = document.getElementById('download-all-btn');
    if (downloadAllBtn) {
      downloadAllBtn.addEventListener('click', async () => {
        await downloadAllArtifacts(tab.id, enabledItems);
      });
    }

  } catch (error) {
    console.error('Scan failed:', error);
    resultsEl.innerHTML = `<p class="error">Scan failed: ${error.message}</p>`;
  }
}

// ==================== NOTE SCANNING ====================

// Helper to ensure content script is loaded
async function ensureContentScriptLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch (error) {
    if (error.message.includes('Receiving end does not exist')) {
      console.log('[NotebookLM Takeout] Content script not loaded, injecting...');
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    }
    throw error;
  }
}

// Sidebar function to trigger note scan
async function scanNotesPage() {
  const notesResults = document.getElementById('notes-results');
  const noteCount = document.getElementById('note-count');

  notesResults.innerHTML = '<p class="scanning">Scanning for notes...</p>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('notebooklm.google.com')) {
      notesResults.innerHTML = '<p class="empty-message">Please open NotebookLM first</p>';
      noteCount.textContent = '0';
      return;
    }

    // Ensure content script is loaded
    await ensureContentScriptLoaded(tab.id);

    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_NOTES' });
    const notes = response?.notes || [];
    window._currentNotes = notes;

    // Debug: Also get raw note data from page
    const debugResponse = await chrome.tabs.sendMessage(tab.id, { type: 'DEBUG_NOTES' });
    console.log('[NotebookLM Takeout] Scanned notes:', notes);
    console.log('[NotebookLM Takeout] Raw notes from page:', debugResponse?.notes);

    renderNotesList(notes);

  } catch (error) {
    console.error('Error scanning for notes:', error);
    notesResults.innerHTML = '<p class="error-message">Failed to scan for notes. Please refresh the NotebookLM page and try again.</p>';
    noteCount.textContent = '0';
  }
}

// Render notes list with checkboxes
function renderNotesList(notes) {
  const notesResults = document.getElementById('notes-results');
  const noteCount = document.getElementById('note-count');

  if (notes.length === 0) {
    notesResults.innerHTML = '<p class="empty-message">No notes found. Add source materials to your notebook.</p>';
    noteCount.textContent = '0';
    return;
  }

  noteCount.textContent = notes.length;

  notesResults.innerHTML = `
    <div class="select-all-container">
      <label>
        <input type="checkbox" id="select-all-notes">
        <span>Select All (${notes.length})</span>
      </label>
    </div>
    ${notes.map((note, idx) => {
      // Choose icon based on note type
      const isMindmap = note.type === 'Mindmap';
      const iconColor = isMindmap ? '#ea4335' : '#1a73e8';
      const iconPath = isMindmap
        ? 'M14 2l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h8zm-1 2H6v16h12V9h-5V4zM12 11c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm-5 4h2.5c-.3-.6-.5-1.3-.5-2s.2-1.4.5-2H7v4zm8.5 0H18v-4h-2.5c.3.6.5 1.3.5 2s-.2 1.4-.5 2z'
        : 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z';

      return `
      <div class="scan-item note-scan-item" data-index="${idx}">
        <div class="scan-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${iconColor}">
            <path d="${iconPath}"/>
          </svg>
        </div>
        <div class="scan-item-info">
          <strong>${escapeHtml(note.title)}</strong>
          <small>${escapeHtml(note.type)}</small>
        </div>
        <button class="btn-icon note-download-btn" data-index="${idx}" title="Export ${escapeHtml(note.title)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </button>
      </div>
      `;
    }).join('')}
    <div class="export-controls">
      <button id="export-notes-btn" class="btn btn-primary">
        Export Selected Notes
      </button>
    </div>
  `;

  // Setup Select All functionality
  const selectAllCheckbox = document.getElementById('select-all-notes');
  const noteItems = document.querySelectorAll('.note-scan-item');

  selectAllCheckbox.addEventListener('change', (e) => {
    noteItems.forEach(item => {
      if (e.target.checked) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
    updateSelectAllLabel();
  });

  // Make note items selectable by clicking
  noteItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't toggle if clicking the download button
      if (e.target.closest('.note-download-btn')) {
        return;
      }

      item.classList.toggle('selected');
      updateSelectAllLabel();
    });
  });

  function updateSelectAllLabel() {
    const selectedCount = document.querySelectorAll('.note-scan-item.selected').length;
    const label = selectAllCheckbox.nextElementSibling;

    // Update checkbox state
    if (selectedCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (selectedCount === notes.length) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    }

    label.textContent = selectedCount > 0
      ? `Selected (${selectedCount}/${notes.length})`
      : `Select All (${notes.length})`;
  }

  // Setup individual download buttons
  document.querySelectorAll('.note-download-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const note = notes[idx];
      await exportNotesAsMarkdown([note]);
    });
  });

  // Setup export button
  document.getElementById('export-notes-btn').addEventListener('click', async () => {
    const selectedItems = Array.from(document.querySelectorAll('.note-scan-item.selected'));
    const selected = selectedItems.map(item => notes[parseInt(item.dataset.index)]);

    if (selected.length === 0) {
      showToast('Please select at least one note', 'error');
      return;
    }

    await exportNotesAsMarkdown(selected);
  });
}

// ==================== CSV CONVERSION ====================

function convertTableToCSV(htmlContent) {
  // Log HTML structure for debugging
  logger.info('CSV', `HTML content length: ${htmlContent.length} chars`);
  logger.info('CSV', `HTML preview: ${htmlContent.substring(0, 500)}...`);

  // Parse HTML content
  const parser = new DOMParser();

  // Check if HTML starts with <tr> (table rows without table wrapper)
  // If so, wrap in a table element before parsing to prevent browser auto-correction
  let htmlToParse = htmlContent;
  const startsWithTr = htmlContent.trim().startsWith('<tr');

  if (startsWithTr) {
    logger.info('CSV', 'HTML starts with <tr>, wrapping in <table> for proper parsing');
    htmlToParse = `<table>${htmlContent}</table>`;
  }

  const doc = parser.parseFromString(htmlToParse, 'text/html');

  // Try multiple selectors to find the table
  let table = null;
  const tableSelectors = [
    'table',
    '[role="table"]',
    '.table',
    '[class*="table"]'
  ];

  for (const selector of tableSelectors) {
    table = doc.querySelector(selector);
    if (table) {
      logger.info('CSV', `Found table using selector: ${selector}`);
      break;
    }
  }

  if (!table) {
    const bodyContent = doc.body ? doc.body.innerHTML.substring(0, 1000) : 'No body';
    logger.error('CSV', `No table element found. Body content: ${bodyContent}`);
    throw new Error('No table found in HTML content');
  }

  // Find all rows within the table
  let allRows = table.querySelectorAll('tr');

  // If no tr elements, try role="row"
  if (allRows.length === 0) {
    logger.info('CSV', 'No <tr> elements found, trying role="row"');
    allRows = table.querySelectorAll('[role="row"]');
  }

  // If still no rows, try common div-based table structures
  if (allRows.length === 0) {
    logger.info('CSV', 'No role="row" elements found, trying .table-row');
    allRows = table.querySelectorAll('.table-row, [class*="row"]');
  }

  logger.info('CSV', `Found ${allRows.length} rows`);

  const rows = [];

  allRows.forEach((row, rowIndex) => {
    const cells = [];

    // Try multiple approaches to find cells
    let cellElements = row.querySelectorAll('th, td');

    // If no th/td, try role="cell"
    if (cellElements.length === 0) {
      cellElements = row.querySelectorAll('[role="cell"], [role="columnheader"], [role="rowheader"]');
    }

    // If still no cells, try common div-based structures
    if (cellElements.length === 0) {
      cellElements = row.querySelectorAll('.table-cell, [class*="cell"]');
    }

    if (cellElements.length === 0) {
      logger.info('CSV', `Row ${rowIndex}: No cells found`);
    }

    cellElements.forEach(cell => {
      // Get cell text content
      let cellText = cell.textContent.trim();

      // Escape quotes by doubling them
      cellText = cellText.replace(/"/g, '""');

      // If cell contains comma, newline, or quote, wrap in quotes
      if (cellText.includes(',') || cellText.includes('\n') || cellText.includes('"')) {
        cellText = `"${cellText}"`;
      }

      cells.push(cellText);
    });

    if (cells.length > 0) {
      rows.push(cells.join(','));
    }
  });

  logger.info('CSV', `Converted ${rows.length} rows to CSV`);

  if (rows.length === 0) {
    throw new Error('No table rows found to convert to CSV');
  }

  return rows.join('\n');
}

// ==================== MARKDOWN CONVERSION ====================

function convertToMarkdown(htmlContent, sources, noteTitle) {
  // Debug: Log what we're converting
  logger.info('Markdown', `Converting note: "${noteTitle}"`);
  logger.info('Markdown', `  - HTML content length: ${htmlContent.length} chars`);
  logger.info('Markdown', `  - Number of sources: ${sources?.length || 0}`);
  if (sources && sources.length > 0) {
    logger.info('Markdown', `  - Source indices: [${sources.map(s => s.sourceIndex).join(', ')}]`);
  }

  // Create a mapping from original sourceIndex to sequential display number
  // The HTML buttons show sequential numbers, but sources have original IDs
  const sourceIndexToDisplayNumber = new Map();
  const displayNumberToSource = new Map();

  if (sources && sources.length > 0) {
    sources.forEach((source, idx) => {
      const displayNumber = (idx + 1).toString();
      sourceIndexToDisplayNumber.set(source.sourceIndex, displayNumber);
      displayNumberToSource.set(source.sourceIndex, source);
      logger.info('Markdown', `  - Mapping: original ID ${source.sourceIndex} -> display #${displayNumber}`);
    });
  }

  // Initialize TurndownService (simple setup like working extension)
  const turndownService = new TurndownService({ headingStyle: 'atx' });

  // Track citation occurrences for back-references
  const citationOccurrences = new Map();

  // Custom rule for Report headings (uses role="heading" and aria-level)
  turndownService.addRule('reportHeadings', {
    filter: (node) => {
      return node.nodeName === 'DIV' &&
             node.getAttribute('role') === 'heading' &&
             node.hasAttribute('aria-level');
    },
    replacement: (content, node) => {
      const level = parseInt(node.getAttribute('aria-level')) || 1;
      const prefix = '#'.repeat(level);
      return `\n${prefix} ${content.trim()}\n\n`;
    }
  });

  // Custom rule for source-link elements
  turndownService.addRule('sourceLink', {
    filter: 'source-link',
    replacement: (content, node) => {
      const sourceIndex = node.dataset.sourceIndex;
      const linkText = node.textContent;
      const anchor = `src-${sourceIndex}`;
      return `[${linkText}](#${anchor})`;
    }
  });

  // Custom rule to strip Angular component wrappers
  turndownService.addRule('stripAngularComponents', {
    filter: (node) => {
      const nodeName = node.nodeName.toLowerCase();
      return nodeName === 'labs-tailwind-structural-element-view-v2' ||
             nodeName === 'labs-tailwind-doc-viewer' ||
             nodeName === 'report-viewer';
    },
    replacement: (content) => {
      return content; // Return inner content, strip wrapper
    }
  });

  // Custom rule for tables (convert to markdown table format)
  turndownService.addRule('tables', {
    filter: 'table',
    replacement: (content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';

      let markdown = '\n\n';

      // Process each row
      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        const cellContents = cells.map(cell => {
          // Get text content and clean it up
          let text = cell.textContent.trim();
          // Escape pipe characters
          text = text.replace(/\|/g, '\\|');
          // Replace newlines with spaces
          text = text.replace(/\n/g, ' ');
          return text;
        });

        // Add row
        markdown += '| ' + cellContents.join(' | ') + ' |\n';

        // Add separator after header row
        if (rowIndex === 0) {
          const separators = cells.map(() => '---');
          markdown += '| ' + separators.join(' | ') + ' |\n';
        }
      });

      markdown += '\n';
      return markdown;
    }
  });

  // Custom rule for citation buttons
  turndownService.addRule('citationButtons', {
    filter: (node) => {
      if (node.nodeName === 'BUTTON' && node.classList.contains('ng-star-inserted')) {
        return true;
      }
      if (node.nodeName === 'A' && node.getAttribute('href')?.startsWith('#cite')) {
        return true;
      }
      if (node.nodeName === 'SOURCE-LINK' || node.hasAttribute('data-source-index')) {
        return true;
      }
      return false;
    },
    replacement: (content, node) => {
      // Debug: Log what we're processing
      logger.info('Citation', `Processing citation node: ${node.nodeName}`);
      logger.info('Citation', `  - content: "${content}"`);
      logger.info('Citation', `  - data-source-index: ${node.getAttribute('data-source-index')}`);
      logger.info('Citation', `  - href: ${node.getAttribute('href')}`);
      logger.info('Citation', `  - outerHTML preview: ${node.outerHTML?.substring(0, 200)}`);

      let originalSourceIndex = node.getAttribute('data-source-index') ||
                                node.getAttribute('href')?.replace('#cite-', '');

      if (!originalSourceIndex && node.nodeName === 'BUTTON') {
        const span = node.querySelector('span');
        if (span) {
          originalSourceIndex = span.textContent.trim();
          logger.info('Citation', `  - extracted from BUTTON span: "${originalSourceIndex}"`);
        }
      }

      if (!originalSourceIndex) {
        originalSourceIndex = content.trim();
        logger.info('Citation', `  - using content as originalSourceIndex: "${originalSourceIndex}"`);
      }

      logger.info('Citation', `  - original sourceIndex: "${originalSourceIndex}"`);

      // Map original source ID to sequential display number
      let displayNumber = sourceIndexToDisplayNumber.get(originalSourceIndex);

      if (!displayNumber) {
        // Source not found in our extracted sources - use original number
        logger.info('Citation', `  - WARNING: Source ID ${originalSourceIndex} not found in sources, using original`);
        displayNumber = originalSourceIndex;
      } else {
        logger.info('Citation', `  - mapped to display number: ${displayNumber}`);
      }

      if (!citationOccurrences.has(displayNumber)) {
        citationOccurrences.set(displayNumber, 0);
      }
      const occurrenceCount = citationOccurrences.get(displayNumber) + 1;
      citationOccurrences.set(displayNumber, occurrenceCount);

      const output = `<sup><a id="cite-ref-${displayNumber}-${occurrenceCount}" href="#src-${displayNumber}">[${displayNumber}]</a></sup>`;
      logger.info('Citation', `  - generated: ${output}`);

      return output;
    }
  });

  // Convert main content
  let markdown = `# ${noteTitle}\n\n`;
  markdown += turndownService.turndown(htmlContent);

  // Clean up excessive newlines (more than 2 consecutive)
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  // Append sources section if present
  if (sources && sources.length > 0) {
    markdown += '\n\n---\n\n## Sources\n\n';

    // Deduplicate sources by sourceIndex
    const uniqueSources = new Map();
    sources.forEach(source => {
      if (!uniqueSources.has(source.sourceIndex)) {
        uniqueSources.set(source.sourceIndex, source);
      }
    });

    logger.info('Markdown', `  - Unique sources after dedup: ${uniqueSources.size}`);

    // Sort by source number
    const sortedSources = Array.from(uniqueSources.values()).sort((a, b) => {
      const numA = parseInt(a.sourceIndex) || 0;
      const numB = parseInt(b.sourceIndex) || 0;
      return numA - numB;
    });

    logger.info('Markdown', `  - Sorted source indices: [${sortedSources.map(s => s.sourceIndex).join(', ')}]`);

    // Write sources with display numbers (1, 2, 3...) instead of original IDs
    sortedSources.forEach((source, idx) => {
      const displayNumber = (idx + 1).toString(); // Sequential: 1, 2, 3...
      const originalId = source.sourceIndex;

      logger.info('Markdown', `  - Writing source: #${displayNumber} (original ID: ${originalId})`);
      markdown += `<a id="src-${displayNumber}"></a>\n`;

      // Make source number clickable to jump back to first citation
      markdown += `**[[${displayNumber}]](#cite-ref-${displayNumber}-1)** ${source.text}\n\n`;

      // Include the quote if available
      if (source.quote && source.quote.length > 0) {
        markdown += `> ${source.quote}\n\n`;
      }
    });
  }

  return markdown;
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

// ==================== EXPORT ORCHESTRATION ====================

async function exportNotesAsMarkdown(selectedNotes) {
  console.log('[NotebookLM Takeout] Starting export for notes:', selectedNotes.length);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Show overlay on the page
  await chrome.tabs.sendMessage(tab.id, {
    type: 'SHOW_EXPORT_OVERLAY',
    message: 'Preparing to export notes...'
  });

  const progressPanel = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  progressPanel.style.display = 'block';
  progressText.textContent = 'Preparing export...';
  progressFill.style.width = '0%';

  const exportedNotes = [];
  let cancelled = false;

  // Listen for cancellation
  const cancelListener = (message) => {
    if (message.type === 'CANCEL_EXPORT') {
      cancelled = true;
    }
  };
  chrome.runtime.onMessage.addListener(cancelListener);

  console.log('[NotebookLM Takeout] Current tab ID:', tab?.id);

  try {
    for (let i = 0; i < selectedNotes.length; i++) {
      // Check for cancellation
      if (cancelled) {
        console.log('[NotebookLM Takeout] Export cancelled by user');
        showToast('Export cancelled', 'warning');
        break;
      }

      const note = selectedNotes[i];
      const progress = ((i + 1) / selectedNotes.length) * 100;

      console.log(`[NotebookLM Takeout] Processing note ${i + 1}/${selectedNotes.length}:`, note.title, 'index:', note.index);

      // Update sidebar progress
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `Processing ${i + 1}/${selectedNotes.length}: ${note.title}`;

      // Update page overlay
      await chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_EXPORT_OVERLAY',
        message: `Processing ${i + 1}/${selectedNotes.length}: ${note.title}`,
        progress: progress
      });

      try {
        // Extract note content via content script
        console.log('[NotebookLM Takeout] Sending message to extract note content...');

        const noteData = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_NOTE',
          data: {
            noteIndex: note.index,
            noteTitle: note.title
          }
        });

        console.log('[NotebookLM Takeout] Note data received:', noteData);

        if (noteData && !noteData.error) {
          // Check if it's a mindmap
          if (noteData.isMindmap) {
            console.log('[NotebookLM Takeout] Processing mindmap SVG...');
            exportedNotes.push({
              title: note.title,
              isMindmap: true,
              svgContent: noteData.svgContent,
              treeData: noteData.treeData
            });
          } else {
            // Convert to markdown
            const markdown = convertToMarkdown(noteData.html, noteData.sources, note.title);

            exportedNotes.push({
              title: note.title,
              markdown: markdown
            });
          }

          console.log(`[NotebookLM Takeout] ✓ Successfully extracted note ${i + 1}/${selectedNotes.length}`);
        } else {
          console.error(`Failed to extract note: ${note.title}`, noteData?.error);
          showToast(`Skipped: ${note.title} (${noteData?.error || 'unknown error'})`, 'warning');
        }

      } catch (error) {
        console.error(`Failed to process note: ${note.title}`, error);
        showToast(`Error processing: ${note.title}`, 'error');
      } finally {
        // Always try to navigate back, even if extraction failed
        try {
          console.log('[NotebookLM Takeout] Navigating back to notes list...');
          const backResponse = await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK' });
          console.log('[NotebookLM Takeout] Navigate back response:', backResponse);

          // Extra long delay between notes to ensure DOM fully stabilizes
          console.log('[NotebookLM Takeout] Waiting for DOM to stabilize...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          console.log('[NotebookLM Takeout] Ready for next note');
        } catch (backError) {
          console.error('[NotebookLM Takeout] Failed to navigate back:', backError);
          // Try to continue anyway with even longer wait
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }
    }

    // Create ZIP with both formats (or download single file if only one item)
    if (exportedNotes.length > 0) {
      if (exportedNotes.length === 1 && exportedNotes[0].isMindmap) {
        // Single mindmap - download as ZIP with SVG and JSON
        const mindmap = exportedNotes[0];
        const zip = new JSZip();
        const baseName = sanitizeFilename(mindmap.title);

        zip.file(`${baseName}.svg`, mindmap.svgContent);
        zip.file(`${baseName}.json`, JSON.stringify(mindmap.treeData, null, 2));

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `${baseName}-${timestamp}.zip`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Successfully exported mindmap`, 'success');
      } else {
        // Multiple items or markdown notes - create ZIP
        await createNotesZip(exportedNotes);
        showToast(`Successfully exported ${exportedNotes.length} notes`, 'success');
      }
    } else {
      showToast('No notes were exported', 'error');
    }

  } catch (error) {
    console.error('Export failed:', error);
    showToast('Export failed. Please try again.', 'error');
  } finally {
    // Remove cancellation listener
    chrome.runtime.onMessage.removeListener(cancelListener);

    // Hide page overlay
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'HIDE_EXPORT_OVERLAY'
      });
    } catch (error) {
      console.error('[NotebookLM Takeout] Failed to hide overlay:', error);
    }

    // Hide sidebar progress panel
    progressPanel.style.display = 'none';
  }
}

async function createNotesZip(notes) {
  const zip = new JSZip();

  // Separate notes and mindmaps
  const markdownNotes = notes.filter(n => !n.isMindmap);
  const mindmaps = notes.filter(n => n.isMindmap);

  // Create individual markdown files
  if (markdownNotes.length > 0) {
    const notesFolder = zip.folder('notes');
    markdownNotes.forEach(note => {
      const filename = sanitizeFilename(note.title) + '.md';
      notesFolder.file(filename, note.markdown);
    });

    // Create combined markdown file
    let combinedMarkdown = '# NotebookLM Notes Export\n\n';
    combinedMarkdown += `Exported: ${new Date().toLocaleString()}\n\n`;
    combinedMarkdown += `Total Notes: ${markdownNotes.length}\n\n`;
    combinedMarkdown += '---\n\n';

    markdownNotes.forEach((note, idx) => {
      combinedMarkdown += note.markdown + '\n\n';
      if (idx < markdownNotes.length - 1) {
        combinedMarkdown += '---\n\n';
      }
    });

    zip.file('combined-notes.md', combinedMarkdown);
  }

  // Create mindmap SVG and JSON files
  if (mindmaps.length > 0) {
    const mindmapsFolder = zip.folder('mindmaps');
    mindmaps.forEach(mindmap => {
      const baseName = sanitizeFilename(mindmap.title);
      mindmapsFolder.file(`${baseName}.svg`, mindmap.svgContent);
      mindmapsFolder.file(`${baseName}.json`, JSON.stringify(mindmap.treeData, null, 2));
    });
  }

  // Generate and download ZIP
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `notebooklm-notes-${timestamp}.zip`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

// ========== SOURCES EXPORT FUNCTIONS ==========

/**
 * Scan the sources panel for all uploaded source documents
 */
async function scanSourcesPage() {
  console.log('[NotebookLM Takeout] Scanning sources page...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url?.includes('notebooklm.google.com')) {
    showToast('Please open NotebookLM first', 'error');
    return;
  }

  // Ensure content script is loaded
  await ensureContentScriptLoaded(tab.id);

  try {
    // Send message to scan sources
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_SOURCES' });

    if (response.error) {
      showToast(`Scan failed: ${response.error}`, 'error');
      return;
    }

    const sources = response.sources || [];

    console.log(`[NotebookLM Takeout] Found ${sources.length} sources`);

    renderSourcesList(sources);
  } catch (error) {
    console.error('[NotebookLM Takeout] Scan error:', error);
    showToast('Failed to scan sources', 'error');
  }
}

/**
 * Render the list of sources with checkboxes and download buttons
 */
function renderSourcesList(sources) {
  const resultsDiv = document.getElementById('sources-scan-results');
  const countBadge = document.getElementById('sources-count');
  const exportBtn = document.getElementById('export-sources-btn');

  countBadge.textContent = sources.length;

  if (sources.length === 0) {
    resultsDiv.innerHTML = '<p class="empty-message">No sources found. Add source materials to your notebook.</p>';
    exportBtn.style.display = 'none';
    return;
  }

  // Store sources for later use
  window._currentSources = sources;

  // Create list of sources with checkboxes (similar to notes)
  let html = '<div class="source-scan-list">';

  // Select all checkbox
  html += `
    <div class="source-scan-item select-all-item">
      <input type="checkbox" id="select-all-sources" class="source-select-all" checked>
      <label for="select-all-sources"><strong>Select all sources</strong></label>
    </div>
  `;

  // Individual sources
  sources.forEach((source, idx) => {
    const icon = source.type === 'markdown' ? '📄' : '📎';

    html += `
      <div class="source-scan-item" data-index="${idx}">
        <input type="checkbox" id="source-${idx}" class="source-checkbox" checked>
        <label for="source-${idx}">
          <span class="source-icon">${icon}</span>
          <span class="source-title">${escapeHtml(source.title)}</span>
        </label>
        <button class="download-single-btn" data-index="${idx}" title="Download this source">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </button>
      </div>
    `;
  });

  html += '</div>';

  resultsDiv.innerHTML = html;

  // Show export button
  exportBtn.style.display = 'block';

  // Add event listeners
  setupSourcesEventListeners(sources);
}

/**
 * Setup event listeners for sources list
 */
function setupSourcesEventListeners(sources) {
  // Select all checkbox
  const selectAllCheckbox = document.getElementById('select-all-sources');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const checkboxes = document.querySelectorAll('.source-checkbox');
      checkboxes.forEach(cb => cb.checked = e.target.checked);
    });
  }

  // Individual checkboxes - update select-all state
  const sourceCheckboxes = document.querySelectorAll('.source-checkbox');
  sourceCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = Array.from(sourceCheckboxes).every(c => c.checked);
      const someChecked = Array.from(sourceCheckboxes).some(c => c.checked);
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
    });
  });

  // Individual download buttons
  const downloadButtons = document.querySelectorAll('.download-single-btn');
  downloadButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const source = sources[idx];
      await exportSources([source]);
    });
  });

  // Export selected button
  const exportBtn = document.getElementById('export-sources-btn');
  if (exportBtn) {
    // Remove old listeners
    const newBtn = exportBtn.cloneNode(true);
    exportBtn.parentNode.replaceChild(newBtn, exportBtn);

    newBtn.addEventListener('click', async () => {
      const selectedItems = Array.from(document.querySelectorAll('.source-checkbox:checked'));
      const selected = selectedItems.map(cb => {
        const item = cb.closest('.source-scan-item');
        const idx = parseInt(item.dataset.index);
        return sources[idx];
      }).filter(Boolean);

      if (selected.length === 0) {
        showToast('No sources selected', 'warning');
        return;
      }

      await exportSources(selected);
    });
  }
}

/**
 * Export selected sources as markdown files in a ZIP
 * Reuses the same pattern as notes export
 */
async function exportSources(selectedSources) {
  console.log(`[NotebookLM Takeout] Exporting ${selectedSources.length} sources...`);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Show overlay on the page
  await chrome.tabs.sendMessage(tab.id, {
    type: 'SHOW_EXPORT_OVERLAY',
    message: 'Preparing to export sources...'
  });

  // Show progress panel in sidebar
  const progressPanel = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  progressPanel.style.display = 'block';
  progressText.textContent = `Exporting sources...`;
  progressFill.style.width = '0%';

  const exportedSources = [];
  let cancelled = false;

  // Listen for cancellation
  const cancelListener = (message) => {
    if (message.type === 'CANCEL_EXPORT') {
      cancelled = true;
    }
  };
  chrome.runtime.onMessage.addListener(cancelListener);

  try {
    // Extract each source
    for (let i = 0; i < selectedSources.length; i++) {
      // Check for cancellation
      if (cancelled) {
        console.log('[NotebookLM Takeout] Export cancelled by user');
        showToast('Export cancelled', 'warning');
        break;
      }

      const source = selectedSources[i];
      const progress = ((i + 1) / selectedSources.length) * 100;

      // Update sidebar progress
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `Extracting ${i + 1}/${selectedSources.length}: ${source.title}`;

      // Update page overlay
      await chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_EXPORT_OVERLAY',
        message: `Extracting ${i + 1}/${selectedSources.length}: ${source.title}`,
        progress: progress
      });

      console.log(`[NotebookLM Takeout] Extracting source: "${source.title}"`);

      try {
        // Extract source content
        const sourceData = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_SOURCE',
          data: { sourceIndex: source.index }
        });

        if (sourceData.error) {
          console.error(`[NotebookLM Takeout] Failed to extract "${source.title}":`, sourceData.error);
          showToast(`Skipped: ${source.title}`, 'warning');

          // Try to close panel before continuing
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK' });
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (backError) {
            console.error('[NotebookLM Takeout] Failed to close panel after error:', backError);
          }

          continue;
        }

        // Build markdown with source guide info
        let markdown = `# ${source.title}\n\n`;

        // Add source guide summary if available (preserve HTML tags like <strong>)
        if (sourceData.guideHTML) {
          markdown += `## Summary\n\n${sourceData.guideHTML}\n\n`;
        }

        // Add key topics if available
        if (sourceData.keyTopics && sourceData.keyTopics.length > 0) {
          markdown += `## Key Topics\n\n`;
          sourceData.keyTopics.forEach(topic => {
            markdown += `- ${topic}\n`;
          });
          markdown += `\n`;
        }

        // Add the main content
        markdown += `## Content\n\n`;
        markdown += convertToMarkdown(sourceData.html, sourceData.sources || [], source.title);

        exportedSources.push({
          title: source.title,
          markdown: markdown
        });

        console.log(`[NotebookLM Takeout] Successfully extracted "${source.title}", now closing panel...`);

        // Navigate back to sources list
        const backResponse = await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK' });
        console.log('[NotebookLM Takeout] NAVIGATE_BACK response:', backResponse);

        // Wait for panel to close and sources list to reappear
        await new Promise(resolve => setTimeout(resolve, 1500));

      } catch (error) {
        console.error(`[NotebookLM Takeout] Error extracting source "${source.title}":`, error);
        showToast(`Error: ${source.title}`, 'error');

        // Try to close panel even if extraction failed
        try {
          console.log('[NotebookLM Takeout] Attempting to close panel after error...');
          await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK' });
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (backError) {
          console.error('[NotebookLM Takeout] Failed to close panel:', backError);
        }
      }
    }

    // Create ZIP with all sources
    if (exportedSources.length === 1) {
      // Single source - download as single file
      const source = exportedSources[0];
      const blob = new Blob([source.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const filename = sanitizeFilename(source.title) + '.md';

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Downloaded: ${source.title}`, 'success');

    } else if (exportedSources.length > 1) {
      // Multiple sources - create ZIP
      const zip = new JSZip();
      const sourcesFolder = zip.folder('sources');

      exportedSources.forEach(source => {
        const filename = sanitizeFilename(source.title) + '.md';
        sourcesFolder.file(filename, source.markdown);
      });

      // Generate ZIP
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `notebooklm-sources-${timestamp}.zip`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Exported ${exportedSources.length} sources`, 'success');
    } else {
      showToast('No sources were exported', 'warning');
    }

  } catch (error) {
    console.error('[NotebookLM Takeout] Export failed:', error);
    showToast(`Export failed: ${error.message}`, 'error');
  } finally {
    // Remove cancellation listener
    chrome.runtime.onMessage.removeListener(cancelListener);

    // Hide page overlay
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'HIDE_EXPORT_OVERLAY'
      });
    } catch (error) {
      console.error('[NotebookLM Takeout] Failed to hide overlay:', error);
    }

    // Hide sidebar progress panel
    progressPanel.style.display = 'none';
  }
}

// ========== END SOURCES EXPORT FUNCTIONS ==========

function getIconForType(type) {
  const icons = {
    'Audio Overview': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#1a73e8">
      <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
    </svg>`,
    'Slides': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#34a853">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
    </svg>`,
    'Infographic': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fbbc04">
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
    </svg>`,
    'Report': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#ea4335">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
    </svg>`,
    'Data Table': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#34a853">
      <path d="M3 3h18v18H3V3zm16 16V5H5v14h14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
    </svg>`
  };

  return icons[type] || `<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368">
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
  </svg>`;
}

// This runs in the page context to click artifact More button
// Returns the artifact metadata needed for download
function clickArtifactMoreButton(artifactIndex) {
  console.log(`[NotebookLM Takeout] Clicking More button for artifact ${artifactIndex}`);

  // Build array of More buttons ONLY from artifact-library-item (not from notes)
  const artifactMoreButtons = [];
  document.querySelectorAll('artifact-library-item').forEach(item => {
    const btn = item.querySelector('button[aria-label="More"]');
    if (btn) {
      artifactMoreButtons.push(btn);
    }
  });

  if (artifactIndex < 0 || artifactIndex >= artifactMoreButtons.length) {
    throw new Error(`Artifact index ${artifactIndex} out of range (0-${artifactMoreButtons.length - 1})`);
  }

  const moreButton = artifactMoreButtons[artifactIndex];
  const artifactItem = moreButton.closest('artifact-library-item');

  if (!artifactItem) {
    throw new Error('Could not find artifact-library-item parent');
  }

  // Get artifact metadata
  const titleEl = artifactItem.querySelector('.artifact-title');
  const title = titleEl?.textContent?.trim() || `Artifact ${artifactIndex + 1}`;

  const mainButton = artifactItem.querySelector('button[aria-description]');
  const type = mainButton?.getAttribute('aria-description') || '';

  // Click the More button
  moreButton.click();

  console.log(`[NotebookLM Takeout] Clicked More button for: ${title} (${type})`);

  return {
    success: true,
    title: title,
    type: type,
    index: artifactIndex
  };
}

// This runs in the page context to find downloadable items
function scanPageForItems() {
  const items = [];

  // Only scan artifact-library-item elements (not artifact-library-note)
  const artifactItems = document.querySelectorAll('artifact-library-item');

  // Build array of More buttons ONLY from artifact-library-item (not from notes)
  const artifactMoreButtons = [];
  document.querySelectorAll('artifact-library-item').forEach(item => {
    const btn = item.querySelector('button[aria-label="More"]');
    if (btn) {
      artifactMoreButtons.push(btn);
    }
  });

  artifactItems.forEach((item, idx) => {
    // Get the type from aria-description on the button
    const mainButton = item.querySelector('button[aria-description]');
    const type = mainButton?.getAttribute('aria-description') || '';

    // Get the title from .artifact-title
    const titleEl = item.querySelector('.artifact-title');
    const artifactTitle = titleEl?.textContent?.trim() || `Artifact ${idx + 1}`;

    // Get details from .artifact-details
    const detailsEl = item.querySelector('.artifact-details');
    const artifactDetails = detailsEl?.textContent?.trim() || '';

    // Get the More button
    const moreButton = item.querySelector('button[aria-label="More"]');

    // Find this button's index in artifact More buttons (for clicking later)
    let globalIndex = -1;
    artifactMoreButtons.forEach((b, i) => {
      if (b === moreButton) globalIndex = i;
    });

    // All artifacts are now exportable, including Reports
    items.push({
      index: globalIndex,
      label: artifactTitle,
      type: type,
      details: artifactDetails,
      disabled: false  // Reports are now enabled
    });
  });

  return items;
}

async function triggerItemDownload(tabId, itemIndex, artifactName, artifactType) {
  try {
    logger.info('Download', `Triggering download for ${artifactName}`, { itemIndex, artifactType });

    // Use new message-based download with retry logic (2 retries for individual downloads)
    await retryDownload(
      () => downloadArtifact(tabId, itemIndex, artifactType, artifactName),
      2,
      artifactName
    );

    if (settings.showNotifications) {
      showToast(`✓ Downloaded ${artifactName}`, 'success');
    }
  } catch (error) {
    logger.error('Download', `Failed to download ${artifactName}`, error);
    showToast(`✗ Failed to download ${artifactName}`, 'error');
    throw error;
  }
}

// OLD IMPLEMENTATION (ROLLBACK) - Keep for reference but commented out
/*
async function triggerItemDownload_OLD(tabId, itemIndex, artifactName, artifactType) {
  try {
    // Tell background script what name to use for this download
    await chrome.runtime.sendMessage({
      type: 'SET_PENDING_DOWNLOAD',
      name: artifactName,
      artifactType: artifactType
    });

    // Trigger the download by clicking More menu -> Download
    await chrome.scripting.executeScript({
      target: { tabId },
      func: clickDownloadForItem,
      args: [itemIndex]
    });

    if (settings.showNotifications) {
      showToast(`Downloading ${artifactName}...`);
    }
  } catch (error) {
    console.error('Download trigger failed:', error);
    showToast('Failed to trigger download', 'error');
  }
}
*/

// This runs in the page context to click download for a specific item
function clickDownloadForItem(itemIndex) {
  const moreButtons = document.querySelectorAll('button[aria-label="More"]');

  const btn = moreButtons[itemIndex];
  if (!btn) {
    console.error('[NotebookLM Takeout] Button not found at index', itemIndex);
    return;
  }

  btn.click();

  // Wait for menu to appear, then click Download
  setTimeout(() => {
    const menuItems = document.querySelectorAll('.mat-mdc-menu-item');

    for (const item of menuItems) {
      const textSpan = item.querySelector('.mat-mdc-menu-item-text');
      const text = (textSpan?.textContent || '').trim().toLowerCase();

      if (text === 'download') {
        item.click();
        return;
      }
    }

    // No Download found - close menu
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }, 400);
}

// Download All - either ZIP or individual based on checkbox
async function downloadAllArtifacts(tabId, items) {
  const downloadBtn = document.getElementById('download-all-btn');
  const zipEnabled = document.getElementById('zip-checkbox')?.checked || false;

  // Show overlay on the page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.sendMessage(tab.id, {
    type: 'SHOW_EXPORT_OVERLAY',
    message: 'Preparing to download artifacts...'
  });

  if (downloadBtn) {
    downloadBtn.disabled = true;
  }

  // Show progress panel
  const progressPanel = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  progressPanel.style.display = 'block';

  let cancelled = false;

  // Listen for cancellation
  const cancelListener = (message) => {
    if (message.type === 'CANCEL_EXPORT') {
      cancelled = true;
    }
  };
  chrome.runtime.onMessage.addListener(cancelListener);

  if (zipEnabled) {
    // ZIP pathway - runs in background
    progressText.textContent = 'Creating ZIP...';
    progressFill.style.width = '0%';

    try {
      await chrome.runtime.sendMessage({
        type: 'BATCH_DOWNLOAD_ALL',
        tabId: tabId,
        items: items
      });

      // Poll for status
      const pollStatus = setInterval(async () => {
        // Check for cancellation
        if (cancelled) {
          console.log('[NotebookLM Takeout] ZIP download cancelled by user');
          clearInterval(pollStatus);
          showToast('Download cancelled', 'warning');

          // Clean up overlay
          chrome.runtime.onMessage.removeListener(cancelListener);
          await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
          progressPanel.style.display = 'none';
          if (downloadBtn) downloadBtn.disabled = false;
          return;
        }

        const status = await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' });
        if (status && status.status) {
          progressText.textContent = status.status;

          // Update page overlay
          await chrome.tabs.sendMessage(tab.id, {
            type: 'UPDATE_EXPORT_OVERLAY',
            message: status.status,
            progress: 50 // Approximate progress for ZIP creation
          });

          if (!status.inProgress) {
            clearInterval(pollStatus);

            // Clean up
            chrome.runtime.onMessage.removeListener(cancelListener);
            await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
            progressPanel.style.display = 'none';

            if (settings.showNotifications) {
              showToast('ZIP download complete!');
            }
          }
        }
      }, 500);

    } catch (error) {
      console.error('Failed to start batch download:', error);
      showToast('Failed to start download', 'error');

      // Clean up on error
      chrome.runtime.onMessage.removeListener(cancelListener);
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
      progressPanel.style.display = 'none';
    }
    return; // Early return for ZIP pathway
  } else {
    // Individual downloads with progress
    await downloadItemsSequentially(tabId, items, progressFill, progressText, () => cancelled);
  }

  // Remove cancellation listener
  chrome.runtime.onMessage.removeListener(cancelListener);

  // Hide page overlay
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'HIDE_EXPORT_OVERLAY'
    });
  } catch (error) {
    console.error('[NotebookLM Takeout] Failed to hide overlay:', error);
  }

  // Hide progress panel
  progressPanel.style.display = 'none';

  // Reset button
  if (downloadBtn) {
    downloadBtn.disabled = false;
  }
}

// Download items one by one with progress display and retry logic
async function downloadItemsSequentially(tabId, items, progressFill, progressText, isCancelled) {
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;

  logger.info('Batch Download', `Starting batch download of ${items.length} items`);

  for (let i = 0; i < items.length; i++) {
    // Check for cancellation
    if (isCancelled && isCancelled()) {
      console.log('[NotebookLM Takeout] Batch download cancelled by user');
      showToast('Download cancelled', 'warning');
      break;
    }

    const item = items[i];
    const progress = ((i + 1) / items.length) * 100;

    // Update sidebar progress
    progressFill.style.width = `${progress}%`;
    progressText.textContent = `Downloading ${i + 1}/${items.length}: ${item.label}`;

    // Update page overlay
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, {
      type: 'UPDATE_EXPORT_OVERLAY',
      message: `Downloading ${i + 1}/${items.length}: ${item.label}`,
      progress: progress
    });

    logger.download(item.label, 'progress', `Item ${i + 1}/${items.length}`);

    try {
      // Use retry logic for each download (3 retries for batch)
      await retryDownload(
        () => downloadArtifact(tabId, item.index, item.type, item.label),
        3,
        item.label
      );

      successCount++;
      logger.download(item.label, 'success', `Completed ${i + 1}/${items.length}`);

    } catch (error) {
      failureCount++;
      logger.error('Batch Download', `Failed to download ${item.label}`, error);
      // Continue with next item even if this one failed
    }

    // Delay between downloads to prevent rate limiting
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }

  // Show summary toast
  const summary = [];
  if (successCount > 0) summary.push(`${successCount} succeeded`);
  if (failureCount > 0) summary.push(`${failureCount} failed`);
  if (skippedCount > 0) summary.push(`${skippedCount} skipped`);

  const message = `Download complete: ${summary.join(', ')}`;
  logger.info('Batch Download', message);

  if (settings.showNotifications) {
    const toastType = failureCount > 0 ? 'warning' : 'success';
    showToast(message, toastType);
  }
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  // Auto-hide after delay (longer for errors/warnings)
  const duration = type === 'error' || type === 'warning' ? 4000 : 2000;

  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});
