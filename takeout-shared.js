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

  // Chat (the Chat tab and Full Takeout) follows the run's citationDetail, the same
  // one notes use: 'quotes' (default), 'titles' or 'none'. A missing or unknown value is 'quotes'.
  function chatCitationMode(settings) {
    const detail = settings && settings.citationDetail;
    return detail === 'titles' || detail === 'none' ? detail : 'quotes';
  }

  // Where the export sheet's Save as starts: Settings' Default save (takeoutZip) when it
  // has been set, else what an earlier version stored as "Always use ZIP" (autoZip).
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

  // An uploaded picture is a source with a Source guide and one notebook image
  // but no text (Nov 2026): the Markdown of its body, and what stands in for a
  // quote when a citation points at it.
  const IMAGE_SOURCE_NOTE = 'This source is an image with no text.';
  const IMAGE_CITATION_NOTE = 'This source is an image, so this citation has no quote text.';

  const IMAGE_TITLE_RE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff)$/i;

  function isImageSourceUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'lh3.googleusercontent.com' && u.pathname.startsWith('/notebooklm/');
    } catch {
      return false;
    }
  }

  function imageSourceUrls(urls) {
    return [...new Set((urls || []).filter(isImageSourceUrl))];
  }

  // Body of an image source. The links go through the normal embed pass, whose
  // pattern ends a link at ")" and an alt text at "]".
  function imageSourceMarkdown(title, urls) {
    const alt = String(title || '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
    const links = urls.map(url => `![${alt}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`);
    return [`*${IMAGE_SOURCE_NOTE}*`, ...links].join('\n\n');
  }

  // A popover with a title and no quote is an image citation only with positive
  // evidence: an img in it, an image file name, or a title this export already
  // found to be an image source. Anything else is a popover that did not load.
  function isImageCitation({ title = '', quoteText = '', hasImage = false, knownImageTitles = [] } = {}) {
    if (!title || quoteText) return false;
    return hasImage || IMAGE_TITLE_RE.test(title) || [...knownImageTitles].some(known => titlesMatch(known, title));
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
  // Older decks list only the PDF item: with exact, a preference no item
  // matches gives -1 instead of the first Download item, so a PPTX request
  // never clicks PDF again (a second, identical PDF).
  // The error a PPTX request raises when the deck's menu lists no PowerPoint item
  const FORMAT_NOT_OFFERED = 'PowerPoint download not offered for this deck';

  function pickDownloadMenuIndex(labels, preference, { exact = false } = {}) {
    const lower = (labels || []).map(l => (l || '').toLowerCase());
    const candidates = lower.map((l, i) => (l.includes('download') ? i : -1)).filter(i => i !== -1);
    if (candidates.length === 0) return -1;
    const wanted = preference === 'pptx' ? ['powerpoint', '.pptx'] : preference === 'pdf' ? ['pdf'] : [];
    const preferred = candidates.find(i => wanted.some(w => lower[i].includes(w)));
    if (exact && preferred === undefined && wanted.length > 0) return -1;
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
  // Some PDF text layers hand back NUL where a letter was lost; in every
  // sample it is an "i" (volcan\0c, cond\0t\0ons). NUL next to a Latin letter
  // becomes "i"; other control characters are dropped. \t \n \r stay.
  function stripControlChars(text) {
    return String(text ?? '')
      .replace(/(?<=[A-Za-z\u00C0-\u024F])\u0000|\u0000(?=[A-Za-z\u00C0-\u024F])/g, 'i')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  }

  function cleanOcrSegment(text) {
    text = stripControlChars(text);
    const kept = [];
    const protectedText = text.replace(/~~([^~\n]+?)~~/g, (m) => {
      kept.push(m);
      return `\uE010${kept.length - 1}\uE010`;
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
      .replace(/\uE010(\d+)\uE010/g, (_m, i) => kept[Number(i)]);
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

  // Only the newest of several overlapping runs may act: each takes a token, and
  // a run that finds its token is no longer the latest stops.
  function createLatestGate() {
    let latest = 0;
    return {
      begin() { return ++latest; },
      isLatest(token) { return token === latest; }
    };
  }

  // In-app navigation settle (side panel): each settle wait takes a token; only
  // the newest token is current, so an older wait that finishes later can tell
  // that a newer navigation replaced it and does nothing. A settle for a switched
  // notebook owes a rescan: if a newer settle discards it, the newer one inherits
  // that debt (owesRescan) and clears it with settled() once it decides.
  function createSettleGate() {
    let generation = 0;
    let owed = false;
    return {
      begin(switched) {
        const mine = ++generation;
        owed = owed || !!switched;
        const owesRescan = owed;
        return {
          owesRescan,
          current: () => mine === generation,
          settled() { if (mine === generation) owed = false; }
        };
      }
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
  // Notes, Artifacts) and ends in ONE outcome. steps: each retried
  // category's outcome { name, message, level, saved, errors, failedItems };
  // notRun: categories a cancel or a declined dialog kept from running
  // { name, failedItems } (their items still failed). Returns the panel's
  // content: one line per category, the worst level, every ZIP, every error
  // prefixed with its category, and what a further Retry would re-run.
  // verb: 'Retry' (default) or 'Resume' for the message. extraErrors: errors
  // that belong to no step (a resume's items that left the notebook), already
  // in the panel's { type, title, message } shape.
  function combineRetryOutcomes({ steps = [], notRun = [], verb = 'Retry', extraErrors = [] } = {}) {
    const rank = { success: 0, info: 0, warning: 1, error: 2 };
    let level = 'success';
    for (const s of steps) if ((rank[s.level] || 0) > rank[level]) level = s.level;
    if ((notRun.length || extraErrors.length) && level === 'success') level = 'warning';

    const remaining = {};
    for (const s of steps) remaining[s.name] = s.failedItems || [];
    for (const n of notRun) remaining[n.name] = n.failedItems || [];
    const remainingCount = Object.values(remaining).reduce((sum, list) => sum + list.length, 0);

    let message = notRun.length
      ? `${verb} stopped before ${notRun.map(n => n.name.toLowerCase()).join(' and ')}`
      : `${verb} finished`;
    if (remainingCount > 0) message += ` \u2014 ${remainingCount} still failed`;
    // Skips are in no step's count (neither N nor M): they are said here
    const skippedCount = [...steps.flatMap(s => s.errors || []), ...extraErrors]
      .filter(e => SKIP_TYPES.includes(normalizeExportError(e).type)).length;
    if (skippedCount > 0) message += ` \u2014 ${skippedCount} skipped`;

    const done = steps.reduce((sum, s) => sum + (s.exported || 0), 0);
    const ranTotal = steps.reduce((sum, s) => sum + (s.selected ?? (s.exported || 0) + (s.failedItems || []).length), 0);
    const notRunTotal = notRun.reduce((sum, n) => sum + (n.failedItems || []).length, 0);
    // Items that could not be checked or taken are in neither side of the sum
    const uncounted = extraErrors.some(e => ['scan_failed', 'not_ready', 'not_found'].includes(e.type));

    return {
      message,
      level,
      count: uncounted ? null : { done, total: ranTotal + notRunTotal },
      lines: steps.map(s => `${s.name}: ${s.message}`),
      saved: steps.flatMap(s => s.saved || []),
      errors: [...steps.flatMap(s => prefixExportErrors(s.name, s.errors)), ...extraErrors],
      remaining,
      remainingCount
    };
  }

  // Error types a Resume adds to its panel and that no errors.md holds: key gone
  // from the notebook, artifact not ready, scan failed / incomplete.
  const PANEL_ONLY_ERROR_TYPES = ['not_found', 'not_ready', 'scan_failed'];

  // The results view's error list: groups by error type in first-seen
  // order, at most perGroup entries each; `more` entries are in errors.md.
  function groupErrorsForPanel(errors = [], { perGroup = 20 } = {}) {
    const groups = new Map();
    for (const raw of errors || []) {
      const e = normalizeExportError(raw);
      if (!groups.has(e.type)) groups.set(e.type, []);
      groups.get(e.type).push({ item: e.item, message: e.message });
    }
    return [...groups].map(([type, list]) => {
      const words = errorHeading(type);
      // Resume's own notes exist only in the panel (not in any errors.md): list all
      const cap = PANEL_ONLY_ERROR_TYPES.includes(type) ? Infinity : perGroup;
      return {
        heading: words.charAt(0).toUpperCase() + words.slice(1),
        count: list.length,
        entries: list.slice(0, cap),
        more: Math.max(0, list.length - cap)
      };
    });
  }

  // An infographic's More → Download link (Nov 2026). Only this path of the
  // host: the rest of lh3.google.com is not Gemini Notebook's.
  function isInfographicDownload(u) {
    return u.hostname === 'lh3.google.com' && u.pathname.startsWith('/notebooklm/');
  }

  // Gemini Notebook's own download links (More → Download opens one via
  // window.open). Hostname-based, so lookalike query strings don't match.
  function isNotebookDownloadUrl(url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    const host = u.hostname;
    if (host === 'contribution.usercontent.google.com' || isInfographicDownload(u)) return true;
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
  // differs: the item the user picked must still be the item we open. With no
  // index of its own (-1: an item that had no More button when scanned) the title
  // alone decides, so it must name one item only: two candidates of that title
  // are refused (SAME_TITLE_REFUSED) instead of taking the first (1.9.5; a Retry
  // reuses the scanned -1 without a rescan). The same goes for a scanned index
  // whose row no longer has this title (the list shifted: an item finished or was
  // added above it): with one row of that title it is followed, with two or more
  // it is refused (SAME_TITLE_SHIFTED), since the first match is right only by
  // luck. Every caller fails the item on a throw; Resume rescans.
  // place (stampTitleOrdinals; a number is an ordinal alone): { ordinal, count },
  // how many rows of this title came before the item when it was scanned, and how
  // many there were in all. A shift can put the item's twin at its old index; the
  // title still matches there, but the ordinal or (a same-title row added or
  // removed above) the count does not, so that index is stale too. With no place
  // the title check alone decides, as before.
  function pickByIndexThenTitleStrict(titles, index, title, place = null) {
    const { ordinal = null, count = null } = typeof place === 'number' ? { ordinal: place } : (place || {});
    const list = titles || [];
    const inRange = Number.isInteger(index) && index >= 0 && index < list.length;
    if (!normalizeTitle(title)) {
      if (inRange) return index;
      throw new Error(`Item changed: index ${index} is out of range`);
    }
    const matches = list.filter(t => titlesMatch(t, title)).length;
    if (inRange && titlesMatch(list[index], title) &&
      (!Number.isInteger(ordinal) || titleOrdinalAt(list, index, title) === ordinal) &&
      (!Number.isInteger(count) || matches === count)) return index;
    const byTitle = list.findIndex(t => titlesMatch(t, title));
    if (byTitle !== -1 && matches > 1) {
      throw new Error(Number.isInteger(index) && index >= 0 ? SAME_TITLE_SHIFTED : SAME_TITLE_REFUSED);
    }
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
  // A Full Takeout's folder name, within downloadFolderPath's 80 characters. A
  // long notebook name gives way, not the timestamp that keeps two runs apart.
  function takeoutFolderName(name, timestamp) {
    const suffix = ` takeout ${timestamp}`;
    let kept = '';
    for (const char of String(name || '')) {
      if (kept.length + char.length + suffix.length > 80) break;
      kept += char;
    }
    return kept.replace(/[\s.]+$/, '') + suffix;
  }

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

  // A source guide is written in steps for a brand-new source. A summary
  // with text at the first check is a finished guide (an existing guide
  // arrives in one response): proceed at once. A summary that appears later
  // is being generated: wait until it and the key-topics count have both
  // held still for settleMs. read() returns { summary, keyTopics } (summary
  // text, count of key topics); keyTopics may stay 0 (some sources have none).
  // Resolves { status, waitedMs }: 'settled'; 'empty' when no summary text
  // came within timeout; 'unsettled' when it was still changing at timeout.
  const GUIDE_SETTLE_MS = 500;
  async function waitForGuideSettled(read, {
    settleMs = GUIDE_SETTLE_MS, timeout = 10000, interval = 50,
    now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  } = {}) {
    const start = now();
    let last = null;
    let since = 0;
    let first = true;
    for (;;) {
      const snap = read() || {};
      const summary = String(snap.summary || '').trim();
      const t = now();
      // Text at the very first read: a finished guide, saved at once
      if (summary && first) return { status: 'settled', waitedMs: 0 };
      first = false;
      if (summary) {
        const key = `${snap.keyTopics || 0}\u0000${summary}`;
        if (key !== last) {
          last = key;
          since = t;
        } else if (t - since >= settleMs) {
          return { status: 'settled', waitedMs: t - start };
        }
      }
      if (t - start >= timeout) {
        return { status: last === null ? 'empty' : 'unsettled', waitedMs: t - start };
      }
      await sleep(interval);
    }
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

  // Notices (type 'info', a deck with no PowerPoint version) are listed in
  // errors.md but nothing went wrong, so they do not count as errors.
  function countExportErrors(errors = []) {
    return (errors || []).filter(raw => normalizeExportError(raw).type !== 'info').length;
  }

  // A Full Takeout's errors.md holds every category's errors: each keeps its
  // type and gets its category in front ("Notes: <item>: <message>"). An error
  // marked `prefixed` already names its own (a Studio item in a notes export).
  function prefixExportErrors(category, errors = []) {
    return (errors || []).map(raw => {
      const e = normalizeExportError(raw);
      const own = !!(raw && typeof raw === 'object' && raw.prefixed && e.item);
      return { type: e.type, title: own ? e.item : (e.item ? `${category}: ${e.item}` : category), message: e.message, stack: e.detail };
    });
  }

  // Section headings that read better than the type's own words
  const ERROR_HEADINGS = { skipped_ambiguous: 'Skipped: same title as another item', skipped_not_ready: 'Skipped: still being generated' };
  function errorHeading(type) {
    return ERROR_HEADINGS[type] || type.replace(/_/g, ' ');
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
    lines.push(`Errors: ${countExportErrors(errors)}`, '');
    const groups = new Map();
    for (const raw of errors) {
      const e = normalizeExportError(raw);
      if (!groups.has(e.type)) groups.set(e.type, []);
      groups.get(e.type).push(e);
    }
    for (const [type, list] of groups) {
      lines.push(`## ${ERROR_HEADINGS[type] || type.replace(/_/g, ' ').toUpperCase()} (${list.length})`, '');
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

  // "Obsidian-friendly file names" (Milestone 3d, opt-in): characters that
  // break [[wiki links]] and heading/block references ([ ] # ^ | \\ : * ? " < >)
  // become a space; runs collapse into one space. sanitizeFilename runs after
  // it (spaces become dashes), so "A#B" and "A B" still end up as different
  // stems once uniqueStems numbers the repeat.
  function obsidianSafeName(name) {
    return String(name == null ? '' : name)
      .replace(/[\[\]#^|\\:*?"<>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // The one file-name stem: sanitizeFilename, preceded by obsidianSafeName
  // when `obsidian` is on. Off, it is exactly sanitizeFilename.
  function fileStem(name, { obsidian = false } = {}) {
    return sanitizeFilename(obsidian ? obsidianSafeName(name) : name);
  }

  // "[NOTE]_Title" / "[mind-map]_Title" (the historic names of single
  // downloads). With `obsidian`: "note - Title" / "mind-map - Title", since
  // square brackets cannot be part of a link target.
  function prefixedStem(prefix, title, { obsidian = false } = {}) {
    return obsidian
      ? `${String(prefix).toLowerCase()} - ${fileStem(title, { obsidian })}`
      : `[${prefix}]_${fileStem(title)}`;
  }

  // One ZIP for a single Data Table or mind map download, as before
  // Milestone 3a: { zipName, entries } with the inner files renamed, or null
  // when the artifact stays loose (other types, or a lone file).
  function singleArtifactPackage({ type, title, files, obsidian = false }) {
    if ((type !== 'Data Table' && type !== 'Mind Map') || !files || files.length < 2) return null;
    const clean = fileStem(title, { obsidian });
    const isTable = type === 'Data Table';
    const prefixed = prefixedStem(artifactTypePrefix(type), title, { obsidian });
    const base = isTable ? clean : prefixed;
    const entries = files.map(file => {
      const path = String(file.path || '');
      if (isTable && /-references\.txt$/i.test(path)) return { ...file, path: 'references.txt' };
      const ext = (path.match(/\.[^./\\]+$/) || [''])[0];
      return { ...file, path: `${base}${ext}` };
    });
    return { zipName: `${isTable ? prefixed : base}.zip`, entries };
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
  // The notebook's own emoji, on the cover at the top of the chat. The element
  // also holds its emoji picker's words, so only the first word is the emoji.
  const NOTEBOOK_EMOJI_SELECTOR = '.cover-emoji';
  function notebookEmoji(text) {
    const first = String(text || '').trim().split(/\s+/)[0] || '';
    return first.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first) ? first : '';
  }

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
    return host === 'contribution.usercontent.google.com' || isInfographicDownload(u) ||
      host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
  }

  // Hosts notebook images are fetched from with the user's sign-in. Image URLs
  // on lh3.googleusercontent.com redirect to lh3.google.com. Separate from
  // isAllowedDownloadUrl, which also decides which Chrome downloads to take over.
  function isAllowedImageUrl(url) {
    if (isAllowedDownloadUrl(url)) return true;
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'lh3.google.com';
    } catch {
      return false;
    }
  }

  // The url to request for a notebook image: without the authuser parameter (the
  // request form live run 4 verified). Why lh3 answers some requests with 403 is not
  // known; the embed pass retries those with waits. Other hosts and unparsable values
  // come back unchanged. Caches and reports keep the original.
  function imageFetchUrl(url) {
    let u;
    try { u = new URL(url); } catch { return url; }
    if (u.protocol !== 'https:' || !['lh3.googleusercontent.com', 'lh3.google.com'].includes(u.hostname)) return url;
    if (u.hostname === 'lh3.googleusercontent.com' && !u.pathname.startsWith('/notebooklm/')) return url;
    if (!u.searchParams.has('authuser')) return url;
    u.searchParams.delete('authuser');
    return u.toString();
  }

  // Why a fetched Blob must not be embedded as an image, or null when it can
  // be. A signed-out request gets Google's sign-in page, with HTTP 200.
  function imageBlobProblem(blob) {
    const type = (blob && blob.type) || '';
    if (!/^image\//i.test(type)) return `not an image (${type || 'no type'})`;
    if (!blob.size) return 'empty image';
    return null;
  }

  // One error per item for failed images, not one per image: a Venus-sized
  // notebook has over a thousand. failures: [{ item, url, reason }]. An image
  // that failed twice in one item (a citation repeated, a second variant)
  // counts once.
  function summarizeImageFailures(failures = []) {
    const items = new Map();
    for (const failure of failures || []) {
      const item = String(failure.item || '');
      if (!items.has(item)) items.set(item, { urls: new Set(), unnamed: 0, reasons: [] });
      const entry = items.get(item);
      if (failure.url) {
        if (entry.urls.has(failure.url)) continue;
        entry.urls.add(failure.url);
      } else {
        entry.unnamed++;
      }
      if (failure.reason && !entry.reasons.includes(failure.reason)) entry.reasons.push(failure.reason);
    }
    return [...items].map(([item, { urls, unnamed, reasons }]) => {
      const count = urls.size + unnamed;
      const others = reasons.length - 1;
      const reason = (reasons[0] || 'unknown error') +
        (others > 0 ? ` (and ${others} other reason${others === 1 ? '' : 's'})` : '');
      const [first = ''] = urls;
      return {
        source: item,
        type: 'image_download_failed',
        count,
        message: count === 1 ? `Failed to download image: ${reason}` : `Failed to download ${count} images: ${reason}`,
        url: first.length > 100 ? `${first.slice(0, 100)}...` : first
      };
    });
  }

  // Put downloaded images into a variant's Markdown. embeds: Map of remote
  // url -> data URI. Other images stay links; [text](url) links are left alone.
  function applyImageEmbeds(markdown, embeds) {
    if (!embeds || embeds.size === 0) return markdown;
    return markdown.replace(/(!\[[^\]]*\]\()([^)]+)\)/g,
      (match, open, url) => (embeds.has(url) ? `${open}${embeds.get(url)})` : match));
  }

  // A Retry-After header as milliseconds from now: seconds or an HTTP date.
  // null for anything else; Date.parse alone would read "1.5" as a date.
  function retryAfterMs(value, now = Date.now()) {
    const text = String(value ?? '').trim();
    if (/^\d+$/.test(text)) return Number(text) * 1000;
    if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return null;
    const at = Date.parse(text);
    return Number.isNaN(at) ? null : Math.max(0, at - now);
  }

  const RATE_LIMIT_STATUSES = [429, 503];
  const IMAGE_RETRY_DELAYS_MS = [2000, 4000];
  const IMAGE_RETRY_AFTER_MAX_MS = 60000; // longer: give the image up, never stall the job
  const IMAGE_LIMITED_STREAK = 5; // consecutive limited images before the pause
  const IMAGE_LIMITED_PAUSE_MS = 30000;
  const IMAGE_WAIT_BUDGET_MS = 5 * 60 * 1000; // all of a job's backoffs and its pause
  // HTTP 403 on an image request: patient calls (the embed pass) retry after
  // these waits, on a budget of their own. Hover downloads never wait on 403.
  const IMAGE_FORBIDDEN_DELAYS_MS = [5000, 15000];
  const IMAGE_FORBIDDEN_WAIT_BUDGET_MS = 10 * 60 * 1000;

  function isRateLimitedStatus(status) {
    return RATE_LIMIT_STATUSES.includes(status);
  }

  // One job's image downloads, in order: retries a rate limit, backs off when
  // limiting goes on, and asks for a url once per batch (endBatch frees the
  // results, so a job's memory follows its batches).
  //
  // download(url) resolves a data URI, or throws an error with .status and
  // .retryAfter. sleep(ms) should end early on Cancel. get(url) rejects with
  // the download's error, or one marked .skipped (limiting did not stop) or
  // .cancelled. A job waits IMAGE_WAIT_BUDGET_MS at most: limited and fine
  // images can alternate, which keeps the streak from ever reaching the pause.
  // Skipped images get one job-wide summary (reportSkipped);
  // it is one object, updated by later skips, because it sits in the job's
  // errors by then.
  function createImageSession({ download, sleep, isCancelled = () => false, now = Date.now } = {}) {
    const results = new Map(); // imageFetchUrl(url) -> Promise of its data URI; failures are removed
    const forbidden = new Map(); // key -> 403 error of a patient attempt that gave up, this batch
    const patientKeys = new Set(); // keys whose in-flight request is patient
    let forbiddenWaitedMs = 0;
    const skipped = new Set();
    const summary = { source: '', type: 'image_download_failed', count: 0, message: '' };
    let summaryReported = false;
    let streak = 0; // consecutive images that ended rate limited
    let paused = false;
    let skipping = false;
    let waitedMs = 0;
    let budgetSpent = false;

    const marked = (mark, message) => Object.assign(new Error(message), { [mark]: true });
    const stopIfCancelled = () => {
      if (isCancelled()) throw marked('cancelled', 'Export cancelled');
    };

    // Wait if the budget allows. False, with skipping set, if it does not.
    async function waitFromBudget(ms) {
      const fits = waitedMs + ms <= IMAGE_WAIT_BUDGET_MS;
      if (fits) {
        waitedMs += ms;
        await sleep(ms);
      }
      if (!fits || waitedMs >= IMAGE_WAIT_BUDGET_MS) {
        skipping = true;
        budgetSpent = true;
      }
      return fits;
    }

    async function afterLimitedImage() {
      streak++;
      if (streak < IMAGE_LIMITED_STREAK) return;
      if (paused) {
        skipping = true;
      } else {
        paused = true;
        await waitFromBudget(IMAGE_LIMITED_PAUSE_MS);
        stopIfCancelled();
      }
    }

    async function fetchWithRetries(url, patient = false) {
      let forbiddenAttempt = 0;
      for (let attempt = 0; ; attempt++) {
        stopIfCancelled();
        let error;
        try {
          const dataUri = await download(url);
          streak = 0;
          return dataUri;
        } catch (caught) {
          error = caught;
        }
        if (error.status === 403) {
          // Own attempt counter and budget; streak and skipping stay as they are.
          const delay = IMAGE_FORBIDDEN_DELAYS_MS[forbiddenAttempt];
          if (!patient || delay === undefined || forbiddenWaitedMs + delay > IMAGE_FORBIDDEN_WAIT_BUDGET_MS) throw error;
          forbiddenWaitedMs += delay;
          forbiddenAttempt++;
          await sleep(delay);
          attempt--; // a 403 wait is not a 429/503 attempt
          continue;
        }
        if (!isRateLimitedStatus(error.status)) {
          streak = 0;
          throw error;
        }
        const wait = retryAfterMs(error.retryAfter, now()) ?? IMAGE_RETRY_DELAYS_MS[attempt];
        if (attempt >= IMAGE_RETRY_DELAYS_MS.length || wait > IMAGE_RETRY_AFTER_MAX_MS) {
          await afterLimitedImage();
          throw error;
        }
        if (!(await waitFromBudget(wait))) {
          await afterLimitedImage();
          throw error;
        }
      }
    }

    function get(url, { patient = false } = {}) {
        const key = imageFetchUrl(url); // authuser variants share one download
        if (results.has(key)) {
          const shared = results.get(key);
          if (!patient || patientKeys.has(key)) return shared;
          // Joined a non-patient request: if it ends 403, make our own patient attempt.
          return shared.catch(error => {
            if (error.status === 403 && !error.cancelled) return get(url, { patient: true });
            throw error;
          });
        }
        // A patient attempt already gave up on 403 in this batch: do not pay again.
        if (patient && forbidden.has(key)) return Promise.reject(forbidden.get(key));
        try {
          stopIfCancelled();
        } catch (error) {
          return Promise.reject(error);
        }
        if (skipping) {
          skipped.add(url);
          summary.count = skipped.size;
          summary.message = `${skipped.size} image${skipped.size === 1 ? ' was' : 's were'} skipped because Google limited requests` +
            `${budgetSpent ? ' and the job reached its 5 minute wait limit' : ''}; they stay links`;
          return Promise.reject(marked('skipped', 'Skipped: Google limited requests'));
        }
        const result = fetchWithRetries(url, patient);
        results.set(key, result);
        if (patient) patientKeys.add(key);
        result.catch(error => {
          if (results.get(key) !== result) return; // a later batch owns the key now
          if (patient && error.status === 403) forbidden.set(key, error);
          results.delete(key);
          patientKeys.delete(key);
        });
        return result;
    }

    return {
      get,
      endBatch() {
        results.clear();
        patientKeys.clear();
        forbidden.clear();
      },
      reportSkipped(warn) {
        if (summary.count === 0 || summaryReported) return;
        summaryReported = true;
        warn(summary);
      }
    };
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

  const PRESETS = ['archive', 'ai', 'custom'];

  // What a preset sets for one export. custom: the Custom preset's remembered
  // { citationDetail, obsidianNames, images }. An unknown preset is Archive. No image
  // copies means none at all: the metadata version's too. With image copies on, that
  // version stays the person's own setting, so its key is left out.
  function presetOverrides(preset, custom = {}) {
    const fixed = (citationDetail, images) => ({ citationDetail, obsidianNames: false, exportNoteWithImages: images, exportSourceWithImages: images });
    const noImages = { exportNoteWithImages: false, exportSourceWithImages: false, exportSourcePlusMetaWithImages: false };
    if (preset === 'ai') return { ...fixed('titles', false), ...noImages };
    if (preset !== 'custom') return fixed('quotes', true);
    const images = custom.images !== false;
    return {
      citationDetail: custom.citationDetail === undefined ? 'quotes' : custom.citationDetail,
      obsidianNames: !!custom.obsidianNames,
      ...(images ? { exportNoteWithImages: true, exportSourceWithImages: true } : noImages)
    };
  }

  // The preset for raw stored settings that have none (from before 1.9.3).
  // Archive forces quotes and plain names, so anyone who changed either goes to
  // Custom, whose remembered values are those same stored settings.
  function migratePreset(stored) {
    const { citationDetail, obsidianNames } = stored || {};
    return obsidianNames || (citationDetail !== undefined && citationDetail !== 'quotes') ? 'custom' : 'archive';
  }

  // The overrides of `settings.exportPreset`. The one way from settings to a
  // run's overrides.
  function runOverrides(settings = {}) {
    return presetOverrides(settings.exportPreset, {
      citationDetail: settings.citationDetail,
      obsidianNames: settings.obsidianNames,
      images: settings.customImages
    });
  }

  // run: `settings` with the overrides on top, for one job. persistable(current):
  // `current` with the overridden keys back at their saved values, so a run value
  // never reaches storage. The input is not changed.
  function applyRunSettings(settings = {}, overrides = {}) {
    const saved = { ...settings };
    const persistable = current => {
      const real = { ...current };
      for (const key of Object.keys(overrides)) {
        if (key in saved) real[key] = saved[key];
        else delete real[key];
      }
      return real;
    };
    return { run: { ...settings, ...overrides }, persistable };
  }

  // Seconds per item, from one Full Takeout of 552 items in about 45 minutes. A
  // cached run is faster: citations read before are not hovered again.
  const ESTIMATE_SECONDS = {
    notes: { quotes: 7, titles: 0.3, none: 0.1 },
    chat: { quotes: 5, titles: 0.2, none: 0.1 },
    sources: 2,
    generated: 4
  };

  // An export's expected length. counts: { notes, chat, sources, generated }; a count
  // missing or unknown is 0. A citation detail other than titles or none reads quotes.
  function estimateSeconds(counts, citationDetail) {
    const detail = citationDetail === 'titles' || citationDetail === 'none' ? citationDetail : 'quotes';
    const count = name => {
      const n = counts && counts[name];
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    return count('notes') * ESTIMATE_SECONDS.notes[detail]
      + count('chat') * ESTIMATE_SECONDS.chat[detail]
      + count('sources') * ESTIMATE_SECONDS.sources
      + count('generated') * ESTIMATE_SECONDS.generated;
  }

  // 'under 30 sec' or 'about N min'. A time that is not a positive number reads short.
  function formatEstimate(seconds) {
    if (!Number.isFinite(seconds) || seconds < 30) return 'under 30 sec';
    return `about ${Math.max(1, Math.round(seconds / 60))} min`;
  }

  // The export sheet's estimate. counts holds what the run takes: a key that is there
  // with no usable number is not known yet, counts as 0 and is named; an absent key is
  // not part of the run. With nothing known there is no number: a short time would
  // be a guess.
  const ESTIMATE_NAMES = [['sources', 'sources'], ['notes', 'notes'], ['generated', 'Studio items'], ['chat', 'chat']];
  function estimateLine(counts, citationDetail) {
    const asked = ESTIMATE_NAMES.filter(([key]) => counts && key in counts);
    const unknown = asked.filter(([key]) => !(Number.isFinite(counts[key]) && counts[key] >= 0)).map(([, name]) => name);
    if (asked.length === unknown.length) return 'Estimated time: not known yet';
    const line = `Estimated time: ${formatEstimate(estimateSeconds(counts, citationDetail))}`;
    if (unknown.length === 0) return line;
    const last = unknown.pop();
    return `${line}, not counting ${unknown.length ? `${unknown.join(', ')} and ` : ''}${last}`;
  }

  // Seconds left at the pace so far, null until three items have set a pace. A takeout's
  // categories run at different paces: calmTimeLeft keeps that from showing.
  function timeLeft(done, total, elapsedSeconds) {
    if (!(total > 0) || done < 3 || !Number.isFinite(elapsedSeconds)) return null;
    if (done >= total) return 0;
    return (elapsedSeconds / done) * (total - done);
  }

  // What is left, by estimate key. parts: [category or chain step name, items]
  const ESTIMATE_KEYS = { Sources: 'sources', Notes: 'notes', Chat: 'chat', Artifacts: 'generated' };
  function restCounts(parts = []) {
    const rest = {};
    for (const [name, n] of parts) {
      const key = ESTIMATE_KEYS[name];
      rest[key] = (rest[key] || 0) + n;
    }
    return rest;
  }

  // The page overlay's fields from a progress text and count (Task 10).
  // text: 'Notes: Batch 1/2: Processing 1/25: Title' and the like; count:
  // { done, total, item } or null. Pure, so the content script only renders.
  // Progress category -> what the heading calls it: the prefixes Export everything
  // and the tab exports write (a Studio export runs as artifacts, then notes)
  const OVERLAY_CATEGORIES = { Sources: 'sources', Notes: 'notes', Chat: 'chat', Artifacts: 'artifacts' };
  function overlayView(text, count, { finishing = false } = {}) {
    let rest = String(text || '');
    let heading = 'Exporting';
    const colon = rest.indexOf(': ');
    if (colon > 0 && Object.hasOwn(OVERLAY_CATEGORIES, rest.slice(0, colon))) {
      heading = `Exporting ${OVERLAY_CATEGORIES[rest.slice(0, colon)]}`;
      rest = rest.slice(colon + 2);
    }
    if (finishing) heading = 'Saving files';

    const parts = [];
    const batch = /^Batch (\d+)\/(\d+):\s*/.exec(rest);
    if (batch) {
      parts.push(`Part ${batch[1]} of ${batch[2]}`);
      rest = rest.slice(batch[0].length);
    }
    const total = count && Number(count.total) > 0 ? Number(count.total) : 0;
    const done = total ? Math.max(0, Math.min(Number(count.done) || 0, total)) : 0;
    if (total) parts.push(`${Math.min(done + 1, total)} of ${total}`);

    let item = rest;
    if (count && count.item) item = String(count.item);
    else if (/^(Processing|Extracting) \d+\/\d+: /.test(rest)) item = rest.slice(rest.lastIndexOf(': ') + 2);

    return {
      heading,
      line: parts.join(' · '),
      item,
      percent: total ? Math.round((done / total) * 100) : null
    };
  }

  // The count the overlay shows. With a count: the panel's run (done/total across
  // a resume chain) when it has one. Without one, the run so far, so a count-less
  // text ('Creating ZIP...') keeps the bar and 'n of total' where they were; while
  // finishing, or before any count, nothing (the bar goes indeterminate).
  function overlayCount(count, run, { finishing = false } = {}) {
    const runTotal = run && Number(run.total) > 0 ? run : null;
    if (count) return runTotal ? { ...count, done: runTotal.done, total: runTotal.total } : count;
    if (finishing || !runTotal) return null;
    return { done: runTotal.done, total: runTotal.total };
  }

  // A delete asked about one notebook's tab may only reach that tab: true when
  // the panel still shows the same notebook in the same tab as when it asked.
  function sameDeleteTarget(asked, now) {
    return !!asked && !!now && asked.tabId != null && !!asked.notebookId && asked.tabId === now.tabId && asked.notebookId === now.notebookId;
  }

  // What a delete is about: the tab and the notebook its URL names. The panel's own id
  // is still '' at panel start, or after a Refresh that found nothing; the URL is not.
  // A panel id that names another notebook than the tab means the tab is ahead of the
  // panel, so the list is not the tab's: no notebook, which sameDeleteTarget refuses.
  function deleteTarget({ tabId, url, panelNotebookId }) {
    const id = notebookIdFromUrl(url);
    return { tabId: tabId ?? null, notebookId: id && (!panelNotebookId || panelNotebookId === id) ? id : '' };
  }

  // The time left to show between progress events: the last estimate counted down by
  // the seconds since, but never below 30 s (the last "about 1 min") by ticking alone,
  // since one long item can run past the estimate. An estimate already under it stays.
  const TICK_FLOOR_SECONDS = 30;
  function tickedTimeLeft(left, waited) {
    if (left === null || !Number.isFinite(left)) return null;
    return Math.max(Math.min(left, TICK_FLOOR_SECONDS), left - Math.max(0, waited || 0));
  }

  // Seconds left, at least what the work left is expected to take. A run's pace so far
  // says little about what follows it: 142 sources at 2 s would promise 14 min with 39
  // min of notes and chat to go. rest: restCounts, or nothing when the run is one kind.
  function honestTimeLeft(done, total, elapsedSeconds, rest, citationDetail) {
    const pace = timeLeft(done, total, elapsedSeconds);
    return pace === null ? null : Math.max(pace, estimateSeconds(rest, citationDetail));
  }

  // The time to show next. shown: the last time shown; fresh: timeLeft now; waited:
  // seconds since. The shown time counts down by itself and moves a quarter of the way
  // to a fresh figure that disagrees, so one slow or fast item cannot throw it about.
  function calmTimeLeft(shown, fresh, waited) {
    if (fresh === null) return null;
    if (shown === null) return fresh;
    const expected = Math.max(0, shown - waited);
    return expected + (fresh - expected) * 0.25;
  }

  // The line under the bar. Nothing until there is a time; with no items left the
  // rest is the save, whose length is not known, so it never reads as "0 left".
  function progressLeftLine(done, total, seconds, { finishing = false } = {}) {
    if (finishing || (total > 0 && done >= total)) return 'Finishing';
    return seconds === null ? '' : `${formatEstimate(seconds)} left`;
  }

  // "N of M" and the bar. Only the results say M of M: the last item is not the end,
  // since the save comes after it.
  function progressFigures(done, total) {
    if (!(total > 0)) return { count: '', percent: 0 };
    const shown = Math.min(Math.max(0, done), total - 1);
    return { count: `${shown} of ${total}`, percent: Math.min(99, (Math.max(0, done) / total) * 100) };
  }

  // How long a change to a live region waits, so a screen reader gets one every
  // minMs: 0 means now. lastAt: when the last one went out, null for never.
  function announceDelay(lastAt, now, minMs) {
    return lastAt === null ? 0 : Math.max(0, lastAt + minMs - now);
  }

  // A takeout's "N of M", from its categories. null when a scan failed before it found
  // anything: that category's items are in neither number, so "3 of 3" would be false.
  function takeoutCount(categories = []) {
    if (categories.some(c => c.status === 'failed' && !c.selected)) return null;
    return {
      done: categories.reduce((sum, c) => sum + (c.exported || 0), 0),
      total: categories.reduce((sum, c) => sum + (c.selected || 0), 0)
    };
  }

  // The short toast that points at the results
  function resultsToast(level) {
    if (level === 'error') return 'Export failed: see the results';
    if (level === 'warning') return 'Export did not finish cleanly: see the results';
    return 'Export finished';
  }

  // What Export everything counts, from Home's counts (null: not known) and the loaded
  // chat, if any. Generated's list holds the notes too, so its own items are the rest.
  function homeEstimateCounts(tabCounts, chatCount = null) {
    const known = n => (Number.isFinite(n) ? n : null);
    const { sources, notes, studio } = tabCounts || {};
    const bothKnown = known(notes) !== null && known(studio) !== null;
    return { sources: known(sources), notes: known(notes), generated: bothKnown ? Math.max(0, studio - notes) : null, chat: known(chatCount) };
  }

  // True when a tab's URL names another notebook than the one the panel shows. A URL
  // with no notebook id is not "another notebook": other checks cover being off a
  // notebook. panelId '' means the panel holds none, so any notebook differs.
  function tabLeftPanelNotebook(url, panelId) {
    const id = notebookIdFromUrl(url);
    return !!id && id !== panelId;
  }

  // A row's download must not start: the tab has moved on, or a page is loading in it
  function rowRefused({ url, panelNotebookId, held }) {
    return !!held || tabLeftPanelNotebook(url, panelNotebookId);
  }

  // A Retry must not start: another notebook is in front, or the run's own tab, which
  // it would run on, shows one. Another site in front is fine, and a closed tab is the
  // export shell's to report.
  function retryRefused({ notebookId, activeUrl, runTabUrl }) {
    if (!notebookId) return false;
    return tabLeftPanelNotebook(activeUrl, notebookId) || tabLeftPanelNotebook(runTabUrl, notebookId);
  }

  // The export sheet's state when it opens: the default preset, Custom's remembered
  // values and the default save.
  function sheetChoice(settings = {}) {
    return {
      preset: PRESETS.includes(settings.exportPreset) ? settings.exportPreset : 'archive',
      citationDetail: settings.citationDetail === undefined ? 'quotes' : settings.citationDetail,
      obsidianNames: !!settings.obsidianNames,
      images: settings.customImages !== false,
      zip: takeoutZipChoice(settings)
    };
  }

  // What the sheet's state runs: `overrides` for withRunSettings, `zip` for the job. A
  // choice is for this run: nothing here or in the sheet writes settings.
  function sheetOverrides(choice = {}, settings = {}) {
    const { preset, citationDetail, obsidianNames, images, zip } = { ...sheetChoice(settings), ...choice };
    return { overrides: presetOverrides(preset, { citationDetail, obsidianNames, images }), zip: !!zip };
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

  // The icon names a Thoughts section shows (mat-icon text, seen live:
  // neurology, document_search; and the header's chevrons). Only these are
  // dropped, never another one-word title.
  const THOUGHT_ICON_NAMES = new Set(['neurology', 'document_search', 'expand_more', 'expand_less',
    'keyboard_arrow_down', 'keyboard_arrow_up', 'chevron_right', 'arrow_drop_down']);
  function isThoughtIconName(text) {
    return THOUGHT_ICON_NAMES.has(String(text || '').trim());
  }

  // Do these blocks (outermost, in page order) hold all of the element's
  // text? Whitespace aside, their texts joined must be the element's text:
  // any heading, line or separator outside them means no.
  function blocksCoverText(blockTexts, wholeText) {
    const squeeze = text => String(text || '').replace(/\s+/g, '');
    return (blockTexts || []).map(squeeze).join('') === squeeze(wholeText);
  }

  // ---------- Web sources (1.9.6) ----------
  // A web or web-PDF source shows no type icon in the source list, only a
  // favicon: https://www.google.com/s2/favicons?domain=<original URL>. The
  // original URL (never the favicon URL) goes into the export.
  // Live, the source list's favicon carries the URL raw (its own ? & + left
  // as they are), the chat's percent-encoded: the text after domain= up to
  // &sz= (or the end) is read as written, and decoded once only when it is
  // encoded (no "://" but %XX). URLSearchParams is not used: it reads + as a
  // space. null for anything that is not http(s), has no domain, or is a
  // Google-hosted download or redirect link (never a source's public page);
  // a bare host gives its root, https://<host>/.
  function sourceUrlFromFavicon(src) {
    const text = String(src || '');
    let favicon;
    try { favicon = new URL(text); } catch (error) { return null; }
    if (!/^https?:$/.test(favicon.protocol)) return null;
    const at = text.search(/[?&]domain=/);
    if (at < 0) return null;
    const rest = text.slice(at + '?domain='.length);
    const stop = rest.indexOf('&sz=');
    let value = (stop >= 0 ? rest.slice(0, stop) : rest).replace(/#.*$/, '').trim();
    if (!value.includes('://') && /%[0-9a-f]{2}/i.test(value)) {
      try { value = decodeURIComponent(value); } catch (error) { return null; }
    }
    value = value.trim();
    if (!value) return null;
    let candidate;
    if (/^[a-z][\w+.-]*:/i.test(value)) {
      if (!/^https?:\/\//i.test(value)) return null;
      candidate = value;
    } else if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(value)) {
      candidate = `https://${value}`;
    } else {
      return null;
    }
    let url;
    try { url = new URL(candidate); } catch (error) { return null; }
    if (!/^https?:$/.test(url.protocol) || !url.hostname) return null;
    return isGoogleDownloadUrl(url) ? null : url.href;
  }

  // One source row of the panel: its type icon and, for a web source, the
  // original URL. The type is the text of the row's type icon, a mat-icon
  // (video_youtube, drive_pdf, ...), 'document' when there is none. Live
  // (1.9.7), a web row's favicon is <img class="source-item-source-icon
  // favicon-icon">: it carries the type-icon class but is no type icon, so an
  // <img> is never read as one. A row without a type icon gets webUrl from
  // its img.favicon-icon (the decoded URL only, never the favicon address).
  // container: an element with querySelector(All). { type, webUrl|null }
  function sourceRowIcon(container) {
    if (!container) return { type: 'document', webUrl: null };
    const iconEl = Array.from(container.querySelectorAll('.source-item-source-icon') || [])
      .find(el => el.tagName !== 'IMG') || null;
    const type = String(iconEl?.textContent || '').trim() || 'document';
    const webUrl = iconEl ? null : sourceUrlFromFavicon(container.querySelector('img.favicon-icon')?.getAttribute('src'));
    return { type, webUrl };
  }

  // A google.com/url?q=<target> redirect (the sources' links come wrapped) is
  // written as its real address. Only an http(s) target counts; anything else,
  // and every non-redirect, comes back unchanged.
  function unwrapGoogleRedirect(href) {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return href;
    let url;
    try { url = new URL(href); } catch (error) { return href; }
    const host = url.hostname.toLowerCase();
    if ((host !== 'google.com' && host !== 'www.google.com') || url.pathname !== '/url') return href;
    const target = url.searchParams.get('q') || url.searchParams.get('url') || '';
    return /^https?:\/\/[^\s/]/i.test(target) ? target : href;
  }

  // A heading's Markdown without bold: a bold heading is no more than a
  // heading, and its joined bold runs leave "**A** **B**". Code spans are
  // kept as they are; escaped asterisks are text and stay.
  function plainHeading(content) {
    const text = String(content ?? '');
    if (!text.includes('**')) return text;
    const stripped = text.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : part.replace(/(?<!\\)\*\*/g, ''))).join('');
    return stripped === text ? text : stripped.replace(/ {2,}/g, ' ').trim();
  }

  // Google-hosted downloads and redirects: *.usercontent.google.com,
  // *.googleusercontent.com, google.com/url, and *.google.com links that
  // download (private, short-lived; never a source's original page)
  function isGoogleDownloadUrl(url) {
    const host = url.hostname.toLowerCase();
    if (/(^|\.)usercontent\.google\.com$/.test(host) || /(^|\.)googleusercontent\.com$/.test(host)) return true;
    if ((host === 'google.com' || host === 'www.google.com') && /^\/url\b/.test(url.pathname)) return true;
    return /(^|\.)google\.com$/.test(host) && /download/i.test(url.pathname + url.search);
  }

  // 'web_pdf' when the URL's path ends in .pdf, else 'web'
  function webSourceType(url) {
    try { return /\.pdf$/i.test(new URL(url).pathname) ? 'web_pdf' : 'web'; } catch (error) { return 'web'; }
  }

  // A scanned source's front matter type and URL. A web source (webUrl from
  // its favicon): web / web_pdf and the URL. Others: the page's type icon,
  // with the scan's default 'document' left out, and no URL (as before 1.9.6).
  function sourceTypeFields(source) {
    const s = source || {};
    if (s.webUrl) return { sourceType: webSourceType(s.webUrl), sourceUrl: s.webUrl };
    return { sourceType: s.type === 'document' ? null : s.type || null, sourceUrl: null };
  }

  // A web source's line under the title of its Markdown, like a YouTube
  // source's "**YouTube Video:** <url>" (1.9.7): "**Web Page:** <url>" or,
  // for web_pdf, "**Web PDF:** <url>", the URL in angle brackets (an
  // autolink), so a trailing "." or ")" stays part of the link. url.href
  // never holds a space, < or >. fields: NLME.sourceTypeFields'
  // { sourceType, sourceUrl }. Any other source: ''.
  function sourceWebLine(fields) {
    const { sourceType, sourceUrl } = fields || {};
    if (!sourceUrl) return '';
    if (sourceType === 'web') return `**Web Page:** <${sourceUrl}>\n\n`;
    if (sourceType === 'web_pdf') return `**Web PDF:** <${sourceUrl}>\n\n`;
    return '';
  }

  // A web source's line in the Sources _index.md: its URL as a link (the
  // target's parentheses encoded so the link stays whole)
  function sourceOriginalLine(url) {
    if (!url) return '';
    const text = String(url).replace(/([\\`*_[\]<>])/g, '\\$1');
    const target = String(url).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
    return `**Original:** [${text}](${target})\n\n`;
  }

  // ---------- Source import cards (1.9.6) ----------
  // A chat answer's a2ui-source-import-card: "Report & Outside sources (5)",
  // the names ("Research Report, Open Logic Project, and nLab, +2"), a status
  // ("All sources imported") and a row of remote favicons. Written as one
  // italic line, never as images.
  const IMPORT_CARD_ICONS = new Set(['check_circle', 'error', 'progress_activity', 'add', 'check', 'warning']);
  const IMPORT_CARD_STATUS = /\b(import|imported|importing|added|adding|failed|selected|in progress)\b/i;

  // The card's text lines (one per block, icons out): the first is the
  // heading; a status-like last line (beyond the heading) is the status; the
  // rest are the names
  function importCardFromLines(lines) {
    const clean = (lines || []).map(line => String(line || '').replace(/\s+/g, ' ').trim())
      .filter(line => line && !IMPORT_CARD_ICONS.has(line));
    const heading = clean.shift() || '';
    const status = clean.length > 0 && IMPORT_CARD_STATUS.test(clean[clean.length - 1]) ? clean.pop() : '';
    return { heading, names: clean.join(' '), status };
  }

  function importCardMarkdown({ heading = '', names = '', status = '' } = {}) {
    const tidy = text => String(text || '').replace(/\s+/g, ' ').trim().replace(/([\\`*_[\]<>])/g, '\\$1');
    const stop = text => (/[.!?…]$/.test(text) ? text : `${text}.`);
    const [h, n, s] = [heading, names, status].map(tidy);
    const lead = h && n ? `${h}: ${n}` : (h || n);
    const parts = [lead, s].filter(Boolean).map(stop);
    return parts.length > 0 ? `*${parts.join(' ')}*` : '';
  }

  // A favicon service URL (Google's s2/favicons, gstatic faviconV2): never
  // worth keeping, not even as a link
  function isFaviconServiceUrl(url) {
    let parsed;
    try { parsed = new URL(String(url || '')); } catch (error) { return false; }
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if ((host === 'google.com' || host === 'www.google.com') && parsed.pathname.startsWith('/s2/favicons')) return true;
    return /(^|\.)gstatic\.com$/.test(host) && parsed.pathname.startsWith('/faviconV2');
  }

  // A -with-images version keeps no remote image: one still remote after
  // embedding becomes a plain link with its alt text ("[image]" without
  // one), a favicon is dropped; an image that is a link's text gives that
  // link the alt as its text. data: and relative images stay, and nothing
  // inside a code span or fence is touched. Titles and <targets> are read.
  // Without a remote image the text comes back unchanged.
  // Linear on text full of unclosed marks: an alt stops at any unescaped
  // bracket and a target at a space or bracket, so neither needs a length
  // bound (a failed download's long URL as alt still matches); only quoted
  // titles, which could run to the end, are bounded (2000 characters)
  const MD_IMAGE = String.raw`!\[((?:\\.|[^\[\]\\])*)\]\(\s*(?:<([^>\n]*)>|((?:[^\s()<>]|\([^\s()<>]*\))+))(\s+(?:"(?:\\.|[^"\\]){0,2000}"|'(?:\\.|[^'\\]){0,2000}'|\((?:\\.|[^()\\]){0,2000}\)))?\s*\)`;
  const LINKED_IMAGE_RE = new RegExp(String.raw`\[\s*${MD_IMAGE}\s*\]\(`, 'g');
  const IMAGE_RE = new RegExp(MD_IMAGE, 'g');
  const isRemoteImageUrl = url => /^https?:\/\//i.test(String(url || '').trim());

  // A raw <img> whose src is remote (viewer data only, imgTags)
  const REMOTE_IMG_SRC_RE = /(<img\b[^>]{0,2000}?\bsrc\s*=\s*)(["']?)\s*https?:[^"'\s>]*\2/gi;
  const HAS_IMAGE_RE = /!\[|<img\b/i;

  // emptyImage: the viewer's form, a remote image becomes ![alt]() (its
  // "not available offline" placeholder) instead of a link. imgTags: a raw
  // <img> with a remote src keeps its alt and gets src="" (viewer data).
  function finishRemoteImagesInText(text, emptyImage = false, imgTags = false) {
    if (imgTags && /<img\b/i.test(text)) text = text.replace(REMOTE_IMG_SRC_RE, (m, head) => `${head}""`);
    if (!/!\[/.test(text)) return text;
    return text
      .replace(LINKED_IMAGE_RE, (match, alt, angled, bare) => {
        const url = angled ?? bare;
        if (!isRemoteImageUrl(url)) return match;
        if (emptyImage) return isFaviconServiceUrl(url.trim()) ? `[${alt.trim() || 'link'}](` : `[![${alt}]()](`;
        const label = alt.trim() || (isFaviconServiceUrl(url.trim()) ? 'link' : 'image');
        return `[${label}](`;
      })
      .replace(IMAGE_RE, (match, alt, angled, bare, title) => {
        const url = angled ?? bare;
        if (!isRemoteImageUrl(url)) return match;
        if (isFaviconServiceUrl(url.trim())) return '';
        if (emptyImage) return `![${alt}]()`;
        const target = angled !== undefined ? `<${angled}>` : bare;
        return `[${alt.trim() || 'image'}](${target}${title || ''})`;
      });
  }

  function finishRemoteImages(markdown, { emptyImage = false, imgTags = false } = {}) {
    const text = String(markdown);
    if (!(imgTags ? HAS_IMAGE_RE : /!\[/).test(text)) return text;
    // Fenced code blocks (``` or ~~~, up to three spaces in) stay as they are
    const out = [];
    let fence = null;
    let prose = [];
    const flushProse = () => {
      if (prose.length === 0) return;
      // Inline code spans stay too: only the text between them is rewritten.
      // An escaped backtick (Turndown writes a literal one as \`) opens no
      // span, and a span never runs past a blank line.
      const chunk = prose.join('\n');
      const parts = chunk.split(/((?<![\\`])(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\2(?!`))/);
      const rebuilt = [];
      for (let i = 0; i < parts.length; i++) {
        if (i % 3 === 0) rebuilt.push(finishRemoteImagesInText(parts[i], emptyImage, imgTags));
        else if (i % 3 === 1) rebuilt.push(parts[i]);
      }
      out.push(rebuilt.join(''));
      prose = [];
    };
    for (const line of text.split('\n')) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        out.push(line);
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null;
      } else if (marker) {
        flushProse();
        out.push(line);
        fence = marker[1];
      } else {
        prose.push(line);
      }
    }
    flushProse();
    return out.join('\n');
  }

  // The -with-images pass: embed what was downloaded, then finishRemoteImages
  function embedImagesForVersion(markdown, embeds) {
    return finishRemoteImages(applyImageEmbeds(markdown, embeds));
  }

  // Where a chat answer's "Thoughts" section was: content.js puts this in
  // place of the page's thinking-chain-view, and the chat converter writes
  // thoughtsMarkdown there. It keeps the word, so any other converter writes
  // what 1.9.5 wrote.
  const THOUGHTS_PLACEHOLDER_HTML = '<div data-nlme-thoughts="">Thoughts</div>';

  // A thought that writes about the tags themselves must not open or close
  // the section: <details, </details, <summary and </summary (any case)
  // become &lt;... outside code spans and fenced code, where they stay as
  // written (code shows them literally anyway).
  function escapeSectionTags(text) {
    // a code span (a run of backticks up to the same run) is kept; a tag outside one is escaped
    const spanOrTag = /(`+)[^`]*?(?:`(?!\1)[^`]*?)*?\1(?!`)|<(\/?)(details|summary)\b/gi;
    let fence = null;
    return String(text).split('\n').map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
        return line;
      }
      if (marker) { fence = marker[1]; return line; }
      return line.replace(spanOrTag, (match, ticks, slash, name) => (ticks ? match : `&lt;${slash}${name}`));
    }).join('\n');
  }

  // A chat answer's Thoughts as one collapsed section (1.9.7): a <details>
  // block without "open" whose summary is "Thoughts", then per thought its
  // bold title and its body as Markdown, parts separated by blank lines.
  // thoughts: [{ title, body }]; a step line ("Searched your sources") is a
  // title with an empty body. Icon names are left out. No thoughts: ''.
  function thoughtsMarkdown(thoughts) {
    const blocks = [];
    for (const thought of Array.isArray(thoughts) ? thoughts : []) {
      let title = String(thought?.title || '').replace(/\s+/g, ' ').trim();
      if (isThoughtIconName(title)) title = '';
      const body = String(thought?.body || '').replace(/\r\n?/g, '\n')
        .split('\n').map(line => line.replace(/\s+$/, '')).join('\n')
        .trim().replace(/\n{3,}/g, '\n\n');
      if (title) blocks.push(`**${escapeSectionTags(title)}**`);
      if (body.trim()) blocks.push(escapeSectionTags(body));
    }
    if (blocks.length === 0) return '';
    return ['<details>\n<summary>Thoughts</summary>', ...blocks, '</details>'].join('\n\n');
  }

  // Scan problems that lead a chat export's errors.md: messages that could
  // not be read, citation groups still collapsed (not with citations 'none',
  // which drops them on purpose) and answers whose Thoughts could not be read
  function chatScanErrors(stats, citationMode) {
    const s = stats || {};
    const errors = (s.skipped || []).map(message => ({ type: 'message_skipped', message }));
    if (citationMode !== 'none' && s.collapsedRemaining > 0) {
      errors.push({ type: 'collapsed_citations', message: `${s.collapsedRemaining} citation group(s) were still collapsed after the scan; their citations are missing` });
    }
    for (const message of s.thoughtsUnread || []) errors.push({ type: 'thoughts_unread', message });
    return errors;
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

  // What one part of a split export added to a run-wide audit: current minus
  // the snapshot taken when the previous part was packaged. Keeps every numeric
  // field of the audit shape (expected/written counters, cacheHits, cachedItems).
  function diffAudit(current, before) {
    const sub = (a, b) => {
      const out = {};
      for (const key of Object.keys(a || {})) {
        out[key] = (a[key] && typeof a[key] === 'object')
          ? sub(a[key], (b || {})[key])
          : (Number(a[key]) || 0) - (Number((b || {})[key]) || 0);
      }
      return out;
    };
    return sub(current, before);
  }

  // The audit of one part of a split export: the run-wide audit minus the
  // snapshot from the previous part, with this part's own item counts
  // (items attempted, items written) instead of the run-wide ones.
  function partAudit(current, before, { attempted, written }) {
    const part = diffAudit(current, before);
    part.expected.items = attempted;
    part.written.items = written;
    return part;
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

  // Turndown escapes every [ and ], but math viewers read \[ ... \] as display
  // math: "[Resolution #1]" became a MathJax error in Markdown Viewer. Frees a
  // bracket pair in one text node unless it could become Markdown: a link
  // ("](", "][", "]:"), a footnote ("[^"), a task box ("[ ]", "[x]"), an empty
  // pair, or nested brackets such as an Obsidian [[link]].
  function relaxBracketEscapes(text) {
    return String(text).replace(
      /(?<!\\|\\\[)\\\[((?:[^\\\[\]]|\\[^\[\]])+)\\\](?![(\[:]|\\[\[\]])/g,
      (match, inner) => (/^\^|^[ xX]$/.test(inner) ? match : `[${inner}]`)
    );
  }

  // One list item's Markdown. Lines after the first hold the item's nested list
  // or later paragraphs: they indent to the item's text, or a nested list would
  // come out as siblings of its parent.
  function listItemMarkdown(marker, content) {
    const indent = ' '.repeat(marker.length + 1);
    return `${marker} ${content.replace(/\n(?=.)/g, `\n${indent}`)}\n`;
  }

  // The page reads "$3-$4 million" as math and draws "3-" as a formula. The
  // export's text is still "$3-$4 million", a price, so the audit leaves these
  // out of both counts (countPageContent, markWrittenFormula).
  function isPriceRangeFragment(tex) {
    return /^\d[\d.,]*(?:\s*(?:thousand|million|billion|k|m|b))?\s*(?:[-–—]|to|or|and)$/i.test(String(tex ?? '').trim());
  }

  // Sentences and Cyrillic text the page drew as math ("Printed on acid-free
  // paper ... TCF ∞", "BΒOД"). Real TeX here has a backslash, ^ _ { } or =;
  // these have none and read as words. Written as plain text, and left out of
  // both audit counts like a price range.
  const MATH_FUNCTION_NAMES = new Set('sin cos tan cot sec csc log ln exp max min sup inf lim det gcd lcm mod arg deg dim ker hom'.split(' '));
  function isProseMath(tex) {
    const t = String(tex ?? '').trim();
    if (!t || /[\\^_{}=]/.test(t)) return false;
    return /[\u0400-\u04FF]/.test(t) || (t.match(/\p{L}{3,}/gu) || []).filter(w => !MATH_FUNCTION_NAMES.has(w)).length >= 3;
  }

  // The audit's "written" formulas are the ones the converter wrote, not a
  // re-read of the Markdown: a formula touching a number ($1 micron (μm):
  // 10-6 m$1 nanometre) looks like a price to any regex. The KaTeX rule marks
  // each formula it writes with a private-use sentinel; convert() takes the
  // marks out of its final text and counts them. Output a nested list or
  // table rule converted and then threw away never reaches that text, so
  // every formula counts once. A price range the page drew as math is left
  // unmarked, as countPageContent leaves it out of the page's count.
  const FORMULA_MARK = '\uE002';
  const FORMULA_MARK_BEFORE_DOLLAR = /\uE002(?=\$)/g;

  function markWrittenFormula(markdown, dataMath) {
    if (!markdown || isPriceRangeFragment(dataMath) || isProseMath(dataMath)) return markdown;
    return FORMULA_MARK + markdown;
  }

  // { text without marks, formulas: how many were marked }. A mark always
  // precedes the formula's opening $; a U+E002 anywhere else is the page's own
  // text and stays.
  function takeFormulaMarks(text) {
    let formulas = 0;
    const out = String(text ?? '').replace(FORMULA_MARK_BEFORE_DOLLAR, () => { formulas++; return ''; });
    return { text: out, formulas };
  }

  // Formulas in final Markdown ($$...$$ and $...$), each counted once,
  // however many times the converter ran on nested lists or tables. The
  // audit's counter until 1.9.5; the panel no longer calls it, since it misses
  // a formula that opens on a digit and ends before one (markWrittenFormula).
  // A formula may touch words ($x$rad, a$b$). A price is a $ and a digit, so
  // a span that opens on a digit must not close before a digit ($400 ... $500);
  // other spans may ($T$2).
  function countMarkdownFormulas(markdown) {
    const re = /\$\$[\s\S]+?\$\$|(?<![\\$])\$(?:(?=\d)[^$\n]+?(?<!\s)\$(?![\d$])|(?![\s\d])[^$\n]+?(?<!\s)\$(?!\$))/g;
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

  // The Sources section of a titles-only export: one line per source with
  // all its numbers; every number keeps its own anchor so body links still
  // resolve. anchorPrefix: '' for notes, 'msg-<n>-' for a chat answer.
  function groupedSourcesMarkdown(entries, anchorPrefix = '') {
    let out = '';
    for (const group of groupCitationEntries(entries)) {
      const anchors = group.numbers.map(n => `<a id="${anchorPrefix}src-${n}"></a>`).join('');
      const links = group.numbers.map(n => `[[${n}]](#${anchorPrefix}cite-ref-${n}-1)`).join(' ');
      out += `${anchors}\n**${links}** ${group.text}\n\n`;
    }
    return out;
  }

  // ---- Footnote citations (Milestone 3d, ⚙️ Citation style: Footnotes) ----
  // A marker is [^LABEL] and the Sources section holds one definition per
  // label. Labels must be unique per FILE: citation numbers restart in every
  // note and every chat answer, so a combined file prefixes the item number.

  // itemIndex: 0-based note (or chat answer) in the file. combined: the file
  // holds several items. Single-item files keep the plain number ('3'),
  // combined ones get '<item>-<n>' ('2-3'). Characters a label cannot carry
  // (whitespace, [ ] ^) become dashes; digits, the normal case, are untouched.
  function footnoteLabel(itemIndex, n, { combined = false } = {}) {
    const num = String(n).replace(/[\s\[\]^]+/g, '-');
    return combined ? `${(Number(itemIndex) || 0) + 1}-${num}` : num;
  }

  // '[^LABEL]: **Title** \u2014 quote'. The quote stays inline: its
  // continuation lines are indented by 4 spaces (blank lines stay empty), as
  // CommonMark footnotes and Obsidian require. No quote: just the title; no
  // title: just the quote.
  function footnoteDefinition(label, title, quote) {
    const head = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().replace(/\*/g, '\\*');
    // Continuation lines lose their own leading whitespace, so a quote line
    // never turns into an indented code block inside the definition
    const body = String(quote == null ? '' : quote).replace(/\r\n?/g, '\n').trim()
      .split('\n').map((line, i) => (i === 0 || !line.trim() ? line.trimEnd() : `    ${line.trim()}`)).join('\n');
    const lead = `[^${label}]:`;
    if (head && body) return `${lead} **${head}** \u2014 ${body}`;
    if (head) return `${lead} **${head}**`;
    return body ? `${lead} ${body}` : `${lead} **(untitled source)**`;
  }

  // The definitions for Sources entries ({number, text, quote?}): one per
  // number, in the entries' order, even when several numbers share a title
  // (every [^label] reference needs its own definition). labelOf(number)
  // gives the label; quoteOf(entry) the quote text to use (default: none for
  // placeholders). Returns '' for no entries.
  function footnoteDefinitions(entries, labelOf, { quoteOf = e => (e.missing ? '' : e.quote) } = {}) {
    const seen = new Set();
    let out = '';
    for (const entry of entries || []) {
      const number = String(entry.number);
      if (seen.has(number)) continue;
      seen.add(number);
      out += `${footnoteDefinition(labelOf(number), entry.text, quoteOf(entry))}\n\n`;
    }
    return out;
  }

  // The citation popover of a long, unpunctuated source (a YouTube
  // transcript) shows only a window of about 1,000 characters, cut
  // mid-word. Mark such a quote with "\u2026" where it was cut. Short
  // quotes, and ones that start with a capital or end with punctuation,
  // are left alone.
  function markWindowedQuote(text, { min = 990 } = {}) {
    const raw = text == null ? '' : String(text);
    const t = raw.trim();
    // Image Markdown (a base64 data URI can be huge) is not quote text: measure
    // and test the ends without it
    const bare = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
    if (bare.length < min) return raw;
    // "1. foo" starts a Markdown list: a leading mark would break the marker
    const head = /^[\p{Ll}\p{Nd}]/u.test(t) && !/^\d+[.)]\s/.test(t) ? '\u2026' : '';
    const tail = /[\p{L}\p{N}]$/u.test(t) ? '\u2026' : '';
    return head || tail ? head + t + tail : raw;
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
  // `obsidian` (4th parameter): the "Obsidian-friendly file names" option, see
  // obsidianSafeName. Off, the stems are exactly as before.
  // `taken` (4th parameter, optional): a Set of folded names that outlives one
  // call. A job that splits into parts shares one Set across the parts, so a
  // name used in part 1 is numbered in part 2 and one unzipped folder never
  // holds two files of one name. It is read and added to; `reserved` stays
  // per call and is not added to it.
  function uniqueStems(titles, suffixes = [], reserved = [], { obsidian = false, taken = null } = {}) {
    // Names compare as NFC, lower-cased: "Café" typed as e + combining accent
    // and as the single é look identical and collide on a macOS disk
    const fold = name => String(name).normalize('NFC').toLowerCase();
    const used = taken instanceof Set ? taken : new Set();
    const held = new Set((reserved || []).map(fold));
    const endings = ['', ...suffixes];
    const names = candidate => endings.map(s => fold(candidate + s));
    return (titles || []).map(title => {
      const base = fileStem(title, { obsidian });
      let candidate = base;
      for (let n = 2; names(candidate).some(name => used.has(name) || held.has(name)); n++) candidate = `${base}-${n}`;
      names(candidate).forEach(name => used.add(name));
      return candidate;
    });
  }

  // The notebook's UUID from its URL, for the manifest and front matter.
  function notebookIdFromUrl(url) {
    const m = String(url || '').match(/\/notebook\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  // The panel's list tabs, in order. A view is 'home' or one of these.
  const PANEL_TABS = ['sources', 'notes', 'studio', 'chat'];

  // The view the panel opens on: the last list only when it was this notebook's.
  // A stored value of any other shape, or a tab that no longer exists, means Home.
  function openingView(stored, notebookId) {
    if (!stored || !notebookId || stored.notebookId !== notebookId) return 'home';
    return PANEL_TABS.includes(stored.view) ? stored.view : 'home';
  }

  // openingView, unless the notebook has an export to resume: Resume is on Home,
  // and a panel reopened on a list would never show it
  function panelOpenView(stored, notebookId, resumable) {
    return resumable ? 'home' : openingView(stored, notebookId);
  }

  // A Home row's count. null is not known yet (it never reads as a number); Chat
  // is never scanned from Home, so it offers Load until the Chat tab has loaded.
  // available false: off a notebook nothing is shown, the count is only kept.
  function homeCountText(tab, count, available = true) {
    if (!available) return '\u2014';
    if (count == null) return tab === 'chat' ? 'Load' : '\u2014';
    return Number(count).toLocaleString('en-US');
  }

  // What one read of a list means on Home. The page draws its lists late, and an
  // undrawn list reads as 0, so a 0 is shown as not known and read again; once the
  // attempts run out it is believed, so an empty notebook settles. A list proved
  // empty needs no second proof. A failed read (found null) is never a number.
  function homeCountRead({ found, confirmedZero = false, attemptsLeft = 0 }) {
    if (found == null) return { show: null, retry: attemptsLeft > 0, zeroConfirmed: false, failed: true };
    if (found > 0) return { show: found, retry: false, zeroConfirmed: false, failed: false };
    if (confirmedZero || attemptsLeft <= 0) return { show: 0, retry: false, zeroConfirmed: true, failed: false };
    return { show: null, retry: true, zeroConfirmed: false, failed: false };
  }

  // The one line Home shows above its rows, by what stands in the way
  function homeNotice({ onSite = false, onNotebook = false, itemOpen = false, readFailed = false } = {}) {
    if (!onSite) return 'open-site';
    if (!onNotebook) return 'open-notebook';
    if (itemOpen) return 'item-open';
    return readFailed ? 'read-failed' : '';
  }

  // Run an async load, and once more after waitMs if it throws. True when it worked.
  async function loadWithRetry(load, { sleep, waitMs }) {
    try {
      await load();
      return true;
    } catch (_) { /* once more below */ }
    await sleep(waitMs);
    try {
      await load();
      return true;
    } catch (_) {
      return false;
    }
  }

  // The side panel header's text: the notebook's name on a notebook page, else
  // "Open a notebook" (no URL, another site, or Gemini Notebook's home page,
  // which has a notebook host but no notebook id).
  function headerName(url, projectName) {
    if (!isNotebookUrl(url) || !notebookIdFromUrl(url)) return 'Open a notebook';
    return shownNotebookName(projectName) || 'Notebook';
  }

  // The notebook's name as the panel shows it, '' when unknown. 'NotebookLM' is
  // getProjectName's fallback for export file names (kept for byte-identical
  // exports), never a name to show.
  const FILE_NAME_FALLBACK = 'NotebookLM';
  function shownNotebookName(projectName) {
    const name = String(projectName || '').trim();
    return name === FILE_NAME_FALLBACK ? '' : name;
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

  // ---- Job records (Milestone 3c): one per notebook in chrome.storage.local ----
  // List keys only (listItemKeys), never payloads. See AGENT.md "Milestone 3c contracts".

  function jobRecordKey(notebookId) {
    return `nlme.job.${notebookId}`;
  }

  // overrides: the run's (withRunSettings), for a Resume; none outside a run. zip: the
  // run's save choice, for a job that has one (see jobRecordZip).
  function newJobRecord({ id, kind, label, notebookId, keysByCategory, now, overrides = null, zip }) {
    const remaining = {};
    const failed = {};
    for (const [category, keys] of Object.entries(keysByCategory || {})) {
      remaining[category] = [...keys];
      failed[category] = [];
    }
    // total: how many keys the job started with (the banner's "stopped at N of total")
    const total = Object.values(remaining).reduce((sum, keys) => sum + keys.length, 0);
    return { id, kind, label, notebookId, startedAt: now, updatedAt: now, total, remaining, failed, ...(overrides ? { overrides } : {}), ...(typeof zip === 'boolean' ? { zip } : {}) };
  }

  // A new record with `key` done: removed from remaining, and from failed unless
  // it failed again (a later success clears an earlier failure).
  function markJobItem(record, category, key, { failed = false, now } = {}) {
    const without = list => (list || []).filter(k => k !== key);
    return {
      ...record,
      updatedAt: now,
      remaining: { ...record.remaining, [category]: without(record.remaining && record.remaining[category]) },
      failed: { ...record.failed, [category]: failed ? [...without(record.failed && record.failed[category]), key] : without(record.failed && record.failed[category]) }
    };
  }

  // markJobItem for several keys of one category, ignoring keys the record does
  // not hold (a retry or resume marks only what the record knows). Returns the
  // same record when nothing matched.
  function markJobItems(record, category, keys, { failed = false, now } = {}) {
    const holds = key => ((record.remaining && record.remaining[category]) || []).includes(key)
      || ((record.failed && record.failed[category]) || []).includes(key);
    const known = (keys || []).filter(holds);
    return known.reduce((rec, key) => markJobItem(rec, category, key, { failed, now }), record);
  }

  function jobRemainingCount(record) {
    const count = group => Object.values(group || {}).reduce((sum, keys) => sum + keys.length, 0);
    return count(record.remaining) + count(record.failed);
  }

  function jobRecordFinished(record) {
    return jobRemainingCount(record) === 0;
  }

  // How a fresh (non-update) export of `kind` meets the notebook's stored record
  // (the key is per notebook). 'update': the stored record is usable, of another
  // kind and still has items, so it must not be replaced (a Full Takeout always
  // creates its own); the export only marks
  // the keys that record holds. 'create': it replaces the record (same kind,
  // finished, or nothing usable stored).
  function jobRecordMode(stored, kind) {
    const arrays = group => !!group && typeof group === 'object' && !Array.isArray(group) && Object.values(group).every(Array.isArray);
    if (!stored || typeof stored !== 'object' || !arrays(stored.remaining) || !arrays(stored.failed)) return 'create';
    // A Full Takeout re-exports everything, so it supersedes any pending record
    if (kind === 'takeout') return 'create';
    return stored.kind !== kind && jobRemainingCount(stored) > 0 ? 'update' : 'create';
  }

  // A stored record the banner may offer: an object for this notebook whose
  // remaining / failed are { category: keys[] } and which still has items.
  // Storage data is not trusted, so anything else is not usable.
  function jobRecordUsable(record, notebookId) {
    const arrays = group => !!group && typeof group === 'object' && !Array.isArray(group) && Object.values(group).every(Array.isArray);
    return !!record && typeof record === 'object' && !!notebookId && record.notebookId === notebookId
      && typeof record.id === 'string' && arrays(record.remaining) && arrays(record.failed)
      && jobRemainingCount(record) > 0;
  }

  // The overrides a Resume runs on: what the person chose when the job started, not
  // today's default. A record from before 1.9.3 has none and runs on today's settings;
  // a takeout's still runs through the preset, so it keeps its image copies.
  function jobRecordOverrides(record, settings) {
    const held = record && record.overrides;
    if (held && typeof held === 'object' && !Array.isArray(held)) return held;
    return record && record.kind === 'takeout' ? runOverrides(settings) : {};
  }

  // The save choice a Resume's artifacts run on. undefined (a record from before 1.9.3,
  // or a job without one) leaves downloadAllArtifacts on its default.
  function jobRecordZip(record) {
    return record && typeof record.zip === 'boolean' ? record.zip : undefined;
  }

  // matchResumeItems that will not call a key gone on thin evidence. A partial
  // scan (a list not drawn yet, the previous notebook's page) must not clear
  // items that still exist, so:
  // - a scan that matches nothing proves nothing: every key is `unknown`;
  // - with regionOfType(type) -> region (Notes: Studio notes vs the Sources
  //   panel's notes), a key is `missing` only if the scan has at least one item
  //   in the key's region, else `unknown`.
  // matched / missing as in matchResumeItems; unknown keys stay in the record.
  function planResume(keys, items, { titleOf, typeOf, regionOfType } = {}) {
    const m = matchResumeItems(keys, items, { titleOf, typeOf });
    if (m.matched.length === 0) return { matched: [], missing: [], unknown: m.missing };
    if (typeof regionOfType !== 'function') return { matched: m.matched, missing: m.missing, unknown: [] };
    const present = new Set((items || []).map(item => regionOfType(typeOf(item))));
    const missing = [];
    const unknown = [];
    for (const key of m.missing) {
      const at = key.indexOf('\u0000');
      (present.has(regionOfType(at >= 0 ? key.slice(0, at) : '')) ? missing : unknown).push(key);
    }
    return { matched: m.matched, missing, unknown };
  }

  // The banner's "An earlier <this> stopped at". A takeout goes by the button's name,
  // also in a record that still has the old label; the others are an export.
  function resumeBannerLabel(record) {
    const label = String((record && record.label) || '');
    if (!label) return 'export';
    return record.kind === 'takeout' ? 'Export everything' : `${label} export`;
  }

  // The banner's wording. A record with nothing remaining and only failed keys
  // is a finished export with failures (Retry re-runs those); otherwise a
  // stopped one (Resume). Same action either way: re-run the left keys.
  // Plain text; the caller escapes it.
  function resumeBannerView(record) {
    const { done, total, left } = jobResumeProgress(record);
    const label = resumeBannerLabel(record);
    const count = group => Object.values(group || {}).reduce((sum, keys) => sum + (Array.isArray(keys) ? keys.length : 0), 0);
    const failedOnly = count(record.remaining) === 0 && count(record.failed) > 0;
    return failedOnly
      ? { text: `An earlier ${label} finished with ${left} failed.`, actionLabel: `Retry (${left})`, failedOnly }
      : { text: `An earlier ${label} stopped at ${done} of ${total}.`, actionLabel: `Resume (${left} left)`, failedOnly };
  }

  // The keys a resume re-runs for one category: remaining, then failed, no repeats.
  function jobResumeKeys(record, category) {
    const list = group => (group && Array.isArray(group[category]) ? group[category] : []);
    return [...new Set([...list(record && record.remaining), ...list(record && record.failed)])];
  }

  // The banner's numbers. A record without `total` (written before it existed)
  // counts what is left as the whole job.
  function jobResumeProgress(record) {
    const left = jobRemainingCount(record);
    const total = Math.max(Number.isFinite(record.total) ? record.total : 0, left);
    return { done: total - left, total, left };
  }

  // The title part of a key ("<type>\0<title>[#n]"), for messages.
  function jobKeyTitle(key) {
    const s = String(key == null ? '' : key);
    const at = s.indexOf('\u0000');
    return at >= 0 ? s.slice(at + 1) : s;
  }

  // Resume: which of the recorded `keys` are still in the fresh `items` (scanned
  // now, in full, so listItemKeys numbers duplicates the way the record did).
  // matched: those items in scan order; missing: the keys with no item, in
  // `keys` order. A key never matches an item with a different key.
  function matchResumeItems(keys, items, { titleOf, typeOf } = {}) {
    const wanted = new Set(keys || []);
    const list = items || [];
    const itemKeys = listItemKeys(list, { titleOf, typeOf });
    const found = new Set();
    const matched = [];
    list.forEach((item, i) => {
      if (wanted.has(itemKeys[i])) { matched.push(item); found.add(itemKeys[i]); }
    });
    return { matched, missing: [...wanted].filter(k => !found.has(k)) };
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

  // The action bar's label: "Export 12 notes", "Select notes to export" at 0.
  // The plural adds an s; thousands get separators.
  function actionLabel(count, unit, verb = 'Export') {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n === 0) return `Select ${unit}s to ${verb.toLowerCase()}`;
    return `${verb} ${n.toLocaleString('en-US')} ${unit}${n === 1 ? '' : 's'}`;
  }

  // Why a Generated row has nothing to download, '' when it can. The rule for the
  // row's Download button and generatedExportPlan, which (1.9.5) still tries a
  // no-More item with its own title. With no More button (moreIndex -1) the row must
  // not be tried: a strict title match would download another item of the same
  // title and report success.
  function studioItemUnavailableReason(item) {
    if (!item || item.kind !== 'artifact') return '';
    if (!item.downloadable) return `${item.type} export not supported yet`;
    return item.moreIndex >= 0 ? '' : 'Not ready to download yet';
  }

  function isStudioItemUnavailable(item) {
    return !!studioItemUnavailableReason(item);
  }

  // A job record holds the keys Resume's fresh scans give (scanArtifactsData,
  // scanNotesData), never the merged list's: each row keeps them as jobKey, and
  // generatedExportPlan hands them on. Artifacts are in the same order as
  // scanArtifactsData. A Studio note takes the key of its entry in `notes`, stamped
  // by the caller (the labels of untitled rows differ); with no notes scan, one
  // computed from the row. Source notes come with theirs.
  function stampGeneratedJobKeys(items, notes) {
    const stamp = list => {
      const keys = listItemKeys(list, { titleOf: item => item.label, typeOf: item => item.type });
      list.forEach((item, i) => { item.jobKey = keys[i]; });
    };
    stamp(items.filter(item => item.kind === 'artifact'));
    const studioNotes = items.filter(item => item.kind === 'note');
    stamp(studioNotes);
    const scanned = new Map(notes.map(note => [note.index, note]));
    for (const item of studioNotes) {
      const key = scanned.get(item.kindIndex)?._listKey;
      if (key) item.jobKey = key;
    }
  }

  // The headline of a Generated export's combined panel: what was left out of the
  // whole selection, so it counts unstarted items too, which no failedItems holds,
  // and the items the export cannot take. steps: runRetryChain's, with exported and
  // stopped. total: items sent to export. skipped: generatedExportPlan's.
  function generatedExportMessage({ steps = [], notRun = [], total = 0, skipped = [] } = {}) {
    const exported = steps.reduce((sum, step) => sum + (step.exported || 0), 0);
    const left = total - exported;
    const all = total + skipped.length;
    const head = notRun.length
      ? `Export stopped before ${notRun.map(n => n.name.toLowerCase()).join(' and ')}`
      : steps.some(step => step.stopped) ? 'Export stopped' : 'Export finished';
    if (left <= 0 && skipped.length === 0) return head;
    if (left <= 0) return `${head} — ${skipped.length} of ${all} items can't be exported`;
    const rest = skipped.length ? `, ${skipped.length} of them can't be exported` : '';
    return `${head} — ${left + skipped.length} of ${all} items not exported${rest}`;
  }

  // The combined panel of a Generated export: combineRetryOutcomes plus the headline
  // above. Skipped items name their titles and make it a warning, never a success:
  // someone may delete the notebook after reading it. They stay out of `remaining`.
  function generatedExportOutcome({ steps = [], notRun = [], total = 0, skipped = [] } = {}) {
    const combined = combineRetryOutcomes({ steps, notRun });
    const outcome = {
      ...combined,
      message: generatedExportMessage({ steps, notRun, total, skipped }),
      count: { done: combined.count.done, total: total + skipped.length }
    };
    if (skipped.length) {
      outcome.lines = [...combined.lines, `Can't be exported (${skipped.length}): ${skipped.map(item => item.label).join(', ')}`];
      if (outcome.level === 'success' || outcome.level === 'info') outcome.level = 'warning';
    }
    return outcome;
  }

  // The Generated action's label for a generatedExportPlan
  // Delete Selected resolves a Studio item by its label alone, so the first of two
  // same-titled items would go whichever was ticked. Such items are skipped here,
  // like untitled ones, whose made-up label ("Item 3") could hit a real item. A row
  // delete checks position and title. Sources-panel notes go by their own index, so
  // a shared title does not touch them.
  function bulkDeletePlan(selected = [], allItems = []) {
    const isStudio = item => item.kind !== 'source-note';
    const labelOf = item => String(item.label || '').trim();
    const counts = new Map();
    allItems.filter(isStudio).forEach(item => counts.set(labelOf(item), (counts.get(labelOf(item)) || 0) + 1));
    const plan = { deletable: [], skippedUntitled: 0, skippedDuplicate: 0 };
    for (const item of selected) {
      if (isStudio(item) && item.untitled === true) plan.skippedUntitled++;
      else if (isStudio(item) && counts.get(labelOf(item)) > 1) plan.skippedDuplicate++;
      else plan.deletable.push(item);
    }
    return plan;
  }

  function bulkDeleteSkipText({ skippedUntitled = 0, skippedDuplicate = 0 } = {}) {
    const parts = [];
    if (skippedUntitled > 0) parts.push(`${skippedUntitled} untitled item(s)`);
    if (skippedDuplicate > 0) parts.push(`${skippedDuplicate} item(s) with a shared title`);
    return parts.join(' and ');
  }

  function generatedActionLabel({ artifacts = [], notes = [], skipped = [] } = {}) {
    const n = artifacts.length + notes.length;
    if (skipped.length === 0) return actionLabel(n, 'item');
    const left = `${skipped.length} can't be exported`;
    return n === 0 ? left : `${actionLabel(n, 'item')} · ${left}`;
  }

  // The Generated list's selection as the two exports it becomes: artifacts in the
  // scanArtifactsData shape, notes in the exportSingleNote shape. skipped: what
  // cannot be exported (studioItemUnavailableReason); those stay selectable for
  // delete. noMenu: the skipped no-More artifacts again, in the artifacts shape (the
  // job record keeps them as failed), and noMenuWarnings their errors.md lines;
  // allItems: the whole list, for the shared titles. item.jobKey (see stampGeneratedJobKeys) travels as the non-enumerable _listKey jobItemKeys reads, so a job record holds the keys a
  // fresh scan of that category gives, whatever else is in the merged list.
  function generatedExportPlan(items, allItems = items) {
    const plan = { artifacts: [], notes: [], skipped: [], noMenu: [], noMenuWarnings: [] };
    const keyed = (out, item) => {
      if (typeof item.jobKey === 'string') Object.defineProperty(out, '_listKey', { value: item.jobKey, configurable: true, writable: true });
      return out;
    };
    const asArtifact = item => keyed({ index: item.moreIndex, label: item.label, type: item.type, details: item.details, disabled: false }, item);
    // Any other row of the same title makes the skip "same title": one with a More
    // button (Flashcards and Quiz included) now, a no-More twin once it is ready
    const artifactRows = (allItems || []).filter(item => item && item.kind === 'artifact');
    const namesakesOf = item => artifactRows.filter(other => other !== item && titlesMatch(other.label, item.label));
    // Ordinals over the whole list (stampTitleOrdinals), for the items it builds
    const withMenu = (allItems || []).filter(item => item && item.kind === 'artifact' && item.moreIndex >= 0);
    const notesAll = (allItems || []).filter(item => item && item.kind === 'note');
    const ordinalIn = (list, item, indexOf) => list.filter(other => indexOf(other) < indexOf(item) && titlesMatch(other.label, item.label)).length;
    const countIn = (list, item) => list.filter(other => titlesMatch(other.label, item.label)).length;
    for (const item of items || []) {
      if (!item) continue;
      if (isStudioItemUnavailable(item)) {
        // As in 1.9.4, every no-More row is skipped here, like its row Download
        plan.skipped.push(item);
        if (item.kind === 'artifact' && item.downloadable) {
          plan.noMenu.push(asArtifact(item));
          const namesakes = namesakesOf(item);
          plan.noMenuWarnings.push(skippedNoMenuWarning(item.label, namesakes.length > 0, namesakes.some(other => other.moreIndex >= 0)));
        }
      } else if (item.kind === 'artifact') {
        plan.artifacts.push(setTitlePlace(asArtifact(item), ordinalIn(withMenu, item, row => row.moreIndex), countIn(withMenu, item)));
      } else if (item.kind === 'note') {
        plan.notes.push(setTitlePlace(keyed({ index: item.kindIndex, title: item.label, type: item.type }, item), ordinalIn(notesAll, item, row => row.kindIndex), countIn(notesAll, item)));
      } else if (item.kind === 'source-note') {
        plan.notes.push(keyed({ index: -1, sourceIndex: item.sourceIndex, title: item.label, type: item.type }, item));
      } else {
        plan.skipped.push(item);
      }
    }
    return plan;
  }

  // A Studio artifact with no More button is still being generated (or has no
  // menu). Every download path resolves it by title among the items that have
  // one (Flashcards and Quiz included), so with such an item of the same title it
  // would fetch that item and report success. Export everything and Resume skip
  // only that case (1.9.5); a no-More item with its own title is tried, as before,
  // and a failure says it is still being generated (NO_MENU_FAILED). The Studio
  // export skips every no-More row, as in 1.9.4. Each skip is a warning, so errors.md
  // names the item that is missing from the archive and the checker warns; it is
  // not an 'info' notice.
  const SKIPPED_NO_MENU_TYPE = 'skipped_ambiguous'; // a same-titled item could be hit
  const SKIPPED_NOT_READY_TYPE = 'skipped_not_ready'; // Studio export: no More button
  const SKIP_TYPES = [SKIPPED_NO_MENU_TYPE, SKIPPED_NOT_READY_TYPE];
  const NO_MENU_FAILED = 'Still being generated. Try again when it is ready (Resume will retry it).';
  // pickByIndexThenTitleStrict's refusal: a title-only pick with two candidates
  const SAME_TITLE_REFUSED = 'Another item has the same title, so this one cannot be found by its title alone. Resume finds it again by its place in the list.';
  // ... and with a scanned index whose row has moved
  const SAME_TITLE_SHIFTED = 'The list changed and another item has the same title, so this one cannot be found safely. Resume finds it again.';

  // How many of `titles` before `index` match `title`
  function titleOrdinalAt(titles, index, title) {
    let n = 0;
    for (let i = 0; i < index && i < titles.length; i++) if (titlesMatch(titles[i], title)) n++;
    return n;
  }

  // An item's place among the rows of its title: _titleOrdinal (rows of that title
  // before it) and _titleCount (rows of that title in all). Non-enumerable, like
  // _listKey: never in a file.
  function setTitlePlace(item, ordinal, count) {
    Object.defineProperty(item, '_titleOrdinal', { value: ordinal, configurable: true, writable: true });
    Object.defineProperty(item, '_titleCount', { value: count, configurable: true, writable: true });
    return item;
  }

  // What a request sends of it: { titleOrdinal, titleCount }, or nothing unstamped
  function titlePlace(item) {
    return item && Number.isInteger(item._titleOrdinal) && Number.isInteger(item._titleCount)
      ? { titleOrdinal: item._titleOrdinal, titleCount: item._titleCount } : {};
  }

  // Stamps each item with an index of its own (indexOf >= 0) with its place among
  // the items of its title, by index: what pickByIndexThenTitleStrict checks. With
  // `titles` (the page's own list, by index), counted there, so rows the scan left
  // out still count, as on the page.
  function stampTitleOrdinals(items, { titleOf, indexOf, titles = null }) {
    const placed = (items || []).filter(item => item && Number.isInteger(indexOf(item)) && indexOf(item) >= 0)
      .sort((a, b) => indexOf(a) - indexOf(b));
    placed.forEach((item, i) => {
      const title = titleOf(item);
      if (Array.isArray(titles)) {
        setTitlePlace(item, titleOrdinalAt(titles, indexOf(item), title), titles.filter(t => titlesMatch(t, title)).length);
      } else {
        setTitlePlace(item, placed.slice(0, i).filter(other => titlesMatch(titleOf(other), title)).length,
          placed.filter(other => titlesMatch(titleOf(other), title)).length);
      }
    });
    return items;
  }

  function isSameTitleRefusal(error) {
    const message = error && error.message;
    return message === SAME_TITLE_REFUSED || message === SAME_TITLE_SHIFTED;
  }

  // sharesTitle: another item has this title; ready: one of them has a More button
  // (else a twin still being generated)
  function skippedNoMenuWarning(title, sharesTitle = true, ready = true) {
    const name = String(title || '');
    if (!sharesTitle) return { type: SKIPPED_NOT_READY_TYPE, title: name, message: 'still being generated or has no menu' };
    return {
      type: SKIPPED_NO_MENU_TYPE,
      title: name,
      message: ready
        ? 'still being generated or has no menu; a ready item has the same title'
        : 'still being generated or has no menu; another item being generated has the same title'
    };
  }

  // scanArtifactsData's items as Export everything and Resume take them: runnable
  // (everything enabled but the skipped), skipped (no More button, index -1, and
  // any OTHER scanned item of the same title: one with a More button, disabled
  // ones included, is where a title pick lands now; a no-More twin is where it
  // lands once that twin is ready) and one warning per skip. Twins are both
  // skipped, kept failed in the record, and resumed later with their own indices.
  // Disabled types (Flashcards, Quiz) are not exported, as before. Two ready items
  // of one title both stay runnable. all: the whole scan, when items is a part of
  // it (Resume's matched keys), for the titles.
  function artifactExportPlan(items, { all = items } = {}) {
    const scanned = (all || []).filter(Boolean);
    const others = item => scanned.filter(other => other !== item && titlesMatch(other.label, item.label));
    const runnable = [];
    const skipped = [];
    const warnings = [];
    for (const item of items || []) {
      if (!item || item.disabled) continue;
      const namesakes = item.index >= 0 ? [] : others(item);
      if (namesakes.length) {
        skipped.push(item);
        warnings.push(skippedNoMenuWarning(item.label, true, namesakes.some(other => other.index >= 0)));
      } else {
        runnable.push(item);
      }
    }
    return { runnable, skipped, warnings };
  }

  // Export everything and Resume read the notes list until it settles (1.9.5). The
  // page draws its Studio list late, and an undrawn list reads as no notes, which
  // a takeout wrote as "none in notebook". boundMs: the longest wait; pollMs: time
  // between reads; emptyConfirmMs: how long a drawn but empty Studio list must stay
  // empty to be believed (Home re-reads a 0 for 4 s, the same guess).
  const NOTES_SETTLE = { boundMs: 8000, pollMs: 400, emptyConfirmMs: 4000 };
  const NOTES_STUDIO_HIDDEN = "The Studio list wasn't visible, so notes saved only there may be missing. Close any open Studio item and export again.";
  const NOTES_STUDIO_LOADING = 'The Studio list was still loading, so notes saved only there may be missing. Wait for it to load and export again.';

  // reads: one per SCAN_NOTES, oldest first, { at, notes, list }: at in ms since
  // the first read; notes the page's array, null when it gave no answer; list
  // (content.js notesListState) { items: rows in the Studio list, notes or not,
  // library: the list's container is on the page, loading: it shows a spinner and
  // no rows }. A list with rows has drawn: its notes are believed once two reads
  // in a row agree. A drawn list with no rows is believed after emptyConfirmMs. No
  // list, or a loading one, waits up to the bound: then the notes found anyway
  // (Sources-panel notes) are 'partial', exported with a warning that Studio notes
  // may be missing; with none it fails, as does a page that never answers: neither
  // may read as "none in notebook". An open Studio item hides the list.
  // -> { state: 'wait' | 'found' | 'empty' | 'partial' | 'failed', message? }
  function notesSettleDecision(reads, { boundMs = NOTES_SETTLE.boundMs, emptyConfirmMs = NOTES_SETTLE.emptyConfirmMs } = {}) {
    const list = reads || [];
    const last = list[list.length - 1];
    if (!last) return { state: 'wait' };
    const over = last.at >= boundMs;
    const seconds = Math.round(boundMs / 1000);
    if (!Array.isArray(last.notes)) {
      return over ? { state: 'failed', message: `No answer from the page while reading the notes list (waited ${seconds} s)` } : { state: 'wait' };
    }
    const done = read => ({ state: read.notes.length > 0 ? 'found' : 'empty' });
    const rowsOf = read => {
      const studio = read.notes.filter(note => note && note.elementType !== 'source-note').length;
      return Math.max(studio, Number(read.list && read.list.items) || 0);
    };
    // No list info: an older page answer; read it as a drawn list
    const drawnEmpty = read => !read.list || (!!read.list.library && !read.list.loading);
    const prev = list[list.length - 2];
    if (rowsOf(last) > 0) {
      const steady = prev && Array.isArray(prev.notes) && prev.notes.length === last.notes.length && rowsOf(prev) === rowsOf(last);
      return steady || over ? done(last) : { state: 'wait' };
    }
    if (drawnEmpty(last)) {
      // The run of drawn-and-empty reads this one ends
      let start = last;
      for (let i = list.length - 2; i >= 0; i--) {
        const read = list[i];
        if (!Array.isArray(read.notes) || rowsOf(read) > 0 || !drawnEmpty(read)) break;
        start = read;
      }
      return last.at - start.at >= emptyConfirmMs || over ? done(last) : { state: 'wait' };
    }
    if (!over) return { state: 'wait' };
    // A spinner says the list is there but still loading: not an open item
    const loading = !!(last.list && last.list.library && last.list.loading);
    if (last.notes.length > 0) return { state: 'partial', message: loading ? NOTES_STUDIO_LOADING : NOTES_STUDIO_HIDDEN };
    return {
      state: 'failed',
      message: loading
        ? `The Studio list was still loading after ${seconds} s. Wait for it to load (or reload the notebook) and export again`
        : `The Studio list did not appear within ${seconds} s. Close any open Studio item (or reload the notebook) and export again`
    };
  }

  // Everything the Generated rows are drawn from and act on (and the page their
  // buttons talk to); equal signatures need no redraw
  function generatedSignature(tab, items) {
    return JSON.stringify([tab.id, tab.url, items.map(item => [
      item.kind, item.label, item.type, item.details || '', item.combinedIndex, item.kindIndex, item.moreIndex,
      item.sourceIndex, !!item.downloadable, !!item.untitled, item.jobKey
    ])]);
  }

  function listStateKey(notebookId, tab) {
    return `nlme.list.${notebookId}.${tab}`;
  }

  // meta: [{ key: 'nlme.list.<notebookId>.<tab>', at }] -> keys to remove. A
  // notebook counts once (its newest `at`, or 0 when the state predates the
  // timestamp); everything beyond the `keep` most recent notebooks goes.
  // keepId: the notebook on screen; it takes a slot but its keys are never returned.
  function pruneListStates(meta, { keep = 30, keepId = '' } = {}) {
    const prefix = 'nlme.list.';
    const byNotebook = new Map();
    (meta || []).forEach((m, i) => {
      const key = m && m.key;
      if (typeof key !== 'string' || !key.startsWith(prefix)) return;
      const dot = key.lastIndexOf('.');
      const id = dot > prefix.length ? key.slice(prefix.length, dot) : key.slice(prefix.length);
      if (!byNotebook.has(id)) byNotebook.set(id, { id, at: 0, first: i, keys: [] });
      const group = byNotebook.get(id);
      group.keys.push(key);
      group.at = Math.max(group.at, Number(m.at) || 0);
    });
    const groups = [...byNotebook.values()];
    // The notebook on screen counts as the newest
    groups.forEach(g => { if (keepId && g.id === keepId) g.at = Infinity; });
    return groups
      .sort((a, b) => (b.at - a.at) || (a.first - b.first))
      .slice(Math.max(0, keep))
      .filter(g => !(keepId && g.id === keepId))
      .flatMap(g => g.keys);
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

  // Text as it is written: Markdown/text files lose control characters, so
  // sizes in the manifest and index match the saved file.
  function writtenText(entry) {
    const d = entry && entry.data;
    return typeof d === 'string' && /\.(md|txt)$/i.test(entry.path || '') ? stripControlChars(d) : d;
  }

  function byteLength(entry) {
    const data = writtenText(entry);
    if (typeof data === 'string') return new TextEncoder().encode(data).length;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
    if (data && typeof data.byteLength === 'number') return data.byteLength;
    // A url entry the browser downloaded: the size read from the download
    if (typeof entry.bytes === 'number') return entry.bytes;
    return null;
  }

  // Where a chrome.downloads item stands for reading its size: done once it
  // completed, was interrupted or is gone; bytes only for a completed download
  // that reports a size (fileSize is -1 when unknown).
  function downloadSizeStatus(item) {
    if (!item || item.state === 'interrupted') return { done: true, bytes: null };
    if (item.state !== 'complete') return { done: false, bytes: null };
    return { done: true, bytes: typeof item.fileSize === 'number' && item.fileSize >= 0 ? item.fileSize : null };
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
  function artifactStems(items, { obsidian = false } = {}) {
    const stems = new Array(items.length);
    const byFolder = new Map();
    items.forEach((item, idx) => {
      const folder = artifactFolder(item.type);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(idx);
    });
    for (const idxs of byFolder.values()) {
      const suffixes = idxs.some(i => items[i].type === 'Data Table') ? ['-references'] : [];
      uniqueStems(idxs.map(i => items[i].label), suffixes, [], { obsidian }).forEach((stem, k) => { stems[idxs[k]] = stem; });
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
  // skipped: items left out on purpose (artifactExportPlan), in neither N nor M;
  // their warnings are in errorCount. Only skips is 'done', not 'failed' or 'empty'.
  function takeoutCategoryStatus({ selected = 0, exported = 0, failed = 0, errorCount = 0, cancelled = false, stopped = false, skipped = 0 } = {}) {
    if (cancelled) return 'partial';
    if (stopped) return 'stopped';
    if (exported === 0 && (failed > 0 || errorCount - skipped > 0)) return 'failed';
    if (selected === 0 && skipped === 0) return 'empty';
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

  // Front matter of a category's _index.md (notes, sources, chat, artifacts):
  // the item block (title, notebook, exporter...) with kind 'index' and the
  // category; `part` only for a part of a split export.
  function categoryIndexFrontMatter(meta, { title, category, part } = {}) {
    return frontMatter({
      title,
      notebook: meta.notebook,
      notebook_url: meta.notebook_url,
      notebook_id: meta.notebook_id,
      exporter: meta.exporter,
      exported: meta.exported,
      kind: 'index',
      category,
      part
    });
  }

  // _index.md at the root of a Full Takeout: one row per category (Sources,
  // Notes, Chat, Artifacts) with its counts, status and folder, the ZIPs each
  // category wrote, and a link to the combined errors.md.
  function buildRootIndex({ meta, categories = [], errorsFile = null, viewerFile = null } = {}) {
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
    if (viewerFile) md += `Browse everything offline: [Open the viewer](${encodePath(viewerFile)})\n\n`;
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

  // itemKind values the builders set (buildNotesFiles / buildSourcesFiles) and
  // the heading each lands under in _index.html
  const INDEX_KIND_GROUPS = ['Notes', 'Sources', 'Mind maps', 'Combined'];
  const INDEX_KIND_HEADINGS = {
    note: 'Notes', source: 'Sources', 'source-urls': 'Sources', mindmap: 'Mind maps', 'mind-map': 'Mind maps',
    'combined-notes': 'Combined', combined: 'Combined'
  };

  function buildIndexHtml({ meta, heading, files = [], links = [] } = {}) {
    const linked = new Set(links.map(l => l.href));
    // Entries with an itemKind group under a kind heading (flattened Takeout
    // folders hold several kinds); the rest group by first path segment
    const kindGroups = new Map(INDEX_KIND_GROUPS.map(g => [g, []]));
    const pathGroups = new Map();
    for (const f of files) {
      if (!f || f.path === '_index.html' || f.path === 'manifest.json' || linked.has(f.path)) continue;
      const kindGroup = INDEX_KIND_HEADINGS[f.itemKind];
      if (kindGroup) { kindGroups.get(kindGroup).push(f); continue; }
      const parts = String(f.path).split('/');
      const group = parts.length > 1 ? parts[0] : 'Files';
      if (!pathGroups.has(group)) pathGroups.set(group, []);
      pathGroups.get(group).push(f);
    }
    const groups = new Map([...kindGroups].filter(([, list]) => list.length).concat([...pathGroups]));
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
  function buildRootIndexHtml({ meta, categories = [], errorsFile = null, viewerFile = null } = {}) {
    let body = indexHtmlLinks([
      ...(viewerFile ? [{ href: viewerFile, label: 'Offline viewer' }] : []),
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
    const part = c => `${partText(c)}${c.skipped > 0 ? ` (${c.skipped} skipped)` : ''}`;
    const partText = c => {
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

  // --- Citation cache (pure) ---------------------------------------------
  // Limits (needs the "unlimitedStorage" permission): bytes per notebook bucket
  // and how many notebook buckets are kept.
  const CITE_MAX_BYTES_PER_NOTEBOOK = 10 * 1024 * 1024;
  const CITE_KEEP_NOTEBOOKS = 20;

  // 32-bit FNV-1a over UTF-16 code units (equals byte FNV-1a for ASCII).
  function fnv1a(text) {
    const str = String(text == null ? '' : text);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function citationCacheKey({ kind, text, numbers }) {
    const norm = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return `${kind}:${fnv1a(norm)}:${norm.length}:${(numbers || []).join('.')}`;
  }

  function citationCacheBucketKey(notebookId) {
    return 'nlme.cite.' + notebookId;
  }

  function isCacheBucket(bucket) {
    return !!bucket && typeof bucket === 'object' && !!bucket.entries && typeof bucket.entries === 'object';
  }

  function cacheGet(bucket, key) {
    if (!isCacheBucket(bucket)) return null;
    if (!Object.prototype.hasOwnProperty.call(bucket.entries, key)) return null;
    const entry = bucket.entries[key];
    if (!entry || !Array.isArray(entry.sources)) return null;
    return JSON.parse(JSON.stringify(entry.sources));
  }

  function cachePut(bucket, key, sources, { now, maxBytes = CITE_MAX_BYTES_PER_NOTEBOOK } = {}) {
    const entries = isCacheBucket(bucket) ? { ...bucket.entries } : {};
    const bytes = JSON.stringify(sources).length;
    if (bytes > maxBytes) return { entries };
    delete entries[key];
    const keep = JSON.parse(JSON.stringify(sources));
    let total = bytes;
    for (const k of Object.keys(entries)) total += (entries[k] && entries[k].bytes) || 0;
    if (total > maxBytes) {
      const oldestFirst = Object.keys(entries).sort((a, b) => ((entries[a] && entries[a].at) || 0) - ((entries[b] && entries[b].at) || 0));
      for (const k of oldestFirst) {
        if (total <= maxBytes) break;
        total -= (entries[k] && entries[k].bytes) || 0;
        delete entries[k];
      }
    }
    entries[key] = { sources: keep, at: now, bytes };
    return { entries };
  }

  // bucketMeta: [{ key, at }] -> keys to remove (everything beyond the `keep` most recent).
  function pruneCitationBuckets(bucketMeta, { keep = CITE_KEEP_NOTEBOOKS } = {}) {
    return (bucketMeta || [])
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (b.m.at - a.m.at) || (a.i - b.i))
      .slice(keep)
      .map(x => x.m.key);
  }

  // --- Citation cache storage wrappers ---------------------------------
  // `storage` is chrome.storage.local (passed in so this stays testable).
  // Nothing here throws: a storage failure means "no cache", never a failed
  // export. Layout: one bucket per notebook at nlme.cite.<id>, plus
  // nlme.cite.meta = { bucketKey: newestAt } for pruning old notebooks.
  // Read-modify-write is not atomic across contexts; the side panel's job lock
  // guarantees one export at a time, so content.js and sidebar.js never write
  // concurrently.
  const CITE_META_KEY = 'nlme.cite.meta';

  async function citationCacheRead(storage, notebookId, key) {
    if (!storage || !notebookId) return null;
    try {
      const bucketKey = citationCacheBucketKey(notebookId);
      const stored = await storage.get([bucketKey, CITE_META_KEY]);
      const bucket = stored && stored[bucketKey];
      if (bucket) {
        // A bucket the meta map does not know yet (e.g. meta was lost): list it
        // now (at = now) so it can be pruned later
        const meta = (stored && stored[CITE_META_KEY]) || {};
        if (!(bucketKey in meta)) {
          try { await storage.set({ [CITE_META_KEY]: { ...meta, [bucketKey]: Date.now() } }); } catch (e) { /* best effort */ }
        }
      }
      return cacheGet(bucket, key);
    } catch (e) {
      console.warn('[NotebookLM Takeout] Citation cache read failed:', e);
      return null;
    }
  }

  async function citationCacheWrite(storage, notebookId, key, sources, { now = Date.now(), maxBytes, keep } = {}) {
    if (!storage || !notebookId) return false;
    try {
      const bucketKey = citationCacheBucketKey(notebookId);
      const stored = await storage.get([bucketKey, CITE_META_KEY]);
      const putOpts = { now };
      if (maxBytes !== undefined) putOpts.maxBytes = maxBytes;
      const bucket = cachePut(stored && stored[bucketKey], key, sources, putOpts);
      const meta = { ...((stored && stored[CITE_META_KEY]) || {}), [bucketKey]: now };
      const pruneOpts = keep !== undefined ? { keep } : {};
      const evicted = pruneCitationBuckets(Object.keys(meta).map(k => ({ key: k, at: meta[k] })), pruneOpts)
        .filter(k => k !== bucketKey);
      evicted.forEach(k => { delete meta[k]; });
      await storage.set({ [bucketKey]: bucket, [CITE_META_KEY]: meta });
      if (evicted.length) await storage.remove(evicted);
      return true;
    } catch (e) {
      console.warn('[NotebookLM Takeout] Citation cache write failed:', e);
      return false;
    }
  }

  // True when `a` is an older dotted version than `b` ('1.6.0' < '1.7.0',
  // '1.9.0' < '1.10.0'; a missing part counts as 0). A missing or malformed
  // version is never "older": callers act only on a version they can read.
  function versionLess(a, b) {
    const parse = v => (typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);
    const x = parse(a);
    const y = parse(b);
    if (!x || !y) return false;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d !== 0) return d < 0;
    }
    return false;
  }

  // 1.7.0 changed how formulas convert (LaTeX), so quotes cached by an older
  // version lack them: clear the citation cache once, on the update that crosses
  // 1.7.0. `details` is chrome.runtime.onInstalled's; a fresh install has an empty
  // cache, a reload of 1.7.0 or later (previousVersion not older) keeps it.
  const CITE_CACHE_CLEAR_BELOW = '1.7.0';
  function shouldClearCitationCache(details, currentVersion) {
    if (!details || details.reason !== 'update') return false;
    return versionLess(details.previousVersion, CITE_CACHE_CLEAR_BELOW) &&
      !versionLess(currentVersion, CITE_CACHE_CLEAR_BELOW);
  }

  // Names for downloads the extension starts itself (folder mode). Chrome drops
  // the `filename` given to chrome.downloads.download while an
  // onDeterminingFilename listener exists, so the listener applies these. The
  // name lives in memory and in storage.session (a service worker restart empties
  // the Map) until its download consumes it; nothing expires it.
  const DOWNLOAD_NAME_PREFIX = 'nlme.dlname.';
  function createDownloadNamer(storage, extensionId) {
    const names = new Map();
    const keyOf = url => DOWNLOAD_NAME_PREFIX + url;
    async function removeStored(urls) {
      const keys = urls.filter(Boolean).map(keyOf);
      if (!storage || !keys.length) return;
      try { await storage.remove(keys); } catch (e) { console.warn('[NotebookLM Takeout] Download name cleanup failed:', e); }
    }
    // Resolves after the storage write; a failed write is logged and the Map entry stays
    async function register(url, filename) {
      names.set(url, filename);
      try { await storage.set({ [keyOf(url)]: filename }); }
      catch (e) { console.warn('[NotebookLM Takeout] Download name not stored:', e); }
    }
    // True when this download is handled here (suggest is called exactly once,
    // possibly later); false leaves it to the caller's other branches
    function handle(item, suggest) {
      const urls = [item.url, item.finalUrl];
      const hit = names.get(item.url) || names.get(item.finalUrl);
      if (hit) {
        urls.forEach(u => names.delete(u));
        removeStored(urls);
        suggest({ filename: hit, conflictAction: 'uniquify' });
        return true;
      }
      if (!extensionId || item.byExtensionId !== extensionId || typeof item.url !== 'string' || !item.url.startsWith('blob:')) return false;
      (async () => {
        let name = null;
        try {
          const key = keyOf(item.url);
          name = ((await storage.get(key)) || {})[key] || null;
          if (name) await removeStored([item.url]);
        } catch (e) {
          console.warn('[NotebookLM Takeout] Download name lookup failed:', e);
          name = null;
        }
        if (name) suggest({ filename: name, conflictAction: 'uniquify' });
        else suggest();
      })();
      return true;
    }
    return { register, handle, names };
  }

  async function citationCacheClear(storage) {
    if (!storage) return false;
    try {
      // Never load all of storage when the keys can be listed another way:
      // getKeys (newer Chrome), else the buckets the meta map lists
      let names = null;
      if (typeof storage.getKeys === 'function') {
        names = await storage.getKeys();
      } else {
        const meta = ((await storage.get(CITE_META_KEY)) || {})[CITE_META_KEY];
        if (meta && typeof meta === 'object') names = [...Object.keys(meta), CITE_META_KEY];
      }
      if (!Array.isArray(names)) names = Object.keys((await storage.get(null)) || {});
      const keys = names.filter(k => typeof k === 'string' && k.startsWith('nlme.cite.'));
      if (keys.length) await storage.remove(keys);
      return true;
    } catch (e) {
      console.warn('[NotebookLM Takeout] Citation cache clear failed:', e);
      return false;
    }
  }

  // A result is cacheable only when every expected marker produced a source
  // with a filename and a non-empty quote (partial results are never stored).
  // An image citation's note is not a read quote: it is read again next time.
  function citationSourcesComplete(sources, expectedCount) {
    return Array.isArray(sources) && expectedCount > 0 && sources.length === expectedCount &&
      sources.every(s => s && typeof s.text === 'string' && s.text !== '' && typeof s.quote === 'string' && s.quote !== '' &&
        s.quote !== IMAGE_CITATION_NOTE);
  }

  // Header text of the Sources panel's "Notes" group, with its mat-icons already
  // removed: "Notes" or "Notes (3)", nothing else ("Notes and Papers" is a source group).
  function isNotesHeaderText(text) {
    return /^Notes(\s*\(\d+\))?$/.test(String(text == null ? '' : text).trim());
  }

  // A Generated item's title element must read exactly the label the delete was asked for.
  function studioTargetMatches(titleText, label) {
    return typeof label === 'string' && label !== '' && String(titleText == null ? '' : titleText).trim() === label;
  }

  // Every message type the extension sends or handles. tests/message-protocol.test.js
  // keeps this list in step with the code.
  const MSG = Object.freeze({
    CANCEL_EXPORT: 'CANCEL_EXPORT',
    CANCEL_INTERCEPT: 'CANCEL_INTERCEPT',
    CHECK_DOM_HEALTH: 'CHECK_DOM_HEALTH',
    DELETE_SOURCE_NOTE: 'DELETE_SOURCE_NOTE',
    DELETE_STUDIO_ITEM: 'DELETE_STUDIO_ITEM',
    DIRECT_DOWNLOAD_URL: 'DIRECT_DOWNLOAD_URL',
    DOWNLOAD_ARTIFACT: 'DOWNLOAD_ARTIFACT',
    DOWNLOAD_IMAGE_AS_BASE64: 'DOWNLOAD_IMAGE_AS_BASE64',
    EXTRACT_MESSAGE_CITATIONS: 'EXTRACT_MESSAGE_CITATIONS',
    EXTRACT_MINDMAP_FRAME: 'EXTRACT_MINDMAP_FRAME',
    EXTRACT_NOTE: 'EXTRACT_NOTE',
    EXTRACT_SOURCE: 'EXTRACT_SOURCE',
    FETCH_FILE: 'FETCH_FILE',
    GET_DOM_ERRORS: 'GET_DOM_ERRORS',
    GET_INTERCEPTED_DOWNLOAD: 'GET_INTERCEPTED_DOWNLOAD',
    GET_NOTEBOOK_EMOJI: 'GET_NOTEBOOK_EMOJI',
    GET_PROJECT_NAME: 'GET_PROJECT_NAME',
    HIDE_EXPORT_OVERLAY: 'HIDE_EXPORT_OVERLAY',
    IS_STUDIO_VIEWER_OPEN: 'IS_STUDIO_VIEWER_OPEN',
    NAME_NEXT_DOWNLOAD: 'NAME_NEXT_DOWNLOAD',
    NAVIGATE_BACK: 'NAVIGATE_BACK',
    NLME_DOWNLOAD_URL_INTERCEPTED: 'NLME_DOWNLOAD_URL_INTERCEPTED',
    PING: 'PING',
    REQUEST_EXPORT_CANCEL: 'REQUEST_EXPORT_CANCEL',
    RESET_DOM_TRACKER: 'RESET_DOM_TRACKER',
    RUN_COMPREHENSIVE_HEALTH_CHECK: 'RUN_COMPREHENSIVE_HEALTH_CHECK',
    SCAN_CHAT: 'SCAN_CHAT',
    SCAN_NOTES: 'SCAN_NOTES',
    SCAN_SOURCES: 'SCAN_SOURCES',
    SCAN_STUDIO_ITEMS: 'SCAN_STUDIO_ITEMS',
    SHOW_EXPORT_OVERLAY: 'SHOW_EXPORT_OVERLAY',
    START_INTERCEPT_DOWNLOAD: 'START_INTERCEPT_DOWNLOAD',
    UPDATE_EXPORT_OVERLAY: 'UPDATE_EXPORT_OVERLAY'
  });

  // The ⚙️ settings as shipped. The side panel starts from these and
  // "Reset to defaults" returns to them. takeoutZip is Settings' Default save,
  // the export sheet's starting Save as; while unset, a stored autoZip decides
  // (takeoutZipChoice), and no control writes autoZip any more. exportPreset:
  // 'archive', 'ai' or 'custom'; customImages is Custom's image copies, whose
  // citations and names are citationDetail and obsidianNames.
  const DEFAULT_SETTINGS = Object.freeze({
    autoZip: false,
    takeoutZip: undefined,
    showNotifications: true,
    refreshInterval: 10,
    exportSourceBase: true,
    exportSourcePlusMeta: true,
    exportSourceWithImages: false,
    exportSourcePlusMetaWithImages: false,
    exportNoteBase: true,
    exportNoteCodeBlocks: true,
    exportNoteWithImages: false,
    sourcesPerZip: 25,
    notesPerZip: 25,
    cleanOCRArtifacts: true,
    slidesFormat: 'pdf',
    citationDetail: 'quotes',
    reuseCitations: true,
    citationStyle: 'links',
    obsidianNames: false,
    theme: 'auto',
    exportPreset: 'archive',
    customImages: true
  });

  // A fresh, editable copy of the defaults. Keeps only what Default save shows, a
  // stored autoZip included, since Reset takes autoZip itself back to false.
  function resetSettings(current) {
    const fresh = { ...DEFAULT_SETTINGS };
    if (current && (current.takeoutZip !== undefined || current.autoZip)) fresh.takeoutZip = takeoutZipChoice(current);
    return fresh;
  }

  // 'light' or 'dark' for the <html data-theme> attribute; null for Auto (the
  // CSS then follows the OS) and for anything unknown.
  function themeAttr(theme) {
    return theme === 'light' || theme === 'dark' ? theme : null;
  }

  // The setting value to store: 'auto', 'light' or 'dark'
  function themeValue(theme) {
    return themeAttr(theme) || 'auto';
  }

  const NLME = {
    MSG,
    studioTargetMatches,
    isNotesHeaderText,
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
    categoryIndexFrontMatter,
    uniqueStems,
    notebookIdFromUrl,
    PANEL_TABS,
    openingView,
    panelOpenView,
    homeCountText,
    homeCountRead,
    homeNotice,
    loadWithRetry,
    headerName,
    shownNotebookName,
    listItemKeys,
    jobRecordKey,
    newJobRecord,
    markJobItem,
    markJobItems,
    jobRemainingCount,
    jobRecordFinished,
    jobRecordMode,
    jobRecordUsable,
    jobRecordOverrides,
    jobRecordZip,
    planResume,
    NOTES_SETTLE,
    NOTES_STUDIO_HIDDEN,
    NOTES_STUDIO_LOADING,
    notesSettleDecision,
    SKIPPED_NO_MENU_TYPE,
    NO_MENU_FAILED,
    SAME_TITLE_REFUSED,
    SAME_TITLE_SHIFTED,
    isSameTitleRefusal,
    titleOrdinalAt,
    titlePlace,
    setTitlePlace,
    stampTitleOrdinals,
    skippedNoMenuWarning,
    artifactExportPlan,
    resumeBannerLabel,
    resumeBannerView,
    jobResumeKeys,
    jobResumeProgress,
    jobKeyTitle,
    matchResumeItems,
    listView,
    pruneSelection,
    listSummary,
    actionLabel,
    studioItemUnavailableReason,
    isStudioItemUnavailable,
    stampGeneratedJobKeys,
    generatedExportMessage,
    generatedExportOutcome,
    generatedActionLabel,
    bulkDeletePlan,
    bulkDeleteSkipText,
    generatedExportPlan,
    generatedSignature,
    listStateKey,
    pruneListStates,
    restoreListState,
    exportMeta,
    buildManifest,
    downloadSizeStatus,
    zipName,
    filesByteSize,
    artifactFolder,
    extensionFor,
    slideFormatsFor,
    withRealExtension,
    artifactStems,
    groupCitationEntries,
    groupedSourcesMarkdown,
    footnoteLabel,
    footnoteDefinition,
    footnoteDefinitions,
    obsidianSafeName,
    fileStem,
    prefixedStem,
    markWindowedQuote,
    noteHasImages,
    countMarkdownFormulas,
    markWrittenFormula,
    takeFormulaMarks,
    listItemMarkdown,
    countExportErrors,
    isPriceRangeFragment,
    isProseMath,
    relaxBracketEscapes,
    citationCoverage,
    unknownStudioIcons,
    auditExport,
    diffAudit,
    partAudit,
    buildSourcesIndex,
    citationTitleFromAriaLabel,
    fenceFor,
    toBlockquote,
    isThoughtIconName,
    sourceUrlFromFavicon,
    sourceRowIcon,
    sourceWebLine,
    webSourceType,
    sourceTypeFields,
    sourceOriginalLine,
    importCardFromLines,
    importCardMarkdown,
    isFaviconServiceUrl,
    finishRemoteImages,
    embedImagesForVersion,
    blocksCoverText,
    THOUGHTS_PLACEHOLDER_HTML,
    thoughtsMarkdown,
    chatScanErrors,
    noteVariants,
    sourceVariants,
    presetOverrides,
    migratePreset,
    runOverrides,
    applyRunSettings,
    estimateSeconds,
    formatEstimate,
    estimateLine,
    homeEstimateCounts,
    tabLeftPanelNotebook,
    rowRefused,
    retryRefused,
    timeLeft,
    restCounts,
    overlayView,
    overlayCount,
    sameDeleteTarget,
    deleteTarget,
    tickedTimeLeft,
    honestTimeLeft,
    calmTimeLeft,
    progressLeftLine,
    progressFigures,
    announceDelay,
    takeoutCount,
    resultsToast,
    sheetChoice,
    sheetOverrides,
    isAllowedDownloadUrl,
    isAllowedImageUrl,
    imageFetchUrl,
    imageBlobProblem,
    summarizeImageFailures,
    applyImageEmbeds,
    retryAfterMs,
    isRateLimitedStatus,
    createImageSession,
    isNotebookDownload,
    NOTEBOOK_HOSTS,
    isNotebookUrl,
    sanitizeFilename,
    artifactTypePrefix,
    singleArtifactPackage,
    exportTimestamp,
    escapeHtml,
    PROJECT_TITLE_SELECTORS,
    NOTEBOOK_EMOJI_SELECTOR,
    notebookEmoji,
    normalizeExportError,
    prefixExportErrors,
    buildErrorReport,
    cancellationNote,
    distinctVariants,
    createStabilityTracker,
    waitForGuideSettled,
    GUIDE_SETTLE_MS,
    downloadFolderPath,
    takeoutFolderName,
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
    createSettleGate,
    createLatestGate,
    createPhaseTimer,
    formatTimingSummary,
    cleanOcrArtifacts,
    stripControlChars,
    writtenText,
    unwrapGoogleRedirect,
    plainHeading,
    mathSourceHealth,
    mathSourceToMarkdown,
    classifyKatexScript,
    isCollapsedCitationGroup,
    renumberCitationAnchors,
    pickDownloadMenuIndex,
    FORMAT_NOT_OFFERED,
    countFailedExtractions,
    ISSUES_URL,
    pickByIndexThenTitle,
    STUDIO_HEADER_CLOSE_SELECTOR,
    buildCitationEntries,
    IMAGE_SOURCE_NOTE,
    IMAGE_CITATION_NOTE,
    isImageSourceUrl,
    imageSourceUrls,
    imageSourceMarkdown,
    isImageCitation,
    ICON_TO_TYPE,
    NOTE_ICONS,
    resolveArtifactType,
    isDownloadableType,
    chatCitationMode,
    takeoutZipChoice,
    CITATION_TOOLTIP_SELECTOR,
    isCitationExpander,
    parseCitationIndex,
    mimeForPath,
    fnv1a,
    citationCacheKey,
    citationCacheBucketKey,
    cacheGet,
    cachePut,
    pruneCitationBuckets,
    citationCacheRead,
    citationCacheWrite,
    citationCacheClear,
    createDownloadNamer,
    versionLess,
    shouldClearCitationCache,
    citationSourcesComplete,
    CITE_MAX_BYTES_PER_NOTEBOOK,
    CITE_KEEP_NOTEBOOKS,
    DEFAULT_SETTINGS,
    resetSettings,
    themeAttr,
    themeValue
  };

  root.NLME = NLME;
  if (typeof module === 'object' && module.exports) module.exports = NLME;
})(globalThis);
