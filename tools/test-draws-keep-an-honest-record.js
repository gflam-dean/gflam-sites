/* The record of a draw is there to check the host, so it cannot take the host's word for it.

   Runs the REAL members-draw and raffle handlers out of the shipped game Worker against a fake
   database that filters, orders and limits like the real one (tools/rig-game-worker.js), with
   the clock in our hands. The raffle half also runs the console's OWN restore decision, lifted
   out of the shipped raffle/host.html by its text, because that fault lived between the two.

   Run from the repo root:  jsc tools/test-draws-keep-an-honest-record.js
*/
load('tools/rig-game-worker.js');
var finished = false;

var DRAW = '55555555-5555-4555-8555-555555555555', ROSTER = '66666666-6666-4666-8666-666666666666';
function uuid(n) { var s = ('000000000000' + n).slice(-12); return '77777777-7777-4777-8777-' + s; }
function resetMembers() {
  DB.vp_member_draws = [{ id: DRAW, venue_id: VENUE, roster_id: ROSTER, name: 'Friday Badge Draw', current_jackpot_cents: 240000,
    starting_amount_cents: 50000, increment_cents: 10000, draw_length_seconds: 4, time_to_claim_seconds: 60,
    last_resolved_at: null, last_drawn_at: null, last_drawn_date: null }];
  DB.vp_member_rosters = [{ id: ROSTER, venue_id: VENUE }];
  DB.vp_members = []; for (var i = 1; i <= 50; i++) DB.vp_members.push({ id: uuid(i), roster_id: ROSTER, member_number: 100 + i, first_name: 'Member', last_name: 'N' + i, status: 'valid' });
  DB.vp_venue_settings = [{ venue_id: VENUE, name_display: 'abbrev_last' }];
  DB.vp_member_draw_results = [];
}
function results() { return DB.vp_member_draw_results.map(function (r) { return { num: r.member_number, outcome: r.outcome, amt: r.amount_cents }; }); }
function jackpot() { return DB.vp_member_draws[0].current_jackpot_cents; }

/* The console's restore decision, out of the file that ships. If the markers move, this fails
   loudly instead of testing a copy. */
var HOSTPAGE = readFile('venueplay/app/raffle/host.html');
var a = HOSTPAGE.indexOf('var _lastOutcome = "", _lastPrize = "";');
var b = HOSTPAGE.indexOf('var _stillLive =', a);
var bEnd = HOSTPAGE.indexOf(';', b) + 1;
if (a < 0 || b < 0) throw new Error('cannot find the restore decision in raffle/host.html');
var DECIDE = new Function('g', HOSTPAGE.slice(a, bEnd) + '\nreturn { stillLive: _stillLive, prize: _lastPrize, outcome: _lastOutcome };');

(async function () {
  print('members draw: the row names who the DRAW picked');
  resetMembers();
  BODY = { draw_id: DRAW }; var f1 = await handleMembersDraw({}, ENV, json);
  var other = DB.vp_members.filter(function (m) { return m.id !== f1.body.member_id; })[0];
  NOWMS += 30000;
  BODY = { draw_id: DRAW, member_id: other.id, outcome: 'claim' };
  var f2 = await handleMembersResolve({}, ENV, json);
  show('a Claim naming a different member is refused', f2.status === 409, 'status ' + f2.status);
  show('nothing is recorded as paid on its say-so', !results().some(function (r) { return r.outcome === 'claimed'; }) && jackpot() === 240000, JSON.stringify(results()) + ' jackpot ' + jackpot());
  BODY = { draw_id: DRAW, member_number: other.member_number, outcome: 'claim' };
  var f3 = await handleMembersResolve({}, ENV, json);
  show('the same by member NUMBER', f3.status === 409, 'status ' + f3.status);
  BODY = { draw_id: DRAW, member_id: f1.body.member_id, outcome: 'claim' };
  var f4 = await handleMembersResolve({}, ENV, json);
  show('the right member claims: recorded against the member the draw picked',
    f4.status === 200 && results().length === 1 && results()[0].num === f1.body.member_number && results()[0].outcome === 'claimed', JSON.stringify(results()));
  resetMembers();
  BODY = { draw_id: DRAW }; var g1 = await handleMembersDraw({}, ENV, json);
  NOWMS += 30000;
  BODY = { draw_id: DRAW, outcome: 'claim' };
  await handleMembersResolve({}, ENV, json);
  show('a Claim that names nobody still closes the member who was drawn', results().length === 1 && results()[0].num === g1.body.member_number && results()[0].outcome === 'claimed', JSON.stringify(results()));

  print('members draw: a duplicate is "nothing drawn since", not a stopwatch');
  resetMembers();
  BODY = { draw_id: DRAW }; var d1 = await handleMembersDraw({}, ENV, json);
  NOWMS += 70000;
  BODY = { draw_id: DRAW, member_id: d1.body.member_id, outcome: 'rollover' };
  await handleMembersResolve({}, ENV, json);
  show('first number rolls over', jackpot() === 250000, 'jackpot ' + jackpot());
  NOWMS += 20000;
  BODY = { draw_id: DRAW }; var d2 = await handleMembersDraw({}, ENV, json);
  show('the second number of the night is a NEW draw', !d2.body.pending && d2.status === 200, JSON.stringify(d2.body).slice(0, 120));
  NOWMS += 45000;   // 135 seconds after the first resolve: inside the old five minute window
  BODY = { draw_id: DRAW, member_id: d2.body.member_id, outcome: 'claim' };
  var r2 = await handleMembersResolve({}, ENV, json);
  show('her genuine claim 135s later is recorded, not called a duplicate', !r2.body.duplicate && results().some(function (r) { return r.outcome === 'claimed'; }), JSON.stringify(r2.body));
  show('and the jackpot resets', jackpot() === 50000, 'jackpot ' + jackpot());

  resetMembers();
  BODY = { draw_id: DRAW }; var e1 = await handleMembersDraw({}, ENV, json);
  NOWMS += 70000;
  BODY = { draw_id: DRAW, member_id: e1.body.member_id, outcome: 'rollover' };
  await handleMembersResolve({}, ENV, json);       // lands; the reply is lost
  NOWMS += 6 * 60000;                               // outside the old five minute window
  var e3 = await handleMembersResolve({}, ENV, json);
  show('the same rollover tapped again six minutes later is a duplicate', e3.body.duplicate === true, JSON.stringify(e3.body));
  show('one draw, ONE increment', jackpot() === 250000, 'jackpot ' + jackpot());
  show('and one row', results().length === 1, JSON.stringify(results()));

  print('raffle: a finished round stays finished');
  var SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  DB.vp_sessions = [{ id: SESSION, venue_id: VENUE, status: 'running', state_version: 1, join_code: 'ACDEFG' }];
  DB.vp_venues = [{ id: VENUE, slug: 'test-pub', status: 'active' }];
  DB.vp_players = [];
  DB.vp_games = [{ id: GAME, session_id: SESSION, seq: 1, format: 'raffle', status: 'running', config: { leading_zeros: true, spin_seconds: 4 } }];
  DB.vp_raffle_games = [{ game_id: GAME, range_min: 1, range_max: 500, draws_count: 1, allow_redraw: true, time_to_claim_seconds: 180 }];
  DB.vp_raffle_results = [];
  BODY = { game_id: GAME, prize: 'Meat tray', prize_type: 'other' };
  var d = await handleHostDraw({}, ENV, json);
  var live = DECIDE((await getPublicSnapshot(ENV, SESSION)).game);
  show('a reload while the winner is still awaited DOES bring the round back', live.stillLive === true && live.prize === 'Meat tray', JSON.stringify(live));
  BODY = { game_id: GAME, seq: d.body.seq, outcome: 'claimed' };
  await handleDrawResolve({}, ENV, json);
  var after = DECIDE((await getPublicSnapshot(ENV, SESSION)).game);
  show('a reload after the prize is CLAIMED does not re-arm it', after.stillLive === false && after.outcome === 'claimed', JSON.stringify(after));
  NOWMS += 60000;
  BODY = { game_id: GAME, redraw_of_seq: d.body.seq, prize: 'Meat tray', prize_type: 'other' };
  var rd = await handleHostDraw({}, ENV, json);
  show('the server refuses to redraw a claimed round', rd.status === 409, 'status ' + rd.status);
  show('the record still says claimed', DB.vp_raffle_results[0].outcome === 'claimed', DB.vp_raffle_results[0].outcome);
  show('and no second ticket was drawn for the same prize', DB.vp_raffle_results.length === 1, DB.vp_raffle_results.length + ' rows');

  BODY = { game_id: GAME, prize: 'Bar voucher', prize_type: 'other' };
  var n = await handleHostDraw({}, ENV, json);
  NOWMS += 60000;
  BODY = { game_id: GAME, redraw_of_seq: n.body.seq, prize: 'Bar voucher', prize_type: 'other' };
  var n1 = await handleHostDraw({}, ENV, json);
  show('a round still waiting CAN be redrawn', n1.status === 200 && DB.vp_raffle_results.length === 3, 'status ' + n1.status + ', ' + DB.vp_raffle_results.length + ' rows');
  NOWMS += 60000;
  var n2 = await handleHostDraw({}, ENV, json);     // the same redraw again: a retry of a lost reply
  show('but not twice: a repeat does not draw a third ticket', n2.status === 409 && DB.vp_raffle_results.length === 3, 'status ' + n2.status + ', ' + DB.vp_raffle_results.length + ' rows');

  print('raffle: a plain draw whose reply was lost comes back with the SAME round');
  /* The console aborts a slow /host/draw and tries again. Round n1 (the redraw above) is still
     waiting on its winner, so the retry must hand that round back, not mint a fourth ticket
     and leave n1's ticket stuck at drawn for ever. */
  NOWMS += 16000;
  BODY = { game_id: GAME, prize: 'Bar voucher', prize_type: 'other' };
  var again = await handleHostDraw({}, ENV, json);
  show('the retry is answered with the round still waiting', again.status === 200 && again.body.seq === n1.body.seq && again.body.tickets[0] === n1.body.tickets[0] && again.body.resumed === true, JSON.stringify(again.body));
  show('and no new ticket was drawn', DB.vp_raffle_results.length === 3, DB.vp_raffle_results.length + ' rows');
  var ev = (DB.__events || []).filter(function (e) { return e.type === 'raffle.winner'; }).pop();
  show('the wall is shown that same winner again', !!ev && ev.payload.seq === n1.body.seq && ev.payload.resumed === true, JSON.stringify(ev && ev.payload));
  BODY = { game_id: GAME, seq: n1.body.seq, outcome: 'claimed' };
  await handleDrawResolve({}, ENV, json);
  NOWMS += 16000;
  BODY = { game_id: GAME, prize: 'Bar voucher', prize_type: 'other' };
  var next = await handleHostDraw({}, ENV, json);
  show('once it is claimed, the next draw is a real new round', next.status === 200 && next.body.seq === n1.body.seq + 1 && !next.body.resumed && DB.vp_raffle_results.length === 4, 'seq ' + (next.body && next.body.seq) + ', ' + DB.vp_raffle_results.length + ' rows');

  print('raffle with no redraw: every draw is a new round, as it always was');
  var GAME2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  DB.vp_games.push({ id: GAME2, session_id: SESSION, seq: 2, format: 'raffle', status: 'running', config: { leading_zeros: true, spin_seconds: 4 } });
  DB.vp_raffle_games.push({ game_id: GAME2, range_min: 1, range_max: 500, draws_count: 1, allow_redraw: false, time_to_claim_seconds: 0 });
  BODY = { game_id: GAME2, prize: 'Meat tray', prize_type: 'other' };
  var p1 = await handleHostDraw({}, ENV, json);
  NOWMS += 16000;
  var p2 = await handleHostDraw({}, ENV, json);
  show('two draws, two rounds, nothing waited on', p1.status === 200 && p2.status === 200 && p2.body.seq === p1.body.seq + 1 && !p2.body.resumed, 'seqs ' + (p1.body && p1.body.seq) + ' then ' + (p2.body && p2.body.seq));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('draw records: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
