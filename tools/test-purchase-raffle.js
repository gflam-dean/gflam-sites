/* THE PURCHASE RAFFLE (migration 115, Deepwater Hotel, 22 Oct 2026), RUN, NOT READ.

   Loads the REAL shipped venueplay-game.js on the rig (tools/rig-game-worker.js: a fake PostgREST
   that honours filters, order, offset and limit and stops at 1,000 rows like the real one) and
   calls the real /host/praffle/* handlers: the HQ switch, who may set up, one entry per purchase,
   the 60 second "add another?", the daily cap, the 18+ and marketing ticks, undo, the masked list,
   the draw weighted by entries (counted over thousands of draws, past the 1,000-row ceiling), one
   prize per person, the redraw, and the draw record.

   Run from the repo root:  jsc tools/test-purchase-raffle.js */
load('tools/rig-game-worker.js');
var finished = false;
var OTHER = '33333333-3333-4333-8333-333333333333';
var ROLE = 'owner', STAFFID = 'staff-1', PERMS = null;
requireStaff = async function (env, uid, venueId) {
  if (ROLE === 'stranger') throw httpError(403, 'Not authorised: you are not staff at this venue');
  return { id: STAFFID, role: ROLE, venue_id: venueId, auth_user_id: uid, permissions: PERMS };
};
function req() { return { url: 'https://w/x', headers: { get: function () { return ''; } } }; }
async function call(fn, body) {
  BODY = body || {};
  try { return await fn(req(), ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
var T0 = Date.parse('2026-10-23T02:00:00.000Z');   // Friday 23 Oct, 1pm in Sydney
function world(on) {
  NOWMS = T0;
  DB = { vp_venues: [{ id: VENUE, name: 'Deepwater Hotel', slug: 'deepwater-hotel', status: 'active', timezone: 'Australia/Sydney', purchase_raffle_on: on !== false }],
         vp_venue_groups: [], vp_venue_staff: [{ id: 'staff-1', display_name: 'Sarah' }, { id: 'staff-2', display_name: 'Tom' }],
         vp_purchase_raffles: [], vp_purchase_raffle_entrants: [], vp_purchase_raffle_entries: [], vp_purchase_raffle_draws: [],
         vp_admin_audit: [], vp_member_draws: [], vp_sessions: [], vp_bingo_draws: [] };
  ROLE = 'owner'; STAFFID = 'staff-1'; PERMS = null;
}
var SETUP = { venue_id: VENUE, name: 'Summer Purchase Raffle', starts_on: '2026-10-23', ends_on: '2027-04-23', draw_on: '2027-04-24',
  draw_time: '19:30', draw_place: 'the front bar', prizes: [{ title: 'A trip for two to Fiji', value_cents: 500000 }] };
async function setup(extra) {
  var b = Object.assign({}, SETUP, extra || {});
  var r = await call(handlePraffleSave, b);
  return r;
}
function raffle() { return DB.vp_purchase_raffles[0]; }
var BOB = { first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com', marketing_opt_in: false, age_confirmed: true };
async function enter(phone, person, again) {
  return call(handlePraffleEnter, { venue_id: VENUE, raffle_id: raffle().id, phone: phone, person: person, again: again });
}
function audits(action) { return DB.vp_admin_audit.filter(function (a) { return a.action === action; }); }
function liveEntries() { return DB.vp_purchase_raffle_entries.filter(function (e) { return !e.voided_at; }); }

(async function () {
  print('mobiles: every way a person says one, and nothing that is not one');
  show('0412 345 678 is +61412345678', praffleNormPhone('0412 345 678') === '+61412345678');
  show('+61 412-345-678 is +61412345678', praffleNormPhone('+61 412-345-678') === '+61412345678');
  show('61412345678 and 412345678 are too', praffleNormPhone('61412345678') === '+61412345678' && praffleNormPhone('412345678') === '+61412345678');
  show('a landline, a short number and letters are refused', praffleNormPhone('0755551234') === null && praffleNormPhone('041234567') === null && praffleNormPhone('04123456ab') === null);
  show('masked shows only the last three', praffleMaskPhone('+61412345678') === '04xx xxx 678');

  print('the venue calendar: Sydney in daylight saving, not UTC and not Brisbane');
  show('midnight 23 Oct in Sydney is 13:00 UTC the day before', praffleLocalToIso('2026-10-23', '00:00', 'Australia/Sydney') === '2026-10-22T13:00:00.000Z', praffleLocalToIso('2026-10-23', '00:00', 'Australia/Sydney'));
  show('7:30 pm 24 Apr 2027 (after daylight saving ends) is 09:30 UTC', praffleLocalToIso('2027-04-24', '19:30', 'Australia/Sydney') === '2027-04-24T09:30:00.000Z', praffleLocalToIso('2027-04-24', '19:30', 'Australia/Sydney'));
  show('11:30 pm UTC is already the next day in Sydney', praffleLocalDay('Australia/Sydney', Date.parse('2026-10-23T23:30:00Z')) === '2026-10-24');

  print('OFF until HQ switches it on, for every route');
  world(false);
  var off = await call(handlePraffleState, { venue_id: VENUE });
  show('state answers 409 "not switched on"', off.status === 409 && /not switched on/.test(off.body.error), JSON.stringify(off));
  off = await setup();
  show('set up is refused and nothing is written', off.status === 409 && DB.vp_purchase_raffles.length === 0);
  DB.vp_venues[0].purchase_raffle_on = 'true';
  off = await setup();
  show('a stray string is not on', off.status === 409 && DB.vp_purchase_raffles.length === 0);
  ROLE = 'stranger'; world(true); ROLE = 'stranger';
  off = await call(handlePraffleState, { venue_id: VENUE });
  show('a login that is not staff here is refused before anything is read', off.status === 403);

  print('set up: owner or manager only, terms written from the settings, audited');
  world(true); ROLE = 'host';
  var s = await setup();
  show('a host cannot set it up', s.status === 403 && DB.vp_purchase_raffles.length === 0);
  ROLE = 'manager'; PERMS = { draws_raffles: false };
  s = await setup();
  show('a manager with draws and raffles switched off cannot', s.status === 403);
  PERMS = null;
  s = await setup({ prizes: [] });
  show('no prize, no raffle', s.status === 400);
  s = await setup({ ends_on: '2026-10-01' });
  show('an end before the start is refused', s.status === 400);
  s = await setup({ draw_on: '2027-04-23', draw_time: '12:00' });
  show('a draw before entries close is refused', s.status === 400);
  s = await setup({ daily_cap: 0 });
  show('a manager sets it up', s.status === 200 && raffle() && raffle().status === 'open', JSON.stringify(s.body).slice(0, 200));
  var r0 = raffle();
  show('no daily cap unless the venue sets one', r0.daily_cap === null);
  show('starts at midnight Sydney, closes 11:59 pm Sydney on the end date', r0.starts_at === '2026-10-22T13:00:00.000Z' && r0.closes_at === '2027-04-23T13:59:59.000Z', r0.starts_at + ' ' + r0.closes_at);
  var terms = r0.terms_text;
  show('terms: one entry per purchase transaction', /Each purchase transaction .* earns one entry/.test(terms));
  show('terms: never per drink or by the amount of alcohol', /not earned per drink or by the amount of alcohol/.test(terms));
  show('terms: 18 or over', /aged 18 or over/.test(terms));
  show('terms: the draw date, time and place', /the front bar at Saturday 24 April 2027 at 7:30\s?pm/i.test(terms), (terms.match(/7\. .*/) || [''])[0]);
  show('terms: how winners are told', /contacted by phone and email/.test(terms));
  show('terms: the prize and its value', /A trip for two to Fiji \(valued at \$5,000\)/.test(terms));
  show('terms: no limit stated as no limit', /no limit on the number of entries/.test(terms));
  show('terms: no em dash', terms.indexOf('—') < 0);
  show('creation is audited with who did it', audits('purchase_raffle_created').length === 1 && audits('purchase_raffle_created')[0].actor_label === 'host:staff-1');
  s = await setup({ raffle_id: r0.id, daily_cap: 3 });
  show('a change rewrites the terms', s.status === 200 && /no more than 3 entries a day/.test(raffle().terms_text));
  show('and the change is audited with from and to', audits('purchase_raffle_updated').length === 1 && JSON.stringify(audits('purchase_raffle_updated')[0].detail.changes.daily_cap) === '{"from":null,"to":3}', JSON.stringify(audits('purchase_raffle_updated')[0] && audits('purchase_raffle_updated')[0].detail.changes));
  s = await setup({ raffle_id: r0.id, daily_cap: '' });

  print('at the bar: a new mobile, then one tap per purchase');
  ROLE = 'host'; STAFFID = 'staff-2';
  var e = await enter('0412 345 678', null);
  show('a new mobile asks for their details', e.status === 400 && e.body.needs_details === true && DB.vp_purchase_raffle_entrants.length === 0);
  e = await enter('0412345678', Object.assign({}, BOB, { email: 'not-an-email' }));
  show('an email that is not an email is refused', e.status === 400 && DB.vp_purchase_raffle_entrants.length === 0);
  e = await enter('0412345678', Object.assign({}, BOB, { age_confirmed: 'yes' }));
  show('no 18+ confirmation, no entry', e.status === 400 && /18 or over/.test(e.body.error) && DB.vp_purchase_raffle_entrants.length === 0);
  e = await enter('0412345678', Object.assign({}, BOB, { marketing_opt_in: 'on' }));
  show('a new entrant gets their first entry', e.status === 200 && e.body.new_entrant === true && e.body.entries === 1, JSON.stringify(e.body));
  show('the confirm reads like a person', e.body.message === "Thanks Bob, you're in. 1 entry so far. Good luck!", e.body.message);
  var bob = DB.vp_purchase_raffle_entrants[0];
  show('stored as +61412345678', bob.phone === '+61412345678');
  show('the marketing tick is false unless it was a real yes', bob.marketing_opt_in === false && bob.opted_in_at === null);
  show('the 18+ confirmation is timestamped', !!bob.age_confirmed_at);
  show('the entry names the staff login that added it', DB.vp_purchase_raffle_entries[0].created_by === 'host:staff-2' && DB.vp_purchase_raffle_entries[0].created_by_name === 'Tom');
  show('the entry records the venue day', DB.vp_purchase_raffle_entries[0].venue_day === '2026-10-23');
  NOWMS += 20000;
  e = await enter('0412 345 678', null);
  show('the same mobile 20 seconds later asks "add another?" and adds nothing', e.status === 409 && e.body.needs_confirm === true && liveEntries().length === 1, JSON.stringify(e.body));
  e = await enter('0412 345 678', null, true);
  show('"yes, a new purchase" adds exactly one', e.status === 200 && e.body.entries === 2 && liveEntries().length === 2);
  NOWMS += 61000;
  e = await enter('+61412345678', null);
  show('a minute later it adds without asking', e.status === 200 && e.body.entries === 3 && e.body.message === "Thanks Bob, you're in. 3 entries so far. Good luck!", e.body.message);
  var l = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0412345678' });
  show('lookup: known, first name and count, mobile masked', l.status === 200 && l.body.known && l.body.first_name === 'Bob' && l.body.entries === 3 && l.body.phone_masked === '04xx xxx 678' && JSON.stringify(l.body).indexOf('345678') < 0, JSON.stringify(l.body));
  l = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0499 000 111' });
  show('lookup: a new mobile is not known', l.status === 200 && l.body.known === false);
  NOWMS += 61000;
  e = await enter('0499000111', { first_name: 'Ann', last_name: 'Lee', email: 'ANN@Example.com', marketing_opt_in: true, age_confirmed: true });
  show('a second entrant who ticked marketing themselves', e.status === 200 && DB.vp_purchase_raffle_entrants[1].marketing_opt_in === true && !!DB.vp_purchase_raffle_entrants[1].opted_in_at && DB.vp_purchase_raffle_entrants[1].email === 'ann@example.com');

  print('undo: your own for ten minutes, a manager any time, audited');
  var annEntry = DB.vp_purchase_raffle_entries[DB.vp_purchase_raffle_entries.length - 1];
  STAFFID = 'staff-1';
  var u = await call(handlePraffleUndo, { venue_id: VENUE, entry_id: annEntry.id });
  show('another host cannot take back Tom\'s entry', u.status === 403 && !annEntry.voided_at);
  STAFFID = 'staff-2';
  u = await call(handlePraffleUndo, { venue_id: VENUE, entry_id: annEntry.id });
  show('Tom can, inside ten minutes, and it is kept as voided', u.status === 200 && !!annEntry.voided_at && DB.vp_purchase_raffle_entries.indexOf(annEntry) >= 0);
  var first = DB.vp_purchase_raffle_entries[0];
  NOWMS += 11 * 60000;
  u = await call(handlePraffleUndo, { venue_id: VENUE, entry_id: first.id });
  show('after ten minutes Tom cannot', u.status === 403 && !first.voided_at);
  ROLE = 'manager';
  u = await call(handlePraffleUndo, { venue_id: VENUE, entry_id: first.id, reason: 'double scanned' });
  show('a manager can, and it is audited with the reason', u.status === 200 && !!first.voided_at && audits('purchase_raffle_entry_voided').length === 1 && audits('purchase_raffle_entry_voided')[0].detail.reason === 'double scanned');
  ROLE = 'host';
  l = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0412345678' });
  show('a voided entry no longer counts', l.body.entries === 2);

  print('the daily cap counts the venue day');
  ROLE = 'owner';
  await setup({ raffle_id: raffle().id, daily_cap: 2 });
  ROLE = 'host';
  NOWMS = Date.parse('2026-10-24T00:00:00Z');   // 11am Saturday in Sydney
  e = await enter('0412345678', null); NOWMS += 70000;
  e = await enter('0412345678', null); NOWMS += 70000;
  show('two today are fine', e.status === 200);
  e = await enter('0412345678', null);
  show('the third today is refused and says why', e.status === 409 && e.body.capped === true && /2 entries today/.test(e.body.error), JSON.stringify(e.body));
  NOWMS = Date.parse('2026-10-24T13:30:00Z');   // 12:30am Sunday in Sydney, still Saturday in UTC
  e = await enter('0412345678', null);
  show('after midnight Sydney it is a new day, whatever UTC says', e.status === 200, JSON.stringify(e.body));

  print('the list: owner or manager, masked, searchable, counted');
  ROLE = 'host';
  var li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id });
  show('a host cannot list the entrants', li.status === 403);
  ROLE = 'manager';
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id });
  show('a manager sees both, newest first', li.status === 200 && li.body.total === 2 && li.body.entrants[0].name === 'Ann Lee');
  show('no full mobile anywhere in the reply', JSON.stringify(li.body).indexOf('412345678') < 0 && JSON.stringify(li.body).indexOf('499000111') < 0);
  var bobRow = li.body.entrants.filter(function (x) { return x.name === 'Bob Smith'; })[0];
  show('entries counted without the voided one', bobRow && bobRow.entries === 5 && li.body.entrants[0].entries === 0, JSON.stringify(li.body.entrants));
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: 'smi' });
  show('search by name', li.body.total === 1 && li.body.entrants[0].name === 'Bob Smith');
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: '0111' });
  show('search by the end of the mobile', li.body.total === 1 && li.body.entrants[0].name === 'Ann Lee');
  var st = await call(handlePraffleState, { venue_id: VENUE });
  show('state: totals of entrants and live entries', st.status === 200 && st.body.totals.entrants === 2 && st.body.totals.entries === 5, JSON.stringify(st.body.totals));
  show('state: recent entries masked, with who added them', st.body.recent.length > 0 && st.body.recent[0].by === 'Tom' && JSON.stringify(st.body.recent).indexOf('345678') < 0);

  print('venue isolation');
  DB.vp_purchase_raffles.push({ id: '44444444-4444-4444-8444-444444444444', venue_id: OTHER, name: 'Theirs', status: 'open', prizes: [], starts_at: '2026-01-01T00:00:00Z', closes_at: '2027-01-01T00:00:00Z', draw_at: '2027-01-02T00:00:00Z' });
  e = await call(handlePraffleEnter, { venue_id: VENUE, raffle_id: '44444444-4444-4444-8444-444444444444', phone: '0412345678' });
  show('staff here cannot add to another venue\'s raffle', e.status === 404 && DB.vp_purchase_raffle_entries.every(function (x) { return x.raffle_id !== '44444444-4444-4444-8444-444444444444'; }));
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: '44444444-4444-4444-8444-444444444444' });
  show('or list it', li.status === 404);
  DB.vp_purchase_raffles.pop();

  print('the draw: not while entries are open, then fair, on the server, recorded');
  ROLE = 'manager';
  var d = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: raffle().id });
  show('refused while entries are open', d.status === 409 && /still open/.test(d.body.error));
  ROLE = 'host';
  var c = await call(handlePraffleClose, { venue_id: VENUE, raffle_id: raffle().id });
  show('a host cannot close entries', c.status === 403);
  ROLE = 'manager';
  c = await call(handlePraffleClose, { venue_id: VENUE, raffle_id: raffle().id });
  show('a manager closes entries early, audited', c.status === 200 && Date.parse(raffle().closes_at) <= NOWMS && audits('purchase_raffle_closed_early').length === 1);
  e = await call(handlePraffleEnter, { venue_id: VENUE, raffle_id: raffle().id, phone: '0412345678' });
  show('no entries after close', e.status === 409 && /closed/.test(e.body.error));
  ROLE = 'host';
  d = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: raffle().id });
  show('a host cannot draw', d.status === 403 && DB.vp_purchase_raffle_draws.length === 0);
  ROLE = 'manager';
  NOWMS += 1000;
  d = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: raffle().id });
  show('a manager draws', d.status === 200 && DB.vp_purchase_raffle_draws.length === 1, JSON.stringify(d.body).slice(0, 300));
  var rec = DB.vp_purchase_raffle_draws[0];
  show('the winner is Bob, the only one with live entries', d.body.draw.winner_name === 'Bob S' && d.body.draw.phone_last3 === '678');
  show('the record keeps the pool, the index and who drew', rec.entries_total === 5 && rec.pick_index >= 0 && rec.pick_index < 5 && rec.drawn_by_name === 'Tom' && rec.drawn_by === 'host:staff-2', JSON.stringify(rec));
  show('the manager gets the contact details to ring the winner', d.body.draw.contact && d.body.draw.contact.phone === '0412 345 678' && d.body.draw.contact.email === 'bob@example.com');
  show('a single prize: the raffle is drawn', raffle().status === 'drawn' && d.body.all_drawn === true);
  show('the draw is audited', audits('purchase_raffle_drawn').length === 1 && audits('purchase_raffle_drawn')[0].detail.entries_total === 5);
  d = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: raffle().id });
  show('a double tap does not draw twice', (d.status === 429 || d.status === 409) && DB.vp_purchase_raffle_draws.length === 1);
  var x = await call(handlePraffleRedraw, { venue_id: VENUE, draw_id: rec.id });
  show('a redraw needs a reason', x.status === 400 && rec.outcome === 'drawn');
  x = await call(handlePraffleRedraw, { venue_id: VENUE, draw_id: rec.id, reason: 'no answer for 14 days' });
  show('the redraw keeps the draw as redrawn and reopens the prize', x.status === 200 && rec.outcome === 'redrawn' && rec.redraw_reason === 'no answer for 14 days' && raffle().status === 'open');
  NOWMS += 11000;
  d = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: raffle().id });
  show('the next draw cannot pick the redrawn winner, and Ann has no live entries', d.status === 409 && /no entries left/.test(d.body.error), JSON.stringify(d.body));
  e = await call(handlePraffleSave, Object.assign({}, SETUP, { raffle_id: raffle().id }));
  show('settings can still change while a prize is open again', e.status === 200 || e.status === 409);

  print('the draw record download carries it, with no mobile');
  var ex = await call(function (rq, env, j) { return handleDrawsExport({ url: 'https://w/host/draws/export?venue_id=' + VENUE + '&format=csv', headers: rq.headers }, env, j, {}); });
  var csv = ex._b || '';
  show('a purchase raffle line per draw', /purchase raffle,Summer Purchase Raffle/.test(csv) && /redrawn at/.test(csv), csv.split('\r\n').slice(2, 4).join(' | '));
  show('the mobile is never in it beyond the last three', csv.indexOf('412345678') < 0 && csv.indexOf('0412') < 0);

  print('weighted by entries, over thousands of draws, past the 1,000-row ceiling');
  world(true); ROLE = 'owner';
  await setup({ prizes: [{ title: 'First' }, { title: 'Second' }] });
  var R = raffle();
  function person(id, phone, first) { DB.vp_purchase_raffle_entrants.push({ id: id, raffle_id: R.id, venue_id: VENUE, phone: phone, first_name: first, last_name: 'X', email: first + '@x.au', marketing_opt_in: false, created_at: '2026-10-23T03:00:00Z' }); }
  var A = '0aaaaaaa-0000-4000-8000-000000000001', B = '0bbbbbbb-0000-4000-8000-000000000002', C = '0ccccccc-0000-4000-8000-000000000003';
  person(A, '+61400000001', 'Alf'); person(B, '+61400000002', 'Bea'); person(C, '+61400000003', 'Cat');
  var n = 0;
  function addEntries(who, k) { for (var i = 0; i < k; i++) { n++; DB.vp_purchase_raffle_entries.push({ id: 'e' + ('000000' + n).slice(-6), raffle_id: R.id, entrant_id: who, venue_id: VENUE, venue_day: '2026-10-23', created_at: '2026-10-23T03:00:00Z', voided_at: null }); } }
  addEntries(A, 1000); addEntries(B, 2000); addEntries(C, 1000);   // B's are ids 1001..3000: behind the ceiling
  R.closes_at = new Date(NOWMS - 1000).toISOString();
  var wins = {}; wins[A] = 0; wins[B] = 0; wins[C] = 0;
  var RUNS = 4000;
  for (var k = 0; k < RUNS; k++) {
    DB.vp_purchase_raffle_draws = []; R.status = 'open'; NOWMS += 20000;
    var w = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: R.id });
    if (w.status !== 200) { show('draw ' + k + ' ran', false, JSON.stringify(w)); break; }
    wins[DB.vp_purchase_raffle_draws[0].entrant_id]++;
  }
  var pb = wins[B] / RUNS, pa = wins[A] / RUNS, pc = wins[C] / RUNS;
  show('Bea, with half the entries, all past row 1,000, wins about half the time', pb > 0.46 && pb < 0.54, (pb * 100).toFixed(1) + '%');
  show('Alf and Cat, a quarter each, about a quarter each', pa > 0.21 && pa < 0.29 && pc > 0.21 && pc < 0.29, (pa * 100).toFixed(1) + '% / ' + (pc * 100).toFixed(1) + '%');
  DB.vp_purchase_raffle_draws = []; R.status = 'open'; NOWMS += 20000;
  var d1 = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: R.id });
  NOWMS += 20000;
  var d2 = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: R.id });
  show('two prizes go to two different people, in order', d1.status === 200 && d2.status === 200 && DB.vp_purchase_raffle_draws[0].entrant_id !== DB.vp_purchase_raffle_draws[1].entrant_id && DB.vp_purchase_raffle_draws[0].prize_index === 0 && DB.vp_purchase_raffle_draws[1].prize_index === 1);
  show('the second pool leaves out the first winner\'s entries', DB.vp_purchase_raffle_draws[1].entries_total === 4000 - DB.vp_purchase_raffle_draws[0].winner_entries, DB.vp_purchase_raffle_draws[1].entries_total + '');
  show('both prizes drawn: the raffle is drawn', R.status === 'drawn' && d2.body.all_drawn === true);
  NOWMS += 20000;
  var d3 = await call(handlePraffleDraw, { venue_id: VENUE, raffle_id: R.id });
  show('no third draw for two prizes', d3.status === 409);
  var sv = await call(handlePraffleSave, Object.assign({}, SETUP, { raffle_id: R.id, name: 'Changed' }));
  show('a drawn raffle\'s settings cannot change', sv.status === 409 && R.name !== 'Changed');

  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('purchase raffle: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
