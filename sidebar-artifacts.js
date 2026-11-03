// NotebookLM Takeout - Sidebar: Artifacts tab (artifact files, scan, Download Selected, Download All, data-table converters)
// Classic script, loads after sidebar-core.js. Shared helpers live in sidebar-core.js.

/**
 * Get artifact type prefix for filenames
 */
function getArtifactTypePrefix(artifactType) {
  return NLME.artifactTypePrefix(artifactType);
}
// ==================== ARTIFACT FILES ====================


// Notebook metadata for a single download (Download All passes the shell's)
async function artifactMeta(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return NLME.exportMeta({
    notebookTitle: await getProjectName(tabId),
    tabUrl: tab.url,
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date()
  });
}

// A Data Table as <stem>.csv, plus (from HTML) <stem>.json, the clean
// <stem>.html and <stem>-references.txt when it has footnotes
function dataTableFiles(stem, response, title) {
  if (response.format !== 'html') return [{ path: `${stem}.csv`, data: response.data || '' }];

  const files = [{ path: `${stem}.csv`, data: convertTableToCSV(response.data) }];
  const tableData = extractTableDataAsJSON(response.data);
  const footnotes = extractFootnotesFromHTML(response.data);
  const hasFootnotes = !!(footnotes && footnotes.trim().length > 0);
  if (tableData) {
    files.push({
      path: `${stem}.json`,
      data: JSON.stringify({
        title,
        exported: new Date().toISOString(),
        table: tableData,
        footnotes: hasFootnotes ? footnotes.split('\n\n').filter(line => /^\[\d+\]/.test(line.trim())) : []
      }, null, 2)
    });
  }
  const cleanHTML = createCleanTableHTML(response.data, title, footnotes);
  if (cleanHTML) files.push({ path: `${stem}.html`, data: cleanHTML });
  if (hasFootnotes) files.push({ path: `${stem}-references.txt`, data: footnotes });
  return files;
}

// A Report as Markdown with front matter (never the raw HTML)
function reportFile(stem, response, title, meta) {
  const markdown = response.format === 'html'
    // skipTitle: the report's own H1 is already in the content
    ? convertToMarkdown(response.data, citationTitlesFromHtml(response.data), title, false, true, null, false)
    : (response.data || '');
  return { path: `${stem}.md`, data: noteFrontMatter(meta, { title, kind: 'report' }) + markdown };
}

/**
 * Fetch one Studio artifact as file entries: the one per-method conversion
 * behind single downloads and Download All (Milestone 3a). Paths are
 * relative (the caller adds a type folder or nothing).
 *
 * - Report: <stem>.md; Data Table: .csv/.json/.html/-references.txt;
 *   Mind Map: .svg/.json/.html; rendered infographic: <stem>.svg|.png
 * - url_intercepted: 'zip' fetches the file ({ path, data }); 'folder' and
 *   'single' leave it to the background ({ path, url }, DIRECT_DOWNLOAD_URL)
 * - button_click (no URL): the background captured and saved Chrome's own
 *   download (into `folder` when given): files [], savedOutside true
 *
 * The intercept request armed before the click is always cancelled before
 * this returns or throws, so it can never rename a later download.
 *
 * @param {number} tabId
 * @param {{ index: number, type: string, label: string }} item
 * @param {{ stem: string, mode: 'single'|'zip'|'folder', meta?: object, folder?: string, slidesFormat?: 'pdf'|'pptx' }} options
 *   meta: front matter metadata (computed from the tab when omitted);
 *   folder: Downloads subfolder for a captured button_click download;
 *   slidesFormat: Slides format for this call (default: the ⚙️ setting)
 * @returns {Promise<{ files: Array<{path: string, data?: string|Blob, url?: string}>, savedOutside: boolean }>}
 */
async function fetchArtifactFiles(tabId, item, { stem, mode, meta, folder = '', slidesFormat = settings.slidesFormat }) {
  const { index, type, label } = item;
  const format = slidesFormat === 'pptx' ? 'pptx' : 'pdf';
  logger.info('Download', `Downloading artifact ${index} (${type})`, label);
  await ensureContentScriptLoaded(tabId);

  // Reports, Data Tables and Mind Maps are read from the page; the rest go
  // through the item's More → Download menu
  const extractable = type === 'Report' || type === 'Data Table' || type === 'Mind Map';
  try {
    if (!extractable) {
      // Armed BEFORE the click: a real Chrome download (no intercepted URL)
      // is captured, renamed and kept from opening a tab
      await chrome.runtime.sendMessage({ type: NLME.MSG.START_INTERCEPT_DOWNLOAD, name: label, artifactType: type, folder, obsidian: !!settings.obsidianNames });
    }

    const response = await chrome.tabs.sendMessage(tabId, {
      type: NLME.MSG.DOWNLOAD_ARTIFACT,
      data: extractable
        ? { artifactIndex: index, artifactType: type, artifactName: label, skipMoreButton: true }
        : { artifactIndex: index, artifactType: type, artifactName: label, downloadPreference: format }
    });
    if (!response || !response.success) {
      throw new Error(response?.error || 'Download failed');
    }
    logger.download(label, 'success', `Method: ${response.method}, Duration: ${response.duration}ms`);
    const title = response.title || label;

    switch (response.method) {
      case 'mindmap_app_frame': {
        const frame = await chrome.runtime.sendMessage({ type: NLME.MSG.EXTRACT_MINDMAP_FRAME, tabId });
        if (!frame || !frame.success) throw new Error(frame?.error || 'Failed to extract mind map');
        return { files: await mindmapFiles(stem, frame.svgContent, frame.treeData, title), savedOutside: false };
      }
      case 'mindmap_extraction':
        return { files: await mindmapFiles(stem, response.svgContent, response.treeData, title), savedOutside: false };
      case 'content_extraction':
        return {
          files: type === 'Data Table'
            ? dataTableFiles(stem, response, title)
            : [reportFile(stem, response, title, meta || await artifactMeta(tabId))],
          savedOutside: false
        };
      case 'svg_extract':
      case 'canvas_export': {
        const blob = await (await fetch(response.data)).blob();
        const ext = NLME.extensionFor({ mime: blob.type }) || (response.format === 'svg' ? '.svg' : '.png');
        return { files: [{ path: stem + ext, data: blob }], savedOutside: false };
      }
      case 'url_intercepted': {
        const url = response.url;
        if (mode === 'zip') {
          const blob = await fetchDownload(url, { tabId });
          return { files: [{ path: stem + NLME.extensionFor({ url, mime: blob.type, type, format }), data: blob }], savedOutside: false };
        }
        return { files: [{ path: stem + NLME.extensionFor({ url, type, format }), url }], savedOutside: false };
      }
      case 'button_click': {
        // No URL came back: wait for the background to capture Chrome's
        // download, and fail loudly if it never does (Milestone 1)
        let result = null;
        for (let waited = 0; waited < 20000; waited += 250) {
          result = await chrome.runtime.sendMessage({ type: NLME.MSG.GET_INTERCEPTED_DOWNLOAD });
          if (result && result.success) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!result || !result.success) throw new Error('Download was not captured');
        logger.download(title, 'success', `Downloaded without tab: ${result.filename}`);
        return { files: [], savedOutside: true };
      }
      default:
        throw new Error(`Unknown download method: ${response.method}`);
    }
  } catch (error) {
    logger.error('Download', `Failed to download ${label}`, error);
    throw error;
  } finally {
    // A queued intercept request would otherwise rename the next unrelated
    // download (even the user's own) as this item for up to 20 s
    await chrome.runtime.sendMessage({ type: NLME.MSG.CANCEL_INTERCEPT }).catch(() => {});
  }
}

/**
 * Download one artifact (row button, Studio list): today's single-file
 * names ([report]_Title.md, [audio-overview]_Title.m4a, ...); a Data Table
 * or mind map is one ZIP ([data-table]_Title.zip, [mind-map]_Title.zip).
 */
async function downloadArtifact(tabId, artifactIndex, artifactType, artifactName) {
  const obsidian = !!settings.obsidianNames;
  const stem = NLME.prefixedStem(getArtifactTypePrefix(artifactType), artifactName, { obsidian });
  const { files } = await fetchArtifactFiles(tabId,
    { index: artifactIndex, type: artifactType, label: artifactName },
    { stem, mode: 'single' });
  // Data Tables and mind maps are several files: one ZIP, as before 3a
  const pkg = NLME.singleArtifactPackage({ type: artifactType, title: artifactName, files, obsidian });
  if (pkg) await saveFiles(pkg.entries, { zipName: pkg.zipName });
  else await saveFiles(files);
  return { success: true, files: files.length };
}

// Studio artifacts from SCAN_STUDIO_ITEMS, no UI (Artifacts tab, Full
// Takeout). disabled: a type that cannot be exported yet.
// @returns {Promise<Array<{ index, label, type, details, disabled }>>}
async function scanArtifactsData(tabId) {
  await ensureContentScriptLoaded(tabId);
  const scan = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.SCAN_STUDIO_ITEMS });
  return (scan?.items || [])
    .filter(item => item.kind === 'artifact')
    .map(item => ({
      index: item.moreIndex,
      label: item.label,
      type: item.type,
      details: item.details,
      disabled: !item.downloadable
    }));
}

// The Artifacts tab's list controller (sidebar-list.js) and what it was built from.
// startAutoRefresh calls scanPage every few seconds: when the scan finds the same
// items the list is left alone, so typing in the filter box is never interrupted.
let _artifactsListController = null;
let _artifactsSignature = null;

function dropArtifactsList() {
  if (_artifactsListController) {
    _artifactsListController.destroy();
    _artifactsListController = null;
  }
  _artifactsSignature = null;
}

// Everything the rows are drawn from (and the page their buttons talk to); equal
// signatures need no redraw
function artifactsSignature(tab, items) {
  const keys = NLME.listItemKeys(items, { titleOf: i => i.label, typeOf: i => i.type });
  return JSON.stringify([tab.id, tab.url, items.map((item, i) => [keys[i], item.index, !!item.disabled, item.details || ''])]);
}

// "Download Selected (K)": disabled at K = 0
function updateArtifactsDownloadBtn(controller = _artifactsListController) {
  const btn = document.getElementById('download-all-btn');
  if (!btn || !controller) return;
  const n = controller.selectedCount();
  btn.disabled = n === 0;
  setButtonLabel(btn, `Download Selected (${n})`);
}

async function scanPage() {
  const resultsEl = document.getElementById('scan-results');
  const countBadge = document.getElementById('artifact-count');
  // A live list is not blanked while rescanning: the redraw (if any) happens below
  const listLive = !!_artifactsListController && !!resultsEl.querySelector('.artifacts-list');
  if (!listLive) {
    resultsEl.innerHTML = '<p class="scanning">Scanning...</p>';
    countBadge.textContent = '0';
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!isNotebookUrl(tab?.url)) {
      dropArtifactsList();
      resultsEl.innerHTML = '<p class="error">Please open NotebookLM first</p>';
      countBadge.textContent = '0';
      return;
    }

    const items = await scanArtifactsData(tab.id);

    if (items.length === 0) {
      dropArtifactsList();
      resultsEl.innerHTML = '<p class="empty-message">No downloadable artifacts found.<br><span class="hint">Make sure you have generated content in Studio.</span></p>';
      countBadge.textContent = '0';
      return;
    }

    const signature = artifactsSignature(tab, items);
    if (listLive && signature === _artifactsSignature && resultsEl.querySelector('.artifacts-list')) {
      return; // unchanged: keep the list, its focus, caret, scroll and selection
    }

    const enabledItems = items.filter(i => !i.disabled);
    countBadge.textContent = enabledItems.length;

    // A redraw must not cost the user their place: keep the Zip choice, the scroll
    // position and, if they are typing in the filter box, focus and caret
    const zipChecked = document.getElementById('zip-checkbox')?.checked ?? !!settings.autoZip;
    const scrollTop = resultsEl.scrollTop;
    const active = document.activeElement;
    const searchHadFocus = !!active && active.classList && active.classList.contains('list-search') && resultsEl.contains(active);
    const caret = searchHadFocus ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;

    dropArtifactsList();
    resultsEl.innerHTML = `
      <div class="artifacts-list"></div>
      <div class="download-all-controls">
        <button id="download-all-btn" class="btn btn-primary" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          Download Selected (0)
        </button>
        <label class="zip-checkbox">
          <input type="checkbox" id="zip-checkbox" ${zipChecked ? 'checked' : ''}> Zip
        </label>
      </div>
    `;
    const listEl = resultsEl.querySelector('.artifacts-list');

    const rowHtml = (item, idx) => `
        <div class="scan-item-icon">
          ${getIconForType(item.type)}
        </div>
        <div class="scan-item-info">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.type)}${item.details ? ' · ' + escapeHtml(item.details) : ''}</small>
        </div>
        <button class="btn-icon download-single-btn" data-index="${escapeHtml(String(item.index))}" data-item-idx="${idx}" ${item.disabled ? `disabled title="${escapeHtml(item.type)} export not supported yet"` :`title="Download ${escapeHtml(item.label)}"`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <span class="download-status"></span>
        </button>
      `;

    _artifactsListController = createListController({
      tab: 'artifacts',
      container: listEl,
      items,
      titleOf: item => item.label,
      typeOf: item => item.type,
      defaultSelected: 'all',
      canSelect: item => !item.disabled,
      rowHtml,
      onChange: controller => updateArtifactsDownloadBtn(controller)
    });
    _artifactsSignature = signature;

    resultsEl.scrollTop = scrollTop;
    if (caret) {
      const search = listEl.querySelector('.list-search');
      if (search) {
        search.focus({ preventScroll: true });
        try { search.setSelectionRange(caret[0], caret[1], caret[2] || 'none'); } catch (_) { /* not a text field */ }
      }
    }

    // Add click handlers for individual download buttons with status feedback
    listEl.querySelectorAll('button[data-index]').forEach((btn) => {
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
          const outcome = await runExclusive('Artifact download', () => triggerItemDownload(tab.id, idx, item.label, item.type));
          if (outcome === JOB_BUSY) {
            // Refused: another job is running; nothing was downloaded
            if (statusSpan) { statusSpan.textContent = ''; statusSpan.className = 'download-status'; }
            btn.disabled = false;
            return;
          }

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

    // Add handler for Download Selected button
    const downloadAllBtn = document.getElementById('download-all-btn');
    downloadAllBtn.addEventListener('click', async () => {
      const selected = _artifactsListController ? _artifactsListController.selectedItems() : [];
      if (selected.length === 0) return;
      await runExclusive('Download All', () => downloadAllArtifacts(tab.id, selected));
    });
    updateArtifactsDownloadBtn();

  } catch (error) {
    console.error('Scan failed:', error);
    dropArtifactsList();
    resultsEl.innerHTML = `<p class="error">Scan failed: ${escapeHtml(error.message)}</p>`;
  }
}

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
// ==================== CSV CONVERSION ====================


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

// Sources for an exported report: one entry per citation number, titled
// from the marker's aria-label ("3: Title"), so every [n] in the report links
// to a Sources entry (Milestone 2, Output #4)
function citationTitlesFromHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const byNumber = new Map();
  doc.querySelectorAll('button.citation-marker').forEach(button => {
    const span = button.querySelector('span');
    const number = NLME.parseCitationIndex(span?.textContent);
    if (number && !byNumber.has(number)) {
      byNumber.set(number, {
        sourceIndex: number,
        text: NLME.citationTitleFromAriaLabel(span.getAttribute('aria-label'), number),
        quote: ''
      });
    }
  });
  return [...byNumber.values()];
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


// Size cap of one artifacts ZIP (ZIP mode): JSZip builds a ZIP in the side
// panel's memory, so a big notebook is split into parts. The size is checked
// after each item; a part may pass the cap by one item.
const ARTIFACT_ZIP_MAX_BYTES = 500 * 1024 * 1024;

// Download All (Milestone 3a): every artifact on the job runner. ZIP on:
// <Notebook>-artifacts-<ts>.zip, or -partN.zip parts past the size cap; ZIP off: Downloads/<Notebook>/, one item
// per call. Either way: <type folder>/<stem>.<ext>, _index.md, errors.md,
// manifest.json. Returns withExportShell's outcome, like exportNotesAsMarkdown.
async function downloadAllArtifacts(tabId, items, { updateRecord = false } = {}) {
  await preflightWarn(tabId, 'artifacts');
  const zipEnabled = document.getElementById('zip-checkbox')?.checked || false;
  const downloadBtn = document.getElementById('download-all-btn');
  if (downloadBtn) downloadBtn.disabled = true;
  startExportTiming();

  try {
    return await withExportShell({ label: 'artifacts', overlayMessage: 'Preparing to download artifacts...', tabId }, async shell => {
      const folder = zipEnabled ? null : (shell.projectName || 'NotebookLM');
      const { result, zips, savedOutside } = await withJobRecord(shell, 'artifacts', 'Artifacts', 'artifacts', items,
        tracker => runArtifactsJob(shell, items, { folder, tracker }), { update: updateRecord });

      return shell.finish({
        kind: 'artifacts',
        selected: items.length,
        result,
        errorNote: savedOutside > 0 ? `${savedOutside} saved separately to Downloads, see errors.md` : undefined,
        // ZIP mode: the ZIP names; folder mode: the folder, once it holds a file
        saved: folder ? (result.exported > 0 || result.errors.length > 0 ? [folder] : []) : zips,
        retry: retryFor(result.failedItems, 'Download All', failed => downloadAllArtifacts(shell.tab.id, failed, { updateRecord: true }))
      });
    });
  } finally {
    updateArtifactsDownloadBtn(); // enabled again only if something is still selected
  }
}

/**
 * Run the artifacts job inside an export shell. ZIP mode (no target.folder):
 * every file is fetched and packed into ZIPs of about ARTIFACT_ZIP_MAX_BYTES
 * each (parts: -partN.zip, or part-N/ in a takeout), every part with its own
 * root files. Folder
 * mode: each item is saved into the folder as it is fetched (CDN media
 * straight to disk), the root files after the last one.
 *
 * @param {object} shell withExportShell's shell
 * @param {Array<{ index, label, type }>} items downloadable artifacts (scanArtifactsData)
 * @param {CategoryTarget & { bothSlideFormats?: boolean }} [target]
 *   bothSlideFormats: save every Slides artifact as PDF and PowerPoint
 *   (Full Takeout); otherwise the ⚙️ slides format alone
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean, savedOutside: number, parts: number, packages: number }>}
 *   savedOutside: items Chrome saved itself (no capturable URL)
 */
async function runArtifactsJob(shell, items, { pathPrefix = '', zipKind = 'artifacts', folder = null, bothSlideFormats = false, written = newWritten(), tracker = null } = {}) {
  const zipMode = !folder;
  const place = files => (pathPrefix ? files.map(f => ({ ...f, path: pathPrefix + f.path })) : files);
  const stems = NLME.artifactStems(items, { obsidian: !!settings.obsidianNames });
  const stemOf = new Map(items.map((item, idx) => [item, stems[idx]]));
  // Folder mode: what earlier items saved, for _index.md and manifest.json
  // (Blobs replaced by their size: the manifest needs no more)
  const saved = [];
  let savedOutside = 0;

  const result = await NLME.runExportJob({
    kind: 'artifacts',
    items,
    perZip: zipMode ? Infinity : 1,
    // ZIP mode only: split by size (folder mode streams to disk)
    ...(zipMode ? { maxBatchBytes: ARTIFACT_ZIP_MAX_BYTES, sizeOf: r => NLME.filesByteSize(r.files) } : {}),
    titleOf: item => item.label,
    extractOne: async (item, ctx) => {
      const typeFolder = NLME.artifactFolder(item.type);
      // One fetch per slide format with the same stem: the files differ by
      // extension (the guessed one follows the format; the background's
      // real-extension rename keeps them apart)
      const formats = NLME.slideFormatsFor(item.type, { both: bothSlideFormats, preferred: settings.slidesFormat });
      const fetched = { files: [], savedOutside: false };
      const failures = [];
      for (const format of formats) {
        try {
          const one = await retryDownload(() => fetchArtifactFiles(shell.tab.id, item, {
            stem: stemOf.get(item),
            mode: zipMode ? 'zip' : 'folder',
            meta: shell.meta,
            folder: zipMode ? '' : folder,
            ...(format ? { slidesFormat: format } : {})
          }), 3, item.label);
          fetched.files.push(...one.files);
          fetched.savedOutside = fetched.savedOutside || one.savedOutside;
        } catch (error) {
          failures.push({ format, error });
        }
      }
      // Every format failed: the item fails as with a single format
      if (failures.length === formats.length) throw failures[failures.length - 1].error;
      // One format failed, another saved: keep the item, say what is missing
      for (const { format, error } of failures) {
        ctx.warn(`[${item.label}] ${format.toUpperCase()} version failed: ${error.message}`);
      }
      if (fetched.savedOutside) {
        savedOutside++;
        // Folder mode: the background captured it into the folder's top level
        const where = zipMode ? 'Downloads' : `Downloads/${NLME.downloadFolderPath(folder, '').replace(/\/$/, '')}`;
        ctx.warn(`[${item.label}] saved separately to ${where} (no capturable URL)`);
      }
      const files = fetched.files.map(f => ({ ...f, path: `${typeFolder}/${f.path}`, title: item.label, itemKind: 'artifact' }));
      if (!zipMode) {
        // Saved here, not in packageBatch, so a failed save fails this
        // item (errors.md) instead of ending the whole job
        await saveFiles(place(files), { folder });
        written.count++;
        saved.push({ item, files: files.map(f => (f.data instanceof Blob ? { ...f, data: { byteLength: f.data.size } } : f)) });
      }
      return { item, files };
    },
    // Pause between items so Gemini Notebook is not hammered
    afterEach: async (item, { failed }) => {
      if (tracker) (failed ? tracker.fail : tracker.done)('artifacts', item);
      if (item !== items[items.length - 1]) await new Promise(resolve => setTimeout(resolve, 800));
    },
    packageBatch: async (results, info) => {
      if (zipMode) {
        const files = results.flatMap(r => r.files);
        shell.progress(info.multi ? `Creating ZIP part ${info.batchIndex}...` : 'Creating ZIP...', 1);
        // Each part gets its own root files, listing that part's files only
        files.push(...artifactsRootFiles(files, results.map(r => r.item), {
          meta: shell.meta, info, part: info.batchIndex, totalParts: info.multi ? null : 1
        }));
        // Memory: the Blobs live only in this call; the runner drops `results`
        // once it returns, and `written` keeps names and counts only
        await saveCategoryBatch(shell, files, info, { prefix: batchPrefix(pathPrefix, info), zipKind, folder: null, written });
        if (tracker) tracker.commit(); // this part's items are on disk now
        return;
      }
      // Folder mode (one item per call): the item is already saved; the
      // last call adds the root files
      if (tracker) tracker.commit();
      if (info.isLast) {
        const all = saved.flatMap(r => r.files);
        await saveFiles(place(artifactsRootFiles(all, saved.map(r => r.item), { meta: shell.meta, info })), { folder });
        // The root files are a package too: an errors-only run (every item
        // failed) leaves errors.md and _index.md in the folder
        written.count++;
      }
    },
    isCancelled: shell.isCancelled,
    onProgress: ({ done, total, item }) => {
      shell.progress(`Downloading ${done + 1}/${total}: ${item.label}`, (done + 1) / total);
    }
  });

  return { result, zips: written.zips, errors: result.errors, auditOk: true, savedOutside, parts: written.parts, packages: written.count };
}

/**
 * The root files of an artifacts export: errors.md (when there are errors),
 * _index.md (by type folder) and manifest.json (last; lists every file).
 *
 * @param {object[]} files every artifact file in the export (type-folder paths)
 * @param {object[]} exportedItems the items those files came from
 * @param {{ meta: object, info: { errors: Array, partial: boolean, multi?: boolean, isLast?: boolean }, part?: number, totalParts?: number|null }} options
 *   part/totalParts: this ZIP's place in a size-split export (totalParts null: unknown)
 */
function artifactsRootFiles(files, exportedItems, { meta, info, part = 1, totalParts = 1 }) {
  const errors = info.errors || [];
  const root = [];

  if (errors.length > 0) {
    root.push({
      path: 'errors.md',
      data: NLME.buildErrorReport({ title: 'Artifacts Export', generatedAt: new Date().toLocaleString(), errors })
    });
  }

  // Items per type folder, in export order
  const folders = new Map();
  for (const item of exportedItems) {
    const typeFolder = NLME.artifactFolder(item.type);
    if (!folders.has(typeFolder)) folders.set(typeFolder, { type: item.type, labels: [] });
    folders.get(typeFolder).labels.push(item.label);
  }

  // In a split export errors.md exists only in the last part
  const errorsRef = info.multi && !info.isLast ? 'errors.md in the last part' : 'errors.md';

  let index = `# Artifacts — ${meta.notebook}\n\n`;
  index += `Generated: ${new Date().toLocaleString()}\n\n`;
  if (part > 1 || totalParts !== 1) index += `**Part ${part}**\n\n`;
  index += `Total Artifacts: ${exportedItems.length}\n\n`;
  index += '---\n\n';
  for (const [typeFolder, { type, labels }] of folders) {
    index += `## ${type} (${typeFolder}/)\n\n`;
    for (const label of new Set(labels)) {
      const own = files.filter(f => f.title === label && f.path.startsWith(`${typeFolder}/`));
      index += `### ${label}\n\n`;
      index += own.length
        ? own.map(f => `- [${f.path.slice(typeFolder.length + 1)}](${encodeURI(f.path)})`).join('\n') + '\n\n'
        : `- Saved separately to Downloads (see ${errorsRef})\n\n`;
    }
  }
  if (errors.length > 0) {
    index += '## Errors\n\n';
    index += '- [Export Errors](errors.md)\n\n';
  }
  root.push({ path: '_index.md', data: index + timingSummary() });
  root.push({
    path: '_index.html',
    data: NLME.buildIndexHtml({
      meta,
      heading: `Artifacts — ${meta.notebook}`,
      files: [...files, ...root],
      links: [
        { href: '_index.md', label: 'Markdown index' },
        ...(errors.length > 0 ? [{ href: 'errors.md', label: 'Errors' }] : [])
      ]
    })
  });

  const counts = {};
  for (const [typeFolder, { labels }] of folders) counts[typeFolder] = labels.length;
  root.push({
    path: 'manifest.json',
    data: JSON.stringify(NLME.buildManifest({
      meta,
      kind: 'artifacts',
      part,
      totalParts,
      partial: info.partial,
      files: [...files, ...root],
      counts,
      errorCount: errors.length
    }), null, 2)
  });
  return root;
}
