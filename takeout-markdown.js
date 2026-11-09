// NotebookLM Takeout - shared Markdown conversion (Milestone 3d)
// Classic script loaded in the side panel (after takeout-shared.js) and as a
// content script (after takeout-shared.js, before content.js). Exposes
// globalThis.NLMEMarkdown:
//   createTurndownService(options)   the one Turndown configuration
//   convertKatexNodeToLatex(node)    KaTeX DOM → $…$ / $$…$$
//   createConverter(options)         notes / chat Turndown rule set (side panel)
//   formulasWritten()                formulas createConverter's converters wrote
//   htmlToMarkdownPlain(element)     the page script's converter (quotes,
//                                    source guides, notebook summary)
// Turndown itself (turndown.min.js) is only needed by createTurndownService /
// createConverter, which only the side panel calls.
(function (root) {
  'use strict';

  // A line of only dashes, em dashes, underscores or equals signs, alone
  // between blank lines, is a divider the page drew (1.9.9), whatever element
  // held it. Turndown wrote it as an escaped "\\-----" line; it becomes a
  // rule. Blank lines around it keep it from reading as a setext heading
  // underline. Fenced code, table rows and runs touching text are left alone.
  const DIVIDER_LINE = /^(?:(?:\\?-){3,}|(?:\\?—){3,}|(?:\\?_){3,}|(?:\\?=){3,})$/;
  function dividerLines(text) {
    const lines = String(text).split('\n');
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (fence) {
        if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
        continue;
      }
      if (open) { fence = open[1]; continue; }
      if (DIVIDER_LINE.test(lines[i]) &&
          (i === 0 || lines[i - 1] === '') && (i === lines.length - 1 || lines[i + 1] === '')) {
        lines[i] = '---';
      }
    }
    return lines.join('\n');
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

    const service = new TurndownService({ ...defaultOptions, ...customOptions });
    const escape = service.escape;
    // "1790) to Baudouin" at a line start would read as an ordered list (as
    // "1790." does, which Turndown escapes already)
    service.escape = text => NLME.relaxBracketEscapes(
      escape.call(service, text).replace(/^(\d+)\)(?=\s)/gm, '$1\\)'));
    return service;
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
  // Used by the shared Turndown rule set (createConverter: notes, sources,
  // reports, chat) and by htmlToMarkdownPlain (quotes, guides, summary).


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

  // Formulas every converter has written so far (NLME.markWrittenFormula).
  // The audit reads it before and after a conversion (convertCounted).
  let formulasWrittenTotal = 0;

  // A source import card's text, one line per block (DIV, P, H1-H6, LI);
  // icons and images (the remote favicons) left out
  const IMPORT_CARD_BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION']);
  function importCardLines(card) {
    const clone = card.cloneNode(true);
    clone.querySelectorAll('mat-icon, img').forEach(node => node.remove());
    const lines = [];
    let line = '';
    const flush = () => { if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim()); line = ''; };
    const walk = node => {
      for (const child of Array.from(node.childNodes || [])) {
        if (child.nodeType === 3) { line += child.textContent; continue; }
        if (child.nodeType !== 1) continue;
        const block = IMPORT_CARD_BLOCKS.has(child.nodeName.toUpperCase());
        if (block) flush();
        walk(child);
        if (block) flush();
      }
    };
    walk(clone);
    flush();
    return lines;
  }

  // ==================== ONE TURNDOWN RULE SET ====================
  // The notes/sources/reports rule set and the chat rule set were two copies
  // (Milestone 3d merges them). Options:
  //   variant 'note' (default) | 'chat'
  //     note: markers become anchorPrefix + cite-ref-N-k → anchorPrefix + src-N;
  //           any numbered marker form is recognised (button.citation-marker,
  //           a[href^="#cite"], <source-link>, [data-source-index]);
  //           <source-link> elsewhere keeps a link to #src-N
  //     chat: only button.citation-marker; anchors are per message
  //           (msg-I-cite-ref-N-k → msg-I-src-N, I from getMessageIndex());
  //           a table is followed by the "[n] …" reference lines found in
  //           its element-list-renderer
  //   citations 'links' (default) | 'code-blocks' | 'footnotes' | 'none'
  //     'none' drops every marker (and chat's table references). Links and
  //     code blocks differ only in the Sources section, which the caller writes.
  //     'footnotes' writes the marker as [^LABEL] (no <sup>, no anchors); the
  //     caller writes the matching [^LABEL]: definitions (NLME.footnoteDefinitions)
  //   footnoteLabel(number) -> LABEL, for 'footnotes' (default: the number).
  //     The caller owns uniqueness: a combined notes file passes a closure over
  //     NLME.footnoteLabel(noteIndex, n, { combined: true }); chat does the same
  //     with the current message index, so every label is unique in chat.md.
  //   anchorPrefix (note), getMessageIndex (chat), log(context, message)
  //   getThoughts (chat): the current answer's thoughts, [{ title, body }],
  //     written where its Thoughts placeholder is (NLME.thoughtsMarkdown)
  // Returns { turndownService, convert(html), citedNumbers(messageIndex?) } —
  // callers use convert() (turndownService.turndown() leaves formula marks in);
  // citedNumbers: the distinct marker numbers converted so far (note variant),
  // in order; for the chat variant, those cited in the given message.
  // Turndown gives later-added rules priority; the order below is the notes
  // order. Only rules with overlapping filters depend on it (reportHeadings vs
  // blockquotes, sourceLink vs citationButtons), and both sets ordered those
  // the same way.
  function createConverter({ variant = 'note', citations = 'links', anchorPrefix = '', getMessageIndex = () => 0, getThoughts = () => [], footnoteLabel = null, log = null } = {}) {
    const isChat = variant === 'chat';
    const dropCitations = citations === 'none';
    const footnotes = citations === 'footnotes';
    // Our own footnote markers carry private-use sentinels until convert() has
    // post-processed the output, so the joining and escaping below can never
    // touch text that merely looks like a marker (code spans, fenced code)
    const footnoteMarker = label => `\uE000[^${label}]\uE001`;
    const labelOf = typeof footnoteLabel === 'function' ? footnoteLabel : (n => String(n));
    const info = typeof log === 'function' ? log : () => {};
    const turndownService = createTurndownService();
    // Note: number -> occurrences; chat: "messageIdx:number" -> occurrences
    const citationOccurrences = new Map();

    // Report headings (role="heading" with aria-level)
    turndownService.addRule('reportHeadings', {
      filter: (node) => {
        return node.nodeName === 'DIV' &&
               node.getAttribute('role') === 'heading' &&
               node.hasAttribute('aria-level');
      },
      replacement: (content, node) => {
        const level = parseInt(node.getAttribute('aria-level')) || 1;
        const prefix = '#'.repeat(level);
        return `\n${prefix} ${NLME.plainHeading(content.trim())}\n\n`;
      }
    });

    // Headings carry no bold markers (1.9.9): "## **1 Introduction**" is "## 1 Introduction"
    turndownService.addRule('plainHeadings', {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      replacement: (content, node) => {
        const level = Number(node.nodeName.charAt(1));
        return `\n\n${'#'.repeat(level)} ${NLME.plainHeading(content)}\n\n`;
      }
    });

    // Google redirect links (1.9.9) are written as their real address. Same
    // output as Turndown's inline link, for links that were redirects only.
    turndownService.addRule('googleRedirectLinks', {
      filter: (node) => {
        if (node.nodeName !== 'A') return false;
        const href = node.getAttribute('href');
        return !!href && NLME.unwrapGoogleRedirect(href) !== href;
      },
      replacement: (content, node) => {
        const href = NLME.unwrapGoogleRedirect(node.getAttribute('href')).replace(/([()])/g, '\\$1');
        const title = (node.getAttribute('title') || '').replace(/(\n+\s*)+/g, '\n');
        const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
        return `[${content}](${href}${titlePart})`;
      }
    });

    // Blockquotes (callout boxes)
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

    // <source-link> elements (notes only; in notes the citationButtons rule,
    // added later, takes them first, as it always did)
    if (!isChat) {
      turndownService.addRule('sourceLink', {
        filter: 'source-link',
        replacement: (content, node) => {
          const sourceIndex = node.dataset.sourceIndex;
          const linkText = node.textContent;
          const anchor = `src-${sourceIndex}`;
          return `[${linkText}](#${anchor})`;
        }
      });
    }

    // Strip Angular component wrappers (inner content only). Chat used only
    // the first name; the other two are never in chat answers, and Turndown
    // already keeps a non-block unknown element's content, so this is the same
    // output either way.
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

    // A source import card in a chat answer (1.9.6): one line of text in its
    // place (NLME.importCardMarkdown), never its remote favicons
    if (isChat) {
      turndownService.addRule('importCard', {
        filter: (node) => node.nodeName === 'A2UI-SOURCE-IMPORT-CARD',
        replacement: (_content, node) => {
          const line = NLME.importCardMarkdown(NLME.importCardFromLines(importCardLines(node)));
          return line ? `\n\n${line}\n\n` : '';
        }
      });
    }

    // A chat answer's Thoughts (1.9.6): content.js leaves
    // NLME.THOUGHTS_PLACEHOLDER_HTML where the page's thinking-chain-view
    // was; the section goes there. Thoughts that could not be read write
    // nothing, not the stray word.
    if (isChat) {
      turndownService.addRule('chatThoughts', {
        filter: (node) => node.nodeName === 'DIV' && node.hasAttribute('data-nlme-thoughts'),
        replacement: () => {
          const section = NLME.thoughtsMarkdown(getThoughts());
          return section ? `\n\n${section}\n\n` : '';
        }
      });
    }

    // Lists whose <li> elements sit inside Angular wrapper components
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
          markdown += NLME.listItemMarkdown(marker, itemContent);
        });
        markdown += '\n';

        return markdown;
      }
    });

    // Tables (Markdown table format)
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

        if (!isChat) return markdown;

        // Chat: capture footnotes that follow the table. Look for sibling
        // elements after the table that contain footnote references
        let currentElement = node.parentElement;
        while (currentElement && currentElement.nodeName.toLowerCase() !== 'element-list-renderer') {
          currentElement = currentElement.parentElement;
        }

        if (currentElement) {
          // Find all structural elements that might contain footnotes
          const structuralElements = currentElement.querySelectorAll('labs-tailwind-structural-element-view-v2');
          const refLines = [];

          // Look for elements with footnote pattern [number] at start
          structuralElements.forEach(el => {
            const text = el.textContent.trim();
            // Match footnotes like "[1] Some text" or "[86] Some text"
            if (/^\[\d+\]/.test(text)) {
              refLines.push(text);
            }
          });

          // Add footnotes if found
          if (refLines.length > 0 && !dropCitations) {
            markdown += '\n**References:**\n\n';
            refLines.forEach(refLine => {
              markdown += refLine + '\n\n';
            });
          }
        }

        return markdown;
      }
    });

    // Strip mat-icon elements (Google Material icons that shouldn't appear in markdown)
    turndownService.addRule('matIcons', {
      filter: (node) => node.nodeName === 'MAT-ICON',
      replacement: () => '' // Strip entirely
    });

    // KaTeX math notation (see convertKatexNodeToLatex)
    turndownService.addRule('katexMath', {
      filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('katex'),
      // Marked for the audit's count; convert() takes the mark out again
      replacement: (_content, node) => {
        const tex = node.closest('[data-math]')?.getAttribute('data-math');
        // Prose the page drew as math: plain text, escaped, not a formula
        if (NLME.isProseMath(tex)) return turndownService.escape(tex.replace(/\s+/g, ' ').trim());
        return NLME.markWrittenFormula(convertKatexNodeToLatex(node), tex);
      }
    });

    // Citation markers
    turndownService.addRule('citationButtons', isChat ? {
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
        const messageIndex = getMessageIndex();
        const key = `${messageIndex}:${sourceIndex}`;

        // Track occurrences for this source within this message
        if (!citationOccurrences.has(key)) {
          citationOccurrences.set(key, 0);
        }
        const occurrenceCount = citationOccurrences.get(key) + 1;
        citationOccurrences.set(key, occurrenceCount);

        if (footnotes) return footnoteMarker(labelOf(sourceIndex));

        // Return citation with message-specific anchor and link to source
        return `<sup><a id="msg-${messageIndex}-cite-ref-${sourceIndex}-${occurrenceCount}" href="#msg-${messageIndex}-src-${sourceIndex}">[${sourceIndex}]</a></sup>`;
      }
    } : {
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
        info('Citation', `Processing citation node: ${node.nodeName}`);
        info('Citation', `  - content: "${content}"`);
        info('Citation', `  - data-source-index: ${node.getAttribute('data-source-index')}`);
        info('Citation', `  - href: ${node.getAttribute('href')}`);
        info('Citation', `  - outerHTML preview: ${node.outerHTML?.substring(0, 200)}`);

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
          info('Citation', `  - using content as originalSourceIndex: "${originalSourceIndex}"`);
        }

        info('Citation', `  - original sourceIndex: "${originalSourceIndex}"`);

        // Original citation numbers everywhere so body links and the Sources
        // section always agree (buildCitationEntries)
        const displayNumber = originalSourceIndex;

        if (!citationOccurrences.has(displayNumber)) {
          citationOccurrences.set(displayNumber, 0);
        }
        const occurrenceCount = citationOccurrences.get(displayNumber) + 1;
        citationOccurrences.set(displayNumber, occurrenceCount);

        if (footnotes) {
          const marker = footnoteMarker(labelOf(displayNumber));
          info('Citation', `  - generated: ${marker}`);
          return marker;
        }

        const output = `<sup><a id="${anchorPrefix}cite-ref-${displayNumber}-${occurrenceCount}" href="#${anchorPrefix}src-${displayNumber}">[${displayNumber}]</a></sup>`;
        info('Citation', `  - generated: ${output}`);

        return output;
      }
    });

    // Footnote mode, after Turndown: markers that follow each other (with
    // the commas the page puts between them) are joined by one space, as the
    // <sup> markers are; a body line that starts with a marker and a colon
    // would read as a footnote definition, so its colon is escaped; then the
    // sentinels go. Only sentinel-wrapped markers are touched.
    const finishFootnotes = footnotes
      ? (text => text
        .replace(/(\uE000\[\^[^\]\s]+\]\uE001)\s*,?\s*(?=\uE000)/g, '$1 ')
        .replace(/^\uE000(\[\^[^\]\s]+\])\uE001:/gm, '$1\\:')
        .replace(/[\uE000\uE001]/g, ''))
      : (text => text);

    return {
      turndownService,
      convert: (html) => {
        const { text, formulas } = NLME.takeFormulaMarks(turndownService.turndown(html));
        formulasWrittenTotal += formulas;
        return finishFootnotes(dividerLines(text));
      },
      citedNumbers: (messageIndex) => {
        if (isChat && messageIndex !== undefined) {
          const prefix = `${messageIndex}:`;
          return [...citationOccurrences.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
        }
        return [...citationOccurrences.keys()];
      }
    };
  }

  // ==================== PAGE SCRIPT CONVERTER ====================
  // The page script's converter (moved from content.js, Milestone 3d): citation
  // quotes, source guides and the notebook summary. It is kept apart from the
  // Turndown rule set on purpose: Turndown escapes Markdown characters,
  // writes _emphasis_ and collapses whitespace, so switching would change
  // nearly every citation quote (and every cached quote). Additions here:
  // KaTeX → LaTeX (it used to emit the formula's text twice) and <ol start>.
  function htmlToMarkdownPlain(element) {
    if (!element) return '';

    let markdown = '';

    // Helper function to process table cells with proper escaping
    const processTableCell = (cell, context) => {
      let text = processNode(cell, context).trim();

      // Escape pipe characters (Markdown table delimiter)
      text = text.replace(/\|/g, '\\|');

      // Replace newlines with spaces (tables must be single-line)
      text = text.replace(/\n+/g, ' ');

      // Warn about colspan/rowspan if present (cannot be represented in Markdown)
      const colspan = parseInt(cell.getAttribute('colspan') || '1');
      const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
      if (colspan > 1 || rowspan > 1) {
        console.warn('[NotebookLM Takeout] Table cell spans multiple columns/rows - this cannot be represented in Markdown');
      }

      return text;
    };

    // Helper function to process table elements
    const processTable = (tableNode, context) => {
      const rows = [];
      let isFirstRowHeader = false;

      // Find all rows (in thead and tbody, or directly in table)
      const thead = tableNode.querySelector('thead');
      const tbody = tableNode.querySelector('tbody');

      if (thead) {
        const headerRows = thead.querySelectorAll('tr');
        headerRows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll('th, td'));
          const cellContents = cells.map(cell => processTableCell(cell, context));
          rows.push(cellContents);
          if (idx === 0) isFirstRowHeader = true;
        });
      }

      if (tbody) {
        const bodyRows = tbody.querySelectorAll('tr');
        bodyRows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td, th'));
          const cellContents = cells.map(cell => processTableCell(cell, context));
          rows.push(cellContents);
        });
      }

      // If no thead/tbody, get rows directly from table
      if (!thead && !tbody) {
        const allRows = tableNode.querySelectorAll('tr');
        allRows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll('th, td'));
          const cellContents = cells.map(cell => processTableCell(cell, context));

          // Check if first row has <th> elements
          if (idx === 0 && tr.querySelector('th')) {
            isFirstRowHeader = true;
          }

          rows.push(cellContents);
        });
      }

      if (rows.length === 0) return '';

      // Determine number of columns
      const numCols = Math.max(...rows.map(row => row.length));

      // Build markdown table
      let tableMarkdown = '\n';

      rows.forEach((row, rowIdx) => {
        // Pad row to match column count
        while (row.length < numCols) {
          row.push('');
        }

        // Add row
        tableMarkdown += '| ' + row.join(' | ') + ' |\n';

        // Add separator after first row if it's a header
        if (rowIdx === 0 && (isFirstRowHeader || thead)) {
          tableMarkdown += '| ' + Array(numCols).fill('---').join(' | ') + ' |\n';
        }
      });

      tableMarkdown += '\n';
      return tableMarkdown;
    };

    // Helper function to process list elements
    const processList = (listNode, context) => {
      const isOrdered = listNode.tagName.toLowerCase() === 'ol';
      // Find all <li> elements, but filter out those that belong to nested lists
      // (handles Angular wrapper components like <labs-tailwind-structural-element-view-v2>)
      const allLis = Array.from(listNode.querySelectorAll('li'));
      const items = allLis.filter(li => {
        // Check if this <li> has a list ancestor between it and listNode
        let parent = li.parentElement;
        while (parent && parent !== listNode) {
          if (parent.tagName && (parent.tagName.toLowerCase() === 'ul' || parent.tagName.toLowerCase() === 'ol')) {
            return false; // This <li> belongs to a nested list
          }
          parent = parent.parentElement;
        }
        return true; // This <li> belongs directly to this list
      });
      // <ol start="4"> continues a numbered list (Milestone 3d)
      const startAttr = isOrdered ? parseInt(listNode.getAttribute('start'), 10) : NaN;
      const start = Number.isFinite(startAttr) ? startAttr : 1;
      let listMarkdown = '\n';

      items.forEach((li, idx) => {
        const indent = '  '.repeat(context.listDepth);
        const marker = isOrdered ? `${start + idx}.` : '*';

        // Process the list item content
        const itemContext = { ...context, listDepth: context.listDepth + 1 };
        const itemContent = Array.from(li.childNodes)
          .map(child => processNode(child, itemContext))
          .join('')
          .trim();

        // Split multi-line content and indent continuation lines
        const lines = itemContent.split('\n');
        listMarkdown += `${indent}${marker} ${lines[0]}\n`;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim()) {
            listMarkdown += `${indent}  ${lines[i]}\n`;
          }
        }
      });

      listMarkdown += '\n';
      return listMarkdown;
    };

    // Helper function to process blockquote elements
    const processBlockquote = (blockquoteNode, context) => {
      const content = Array.from(blockquoteNode.childNodes)
        .map(child => processNode(child, context))
        .join('')
        .trim();

      // For citations, blockquotes are just semantic wrappers - extract content without markdown syntax
      // (the citation itself is already clearly a quote in the footnote)
      return '\n' + content + '\n\n';
    };

    const processNode = (node, context = { listDepth: 0 }) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }

      const tag = node.tagName.toLowerCase();

      // KaTeX math → $…$ / $$…$$ (Milestone 3d)
      if (node.classList && node.classList.contains('katex')) {
        return convertKatexNodeToLatex(node);
      }

      // Special handling for tables
      if (tag === 'table') {
        return processTable(node, context);
      }

      // Special handling for lists
      if (tag === 'ul' || tag === 'ol') {
        return processList(node, context);
      }

      // Special handling for blockquotes
      if (tag === 'blockquote') {
        return processBlockquote(node, context);
      }

      // Special handling for ARIA headings (e.g., <div role="heading" aria-level="4">)
      if (node.getAttribute('role') === 'heading') {
        const ariaLevel = parseInt(node.getAttribute('aria-level') || '1', 10);
        const level = Math.min(Math.max(ariaLevel, 1), 6); // Clamp between 1-6
        const content = Array.from(node.childNodes).map(child => processNode(child, context)).join('');
        const hashes = '#'.repeat(level);
        return `\n${hashes} ${content}\n\n`;
      }

      // For table sub-elements, process children normally
      // (they're handled by processTable when it encounters a table)
      if (['thead', 'tbody', 'tr', 'th', 'td'].includes(tag)) {
        return Array.from(node.childNodes).map(child => processNode(child, context)).join('');
      }

      // For list items within the list processor, just process children
      if (tag === 'li' && context.listDepth > 0) {
        return Array.from(node.childNodes).map(child => processNode(child, context)).join('');
      }

      const content = Array.from(node.childNodes).map(child => processNode(child, context)).join('');

      switch (tag) {
        // Headings
        case 'h1':
          return `\n# ${NLME.plainHeading(content)}\n\n`;
        case 'h2':
          return `\n## ${NLME.plainHeading(content)}\n\n`;
        case 'h3':
          return `\n### ${NLME.plainHeading(content)}\n\n`;
        case 'h4':
          return `\n#### ${NLME.plainHeading(content)}\n\n`;
        case 'h5':
          return `\n##### ${NLME.plainHeading(content)}\n\n`;
        case 'h6':
          return `\n###### ${NLME.plainHeading(content)}\n\n`;

        // Text formatting
        case 'b':
        case 'strong':
          return `**${content}**`;
        case 'i':
        case 'em':
          return `*${content}*`;
        case 's':
        case 'del':
        case 'strike':
          return `~~${content}~~`;

        // Links and images
        case 'a':
          const href = node.getAttribute('href') || '';
          return href ? `[${content}](${NLME.unwrapGoogleRedirect(href)})` : content;
        case 'img':
          const src = node.getAttribute('src') || '';
          const alt = node.getAttribute('alt') || '';
          return src ? `![${alt}](${src})` : '';

        // Code
        case 'code':
          // Check if this is inside a <pre> tag (already handled as code block)
          if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
            return content;
          }
          return `\`${content}\``;
        case 'pre':
          // Code block
          const codeElement = node.querySelector('code');
          const codeContent = codeElement ? codeElement.textContent : node.textContent;
          const language = codeElement ? (codeElement.className.match(/language-(\w+)/) || [])[1] || '' : '';
          return `\n\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;

        // Horizontal rule
        case 'hr':
          return '\n---\n\n';

        // Line breaks and blocks
        case 'br':
          return '\n';
        case 'p':
        case 'div':
          return content + '\n';
        case 'span':
          return content;

        default:
          return content;
      }
    };

    markdown = processNode(element);
    return markdown.trim();
  }

  root.NLMEMarkdown = Object.assign(root.NLMEMarkdown || {}, {
    createTurndownService,
    convertKatexNodeToLatex,
    createConverter,
    formulasWritten: () => formulasWrittenTotal,
    dividerLines,
    importCardLines,
    htmlToMarkdownPlain
  });
})(globalThis);
