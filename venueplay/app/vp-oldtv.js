/* vp-oldtv.js  -- THE WALL ON AN OLDER TELEVISION. ONE ANSWER, EVERY SCREEN (1 Nov 2026).

   THE FAULT. Every size on the venue screens is written in `cqw`, a container-query unit
   (1cqw = 1% of the .tv wall's width), mostly inside clamp() or min(). Container units arrived
   in Chromium 105 and Safari 16. The browsers built into the televisions venues already own
   are older: Samsung Tizen 5.5 (2020 sets) is Chromium 69, Tizen 6.5 is 85, LG webOS 5 is 68,
   webOS 6 is 79, and Android TV WebViews vary. An engine that does not know a unit drops the
   WHOLE declaration, silently. So on those sets every font size, width, padding and margin on
   the wall fell back to the browser default: 16px type in the top-left of a 1920 wall, QR
   codes at their natural size, no layout at all. The Samsung and LG apps
   (~/venueplay-tv-apps-tizen-webos) had to refuse every set older than 2024 for this.

   Four more features from after Chromium 68 ride along and fail the same quiet way:
     clamp(), min(), max()     Chromium 79
     gap on a flex box         Chromium 84 (a grid's gap is older, and grid-gap older still)
     inset                     Chromium 87
     aspect-ratio              Chromium 88
   The scripts were already plain ES5 (tools/old-tv-syntax.test.py holds them to it).

   WHAT THIS DOES. On a browser that understands container units it does NOTHING: it asks one
   question, CSS.supports("width","1cqw"), and returns. Every engine with container units has
   the other four as well, so a modern screen is byte-for-byte the page it was, and that is
   proved by a pixel diff in tools/old-tv-in-chrome.test.py.

   On an older engine it rewrites the page's own CSS into CSS that engine can read, from the
   ORIGINAL text (the engine's own copy has already thrown the declarations away):
     - every cqw/cqh is turned into the pixels it stands for on this wall, and every calc(),
       clamp(), min() and max() whose parts are all known is worked out to one pixel value.
       So the old engine is handed the same numbers a new one computes, and lays out the same
       wall. Done again from the original text whenever the window changes size.
     - inset becomes top/right/bottom/left.
     - aspect-ratio on a box with a known width gets the matching height.
     - a flex box's gap becomes margins on its children (grids keep gap, plus grid-gap).
   Every <style> on the page, any <style> a script adds later (the Punters Reckon board), and
   every inline style="" (in the markup, from innerHTML, from setAttribute) goes through it.

   TESTING IT ON A NEW BROWSER. ?oldtv=units runs the unit maths only, on a modern engine,
   so the result can be compared with what that engine computes itself: every box must land
   within half a pixel. ?oldtv=68 (or ?oldtv=1) runs every fallback AND strips what Chromium
   68 would ignore, which is the nearest a modern Chrome can come to being an old television.
   VPOldTV.leftovers() lists any declaration an old engine would still drop.

   ES5, no dependencies, loaded in the <head> straight after the page's <style> so the first
   frame an old set paints is already right. */
(function (w, d) {
  "use strict";

  var q = /[?&]oldtv=(1|68|units)(?:&|#|$)/.exec((w.location && w.location.search) || "");
  var FORCE = (q && q[1]) || "";
  if (FORCE === "1") FORCE = "68";

  function sup(p, v) {
    try { return !!(w.CSS && w.CSS.supports && w.CSS.supports(p, v)); } catch (e) { return false; }
  }

  /* THE ONLY THING A MODERN SCREEN EVER RUNS. Container units are the newest feature here, so
     an engine that has them has the rest (Chromium 105, Safari 16, Firefox 110). */
  if (!FORCE && sup("width", "1cqw")) { w.VPOldTV = { active: false }; return; }

  function flexGapWorks() {
    try {
      var root = d.body || d.documentElement, f = d.createElement("div");
      f.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden;top:0;left:0";
      f.appendChild(d.createElement("div"));
      f.appendChild(d.createElement("div"));
      root.appendChild(f);
      var ok = f.scrollHeight === 1;
      root.removeChild(f);
      return ok;
    } catch (e) { return false; }
  }

  var NEED;
  if (FORCE === "units") NEED = { inset: true, aspect: true, gap: false, gridgap: false, backdrop: false, strip: false };
  else if (FORCE === "68") NEED = { inset: true, aspect: true, gap: true, gridgap: true, backdrop: true, strip: true };
  else NEED = { inset: !sup("inset", "0px"), aspect: !sup("aspect-ratio", "1 / 1"),
                gap: !flexGapWorks(), gridgap: !sup("gap", "1px"),
                backdrop: !sup("backdrop-filter", "blur(1px)") && !sup("-webkit-backdrop-filter", "blur(1px)"), strip: false };

  /* ---------------------------------------------------------------- the wall's measurements */
  var M = { cw: 0, ch: 0, vw: 0, vh: 0, rem: 16 };
  function measure() {
    var de = d.documentElement, tv = d.querySelector(".tv");
    var vw = w.innerWidth || (de && de.clientWidth) || 1920;
    var vh = w.innerHeight || (de && de.clientHeight) || 1080;
    var cw = vw;
    if (tv) { var r = tv.getBoundingClientRect(); if (r.width > 0) cw = r.width; }
    var rem = 16;
    try { rem = parseFloat(w.getComputedStyle(de).fontSize) || 16; } catch (e) {}
    /* .tv is an inline-size container only, so a cqh has no container height to read and
       falls back to the viewport's, as the spec says; the TV has no browser bar to subtract. */
    var n = { cw: cw, ch: vh, vw: vw, vh: vh, rem: rem };
    var changed = n.cw !== M.cw || n.ch !== M.ch || n.vw !== M.vw || n.vh !== M.vh || n.rem !== M.rem;
    M = n;
    return changed;
  }

  var UNIT = {
    px: function () { return 1; },
    cqw: function () { return M.cw / 100; }, cqi: function () { return M.cw / 100; },
    cqh: function () { return M.ch / 100; }, cqb: function () { return M.ch / 100; },
    cqmin: function () { return Math.min(M.cw, M.ch) / 100; }, cqmax: function () { return Math.max(M.cw, M.ch) / 100; },
    vw: function () { return M.vw / 100; }, vh: function () { return M.vh / 100; },
    vmin: function () { return Math.min(M.vw, M.vh) / 100; }, vmax: function () { return Math.max(M.vw, M.vh) / 100; },
    rem: function () { return M.rem; },
    "in": function () { return 96; }, cm: function () { return 96 / 2.54; }, mm: function () { return 96 / 25.4; },
    pt: function () { return 4 / 3; }, pc: function () { return 16; }
  };
  var CQ_RE = /(^|[^\w.-])([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/gi;

  function fmt(px) {
    var r = Math.round(px * 10000) / 10000;
    if (r === 0) return "0px";
    return String(r) + "px";
  }

  /* ---------------------------------------------------------------- calc(), clamp(), min(), max()
     A small evaluator. A value is {v: number, len: true|false}; anything it cannot know (%, em,
     var(), an unknown unit) makes the whole expression unknown, and the text is then left for the
     engine, with only its container units turned into pixels. */
  function tokens(s) {
    var out = [], i = 0, n = s.length, c, m;
    var NUM = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)/i, ID = /^([a-z-][\w-]*)/i;
    while (i < n) {
      c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      var prev = out.length ? out[out.length - 1] : null;
      var signOk = !prev || prev.t === "op" || prev.t === "(" || prev.t === ",";
      if (/[\d.]/.test(c) || ((c === "+" || c === "-") && signOk && /[\d.]/.test(s.charAt(i + 1)))) {
        m = NUM.exec(s.slice(i));
        if (!m) return null;
        out.push({ t: "num", v: parseFloat(m[1]), u: m[2].toLowerCase() });
        i += m[0].length; continue;
      }
      if (/[a-z-]/i.test(c)) {
        m = ID.exec(s.slice(i));
        if (!m) return null;
        i += m[0].length;
        if (s.charAt(i) === "(") { out.push({ t: "fn", v: m[1].toLowerCase() }); i++; continue; }
        return null;                                         /* a bare word: not arithmetic */
      }
      if (c === "(") { out.push({ t: "(" }); i++; continue; }
      if (c === ")") { out.push({ t: ")" }); i++; continue; }
      if (c === ",") { out.push({ t: "," }); i++; continue; }
      if ("+-*/".indexOf(c) >= 0) { out.push({ t: "op", v: c }); i++; continue; }
      return null;
    }
    return out;
  }

  function evaluate(expr) {
    var tk = tokens(expr), p = 0;
    if (!tk) return null;
    function peek() { return tk[p]; }
    function zeroLen(a) { return a && !a.len && a.v === 0 ? { v: 0, len: true } : a; }
    function sum() {
      var a = product();
      while (a && peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
        var op = tk[p++].v, b = product();
        if (!b) return null;
        if (a.len !== b.len) { a = zeroLen(a); b = zeroLen(b); if (a.len !== b.len) return null; }
        a = { v: op === "+" ? a.v + b.v : a.v - b.v, len: a.len };
      }
      return a;
    }
    function product() {
      var a = unary();
      while (a && peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
        var op = tk[p++].v, b = unary();
        if (!b) return null;
        if (op === "*") { if (a.len && b.len) return null; a = { v: a.v * b.v, len: a.len || b.len }; }
        else { if (b.len || b.v === 0) return null; a = { v: a.v / b.v, len: a.len }; }
      }
      return a;
    }
    function list() {
      var out = [];
      for (;;) {
        var a = sum();
        if (!a) return null;
        out.push(a);
        var t = tk[p++];
        if (!t) return null;
        if (t.t === ")") return out;
        if (t.t !== ",") return null;
      }
    }
    function unary() {
      var t = tk[p++];
      if (!t) return null;
      if (t.t === "num") {
        if (!t.u) return { v: t.v, len: false };
        var f = UNIT[t.u];
        return f ? { v: t.v * f(), len: true } : null;
      }
      if (t.t === "(") {
        var a = sum();
        if (!a || !tk[p] || tk[p].t !== ")") return null;
        p++; return a;
      }
      if (t.t === "fn") {
        var args = list(), i, best;
        if (!args) return null;
        for (i = 0; i < args.length; i++) args[i] = zeroLen(args[i]);
        for (i = 1; i < args.length; i++) if (args[i].len !== args[0].len) return null;
        if (t.v === "calc") return args.length === 1 ? args[0] : null;
        if (t.v === "min" || t.v === "max") {
          best = args[0].v;
          for (i = 1; i < args.length; i++) best = t.v === "min" ? Math.min(best, args[i].v) : Math.max(best, args[i].v);
          return { v: best, len: args[0].len };
        }
        if (t.v === "clamp" && args.length === 3) {
          return { v: Math.max(args[0].v, Math.min(args[1].v, args[2].v)), len: args[0].len };
        }
        return null;
      }
      return null;
    }
    var r = sum();
    return r && p === tk.length && r.len ? r : null;
  }

  /* The end of the bracket that opens at i (s.charAt(i) === "("). */
  function closeOf(s, i) {
    var depth = 0;
    for (var j = i; j < s.length; j++) {
      var c = s.charAt(j);
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (!depth) return j; }
    }
    return -1;
  }

  /* One value, rewritten. Strings and url() are copied untouched. */
  var MATH_FN = { calc: 1, clamp: 1, min: 1, max: 1 };
  function resolveValue(v) {
    var out = "", i = 0, n = v.length;
    while (i < n) {
      var c = v.charAt(i);
      if (c === '"' || c === "'") {
        var j = i + 1;
        while (j < n && v.charAt(j) !== c) { if (v.charAt(j) === "\\") j++; j++; }
        out += v.slice(i, j + 1); i = j + 1; continue;
      }
      if (/[a-z-]/i.test(c) && !(c === "-" && /[\d.]/.test(v.charAt(i + 1))) && (i === 0 || !/[\w-]/.test(v.charAt(i - 1)))) {
        var m = /^[a-z-][\w-]*/i.exec(v.slice(i)), name = m[0], low = name.toLowerCase();
        if (v.charAt(i + name.length) === "(") {
          var end = closeOf(v, i + name.length);
          if (end < 0) { out += v.slice(i); break; }
          var whole = v.slice(i, end + 1);
          if (low === "url") { out += whole; i = end + 1; continue; }
          if (MATH_FN[low]) {
            var r = evaluate(whole);
            if (r) { out += fmt(r.v); i = end + 1; continue; }
            out += unknownMath(low, v.slice(i + name.length + 1, end));
            i = end + 1; continue;
          }
          out += name + "(" + resolveValue(v.slice(i + name.length + 1, end)) + ")";
          i = end + 1; continue;
        }
        out += name; i += name.length; continue;
      }
      if (/[\d.+-]/.test(c) && (i === 0 || !/[\w.]/.test(v.charAt(i - 1)))) {
        var dm = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/i.exec(v.slice(i));
        if (dm) {
          out += fmt(parseFloat(dm[0]) * UNIT[dm[1].toLowerCase()]());
          i += dm[0].length; continue;
        }
      }
      out += c; i++;
    }
    return out;
  }

  /* calc/clamp/min/max with a part nobody can know here (a %, an em, a var()). calc() is as old
     as these sets, so it stays, with its container units in pixels. A clamp() keeps its preferred
     value and a min()/max() its first, inside calc(): not the exact answer, but a size, which is
     more than the engine would otherwise keep. None of the screens has one of these today. */
  function unknownMath(fn, inner) {
    var body = resolveValue(inner);
    if (fn === "calc") return "calc(" + body + ")";
    var parts = splitTop(body, ",");
    var pick = fn === "clamp" && parts.length === 3 ? parts[1] : parts[0];
    return "calc(" + pick.replace(/^\s+|\s+$/g, "") + ")";
  }

  function splitTop(s, ch) {
    var out = [], depth = 0, last = 0, quote = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === ch && !depth) { out.push(s.slice(last, i)); last = i + 1; }
    }
    out.push(s.slice(last));
    return out;
  }

  /* ---------------------------------------------------------------- CSS text into rules */
  function stripComments(t) {
    var out = "", i = 0, n = t.length;
    while (i < n) {
      var c = t.charAt(i);
      if (c === "/" && t.charAt(i + 1) === "*") { var e = t.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; out += " "; continue; }
      if (c === '"' || c === "'") {
        var j = i + 1;
        while (j < n && t.charAt(j) !== c) { if (t.charAt(j) === "\\") j++; j++; }
        out += t.slice(i, j + 1); i = j + 1; continue;
      }
      out += c; i++;
    }
    return out;
  }

  /* index of the next c at depth 0 (outside brackets and strings), from i */
  function nextTop(t, i, chars) {
    var depth = 0, quote = "";
    for (var j = i; j < t.length; j++) {
      var c = t.charAt(j);
      if (quote) { if (c === "\\") j++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (!depth && chars.indexOf(c) >= 0) return j;
    }
    return -1;
  }

  function parseDecls(body) {
    var out = [], parts = splitTop(body, ";");
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i], k = s.indexOf(":");
      if (k < 0) { if (/\S/.test(s)) out.push({ raw: s }); continue; }
      var p = s.slice(0, k).replace(/^\s+|\s+$/g, ""), v = s.slice(k + 1), imp = false;
      var im = /!\s*important\s*$/i.exec(v);
      if (im) { imp = true; v = v.slice(0, im.index); }
      out.push({ p: p.toLowerCase(), v: v.replace(/^\s+|\s+$/g, ""), imp: imp });
    }
    return out;
  }

  var NESTED = /^@(media|supports|document|-moz-document|layer|container)\b/i, FRAMES = /^@(-webkit-)?keyframes\b/i;
  function parseBlock(t, from, to) {
    var nodes = [], i = from;
    while (i < to) {
      var open = nextTop(t, i, "{;}");
      if (open < 0 || open >= to) { if (/\S/.test(t.slice(i, to))) nodes.push({ raw: t.slice(i, to) }); break; }
      var c = t.charAt(open), pre = t.slice(i, open).replace(/^\s+|\s+$/g, "");
      if (c === "}") { i = open + 1; continue; }
      if (c === ";") { if (pre) nodes.push({ raw: pre + ";" }); i = open + 1; continue; }
      var depth = 0, end = -1, quote = "";
      for (var j = open; j < to; j++) {
        var ch = t.charAt(j);
        if (quote) { if (ch === "\\") j++; else if (ch === quote) quote = ""; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (!depth) { end = j; break; } }
      }
      if (end < 0) end = to;
      if (NESTED.test(pre)) nodes.push({ at: pre, kids: parseBlock(t, open + 1, end) });
      else if (FRAMES.test(pre)) nodes.push({ at: pre, frames: true, kids: parseBlock(t, open + 1, end) });
      else if (pre.charAt(0) === "@") nodes.push({ at: pre, decls: parseDecls(t.slice(open + 1, end)) });
      else nodes.push({ sel: pre, decls: parseDecls(t.slice(open + 1, end)) });
      i = end + 1;
    }
    return nodes;
  }

  /* ---------------------------------------------------------------- declarations, rewritten */
  var STRIP_PROP = { "aspect-ratio": 1, "inset": 1, "backdrop-filter": 1, "text-wrap": 1, "text-wrap-mode": 1,
                     "text-wrap-style": 1, "container-type": 1, "container-name": 1, "container": 1,
                     "translate": 1, "scale": 1, "rotate": 1, "accent-color": 1, "content-visibility": 1 };
  /* what Chromium 68 throws away, by value */
  var DROP_VALUE = /\d(cqw|cqh|cqi|cqb|cqmin|cqmax|dvh|svh|lvh|dvw|svw|lvw)\b|(^|[^\w-])(clamp|min|max|color-mix)\(/i;
  var COSMETIC = { "backdrop-filter": 1, "text-wrap": 1, "text-wrap-mode": 1, "text-wrap-style": 1, "container-type": 1,
                   "container-name": 1, "container": 1, "hyphens": 1 };

  function oldWouldDrop(p, v) {
    if (STRIP_PROP[p]) return true;
    if (/^overflow(-x|-y)?$/.test(p) && /\bclip\b/.test(v)) return true;
    return DROP_VALUE.test(v);
  }
  /* What THIS engine will throw away: on a real old set, the ones on the list that it says it
     cannot read (Chromium 91 has inset and aspect-ratio, so those are not left over there); when
     forced, the whole list, because the modern engine reading the page is standing in for 68. */
  function engineDrops(p, v) {
    if (!oldWouldDrop(p, v)) return false;
    if (FORCE) return true;
    try { return !w.CSS.supports(p, v); } catch (e) { return true; }
  }

  function sides(v) {
    var parts = splitTop(v.replace(/^\s+|\s+$/g, ""), " ").filter(function (x) { return x !== ""; });
    if (!parts.length) return null;
    if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
    if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
    if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
    return [parts[0], parts[1], parts[2], parts[3]];
  }

  function pxOf(v) { var m = /^(-?[\d.]+)px$/.exec(v); return m ? parseFloat(m[1]) : null; }

  function flexInfo(decls) {
    var info = { display: "", dir: "", wrap: "", rg: null, cg: null };
    for (var i = 0; i < decls.length; i++) {
      var x = decls[i];
      if (!x.p) continue;
      if (x.p === "display") info.display = x.v;
      else if (x.p === "flex-direction") info.dir = x.v;
      else if (x.p === "flex-wrap") info.wrap = x.v;
      else if (x.p === "flex-flow") {
        var f = x.v.split(/\s+/);
        for (var k = 0; k < f.length; k++) { if (/wrap/.test(f[k])) info.wrap = f[k]; else if (/row|column/.test(f[k])) info.dir = f[k]; }
      }
      else if (x.p === "gap" || x.p === "grid-gap") { var g = splitTop(x.v, " ").filter(function (s) { return s; }); info.rg = g[0]; info.cg = g[1] || g[0]; }
      else if (x.p === "row-gap" || x.p === "grid-row-gap") info.rg = x.v;
      else if (x.p === "column-gap" || x.p === "grid-column-gap") info.cg = x.v;
    }
    return info;
  }

  /* One declaration list, resolved. `ctx` collects what is left over and the gap work. */
  function rewriteDecls(decls, ctx) {
    var out = [], i, x, height = false, width = null, ratio = null, blur = false;
    for (i = 0; i < decls.length; i++) {
      x = decls[i];
      if (!x.p) { out.push(x); continue; }
      var v = resolveValue(x.v);
      if (x.p === "height") height = true;
      if (x.p === "backdrop-filter" || x.p === "-webkit-backdrop-filter") blur = true;
      if (x.p === "width") width = v;
      if (x.p === "aspect-ratio") {
        var am = /^\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*$/.exec(v);
        if (am) ratio = parseFloat(am[1]) / (am[2] ? parseFloat(am[2]) : 1);
      }
      if (x.p === "inset" && NEED.inset) {
        var s = sides(v);
        if (s) {
          out.push({ p: "top", v: s[0], imp: x.imp }, { p: "right", v: s[1], imp: x.imp },
                   { p: "bottom", v: s[2], imp: x.imp }, { p: "left", v: s[3], imp: x.imp });
          if (!NEED.strip) out.push({ p: x.p, v: v, imp: x.imp });
          continue;
        }
      }
      out.push({ p: x.p, v: v, imp: x.imp });
    }
    /* NO BLUR BEHIND A PANEL. Without backdrop-filter (Chromium 76) the wall behind a glass panel
       shows through sharp: the "GAME ON HERE" floor read through the set-up card. A panel that was
       nearly opaque anyway (alpha .85 or more) is made most of the way opaque instead. */
    if (blur && NEED.backdrop) {
      for (i = 0; i < out.length; i++) {
        if (out[i].p === "background" || out[i].p === "background-color") {
          out[i] = { p: out[i].p, v: out[i].v.replace(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/g, function (all, r, g, b, a) {
            a = parseFloat(a);
            return a >= 0.85 && a < 1 ? "rgba(" + r + "," + g + "," + b + "," + (Math.round((1 - (1 - a) / 4) * 1000) / 1000) + ")" : all;
          }), imp: out[i].imp };
        }
      }
    }
    if (ratio && NEED.aspect && !height && width !== null && pxOf(width) !== null && ratio > 0) {
      out.push({ p: "height", v: fmt(pxOf(width) / ratio), imp: false });
    }
    var kept = [];
    for (i = 0; i < out.length; i++) {
      x = out[i];
      if (x.p && (NEED.strip ? oldWouldDrop(x.p, x.v) : engineDrops(x.p, x.v))) {
        var replaced = (x.p === "inset" && NEED.inset) || (x.p === "aspect-ratio" && NEED.aspect && ratio && width !== null && pxOf(width) !== null);
        /* overflow:clip falls back to visible; the page and body already hide their overflow */
        var cosmetic = COSMETIC[x.p] || /^overflow(-x|-y)?$/.test(x.p);
        if (!replaced && !cosmetic && ctx) ctx.left.push(x.p + ":" + x.v);
        if (NEED.strip) continue;
      }
      kept.push(x);
    }
    return kept;
  }

  function declText(decls) {
    var s = [];
    for (var i = 0; i < decls.length; i++) {
      var x = decls[i];
      if (!x.p) { if (x.raw && /\S/.test(x.raw)) s.push(x.raw); continue; }
      s.push(x.p + ":" + x.v + (x.imp ? "!important" : ""));
    }
    return s.join(";");
  }

  /* ---------------------------------------------------------------- gap on a flex box
     Old engines lay a flex box out with no gap at all. The same space is given as margins on the
     children instead, as a rule for each gap rule's selector. Which way the box runs is read off
     an element it matches (a rule like .runlayer{gap} only says flex-direction, its .layer says
     flex), or off the rule itself while no such element exists yet; a rule with neither waits. */
  var GAP = [];                      /* {sel, media:[...], rg, cg, info, done, css} */
  var genStyle = null;

  function addGap(sel, media, info) {
    if (info.rg === null && info.cg === null) return;
    var sels = splitTop(sel, ",");
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i].replace(/^\s+|\s+$/g, "");
      if (s) GAP.push({ sel: s, media: media.slice(), info: info, done: false, css: "" });
    }
  }

  function gapContext(g) {
    var el = null;
    try {
      var all = d.querySelectorAll(g.sel);
      for (var i = 0; i < all.length && !el; i++) {
        var cs = w.getComputedStyle(all[i]);
        if (cs.display !== "none") el = cs;
      }
    } catch (e) { return { kind: "skip" }; }        /* a selector this engine cannot read */
    var disp = el ? el.display : g.info.display, dir = el ? el.flexDirection : g.info.dir, wrap = el ? el.flexWrap : g.info.wrap;
    if (!disp) return null;
    if (/grid/.test(disp)) return { kind: "grid" };
    if (!/flex/.test(disp)) return { kind: "skip" };
    return { kind: "flex", dir: dir || "row", wrap: wrap || "nowrap" };
  }

  function gapCss(g) {
    var cx = gapContext(g);
    if (!cx) return null;
    var rg = g.info.rg === null ? "0px" : g.info.rg, cg = g.info.cg === null ? "0px" : g.info.cg;
    var css = "";
    if (cx.kind === "grid") {
      if (NEED.gridgap) css = g.sel + "{grid-row-gap:" + rg + ";grid-column-gap:" + cg + "}";
    } else if (cx.kind === "flex" && NEED.gap) {
      /* "* + *" and nothing heavier, so a child's own margin rule still wins, as it does over a gap
         on a new engine: the set-up card's button sits at the foot of its card on margin-top:auto,
         and a heavier selector here took that away. A first child that is hidden is not a gap, so
         the child after it is given its margin back. */
      var side = /column/.test(cx.dir) ? (/reverse/.test(cx.dir) ? "bottom" : "top") : (/reverse/.test(cx.dir) ? "right" : "left");
      var size = /column/.test(cx.dir) ? rg : cg;
      css = g.sel + ">*+*{margin-" + side + ":" + size + "}" +
            g.sel + ">.hidden:first-child+*," + g.sel + ">[hidden]:first-child+*{margin-" + side + ":0}";
      /* A ROW THAT WRAPS. Margins cannot know where a line breaks, so after layout the child that
         starts each new line is marked (data-vpwl: no left margin) and every child below the first
         line is marked (data-vpwr: the row gap above it). See fixWraps. The set-up card's two halves
         stack on a TV this way, and without it the second sat indented and touching the first. */
      if (/wrap/.test(cx.wrap) && cx.wrap !== "nowrap" && !/column/.test(cx.dir)) {
        css += g.sel + ">[data-vpwl]{margin-" + side + ":0}" + g.sel + ">[data-vpwr]{margin-top:" + rg + "}";
        g.wrap = true;
      }
      if (NEED.strip) css += g.sel + "{row-gap:0!important;column-gap:0!important}";
    }
    for (var i = g.media.length - 1; i >= 0 && css; i--) css = g.media[i] + "{" + css + "}";
    return css;
  }


  var gapQueued = 0;
  function settleGaps() {
    gapQueued = 0;
    if (!GAP.length) return;
    var changed = false, css = [];
    for (var i = 0; i < GAP.length; i++) {
      var g = GAP[i];
      if (!g.done) {
        var c = gapCss(g);
        if (c !== null) { g.done = true; g.css = c; changed = true; }
      }
      if (g.css) css.push(g.css);
    }
    if (!changed && genStyle) { fixWraps(); return; }
    if (!genStyle) {
      genStyle = d.createElement("style");
      genStyle.id = "vp-oldtv-gap";
      genStyle.__vpOldOwn = true;
      (d.head || d.documentElement).appendChild(genStyle);
    }
    genStyle.textContent = css.join("\n");
    fixWraps();
  }
  function queueGaps() { if (!gapQueued) gapQueued = w.setTimeout(settleGaps, 30); }

  /* Which children of a wrapping row start a new line, and which sit below the first one. Measured
     with the marks off, then marked, and not measured again until the box's width, its number of
     children or its text changes: taking a line-start's left margin away can, at the edge, let it
     fit back on the line above, and a box must not flip between the two for ever. */
  function fixWraps() {
    for (var i = 0; i < GAP.length; i++) {
      var g = GAP[i];
      if (!g.wrap) continue;
      var boxes;
      try { boxes = d.querySelectorAll(g.sel); } catch (e) { continue; }
      for (var b = 0; b < boxes.length; b++) {
        var box = boxes[b];
        if (!box.getBoundingClientRect().width) continue;
        var kids = [], k;
        for (k = 0; k < box.children.length; k++) kids.push(box.children[k]);
        var sig = box.clientWidth + ":" + kids.length + ":" + (box.textContent || "").length;
        if (box.__vpWrapSig === sig) continue;
        box.__vpWrapSig = sig;
        for (k = 0; k < kids.length; k++) { kids[k].removeAttribute("data-vpwl"); kids[k].removeAttribute("data-vpwr"); }
        var prev = null, below = false, starts = [], rows = [];
        for (k = 0; k < kids.length; k++) {
          var r = kids[k].getBoundingClientRect();
          if (!r.width && !r.height) continue;
          var pos = w.getComputedStyle(kids[k]).position;
          if (pos === "absolute" || pos === "fixed") continue;
          if (prev && (r.left < prev.left - 0.5 || r.top >= prev.bottom - 0.5)) { below = true; starts.push(kids[k]); }
          if (below) rows.push(kids[k]);
          prev = r;
        }
        for (k = 0; k < starts.length; k++) starts[k].setAttribute("data-vpwl", "");
        for (k = 0; k < rows.length; k++) rows[k].setAttribute("data-vpwr", "");
      }
    }
  }

  /* ---------------------------------------------------------------- <style> elements */
  var STYLES = [];
  var LEFT = [];

  function renderSheet(text, media, ctx) {
    var t = stripComments(text);
    return renderNodes(parseBlock(t, 0, t.length), media, ctx);
  }
  function renderNodes(nodes, media, ctx) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.raw) { out.push(n.raw); continue; }
      if (n.kids) {
        var inner = renderNodes(n.kids, n.frames ? null : media.concat([n.at]), n.frames ? { left: ctx.left, frames: true } : ctx);
        out.push(n.at + "{" + inner + "}");
        continue;
      }
      var decls = rewriteDecls(n.decls, ctx);
      if (n.sel && !ctx.frames && media) {
        var info = flexInfo(n.decls);
        if (info.rg !== null || info.cg !== null) {
          info.rg = info.rg === null ? null : resolveValue(info.rg);
          info.cg = info.cg === null ? null : resolveValue(info.cg);
          addGap(n.sel, media, info);
        }
      }
      out.push((n.sel || n.at) + "{" + declText(decls) + "}");
    }
    return out.join("\n");
  }

  function doStyle(st) {
    if (st.__vpOldOwn) return;
    var text = st.textContent || "";
    if (st.__vpOldLast === text) return;              /* ours, already */
    st.__vpOldOrig = text;
    var ctx = { left: [] };
    var out = renderSheet(text, [], ctx);
    for (var i = 0; i < ctx.left.length; i++) LEFT.push(ctx.left[i]);
    st.__vpOldLast = out;
    st.textContent = out;
    if (STYLES.indexOf(st) < 0) STYLES.push(st);
  }

  function redoStyles() {
    var keep = [];                                    /* the inline boxes' gaps are redone by redoInline */
    for (var g = 0; g < GAP.length; g++) if (GAP[g].sel.indexOf("[data-vpgap=") === 0) { GAP[g].done = false; keep.push(GAP[g]); }
    GAP = keep; LEFT = [];
    for (var i = 0; i < STYLES.length; i++) {
      var st = STYLES[i];
      if (st.textContent !== st.__vpOldLast) { st.__vpOldLast = null; doStyle(st); continue; }   /* a script rewrote it */
      var ctx = { left: [] };
      var out = renderSheet(st.__vpOldOrig, [], ctx);
      for (var k = 0; k < ctx.left.length; k++) LEFT.push(ctx.left[k]);
      st.__vpOldLast = out;
      st.textContent = out;
    }
  }

  /* ---------------------------------------------------------------- style="" attributes */
  var INLINE = [], inlineGapN = 0;
  var WORK = /\d(cqw|cqh|cqi|cqb|cqmin|cqmax)\b|(^|[^\w-])(clamp|min|max|calc)\(|(^|[;\s])(inset|aspect-ratio|gap|row-gap|column-gap)\s*:/i;
  function doInline(el) {
    var s = el.getAttribute && el.getAttribute("style");
    if (!s || s === el.__vpOldLast) return;
    if (!WORK.test(s) && !(NEED.strip && /backdrop-filter|text-wrap|clip/.test(s))) return;
    var decls = parseDecls(s);
    var ctx = { left: [] };
    var out = rewriteDecls(decls, ctx);
    for (var i = 0; i < ctx.left.length; i++) LEFT.push(ctx.left[i]);
    var info = flexInfo(decls);
    if ((info.rg !== null || info.cg !== null) && /flex/.test(info.display)) {
      var id = el.getAttribute("data-vpgap");
      if (!id) { id = "g" + (++inlineGapN); el.setAttribute("data-vpgap", id); }
      info.rg = info.rg === null ? null : resolveValue(info.rg);
      info.cg = info.cg === null ? null : resolveValue(info.cg);
      var sel = '[data-vpgap="' + id + '"]';
      var found = false;
      for (var k = 0; k < GAP.length; k++) if (GAP[k].sel === sel) { GAP[k].info = info; GAP[k].done = false; found = true; }
      if (!found) addGap(sel, [], info);
      if (NEED.strip && NEED.gap) out = out.filter(function (x) { return !/^(gap|row-gap|column-gap)$/.test(x.p || ""); });
      queueGaps();
    }
    var text = declText(out);
    el.__vpOldOrig = s;
    el.__vpOldLast = text;
    el.setAttribute("style", text);
    if (INLINE.indexOf(el) < 0) INLINE.push(el);
  }

  function redoInline() {
    var keep = [];
    for (var i = 0; i < INLINE.length; i++) {
      var el = INLINE[i];
      if (!d.documentElement.contains(el)) continue;
      keep.push(el);
      if (el.getAttribute("style") === el.__vpOldLast) {       /* untouched since: do it again */
        var orig = el.__vpOldOrig;
        el.__vpOldLast = null;
        el.setAttribute("style", orig);
        doInline(el);
      }
    }
    INLINE = keep;
  }

  function sweep(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === "STYLE") { doStyle(root); return; }
    if (root.hasAttribute && root.hasAttribute("style")) doInline(root);
    var all = root.querySelectorAll ? root.querySelectorAll("style,[style]") : [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].tagName === "STYLE") doStyle(all[i]); else doInline(all[i]);
    }
  }

  /* ---------------------------------------------------------------- start, and keep up */
  measure();
  sweep(d.documentElement);
  settleGaps();

  try {
    /* style="" only: this file never writes a class or a style attribute it would not recognise as
       its own, and its line marks (data-vpwl, data-vpwr) are not watched, so its own writes cannot
       run it in a circle (the 28 Aug freeze was an observer on every attribute whose callback wrote
       a style). */
    new MutationObserver(function (recs) {
      var gaps = false;
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === "attributes") { doInline(r.target); continue; }
        gaps = true;                                   /* new children or new words: a row may wrap anew */
        var t = r.target;
        if (t && t.nodeType === 1 && t.tagName === "STYLE") { doStyle(t); gaps = true; continue; }
        if (t && t.parentNode && t.parentNode.tagName === "STYLE") { doStyle(t.parentNode); gaps = true; continue; }
        for (var k = 0; k < r.addedNodes.length; k++) {
          var n = r.addedNodes[k];
          if (n.nodeType === 1) { sweep(n); gaps = true; }
        }
      }
      if (gaps && GAP.length) queueGaps();
    }).observe(d.documentElement, { childList: true, subtree: true, characterData: true,
                                    attributes: true, attributeFilter: ["style"] });
  } catch (e) {}

  var sizeT = 0;
  function resized() {
    sizeT = 0;
    if (!measure()) return;
    redoStyles();
    redoInline();
    settleGaps();
    if (typeof w.VP_FIT === "function") { try { w.VP_FIT(); } catch (e) {} }
  }
  function onSize() { if (sizeT) w.clearTimeout(sizeT); sizeT = w.setTimeout(resized, 120); }
  w.addEventListener("resize", onSize);
  w.addEventListener("orientationchange", onSize);
  function ready() { sweep(d.body); resized(); settleGaps(); }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", ready);
  else ready();
  w.addEventListener("load", function () { resized(); settleGaps(); });

  w.VPOldTV = {
    active: true, force: FORCE, need: NEED,
    metrics: function () { return { cw: M.cw, ch: M.ch, vw: M.vw, vh: M.vh, rem: M.rem }; },
    leftovers: function () { return LEFT.slice(); },
    pendingGaps: function () { var p = []; for (var i = 0; i < GAP.length; i++) if (!GAP[i].done) p.push(GAP[i].sel); return p; },
    resolve: resolveValue
  };
})(window, document);
