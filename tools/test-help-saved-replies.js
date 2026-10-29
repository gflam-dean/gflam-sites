/* SAVED REPLIES AND THE EASIER HELP DESK, run for real (Dean, 29 Oct 2026; migration 126).

   Dean: "helpdesk needs to be easier to use with templates we can use to reply and just all round
   easier to use tbh". This suite runs:

     - the starter replies BUILT INTO the HQ page (venueplay/app/vp-helpdesk-hq.js, loaded here as
       the browser would load it) against the rows migration 126 seeds: one answer, both places
     - the house rules on every one of them: no long dashes, the support line only in a reply for
       venues, the host never the bar, never "roster", only fill-ins the page knows how to fill
     - the page's own fill-in function on real ticket shapes (a venue with its TV address, a player,
       a PartyPlay party), and which replies each kind of ticket is offered
     - the billing Worker's REAL /admin/help/replies/* routes on tools/rig-billing-worker.js: HQ only,
       before the table exists (the page falls back, editing is refused and says why), add, change,
       delete, reorder, and the phone rule on save
     - the Worker's reply route: a fill-in left in or the support line on a player's or PartyPlay
       ticket is refused with no email sent; "Send and close" closes in one step and says so in the
       history; a plain send still leaves the ticket waiting on them
     - the ticket and the list now carry the venue's slug, so {tv_link} is that venue's TV address

   Run from the repo root:  jsc tools/test-help-saved-replies.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; },
  subtle: { digest: function (alg, data) { var b = new Uint8Array(data), out = new Uint8Array(32), h = 2166136261;
    for (var r = 0; r < 32; r++) { for (var i = 0; i < b.length; i++) { h ^= b[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return Promise.resolve(out.buffer); } } };

/* ---------------------------------------------------------------- the page, loaded as a browser would */
var window = { document: { getElementById: function () { return null; }, addEventListener: function () {}, querySelector: function () { return null; } },
               location: { hash: '' }, addEventListener: function () {} };
var setTimeout = function () {};
load('venueplay/app/vp-helpdesk-hq.js');
var P = window.VPHelpdeskReplies || {};
var SEED = P.SEED || [];

/* ---------------------------------------------------------------- the migration's rows, parsed */
var SQL = readFile('venueplay-backend/supabase/venueplay-126-help-saved-replies.sql');
function sqlStrings(s) {   // every E'...' literal, in order, unescaped the way Postgres reads them
  var out = [], re = /E'((?:[^'\\]|\\.)*)'/g, m;
  while ((m = re.exec(s))) out.push(m[1].replace(/\\(.)/g, function (_, c) { return c === 'n' ? '\n' : c; }));
  return out;
}
var ins = SQL.slice(SQL.indexOf('insert into public.vp_help_saved_replies'), SQL.indexOf('on conflict (seed_key) do nothing'));
var lits = sqlStrings(ins), rows = [];
for (var i = 0; i + 3 < lits.length; i += 4) rows.push({ key: lits[i], audience: lits[i + 1], title: lits[i + 2], body: lits[i + 3] });
var positions = (ins.match(/E'[^']*', E'[^']*', (\d+),/g) || []).map(function (x) { return +/(\d+),$/.exec(x)[1]; });

print('THE STARTER REPLIES: THE PAGE AND THE MIGRATION ARE ONE ANSWER');
check('the page carries a starter set of at least 12 saved replies', SEED.length >= 12, SEED.length);
check('the migration seeds exactly the same rows, in the same order, word for word',
      SEED.length > 0 && JSON.stringify(rows) === JSON.stringify(SEED.map(function (r) { return { key: r.key, audience: r.audience, title: r.title, body: r.body }; })),
      rows.length + ' vs ' + SEED.length);
check('the seed places are 10, 20, 30... in that order', positions.length === SEED.length && positions.every(function (p, n) { return p === (n + 1) * 10; }), positions);
check('every seed key is different', SEED.every(function (r, n) { return SEED.filter(function (x) { return x.key === r.key; }).length === 1; }));
['venue', 'player', 'partyplay'].forEach(function (a) {
  check('there are replies for ' + a + ' tickets', SEED.filter(function (r) { return r.audience === a; }).length >= 3);
});
var titles = SEED.map(function (r) { return r.title; }).join(' | ');
['TV not showing the game', "Players can't join", 'How billing works', 'Signing in', 'Refund or cancel request', "We'll call you", 'PartyPlay: lost party code or email', "All sorted, I'll close this"]
  .forEach(function (t) { check('the starter set has "' + t + '"', titles.indexOf(t) !== -1, titles); });

print('THE HOUSE RULES, ON EVERY STARTER REPLY');
var bad = [];
SEED.forEach(function (r) {
  var all = r.title + '\n' + r.body;
  if (/[–—]/.test(all)) bad.push(r.key + ': a long dash');
  if (/roster/i.test(all)) bad.push(r.key + ': roster');
  if (/(claim|collect)[^.]{0,30}\bfrom the bar\b/i.test(all)) bad.push(r.key + ': claim from the bar');
  if (r.title.length > 80 || r.body.length > 4000) bad.push(r.key + ': too long for the table');
  (all.match(/\{[^}]*\}/g) || []).forEach(function (f) { if (['{first_name}', '{venue}', '{ticket_no}', '{tv_link}', '{party_code}'].indexOf(f) === -1) bad.push(r.key + ': unknown fill-in ' + f); });
  if (!/^Hi \{first_name\},\n\n/.test(r.body)) bad.push(r.key + ': does not open "Hi {first_name},"');
  if (!/\n\nCheers,$/.test(r.body)) bad.push(r.key + ': does not end "Cheers," (the signature follows)');
});
check('no long dashes, no "roster", nobody told to claim from the bar, the fill-ins are all known ones, each opens Hi {first_name}, and ends Cheers,', bad.length === 0, bad);
var phoneIn = SEED.filter(function (r) { return P.hasPhone && P.hasPhone(r.body); });
check('the support line is in some venue replies (so the rule below is not checked against nothing)', phoneIn.length >= 2, phoneIn.map(function (r) { return r.key; }));
check('...and ONLY in replies for venues: never a player, never PartyPlay, never "everyone"', phoneIn.every(function (r) { return r.audience === 'venue'; }), phoneIn.map(function (r) { return r.key + ':' + r.audience; }));
check('where it is written, it is written "07 5228 3667"', phoneIn.every(function (r) { return r.body.indexOf('07 5228 3667') !== -1; }));
var prize = SEED.filter(function (r) { return /prize/i.test(r.title); })[0];
check('the prize reply says prizes are claimed from the host, and never mentions the bar (the gate reads any "claim ... bar" as a breach)', !!prize && /claimed from the host/.test(prize.body) && !/\bbar\b/i.test(prize.body), prize && prize.body);
var billing = SEED.filter(function (r) { return r.key === 'venue-billing'; })[0];
check('the billing reply uses the site\'s own words: priced per player on max players per session, $2 an extra player that night, the host OKs it first',
      !!billing && /priced per player/.test(billing.body) && /max players per session/.test(billing.body) && /\$2 for that night/.test(billing.body) && /OK it on screen first/.test(billing.body));
var faq = readFile('venueplay/data/help-faq.json'), site = readFile('venueplay/index.html');
check('...and the site really says those things (so the reply cannot drift from the price page unnoticed)',
      /max players per session/.test(site) && /\$2 per extra player/.test(site) && /each extra player is \$2 for that night/.test(faq));

print('THE MIGRATION');
check('one new table, vp_help_saved_replies, made only if missing', /create table if not exists public\.vp_help_saved_replies \(/.test(SQL));
check('who a reply is for is one of venue, player, partyplay, any', /audience\s+text not null check \(audience in \('venue', 'player', 'partyplay', 'any'\)\)/.test(SQL));
check('locked: RLS on, revoked from public, anon AND authenticated, service role only',
      /alter table public\.vp_help_saved_replies enable row level security;/.test(SQL) && /revoke all on public\.vp_help_saved_replies from public, anon, authenticated;/.test(SQL)
      && /grant select, insert, update, delete on public\.vp_help_saved_replies to service_role;/.test(SQL) && !/create policy/i.test(SQL));
check('safe to run twice: the seed skips a key already there, so HQ\'s own edits are never overwritten', /seed_key\s+text unique/.test(SQL) && /on conflict \(seed_key\) do nothing;/.test(SQL));
check('it says it has NOT been run, and how to roll back', /NOT RUN\./.test(SQL) && /drop table if exists public\.vp_help_saved_replies;/.test(SQL));
var manifest = readFile('venueplay-backend/supabase/MIGRATIONS.md');
check('MIGRATIONS.md records 126', manifest.indexOf('venueplay-126-help-saved-replies.sql') !== -1);

print('THE PAGE FILLS A REPLY FROM THE TICKET');
var tvRow = SEED.filter(function (r) { return r.key === 'venue-tv'; })[0] || { body: '' };
var venueT = { brand: 'venueplay', category: 'venue_support', contact_name: 'Sam Smith', ticket_no: 1042 };
var filled = P.fillReply ? P.fillReply(tvRow.body, venueT, { venue_name: 'The Royal Hotel', venue_slug: 'royal' }) : '';
check('a venue ticket: their first name, the venue, and that venue\'s own TV address', /^Hi Sam,/.test(filled) && filled.indexOf('the TV at The Royal Hotel') !== -1 && filled.indexOf('venueplay.com.au/tv?royal') !== -1, filled.slice(0, 200));
check('...and nothing is left in braces', !/\{[a-z_]+\}/.test(filled));
var noSlug = P.fillReply ? P.fillReply(tvRow.body, { brand: 'venueplay', category: 'venue_support', contact_name: '' }, {}) : '';
check('no name and no known venue: "Hi there", "your venue", and where to find the TV link', /^Hi there,/.test(noSlug) && noSlug.indexOf('the TV at your venue') !== -1 && noSlug.indexOf('(it is on your Account page)') !== -1, noSlug.slice(0, 220));
var pp = SEED.filter(function (r) { return r.key === 'pp-join'; })[0] || { body: '' };
check('a PartyPlay ticket: its party code', (P.fillReply ? P.fillReply(pp.body, { brand: 'partyplay', category: 'venue_support', contact_name: 'Pat', room_code: 'KFP7QX' }, {}) : '').indexOf('type the party code KFP7QX') !== -1);
check('{ticket_no} is the ticket\'s number', (P.fillReply ? P.fillReply('ticket {ticket_no}', venueT, {}) : '') === 'ticket 1042');
check('a fill-in the page does not know is left as it is, for the send check to catch', (P.fillReply ? P.fillReply('{nope}', venueT, {}) : '') === '{nope}');
check('which replies a ticket is offered: a player ticket is a player, PartyPlay is PartyPlay, the rest are venues',
      P.audienceFor && P.audienceFor({ brand: 'venueplay', category: 'patron_support' }) === 'player' && P.audienceFor({ brand: 'partyplay', category: 'venue_support' }) === 'partyplay'
      && P.audienceFor({ brand: 'venueplay', category: 'accounts' }) === 'venue' && P.audienceFor({ brand: 'venueplay', category: 'sales' }) === 'venue');
check('the phone line may go to a venue, a bill or a sale, never a player or PartyPlay (the signature\'s rule)',
      P.phoneOk && P.phoneOk({ brand: 'venueplay', category: 'venue_support' }) && P.phoneOk({ brand: 'venueplay', category: 'sales' }) && !P.phoneOk({ brand: 'venueplay', category: 'patron_support' })
      && !P.phoneOk({ brand: 'partyplay', category: 'accounts' }) && !P.phoneOk({ brand: 'venueplay', category: 'general' }));
check('"Hotel:" is not a phone link; "tel:" and the number written any way are', P.hasPhone && !P.hasPhone('The Royal Hotel: all good') && P.hasPhone('tel:+61752283667') && P.hasPhone('(07) 5228-3667') && P.hasPhone('+61 7 5228 3667'));

/* ---------------------------------------------------------------- the Worker */
function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var ADMIN = U(1), STAFF = U(2), VENUE_OWNER = U(3), VA = U(10);
function hdr(h) { return { get: function (k) { var f = Object.keys(h).filter(function (x) { return x.toLowerCase() === String(k).toLowerCase(); })[0]; return f ? h[f] : ''; } }; }
function req(user, body) { var h = { 'cf-connecting-ip': '203.0.113.9' }; if (user) h.Authorization = 'Bearer ' + user; return { headers: hdr(h), text: function () { return Promise.resolve(JSON.stringify(body || {})); } }; }
async function call(fn, user, body) { try { return await fn(req(user, body), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e && e.stack || e) } }; } }
/* A table that is not there answers the way live PostgREST did on 29 Oct 2026 (read-only check):
   404, code PGRST205. MISSING turns that on for the saved replies table. */
var MISSING = false, _f = globalThis.fetch, URLS = [];
globalThis.fetch = function (url, opts) {
  URLS.push(String(url));
  if (MISSING && /\/rest\/v1\/vp_help_saved_replies/.test(String(url))) {
    var b = { code: 'PGRST205', message: "Could not find the table 'public.vp_help_saved_replies' in the schema cache" };
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve(b); }, text: function () { return Promise.resolve(JSON.stringify(b)); } });
  }
  return _f(url, opts);
};
var clock = Date.parse('2026-10-29T00:00:00Z');
helpNow = function () { clock += 1000; return new Date(clock).toISOString(); };
function world() {
  DB = {}; sent.length = 0; FAIL = {}; MISSING = false;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, role: 'owner', label: 'Dean' }, { auth_user_id: STAFF, role: 'staff', label: 'Support Sue' }];
  DB.vp_venues = [{ id: VA, name: 'The Royal Hotel', slug: 'royal', status: 'active' }];
  DB.vp_venue_staff = [{ auth_user_id: VENUE_OWNER, venue_id: VA, role: 'owner' }];
  DB.vp_help_ticket_notes = [];
  DB.vp_help_tickets = [
    { id: U(101), ticket_no: 1001, brand: 'venueplay', category: 'venue_support', channel: 'venue_form', status: 'open', priority: 'normal', venue_id: VA, subject: 'TV blank', contact_name: 'Sam', contact_email: 'sam@royal.example', reply_token: 'abcdefghijklmnop', created_at: '2026-10-28T09:00:00Z' },
    { id: U(102), ticket_no: 1002, brand: 'venueplay', category: 'patron_support', channel: 'patron_form', status: 'new', priority: 'normal', venue_id: VA, subject: 'Cannot join', contact_name: 'Jo', contact_email: 'jo@example.com', reply_token: 'bcdefghijklmnopq', created_at: '2026-10-28T10:00:00Z' },
    { id: U(103), ticket_no: 1003, brand: 'partyplay', category: 'venue_support', channel: 'patron_form', status: 'open', priority: 'normal', room_code: 'KFP7QX', subject: 'Lost my code', contact_name: 'Pat', contact_email: 'pat@example.com', reply_token: 'cdefghijklmnopqr', created_at: '2026-10-28T11:00:00Z' }];
}
function T(no) { return DB.vp_help_tickets.filter(function (t) { return t.ticket_no === no; })[0]; }
function notesOf(no) { var t = T(no); return DB.vp_help_ticket_notes.filter(function (n) { return n.ticket_id === t.id; }); }
function stored() { return (DB.vp_help_saved_replies || []).slice().sort(function (a, b) { return a.position - b.position; }); }

(async function () {
  print('THE SAVED REPLIES ROUTES ARE HQ ONLY');
  world();
  DB.vp_help_saved_replies = [{ id: U(201), audience: 'venue', title: 'A', body: 'Hi', position: 10 }];
  var who = [[null, 401, 'nobody signed in'], [VENUE_OWNER, 403, 'a venue owner']];
  for (var w = 0; w < who.length; w++) {
    var codes = [];
    codes.push((await call(helpAdminRepliesList, who[w][0], {})).status);
    codes.push((await call(helpAdminRepliesSave, who[w][0], { title: 'X', audience: 'any', body: 'Y' })).status);
    codes.push((await call(helpAdminRepliesDelete, who[w][0], { id: U(201) })).status);
    codes.push((await call(helpAdminRepliesMove, who[w][0], { id: U(201), dir: 'down' })).status);
    check(who[w][2] + ' is refused list, save, delete and move (' + who[w][1] + ')', codes.every(function (c) { return c === who[w][1]; }), codes);
  }
  check('...and nothing was changed by them', stored().length === 1 && stored()[0].title === 'A');
  var sl = await call(helpAdminRepliesList, STAFF, {});
  check('HQ staff (the support role) can read them', sl.status === 200 && sl.body.replies.length === 1 && sl.body.missing === false, sl.body);

  print('BEFORE MIGRATION 126: THE PAGE FALLS BACK, NOTHING IS HALF-WRITTEN');
  world(); MISSING = true;
  var l0 = await call(helpAdminRepliesList, ADMIN, {});
  check('the list answers 200 with missing: true and no rows (the page then uses its built-in starter set)', l0.status === 200 && l0.body.missing === true && l0.body.replies.length === 0, l0);
  var s0 = await call(helpAdminRepliesSave, ADMIN, { title: 'New', audience: 'any', body: 'Hi {first_name},' });
  check('saving says the migration has to run first, and flags it missing', s0.status === 409 && s0.body.missing === true && /migration 126/.test(s0.body.error), s0);
  var d0 = await call(helpAdminRepliesDelete, ADMIN, { id: U(201) }), m0 = await call(helpAdminRepliesMove, ADMIN, { id: U(201), dir: 'up' });
  check('so do delete and move', d0.status === 409 && m0.status === 409, [d0.status, m0.status]);
  MISSING = false; FAIL['vp_help_saved_replies:GET'] = 1;
  var l1 = await call(helpAdminRepliesList, ADMIN, {});
  check('a database fault is NOT read as "no table": it is an error, not an empty list', l1.status !== 200 || !!(l1.body && l1.body.error), l1);

  print('ADD, CHANGE, DELETE, REORDER');
  world(); DB.vp_help_saved_replies = [];
  var a1 = await call(helpAdminRepliesSave, ADMIN, { title: 'First', audience: 'venue', body: 'Hi {first_name},\n\nOne.\n\nCheers,' });
  var a2 = await call(helpAdminRepliesSave, STAFF, { title: 'Second', audience: 'player', body: 'Two' });
  var a3 = await call(helpAdminRepliesSave, ADMIN, { title: 'Third', audience: 'any', body: 'Three' });
  check('three added, each at the end of the list, with who saved it', a1.status === 200 && a2.status === 200 && a3.status === 200
        && JSON.stringify(stored().map(function (r) { return [r.title, r.position, r.updated_by]; })) === JSON.stringify([['First', 10, 'Dean'], ['Second', 20, 'Support Sue'], ['Third', 30, 'Dean']]), stored());
  check('the words keep their line breaks', stored()[0].body === 'Hi {first_name},\n\nOne.\n\nCheers,');
  var e1 = await call(helpAdminRepliesSave, ADMIN, { id: a2.body.id, title: 'Second, changed', audience: 'any', body: 'Two, changed' });
  var r2 = stored().filter(function (r) { return r.id === a2.body.id; })[0];
  check('a change is saved to that reply only', e1.status === 200 && r2.title === 'Second, changed' && r2.audience === 'any' && r2.body === 'Two, changed' && stored().length === 3, r2);
  var mv = await call(helpAdminRepliesMove, ADMIN, { id: a3.body.id, dir: 'up' });
  check('Third moves up one: First, Third, Second, renumbered 10, 20, 30', mv.status === 200
        && JSON.stringify(stored().map(function (r) { return [r.title, r.position]; })) === JSON.stringify([['First', 10], ['Third', 20], ['Second, changed', 30]]), stored().map(function (r) { return [r.title, r.position]; }));
  var mv2 = await call(helpAdminRepliesMove, ADMIN, { id: a1.body.id, dir: 'up' });
  check('the top one cannot go higher: nothing changes', mv2.status === 200 && mv2.body.unchanged === true && stored()[0].title === 'First');
  var mv3 = await call(helpAdminRepliesMove, ADMIN, { id: a1.body.id, dir: 'down' });
  check('First moves down: Third, First, Second', mv3.status === 200 && stored().map(function (r) { return r.title; }).join() === 'Third,First,Second, changed');
  var del = await call(helpAdminRepliesDelete, ADMIN, { id: a1.body.id });
  check('delete removes that one and only that one', del.status === 200 && stored().map(function (r) { return r.title; }).join() === 'Third,Second, changed');
  var del2 = await call(helpAdminRepliesDelete, ADMIN, { id: a1.body.id });
  check('deleting it again says it is not there', del2.status === 404);
  var gone = await call(helpAdminRepliesSave, ADMIN, { id: a1.body.id, title: 'x', audience: 'any', body: 'y' });
  check('changing a deleted one says it is not there, and adds nothing', gone.status === 404 && stored().length === 2);

  print('WHAT A SAVED REPLY MAY SAY');
  world(); DB.vp_help_saved_replies = [];
  var bads = [
    [{ title: '', audience: 'any', body: 'x' }, 'no name'],
    [{ title: 'x', audience: 'any', body: '   ' }, 'no words'],
    [{ title: 'x', audience: 'staff', body: 'y' }, 'an audience that is not one of the four'],
    [{ title: new Array(82).join('a'), audience: 'any', body: 'y' }, 'a name over 80 letters'],
    [{ title: 'x', audience: 'player', body: 'Call us on 07 5228 3667.' }, 'the support line in a reply for players'],
    [{ title: 'x', audience: 'partyplay', body: 'Ring (07) 5228-3667' }, 'the support line, written another way, in a PartyPlay reply'],
    [{ title: 'x', audience: 'any', body: '<a href="tel:+61752283667">us</a>' }, 'a tel: link in a reply for everyone']];
  for (var k = 0; k < bads.length; k++) {
    var rb = await call(helpAdminRepliesSave, ADMIN, bads[k][0]);
    check('refused: ' + bads[k][1], rb.status === 400 && !!rb.body.error, rb);
  }
  check('...and none of them was stored', stored().length === 0, stored());
  var okv = await call(helpAdminRepliesSave, ADMIN, { title: 'Call us', audience: 'venue', body: 'Call 07 5228 3667 and press 2.' });
  check('the support line IS allowed in a reply for venues', okv.status === 200 && stored().length === 1, okv);

  print('SENDING: A FILL-IN LEFT IN, AND THE SUPPORT LINE');
  world();
  var r1 = await call(helpAdminReply, ADMIN, { id: U(101), body: 'Hi Sam, open {tv_link} on the TV.' });
  check('a reply with a fill-in still in braces is refused, naming it, and no email goes', r1.status === 400 && /\{tv_link\}/.test(r1.body.error) && sent.length === 0, r1);
  var r2b = await call(helpAdminReply, ADMIN, { id: U(102), body: 'Hi Jo, call us on 07 5228 3667.' });
  check('the support line on a PLAYER\'s ticket is refused, and no email goes', r2b.status === 400 && /venues only/.test(r2b.body.error) && sent.length === 0, r2b);
  var r3 = await call(helpAdminReply, ADMIN, { id: U(103), body: 'Hi Pat, ring +61 7 5228 3667' });
  check('the support line on a PARTYPLAY ticket is refused, and no email goes', r3.status === 400 && sent.length === 0, r3);
  check('...and those tickets are as they were (no status change, no history line)', T(1001).status === 'open' && T(1002).status === 'new' && T(1003).status === 'open' && DB.vp_help_ticket_notes.length === 0);
  var r4 = await call(helpAdminReply, ADMIN, { id: U(102), body: 'Hi Jo, the Royal Hotel: try reloading. Cheers,' });
  check('a player reply without the number goes ("Hotel:" is not a phone link)', r4.status === 200 && sent.length === 1 && String(sent[0].to) === 'jo@example.com', r4);
  var r5 = await call(helpAdminReply, ADMIN, { id: U(101), body: 'Hi Sam, call us on 07 5228 3667 and press 2.\n\nCheers,' });
  check('a venue reply WITH the number goes', r5.status === 200 && sent.length === 2 && sent[1].html.indexOf('07 5228 3667') !== -1, r5);

  print('SEND AND CLOSE');
  world();
  var c1 = await call(helpAdminReply, ADMIN, { id: U(101), body: 'All sorted. Cheers,', close: true });
  var n1 = notesOf(1001);
  check('"Send and close": the email goes, and the ticket is closed with the time it closed', c1.status === 200 && c1.body.status === 'closed' && sent.length === 1 && T(1001).status === 'closed' && !!T(1001).closed_at, [c1, T(1001)]);
  check('the history has the reply, then a line saying it was sent and closed, by who', n1.length === 2 && n1[0].kind === 'reply' && n1[1].kind === 'change' && /open to closed \(sent and closed\)/.test(n1[1].body) && n1[1].author === 'Dean', n1);
  var c2 = await call(helpAdminReply, ADMIN, { id: U(102), body: 'Thanks Jo. Cheers,' });
  check('a plain Send still leaves it waiting on them, not closed', c2.status === 200 && c2.body.status === 'waiting' && T(1002).status === 'waiting' && !T(1002).closed_at, c2);
  var c3 = await call(helpAdminReply, ADMIN, { id: U(103), body: 'Hi', close: 'yes' });
  check('only close: true closes ("yes" does not)', c3.status === 200 && T(1003).status === 'waiting', T(1003));

  print('THE VENUE\'S TV ADDRESS REACHES THE PAGE');
  world();
  var g = await call(helpAdminGet, ADMIN, { id: U(101) });
  check('opening a venue\'s ticket gives its name and its slug', g.status === 200 && g.body.venue_name === 'The Royal Hotel' && g.body.venue_slug === 'royal', g.body && { n: g.body.venue_name, s: g.body.venue_slug });
  var g2 = await call(helpAdminGet, ADMIN, { id: U(103) });
  check('a PartyPlay ticket has no venue: both empty', g2.status === 200 && g2.body.venue_name === '' && g2.body.venue_slug === '');
  URLS.length = 0;
  var li = await call(helpAdminList, ADMIN, { with_venues: true });
  check('the list\'s venue picker carries each venue\'s slug', li.status === 200 && li.body.all_venues && li.body.all_venues[0].slug === 'royal', li.body && li.body.all_venues);
  /* The rig's fake database hands back whole rows whatever select= asks for, so the line above
     cannot see a dropped column. This one reads what the Worker really asked PostgREST for. */
  var pick = URLS.filter(function (u) { return /\/rest\/v1\/vp_venues\?/.test(u) && /order=name\.asc/.test(u); });
  check('...because the Worker really asks the database for slug in the picker\'s select', pick.length > 0 && pick.every(function (u) { var m = decodeURIComponent(u).match(/select=([^&]*)/); return !!m && m[1].split(',').indexOf('slug') !== -1; }), pick);
  check('the list answers every status when none is asked for (the page counts each chip itself)', li.body.tickets.length === 3);

  print(fails ? (ran - fails) + ' of ' + ran + ' checks passed' : 'ALL ' + ran + ' CHECKS PASSED');
})();
