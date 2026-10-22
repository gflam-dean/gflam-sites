/* NUMBER BINGO FOR SA AND NT PUBS: the route is gone, on the REAL game Worker. RUN, not read.

   The console hides the Bingo tile for an SA or NT pub (Dean, 22 Oct 2026; migration 116). This is the
   other half: the shipped venueplay-game.js, loaded by tools/rig-game-worker.js (only the network and
   the database are fakes), refuses to open a number bingo session or a bingo draw for such a venue, so
   an old tab, a bookmark or a hand-typed request cannot start one. Musical bingo is not bingo, and an
   SA or NT pub opens a musical bingo session as before.

     /session (bingo)        SA pub and NT pub refused 403 number_bingo_off, nothing written;
                             musical bingo at the same SA pub opens; an SA club, a QLD pub and an NT pub
                             HQ has switched on all open
     /host/bingo/draw        the same, real balls (caller mode) included
     before migration 116    the read of number_bingo_on is refused by PostgREST: an SA pub is still
                             refused, an SA club still plays
     members draw, SA pub    "not here, roll it over" refused 409 before anything is written; a claim
                             goes through; a Queensland pub may still roll over
     members settings        an SA club's claim window is raised to 15 minutes; everywhere else the
                             30 second floor is unchanged

   Run from the repo root:  jsc tools/test-sant-bingo-game.js
*/
load('tools/rig-game-worker.js');
var finished = false;
var SA_PUB = '22222222-2222-4222-8222-000000000001', SA_CLUB = '22222222-2222-4222-8222-000000000002',
    NT_PUB = '22222222-2222-4222-8222-000000000003', NT_ON = '22222222-2222-4222-8222-000000000004',
    QLD_PUB = '22222222-2222-4222-8222-000000000005';
function venue(id, name, st, ent, extra) {
  return Object.assign({ id: id, name: name, slug: name.toLowerCase().replace(/ /g, '-'), status: 'active', au_state: st, entity_type: ent,
                         join_code: 'J' + id.slice(-5), max_players: 100, created_at: '2026-01-01T00:00:00Z' }, extra || {});
}
var NO_COLUMN = false;
var rigFetch = fetch;
fetch = async function (url, opts) {
  if (NO_COLUMN && /\/rest\/v1\/vp_venues\?/.test(String(url)) && /number_bingo_on/.test(String(url))) {
    return resp(400, { code: 'PGRST204', message: "Could not find the 'number_bingo_on' column of 'vp_venues' in the schema cache" });
  }
  return rigFetch(url, opts);
};
function world() {
  NO_COLUMN = false;
  DB = { vp_venues: [venue(SA_PUB, 'Glenelg Tavern', 'SA', 'for_profit', { number_bingo_on: false }),
                     venue(SA_CLUB, 'Henley Surf Club', 'SA', 'non_profit', { number_bingo_on: false }),
                     venue(NT_PUB, 'Nightcliff Hotel', 'NT', null, { number_bingo_on: false }),
                     venue(NT_ON, 'Darwin Tavern', 'NT', 'for_profit', { number_bingo_on: true }),
                     venue(QLD_PUB, 'Royal Hotel', 'QLD', 'for_profit', { number_bingo_on: false })],
         vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [], vp_claims: [],
         vp_game_reports: [], vp_gaming_declarations: [], vp_events: [], vp_bingo_draws: [], vp_bingo_draw_balls: [], vp_bingo_tickets: [], vp_bingo_claims: [],
         vp_member_draws: [], vp_member_draw_results: [], vp_rosters: [], vp_roster_members: [] };
}
function rows(t, venueId) { return (DB[t] || []).filter(function (r) { return !venueId || r.venue_id === venueId; }); }
async function session(venueId, format, caller) { BODY = { venue_id: venueId, format: format }; if (caller != null) BODY.caller = caller; try { return await handleCreateSession({}, ENV, json); } catch (e) { return { status: e.status || 500, body: { error: String(e.message || e) } }; } }
/* The draw goes through the Worker's own router, exactly as the console's request does, so the test
   also proves /host/bingo/draw reaches the venue check (it sits in front of the regulated handler). */
async function draw(venueId, caller) {
  BODY = { venue_id: venueId }; if (caller) BODY.caller = true;
  var req = { method: 'POST', url: 'https://game.test/host/bingo/draw', headers: { get: function () { return null; } } };
  var res = await __worker.fetch(req, ENV);
  var body = null; try { body = JSON.parse(res._b); } catch (e) { body = res._b; }
  return { status: res.status, body: body };
}

(async function () {
  print('a number bingo session');
  world();
  var r = await session(SA_PUB, 'bingo');
  show('SA pub: refused 403 number_bingo_off, and no session written', r.status === 403 && r.body.code === 'number_bingo_off' && rows('vp_sessions', SA_PUB).length === 0, JSON.stringify(r));
  show('...and the refusal says why, and that musical bingo and trivia are unaffected', /only a not-for-profit organisation may run bingo/.test(r.body.error) && /Musical bingo and trivia are unaffected/.test(r.body.error), r.body.error);
  r = await session(NT_PUB, 'bingo90');
  show('NT pub (type not recorded yet): refused the same way', r.status === 403 && rows('vp_sessions', NT_PUB).length === 0, JSON.stringify(r));
  r = await session(SA_PUB, 'musical-bingo');
  show('SA pub, MUSICAL bingo: opens as before (musical bingo is not bingo)', r.status === 200 && !!r.body.session_id && rows('vp_sessions', SA_PUB).length === 1, JSON.stringify(r));
  world();
  r = await session(SA_PUB, 'trivia');
  show('SA pub, trivia: opens', r.status === 200 && !!r.body.session_id, JSON.stringify(r));
  r = await session(SA_CLUB, 'bingo');
  show('SA club: number bingo opens', r.status === 200 && !!r.body.session_id, JSON.stringify(r));
  r = await session(NT_ON, 'bingo');
  show('NT pub HQ has switched on: opens', r.status === 200 && !!r.body.session_id, JSON.stringify(r));
  r = await session(QLD_PUB, 'bingo');
  show('Queensland pub: opens (nothing changes outside SA and NT)', r.status === 200 && !!r.body.session_id, JSON.stringify(r));

  print('a bingo draw (every game opens one, real balls included)');
  world();
  r = await draw(SA_PUB);
  show('SA pub: refused, and no draw row', r.status === 403 && r.body.code === 'number_bingo_off' && rows('vp_bingo_draws', SA_PUB).length === 0, JSON.stringify(r));
  r = await draw(SA_PUB, true);
  show('SA pub, caller mode (real balls): refused too', r.status === 403 && rows('vp_bingo_draws', SA_PUB).length === 0, JSON.stringify(r));
  r = await draw(NT_PUB);
  show('NT pub: refused', r.status === 403 && rows('vp_bingo_draws', NT_PUB).length === 0, JSON.stringify(r));
  r = await draw(SA_CLUB);
  show('SA club: a draw opens', r.status === 200 && !!r.body.draw_id && rows('vp_bingo_draws', SA_CLUB).length === 1, JSON.stringify(r));
  r = await draw(NT_ON);
  show('NT pub switched on by HQ: a draw opens', r.status === 200 && rows('vp_bingo_draws', NT_ON).length === 1, JSON.stringify(r));
  r = await draw(QLD_PUB);
  show('Queensland pub: a draw opens', r.status === 200 && rows('vp_bingo_draws', QLD_PUB).length === 1, JSON.stringify(r));

  print('before migration 116 (PostgREST refuses the column)');
  world(); NO_COLUMN = true;
  r = await draw(SA_PUB);
  show('SA pub: still refused (no switch means off)', r.status === 403 && rows('vp_bingo_draws', SA_PUB).length === 0, JSON.stringify(r));
  r = await draw(SA_CLUB);
  show('SA club: still plays', r.status === 200 && rows('vp_bingo_draws', SA_CLUB).length === 1, JSON.stringify(r));
  r = await session(QLD_PUB, 'bingo');
  show('Queensland pub: still plays', r.status === 200, JSON.stringify(r));

  print('members draw at an SA pub: the member drawn has won');
  function memberWorld(venueId) {
    world();
    DB.vp_member_draws = [{ id: '33333333-3333-4333-8333-000000000001', venue_id: venueId, roster_id: '66666666-6666-4666-8666-000000000001', name: 'Friday', current_jackpot_cents: 50000, starting_amount_cents: 10000, increment_cents: 5000,
                            last_resolved_at: null, last_drawn_at: '2026-09-19T09:29:00.000Z', time_to_claim_seconds: 120 }];
    DB.vp_members = [{ id: '44444444-4444-4444-8444-000000000001', roster_id: '66666666-6666-4666-8666-000000000001', member_number: 7, first_name: 'Jo', last_name: 'Bloggs' }];
    DB.vp_member_draw_results = [{ id: '55555555-5555-4555-8555-000000000001', draw_id: '33333333-3333-4333-8333-000000000001', venue_id: venueId, member_id: '44444444-4444-4444-8444-000000000001', member_number: 7, winner_name: 'Jo', outcome: 'drawn', drawn_at: '2026-09-19T09:29:00.000Z' }];
  }
  async function resolve(outcome) { BODY = { draw_id: '33333333-3333-4333-8333-000000000001', member_id: '44444444-4444-4444-8444-000000000001', member_number: 7, outcome: outcome }; try { return await handleMembersResolve({}, ENV, json); } catch (e) { return { status: e.status || 500, body: { error: String(e.message || e) } }; } }
  memberWorld(SA_PUB);
  var before = JSON.stringify([DB.vp_member_draws, DB.vp_member_draw_results]);
  r = await resolve('rollover');
  show('SA pub: "not here, roll it over" is refused 409 no_present_to_win', r.status === 409 && r.body.code === 'no_present_to_win' && /cannot require the winner to be present/.test(r.body.error), JSON.stringify(r));
  show('...and nothing was written: the jackpot and the result row are as they were', JSON.stringify([DB.vp_member_draws, DB.vp_member_draw_results]) === before);
  r = await resolve('claim');
  show('SA pub: recording the win goes through', r.status === 200 && DB.vp_member_draw_results.some(function (x) { return x.outcome === 'claimed'; }), JSON.stringify(r));
  memberWorld(SA_CLUB);
  r = await resolve('rollover');
  show('SA club: may still roll over (a members-only participation lottery)', r.status === 200 && DB.vp_member_draw_results.some(function (x) { return x.outcome === 'jackpot_rolled'; }), JSON.stringify(r));
  memberWorld(QLD_PUB);
  r = await resolve('rollover');
  show('Queensland pub: may still roll over', r.status === 200 && DB.vp_member_draw_results.some(function (x) { return x.outcome === 'jackpot_rolled'; }), JSON.stringify(r));

  print('members settings: the claim window');
  async function claimWindow(venueId, secs) {
    memberWorld(venueId);
    BODY = { draw_id: '33333333-3333-4333-8333-000000000001', time_to_claim_seconds: secs };
    try { await handleMembersSettings({}, ENV, json); } catch (e) { return 'threw: ' + (e.message || e); }
    return DB.vp_member_draws[0].time_to_claim_seconds;
  }
  var c1 = await claimWindow(SA_CLUB, 60), c2 = await claimWindow(QLD_PUB, 60), c3 = await claimWindow(SA_CLUB, 1200), c4 = await claimWindow(SA_CLUB, 0), c5 = await claimWindow(SA_PUB, 10);
  show('SA club: 60 seconds is raised to 15 minutes (900)', c1 === 900, c1);
  show('Queensland pub: 60 seconds stays 60', c2 === 60, c2);
  show('SA club: 20 minutes stays 20 minutes; 0 (no window) stays 0', c3 === 1200 && c4 === 0, [c3, c4]);
  show('SA pub: the ordinary 30 second floor', c5 === 30, c5);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
for (var i = 0; i < 400 && !finished; i++) drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('SA and NT number bingo, game Worker: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
