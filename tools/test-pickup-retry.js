/* A slow first answer still ends in "Pick it up?": RUN, not read.

   20 Oct 2026. On slow pub wifi the first "is a game running at this venue?" (/host/running) can take
   longer than the console waits (15 s). vp-pickup.js find() then says "could not tell", the console
   falls back to this tablet's own save, and a NEW device (no save) was left on the setup screen with
   the room seated and never asked again. VP_PICKUP.keepAsking keeps asking in the background.

   Runs the REAL venueplay/app/vp-pickup.js with a clock this test drives (opts.wait), and the REAL
   console wiring lifted out of trivia/host.html and musical/host.html:
     keepAsking   - after a first lookup with no answer, asks again on a 5, 10, 20, 30 s, then 60 s
                    backoff; a game that turns up on the third try is handed to onFound, once
                    - stops for good on any real answer: a game, or "nothing running" (no question)
                    - stops before the next try once the host has moved on (a lobby, a game here),
                      and does not put the question up if the host moved on while the answer came
                    - gives up after its last try (about ten minutes), so a dead network is not a
                      loop for the rest of the night
     the consoles - on no answer, both consoles start keepAsking for their own format; it stops on
                    anything but the setup screen, and a game found later goes to the same
                    "Pick it up?" path as one found at once (pickUpTrivia / pickUpMusic)

   Run from the repo root:  jsc tools/test-pickup-retry.js
*/
var _iv = [];
function setInterval(f) { _iv.push(f); return _iv.length; }
function clearInterval() {}
var window = this;
load('venueplay/app/vp-pickup.js');

var ran = 0, bad = 0;
function show(n, c, extra) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (extra ? '   -> ' + extra : '')); if (!c) bad++; }
async function flush() { for (var i = 0; i < 60; i++) await null; }
function lift(text, name, label) {
  var i = text.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ' in ' + label + ' - a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}

/* A clock the test drives: wait(ms) is recorded and resolves when tick() is called. */
function Clock() { this.waits = []; this.pending = []; }
Clock.prototype.wait = function (ms) { var self = this; self.waits.push(ms); return new Promise(function (res) { self.pending.push(res); }); };
Clock.prototype.tick = async function () { var p = this.pending.splice(0); p.forEach(function (r) { r(); }); await flush(); };

var RUN = { session_id: 's1', game_id: 'g1', format: 'trivia', holder: 'cTABLET00001' };
/* The Worker as a slow network sees it: no answer (the console's 15 s abort) for the first n tries. */
function slowPost(n, answer) {
  var calls = { n: 0 };
  calls.post = function (path, body) {
    calls.n++; calls.last = { path: path, body: body };
    if (calls.n <= n) return Promise.reject(new Error('The game server did not answer. Check the venue wifi and try again.'));
    return Promise.resolve({ running: answer });
  };
  return calls;
}

(async function () {
  print('\na slow network: no answer at first, then a game');
  var clock = new Clock(), net = slowPost(2, RUN), found = [];
  var first = await VP_PICKUP.find(net.post, 'v1', 'trivia');
  show('CONTROL: the first lookup gets no answer ("could not tell")', first === undefined && net.n === 1, String(first));
  var k = VP_PICKUP.keepAsking({ post: net.post, venueId: 'v1', format: 'trivia', wait: clock.wait.bind(clock),
    stop: function () { return false; }, onFound: function (r) { found.push(r); } });
  await flush();
  show('it waits before asking again (5 seconds)', clock.waits.join() === '5000' && net.n === 1, clock.waits.join());
  await clock.tick();
  show('the second try also gets no answer, and it backs off (10 seconds)', net.n === 2 && clock.waits.join() === '5000,10000', clock.waits.join() + ' n=' + net.n);
  await clock.tick();
  var out = await k.promise;
  show('the third try finds the running quiz and hands it over for "Pick it up?"', found.length === 1 && found[0].game_id === 'g1', JSON.stringify(found));
  show('...it asked the right question of the right route', net.last.path === '/host/running' && net.last.body.venue_id === 'v1' && net.last.body.format === 'trivia', JSON.stringify(net.last));
  show('...and then stops: no more waits, no more questions', clock.waits.length === 2 && net.n === 3 && out && out.game_id === 'g1', clock.waits.join());

  print('\nthe backoff, and a network that never comes back');
  clock = new Clock(); net = slowPost(1000, RUN); found = [];
  k = VP_PICKUP.keepAsking({ post: net.post, venueId: 'v1', format: 'trivia', wait: clock.wait.bind(clock), stop: function () { return false; }, onFound: function (r) { found.push(r); } });
  for (var i = 0; i < 20; i++) await clock.tick();
  var total = clock.waits.reduce(function (a, b) { return a + b; }, 0);
  show('5, 10, 20, 30 seconds, then a minute at a time', clock.waits.slice(0, 6).join() === '5000,10000,20000,30000,60000,60000', clock.waits.join());
  show('it gives up after about ten minutes (not a loop for the rest of the night)', clock.waits.length === VP_PICKUP.RETRY_MS.length && total >= 9 * 60000 && total <= 11 * 60000 && net.n === clock.waits.length, clock.waits.length + ' tries, ' + total / 1000 + ' s');
  show('...and nothing was found, so nothing was asked', found.length === 0);

  print('\nany real answer ends it');
  clock = new Clock(); net = slowPost(1, null); found = [];
  k = VP_PICKUP.keepAsking({ post: net.post, venueId: 'v1', format: 'musical_bingo', wait: clock.wait.bind(clock), stop: function () { return false; }, onFound: function (r) { found.push(r); } });
  await clock.tick(); await clock.tick(); await clock.tick();
  show('"nothing is running" is an answer: no question, and no more tries', found.length === 0 && net.n === 2 && clock.waits.length === 2, 'n=' + net.n + ' waits=' + clock.waits.join());

  print('\nthe host moves on');
  var moved = false;
  clock = new Clock(); net = slowPost(1000, RUN); found = [];
  k = VP_PICKUP.keepAsking({ post: net.post, venueId: 'v1', format: 'trivia', wait: clock.wait.bind(clock), stop: function () { return moved; }, onFound: function (r) { found.push(r); } });
  await clock.tick(); await clock.tick();
  var asked = net.n;
  moved = true;   // the host opened a lobby
  await clock.tick(); await clock.tick();
  show('once the host opens a lobby it asks nothing more', net.n === asked && found.length === 0, 'before ' + asked + ', after ' + net.n);
  show('...and the background task has ended', (await k.promise) === null);
  // the answer arrives in the same moment the host moves on: no question goes up over their lobby
  moved = false;
  clock = new Clock(); found = [];
  var gate = null;
  var lateNet = { n: 0, post: function () { lateNet.n++; return new Promise(function (res) { gate = res; }); } };
  k = VP_PICKUP.keepAsking({ post: lateNet.post, venueId: 'v1', format: 'trivia', wait: clock.wait.bind(clock), stop: function () { return moved; }, onFound: function (r) { found.push(r); } });
  await clock.tick();
  moved = true; gate({ running: RUN }); await flush();
  show('an answer that lands after the host moved on does not put the question up', lateNet.n === 1 && found.length === 0, 'found ' + found.length);

  print('\nthe consoles use it, and a late game goes to the same question');
  var CON = [['trivia', readFile('venueplay/app/trivia/host.html'), 'triviaKeepAsking', 'pickUpTrivia', 'restoreTrivia'],
             ['musical_bingo', readFile('venueplay/app/musical/host.html'), 'musicKeepAsking', 'pickUpMusic', 'restoreMusic']];
  for (var c = 0; c < CON.length; c++) {
    var fmt = CON[c][0], html = CON[c][1], ka = CON[c][2], pu = CON[c][3], rs = CON[c][4];
    var got = null, picked = [];
    var G = { status: 'setup', gameId: '', venueId: 'v9' };
    var fakePickup = { keepAsking: function (o) { got = o; return { promise: Promise.resolve(null), cancel: function () {} }; } };
    var f = new Function('window', 'VP_PICKUP', 'G', 'apiPost', ka === 'triviaKeepAsking' ? 'pickUpTrivia' : 'pickUpMusic',
      lift(html, ka, fmt) + '; ' + ka + '(); return true;');
    f({ VP_PICKUP: fakePickup }, fakePickup, G, function () {}, function (r) { picked.push(r); });
    show(fmt + ': the console starts keepAsking for its own format and venue', got && got.format === fmt && got.venueId === 'v9' && typeof got.post === 'function', got && JSON.stringify({ format: got.format, venueId: got.venueId }));
    show(fmt + ': it keeps going on the setup screen', got && got.stop() === false);
    G.status = 'lobby';
    show(fmt + ': it stops once a lobby is open', got && got.stop() === true);
    G.status = 'setup'; G.gameId = 'g7';
    show(fmt + ': it stops once a game is on this console', got && got.stop() === true);
    got && got.onFound(RUN);
    show(fmt + ': a game found later goes to the same "Pick it up?" path (' + pu + ')', picked.length === 1 && picked[0] === RUN);
    // and restore actually starts it when the first lookup had no answer
    var src = lift(html, rs, fmt);
    show(fmt + ': ' + rs + ' starts keepAsking when the first lookup could not tell',
      /if\(run===undefined\)\{[\s\S]{0,400}?(triviaKeepAsking|musicKeepAsking)\(\);/.test(src), src.slice(0, 120));
  }

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' pickup retry checks failed');
})().catch(function (e) { print('  FAIL the test itself threw: ' + (e && e.stack || e)); throw e; });
