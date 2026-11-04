// NotebookLM Takeout - offline viewer page script (inlined into every viewer file).
// Pure helpers sit at the top so Node tests can load them; the page code below
// only runs where a document exists.

var DANGEROUS_TAGS = 'script,style,iframe,object,embed,link,meta,form,base,frame,frameset,applet,noscript,template';
var URL_ATTRS = /^(href|src|xlink:href|action|formaction|srcdoc|poster|data)$/i;
var SMIL_TAGS = /^(animate|set|animatetransform|animatemotion)$/i;
var BAD_URL = /^[\s\u0000-\u001f]*(javascript|vbscript|data\s*:\s*text\/html)/i;

// Elements that load something on display. Their URLs must stay inside the archive.
var LOADING_TAGS = /^(img|video|audio|source|track|picture|image|use|svg|input|feimage)$/i;
var LOADING_ATTRS = /^(src|srcset|poster|data|href|xlink:href)$/i;

var NO_IMAGE = 'Image not available offline';
var URL_TEXT = /[a-z][a-z0-9+.-]*:\/\/|(^|\s)(\/\/|www\.)/i;
var NO_IMAGE_SPAN = '<span class="no-image">(?:Image|(\\d+) images) not available offline</span>';
var NO_IMAGE_RUN = new RegExp(NO_IMAGE_SPAN + '(?:(?:\\s|<br>|</?p>)*' + NO_IMAGE_SPAN + ')+', 'g');

function noImageHtml(count) {
  return '<span class="no-image">' + (count > 1 ? count + ' images not available offline' : NO_IMAGE) + '</span>';
}

// Images side by side, or in paragraphs of their own, make one line. html: as innerHTML writes it.
function collapseNoImage(html) {
  return html.replace(NO_IMAGE_RUN, function (run) {
    var count = 0;
    run.replace(new RegExp(NO_IMAGE_SPAN, 'g'), function (span, n) { count += +n || 1; return span; });
    return noImageHtml(count);
  });
}

function noImageNode(doc, text) {
  var span = doc.createElement('span');
  span.className = 'no-image';
  span.textContent = text;
  return span;
}

// An archive image whose file is missing (error event target). True when it was replaced.
function replaceFailedImage(img, doc) {
  if (!img || img.tagName !== 'IMG' || !/^images\//.test(img.getAttribute('src') || '')) return false;
  img.replaceWith(noImageNode(doc, NO_IMAGE));
  return true;
}

// Relative path or an embedded image; anything with a scheme or // stays out.
function isLocalUrl(v) {
  var u = String(v).replace(/[\u0000-\u001f\s]+/g, '');
  if (/^data:image\/(?!svg)/i.test(u)) return true;
  return !/^([a-z][a-z0-9+.-]*:|\/\/|\\)/i.test(u);
}

// Strip scripts, event handlers, script URLs and anything that would fetch a remote
// file on display. parser is a DOMParser. Links the reader clicks (a href) are kept.
function sanitizeHtml(html, parser) {
  var doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll(DANGEROUS_TAGS).forEach(function (n) { n.remove(); });
  doc.querySelectorAll('*').forEach(function (n) {
    var tag = String(n.tagName).toLowerCase();
    if (SMIL_TAGS.test(tag)) { n.remove(); return; }
    var loads = LOADING_TAGS.test(tag);
    Array.prototype.slice.call(n.attributes).forEach(function (a) {
      var name = a.name;
      if (/^(on|ping$|background$)/i.test(name) || (URL_ATTRS.test(name) && BAD_URL.test(String(a.value).replace(/[\u0000-\u001f\s]+/g, '')))) n.removeAttribute(name);
      else if (/^style$/i.test(name) && /url\s*\(|image-set|[@]import|expression|\\/i.test(a.value)) n.removeAttribute(name);
      else if (loads && LOADING_ATTRS.test(name) && (/^srcset$/i.test(name) || !isLocalUrl(a.value))) n.removeAttribute(name);
    });
    if (tag === 'img') {
      // Failed downloads often have their URL as alt text: it is never shown
      var alt = n.getAttribute('alt');
      if (alt && URL_TEXT.test(alt)) { alt = ''; n.setAttribute('alt', ''); }
      if (!n.getAttribute('src')) n.replaceWith(noImageNode(doc, alt || NO_IMAGE));
    }
    if (tag === 'a') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
  });
  return collapseNoImage(doc.body.innerHTML);
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// A citation popover. c.imgs are paths the builder made; known: its source is in this archive.
function citeHtml(c, known) {
  return '<b>' + escHtml(c.t) + '</b><p>' + escHtml(c.q) + '</p>' +
    (c.imgs || []).map(function (src) { return '<img alt="" src="' + escHtml(src) + '">'; }).join('') +
    (c.lost ? '<p>' + noImageHtml(c.lost) + '</p>' : '') +
    (known ? '<small>Click the number to open this source</small>' : '');
}

function isWebUrl(v) { return /^https?:\/\//i.test(String(v).trim()); }

// Quotes and source text differ in line breaks, curly quotes and markdown marks,
// so match on a folded copy. Returns the folded string and, per folded char,
// the index it came from in the original.
function foldText(str) {
  var out = '', pos = [], sp = true;
  for (var i = 0; i < str.length; i++) {
    var c = str[i];
    if (/[*_`#>\\]/.test(c)) continue;
    if (/\s/.test(c)) { if (sp) continue; c = ' '; sp = true; } else { sp = false; }
    if (c === '\u2019' || c === '\u2018') c = "'"; else if (c === '\u201c' || c === '\u201d') c = '"';
    pos.push(i);
    out += c;
  }
  return { text: out, pos: pos };
}

// Where quote sits in text: { at, length } in original indexes, or null.
// Falls back to the first 60 characters when the whole quote is not found.
function findQuote(text, quote) {
  var q = foldText(String(quote)).text.replace(/^[\s\u2026.]+|[\s\u2026.]+$/g, '');
  if (!q) return null;
  var f = foldText(String(text));
  var at = f.text.indexOf(q), len = q.length;
  if (at < 0) { len = Math.min(60, q.length); at = f.text.indexOf(q.slice(0, len)); }
  if (at < 0) return null;
  var from = f.pos[at], to = f.pos[at + len - 1] + 1;
  return { at: from, length: to - from };
}

// Column layout. total is the width of the main grid: 12px padding on both sides and two 12px
// gaps leave total - 48 for the three panes. cols: {l, r, lc, rc} (widths, collapsed flags).
var COL = { side: 220, chat: 360, rail: 44, step: 24, frame: 48, max: 4000 };

function clampColumns(total, cols) {
  var l = cols.lc ? COL.rail : Math.max(COL.side, cols.l), r = cols.rc ? COL.rail : Math.max(COL.side, cols.r);
  var over = l + r - (total - COL.frame - COL.chat);
  if (over > 0 && !cols.rc) { var takeR = Math.min(over, r - COL.side); r -= takeR; over -= takeR; }
  if (over > 0 && !cols.lc) l -= Math.min(over, l - COL.side);
  return { l: l, r: r };
}

// The width a side pane may take while dragged: at least 220, and chat keeps 360.
function dragColumn(total, cols, side, want) {
  var other = side === 'l' ? (cols.rc ? COL.rail : cols.r) : (cols.lc ? COL.rail : cols.l);
  return Math.max(COL.side, Math.min(want, total - COL.frame - COL.chat - other));
}

function serializeCols(s) {
  var w = function (v) { return typeof v === 'number' && isFinite(v) && v >= COL.side ? Math.min(COL.max, Math.round(v)) : null; };
  return JSON.stringify({ l: w(s.l), r: w(s.r), lc: s.lc === true, rc: s.rc === true });
}

function parseCols(text) {
  var o = null;
  try { o = JSON.parse(text); } catch (e) { /* no saved layout */ }
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  return JSON.parse(serializeCols(o));
}

if (typeof module === 'object' && module.exports) module.exports = { clampColumns: clampColumns, dragColumn: dragColumn, serializeCols: serializeCols, parseCols: parseCols, foldText: foldText, findQuote: findQuote, sanitizeHtml: sanitizeHtml, citeHtml: citeHtml, collapseNoImage: collapseNoImage, replaceFailedImage: replaceFailedImage };

if (typeof document !== 'undefined') (function () {
  var D = JSON.parse(document.getElementById('data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var KINDS = [
    ['audio', 'Audio Overview', 'var(--blue)', '<path d="M5 10v4M9 7v10M13 10v4M17 8v8"/>'],
    ['slides', 'Slide Deck', 'var(--pink)', '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 6v12M17 6v12"/>'],
    ['video', 'Video Overview', 'var(--green)', '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 11l5-3v8l-5-3"/>'],
    ['mind-maps', 'Mind Map', 'var(--purple)', '<rect x="3" y="10" width="5" height="4" rx="1"/><rect x="16" y="4" width="5" height="4" rx="1"/><rect x="16" y="16" width="5" height="4" rx="1"/><path d="M8 12h4M12 6v12M12 6h4M12 18h4"/>'],
    ['reports', 'Reports', 'var(--pink)', '<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5"/>'],
    ['infographics', 'Infographic', 'var(--orange)', '<path d="M6 20V10M12 20V4M18 20v-7"/>'],
    ['tables', 'Data Table', 'var(--blue)', '<path d="M4 6h1M4 12h1M4 18h1M9 6h11M9 12h11M9 18h11"/>'],
    ['note', 'Notes', 'var(--muted)', '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 9h8M8 13h8M8 17h5"/>']
  ];
  var KIND = {}; KINDS.forEach(function (k) { KIND[k[0]] = k; });
  function icon(body, color) { return '<svg viewBox="0 0 24 24"' + (color ? ' style="color:' + color + '"' : '') + '>' + body + '</svg>'; }
  var CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>', BACK = '<path d="M15 5l-7 7 7 7"/>', COPY = '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M5 16V5a1 1 0 0 1 1-1h10"/>';
  var esc = escHtml;

  // Exported text comes from third-party sources, so scripts and handlers never survive
  function sanitize(html) { return sanitizeHtml(html, new DOMParser()); }
  function md(text) {
    var math = [];
    var t = String(text).replace(/\$\$[\s\S]+?\$\$|\$(?![\s\d])(?:[^$\n]*?[^\s$])\$(?!\d)/g, function (m) {
      math.push(m); return 'XMATHX' + (math.length - 1) + 'XEND';
    });
    var html = sanitize(marked.parse(t, { gfm: true }));
    return html.replace(/XMATHX(\d+)XEND/g, function (_, i) {
      var m = math[+i], block = m.slice(0, 2) === '$$', src = m.replace(/^\$+|\$+$/g, '');
      src = src.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      try { return katex.renderToString(src, { displayMode: block, throwOnError: false }); } catch (e) { return esc(m); }
    });
  }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  var srcByTitle = {}; D.sources.forEach(function (s, i) { srcByTitle[norm(s.title)] = i; });

  function markQuote(box, quote) {
    var w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [], n, full = '';
    while ((n = w.nextNode())) { nodes.push(n); full += n.nodeValue; }
    var hit = findQuote(full, quote); if (!hit) return false;
    var from = hit.at, to = hit.at + hit.length, offs = [], o = 0;
    nodes.forEach(function (nd) { offs.push(o); o += nd.nodeValue.length; });
    var owner = [];
    nodes.forEach(function (nd, k) { for (var j = 0; j < nd.nodeValue.length; j++) owner.push(k); });
    var first = null;
    for (var k = owner[to - 1]; k >= owner[from]; k--) {
      var nd = nodes[k], s = Math.max(0, from - offs[k]), e = Math.min(nd.nodeValue.length, to - offs[k]);
      if (!nd.nodeValue.slice(s, e).trim()) continue;
      var r = document.createRange(); r.setStart(nd, s); r.setEnd(nd, e);
      var m = document.createElement('mark'); r.surroundContents(m); first = m;
    }
    if (first) {
      var sc = box.closest('.scroll'), mr = first.getBoundingClientRect(), sr = sc.getBoundingClientRect();
      sc.scrollTop += mr.top - sr.top - sc.clientHeight * 0.25;
    }
    return !!first;
  }

  /* Columns: drag handles, collapse rails, saved layout */
  var COLS_KEY = 'nlme-viewer-cols:' + D.notebook;
  var cols = (function () { try { return parseCols(localStorage.getItem(COLS_KEY)); } catch (e) { return parseCols(null); } })();
  var auto = { l: null, r: null };   // widths set by opening a source or artifact; the user's own width wins
  function saveCols() { try { localStorage.setItem(COLS_KEY, serializeCols(cols)); } catch (e) { /* no storage: the layout stays for this visit */ } }
  function colBtn(side) {
    return '<button class="icon-btn col-btn" data-collapse="' + side + '" aria-label="Collapse ' + (side === 'l' ? 'Sources' : 'Studio') + '" title="Collapse">' +
      icon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="' + (side === 'l' ? 'M9 4v16' : 'M15 4v16') + '"/>') + '</button>';
  }
  function colState() {
    var narrow = innerWidth <= 1000;
    return { l: cols.l || auto.l || (narrow ? 260 : 340), r: cols.r || auto.r || (narrow ? 300 : 400), lc: cols.lc, rc: cols.rc };
  }
  function applyCols() {
    var total = $('main').clientWidth, w = clampColumns(total, colState()), root = document.documentElement;
    root.style.setProperty('--l', w.l + 'px'); root.style.setProperty('--r', w.r + 'px');
    ['left', 'right'].forEach(function (id, k) {
      var side = k ? 'r' : 'l', collapsed = k ? cols.rc : cols.lc, pane = $(id), b = pane.querySelector('[data-collapse]'), name = k ? 'Studio' : 'Sources';
      pane.classList.toggle('rail', collapsed);
      if (b) { b.setAttribute('aria-label', (collapsed ? 'Open ' : 'Collapse ') + name); b.title = collapsed ? 'Open' : 'Collapse'; b.setAttribute('aria-expanded', String(!collapsed)); }
      var h = $(k ? 'hr' : 'hl');
      h.hidden = collapsed;
      h.style.left = (k ? total - 24 - w.r : 12 + w.l) + 'px';
      h.setAttribute('aria-valuenow', String(w[side]));
      h.setAttribute('aria-valuemin', String(COL.side));
      h.setAttribute('aria-valuemax', String(dragColumn(total, { l: w.l, r: w.r, lc: cols.lc, rc: cols.rc }, side, COL.max)));
    });
  }
  function setWidth(side, px) {
    var total = $('main').clientWidth, st = colState(), w = clampColumns(total, st);
    st.l = w.l; st.r = w.r;
    cols[side] = Math.round(dragColumn(total, st, side, px));
    saveCols(); applyCols();
  }
  function reveal(side, px) {   // opening something: reopen a collapsed pane, widen it unless the user chose a width
    auto[side] = px;
    if (cols[side + 'c']) { cols[side + 'c'] = false; saveCols(); }
  }
  [['hl', 'l'], ['hr', 'r']].forEach(function (pair) {
    var h = $(pair[0]), side = pair[1], sign = side === 'l' ? 1 : -1;
    h.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); $('shield').hidden = false;
    });
    h.addEventListener('pointermove', function (e) {
      if (!h.classList.contains('drag')) return;
      var box = $('main').getBoundingClientRect();
      setWidth(side, side === 'l' ? e.clientX - box.left - 12 : box.right - 12 - e.clientX);
    });
    function end() { h.classList.remove('drag'); $('shield').hidden = true; }
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end); h.addEventListener('lostpointercapture', end);
    h.addEventListener('dblclick', function () { cols[side] = null; auto[side] = null; saveCols(); applyCols(); });
    h.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
      e.preventDefault(); setWidth(side, colState()[side] + d * sign * COL.step);
    });
  });
  addEventListener('resize', applyCols);

  /* Sources pane */
  var srcQ = '';
  function sourcesList() {
    auto.l = null;
    var q = srcQ.toLowerCase(), hits = [];
    D.sources.forEach(function (s, i) { if (!q || s.title.toLowerCase().indexOf(q) > -1) hits.push(i); });
    $('left').innerHTML = '<div class="p-head"><h2>Sources</h2>' + colBtn('l') + '</div><label class="search-block">' + icon('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>') +
      '<input id="srcq" type="search" aria-label="Search sources" placeholder="Search sources" value="' + esc(srcQ) + '"></label><div class="group">' + hits.length + ' of ' + D.sources.length + '</div><div class="scroll">' +
      hits.map(function (i) {
        var s = D.sources[i];
        return '<button class="src" data-src="' + i + '">' + (s.url ? '<i class="yt"></i>' : icon('<path d="M7 3h7l4 4v14H7zM14 3v4h4"/>', 'var(--muted)')) + '<span>' + esc(s.title) + '</span></button>';
      }).join('') + '</div>';
    applyCols();
  }
  function openSource(i, quote) {
    var s = D.sources[i];
    reveal('l', Math.round(innerWidth * 0.36));
    $('left').innerHTML = '<div class="p-head"><button class="icon-btn" id="srcback" aria-label="Back to sources">' + icon(BACK) + '</button><h2 style="flex:1">' + esc(s.title) + '</h2>' + colBtn('l') + '</div><div class="scroll"><div class="reader md" id="srcbody">' +
      (isWebUrl(s.url) ? '<p><a class="ext" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open original video</a></p>' : '') + md(s.md) + '</div></div>';
    applyCols();
    if (quote) setTimeout(function () { markQuote($('srcbody'), quote); }, 200);
  }

  /* Chat */
  var chatRendered = [];
  function chatHtml(idx, q) {
    var last = '', html = '';
    idx.forEach(function (i) {
      var p = D.pairs[i];
      if (p.date !== last) { html += '<div class="date">' + esc(p.date) + '</div>'; last = p.date; }
      html += '<article id="pair-' + i + '"><div class="q"><div>' + esc(p.q) + '</div></div><div class="answer"><div class="md">' + md(p.a) + '</div><div class="actions"><button class="icon-btn" data-copy="' + i + '" aria-label="Copy answer" title="Copy answer">' + icon(COPY) + '</button></div></div></article>';
    });
    return html;
  }
  function renderChat(q) {
    var low = (q || '').toLowerCase(), idx = [];
    D.pairs.forEach(function (p, i) { if (!low || (p.q + ' ' + p.a).toLowerCase().indexOf(low) > -1) idx.push(i); });
    var top = low ? '' : '<div class="nb-title">' + esc(D.notebook) + '</div><div class="nb-meta">' + D.sources.length + ' sources</div>' + (D.summary ? '<div class="md">' + md(D.summary) + '</div>' : '');
    var box = $('chat');
    box.innerHTML = top;
    $('chatcount').textContent = low ? idx.length + ' of ' + D.pairs.length : D.sources.length + ' sources';
    var at = 0, token = (renderChat.t = (renderChat.t || 0) + 1);
    (function batch() {
      if (token !== renderChat.t || at >= idx.length) return;
      var part = idx.slice(at, at + 15); at += 15;
      box.insertAdjacentHTML('beforeend', chatHtml(part));
      setTimeout(batch, 0);
    })();
  }

  /* Studio pane */
  var filter = '', opened = null;
  function studioList() {
    opened = null;
    auto.r = null;
    var counts = {}; D.studio.forEach(function (a) { counts[a.kind] = (counts[a.kind] || 0) + 1; });
    var tiles = KINDS.map(function (k) {
      var c = counts[k[0]] || 0;
      return '<button class="tile" data-kind="' + k[0] + '" aria-pressed="' + (filter === k[0]) + '"' + (c ? '' : ' disabled title="Not in this export"') + '>' + icon(k[3], k[2]) + '<span>' + k[1] + '</span>' + (c ? '<em>' + c + '</em>' : '') + '</button>';
    }).join('');
    var rows = D.studio.map(function (a, i) { return [a, i]; }).filter(function (x) { return !filter || x[0].kind === filter; }).map(function (x) {
      var k = KIND[x[0].kind] || KIND.note, ext = x[0].files ? Object.keys(x[0].files).join(' · ') : 'Note';
      return '<button class="art" data-art="' + x[1] + '">' + icon(k[3], k[2]) + '<div><b>' + esc(x[0].title) + '</b><small>' + esc(ext) + '</small></div></button>';
    }).join('');
    $('right').innerHTML = '<div class="p-head"><h2>Studio</h2>' + colBtn('r') + '</div><div class="tiles">' + tiles + '</div><div class="scroll">' + rows + '</div>';
    applyCols();
  }
  function dlLinks(a, skip) {
    if (!a.files) return '';
    return '<div class="dl">' + Object.keys(a.files).filter(function (e) { return e !== skip; }).map(function (e) {
      return '<a href="' + esc(a.files[e]) + '" download>' + esc(e.toUpperCase()) + '</a>'; }).join('') + '</div>';
  }
  function tableHtml(rows) {
    if (!rows || !rows.length) return '<p>Empty table.</p>';
    return '<table><thead><tr>' + rows[0].map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(1).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  function openArt(i) {
    var a = D.studio[i], f = a.files || {}, body;
    opened = i;
    reveal('r', Math.round(innerWidth * 0.40));
    if (a.md != null) body = '<div class="scroll"><div class="reader md">' + md(a.md) + '</div></div>';
    else if (a.rows) body = '<div class="scroll"><div class="reader md">' + tableHtml(a.rows) + '</div></div>';
    else if (f.pdf) body = '<iframe class="frame" title="' + esc(a.title) + '" src="' + esc(f.pdf) + '"></iframe>';
    else if (f.html && a.kind === 'mind-maps') body = '<iframe class="frame" title="' + esc(a.title) + '" src="' + esc(f.html) + '"></iframe>';
    else if (f.svg) body = '<div class="scroll"><img alt="' + esc(a.title) + '" src="' + esc(f.svg) + '" style="width:100%"></div>';
    else if (f.m4a || f.mp3 || f.wav) body = '<div class="player"><audio controls preload="metadata" src="' + esc(f.m4a || f.mp3 || f.wav) + '"></audio></div>';
    else if (f.mp4 || f.webm) body = '<div class="player"><video controls preload="metadata" src="' + esc(f.mp4 || f.webm) + '"></video></div>';
    else if (f.png || f.jpg || f.jpeg || f.webp) body = '<div class="scroll"><img alt="' + esc(a.title) + '" src="' + esc(f.png || f.jpg || f.jpeg || f.webp) + '" style="width:100%"></div>';
    else body = '<div class="player"><p>This file type opens outside the viewer.</p></div>';
    $('right').innerHTML = '<div class="p-head"><button class="icon-btn" id="artback" aria-label="Back to Studio">' + icon(BACK) + '</button><h2 style="flex:1">' + esc(a.title) + '</h2><button class="icon-btn" id="artclose" aria-label="Close">' + icon(CLOSE) + '</button>' + colBtn('r') + '</div>' + dlLinks(a) + body;
    applyCols();
  }

  /* Citation popover */
  var pop = $('pop'), hideT = null;
  function showPop(btn) {
    clearTimeout(hideT);
    var c = D.cites[+btn.dataset.c]; if (!c) return;
    pop.innerHTML = citeHtml(c, srcByTitle[norm(c.t)] !== undefined);
    pop.hidden = false; pop.scrollTop = 0;
    function place() {
      var r = btn.getBoundingClientRect(), pr = pop.getBoundingClientRect();
      var x = Math.max(12, Math.min(innerWidth - pr.width - 12, r.left - 20));
      var y = r.bottom + 6 + pr.height > innerHeight - 8 ? Math.max(8, r.top - pr.height - 6) : r.bottom + 6;
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    }
    place();
    pop.querySelectorAll('img').forEach(function (img) { img.addEventListener('load', place); }); // images change its height
  }
  function hidePop() { hideT = setTimeout(function () { pop.hidden = true; }, 180); }
  document.addEventListener('mouseover', function (e) { var b = e.target.closest && e.target.closest('.cite'); if (b) showPop(b); });
  document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.cite')) hidePop(); });
  document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('cite')) showPop(e.target); });
  document.addEventListener('focusout', function (e) { if (e.target.classList && e.target.classList.contains('cite')) hidePop(); });
  pop.addEventListener('mouseenter', function () { clearTimeout(hideT); });
  pop.addEventListener('mouseleave', hidePop);

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null; if (!t) return;
    if (t.classList.contains('cite')) {
      var c = D.cites[+t.dataset.c], i = c && srcByTitle[norm(c.t)];
      if (i !== undefined) { pop.hidden = true; openSource(i, c.q); }
    } else if (t.dataset.src !== undefined) openSource(+t.dataset.src);
    else if (t.dataset.collapse) { var cs = t.dataset.collapse + 'c'; cols[cs] = !cols[cs]; saveCols(); applyCols(); }
    else if (t.id === 'srcback') sourcesList();
    else if (t.dataset.art !== undefined) openArt(+t.dataset.art);
    else if (t.id === 'artback' || t.id === 'artclose') studioList();
    else if (t.dataset.kind) { filter = filter === t.dataset.kind ? '' : t.dataset.kind; studioList(); }
    else if (t.dataset.copy !== undefined) {
      var box = t.closest('.answer').querySelector('.md');
      if (navigator.clipboard) navigator.clipboard.writeText(box.innerText).catch(function () {});
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'srcq') { srcQ = e.target.value; var pos = e.target.selectionStart; sourcesList(); var n = $('srcq'); n.focus(); n.setSelectionRange(pos, pos); }
    if (e.target.id === 'chatq') { clearTimeout(renderChat.d); var v = e.target.value; renderChat.d = setTimeout(function () { renderChat(v); }, 180); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { pop.hidden = true; if (opened !== null) studioList(); } });

  // Error events do not bubble: this needs the capture phase. One pass per burst of failures,
  // because writing innerHTML restarts the images still loading.
  document.addEventListener('error', function (e) {
    var box = e.target.closest && (e.target.closest('.md') || e.target.closest('#pop'));
    if (!replaceFailedImage(e.target, document) || !box) return;
    clearTimeout(box.noImageT);
    box.noImageT = setTimeout(function () {
      var html = box.innerHTML, collapsed = collapseNoImage(html);
      if (collapsed !== html) box.innerHTML = collapsed;
    }, 50);
  }, true);

  document.title = D.notebook + ' archive';
  $('nb').textContent = D.notebook;
  $('stamp').textContent = 'Read-only' + (D.exported ? ' · exported ' + String(D.exported).slice(0, 10) : '');
  sourcesList(); renderChat(''); studioList();
})();
