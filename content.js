// NotebookLM Takeout - Content Script

(function() {
  'use strict';

  console.log('[NotebookLM Takeout] Content script loaded');

  // Configuration - Based on Angular Material components used by NotebookLM
  const CONFIG = {
    observerDebounce: 500,
    selectors: {
      // Angular Material components
      matButton: '.mat-mdc-button-base, .mdc-button, .mat-tonal-button, .mat-icon-button',
      matMenu: '.mat-mdc-menu-panel, .mat-menu-panel, .cdk-overlay-pane',
      matMenuItem: '.mat-mdc-menu-item, .mat-menu-item',
      matIcon: '.mat-icon, .material-icons',

      // Studio panel and artifacts
      studioPanel: '[class*="studio"], [class*="Studio"], [role="tabpanel"]',
      artifactContent: '.artifact-content, .artifact-content-scrollable, [class*="artifact"]',

      // Audio elements
      audioPlayer: 'audio, [class*="audio"], [class*="Audio"], [class*="overview"]',
      audioContainer: '[class*="audio-overview"], [class*="AudioOverview"], [class*="podcast"]',

      // Slide elements
      slideContainer: '[class*="slide"], [class*="Slide"], [class*="deck"], [class*="Deck"], [class*="presentation"]',

      // Infographic elements
      infographicContainer: '[class*="infographic"], [class*="Infographic"], [class*="visual"]',

      // Common UI elements
      moreOptionsButton: 'button[aria-label*="More"], button[aria-label*="more"], button[aria-label*="Options"], [class*="more-vert"], [class*="three-dot"]',
      downloadButton: '[aria-label*="Download"], [aria-label*="download"], [data-action="download"]',
      downloadMenuItem: '.mat-mdc-menu-item:has-text("Download"), .mat-menu-item:has-text("Download")',

      // Title elements
      notebookTitle: 'h1, [class*="notebook-title"], [class*="NotebookTitle"], [class*="header-title"]',

      // Close button (useful for detecting open panels)
      closeButton: 'button[aria-label*="Close"], button[aria-label*="close"]'
    }
  };

  // Track detected artifacts
  const detectedArtifacts = new Map();

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
  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

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
        const titleSelectors = [
          '.title-label-inner', // Primary selector based on user's HTML
          'editable-project-title .title-label span',
          '.title-container .title span',
          '[class*="title-label"]'
        ];

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
    } else if (message.type === 'TRIGGER_DOWNLOAD') {
      triggerDownload(message.data.artifactType, message.data.artifact);
      sendResponse({ success: true });
    } else if (message.type === 'DEBUG_PAGE') {
      debugPageStructure();
      sendResponse({ success: true });
    } else if (message.type === 'SCAN_ARTIFACTS') {
      scanForArtifacts();
      sendResponse({ success: true });
    } else if (message.type === 'FETCH_FILE') {
      // Fetch file with page credentials - used by batch download
      fetchFileWithCredentials(message.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async
    } else if (message.type === 'EXTRACT_NOTE') {
      // Extract note content
      extractNoteContent(message.data.noteIndex, message.data.noteTitle, message.data.includeCitationImages)
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
      extractSourceContent(message.data.sourceIndex)
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
    } else if (message.type === 'CHECK_EXPORT_CANCELLED') {
      sendResponse({ cancelled: isExportCancelled() });
      return true;
    } else if (message.type === 'DEBUG_NOTES') {
      // Diagnostic: list all note titles with fallback selectors
      let allNoteElements = document.querySelectorAll('artifact-library-note');
      console.log(`[NotebookLM Takeout] DEBUG: Direct selector found ${allNoteElements.length} notes`);

      // Fallback via container
      if (allNoteElements.length === 0) {
        const container = document.querySelector('.artifact-library-container artifact-library');
        if (container) {
          allNoteElements = container.querySelectorAll('artifact-library-note');
          console.log(`[NotebookLM Takeout] DEBUG: Via container found ${allNoteElements.length} notes`);
        }
      }

      // Fallback via icon
      if (allNoteElements.length === 0) {
        const noteIcons = document.querySelectorAll('mat-icon.artifact-icon');
        const noteParents = [];
        noteIcons.forEach(icon => {
          const iconText = icon.textContent.trim();
          if (iconText === 'sticky_note_2' || iconText === 'flowchart') {
            const noteEl = icon.closest('artifact-library-note');
            if (noteEl && !noteParents.includes(noteEl)) {
              noteParents.push(noteEl);
            }
          }
        });
        allNoteElements = noteParents;
        console.log(`[NotebookLM Takeout] DEBUG: Via icon search found ${allNoteElements.length} notes`);
      }

      const titles = [];
      allNoteElements.forEach((el, idx) => {
        const titleEl = el.querySelector('.artifact-title, .note-title');
        const title = titleEl?.textContent?.trim();
        titles.push({ index: idx, title: title });
      });
      console.log('[NotebookLM Takeout] DEBUG: All notes:', titles);
      sendResponse({ notes: titles, count: allNoteElements.length });
      return true;
    } else if (message.type === 'DOWNLOAD_ARTIFACT') {
      // Download artifact via message passing (new pattern)
      handleArtifactDownload(
        message.data.artifactIndex,
        message.data.artifactType,
        message.data.moreButtonAlreadyClicked || false,
        message.data.skipMoreButton || false,
        message.data.artifactName || null
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
    } else if (message.type === 'EXTRACT_ALL_CHAT_CITATIONS') {
      // Extract ALL citations from chat at once (much more efficient)
      console.log('[NotebookLM Takeout] ====== EXTRACT_ALL_CHAT_CITATIONS message received ======');

      try {
        extractAllChatCitations()
          .then(result => {
            console.log('[NotebookLM Takeout] ====== All citations extracted ======');
            console.log('[NotebookLM Takeout] Result:', result);
            sendResponse(result);
          })
          .catch(error => {
            console.error('[NotebookLM Takeout] ====== All citations extraction error ======', error);
            console.error('[NotebookLM Takeout] Error stack:', error.stack);
            sendResponse({ sourcesByIndex: {}, errors: [error.message] });
          });
      } catch (error) {
        console.error('[NotebookLM Takeout] ====== All citations extraction SYNC error ======', error);
        console.error('[NotebookLM Takeout] Error stack:', error.stack);
        sendResponse({ sourcesByIndex: {}, errors: [error.message] });
      }
      return true;
    } else if (message.type === 'EXTRACT_MESSAGE_CITATIONS') {
      // Extract citations for a specific message
      console.log('[NotebookLM Takeout] ====== EXTRACT_MESSAGE_CITATIONS message received ======');
      console.log('[NotebookLM Takeout] Message index:', message.data.messageIndex);
      console.log('[NotebookLM Takeout] Source indices:', message.data.sourceIndices);
      console.log('[NotebookLM Takeout] Message HTML length:', message.data.messageHTML?.length || 0);
      console.log('[NotebookLM Takeout] Include citation images:', message.data.includeCitationImages);

      try {
        extractMessageCitations(
          message.data.messageIndex,
          message.data.messageHTML,
          message.data.sourceIndices,
          message.data.includeCitationImages || false
        )
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
        notes: ['artifact-library-note', '.artifact-library-container'],
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
      // Resolve by label (preferred when provided — resilient to index shifts)
      // or by combined DOM index as a fallback.
      deleteStudioItem(message.data || {})
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

  function triggerDownload(type, artifact) {
    console.log('[NotebookLM Takeout] Triggering download:', type);

    // If artifact has a "moreButton" reference, we can't use it directly
    // Instead, find more buttons on the page and click them
    const moreButtons = document.querySelectorAll(CONFIG.selectors.moreOptionsButton);
    console.log(`[NotebookLM Takeout] Found ${moreButtons.length} more buttons`);

    if (moreButtons.length > 0) {
      // Click the first more button to open menu
      moreButtons[0].click();

      // Wait for menu to open, then find Download option
      setTimeout(() => {
        const menuItems = document.querySelectorAll('.mat-mdc-menu-item, .mat-menu-item, [role="menuitem"], .cdk-overlay-pane button');
        console.log(`[NotebookLM Takeout] Found ${menuItems.length} menu items`);

        for (const item of menuItems) {
          const text = item.textContent?.toLowerCase() || '';
          console.log(`[NotebookLM Takeout] Menu item: "${text}"`);

          if (text.includes('download')) {
            item.click();
            showNotification('Download started', 'success');
            return;
          }
        }

        showNotification('Download option not found in menu', 'error');
      }, 500);
    } else {
      // Try direct export functions
      if (type === 'audio') {
        exportAudio(artifact);
      } else if (type === 'slides') {
        exportSlides(artifact);
      } else if (type === 'infographics') {
        exportInfographic(artifact);
      }
    }
  }

  // Store for intercepted download URLs (from window.open interception)
  let lastInterceptedDownloadUrl = null;
  let downloadUrlResolvers = []; // Callbacks waiting for intercepted URLs

  function handleInjectedMessage(data) {
    switch (data.type) {
      case 'NLME_AUDIO_DETECTED':
        captureArtifact('audio', data.payload);
        break;
      case 'NLME_SLIDES_DETECTED':
        captureArtifact('slides', data.payload);
        break;
      case 'NLME_INFOGRAPHIC_DETECTED':
        captureArtifact('infographics', data.payload);
        break;
      case 'NLME_NETWORK_RESPONSE':
        parseNetworkResponse(data.payload);
        break;
      case 'NLME_DOWNLOAD_URL_INTERCEPTED':
        // URL intercepted from window.open - no tab will open
        console.log('[NotebookLM Takeout] Download URL intercepted:', data.payload.url?.substring(0, 100));
        lastInterceptedDownloadUrl = data.payload.url;
        // Resolve any waiting promises
        while (downloadUrlResolvers.length > 0) {
          const resolver = downloadUrlResolvers.shift();
          resolver(data.payload.url);
        }
        break;
    }
  }

  /**
   * Wait for an intercepted download URL (with timeout)
   */
  function waitForInterceptedUrl(timeoutMs = 3000) {
    return new Promise((resolve) => {
      // Check if we already have a recent URL
      if (lastInterceptedDownloadUrl) {
        const url = lastInterceptedDownloadUrl;
        lastInterceptedDownloadUrl = null; // Consume it
        resolve(url);
        return;
      }

      // Set up timeout
      const timeout = setTimeout(() => {
        const index = downloadUrlResolvers.indexOf(resolverFn);
        if (index > -1) downloadUrlResolvers.splice(index, 1);
        resolve(null); // Timeout - no URL intercepted
      }, timeoutMs);

      // Add resolver to wait list
      const resolverFn = (url) => {
        clearTimeout(timeout);
        resolve(url);
      };
      downloadUrlResolvers.push(resolverFn);
    });
  }

  function captureArtifact(type, artifact) {
    const id = artifact.id || `${type}-${Date.now()}`;

    if (!detectedArtifacts.has(id)) {
      detectedArtifacts.set(id, { type, ...artifact });

      // Notify background script
      chrome.runtime.sendMessage({
        type: 'ARTIFACT_DETECTED',
        data: {
          type,
          artifact: {
            id,
            ...artifact,
            pageUrl: window.location.href,
            notebookTitle: getNotebookTitle()
          }
        }
      });
    }
  }

  function getNotebookTitle() {
    const titleEl = document.querySelector(CONFIG.selectors.notebookTitle);
    return titleEl?.textContent?.trim() || 'Untitled Notebook';
  }

  async function exportArtifact(type, artifact) {
    console.log(`[NotebookLM Takeout] Exporting ${type}:`, artifact);

    try {
      switch (type) {
        case 'audio':
          await exportAudio(artifact);
          break;
        case 'slides':
          await exportSlides(artifact);
          break;
        case 'infographics':
          await exportInfographic(artifact);
          break;
      }
    } catch (error) {
      console.error(`[NotebookLM Takeout] Export failed:`, error);
      showNotification('Export failed: ' + error.message, 'error');
    }
  }

  async function exportAudio(artifact) {
    // Find audio element
    const audioEl = document.querySelector('audio');
    if (audioEl && audioEl.src) {
      const filename = `${getNotebookTitle()}-audio-overview.mp3`;

      // If it's a blob URL, convert to data URL first
      if (audioEl.src.startsWith('blob:')) {
        try {
          showNotification('Converting audio...', 'info');
          const response = await fetch(audioEl.src);
          const blob = await response.blob();
          const dataUrl = await blobToDataURL(blob);

          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_ARTIFACT',
            data: {
              url: dataUrl,
              filename: filename,
              type: 'dataurl'
            }
          });
          showNotification('Downloading audio...', 'success');
        } catch (e) {
          console.error('Blob conversion failed:', e);
          // Fallback: try to find download button
          triggerNativeDownload();
        }
      } else {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_ARTIFACT',
          data: {
            url: audioEl.src,
            filename: filename,
            type: 'url'
          }
        });
        showNotification('Downloading audio...', 'success');
      }
    } else {
      triggerNativeDownload();
    }
  }

  function triggerNativeDownload() {
    const downloadBtn = document.querySelector('[aria-label*="Download"], [class*="download"]');
    if (downloadBtn) {
      downloadBtn.click();
      showNotification('Triggered download...', 'success');
    } else {
      throw new Error('Audio source not found');
    }
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function exportSlides(artifact) {
    // Method 1: Look for existing download/export button
    const downloadBtn = findSlideDownloadButton();
    if (downloadBtn) {
      downloadBtn.click();
      showNotification('Downloading slides...', 'success');
      return;
    }

    // Method 2: Capture slides as images
    const slideElements = document.querySelectorAll('[class*="slide"]:not([class*="slider"])');
    if (slideElements.length > 0) {
      showNotification(`Found ${slideElements.length} slides. Capturing...`, 'info');

      // Request capture via injected script
      window.postMessage({
        type: 'NLME_CAPTURE_SLIDES',
        payload: { notebookTitle: getNotebookTitle() }
      }, '*');
    } else {
      throw new Error('Slides not found on page');
    }
  }

  function findSlideDownloadButton() {
    // Common patterns for download buttons
    const patterns = [
      '[aria-label*="Download"]',
      '[aria-label*="Export"]',
      '[data-action="download"]',
      'button:has(svg[class*="download"])',
      '[class*="download-btn"]',
      '[class*="export-btn"]'
    ];

    for (const pattern of patterns) {
      try {
        const btn = document.querySelector(pattern);
        if (btn) return btn;
      } catch (e) {
        // Some selectors might not be supported
      }
    }
    return null;
  }

  async function exportInfographic(artifact) {
    // Method 1: Find canvas and export
    const canvas = document.querySelector('canvas');
    if (canvas) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const filename = `${getNotebookTitle()}-infographic.png`;

        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_ARTIFACT',
          data: {
            url: dataUrl,
            filename: filename,
            type: 'dataurl'
          }
        });

        showNotification('Downloading infographic...', 'success');
        return;
      } catch (e) {
        console.error('Canvas export failed:', e);
      }
    }

    // Method 2: Find SVG and export
    const svg = document.querySelector('[class*="infographic"] svg, [class*="Infographic"] svg');
    if (svg) {
      const svgData = new XMLSerializer().serializeToString(svg);
      // Convert SVG to data URL directly (no blob needed)
      const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
      const filename = `${getNotebookTitle()}-infographic.svg`;

      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ARTIFACT',
        data: {
          url: dataUrl,
          filename: filename,
          type: 'dataurl'
        }
      });

      showNotification('Downloading infographic...', 'success');
      return;
    }

    // Method 3: Look for download button
    const downloadBtn = document.querySelector('[class*="infographic"] [aria-label*="Download"]');
    if (downloadBtn) {
      downloadBtn.click();
      showNotification('Triggered download...', 'success');
      return;
    }

    throw new Error('Infographic not found');
  }

  function showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.querySelector('.nlme-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `nlme-notification nlme-notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('nlme-notification-hide');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Monitor DOM for new artifacts
  function setupMutationObserver() {
    let debounceTimer;

    const observer = new MutationObserver((mutations) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanForArtifacts();
      }, CONFIG.observerDebounce);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function scanForArtifacts() {
    console.log('[NotebookLM Takeout] Scanning for artifacts...');

    // Scan for audio elements
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach((el, index) => {
      if (el.src) {
        console.log(`[NotebookLM Takeout] Found audio: ${el.src.substring(0, 50)}...`);
        captureArtifact('audio', {
          id: `audio-${index}`,
          src: el.src,
          title: getNotebookTitle() + ' - Audio Overview'
        });
      }
    });

    // Scan for audio containers (may not have <audio> element yet)
    const audioContainers = document.querySelectorAll(CONFIG.selectors.audioContainer);
    audioContainers.forEach((el, index) => {
      const hasMoreButton = el.querySelector(CONFIG.selectors.moreOptionsButton);
      if (hasMoreButton) {
        captureArtifact('audio', {
          id: `audio-container-${index}`,
          element: el,
          moreButton: hasMoreButton,
          title: getNotebookTitle() + ' - Audio Overview'
        });
      }
    });

    // Scan for slide containers
    const slideContainers = document.querySelectorAll(CONFIG.selectors.slideContainer);
    slideContainers.forEach((el, index) => {
      // Check if it's a meaningful slide container (not just any element with "slide" in class)
      const hasContent = el.querySelector('img, canvas, svg, [class*="content"]');
      const hasMoreButton = el.querySelector(CONFIG.selectors.moreOptionsButton);
      if (hasContent || hasMoreButton) {
        captureArtifact('slides', {
          id: `slides-${index}`,
          element: el,
          moreButton: hasMoreButton,
          title: getNotebookTitle() + ' - Slides'
        });
      }
    });

    // Scan for infographic containers
    const infographicContainers = document.querySelectorAll(CONFIG.selectors.infographicContainer);
    infographicContainers.forEach((el, index) => {
      const hasCanvas = el.querySelector('canvas');
      const hasSvg = el.querySelector('svg');
      const hasMoreButton = el.querySelector(CONFIG.selectors.moreOptionsButton);
      if (hasCanvas || hasSvg || hasMoreButton) {
        captureArtifact('infographics', {
          id: `infographic-${index}`,
          element: el,
          moreButton: hasMoreButton,
          title: getNotebookTitle() + ' - Infographic'
        });
      }
    });

    // Also scan for any "three-dot" more menus in the Studio panel area
    scanStudioPanel();
  }

  function scanStudioPanel() {
    // Look for the Studio panel
    const studioPanels = document.querySelectorAll(CONFIG.selectors.studioPanel);
    studioPanels.forEach(panel => {
      // Find all "more options" buttons within studio
      const moreButtons = panel.querySelectorAll(CONFIG.selectors.moreOptionsButton);
      moreButtons.forEach((btn, index) => {
        // Try to determine what type of artifact this button is for
        const container = btn.closest('[class*="audio"], [class*="slide"], [class*="infographic"], [class*="overview"], [class*="deck"]');
        if (container) {
          const className = container.className.toLowerCase();
          let type = 'unknown';
          if (className.includes('audio') || className.includes('overview') || className.includes('podcast')) {
            type = 'audio';
          } else if (className.includes('slide') || className.includes('deck') || className.includes('presentation')) {
            type = 'slides';
          } else if (className.includes('infographic') || className.includes('visual')) {
            type = 'infographics';
          }

          if (type !== 'unknown') {
            captureArtifact(type, {
              id: `studio-${type}-${index}`,
              element: container,
              moreButton: btn,
              title: getNotebookTitle() + ' - ' + type
            });
          }
        }
      });
    });
  }

  // Initialize
  function init() {
    console.log('[NotebookLM Takeout] Initializing...');

    // Inject page script for XHR/fetch interception
    injectPageScript();

    // Setup mutation observer
    setupMutationObserver();

    // Initial scan
    setTimeout(scanForArtifacts, 1000);

    // Periodic rescan
    setInterval(scanForArtifacts, 5000);

    // Debug: Log page structure
    setTimeout(debugPageStructure, 2000);

    console.log('[NotebookLM Takeout] Ready');
  }

  // Debug function to help identify correct selectors
  function debugPageStructure() {
    console.log('[NotebookLM Takeout] === DEBUG: Page Structure ===');

    // Find all audio elements
    const audios = document.querySelectorAll('audio');
    console.log(`[DEBUG] Audio elements: ${audios.length}`);
    audios.forEach((a, i) => console.log(`  Audio ${i}: src=${a.src?.substring(0, 80)}...`));

    // Find all video elements
    const videos = document.querySelectorAll('video');
    console.log(`[DEBUG] Video elements: ${videos.length}`);
    videos.forEach((v, i) => console.log(`  Video ${i}: src=${v.src?.substring(0, 80)}...`));

    // Find Angular Material buttons
    const matButtons = document.querySelectorAll('.mat-mdc-button-base, .mdc-button, .mat-icon-button');
    console.log(`[DEBUG] Material buttons: ${matButtons.length}`);

    // Find buttons with aria-labels (very important for NotebookLM)
    const ariaButtons = document.querySelectorAll('button[aria-label]');
    console.log(`[DEBUG] Buttons with aria-label: ${ariaButtons.length}`);
    const ariaLabels = new Set();
    ariaButtons.forEach(btn => ariaLabels.add(btn.getAttribute('aria-label')));
    console.log('[DEBUG] Aria labels found:', Array.from(ariaLabels));

    // Find canvas elements
    const canvases = document.querySelectorAll('canvas');
    console.log(`[DEBUG] Canvas elements: ${canvases.length}`);
    canvases.forEach((c, i) => console.log(`  Canvas ${i}: ${c.width}x${c.height}, parent class: ${c.parentElement?.className?.substring(0, 50)}`));

    // Find iframes (sometimes used for embedded content)
    const iframes = document.querySelectorAll('iframe');
    console.log(`[DEBUG] Iframes: ${iframes.length}`);
    iframes.forEach((f, i) => console.log(`  Iframe ${i}: src=${f.src?.substring(0, 80)}`));

    // Find all elements with data attributes containing relevant terms
    const dataElements = document.querySelectorAll('[data-type], [data-id], [data-content-type]');
    console.log(`[DEBUG] Elements with data attributes: ${dataElements.length}`);
    dataElements.forEach((el, i) => {
      if (i < 10) {
        const attrs = Array.from(el.attributes).filter(a => a.name.startsWith('data-')).map(a => `${a.name}="${a.value}"`).join(', ');
        console.log(`  ${el.tagName}: ${attrs}`);
      }
    });

    // Find role attributes
    const roleElements = document.querySelectorAll('[role="tabpanel"], [role="tab"], [role="dialog"], [role="menu"]');
    console.log(`[DEBUG] Elements with role attr: ${roleElements.length}`);
    roleElements.forEach((el, i) => {
      if (i < 10) console.log(`  ${el.tagName} role="${el.getAttribute('role')}" class="${el.className?.substring(0, 50)}"`);
    });

    // Search for key class patterns
    const patterns = ['audio', 'slide', 'deck', 'studio', 'overview', 'infographic', 'artifact', 'export', 'download', 'panel', 'card'];
    patterns.forEach(pattern => {
      const elements = document.querySelectorAll(`[class*="${pattern}" i]`);
      if (elements.length > 0) {
        console.log(`[DEBUG] Elements with "${pattern}" in class: ${elements.length}`);
        elements.forEach((el, i) => {
          if (i < 3) console.log(`  ${el.tagName}: ${el.className?.substring(0, 80)}`);
        });
      }
    });

    // Find all unique class names
    const allElements = document.querySelectorAll('*');
    const relevantClasses = new Set();
    allElements.forEach(el => {
      if (el.className && typeof el.className === 'string') {
        el.className.split(' ').forEach(c => {
          if (c && c.match(/audio|slide|deck|studio|overview|infographic|export|download|artifact|panel|card|media|player/i)) {
            relevantClasses.add(c);
          }
        });
      }
    });
    console.log('[DEBUG] All relevant class names:', Array.from(relevantClasses).sort());

    // Check for blob URLs in the page
    const allSrcs = document.querySelectorAll('[src]');
    const blobUrls = [];
    allSrcs.forEach(el => {
      if (el.src && el.src.startsWith('blob:')) {
        blobUrls.push({ tag: el.tagName, src: el.src });
      }
    });
    console.log(`[DEBUG] Blob URLs found: ${blobUrls.length}`);
    blobUrls.forEach(b => console.log(`  ${b.tag}: ${b.src}`));

    console.log('[NotebookLM Takeout] === END DEBUG ===');
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
        // Notes use sticky_note_2, Mindmaps use flowchart
        if (iconText === 'sticky_note_2' || iconText === 'flowchart') {
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
      } else if (iconType === 'description' || iconType === 'note') {
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
      return { sources: [] };
    }

    const sources = [];

    sourceContainers.forEach((container, index) => {
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

    console.log(`[NotebookLM Takeout] Total sources found: ${sources.length}`);
    return { sources: sources };
  }

  // Helper function to wait for an element
  function waitForElement(selector, timeout = 5000, parent = document) {
    let observer = null;
    let timeoutId = null;

    const promise = new Promise((resolve, reject) => {
      const existingEl = parent.querySelector(selector);
      if (existingEl) {
        resolve(existingEl);
        return;
      }

      observer = new MutationObserver((mutations, obs) => {
        const el = parent.querySelector(selector);
        if (el) {
          obs.disconnect();
          if (timeoutId) clearTimeout(timeoutId);
          resolve(el);
        }
      });

      observer.observe(parent, {
        childList: true,
        subtree: true
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

    // Check for individual source items
    const sourceItems = document.querySelectorAll('.single-source-container');
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
    const selectors = [
      '.title-label-inner',
      'editable-project-title .title-label span',
      '.title-container .title span',
      '[class*="title-label"]',
      '.notebook-title' // legacy fallback
    ];

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
  async function checkCitationWorkflow() {
    const checks = [];

    // Find citation buttons - they have class "citation-marker" and "xap-inline-dialog"
    // Can be in chat (.model-response) or in notes (note-editor, labs-tailwind-doc-viewer)
    const citationButtons = document.querySelectorAll(
      'button.citation-marker, ' +
      'button.xap-inline-dialog[dialoglabel="Citation Details"]'
    );

    const hasButtons = citationButtons.length > 0;
    checks.push({
      name: 'Citation buttons present',
      selector: 'button.citation-marker',
      passed: hasButtons,
      count: citationButtons.length,
      critical: false, // Chat/notes might not have citations
      note: hasButtons ? `Found ${citationButtons.length} citation button(s)` : 'No citations found (may be expected)'
    });

    if (!hasButtons) {
      return { healthy: true, checks }; // No citations to test
    }

    // Filter to visible citation buttons only (not the "more_horiz" expand buttons)
    const visibleButtons = Array.from(citationButtons).filter(btn => {
      // Skip "show more citations" buttons (they have mat-icon inside)
      if (btn.querySelector('mat-icon')) return false;
      // Must have dialoglabel attribute (real citation buttons have this)
      if (!btn.hasAttribute('dialoglabel')) return false;
      // Check visibility
      return isElementVisible(btn);
    });

    console.log(`[NotebookLM Takeout] Health check: ${citationButtons.length} total citation buttons, ${visibleButtons.length} visible/testable`);
    if (visibleButtons.length > 0) {
      const sample = visibleButtons[0];
      console.log('[NotebookLM Takeout] Sample button:', {
        outerHTML: sample.outerHTML.substring(0, 200),
        isVisible: isElementVisible(sample),
        rect: sample.getBoundingClientRect()
      });
    }

    // Test hover mechanics - try up to 3 buttons
    let tooltipAppeared = false;
    let tooltipHadContent = false;
    let tooltipClosed = false;
    let testedButton = null;
    const maxAttempts = Math.min(3, visibleButtons.length);

    for (let attempt = 0; attempt < maxAttempts && !tooltipAppeared; attempt++) {
      const testButton = visibleButtons[attempt];
      testedButton = testButton;

      try {
        // Close any existing tooltip first
        const existingTooltip = document.querySelector('xap-inline-dialog-container[role="dialog"]');
        if (existingTooltip) {
          existingTooltip.remove();
          await sleep(100);
        }

        // Scroll button into view and wait for scroll to complete
        testButton.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(300);

        // Get button coordinates for realistic mouse events
        const rect = testButton.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        console.log(`[NotebookLM Takeout] Testing button at (${centerX.toFixed(0)}, ${centerY.toFixed(0)}), size: ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`);

        // Focus the button first
        testButton.focus();
        await sleep(100);

        // Try hover with proper coordinates (mouseover + mouseenter + pointerenter)
        testButton.dispatchEvent(new PointerEvent('pointerenter', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: centerX,
          clientY: centerY,
          pointerType: 'mouse'
        }));
        testButton.dispatchEvent(new MouseEvent('mouseover', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: centerX,
          clientY: centerY
        }));
        testButton.dispatchEvent(new MouseEvent('mouseenter', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: centerX,
          clientY: centerY
        }));
        await sleep(600);

        // Check for tooltip
        let tooltip = document.querySelector('xap-inline-dialog-container[role="dialog"]') ||
                      document.querySelector('xap-inline-dialog-container') ||
                      document.querySelector('.citation-tooltip');

        // If hover didn't work, try click (some UIs require click for dialogs)
        if (!tooltip) {
          testButton.click();
          await sleep(500);
          tooltip = document.querySelector('xap-inline-dialog-container[role="dialog"]') ||
                    document.querySelector('xap-inline-dialog-container') ||
                    document.querySelector('.citation-tooltip');
        }

        // If still no tooltip, try waiting longer with waitForElement
        if (!tooltip) {
          tooltip = await raceWithCleanup([
            waitForElement('xap-inline-dialog-container[role="dialog"]', 2000),
            waitForElement('xap-inline-dialog-container', 2000),
            waitForElement('.citation-tooltip', 2000)
          ]).catch(() => null);
        }

        // Debug: Check what dialogs/tooltips exist
        const anyDialog = document.querySelector('xap-inline-dialog-container');
        const anyTooltip = document.querySelector('[role="dialog"]');
        console.log(`[NotebookLM Takeout] Tooltip attempt ${attempt + 1}: found=${!!tooltip}, anyDialog=${!!anyDialog}, anyRoleDialog=${!!anyTooltip}`);
        if (anyDialog && !tooltip) {
          console.log('[NotebookLM Takeout] Dialog found but not matched:', anyDialog.outerHTML.substring(0, 300));
        }

        tooltipAppeared = !!tooltip;

        if (tooltip) {
          // Check if tooltip has content
          await sleep(300); // Wait for content to load
          const content = tooltip.textContent?.trim();
          tooltipHadContent = content && content.length > 10;

          // Close tooltip - try multiple methods
          testButton.dispatchEvent(new MouseEvent('mouseleave', {
            view: window,
            bubbles: true,
            cancelable: true
          }));
          await sleep(150);

          // Method 2: Click elsewhere
          let stillOpen = document.querySelector('xap-inline-dialog-container[role="dialog"]');
          if (stillOpen) {
            document.body.click();
            await sleep(150);
          }

          // Method 3: Escape key
          stillOpen = document.querySelector('xap-inline-dialog-container[role="dialog"]');
          if (stillOpen) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(150);
          }

          // Method 4: Remove directly as last resort (cleanup)
          stillOpen = document.querySelector('xap-inline-dialog-container[role="dialog"]');
          if (stillOpen) {
            stillOpen.remove();
            await sleep(50);
          }

          tooltipClosed = !document.querySelector('xap-inline-dialog-container[role="dialog"]');
        }
      } catch (error) {
        console.warn(`[NotebookLM Takeout] Citation workflow test attempt ${attempt + 1} error:`, error);
        // Cleanup on error
        const leftoverTooltip = document.querySelector('xap-inline-dialog-container[role="dialog"]');
        if (leftoverTooltip) leftoverTooltip.remove();
      }
    } // end for loop

    // Handle case where no testable buttons were found
    if (visibleButtons.length === 0) {
      checks.push({
        name: 'Tooltip appears on hover',
        selector: 'xap-inline-dialog-container[role="dialog"]',
        passed: true, // Can't test, but not a failure
        critical: false,
        note: 'No testable citation buttons visible (all may be "show more" buttons)'
      });
      const healthy = checks.filter(c => c.critical).every(c => c.passed);
      return { healthy, checks };
    }

    // Tooltip test is informational only - synthetic events can't trigger Angular overlays reliably.
    // This limitation doesn't affect real exports which use click interactions.
    checks.push({
      name: 'Tooltip hover test (informational)',
      selector: 'xap-inline-dialog-container[role="dialog"]',
      passed: tooltipAppeared,
      critical: false, // Not critical - synthetic events often fail but real exports work
      note: tooltipAppeared
        ? 'Tooltip appeared successfully'
        : 'Synthetic events cannot trigger Angular overlays - this is expected and does not affect exports'
    });

    if (tooltipAppeared) {
      checks.push({
        name: 'Tooltip content loads',
        passed: tooltipHadContent,
        critical: false,
        note: tooltipHadContent ? 'Content loaded successfully' : 'Tooltip was empty or content did not load'
      });

      checks.push({
        name: 'Tooltip closes properly',
        passed: tooltipClosed,
        critical: false,
        note: tooltipClosed ? 'Closed successfully' : 'Tooltip remained open (will not affect exports)'
      });
    }

    // Citations category is healthy if buttons are present (tooltip test is informational)
    const healthy = hasButtons;
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
   * Retry an async operation with exponential backoff
   * @param {Function} operation - Async function to retry
   * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
   * @param {number} baseDelay - Base delay in ms for exponential backoff (default: 1000)
   * @param {string} operationName - Name for logging purposes
   * @returns {Promise<any>} Result of the operation
   */
  async function retryOperation(operation, maxRetries = 3, baseDelay = 1000, operationName = 'operation') {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[NotebookLM Takeout] ${operationName}: Attempt ${attempt}/${maxRetries}`);
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(`[NotebookLM Takeout] ${operationName}: Attempt ${attempt} failed:`, error.message);

        // Don't retry on the last attempt
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s, etc.
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`[NotebookLM Takeout] ${operationName}: Retrying in ${delay}ms...`);
          await sleep(delay);
        }
      }
    }

    // All retries failed
    console.error(`[NotebookLM Takeout] ${operationName}: All ${maxRetries} attempts failed`);
    throw lastError;
  }

  /**
   * Extract a single citation with retry logic
   * @param {Element} button - The citation button element to hover
   * @param {string} spanIndex - The citation index for logging
   * @param {boolean} includeImages - Whether to include images in citation
   * @param {number} maxRetries - Maximum retry attempts (default: 3)
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async function extractSingleCitationWithRetry(button, spanIndex, includeImages = false, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Scroll button into view
        button.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(100);

        // Close any existing tooltip first
        const existingTooltip = document.querySelector('xap-inline-dialog-container[role="dialog"]');
        if (existingTooltip) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(200);
        }

        // Simulate hover on the button
        button.dispatchEvent(new MouseEvent('mouseenter', {
          view: window,
          bubbles: true,
          cancelable: true
        }));

        // Increase wait time on retries
        const tooltipWaitTime = 2500 + (attempt - 1) * 500;
        await sleep(150 + (attempt - 1) * 50);

        // Wait for tooltip with multiple possible selectors
        const tooltip = await raceWithCleanup([
          waitForElement('xap-inline-dialog-container[role="dialog"]', tooltipWaitTime),
          waitForElement('.citation-tooltip', tooltipWaitTime),
          waitForElement('[role="dialog"].ng-star-inserted', tooltipWaitTime)
        ]).catch(() => null);

        if (!tooltip) {
          lastError = 'Tooltip did not appear';
          console.warn(`[NotebookLM Takeout] Citation ${spanIndex}: Attempt ${attempt}/${maxRetries} - ${lastError}`);
          button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          await sleep(300 + attempt * 100);
          continue;
        }

        // Wait for content to load with increased attempts on retry
        const maxContentAttempts = 15 + (attempt - 1) * 5;
        let contentLoaded = false;
        for (let contentAttempt = 0; contentAttempt < maxContentAttempts; contentAttempt++) {
          const opacity = parseFloat(window.getComputedStyle(tooltip).opacity);
          if (opacity > 0.5 && tooltip.textContent.trim().length > 0) {
            contentLoaded = true;
            break;
          }
          await sleep(50);
        }

        if (!contentLoaded) {
          lastError = 'Tooltip content did not load';
          console.warn(`[NotebookLM Takeout] Citation ${spanIndex}: Attempt ${attempt}/${maxRetries} - ${lastError}`);
          button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          await sleep(300 + attempt * 100);
          continue;
        }

        // Extract citation data
        // Source title moved from footer to header in recent NotebookLM update
        const headerEl = tooltip.querySelector('.citation-tooltip-header');
        const textEl = tooltip.querySelector('.citation-tooltip-text');

        const sourceTitle = headerEl?.textContent?.trim() || '';

        // Convert HTML to markdown
        let quoteMarkdown = '';
        if (textEl) {
          const textElements = textEl.querySelectorAll(':scope > labs-tailwind-structural-element-view-v2');
          if (textElements.length > 0) {
            for (const element of textElements) {
              const markdown = await htmlToMarkdownWithImages(element, includeImages);
              if (markdown && markdown.length > 0) {
                quoteMarkdown += markdown + '\n\n';
              }
            }
          } else {
            quoteMarkdown = await htmlToMarkdownWithImages(textEl, includeImages);
          }
        }
        quoteMarkdown = quoteMarkdown.trim();

        // Close tooltip
        button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        await sleep(200);

        // Wait for tooltip to fully close
        for (let closeAttempt = 0; closeAttempt < 20; closeAttempt++) {
          if (!document.querySelector('xap-inline-dialog-container[role="dialog"]')) {
            break;
          }
          await sleep(100);
        }

        // Success!
        if (attempt > 1) {
          console.log(`[NotebookLM Takeout] Citation ${spanIndex}: Succeeded on attempt ${attempt}`);
        }

        return {
          success: true,
          data: {
            text: sourceTitle,
            quote: quoteMarkdown,
            sourceIndex: spanIndex
          }
        };

      } catch (error) {
        lastError = error.message;
        console.warn(`[NotebookLM Takeout] Citation ${spanIndex}: Attempt ${attempt}/${maxRetries} error:`, error.message);

        // Clean up
        try {
          button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        } catch (e) {}

        await sleep(300 + attempt * 100);
      }
    }

    // All retries failed - track in DOMHealthTracker
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
      let existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
      if (existingViewer) {
        console.warn('[NotebookLM Takeout] WARNING: Note viewer still open from previous extraction!');
        console.log('[NotebookLM Takeout] Attempting to force close it...');

        // Try multiple methods to close it
        for (let attempt = 0; attempt < 3; attempt++) {
          console.log(`[NotebookLM Takeout] Close attempt ${attempt + 1}/3`);

          // Method 1: ESC key
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          await new Promise(resolve => setTimeout(resolve, 500));

          // Check if closed
          existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
          if (!existingViewer) {
            console.log('[NotebookLM Takeout] ✓ Viewer closed successfully');
            break;
          }

          // Method 2: Find and click close button by aria-label (most reliable)
          const closeNoteButton = document.querySelector('button[aria-label="Close note view"]');
          if (closeNoteButton) {
            console.log('[NotebookLM Takeout] Clicking "Close note view" button');
            closeNoteButton.click();
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // Check again
          existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
          if (!existingViewer) {
            console.log('[NotebookLM Takeout] ✓ Viewer closed via Close note view button');
            break;
          }

          // Method 3: Find and click collapse_content or arrow_back icon buttons
          const closeIcons = Array.from(document.querySelectorAll('mat-icon')).filter(icon => {
            const text = icon.textContent.trim();
            return text === 'collapse_content' || text === 'arrow_back' || text === 'close';
          });
          for (const icon of closeIcons) {
            const button = icon.closest('button');
            if (button) {
              console.log('[NotebookLM Takeout] Clicking close icon button:', icon.textContent.trim());
              button.click();
              await new Promise(resolve => setTimeout(resolve, 500));
              // Check if closed after each click
              existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
              if (!existingViewer) {
                console.log('[NotebookLM Takeout] ✓ Viewer closed via icon button');
                break;
              }
            }
          }

          // Check again
          existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
          if (!existingViewer) {
            break;
          }

          // Method 4: Panel header close button (fallback)
          const panelHeaders = document.querySelectorAll('.panel-header');
          for (const header of panelHeaders) {
            const closeBtn = header.querySelector('button[aria-label*="Close"], button[aria-label*="close"]');
            if (closeBtn) {
              console.log('[NotebookLM Takeout] Clicking panel header close button');
              closeBtn.click();
              await new Promise(resolve => setTimeout(resolve, 500));
              break;
            }
          }

          // Final check
          existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
          if (!existingViewer) {
            console.log('[NotebookLM Takeout] ✓ Viewer closed via panel header');
            break;
          }
        }

        // Final verification
        existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
        if (existingViewer) {
          console.error('[NotebookLM Takeout] ERROR: Failed to close viewer after 3 attempts');
          DOMHealthTracker.track('stuck', 'button[aria-label="Close note view"]', 'Viewer close failed');
          // Don't throw - instead, warn and try to continue
          console.warn('[NotebookLM Takeout] Attempting to continue anyway...');
          await new Promise(resolve => setTimeout(resolve, 1000));
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

        // Small delay to let DOM stabilize after navigation
        await new Promise(resolve => setTimeout(resolve, retryDelay));

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

          // Try finding notes by their icon (sticky_note_2 or flowchart)
          const noteIcons = document.querySelectorAll('mat-icon.artifact-icon');
          const noteParents = [];
          noteIcons.forEach(icon => {
            const iconText = icon.textContent.trim();
            if (iconText === 'sticky_note_2' || iconText === 'flowchart') {
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

      let noteEl = null;

      if (noteTitle) {
        // Try to find by title first (search ALL notes, not just visible ones)
        console.log('[NotebookLM Takeout] Searching for note with title:', noteTitle);

        const foundTitles = [];
        for (const el of allNoteElements) {
          const titleEl = el.querySelector('.artifact-title, .note-title');
          const title = titleEl?.textContent?.trim();
          foundTitles.push(title);

          if (title === noteTitle) {
            noteEl = el;
            console.log('[NotebookLM Takeout] ✓ Found note by exact title match');
            break;
          }
        }

        if (!noteEl) {
          console.log('[NotebookLM Takeout] ✗ Title not found. Available titles:', foundTitles);
          console.log('[NotebookLM Takeout] Looking for:', noteTitle);
        }
      }

      // Fallback to index-based lookup if title search failed
      if (!noteEl) {
        console.log('[NotebookLM Takeout] Falling back to index-based lookup...');

        // Use ALL note elements, not filtered (since scan also uses all)
        if (noteIndex < allNoteElements.length) {
          noteEl = allNoteElements[noteIndex];
          console.log('[NotebookLM Takeout] Using note at index:', noteIndex);
        } else {
          console.error('[NotebookLM Takeout] Index out of bounds:', noteIndex, 'of', allNoteElements.length);
        }
      }

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
      button.click();

      // Wait for content to load (editor or mindmap viewer).
      // Scope to <studio-panel> so we don't accidentally pick up the chat panel's
      // labs-tailwind-doc-viewer (used to render AI replies). When the chat
      // panel is in DOM order, an unscoped lookup grabs the chat viewer and
      // every citation hover ends up reading chat sources instead of the note's.
      console.log('[NotebookLM Takeout] Waiting for content...');
      const studioPanel = document.querySelector('studio-panel') || document;
      const content = await raceWithCleanup([
        waitForElement('rich-text-editor .ql-editor', 5000, studioPanel),
        waitForElement('rich-text-editor .ProseMirror', 5000, studioPanel),
        waitForElement('markdown-editor-legacy .ql-editor', 5000, studioPanel),
        waitForElement('labs-tailwind-doc-viewer', 5000, studioPanel),
        waitForElement('mindmap-viewer', 5000, studioPanel)
      ]).catch(() => null);

      if (!content) {
        throw new Error('Content not found (no editor or mindmap viewer)');
      }

      console.log('[NotebookLM Takeout] Content found:', content.tagName, content.className || '(no class)');

      // Wait a bit for content to fully render
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if it's a mindmap viewer
      if (content.tagName.toLowerCase() === 'mindmap-viewer') {
        console.log('[NotebookLM Takeout] Mindmap detected, extracting SVG...');
        return await extractMindmapSVG(content);
      }

      // Check if it's a Tailwind viewer (new format with sources)
      if (content.tagName.toLowerCase() === 'labs-tailwind-doc-viewer') {
        console.log('[NotebookLM Takeout] Tailwind viewer detected, extracting with citations...');
        return await extractTailwindNoteContent(content);
      } else {
        // Old format - just grab HTML
        console.log('[NotebookLM Takeout] Legacy editor format, no citations');
        return {
          html: content.innerHTML,
          sources: []
        };
      }

    } catch (error) {
      console.error('[NotebookLM Takeout] Extraction error:', error);
      throw error;
    }
  }

  /**
   * Extract content from a source document
   * Click the source → wait for viewer → extract content from labs-tailwind-doc-viewer
   *
   * @param {number} sourceIndex - Index of the source in the list
   * @returns {Promise<Object>} - { html, sources, title }
   */
  async function extractSourceContent(sourceIndex) {
    console.log(`[NotebookLM Takeout] Extracting source content for index ${sourceIndex}...`);

    const startTime = Date.now();

    try {
      // Verify we're on the correct page
      const currentUrl = window.location.href;
      console.log(`[NotebookLM Takeout] Current URL:`, currentUrl);

      if (!currentUrl.includes('notebooklm.google.com')) {
        throw new Error('Not on NotebookLM page');
      }

      // Find all source containers - exactly like the working extension
      const sourceContainers = document.querySelectorAll('.single-source-container');

      console.log(`[NotebookLM Takeout] Found ${sourceContainers.length} source containers in DOM`);

      if (sourceContainers.length === 0) {
        throw new Error(`No source containers found. Make sure you're on the Sources page in NotebookLM. Current URL: ${currentUrl}`);
      }

      if (sourceIndex >= sourceContainers.length) {
        throw new Error(`Source index ${sourceIndex} out of range (total: ${sourceContainers.length})`);
      }

      const container = sourceContainers[sourceIndex];

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
        console.log(`[NotebookLM Takeout] Closing existing source viewer(s)...`);
        // Look for close button in the viewer or press Escape
        const closeButtons = document.querySelectorAll('button[aria-label="Close"], .close-button, button[title="Close"]');
        if (closeButtons.length > 0) {
          console.log(`[NotebookLM Takeout] Found ${closeButtons.length} close button(s), clicking last one`);
          closeButtons[closeButtons.length - 1].click();
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // Try pressing Escape key
          console.log(`[NotebookLM Takeout] No close button found, pressing Escape key`);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27 }));
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Scroll into view first
      clickTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 200));

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
      await new Promise(resolve => setTimeout(resolve, 1500));

      console.log(`[NotebookLM Takeout] Checking DOM state...`);
      console.log(`[NotebookLM Takeout] source-viewer count:`, document.querySelectorAll('source-viewer').length);

      // Check if the click opened anything visible
      const panels = document.querySelectorAll('[role="dialog"], .panel, .drawer, .side-panel');
      console.log(`[NotebookLM Takeout] Visible panels/dialogs:`, panels.length);

      // Wait for source-viewer element with longer timeout (10 seconds for large PDFs)
      console.log(`[NotebookLM Takeout] Waiting for source-viewer to appear (timeout: 10s)...`);
      const sourceViewer = await waitForElement('source-viewer', 10000);
      if (!sourceViewer) {
        console.error('[NotebookLM Takeout] source-viewer not found after 10 seconds');
        console.error('[NotebookLM Takeout] DOM snapshot:', {
          sourceViewers: document.querySelectorAll('source-viewer').length,
          panels: document.querySelectorAll('[role="dialog"]').length,
          clickedElement: clickTarget.outerHTML
        });
        throw new Error('source-viewer not found - the source may not have opened');
      }

      console.log(`[NotebookLM Takeout] source-viewer found`);

      // Wait a bit for content to load
      await new Promise(resolve => setTimeout(resolve, 500));

      // Try to wait for source-guide-container to load (optional, timeout after 3 seconds)
      console.log(`[NotebookLM Takeout] Waiting for source-guide-container to load...`);
      try {
        await waitForElement('.source-guide-container', 3000);
        console.log(`[NotebookLM Takeout] source-guide-container found`);

        // NEW: Wait for summary content to be generated (10 second timeout)
        console.log(`[NotebookLM Takeout] Waiting for summary content to generate...`);

        const summaryTimeout = 10000; // 10 seconds
        const pollInterval = 200; // Check every 200ms
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

  // Extract content from Tailwind viewer format
  async function extractTailwindNoteContent(viewer) {
    console.log('[NotebookLM Takeout] Extracting Tailwind format note...');

    const sources = [];
    const errors = [];

    // Hide overlay if present
    const overlay = document.querySelector('.cdk-overlay-container');
    if (overlay) {
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
    }

    // Step 1: Expand all collapsed citation groups
    console.log('[NotebookLM Takeout] Checking for collapsed citation groups...');

    // Find all "show more" buttons (contain "..." or "more_horiz" text, or "Show additional citations" aria-label)
    const showMoreButtons = Array.from(viewer.querySelectorAll('button.citation-marker'))
      .filter(btn => {
        // Check for mat-icon (new DOM) or span (old DOM)
        const icon = btn.querySelector('mat-icon[aria-label="Show additional citations"], mat-icon, span[aria-label="Show additional citations"], span');
        return icon && (
          icon.textContent?.trim() === '...' ||
          icon.textContent?.trim() === 'more_horiz' ||
          icon.getAttribute('aria-label') === 'Show additional citations'
        );
      });

    console.log('[NotebookLM Takeout] Found', showMoreButtons.length, 'collapsed citation groups');

    // Click each "show more" button to expand
    for (const button of showMoreButtons) {
      console.log('[NotebookLM Takeout] Expanding citation group...');

      // Scroll button into view
      button.scrollIntoView({ behavior: 'instant', block: 'center' });
      await sleep(100);

      // Click to expand
      button.click();

      // Wait for DOM to update
      await sleep(300);
    }

    if (showMoreButtons.length > 0) {
      console.log('[NotebookLM Takeout] ✓ Expanded', showMoreButtons.length, 'citation groups');
      // Extra wait to ensure DOM is fully updated
      await sleep(200);
    }

    // Step 2: Now find all citation buttons
    console.log('[NotebookLM Takeout] Discovering citation buttons...');
    // Find all citation buttons
    const nodes = viewer.querySelectorAll('labs-tailwind-structural-element-view-v2');
    console.log('[NotebookLM Takeout] Found', nodes.length, 'content nodes');

    const uniqueSources = new Map();

    // Collect all citation buttons first
    const allCitationButtons = [];
    for (const node of nodes) {
      const citationButtons = node.querySelectorAll('button.ng-star-inserted');
      for (const button of citationButtons) {
        const span = button.querySelector('span');
        const spanIndex = span?.innerText.trim();

        // Debug: Log citation button details
        console.log('[NotebookLM Takeout] Citation button found:');
        console.log('  - span text:', spanIndex);
        console.log('  - button outerHTML preview:', button.outerHTML.substring(0, 300));

        if (spanIndex && !uniqueSources.has(spanIndex)) {
          allCitationButtons.push({ button, spanIndex });
        }
      }
    }

    console.log('[NotebookLM Takeout] Found', allCitationButtons.length, 'unique citations to extract');

    // Extract each citation
    for (let i = 0; i < allCitationButtons.length; i++) {
      const { button, spanIndex } = allCitationButtons[i];

      if (uniqueSources.has(spanIndex)) {
        continue;
      }

      console.log(`[NotebookLM Takeout] Hovering citation button ${i + 1}/${allCitationButtons.length}:`, spanIndex);

      try {
        // Scroll button into view
        button.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(100);

        // Simulate hover (mouseenter)
        const mouseenterEvent = new MouseEvent('mouseenter', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        button.dispatchEvent(mouseenterEvent);

        // Wait for tooltip popup to appear
        console.log('[NotebookLM Takeout] Waiting for tooltip to appear...');
        let tooltip = await waitForElement('xap-inline-dialog-container[role="dialog"][aria-label="Citation Details"]', 2000).catch(() => null);

        // Fallback: try simpler selector
        if (!tooltip) {
          console.log('[NotebookLM Takeout] Trying fallback selector...');
          tooltip = await waitForElement('xap-inline-dialog-container[role="dialog"]', 1000).catch(() => null);
        }

        // Fallback 2: try without role
        if (!tooltip) {
          console.log('[NotebookLM Takeout] Trying fallback selector without role...');
          tooltip = await waitForElement('xap-inline-dialog-container', 1000).catch(() => null);
        }

        if (!tooltip) {
          const errorMsg = `Citation ${spanIndex}: Tooltip container did not appear after mouseenter`;
          console.warn('[NotebookLM Takeout]', errorMsg);
          errors.push(errorMsg);

          // Debug: Check if any tooltip appeared with different attributes
          const anyTooltip = document.querySelector('xap-inline-dialog-container');
          if (anyTooltip) {
            console.log('[NotebookLM Takeout] Found tooltip but with different attributes:');
            console.log('  - role:', anyTooltip.getAttribute('role'));
            console.log('  - aria-label:', anyTooltip.getAttribute('aria-label'));
            console.log('  - outerHTML preview:', anyTooltip.outerHTML.substring(0, 300));
          } else {
            console.log('[NotebookLM Takeout] No tooltip found at all. Hover might not be working.');
          }

          // Simulate mouseleave to clean up
          const mouseleaveEvent = new MouseEvent('mouseleave', {
            view: window,
            bubbles: true,
            cancelable: true
          });
          button.dispatchEvent(mouseleaveEvent);

          continue;
        }

        // Wait for tooltip to become visible and content to load
        console.log('[NotebookLM Takeout] Tooltip container found, waiting for content to load...');

        // Give NotebookLM time to populate the tooltip after container appears
        await sleep(150);

        let footerEl = null;
        let attempts = 0;
        const maxAttempts = 12; // 12 x 50ms = 600ms max per tooltip

        while (attempts < maxAttempts) {
          // Check if tooltip is visible (opacity > 0.5) AND has content (either footer or text)
          const opacity = parseFloat(tooltip.style.opacity || '0');
          footerEl = tooltip.querySelector('.citation-tooltip-footer');
          const tooltipTextEl = tooltip.querySelector('.citation-tooltip-text');

          // Accept if opacity is high and we have either footer content OR tooltip text content
          const hasFooterContent = footerEl && footerEl.textContent?.trim().length > 0;
          const hasTooltipTextContent = tooltipTextEl && tooltipTextEl.textContent?.trim().length > 0;

          if (opacity > 0.5 && (hasFooterContent || hasTooltipTextContent)) {
            console.log('[NotebookLM Takeout] Tooltip content loaded after', attempts * 50, 'ms');
            break;
          }
          await sleep(50);
          attempts++;
        }

        // Check if we have any usable content (footer or tooltip text)
        const tooltipTextEl = tooltip.querySelector('.citation-tooltip-text');
        const hasFooterContent = footerEl && footerEl.textContent?.trim().length > 0;
        const hasTooltipTextContent = tooltipTextEl && tooltipTextEl.textContent?.trim().length > 0;

        if (!hasFooterContent && !hasTooltipTextContent) {
          const errorMsg = `Citation ${spanIndex}: Tooltip has no content (timeout after ${maxAttempts * 50}ms)`;
          console.warn('[NotebookLM Takeout]', errorMsg);
          console.warn('  - tooltip HTML:', tooltip.outerHTML.substring(0, 300));
          errors.push(errorMsg);

          // Simulate mouseleave to clean up
          const mouseleaveEvent = new MouseEvent('mouseleave', {
            view: window,
            bubbles: true,
            cancelable: true
          });
          button.dispatchEvent(mouseleaveEvent);

          continue;
        }

        console.log('[NotebookLM Takeout] Tooltip appeared! Extracting data...');
        console.log('  - tooltip HTML preview:', tooltip.outerHTML.substring(0, 500));

        // Extract source filename from header (moved from footer in recent update)
        const headerEl = tooltip.querySelector('.citation-tooltip-header');
        const sourceTitle = headerEl?.textContent?.trim() || '';
        console.log('  - header element found:', !!headerEl, 'content:', sourceTitle || '(empty)');

        // Extract quote text from citation-tooltip-text
        const tooltipText = tooltip.querySelector('.citation-tooltip-text');
        console.log('  - tooltip text element found:', !!tooltipText);
        let highlightedText = '';

        if (tooltipText) {
          // Convert HTML to markdown to preserve formatting (bold, italic, links, etc.)
          // Use direct child selector to avoid processing nested elements inside table cells
          const textElements = tooltipText.querySelectorAll(':scope > labs-tailwind-structural-element-view-v2');
          console.log('  - found', textElements.length, 'top-level structural elements');

          if (textElements.length > 0) {
            // Strategy 1: Convert each structural element to markdown
            for (const el of textElements) {
              const markdown = await htmlToMarkdownWithImages(el, includeCitationImages);
              if (markdown && markdown.length > 0) {
                highlightedText += markdown + '\n\n';
              }
            }
          } else {
            // Strategy 2: Try converting the whole tooltipText element
            console.log('  - using full tooltip text content');
            highlightedText = await htmlToMarkdownWithImages(tooltipText, includeCitationImages);
          }
        } else {
          // No .citation-tooltip-text found, try to extract from entire tooltip
          console.log('  - no citation-tooltip-text found, using tooltip content');
          const allText = tooltip.textContent?.trim() || '';
          // Remove the footer text (source filename)
          highlightedText = allText.replace(sourceTitle, '').trim();
        }

        // Store the citation data (even if text is empty, for debugging)
        const sourceData = {
          index: uniqueSources.size + 1,
          text: sourceTitle,
          quote: highlightedText.trim(),
          href: '',
          sourceIndex: spanIndex
        };

        // Validate extracted data
        if (!sourceTitle || sourceTitle.trim().length === 0) {
          const errorMsg = `Citation ${spanIndex}: Empty source filename`;
          console.warn('[NotebookLM Takeout]', errorMsg);
          errors.push(errorMsg);
        }

        if (!highlightedText || highlightedText.trim().length === 0) {
          const errorMsg = `Citation ${spanIndex}: Empty quote text (source: ${sourceTitle || 'unknown'})`;
          console.warn('[NotebookLM Takeout]', errorMsg);
          errors.push(errorMsg);
        } else {
          console.log('[NotebookLM Takeout] ✓ Extracted from hover tooltip:', spanIndex);
          console.log('  - source:', sourceTitle.substring(0, 50));
          console.log('  - quote length:', highlightedText.trim().length);
          console.log('  - sourceIndex stored:', spanIndex);
        }

        uniqueSources.set(spanIndex, sourceData);

        // Close tooltip (simulate mouseleave)
        const mouseleaveEvent = new MouseEvent('mouseleave', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        button.dispatchEvent(mouseleaveEvent);

        // Wait for tooltip to fully close and disappear (critical for next citation)
        console.log('[NotebookLM Takeout] Waiting for tooltip to close...');
        let closedAttempts = 0;
        while (closedAttempts < 15) {
          const existingTooltip = document.querySelector('xap-inline-dialog-container[role="dialog"]');

          // Wait for tooltip to either be removed OR have opacity 0 AND empty content
          if (!existingTooltip) {
            console.log('[NotebookLM Takeout] Tooltip removed after', closedAttempts * 100, 'ms');
            break;
          }

          const opacity = parseFloat(existingTooltip.style.opacity || '1');
          const hasContent = existingTooltip.querySelector('.citation-tooltip-footer');

          if (opacity < 0.1 && !hasContent) {
            console.log('[NotebookLM Takeout] Tooltip closed (empty) after', closedAttempts * 100, 'ms');
            // Extra wait to ensure it's fully gone
            await sleep(300);
            break;
          }

          await sleep(100);
          closedAttempts++;
        }

        // Extra safety wait
        await sleep(100);

      } catch (error) {
        const errorMsg = `Citation ${spanIndex}: ${error.message || error.toString()}`;
        console.error('[NotebookLM Takeout] Error extracting citation:', spanIndex, error);
        errors.push(errorMsg);
      }
    }

    const totalAttempted = allCitationButtons.length;
    const totalSuccessful = uniqueSources.size;
    const totalFailed = totalAttempted - totalSuccessful;

    console.log('[NotebookLM Takeout] ========== Citation Extraction Summary ==========');
    console.log('[NotebookLM Takeout] Collapsed groups expanded:', showMoreButtons.length);
    console.log('[NotebookLM Takeout] Total citation buttons found:', allCitationButtons.length);
    console.log('[NotebookLM Takeout] Unique citations extracted:', totalSuccessful);
    console.log('[NotebookLM Takeout] Failed to extract:', totalFailed);
    console.log('[NotebookLM Takeout] Errors/warnings:', errors.length);

    if (errors.length > 0) {
      console.warn('[NotebookLM Takeout] Errors and warnings:');
      errors.forEach((err, i) => console.warn(`  ${i + 1}. ${err}`));
    }

    // Restore overlay
    if (overlay) {
      overlay.style.visibility = '';
      overlay.style.pointerEvents = '';
    }

    const sourcesArray = Array.from(uniqueSources.values());

    // Debug: Show final sources array
    console.log('[NotebookLM Takeout] Final sources array:');
    console.log('  - count:', sourcesArray.length);
    console.log('  - sourceIndices:', sourcesArray.map(s => s.sourceIndex).join(', '));
    console.log('  - full array:', JSON.stringify(sourcesArray, null, 2));

    return {
      html: viewer.innerHTML,
      sources: sourcesArray,
      errors: errors
    };
  }

  // Extract mindmap SVG with all nodes expanded
  async function extractMindmapSVG(mindmapViewer) {
    console.log('[NotebookLM Takeout] Starting mindmap SVG extraction...');

    // First, try clicking the "Expand all" button if it exists
    const expandAllButton = document.querySelector('button[mattooltip*="Expand all"], button.expand-collapse-all-button-bottom, button[aria-label*="Expand all"]');
    if (expandAllButton) {
      console.log('[NotebookLM Takeout] Found "Expand all" button, clicking...');
      expandAllButton.click();

      // Wait for expansion to complete by checking node count
      console.log('[NotebookLM Takeout] Waiting for nodes to expand...');
      let previousNodeCount = 0;
      let stableCount = 0;

      // Keep checking until node count stabilizes (expansion complete)
      for (let i = 0; i < 20; i++) {
        await sleep(300);
        const currentNodeCount = mindmapViewer.querySelectorAll('g.node[role="treeitem"]').length;

        if (currentNodeCount === previousNodeCount) {
          stableCount++;
          if (stableCount >= 3) {
            console.log('[NotebookLM Takeout] Node count stabilized at', currentNodeCount);
            break;
          }
        } else {
          stableCount = 0;
        }

        console.log('[NotebookLM Takeout] Node count:', currentNodeCount);
        previousNodeCount = currentNodeCount;
      }

      console.log('[NotebookLM Takeout] Finished expanding all via button');
    } else {
      console.log('[NotebookLM Takeout] No "Expand all" button found, will expand nodes individually...');
    }

    // Find all nodes
    const allNodes = mindmapViewer.querySelectorAll('g.node[role="treeitem"]');
    console.log('[NotebookLM Takeout] Total nodes found:', allNodes.length);

    // Find collapsed nodes (aria-expanded="false")
    let collapsedNodes = Array.from(allNodes).filter(node =>
      node.getAttribute('aria-expanded') === 'false'
    );

    console.log('[NotebookLM Takeout] Collapsed nodes after expand all:', collapsedNodes.length);

    // Expand all collapsed nodes
    for (const node of collapsedNodes) {
      console.log('[NotebookLM Takeout] Expanding node:', node.getAttribute('aria-label'));

      // Try multiple methods to expand
      // Method 1: Click the circle
      const expandCircle = node.querySelector('circle');
      if (expandCircle) {
        expandCircle.dispatchEvent(new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        }));
      }

      // Method 2: Click the node itself as fallback
      node.dispatchEvent(new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      }));

      await sleep(300); // Wait for expansion animation
    }

    // Do another pass to catch any nested collapsed nodes
    await sleep(300);
    const stillCollapsed = Array.from(mindmapViewer.querySelectorAll('g.node[role="treeitem"]')).filter(
      node => node.getAttribute('aria-expanded') === 'false'
    );

    console.log('[NotebookLM Takeout] Nodes still collapsed after first pass:', stillCollapsed.length);

    // Expand any remaining collapsed nodes
    for (const node of stillCollapsed) {
      console.log('[NotebookLM Takeout] Second pass - expanding:', node.getAttribute('aria-label'));
      const expandCircle = node.querySelector('circle');
      if (expandCircle) {
        expandCircle.dispatchEvent(new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        }));
      }
      await sleep(300);
    }

    // Wait a bit more for all expansions to complete and DOM to settle
    await sleep(1500);

    // Force a reflow to ensure all text is rendered
    document.body.offsetHeight;

    // Get the SVG element
    const svg = mindmapViewer.querySelector('svg');
    if (!svg) {
      throw new Error('SVG not found in mindmap viewer');
    }

    // Log what we're about to extract
    const textElements = svg.querySelectorAll('text');
    console.log('[NotebookLM Takeout] Text elements found in SVG:', textElements.length);
    if (textElements.length > 0) {
      console.log('[NotebookLM Takeout] Sample text content:', textElements[0].textContent);
    }

    // Clone the SVG to modify it (deep clone to get all children including text)
    const svgClone = svg.cloneNode(true);

    // Verify text elements were cloned
    const clonedTextElements = svgClone.querySelectorAll('text');
    console.log('[NotebookLM Takeout] Text elements in cloned SVG:', clonedTextElements.length);

    // Ensure text elements have explicit styles (copy computed styles to inline)
    clonedTextElements.forEach((textEl, idx) => {
      const originalText = textElements[idx];
      if (originalText) {
        const computedStyle = window.getComputedStyle(originalText);

        // Copy critical text rendering properties
        const styleProps = [
          'font-family',
          'font-size',
          'fill',
          'text-anchor',
          'dominant-baseline'
        ];

        let styleString = styleProps
          .map(prop => `${prop}: ${computedStyle.getPropertyValue(prop)}`)
          .join('; ');

        // IMPORTANT: Force fill-opacity to 1 (NotebookLM uses 1e-06 which makes text invisible)
        styleString += '; fill-opacity: 1 !important; opacity: 1 !important';

        textEl.setAttribute('style', styleString);

        // Also remove any fill-opacity attributes
        textEl.removeAttribute('fill-opacity');
        textEl.removeAttribute('opacity');
      }
    });

    // Get SVG dimensions using bounding box
    const bbox = svg.getBBox();
    const padding = 50;

    // Calculate viewBox to capture all content with padding
    const viewBoxX = Math.floor(bbox.x - padding);
    const viewBoxY = Math.floor(bbox.y - padding);
    const viewBoxWidth = Math.ceil(bbox.width + (padding * 2));
    const viewBoxHeight = Math.ceil(bbox.height + (padding * 2));

    // Set proper SVG attributes for standalone file
    svgClone.setAttribute('width', viewBoxWidth);
    svgClone.setAttribute('height', viewBoxHeight);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgClone.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);

    // Add embedded styles for text rendering
    const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleElement.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500&display=swap');

      text {
        font-family: 'Google Sans', 'Roboto', Arial, sans-serif;
        dominant-baseline: middle;
        pointer-events: none;
      }

      .node-name {
        font-size: 20px;
        fill: #000;
        text-anchor: start;
      }

      .expand-symbol {
        font-size: 20px;
        fill: #000;
        text-anchor: middle;
        dominant-baseline: middle;
      }

      g.node rect {
        cursor: pointer;
      }

      g.node circle {
        cursor: pointer;
      }

      path.link {
        fill: none;
        stroke-width: 2px;
      }
    `;

    // Insert style as first child
    svgClone.insertBefore(styleElement, svgClone.firstChild);

    // Get the SVG as string
    const svgString = new XMLSerializer().serializeToString(svgClone);

    // Extract tree structure as JSON
    const treeData = extractMindmapTreeData(svg);

    console.log('[NotebookLM Takeout] SVG extracted successfully');
    console.log('[NotebookLM Takeout] Tree data:', treeData);

    return {
      isMindmap: true,
      svgContent: svgString,
      treeData: treeData,
      html: '', // No HTML for mindmaps
      sources: []
    };
  }

  // Extract mindmap tree structure as JSON
  function extractMindmapTreeData(svg) {
    const nodes = svg.querySelectorAll('g.node[role="treeitem"]');
    const nodeMap = new Map();
    const tree = {
      title: '',
      nodes: [],
      metadata: {
        totalNodes: nodes.length,
        exportedAt: new Date().toISOString()
      }
    };

    // First pass: collect all nodes
    nodes.forEach(node => {
      const ariaLabel = node.getAttribute('aria-label') || '';
      const level = parseInt(node.getAttribute('aria-level')) || 0;
      const expanded = node.getAttribute('aria-expanded') === 'true';

      // Parse aria-label which is like "Family History, 5 children"
      const labelParts = ariaLabel.split(',');
      const name = labelParts[0]?.trim() || 'Unnamed';
      const childrenMatch = ariaLabel.match(/(\d+)\s+children?/);
      const childCount = childrenMatch ? parseInt(childrenMatch[1]) : 0;

      const nodeData = {
        name: name,
        level: level,
        expanded: expanded,
        children: [],
        childCount: childCount
      };

      nodeMap.set(node, nodeData);

      // Level 1 is the root
      if (level === 1) {
        tree.title = name;
        tree.root = nodeData;
      }
    });

    // Build hierarchy by analyzing positions
    // Nodes are ordered in the DOM in a depth-first manner
    const nodeList = Array.from(nodes);
    const stack = [];

    nodeList.forEach(node => {
      const nodeData = nodeMap.get(node);
      const level = nodeData.level;

      // Pop stack until we find the parent (one level up)
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length > 0) {
        // Add as child to the last item in stack
        stack[stack.length - 1].children.push(nodeData);
      }

      stack.push(nodeData);
    });

    // Flatten structure for nodes array
    tree.nodes = Array.from(nodeMap.values());

    return tree;
  }

  /**
   * Extract Report content by clicking to open and reading the content
   * Reports are similar to Notes - they open in a viewer
   */
  async function extractReportContent(reportTitle) {
    console.log(`[NotebookLM Takeout] Extracting Report: "${reportTitle}"`);

    try {
      // Find the artifact by title
      const allTitles = document.querySelectorAll('.artifact-title');
      const titleElement = Array.from(allTitles).find(
        (el) => el.textContent.trim() === reportTitle
      );

      if (!titleElement) {
        throw new Error(`Could not find Report with title: "${reportTitle}"`);
      }

      // Find the parent artifact-library-item, then find the button
      const artifactItem = titleElement.closest('artifact-library-item');
      if (!artifactItem) {
        throw new Error('Could not find artifact-library-item parent');
      }

      // Look for the main artifact button (by icon or first button with aria-description)
      // Icon 'auto_tab_group' = Report
      const icon = artifactItem.querySelector('mat-icon');
      const reportButton = icon?.closest('button') || artifactItem.querySelector('button[aria-description]');
      if (!reportButton) {
        throw new Error('Could not find Report button');
      }

      console.log('[NotebookLM Takeout] Clicking Report button to open report-viewer...');
      reportButton.click();

      // Wait for report-viewer to appear in the DOM
      console.log('[NotebookLM Takeout] Waiting for report-viewer...');
      const reportViewer = await waitForElement('report-viewer', 5000);

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
  async function extractDataTableContent(tableTitle) {
    console.log(`[NotebookLM Takeout] Extracting Data Table: "${tableTitle}"`);

    try {
      // Find the artifact by title
      const allTitles = document.querySelectorAll('.artifact-title');
      const titleElement = Array.from(allTitles).find(
        (el) => el.textContent.trim() === tableTitle
      );

      if (!titleElement) {
        throw new Error(`Could not find Data Table with title: "${tableTitle}"`);
      }

      // Find the parent artifact-library-item, then find the button
      const artifactItem = titleElement.closest('artifact-library-item');
      if (!artifactItem) {
        throw new Error('Could not find artifact-library-item parent');
      }

      // Look for the main artifact button (by icon or first button with aria-description)
      // Icon 'table_view' = Data Table
      const icon = artifactItem.querySelector('mat-icon');
      const tableButton = icon?.closest('button') || artifactItem.querySelector('button[aria-description]');
      if (!tableButton) {
        throw new Error('Could not find Data Table button');
      }

      console.log('[NotebookLM Takeout] Clicking Data Table button to open table-viewer...');
      tableButton.click();

      // Wait for table-viewer to appear in the DOM
      console.log('[NotebookLM Takeout] Waiting for table-viewer...');
      const tableViewer = await waitForElement('table-viewer', 5000);

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

  // Navigate back to notes list / close source panel
  async function navigateBackToNotesList() {
    console.log('[NotebookLM Takeout] Attempting to close panel/navigate back...');

    // Try multiple times with different methods
    for (let attempt = 0; attempt < 3; attempt++) {
      console.log(`[NotebookLM Takeout] Close attempt ${attempt + 1}/3`);

      // Method 0: ESC key (most reliable for closing editors/panels)
      console.log('[NotebookLM Takeout] Trying ESC key...');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 800));

      // Check if note viewer is gone
      let noteViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer, table-viewer');
      if (!noteViewer) {
        console.log('[NotebookLM Takeout] ✓ Panel closed via ESC key');
        return;
      }

      // Method 1: Close note view button by aria-label (most reliable for notes)
      console.log('[NotebookLM Takeout] Trying "Close note view" button...');
      const closeNoteButton = document.querySelector('button[aria-label="Close note view"]');
      if (closeNoteButton) {
        console.log('[NotebookLM Takeout] Clicking "Close note view" button');
        closeNoteButton.click();
        await new Promise(resolve => setTimeout(resolve, 800));

        noteViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer, table-viewer');
        if (!noteViewer) {
          console.log('[NotebookLM Takeout] ✓ Panel closed via "Close note view" button');
          return;
        }
      }

      // Method 1b: collapse_content or arrow_back icon button (for notes/reports)
      console.log('[NotebookLM Takeout] Trying collapse_content/arrow_back button...');
      const closeIconButtons = Array.from(document.querySelectorAll('mat-icon')).filter(icon => {
        const text = icon.textContent.trim();
        return text === 'collapse_content' || text === 'arrow_back' || text === 'close';
      });
      for (const icon of closeIconButtons) {
        const button = icon.closest('button');
        if (button) {
          console.log('[NotebookLM Takeout] Clicking close icon button:', icon.textContent.trim());
          button.click();
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      // Check again
      noteViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer, table-viewer');
      if (!noteViewer) {
        console.log('[NotebookLM Takeout] ✓ Panel closed via close icon');
        return;
      }

      // Method 2: Panel header approach (works for sources)
      const panelHeaders = document.querySelectorAll('.panel-header');
      if (panelHeaders.length > 0 && panelHeaders[0].children.length > 1) {
        console.log('[NotebookLM Takeout] Clicking panel header children[1]');
        panelHeaders[0].children[1].click();
        await new Promise(resolve => setTimeout(resolve, 800));

        noteViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
        if (!noteViewer) {
          console.log('[NotebookLM Takeout] ✓ Panel closed via panel header');
          return;
        }
      }
    }

    // After all attempts, check one more time
    const stillOpen = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
    if (!stillOpen) {
      console.log('[NotebookLM Takeout] ✓ Panel closed successfully');
      return;
    }

    // Last resort: Standard back/close buttons
    const backButton = document.querySelector('button[aria-label*="Back"], button[aria-label*="Close"]');
    if (backButton) {
      console.log('[NotebookLM Takeout] Last resort: Clicking standard back button');
      backButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      return;
    }

    console.error('[NotebookLM Takeout] ERROR: Failed to close panel after all attempts!');
    DOMHealthTracker.track('stuck', null, 'Panel close failed');
    console.log('[NotebookLM Takeout] Available elements:', {
      panelHeaders: document.querySelectorAll('.panel-header').length,
      backButtons: document.querySelectorAll('button[aria-label*="Back"]').length,
      closeButtons: document.querySelectorAll('button[aria-label*="Close"]').length,
      closeNoteViewButton: !!document.querySelector('button[aria-label="Close note view"]'),
      collapseContentIcons: Array.from(document.querySelectorAll('mat-icon')).filter(i => i.textContent.trim() === 'collapse_content').length,
      arrowBackIcons: Array.from(document.querySelectorAll('mat-icon')).filter(i => i.textContent.trim() === 'arrow_back').length,
      noteViewers: document.querySelectorAll('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer, table-viewer').length
    });
  }

  // ==================== ARTIFACT DOWNLOAD (MESSAGE-BASED) ====================

  /**
   * Main handler for artifact downloads via message passing
   * Coordinates the download process with proper error handling and metadata
   */
  async function handleArtifactDownload(artifactIndex, artifactType, moreButtonAlreadyClicked = false, skipMoreButton = false, artifactName = null) {
    console.log(`[NotebookLM Takeout] [Download] Starting download for artifact ${artifactIndex} (${artifactType})`);
    const startTime = Date.now();

    try {
      let artifactItem = null;
      let artifactTitle = artifactName || '';

      // For Reports and Data Tables with skipMoreButton, go directly to extraction
      if ((artifactType === 'Report' || artifactType === 'Data Table') && skipMoreButton) {
        console.log(`[NotebookLM Takeout] [Download] ${artifactType} with skipMoreButton - extracting directly...`);

        const extractResult = artifactType === 'Report'
          ? await extractReportContent(artifactTitle)
          : await extractDataTableContent(artifactTitle);

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
      if (!moreButtonAlreadyClicked) {
        // Build array of More buttons ONLY from artifact-library-item (not from notes)
        // This matches the indexing logic in sidebar.js scanPageForItems()
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
        artifactItem = moreButton.closest('artifact-library-item');
        if (!artifactItem) {
          throw new Error('Could not find artifact-library-item parent');
        }
      } else {
        console.log('[NotebookLM Takeout] [Download] More button already clicked, waiting for menu...');
      }

      // Detect artifact type from icon if artifactItem is available (fallback for DOM changes)
      if (artifactItem) {
        const iconToType = {
          'auto_tab_group': 'Report',
          'tablet': 'Slides',
          'stacked_bar_chart': 'Infographic',
          'table_view': 'Data Table',
          'flowchart': 'Flowchart',
          'headphones': 'Audio Overview',
          'audio_magic_eraser': 'Audio Overview'
        };
        const icon = artifactItem.querySelector('mat-icon');
        const iconText = icon?.textContent?.trim() || '';
        const detectedType = iconToType[iconText];
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
          ? await extractReportContent(artifactTitle)
          : await extractDataTableContent(artifactTitle);

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

      // Try infographic extraction first (tiered fallback: SVG → Canvas → Button)
      if (artifactType === 'Infographic' && artifactItem) {
        console.log('[NotebookLM Takeout] [Download] Attempting infographic extraction...');
        const extractResult = await tryExtractInfographic(artifactItem);

        if (extractResult.success) {
          const duration = Date.now() - startTime;
          console.log(`[NotebookLM Takeout] [Download] ✓ Infographic extracted via ${extractResult.method} (${duration}ms)`);
          return {
            success: true,
            method: extractResult.method,
            data: extractResult.data,
            format: extractResult.format,
            dimensions: extractResult.dimensions,
            title: artifactTitle, // Include extracted title
            duration: duration
          };
        }

        // Fall through to button click if extraction failed
        console.log('[NotebookLM Takeout] [Download] Extraction failed, falling back to button click');
      }

      // For all other artifacts (or infographic fallback), click download button
      console.log('[NotebookLM Takeout] [Download] Attempting download button click...');
      const buttonResult = await clickArtifactDownloadButton(moreButtonAlreadyClicked ? null : artifactItem?.querySelector('button[aria-label="More"]'), artifactItem, moreButtonAlreadyClicked);

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
  async function clickArtifactDownloadButton(moreButton, artifactItem, moreButtonAlreadyClicked = false) {
    // Clear any previous intercepted URL
    lastInterceptedDownloadUrl = null;

    // Click the More button to open menu (unless already clicked)
    if (!moreButtonAlreadyClicked && moreButton) {
      console.log('[NotebookLM Takeout] [Download] Clicking More button...');
      moreButton.click();
    } else {
      console.log('[NotebookLM Takeout] [Download] More button already clicked, skipping...');
    }

    // Wait for menu to appear with adaptive waiting
    console.log('[NotebookLM Takeout] [Download] Waiting for menu to appear...');
    await waitForElement('.mat-mdc-menu-panel, .cdk-overlay-pane', 2000);

    // Find download button with multiple selector attempts
    const downloadButton = await findDownloadButton();
    if (!downloadButton) {
      // Close menu before throwing error
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      throw new Error('Download button not found in menu');
    }

    console.log('[NotebookLM Takeout] [Download] Found download button, clicking...');
    downloadButton.click();

    // Wait for intercepted URL (from window.open interception) or download initiation
    console.log('[NotebookLM Takeout] [Download] Waiting for intercepted URL...');
    const interceptedUrl = await waitForInterceptedUrl(2000);

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
   * Find the Download menu item in the currently open more-menu.
   * Thin wrapper around findMenuItemByText — preserves the old call site.
   */
  async function findDownloadButton() {
    const button = findMenuItemByText('download');
    if (button) {
      console.log('[NotebookLM Takeout] [Download] Found download menu item via text search');
    }
    return button;
  }

  // ==================== STUDIO TAB (unified list) ====================

  /**
   * Scan both artifact-library-item and artifact-library-note elements in DOM order.
   * Each result carries `kind` ('artifact'|'note'), the index inside its own kind
   * (for routing into existing downloadArtifact / note-export paths), and the
   * combined index (for delete targeting).
   */
  function scanStudioItems() {
    const ICON_TO_TYPE = {
      'auto_tab_group': 'Report',
      'tablet': 'Slides',
      'stacked_bar_chart': 'Infographic',
      'table_view': 'Data Table',
      'flowchart': 'Flowchart',
      'headphones': 'Audio Overview',
      'audio_magic_eraser': 'Audio Overview'
    };

    const nodes = document.querySelectorAll('artifact-library-item, artifact-library-note');
    let artifactCursor = 0;
    let noteCursor = 0;
    const items = [];

    nodes.forEach((el, combinedIndex) => {
      const tag = el.tagName.toLowerCase();
      const titleEl = el.querySelector('.artifact-title, .note-title');
      const label = titleEl?.textContent?.trim() || `Item ${combinedIndex + 1}`;
      const detailsEl = el.querySelector('.artifact-details');
      const details = detailsEl?.textContent?.trim() || '';
      const iconEl = el.querySelector('mat-icon');
      const iconText = iconEl?.textContent?.trim() || '';
      const hasMoreButton = !!el.querySelector('button[aria-label="More"]');

      if (tag === 'artifact-library-item') {
        items.push({
          combinedIndex,
          kindIndex: artifactCursor,
          kind: 'artifact',
          label,
          details,
          type: ICON_TO_TYPE[iconText] || iconText || 'Unknown',
          hasMoreButton
        });
        artifactCursor++;
      } else {
        // artifact-library-note — Note or Mindmap
        let type = 'Note';
        if (iconText === 'flowchart') type = 'Mindmap';
        items.push({
          combinedIndex,
          kindIndex: noteCursor,
          kind: 'note',
          label,
          details,
          type,
          hasMoreButton
        });
        noteCursor++;
      }
    });

    return items;
  }

  /**
   * Delete one studio item:
   *   1. Resolve target element (by label first, else combined index).
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
      throw new Error('No studio items found on the page');
    }

    // Resolve target — prefer label (stable across deletes) but fall back to index.
    let target = null;
    if (label) {
      target = all.find(el => {
        const t = el.querySelector('.artifact-title, .note-title');
        return t && t.textContent?.trim() === label;
      }) || null;
    }
    if (!target && typeof combinedIndex === 'number' && combinedIndex >= 0 && combinedIndex < all.length) {
      target = all[combinedIndex];
    }
    if (!target) {
      throw new Error(`Studio item not found${label ? ` (label: "${label}")` : ''}`);
    }

    const moreButton = target.querySelector('button[aria-label="More"]');
    if (!moreButton) {
      throw new Error('More button not found on this item');
    }

    moreButton.click();

    try {
      await waitForElement('.mat-mdc-menu-panel, .cdk-overlay-pane', 2000);
    } catch (e) {
      throw new Error('More menu did not open');
    }

    // Small yield so menu items populate.
    await new Promise(r => setTimeout(r, 150));

    const deleteItem = findMenuItemByText('delete');
    if (!deleteItem) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      throw new Error('Delete menu item not found');
    }
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
        const confirmBtn = findConfirmDialogButton();
        if (confirmBtn) {
          confirmBtn.click();
          confirmed = true;
        }
      }

      await new Promise(r => setTimeout(r, 100));
    }

    throw new Error(confirmed
      ? 'Item did not disappear after clicking confirm'
      : 'Delete did not take effect (no dialog, no removal)');
  }

  /**
   * Find the destructive button of an on-screen delete confirmation.
   * NotebookLM uses several dialog shapes — mat-dialog-container, role=dialog,
   * mat-mdc-dialog-container, or just a plain .cdk-overlay-pane floating card
   * with "Cancel" + "Delete" buttons. We scan all three, preferring a
   * container that has a Cancel sibling (the strongest confirm-dialog signal)
   * and skipping the more-options menu panel we just used.
   */
  function findConfirmDialogButton() {
    const DESTRUCTIVE = ['delete', 'confirm', 'remove'];
    const exactMatch = (t) => DESTRUCTIVE.includes(t);
    const looseMatch = (t) => DESTRUCTIVE.some(w => t.includes(w));

    const candidates = document.querySelectorAll(
      'mat-dialog-container, mat-mdc-dialog-container, [role="dialog"], [role="alertdialog"], .cdk-dialog-container, .cdk-overlay-pane'
    );

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
   * Poll a condition until true or timeout.
   */
  async function waitForCondition(predicate, timeoutMs = 3000, intervalMs = 100) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (predicate()) return true; } catch (_) { /* noop */ }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
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

    // TIER 1: Try SVG extraction (vector format - best quality)
    const svg = artifactElement.querySelector('svg');
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
    const canvas = artifactElement.querySelector('canvas');
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
        dimensions: { width, height }
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

    // Find all citation buttons with "..." or "more_horiz" text (collapsed indicators)
    const allCitationButtons = chatPanel.querySelectorAll('button.citation-marker');
    const collapsedButtons = Array.from(allCitationButtons).filter(button => {
      // Check for mat-icon (new DOM) or span (old DOM)
      const icon = button.querySelector('mat-icon, span');
      const text = icon?.textContent?.trim();
      const ariaLabel = icon?.getAttribute('aria-label');
      // Check for "..." or "more_horiz" text, or "Show additional citations" aria-label
      return text === '...' || text === 'more_horiz' || ariaLabel?.includes('additional citations');
    });

    console.log(`[NotebookLM Takeout] Found ${collapsedButtons.length} collapsed citation indicators`);

    if (collapsedButtons.length === 0) {
      console.log('[NotebookLM Takeout] No collapsed citations to expand');
      return;
    }

    // Click each collapsed button to expand
    for (let i = 0; i < collapsedButtons.length; i++) {
      const button = collapsedButtons[i];

      try {
        console.log(`[NotebookLM Takeout] Expanding collapsed citation ${i + 1}/${collapsedButtons.length}...`);

        // Scroll into view
        button.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(100);

        // Click to expand
        button.click();
        await sleep(300); // Wait for expansion animation

        console.log(`[NotebookLM Takeout] ✓ Expanded citation ${i + 1}/${collapsedButtons.length}`);
      } catch (error) {
        console.error(`[NotebookLM Takeout] Error expanding collapsed citation ${i + 1}:`, error);
      }
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
    const titleSelectors = [
      '.title-label-inner',
      'editable-project-title .title-label span',
      '.title-container .title span',
      '[class*="title-label"]',
      '.notebook-title' // legacy fallback
    ];
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

    // Extract date separators and message pairs
    const messagePairs = [];
    const elements = Array.from(chatPanel.children);

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
          messagePairs.push(pair);
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
      extractedAt: new Date().toISOString()
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
   * Extract ALL unique citations from the entire chat at once
   * Much more efficient than extracting per-message
   * @returns {Promise<{sourcesByIndex: Object, errors: Array}>}
   */
  async function extractAllChatCitations() {
    console.log('[NotebookLM Takeout] Extracting ALL citations from chat...');

    const sourcesByIndex = {}; // Map of sourceIndex -> {text, quote}
    const errors = [];

    try {
      // Find ALL citation buttons in the page
      console.log('[NotebookLM Takeout] Finding all citation buttons in page...');
      const allButtons = document.querySelectorAll('button.citation-marker');
      console.log(`[NotebookLM Takeout] Found ${allButtons.length} total citation buttons`);

      if (allButtons.length === 0) {
        errors.push('No citation buttons found in page');
        return { sourcesByIndex, errors };
      }

      // Get unique source indices
      const uniqueSourceIndices = new Set();
      const buttonsBySourceIndex = new Map();

      allButtons.forEach(button => {
        const span = button.querySelector('span');
        const sourceIndex = span?.innerText?.trim();

        if (sourceIndex && sourceIndex !== '...') {
          uniqueSourceIndices.add(sourceIndex);
          if (!buttonsBySourceIndex.has(sourceIndex)) {
            buttonsBySourceIndex.set(sourceIndex, button);
          }
        }
      });

      console.log(`[NotebookLM Takeout] Found ${uniqueSourceIndices.size} unique source indices`);

      // Extract each unique source
      let extractedCount = 0;
      for (const sourceIndex of uniqueSourceIndices) {
        const button = buttonsBySourceIndex.get(sourceIndex);
        if (!button) continue;

        console.log(`[NotebookLM Takeout] Extracting source ${sourceIndex} (${extractedCount + 1}/${uniqueSourceIndices.size})...`);

        try {
          // Scroll into view
          button.scrollIntoView({ behavior: 'instant', block: 'center' });
          await sleep(100);

          // Hover over button
          button.dispatchEvent(new MouseEvent('mouseenter', {
            view: window,
            bubbles: true,
            cancelable: true
          }));

          await sleep(500);  // Increased from 200ms for slower networks

          // Wait for tooltip
          const tooltip = await raceWithCleanup([
            waitForElement('xap-inline-dialog-container[role="dialog"]', 3000),
            waitForElement('.citation-tooltip', 3000),
            waitForElement('[role="dialog"].ng-star-inserted', 3000)
          ]).catch(() => null);

          if (!tooltip) {
            console.warn(`[NotebookLM Takeout] Source ${sourceIndex}: Tooltip did not appear`);
            errors.push(`Source ${sourceIndex}: Tooltip did not appear`);
            button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            continue;
          }

          console.log(`[NotebookLM Takeout] Source ${sourceIndex}: Tooltip appeared`);

          // Wait for content to load
          let contentLoaded = false;
          for (let attempt = 0; attempt < 20; attempt++) {
            const opacity = parseFloat(window.getComputedStyle(tooltip).opacity);
            if (opacity > 0.5 && tooltip.textContent.trim().length > 0) {
              contentLoaded = true;
              break;
            }
            await sleep(50);
          }

          if (!contentLoaded) {
            console.warn(`[NotebookLM Takeout] Source ${sourceIndex}: Tooltip content did not load`);
            errors.push(`Source ${sourceIndex}: Tooltip content did not load`);
            button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            continue;
          }

          // Extract citation data
          // Source title moved from footer to header in recent NotebookLM update
          const headerEl = tooltip.querySelector('.citation-tooltip-header');
          const textEl = tooltip.querySelector('.citation-tooltip-text');

          const sourceTitle = headerEl?.textContent?.trim() || '';

          // Convert HTML to markdown using the same function as note exports
          let quoteMarkdown = '';
          if (textEl) {
            // Try to process structural elements first
            const textElements = textEl.querySelectorAll(':scope > labs-tailwind-structural-element-view-v2');
            if (textElements.length > 0) {
              for (const element of textElements) {
                const markdown = await htmlToMarkdownWithImages(element, includeCitationImages);
                if (markdown && markdown.length > 0) {
                  quoteMarkdown += markdown + '\n\n';
                }
              }
            } else {
              // Fallback: convert the whole textEl
              quoteMarkdown = await htmlToMarkdownWithImages(textEl, includeCitationImages);
            }
          }
          quoteMarkdown = quoteMarkdown.trim();

          sourcesByIndex[sourceIndex] = {
            text: sourceTitle,
            quote: quoteMarkdown
          };

          console.log(`[NotebookLM Takeout] ✓ Extracted source ${sourceIndex}: "${sourceTitle?.substring(0, 40)}..." (quote: ${quoteMarkdown.length} chars)`);
          extractedCount++;

          // Close tooltip
          button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          await sleep(400);  // Increased from 250ms for slower networks

          // Wait for tooltip to close
          for (let attempt = 0; attempt < 20; attempt++) {
            if (!document.querySelector('xap-inline-dialog-container[role="dialog"]')) {
              break;
            }
            await sleep(100);
          }

        } catch (error) {
          console.error(`[NotebookLM Takeout] Error extracting source ${sourceIndex}:`, error);
          errors.push(`Source ${sourceIndex}: ${error.message}`);
        }
      }

      console.log(`[NotebookLM Takeout] Extraction complete: ${extractedCount}/${uniqueSourceIndices.size} sources extracted`);

    } catch (error) {
      console.error('[NotebookLM Takeout] Fatal error in extractAllChatCitations:', error);
      errors.push(`Fatal error: ${error.message}`);
    }

    return { sourcesByIndex, errors };
  }

  /**
   * Extract citations from a LIVE chat message in the DOM (hover-based approach)
   * This finds the actual message element on the page and hovers over real citation buttons
   * @param {number} messageIndex - The index of the message (0-based)
   * @returns {Promise<{sources: Array, errors: Array}>}
   */
  async function extractChatCitationsFromLiveDOM(messageIndex) {
    console.log(`[NotebookLM Takeout] Extracting citations from live DOM message ${messageIndex}...`);

    const sources = [];
    const errors = [];

    try {
      // Find all AI response messages in the live DOM
      console.log('[NotebookLM Takeout] Searching for chat panel...');
      console.log('[NotebookLM Takeout] All elements with "chat":', document.querySelectorAll('[class*="chat"]').length);
      console.log('[NotebookLM Takeout] All elements with "conversation":', document.querySelectorAll('[class*="conversation"]').length);
      console.log('[NotebookLM Takeout] All elements with "message":', document.querySelectorAll('[class*="message"]').length);

      let chatPanel = document.querySelector('.chat-history-panel, [role="log"], .conversation-container');

      // Try alternative selectors
      if (!chatPanel) {
        chatPanel = document.querySelector('main, [role="main"]');
        console.log('[NotebookLM Takeout] Trying main element:', !!chatPanel);
      }

      if (!chatPanel) {
        chatPanel = document.body;
        console.log('[NotebookLM Takeout] Falling back to document.body');
      }

      if (!chatPanel) {
        console.error('[NotebookLM Takeout] Could not find chat panel');
        errors.push('Chat panel not found in DOM');
        return { sources, errors };
      }

      console.log('[NotebookLM Takeout] Using chat panel:', chatPanel.tagName, chatPanel.className);

      // Find all message pairs - each pair has user question + AI response
      console.log('[NotebookLM Takeout] Looking for message pairs...');
      console.log('[NotebookLM Takeout] Chat panel is:', chatPanel ? chatPanel.tagName : 'null');

      // Try to find all citation buttons - use a Promise.race to timeout if it takes too long
      console.log('[NotebookLM Takeout] About to query for all citation buttons...');
      let allCitationButtons = [];

      try {
        // Query for buttons - this might hang if chatPanel is too large
        const buttons = chatPanel.querySelectorAll('button.citation-marker');
        console.log('[NotebookLM Takeout] Query returned, converting to array...');
        allCitationButtons = Array.from(buttons);
        console.log(`[NotebookLM Takeout] Found ${allCitationButtons.length} total citation buttons`);
      } catch (e) {
        console.error('[NotebookLM Takeout] Error querying citation buttons:', e);
        console.error('[NotebookLM Takeout] Error stack:', e.stack);
        errors.push(`Error finding citation buttons: ${e.message}`);
        return { sources, errors };
      }

      if (allCitationButtons.length === 0) {
        console.error('[NotebookLM Takeout] No citation buttons found in chat panel');
        errors.push('No citation buttons found');
        return { sources, errors };
      }

      // Find the parent containers of citation buttons
      const messageContainers = new Set();
      allCitationButtons.forEach(btn => {
        // Walk up the DOM tree to find a substantial parent container
        let parent = btn.parentElement;
        let depth = 0;
        while (parent && depth < 15) {
          // Look for a parent that seems like a message container
          const classList = Array.from(parent.classList || []);
          const className = parent.className;
          if (classList.some(c => c.includes('response') || c.includes('answer') || c.includes('message')) ||
              parent.tagName === 'ARTICLE' ||
              (parent.children.length > 3 && parent.textContent.length > 200)) {
            messageContainers.add(parent);
            console.log('[NotebookLM Takeout] Found message container:', parent.tagName, parent.className);
            break;
          }
          parent = parent.parentElement;
          depth++;
        }
      });

      const messagePairs = Array.from(messageContainers);
      console.log(`[NotebookLM Takeout] Found ${messagePairs.length} unique message containers`);

      if (messageIndex >= messagePairs.length) {
        console.error(`[NotebookLM Takeout] Message index ${messageIndex} out of range (total: ${messagePairs.length})`);
        errors.push(`Message index ${messageIndex} out of range`);
        return { sources, errors };
      }

      const messageElement = messagePairs[messageIndex];
      if (!messageElement) {
        console.error('[NotebookLM Takeout] Could not find message element at index', messageIndex);
        errors.push('Message element not found');
        return { sources, errors };
      }

      console.log(`[NotebookLM Takeout] Found live message element at index ${messageIndex}`);

      // Find all citation buttons in THIS specific message
      const citationButtons = messageElement.querySelectorAll('button.citation-marker');
      console.log(`[NotebookLM Takeout] Found ${citationButtons.length} citation buttons in live message`);

      const uniqueSources = new Map();

      for (let i = 0; i < citationButtons.length; i++) {
        const button = citationButtons[i];
        const span = button.querySelector('span');
        const spanIndex = span?.innerText?.trim();

        // Skip if no index, already processed, or is a collapsed indicator (...)
        if (!spanIndex || uniqueSources.has(spanIndex) || spanIndex === '...') {
          if (spanIndex === '...') {
            console.log(`[NotebookLM Takeout] Skipping collapsed citation indicator`);
          }
          continue;
        }

        console.log(`[NotebookLM Takeout] Extracting citation ${i + 1}/${citationButtons.length}: ${spanIndex}`);

        // Use retry helper for citation extraction
        const result = await extractSingleCitationWithRetry(button, spanIndex, includeCitationImages, 3);

        if (result.success) {
          uniqueSources.set(spanIndex, {
            index: uniqueSources.size + 1,
            ...result.data
          });

          sources.push({
            index: uniqueSources.size,
            ...result.data
          });

          console.log(`[NotebookLM Takeout] ✓ Extracted citation ${spanIndex}: ${result.data.text}`);
        } else {
          errors.push(result.error);
        }
      }

    } catch (error) {
      console.error('[NotebookLM Takeout] Error in extractChatCitationsFromLiveDOM:', error);
      errors.push(`Fatal error: ${error.message}`);
    }

    console.log('[NotebookLM Takeout] Live DOM citation extraction complete:', {
      sourcesExtracted: sources.length,
      errorsCount: errors.length
    });

    return {
      sources: sources,
      errors: errors
    };
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

        // Add delay between citations to avoid overwhelming API
        await sleep(150);
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

  /**
   * Extract citations from chat AI response HTML
   * Reuses hover-based citation extraction pattern from notes
   */
  async function extractChatCitations(messageHTML) {
    console.log('[NotebookLM Takeout] Extracting citations from chat message...');
    console.log('[NotebookLM Takeout] Message HTML length:', messageHTML?.length || 0);

    console.log('[NotebookLM Takeout] Step 1: Creating temp container...');
    // Create temporary container to work with
    const tempContainer = document.createElement('div');
    console.log('[NotebookLM Takeout] Step 2: Setting innerHTML...');
    tempContainer.innerHTML = messageHTML;
    console.log('[NotebookLM Takeout] Step 3: Setting CSS...');
    tempContainer.style.cssText = 'position: absolute; left: -9999px; top: -9999px; visibility: hidden;';
    console.log('[NotebookLM Takeout] Step 4: Appending to body...');
    document.body.appendChild(tempContainer);
    console.log('[NotebookLM Takeout] Step 5: Temp container appended successfully');

    const sources = [];
    const errors = [];

    try {
      console.log('[NotebookLM Takeout] Step 6: Querying for citation buttons...');
      // Find all citation buttons
      const citationButtons = tempContainer.querySelectorAll('button.citation-marker');
      console.log(`[NotebookLM Takeout] Step 7: Found ${citationButtons.length} citation buttons to extract`);
      console.log('[NotebookLM Takeout] Temp container children:', tempContainer.children.length);
      console.log('[NotebookLM Takeout] Temp container innerHTML length:', tempContainer.innerHTML.length);

      if (citationButtons.length === 0) {
        console.warn('[NotebookLM Takeout] No citation buttons found in HTML!');
        console.log('[NotebookLM Takeout] HTML sample:', messageHTML.substring(0, 500));
        console.log('[NotebookLM Takeout] Trying alternate selectors...');
        console.log('[NotebookLM Takeout] button elements:', tempContainer.querySelectorAll('button').length);
        console.log('[NotebookLM Takeout] .citation elements:', tempContainer.querySelectorAll('.citation').length);
        console.log('[NotebookLM Takeout] [class*=citation]:', tempContainer.querySelectorAll('[class*="citation"]').length);
      }

      const uniqueSources = new Map();

      for (let i = 0; i < citationButtons.length; i++) {
        const button = citationButtons[i];
        const span = button.querySelector('span');
        const spanIndex = span?.innerText?.trim();

        // Skip if no index, already processed, or is a collapsed indicator (...)
        if (!spanIndex || uniqueSources.has(spanIndex) || spanIndex === '...') {
          if (spanIndex === '...') {
            console.log(`[NotebookLM Takeout] Skipping collapsed citation indicator: ${spanIndex}`);
          }
          continue;
        }

        console.log(`[NotebookLM Takeout] Extracting citation ${i + 1}/${citationButtons.length}: ${spanIndex}`);

        // Make button visible temporarily for event handling (temp container buttons need positioning)
        const originalStyle = button.style.cssText;
        button.style.cssText = 'position: fixed; left: 50%; top: 50%; z-index: 10000;';

        // Use retry helper for citation extraction
        const result = await extractSingleCitationWithRetry(button, spanIndex, includeCitationImages, 3);

        // Restore original style
        button.style.cssText = originalStyle;

        if (result.success) {
          uniqueSources.set(spanIndex, {
            index: uniqueSources.size + 1,
            ...result.data
          });

          sources.push({
            index: uniqueSources.size,
            ...result.data
          });

          console.log(`[NotebookLM Takeout] ✓ Extracted citation ${spanIndex}: ${result.data.text}`);
        } else {
          errors.push(result.error);
        }
      }

    } finally {
      // Clean up temporary container
      document.body.removeChild(tempContainer);
    }

    console.log('[NotebookLM Takeout] Citation extraction complete:', {
      sourcesExtracted: sources.length,
      errorsCount: errors.length
    });
    console.log('[NotebookLM Takeout] Extracted sources:', sources);
    console.log('[NotebookLM Takeout] Errors:', errors);

    return {
      sources: sources,
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
