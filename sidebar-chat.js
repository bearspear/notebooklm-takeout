// NotebookLM Takeout - Sidebar: Chat tab (scan, summary, chat export job, chat Markdown)
// Classic script, loads after sidebar-sources.js. Shared helpers live in sidebar-core.js.

let lastChatScanTiming = null;

/**
 * Chat from SCAN_CHAT (the page scrolls the whole history in), no UI (Chat
 * tab, Full Takeout). Records the scan time for the export's timing summary.
 * @returns {Promise<{ notebookTitle, notebookSummary, messagePairs: Array, stats?, dateRange? }>}
 * @throws {ScanError} when the page reports a scan error
 */
async function scanChatData(tabId) {
  await ensureContentScriptLoaded(tabId);
  const scanStartedAt = performance.now();
  const response = await chrome.tabs.sendMessage(tabId, { type: NLME.MSG.SCAN_CHAT });
  lastChatScanTiming = { 'chat.scan': { count: 1, ms: Math.round(performance.now() - scanStartedAt) } };
  if (!response) throw new Error('No response from the page');
  if (response.error) throw new ScanError(response.error);
  return response.chatData;
}
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
      type: NLME.MSG.SHOW_EXPORT_OVERLAY,
      message: 'Scanning chat history...'
    });

    // Trigger auto-scroll and scan
    let chatData;
    try {
      chatData = await scanChatData(tab.id);
    } catch (error) {
      if (!(error instanceof ScanError)) throw error;
      await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.HIDE_EXPORT_OVERLAY });
      showToast(`Scan failed: ${error.message}`, 'error');
      chatResults.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
      return;
    }

    // Hide overlay
    await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.HIDE_EXPORT_OVERLAY });

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
      await chrome.tabs.sendMessage(tab.id, { type: NLME.MSG.HIDE_EXPORT_OVERLAY });
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
            type: NLME.MSG.EXTRACT_MESSAGE_CITATIONS,
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
  const turndownService = NLMEMarkdown.createTurndownService();

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
    replacement: (_content, node) => NLMEMarkdown.convertKatexNodeToLatex(node)
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
