// parse.js — a dependency-free CommonMark 0.31.2 + GFM renderer.
// parse(markdown) returns exactly the HTML that marked 18.1.3 returns with
// its default options (GFM on, breaks off), for every input string.
// Written from scratch against the CommonMark / GFM specs and the observed
// behaviour of the reference renderer; no third-party code is vendored.

const SP = 32, TAB = 9, NL = 10, CR = 13;
const AMP = 38, LT = 60, GT = 62, QUOT = 34, APOS = 39;
const BACKSLASH = 92, BACKTICK = 96, STAR = 42, UNDER = 95, TILDE = 126;
const LBRACK = 91, RBRACK = 93, BANG = 33, LANGLE = 60, RANGLE = 62;

// ---------- character helpers ----------
function isSpaceCode(c) { return c === SP || c === TAB || c === NL || c === CR; }
function isAsciiPunct(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
function isDigit(c) { return c >= 48 && c <= 57; }
function isAlpha(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function isAlnum(c) { return isAlpha(c) || isDigit(c); }
function isWordChar(c) { return isAlnum(c) || c === UNDER; }

// ---------- HTML escaping ----------
// marked's character-reference rules (from its unescape):
//   &#1-7 decimal digits; | &#[Xx]1-6 hex digits; | &\w+;
// A numeric reference decodes to the code point (0, >0x10FFFF and
// surrogates become U+FFFD; 38 becomes &amp;). A named-like run passes
// through unchanged. A bare & that is not part of such a run is &amp;.

// If s[i] === '&' starts a valid entity-like run, return the index just
// past its ';', else 0.
function entityRunEnd(s, i) {
  const n = s.length;
  if (i + 1 >= n) return 0;
  if (s.charCodeAt(i + 1) === 35) {
    let j = i + 2;
    let hex = false;
    if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; }
    const dstart = j;
    if (hex) {
      while (j < n && isHex(s.charCodeAt(j))) j++;
      if (j - dstart < 1 || j - dstart > 6) return 0;
    } else {
      while (j < n && isDigit(s.charCodeAt(j))) j++;
      if (j - dstart < 1 || j - dstart > 7) return 0;
    }
    if (j >= n || s.charCodeAt(j) !== 59) return 0;
    return j + 1;
  }
  let j = i + 1;
  while (j < n) {
    const d = s.charCodeAt(j);
    if (isAlnum(d) || d === UNDER) j++;
    else break;
  }
  if (j > i + 1 && j < n && s.charCodeAt(j) === 59) return j + 1;
  return 0;
}
function isHex(c) {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}
function hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  return c - 55;
}

// Decode a numeric reference at s[start] (validated by entityRunEnd).
// Returns [replacement, endIndex] or null when it is not numeric.
function decodeNumericEntity(s, start, end) {
  if (s.charCodeAt(start + 1) !== 35) return null;
  let i = start + 2;
  let hex = false;
  if (s.charCodeAt(i) === 120 || s.charCodeAt(i) === 88) { hex = true; i++; }
  let cp = 0;
  if (hex) {
    while (i < end - 1) { cp = cp * 16 + hexVal(s.charCodeAt(i)); i++; }
  } else {
    while (i < end - 1) { cp = cp * 10 + (s.charCodeAt(i) - 48); i++; }
  }
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return ['\uFFFD', end];
  if (cp === 38) return ['&amp;', end];
  if (cp === 34) return ['&quot;', end];
  if (cp === 39) return ['&#39;', end];
  if (cp === 60) return ['&lt;', end];
  if (cp === 62) return ['&gt;', end];
  return [String.fromCodePoint(cp), end];
}

// Escape plain text: numeric references decode, named-like runs pass
// through, bare & becomes &amp;, and < > " ' are escaped.
function escapeText(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  let runStart = 0;
  for (i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === AMP) {
      const end = entityRunEnd(s, i);
      if (end > 0) {
        if (s.charCodeAt(i + 1) === 35) {
          const dec = decodeNumericEntity(s, i, end);
          out += s.slice(runStart, i) + dec[0];
        } else {
          out += s.slice(runStart, end);
        }
        i = end - 1;
        runStart = end;
        continue;
      }
      out += s.slice(runStart, i) + '&amp;';
      runStart = i + 1;
    } else if (c === LT) {
      out += s.slice(runStart, i) + '&lt;';
      runStart = i + 1;
    } else if (c === GT) {
      out += s.slice(runStart, i) + '&gt;';
      runStart = i + 1;
    } else if (c === QUOT) {
      out += s.slice(runStart, i) + '&quot;';
      runStart = i + 1;
    } else if (c === APOS) {
      out += s.slice(runStart, i) + '&#39;';
      runStart = i + 1;
    }
  }
  out += s.slice(runStart, n);
  return out;
}

// Escape for code spans / code blocks: & < > " ' all escaped, no entity
// pass-through (marked escapes &copy; inside code).
function escapeCode(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  let runStart = 0;
  for (i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === AMP) { out += s.slice(runStart, i) + '&amp;'; runStart = i + 1; }
    else if (c === LT) { out += s.slice(runStart, i) + '&lt;'; runStart = i + 1; }
    else if (c === GT) { out += s.slice(runStart, i) + '&gt;'; runStart = i + 1; }
    else if (c === QUOT) { out += s.slice(runStart, i) + '&quot;'; runStart = i + 1; }
    else if (c === APOS) { out += s.slice(runStart, i) + '&#39;'; runStart = i + 1; }
  }
  out += s.slice(runStart, n);
  return out;
}

// Escape an attribute value (title, alt, fence language): entity-like
// runs pass through unchanged (no numeric decoding), bare & becomes
// &amp;, and < > " ' are escaped.
function escapeAttr(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  let runStart = 0;
  for (i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === AMP) {
      const end = entityRunEnd(s, i);
      if (end > 0) {
        out += s.slice(runStart, end);
        i = end - 1;
        runStart = end;
        continue;
      }
      out += s.slice(runStart, i) + '&amp;';
      runStart = i + 1;
    }
    else if (c === LT) { out += s.slice(runStart, i) + '&lt;'; runStart = i + 1; }
    else if (c === GT) { out += s.slice(runStart, i) + '&gt;'; runStart = i + 1; }
    else if (c === QUOT) { out += s.slice(runStart, i) + '&quot;'; runStart = i + 1; }
    else if (c === APOS) { out += s.slice(runStart, i) + '&#39;'; runStart = i + 1; }
  }
  out += s.slice(runStart, n);
  return out;
}

// Encode an href the way marked does: percent-encode like encodeURI
// (everything except alphanumerics and ; , / ? : @ & = + $ - _ . ! ~ * ' ( ) # %),
// then escape & (entity-aware) and ' for the attribute.
const URI_SAFE = new Set();
for (const ch of ';,/?:@&=+$-_.!~*()#%') URI_SAFE.add(ch.charCodeAt(0));
function encodeHref(href) {
  let out = '';
  let i = 0;
  const n = href.length;
  let runStart = 0;
  const HEX = '0123456789ABCDEF';
  for (i = 0; i < n; i++) {
    const c = href.charCodeAt(i);
    if (c === AMP) {
      const end = entityRunEnd(href, i);
      if (end > 0) {
        out += href.slice(runStart, end);
        i = end - 1;
        runStart = end;
        continue;
      }
      out += href.slice(runStart, i) + '&amp;';
      runStart = i + 1;
    } else if (c === APOS) {
      out += href.slice(runStart, i) + '&#39;';
      runStart = i + 1;
    } else if (c < 128 && !isAlnum(c) && !URI_SAFE.has(c)) {
      out += href.slice(runStart, i) + '%' + HEX[(c >> 4) & 15] + HEX[c & 15];
      runStart = i + 1;
    } else if (c >= 128) {
      const ch = href.codePointAt(i);
      const bytes = [];
      if (ch < 0x800) bytes.push(0xc0 | (ch >> 6), 0x80 | (ch & 63));
      else if (ch < 0x10000) bytes.push(0xe0 | (ch >> 12), 0x80 | ((ch >> 6) & 63), 0x80 | (ch & 63));
      else bytes.push(0xf0 | (ch >> 18), 0x80 | ((ch >> 12) & 63), 0x80 | ((ch >> 6) & 63), 0x80 | (ch & 63));
      out += href.slice(runStart, i) + bytes.map(b => '%' + HEX[(b >> 4) & 15] + HEX[b & 15]).join('');
      if (ch > 0xffff) i++;
      runStart = i + 1;
    }
  }
  out += href.slice(runStart, n);
  return out;
}

// ---------- link reference definitions ----------
// Normalise a link label: trim, collapse internal whitespace to one
// space, Unicode case fold (toLowerCase is close enough for the corpus).
function normalizeLabel(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  let pendingSpace = false;
  let started = false;
  for (i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    // only bracket escapes resolve in a label (\] and \[); other
    // escapes (e.g. \!, \*) stay literal, so [foo\!] does not match [foo!]
    if (c === BACKSLASH && i + 1 < n && (s.charCodeAt(i + 1) === LBRACK || s.charCodeAt(i + 1) === RBRACK)) {
      if (pendingSpace) { out += ' '; pendingSpace = false; }
      out += s[i + 1];
      started = true;
      i++;
      continue;
    }
    if (c === SP || c === TAB || c === NL || c === CR) {
      if (started) pendingSpace = true;
    } else {
      if (pendingSpace) { out += ' '; pendingSpace = false; }
      out += s[i];
      started = true;
    }
  }
  // Unicode case folding: lower->upper->lower folds ß/ẞ to "ss"
  // (and ligatures to their letters), matching marked's normalisation
  return out.toLowerCase().toUpperCase().toLowerCase();
}

// Scan a link label starting at s[i] === '['. Returns [labelText, endIndex]
// where endIndex is just past the closing ']', or null.
function scanLabel(s, i) {
  // s[i] === '['; a label ends at the first unescaped ']' — nested
  // brackets are NOT tracked, so [ref[bar]] yields label "ref[bar".
  // A label containing an unescaped '[' is invalid (cm-546: [ref[]).
  let j = i + 1;
  const n = s.length;
  let start = j;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === BACKSLASH && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
      j += 2;
      continue;
    }
    if (c === LBRACK) return null;
    if (c === RBRACK) {
      const content = s.slice(start, j);
      if (content.length > 999) return null;
      return [content, j + 1];
    }
    j++;
  }
  return null;
}

// Skip spaces/tabs/newlines from i. Returns new index.
function skipWsNl(s, i) {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === SP || c === TAB || c === NL || c === CR) i++;
    else break;
  }
  return i;
}
// Skip spaces/tabs only.
function skipWs(s, i) {
  while (i < s.length && (s.charCodeAt(i) === SP || s.charCodeAt(i) === TAB)) i++;
  return i;
}

// Parse a link destination starting at i. Returns [dest, endIndex] or null.
// Handles <...> and bare destinations (balanced parens, backslash escapes).
function parseDest(s, i) {
  const n = s.length;
  if (i >= n) return null;
  if (s.charCodeAt(i) === LT) {
    let j = i + 1;
    let dest = '';
    let run = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === GT) {
        dest += s.slice(run, j);
        return [dest, j + 1];
      }
      if (c === LT || c === NL || c === CR) return null;
      if (c === BACKSLASH && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
        dest += s.slice(run, j) + s[j + 1];
        j += 2;
        run = j;
        continue;
      }
      j++;
    }
    return null;
  }
  // bare destination: no spaces, parens balanced, no control chars
  let j = i;
  let depth = 0;
  let dest = '';
  let run = j;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === SP || c === TAB || c === NL || c === CR) break;
    if (c === 40) { depth++; j++; continue; } // (
    if (c === 41) { // )
      if (depth === 0) break;
      depth--;
      j++;
      continue;
    }
    if (c < 32 || c === 127) return null;
    if (c === BACKSLASH && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
      dest += s.slice(run, j) + s[j + 1];
      j += 2;
      run = j;
      continue;
    }
    j++;
  }
  if (depth !== 0) return null;
  dest += s.slice(run, j);
  if (dest.length === 0) return null;
  return [dest, j];
}

// Parse a link title starting at i. Quote is ", ' or (. Returns
// [title, endIndex] or null. Title may span lines; escaped punctuation
// and (for "..." / '...') the other quote chars are literal.
function parseTitle(s, i) {
  const n = s.length;
  if (i >= n) return null;
  const q = s.charCodeAt(i);
  let close;
  if (q === QUOT) close = QUOT;
  else if (q === APOS) close = APOS;
  else if (q === 40) close = 41; // ( ... )
  else return null;
  let j = i + 1;
  let title = '';
  let run = j;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === close) {
      title += s.slice(run, j);
      return [title, j + 1];
    }
    if (close === 41 && c === 40) return null; // unescaped ( inside (...)
    if (c === BACKSLASH && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
      title += s.slice(run, j) + s[j + 1];
      j += 2;
      run = j;
      continue;
    }
    j++;
  }
  return null;
}

// Try to parse one link reference definition at position i of s (s is a
// paragraph's joined text). Returns {end, label, dest, title} or null.
// end is the index of the newline ending the definition (or end of s).
function parseLinkRefDef(s, i) {
  const n = s.length;
  if (s.charCodeAt(i) !== LBRACK) return null;
  const lab = scanLabel(s, i);
  if (!lab) return null;
  const label = lab[0];
  // a label that normalises to empty (e.g. [] or [\n ]) is not a definition
  if (normalizeLabel(label) === '') return null;
  let j = lab[1];
  if (j >= n || s.charCodeAt(j) !== 58) return null; // ':'
  j++;
  j = skipWsNl(s, j);
  const dest = parseDest(s, j);
  if (!dest) return null;
  j = dest[1];
  let title = null;
  // optional title: same line, or (if the line ends here) the next line
  let k = skipWs(s, j);
  if (k < n) {
    const c = s.charCodeAt(k);
    if (c === QUOT || c === APOS || c === 40) {
      // a title must be separated from the destination by whitespace
      if (k === j) return null;
      const t = parseTitle(s, k);
      if (t) {
        const k2 = skipWs(s, t[1]);
        if (k2 >= n || s.charCodeAt(k2) === NL || s.charCodeAt(k2) === CR) {
          title = t[0];
          return { end: k2, label, dest: dest[0], title };
        }
      }
      // same-line title invalid, or junk follows it on the same line:
      // the whole definition fails (the line stays literal)
      return null;
    }
    if (c === NL || c === CR) {
      // line ends: maybe a title on the next line
      const m = skipWs(s, k + 1);
      if (m < n) {
        const c2 = s.charCodeAt(m);
        if (c2 === QUOT || c2 === APOS || c2 === 40) {
          const t = parseTitle(s, m);
          if (t) {
            const k2 = skipWs(s, t[1]);
            if (k2 >= n || s.charCodeAt(k2) === NL || s.charCodeAt(k2) === CR) {
              title = t[0];
              return { end: k2, label, dest: dest[0], title };
            }
          }
          // title invalid or junk after it: dest-only, and the
          // title line is left as paragraph text
          return { end: k, label, dest: dest[0], title: null };
        }
      }
      return { end: k, label, dest: dest[0], title: null };
    }
    return null; // junk on the same line after the destination
  }
  return { end: k, label, dest: dest[0], title: null };
}

// Parse leading link reference definitions out of a paragraph's text.
// Stores them in refs (first definition of a label wins) and returns the
// remaining paragraph text (possibly empty). Content lines keep their
// leading spaces exactly.
function stripLinkRefDefs(text, refs) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    // a definition may be indented up to 3 spaces
    let j = i;
    let indent = 0;
    while (j < n && s_isSpace(j) && indent < 3) { j++; indent++; }
    if (j >= n || text.charCodeAt(j) !== LBRACK) break;
    const def = parseLinkRefDef(text, j);
    if (!def) break;
    const norm = normalizeLabel(def.label);
    if (norm.length > 0 && !refs.has(norm)) {
      refs.set(norm, { dest: def.dest, title: def.title });
    }
    i = def.end;
    if (i >= n) { i = n; break; }
    // def.end is at the newline ending the definition; step past it
    if (text.charCodeAt(i) === NL) i++;
    else if (text.charCodeAt(i) === CR) i++;
    else break;
  }
  return text.slice(i);
  function s_isSpace(j) { const c = text.charCodeAt(j); return c === SP; }
}

// ---------- block parsing ----------
// Block node shapes (plain objects):
// doc:  {t:'doc', c:[]}
// bq:   {t:'bq', c:[]}
// list: {t:'list', bullet, delim, start, tight, c:[]}
// item: {t:'item', contentIndent, c:[], _lastBlank}
// para: {t:'para', lines:[]}
// head: {t:'head', level, text}
// code: {t:'code', fenced, info, lit}
// html: {t:'html', htype, lit}
// hr:   {t:'hr'}
// table:{t:'table', header:[], align:[], rows:[[]]}

const HTML_BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));

function parseBlocks(src, refs) {
  const lines = src.split('\n');
  // a trailing newline does not produce an extra empty line
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const srcEndsWithNl = src.endsWith('\n');
  const root = { t: 'doc', c: [] };
  const open = [root]; // stack of open blocks; open[0] is root
  let blankBeforeLine = false;
  let matchedUpTo = 0;
  let atEof = false; // true while the final close at end of input runs
  let lastHtml = null; // most recently extended html block
  let lastHtmlEnd = -1; // line index of its last content line
  let curLine = 0; // index of the line currently being processed
  let bqConsumed = false; // a '>' was consumed by container matching

  // line cursor state
  let line = '';
  let off = 0;      // char index into line
  let col = 0;      // column number
  let partial = 0;  // remaining width of a partially consumed tab (0 = none)

  function tip() { return open[open.length - 1]; }

  // Advance the cursor by n columns (may partially consume a tab).
  function advance(n) {
    let target = col + n;
    if (partial > 0) {
      if (n < partial) { partial -= n; col += n; return; }
      n -= partial; col += partial; partial = 0; off++;
      target = col + n;
    }
    while (col < target && off < line.length) {
      const c = line.charCodeAt(off);
      if (c === TAB) {
        const w = 4 - (col % 4);
        if (col + w > target) { partial = col + w - target; col = target; return; }
        off++; col += w;
      } else { off++; col++; }
    }
  }

  // The rest of the line from the cursor (partial tab expanded to spaces).
  function content() {
    if (partial > 0) return ' '.repeat(partial) + line.slice(off + 1);
    return line.slice(off);
  }
  // content of a code line: a leading tab expands to spaces (to the
  // next multiple of 4 from the current column)
  function codeContent() {
    if (partial > 0) return ' '.repeat(partial) + line.slice(off + 1);
    if (off < line.length && line.charCodeAt(off) === TAB) {
      return ' '.repeat(4 - (col % 4)) + line.slice(off + 1);
    }
    return line.slice(off);
  }

  // Indent (columns) and first-nonspace index from the cursor.
  function scanIndent() {
    let c = col, o = off, indent = 0;
    if (partial > 0) {
      indent = partial;
      o = off + 1;
      c = col + partial;
    }
    while (o < line.length) {
      const ch = line.charCodeAt(o);
      if (ch === SP) { indent++; c++; o++; }
      else if (ch === TAB) { const w = 4 - (c % 4); indent += w; c += w; o++; }
      else break;
    }
    return { indent, fns: o, blank: o >= line.length };
  }

  function addChild(parent, blk) {
    parent.c.push(blk);
    return blk;
  }

  // Finalise a block (called when it is closed). Returns true if the block
  // should stay in the tree, false if it must be removed (empty paragraph
  // consisting only of link reference definitions).
  function finalize(blk) {
    if (blk.t === 'para') {
      const text = blk.lines.join('\n');
      const rest = stripLinkRefDefs(text, refs);
      if (rest === '') return false;
      const tbl = tryTable(rest);
      if (tbl) {
        blk.t = 'table';
        blk.header = tbl.header; blk.align = tbl.align; blk.rows = tbl.rows;
        delete blk.lines;
      } else {
        blk.text = rest;
        delete blk.lines;
      }
      return true;
    }
    if (blk.t === 'html' && blk.htype >= 6 && !atEof) {
      // a type 6/7 html block's last line loses its trailing newline
      // unless the block runs to the end of the input
      if (blk.lit.endsWith('\n')) blk.lit = blk.lit.slice(0, -1);
    }
    if (blk.t === 'html' && atEof && !srcEndsWithNl) {
      // the source has no trailing newline, so the last line's '\n'
      // (added per line) is spurious — strip it
      if (blk.lit.endsWith('\n')) blk.lit = blk.lit.slice(0, -1);
    }
    if (blk.t === 'code' && blk.fenced) {
      // a fenced code block ending with a blank line loses exactly one
      // trailing newline (b\n\n -> b\n, b\n\n\n -> b\n\n); a block whose
      // only content is blank lines loses one too (\n -> empty)
      if (blk.lit.endsWith('\n\n') || blk.lit === '\n') blk.lit = blk.lit.slice(0, -1);
      return true;
    }
    if (blk.t === 'code' && !blk.fenced) {
      // strip trailing blank lines (each is a lone '\n' past the last)
      let lit = blk.lit;
      while (lit.length >= 2 && lit.endsWith('\n\n')) lit = lit.slice(0, -1);
      blk.lit = lit;
      return true;
    }
    if (blk.t === 'list') {
      let tight = true;
      for (let i = 0; i < blk.c.length; i++) {
        const item = blk.c[i];
        if (item._lastBlank && i + 1 < blk.c.length) { tight = false; break; }
        // an item whose own flag is set and which holds two or more
        // blocks had a blank line between those blocks (cm-324)
        if (item._lastBlank && item.c.length > 1) { tight = false; break; }
        for (let j = 0; j < item.c.length; j++) {
          const sub = item.c[j];
          if (sub._lastBlank && j + 1 < item.c.length) { tight = false; break; }
        }
        if (!tight) break;
      }
      blk.tight = tight;
      return true;
    }
    return true;
  }

  // Close open blocks from index `from` upward (deepest first), removing
  // any that finalise to nothing.
  function closeBlocks(from) {
    for (let i = open.length - 1; i >= from; i--) {
      const blk = open[i];
      const keep = finalize(blk);
      if (!keep) {
        // remove from its parent's children
        const parent = open[i - 1];
        const idx = parent.c.indexOf(blk);
        if (idx >= 0) parent.c.splice(idx, 1);
        // a stripped def-only paragraph was invisible: if a blank line
        // preceded it, the blank still separates the surrounding blocks
        if (blk.t === 'para' && blk._precededByBlank) parent._lastBlank = true;
      }
    }
    open.length = from;
  }

  function closeParagraph() {
    if (tip().t === 'para') closeBlocks(open.length - 1);
  }

  // ----- main line loop -----
  for (let li = 0; li < lines.length; li++) {
    line = lines[li];
    curLine = li;
    off = 0; col = 0; partial = 0;
    bqConsumed = false;

    // 1. container matching: walk down the open chain
    let i = 1;
    let allMatched = true;
    matchedUpTo = 0;
    while (i < open.length) {
      const blk = open[i];
      if (blk.t === 'bq') {
        const inf = scanIndent();
        if (inf.indent <= 3 && !inf.blank && line.charCodeAt(inf.fns) === GT) {
          advance(inf.indent);
          advance(1); // past '>'
          bqConsumed = true;
          if (off < line.length) {
            const c = line.charCodeAt(off);
            if (c === SP || c === TAB) advance(1); // one optional space
          }
          matchedUpTo = i;
          i++;
          continue;
        }
        allMatched = false;
        break;
      }
      if (blk.t === 'item') {
        const inf = scanIndent();
        if (inf.blank) {
          advance(inf.indent);
          matchedUpTo = i;
          i++;
          continue;
        }
        // an empty item that just had a blank line is closed: following
        // indented lines belong outside the list (cm-280)
        if (blk.c.length === 0 && blk._lastBlank) {
          allMatched = false;
          break;
        }
        if (inf.indent >= blk.contentIndent) {
          advance(blk.contentIndent);
          matchedUpTo = i;
          i++;
          continue;
        }
        allMatched = false;
        break;
      }
      // 'list' and anything else always matches
      i++;
    }
    // A tab at the cursor after container matching expands to spaces
    // (to the next multiple of 4) when the line is inside a container
    // (blockquote or list item); at the top level it stays a tab.
    if (allMatched && partial === 0 && off < line.length && line.charCodeAt(off) === TAB) {
      let hasContainer = false;
      for (let k = 0; k < open.length; k++) {
        const t = open[k].t;
        if (t === 'bq' || t === 'list' || t === 'item') { hasContainer = true; break; }
      }
      if (hasContainer) partial = 4 - (col % 4);
    }
    if (!allMatched) {
      // lazy continuation: a non-blank line that does not start a new
      // block is added to the open paragraph, inside its containers
      const infL = scanIndent();
      if (!infL.blank && tip().t === 'para' && !startsInterruptBlock(infL)) {
        for (let k = 0; k < open.length; k++) open[k]._lastBlank = false;
        const para = tip();
        // a lazy line that looks like a setext underline is added with
        // 4 spaces prepended (so it can never be read as an underline),
        // but only when the paragraph sits inside a blockquote and its
        // last line was itself a lazy continuation; otherwise it is
        // added verbatim
        const stripped = line.slice(infL.fns);
        let setextShape = false;
        if (stripped.length > 0) {
          const c0 = stripped.charCodeAt(0);
          if (c0 === 61 || c0 === 45) {
            let k = 0;
            while (k < stripped.length && stripped.charCodeAt(k) === c0) k++;
            let ok = k > 0;
            while (ok && k < stripped.length) {
              const cc = stripped.charCodeAt(k);
              if (cc !== SP && cc !== TAB) ok = false;
              k++;
            }
            setextShape = ok;
          }
        }
        let lazyContent;
        if (setextShape) {
          let inBq = false;
          for (let k = 0; k < open.length; k++) if (open[k].t === 'bq') { inBq = true; break; }
          if (infL.indent < 4 && inBq && para._lastLazy) lazyContent = '    ' + stripped;
          else lazyContent = content();
        } else if (infL.indent >= 4) {
          // an indented lazy line loses 4 columns
          advance(4);
          lazyContent = content();
        } else {
          lazyContent = content();
        }
        para.lines.push(lazyContent);
        para._lastLazy = true;
        continue;
      }
      closeBlocks(i);
    }

    // A non-blank line clears _lastBlank on every open block, EXCEPT a
    // list or an item: a blank line inside an item/list must survive
    // until finalize, because the following line always starts a new
    // block (or a new item) — the blank separates two blocks, so the
    // list is loose. A list's _lastBlank is cleared when a new item is
    // added to it; an item's flag is consumed by finalize.
    blankBeforeLine = tip()._lastBlank;
    const inf0 = scanIndent();
    if (!inf0.blank) {
      for (let k = 0; k < open.length; k++) {
        if (open[k].t !== 'list' && open[k].t !== 'item') open[k]._lastBlank = false;
      }
    }

    // 2. fenced code block: check for closing fence, else add the line
    let tp = tip();
    if (tp.t === 'code' && tp.fenced) {
      const inf = scanIndent();
      if (!inf.blank && inf.indent <= 3) {
        const rest = line.slice(inf.fns);
        let m = 0;
        while (m < rest.length && rest.charCodeAt(m) === tp.fenceChar) m++;
        if (m >= tp.fenceLen) {
          let ok = true;
          for (let q = m; q < rest.length; q++) {
            const cc = rest.charCodeAt(q);
            if (cc !== SP && cc !== TAB) { ok = false; break; }
          }
          if (ok) { closeBlocks(open.length - 1); continue; }
        }
      }
      // a fenced code line loses up to the opening fence's indentation
      if (tp.fenceIndent > 0) {
        const infC = scanIndent();
        if (infC.indent > 0) advance(Math.min(tp.fenceIndent, infC.indent));
      }
      tp.lit += content() + '\n';
      continue;
    }

    // 3. indented code block: blank or indented lines are content
    if (tp.t === 'code' && !tp.fenced) {
      const inf = scanIndent();
      if (inf.blank) {
        // a blank line inside indented code keeps the spaces past the
        // 4-column indent (e.g. a 6-space line contributes '  ')
        advance(4);
        tp.lit += content() + '\n';
        continue;
      }
      if (inf.indent >= 4) {
        advance(4);
        tp.lit += content() + '\n';
        continue;
      }
      closeBlocks(open.length - 1);
      tp = tip();
    }

    // 4. html block: check end conditions, else add the line
    if (tp.t === 'html') {
      const ht = tp.htype;
      let ended = false;
      if (ht >= 6) {
        // types 6 and 7 end at a blank line
        ended = inf0.blank;
      } else {
        ended = htmlEndsOnLine(ht, tp.endTag);
      }
      if (ended) {
        if (ht >= 6) {
          // the blank line ends the block and is not part of it
          closeBlocks(open.length - 1);
          handleBlank();
          continue;
        }
        tp.lit += content() + '\n';
        lastHtml = tp; lastHtmlEnd = curLine;
        closeBlocks(open.length - 1);
        continue;
      }
      tp.lit += content() + '\n';
      lastHtml = tp; lastHtmlEnd = curLine;
      continue;
    }

    // 5. blank line
    if (inf0.blank) {
      // a whitespace-only line is still paragraph content (not blank)
      // when it is the last line and either the input has no trailing
      // newline, or a blockquote marker was consumed (the spaces after
      // '>' are content); otherwise it ends the paragraph
      const lastLine = curLine === lines.length - 1;
      const hasContent = line.length - off > 0;
      if (lastLine && hasContent && (!srcEndsWithNl || bqConsumed)) {
        // the spaces become a paragraph line (leafChecks would return
        // early on a blank line, so add it directly)
        if (tip().t === 'para') {
          tip().lines.push(content());
          tip()._lastLazy = false;
        }
        continue;
      }
      // a type 1-5 html block whose last line is the line just before
      // this blank line loses its trailing newline
      if (lastHtml && lastHtml.htype < 6 && lastHtmlEnd === curLine - 1) {
        lastHtml._stripNl = true;
      }
      handleBlank();
      continue;
    }

    // 6. leaf block starts
    leafChecks(inf0);
    // any non-blank line consumes a pending list-internal blank, so it
    // cannot leak to a much later new item in an ancestor list
    for (let k = 0; k < open.length; k++) open[k]._blankInList = false;
  }

  // end of input: close everything
  atEof = true;
  closeBlocks(1);
  return root;

  // ----- blank line handling -----
  function handleBlank() {
    // a blank line sets _lastBlank on the innermost container it sits
    // in and its descendants, and on every open list (a list's flag
    // must survive for the loose check in finalize). A blank line
    // inside a blockquote stays contained there (cm-320). Whether it
    // loosens an OUTER list is decided when the next item/block starts:
    // _blankInList records that this blank sat inside a list/item.
    const start = Math.min(matchedUpTo, open.length - 1);
    for (let k = start; k < open.length; k++) open[k]._lastBlank = true;
    for (let k = 0; k < open.length; k++) {
      if (open[k].t === 'list') {
        open[k]._lastBlank = true;
        if (open[start].t === 'item') open[k]._blankInList = true;
      }
    }
    const tp = tip();
    if (tp.t === 'para') closeBlocks(open.length - 1);
    else if (tp.t === 'html' && tp.htype >= 6) closeBlocks(open.length - 1);
  }

  // Close an open list at the tip: a new block that is not a list item
  // of the same list never nests inside the list.
  function closeOpenList() {
    if (tip().t === 'list') closeBlocks(open.length - 1);
  }

  // ----- leaf block starts (line is not blank, tip is not code/html) -----
  function leafChecks(inf0) {
    if (inf0.blank) return;
    const tp = tip();
    const indent = inf0.indent;
    const rest = line.slice(inf0.fns);

    // --- blockquote start (a container: re-process the rest of the line) ---
    if (indent < 4 && rest.charCodeAt(0) === GT) {
      closeParagraph();
      closeOpenList();
      advance(indent);
      advance(1); // past '>'
      if (off < line.length) {
        const c = line.charCodeAt(off);
        if (c === SP || c === TAB) advance(1);
      }
      const blk = { t: 'bq', c: [] };
      addChild(tip(), blk);
      open.push(blk);
      const inf2 = scanIndent();
      if (inf2.blank) { handleBlank(); return; }
      leafChecks(inf2);
      return;
    }

    // --- ATX heading ---
    if (indent < 4) {
      let m = 0;
      while (m < rest.length && rest.charCodeAt(m) === 35) m++;
      if (m >= 1 && m <= 6 && (m >= rest.length || rest.charCodeAt(m) === SP || rest.charCodeAt(m) === TAB)) {
        let s = rest.slice(m);
        let b = s.length;
        while (b > 0 && (s.charCodeAt(b - 1) === SP || s.charCodeAt(b - 1) === TAB)) b--;
        s = s.slice(0, b);
        let k = s.length;
        while (k > 0 && s.charCodeAt(k - 1) === 35) k--;
        if (k < s.length && k > 0 && (s.charCodeAt(k - 1) === SP || s.charCodeAt(k - 1) === TAB)) {
          s = s.slice(0, k);
          let b2 = s.length;
          while (b2 > 0 && (s.charCodeAt(b2 - 1) === SP || s.charCodeAt(b2 - 1) === TAB)) b2--;
          s = s.slice(0, b2);
        }
        let a = 0;
        while (a < s.length && (s.charCodeAt(a) === SP || s.charCodeAt(a) === TAB)) a++;
        s = s.slice(a);
        closeParagraph();
        closeOpenList();
        addChild(tip(), { t: 'head', level: m, text: s });
        return;
      }
    }

    // --- fenced code ---
    if (indent < 4) {
      const fc = rest.charCodeAt(0);
      if (fc === BACKTICK || fc === TILDE) {
        let m = 0;
        while (m < rest.length && rest.charCodeAt(m) === fc) m++;
        if (m >= 3) {
          let info = rest.slice(m);
          if (!(fc === BACKTICK && info.indexOf('`') >= 0)) {
            // backslash escapes in the info string are resolved
            if (info.indexOf('\\') >= 0) {
              let unesc = '';
              for (let q = 0; q < info.length; q++) {
                if (info.charCodeAt(q) === BACKSLASH && q + 1 < info.length &&
                  isAsciiPunct(info.charCodeAt(q + 1))) {
                  unesc += info[q + 1];
                  q++;
                } else unesc += info[q];
              }
              info = unesc;
            }
            let a = 0;
            while (a < info.length && (info.charCodeAt(a) === SP || info.charCodeAt(a) === TAB)) a++;
            let b = info.length;
            while (b > a && (info.charCodeAt(b - 1) === SP || info.charCodeAt(b - 1) === TAB)) b--;
            info = info.slice(a, b);
            closeParagraph();
            closeOpenList();
            const blk = { t: 'code', fenced: true, info, lit: '', fenceChar: fc, fenceLen: m, fenceIndent: indent };
            addChild(tip(), blk);
            open.push(blk);
            return;
          }
        }
      }
    }

    // --- html block ---
    if (indent < 4) {
      const hb = matchHtmlBlockStart(rest, tp.t === 'para');
      if (hb) {
        closeParagraph();
        closeOpenList();
        const blk = { t: 'html', htype: hb.htype, endTag: hb.endTag || '', lit: content() + '\n' };
        addChild(tip(), blk);
        open.push(blk);
        lastHtml = blk; lastHtmlEnd = curLine;
        // a type 1-5 block can end on its very first line
        if (hb.htype < 6 && htmlEndsOnLine(hb.htype, blk.endTag)) {
          closeBlocks(open.length - 1);
        }
        return;
      }
    }

    // --- setext heading (only when a paragraph is open) ---
    if (tp.t === 'para' && indent < 4) {
      const c0 = rest.charCodeAt(0);
      if (c0 === 61 || c0 === 45) {
        // the underline is a run of = or - followed only by spaces/tabs
        let k = 0;
        while (k < rest.length && rest.charCodeAt(k) === c0) k++;
        let ok = k > 0;
        while (ok && k < rest.length) {
          const cc = rest.charCodeAt(k);
          if (cc !== SP && cc !== TAB) ok = false;
          k++;
        }
        if (ok) {
          const text = tp.lines.join('\n');
          let contentText = stripLinkRefDefs(text, refs);
          // a setext heading's content has its leading and trailing
          // whitespace stripped
          let a = 0;
          while (a < contentText.length && isSpaceCode(contentText.charCodeAt(a))) a++;
          let b = contentText.length;
          while (b > a && isSpaceCode(contentText.charCodeAt(b - 1))) b--;
          contentText = contentText.slice(a, b);
          // a paragraph that is only link reference definitions cannot
          // become a setext heading (nothing is left for the content)
          if (contentText.length === 0) {
            // fall through: the line joins the paragraph as text
          } else {
            tp.t = 'head';
            tp.level = c0 === 61 ? 1 : 2;
            tp.text = contentText;
            delete tp.lines;
            closeBlocks(open.length - 1);
            return;
          }
        }
      }
    }

    // --- thematic break ---
    if (indent < 4) {
      const c = rest.charCodeAt(0);
      if (c === STAR || c === 45 || c === UNDER) {
        let count = 0;
        let ok = true;
        for (let q = 0; q < rest.length; q++) {
          const cc = rest.charCodeAt(q);
          if (cc === c) count++;
          else if (cc === SP || cc === TAB) continue;
          else { ok = false; break; }
        }
        if (ok && count >= 3) {
          closeParagraph();
          closeOpenList();
          addChild(tip(), { t: 'hr' });
          return;
        }
      }
    }

    // --- list item ---
    if (indent < 4) {
      const li = matchListItem(rest, indent);
      if (li) {
        // a list item interrupts a paragraph when it is a bullet list,
        // an ordered list starting with 1, or the paragraph sits inside
        // a list item (any start number then interrupts, e.g. 505791.)
        let inList = false;
        for (let k = 0; k < open.length; k++) {
          if (open[k].t === 'list' || open[k].t === 'item') { inList = true; break; }
        }
        const canInterrupt = tp.t !== 'para' || (!li.empty && (li.bullet || li.start === 1 || inList));
        if (canInterrupt) {
          closeParagraph();
          let parent = tip();
          let list = null;
          if (parent.t === 'list' && parent.bullet === li.bullet && parent.delim === li.delim) {
            list = parent;
            // a blank line inside a nested list, followed by this new
            // item, separates the previous item from this one (cm-326)
            if (list._blankInList && list.c.length > 0) {
              list.c[list.c.length - 1]._lastBlank = true;
            }
            list._lastBlank = false; // the list continues with a new item
          } else {
            if (parent.t === 'list') closeBlocks(open.length - 1);
            parent = tip();
            list = { t: 'list', bullet: li.bullet, delim: li.delim, start: li.start, tight: true, c: [] };
            addChild(parent, list);
            open.push(list);
          }
          const item = { t: 'item', contentIndent: li.contentIndent, c: [], _lastBlank: false };
          addChild(list, item);
          open.push(item);
          // a new item consumes a pending list-internal blank: the blank
          // was followed by content inside this list, so it does not
          // separate items of any ancestor list
          for (let k = 0; k < open.length; k++) open[k]._blankInList = false;
          if (!li.empty) {
            advance(li.advanceCols);
            const inf2 = scanIndent();
            if (inf2.blank) { handleBlank(); return; }
            leafChecks(inf2);
          }
          return;
        }
      }
    }

    // --- indented code (cannot interrupt a paragraph) ---
    if (tp.t !== 'para' && indent >= 4) {
      closeOpenList();
      advance(4);
      const blk = { t: 'code', fenced: false, info: '', lit: content() + '\n' };
      addChild(tip(), blk);
      open.push(blk);
      return;
    }

    // --- paragraph (start or continue) ---
    closeOpenList();
    if (tp.t === 'para') {
      tp.lines.push(content());
      tp._lastLazy = false;
    } else {
      const blk = { t: 'para', lines: [content()], _lastLazy: false, _precededByBlank: blankBeforeLine };
      addChild(tip(), blk);
      open.push(blk);
    }
    // content inside an item consumes a pending list-internal blank
    // (the blank stays contained in that item, e.g. cm-307/319)
    for (let k = 0; k < open.length; k++) open[k]._blankInList = false;
  }

  // Does the line (at the current cursor) start a block that can
  // interrupt a paragraph? Used for lazy continuation.
  function startsInterruptBlock(inf) {
    if (inf.indent >= 4) return false;
    const rest = line.slice(inf.fns);
    if (rest.length === 0) return false;
    const c0 = rest.charCodeAt(0);
    if (c0 === GT) return true;
    let m = 0;
    while (m < rest.length && rest.charCodeAt(m) === 35) m++;
    if (m >= 1 && m <= 6 && (m >= rest.length || rest.charCodeAt(m) === SP || rest.charCodeAt(m) === TAB)) return true;
    if (c0 === BACKTICK || c0 === TILDE) {
      let f = 0;
      while (f < rest.length && rest.charCodeAt(f) === c0) f++;
      if (f >= 3 && !(c0 === BACKTICK && rest.slice(f).indexOf('`') >= 0)) return true;
    }
    if (c0 === LT && matchHtmlBlockStart(rest, true)) return true;
    if (c0 === STAR || c0 === 45 || c0 === UNDER) {
      let count = 0, ok = true;
      for (let q = 0; q < rest.length; q++) {
        const cc = rest.charCodeAt(q);
        if (cc === c0) count++;
        else if (cc === SP || cc === TAB) continue;
        else { ok = false; break; }
      }
      if (ok && count >= 3) return true;
    }
    const li = matchListItem(rest, inf.indent);
    if (li && !li.empty && (li.bullet || li.start === 1)) return true;
    if (li) {
      // inside a list item, any new list item line ends the current
      // item (even an ordered list not starting with 1, and even of
      // another type, and even an empty item) — the paragraph does not
      // lazily continue
      for (let k = 0; k < open.length; k++) {
        if (open[k].t === 'list') return true;
      }
    }
    return false;
  }

  // Match a list item marker at the start of `rest` (which begins at the
  // first nonspace char, `indent` columns from the cursor). Returns
  // {bullet, delim, start, empty, contentIndent, advanceCols} or null.
  // advanceCols is how many columns to advance from the cursor (which is
  // at the container content start) to reach the item's content.
  function matchListItem(rest, indent) {
    let bullet = false, delim = '', start = 1, markerLen = 0;
    const c0 = rest.charCodeAt(0);
    if (c0 === 45 || c0 === 43 || c0 === STAR) {
      bullet = true; delim = String.fromCharCode(c0); markerLen = 1;
    } else if (isDigit(c0)) {
      let q = 0;
      let num = 0;
      while (q < rest.length && isDigit(rest.charCodeAt(q)) && q < 9) {
        num = num * 10 + (rest.charCodeAt(q) - 48);
        q++;
      }
      if (q >= 1 && q <= 9 && q < rest.length && (rest.charCodeAt(q) === 46 || rest.charCodeAt(q) === 41)) {
        bullet = false; delim = String.fromCharCode(rest.charCodeAt(q));
        start = num; markerLen = q + 1;
      } else return null;
    } else return null;
    // after the marker: space/tab or end of line
    if (markerLen < rest.length) {
      const c1 = rest.charCodeAt(markerLen);
      if (c1 !== SP && c1 !== TAB) return null;
    }
    // count the columns of whitespace after the marker, using local
    // positions only (the real cursor must not move on a failed probe)
    const fns = line.length - rest.length;
    let o = fns + markerLen;
    let c = col + indent + markerLen;
    let spaces = 0;
    while (o < line.length) {
      const ch = line.charCodeAt(o);
      if (ch === SP) { spaces++; c++; o++; }
      else if (ch === TAB) { const w = 4 - (c % 4); spaces += w; c += w; o++; }
      else break;
    }
    const empty = o >= line.length;
    let padding;
    if (empty) padding = 1;
    else if (spaces === 0) return null;
    else if (spaces <= 4) padding = spaces;
    else padding = 1;
    return {
      bullet, delim, start, empty,
      contentIndent: indent + markerLen + padding,
      advanceCols: indent + markerLen + padding
    };
  }

  // Does the current line end an html block of the given type?
  // (Used both when the block starts and on later lines.)
  function htmlEndsOnLine(htype, endTag) {
    if (htype === 1) return content().toLowerCase().indexOf('</' + endTag) >= 0;
    if (htype === 2) return content().indexOf('-->') >= 0;
    if (htype === 3) return content().indexOf('?>') >= 0;
    if (htype === 4) return content().indexOf('>') >= 0;
    if (htype === 5) return content().indexOf(']]>') >= 0;
    return false;
  }

  // Match an HTML block start at the start of `rest`. Returns
  // {htype, endTag} or null. Types 1-6 may interrupt a paragraph;
  // type 7 may not (isPara gates it).
  function matchHtmlBlockStart(rest, isPara) {
    if (rest.charCodeAt(0) !== LT) return null;
    const low = rest.toLowerCase();
    // type 1: script, pre, style, textarea
    let m = /^<(script|pre|style|textarea)([\s>]|$)/.exec(low);
    if (m) return { htype: 1, endTag: m[1] };
    // type 2: comment
    if (rest.startsWith('<!--')) return { htype: 2 };
    // type 3: processing instruction
    if (rest.startsWith('<?')) return { htype: 3 };
    // type 4: declaration
    if (rest.length > 2 && rest.charCodeAt(1) === 33) {
      const c = rest.charCodeAt(2);
      if (c >= 65 && c <= 90) return { htype: 4 };
    }
    // type 5: CDATA
    if (rest.startsWith('<![CDATA[')) return { htype: 5 };
    // type 6: the line begins with <tag or </tag where tag is a block
    // tag, followed by whitespace, >, / or the end of the line (the
    // tag need not be complete and need not be alone on the line)
    let nameStart = rest.charCodeAt(1) === 47 ? 2 : 1;
    let nameEnd = nameStart;
    while (nameEnd < rest.length && isAlpha(rest.charCodeAt(nameEnd))) nameEnd++;
    const tagName = rest.slice(nameStart, nameEnd).toLowerCase();
    if (nameEnd > nameStart && HTML_BLOCK_TAGS.has(tagName)) {
      const after = nameEnd >= rest.length ? 0 : rest.charCodeAt(nameEnd);
      if (after === 0 || after === SP || after === TAB || after === GT || after === 47) {
        return { htype: 6 };
      }
    }
    // type 7: a complete open or closing tag alone on the line, any
    // tag name except pre, script, style, textarea
    const tagEnd = scanOpenTag(rest, 0);
    if (tagEnd > 0) {
      let e = tagEnd;
      while (e < rest.length && (rest.charCodeAt(e) === SP || rest.charCodeAt(e) === TAB)) e++;
      if (e >= rest.length) {
        if (tagName !== 'pre' && tagName !== 'script' && tagName !== 'style' && tagName !== 'textarea') {
          if (!isPara) return { htype: 7 };
        }
      }
    }
    return null;
  }

  // Detect a GFM table in a paragraph's remaining text. Returns
  // {header, align, rows} or null.
  function tryTable(rest) {
    const lines = rest.split('\n');
    if (lines.length < 2) return null;
    // the delimiter row must be indented by less than 4 columns
    let dIndent = 0;
    for (let q = 0; q < lines[1].length; q++) {
      const cc = lines[1].charCodeAt(q);
      if (cc === SP) dIndent++;
      else if (cc === TAB) dIndent += 4 - (dIndent % 4);
      else break;
    }
    if (dIndent >= 4) return null;
    const delimCells = splitTableRow(lines[1]);
    if (!delimCells) return null;
    const align = [];
    for (let i = 0; i < delimCells.length; i++) {
      // delimiter cells are trimmed of spaces only (a tab breaks it)
      let t = delimCells[i];
      let a0 = 0, b0 = t.length;
      while (a0 < b0 && t.charCodeAt(a0) === SP) a0++;
      while (b0 > a0 && t.charCodeAt(b0 - 1) === SP) b0--;
      t = t.slice(a0, b0);
      if (t.length < 1) return null;
      let left = false, right = false, ok = true;
      let a = 0, b = t.length;
      if (t.charCodeAt(0) === 58) { left = true; a = 1; }
      if (b > a && t.charCodeAt(b - 1) === 58) { right = true; b--; }
      for (let q = a; q < b; q++) {
        if (t.charCodeAt(q) !== 45) { ok = false; break; }
      }
      if (!ok || b - a < 1) return null;
      align.push(left ? (right ? 'center' : 'left') : (right ? 'right' : null));
    }
    const header = splitTableRow(lines[0]);
    if (!header) return null;
    // the header and the delimiter row must have the same cell count
    if (header.length !== delimCells.length) return null;
    const rows = [];
    for (let i = 2; i < lines.length; i++) rows.push(splitTableRow(lines[i]));
    return { header, align, rows };
  }
}

// ---------- shared scanners ----------
// Scan an HTML open/close tag starting at s[i] === '<'. Returns the index
// just past '>' or -1. Attribute values may be quoted (either quote) or
// unquoted; quoted values may contain '>'.
function scanOpenTag(s, i) {
  const n = s.length;
  let j = i + 1;
  let closing = false;
  if (j < n && s.charCodeAt(j) === 47) { j++; closing = true; } // '/'
  if (j >= n || !isAlpha(s.charCodeAt(j))) return -1;
  j++;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (isAlnum(c) || c === 45) j++;
    else break;
  }
  // Closing tag: only whitespace then '>' is allowed (no attributes)
  if (closing) {
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === SP || c === TAB || c === NL) j++;
      else break;
    }
    return (j < n && s.charCodeAt(j) === GT) ? j + 1 : -1;
  }
  while (true) {
    let k = j;
    while (k < n) {
      const c = s.charCodeAt(k);
      if (c === SP || c === TAB || c === NL) k++;
      else break;
    }
    if (k >= n) return -1;
    const c = s.charCodeAt(k);
    if (c === GT) return k + 1;
    if (c === 47) {
      if (k + 1 < n && s.charCodeAt(k + 1) === GT) return k + 2;
      return -1;
    }
    // an attribute must be preceded by at least one whitespace char
    if (k === j) return -1;
    if (!isAlpha(c) && c !== UNDER && c !== 58) return -1;
    j = k + 1;
    while (j < n) {
      const d = s.charCodeAt(j);
      if (isAlnum(d) || d === UNDER || d === 58 || d === 46 || d === 45) j++;
      else break;
    }
    const nameEnd = j;
    let m = j;
    while (m < n) {
      const d = s.charCodeAt(m);
      if (d === SP || d === TAB || d === NL) m++;
      else break;
    }
    if (m < n && s.charCodeAt(m) === 61) { // '='
      m++;
      while (m < n) {
        const d = s.charCodeAt(m);
        if (d === SP || d === TAB || d === NL) m++;
        else break;
      }
      if (m >= n) return -1;
      const q = s.charCodeAt(m);
      if (q === QUOT || q === APOS) {
        m++;
        while (m < n && s.charCodeAt(m) !== q) m++;
        if (m >= n) return -1;
        m++;
      } else {
        let v = m;
        while (v < n) {
          const d = s.charCodeAt(v);
          if (d === SP || d === TAB || d === NL || d === QUOT || d === APOS || d === 61 || d === LT || d === GT || d === 96) break;
          v++;
        }
        if (v === m) return -1;
        m = v;
      }
      j = m;
    } else {
      // no value: leave j right after the name so the loop can see
      // the whitespace that must precede the next attribute
      j = nameEnd;
    }
  }
}

// Split a table row on unescaped pipes. A leading/trailing pipe's empty
// outer cell is dropped. Escaped pipes stay in the cell text.
function splitTableRow(s) {
  const cells = [];
  let cur = '';
  let i = 0;
  const n = s.length;
  let hasPipe = false;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === BACKSLASH && i + 1 < n) {
      const d = s.charCodeAt(i + 1);
      if (d === 124) {
        // \| is an escaped pipe: it does not split the row, and the
        // backslash is dropped (so it is also resolved inside code spans)
        cur += '|';
        i += 2;
        continue;
      }
      if (d === BACKSLASH) {
        // \\ is an escaped backslash: keep both, so a following |
        // still splits the row
        cur += '\\\\';
        i += 2;
        continue;
      }
    }
    if (c === 124) {
      cells.push(cur);
      cur = '';
      hasPipe = true;
      i++;
      continue;
    }
    cur += s[i];
    i++;
  }
  cells.push(cur);
  if (!hasPipe) return [cur];
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

// Strip trailing punctuation from an extended autolink URL (marked's
// backpedal): trailing ? ! . , : ; * _ ' " ~ are dropped; a final ) is
// kept only as part of a balanced (...) group; a trailing &word; entity
// is dropped but a bare trailing & is kept.
const TRAILING_PUNCT = new Set([63, 33, 46, 44, 58, 59, STAR, UNDER, APOS, QUOT, TILDE, 41]);
function backpedal(url) {
  let j = 0;
  const n = url.length;
  while (j < n) {
    const c = url.charCodeAt(j);
    if (c === 40) { // '('
      const k = url.indexOf(')', j + 1);
      if (k === -1) break;
      j = k + 1;
    } else if (c === AMP) {
      let m = j + 1;
      while (m < n && isAlnum(url.charCodeAt(m))) m++;
      if (m > j + 1 && m < n && url.charCodeAt(m) === 59 && m + 1 === n) break;
      j++;
    } else if (TRAILING_PUNCT.has(c)) {
      let k = j;
      while (k < n && TRAILING_PUNCT.has(url.charCodeAt(k))) k++;
      if (k >= n) break;
      j = k;
    } else {
      j++;
    }
  }
  return url.slice(0, j);
}

function isEmailChar(c) {
  return isAlnum(c) || c === 46 || c === 33 || c === 35 || c === 36 || c === 37 ||
    c === AMP || c === APOS || c === STAR || c === 43 || c === 47 || c === 61 ||
    c === 63 || c === 94 || c === UNDER || c === 96 || c === 123 || c === 124 ||
    c === 125 || c === TILDE || c === 45;
}

// Match a GFM extended autolink URL at text[i]. isWww selects the www.
// form; otherwise a protocol (http/https/ftp) form. Returns the URL
// string after backpedalling, or null.
function matchExtUrl(text, i, isWww) {
  const n = text.length;
  let j;
  if (isWww) {
    if (i + 4 > n || text.charCodeAt(i) !== 119 || text.charCodeAt(i + 1) !== 119 ||
      text.charCodeAt(i + 2) !== 119 || text.charCodeAt(i + 3) !== 46) return null;
    j = i + 4;
  } else {
    const h = text.charCodeAt(i) | 32;
    const t = text.charCodeAt(i + 1) | 32;
    if (h === 104 && t === 116 && (text.slice(i, i + 7).toLowerCase() === 'http://')) j = i + 7;
    else if (h === 104 && t === 116 && (text.slice(i, i + 8).toLowerCase() === 'https://')) j = i + 8;
    else if (h === 102 && t === 116 && (text.slice(i, i + 6).toLowerCase() === 'ftp://')) j = i + 6;
    else return null;
  }
  let hasLabel = false;
  while (j < n) {
    const c = text.charCodeAt(j);
    if (isAlnum(c) || c === 45) { hasLabel = true; j++; }
    else if (c === 46 && hasLabel) j++;
    else break;
  }
  if (!hasLabel) return null;
  while (j < n) {
    const c = text.charCodeAt(j);
    // a URL inside link text ends at a bracket (the ] closes the text)
    if (c === SP || c === TAB || c === NL || c === LT || c === LBRACK || c === RBRACK) break;
    j++;
  }
  const url = backpedal(text.slice(i, j));
  return url.length > 0 ? url : null;
}

// Match an extended autolink email at text[i]. Returns the email string
// or null. Local part [A-Za-z0-9._+-]+, domain with at least one dot,
// and the character after the domain must not be a word char or '-'.
function matchEmail(text, i) {
  const n = text.length;
  let j = i;
  while (j < n) {
    const c = text.charCodeAt(j);
    if (isAlnum(c) || c === 46 || c === UNDER || c === 43 || c === 45) j++;
    else break;
  }
  if (j === i || j >= n || text.charCodeAt(j) !== 64) return null; // '@'
  j++;
  // domain: first label, then one or more dot-groups; each dot-group
  // must end with an alphanumeric. A dot not followed by a group ends
  // the address (the dot itself is outside it).
  const isDom = (c) => isAlnum(c) || c === UNDER || c === 45;
  let k = j;
  while (k < n && isDom(text.charCodeAt(k))) k++;
  if (k === j) return null;
  j = k;
  let labels = 1;
  while (j < n && text.charCodeAt(j) === 46) {
    const g = j + 1;
    let m = g;
    while (m < n && isDom(text.charCodeAt(m))) m++;
    if (m === g) break; // dot not followed by a group: address ends here
    if (!isAlnum(text.charCodeAt(m - 1))) return null;
    j = m;
    labels++;
  }
  if (labels < 2) return null;
  // char after must not be a word char or '-'
  if (j < n) {
    const c = text.charCodeAt(j);
    if (isAlnum(c) || c === UNDER || c === 45) return null;
  }
  return text.slice(i, j);
}

// ---------- inline parsing ----------
// Node types: 0 text, 1 code, 2 link, 3 image, 4 raw html, 5 hard break,
// 6 soft break, 7 delimiter, 9 bracket, 10 em/strong/del.
const PUNCT_RE = /[\p{P}\p{S}]/u;
function isUnicodeWsCp(cp) {
  return cp === SP || cp === TAB || cp === NL || cp === CR || cp === 12 || cp === 11 ||
    cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f ||
    cp === 0x3000 || cp === 0xfeff;
}
function isUnicodePunctCp(cp) {
  if (cp < 128) return isAsciiPunct(cp);
  return PUNCT_RE.test(String.fromCodePoint(cp));
}
function cpBefore(text, i) {
  if (i <= 0) return -1;
  const c = text.charCodeAt(i - 1);
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return (h - 0xd800) * 0x400 + (c - 0xdc00) + 0x10000;
  }
  return c;
}

// Plain text of a node list (used for link labels and image alt text).
function plainText(nodes) {
  let out = '';
  for (const node of nodes) {
    switch (node.t) {
      case 0: case 1: case 4: out += node.s; break;
      case 2: out += plainText(node.c); break;
      case 3: out += node.alt; break;
      case 5: case 6: out += '\n'; break;
      case 7: out += node.ch.repeat(node.len); break;
      case 9: out += node.image ? '![' : '['; break;
      case 10: out += plainText(node.c); break;
      // escaped chars: bracket escapes resolve, others keep the
      // backslash, so a label [foo\!] does not match a ref [foo!]
      case 11: out += (node.s === '[' || node.s === ']') ? node.s : '\\' + node.s; break;
    }
  }
  return out;
}

// Plain text for an image alt: like plainText, but emphasis delimiter
// runs contribute nothing (the markers are stripped, not rendered)
function altText(nodes) {
  let out = '';
  for (const node of nodes) {
    switch (node.t) {
      case 0: case 1: case 4: out += node.s; break;
      case 2: out += altText(node.c); break;
      case 3: out += node.alt; break;
      case 5: case 6: out += '\n'; break;
      case 7: break;
      case 9: out += node.image ? '![' : '['; break;
      case 10: out += altText(node.c); break;
      case 11: out += node.s; break;
    }
  }
  return out;
}

function parseInline(text, refs) {
  const nodes = [];
  const brackets = [];
  let buf = '';
  const n = text.length;
  let i = 0;

  function flush() {
    if (buf !== '') { nodes.push({ t: 0, s: buf }); buf = ''; }
  }

  // Try an inline link ( ... ) starting at text[i] === ']'.
  // Returns {dest, title, end} or null; end is just past ')'.
  function tryInlineLink() {
    let p = i + 1;
    if (p >= n || text.charCodeAt(p) !== 40) return null;
    p++;
    p = skipWsNl(text, p);
    let dest = '';
    if (p < n && text.charCodeAt(p) === 41) {
      return { dest: '', title: null, end: p + 1 };
    }
    const d = parseDest(text, p);
    if (!d) return null;
    dest = d[0];
    p = d[1];
    p = skipWsNl(text, p);
    let title = null;
    if (p < n) {
      const c = text.charCodeAt(p);
      if (c === QUOT || c === APOS || c === 40) {
        const t = parseTitle(text, p);
        if (!t) return null;
        title = t[0];
        p = t[1];
        p = skipWsNl(text, p);
      }
    }
    if (p >= n || text.charCodeAt(p) !== 41) return null;
    return { dest, title, end: p + 1 };
  }

  // Try a reference link starting at text[i] === ']'. linkText is the
  // plain text of the link's contents. Returns {dest, title, end} or null.
  function tryRefLink(linkText) {
    if (i + 1 < n && text.charCodeAt(i + 1) === LBRACK) {
      const lab = scanLabel(text, i + 1);
      if (lab) {
        const label = lab[0] === '' ? linkText : lab[0];
        const ref = refs.get(normalizeLabel(label));
        if (ref) return { dest: ref.dest, title: ref.title, end: lab[1] };
        return null;
      }
      // unparseable bracketed label: fall through to the shortcut
    }
    const ref = refs.get(normalizeLabel(linkText));
    if (ref) return { dest: ref.dest, title: ref.title, end: i + 1 };
    return null;
  }

  // Try a <...> autolink at text[i] === '<'. Returns {node, end} or null.
  function tryAngleAutolink() {
    let j = i + 1;
    if (j < n && isAlpha(text.charCodeAt(j))) {
      let k = j + 1;
      while (k < n) {
        const d = text.charCodeAt(k);
        if (isAlnum(d) || d === 43 || d === 46 || d === 45) k++;
        else break;
      }
      const schemeLen = k - j;
      if (schemeLen >= 2 && schemeLen <= 32 && k < n && text.charCodeAt(k) === 58) {
        let m = k + 1;
        while (m < n) {
          const d = text.charCodeAt(m);
          if (d === LT || d === GT || d <= 32) break;
          m++;
        }
        if (m < n && text.charCodeAt(m) === GT) {
          const raw = text.slice(i + 1, m);
          return { node: { t: 2, href: raw, title: null, c: [{ t: 0, s: raw }], auto: true }, end: m + 1 };
        }
      }
    }
    // email autolink
    let k = j;
    while (k < n && isEmailChar(text.charCodeAt(k))) k++;
    if (k > j && k < n && text.charCodeAt(k) === 64) {
      let m = k + 1;
      let labels = 0;
      let ok = true;
      while (true) {
        if (m >= n || !isAlnum(text.charCodeAt(m))) { ok = false; break; }
        let e = m + 1;
        while (e < n && (isAlnum(text.charCodeAt(e)) || text.charCodeAt(e) === 45)) e++;
        while (e > m + 1 && text.charCodeAt(e - 1) === 45) e--;
        if (e - m > 63) { ok = false; break; }
        m = e;
        labels++;
        if (m < n && text.charCodeAt(m) === 46) { m++; continue; }
        break;
      }
      if (ok && labels >= 1 && m < n && text.charCodeAt(m) === GT) {
        const raw = text.slice(i + 1, m);
        return { node: { t: 2, href: 'mailto:' + raw, title: null, c: [{ t: 0, s: raw }], auto: true }, end: m + 1 };
      }
    }
    return null;
  }

  // Try inline HTML at text[i] === '<'. Returns the raw HTML string or null.
  function tryInlineHtml() {
    if (text.startsWith('<!--', i)) {
      // <!--> and <!---> are complete (empty) comments
      if (text.charCodeAt(i + 4) === GT) return text.slice(i, i + 5);
      if (text.startsWith('->', i + 4)) return text.slice(i, i + 6);
      const e = text.indexOf('-->', i + 4);
      if (e >= 0) return text.slice(i, e + 3);
      return null;
    }
    if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i + 2);
      if (e >= 0) return text.slice(i, e + 2);
      return null;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const e = text.indexOf(']]>', i + 9);
      if (e >= 0) return text.slice(i, e + 3);
      return null;
    }
    if (i + 2 < n && text.charCodeAt(i + 1) === 33) {
      const c = text.charCodeAt(i + 2);
      if (c >= 65 && c <= 90) {
        const e = text.indexOf('>', i + 3);
        if (e >= 0) return text.slice(i, e + 1);
      }
      return null;
    }
    const e = scanOpenTag(text, i);
    if (e > 0) return text.slice(i, e);
    return null;
  }

  while (i < n) {
    const c = text.charCodeAt(i);
    // --- GFM extended autolinks ---
    if (c === 119) { // 'w'
      if (i === 0 || text.charCodeAt(i - 1) === SP || text.charCodeAt(i - 1) === TAB ||
        text.charCodeAt(i - 1) === NL || text.charCodeAt(i - 1) === STAR ||
        text.charCodeAt(i - 1) === UNDER || text.charCodeAt(i - 1) === TILDE ||
        text.charCodeAt(i - 1) === 40) {
        const url = matchExtUrl(text, i, true);
        if (url) {
          flush();
          nodes.push({ t: 2, href: 'http://' + url, title: null, c: [{ t: 0, s: url }], ext: true });
          i += url.length;
          continue;
        }
      }
    } else if (c === 104 || c === 102 || c === 72 || c === 70) { // h f H F
      const url = matchExtUrl(text, i, false);
      if (url) {
        flush();
        nodes.push({ t: 2, href: url, title: null, c: [{ t: 0, s: url }], ext: true });
        i += url.length;
        continue;
      }
    }
    // mailto:/xmpp: autolinks (lowercase scheme only, at a boundary)
    if ((c === 109 || c === 120) && (buf === '' || !isEmailChar(text.charCodeAt(i - 1)))) {
      const scheme = c === 109 ? 'mailto:' : 'xmpp:';
      if (text.slice(i, i + scheme.length) === scheme) {
        const em = matchEmail(text, i + scheme.length);
        if (em) {
          flush();
          let full = scheme + em;
          // xmpp: takes an optional /resource suffix
          if (c === 120) {
            const r0 = i + full.length;
            if (r0 < n && text.charCodeAt(r0) === 47) {
              let r1 = r0 + 1;
              while (r1 < n) {
                const d = text.charCodeAt(r1);
                if (isAlnum(d) || d === 64 || d === 46) r1++;
                else break;
              }
              if (r1 > r0 + 1) full = text.slice(i, r1);
            }
          }
          nodes.push({ t: 2, href: full, title: null, c: [{ t: 0, s: full }], ext: true });
          i += full.length;
          continue;
        }
      }
    }
    if (isEmailChar(c) && (buf === '' || !isEmailChar(text.charCodeAt(i - 1)))) {
      const em = matchEmail(text, i);
      if (em) {
        flush();
        nodes.push({ t: 2, href: 'mailto:' + em, title: null, c: [{ t: 0, s: em }], ext: true });
        i += em.length;
        continue;
      }
    }

    if (c === NL) {
      let k = buf.length;
      let spaces = 0;
      while (k > 0 && buf.charCodeAt(k - 1) === SP) { spaces++; k--; }
      if (spaces >= 2) {
        buf = buf.slice(0, k);
        flush();
        nodes.push({ t: 5 });
      } else {
        flush();
        nodes.push({ t: 6 });
      }
      i++;
      // after a hard break, leading spaces/tabs of the next line are stripped
      if (spaces >= 2) while (i < n && (text.charCodeAt(i) === SP || text.charCodeAt(i) === TAB)) i++;
      continue;
    }
    if (c === BACKSLASH) {
      if (i + 1 < n) {
        const d = text.charCodeAt(i + 1);
        if (d === NL) { flush(); nodes.push({ t: 5 }); i += 2; while (i < n && (text.charCodeAt(i) === SP || text.charCodeAt(i) === TAB)) i++; continue; }
        // a backslash-escaped character is a literal character: it must
        // not be re-interpreted (so \&ouml; renders &amp;ouml;, not &ouml;)
        if (isAsciiPunct(d)) { flush(); nodes.push({ t: 11, s: text[i + 1] }); i += 2; continue; }
      }
      buf += '\\';
      i++;
      continue;
    }
    if (c === BACKTICK) {
      let m = 0;
      while (i + m < n && text.charCodeAt(i + m) === BACKTICK) m++;
      let j = i + m;
      let found = -1;
      while (j < n) {
        if (text.charCodeAt(j) === BACKTICK) {
          let r = 0;
          while (j + r < n && text.charCodeAt(j + r) === BACKTICK) r++;
          if (r === m) { found = j; break; }
          j += r;
        } else j++;
      }
      if (found >= 0) {
        let content = text.slice(i + m, found).replace(/\n/g, ' ');
        if (content.length >= 2 && content.charCodeAt(0) === SP &&
          content.charCodeAt(content.length - 1) === SP && content.trim() !== '') {
          content = content.slice(1, -1);
        }
        flush();
        nodes.push({ t: 1, s: content });
        i = found + m;
        continue;
      }
      buf += '`'.repeat(m);
      i += m;
      continue;
    }
    if (c === STAR || c === UNDER || c === TILDE) {
      let m = 0;
      while (i + m < n && text.charCodeAt(i + m) === c) m++;
      const beforeCp = cpBefore(text, i);
      const afterCp = i + m < n ? text.codePointAt(i + m) : -1;
      const beforeWs = beforeCp === -1 || isUnicodeWsCp(beforeCp);
      const beforePunct = beforeCp !== -1 && isUnicodePunctCp(beforeCp);
      const afterWs = afterCp === -1 || isUnicodeWsCp(afterCp);
      const afterPunct = afterCp !== -1 && isUnicodePunctCp(afterCp);
      const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
      const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
      let canOpen, canClose;
      if (c === UNDER) {
        canOpen = leftFlanking && (!rightFlanking || beforePunct);
        canClose = rightFlanking && (!leftFlanking || afterPunct);
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }
      // a strikethrough run is 1 or 2 tildes only; a run of 3+ is
      // literal text (marked's del opener is ~~? followed by a
      // non-tilde, so a third tilde kills it)
      if (c === TILDE && m >= 3) { canOpen = false; canClose = false; }
      flush();
      nodes.push({ t: 7, ch: String.fromCharCode(c), len: m, canOpen, canClose });
      i += m;
      continue;
    }
    if (c === LBRACK) {
      flush();
      const node = { t: 9, image: false };
      nodes.push(node);
      brackets.push({ node, active: true });
      i++;
      continue;
    }
    if (c === BANG) {
      if (i + 1 < n && text.charCodeAt(i + 1) === LBRACK) {
        flush();
        const node = { t: 9, image: true };
        nodes.push(node);
        brackets.push({ node, active: true });
        i += 2;
        continue;
      }
      buf += '!';
      i++;
      continue;
    }
    if (c === RBRACK) {
      flush();
      let bi = -1;
      for (let b = brackets.length - 1; b >= 0; b--) {
        if (brackets[b].active) { bi = b; break; }
      }
      if (bi < 0) { buf += ']'; i++; continue; }
      const opener = brackets[bi];
      const opIdx = nodes.indexOf(opener.node);
      const children = nodes.slice(opIdx + 1);
      const linkText = plainText(children);
      let link = tryInlineLink();
      if (!link) link = tryRefLink(linkText);
      // a link whose text contains a REGULAR link does not form; images
      // are never blocked by links in their alt text, and autolinks
      // (angle or extended) do not block either
      let hasLink = false;
      if (link && !opener.node.image) {
        for (const ch of children) {
          if (ch.t === 2 && !ch.ext && !ch.auto) { hasLink = true; break; }
        }
      }
      if (!link || hasLink) {
        opener.active = false;
        buf += ']';
        i++;
        continue;
      }
      // extended autolinks inside link text become plain text
      for (let k = 0; k < children.length; k++) {
        if (children[k].t === 2 && children[k].ext) {
          children[k] = { t: 0, s: children[k].c[0].s };
        }
      }
      // form the link or image
      for (let b = bi + 1; b < brackets.length; b++) brackets[b].active = false;
      opener.active = false;
      nodes.length = opIdx;
      if (opener.node.image) {
        nodes.push({ t: 3, src: link.dest, title: link.title, alt: altText(children) });
      } else {
        nodes.push({ t: 2, href: link.dest, title: link.title, c: children });
      }
      i = link.end;
      continue;
    }
    if (c === LT) {
      const auto = tryAngleAutolink();
      if (auto) { flush(); nodes.push(auto.node); i = auto.end; continue; }
      const html = tryInlineHtml();
      if (html) { flush(); nodes.push({ t: 4, s: html }); i += html.length; continue; }
      buf += '<';
      i++;
      continue;
    }
    buf += text[i];
    i++;
  }
  flush();
  processEmphasis(nodes);
  return renderNodes(nodes);
}

// ---------- emphasis processing ----------
// Walks a node list (recursing into link children first), matching
// delimiter runs by the CommonMark rules: nearest usable opener, the
// odd-match rule (a match is invalid when one side can both open and
// close and the sum of the two runs is a multiple of 3 unless both
// lengths are multiples of 3), and one or two delimiters per match.
function processEmphasis(nodes) {
  for (const node of nodes) {
    if (node.t === 2) processEmphasis(node.c);
  }
  const stack = [];
  const bottom = { '*': null, '_': null, '~': null };
  let idx = 0;
  while (idx < nodes.length) {
    const node = nodes[idx];
    if (node.t !== 7) { idx++; continue; }
    let used = false;
    if (node.canClose && node.len > 0) {
      let oi = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        const op = stack[k];
        if (op.ch !== node.ch || !op.canOpen || op.len === 0) continue;
        if (node.ch === '~') {
          // a del opener and closer must have the same length (1 or 2)
          if (op.len !== node.len) continue;
        } else {
          const both = (op.canOpen && op.canClose) || (node.canOpen && node.canClose);
          if (both && (op.len + node.len) % 3 === 0 &&
            !(op.len % 3 === 0 && node.len % 3 === 0)) continue;
        }
        oi = k;
        break;
      }
      if (oi >= 0) {
        const op = stack[oi];
        const use = node.ch === '~' ? op.len : (op.len >= 2 && node.len >= 2 ? 2 : 1);
        const opPos = nodes.indexOf(op);
        const clPos = idx;
        const children = nodes.slice(opPos + 1, clPos);
        const emNode = {
          t: 10,
          kind: node.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em'),
          c: children
        };
        op.len -= use;
        node.len -= use;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (children.includes(stack[k])) stack.splice(k, 1);
        }
        if (op.len === 0) {
          const oi2 = stack.indexOf(op);
          if (oi2 >= 0) stack.splice(oi2, 1);
        }
        const replacement = [];
        if (op.len > 0) replacement.push(op);
        replacement.push(emNode);
        if (node.len > 0) replacement.push(node);
        nodes.splice(opPos, clPos - opPos + 1, ...replacement);
        idx = opPos + replacement.length - (node.len > 0 ? 1 : 0);
        used = true;
      }
    }
    if (!used) {
      if (node.canOpen && node.len > 0) stack.push(node);
      idx++;
    }
  }
}

function renderNodes(nodes) {
  let out = '';
  for (const node of nodes) {
    switch (node.t) {
      case 0: out += escapeText(node.s); break;
      case 1: out += '<code>' + escapeCode(node.s) + '</code>'; break;
      case 2:
        out += '<a href="' + encodeHref(node.href) + '"';
        if (node.title != null) out += ' title="' + escapeAttr(node.title) + '"';
        out += '>' + renderNodes(node.c) + '</a>';
        break;
      case 3:
        out += '<img src="' + encodeHref(node.src) + '" alt="' + escapeAttr(node.alt) + '"';
        if (node.title != null) out += ' title="' + escapeAttr(node.title) + '"';
        out += '>';
        break;
      case 4: out += node.s; break;
      case 5: out += '<br>'; break;
      case 6: out += '\n'; break;
      case 7: out += node.ch.repeat(node.len); break;
      case 9: out += node.image ? '![' : '['; break;
      case 10:
        out += '<' + node.kind + '>' + renderNodes(node.c) + '</' + node.kind + '>';
        break;
      case 11: out += escapeCode(node.s); break;
    }
  }
  return out;
}

// ---------- block rendering ----------
// A task-list checkbox: "[ ]" / "[x]" / "[X]" followed by whitespace and
// content. Returns {checked, rest} or null.
function taskCheckbox(text) {
  if (text.length < 3 || text.charCodeAt(0) !== LBRACK || text.charCodeAt(2) !== RBRACK) return null;
  const c = text.charCodeAt(1);
  if (c !== SP && c !== 120 && c !== 88) return null;
  let r = 3;
  while (r < text.length) {
    const d = text.charCodeAt(r);
    if (d === SP || d === TAB || d === NL) r++;
    else break;
  }
  if (r === 3 || r >= text.length) return null;
  return { checked: c !== SP, rest: text.slice(r) };
}

function renderItem(item, refs, tight) {
  let inner = '';
  const children = item.c;
  let checkbox = null;
  let firstText = null;
  if (children.length > 0 && children[0].t === 'para') {
    const tc = taskCheckbox(children[0].text);
    if (tc) {
      checkbox = tc.checked
        ? '<input checked="" disabled="" type="checkbox">'
        : '<input disabled="" type="checkbox">';
      firstText = tc.rest;
    }
  }
  for (let k = 0; k < children.length; k++) {
    const c = children[k];
    if (c.t === 'para') {
      const text = (k === 0 && firstText !== null) ? firstText : c.text;
      const html = (k === 0 && checkbox ? checkbox + ' ' : '') + parseInline(text, refs);
      if (tight) inner += html;
      else inner += '<p>' + html + '</p>\n';
    } else {
      inner += renderBlock(c, refs);
    }
  }
  return '<li>' + inner + '</li>\n';
}

function renderTable(blk, refs) {
  const ncols = blk.align.length;
  let out = '<table>\n<thead>\n<tr>\n';
  for (let i = 0; i < ncols; i++) {
    const cell = i < blk.header.length ? blk.header[i].trim() : '';
    const al = blk.align[i];
    out += '<th' + (al ? ' align="' + al + '"' : '') + '>' + parseInline(cell, refs) + '</th>\n';
  }
  out += '</tr>\n</thead>\n';
  if (blk.rows.length === 0) return out + '</table>\n';
  out += '<tbody>';
  for (const row of blk.rows) {
    out += '<tr>\n';
    for (let i = 0; i < ncols; i++) {
      const cell = i < row.length ? row[i].trim() : '';
      const al = blk.align[i];
      out += '<td' + (al ? ' align="' + al + '"' : '') + '>' + parseInline(cell, refs) + '</td>\n';
    }
    out += '</tr>\n';
  }
  out += '</tbody></table>\n';
  return out;
}

function renderBlock(blk, refs) {
  switch (blk.t) {
    case 'bq': {
      let inner = '';
      for (const c of blk.c) inner += renderBlock(c, refs);
      return '<blockquote>\n' + inner + '</blockquote>\n';
    }
    case 'list': {
      const tag = blk.bullet ? 'ul' : 'ol';
      const attrs = (!blk.bullet && blk.start !== 1) ? ' start="' + blk.start + '"' : '';
      let inner = '';
      for (const item of blk.c) inner += renderItem(item, refs, blk.tight);
      return '<' + tag + attrs + '>\n' + inner + '</' + tag + '>\n';
    }
    case 'para': return '<p>' + parseInline(blk.text, refs) + '</p>\n';
    case 'head': return '<h' + blk.level + '>' + parseInline(blk.text, refs) + '</h' + blk.level + '>\n';
    case 'code': {
      if (blk.fenced) {
        let lang = '';
        for (let i = 0; i < blk.info.length; i++) {
          const cc = blk.info.charCodeAt(i);
          if (cc === SP || cc === TAB) break;
          lang += blk.info[i];
        }
        const cls = lang !== '' ? ' class="language-' + escapeAttr(lang) + '"' : '';
        return '<pre><code' + cls + '>' + escapeCode(blk.lit) + '</code></pre>\n';
      }
      return '<pre><code>' + escapeCode(blk.lit) + '</code></pre>\n';
    }
    case 'html':
      // a type 1-5 block followed by a blank line loses its trailing
      // newline (flagged when the blank line was processed)
      if (blk._stripNl && blk.lit.endsWith('\n')) return blk.lit.slice(0, -1);
      return blk.lit;
    case 'hr': return '<hr>\n';
    case 'table': return renderTable(blk, refs);
  }
  return '';
}

export function parse(src) {
  const s = src.indexOf('\r') >= 0 ? src.replace(/\r\n?/g, '\n') : src;
  const refs = new Map();
  const root = parseBlocks(s, refs);
  let out = '';
  for (const blk of root.c) out += renderBlock(blk, refs);
  return out;
}
