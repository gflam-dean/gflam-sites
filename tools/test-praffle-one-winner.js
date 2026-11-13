/* ONE WINNER PER PRIZE, WITH TWO CONSOLES DRAWING AT ONCE (security audit 3 Nov 2026, M4).

   handlePraffleDraw reads the draws, picks the first undrawn prize, then inserts. Two consoles
   (pickup is supported) or a double tap that beats the client both read "no draws yet", both
   pick prize 0 and both inserted: the legal record of a lottery showed two winners for one prize.
   Migration 147 adds a partial unique index on (raffle_id, prize_index) where outcome = 'drawn'.
   The fake database here enforces exactly that index (DB_HAS_147), and both draws are held at
   the insert until BOTH have read the draws, so the race happens every run, not by luck.

   Runs the REAL handlePraffleDraw on tools/rig-game-worker.js.
   Run from the repo root:  jsc tools/test-praffle-one-winner.js
*/
load('tools/rig-game-worker.js');
var finished = false;
requireStaff = async function (env, uid, venueId) { return { id: 'staff-1', role: 'manager', venue_id: venueId, auth_user_id: uid, permissions: null }; };
function req() { return { url: 'https://w/x', headers: { get: function () { return ''; } } }; }
var RID = '45000000-0000-4000-8000-000000000001';
function world(prizes) {
  NOWMS = Date.parse('2026-10-24T09:00:00.000Z');
  DB = { vp_venues: [{ id: VENUE, name: 'Deepwater Hotel', slug: 'deepwater-hotel', status: 'active', timezone: 'Australia/Sydney', purchase_raffle_on: true }],
         vp_venue_groups: [], vp_venue_staff: [{ id: 'staff-1', display_name: 'Sarah' }],
         vp_purchase_raffles: [{ id: RID, venue_id: VENUE, name: 'Summer Purchase Raffle', status: 'open', prizes: prizes,
                                 starts_at: '2026-10-01T00:00:00Z', closes_at: '2026-10-23T00:00:00Z', draw_at: '2026-10-24T08:00:00Z' }],
         vp_purchase_raffle_entrants: [], vp_purchase_raffle_entries: [], vp_purchase_raffle_draws: [], vp_admin_audit: [] };
  ['Bob', 'Ann', 'Cal', 'Dee'].forEach(function (n, i) {
    var id = '46000000-0000-4000-8000-00000000000' + i;
    DB.vp_purchase_raffle_entrants.push({ id: id, raffle_id: RID, venue_id: VENUE, phone: '+6141234567' + i, first_name: n, last_name: 'X', email: n + '@x.au' });
    for (var k = 0; k < 3; k++) DB.vp_purchase_raffle_entries.push({ id: 'e' + i + k, raffle_id: RID, entrant_id: id, venue_id: VENUE, voided_at: null });
  });
}

/* The race, forced: every insert into the draws waits until WAITING inserts have arrived. */
var realFetch = fetch, DB_HAS_147 = true, WAITING = 2, arrived = 0, release = null, gate = null;
function armGate(n) { WAITING = n; arrived = 0; gate = new Promise(function (res) { release = res; }); }
fetch = async function (url, opts) {
  var u = String(url), m = ((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'POST' && /\/rest\/v1\/vp_purchase_raffle_draws(\?|$)/.test(u)) {
    if (gate) { arrived++; if (arrived >= WAITING) release(); await gate; }
    if (DB_HAS_147) {
      var row = JSON.parse(opts.body);
      var clash = (DB.vp_purchase_raffle_draws || []).some(function (d) { return d.raffle_id === row.raffle_id && d.prize_index === row.prize_index && d.outcome === 'drawn'; });
      if (clash) return resp(409, { code: '23505', message: 'duplicate key value violates unique constraint "vp_purchase_raffle_draws_one_winner"' });
    }
  }
  return realFetch(url, opts);
};
async function draw() {
  BODY = { venue_id: VENUE, raffle_id: RID };
  try { return await handlePraffleDraw(req(), ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function drawnRows() { return DB.vp_purchase_raffle_draws.filter(function (d) { return d.outcome === 'drawn'; }); }

(async function () {
  print('the race exists without migration 147 (why the index is needed)');
  world([{ title: 'A trip for two to Fiji' }]); DB_HAS_147 = false; armGate(2);
  var both = await Promise.all([draw(), draw()]);
  show('two simultaneous draws really do both reach the insert (the test can see the race)',
       both[0].status === 200 && both[1].status === 200 && drawnRows().length === 2 && drawnRows()[0].prize_index === drawnRows()[1].prize_index,
       JSON.stringify(both.map(function (r) { return r.status; })));

  print('with migration 147: one prize, two consoles, one winner');
  world([{ title: 'A trip for two to Fiji' }]); DB_HAS_147 = true; armGate(2);
  both = await Promise.all([draw(), draw()]);
  var ok = both.filter(function (r) { return r.status === 200; }), lost = both.filter(function (r) { return r.status !== 200; });
  show('exactly one draw is recorded for the prize', drawnRows().length === 1, String(drawnRows().length));
  show('one console gets the winner', ok.length === 1 && !!ok[0].body.draw);
  show('the other gets a 409 saying the prize has just been drawn', lost.length === 1 && lost[0].status === 409 && lost[0].body.already_drawn === true && /just been drawn on another screen/.test(lost[0].body.error), JSON.stringify(lost[0] && lost[0].body));
  show('only the recorded draw is audited', DB.vp_admin_audit.filter(function (a) { return a.action === 'purchase_raffle_drawn'; }).length === 1);
  show('the raffle is marked drawn once', DB.vp_purchase_raffles[0].status === 'drawn');

  print('two prizes, a double tap: still one winner per prize, and the next draw carries on');
  world([{ title: 'First' }, { title: 'Second' }]); DB_HAS_147 = true; armGate(2);
  both = await Promise.all([draw(), draw()]);
  show('the double tap records prize 0 once', drawnRows().length === 1 && drawnRows()[0].prize_index === 0);
  gate = null; NOWMS += 20000;
  var next = await draw();
  show('the next draw takes prize 1, for somebody else', next.status === 200 && drawnRows().length === 2 && drawnRows()[1].prize_index === 1 && drawnRows()[1].entrant_id !== drawnRows()[0].entrant_id, JSON.stringify(next.body).slice(0, 200));

  print('a redrawn prize can be drawn again (the index is only over outcome = drawn)');
  DB.vp_purchase_raffle_draws[0].outcome = 'redrawn'; NOWMS += 20000;
  next = await draw();
  show('prize 0 is drawn again after a redraw', next.status === 200 && drawnRows().filter(function (d) { return d.prize_index === 0; }).length === 1, JSON.stringify(next.body).slice(0, 200));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('purchase raffle one winner: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
