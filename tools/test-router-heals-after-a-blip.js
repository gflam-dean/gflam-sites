/* ONE WIFI BLIP MUST NOT DEAFEN THE WALL FOR THE REST OF THE NIGHT.

   Audit, 20 Sep 2026. vp-screen-router.js is loaded by four of the five game screens
   (trivia, musical, raffle, members) so the telly can follow whatever the host starts. Its
   retry called subscribe() a SECOND time on the SAME channel object. supabase-js allows
   subscribe() once per channel instance, so the retry threw inside its own timer, nothing
   caught it, no further retry was scheduled, and that channel was dead until somebody
   physically reloaded the screen. The wall stayed on the trivia podium while the host ran a
   raffle, and nothing anywhere said why.

   The audit proved it against the real supabase-js 2.116 bundle. This suite keeps the ONE
   rule of that library that matters, in a fake: a second subscribe() on the same channel
   throws, exactly as the real one does. A fake WITHOUT that rule is how the fault shipped.

   Run:  jsc tools/test-router-heals-after-a-blip.js
*/
var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}

// ---- a virtual clock ----
var NOW = 1e12, timers = [], uncaught = [];
Date.now = function () { return NOW; };
var setTimeout = function (fn, ms) { timers.push({ at: NOW + (ms || 0), fn: fn }); return timers.length; };
var clearTimeout = function () {};
function advance(ms) {
  var end = NOW + ms;
  for (;;) {
    timers.sort(function (a, b) { return a.at - b.at; });
    if (!timers.length || timers[0].at > end) break;
    var t = timers.shift(); NOW = t.at;
    try { t.fn(); } catch (e) { uncaught.push(String(e)); }   // what a browser would log and drop
  }
  NOW = end;
}

// ---- a fake realtime client with the real library's one rule ----
var channels = [];
function makeClient() {
  return {
    channel: function (name) {
      var ch = { name: name, subscribed: 0, removed: false, handlers: [], statusCb: null,
        on: function (type, filter, fn) { ch.handlers.push(fn); return ch; },
        subscribe: function (cb) {
          if (ch.subscribed) throw new Error('tried to join multiple times. join can only be called a single time per channel instance');
          ch.subscribed++; ch.statusCb = cb; cb('SUBSCRIBED'); return ch;
        },
        unsubscribe: function () { return Promise.resolve('ok'); } };
      channels.push(ch); return ch;
    },
    /* THE REAL LIBRARY TELLS A REMOVED CHANNEL IT IS CLOSED, there and then. This fake did not,
       and that is how a second fault hid behind the first fix: the router took its own old
       channel's CLOSED for news and built a duplicate live channel on every blip. */
    removeChannel: function (ch) { if (ch.removed) return; ch.removed = true; if (ch.statusCb) ch.statusCb('CLOSED'); }
  };
}
function live(nameEndsWith) {
  return channels.filter(function (c) { return !c.removed && c.name.indexOf(nameEndsWith) !== -1; });
}

var navigatedTo = null;
var window = { location: { origin: 'https://venueplay.com.au' }, top: null, self: null };
window.top = window; window.self = window;
Object.defineProperty(window.location, 'href', { set: function (u) { navigatedTo = u; }, get: function () { return ''; } });
var console = { log: function () {} };

var SRC = readFile('venueplay/app/vp-screen-router.js');
/* The file exports onto globalThis, so it is handed OUR timers and OUR window by name and
   the router is read back off globalThis. */
(new Function('window', 'setTimeout', 'clearTimeout', 'console', 'Date', SRC))
  .call(window, window, setTimeout, clearTimeout, console, Date);
var Router = globalThis.VPScreenRouter;
check('the router loaded', !!(Router && Router.start), Object.keys(window));

Router.start({ client: makeClient(), self: 'trivia', slug: 'the-pub',
               venueCode: function (s) { return 'C-' + s; }, busy: function () { return false; } });

print('');
print('The wall heals itself after a blip');
check('it watches the four OTHER games from the start', channels.length === 4, channels.map(function (c) { return c.name; }));
var raffle = live('raffle-the-pub')[0];
check('including the raffle channel', !!raffle, channels.map(function (c) { return c.name; }));

// THE BLIP.
raffle.statusCb('CHANNEL_ERROR');
advance(10 * 60 * 1000);
check('NOTHING was thrown and dropped inside the retry timer', uncaught.length === 0, uncaught.slice(0, 2));
var after = live('raffle-the-pub');
check('the dead channel was let go of', raffle.removed === true);
check('and a BRAND NEW channel object took its place', after.length === 1 && after[0] !== raffle, after.length);
check('which is actually subscribed', after.length === 1 && after[0].subscribed === 1);

// TEN MINUTES LATER THE HOST STARTS A RAFFLE.
navigatedTo = null;
after[0].handlers.forEach(function (h) { h({ payload: { t: 'mode', mode: 'raffle' } }); });
check('ten minutes after the blip, the host starts a raffle and the wall FOLLOWS',
      !!navigatedTo && /raffle/.test(navigatedTo), navigatedTo);

// A SECOND AND THIRD BLIP on the replacement must heal too, not just the first.
var before = channels.length;
navigatedTo = null;
var cur = live('members-the-pub')[0];
cur.statusCb('TIMED_OUT'); advance(5 * 60 * 1000);
var cur2 = live('members-the-pub')[0];
cur2.statusCb('CLOSED'); advance(5 * 60 * 1000);
var cur3 = live('members-the-pub');
check('a channel that blips TWICE is rebuilt twice', cur3.length === 1 && cur3[0] !== cur && cur3[0] !== cur2 && cur3[0].subscribed === 1,
      { live: cur3.length, made: channels.length - before });
check('still with nothing thrown', uncaught.length === 0, uncaught.slice(0, 2));

print('');
print(PASS + ' passed, ' + FAIL + ' failed');
if (FAIL) { print('FAILED ' + FAIL); throw new Error(FAIL + ' check(s) failed'); }
print('PASS');
