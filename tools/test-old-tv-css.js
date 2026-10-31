/* THE OLD-TELEVISION CSS FALLBACK, RUN (1 Nov 2026). venueplay/app/vp-oldtv.js rewrites a screen's
   CSS for an engine without container units (Samsung before 2024, LG before webOS 24): every cqw
   into pixels, every clamp()/min()/max()/calc() worked out, inset into its four sides, aspect-ratio
   into a height, a flex box's gap into margins. This RUNS the real file against a stand-in page and
   checks the numbers it writes, then hands it the REAL <style> of tv.html and every app/ screen
   (and the Punters Reckon board's CSS) and requires that nothing an old engine would throw away is
   left. And on an engine that HAS container units it must change nothing at all.
   tools/old-tv-in-chrome.test.py runs the same file in a real Chrome, on every screen.
   Run: jsc tools/test-old-tv-css.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + saw : "")); } }
var SRC = readFile("venueplay/app/vp-oldtv.js");

function El(tag, text){
  var e = { tagName: tag, nodeType: 1, textContent: text || "", attrs: {}, children: [] };
  e.getAttribute = function(k){ return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; };
  e.setAttribute = function(k, v){ this.attrs[k] = String(v); };
  e.hasAttribute = function(k){ return this.attrs.hasOwnProperty(k); };
  e.querySelectorAll = function(){ return []; };
  return e;
}

/* A page: some <style> text, some inline style="" elements, a wall W x H. */
function page(styles, inline, W, H, opts){
  opts = opts || {};
  var sts = styles.map(function(t){ return El("STYLE", t); });
  var els = (inline || []).map(function(s){ var e = El("DIV"); e.setAttribute("style", s); return e; });
  var added = [], handlers = {}, timers = [];
  var de = El("HTML");
  de.contains = function(){ return true; };
  de.querySelectorAll = function(sel){ return sel === "style,[style]" ? sts.concat(els) : []; };
  de.appendChild = function(x){ added.push(x); return x; };
  var tv = { getBoundingClientRect: function(){ return { width: win.innerWidth, height: win.innerHeight }; } };
  var doc = {
    documentElement: de, head: de, body: El("BODY"), readyState: "complete",
    querySelector: function(s){ return s === ".tv" ? tv : null; },
    querySelectorAll: function(){ return []; },
    createElement: function(t){ return El(t.toUpperCase()); },
    addEventListener: function(){}
  };
  doc.body.querySelectorAll = function(sel){ return sel === "style,[style]" ? sts.concat(els) : []; };
  var win = {
    innerWidth: W, innerHeight: H, location: { search: opts.search || "" },
    CSS: { supports: function(p, v){ return opts.modern ? true : !/cq|clamp|min\(|max\(|inset|aspect|gap/.test(p + " " + v); } },
    getComputedStyle: function(){ return { fontSize: "16px", display: "block" }; },
    addEventListener: function(k, f){ (handlers[k] = handlers[k] || []).push(f); },
    setTimeout: function(f){ timers.push(f); return timers.length; },
    clearTimeout: function(){}
  };
  (new Function("window", "document", "MutationObserver", SRC + "\n//# sourceURL=vp-oldtv.js"))(win, doc, undefined);
  function flush(){ var n = 0; while (timers.length && n++ < 50) timers.shift()(); }
  flush();
  return { win: win, styles: sts, els: els, added: added, flush: flush,
           resize: function(w, h){ win.innerWidth = w; win.innerHeight = h; (handlers.resize || []).forEach(function(f){ f(); }); flush(); } };
}

print("A MODERN ENGINE (container units known): nothing is touched");
var CSS1 = ".a{font-size:clamp(10px,1.3cqw,17px);inset:0}";
var m = page([CSS1], ["margin-top:2.4cqw"], 1920, 1080, { modern: true });
ok("VPOldTV says it is not active", m.win.VPOldTV && m.win.VPOldTV.active === false, JSON.stringify(m.win.VPOldTV));
ok("the <style> is byte for byte what the page shipped", m.styles[0].textContent === CSS1, m.styles[0].textContent);
ok("an inline style is untouched", m.els[0].getAttribute("style") === "margin-top:2.4cqw");
ok("no extra stylesheet is added", m.added.length === 0, m.added.length);

print("\nAN OLD ENGINE at 1920x1080: the numbers it writes");
var p = page([".x{color:red}"], [], 1920, 1080), R = p.win.VPOldTV && p.win.VPOldTV.resolve;
ok("VPOldTV is active and can resolve", p.win.VPOldTV.active === true && typeof R === "function");
var CASES = [
  ["2cqw", "38.4px", "a plain cqw is 1% of the wall"],
  [".8cqw", "15.36px", "a leading-dot number"],
  ["clamp(10px,1.3cqw,17px)", "17px", "clamp at its ceiling"],
  ["clamp(12px,0.5cqw,26px)", "12px", "clamp at its floor"],
  ["clamp(12px,1.35cqw,26px)", "25.92px", "clamp in the middle"],
  ["min(84cqw,1240px)", "1240px", "min()"],
  ["max(2cqw, 40px)", "40px", "max() with a space"],
  ["0 0 min(1.6cqw,2vh)", "0 0 21.6px", "min() of cqw and vh inside a margin"],
  ["calc(5.1cqw + clamp(44px,8cqw,110px))", "207.92px", "calc() around a clamp()"],
  ["clamp(30px,min(4.8cqw,6.5vh),92px)", "70.2px", "a min() inside a clamp()"],
  ["calc(4.6cqw + clamp(44px,8cqw,110px) + 2px)", "200.32px", "three terms"],
  ["94cqh", "1015.2px", "cqh reads the screen's height"],
  ["translate(-50%,-50%)", "translate(-50%,-50%)", "a transform is left alone"],
  ["calc(100% - 2cqw)", "calc(100% - 38.4px)", "a calc() with a % keeps its % and loses its cqw"],
  ["clamp(1em, 2cqw, 3em)", "calc(38.4px)", "an em clamp falls back to its preferred size"],
  ["700 clamp(12px,1.9cqw,22px)/1.35 system-ui,-apple-system,sans-serif", "700 22px/1.35 system-ui,-apple-system,sans-serif", "the font shorthand"],
  ["url(\"a(2cqw).png\")", "url(\"a(2cqw).png\")", "a url() is never touched"],
  ["repeat(3,minmax(10px,1fr))", "repeat(3,minmax(10px,1fr))", "minmax() is not min()"],
  ["0 0 3cqw rgba(255,31,142,.35)", "0 0 57.6px rgba(255,31,142,.35)", "a shadow"],
  ["-1.2cqw", "-23.04px", "a negative"],
  ["radial-gradient(1200px 700px at 80% -10%, rgba(255,31,142,.12), transparent 60%), #050506", "radial-gradient(1200px 700px at 80% -10%, rgba(255,31,142,.12), transparent 60%), #050506", "a gradient is left alone"]
];
CASES.forEach(function(c){ var got = R(c[0]); ok(c[2] + ": " + c[0] + " -> " + c[1], got === c[1], got); });

print("\nAN OLD ENGINE: whole rules");
p = page([".tv{position:fixed;inset:0;container-type:inline-size}" +
          ".qrbig{width:min(46cqw,64vh);aspect-ratio:1;padding:1.4cqw}" +
          ".row{display:flex;gap:1cqw}.col{display:flex;flex-direction:column;gap:.5cqw 2cqw}" +
          ".wr{display:flex;flex-wrap:wrap;gap:2cqw}.gr{display:grid;gap:14px}" +
          "@media (prefers-reduced-motion:reduce){.row{display:flex;gap:2cqw}}.later{gap:3cqw}" +
          "@keyframes pop{from{transform:translateY(5cqw)}to{transform:none}}"],
         ["position:fixed;inset:0;display:flex;gap:1cqw;font-size:clamp(14px,2.6cqw,34px)"], 1920, 1080);
var T = p.styles[0].textContent;
ok("inset:0 becomes its four sides", /\.tv\{position:fixed;top:0;right:0;bottom:0;left:0/.test(T), T.slice(0, 120));
ok("aspect-ratio:1 on a known width gets the height", /\.qrbig\{width:691\.2px;aspect-ratio:1;padding:26\.88px;height:691\.2px\}/.test(T), T.match(/\.qrbig\{[^}]*\}/));
ok("a cqw inside @keyframes is resolved", /translateY\(96px\)/.test(T), T.match(/@keyframes[^]*$/));
ok("no cqw is left anywhere in the sheet", !/\dcq[wh]/.test(T), T.match(/[^;{]*\dcq[wh][^;}]*/));
var G = (p.added[0] && p.added[0].textContent) || "";
ok("the gap stylesheet is added once", p.added.length === 1 && p.added[0].id === "vp-oldtv-gap", p.added.length);
ok("a hidden first child is not a gap: the child after it gets its margin back", G.indexOf(".row>.hidden:first-child+*,.row>[hidden]:first-child+*{margin-left:0}") >= 0, G);
ok("a row flex box's gap becomes a left margin on each child after the first", G.indexOf(".row>*+*{margin-left:19.2px}") >= 0, G);
ok("a column flex box's gap (row value) becomes a top margin", G.indexOf(".col>*+*{margin-top:9.6px}") >= 0, G);
ok("a wrapping row also gets the rules for its line starts and its lower lines", G.indexOf(".wr>[data-vpwl]{margin-left:0}.wr>[data-vpwr]{margin-top:38.4px}") >= 0, G);
ok("a wrapping flex box is spaced as one line, never grown by its gap", G.indexOf(".wr>*+*{margin-left:38.4px}") >= 0 && G.indexOf(".wr>*{") < 0, G);
ok("a grid keeps its gap and gets grid-gap for the oldest engines", G.indexOf(".gr{grid-row-gap:14px;grid-column-gap:14px}") >= 0, G);
ok("a gap inside @media stays inside that @media", G.indexOf("@media (prefers-reduced-motion:reduce){.row>*+*{margin-left:38.4px}") >= 0, G);
var IS = p.els[0].getAttribute("style");
ok("an inline style is resolved and its inset expanded", IS.indexOf("top:0;right:0;bottom:0;left:0") >= 0 && IS.indexOf("font-size:34px") >= 0 && !/cqw/.test(IS), IS);
ok("an inline flex box with a gap is tagged and given margins", p.els[0].getAttribute("data-vpgap") === "g1" && G.indexOf('[data-vpgap="g1"]>*+*{margin-left:19.2px}') >= 0, G);
ok("nothing an old engine would drop is left", p.win.VPOldTV.leftovers().length === 0, p.win.VPOldTV.leftovers());
ok("a gap rule with no flex or grid of its own, and no element on the page yet, waits", p.win.VPOldTV.pendingGaps().join() === ".later", p.win.VPOldTV.pendingGaps());

print("\nTHE WINDOW CHANGES SIZE: done again from the original text");
p.resize(1280, 720);
T = p.styles[0].textContent;
ok("at 1280x720 the QR is min(46cqw,64vh) of the new wall, 460.8px", /\.qrbig\{width:460\.8px;aspect-ratio:1;padding:17\.92px;height:460\.8px\}/.test(T), T.match(/\.qrbig\{[^}]*\}/));
ok("the inline style follows", p.els[0].getAttribute("style").indexOf("font-size:33.28px") >= 0, p.els[0].getAttribute("style"));
ok("and the gap margins follow", (p.added[0].textContent || "").indexOf(".row>*+*{margin-left:12.8px}") >= 0, p.added[0].textContent);

print("\n?oldtv=68: every fallback, and what Chromium 68 ignores is stripped");
p = page([".a{position:absolute;inset:0;backdrop-filter:blur(6px);text-wrap:balance;display:flex;gap:1cqw}"], [], 1920, 1080, { modern: true, search: "?oldtv=68" });
T = p.styles[0].textContent;
ok("forced on a modern engine, it runs", p.win.VPOldTV.active === true && p.win.VPOldTV.force === "68");
ok("inset, backdrop-filter and text-wrap are gone; the four sides are there", !/inset|backdrop|text-wrap/.test(T) && /top:0;right:0;bottom:0;left:0/.test(T), T);
ok("the flex gap is zeroed so only the margins space it", (p.added[0].textContent || "").indexOf(".a{row-gap:0!important;column-gap:0!important}") >= 0, p.added[0] && p.added[0].textContent);
p = page([".pp{background:rgba(10,10,11,.95);backdrop-filter:blur(6px)}.pill{background:rgba(0,0,0,.45);backdrop-filter:blur(6px)}"], [], 1920, 1080, { modern: true, search: "?oldtv=68" });
ok("with no blur behind it, a nearly opaque panel is made more opaque and a see-through one is left", p.styles[0].textContent === ".pp{background:rgba(10,10,11,0.988)}\n.pill{background:rgba(0,0,0,.45)}", p.styles[0].textContent);
p = page([".a{width:2cqw}"], [], 1920, 1080, { modern: true, search: "?oldtv=units" });
ok("?oldtv=units resolves units only: no gap work, nothing stripped", p.styles[0].textContent === ".a{width:38.4px}" && p.win.VPOldTV.need.gap === false, p.styles[0].textContent);

print("\nTHE REAL SCREENS: nothing an old engine would drop is left in any of them");
function styleOf(file){ var s = readFile(file), a = s.indexOf("<style>"), b = s.indexOf("</style>"); return s.slice(a + 7, b); }
var SCREENS = ["venueplay/tv.html", "venueplay/app/trivia/screen.html", "venueplay/app/musical/screen.html",
               "venueplay/app/raffle/screen.html", "venueplay/app/members/screen.html", "venueplay/app/topanswers/screen.html"];
var prb = readFile("venueplay/app/topanswers/pr-board.js").match(/var CSS =\s*([\s\S]*?");\s*\n/);
var prbCss = prb ? (new Function("return " + prb[1]))() : "";
ok("the Punters Reckon board's CSS is found", prbCss.length > 500, prbCss.length);
SCREENS.concat(["PRB"]).forEach(function(f){
  [[1920, 1080], [1280, 720]].forEach(function(sz){
    var src = f === "PRB" ? prbCss : styleOf(f);
    var q = page([src], [], sz[0], sz[1]);
    var out = q.styles[0].textContent, left = q.win.VPOldTV.leftovers();
    var cq = out.match(/[^;{}]*\d(cqw|cqh|cqi|cqb|cqmin|cqmax)\b[^;}]*/);
    var fn = out.match(/[^;{}]*(^|[^\w-])(clamp|min|max)\([^;}]*/);
    var name = (f === "PRB" ? "the Punters Reckon board" : f.replace("venueplay/", "")) + " at " + sz[0];
    ok(name + ": no cqw/cqh left", !cq, cq && cq[0]);
    ok(name + ": no clamp()/min()/max() left", !fn, fn && fn[0]);
    ok(name + ": nothing else an old engine would drop", left.length === 0, left.slice(0, 4).join(" | "));
    ok(name + ": the rules are all still there", (out.match(/\{/g) || []).length >= (src.replace(/\/\*[\s\S]*?\*\//g, "").match(/\{/g) || []).length, (out.match(/\{/g) || []).length);
  });
});

print("\n" + (ran - bad) + " of " + ran + " checks passed");
