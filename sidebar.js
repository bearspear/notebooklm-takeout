let lastChatScanTiming = null;

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
 * Scan markdown for Googleusercontent image URLs and replace with base64 data URIs
 */
async function embedImagesInMarkdown(markdown, sourceTitle) {
  // Match markdown image syntax: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\((https:\/\/lh3\.googleusercontent\.com\/[^\)]+)\)/g;

  const matches = [...markdown.matchAll(imageRegex)];

  if (matches.length === 0) {
    return { markdown, errors: [], imagesFound: 0, imagesEmbedded: 0 };
  }

  console.log(`[NotebookLM Takeout] Found ${matches.length} images in "${sourceTitle}"`);

  const errors = [];
  let updatedMarkdown = markdown;
  let successCount = 0;

  for (const match of matches) {
    const fullMatch = match[0];
    const altText = match[1];
    const imageUrl = match[2];

    try {
      console.log(`[NotebookLM Takeout] Downloading image: ${imageUrl.substring(0, 100)}...`);
      const dataUri = await downloadImageAsBase64(imageUrl);

      // Replace the URL with the data URI
      const replacement = `![${altText}](${dataUri})`;
      updatedMarkdown = updatedMarkdown.replace(fullMatch, replacement);

      successCount++;
      console.log(`[NotebookLM Takeout] Successfully embedded image (${(dataUri.length / 1024).toFixed(1)} KB)`);
    } catch (error) {
      console.error(`[NotebookLM Takeout] Failed to embed image:`, error);
      errors.push({
        source: sourceTitle,
        type: 'image_download_failed',
        message: `Failed to download image: ${error.message}`,
        url: imageUrl.substring(0, 100) + '...'
      });
    }
  }

  return {
    markdown: updatedMarkdown,
    errors,
    imagesFound: matches.length,
    imagesEmbedded: successCount
  };
}

/**
 * Scan the sources panel for all uploaded source documents
 */
async function scanSourcesPage() {
  console.log('[NotebookLM Takeout] Scanning sources page...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!isNotebookUrl(tab?.url)) {
    showToast('Please open NotebookLM first', 'error');
    return;
  }

  try {
    const { sources, skippedNotes } = await scanSourcesData(tab.id);

    console.log(`[NotebookLM Takeout] Found ${sources.length} sources`);

    renderSourcesList(sources, skippedNotes);
  } catch (error) {
    if (error instanceof ScanError) {
      showToast(`Scan failed: ${error.message}`, 'error');
      return;
    }
    console.error('[NotebookLM Takeout] Scan error:', error);
    showToast('Failed to scan sources', 'error');
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
  const response = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_SOURCES' });
  if (!response) throw new Error('No response from the page');
  if (response.error) throw new ScanError(response.error);
  return { sources: response.sources || [], skippedNotes: response.skippedNotes || 0 };
}

// The Sources tab's list controller (sidebar-list.js); replaced on every redraw
let _sourcesListController = null;

/**
 * Render the list of sources: filter toolbar, checkboxes (all selected at first)
 * and a download button per row
 */
function renderSourcesList(sources, skippedNotes = 0) {
  const resultsDiv = document.getElementById('sources-scan-results');
  const countBadge = document.getElementById('sources-count');
  const exportBtn = document.getElementById('export-sources-btn');

  if (_sourcesListController) {
    _sourcesListController.destroy();
    _sourcesListController = null;
  }

  countBadge.textContent = sources.length;

  // Notes shown in NotebookLM's Sources panel are exported from the Notes tab
  const notesHint = skippedNotes > 0
    ? `<p class="hint">${escapeHtml(String(skippedNotes))} note(s) in the Sources panel were skipped — export them from the Notes tab.</p>`
    : '';

  if (sources.length === 0) {
    resultsDiv.innerHTML = notesHint + '<p class="empty-message">No sources found. Add source materials to your notebook.</p>';
    exportBtn.style.display = 'none';
    return;
  }

  resultsDiv.innerHTML = notesHint + '<div class="sources-list"></div>';
  const listEl = resultsDiv.querySelector('.sources-list');

  const rowHtml = (source, idx) => {
    const icon = source.type === 'markdown' ? '📄' : '📎';
    return `
        <span class="source-icon">${icon}</span>
        <span class="source-title">${escapeHtml(source.title)}</span>
        <button class="download-single-btn" data-index="${idx}" title="Download ${escapeHtml(source.title)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </button>
      `;
  };

  // Show export button
  exportBtn.style.display = 'block';

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
      setButtonLabel(exportBtn, n > 0 ? `Export Selected Sources (${n})` : 'Export Selected Sources');
    }
  });

  // Row download buttons (the list controller ignores clicks on buttons, so they never toggle the row)
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.download-single-btn');
    if (!btn) return;
    const source = sources[parseInt(btn.dataset.index, 10)];
    if (source) await runExclusive('Sources export', () => exportSources([source], { record: false }));
  });

  // The button is static markup: bind once, read the current controller on click
  if (!exportBtn.dataset.bound) {
    exportBtn.dataset.bound = '1';
    exportBtn.addEventListener('click', async () => {
      const selected = _sourcesListController ? _sourcesListController.selectedItems() : [];

      if (selected.length === 0) {
        showToast('No sources selected', 'warning');
        return;
      }

      await runExclusive('Sources export', () => exportSources(selected));
    });
  }
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
      retry: retryFor(result.failedItems, 'Sources export', failed => exportSources(failed, { tabId: shell.tab.id, updateRecord: true }))
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
async function runSourcesJob(shell, selectedSources, { pathPrefix = '', zipKind = 'sources', folder = null, variantSettings = settings, itemDir = 'sources/', written = newWritten(), tracker = null } = {}) {
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

  // Item counts go in last, once every written source is known
  const finalAudit = () => {
    state.audit.expected.items = selectedSources.length;
    state.audit.written.items = packaged;
    return state.audit;
  };

  console.log(`[NotebookLM Takeout] Will create ${Math.ceil(selectedSources.length / perZip)} ZIP(s) for ${selectedSources.length} sources (${perZip} per ZIP)`);

  const result = await NLME.runExportJob({
    kind: 'sources',
    items: selectedSources,
    perZip,
    extractOne: (source, ctx) => extractSourceItem(shell, source, ctx, state, variantSettings),
    // Close the source viewer once per source, whether extraction worked or not
    afterEach: async (source, { failed }) => {
      if (tracker) (failed ? tracker.fail : tracker.done)('sources', source);
      try {
        const backResponse = await chrome.tabs.sendMessage(shell.tab.id, { type: 'NAVIGATE_BACK' });
        console.log('[NotebookLM Takeout] NAVIGATE_BACK response:', backResponse);
        // NAVIGATE_BACK resolves once the viewer is closed (Milestone 1: no
        // extra fixed 1.5 s)
      } catch (backError) {
        console.error('[NotebookLM Takeout] Failed to close source panel:', backError);
      }
    },
    packageBatch: async (sources, info) => {
      packaged += sources.length;
      shell.progress(`Creating ZIP ${info.batchIndex}/${info.totalBatches}...`, 1);
      // _audit.md goes into the last ZIP the run writes (an errors-only ZIP
      // too, so a run where every source failed still explains its toast)
      const auditText = info.isLast ? auditMarkdown('Sources Export', finalAudit()).text : null;
      const files = buildSourcesFiles(sources, {
        meta: shell.meta,
        errors: info.errors,
        auditText,
        batchIndex: info.batchIndex,
        totalBatches: info.totalBatches,
        partial: info.partial,
        variantSettings,
        itemDir,
        // errors.md summary, on the package that carries the errors (the last)
        stats: { Selected: selectedSources.length, Exported: info.exported, Failed: info.failed }
      });
      await saveCategoryBatch(shell, files, info, { prefix: batchPrefix(pathPrefix, info), zipKind, folder, written });
      console.log(`[NotebookLM Takeout] Downloaded sources ZIP ${info.batchIndex}/${info.totalBatches}`);
      if (tracker) tracker.commit(); // these sources are on disk now

      // CRITICAL: free each batch's memory before the next one
      await new Promise(resolve => setTimeout(resolve, 500));
      sources.forEach(source => {
        source.versions = { base: null, plusMeta: null, withImages: null, plusMetaWithImages: null };
        source.summary = null;
      });
      // Give GC time to work between batches
      if (!info.isLast) await new Promise(resolve => setTimeout(resolve, 1000));
    },
    isCancelled: () => shell.isCancelled() || state.declined,
    onProgress: ({ done, total, batchIndex, totalBatches, item }) => {
      const batchStart = (batchIndex - 1) * perZip;
      const batchSize = Math.min(perZip, total - batchStart);
      shell.progress(`Batch ${batchIndex}/${totalBatches}: Extracting ${done - batchStart + 1}/${batchSize}: ${item.title}`,
        (done + 1) / total);
      console.log(`[NotebookLM Takeout] Extracting source: "${item.title}"`);
    }
  });

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
        type: 'EXTRACT_SOURCE',
        data: { sourceIndex: source.index, title: source.title, needsGuide: needsMeta }
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
  }
  if (needsMeta && !hasKeyTopics) {
    ctx.warn({ source: source.title, type: 'missing_key_topics', message: 'Key topics not found or empty' });
    console.warn(`[NotebookLM Takeout] "${source.title}": Key topics are missing`);
  }

  // Convert (and count formulas) once; every version shares the content
  const content = convertCounted(audit, sourceData.html,
    () => convertToMarkdown(sourceData.html, sourceData.sources || [], '', false, false, null, false));

  const buildMarkdown = includeMeta => {
    let md = `# ${source.title}\n\n`;
    if (sourceData.youtubeUrl) md += `**YouTube Video:** ${sourceData.youtubeUrl}\n\n`;
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
  if (variantSettings.exportSourceWithImages || variantSettings.exportSourcePlusMetaWithImages) {
    try {
      const embedded = await embedImagesInMarkdown(baseMarkdown, source.title);
      imagesFound = embedded.imagesFound;
      imagesEmbedded = embedded.imagesEmbedded;
      embedded.errors.forEach(err => ctx.warn(err));

      if (imagesFound > 0) {
        withImages = embedded.markdown;
        if (plusMetaMarkdown) {
          plusMetaWithImages = (await embedImagesInMarkdown(plusMetaMarkdown, source.title)).markdown;
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
  }

  return {
    title: source.title,
    youtubeUrl: sourceData.youtubeUrl || null,
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
}

// Front matter for a source file (field order fixed by the Milestone 3a
// layout; youtube_url is dropped when null)
function sourceFrontMatter(meta, { title, variant, youtubeUrl = null }) {
  return NLME.frontMatter({
    title,
    notebook: meta.notebook,
    notebook_url: meta.notebook_url,
    notebook_id: meta.notebook_id,
    exporter: meta.exporter,
    exported: meta.exported,
    kind: 'source',
    variant,
    youtube_url: youtubeUrl
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
 *   itemDir: folder of the source files and youtube-urls*.txt ('sources/';
 *   '' puts them next to errors.md and _index.md)
 * @returns {Array<{path: string, data: string, title?: string, variant?: string, itemKind?: string}>}
 */
function buildSourcesFiles(sources, { meta, errors = [], auditText = null, batchIndex = 1, totalBatches = 1, partial = false, variantSettings = settings, itemDir = 'sources/', stats = {} }) {
  const files = [];
  const indexEntries = [];

  // Every variant of one source shares one stem, and no stem may equal
  // another source's stem+variant name ('Report' vs 'Report plus meta')
  const zipSuffixes = NLME.sourceVariants(variantSettings, { hasImages: sources.some(s => s.hasImages) })
    .map(v => v.suffix).filter(Boolean);
  // Next to the package files (itemDir ''), no source may take the name of
  // errors.md or _audit.md
  const reserved = itemDir ? [] : ['errors', '_index', '_audit'];
  const stems = NLME.uniqueStems(sources.map(s => s.title), zipSuffixes, reserved);

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
        data: sourceFrontMatter(meta, { title: source.title, variant, youtubeUrl: source.youtubeUrl }) + markdown,
        title: source.title,
        variant,
        itemKind: 'source'
      });
      written.push({ label: `${filename} - ${info.label}`, path: `${itemDir}${filename}` });
    }

    let details = '';
    if (source.youtubeUrl) details += `**YouTube Video:** ${source.youtubeUrl}\n\n`;
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
  let indexContent = `# Sources — ${meta.notebook}\n\n`;
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

/**
 * Chat from SCAN_CHAT (the page scrolls the whole history in), no UI (Chat
 * tab, Full Takeout). Records the scan time for the export's timing summary.
 * @returns {Promise<{ notebookTitle, notebookSummary, messagePairs: Array, stats?, dateRange? }>}
 * @throws {ScanError} when the page reports a scan error
 */
async function scanChatData(tabId) {
  await ensureContentScriptLoaded(tabId);
  const scanStartedAt = performance.now();
  const response = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_CHAT' });
  lastChatScanTiming = { 'chat.scan': { count: 1, ms: Math.round(performance.now() - scanStartedAt) } };
  if (!response) throw new Error('No response from the page');
  if (response.error) throw new ScanError(response.error);
  return response.chatData;
}
// ========== END SOURCES EXPORT FUNCTIONS ==========

// ========== CHAT EXPORT FUNCTIONS ==========


/**
 * Scan chat panel and initiate auto-scroll
 */
async function scanChatPage() {
  console.log('[NotebookLM Takeout] Scanning chat page...');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!isNotebookUrl(tab?.url)) {
    showToast('Please open NotebookLM first', 'error');
    return;
  }

  // Update UI to show scanning state
  const chatResults = document.getElementById('chat-scan-results');
  const chatCount = document.getElementById('chat-count');
  chatResults.innerHTML = '<p class="scanning">Scanning chat and loading messages...</p>';
  chatCount.textContent = '0';

  // Ensure content script is loaded
  await ensureContentScriptLoaded(tab.id);

  try {
    // Show overlay on page
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_EXPORT_OVERLAY',
      message: 'Scanning chat history...'
    });

    // Trigger auto-scroll and scan
    let chatData;
    try {
      chatData = await scanChatData(tab.id);
    } catch (error) {
      if (!(error instanceof ScanError)) throw error;
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
      showToast(`Scan failed: ${error.message}`, 'error');
      chatResults.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
      return;
    }

    // Hide overlay
    await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });

    console.log(`[NotebookLM Takeout] Found ${chatData.messagePairs.length} message pairs`);

    // Store chat data globally
    window._currentChatData = chatData;

    renderChatSummary(chatData);

  } catch (error) {
    console.error('[NotebookLM Takeout] Scan error:', error);
    showToast('Failed to scan chat', 'error');
    chatResults.innerHTML = '<p class="error-message">Scan failed. Please try again.</p>';

    // Hide overlay on error
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_EXPORT_OVERLAY' });
    } catch (e) {}
  }
}

/**
 * Render chat scan results summary
 */
function renderChatSummary(chatData) {
  updateChatCitationInfo();
  const chatResults = document.getElementById('chat-scan-results');
  const chatCount = document.getElementById('chat-count');
  const exportBtn = document.getElementById('export-chat-btn');

  if (chatData.messagePairs.length === 0) {
    chatResults.innerHTML = '<p class="empty-message">No chat messages found. Start a conversation with NotebookLM.</p>';
    chatCount.textContent = '0';
    exportBtn.style.display = 'none';
    return;
  }

  chatCount.textContent = chatData.messagePairs.length;

  // Build summary HTML
  let html = '<div class="chat-summary">';
  const chatStatsInfo = chatData.stats || {};
  const pairsInDom = chatStatsInfo.pairsInDom ?? chatData.messagePairs.length;
  html += `<div class="summary-stat"><strong>${chatData.messagePairs.length} of ${pairsInDom}</strong> messages</div>`;
  if (chatData.messagePairs.length < pairsInDom || chatStatsInfo.collapsedRemaining > 0) {
    html += `<div class="summary-stat warning">${pairsInDom - chatData.messagePairs.length} message(s) could not be read; ${chatStatsInfo.collapsedRemaining || 0} citation group(s) still collapsed. They are listed in errors.md after export.</div>`;
  }
  html += `<div class="summary-stat"><strong>${chatData.notebookTitle}</strong></div>`;

  if (chatData.dateRange) {
    html += `<div class="summary-stat">From <strong>${chatData.dateRange.first}</strong> to <strong>${chatData.dateRange.last}</strong></div>`;
  }

  html += '</div>';

  // Show preview of first few messages
  html += '<div class="chat-preview">';
  html += '<h4>Preview:</h4>';

  const previewCount = Math.min(3, chatData.messagePairs.length);
  for (let i = 0; i < previewCount; i++) {
    const pair = chatData.messagePairs[i];
    html += `<div class="message-preview">`;
    html += `<strong>Q:</strong> ${escapeHtml(pair.userMessage.substring(0, 80))}${pair.userMessage.length > 80 ? '...' : ''}`;
    html += `</div>`;
  }

  if (chatData.messagePairs.length > previewCount) {
    html += `<p class="preview-more">...and ${chatData.messagePairs.length - previewCount} more</p>`;
  }

  html += '</div>';

  chatResults.innerHTML = html;
  exportBtn.style.display = 'block';

  // Setup export button handler
  const newExportBtn = exportBtn.cloneNode(true);
  exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);

  newExportBtn.addEventListener('click', async () => {
    await runExclusive('Chat export', () => exportChat(chatData));
  });
}

// Chat export (Milestone 3a): the shared export shell around runChatJob.
// One package: a single Markdown file, or a ZIP from buildChatFiles.
// Citations follow the Citation detail setting (NLME.chatCitationMode).
async function exportChat(chatData) {
  startExportTiming();
  exportTimer.merge(lastChatScanTiming);
  console.log('[NotebookLM Takeout] Starting chat export...');

  await withExportShell({ label: 'chat', preflight: 'chat', overlayMessage: 'Preparing to export chat...' }, async shell => {
    const { result, zips, auditOk } = await runChatJob(shell, chatData, { citationMode: NLME.chatCitationMode(settings) });

    shell.finish({
      kind: 'messages',
      selected: chatData.messagePairs.length,
      result,
      auditOk,
      // Citation problems leave every message exported, so name the errors
      errorNote: result.errors.length > 0 ? `${result.errors.length} citation error(s), see errors.md` : undefined,
      saved: zips
      // No retry: a chat's messages never fail as a whole (citation problems
      // keep the message); re-export the chat instead
    });
  });
}

/**
 * Run the chat job (citations per message, one package) inside an export
 * shell. Scan problems (unread messages, collapsed citation groups) lead the
 * error list.
 *
 * @param {object} shell withExportShell's shell
 * @param {object} chatData SCAN_CHAT's chatData (messagePairs, stats, ...)
 * @param {CategoryTarget & { citationMode?: 'quotes'|'titles'|'none', forceZip?: boolean }} [options]
 *   citationMode: Citation detail. 'quotes' hovers each citation for its
 *   quote; 'titles' keeps the [n] markers and source titles without hovering;
 *   'none' drops the markers and the Sources section (no hovering either).
 *   forceZip: always the full file set (Full Takeout), never one loose .md
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean, parts: number, packages: number }>}
 *   zips/parts/packages: what target.written holds (see newWritten)
 */
async function runChatJob(shell, chatData, { citationMode = 'quotes', forceZip = false, pathPrefix = '', zipKind = 'chat', folder = null, variantSettings = settings, written = newWritten() } = {}) {
  const messagePairs = chatData.messagePairs;
  // Scan completeness (Milestone 2, Resilience #2): known before the job
  // starts, so they lead errors.md
  const seedErrors = (chatData.stats?.skipped || [])
    .map(skippedMessage => ({ type: 'message_skipped', message: skippedMessage }));
  // 'none' drops citations on purpose: nothing is missing there
  if (citationMode !== 'none' && chatData.stats?.collapsedRemaining > 0) {
    seedErrors.push({ type: 'collapsed_citations', message: `${chatData.stats.collapsedRemaining} citation group(s) were still collapsed after the scan; their citations are missing` });
  }
  let auditDoc = null;

  console.log('[NotebookLM Takeout] Processing messages and extracting citations...');
  const result = await NLME.runExportJob({
    kind: 'messages',
    items: messagePairs,
    perZip: Infinity,
    seedErrors,
    extractOne: (pair, ctx) => extractChatPair(shell, pair, ctx, { citationMode, total: messagePairs.length, variantSettings }),
    packageBatch: async (messages, info) => {
      console.log(`[NotebookLM Takeout] Processing complete: ${messages.length} messages`);
      shell.progress('Creating export...', 1);
      auditDoc = buildChatAuditDoc(chatData, messages, citationMode);
      const { files, single } = buildChatFiles(messages, {
        meta: shell.meta,
        chatData,
        errors: info.errors,
        auditDoc,
        partial: info.partial,
        forceZip,
        citationMode,
        variantSettings
      });
      if (single) {
        // Today's download name for the single file
        await saveFiles([{ ...single, path: `${sanitizeFilename(shell.projectName)}-chat-${shell.timestamp}.md` }]);
      } else {
        // One package: totalBatches is 1, so no -partNofM
        await saveCategoryBatch(shell, files, info, { prefix: pathPrefix, zipKind, folder, written });
      }
    },
    isCancelled: shell.isCancelled,
    onProgress: ({ done, total }) => {
      shell.progress(`Processing message ${done + 1}/${total}`, (done + 1) / total);
      console.log(`[NotebookLM Takeout] Message ${done + 1}: Processing...`);
    }
  });

  return { result, zips: written.zips, errors: result.errors, auditOk: auditDoc ? auditDoc.ok : true, parts: written.parts, packages: written.count };
}

/**
 * Extract one message pair for the job runner: the citation markers in the
 * answer, and ('quotes' mode) each source's quote via
 * EXTRACT_MESSAGE_CITATIONS. 'none' mode reads no citations at all. Never throws: citation and processing errors go
 * to ctx.warn as { message, messageIndex, userQuestion, type[, stack] } and
 * the message is kept (without citations when processing failed).
 *
 * @param {object} shell withExportShell's shell (tab, progress)
 * @param {{userMessage: string, aiResponseHTML: string, date?: string, domIndex?: number}} pair
 * @param {{index: number, warn: Function}} ctx
 * @param {{ citationMode?: 'quotes'|'titles'|'none', total: number, variantSettings?: object }} options
 *   total: message pairs in the job (progress text)
 *   variantSettings: where the export* variant settings come from (default `settings`)
 * @returns {Promise<object>} ProcessedMessage: { date, userMessage,
 *   aiResponseHTML, sources: [{ sourceIndex, text, quote }], fullCitations,
 *   stats: { hasCitations, citationsFound, successfulExtractions, failedExtractions }, fromCache }
 */
async function extractChatPair(shell, pair, ctx, { citationMode = 'quotes', total, variantSettings = settings }) {
  const n = ctx.index + 1;
  const stats = { hasCitations: false, citationsFound: 0, successfulExtractions: 0, failedExtractions: 0 };
  let fromCache = false; // citation quotes reused from the cache (Milestone 3c)
  const message = sources => ({
    date: pair.date,
    userMessage: pair.userMessage,
    aiResponseHTML: pair.aiResponseHTML,
    sources,
    fullCitations: citationMode === 'quotes',
    stats,
    fromCache
  });
  const warn = (type, msg, extra = {}) => ctx.warn({
    message: msg,
    messageIndex: n,
    userQuestion: (pair.userMessage || '').substring(0, 100),
    type,
    ...extra
  });

  // 'none': the Markdown drops the markers and has no Sources section, so
  // there is nothing to read or hover
  if (citationMode === 'none') return message([]);

  try {
    // Extract citation buttons from HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = pair.aiResponseHTML;
    const citationButtons = tempDiv.querySelectorAll('button.citation-marker');

    console.log(`[NotebookLM Takeout] Message ${n}: Found ${citationButtons.length} citation buttons`);

    // Build sources map for this message
    const messageSources = new Map(); // sourceIndex -> {text, quote}

    if (citationButtons.length > 0) {
      stats.hasCitations = true;
      // Count numbered citations only, not the expand/collapse group buttons
      stats.citationsFound = Array.from(citationButtons)
        .filter(b => NLME.parseCitationIndex(b.querySelector('span')?.textContent)).length;
      citationButtons.forEach((button) => {
        const span = button.querySelector('span');
        const sourceIndex = span?.textContent?.trim();
        const ariaLabel = span?.getAttribute('aria-label');

        // Skip invalid source indices
        if (!sourceIndex ||
            sourceIndex === '...' ||
            messageSources.has(sourceIndex) ||
            sourceIndex.includes('<') ||
            sourceIndex.includes('>') ||
            !/^[0-9]+$/.test(sourceIndex)) {
          if (sourceIndex && sourceIndex !== '...') {
            console.warn(`[NotebookLM Takeout] Message ${n}: Skipping invalid sourceIndex "${sourceIndex}"`);
          }
          return;
        }

        // Parse aria-label to extract source title
        let sourceTitle = `Source ${sourceIndex}`;
        if (ariaLabel && ariaLabel.includes(':')) {
          const parts = ariaLabel.split(':');
          if (parts.length >= 2) {
            sourceTitle = parts.slice(1).join(':').trim();
          }
        }

        messageSources.set(sourceIndex, {
          text: sourceTitle,
          quote: ''
        });

        console.log(`[NotebookLM Takeout] Message ${n}, source ${sourceIndex}: "${sourceTitle}"`);
      });
    }

    // Extract full citation details ('quotes' mode)
    if (citationMode === 'quotes' && messageSources.size > 0) {
      console.log(`[NotebookLM Takeout] Message ${n}: Extracting full citation details for ${messageSources.size} sources...`);
      shell.progress(`Message ${n}/${total}: Extracting ${messageSources.size} quotes (this may take a minute)...`, n / total);

      try {
        // Get source indices to extract
        const sourceIndices = Array.from(messageSources.keys());
        console.log(`[NotebookLM Takeout] Message ${n}: Extracting sourceIndices:`, sourceIndices);

        // Citation cache (Milestone 3c): same answer text and source numbers as
        // an earlier complete read -> reuse the quotes; never with images
        const cacheOn = settings.reuseCitations !== false && !variantSettings.exportNoteWithImages;
        const cacheNotebookId = NLME.notebookIdFromUrl(shell.tab.url);
        const cacheKey = cacheOn
          ? NLME.citationCacheKey({ kind: 'chat', text: tempDiv.textContent, numbers: sourceIndices })
          : null;
        const cached = cacheOn ? await NLME.citationCacheRead(chrome.storage.local, cacheNotebookId, cacheKey) : null;
        const cachedOk = !!cached && cached.length === sourceIndices.length &&
          cached.every((c, i) => c && String(c.sourceIndex) === String(sourceIndices[i]));
        tallyCitationCache(cachedOk);
        if (cachedOk) {
          fromCache = true;
          cached.forEach(c => {
            const source = messageSources.get(String(c.sourceIndex));
            source.text = c.text || source.text;
            source.quote = c.quote || '';
            stats.successfulExtractions++;
          });
          console.log(`[NotebookLM Takeout] Message ${n}: Citation cache hit, ${cached.length} quote(s) reused`);
        } else {
          // Call content script to extract citations by temporarily inserting HTML
          exportTimer?.start('chat.citations');
          const fullCitationData = await chrome.tabs.sendMessage(shell.tab.id, {
            type: 'EXTRACT_MESSAGE_CITATIONS',
            data: {
              messageIndex: pair.domIndex ?? ctx.index,
              messageHTML: pair.aiResponseHTML,
              sourceIndices: sourceIndices,
              includeCitationImages: !!variantSettings.exportNoteWithImages
            }
          });

          console.log(`[NotebookLM Takeout] Message ${n}: Received citation data:`, fullCitationData);
          exportTimer?.end('chat.citations');
          mergeTiming(fullCitationData);

          // Merge quotes into messageSources
          if (fullCitationData && fullCitationData.sourcesByIndex) {
            messageSources.forEach((source, sourceIndex) => {
              const fullData = fullCitationData.sourcesByIndex[sourceIndex];
              if (fullData) {
                source.text = fullData.text || source.text;
                source.quote = fullData.quote || '';
                stats.successfulExtractions++;
                console.log(`[NotebookLM Takeout] Message ${n}, source ${sourceIndex}: Updated with quote (${source.quote.length} chars)`);
              } else {
                stats.failedExtractions++;
              }
            });
          }

          // Track any errors
          if (fullCitationData && fullCitationData.errors && fullCitationData.errors.length > 0) {
            stats.failedExtractions += fullCitationData.errors.length;
            fullCitationData.errors.forEach(err => warn('citation_extraction', err));
          }

          // Store only a complete read: every source has a filename and a quote
          // and nothing was reported as failed (never a partial result)
          if (cacheKey && !(fullCitationData && fullCitationData.errors && fullCitationData.errors.length > 0)) {
            const toStore = sourceIndices.map(si => {
              const src = messageSources.get(si);
              return { sourceIndex: si, text: src.text, quote: src.quote };
            });
            const readAll = sourceIndices.every(si => fullCitationData && fullCitationData.sourcesByIndex && fullCitationData.sourcesByIndex[si]);
            if (readAll && NLME.citationSourcesComplete(toStore, sourceIndices.length)) {
              await NLME.citationCacheWrite(chrome.storage.local, cacheNotebookId, cacheKey, toStore);
            }
          }
        }
      } catch (error) {
        console.error(`[NotebookLM Takeout] Message ${n}: Error extracting full citations:`, error);
        stats.failedExtractions += messageSources.size;
        warn('extraction_error', `Failed to extract full citations: ${error.message}`, { stack: error.stack });
      }
    }

    // Sources sorted by sourceIndex
    const sourcesArray = Array.from(messageSources.entries())
      .sort((a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0))
      .map(([sourceIndex, source]) => ({
        sourceIndex: sourceIndex,
        text: source.text,
        quote: source.quote
      }));

    // No pacing sleep between messages (Milestone 1): citations are read
    // from the page, not fetched
    return message(sourcesArray);
  } catch (error) {
    console.error(`[NotebookLM Takeout] Error processing message ${n}:`, error);
    warn('message_processing_error', error.message, { stack: error.stack });
    // Keep the message, without citations
    return message([]);
  }
}

/**
 * The chat audit: messages, citations (numbers restart in every answer) and
 * formulas the page showed vs what the base Markdown holds. Message pairs
 * past the exported ones count as missing.
 *
 * @param {object} chatData the scan (messagePairs, stats, notebookTitle, notebookSummary)
 * @param {object[]} messages ProcessedMessage[] from extractChatPair, in pair order
 * @param {'quotes'|'titles'|'none'} citationMode 'quotes': a citation needs
 *   its quote; 'none': no citations are exported, so none are expected
 * @returns {{ ok: boolean, text: string }} the _audit.md document
 */
function buildChatAuditDoc(chatData, messages, citationMode = 'quotes') {
  const audit = newAudit();
  audit.expected.items = chatData.stats?.pairsInDom ?? chatData.messagePairs.length;
  audit.written.items = messages.length;
  if (citationMode === 'quotes') {
    // Answers whose quotes came from the cache (Milestone 3c)
    audit.cachedItems = messages.filter(m => m && m.stats && m.stats.citationsFound > 0).length;
    audit.cacheHits = messages.filter(m => m && m.fromCache).length;
  }
  if (citationMode !== 'none') {
    chatData.messagePairs.forEach((pair, i) => {
      addCitationCoverage(audit, pair.aiResponseHTML, messages[i] ? messages[i].sources : [], citationMode === 'quotes');
    });
  }
  const chatHtml = chatData.messagePairs.map(p => p.aiResponseHTML || '').join('\n');
  convertCounted(audit, chatHtml, () => convertChatToMarkdown(
    chatData.notebookTitle, chatData.notebookSummary, messages, false, citationMode === 'none', citationMode === 'titles'));
  return auditMarkdown('Chat Export', audit);
}

const CHAT_VERSION_INFO = {
  '': { title: 'Base (markdown, no images)', description: 'Citations rendered as markdown, images stripped' },
  '-code-blocks': { title: 'Code blocks (no images)', description: 'Citation quotes in code blocks, images stripped' },
  '-with-images': { title: 'With images (markdown)', description: 'Citations rendered as markdown, with base64 images' }
};

/**
 * Files for the chat export: chat.md plus chat-code-blocks.md /
 * chat-with-images.md when those versions apply (NLME.noteVariants), each
 * with front matter. One clean version → `single` (one Markdown download).
 * Otherwise (several versions, errors, failed audit, or forceZip) a ZIP's
 * files: the versions, errors.md, _audit.md, _index.md and manifest.json
 * (last).
 *
 * @param {object[]} messages ProcessedMessage[] from extractChatPair (may be
 *   empty for an errors-only package: then no chat files)
 * @param {{ meta: object, chatData: object, errors?: Array,
 *   auditDoc: {ok: boolean, text: string}, partial?: boolean, forceZip?: boolean,
 *   citationMode?: 'quotes'|'titles'|'none', variantSettings?: object }} options
 *   variantSettings: where noteVariants reads the export* settings (default `settings`)
 *   forceZip: always return ZIP files (Full Takeout)
 *   citationMode: 'none' writes no [n] markers and no Sources section (and,
 *   with no quotes, no code-blocks version)
 * @returns {{ files: Array<{path: string, data: string, title?: string, variant?: string, itemKind?: string}>,
 *   single: object|null }} single is also files[0] when set
 */
function buildChatFiles(messages, { meta, chatData, errors = [], auditDoc, partial = false, forceZip = false, citationMode = 'quotes', variantSettings = settings }) {
  const chatTitle = `Chat — ${meta.notebook}`;
  const frontMatter = variant => NLME.frontMatter({
    title: chatTitle,
    notebook: meta.notebook,
    notebook_url: meta.notebook_url,
    notebook_id: meta.notebook_id,
    exporter: meta.exporter,
    exported: meta.exported,
    kind: 'chat',
    variant,
    messages: messages.length
  });

  // Versions (NLME.noteVariants): base always; code blocks only when some
  // answer has quotes; with-images only when the Markdown has images
  const versionFiles = [];
  if (messages.length > 0) {
    const toMarkdown = codeBlocks => convertChatToMarkdown(chatData.notebookTitle, chatData.notebookSummary, messages, codeBlocks, citationMode === 'none', citationMode === 'titles');
    const baseMarkdown = toMarkdown(false);
    const hasQuotes = messages.some(m => (m.sources || []).some(src => src.quote && src.quote.trim()));
    const hasImages = /!\[/.test(baseMarkdown);
    for (const v of NLME.noteVariants(variantSettings, { hasQuotes, hasImages })) {
      const markdown = v.codeBlocks ? toMarkdown(true) : baseMarkdown;
      const variant = variantName(v.suffix);
      versionFiles.push({
        path: `chat${v.suffix}.md`,
        data: frontMatter(variant) + (v.images ? markdown : stripImagesFromMarkdown(markdown)),
        title: CHAT_VERSION_INFO[v.suffix].title,
        description: CHAT_VERSION_INFO[v.suffix].description,
        variant,
        itemKind: 'chat'
      });
    }
  }

  // One clean version: a single Markdown file, no ZIP
  if (!forceZip && versionFiles.length === 1 && errors.length === 0 && auditDoc.ok) {
    const single = versionFiles[0];
    return { files: [single], single };
  }

  const files = [...versionFiles];

  // Run-wide counts for errors.md and _index.md
  const totals = { withCitations: 0, citationsFound: 0, citationsExtracted: 0, successful: 0, failed: 0 };
  for (const m of messages) {
    if (m.stats.hasCitations) totals.withCitations++;
    totals.citationsFound += m.stats.citationsFound;
    totals.citationsExtracted += m.sources.length;
    totals.successful += m.stats.successfulExtractions;
    totals.failed += m.stats.failedExtractions;
  }
  // The messages in this package: on a partial run (cancelled, stopped) fewer than the scan found
  const totalMessages = messages.length;

  // errors.md only when something went wrong (no "Errors: 0" files)
  if (errors.length > 0) {
    const stats = { 'Chat': chatData.notebookTitle, 'Total Messages': totalMessages };
    if (citationMode !== 'none') {
      stats['Messages with Citations'] = totals.withCitations;
      stats['Total Citations Found'] = totals.citationsFound;
      stats['Unique Citations Extracted'] = totals.citationsExtracted;
    }
    if (messages.some(m => m.fullCitations)) {
      stats['Successful Extractions'] = totals.successful;
      stats['Failed Extractions'] = totals.failed;
    }
    files.push({
      path: 'errors.md',
      data: NLME.buildErrorReport({
        title: 'Chat Export',
        generatedAt: new Date().toLocaleString(),
        errors,
        stats
      })
    });
  }

  files.push({ path: '_audit.md', data: auditDoc.text });

  // _index.md with links to every version and the error report
  let indexContent = `# ${chatTitle}\n\n`;
  indexContent += `Generated: ${new Date().toLocaleString()}\n\n`;
  indexContent += `Total Messages: ${totalMessages}\n`;
  if (citationMode !== 'none') indexContent += `Messages with Citations: ${totals.withCitations}\n`;
  indexContent += `Total Files: ${versionFiles.length + (errors.length > 0 ? 1 : 0)}\n\n`;
  indexContent += '---\n\n';

  if (versionFiles.length > 0) {
    indexContent += '## Chat Export Versions\n\n';
    indexContent += `This export includes ${versionFiles.length} version(s) of the chat:\n\n`;
    for (const file of versionFiles) {
      indexContent += `- **[${file.title}](${encodeURI(file.path)})**\n`;
      indexContent += `  - ${file.description}\n`;
    }
    indexContent += '\n';
  }

  if (errors.length > 0) {
    indexContent += '---\n\n';
    indexContent += '## Error Report\n\n';
    indexContent += `- [Export Error Report](errors.md) - ${errors.length} error(s) encountered during export\n\n`;
  }

  files.push({ path: '_index.md', data: indexContent + timingSummary() });
  files.push({
    path: '_index.html',
    data: NLME.buildIndexHtml({
      meta,
      heading: chatTitle,
      files,
      links: [
        { href: '_index.md', label: 'Markdown index' },
        ...(errors.length > 0 ? [{ href: 'errors.md', label: 'Errors' }] : []),
        { href: '_audit.md', label: 'Audit' }
      ]
    })
  });

  // manifest.json last: it lists every file above (not itself)
  files.push({
    path: 'manifest.json',
    data: JSON.stringify(NLME.buildManifest({
      meta,
      kind: 'chat',
      partial,
      files,
      counts: { messages: messages.length },
      errorCount: errors.length
    }), null, 2)
  });

  return { files, single: null };
}

/**
 * Convert chat data to markdown format
 * dropCitations: Citation detail 'none' — remove the [n] markers and the
 * Sources section (the same meaning as convertToMarkdown's last parameter).
 * groupTitles: Citation detail 'titles' — one Sources line per source title.
 */
function convertChatToMarkdown(notebookTitle, notebookSummary, messages, citationsCodeBlock = true, dropCitations = false, groupTitles = false) {
  logger.info('Markdown', `Converting chat to markdown: "${notebookTitle}"`);
  logger.info('Markdown', `  - Message count: ${messages.length}`);

  // Initialize markdown with title
  let markdown = `# ${notebookTitle}\n\n`;

  // Add notebook summary if available
  if (notebookSummary && notebookSummary.trim().length > 0) {
    markdown += `**Notebook Summary**\n\n`;
    markdown += `${notebookSummary}\n\n`;
    markdown += '---\n\n';
  }

  markdown += `**Chat Export**\n\n`;
  markdown += `Exported: ${new Date().toLocaleString()}\n\n`;
  markdown += `Total Messages: ${messages.length}\n\n`;
  markdown += '---\n\n';

  // Initialize TurndownService with standardized configuration
  const turndownService = createTurndownService();

  // Use closure to track current message index
  let currentMessageIndex = 0;

  // Add custom rules with message index tracking
  console.log('[NotebookLM Takeout] Adding turndown rules for per-message citations');
  addChatTurndownRules(turndownService, citationsCodeBlock, () => currentMessageIndex, dropCitations);

  let currentDate = null;

  // Process each message pair
  messages.forEach((msg, idx) => {
    // Update current message index for turndown rules
    currentMessageIndex = idx;

    // Add date separator if date changed
    if (msg.date && msg.date !== currentDate) {
      markdown += `## ${msg.date}\n\n`;
      currentDate = msg.date;
    }

    // Add user question as H2 heading
    markdown += `## Q: ${msg.userMessage}\n\n`;

    // Convert AI response HTML to markdown
    let aiResponseMarkdown = turndownService.turndown(msg.aiResponseHTML);
    // Fix occurrence numbers skipped by rules that convert a subtree twice
    aiResponseMarkdown = NLME.renumberCitationAnchors(aiResponseMarkdown);

    // Clean up: Merge consecutive footnote references into a single <sup> tag
    // Pattern: <sup>...[1]...</sup>,<sup>...[2]...</sup> → <sup>...[1]... ...[2]...</sup>
    // This removes both commas and the >< between footnotes
    aiResponseMarkdown = aiResponseMarkdown.replace(/<\/sup>\s*,?\s*<sup>/g, ' ');

    // Clean up escaped brackets that appear between sup tags
    // Pattern: </sup>\> <<sup> (literal backslash-greater-than space less-than)
    aiResponseMarkdown = aiResponseMarkdown.replace(/<\/sup>\\>\s*<<sup>/g, ' ');

    // Also clean up unescaped >< between sup tags
    // Pattern: </sup>><sup> or </sup>> <<sup>
    aiResponseMarkdown = aiResponseMarkdown.replace(/<\/sup>>\s*<<sup>/g, ' ');

    // Final cleanup: remove any remaining standalone \> < patterns in text
    aiResponseMarkdown = aiResponseMarkdown.replace(/\\>\s*</g, '');

    console.log(`[Chat Export] Message ${idx + 1} markdown length:`, aiResponseMarkdown.length);
    // Use newline after A: to ensure tables/lists at start of response parse correctly
    markdown += `**A:**\n${aiResponseMarkdown}\n\n`;

    // Add sources for this message
    if (!dropCitations && msg.sources && msg.sources.length > 0) {
      markdown += '**Sources:**\n\n';
      if (groupTitles) {
        // Titles only: one line per source title, as in notes
        markdown += NLME.groupedSourcesMarkdown(
          msg.sources.map(source => ({ number: source.sourceIndex, text: source.text })), `msg-${idx}-`);
      } else msg.sources.forEach(source => {
        // Add anchor for source with message-specific ID
        markdown += `<a id="msg-${idx}-src-${source.sourceIndex}"></a>\n`;
        markdown += `**[[${source.sourceIndex}]](#msg-${idx}-cite-ref-${source.sourceIndex}-1)** ${source.text}\n`;

        // Add quote if available
        if (source.quote && source.quote.trim().length > 0) {
          // Optionally clean OCR artifacts, then escape markdown
          const cleanedQuote = settings.cleanOCRArtifacts ? cleanOCRArtifacts(source.quote) : source.quote;
          if (citationsCodeBlock) {
            const fence = NLME.fenceFor(cleanedQuote);
            markdown += `${fence}markdown\n${cleanedQuote}\n${fence}\n\n`;
          } else {
            markdown += `\n${NLME.toBlockquote(cleanedQuote)}\n\n`;
          }
        }
        markdown += '\n';
      });
    }

    // Add separator between message pairs (except last)
    if (idx < messages.length - 1) {
      markdown += '---\n\n';
    }
  });

  // Clean up excessive newlines
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  console.log('[Chat Export] Final markdown length:', markdown.length);

  return markdown;
}

/**
 * Add TurndownService rules for chat conversion
 * dropCitations: citation markers (and the footnote list under a table) convert to nothing
 */
function addChatTurndownRules(turndownService, citationsCodeBlock, getCurrentMessageIndex, dropCitations = false) {
  // Track citation occurrences within each message
  const citationOccurrences = new Map(); // "messageIdx:sourceIdx" -> count

  // Rule: Strip Angular component wrappers
  turndownService.addRule('stripAngularComponents', {
    filter: (node) => {
      const nodeName = node.nodeName.toLowerCase();
      return nodeName === 'labs-tailwind-structural-element-view-v2';
    },
    replacement: (content) => content
  });

  // Rule: Handle lists with Angular wrapper components
  turndownService.addRule('listsWithWrappers', {
    filter: (node) => {
      return node.nodeName === 'OL' || node.nodeName === 'UL';
    },
    replacement: (content, node, options) => {
      const isOrdered = node.nodeName === 'OL';

      // Find all <li> elements at any depth
      const allLis = Array.from(node.querySelectorAll('li'));

      // Filter to only include <li> elements that belong directly to this list
      const items = allLis.filter(li => {
        let parent = li.parentElement;
        while (parent && parent !== node) {
          const tagName = parent.tagName;
          if (tagName === 'OL' || tagName === 'UL') {
            return false; // This li belongs to a nested list
          }
          parent = parent.parentElement;
        }
        return true;
      });

      if (items.length === 0) {
        return '\n' + content + '\n';
      }

      // Generate markdown for each list item
      let markdown = '\n';
      items.forEach((li, idx) => {
        const marker = isOrdered ? `${idx + 1}.` : options.bulletListMarker;
        const itemContent = turndownService.turndown(li.innerHTML).trim();
        markdown += `${marker} ${itemContent}\n`;
      });
      markdown += '\n';

      return markdown;
    }
  });

  // Rule: Convert div headings with role="heading"
  turndownService.addRule('reportHeadings', {
    filter: (node) => {
      return node.nodeName === 'DIV' &&
             node.getAttribute('role') === 'heading' &&
             node.hasAttribute('aria-level');
    },
    replacement: (content, node) => {
      const level = parseInt(node.getAttribute('aria-level')) || 1;
      const prefix = '#'.repeat(level);
      return `\n${prefix} ${content.trim()}\n\n`;
    }
  });

  // Rule: Convert blockquotes (callout boxes)
  turndownService.addRule('blockquotes', {
    filter: (node) => {
      return node.nodeName === 'DIV' &&
             node.classList.contains('blockquote');
    },
    replacement: (content, node) => {
      // Get the text content and convert to blockquote format
      const text = content.trim();
      if (!text) return '';

      // Split by lines and add > prefix to each line
      const lines = text.split('\n').map(line => {
        const trimmed = line.trim();
        return trimmed ? `> ${trimmed}` : '>';
      });

      return `\n${lines.join('\n')}\n\n`;
    }
  });

  // Rule: Convert tables to markdown table format
  turndownService.addRule('tables', {
    filter: 'table',
    replacement: (content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';

      let markdown = '\n\n';

      // Helper to process cell content using turndown for full formatting/citation support
      const processCellContent = (cell) => {
        // Use turndown to process cell HTML - this handles citations, bold, italic, etc.
        let text = turndownService.turndown(cell.innerHTML);
        // Clean up for table cell: escape pipes, flatten to single line
        text = text.replace(/\|/g, '\\|');
        text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        return text;
      };

      // Process each row
      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        const cellContents = cells.map(processCellContent);

        // Add row
        markdown += '| ' + cellContents.join(' | ') + ' |\n';

        // Add separator after header row
        if (rowIndex === 0) {
          const separators = cells.map(() => '---');
          markdown += '| ' + separators.join(' | ') + ' |\n';
        }
      });

      markdown += '\n';

      // Try to capture footnotes that follow the table
      // Look for sibling elements after the table that contain footnote references
      let currentElement = node.parentElement;
      while (currentElement && currentElement.nodeName.toLowerCase() !== 'element-list-renderer') {
        currentElement = currentElement.parentElement;
      }

      if (currentElement) {
        // Find all structural elements that might contain footnotes
        const structuralElements = currentElement.querySelectorAll('labs-tailwind-structural-element-view-v2');
        const footnotes = [];

        // Look for elements with footnote pattern [number] at start
        structuralElements.forEach(el => {
          const text = el.textContent.trim();
          // Match footnotes like "[1] Some text" or "[86] Some text"
          if (/^\[\d+\]/.test(text)) {
            footnotes.push(text);
          }
        });

        // Add footnotes if found
        if (footnotes.length > 0 && !dropCitations) {
          markdown += '\n**References:**\n\n';
          footnotes.forEach(footnote => {
            markdown += footnote + '\n\n';
          });
        }
      }

      return markdown;
    }
  });

  // Strip mat-icon elements (Google Material icons that shouldn't appear in markdown)
  turndownService.addRule('matIcons', {
    filter: (node) => node.nodeName === 'MAT-ICON',
    replacement: () => ''
  });

  // Handle KaTeX math notation — delegates to the shared converter so notes,
  // sources, and chat all use the same logic. See convertKatexNodeToLatex().
  turndownService.addRule('katexMath', {
    filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('katex'),
    replacement: (_content, node) => convertKatexNodeToLatex(node)
  });

  // Rule: Citation buttons - with message-specific anchors
  turndownService.addRule('citationButtons', {
    filter: (node) => {
      if (node.nodeName !== 'BUTTON' || !node.classList.contains('citation-marker')) {
        return false;
      }
      // Skip expand/collapse buttons (more_horiz, unfold_less icons)
      const matIcon = node.querySelector('mat-icon');
      if (matIcon) {
        const iconText = matIcon.textContent?.trim();
        const ariaLabel = matIcon.getAttribute('aria-label') || '';
        if (iconText === 'more_horiz' || iconText === 'unfold_less' ||
            ariaLabel.includes('additional citations')) {
          return false;
        }
      }
      return true;
    },
    replacement: (content, node) => {
      if (dropCitations) return '';
      // Try mat-icon first (new DOM), then span (old DOM)
      const matIcon = node.querySelector('mat-icon');
      const span = node.querySelector('span');
      const sourceIndex = matIcon?.textContent?.trim() || span?.textContent?.trim();

      // Skip invalid source indices
      if (!sourceIndex ||
          sourceIndex === '...' ||
          sourceIndex === 'more_horiz' ||
          sourceIndex === 'unfold_less' ||
          sourceIndex.includes('<') ||
          sourceIndex.includes('>') ||
          !/^[0-9]+$/.test(sourceIndex)) {
        console.warn('[Chat Export] Skipping invalid citation with sourceIndex:', sourceIndex);
        return '';
      }

      // Get current message index
      const messageIndex = getCurrentMessageIndex();
      const key = `${messageIndex}:${sourceIndex}`;

      // Track occurrences for this source within this message
      if (!citationOccurrences.has(key)) {
        citationOccurrences.set(key, 0);
      }
      const occurrenceCount = citationOccurrences.get(key) + 1;
      citationOccurrences.set(key, occurrenceCount);

      // Return citation with message-specific anchor and link to source
      return `<sup><a id="msg-${messageIndex}-cite-ref-${sourceIndex}-${occurrenceCount}" href="#msg-${messageIndex}-src-${sourceIndex}">[${sourceIndex}]</a></sup>`;
    }
  });
}
// ========== END CHAT EXPORT FUNCTIONS ==========


let _studioItems = [];
// ==================== GENERATED TAB (internal id 'studio') ====================
// Lists everything Gemini Notebook generated: Studio panel items (SCAN_STUDIO_ITEMS)
// plus the notes in the Sources panel's "Notes" group (the source-note entries of
// SCAN_NOTES, download only).

let _studioTabId = null;
// The Generated tab's list controller (sidebar-list.js); replaced on every redraw
let _studioListController = null;

function dropStudioList() {
  if (_studioListController) {
    _studioListController.destroy();
    _studioListController = null;
  }
  updateStudioBulkButtonsState();
}

async function scanStudioPage() {
  const resultsEl = document.getElementById('studio-scan-results');
  const countBadge = document.getElementById('studio-count');
  if (!resultsEl || !countBadge) return;

  dropStudioList();
  resultsEl.innerHTML = '<p class="scanning">Scanning generated items...</p>';
  countBadge.textContent = '0';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isNotebookUrl(tab?.url)) {
      resultsEl.innerHTML = '<p class="empty-message">Please open NotebookLM first.</p>';
      return;
    }

    await ensureContentScriptLoaded(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_STUDIO_ITEMS' });
    const items = [...(response?.items || [])];

    // Notes in the Sources panel's "Notes" group are not in the Studio list. If this
    // extra scan fails, the Studio items still render.
    try {
      const notes = await scanNotesData(tab.id);
      for (const note of notes) {
        if (note.elementType !== 'source-note') continue;
        items.push({
          kind: 'source-note',
          label: note.title,
          type: note.type || 'Note (Sources panel)',
          sourceIndex: note.sourceIndex
        });
      }
    } catch (noteError) {
      console.warn('[NotebookLM Takeout] Sources-panel notes scan failed; listing Studio items only:', noteError);
    }

    _studioItems = items;
    _studioTabId = tab.id;

    renderStudioList(items);
  } catch (error) {
    console.error('[NotebookLM Takeout] Generated scan failed:', error);
    resultsEl.innerHTML = `<p class="error-message">Generated scan failed: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

function renderStudioList(items) {
  const resultsEl = document.getElementById('studio-scan-results');
  const countBadge = document.getElementById('studio-count');
  const downloadBulkBtn = document.getElementById('studio-download-selected-btn');
  const deleteBulkBtn = document.getElementById('studio-delete-selected-btn');
  if (!resultsEl || !countBadge) return;

  dropStudioList();
  countBadge.textContent = items.length;

  if (items.length === 0) {
    resultsEl.innerHTML = '<p class="empty-message">No generated items found. Generate content in NotebookLM first.</p>';
    if (downloadBulkBtn) downloadBulkBtn.style.display = 'none';
    if (deleteBulkBtn) deleteBulkBtn.style.display = 'none';
    return;
  }

  if (downloadBulkBtn) downloadBulkBtn.style.display = '';
  if (deleteBulkBtn) deleteBulkBtn.style.display = '';

  resultsEl.innerHTML = '<div class="studio-list"></div>';
  const listEl = resultsEl.querySelector('.studio-list');

  const rowHtml = (item, idx) => {
    const iconSvg = getIconForType(item.type);
    const detailsStr = item.details ? ` · ${escapeHtml(item.details)}` : '';
    return `
        <div class="scan-item-icon">${iconSvg}</div>
        <div class="scan-item-info">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.type)}${detailsStr}</small>
        </div>
        <button class="btn-icon download-single-btn studio-download-btn" data-idx="${idx}" title="Download ${escapeHtml(item.label)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <span class="download-status"></span>
        </button>
        <button class="btn-icon studio-delete-btn" data-idx="${idx}" title="Delete ${escapeHtml(item.label)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      `;
  };

  _studioListController = createListController({
    tab: 'studio',
    container: listEl,
    items,
    titleOf: item => item.label,
    typeOf: item => item.type,
    defaultSelected: 'none',
    rowHtml,
    onChange: controller => updateStudioBulkButtonsState(controller)
  });

  // Row buttons (the list controller ignores clicks on buttons, so they never toggle the row)
  listEl.addEventListener('click', (e) => {
    const downloadBtn = e.target.closest('.studio-download-btn');
    if (downloadBtn) {
      const idx = parseInt(downloadBtn.dataset.idx, 10);
      runExclusive('Generated download', () => handleStudioDownloadRow(idx, downloadBtn));
      return;
    }
    const deleteBtn = e.target.closest('.studio-delete-btn');
    if (deleteBtn) {
      runExclusive('Generated delete', () => handleStudioDeleteRow(parseInt(deleteBtn.dataset.idx, 10), deleteBtn));
    }
  });
}

// Every Generated item can be deleted: Studio items by label, Sources-panel
// notes (kind 'source-note') by sourceIndex + title.
function isStudioItemDeletable(item) {
  return !!item;
}

// One delete request for a Generated item; throws on failure. Bulk delete passes
// useIndex false for Studio items: by label only, a stale index could hit another item.
async function sendStudioDelete(item, { useIndex = true } = {}) {
  const message = item.kind === 'source-note'
    ? { type: 'DELETE_SOURCE_NOTE', data: { sourceIndex: item.sourceIndex, title: item.label } }
    : { type: 'DELETE_STUDIO_ITEM', data: useIndex ? { label: item.label, combinedIndex: item.combinedIndex } : { label: item.label } };
  const response = await chrome.tabs.sendMessage(_studioTabId, message);
  if (!response || !response.success) {
    throw new Error(response?.error || 'Delete failed');
  }
}

// The bulk buttons follow the selection: disabled at 0, otherwise "... Selected (K)".
// Delete counts the deletable selected items (all of them).
function updateStudioBulkButtonsState(controller = _studioListController) {
  const n = controller ? controller.selectedCount() : 0;
  const deletableN = controller ? controller.selectedItems().filter(isStudioItemDeletable).length : 0;
  const downloadBulkBtn = document.getElementById('studio-download-selected-btn');
  const deleteBulkBtn = document.getElementById('studio-delete-selected-btn');
  if (downloadBulkBtn) {
    downloadBulkBtn.disabled = n === 0;
    setButtonLabel(downloadBulkBtn, n > 0 ? `Download Selected (${n})` : 'Download Selected');
  }
  if (deleteBulkBtn) {
    deleteBulkBtn.disabled = deletableN === 0;
    setButtonLabel(deleteBulkBtn, deletableN > 0 ? `Delete Selected (${deletableN})` : 'Delete Selected');
  }
}

function setStudioRowStatus(btn, state) {
  if (!btn) return;
  const statusSpan = btn.querySelector('.download-status');
  if (!statusSpan) return;
  if (state === 'pending') {
    statusSpan.textContent = '⏳';
    statusSpan.className = 'download-status downloading';
    btn.disabled = true;
  } else if (state === 'success') {
    statusSpan.textContent = '✓';
    statusSpan.className = 'download-status success';
    setTimeout(() => { statusSpan.textContent = ''; statusSpan.className = 'download-status'; btn.disabled = false; }, 3000);
  } else if (state === 'error') {
    statusSpan.textContent = '✗';
    statusSpan.className = 'download-status error';
    setTimeout(() => { statusSpan.textContent = ''; statusSpan.className = 'download-status'; btn.disabled = false; }, 3000);
  }
}

async function handleStudioDownloadRow(idx, btn) {
  const item = _studioItems[idx];
  if (!item) return;
  setStudioRowStatus(btn, 'pending');
  try {
    if (item.kind === 'artifact') {
      // moreIndex: same index space as the Artifacts tab and DOWNLOAD_ARTIFACT
      await downloadArtifact(_studioTabId, item.moreIndex, item.type, item.label);
    } else if (item.kind === 'source-note') {
      // A note from the Sources panel: EXTRACT_NOTE opens it by sourceIndex (as the Notes tab does)
      await exportSingleNote({ index: -1, sourceIndex: item.sourceIndex, title: item.label, type: item.type });
    } else {
      // kind === 'note' — regular note or mindmap
      await exportSingleNote({ index: item.kindIndex, title: item.label, type: item.type });
    }
    setStudioRowStatus(btn, 'success');
  } catch (error) {
    console.error('[NotebookLM Takeout] Generated download failed:', error);
    showToast(`✗ Failed to download ${item.label}: ${error.message || error}`, 'error');
    setStudioRowStatus(btn, 'error');
    throw error;
  }
}

async function handleStudioDeleteRow(idx, btn) {
  const item = _studioItems[idx];
  if (!item || !isStudioItemDeletable(item)) return;

  if (!confirm(`Delete "${item.label}"? This cannot be undone.`)) return;

  if (btn) btn.disabled = true;
  try {
    await sendStudioDelete(item);
    showToast(`Deleted "${item.label}"`, 'success');
    // Refresh the list so indices are re-aligned with the DOM.
    await scanStudioPage();
  } catch (error) {
    console.error('[NotebookLM Takeout] Generated delete failed:', error);
    showToast(`✗ Failed to delete ${item.label}: ${error.message || error}`, 'error');
    if (btn) btn.disabled = false;
  }
}

async function handleStudioBulkDownload() {
  const selected = _studioListController ? _studioListController.selectedItems() : [];
  const selectedIdxs = selected.map(item => _studioItems.indexOf(item)).filter(n => n >= 0);
  if (selectedIdxs.length === 0) return;

  const bulkBtn = document.getElementById('studio-download-selected-btn');
  if (bulkBtn) bulkBtn.disabled = true;

  let okCount = 0;
  for (const idx of selectedIdxs) {
    const rowBtn = document.querySelector(`#studio-scan-results .studio-download-btn[data-idx="${idx}"]`);
    try {
      await handleStudioDownloadRow(idx, rowBtn);
      okCount++;
    } catch (_) {
      // errors already surfaced per-row
    }
  }

  showToast(`Downloaded ${okCount}/${selectedIdxs.length} generated item(s)`, okCount === selectedIdxs.length ? 'success' : 'warning');
  updateStudioBulkButtonsState();
}

async function handleStudioBulkDelete() {
  // Only what is selected (and so visible) is deleted; the dialog names that count.
  const selectedItems = _studioListController ? _studioListController.selectedItems() : [];
  // An untitled Studio item only has a made-up label ("Item 3"): deleting by it
  // could hit a real item with that title, so a bulk delete skips it
  const skippedUntitled = selectedItems.filter(item => item && item.untitled === true && item.kind !== 'source-note').length;
  const deletable = selectedItems.filter(item => isStudioItemDeletable(item) && !(item.untitled === true && item.kind !== 'source-note'));
  if (deletable.length === 0) {
    if (skippedUntitled > 0) showToast(`Skipped ${skippedUntitled} untitled item(s): delete them one by one`, 'warning');
    return;
  }

  const skippedNote = skippedUntitled > 0 ? `\n\n${skippedUntitled} untitled item(s) will be skipped; delete those one by one.` : '';
  if (!confirm(`Delete ${deletable.length} item(s)? This cannot be undone.${skippedNote}`)) return;

  const bulkBtn = document.getElementById('studio-delete-selected-btn');
  if (bulkBtn) bulkBtn.disabled = true;

  // Studio items first (resolved by label each time, to survive index shifts),
  // then Sources-panel notes from the highest sourceIndex down so the lower
  // indexes stay valid while rows disappear.
  const studioItems = deletable.filter(item => item.kind !== 'source-note');
  const sourceNotes = deletable.filter(item => item.kind === 'source-note')
    .sort((a, b) => (b.sourceIndex ?? -1) - (a.sourceIndex ?? -1));
  const queue = [...studioItems, ...sourceNotes];

  let okCount = 0;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      await sendStudioDelete(item, { useIndex: false });
      okCount++;
    } catch (e) {
      console.warn('[NotebookLM Takeout] Bulk delete skipped:', item.label, e?.message || e);
    }
    // Let NotebookLM's undo toast dismiss and the list re-render before the next
    // lookup. Skip the delay on the last iteration.
    if (i < queue.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const skippedText = skippedUntitled > 0 ? `, skipped ${skippedUntitled} untitled` : '';
  showToast(`Deleted ${okCount}/${queue.length} generated item(s)${skippedText}`, okCount === queue.length && skippedUntitled === 0 ? 'success' : 'warning');
  await scanStudioPage();
}

// Store last health check results for report generation
let lastHealthCheckResults = null;
// ==================== DOM HEALTH CHECK ====================


/**
 * Run comprehensive DOM health check and display results
 */
async function runHealthCheck() {
  const panel = document.getElementById('health-check-panel');
  const loadingEl = document.getElementById('health-check-loading');
  const resultsEl = document.getElementById('health-check-results');

  // Show panel with loading state
  panel.style.display = 'block';
  loadingEl.style.display = 'flex';
  resultsEl.style.display = 'none';

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isNotebookUrl(tab?.url)) {
      displayHealthCheckError('Please open NotebookLM first');
      return;
    }

    // Run the health check
    const results = await chrome.tabs.sendMessage(tab.id, {
      type: 'RUN_COMPREHENSIVE_HEALTH_CHECK',
      options: {}
    });

    // Store results for report generation
    lastHealthCheckResults = results;

    // Display results
    displayHealthCheckResults(results);
  } catch (error) {
    console.error('[NotebookLM Takeout] Health check error:', error);
    displayHealthCheckError(error.message || 'Failed to run health check');
  }
}

/**
 * Display health check error
 * @param {string} message - Error message
 */
function displayHealthCheckError(message) {
  const loadingEl = document.getElementById('health-check-loading');
  const resultsEl = document.getElementById('health-check-results');

  loadingEl.style.display = 'none';
  resultsEl.style.display = 'block';

  // Show error state
  const overallEl = document.getElementById('health-overall');
  overallEl.className = 'health-overall unhealthy';
  document.getElementById('health-overall-title').textContent = 'Health Check Failed';
  document.getElementById('health-overall-subtitle').textContent = message;

  // Clear categories
  document.getElementById('health-categories').innerHTML = '';
  document.getElementById('health-recommendations').style.display = 'none';
  document.getElementById('health-check-duration').textContent = '';
}

/**
 * Display health check results
 * @param {Object} results - Health check results from content script
 */
function displayHealthCheckResults(results) {
  const loadingEl = document.getElementById('health-check-loading');
  const resultsEl = document.getElementById('health-check-results');

  loadingEl.style.display = 'none';
  resultsEl.style.display = 'block';

  // Overall status
  const overallEl = document.getElementById('health-overall');
  overallEl.className = `health-overall ${results.overallHealthy ? 'healthy' : 'unhealthy'}`;

  document.getElementById('health-overall-title').textContent =
    results.overallHealthy ? 'All Systems Operational' : 'Issues Detected';
  document.getElementById('health-overall-subtitle').textContent =
    results.overallHealthy
      ? 'Extension is ready to export from this notebook.'
      : `${results.criticalFailures?.length || 0} critical issue(s) found.`;

  // Recommendations
  const recsEl = document.getElementById('health-recommendations');
  const recsListEl = document.getElementById('health-recommendations-list');
  if (results.recommendations && results.recommendations.length > 0) {
    recsListEl.innerHTML = results.recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('');
    recsEl.style.display = 'block';
  } else {
    recsEl.style.display = 'none';
  }

  // Categories
  const categoriesEl = document.getElementById('health-categories');
  categoriesEl.innerHTML = '';

  const categoryLabels = {
    general: 'General',
    notes: 'Notes',
    sources: 'Sources',
    artifacts: 'Artifacts',
    chat: 'Chat History',
    citations: 'Citations'
  };

  for (const [categoryKey, categoryData] of Object.entries(results.categories || {})) {
    const categoryEl = document.createElement('div');
    categoryEl.className = 'health-category';

    const headerEl = document.createElement('div');
    headerEl.className = 'health-category-header';
    headerEl.innerHTML = `
      <div class="health-category-title">
        <span class="health-category-status ${categoryData.healthy ? 'passed' : 'failed'}"></span>
        <span>${categoryLabels[categoryKey] || categoryKey}</span>
      </div>
      <svg class="health-category-toggle" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
      </svg>
    `;

    headerEl.addEventListener('click', () => {
      categoryEl.classList.toggle('expanded');
    });

    const checksEl = document.createElement('div');
    checksEl.className = 'health-category-checks';

    if (categoryData.error) {
      checksEl.innerHTML = `
        <div class="health-check-item">
          <div class="health-check-icon failed"></div>
          <div class="health-check-details">
            <div class="health-check-name">Check failed</div>
            <div class="health-check-note">${escapeHtml(categoryData.error)}</div>
          </div>
        </div>
      `;
    } else if (categoryData.checks && categoryData.checks.length > 0) {
      checksEl.innerHTML = categoryData.checks.map(check => {
        // Non-critical failures show as 'info' (gray), critical failures show as 'failed' (red)
        let statusClass;
        if (check.passed) {
          statusClass = 'passed';
        } else if (check.name === 'Skipped') {
          statusClass = 'skipped';
        } else if (check.critical === false) {
          statusClass = 'info'; // Non-critical failure - informational only
        } else {
          statusClass = 'failed';
        }
        return `
          <div class="health-check-item">
            <div class="health-check-icon ${statusClass}"></div>
            <div class="health-check-details">
              <div class="health-check-name">${escapeHtml(check.name)}${check.count !== undefined ? ` (${check.count})` : ''}</div>
              ${check.note ? `<div class="health-check-note">${escapeHtml(check.note)}</div>` : ''}
              ${check.selector ? `<div class="health-check-selector">${escapeHtml(check.selector)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } else {
      checksEl.innerHTML = `
        <div class="health-check-item">
          <div class="health-check-icon skipped"></div>
          <div class="health-check-details">
            <div class="health-check-name">No checks performed</div>
          </div>
        </div>
      `;
    }

    categoryEl.appendChild(headerEl);
    categoryEl.appendChild(checksEl);
    categoriesEl.appendChild(categoryEl);

    // Auto-expand failed categories
    if (!categoryData.healthy) {
      categoryEl.classList.add('expanded');
    }
  }

  // Duration
  document.getElementById('health-check-duration').textContent =
    results.duration ? `Completed in ${results.duration}ms` : '';
}

/**
 * Generate a text report from health check results
 * @param {Object} results - Health check results
 * @returns {string} - Formatted text report
 */
function generateHealthReport(results) {
  const lines = [];
  const timestamp = new Date().toISOString();

  lines.push('# NotebookLM Takeout - DOM Health Check Report');
  lines.push(`Generated: ${timestamp}`);
  lines.push('');

  // Overall status
  lines.push(`## Overall Status: ${results.overallHealthy ? 'HEALTHY' : 'ISSUES DETECTED'}`);
  lines.push('');

  // Critical failures
  if (results.criticalFailures && results.criticalFailures.length > 0) {
    lines.push('## Critical Failures');
    results.criticalFailures.forEach(f => lines.push(`- ${f}`));
    lines.push('');
  }

  // Recommendations
  if (results.recommendations && results.recommendations.length > 0) {
    lines.push('## Recommendations');
    results.recommendations.forEach(r => lines.push(`- ${r}`));
    lines.push('');
  }

  // Category details
  const categoryLabels = {
    general: 'General',
    notes: 'Notes',
    sources: 'Sources',
    artifacts: 'Artifacts',
    chat: 'Chat History',
    citations: 'Citations'
  };

  lines.push('## Category Details');
  lines.push('');

  for (const [categoryKey, categoryData] of Object.entries(results.categories || {})) {
    const label = categoryLabels[categoryKey] || categoryKey;
    const status = categoryData.healthy ? 'PASS' : 'FAIL';
    lines.push(`### ${label}: ${status}`);

    if (categoryData.error) {
      lines.push(`Error: ${categoryData.error}`);
    } else if (categoryData.checks && categoryData.checks.length > 0) {
      categoryData.checks.forEach(check => {
        // Non-critical failures show as [INFO], critical failures show as [FAIL]
        let icon;
        if (check.passed) {
          icon = '[OK]';
        } else if (check.warning) {
          icon = '[WARN]'; // Non-critical, but exports lose fidelity
        } else if (check.critical === false) {
          icon = '[INFO]'; // Non-critical - informational only
        } else {
          icon = '[FAIL]';
        }
        let line = `  ${icon} ${check.name}`;
        if (check.count !== undefined) line += ` (${check.count})`;
        lines.push(line);
        if (check.note) lines.push(`       ${check.note}`);
        if (check.selector && !check.passed) lines.push(`       Selector: ${check.selector}`);
      });
    }
    lines.push('');
  }

  // Metadata
  lines.push('## Metadata');
  lines.push(`Duration: ${results.duration}ms`);
  lines.push(`User Agent: ${navigator.userAgent}`);
  lines.push('');

  // Note about tooltip test
  lines.push('---');
  lines.push('Note: The Citations category reads two real citations exactly the way exports do.');
  lines.push('If it fails, note and chat exports would lose their quotes; please report it with this file.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Copy health check report to clipboard
 */
async function copyHealthReport() {
  if (!lastHealthCheckResults) {
    showToast('No health check results to copy', 'error');
    return;
  }

  try {
    const report = generateHealthReport(lastHealthCheckResults);
    await navigator.clipboard.writeText(report);
    showToast('Report copied to clipboard', 'success');
  } catch (error) {
    console.error('[NotebookLM Takeout] Failed to copy report:', error);
    showToast('Failed to copy report', 'error');
  }
}
