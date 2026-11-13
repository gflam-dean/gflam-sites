/* THE TRY-IT DEMO IS NOT IN THE BILLING WORKER'S STATS, ACTIVITY OR "HAS IT PLAYED" READS (INBOX 84b; migration 172).

   RUNS the real venueplay-api-FULL.js on tools/rig-billing-worker.js. The venue has one real night and one demo,
   and each of the nine reads that turns sessions into numbers is called for real:
     quiet venues (HQ), venue history (HQ), the auto-archive sweep, set players' "played since" (billing), venue
     stats, the metering stats (vpmStats), the monthly report read (vprRead), the draw log and the nights list.
   Each must ask vp_sessions with is_demo=not.is.true, and where the handler hands rows back, the demo is not in
   them while the real night is. The paths that must still see a demo's players (find a person) do not filter.

   Run from the repo root:  jsc tools/test-try-demo-billing.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 300) : '')); } }
URL = function (u) { u = String(u); var q = u.indexOf('?'), sp = {}; var base = q >= 0 ? u.slice(0, q) : u;
  this.pathname = base.replace(/^https?:\/\/[^/]+/, '') || '/';
  if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
  this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; };
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };
load('tools/rig-billing-worker.js');

var V = '22222222-2222-4222-8222-222222222222', REAL = '33333333-3333-4333-8333-333333333333', DEMO = '44444444-4444-4444-8444-444444444444';
var READS = [];
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), m = (opts && opts.method) || 'GET';
  if (m === 'GET' && /\/rest\/v1\/vp_sessions\?/.test(u)) READS.push(decodeURIComponent(u.split('?')[1]));
  return rigFetch(url, opts);
};
var NOW = new Date().toISOString(), EARLY = new Date(Date.now() - 3 * 86400000).toISOString();
function world() {
  DB = {}; READS.length = 0;
  DB.vp_venues = [{ id: V, name: 'The Royal', slug: 'royal', founding_id: 'f1', status: 'active', max_players: 50, timezone: 'Australia/Brisbane', created_at: EARLY }];
  DB.venueplay_founding = [{ id: 'f1', status: 'active', contact_email: 'owner@royal.example' }];
  DB.vp_sessions = [
    { id: REAL, venue_id: V, join_code: 'RXYTKM', status: 'finished', opened_at: EARLY, started_at: EARLY, ended_at: EARLY, created_at: EARLY, is_demo: false, overage_approved_count: null },
    { id: DEMO, venue_id: V, join_code: 'RXYTKM', status: 'finished', opened_at: NOW, started_at: NOW, ended_at: NOW, created_at: NOW, is_demo: true, overage_approved_count: null }];
  DB.vp_players = [{ id: 'p1', session_id: REAL, device_id: 'd1', kicked: false }, { id: 'p2', session_id: DEMO, device_id: 'd2', kicked: false, email: 'me@x.example', marketing_optin: true }];
  DB.vp_games = [{ id: 'g1', session_id: REAL, format: 'trivia', status: 'finished', started_at: EARLY }, { id: 'g2', session_id: DEMO, format: 'trivia', status: 'finished', started_at: NOW }];
}
var OWNER = { venues: [{ id: V, name: 'The Royal', slug: 'royal', max_players: 50, founding_id: 'f1', created_at: EARLY }], founding: { id: 'f1', status: 'active' }, account: { id: 'f1' }, user: { id: 'u1' }, owner: true };
vpaRequireAdmin = async function () { return { id: 'a1', role: 'owner', email: 'hq@example' }; };
vpbRequireOwner = async function () { return OWNER; };
function req(body) { return { json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); }, headers: { get: function () { return ''; } }, url: 'https://api.example/x' }; }
async function run(label, fn) {
  world(); var out = null, err = null;
  try { out = await fn(); } catch (e) { err = e; }
  var mine = READS.filter(function (q) { return q.indexOf('venue_id=eq.' + V) >= 0 || q.indexOf('venue_id=in.(') >= 0 || /^select=venue_id/.test(q) || /or=\(started_at/.test(q); });
  check(label + ': reads vp_sessions', mine.length > 0, (err ? 'threw ' + err.message + ' | ' : '') + READS.join(' || '));
  check(label + ': every such read leaves demos out (is_demo=not.is.true)', mine.length > 0 && mine.every(function (q) { return q.indexOf('is_demo=not.is.true') >= 0; }), mine.join(' || '));
  return out;
}
function has(o, id) { return JSON.stringify(o || {}).indexOf(id) >= 0; }

(async function () {
  print('The nine reads');
  await run('quiet venues (HQ)', function () { return vpaHandleQuietVenues(req({ days: 30 }), ENV, J); });
  var hist = await run('venue history (HQ)', function () { return vpaHandleVenueHistory(req({ venue_id: V }), ENV, J); });
  check('venue history: its last activity is the real night, not the newer demo', hist && hist.body && hist.body.last_activity === EARLY, hist && hist.body);
  await run('auto-archive sweep', function () { DB.vp_venues[0].cancel_at_period_end = true; return vpaAutoArchiveSweep(ENV, { id: 'a1', email: 'hq@example' }, 30, true); });
  /* set players' one-hour undo needs a live Stripe line to reach its read; the read itself, in its own statement: */
  var sp = String(vpbSetPlayers).replace(/\s+/g, ' ');
  check('set players: the "a game has started since" read leaves demos out (a demo is not a night, so the undo stays open)',
    /const played = inFreeMonth \? null : await vpaSelect\(env, 'vp_sessions', 'venue_id=eq\.' \+ encodeURIComponent\(venueId\) \+ VPA_NOT_DEMO/.test(sp));
  var st = await run('venue stats', function () { return vpaVenueStats(ENV, V, 'Australia/Brisbane'); });
  check('venue stats count one night, not two', st && JSON.stringify(st).indexOf(DEMO) < 0, st);
  await run('metering stats (vpmStats)', function () { return vpmStats(ENV, [DB.vp_venues[0]]); });
  await run('monthly report read (vprRead)', function () { return vprRead(ENV, [DB.vp_venues[0]], new Date().toISOString().slice(0, 7)); });
  await run('draw log', function () { return vpbDrawLog(req({ venue_id: V, months: 6 }), ENV, J); });
  var n = await run('nights list', function () { return vpbNights(req({ venue_id: V }), ENV, J); });
  check('the nights list has one night (the real one), not the demo', n && n.body && Array.isArray(n.body.nights) && n.body.nights.filter(function (x) { return x.kind === 'session'; }).length === 1 && n.body.nights[0].at === EARLY, n && n.body);

  print('');
  print('What must still see a demo');
  var src = String(vpaFindPerson);
  check('find a person (privacy requests) reads sessions WITHOUT the demo filter', /'vp_sessions'/.test(src) && src.indexOf('VPA_NOT_DEMO') < 0);
  check('the filter is the Postgres IS NOT TRUE one (false and null pass)', /const VPA_NOT_DEMO = '&is_demo=not\.is\.true';/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')));

  print('');
  print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL suite threw: ' + e + '\n' + (e && e.stack)); bad++; });
