/* The one-night pass, enforced by the game Worker and mirrored by the console: RUN, not read.

   Dean, 20 Oct 2026: "it would be shit to not be able to fix something to let a venue play a night on
   a night". Trivia and musical bingo run once a week per venue. Migration 110 lets HQ grant ONE more
   night inside 24 hours (vp_venues.night_pass_*); it is used up by the first night it lets start.

   Runs the REAL game Worker on tools/rig-game-worker.js and the REAL console mirror
   (venueplay/app/vp-weekly.js):
     checkWeeklyFormatLimit + stampWeeklyFormat (the pair handleHostGame calls, on one session object)
       - a venue inside its week is refused; with a waiting pass it starts, and the pass is spent:
         used_at, which format, which night; an audit row naming who granted it
       - spending it does NOT move last_trivia_at, so the next ordinary night is due when it was
       - after that: another round the same night, and a restart inside 8 hours, are the same night
         (no refusal, nothing spent twice); a different night the next day is refused again
       - the format matters (a musical pass does not open trivia; 'either' opens either)
       - an expired pass, or one already used, does nothing
       - a pass is never spent on a night the weekly rule would have allowed anyway
       - two starts racing for one pass: one spends it, the other counts the ordinary way
       - before migration 110 the pass columns are refused: the read falls back, the rule holds,
         and before 107 as well
     handleHostGame   the START route answers 429 without the pass and not with it
     VPWeekly.check   the console says nothing while a pass is waiting or a pass night is on, and
                      warns again once it has expired or been used

   Run from the repo root:  jsc tools/test-night-pass.js
*/
load('tools/rig-game-worker.js');
load('venueplay/app/vp-weekly.js');

var HOUR = 3600 * 1000, DAY = 24 * HOUR;
var SESSION = '33333333-3333-4333-8333-333333333333', OTHER = '44444444-4444-4444-8444-444444444444';
var THIRD = '55555555-5555-4555-8555-555555555555';
var REFUSE = '';   // 'pass' = the live database before 110, 'both' = before 107 as well
var rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url);
  if (REFUSE && /\/rest\/v1\/vp_venues\?/.test(u) && (/night_pass/.test(u) || (REFUSE === 'both' && /weekly_limit_off/.test(u)))) {
    LOG.push('REFUSED ' + u);
    return resp(400, { code: '42703', message: 'column does not exist' });
  }
  return rigFetch(url, opts);
};
function iso(ms) { return new Date(ms).toISOString(); }
function world(extra) {
  DB = {
    vp_venues: [Object.assign({ id: VENUE, name: 'Deepwater Hotel', slug: 'deepwater-hotel', status: 'active',
      weekly_limit_off: false,
      last_trivia_at: iso(NOWMS - 2 * DAY), last_trivia_session_id: OTHER,
      last_musical_at: iso(NOWMS - 2 * DAY), last_musical_session_id: OTHER,
      night_pass_format: null, night_pass_until: null, night_pass_granted_at: null, night_pass_granted_by: null,
      night_pass_used_at: null, night_pass_used_format: null, night_pass_used_session: null }, extra || {})],
    vp_sessions: [{ id: SESSION, venue_id: VENUE, status: 'lobby', opened_at: iso(NOWMS - 600000) },
                  { id: THIRD, venue_id: VENUE, status: 'lobby', opened_at: iso(NOWMS - 600000) }],
    vp_games: [], vp_players: [], vp_admin_audit: [], vp_venue_settings: [],
  };
  LOG.length = 0; REFUSE = '';
}
function pass(format, extra) {
  return Object.assign({ night_pass_format: format, night_pass_until: iso(NOWMS + 20 * HOUR),
    night_pass_granted_at: iso(NOWMS - 4 * HOUR), night_pass_granted_by: 'Dean' }, extra || {});
}
function V() { return DB.vp_venues[0]; }
function S(id) { return DB.vp_sessions.filter(function (s) { return s.id === (id || SESSION); })[0]; }
function used() { return DB.vp_admin_audit.filter(function (a) { return a.action === 'venue_night_pass_used'; }); }
// What handleHostGame does: the check, then (once the game row exists) the stamp, on ONE session object.
async function night(isTrivia, sid) {
  var s = Object.assign({}, S(sid));
  var m = await checkWeeklyFormatLimit(ENV, s, isTrivia);
  if (m) return m;
  await stampWeeklyFormat(ENV, s, isTrivia);
  return null;
}
async function start(format) {
  BODY = { session_id: SESSION, format: format };
  try { return await handleHostGame({ headers: { get: function () { return 'Bearer x'; } } }, ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: String(e.message || e) } }; }
}

(async function () {
  print('\nno pass: once a week, as before');
  world();
  var m = await night(true);
  show('trivia two days after the last one is refused', typeof m === 'string' && /once a week/.test(m), m);

  print('\na waiting trivia pass lets ONE night start, and is spent by it');
  world(pass('trivia'));
  var lastBefore = V().last_trivia_at;
  m = await night(true);
  show('the night starts', m === null, m);
  show('the pass is marked used, for trivia, by this night', !!V().night_pass_used_at && V().night_pass_used_format === 'trivia' && V().night_pass_used_session === SESSION, JSON.stringify(V()));
  show('last_trivia_at is NOT moved (the next ordinary night is still due when it was)', V().last_trivia_at === lastBefore && V().last_trivia_session_id === OTHER, V().last_trivia_at);
  var u = used();
  show('one audit row, venue_night_pass_used, naming the night and who granted the pass',
    u.length === 1 && u[0].target === 'venue:' + VENUE && u[0].detail.session_id === SESSION && u[0].detail.granted_by === 'Dean' && u[0].detail.format === 'trivia', JSON.stringify(DB.vp_admin_audit));
  m = await night(true);
  show('another round the same night is allowed, and nothing is spent twice', m === null && used().length === 1, m);
  m = await night(true, THIRD);
  show('a restart in a new session inside 8 hours is the same night', m === null && used().length === 1, m);
  show('...and neither of them moved the week either', V().last_trivia_at === lastBefore && V().last_trivia_session_id === OTHER, V().last_trivia_session_id);
  NOWMS += 9 * HOUR;
  m = await night(true, THIRD);
  show('a different night 9 hours later is refused again: the pass is gone', typeof m === 'string' && /once a week/.test(m), m);
  NOWMS -= 9 * HOUR;

  print('\nthe format matters');
  world(pass('musical_bingo'));
  m = await night(true);
  show('a musical bingo pass does not open trivia', typeof m === 'string', m);
  show('...and is still waiting', V().night_pass_used_at === null);
  m = await night(false);
  show('it opens musical bingo', m === null && V().night_pass_used_format === 'musical_bingo', m);
  show('...and last_musical_at is not moved', V().last_musical_session_id === OTHER);
  world(pass('either'));
  m = await night(false);
  show('"either" opens musical bingo', m === null && V().night_pass_used_format === 'musical_bingo', m);
  m = await night(true);
  show('...once: trivia after it is refused', typeof m === 'string', m);

  print('\nexpired, used, or not needed');
  world(pass('trivia', { night_pass_until: iso(NOWMS - 60000) }));
  m = await night(true);
  show('an expired pass does nothing', typeof m === 'string' && V().night_pass_used_at === null, m);
  world(pass('trivia', { night_pass_used_at: iso(NOWMS - 30 * HOUR), night_pass_used_format: 'trivia', night_pass_used_session: THIRD }));
  m = await night(true);
  show('a pass used yesterday does nothing', typeof m === 'string', m);
  world(Object.assign(pass('trivia'), { last_trivia_at: iso(NOWMS - 8 * DAY) }));
  m = await night(true);
  show('a venue whose week is up starts without spending the pass', m === null && V().night_pass_used_at === null && used().length === 0, JSON.stringify(V()));
  show('...and that night is stamped the ordinary way', V().last_trivia_session_id === SESSION);
  world(Object.assign(pass('trivia'), { last_trivia_session_id: SESSION, last_trivia_at: iso(NOWMS - HOUR) }));
  m = await night(true);
  show('the same night picked back up (same session) does not spend the pass', m === null && V().night_pass_used_at === null, m);

  print('\ntwo starts racing for one pass');
  world(pass('trivia'));
  var a = Object.assign({}, S(SESSION)), b = Object.assign({}, S(THIRD));
  var ma = await checkWeeklyFormatLimit(ENV, a, true), mb = await checkWeeklyFormatLimit(ENV, b, true);
  show('CONTROL: both checks saw the pass waiting', ma === null && mb === null, ma + ' / ' + mb);
  await stampWeeklyFormat(ENV, a, true); await stampWeeklyFormat(ENV, b, true);
  show('only the first spends it', V().night_pass_used_session === SESSION && used().length === 1, JSON.stringify(V()));
  show('the second counts the ordinary way (it stamps the week)', V().last_trivia_session_id === THIRD, V().last_trivia_session_id);

  print('\nthe start route itself');
  world();
  var r = await start('trivia');
  show('Start trivia inside the week, no pass: 429', r.status === 429 && /once a week/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body).slice(0, 140));
  world(pass('trivia'));
  r = await start('trivia');
  show('Start trivia with a waiting pass: not refused by the weekly rule', r.status !== 429 && !/once a week/.test(JSON.stringify(r.body)), r.status + ' ' + JSON.stringify(r.body).slice(0, 140));
  world(pass('musical_bingo'));
  r = await start('musical');
  show('Start musical bingo with a musical pass: not refused', r.status !== 429, r.status + ' ' + JSON.stringify(r.body).slice(0, 140));

  print('\nbefore migration 110 (and 107) is run on the live database');
  world();   // no such columns yet, so no row can carry a pass
  REFUSE = 'pass';
  var threw = null;
  try { m = await night(true); } catch (e) { threw = e; }
  show('the refused pass columns do not throw (a night is never lost to a 500)', threw === null, threw && String(threw));
  show('...the read fell back to 107\'s', LOG.some(function (l) { return /^REFUSED .*night_pass/.test(l); }) &&
    LOG.some(function (l) { return /^GET vp_venues\?.*weekly_limit_off/.test(l) && !/night_pass/.test(l); }), LOG.join(' | '));
  show('...and the rule still applies: there is no pass before the columns exist', typeof m === 'string' && /once a week/.test(m), m);
  world({ weekly_limit_off: true });
  REFUSE = 'pass';
  m = await night(true);
  show('107\'s switch still works before 110', m === null, m);
  world();
  REFUSE = 'both';
  m = await night(true);
  show('before 107 too: falls back to the original read, the rule holds', typeof m === 'string' && /once a week/.test(m), m);

  print('\nthe console mirror (vp-weekly.js) agrees with the Worker');
  var v = { last_trivia_at: iso(NOWMS - 2 * DAY), last_musical_at: iso(NOWMS - 2 * DAY) };
  show('CONTROL: no pass, the trivia console warns', !!VPWeekly.check(v, 'trivia', NOWMS));
  v = Object.assign(v, pass('trivia'));
  show('a waiting trivia pass: the trivia console says nothing', VPWeekly.check(v, 'trivia', NOWMS) === null);
  show('...but the musical console still warns (it is not a musical pass)', !!VPWeekly.check(v, 'musical', NOWMS));
  v.night_pass_format = 'either';
  show('an "either" pass quietens both', VPWeekly.check(v, 'trivia', NOWMS) === null && VPWeekly.check(v, 'musical', NOWMS) === null);
  v.night_pass_until = iso(NOWMS - 1000);
  show('expired: the console warns again', !!VPWeekly.check(v, 'trivia', NOWMS));
  v.night_pass_until = iso(NOWMS + HOUR); v.night_pass_used_at = iso(NOWMS - HOUR); v.night_pass_used_format = 'trivia';
  show('used an hour ago for trivia: the pass night is picked back up without a warning', VPWeekly.check(v, 'trivia', NOWMS) === null);
  show('used 9 hours ago: the console warns again', !!VPWeekly.check(v, 'trivia', NOWMS + 8 * HOUR));
  show('passWaiting answers the Worker\'s question', VPWeekly.passWaiting(Object.assign({}, pass('trivia')), 'trivia', NOWMS) === true &&
    VPWeekly.passWaiting(Object.assign({}, pass('trivia')), 'musical', NOWMS) === false);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' night pass checks failed');
})().catch(function (e) { print('  FAIL the test itself threw: ' + (e && e.stack || e)); throw e; });
