/* Unlimited trivia and musical bingo nights, one venue at a time: RUN, not read.

   Dean, 19 Oct 2026: Deepwater Hotel wants more than one trivia night a week. Trivia and musical
   bingo run once a week per venue (game Worker checkWeeklyFormatLimit, migration 13). Migration 107
   adds vp_venues.weekly_limit_off, set only from HQ.

   Runs the REAL game Worker on tools/rig-game-worker.js and the REAL console mirror
   (venueplay/app/vp-weekly.js):
     checkWeeklyFormatLimit  a venue that ran trivia two days ago is refused; the same venue with
                             the switch on is let through, for trivia AND musical bingo; the switch
                             off (false) keeps the rule
     handleHostGame          the START route itself answers 429 without the switch and does not
                             with it, so the check is wired where a host meets it
     before migration 107    PostgREST refuses a select naming the column: the rule still applies
                             (no 500, no night lost), and a venue past its week still starts
     VPWeekly.check          the console's warning goes quiet when the switch is on

   Run from the repo root:  jsc tools/test-unlimited-nights.js
*/
load('tools/rig-game-worker.js');
load('venueplay/app/vp-weekly.js');

var DAY = 24 * 3600 * 1000;
var SESSION = '33333333-3333-4333-8333-333333333333', OTHER = '44444444-4444-4444-8444-444444444444';
var NO_COLUMN = false;   // true = the live database before migration 107
var rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url);
  if (NO_COLUMN && /\/rest\/v1\/vp_venues\?/.test(u) && /weekly_limit_off/.test(u)) {
    LOG.push('REFUSED ' + u);
    return resp(400, { code: '42703', message: 'column vp_venues.weekly_limit_off does not exist' });
  }
  return rigFetch(url, opts);
};

function world(venueExtra) {
  DB = {
    vp_venues: [Object.assign({ id: VENUE, name: 'Deepwater Hotel', slug: 'deepwater-hotel', status: 'active',
      last_trivia_at: new Date(NOWMS - 2 * DAY).toISOString(), last_trivia_session_id: OTHER,
      last_musical_at: new Date(NOWMS - 2 * DAY).toISOString(), last_musical_session_id: OTHER }, venueExtra || {})],
    vp_sessions: [{ id: SESSION, venue_id: VENUE, status: 'lobby', opened_at: new Date(NOWMS - 600000).toISOString() }],
    vp_games: [], vp_players: [], vp_admin_audit: [], vp_venue_settings: [],
  };
  LOG.length = 0; NO_COLUMN = false;
}
function sess() { return DB.vp_sessions[0]; }
async function start(format) {
  BODY = { session_id: SESSION, format: format };
  try { return await handleHostGame({ headers: { get: function () { return 'Bearer x'; } } }, ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: String(e.message || e) } }; }
}

(async function () {
  print('\nwithout the switch: once a week, as before');
  world();
  var m = await checkWeeklyFormatLimit(ENV, sess(), true);
  show('trivia two days after the last trivia night is refused', typeof m === 'string' && /once a week/.test(m), m);
  m = await checkWeeklyFormatLimit(ENV, sess(), false);
  show('musical bingo two days after the last one is refused', typeof m === 'string' && /Musical bingo runs once a week/.test(m), m);
  world({ weekly_limit_off: false });
  m = await checkWeeklyFormatLimit(ENV, sess(), true);
  show('the switch set to false keeps the rule', typeof m === 'string' && /once a week/.test(m), m);
  world({ weekly_limit_off: 'true' });
  m = await checkWeeklyFormatLimit(ENV, sess(), true);
  show('only a real true lifts it (a stray string does not)', typeof m === 'string', m);

  print('\nwith the switch on (HQ, migration 107)');
  world({ weekly_limit_off: true });
  m = await checkWeeklyFormatLimit(ENV, sess(), true);
  show('trivia two days after the last trivia night is allowed', m === null, m);
  m = await checkWeeklyFormatLimit(ENV, sess(), false);
  show('musical bingo two days after the last one is allowed', m === null, m);
  show('the Worker asked for the switch in the same read', LOG.some(function (l) { return /^GET vp_venues\?.*weekly_limit_off/.test(l); }), LOG.join(' | '));

  print('\nthe start route itself');
  world();
  var r = await start('trivia');
  show('Start trivia without the switch: 429, the once-a-week words', r.status === 429 && /once a week/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body).slice(0, 140));
  world({ weekly_limit_off: true });
  r = await start('trivia');
  show('Start trivia with the switch on: not refused by the weekly rule', r.status !== 429 && !/once a week/.test(JSON.stringify(r.body)), r.status + ' ' + JSON.stringify(r.body).slice(0, 140));
  world();
  r = await start('musical');
  show('Start musical bingo without the switch: 429', r.status === 429, r.status + ' ' + JSON.stringify(r.body).slice(0, 140));
  world({ weekly_limit_off: true });
  r = await start('musical');
  show('Start musical bingo with the switch on: not refused by the weekly rule', r.status !== 429 && !/once a week/.test(JSON.stringify(r.body)), r.status + ' ' + JSON.stringify(r.body).slice(0, 140));

  print('\nbefore migration 107 is run on the live database');
  world();   // no such column yet, so no row can carry it
  NO_COLUMN = true;
  var threw = null;
  try { m = await checkWeeklyFormatLimit(ENV, sess(), true); } catch (e) { threw = e; }
  show('the refused column does not throw (a night is never lost to a 500)', threw === null, threw && String(threw));
  show('...and the rule still applies: the switch cannot exist before the column does', typeof m === 'string' && /once a week/.test(m), m);
  show('...it really was refused first, then read the old way', LOG.some(function (l) { return /^REFUSED/.test(l); }) && LOG.some(function (l) { return /^GET vp_venues\?/.test(l) && !/weekly_limit_off/.test(l); }), LOG.join(' | '));
  world({ last_trivia_at: new Date(NOWMS - 8 * DAY).toISOString() });
  NO_COLUMN = true;
  m = await checkWeeklyFormatLimit(ENV, sess(), true);
  show('a venue past its week still starts trivia before 107', m === null, m);

  print('\nthe console mirror (vp-weekly.js) agrees with the Worker');
  var v = { last_trivia_at: new Date(NOWMS - 2 * DAY).toISOString(), last_musical_at: new Date(NOWMS - 2 * DAY).toISOString() };
  show('without the switch the trivia console warns', !!VPWeekly.check(v, 'trivia', NOWMS));
  show('without the switch the musical console warns', !!VPWeekly.check(v, 'musical', NOWMS));
  v.weekly_limit_off = true;
  show('with the switch on the trivia console says nothing', VPWeekly.check(v, 'trivia', NOWMS) === null);
  show('with the switch on the musical console says nothing', VPWeekly.check(v, 'musical', NOWMS) === null);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' unlimited nights checks failed');
})().catch(function (e) { print('  FAIL the test itself threw: ' + (e && e.stack || e)); throw e; });
