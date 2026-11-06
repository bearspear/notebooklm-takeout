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
    const statusIcon = status === 'success' ? '[ok]' : status === 'error' ? '[failed]' : '[...]';
    console.log(`[NotebookLM Takeout] [Download] ${statusIcon} ${itemName}`, details || '');
  }
};

// The panel's one icon set: simple stroke SVGs drawn in the current text colour
// (sized by CSS, .icon). Earlier scripts must not call it at load time; static
// markup uses <span data-icon="name"></span>, filled in by hydrateIcons().
const ICON_PATHS = {
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
  note: '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  check: '<path d="M5 12l5 5 10-11"/>',
  // Artifact types
  audio: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  map: '<circle cx="12" cy="12" r="2.5"/><circle cx="4.5" cy="6" r="1.5"/><circle cx="4.5" cy="18" r="1.5"/><circle cx="19.5" cy="6" r="1.5"/><circle cx="19.5" cy="18" r="1.5"/><path d="M9.8 10.8L5.8 7M9.8 13.2l-4 3.8M14.2 10.8l4-3.8M14.2 13.2l4 3.8"/>',
  // Extras for buttons that had their own inline SVG
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  health: '<path d="M22 12h-4l-3 8-6-16-3 8H2"/>'
};

function icon(name) {
  const body = ICON_PATHS[name] || ICON_PATHS.doc;
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

// Swap each <span data-icon="name"></span> in the page for its SVG
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    el.outerHTML = icon(el.dataset.icon);
  });
}

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
        <p class="dialog-note">
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
// Shipped defaults live in NLME.DEFAULT_SETTINGS (takeout-shared.js); stored
// settings are merged over them in loadSettings.
let settings = NLME.resetSettings();

document.addEventListener('DOMContentLoaded', () => {
  init();
});

// Listen for messages from content script (e.g., image download requests)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === NLME.MSG.DOWNLOAD_IMAGE_AS_BASE64) {
    // Handle image download request from content script
    fetchJobImage(message.url, { tabId: sender.tab?.id })
      .then(dataUri => {
        sendResponse({ success: true, dataUri });
      })
      .catch(error => {
        console.error('[NotebookLM Takeout] Failed to download image:', error);
        sendResponse({ success: false, error: error.message, skipped: !!error.skipped, cancelled: !!error.cancelled });
      });
    return true; // Keep channel open for async response
  }
});

async function init() {
  hydrateIcons();
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
    paintNotebookName(startTab);
  } catch (_) { /* no active tab */ }
  refreshResumeBanner(); // an earlier unfinished export of this notebook
  await scanSourcesPage(); // Start with Sources tab since it's now the default
  repaintActiveName(); // the scan injected the content script if it was missing

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

  applySettingsToUi();
}

// Set or remove data-theme on <html> from settings.theme ('auto' follows the
// OS through the CSS media query). The choice is also kept in localStorage so
// the next open can apply it before settings load (no flash of the wrong theme).
function applyTheme() {
  const attr = NLME.themeAttr(settings.theme);
  if (attr) document.documentElement.setAttribute('data-theme', attr);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('nlme-theme', attr || 'auto'); } catch (e) { /* storage blocked */ }
}

// Apply the remembered theme at once, before the async settings load
try {
  const early = NLME.themeAttr(localStorage.getItem('nlme-theme'));
  if (early) document.documentElement.setAttribute('data-theme', early);
} catch (e) { /* storage blocked */ }

// Show `settings` in the Settings panel (on load and after Reset to defaults)
function applySettingsToUi() {
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
  document.getElementById('theme-select').value = NLME.themeValue(settings.theme);
  applyTheme();
  applyStudioTabVisibility();
  updateChatCitationInfo();
}

// An "images" version is only offered while its parent version is ticked
// (the same rule the parent checkboxes' change handlers apply)
function syncVersionChildStates() {
  [
    ['export-source-base-checkbox', 'export-source-with-images-checkbox'],
    ['export-source-plus-meta-checkbox', 'export-source-plus-meta-with-images-checkbox'],
    ['export-note-base-checkbox', 'export-note-with-images-checkbox']
  ].forEach(([parentId, childId]) => {
    const parent = document.getElementById(parentId);
    const child = document.getElementById(childId);
    if (!parent || !child) return;
    child.disabled = !parent.checked;
    if (!parent.checked) child.checked = false;
  });
}

// The Chat tab's one-line reminder of the Citation detail it will export with
function updateChatCitationInfo() {
  const el = document.getElementById('chat-citation-info');
  if (!el) return;
  const label = { quotes: 'Full quotes', titles: 'Source titles only', none: 'No citations' }[NLME.chatCitationMode(settings)];
  el.textContent = `Citations: ${label} · change in Settings`;
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
  settings.theme = NLME.themeValue(document.getElementById('theme-select').value);
  applyTheme();
  applyStudioTabVisibility();
  updateChatCitationInfo();

  await chrome.storage.local.set({ settings });
}

function setupEventListeners() {
  document.getElementById('rescan-btn').addEventListener('click', async () => {
    if (!jobLock.current()) await Promise.resolve(scanPage()).catch(() => {});
    repaintActiveName();
  });
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

  document.getElementById('reset-settings-btn')?.addEventListener('click', async () => {
    if (jobLock.current()) { showToast(`${jobLock.current()} is still running`, 'warning'); return; }
    if (!confirm('Reset all settings to their defaults? The citation cache and saved exports to resume are kept.')) return;
    settings = NLME.resetSettings(settings);
    applySettingsToUi();
    syncVersionChildStates();
    await chrome.storage.local.set({ settings });
    showToast('Settings reset to defaults', 'success');
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
  // Not awaited: the name needs the page and must never delay the rescans.
  // After in-app navigation the page needs the settle time to draw the new name.
  if (settleMs) setTimeout(() => repaintActiveName(), settleMs);
  else paintNotebookName(tab);
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
      const [now] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!settle.current()) return; // a navigation arrived during the query: it owns the banner and the rescan
      settle.settled(); // only now: a navigation that began during the query must still inherit the debt
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

// The header's notebook name. A newer call supersedes an older one still
// waiting on the page, and a late answer for a notebook other than the one the
// panel shows (lastPanelNotebookId) is dropped. Never throws.
let notebookNameSeq = 0;
let paintedName = { id: '', real: false }; // what the header shows, for the fallback rule
const NAME_FALLBACK = 'NotebookLM'; // what getProjectName returns on any failure
function setNotebookName(name) {
  const el = document.getElementById('notebook-name');
  if (!el) return;
  el.textContent = name;
  el.title = name;
}
// retry: when only the fallback came back (the content script may not be there
// yet), try once more after a short wait. Never more than once.
async function paintNotebookName(tab, retry = true) {
  const seq = ++notebookNameSeq;
  try {
    const id = tab && isNotebookUrl(tab.url) ? NLME.notebookIdFromUrl(tab.url) : '';
    if (!id) {
      paintedName = { id: '', real: false };
      setNotebookName(NLME.headerName(tab?.url, ''));
      return;
    }
    const name = await getProjectName(tab.id);
    if (seq !== notebookNameSeq || id !== lastPanelNotebookId) return;
    const real = name !== NAME_FALLBACK;
    if (real || paintedName.id !== id || !paintedName.real) {
      setNotebookName(NLME.headerName(tab.url, name));
      paintedName = { id, real };
    }
    if (!real && retry) setTimeout(() => repaintActiveName(false), 1500);
  } catch (error) {
    console.warn('[NotebookLM Takeout] Notebook name not shown:', error);
  }
}
// Paint for whatever tab is active now (the tab a timer captured may be gone
// or no longer active).
async function repaintActiveName(retry = true) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await paintNotebookName(tab, retry);
  } catch (error) {
    console.warn('[NotebookLM Takeout] Notebook name not shown:', error);
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
      // The menu will not change by waiting: no retries for a missing format
      if (error && error.formatNotOffered) throw error;
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
  const openLink = document.getElementById('open-notebook-link');
  const showOpenLink = (show) => { if (openLink) openLink.hidden = !show; };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;

    if (isNotebookUrl(tab?.url)) {
      statusDot.classList.remove('inactive');
      statusDot.classList.add('active');
      statusText.textContent = 'Connected';
      statusText.title = 'Connected to NotebookLM';
      showOpenLink(false);
    } else {
      statusDot.classList.remove('active');
      statusDot.classList.add('inactive');
      statusText.textContent = 'Not connected';
      statusText.title = 'Not on NotebookLM';
      showOpenLink(true);
    }
  } catch (error) {
    statusDot.classList.remove('active');
    statusDot.classList.add('inactive');
    statusText.textContent = 'Unknown';
    statusText.title = 'Unable to check status';
    showOpenLink(false);
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
// instead of <sup> links (Milestone 3d, Citation style setting). Only the link
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
  const formulas = [...doc.querySelectorAll('.katex')]
    .filter(el => !NLME.isPriceRangeFragment(el.closest('[data-math]')?.getAttribute('data-math'))).length;
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

// The Studio list is not in the page while one of its items is open, so a scan
// would show nothing or only part of it
const STUDIO_ITEM_OPEN_HTML = '<p class="empty-message">An item is open in Studio, which hides this list.<br><span class="hint">Close it, then click Refresh.</span></p>';

async function studioViewerOpen(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.IS_STUDIO_VIEWER_OPEN });
    return !!response?.open;
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not ask whether a Studio item is open:', error.message);
    return false;
  }
}

// Quick pre-flight before artifact downloads and chat exports: warn (don't
// block) when the selectors they depend on are missing
async function preflightWarn(tabId, type) {
  try {
    const health = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.CHECK_DOM_HEALTH, data: { type } });
    if (health && health.healthy === false) {
      showToast(`Gemini Notebook may have changed (${(health.issues || []).length} ${type} check(s) failed). Exporting anyway; run the health check afterwards if results look wrong.`, 'warning');
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
 * Download a notebook image with the user's sign-in (fetchDownload, with its
 * page-credentials fallback) as a base64 data URI. Anything but an image is a
 * failure, so a sign-in page is never embedded.
 *
 * @param {string} url
 * @param {{ tabId?: number }} [options] tab that serves the fallback
 * @returns {Promise<string>} data:image/...;base64,...
 * @throws {Error} 'Fetch failed: <reason>' with the reason
 */
async function downloadImageAsBase64(url, { tabId } = {}) {
  const options = {
    tabId,
    isAllowed: NLME.isAllowedImageUrl,
    blobProblem: NLME.imageBlobProblem,
    // A limited host (429, 503) or a 403 gets no second request: the job's session waits and retries
    fallbackAfter: status => status !== 403 && !NLME.isRateLimitedStatus(status)
  };
  // The url is requested without authuser (the form live run 4 verified), one attempt only.
  // A 403 is retried by the embed pass with waits, not here.
  const blob = await fetchDownload(NLME.imageFetchUrl(url), options);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Send one item's failed images to the job, one summary per item.
 *
 * @param {Array<{url: string, reason: string}>} [failures]
 * @param {string} item the note, source or message they belong to
 * @param {Function} warn receives each NLME.summarizeImageFailures entry
 * @param {Function} [jobWarn] receives the job-wide summary of skipped images
 */
function reportImageFailures(failures, item, warn, jobWarn = warn) {
  const failed = (failures || []).filter(f => !f.skipped && !f.cancelled);
  NLME.summarizeImageFailures(failed.map(f => ({ ...f, item }))).forEach(warn);
  imageSession?.reportSkipped(jobWarn);
}

// Image downloads of the running job. One job runs at a time (job lock); the
// sources pass and the page's citation images share it.
let imageSession = null;

/**
 * @param {number} tabId tab that serves the page fetch fallback
 * @param {Function} isCancelled
 * @param {Function} [sleep] waits that end early on Cancel, by default
 */
function beginImageSession(tabId, isCancelled, sleep = null) {
  const cancellableSleep = async ms => {
    const end = Date.now() + ms;
    while (Date.now() < end && !isCancelled()) {
      await new Promise(resolve => setTimeout(resolve, Math.min(200, end - Date.now())));
    }
  };
  imageSession = NLME.createImageSession({
    download: url => downloadImageAsBase64(url, { tabId }),
    sleep: sleep || cancellableSleep,
    isCancelled
  });
}

function endImageSession() {
  imageSession = null;
}

function fetchJobImage(url, options) {
  return imageSession ? imageSession.get(url, { patient: !!options?.patient }) : downloadImageAsBase64(url, options);
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
 *   variantSettings?: object, itemDir?: string, written?: Written,
 *   capture?: ((path: string, text: string|null) => void)|null }} CategoryTarget
 *   itemDir: folder (with trailing '/') of the note or source files inside the
 *   package; default 'notes/' / 'sources/'. mind-maps/ and the combined files
 *   keep their package-relative paths; sources' youtube-urls*.txt follow itemDir.
 *   written: filled as each package is saved (see newWritten), so a caller that
 *   gets a throw from the runner still knows what reached disk.
 *   capture: told of each saved file (see saveFiles); Full Takeout's viewer.
 *   Tab exports pass none.
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
async function saveCategoryBatch(shell, files, info, { prefix = '', zipKind, folder = null, written, capture = null }) {
  const placed = prefix ? files.map(f => ({ ...f, path: prefix + f.path })) : files;
  const record = () => {
    written.count++;
    written.multi = !!info.multi;
    written.parts = prefix && written.multi ? written.count : 0;
  };
  if (folder) {
    await saveFiles(placed, { folder, capture });
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
  await saveFiles(placed, { zipName, capture });
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
  const names = {
    'Audio Overview': 'audio',
    'Slides': 'slides',
    'Infographic': 'image',
    'Report': 'doc',
    'Data Table': 'table',
    'Video Overview': 'video',
    'Mind Map': 'map',
    'Note': 'note'
  };
  if (!names[type] && /^Note/.test(type || '')) return icon('note'); // e.g. 'Note (Sources panel)'
  return icon(names[type] || 'doc');
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
