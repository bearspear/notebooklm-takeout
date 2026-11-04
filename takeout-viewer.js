// NotebookLM Takeout - offline viewer data builder
// Classic script. Exposes globalThis.NLMEViewer (and module.exports for tests):
//   wantsText(path)                    true for the .md / .csv files the viewer reads
//   extractImages(markdown, addImage)  embedded images become images/<hash>.<ext> links
//   buildViewerData(files, {notebook, exported, mediaBase, savedImages})
//                                      mediaBase: prefix for media links (default '' = relative to the takeout root)
//                                      savedImages: Set of the images/ paths that exist; other image links
//                                      are emptied (default: every link stays)
//                                      files: {relative path: text | null}
//                                      (null = present, not read). Paths may sit
//                                      under part-N/. Returns the viewer's data object.
//   escapeJson(data)                   JSON that is safe inside a <script> tag
//   assembleViewer({template, css, marked, katex, app, data})  one self-contained HTML string
//   VIEWER_ASSETS                      paths of the five viewer files
//   keepsText(path)                    wantsText, plus the artifacts manifest (titles)
//   captureEntry(store, relPath, data, addImage)
//                                      store[relPath] = data for kept strings, else null; a
//                                      -with-images text goes through extractImages first
//   landedPath(path, diskName)         path with the file name a download really got
//   outsidePath(typeFolder, savedName) path inside artifacts/ of a file saved beside the takeout root
(function (root) {
  'use strict';

  // One Sources line: a run of anchors (grouped Titles mode has several), a run of [[n]](...) links, the title.
  const SRC_RE = /((?:<a id="[^"]*?src-\d+"><\/a>)+)\s*\n\*\*(?:\[\[\d+\]\]\([^)]*\)[ \t]*)+\*\*[ \t]*(.*)/g;
  const ANCHOR_RE = /<a id="([^"]*?src-\d+)"><\/a>/g;
  const REF_RE = /<a id="[^"]*" href="#([^"]*src-\d+)">\[(\d+)\]<\/a>/g;
  const SUP_RE = /<sup>((?:\s*<a id="[^"]*" href="#[^"]*src-\d+">\[\d+\]<\/a>\s*,?)+)<\/sup>/g;
  const FN_MARK_RE = /\[\^([\w.-]+)\]/g;
  const FN_DEF_RE = /^\[\^([\w.-]+)\]:[ \t]?(.*)$/;
  const SKIP_VARIANTS = ['-code-blocks', '-with-images'];
  const WITH_IMAGES = '-with-images';
  // An embedded image: alt, type, base64 (the alt may hold escaped brackets)
  const EMBEDDED_IMAGE_RE = /!\[((?:\\.|[^\]\\\n])*)\]\(\s*data:(image\/[a-z0-9.+-]+)(?:;[^;,()\s]*)*;base64,([a-z0-9+/=_-]+)\s*\)/gi;
  // Any Markdown image: the url is group 1
  const ANY_IMAGE_RE = /!\[(?:\\.|[^\]\\\n])*\]\(([^)\s]*)\)/g;
  const IMAGE_PATH_RE = /^images\/[0-9a-f]{16}\.[a-z0-9]+$/;
  const IMAGE_EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', avif: 'avif', bmp: 'bmp', 'svg+xml': 'svg', tiff: 'tif' };

  const baseName = p => p.slice(p.lastIndexOf('/') + 1);
  const stripExt = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };
  const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };

  function wantsText(path) {
    const name = baseName(String(path));
    if (!/\.(md|csv)$/i.test(name)) return false;
    const stem = stripExt(name);
    if (stem.replace(/-with-images$/, '').endsWith('-code-blocks')) return false;
    if (stem.startsWith('combined-notes') || stem.startsWith('_index') || stem.startsWith('_audit')) return false;
    return name !== 'errors.md';
  }

  // Two 32-bit mixes over the whole string (cyrb53's, kept to 64 bits): pure and synchronous,
  // which crypto.subtle is not. Sixteen hex characters.
  function contentHash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hex = n => (n >>> 0).toString(16).padStart(8, '0');
    return hex(h2) + hex(h1);
  }

  // What each addImage has been given, so it hears of an image once however many files hold it
  const imagesSeen = new WeakMap();

  // ![alt](data:image/...;base64,...) -> ![alt](images/<hash>.<ext>); addImage(path, base64, mime)
  // gets each distinct image once. Pass one addImage for a whole takeout. Remote links stay.
  function extractImages(markdown, addImage) {
    if (!imagesSeen.has(addImage)) imagesSeen.set(addImage, new Set());
    const seen = imagesSeen.get(addImage);
    return String(markdown).replace(EMBEDDED_IMAGE_RE, (match, alt, type, base64) => {
      const mime = type.toLowerCase();
      const path = `images/${contentHash(base64)}.${IMAGE_EXT[mime.slice('image/'.length)] || 'img'}`;
      if (!seen.has(path)) {
        seen.add(path);
        addImage(path, base64, mime);
      }
      return `![${alt}](${path})`;
    });
  }

  // Empty the links of images that were not saved: the page shows the placeholder there
  function dropUnsavedImages(files, savedImages) {
    const out = {};
    for (const [path, text] of Object.entries(files)) {
      out[path] = typeof text !== 'string' ? text : text.replace(ANY_IMAGE_RE, (match, url) =>
        (IMAGE_PATH_RE.test(url) && !savedImages.has(url) ? `${match.slice(0, -url.length - 2)}()` : match));
    }
    return out;
  }

  // Takeout layout (batchPrefix): 'notes/part-2/a.md' -> 'notes/a.md'.
  // Parts unpacked side by side: 'part-2/notes/a.md', 'x/part-1/notes/a.md' -> 'notes/a.md'
  function normalizePath(p) {
    const inner = /^(sources|notes|chat|artifacts)\/part-\d+\/(.*)$/.exec(p);
    if (inner) return `${inner[1]}/${inner[2]}`;
    const m = /(?:^|\/)part-\d+\/(.*)$/.exec(p);
    return m ? m[1] : p;
  }

  function front(text) {
    const meta = {};
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (!m) return [meta, text];
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const v = line.slice(i + 1).trim();
      let val = v;
      try { val = JSON.parse(v); } catch (e) { /* keep the raw string */ }
      meta[line.slice(0, i).trim()] = val;
    }
    return [meta, text.slice(m[0].length)];
  }

  const dropH1 = body => body.replace(/^\s*# .*\n/, '').trimStart();

  function cleanQuote(block) {
    return block.trim().replace(/(^|\n+)---$/, '').split('\n').map(l => l.replace(/^> ?/, '')).filter(l => !l.startsWith('```')).join('\n').trim();
  }

  // Footnote definition: '[^L]: **Title** \u2014 quote' (see NLME.footnoteDefinition).
  // Returns {t, q}; the title unescapes \*, continuation lines lose their 4-space indent.
  function parseDefinition(first, rest) {
    const text = [first, ...rest.map(l => l.replace(/^ {4}/, ''))].join('\n').trim();
    const m = /^\*\*((?:\\.|[^*\\])*)\*\*(?: \u2014 ([\s\S]*))?$/.exec(text);
    if (m) {
      const t = m[1].replace(/\\\*/g, '*');
      return { t: t === '(untitled source)' && !m[2] ? '' : t, q: (m[2] || '').trim() };
    }
    return { t: '', q: text };
  }

  // The popover and the quote search need plain text: images leave the quote. imgs: the
  // ones that exist; lost: how many do not. Both only when there are any.
  function citeRecord(t, quote) {
    const imgs = [];
    let lost = 0;
    const q = quote.replace(ANY_IMAGE_RE, (match, url) => {
      if (!IMAGE_PATH_RE.test(url)) lost++;
      else if (!imgs.includes(url)) imgs.push(url);
      return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    const record = { t, q };
    if (imgs.length) record.imgs = imgs;
    if (lost) record.lost = lost;
    return record;
  }

  function createCites() {
    const items = [];
    const index = new Map();
    const add = (t, q) => {
      const record = citeRecord(t, q);
      const key = JSON.stringify(record);
      if (!index.has(key)) { index.set(key, items.length); items.push(record); }
      return index.get(key);
    };

    const TRAIL_RE = /(\n\s*(---|\*\*Sources:?\*\*|#{1,4} *(Sources|References|Citations)[^\n]*))+\s*$/;

    function convertLinks(md) {
      const marks = [...md.matchAll(SRC_RE)];
      if (!marks.length) return null;
      const ids = {};
      marks.forEach((m, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].index : md.length;
        const at = add(m[2].trim(), cleanQuote(md.slice(m.index + m[0].length, end)));
        for (const a of m[1].matchAll(ANCHOR_RE)) ids[a[1]] = at;
      });
      let body = md.slice(0, marks[0].index).trimEnd().replace(TRAIL_RE, '').trimEnd();
      const chip = (s, id, n) => (ids[id] === undefined ? s : `<button class="cite" data-c="${ids[id]}">${n}</button>`);
      body = body.replace(SUP_RE, (s, inner) => inner.replace(REF_RE, chip).replace(/,/g, '').trim());
      return [body, marks.length];
    }

    function convertFootnotes(md) {
      const lines = md.split('\n');
      const defs = {};
      const kept = [];
      let count = 0;
      for (let i = 0; i < lines.length; i++) {
        const m = FN_DEF_RE.exec(lines[i]);
        if (!m) { kept.push(lines[i]); continue; }
        const rest = [];
        while (i + 1 < lines.length) {
          if (/^ {4}/.test(lines[i + 1])) rest.push(lines[++i]);
          else if (!lines[i + 1].trim() && /^ {4}/.test(lines[i + 2] || '')) rest.push(lines[++i]);
          else break;
        }
        if (!(m[1] in defs)) count++;
        defs[m[1]] = parseDefinition(m[2], rest);
      }
      if (!count) return null;
      let body = kept.join('\n').trimEnd().replace(TRAIL_RE, '').trimEnd();
      body = body.replace(FN_MARK_RE, (s, label) => {
        if (!(label in defs)) return s;
        const d = defs[label];
        return `<button class="cite" data-c="${add(d.t, d.q)}">${label}</button>`;
      });
      return [body, count];
    }

    // Split the Sources section off, turn markers into chips: [body, count]
    function convert(md) {
      return convertLinks(md) || convertFootnotes(md) || [md, 0];
    }
    return { items, convert };
  }

  const VARIANT_STEM = stem => SKIP_VARIANTS.some(v => stem.endsWith(v));

  // Text files of a section, sorted: [normalized path, text, raw path, has images]. A -with-images
  // file replaces its base file's text; one with another title is an item that only sounds alike.
  function sectionFiles(files, section) {
    const found = new Map();
    for (const [raw, text] of Object.entries(files)) {
      const p = normalizePath(raw);
      if (typeof text === 'string' && p.startsWith(section + '/') && p.endsWith('.md') && wantsText(p)) found.set(raw, [p, text, raw, false]);
    }
    for (const [raw, entry] of [...found]) {
      if (!raw.endsWith(`${WITH_IMAGES}.md`)) continue;
      const base = found.get(`${raw.slice(0, -WITH_IMAGES.length - 3)}.md`);
      if (!base) continue;
      const [title, baseTitle] = [front(entry[1])[0].title, front(base[1])[0].title];
      if (title && baseTitle && title !== baseTitle) continue;
      base[1] = entry[1];
      base[3] = true;
      found.delete(raw);
    }
    return [...found.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  // A plus-meta file's summary with the body of the -with-images file, which has no summary
  function withSummary(plusMeta, images) {
    const heading = '\n## Content\n';
    const at = plusMeta.indexOf(heading), bodyAt = images.indexOf(heading);
    return at < 0 || bodyAt < 0 ? plusMeta : plusMeta.slice(0, at) + images.slice(bodyAt);
  }

  function loadSources(files) {
    const byBase = new Map();
    for (const [, text, raw, hasImages] of sectionFiles(files, 'sources')) {
      const name = raw.slice(0, -3);
      const base = name.replace(/-plus-meta(-with-images)?$/, '');
      if (!byBase.has(base)) byBase.set(base, {});
      const item = byBase.get(base);
      if (base === name) { item.plain = text; item.plainImages = hasImages; }
      else { item.meta = text; item.metaImages = hasImages || name.endsWith(WITH_IMAGES); }
    }
    const sources = [];
    for (const [base, v] of byBase) {
      const text = v.meta === undefined ? v.plain
        : v.plainImages && !v.metaImages ? withSummary(v.meta, v.plain) : v.meta;
      const [meta] = front(v.meta === undefined ? v.plain : v.meta);
      const body = front(text)[1];
      sources.push({ title: meta.title || baseName(base), url: meta.youtube_url || '', md: dropH1(body.trimStart()) });
    }
    return sources.sort((a, b) => {
      const x = a.title.toLowerCase(), y = b.title.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }

  function loadNotes(files, cites) {
    const notes = [];
    const seen = new Set();
    for (const [p, text] of sectionFiles(files, 'notes')) {
      const [meta, raw] = front(text);
      const title = meta.title || baseName(p).slice(0, -3);
      const [body] = cites.convert(dropH1(raw.trimStart()));
      const key = title + '\0' + body;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({ kind: 'note', title, md: body });
    }
    return notes;
  }

  function loadChat(files, cites) {
    let summary = '';
    const pairs = [];
    for (const [p, text] of sectionFiles(files, 'chat')) {
      if (!/^chat(-with-images)?\.md$/.test(baseName(p))) continue;
      const body = front(text)[1];
      const first = /^## (Q:|\d{4}-\d\d-\d\d)/m.exec(body);
      const head = first ? body.slice(0, first.index) : body;
      const sm = /\*\*Notebook Summary\*\*\s*([\s\S]*)/.exec(head);
      if (sm && !summary) summary = (sm[1].trim() + '\n').split(/\n---\s*\n|\n\*\*Chat Export/)[0].trim();
      let date = '';
      for (const part of (first ? body.slice(first.index) : '').split(/^(?=## (?:Q:|\d{4}-\d\d-\d\d))/m).map(x => x.replace(/^## /, ''))) {
        if (/^\d{4}-\d\d-\d\d/.test(part)) { date = part.split('\n')[0].trim(); continue; }
        if (!part.startsWith('Q:')) continue;
        const nl = part.indexOf('\n');
        const q = (nl < 0 ? part : part.slice(0, nl)).slice(2).trim();
        const a0 = (nl < 0 ? '' : part.slice(nl + 1)).replace(/^\s*\*\*A:\*\*\s*/, '');
        let [a, n] = cites.convert(a0.trimEnd());
        a = a.replace(/\n---\s*$/, '').trimEnd();
        pairs.push({ date, q, a, n });
      }
    }
    return { summary, pairs };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false, any = false;
    const s = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') { quoted = true; any = true; }
      else if (c === ',') { row.push(field); field = ''; any = true; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        if (any || field) { row.push(field); rows.push(row); }
        row = []; field = ''; any = false;
      } else { field += c; any = true; }
    }
    if (any || field) { row.push(field); rows.push(row); }
    return rows;
  }

  const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

  function loadArtifacts(files, mediaBase) {
    const titles = {};
    for (const [raw, text] of Object.entries(files)) {
      if (normalizePath(raw) !== 'artifacts/manifest.json' || typeof text !== 'string') continue;
      try {
        for (const f of JSON.parse(text).files || []) if (f && f.title && f.path) titles[stripExt(baseName(f.path))] = f.title;
      } catch (e) { /* no titles */ }
    }
    const kinds = new Map();
    for (const raw of Object.keys(files)) {
      const p = normalizePath(raw);
      const m = /^artifacts\/([^/]+)\/(.+)$/.exec(p);
      if (!m) continue;
      const name = baseName(p);
      if (name.startsWith('.')) continue;
      const stem = stripExt(name);
      if (VARIANT_STEM(stem)) continue;
      if (!kinds.has(m[1])) kinds.set(m[1], new Map());
      const groups = kinds.get(m[1]);
      // Files merge only within one directory, so parts never cross-attach
      const key = raw.slice(0, raw.length - name.length) + '\0' + stem;
      if (!groups.has(key)) groups.set(key, { stem, files: {} });
      groups.get(key).files[extOf(name)] = raw;
    }
    const out = [];
    for (const kind of [...kinds.keys()].sort()) {
      const groups = kinds.get(kind);
      for (const key of [...groups.keys()].sort((x, y) => {
        const gx = groups.get(x).stem, gy = groups.get(y).stem;
        return gx < gy ? -1 : gx > gy ? 1 : x < y ? -1 : x > y ? 1 : 0;
      })) {
        const { stem, files: g } = groups.get(key);
        const a = { kind, title: titles[stem] || stem.replace(/-/g, ' '), files: {} };
        for (const [ext, raw] of Object.entries(g)) a.files[ext] = mediaBase + encodePath(raw);
        if (typeof files[g.md] === 'string') a.md = dropH1(front(files[g.md])[1].trimStart());
        if (typeof files[g.csv] === 'string') a.rows = parseCsv(files[g.csv]);
        out.push(a);
      }
    }
    return out;
  }

  function buildViewerData(allFiles, { notebook = '', exported = '', mediaBase = '', savedImages = null } = {}) {
    const files = savedImages ? dropUnsavedImages(allFiles, savedImages) : allFiles;
    const cites = createCites();
    const { summary, pairs } = loadChat(files, cites);
    return {
      notebook, exported, summary,
      sources: loadSources(files),
      studio: loadNotes(files, cites).concat(loadArtifacts(files, mediaBase)),
      pairs,
      cites: cites.items
    };
  }

  function escapeJson(data) {
    return JSON.stringify(data)
      .replace(/<\//g, '<\\/')
      .replace(/<!--/g, '\\u003c!--')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function keepsText(path) {
    return wantsText(path) || normalizePath(String(path)) === 'artifacts/manifest.json';
  }

  // One saved file for a Full Takeout's viewer. Everything is listed (media links);
  // text stays only where the viewer reads it, so memory stays bounded. Image bytes
  // go to addImage as they are seen: the store never holds base64.
  function captureEntry(store, relPath, data, addImage = () => {}) {
    if (typeof data !== 'string' || !keepsText(relPath)) store[relPath] = null;
    else store[relPath] = stripExt(baseName(relPath)).endsWith(WITH_IMAGES) ? extractImages(data, addImage) : data;
  }

  // chrome.downloads may give a URL download another name than planned (real
  // extension, ' (1)' on a clash). diskName: the download's absolute path; '' = unknown.
  function landedPath(path, diskName) {
    const name = String(diskName || '').split(/[\\/]/).pop();
    return name ? path.slice(0, path.lastIndexOf('/') + 1) + name : path;
  }

  // Path, inside artifacts/, of a file the background saved into the top of the
  // Downloads folder, one level above the takeout root. It stays under <type>/ so the
  // item is listed under its type; the '..' segments make the link resolve from viewer.html.
  function outsidePath(typeFolder, savedName) {
    return `${typeFolder}/../../../${String(savedName).split(/[\\/]/).pop()}`;
  }

  const VIEWER_ASSETS = [
    'viewer/viewer-template.html', 'viewer/viewer-app.js', 'viewer/marked.min.js',
    'viewer/katex.min.js', 'viewer/katex-inline.css'
  ];

  // One pass with function replacers: '$&' or a placeholder inside a value stays literal.
  // data: object (escaped here) or an already-escaped JSON string.
  function assembleViewer({ template, css, marked, katex, app, data }) {
    const script = code => String(code).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
    const values = {
      KATEX_CSS: () => String(css).replace(/<\/style/gi, '<\\/style'),
      DATA_JSON: () => (typeof data === 'string' ? data : escapeJson(data)),
      MARKED_JS: () => script(marked),
      KATEX_JS: () => script(katex),
      APP_JS: () => script(app)
    };
    return String(template).replace(/\/\*(KATEX_CSS|DATA_JSON|MARKED_JS|KATEX_JS|APP_JS)\*\//g, (m, k) => values[k]());
  }

  const api = { wantsText, keepsText, extractImages, captureEntry, landedPath, outsidePath, buildViewerData, escapeJson, assembleViewer, VIEWER_ASSETS };
  root.NLMEViewer = Object.assign(root.NLMEViewer || {}, api);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
