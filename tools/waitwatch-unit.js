/* The REAL venueplay/app/vp-waitwatch.js, driven by hand (13 Nov 2026, fix/waitwatch-flake-13nov).
   No browser, no clock: the page's setInterval is captured and each "poll" is one call, the Worker's answer is scripted.
   Prints one "ok"/"FAIL" line per check; tools/lobby-refresh-in-chrome.test.py runs it and counts the lines.
   Run from the repo root:  jsc tools/waitwatch-unit.js */
var SRC = readFile('venueplay/app/vp-waitwatch.js');
function sync(v, bad) {                       // a promise that is already settled, so the test needs no event loop
  return { then: function (a, b) {
    try { var out; if (bad) { if (!b) return sync(v, true); out = b(v); } else { if (!a) return sync(v); out = a(v); }
      return (out && typeof out.then === 'function') ? out : sync(out); } catch (e) { return sync(e, true); }
  } };
}
function world(opts) {
  var els = {}, made = [], timers = [], answers = [], fetched = [];
  var doc = { visibilityState: 'visible',
    getElementById: function (id) { return els[id] || null; },
    createElement: function () { var e = { style: {}, setAttribute: function () {}, appendChild: function () {}, addEventListener: function () {} }; made.push(e); return e; },
    body: { appendChild: function (e) { if (e.id) els[e.id] = e; } } };
  var win = { document: doc, setInterval: function (f) { timers.push(f); return 1; }, location: { reload: function () {} },
    fetch: function (u) { fetched.push(u); var a = answers.shift();
      if (a === 'error') return sync(new Error('network'), true);
      return sync(a); } };
  var f = new Function('window', 'return (function(){ var self=undefined; ' + SRC.replace(/\(typeof window !== "undefined" \? window : this\)/, '(window)') + ' })();');
  f(win);
  var started = false;
  return { win: win, doc: doc, answers: answers, fetched: fetched, shown: function () { return !!els.vpGone; },
    start: function (sid, waiting) { win.VP_WAITWATCH.start({ api: 'https://x.test/', session: function () { return sid(); }, waiting: function () { return waiting(); }, forget: function () {} }); },
    poll: function () { timers[0](); } };
}
function r(status, body) { return { status: status, ok: status >= 200 && status < 300, json: function () { return sync(body); } }; }
var GONE = r(200, { status: 'finished' }), HERE = r(200, { status: 'lobby' }), N404 = r(404, null), SLOW500 = r(503, null);
var bad = 0;
function check(name, c) { if (!c) bad++; print((c ? '  ok   ' : '  FAIL ') + 'waitwatch: ' + name); }
function run(script, sid) {
  var w = world(); w.start(function () { return sid === undefined ? 'sess-1' : sid; }, function () { return true; });
  script.forEach(function (s) {
    if (s === 'hide') { w.doc.visibilityState = 'hidden'; w.poll(); w.doc.visibilityState = 'visible'; return; }
    w.answers.push(s); w.poll();
  });
  return w;
}
check('two "gone" answers in a row show "This game has ended"', run([GONE, GONE]).shown());
check('one "gone" answer alone says nothing', !run([GONE]).shown());
check('a 404 counts as gone, twice in a row shows it', run([N404, N404]).shown());
check('gone, then "still here", then gone says nothing (the count resets only on a positive answer)', !run([GONE, HERE, GONE]).shown());
check('gone, a failed request, then gone still shows it (a network error is neither gone nor here)', run([GONE, 'error', GONE]).shown());
check('gone, a slow 503, then gone still shows it (an unreadable answer does not reset the count)', run([GONE, SLOW500, GONE]).shown());
check('a run of failed requests alone never shows it', !run(['error', 'error', SLOW500, 'error']).shown());
check('gone, then a hidden tab, then gone: the hidden tab asks nothing and starts the count again', !run([GONE, 'hide', GONE]).shown());
check('...and two more gone answers once visible show it', run([GONE, 'hide', GONE, GONE]).shown());
var nw = run([GONE, GONE], '');
check('a phone with no night id asks nothing at all', nw.fetched.length === 0 && !nw.shown());
var w2 = world(); w2.start(function () { return 'sess-9'; }, function () { return false; }); w2.answers.push(GONE, GONE); w2.poll(); w2.poll();
check('a phone not on its lobby screen asks nothing', w2.fetched.length === 0);
check('it asks for the night the phone joined', run([HERE]).fetched[0] === 'https://x.test/snapshot?session=sess-1');
quit(bad ? 1 : 0);
