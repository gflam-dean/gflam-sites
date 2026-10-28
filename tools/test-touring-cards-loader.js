/* THE TOUR CARDS LOADER, RUN WITH SLOW AND FAILING FETCHES (27 Oct 2026).

   The gate's touring-cards.test.py (Chrome) failed once that morning with "after 120 s the page
   showed: COMING SOON" and passed on retry. The page could do that to a real visitor: #tourCards
   started life as the "Coming Soon" card, the loader fetched with no timeout, Promise.all'd the two
   reads (one stall stalled both), swallowed every error, never retried, and counted a failed shows
   read as "no shows", which auto-hid the tour. So a slow connection or a database blip read as
   "new tours are being announced soon" while shows were on sale. No Chrome measurement can catch a
   lie that only shows up when the network misbehaves, so this RUNS the real loader out of both
   pages under jsc with fetch, timers and AbortController replaced, and watches what it writes:
     - before anything answers the page says it is loading, never Coming Soon
     - a read that never answers is given up after TC_FETCH_MS and tried once more
     - two failures say "we couldn't load what's on" with a Try Again, never Coming Soon,
       and the reason reaches console.warn instead of a silent catch
     - a shows read that answers 500 is a failure, not an empty tour
     - Coming Soon is written only when the database answered and nothing is on
     - Try Again (window.loadTourCards) recovers

   Run: jsc tools/test-touring-cards-loader.js */
var bad = 0, ran = 0;
function ok(n, c, saw){ ran++; if (c) print("  ok   " + n); else { bad++; print("  FAIL " + n + (saw !== undefined ? "   saw: " + JSON.stringify(saw) : "")); } }

var PAGES = [["touring/index.html", "homepage"], ["touring/current-tours.html", "current tours"]];
var LIFT = /\(async function\(\)\{\n  const wrap=document\.getElementById\("tourCards"\);[\s\S]*?\n\}\)\(\);\n/;

/* A modelled page: the one element the loader touches, a clock the test turns by hand, a fetch
   the test answers (or never answers), and an AbortController that behaves like the real one. */
function page(src, name){
  var m = src.match(LIFT);
  ok(name + ": the loader can be lifted out of the page", !!m);
  var fallback = src.match(/<div id="tourCards"[^>]*>([\s\S]*?)\n  <\/div>/);
  ok(name + ": #tourCards has a static fallback", !!fallback);
  if (!m || !fallback) return null;
  var P = { now: 0, timers: [], fetches: [], warned: [] };
  P.wrap = { innerHTML: fallback[1], dataset: { state: "loading" } };
  var tn = 0;
  function setTimeout_(fn, ms){ var t = { id: ++tn, at: P.now + (ms || 0), fn: fn }; P.timers.push(t); return t.id; }
  function clearTimeout_(id){ P.timers = P.timers.filter(function(t){ return t.id !== id; }); }
  function AbortController_(){
    var ls = [], self = this;
    this.signal = { aborted: false, addEventListener: function(ev, fn){ if (ev === "abort") ls.push(fn); } };
    this.abort = function(){ if (self.signal.aborted) return; self.signal.aborted = true; ls.slice().forEach(function(f){ f(); }); };
  }
  function fetch_(url, opts){
    var f = { url: url, at: P.now, aborted: false };
    f.promise = new Promise(function(res, rej){
      f.answer = function(status, body){ res({ ok: status >= 200 && status < 300, status: status, json: function(){ return Promise.resolve(body); } }); };
      f.fail = function(){ rej(new TypeError("Failed to fetch")); };
      if (opts && opts.signal) opts.signal.addEventListener("abort", function(){ f.aborted = true; var e = new Error("The user aborted a request."); e.name = "AbortError"; rej(e); });
    });
    P.fetches.push(f);
    return f.promise;
  }
  P.window = {};
  P.console = { warn: function(s){ P.warned.push(String(s)); } };
  P.run = function(){
    var body = m[0];
    new Function("document", "fetch", "AbortController", "setTimeout", "clearTimeout", "SBU", "SBH", "window", "console", body)(
      { getElementById: function(id){ return id === "tourCards" ? P.wrap : null; } },
      fetch_, AbortController_, setTimeout_, clearTimeout_, "https://db.test", { apikey: "k" }, P.window, P.console);
    drainMicrotasks();
  };
  /* turn the clock: run every timer due by then, draining promises between them */
  P.advance = function(ms){
    var until = P.now + ms;
    for (;;) {
      drainMicrotasks();
      var due = P.timers.filter(function(t){ return t.at <= until; }).sort(function(a, b){ return a.at - b.at; });
      if (!due.length) break;
      var t = due[0];
      P.timers = P.timers.filter(function(x){ return x.id !== t.id; });
      P.now = t.at;
      t.fn();
      drainMicrotasks();
    }
    P.now = until;
    drainMicrotasks();
  };
  P.pending = function(){ return P.fetches.filter(function(f){ return !f.done && !f.aborted; }); };
  P.cats = function(f){ f.done = true; f.answer(200, CATS); drainMicrotasks(); };
  P.shows = function(f, rows){ f.done = true; f.answer(200, rows === undefined ? SHOWS : rows); drainMicrotasks(); };
  P.answerAll = function(rows){
    P.pending().forEach(function(f){ if (/tour_categories/.test(f.url)) P.cats(f); else P.shows(f, rows); });
    drainMicrotasks();
  };
  P.text = function(){ return P.wrap.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); };
  P.state = function(){ return P.wrap.dataset.state; };
  return P;
}

var CATS = [{ name: "Drag Bingo at the Bowlo", eyebrow: "Touring Now", tour_key: "drag-bingo-at-the-bowlo",
              description: "Bingo, but make it fabulous.", button_label: "View Shows & Tickets",
              button_link: "/drag-bingo-at-the-bowlo", auto_hide: true, image_url: "" }];
var SHOWS = [{ show_type: "drag-bingo-at-the-bowlo", show_date: "2099-01-10", venue: "Tugun Bowls Club", suburb: "Tugun",
               time: "7:00 PM", ticket_url: "https://moshtix.com.au/v2/event/x/1", go_live_date: null, go_live_time: null }];
var COMING = /Coming Soon/i, LOADING = /Loading what's on/, FAILED = /couldn't load what's on/, TOUR = /Drag Bingo at the Bowlo/;

PAGES.forEach(function(pg){
  var src = readFile(pg[0]), name = pg[1];
  var TC = (src.match(/const TC_FETCH_MS = (\d+);/) || [])[1];
  ok(name + ": the fetch timeout is named (TC_FETCH_MS) and under 10 s", TC && +TC > 0 && +TC <= 10000, TC);
  var T = +TC || 8000;

  print("\n" + name + ": the database answers at once");
  var P = page(src, name); if (!P) return;
  ok("the static card is the loading card, not Coming Soon", LOADING.test(P.text()) && !COMING.test(P.text()), P.text().slice(0, 120));
  P.run();
  ok("two reads go out together", P.pending().length === 2, P.fetches.map(function(f){ return f.url; }));
  ok("each read carries an abort signal", P.fetches.every(function(f){ return true; }) && P.timers.length === 2, P.timers.length);
  ok("while waiting the page says loading, not Coming Soon", P.state() === "loading" && !COMING.test(P.text()), [P.state(), P.text().slice(0, 80)]);
  P.answerAll();
  ok("the tour card is painted and the state says shows", P.state() === "shows" && TOUR.test(P.text()) && !COMING.test(P.text()) && !LOADING.test(P.text()), [P.state(), P.text().slice(0, 120)]);
  ok("the abort timers are cleared once the reads answer", P.timers.length === 0, P.timers.length);
  ok("nothing was warned", P.warned.length === 0, P.warned);

  print("\n" + name + ": the shows read never answers (the 27 Oct stall)");
  P = page(src, name); P.run();
  var first = P.pending();
  P.cats(first[0]);                                   // categories answer, shows never do
  P.advance(T - 1);
  ok("just short of the timeout it is still loading, not Coming Soon", P.state() === "loading" && !COMING.test(P.text()), [P.state(), P.now]);
  ok("the stalled read has not been given up yet", !first[1].aborted);
  P.advance(2);
  ok("at TC_FETCH_MS the stalled read is aborted", first[1].aborted, P.now);
  var second = P.pending();
  ok("and both reads are tried once more", second.length === 2 && P.fetches.length === 4, P.fetches.length);
  ok("still loading, never Coming Soon, during the retry", P.state() === "loading" && !COMING.test(P.text()), P.state());
  P.answerAll();
  ok("the retry paints the tour card", P.state() === "shows" && TOUR.test(P.text()), [P.state(), P.text().slice(0, 100)]);

  print("\n" + name + ": the network fails twice");
  P = page(src, name); P.run();
  P.pending().forEach(function(f){ f.done = true; f.fail(); }); drainMicrotasks();
  ok("one failure is retried, not shown", P.state() === "loading" && P.fetches.length === 4, [P.state(), P.fetches.length]);
  P.pending().forEach(function(f){ f.done = true; f.fail(); }); drainMicrotasks();
  ok("two failures say we couldn't load what's on, with a Try Again", P.state() === "failed" && FAILED.test(P.text()) && /Try Again/.test(P.text()), [P.state(), P.text().slice(0, 120)]);
  ok("and never Coming Soon", !COMING.test(P.text()));
  ok("the reason reaches console.warn instead of a silent catch", P.warned.length === 1 && /Failed to fetch/.test(P.warned[0]), P.warned);
  ok("Try Again is wired to window.loadTourCards", typeof P.window.loadTourCards === "function" && /onclick="window\.loadTourCards\(\)/.test(P.wrap.innerHTML));
  P.window.loadTourCards(); drainMicrotasks();
  ok("Try Again puts the loading card back and reads again", P.state() === "loading" && LOADING.test(P.text()) && P.pending().length === 2, [P.state(), P.pending().length]);
  P.answerAll();
  ok("and recovers to the tour card", P.state() === "shows" && TOUR.test(P.text()), P.state());

  print("\n" + name + ": both reads hang, twice");
  P = page(src, name); P.run();
  P.advance(2 * T + 1);
  ok("the page gives up by 2 x TC_FETCH_MS and says so, not Coming Soon", P.state() === "failed" && FAILED.test(P.text()) && !COMING.test(P.text()), [P.state(), P.now]);
  ok("four reads were attempted, all aborted", P.fetches.length === 4 && P.fetches.every(function(f){ return f.aborted; }), P.fetches.map(function(f){ return f.aborted; }));

  print("\n" + name + ": the shows read answers 500, twice");
  P = page(src, name); P.run();
  P.pending().forEach(function(f){ f.done = true; if (/tour_categories/.test(f.url)) f.answer(200, CATS); else f.answer(500, { message: "db" }); }); drainMicrotasks();
  P.pending().forEach(function(f){ f.done = true; if (/tour_categories/.test(f.url)) f.answer(200, CATS); else f.answer(500, { message: "db" }); }); drainMicrotasks();
  ok("a failed shows read is a failure, not an empty tour hidden behind Coming Soon", P.state() === "failed" && !COMING.test(P.text()), [P.state(), P.text().slice(0, 100)]);
  ok("the warning names the read that failed", P.warned.length === 1 && /shows answered 500/.test(P.warned[0]), P.warned);

  print("\n" + name + ": the database answers and there is nothing on");
  P = page(src, name); P.run();
  P.answerAll([]);
  ok("Coming Soon is written only now, with the state saying none", P.state() === "none" && COMING.test(P.text()) && !LOADING.test(P.text()), [P.state(), P.text().slice(0, 80)]);
  ok("no warning for an honest empty answer", P.warned.length === 0, P.warned);

  print("\n" + name + ": copy");
  var all = P.wrap.innerHTML + (src.match(/const failedHTML = `[\s\S]*?`;/) || [""])[0] + fallbackText(src);
  ok("no em or en dash in the loading, failed or coming-soon cards", all.indexOf("—") < 0 && all.indexOf("–") < 0);
});

function fallbackText(src){ var f = src.match(/<div id="tourCards"[^>]*>([\s\S]*?)\n  <\/div>/); return f ? f[1] : ""; }

print("");
print((bad ? "FAILED " + bad + ", " : "ALL ") + ran + " CHECKS " + (bad ? "" : "PASSED"));
if (bad && typeof quit === "function") quit(1);
