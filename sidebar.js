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

/**
 * Create a standardized TurndownService instance with consistent configuration
 * This ensures all markdown conversions use the same settings
 * @param {Object} customOptions - Optional custom options to override defaults
 * @returns {TurndownService} Configured TurndownService instance
 */
function createTurndownService(customOptions = {}) {
  const defaultOptions = {
    headingStyle: 'atx',        // Use # style headings (not underlined)
    hr: '---',                  // Horizontal rules with three dashes
    bulletListMarker: '*',      // Use * for unordered lists (changed from - for consistency)
    codeBlockStyle: 'fenced',   // Use ``` code blocks (not indented)
    emDelimiter: '_',           // Use _ for emphasis (not *)
    strongDelimiter: '**',      // Use ** for strong (not __)
    linkStyle: 'inlined'        // Use [text](url) format (not reference style)
  };

  return new TurndownService({ ...defaultOptions, ...customOptions });
}

let currentTabId = null;
let autoRefreshInterval = null;
let settingsLoaded = false;
let settings = {
  autoZip: false,
  showNotifications: true,
  refreshInterval: 10,
  // Source export versions (which combinations to create)
  exportSourceBase: true, // Base version (always enabled, can't be disabled)
  exportSourcePlusMeta: true, // With metadata (summary & key topics)
  exportSourceWithImages: false, // With images (no metadata)
  exportSourcePlusMetaWithImages: false, // With metadata + images
  // Note export versions (which combinations to create)
  exportNoteBase: true, // Base version (always enabled, can't be disabled)
  exportNoteCodeBlocks: true, // Code blocks, no images (was: citationsCodeBlock)
  exportNoteWithImages: false, // With images, markdown (was: includeCitationImages)
  exportNoteCodeBlocksWithImages: false, // Code blocks + images
  // Batch sizes
  sourcesPerZip: 25, // Number of sources per ZIP file (prevents memory issues)
  notesPerZip: 25 // Number of notes per ZIP file (prevents memory issues)
};

document.addEventListener('DOMContentLoaded', () => {
  init();
});

// Listen for messages from content script (e.g., image download requests)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_IMAGE_AS_BASE64') {
    // Handle image download request from content script
    downloadImageAsBase64(message.url)
      .then(dataUri => {
        sendResponse({ success: true, dataUri });
      })
      .catch(error => {
        console.error('[NotebookLM Takeout] Failed to download image:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

async function init() {
  // Disable export buttons until settings are loaded
  disableExportButtons();

  await loadSettings();
  settingsLoaded = true;

  // Re-enable export buttons after settings are loaded
  enableExportButtons();

  await checkStatus();
  setupEventListeners();
  setupTabSwitching();
  await scanSourcesPage(); // Start with Sources tab since it's now the default

  // Monitor tab changes
  chrome.tabs.onActivated.addListener(handleTabChange);
  chrome.tabs.onUpdated.addListener(handleTabUpdate);
}

function disableExportButtons() {
  const exportButtons = [
    'export-notes-btn',
    'export-sources-btn',
    'export-chat-btn',
    'scan-sources-btn',
    'scan-chat-btn'
  ];

  exportButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }
  });
}

function enableExportButtons() {
  const exportButtons = [
    'export-notes-btn',
    'export-sources-btn',
    'export-chat-btn',
    'scan-sources-btn',
    'scan-chat-btn'
  ];

  exportButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['settings']);
  if (stored.settings) {
    // Migrate old settings to new format if needed
    const migrated = { ...settings, ...stored.settings };

    // Migrate old citationsCodeBlock to new exportNoteCodeBlocks
    if ('citationsCodeBlock' in stored.settings && !('exportNoteCodeBlocks' in stored.settings)) {
      migrated.exportNoteCodeBlocks = stored.settings.citationsCodeBlock;
    }

    // Migrate old includeCitationImages to new exportNoteWithImages
    if ('includeCitationImages' in stored.settings && !('exportNoteWithImages' in stored.settings)) {
      migrated.exportNoteWithImages = stored.settings.includeCitationImages;
    }

    // Migrate old includeSourceMetadata to new exportSourcePlusMeta
    if ('includeSourceMetadata' in stored.settings && !('exportSourcePlusMeta' in stored.settings)) {
      migrated.exportSourcePlusMeta = stored.settings.includeSourceMetadata;
    }

    // Migrate old exportWithImagesVersion to new exportSourceWithImages
    if ('exportWithImagesVersion' in stored.settings && !('exportSourceWithImages' in stored.settings)) {
      migrated.exportSourceWithImages = stored.settings.exportWithImagesVersion;
    }

    settings = migrated;
  }

  // Apply settings to UI
  document.getElementById('auto-zip-checkbox').checked = settings.autoZip;
  document.getElementById('show-notifications-checkbox').checked = settings.showNotifications;
  document.getElementById('refresh-interval-input').value = settings.refreshInterval;
  document.getElementById('citations-code-block-checkbox').checked = settings.citationsCodeBlock || settings.exportNoteCodeBlocks;
  document.getElementById('include-citation-images-checkbox').checked = settings.includeCitationImages || settings.exportNoteWithImages;

  // Source version checkboxes
  document.getElementById('export-source-base-checkbox').checked = settings.exportSourceBase;
  document.getElementById('export-source-plus-meta-checkbox').checked = settings.exportSourcePlusMeta;
  document.getElementById('export-source-with-images-checkbox').checked = settings.exportSourceWithImages;
  document.getElementById('export-source-plus-meta-with-images-checkbox').checked = settings.exportSourcePlusMetaWithImages;

  // Note version checkboxes
  document.getElementById('export-note-base-checkbox').checked = settings.exportNoteBase;
  document.getElementById('export-note-code-blocks-checkbox').checked = settings.exportNoteCodeBlocks;
  document.getElementById('export-note-with-images-checkbox').checked = settings.exportNoteWithImages;
  document.getElementById('export-note-code-blocks-with-images-checkbox').checked = settings.exportNoteCodeBlocksWithImages;

  // Batch sizes
  document.getElementById('sources-per-zip-input').value = settings.sourcesPerZip;
  document.getElementById('notes-per-zip-input').value = settings.notesPerZip;
}

async function saveSettings() {
  settings.autoZip = document.getElementById('auto-zip-checkbox').checked;
  settings.showNotifications = document.getElementById('show-notifications-checkbox').checked;
  settings.refreshInterval = parseInt(document.getElementById('refresh-interval-input').value) || 10;

  // Keep old settings for backward compatibility (chat/data table exports)
  const citationsCodeBlockCheckbox = document.getElementById('citations-code-block-checkbox');
  const includeCitationImagesCheckbox = document.getElementById('include-citation-images-checkbox');
  if (citationsCodeBlockCheckbox) {
    settings.citationsCodeBlock = citationsCodeBlockCheckbox.checked;
  }
  if (includeCitationImagesCheckbox) {
    settings.includeCitationImages = includeCitationImagesCheckbox.checked;
  }

  // Source version selections
  settings.exportSourceBase = document.getElementById('export-source-base-checkbox').checked;
  settings.exportSourcePlusMeta = document.getElementById('export-source-plus-meta-checkbox').checked;
  settings.exportSourceWithImages = document.getElementById('export-source-with-images-checkbox').checked;
  settings.exportSourcePlusMetaWithImages = document.getElementById('export-source-plus-meta-with-images-checkbox').checked;

  // Note version selections
  settings.exportNoteBase = document.getElementById('export-note-base-checkbox').checked;
  settings.exportNoteCodeBlocks = document.getElementById('export-note-code-blocks-checkbox').checked;
  settings.exportNoteWithImages = document.getElementById('export-note-with-images-checkbox').checked;
  settings.exportNoteCodeBlocksWithImages = document.getElementById('export-note-code-blocks-with-images-checkbox').checked;

  // Batch sizes
  settings.sourcesPerZip = parseInt(document.getElementById('sources-per-zip-input').value) || 25;
  settings.notesPerZip = parseInt(document.getElementById('notes-per-zip-input').value) || 25;

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

  // Add validation for source version checkboxes (ensure at least one is selected)
  const sourceVersionCheckboxes = [
    'export-source-base-checkbox',
    'export-source-plus-meta-checkbox',
    'export-source-with-images-checkbox',
    'export-source-plus-meta-with-images-checkbox'
  ];

  sourceVersionCheckboxes.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox && !checkbox.disabled) {
      checkbox.addEventListener('change', (e) => {
        // Check if at least one source version is still selected
        const anyChecked = sourceVersionCheckboxes.some(cbId => {
          const cb = document.getElementById(cbId);
          return cb && cb.checked;
        });

        // If none are checked, prevent unchecking this one
        if (!anyChecked) {
          e.target.checked = true;
          showToast('At least one source version must be selected', 'error');
        }
      });
    }
  });

  // Add validation for note version checkboxes (ensure at least one is selected)
  const noteVersionCheckboxes = [
    'export-note-base-checkbox',
    'export-note-code-blocks-checkbox',
    'export-note-with-images-checkbox',
    'export-note-code-blocks-with-images-checkbox'
  ];

  noteVersionCheckboxes.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox && !checkbox.disabled) {
      checkbox.addEventListener('change', (e) => {
        // Check if at least one note version is still selected
        const anyChecked = noteVersionCheckboxes.some(cbId => {
          const cb = document.getElementById(cbId);
          return cb && cb.checked;
        });

        // If none are checked, prevent unchecking this one
        if (!anyChecked) {
          e.target.checked = true;
          showToast('At least one note version must be selected', 'error');
        }
      });
    }
  });

  // Sources scan button
  const scanSourcesBtn = document.getElementById('scan-sources-btn');
  if (scanSourcesBtn) {
    scanSourcesBtn.addEventListener('click', scanSourcesPage);
  }

  // Chat scan button
  const scanChatBtn = document.getElementById('scan-chat-btn');
  if (scanChatBtn) {
    scanChatBtn.addEventListener('click', scanChatPage);
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
      // Chat tab: no auto-scan, user must click "Scan Chat" button manually
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
 * Get artifact type prefix for filenames
 */
function getArtifactTypePrefix(artifactType) {
  const typeMap = {
    'Audio Overview': 'audio-overview',
    'Data Table': 'data-table',
    'Report': 'report',
    'Infographic': 'infographic',
    'Slides': 'slides'
  };
  return typeMap[artifactType] || artifactType.toLowerCase().replace(/\s+/g, '-');
}

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
      const baseFilename = response.title || artifactName || 'artifact';
      const typePrefix = getArtifactTypePrefix(artifactType);

      // For Data Tables, convert to CSV
      if (artifactType === 'Data Table') {
        logger.info('Download', `Downloading extracted content as CSV: "${baseFilename}"`);

        // Convert HTML table to CSV and JSON
        let csvContent;
        let tableData = null;
        let footnotes = '';
        if (response.format === 'html') {
          logger.info('Download', `Converting HTML table to CSV for: "${baseFilename}"`);
          csvContent = convertTableToCSV(response.data);

          // Extract structured table data for JSON
          tableData = extractTableDataAsJSON(response.data);

          // Extract footnotes from HTML
          footnotes = extractFootnotesFromHTML(response.data);
        } else {
          csvContent = response.data;
        }

        // If there are footnotes or structured data, create a ZIP with CSV, JSON, HTML, and references
        if ((footnotes && footnotes.trim().length > 0) || tableData) {
          logger.info('Download', `Creating ZIP with CSV, JSON, HTML, and references for: "${baseFilename}"`);

          const zip = new JSZip();
          const sanitizedName = sanitizeFilename(baseFilename);
          zip.file(`${sanitizedName}.csv`, csvContent);

          // Add JSON version with table data and footnotes
          if (tableData) {
            const jsonData = {
              title: baseFilename,
              exported: new Date().toISOString(),
              table: tableData,
              footnotes: footnotes ? footnotes.split('\n\n').filter(line => /^\[\d+\]/.test(line.trim())) : []
            };
            zip.file(`${sanitizedName}.json`, JSON.stringify(jsonData, null, 2));
          }

          // Add clean HTML version with table and footnotes
          const cleanHTML = createCleanTableHTML(response.data, baseFilename, footnotes);
          if (cleanHTML) {
            zip.file(`${sanitizedName}.html`, cleanHTML);
            logger.info('Download', `Added clean HTML table to ZIP`);
          }

          // Add references text file
          if (footnotes && footnotes.trim().length > 0) {
            zip.file('references.txt', footnotes);
          }

          zip.generateAsync({ type: 'blob' }).then(zipBlob => {
            const url = URL.createObjectURL(zipBlob);
            try {
              const a = document.createElement('a');
              a.href = url;
              a.download = `[${typePrefix}]_${sanitizedName}.zip`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);

              logger.download(baseFilename, 'success', `Downloaded as ZIP with CSV, HTML, JSON, and references`);
            } finally {
              URL.revokeObjectURL(url);
            }
          });
        } else {
          // No footnotes or structured data - just download CSV
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `[${typePrefix}]_${sanitizeFilename(baseFilename)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            logger.download(baseFilename, 'success', `Downloaded as CSV (${csvContent.length} chars)`);
          } finally {
            URL.revokeObjectURL(url);
          }
        }

        // Cancel intercept mode (wasn't needed)
        chrome.runtime.sendMessage({ type: 'CANCEL_INTERCEPT' }).catch(() => {});
      } else {
        // For Reports and other content, convert to markdown
        logger.info('Download', `Downloading extracted content as markdown: "${baseFilename}"`);

        // Convert HTML to markdown (content.js returns HTML, we convert it here)
        let markdownContent;
        if (response.format === 'html') {
          logger.info('Download', `Converting HTML to markdown for: "${baseFilename}"`);
          // For Reports, skip adding title if it's already in the content (prevents duplicate H1)
          const skipTitle = (artifactType === 'Report');
          markdownContent = convertToMarkdown(response.data, [], baseFilename, settings.citationsCodeBlock, skipTitle);
        } else {
          // Already markdown
          markdownContent = response.data;
        }

        // Create markdown blob and download
        const blob = new Blob([markdownContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement('a');
          a.href = url;
          a.download = `[${typePrefix}]_${sanitizeFilename(baseFilename)}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // Cancel intercept mode (wasn't needed)
          chrome.runtime.sendMessage({ type: 'CANCEL_INTERCEPT' }).catch(() => {});

          logger.download(baseFilename, 'success', `Downloaded as markdown (${markdownContent.length} chars)`);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } else if (response.method === 'svg_extract' || response.method === 'canvas_export') {
      // Direct extraction - download the data URL
      // Use title from response (extracted from page) or fall back to artifactName parameter
      const filename = response.title || artifactName || 'infographic';
      logger.info('Download', `Using filename: "${filename}"`, { from: response.title ? 'response' : 'parameter' });
      await handleSVGDownload(response.data, filename, response.format, artifactType);

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
async function handleSVGDownload(dataUrl, filename, format, artifactType = 'Infographic') {
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

    try {
      // Trigger download with type prefix
      const extension = format === 'svg' ? 'svg' : 'png';
      const typePrefix = getArtifactTypePrefix(artifactType);
      const sanitizedFilename = `[${typePrefix}]_${sanitizeFilename(filename)}.${extension}`;

      logger.info('Download', `Sanitized filename: "${sanitizedFilename}"`);

      await chrome.downloads.download({
        url: url,
        filename: sanitizedFilename,
        saveAs: false
      });

      logger.download(filename, 'success', `${format.toUpperCase()} downloaded as ${sanitizedFilename}`);

      // Give download time to start before revoking URL
      await new Promise(resolve => setTimeout(resolve, 1000));

    } finally {
      // Always clean up blob URL
      URL.revokeObjectURL(url);
    }

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

      let iconColor = '#1a73e8'; // Default: blue for notes
      if (isMindmap) iconColor = '#ea4335'; // Red for mindmaps

      let iconPath;
      if (isMindmap) {
        iconPath = 'M14 2l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h8zm-1 2H6v16h12V9h-5V4zM12 11c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm-5 4h2.5c-.3-.6-.5-1.3-.5-2s.2-1.4.5-2H7v4zm8.5 0H18v-4h-2.5c.3.6.5 1.3.5 2s-.2 1.4-.5 2z';
      } else {
        iconPath = 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z';
      }

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

/**
 * Extract footnotes from HTML table artifacts
 * Looks for elements after the table with pattern [1] Text, [2] Text, etc.
 */
function extractFootnotesFromHTML(htmlContent) {
  logger.info('Footnotes', `Extracting footnotes from HTML (${htmlContent.length} chars)`);
  logger.info('Footnotes', `HTML preview: ${htmlContent.substring(0, 500)}...`);

  // Parse HTML content
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  // Look for specific elements that typically contain footnotes
  // Target span, p, div elements (most likely to contain footnote text)
  const candidateElements = doc.querySelectorAll('span, p, div, .paragraph');
  logger.info('Footnotes', `Found ${candidateElements.length} candidate elements (span/p/div)`);

  const footnotes = [];
  const seenTexts = new Set(); // Track unique footnote texts

  candidateElements.forEach((el) => {
    const text = el.textContent.trim();

    // Only process if starts with [number]
    if (/^\[\d+\]/.test(text)) {
      // Skip if this is ONLY a number like "[1]" without any actual content
      // Valid footnotes should match: [number] followed by space and text
      // E.g., "[1] Some text here" NOT just "[1]"
      if (/^\[\d+\]\s*$/.test(text)) {
        logger.info('Footnotes', `Skipping bare citation marker: ${text}`);
        return;
      }

      // Skip if this is a parent container of another footnote element
      // (Check if any child also starts with [number])
      const childrenTexts = Array.from(el.children).map(child => child.textContent.trim());
      const hasFootnoteChild = childrenTexts.some(childText => /^\[\d+\]/.test(childText));

      if (hasFootnoteChild) {
        // This is a parent container, skip it (we'll get the child directly)
        logger.info('Footnotes', `Skipping parent container element`);
        return;
      }

      // Check if we've already seen this exact text (avoid duplicates from nested elements)
      if (seenTexts.has(text)) {
        return;
      }

      // Valid footnote - extract it
      footnotes.push(text);
      seenTexts.add(text);
      logger.info('Footnotes', `Found footnote #${footnotes.length}: ${text.substring(0, 100)}...`);
    }
  });

  logger.info('Footnotes', `Extracted ${footnotes.length} unique footnotes`);

  if (footnotes.length === 0) {
    logger.warn('Footnotes', 'No footnotes found in HTML');
    return '';
  }

  // Format footnotes as plain text
  let output = 'REFERENCES\n';
  output += '='.repeat(50) + '\n\n';
  footnotes.forEach(footnote => {
    output += footnote + '\n\n';
  });

  return output;
}

/**
 * Extract table data as structured JSON
 * Returns an object with headers and rows arrays
 */
function extractTableDataAsJSON(htmlContent) {
  logger.info('JSON', `Extracting table data as JSON (${htmlContent.length} chars)`);

  try {
    // Parse HTML content
    const parser = new DOMParser();
    let htmlToParse = htmlContent;

    // If HTML starts with <tr>, wrap in table tags
    if (htmlContent.trim().startsWith('<tr')) {
      htmlToParse = `<table>${htmlContent}</table>`;
    }

    const doc = parser.parseFromString(htmlToParse, 'text/html');

    // Try multiple selectors to find the table
    const tableSelectors = ['table', '[role="table"]', '.table'];
    let table = null;
    for (const selector of tableSelectors) {
      table = doc.querySelector(selector);
      if (table) {
        logger.info('JSON', `Found table using selector: ${selector}`);
        break;
      }
    }

    if (!table) {
      logger.warn('JSON', 'No table element found');
      return null;
    }

    // Get all rows
    let allRows = table.querySelectorAll('tr');
    if (allRows.length === 0) {
      allRows = table.querySelectorAll('[role="row"]');
    }

    logger.info('JSON', `Found ${allRows.length} rows`);

    if (allRows.length === 0) {
      return null;
    }

    const headers = [];
    const rows = [];

    allRows.forEach((row, rowIndex) => {
      // Get cells for this row
      let cellElements = row.querySelectorAll('th, td');
      if (cellElements.length === 0) {
        cellElements = row.querySelectorAll('[role="cell"], [role="columnheader"]');
      }

      const cells = Array.from(cellElements).map(cell => cell.textContent.trim());

      // First row is typically headers
      if (rowIndex === 0) {
        headers.push(...cells);
      } else {
        // Create row object with header keys
        const rowObj = {};
        cells.forEach((cell, cellIndex) => {
          const header = headers[cellIndex] || `Column ${cellIndex + 1}`;
          rowObj[header] = cell;
        });
        rows.push(rowObj);
      }
    });

    logger.info('JSON', `Extracted ${headers.length} headers and ${rows.length} data rows`);

    return {
      headers: headers,
      rows: rows
    };
  } catch (error) {
    logger.error('JSON', `Error extracting table data: ${error.message}`);
    return null;
  }
}

/**
 * Create a clean HTML file from table data with footnotes
 * Returns a formatted HTML document string
 */
function createCleanTableHTML(htmlContent, title, footnotes) {
  logger.info('HTML', `Creating clean HTML table document for: "${title}"`);

  try {
    // Parse HTML content
    const parser = new DOMParser();
    let htmlToParse = htmlContent;

    // If HTML starts with <tr>, wrap in table tags
    if (htmlContent.trim().startsWith('<tr')) {
      htmlToParse = `<table>${htmlContent}</table>`;
    }

    const doc = parser.parseFromString(htmlToParse, 'text/html');

    // Try multiple selectors to find the table
    const tableSelectors = ['table', '[role="table"]', '.table'];
    let sourceTable = null;
    for (const selector of tableSelectors) {
      sourceTable = doc.querySelector(selector);
      if (sourceTable) {
        logger.info('HTML', `Found table using selector: ${selector}`);
        break;
      }
    }

    if (!sourceTable) {
      logger.warn('HTML', 'No table element found');
      return null;
    }

    // Get all rows
    let allRows = sourceTable.querySelectorAll('tr');
    if (allRows.length === 0) {
      allRows = sourceTable.querySelectorAll('[role="row"]');
    }

    logger.info('HTML', `Found ${allRows.length} rows`);

    if (allRows.length === 0) {
      return null;
    }

    // Build clean table HTML
    let tableHTML = '<table>\n';

    allRows.forEach((row, rowIndex) => {
      // Get cells for this row
      let cellElements = row.querySelectorAll('th, td');
      if (cellElements.length === 0) {
        cellElements = row.querySelectorAll('[role="cell"], [role="columnheader"]');
      }

      // Determine if this is a header row (first row or contains th elements)
      const isHeaderRow = rowIndex === 0 || row.querySelectorAll('th').length > 0;
      const cellTag = isHeaderRow ? 'th' : 'td';

      tableHTML += '  <tr>\n';

      cellElements.forEach(cell => {
        const cellText = cell.textContent.trim();
        // Escape HTML entities
        const escapedText = cellText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

        tableHTML += `    <${cellTag}>${escapedText}</${cellTag}>\n`;
      });

      tableHTML += '  </tr>\n';
    });

    tableHTML += '</table>';

    // Build footnotes HTML if present
    let footnotesHTML = '';
    if (footnotes && footnotes.trim().length > 0) {
      footnotesHTML = '\n\n<section class="footnotes">\n';
      footnotesHTML += '  <h2>References</h2>\n';

      // Parse footnotes into individual items
      const footnoteItems = footnotes.split('\n\n').filter(line => /^\[\d+\]/.test(line.trim()));

      if (footnoteItems.length > 0) {
        footnoteItems.forEach(footnote => {
          const escapedFootnote = footnote
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          footnotesHTML += `  <p class="footnote">${escapedFootnote}</p>\n`;
        });
      }

      footnotesHTML += '</section>';
    }

    // Create complete HTML document
    const htmlDocument = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }

    h1 {
      color: #333;
      border-bottom: 3px solid #4285f4;
      padding-bottom: 10px;
      margin-bottom: 30px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 40px;
    }

    th, td {
      border: 1px solid #ddd;
      padding: 12px 15px;
      text-align: left;
    }

    th {
      background-color: #4285f4;
      color: white;
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    tr:nth-child(even) {
      background-color: #f9f9f9;
    }

    tr:hover {
      background-color: #f0f0f0;
    }

    .footnotes {
      background: white;
      padding: 20px 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .footnotes h2 {
      color: #333;
      border-bottom: 2px solid #4285f4;
      padding-bottom: 8px;
      margin-bottom: 20px;
    }

    .footnote {
      margin: 12px 0;
      padding: 8px 0;
      color: #555;
      line-height: 1.8;
    }

    @media print {
      body {
        background: white;
      }

      table {
        box-shadow: none;
      }

      th {
        position: relative;
      }
    }
  </style>
</head>
<body>
  <h1>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>

${tableHTML}
${footnotesHTML}
</body>
</html>`;

    logger.info('HTML', `Created clean HTML document (${htmlDocument.length} chars)`);
    return htmlDocument;

  } catch (error) {
    logger.error('HTML', `Error creating clean HTML: ${error.message}`);
    return null;
  }
}

// ==================== MARKDOWN CONVERSION ====================

function convertToMarkdown(htmlContent, sources, noteTitle, citationsCodeBlock = true, skipTitleIfPresent = false, noteId = null) {
  // Debug: Log what we're converting
  logger.info('Markdown', `Converting note: "${noteTitle}"`);
  logger.info('Markdown', `  - HTML content length: ${htmlContent.length} chars`);
  logger.info('Markdown', `  - Number of sources: ${sources?.length || 0}`);
  logger.info('Markdown', `  - Citations code block: ${citationsCodeBlock}`);
  logger.info('Markdown', `  - Note ID for anchors: ${noteId || 'none (standalone)'}`);
  if (sources && sources.length > 0) {
    logger.info('Markdown', `  - Source indices: [${sources.map(s => s.sourceIndex).join(', ')}]`);
  }

  // Create anchor prefix for combined notes (prevents ID collisions)
  const anchorPrefix = noteId ? `note-${noteId}-` : '';

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

  // Initialize TurndownService with standardized configuration
  const turndownService = createTurndownService();

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

  // Custom rule for blockquotes (callout boxes)
  turndownService.addRule('blockquotes', {
    filter: (node) => {
      return node.nodeName === 'DIV' &&
             node.classList.contains('blockquote');
    },
    replacement: (content, node) => {
      // Get the text content and convert to blockquote format
      const text = content.trim();
      if (!text) return '';

      // Split by lines and add > prefix to each line
      const lines = text.split('\n').map(line => {
        const trimmed = line.trim();
        return trimmed ? `> ${trimmed}` : '>';
      });

      return `\n${lines.join('\n')}\n\n`;
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

  // Custom rule for lists with Angular wrapper components
  // Handles <ol>/<ul> where <li> elements are nested inside wrapper components
  turndownService.addRule('listsWithWrappers', {
    filter: (node) => {
      return node.nodeName === 'OL' || node.nodeName === 'UL';
    },
    replacement: (content, node, options) => {
      const isOrdered = node.nodeName === 'OL';

      // Find all <li> elements at any depth
      const allLis = Array.from(node.querySelectorAll('li'));

      // Filter to only include <li> elements that belong directly to this list
      // (exclude nested list items)
      const items = allLis.filter(li => {
        let parent = li.parentElement;
        while (parent && parent !== node) {
          const tagName = parent.tagName;
          if (tagName === 'OL' || tagName === 'UL') {
            return false; // This li belongs to a nested list
          }
          parent = parent.parentElement;
        }
        return true; // This li belongs to this list
      });

      if (items.length === 0) {
        // No list items found, fall back to default behavior
        return '\n' + content + '\n';
      }

      // Generate markdown for each list item
      let markdown = '\n';
      items.forEach((li, idx) => {
        const marker = isOrdered ? `${idx + 1}.` : options.bulletListMarker;
        const itemContent = turndownService.turndown(li.innerHTML).trim();
        markdown += `${marker} ${itemContent}\n`;
      });
      markdown += '\n';

      return markdown;
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

      const output = `<sup><a id="${anchorPrefix}cite-ref-${displayNumber}-${occurrenceCount}" href="#${anchorPrefix}src-${displayNumber}">[${displayNumber}]</a></sup>`;
      logger.info('Citation', `  - generated: ${output}`);

      return output;
    }
  });

  // Convert main content
  let bodyMarkdown = turndownService.turndown(htmlContent);

  // Clean up: Merge consecutive footnote references into a single <sup> tag
  // Pattern: <sup>...[1]...</sup>,<sup>...[2]...</sup> → <sup>...[1]... ...[2]...</sup>
  // This removes both commas and the >< between footnotes
  bodyMarkdown = bodyMarkdown.replace(/<\/sup>\s*,?\s*<sup>/g, ' ');

  // Clean up escaped brackets that appear between sup tags
  // Pattern: </sup>\> <<sup> (literal backslash-greater-than space less-than)
  bodyMarkdown = bodyMarkdown.replace(/<\/sup>\\>\s*<<sup>/g, ' ');

  // Also clean up unescaped >< between sup tags
  // Pattern: </sup>><sup> or </sup>> <<sup>
  bodyMarkdown = bodyMarkdown.replace(/<\/sup>>\s*<<sup>/g, ' ');

  // Final cleanup: remove any remaining standalone \> < patterns in text
  bodyMarkdown = bodyMarkdown.replace(/\\>\s*</g, '');

  // Check if content already starts with the title as H1
  let markdown = '';
  // Skip title if empty string (used when title is added externally)
  if (!noteTitle || noteTitle.trim() === '') {
    logger.info('Markdown', `  - Skipping title (empty/not provided)`);
    markdown = bodyMarkdown;
  } else if (skipTitleIfPresent) {
    const titlePattern = new RegExp(`^#\\s+${noteTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i');
    if (titlePattern.test(bodyMarkdown)) {
      // Content already has title - don't add duplicate
      logger.info('Markdown', `  - Skipping duplicate title (already present in content)`);
      markdown = bodyMarkdown;
    } else {
      // Content doesn't have title - add it
      markdown = `# ${noteTitle}\n\n${bodyMarkdown}`;
    }
  } else {
    // Always add title (default behavior)
    markdown = `# ${noteTitle}\n\n${bodyMarkdown}`;
  }

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
      markdown += `<a id="${anchorPrefix}src-${displayNumber}"></a>\n`;

      // Make source number clickable to jump back to first citation
      markdown += `**[[${displayNumber}]](#${anchorPrefix}cite-ref-${displayNumber}-1)** ${source.text}\n\n`;

      // Include the quote if available
      if (source.quote && source.quote.length > 0) {
        if (citationsCodeBlock) {
          // Wrap in markdown code block for data separation
          markdown += `\`\`\`markdown\n${source.quote}\n\`\`\`\n\n`;
        } else {
          // Insert markdown directly (rendered)
          markdown += `${source.quote}\n\n`;
        }
      }
    });
  }

  return markdown;
}

function sanitizeFilename(filename) {
  let clean = filename
    // Replace OS-restricted characters with underscore
    .replace(/[<>:"/\\|?*]/g, '_')
    // Replace quotes and apostrophes (straight and curly) with nothing
    // U+0027 ' straight apostrophe, U+0060 ` backtick, U+00B4 ´ acute accent
    // U+2018 ' left single quote, U+2019 ' right single quote (curly apostrophe)
    // U+201C " left double quote, U+201D " right double quote
    .replace(/[\u0027\u0060\u00B4\u2018\u2019\u0022\u201C\u201D]/g, '')
    // Replace other problematic characters
    .replace(/[#%&{}$!@+]/g, '_')
    // Replace multiple periods with single period (avoid confusion with extensions)
    .replace(/\.{2,}/g, '.')
    // Replace whitespace with hyphens
    .replace(/\s+/g, '-')
    // Collapse multiple hyphens/underscores
    .replace(/[-_]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Limit length (leave room for extension)
    .substring(0, 100);

  // Fallback if sanitization resulted in empty string
  if (clean.length === 0) {
    clean = 'untitled';
  }

  return clean;
}

/**
 * Retry an async operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 2)
 * @param {number} baseDelay - Base delay in ms for exponential backoff (default: 1000)
 * @param {string} operationName - Name for logging purposes
 * @returns {Promise<any>} Result of the operation
 */
async function retryOperation(operation, maxRetries = 2, baseDelay = 1000, operationName = 'operation') {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info('Retry', `${operationName}: Attempt ${attempt}/${maxRetries}`);
      return await operation();
    } catch (error) {
      lastError = error;
      logger.warn('Retry', `${operationName}: Attempt ${attempt} failed - ${error.message}`);

      // Don't retry on the last attempt
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, etc.
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.info('Retry', `${operationName}: Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  logger.error('Retry', `${operationName}: All ${maxRetries} attempts failed`);
  throw lastError;
}

/**
 * Download an image from a URL and convert to base64 data URI
 */
async function downloadImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const blob = await response.blob();

    // Get MIME type from response or blob
    const mimeType = blob.type || 'image/jpeg';

    // Convert blob to base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // reader.result is already a data URI (data:image/jpeg;base64,...)
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`[NotebookLM Takeout] Failed to download image: ${url}`, error);
    throw error;
  }
}

/**
 * Scan markdown for Googleusercontent image URLs and replace with base64 data URIs
 */
async function embedImagesInMarkdown(markdown, sourceTitle) {
  // Match markdown image syntax: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\((https:\/\/lh3\.googleusercontent\.com\/[^\)]+)\)/g;

  const matches = [...markdown.matchAll(imageRegex)];

  if (matches.length === 0) {
    return { markdown, errors: [], imagesFound: 0, imagesEmbedded: 0 };
  }

  console.log(`[NotebookLM Takeout] Found ${matches.length} images in "${sourceTitle}"`);

  const errors = [];
  let updatedMarkdown = markdown;
  let successCount = 0;

  for (const match of matches) {
    const fullMatch = match[0];
    const altText = match[1];
    const imageUrl = match[2];

    try {
      console.log(`[NotebookLM Takeout] Downloading image: ${imageUrl.substring(0, 100)}...`);
      const dataUri = await downloadImageAsBase64(imageUrl);

      // Replace the URL with the data URI
      const replacement = `![${altText}](${dataUri})`;
      updatedMarkdown = updatedMarkdown.replace(fullMatch, replacement);

      successCount++;
      console.log(`[NotebookLM Takeout] Successfully embedded image (${(dataUri.length / 1024).toFixed(1)} KB)`);
    } catch (error) {
      console.error(`[NotebookLM Takeout] Failed to embed image:`, error);
      errors.push({
        source: sourceTitle,
        type: 'image_download_failed',
        message: `Failed to download image: ${error.message}`,
        url: imageUrl.substring(0, 100) + '...'
      });
    }
  }

  return {
    markdown: updatedMarkdown,
    errors,
    imagesFound: matches.length,
    imagesEmbedded: successCount
  };
}

/**
 * Remove all images from markdown
 */
function stripImagesFromMarkdown(markdown) {
  // Remove markdown image syntax: ![alt](url)
  // This matches both embedded base64 and external URLs
  return markdown.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');
}

// ==================== EXPORT ORCHESTRATION ====================

/**
 * Extract project name from the NotebookLM page
 */
async function getProjectName(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_PROJECT_NAME' });
    if (response && response.projectName) {
      console.log('[NotebookLM Takeout] Project name:', response.projectName);
      return response.projectName;
    }
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not extract project name:', error);
  }
  return 'NotebookLM';
}

async function exportNotesAsMarkdown(selectedNotes) {
  console.log('[NotebookLM Takeout] Starting export for notes:', selectedNotes.length);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Get project name and timestamp at the start (same for all batches)
  const projectName = await getProjectName(tab.id);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  console.log('[NotebookLM Takeout] Export timestamp:', timestamp, 'Project:', projectName);

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

  const allErrors = [];
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
    // Calculate batch configuration
    const NOTES_PER_ZIP = settings.notesPerZip;
    const totalZips = Math.ceil(selectedNotes.length / NOTES_PER_ZIP);
    console.log(`[NotebookLM Takeout] Will create ${totalZips} ZIP(s) for ${selectedNotes.length} notes (${NOTES_PER_ZIP} per ZIP)`);

    // Process in batches: extract batch → create ZIP → download → clear memory → repeat
    for (let zipIndex = 0; zipIndex < totalZips; zipIndex++) {
      if (cancelled) {
        console.log('[NotebookLM Takeout] Export cancelled by user');
        showToast('Export cancelled', 'warning');
        break;
      }

      const startIdx = zipIndex * NOTES_PER_ZIP;
      const endIdx = Math.min(startIdx + NOTES_PER_ZIP, selectedNotes.length);
      const batchNotes = selectedNotes.slice(startIdx, endIdx);
      const exportedNotes = []; // Only store current batch in memory

      console.log(`[NotebookLM Takeout] Processing batch ${zipIndex + 1}/${totalZips}: notes ${startIdx + 1}-${endIdx}`);

    // Extract notes for this batch only
    for (let i = 0; i < batchNotes.length; i++) {
      // Check for cancellation
      if (cancelled) {
        console.log('[NotebookLM Takeout] Export cancelled by user');
        showToast('Export cancelled', 'warning');
        break;
      }

      const note = batchNotes[i];
      const overallIndex = startIdx + i;
      const progress = ((overallIndex + 1) / selectedNotes.length) * 100;

      console.log(`[NotebookLM Takeout] Processing note ${overallIndex + 1}/${selectedNotes.length}:`, note.title, 'index:', note.index);

      // Update sidebar progress
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `Batch ${zipIndex + 1}/${totalZips}: Processing ${i + 1}/${batchNotes.length}: ${note.title}`;

      // Update page overlay
      await chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_EXPORT_OVERLAY',
        message: `Batch ${zipIndex + 1}/${totalZips}: Processing ${i + 1}/${batchNotes.length}: ${note.title}`,
        progress: progress
      });

      try {
        // Extract note content via content script
        console.log('[NotebookLM Takeout] Sending message to extract note content...');

        const noteData = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_NOTE',
          data: {
            noteIndex: note.index,
            noteTitle: note.title,
            includeCitationImages: settings.includeCitationImages
          }
        });

        console.log('[NotebookLM Takeout] Note data received:', noteData);

        if (noteData && !noteData.error) {
          // Collect errors from this note
          if (noteData.errors && noteData.errors.length > 0) {
            noteData.errors.forEach(err => {
              allErrors.push(`[${note.title}] ${err}`);
            });
          }

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
            // Convert to markdown (without noteId for individual files)
            const markdown = convertToMarkdown(noteData.html, noteData.sources, note.title, settings.citationsCodeBlock);

            exportedNotes.push({
              title: note.title,
              markdown: markdown,
              // Store raw data for combined-notes.md (which needs unique noteIds)
              html: noteData.html,
              sources: noteData.sources
            });
          }

          console.log(`[NotebookLM Takeout] ✓ Successfully extracted note ${overallIndex + 1}/${selectedNotes.length}`);
        } else {
          const errorMsg = `[${note.title}] Failed to extract: ${noteData?.error || 'unknown error'}`;
          allErrors.push(errorMsg);
          console.error(`Failed to extract note: ${note.title}`, noteData?.error);
          showToast(`Skipped: ${note.title} (${noteData?.error || 'unknown error'})`, 'warning');
        }

      } catch (error) {
        const errorMsg = `[${note.title}] Exception during extraction: ${error.message || error.toString()}`;
        allErrors.push(errorMsg);
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

    // Now create ZIP for this batch and download it immediately
    if (exportedNotes.length > 0) {
      console.log(`[NotebookLM Takeout] Creating ZIP ${zipIndex + 1}/${totalZips} with ${exportedNotes.length} notes from this batch`);
      progressText.textContent = `Creating ZIP ${zipIndex + 1}/${totalZips}...`;
      progressFill.style.width = '100%';
      // Create ZIP for this batch (pass ALL errors only to LAST batch so errors.txt contains everything)
      const batchErrors = (zipIndex === totalZips - 1) ? allErrors : [];
      const versionCount = await createNotesZip(exportedNotes, batchErrors, zipIndex + 1, totalZips, projectName, timestamp);

      // Show toast only on last batch
      if (zipIndex === totalZips - 1) {
        let successMsg;
        if (allErrors.length > 0) {
          // Build detailed error message
          const errorCount = allErrors.length;
          const failedNotes = allErrors.filter(e => e.includes('Extraction failed')).length;

          if (versionCount > 1) {
            successMsg = `Exported ${selectedNotes.length} notes in ${totalZips} ZIP(s) (${versionCount} versions) with ${errorCount} warning(s)`;
          } else {
            successMsg = `Exported ${selectedNotes.length} notes in ${totalZips} ZIP(s) with ${errorCount} warning(s)`;
          }

          if (failedNotes > 0) {
            successMsg += ` (${failedNotes} failed to extract)`;
          }
          successMsg += '. See errors.txt in last ZIP for details.';
        } else {
          // Success message
          if (versionCount > 1) {
            successMsg = `Successfully exported ${selectedNotes.length} notes in ${totalZips} ZIP(s) (${versionCount} versions)`;
          } else {
            successMsg = `Successfully exported ${selectedNotes.length} notes in ${totalZips} ZIP(s)`;
          }
        }
        showToast(successMsg, allErrors.length > 0 ? 'warning' : 'success');
      }

      // CRITICAL: Clear memory after each ZIP to prevent crashes
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clear the batch data to free memory
      exportedNotes.forEach(note => {
        note.markdown = null;
        note.html = null;
        note.sources = null;
        note.svgContent = null;
        note.treeData = null;
      });

      console.log(`[NotebookLM Takeout] Cleared memory for batch ${zipIndex + 1}/${totalZips}`);
      exportedNotes.length = 0;

      // Give GC time to work between batches
      if (zipIndex < totalZips - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } // End of "if exportedNotes.length > 0"
    } // End of batch loop

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

async function createNotesZip(notes, errors = [], batchIndex = 1, totalBatches = 1, projectName = 'NotebookLM', timestamp = null) {
  const zip = new JSZip();
  const indexFiles = []; // Track all files for _index.md
  let versionCount = 0; // Track number of versions created

  // Use provided timestamp or generate new one
  if (!timestamp) {
    timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  }

  // Add errors.txt if there are any errors (only in LAST batch so it contains ALL errors)
  if (errors.length > 0 && batchIndex === totalBatches) {
    let errorsContent = '# NotebookLM Export Errors\n\n';
    errorsContent += `Total Errors: ${errors.length}\n`;
    errorsContent += `Generated: ${new Date().toLocaleString()}\n\n`;
    errorsContent += '---\n\n';
    errors.forEach((err, idx) => {
      errorsContent += `${idx + 1}. ${err}\n`;
    });
    zip.file('errors.txt', errorsContent);
    indexFiles.push({ path: 'errors.txt', title: 'Export Errors' });
  }

  // Separate notes and mindmaps
  const regularNotes = notes.filter(n => !n.isMindmap);
  const mindmaps = notes.filter(n => n.isMindmap);

  // Determine which versions to create based on settings
  const versions = [];

  // Version 1: Base (markdown rendering, no images) - Always created if enabled
  if (settings.exportNoteBase) {
    versions.push({
      folderSuffix: '',
      fileSuffix: '',
      combinedSuffix: '',
      citationsCodeBlock: false,
      stripImages: true,
      title: 'Base (markdown, no images)',
      description: 'Citations rendered as markdown, images stripped'
    });
  }

  // Version 2: Code blocks, no images
  if (settings.exportNoteCodeBlocks) {
    versions.push({
      folderSuffix: '-code-blocks',
      fileSuffix: '-code-blocks',
      combinedSuffix: '-code-blocks',
      citationsCodeBlock: true,
      stripImages: true,
      title: 'Code blocks (no images)',
      description: 'Citations in code blocks, images stripped'
    });
  }

  // Version 3: Markdown rendering, with images
  if (settings.exportNoteWithImages) {
    versions.push({
      folderSuffix: '-with-images',
      fileSuffix: '-with-images',
      combinedSuffix: '-with-images',
      citationsCodeBlock: false,
      stripImages: false,
      title: 'With images (markdown)',
      description: 'Citations rendered as markdown, with base64 images'
    });
  }

  // Version 4: Code blocks, with images
  if (settings.exportNoteCodeBlocksWithImages) {
    versions.push({
      folderSuffix: '-code-blocks-with-images',
      fileSuffix: '-code-blocks-with-images',
      combinedSuffix: '-code-blocks-with-images',
      citationsCodeBlock: true,
      stripImages: false,
      title: 'Code blocks with images',
      description: 'Citations in code blocks, with base64 images'
    });
  }

  console.log(`[NotebookLM Takeout] Creating ${versions.length} version(s) of ${regularNotes.length} notes`);
  versionCount = versions.length;

  // Process regular notes (all versions in single notes/ folder with suffixes)
  if (regularNotes.length > 0) {
    const notesFolder = zip.folder('notes');

    // Track filenames across ALL versions to prevent collisions
    const allUsedFilenames = new Set();

    versions.forEach(version => {
      // Individual note files with version suffix
      regularNotes.forEach(note => {
        let baseFilename = sanitizeFilename(note.title);
        let filename = baseFilename + version.fileSuffix + '.md';
        let counter = 2;

        // If duplicate, append counter before suffix
        while (allUsedFilenames.has(filename)) {
          filename = `${baseFilename}-${counter}${version.fileSuffix}.md`;
          counter++;
        }

        allUsedFilenames.add(filename);

        // Generate markdown with appropriate settings
        // Use skipTitleIfPresent=true to avoid duplicate titles
        let markdown = convertToMarkdown(
          note.html,
          note.sources,
          note.title,
          version.citationsCodeBlock,
          true // skipTitleIfPresent
        );

        // Strip images if needed
        if (version.stripImages) {
          markdown = stripImagesFromMarkdown(markdown);
        }

        notesFolder.file(filename, markdown);
        indexFiles.push({
          path: `notes/${filename}`,
          title: note.title,
          version: version.title,
          versionDescription: version.description,
          itemType: 'Notes'
        });
      });

      // Combined markdown file for this version
      let combinedMarkdown = `# NotebookLM Notes Export\n\n`;
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
          noteId // unique ID for this note's anchors
        );

        // Strip images if needed
        if (version.stripImages) {
          noteMarkdown = stripImagesFromMarkdown(noteMarkdown);
        }

        combinedMarkdown += noteMarkdown + '\n\n';
        if (idx < regularNotes.length - 1) {
          combinedMarkdown += '---\n\n';
        }
      });

      const combinedFilename = `combined-notes${version.combinedSuffix}.md`;
      zip.file(combinedFilename, combinedMarkdown);
      indexFiles.push({
        path: combinedFilename,
        title: `Combined Notes - ${version.title}`,
        version: version.title,
        versionDescription: version.description,
        itemType: 'Notes'
      });
    });
  }

  // Create mindmap SVG and JSON files
  if (mindmaps.length > 0) {
    const mindmapsFolder = zip.folder('mindmaps');
    const usedMindmapNames = new Set();

    mindmaps.forEach(mindmap => {
      let baseName = sanitizeFilename(mindmap.title);
      let uniqueName = baseName;
      let counter = 2;

      // If duplicate, append counter
      while (usedMindmapNames.has(uniqueName)) {
        uniqueName = `${baseName}-${counter}`;
        counter++;
      }

      usedMindmapNames.add(uniqueName);
      mindmapsFolder.file(`${uniqueName}.svg`, mindmap.svgContent);
      mindmapsFolder.file(`${uniqueName}.json`, JSON.stringify(mindmap.treeData, null, 2));
      indexFiles.push({ path: `mindmaps/${uniqueName}.svg`, title: `${mindmap.title} (SVG)` });
      indexFiles.push({ path: `mindmaps/${uniqueName}.json`, title: `${mindmap.title} (JSON)` });
    });
  }

  // Generate _index.md with links to all files
  let indexContent = '# NotebookLM Notes Export - File Index\n\n';
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
    indexContent += `Versions: ${versionCount}\n\n`;

    // Combined files section
    const combinedFiles = indexFiles.filter(f => f.path.startsWith('combined-notes') && f.itemType === 'Notes');
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
    const noteFiles = indexFiles.filter(f => f.path.startsWith('notes/') && f.itemType === 'Notes');
    if (noteFiles.length > 0) {
      indexContent += `## Individual Notes\n\n`;
      indexContent += `All versions available in the \`notes/\` folder with suffixes:\n\n`;

      // Group by note title
      const notesByTitle = new Map();
      noteFiles.forEach(file => {
        if (!notesByTitle.has(file.title)) {
          notesByTitle.set(file.title, []);
        }
        notesByTitle.get(file.title).push(file);
      });

      // List each note with its versions
      notesByTitle.forEach((files, title) => {
        indexContent += `### ${title}\n\n`;
        files.forEach(file => {
          const versionLabel = file.version ? ` (${file.version})` : '';
          indexContent += `- [${file.path.split('/')[1]}](${encodeURI(file.path)})${versionLabel}\n`;
        });
        indexContent += '\n';
      });
    }
  }

  if (mindmaps.length > 0) {
    indexContent += '# Mindmaps\n\n';
    indexContent += `Total: ${mindmaps.length}\n\n`;
    indexFiles.filter(f => f.path.startsWith('mindmaps/')).forEach(file => {
      indexContent += `- [${file.title}](${encodeURI(file.path)})\n`;
    });
    indexContent += '\n';
  }

  if (errors.length > 0) {
    indexContent += '# Errors\n\n';
    const errorFile = indexFiles.find(f => f.path === 'errors.txt');
    if (errorFile) {
      indexContent += `- [${errorFile.title}](${encodeURI(errorFile.path)})\n\n`;
    }
  }

  zip.file('_index.md', indexContent);

  // Generate and download ZIP
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);

  try {
    const sanitizedProjectName = sanitizeFilename(projectName);
    let filename;
    if (totalBatches > 1) {
      filename = `${sanitizedProjectName}-notes-${timestamp}-part${batchIndex}of${totalBatches}.zip`;
    } else {
      filename = `${sanitizedProjectName}-notes-${timestamp}.zip`;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    console.log(`[NotebookLM Takeout] Downloaded notes ZIP ${batchIndex}/${totalBatches}: ${filename}`);
  } finally {
    URL.revokeObjectURL(url);
  }

  return versionCount;
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

  // Get project name and timestamp at the start (same for all batches)
  const projectName = await getProjectName(tab.id);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  console.log('[NotebookLM Takeout] Export timestamp:', timestamp, 'Project:', projectName);

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

  const allErrors = [];
  let cancelled = false;

  // Track statistics for error reporting
  const stats = {
    totalSources: selectedSources.length,
    successfulExtractions: 0,
    failedExtractions: 0,
    missingSummaries: 0,
    missingKeyTopics: 0,
    imagesFound: 0,
    imagesEmbedded: 0,
    imagesFailed: 0
  };

  // Listen for cancellation
  const cancelListener = (message) => {
    if (message.type === 'CANCEL_EXPORT') {
      cancelled = true;
    }
  };
  chrome.runtime.onMessage.addListener(cancelListener);

  try {
    // Calculate batch configuration
    const SOURCES_PER_ZIP = settings.sourcesPerZip;
    const totalZips = Math.ceil(selectedSources.length / SOURCES_PER_ZIP);
    console.log(`[NotebookLM Takeout] Will create ${totalZips} ZIP(s) for ${selectedSources.length} sources (${SOURCES_PER_ZIP} per ZIP)`);

    // Process in batches: extract batch → create ZIP → download → clear memory → repeat
    for (let zipIndex = 0; zipIndex < totalZips; zipIndex++) {
      if (cancelled) {
        console.log('[NotebookLM Takeout] Export cancelled by user');
        showToast('Export cancelled', 'warning');
        break;
      }

      const startIdx = zipIndex * SOURCES_PER_ZIP;
      const endIdx = Math.min(startIdx + SOURCES_PER_ZIP, selectedSources.length);
      const batchSources = selectedSources.slice(startIdx, endIdx);
      const exportedSources = []; // Only store current batch in memory

      console.log(`[NotebookLM Takeout] Processing batch ${zipIndex + 1}/${totalZips}: sources ${startIdx + 1}-${endIdx}`);

    // Extract sources for this batch only
    for (let i = 0; i < batchSources.length; i++) {
      // Check for cancellation
      if (cancelled) {
        console.log('[NotebookLM Takeout] Export cancelled by user');
        showToast('Export cancelled', 'warning');
        break;
      }

      const source = batchSources[i];
      const overallIndex = startIdx + i;
      const progress = ((overallIndex + 1) / selectedSources.length) * 100;

      // Update sidebar progress
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `Batch ${zipIndex + 1}/${totalZips}: Extracting ${i + 1}/${batchSources.length}: ${source.title}`;

      // Update page overlay
      await chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_EXPORT_OVERLAY',
        message: `Batch ${zipIndex + 1}/${totalZips}: Extracting ${i + 1}/${batchSources.length}: ${source.title}`,
        progress: progress
      });

      console.log(`[NotebookLM Takeout] Extracting source: "${source.title}"`);

      try {
        // Extract source content with retry logic for transient failures
        const sourceData = await retryOperation(
          async () => {
            return await chrome.tabs.sendMessage(tab.id, {
              type: 'EXTRACT_SOURCE',
              data: { sourceIndex: source.index }
            });
          },
          2, // maxRetries
          1500, // baseDelay (1.5s)
          `Extract source "${source.title}"`
        );

        if (sourceData.error) {
          console.error(`[NotebookLM Takeout] Failed to extract "${source.title}":`, sourceData.error);
          showToast(`Skipped: ${source.title}`, 'warning');

          stats.failedExtractions++;
          allErrors.push({
            source: source.title,
            type: 'extraction_failed',
            message: sourceData.error
          });

          // Try to close panel before continuing
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK' });
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (backError) {
            console.error('[NotebookLM Takeout] Failed to close panel after error:', backError);
          }

          continue;
        }

        // Helper function to build markdown with optional metadata
        const buildMarkdown = (includeMeta) => {
          let md = `# ${source.title}\n\n`;

          // Add YouTube URL if this is a YouTube source
          if (sourceData.youtubeUrl) {
            md += `**YouTube Video:** ${sourceData.youtubeUrl}\n\n`;
          }

          // Add source metadata (summary and key topics) if requested
          if (includeMeta) {
            // Add source guide summary if available
            if (sourceData.guideMarkdown && sourceData.guideMarkdown.trim().length > 0) {
              md += `## Summary\n\n${sourceData.guideMarkdown}\n\n`;
            } else {
              // Track missing summary (only once)
              if (!metadataErrorsTracked) {
                stats.missingSummaries++;
                allErrors.push({
                  source: source.title,
                  type: 'missing_summary',
                  message: 'Source guide/summary not found or empty'
                });
                console.warn(`[NotebookLM Takeout] "${source.title}": Summary/guide is missing`);
              }
            }

            // Add key topics if available
            if (sourceData.keyTopics && sourceData.keyTopics.length > 0) {
              md += `## Key Topics\n\n`;
              sourceData.keyTopics.forEach(topic => {
                md += `- ${topic}\n`;
              });
              md += `\n`;
            } else {
              // Track missing key topics (only once)
              if (!metadataErrorsTracked) {
                stats.missingKeyTopics++;
                allErrors.push({
                  source: source.title,
                  type: 'missing_key_topics',
                  message: 'Key topics not found or empty'
                });
                console.warn(`[NotebookLM Takeout] "${source.title}": Key topics are missing`);
              }
            }
            metadataErrorsTracked = true;
          }

          // Add the main content
          md += `## Content\n\n`;
          md += convertToMarkdown(sourceData.html, sourceData.sources || [], '', settings.citationsCodeBlock);

          return md;
        };

        // Track metadata errors only once per source
        let metadataErrorsTracked = false;

        // Generate 4 versions of markdown:
        // 1. Base: no metadata, no images (always created)
        const baseMarkdown = buildMarkdown(false);
        const baseMarkdownNoImages = stripImagesFromMarkdown(baseMarkdown);

        // 2. Plus-meta: with metadata, no images (conditional)
        const plusMetaMarkdown = buildMarkdown(true);
        const plusMetaMarkdownNoImages = stripImagesFromMarkdown(plusMetaMarkdown);

        // 3. With-images: no metadata, with images (conditional)
        // 4. Plus-meta-with-images: with metadata, with images (conditional)
        let baseMarkdownWithImages = baseMarkdown;
        let plusMetaMarkdownWithImages = plusMetaMarkdown;

        // Embed images for the image versions
        try {
          const {
            markdown: baseEmbedded,
            errors: imageErrors,
            imagesFound,
            imagesEmbedded
          } = await embedImagesInMarkdown(baseMarkdown, source.title);

          baseMarkdownWithImages = baseEmbedded;

          // Track image statistics (only once)
          stats.imagesFound += imagesFound;
          stats.imagesEmbedded += imagesEmbedded;
          stats.imagesFailed += (imagesFound - imagesEmbedded);

          // Track image download errors
          if (imageErrors.length > 0) {
            allErrors.push(...imageErrors);
          }

          // Also embed images in the plus-meta version
          const { markdown: plusMetaEmbedded } = await embedImagesInMarkdown(plusMetaMarkdown, source.title);
          plusMetaMarkdownWithImages = plusMetaEmbedded;

        } catch (error) {
          console.error(`[NotebookLM Takeout] Error embedding images for "${source.title}":`, error);
          allErrors.push({
            source: source.title,
            type: 'image_embedding_error',
            message: `Failed to embed images: ${error.message}`
          });
        }

        exportedSources.push({
          title: source.title,
          youtubeUrl: sourceData.youtubeUrl || null,
          // Store metadata for index
          summary: sourceData.guideMarkdown || null,
          keyTopics: sourceData.keyTopics || [],
          // Store all 4 versions
          versions: {
            base: baseMarkdownNoImages,                    // [filename].md
            plusMeta: plusMetaMarkdownNoImages,            // [filename]-plus-meta.md
            withImages: baseMarkdownWithImages,            // [filename]-with-images.md
            plusMetaWithImages: plusMetaMarkdownWithImages // [filename]-plus-meta-with-images.md
          }
        });

        stats.successfulExtractions++;
        console.log(`[NotebookLM Takeout] Successfully extracted "${source.title}", now closing panel...`);

        // Navigate back to sources list
        const backResponse = await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK' });
        console.log('[NotebookLM Takeout] NAVIGATE_BACK response:', backResponse);

        // Wait for panel to close and sources list to reappear
        await new Promise(resolve => setTimeout(resolve, 1500));

      } catch (error) {
        console.error(`[NotebookLM Takeout] Error extracting source "${source.title}":`, error);
        showToast(`Error: ${source.title}`, 'error');

        stats.failedExtractions++;
        allErrors.push({
          source: source.title,
          type: 'extraction_error',
          message: error.message,
          stack: error.stack
        });

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

    // Now create ZIP for this batch and download it immediately
    if (exportedSources.length > 0) {
      console.log(`[NotebookLM Takeout] Creating ZIP ${zipIndex + 1}/${totalZips} with ${exportedSources.length} sources from this batch`);

      // Update progress
      progressText.textContent = `Creating ZIP ${zipIndex + 1}/${totalZips}...`;
      progressFill.style.width = '100%';

      const zip = new JSZip();
      const sourcesFolder = zip.folder('sources');
      const usedSourceFilenames = new Set();
      const indexFiles = []; // Track files in this ZIP

      exportedSources.forEach(source => {
        let baseFilename = sanitizeFilename(source.title);

        // Helper to generate unique filename
        const getUniqueFilename = (suffix = '') => {
          let filename = suffix ? `${baseFilename}${suffix}.md` : `${baseFilename}.md`;
          let counter = 2;
          while (usedSourceFilenames.has(filename)) {
            filename = suffix ? `${baseFilename}${suffix}-${counter}.md` : `${baseFilename}-${counter}.md`;
            counter++;
          }
          usedSourceFilenames.add(filename);
          return filename;
        };

        // 1. Base version: [filename].md (no meta, no images) - Always created if enabled
        if (settings.exportSourceBase) {
          const baseFilename1 = getUniqueFilename();
          sourcesFolder.file(baseFilename1, source.versions.base);
          indexFiles.push({
            path: `sources/${baseFilename1}`,
            title: source.title,
            variant: 'base',
            hasMeta: false,
            hasImages: false
          });
        }

        // 2. Plus metadata version: [filename]-plus-meta.md (with meta, no images)
        if (settings.exportSourcePlusMeta) {
          const plusMetaFilename = getUniqueFilename('-plus-meta');
          sourcesFolder.file(plusMetaFilename, source.versions.plusMeta);
          indexFiles.push({
            path: `sources/${plusMetaFilename}`,
            title: source.title,
            variant: 'plusMeta',
            hasMeta: true,
            hasImages: false
          });
        }

        // 3. With images version: [filename]-with-images.md (no meta, with images)
        if (settings.exportSourceWithImages) {
          const withImagesFilename = getUniqueFilename('-with-images');
          sourcesFolder.file(withImagesFilename, source.versions.withImages);
          indexFiles.push({
            path: `sources/${withImagesFilename}`,
            title: source.title,
            variant: 'withImages',
            hasMeta: false,
            hasImages: true
          });
        }

        // 4. Plus metadata with images version: [filename]-plus-meta-with-images.md (with meta, with images)
        if (settings.exportSourcePlusMetaWithImages) {
          const plusMetaWithImagesFilename = getUniqueFilename('-plus-meta-with-images');
          sourcesFolder.file(plusMetaWithImagesFilename, source.versions.plusMetaWithImages);
          indexFiles.push({
            path: `sources/${plusMetaWithImagesFilename}`,
            title: source.title,
            variant: 'plusMetaWithImages',
            hasMeta: true,
            hasImages: true
          });
        }
      });

      // Add README explaining the file naming
      let readmeContent = '# NotebookLM Sources Export\n\n';
      readmeContent += `Generated: ${new Date().toLocaleString()}\n\n`;
      readmeContent += '---\n\n';
      readmeContent += '## File Naming Convention\n\n';

      // Determine which versions were created based on settings
      const enabledVersions = [];
      if (settings.exportSourceBase) enabledVersions.push('base');
      if (settings.exportSourcePlusMeta) enabledVersions.push('plusMeta');
      if (settings.exportSourceWithImages) enabledVersions.push('withImages');
      if (settings.exportSourcePlusMetaWithImages) enabledVersions.push('plusMetaWithImages');

      const versionCount = enabledVersions.length;
      readmeContent += `Each source is exported in ${versionCount} version(s):\n\n`;

      let sectionNum = 1;

      // 1. Base version
      if (settings.exportSourceBase) {
        readmeContent += `### ${sectionNum}. Base files (e.g., \`Document-1.md\`)\n\n`;
        readmeContent += '- **Minimal version** - no metadata, no images\n';
        readmeContent += '- Smallest file size, fastest to process\n';
        readmeContent += '- Perfect for AI processing (Claude, ChatGPT, etc.)\n';
        readmeContent += '- Best for search indexing and text analysis\n\n';
        sectionNum++;
      }

      // 2. Plus-meta version
      if (settings.exportSourcePlusMeta) {
        readmeContent += `### ${sectionNum}. Plus-meta files (e.g., \`Document-1-plus-meta.md\`)\n\n`;
        readmeContent += '- **With metadata** - includes AI-generated summary & key topics\n';
        readmeContent += '- No images (text only)\n';
        readmeContent += '- Good for understanding source context\n';
        readmeContent += '- Still optimized for AI processing\n\n';
        sectionNum++;
      }

      // 3. With-images version
      if (settings.exportSourceWithImages) {
        readmeContent += `### ${sectionNum}. With-images files (e.g., \`Document-1-with-images.md\`)\n\n`;
        readmeContent += '- **With embedded images** - images as base64 data URIs\n';
        readmeContent += '- No metadata (content only)\n';
        readmeContent += '- Self-contained, works offline\n';
        readmeContent += '- Larger file size due to embedded images\n';
        readmeContent += '- Best for archival and complete backups\n\n';

        if (stats.imagesFound > 0) {
          readmeContent += `**Image Statistics:** ${stats.imagesFound} image(s) found, `;
          readmeContent += `${stats.imagesEmbedded} successfully embedded as base64.\n\n`;
        }
        sectionNum++;
      }

      // 4. Plus-meta-with-images version
      if (settings.exportSourcePlusMetaWithImages) {
        readmeContent += `### ${sectionNum}. Plus-meta-with-images files (e.g., \`Document-1-plus-meta-with-images.md\`)\n\n`;
        readmeContent += '- **Complete version** - metadata + images\n';
        readmeContent += '- Largest file size\n';
        readmeContent += '- Best for comprehensive archival\n';
        readmeContent += '- Self-contained with full context\n\n';
        sectionNum++;
      }

      readmeContent += '---\n\n';
      readmeContent += '## File Contents\n\n';
      readmeContent += 'Base and with-images files include:\n';
      readmeContent += '- **Content** - Full document content with citations\n\n';
      readmeContent += 'Plus-meta files additionally include:\n';
      readmeContent += '- **Summary** - AI-generated source guide (if available)\n';
      readmeContent += '- **Key Topics** - Important themes (if available)\n\n';

      readmeContent += '---\n\n';
      readmeContent += '## Choosing the Right Version\n\n';
      readmeContent += '- **For AI/LLM processing**: Use base files (smallest, fastest)\n';
      readmeContent += '- **For human review with context**: Use plus-meta files\n';
      readmeContent += '- **For offline viewing with images**: Use with-images files\n';
      readmeContent += '- **For complete archival**: Use plus-meta-with-images files\n';
      readmeContent += '\n';

      // Add batch info to README
      if (totalZips > 1) {
        readmeContent += `\n---\n\n`;
        readmeContent += `**Note:** This is part ${zipIndex + 1} of ${totalZips} in a split export.\n`;
        readmeContent += `Total sources across all ZIPs: ${selectedSources.length}\n`;
        readmeContent += `Sources in this ZIP: ${exportedSources.length}\n`;
      }

      zip.file('README.txt', readmeContent);

      // Add detailed error report if there are any issues
      // Include errors.txt in the LAST ZIP so it contains ALL errors from all batches
      if ((zipIndex === totalZips - 1) && allErrors.length > 0) {
        let errorsContent = '# Source Export Error Report\n\n';
        errorsContent += `Generated: ${new Date().toLocaleString()}\n\n`;
        errorsContent += '---\n\n';

        // Summary Statistics
        errorsContent += '## Summary Statistics\n\n';
        errorsContent += `- **Total Sources Selected:** ${stats.totalSources}\n`;
        errorsContent += `- **Successfully Extracted:** ${stats.successfulExtractions}\n`;
        errorsContent += `- **Failed Extractions:** ${stats.failedExtractions}\n`;
        if (settings.exportSourcePlusMeta || settings.exportSourcePlusMetaWithImages) {
          errorsContent += `- **Missing Summaries:** ${stats.missingSummaries}\n`;
          errorsContent += `- **Missing Key Topics:** ${stats.missingKeyTopics}\n`;
        }
        if (stats.imagesFound > 0) {
          errorsContent += `- **Images Found:** ${stats.imagesFound}\n`;
          errorsContent += `- **Images Embedded:** ${stats.imagesEmbedded}\n`;
          errorsContent += `- **Images Failed:** ${stats.imagesFailed}\n`;
        }
        const successRate = stats.totalSources > 0
          ? ((stats.successfulExtractions / stats.totalSources) * 100).toFixed(1)
          : '0';
        errorsContent += `- **Success Rate:** ${successRate}%\n`;
        errorsContent += `\n---\n\n`;

        // Group errors by type
        const errorsByType = {};
        allErrors.forEach(err => {
          if (!errorsByType[err.type]) {
            errorsByType[err.type] = [];
          }
          errorsByType[err.type].push(err);
        });

        // Error Details
        errorsContent += '## Error Details\n\n';

        if (errorsByType.extraction_failed || errorsByType.extraction_error) {
          errorsContent += '### EXTRACTION FAILURES\n\n';
          const failures = [
            ...(errorsByType.extraction_failed || []),
            ...(errorsByType.extraction_error || [])
          ];
          failures.forEach((err, idx) => {
            errorsContent += `**${idx + 1}. ${err.source}**\n`;
            errorsContent += `- Error: ${err.message}\n`;
            if (err.stack) {
              errorsContent += `- Stack: ${err.stack}\n`;
            }
            errorsContent += `\n`;
          });
          errorsContent += `\n`;
        }

        if ((settings.exportSourcePlusMeta || settings.exportSourcePlusMetaWithImages) && errorsByType.missing_summary) {
          errorsContent += '### MISSING SUMMARIES\n\n';
          errorsContent += 'The following sources were exported but their source guide/summary was not found:\n\n';
          errorsByType.missing_summary.forEach((err, idx) => {
            errorsContent += `${idx + 1}. ${err.source}\n`;
          });
          errorsContent += `\n`;
        }

        if ((settings.exportSourcePlusMeta || settings.exportSourcePlusMetaWithImages) && errorsByType.missing_key_topics) {
          errorsContent += '### MISSING KEY TOPICS\n\n';
          errorsContent += 'The following sources were exported but their key topics were not found:\n\n';
          errorsByType.missing_key_topics.forEach((err, idx) => {
            errorsContent += `${idx + 1}. ${err.source}\n`;
          });
          errorsContent += `\n`;
        }

        if (errorsByType.image_download_failed || errorsByType.image_embedding_error) {
          errorsContent += '### IMAGE DOWNLOAD FAILURES\n\n';
          errorsContent += 'The following images could not be embedded as base64:\n\n';
          const imageErrors = [
            ...(errorsByType.image_download_failed || []),
            ...(errorsByType.image_embedding_error || [])
          ];
          imageErrors.forEach((err, idx) => {
            errorsContent += `**${idx + 1}. ${err.source}**\n`;
            errorsContent += `- Error: ${err.message}\n`;
            if (err.url) {
              errorsContent += `- URL: ${err.url}\n`;
            }
            errorsContent += `\n`;
          });
          errorsContent += `Note: Images remain as external links in the markdown.\n\n`;
        }

        errorsContent += '---\n\n';
        errorsContent += '## Recommendations\n\n';
        if (stats.failedExtractions > 0) {
          errorsContent += '- Some sources failed to extract completely. Try exporting them individually.\n';
        }
        if ((settings.exportSourcePlusMeta || settings.exportSourcePlusMetaWithImages) && stats.missingSummaries > 0) {
          errorsContent += '- Some sources are missing summaries. This may happen if NotebookLM hasn\'t generated the source guide yet.\n';
        }
        if ((settings.exportSourcePlusMeta || settings.exportSourcePlusMetaWithImages) && stats.missingKeyTopics > 0) {
          errorsContent += '- Some sources are missing key topics. This is usually included in the source guide.\n';
        }
        if (errorsByType.image_download_failed || errorsByType.image_embedding_error) {
          errorsContent += '- Some images could not be embedded as base64. They remain as external links but may require authentication to view.\n';
        }
        errorsContent += '\n- If issues persist, please report them at:\n';
        errorsContent += '  https://github.com/anthropics/claude-code/issues\n';

        zip.file('errors.txt', errorsContent);
        indexFiles.push({ path: 'errors.txt', title: 'Export Error Report' });
      }

      // Add README to index
      indexFiles.push({ path: 'README.txt', title: 'README - File Naming Convention' });

      // Create youtube-urls.txt if any YouTube sources were found in THIS batch
      const youtubeUrls = exportedSources
        .filter(source => source.youtubeUrl)
        .map(source => ({ title: source.title, url: source.youtubeUrl }));

      if (youtubeUrls.length > 0) {
        let youtubeContent = '# YouTube Source URLs\n\n';
        youtubeContent += `Generated: ${new Date().toLocaleString()}\n\n`;
        youtubeContent += `Total YouTube Sources: ${youtubeUrls.length}\n\n`;
        youtubeContent += '---\n\n';

        youtubeUrls.forEach((item, idx) => {
          youtubeContent += `${idx + 1}. ${item.title}\n`;
          youtubeContent += `   ${item.url}\n\n`;
        });

        sourcesFolder.file('youtube-urls.txt', youtubeContent);
        indexFiles.push({ path: 'sources/youtube-urls.txt', title: 'YouTube Source URLs (formatted)' });
        console.log(`[NotebookLM Takeout] Created sources/youtube-urls.txt with ${youtubeUrls.length} URL(s)`);

        // Create raw URL list (just URLs, one per line)
        const rawUrlsContent = youtubeUrls.map(item => item.url).join('\n') + '\n';
        sourcesFolder.file('youtube-urls.raw.txt', rawUrlsContent);
        indexFiles.push({ path: 'sources/youtube-urls.raw.txt', title: 'YouTube Source URLs (raw list)' });
        console.log(`[NotebookLM Takeout] Created sources/youtube-urls.raw.txt with ${youtubeUrls.length} URL(s)`);
      }

      // Generate _index.md with links to all files (in sources/ folder) for THIS batch
      let indexContent = '# NotebookLM Sources Export\n\n';
      indexContent += `Generated: ${new Date().toLocaleString()}\n\n`;

      if (totalZips > 1) {
        indexContent += `**Part ${zipIndex + 1} of ${totalZips}**\n\n`;
        indexContent += `Total Sources (all parts): ${selectedSources.length}\n`;
        indexContent += `Sources in this part: ${exportedSources.length}\n\n`;
      } else {
        indexContent += `Total Sources: ${exportedSources.length}\n\n`;
      }

      // Reuse hasMetadata, hasImages, versionCount from README section above
      indexContent += `Each source is available in ${versionCount} version(s).\n\n`;
      indexContent += '---\n\n';

      // Add YouTube URLs section first if files exist
      if (youtubeUrls.length > 0) {
        indexContent += '## YouTube Sources\n\n';
        indexContent += `This export includes ${youtubeUrls.length} YouTube video source(s).\n\n`;
        indexContent += `- [YouTube URLs (formatted)](youtube-urls.txt) - Numbered list with titles\n`;
        indexContent += `- [YouTube URLs (raw)](youtube-urls.raw.txt) - Plain URLs only (for scripting)\n\n`;
        indexContent += '---\n\n';
      }

      indexContent += '## Sources\n\n';

      // Group sources by title for display (only for THIS batch)
      exportedSources.forEach((source, idx) => {
        if (idx > 0) indexContent += '---\n\n';

        indexContent += `### ${source.title}\n\n`;

        // Add YouTube URL if present
        if (source.youtubeUrl) {
          indexContent += `**YouTube Video:** ${source.youtubeUrl}\n\n`;
        }

        // Add summary if present
        if (source.summary && source.summary.trim().length > 0) {
          indexContent += `**Summary:**\n\n${source.summary}\n\n`;
        }

        // Add key topics if present
        if (source.keyTopics && source.keyTopics.length > 0) {
          indexContent += `**Key Topics:**\n\n`;
          source.keyTopics.forEach(topic => {
            indexContent += `- ${topic}\n`;
          });
          indexContent += '\n';
        }

        // Find all versions of this source
        const versions = indexFiles.filter(f => f.title === source.title && f.path.startsWith('sources/'));

        if (versions.length > 0) {
          indexContent += `**Files:**\n\n`;

          // Always show base version first
          const baseVersion = versions.find(v => v.variant === 'base');
          if (baseVersion) {
            const filename = baseVersion.path.replace('sources/', '');
            indexContent += `- [${filename}](${encodeURI(filename)}) - Base version (no metadata, no images)\n`;
          }

          // Show plus-meta if it exists
          const plusMetaVersion = versions.find(v => v.variant === 'plusMeta');
          if (plusMetaVersion) {
            const filename = plusMetaVersion.path.replace('sources/', '');
            indexContent += `- [${filename}](${encodeURI(filename)}) - With metadata, no images\n`;
          }

          // Show with-images if it exists
          const withImagesVersion = versions.find(v => v.variant === 'withImages');
          if (withImagesVersion) {
            const filename = withImagesVersion.path.replace('sources/', '');
            indexContent += `- [${filename}](${encodeURI(filename)}) - No metadata, with images\n`;
          }

          // Show plus-meta-with-images if it exists
          const plusMetaWithImagesVersion = versions.find(v => v.variant === 'plusMetaWithImages');
          if (plusMetaWithImagesVersion) {
            const filename = plusMetaWithImagesVersion.path.replace('sources/', '');
            indexContent += `- [${filename}](${encodeURI(filename)}) - With metadata and images\n`;
          }

          indexContent += '\n';
        }
      });

      // Move _index.md to sources/ folder
      sourcesFolder.file('_index.md', indexContent);

      // Generate ZIP
      console.log(`[NotebookLM Takeout] Generating ZIP ${zipIndex + 1}/${totalZips}...`);
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      try {
        const sanitizedProjectName = sanitizeFilename(projectName);
        let filename;
        if (totalZips > 1) {
          filename = `${sanitizedProjectName}-sources-${timestamp}-part${zipIndex + 1}of${totalZips}.zip`;
        } else {
          filename = `${sanitizedProjectName}-sources-${timestamp}.zip`;
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        console.log(`[NotebookLM Takeout] Downloaded ZIP ${zipIndex + 1}/${totalZips}: ${filename}`);

        // Show toast for each ZIP (or final toast at the end)
        if (zipIndex === totalZips - 1) {
          // Last ZIP
          if (allErrors.length > 0) {
            const errorCount = allErrors.length;
            const failedSources = allErrors.filter(e => e.includes('Extraction failed')).length;
            const missingMetadata = allErrors.filter(e => e.includes('Missing')).length;

            let errorSummary = `Exported ${selectedSources.length} source(s) in ${totalZips} ZIP(s) with ${errorCount} warning(s)`;
            if (failedSources > 0) {
              errorSummary += ` (${failedSources} failed to extract)`;
            }
            showToast(errorSummary + '. See errors.txt in last ZIP for details.', 'warning');
          } else {
            showToast(`Successfully exported ${selectedSources.length} source(s) in ${totalZips} ZIP(s)`, 'success');
          }
        }
      } finally {
        URL.revokeObjectURL(url);
      }

      // CRITICAL: Clear memory after each ZIP to prevent crashes
      // Wait a moment for download to initiate, then clear references
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clear the batch data to free memory
      exportedSources.forEach(source => {
        // Nullify the large version strings
        source.versions.base = null;
        source.versions.plusMeta = null;
        source.versions.withImages = null;
        source.versions.plusMetaWithImages = null;
      });

      console.log(`[NotebookLM Takeout] Cleared memory for batch ${zipIndex + 1}/${totalZips}`);

      // Clear the array itself
      exportedSources.length = 0;

      // Give GC time to work between batches
      if (zipIndex < totalZips - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } // End of "if exportedSources.length > 0"
    } // End of batch loop

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

// ========== CHAT EXPORT FUNCTIONS ==========

/**
 * Scan chat panel and initiate auto-scroll
 */
async function scanChatPage() {
  console.log('[NotebookLM Takeout] Scanning chat page...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url?.includes('notebooklm.google.com')) {
    showToast('Please open NotebookLM first', 'error');
    return;
  }

  // Update UI to show scanning state
  const chatResults = document.getElementById('chat-scan-results');
  const chatCount = document.getElementById('chat-count');
  chatResults.innerHTML = '<p class="scanning">Scanning chat and loading messages...</p>';
  chatCount.textContent = '0';

  // Ensure content script is loaded
  await ensureContentScriptLoaded(tab.id);

  try {
    // Show overlay on page
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_EXPORT_OVERLAY',
      message: 'Scanning chat history...'
    });

    // Trigger auto-scroll and scan
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_CHAT' });

    // Hide overlay
    await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });

    if (response.error) {
      showToast(`Scan failed: ${response.error}`, 'error');
      chatResults.innerHTML = `<p class="error-message">${escapeHtml(response.error)}</p>`;
      return;
    }

    const chatData = response.chatData;
    console.log(`[NotebookLM Takeout] Found ${chatData.messagePairs.length} message pairs`);

    // Store chat data globally
    window._currentChatData = chatData;

    renderChatSummary(chatData);

  } catch (error) {
    console.error('[NotebookLM Takeout] Scan error:', error);
    showToast('Failed to scan chat', 'error');
    chatResults.innerHTML = '<p class="error-message">Scan failed. Please try again.</p>';

    // Hide overlay on error
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
    } catch (e) {}
  }
}

/**
 * Render chat scan results summary
 */
function renderChatSummary(chatData) {
  const chatResults = document.getElementById('chat-scan-results');
  const chatCount = document.getElementById('chat-count');
  const exportBtn = document.getElementById('export-chat-btn');

  if (chatData.messagePairs.length === 0) {
    chatResults.innerHTML = '<p class="empty-message">No chat messages found. Start a conversation with NotebookLM.</p>';
    chatCount.textContent = '0';
    exportBtn.style.display = 'none';
    return;
  }

  chatCount.textContent = chatData.messagePairs.length;

  // Build summary HTML
  let html = '<div class="chat-summary">';
  html += `<div class="summary-stat"><strong>${chatData.messagePairs.length}</strong> message pairs</div>`;
  html += `<div class="summary-stat"><strong>${chatData.notebookTitle}</strong></div>`;

  if (chatData.dateRange) {
    html += `<div class="summary-stat">From <strong>${chatData.dateRange.first}</strong> to <strong>${chatData.dateRange.last}</strong></div>`;
  }

  html += '</div>';

  // Show preview of first few messages
  html += '<div class="chat-preview">';
  html += '<h4>Preview:</h4>';

  const previewCount = Math.min(3, chatData.messagePairs.length);
  for (let i = 0; i < previewCount; i++) {
    const pair = chatData.messagePairs[i];
    html += `<div class="message-preview">`;
    html += `<strong>Q:</strong> ${escapeHtml(pair.userMessage.substring(0, 80))}${pair.userMessage.length > 80 ? '...' : ''}`;
    html += `</div>`;
  }

  if (chatData.messagePairs.length > previewCount) {
    html += `<p class="preview-more">...and ${chatData.messagePairs.length - previewCount} more</p>`;
  }

  html += '</div>';

  chatResults.innerHTML = html;
  exportBtn.style.display = 'block';

  // Setup export button handler
  const newExportBtn = exportBtn.cloneNode(true);
  exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);

  newExportBtn.addEventListener('click', async () => {
    const extractFullCitations = document.getElementById('extract-full-citations-checkbox')?.checked || false;
    await exportChat(chatData, extractFullCitations);
  });
}

/**
 * Export chat as markdown file
 */
async function exportChat(chatData, extractFullCitations = false) {
  console.log('[NotebookLM Takeout] Starting chat export...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Show overlay on the page
  await chrome.tabs.sendMessage(tab.id, {
    type: 'SHOW_EXPORT_OVERLAY',
    message: 'Preparing to export chat...'
  });

  // Show progress panel in sidebar
  const progressPanel = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  progressPanel.style.display = 'block';
  progressText.textContent = 'Exporting chat...';
  progressFill.style.width = '0%';

  let cancelled = false;

  // Listen for cancellation
  const cancelListener = (message) => {
    if (message.type === 'CANCEL_EXPORT') {
      cancelled = true;
    }
  };
  chrome.runtime.onMessage.addListener(cancelListener);

  try {
    const messagePairs = chatData.messagePairs;
    const processedMessages = [];
    const allErrors = [];

    // Track statistics for detailed error reporting
    const stats = {
      totalMessages: messagePairs.length,
      messagesWithCitations: 0,
      totalCitationsFound: 0,
      totalCitationsExtracted: 0,
      successfulExtractions: 0,
      failedExtractions: 0,
      extractFullCitations: extractFullCitations
    };

    // Process each message and extract per-message citations
    console.log('[NotebookLM Takeout] Processing messages and extracting citations...');

    for (let i = 0; i < messagePairs.length; i++) {
      if (cancelled) {
        console.log('[NotebookLM Takeout] Export cancelled by user');
        showToast('Export cancelled', 'warning');
        break;
      }

      const pair = messagePairs[i];
      const progress = ((i + 1) / messagePairs.length) * 100;

      // Update progress
      progressFill.style.width = `${progress}%`;
      progressText.textContent = `Processing message ${i + 1}/${messagePairs.length}`;

      await chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_EXPORT_OVERLAY',
        message: `Processing message ${i + 1}/${messagePairs.length}`,
        progress: progress
      });

      console.log(`[NotebookLM Takeout] Message ${i + 1}: Processing...`);

      try {
        // Extract citation buttons from HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = pair.aiResponseHTML;
        const citationButtons = tempDiv.querySelectorAll('button.citation-marker');

        console.log(`[NotebookLM Takeout] Message ${i + 1}: Found ${citationButtons.length} citation buttons`);

        // Build sources map for this message
        const messageSources = new Map(); // sourceIndex -> {text, quote}

        if (citationButtons.length > 0) {
          stats.messagesWithCitations++;
          stats.totalCitationsFound += citationButtons.length;
          citationButtons.forEach((button) => {
            const span = button.querySelector('span');
            const sourceIndex = span?.textContent?.trim();
            const ariaLabel = span?.getAttribute('aria-label');

            // Skip invalid source indices
            if (!sourceIndex ||
                sourceIndex === '...' ||
                messageSources.has(sourceIndex) ||
                sourceIndex.includes('<') ||
                sourceIndex.includes('>') ||
                !/^[0-9]+$/.test(sourceIndex)) {
              if (sourceIndex && sourceIndex !== '...') {
                console.warn(`[NotebookLM Takeout] Message ${i + 1}: Skipping invalid sourceIndex "${sourceIndex}"`);
              }
              return;
            }

            // Parse aria-label to extract source title
            let sourceTitle = `Source ${sourceIndex}`;
            if (ariaLabel && ariaLabel.includes(':')) {
              const parts = ariaLabel.split(':');
              if (parts.length >= 2) {
                sourceTitle = parts.slice(1).join(':').trim();
              }
            }

            messageSources.set(sourceIndex, {
              text: sourceTitle,
              quote: ''
            });

            console.log(`[NotebookLM Takeout] Message ${i + 1}, source ${sourceIndex}: "${sourceTitle}"`);
          });
        }

        // Extract full citation details if enabled
        if (extractFullCitations && messageSources.size > 0) {
          console.log(`[NotebookLM Takeout] Message ${i + 1}: Extracting full citation details for ${messageSources.size} sources...`);

          // Update progress to show we're extracting quotes
          const extractProgress = ((i + 1) / messagePairs.length) * 100;
          progressFill.style.width = `${extractProgress}%`;
          progressText.textContent = `Message ${i + 1}/${messagePairs.length}: Extracting ${messageSources.size} quotes...`;

          await chrome.tabs.sendMessage(tab.id, {
            type: 'UPDATE_EXPORT_OVERLAY',
            message: `Message ${i + 1}/${messagePairs.length}: Extracting ${messageSources.size} quotes (this may take a minute)...`,
            progress: extractProgress
          });

          try {
            // Get source indices to extract
            const sourceIndices = Array.from(messageSources.keys());
            console.log(`[NotebookLM Takeout] Message ${i + 1}: Extracting sourceIndices:`, sourceIndices);

            // Call content script to extract citations by temporarily inserting HTML
            const fullCitationData = await chrome.tabs.sendMessage(tab.id, {
              type: 'EXTRACT_MESSAGE_CITATIONS',
              data: {
                messageIndex: i,
                messageHTML: pair.aiResponseHTML,
                sourceIndices: sourceIndices,
                includeCitationImages: settings.includeCitationImages
              }
            });

            console.log(`[NotebookLM Takeout] Message ${i + 1}: Received citation data:`, fullCitationData);

            // Merge quotes into messageSources
            if (fullCitationData && fullCitationData.sourcesByIndex) {
              messageSources.forEach((source, sourceIndex) => {
                const fullData = fullCitationData.sourcesByIndex[sourceIndex];
                if (fullData) {
                  source.text = fullData.text || source.text;
                  source.quote = fullData.quote || '';
                  stats.successfulExtractions++;
                  console.log(`[NotebookLM Takeout] Message ${i + 1}, source ${sourceIndex}: Updated with quote (${source.quote.length} chars)`);
                } else {
                  stats.failedExtractions++;
                }
              });
            }

            // Track any errors
            if (fullCitationData && fullCitationData.errors && fullCitationData.errors.length > 0) {
              stats.failedExtractions += fullCitationData.errors.length;
              fullCitationData.errors.forEach(err => {
                allErrors.push({
                  message: err,
                  messageIndex: i + 1,
                  userQuestion: pair.userMessage.substring(0, 100),
                  type: 'citation_extraction'
                });
              });
            }
          } catch (error) {
            console.error(`[NotebookLM Takeout] Message ${i + 1}: Error extracting full citations:`, error);
            stats.failedExtractions += messageSources.size;
            allErrors.push({
              message: `Failed to extract full citations: ${error.message}`,
              messageIndex: i + 1,
              userQuestion: pair.userMessage.substring(0, 100),
              type: 'extraction_error',
              stack: error.stack
            });
          }
        }

        // Convert sources map to array, sorted by sourceIndex
        const sourcesArray = Array.from(messageSources.entries())
          .sort((a, b) => {
            const aNum = parseInt(a[0]) || 0;
            const bNum = parseInt(b[0]) || 0;
            return aNum - bNum;
          })
          .map(([sourceIndex, source]) => ({
            sourceIndex: sourceIndex,
            text: source.text,
            quote: source.quote
          }));

        stats.totalCitationsExtracted += sourcesArray.length;

        // Store processed message WITH its sources
        processedMessages.push({
          date: pair.date,
          userMessage: pair.userMessage,
          aiResponseHTML: pair.aiResponseHTML,
          sources: sourcesArray // Include sources for this message
        });

      } catch (error) {
        console.error(`[NotebookLM Takeout] Error processing message ${i + 1}:`, error);
        allErrors.push({
          message: error.message,
          messageIndex: i + 1,
          userQuestion: pair.userMessage.substring(0, 100),
          type: 'message_processing_error',
          stack: error.stack
        });

        // Include message without citations
        processedMessages.push({
          date: pair.date,
          userMessage: pair.userMessage,
          aiResponseHTML: pair.aiResponseHTML,
          sources: []
        });
      }

      // Rate limiting between messages
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[NotebookLM Takeout] Processing complete: ${processedMessages.length} messages`);

    // Generate all permutations based on settings (cumulative approach)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const baseFilename = `${sanitizeFilename(chatData.notebookTitle)}-chat-${timestamp}`;

    const versions = [];

    // Base version (Scenario 1): Always included - markdown rendering, no images
    const baseMarkdown = convertChatToMarkdown(
      chatData.notebookTitle,
      chatData.notebookSummary,
      processedMessages,
      false // citationsCodeBlock = false
    );
    const baseMarkdownNoImages = stripImagesFromMarkdown(baseMarkdown);

    versions.push({
      filename: `${baseFilename}.md`,
      content: baseMarkdownNoImages,
      title: 'Base (markdown, no images)',
      description: 'Citations rendered as markdown, images stripped'
    });

    // Scenario 2 addition: Code blocks, no images (if citationsCodeBlock is ON)
    if (settings.citationsCodeBlock) {
      const codeBlocksMarkdown = convertChatToMarkdown(
        chatData.notebookTitle,
        chatData.notebookSummary,
        processedMessages,
        true // citationsCodeBlock = true
      );
      const codeBlocksMarkdownNoImages = stripImagesFromMarkdown(codeBlocksMarkdown);

      versions.push({
        filename: `${baseFilename}-code-blocks.md`,
        content: codeBlocksMarkdownNoImages,
        title: 'Code blocks (no images)',
        description: 'Citations in code blocks, images stripped'
      });
    }

    // Scenario 3 addition: Markdown rendering, with images (if includeCitationImages is ON)
    if (settings.includeCitationImages) {
      // This version already has images from the conversion
      versions.push({
        filename: `${baseFilename}-with-images.md`,
        content: baseMarkdown, // Keep images
        title: 'With images (markdown)',
        description: 'Citations rendered as markdown, with base64 images'
      });
    }

    // Scenario 4 addition: Code blocks, with images (if BOTH settings are ON)
    if (settings.citationsCodeBlock && settings.includeCitationImages) {
      const codeBlocksMarkdownWithImages = convertChatToMarkdown(
        chatData.notebookTitle,
        chatData.notebookSummary,
        processedMessages,
        true // citationsCodeBlock = true
      );

      versions.push({
        filename: `${baseFilename}-code-blocks-with-images.md`,
        content: codeBlocksMarkdownWithImages, // Keep images
        title: 'Code blocks with images',
        description: 'Citations in code blocks, with base64 images'
      });
    }

    console.log(`[NotebookLM Takeout] Created ${versions.length} chat version(s)`);

    // Determine if we need ZIP (for multiple files OR errors)
    const shouldZip = versions.length > 1 || allErrors.length > 0;

    if (shouldZip) {
      // Create ZIP with all versions + errors.txt
      const zip = new JSZip();
      const indexFiles = [];

      // Add all versions to ZIP
      versions.forEach(version => {
        zip.file(version.filename, version.content);
        indexFiles.push({
          path: version.filename,
          title: version.title,
          description: version.description
        });
      });

      // Add detailed errors file
      let errorsContent = '# Chat Export Error Report\n\n';
      errorsContent += `Chat: ${chatData.notebookTitle}\n`;
      errorsContent += `Generated: ${new Date().toLocaleString()}\n\n`;
      errorsContent += '---\n\n';

      // Summary Statistics
      errorsContent += '## Summary Statistics\n\n';
      errorsContent += `- **Total Messages:** ${stats.totalMessages}\n`;
      errorsContent += `- **Messages with Citations:** ${stats.messagesWithCitations}\n`;
      errorsContent += `- **Total Citations Found:** ${stats.totalCitationsFound}\n`;
      errorsContent += `- **Unique Citations Extracted:** ${stats.totalCitationsExtracted}\n`;
      if (stats.extractFullCitations) {
        errorsContent += `- **Successful Extractions:** ${stats.successfulExtractions}\n`;
        errorsContent += `- **Failed Extractions:** ${stats.failedExtractions}\n`;
        const successRate = stats.totalCitationsExtracted > 0
          ? ((stats.successfulExtractions / stats.totalCitationsExtracted) * 100).toFixed(1)
          : '0';
        errorsContent += `- **Success Rate:** ${successRate}%\n`;
      }
      errorsContent += `- **Total Errors:** ${allErrors.length}\n\n`;

      errorsContent += '---\n\n';

      // Error Details
      errorsContent += '## Error Details\n\n';

      // Group errors by type
      const errorsByType = {};
      allErrors.forEach(err => {
        const type = err.type || 'unknown';
        if (!errorsByType[type]) {
          errorsByType[type] = [];
        }
        errorsByType[type].push(err);
      });

      Object.keys(errorsByType).forEach(type => {
        const errors = errorsByType[type];
        errorsContent += `### ${type.replace(/_/g, ' ').toUpperCase()} (${errors.length})\n\n`;

        errors.forEach((err, idx) => {
          errorsContent += `**${idx + 1}. Message ${err.messageIndex}**\n`;
          errorsContent += `- Question: "${err.userQuestion}${err.userQuestion.length >= 100 ? '...' : ''}"\n`;
          errorsContent += `- Error: ${err.message}\n`;
          if (err.stack) {
            errorsContent += `- Stack: ${err.stack.split('\n')[0]}\n`;
          }
          errorsContent += `\n`;
        });

        errorsContent += '\n';
      });

      // Recommendations
      errorsContent += '---\n\n';
      errorsContent += '## Recommendations\n\n';
      if (stats.failedExtractions > 0) {
        errorsContent += '- Some citations failed to extract. This is often due to:\n';
        errorsContent += '  - Tooltips not appearing (try exporting again)\n';
        errorsContent += '  - Citations being too close together (timing issue)\n';
        errorsContent += '  - Network connectivity issues\n\n';
      }
      if (allErrors.some(e => e.type === 'message_processing_error')) {
        errorsContent += '- Message processing errors occurred. Check the browser console for details.\n\n';
      }
      errorsContent += '- If you continue to experience issues, please report them at:\n';
      errorsContent += '  https://github.com/anthropics/claude-code/issues\n\n';

      zip.file('errors.txt', errorsContent);
      indexFiles.push({ path: 'errors.txt', title: 'Export Error Report' });

      // Generate _index.md with links to all files
      let indexContent = '# NotebookLM Chat Export - File Index\n\n';
      indexContent += `Chat: ${chatData.notebookTitle}\n`;
      indexContent += `Generated: ${new Date().toLocaleString()}\n\n`;
      indexContent += `Total Messages: ${stats.totalMessages}\n`;
      indexContent += `Messages with Citations: ${stats.messagesWithCitations}\n`;
      indexContent += `Total Files: ${indexFiles.length}\n\n`;
      indexContent += '---\n\n';

      indexContent += '## Chat Export Versions\n\n';
      indexContent += `This export includes ${versions.length} version(s) of the chat:\n\n`;

      // List all chat versions
      indexFiles.forEach(file => {
        if (file.path !== 'errors.txt' && file.path !== '_index.md') {
          indexContent += `- **[${file.title}](${encodeURI(file.path)})**\n`;
          if (file.description) {
            indexContent += `  - ${file.description}\n`;
          }
        }
      });

      indexContent += '\n';

      if (allErrors.length > 0) {
        indexContent += '---\n\n';
        indexContent += '## Error Report\n\n';
        const errorFile = indexFiles.find(f => f.path === 'errors.txt');
        if (errorFile) {
          indexContent += `- [${errorFile.title}](${encodeURI(errorFile.path)}) - ${allErrors.length} error(s) encountered during export\n\n`;
        }
      }

      zip.file('_index.md', indexContent);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      try {
        const zipFilename = `${sanitizeFilename(chatData.notebookTitle)}-chat-${timestamp}.zip`;

        const a = document.createElement('a');
        a.href = url;
        a.download = zipFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        let errorMsg;
        if (versions.length > 1) {
          errorMsg = `Exported ${versions.length} versions. ${allErrors.length > 0 ? `${allErrors.length} errors (see errors.txt)` : ''}`;
        } else if (stats.extractFullCitations) {
          errorMsg = `Exported chat: ${stats.successfulExtractions}/${stats.totalCitationsFound} citations extracted successfully. ${allErrors.length > 0 ? `${allErrors.length} errors (see errors.txt)` : ''}`;
        } else {
          errorMsg = `Exported chat${allErrors.length > 0 ? ` with ${allErrors.length} errors (see errors.txt)` : ''}`;
        }
        showToast(errorMsg, allErrors.length > 0 ? 'warning' : 'success');
      } finally {
        URL.revokeObjectURL(url);
      }

    } else {
      // Single markdown file (only base version, no errors)
      const blob = new Blob([versions[0].content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = versions[0].filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showToast('Successfully exported chat', 'success');
      } finally {
        URL.revokeObjectURL(url);
      }
    }

  } catch (error) {
    console.error('[NotebookLM Takeout] Export failed:', error);
    showToast(`Export failed: ${error.message}`, 'error');

  } finally {
    // Remove cancellation listener
    chrome.runtime.onMessage.removeListener(cancelListener);

    // Hide page overlay
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
    } catch (error) {
      console.error('[NotebookLM Takeout] Failed to hide overlay:', error);
    }

    // Hide sidebar progress panel
    progressPanel.style.display = 'none';
  }
}

/**
 * Convert chat data to markdown format
 */
function convertChatToMarkdown(notebookTitle, notebookSummary, messages, citationsCodeBlock = true) {
  logger.info('Markdown', `Converting chat to markdown: "${notebookTitle}"`);
  logger.info('Markdown', `  - Message count: ${messages.length}`);

  // Initialize markdown with title
  let markdown = `# ${notebookTitle}\n\n`;

  // Add notebook summary if available
  if (notebookSummary && notebookSummary.trim().length > 0) {
    markdown += `**Notebook Summary**\n\n`;
    markdown += `${notebookSummary}\n\n`;
    markdown += '---\n\n';
  }

  markdown += `**Chat Export**\n\n`;
  markdown += `Exported: ${new Date().toLocaleString()}\n\n`;
  markdown += `Total Messages: ${messages.length}\n\n`;
  markdown += '---\n\n';

  // Initialize TurndownService with standardized configuration
  const turndownService = createTurndownService();

  // Use closure to track current message index
  let currentMessageIndex = 0;

  // Add custom rules with message index tracking
  console.log('[NotebookLM Takeout] Adding turndown rules for per-message citations');
  addChatTurndownRules(turndownService, citationsCodeBlock, () => currentMessageIndex);

  let currentDate = null;

  // Process each message pair
  messages.forEach((msg, idx) => {
    // Update current message index for turndown rules
    currentMessageIndex = idx;

    // Add date separator if date changed
    if (msg.date && msg.date !== currentDate) {
      markdown += `## ${msg.date}\n\n`;
      currentDate = msg.date;
    }

    // Add user question as H2 heading
    markdown += `## Q: ${msg.userMessage}\n\n`;

    // Convert AI response HTML to markdown
    let aiResponseMarkdown = turndownService.turndown(msg.aiResponseHTML);

    // Clean up: Merge consecutive footnote references into a single <sup> tag
    // Pattern: <sup>...[1]...</sup>,<sup>...[2]...</sup> → <sup>...[1]... ...[2]...</sup>
    // This removes both commas and the >< between footnotes
    aiResponseMarkdown = aiResponseMarkdown.replace(/<\/sup>\s*,?\s*<sup>/g, ' ');

    // Clean up escaped brackets that appear between sup tags
    // Pattern: </sup>\> <<sup> (literal backslash-greater-than space less-than)
    aiResponseMarkdown = aiResponseMarkdown.replace(/<\/sup>\\>\s*<<sup>/g, ' ');

    // Also clean up unescaped >< between sup tags
    // Pattern: </sup>><sup> or </sup>> <<sup>
    aiResponseMarkdown = aiResponseMarkdown.replace(/<\/sup>>\s*<<sup>/g, ' ');

    // Final cleanup: remove any remaining standalone \> < patterns in text
    aiResponseMarkdown = aiResponseMarkdown.replace(/\\>\s*</g, '');

    console.log(`[Chat Export] Message ${idx + 1} markdown length:`, aiResponseMarkdown.length);
    markdown += `**A:** ${aiResponseMarkdown}\n\n`;

    // Add sources for this message
    if (msg.sources && msg.sources.length > 0) {
      markdown += '**Sources:**\n\n';
      msg.sources.forEach(source => {
        // Add anchor for source with message-specific ID
        markdown += `<a id="msg-${idx}-src-${source.sourceIndex}"></a>\n`;
        markdown += `**[[${source.sourceIndex}]](#msg-${idx}-cite-ref-${source.sourceIndex}-1)** ${source.text}\n`;

        // Add quote if available
        if (source.quote && source.quote.trim().length > 0) {
          if (citationsCodeBlock) {
            // Wrap in markdown code block for data separation (same as note export)
            markdown += `\`\`\`markdown\n${source.quote}\n\`\`\`\n\n`;
          } else {
            // Add blank line separator before quote content
            markdown += `\n${source.quote}\n\n`;
          }
        }
        markdown += '\n';
      });
    }

    // Add separator between message pairs (except last)
    if (idx < messages.length - 1) {
      markdown += '---\n\n';
    }
  });

  // Clean up excessive newlines
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  console.log('[Chat Export] Final markdown length:', markdown.length);

  return markdown;
}

/**
 * Add TurndownService rules for chat conversion
 */
function addChatTurndownRules(turndownService, citationsCodeBlock, getCurrentMessageIndex) {
  // Track citation occurrences within each message
  const citationOccurrences = new Map(); // "messageIdx:sourceIdx" -> count

  // Rule: Strip Angular component wrappers
  turndownService.addRule('stripAngularComponents', {
    filter: (node) => {
      const nodeName = node.nodeName.toLowerCase();
      return nodeName === 'labs-tailwind-structural-element-view-v2';
    },
    replacement: (content) => content
  });

  // Rule: Handle lists with Angular wrapper components
  turndownService.addRule('listsWithWrappers', {
    filter: (node) => {
      return node.nodeName === 'OL' || node.nodeName === 'UL';
    },
    replacement: (content, node, options) => {
      const isOrdered = node.nodeName === 'OL';

      // Find all <li> elements at any depth
      const allLis = Array.from(node.querySelectorAll('li'));

      // Filter to only include <li> elements that belong directly to this list
      const items = allLis.filter(li => {
        let parent = li.parentElement;
        while (parent && parent !== node) {
          const tagName = parent.tagName;
          if (tagName === 'OL' || tagName === 'UL') {
            return false; // This li belongs to a nested list
          }
          parent = parent.parentElement;
        }
        return true;
      });

      if (items.length === 0) {
        return '\n' + content + '\n';
      }

      // Generate markdown for each list item
      let markdown = '\n';
      items.forEach((li, idx) => {
        const marker = isOrdered ? `${idx + 1}.` : options.bulletListMarker;
        const itemContent = turndownService.turndown(li.innerHTML).trim();
        markdown += `${marker} ${itemContent}\n`;
      });
      markdown += '\n';

      return markdown;
    }
  });

  // Rule: Convert div headings with role="heading"
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

  // Rule: Convert blockquotes (callout boxes)
  turndownService.addRule('blockquotes', {
    filter: (node) => {
      return node.nodeName === 'DIV' &&
             node.classList.contains('blockquote');
    },
    replacement: (content, node) => {
      // Get the text content and convert to blockquote format
      const text = content.trim();
      if (!text) return '';

      // Split by lines and add > prefix to each line
      const lines = text.split('\n').map(line => {
        const trimmed = line.trim();
        return trimmed ? `> ${trimmed}` : '>';
      });

      return `\n${lines.join('\n')}\n\n`;
    }
  });

  // Rule: Convert tables to markdown table format
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

      // Try to capture footnotes that follow the table
      // Look for sibling elements after the table that contain footnote references
      let currentElement = node.parentElement;
      while (currentElement && currentElement.nodeName.toLowerCase() !== 'element-list-renderer') {
        currentElement = currentElement.parentElement;
      }

      if (currentElement) {
        // Find all structural elements that might contain footnotes
        const structuralElements = currentElement.querySelectorAll('labs-tailwind-structural-element-view-v2');
        const footnotes = [];

        // Look for elements with footnote pattern [number] at start
        structuralElements.forEach(el => {
          const text = el.textContent.trim();
          // Match footnotes like "[1] Some text" or "[86] Some text"
          if (/^\[\d+\]/.test(text)) {
            footnotes.push(text);
          }
        });

        // Add footnotes if found
        if (footnotes.length > 0) {
          markdown += '\n**References:**\n\n';
          footnotes.forEach(footnote => {
            markdown += footnote + '\n\n';
          });
        }
      }

      return markdown;
    }
  });

  // Rule: Citation buttons - with message-specific anchors
  turndownService.addRule('citationButtons', {
    filter: (node) => {
      return node.nodeName === 'BUTTON' && node.classList.contains('citation-marker');
    },
    replacement: (content, node) => {
      const span = node.querySelector('span');
      const sourceIndex = span?.textContent?.trim();

      // Skip invalid source indices
      if (!sourceIndex ||
          sourceIndex === '...' ||
          sourceIndex.includes('<') ||
          sourceIndex.includes('>') ||
          !/^[0-9]+$/.test(sourceIndex)) {
        console.warn('[Chat Export] Skipping invalid citation with sourceIndex:', sourceIndex);
        return '';
      }

      // Get current message index
      const messageIndex = getCurrentMessageIndex();
      const key = `${messageIndex}:${sourceIndex}`;

      // Track occurrences for this source within this message
      if (!citationOccurrences.has(key)) {
        citationOccurrences.set(key, 0);
      }
      const occurrenceCount = citationOccurrences.get(key) + 1;
      citationOccurrences.set(key, occurrenceCount);

      // Return citation with message-specific anchor and link to source
      return `<sup><a id="msg-${messageIndex}-cite-ref-${sourceIndex}-${occurrenceCount}" href="#msg-${messageIndex}-src-${sourceIndex}">[${sourceIndex}]</a></sup>`;
    }
  });
}

// ========== END CHAT EXPORT FUNCTIONS ==========

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

    items.push({
      index: globalIndex,
      label: artifactTitle,
      type: type,
      details: artifactDetails,
      disabled: false
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
