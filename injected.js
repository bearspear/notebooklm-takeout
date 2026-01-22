// NotebookLM Takeout - Injected Script
// Runs in page context to intercept network requests and access page objects

(function() {
  'use strict';

  console.log('[NotebookLM Takeout] Injected script loaded');

  // Store original fetch and XMLHttpRequest
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  // Patterns to match NotebookLM API endpoints
  const API_PATTERNS = {
    audio: /audio|podcast|overview/i,
    slides: /slide|deck|presentation/i,
    infographic: /infographic|visual/i,
    notebook: /notebook|source|citation/i
  };

  // Intercept fetch requests
  window.fetch = async function(...args) {
    const [url, options] = args;
    const urlString = typeof url === 'string' ? url : url.url;

    try {
      const response = await originalFetch.apply(this, args);

      // Clone response to read without consuming
      const clone = response.clone();

      // Check if this is a relevant API call
      if (isRelevantUrl(urlString)) {
        processResponse(urlString, clone);
      }

      return response;
    } catch (error) {
      throw error;
    }
  };

  // Intercept XMLHttpRequest
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._nlmeUrl = url;
    this._nlmeMethod = method;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    this.addEventListener('load', function() {
      if (isRelevantUrl(this._nlmeUrl)) {
        try {
          const data = JSON.parse(this.responseText);
          notifyContentScript('NLME_NETWORK_RESPONSE', {
            url: this._nlmeUrl,
            method: this._nlmeMethod,
            data: data
          });
        } catch (e) {
          // Response might not be JSON
        }
      }
    });

    return originalXHRSend.apply(this, [body]);
  };

  function isRelevantUrl(url) {
    if (!url) return false;

    // Check for NotebookLM API patterns
    const patterns = [
      'notebooklm',
      'notebook-lm',
      'googleapis.com',
      'google.com/notebook'
    ];

    return patterns.some(p => url.toLowerCase().includes(p));
  }

  async function processResponse(url, response) {
    try {
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();
        analyzeJsonResponse(url, data);
      } else if (contentType.includes('audio')) {
        // Audio blob detected
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        notifyContentScript('NLME_AUDIO_DETECTED', {
          id: generateId(),
          src: blobUrl,
          contentType: contentType,
          size: blob.size
        });
      } else if (contentType.includes('image')) {
        // Image detected (could be infographic)
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        notifyContentScript('NLME_INFOGRAPHIC_DETECTED', {
          id: generateId(),
          src: blobUrl,
          contentType: contentType
        });
      }
    } catch (error) {
      console.error('[NotebookLM Takeout] Error processing response:', error);
    }
  }

  function analyzeJsonResponse(url, data) {
    // Look for audio overview data
    if (data.audioOverview || data.audio || API_PATTERNS.audio.test(url)) {
      const audioData = data.audioOverview || data.audio || data;
      if (audioData.url || audioData.src || audioData.downloadUrl) {
        notifyContentScript('NLME_AUDIO_DETECTED', {
          id: audioData.id || generateId(),
          src: audioData.url || audioData.src || audioData.downloadUrl,
          title: audioData.title || audioData.name,
          duration: audioData.duration
        });
      }
    }

    // Look for slide deck data
    if (data.slideDeck || data.slides || data.presentation || API_PATTERNS.slides.test(url)) {
      const slideData = data.slideDeck || data.slides || data.presentation || data;
      notifyContentScript('NLME_SLIDES_DETECTED', {
        id: slideData.id || generateId(),
        title: slideData.title || slideData.name,
        slides: slideData.slides || slideData.pages,
        downloadUrl: slideData.downloadUrl || slideData.pdfUrl
      });
    }

    // Look for infographic data
    if (data.infographic || API_PATTERNS.infographic.test(url)) {
      const infographicData = data.infographic || data;
      notifyContentScript('NLME_INFOGRAPHIC_DETECTED', {
        id: infographicData.id || generateId(),
        title: infographicData.title || infographicData.name,
        imageUrl: infographicData.imageUrl || infographicData.url
      });
    }

    // Forward raw data for analysis
    notifyContentScript('NLME_NETWORK_RESPONSE', {
      url: url,
      data: data
    });
  }

  function notifyContentScript(type, payload) {
    window.postMessage({ type, payload }, '*');
  }

  function generateId() {
    return 'nlme-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // Listen for capture requests from content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'NLME_CAPTURE_SLIDES') {
      await captureSlides(event.data.payload);
    }
  });

  async function captureSlides(options) {
    // Try to use html2canvas if available, or capture via other means
    const slideElements = document.querySelectorAll('[class*="slide"]:not([class*="slider"])');

    if (slideElements.length === 0) {
      console.warn('[NotebookLM Takeout] No slides found to capture');
      return;
    }

    const slides = [];

    for (let i = 0; i < slideElements.length; i++) {
      const slide = slideElements[i];

      // Try to capture as canvas
      if (typeof html2canvas !== 'undefined') {
        try {
          const canvas = await html2canvas(slide);
          slides.push({
            index: i,
            dataUrl: canvas.toDataURL('image/png')
          });
        } catch (e) {
          console.error(`[NotebookLM Takeout] Failed to capture slide ${i}:`, e);
        }
      } else {
        // Fallback: capture inner HTML
        slides.push({
          index: i,
          html: slide.outerHTML
        });
      }
    }

    notifyContentScript('NLME_SLIDES_CAPTURED', {
      title: options.notebookTitle,
      slides: slides,
      totalSlides: slideElements.length
    });
  }

  // Monitor for blob URL creation (audio/video playback)
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(blob) {
    const url = originalCreateObjectURL.call(this, blob);

    if (blob.type && blob.type.startsWith('audio/')) {
      notifyContentScript('NLME_AUDIO_DETECTED', {
        id: generateId(),
        src: url,
        contentType: blob.type,
        size: blob.size
      });
    } else if (blob.type && blob.type.startsWith('image/')) {
      // Could be infographic
      notifyContentScript('NLME_INFOGRAPHIC_DETECTED', {
        id: generateId(),
        src: url,
        contentType: blob.type
      });
    }

    return url;
  };

  console.log('[NotebookLM Takeout] Network interception active');
})();
