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
      extractNoteContent(message.data.noteIndex, message.data.noteTitle)
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
      // Diagnostic: list all note titles
      const allNoteElements = document.querySelectorAll('artifact-library-note');
      const titles = [];
      allNoteElements.forEach((el, idx) => {
        const titleEl = el.querySelector('.artifact-title, .note-title');
        const title = titleEl?.textContent?.trim();
        titles.push({ index: idx, title: title });
      });
      console.log('[NotebookLM Takeout] DEBUG: All notes:', titles);
      sendResponse({ notes: titles });
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
    }
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
    const allNoteElements = document.querySelectorAll('artifact-library-note');

    console.log(`[NotebookLM Takeout] Found ${allNoteElements.length} total note elements`);

    // Don't filter by visibility - use ALL notes for consistent indexing
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
      }

      notes.push({
        index: idx,
        title: title,
        type: noteType,
        iconType: iconType
      });

      console.log(`[NotebookLM Takeout] Note ${idx}: "${title}" (${noteType})`);
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
    return new Promise((resolve, reject) => {
      const existingEl = parent.querySelector(selector);
      if (existingEl) {
        resolve(existingEl);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const el = parent.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(parent, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });
  }

  // Helper function to sleep
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Extract note content
  async function extractNoteContent(noteIndex, noteTitle) {
    console.log('[NotebookLM Takeout] Extracting note:', noteTitle, 'at index:', noteIndex);

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

          // Method 2: Find and click arrow_back button
          const arrowBackButtons = Array.from(document.querySelectorAll('mat-icon')).filter(icon =>
            icon.textContent.trim() === 'arrow_back'
          );
          for (const icon of arrowBackButtons) {
            const button = icon.closest('button');
            if (button) {
              console.log('[NotebookLM Takeout] Clicking arrow_back button');
              button.click();
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          // Check again
          existingViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
          if (!existingViewer) {
            console.log('[NotebookLM Takeout] ✓ Viewer closed via arrow_back');
            break;
          }

          // Method 3: Panel header children[1] click
          const panelHeaders = document.querySelectorAll('.panel-header');
          if (panelHeaders.length > 0 && panelHeaders[0].children.length > 1) {
            console.log('[NotebookLM Takeout] Clicking panel header children[1]');
            panelHeaders[0].children[1].click();
            await new Promise(resolve => setTimeout(resolve, 500));
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
          // Don't throw - instead, warn and try to continue
          console.warn('[NotebookLM Takeout] Attempting to continue anyway...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Wait for note list to be present (in case we just navigated back)
      await waitForElement('artifact-library-note', 3000);

      // Small delay to let DOM stabilize after navigation
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find all note elements (don't filter by visibility yet - we need to find ALL notes)
      const allNoteElements = document.querySelectorAll('artifact-library-note');
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
        const errorMsg = `Note not found: "${noteTitle}" at index ${noteIndex}. Total notes: ${allNoteElements.length}`;
        console.error('[NotebookLM Takeout]', errorMsg);
        throw new Error(errorMsg);
      }

      // Find and click the note button
      const button = noteEl.querySelector('button.artifact-button-content, button');
      if (!button) {
        throw new Error('Could not find button for note');
      }

      console.log('[NotebookLM Takeout] Clicking note button...');
      button.click();

      // Wait for content to load (editor or mindmap viewer)
      console.log('[NotebookLM Takeout] Waiting for content...');
      const content = await Promise.race([
        waitForElement('rich-text-editor .ql-editor', 5000),
        waitForElement('markdown-editor-legacy .ql-editor', 5000),
        waitForElement('labs-tailwind-doc-viewer', 5000),
        waitForElement('mindmap-viewer', 5000)
      ]).catch(() => null);

      if (!content) {
        throw new Error('Content not found (no editor or mindmap viewer)');
      }

      console.log('[NotebookLM Takeout] Content found:', content.tagName);

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
      // Find all source containers - exactly like the working extension
      const sourceContainers = document.querySelectorAll('.single-source-container');

      console.log(`[NotebookLM Takeout] Found ${sourceContainers.length} source containers in DOM`);

      if (sourceContainers.length === 0) {
        throw new Error(`No source containers found. Make sure you're on the Sources page in NotebookLM.`);
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

      // Open source panel - exactly like working extension: container.children[1].click()
      if (!container.children[1]) {
        throw new Error('Could not find clickable element (children[1]) in source container');
      }

      const clickTarget = container.children[1];
      console.log(`[NotebookLM Takeout] Click target:`, clickTarget.tagName, clickTarget.className);
      console.log(`[NotebookLM Takeout] Click target visible:`, clickTarget.offsetWidth, 'x', clickTarget.offsetHeight);

      // Scroll into view first
      clickTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log(`[NotebookLM Takeout] Executing click...`);
      await clickTarget.click();

      console.log(`[NotebookLM Takeout] Click executed, waiting 1 second...`);
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`[NotebookLM Takeout] Checking DOM state...`);
      console.log(`[NotebookLM Takeout] source-viewer count:`, document.querySelectorAll('source-viewer').length);

      // Wait for source-viewer element (similar to report-viewer pattern)
      const sourceViewer = await waitForElement('source-viewer', 5000);
      if (!sourceViewer) {
        console.error('[NotebookLM Takeout] source-viewer not found');
        throw new Error('source-viewer not found');
      }

      console.log(`[NotebookLM Takeout] source-viewer found`);

      // Wait a bit for content to load
      await new Promise(resolve => setTimeout(resolve, 500));

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

      // Extract source guide information (summary and key topics)
      let sourceGuideHTML = '';
      let keyTopics = [];

      try {
        const sourceGuideContainer = sourceViewer.querySelector('.source-guide-container');
        if (sourceGuideContainer) {
          console.log(`[NotebookLM Takeout] Found source guide container`);

          // Extract summary (preserve HTML including <strong> tags)
          const summaryElement = sourceGuideContainer.querySelector('.summary');
          if (summaryElement) {
            sourceGuideHTML = summaryElement.innerHTML.trim();
            console.log(`[NotebookLM Takeout] Extracted source guide summary (${sourceGuideHTML.length} chars)`);
          }

          // Extract key topics (preserve text)
          const keyTopicElements = sourceGuideContainer.querySelectorAll('.key-topics-text');
          if (keyTopicElements.length > 0) {
            keyTopics = Array.from(keyTopicElements).map(el => el.textContent.trim());
            console.log(`[NotebookLM Takeout] Extracted ${keyTopics.length} key topics`);
          }
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
        guideHTML: sourceGuideHTML,
        keyTopics: keyTopics
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[NotebookLM Takeout] ✗ Source extraction failed (${duration}ms):`, error);
      throw error;
    }
  }

  // Convert HTML element to markdown (preserves formatting)
  function htmlToMarkdown(element) {
    if (!element) return '';

    let markdown = '';

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
          const cellContents = cells.map(cell => processNode(cell, context).trim());
          rows.push(cellContents);
          if (idx === 0) isFirstRowHeader = true;
        });
      }

      if (tbody) {
        const bodyRows = tbody.querySelectorAll('tr');
        bodyRows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td, th'));
          const cellContents = cells.map(cell => processNode(cell, context).trim());
          rows.push(cellContents);
        });
      }

      // If no thead/tbody, get rows directly from table
      if (!thead && !tbody) {
        const allRows = tableNode.querySelectorAll('tr');
        allRows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll('th, td'));
          const cellContents = cells.map(cell => processNode(cell, context).trim());

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
      const items = Array.from(listNode.children).filter(child => child.tagName.toLowerCase() === 'li');
      let listMarkdown = '\n';

      items.forEach((li, idx) => {
        const indent = '  '.repeat(context.listDepth);
        const marker = isOrdered ? `${idx + 1}.` : '-';

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

    // Find all "show more" buttons (contain "..." text or "Show additional citations" aria-label)
    const showMoreButtons = Array.from(viewer.querySelectorAll('button.citation-marker'))
      .filter(btn => {
        const span = btn.querySelector('span[aria-label="Show additional citations"], span');
        return span && (
          span.textContent?.trim() === '...' ||
          span.getAttribute('aria-label') === 'Show additional citations'
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

        // Extract source filename from footer (may be empty for some citations)
        const sourceTitle = footerEl?.textContent?.trim() || '';
        console.log('  - footer element found:', !!footerEl, 'content:', sourceTitle || '(empty)');

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
            textElements.forEach(el => {
              const markdown = htmlToMarkdown(el);
              if (markdown && markdown.length > 0) {
                highlightedText += markdown + '\n\n';
              }
            });
          } else {
            // Strategy 2: Try converting the whole tooltipText element
            console.log('  - using full tooltip text content');
            highlightedText = htmlToMarkdown(tooltipText);
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

    // Get SVG dimensions and viewBox
    const bbox = svg.getBBox();
    const width = Math.ceil(bbox.width + bbox.x + 100);
    const height = Math.ceil(bbox.height + bbox.y + 100);

    // Set proper SVG attributes for standalone file
    svgClone.setAttribute('width', width);
    svgClone.setAttribute('height', height);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Add viewBox if not present
    if (!svgClone.hasAttribute('viewBox')) {
      svgClone.setAttribute('viewBox', `${bbox.x - 50} ${bbox.y - 50} ${width} ${height}`);
    }

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

      // Get the parent button and click it to open report-viewer
      const reportButton = titleElement.closest('button');
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

      // Get the parent button and click it to open table-viewer
      const tableButton = titleElement.closest('button');
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
      // Try multiple selectors for the actual table
      let contentElement = null;
      const contentSelectors = [
        'table',
        '.table-container table',
        '[role="table"]',
        '.data-table',
        '.table-container',
        '[class*="table"]'
      ];

      for (const selector of contentSelectors) {
        contentElement = tableViewer.querySelector(selector);
        if (contentElement) {
          console.log(`[NotebookLM Takeout] Found table with selector: ${selector}`);
          break;
        }
      }

      if (!contentElement) {
        // Fallback: use entire table-viewer innerHTML
        console.log('[NotebookLM Takeout] No specific table element found, using table-viewer innerHTML');
        contentElement = tableViewer;
      }

      // Extract HTML content
      const htmlContent = contentElement.innerHTML;
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

      // Method 1: Arrow back icon button (for notes/reports)
      console.log('[NotebookLM Takeout] Trying arrow_back button...');
      const arrowBackButtons = Array.from(document.querySelectorAll('mat-icon')).filter(icon =>
        icon.textContent.trim() === 'arrow_back'
      );
      for (const icon of arrowBackButtons) {
        const button = icon.closest('button');
        if (button) {
          console.log('[NotebookLM Takeout] Clicking arrow_back button');
          button.click();
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      // Check again
      noteViewer = document.querySelector('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer, note-editor, report-viewer');
      if (!noteViewer) {
        console.log('[NotebookLM Takeout] ✓ Panel closed via arrow_back');
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
    console.log('[NotebookLM Takeout] Available elements:', {
      panelHeaders: document.querySelectorAll('.panel-header').length,
      backButtons: document.querySelectorAll('button[aria-label*="Back"]').length,
      closeButtons: document.querySelectorAll('button[aria-label*="Close"]').length,
      arrowBackIcons: Array.from(document.querySelectorAll('mat-icon')).filter(i => i.textContent.trim() === 'arrow_back').length,
      noteViewers: document.querySelectorAll('rich-text-editor, markdown-editor-legacy, labs-tailwind-doc-viewer, mindmap-viewer').length
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
      console.log(`[NotebookLM Takeout] [Download] ✓ Download initiated via button (${duration}ms)`);

      return {
        success: true,
        method: 'button_click',
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
   */
  async function clickArtifactDownloadButton(moreButton, artifactItem, moreButtonAlreadyClicked = false) {
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

    // Wait for download to initiate (detect aria-busy or other loading states)
    await waitForDownloadInitiation();

    return { success: true };
  }

  /**
   * Find download button trying multiple selectors
   * Returns the first matching button or null
   */
  async function findDownloadButton() {
    const selectors = [
      // Material menu items with "Download" text
      '.mat-mdc-menu-item .mat-mdc-menu-item-text:has-text("Download")',
      '.mat-mdc-menu-item:has-text("Download")',

      // Generic patterns
      'button[aria-label*="Download"]',
      'button[aria-label*="download"]',
      '[role="menuitem"]:has-text("Download")',

      // Broader fallback - find all menu items and filter by text
      '.mat-mdc-menu-item, [role="menuitem"]'
    ];

    for (const selector of selectors) {
      try {
        if (selector.includes(':has-text')) {
          // Manual text search for :has-text pseudo-selector
          const baseSelector = selector.split(':has-text')[0];
          const textMatch = selector.match(/:has-text\("([^"]+)"\)/)?.[1];
          const elements = document.querySelectorAll(baseSelector);

          for (const el of elements) {
            if (textMatch && el.textContent?.toLowerCase().includes(textMatch.toLowerCase())) {
              console.log(`[NotebookLM Takeout] [Download] Found download button with selector: ${baseSelector} (text: "${textMatch}")`);
              return el;
            }
          }
        } else {
          const button = document.querySelector(selector);
          if (button) {
            console.log(`[NotebookLM Takeout] [Download] Found download button with selector: ${selector}`);
            return button;
          }
        }
      } catch (e) {
        // Selector not supported, continue to next
        continue;
      }
    }

    // Final fallback: manually search all menu items
    const menuItems = document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]');
    for (const item of menuItems) {
      const text = item.textContent?.toLowerCase() || '';
      if (text.includes('download')) {
        console.log('[NotebookLM Takeout] [Download] Found download button via text search');
        return item;
      }
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

      // Get SVG dimensions
      const bbox = svg.getBBox();
      const width = Math.ceil(bbox.width + bbox.x + 20);
      const height = Math.ceil(bbox.height + bbox.y + 20);

      // Set proper SVG attributes
      svgClone.setAttribute('width', width);
      svgClone.setAttribute('height', height);
      svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      if (!svgClone.hasAttribute('viewBox')) {
        svgClone.setAttribute('viewBox', `${bbox.x - 10} ${bbox.y - 10} ${width} ${height}`);
      }

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

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
