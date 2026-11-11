// NotebookLM Takeout - Sidebar: Sources tab (scan, list, source export jobs, source files)
// Classic script, loads after sidebar-notes.js. Shared helpers live in sidebar-core.js.

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
 * Scan markdown for notebook image URLs and replace with base64 data URIs. A
 * failed image stays a link and goes to `failures` as { item, url, reason }.
 * `embeds` maps each downloaded url to its data URI, for Markdown that is built
 * again later (NLME.applyImageEmbeds).
 */
async function embedImagesInMarkdown(markdown, sourceTitle) {
  // Match markdown image syntax: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\((https:\/\/lh3\.google(?:usercontent)?\.com\/[^\)]+)\)/g;

  const matches = [...markdown.matchAll(imageRegex)];

  if (matches.length === 0) {
    return { markdown, failures: [], embeds: new Map(), imagesFound: 0, imagesEmbedded: 0 };
  }

  console.log(`[NotebookLM Takeout] Found ${matches.length} images in "${sourceTitle}"`);

  const failures = [];
  const embeds = new Map();
  let updatedMarkdown = markdown;
  let successCount = 0;

  for (const match of matches) {
    const fullMatch = match[0];
    const altText = match[1];
    const imageUrl = match[2];

    try {
      console.log(`[NotebookLM Takeout] Downloading image: ${imageUrl.substring(0, 100)}...`);
      const dataUri = embeds.get(imageUrl) ?? await fetchJobImage(imageUrl, { patient: true });
      embeds.set(imageUrl, dataUri);

      // Replace the URL with the data URI
      const replacement = `![${altText}](${dataUri})`;
      updatedMarkdown = updatedMarkdown.replace(fullMatch, replacement);

      successCount++;
      console.log(`[NotebookLM Takeout] Successfully embedded image (${(dataUri.length / 1024).toFixed(1)} KB)`);
    } catch (error) {
      if (error.cancelled) break;
      console.error(`[NotebookLM Takeout] Failed to embed image:`, error);
      failures.push({ item: sourceTitle, url: imageUrl, reason: error.message, skipped: !!error.skipped });
    }
  }

  return {
    markdown: updatedMarkdown,
    failures,
    embeds,
    imagesFound: matches.length,
    imagesEmbedded: successCount
  };
}

/**
 * The embed pass for a note or chat message, whose files are built later: one
 * download per image, then one summary for the item. earlierFailures are
 * citation images the page could not get; those stay links in the Markdown, so
 * the pass tries them again and only a second failure counts.
 *
 * @param {string} markdown the item's Markdown, images as remote links
 * @param {string} item its name in errors.md
 * @param {Array<{url: string, reason: string}>} [earlierFailures]
 * @param {Function} warn receives each summary
 * @param {Function} [jobWarn] receives the job-wide summary of skipped images
 * @returns {Promise<Map<string, string>>} url -> data URI for NLME.applyImageEmbeds
 */
async function embedAndReportImages(markdown, item, earlierFailures, warn, jobWarn = warn, { deferTo = null } = {}) {
  const { embeds, failures } = await embedImagesInMarkdown(markdown, item);
  const stillFailed = (earlierFailures || []).filter(failure => !embeds.has(failure.url));
  reportImageFailures([...stillFailed, ...failures], item, warn, jobWarn, { deferTo });
  return embeds;
}

/**
 * What the last try before the package got for a source (retryMissingImages'
 * apply): its with-images versions are built again from the Markdown kept
 * before finishRemoteImages, and imagesEmbedded counts the new images.
 *
 * @param {object} source SourceData from buildSourceData
 * @param {Map<string, string>} got url -> data URI
 */
function applySourceImageTry(source, got) {
  const raw = source._imageMarkdown;
  delete source._imageMarkdown;
  if (!raw || got.size === 0) return;
  if (raw.withImages && source.versions.withImages !== null) {
    source.versions.withImages = NLME.embedImagesForVersion(raw.withImages, got);
  }
  if (raw.plusMetaWithImages && source.versions.plusMetaWithImages !== null) {
    source.versions.plusMetaWithImages = NLME.embedImagesForVersion(raw.plusMetaWithImages, got);
  }
  const images = [...(raw.withImages || '').matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
  source.imagesEmbedded += images.filter(match => got.has(match[1])).length;
}

/**
 * Scan the sources panel for all uploaded source documents
 */
async function scanSourcesPage() {
  console.log('[NotebookLM Takeout] Scanning sources page...');

  const seq = ++_sourcesScanSeq;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (seq !== _sourcesScanSeq) return;

  if (!isNotebookUrl(tab?.url)) {
    dropSourcesList();
    const resultsDiv = document.getElementById('sources-scan-results');
    if (resultsDiv) resultsDiv.innerHTML = NOTEBOOK_PROMPT_HTML;
    setTabCount('sources', null);
    showToast('Open a notebook first.', 'error');
    return;
  }

  try {
    const { sources, skippedNotes } = await scanSourcesData(tab.id);
    if (seq !== _sourcesScanSeq) return;

    console.log(`[NotebookLM Takeout] Found ${sources.length} sources`);

    renderSourcesList(sources, skippedNotes);
  } catch (error) {
    if (seq !== _sourcesScanSeq) return;
    const scanError = error instanceof ScanError;
    if (!scanError) console.error('[NotebookLM Takeout] Scan error:', error);
    const message = scanError ? `Scan failed: ${error.message}` : 'Failed to scan sources';
    showToast(message, 'error');
    // A list already drawn stays; otherwise "Scanning..." would stay for good
    if (!_sourcesListController) {
      const resultsDiv = document.getElementById('sources-scan-results');
      if (resultsDiv) resultsDiv.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
      setTabCount('sources', null);
    }
  }
}
// ========== SOURCES EXPORT FUNCTIONS ==========


/**
 * Sources from SCAN_SOURCES, no UI (Sources tab, Full Takeout).
 * @returns {Promise<{ sources: Array<{ index, title, ... }>, skippedNotes: number }>}
 * @throws {ScanError} when the page reports a scan error
 */
async function scanSourcesData(tabId) {
  await ensureContentScriptLoaded(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.SCAN_SOURCES });
  if (!response) throw new Error('No response from the page');
  if (response.error) throw new ScanError(response.error);
  // Each source's place among sources of its title (NLME.stampTitleOrdinals)
  // counted over the page's whole container list (titles), hidden rows included
  const sources = NLME.stampTitleOrdinals(response.sources || [], { titleOf: s => s.title, indexOf: s => s.index, titles: Array.isArray(response.titles) ? response.titles : null });
  return { sources, skippedNotes: response.skippedNotes || 0 };
}

// The Sources tab's list controller (sidebar-list.js); replaced on every redraw
let _sourcesListController = null;
// The newest scan: an older one still waiting on the page must not draw
let _sourcesScanSeq = 0;

// The list is gone, and with it the action its selection drove
function dropSourcesList() {
  if (_sourcesListController) {
    _sourcesListController.destroy();
    _sourcesListController = null;
  }
  idleTabAction('sources');
}

/**
 * Render the list of sources: filter toolbar, checkboxes (all selected at first)
 * and a download button per row
 */
function renderSourcesList(sources, skippedNotes = 0) {
  const resultsDiv = document.getElementById('sources-scan-results');

  if (_sourcesListController) {
    _sourcesListController.destroy();
    _sourcesListController = null;
  }

  setTabCount('sources', sources.length);

  // Notes shown in NotebookLM's Sources panel are exported from the Notes tab
  const notesHint = skippedNotes > 0
    ? `<p class="hint">${escapeHtml(String(skippedNotes))} note(s) in the Sources panel were skipped — export them from the Notes tab.</p>`
    : '';

  if (sources.length === 0) {
    resultsDiv.innerHTML = notesHint + '<p class="empty-message">No sources found. Add source materials to your notebook.</p>';
    idleTabAction('sources');
    return;
  }

  resultsDiv.innerHTML = notesHint + '<div class="sources-list"></div>';
  const listEl = resultsDiv.querySelector('.sources-list');

  const rowHtml = (source, idx) => {
    const typeIcon = source.type === 'markdown' ? 'doc' : 'note';
    return `
        <span class="source-icon">${icon(typeIcon)}</span>
        <span class="source-title">${escapeHtml(source.title)}</span>
        <button class="download-single-btn" data-index="${idx}" title="Download ${escapeHtml(source.title)}" aria-label="Download ${escapeHtml(source.title)}">
          ${icon('download')}
        </button>
      `;
  };

  _sourcesListController = createListController({
    tab: 'sources',
    container: listEl,
    items: sources,
    titleOf: source => source.title,
    typeOf: source => source.type,
    defaultSelected: 'all',
    rowHtml,
    onChange: controller => {
      const n = controller.selectedCount();
      setTabAction('sources', {
        label: NLME.actionLabel(n, 'source'),
        disabled: n === 0,
        onClick: exportSelectedSources
      });
    }
  });

  // Row download buttons (the list controller ignores clicks on buttons, so they never toggle the row)
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.download-single-btn');
    if (!btn) return;
    const source = sources[parseInt(btn.dataset.index, 10)];
    if (source) await runRowExport('Sources export', () => exportSources([source], { record: false }));
  });
}

// The Sources action: opens the sheet for the selection. Start exports what the list
// has selected then: a rescan may have redrawn it under the sheet.
function exportSelectedSources() {
  const n = _sourcesListController ? _sourcesListController.selectedCount() : 0;
  if (n === 0) {
    showToast('No sources selected', 'warning');
    return;
  }
  openExportSheet({
    title: NLME.actionLabel(n, 'source'),
    counts: { sources: n },
    start: ({ overrides }) => runExclusive('Sources export', () => withRunSettings(overrides, async () => {
      const selected = _sourcesListController ? _sourcesListController.selectedItems() : [];
      if (selected.length === 0) {
        showToast('Nothing is selected now, so nothing was exported', 'warning');
        return;
      }
      await exportSources(selected);
    }))
  });
}

// Sources export (Milestone 3a): the shared export shell around
// runSourcesJob. Each batch becomes one <Notebook>-sources-<ts>.zip from
// buildSourcesFiles.
// options.tabId: the tab the sources were scanned on (a retry); default the active tab.
// Returns withExportShell's outcome, like exportNotesAsMarkdown.
async function exportSources(selectedSources, { tabId, updateRecord = false, record = true } = {}) {
  startExportTiming();
  console.log(`[NotebookLM Takeout] Exporting ${selectedSources.length} sources...`);

  return withExportShell({ label: 'sources', healthType: 'sources', overlayMessage: 'Preparing to export sources...', tabId }, async shell => {
    const { result, zips, auditOk } = await withJobRecord(shell, 'sources', 'Sources', 'sources', selectedSources,
      tracker => runSourcesJob(shell, selectedSources, { tracker }), { update: updateRecord, record });

    return shell.finish({
      kind: 'sources',
      selected: selectedSources.length,
      result,
      auditOk,
      saved: zips,
      retry: retryFor(result.failedItems, 'Sources export', failed => exportSources(failed, { tabId: shell.tab.id, updateRecord: true })),
      retryImages: retryFor(result.imageFailedItems, 'Sources export', failed => exportSources(failed, { tabId: shell.tab.id, updateRecord: true }))
    });
  });
}

/**
 * Run the sources job (extract, batch, package) inside an export shell.
 *
 * @param {object} shell withExportShell's shell
 * @param {object[]} selectedSources sources as SCAN_SOURCES returns them
 * @param {CategoryTarget} [target]
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean, parts: number, packages: number }>}
 *   zips/parts/packages: what target.written holds (see newWritten)
 */
async function runSourcesJob(shell, selectedSources, { pathPrefix = '', zipKind = 'sources', folder = null, variantSettings = settings, itemDir = 'sources/', written = newWritten(), tracker = null, capture = null } = {}) {
  // File names already used by an earlier part of this job (see runNotesJob)
  const takenStems = new Set();
  const perZip = settings.sourcesPerZip;
  // Shared by every extractSourceItem call: audit counters and the
  // DOM-warning decision
  const state = {
    audit: newAudit(),
    failures: 0,
    domWarningShown: false,
    declined: false // user declined the DOM warning: stops like a Cancel
  };
  let packaged = 0; // sources written to ZIPs so far
  // Snapshot of the run-wide audit when the previous part was packaged, and
  // the items attempted by then: a part's audit is the difference
  let lastPartAudit = newAudit();
  let lastPartAttempted = 0;

  // Item counts go in last, once every written source is known
  const finalAudit = () => {
    state.audit.expected.items = selectedSources.length;
    state.audit.written.items = packaged;
    return state.audit;
  };

  console.log(`[NotebookLM Takeout] Will create ${Math.ceil(selectedSources.length / perZip)} ZIP(s) for ${selectedSources.length} sources (${perZip} per ZIP)`);

  beginImageSession(shell.tab.id, () => shell.isCancelled() || state.declined);
  const result = await NLME.runExportJob({
    kind: 'sources',
    items: selectedSources,
    perZip,
    extractOne: (source, ctx) => extractSourceItem(shell, source, ctx, state, variantSettings),
    // The last try at this batch's missing images
    beforePackage: (sources, { markImagesMissing }) => retryMissingImages(sources, {
      progress: text => shell.progress(text),
      isCancelled: () => shell.isCancelled() || state.declined,
      apply: applySourceImageTry,
      markMissing: markImagesMissing
    }),
    // Close the source viewer once per source, whether extraction worked or not
    afterEach: async (source, { failed }) => {
      if (tracker) (failed ? tracker.fail : tracker.done)('sources', source);
      try {
        const backResponse = await chrome.tabs.sendMessage(shell.tab.id, { type: NLME.MSG.NAVIGATE_BACK });
        console.log('[NotebookLM Takeout] NAVIGATE_BACK response:', backResponse);
        // NAVIGATE_BACK resolves once the viewer is closed (Milestone 1: no
        // extra fixed 1.5 s)
      } catch (backError) {
        console.error('[NotebookLM Takeout] Failed to close source panel:', backError);
      }
    },
    packageBatch: async (sources, info) => {
      packaged += sources.length;
      shell.progress(`Creating ZIP ${info.batchIndex}/${info.totalBatches}...`);
      // Every part gets an _audit.md for its own sources (what was added since
      // the previous part); the last part (an errors-only ZIP too: the outcome
      // toast may point at it) adds the run-wide totals as a second section.
      // An unsplit export keeps the single run-wide audit.
      const runAudit = finalAudit();
      const totalNow = info.exported + info.failed;
      const partAudit = NLME.partAudit(runAudit, lastPartAudit, { attempted: totalNow - lastPartAttempted, written: sources.length });
      lastPartAudit = JSON.parse(JSON.stringify(runAudit));
      lastPartAttempted = totalNow;
      const auditText = info.multi
        ? auditMarkdown(`Sources Export (part ${info.batchIndex} of ${info.totalBatches})`, partAudit, { runTotals: info.isLast ? runAudit : null }).text
        : auditMarkdown('Sources Export', runAudit).text;
      const files = buildSourcesFiles(sources, {
        meta: shell.meta,
        errors: info.errors,
        auditText,
        batchIndex: info.batchIndex,
        totalBatches: info.totalBatches,
        partial: info.partial,
        variantSettings,
        itemDir,
        takenStems,
        // errors.md summary, on the package that carries the errors (the last)
        stats: { Selected: selectedSources.length, Exported: info.exported, Failed: info.failed }
      });
      await saveCategoryBatch(shell, files, info, { prefix: batchPrefix(pathPrefix, info), zipKind, folder, written, capture });
      console.log(`[NotebookLM Takeout] Downloaded sources ZIP ${info.batchIndex}/${info.totalBatches}`);
      if (tracker) tracker.commit(); // these sources are on disk now

      // CRITICAL: free each batch's memory before the next one
      await new Promise(resolve => setTimeout(resolve, 500));
      sources.forEach(source => {
        source.versions = { base: null, plusMeta: null, withImages: null, plusMetaWithImages: null };
        source.summary = null;
      });
      imageSession?.endBatch();
      // Give GC time to work between batches
      if (!info.isLast) await new Promise(resolve => setTimeout(resolve, 1000));
    },
    isCancelled: () => shell.isCancelled() || state.declined,
    onProgress: ({ done, total, batchIndex, totalBatches, item }) => {
      const batchStart = (batchIndex - 1) * perZip;
      const batchSize = Math.min(perZip, total - batchStart);
      shell.progress(`Batch ${batchIndex}/${totalBatches}: Extracting ${done - batchStart + 1}/${batchSize}: ${item.title}`,
        { done, total, item: item.title });
      console.log(`[NotebookLM Takeout] Extracting source: "${item.title}"`);
    }
  }).finally(endImageSession);

  return { result, zips: written.zips, errors: result.errors, auditOk: NLME.auditExport(finalAudit()).ok, parts: written.parts, packages: written.count };
}

/**
 * Extract one source for the job runner: EXTRACT_SOURCE (retried on
 * transient failures), then every Markdown version the settings ask for.
 * Missing summary / key topics and image problems go to ctx.warn as
 * { source, type, message }; a failed source throws (the runner records
 * "[<title>] <message>"). NAVIGATE_BACK is the job's afterEach.
 *
 * @param {object} shell withExportShell's shell (tab)
 * @param {{index: number, title: string}} source
 * @param {{warn: Function}} ctx
 * @param {object} state shared across sources (see exportSources)
 * @param {object} [variantSettings] where the export* variant settings come from (default `settings`)
 * @returns {Promise<object>} SourceData: { title, youtubeUrl, summary,
 *   keyTopics, hasImages, imagesFound, imagesEmbedded,
 *   versions: { base, plusMeta, withImages, plusMetaWithImages } }
 *   (plusMeta null when no metadata version is enabled; image versions null
 *   when the source has no images or none are enabled)
 */
async function extractSourceItem(shell, source, ctx, state, variantSettings = settings) {
  // Wait for and write the AI summary/guide only when a metadata version is
  // exported (avoids false "missing summary" errors when those are off)
  const needsMeta = !!(variantSettings.exportSourcePlusMeta || variantSettings.exportSourcePlusMetaWithImages);
  let sourceData;
  try {
    sourceData = await retryOperation(
      () => chrome.tabs.sendMessage(shell.tab.id, {
        type: NLME.MSG.EXTRACT_SOURCE,
        data: { sourceIndex: source.index, title: source.title, needsGuide: needsMeta, ...NLME.titlePlace(source) }
      }),
      2, // maxRetries
      1500, // baseDelay (1.5s)
      `Extract source "${source.title}"`
    );
    mergeTiming(sourceData);

    if (sourceData && !sourceData.error) {
      const data = await buildSourceData(source, sourceData, ctx, state.audit, needsMeta, variantSettings);
      console.log(`[NotebookLM Takeout] Successfully extracted "${source.title}"`);
      return data;
    }
  } catch (error) {
    console.error(`[NotebookLM Takeout] Error extracting source "${source.title}":`, error);
    showToast(`Error: ${source.title}`, 'error');
    throw await itemFailed(shell, state, `Exception during extraction: ${error.message || error.toString()}`);
  }

  console.error(`[NotebookLM Takeout] Failed to extract "${source.title}":`, sourceData?.error);
  showToast(`Skipped: ${source.title}`, 'warning');
  throw await itemFailed(shell, state, `Failed to extract: ${sourceData?.error || 'no response'}`);
}

// The Markdown versions of one extracted source (see extractSourceItem)
async function buildSourceData(source, sourceData, ctx, audit, needsMeta, variantSettings = settings) {
  const hasSummary = !!(sourceData.guideMarkdown && sourceData.guideMarkdown.trim().length > 0);
  const hasKeyTopics = !!(sourceData.keyTopics && sourceData.keyTopics.length > 0);
  if (needsMeta && !hasSummary) {
    ctx.warn({ source: source.title, type: 'missing_summary', message: 'Source guide/summary not found or empty' });
    console.warn(`[NotebookLM Takeout] "${source.title}": Summary/guide is missing`);
  } else if (needsMeta && sourceData.guideStillChanging) {
    // Still being written when the wait ran out: saved as far as it got
    ctx.warn({ source: source.title, type: 'missing_summary', message: 'Source guide was still being written; summary and key topics may be incomplete' });
    console.warn(`[NotebookLM Takeout] "${source.title}": Summary/guide may be incomplete`);
  }
  if (needsMeta && !hasKeyTopics) {
    ctx.warn({ source: source.title, type: 'missing_key_topics', message: 'Key topics not found or empty' });
    console.warn(`[NotebookLM Takeout] "${source.title}": Key topics are missing`);
  }

  // Convert (and count formulas) once; every version shares the content. An
  // image source has no page HTML, only its image links (extractSourceContent)
  const imageUrls = sourceData.imageUrls || [];
  const content = imageUrls.length > 0
    ? NLME.imageSourceMarkdown(source.title, imageUrls)
    : convertCounted(audit, sourceData.html,
      () => convertToMarkdown(sourceData.html, sourceData.sources || [], '', false, false, null, false));

  // The page's type icon, or web / web_pdf and the original URL
  const typeFields = NLME.sourceTypeFields(source);
  const buildMarkdown = includeMeta => {
    let md = `# ${source.title}\n\n`;
    if (sourceData.youtubeUrl) md += `**YouTube Video:** ${sourceData.youtubeUrl}\n\n`;
    // A web source's original URL, the same kind of line (1.9.7)
    md += NLME.sourceWebLine(typeFields);
    if (includeMeta) {
      if (hasSummary) md += `## Summary\n\n${sourceData.guideMarkdown}\n\n`;
      if (hasKeyTopics) md += `## Key Topics\n\n${sourceData.keyTopics.map(topic => `- ${topic}`).join('\n')}\n\n`;
    }
    return md + `## Content\n\n${content}`;
  };

  const baseMarkdown = buildMarkdown(false);
  const plusMetaMarkdown = needsMeta ? buildMarkdown(true) : null;

  // Image versions: download and embed images only when one is enabled, and
  // keep them only when the source actually has images
  let withImages = null;
  let plusMetaWithImages = null;
  let imagesFound = 0;
  let imagesEmbedded = 0;
  const imageFailures = [];
  // Markdown before finishRemoteImages, kept for the last try when an image failed
  let rawWithImages = null;
  let rawPlusMetaWithImages = null;
  if (variantSettings.exportSourceWithImages || variantSettings.exportSourcePlusMetaWithImages) {
    try {
      const embedded = await embedImagesInMarkdown(baseMarkdown, source.title);
      imagesFound = embedded.imagesFound;
      imagesEmbedded = embedded.imagesEmbedded;
      imageFailures.push(...embedded.failures);

      if (imagesFound > 0) {
        rawWithImages = embedded.markdown;
        withImages = NLME.finishRemoteImages(embedded.markdown);
        if (plusMetaMarkdown) {
          const embeddedMeta = await embedImagesInMarkdown(plusMetaMarkdown, source.title);
          rawPlusMetaWithImages = embeddedMeta.markdown;
          plusMetaWithImages = NLME.finishRemoteImages(embeddedMeta.markdown);
          imageFailures.push(...embeddedMeta.failures);
        }
        console.log(`[NotebookLM Takeout] "${source.title}": ${imagesFound} images found, creating image versions`);
      } else {
        console.log(`[NotebookLM Takeout] "${source.title}": No images found, skipping image versions`);
      }
    } catch (error) {
      console.error(`[NotebookLM Takeout] Error embedding images for "${source.title}":`, error);
      ctx.warn({ source: source.title, type: 'image_embedding_error', message: `Failed to embed images: ${error.message}` });
    }
  } else {
    console.log(`[NotebookLM Takeout] Skipping image downloads for "${source.title}" (no image versions enabled)`);
    // The image is all this source has: the file would otherwise lose it silently
    if (imageUrls.length > 0) {
      ctx.warn({ source: source.title, type: 'image_source_not_saved', message: 'This source is an image: turn on a with-images version to save it' });
    }
  }

  const data = {
    title: source.title,
    youtubeUrl: sourceData.youtubeUrl || null,
    // The page's type icon ('document' is only the scan's default), or
    // web / web_pdf and the original URL for a web source
    ...typeFields,
    // Metadata for _index.md
    summary: sourceData.guideMarkdown || null,
    keyTopics: sourceData.keyTopics || [],
    hasImages: withImages !== null,
    imagesFound,
    imagesEmbedded,
    versions: {
      base: stripImagesFromMarkdown(baseMarkdown),
      plusMeta: plusMetaMarkdown ? stripImagesFromMarkdown(plusMetaMarkdown) : null,
      withImages,
      plusMetaWithImages
    }
  };
  // Failed images wait for the last try before the package (runSourcesJob)
  reportImageFailures(imageFailures, source.title, ctx.warn, ctx.warn, { deferTo: data });
  if (data._imageFailures) {
    Object.defineProperty(data, '_imageMarkdown', {
      value: { withImages: rawWithImages, plusMetaWithImages: rawPlusMetaWithImages },
      configurable: true, writable: true, enumerable: false
    });
  }
  return data;
}

// Front matter for a source file (field order fixed by the Milestone 3a
// layout; youtube_url, source_type and source_url are dropped when null)
function sourceFrontMatter(meta, { title, variant, youtubeUrl = null, sourceType = null, sourceUrl = null }) {
  return NLME.frontMatter({
    title,
    notebook: meta.notebook,
    notebook_url: meta.notebook_url,
    notebook_id: meta.notebook_id,
    exporter: meta.exporter,
    exported: meta.exported,
    kind: 'source',
    variant,
    youtube_url: youtubeUrl,
    source_type: sourceType,
    source_url: sourceUrl
  });
}

// Source versions by NLME.sourceVariants suffix: where SourceData keeps the
// Markdown, and how _index.md describes the files
const SOURCE_VERSION_INFO = {
  '': {
    key: 'base',
    label: 'Base version (no metadata, no images)',
    heading: 'Base files (e.g., `Document-1.md`)',
    points: [
      '**Minimal version** - no metadata, no images',
      'Smallest file size, fastest to process',
      'Perfect for AI processing (Claude, ChatGPT, etc.)',
      'Best for search indexing and text analysis'
    ]
  },
  '-plus-meta': {
    key: 'plusMeta',
    label: 'With metadata, no images',
    heading: 'Plus-meta files (e.g., `Document-1-plus-meta.md`)',
    points: [
      '**With metadata** - includes AI-generated summary & key topics',
      'No images (text only)',
      'Good for understanding source context',
      'Still optimized for AI processing'
    ]
  },
  '-with-images': {
    key: 'withImages',
    label: 'No metadata, with images',
    heading: 'With-images files (e.g., `Document-1-with-images.md`)',
    points: [
      '**With embedded images** - images as base64 data URIs',
      'No metadata (content only)',
      'Self-contained, works offline',
      'Larger file size due to embedded images',
      'Best for archival and complete backups',
      '**Note:** Only created for sources that contain images'
    ]
  },
  '-plus-meta-with-images': {
    key: 'plusMetaWithImages',
    label: 'With metadata and images',
    heading: 'Plus-meta-with-images files (e.g., `Document-1-plus-meta-with-images.md`)',
    points: [
      '**Complete version** - metadata + images',
      'Largest file size',
      'Best for comprehensive archival',
      'Self-contained with full context',
      '**Note:** Only created for sources that contain images'
    ]
  }
};

/**
 * Files for one sources ZIP: sources/ (every enabled version of each
 * source), sources/youtube-urls.txt and .raw.txt, errors.md, _audit.md,
 * _index.md (with the file-naming guide) and manifest.json (last).
 *
 * @param {object[]} sources SourceData from extractSourceItem (may be empty
 *   for an errors-only ZIP)
 * @param {{ meta: object, errors?: Array, auditText?: string|null,
 *   batchIndex?: number, totalBatches?: number, partial?: boolean,
 *   variantSettings?: object, itemDir?: string, stats?: object }} options
 *   errors: ALL errors of the run, passed only to the last ZIP it writes
 *   stats: errors.md's summary ({ Selected, Exported, Failed }), passed with the errors
 *   variantSettings: where sourceVariants reads the export* settings (default `settings`)
 *   takenStems: Set of names earlier parts of the job used (runSourcesJob)
 *   itemDir: folder of the source files and youtube-urls*.txt ('sources/';
 *   '' puts them next to errors.md and _index.md)
 * @returns {Array<{path: string, data: string, title?: string, variant?: string, itemKind?: string}>}
 */
function buildSourcesFiles(sources, { meta, errors = [], auditText = null, batchIndex = 1, totalBatches = 1, partial = false, variantSettings = settings, itemDir = 'sources/', stats = {}, takenStems = new Set() }) {
  const files = [];
  const indexEntries = [];

  // Every variant of one source shares one stem, and no stem may equal
  // another source's stem+variant name ('Report' vs 'Report plus meta')
  const zipSuffixes = NLME.sourceVariants(variantSettings, { hasImages: sources.some(s => s.hasImages) })
    .map(v => v.suffix).filter(Boolean);
  // Next to the package files (itemDir ''), no source may take the name of
  // errors.md or _audit.md
  const reserved = itemDir ? [] : ['errors', '_index', '_audit'];
  const stems = NLME.uniqueStems(sources.map(s => s.title), zipSuffixes, reserved, { obsidian: !!settings.obsidianNames, taken: takenStems });

  sources.forEach((source, idx) => {
    const written = [];
    // Versions for this source (NLME.sourceVariants); image versions exist
    // only when the source has images
    for (const { suffix } of NLME.sourceVariants(variantSettings, { hasImages: !!source.hasImages })) {
      const info = SOURCE_VERSION_INFO[suffix];
      const markdown = source.versions[info.key];
      if (markdown == null) continue;
      const variant = variantName(suffix);
      const filename = `${stems[idx]}${suffix}.md`;
      files.push({
        path: `${itemDir}${filename}`,
        data: sourceFrontMatter(meta, { title: source.title, variant, youtubeUrl: source.youtubeUrl, sourceType: source.sourceType, sourceUrl: source.sourceUrl }) + markdown,
        title: source.title,
        variant,
        itemKind: 'source'
      });
      written.push({ label: `${filename} - ${info.label}`, path: `${itemDir}${filename}` });
    }

    let details = '';
    if (source.youtubeUrl) details += `**YouTube Video:** ${source.youtubeUrl}\n\n`;
    details += NLME.sourceOriginalLine(source.sourceUrl);
    if (source.summary && source.summary.trim().length > 0) details += `**Summary:**\n\n${source.summary}\n\n`;
    if (source.keyTopics && source.keyTopics.length > 0) {
      details += `**Key Topics:**\n\n${source.keyTopics.map(topic => `- ${topic}`).join('\n')}\n`;
    }
    indexEntries.push({ title: source.title, details, files: written });
  });

  // YouTube URLs of the sources in THIS ZIP: numbered with titles, and raw
  const youtubeUrls = sources
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
    files.push({ path: `${itemDir}youtube-urls.txt`, data: youtubeContent, title: 'YouTube Source URLs (formatted)', itemKind: 'source-urls' });
    files.push({
      path: `${itemDir}youtube-urls.raw.txt`,
      data: youtubeUrls.map(item => item.url).join('\n') + '\n',
      title: 'YouTube Source URLs (raw list)',
      itemKind: 'source-urls'
    });
  }

  // errors.md when the caller passes errors (it passes ALL errors to the
  // last ZIP the run writes: the final batch, or the one it ended in)
  if (errors.length > 0) {
    files.push({
      path: 'errors.md',
      data: NLME.buildErrorReport({
        title: 'Sources Export',
        generatedAt: new Date().toLocaleString(),
        errors,
        stats
      })
    });
  }

  if (auditText) {
    files.push({ path: '_audit.md', data: auditText });
  }

  // _index.md: sources with their files, then the file-naming guide
  // (versions actually written: image versions only exist for sources with
  // images, so settings alone overcount)
  const variantsWritten = NLME.distinctVariants(files.filter(f => f.itemKind === 'source'));
  let indexContent = NLME.categoryIndexFrontMatter(meta, { title: `Sources — ${meta.notebook}`, category: 'sources', part: totalBatches > 1 ? batchIndex : undefined }) +
    `# Sources — ${meta.notebook}\n\n`;
  indexContent += `Generated: ${new Date().toLocaleString()}\n\n`;
  if (totalBatches > 1) {
    indexContent += `**Part ${batchIndex} of ${totalBatches}**\n\n`;
  }
  indexContent += `Total Sources: ${sources.length}\n\n`;
  if (sources.length > 0) {
    indexContent += `Each source is available in ${variantsWritten.length} version(s).\n\n`;
  }
  indexContent += '---\n\n';

  if (youtubeUrls.length > 0) {
    indexContent += '## YouTube Sources\n\n';
    indexContent += `This export includes ${youtubeUrls.length} YouTube video source(s).\n\n`;
    indexContent += `- [YouTube URLs (formatted)](${encodeURI(itemDir)}youtube-urls.txt) - Numbered list with titles\n`;
    indexContent += `- [YouTube URLs (raw)](${encodeURI(itemDir)}youtube-urls.raw.txt) - Plain URLs only (for scripting)\n\n`;
    indexContent += '---\n\n';
  }

  if (sources.length > 0) {
    indexContent += '## Sources\n\n';
    indexContent += NLME.buildSourcesIndex(indexEntries);
    indexContent += '\n---\n\n';

    indexContent += '## File Naming Convention\n\n';
    indexContent += `Each source is exported in ${variantsWritten.length} version(s), ${itemDir ? 'all in the `' + itemDir + '` folder' : 'all in this folder'}:\n\n`;
    let sectionNum = 1;
    for (const [suffix, info] of Object.entries(SOURCE_VERSION_INFO)) {
      if (!variantsWritten.includes(variantName(suffix))) continue;
      indexContent += `### ${sectionNum}. ${info.heading}\n\n`;
      indexContent += info.points.map(point => `- ${point}`).join('\n') + '\n\n';
      if (suffix === '-with-images') {
        const found = sources.reduce((n, s) => n + (s.imagesFound || 0), 0);
        const embedded = sources.reduce((n, s) => n + (s.imagesEmbedded || 0), 0);
        indexContent += `**Image Statistics:** ${found} image(s) found in these sources, ${embedded} successfully embedded as base64.\n\n`;
      }
      sectionNum++;
    }

    indexContent += '### File Contents\n\n';
    indexContent += 'Base and with-images files include:\n';
    indexContent += '- **Content** - Full document content with citations\n\n';
    indexContent += 'Plus-meta files additionally include:\n';
    indexContent += '- **Summary** - AI-generated source guide (if available)\n';
    indexContent += '- **Key Topics** - Important themes (if available)\n\n';

    indexContent += '### Choosing the Right Version\n\n';
    indexContent += '- **For AI/LLM processing**: Use base files (smallest, fastest)\n';
    indexContent += '- **For human review with context**: Use plus-meta files\n';
    indexContent += '- **For offline viewing with images**: Use with-images files\n';
    indexContent += '- **For complete archival**: Use plus-meta-with-images files\n\n';
  }

  if (errors.length > 0) {
    indexContent += '## Errors\n\n';
    indexContent += '- [Export Errors](errors.md)\n\n';
  }

  files.push({ path: '_index.md', data: indexContent + timingSummary() });
  files.push({
    path: '_index.html',
    data: NLME.buildIndexHtml({
      meta,
      heading: `Sources — ${meta.notebook}`,
      files,
      links: [
        { href: '_index.md', label: 'Markdown index' },
        ...(errors.length > 0 ? [{ href: 'errors.md', label: 'Errors' }] : []),
        ...(auditText ? [{ href: '_audit.md', label: 'Audit' }] : [])
      ]
    })
  });

  // manifest.json last: it lists every file above (not itself)
  files.push({
    path: 'manifest.json',
    data: JSON.stringify(NLME.buildManifest({
      meta,
      kind: 'sources',
      part: batchIndex,
      totalParts: totalBatches,
      partial,
      files,
      counts: { sources: sources.length, youtube: youtubeUrls.length },
      errorCount: errors.length
    }), null, 2)
  });

  return files;
}
// ========== END SOURCES EXPORT FUNCTIONS ==========
