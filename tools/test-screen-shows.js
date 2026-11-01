/* Slides counted on the TV, sent on the poll it already makes, kept in the same database call.

   Dean, 30 to 31 Oct 2026: "can we tell how much advertising is displayed", then yes, build it, with
   no extra database call at peak (migration 135). This RUNS the real code from three files:
     venueplay/tv.html          tvShownKey, tvShownNight, tvShownCount, tvShownParam: what the wall counts and sends
     venueplay-game.js          screenShownTally and handleVenueLookup: one RPC, the tally inside it
     venueplay-api-FULL.js      vprSlideKey: the report's key for a slide, which must be the TV's key
   The clock and the page are stood in for; nothing else.

   Run from the repo root:  jsc tools/test-screen-shows.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
function liftFrom(text, n, label) {
  var i = text.indexOf('async function ' + n + '('); if (i < 0) i = text.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n + ' in ' + label + ': a test that cannot find its subject cannot fail');
  var d = 0, k = text.indexOf('{', i);
  do { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; } while (d > 0 && k < text.length);
  return text.slice(i, k) + '\n';
}
var TV = readFile('venueplay/tv.html'), GAME = readFile('venueplay-backend/worker/venueplay-game.js'), BILL = readFile('venueplay-backend/worker/venueplay-api-FULL.js');

/* ---- the page, stood in for ---- */
var STORE = {}, SESSION = {};
var localStorage = { getItem: function (k) { return k in STORE ? STORE[k] : null; }, setItem: function (k, v) { STORE[k] = String(v); }, removeItem: function (k) { delete STORE[k]; } };
var sessionStorage = { getItem: function (k) { return k in SESSION ? SESSION[k] : null; }, setItem: function (k, v) { SESSION[k] = String(v); } };
var document = { visibilityState: 'visible' };
var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 53 + 7) & 255; return a; } };
var window = { location: { search: '' } };
var VP_DEMO = false, VENUE_TZ = 'Australia/Brisbane', tvMode = 'ads';
var NOW = Date.parse('2026-10-09T10:00:00Z');   // 8pm Friday in Brisbane
Date.now = function () { return NOW; };

/* The block as tv.html has it: from its first var to the last function, so the vars run too. */
var start = TV.indexOf('  var TV_SHOWN_SEND_MS'), end = TV.indexOf('  function tvShownBuild(');
check('the tally block is in tv.html', start > 0 && end > start);
var block = TV.slice(start, end).replace(/^  var /mg, 'var ');
eval(block);
eval(liftFrom(TV, 'tvShownBuild', 'tv.html'));
check('the rotation counts a slide when it moves on to it, and cannot be stopped by the count', /try\{ if\(typeof tvShownCount==="function"\) tvShownCount\(entries\[adIdx\], durs\[adIdx\]\); \}catch\(e\)\{\}/.test(liftFrom(TV, 'startAds', 'tv.html')));
check('the /venue poll carries it, guarded', /\+\(typeof tvShownParam==="function" \? tvShownParam\(Date\.now\(\)\) : ""\)\)/.test(liftFrom(TV, 'validateVenue', 'tv.html')));

var PARMA = { type: 'slide', slide: { head: 'Parma night, $22', image_url: 'https://db/storage/v1/object/public/vp/royal/parma-1.jpg?v=3' } };
var LIVE = { type: 'slide', slide: { tag: 'Live', head: '  Live   music Saturday ' } };
var TAGONLY = { type: 'slide', slide: { tag: 'Members' } };
print('what a slide is called');
check('a picture is its file name', tvShownKey(PARMA) === 'i:parma-1.jpg', tvShownKey(PARMA));
check('a text slide is its heading, spaces tidied', tvShownKey(LIVE) === 't:Live music Saturday', tvShownKey(LIVE));
check('the draws board and the raffle card have their own names; the holding card is not an advert', tvShownKey({ type: 'auto-draws' }) === 'auto:draws' && tvShownKey({ type: 'auto-raffle' }) === 'auto:raffle' && tvShownKey({ type: 'holding' }) === '');
eval(liftFrom(BILL, 'vprSlideKey', 'venueplay-api-FULL.js'));
var same = [PARMA, LIVE, TAGONLY, { type: 'slide', slide: { image_url: 'https://x/y/z.png#a' } }].every(function (e) { return vprSlideKey(e.slide) === tvShownKey(e); });
check('the report names a slide exactly as the TV counts it (one rule in two files)', same);

print('counting');
tvShownCount(PARMA, 7000); tvShownCount(PARMA, 7000); tvShownCount(LIVE, 9000);
check('two Parma shows of 7 s and one Live of 9 s', JSON.stringify(tvShown.c) === '{"i:parma-1.jpg":[2,14],"t:Live music Saturday":[1,9]}', tvShown.c);
check('tonight is Friday 9 October, on the venue\'s clock', tvShown.n === '2026-10-09');
check('it is kept through a reload, under this tab\'s own screen id', JSON.parse(STORE['vpTvShown:' + tvShownSid]).c['i:parma-1.jpg'][0] === 2 && /^tv[0-9a-f]{18}$/.test(tvShownSid) && SESSION.vpTvSid === tvShownSid, tvShownSid);
tvMode = 'bingo'; tvShownCount(PARMA, 7000); tvMode = 'ads';
check('a game on the wall counts no advert', tvShown.c['i:parma-1.jpg'][0] === 2);
document.visibilityState = 'hidden'; tvShownCount(PARMA, 7000); document.visibilityState = 'visible';
check('a hidden page counts nothing: the room cannot see it', tvShown.c['i:parma-1.jpg'][0] === 2);
NOW = Date.parse('2026-10-09T15:30:00Z');   // 1:30am Saturday: still Friday's night
tvShownCount(PARMA, 7000);
check('1:30am is still Friday\'s night', tvShown.n === '2026-10-09' && tvShown.c['i:parma-1.jpg'][0] === 3);

print('sending, on the poll that is already going');
var p1 = tvShownParam(NOW);
var sent1 = p1 ? JSON.parse(decodeURIComponent(p1.replace(/^&shown=/, ''))) : null;
check('the running total goes on the address', sent1 && sent1.n === '2026-10-09' && sent1.s === tvShownSid && sent1.c['i:parma-1.jpg'][0] === 3 && sent1.c['i:parma-1.jpg'][1] === 21, sent1);
check('the next poll inside five minutes sends nothing new', tvShownParam(NOW + 30000) === '');
check('five minutes on it sends again', tvShownParam(NOW + 5 * 60 * 1000) !== '');
for (var i = 0; i < 60; i++) tvShownCount({ type: 'slide', slide: { head: 'Promo ' + i } }, 5000);
var p2 = JSON.parse(decodeURIComponent(tvShownParam(NOW + 20 * 60 * 1000).replace(/^&shown=/, '')));
check('at most 40 slides a send, the most shown first', Object.keys(p2.c).length === 40 && p2.c['i:parma-1.jpg'], Object.keys(p2.c).length);
NOW = Date.parse('2026-10-09T16:30:00Z');   // 2:30am: Saturday's night begins
tvShownCount(LIVE, 9000);
check('at 2am a new night starts from nothing', tvShown.n === '2026-10-10' && JSON.stringify(tvShown.c) === '{"t:Live music Saturday":[1,9]}', tvShown);
var savedOff = TV_SHOWN_OFF; TV_SHOWN_OFF = true;
tvShownCount(LIVE, 9000);
check('a probe or the demo page counts nothing and sends nothing', tvShown.c['t:Live music Saturday'][0] === 1 && tvShownParam(NOW + 3600000) === '');
TV_SHOWN_OFF = savedOff;
check('the probe and demo switch is read from the address and the demo flag', /var TV_SHOWN_OFF = VP_DEMO \|\| \/\[\?&\]probe=1\(&\|\$\)\/\.test/.test(TV));
var brokenShown = tvShown; tvShown = null;
check('a broken tally never stops the heartbeat or the rotation', tvShownParam(NOW + 7200000) === '' && (function () { try { tvShownCount(LIVE, 1); return true; } catch (e) { return false; } })());
tvShown = brokenShown;

print('the game Worker: one call, the tally inside it');
var enc = encodeURIComponent;
function URL(u) { var q = u.indexOf('?') >= 0 ? u.slice(u.indexOf('?') + 1) : '', map = {};
  q.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); map[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1)); });
  this.searchParams = { get: function (k) { return (k in map) ? map[k] : null; } }; }
function json(o) { return { _json: o }; }
var console = { log: function () {}, warn: function () {} };
function sbHeaders() { return {}; }
var CALLS = [], MISSING = {};
function fetch(url, opts) {
  var fn = url.split('/rpc/')[1];
  CALLS.push({ fn: fn, body: JSON.parse(opts.body) });
  if (MISSING[fn]) return Promise.resolve({ status: 404, ok: false });
  return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve([{ id: 'v1', name: 'The Royal Hotel', slug: 'royal', status: 'active' }]); } });
}
function venueLookupThreeTrips() { CALLS.push({ fn: 'three-trips' }); return Promise.resolve(null); }
function venueLookupReply(j, v) { return j({ exists: true, name: v.name }); }
var screenPollRpcMissing = false, screenShownRpcMissing = false, screenKindRpcMissing = false;   // 138's TV type rides the same poll
eval(liftFrom(GAME, 'screenShownTally', 'venueplay-game.js'));
eval(liftFrom(GAME, 'screenKindParam', 'venueplay-game.js'));
eval(liftFrom(GAME, 'handleVenueLookup', 'venueplay-game.js'));
function req(q) { return { url: 'https://api/venue?' + q }; }
var TALLY = enc(JSON.stringify({ n: '2026-10-09', s: 'tvABCDEF12', c: { 'i:parma-1.jpg': [3, 21], 'bad key': [1, 1], 't:Zero': [0, 0], 'auto:draws': ['12', '120'] } }));

(async function () {
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x'), {}, json);
  check('a plain poll is one call to vp_screen_poll, as before', CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll' && !('p_shown' in CALLS[0].body), CALLS);
  CALLS = [];
  var r = await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&shown=' + TALLY), {}, json);
  check('a poll with a tally is still ONE call, to vp_screen_poll_shown', CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll_shown' && r._json.exists === true, CALLS.map(function (c) { return c.fn; }));
  var ps = CALLS[0].body.p_shown;
  check('it carries the night, the screen and the clean counts: bad keys and zeros dropped, numbers made numbers',
        ps && ps.n === '2026-10-09' && ps.s === 'tvABCDEF12' && JSON.stringify(ps.c) === '{"i:parma-1.jpg":[3,21],"auto:draws":[12,120]}', ps);
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&probe=1&shown=' + TALLY), {}, json);
  check('a probe sends no tally and writes nothing (it takes the read-only path)', CALLS.every(function (c) { return c.fn !== 'vp_screen_poll_shown' && c.fn !== 'vp_screen_poll'; }), CALLS);
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&shown=' + enc('{"n":"bad","s":"x","c":{}}')), {}, json);
  check('a malformed tally is dropped and the screen is answered as before', CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll');
  check('an oversized tally is refused before it is read', screenShownTally(new Array(5000).join('x')) === null);
  MISSING.vp_screen_poll_shown = true; CALLS = [];
  var r2 = await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&shown=' + TALLY), {}, json);
  check('before migration 135: the new function 404s, the same request falls back to vp_screen_poll and the screen still gets its answer',
        CALLS.map(function (c) { return c.fn; }).join() === 'vp_screen_poll_shown,vp_screen_poll' && r2._json.exists === true && screenShownRpcMissing === true, CALLS);
  CALLS = [];
  await handleVenueLookup(req('venue=royal&code=KQ7M2N&v=x&shown=' + TALLY), {}, json);
  check('and from then on that isolate asks only vp_screen_poll: one call, no second try', CALLS.length === 1 && CALLS[0].fn === 'vp_screen_poll', CALLS);

  print('the migration');
  var SQL = readFile('venueplay-backend/supabase/venueplay-135-screen-shows.sql');
  check('vp_screen_poll_shown answers first with vp_screen_poll\'s own rows', /return query select \* from public\.vp_screen_poll\(p_slug, p_code, p_version\);/.test(SQL));
  check('the tally keeps the GREATER of what it had and what came, so a repeat cannot double count', /shows = greatest\(s\.shows, excluded\.shows\), seconds = greatest\(s\.seconds, excluded\.seconds\)/.test(SQL));
  check('a bad tally cannot cost the screen its answer: its own exception block', /exception when others then\s+return;/.test(SQL));
  check('tonight or last night only, on the venue\'s clock, 2am boundary', /- interval '2 hours'\)::date/.test(SQL) && /v_n <> v_night and v_n <> v_night - 1/.test(SQL));
  check('at most twelve screens a venue a night, forty slides a call', /\) >= 12 then/.test(SQL) && /exit when v_count > 40;/.test(SQL));
  check('locked to the service role', /revoke all on public\.vp_screen_shows from public, anon, authenticated;/.test(SQL) && /revoke all on function public\.vp_screen_poll_shown\(text, text, text, jsonb\) from public, anon, authenticated;/.test(SQL));

  print(fails ? (fails + ' of ' + ran + ' checks FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL the suite threw: ' + e); print('1 of 1 checks FAILED'); });
