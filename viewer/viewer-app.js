// NotebookLM Takeout - offline viewer page script (inlined into every viewer file).
// Pure helpers sit at the top so Node tests can load them; the page code below
// only runs where a document exists.

var DANGEROUS_TAGS = 'script,style,iframe,object,embed,link,meta,form,base,frame,frameset,applet,noscript,template';
var URL_ATTRS = /^(href|src|xlink:href|action|formaction|srcdoc|poster|data)$/i;
var BAD_URL = /^[\s\u0000-\u001f]*(javascript|vbscript|data\s*:\s*text\/html)/i;

// Strip scripts, event handlers and script URLs. parser is a DOMParser.
function sanitizeHtml(html, parser) {
  var doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll(DANGEROUS_TAGS).forEach(function (n) { n.remove(); });
  doc.querySelectorAll('*').forEach(function (n) {
    Array.prototype.slice.call(n.attributes).forEach(function (a) {
      if (/^on/i.test(a.name) || (URL_ATTRS.test(a.name) && BAD_URL.test(a.value))) n.removeAttribute(a.name);
    });
    if (n.tagName === 'A') { n.target = '_blank'; n.rel = 'noopener'; }
  });
  return doc.body.innerHTML;
}

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

if (typeof module === 'object' && module.exports) module.exports = { foldText: foldText, findQuote: findQuote, sanitizeHtml: sanitizeHtml };

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
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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

  /* Sources pane */
  var srcQ = '';
  function sourcesList() {
    document.documentElement.style.removeProperty('--l');
    var q = srcQ.toLowerCase(), hits = [];
    D.sources.forEach(function (s, i) { if (!q || s.title.toLowerCase().indexOf(q) > -1) hits.push(i); });
    $('left').innerHTML = '<div class="p-head"><h2>Sources</h2></div><label class="search-block">' + icon('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>') +
      '<input id="srcq" type="search" aria-label="Search sources" placeholder="Search sources" value="' + esc(srcQ) + '"></label><div class="group">' + hits.length + ' of ' + D.sources.length + '</div><div class="scroll">' +
      hits.map(function (i) {
        var s = D.sources[i];
        return '<button class="src" data-src="' + i + '">' + (s.url ? '<i class="yt"></i>' : icon('<path d="M7 3h7l4 4v14H7zM14 3v4h4"/>', 'var(--muted)')) + '<span>' + esc(s.title) + '</span></button>';
      }).join('') + '</div>';
  }
  function openSource(i, quote) {
    var s = D.sources[i];
    document.documentElement.style.setProperty('--l', '36vw');
    $('left').innerHTML = '<div class="p-head"><button class="icon-btn" id="srcback" aria-label="Back to sources">' + icon(BACK) + '</button><h2 style="flex:1">' + esc(s.title) + '</h2></div><div class="scroll"><div class="reader md" id="srcbody">' +
      (s.url ? '<p><a class="ext" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open original video</a></p>' : '') + md(s.md) + '</div></div>';
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
    document.documentElement.style.removeProperty('--r');
    var counts = {}; D.studio.forEach(function (a) { counts[a.kind] = (counts[a.kind] || 0) + 1; });
    var tiles = KINDS.map(function (k) {
      var c = counts[k[0]] || 0;
      return '<button class="tile" data-kind="' + k[0] + '" aria-pressed="' + (filter === k[0]) + '"' + (c ? '' : ' disabled title="Not in this export"') + '>' + icon(k[3], k[2]) + '<span>' + k[1] + '</span>' + (c ? '<em>' + c + '</em>' : '') + '</button>';
    }).join('');
    var rows = D.studio.map(function (a, i) { return [a, i]; }).filter(function (x) { return !filter || x[0].kind === filter; }).map(function (x) {
      var k = KIND[x[0].kind] || KIND.note, ext = x[0].files ? Object.keys(x[0].files).join(' · ') : 'Note';
      return '<button class="art" data-art="' + x[1] + '">' + icon(k[3], k[2]) + '<div><b>' + esc(x[0].title) + '</b><small>' + esc(ext) + '</small></div></button>';
    }).join('');
    $('right').innerHTML = '<div class="p-head"><h2>Studio</h2></div><div class="tiles">' + tiles + '</div><div class="scroll">' + rows + '</div>';
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
    document.documentElement.style.setProperty('--r', '40vw');
    if (a.md != null) body = '<div class="scroll"><div class="reader md">' + md(a.md) + '</div></div>';
    else if (a.rows) body = '<div class="scroll"><div class="reader md">' + tableHtml(a.rows) + '</div></div>';
    else if (f.pdf) body = '<iframe class="frame" title="' + esc(a.title) + '" src="' + esc(f.pdf) + '"></iframe>';
    else if (f.html && a.kind === 'mind-maps') body = '<iframe class="frame" title="' + esc(a.title) + '" src="' + esc(f.html) + '"></iframe>';
    else if (f.svg) body = '<div class="scroll"><img alt="' + esc(a.title) + '" src="' + esc(f.svg) + '" style="width:100%"></div>';
    else if (f.m4a || f.mp3 || f.wav) body = '<div class="player"><audio controls preload="metadata" src="' + esc(f.m4a || f.mp3 || f.wav) + '"></audio></div>';
    else if (f.mp4 || f.webm) body = '<div class="player"><video controls preload="metadata" src="' + esc(f.mp4 || f.webm) + '"></video></div>';
    else if (f.png || f.jpg || f.jpeg || f.webp) body = '<div class="scroll"><img alt="' + esc(a.title) + '" src="' + esc(f.png || f.jpg || f.jpeg || f.webp) + '" style="width:100%"></div>';
    else body = '<div class="player"><p>This file type opens outside the viewer.</p></div>';
    $('right').innerHTML = '<div class="p-head"><button class="icon-btn" id="artback" aria-label="Back to Studio">' + icon(BACK) + '</button><h2 style="flex:1">' + esc(a.title) + '</h2><button class="icon-btn" id="artclose" aria-label="Close">' + icon(CLOSE) + '</button></div>' + dlLinks(a) + body;
  }

  /* Citation popover */
  var pop = $('pop'), hideT = null;
  function showPop(btn) {
    clearTimeout(hideT);
    var c = D.cites[+btn.dataset.c]; if (!c) return;
    var known = srcByTitle[norm(c.t)] !== undefined;
    pop.innerHTML = '<b>' + esc(c.t) + '</b><p>' + esc(c.q) + '</p>' + (known ? '<small>Click the number to open this source</small>' : '');
    pop.hidden = false; pop.scrollTop = 0;
    var r = btn.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    var x = Math.max(12, Math.min(innerWidth - pr.width - 12, r.left - 20));
    var y = r.bottom + 6 + pr.height > innerHeight - 8 ? Math.max(8, r.top - pr.height - 6) : r.bottom + 6;
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
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

  document.title = D.notebook + ' archive';
  $('nb').textContent = D.notebook;
  $('stamp').textContent = 'Read-only' + (D.exported ? ' · exported ' + String(D.exported).slice(0, 10) : '');
  sourcesList(); renderChat(''); studioList();
})();
