// NotebookLM Takeout - Sidebar Script

// Enhanced logging utility for structured logging
const logger = {
  info: (context, message, data) => {
    console.log(`[NotebookLM Takeout] [${context}] ${message}`, data || '');
  },
  warn: (context, message, data) => {
    console.warn(`[NotebookLM Takeout] [${context}] ${message}`, data || '');
  },
  error: (context, message, error) => {
    console.error(`[NotebookLM Takeout] [${context}] ${message}`, error || '');
  },
  download: (itemName, status, details) => {
    const statusIcon = status === 'success' ? '✓' : status === 'error' ? '✗' : '⏳';
    console.log(`[NotebookLM Takeout] [Download] ${statusIcon} ${itemName}`, details || '');
  }
};

// Mindmap HTML template - loaded from external file for easy updates
let mindmapTemplate = null;

/**
 * Load the mindmap HTML template from external file
 * @returns {Promise<string>} - The template content
 */
async function loadMindmapTemplate() {
  if (mindmapTemplate) return mindmapTemplate;

  try {
    const templateUrl = chrome.runtime.getURL('mindmap-template.html');
    const response = await fetch(templateUrl);
    mindmapTemplate = await response.text();
    console.log('[NotebookLM Takeout] Mindmap template loaded successfully');
    return mindmapTemplate;
  } catch (error) {
    console.error('[NotebookLM Takeout] Failed to load mindmap template:', error);
    // Return a minimal fallback template
    return `<!DOCTYPE html>
<html><head><title>{{TITLE}}</title></head>
<body><h1>{{TITLE}}</h1><div>{{SVG_CONTENT}}</div></body></html>`;
  }
}

/**
 * Generate interactive HTML viewer for mindmap SVG
 * @param {string} svgContent - The SVG content to embed
 * @param {string} title - The mindmap title
 * @returns {Promise<string>} - Complete HTML document
 */
async function generateMindmapHTML(svgContent, title) {
  const template = await loadMindmapTemplate();
  return template
    .replace('{{TITLE}}', title)
    .replace('{{SVG_CONTENT}}', svgContent);
}

// Keep synchronous version for backwards compatibility (uses cached template)
function generateMindmapHTMLSync(svgContent, title) {
  if (!mindmapTemplate) {
    console.warn('[NotebookLM Takeout] Template not loaded, using fallback');
    return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body><h1>${title}</h1><div>${svgContent}</div></body></html>`;
  }
  return mindmapTemplate
    .replace('{{TITLE}}', title)
    .replace('{{SVG_CONTENT}}', svgContent);
}

// Pre-load template on script init
loadMindmapTemplate();

/*
 * REMOVED INLINE TEMPLATE - Now loaded from mindmap-template.html
 * To update the template, edit mindmap-template.html directly.
 * Placeholders: {{TITLE}} and {{SVG_CONTENT}}
 */

/**
 * Show a warning dialog for DOM compatibility issues
 * @param {string[]} issues - List of issues to display
 * @param {boolean} isMidExport - Whether this is during an export (vs pre-export)
 * @returns {Promise<boolean>} - Whether user wants to continue
 */
function showDOMWarningDialog(issues, isMidExport = false) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'dom-warning-dialog';
    dialog.innerHTML = `
      <div class="dialog-overlay"></div>
      <div class="dialog-content">
        <h3>${isMidExport ? 'Export Issues Detected' : 'Potential Compatibility Issues'}</h3>
        <p style="font-size: 13px; color: #666; margin: 0 0 8px;">
          ${isMidExport
            ? 'Multiple errors occurred. NotebookLM may have been updated.'
            : 'Some expected elements were not found. The extension may need an update.'}
        </p>
        <ul>${issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        <div class="dialog-actions">
          <button class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="continue">
            ${isMidExport ? 'Continue' : 'Try Anyway'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'cancel' || e.target.classList.contains('dialog-overlay')) {
        dialog.remove();
        resolve(false);
      } else if (action === 'continue') {
        dialog.remove();
        resolve(true);
      }
    });
  });
}

/**
 * Hide the warning banner
 */
function hideWarningBanner() {
  const banner = document.getElementById('dom-warning-banner');
  if (banner) {
    banner.style.display = 'none';
  }
}

/**
 * Create a standardized TurndownService instance with consistent configuration
 * This ensures all markdown conversions use the same settings
 * @param {Object} customOptions - Optional custom options to override defaults
 * @returns {TurndownService} Configured TurndownService instance
 */
function createTurndownService(customOptions = {}) {
  const defaultOptions = {
    headingStyle: 'atx',        // Use # style headings (not underlined)
    hr: '---',                  // Horizontal rules with three dashes
    bulletListMarker: '*',      // Use * for unordered lists (changed from - for consistency)
    codeBlockStyle: 'fenced',   // Use ``` code blocks (not indented)
    emDelimiter: '_',           // Use _ for emphasis (not *)
    strongDelimiter: '**',      // Use ** for strong (not __)
    linkStyle: 'inlined'        // Use [text](url) format (not reference style)
  };

  return new TurndownService({ ...defaultOptions, ...customOptions });
}

// ==================== KATEX → LATEX CONVERSION ====================
// Handles two cases:
//   1. KaTeX preserved the original LaTeX in an <annotation> tag (happy path).
//   2. KaTeX rendered HTML-only (no annotation). We reconstruct LaTeX from the
//      .katex-html tree, covering mopen/mclose/mpunct/msupsub on mord and mclose,
//      named functions (ln/log/sin/cos/...), big operators with limits,
//      fractions, square roots, and Unicode → LaTeX symbol mapping.
//
// Used by both the notes/sources Turndown service and the chat Turndown service.

const KATEX_UNICODE_MAP = {
  '∂': '\\partial ', 'ρ': '\\rho ', 'α': '\\alpha ', 'β': '\\beta ',
  'γ': '\\gamma ', 'δ': '\\delta ', 'ε': '\\epsilon ', 'θ': '\\theta ',
  'λ': '\\lambda ', 'μ': '\\mu ', 'π': '\\pi ', 'σ': '\\sigma ',
  'τ': '\\tau ', 'φ': '\\phi ', 'ω': '\\omega ', 'Δ': '\\Delta ',
  'Σ': '\\Sigma ', 'Π': '\\Pi ', 'Ω': '\\Omega ', '∞': '\\infty ',
  '∫': '\\int ', '∑': '\\sum ', '∏': '\\prod ', '√': '\\sqrt',
  '±': '\\pm ', '×': '\\times ', '÷': '\\div ', '≤': '\\leq ',
  '≥': '\\geq ', '≠': '\\neq ', '≈': '\\approx ', '→': '\\rightarrow ',
  '←': '\\leftarrow ', '↔': '\\leftrightarrow ', '∈': '\\in ',
  '∉': '\\notin ', '⊂': '\\subset ', '⊃': '\\supset ', '∪': '\\cup ',
  '∩': '\\cap ', '∧': '\\land ', '∨': '\\lor ', '¬': '\\neg ',
  '∀': '\\forall ', '∃': '\\exists ', '∇': '\\nabla ', '·': '\\cdot '
};

// LaTeX command names for plain-text operators KaTeX renders inside `.mop`.
// Matched against the operator's textContent in lower case.
const KATEX_NAMED_FUNCTIONS = [
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'log', 'ln', 'lg', 'exp',
  'lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf',
  'det', 'dim', 'deg', 'arg', 'ker', 'gcd', 'hom', 'Pr',
  'mod'
];

function katexUnicodeToLatex(text) {
  if (!text) return '';
  let result = text;
  for (const [unicode, latex] of Object.entries(KATEX_UNICODE_MAP)) {
    result = result.split(unicode).join(latex);
  }
  return result;
}

function katexNamedFunctionFor(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  for (const name of KATEX_NAMED_FUNCTIONS) {
    if (t === name || t === name + '\u2009' /* thin space variants */) return '\\' + name;
  }
  return null;
}

// Extract { sub, sup } from a .msupsub element. KaTeX positions sub/sup spans
// inside a .vlist using inline `top` styles. Convention: more-negative top
// renders higher on screen → superscript; less-negative or positive top →
// subscript. For a single positioned span we classify by absolute top value.
function katexExtractSupSub(supsubEl) {
  if (!supsubEl) return { sub: '', sup: '' };
  const vlist = supsubEl.querySelector('.vlist-r > .vlist');
  if (!vlist) return { sub: '', sup: '' };
  const items = Array.from(vlist.children).filter(el => el.style && el.style.top);
  if (items.length === 0) return { sub: '', sup: '' };

  const itemText = (el) => {
    // Strip the pstrut spacer and grab the inner content.
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.pstrut').forEach(p => p.remove());
    return katexRenderInline(clone).trim();
  };

  if (items.length === 1) {
    // `top` is relative to the .pstrut spacer, not the baseline, so a
    // subscript (top -2.55em, pstrut 2.7em) is still negative (Nov 2026)
    const text = itemText(items[0]);
    const pstrut = items[0].querySelector('.pstrut');
    const kind = NLME.classifyKatexScript({
      top: parseFloat(items[0].style.top),
      pstrutHeight: pstrut ? parseFloat(pstrut.style.height) : NaN,
      hasDepth: !!supsubEl.querySelector('.vlist-t2')
    });
    return kind === 'sup' ? { sub: '', sup: text } : { sub: text, sup: '' };
  }

  // Two or more: sort by top, most negative first → superscript.
  const sorted = items.slice().sort((a, b) =>
    (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0)
  );
  return {
    sup: itemText(sorted[0]),
    sub: itemText(sorted[sorted.length - 1])
  };
}

// Extract { numerator, denominator } from a .mfrac element.
function katexExtractFraction(fracEl) {
  if (!fracEl) return null;
  const vlist = fracEl.querySelector('.vlist-r > .vlist');
  if (!vlist) return null;
  const spans = Array.from(vlist.children).filter(s => s.querySelector('.mord'));
  if (spans.length < 2) return null;
  spans.sort((a, b) => (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0));
  return {
    numerator: katexRenderInline(spans[0]).trim() || spans[0].textContent.trim(),
    denominator: katexRenderInline(spans[spans.length - 1]).trim() || spans[spans.length - 1].textContent.trim()
  };
}

// Format a base with optional super/subscripts, wrapping multi-char arguments.
function katexWithScripts(base, sub, sup) {
  let out = base;
  const wrap = (s) => (s.length === 1 ? s : `{${s}}`);
  if (sub) out += `_${wrap(sub)}`;
  if (sup) out += `^${wrap(sup)}`;
  return out;
}

// Render the *inline* content of any KaTeX HTML element to LaTeX. Walks
// children in order. Designed to be called recursively from itself and from
// helpers above.
function katexRenderInline(el) {
  if (!el) return '';
  if (el.nodeType === 3 /* TEXT_NODE */) return katexUnicodeToLatex(el.textContent || '');
  if (el.nodeType !== 1) return '';

  const cls = el.classList;

  // Skip spacing artifacts. Gemini Notebook prefixes some KaTeX classes
  // (katex-strut, katex-base, katex-sizing; Nov 2026).
  if (cls.contains('strut') || cls.contains('katex-strut') || cls.contains('pstrut') || cls.contains('vlist-s')) return '';

  // Skip ARIA-only mirrors.
  if (el.tagName === 'SPAN' && el.getAttribute('aria-hidden') === 'true' && cls.length === 0) {
    return '';
  }

  // Fractions.
  if (cls.contains('mfrac') || (cls.contains('mord') && el.querySelector(':scope > .mfrac'))) {
    const fracEl = cls.contains('mfrac') ? el : el.querySelector(':scope > .mfrac');
    const frac = katexExtractFraction(fracEl);
    if (frac) return `\\frac{${katexUnicodeToLatex(frac.numerator).trim()}}{${katexUnicodeToLatex(frac.denominator).trim()}}`;
  }

  // Square roots.
  if (cls.contains('sqrt')) {
    const radicand = el.querySelector('.mord:not(.sqrt)');
    const inner = radicand ? katexRenderInline(radicand).trim() : '';
    return `\\sqrt{${inner}}`;
  }

  // Big operators with stacked limits (op-limits).
  if (cls.contains('mop') && cls.contains('op-limits')) {
    return katexRenderOpLimits(el);
  }

  // Walk children. When we see a trailing .msupsub, attach to the previous
  // emitted fragment as ^/_ — covers `z^n`, `(1.23)^n`, `x_i`, etc.
  let out = '';
  const children = Array.from(el.children);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const cc = child.classList;

    if (cc.contains('strut') || cc.contains('katex-strut') || cc.contains('pstrut') || cc.contains('vlist-s')) continue;

    if (cc.contains('msupsub')) {
      const { sub, sup } = katexExtractSupSub(child);
      if (sub || sup) {
        if (out.length === 0) out = '{}';
        // Wrap the preceding atom so the script attaches correctly. Heuristic:
        // re-wrap whatever was emitted last as a single LaTeX atom.
        const lastAtom = out.match(/(\\[a-zA-Z]+|.)\s*$/)?.[0]?.trim() || '';
        if (lastAtom.length > 1 && !/^\\[a-zA-Z]+$/.test(lastAtom)) {
          // Not a single atom or command — wrap everything in braces.
          out = `{${out.trim()}}`;
        }
        if (sub) out += `_${sub.length === 1 ? sub : `{${sub}}`}`;
        if (sup) out += `^${sup.length === 1 ? sup : `{${sup}}`}`;
      }
      continue;
    }

    // Named function (\ln, \log, ...) — emit before any trailing msupsub.
    if (cc.contains('mop')) {
      const txt = child.textContent.trim();
      const named = katexNamedFunctionFor(txt);
      if (named) {
        out += named + ' ';
        continue;
      }
      if (txt.includes('∑') || txt.includes('Σ')) { out += '\\sum '; continue; }
      if (txt.includes('∫')) { out += '\\int '; continue; }
      if (txt.includes('∏')) { out += '\\prod '; continue; }
      out += katexUnicodeToLatex(txt) + ' ';
      continue;
    }

    if (cc.contains('mbin') || cc.contains('mrel')) {
      out += ` ${katexUnicodeToLatex(child.textContent.trim())} `;
      continue;
    }

    if (cc.contains('mopen') || cc.contains('mclose') || cc.contains('mpunct')) {
      // mclose may itself wrap a nested mclose + msupsub (e.g. `(1.23)^n`).
      if (child.children.length > 0 && Array.from(child.children).some(c => c.classList.contains('msupsub'))) {
        out += katexRenderInline(child);
      } else {
        out += child.textContent;
      }
      continue;
    }

    if (cc.contains('mord') || cc.contains('minner')) {
      // Recurse when the mord holds structure: a trailing msupsub, a fraction
      // wrapper (mord > mfrac) or a root. Its flat textContent would run the
      // denominator and numerator together ("1−p1" for 1/(1−p)).
      if (Array.from(child.children).some(c => c.classList.contains('msupsub')) ||
          cc.contains('sqrt') || child.querySelector(':scope > .mfrac, :scope > .sqrt')) {
        out += katexRenderInline(child);
      } else {
        out += katexUnicodeToLatex(child.textContent.trim());
      }
      continue;
    }

    if (cc.contains('mspace')) {
      out += ' ';
      continue;
    }

    if (cc.contains('base') || cc.contains('katex-base')) {
      out += katexRenderInline(child) + ' ';
      continue;
    }

    // Unknown class — recurse if it has children, else inline text.
    if (child.children.length > 0) {
      out += katexRenderInline(child);
    } else {
      out += katexUnicodeToLatex(child.textContent.trim());
    }
  }

  return out;
}

// Render a `.mop.op-limits` element (e.g. `\sum_{i=0}^{N}`).
function katexRenderOpLimits(mopEl) {
  let opText = '';
  let sub = '';
  let sup = '';
  const vlist = mopEl.querySelector('.vlist-r > .vlist');
  if (!vlist) return mopEl.textContent.trim();

  const items = Array.from(vlist.children).filter(el => el.style && el.style.top);
  items.sort((a, b) => (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0));

  const opItem = items.find(i => i.querySelector('.mop.op-symbol, .op-symbol'));
  const opTop = opItem ? parseFloat(opItem.style.top) || 0 : 0;

  for (const item of items) {
    const opSymbol = item.querySelector('.mop.op-symbol, .op-symbol');
    if (opSymbol) {
      const sym = opSymbol.textContent.trim();
      if (sym.includes('∑') || sym.includes('Σ')) opText = '\\sum';
      else if (sym.includes('∫')) opText = '\\int';
      else if (sym.includes('∏')) opText = '\\prod';
      else opText = katexUnicodeToLatex(sym).trim();
      continue;
    }
    const limitText = katexRenderInline(item).trim();
    const t = parseFloat(item.style.top) || 0;
    if (t < opTop) sup = limitText;
    else if (t > opTop) sub = limitText;
  }

  return katexWithScripts(opText || '\\sum', sub, sup);
}

// Top-level entry. Returns the math expression wrapped in `$` (inline) or `$$`
// (display) delimiters, or a plain text fallback if reconstruction yields
// nothing useful.
function convertKatexNodeToLatex(node) {
  const isDisplay = node.closest('.katex-display') !== null;
  const delim = isDisplay ? '$$' : '$';

  // Exact source first: the model's original LaTeX on the host span
  // (data-math, Nov 2026), else KaTeX's annotation. Rebuilding from the
  // rendered layout below is only a fallback.
  const exact = NLME.mathSourceToMarkdown({
    dataMath: node.closest('[data-math]')?.getAttribute('data-math'),
    annotation: node.querySelector('annotation[encoding="application/x-tex"]')?.textContent,
    display: isDisplay
  });
  if (exact) return exact;

  const katexHtml = node.querySelector('.katex-html');
  if (katexHtml) {
    const latex = katexRenderInline(katexHtml).replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    if (latex) return `${delim}${latex}${delim}`;
  }

  // Last-resort textual fallback.
  const text = node.textContent.replace(/\s+/g, ' ').trim();
  return text ? `${delim}${katexUnicodeToLatex(text)}${delim}` : '';
}

// ==================== END KATEX → LATEX CONVERSION ====================

// Google renamed NotebookLM to "Gemini Notebook" and moved it from
// notebooklm.google.com to notebook.google.com (Jul 2026). The old host 301s to
// the new one; keep both so users mid-rollout still work.

function isNotebookUrl(url) {
  return NLME.isNotebookUrl(url);
}

let currentTabId = null;
let autoRefreshInterval = null;
let settingsLoaded = false;
let settings = {
  autoZip: false,
  showNotifications: true,
  refreshInterval: 10,
  // Source export versions (which combinations to create)
  exportSourceBase: true, // Base version (always enabled, can't be disabled)
  exportSourcePlusMeta: true, // With metadata (summary & key topics)
  exportSourceWithImages: false, // With images (no metadata)
  exportSourcePlusMetaWithImages: false, // With metadata + images
  // Note export versions (which combinations to create)
  exportNoteBase: true, // Base version (always enabled, can't be disabled)
  exportNoteCodeBlocks: true, // Code blocks, no images (was: citationsCodeBlock)
  exportNoteWithImages: false, // With images, markdown (was: includeCitationImages)
  // Batch sizes
  sourcesPerZip: 25, // Number of sources per ZIP file (prevents memory issues)
  notesPerZip: 25, // Number of notes per ZIP file (prevents memory issues)
  // Text cleanup
  cleanOCRArtifacts: true, // Clean OCR garbage (~~~, :~:, etc.) from citation quotes
  // Interface
  showStudioTab: false, // Show the Studio tab (unified per-item list with delete)
  // Slide deck download format offered by the More menu ('pdf' | 'pptx')
  slidesFormat: 'pdf',
  // Note citations: 'quotes' hovers every marker; 'titles' takes source
  // titles from the markers only (no hovering); 'none' drops markers and Sources
  citationDetail: 'quotes'
};

document.addEventListener('DOMContentLoaded', () => {
  init();
});

// Listen for messages from content script (e.g., image download requests)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_IMAGE_AS_BASE64') {
    // Handle image download request from content script
    downloadImageAsBase64(message.url)
      .then(dataUri => {
        sendResponse({ success: true, dataUri });
      })
      .catch(error => {
        console.error('[NotebookLM Takeout] Failed to download image:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

async function init() {
  // Disable export buttons until settings are loaded
  disableExportButtons();

  await loadSettings();
  settingsLoaded = true;

  // Re-enable export buttons after settings are loaded
  enableExportButtons();

  await checkStatus();
  setupEventListeners();
  setupTabSwitching();
  await scanSourcesPage(); // Start with Sources tab since it's now the default

  // Monitor tab changes
  chrome.tabs.onActivated.addListener(handleTabChange);
  chrome.tabs.onUpdated.addListener(handleTabUpdate);
}

function disableExportButtons() {
  const exportButtons = [
    'export-notes-btn',
    'export-sources-btn',
    'export-chat-btn',
    'scan-sources-btn',
    'scan-chat-btn',
    'full-takeout-btn'
  ];

  exportButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }
  });
}

function enableExportButtons() {
  const exportButtons = [
    'export-notes-btn',
    'export-sources-btn',
    'export-chat-btn',
    'scan-sources-btn',
    'scan-chat-btn',
    'full-takeout-btn'
  ];

  exportButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['settings']);
  if (stored.settings) {
    // Migrate old settings to new format if needed
    const migrated = { ...settings, ...stored.settings };

    // Migrate old citationsCodeBlock to new exportNoteCodeBlocks
    if ('citationsCodeBlock' in stored.settings && !('exportNoteCodeBlocks' in stored.settings)) {
      migrated.exportNoteCodeBlocks = stored.settings.citationsCodeBlock;
    }

    // Migrate old includeCitationImages to new exportNoteWithImages
    if ('includeCitationImages' in stored.settings && !('exportNoteWithImages' in stored.settings)) {
      migrated.exportNoteWithImages = stored.settings.includeCitationImages;
    }

    // Migrate old includeSourceMetadata to new exportSourcePlusMeta
    if ('includeSourceMetadata' in stored.settings && !('exportSourcePlusMeta' in stored.settings)) {
      migrated.exportSourcePlusMeta = stored.settings.includeSourceMetadata;
    }

    // Migrate old exportWithImagesVersion to new exportSourceWithImages
    if ('exportWithImagesVersion' in stored.settings && !('exportSourceWithImages' in stored.settings)) {
      migrated.exportSourceWithImages = stored.settings.exportWithImagesVersion;
    }

    settings = migrated;
  }

  // Apply settings to UI
  document.getElementById('auto-zip-checkbox').checked = settings.autoZip;
  document.getElementById('show-notifications-checkbox').checked = settings.showNotifications;
  document.getElementById('refresh-interval-input').value = settings.refreshInterval;

  // Source version checkboxes
  document.getElementById('export-source-base-checkbox').checked = settings.exportSourceBase;
  document.getElementById('export-source-plus-meta-checkbox').checked = settings.exportSourcePlusMeta;
  document.getElementById('export-source-with-images-checkbox').checked = settings.exportSourceWithImages;
  document.getElementById('export-source-plus-meta-with-images-checkbox').checked = settings.exportSourcePlusMetaWithImages;

  // Note version checkboxes
  document.getElementById('export-note-base-checkbox').checked = settings.exportNoteBase;
  document.getElementById('export-note-code-blocks-checkbox').checked = settings.exportNoteCodeBlocks;
  document.getElementById('export-note-with-images-checkbox').checked = settings.exportNoteWithImages;

  // Sync legacy settings for chat export compatibility

  // Batch sizes
  document.getElementById('sources-per-zip-input').value = settings.sourcesPerZip;
  document.getElementById('notes-per-zip-input').value = settings.notesPerZip;

  // Text processing
  document.getElementById('clean-ocr-artifacts-checkbox').checked = settings.cleanOCRArtifacts;

  // Interface
  document.getElementById('show-studio-tab-checkbox').checked = settings.showStudioTab;
  document.getElementById('slides-format-select').value = settings.slidesFormat;
  document.getElementById('citation-detail-select').value = settings.citationDetail;
  applyStudioTabVisibility();
  updateChatCitationInfo();
}

// The Chat tab's one-line reminder of the Citation detail it will export with
function updateChatCitationInfo() {
  const el = document.getElementById('chat-citation-info');
  if (!el) return;
  const label = { quotes: 'Full quotes', titles: 'Source titles only', none: 'No citations' }[NLME.chatCitationMode(settings)];
  el.textContent = `Citations: ${label} · change in ⚙️ Settings`;
}

function applyStudioTabVisibility() {
  const tabBtn = document.querySelector('.tab-btn[data-tab="studio"]');
  const tabContent = document.querySelector('.tab-content[data-tab-content="studio"]');
  if (!tabBtn || !tabContent) return;

  if (settings.showStudioTab) {
    tabBtn.hidden = false;
    tabContent.hidden = false;
  } else {
    tabBtn.hidden = true;
    tabContent.hidden = true;
    // If Studio was the active tab, fall back to Sources.
    if (tabBtn.classList.contains('active')) {
      tabBtn.classList.remove('active');
      tabContent.classList.remove('active');
      const sourcesBtn = document.querySelector('.tab-btn[data-tab="sources"]');
      const sourcesContent = document.querySelector('.tab-content[data-tab-content="sources"]');
      if (sourcesBtn) sourcesBtn.classList.add('active');
      if (sourcesContent) sourcesContent.classList.add('active');
    }
  }
}

async function saveSettings() {
  settings.autoZip = document.getElementById('auto-zip-checkbox').checked;
  settings.showNotifications = document.getElementById('show-notifications-checkbox').checked;
  settings.refreshInterval = parseInt(document.getElementById('refresh-interval-input').value) || 10;

  // Source version selections
  settings.exportSourceBase = document.getElementById('export-source-base-checkbox').checked;
  settings.exportSourcePlusMeta = document.getElementById('export-source-plus-meta-checkbox').checked;
  settings.exportSourceWithImages = document.getElementById('export-source-with-images-checkbox').checked;
  settings.exportSourcePlusMetaWithImages = document.getElementById('export-source-plus-meta-with-images-checkbox').checked;

  // Note version selections
  settings.exportNoteBase = document.getElementById('export-note-base-checkbox').checked;
  settings.exportNoteCodeBlocks = document.getElementById('export-note-code-blocks-checkbox').checked;
  settings.exportNoteWithImages = document.getElementById('export-note-with-images-checkbox').checked;

  // Sync legacy settings for chat export compatibility

  // Batch sizes
  settings.sourcesPerZip = parseInt(document.getElementById('sources-per-zip-input').value) || 25;
  settings.notesPerZip = parseInt(document.getElementById('notes-per-zip-input').value) || 25;

  // Text processing
  settings.cleanOCRArtifacts = document.getElementById('clean-ocr-artifacts-checkbox').checked;

  // Interface
  settings.showStudioTab = document.getElementById('show-studio-tab-checkbox').checked;
  settings.slidesFormat = document.getElementById('slides-format-select').value === 'pptx' ? 'pptx' : 'pdf';
  settings.citationDetail = ['titles', 'none'].includes(document.getElementById('citation-detail-select').value)
    ? document.getElementById('citation-detail-select').value : 'quotes';
  applyStudioTabVisibility();
  updateChatCitationInfo();

  await chrome.storage.local.set({ settings });
}

function setupEventListeners() {
  document.getElementById('rescan-btn').addEventListener('click', () => { if (!jobLock.current()) scanPage(); });
  document.getElementById('cancel-download-btn')?.addEventListener('click', requestCancel);

  document.getElementById('auto-refresh-checkbox').addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').style.display = 'block';
  });

  document.getElementById('close-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').style.display = 'none';
    saveSettings();
  });

  // Full Takeout: the whole notebook in one run (sidebar-takeout.js)
  document.getElementById('full-takeout-btn')?.addEventListener('click', () => runExclusive('Full Takeout', runFullTakeout));

  // Health check panel
  // The health check hovers real citations, so it must never run during an
  // export (its popovers would race the export's own hovers)
  document.getElementById('health-check-btn').addEventListener('click', () => {
    runExclusive('Health check', runHealthCheck);
  });

  document.getElementById('close-health-check-btn').addEventListener('click', () => {
    document.getElementById('health-check-panel').style.display = 'none';
  });

  document.getElementById('rerun-health-check-btn').addEventListener('click', () => {
    runExclusive('Health check', runHealthCheck);
  });

  document.getElementById('copy-health-report-btn').addEventListener('click', () => {
    copyHealthReport();
  });

  // Settings inputs
  document.querySelectorAll('#settings-panel input, #settings-panel select').forEach(input => {
    input.addEventListener('change', saveSettings);
  });

  // Source version checkboxes - parent/child relationships
  // Parent checkboxes control whether child "include images" checkboxes are enabled
  const sourceParentChildPairs = [
    { parent: 'export-source-base-checkbox', child: 'export-source-with-images-checkbox' },
    { parent: 'export-source-plus-meta-checkbox', child: 'export-source-plus-meta-with-images-checkbox' }
  ];

  // Function to update child checkbox state based on parent
  function updateSourceChildState(parentId, childId) {
    const parent = document.getElementById(parentId);
    const child = document.getElementById(childId);
    if (parent && child) {
      child.disabled = !parent.checked;
      if (!parent.checked) {
        child.checked = false;
      }
    }
  }

  // Initialize child states and add event listeners
  sourceParentChildPairs.forEach(({ parent, child }) => {
    updateSourceChildState(parent, child);

    const parentCheckbox = document.getElementById(parent);
    if (parentCheckbox && !parentCheckbox.disabled) {
      parentCheckbox.addEventListener('change', () => {
        updateSourceChildState(parent, child);

        // Ensure at least one parent version is selected
        const baseChecked = document.getElementById('export-source-base-checkbox').checked;
        const metaChecked = document.getElementById('export-source-plus-meta-checkbox').checked;
        if (!baseChecked && !metaChecked) {
          parentCheckbox.checked = true;
          updateSourceChildState(parent, child);
          showToast('At least one source version must be selected', 'error');
        }
      });
    }
  });

  // Note version checkboxes - parent/child relationships
  // Parent checkboxes control whether child "include images" checkboxes are enabled
  const noteParentChildPairs = [
    { parent: 'export-note-base-checkbox', child: 'export-note-with-images-checkbox' }
  ];

  // Function to update child checkbox state based on parent
  function updateNoteChildState(parentId, childId) {
    const parent = document.getElementById(parentId);
    const child = document.getElementById(childId);
    if (parent && child) {
      child.disabled = !parent.checked;
      if (!parent.checked) {
        child.checked = false;
      }
    }
  }

  // Initialize child states and add event listeners
  noteParentChildPairs.forEach(({ parent, child }) => {
    updateNoteChildState(parent, child);

    const parentCheckbox = document.getElementById(parent);
    if (parentCheckbox && !parentCheckbox.disabled) {
      parentCheckbox.addEventListener('change', () => {
        updateNoteChildState(parent, child);

        // Ensure at least one parent version is selected
        const baseChecked = document.getElementById('export-note-base-checkbox').checked;
        const codeBlocksChecked = document.getElementById('export-note-code-blocks-checkbox').checked;
        if (!baseChecked && !codeBlocksChecked) {
          parentCheckbox.checked = true;
          updateNoteChildState(parent, child);
          showToast('At least one note version must be selected', 'error');
        }
      });
    }
  });

  // Sources scan button
  const scanSourcesBtn = document.getElementById('scan-sources-btn');
  if (scanSourcesBtn) {
    scanSourcesBtn.addEventListener('click', scanSourcesPage);
  }

  // Chat scan button
  const scanChatBtn = document.getElementById('scan-chat-btn');
  if (scanChatBtn) {
    scanChatBtn.addEventListener('click', () => runExclusive('Chat scan', scanChatPage));
  }

  // Dismiss warning banner button
  const dismissWarningBtn = document.getElementById('dismiss-warning-btn');
  if (dismissWarningBtn) {
    dismissWarningBtn.addEventListener('click', hideWarningBanner);
  }

  // Studio tab buttons
  const scanStudioBtn = document.getElementById('scan-studio-btn');
  if (scanStudioBtn) {
    scanStudioBtn.addEventListener('click', scanStudioPage);
  }
  const studioDownloadSelectedBtn = document.getElementById('studio-download-selected-btn');
  if (studioDownloadSelectedBtn) {
    studioDownloadSelectedBtn.addEventListener('click', () => runExclusive('Studio download', handleStudioBulkDownload));
  }
  const studioDeleteSelectedBtn = document.getElementById('studio-delete-selected-btn');
  if (studioDeleteSelectedBtn) {
    studioDeleteSelectedBtn.addEventListener('click', () => runExclusive('Studio delete', handleStudioBulkDelete));
  }
}

function setupTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetTab = btn.dataset.tab;

      // Update button states
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content visibility
      tabContents.forEach(content => {
        if (content.dataset.tabContent === targetTab) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });

      // Trigger scan for the active tab (not while a job runs)
      if (jobLock.current()) {
        // skip
      } else if (targetTab === 'notes') {
        await scanNotesPage();
      } else if (targetTab === 'artifacts') {
        await scanPage();
      } else if (targetTab === 'sources') {
        await scanSourcesPage();
      } else if (targetTab === 'studio') {
        await scanStudioPage();
      }
      // Chat tab: no auto-scan, user must click "Scan Chat" button manually
    });
  });
}

function startAutoRefresh() {
  stopAutoRefresh(); // Clear any existing interval

  const interval = settings.refreshInterval * 1000;
  autoRefreshInterval = setInterval(async () => {
    if (jobLock.current()) return; // never rescan during a job
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (isNotebookUrl(tab?.url)) {
      await scanPage();
    }
  }, interval);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

async function handleTabChange(activeInfo) {
  currentTabId = activeInfo.tabId;
  await checkStatus();
  if (!jobLock.current()) await scanPage();
}

async function handleTabUpdate(tabId, changeInfo, tab) {
  // Only update if this is the active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id === tabId) {
    if (changeInfo.status === 'complete') {
      await checkStatus();
      if (!jobLock.current()) await scanPage();
    }
  }
}

// ==================== RETRY LOGIC ====================

/**
 * Retry a download function with exponential backoff
 * @param {Function} downloadFn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {string} itemName - Name of item being downloaded (for logging)
 * @returns {Promise} Result from downloadFn or throws after all retries
 */
async function retryDownload(downloadFn, maxRetries = 3, itemName = 'item') {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.download(itemName, 'progress', `Attempt ${attempt}/${maxRetries}`);
      const result = await downloadFn();

      if (result && result.success !== false) {
        logger.download(itemName, 'success', `Succeeded on attempt ${attempt}`);
        return result;
      }

      // If result has success: false, treat as error
      lastError = new Error(result.error || 'Download returned failure');
      logger.warn('Download', `Attempt ${attempt} failed for ${itemName}`, lastError.message);

    } catch (error) {
      lastError = error;
      logger.warn('Download', `Attempt ${attempt} failed for ${itemName}`, error.message);
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s - max 5s)
    if (attempt < maxRetries) {
      const delayMs = Math.min(Math.pow(2, attempt - 1) * 1000, 5000);
      logger.info('Download', `Waiting ${delayMs}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries failed
  logger.error('Download', `All ${maxRetries} attempts failed for ${itemName}`, lastError);
  throw lastError || new Error('Download failed after all retries');
}

// ==================== ARTIFACT FILES ====================

/**
 * Get artifact type prefix for filenames
 */
function getArtifactTypePrefix(artifactType) {
  return NLME.artifactTypePrefix(artifactType);
}

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

// A mind map as <stem>.svg, <stem>.json and the interactive <stem>.html
// (the viewer is skipped when its template cannot load)
async function mindmapFiles(stem, svgContent, treeData, title) {
  const files = [
    { path: `${stem}.svg`, data: svgContent || '' },
    { path: `${stem}.json`, data: JSON.stringify(treeData || {}, null, 2) }
  ];
  try {
    files.push({ path: `${stem}.html`, data: await generateMindmapHTML(svgContent || '', title) });
  } catch (e) {
    console.warn('[NotebookLM Takeout] Mindmap HTML viewer template unavailable:', e);
  }
  return files;
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
      await chrome.runtime.sendMessage({ type: 'START_INTERCEPT_DOWNLOAD', name: label, artifactType: type, folder });
    }

    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'DOWNLOAD_ARTIFACT',
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
        const frame = await chrome.runtime.sendMessage({ type: 'EXTRACT_MINDMAP_FRAME', tabId });
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
          result = await chrome.runtime.sendMessage({ type: 'GET_INTERCEPTED_DOWNLOAD' });
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
    await chrome.runtime.sendMessage({ type: 'CANCEL_INTERCEPT' }).catch(() => {});
  }
}

/**
 * Download one artifact (row button, Studio list): today's single-file
 * names ([report]_Title.md, [audio-overview]_Title.m4a, ...); a Data Table
 * or mind map is one ZIP ([data-table]_Title.zip, [MINDMAP]_Title.zip).
 */
async function downloadArtifact(tabId, artifactIndex, artifactType, artifactName) {
  const stem = `[${getArtifactTypePrefix(artifactType)}]_${sanitizeFilename(artifactName)}`;
  const { files } = await fetchArtifactFiles(tabId,
    { index: artifactIndex, type: artifactType, label: artifactName },
    { stem, mode: 'single' });
  // Data Tables and mind maps are several files: one ZIP, as before 3a
  const pkg = NLME.singleArtifactPackage({ type: artifactType, title: artifactName, files });
  if (pkg) await saveFiles(pkg.entries, { zipName: pkg.zipName });
  else await saveFiles(files);
  return { success: true, files: files.length };
}

// ==================== STATUS CHECK ====================

async function checkStatus() {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('status-text');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;

    if (isNotebookUrl(tab?.url)) {
      statusDot.classList.remove('inactive');
      statusDot.classList.add('active');
      statusText.textContent = 'Connected to NotebookLM';
    } else {
      statusDot.classList.remove('active');
      statusDot.classList.add('inactive');
      statusText.textContent = 'Not on NotebookLM';
    }
  } catch (error) {
    statusDot.classList.remove('active');
    statusDot.classList.add('inactive');
    statusText.textContent = 'Unable to check status';
  }
}

// A scan the page answered with an error message (SCAN_SOURCES, SCAN_CHAT);
// the tab scans show that message as is
class ScanError extends Error {}

// Studio artifacts from SCAN_STUDIO_ITEMS, no UI (Artifacts tab, Full
// Takeout). disabled: a type that cannot be exported yet.
// @returns {Promise<Array<{ index, label, type, details, disabled }>>}
async function scanArtifactsData(tabId) {
  await ensureContentScriptLoaded(tabId);
  const scan = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_STUDIO_ITEMS' });
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

// Set a button's text, keeping its icon: the label is the last text node
function setButtonLabel(btn, text) {
  if (!btn) return;
  const last = btn.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) last.textContent = text;
  else btn.append(text);
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

// ==================== NOTE SCANNING ====================

// Helper to ensure content script is loaded
async function ensureContentScriptLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch (error) {
    if (error.message.includes('Receiving end does not exist')) {
      console.log('[NotebookLM Takeout] Content script not loaded, injecting...');
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['takeout-shared.js', 'mindmap-extract.js', 'content.js']
      });
      // The page-world download hook too (guarded against double install)
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        files: ['takeout-shared.js', 'injected.js']
      }).catch(err => console.warn('[NotebookLM Takeout] Download hook injection failed:', err.message));
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    }
    throw error;
  }
}

// Notes from SCAN_NOTES, no UI (Notes tab, Full Takeout)
// @returns {Promise<Array<{ index, title, ... }>>} as the content script sends them
async function scanNotesData(tabId) {
  await ensureContentScriptLoaded(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_NOTES' });
  return response?.notes || [];
}

// Sidebar function to trigger note scan
async function scanNotesPage() {
  const notesResults = document.getElementById('notes-results');
  const noteCount = document.getElementById('note-count');

  notesResults.innerHTML = '<p class="scanning">Scanning for notes...</p>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!isNotebookUrl(tab?.url)) {
      notesResults.innerHTML = '<p class="empty-message">Please open NotebookLM first</p>';
      noteCount.textContent = '0';
      return;
    }

    const notes = await scanNotesData(tab.id);
    console.log('[NotebookLM Takeout] Scanned notes:', notes);

    renderNotesList(notes);

  } catch (error) {
    console.error('Error scanning for notes:', error);
    notesResults.innerHTML = '<p class="error-message">Failed to scan for notes. Please refresh the NotebookLM page and try again.</p>';
    noteCount.textContent = '0';
  }
}

// The Notes tab's list controller (sidebar-list.js); replaced on every redraw
let _notesListController = null;

// Single-note export from a row button: loose .md files, no ZIP
async function handleNoteRowExport(note) {
  // JOB_BUSY: runExclusive has already shown the "still running" toast
  await runExclusive('Note export', async () => {
    try {
      await exportSingleNote(note);
      showToast(`Exported "${note.title}"`, 'success');
    } catch (error) {
      console.error('[NotebookLM Takeout] Note export failed:', error);
      showToast(`✗ Failed to export ${note.title}: ${error.message || error}`, 'error');
    }
  });
}

// Render notes list with filter toolbar and checkboxes
function renderNotesList(notes) {
  const notesResults = document.getElementById('notes-results');
  const noteCount = document.getElementById('note-count');

  if (_notesListController) {
    _notesListController.destroy();
    _notesListController = null;
  }

  if (notes.length === 0) {
    notesResults.innerHTML = '<p class="empty-message">No notes found. Add source materials to your notebook.</p>';
    noteCount.textContent = '0';
    return;
  }

  noteCount.textContent = notes.length;

  notesResults.innerHTML = `
    <div class="notes-list"></div>
    <div class="export-controls">
      <button id="export-notes-btn" class="btn btn-primary">
        Export Selected Notes
      </button>
    </div>
  `;
  const listEl = notesResults.querySelector('.notes-list');
  const exportBtn = document.getElementById('export-notes-btn');

  const rowHtml = (note, idx) => {
    // Choose icon based on note type
    const isMindmap = note.type === 'Mindmap';

    let iconColor = '#1a73e8'; // Default: blue for notes
    if (isMindmap) iconColor = '#ea4335'; // Red for mindmaps

    let iconPath;
    if (isMindmap) {
      iconPath = 'M14 2l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h8zm-1 2H6v16h12V9h-5V4zM12 11c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm-5 4h2.5c-.3-.6-.5-1.3-.5-2s.2-1.4.5-2H7v4zm8.5 0H18v-4h-2.5c.3.6.5 1.3.5 2s-.2 1.4-.5 2z';
    } else {
      iconPath = 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z';
    }

    return `
        <div class="scan-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${iconColor}">
            <path d="${iconPath}"/>
          </svg>
        </div>
        <div class="scan-item-info">
          <strong>${escapeHtml(note.title)}</strong>
          <small>${escapeHtml(note.type)}</small>
        </div>
        <button class="btn-icon note-download-btn" data-index="${idx}" title="Export ${escapeHtml(note.title)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </button>
      `;
  };

  _notesListController = createListController({
    tab: 'notes',
    container: listEl,
    items: notes,
    titleOf: note => note.title,
    typeOf: note => note.type,
    defaultSelected: 'none',
    rowHtml,
    onChange: controller => {
      const n = controller.selectedCount();
      exportBtn.textContent = n > 0 ? `Export Selected Notes (${n})` : 'Export Selected Notes';
    }
  });

  // Row export buttons (the list controller ignores clicks on buttons, so they never toggle the row)
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.note-download-btn');
    if (!btn) return;
    e.stopPropagation();
    const note = notes[parseInt(btn.dataset.index, 10)];
    if (note) handleNoteRowExport(note);
  });

  // Setup export button
  exportBtn.addEventListener('click', async () => {
    const selected = _notesListController.selectedItems();

    if (selected.length === 0) {
      showToast('Please select at least one note', 'error');
      return;
    }

    await runExclusive('Notes export', () => exportNotesAsMarkdown(selected));
  });
}

// ==================== CSV CONVERSION ====================

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

// ==================== MARKDOWN CONVERSION ====================

// citationPlaceholders: false when no citation extraction ran (reports, source
// content), so unread markers don't produce "(citation details unavailable)".
// dropCitations: Citation detail 'none' — remove [n] markers and the Sources
// section, leaving plain text
function convertToMarkdown(htmlContent, sources, noteTitle, citationsCodeBlock = true, skipTitleIfPresent = false, noteId = null, citationPlaceholders = true, dropCitations = false) {
  // Debug: Log what we're converting
  logger.info('Markdown', `Converting note: "${noteTitle}"`);
  logger.info('Markdown', `  - HTML content length: ${htmlContent.length} chars`);
  logger.info('Markdown', `  - Number of sources: ${sources?.length || 0}`);
  logger.info('Markdown', `  - Citations code block: ${citationsCodeBlock}`);
  logger.info('Markdown', `  - Note ID for anchors: ${noteId || 'none (standalone)'}`);
  if (sources && sources.length > 0) {
    logger.info('Markdown', `  - Source indices: [${sources.map(s => s.sourceIndex).join(', ')}]`);
  }

  // Create anchor prefix for combined notes (prevents ID collisions)
  const anchorPrefix = noteId ? `note-${noteId}-` : '';

  // Initialize TurndownService with standardized configuration
  const turndownService = createTurndownService();

  // Track citation occurrences for back-references
  const citationOccurrences = new Map();

  // Custom rule for Report headings (uses role="heading" and aria-level)
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

  // Custom rule for blockquotes (callout boxes)
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

  // Custom rule for source-link elements
  turndownService.addRule('sourceLink', {
    filter: 'source-link',
    replacement: (content, node) => {
      const sourceIndex = node.dataset.sourceIndex;
      const linkText = node.textContent;
      const anchor = `src-${sourceIndex}`;
      return `[${linkText}](#${anchor})`;
    }
  });

  // Custom rule to strip Angular component wrappers
  turndownService.addRule('stripAngularComponents', {
    filter: (node) => {
      const nodeName = node.nodeName.toLowerCase();
      return nodeName === 'labs-tailwind-structural-element-view-v2' ||
             nodeName === 'labs-tailwind-doc-viewer' ||
             nodeName === 'report-viewer';
    },
    replacement: (content) => {
      return content; // Return inner content, strip wrapper
    }
  });

  // Custom rule for lists with Angular wrapper components
  // Handles <ol>/<ul> where <li> elements are nested inside wrapper components
  turndownService.addRule('listsWithWrappers', {
    filter: (node) => {
      return node.nodeName === 'OL' || node.nodeName === 'UL';
    },
    replacement: (content, node, options) => {
      const isOrdered = node.nodeName === 'OL';

      // Find all <li> elements at any depth
      const allLis = Array.from(node.querySelectorAll('li'));

      // Filter to only include <li> elements that belong directly to this list
      // (exclude nested list items)
      const items = allLis.filter(li => {
        let parent = li.parentElement;
        while (parent && parent !== node) {
          const tagName = parent.tagName;
          if (tagName === 'OL' || tagName === 'UL') {
            return false; // This li belongs to a nested list
          }
          parent = parent.parentElement;
        }
        return true; // This li belongs to this list
      });

      if (items.length === 0) {
        // No list items found, fall back to default behavior
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

  // Custom rule for tables (convert to markdown table format)
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
      return markdown;
    }
  });

  // Strip mat-icon elements (Google Material icons that shouldn't appear in markdown)
  turndownService.addRule('matIcons', {
    filter: (node) => node.nodeName === 'MAT-ICON',
    replacement: () => '' // Strip entirely
  });

  // Handle KaTeX math notation — delegates to the shared converter so notes,
  // sources, and chat all use the same logic. See convertKatexNodeToLatex().
  turndownService.addRule('katexMath', {
    filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('katex'),
    replacement: (_content, node) => convertKatexNodeToLatex(node)
  });

  // Custom rule for citation buttons
  turndownService.addRule('citationButtons', {
    filter: (node) => {
      // Skip expand/collapse buttons (more_horiz, unfold_less icons)
      if (node.nodeName === 'BUTTON') {
        const matIcon = node.querySelector('mat-icon');
        if (matIcon) {
          const iconText = matIcon.textContent?.trim();
          const ariaLabel = matIcon.getAttribute('aria-label') || '';
          if (iconText === 'more_horiz' || iconText === 'unfold_less' ||
              ariaLabel.includes('additional citations')) {
            return false; // Skip these buttons entirely
          }
        }
      }

      // Markers are button.citation-marker; they lost ng-star-inserted in Nov 2026
      if (node.nodeName === 'BUTTON' &&
          (node.classList.contains('citation-marker') || node.classList.contains('ng-star-inserted'))) {
        return true;
      }
      if (node.nodeName === 'A' && node.getAttribute('href')?.startsWith('#cite')) {
        return true;
      }
      if (node.nodeName === 'SOURCE-LINK' || node.hasAttribute('data-source-index')) {
        return true;
      }
      return false;
    },
    replacement: (content, node) => {
      if (dropCitations) return '';
      // Debug: Log what we're processing
      logger.info('Citation', `Processing citation node: ${node.nodeName}`);
      logger.info('Citation', `  - content: "${content}"`);
      logger.info('Citation', `  - data-source-index: ${node.getAttribute('data-source-index')}`);
      logger.info('Citation', `  - href: ${node.getAttribute('href')}`);
      logger.info('Citation', `  - outerHTML preview: ${node.outerHTML?.substring(0, 200)}`);

      let originalSourceIndex = node.getAttribute('data-source-index') ||
                                node.getAttribute('href')?.replace('#cite-', '');

      if (!originalSourceIndex && node.nodeName === 'BUTTON') {
        // The number is the span text; a mat-icon only appears on expanders
        originalSourceIndex = NLME.parseCitationIndex(node.querySelector('span')?.textContent) || '';
        if (!originalSourceIndex) {
          // Not a numbered citation (e.g. an unrecognised button) — drop it
          return '';
        }
      }

      if (!originalSourceIndex) {
        originalSourceIndex = content.trim();
        logger.info('Citation', `  - using content as originalSourceIndex: "${originalSourceIndex}"`);
      }

      logger.info('Citation', `  - original sourceIndex: "${originalSourceIndex}"`);

      // Original citation numbers everywhere so body links and the Sources
      // section always agree (buildCitationEntries)
      const displayNumber = originalSourceIndex;

      if (!citationOccurrences.has(displayNumber)) {
        citationOccurrences.set(displayNumber, 0);
      }
      const occurrenceCount = citationOccurrences.get(displayNumber) + 1;
      citationOccurrences.set(displayNumber, occurrenceCount);

      const output = `<sup><a id="${anchorPrefix}cite-ref-${displayNumber}-${occurrenceCount}" href="#${anchorPrefix}src-${displayNumber}">[${displayNumber}]</a></sup>`;
      logger.info('Citation', `  - generated: ${output}`);

      return output;
    }
  });

  // Convert main content
  let bodyMarkdown = turndownService.turndown(htmlContent);

  // Clean up: Merge consecutive footnote references into a single <sup> tag
  // Pattern: <sup>...[1]...</sup>,<sup>...[2]...</sup> → <sup>...[1]... ...[2]...</sup>
  // This removes both commas and the >< between footnotes
  bodyMarkdown = bodyMarkdown.replace(/<\/sup>\s*,?\s*<sup>/g, ' ');

  // Clean up escaped brackets that appear between sup tags
  // Pattern: </sup>\> <<sup> (literal backslash-greater-than space less-than)
  bodyMarkdown = bodyMarkdown.replace(/<\/sup>\\>\s*<<sup>/g, ' ');

  // Also clean up unescaped >< between sup tags
  // Pattern: </sup>><sup> or </sup>> <<sup>
  bodyMarkdown = bodyMarkdown.replace(/<\/sup>>\s*<<sup>/g, ' ');

  // Final cleanup: remove any remaining standalone \> < patterns in text
  bodyMarkdown = bodyMarkdown.replace(/\\>\s*</g, '');

  // Check if content already starts with the title as H1
  let markdown = '';
  // Skip title if empty string (used when title is added externally)
  if (!noteTitle || noteTitle.trim() === '') {
    logger.info('Markdown', `  - Skipping title (empty/not provided)`);
    markdown = bodyMarkdown;
  } else if (skipTitleIfPresent) {
    const titlePattern = new RegExp(`^#\\s+${noteTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i');
    if (titlePattern.test(bodyMarkdown)) {
      // Content already has title - don't add duplicate
      logger.info('Markdown', `  - Skipping duplicate title (already present in content)`);
      markdown = bodyMarkdown;
    } else {
      // Content doesn't have title - add it
      markdown = `# ${noteTitle}\n\n${bodyMarkdown}`;
    }
  } else {
    // Always add title (default behavior)
    markdown = `# ${noteTitle}\n\n${bodyMarkdown}`;
  }

  // Clean up excessive newlines (more than 2 consecutive)
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  // Fix occurrence numbers skipped by rules that convert a subtree twice
  // (lists), so every Sources back-link to "-1" has a target
  markdown = NLME.renumberCitationAnchors(markdown);

  // Sources section: extracted sources plus a placeholder for any marker
  // whose tooltip could not be read, all under their original numbers
  const entries = dropCitations ? [] : NLME.buildCitationEntries(sources, [...citationOccurrences.keys()], { placeholders: citationPlaceholders });
  if (entries.length > 0 && entries.every(entry => !entry.quote)) {
    // No quotes (titles-only, reports): one line per source with all its
    // numbers; every number keeps its own anchor so body links still resolve
    markdown += '\n\n---\n\n## Sources\n\n';
    for (const group of NLME.groupCitationEntries(entries)) {
      const anchors = group.numbers.map(n => `<a id="${anchorPrefix}src-${n}"></a>`).join('');
      const links = group.numbers.map(n => `[[${n}]](#${anchorPrefix}cite-ref-${n}-1)`).join(' ');
      markdown += `${anchors}\n**${links}** ${group.text}\n\n`;
    }
  } else if (entries.length > 0) {
    markdown += '\n\n---\n\n## Sources\n\n';

    entries.forEach(entry => {
      const n = entry.number;
      markdown += `<a id="${anchorPrefix}src-${n}"></a>\n`;
      // Source number links back to its first citation in the body
      markdown += `**[[${n}]](#${anchorPrefix}cite-ref-${n}-1)** ${entry.text}\n\n`;

      if (!entry.missing && entry.quote && entry.quote.length > 0) {
        // Optionally clean OCR artifacts, then escape markdown
        const cleanedQuote = settings.cleanOCRArtifacts ? cleanOCRArtifacts(entry.quote) : entry.quote;
        if (citationsCodeBlock) {
          // Fence longer than any backtick run in the quote, so code inside
          // the quote can't close it early and invert the rest of the file
          const fence = NLME.fenceFor(cleanedQuote);
          markdown += `${fence}markdown\n${cleanedQuote}\n${fence}\n\n`;
        } else {
          // Blockquote keeps the quote's own Markdown (lists, tables, emphasis)
          markdown += `${NLME.toBlockquote(cleanedQuote)}\n\n`;
        }
      }
    });
  }

  return markdown;
}

/**
 * Clean up common OCR artifacts and garbage characters
 * This handles text that was poorly OCR'd, especially from older documents or Fraktur
 * @param {string} text - The text to clean
 * @param {Object} options - Options for cleanup
 * @param {boolean} options.markUnclear - If true, mark unclear sections with [OCR?]
 * @returns {string} - Cleaned text
 */
// Export-wide phase timing (Milestone 1, Task 2). Content-script responses
// carry `timing` totals that are merged here; each export's _index.md ends
// with an "Export statistics" block and the same summary is logged.
let exportTimer = null;
let exportStartedAt = 0;
let lastChatScanTiming = null;

function startExportTiming() {
  exportTimer = NLME.createPhaseTimer();
  exportStartedAt = performance.now();
}

function mergeTiming(response) {
  if (exportTimer && response && response.timing) exportTimer.merge(response.timing);
}

function timingSummary() {
  if (!exportTimer) return '';
  const summary = NLME.formatTimingSummary(exportTimer.totals(), performance.now() - exportStartedAt);
  console.log('[NotebookLM Takeout][timing]\n' + summary);
  return '\n' + summary;
}

// Export audit (Milestone 2, Resilience #1): what the page showed vs what
// the export wrote. Expected counts come from the HTML each export reads.
function countPageContent(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const citationNumbers = [...doc.querySelectorAll('button.citation-marker')]
    .map(b => NLME.parseCitationIndex(b.querySelector('span')?.textContent))
    .filter(Boolean);
  const formulas = doc.querySelectorAll('.katex').length;
  return { citationNumbers, formulas };
}

// Citations: distinct markers vs sources actually read (an anchor is written
// for every marker even when its popup could not be read)
function addCitationCoverage(audit, html, sources, needQuotes, page = null) {
  const counts = page || countPageContent(html);
  const coverage = NLME.citationCoverage({ markerNumbers: counts.citationNumbers, sources, needQuotes });
  audit.expected.citations += coverage.expected;
  audit.written.citations += coverage.written;
}

function newAudit() {
  return { expected: { items: 0, citations: 0, formulas: 0 }, written: { items: 0, citations: 0, formulas: 0 } };
}

// Converts and counts formulas: .katex on the page vs formulas in the final
// Markdown (counted in the output, so nested list/table conversions that run
// the KaTeX converter twice can't inflate it)
function convertCounted(audit, html, convert, page = null) {
  const counts = page || countPageContent(html);
  const markdown = convert();
  audit.expected.formulas += counts.formulas;
  audit.written.formulas += NLME.countMarkdownFormulas(markdown);
  return markdown;
}

function auditMarkdown(title, audit) {
  const result = NLME.auditExport(audit);
  return { ok: result.ok, text: `# ${title} Audit\n\nWhat the page showed vs what was exported:\n\n${result.lines.join('\n')}\n` };
}

async function generateZipTimed(zip) {
  exportTimer?.start('zip.build');
  try {
    return await zip.generateAsync({ type: 'blob' });
  } finally {
    exportTimer?.end('zip.build');
  }
}

// One export/scan/download job at a time (Milestone 1, Task 3). While a job
// runs, controls in the tabs are disabled via body.job-running, auto-refresh
// and tab-switch rescans are skipped, and Cancel reaches the running job.
const jobLock = NLME.createJobLock();
let jobTabId = null;

// Returned by runExclusive when another job holds the lock
const JOB_BUSY = Symbol('job-busy');

async function runExclusive(name, fn) {
  if (!jobLock.tryAcquire(name)) {
    showToast(`${jobLock.current()} is still running`, 'warning');
    return JOB_BUSY;
  }
  document.body.classList.add('job-running');
  // Disable (not just dim) the tab controls so keyboard activation is
  // blocked too. Mark them: a scan may replace a control with a clone (the
  // chat Export button), and the clone must be re-enabled too, so restore
  // by the mark, not by the original element.
  Array.from(document.querySelectorAll('.tab-content button, .tab-content input, #full-takeout-btn'))
    .filter(el => !el.disabled && el.id !== 'cancel-download-btn')
    .forEach(el => { el.disabled = true; el.setAttribute('data-job-disabled', ''); });
  try {
    // Remember the job's tab: Cancel must reach it even after a tab switch
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      jobTabId = tab?.id ?? null;
    } catch (e) {
      jobTabId = null;
    }
    return await fn();
  } finally {
    jobLock.release(name);
    jobTabId = null;
    document.body.classList.remove('job-running');
    document.querySelectorAll('[data-job-disabled]').forEach(el => {
      el.disabled = false;
      el.removeAttribute('data-job-disabled');
    });
    // Blanket re-enabling above would leave K = 0 buttons enabled
    refreshListButtons();
  }
}

// The results panel's "Retry N failed": re-runs `exportFn` on the items that
// failed, under the job lock (a busy lock only shows its toast; the panel
// stays). null when nothing failed.
function retryFor(failedItems, jobName, exportFn) {
  if (!failedItems || failedItems.length === 0) return null;
  return {
    count: failedItems.length,
    run: () => runExclusive(jobName, () => exportFn(failedItems))
  };
}

// Buttons that follow a list's selection (disabled at K = 0): re-derive them from the
// controllers, whatever just enabled or disabled them (a job ending, a redraw)
function refreshListButtons() {
  updateArtifactsDownloadBtn();
  updateStudioBulkButtonsState();
}

// Same path as the page overlay's Cancel button: the content script flags the
// export as cancelled and broadcasts CANCEL_EXPORT to every running exporter.
async function requestCancel() {
  if (!jobLock.current()) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(jobTabId || currentTabId || tab?.id, { type: 'REQUEST_EXPORT_CANCEL' });
  } catch (error) {
    console.warn('[NotebookLM Takeout] Cancel request failed:', error.message);
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

// Quick pre-flight before artifact downloads and chat exports: warn (don't
// block) when the selectors they depend on are missing
async function preflightWarn(tabId, type) {
  try {
    const health = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_DOM_HEALTH', data: { type } });
    if (health && health.healthy === false) {
      showToast(`Gemini Notebook may have changed (${(health.issues || []).length} ${type} check(s) failed). Exporting anyway; run the health check 🩺 afterwards if results look wrong.`, 'warning');
    }
  } catch (e) {
    console.warn('[NotebookLM Takeout] Pre-flight check failed:', e.message);
  }
}

function cleanOCRArtifacts(text) {
  // Shared, unit-tested implementation (keeps paragraphs, tables, fences, ~~strike~~)
  return NLME.cleanOcrArtifacts(text);
}

function sanitizeFilename(filename) {
  // Shared, tested implementation (emoji-safe truncation, reserved names)
  return NLME.sanitizeFilename(filename);
}

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
 * Download an image from a URL and convert to base64 data URI
 */
async function downloadImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const blob = await response.blob();

    // Get MIME type from response or blob
    const mimeType = blob.type || 'image/jpeg';

    // Convert blob to base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // reader.result is already a data URI (data:image/jpeg;base64,...)
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`[NotebookLM Takeout] Failed to download image: ${url}`, error);
    throw error;
  }
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
 * Remove all images from markdown
 */
function stripImagesFromMarkdown(markdown) {
  // Remove markdown image syntax: ![alt](url)
  // This matches both embedded base64 and external URLs
  return markdown.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');
}

// ==================== EXPORT ORCHESTRATION ====================

/**
 * Extract project name from the NotebookLM page
 */
async function getProjectName(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_PROJECT_NAME' });
    if (response && response.projectName) {
      console.log('[NotebookLM Takeout] Project name:', response.projectName);
      return response.projectName;
    }
  } catch (error) {
    console.warn('[NotebookLM Takeout] Could not extract project name:', error);
  }
  return 'NotebookLM';
}

// Notes export (Milestone 3a): the shared export shell around runNotesJob.
// Each batch becomes one <Notebook>-notes-<ts>.zip from buildNotesFiles.
async function exportNotesAsMarkdown(selectedNotes) {
  startExportTiming();
  console.log('[NotebookLM Takeout] Starting export for notes:', selectedNotes.length);

  await withExportShell({ label: 'notes', healthType: 'notes', overlayMessage: 'Preparing to export notes...' }, async shell => {
    const { result, zips, auditOk } = await runNotesJob(shell, selectedNotes);

    shell.finish({
      kind: 'notes',
      selected: selectedNotes.length,
      result,
      auditOk,
      stoppedMessage: result.stopped
        ? `Stopped after ${result.exported} of ${selectedNotes.length} notes: citations could not be read (Gemini Notebook may have changed). Run the health check 🩺; details in errors.md.`
        : undefined,
      saved: zips,
      retry: retryFor(result.failedItems, 'Notes export', failed => exportNotesAsMarkdown(failed))
    });
  });
}

/**
 * Where a category runner writes (runNotesJob, runSourcesJob, runChatJob,
 * runArtifactsJob). Tab exports use the defaults: their own ZIPs,
 * <Notebook>-<kind>-<ts>.zip, paths as the builders return them. Full
 * Takeout passes pathPrefix '<root>/<category>/', zipKind
 * 'takeout-<category>' and, with ZIP off, the takeout's Downloads folder.
 *
 * @typedef {{ pathPrefix?: string, zipKind?: string, folder?: string|null }} CategoryTarget
 */

// One batch of a category's files to its ZIP (name pushed to `zips`) or, with
// target.folder, into that Downloads folder; every path gets `prefix`
async function saveCategoryBatch(shell, files, info, { prefix = '', zipKind, folder = null, zips, written = null }) {
  const placed = prefix ? files.map(f => ({ ...f, path: prefix + f.path })) : files;
  if (folder) {
    await saveFiles(placed, { folder });
    if (written) { written.count++; written.multi = info.totalBatches > 1; }
    return;
  }
  const zipName = NLME.zipName({
    notebook: shell.projectName,
    kind: zipKind,
    timestamp: shell.timestamp,
    partial: info.partial,
    part: info.batchIndex,
    totalParts: info.totalBatches
  });
  await saveFiles(placed, { zipName });
  zips.push(zipName);
  if (written) { written.count++; written.multi = info.totalBatches > 1; }
}

// A takeout category written in several batches puts each batch in its own
// part-N/ folder: every batch has its own _index.md and manifest.json, and
// note/source stems are only unique within a batch, so parts unzipped into one
// tree (or saved into one folder) must not share a folder. Tab exports (no
// prefix) keep their separate ZIPs as before.
function batchPrefix(pathPrefix, info) {
  if (!pathPrefix || info.totalBatches <= 1) return pathPrefix;
  return `${pathPrefix}part-${info.batchIndex}/`;
}

/**
 * Run the notes job (extract, batch, package) inside an export shell.
 *
 * @param {object} shell withExportShell's shell (tab, meta, progress, isCancelled)
 * @param {object[]} selectedNotes notes as SCAN_NOTES returns them
 * @param {CategoryTarget} [target]
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean }>}
 *   result: runExportJob's result
 */
async function runNotesJob(shell, selectedNotes, { pathPrefix = '', zipKind = 'notes', folder = null } = {}) {
  const perZip = settings.notesPerZip;
  // Shared by every extractNoteItem call: audit counters, early-stop
  // counters, and the DOM-warning decision
  const state = {
    audit: newAudit(),
    notesWithMarkers: 0,
    unreadNotes: 0,
    failures: 0,
    domWarningShown: false,
    declined: false // user declined the DOM warning: stops like a Cancel
  };
  let packaged = 0; // notes written to ZIPs so far
  const zips = [];
  const written = { count: 0, multi: false }; // batches saved: part-N/ folders for the takeout root index

  // Item counts go in last, once every written note is known
  const finalAudit = () => {
    state.audit.expected.items = selectedNotes.length;
    state.audit.written.items = packaged;
    return state.audit;
  };

  console.log(`[NotebookLM Takeout] Will create ${Math.ceil(selectedNotes.length / perZip)} ZIP(s) for ${selectedNotes.length} notes (${perZip} per ZIP)`);

  const result = await NLME.runExportJob({
    kind: 'notes',
    items: selectedNotes,
    perZip,
    extractOne: (note, ctx) => extractNoteItem(shell, note, ctx, state),
    // Always close the note viewer, even if extraction failed
    afterEach: async () => {
      try {
        const backResponse = await chrome.tabs.sendMessage(shell.tab.id, { type: 'NAVIGATE_BACK' });
        console.log('[NotebookLM Takeout] Navigate back response:', backResponse);
        // NAVIGATE_BACK resolves once the viewer is closed and the list is
        // back; the next EXTRACT_NOTE waits for a stable list itself
        // (Milestone 1: was a fixed 3 s per note)
      } catch (backError) {
        console.error('[NotebookLM Takeout] Failed to navigate back:', backError);
        // Continue: EXTRACT_NOTE fails the next note cleanly if a viewer is stuck
      }
    },
    packageBatch: async (notes, info) => {
      packaged += notes.length;
      shell.progress(`Creating ZIP ${info.batchIndex}/${info.totalBatches}...`, 1);
      // _audit.md goes into the last ZIP the run writes (an errors-only ZIP
      // too: the outcome toast may point at it)
      const auditText = info.isLast ? auditMarkdown('Notes Export', finalAudit()).text : null;
      const files = buildNotesFiles(notes, {
        meta: shell.meta,
        errors: info.errors,
        auditText,
        batchIndex: info.batchIndex,
        totalBatches: info.totalBatches,
        partial: info.partial
      });
      await saveCategoryBatch(shell, files, info, { prefix: batchPrefix(pathPrefix, info), zipKind, folder, zips, written });
      console.log(`[NotebookLM Takeout] Downloaded notes ZIP ${info.batchIndex}/${info.totalBatches}`);

      // CRITICAL: free each batch's memory before the next one
      await new Promise(resolve => setTimeout(resolve, 500));
      notes.forEach(note => {
        note.markdown = null;
        note.html = null;
        note.sources = null;
        note.svgContent = null;
        note.treeData = null;
      });
      // Give GC time to work between batches
      if (!info.isLast) await new Promise(resolve => setTimeout(resolve, 1000));
    },
    isCancelled: () => shell.isCancelled() || state.declined,
    onProgress: ({ done, total, batchIndex, totalBatches, item }) => {
      const batchStart = (batchIndex - 1) * perZip;
      const batchSize = Math.min(perZip, total - batchStart);
      shell.progress(`Batch ${batchIndex}/${totalBatches}: Processing ${done - batchStart + 1}/${batchSize}: ${item.title}`,
        (done + 1) / total);
      console.log(`[NotebookLM Takeout] Processing note ${done + 1}/${total}:`, item.title, 'index:', item.index);
    }
  });

  return { result, zips, errors: result.errors, auditOk: NLME.auditExport(finalAudit()).ok, parts: pathPrefix && written.multi ? written.count : 0 };
}

/**
 * Extract one note for the job runner: EXTRACT_NOTE, then a mind map entry or
 * the note's Markdown with audit counts. Non-fatal note errors go to
 * ctx.warn; a failed note throws (the runner records "[<title>] <message>").
 * Stops the job (ctx.stop) when the first three notes with citation markers
 * all came back without sources.
 *
 * @param {object} shell withExportShell's shell (tab)
 * @param {{index: number, title: string, sourceIndex?: number}} note
 * @param {{warn: Function, stop: Function}} ctx
 * @param {object} state counters shared across notes (see exportNotesAsMarkdown)
 * @returns {Promise<object>} NoteData: { title, markdown, html, sources } or
 *   { title, isMindmap: true, svgContent, treeData }
 */
async function extractNoteItem(shell, note, ctx, state) {
  let noteData;
  try {
    noteData = await chrome.tabs.sendMessage(shell.tab.id, {
      type: 'EXTRACT_NOTE',
      data: {
        noteIndex: note.index,
        noteTitle: note.title,
        sourceIndex: note.sourceIndex,
        // Only download images if user has enabled an image version
        includeCitationImages: !!settings.exportNoteWithImages,
        citationDetail: settings.citationDetail
      }
    });
    console.log('[NotebookLM Takeout] Note data received:', noteData);
    mergeTiming(noteData);

    if (noteData && !noteData.error) {
      (noteData.errors || []).forEach(err => ctx.warn(`[${note.title}] ${err}`));

      if (noteData.isMindmap) {
        return {
          title: note.title,
          isMindmap: true,
          svgContent: noteData.svgContent,
          treeData: noteData.treeData
        };
      }

      // Convert to markdown (without noteId for individual files),
      // counting citations and formulas for the audit
      const notePage = countPageContent(noteData.html);
      const markdown = convertCounted(state.audit, noteData.html,
        () => convertToMarkdown(noteData.html, noteData.sources, note.title, false, false, null, true, settings.citationDetail === 'none'), notePage);
      // 'none' drops citations on purpose: nothing to audit there
      if (settings.citationDetail !== 'none') {
        addCitationCoverage(state.audit, noteData.html, noteData.sources, settings.citationDetail === 'quotes', notePage);
      }
      if (notePage.citationNumbers.length > 0 && settings.citationDetail === 'quotes') {
        state.notesWithMarkers++;
        if ((noteData.sources || []).length === 0) state.unreadNotes++;
      }
      if (state.notesWithMarkers === 3 && state.unreadNotes === 3) {
        // The first three notes with citations all failed: the page has
        // probably changed. Stop instead of exporting 150 notes without
        // sources. This note is still written.
        ctx.stop(`[${note.title}] Citations could not be read in the first 3 notes that have them; export stopped (Gemini Notebook may have changed — run the health check)`);
      }

      return {
        title: note.title,
        markdown,
        // Raw data for combined-notes.md (which needs unique noteIds)
        html: noteData.html,
        sources: noteData.sources
      };
    }
  } catch (error) {
    console.error(`Failed to process note: ${note.title}`, error);
    showToast(`Error processing: ${note.title}`, 'error');
    throw await itemFailed(shell, state, `Exception during extraction: ${error.message || error.toString()}`);
  }

  console.error(`Failed to extract note: ${note.title}`, noteData?.error);
  showToast(`Skipped: ${note.title} (${noteData?.error || 'unknown error'})`, 'warning');
  throw await itemFailed(shell, state, `Failed to extract: ${noteData?.error || 'unknown error'}`);
}

// A note or source failed: every third failure, ask the page whether its DOM errors
// are worth a warning (once per export). Declining stops the job like a
// Cancel. Returns the Error for the runner to record.
async function itemFailed(shell, state, message) {
  state.failures++;
  if (state.failures % 3 === 0 && !state.domWarningShown) {
    try {
      const errorReport = await chrome.tabs.sendMessage(shell.tab.id, { type: 'GET_DOM_ERRORS' });
      if (errorReport && errorReport.shouldWarn) {
        const proceed = await showDOMWarningDialog(errorReport.issues, true);
        if (!proceed) state.declined = true;
        state.domWarningShown = true;
      }
    } catch (e) {
      console.warn('[NotebookLM Takeout] Could not check DOM errors:', e);
    }
  }
  return new Error(message);
}

/**
 * Return the list of note export "versions" the user currently has enabled.
 * Matches the variant set built by buildNotesFiles.
 */
// Versions for one note (NLME.noteVariants): base always, the others only
// when they would differ from base
function getEnabledNoteVersions({ hasQuotes = false, hasImages = false } = {}) {
  return NLME.noteVariants(settings, { hasQuotes, hasImages }).map(v => ({
    fileSuffix: v.suffix,
    variant: variantName(v.suffix),
    citationsCodeBlock: v.codeBlocks,
    stripImages: !v.images
  }));
}

/**
 * Trigger a download of a blob as a single file (no ZIP, no user save-as dialog).
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Give the browser a moment to queue the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Export one note (regular or mindmap) as individual file(s) — no ZIP.
 * Honors the user's enabled note export versions; always includes citations.
 *
 * @param {{index: number, title: string, type?: string}} note
 * @returns {Promise<{success: boolean, filesWritten: number}>}
 */
async function exportSingleNote(note) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isNotebookUrl(tab?.url)) {
    throw new Error('NotebookLM tab not active');
  }

  await ensureContentScriptLoaded(tab.id);

  // Notebook metadata for the notes' front matter
  const meta = NLME.exportMeta({
    notebookTitle: await getProjectName(tab.id),
    tabUrl: tab.url,
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date()
  });
  const needsImages = !!settings.exportNoteWithImages;

  let noteData;
  try {
    noteData = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXTRACT_NOTE',
      data: {
        noteIndex: note.index,
        noteTitle: note.title,
        sourceIndex: note.sourceIndex,
        includeCitationImages: needsImages,
        citationDetail: settings.citationDetail
      }
    });
  } finally {
    // Always close the note viewer so the next action has a clean page.
    try { await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK' }); } catch (_) { /* noop */ }
  }

  if (!noteData || noteData.error) {
    throw new Error(noteData?.error || 'Failed to extract note');
  }

  const sanitizedTitle = sanitizeFilename(note.title);
  let filesWritten = 0;

  if (noteData.isMindmap) {
    const files = await mindmapFiles(`[MINDMAP]_${sanitizedTitle}`, noteData.svgContent, noteData.treeData, note.title);
    await saveFiles(files);
    return { success: true, filesWritten: files.length };
  }

  // Regular note — produce enabled markdown versions, each as its own .md file.
  const versions = getEnabledNoteVersions({
    hasQuotes: (noteData.sources || []).some(src => src.quote && src.quote.trim()),
    hasImages: NLME.noteHasImages(noteData) // body or citation quotes
  });
  for (const version of versions) {
    let markdown = convertToMarkdown(
      noteData.html,
      noteData.sources,
      note.title,
      version.citationsCodeBlock,
      true, // skipTitleIfPresent
      null,
      true,
      settings.citationDetail === 'none'
    );
    if (version.stripImages) {
      markdown = stripImagesFromMarkdown(markdown);
    }
    markdown = noteFrontMatter(meta, { title: note.title, variant: version.variant }) + markdown;
    const filename = `[NOTE]_${sanitizedTitle}${version.fileSuffix}.md`;
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
    filesWritten++;
  }

  return { success: true, filesWritten };
}

// Variant name for front matter and manifest.json: 'base', 'code-blocks',
// 'with-images', 'plus-meta', ... (from an NLME.noteVariants or
// NLME.sourceVariants suffix)
function variantName(suffix) {
  return suffix ? suffix.replace(/^-/, '') : 'base';
}

// Front matter for a note file or a combined notes file (field order fixed by
// the Milestone 3a layout)
function noteFrontMatter(meta, { title, kind = 'note', variant }) {
  return NLME.frontMatter({
    title,
    notebook: meta.notebook,
    notebook_url: meta.notebook_url,
    notebook_id: meta.notebook_id,
    exporter: meta.exporter,
    exported: meta.exported,
    kind,
    variant
  });
}

/**
 * Files for one notes ZIP: notes/ (every enabled variant), combined-notes
 * files, mind-maps/, errors.md, _audit.md, _index.md and manifest.json (last).
 *
 * @param {object[]} notes NoteData from extractNoteItem (may be empty for an
 *   errors-only ZIP)
 * @param {{ meta: object, errors?: Array, auditText?: string|null,
 *   batchIndex?: number, totalBatches?: number, partial?: boolean }} options
 *   errors: ALL errors of the run, passed only to the last ZIP it writes
 * @returns {Array<{path: string, data: string, title?: string, variant?: string, itemKind?: string}>}
 */
function buildNotesFiles(notes, { meta, errors = [], auditText = null, batchIndex = 1, totalBatches = 1, partial = false }) {
  const files = [];
  const indexFiles = []; // Track all files for _index.md

  // Separate notes and mindmaps
  const regularNotes = notes.filter(n => !n.isMindmap);
  const mindmaps = notes.filter(n => n.isMindmap);

  // Which versions to write (NLME.noteVariants): base always; code blocks
  // only if some note in this ZIP has quotes; with-images only if some note
  // has images. Otherwise those files would be identical to base.
  const NOTE_VERSION_INFO = {
    '': { fileSuffix: '', combinedSuffix: '', citationsCodeBlock: false, stripImages: true,
      title: 'Base (markdown, no images)', description: 'Citations rendered as markdown, images stripped' },
    '-code-blocks': { fileSuffix: '-code-blocks', combinedSuffix: '-code-blocks', citationsCodeBlock: true, stripImages: true,
      title: 'Code blocks (no images)', description: 'Citation quotes in code blocks, images stripped' },
    '-with-images': { fileSuffix: '-with-images', combinedSuffix: '-with-images', citationsCodeBlock: false, stripImages: false,
      title: 'With images (markdown)', description: 'Citations rendered as markdown, with base64 images' }
  };
  const hasQuotes = notes.some(n => (n.sources || []).some(src => src.quote && src.quote.trim()));
  const hasImages = notes.some(n => NLME.noteHasImages(n)); // body or citation quotes
  const versions = NLME.noteVariants(settings, { hasQuotes, hasImages })
    .map(v => ({ ...NOTE_VERSION_INFO[v.suffix], variant: variantName(v.suffix) }));

  // Process regular notes (all versions in single notes/ folder with
  // suffixes); every variant of one note shares one stem, and no stem may
  // equal another note's stem+variant name
  if (regularNotes.length > 0) {
    const stems = NLME.uniqueStems(regularNotes.map(n => n.title),
      versions.map(v => v.fileSuffix).filter(Boolean));

    versions.forEach(version => {
      // Individual note files with version suffix
      regularNotes.forEach((note, idx) => {
        // Generate markdown with appropriate settings
        // Use skipTitleIfPresent=true to avoid duplicate titles
        let markdown = convertToMarkdown(
          note.html,
          note.sources,
          note.title,
          version.citationsCodeBlock,
          true, // skipTitleIfPresent
          null,
          true,
          settings.citationDetail === 'none'
        );

        // Strip images if needed
        if (version.stripImages) {
          markdown = stripImagesFromMarkdown(markdown);
        }

        const path = `notes/${stems[idx]}${version.fileSuffix}.md`;
        files.push({
          path,
          data: noteFrontMatter(meta, { title: note.title, variant: version.variant }) + markdown,
          title: note.title,
          variant: version.variant,
          itemKind: 'note'
        });
        indexFiles.push({
          path,
          title: note.title,
          version: version.title,
          versionDescription: version.description,
          itemType: 'Notes'
        });
      });

      // Combined markdown file for this version
      let combinedMarkdown = noteFrontMatter(meta, { title: `Notes — ${meta.notebook}`, kind: 'combined-notes', variant: version.variant });
      combinedMarkdown += `# Notes — ${meta.notebook}\n\n`;
      combinedMarkdown += `Exported: ${new Date().toLocaleString()}\n\n`;
      combinedMarkdown += `Total Notes: ${regularNotes.length}\n`;
      combinedMarkdown += `Version: ${version.title}\n\n`;
      combinedMarkdown += '---\n\n';

      regularNotes.forEach((note, idx) => {
        // Re-convert with unique noteId to prevent citation anchor collisions
        const noteId = idx + 1;
        let noteMarkdown = convertToMarkdown(
          note.html,
          note.sources,
          note.title,
          version.citationsCodeBlock,
          false, // skipTitleIfPresent
          noteId, // unique ID for this note's anchors
          true,
          settings.citationDetail === 'none'
        );

        // Strip images if needed
        if (version.stripImages) {
          noteMarkdown = stripImagesFromMarkdown(noteMarkdown);
        }

        combinedMarkdown += noteMarkdown + '\n\n';
        if (idx < regularNotes.length - 1) {
          combinedMarkdown += '---\n\n';
        }
      });

      const combinedFilename = `combined-notes${version.combinedSuffix}.md`;
      files.push({
        path: combinedFilename,
        data: combinedMarkdown,
        title: `Combined Notes - ${version.title}`,
        variant: version.variant,
        itemKind: 'combined-notes'
      });
      indexFiles.push({
        path: combinedFilename,
        title: `Combined Notes - ${version.title}`,
        version: version.title,
        versionDescription: version.description,
        itemType: 'Notes'
      });
    });
  }

  // Mind map SVG, JSON and interactive HTML files
  if (mindmaps.length > 0) {
    const stems = NLME.uniqueStems(mindmaps.map(m => m.title));

    mindmaps.forEach((mindmap, idx) => {
      const base = `mind-maps/${stems[idx]}`;
      const entries = [
        [`${base}.svg`, mindmap.svgContent, `${mindmap.title} (SVG)`],
        [`${base}.json`, JSON.stringify(mindmap.treeData, null, 2), `${mindmap.title} (JSON)`],
        [`${base}.html`, generateMindmapHTMLSync(mindmap.svgContent, mindmap.title), `${mindmap.title} (Interactive HTML)`]
      ];
      for (const [path, data, indexTitle] of entries) {
        files.push({ path, data, title: mindmap.title, itemKind: 'mindmap' });
        indexFiles.push({ path, title: indexTitle });
      }
    });
  }

  // errors.md when the caller passes errors (it passes ALL errors to the
  // last ZIP the run writes: the final batch, or the one it ended in)
  if (errors.length > 0) {
    files.push({
      path: 'errors.md',
      data: NLME.buildErrorReport({
        title: 'Notes Export',
        generatedAt: new Date().toLocaleString(),
        errors
      })
    });
    indexFiles.push({ path: 'errors.md', title: 'Export Errors' });
  }

  if (auditText) {
    files.push({ path: '_audit.md', data: auditText });
  }

  // Generate _index.md with links to all files
  let indexContent = `# Notes — ${meta.notebook}\n\n`;
  indexContent += `Generated: ${new Date().toLocaleString()}\n\n`;

  if (totalBatches > 1) {
    indexContent += `**Part ${batchIndex} of ${totalBatches}**\n\n`;
  }

  indexContent += `Total Notes: ${regularNotes.length}\n`;
  indexContent += `Total Mindmaps: ${mindmaps.length}\n`;
  indexContent += `Total Files: ${indexFiles.length}\n\n`;
  indexContent += '---\n\n';

  // Generate Notes section (with versions)
  if (regularNotes.length > 0) {
    indexContent += `# Notes\n\n`;
    indexContent += `Total: ${regularNotes.length}\n`;
    indexContent += `Versions: ${versions.length}\n\n`;

    // Combined files section
    const combinedFiles = indexFiles.filter(f => f.path.startsWith('combined-notes') && f.itemType === 'Notes');
    if (combinedFiles.length > 0) {
      indexContent += `## Combined Notes (All in One File)\n\n`;
      indexContent += `Available in ${combinedFiles.length} version(s):\n\n`;
      combinedFiles.forEach(file => {
        indexContent += `- **[${file.title}](${encodeURI(file.path)})**\n`;
        if (file.versionDescription) {
          indexContent += `  - ${file.versionDescription}\n`;
        }
      });
      indexContent += '\n';
    }

    // Individual notes section - grouped by note title
    const noteFiles = indexFiles.filter(f => f.path.startsWith('notes/') && f.itemType === 'Notes');
    if (noteFiles.length > 0) {
      indexContent += `## Individual Notes\n\n`;
      indexContent += `All versions available in the \`notes/\` folder with suffixes:\n\n`;

      // Group by note title
      const notesByTitle = new Map();
      noteFiles.forEach(file => {
        if (!notesByTitle.has(file.title)) {
          notesByTitle.set(file.title, []);
        }
        notesByTitle.get(file.title).push(file);
      });

      // List each note with its versions
      notesByTitle.forEach((titleFiles, title) => {
        indexContent += `### ${title}\n\n`;
        titleFiles.forEach(file => {
          const versionLabel = file.version ? ` (${file.version})` : '';
          indexContent += `- [${file.path.split('/')[1]}](${encodeURI(file.path)})${versionLabel}\n`;
        });
        indexContent += '\n';
      });
    }
  }

  if (mindmaps.length > 0) {
    indexContent += '# Mindmaps\n\n';
    indexContent += `Total: ${mindmaps.length}\n\n`;
    indexFiles.filter(f => f.path.startsWith('mind-maps/')).forEach(file => {
      indexContent += `- [${file.title}](${encodeURI(file.path)})\n`;
    });
    indexContent += '\n';
  }

  if (errors.length > 0) {
    indexContent += '# Errors\n\n';
    const errorFile = indexFiles.find(f => f.path === 'errors.md');
    if (errorFile) {
      indexContent += `- [${errorFile.title}](${encodeURI(errorFile.path)})\n\n`;
    }
  }

  files.push({ path: '_index.md', data: indexContent + timingSummary() });
  files.push({
    path: '_index.html',
    data: NLME.buildIndexHtml({
      meta,
      heading: `Notes — ${meta.notebook}`,
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
      kind: 'notes',
      part: batchIndex,
      totalParts: totalBatches,
      partial,
      files,
      counts: { notes: regularNotes.length, mindmaps: mindmaps.length },
      errorCount: errors.length
    }), null, 2)
  });

  return files;
}

// ========== SOURCES EXPORT FUNCTIONS ==========

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
    if (source) await runExclusive('Sources export', () => exportSources([source]));
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
async function exportSources(selectedSources) {
  startExportTiming();
  console.log(`[NotebookLM Takeout] Exporting ${selectedSources.length} sources...`);

  await withExportShell({ label: 'sources', healthType: 'sources', overlayMessage: 'Preparing to export sources...' }, async shell => {
    const { result, zips, auditOk } = await runSourcesJob(shell, selectedSources);

    shell.finish({
      kind: 'sources',
      selected: selectedSources.length,
      result,
      auditOk,
      saved: zips,
      retry: retryFor(result.failedItems, 'Sources export', failed => exportSources(failed))
    });
  });
}

/**
 * Run the sources job (extract, batch, package) inside an export shell.
 *
 * @param {object} shell withExportShell's shell
 * @param {object[]} selectedSources sources as SCAN_SOURCES returns them
 * @param {CategoryTarget} [target]
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean }>}
 */
async function runSourcesJob(shell, selectedSources, { pathPrefix = '', zipKind = 'sources', folder = null } = {}) {
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
  const zips = [];
  const written = { count: 0, multi: false }; // batches saved: part-N/ folders for the takeout root index

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
    extractOne: (source, ctx) => extractSourceItem(shell, source, ctx, state),
    // Close the source viewer once per source, whether extraction worked or not
    afterEach: async () => {
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
        partial: info.partial
      });
      await saveCategoryBatch(shell, files, info, { prefix: batchPrefix(pathPrefix, info), zipKind, folder, zips, written });
      console.log(`[NotebookLM Takeout] Downloaded sources ZIP ${info.batchIndex}/${info.totalBatches}`);

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

  return { result, zips, errors: result.errors, auditOk: NLME.auditExport(finalAudit()).ok, parts: pathPrefix && written.multi ? written.count : 0 };
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
 * @returns {Promise<object>} SourceData: { title, youtubeUrl, summary,
 *   keyTopics, hasImages, imagesFound, imagesEmbedded,
 *   versions: { base, plusMeta, withImages, plusMetaWithImages } }
 *   (plusMeta null when no metadata version is enabled; image versions null
 *   when the source has no images or none are enabled)
 */
async function extractSourceItem(shell, source, ctx, state) {
  // Wait for and write the AI summary/guide only when a metadata version is
  // exported (avoids false "missing summary" errors when those are off)
  const needsMeta = !!(settings.exportSourcePlusMeta || settings.exportSourcePlusMetaWithImages);
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
      const data = await buildSourceData(source, sourceData, ctx, state.audit, needsMeta);
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
async function buildSourceData(source, sourceData, ctx, audit, needsMeta) {
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
  if (settings.exportSourceWithImages || settings.exportSourcePlusMetaWithImages) {
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
 *   batchIndex?: number, totalBatches?: number, partial?: boolean }} options
 *   errors: ALL errors of the run, passed only to the last ZIP it writes
 * @returns {Array<{path: string, data: string, title?: string, variant?: string, itemKind?: string}>}
 */
function buildSourcesFiles(sources, { meta, errors = [], auditText = null, batchIndex = 1, totalBatches = 1, partial = false }) {
  const files = [];
  const indexEntries = [];

  // Every variant of one source shares one stem, and no stem may equal
  // another source's stem+variant name ('Report' vs 'Report plus meta')
  const zipSuffixes = NLME.sourceVariants(settings, { hasImages: sources.some(s => s.hasImages) })
    .map(v => v.suffix).filter(Boolean);
  const stems = NLME.uniqueStems(sources.map(s => s.title), zipSuffixes);

  sources.forEach((source, idx) => {
    const written = [];
    // Versions for this source (NLME.sourceVariants); image versions exist
    // only when the source has images
    for (const { suffix } of NLME.sourceVariants(settings, { hasImages: !!source.hasImages })) {
      const info = SOURCE_VERSION_INFO[suffix];
      const markdown = source.versions[info.key];
      if (markdown == null) continue;
      const variant = variantName(suffix);
      const filename = `${stems[idx]}${suffix}.md`;
      files.push({
        path: `sources/${filename}`,
        data: sourceFrontMatter(meta, { title: source.title, variant, youtubeUrl: source.youtubeUrl }) + markdown,
        title: source.title,
        variant,
        itemKind: 'source'
      });
      written.push({ label: `${filename} - ${info.label}`, path: `sources/${filename}` });
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
    files.push({ path: 'sources/youtube-urls.txt', data: youtubeContent, title: 'YouTube Source URLs (formatted)' });
    files.push({
      path: 'sources/youtube-urls.raw.txt',
      data: youtubeUrls.map(item => item.url).join('\n') + '\n',
      title: 'YouTube Source URLs (raw list)'
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
        errors
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
    indexContent += '- [YouTube URLs (formatted)](sources/youtube-urls.txt) - Numbered list with titles\n';
    indexContent += '- [YouTube URLs (raw)](sources/youtube-urls.raw.txt) - Plain URLs only (for scripting)\n\n';
    indexContent += '---\n\n';
  }

  if (sources.length > 0) {
    indexContent += '## Sources\n\n';
    indexContent += NLME.buildSourcesIndex(indexEntries);
    indexContent += '\n---\n\n';

    indexContent += '## File Naming Convention\n\n';
    indexContent += `Each source is exported in ${variantsWritten.length} version(s), all in the \`sources/\` folder:\n\n`;
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

// ========== CHAT EXPORT FUNCTIONS ==========

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
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean }>}
 */
async function runChatJob(shell, chatData, { citationMode = 'quotes', forceZip = false, pathPrefix = '', zipKind = 'chat', folder = null } = {}) {
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
  const zips = [];

  console.log('[NotebookLM Takeout] Processing messages and extracting citations...');
  const result = await NLME.runExportJob({
    kind: 'messages',
    items: messagePairs,
    perZip: Infinity,
    seedErrors,
    extractOne: (pair, ctx) => extractChatPair(shell, pair, ctx, { citationMode, total: messagePairs.length }),
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
        citationMode
      });
      if (single) {
        // Today's download name for the single file
        await saveFiles([{ ...single, path: `${sanitizeFilename(shell.projectName)}-chat-${shell.timestamp}.md` }]);
      } else {
        // One package: totalBatches is 1, so no -partNofM
        await saveCategoryBatch(shell, files, info, { prefix: pathPrefix, zipKind, folder, zips });
      }
    },
    isCancelled: shell.isCancelled,
    onProgress: ({ done, total }) => {
      shell.progress(`Processing message ${done + 1}/${total}`, (done + 1) / total);
      console.log(`[NotebookLM Takeout] Message ${done + 1}: Processing...`);
    }
  });

  return { result, zips, errors: result.errors, auditOk: auditDoc ? auditDoc.ok : true };
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
 * @param {{ citationMode?: 'quotes'|'titles'|'none', total: number }} options
 *   total: message pairs in the job (progress text)
 * @returns {Promise<object>} ProcessedMessage: { date, userMessage,
 *   aiResponseHTML, sources: [{ sourceIndex, text, quote }], fullCitations,
 *   stats: { hasCitations, citationsFound, successfulExtractions, failedExtractions } }
 */
async function extractChatPair(shell, pair, ctx, { citationMode = 'quotes', total }) {
  const n = ctx.index + 1;
  const stats = { hasCitations: false, citationsFound: 0, successfulExtractions: 0, failedExtractions: 0 };
  const message = sources => ({
    date: pair.date,
    userMessage: pair.userMessage,
    aiResponseHTML: pair.aiResponseHTML,
    sources,
    fullCitations: citationMode === 'quotes',
    stats
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

        // Call content script to extract citations by temporarily inserting HTML
        exportTimer?.start('chat.citations');
        const fullCitationData = await chrome.tabs.sendMessage(shell.tab.id, {
          type: 'EXTRACT_MESSAGE_CITATIONS',
          data: {
            messageIndex: pair.domIndex ?? ctx.index,
            messageHTML: pair.aiResponseHTML,
            sourceIndices: sourceIndices,
            includeCitationImages: !!settings.exportNoteWithImages
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
  if (citationMode !== 'none') {
    chatData.messagePairs.forEach((pair, i) => {
      addCitationCoverage(audit, pair.aiResponseHTML, messages[i] ? messages[i].sources : [], citationMode === 'quotes');
    });
  }
  const chatHtml = chatData.messagePairs.map(p => p.aiResponseHTML || '').join('\n');
  convertCounted(audit, chatHtml, () => convertChatToMarkdown(
    chatData.notebookTitle, chatData.notebookSummary, messages, false, citationMode === 'none'));
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
 *   citationMode?: 'quotes'|'titles'|'none' }} options
 *   forceZip: always return ZIP files (Full Takeout)
 *   citationMode: 'none' writes no [n] markers and no Sources section (and,
 *   with no quotes, no code-blocks version)
 * @returns {{ files: Array<{path: string, data: string, title?: string, variant?: string, itemKind?: string}>,
 *   single: object|null }} single is also files[0] when set
 */
function buildChatFiles(messages, { meta, chatData, errors = [], auditDoc, partial = false, forceZip = false, citationMode = 'quotes' }) {
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
    const toMarkdown = codeBlocks => convertChatToMarkdown(chatData.notebookTitle, chatData.notebookSummary, messages, codeBlocks, citationMode === 'none');
    const baseMarkdown = toMarkdown(false);
    const hasQuotes = messages.some(m => (m.sources || []).some(src => src.quote && src.quote.trim()));
    const hasImages = /!\[/.test(baseMarkdown);
    for (const v of NLME.noteVariants(settings, { hasQuotes, hasImages })) {
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
  const totalMessages = chatData.messagePairs.length;

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
 */
function convertChatToMarkdown(notebookTitle, notebookSummary, messages, citationsCodeBlock = true, dropCitations = false) {
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
      msg.sources.forEach(source => {
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

function getIconForType(type) {
  const icons = {
    'Audio Overview': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#1a73e8">
      <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
    </svg>`,
    'Slides': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#34a853">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
    </svg>`,
    'Infographic': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fbbc04">
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
    </svg>`,
    'Report': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#ea4335">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
    </svg>`,
    'Data Table': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#34a853">
      <path d="M3 3h18v18H3V3zm16 16V5H5v14h14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
    </svg>`,
    'Video Overview': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#1a73e8">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
    </svg>`,
    'Mind Map': `<svg width="20" height="20" viewBox="0 0 24 24" fill="#ea4335">
      <path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7z"/>
    </svg>`
  };

  return icons[type] || `<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368">
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
  </svg>`;
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

// ==================== STUDIO TAB ====================

let _studioItems = [];
let _studioTabId = null;
// The Studio tab's list controller (sidebar-list.js); replaced on every redraw
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
  resultsEl.innerHTML = '<p class="scanning">Scanning studio items...</p>';
  countBadge.textContent = '0';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isNotebookUrl(tab?.url)) {
      resultsEl.innerHTML = '<p class="empty-message">Please open NotebookLM first.</p>';
      return;
    }

    await ensureContentScriptLoaded(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_STUDIO_ITEMS' });
    const items = response?.items || [];

    _studioItems = items;
    _studioTabId = tab.id;

    renderStudioList(items);
  } catch (error) {
    console.error('[NotebookLM Takeout] Studio scan failed:', error);
    resultsEl.innerHTML = `<p class="error-message">Studio scan failed: ${escapeHtml(error.message || String(error))}</p>`;
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
    resultsEl.innerHTML = '<p class="empty-message">No studio items found. Generate content in NotebookLM first.</p>';
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
      runExclusive('Studio download', () => handleStudioDownloadRow(idx, downloadBtn));
      return;
    }
    const deleteBtn = e.target.closest('.studio-delete-btn');
    if (deleteBtn) {
      handleStudioDeleteRow(parseInt(deleteBtn.dataset.idx, 10), deleteBtn);
    }
  });
}

// The bulk buttons follow the selection: disabled at 0, otherwise "... Selected (K)"
function updateStudioBulkButtonsState(controller = _studioListController) {
  const n = controller ? controller.selectedCount() : 0;
  const downloadBulkBtn = document.getElementById('studio-download-selected-btn');
  const deleteBulkBtn = document.getElementById('studio-delete-selected-btn');
  if (downloadBulkBtn) {
    downloadBulkBtn.disabled = n === 0;
    setButtonLabel(downloadBulkBtn, n > 0 ? `Download Selected (${n})` : 'Download Selected');
  }
  if (deleteBulkBtn) {
    deleteBulkBtn.disabled = n === 0;
    setButtonLabel(deleteBulkBtn, n > 0 ? `Delete Selected (${n})` : 'Delete Selected');
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
    } else {
      // kind === 'note' — regular note or mindmap
      await exportSingleNote({ index: item.kindIndex, title: item.label, type: item.type });
    }
    setStudioRowStatus(btn, 'success');
  } catch (error) {
    console.error('[NotebookLM Takeout] Studio download failed:', error);
    showToast(`✗ Failed to download ${item.label}: ${error.message || error}`, 'error');
    setStudioRowStatus(btn, 'error');
    throw error;
  }
}

async function handleStudioDeleteRow(idx, btn) {
  const item = _studioItems[idx];
  if (!item) return;

  if (!confirm(`Delete "${item.label}"? This cannot be undone.`)) return;

  if (btn) btn.disabled = true;
  try {
    await chrome.tabs.sendMessage(_studioTabId, {
      type: 'DELETE_STUDIO_ITEM',
      data: { label: item.label, combinedIndex: item.combinedIndex }
    }).then(response => {
      if (!response || !response.success) {
        throw new Error(response?.error || 'Delete failed');
      }
    });
    showToast(`Deleted "${item.label}"`, 'success');
    // Refresh the list so indices are re-aligned with the DOM.
    await scanStudioPage();
  } catch (error) {
    console.error('[NotebookLM Takeout] Studio delete failed:', error);
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

  showToast(`Downloaded ${okCount}/${selectedIdxs.length} studio item(s)`, okCount === selectedIdxs.length ? 'success' : 'warning');
  updateStudioBulkButtonsState();
}

async function handleStudioBulkDelete() {
  // Only what is selected (and so visible) is deleted; the dialog names that count
  const selectedLabels = (_studioListController ? _studioListController.selectedItems() : [])
    .map(item => item.label);
  if (selectedLabels.length === 0) return;

  if (!confirm(`Delete ${selectedLabels.length} item(s)? This cannot be undone.`)) return;

  const bulkBtn = document.getElementById('studio-delete-selected-btn');
  if (bulkBtn) bulkBtn.disabled = true;

  let okCount = 0;
  // Resolve by label each iteration to survive index shifts as rows disappear.
  for (let i = 0; i < selectedLabels.length; i++) {
    const label = selectedLabels[i];
    try {
      const response = await chrome.tabs.sendMessage(_studioTabId, {
        type: 'DELETE_STUDIO_ITEM',
        data: { label }
      });
      if (response && response.success) {
        okCount++;
      } else {
        console.warn('[NotebookLM Takeout] Bulk delete skipped:', label, response?.error);
      }
    } catch (e) {
      console.warn('[NotebookLM Takeout] Bulk delete error:', label, e);
    }
    // Let NotebookLM's undo toast dismiss and the list re-render before the next
    // label lookup. Skip the delay on the last iteration.
    if (i < selectedLabels.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  showToast(`Deleted ${okCount}/${selectedLabels.length} studio item(s)`, okCount === selectedLabels.length ? 'success' : 'warning');
  await scanStudioPage();
}


// Download All (Milestone 3a): every artifact on the job runner. ZIP on: one
// <Notebook>-artifacts-<ts>.zip; ZIP off: Downloads/<Notebook>/, one item
// per call. Either way: <type folder>/<stem>.<ext>, _index.md, errors.md,
// manifest.json.
async function downloadAllArtifacts(tabId, items) {
  await preflightWarn(tabId, 'artifacts');
  const zipEnabled = document.getElementById('zip-checkbox')?.checked || false;
  const downloadBtn = document.getElementById('download-all-btn');
  if (downloadBtn) downloadBtn.disabled = true;
  startExportTiming();

  try {
    await withExportShell({ label: 'artifacts', overlayMessage: 'Preparing to download artifacts...' }, async shell => {
      const folder = zipEnabled ? null : (shell.projectName || 'NotebookLM');
      const { result, zips, savedOutside } = await runArtifactsJob(shell, items, { folder });

      shell.finish({
        kind: 'artifacts',
        selected: items.length,
        result,
        errorNote: savedOutside > 0 ? `${savedOutside} saved separately to Downloads, see errors.md` : undefined,
        // ZIP mode: the ZIP names; folder mode: the folder, once it holds a file
        saved: folder ? (result.exported > 0 || result.errors.length > 0 ? [folder] : []) : zips,
        retry: retryFor(result.failedItems, 'Download All', failed => downloadAllArtifacts(shell.tab.id, failed))
      });
    });
  } finally {
    updateArtifactsDownloadBtn(); // enabled again only if something is still selected
  }
}

/**
 * Run the artifacts job inside an export shell. ZIP mode (no target.folder):
 * every file is fetched and packed into one ZIP with the root files. Folder
 * mode: each item is saved into the folder as it is fetched (CDN media
 * straight to disk), the root files after the last one.
 *
 * @param {object} shell withExportShell's shell
 * @param {Array<{ index, label, type }>} items downloadable artifacts (scanArtifactsData)
 * @param {CategoryTarget & { bothSlideFormats?: boolean }} [target]
 *   bothSlideFormats: save every Slides artifact as PDF and PowerPoint
 *   (Full Takeout); otherwise the ⚙️ slides format alone
 * @returns {Promise<{ result: object, zips: string[], errors: Array, auditOk: boolean, savedOutside: number }>}
 *   savedOutside: items Chrome saved itself (no capturable URL)
 */
async function runArtifactsJob(shell, items, { pathPrefix = '', zipKind = 'artifacts', folder = null, bothSlideFormats = false } = {}) {
  const zipMode = !folder;
  const place = files => (pathPrefix ? files.map(f => ({ ...f, path: pathPrefix + f.path })) : files);
  const stems = NLME.artifactStems(items);
  const stemOf = new Map(items.map((item, idx) => [item, stems[idx]]));
  // Folder mode: what earlier items saved, for _index.md and manifest.json
  // (Blobs replaced by their size: the manifest needs no more)
  const saved = [];
  const zips = [];
  let savedOutside = 0;

  const result = await NLME.runExportJob({
    kind: 'artifacts',
    items,
    perZip: zipMode ? Infinity : 1,
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
        saved.push({ item, files: files.map(f => (f.data instanceof Blob ? { ...f, data: { byteLength: f.data.size } } : f)) });
      }
      return { item, files };
    },
    // Pause between items so Gemini Notebook is not hammered
    afterEach: async item => {
      if (item !== items[items.length - 1]) await new Promise(resolve => setTimeout(resolve, 800));
    },
    packageBatch: async (results, info) => {
      if (zipMode) {
        const files = results.flatMap(r => r.files);
        shell.progress('Creating ZIP...', 1);
        files.push(...artifactsRootFiles(files, results.map(r => r.item), { meta: shell.meta, info }));
        const zipName = NLME.zipName({ notebook: shell.projectName, kind: zipKind, timestamp: shell.timestamp, partial: info.partial });
        await saveFiles(place(files), { zipName });
        zips.push(zipName);
        return;
      }
      // Folder mode (one item per call): the item is already saved; the
      // last call adds the root files
      if (info.isLast) {
        const all = saved.flatMap(r => r.files);
        await saveFiles(place(artifactsRootFiles(all, saved.map(r => r.item), { meta: shell.meta, info })), { folder });
      }
    },
    isCancelled: shell.isCancelled,
    onProgress: ({ done, total, item }) => {
      shell.progress(`Downloading ${done + 1}/${total}: ${item.label}`, (done + 1) / total);
    }
  });

  return { result, zips, errors: result.errors, auditOk: true, savedOutside };
}

/**
 * The root files of an artifacts export: errors.md (when there are errors),
 * _index.md (by type folder) and manifest.json (last; lists every file).
 *
 * @param {object[]} files every artifact file in the export (type-folder paths)
 * @param {object[]} exportedItems the items those files came from
 * @param {{ meta: object, info: { errors: Array, partial: boolean } }} options
 */
function artifactsRootFiles(files, exportedItems, { meta, info }) {
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

  let index = `# Artifacts — ${meta.notebook}\n\n`;
  index += `Generated: ${new Date().toLocaleString()}\n\n`;
  index += `Total Artifacts: ${exportedItems.length}\n\n`;
  index += '---\n\n';
  for (const [typeFolder, { type, labels }] of folders) {
    index += `## ${type} (${typeFolder}/)\n\n`;
    for (const label of new Set(labels)) {
      const own = files.filter(f => f.title === label && f.path.startsWith(`${typeFolder}/`));
      index += `### ${label}\n\n`;
      index += own.length
        ? own.map(f => `- [${f.path.slice(typeFolder.length + 1)}](${encodeURI(f.path)})`).join('\n') + '\n\n'
        : '- Saved separately to Downloads (see errors.md)\n\n';
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
      partial: info.partial,
      files: [...files, ...root],
      counts,
      errorCount: errors.length
    }), null, 2)
  });
  return root;
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  // Auto-hide after delay (longer for errors/warnings)
  const duration = type === 'error' || type === 'warning' ? 4000 : 2000;

  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ==================== DOM HEALTH CHECK ====================

// Store last health check results for report generation
let lastHealthCheckResults = null;

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

function escapeHtml(text) {
  return NLME.escapeHtml(text);
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});
