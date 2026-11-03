// NotebookLM Takeout - shared Markdown conversion (Milestone 3d)
// Classic script loaded in the side panel (after takeout-shared.js) and as a
// content script (after takeout-shared.js, before content.js). Exposes
// globalThis.NLMEMarkdown:
//   createTurndownService(options)   the one Turndown configuration
//   convertKatexNodeToLatex(node)    KaTeX DOM → $…$ / $$…$$
//   createConverter(options)         notes / chat Turndown rule set (side panel)
//   htmlToMarkdownPlain(element)     the page script's converter (quotes,
//                                    source guides, notebook summary)
// Turndown itself (turndown.min.js) is only needed by createTurndownService /
// createConverter, which only the side panel calls.
(function (root) {
  'use strict';

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
  // ==================== KATEX → LATEX CONVERSION ====================
  // Handles two cases:
  //   1. KaTeX preserved the original LaTeX in an <annotation> tag (happy path).
  //   2. KaTeX rendered HTML-only (no annotation). We reconstruct LaTeX from the
  //      .katex-html tree, covering mopen/mclose/mpunct/msupsub on mord and mclose,
  //      named functions (ln/log/sin/cos/...), big operators with limits,
  //      fractions, square roots, and Unicode → LaTeX symbol mapping.
  //
  // Used by both the notes/sources Turndown service and the chat Turndown service.


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

  root.NLMEMarkdown = Object.assign(root.NLMEMarkdown || {}, {
    createTurndownService,
    convertKatexNodeToLatex
  });
})(globalThis);
