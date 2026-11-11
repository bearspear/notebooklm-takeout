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
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
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

let _dialogSeq = 0;

/**
 * The panel's one confirm: a modal <dialog> instead of the browser's native one.
 * Escape and a click on the backdrop answer false. With danger, focus starts
 * on Cancel and the confirm button is red. Text goes in as textContent only;
 * a blank line in body starts a new paragraph.
 * @returns {Promise<boolean>} true when the confirm button was chosen
 */
function showDialog({ title, body = '', list = [], confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, kind = '' } = {}) {
  return new Promise((resolve) => {
    const id = `panel-dialog-${++_dialogSeq}`;
    const dialog = document.createElement('dialog');
    dialog.className = 'panel-dialog';
    if (kind) dialog.dataset.kind = kind;
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    if (body) dialog.setAttribute('aria-describedby', `${id}-body`);

    const card = document.createElement('div');
    card.className = 'panel-dialog-card';

    const heading = document.createElement('h2');
    heading.className = 'panel-dialog-title';
    heading.id = `${id}-title`;
    heading.textContent = title || '';
    card.appendChild(heading);

    if (body) {
      const bodyEl = document.createElement('div');
      bodyEl.className = 'panel-dialog-body';
      bodyEl.id = `${id}-body`;
      for (const text of String(body).split(/\n\s*\n/)) {
        const p = document.createElement('p');
        p.textContent = text.trim();
        bodyEl.appendChild(p);
      }
      card.appendChild(bodyEl);
    }

    if (list.length) {
      const ul = document.createElement('ul');
      ul.className = 'panel-dialog-list';
      ul.tabIndex = 0; // it can scroll, so it can take focus
      for (const entry of list) {
        const li = document.createElement('li');
        li.textContent = String(entry);
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }

    const actions = document.createElement('div');
    actions.className = 'panel-dialog-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = cancelLabel;
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = danger ? 'btn btn-destructive' : 'btn btn-primary';
    confirmBtn.textContent = confirmLabel;
    actions.append(cancelBtn, confirmBtn);
    card.appendChild(actions);
    dialog.appendChild(card);

    let answer = false;
    cancelBtn.addEventListener('click', () => dialog.close());
    confirmBtn.addEventListener('click', () => { answer = true; dialog.close(); });
    // The card fills the dialog box, so a press that lands on the dialog itself
    // is on the backdrop. Both ends must be there: a text drag out of the card
    // ends with a click on the dialog too.
    let pressedBackdrop = false;
    dialog.addEventListener('mousedown', (e) => { pressedBackdrop = e.target === dialog; });
    dialog.addEventListener('click', (e) => {
      if (pressedBackdrop && e.target === dialog) dialog.close();
      pressedBackdrop = false;
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    }, { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();
    // Six items show, however they wrap; the rest scroll
    const listEl = dialog.querySelector('.panel-dialog-list');
    const sixth = listEl && listEl.children[5];
    if (sixth && listEl.children.length > 6) {
      listEl.style.maxHeight = `${sixth.getBoundingClientRect().bottom - listEl.getBoundingClientRect().top}px`;
    }
    (danger ? cancelBtn : confirmBtn).focus();
  });
}

// Close open panel dialogs, each answering false: all of them, or one kind
function closePanelDialogs(kind) {
  document.querySelectorAll('dialog.panel-dialog').forEach(dialog => {
    if (!kind || dialog.dataset.kind === kind) dialog.close();
  });
}

/**
 * Show a warning dialog for DOM compatibility issues
 * @param {string[]} issues - List of issues to display
 * @param {boolean} isMidExport - Whether this is during an export (vs pre-export)
 * @returns {Promise<boolean>} - Whether user wants to continue
 */
function showDOMWarningDialog(issues, isMidExport = false) {
  return isMidExport
    ? showDialog({
      title: 'Errors keep happening',
      body: 'Gemini Notebook may have changed while exporting.',
      list: issues,
      confirmLabel: 'Continue',
      cancelLabel: 'Stop',
      kind: 'mid-export'
    })
    : showDialog({
      title: 'Gemini Notebook looks different',
      body: 'Some parts of the page were not found, so this export may miss items. The extension may need an update.',
      list: issues,
      confirmLabel: 'Try anyway'
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
// A load from storage has worked. Until then `settings` is the defaults, and writing
// them would replace what the person saved (writeSettings).
let settingsStored = false;
const SETTINGS_UNREAD_MESSAGE = 'Your saved settings could not be read. Using defaults; changes are not saved.';
// Shipped defaults live in NLME.DEFAULT_SETTINGS (takeout-shared.js); stored
// settings are merged over them in loadSettings.
let settings = NLME.resetSettings();
// A job's own settings (withRunSettings). While one runs, `settings` is the job's
// copy and realSettings() is what the person has. currentRunOverrides is null
// outside a run. runRestore: job values -> real ones. runEdits: the real settings,
// once something in the job asked for them.
let currentRunOverrides = null;
let runRestore = null;
let runEdits = null;

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
  NLME.PANEL_TABS.forEach(tab => setTabCount(tab, null)); // Home's rows, named for screen readers
  // Disable export buttons until settings are loaded
  disableExportButtons();

  settingsStored = await NLME.loadWithRetry(loadSettings, {
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    waitMs: 500
  });
  if (!settingsStored) {
    // Storage down: the shipped defaults, and Home (chooseOpeningView). writeSettings
    // keeps them out of storage, where they would replace the person's settings.
    applySettingsToUi();
    showToast(SETTINGS_UNREAD_MESSAGE, 'warning');
  }
  settingsLoaded = true;

  // Re-enable export buttons after settings are loaded
  enableExportButtons();

  await checkStatus();
  setupEventListeners();
  setupTabSwitching();
  let startTab = null;
  try {
    [startTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    notebookSwitchedTo(startTab); // the first scan below covers this notebook
    paintNotebookName(startTab);
  } catch (_) { /* no active tab */ }
  showView(await chooseOpeningView(startTab), { save: false }); // nothing changed: keep the stored view

  // Monitor tab changes, from before the first scan: a page still loading reports
  // while it runs
  chrome.tabs.onActivated.addListener(handleTabChange);
  chrome.tabs.onUpdated.addListener(handleTabUpdate);
  window.addEventListener('focus', handlePanelFocus);

  refreshResumeBanner(); // an earlier unfinished export of this notebook
  await rescanOpenPanelTab();
  repaintActiveName(); // the scan injected the content script if it was missing
}

function disableExportButtons() {
  const exportButtons = [
    'action-btn',
    'scan-chat-btn',
    'full-takeout-btn'
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
    'action-btn',
    'scan-chat-btn',
    'full-takeout-btn'
  ];

  exportButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });
  applyAction(); // the action stays off while its list is empty or a job runs
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

    // Only when none is stored: reaches storage with the next save, not from here
    if (!('exportPreset' in stored.settings)) migrated.exportPreset = NLME.migratePreset(stored.settings);

    settings = migrated;
  }

  applySettingsToUi();
}

// The person's settings, whatever job runs. Everything that changes or stores
// settings goes through this, so a job's values never reach storage and a change
// made during a job leaves the job's values alone.
function realSettings() {
  if (!runRestore) return settings;
  if (!runEdits) runEdits = runRestore(settings);
  return runEdits;
}

// Runs the job `fn` on `settings` with `overrides` on top, async work included, and
// restores in the finally. A run inside a run adds to the outer one; the real settings
// stay the first ones. A change made in Settings meanwhile is stored at once and
// takes effect here, when the job ends. Call it inside runExclusive, so a job refused
// by the lock swaps nothing.
async function withRunSettings(overrides, fn) {
  const outerOverrides = currentRunOverrides;
  const outerRestore = runRestore;
  const { run, persistable } = NLME.applyRunSettings(settings, overrides);
  settings = run;
  currentRunOverrides = { ...outerOverrides, ...overrides };
  runRestore = outerRestore ? current => outerRestore(persistable(current)) : persistable;
  try {
    return await fn();
  } finally {
    settings = persistable(settings);
    currentRunOverrides = outerOverrides;
    runRestore = outerRestore;
    if (!runRestore) {
      if (runEdits) settings = runEdits;
      runEdits = null;
    }
  }
}

// Holds on to the running job's overrides: `rerun(fn)` runs fn on them later, when
// the job has ended (a Retry). Outside a run, fn just runs.
function rememberRunSettings() {
  const overrides = currentRunOverrides;
  return fn => (overrides ? withRunSettings(overrides, fn) : fn());
}

// Set or remove data-theme on <html> from settings.theme ('auto' follows the
// OS through the CSS media query). The choice is also kept in localStorage so
// the next open can apply it before settings load (no flash of the wrong theme).
function applyTheme() {
  const attr = NLME.themeAttr(realSettings().theme);
  if (attr) document.documentElement.setAttribute('data-theme', attr);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('nlme-theme', attr || 'auto'); } catch (e) { /* storage blocked */ }
}

// Apply the remembered theme at once, before the async settings load
try {
  const early = NLME.themeAttr(localStorage.getItem('nlme-theme'));
  if (early) document.documentElement.setAttribute('data-theme', early);
} catch (e) { /* storage blocked */ }

// Custom's three rows show only under Custom, which is the only time they are read:
// a hidden row never writes, so Archive and back keeps Custom's values.
function paintExportDefaults() {
  const settings = realSettings();
  document.getElementById('default-preset-select').value = NLME.sheetChoice(settings).preset;
  document.getElementById('default-save-select').value = NLME.takeoutZipChoice(settings) ? 'zip' : 'folder';
  document.getElementById('citation-detail-select').value = settings.citationDetail;
  document.getElementById('custom-images-checkbox').checked = settings.customImages !== false;
  document.getElementById('obsidian-names-checkbox').checked = settings.obsidianNames === true;
  document.getElementById('custom-defaults').hidden = settings.exportPreset !== 'custom';
}

// Show the person's settings in the Settings panel (on load and after Reset to defaults)
function applySettingsToUi() {
  const settings = realSettings();
  document.getElementById('show-notifications-checkbox').checked = settings.showNotifications;
  document.getElementById('refresh-interval-input').value = settings.refreshInterval;

  // Source version checkboxes
  document.getElementById('export-source-base-checkbox').checked = settings.exportSourceBase;
  document.getElementById('export-source-plus-meta-checkbox').checked = settings.exportSourcePlusMeta;
  document.getElementById('export-source-plus-meta-with-images-checkbox').checked = settings.exportSourcePlusMetaWithImages;

  // Note version checkboxes
  document.getElementById('export-note-base-checkbox').checked = settings.exportNoteBase;
  document.getElementById('export-note-code-blocks-checkbox').checked = settings.exportNoteCodeBlocks;

  // Sync legacy settings for chat export compatibility

  // Batch sizes
  document.getElementById('sources-per-zip-input').value = settings.sourcesPerZip;
  document.getElementById('notes-per-zip-input').value = settings.notesPerZip;

  // Text processing
  document.getElementById('clean-ocr-artifacts-checkbox').checked = settings.cleanOCRArtifacts;

  // Interface
  document.getElementById('slides-format-select').value = settings.slidesFormat;
  document.getElementById('reuse-citations-checkbox').checked = settings.reuseCitations !== false;
  document.getElementById('citation-style-select').value = settings.citationStyle === 'footnotes' ? 'footnotes' : 'links';
  document.getElementById('theme-select').value = NLME.themeValue(settings.theme);
  paintExportDefaults();
  applyTheme();
}

// An "images" version is only offered while its parent version is ticked
// (the same rule the parent checkboxes' change handlers apply)
function syncVersionChildStates() {
  [
    ['export-source-plus-meta-checkbox', 'export-source-plus-meta-with-images-checkbox']
  ].forEach(([parentId, childId]) => {
    const parent = document.getElementById(parentId);
    const child = document.getElementById(childId);
    if (!parent || !child) return;
    child.disabled = !parent.checked;
    if (!parent.checked) child.checked = false;
  });
}

// One more try at storage after a failed load. The values held meanwhile go, so a
// key missing from storage comes from the defaults, not from a change that was never
// saved. Fails with them still in place.
async function retrySettingsLoad() {
  const held = settings;
  settings = NLME.resetSettings();
  try {
    await loadSettings();
    settingsStored = true;
    syncVersionChildStates();
    return true;
  } catch (error) {
    settings = held;
    console.warn('[NotebookLM Takeout] Settings still cannot be read:', error);
    return false;
  }
}

// The one write of `settings`, false when it did not happen. Blocked until a load
// has worked. A blocked write tries the load again, so storage coming back lifts
// the block: the stored settings return, and the change has to be made again.
// undo: puts the change back when it was not stored and no stored settings replaced it.
async function writeSettings({ undo = null } = {}) {
  const settings = realSettings();
  if (settingsStored) {
    try {
      await chrome.storage.local.set({ settings });
      return true;
    } catch (error) {
      console.warn('[NotebookLM Takeout] Could not save settings:', error);
      if (undo) undo();
      showToast('Could not save settings', 'warning');
      return false;
    }
  }
  // No load during a job, nor once one holds the lock: it would replace the settings
  // the job runs on, or land just after withRunSettings swapped them in
  if (!jobLock.current() && !currentRunOverrides && await retrySettingsLoad()) {
    showToast('Your saved settings are back. Please make that change again.', 'warning');
  } else {
    if (undo) undo();
    showToast(SETTINGS_UNREAD_MESSAGE, 'warning');
  }
  return false;
}

async function saveSettings() {
  const settings = realSettings(); // during a job, not the job's copy
  // What the next export starts on: a change that was not stored must not look stored
  const { exportPreset, takeoutZip } = settings;
  const undo = () => {
    Object.assign(realSettings(), { exportPreset, takeoutZip });
    paintExportDefaults();
  };
  settings.exportPreset = document.getElementById('default-preset-select').value;
  settings.takeoutZip = document.getElementById('default-save-select').value === 'zip';
  // Custom's values only while Custom's rows show, so they outlive any other preset
  if (settings.exportPreset === 'custom') {
    settings.citationDetail = ['titles', 'none'].includes(document.getElementById('citation-detail-select').value)
      ? document.getElementById('citation-detail-select').value : 'quotes';
    settings.customImages = document.getElementById('custom-images-checkbox').checked;
    settings.obsidianNames = document.getElementById('obsidian-names-checkbox').checked;
  }
  document.getElementById('custom-defaults').hidden = settings.exportPreset !== 'custom';
  settings.showNotifications = document.getElementById('show-notifications-checkbox').checked;
  settings.refreshInterval = parseInt(document.getElementById('refresh-interval-input').value) || 10;

  // Source version selections
  settings.exportSourceBase = document.getElementById('export-source-base-checkbox').checked;
  settings.exportSourcePlusMeta = document.getElementById('export-source-plus-meta-checkbox').checked;
  settings.exportSourcePlusMetaWithImages = document.getElementById('export-source-plus-meta-with-images-checkbox').checked;

  // Note version selections
  settings.exportNoteBase = document.getElementById('export-note-base-checkbox').checked;
  settings.exportNoteCodeBlocks = document.getElementById('export-note-code-blocks-checkbox').checked;

  // Sync legacy settings for chat export compatibility

  // Batch sizes
  settings.sourcesPerZip = parseInt(document.getElementById('sources-per-zip-input').value) || 25;
  settings.notesPerZip = parseInt(document.getElementById('notes-per-zip-input').value) || 25;

  // Text processing
  settings.cleanOCRArtifacts = document.getElementById('clean-ocr-artifacts-checkbox').checked;

  // Interface
  settings.slidesFormat = document.getElementById('slides-format-select').value === 'pptx' ? 'pptx' : 'pdf';
  settings.reuseCitations = document.getElementById('reuse-citations-checkbox').checked;
  settings.citationStyle = document.getElementById('citation-style-select').value === 'footnotes' ? 'footnotes' : 'links';
  settings.theme = NLME.themeValue(document.getElementById('theme-select').value);
  applyTheme();

  await writeSettings({ undo });
}

function setupEventListeners() {
  document.getElementById('rescan-btn').addEventListener('click', async () => {
    if (!jobLock.current()) await Promise.resolve(panelView === 'home' ? reconcileHome() : rescanOpenPanelTab()).catch(() => {});
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
    closeExportSheet();
    openCover('settings-panel');
  });

  document.getElementById('reset-settings-btn')?.addEventListener('click', async () => {
    if (jobLock.current()) { showToast(`${jobLock.current()} is still running`, 'warning'); return; }
    const reset = await showDialog({
      title: 'Reset settings?',
      body: 'Default save, the citation cache and saved exports to resume are kept.',
      confirmLabel: 'Reset',
      danger: true
    });
    if (!reset) return;
    if (jobLock.current()) { showToast(`${jobLock.current()} is still running`, 'warning'); return; }
    settings = NLME.resetSettings(settings);
    applySettingsToUi();
    syncVersionChildStates();
    if (await writeSettings()) showToast('Settings reset to defaults', 'success');
  });

  document.getElementById('clear-citation-cache-btn')?.addEventListener('click', async () => {
    if (jobLock.current()) { showToast(`${jobLock.current()} is still running`, 'warning'); return; }
    if (await NLME.citationCacheClear(chrome.storage.local)) showToast('Citation cache cleared', 'success');
    else showToast('Could not clear the citation cache', 'error');
  });

  document.getElementById('close-settings-btn').addEventListener('click', () => {
    closeCover('settings-panel');
    // While writes are blocked there is nothing to save: each change already said so
    if (settingsStored) saveSettings();
  });

  // Export everything: the whole notebook in one run (sidebar-takeout.js)
  document.getElementById('full-takeout-btn')?.addEventListener('click', openExportEverythingSheet);
  setupExportSheet();

  // Health check panel
  // The health check hovers real citations, so it must never run during an
  // export (its popovers would race the export's own hovers)
  document.getElementById('health-check-btn').addEventListener('click', () => {
    runExclusive('Health check', runHealthCheck);
  });

  document.getElementById('close-health-check-btn').addEventListener('click', () => closeCover('health-check-panel'));
  document.addEventListener('keydown', handleCoverKey);

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

  // The shared action bar: runs whatever the open tab last set with setAction
  document.getElementById('action-btn').addEventListener('click', () => {
    if (_action && !_action.disabled && !jobLock.current() && _action.onClick) _action.onClick();
  });

  // Load chat (the Chat tab never scans by itself: it scrolls the page)
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

  // Generated tab's Delete, beside the action bar (internal id 'studio')
  const studioDeleteSelectedBtn = document.getElementById('studio-delete-selected-btn');
  if (studioDeleteSelectedBtn) {
    studioDeleteSelectedBtn.addEventListener('click', () => runExclusive('Studio delete', handleStudioBulkDelete));
  }
}

function setupTabSwitching() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => openTab(btn.dataset.tab));
  });
  const tabList = document.querySelector('.tabs');
  tabList.addEventListener('keydown', handleTabKey);
  tabList.addEventListener('focusout', (e) => { if (!tabList.contains(e.relatedTarget)) resetTabStops(); });
  // Chat's row only opens the tab: Load chat scrolls the page, so it stays a click there
  document.querySelectorAll('.home-row').forEach(row => {
    row.addEventListener('click', () => openTab(row.dataset.homeTab, { focus: true }));
  });
  document.getElementById('back-btn').addEventListener('click', () => {
    showView('home', { focus: true });
    return refreshHome(); // a count cleared since (a delete in Generated) is read again
  });
}

// The tab list: arrows, Home and End move the focus; Enter or Space opens the tab.
// Opening scans the page, so moving along the tabs does not open each one.
// Tab leaves for the open tab's list (one stop: the roving tabindex).
const TAB_KEYS = { ArrowLeft: -1, ArrowRight: 1 };
function handleTabKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const tabs = Array.from(document.querySelectorAll('.tab-btn'));
  const at = tabs.indexOf(document.activeElement);
  if (at < 0) return;
  let next;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = (at + TAB_KEYS[event.key] + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs.forEach((btn, i) => { btn.tabIndex = i === next ? 0 : -1; });
  tabs[next].focus();
}

// Back to one tab stop, on the open tab, when the focus leaves the list
function resetTabStops() {
  document.querySelectorAll('.tab-btn').forEach(btn => { btn.tabIndex = btn.classList.contains('active') ? 0 : -1; });
}

// ---- Covers: Settings and the health check fill the panel ----
// What a cover hides leaves the tab order (inert), Escape closes the top one, and
// the keyboard goes back to the button that opened it. Bottom to top:
const COVERS = [
  { id: 'settings-panel', close: 'close-settings-btn' },
  { id: 'health-check-panel', close: 'close-health-check-btn' }
];
const _coverOpeners = {};

function coverIsOpen(id) {
  return getComputedStyle(document.getElementById(id)).display !== 'none';
}

// The one rule for what is inert: the lists under a cover or the export sheet,
// and any cover under the top one
function syncCoverInert() {
  const open = COVERS.filter(cover => coverIsOpen(cover.id));
  const top = open[open.length - 1];
  document.querySelector('.container').inert = open.length > 0 || !!_sheet;
  COVERS.forEach(cover => { document.getElementById(cover.id).inert = !!top && cover !== top; });
}

// Called again while open (Run Again): the opener stays the first one
function openCover(id) {
  const cover = COVERS.find(c => c.id === id);
  const panel = document.getElementById(id);
  if (!coverIsOpen(id)) _coverOpeners[id] = document.activeElement;
  panel.style.display = 'block';
  syncCoverInert();
  const held = document.activeElement;
  if (!panel.contains(held) || held.getClientRects().length === 0) {
    document.getElementById(cover.close).focus({ preventScroll: true });
  }
}

function closeCover(id) {
  if (!coverIsOpen(id)) return;
  document.getElementById(id).style.display = 'none';
  syncCoverInert();
  const opener = _coverOpeners[id];
  delete _coverOpeners[id];
  const usable = opener && opener.isConnected && !opener.disabled && opener.getClientRects().length > 0 && !opener.closest('[inert]');
  if (usable) opener.focus({ preventScroll: true });
  else focusView(panelView);
}

// Escape closes the top cover through its close button, so Settings still saves.
// A dialog or the export sheet answers its own Escape.
function handleCoverKey(event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (event.target?.closest?.('dialog') || document.querySelector('dialog[open]')) return;
  const top = COVERS.filter(cover => coverIsOpen(cover.id)).pop();
  if (!top) return;
  event.preventDefault();
  document.getElementById(top.close).click();
}

// Open a list, then scan it (not while a job runs)
async function openTab(tab, options) {
  showView(tab, options);
  await rescanOpenPanelTab();
}

// ---- The panel's views: Home (#home-view) or one tab ----
// Home has no active tab, so openPanelTab() is '' there and everything keyed on the
// open tab (the action bar, rescans, auto-refresh) leaves Home alone. Progress and
// results sit outside the views and hide whichever is open (setDock).
const PANEL_VIEW_KEY = 'nlme.panelView';
let panelView = 'home';

// Fire-and-forget: a failed save only means the next open lands on Home. Nothing is
// saved before the panel has seen a notebook; after that the record names the last
// one, also while the active tab is another site.
function savePanelView(view) {
  if (!lastPanelNotebookId) return;
  try {
    Promise.resolve(chrome.storage.local.set({ [PANEL_VIEW_KEY]: { notebookId: lastPanelNotebookId, view } }))
      .catch(error => console.warn('[NotebookLM Takeout] Could not save the panel view:', error));
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not save the panel view:', error);
  }
}

// Where the keyboard goes: Back returns to the row it left, a row to its tab
function focusView(view, leftView) {
  const home = () => document.querySelector(`.home-row[data-home-tab="${leftView}"]:not(:disabled)`)
    || document.querySelector('.home-row:not(:disabled)')
    || document.getElementById('rescan-btn');
  const target = dockMode ? dockFocusTarget() : view === 'home' ? home() : document.querySelector('.tab-btn.active');
  target?.focus({ preventScroll: true });
}

// Show Home or a tab. Anything that is not a real view means Home. Does not scan:
// a caller decides when (a notebook switch waits out its settle).
// focus: the person asked for this view, so the keyboard follows them. Without it,
// focus only moves when the element holding it has just been hidden.
function showView(view, { save = true, focus = false } = {}) {
  const target = NLME.PANEL_TABS.includes(view) ? view : 'home';
  const home = target === 'home';
  const left = panelView;
  const held = document.activeElement; // before hiding: Chrome then drops focus to body
  panelView = target;
  document.getElementById('home-view').hidden = !home;
  document.querySelector('.tabs').hidden = home;
  document.getElementById('back-btn').hidden = home;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const on = btn.dataset.tab === target;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.tab-content').forEach(content => content.classList.toggle('active', content.dataset.tabContent === target));
  applyOpenTabAction();
  if (home) document.getElementById('resume-notice').textContent = ''; // the card itself shows here
  if (save) savePanelView(target);
  const lostFocus = !!held && held !== document.body && held.getClientRects().length === 0;
  if (focus || lostFocus) focusView(target, left);
}

// The view to open on. Storage failure, or no notebook, means Home.
async function chooseOpeningView(tab) {
  try {
    const id = isNotebookUrl(tab?.url) ? NLME.notebookIdFromUrl(tab.url) : '';
    if (!id) return 'home';
    const jobKey = NLME.jobRecordKey(id);
    const stored = await chrome.storage.local.get([PANEL_VIEW_KEY, jobKey]);
    return NLME.panelOpenView(stored[PANEL_VIEW_KEY], id, NLME.jobRecordUsable(stored[jobKey], id));
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not read the panel view:', error);
    return 'home';
  }
}

// ---- Home ----
// One counter per scan, in order. Each reads the same data as its list, so a count
// on Home is the count on the tab; setTabCount paints both. Plain reads of the page:
// none clicks, opens or scrolls anything. Chat is not here: its scan scrolls the page.
const HOME_SCANS = [
  ['sources', async tabId => (await scanSourcesData(tabId)).sources.length],
  ['notes', async tabId => (await scanNotesData(tabId, { strict: true })).length],
  ['studio', async tabId => (await scanGeneratedItems(tabId)).length]
];
// The page draws its lists after it reports loaded, so a 0 is read again: waits
// before each re-read, which makes the reads 0 s, 1.5 s and 4 s after the first.
const HOME_REREAD_WAITS = [1500, 2500];
const HOME_READ_THROTTLE_MS = 1000;
const homeGate = NLME.createLatestGate();
let homeNotebookOpen = false; // the active tab shows a notebook (checkStatus)
let homeOnSite = false; // the active tab is on a notebook host, a notebook or not
let homeItemOpen = false; // the last scan found a Studio item open, which hides its lists
let homeReadFailed = false; // the last reads left a count unreadable
let homeRereading = false; // a re-read is waiting on its timer
let homeForceOwed = false; // a forced read arrived during a settle wait
let lastHomeRead = 0;
const _homeZeroConfirmed = new Set(); // lists this notebook has proved empty
let settleWaits = 0; // settle waits running: the page is not drawn yet

// A 0 is not known until it has survived the re-reads
function homeCountsKnown() {
  return HOME_SCANS.every(([tab]) => _tabCounts[tab] > 0 || (_tabCounts[tab] === 0 && _homeZeroConfirmed.has(tab)));
}

function paintHomeRow(tab) {
  const row = document.querySelector(`.home-row[data-home-tab="${tab}"]`);
  if (!row) return;
  const count = _tabCounts[tab];
  const text = NLME.homeCountText(tab, count, homeNotebookOpen);
  row.querySelector('.home-count').textContent = text;
  const name = row.querySelector('.home-label').textContent;
  const unknown = tab === 'chat' ? 'not loaded' : 'not counted yet';
  const spoken = !homeNotebookOpen ? 'not available' : (count != null ? text : unknown);
  row.setAttribute('aria-label', `${name}, ${spoken}`);
}

// What Home offers right now. Called when the tab changes, a job or settle wait
// starts or ends, and a scan changes what it knows. Rows stay usable during a job, as
// the tabs do. Export everything waits out a settle: the notebook is half switched.
function syncHomeControls() {
  syncExportSheet();
  NLME.PANEL_TABS.forEach(paintHomeRow);
  document.querySelectorAll('.home-row').forEach(row => { row.disabled = !homeNotebookOpen; });
  const exportBtn = document.getElementById('full-takeout-btn');
  if (exportBtn && settingsLoaded) {
    exportBtn.disabled = !homeNotebookOpen || !!jobLock.current() || settleWaits > 0;
    exportBtn.style.opacity = '';
  }
  const notice = document.getElementById('home-notice');
  if (!notice) return;
  const html = HOME_NOTICE_HTML[NLME.homeNotice({ onSite: homeOnSite, onNotebook: homeNotebookOpen, itemOpen: homeItemOpen, readFailed: homeReadFailed })] || '';
  if (notice.innerHTML !== html) notice.innerHTML = html;
  notice.hidden = !html;
}

// Count this notebook's lists, one after another, painting each as it lands. Runs
// once per notebook: a notebook switch clears the counts, and with all three known
// only force scans again. Skipped during a job and on a list; the job's end and
// returning to Home each call it again. During a settle wait it only remembers a
// force for the wait's end, when the wait's owner calls it.
async function refreshHome({ force = false } = {}) {
  if (panelView !== 'home' || jobLock.current()) return;
  if (settleWaits > 0) {
    homeForceOwed = homeForceOwed || force;
    return;
  }
  if (!force && !homeForceOwed && homeCountsKnown() && !homeItemOpen && !homeReadFailed) return;
  homeForceOwed = false;
  homeRereading = false;
  lastHomeRead = Date.now();
  await readHomeCounts(homeGate.begin(), 0);
}

// One pass of reads. A count that may be wrong (a 0, a failed read) makes it come
// back on a timer, up to the attempts. Every await rechecks the gate, the job lock,
// the view and the notebook, so a scan of a notebook the panel has left never paints,
// and a job or leaving Home ends the re-reads (their ends call refreshHome again).
async function readHomeCounts(token, attempt) {
  if (!homeGate.isLatest(token)) return;
  homeRereading = false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = isNotebookUrl(tab?.url) ? NLME.notebookIdFromUrl(tab.url) : '';
    const live = () => homeGate.isLatest(token) && panelView === 'home' && !jobLock.current() && settleWaits === 0 && !!id && lastPanelNotebookId === id;
    // The panel hears of a navigation late: ask the tab too before believing a scan
    const stillHere = async () => {
      if (!live()) return false;
      const [now] = await chrome.tabs.query({ active: true, currentWindow: true });
      return live() && now?.id === tab.id && NLME.notebookIdFromUrl(now.url) === id;
    };
    if (!live()) return;
    await ensureContentScriptLoaded(tab.id);
    const itemOpen = await studioViewerOpen(tab.id);
    if (!await stillHere()) return;
    homeItemOpen = itemOpen;
    if (itemOpen) {
      homeReadFailed = false;
      HOME_SCANS.forEach(([name]) => setTabCount(name, null));
      syncHomeControls();
      return;
    }
    syncHomeControls();
    let again = false;
    let failed = false;
    for (const [name, count] of HOME_SCANS) {
      let found = null;
      try {
        found = await count(tab.id);
      } catch (error) {
        console.warn(`[NotebookLM Takeout] Home could not count ${name}:`, error);
      }
      if (!await stillHere()) return;
      const read = NLME.homeCountRead({ found, confirmedZero: _homeZeroConfirmed.has(name), attemptsLeft: HOME_REREAD_WAITS.length - attempt });
      if (read.zeroConfirmed) _homeZeroConfirmed.add(name);
      setTabCount(name, read.show);
      again = again || read.retry;
      failed = failed || read.failed;
    }
    homeReadFailed = failed && !again;
    syncHomeControls();
    if (again) {
      homeRereading = true;
      setTimeout(() => readHomeCounts(token, attempt + 1), HOME_REREAD_WAITS[attempt]);
    }
  } catch (error) {
    console.warn('[NotebookLM Takeout] Home scan failed:', error);
  }
}

// Read Home again though every count is known: the page may have changed while the
// panel looked elsewhere. Rapid events do one read, a hidden panel none.
function refreshHomeFresh() {
  if (panelView !== 'home' || jobLock.current()) return;
  return refreshHome({ force: !document.hidden && Date.now() - lastHomeRead >= HOME_READ_THROTTLE_MS });
}

// The person came back to the panel's window. Only Home reads: a list and its
// selection are left alone.
function handlePanelFocus() {
  if (document.hidden || homeRereading || settleWaits > 0) return;
  refreshHomeFresh();
}

// Refresh on Home goes the way of a tab event, so a notebook the panel missed is
// picked up here instead of leaving a Home that cannot scan.
async function reconcileHome() {
  if (settleWaits > 0) return refreshHome({ force: true });
  await checkStatus();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refreshForTab(tab, { homeForce: true });
}

function startAutoRefresh() {
  stopAutoRefresh(); // Clear any existing interval

  const interval = settings.refreshInterval * 1000;
  autoRefreshInterval = setInterval(async () => {
    if (jobLock.current()) return; // never rescan during a job
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (isNotebookUrl(tab?.url)) {
      await rescanGeneratedIfOpen();
    }
  }, interval);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// The panel tab that is open (the .active tab button); '' on Home.
function openPanelTab() {
  const btn = document.querySelector('.tab-btn.active');
  return btn ? btn.dataset.tab : '';
}

// Scan the open view (not while a job runs). Lists fill themselves when a tab is
// opened, Home counts what is not known yet. Chat has no auto-scan: the user clicks
// "Load chat".
async function rescanOpenPanelTab() {
  if (jobLock.current()) return;
  if (panelView === 'home') return refreshHome();
  switch (openPanelTab()) {
    case 'notes': await scanNotesPage(); break;
    case 'sources': await scanSourcesPage(); break;
    case 'studio': await scanStudioPage(); break;
    default: break;
  }
}

// Generated is the one list that may rescan without being asked (auto-refresh, a
// tab event in the same notebook): an unchanged scan leaves it alone, and the
// Notes and Sources scans are slow and redraw.
async function rescanGeneratedIfOpen() {
  if (openPanelTab() === 'studio' && !jobLock.current()) await scanStudioPage();
}

// The open tab's list holds an element matching `selector`. Chat is not a list here.
const LIST_RESULTS_IDS = { sources: 'sources-scan-results', notes: 'notes-results', studio: 'studio-scan-results' };
function openListShows(selector) {
  const id = LIST_RESULTS_IDS[openPanelTab()];
  return !!id && !!document.getElementById(id)?.querySelector(selector);
}

// The notebook the panel last scanned. Only a notebook tab with a different id
// counts as a switch: a non-notebook tab leaves it alone, so A -> other site -> A
// is not a change.
let lastPanelNotebookId = '';

// Drop the scanned chat so it cannot be exported against another notebook, and
// show the same prompt as before a scan. Also forgets every tab's action and
// count, and the Generated list, which a rescan leaves up and whose Delete must
// not reach the new notebook: they belong to the notebook that was scanned.
function resetChatPanel() {
  closeExportSheet({ switched: true }); // first: its Start would reach the new notebook
  closePanelDialogs(); // a Delete asked about the old notebook must not reach the new one
  releasePageLoad(); // the panel has caught up with the tab; the caller's settle takes over
  resultsLeftNotebook();
  window._currentChatData = null;
  const chatResults = document.getElementById('chat-scan-results');
  if (chatResults) chatResults.innerHTML = '<p class="empty-message">Click "Load chat" to load your conversation history.</p>';
  forgetStudioList();
  _sourcesScanSeq++; // a scan of the old notebook still running must not draw
  _notesScanSeq++;
  homeGate.begin(); // A -> B -> A: an A scan from before the trip read the page as it was
  homeRereading = false;
  homeItemOpen = false;
  homeReadFailed = false;
  _homeZeroConfirmed.clear();
  Object.keys(_tabActions).forEach(tab => delete _tabActions[tab]);
  document.querySelectorAll('.tab-btn').forEach(btn => setTabCount(btn.dataset.tab, null));
  applyOpenTabAction();
  syncHomeControls();
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

// A settle wait of refreshForTab. settleWaits holds Home's scans off until it ends:
// the wait's owner scans then, and a scan now would read the old notebook's page.
async function settleWait(ms) {
  settleWaits++;
  syncHomeControls();
  try {
    await new Promise(resolve => setTimeout(resolve, ms));
  } finally {
    settleWaits--;
    syncHomeControls();
  }
}

// After a tab switch or navigation: a different notebook clears the chat and opens
// Home, then counts it; the same notebook reads Home again (the page may have changed,
// homeForce: Refresh, not throttled), or on a list only refreshes Generated, if open
// (the Notes and Sources scans are slow), unless sameNotebookScan is false. A list
// still showing the prompt from another site is rescanned: there is nothing drawn to
// lose.
// settleMs: in-app (history API) navigation reports the new URL before the page
// has drawn the new notebook, and the content-script scans read the DOM as it
// is (no waits), so wait, then rescan only if the tab still shows that notebook.
const settleGate = NLME.createSettleGate();
const PAGE_SETTLE_MS = 1500;
async function refreshForTab(tab, { settleMs = 0, sameNotebookScan = true, homeForce = false } = {}) {
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
    await settleWait(settleMs);
    if (!settle.current()) return; // a newer navigation owns the banner now
    settle.settled();
    refreshResumeBanner();
  }
  if (rescan) {
    if (switched) {
      resetChatPanel();
      showView('home');
    }
    const recordedId = lastPanelNotebookId;
    if (settleMs) {
      await settleWait(settleMs);
      if (!settle.current()) return; // a newer navigation owns the banner and the rescan now
      const [now] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!settle.current()) return; // a navigation arrived during the query: it owns the banner and the rescan
      settle.settled(); // only now: a navigation that began during the query must still inherit the debt
      if (!now || now.id !== tab.id || NLME.notebookIdFromUrl(now.url) !== recordedId) {
        // Nothing was rescanned: forget the id (unless a newer event replaced it) so the next event does
        if (lastPanelNotebookId === recordedId) lastPanelNotebookId = '';
        refreshResumeBanner();
        await refreshHome(); // a switch by tab during this wait left its scan to the wait's end
        return;
      }
      refreshResumeBanner();
    }
    await rescanOpenPanelTab();
  } else if (panelView === 'home') {
    await (homeForce ? refreshHome({ force: true }) : refreshHomeFresh());
  } else if (isNotebookUrl(tab?.url) && openListShows('[data-needs-notebook]')) {
    await rescanOpenPanelTab();
  } else if (sameNotebookScan) {
    await rescanGeneratedIfOpen();
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
      setNotebookName(NLME.headerName(tab.url, name)); // the file-name fallback shows as "Notebook"
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

// A job ended. Scans are skipped during a job, so a list opened for the first time
// then still shows "Scanning...", and the notebook check may not have rescanned it.
async function afterJobChecks() {
  await runPendingNotebookCheck();
  if (panelView === 'home' || openListShows('.scanning')) await rescanOpenPanelTab();
}

// ---- Resume banner (Milestone 3c) ----
// Shown on Home when the active tab's notebook has a job record with items left and
// no job is running. Re-checked on panel open, on every tab event (refreshForTab)
// and when a job ends (runExclusive). A newer check supersedes an older one still
// waiting on storage. On a list the banner is out of sight: the Back button carries
// a dot (setResumeIndicator) rather than taking the person off the list they are on.
let resumeAnnouncedId = ''; // the record the person has been told about
function setResumeIndicator(on, recordId = '') {
  const dot = document.getElementById('back-resume-dot');
  const back = document.getElementById('back-btn');
  const notice = document.getElementById('resume-notice');
  if (!dot || !back || !notice) return;
  dot.hidden = !on;
  back.title = on ? 'Back to Home: an earlier export can be resumed' : 'Back to Home';
  if (on) back.setAttribute('aria-description', 'An earlier export can be resumed');
  else back.removeAttribute('aria-description');
  if (!on) {
    notice.textContent = '';
  } else if (recordId !== resumeAnnouncedId) {
    // Once per record: this runs on every tab event. On Home the card says it.
    resumeAnnouncedId = recordId;
    if (panelView !== 'home') notice.textContent = 'An earlier export can be resumed on Home.';
  }
}

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

// A full page load reports its URL at once and `complete` much later, or never. Until
// then the panel still shows the old notebook, so its Export everything and list
// action stay off: the hold is one more settle wait, plus the action. Every way out
// runs a refresh of its own: `complete`, the tab going back to the panel's notebook
// (releasePageLoad), another tab, a notebook switch (resetChatPanel), or a stall.
const PAGE_LOAD_HOLD_MS = 15000;
const TAB_MOVING_MESSAGE = 'This tab is moving to another notebook. Wait for it to open, then try again.';
let pageLoadHold = null;

function holdForPageLoad() {
  releasePageLoad();
  const hold = { timer: setTimeout(() => endStalledPageLoad(hold), PAGE_LOAD_HOLD_MS) };
  pageLoadHold = hold;
  settleWaits++;
  syncHomeControls();
  applyAction();
}

function releasePageLoad() {
  if (!pageLoadHold) return;
  clearTimeout(pageLoadHold.timer);
  pageLoadHold = null;
  settleWaits--;
  syncHomeControls();
  applyAction();
}

// No `complete` came: go by the URL, so the panel names what the tab shows
async function endStalledPageLoad(hold) {
  if (pageLoadHold !== hold) return;
  releasePageLoad();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await refreshForTab(tab, { settleMs: PAGE_SETTLE_MS });
  } catch (error) {
    console.warn('[NotebookLM Takeout] Refresh after a stalled load failed:', error);
  }
}

// The active tab reported a new URL. Synchronous: the sheet must not outlive this event.
// Off the notebook (another site, the notebook list) the dialogs close too, as on a
// switch: a Delete asked about this notebook must not reach the page it comes back to.
function notePageMove({ url, status }) {
  if (!isNotebookUrl(url) || !NLME.tabLeftPanelNotebook(url, lastPanelNotebookId)) {
    releasePageLoad();
    if (!NLME.notebookIdFromUrl(url)) closePanelDialogs();
    return;
  }
  closeExportSheet({ switched: true });
  closePanelDialogs();
  if (status === 'loading') holdForPageLoad();
}

// false, and says so, when the active tab shows another notebook than the panel: a
// start now would read one notebook under the other's name. For the moment an export
// begins, whatever the tab events have told the panel so far.
async function tabStillOnPanelNotebook() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isNotebookUrl(tab?.url) || !NLME.tabLeftPanelNotebook(tab.url, lastPanelNotebookId)) return true;
  showToast(TAB_MOVING_MESSAGE, 'warning');
  return false;
}

async function handleTabChange(activeInfo) {
  // onActivated fires for every window; this panel belongs to one
  let active = null;
  try { [active] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (_) { /* judged below */ }
  if (active?.id !== activeInfo.tabId) return;
  releasePageLoad(); // the load it waited for is in a tab left behind
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
    if (changeInfo.url) notePageMove(changeInfo);
    if (changeInfo.status === 'complete') {
      await checkStatus();
      _homeZeroConfirmed.clear(); // an empty list read while loading proves nothing
      // A new notebook's page reports complete before it has drawn its lists
      const id = isNotebookUrl(tab?.url) ? NLME.notebookIdFromUrl(tab.url) : '';
      const moved = !!id && id !== lastPanelNotebookId;
      if (!moved) releasePageLoad(); // before the refresh, which a hold would turn away
      const refreshed = refreshForTab(tab, moved ? { settleMs: PAGE_SETTLE_MS } : {});
      releasePageLoad(); // a switch took the hold over; a job puts the switch off
      await refreshed;
    } else if (changeInfo.url && !changeInfo.status) {
      // In-app navigation (history API): a URL change with no status. A full
      // load reports {status: 'loading', url} first and is handled by 'complete'.
      await checkStatus();
      await refreshForTab(tab, { settleMs: PAGE_SETTLE_MS, sameNotebookScan: false });
    } else if (changeInfo.url) {
      await checkStatus();
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
      // The menu will not change by waiting: no retries for a missing format,
      // nor for a pick refused for a shared title (only a rescan finds it)
      if (error && (error.formatNotOffered || NLME.isSameTitleRefusal(error))) throw error;
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

// #status is a live region and checkStatus runs on every tab event: same text, no news
function setStatusText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

async function checkStatus() {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('status-text');
  const openLink = document.getElementById('open-notebook-link');
  const showOpenLink = (show) => { if (openLink) openLink.hidden = !show; };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
    homeOnSite = isNotebookUrl(tab?.url);
    homeNotebookOpen = homeOnSite && !!NLME.notebookIdFromUrl(tab.url);

    if (isNotebookUrl(tab?.url)) {
      statusDot.classList.remove('inactive');
      statusDot.classList.add('active');
      setStatusText(statusText, 'Connected');
      statusText.title = 'Connected to Gemini Notebook';
      showOpenLink(false);
    } else {
      statusDot.classList.remove('active');
      statusDot.classList.add('inactive');
      setStatusText(statusText, 'Not connected');
      statusText.title = 'Not on Gemini Notebook';
      showOpenLink(true);
    }
  } catch (error) {
    statusDot.classList.remove('active');
    statusDot.classList.add('inactive');
    setStatusText(statusText, 'Unknown');
    statusText.title = 'Unable to check status';
    showOpenLink(false);
    homeOnSite = false;
    homeNotebookOpen = false;
  }
  syncHomeControls();
}
// ==================== STATUS CHECK ====================


// A scan the page answered with an error message (SCAN_SOURCES, SCAN_CHAT);
// the tab scans show that message as is
class ScanError extends Error {}

// ---- The shared action bar (one button under the open tab's list) ----
// A tab publishes its action with setTabAction(tab, ...); only the open tab's
// action is shown, and switching tabs or notebooks swaps or clears it, so an
// action never runs against another tab's list.
let _action = null;
const _tabActions = {};
// What each tab shows before its list has loaded; tabs not listed have no bar
const TAB_ACTION_IDLE = {
  sources: { label: NLME.actionLabel(0, 'source') },
  notes: { label: NLME.actionLabel(0, 'note') },
  studio: { label: NLME.actionLabel(0, 'item') },
  chat: { label: 'Load chat to export' }
};

// Show the action (or hide the bar for null). Disabled while a job runs.
function setAction(action) {
  _action = action || null;
  applyAction();
}

function applyAction() {
  const bar = document.getElementById('action-bar');
  const btn = document.getElementById('action-btn');
  if (!bar || !btn) return;
  bar.hidden = !_action;
  if (!_action) return;
  btn.innerHTML = `${icon('download')} ${NLME.escapeHtml(_action.label)}`;
  btn.disabled = !!_action.disabled || !!jobLock.current() || !!pageLoadHold;
  btn.style.opacity = btn.disabled ? '0.5' : '1';
}

// The tab's own action; shown now only when that tab is open
function setTabAction(tab, action) {
  _tabActions[tab] = action;
  if (openPanelTab() === tab) setAction(action);
}

// Not loaded yet (or being scanned): the tab's idle label, disabled
function idleTabAction(tab) {
  setTabAction(tab, { ...TAB_ACTION_IDLE[tab], disabled: true });
}

function applyOpenTabAction() {
  updateStudioBulkButtonsState(); // Generated's Delete shows with its tab only
  const tab = openPanelTab();
  setAction(_tabActions[tab] || (TAB_ACTION_IDLE[tab] ? { ...TAB_ACTION_IDLE[tab], disabled: true } : null));
}

// The number of items found, on the tab's label and its Home row; null omits it
// from the label and shows as not known yet on Home. The one place a count is set,
// so the two can never disagree. Items found end a list's proof of being empty.
const _tabCounts = {};
function setTabCount(tab, count) {
  _tabCounts[tab] = count ?? null;
  if (count > 0) _homeZeroConfirmed.delete(tab);
  const el = document.querySelector(`.tab-btn[data-tab="${tab}"] .tab-count`);
  if (el) {
    el.textContent = count == null ? '' : Number(count).toLocaleString('en-US');
    el.title = el.textContent; // a narrow panel drops the count from the label
    el.hidden = count == null;
  }
  paintHomeRow(tab);
}

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
      quoteOf: entry => (entry.missing || !entry.quote ? '' : (settings.cleanOCRArtifacts ? cleanOCRArtifacts(entry.quote) : NLME.stripControlChars(entry.quote)))
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
        const cleanedQuote = settings.cleanOCRArtifacts ? cleanOCRArtifacts(entry.quote) : NLME.stripControlChars(entry.quote);
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
    .filter(el => {
      const tex = el.closest('[data-math]')?.getAttribute('data-math');
      return !NLME.isPriceRangeFragment(tex) && !NLME.isProseMath(tex);
    }).length;
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

// Converts and counts formulas: .katex on the page vs the formulas the
// converter wrote into its final text (NLMEMarkdown.formulasWritten; each
// once, however often a nested list or table converts its content). Not a
// regex over the Markdown, which takes "$1 micron (μm): 10-6 m$1" for a
// price. convert must be synchronous.
function convertCounted(audit, html, convert, page = null) {
  const counts = page || countPageContent(html);
  const before = NLMEMarkdown.formulasWritten();
  const markdown = convert();
  if (markdown && typeof markdown.then === 'function') {
    throw new Error('convertCounted: convert must be synchronous (the formula count reads a running total)');
  }
  audit.expected.formulas += counts.formulas;
  audit.written.formulas += NLMEMarkdown.formulasWritten() - before;
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
  syncExportSheet();
  hideResumeBanner(); // its numbers go stale while a job writes the record
  // Disable (not just dim) the tab controls so keyboard activation is
  // blocked too. Mark them: a scan may replace a control with a clone (the
  // chat Export button), and the clone must be re-enabled too, so restore
  // by the mark, not by the original element.
  Array.from(document.querySelectorAll('.tab-content button, .tab-content input, .tab-content select, #action-btn, #studio-delete-selected-btn, #full-takeout-btn'))
    .filter(el => !el.disabled && el.id !== 'cancel-download-btn')
    .forEach(el => { el.disabled = true; el.setAttribute('data-job-disabled', ''); });
  try {
    // Storage may be back: a job should not run on defaults when it need not
    if (!settingsStored && !await retrySettingsLoad()) showToast(SETTINGS_UNREAD_MESSAGE, 'warning');
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
    afterJobChecks().catch(e => console.warn('[NotebookLM Takeout] Notebook check failed:', e));
  }
}

// false, and says so, when a row must not start: the tab has moved to another notebook,
// or is loading one. Tab events can lag behind the tab, so this looks at the tab.
async function rowMayStart() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!NLME.rowRefused({ url: tab?.url, panelNotebookId: lastPanelNotebookId, held: !!pageLoadHold })) return true;
  showToast(TAB_MOVING_MESSAGE, 'warning');
  return false;
}

// A row's download, on the default preset: no sheet. Checks inside the lock, where
// the tab it reads is the one the job gets.
function runRowExport(name, fn) {
  return runExclusive(name, async () => {
    if (await rowMayStart()) return withRunSettings(NLME.runOverrides(settings), fn);
  });
}

// false, and says so, when the Retry of the results showing would run on another
// notebook. The run's notebook comes from its export shell (dockRun): a Retry's
// items and tab id belong to it, whatever the panel shows now.
async function retryMayStart() {
  if (!dockRun) return true;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let runTab = null;
  try { runTab = await chrome.tabs.get(dockRun.tabId); } catch (_) { /* closed: the shell says so */ }
  if (!NLME.retryRefused({ notebookId: dockRun.id, activeUrl: active?.url, runTabUrl: runTab?.url })) return true;
  showToast('Open the notebook this export ran on to retry it', 'warning');
  return false;
}

// The results' "Retry N failed": re-runs `exportFn` on the items that
// failed, under the job lock (a busy lock only shows its toast; the panel
// stays). null when nothing failed. It keeps the job's run settings.
function retryFor(failedItems, jobName, exportFn) {
  if (!failedItems || failedItems.length === 0) return null;
  const rerun = rememberRunSettings();
  return {
    count: failedItems.length,
    run: () => runExclusive(jobName, () => rerun(() => exportFn(failedItems)))
  };
}

// Buttons that follow a list's selection (disabled at K = 0): re-derive them from the
// controllers, whatever just enabled or disabled them (a job ending, a redraw)
function refreshListButtons() {
  applyAction();
  updateStudioBulkButtonsState();
  syncHomeControls(); // the job's end enabled Export everything; off a notebook it stays off
}

// The Retry / Resume chain (sidebar-takeout.js: runChain) is running under the job
// lock. requestCancel sets chainCancelRequested; the chain checks it before each step.
let chainActive = false;
let chainCancelRequested = false;
// From Start in the export sheet (sheetStarting) the progress view and its Cancel are
// up before the export's shell listens: a Cancel then is noted here, and the shell
// reads it before it begins (startCancelled). startExportSheet sets and clears both.
let sheetStarting = false;
let startCancelRequested = false;

// Same path as the page overlay's Cancel button: the content script flags the
// export as cancelled and broadcasts CANCEL_EXPORT to every running exporter.
// Target tab: activeShellTabId (sidebar-takeout.js, the running shell's tab),
// else jobTabId (the active tab when the job started), else the current tab.
async function requestCancel() {
  if (sheetStarting && activeShellTabId === null) startCancelRequested = true;
  if (!jobLock.current()) return;
  // A Retry / Resume chain has moments with no shell (between two steps): note the
  // cancel on the chain so it does not start the next step
  if (chainActive) chainCancelRequested = true;
  try {
    // The export shell's tab first: retries and the action bar's exports run on the tab
    // they were scanned on, which need not be the active one. The content script
    // there broadcasts CANCEL_EXPORT, which the shell's own listener also receives.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = activeShellTabId ?? jobTabId ?? currentTabId ?? tab?.id;
    await chrome.tabs.sendMessage(target, { type: NLME.MSG.REQUEST_EXPORT_CANCEL });
    stopProgressTick(); // the page has the cancel: the time left means nothing now
  } catch (error) {
    console.warn('[NotebookLM Takeout] Cancel request failed:', error.message);
  }
}

// The Studio list is not in the page while one of its items is open, so a scan
// would show nothing or only part of it
// Sources and Notes on another site; refreshForTab rescans a list showing it
const NOTEBOOK_PROMPT_HTML = '<p class="empty-message" data-needs-notebook>Open a notebook first.</p>';
const STUDIO_ITEM_OPEN_HTML = '<p class="empty-message">An item is open in Studio, which hides this list.<br><span class="hint">Close it, then click Refresh.</span></p>';
// Home's one line, by NLME.homeNotice
const HOME_NOTICE_HTML = {
  'open-site': NOTEBOOK_PROMPT_HTML,
  'open-notebook': '<p class="empty-message" data-needs-notebook>Open a notebook</p>',
  'item-open': STUDIO_ITEM_OPEN_HTML,
  'read-failed': '<p class="empty-message">Could not read a count. Click Refresh.</p>'
};

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
 * Send one item's failed images to the job, one summary per item. With
 * deferTo they wait on that item for the last try before its package is
 * written (retryMissingImages), which reports what is still missing.
 *
 * @param {Array<{url: string, reason: string}>} [failures]
 * @param {string} item the note, source or message they belong to
 * @param {Function} warn receives each NLME.summarizeImageFailures entry
 * @param {Function} [jobWarn] receives the job-wide summary of skipped images
 * @param {{ deferTo?: object }} [options] deferTo: the exported item (source, note, message)
 */
function reportImageFailures(failures, item, warn, jobWarn = warn, { deferTo = null } = {}) {
  const failed = (failures || []).filter(f => !f.skipped && !f.cancelled);
  if (deferTo) deferImageFailures(deferTo, failed, item, warn);
  else NLME.summarizeImageFailures(failed.map(f => ({ ...f, item }))).forEach(warn);
  imageSession?.reportSkipped(jobWarn);
}

// Keep an item's failed images for the last try: _imageFailures is
// { label, warn, failures: [{ url, reason }] }, non-enumerable so it never
// reaches a file, the manifest or a copy of the item.
function deferImageFailures(target, failures, label, warn) {
  if (!failures.length) return;
  const kept = failures.map(({ url, reason }) => ({ url, reason }));
  const earlier = target._imageFailures;
  Object.defineProperty(target, '_imageFailures', {
    value: { label, warn, failures: earlier ? [...earlier.failures, ...kept] : kept },
    configurable: true, writable: true, enumerable: false
  });
}

// What the last try got for a note or chat message: its files are built later
// from imageEmbeds (NLME.embedImagesForVersion)
function addRetriedEmbeds(item, got) {
  if (got.size) item.imageEmbeds = new Map([...(item.imageEmbeds || []), ...got]);
}

/**
 * The last try before a package is written (runExportJob's beforePackage):
 * the images that failed in this batch's items, once more after a cool-down
 * (imageSession.finalTry). apply(item, got) puts what came back into the item;
 * what is still missing is reported, one summary per item, through the warn
 * the item was extracted with.
 *
 * @param {object[]} items the batch's results
 * @param {{ progress?: Function, isCancelled?: Function, apply?: Function }} [options]
 */
async function retryMissingImages(items, { progress = null, isCancelled = () => false, apply = addRetriedEmbeds } = {}) {
  const pending = (items || []).filter(item => item && item._imageFailures);
  if (pending.length === 0) return;
  const entries = pending.flatMap(item => item._imageFailures.failures
    .filter(failure => failure.url)
    .map(failure => ({ item, url: failure.url, reason: failure.reason })));
  const count = new Set(entries.map(entry => entry.url)).size;
  let fetched = new Map();
  let still = entries;
  if (count > 0 && imageSession) {
    try {
      if (progress && !isCancelled()) progress(`Trying ${count} missing image${count === 1 ? '' : 's'} again…`);
      ({ fetched, still } = await imageSession.finalTry(entries, { cooldownMs: NLME.IMAGE_FINAL_COOLDOWN_MS, isCancelled }));
    } catch (error) {
      // The last try never fails an item or a package: the images stay links
      console.warn('[Takeout] Last try for missing images failed:', error);
      fetched = new Map();
      still = entries;
    }
  }
  for (const item of pending) {
    const { label, warn, failures } = item._imageFailures;
    delete item._imageFailures;
    const got = new Map(failures.filter(f => fetched.has(f.url)).map(f => [f.url, fetched.get(f.url)]));
    let left = [...failures.filter(f => !f.url), ...still.filter(entry => entry.item === item)];
    try {
      apply(item, got);
    } catch (error) {
      // Whatever could not be put into the item stays a link, and is reported
      console.warn('[Takeout] Could not add retried images:', error);
      // On purpose: report all of the item's failures (safe over-report)
      left = failures;
    } finally {
      reportImageFailures(left.map(({ url, reason }) => ({ url, reason })), label, warn);
    }
  }
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
 * @param {{ update?: boolean, zip?: boolean }} [options] zip: the run's save choice,
 *   kept in a new record for a Resume. update: a retry or resume (also taken
 *   by a fresh export when the notebook's stored record is another kind's with
 *   items left, NLME.jobRecordMode). It never
 *   creates or replaces a record: it loads the notebook's existing one (none:
 *   returns null) and marks its items done or failed on it, only for keys the
 *   record holds, and writes nothing until one changes.
 */
async function startJobRecord(shell, kind, label, itemsByCategory, { update = false, zip } = {}) {
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
      record = NLME.newJobRecord({ id: `${kind}-${now}`, kind, label, notebookId, keysByCategory, now, overrides: currentRunOverrides, zip });
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
async function withJobRecord(shell, kind, label, category, items, run, { update = false, record = true, zip } = {}) {
  // record false: a one-shot row export (a single source's download) must not
  // replace or clear a pending record
  const tracker = record ? await startJobRecord(shell, kind, label, { [category]: items }, { update, zip }) : null;
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
 * It also passes itemDir '' (note and source files go straight in the category
 * folder, not in a notes/ or sources/ folder inside it). variantSettings: the
 * settings the notes, sources and chat paths read their variants from, default
 * the global `settings`, which in a Full Takeout are the run's (withRunSettings).
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

// One toast at a time, at the foot of the panel. Success and info leave after
// 2.5 s; a warning or an error stays 6 s, can be closed, and is announced at
// once. The timer waits while the pointer or focus is on the toast.
const TOAST_ICONS = { success: 'check', info: 'info', warning: 'alert', error: 'alert' };
let _toastTimer = null;
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  clearTimeout(_toastTimer);

  const urgent = type === 'error' || type === 'warning';
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', urgent ? 'alert' : 'status');
  toast.innerHTML = icon(TOAST_ICONS[type] || 'info'); // a fixed SVG, no message text
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  let left = urgent ? 6000 : 2500;
  let startedAt = 0;
  let hovered = false;
  let focused = false;
  const dismiss = () => {
    clearTimeout(_toastTimer);
    if (!toast.isConnected) return;
    toast.classList.add('toast-hide');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => toast.remove(), reduced ? 0 : 160);
  };
  const run = () => {
    startedAt = Date.now();
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(dismiss, left);
  };
  const pause = () => {
    if (!toast.isConnected) return;
    clearTimeout(_toastTimer);
    left = Math.max(800, left - (Date.now() - startedAt));
  };
  const resume = () => { if (!hovered && !focused && toast.isConnected) run(); };
  toast.addEventListener('mouseenter', () => { hovered = true; pause(); });
  toast.addEventListener('mouseleave', () => { hovered = false; resume(); });
  toast.addEventListener('focusin', () => { focused = true; pause(); });
  toast.addEventListener('focusout', () => { focused = false; resume(); });

  if (urgent) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = icon('close');
    close.addEventListener('click', dismiss);
    toast.appendChild(close);
  }

  document.body.appendChild(toast);
  run();
}

function escapeHtml(text) {
  return NLME.escapeHtml(text);
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});
