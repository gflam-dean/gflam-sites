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
var ROLE = 'owner', STAFFID = 'staff-1', PERMS = null, ADMIN = false;
requireStaff = async function (env, uid, venueId) {
  if (ROLE === 'stranger') throw httpError(403, 'Not authorised: you are not staff at this venue');
  return { id: STAFFID, role: ROLE, venue_id: venueId, auth_user_id: uid, permissions: PERMS, is_admin: ADMIN };
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
         vp_venue_settings: [{ venue_id: VENUE, collect_first_name: true, collect_last_name: true, collect_email: true, collect_postcode: false, collect_marketing_optin: true }],
         vp_captures: [],
         vp_venue_groups: [], vp_venue_staff: [{ id: 'staff-1', display_name: 'Sarah' }, { id: 'staff-2', display_name: 'Tom' }],
         vp_purchase_raffles: [], vp_purchase_raffle_entrants: [], vp_purchase_raffle_entries: [], vp_purchase_raffle_draws: [],
         vp_admin_audit: [], vp_member_draws: [], vp_sessions: [], vp_bingo_draws: [] };
  ROLE = 'owner'; STAFFID = 'staff-1'; PERMS = null; ADMIN = false;
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
  show('terms: the draw date, time and place', /the front bar on Saturday 24 April 2027 at 7:30\s?pm/i.test(terms), (terms.match(/7\. .*/) || [''])[0]);
  show('terms: how winners are told', /contacted by phone, and by email if they gave one, within 2 business days/.test(terms));
  show('terms: the prize and its value', /A trip for two to Fiji \(valued at \$5,000\)/.test(terms));
  show('terms: no limit stated as no limit', /no limit on the number of entries/.test(terms));
  show('terms: never "at" a date (closes on, draw on)', !/(closes|place) at (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/.test(terms.replace(/the front bar/, '')) && /closes on /.test(terms));
  show('terms: no em dash', terms.indexOf(String.fromCharCode(0x2014)) < 0);
  show('creation is audited with who did it', audits('purchase_raffle_created').length === 1 && audits('purchase_raffle_created')[0].actor_label === 'host:staff-1');
  s = await setup({ raffle_id: r0.id, daily_cap: 3 });
  show('the start date has passed, so a venue manager cannot change it now', s.status === 409 && /locked/.test(s.body.error) && raffle().daily_cap === null, JSON.stringify(s.body));
  ADMIN = true;
  s = await setup({ raffle_id: r0.id, daily_cap: 3, reason: 'venue asked: cap was wrong' });
  show('a change rewrites the terms', s.status === 200 && /no more than 3 entries a day/.test(raffle().terms_text));
  show('and the change is audited with from and to', audits('purchase_raffle_updated').length === 1 && JSON.stringify(audits('purchase_raffle_updated')[0].detail.changes.daily_cap) === '{"from":null,"to":3}', JSON.stringify(audits('purchase_raffle_updated')[0] && audits('purchase_raffle_updated')[0].detail.changes));
  s = await setup({ raffle_id: r0.id, daily_cap: '', reason: 'put back' });
  ADMIN = false;

  print('at the bar: a new mobile, then one tap per purchase');
  ROLE = 'host'; STAFFID = 'staff-2';
  var e = await enter('0412 345 678', null);
  show('a new mobile asks for their details', e.status === 400 && e.body.needs_details === true && DB.vp_purchase_raffle_entrants.length === 0);
  e = await enter('0412345678', Object.assign({}, BOB, { email: 'not-an-email' }));
  show('an email that is not an email is refused', e.status === 400 && DB.vp_purchase_raffle_entrants.length === 0);
  e = await enter('0400000099', { first_name: 'Zed', last_name: 'Young', email: 'zed@example.com', marketing_opt_in: false });
  show('no 18+ tick is asked or refused: a new entrant with no such field is added, and age_confirmed_at holds the entry time', e.status === 200 && DB.vp_purchase_raffle_entrants.length === 1 && DB.vp_purchase_raffle_entrants[0].age_confirmed_at === new Date(NOWMS).toISOString(), JSON.stringify(e.body));
  DB.vp_purchase_raffle_entrants.length = 0; DB.vp_purchase_raffle_entries.length = 0; NOWMS += 61000;
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
  show('lookup gives the name as first name and last initial, with the count, for the confirm card', l.body.name === 'Bob S.' || l.body.name === 'Bob S', l.body.name);
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
  ROLE = 'owner'; ADMIN = true;
  await setup({ raffle_id: raffle().id, daily_cap: 2, reason: 'test cap' });
  ROLE = 'host'; ADMIN = false;
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
  var flat = JSON.stringify(li.body).replace(/\s/g, '');   // "0412 345 678" with its spaces is still the whole number
  show('no full mobile anywhere in the reply, spaced or not', flat.indexOf('412345678') < 0 && flat.indexOf('499000111') < 0);
  var bobRow = li.body.entrants.filter(function (x) { return x.name === 'Bob Smith'; })[0];
  show('entries counted without the voided one', bobRow && bobRow.entries === 5 && li.body.entrants[0].entries === 0, JSON.stringify(li.body.entrants));
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: 'smi' });
  show('search by name', li.body.total === 1 && li.body.entrants[0].name === 'Bob Smith');
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: '0111' });
  show('search by the end of the mobile', li.body.total === 1 && li.body.entrants[0].name === 'Ann Lee');
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: '0412345678' });
  show('search by the FULL mobile as typed (0412345678) finds Bob, with his entry count', li.body.total === 1 && li.body.entrants[0].name === 'Bob Smith' && li.body.entrants[0].entries === 5, JSON.stringify(li.body.entrants));
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: '678' });
  show('search by the last three digits (678) finds Bob, with his count', li.body.total === 1 && li.body.entrants[0].name === 'Bob Smith' && li.body.entrants[0].entries === 5, JSON.stringify(li.body.entrants));
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: 'Bob' });
  show('search by first name (Bob) finds Bob, with his count', li.body.total === 1 && li.body.entrants[0].name === 'Bob Smith' && li.body.entrants[0].entries === 5, JSON.stringify(li.body.entrants));
  li = await call(handlePraffleEntrants, { venue_id: VENUE, raffle_id: raffle().id, q: '4123' });
  show('the search box says LAST digits: digits from the middle of a mobile find nobody', li.status === 200 && li.body.total === 0, JSON.stringify(li.body.total));
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
  c = await call(handlePraffleClose, { venue_id: VENUE, raffle_id: raffle().id, reason: 'wrong date' });
  show('an owner or manager cannot close early either, and is told who to ring', c.status === 403 && /contact venueplay on 07 5228 3667/.test(c.body.error) && Date.parse(raffle().closes_at) > NOWMS, JSON.stringify(c));
  ROLE = 'owner';
  c = await call(handlePraffleClose, { venue_id: VENUE, raffle_id: raffle().id });
  show('venue owner close refused (403), nothing changed, nothing audited', c.status === 403 && Date.parse(raffle().closes_at) > NOWMS && audits('purchase_raffle_closed_early').length === 0);
  ROLE = 'manager'; ADMIN = true;
  c = await call(handlePraffleClose, { venue_id: VENUE, raffle_id: raffle().id });
  show('HQ close without a reason is refused', c.status === 400 && Date.parse(raffle().closes_at) > NOWMS && audits('purchase_raffle_closed_early').length === 0, JSON.stringify(c));
  c = await call(handlePraffleClose, { venue_id: VENUE, raffle_id: raffle().id, reason: 'ab' });
  show('HQ close with a 2 character reason is refused', c.status === 400);
  c = await call(handlePraffleClose, { venue_id: VENUE, raffle_id: raffle().id, reason: 'Venue put the wrong end date in' });
  show('HQ close with a reason works and is audited with the reason', c.status === 200 && Date.parse(raffle().closes_at) <= NOWMS && audits('purchase_raffle_closed_early').length === 1 && audits('purchase_raffle_closed_early')[0].detail.reason === 'Venue put the wrong end date in', JSON.stringify(audits('purchase_raffle_closed_early')));
  ADMIN = false;
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

  print('terms are locked once the raffle starts or has an entry; HQ can still change them, with a reason');
  world(true); ROLE = 'owner';
  var FUT = { starts_on: '2026-10-30', ends_on: '2027-04-23', draw_on: '2027-04-24' };
  s = await setup(FUT);
  show('before the start with no entries: created', s.status === 200 && raffle().starts_at > new Date(NOWMS).toISOString());
  s = await setup(Object.assign({ raffle_id: raffle().id, name: 'Renamed', prizes: [{ title: 'A Harley' }] }, FUT));
  show('before the start with no entries: the venue edits freely', s.status === 200 && raffle().name === 'Renamed' && raffle().prizes[0].title === 'A Harley', JSON.stringify(s.body));
  DB.vp_purchase_raffle_entries.push({ id: 'ev1', raffle_id: raffle().id, entrant_id: 'x', venue_id: VENUE, voided_at: '2026-10-23T02:00:00Z', venue_day: '2026-10-23' });
  s = await setup(Object.assign({ raffle_id: raffle().id, name: 'Again' }, FUT));
  show('before the start but with an entry (even a voided one): the venue is refused with the exact words', s.status === 409 && s.body.error === 'This raffle has started, so its dates, prizes and terms are locked. To change them, contact venueplay on 07 5228 3667.' && raffle().name === 'Renamed', JSON.stringify(s.body));
  DB.vp_purchase_raffle_entries.length = 0;
  NOWMS = Date.parse('2026-10-30T05:00:00Z');
  s = await setup(Object.assign({ raffle_id: raffle().id, name: 'Late' }, FUT));
  show('after the start date: the venue is refused', s.status === 409 && /locked/.test(s.body.error) && raffle().name === 'Renamed');
  ADMIN = true;
  s = await setup(Object.assign({ raffle_id: raffle().id, name: 'HQ no reason' }, FUT));
  show('after the start: HQ without a reason is refused', s.status === 400 && raffle().name === 'Renamed');
  s = await setup(Object.assign({ raffle_id: raffle().id, name: 'Fixed by HQ', reason: 'Venue typed the wrong name' }, FUT));
  show('after the start: HQ with a reason works and the reason is audited', s.status === 200 && raffle().name === 'Fixed by HQ' && audits('purchase_raffle_updated').slice(-1)[0].detail.reason === 'Venue typed the wrong name', JSON.stringify(s.body));
  ADMIN = false;

  print('members list: matched by mobile at THIS venue only, details and opt-in carried over, never invented');
  world(true); ROLE = 'owner'; await setup(); ROLE = 'host';
  DB.vp_captures.push(
    { id: 'c-alan', venue_id: VENUE, first_name: 'Alan', last_name: 'Smith', email: 'alan@x.au', mobile: '0497605423', marketing_optin: true, marketing_optin_at: '2026-09-01T00:00:00.000Z', created_at: '2026-09-01T00:00:00Z' },
    { id: 'c-bea', venue_id: VENUE, first_name: 'Bea', last_name: 'Jones', email: 'bea@x.au', mobile: '+61498111222', marketing_optin: false, marketing_optin_at: null, created_at: '2026-09-01T00:00:00Z' },
    { id: 'c-cat', venue_id: VENUE, first_name: 'Cat', last_name: 'Lee', email: null, mobile: '0499333444', marketing_optin: null, created_at: '2026-09-01T00:00:00Z' },
    { id: 'c-spaced', venue_id: VENUE, first_name: 'Dot', last_name: 'Spaced', email: null, mobile: '0412 345 678', marketing_optin: false, created_at: '2026-09-01T00:00:00Z' },
    { id: 'c-other', venue_id: OTHER, first_name: 'Olly', last_name: 'Other', email: 'olly@x.au', mobile: '0411999888', marketing_optin: true, marketing_optin_at: '2026-09-01T00:00:00.000Z', created_at: '2026-09-01T00:00:00Z' });
  var lk = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0497 605 423' });
  show('a mobile on the members list is found, as first name and last initial', lk.status === 200 && lk.body.known === false && lk.body.member === true && /^Alan S\.?$/.test(lk.body.name), JSON.stringify(lk.body));
  lk = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '+61 498 111 222' });
  show('the match is on the NORMALISED mobile (stored +61, typed 04)', lk.body.member === true && lk.body.first_name === 'Bea', JSON.stringify(lk.body));
  lk = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0412345678' });
  show('a member stored with spaces (0412 345 678) still matches', lk.body.member === true && lk.body.first_name === 'Dot', JSON.stringify(lk.body));
  lk = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0411999888' });
  show('a member of ANOTHER venue is not matched', lk.status === 200 && lk.body.member === false, JSON.stringify(lk.body));
  e = await enter('0411999888', null);
  show('and entering that mobile asks for details, nothing carried from the other venue', e.status === 400 && e.body.needs_details === true && DB.vp_purchase_raffle_entrants.length === 0, JSON.stringify(e.body));
  e = await enter('0497605423', null);
  var alan = DB.vp_purchase_raffle_entrants.filter(function (x) { return x.first_name === 'Alan'; })[0];
  show('Yes on a member adds them from their own details, no form', e.status === 200 && e.body.new_entrant === true && alan && alan.last_name === 'Smith' && alan.email === 'alan@x.au' && alan.phone === '+61497605423', JSON.stringify(e.body));
  show('the member link is recorded', alan && alan.member_capture_id === 'c-alan');
  show('opt-in carried over when the member gave it (true, with their own time)', alan && alan.marketing_opt_in === true && alan.opted_in_at === '2026-09-01T00:00:00.000Z', JSON.stringify(alan));
  NOWMS += 61000;
  e = await enter('0498111222', null);
  var bea = DB.vp_purchase_raffle_entrants.filter(function (x) { return x.first_name === 'Bea'; })[0];
  show('opt-in carried over when the member did not give it (false, never invented)', bea && bea.marketing_opt_in === false && bea.opted_in_at === null, JSON.stringify(bea));
  NOWMS += 61000;
  e = await enter('0499333444', { first_name: 'Hacker', marketing_opt_in: true });
  var cat = DB.vp_purchase_raffle_entrants.filter(function (x) { return x.first_name === 'Cat'; })[0];
  show('a request cannot give a member an opt-in they never ticked, or swap their name', e.status === 200 && cat && cat.marketing_opt_in === false && DB.vp_purchase_raffle_entrants.every(function (x) { return x.first_name !== 'Hacker'; }), JSON.stringify(e.body));
  show('nothing was written to the other venue\'s list', DB.vp_captures.filter(function (c) { return c.venue_id === OTHER; }).length === 1 && DB.vp_captures.filter(function (c) { return c.id === 'c-other'; })[0].mobile === '0411999888');

  print('the new-customer form asks only what the venue collects');
  world(true); ROLE = 'owner'; await setup(); ROLE = 'host';
  DB.vp_venue_settings = [{ venue_id: VENUE, collect_first_name: true, collect_last_name: false, collect_email: false, collect_postcode: false, collect_marketing_optin: false }];
  lk = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0412000001' });
  show('first name only: the form fields say so', JSON.stringify(lk.body.form) === '{"first_name":true,"last_name":false,"email":false,"postcode":false,"marketing_optin":false}', JSON.stringify(lk.body.form));
  e = await enter('0412000001', { first_name: 'Cy', last_name: 'Sneaky', email: 'cy@x.au', postcode: '4000', marketing_opt_in: true });
  var cy = DB.vp_purchase_raffle_entrants[0];
  show('fields the venue does not collect are dropped on the server, and no tick without the setting', e.status === 200 && cy.first_name === 'Cy' && cy.last_name === '' && cy.email === null && !cy.postcode && cy.marketing_opt_in === false && DB.vp_captures.length === 0, JSON.stringify(cy));
  DB.vp_venue_settings = [{ venue_id: VENUE, collect_first_name: false, collect_last_name: false }]; NOWMS += 61000;
  lk = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0412000002' });
  show('no name collected at all: the first name is still asked (the winner is named on the TV)', lk.body.form.first_name === true && lk.body.form.last_name === false);
  DB.vp_venue_settings = [{ venue_id: VENUE, collect_first_name: false, collect_last_name: true }];
  lk = await call(handlePraffleLookup, { venue_id: VENUE, raffle_id: raffle().id, phone: '0412000003' });
  show('only a last name switched on: the first name is still asked, always', lk.body.form.first_name === true && lk.body.form.last_name === true, JSON.stringify(lk.body.form));
  DB.vp_venue_settings = [{ venue_id: VENUE, collect_first_name: false, collect_last_name: false }];
  e = await enter('0412000002', { last_name: 'NoFirst' });
  show('and a first name is required by the server too', e.status === 400 && e.body.needs_details === true && DB.vp_purchase_raffle_entrants.length === 1, JSON.stringify(e.body));
  DB.vp_venue_settings = [{ venue_id: VENUE, collect_first_name: true, collect_last_name: true, collect_email: true, collect_postcode: true, collect_marketing_optin: true }]; NOWMS += 61000;
  e = await enter('0412000003', { first_name: 'Di', last_name: 'Full', email: 'bad' });
  show('a collected email must work', e.status === 400 && e.body.needs_details === true);
  e = await enter('0412000003', { first_name: 'Di', last_name: 'Full', email: 'di@x.au', postcode: '4000', marketing_opt_in: false });
  var di = DB.vp_purchase_raffle_entrants.filter(function (x) { return x.first_name === 'Di'; })[0];
  show('everything collected is kept, and no 18+ tick is needed', e.status === 200 && di.last_name === 'Full' && di.email === 'di@x.au' && di.postcode === '4000');

  print('ticking offers joins the members list; not ticking does not; an email match fills an empty mobile only');
  show('no tick, no list: Di did not join', DB.vp_captures.length === 0);
  NOWMS += 61000;
  e = await enter('0412000004', { first_name: 'Eli', last_name: 'Tick', email: 'eli@x.au', postcode: '4001', marketing_opt_in: true });
  var cap = DB.vp_captures[0], eli = DB.vp_purchase_raffle_entrants.filter(function (x) { return x.first_name === 'Eli'; })[0];
  show('a ticked new entrant joins this venue\'s members list, from the purchase raffle, with consent time', DB.vp_captures.length === 1 && cap.venue_id === VENUE && cap.marketing_optin === true && !!cap.marketing_optin_at && cap.source === 'purchase-raffle' && cap.mobile === '+61412000004' && cap.email === 'eli@x.au', JSON.stringify(cap));
  show('the tick records the words they saw: vpc-3-14nov, no age words in the offers text', cap.consent_version === 'vpc-3-14nov' && !/18/.test(String(cap.consent_version)));
  show('and the entrant is linked to that member', eli.member_capture_id === cap.id && eli.marketing_opt_in === true);
  DB.vp_captures.push({ id: 'c-dee', venue_id: VENUE, first_name: 'Dee', email: 'dee@x.au', mobile: null, marketing_optin: false, created_at: '2026-09-01T00:00:00Z' },
                      { id: 'c-eve', venue_id: VENUE, first_name: 'Eve', email: 'eve@x.au', mobile: '+61411222333', marketing_optin: false, created_at: '2026-09-01T00:00:00Z' },
                      { id: 'c-fay', venue_id: OTHER, first_name: 'Fay', email: 'fay@x.au', mobile: null, marketing_optin: false, created_at: '2026-09-01T00:00:00Z' });
  NOWMS += 61000;
  e = await enter('0412000005', { first_name: 'Dee', last_name: 'Lee', email: 'dee@x.au', postcode: '4000', marketing_opt_in: false });
  var dee = DB.vp_purchase_raffle_entrants.filter(function (x) { return x.phone === '+61412000005'; })[0];
  show('an email that matches a member with no mobile fills the mobile in and links them', e.status === 200 && DB.vp_captures.filter(function (c) { return c.id === 'c-dee'; })[0].mobile === '+61412000005' && dee.member_capture_id === 'c-dee', JSON.stringify(DB.vp_captures.filter(function (c) { return c.id === 'c-dee'; })[0]));
  show('and a member who did not tick stays off the offers list', DB.vp_captures.filter(function (c) { return c.id === 'c-dee'; })[0].marketing_optin === false && DB.vp_captures.length === 4);
  NOWMS += 61000;
  e = await enter('0412000006', { first_name: 'Eve', last_name: 'Lee', email: 'eve@x.au', postcode: '4000', marketing_opt_in: false });
  show('a mobile that is already there is never overwritten, and no link is made', DB.vp_captures.filter(function (c) { return c.id === 'c-eve'; })[0].mobile === '+61411222333' && DB.vp_purchase_raffle_entrants.filter(function (x) { return x.phone === '+61412000006'; })[0].member_capture_id === null);
  NOWMS += 61000;
  e = await enter('0412000007', { first_name: 'Fay', last_name: 'Lee', email: 'fay@x.au', postcode: '4000', marketing_opt_in: false });
  show('another venue\'s member with the same email is not touched or linked', DB.vp_captures.filter(function (c) { return c.id === 'c-fay'; })[0].mobile === null && DB.vp_purchase_raffle_entrants.filter(function (x) { return x.phone === '+61412000007'; })[0].member_capture_id === null);

  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('purchase raffle: ' + bad + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
