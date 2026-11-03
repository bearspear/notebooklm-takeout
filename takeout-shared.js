// NotebookLM Takeout - shared selectors and DOM-free helpers.
// Loaded as a content script (before content.js), by sidebar.html, and by the
// Node unit tests in tests/. Safe to execute more than once.
(function (root) {
  'use strict';

  // Studio item icon -> artifact type. Icons taken from the Studio "create"
  // buttons; format_list_bulleted / audio_spark / copy / quiz since Nov 2026.
  const ICON_TO_TYPE = {
    tablet: 'Slides',
    auto_tab_group: 'Report',
    stacked_bar_chart: 'Infographic',
    table_view: 'Data Table',
    format_list_bulleted: 'Data Table',
    flowchart: 'Mind Map',
    headphones: 'Audio Overview',
    audio_magic_eraser: 'Audio Overview',
    audio_spark: 'Audio Overview',
    videocam: 'Video Overview',
    copy: 'Flashcards',
    quiz: 'Quiz'
  };

  // Stretched-button aria-labels that name a type ("Artifact" is generic).
  const LABEL_TO_TYPE = {
    'Data Table': 'Data Table',
    'Report': 'Report',
    'Audio Overview': 'Audio Overview',
    'Slide Deck': 'Slides',
    'Video Overview': 'Video Overview',
    'Mind Map': 'Mind Map',
    'Flashcards': 'Flashcards',
    'Quiz': 'Quiz',
    'Infographic': 'Infographic'
  };

  // Note icons: article since Nov 2026, sticky_note_2 before.
  const NOTE_ICONS = ['article', 'sticky_note_2', 'description', 'note'];

  const NOT_DOWNLOADABLE = ['Flashcards', 'Quiz'];

  function resolveArtifactType({ iconText, buttonLabel } = {}) {
    const label = (buttonLabel || '').trim();
    if (LABEL_TO_TYPE[label]) return LABEL_TO_TYPE[label];
    const icon = (iconText || '').trim();
    return ICON_TO_TYPE[icon] || icon || 'Unknown';
  }

  // Chat (the Chat tab and Full Takeout) follows the one Citation detail setting, the same
  // one notes use: 'quotes' (default), 'titles' or 'none'. A missing or unknown value is 'quotes'.
  function chatCitationMode(settings) {
    const detail = settings && settings.citationDetail;
    return detail === 'titles' || detail === 'none' ? detail : 'quotes';
  }

  // Full Takeout's own ZIP choice (the checkbox next to its button): takeoutZip when it has
  // been set (a boolean), else the "Always use ZIP" setting (autoZip).
  function takeoutZipChoice(settings) {
    if (settings && typeof settings.takeoutZip === 'boolean') return settings.takeoutZip;
    return !!(settings && settings.autoZip);
  }

  function isDownloadableType(type) {
    return !NOT_DOWNLOADABLE.includes(type);
  }

  // Citation hover tooltip. Gemini Notebook replaced xap-inline-dialog-container
  // with an nb-popover in a .citation-tooltip-panel overlay pane (Nov 2026).
  const CITATION_TOOLTIP_SELECTOR = [
    '.cdk-overlay-pane.citation-tooltip-panel',
    'div.popover-card[aria-label="Citation Details"]',
    'xap-inline-dialog-container[role="dialog"]'
  ].join(', ');

  const EXPANDER_ICONS = ['more_horiz', 'unfold_less', '...'];

  function isCitationExpander({ iconText, ariaLabel } = {}) {
    if (EXPANDER_ICONS.includes((iconText || '').trim())) return true;
    return (ariaLabel || '').includes('additional citations');
  }

  // A collapsed citation group still to be expanded. Once expanded the same
  // button shows unfold_less / "Hide additional citations" (Nov 2026), and
  // clicking it again would collapse the group.
  function isCollapsedCitationGroup({ iconText, ariaLabel } = {}) {
    const icon = (iconText || '').trim();
    const label = (ariaLabel || '').trim().toLowerCase();
    if (icon === 'unfold_less' || label.startsWith('hide')) return false;
    return icon === 'more_horiz' || icon === '...' || label.startsWith('show additional citations');
  }

  function parseCitationIndex(text) {
    const t = (text || '').trim();
    return /^[0-9]+$/.test(t) ? t : null;
  }

  // Sources-section entries for a note: every extracted source plus every
  // marker number seen in the body, keyed by the ORIGINAL citation number so
  // body links and anchors always agree. Markers whose tooltip could not be
  // read get a placeholder instead of borrowing another source's number.
  // Pass { placeholders: false } when no citation extraction was attempted
  // (reports, source content): markers then add no entries.
  function buildCitationEntries(sources, markerIndices, { placeholders = true } = {}) {
    const byNumber = new Map();
    for (const s of sources || []) {
      const number = String(s.sourceIndex);
      if (!byNumber.has(number)) {
        byNumber.set(number, { number, text: s.text || '', quote: s.quote || '', missing: false });
      }
    }
    for (const m of placeholders ? (markerIndices || []) : []) {
      const number = String(m);
      if (!byNumber.has(number)) {
        byNumber.set(number, { number, text: '(citation details unavailable)', quote: '', missing: true });
      }
    }
    return [...byNumber.values()].sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));
  }

  // Viewer close button in the Studio panel header, outside <studio-panel>.
  // Labels vary ("Close web page viewer", "Close report viewer", "Close table",
  // "Close note view"); "Collapse studio panel" must never match (Nov 2026).
  const STUDIO_HEADER_CLOSE_SELECTOR = 'section.studio-panel .panel-header button[aria-label^="Close"]';

  // Resolve the item a row refers to when titles can repeat: trust the scanned
  // index while its title still matches, else the first title match, else the
  // index alone. -1 when neither is usable.
  function pickByIndexThenTitle(titles, index, title) {
    const list = titles || [];
    const inRange = Number.isInteger(index) && index >= 0 && index < list.length;
    if (inRange && list[index] === title) return index;
    if (title) {
      const byTitle = list.indexOf(title);
      if (byTitle !== -1) return byTitle;
    }
    return inRange ? index : -1;
  }

  // Export errors are objects ({type, ...}) in the Sources export and strings
  // ("[title] Failed to extract: ...") in the Notes export.
  const FAILED_TYPES = ['extraction_failed', 'extraction_error'];
  const FAILED_PHRASES = ['Failed to extract', 'Exception during extraction'];

  function countFailedExtractions(errors) {
    return (errors || []).filter(err => {
      if (typeof err === 'string') return FAILED_PHRASES.some(p => err.includes(p));
      return !!err && FAILED_TYPES.includes(err.type);
    }).length;
  }

  const ISSUES_URL = 'https://github.com/bearspear/notebooklm-takeout/issues';

  // Pick the More-menu item to download. Slide decks offer "Download PDF
  // Document (.pdf)" and "Download PowerPoint (.pptx)" (Nov 2026); other
  // types have a single "Download". -1 when the menu has no download item.
  function pickDownloadMenuIndex(labels, preference) {
    const lower = (labels || []).map(l => (l || '').toLowerCase());
    const candidates = lower.map((l, i) => (l.includes('download') ? i : -1)).filter(i => i !== -1);
    if (candidates.length === 0) return -1;
    const wanted = preference === 'pptx' ? ['powerpoint', '.pptx'] : preference === 'pdf' ? ['pdf'] : [];
    const preferred = candidates.find(i => wanted.some(w => lower[i].includes(w)));
    return preferred !== undefined ? preferred : candidates[0];
  }

  // Citation anchors are numbered while Turndown runs, but some rules convert
  // a subtree twice (the list rule re-runs Turndown on each <li>), which skips
  // numbers and breaks the Sources back-links to "-1". Renumber the finished
  // Markdown in document order, per anchor prefix and citation number.
  function renumberCitationAnchors(markdown) {
    const counts = new Map();
    return (markdown || '').replace(/<a id="([^"]*?)cite-ref-(\d+)-\d+"/g, (_m, prefix, number) => {
      const key = `${prefix}|${number}`;
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return `<a id="${prefix}cite-ref-${number}-${n}"`;
    });
  }

  // Classify a lone KaTeX sub/superscript. Its inline `top` is measured from
  // the top of a .pstrut spacer, so top + pstrut height is the shift from the
  // baseline: negative = raised (sup), positive = lowered (sub). E.g.
  // E = mc^2: -3.063 + 2.7 < 0; DM_{total}: -2.55 + 2.7 > 0. Without a
  // pstrut, KaTeX's .vlist-t2 (content below the baseline) marks a subscript.
  function classifyKatexScript({ top, pstrutHeight, hasDepth } = {}) {
    if (Number.isFinite(top) && Number.isFinite(pstrutHeight)) {
      return top + pstrutHeight < 0 ? 'sup' : 'sub';
    }
    return hasDepth ? 'sub' : 'sup';
  }

  // Formula source for Markdown. Gemini Notebook keeps the model's original
  // LaTeX on the KaTeX host span as data-math (Nov 2026); KaTeX's own
  // annotation is the next best. Both are exact, unlike rebuilding the
  // formula from the rendered layout. null when neither is present.
  function mathSourceToMarkdown({ dataMath, annotation, display = false } = {}) {
    const tex = [dataMath, annotation].map(s => (s || '').trim()).find(s => s.length > 0);
    if (!tex) return null;
    const delim = display ? '$$' : '$';
    return `${delim}${tex}${delim}`;
  }

  // Health of formula export: formulas without a LaTeX source (data-math or
  // annotation) are rebuilt from the rendered layout, which can be inexact.
  function mathSourceHealth({ total = 0, withSource = 0 } = {}) {
    if (total === 0) {
      return { passed: true, note: 'No formulas on this page (open a chat or note with math to verify)' };
    }
    if (withSource >= total) {
      return { passed: true, note: `${withSource}/${total} formulas carry LaTeX source (exported exactly)` };
    }
    const missing = total - withSource;
    return {
      passed: false,
      note: `${missing} of ${total} formulas have no LaTeX source; they will be rebuilt from the rendered layout and may be inexact`
    };
  }

  // Strip OCR noise (~~~, :~:, =~, ;!) from citation quotes without flattening
  // their structure: only horizontal whitespace is collapsed, fenced code is
  // left alone and ~~strikethrough~~ spans are kept.
  function cleanOcrSegment(text) {
    const kept = [];
    const protectedText = text.replace(/~~([^~\n]+?)~~/g, (m) => {
      kept.push(m);
      return `\u0000${kept.length - 1}\u0000`;
    });
    return protectedText
      .replace(/~{3,}/g, '')
      .replace(/[:;]+~+[:;]*/g, '')
      .replace(/~+[:;]+~*/g, '')
      .replace(/[=]+~+/g, '')
      .replace(/~+[=]+/g, '')
      .replace(/[;!]{2,}/g, '')
      .replace(/[;!]~+[;!]*/g, '')
      .replace(/~([a-zA-ZäöüÄÖÜß])~/g, '$1')
      .replace(/~+([ \t\n])/g, '$1')
      .replace(/([ \t\n])~+/g, '$1')
      .replace(/([a-zA-ZäöüÄÖÜß])~([a-zA-ZäöüÄÖÜß])/g, '$1$2')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([.,;:!?])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]);
  }

  function cleanOcrArtifacts(text) {
    if (!text) return '';
    return text
      .split(/(```[\s\S]*?```)/)
      .map((part, i) => (i % 2 === 1 ? part : cleanOcrSegment(part)))
      .join('')
      .trim();
  }

  // Per-phase export timing. Phases may repeat (one per note/citation); totals
  // can be merged across contexts (content-script responses into the sidebar).
  function createPhaseTimer(now = () => (globalThis.performance ? globalThis.performance.now() : Date.now())) {
    const totals = {};
    const open = {};
    const add = (phase, count, ms) => {
      const t = totals[phase] || (totals[phase] = { count: 0, ms: 0 });
      t.count += count;
      t.ms += ms;
    };
    return {
      start(phase) { open[phase] = now(); },
      end(phase) {
        if (open[phase] === undefined) return;
        add(phase, 1, now() - open[phase]);
        delete open[phase];
      },
      totals() {
        const copy = {};
        for (const [k, v] of Object.entries(totals)) copy[k] = { count: v.count, ms: Math.round(v.ms) };
        return copy;
      },
      merge(other) {
        for (const [k, v] of Object.entries(other || {})) add(k, v.count || 0, v.ms || 0);
      }
    };
  }

  function formatDuration(ms) {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)} s`;
    const m = Math.floor(s / 60);
    return `${m} m ${Math.round(s - m * 60)} s`;
  }

  function formatTimingSummary(totals, wallMs) {
    const lines = ['## Export statistics', ''];
    for (const [phase, t] of Object.entries(totals || {})) {
      const avg = t.count ? (t.ms / t.count / 1000).toFixed(2) : '0.00';
      lines.push(`- ${phase}: ${t.count} × ${avg} s avg (${formatDuration(t.ms)})`);
    }
    lines.push(`- Total: ${formatDuration(wallMs || 0)}`);
    return lines.join('\n') + '\n';
  }

  // One export/scan/download job at a time in the side panel.
  function createJobLock() {
    let owner = null;
    return {
      tryAcquire(name) {
        if (owner !== null) return false;
        owner = name;
        return true;
      },
      release(name) {
        if (owner === name) owner = null;
      },
      current() { return owner; }
    };
  }

  // One truthful end-of-export message for notes, sources, chat and artifacts.
  function summarizeExportOutcome({ kind, selected = 0, exported = 0, failed = 0, cancelled = false } = {}) {
    if (cancelled) {
      return { level: 'warning', message: `Cancelled: exported ${exported} of ${selected} ${kind}`, partial: true };
    }
    if (exported === 0 && selected > 0) {
      return { level: 'error', message: `No ${kind} exported (${failed} failed, see errors.md)`, partial: false };
    }
    if (failed > 0) {
      return { level: 'warning', message: `Exported ${exported} of ${selected} ${kind} (${failed} failed, see errors.md)`, partial: false };
    }
    return { level: 'success', message: `Exported ${exported} of ${selected} ${kind}`, partial: false };
  }

  // The end-of-export message and level: the outcome text, the errorNote in
  // brackets (not on a cancelled run), then the audit note. Each note on top
  // of the outcome is at least a warning.
  function composeOutcome({ kind, selected, result = {}, auditOk = true, errorNote } = {}) {
    const outcome = summarizeExportOutcome({
      kind,
      selected,
      exported: result.exported,
      failed: result.failed,
      cancelled: result.cancelled
    });
    let message = outcome.message;
    let level = outcome.level;
    const note = text => {
      message += text;
      if (level !== 'error') level = 'warning';
    };
    if (errorNote && !result.cancelled) note(` (${errorNote})`);
    if (!auditOk) note(' \u2014 some content is missing, see _audit.md');
    return { message, level };
  }

  // Full Takeout's "Retry N failed" runs one export per category (Sources,
  // Notes, Artifacts) and ends in ONE results panel. steps: each retried
  // category's outcome { name, message, level, saved, errors, failedItems };
  // notRun: categories a cancel or a declined dialog kept from running
  // { name, failedItems } (their items still failed). Returns the panel's
  // content: one line per category, the worst level, every ZIP, every error
  // prefixed with its category, and what a further Retry would re-run.
  function combineRetryOutcomes({ steps = [], notRun = [] } = {}) {
    const rank = { success: 0, info: 0, warning: 1, error: 2 };
    let level = 'success';
    for (const s of steps) if ((rank[s.level] || 0) > rank[level]) level = s.level;
    if (notRun.length && level === 'success') level = 'warning';

    const remaining = {};
    for (const s of steps) remaining[s.name] = s.failedItems || [];
    for (const n of notRun) remaining[n.name] = n.failedItems || [];
    const remainingCount = Object.values(remaining).reduce((sum, list) => sum + list.length, 0);

    let message = notRun.length
      ? `Retry stopped before ${notRun.map(n => n.name.toLowerCase()).join(' and ')}`
      : 'Retry finished';
    if (remainingCount > 0) message += ` \u2014 ${remainingCount} still failed`;

    return {
      message,
      level,
      lines: steps.map(s => `${s.name}: ${s.message}`),
      saved: steps.flatMap(s => s.saved || []),
      errors: steps.flatMap(s => prefixExportErrors(s.name, s.errors)),
      remaining,
      remainingCount
    };
  }

  // The results panel's error list: groups by error type in first-seen
  // order, at most perGroup entries each; `more` entries are in errors.md.
  function groupErrorsForPanel(errors = [], { perGroup = 20 } = {}) {
    const groups = new Map();
    for (const raw of errors || []) {
      const e = normalizeExportError(raw);
      if (!groups.has(e.type)) groups.set(e.type, []);
      groups.get(e.type).push({ item: e.item, message: e.message });
    }
    return [...groups].map(([type, list]) => {
      const words = type.replace(/_/g, ' ');
      return {
        heading: words.charAt(0).toUpperCase() + words.slice(1),
        count: list.length,
        entries: list.slice(0, perGroup),
        more: Math.max(0, list.length - perGroup)
      };
    });
  }

  // Gemini Notebook's own download links (More → Download opens one via
  // window.open). Hostname-based, so lookalike query strings don't match.
  function isNotebookDownloadUrl(url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    const host = u.hostname;
    if (host === 'contribution.usercontent.google.com') return true;
    if (host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com')) {
      const path = u.pathname.toLowerCase();
      return path.includes('notebook') || path.startsWith('/download') || host.includes('notebook');
    }
    return false;
  }

  // The page-world download hook intercepts only right after the extension's
  // own Download click (armed via a DOM event), never the user's own clicks.
  function createInterceptArm(windowMs = 3000) {
    let armedAt = null;
    return {
      arm(now) { armedAt = now; },
      shouldIntercept(url, now) {
        if (armedAt === null) return false;
        if (now - armedAt > windowMs) { armedAt = null; return false; }
        if (!isNotebookDownloadUrl(url)) return false;
        armedAt = null; // consumed by the first match
        return true;
      }
    };
  }

  // Title comparison for identity checks: whitespace- and ellipsis-tolerant,
  // and a title truncated with an ellipsis matches its full form.
  function normalizeTitle(t) {
    return (t || '').replace(/\u2026/g, '...').replace(/\s+/g, ' ').trim();
  }

  function titlesMatch(a, b) {
    const x = normalizeTitle(a);
    const y = normalizeTitle(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const prefixMatch = (short, full) => {
      if (!short.endsWith('...')) return false;
      const stem = short.slice(0, -3).trim();
      return stem.length > 0 && full.startsWith(stem);
    };
    return prefixMatch(x, y) || prefixMatch(y, x);
  }

  // Like pickByIndexThenTitle, but never falls back to an index whose title
  // differs: the item the user picked must still be the item we open.
  function pickByIndexThenTitleStrict(titles, index, title) {
    const list = titles || [];
    const inRange = Number.isInteger(index) && index >= 0 && index < list.length;
    if (!normalizeTitle(title)) {
      if (inRange) return index;
      throw new Error(`Item changed: index ${index} is out of range`);
    }
    if (inRange && titlesMatch(list[index], title)) return index;
    const byTitle = list.findIndex(t => titlesMatch(t, title));
    if (byTitle !== -1) return byTitle;
    throw new Error(`Item changed: expected "${title}"`);
  }

  // Newest intercepted download URL captured at or after the click.
  function pickFreshIntercept(entries, since) {
    const fresh = (entries || []).filter(e => e && e.url && e.timestamp >= since);
    if (fresh.length === 0) return null;
    return fresh.reduce((a, b) => (b.timestamp >= a.timestamp ? b : a)).url;
  }


  // Gemini Notebook download URLs name the real file (filename=Deck.pptx);
  // the extension from there beats guessing from MIME type or artifact type.
  function extensionFromDownloadUrl(url) {
    let u;
    try { u = new URL(url); } catch { return ''; }
    const name = u.searchParams.get('filename') || u.searchParams.get('name') || '';
    const m = name.match(/\.([a-z0-9]{2,5})$/i);
    return m ? `.${m[1].toLowerCase()}` : '';
  }

  // "<Notebook>/<file>" for chrome.downloads, which saves into subfolders of
  // Downloads. Folder names drop characters filesystems reject.
  function downloadFolderPath(folder, filename) {
    const clean = (folder || '')
      .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80)
      .trim();
    return clean ? `${clean}/${filename}` : filename;
  }

  // MIME type by file extension. Chrome sniffs an untyped blob download as
  // text/plain and swaps the suggested extension for .txt, so saved blobs
  // need a real type.
  function mimeForPath(path) {
    const m = /\.([^./\\]+)$/.exec(String(path || ''));
    const types = {
      md: 'text/markdown',
      json: 'application/json',
      csv: 'text/csv',
      html: 'text/html',
      svg: 'image/svg+xml',
      txt: 'text/plain'
    };
    return (m && types[m[1].toLowerCase()]) || 'application/octet-stream';
  }

  // Content is "ready" once its size stops changing: the last `checks`
  // samples are equal and at least `minLength`. Replaces fixed sleeps.
  function createStabilityTracker({ checks = 2, minLength = 1 } = {}) {
    const recent = [];
    return {
      push(length) {
        recent.push(length);
        if (recent.length > checks) recent.shift();
        return recent.length === checks && length >= minLength && recent.every(v => v === length);
      }
    };
  }

  // errors.md line for a cancelled run; it also forces the ZIP (and so the
  // -PARTIAL name) for exports that otherwise write a single file.
  function cancellationNote({ kind, done = 0, total = 0 } = {}) {
    // Sources have no citation markers; notes and chat messages do
    const last = kind === 'sources' ? '' : 'the last one may have incomplete citations and ';
    return `Cancelled by user after ${done} of ${total} ${kind}; ${last}the rest were not exported`;
  }

  // Version names actually written (from index entries with a `variant`),
  // first-seen order, so README and _index count real files, not settings
  function distinctVariants(files) {
    return [...new Set((files || []).map(f => f.variant))];
  }

  // Exports collect errors as strings ("[Title] message", cancellation
  // notes) and as objects ({source|userQuestion|title, type, message|error,
  // stack|url}). Normalise both before building any report.
  function normalizeExportError(err) {
    if (typeof err === 'string') {
      if (err.startsWith('Cancelled by user after')) {
        return { type: 'cancelled', item: '', message: err, detail: '' };
      }
      const m = err.match(/^\[([^\]]*)\]\s*(.*)$/s);
      return m
        ? { type: 'error', item: m[1], message: m[2], detail: '' }
        : { type: 'error', item: '', message: err, detail: '' };
    }
    const e = err || {};
    return {
      type: e.type || 'error',
      item: String(e.source || e.userQuestion || e.title || ''),
      message: String(e.message || e.error || ''),
      detail: String(e.stack || e.url || '')
    };
  }

  // A Full Takeout's errors.md holds every category's errors: each keeps its
  // type and gets its category in front ("Notes: <item>: <message>").
  function prefixExportErrors(category, errors = []) {
    return (errors || []).map(raw => {
      const e = normalizeExportError(raw);
      return { type: e.type, title: e.item ? `${category}: ${e.item}` : category, message: e.message, stack: e.detail };
    });
  }

  // One errors.md format for notes, sources, chat and Download All.
  function buildErrorReport({ title = 'Export', generatedAt = '', errors = [], stats = {} } = {}) {
    const lines = [`# ${title} Error Report`, ''];
    if (generatedAt) lines.push(`Generated: ${generatedAt}`, '');
    const statEntries = Object.entries(stats || {});
    if (statEntries.length > 0) {
      lines.push('## Summary', '');
      for (const [key, value] of statEntries) lines.push(`- ${key}: ${value}`);
      lines.push('');
    }
    lines.push(`Errors: ${errors.length}`, '');
    const groups = new Map();
    for (const raw of errors) {
      const e = normalizeExportError(raw);
      if (!groups.has(e.type)) groups.set(e.type, []);
      groups.get(e.type).push(e);
    }
    for (const [type, list] of groups) {
      lines.push(`## ${type.replace(/_/g, ' ').toUpperCase()} (${list.length})`, '');
      for (const e of list) {
        lines.push(e.item ? `- ${e.item}: ${e.message}` : `- ${e.message}`);
        if (e.detail) lines.push(`  ${e.detail.split('\n')[0]}`);
      }
      lines.push('');
    }
    lines.push(`Report issues: ${ISSUES_URL}`);
    return lines.join('\n') + '\n';
  }

  // ---- Shared helpers (one copy for content, sidebar, background) ----

  const NOTEBOOK_HOSTS = ['notebook.google.com', 'notebooklm.google.com'];

  // Exact hostname match; substring checks also accepted e.g. a Google search
  // URL containing "notebook.google.com"
  function isNotebookUrl(url) {
    try {
      return NOTEBOOK_HOSTS.includes(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  // File-system-safe name: the historic replacement chain, plus control
  // characters stripped, code-point truncation (never splits an emoji),
  // no trailing dots/spaces, and Windows reserved names prefixed.
  function sanitizeFilename(name, maxLength = 100) {
    let clean = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[\u0027\u0060\u00B4\u2018\u2019\u0022\u201C\u201D]/g, '')
      .replace(/[#%&{}$!@+]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, '-')
      .replace(/[-_]+/g, '-')
      .replace(/^-+|-+$/g, '');
    clean = Array.from(clean).slice(0, maxLength).join('');
    clean = clean.replace(/[.\s-]+$/g, '');
    if (!clean) return 'untitled';
    if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`;
    return clean;
  }

  const ARTIFACT_PREFIXES = {
    'Audio Overview': 'audio-overview',
    'Data Table': 'data-table',
    'Report': 'report',
    'Infographic': 'infographic',
    'Slides': 'slides',
    'Video Overview': 'video-overview',
    'Mind Map': 'mind-map'
  };

  function artifactTypePrefix(type) {
    return ARTIFACT_PREFIXES[type] || String(type || 'artifact').toLowerCase().replace(/\s+/g, '-');
  }

  // One ZIP for a single Data Table or mind map download, as before
  // Milestone 3a: { zipName, entries } with the inner files renamed, or null
  // when the artifact stays loose (other types, or a lone file).
  function singleArtifactPackage({ type, title, files }) {
    if ((type !== 'Data Table' && type !== 'Mind Map') || !files || files.length < 2) return null;
    const clean = sanitizeFilename(title);
    const isTable = type === 'Data Table';
    const base = isTable ? clean : `[MINDMAP]_${clean}`;
    const entries = files.map(file => {
      const path = String(file.path || '');
      if (isTable && /-references\.txt$/i.test(path)) return { ...file, path: 'references.txt' };
      const ext = (path.match(/\.[^./\\]+$/) || [''])[0];
      return { ...file, path: `${base}${ext}` };
    });
    return { zipName: `${isTable ? `[${artifactTypePrefix(type)}]_${clean}` : base}.zip`, entries };
  }

  // 'YYYY-MM-DDTHH-MM-SS' (UTC) for export file names
  function exportTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Notebook title in the page header, most specific first (one chain for
  // file names, chat export and the health check)
  const PROJECT_TITLE_SELECTORS = [
    '.title-label-inner',
    'editable-project-title .title-label span',
    '.title-container .title span',
    '[class*="title-label"]',
    '.notebook-title'
  ];

  // Hosts Gemini Notebook serves downloads from. URLs posted from the page or
  // seen by the downloads listeners are trusted only if they match.
  function isAllowedDownloadUrl(url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    const host = u.hostname;
    return host === 'contribution.usercontent.google.com' ||
      host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
  }

  // A download Gemini Notebook started: an allowed host, and (when Chrome
  // knows it) a notebook page as referrer. Downloads from other tabs, e.g.
  // Drive, are left alone.
  function isNotebookDownload({ url, finalUrl, referrer } = {}) {
    if (!isAllowedDownloadUrl(url) && !isAllowedDownloadUrl(finalUrl)) return false;
    return !referrer || isNotebookUrl(referrer);
  }

  // Which Markdown variants to write per note/chat. Base is always written;
  // a variant that would be byte-identical to base is skipped: code blocks
  // need quotes, with-images needs images. (Code blocks + images was dropped:
  // images inside a fence never render.)
  function noteVariants(settings = {}, { hasQuotes = false, hasImages = false } = {}) {
    const variants = [{ suffix: '', codeBlocks: false, images: false }];
    if (settings.exportNoteCodeBlocks && hasQuotes) variants.push({ suffix: '-code-blocks', codeBlocks: true, images: false });
    if (settings.exportNoteWithImages && hasImages) variants.push({ suffix: '-with-images', codeBlocks: false, images: true });
    return variants;
  }

  // Source variants: base always; metadata versions when enabled; image
  // versions only when the source actually has images.
  function sourceVariants(settings = {}, { hasImages = false } = {}) {
    const variants = [{ suffix: '', meta: false, images: false }];
    if (settings.exportSourcePlusMeta) variants.push({ suffix: '-plus-meta', meta: true, images: false });
    if (settings.exportSourceWithImages && hasImages) variants.push({ suffix: '-with-images', meta: false, images: true });
    if (settings.exportSourcePlusMetaWithImages && hasImages) variants.push({ suffix: '-plus-meta-with-images', meta: true, images: true });
    return variants;
  }

  // Settings for a Full Takeout's notes, sources and chat: a takeout always
  // writes the with-images versions (for items that have images), whatever
  // the user ticked for tab exports. The input is not changed.
  function takeoutVariantSettings(settings = {}) {
    return { ...settings, exportNoteWithImages: true, exportSourceWithImages: true };
  }

  // A code fence the quote cannot close early: longer than its longest
  // backtick run, at least three.
  function fenceFor(text) {
    const runs = String(text || '').match(/`+/g) || [];
    const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
    return '`'.repeat(Math.max(3, longest + 1));
  }

  // Quote as a Markdown blockquote, keeping its own Markdown (lists,
  // emphasis, tables) intact instead of escaping it.
  function toBlockquote(text) {
    return String(text || '').split('\n').map(line => (line.trim() ? `> ${line}` : '>')).join('\n');
  }

  // Source title from a citation marker's aria-label ("3: Title"); markers
  // without one become "Source N" (titles-only mode, report Sources)
  function citationTitleFromAriaLabel(label, number) {
    const title = String(label || '').replace(/^\s*\d+\s*:\s*/, '').trim();
    return title || `Source ${number}`;
  }

  // Encode each path segment separately; a lone surrogate (from a cut emoji)
  // would make encodeURI throw, so it is replaced first.
  function encodePath(path) {
    return String(path || '').split('/').map(seg => {
      const safe = seg.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');
      return encodeURIComponent(safe).replace(/%28/g, '(').replace(/%29/g, ')');
    }).join('/');
  }

  // Sources _index.md from the files actually written, in export order, so
  // two same-titled sources each link to their own file
  function buildSourcesIndex(entries) {
    const lines = [];
    (entries || []).forEach((entry, i) => {
      lines.push(`### ${i + 1}. ${entry.title}`, '');
      if (entry.details) lines.push(entry.details.trimEnd(), '');
      if ((entry.files || []).length > 0) {
        lines.push('**Files:**', '');
        for (const file of entry.files) lines.push(`- [${file.label}](${encodePath(file.path)})`);
        lines.push('');
      }
    });
    return lines.join('\n');
  }

  // Compare what an export wrote with what the page showed. ok is false when
  // anything came out short; each key gets one "written of expected" line.
  function auditExport({ expected = {}, written = {} } = {}) {
    let ok = true;
    const lines = Object.keys(expected).map(key => {
      const want = expected[key] || 0;
      const got = written[key] || 0;
      const short = got < want;
      if (short) ok = false;
      return `- ${short ? '⚠️ ' : ''}${key}: ${got} of ${want}`;
    });
    return { ok, lines };
  }

  // Studio icons the extension cannot classify (new artifact types appear
  // this way first); notes' icons count as known
  function unknownStudioIcons(iconTexts) {
    const unknown = new Set();
    for (const raw of iconTexts || []) {
      const icon = String(raw || '').trim();
      if (icon && !ICON_TO_TYPE[icon] && !NOTE_ICONS.includes(icon)) unknown.add(icon);
    }
    return [...unknown];
  }

  // A note has images if its body or any citation quote does (citation
  // images are embedded in the quotes, not the body)
  function noteHasImages({ html = '', sources = [] } = {}) {
    if (/<img\b/i.test(html || '')) return true;
    return (sources || []).some(src => /!\[/.test((src && src.quote) || ''));
  }

  // Formulas in final Markdown ($$...$$ and $...$), each counted once,
  // however many times the converter ran on nested lists or tables
  function countMarkdownFormulas(markdown) {
    const re = /\$\$[\s\S]+?\$\$|(?<![\\$\w])\$(?!\s)[^$\n]+?(?<!\s)\$(?![\w$])/g;
    return (String(markdown || '').match(re) || []).length;
  }

  // Citation audit: distinct marker numbers on the page vs sources actually
  // read (with a quote when quotes were requested, else at least a title)
  function citationCoverage({ markerNumbers = [], sources = [], needQuotes = false } = {}) {
    const expected = new Set((markerNumbers || []).map(String)).size;
    const read = new Set((sources || [])
      .filter(src => src && (needQuotes ? (src.quote || '').trim() : ((src.text || '').trim() || (src.quote || '').trim())))
      .map(src => String(src.sourceIndex)));
    return { expected, written: read.size };
  }

  // Titles-only Sources sections: one line per source with all its citation
  // numbers (instead of 21 lines repeating the same title). Entries are
  // {number, text}; order follows each source's first citation.
  function groupCitationEntries(entries) {
    const groups = new Map();
    for (const e of entries || []) {
      const key = (e.missing ? '\u0000missing:' : '') + (e.text || '');
      if (!groups.has(key)) groups.set(key, { text: e.text || '', numbers: [] });
      groups.get(key).numbers.push(String(e.number));
    }
    return [...groups.values()];
  }

  // YAML front matter for exported notes and sources. Strings go through
  // JSON.stringify, which yields a valid double-quoted YAML scalar, so a title
  // with colons, quotes or newlines cannot break the block. Empty values are
  // dropped; with nothing left there is no front matter at all.
  function frontMatter(fields = {}) {
    const lines = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') continue;
      lines.push(`${key}: ${typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)}`);
    }
    return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
  }

  // The one naming scheme for notes, sources, mind maps and artifacts:
  // sanitized titles, repeats (case-insensitive, since macOS and Windows
  // folders are) get -2, -3... `suffixes` are the variant suffixes written
  // next to each stem ('-code-blocks'): a stem is taken only if none of its
  // stem+suffix names is already in use, so "Diagram with images" cannot
  // overwrite the -with-images variant of "Diagram".
  // `reserved` names (package files that share the folder, such as
  // 'errors' or '_index' when the items sit next to them) are never handed out.
  // Names compare after NFC normalization.
  function uniqueStems(titles, suffixes = [], reserved = []) {
    // Names compare as NFC, lower-cased: "Café" typed as e + combining accent
    // and as the single é look identical and collide on a macOS disk
    const fold = name => String(name).normalize('NFC').toLowerCase();
    const used = new Set((reserved || []).map(fold));
    const endings = ['', ...suffixes];
    const names = candidate => endings.map(s => fold(candidate + s));
    return (titles || []).map(title => {
      const base = sanitizeFilename(title);
      let candidate = base;
      for (let n = 2; names(candidate).some(name => used.has(name)); n++) candidate = `${base}-${n}`;
      names(candidate).forEach(name => used.add(name));
      return candidate;
    });
  }

  // The notebook's UUID from its URL, for the manifest and front matter.
  function notebookIdFromUrl(url) {
    const m = String(url || '').match(/\/notebook\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  // ---- List view helpers (filter / sort / select toolbar) ----

  const LIST_SORTS = ['notebook', 'title', 'type'];

  function foldForSearch(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // Stable per-item keys: "<type>\0<title>", the nth duplicate gets "#n" appended.
  function listItemKeys(items, { titleOf, typeOf } = {}) {
    const seen = new Map();
    return (items || []).map(item => {
      const base = `${typeOf(item)}\u0000${titleOf(item)}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n >= 2 ? `${base}#${n}` : base;
    });
  }

  // Visible indices (filtered and sorted) plus the type chips of the whole list.
  function listView(items, { query = '', types = [], sort = 'notebook' } = {}, { titleOf, typeOf } = {}) {
    const list = items || [];
    const typeCounts = new Map();
    list.forEach(item => {
      const t = typeOf(item);
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    });
    const typeOrder = [...typeCounts.keys()];
    const chips = typeOrder.map(type => ({ type, count: typeCounts.get(type) }));

    const words = foldForSearch(query).split(/\s+/).filter(Boolean);
    const wanted = Array.isArray(types) && types.length ? new Set(types) : null;
    let indices = [];
    list.forEach((item, i) => {
      const type = typeOf(item);
      if (wanted && !wanted.has(type)) return;
      if (words.length) {
        const hay = `${foldForSearch(titleOf(item))} ${foldForSearch(type)}`;
        if (!words.every(w => hay.includes(w))) return;
      }
      indices.push(i);
    });

    if (sort === 'title') {
      const titles = list.map(item => String(titleOf(item) == null ? '' : titleOf(item)));
      indices = indices.slice().sort((a, b) =>
        titles[a].localeCompare(titles[b], undefined, { numeric: true, sensitivity: 'base' }) || a - b);
    } else if (sort === 'type') {
      indices = indices.slice().sort((a, b) =>
        typeOrder.indexOf(typeOf(list[a])) - typeOrder.indexOf(typeOf(list[b])) || a - b);
    }
    return { indices, types: chips };
  }

  // Keeps only the selected keys that are still visible.
  function pruneSelection(selectedKeys, visibleKeys) {
    const visible = new Set(visibleKeys || []);
    return new Set([...(selectedKeys || [])].filter(k => visible.has(k)));
  }

  function listSummary({ shown, total, selected } = {}) {
    return `${shown} of ${total} shown · ${selected} selected`;
  }

  function listStateKey(notebookId, tab) {
    return `nlme.list.${notebookId}.${tab}`;
  }

  // Rebuilds a list's toolbar state from storage, tolerating missing or malformed data.
  // saved: { query, types, sort, selected, known? } (see sidebar-list.js savedShape).
  function restoreListState(saved, { keys = [], types = null, defaultSelected } = {}) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const query = typeof s.query === 'string' ? s.query : '';
    const sort = LIST_SORTS.includes(s.sort) ? s.sort : 'notebook';
    let chips = Array.isArray(s.types) ? s.types.filter(t => typeof t === 'string') : [];
    if (Array.isArray(types)) chips = chips.filter(t => types.includes(t));
    const keySet = new Set(keys);
    let selected;
    if (Array.isArray(s.selected)) {
      selected = new Set(s.selected.filter(k => keySet.has(k)));
      // `known`: the keys that existed at save time. An item that arrived since
      // (a new source, a newly generated artifact) gets the tab default, so a
      // remembered selection does not leave it unticked forever. A state saved
      // without `known` stays a plain allow-list.
      if (Array.isArray(s.known) && defaultSelected === 'all') {
        const known = new Set(s.known);
        for (const k of keys) if (!known.has(k)) selected.add(k);
      }
    } else selected = new Set(defaultSelected === 'all' ? keys : []);
    return { query, types: chips, sort, selected };
  }

  // Notebook-level metadata shared by every front matter block and the manifest.
  function exportMeta({ notebookTitle, tabUrl, version, exportedAt } = {}) {
    return {
      notebook: notebookTitle,
      notebook_url: isNotebookUrl(tabUrl) ? tabUrl : '',
      notebook_id: notebookIdFromUrl(tabUrl),
      exporter: `NotebookLM Takeout ${version}`,
      exported: exportedAt.toISOString()
    };
  }

  function byteLength(entry) {
    const data = entry.data;
    if (typeof data === 'string') return new TextEncoder().encode(data).length;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
    if (data && typeof data.byteLength === 'number') return data.byteLength;
    return null;
  }

  // manifest.json: what is in a ZIP, so a takeout can be audited or resumed
  // without opening every file. Entries with a url were not fetched (bytes
  // null). manifest.json does not list itself.
  function buildManifest({ meta, kind, part = 1, totalParts = 1, partial = false, files = [], counts = {}, errorCount = 0 } = {}) {
    return {
      exporter: meta.exporter,
      exported: meta.exported,
      notebook: { title: meta.notebook, url: meta.notebook_url, id: meta.notebook_id },
      kind,
      part,
      totalParts,
      partial,
      counts,
      errorCount,
      files: files.map(f => {
        const entry = { path: f.path, bytes: byteLength(f) };
        for (const key of ['title', 'variant', 'itemKind']) {
          if (f[key] !== undefined) entry[key] = f[key];
        }
        return entry;
      })
    };
  }

  // ZIP file name: "<Notebook>-<kind>-<timestamp>[-PARTIAL][-partNofM].zip".
  // totalParts null means the total is unknown (size-split parts): "-partN".
  function zipName({ notebook, kind, timestamp, partial = false, part = 1, totalParts = 1 } = {}) {
    const suffix = totalParts === null ? `-part${part}` : totalParts > 1 ? `-part${part}of${totalParts}` : '';
    return `${sanitizeFilename(notebook)}-${kind}-${timestamp}${partial ? '-PARTIAL' : ''}${suffix}.zip`;
  }

  // Approximate bytes of the data held by a list of file entries (Blob,
  // ArrayBuffer, typed array, string); url entries carry no data and count 0.
  function filesByteSize(files) {
    let total = 0;
    for (const f of files || []) {
      const d = f && f.data;
      if (d == null) continue;
      if (typeof d === 'string') total += d.length;
      else if (typeof d.size === 'number') total += d.size;
      else if (typeof d.byteLength === 'number') total += d.byteLength;
    }
    return total;
  }

  const ARTIFACT_FOLDERS = {
    'Audio Overview': 'audio',
    'Video Overview': 'video',
    'Slides': 'slides',
    'Infographic': 'infographics',
    'Report': 'reports',
    'Data Table': 'tables',
    'Mind Map': 'mind-maps'
  };

  // Top-level ZIP folder for an artifact type.
  function artifactFolder(type) {
    return ARTIFACT_FOLDERS[type] || artifactTypePrefix(type);
  }

  const MIME_EXTENSIONS = {
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'text/csv': '.csv',
    'text/markdown': '.md',
    'text/plain': '.txt',
    'application/json': '.json',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx'
  };
  const TYPE_EXTENSIONS = {
    'Slides': '.pdf',
    'Infographic': '.png',
    'Audio Overview': '.m4a',
    'Video Overview': '.mp4'
  };

  // File extension for a downloaded artifact: the real file name in the URL
  // wins, then a known extension on the URL's path, then the MIME type, then any
  // other extension on the path (so a real .jpeg beats the type guess, but a
  // stray .php does not beat a correct MIME), then what the artifact type
  // usually is.
  // `format` ('pdf'|'pptx') is the Slides format that was asked for: the
  // last-resort guess, so a PDF and a PowerPoint of one deck never share a name.
  function extensionFor({ url = '', mime = '', type = '', format = null } = {}) {
    const baseMime = String(mime || '').split(';')[0].trim().toLowerCase();
    const typeGuess = type === 'Slides' && format === 'pptx' ? '.pptx' : TYPE_EXTENSIONS[type];
    const pathExt = extensionFromUrlPath(url);
    return extensionFromDownloadUrl(url) || (KNOWN_EXTENSIONS.has(pathExt) ? pathExt : '') ||
      MIME_EXTENSIONS[baseMime] || pathExt || typeGuess || '';
  }

  // The extension of the URL's path (".jpeg" for https://x/y/photo.JPEG?w=1),
  // lower-cased, '' when the last segment has none. extensionFor's
  // fallback for extensions no list knows.
  function extensionFromUrlPath(url) {
    let u;
    try { u = new URL(url); } catch { return ''; }
    const m = u.pathname.split('/').pop().match(/(\.[a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : '';
  }

  // The Slides download formats to fetch for an artifact type: both for a
  // Full Takeout, else the one preferred format. [null] = no format choice.
  function slideFormatsFor(type, { both = false, preferred = 'pdf' } = {}) {
    if (type !== 'Slides') return [null];
    return both ? ['pdf', 'pptx'] : [preferred === 'pptx' ? 'pptx' : 'pdf'];
  }

  // Everything extensionFor can return
  const KNOWN_EXTENSIONS = new Set([...Object.values(MIME_EXTENSIONS), ...Object.values(TYPE_EXTENSIONS)]);

  // A URL download's name with its real extension. The side panel names it
  // with the extension it expects (extensionFor: URL, then type); when the
  // download turns out to be another known type (Slides as .pptx, not .pdf),
  // the real extension replaces the expected one. A name without an
  // extension gets the real one; unknown extensions never replace anything.
  function withRealExtension(filename, realExt) {
    const real = String(realExt || '').toLowerCase();
    const current = (filename.match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
    if (!current) return filename + real;
    if (!KNOWN_EXTENSIONS.has(real) || !KNOWN_EXTENSIONS.has(current.toLowerCase())) return filename;
    return filename.slice(0, -current.length) + real;
  }

  // One stem per Studio artifact (aligned with items), unique within the
  // artifact's type folder: different types may share a name, since their
  // folders differ. Data Tables also write <stem>-references.txt.
  function artifactStems(items) {
    const stems = new Array(items.length);
    const byFolder = new Map();
    items.forEach((item, idx) => {
      const folder = artifactFolder(item.type);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(idx);
    });
    for (const idxs of byFolder.values()) {
      const suffixes = idxs.some(i => items[i].type === 'Data Table') ? ['-references'] : [];
      uniqueStems(idxs.map(i => items[i].label), suffixes).forEach((stem, k) => { stems[idxs[k]] = stem; });
    }
    return stems;
  }

  const TAKEOUT_STATUS_WORDS = {
    done: 'complete',
    partial: 'partial (cancelled)',
    skipped: 'skipped (cancelled earlier)',
    empty: 'none in notebook',
    // Full Takeout only: the notes job stopped itself (citations unreadable)
    // or the category's scan failed
    stopped: 'partial (stopped, see errors)',
    failed: 'failed (see errors)'
  };

  // A Full Takeout category's status after its runner: 'partial' (cancelled),
  // 'stopped' (the job stopped itself), 'failed' (nothing exported but items
  // failed or errors were recorded, e.g. chat messages that could not be
  // read), 'empty' (nothing to export, no errors), else 'done'. 'skipped'
  // and scan failures are decided by runFullTakeout itself.
  function takeoutCategoryStatus({ selected = 0, exported = 0, failed = 0, errorCount = 0, cancelled = false, stopped = false } = {}) {
    if (cancelled) return 'partial';
    if (stopped) return 'stopped';
    if (exported === 0 && (failed > 0 || errorCount > 0)) return 'failed';
    if (selected === 0) return 'empty';
    return 'done';
  }

  // A chat scan with nothing to export: no message pairs AND no message that
  // could not be read AND no citation group left collapsed. Otherwise the
  // chat job still runs, so those problems reach errors.md.
  function chatScanIsEmpty(chatData) {
    const stats = (chatData && chatData.stats) || {};
    return ((chatData && chatData.messagePairs) || []).length === 0 &&
      !((stats.skipped || []).length) && !(stats.collapsedRemaining > 0);
  }

  // How many messages a chat scan "selected": the pairs it could read, or the
  // messages the page showed when that is more (a chat of only unreadable
  // messages is "0 of 3", not "0 of 0")
  function chatSelectedCount(chatData) {
    const pairs = ((chatData && chatData.messagePairs) || []).length;
    return Math.max(pairs, (chatData && chatData.stats && chatData.stats.pairsInDom) || 0);
  }

  // Did a takeout category put anything on disk? Exported items, a ZIP, a part,
  // or a package (packages: an errors-only package counts, and so does a
  // folder-mode one, which has no ZIP name to show for it)
  function categoryWritten(c) {
    return c.exported > 0 || (c.zips || []).length > 0 || c.parts > 0 || c.packages > 0;
  }

  // _index.md at the root of a Full Takeout: one row per category (Sources,
  // Notes, Chat, Artifacts) with its counts, status and folder, the ZIPs each
  // category wrote, and a link to the combined errors.md.
  function buildRootIndex({ meta, categories = [], errorsFile = null } = {}) {
    let md = frontMatter({
      title: `Takeout — ${meta.notebook}`,
      notebook: meta.notebook,
      notebook_url: meta.notebook_url,
      notebook_id: meta.notebook_id,
      exporter: meta.exporter,
      exported: meta.exported,
      kind: 'takeout'
    });
    md += `# Takeout — ${meta.notebook}\n\n`;
    md += '| Category | Exported | Failed | Status | Folder |\n';
    md += '| --- | --- | --- | --- | --- |\n';
    for (const c of categories) {
      // Same rule as buildRootIndexHtml: nothing written (empty, skipped,
      // failed without a package) has no folder; a category written in
      // several batches lives in part-N/ folders
      let folder = '—';
      if (categoryWritten(c)) {
        if (c.parts > 1) folder = `${c.folder}/part-1/ … ${c.folder}/part-${c.parts}/`;
        else if (c.parts === 1) folder = `${c.folder}/part-1/`;
        else folder = `${c.folder}/`;
      }
      md += `| ${c.name} | ${c.exported} of ${c.selected} | ${c.failed} | ${TAKEOUT_STATUS_WORDS[c.status] || c.status} | ${folder} |\n`;
    }
    md += '\n';
    if (errorsFile) md += `Errors and notes from every category: [${errorsFile}](${encodePath(errorsFile)})\n\n`;
    const withZips = categories.filter(c => (c.zips || []).length > 0);
    if (withZips.length > 0) {
      md += 'Unzip every ZIP into the same folder to get one tree.\n\n';
      md += '## ZIPs\n\n';
      for (const c of withZips) {
        for (const zip of c.zips) md += `- ${c.name}: ${zip}\n`;
      }
      md += '\n';
    }
    return md;
  }

  // _index.html: the browsable twin of _index.md. A self-contained page
  // (inline CSS, no scripts or external resources, light and dark) with a
  // relative, encoded link to every file in the package.
  const INDEX_HTML_CSS = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1f2328; --muted: #656d76; --link: #0969da; --line: #d0d7de; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --link: #58a6ff; --line: #30363d; } }
body { font: 16px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); max-width: 56rem; margin: 0 auto; padding: 1rem 1.25rem 3rem; }
a { color: var(--link); }
h1 { margin-bottom: .25rem; }
h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid var(--line); padding-bottom: .25rem; }
.meta, .variant, footer { color: var(--muted); font-size: .9rem; }
.top { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; padding: 0; list-style: none; }
ul.files { padding-left: 1.25rem; }
.type { font-size: .75rem; color: var(--muted); border: 1px solid var(--line); border-radius: .75rem; padding: 0 .5rem; white-space: nowrap; }
table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid var(--line); }
footer { margin-top: 3rem; }
`;

  function indexHtmlShell({ meta, heading, body }) {
    const notebook = meta.notebook_url
      ? `<a href="${escapeHtml(meta.notebook_url)}">${escapeHtml(meta.notebook)}</a>`
      : escapeHtml(meta.notebook);
    const when = [meta.exporter, meta.exported].filter(Boolean).map(escapeHtml).join(' · ');
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      `<title>${escapeHtml(heading)}</title>\n<style>${INDEX_HTML_CSS}</style>\n</head>\n<body>\n` +
      `<h1>${escapeHtml(heading)}</h1>\n<p class="meta">Notebook: ${notebook}${when ? `<br>${when}` : ''}</p>\n` +
      body + '</body>\n</html>\n';
  }

  function indexHtmlLinks(links) {
    if (!links.length) return '';
    return '<ul class="top">' +
      links.map(l => `<li><a href="${encodePath(l.href)}">${escapeHtml(l.label)}</a></li>`).join('') +
      '</ul>\n';
  }

  const FILE_TYPE_LABELS = {
    md: 'Markdown', json: 'JSON', csv: 'CSV', html: 'HTML', svg: 'SVG image',
    png: 'Image', jpg: 'Image', jpeg: 'Image', webp: 'Image', pdf: 'PDF',
    pptx: 'PowerPoint', docx: 'Word', xlsx: 'Excel',
    m4a: 'Audio', mp3: 'Audio', wav: 'Audio', mp4: 'Video', webm: 'Video',
    txt: 'Text', zip: 'ZIP'
  };

  // "Markdown", "PDF", ... for a file path, from its extension.
  function fileTypeLabel(path) {
    const name = String(path || '').split('/').pop();
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return 'File';
    const ext = name.slice(dot + 1).toLowerCase();
    return FILE_TYPE_LABELS[ext] || ext.toUpperCase();
  }

  function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function buildIndexHtml({ meta, heading, files = [], links = [] } = {}) {
    const linked = new Set(links.map(l => l.href));
    const groups = new Map();
    for (const f of files) {
      if (!f || f.path === '_index.html' || f.path === 'manifest.json' || linked.has(f.path)) continue;
      const parts = String(f.path).split('/');
      const group = parts.length > 1 ? parts[0] : 'Files';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(f);
    }
    let body = indexHtmlLinks(links);
    for (const [group, list] of groups) {
      body += `<h2>${escapeHtml(group)}</h2>\n<ul class="files">\n`;
      for (const f of list) {
        const label = f.title || String(f.path).split('/').pop();
        const size = byteLength(f);
        const type = fileTypeLabel(f.path) + (size == null ? '' : ` · ${humanSize(size)}`);
        body += `<li><a href="${encodePath(f.path)}">${escapeHtml(label)}</a> <span class="type">${escapeHtml(type)}</span>` +
          (f.variant ? ` <span class="variant">${escapeHtml(f.variant)}</span>` : '') + '</li>\n';
      }
      body += '</ul>\n';
    }
    body += '<footer><a href="manifest.json">manifest.json</a></footer>\n';
    return indexHtmlShell({ meta, heading, body });
  }

  // Root _index.html of a Full Takeout. A category written in several
  // batches (c.parts >= 1; 0 = no part-N/ folders) links each part-N/ folder.
  function buildRootIndexHtml({ meta, categories = [], errorsFile = null } = {}) {
    let body = indexHtmlLinks([
      { href: '_index.md', label: 'Markdown index' },
      ...(errorsFile ? [{ href: errorsFile, label: 'Errors' }] : [])
    ]);
    body += '<table>\n<thead><tr><th>Category</th><th>Exported</th><th>Failed</th><th>Status</th><th>Folder</th></tr></thead>\n<tbody>\n';
    for (const c of categories) {
      let folder = '—';
      // Nothing written (empty, skipped, scan failed): no folder to link
      if (categoryWritten(c)) {
        const dir = encodePath(c.folder);
        folder = c.parts >= 1
          ? Array.from({ length: c.parts }, (_, i) => `<a href="${dir}/part-${i + 1}/_index.html">part-${i + 1}</a>`).join(' · ')
          : `<a href="${dir}/_index.html">${escapeHtml(c.folder)}/</a>`;
      }
      body += `<tr><td>${escapeHtml(c.name)}</td><td>${c.exported} of ${c.selected}</td><td>${c.failed}</td>` +
        `<td>${escapeHtml(TAKEOUT_STATUS_WORDS[c.status] || c.status)}</td><td>${folder}</td></tr>\n`;
    }
    body += '</tbody>\n</table>\n<footer><a href="manifest.json">manifest.json</a></footer>\n';
    return indexHtmlShell({ meta, heading: `Takeout — ${meta.notebook}`, body });
  }

  // The one toast after a Full Takeout: "Takeout: sources 12/12, notes 4/10
  // partial, chat skipped, artifacts none". Warning when any category failed
  // items, has errors, was cut short or skipped, or lost content (audit);
  // error when items existed but none was exported and nobody cancelled;
  // info for a notebook with nothing to export.
  function summarizeTakeoutOutcome({ categories = [], auditOk = true } = {}) {
    const part = c => {
      const name = c.name.toLowerCase();
      const count = `${c.exported}/${c.selected}`;
      switch (c.status) {
        case 'partial': return `${name} ${count} partial`;
        case 'stopped': return `${name} ${count} stopped`;
        case 'skipped': return `${name} skipped`;
        case 'empty': return `${name} none`;
        // Items found but none exported, or (0 items) the scan failed
        case 'failed': return c.selected ? `${name} ${count} failed` : `${name} failed`;
        default: return `${name} ${count}`;
      }
    };
    let message = `Takeout: ${categories.map(part).join(', ')}`;
    const hasErrors = categories.some(c => (c.errorCount || 0) > 0);
    if (hasErrors) message += ' (see errors.md)';
    if (!auditOk) message += ' — some content is missing, see _audit.md';

    const exported = categories.reduce((sum, c) => sum + (c.exported || 0), 0);
    const cancelled = categories.some(c => c.status === 'partial' || c.status === 'skipped');
    const hadWork = categories.some(c => c.status !== 'empty');
    let level = 'success';
    if (!hadWork) level = 'info';
    else if (exported === 0 && !cancelled) level = 'error';
    else if (hasErrors || !auditOk || categories.some(c => c.failed > 0 || !['done', 'empty'].includes(c.status))) level = 'warning';
    return { level, message };
  }

  const NLME = {
    buildRootIndex,
    buildIndexHtml,
    fileTypeLabel,
    buildRootIndexHtml,
    summarizeTakeoutOutcome,
    takeoutCategoryStatus,
    chatScanIsEmpty,
    chatSelectedCount,
    categoryWritten,
    frontMatter,
    uniqueStems,
    notebookIdFromUrl,
    listItemKeys,
    listView,
    pruneSelection,
    listSummary,
    listStateKey,
    restoreListState,
    exportMeta,
    buildManifest,
    zipName,
    filesByteSize,
    artifactFolder,
    extensionFor,
    slideFormatsFor,
    withRealExtension,
    artifactStems,
    groupCitationEntries,
    noteHasImages,
    countMarkdownFormulas,
    citationCoverage,
    unknownStudioIcons,
    auditExport,
    buildSourcesIndex,
    citationTitleFromAriaLabel,
    fenceFor,
    toBlockquote,
    noteVariants,
    sourceVariants,
    takeoutVariantSettings,
    isAllowedDownloadUrl,
    isNotebookDownload,
    NOTEBOOK_HOSTS,
    isNotebookUrl,
    sanitizeFilename,
    artifactTypePrefix,
    singleArtifactPackage,
    exportTimestamp,
    escapeHtml,
    PROJECT_TITLE_SELECTORS,
    normalizeExportError,
    prefixExportErrors,
    buildErrorReport,
    cancellationNote,
    distinctVariants,
    createStabilityTracker,
    downloadFolderPath,
    extensionFromDownloadUrl,
    titlesMatch,
    pickByIndexThenTitleStrict,
    pickFreshIntercept,
    isNotebookDownloadUrl,
    createInterceptArm,
    summarizeExportOutcome,
    composeOutcome,
    combineRetryOutcomes,
    groupErrorsForPanel,
    createJobLock,
    createPhaseTimer,
    formatTimingSummary,
    cleanOcrArtifacts,
    mathSourceHealth,
    mathSourceToMarkdown,
    classifyKatexScript,
    isCollapsedCitationGroup,
    renumberCitationAnchors,
    pickDownloadMenuIndex,
    countFailedExtractions,
    ISSUES_URL,
    pickByIndexThenTitle,
    STUDIO_HEADER_CLOSE_SELECTOR,
    buildCitationEntries,
    ICON_TO_TYPE,
    NOTE_ICONS,
    resolveArtifactType,
    isDownloadableType,
    chatCitationMode,
    takeoutZipChoice,
    CITATION_TOOLTIP_SELECTOR,
    isCitationExpander,
    parseCitationIndex,
    mimeForPath
  };

  root.NLME = NLME;
  if (typeof module === 'object' && module.exports) module.exports = NLME;
})(globalThis);
