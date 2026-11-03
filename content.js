// NotebookLM Takeout - Content Script

(function() {
  'use strict';

  console.log('[NotebookLM Takeout] Content script loaded');


  // Google renamed NotebookLM to "Gemini Notebook" and moved it from
  // notebooklm.google.com to notebook.google.com (Jul 2026). The old host 301s to
  // the new one; keep both so users mid-rollout still work.

  function isNotebookUrl(url) {
    return NLME.isNotebookUrl(url);
  }


  // DOM Health Tracker - Monitors selector failures to detect UI changes
  const DOMHealthTracker = {
    errors: [],
    selectorFailures: {},
    stuckOperations: [],

    track(type, selector, context) {
      this.errors.push({ type, selector, context, timestamp: Date.now() });
      if (selector) {
        this.selectorFailures[selector] = (this.selectorFailures[selector] || 0) + 1;
      }
      if (type === 'stuck') {
        this.stuckOperations.push(context);
      }
      console.log(`[NotebookLM Takeout] DOM issue tracked: ${type}`, { selector, context });
    },

    shouldWarn() {
      const criticalSelectors = [
        'artifact-library-note',
        '.single-source-container',
        'button[aria-label="Close note view"]'
      ];
      return this.errors.some(e => criticalSelectors.includes(e.selector)) ||
             Object.values(this.selectorFailures).some(count => count >= 3) ||
             this.stuckOperations.length >= 2;
    },

    getIssues() {
      const issues = [];
      for (const [selector, count] of Object.entries(this.selectorFailures)) {
        if (count >= 2) issues.push(`"${selector}" not found (${count}x)`);
      }
      if (this.stuckOperations.length > 0) {
        issues.push(`${this.stuckOperations.length} operation(s) couldn't complete`);
      }
      return issues;
    },

    reset() {
      this.errors = [];
      this.selectorFailures = {};
      this.stuckOperations = [];
    }
  };

  // Inject the page script for deeper access
  // injected.js now runs as a MAIN-world content script (manifest), armed per
  // click; it is no longer injected as a <script> tag (Milestone 1).

  // Listen for messages from injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.type && event.data.type.startsWith('NLME_')) {
      handleInjectedMessage(event.data);
    }
  });

  // ==================== EXPORT OVERLAY ====================

  let exportOverlay = null;
  let exportCancelled = false;
  let includeCitationImages = false; // Global setting for including images in citations
  let citationDetailMode = 'quotes';   // 'quotes' (hover each marker) | 'titles' (no hovering; also used for 'none')
  let reuseCitations = false;          // Milestone 3c: reuse cached citation quotes from earlier exports (quotes mode, no images)

  function createExportOverlay() {
    if (exportOverlay) return exportOverlay;

    // Create overlay container
    exportOverlay = document.createElement('div');
    exportOverlay.id = 'notebooklm-export-overlay';
    exportOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Google Sans', Arial, sans-serif;
    `;

    // Create content box
    const contentBox = document.createElement('div');
    contentBox.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    // Create title
    const title = document.createElement('h2');
    title.textContent = 'Exporting...';
    title.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 24px;
      font-weight: 500;
      color: #202124;
    `;

    // Create progress text
    const progressText = document.createElement('p');
    progressText.id = 'export-progress-text';
    progressText.textContent = 'Preparing export...';
    progressText.style.cssText = `
      margin: 0 0 24px 0;
      font-size: 14px;
      color: #5f6368;
    `;

    // Create progress bar
    const progressBarContainer = document.createElement('div');
    progressBarContainer.style.cssText = `
      width: 100%;
      height: 4px;
      background: #e8eaed;
      border-radius: 2px;
      margin-bottom: 24px;
      overflow: hidden;
    `;

    const progressBar = document.createElement('div');
    progressBar.id = 'export-progress-bar';
    progressBar.style.cssText = `
      height: 100%;
      width: 0%;
      background: #1a73e8;
      border-radius: 2px;
      transition: width 0.3s ease;
    `;
    progressBarContainer.appendChild(progressBar);

    // Create cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel Export';
    cancelButton.style.cssText = `
      background: transparent;
      border: 1px solid #dadce0;
      border-radius: 8px;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 500;
      color: #1a73e8;
      cursor: pointer;
      transition: background 0.2s;
    `;
    cancelButton.onmouseover = () => {
      cancelButton.style.background = '#f8f9fa';
    };
    cancelButton.onmouseout = () => {
      cancelButton.style.background = 'transparent';
    };
    cancelButton.onclick = () => {
      exportCancelled = true;
      chrome.runtime.sendMessage({ type: 'CANCEL_EXPORT' });
      removeExportOverlay();
    };

    // Assemble
    contentBox.appendChild(title);
    contentBox.appendChild(progressText);
    contentBox.appendChild(progressBarContainer);
    contentBox.appendChild(cancelButton);
    exportOverlay.appendChild(contentBox);

    return exportOverlay;
  }

  function showExportOverlay(message = 'Preparing export...') {
    exportCancelled = false;
    const overlay = createExportOverlay();
    const progressText = overlay.querySelector('#export-progress-text');
    const progressBar = overlay.querySelector('#export-progress-bar');

    if (progressText) progressText.textContent = message;
    if (progressBar) progressBar.style.width = '0%';

    if (!overlay.parentNode) {
      document.body.appendChild(overlay);
    }
  }

  function updateExportOverlay(message, progress) {
    if (!exportOverlay) return;

    const progressText = exportOverlay.querySelector('#export-progress-text');
    const progressBar = exportOverlay.querySelector('#export-progress-bar');

    if (progressText) progressText.textContent = message;
    if (progressBar) progressBar.style.width = `${progress}%`;
  }

  function removeExportOverlay() {
    if (exportOverlay && exportOverlay.parentNode) {
      exportOverlay.parentNode.removeChild(exportOverlay);
    }
    exportOverlay = null;
  }

  // Per-request phase timing (Task 2): reset per EXTRACT_* request, returned
  // to the sidebar as `timing` and merged into the export's statistics.
  let requestTimer = NLME.createPhaseTimer();
  function withRequestTiming(run) {
    requestTimer = NLME.createPhaseTimer();
    return run().then(result => (result && typeof result === 'object'
      ? { ...result, timing: requestTimer.totals() }
      : result));
  }
  async function timePhase(phase, fn) {
    requestTimer.start(phase);
    try {
      return await fn();
    } finally {
      requestTimer.end(phase);
    }
  }

  // Condition waits instead of fixed sleeps (Milestone 1, Speed): resolve once
  // the measured size stops changing; on timeout continue with what is there.
  async function waitForStable(measure, { interval = 50, checks = 2, minLength = 1, timeout = 5000 } = {}) {
    const tracker = NLME.createStabilityTracker({ checks, minLength });
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (tracker.push(measure())) return true;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    console.warn('[NotebookLM Takeout] Content did not settle within', timeout, 'ms; continuing');
    return false;
  }

  function isExportCancelled() {
    return exportCancelled;
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[NotebookLM Takeout] Received message:', message.type);

    if (message.type === 'PING') {
      // Simple ping to check if content script is loaded
      sendResponse({ success: true });
    } else if (message.type === 'GET_PROJECT_NAME') {
      // Extract project name from the page
      try {
        // Look for the project title in the header
        // One chain for file names, chat export and the health check
        const titleSelectors = NLME.PROJECT_TITLE_SELECTORS;

        let projectName = null;
        for (const selector of titleSelectors) {
          const titleElement = document.querySelector(selector);
          if (titleElement && titleElement.textContent.trim()) {
            projectName = titleElement.textContent.trim();
            console.log('[NotebookLM Takeout] Found project name:', projectName);
            break;
          }
        }

        sendResponse({ projectName: projectName || 'NotebookLM' });
      } catch (error) {
        console.error('[NotebookLM Takeout] Error extracting project name:', error);
        sendResponse({ projectName: 'NotebookLM' });
      }
    } else if (message.type === 'FETCH_FILE') {
      // Fetch file with page credentials - used by batch download
      fetchFileWithCredentials(message.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async
    } else if (message.type === 'REQUEST_EXPORT_CANCEL') {
      // Side panel Cancel button: same effect as the overlay's Cancel
      exportCancelled = true;
      chrome.runtime.sendMessage({ type: 'CANCEL_EXPORT' }).catch(() => {});
      removeExportOverlay();
      sendResponse({ success: true });
    } else if (message.type === 'EXTRACT_NOTE') {
      // Extract note content
      // 'titles' and 'none' both skip hovering ('none' drops the markers later)
      citationDetailMode = ['titles', 'none'].includes(message.data.citationDetail) ? 'titles' : 'quotes';
      reuseCitations = message.data.reuseCitations === true;
      withRequestTiming(() => (typeof message.data.sourceIndex === 'number'
        ? extractSourcesPanelNote(message.data.sourceIndex, message.data.noteTitle, message.data.includeCitationImages)
        : extractNoteContent(message.data.noteIndex, message.data.noteTitle, message.data.includeCitationImages)))
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message || 'Extraction failed' }));
      return true; // Keep channel open for async
    } else if (message.type === 'SCAN_NOTES') {
      // Scan for notes
      const notes = scanForNotes();
      sendResponse({ notes });
    } else if (message.type === 'SCAN_SOURCES') {
      // Scan for sources
      scanForSources()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    } else if (message.type === 'EXTRACT_SOURCE') {
      // Extract source content
      withRequestTiming(() => extractSourceContent(message.data.sourceIndex, message.data.title || '', message.data.needsGuide !== false))
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    } else if (message.type === 'NAVIGATE_BACK') {
      // Navigate back to notes list
      navigateBackToNotesList()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async
    } else if (message.type === 'SHOW_EXPORT_OVERLAY') {
      showExportOverlay(message.message || 'Preparing export...');
      sendResponse({ success: true });
      return true;
    } else if (message.type === 'UPDATE_EXPORT_OVERLAY') {
      updateExportOverlay(message.message, message.progress || 0);
      sendResponse({ success: true });
      return true;
    } else if (message.type === 'HIDE_EXPORT_OVERLAY') {
      removeExportOverlay();
      sendResponse({ success: true });
      return true;
    } else if (message.type === 'DOWNLOAD_ARTIFACT') {
      // Download artifact via message passing (new pattern)
      handleArtifactDownload(
        message.data.artifactIndex,
        message.data.artifactType,
        message.data.skipMoreButton || false,
        message.data.artifactName || null,
        message.data.downloadPreference || 'pdf'
      )
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message || 'Download failed' }));
      return true; // Keep channel open for async
    } else if (message.type === 'SCAN_CHAT') {
      // Scan chat messages
      scanChat()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;
    } else if (message.type === 'EXTRACT_MESSAGE_CITATIONS') {
      // Extract citations for a specific message
      console.log('[NotebookLM Takeout] ====== EXTRACT_MESSAGE_CITATIONS message received ======');
      console.log('[NotebookLM Takeout] Message index:', message.data.messageIndex);
      console.log('[NotebookLM Takeout] Source indices:', message.data.sourceIndices);
      console.log('[NotebookLM Takeout] Message HTML length:', message.data.messageHTML?.length || 0);
      console.log('[NotebookLM Takeout] Include citation images:', message.data.includeCitationImages);

      try {
        withRequestTiming(() => extractMessageCitations(
          message.data.messageIndex,
          message.data.messageHTML,
          message.data.sourceIndices,
          message.data.includeCitationImages || false
        ))
          .then(result => {
            console.log('[NotebookLM Takeout] ====== Message citations extracted ======');
            console.log('[NotebookLM Takeout] Result:', result);
            sendResponse(result);
          })
          .catch(error => {
            console.error('[NotebookLM Takeout] ====== Message citations extraction error ======', error);
            console.error('[NotebookLM Takeout] Error stack:', error.stack);
            sendResponse({ sourcesByIndex: {}, errors: [error.message] });
          });
      } catch (error) {
        console.error('[NotebookLM Takeout] ====== Message citations extraction SYNC error ======', error);
        console.error('[NotebookLM Takeout] Error stack:', error.stack);
        sendResponse({ sourcesByIndex: {}, errors: [error.message] });
      }
      return true;
    } else if (message.type === 'CHECK_DOM_HEALTH') {
      // Pre-export health check (basic version - use RUN_COMPREHENSIVE_HEALTH_CHECK for full check)
      const type = message.data?.type || 'notes';
      const checks = {
        // Only the studio list container is required: a notebook with no
        // studio notes (or notes shown in the Sources panel) is not drift.
        notes: ['.artifact-library-container'],
        sources: ['.single-source-container', '.scroll-area-desktop'],
        artifacts: ['artifact-library-item'],
        chat: ['.chat-message-pair', '.from-user-container', '.to-user-container']
      };
      const issues = [];
      for (const selector of (checks[type] || [])) {
        if (!document.querySelector(selector)) {
          issues.push(`${selector} not found`);
        }
      }
      sendResponse({
        healthy: issues.length === 0,
        issues,
        trackerIssues: DOMHealthTracker.getIssues()
      });
    } else if (message.type === 'GET_DOM_ERRORS') {
      // Get current DOM error state
      sendResponse({
        shouldWarn: DOMHealthTracker.shouldWarn(),
        issues: DOMHealthTracker.getIssues()
      });
    } else if (message.type === 'RESET_DOM_TRACKER') {
      // Reset tracker at start of new export
      DOMHealthTracker.reset();
      sendResponse({ success: true });
    } else if (message.type === 'RUN_COMPREHENSIVE_HEALTH_CHECK') {
      // Comprehensive DOM health check for preflight validation
      runComprehensiveHealthCheck(message.options || {})
        .then(result => sendResponse(result))
        .catch(error => sendResponse({
          overallHealthy: false,
          error: error.message,
          categories: {},
          criticalFailures: [error.message],
          recommendations: ['Try refreshing the page and running the check again.'],
          duration: 0
        }));
      return true;
    } else if (message.type === 'SCAN_STUDIO_ITEMS') {
      // Unified Studio scan: artifacts + notes/mindmaps in DOM order.
      try {
        sendResponse({ items: scanStudioItems() });
      } catch (e) {
        sendResponse({ items: [], error: e.message });
      }
    } else if (message.type === 'DELETE_STUDIO_ITEM') {
      // Resolve by label plus combined index (row delete: the title at that index
      // must match the label, otherwise the delete is refused) or by label alone
      // (bulk delete). When a label is given there is no index-only fallback.
      deleteStudioItem(message.data || {})
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message || 'Delete failed' }));
      return true;
    } else if (message.type === 'DELETE_SOURCE_NOTE') {
      // A note in the Sources panel's "Notes" group (Milestone 3c)
      deleteSourceNote(message.data || {})
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message || 'Delete failed' }));
      return true;
    }

    return true;
  });

  // Fetch file with page credentials (for batch download)
  async function fetchFileWithCredentials(url) {
    try {
      console.log('[NotebookLM Takeout] Fetching with credentials:', url.substring(0, 80));

      const response = await fetch(url, {
        credentials: 'include',
        mode: 'cors'
      });

      if (!response.ok) {
        console.error('[NotebookLM Takeout] Fetch failed:', response.status);
        return { success: false, error: `HTTP ${response.status}` };
      }

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Convert to base64 in chunks to avoid call stack issues
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      const base64 = btoa(binary);

      console.log('[NotebookLM Takeout] Fetched successfully:', uint8Array.length, 'bytes, mime:', blob.type);

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

  // Store for intercepted download URLs (from window.open interception)
  // Intercepted download URLs with their page timestamps; an item accepts
  // only URLs captured at or after its own click (NLME.pickFreshIntercept).
  const interceptedDownloads = [];
  let downloadUrlResolvers = []; // { since, resolve } waiting for a fresh URL

  function handleInjectedMessage(data) {
    switch (data.type) {
      case 'NLME_DOWNLOAD_URL_INTERCEPTED': {
        const entry = { url: data.payload?.url, timestamp: data.payload?.timestamp || Date.now() };
        // The page can post anything; accept Gemini Notebook download hosts only
        if (!NLME.isAllowedDownloadUrl(entry.url)) {
          console.warn('[NotebookLM Takeout] Ignoring intercepted URL from an unexpected host');
          break;
        }
        console.log('[NotebookLM Takeout] Download URL intercepted:', entry.url?.substring(0, 100));
        interceptedDownloads.push(entry);
        if (interceptedDownloads.length > 10) interceptedDownloads.shift();
        downloadUrlResolvers = downloadUrlResolvers.filter(waiter => {
          if (entry.timestamp >= waiter.since) {
            waiter.resolve(entry.url);
            return false;
          }
          return true;
        });
        break;
      }
    }
  }

  /**
   * Wait for a download URL intercepted at or after `since` (with timeout).
   */
  function waitForInterceptedUrl(since, timeoutMs = 25000) {
    return new Promise((resolve) => {
      const already = NLME.pickFreshIntercept(interceptedDownloads, since);
      if (already) {
        resolve(already);
        return;
      }
      const waiter = { since, resolve: (url) => { clearTimeout(timer); resolve(url); } };
      const timer = setTimeout(() => {
        downloadUrlResolvers = downloadUrlResolvers.filter(w => w !== waiter);
        resolve(null);
      }, timeoutMs);
      downloadUrlResolvers.push(waiter);
    });
  }

  // Initialize
  function init() {
    // The download hook (injected.js) runs as a MAIN-world content script.
    // The old MutationObserver/5 s artifact polling was removed (Nov 2026).
    console.log('[NotebookLM Takeout] Ready');
  }

  // ==================== NOTE EXTRACTION ====================

  // Scan for notes in the page
  function scanForNotes() {
    console.log('[NotebookLM Takeout] Scanning for notes...');

    const notes = [];
    let allNoteElements = document.querySelectorAll('artifact-library-note');

    console.log(`[NotebookLM Takeout] Found ${allNoteElements.length} artifact-library-note elements`);

    // Fallback: If direct selector fails, try via parent container
    if (allNoteElements.length === 0) {
      console.log('[NotebookLM Takeout] Trying fallback selectors...');
      const container = document.querySelector('.artifact-library-container artifact-library');
      if (container) {
        allNoteElements = container.querySelectorAll('artifact-library-note');
        console.log(`[NotebookLM Takeout] Via container: Found ${allNoteElements.length} notes`);
      }
    }

    // Second fallback: Find via icon content
    if (allNoteElements.length === 0) {
      console.log('[NotebookLM Takeout] Trying icon-based fallback...');
      const noteIcons = document.querySelectorAll('mat-icon.artifact-icon');
      const noteParents = [];
      noteIcons.forEach(icon => {
        const iconText = icon.textContent.trim();
        // Notes use article (Nov 2026) / sticky_note_2; legacy mindmaps use flowchart
        if (NLME.NOTE_ICONS.includes(iconText) || iconText === 'flowchart') {
          const noteEl = icon.closest('artifact-library-note');
          if (noteEl && !noteParents.includes(noteEl)) {
            noteParents.push(noteEl);
          }
        }
      });
      if (noteParents.length > 0) {
        allNoteElements = noteParents;
        console.log(`[NotebookLM Takeout] Via icon search: Found ${allNoteElements.length} notes`);
      }
    }

    // Scan artifact-library-note elements (regular notes and mindmaps only)
    allNoteElements.forEach((noteEl, idx) => {
      const titleEl = noteEl.querySelector('.artifact-title, .note-title');
      const title = titleEl?.textContent?.trim() || `Note ${idx + 1}`;

      // Detect note type from mat-icon
      const iconEl = noteEl.querySelector('mat-icon.artifact-icon');
      const iconType = iconEl?.textContent?.trim() || 'description';

      // Map icon types to readable labels
      let noteType = 'Note';
      if (iconType === 'flowchart') {
        noteType = 'Mindmap';
      } else if (NLME.NOTE_ICONS.includes(iconType)) {
        noteType = 'Note';
      } else {
        // Unknown icon type - log it for debugging
        console.warn(`[NotebookLM Takeout] Unknown icon type "${iconType}" for note "${title}" - treating as Note`);
      }

      notes.push({
        index: idx,
        title: title,
        type: noteType,
        iconType: iconType,
        elementType: 'note'
      });

      console.log(`[NotebookLM Takeout] Note ${idx}: "${title}" (${noteType}, icon: ${iconType})`);
    });

    // Notes in the Sources panel's "Notes" group are not in the Studio list
    document.querySelectorAll('.single-source-container').forEach((container, sourceIndex) => {
      if (!isNoteSourceContainer(container)) return;
      notes.push({
        index: -1,
        sourceIndex,
        title: getSourceContainerTitle(container) || `Note ${notes.length + 1}`,
        type: 'Note (Sources panel)',
        iconType: container.querySelector('.source-item-source-icon')?.textContent?.trim() || '',
        elementType: 'source-note'
      });
    });

    return notes;
  }

  /**
   * Scan the sources panel for all uploaded source documents
   * Returns array of source objects with title and index
   */
  async function scanForSources() {
    console.log('[NotebookLM Takeout] Scanning for sources...');

    // Find all source containers
    const sourceContainers = document.querySelectorAll('.single-source-container');

    if (sourceContainers.length === 0) {
      console.log('[NotebookLM Takeout] No sources found');
      return { sources: [], skippedNotes: 0 };
    }

    const sources = [];

    let skippedNotes = 0;
    sourceContainers.forEach((container, index) => {
      if (isNoteSourceContainer(container)) {
        skippedNotes++;
        return;
      }
      // Get source title
      const titleEl = container.querySelector('.source-title');
      const title = titleEl?.textContent?.trim() || `Source ${index + 1}`;

      // Get source icon to determine type
      const iconEl = container.querySelector('.source-item-source-icon');
      const iconType = iconEl?.textContent?.trim() || 'document';

      // Only process if visible
      const rect = container.getBoundingClientRect();
      const style = window.getComputedStyle(container);
      const isVisible = rect.width > 0 && rect.height > 0 &&
                       style.display !== 'none' && style.visibility !== 'hidden';

      if (isVisible) {
        sources.push({
          title: title,
          index: index,
          type: iconType
        });

        console.log(`[NotebookLM Takeout] Found source: "${title}" (${iconType})`);
      }
    });

    console.log(`[NotebookLM Takeout] Total sources found: ${sources.length} (${skippedNotes} note(s) skipped)`);
    return { sources: sources, skippedNotes };
  }

  // Helper function to wait for an element
  // options.exclude: elements to ignore (e.g. viewers open before a click);
  // options.visible: only accept rendered elements. Used so a newly opened
  // viewer is never confused with one already in the DOM (Milestone 1).
  function waitForElement(selector, timeout = 5000, parent = document, options = {}) {
    let observer = null;
    let timeoutId = null;
    const { exclude = null, visible = false } = options;
    const find = () => {
      if (!exclude && !visible) return parent.querySelector(selector);
      return Array.from(parent.querySelectorAll(selector)).find(el =>
        (!exclude || !exclude.has(el)) && (!visible || el.getClientRects().length > 0)) || null;
    };

    const promise = new Promise((resolve, reject) => {
      const existingEl = find();
      if (existingEl) {
        resolve(existingEl);
        return;
      }

      observer = new MutationObserver((mutations, obs) => {
        const el = find();
        if (el) {
          obs.disconnect();
          if (timeoutId) clearTimeout(timeoutId);
          resolve(el);
        }
      });

      observer.observe(parent, {
        childList: true,
        subtree: true,
        attributes: visible
      });

      timeoutId = setTimeout(() => {
        if (observer) observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });

    // Attach cleanup function to promise for Promise.race
    promise._cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    return promise;
  }

  // ==================== COMPREHENSIVE HEALTH CHECK SYSTEM ====================

  /**
   * Check if an element is visible (has dimensions, not hidden)
   * @param {Element} el - Element to check
   * @returns {boolean}
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity) > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  /**
   * Check if an element is interactable (visible + not disabled)
   * @param {Element} el - Element to check
   * @returns {boolean}
   */
  function isElementInteractable(el) {
    if (!el || !isElementVisible(el)) return false;
    return !el.disabled && !el.hasAttribute('aria-disabled');
  }

  /**
   * Check health of Notes functionality
   * @returns {Object} - { healthy: boolean, checks: [...] }
   */
  function checkNotesHealth() {
    const checks = [];

    // Detect which view we're in: notes list vs note viewer
    const noteViewer = document.querySelector('studio-panel note-editor');
    const isViewingNote = !!noteViewer;

    if (isViewingNote) {
      // === NOTE VIEWER MODE ===
      checks.push({
        name: 'Note viewer detected',
        selector: 'studio-panel note-editor',
        passed: true,
        critical: false,
        note: 'Currently viewing a note (close to see notes list)'
      });

      // Check note title input
      const titleInput = noteViewer.querySelector('input.note-header__editable-title');
      const titleText = titleInput?.value?.trim();
      checks.push({
        name: 'Note title input',
        selector: 'input.note-header__editable-title',
        passed: !!titleInput,
        critical: true,
        note: titleText ? `Title: "${titleText.substring(0, 40)}${titleText.length > 40 ? '...' : ''}"` : 'Title input found'
      });

      // Check content viewer
      const contentViewer = noteViewer.querySelector('labs-tailwind-doc-viewer, rich-text-editor .ql-editor, rich-text-editor .ProseMirror');
      checks.push({
        name: 'Note content viewer',
        selector: 'labs-tailwind-doc-viewer | rich-text-editor .ql-editor | rich-text-editor .ProseMirror',
        passed: !!contentViewer,
        critical: true,
        note: contentViewer ? `Content viewer present (${contentViewer.tagName.toLowerCase()}${contentViewer.className ? '.' + contentViewer.className.split(' ')[0] : ''})` : 'Content viewer not found'
      });

      // Check close button
      const closeButton = document.querySelector('button[aria-label="Close note view"]');
      checks.push({
        name: 'Close button',
        selector: 'button[aria-label="Close note view"]',
        passed: !!closeButton && isElementInteractable(closeButton),
        critical: true,
        note: closeButton ? 'Close button found' : 'Close button missing'
      });

      // Citation markers must yield a number (markers changed shape in Nov 2026)
      const markers = Array.from(noteViewer.querySelectorAll('button.citation-marker'))
        .filter(btn => !btn.querySelector('mat-icon'));
      const parsedMarkers = markers.filter(btn => NLME.parseCitationIndex(btn.querySelector('span')?.textContent));
      checks.push({
        name: 'Citation markers parse',
        selector: 'button.citation-marker > span',
        passed: markers.length === 0 || parsedMarkers.length > 0,
        critical: true,
        count: parsedMarkers.length,
        note: markers.length === 0
          ? 'No citations in this note'
          : `${parsedMarkers.length}/${markers.length} marker(s) yield a citation number`
      });

      // Check for citations in note (non-critical)
      const citations = noteViewer.querySelectorAll('button.citation-marker');
      checks.push({
        name: 'Citation buttons in note',
        selector: 'button.citation-marker',
        passed: true, // informational
        count: citations.length,
        critical: false,
        note: citations.length > 0 ? `Found ${citations.length} citation(s)` : 'No citations in this note'
      });

    } else {
      // === NOTES LIST MODE ===
      // Check for notes container
      const container = document.querySelector('.artifact-library-container');
      checks.push({
        name: 'Notes container present',
        selector: '.artifact-library-container',
        passed: !!container,
        critical: true
      });

      // Check for note elements
      const noteElements = document.querySelectorAll('artifact-library-note');
      const hasNotes = noteElements.length > 0;
      checks.push({
        name: 'Note elements found',
        selector: 'artifact-library-note',
        passed: hasNotes,
        count: noteElements.length,
        critical: false, // Notebook might just be empty
        note: hasNotes ? `Found ${noteElements.length} note(s)` : 'No notes in notebook (may be empty)'
      });

      // Check note titles are readable
      if (hasNotes) {
        const firstNote = noteElements[0];
        const titleEl = firstNote.querySelector('.artifact-title');
        const titleText = titleEl?.textContent?.trim();
        checks.push({
          name: 'Note titles readable',
          selector: '.artifact-title',
          passed: !!titleText && titleText.length > 0,
          critical: true,
          note: titleText ? `Sample: "${titleText.substring(0, 40)}${titleText.length > 40 ? '...' : ''}"` : 'Title element empty or missing'
        });

        // Check click targets (stretched button)
        const clickTarget = firstNote.querySelector('button.artifact-stretched-button');
        checks.push({
          name: 'Note click targets exist',
          selector: 'button.artifact-stretched-button',
          passed: !!clickTarget && isElementInteractable(clickTarget),
          critical: true,
          note: clickTarget ? 'Stretched button found' : 'No clickable button found'
        });

        // Check note icon
        const noteIcon = firstNote.querySelector('mat-icon.artifact-icon');
        checks.push({
          name: 'Note type icons',
          selector: 'mat-icon.artifact-icon',
          passed: !!noteIcon,
          critical: false,
          note: noteIcon ? `Icon: ${noteIcon.textContent?.trim() || 'unknown'}` : 'No icon (cosmetic)'
        });
      }
    }

    const healthy = checks.filter(c => c.critical).every(c => c.passed);
    return { healthy, checks };
  }

  /**
   * Check health of Sources functionality
   * @returns {Object} - { healthy: boolean, checks: [...] }
   */
  function checkSourcesHealth() {
    const checks = [];

    // Check for sources scroll container
    const scrollArea = document.querySelector('.scroll-area-desktop, .source-list-container, source-list');
    checks.push({
      name: 'Source list container',
      selector: '.scroll-area-desktop, .source-list-container',
      passed: !!scrollArea,
      critical: true
    });

    // Check for individual source items. Notes in the Sources panel's "Notes"
    // group share the container class and are excluded (Nov 2026).
    const sourceItems = Array.from(document.querySelectorAll('.single-source-container'))
      .filter(container => !isNoteSourceContainer(container));
    const hasSources = sourceItems.length > 0;
    checks.push({
      name: 'Source items found',
      selector: '.single-source-container',
      passed: hasSources,
      count: sourceItems.length,
      critical: false, // Notebook might have no sources
      note: hasSources ? `Found ${sourceItems.length} source(s)` : 'No sources in notebook (may be empty)'
    });

    // Check source titles are readable
    if (hasSources) {
      const firstSource = sourceItems[0];
      // Primary: .source-title, fallback: button aria-label
      const titleEl = firstSource.querySelector('.source-title');
      const titleText = titleEl?.textContent?.trim();
      const buttonLabel = firstSource.querySelector('button.source-stretched-button')?.getAttribute('aria-label');
      const foundTitle = titleText || buttonLabel;
      checks.push({
        name: 'Source titles readable',
        selector: '.source-title, button[aria-label]',
        passed: !!foundTitle && foundTitle.length > 0,
        critical: true,
        note: foundTitle ? `Sample: "${foundTitle.substring(0, 40)}${foundTitle.length > 40 ? '...' : ''}"` : 'Title element empty or missing'
      });

      // Check source click targets (the stretched button)
      const clickTarget = firstSource.querySelector('button.source-stretched-button, button[aria-label]');
      checks.push({
        name: 'Source click targets exist',
        selector: 'button.source-stretched-button',
        passed: !!clickTarget && isElementInteractable(clickTarget),
        critical: true,
        note: clickTarget ? 'Stretched button found' : 'No clickable button found'
      });

      // Check source type icon
      const typeIcon = firstSource.querySelector('mat-icon[class*="source-item-source-icon"]');
      checks.push({
        name: 'Source type icons',
        selector: 'mat-icon.source-item-source-icon',
        passed: !!typeIcon,
        critical: false,
        note: typeIcon ? `Icon: ${typeIcon.textContent?.trim() || 'unknown'}` : 'No type icon (cosmetic)'
      });
    }

    const healthy = checks.filter(c => c.critical).every(c => c.passed);
    return { healthy, checks };
  }

  /**
   * Check health of Chat functionality
   * @returns {Object} - { healthy: boolean, checks: [...] }
   */
  /**
   * Check whether the notebook's project title is detectable.
   * The title feeds filename generation for every export (notes, sources, chat).
   * If all selectors miss, exports fall back to "NotebookLM" (or "NotebookLM Chat")
   * and filenames look like `NotebookLM-Chat-chat-2026-04-23T19-31-50.zip`.
   */
  function checkProjectTitleHealth() {
    const checks = [];
    // One chain for file names, chat export and the health check
    const selectors = NLME.PROJECT_TITLE_SELECTORS;

    let matchedSelector = null;
    let resolvedTitle = null;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el?.textContent?.trim();
      if (text) {
        matchedSelector = selector;
        resolvedTitle = text;
        break;
      }
    }

    const passed = !!resolvedTitle;
    checks.push({
      name: 'Notebook project title detectable',
      selector: matchedSelector || selectors.join(', '),
      passed,
      critical: true,
      note: passed
        ? `Matched "${matchedSelector}" → "${resolvedTitle.substring(0, 60)}${resolvedTitle.length > 60 ? '…' : ''}"`
        : 'None of the title selectors matched — export filenames will use generic "NotebookLM" prefix'
    });

    // Informational: which fallback rank matched.
    if (passed && matchedSelector !== selectors[0]) {
      checks.push({
        name: 'Primary selector still best',
        selector: selectors[0],
        passed: false,
        critical: false,
        note: `Primary selector "${selectors[0]}" missed; using fallback "${matchedSelector}". Extension may be drifting behind NotebookLM UI changes.`
      });
    }

    // Studio viewers close from the panel header since Nov 2026
    const viewerOpen = !!findOpenStudioViewer();
    const headerClose = document.querySelectorAll(NLME.STUDIO_HEADER_CLOSE_SELECTOR);
    checks.push({
      name: 'Studio header close control',
      selector: NLME.STUDIO_HEADER_CLOSE_SELECTOR,
      passed: viewerOpen ? headerClose.length === 1 : true,
      critical: false,
      count: headerClose.length,
      note: viewerOpen
        ? (headerClose.length === 1
            ? `Found "${headerClose[0].getAttribute('aria-label')}"`
            : 'Viewer open but no header close button — viewers may stay open after export')
        : 'Open a studio item to verify (expected 1 match)'
    });

    // Formulas are exported from their original LaTeX (data-math, Nov 2026).
    // Warn if Gemini stops providing it and exports fall back to rebuilding.
    const formulas = Array.from(document.querySelectorAll('.katex'));
    const mathHealth = NLME.mathSourceHealth({
      total: formulas.length,
      withSource: formulas.filter(k =>
        (k.closest('[data-math]')?.getAttribute('data-math') || '').trim() ||
        (k.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '').trim()
      ).length
    });
    checks.push({
      name: 'Formulas carry LaTeX source',
      selector: '[data-math] .katex',
      passed: mathHealth.passed,
      critical: false,
      warning: true,
      count: formulas.length,
      note: mathHealth.note
    });

    const healthy = checks.every(c => !c.critical || c.passed);
    return { healthy, checks };
  }

  function checkChatHealth() {
    const checks = [];

    // Check for chat panel content container (used by actual export)
    const chatPanelContent = document.querySelector('chat-panel .chat-panel-content');
    const chatPanel = document.querySelector('chat-panel');
    checks.push({
      name: 'Chat panel present',
      selector: 'chat-panel .chat-panel-content',
      passed: !!chatPanelContent || !!chatPanel,
      critical: true,
      note: chatPanelContent ? 'Chat panel with content found' : (chatPanel ? 'Chat panel found (no content container)' : 'Chat panel not found')
    });

    // Check for message pairs (the actual selector used by export)
    const messagePairs = document.querySelectorAll('.chat-message-pair');
    const hasMessages = messagePairs.length > 0;
    checks.push({
      name: 'Chat message pairs found',
      selector: '.chat-message-pair',
      passed: hasMessages,
      count: messagePairs.length,
      critical: false, // Chat might be empty
      note: hasMessages ? `Found ${messagePairs.length} message pair(s)` : 'No chat history (may be empty)'
    });

    if (hasMessages) {
      // Check for user message container (actual selector from extractMessagePair)
      const userMessages = document.querySelectorAll('.chat-message-pair .from-user-container .message-text-content');
      checks.push({
        name: 'User messages structure',
        selector: '.from-user-container .message-text-content',
        passed: userMessages.length > 0,
        count: userMessages.length,
        critical: true
      });

      // Check for AI response container (actual selector from extractMessagePair)
      const aiResponses = document.querySelectorAll('.chat-message-pair .to-user-container .message-text-content');
      checks.push({
        name: 'AI response structure',
        selector: '.to-user-container .message-text-content',
        passed: aiResponses.length > 0,
        count: aiResponses.length,
        critical: true
      });

      // Check for date separators (nice to have)
      const dateSeparators = document.querySelectorAll('.chat-panel-content .date-separator');
      checks.push({
        name: 'Date separators',
        selector: '.date-separator',
        passed: true, // informational
        count: dateSeparators.length,
        critical: false,
        note: dateSeparators.length > 0 ? `Found ${dateSeparators.length} date separator(s)` : 'No date separators'
      });
    }

    const healthy = checks.filter(c => c.critical).every(c => c.passed);
    return { healthy, checks };
  }

  /**
   * NON-DESTRUCTIVE citation workflow test
   * Hovers over a citation button to verify tooltip mechanics work
   * @returns {Promise<Object>} - { healthy: boolean, checks: [...] }
   */
  // Studio artifacts: present, downloadable through a More menu, and of a
  // known type (a new icon is how a new artifact type shows up first)
  function checkArtifactsHealth() {
    const checks = [];
    const items = Array.from(document.querySelectorAll('artifact-library-item'));
    checks.push({
      name: 'Studio artifacts found',
      selector: 'artifact-library-item',
      passed: items.length > 0,
      count: items.length,
      critical: false, // a notebook may have no artifacts
      note: items.length ? `Found ${items.length} artifact(s)` : 'No artifacts in this notebook'
    });
    if (items.length === 0) return { healthy: true, checks };

    const withMore = items.filter(item => item.querySelector('button[aria-label="More"]'));
    checks.push({
      name: 'Artifact More menus',
      selector: 'artifact-library-item button[aria-label="More"]',
      passed: withMore.length > 0,
      count: withMore.length,
      critical: true,
      note: `${withMore.length} of ${items.length} artifacts have a More menu (downloads go through it)`
    });

    const unknown = NLME.unknownStudioIcons(items.map(item => item.querySelector('mat-icon')?.textContent));
    checks.push({
      name: 'Artifact types recognised',
      selector: 'artifact-library-item mat-icon',
      passed: unknown.length === 0,
      critical: false,
      warning: true,
      note: unknown.length ? `Unknown icon(s): ${unknown.join(', ')} — these items may be mislabelled` : 'All artifact icons are known types'
    });

    return { healthy: checks.filter(c => c.critical).every(c => c.passed), checks };
  }

  async function checkCitationWorkflow() {
    const checks = [];

    // Find numbered citation markers (not the collapsed-group buttons)
    const citationButtons = Array.from(document.querySelectorAll(
      'button.citation-marker, button.xap-inline-dialog[dialoglabel="Citation Details"]'))
      .filter(btn => NLME.parseCitationIndex(btn.querySelector('span')?.textContent));
    const hasButtons = citationButtons.length > 0;
    checks.push({
      name: 'Citation buttons present',
      selector: 'button.citation-marker',
      passed: hasButtons,
      count: citationButtons.length,
      critical: false, // Chat/notes might not have citations
      note: hasButtons ? `Found ${citationButtons.length} citation button(s)` : 'No citations on this page'
    });
    if (!hasButtons) {
      return { healthy: true, checks }; // No citations to test
    }

    // Probe two real markers with the same hover routine exports use
    // (Milestone 2): if exports would fail to read citations, this fails too
    const probes = citationButtons.filter(btn => isElementVisible(btn)).slice(0, 2);
    const results = [];
    for (const button of (probes.length ? probes : citationButtons.slice(0, 2))) {
      const index = NLME.parseCitationIndex(button.querySelector('span')?.textContent);
      results.push(await extractSingleCitationWithRetry(button, index, false, 2));
    }
    const opened = results.filter(r => r.success);
    const withQuote = opened.filter(r => (r.data.quote || '').trim().length > 0);
    const withTitle = opened.filter(r => (r.data.text || '').trim().length > 0);

    checks.push({
      name: 'Citation popover opens',
      selector: NLME.CITATION_TOOLTIP_SELECTOR,
      passed: opened.length === results.length,
      critical: true,
      note: `${opened.length} of ${results.length} probed citations opened` +
        (opened.length < results.length ? ` (${results.find(r => !r.success)?.error || 'no popover'})` : '')
    });
    checks.push({
      name: 'Citation quote text read',
      selector: '.citation-tooltip-text',
      passed: opened.length > 0 && withQuote.length === opened.length,
      critical: true,
      note: `${withQuote.length} of ${opened.length} quotes read`
    });
    checks.push({
      name: 'Citation source title read',
      selector: '.citation-tooltip-header',
      passed: opened.length > 0 && withTitle.length === opened.length,
      critical: true,
      note: withTitle.length ? `Sample: "${withTitle[0].data.text.slice(0, 40)}"` : 'No source title found in the popover'
    });

    const healthy = checks.filter(c => c.critical).every(c => c.passed);
    return { healthy, checks };
  }

  /**
   * Run comprehensive health check across all categories
   * @param {Object} options - { skipCitations: boolean, fastMode: boolean }
   * @returns {Promise<Object>} - Full health check results
   */
  async function runComprehensiveHealthCheck(options = {}) {
    const startTime = Date.now();
    console.log('[NotebookLM Takeout] Starting comprehensive health check...');

    const results = {
      overallHealthy: true,
      categories: {},
      criticalFailures: [],
      recommendations: [],
      duration: 0
    };

    // Run category checks
    try {
      results.categories.general = checkProjectTitleHealth();
      if (!results.categories.general.healthy) {
        results.overallHealthy = false;
        results.criticalFailures.push('General: Notebook project title selector broken');
      }
    } catch (error) {
      results.categories.general = { healthy: false, checks: [], error: error.message };
      results.overallHealthy = false;
      results.criticalFailures.push(`General check failed: ${error.message}`);
    }

    try {
      results.categories.notes = checkNotesHealth();
      if (!results.categories.notes.healthy) {
        results.overallHealthy = false;
        results.criticalFailures.push('Notes: Some critical selectors not found');
      }
    } catch (error) {
      results.categories.notes = { healthy: false, checks: [], error: error.message };
      results.overallHealthy = false;
      results.criticalFailures.push(`Notes check failed: ${error.message}`);
    }

    try {
      results.categories.sources = checkSourcesHealth();
      if (!results.categories.sources.healthy) {
        results.overallHealthy = false;
        results.criticalFailures.push('Sources: Some critical selectors not found');
      }
    } catch (error) {
      results.categories.sources = { healthy: false, checks: [], error: error.message };
      results.overallHealthy = false;
      results.criticalFailures.push(`Sources check failed: ${error.message}`);
    }

    try {
      results.categories.artifacts = checkArtifactsHealth();
      if (!results.categories.artifacts.healthy) {
        results.overallHealthy = false;
        results.criticalFailures.push('Artifacts: Studio items or their More menus not found');
      }
    } catch (error) {
      results.categories.artifacts = { healthy: false, checks: [], error: error.message };
      results.overallHealthy = false;
      results.criticalFailures.push(`Artifacts check failed: ${error.message}`);
    }

    try {
      results.categories.chat = checkChatHealth();
      if (!results.categories.chat.healthy) {
        results.overallHealthy = false;
        results.criticalFailures.push('Chat: Some critical selectors not found');
      }
    } catch (error) {
      results.categories.chat = { healthy: false, checks: [], error: error.message };
      results.overallHealthy = false;
      results.criticalFailures.push(`Chat check failed: ${error.message}`);
    }

    // Citation workflow test (can be skipped for fast mode)
    if (!options.skipCitations && !options.fastMode) {
      try {
        results.categories.citations = await checkCitationWorkflow();
        if (!results.categories.citations.healthy) {
          results.overallHealthy = false;
          results.criticalFailures.push('Citations: Tooltip workflow not working');
        }
      } catch (error) {
        results.categories.citations = { healthy: false, checks: [], error: error.message };
        results.overallHealthy = false;
        results.criticalFailures.push(`Citation check failed: ${error.message}`);
      }
    } else {
      results.categories.citations = { healthy: true, checks: [{ name: 'Skipped', passed: true, note: 'Citation test skipped (fast mode)' }] };
    }

    // Generate recommendations
    if (!results.overallHealthy) {
      results.recommendations.push('NotebookLM may have been updated. Check for extension updates.');
      results.recommendations.push('Try refreshing the page and running the check again.');

      // Specific recommendations based on failures
      if (!results.categories.general?.healthy) {
        results.recommendations.push('Project title not detected — export filenames will fall back to generic "NotebookLM" prefix.');
      }
      if (!results.categories.notes?.healthy) {
        results.recommendations.push('Notes export may fail or produce incomplete results.');
      }
      if (!results.categories.sources?.healthy) {
        results.recommendations.push('Source export may fail or produce incomplete results.');
      }
      if (!results.categories.chat?.healthy) {
        results.recommendations.push('Chat export may fail or produce incomplete results.');
      }
      if (!results.categories.citations?.healthy) {
        results.recommendations.push('Citation extraction may fail. Consider disabling "Extract Full Citations" option.');
      }
    }

    results.duration = Date.now() - startTime;
    console.log('[NotebookLM Takeout] Health check complete:', results);

    return results;
  }

  // Helper function to race promises with proper cleanup of losers
  function raceWithCleanup(promises) {
    return Promise.race(promises).finally(() => {
      // Clean up all promises (both winners and losers)
      promises.forEach(p => {
        if (p && typeof p._cleanup === 'function') {
          p._cleanup();
        }
      });
    });
  }

  // Helper function to sleep
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract a single citation with retry logic
   * @param {Element} button - The citation button element to hover
   * @param {string} spanIndex - The citation index for logging
   * @param {boolean} includeImages - Whether to include images in citation
   * @param {number} maxRetries - Maximum retry attempts (default: 3)
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  function extractSingleCitationWithRetry(button, spanIndex, includeImages = false, maxRetries = 3) {
    return timePhase('citation.hover', () => extractSingleCitationWithRetryInner(button, spanIndex, includeImages, maxRetries));
  }

  async function extractSingleCitationWithRetryInner(button, spanIndex, includeImages = false, maxRetries = 3) {
    let lastError = null;
    const TOOLTIP = NLME.CITATION_TOOLTIP_SELECTOR;

    const leave = () => {
      button.dispatchEvent(new MouseEvent('mouseleave', { view: window, bubbles: false, cancelable: true }));
      button.dispatchEvent(new MouseEvent('mouseout', { view: window, bubbles: true, cancelable: true }));
    };

    // The tooltip is a singleton overlay; reading before the previous one is
    // gone returns the previous citation's text. Resolve on the removal itself
    // (MutationObserver) instead of polling every 100 ms (Milestone 1, Speed).
    const waitForTooltipGone = (timeout = 2000) => new Promise(resolve => {
      if (!document.querySelector(TOOLTIP)) { resolve(true); return; }
      const observer = new MutationObserver(() => {
        if (!document.querySelector(TOOLTIP)) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(!document.querySelector(TOOLTIP));
      }, timeout);
    });
    // If it lingers, press Escape once more; if it still stays, the caller
    // fails the citation rather than risk the next one reading this text.
    const ensureTooltipGone = async () => {
      if (await waitForTooltipGone()) return true;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return waitForTooltipGone(500);
    };
    // Skip scrolling when the marker is already fully visible
    const isInView = () => {
      const r = button.getBoundingClientRect();
      if (r.width === 0 || r.top < 0 || r.bottom > window.innerHeight) return false;
      const scroller = button.closest('.chat-panel-content, .scroll-container, .scroll-area-desktop');
      if (!scroller) return true;
      const c = scroller.getBoundingClientRect();
      return r.top >= c.top && r.bottom <= c.bottom;
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!isInView()) {
          button.scrollIntoView({ behavior: 'instant', block: 'center' });
          await sleep(50);
        }

        if (document.querySelector(TOOLTIP)) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await waitForTooltipGone();
        }

        // Gemini Notebook opens the citation popover on mouseenter/pointerenter (Nov 2026)
        button.dispatchEvent(new MouseEvent('mouseenter', { view: window, bubbles: false, cancelable: true }));
        button.dispatchEvent(new PointerEvent('pointerenter', { view: window, bubbles: false, cancelable: true, pointerType: 'mouse' }));

        const tooltipWaitTime = 2500 + (attempt - 1) * 500;
        const tooltip = await waitForElement(TOOLTIP, tooltipWaitTime).catch(() => null);

        if (!tooltip) {
          lastError = 'Tooltip did not appear';
          console.warn(`[NotebookLM Takeout] Citation ${spanIndex}: Attempt ${attempt}/${maxRetries} - ${lastError}`);
          leave();
          await sleep(300 + attempt * 100);
          continue;
        }

        // Accept once header and quote are present and the quote's length is
        // stable across two 30 ms checks; opacity is only a fallback signal
        const maxContentAttempts = 25 + (attempt - 1) * 8;
        const quoteStable = NLME.createStabilityTracker({ checks: 2, minLength: 1 });
        let textEl = null;
        for (let contentAttempt = 0; contentAttempt < maxContentAttempts; contentAttempt++) {
          textEl = tooltip.querySelector('.citation-tooltip-text');
          const hasHeader = !!tooltip.querySelector('.citation-tooltip-header');
          const length = textEl ? textEl.textContent.trim().length : 0;
          if (hasHeader && quoteStable.push(length)) break;
          const opacity = parseFloat(window.getComputedStyle(tooltip).opacity);
          if (!hasHeader && opacity > 0.5 && length > 0) break;
          textEl = null;
          await sleep(30);
        }

        if (!textEl) {
          lastError = 'Tooltip content did not load';
          console.warn(`[NotebookLM Takeout] Citation ${spanIndex}: Attempt ${attempt}/${maxRetries} - ${lastError}`);
          leave();
          await waitForTooltipGone();
          continue;
        }

        const sourceTitle = tooltip.querySelector('.citation-tooltip-header')?.textContent?.trim() || '';

        // Quote markup varies: structural-element wrappers or div.paragraph children
        let quoteMarkdown = '';
        const textElements = textEl.querySelectorAll(':scope > labs-tailwind-structural-element-view-v2');
        if (textElements.length > 0) {
          for (const element of textElements) {
            const markdown = await htmlToMarkdownWithImages(element, includeImages);
            if (markdown && markdown.length > 0) quoteMarkdown += markdown + '\n\n';
          }
        } else {
          quoteMarkdown = await htmlToMarkdownWithImages(textEl, includeImages);
        }
        // A long unpunctuated source shows only a cut window: mark it with "…"
        quoteMarkdown = NLME.markWindowedQuote(quoteMarkdown.trim());

        leave();
        if (!(await ensureTooltipGone())) {
          // The quote above was read correctly; keep it. The next hover
          // closes any leftover popover before reading (see above).
          console.warn(`[NotebookLM Takeout] Citation ${spanIndex}: popover did not close after reading`);
        }

        if (attempt > 1) {
          console.log(`[NotebookLM Takeout] Citation ${spanIndex}: Succeeded on attempt ${attempt}`);
        }

        return {
          success: true,
          data: { text: sourceTitle, quote: quoteMarkdown, sourceIndex: spanIndex }
        };
      } catch (error) {
        lastError = error.message;
        console.warn(`[NotebookLM Takeout] Citation ${spanIndex}: Attempt ${attempt}/${maxRetries} error:`, error.message);
        try { leave(); } catch (e) {}
        await sleep(300 + attempt * 100);
      }
    }

    DOMHealthTracker.track('selector', 'citation-tooltip', `Citation ${spanIndex}`);
    return {
      success: false,
      error: `Citation ${spanIndex}: ${lastError} (after ${maxRetries} attempts)`
    };
  }

  // Extract note content
  async function extractNoteContent(noteIndex, noteTitle, includeImages = false) {
    console.log('[NotebookLM Takeout] Extracting note:', noteTitle, 'at index:', noteIndex);
    console.log('[NotebookLM Takeout] Include citation images:', includeImages);

    // Set global setting for citation extraction
    includeCitationImages = includeImages;

    try {
      // First, verify no note viewer is open from a previous extraction
      if (findOpenStudioViewer()) {
        console.warn('[NotebookLM Takeout] WARNING: Note viewer still open from previous extraction!');
        console.log('[NotebookLM Takeout] Attempting to force close it...');

        const closed = await timePhase('note.close', () => closeStudioViewer(500));
        if (!closed) {
          console.error('[NotebookLM Takeout] ERROR: Failed to close viewer after 3 attempts');
          DOMHealthTracker.track('stuck', 'button[aria-label="Close note view"]', 'Viewer close failed');
          // Reading on would return the still-open item's content under this
          // note's title (Milestone 1: fail instead of continuing)
          throw new Error('Previous viewer could not be closed');
        }
      }

      // Wait for note list to be present (in case we just navigated back)
      // Use retry logic to handle Angular re-rendering timing issues
      let allNoteElements = [];
      const maxRetries = 5;
      const retryDelay = 500;

      for (let retry = 0; retry < maxRetries; retry++) {
        // Wait for at least one note element to appear
        try {
          await waitForElement('artifact-library-note', 3000);
        } catch (e) {
          console.warn(`[NotebookLM Takeout] waitForElement attempt ${retry + 1} failed:`, e.message);
        }

        // Let a re-rendering list settle: note count unchanged across two
        // 50 ms checks (was a fixed 500 ms per attempt)
        await waitForStable(() => document.querySelectorAll('artifact-library-note').length,
          { interval: 50, checks: 2, timeout: retryDelay * 2 });

        // Find all note elements (don't filter by visibility yet - we need to find ALL notes)
        allNoteElements = document.querySelectorAll('artifact-library-note');
        console.log(`[NotebookLM Takeout] Attempt ${retry + 1}: Found ${allNoteElements.length} artifact-library-note elements`);

        if (allNoteElements.length > 0) {
          break;
        }

        // If still 0, try alternative selectors as fallback
        if (retry === 2) {
          console.log('[NotebookLM Takeout] Trying alternative selectors...');
          // Try querying via the parent container
          const container = document.querySelector('.artifact-library-container artifact-library');
          if (container) {
            allNoteElements = container.querySelectorAll('artifact-library-note');
            console.log(`[NotebookLM Takeout] Via container: Found ${allNoteElements.length} notes`);
            if (allNoteElements.length > 0) break;
          }

          // Try finding notes by their icon (NOTE_ICONS or flowchart)
          const noteIcons = document.querySelectorAll('mat-icon.artifact-icon');
          const noteParents = [];
          noteIcons.forEach(icon => {
            const iconText = icon.textContent.trim();
            if (NLME.NOTE_ICONS.includes(iconText) || iconText === 'flowchart') {
              const noteEl = icon.closest('artifact-library-note');
              if (noteEl && !noteParents.includes(noteEl)) {
                noteParents.push(noteEl);
              }
            }
          });
          if (noteParents.length > 0) {
            allNoteElements = noteParents;
            console.log(`[NotebookLM Takeout] Via icon search: Found ${allNoteElements.length} notes`);
            break;
          }
        }

        console.log(`[NotebookLM Takeout] Retry ${retry + 1}/${maxRetries}...`);
      }

      console.log('[NotebookLM Takeout] Total note elements found:', allNoteElements.length);

      // Index first, accepted while its title still matches, so duplicate
      // titles export the row that was clicked (titles can repeat)
      const noteElements = Array.from(allNoteElements);
      const noteTitles = noteElements.map(el => el.querySelector('.artifact-title, .note-title')?.textContent?.trim() || '');
      // Strict: never fall back to an index whose title differs (Milestone 1)
      let pick = -1;
      try {
        pick = NLME.pickByIndexThenTitleStrict(noteTitles, noteIndex, noteTitle);
      } catch (e) {
        pick = -1;
      }
      const noteEl = pick === -1 ? null : noteElements[pick];
      console.log(`[NotebookLM Takeout] Resolved note "${noteTitle}" (index ${noteIndex}) to position ${pick}`);

      if (!noteEl) {
        // Gather diagnostic info
        const diagnostics = {
          notesFound: allNoteElements.length,
          containerExists: !!document.querySelector('.artifact-library-container'),
          libraryExists: !!document.querySelector('artifact-library'),
          artifactIconsCount: document.querySelectorAll('mat-icon.artifact-icon').length,
          viewerOpen: !!document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer'),
          documentReadyState: document.readyState,
          bodyChildCount: document.body?.children?.length || 0
        };
        console.error('[NotebookLM Takeout] DOM Diagnostics:', diagnostics);

        const errorMsg = `Note not found: "${noteTitle}" at index ${noteIndex}. Total notes: ${allNoteElements.length}. Container: ${diagnostics.containerExists}, Library: ${diagnostics.libraryExists}, Icons: ${diagnostics.artifactIconsCount}`;
        console.error('[NotebookLM Takeout]', errorMsg);
        DOMHealthTracker.track('selector', 'artifact-library-note', `Note "${noteTitle}"`);
        throw new Error(errorMsg);
      }

      // Find and click the note button
      const button = noteEl.querySelector('button.artifact-button-content, button');
      if (!button) {
        throw new Error('Could not find button for note');
      }

      console.log('[NotebookLM Takeout] Clicking note button...');
      const viewersBefore = snapshotStudioViewers();
      button.click();

      return await readOpenStudioNote(noteTitle, viewersBefore);

    } catch (error) {
      console.error('[NotebookLM Takeout] Extraction error:', error);
      throw error;
    }
  }

  // Read the note that was just opened in the Studio panel (editor, Tailwind
  // viewer with citations, or legacy mindmap viewer).
  // Viewer elements present before a click; the wait after the click accepts
  // only a new, rendered viewer (Milestone 1).
  function snapshotStudioViewers() {
    const studioPanel = document.querySelector('studio-panel') || document;
    return new Set(studioPanel.querySelectorAll(
      'rich-text-editor .ql-editor, rich-text-editor .ProseMirror, markdown-editor-legacy .ql-editor, labs-tailwind-doc-viewer, mindmap-viewer'));
  }

  async function readOpenStudioNote(expectedTitle = '', viewersBefore = null) {
    const fresh = { exclude: viewersBefore, visible: true };
    // Wait for content to load (editor or mindmap viewer).
    // Scope to <studio-panel> so we don't accidentally pick up the chat panel's
    // labs-tailwind-doc-viewer (used to render AI replies). When the chat
    // panel is in DOM order, an unscoped lookup grabs the chat viewer and
    // every citation hover ends up reading chat sources instead of the note's.
    console.log('[NotebookLM Takeout] Waiting for content...');
    const studioPanel = document.querySelector('studio-panel') || document;
    const content = await timePhase('note.open', () => raceWithCleanup([
      waitForElement('rich-text-editor .ql-editor', 5000, studioPanel, fresh),
      waitForElement('rich-text-editor .ProseMirror', 5000, studioPanel, fresh),
      waitForElement('markdown-editor-legacy .ql-editor', 5000, studioPanel, fresh),
      waitForElement('labs-tailwind-doc-viewer', 5000, studioPanel, fresh),
      waitForElement('mindmap-viewer', 5000, studioPanel, fresh)
    ]).catch(() => null));

    if (!content) {
      throw new Error('Content not found (no editor or mindmap viewer)');
    }

    // The opened note must be the requested one (Milestone 1)
    const openedTitle = studioPanel.querySelector('input.note-header__editable-title')?.value?.trim();
    if (expectedTitle && openedTitle && !NLME.titlesMatch(openedTitle, expectedTitle)) {
      throw new Error(`Opened "${openedTitle}" instead of "${expectedTitle}"`);
    }

    console.log('[NotebookLM Takeout] Content found:', content.tagName, content.className || '(no class)');

    // Wait a bit for content to fully render
    // Measure the note's TEXT (markup can settle before text loads)
    const noteReady = await timePhase('note.content', () => waitForStable(
      () => (content.isConnected ? content.textContent.trim().length : 0),
      { interval: 50, checks: 3, minLength: 20, timeout: 5000 }));
    if (!noteReady && !(content.isConnected && content.textContent.trim().length > 0)) {
      throw new Error('Note content did not load');
    }

    // Check if it's a mindmap viewer
    if (content.tagName.toLowerCase() === 'mindmap-viewer') {
      console.log('[NotebookLM Takeout] Mindmap detected, extracting SVG...');
      return await globalThis.__nlmeMindmap.extractMindmapSVG(content);
    }

    // Check if it's a Tailwind viewer (new format with sources)
    if (content.tagName.toLowerCase() === 'labs-tailwind-doc-viewer') {
      console.log('[NotebookLM Takeout] Tailwind viewer detected, extracting with citations...');
      return await timePhase('note.citations', () => extractTailwindNoteContent(content));
    } else {
      // Old format - just grab HTML
      console.log('[NotebookLM Takeout] Legacy editor format, no citations');
      return {
        html: content.innerHTML,
        sources: []
      };
    }

  }

  // Notes listed in the Sources panel's "Notes" group (Nov 2026). They are not
  // in the Studio list; clicking one opens the same note-editor in <studio-panel>.
  function isNoteSourceContainer(container) {
    const panel = container.closest('mat-expansion-panel');
    if (!panel) return false;
    if (panel.classList.contains('notes-category-panel')) return true;
    const header = panel.querySelector('mat-expansion-panel-header');
    if (!header) return false;
    const clone = header.cloneNode(true);
    clone.querySelectorAll('mat-icon').forEach(icon => icon.remove());
    return NLME.isNotesHeaderText(clone.textContent);
  }

  function getSourceContainerTitle(container) {
    return container.querySelector('.source-title')?.textContent?.trim() ||
      container.querySelector('button.source-stretched-button')?.getAttribute('aria-label') || '';
  }

  // Open and read a Sources-panel note. sourceIndex is its position among all
  // .single-source-container elements; the title confirms it.
  async function extractSourcesPanelNote(sourceIndex, noteTitle, includeImages = false) {
    includeCitationImages = includeImages;
    if (findOpenStudioViewer()) await closeStudioViewer(500);

    const containers = Array.from(document.querySelectorAll('.single-source-container'));
    let container = containers[sourceIndex];
    if (!container || !isNoteSourceContainer(container) || (noteTitle && getSourceContainerTitle(container) !== noteTitle)) {
      container = containers.find(c => isNoteSourceContainer(c) && getSourceContainerTitle(c) === noteTitle) || null;
    }
    if (!container) {
      throw new Error(`Note not found in Sources panel: "${noteTitle}"`);
    }

    const button = container.querySelector('button.source-stretched-button') || container.querySelector('button');
    if (!button) throw new Error('Could not find button for note');
    button.scrollIntoView({ behavior: 'instant', block: 'center' });
    const viewersBefore = snapshotStudioViewers();
    button.click();
    return await readOpenStudioNote(noteTitle, viewersBefore);
  }

  /**
   * Extract content from a source document
   * Click the source → wait for viewer → extract content from labs-tailwind-doc-viewer
   *
   * @param {number} sourceIndex - Index of the source in the list
   * @returns {Promise<Object>} - { html, sources, title }
   */
  async function extractSourceContent(sourceIndex, expectedTitle = '', needsGuide = true) {
    console.log(`[NotebookLM Takeout] Extracting source content for index ${sourceIndex}...`);

    const startTime = Date.now();

    try {
      // Verify we're on the correct page
      const currentUrl = window.location.href;
      console.log(`[NotebookLM Takeout] Current URL:`, currentUrl);

      if (!isNotebookUrl(currentUrl)) {
        throw new Error('Not on Gemini Notebook page');
      }

      // Find all source containers - exactly like the working extension
      const sourceContainers = document.querySelectorAll('.single-source-container');

      console.log(`[NotebookLM Takeout] Found ${sourceContainers.length} source containers in DOM`);

      if (sourceContainers.length === 0) {
        throw new Error(`No source containers found. Make sure you're on the Sources page in NotebookLM. Current URL: ${currentUrl}`);
      }

      // Identity check (Milestone 1): the scanned index is used only while its
      // title still matches; otherwise follow the title, else fail the item.
      // Note containers map to '' and can never match a source title.
      const containerTitles = Array.from(sourceContainers).map(c =>
        isNoteSourceContainer(c) ? '' : getSourceContainerTitle(c));
      const resolvedIndex = expectedTitle
        ? NLME.pickByIndexThenTitleStrict(containerTitles, sourceIndex, expectedTitle)
        : sourceIndex;
      if (resolvedIndex >= sourceContainers.length) {
        throw new Error(`Source index ${sourceIndex} out of range (total: ${sourceContainers.length})`);
      }

      const container = sourceContainers[resolvedIndex];
      if (isNoteSourceContainer(container)) {
        throw new Error('This item is a note; export it from the Notes tab');
      }

      // Get source title before clicking
      const titleEl = container.querySelector('.source-title');
      const sourceTitle = titleEl?.textContent?.trim() || `Source ${sourceIndex + 1}`;

      console.log(`[NotebookLM Takeout] Clicking source: "${sourceTitle}"`);
      console.log(`[NotebookLM Takeout] Container has ${container.children.length} children`);

      // Log all children
      for (let i = 0; i < container.children.length; i++) {
        console.log(`[NotebookLM Takeout] Child ${i}:`, container.children[i].tagName, container.children[i].className);
      }

      // Open source panel - click the button.source-stretched-button (children[0])
      // Structure: <button class="source-stretched-button"> is the first child
      const clickableButton = container.querySelector('button.source-stretched-button');

      if (!clickableButton) {
        // Fallback to children[0] if query selector fails
        if (!container.children[0]) {
          throw new Error('Could not find clickable button in source container');
        }
        console.warn('[NotebookLM Takeout] Using fallback click target (children[0])');
      }

      const clickTarget = clickableButton || container.children[0];
      console.log(`[NotebookLM Takeout] Click target:`, clickTarget.tagName, clickTarget.className);
      console.log(`[NotebookLM Takeout] Click target visible:`, clickTarget.offsetWidth, 'x', clickTarget.offsetHeight);

      // IMPORTANT: Close any existing source-viewer first
      const existingViewers = document.querySelectorAll('source-viewer');
      console.log(`[NotebookLM Takeout] Existing source-viewer count before click:`, existingViewers.length);

      if (existingViewers.length > 0) {
        // A leftover viewer would be picked up by the wait below as the new source
        console.log(`[NotebookLM Takeout] Closing existing source viewer(s)...`);
        if (!(await closeSourceViewer())) {
          // Reading on would return the previous source under this title
          return { error: 'Previous source could not be closed' };
        }
      }
      const sourceViewersBefore = new Set(document.querySelectorAll('source-viewer'));

      // Scroll into view first
      requestTimer.start('source.open');
      clickTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 50));

      console.log(`[NotebookLM Takeout] Executing click...`);

      // Try multiple click methods to ensure it works
      try {
        clickTarget.click();
      } catch (e) {
        console.warn('[NotebookLM Takeout] Direct click failed, trying dispatchEvent:', e);
        clickTarget.dispatchEvent(new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        }));
      }

      console.log(`[NotebookLM Takeout] Click executed, waiting 1.5 seconds for source to open...`);
      // (Milestone 1: no fixed 1.5 s here; the source-viewer wait below and
      // the content-stability wait cover loading)

      console.log(`[NotebookLM Takeout] Checking DOM state...`);
      console.log(`[NotebookLM Takeout] source-viewer count:`, document.querySelectorAll('source-viewer').length);

      // Check if the click opened anything visible
      const panels = document.querySelectorAll('[role="dialog"], .panel, .drawer, .side-panel');
      console.log(`[NotebookLM Takeout] Visible panels/dialogs:`, panels.length);

      // Wait for source-viewer element with longer timeout (10 seconds for large PDFs)
      console.log(`[NotebookLM Takeout] Waiting for source-viewer to appear (timeout: 10s)...`);
      // Only a newly opened, rendered viewer counts
      const sourceViewer = await waitForElement('source-viewer', 10000, document,
        { exclude: sourceViewersBefore, visible: true }).catch(() => null);
      if (!sourceViewer) {
        console.error('[NotebookLM Takeout] source-viewer not found after 10 seconds');
        console.error('[NotebookLM Takeout] DOM snapshot:', {
          sourceViewers: document.querySelectorAll('source-viewer').length,
          panels: document.querySelectorAll('[role="dialog"]').length,
          clickedElement: clickTarget.outerHTML
        });
        throw new Error('source-viewer not found - the source may not have opened');
      }
      requestTimer.end('source.open');
      requestTimer.start('source.content');

      console.log(`[NotebookLM Takeout] source-viewer found`);

      // Content ready: the source BODY text (not the viewer shell, which
      // settles before the text arrives) is at least 50 chars and unchanged
      // over four 50 ms checks; capped at 10 s for large sources
      // (was a fixed 500 ms after a fixed 1.5 s)
      const sourceBodyLength = () => {
        const body = sourceViewer.querySelector('.scroll-container, labs-tailwind-doc-viewer, .ql-editor');
        return body ? body.textContent.trim().length : 0;
      };
      const sourceReady = await waitForStable(sourceBodyLength, { interval: 50, checks: 4, minLength: 50, timeout: 10000 });
      if (!sourceReady && sourceBodyLength() === 0) {
        // Never export an empty body as a success
        return { error: 'Source content did not load' };
      }

      requestTimer.end('source.content');
      requestTimer.start('source.guide');
      // Try to wait for source-guide-container to load (optional, timeout after 3 seconds)
      // Only when a metadata version is exported (needsGuide), scoped to this viewer
      if (needsGuide) try {
        await waitForElement('.source-guide-container', 3000, sourceViewer);
        console.log(`[NotebookLM Takeout] source-guide-container found`);

        // NEW: Wait for summary content to be generated (10 second timeout)
        console.log(`[NotebookLM Takeout] Waiting for summary content to generate...`);

        const summaryTimeout = 10000; // 10 seconds
        const pollInterval = 50; // Check every 50ms
        const maxAttempts = summaryTimeout / pollInterval; // 50 attempts

        let summaryAppeared = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const sourceGuideContainer = sourceViewer.querySelector('.source-guide-container');
          if (sourceGuideContainer) {
            const summaryElement = sourceGuideContainer.querySelector('.summary');

            // Check if summary exists AND has actual content (not empty/whitespace)
            if (summaryElement && summaryElement.textContent.trim().length > 0) {
              console.log(`[NotebookLM Takeout] Summary content appeared after ${attempt * pollInterval}ms`);
              summaryAppeared = true;
              break;
            }
          }

          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        if (!summaryAppeared) {
          console.warn(`[NotebookLM Takeout] Summary content did not appear after ${summaryTimeout}ms - proceeding anyway`);
        }

      } catch (e) {
        console.log(`[NotebookLM Takeout] source-guide-container not found (optional, continuing anyway)`);
      }
      requestTimer.end('source.guide');

      // Try to find content container within source-viewer
      let contentElement = null;
      const contentSelectors = [
        '.scroll-container',
        'labs-tailwind-doc-viewer',
        '.panel-content',
        '.ql-editor',
        '.content',
        '[class*="content"]'
      ];

      for (const selector of contentSelectors) {
        contentElement = sourceViewer.querySelector(selector);
        if (contentElement && contentElement.innerHTML && contentElement.innerHTML.length > 50) {
          console.log(`[NotebookLM Takeout] Found content with selector: ${selector}`);
          break;
        }
      }

      if (!contentElement) {
        // Fallback: use source-viewer's entire innerHTML
        console.log('[NotebookLM Takeout] No specific content element found, using source-viewer innerHTML');
        contentElement = sourceViewer;
      }

      // Extract HTML content
      const htmlContent = contentElement.innerHTML || '';

      if (!htmlContent || htmlContent.length < 10) {
        console.warn(`[NotebookLM Takeout] Warning: Content seems empty (${htmlContent.length} chars)`);
      }

      console.log(`[NotebookLM Takeout] Extracted ${htmlContent.length} chars of HTML content`);

      // Warn about very large content (>5MB) that may cause performance issues
      const contentSizeMB = htmlContent.length / (1024 * 1024);
      if (contentSizeMB > 5) {
        console.warn(`[NotebookLM Takeout] Large source detected: ${contentSizeMB.toFixed(1)}MB - conversion may be slow`);
      }

      // Check for YouTube iframe
      let youtubeUrl = null;
      const youtubeIframe = sourceViewer.querySelector('.youtube-container iframe');
      if (youtubeIframe) {
        const src = youtubeIframe.getAttribute('src');
        if (src) {
          // Extract video ID from embed URL (e.g., https://www.youtube-nocookie.com/embed/VIDEO_ID)
          let videoIdMatch = src.match(/\/embed\/([^?&]+)/);

          // Also try shorts pattern (e.g., /shorts/VIDEO_ID)
          if (!videoIdMatch) {
            videoIdMatch = src.match(/\/shorts\/([^?&]+)/);
          }

          if (videoIdMatch) {
            const videoId = videoIdMatch[1];
            youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

            // Preserve playlist parameter if present
            const playlistMatch = src.match(/[?&]list=([^&]+)/);
            if (playlistMatch) {
              youtubeUrl += `&list=${playlistMatch[1]}`;
            }

            // Preserve timestamp parameters (t= or start=)
            const timestampMatch = src.match(/[?&](?:t|start)=([^&]+)/);
            if (timestampMatch) {
              youtubeUrl += `&t=${timestampMatch[1]}`;
            }

            console.log(`[NotebookLM Takeout] Found YouTube video: ${youtubeUrl}`);
          }
        }
      }

      // Extract source guide information (summary and key topics)
      let sourceGuideMarkdown = '';
      let keyTopics = [];

      try {
        const sourceGuideContainer = sourceViewer.querySelector('.source-guide-container');
        if (sourceGuideContainer) {
          console.log(`[NotebookLM Takeout] Found source guide container`);

          // Extract summary and convert to markdown
          const summaryElement = sourceGuideContainer.querySelector('.summary');
          if (summaryElement) {
            sourceGuideMarkdown = htmlToMarkdown(summaryElement);
            console.log(`[NotebookLM Takeout] Extracted source guide summary (${sourceGuideMarkdown.length} chars)`);
          } else {
            console.log(`[NotebookLM Takeout] No summary element found in container`);
          }

          // Extract key topics (preserve text)
          const keyTopicElements = sourceGuideContainer.querySelectorAll('.key-topics-text');
          if (keyTopicElements.length > 0) {
            keyTopics = Array.from(keyTopicElements).map(el => el.textContent.trim());
            console.log(`[NotebookLM Takeout] Extracted ${keyTopics.length} key topics`);
          }
        } else {
          console.log(`[NotebookLM Takeout] No source guide container found`);
        }
      } catch (guideError) {
        console.warn(`[NotebookLM Takeout] Could not extract source guide:`, guideError);
      }

      const duration = Date.now() - startTime;

      console.log(`[NotebookLM Takeout] ✓ Source extracted successfully (${duration}ms, ${htmlContent.length} chars)`);

      return {
        html: htmlContent,
        sources: [],
        title: sourceTitle,
        guideMarkdown: sourceGuideMarkdown,
        keyTopics: keyTopics,
        youtubeUrl: youtubeUrl
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[NotebookLM Takeout] ✗ Source extraction failed (${duration}ms):`, error);
      throw error;
    }
  }

  /**
   * Convert image URL to base64 data URL
   * @param {string} url - Image URL to convert
   * @returns {Promise<string>} Base64 data URL or original URL if conversion fails
   */
  async function imageToBase64(url) {
    try {
      // For Google URLs, ask the sidebar to download (it has proper permissions)
      if (url.includes('googleusercontent.com') || url.includes('google.com')) {
        console.log(`[NotebookLM Takeout] Requesting sidebar to download image: ${url.substring(0, 80)}...`);

        const response = await chrome.runtime.sendMessage({
          type: 'DOWNLOAD_IMAGE_AS_BASE64',
          url: url
        });

        if (response && response.success) {
          console.log(`[NotebookLM Takeout] Image downloaded via sidebar (${(response.dataUri.length / 1024).toFixed(1)} KB)`);
          return response.dataUri;
        } else {
          console.warn('[NotebookLM Takeout] Sidebar failed to download image:', response?.error || 'Unknown error');
          return url; // Return original URL on failure
        }
      }

      // Fallback to regular fetch for non-Google URLs
      const response = await fetch(url);
      const blob = await response.blob();

      // Warn about large images (>2MB) that may cause issues
      const sizeMB = blob.size / (1024 * 1024);
      if (sizeMB > 2) {
        console.warn(`[NotebookLM Takeout] Large image: ${sizeMB.toFixed(1)}MB - ${url}`);
      }

      // Reject images larger than 5MB to prevent memory issues
      if (sizeMB > 5) {
        console.warn(`[NotebookLM Takeout] Image too large (${sizeMB.toFixed(1)}MB), using original URL: ${url}`);
        return url;
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn('[NotebookLM Takeout] Failed to convert image to base64:', url, error);
      return url; // Return original URL if conversion fails
    }
  }

  /**
   * Convert HTML element to markdown with optional base64 image embedding
   * @param {Element} element - HTML element to convert
   * @param {boolean} includeImages - Whether to embed images as base64
   * @returns {Promise<string>} Markdown string
   */
  async function htmlToMarkdownWithImages(element, includeImages = false) {
    if (!element) return '';

    // If images should be included, find and convert them to base64
    if (includeImages) {
      const images = element.querySelectorAll('img');
      if (images.length > 0) {
        console.log(`[NotebookLM Takeout] Found ${images.length} images in citation, converting to base64...`);

        // Convert all images to base64
        const conversions = [];
        images.forEach(img => {
          const originalSrc = img.src;
          const conversion = imageToBase64(originalSrc).then(base64 => {
            img.setAttribute('src', base64);
            img.setAttribute('data-original-src', originalSrc);
          });
          conversions.push(conversion);
        });

        await Promise.all(conversions);
        console.log(`[NotebookLM Takeout] Converted ${images.length} images to base64`);
      }
    }

    // Now convert to markdown
    return htmlToMarkdown(element);
  }

  // Convert HTML element to markdown (preserves formatting)
  function htmlToMarkdown(element) {
    if (!element) return '';

    let markdown = '';

    // Helper function to process table cells with proper escaping
    const processTableCell = (cell, context) => {
      let text = processNode(cell, context).trim();

      // Escape pipe characters (Markdown table delimiter)
      text = text.replace(/\|/g, '\\|');

      // Replace newlines with spaces (tables must be single-line)
      text = text.replace(/\n+/g, ' ');

      // Warn about colspan/rowspan if present (cannot be represented in Markdown)
      const colspan = parseInt(cell.getAttribute('colspan') || '1');
      const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
      if (colspan > 1 || rowspan > 1) {
        console.warn('[NotebookLM Takeout] Table cell spans multiple columns/rows - this cannot be represented in Markdown');
      }

      return text;
    };

    // Helper function to process table elements
    const processTable = (tableNode, context) => {
      const rows = [];
      let isFirstRowHeader = false;

      // Find all rows (in thead and tbody, or directly in table)
      const thead = tableNode.querySelector('thead');
      const tbody = tableNode.querySelector('tbody');

      if (thead) {
        const headerRows = thead.querySelectorAll('tr');
        headerRows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll('th, td'));
          const cellContents = cells.map(cell => processTableCell(cell, context));
          rows.push(cellContents);
          if (idx === 0) isFirstRowHeader = true;
        });
      }

      if (tbody) {
        const bodyRows = tbody.querySelectorAll('tr');
        bodyRows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td, th'));
          const cellContents = cells.map(cell => processTableCell(cell, context));
          rows.push(cellContents);
        });
      }

      // If no thead/tbody, get rows directly from table
      if (!thead && !tbody) {
        const allRows = tableNode.querySelectorAll('tr');
        allRows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll('th, td'));
          const cellContents = cells.map(cell => processTableCell(cell, context));

          // Check if first row has <th> elements
          if (idx === 0 && tr.querySelector('th')) {
            isFirstRowHeader = true;
          }

          rows.push(cellContents);
        });
      }

      if (rows.length === 0) return '';

      // Determine number of columns
      const numCols = Math.max(...rows.map(row => row.length));

      // Build markdown table
      let tableMarkdown = '\n';

      rows.forEach((row, rowIdx) => {
        // Pad row to match column count
        while (row.length < numCols) {
          row.push('');
        }

        // Add row
        tableMarkdown += '| ' + row.join(' | ') + ' |\n';

        // Add separator after first row if it's a header
        if (rowIdx === 0 && (isFirstRowHeader || thead)) {
          tableMarkdown += '| ' + Array(numCols).fill('---').join(' | ') + ' |\n';
        }
      });

      tableMarkdown += '\n';
      return tableMarkdown;
    };

    // Helper function to process list elements
    const processList = (listNode, context) => {
      const isOrdered = listNode.tagName.toLowerCase() === 'ol';
      // Find all <li> elements, but filter out those that belong to nested lists
      // (handles Angular wrapper components like <labs-tailwind-structural-element-view-v2>)
      const allLis = Array.from(listNode.querySelectorAll('li'));
      const items = allLis.filter(li => {
        // Check if this <li> has a list ancestor between it and listNode
        let parent = li.parentElement;
        while (parent && parent !== listNode) {
          if (parent.tagName && (parent.tagName.toLowerCase() === 'ul' || parent.tagName.toLowerCase() === 'ol')) {
            return false; // This <li> belongs to a nested list
          }
          parent = parent.parentElement;
        }
        return true; // This <li> belongs directly to this list
      });
      let listMarkdown = '\n';

      items.forEach((li, idx) => {
        const indent = '  '.repeat(context.listDepth);
        const marker = isOrdered ? `${idx + 1}.` : '*';

        // Process the list item content
        const itemContext = { ...context, listDepth: context.listDepth + 1 };
        const itemContent = Array.from(li.childNodes)
          .map(child => processNode(child, itemContext))
          .join('')
          .trim();

        // Split multi-line content and indent continuation lines
        const lines = itemContent.split('\n');
        listMarkdown += `${indent}${marker} ${lines[0]}\n`;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim()) {
            listMarkdown += `${indent}  ${lines[i]}\n`;
          }
        }
      });

      listMarkdown += '\n';
      return listMarkdown;
    };

    // Helper function to process blockquote elements
    const processBlockquote = (blockquoteNode, context) => {
      const content = Array.from(blockquoteNode.childNodes)
        .map(child => processNode(child, context))
        .join('')
        .trim();

      // For citations, blockquotes are just semantic wrappers - extract content without markdown syntax
      // (the citation itself is already clearly a quote in the footnote)
      return '\n' + content + '\n\n';
    };

    const processNode = (node, context = { listDepth: 0 }) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }

      const tag = node.tagName.toLowerCase();

      // Special handling for tables
      if (tag === 'table') {
        return processTable(node, context);
      }

      // Special handling for lists
      if (tag === 'ul' || tag === 'ol') {
        return processList(node, context);
      }

      // Special handling for blockquotes
      if (tag === 'blockquote') {
        return processBlockquote(node, context);
      }

      // Special handling for ARIA headings (e.g., <div role="heading" aria-level="4">)
      if (node.getAttribute('role') === 'heading') {
        const ariaLevel = parseInt(node.getAttribute('aria-level') || '1', 10);
        const level = Math.min(Math.max(ariaLevel, 1), 6); // Clamp between 1-6
        const content = Array.from(node.childNodes).map(child => processNode(child, context)).join('');
        const hashes = '#'.repeat(level);
        return `\n${hashes} ${content}\n\n`;
      }

      // For table sub-elements, process children normally
      // (they're handled by processTable when it encounters a table)
      if (['thead', 'tbody', 'tr', 'th', 'td'].includes(tag)) {
        return Array.from(node.childNodes).map(child => processNode(child, context)).join('');
      }

      // For list items within the list processor, just process children
      if (tag === 'li' && context.listDepth > 0) {
        return Array.from(node.childNodes).map(child => processNode(child, context)).join('');
      }

      const content = Array.from(node.childNodes).map(child => processNode(child, context)).join('');

      switch (tag) {
        // Headings
        case 'h1':
          return `\n# ${content}\n\n`;
        case 'h2':
          return `\n## ${content}\n\n`;
        case 'h3':
          return `\n### ${content}\n\n`;
        case 'h4':
          return `\n#### ${content}\n\n`;
        case 'h5':
          return `\n##### ${content}\n\n`;
        case 'h6':
          return `\n###### ${content}\n\n`;

        // Text formatting
        case 'b':
        case 'strong':
          return `**${content}**`;
        case 'i':
        case 'em':
          return `*${content}*`;
        case 's':
        case 'del':
        case 'strike':
          return `~~${content}~~`;

        // Links and images
        case 'a':
          const href = node.getAttribute('href') || '';
          return href ? `[${content}](${href})` : content;
        case 'img':
          const src = node.getAttribute('src') || '';
          const alt = node.getAttribute('alt') || '';
          return src ? `![${alt}](${src})` : '';

        // Code
        case 'code':
          // Check if this is inside a <pre> tag (already handled as code block)
          if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
            return content;
          }
          return `\`${content}\``;
        case 'pre':
          // Code block
          const codeElement = node.querySelector('code');
          const codeContent = codeElement ? codeElement.textContent : node.textContent;
          const language = codeElement ? (codeElement.className.match(/language-(\w+)/) || [])[1] || '' : '';
          return `\n\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;

        // Horizontal rule
        case 'hr':
          return '\n---\n\n';

        // Line breaks and blocks
        case 'br':
          return '\n';
        case 'p':
        case 'div':
          return content + '\n';
        case 'span':
          return content;

        default:
          return content;
      }
    };

    markdown = processNode(element);
    return markdown.trim();
  }

  // Extract content from Tailwind viewer format. The overlay container is
  // hidden during the citation hover loop and always restored, even on error,
  // otherwise every menu and dialog in the page stays invisible.
  async function extractTailwindNoteContent(viewer) {
    const overlay = document.querySelector('.cdk-overlay-container');
    if (overlay) {
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
    }
    try {
      return await extractTailwindNoteCitations(viewer);
    } finally {
      if (overlay) {
        overlay.style.visibility = '';
        overlay.style.pointerEvents = '';
      }
    }
  }

  async function extractTailwindNoteCitations(viewer) {
    console.log('[NotebookLM Takeout] Extracting Tailwind format note...');

    const errors = [];
    const expanderOf = (btn) => {
      const icon = btn.querySelector('mat-icon, span');
      return NLME.isCitationExpander({
        iconText: icon?.textContent,
        ariaLabel: icon?.getAttribute('aria-label')
      });
    };

    // Step 1: expand collapsed citation groups so every marker is in the DOM.
    // Only groups that are still collapsed: clicking an open one closes it.
    const showMoreButtons = Array.from(viewer.querySelectorAll('button.citation-marker')).filter(btn => {
      const icon = btn.querySelector('mat-icon, span');
      return NLME.isCollapsedCitationGroup({ iconText: icon?.textContent, ariaLabel: icon?.getAttribute('aria-label') });
    });
    for (const button of showMoreButtons) {
      button.scrollIntoView({ behavior: 'instant', block: 'center' });
      await sleep(100);
      button.click();
      await sleep(300);
    }
    if (showMoreButtons.length > 0) await sleep(200);

    // Step 2: one marker per citation number. Markers lost the
    // ng-star-inserted class in Nov 2026; keep the old selector as fallback.
    const candidates = new Set(viewer.querySelectorAll(
      'button.citation-marker, labs-tailwind-structural-element-view-v2 button.ng-star-inserted'
    ));
    const buttonsByIndex = new Map();
    for (const button of candidates) {
      if (expanderOf(button)) continue;
      const index = NLME.parseCitationIndex(button.querySelector('span')?.textContent);
      if (index && !buttonsByIndex.has(index)) buttonsByIndex.set(index, button);
    }
    console.log('[NotebookLM Takeout] Found', buttonsByIndex.size, 'unique citations to extract');

    // Titles-only mode: source titles from the markers' aria-labels, no
    // hovering (Milestone 2, Speed #4)
    if (citationDetailMode === 'titles') {
      const titleSources = [...buttonsByIndex].map(([index, button]) => ({
        index,
        text: NLME.citationTitleFromAriaLabel(button.querySelector('span')?.getAttribute('aria-label'), index),
        quote: '',
        href: '',
        sourceIndex: index
      }));
      return { html: viewer.innerHTML, sources: titleSources, errors };
    }

    // Citation cache (Milestone 3c): quotes mode only, never with images.
    // Same note text and marker numbers as an earlier complete read -> reuse
    // its sources instead of hovering every marker. Storage trouble only logs.
    const cacheUsable = reuseCitations && !includeCitationImages && buttonsByIndex.size > 0;
    let cacheKey = null;
    let cacheNotebookId = '';
    if (cacheUsable) {
      cacheNotebookId = NLME.notebookIdFromUrl(location.href);
      cacheKey = NLME.citationCacheKey({ kind: 'note', text: viewer.textContent, numbers: [...buttonsByIndex.keys()] });
      const cached = await NLME.citationCacheRead(chrome.storage.local, cacheNotebookId, cacheKey);
      if (cached && cached.length === buttonsByIndex.size) {
        console.log(`[NotebookLM Takeout] Citation cache hit: ${cached.length} source(s) reused without hovering`);
        return { html: viewer.innerHTML, sources: cached, errors, fromCache: true };
      }
    }

    // Step 3: hover each marker and read its tooltip
    const sources = [];
    for (const [index, button] of buttonsByIndex) {
      if (isExportCancelled()) break; // stop within one citation of Cancel
      const result = await extractSingleCitationWithRetry(button, index, includeCitationImages, 2);
      if (!result.success) {
        errors.push(result.error);
        continue;
      }
      if (!result.data.text) errors.push(`Citation ${index}: Empty source filename`);
      if (!result.data.quote) errors.push(`Citation ${index}: Empty quote text (source: ${result.data.text || 'unknown'})`);
      sources.push({
        index: sources.length + 1,
        text: result.data.text,
        quote: result.data.quote,
        href: '',
        sourceIndex: index
      });
    }

    console.log(`[NotebookLM Takeout] Citations: ${sources.length}/${buttonsByIndex.size} extracted, ${errors.length} warning(s)`);

    // Store only a complete read: every marker has a source with a quote, no
    // warnings, and the export was not cancelled partway.
    if (cacheKey && !isExportCancelled() && errors.length === 0 &&
        NLME.citationSourcesComplete(sources, buttonsByIndex.size)) {
      await NLME.citationCacheWrite(chrome.storage.local, cacheNotebookId, cacheKey, sources);
    }

    return {
      html: viewer.innerHTML,
      sources,
      errors
    };
  }

  // Extract mindmap SVG with all nodes expanded
  // The Studio list is not rendered while a viewer is open, and comes back
  // ~100 ms after it closes. Close any viewer and wait for a stable list
  // before resolving an artifact, or the identity check sees an empty list
  // ("Item changed") — seen in Download All right after a mind map.
  async function waitForStudioList() {
    if (findOpenStudioViewer()) await closeStudioViewer(800);
    await waitForStable(() => getArtifactItemsWithMore().length,
      { interval: 50, checks: 2, minLength: 1, timeout: 3000 });
  }

  // Studio artifacts that have a More button, in DOM order. Every artifact
  // index (Artifacts tab, Studio moreIndex, batch ZIP) refers to this list.
  function getArtifactItemsWithMore() {
    return Array.from(document.querySelectorAll('artifact-library-item'))
      .filter(item => item.querySelector('button[aria-label="More"]'));
  }

  function resolveArtifactItem(title, artifactIndex) {
    const items = getArtifactItemsWithMore();
    const titles = items.map(item => item.querySelector('.artifact-title')?.textContent?.trim() || '');
    // Strict (Milestone 1): throws "Item changed" instead of falling back to
    // an index whose title differs
    const pick = title ? NLME.pickByIndexThenTitleStrict(titles, artifactIndex, title) : artifactIndex;
    return items[pick] || null;
  }

  /**
   * Extract Report content by clicking to open and reading the content
   * Reports are similar to Notes - they open in a viewer
   */
  async function extractReportContent(reportTitle, artifactIndex = -1) {
    console.log(`[NotebookLM Takeout] Extracting Report: "${reportTitle}"`);

    try {
      // Index first, accepted while its title still matches (titles can repeat)
      const artifactItem = resolveArtifactItem(reportTitle, artifactIndex);
      if (!artifactItem) {
        throw new Error(`Could not find Report with title: "${reportTitle}"`);
      }

      const reportButton = artifactItem.querySelector('button[aria-description]') ||
        artifactItem.querySelector('button.artifact-stretched-button');
      if (!reportButton) {
        throw new Error('Could not find Report button');
      }

      console.log('[NotebookLM Takeout] Clicking Report button to open report-viewer...');
      // Close whatever is open, then accept only a newly opened viewer
      // (Milestone 1): an old viewer would be read under this title
      if (findOpenStudioViewer() && !(await closeStudioViewer(500))) {
        throw new Error('Previous viewer could not be closed');
      }
      const viewersBefore = new Set(document.querySelectorAll('report-viewer'));
      reportButton.click();

      // Wait for report-viewer to appear in the DOM
      console.log('[NotebookLM Takeout] Waiting for report-viewer...');
      // Scoped to the Studio panel: the visible option also observes attributes
      const reportViewer = await waitForElement('report-viewer', 5000, document.querySelector('studio-panel') || document, { exclude: viewersBefore, visible: true });

      if (!reportViewer) {
        throw new Error('report-viewer did not appear');
      }

      console.log('[NotebookLM Takeout] report-viewer appeared, extracting content...');

      // Wait a bit for content to fully load inside report-viewer
      await new Promise(resolve => setTimeout(resolve, 500));

      // Extract content from within report-viewer
      // Try multiple selectors for the content container
      let contentElement = null;
      const contentSelectors = [
        'labs-tailwind-doc-viewer',
        '.ql-editor',
        '.scroll-container',
        '.content',
        '[class*="content"]'
      ];

      for (const selector of contentSelectors) {
        contentElement = reportViewer.querySelector(selector);
        if (contentElement && contentElement.innerHTML && contentElement.innerHTML.length > 50) {
          console.log(`[NotebookLM Takeout] Found content with selector: ${selector}`);
          break;
        }
      }

      if (!contentElement) {
        // Fallback: use report-viewer's entire innerHTML
        console.log('[NotebookLM Takeout] No specific content element found, using report-viewer innerHTML');
        contentElement = reportViewer;
      }

      // Extract HTML content
      const htmlContent = contentElement.innerHTML;
      console.log(`[NotebookLM Takeout] Extracted ${htmlContent.length} chars of HTML from report-viewer`);

      // Close the report-viewer
      await navigateBackToNotesList();

      // Return raw HTML - sidebar.js will convert to markdown
      return {
        success: true,
        html: htmlContent,
        title: reportTitle
      };

    } catch (error) {
      console.error('[NotebookLM Takeout] Report extraction failed:', error);

      // Try to close viewer even if extraction failed
      try {
        await navigateBackToNotesList();
      } catch (closeError) {
        console.error('[NotebookLM Takeout] Failed to close report-viewer:', closeError);
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract Data Table content by clicking to open and reading the table
   * Data Tables open in a <table-viewer> element
   */
  // Open a mind map listed as a studio item and extract it (mindmap-extract.js)
  async function extractMindmapArtifact(mindmapTitle, artifactIndex = -1) {
    console.log(`[NotebookLM Takeout] Extracting Mind Map: "${mindmapTitle}"`);

    // Index first, accepted while its title still matches (titles can repeat)
    const artifactItem = resolveArtifactItem(mindmapTitle, artifactIndex);
    if (!artifactItem) {
      throw new Error(`Could not find Mind Map with title: "${mindmapTitle}"`);
    }

    const openButton = artifactItem.querySelector('button.artifact-stretched-button') ||
      artifactItem.querySelector('button:not([aria-label="More"])');
    if (!openButton) {
      throw new Error('Could not find Mind Map button');
    }

    let leaveOpen = false;
    try {
      openButton.click();
      const studioPanel = document.querySelector('studio-panel') || document;
      // Older UI: <mindmap-viewer>. Since the redesign the map renders in a
      // sandboxed app iframe (*.scf.usercontent.goog) inside artifact-viewer.
      const found = await waitForElement('mindmap-viewer, artifact-viewer g.node[role="treeitem"], artifact-viewer app-viewer iframe', 8000, studioPanel)
        .catch(() => null);
      if (found && found.tagName.toLowerCase() === 'iframe') {
        // The page can't read a cross-origin frame; the background injects
        // mindmap-extract.js into it (EXTRACT_MINDMAP_FRAME) and closes the viewer
        leaveOpen = true;
        return { inAppFrame: true };
      }
      if (!found) {
        const dialog = studioPanel.querySelector('artifact-viewer');
        const tags = dialog
          ? [...new Set([...dialog.querySelectorAll('*')].map(e => e.tagName.toLowerCase()).filter(t => t.includes('-') || t === 'svg' || t === 'canvas'))]
          : [];
        throw new Error(`Mind map viewer not found. artifact-viewer ${dialog ? 'contains: ' + tags.join(', ') : 'not open'}`);
      }
      const viewer = found.closest('mindmap-viewer') || found.closest('artifact-viewer') || found;
      // Let the SVG render before expanding nodes
      await new Promise(resolve => setTimeout(resolve, 1000));
      return await globalThis.__nlmeMindmap.extractMindmapSVG(viewer);
    } finally {
      if (!leaveOpen) await navigateBackToNotesList();
    }
  }

  async function extractDataTableContent(tableTitle, artifactIndex = -1) {
    console.log(`[NotebookLM Takeout] Extracting Data Table: "${tableTitle}"`);

    try {
      // Index first, accepted while its title still matches (titles can repeat)
      const artifactItem = resolveArtifactItem(tableTitle, artifactIndex);
      if (!artifactItem) {
        throw new Error(`Could not find Data Table with title: "${tableTitle}"`);
      }

      const tableButton = artifactItem.querySelector('button[aria-description]') ||
        artifactItem.querySelector('button.artifact-stretched-button');
      if (!tableButton) {
        throw new Error('Could not find Data Table button');
      }

      console.log('[NotebookLM Takeout] Clicking Data Table button to open table-viewer...');
      // Close whatever is open, then accept only a newly opened viewer
      // (Milestone 1): an old viewer would be read under this title
      if (findOpenStudioViewer() && !(await closeStudioViewer(500))) {
        throw new Error('Previous viewer could not be closed');
      }
      const viewersBefore = new Set(document.querySelectorAll('table-viewer'));
      tableButton.click();

      // Wait for table-viewer to appear in the DOM
      console.log('[NotebookLM Takeout] Waiting for table-viewer...');
      // Scoped to the Studio panel: the visible option also observes attributes
      const tableViewer = await waitForElement('table-viewer', 5000, document.querySelector('studio-panel') || document, { exclude: viewersBefore, visible: true });

      if (!tableViewer) {
        throw new Error('table-viewer did not appear');
      }

      // Wait a bit for content to fully load inside table-viewer
      await new Promise(resolve => setTimeout(resolve, 500));

      // Log table-viewer structure for debugging
      console.log('[NotebookLM Takeout] table-viewer structure:');
      console.log(`  - children count: ${tableViewer.children.length}`);
      const childTags = Array.from(tableViewer.children).map(c => c.tagName.toLowerCase()).join(', ');
      console.log(`  - child tags: ${childTags}`);
      console.log(`  - innerHTML preview: ${tableViewer.innerHTML.substring(0, 300)}...`);

      // Extract content from within table-viewer
      // IMPORTANT: Use entire table-viewer innerHTML to capture both table AND footnotes
      // Footnotes appear as sibling elements AFTER the </table> tag, not inside it
      console.log('[NotebookLM Takeout] Extracting entire table-viewer innerHTML (includes table + footnotes)');

      // Extract HTML content from entire table-viewer
      const htmlContent = tableViewer.innerHTML;
      console.log(`[NotebookLM Takeout] Extracted ${htmlContent.length} chars of HTML from table-viewer`);
      console.log(`[NotebookLM Takeout] HTML preview: ${htmlContent.substring(0, 500)}...`);

      // Close the table-viewer
      await navigateBackToNotesList();

      // Return raw HTML - sidebar.js will convert to markdown
      return {
        success: true,
        html: htmlContent,
        title: tableTitle
      };
    } catch (error) {
      console.error('[NotebookLM Takeout] Data Table extraction failed:', error);

      // Try to close viewer even if extraction failed
      try {
        await navigateBackToNotesList();
      } catch (closeError) {
        console.error('[NotebookLM Takeout] Failed to close table-viewer:', closeError);
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Studio viewers (notes, reports, tables, mind maps). Lookups are scoped to
  // <studio-panel>: chat replies also render in labs-tailwind-doc-viewer, so a
  // document-wide lookup reports a viewer as open whenever chat history exists.
  // artifact-viewer is the dialog wrapper studio items open in since the 2026 redesign.
  const STUDIO_VIEWER_SELECTOR = 'artifact-viewer, rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer, table-viewer';

  function findOpenStudioViewer() {
    const studioPanel = document.querySelector('studio-panel');
    if (!studioPanel) return null;
    // Since the redesign every studio item opens in an artifact-viewer dialog
    const dialog = studioPanel.querySelector('artifact-viewer');
    if (dialog) return dialog;
    // Older viewers: ignore hidden/zero-size elements left in the panel
    return Array.from(studioPanel.querySelectorAll(STUDIO_VIEWER_SELECTOR))
      .find(el => el.getClientRects().length > 0) || null;
  }

  // Studio viewers close from the panel header since the Nov 2026 redesign;
  // Escape no longer closes artifact-viewer or source-viewer.
  function findStudioHeaderCloseButton() {
    const labelled = document.querySelector(NLME.STUDIO_HEADER_CLOSE_SELECTOR);
    if (labelled) return labelled;
    return Array.from(document.querySelectorAll('section.studio-panel .panel-header button'))
      .find(b => b.querySelector('mat-icon')?.textContent.trim() === 'collapse_content' &&
                 !(b.getAttribute('aria-label') || '').startsWith('Collapse')) || null;
  }

  function findSourceHeaderCloseButton() {
    return Array.from(document.querySelectorAll('.panel-header button'))
      .find(b => !b.closest('section.studio-panel') &&
                 b.querySelector('mat-icon')?.textContent.trim() === 'collapse_content') || null;
  }

  function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  }

  // Close the open studio viewer. Returns true once no studio viewer is open.
  async function closeStudioViewer(delay = 800) {
    // Poll for the viewer to disappear (50 ms) instead of always waiting `delay`
    const settle = async () => {
      for (let waited = 0; waited < delay; waited += 50) {
        if (!findOpenStudioViewer()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!findOpenStudioViewer()) return true;
      console.log(`[NotebookLM Takeout] Close attempt ${attempt + 1}/3`);

      // Method 1: panel header close button
      const headerClose = findStudioHeaderCloseButton();
      if (headerClose) {
        console.log(`[NotebookLM Takeout] Clicking header button "${headerClose.getAttribute('aria-label') || 'collapse_content'}"`);
        headerClose.click();
        await settle();
        if (!findOpenStudioViewer()) {
          console.log('[NotebookLM Takeout] ✓ Viewer closed via header button');
          return true;
        }
      }

      const studioPanel = document.querySelector('studio-panel');
      if (!studioPanel) return true;

      // Method 2: "Close note view" inside the panel (older layouts)
      const closeNoteButton = studioPanel.querySelector('button[aria-label="Close note view"]');
      if (closeNoteButton) {
        closeNoteButton.click();
        await settle();
        if (!findOpenStudioViewer()) {
          console.log('[NotebookLM Takeout] ✓ Viewer closed via "Close note view" button');
          return true;
        }
      }

      // Method 3: close / arrow_back icon buttons in the open viewer only (not the
      // whole studio panel, where they can collapse the panel itself)
      const viewer = findOpenStudioViewer();
      if (!viewer) return true;
      const viewerRoot = viewer.closest('artifact-viewer') || viewer.closest('.artifact-viewer-container') || viewer.parentElement || studioPanel;
      // In the artifact-viewer dialog collapse_content only resizes it; older note
      // viewers used it as their close button
      const closeIconNames = viewer.tagName.toLowerCase() === 'artifact-viewer'
        ? ['close', 'arrow_back']
        : ['collapse_content', 'arrow_back', 'close'];
      const closeIcons = Array.from(viewerRoot.querySelectorAll('mat-icon'))
        .filter(icon => closeIconNames.includes(icon.textContent.trim()));
      for (const icon of closeIcons) {
        const button = icon.closest('button');
        if (!button) continue;
        button.click();
        await settle();
        if (!findOpenStudioViewer()) {
          console.log('[NotebookLM Takeout] ✓ Viewer closed via close icon');
          return true;
        }
      }

      // Method 4: Escape (pre-2026 layouts)
      pressEscape();
      await settle();
      if (!findOpenStudioViewer()) {
        console.log('[NotebookLM Takeout] ✓ Viewer closed via ESC key');
        return true;
      }
    }
    return !findOpenStudioViewer();
  }

  // Close the source viewer (sources panel). Kept separate from studio viewers.
  async function closeSourceViewer() {
    // Poll for the viewer to disappear (50 ms) instead of always waiting 800 ms
    const settle = async () => {
      for (let waited = 0; waited < 800; waited += 50) {
        if (!document.querySelector('source-viewer')) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!document.querySelector('source-viewer')) return true;
      console.log(`[NotebookLM Takeout] Source close attempt ${attempt + 1}/3`);

      const headerClose = findSourceHeaderCloseButton();
      if (headerClose) {
        headerClose.click();
        await settle();
        if (!document.querySelector('source-viewer')) {
          console.log('[NotebookLM Takeout] ✓ Source viewer closed via header button');
          return true;
        }
      }

      pressEscape();
      await settle();
      if (!document.querySelector('source-viewer')) {
        console.log('[NotebookLM Takeout] ✓ Source viewer closed via ESC key');
        return true;
      }

      // Older layout: second child of the first panel header
      const panelHeaders = document.querySelectorAll('.panel-header');
      if (panelHeaders.length > 0 && panelHeaders[0].children.length > 1) {
        panelHeaders[0].children[1].click();
        await settle();
      }
    }
    return !document.querySelector('source-viewer');
  }

  // Navigate back to notes list / close source panel
  async function navigateBackToNotesList() {
    console.log('[NotebookLM Takeout] Attempting to close panel/navigate back...');

    // Only a closed Studio viewer brings the notes list back; after a source
    // (or with no notes at all) there is nothing to wait for
    const studioViewerWasOpen = !!findOpenStudioViewer();
    const studioClosed = await closeStudioViewer();
    const sourceClosed = await closeSourceViewer();
    if (studioClosed && sourceClosed) {
      console.log('[NotebookLM Takeout] ✓ Panel closed successfully');
      // Resolve once the Studio list is back, so the next note can start at once
      if (studioViewerWasOpen) {
        await waitForElement('artifact-library-note', 3000).catch(() => null);
      }
      return;
    }

    console.error('[NotebookLM Takeout] ERROR: Failed to close panel after all attempts!');
    DOMHealthTracker.track('stuck', null, 'Panel close failed');
    const studioPanel = document.querySelector('studio-panel');
    console.log('[NotebookLM Takeout] Available elements:', {
      studioPanel: !!studioPanel,
      panelHeaders: document.querySelectorAll('.panel-header').length,
      closeNoteViewButton: !!(studioPanel && studioPanel.querySelector('button[aria-label="Close note view"]')),
      studioViewers: studioPanel ? studioPanel.querySelectorAll(STUDIO_VIEWER_SELECTOR).length : 0,
      sourceViewers: document.querySelectorAll('source-viewer').length
    });
  }

  // ==================== ARTIFACT DOWNLOAD (MESSAGE-BASED) ====================

  /**
   * Main handler for artifact downloads via message passing
   * Coordinates the download process with proper error handling and metadata
   */
  async function handleArtifactDownload(artifactIndex, artifactType, skipMoreButton = false, artifactName = null, downloadPreference = 'pdf') {
    console.log(`[NotebookLM Takeout] [Download] Starting download for artifact ${artifactIndex} (${artifactType})`);
    const startTime = Date.now();

    try {
      let artifactItem = null;
      let artifactTitle = artifactName || '';
      await waitForStudioList();

      // Mind maps have no Download in their More menu (the menu doesn't open):
      // open the map and extract SVG + tree data like the Notes tab does
      if (artifactType === 'Mind Map' && skipMoreButton) {
        const mindmap = await extractMindmapArtifact(artifactTitle, artifactIndex);
        if (mindmap.inAppFrame) {
          return {
            success: true,
            method: 'mindmap_app_frame',
            title: artifactTitle,
            duration: Date.now() - startTime
          };
        }
        return {
          success: true,
          method: 'mindmap_extraction',
          svgContent: mindmap.svgContent,
          treeData: mindmap.treeData,
          title: artifactTitle,
          duration: Date.now() - startTime
        };
      }

      // For Reports and Data Tables with skipMoreButton, go directly to extraction
      if ((artifactType === 'Report' || artifactType === 'Data Table') && skipMoreButton) {
        console.log(`[NotebookLM Takeout] [Download] ${artifactType} with skipMoreButton - extracting directly...`);

        const extractResult = artifactType === 'Report'
          ? await extractReportContent(artifactTitle, artifactIndex)
          : await extractDataTableContent(artifactTitle, artifactIndex);

        if (extractResult.success) {
          const duration = Date.now() - startTime;
          console.log(`[NotebookLM Takeout] [Download] ✓ ${artifactType} extracted (${duration}ms)`);
          return {
            success: true,
            method: 'content_extraction',
            data: extractResult.html, // Return HTML, not markdown
            format: 'html', // Indicate it's HTML
            title: extractResult.title || artifactTitle,
            duration: duration
          };
        }

        // If extraction failed, throw error
        throw new Error(extractResult.error || `${artifactType} extraction failed`);
      }

      // For other artifacts, find by index (original logic)
      // Identity check (Milestone 1): the scanned index is used only while its
      // title still matches, else the title is followed, else the item fails.
      // The row is resolved here and its own More button clicked below; the
      // old sidebar-side More click by index alone could open the wrong menu.
      const rows = getArtifactItemsWithMore();
      const rowTitles = rows.map(item => item.querySelector('.artifact-title')?.textContent?.trim() || '');
      const pick = artifactName
        ? NLME.pickByIndexThenTitleStrict(rowTitles, artifactIndex, artifactName)
        : artifactIndex;
      if (pick < 0 || pick >= rows.length) {
        throw new Error(`Artifact index ${artifactIndex} out of range (0-${rows.length - 1})`);
      }
      artifactItem = rows[pick];

      // Detect artifact type from icon if artifactItem is available (fallback for DOM changes)
      if (artifactItem) {
        const iconText = artifactItem.querySelector('mat-icon')?.textContent?.trim() || '';
        const resolved = NLME.resolveArtifactType({
          iconText,
          buttonLabel: artifactItem.querySelector('button.artifact-stretched-button')?.getAttribute('aria-label')
        });
        // Only correct when the label/icon actually named a known type
        const detectedType = (resolved !== iconText && resolved !== 'Unknown') ? resolved : null;
        if (detectedType && detectedType !== artifactType) {
          console.log(`[NotebookLM Takeout] [Download] Type corrected from "${artifactType}" to "${detectedType}" (via icon)`);
          artifactType = detectedType;
        }
      }

      // Extract artifact title from the element (try multiple selectors)
      if (!artifactTitle && artifactItem) {
        const titleSelectors = [
          '.artifact-title',
          '[class*="title"]',
          'h1', 'h2', 'h3',
          '[class*="name"]',
          '[class*="label"]'
        ];

        for (const selector of titleSelectors) {
          const titleEl = artifactItem.querySelector(selector);
          if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
            artifactTitle = titleEl.textContent.trim();
            console.log(`[NotebookLM Takeout] [Download] Found title using selector "${selector}": "${artifactTitle}"`);
            break;
          }
        }
      }

      // Fallback to type + index if no title found
      if (!artifactTitle) {
        artifactTitle = `${artifactType} ${artifactIndex + 1}`;
        console.log(`[NotebookLM Takeout] [Download] No title found, using fallback: "${artifactTitle}"`);
      }


      // Try Report or Data Table extraction first
      if (artifactType === 'Report' || artifactType === 'Data Table') {
        console.log(`[NotebookLM Takeout] [Download] Attempting ${artifactType} extraction...`);

        const extractResult = artifactType === 'Report'
          ? await extractReportContent(artifactTitle, artifactIndex)
          : await extractDataTableContent(artifactTitle, artifactIndex);

        if (extractResult.success) {
          const duration = Date.now() - startTime;
          console.log(`[NotebookLM Takeout] [Download] ✓ ${artifactType} extracted (${duration}ms)`);
          return {
            success: true,
            method: 'content_extraction',
            data: extractResult.html, // Return HTML, not markdown
            format: 'html', // Indicate it's HTML
            title: extractResult.title || artifactTitle,
            duration: duration
          };
        }

        // Fall through to button click if extraction failed
        console.log(`[NotebookLM Takeout] [Download] ${artifactType} extraction failed, falling back to button click`);
      }

      // Download through the item's own More menu. Infographics keep their
      // original file this way; capturing the rendered SVG/canvas is only a
      // fallback when the menu has no Download item (Milestone 1).
      let buttonResult;
      try {
        buttonResult = await clickArtifactDownloadButton(artifactItem.querySelector('button[aria-label="More"]'), downloadPreference);
      } catch (error) {
        if (artifactType === 'Infographic' && /Download button not found/.test(error.message)) {
          console.log('[NotebookLM Takeout] [Download] No Download item; capturing the rendered infographic...');
          const extractResult = await tryExtractInfographic(artifactItem);
          if (extractResult.success) {
            return {
              success: true,
              method: extractResult.method,
              data: extractResult.data,
              format: extractResult.format,
              dimensions: extractResult.dimensions,
              title: artifactTitle,
              duration: Date.now() - startTime
            };
          }
        }
        throw error;
      }

      const duration = Date.now() - startTime;

      // Check if we got an intercepted URL (no tab opened)
      if (buttonResult.interceptedUrl) {
        console.log(`[NotebookLM Takeout] [Download] ✓ URL intercepted (no tab) (${duration}ms)`);
        return {
          success: true,
          method: 'url_intercepted',
          url: buttonResult.interceptedUrl,
          title: artifactTitle,
          duration: duration
        };
      }

      console.log(`[NotebookLM Takeout] [Download] ✓ Download initiated via button (${duration}ms)`);

      return {
        success: true,
        method: 'button_click',
        title: artifactTitle, // Include title for filename
        duration: duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[NotebookLM Takeout] [Download] ✗ Failed after ${duration}ms:`, error.message);
      return {
        success: false,
        error: error.message,
        duration: duration
      };
    }
  }

  /**
   * Click the download button for an artifact with adaptive waiting
   * Uses MutationObserver to detect UI state changes instead of hard-coded delays
   * Now also captures intercepted download URLs from window.open
   */
  async function clickArtifactDownloadButton(moreButton, downloadPreference = 'pdf') {
    if (!moreButton) {
      throw new Error('More button not found for this item');
    }
    // URLs intercepted before this moment belong to an earlier item
    const clickedAt = Date.now();
    console.log('[NotebookLM Takeout] [Download] Clicking More button...');
    moreButton.click();

    // Wait for menu to appear with adaptive waiting
    console.log('[NotebookLM Takeout] [Download] Waiting for menu to appear...');
    await waitForElement('.mat-mdc-menu-panel, .cdk-overlay-pane', 2000);

    // Find download button with multiple selector attempts
    const downloadButton = await findDownloadButton(downloadPreference);
    if (!downloadButton) {
      // Close menu before throwing error
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      throw new Error('Download button not found in menu');
    }

    console.log('[NotebookLM Takeout] [Download] Found download button, clicking...');
    // Arm the page-world hook for this click only (injected.js)
    document.dispatchEvent(new CustomEvent('nlme-arm-intercept'));
    downloadButton.click();

    // Wait for intercepted URL (from window.open interception) or download initiation
    console.log('[NotebookLM Takeout] [Download] Waiting for intercepted URL...');
    const interceptedUrl = await waitForInterceptedUrl(clickedAt, 25000);

    if (interceptedUrl) {
      console.log('[NotebookLM Takeout] [Download] Got intercepted URL (no tab opened):', interceptedUrl.substring(0, 100));
      return { success: true, interceptedUrl: interceptedUrl };
    }

    // Fallback: wait for traditional download initiation
    console.log('[NotebookLM Takeout] [Download] No intercepted URL, falling back to traditional download...');
    await waitForDownloadInitiation();

    return { success: true };
  }

  /**
   * Find an open menu item whose visible text contains the given text (case-insensitive).
   * Searches `.mat-mdc-menu-item` and `[role="menuitem"]` across all open overlays.
   * @param {string} text - e.g. 'Download', 'Delete'
   * @returns {Element|null}
   */
  function findMenuItemByText(text) {
    if (!text) return null;
    const needle = text.toLowerCase();
    const menuItems = document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]');
    for (const item of menuItems) {
      const label = (item.textContent || '').toLowerCase();
      if (label.includes(needle)) return item;
    }
    return null;
  }

  /**
   * Find the Download item in the open More menu. Slide decks offer PDF and
   * PowerPoint (Nov 2026); preference picks between them.
   * @param {'pdf'|'pptx'} preference
   */
  async function findDownloadButton(preference = 'pdf') {
    const items = Array.from(document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]'));
    const index = NLME.pickDownloadMenuIndex(items.map(item => item.textContent || ''), preference);
    if (index !== -1) {
      console.log(`[NotebookLM Takeout] [Download] Menu item: "${items[index].textContent.trim()}"`);
    }
    return index === -1 ? null : items[index];
  }

  // ==================== STUDIO TAB (unified list) ====================

  /**
   * Scan both artifact-library-item and artifact-library-note elements in DOM order.
   * Each result carries `kind` ('artifact'|'note'), the index inside its own kind
   * (for routing into existing downloadArtifact / note-export paths), and the
   * combined index (for delete targeting).
   */
  function scanStudioItems() {
    const nodes = document.querySelectorAll('artifact-library-item, artifact-library-note');
    let artifactCursor = 0;
    let moreCursor = 0;
    let noteCursor = 0;
    const items = [];

    nodes.forEach((el, combinedIndex) => {
      const tag = el.tagName.toLowerCase();
      const titleEl = el.querySelector('.artifact-title, .note-title');
      const title = titleEl?.textContent?.trim() || '';
      // untitled: the label is made up for display; a delete by label must never use it
      const untitled = title === '';
      const label = title || `Item ${combinedIndex + 1}`;
      const detailsEl = el.querySelector('.artifact-details');
      const details = detailsEl?.textContent?.trim() || '';
      const iconEl = el.querySelector('mat-icon');
      const iconText = iconEl?.textContent?.trim() || '';
      const hasMoreButton = !!el.querySelector('button[aria-label="More"]');

      if (tag === 'artifact-library-item') {
        // Gemini Notebook puts the type in the stretched button's aria-label for
        // some kinds; icons cover the rest (Nov 2026)
        const type = NLME.resolveArtifactType({
          iconText,
          buttonLabel: el.querySelector('button.artifact-stretched-button')?.getAttribute('aria-label')
        });
        items.push({
          combinedIndex,
          kindIndex: artifactCursor,
          moreIndex: hasMoreButton ? moreCursor : -1,
          kind: 'artifact',
          label,
          untitled,
          details,
          type,
          downloadable: NLME.isDownloadableType(type),
          hasMoreButton
        });
        artifactCursor++;
        if (hasMoreButton) moreCursor++;
      } else {
        // artifact-library-note — Note or Mindmap
        let type = 'Note';
        if (iconText === 'flowchart') type = 'Mindmap';
        items.push({
          combinedIndex,
          kindIndex: noteCursor,
          kind: 'note',
          label,
          untitled,
          details,
          type,
          hasMoreButton
        });
        noteCursor++;
      }
    });

    return items;
  }

  // --- Menu binding for deletes -------------------------------------------
  // A More menu is opened by a trigger and bound to it through aria-controls.
  // Delete items from different menus share classes ("Remove source" has the
  // same one as "Remove note"), so a delete item is only ever taken from the
  // panel of the trigger just clicked, never from "the first panel".

  const DIALOG_SELECTOR = 'mat-dialog-container, mat-mdc-dialog-container, [role="dialog"], [role="alertdialog"], .cdk-dialog-container, .cdk-overlay-pane';

  function snapshotDialogPanes() {
    return new Set(document.querySelectorAll(DIALOG_SELECTOR));
  }

  function closeMenuBackdrops() {
    document.querySelectorAll('.cdk-overlay-backdrop').forEach(b => b.click());
  }

  // Close every open menu panel; false if one is still open after ~1 s.
  async function closeOpenMenus() {
    const deadline = Date.now() + 1000;
    while (document.querySelector('.mat-mdc-menu-panel')) {
      if (Date.now() > deadline) return false;
      closeMenuBackdrops();
      await new Promise(r => setTimeout(r, 100));
    }
    return true;
  }

  // Click the More trigger and return the menu panel it controls. Throws
  // (after closing the menu) if the panel cannot be tied to this trigger.
  async function openMenuForTrigger(trigger) {
    trigger.click();
    const deadline = Date.now() + 2000;
    while (trigger.getAttribute('aria-expanded') !== 'true') {
      if (Date.now() > deadline) {
        closeMenuBackdrops();
        throw new Error('More menu did not open');
      }
      await new Promise(r => setTimeout(r, 50));
    }
    // Let the panel render its items
    await new Promise(r => setTimeout(r, 150));
    const panelId = trigger.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel || !panel.classList.contains('mat-mdc-menu-panel')) {
      closeMenuBackdrops();
      throw new Error('More menu could not be identified');
    }
    return panel;
  }

  /**
   * Delete one studio item:
   *   1. Resolve target element: label plus combined index must match (the title at
   *      that index must equal the label); a label alone picks the first title match
   *      (bulk delete). Anything else is refused, never guessed.
   *   2. Open its "More" menu.
   *   3. Click the "Delete" menu item.
   *   4. Wait for the native confirmation dialog and auto-click its confirm button.
   *   5. Wait for the row to disappear.
   *
   * @param {{label?: string, combinedIndex?: number}} data
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function deleteStudioItem(data) {
    const { label, combinedIndex } = data || {};
    const all = Array.from(document.querySelectorAll('artifact-library-item, artifact-library-note'));
    if (all.length === 0) {
      throw new Error('No Generated items found on the page');
    }

    // Resolve target. The title of the element must equal the label whenever a
    // label is given: a combinedIndex is only a hint that picks between
    // same-titled items, never a fallback (the page may have changed since the scan).
    const titleOf = el => el.querySelector('.artifact-title, .note-title')?.textContent;
    const hasIndex = typeof combinedIndex === 'number' && combinedIndex >= 0 && combinedIndex < all.length;
    let target = null;
    if (label) {
      if (typeof combinedIndex === 'number') {
        // Row delete: the item at that index, or nothing
        if (!hasIndex || !NLME.studioTargetMatches(titleOf(all[combinedIndex]), label)) {
          throw new Error('Item changed \u2014 rescan and try again');
        }
        target = all[combinedIndex];
      } else {
        // Bulk delete: by label alone
        target = all.find(el => NLME.studioTargetMatches(titleOf(el), label)) || null;
      }
    } else if (hasIndex) {
      // No caller sends an index without a label (sendStudioDelete always sends the label)
      target = all[combinedIndex];
    }
    if (!target) {
      throw new Error(`Generated item not found${label ? ` (label: "${label}")` : ''}`);
    }

    const moreButton = target.querySelector('button[aria-label="More"]');
    if (!moreButton) {
      throw new Error('More button not found on this item');
    }

    if (!(await closeOpenMenus())) {
      throw new Error('Close the open menu and try again');
    }

    // The page may have changed while menus were closing.
    if (!target.isConnected || (label && !NLME.studioTargetMatches(titleOf(target), label))) {
      throw new Error('Item changed \u2014 rescan and try again');
    }

    const panel = await openMenuForTrigger(moreButton);

    // Only this trigger's own menu: its item whose text says delete.
    const deleteItem = Array.from(panel.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]'))
      .find(el => (el.textContent || '').toLowerCase().includes('delete')) || null;
    if (!deleteItem) {
      closeMenuBackdrops();
      throw new Error('Delete menu item not found');
    }
    const existingDialogs = snapshotDialogPanes();
    deleteItem.click();

    // NotebookLM's behavior varies per item type:
    //  - Some types (often notes) delete silently with an undo toast — no modal.
    //  - Others (sources, some artifacts) show a mat-dialog confirmation we must click.
    // Poll for both: if a confirm dialog appears, auto-click it; in any case,
    // succeed as soon as the row disappears.
    const initialCount = all.length;
    const isGone = () => {
      if (!document.body.contains(target)) return true;
      return document.querySelectorAll('artifact-library-item, artifact-library-note').length < initialCount;
    };

    let confirmed = false;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (isGone()) return { success: true };

      if (!confirmed) {
        const confirmBtn = findConfirmDialogButton(existingDialogs);
        if (confirmBtn) {
          confirmBtn.click();
          confirmed = true;
        }
      }

      await new Promise(r => setTimeout(r, 100));
    }

    closeMenuBackdrops();
    throw new Error(confirmed
      ? 'Item did not disappear after clicking confirm'
      : 'Delete did not take effect (no dialog, no removal)');
  }

  /**
   * Delete one note from the Sources panel's "Notes" group:
   *   1. The container at sourceIndex must be a note container whose title is
   *      `title` (no click otherwise: the list may have changed since the scan).
   *   2. Open its "More" menu, click "Remove note", click the confirm button if
   *      a dialog appears.
   *   3. Wait (5 s) until no more note containers with that title are left than
   *      before, re-finding them by title each time.
   * A failure closes the menu (backdrop click; Escape does not close it).
   *
   * @param {{sourceIndex?: number, title?: string}} data
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function deleteSourceNote(data) {
    const { sourceIndex, title } = data || {};
    const STALE = 'Note changed — rescan and try again';
    if (typeof title !== 'string' || !title || typeof sourceIndex !== 'number') {
      return { success: false, error: STALE };
    }

    const listNotes = () => Array.from(document.querySelectorAll('.single-source-container'))
      .filter(c => isNoteSourceContainer(c) && getSourceContainerTitle(c) === title);

    const container = document.querySelectorAll('.single-source-container')[sourceIndex];
    if (!container || !isNoteSourceContainer(container) || getSourceContainerTitle(container) !== title) {
      return { success: false, error: STALE };
    }

    const closeMenu = closeMenuBackdrops;
    const guardOk = () => container.isConnected && isNoteSourceContainer(container) &&
      getSourceContainerTitle(container) === title;

    if (findOpenStudioViewer()) await closeStudioViewer(500);

    // A menu left open (it may belong to a real source) must never be used.
    if (!(await closeOpenMenus())) {
      return { success: false, error: 'Close the open menu and try again' };
    }

    const moreButton = container.querySelector('button[aria-label="More"]');
    if (!moreButton) {
      return { success: false, error: 'More button not found on this note' };
    }

    // The page may have changed while the viewer / menus were closing.
    if (!guardOk()) return { success: false, error: STALE };

    const initialCount = listNotes().length;
    let panel;
    try {
      panel = await openMenuForTrigger(moreButton);
    } catch (e) {
      return { success: false, error: e.message };
    }

    // Only an item of this trigger's own menu that says "Remove note": never
    // one that mentions "source" (a real source's "Remove source" has the same class).
    const deleteItem = Array.from(panel.querySelectorAll('.more-menu-delete-source-button'))
      .find(el => {
        const text = (el.textContent || '').toLowerCase();
        return text.includes('remove note') && !text.includes('source');
      }) || null;
    if (!deleteItem) {
      closeMenu();
      return { success: false, error: 'Remove note menu item not found' };
    }
    const existingDialogs = snapshotDialogPanes();
    deleteItem.click();

    // A confirm dialog may or may not appear: click it if it does (only a new
    // one), and succeed as soon as the note is gone either way.
    let confirmed = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (listNotes().length < initialCount) return { success: true };
      if (!confirmed) {
        const confirmBtn = findConfirmDialogButton(existingDialogs);
        if (confirmBtn) {
          confirmBtn.click();
          confirmed = true;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    closeMenu();
    return {
      success: false,
      error: confirmed
        ? 'Note did not disappear after clicking confirm'
        : 'Delete did not take effect (no dialog, no removal)'
    };
  }

  /**
   * Find the destructive button of an on-screen delete confirmation.
   * NotebookLM uses several dialog shapes — mat-dialog-container, role=dialog,
   * mat-mdc-dialog-container, or just a plain .cdk-overlay-pane floating card
   * with "Cancel" + "Delete" buttons. We scan all three, preferring a
   * container that has a Cancel sibling (the strongest confirm-dialog signal)
   * and skipping the more-options menu panel we just used.
   */
  function findConfirmDialogButton(exclude = null) {
    const DESTRUCTIVE = ['delete', 'confirm', 'remove'];
    const exactMatch = (t) => DESTRUCTIVE.includes(t);
    const looseMatch = (t) => DESTRUCTIVE.some(w => t.includes(w));

    // exclude: dialog elements that were already open before the delete click
    // (a leftover dialog must never be confirmed by the next delete).
    const candidates = Array.from(document.querySelectorAll(
      'mat-dialog-container, mat-mdc-dialog-container, [role="dialog"], [role="alertdialog"], .cdk-dialog-container, .cdk-overlay-pane'
    )).filter(el => !exclude || ![...exclude].some(old => old === el || old.contains(el)));

    for (const container of candidates) {
      // Skip the more-options menu panel (it has .mat-mdc-menu-panel descendants).
      if (container.querySelector('.mat-mdc-menu-panel, .mat-menu-panel')) continue;

      const buttons = Array.from(container.querySelectorAll('button'));
      if (buttons.length === 0) continue;

      const hasCancel = buttons.some(b => (b.textContent || '').trim().toLowerCase() === 'cancel');

      // Exact-text destructive match inside a Cancel-paired container wins.
      const exact = buttons.find(b => exactMatch((b.textContent || '').trim().toLowerCase()));
      if (exact && hasCancel) return exact;

      // Loose-text destructive match inside a Cancel-paired container.
      const loose = buttons.find(b => looseMatch((b.textContent || '').toLowerCase()));
      if (loose && hasCancel) return loose;
    }

    // Second pass without the Cancel requirement (some layouts drop Cancel).
    for (const container of candidates) {
      if (container.querySelector('.mat-mdc-menu-panel, .mat-menu-panel')) continue;
      const buttons = Array.from(container.querySelectorAll('button'));
      const exact = buttons.find(b => exactMatch((b.textContent || '').trim().toLowerCase()));
      if (exact) return exact;
    }

    return null;
  }

  /**
   * Wait for download to initiate by observing aria-busy or loading states
   * Uses MutationObserver with timeout fallback (replaces hard-coded delays)
   */
  async function waitForDownloadInitiation(timeout = 1000) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        console.log('[NotebookLM Takeout] [Download] Download initiation timeout (assuming success)');
        resolve();
      }, timeout);

      const observer = new MutationObserver((mutations) => {
        // Look for aria-busy changes or overlay dismissal
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'aria-busy') {
            const target = mutation.target;
            if (target.getAttribute('aria-busy') === 'false') {
              clearTimeout(timeoutId);
              observer.disconnect();
              console.log('[NotebookLM Takeout] [Download] Detected download initiation (aria-busy)');
              resolve();
              return;
            }
          }
        }

        // Also check if overlay is dismissed (menu closed)
        const overlay = document.querySelector('.cdk-overlay-pane, .mat-mdc-menu-panel');
        if (!overlay) {
          clearTimeout(timeoutId);
          observer.disconnect();
          console.log('[NotebookLM Takeout] [Download] Menu closed, download likely initiated');
          resolve();
        }
      });

      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['aria-busy'],
        subtree: true,
        childList: true
      });
    });
  }

  /**
   * Try to extract infographic using tiered fallback approach:
   * 1. SVG extraction (best quality - vector format)
   * 2. Canvas export (PNG raster)
   * 3. Return failure (caller will use button click)
   */
  async function tryExtractInfographic(artifactElement) {
    console.log('[NotebookLM Takeout] [Download] Trying infographic extraction (tiered fallback)...');

    // Only a rendered infographic qualifies; icons or thumbnails in the list
    // row would otherwise replace the real download
    const isLarge = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width >= 200 && rect.height >= 200;
    };

    // TIER 1: Try SVG extraction (vector format - best quality)
    const svg = Array.from(artifactElement.querySelectorAll('svg')).find(isLarge);
    if (svg) {
      console.log('[NotebookLM Takeout] [Download] Found SVG, attempting extraction...');
      try {
        const result = await extractSVGInfographic(svg);
        if (result.success) {
          console.log('[NotebookLM Takeout] [Download] ✓ SVG extraction successful');
          return result;
        }
      } catch (error) {
        console.warn('[NotebookLM Takeout] [Download] SVG extraction failed:', error.message);
      }
    }

    // TIER 2: Try Canvas export (PNG raster)
    const canvas = Array.from(artifactElement.querySelectorAll('canvas')).find(isLarge);
    if (canvas) {
      console.log('[NotebookLM Takeout] [Download] Found canvas, attempting export...');
      try {
        const result = await exportCanvasInfographic(canvas);
        if (result.success) {
          console.log('[NotebookLM Takeout] [Download] ✓ Canvas export successful');
          return result;
        }
      } catch (error) {
        console.warn('[NotebookLM Takeout] [Download] Canvas export failed:', error.message);
      }
    }

    // TIER 3: No extraction possible, return failure (caller will use button)
    console.log('[NotebookLM Takeout] [Download] No SVG or canvas found, extraction not possible');
    return { success: false, method: 'none' };
  }

  /**
   * Extract SVG infographic with embedded styles
   * Similar to mindmap SVG extraction but for infographics
   */
  async function extractSVGInfographic(svg) {
    try {
      // Clone the SVG to modify it
      const svgClone = svg.cloneNode(true);

      // Embed computed styles for all elements (especially text)
      const allElements = svgClone.querySelectorAll('*');
      allElements.forEach((el, idx) => {
        const original = svg.querySelectorAll('*')[idx];
        if (original) {
          const computedStyle = window.getComputedStyle(original);

          // Copy critical properties
          const styleProps = ['fill', 'stroke', 'font-family', 'font-size', 'font-weight', 'opacity', 'fill-opacity'];
          let styleString = styleProps
            .map(prop => `${prop}: ${computedStyle.getPropertyValue(prop)}`)
            .join('; ');

          // Force full opacity for visibility
          styleString += '; fill-opacity: 1 !important; opacity: 1 !important';
          el.setAttribute('style', styleString);
        }
      });

      // Get SVG dimensions using bounding box
      const bbox = svg.getBBox();
      const padding = 10;

      // Calculate viewBox to capture all content with padding
      const viewBoxX = Math.floor(bbox.x - padding);
      const viewBoxY = Math.floor(bbox.y - padding);
      const viewBoxWidth = Math.ceil(bbox.width + (padding * 2));
      const viewBoxHeight = Math.ceil(bbox.height + (padding * 2));

      // Set proper SVG attributes
      svgClone.setAttribute('width', viewBoxWidth);
      svgClone.setAttribute('height', viewBoxHeight);
      svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgClone.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);

      // Serialize to string
      const svgString = new XMLSerializer().serializeToString(svgClone);
      const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

      return {
        success: true,
        method: 'svg_extract',
        data: dataUrl,
        format: 'svg',
        dimensions: { width: viewBoxWidth, height: viewBoxHeight }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Export canvas infographic as PNG
   * Uses canvas.toDataURL() to get image data
   */
  async function exportCanvasInfographic(canvas) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const width = canvas.width;
      const height = canvas.height;

      return {
        success: true,
        method: 'canvas_export',
        data: dataUrl,
        format: 'png',
        dimensions: { width, height }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== CHAT EXPORT FUNCTIONS ====================

  /**
   * Auto-scroll chat panel to load all lazy-loaded messages
   * Returns when message count stabilizes (no new messages after multiple scrolls)
   */
  async function autoScrollChatToTop() {
    console.log('[NotebookLM Takeout] Starting auto-scroll to load all chat messages...');

    // Find chat panel container
    const chatPanel = document.querySelector('chat-panel .chat-panel-content');
    if (!chatPanel) {
      throw new Error('Chat panel not found. Make sure you have the chat open.');
    }

    let previousMessageCount = 0;
    let stableScrollCount = 0;
    const maxStableScrolls = 3; // Number of consecutive scrolls with no new messages
    const scrollStepDelay = 800; // Delay between scroll steps (ms)
    const stabilizationDelay = 1500; // Extra delay to ensure DOM fully loads

    let scrollAttempts = 0;
    const maxScrollAttempts = 100; // Safety limit

    while (scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;

      // Count current messages
      const messagePairs = chatPanel.querySelectorAll('.chat-message-pair');
      const currentMessageCount = messagePairs.length;

      console.log(`[NotebookLM Takeout] Scroll attempt ${scrollAttempts}: ${currentMessageCount} message pairs loaded`);

      // Check if message count has stabilized
      if (currentMessageCount === previousMessageCount) {
        stableScrollCount++;
        console.log(`[NotebookLM Takeout] Message count stable (${stableScrollCount}/${maxStableScrolls})`);

        if (stableScrollCount >= maxStableScrolls) {
          console.log(`[NotebookLM Takeout] ✓ All messages loaded (${currentMessageCount} message pairs)`);
          break;
        }
      } else {
        // New messages loaded, reset stability counter
        stableScrollCount = 0;
        console.log(`[NotebookLM Takeout] New messages loaded (${currentMessageCount - previousMessageCount} new pairs)`);
      }

      previousMessageCount = currentMessageCount;

      // Scroll to top to trigger lazy load
      chatPanel.scrollTo({
        top: 0,
        behavior: 'instant' // Use instant to avoid animation delays
      });

      // Wait for new messages to load
      await sleep(scrollStepDelay);

      // Extra stabilization wait after first few scrolls
      if (scrollAttempts <= 3) {
        await sleep(stabilizationDelay);
      }
    }

    if (scrollAttempts >= maxScrollAttempts) {
      console.warn('[NotebookLM Takeout] WARNING: Reached max scroll attempts. Some messages may not be loaded.');
    }

    // Final wait for DOM to fully stabilize
    await sleep(1000);

    return {
      success: true,
      messageCount: previousMessageCount,
      scrollAttempts: scrollAttempts
    };
  }

  /**
   * Expand all collapsed citations (...) in chat
   */
  async function expandCollapsedCitations() {
    console.log('[NotebookLM Takeout] Looking for collapsed citations (...)...');

    const chatPanel = document.querySelector('chat-panel .chat-panel-content');
    if (!chatPanel) {
      console.warn('[NotebookLM Takeout] Chat panel not found for citation expansion');
      return;
    }

    // Only click groups that are still collapsed. Expanded groups show
    // unfold_less / "Hide additional citations"; clicking those would
    // collapse them again, e.g. when the chat is scanned a second time.
    const findCollapsed = () => Array.from(chatPanel.querySelectorAll('button.citation-marker')).filter(button => {
      const icon = button.querySelector('mat-icon, span');
      return NLME.isCollapsedCitationGroup({ iconText: icon?.textContent, ariaLabel: icon?.getAttribute('aria-label') });
    });

    let collapsedButtons = findCollapsed();
    console.log(`[NotebookLM Takeout] Found ${collapsedButtons.length} collapsed citation groups`);

    if (collapsedButtons.length === 0) {
      console.log('[NotebookLM Takeout] No collapsed citations to expand');
      return;
    }

    // Re-scan after each pass: Angular may re-render a message and replace
    // buttons that were collected before the first click.
    for (let pass = 1; pass <= 3 && collapsedButtons.length > 0; pass++) {
      for (let i = 0; i < collapsedButtons.length; i++) {
        const button = collapsedButtons[i];
        if (!button.isConnected) continue;
        try {
          button.scrollIntoView({ behavior: 'instant', block: 'center' });
          await sleep(100);
          button.click();
          await sleep(300); // Wait for expansion animation
        } catch (error) {
          console.error(`[NotebookLM Takeout] Error expanding citation group ${i + 1}:`, error);
        }
      }
      await sleep(300);
      collapsedButtons = findCollapsed();
      console.log(`[NotebookLM Takeout] Expansion pass ${pass}: ${collapsedButtons.length} collapsed group(s) remain`);
    }

    // Final wait for all expansions to complete
    await sleep(500);
    console.log('[NotebookLM Takeout] All collapsed citations expanded');
  }

  /**
   * Scan chat panel for all messages
   * Message handler: responds to 'SCAN_CHAT'
   */
  async function scanChat() {
    console.log('[NotebookLM Takeout] Starting chat scan...');

    try {
      // Step 1: Auto-scroll to load all messages
      console.log('[NotebookLM Takeout] Step 1: Auto-scrolling to load all messages...');
      const scrollResult = await autoScrollChatToTop();
      console.log('[NotebookLM Takeout] ✓ Auto-scroll complete:', scrollResult);

      // Step 2: Expand all collapsed citations (...)
      console.log('[NotebookLM Takeout] Step 2: Expanding collapsed citations...');
      await expandCollapsedCitations();
      console.log('[NotebookLM Takeout] ✓ Collapsed citations expanded');

      // Step 3: Extract all messages
      console.log('[NotebookLM Takeout] Step 3: Extracting messages...');
      const chatData = extractChatMessages();
      const panel = document.querySelector('chat-panel .chat-panel-content');
      chatData.stats.reachedTop = !!scrollResult?.success;
      chatData.stats.collapsedRemaining = panel
        ? Array.from(panel.querySelectorAll('button.citation-marker')).filter(button => {
            const icon = button.querySelector('mat-icon, span');
            return NLME.isCollapsedCitationGroup({ iconText: icon?.textContent, ariaLabel: icon?.getAttribute('aria-label') });
          }).length
        : 0;

      return {
        success: true,
        chatData: chatData
      };

    } catch (error) {
      console.error('[NotebookLM Takeout] Chat scan failed:', error);
      return {
        error: error.message || 'Failed to scan chat'
      };
    }
  }

  /**
   * Extract all chat messages from the DOM
   */
  function extractChatMessages() {
    const chatPanel = document.querySelector('chat-panel .chat-panel-content');
    if (!chatPanel) {
      throw new Error('Chat panel not found');
    }

    // Get notebook title — use the same selector list as GET_PROJECT_NAME so
    // chat exports match the filenames used by notes/sources exports.
    // One chain for file names, chat export and the health check
    const titleSelectors = NLME.PROJECT_TITLE_SELECTORS;
    let notebookTitle = 'NotebookLM';
    for (const selector of titleSelectors) {
      const titleEl = document.querySelector(selector);
      const text = titleEl?.textContent?.trim();
      if (text) { notebookTitle = text; break; }
    }

    // Get notebook summary (if present)
    let notebookSummary = null;
    const summaryEl = document.querySelector('.notebook-summary .summary-content');
    if (summaryEl) {
      // Convert summary HTML to markdown using the same converter as citations
      notebookSummary = htmlToMarkdown(summaryEl);
      console.log('[NotebookLM Takeout] Found notebook summary:', notebookSummary.substring(0, 100) + '...');
    }

    // Extract date separators and message pairs, in document order at any
    // depth (walking only direct children silently drops pairs if Gemini
    // Notebook wraps them; Milestone 2, Resilience #2)
    const messagePairs = [];
    const skipped = [];
    const elements = Array.from(chatPanel.querySelectorAll('.chat-message-pair, .date-separator'));
    // Live DOM position of each pair, used later to find its citation buttons.
    // Pairs that fail extraction are skipped, so the array index can't be used.
    const livePairs = Array.from(chatPanel.querySelectorAll('.chat-message-pair'));

    let currentDate = null;

    for (const el of elements) {
      // Check for date separator
      if (el.classList.contains('date-separator')) {
        const rawDate = el.textContent.trim();
        // Normalize relative dates like "Today • 11:28 AM" to actual dates
        currentDate = normalizeChatDate(rawDate);
        console.log('[NotebookLM Takeout] Found date:', rawDate, '→', currentDate);
        continue;
      }

      // Check for message pair
      if (el.classList.contains('chat-message-pair')) {
        const pair = extractMessagePair(el, currentDate);
        if (pair) {
          pair.domIndex = livePairs.indexOf(el);
          messagePairs.push(pair);
        } else {
          skipped.push(`Message ${livePairs.indexOf(el) + 1} could not be read and was skipped`);
        }
      }
    }

    console.log(`[NotebookLM Takeout] Extracted ${messagePairs.length} message pairs`);

    // Get date range
    const dates = messagePairs.filter(p => p.date).map(p => p.date);
    const dateRange = dates.length > 0 ? {
      first: dates[0],
      last: dates[dates.length - 1]
    } : null;

    return {
      notebookTitle: notebookTitle,
      notebookSummary: notebookSummary,
      messagePairs: messagePairs,
      dateRange: dateRange,
      extractedAt: new Date().toISOString(),
      // Completeness for the scan result, errors.txt and the audit
      stats: {
        pairsInDom: livePairs.length,
        pairsExtracted: messagePairs.length,
        skipped
      }
    };
  }

  /**
   * Normalize chat date strings from relative dates to absolute dates
   * Converts "Today • 11:28 AM" → "2026-03-01 • 11:28 AM" (actual date + time)
   * Converts "Yesterday • 2:30 PM" → "2026-02-28 • 2:30 PM" (actual date + time)
   */
  function normalizeChatDate(rawDate) {
    if (!rawDate) return null;

    const now = new Date();

    // Split into date part and time part (separated by bullet •)
    const parts = rawDate.split('•');
    const datePart = parts[0].trim();
    const timePart = parts.length > 1 ? '• ' + parts[1].trim() : '';

    // Check for "Today"
    if (datePart.toLowerCase() === 'today') {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day} ${timePart}`.trim();
    }

    // Check for "Yesterday"
    if (datePart.toLowerCase() === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const year = yesterday.getFullYear();
      const month = String(yesterday.getMonth() + 1).padStart(2, '0');
      const day = String(yesterday.getDate()).padStart(2, '0');
      return `${year}-${month}-${day} ${timePart}`.trim();
    }

    // For other dates (e.g., "March 1 • 3:00 PM"), try to parse and format
    try {
      // Try parsing as a date (will handle formats like "March 1", "Mar 1", etc.)
      const parsed = new Date(datePart + ', ' + now.getFullYear());

      // Check if parsing was successful
      if (!isNaN(parsed.getTime())) {
        // If the parsed date is in the future (more than 1 day ahead), it's probably from last year
        // This handles year boundaries: e.g., if today is Jan 5, 2026 and message says "Dec 28",
        // it means Dec 28, 2025, not Dec 28, 2026
        if (parsed > now && (parsed - now) > 86400000) { // 86400000ms = 1 day
          parsed.setFullYear(parsed.getFullYear() - 1);
        }

        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day} ${timePart}`.trim();
      }
    } catch (e) {
      // If parsing fails, just return the original
      console.warn('[NotebookLM Takeout] Could not parse date:', rawDate);
    }

    // Fallback: return original if we can't parse it
    return rawDate;
  }

  /**
   * Extract a single message pair (user question + AI response)
   */
  function extractMessagePair(pairElement, currentDate) {
    console.log('[NotebookLM Takeout] Extracting message pair...');

    try {
      // Find user message
      const userMessageEl = pairElement.querySelector('.from-user-container .message-text-content');
      if (!userMessageEl) {
        console.warn('[NotebookLM Takeout] No user message found in pair');
        return null;
      }

      // Find AI response
      const aiMessageEl = pairElement.querySelector('.to-user-container .message-text-content');
      if (!aiMessageEl) {
        console.warn('[NotebookLM Takeout] No AI message found in pair');
        return null;
      }

      // Extract user message text (simple text extraction)
      const userMessage = userMessageEl.textContent.trim();

      // Extract AI response HTML (includes structural elements and citations)
      const aiResponseHTML = aiMessageEl.innerHTML;

      // Count citations
      const citationButtons = aiMessageEl.querySelectorAll('button.citation-marker');
      console.log(`[NotebookLM Takeout] Found ${citationButtons.length} citations in AI response`);

      return {
        date: currentDate,
        userMessage: userMessage,
        aiResponseHTML: aiResponseHTML,
        citationCount: citationButtons.length
      };

    } catch (error) {
      console.error('[NotebookLM Takeout] Error extracting message pair:', error);
      return null;
    }
  }

  /**
   * Extract citations for a specific message by finding matching buttons in live DOM
   * @param {number} messageIndex - Index of the message (for logging only)
   * @param {string} messageHTML - The HTML content of the AI response (for extracting aria-labels)
   * @param {Array<string>} sourceIndices - Array of source indices to extract
   * @param {boolean} includeCitationImages - Whether to embed images as base64 in citations
   * @returns {Promise<{sourcesByIndex: Object, errors: Array}>}
   */
  async function extractMessageCitations(messageIndex, messageHTML, sourceIndices, includeCitationImages = false) {
    console.log(`[NotebookLM Takeout] extractMessageCitations called for message ${messageIndex}`);
    console.log(`[NotebookLM Takeout] Source indices:`, sourceIndices);
    console.log(`[NotebookLM Takeout] Message HTML length:`, messageHTML?.length || 0);
    console.log(`[NotebookLM Takeout] Include citation images:`, includeCitationImages);

    const sourcesByIndex = {};
    const errors = [];

    try {
      // Parse message HTML to get aria-labels for the sources we need
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = messageHTML;
      const parsedButtons = tempDiv.querySelectorAll('button.citation-marker');

      const sourceAriaLabels = new Map(); // sourceIndex -> aria-label
      parsedButtons.forEach(btn => {
        const span = btn.querySelector('span');
        const idx = span?.textContent?.trim();
        const ariaLabel = span?.getAttribute('aria-label');

        // Validate sourceIndex before processing
        const isValid = idx &&
                       ariaLabel &&
                       sourceIndices.includes(idx) &&
                       !idx.includes('<') &&
                       !idx.includes('>') &&
                       /^[0-9]+$/.test(idx);

        if (isValid) {
          sourceAriaLabels.set(idx, ariaLabel);
        } else if (idx && sourceIndices.includes(idx)) {
          console.warn(`[NotebookLM Takeout] Skipping invalid sourceIndex in HTML: "${idx}"`);
          errors.push(`Source ${idx}: Invalid source index format`);
        }
      });

      console.log(`[NotebookLM Takeout] Extracted ${sourceAriaLabels.size} valid aria-labels from message HTML`);

      // Find the specific message pair element in the live DOM
      const chatPanel = document.querySelector('chat-panel .chat-panel-content');
      if (!chatPanel) {
        throw new Error('Chat panel not found');
      }

      const messagePairs = chatPanel.querySelectorAll('.chat-message-pair');
      const targetMessagePair = messagePairs[messageIndex];

      if (!targetMessagePair) {
        console.error(`[NotebookLM Takeout] Could not find message pair at index ${messageIndex}`);
        errors.push(`Message ${messageIndex}: Could not find message pair in DOM`);
        return { sourcesByIndex, errors };
      }

      // Only search for citation buttons WITHIN this specific message pair
      const messageLiveButtons = targetMessagePair.querySelectorAll('.to-user-container button.citation-marker');
      console.log(`[NotebookLM Takeout] Found ${messageLiveButtons.length} citation buttons in message ${messageIndex}`);

      // Match buttons by aria-label (only within this message)
      const buttonsToExtract = new Map(); // sourceIndex -> button element

      messageLiveButtons.forEach(btn => {
        const span = btn.querySelector('span');
        const spanText = span?.textContent?.trim();
        const ariaLabel = span?.getAttribute('aria-label');

        // Skip buttons with invalid sourceIndex
        if (spanText && (spanText.includes('<') || spanText.includes('>') || !/^[0-9]+$/.test(spanText))) {
          return;
        }

        // Check if this button matches any of our target sources
        sourceAriaLabels.forEach((targetAriaLabel, sourceIndex) => {
          if (ariaLabel === targetAriaLabel && !buttonsToExtract.has(sourceIndex)) {
            buttonsToExtract.set(sourceIndex, btn);
            console.log(`[NotebookLM Takeout] Matched source ${sourceIndex} by aria-label: "${ariaLabel}"`);
          }
        });
      });

      console.log(`[NotebookLM Takeout] Matched ${buttonsToExtract.size} buttons in message ${messageIndex}`);

      // Extract from matched live buttons with retry logic
      for (const [sourceIndex, button] of buttonsToExtract.entries()) {
        if (isExportCancelled()) break; // stop within one citation of Cancel
        console.log(`[NotebookLM Takeout] Extracting source ${sourceIndex} from live button...`);

        // Use retry helper for citation extraction
        const result = await extractSingleCitationWithRetry(button, sourceIndex, includeCitationImages, 3);

        if (result.success) {
          sourcesByIndex[sourceIndex] = {
            text: result.data.text,
            quote: result.data.quote
          };
          console.log(`[NotebookLM Takeout] ✓ Source ${sourceIndex}: "${result.data.text}" (${result.data.quote.length} chars)`);
        } else {
          errors.push(result.error);
        }

        // No pacing sleep: hovers make no Gemini Notebook data requests
        // (measured Nov 2026); ensureTooltipGone already orders them
      }

    } catch (error) {
      console.error(`[NotebookLM Takeout] Fatal error in extractMessageCitations:`, error);
      errors.push(`Fatal error: ${error.message}`);
    }

    console.log(`[NotebookLM Takeout] Extracted ${Object.keys(sourcesByIndex).length} sources for message ${messageIndex}`);

    return {
      sourcesByIndex: sourcesByIndex,
      errors: errors
    };
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
