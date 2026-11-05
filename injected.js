// NotebookLM Takeout - page-world download hook.
//
// Runs as a MAIN-world content script at document_start (manifest), after
// takeout-shared.js. Gemini Notebook's More → Download calls window.open with
// a contribution.usercontent.google.com URL. The extension needs that URL to
// save the file under its own name without opening a tab.
//
// The hook intercepts ONLY right after the extension's own Download click:
// content.js dispatches `nlme-arm-intercept` on document just before it clicks,
// which arms NLME.createInterceptArm for 3 s and is consumed by the first
// matching URL. A user's own Download click is never armed, so it downloads
// normally (Milestone 1; the old hook intercepted every click).

(function () {
  'use strict';

  const NLME = globalThis.NLME;
  if (!NLME || !NLME.createInterceptArm) {
    console.warn('[NotebookLM Takeout] takeout-shared.js missing in page world; download hook disabled');
    return;
  }

  // Marked with the NLME it uses: after an update, a tab left open is injected
  // again with a new NLME, and the new hook goes on top of the stale one
  if (window.__nlmeDownloadHook === NLME) return;
  window.__nlmeDownloadHook = NLME;

  const arm = NLME.createInterceptArm(3000);
  const originalWindowOpen = window.open;

  // DOM events cross the isolated/main world boundary synchronously, so the
  // arm is set before content.js calls click().
  document.addEventListener('nlme-arm-intercept', () => arm.arm(Date.now()));

  function report(url) {
    window.postMessage({
      type: NLME.MSG.NLME_DOWNLOAD_URL_INTERCEPTED,
      payload: { url, timestamp: Date.now() }
    }, '*');
  }

  window.open = function (url, target, features) {
    const urlString = url ? url.toString() : '';
    if (arm.shouldIntercept(urlString, Date.now())) {
      console.log('[NotebookLM Takeout] Intercepted download URL:', urlString.substring(0, 100));
      report(urlString);
      // Fake window so the page's code doesn't throw
      return {
        closed: false,
        close() { this.closed = true; },
        focus() {},
        blur() {},
        location: { href: urlString }
      };
    }
    return originalWindowOpen.apply(this, [url, target, features]);
  };

  // Some downloads are plain links rather than window.open
  document.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    if (arm.shouldIntercept(link.href, Date.now())) {
      console.log('[NotebookLM Takeout] Intercepted download link:', link.href.substring(0, 100));
      event.preventDefault();
      event.stopPropagation();
      report(link.href);
    }
  }, true);
})();
