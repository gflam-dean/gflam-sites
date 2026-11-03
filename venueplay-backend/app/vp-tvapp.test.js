/* THE LG AND SAMSUNG APPS' REMOTE ON THE VENUE SCREEN (4 Nov 2026).

   Found by Dean in the webOS TV 24 Simulator on 3 Nov 2026: on Test Alpha's venue screen BACK
   "goes straight back out". Measured there over the simulator's DevTools port: a SHORT BACK
   reaches the page as keydown/keyup 461 and vp-tvapp.js shows its hint, a second BACK calls
   webOSSystem.platformBack (the exit question), exactly as built. But a BACK held for one
   second closes the app inside the simulator before the page sees a single key, so the words
   "Hold BACK for 5 seconds for settings" sent staff to the one gesture LG keeps for itself.
   Holding OK for 5 seconds opened Screen settings there, and "Back to the screen" came back.
   So the words now say OK on both TVs.

   This suite RUNS the shipped venueplay/app/vp-tvapp.js against a stand-in window (fake clock,
   fake history, fake webOSSystem / tizen) and checks:
     - it does nothing at all without &app=tizen|webos
     - on webOS and on Tizen the hint and the Reconnecting card say "Hold OK", never "Hold BACK"
     - a short BACK (461 on LG, 10009 on Samsung) shows the hint and never leaves the page
     - a second BACK while the hint is up goes to the TV's home screen (platformBack / hide)
     - a second BACK after the hint has gone shows the hint again, it does not leave
     - holding OK 5 seconds opens the app's settings (history one step back), with a countdown
     - the remote's own key repeat while OK is held does not restart the hold
     - letting go of OK before 5 seconds does not open the settings
     - with the timers held back (a page the TV treats as hidden), a 5-second hold still opens the
       settings, judged by the clock on letting go or on the remote's key repeat

   Run: jsc venueplay-backend/app/vp-tvapp.test.js
*/
var bad = 0, ran = 0;
function pass(n, c, extra) {
  if (typeof n !== "string" || typeof c !== "boolean") throw new Error("pass(name, boolean) called wrongly for " + n);
  ran++; print((c ? "  ok   " : "  FAIL ") + n + (extra ? "   " + extra : "")); if (!c) bad++;
}
function find(rel) {
  var tries = [rel, "../" + rel, "../../" + rel, "../../../" + rel, rel.replace(/^venueplay\/app\//, ""), rel.replace(/^venueplay\//, "")];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 1000) return t; } catch (e) {}
  }
  throw new Error("cannot find " + rel);
}
var SRC = find("venueplay/app/vp-tvapp.js");

/* A stand-in TV page. Everything the script touches, nothing more. */
function makeTv(search, platform) {
  var now = 1000000, timers = [], tid = 0;
  function addTimer(fn, ms, every) { tid++; timers.push({ id: tid, at: now + (ms || 0), fn: fn, every: every ? (ms || 1) : 0 }); return tid; }
  function clear(id) { for (var i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; } }
  function advance(ms) {
    var end = now + ms;
    for (;;) {
      var next = null;
      for (var i = 0; i < timers.length; i++) if (timers[i].at <= end && (!next || timers[i].at < next.at)) next = timers[i];
      if (!next) break;
      now = next.at;
      if (next.every) next.at = now + next.every; else clear(next.id);
      next.fn();
    }
    now = end;
  }
  var listeners = {};
  function on(target) {
    return function (type, fn) { (listeners[target + ":" + type] = listeners[target + ":" + type] || []).push(fn); };
  }
  function el(tag) {
    return { tagName: tag, id: "", className: "", textContent: "", style: {}, children: [],
             appendChild: function (c) { this.children.push(c); return c; }, setAttribute: function () {} };
  }
  var byId = {};
  var body = el("BODY");
  body.appendChild = function (c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; };
  var head = el("HEAD");
  var calls = [];
  var doc = {
    readyState: "complete", body: body, head: head, hidden: false,
    documentElement: { setAttribute: function () {}, style: {} },
    createElement: el,
    getElementById: function (id) { return byId[id] || null; },
    getElementsByTagName: function () { return []; },
    addEventListener: on("document")
  };
  var win = {
    location: { search: search, href: "https://venueplay.com.au/tv" + search },
    history: { go: function (n) { calls.push("history.go(" + n + ")"); } },
    sessionStorage: { setItem: function () {} },
    addEventListener: on("window"),
    console: { info: function () {} }
  };
  if (platform === "webos") {
    win.webOSSystem = { platformBack: function () { calls.push("platformBack"); } };
    win.PalmServiceBridge = function () { this.call = function () {}; };
  }
  if (platform === "tizen") {
    win.tizen = { application: { getCurrentApplication: function () { return { hide: function () { calls.push("tizen.hide"); } }; } } };
    win.webapis = { appcommon: { setScreenSaver: function () {}, AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0 } } };
  }
  win.document = doc;
  win.navigator = { onLine: true };
  win.window = win;
  var FakeDate = { now: function () { return now; } };
  var run = new Function("window", "document", "navigator", "sessionStorage", "console", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", "Date", "MutationObserver", "Image", "webOSSystem", "PalmServiceBridge", SRC);
  run(win, doc, win.navigator, win.sessionStorage, win.console,
      function (f, ms) { return addTimer(f, ms, false); }, clear,
      function (f, ms) { return addTimer(f, ms, true); }, clear,
      FakeDate, function () { this.observe = function () {}; }, function () {}, win.webOSSystem, win.PalmServiceBridge);
  function fire(type, keyCode) {
    var e = { keyCode: keyCode, defaultPrevented: false, preventDefault: function () { this.defaultPrevented = true; } };
    var fs = listeners["window:" + type] || [];
    for (var i = 0; i < fs.length; i++) fs[i](e);
    return e;
  }
  function hint() { var h = byId.vpAppHint; return h && h.className === "on" ? h.textContent : ""; }
  return {
    win: win, calls: calls, advance: advance, hint: hint,
    jump: function (ms) { now += ms; },   // the clock moves, no timer fires (a page the TV holds back)
    keyCount: (listeners["window:keydown"] || []).length,
    press: function (k, ms) { var d = fire("keydown", k); advance(ms || 80); var u = fire("keyup", k); return d.defaultPrevented && u.defaultPrevented; },
    down: function (k) { return fire("keydown", k); },
    up: function (k) { return fire("keyup", k); },
    offline: function () { var fs = listeners["window:offline"] || []; for (var i = 0; i < fs.length; i++) fs[i](); var c = byId.vpAppCard; return c && c.className === "on" ? c.children[0].children[2].textContent : ""; }
  };
}

// ---- nothing outside the apps
var plain = makeTv("?venue=test-alpha", "webos");
pass("without &app=tizen|webos the script does nothing (no VP_TV_APP, no key listeners)",
     !plain.win.VP_TV_APP && plain.keyCount === 0, "listeners " + plain.keyCount);

var CASES = [["webos", 461, "platformBack"], ["tizen", 10009, "tizen.hide"]];
for (var ci = 0; ci < CASES.length; ci++) {
  var P = CASES[ci][0], BACK = CASES[ci][1], HOME = CASES[ci][2];
  var tv = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  pass(P + ": the script arms itself (window.VP_TV_APP.platform)", !!tv.win.VP_TV_APP && tv.win.VP_TV_APP.platform === P);

  // short BACK: the hint, never leaves
  var prevented = tv.press(BACK, 80);
  var h = tv.hint();
  pass(P + ": a short BACK (" + BACK + ") shows the hint", /venueplay screen/.test(h), h);
  pass(P + ": the hint tells staff to hold OK", /Hold OK for 5 seconds for settings/.test(h), h);
  pass(P + ": the hint never says Hold BACK (LG closes the app on a held BACK)", !/Hold BACK/i.test(h), h);
  pass(P + ": a short BACK never leaves the page", tv.calls.length === 0, tv.calls.join(","));
  pass(P + ": the short BACK's keydown and keyup are both taken (preventDefault)", prevented === true);

  // second BACK while the hint is up: the TV home screen
  tv.advance(1200);
  tv.press(BACK, 80);
  pass(P + ": a second BACK while the hint is up goes to the TV home screen (" + HOME + ")",
       tv.calls.join(",") === HOME, tv.calls.join(","));

  // after the hint has gone, BACK shows it again rather than leaving
  var tv2 = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  tv2.press(BACK, 80); tv2.advance(4000);
  pass(P + ": the hint goes by itself after a few seconds", tv2.hint() === "", tv2.hint());
  tv2.press(BACK, 80);
  pass(P + ": BACK after the hint has gone shows the hint again, it does not leave",
       tv2.calls.length === 0 && /Hold OK/.test(tv2.hint()), tv2.calls.join(","));

  // hold OK 5 seconds: settings, with a countdown, key repeats ignored
  var tv3 = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  tv3.down(13);
  tv3.advance(600); tv3.down(13); tv3.advance(100); tv3.down(13);   // the remote's key repeat
  tv3.advance(1800);
  var cd = tv3.hint();
  pass(P + ": holding OK shows a countdown", /Keep holding for settings/.test(cd), cd);
  pass(P + ": the remote's key repeat does not restart the hold, nothing opened at 2.5 s", tv3.calls.length === 0, tv3.calls.join(","));
  tv3.advance(2700);
  pass(P + ": holding OK 5 seconds opens the app's settings (history one step back)",
       tv3.calls.join(",") === "history.go(-1)", tv3.calls.join(","));
  tv3.up(13);
  pass(P + ": letting go of OK after the settings opened does nothing more", tv3.calls.join(",") === "history.go(-1)", tv3.calls.join(","));

  // let go of OK early: nothing
  var tv4 = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  tv4.down(13); tv4.advance(3000); tv4.up(13); tv4.advance(4000);
  pass(P + ": letting go of OK at 3 seconds does not open the settings", tv4.calls.length === 0, tv4.calls.join(","));

  // timers held back (the simulator behind another window, 3 Nov 2026): judged by the clock
  var tv6 = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  tv6.down(13); tv6.jump(5300); tv6.up(13);
  pass(P + ": timers held back, OK let go after 5.3 s by the clock: the settings open",
       tv6.calls.join(",") === "history.go(-1)", tv6.calls.join(","));
  pass(P + ": ... and no 'short press' hint is drawn over it", !/venueplay screen/.test(tv6.hint()), tv6.hint());
  var tv7 = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  tv7.down(13); tv7.jump(5100); tv7.down(13);
  pass(P + ": timers held back, the remote's key repeat after 5.1 s opens the settings",
       tv7.calls.join(",") === "history.go(-1)", tv7.calls.join(","));
  tv7.down(13); tv7.up(13); tv7.advance(1000);
  pass(P + ": ... once, however many repeats follow", tv7.calls.join(",") === "history.go(-1)", tv7.calls.join(","));
  var tv8 = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  tv8.down(13); tv8.jump(4000); tv8.down(13); tv8.up(13); tv8.advance(1500);
  pass(P + ": timers held back, OK let go at 4 s by the clock: no settings", tv8.calls.length === 0, tv8.calls.join(","));

  // the Reconnecting card says the same
  var tv5 = makeTv("?venue=test-alpha&app=" + P + "&appv=1.0.0", P);
  var small = tv5.offline();
  pass(P + ": the Reconnecting card tells staff to hold OK, never BACK", /Hold OK/.test(small) && !/Hold BACK/i.test(small), small);
}

if (bad) print("\n" + bad + " of " + ran + " CHECKS FAILED");
else print("\nALL " + ran + " CHECKS PASSED");
