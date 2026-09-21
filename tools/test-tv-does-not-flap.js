/* After one network blip, does the venue TV settle, or does it re-join for ever?

   Lifts the TV's own game-channel reconnect block out of the shipped tv.html by its text and
   runs it on a virtual clock against a fake realtime client that keeps the TWO rules of
   supabase-js that matter here: a channel can be subscribed once, and removing a channel tells
   that channel's callback it is CLOSED. The second rule is the whole fault: a fake without it
   is how this shipped.

   Run from the repo root:  jsc tools/test-tv-does-not-flap.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; } }

var NOW = 1e12, timers = [];
Date.now = function () { return NOW; };
var setTimeout = function (fn, ms) { timers.push({ at: NOW + (ms || 0), fn: fn }); return timers.length; };
function advance(ms) { var end = NOW + ms; for (;;) { timers.sort(function (a, b) { return a.at - b.at; }); if (!timers.length || timers[0].at > end) break; var t = timers.shift(); NOW = t.at; t.fn(); } NOW = end; }

var channels = [], joins = 0, networkUp = true;
var client = {
  channel: function (name) {
    var ch = { name: name, removed: false, cb: null, sent: [],
      on: function () { return ch; },
      send: function (m) { ch.sent.push(m); },
      subscribe: function (cb) { if (ch.cb) throw new Error('join can only be called a single time per channel instance');
        ch.cb = cb; joins++; setTimeout(function () { if (!ch.removed) cb(networkUp ? 'SUBSCRIBED' : 'TIMED_OUT'); }, 40); return ch; } };
    channels.push(ch); return ch; },
  removeChannel: function (ch) { if (ch.removed) return; ch.removed = true; if (ch.cb) ch.cb('CLOSED'); }   // the real library does exactly this
};

var html = readFile('venueplay/tv.html');
var a = html.indexOf('var tries = 0, retryT = null;');
var b = html.indexOf('\n      join();\n', a);   // the call at the block's own indent, not the one inside the retry timer
if (a < 0 || b < 0) throw new Error('cannot find the TV reconnect block in tv.html');
var block = html.slice(a, b + '\n      join();\n'.length);
check('the block lifted out of tv.html is the reconnect loop', /removeChannel\(old\)/.test(block) && /function join\(\)/.test(block), block.length);

var gameChannelsDeafSince = 0, VENUE_SLUG = 'the-pub';
function venueCode(s) { return 'C-' + s; }
function onGameMsg() {}
var GAMES = ['trivia', 'musical', 'raffle', 'members'];
GAMES.forEach(function (game) {
  var c = client.channel('vp-' + venueCode(game + '-' + VENUE_SLUG));
  eval(block);
});
advance(1000);
check('CONTROL: four game channels join once each and the screen is not deaf', joins === 4 && gameChannelsDeafSince === 0, [joins, gameChannelsDeafSince]);

print('one five second blip');
networkUp = false;
channels.filter(function (c) { return !c.removed; }).forEach(function (c) { c.cb('CHANNEL_ERROR'); });
check('the screen knows it is deaf', gameChannelsDeafSince > 0);
advance(5000); networkUp = true;
advance(60 * 1000);
check('a minute later it can hear again', gameChannelsDeafSince === 0, gameChannelsDeafSince);
var live = channels.filter(function (c) { return !c.removed; });
check('on exactly four live channels, one per game', live.length === 4, live.map(function (c) { return c.name; }));
check('and it told each host it is back', live.every(function (c) { return c.sent.some(function (m) { return m.payload && m.payload.t === 'tv_here'; }); }));
var settled = joins;
advance(30 * 60 * 1000);
check('HALF AN HOUR LATER IT HAS NOT JOINED AGAIN. It used to re-join about 3,600 times', joins === settled, { joinsAfterRecovery: joins - settled });
check('nothing is waiting to fire', timers.length === 0, timers.length);

print('a long outage still backs off and still comes back');
networkUp = false;
channels.filter(function (c) { return !c.removed; }).forEach(function (c) { c.cb('CLOSED'); });
var before = joins;
advance(10 * 60 * 1000);
var during = joins - before;
check('ten minutes down: it keeps trying, but slows to about one try per channel every 30 seconds', during >= 4 * 15 && during <= 4 * 30, during);
check('and has been counting how long it has been deaf, for the watchdog', gameChannelsDeafSince > 0 && (NOW - gameChannelsDeafSince) > 9 * 60 * 1000);
networkUp = true; advance(60 * 1000);
check('the network returns and so does the screen', gameChannelsDeafSince === 0 && channels.filter(function (c) { return !c.removed; }).length === 4);

if (fails) throw new Error('tv flap: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
