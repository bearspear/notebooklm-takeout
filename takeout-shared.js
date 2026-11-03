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

  // Make ZIP entry names unique: repeats get " (2)", " (3)"... before the
  // extension, so artifacts with the same title don't overwrite each other.
  function uniqueFilenames(names) {
    const used = new Set();
    return (names || []).map(name => {
      let candidate = name;
      if (used.has(candidate)) {
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let n = 2;
        do { candidate = `${stem} (${n++})${ext}`; } while (used.has(candidate));
      }
      used.add(candidate);
      return candidate;
    });
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
      return { level: 'error', message: `No ${kind} exported (${failed} failed, see errors.txt)`, partial: false };
    }
    if (failed > 0) {
      return { level: 'warning', message: `Exported ${exported} of ${selected} ${kind} (${failed} failed, see errors.txt)`, partial: false };
    }
    return { level: 'success', message: `Exported ${exported} of ${selected} ${kind}`, partial: false };
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

  function formatErrorsTxt({ title = 'Export', generatedAt = '', errors = [] } = {}) {
    return buildErrorReport({ title, generatedAt, errors });
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

  // errors.txt line for a cancelled run; it also forces the ZIP (and so the
  // -PARTIAL name) for exports that otherwise write a single file.
  function cancellationNote({ kind, done = 0, total = 0 } = {}) {
    return `Cancelled by user after ${done} of ${total} ${kind}; the last one may have incomplete citations and the rest were not exported`;
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

  // One errors.txt format for notes, sources, chat and Download All.
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

  const NLME = {
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
    isAllowedDownloadUrl,
    isNotebookDownload,
    NOTEBOOK_HOSTS,
    isNotebookUrl,
    sanitizeFilename,
    artifactTypePrefix,
    exportTimestamp,
    escapeHtml,
    PROJECT_TITLE_SELECTORS,
    normalizeExportError,
    buildErrorReport,
    cancellationNote,
    createStabilityTracker,
    downloadFolderPath,
    extensionFromDownloadUrl,
    formatErrorsTxt,
    titlesMatch,
    pickByIndexThenTitleStrict,
    pickFreshIntercept,
    isNotebookDownloadUrl,
    createInterceptArm,
    summarizeExportOutcome,
    createJobLock,
    createPhaseTimer,
    formatTimingSummary,
    cleanOcrArtifacts,
    mathSourceHealth,
    mathSourceToMarkdown,
    classifyKatexScript,
    isCollapsedCitationGroup,
    renumberCitationAnchors,
    uniqueFilenames,
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
    CITATION_TOOLTIP_SELECTOR,
    isCitationExpander,
    parseCitationIndex
  };

  root.NLME = NLME;
  if (typeof module === 'object' && module.exports) module.exports = NLME;
})(globalThis);
