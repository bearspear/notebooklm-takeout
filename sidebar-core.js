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

// Mindmap HTML template - loaded from external file for easy updates
let mindmapTemplate = null;

/**
 * Load the mindmap HTML template from external file
 * @returns {Promise<string>} - The template content
 */
async function loadMindmapTemplate() {
  if (mindmapTemplate) return mindmapTemplate;

  try {
    const templateUrl = chrome.runtime.getURL('mindmap-template.html');
    const response = await fetch(templateUrl);
    mindmapTemplate = await response.text();
    console.log('[NotebookLM Takeout] Mindmap template loaded successfully');
    return mindmapTemplate;
  } catch (error) {
    console.error('[NotebookLM Takeout] Failed to load mindmap template:', error);
    // Return a minimal fallback template
    return `<!DOCTYPE html>
<html><head><title>{{TITLE}}</title></head>
<body><h1>{{TITLE}}</h1><div>{{SVG_CONTENT}}</div></body></html>`;
  }
}

/**
 * Generate interactive HTML viewer for mindmap SVG
 * @param {string} svgContent - The SVG content to embed
 * @param {string} title - The mindmap title
 * @returns {Promise<string>} - Complete HTML document
 */
async function generateMindmapHTML(svgContent, title) {
  const template = await loadMindmapTemplate();
  return template
    .replace('{{TITLE}}', title)
    .replace('{{SVG_CONTENT}}', svgContent);
}

// Keep synchronous version for backwards compatibility (uses cached template)
function generateMindmapHTMLSync(svgContent, title) {
  if (!mindmapTemplate) {
    console.warn('[NotebookLM Takeout] Template not loaded, using fallback');
    return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><h1>${title}</h1><div>${svgContent}</div></body></html>`;
  }
  return mindmapTemplate
    .replace('{{TITLE}}', title)
    .replace('{{SVG_CONTENT}}', svgContent);
}

// Pre-load template on script init
loadMindmapTemplate();

/*
 * REMOVED INLINE TEMPLATE - Now loaded from mindmap-template.html
 * To update the template, edit mindmap-template.html directly.
 * Placeholders: {{TITLE}} and {{SVG_CONTENT}}
 */

/**
 * Show a warning dialog for DOM compatibility issues
 * @param {string[]} issues - List of issues to display
 * @param {boolean} isMidExport - Whether this is during an export (vs pre-export)
 * @returns {Promise<boolean>} - Whether user wants to continue
 */
function showDOMWarningDialog(issues, isMidExport = false) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'dom-warning-dialog';
    dialog.innerHTML = `
      <div class="dialog-overlay"></div>
      <div class="dialog-content">
        <h3>${isMidExport ? 'Export Issues Detected' : 'Potential Compatibility Issues'}</h3>
        <p style="font-size: 13px; color: #666; margin: 0 0 8px;">
          ${isMidExport
            ? 'Multiple errors occurred. NotebookLM may have been updated.'
            : 'Some expected elements were not found. The extension may need an update.'}
        </p>
        <ul>${issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        <div class="dialog-actions">
          <button class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="continue">
            ${isMidExport ? 'Continue' : 'Try Anyway'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'cancel' || e.target.classList.contains('dialog-overlay')) {
        dialog.remove();
        resolve(false);
      } else if (action === 'continue') {
        dialog.remove();
        resolve(true);
      }
    });
  });
}

/**
 * Hide the warning banner
 */
function hideWarningBanner() {
  const banner = document.getElementById('dom-warning-banner');
  if (banner) {
    banner.style.display = 'none';
  }
}

// createTurndownService and the KaTeX → LaTeX converter moved to
// takeout-markdown.js (Milestone 3d): NLMEMarkdown.createTurndownService,
// NLMEMarkdown.convertKatexNodeToLatex.

// Google renamed NotebookLM to "Gemini Notebook" and moved it from
// notebooklm.google.com to notebook.google.com (Jul 2026). The old host 301s to
// the new one; keep both so users mid-rollout still work.

function isNotebookUrl(url) {
  return NLME.isNotebookUrl(url);
}


let currentTabId = null;
let autoRefreshInterval = null;
let settingsLoaded = false;
let settings = {
  autoZip: false,
  takeoutZip: undefined, // Full Takeout's own ZIP choice; not set until the user ticks its checkbox
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
  // Batch sizes
  sourcesPerZip: 25, // Number of sources per ZIP file (prevents memory issues)
  notesPerZip: 25, // Number of notes per ZIP file (prevents memory issues)
  // Text cleanup
  cleanOCRArtifacts: true, // Clean OCR garbage (~~~, :~:, etc.) from citation quotes
  // Interface
  showStudioTab: false, // Show the Generated tab (internal id and key stay 'studio'; unified per-item list with delete)
  // Slide deck download format offered by the More menu ('pdf' | 'pptx')
  slidesFormat: 'pdf',
  // Note citations: 'quotes' hovers every marker; 'titles' takes source
  // titles from the markers only (no hovering); 'none' drops markers and Sources
  citationDetail: 'quotes',
  // Milestone 3c: reuse citation quotes read by an earlier export (quotes mode, no images)
  reuseCitations: true,
  // Milestone 3d (both opt-in): 'links' | 'footnotes' ([^n] markers and
  // definitions, for Obsidian, Typora, ...; link versions only), and
  // Obsidian-friendly file names (no [ ] # ^ | etc., "note - Title")
  citationStyle: 'links',
  obsidianNames: false
};

document.addEventListener('DOMContentLoaded', () => {
  init();
});

// Listen for messages from content script (e.g., image download requests)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === NLME.MSG.DOWNLOAD_IMAGE_AS_BASE64) {
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
  try {
    const [startTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    notebookSwitchedTo(startTab); // the first scan below covers this notebook
  } catch (_) { /* no active tab */ }
  refreshResumeBanner(); // an earlier unfinished export of this notebook
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
    'scan-chat-btn',
    'full-takeout-btn',
    'takeout-zip-checkbox'
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
    'scan-chat-btn',
    'full-takeout-btn',
    'takeout-zip-checkbox'
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
  document.getElementById('takeout-zip-checkbox').checked = NLME.takeoutZipChoice(settings);
  document.getElementById('show-notifications-checkbox').checked = settings.showNotifications;
  document.getElementById('refresh-interval-input').value = settings.refreshInterval;

  // Source version checkboxes
  document.getElementById('export-source-base-checkbox').checked = settings.exportSourceBase;
  document.getElementById('export-source-plus-meta-checkbox').checked = settings.exportSourcePlusMeta;
  document.getElementById('export-source-with-images-checkbox').checked = settings.exportSourceWithImages;
  document.getElementById('export-source-plus-meta-with-images-checkbox').checked = settings.exportSourcePlusMetaWithImages;

  // Note version checkboxes
  document.getElementById('export-note-base-checkbox').checked = settings.exportNoteBase;
  document.getElementById('export-note-code-blocks-checkbox').checked = settings.exportNoteCodeBlocks;
  document.getElementById('export-note-with-images-checkbox').checked = settings.exportNoteWithImages;

  // Sync legacy settings for chat export compatibility

  // Batch sizes
  document.getElementById('sources-per-zip-input').value = settings.sourcesPerZip;
  document.getElementById('notes-per-zip-input').value = settings.notesPerZip;

  // Text processing
  document.getElementById('clean-ocr-artifacts-checkbox').checked = settings.cleanOCRArtifacts;

  // Interface
  document.getElementById('show-studio-tab-checkbox').checked = settings.showStudioTab;
  document.getElementById('slides-format-select').value = settings.slidesFormat;
  document.getElementById('citation-detail-select').value = settings.citationDetail;
  document.getElementById('reuse-citations-checkbox').checked = settings.reuseCitations !== false;
  document.getElementById('citation-style-select').value = settings.citationStyle === 'footnotes' ? 'footnotes' : 'links';
  document.getElementById('obsidian-names-checkbox').checked = settings.obsidianNames === true;
  applyStudioTabVisibility();
  updateChatCitationInfo();
}

// The Chat tab's one-line reminder of the Citation detail it will export with
function updateChatCitationInfo() {
  const el = document.getElementById('chat-citation-info');
  if (!el) return;
  const label = { quotes: 'Full quotes', titles: 'Source titles only', none: 'No citations' }[NLME.chatCitationMode(settings)];
  el.textContent = `Citations: ${label} · change in ⚙️ Settings`;
}

function applyStudioTabVisibility() {
  const tabBtn = document.querySelector('.tab-btn[data-tab="studio"]');
  const tabContent = document.querySelector('.tab-content[data-tab-content="studio"]');
  if (!tabBtn || !tabContent) return;

  if (settings.showStudioTab) {
    tabBtn.hidden = false;
    tabContent.hidden = false;
  } else {
    tabBtn.hidden = true;
    tabContent.hidden = true;
    // If the Generated tab was the active tab, fall back to Sources.
    if (tabBtn.classList.contains('active')) {
      tabBtn.classList.remove('active');
      tabContent.classList.remove('active');
      const sourcesBtn = document.querySelector('.tab-btn[data-tab="sources"]');
      const sourcesContent = document.querySelector('.tab-content[data-tab-content="sources"]');
      if (sourcesBtn) sourcesBtn.classList.add('active');
      if (sourcesContent) sourcesContent.classList.add('active');
    }
  }
}

async function saveSettings() {
  settings.autoZip = document.getElementById('auto-zip-checkbox').checked;
  settings.showNotifications = document.getElementById('show-notifications-checkbox').checked;
  settings.refreshInterval = parseInt(document.getElementById('refresh-interval-input').value) || 10;

  // Source version selections
  settings.exportSourceBase = document.getElementById('export-source-base-checkbox').checked;
  settings.exportSourcePlusMeta = document.getElementById('export-source-plus-meta-checkbox').checked;
  settings.exportSourceWithImages = document.getElementById('export-source-with-images-checkbox').checked;
  settings.exportSourcePlusMetaWithImages = document.getElementById('export-source-plus-meta-with-images-checkbox').checked;

  // Note version selections
  settings.exportNoteBase = document.getElementById('export-note-base-checkbox').checked;
  settings.exportNoteCodeBlocks = document.getElementById('export-note-code-blocks-checkbox').checked;
  settings.exportNoteWithImages = document.getElementById('export-note-with-images-checkbox').checked;

  // Sync legacy settings for chat export compatibility

  // Batch sizes
  settings.sourcesPerZip = parseInt(document.getElementById('sources-per-zip-input').value) || 25;
  settings.notesPerZip = parseInt(document.getElementById('notes-per-zip-input').value) || 25;

  // Text processing
  settings.cleanOCRArtifacts = document.getElementById('clean-ocr-artifacts-checkbox').checked;

  // Interface
  settings.showStudioTab = document.getElementById('show-studio-tab-checkbox').checked;
  settings.slidesFormat = document.getElementById('slides-format-select').value === 'pptx' ? 'pptx' : 'pdf';
  settings.citationDetail = ['titles', 'none'].includes(document.getElementById('citation-detail-select').value)
    ? document.getElementById('citation-detail-select').value : 'quotes';
  settings.reuseCitations = document.getElementById('reuse-citations-checkbox').checked;
  settings.citationStyle = document.getElementById('citation-style-select').value === 'footnotes' ? 'footnotes' : 'links';
  settings.obsidianNames = document.getElementById('obsidian-names-checkbox').checked;
  applyStudioTabVisibility();
  updateChatCitationInfo();

  await chrome.storage.local.set({ settings });
}

function setupEventListeners() {
  document.getElementById('rescan-btn').addEventListener('click', () => { if (!jobLock.current()) scanPage(); });
  document.getElementById('cancel-download-btn')?.addEventListener('click', requestCancel);

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

  document.getElementById('clear-citation-cache-btn')?.addEventListener('click', async () => {
    if (jobLock.current()) { showToast(`${jobLock.current()} is still running`, 'warning'); return; }
    if (await NLME.citationCacheClear(chrome.storage.local)) showToast('Citation cache cleared', 'success');
    else showToast('Could not clear the citation cache', 'error');
  });

  document.getElementById('close-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').style.display = 'none';
    saveSettings();
  });

  // Full Takeout: the whole notebook in one run (sidebar-takeout.js)
  document.getElementById('full-takeout-btn')?.addEventListener('click', () => runExclusive('Full Takeout', runFullTakeout));
  // Its ZIP choice is saved on its own (settings.takeoutZip); the settings panel need not be open
  document.getElementById('takeout-zip-checkbox')?.addEventListener('change', (e) => {
    settings.takeoutZip = e.target.checked;
    chrome.storage.local.set({ settings }).catch(e2 => console.warn('[NotebookLM Takeout] Could not save the takeout ZIP choice:', e2));
  });

  // Health check panel
  // The health check hovers real citations, so it must never run during an
  // export (its popovers would race the export's own hovers)
  document.getElementById('health-check-btn').addEventListener('click', () => {
    runExclusive('Health check', runHealthCheck);
  });

  document.getElementById('close-health-check-btn').addEventListener('click', () => {
    document.getElementById('health-check-panel').style.display = 'none';
  });

  document.getElementById('rerun-health-check-btn').addEventListener('click', () => {
    runExclusive('Health check', runHealthCheck);
  });

  document.getElementById('copy-health-report-btn').addEventListener('click', () => {
    copyHealthReport();
  });

  // Settings inputs
  document.querySelectorAll('#settings-panel input, #settings-panel select').forEach(input => {
    input.addEventListener('change', saveSettings);
  });

  // Source version checkboxes - parent/child relationships
  // Parent checkboxes control whether child "include images" checkboxes are enabled
  const sourceParentChildPairs = [
    { parent: 'export-source-base-checkbox', child: 'export-source-with-images-checkbox' },
    { parent: 'export-source-plus-meta-checkbox', child: 'export-source-plus-meta-with-images-checkbox' }
  ];

  // Function to update child checkbox state based on parent
  function updateSourceChildState(parentId, childId) {
    const parent = document.getElementById(parentId);
    const child = document.getElementById(childId);
    if (parent && child) {
      child.disabled = !parent.checked;
      if (!parent.checked) {
        child.checked = false;
      }
    }
  }

  // Initialize child states and add event listeners
  sourceParentChildPairs.forEach(({ parent, child }) => {
    updateSourceChildState(parent, child);

    const parentCheckbox = document.getElementById(parent);
    if (parentCheckbox && !parentCheckbox.disabled) {
      parentCheckbox.addEventListener('change', () => {
        updateSourceChildState(parent, child);

        // Ensure at least one parent version is selected
        const baseChecked = document.getElementById('export-source-base-checkbox').checked;
        const metaChecked = document.getElementById('export-source-plus-meta-checkbox').checked;
        if (!baseChecked && !metaChecked) {
          parentCheckbox.checked = true;
          updateSourceChildState(parent, child);
          showToast('At least one source version must be selected', 'error');
        }
      });
    }
  });

  // Note version checkboxes - parent/child relationships
  // Parent checkboxes control whether child "include images" checkboxes are enabled
  const noteParentChildPairs = [
    { parent: 'export-note-base-checkbox', child: 'export-note-with-images-checkbox' }
  ];

  // Function to update child checkbox state based on parent
  function updateNoteChildState(parentId, childId) {
    const parent = document.getElementById(parentId);
    const child = document.getElementById(childId);
    if (parent && child) {
      child.disabled = !parent.checked;
      if (!parent.checked) {
        child.checked = false;
      }
    }
  }

  // Initialize child states and add event listeners
  noteParentChildPairs.forEach(({ parent, child }) => {
    updateNoteChildState(parent, child);

    const parentCheckbox = document.getElementById(parent);
    if (parentCheckbox && !parentCheckbox.disabled) {
      parentCheckbox.addEventListener('change', () => {
        updateNoteChildState(parent, child);

        // Ensure at least one parent version is selected
        const baseChecked = document.getElementById('export-note-base-checkbox').checked;
        const codeBlocksChecked = document.getElementById('export-note-code-blocks-checkbox').checked;
        if (!baseChecked && !codeBlocksChecked) {
          parentCheckbox.checked = true;
          updateNoteChildState(parent, child);
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
    scanChatBtn.addEventListener('click', () => runExclusive('Chat scan', scanChatPage));
  }

  // Dismiss warning banner button
  const dismissWarningBtn = document.getElementById('dismiss-warning-btn');
  if (dismissWarningBtn) {
    dismissWarningBtn.addEventListener('click', hideWarningBanner);
  }

  // Generated tab buttons (internal id 'studio')
  const scanStudioBtn = document.getElementById('scan-studio-btn');
  if (scanStudioBtn) {
    scanStudioBtn.addEventListener('click', scanStudioPage);
  }
  const studioDownloadSelectedBtn = document.getElementById('studio-download-selected-btn');
  if (studioDownloadSelectedBtn) {
    studioDownloadSelectedBtn.addEventListener('click', () => runExclusive('Generated download', handleStudioBulkDownload));
  }
  const studioDeleteSelectedBtn = document.getElementById('studio-delete-selected-btn');
  if (studioDeleteSelectedBtn) {
    studioDeleteSelectedBtn.addEventListener('click', () => runExclusive('Generated delete', handleStudioBulkDelete));
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

      // Trigger scan for the active tab (not while a job runs)
      await rescanOpenPanelTab();
    });
  });
}

function startAutoRefresh() {
  stopAutoRefresh(); // Clear any existing interval

  const interval = settings.refreshInterval * 1000;
  autoRefreshInterval = setInterval(async () => {
    if (jobLock.current()) return; // never rescan during a job
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (isNotebookUrl(tab?.url)) {
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

// The panel tab that is open, as setupTabSwitching tracks it (the .active tab button).
function openPanelTab() {
  const btn = document.querySelector('.tab-btn.active');
  return btn ? btn.dataset.tab : '';
}

// Scan the open panel tab (not while a job runs). Chat has no auto-scan: the
// user clicks "Scan Chat".
async function rescanOpenPanelTab() {
  if (jobLock.current()) return;
  switch (openPanelTab()) {
    case 'artifacts': await scanPage(); break;
    case 'notes': await scanNotesPage(); break;
    case 'sources': await scanSourcesPage(); break;
    case 'studio': await scanStudioPage(); break;
    default: break;
  }
}

// The notebook the panel last scanned. Only a notebook tab with a different id
// counts as a switch: a non-notebook tab leaves it alone, so A -> other site -> A
// is not a change.
let lastPanelNotebookId = '';

// Drop the scanned chat so it cannot be exported against another notebook, and
// show the same prompt as before a scan.
function resetChatPanel() {
  window._currentChatData = null;
  const chatResults = document.getElementById('chat-scan-results');
  const chatCount = document.getElementById('chat-count');
  const exportBtn = document.getElementById('export-chat-btn');
  if (chatResults) chatResults.innerHTML = '<p class="empty-message">Click "Scan Chat" to load your conversation history.</p>';
  if (chatCount) chatCount.textContent = '0';
  if (exportBtn) exportBtn.style.display = 'none';
}

// True when tab shows a different notebook than the panel last scanned (and
// records it). Synchronous, so overlapping tab events cannot both see a change.
// Not while a job runs: the id stays as it was and the check is queued for the
// end of the job (runPendingNotebookCheck).
let pendingNotebookCheck = false;
function notebookSwitchedTo(tab) {
  if (jobLock.current()) { pendingNotebookCheck = true; return false; }
  const id = isNotebookUrl(tab?.url) ? NLME.notebookIdFromUrl(tab.url) : '';
  if (!id || id === lastPanelNotebookId) return false;
  lastPanelNotebookId = id;
  return true;
}

// After a tab switch or navigation: a different notebook rescans the open panel
// tab and clears the chat; the same notebook only refreshes Artifacts (the Notes
// and Sources scans are slow), unless sameNotebookScan is false.
// settleMs: in-app (history API) navigation reports the new URL before the page
// has drawn the new notebook, and the content-script scans read the DOM as it
// is (no waits), so wait, then rescan only if the tab still shows that notebook.
const settleGate = NLME.createSettleGate();
async function refreshForTab(tab, { settleMs = 0, sameNotebookScan = true } = {}) {
  const switched = notebookSwitchedTo(tab);
  // A second in-app navigation during the first one's settle wait replaces it
  // (the older wait returns without a banner or rescan); a rescan the older
  // one owed passes to this one (settle.owesRescan)
  const settle = settleMs ? settleGate.begin(switched) : null;
  if (settleMs) {
    // The URL names the new notebook before the page has drawn it: no Resume
    // (it would scan the old notebook's lists) until the settle wait is over
    resumeBannerSeq++; // drops a check still waiting on storage
    hideResumeBanner();
  } else {
    refreshResumeBanner(); // follows the active tab's notebook, switched or not
  }
  const rescan = switched || !!(settle && settle.owesRescan);
  if (!rescan && settleMs) {
    await new Promise(resolve => setTimeout(resolve, settleMs));
    if (!settle.current()) return; // a newer navigation owns the banner now
    settle.settled();
    refreshResumeBanner();
  }
  if (rescan) {
    if (switched) resetChatPanel();
    const recordedId = lastPanelNotebookId;
    if (settleMs) {
      await new Promise(resolve => setTimeout(resolve, settleMs));
      if (!settle.current()) return; // a newer navigation owns the banner and the rescan now
      settle.settled();
      const [now] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!now || now.id !== tab.id || NLME.notebookIdFromUrl(now.url) !== recordedId) {
        // Nothing was rescanned: forget the id (unless a newer event replaced it) so the next event does
        if (lastPanelNotebookId === recordedId) lastPanelNotebookId = '';
        refreshResumeBanner();
        return;
      }
      refreshResumeBanner();
    }
    await rescanOpenPanelTab();
  } else if (sameNotebookScan && !jobLock.current()) {
    await scanPage();
  }
}

// The check a job made us skip: run once when the job ends.
async function runPendingNotebookCheck() {
  if (!pendingNotebookCheck) return;
  pendingNotebookCheck = false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refreshForTab(tab, { sameNotebookScan: false });
}

// ---- Resume banner (Milestone 3c) ----
// Shown above the results panel when the active tab's notebook has a job record
// with items left and no job is running. Re-checked on panel open, on every tab
// event (refreshForTab) and when a job ends (runExclusive). A newer check
// supersedes an older one still waiting on storage.
let resumeBannerSeq = 0;
async function refreshResumeBanner() {
  const seq = ++resumeBannerSeq;
  try {
    if (jobLock.current()) { hideResumeBanner(); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const notebookId = isNotebookUrl(tab?.url) ? NLME.notebookIdFromUrl(tab.url) : '';
    let record = null;
    if (notebookId) {
      const key = NLME.jobRecordKey(notebookId);
      record = (await chrome.storage.local.get(key))[key];
    }
    if (seq !== resumeBannerSeq) return;
    if (jobLock.current() || !NLME.jobRecordUsable(record, notebookId)) { hideResumeBanner(); return; }
    showResumeBanner(record, {
      onResume: () => { resumeBannerSeq++; return resumeJob(record); }, // a check in flight must not re-show it
      onDiscard: () => discardJobRecord(record)
    });
  } catch (error) {
    console.warn('[NotebookLM Takeout] Resume banner check failed:', error);
    if (seq === resumeBannerSeq) hideResumeBanner();
  }
}

// Discard: remove the record the banner showed, but only if it is still that one
// (a newer export may have replaced it since).
async function discardJobRecord(record) {
  resumeBannerSeq++; // a check in flight must not put the banner back
  try {
    const key = NLME.jobRecordKey(record.notebookId);
    const stored = (await chrome.storage.local.get(key))[key];
    if (stored && stored.id === record.id) await chrome.storage.local.remove(key);
  } catch (error) {
    console.warn('[NotebookLM Takeout] Job record not discarded:', error);
    showToast('Could not discard the earlier export', 'warning');
  }
}

async function handleTabChange(activeInfo) {
  currentTabId = activeInfo.tabId;
  await checkStatus();
  let tab = null;
  try { tab = await chrome.tabs.get(activeInfo.tabId); } catch (_) { /* tab closed */ }
  await refreshForTab(tab);
}

async function handleTabUpdate(tabId, changeInfo, tab) {
  // Only update if this is the active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id === tabId) {
    if (changeInfo.status === 'complete') {
      await checkStatus();
      await refreshForTab(tab);
    } else if (changeInfo.url && !changeInfo.status) {
      // In-app navigation (history API): a URL change with no status. A full
      // load reports {status: 'loading', url} first and is handled by 'complete'.
      await checkStatus();
      await refreshForTab(tab, { settleMs: 1500, sameNotebookScan: false });
    }
  }
}

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
// ==================== RETRY LOGIC ====================


// A mind map as <stem>.svg, <stem>.json and the interactive <stem>.html
// (the viewer is skipped when its template cannot load)
async function mindmapFiles(stem, svgContent, treeData, title) {
  const files = [
    { path: `${stem}.svg`, data: svgContent || '' },
    { path: `${stem}.json`, data: JSON.stringify(treeData || {}, null, 2) }
  ];
  try {
    files.push({ path: `${stem}.html`, data: await generateMindmapHTML(svgContent || '', title) });
  } catch (e) {
    console.warn('[NotebookLM Takeout] Mindmap HTML viewer template unavailable:', e);
  }
  return files;
}

async function checkStatus() {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('status-text');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;

    if (isNotebookUrl(tab?.url)) {
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
// ==================== STATUS CHECK ====================


// A scan the page answered with an error message (SCAN_SOURCES, SCAN_CHAT);
// the tab scans show that message as is
class ScanError extends Error {}

// Set a button's text, keeping its icon: the label is the last text node
function setButtonLabel(btn, text) {
  if (!btn) return;
  const last = btn.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) last.textContent = text;
  else btn.append(text);
}

// Helper to ensure content script is loaded
async function ensureContentScriptLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.PING });
    return true;
  } catch (error) {
    if (error.message.includes('Receiving end does not exist')) {
      console.log('[NotebookLM Takeout] Content script not loaded, injecting...');
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['takeout-shared.js', 'takeout-markdown.js', 'mindmap-extract.js', 'content.js']
      });
      // The page-world download hook too (guarded against double install)
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        files: ['takeout-shared.js', 'injected.js']
      }).catch(err => console.warn('[NotebookLM Takeout] Download hook injection failed:', err.message));
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    }
    throw error;
  }
}

// citationPlaceholders: false when no citation extraction ran (reports, source
// content), so unread markers don't produce "(citation details unavailable)".
// dropCitations: Citation detail 'none' — remove [n] markers and the Sources
// section, leaving plain text
// citationStyle: 'footnotes' writes [^label] markers and [^label]: definitions
// instead of <sup> links (Milestone 3d, ⚙️ Citation style). Only the link
// versions use it: a code-blocks version (citationsCodeBlock) keeps its
// links, since a fenced quote cannot live inside a footnote definition.
// Labels: the citation number; with noteId (combined notes files) '<noteId>-<n>',
// so every label is unique in the combined file (NLME.footnoteLabel).
function convertToMarkdown(htmlContent, sources, noteTitle, citationsCodeBlock = true, skipTitleIfPresent = false, noteId = null, citationPlaceholders = true, dropCitations = false, citationStyle = 'links') {
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

  const useFootnotes = citationStyle === 'footnotes' && !citationsCodeBlock && !dropCitations;
  const labelOf = n => NLME.footnoteLabel((noteId || 1) - 1, n, { combined: !!noteId });

  // One shared rule set (takeout-markdown.js, Milestone 3d)
  const converter = NLMEMarkdown.createConverter({
    variant: 'note',
    citations: dropCitations ? 'none' : (useFootnotes ? 'footnotes' : (citationsCodeBlock ? 'code-blocks' : 'links')),
    anchorPrefix,
    footnoteLabel: labelOf,
    log: (context, message) => logger.info(context, message)
  });

  // Convert main content
  let bodyMarkdown = converter.convert(htmlContent);

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

  // Fix occurrence numbers skipped by rules that convert a subtree twice
  // (lists), so every Sources back-link to "-1" has a target
  markdown = NLME.renumberCitationAnchors(markdown);

  // Sources section: extracted sources plus a placeholder for any marker
  // whose tooltip could not be read, all under their original numbers
  const entries = dropCitations ? [] : NLME.buildCitationEntries(sources, converter.citedNumbers(), { placeholders: citationPlaceholders });
  if (useFootnotes && entries.length > 0) {
    // Footnotes: one definition per number (a [^label] marker needs its own
    // definition, so titles-only sources are not grouped). The quote stays
    // inline, continuation lines indented by the formatter.
    // (no "Sources" heading: renderers gather definitions at the end of the file)
    markdown += '\n\n';
    markdown += NLME.footnoteDefinitions(entries, labelOf, {
      quoteOf: entry => (entry.missing || !entry.quote ? '' : (settings.cleanOCRArtifacts ? cleanOCRArtifacts(entry.quote) : entry.quote))
    });
  } else if (entries.length > 0 && entries.every(entry => !entry.quote)) {
    // No quotes (titles-only, reports): one line per source with all its
    // numbers; every number keeps its own anchor so body links still resolve
    markdown += '\n\n---\n\n## Sources\n\n';
    markdown += NLME.groupedSourcesMarkdown(entries, anchorPrefix);
  } else if (entries.length > 0) {
    markdown += '\n\n---\n\n## Sources\n\n';

    entries.forEach(entry => {
      const n = entry.number;
      markdown += `<a id="${anchorPrefix}src-${n}"></a>\n`;
      // Source number links back to its first citation in the body
      markdown += `**[[${n}]](#${anchorPrefix}cite-ref-${n}-1)** ${entry.text}\n\n`;

      if (!entry.missing && entry.quote && entry.quote.length > 0) {
        // Optionally clean OCR artifacts, then escape markdown
        const cleanedQuote = settings.cleanOCRArtifacts ? cleanOCRArtifacts(entry.quote) : entry.quote;
        if (citationsCodeBlock) {
          // Fence longer than any backtick run in the quote, so code inside
          // the quote can't close it early and invert the rest of the file
          const fence = NLME.fenceFor(cleanedQuote);
          markdown += `${fence}markdown\n${cleanedQuote}\n${fence}\n\n`;
        } else {
          // Blockquote keeps the quote's own Markdown (lists, tables, emphasis)
          markdown += `${NLME.toBlockquote(cleanedQuote)}\n\n`;
        }
      }
    });
  }

  return markdown;
}
// ==================== MARKDOWN CONVERSION ====================


/**
 * Clean up common OCR artifacts and garbage characters
 * This handles text that was poorly OCR'd, especially from older documents or Fraktur
 * @param {string} text - The text to clean
 * @param {Object} options - Options for cleanup
 * @param {boolean} options.markUnclear - If true, mark unclear sections with [OCR?]
 * @returns {string} - Cleaned text
 */
// Export-wide phase timing (Milestone 1, Task 2). Content-script responses
// carry `timing` totals that are merged here; each export's _index.md ends
// with an "Export statistics" block and the same summary is logged.
let exportTimer = null;
let exportStartedAt = 0;

// Citation cache use this export (Milestone 3c): items whose citation quotes
// were read (hits: reused from the cache instead of hovering)
let citationCacheTally = { hits: 0, items: 0 };

function tallyCitationCache(fromCache, audit = null) {
  citationCacheTally.items++;
  if (fromCache) citationCacheTally.hits++;
  if (audit) {
    audit.cachedItems = (audit.cachedItems || 0) + 1;
    if (fromCache) audit.cacheHits = (audit.cacheHits || 0) + 1;
  }
}

function startExportTiming() {
  exportTimer = NLME.createPhaseTimer();
  exportStartedAt = performance.now();
  citationCacheTally = { hits: 0, items: 0 };
}

function mergeTiming(response) {
  if (exportTimer && response && response.timing) exportTimer.merge(response.timing);
}

function timingSummary() {
  if (!exportTimer) return '';
  const summary = NLME.formatTimingSummary(exportTimer.totals(), performance.now() - exportStartedAt);
  console.log('[NotebookLM Takeout][timing]\n' + summary);
  const cacheLine = citationCacheTally.hits > 0
    ? `- Citations from cache: ${citationCacheTally.hits} of ${citationCacheTally.items} items\n` : '';
  return '\n' + summary + cacheLine;
}

// Export audit (Milestone 2, Resilience #1): what the page showed vs what
// the export wrote. Expected counts come from the HTML each export reads.
function countPageContent(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const citationNumbers = [...doc.querySelectorAll('button.citation-marker')]
    .map(b => NLME.parseCitationIndex(b.querySelector('span')?.textContent))
    .filter(Boolean);
  const formulas = doc.querySelectorAll('.katex').length;
  return { citationNumbers, formulas };
}

// Citations: distinct markers vs sources actually read (an anchor is written
// for every marker even when its popup could not be read)
function addCitationCoverage(audit, html, sources, needQuotes, page = null) {
  const counts = page || countPageContent(html);
  const coverage = NLME.citationCoverage({ markerNumbers: counts.citationNumbers, sources, needQuotes });
  audit.expected.citations += coverage.expected;
  audit.written.citations += coverage.written;
}

function newAudit() {
  // cacheHits / cachedItems: items whose citation quotes came from the cache
  // / items that had citations to read (Milestone 3c)
  return { expected: { items: 0, citations: 0, formulas: 0 }, written: { items: 0, citations: 0, formulas: 0 }, cacheHits: 0, cachedItems: 0 };
}

// Converts and counts formulas: .katex on the page vs formulas in the final
// Markdown (counted in the output, so nested list/table conversions that run
// the KaTeX converter twice can't inflate it)
function convertCounted(audit, html, convert, page = null) {
  const counts = page || countPageContent(html);
  const markdown = convert();
  audit.expected.formulas += counts.formulas;
  audit.written.formulas += NLME.countMarkdownFormulas(markdown);
  return markdown;
}

function auditSection(audit) {
  const result = NLME.auditExport(audit);
  const cacheLine = audit.cacheHits > 0 ? `\nCitations from cache: ${audit.cacheHits} of ${audit.cachedItems} items\n` : '';
  return { ok: result.ok, body: `What the page showed vs what was exported:\n\n${result.lines.join('\n')}\n${cacheLine}` };
}

// runTotals: the run-wide audit, appended as a second section (the last part
// of a split export carries it; every part's own audit comes first)
function auditMarkdown(title, audit, { runTotals = null } = {}) {
  const section = auditSection(audit);
  let text = `# ${title} Audit\n\n${section.body}`;
  if (runTotals) text += `\n## Whole run\n\n${auditSection(runTotals).body}`;
  return { ok: section.ok, text };
}

async function generateZipTimed(zip) {
  exportTimer?.start('zip.build');
  try {
    return await zip.generateAsync({ type: 'blob' });
  } finally {
    exportTimer?.end('zip.build');
  }
}

// One export/scan/download job at a time (Milestone 1, Task 3). While a job
// runs, controls in the tabs are disabled via body.job-running, auto-refresh
// and tab-switch rescans are skipped, and Cancel reaches the running job.
const jobLock = NLME.createJobLock();
let jobTabId = null;

// Returned by runExclusive when another job holds the lock
const JOB_BUSY = Symbol('job-busy');

async function runExclusive(name, fn) {
  if (!jobLock.tryAcquire(name)) {
    showToast(`${jobLock.current()} is still running`, 'warning');
    return JOB_BUSY;
  }
  document.body.classList.add('job-running');
  hideResumeBanner(); // its numbers go stale while a job writes the record
  // Disable (not just dim) the tab controls so keyboard activation is
  // blocked too. Mark them: a scan may replace a control with a clone (the
  // chat Export button), and the clone must be re-enabled too, so restore
  // by the mark, not by the original element.
  Array.from(document.querySelectorAll('.tab-content button, .tab-content input, .tab-content select, #full-takeout-btn, #takeout-zip-checkbox'))
    .filter(el => !el.disabled && el.id !== 'cancel-download-btn')
    .forEach(el => { el.disabled = true; el.setAttribute('data-job-disabled', ''); });
  try {
    // Remember the job's tab: Cancel must reach it even after a tab switch
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      jobTabId = tab?.id ?? null;
    } catch (e) {
      jobTabId = null;
    }
    return await fn();
  } finally {
    jobLock.release(name);
    jobTabId = null;
    document.body.classList.remove('job-running');
    document.querySelectorAll('[data-job-disabled]').forEach(el => {
      el.disabled = false;
      el.removeAttribute('data-job-disabled');
    });
    // Blanket re-enabling above would leave K = 0 buttons enabled
    refreshListButtons();
    // The job may have left (or finished) a record: show or hide Resume
    refreshResumeBanner();
    // A tab switch or navigation to another notebook during the job was skipped
    runPendingNotebookCheck().catch(e => console.warn('[NotebookLM Takeout] Notebook check failed:', e));
  }
}

// The results panel's "Retry N failed": re-runs `exportFn` on the items that
// failed, under the job lock (a busy lock only shows its toast; the panel
// stays). null when nothing failed.
function retryFor(failedItems, jobName, exportFn) {
  if (!failedItems || failedItems.length === 0) return null;
  return {
    count: failedItems.length,
    run: () => runExclusive(jobName, () => exportFn(failedItems))
  };
}

// Buttons that follow a list's selection (disabled at K = 0): re-derive them from the
// controllers, whatever just enabled or disabled them (a job ending, a redraw)
function refreshListButtons() {
  updateArtifactsDownloadBtn();
  updateStudioBulkButtonsState();
}

// The Retry / Resume chain (sidebar-takeout.js: runChain) is running under the job
// lock. requestCancel sets chainCancelRequested; the chain checks it before each step.
let chainActive = false;
let chainCancelRequested = false;

// Same path as the page overlay's Cancel button: the content script flags the
// export as cancelled and broadcasts CANCEL_EXPORT to every running exporter.
// Target tab: activeShellTabId (sidebar-takeout.js, the running shell's tab),
// else jobTabId (the active tab when the job started), else the current tab.
async function requestCancel() {
  if (!jobLock.current()) return;
  // A Retry / Resume chain has moments with no shell (between two steps): note the
  // cancel on the chain so it does not start the next step
  if (chainActive) chainCancelRequested = true;
  try {
    // The export shell's tab first: retries and Download Selected run on the tab
    // they were scanned on, which need not be the active one. The content script
    // there broadcasts CANCEL_EXPORT, which the shell's own listener also receives.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = activeShellTabId ?? jobTabId ?? currentTabId ?? tab?.id;
    await chrome.tabs.sendMessage(target, { type: NLME.MSG.REQUEST_EXPORT_CANCEL });
  } catch (error) {
    console.warn('[NotebookLM Takeout] Cancel request failed:', error.message);
  }
}

// Quick pre-flight before artifact downloads and chat exports: warn (don't
// block) when the selectors they depend on are missing
async function preflightWarn(tabId, type) {
  try {
    const health = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.CHECK_DOM_HEALTH, data: { type } });
    if (health && health.healthy === false) {
      showToast(`Gemini Notebook may have changed (${(health.issues || []).length} ${type} check(s) failed). Exporting anyway; run the health check 🩺 afterwards if results look wrong.`, 'warning');
    }
  } catch (e) {
    console.warn('[NotebookLM Takeout] Pre-flight check failed:', e.message);
  }
}

function cleanOCRArtifacts(text) {
  // Shared, unit-tested implementation (keeps paragraphs, tables, fences, ~~strike~~)
  return NLME.cleanOcrArtifacts(text);
}

function sanitizeFilename(filename) {
  // Shared, tested implementation (emoji-safe truncation, reserved names)
  return NLME.sanitizeFilename(filename);
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
 * Remove all images from markdown
 */
function stripImagesFromMarkdown(markdown) {
  // Remove markdown image syntax: ![alt](url)
  // This matches both embedded base64 and external URLs
  return markdown.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');
}

/**
 * Extract project name from the NotebookLM page
 */
async function getProjectName(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.GET_PROJECT_NAME });
    if (response && response.projectName) {
      console.log('[NotebookLM Takeout] Project name:', response.projectName);
      return response.projectName;
    }
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not extract project name:', error);
  }
  return 'NotebookLM';
}
// ==================== EXPORT ORCHESTRATION ====================


// ---- Job records (Milestone 3c) ----
// One record per notebook in chrome.storage.local (nlme.job.<notebookId>): the list
// keys of an export's items still to do or failed, never payloads. Task 4 reads it
// to offer "Resume". Rules: AGENT.md "Milestone 3c contracts". Recording never
// affects an export: every storage call is caught inside NLME.createJobRecorder.

// The accessors each tab's createListController uses, so keys match fresh scans
const JOB_KEY_ACCESSORS = {
  notes: { titleOf: n => n.title, typeOf: n => n.type },
  sources: { titleOf: s => s.title, typeOf: s => s.type },
  artifacts: { titleOf: a => a.label, typeOf: a => a.type }
};

// Keys of `items` (one category): the keys the tab list stamped on them (keys in
// the whole list, so a selected subset or a retry still matches a fresh scan),
// else computed over `items`. That fallback is only right when `items` is the
// whole fresh scan; a subset must be stamped (see stampJobKeys) before it is cut.
function jobItemKeys(category, items) {
  if (items.length && items.every(item => item && typeof item._listKey === 'string')) return items.map(item => item._listKey);
  return NLME.listItemKeys(items, JOB_KEY_ACCESSORS[category]);
}

// Stamp each item with its key in the whole `items` list (non-enumerable; what
// createListController does for the tab lists). Full Takeout stamps its scans, so
// a retry of a subset, or of an enabled-only list, keeps the tab's "#n" keys.
// Keys must be stamped over the FULL fresh scan before any subset is taken: keys
// computed over a subset differ from a fresh scan's for duplicate titles (Resume
// in Task 4 depends on this).
function stampJobKeys(category, items) {
  const keys = NLME.listItemKeys(items, JOB_KEY_ACCESSORS[category]);
  items.forEach((item, i) => {
    try { Object.defineProperty(item, '_listKey', { value: keys[i], configurable: true, writable: true }); } catch (_) { /* the record computes its own */ }
  });
}

/**
 * Start recording an export. Returns null (nothing is recorded) when the tab has
 * no notebook id or there is nothing to do; else a tracker the runners call:
 * done(category, item) / fail(category, item) per item, commit() after a package
 * holding the done items is saved, discard() when a runner threw before saving
 * its staged successes, finish(clean) at the end. None of them throws.
 *
 * @param {{ tab: { url: string } }} shell
 * @param {'notes'|'sources'|'artifacts'|'takeout'} kind
 * @param {string} label
 * @param {{ [category: string]: object[] }} itemsByCategory the items to export, by category
 * @param {{ update?: boolean }} [options] update: a retry or resume (also taken
 *   by a fresh export when the notebook's stored record is another kind's with
 *   items left, NLME.jobRecordMode). It never
 *   creates or replaces a record: it loads the notebook's existing one (none:
 *   returns null) and marks its items done or failed on it, only for keys the
 *   record holds, and writes nothing until one changes.
 */
async function startJobRecord(shell, kind, label, itemsByCategory, { update = false } = {}) {
  try {
    const notebookId = NLME.notebookIdFromUrl(shell.tab && shell.tab.url);
    if (!notebookId) return null;
    const keyOf = new Map();
    const keysByCategory = {};
    for (const [category, items] of Object.entries(itemsByCategory)) {
      const keys = jobItemKeys(category, items);
      items.forEach((item, i) => keyOf.set(item, keys[i]));
      keysByCategory[category] = keys;
    }
    let record;
    const storageKey = NLME.jobRecordKey(notebookId);
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    // A fresh export never replaces a pending record of another kind (a
    // cancelled takeout keeps its Resume offer through a small Sources export):
    // it runs as an update, marking only the keys that record holds
    const updating = update || NLME.jobRecordMode(stored, kind) === 'update';
    if (updating) {
      const arrays = group => !!group && typeof group === 'object' && !Array.isArray(group) && Object.values(group).every(Array.isArray);
      if (!stored || !arrays(stored.remaining) || !arrays(stored.failed)) return null;
      record = stored;
    } else {
      const now = Date.now();
      record = NLME.newJobRecord({ id: `${kind}-${now}`, kind, label, notebookId, keysByCategory, now });
      if (NLME.jobRecordFinished(record)) return null;
    }
    const recorder = NLME.createJobRecorder({ storage: chrome.storage.local, record });
    if (!updating) await recorder.start();
    // Never throws: a bad record must not skip NAVIGATE_BACK or fail a package
    const safe = fn => (...args) => {
      try { return fn(...args); } catch (error) { console.warn('[NotebookLM Takeout] Job record update failed:', error); }
    };
    return {
      done: safe((category, item) => { if (keyOf.has(item)) recorder.done(category, keyOf.get(item)); }),
      fail: safe((category, item) => { if (keyOf.has(item)) recorder.fail(category, keyOf.get(item)); }),
      commit: safe(() => recorder.commit()),
      discard: safe(() => recorder.discard()),
      finish: async clean => { try { await recorder.finish({ clean }); } catch (error) { console.warn('[NotebookLM Takeout] Job record not finished:', error); } }
    };
  } catch (error) {
    console.warn('[NotebookLM Takeout] Job record not started:', error);
    return null;
  }
}

// A tab export's record around its runner: `run(tracker)` returns the runner's
// { result }. Clean = not cancelled or stopped; a throw leaves the record.
// update (options.updateRecord of the exports, set by every retry and by resume):
// see startJobRecord. record false: no record at all (single-item row exports).
async function withJobRecord(shell, kind, label, category, items, run, { update = false, record = true } = {}) {
  // record false: a one-shot row export (a single source's download) must not
  // replace or clear a pending record
  const tracker = record ? await startJobRecord(shell, kind, label, { [category]: items }, { update }) : null;
  let out;
  try {
    out = await run(tracker);
  } catch (error) {
    if (tracker) { tracker.discard(); await tracker.finish(false); }
    throw error;
  }
  if (tracker) await tracker.finish(!out.result.cancelled && !out.result.stopped);
  return out;
}

/**
 * Where a category runner writes (runNotesJob, runSourcesJob, runChatJob,
 * runArtifactsJob). Tab exports use the defaults: their own ZIPs,
 * <Notebook>-<kind>-<ts>.zip, paths as the builders return them. Full
 * Takeout passes pathPrefix '<root>/<category>/', zipKind
 * 'takeout-<category>' and, with ZIP off, the takeout's Downloads folder.
 * It also passes variantSettings (NLME.takeoutVariantSettings: the settings
 * the notes, sources and chat paths read their variants from, default the
 * global `settings`) and itemDir '' (note and source files go straight in the
 * category folder, not in a notes/ or sources/ folder inside it).
 *
 * @typedef {{ pathPrefix?: string, zipKind?: string, folder?: string|null,
 *   variantSettings?: object, itemDir?: string, written?: Written }} CategoryTarget
 *   itemDir: folder (with trailing '/') of the note or source files inside the
 *   package; default 'notes/' / 'sources/'. mind-maps/ and the combined files
 *   keep their package-relative paths; sources' youtube-urls*.txt follow itemDir.
 *   written: filled as each package is saved (see newWritten), so a caller that
 *   gets a throw from the runner still knows what reached disk.
 */

// What a category runner has saved so far. A caller (Full Takeout) passes its
// own in target.written and reads it after a throw; otherwise the runner makes
// one. zips: ZIP names; count: packages saved (a ZIP, or a batch written to the
// folder, an errors-only package included); multi/parts: the takeout's part-N/
// folders (parts = count when the category was saved in several batches and has a
// path prefix, else 0).
function newWritten() {
  return { zips: [], count: 0, multi: false, parts: 0 };
}

// One batch of a category's files to its ZIP (name pushed to written.zips) or,
// with target.folder, into that Downloads folder; every path gets `prefix`
async function saveCategoryBatch(shell, files, info, { prefix = '', zipKind, folder = null, written }) {
  const placed = prefix ? files.map(f => ({ ...f, path: prefix + f.path })) : files;
  const record = () => {
    written.count++;
    written.multi = !!info.multi;
    written.parts = prefix && written.multi ? written.count : 0;
  };
  if (folder) {
    await saveFiles(placed, { folder });
    record();
    return;
  }
  const zipName = NLME.zipName({
    notebook: shell.projectName,
    kind: zipKind,
    timestamp: shell.timestamp,
    partial: info.partial,
    part: info.batchIndex,
    // Count-based batches know their total (-partNofM); size-split parts do
    // not (-partN); a single package has no suffix
    totalParts: info.multi ? info.totalBatches : 1
  });
  await saveFiles(placed, { zipName });
  written.zips.push(zipName);
  record();
}

// A takeout category written in several batches (or size-split parts) puts each in its own
// part-N/ folder: every batch has its own _index.md and manifest.json, and
// note/source stems are only unique within a batch, so parts unzipped into one
// tree (or saved into one folder) must not share a folder. Tab exports (no
// prefix) keep their separate ZIPs as before.
function batchPrefix(pathPrefix, info) {
  if (!pathPrefix || !info.multi) return pathPrefix;
  return `${pathPrefix}part-${info.batchIndex}/`;
}

// A note or source failed: every third failure, ask the page whether its DOM errors
// are worth a warning (once per export). Declining stops the job like a
// Cancel. Returns the Error for the runner to record.
async function itemFailed(shell, state, message) {
  state.failures++;
  if (state.failures % 3 === 0 && !state.domWarningShown) {
    try {
      const errorReport = await chrome.tabs.sendMessage(shell.tab.id, { type: NLME.MSG.GET_DOM_ERRORS });
      if (errorReport && errorReport.shouldWarn) {
        const proceed = await showDOMWarningDialog(errorReport.issues, true);
        if (!proceed) state.declined = true;
        state.domWarningShown = true;
      }
    } catch (e) {
      console.warn('[NotebookLM Takeout] Could not check DOM errors:', e);
    }
  }
  return new Error(message);
}

// Variant name for front matter and manifest.json: 'base', 'code-blocks',
// 'with-images', 'plus-meta', ... (from an NLME.noteVariants or
// NLME.sourceVariants suffix)
function variantName(suffix) {
  return suffix ? suffix.replace(/^-/, '') : 'base';
}

// Front matter for a note file or a combined notes file (field order fixed by
// the Milestone 3a layout)
function noteFrontMatter(meta, { title, kind = 'note', variant }) {
  return NLME.frontMatter({
    title,
    notebook: meta.notebook,
    notebook_url: meta.notebook_url,
    notebook_id: meta.notebook_id,
    exporter: meta.exporter,
    exported: meta.exported,
    kind,
    variant
  });
}

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
    </svg>`,
    'Video Overview': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#1a73e8">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
    </svg>`,
    'Mind Map': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#ea4335">
      <path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7z"/>
    </svg>`
  };

  return icons[type] || `<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368">
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
  </svg>`;
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
  return NLME.escapeHtml(text);
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});
