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
  var els = {}, made = [], timers = [], answers = [], fetched = [], tos = [], replaced = [], forgot = 0, listeners = [];
  var doc = { visibilityState: 'visible',
    getElementById: function (id) { return els[id] || null; },
    createElement: function () { var e = { style: {}, setAttribute: function () {}, appendChild: function () {}, addEventListener: function () {} }; made.push(e); return e; },
    addEventListener: function (n, f) { listeners.push(f); },
    body: { appendChild: function (e) { if (e.id) els[e.id] = e; } } };
  var win = { document: doc, setInterval: function (f) { timers.push(f); return 1; },
    setTimeout: function (f, ms) { tos.push({ f: f, ms: ms }); return tos.length; }, clearTimeout: function (id) { if (tos[id - 1]) tos[id - 1].f = null; },
    location: { reload: function () {}, replace: function (u) { replaced.push(u); } },
    fetch: function (u) { fetched.push(u); var a = answers.shift();
      if (a === 'error') return sync(new Error('network'), true);
      return sync(a); } };
  var f = new Function('window', 'return (function(){ var self=undefined; ' + SRC.replace(/\(typeof window !== "undefined" \? window : this\)/, '(window)') + ' })();');
  f(win);
  var started = false;
  return { win: win, doc: doc, answers: answers, fetched: fetched, shown: function () { return !!els.vpGone; },
    start: function (sid, waiting) { win.VP_WAITWATCH.start({ api: 'https://x.test/', session: function () { return sid(); }, waiting: function () { return waiting(); }, forget: function () { forgot++; } }); },
    texts: function () { return made.map(function (e) { return e.textContent; }).filter(Boolean); },
    poll: function () { timers[0](); },
    tos: tos, replaced: replaced, forgot: function () { return forgot; }, listeners: listeners,
    tick: function () { var t = null; while (tos.length) { t = tos.shift(); if (t.f) { t.f(); return t.ms; } } return -1; } };
}
function r(status, body) { return { status: status, ok: status >= 200 && status < 300, json: function () { return sync(body); } }; }
var GONE = r(200, { status: 'finished', venue_slug: 'the-mini-bar', join_code: 'OLD111' }), HERE = r(200, { status: 'lobby' }), N404 = r(404, null), SLOW500 = r(503, null);
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
var tx = run([GONE, GONE]).texts();
check('the ended screen reads: heading, next-one line, button "Join" (17 Nov 2026, was tap below to join until the venue is being watched)', tx[0] === 'This game has ended' && tx[1] === 'When the next one starts, it\'ll show up here.' && tx[2] === 'Join');
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


// ---- 17 Nov 2026: the ended screen keeps looking for the venue's next game ----
var N404B = r(404, null);
function ended() { var w = world(); w.start(function () { return 'sess-1'; }, function () { return true; }); w.answers.push(GONE, GONE); w.poll(); w.poll(); return w; }
function liveR(o) { return r(200, o); }
var w3 = world(); w3.start(function () { return 'sess-1'; }, function () { return true; }); w3.answers.push(r(200, { status: 'finished' }), r(200, { status: 'finished' })); w3.poll(); w3.poll();
check('with no venue known the ended screen keeps the old "tap below to join" line and watches nothing', w3.shown() && w3.texts()[1] === 'When the next one starts, tap below to join.' && w3.tos.length === 0);
var w4 = ended();
check('with the venue known the ended screen starts one quiet timer, not a request', w4.tos.length === 1 && w4.fetched.length === 2);
var ms0 = w4.tos[0].ms;
check('the first look comes 30 s later (plus a little jitter)', ms0 >= 30000 && ms0 < 33100);
w4.answers.push(liveR({ exists: true, live: false })); var m1 = w4.tick();
check('it asks /play/live for the venue code (the venue hash of the slug), not fresh', w4.fetched[2].indexOf('https://x.test/play/live?code=') === 0 && w4.fetched[2].indexOf('fresh') < 0);
check('a quiet venue opens nothing and schedules another look', w4.replaced.length === 0 && w4.tos.length === 1);
w4.answers.push(liveR({ exists: true, live: false })); w4.tick(); w4.answers.push(liveR({ exists: true, live: false })); w4.tick();
w4.answers.push(liveR({ exists: true, live: false })); var m4 = w4.tick(); w4.answers.push(liveR({ exists: true, live: false })); var m5 = w4.tick();
w4.answers.push(liveR({ exists: true, live: false })); var m6 = w4.tick(); w4.answers.push(liveR({ exists: true, live: false })); w4.tick(); w4.answers.push(liveR({ exists: true, live: false })); var m8 = w4.tick();
check('it backs off: 30 s, then 60 s, then 120 s', m1 < 33100 && m4 >= 60000 && m4 < 63100 && m5 >= 60000 && m8 >= 120000 && m8 < 123100);
// the ended night still looking open in a copy a few seconds old: the fresh read of the database says it is not
var w5 = ended(); w5.answers.push(liveR({ exists: true, live: true, join_code: 'OLD111', format: '' }), liveR({ exists: true, live: false })); w5.tick();
check('the ended night, still open in a copy a few seconds old, is not reopened (the fresh read says not live)', w5.replaced.length === 0 && w5.fetched.length === 4 && w5.fetched[3].indexOf('fresh=1') > 0);
var w5b = ended(); w5b.answers.push(liveR({ exists: true, live: true, join_code: 'OLD111', format: 'trivia' }), liveR({ exists: true, live: true, join_code: 'OLD111', format: 'trivia' })); w5b.tick();
check('a new night that reuses the venue code as its join code is still opened (a join code does not tell nights apart)', w5b.replaced.length === 1 && w5b.replaced[0] === '/app/trivia/play?room=OLD111');
// a new bingo lobby: confirmed by a fresh read, then opened through the venue link
var w6 = ended(); w6.answers.push(liveR({ exists: true, live: true, join_code: 'NEW222', format: '' }), liveR({ exists: true, live: true, join_code: 'NEW222', format: '' })); w6.tick();
check('a new bingo lobby is confirmed with a fresh read and then opened through /play?venue=<slug>', w6.fetched[3].indexOf('fresh=1') > 0 && w6.replaced.length === 1 && w6.replaced[0] === '/play?venue=the-mini-bar' && w6.forgot() === 1);
var w7 = ended(); w7.answers.push(liveR({ exists: true, live: true, join_code: 'NEW222', format: 'trivia' }), liveR({ exists: true, live: true, join_code: 'NEW222', format: 'trivia' })); w7.tick();
check('a trivia lobby opens the trivia phone on its join code', w7.replaced[0] === '/app/trivia/play?room=NEW222');
var w8 = ended(); w8.answers.push(liveR({ exists: true, live: true, join_code: 'NEW222', format: 'musical_bingo' }), liveR({ exists: true, live: true, join_code: 'NEW222', format: 'musical_bingo' })); w8.tick();
check('a musical bingo lobby opens the musical phone on its join code', w8.replaced[0] === '/app/musical/play?room=NEW222');
var w9 = ended(); w9.answers.push(liveR({ exists: true, live: true, join_code: 'NEW222', format: '' }), liveR({ exists: true, live: false })); w9.tick();
check('a lobby the fresh read no longer shows (it closed again) opens nothing', w9.replaced.length === 0 && w9.tos.length === 1);
var w10 = ended(); w10.answers.push(liveR({ exists: true, live: true, join_code: 'NEW222', format: '' }), liveR({ exists: true, live: true, join_code: 'NEW333', format: '' })); w10.tick();
check('two reads naming different games open nothing', w10.replaced.length === 0);
var w11 = ended(); w11.answers.push('error'); w11.tick();
check('a failed request is silent and tries again later', w11.replaced.length === 0 && w11.tos.length === 1 && w11.shown());
var w12 = ended(); w12.doc.visibilityState = 'hidden'; var f0 = w12.fetched.length; w12.tick();
check('a hidden page asks nothing and keeps its place', w12.fetched.length === f0 && w12.tos.length === 1);
w12.doc.visibilityState = 'visible'; w12.answers.push(liveR({ exists: true, live: true, join_code: 'NEW222', format: '' }), liveR({ exists: true, live: true, join_code: 'NEW222', format: '' }));
w12.listeners[0](); w12.listeners[0]();
check('coming back to the page looks at once (not waiting for the next tick), and not twice in 10 s', w12.fetched.length === f0 + 2 && w12.replaced.length === 1);
var w13 = ended(); var looks = 0; w13.answers.length = 0;
for (var i = 0; i < 130; i++) { w13.answers.push(liveR({ exists: true, live: false })); if (w13.tick() === -1) break; looks++; }
check('it stops looking after 100 looks (about 3.4 hours) and the Join button stays', looks === 100 && w13.tos.length === 0 && w13.shown());
var w14 = ended(); w14.answers.push(liveR({ exists: false, live: false })); w14.tick();
check('a venue that does not exist is never opened', w14.replaced.length === 0);
var w15 = ended(); w15.answers.push(liveR({ exists: true, live: true, join_code: 'NEW222', format: '' }), liveR({ exists: true, live: true, join_code: 'NEW222', format: '' })); w15.tick(); var tn = w15.tos.length;
check('once it has opened the game it schedules nothing more', tn === 0);
var w16 = world(); w16.start(function () { return 'sess-1'; }, function () { return true; }); w16.answers.push(r(200, { status: 'lobby', venue_slug: 'the-mini-bar', join_code: 'OLD111' }), N404B, N404B); w16.poll(); w16.poll(); w16.poll();
check('a 404 (night gone) after healthy snapshots still knows the venue and starts watching', w16.shown() && w16.texts()[1] === "When the next one starts, it'll show up here." && w16.tos.length === 1);
quit(bad ? 1 : 0);
