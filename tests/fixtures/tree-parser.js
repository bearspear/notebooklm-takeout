// A small DOMParser stand-in that builds a real tree: elements, text and comments, with the
// HTML serializer's escaping (text: & < >, attributes: & "; raw-text elements and comments as is).
// Attribute names take any character but space, "/", ">" and "=", as the HTML tokenizer does,
// so <p x" title="..."> gives an attribute named x". Enough for sanitizeHtml and restoreMath.
'use strict';

const VOID = /^(img|br|hr|input|source|track|link|meta|base|wbr|area|col|embed|param)$/i;
const RAW = /^(script|style|xmp|iframe|noembed|noframes|plaintext|noscript|textarea|title)$/i;
const RAW_OUT = /^(script|style|xmp|iframe|noembed|noframes|plaintext|noscript)$/i;
const SVG_NS = 'http://www.w3.org/2000/svg', MATH_NS = 'http://www.w3.org/1998/Math/MathML', HTML_NS = 'http://www.w3.org/1999/xhtml';

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : +k.slice(1));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(n) { const p = this.parentNode; if (p) { p.insertBefore(n, this); p.removeChild(this); } }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  insertBefore(n, ref) {
    if (n.nodeType === 11) { n.childNodes.slice().forEach(c => this.insertBefore(c, ref)); return n; }
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    n.parentNode = this; return n;
  }
  appendChild(n) { return this.insertBefore(n, null); }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.nodeType === 8 ? '' : this.childNodes.map(c => c.textContent).join(''); }
  set textContent(t) { this.childNodes.forEach(c => { c.parentNode = null; }); this.childNodes = []; if (t) this.appendChild(this.ownerDocument.createTextNode(t)); }
}
class Text extends Node {
  constructor(doc, v, type) { super(doc); this.nodeType = type || 3; this.nodeValue = v; }
  splitText(at) {
    const rest = new Text(this.ownerDocument, this.nodeValue.slice(at), this.nodeType);
    this.nodeValue = this.nodeValue.slice(0, at);
    if (this.parentNode) { const p = this.parentNode; p.insertBefore(rest, p.childNodes[p.childNodes.indexOf(this) + 1] || null); }
    return rest;
  }
}
class Element extends Node {
  constructor(doc, tag, ns) { super(doc); this.nodeType = 1; this.tagName = tag.toUpperCase(); this.localName = tag.toLowerCase(); this.namespaceURI = ns || HTML_NS; this.attributes = []; }
  get nodeName() { return this.tagName; }
  getAttribute(k) { const a = this.attributes.find(x => x.name === k); return a ? a.value : null; }
  setAttribute(k, v) { const a = this.attributes.find(x => x.name === k); if (a) a.value = String(v); else this.attributes.push({ name: k, value: String(v) }); }
  removeAttribute(k) { const i = this.attributes.findIndex(x => x.name === k); if (i >= 0) this.attributes.splice(i, 1); }
  set className(v) { this.setAttribute('class', v); }
  get className() { return this.getAttribute('class') || ''; }
  get innerHTML() { return this.childNodes.map(c => serialize(c, this)).join(''); }
}

function serialize(n, parent) {
  if (n.nodeType === 3) return RAW_OUT.test(parent.localName) ? n.nodeValue : n.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
  if (n.nodeType === 8) return '<!--' + n.nodeValue + '-->';
  const open = '<' + n.localName + n.attributes.map(a => ' ' + a.name + '="' + a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;') + '"').join('') + '>';
  return VOID.test(n.localName) ? open : open + n.innerHTML + '</' + n.localName + '>';
}

function all(root) { const out = []; (function walk(n) { n.childNodes.forEach(c => { if (c.nodeType === 1) { out.push(c); walk(c); } }); })(root); return out; }

class Document {
  constructor() { this.body = new Element(this, 'body'); }
  createElement(tag) { return new Element(this, tag); }
  createTextNode(t) { return new Text(this, String(t)); }
  createDocumentFragment() { const f = new Node(this); f.nodeType = 11; return f; }
  importNode(n, deep) {
    let c;
    if (n.nodeType === 1) { c = new Element(this, n.localName, n.namespaceURI); n.attributes.forEach(a => c.attributes.push({ name: a.name, value: a.value })); }
    else c = new Text(this, n.nodeValue, n.nodeType);
    if (deep) n.childNodes.forEach(k => c.appendChild(this.importNode(k, true)));
    return c;
  }
  querySelectorAll(sel) {
    const names = sel === '*' ? null : sel.split(',').map(s => s.trim().toLowerCase());
    return all(this.body).filter(e => !names || names.includes(e.localName));
  }
}

// Start tags follow the HTML tokenizer: names end at space, "/" or ">", values are "..", '..' or bare
function readTag(html, i) {
  const ws = /[\t\n\f\r ]/;
  let j = i + 1, name = '';
  while (j < html.length && !ws.test(html[j]) && html[j] !== '/' && html[j] !== '>') name += html[j++];
  const attrs = [];
  for (;;) {
    while (j < html.length && (ws.test(html[j]) || html[j] === '/')) j++;
    if (j >= html.length) return null;
    if (html[j] === '>') return { name, attrs, end: j + 1 };
    let k = html[j++];
    while (j < html.length && !ws.test(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') k += html[j++];
    while (j < html.length && ws.test(html[j])) j++;
    let v = '';
    if (html[j] === '=') {
      j++;
      while (j < html.length && ws.test(html[j])) j++;
      const q = html[j];
      if (q === '"' || q === "'") { const e = html.indexOf(q, j + 1); if (e < 0) return null; v = html.slice(j + 1, e); j = e + 1; }
      else while (j < html.length && !ws.test(html[j]) && html[j] !== '>') v += html[j++];
    }
    k = k.toLowerCase();
    if (!attrs.some(x => x.name === k)) attrs.push({ name: k, value: decode(v) });
  }
}

function parse(html) {
  const doc = new Document();
  let cur = doc.body, i = 0, text = '';
  const flush = () => { if (text) { cur.appendChild(doc.createTextNode(decode(text))); text = ''; } };
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      flush();
      const e = html.indexOf('-->', i + 4);
      cur.appendChild(new Text(doc, html.slice(i + 4, e < 0 ? html.length : e), 8));
      i = e < 0 ? html.length : e + 3; continue;
    }
    const close = /^<\/([a-zA-Z][^\t\n\f\r \/>]*)[^>]*>/.exec(html.slice(i, i + 200));
    if (close) {
      flush();
      const name = close[1].toLowerCase();
      for (let n = cur; n !== doc.body; n = n.parentNode) if (n.localName === name) { cur = n.parentNode; break; }
      i += close[0].length; continue;
    }
    const t = html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] || '') ? readTag(html, i) : null;
    if (!t) { text += html[i++]; continue; }
    flush();
    i = t.end;
    const tag = t.name.toLowerCase();
    const ns = tag === 'svg' ? SVG_NS : tag === 'math' ? MATH_NS : cur === doc.body ? HTML_NS : cur.namespaceURI;
    const el = new Element(doc, tag, ns);
    el.attributes = t.attrs;
    cur.appendChild(el);
    if (VOID.test(tag)) continue;
    if (RAW.test(tag) && ns === HTML_NS) {
      const end = html.toLowerCase().indexOf('</' + tag, i);
      const body = html.slice(i, end < 0 ? html.length : end);
      if (body) el.appendChild(doc.createTextNode(/^(textarea|title)$/.test(tag) ? decode(body) : body));
      i = end < 0 ? html.length : (html.indexOf('>', end) + 1 || html.length);
      continue;
    }
    cur = el;
  }
  flush();
  return doc;
}

function treeParser() { return { parseFromString: html => parse(String(html)) }; }

// Every element in a serialized page, as the page would parse it
function elementsOf(html) { return all(parse(String(html)).body); }

module.exports = { treeParser, elementsOf };
