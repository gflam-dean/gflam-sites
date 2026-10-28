/* A PROSPECT VENUE STARTS NO GAME UNTIL IT HAS TICKED SECTION 6 (Dean, 28 Oct 2026; migration 122).

   HQ > Set up a prospect builds a venue with terms_required and no compliance record. The console
   holds it on the Terms card (tools/test-prospect-setup.js); this proves the game Worker refuses on
   its own, so a page that skips the card still cannot start a game. RUNS the real venueplay-game.js
   on tools/rig-game-worker.js:
     /host/game (trivia, musical bingo, raffle), /host/bingo/draw and the members draw are refused
     with code 'terms_first' at a held venue; the same calls at an ordinary venue, and at the same
     venue once it has ticked, are not; a stranger is refused as a stranger first (nothing leaks);
     a database before migration 122 holds nobody, and any other database fault is not swallowed.

   Run from the repo root:  jsc tools/test-prospect-terms-first-game.js */
load('tools/rig-game-worker.js');
var HELD = '33333333-3333-4333-8333-333333333333', SESS_HELD = '44444444-4444-4444-8444-444444444444', SESS_OK = '55555555-5555-4555-8555-555555555555';
var DRAW_HELD = '66666666-6666-4666-8666-666666666666', DRAW_OK = '77777777-7777-4777-8777-777777777777';
var STRANGER = '88888888-8888-4888-8888-888888888888';
var ORDER = [];
var rigStaff = requireStaff;
requireStaff = async function (env, uid, venueId) { ORDER.push('staff'); if (uid === STRANGER) throw httpError(403, 'Not authorised: you are not staff at this venue'); return rigStaff(env, uid, venueId); };
var MIG = 'ran';   // 'ran' | 'missing' | 'broken'
var rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url);
  if (/\/rest\/v1\/vp_venues\?id=eq\.[^&]+&select=\*&limit=1$/.test(u)) {
    ORDER.push('terms');
    if (MIG === 'missing') {   // a database before migration 122: the row has no such column at all
      var rr = await rigFetch(url, opts), body = await rr.json();
      return resp(200, body.map(function (x) { var y = {}; for (var k in x) if (k !== 'terms_required') y[k] = x[k]; return y; }));
    }
    if (MIG === 'broken') return resp(503, { message: 'upstream connect error' });
  }
  return rigFetch(url, opts);
};
function world(ticked) {
  DB = {}; LOG.length = 0; ORDER.length = 0;
  DB.vp_venues = [
    { id: HELD, name: "Caz Reitop's Dirty Secrets", slug: 'caz', status: 'active', au_state: 'VIC', entity_type: 'for_profit', terms_required: true,
      compliance_accepted_at: ticked ? '2026-10-28T02:00:00Z' : null, max_players: 60, timezone: 'Australia/Melbourne' },
    { id: VENUE, name: 'The Royal', slug: 'royal', status: 'active', au_state: 'NSW', entity_type: 'for_profit', terms_required: false, compliance_accepted_at: null, max_players: 80, timezone: 'Australia/Sydney' }];
  DB.vp_sessions = [{ id: SESS_HELD, venue_id: HELD, status: 'lobby', join_code: 'CAZCAZ', plan_cap_at_start: 60 },
                    { id: SESS_OK, venue_id: VENUE, status: 'lobby', join_code: 'ROYALX', plan_cap_at_start: 80 }];
  DB.vp_member_draws = [{ id: DRAW_HELD, venue_id: HELD, name: 'Thursday draw' }, { id: DRAW_OK, venue_id: VENUE, name: 'Friday draw' }];
  DB.vp_players = []; DB.vp_games = []; DB.vp_venue_settings = [];
}
async function call(fn, body, who) {
  BODY = body; var save = verifyHostJwt; if (who) verifyHostJwt = async function () { return who; };
  try { return await fn({ headers: { get: function () { return ''; } } }, ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
  finally { verifyHostJwt = save; }
}
function termsFirst(r) { return r && r.status === 403 && r.body && r.body.code === 'terms_first' && /owner or a manager needs to tick one box/.test(r.body.error) && /TV keeps showing your ads/.test(r.body.error); }

(async function () {
  print('A prospect venue that has not ticked: every game start is refused');
  var formats = ['trivia', 'musical', 'raffle'];
  for (var i = 0; i < formats.length; i++) {
    world(false);
    var r = await call(handleHostGame, { session_id: SESS_HELD, format: formats[i] });
    show('/host/game ' + formats[i] + ' at the held venue: 403 terms_first, in the host\'s words', termsFirst(r), JSON.stringify(r.body));
    show('/host/game ' + formats[i] + ': nothing was written (no game row)', DB.vp_games.length === 0);
  }
  world(false);
  var b = await call(handleBingoDrawStartForVenue, { venue_id: HELD, format: 'bingo90' });
  show('/host/bingo/draw at the held venue: 403 terms_first, and no session or draw opened', termsFirst(b) && DB.vp_sessions.length === 2 && !(DB.vp_bingo_draws || []).length, JSON.stringify(b.body));
  world(false); DB.vp_sessions = [];
  var cs = await call(handleCreateSession, { venue_id: HELD, format: 'trivia' });
  show('/session (Open lobby) at the held venue: 403 terms_first, and no session opened', termsFirst(cs) && DB.vp_sessions.length === 0, JSON.stringify(cs.body));
  world(false);
  var sb = await call(handleBingoDrawStartForVenue, { venue_id: HELD, format: 'bingo90' }, STRANGER);
  show('/host/bingo/draw by a stranger: told they are not staff, never whether the venue has ticked', sb.status === 403 && !termsFirst(sb) && /not staff/.test(sb.body.error), JSON.stringify(sb.body));
  world(false);
  var m = await membersRulesGate(ENV, json, HOST, DRAW_HELD);
  show('the members draw gate at the held venue answers terms_first', termsFirst(m), JSON.stringify(m && m.body));
  world(false);
  await call(handleHostGame, { session_id: SESS_HELD, format: 'trivia' });
  show('the staff check runs BEFORE the terms read (the venue is checked as theirs first)', ORDER.join(',').indexOf('staff,terms') === 0, ORDER.join(','));
  world(false);
  var s1 = await call(handleHostGame, { session_id: SESS_HELD, format: 'trivia' }, STRANGER);
  var s2 = await membersRulesGate(ENV, json, STRANGER, DRAW_HELD).catch(function (e) { return { status: e.status, body: { error: e.message } }; });
  show('a stranger is told they are not staff, never whether the venue has ticked', s1.status === 403 && !termsFirst(s1) && /not staff/.test(s1.body.error) &&
       s2.status === 403 && /not staff/.test(s2.body.error), JSON.stringify([s1.body, s2.body]));

  print(''); print('Everywhere else: not held');
  world(false);
  var o1 = await call(handleHostGame, { session_id: SESS_OK, format: 'trivia' });
  show('an ordinary venue (terms_required false, no tick recorded) starts trivia past the gate', !termsFirst(o1) && o1.status !== 403, JSON.stringify(o1.body).slice(0, 200));
  var o2 = await membersRulesGate(ENV, json, HOST, DRAW_OK);
  show('an ordinary venue\'s members draw is not refused for terms', !termsFirst(o2), JSON.stringify(o2 && o2.body));
  world(true);
  var t1 = await call(handleHostGame, { session_id: SESS_HELD, format: 'musical' });
  var t2 = await call(handleBingoDrawStartForVenue, { venue_id: HELD, format: 'bingo90' });
  var t3 = await membersRulesGate(ENV, json, HOST, DRAW_HELD);
  DB.vp_sessions = []; var t4 = await call(handleCreateSession, { venue_id: HELD, format: 'trivia' });
  show('the same venue once it has ticked: /session, /host/game, /host/bingo/draw and the members draw all go past the gate',
       !termsFirst(t1) && !termsFirst(t2) && !termsFirst(t3) && !termsFirst(t4) && DB.vp_sessions.length === 1, JSON.stringify([t1.body, t2.body, t3 && t3.body]).slice(0, 300));

  print(''); print('The column, before and around migration 122');
  world(false); MIG = 'missing';
  var g1 = await call(handleHostGame, { session_id: SESS_HELD, format: 'trivia' });
  show('a database without the column holds nobody (no venue can carry the flag yet)', !termsFirst(g1), JSON.stringify(g1.body).slice(0, 200));
  MIG = 'broken';
  var g2 = await call(handleHostGame, { session_id: SESS_HELD, format: 'trivia' });
  show('any other database fault is an error, never a silent pass', g2.status === 502, JSON.stringify(g2));
  MIG = 'ran';

  print(''); print(bad ? (bad + ' FAILED of ' + ran) : ('PASS ' + ran + ' checks'));
  if (bad) throw new Error('prospect terms-first game gate: ' + bad + ' failed');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack)); throw e; });
drainMicrotasks();
