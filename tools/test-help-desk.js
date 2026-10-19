/* THE HELP DESK, run for real (migration 106, 19 Oct 2026).

   Dean: a Help link and a contact form on the phone, a Help form for venues, the website enquiry
   form, email in, phone calls logged by category, a report. VenuePlay AND PartyPlay. And then the
   rule that matters most: TICKETS ARE FOR DEAN'S STAFF ONLY. A venue, a host, a PartyPlay host, a
   patron or a guest can submit and can never read a ticket, a list or a count back.

   Runs the REAL routes of venueplay-api-FULL.js on tools/rig-billing-worker.js (a fake PostgREST
   that honours offset and limit, a fake Resend that records every email). Only three things are
   stood in for: the token check (a token here IS the user id), WebCrypto (jsc has none; the real
   VAPID signature is checked in a real browser by tools/help-desk-pages.test.py), and the push
   services, which record what they were sent.

   Run from the repo root:  jsc tools/test-help-desk.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

/* jsc has no WebCrypto. A digest that is a real function of its input (so a wrong token is a
   wrong hash), random bytes, and an ECDSA that just has to hand back 64 bytes. */
var __rnd = 7;
var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { __rnd = (__rnd * 1103515245 + 12345) >>> 0; a[i] = __rnd & 255; } return a; },
  subtle: { digest: function (alg, data) { var b = new Uint8Array(data), out = new Uint8Array(32), h = 2166136261;
      for (var r = 0; r < 32; r++) { for (var i = 0; i < b.length; i++) { h ^= b[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return Promise.resolve(out.buffer); },
    importKey: function () { return Promise.resolve({ fake: true }); },
    sign: function () { return Promise.resolve(new Uint8Array(64).buffer); } } };
/* jsc has no URL either; the Worker's fetch handler only needs the path and the query. */
var URL = function (u) { var m = /^(https?:\/\/[^\/?#]+)([^?#]*)(\?[^#]*)?/.exec(String(u)); this.origin = m[1]; this.pathname = m[2] || '/'; var q = (m[3] || '').slice(1);
  this.searchParams = { get: function (k) { var hit = q.split('&').map(function (kv) { return kv.split('='); }).filter(function (kv) { return decodeURIComponent(kv[0]) === k; })[0]; return hit ? decodeURIComponent(hit[1] || '') : null; } }; };
var Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };

/* The fake database knows nothing of identity columns: number tickets the way Postgres would. */
var nextNo = 1001, pushes = [], PUSH_STATUS = 201;
var realFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  url = String(url); opts = opts || {};
  if (/^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com|evil\.example)\//.test(url)) {
    pushes.push({ url: url, body: opts.body, headers: opts.headers || {} });
    return Promise.resolve({ ok: PUSH_STATUS < 300, status: PUSH_STATUS, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve(''); } });
  }
  if (/\/rest\/v1\/vp_help_tickets/.test(url) && (opts.method || 'GET') === 'POST') {
    var o = JSON.parse(opts.body); o.ticket_no = nextNo++; o.created_at = o.created_at || NOW(); o.updated_at = o.created_at;
    opts = Object.assign({}, opts, { body: JSON.stringify(o) });
  }
  return realFetch(url, opts);
};
var clock = Date.parse('2026-10-19T00:00:00Z');
function NOW() { clock += 1000; return new Date(clock).toISOString(); }
/* ONE CLOCK FOR THE WHOLE SUITE. The Worker stamps updated_at, closed_at and the push cursor with
   helpNow(); the fake database stamps tickets with NOW(). Left on the real clock, the push checks
   passed in the morning and failed by afternoon (a ticket "older" than the phone that asked).
   Fixed time, never the machine's (CLAUDE.md: never derive a fixture from the current clock). */
helpNow = function () { return NOW(); };

function U(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OWNER_A = U(1), HOST_A = U(2), MKT_A = U(3), OWNER_B = U(4), ADMIN = U(9), STAFF_ADMIN = U(10), NOBODY = U(11);
var VA = U(101), VB = U(102);
function hdr(h) { return { get: function (k) { var f = Object.keys(h).filter(function (x) { return x.toLowerCase() === String(k).toLowerCase(); })[0]; return f ? h[f] : ''; } }; }
function req(user, body, extra) { var h = Object.assign({ 'cf-connecting-ip': '203.0.113.' + (extra && extra.ip || 1) }, extra && extra.headers || {}); if (user) h.Authorization = 'Bearer ' + user;
  return { headers: hdr(h), text: function () { return Promise.resolve(JSON.stringify(body || {})); } }; }
async function call(fn, user, body, extra) { try { return await fn(req(user, body, extra), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e && e.stack || e) } }; } }

/* The rate limiter lives inside the Worker (a const the test cannot reach), so each scenario moves
   the clock on three hours: every window has expired, the way it would for real. */
var __realNow = Date.now, __shift = 0;
Date.now = function () { return __realNow() + __shift; };
function world() {
  __shift += 3 * 3600 * 1000;
  DB = {}; sent.length = 0; FAIL = {}; pushes.length = 0; PUSH_STATUS = 201; nextNo = 1001;
  DB.venueplay_founding = [{ id: 'fA', contact_email: 'owner@royalhotel.com.au', status: 'card_on_file' }, { id: 'fB', contact_email: 'boss@anchor.com.au', status: 'card_on_file' }];
  DB.vp_venues = [{ id: VA, name: 'The Royal Hotel', founding_id: 'fA', slug: 'royal', join_code: 'RYL234', status: 'active', created_at: '2026-01-01T00:00:00Z' },
                  { id: VB, name: 'The Anchor', founding_id: 'fB', slug: 'anchor', join_code: 'ANC567', status: 'active', created_at: '2026-01-02T00:00:00Z' }];
  DB.vp_sessions = [{ id: U(201), venue_id: VA, join_code: 'RYL234', status: 'running' }];
  DB.vp_venue_staff = [{ auth_user_id: OWNER_A, venue_id: VA, role: 'owner', display_name: 'Sam' }, { auth_user_id: HOST_A, venue_id: VA, role: 'host', display_name: 'Hayley' },
                       { auth_user_id: MKT_A, venue_id: VA, role: 'marketing' }, { auth_user_id: OWNER_B, venue_id: VB, role: 'owner', display_name: 'Bea' }];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, role: 'owner', label: 'Dean' }, { auth_user_id: STAFF_ADMIN, role: 'staff', label: 'Support Sue' }];
  DB.auth = [{ id: HOST_A, phone: '61400000002' }];
  DB.vp_help_tickets = []; DB.vp_help_ticket_notes = []; DB.vp_help_push_subs = [];
}
function T(no) { return DB.vp_help_tickets.filter(function (t) { return t.ticket_no === no; })[0]; }
function notesOf(t) { return DB.vp_help_ticket_notes.filter(function (n) { return n.ticket_id === t.id; }); }
var PATRON = { brand: 'venueplay', kind: 'patron', name: 'Jo', email: 'Jo@Example.com', message: 'My tickets are not showing', code: 'RYL234', game: 'bingo', device: 'dev-1' };

(async function () {
  print('A PATRON ON A PHONE');
  world();
  var r = await call(helpPublicTicket, null, PATRON);
  var t = r.body && T(r.body.ticket_no);
  check('a patron gets a ticket number back', r.status === 200 && r.body.ticket_no === 1001, r);
  check('and nothing else: no ticket data comes back to a patron', Object.keys(r.body).sort().join() === 'ok,ticket_no', Object.keys(r.body));
  check('it is player support, from the patron form, VenuePlay', t && t.brand === 'venueplay' && t.category === 'patron_support' && t.channel === 'patron_form' && t.status === 'new', t);
  check('the venue, the room code and the live session are attached from the code on the phone', t && t.venue_id === VA && t.room_code === 'RYL234' && t.session_id === U(201), t);
  check('the email is kept in lower case for the reply', t && t.contact_email === 'jo@example.com', t && t.contact_email);
  var alert = sent.filter(function (m) { return /HELP|\[VenuePlay\]/.test(m.subject); })[0];
  check('staff are emailed, subject starting [VenuePlay], the kind and the number', alert && /^\[VenuePlay\] Player support \[#1001\]/.test(alert.subject), alert && alert.subject);
  check('the alert goes to the staff address, never to the patron', alert && alert.to.join() === 'hello@venueplay.com.au', alert && alert.to);
  check('the alert carries the header that stops it coming back in as a ticket', alert && alert.headers && alert.headers['X-VP-Help'] === 'alert');
  check('nothing at all is emailed to the address the patron typed', sent.every(function (m) { return m.to.indexOf('jo@example.com') === -1; }));

  print('A FORM A PERSON CANNOT SEE');
  world();
  r = await call(helpPublicTicket, null, Object.assign({}, PATRON, { website: 'http://spam' }));
  check('the honeypot is told it worked and nothing is made', r.status === 200 && DB.vp_help_tickets.length === 0 && sent.length === 0, r);
  check('no email, no ticket', (await call(helpPublicTicket, null, Object.assign({}, PATRON, { email: '' }))).status === 400 && DB.vp_help_tickets.length === 0);
  check('a bad email, no ticket', (await call(helpPublicTicket, null, Object.assign({}, PATRON, { email: 'jo@nowhere' }))).status === 400);
  check('a message over 4,000 characters is refused', (await call(helpPublicTicket, null, Object.assign({}, PATRON, { message: new Array(4002).join('x') }))).status === 400);
  check('a message of exactly 4,000 is taken', (await call(helpPublicTicket, null, Object.assign({}, PATRON, { message: new Array(4001).join('y') }))).status === 200);
  check('a VenuePlay host cannot use the public form: they are signed in, so they use the console', (await call(helpPublicTicket, null, Object.assign({}, PATRON, { kind: 'host' }))).status === 400);
  r = await call(helpPublicTicket, null, Object.assign({}, PATRON, { code: 'ZZZ999', slug: 'anchor', device: 'dev-x', email: 'x@example.com' }));
  check('an unknown code still makes the ticket, matched by the venue slug instead', r.status === 200 && T(r.body.ticket_no).venue_id === VB, r.body);
  r = await call(helpPublicTicket, null, Object.assign({}, PATRON, { code: 'ZZZ999', slug: '', device: 'dev-y', email: 'y@example.com' }));
  check('and with nothing to match it is still made, with the code the patron saw', r.status === 200 && T(r.body.ticket_no).venue_id === null && T(r.body.ticket_no).room_code === 'ZZZ999', r.body);

  print('RATE LIMITS');
  world();
  var codes = [];
  for (var i = 0; i < 4; i++) codes.push((await call(helpPublicTicket, null, Object.assign({}, PATRON, { email: 'd' + i + '@example.com' }))).status);
  check('one device: three in ten minutes, the fourth is refused', codes.join() === '200,200,200,429', codes);
  world(); codes = [];
  for (i = 0; i < 6; i++) codes.push((await call(helpPublicTicket, null, Object.assign({}, PATRON, { device: 'e' + i }))).status);
  check('one email address: five an hour, the sixth is refused', codes.join() === '200,200,200,200,200,429', codes);
  world(); codes = [];
  for (i = 0; i < 21; i++) codes.push((await call(helpPublicTicket, null, Object.assign({}, PATRON, { device: 'n' + i, email: 'n' + i + '@example.com' }))).status);
  check('one network: twenty an hour (a pub wifi is one address), the twenty-first is refused', codes.slice(0, 20).every(function (c) { return c === 200; }) && codes[20] === 429, codes.slice(18));
  var other = await call(helpPublicTicket, null, Object.assign({}, PATRON, { device: 'z', email: 'z@example.com' }), { ip: 2 });
  check('a different network is not caught by it', other.status === 200, other);
  check('refused requests made no tickets', DB.vp_help_tickets.length === 21, DB.vp_help_tickets.length);

  print('PARTYPLAY: A GUEST, A HOST, A SALES ENQUIRY');
  world();
  r = await call(helpPublicTicket, null, { brand: 'partyplay', kind: 'patron', email: 'guest@example.com', message: 'Cannot join', code: 'kfp7qx', device: 'g1' });
  t = T(r.body.ticket_no);
  check('a PartyPlay guest makes a PartyPlay guest-support ticket with the party code', t && t.brand === 'partyplay' && t.category === 'patron_support' && t.room_code === 'KFP7QX' && t.venue_id === null, t);
  check('its alert says [PartyPlay] Guest support', sent.some(function (m) { return /^\[PartyPlay\] Guest support \[#1001\]/.test(m.subject); }), sent.map(function (m) { return m.subject; }));
  r = await call(helpPublicTicket, null, { brand: 'partyplay', kind: 'host', email: 'host@example.com', message: 'The TV is blank', code: 'KFP7QX', device: 'h1' });
  t = T(r.body.ticket_no);
  check('a PartyPlay host makes host support (venue_support underneath), PartyPlay', t && t.brand === 'partyplay' && t.category === 'venue_support' && t.channel === 'patron_form', t);
  check('and its alert says Host support, not venue', sent.some(function (m) { return /^\[PartyPlay\] Host support/.test(m.subject); }));
  r = await call(helpPublicTicket, null, { brand: 'partyplay', kind: 'sales', name: 'Pat', email: 'pat@example.com', phone: '0400 111 222', message: 'Can I book for 60?', device: 's1' });
  t = T(r.body.ticket_no);
  check('the PartyPlay site form makes a PartyPlay sales ticket from the web form', t && t.brand === 'partyplay' && t.category === 'sales' && t.channel === 'web_form' && t.contact_phone === '0400 111 222', t);

  print('THE VENUEPLAY WEBSITE ENQUIRY FORM (/contact)');
  world();
  r = await call(handleContact, null, { name: 'Lee', email: 'lee@pub.com.au', phone: '0400000000', message: 'Pricing for 3 venues?' });
  t = DB.vp_help_tickets[0];
  check('an enquiry is now a VenuePlay sales ticket from the web form', r.status === 200 && t && t.category === 'sales' && t.channel === 'web_form' && t.brand === 'venueplay', t);
  check('the enquiry email still goes to Dean, with the ticket number in its subject', sent.length === 1 && /\[#1001\]/.test(sent[0].subject) && sent[0].to.indexOf('dean@venueplay.com.au') !== -1, sent.map(function (m) { return m.subject; }));
  world(); FAIL['vp_help_tickets:POST'] = 1;
  r = await call(handleContact, null, { name: 'Lee', email: 'lee@pub.com.au', message: 'Before the migration' });
  check('before the migration is run (no table), the enquiry still goes out exactly as before', r.status === 200 && sent.length === 1 && DB.vp_help_tickets.length === 0, r);

  print('A VENUE LOGIN, FROM THE CONSOLE');
  world();
  r = await call(helpVenueTicket, HOST_A, { venue_id: VA, subject: 'TV not showing', message: 'Blank since 7pm', urgent: true });
  t = DB.vp_help_tickets[0];
  check('a host at the venue can raise one', r.status === 200 && t && t.venue_id === VA && t.channel === 'venue_form' && t.category === 'venue_support' && t.brand === 'venueplay', r);
  check('it answers with the number and nothing else (not even the account email it will reply to)', Object.keys(r.body).sort().join() === 'ok,ticket_no', r.body);
  check('urgent is kept, and the alert subject says URGENT', t.priority === 'urgent' && sent.some(function (m) { return /^\[VenuePlay\] URGENT Venue support/.test(m.subject); }), sent.map(function (m) { return m.subject; }));
  check('the reply goes to the account contact email; the host\'s mobile is attached', t.contact_email === 'owner@royalhotel.com.au' && t.contact_phone === '+61400000002' && t.contact_name === 'Hayley', t);
  r = await call(helpVenueTicket, OWNER_A, { venue_id: VA, subject: 'Invoice', message: 'Wrong amount', category: 'accounts', reply_email: 'books@royalhotel.com.au' });
  check('an owner can raise an accounts one, to a reply address they choose', r.status === 200 && T(r.body.ticket_no).category === 'accounts' && T(r.body.ticket_no).contact_email === 'books@royalhotel.com.au');
  check('venue A\'s owner cannot raise one in venue B\'s name', (await call(helpVenueTicket, OWNER_A, { venue_id: VB, subject: 'x', message: 'y' })).status === 403);
  check('no login, no venue ticket', (await call(helpVenueTicket, null, { venue_id: VA, subject: 'x', message: 'y' })).status === 401);
  check('a login that is nobody\'s staff is refused', (await call(helpVenueTicket, NOBODY, { venue_id: VA, subject: 'x', message: 'y' })).status === 403);

  print('NOBODY BUT HQ READS A TICKET (Dean, 19 Oct: tickets are for staff only)');
  world();
  await call(helpPublicTicket, null, PATRON);
  await call(helpVenueTicket, OWNER_A, { venue_id: VA, subject: 'A secret', message: 'venue A only' });
  await call(helpVenueTicket, OWNER_B, { venue_id: VB, subject: 'B secret', message: 'venue B only' });
  await call(helpPublicTicket, null, { brand: 'partyplay', kind: 'host', email: 'pphost@example.com', message: 'pp secret', code: 'KFP7QX', device: 'pp' });
  var someId = DB.vp_help_tickets[0].id;
  var READERS = { helpAdminList: helpAdminList, helpAdminCount: helpAdminCount, helpAdminGet: helpAdminGet, helpAdminUpdate: helpAdminUpdate,
    helpAdminNote: helpAdminNote, helpAdminReply: helpAdminReply, helpAdminLogCall: helpAdminLogCall, helpAdminReport: helpAdminReport,
    helpAdminPushKey: helpAdminPushKey, helpAdminPushSubscribe: helpAdminPushSubscribe, helpAdminPushUnsubscribe: helpAdminPushUnsubscribe };
  var WHO = { 'no login at all': null, 'venue A owner': OWNER_A, 'venue A host': HOST_A, 'venue A marketing login': MKT_A, 'venue B owner': OWNER_B, 'a login that is nobody\'s staff': NOBODY };
  var leaks = [];
  var before = JSON.stringify(DB.vp_help_tickets);
  for (var who in WHO) for (var name in READERS) {
    var res = await call(READERS[name], WHO[who], { id: someId, ticket_no: 1001, status: 'closed', body: 'x', category: 'sales', brand: 'venueplay', subject: 's', from: '2026-01-01', to: '2027-01-01', endpoint: 'https://fcm.googleapis.com/x' });
    var txt = JSON.stringify(res.body || {});
    if (!(res.status === 401 || res.status === 403) || /secret|jo@example|ticket_no|tickets/.test(txt)) leaks.push(who + ' > ' + name + ' ' + res.status);
  }
  check('every HQ route refuses anon, venue owners, hosts, marketing and strangers, and shows them nothing', leaks.length === 0, leaks);
  check('and none of those attempts changed a ticket', JSON.stringify(DB.vp_help_tickets) === before);
  var pubKeys = [];
  [await call(helpPublicTicket, null, Object.assign({}, PATRON, { device: 'k1', email: 'k1@example.com' })),
   await call(helpPublicTicket, null, { brand: 'partyplay', kind: 'host', email: 'k2@example.com', message: 'm', code: 'KFP7QX', device: 'k2' }),
   await call(helpVenueTicket, OWNER_A, { venue_id: VA, subject: 's', message: 'm' })].forEach(function (x) { pubKeys.push(Object.keys(x.body).sort().join()); });
  check('every submit route (patron, PartyPlay host, venue) answers only ok and a number', pubKeys.every(function (k) { return k === 'ok,ticket_no'; }), pubKeys);
  check('there is no route that lists tickets for a venue (the earlier "my requests" route is gone)', typeof helpVenueMine === 'undefined');
  var routes = readFile('venueplay-backend/worker/venueplay-api-FULL.js').match(/path === '\/[a-z\/-]*help[a-z\/-]*'/g) || [];
  var publicHelp = routes.filter(function (p) { return !/'\/admin\/help\//.test(p); }).map(function (p) { return p.replace(/path === /, ''); }).sort().join();
  check('the only non-HQ help routes: submit (ticket, venue ticket, triage answer), the help words, and the phone peek', publicHelp === "'/help/content','/help/push/peek','/help/ticket','/help/triage','/help/venue/ticket'", publicHelp);

  print('HQ: THE DESK');
  world();
  await call(helpPublicTicket, null, PATRON);                                                         // 1001 VP patron
  await call(helpVenueTicket, OWNER_A, { venue_id: VA, subject: 'Billing', message: 'Charged twice', category: 'accounts' });   // 1002
  await call(helpPublicTicket, null, { brand: 'partyplay', kind: 'patron', email: 'g@example.com', message: 'hi', code: 'KFP7QX', device: 'g' }); // 1003
  var L = await call(helpAdminList, STAFF_ADMIN, { status: 'not_closed' });
  check('a Gflam staff admin (the support role) can read the desk', L.status === 200 && L.body.tickets.length === 3, L.status);
  check('the list names each venue', L.body.venues && L.body.venues[VA] === 'The Royal Hotel');
  check('filter by brand', (await call(helpAdminList, ADMIN, { brand: 'partyplay' })).body.tickets.map(function (x) { return x.ticket_no; }).join() === '1003');
  check('filter by category', (await call(helpAdminList, ADMIN, { category: 'accounts' })).body.tickets.map(function (x) { return x.ticket_no; }).join() === '1002');
  check('filter by channel', (await call(helpAdminList, ADMIN, { channel: 'venue_form' })).body.tickets.length === 1);
  check('filter by venue', (await call(helpAdminList, ADMIN, { venue_id: VA })).body.tickets.length === 2);
  check('filter by dates outside every ticket finds none', (await call(helpAdminList, ADMIN, { from: '2026-10-25', to: '2026-10-30' })).body.tickets.length === 0);
  check('filter by the day they arrived (Brisbane) finds all three', (await call(helpAdminList, ADMIN, { from: '2026-10-19', to: '2026-10-19' })).body.tickets.length === 3);
  var C = await call(helpAdminCount, ADMIN, {});
  check('the HQ badge counts three new', C.status === 200 && C.body.new === 3 && C.body.urgent === 0, C.body);
  var g1 = await call(helpAdminGet, ADMIN, { ticket_no: 1001 });
  check('opening a ticket shows it, by number', g1.status === 200 && g1.body.ticket.ticket_no === 1001 && g1.body.venue_name === 'The Royal Hotel');
  check('opening a new one marks it open and says who opened it', T(1001).status === 'open' && notesOf(T(1001)).some(function (n) { return /Opened by Dean/.test(n.body); }));
  check('so the badge drops to two', (await call(helpAdminCount, ADMIN, {})).body.new === 2);
  var up = await call(helpAdminUpdate, ADMIN, { id: T(1001).id, status: 'closed', category: 'venue_support', priority: 'urgent', assigned_to: 'Support Sue' });
  check('status, kind, priority and who has it can all be changed', up.status === 200 && T(1001).status === 'closed' && T(1001).category === 'venue_support' && T(1001).priority === 'urgent' && T(1001).assigned_to === 'Support Sue');
  check('closing stamps closed_at, and the change is written on the ticket', !!T(1001).closed_at && notesOf(T(1001)).some(function (n) { return n.kind === 'change' && /Status: open to closed/.test(n.body); }));
  await call(helpAdminUpdate, ADMIN, { id: T(1001).id, status: 'open' });
  check('reopening clears closed_at', T(1001).closed_at === null);
  check('a made-up status is refused', (await call(helpAdminUpdate, ADMIN, { id: T(1001).id, status: 'deleted' })).status === 400);
  await call(helpAdminNote, ADMIN, { id: T(1002).id, body: 'Called them back' });
  check('an internal note is kept, and is not emailed to anyone', notesOf(T(1002)).some(function (n) { return n.kind === 'note' && n.body === 'Called them back'; }));

  print('HQ: REPLYING BY EMAIL, FROM THE RIGHT ADDRESS');
  sent.length = 0;
  var rp = await call(helpAdminReply, ADMIN, { id: T(1002).id, body: 'Refunded the second charge.' });
  var m = sent[0];
  check('an accounts reply goes from VenuePlay accounts, replies to accounts@', rp.status === 200 && m && m.from === 'VenuePlay Accounts <accounts@send.venueplay.com.au>' && m.reply_to === 'accounts@venueplay.com.au', m && [m.from, m.reply_to]);
  check('to the contact, with the ticket number in the subject', m && m.to.join() === 'owner@royalhotel.com.au' && /\[#1002\]$/.test(m.subject), m && m.subject);
  check('it carries the ABN and a way to reach us', m && /ABN 35 679 383 049/.test(m.html) && /accounts@venueplay\.com\.au/.test(m.html));
  check('the reply is recorded on the ticket, which now waits on them', notesOf(T(1002)).some(function (n) { return n.kind === 'reply' && /Refunded/.test(n.body); }) && T(1002).status === 'waiting');
  sent.length = 0;
  await call(helpAdminReply, ADMIN, { id: T(1001).id, body: 'Fixed.' });
  check('a support reply goes from VenuePlay support', sent[0] && sent[0].from === 'VenuePlay Support <support@send.venueplay.com.au>' && sent[0].reply_to === 'support@venueplay.com.au');
  sent.length = 0;
  await call(helpAdminReply, ADMIN, { id: T(1003).id, body: 'Try the code again.' });
  check('a PartyPlay reply goes from PartyPlay support, in PartyPlay branding', sent[0] && sent[0].from === 'PartyPlay Support <support@send.partyplay.com.au>' && sent[0].reply_to === 'support@partyplay.com.au' && /PartyPlay/.test(sent[0].html) && !/VenuePlay/.test(sent[0].html), sent[0] && sent[0].from);
  await call(helpAdminUpdate, ADMIN, { id: T(1003).id, category: 'sales' }); sent.length = 0;
  await call(helpAdminReply, ADMIN, { id: T(1003).id, body: 'Here is the pricing.' });
  check('a sales or general reply goes from hello@', sent[0] && sent[0].from === 'PartyPlay <hello@send.partyplay.com.au>' && sent[0].reply_to === 'hello@partyplay.com.au', sent[0] && sent[0].from);
  var resendDown = globalThis.fetch; var nNotes = DB.vp_help_ticket_notes.length;
  globalThis.fetch = function (u, o) { if (/resend/.test(String(u))) return Promise.resolve({ ok: false, status: 500 }); return resendDown(u, o); };
  var fail = await call(helpAdminReply, ADMIN, { id: T(1002).id, body: 'Will not arrive' });
  globalThis.fetch = resendDown;
  check('if the email does not send, HQ is told and nothing is recorded as sent', fail.status === 502 && DB.vp_help_ticket_notes.length === nNotes, fail);

  print('HQ: LOGGING A PHONE CALL');
  sent.length = 0; pushes.length = 0;
  var lc = await call(helpAdminLogCall, ADMIN, { brand: 'venueplay', category: 'sales', subject: 'Club in Toowoomba asked about price', message: 'Ring back Tues', contact_name: 'Kim', contact_phone: '0400 222 333', status: 'open' });
  check('a call becomes a phone ticket with the kind HQ picked', lc.status === 200 && lc.body.ticket.channel === 'phone' && lc.body.ticket.category === 'sales' && lc.body.ticket.status === 'open');
  check('a logged call does not alert staff (the person logging it is the alert)', sent.length === 0 && pushes.length === 0);
  var lc2 = await call(helpAdminLogCall, ADMIN, { brand: 'partyplay', category: 'general', subject: 'Sorted on the call', status: 'closed' });
  check('a call sorted there and then is logged closed', lc2.body.ticket.status === 'closed' && !!lc2.body.ticket.closed_at && lc2.body.ticket.brand === 'partyplay');
  check('a call with no kind is refused', (await call(helpAdminLogCall, ADMIN, { brand: 'venueplay', subject: 'x' })).status === 400);

  print('THE REPORT MATCHES THE ROWS');
  world();
  function row(no, brand, cat, ch, st, venue, created, closed) { DB.vp_help_tickets.push({ id: U(500 + no), ticket_no: no, brand: brand, category: cat, channel: ch, status: st, priority: 'normal', venue_id: venue, created_at: created, closed_at: closed, subject: 's' + no }); }
  row(1, 'venueplay', 'sales', 'phone', 'closed', null, '2026-10-01T00:00:00Z', '2026-10-01T02:00:00Z');        // 2h
  row(2, 'venueplay', 'venue_support', 'venue_form', 'closed', VA, '2026-10-02T00:00:00Z', '2026-10-02T10:00:00Z'); // 10h
  row(3, 'venueplay', 'patron_support', 'patron_form', 'open', VA, '2026-10-03T00:00:00Z', null);
  row(4, 'partyplay', 'patron_support', 'patron_form', 'new', null, '2026-10-04T00:00:00Z', null);
  row(5, 'venueplay', 'accounts', 'email', 'waiting', VB, '2026-10-05T00:00:00Z', null);
  row(6, 'partyplay', 'sales', 'web_form', 'closed', null, '2026-10-06T00:00:00Z', '2026-10-06T06:00:00Z');       // 6h
  row(7, 'venueplay', 'venue_support', 'venue_form', 'closed', VA, '2026-09-20T00:00:00Z', '2026-09-30T00:00:00Z'); // outside the range
  var rep = await call(helpAdminReport, ADMIN, { from: '2026-10-01', to: '2026-10-31' });
  var R = rep.body.report;
  // The expected numbers are worked out here from the same rows, independently of helpReport.
  var inRange = DB.vp_help_tickets.filter(function (x) { return x.created_at >= '2026-09-30T14:00:00Z' && x.created_at <= '2026-10-31T13:59:59.999Z'; });
  function tally(k) { var o = {}; inRange.forEach(function (x) { o[x[k]] = (o[x[k]] || 0) + 1; }); return JSON.stringify(o, Object.keys(o).sort()); }
  function same(o) { return JSON.stringify(o, Object.keys(o).sort()); }
  check('the report counts only tickets created in the range', rep.status === 200 && R.total === inRange.length && R.total === 6, R && R.total);
  check('by brand matches the rows', same(R.by_brand) === tally('brand'), R.by_brand);
  check('by category matches the rows', same(R.by_category) === tally('category'), R.by_category);
  check('by channel matches the rows', same(R.by_channel) === tally('channel'), R.by_channel);
  check('by status matches the rows', same(R.by_status) === tally('status'), R.by_status);
  check('average time to close is (2 + 10 + 6) / 3 = 6 hours', R.closed === 3 && R.avg_hours_to_close === 6, [R.closed, R.avg_hours_to_close]);
  check('longest to close is 10 hours, ticket 2', R.longest_hours_to_close === 10 && R.longest_ticket_no === 2, [R.longest_hours_to_close, R.longest_ticket_no]);
  check('top venues: the Royal twice, the Anchor once', JSON.stringify(R.top_venues.map(function (v) { return [v.name, v.count]; })) === '[["The Royal Hotel",2],["The Anchor",1]]', R.top_venues);
  check('the CSV rows are the same six tickets, with their brand', rep.body.rows.length === 6 && rep.body.rows.every(function (x) { return x.brand; }));
  var ppOnly = await call(helpAdminReport, ADMIN, { from: '2026-10-01', to: '2026-10-31', brand: 'partyplay' });
  check('the report can be split to one brand', ppOnly.body.report.total === 2 && ppOnly.body.report.by_brand.partyplay === 2);
  check('a report needs both dates', (await call(helpAdminReport, ADMIN, { from: '2026-10-01' })).status === 400);
  var many = []; for (i = 0; i < 1203; i++) many.push({ id: U(9000 + i), ticket_no: 5000 + i, brand: 'venueplay', category: 'general', channel: 'email', status: 'new', priority: 'normal', created_at: '2026-11-0' + (1 + i % 5) + 'T00:00:00Z' });
  DB.vp_help_tickets = DB.vp_help_tickets.concat(many);
  check('a month with more than 1,000 tickets is counted in full, not the first thousand', (await call(helpAdminReport, ADMIN, { from: '2026-11-01', to: '2026-11-30' })).body.report.total === 1203);

  print('EMAIL IN');
  world();
  function mail(o) { return [ 'From: ' + (o.from || '"Jo Bloggs" <jo@example.com>'), 'To: ' + (o.to || 'support@venueplay.com.au'),
      'Subject: ' + (o.subject || 'Help with the TV'), 'Message-ID: ' + (o.mid || '<m1@example.com>') ].concat(o.headers || []).concat(['Content-Type: text/plain; charset=utf-8', '', o.body || 'The TV is blank.']).join('\r\n'); }
  async function inbound(to, raw) { return await helpInboundEmail({ to: to, from: 'bounce@srs.migadu.com', raw: raw }, ENV); }
  var e1 = await inbound('support@help.venueplay.com.au', mail({}));
  t = DB.vp_help_tickets[0];
  check('support@ makes a VenuePlay venue-support ticket from the email', e1.action === 'ticket' && t.brand === 'venueplay' && t.category === 'venue_support' && t.channel === 'email' && t.source_address === 'support@venueplay.com.au', t);
  check('the sender comes from the From header, not the forwarded envelope', t.contact_email === 'jo@example.com' && t.contact_name === 'Jo Bloggs', t);
  check('the same email delivered twice is one ticket (Message-ID)', (await inbound('support@help.venueplay.com.au', mail({}))).action === 'duplicate' && DB.vp_help_tickets.length === 1);
  check('accounts@ is accounts', (await inbound('accounts@help.venueplay.com.au', mail({ mid: '<m2@x>' }))).action === 'ticket' && DB.vp_help_tickets[1].category === 'accounts');
  check('sales@ is sales and hello@ is general', (await inbound('sales@help.venueplay.com.au', mail({ mid: '<m3@x>' }))) && DB.vp_help_tickets[2].category === 'sales' &&
        (await inbound('hello@help.venueplay.com.au', mail({ mid: '<m4@x>' }))) && DB.vp_help_tickets[3].category === 'general');
  await inbound('support@help.partyplay.com.au', mail({ mid: '<m5@x>' }));
  check('a PartyPlay address makes a PartyPlay ticket', DB.vp_help_tickets[4].brand === 'partyplay' && DB.vp_help_tickets[4].source_address === 'support@partyplay.com.au', DB.vp_help_tickets[4]);
  await inbound('support@help.venueplay.com.au', mail({ mid: '<m6@x>', from: 'Sam <Owner@RoyalHotel.com.au>' }));
  check('a venue owner writing from their account email is matched to their venue', DB.vp_help_tickets[5].venue_id === VA, DB.vp_help_tickets[5].venue_id);
  // Threading.
  var first = DB.vp_help_tickets[0]; first.status = 'waiting';
  var re = await inbound('support@help.venueplay.com.au', mail({ mid: '<r1@x>', subject: 'Re: Help with the TV [#' + first.ticket_no + ']',
    body: 'Still blank after a restart.\r\n\r\nOn Mon, 19 Oct 2026 at 10:02, VenuePlay Support <support@send.venueplay.com.au> wrote:\r\n> Try turning it off and on.' }));
  var n = notesOf(first).filter(function (x) { return x.kind === 'email_in'; })[0];
  check('a reply quoting [#n] from the same person goes onto that ticket as a note', re.action === 'note' && n && DB.vp_help_tickets.length === 6, re);
  check('without the quoted history', n && n.body === 'Still blank after a restart.', n && n.body);
  check('and a ticket waiting on them is open again', first.status === 'open');
  var guess = await inbound('support@help.venueplay.com.au', mail({ mid: '<r2@x>', from: 'stranger@example.com', subject: 'Re: [#' + first.ticket_no + ']' }));
  check('a stranger quoting somebody else\'s number starts a new ticket, never writes on theirs', guess.action === 'ticket' && notesOf(first).filter(function (x) { return x.kind === 'email_in'; }).length === 1);
  var cross = await inbound('support@help.partyplay.com.au', mail({ mid: '<r3@x>', subject: 'Re: [#' + first.ticket_no + ']' }));
  check('a VenuePlay number quoted to a PartyPlay address does not thread across brands', cross.action === 'ticket');
  var nT = DB.vp_help_tickets.length;
  check('our own alert coming back round through hello@ is ignored', (await inbound('hello@help.venueplay.com.au', mail({ mid: '<a1@x>', from: 'Help Desk <hello@send.venueplay.com.au>' }))).action === 'ignored');
  check('anything carrying X-VP-Help is ignored', (await inbound('hello@help.venueplay.com.au', mail({ mid: '<a2@x>', headers: ['X-VP-Help: alert'] }))).action === 'ignored');
  check('an out-of-office is ignored', (await inbound('support@help.venueplay.com.au', mail({ mid: '<a3@x>', headers: ['Auto-Submitted: auto-replied'] }))).action === 'ignored');
  check('a newsletter is ignored', (await inbound('hello@help.venueplay.com.au', mail({ mid: '<a4@x>', headers: ['List-Unsubscribe: <mailto:x@y>'] }))).action === 'ignored');
  check('a bounce is ignored', (await inbound('support@help.venueplay.com.au', mail({ mid: '<a5@x>', from: 'MAILER-DAEMON@mx.example.com' }))).action === 'ignored');
  check('and none of those made a ticket', DB.vp_help_tickets.length === nT);
  var mime = ['From: =?utf-8?B?Wm/DqyBCcm93bg==?= <zoe@example.com>', 'To: support@venueplay.com.au', 'Subject: =?utf-8?Q?Caf=C3=A9_night_help?=', 'Message-ID: <mime@x>',
    'Content-Type: multipart/alternative; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
    'Caf=C3=A9 quiz tonight, the phones say =\r\nwaiting.', '--b1', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', 'PHA+aHRtbCB2ZXJzaW9uPC9wPg==', '--b1--', ''].join('\r\n');
  await inbound('support@help.venueplay.com.au', mime);
  t = DB.vp_help_tickets[DB.vp_help_tickets.length - 1];
  check('a real-world MIME email reads properly: encoded subject and name, quoted-printable body', t.subject === 'Café night help' && t.contact_name === 'Zoë Brown' && t.message === 'Café quiz tonight, the phones say waiting.', [t.subject, t.contact_name, t.message]);
  var htmlOnly = ['From: a@example.com', 'Subject: html', 'Message-ID: <h@x>', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', 'PHA+SGVsbG8gJmFtcDsgdGhhbmtzPC9wPjxzY3JpcHQ+YmFkKCk8L3NjcmlwdD4='].join('\r\n');
  await inbound('support@help.venueplay.com.au', htmlOnly);
  t = DB.vp_help_tickets[DB.vp_help_tickets.length - 1];
  check('an HTML-only email is read as text, scripts removed', t.message === 'Hello & thanks', t.message);
  var broke = await helpInboundEmail({ to: 'support@help.venueplay.com.au', raw: null, from: 'x' }, ENV);
  check('an email that cannot be read at all never throws (Migadu still has it)', broke.action === 'failed' || broke.action === 'ignored', broke);

  print('PHONE ALERTS (Web Push)');
  world();
  var PENV = Object.assign({}, ENV, { VAPID_PUBLIC_KEY: 'BPub', VAPID_PRIVATE_JWK: JSON.stringify({ d: 'd', x: 'x', y: 'y' }) });
  async function pcall(fn, user, body) { try { return await fn(req(user, body), PENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e && e.stack || e) } }; } }
  var EP_ALL = 'https://fcm.googleapis.com/fcm/send/all-device', EP_URG = 'https://web.push.apple.com/urgent-device';
  var s1 = await pcall(helpAdminPushSubscribe, ADMIN, { endpoint: EP_ALL, filter: 'all', device_label: 'Dean iPhone' });
  var s2 = await pcall(helpAdminPushSubscribe, STAFF_ADMIN, { endpoint: EP_URG, filter: 'urgent_sales' });
  check('HQ staff can switch alerts on for a device, and get the device its own secret', s1.status === 200 && s1.body.token && s1.body.token.length >= 40 && s2.status === 200, s1);
  check('the secret is stored only as a hash', DB.vp_help_push_subs.length === 2 && DB.vp_help_push_subs.every(function (x) { return x.token_hash.length === 64 && x.token_hash !== s1.body.token; }));
  check('a push address that is not a real push service is refused', (await pcall(helpAdminPushSubscribe, ADMIN, { endpoint: 'https://evil.example/collect' })).status === 400);
  check('a venue owner cannot switch alerts on', (await pcall(helpAdminPushSubscribe, OWNER_A, { endpoint: EP_ALL })).status === 403);
  var ppat = await (async function () { try { return await helpPublicTicket(req(null, PATRON), PENV, J); } catch (e) { return { body: { error: String(e) } }; } })();
  check('a new patron ticket pushes to the all-tickets device', ppat.status === 200 && pushes.length === 1 && pushes[0].url === EP_ALL, pushes.map(function (p) { return p.url; }));
  check('and not to the urgent-and-sales device', pushes.every(function (p) { return p.url !== EP_URG; }));
  check('the push itself is EMPTY: no name, email, subject or message goes to Google or Apple', pushes[0] && pushes[0].body === '' && pushes[0].headers['Content-Length'] === '0');
  check('it is signed for the push service (VAPID) with the public key named', pushes[0] && /^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=BPub$/.test(pushes[0].headers.Authorization), pushes[0] && pushes[0].headers.Authorization);
  var jwtBody = pushes[0] && JSON.parse(decodeURIComponent(escape(helpB64(pushes[0].headers.Authorization.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
  check('the VAPID token is for that push service and expires within a day', jwtBody && jwtBody.aud === 'https://fcm.googleapis.com' && jwtBody.exp - Date.now() / 1000 <= 86400, jwtBody);
  pushes.length = 0;
  await (async function () { await helpVenueTicket(req(OWNER_A, { venue_id: VA, subject: 'Down', message: 'All down', urgent: true }), PENV, J); })();
  check('an urgent ticket pushes to both devices, marked high urgency', pushes.length === 2 && pushes.every(function (p) { return p.headers.Urgency === 'high'; }), pushes.map(function (p) { return p.url; }));
  var peek = await pcall(helpPushPeek, null, { endpoint: EP_ALL, token: s1.body.token });
  check('the phone asks what woke it and is told brand, kind and number', peek.status === 200 && peek.body.ticket_no === 1002 && peek.body.brand === 'venueplay' && peek.body.category === 'venue_support' && peek.body.urgent === true, peek.body);
  check('and NOTHING personal: only count, number, brand, kind, label and urgency', Object.keys(peek.body).sort().join() === 'brand,category,count,label,ticket_no,urgent' && !/example|Down|All down|Royal|owner@/.test(JSON.stringify(peek.body)), peek.body);
  check('asking again with nothing new says nothing new', (await pcall(helpPushPeek, null, { endpoint: EP_ALL, token: s1.body.token })).body.count === 0);
  check('the wrong secret is refused', (await pcall(helpPushPeek, null, { endpoint: EP_ALL, token: 'x' + s1.body.token.slice(1) })).status === 403);
  check('another device\'s secret is refused', (await pcall(helpPushPeek, null, { endpoint: EP_URG, token: s1.body.token })).status === 403);
  var un = await pcall(helpAdminPushUnsubscribe, ADMIN, { endpoint: EP_ALL });
  pushes.length = 0;
  await (async function () { await helpPublicTicket(req(null, Object.assign({}, PATRON, { device: 'after', email: 'after@example.com' })), PENV, J); })();
  check('switching a device off removes it, and it gets no more pushes', un.status === 200 && un.body.removed === 1 && pushes.length === 0, [un.body, pushes.length]);
  check('a switched-off device\'s secret no longer answers', (await pcall(helpPushPeek, null, { endpoint: EP_ALL, token: s1.body.token })).status === 403);
  PUSH_STATUS = 410; pushes.length = 0;
  await (async function () { await helpVenueTicket(req(OWNER_A, { venue_id: VA, subject: 'x', message: 'y', urgent: true }), PENV, J); })();
  check('a device the push service says is gone (410) is forgotten', pushes.length === 1 && DB.vp_help_push_subs.length === 0, DB.vp_help_push_subs.length);
  PUSH_STATUS = 201; pushes.length = 0;
  await (async function () { await helpPublicTicket(req(null, Object.assign({}, PATRON, { device: 'nokeys', email: 'nk@example.com' })), ENV, J); })();
  check('with no VAPID keys set the ticket and its email still go, and no push is tried', pushes.length === 0 && sent.some(function (m) { return /\[#\d+\]/.test(m.subject); }));

  print('PARTYPLAY\'S PAGES MAY POST HERE, FOR THE HELP DESK ONLY');
  async function preflight(path, origin) { var r = await _d.fetch({ url: 'https://venueplay-api.dean-tindale.workers.dev' + path, method: 'OPTIONS', headers: hdr({ Origin: origin }) }, ENV); return r.headers['Access-Control-Allow-Origin']; }
  check('partyplay.com.au may post to /help/ticket', (await preflight('/help/ticket', 'https://partyplay.com.au')) === 'https://partyplay.com.au');
  check('www.partyplay.com.au too', (await preflight('/help/ticket', 'https://www.partyplay.com.au')) === 'https://www.partyplay.com.au');
  check('but not to anything else in this Worker', (await preflight('/account/summary', 'https://partyplay.com.au')) !== 'https://partyplay.com.au');
  check('nor to /admin/help', (await preflight('/admin/help/list', 'https://partyplay.com.au')) !== 'https://partyplay.com.au');
  check('a look-alike domain is not let in', (await preflight('/help/ticket', 'https://partyplay.com.au.evil.example')) !== 'https://partyplay.com.au.evil.example');
  check('VenuePlay pages still are', (await preflight('/help/ticket', 'https://www.venueplay.com.au')) === 'https://www.venueplay.com.au');

  print('HELP CONTENT: THE WORDS A PANEL GETS');
  function contentWorld() {
    world();
    DB.vp_help_faq = [{ id: U(701), brand: 'venueplay', audience: 'patron', position: 20, question: 'Second?', answer: 'B', hidden: false },
                      { id: U(702), brand: 'venueplay', audience: 'patron', position: 10, question: 'First?', answer: 'A', hidden: false },
                      { id: U(703), brand: 'venueplay', audience: 'patron', position: 30, question: 'Hidden?', answer: 'H', hidden: true },
                      { id: U(704), brand: 'partyplay', audience: 'guest', position: 10, question: 'Party?', answer: 'P', hidden: false }];
    DB.vp_help_issues = [{ id: U(801), brand: 'venueplay', audience: 'patron', position: 10, title: 'My game is not showing', category: 'patron_support', hidden: false, auto_order: true },
                         { id: U(802), brand: 'venueplay', audience: 'patron', position: 20, title: 'A bill', category: 'accounts', hidden: false, auto_order: true },
                         { id: U(803), brand: 'venueplay', audience: 'patron', position: 30, title: 'Hidden issue', category: 'general', hidden: true, auto_order: true },
                         { id: U(804), brand: 'partyplay', audience: 'guest', position: 10, title: 'Cannot join', category: 'patron_support', hidden: false, auto_order: true }];
    DB.vp_help_steps = [{ id: U(901), issue_id: U(801), position: 10, body: 'Pull down to refresh the page.', pinned: false, hidden: false, tries: 0, fixes: 0 },
                        { id: U(902), issue_id: U(801), position: 20, body: 'Check the code matches the screen.', pinned: false, hidden: false, tries: 0, fixes: 0 },
                        { id: U(903), issue_id: U(801), position: 30, body: 'Check your phone is online.', pinned: false, hidden: false, tries: 0, fixes: 0 },
                        { id: U(904), issue_id: U(801), position: 40, body: 'Ask the host.', pinned: true, hidden: false, tries: 0, fixes: 0 },
                        { id: U(905), issue_id: U(801), position: 50, body: 'A hidden step.', pinned: false, hidden: true, tries: 0, fixes: 0 },
                        { id: U(906), issue_id: U(804), position: 10, body: 'Check the party code.', pinned: false, hidden: false, tries: 0, fixes: 0 }];
    DB.vp_help_triage_events = []; DB.vp_help_reorders = [];
  }
  function getReq(qs) { return { url: 'https://api.test/help/content?' + qs, headers: hdr({ 'cf-connecting-ip': '203.0.113.9' }), text: function () { return Promise.resolve(''); } }; }
  contentWorld();
  var C1 = await helpPublicContent(getReq('brand=venueplay&audience=patron'), ENV, J);
  check('a phone gets its FAQ in HQ\'s order, without the hidden one', C1.status === 200 && C1.body.faq.map(function (f) { return f.q; }).join() === 'First?,Second?', C1.body.faq);
  check('and its issues, without the hidden one', C1.body.issues.map(function (i) { return i.title; }).join() === 'My game is not showing,A bill');
  check('each issue\'s steps in order, without the hidden step', C1.body.issues[0].steps.map(function (x) { return x.body; }).join('|') === 'Pull down to refresh the page.|Check the code matches the screen.|Check your phone is online.|Ask the host.');
  check('an issue with no steps comes with none (it goes straight to the form)', C1.body.issues[1].steps.length === 0);
  check('the counts, positions, pins and categories never reach a phone', !/tries|fixes|position|pinned|category|hidden|auto_order/.test(JSON.stringify(C1.body)), JSON.stringify(C1.body).slice(0, 200));
  var C2 = await helpPublicContent(getReq('brand=partyplay&audience=guest'), ENV, J);
  check('PartyPlay guests get PartyPlay\'s words and none of VenuePlay\'s', C2.body.faq.length === 1 && C2.body.faq[0].q === 'Party?' && C2.body.issues.length === 1 && C2.body.issues[0].title === 'Cannot join');
  check('a made-up audience is refused', (await helpPublicContent(getReq('brand=venueplay&audience=guest'), ENV, J)).status === 400);

  print('GUIDED TRIAGE: EACH ANSWER');
  contentWorld();
  function tri(body, ip) { return call(helpTriageEvent, null, Object.assign({ brand: 'venueplay', device: 'tri-' + (ip || 1) }, body), { ip: ip || 50 }); }
  await tri({ issue_id: U(801), kind: 'start' });
  await tri({ issue_id: U(801), step_id: U(901), kind: 'not_fixed' });
  await tri({ issue_id: U(801), step_id: U(902), kind: 'fixed' });
  function S(n) { return DB.vp_help_steps.filter(function (x) { return x.id === U(n); })[0]; }
  check('"Still not working" counts a try', S(901).tries === 1 && S(901).fixes === 0);
  check('"Fixed it" counts a try and a fix', S(902).tries === 1 && S(902).fixes === 1);
  check('every answer is kept for the report, with nothing about who', DB.vp_help_triage_events.length === 3 && DB.vp_help_triage_events.every(function (e) { return Object.keys(e).sort().join() === 'brand,created_at,id,issue_id,kind,step_id'; }), DB.vp_help_triage_events);
  check('a step from another issue is refused, and counts nothing', (await tri({ issue_id: U(801), step_id: U(906), kind: 'fixed' })).status === 404 && S(906).tries === 0);
  check('an issue from the other brand is refused', (await tri({ brand: 'partyplay', issue_id: U(801), kind: 'start' })).status === 404);
  check('a made-up answer is refused', (await tri({ issue_id: U(801), step_id: U(901), kind: 'bogus' })).status === 400);
  var before = DB.vp_help_triage_events.length, thr = 0;
  for (i = 0; i < 45; i++) { var rr = await tri({ issue_id: U(801), kind: 'start' }, 77); if (rr.body && rr.body.throttled) thr++; }
  check('one device cannot pour answers in: forty in ten minutes, then nothing counts', DB.vp_help_triage_events.length - before === 40 && thr === 5, [DB.vp_help_triage_events.length - before, thr]);

  print('GUIDED TRIAGE: THE ORDER LOOKS AFTER ITSELF');
  function st(id, tries, fixes, pinned) { return { id: id, tries: tries, fixes: fixes, pinned: !!pinned }; }
  check('nothing moves until every unpinned step has 20 answers', helpOrder([st('a', 19, 0), st('b', 40, 30), st('c', 40, 0)]).join() === 'a,b,c');
  check('then the step that fixes most goes first', helpOrder([st('a', 20, 2), st('b', 20, 15), st('c', 20, 8)]).join() === 'b,c,a');
  check('a pinned step keeps its place: "Ask the host" stays last', helpOrder([st('a', 20, 1), st('b', 20, 9), st('h', 20, 19, true)]).join() === 'b,a,h');
  check('a pinned step in the middle stays in the middle', helpOrder([st('a', 20, 1), st('p', 20, 0, true), st('b', 20, 9)]).join() === 'b,p,a');
  check('two steps less than 5 points apart do not swap (no flapping)', helpOrder([st('a', 100, 30), st('b', 100, 33)]).join() === 'a,b');
  check('5 points or more apart, they do', helpOrder([st('a', 100, 30), st('b', 100, 36)]).join() === 'b,a');
  contentWorld();
  for (i = 0; i < 20; i++) { await tri({ issue_id: U(801), step_id: U(901), kind: 'not_fixed' }, 100 + i); await tri({ issue_id: U(801), step_id: U(903), kind: i < 15 ? 'fixed' : 'not_fixed' }, 100 + i); }
  check('with step 2 short of 20 answers, nothing has moved yet', DB.vp_help_reorders.length === 0 && S(901).position === 10 && S(903).position === 30);
  for (i = 0; i < 20; i++) await tri({ issue_id: U(801), step_id: U(902), kind: i < 6 ? 'fixed' : 'not_fixed' }, 200 + i);
  check('once every step has 20, the one fixing 75% moves to first, 30% second, 0% third', S(903).position === 10 && S(902).position === 20 && S(901).position === 30, [S(901).position, S(902).position, S(903).position]);
  check('the pinned "Ask the host" is still last', S(904).position === 40);
  check('the hidden step was not moved', S(905).position === 50);
  var LOG = DB.vp_help_reorders[0];
  check('the move is logged with what it was before and after, and why', DB.vp_help_reorders.length === 1 && LOG.before_ids.join() === [U(901), U(902), U(903), U(904)].join() && LOG.after_ids.join() === [U(903), U(902), U(901), U(904)].join() && /75% of 20/.test(LOG.reason), LOG);
  check('the phones get the new order', (await helpPublicContent(getReq('brand=venueplay&audience=patron'), ENV, J)).body.issues[0].steps[0].body === 'Check your phone is online.');
  await tri({ issue_id: U(801), step_id: U(903), kind: 'fixed' }, 300);
  check('another answer that changes nothing logs nothing', DB.vp_help_reorders.length === 1);
  var undo = await call(helpAdminReorderUndo, ADMIN, { id: LOG.id });
  check('Undo in HQ puts the steps back where they were', undo.status === 200 && S(901).position === 10 && S(902).position === 20 && S(903).position === 30 && S(904).position === 40, [S(901).position, S(902).position, S(903).position]);
  check('and says who undid it, and stops this issue reordering itself', !!DB.vp_help_reorders[0].undone_at && DB.vp_help_reorders[0].undone_by === 'Dean' && DB.vp_help_issues[0].auto_order === false);
  for (i = 0; i < 5; i++) await tri({ issue_id: U(801), step_id: U(903), kind: 'fixed' }, 400 + i);
  check('so the next answers do not just move them again', S(901).position === 10 && DB.vp_help_reorders.length === 1);
  check('the same change cannot be undone twice', (await call(helpAdminReorderUndo, ADMIN, { id: LOG.id })).status === 409);
  check('a venue owner cannot undo anything', (await call(helpAdminReorderUndo, OWNER_A, { id: LOG.id })).status === 403);

  print('HQ: THE EDITOR');
  contentWorld();
  S(901).tries = 30; S(901).fixes = 1; S(902).tries = 29; S(902).fixes = 0; S(903).tries = 30; S(903).fixes = 2;
  var E = await call(helpAdminContentGet, STAFF_ADMIN, { brand: 'venueplay', audience: 'patron' });
  var es = E.body.issues && E.body.issues[0].steps;
  check('HQ sees everything for one brand and audience, hidden items included', E.status === 200 && E.body.faq.length === 3 && E.body.issues.length === 3 && es.length === 5);
  check('a step under 5% after 30 tries is flagged', es[0].flagged === true && es[0].rate === 3.3, es[0]);
  check('29 tries is not enough to flag, and 6.7% is not under 5%', es[1].flagged === false && es[2].flagged === false);
  var add = await call(helpAdminContentSave, ADMIN, { kind: 'faq', brand: 'venueplay', audience: 'patron', question: 'New one?', answer: 'Yes.' });
  var nf = DB.vp_help_faq.filter(function (f) { return f.question === 'New one?'; })[0];
  check('a new question goes on the end of the list', add.status === 200 && nf && nf.position === 40 && nf.updated_by === 'Dean', nf);
  await call(helpAdminContentSave, ADMIN, { kind: 'faq', id: nf.id, answer: 'Yes, edited.' });
  check('editing changes the words', nf.answer === 'Yes, edited.');
  await call(helpAdminContentMove, ADMIN, { kind: 'faq', id: nf.id, dir: 'up' });
  var hqOrder = (await call(helpAdminContentGet, ADMIN, { brand: 'venueplay', audience: 'patron' })).body.faq.map(function (f) { return f.question; }).join();
  check('moving it up swaps it with the one above in HQ\'s list (hidden ones included, as HQ shows them)', hqOrder === 'First?,Second?,New one?,Hidden?', hqOrder);
  var pub;
  await call(helpAdminContentMove, ADMIN, { kind: 'faq', id: nf.id, dir: 'up' }); await call(helpAdminContentMove, ADMIN, { kind: 'faq', id: nf.id, dir: 'up' });
  pub = (await helpPublicContent(getReq('brand=venueplay&audience=patron'), ENV, J)).body.faq.map(function (f) { return f.q; }).join();
  check('moved to the top, it is first on the phones', pub.indexOf('New one?') === 0, pub);
  await call(helpAdminContentSave, ADMIN, { kind: 'faq', id: nf.id, hidden: true });
  check('hiding it takes it off the phones, and it stays in HQ', (await helpPublicContent(getReq('brand=venueplay&audience=patron'), ENV, J)).body.faq.every(function (f) { return f.q !== 'New one?'; }) && DB.vp_help_faq.indexOf(nf) >= 0);
  var ns = await call(helpAdminContentSave, ADMIN, { kind: 'step', issue_id: U(802), body: 'Check your last invoice email.', pinned: true });
  check('a step can be added to an issue, pinned', ns.status === 200 && DB.vp_help_steps.some(function (x) { return x.issue_id === U(802) && x.pinned === true && x.position === 10; }));
  check('a step needs an issue that exists', (await call(helpAdminContentSave, ADMIN, { kind: 'step', issue_id: U(999), body: 'x' })).status === 404);
  var ni = await call(helpAdminContentSave, ADMIN, { kind: 'issue', brand: 'partyplay', audience: 'host', title: 'Refund', category: 'accounts' });
  check('an issue can be added for PartyPlay hosts, with its ticket kind', ni.status === 200 && DB.vp_help_issues.some(function (x) { return x.title === 'Refund' && x.brand === 'partyplay' && x.category === 'accounts'; }));
  check('a made-up ticket kind is refused', (await call(helpAdminContentSave, ADMIN, { kind: 'issue', id: U(801), category: 'whatever' })).status === 400);
  check('an empty question is refused', (await call(helpAdminContentSave, ADMIN, { kind: 'faq', brand: 'venueplay', audience: 'patron', question: '', answer: 'x' })).status === 400);
  var CONTENT = { helpAdminContentGet: helpAdminContentGet, helpAdminContentSave: helpAdminContentSave, helpAdminContentMove: helpAdminContentMove, helpAdminReorderUndo: helpAdminReorderUndo };
  var leaks2 = [], snap = JSON.stringify([DB.vp_help_faq, DB.vp_help_issues, DB.vp_help_steps]);
  for (who in WHO) for (name in CONTENT) {
    var rz = await call(CONTENT[name], WHO[who], { brand: 'venueplay', audience: 'patron', kind: 'faq', id: U(701), question: 'HACKED', answer: 'x', dir: 'up' });
    if (!(rz.status === 401 || rz.status === 403)) leaks2.push(who + ' > ' + name + ' ' + rz.status);
  }
  check('nobody but HQ can read or change the help words: anon, venue owners, hosts, marketing, strangers', leaks2.length === 0 && JSON.stringify([DB.vp_help_faq, DB.vp_help_issues, DB.vp_help_steps]) === snap, leaks2);

  print('A TICKET FROM THE TRIAGE');
  contentWorld();
  var tk = await call(helpPublicTicket, null, Object.assign({}, PATRON, { issue_id: U(802), message: 'Steps did not help', device: 'tk1' }));
  var tt = T(tk.body.ticket_no);
  check('the issue names the ticket and picks its kind (a bill: accounts)', tt && tt.subject.indexOf('A bill') === 0 && tt.category === 'accounts', tt && [tt.subject, tt.category]);
  check('and the report hears that this issue ended in a ticket', DB.vp_help_triage_events.some(function (e) { return e.kind === 'ticket' && e.issue_id === U(802); }));
  var tk2 = await call(helpPublicTicket, null, Object.assign({}, PATRON, { issue_id: U(804), device: 'tk2', email: 'tk2@example.com' }));
  check('an issue from the other brand is ignored: an ordinary player ticket', T(tk2.body.ticket_no).category === 'patron_support' && /^Player help/.test(T(tk2.body.ticket_no).subject));
  var vt = await call(helpVenueTicket, OWNER_A, { venue_id: VA, subject: 'My game is not showing', message: 'Still blank', issue_id: U(801) });
  check('the venue form takes the issue\'s kind too', vt.status === 200 && T(vt.body.ticket_no).category === 'patron_support');

  print('THE REPORT: SOLVED WITHOUT A TICKET');
  contentWorld();
  function ev(kind, issue, step, when) { DB.vp_help_triage_events.push({ id: 'e' + DB.vp_help_triage_events.length, brand: 'venueplay', issue_id: U(issue), step_id: step ? U(step) : null, kind: kind, created_at: when || '2026-10-10T01:00:00Z' }); }
  for (i = 0; i < 10; i++) ev('start', 801);
  for (i = 0; i < 4; i++) ev('fixed', 801, 901);
  for (i = 0; i < 2; i++) ev('fixed', 801, 903);
  for (i = 0; i < 3; i++) ev('not_fixed', 801, 902);
  ev('ticket', 801);
  ev('start', 802); ev('ticket', 802);
  ev('start', 801, null, '2026-09-01T00:00:00Z'); ev('fixed', 801, 901, '2026-09-01T00:00:00Z');
  var TR = (await call(helpAdminReport, ADMIN, { from: '2026-10-01', to: '2026-10-31' })).body.triage;
  var g801 = TR.filter(function (r) { return r.issue_id === U(801); })[0], g802 = TR.filter(function (r) { return r.issue_id === U(802); })[0];
  check('per issue: 10 picked it, 6 sorted without a ticket, 1 sent one, 3 left', g801 && g801.started === 10 && g801.solved === 6 && g801.tickets === 1 && g801.left === 3, g801);
  check('and which step did the fixing: refresh 4, phone online 2', g801 && g801.by_step['Pull down to refresh the page.'] === 4 && g801.by_step['Check your phone is online.'] === 2 && Object.keys(g801.by_step).length === 2, g801 && g801.by_step);
  check('an issue with no steps: 1 picked it, 1 ticket, none solved', g802 && g802.started === 1 && g802.tickets === 1 && g802.solved === 0 && g802.left === 0, g802);
  check('answers outside the dates are not counted', g801 && g801.started === 10);

  print('THE PHONE\'S SERVICE WORKER (venueplay/app/vp-help-sw.js), RUN');
  async function swRun(peekAnswer, peekOk) {
    var L = {}, shown = [], opened = [], asked = [];
    var self = { addEventListener: function (k, f) { L[k] = f; }, skipWaiting: function () {},
      registration: { showNotification: function (t, o) { shown.push({ title: t, opts: o }); return Promise.resolve(); } },
      clients: { claim: function () { return Promise.resolve(); }, openWindow: function (u) { opened.push(u); return Promise.resolve(); } } };
    var caches = { open: function () { return Promise.resolve({ match: function () { return Promise.resolve({ json: function () { return Promise.resolve({ api: 'https://api.test', endpoint: 'https://fcm.googleapis.com/x', token: 'secret-token-0123456789' }); } }); } }); } };
    var fetch = function (u, o) { asked.push({ url: u, body: JSON.parse(o.body) });
      if (peekOk === 'offline') return Promise.reject(new TypeError('Failed to fetch'));   // the phone has no signal
      return Promise.resolve({ ok: peekOk, json: function () { return Promise.resolve(peekAnswer); } }); };
    (new Function('self', 'caches', 'fetch', readFile('venueplay/app/vp-help-sw.js')))(self, caches, fetch);
    var waits = []; L.push({ waitUntil: function (p) { waits.push(p); } }); await Promise.all(waits);
    var w2 = []; if (shown[0]) L.notificationclick({ notification: { close: function () {}, data: shown[0].opts.data }, waitUntil: function (p) { w2.push(p); } }); await Promise.all(w2);
    return { shown: shown, opened: opened, asked: asked };
  }
  var sw = await swRun({ count: 2, ticket_no: 1042, brand: 'partyplay', category: 'venue_support', urgent: true, label: 'Host support' }, true);
  check('a push asks the Worker what arrived, with this device\'s own endpoint and secret', sw.asked.length === 1 && sw.asked[0].url === 'https://api.test/help/push/peek' && sw.asked[0].body.token === 'secret-token-0123456789', sw.asked);
  check('and shows brand, URGENT and the kind in the title', sw.shown.length === 1 && sw.shown[0].title === '[PartyPlay] URGENT Host support', sw.shown[0] && sw.shown[0].title);
  check('the ticket number in the body, and how many more', /Ticket #1042 and 1 more/.test(sw.shown[0].opts.body), sw.shown[0].opts.body);
  check('tapping it opens that ticket in HQ', sw.opened.join() === '/app/hq.html#help-1042', sw.opened);
  var sw2 = await swRun(null, false);
  check('if the Worker cannot be asked, a notification still shows (an iPhone switches alerts off otherwise)', sw2.shown.length === 1 && sw2.shown[0].title === 'Help desk', sw2.shown);
  check('and it opens the help desk', sw2.opened.join() === '/app/hq.html#helpdesk', sw2.opened);
  var sw3 = await swRun(null, 'offline').catch(function (e) { return { shown: [], err: String(e) }; });
  check('with no signal at all (the question itself fails), a notification still shows', sw3.shown.length === 1 && sw3.shown[0].title === 'Help desk', sw3);
  check('the service worker has no fetch handler, so it can never get between a page and the network', !/addEventListener\(\s*["']fetch["']/.test(readFile('venueplay/app/vp-help-sw.js')));

  print('ONE WIDGET, TWO SITES; AND THE WORDS');
  check('partyplay/lib/vp-help.js is byte for byte venueplay/app/vp-help.js', readFile('partyplay/lib/vp-help.js') === readFile('venueplay/app/vp-help.js'));
  var VPF = JSON.parse(readFile('venueplay/data/help-faq.json')), PPF = JSON.parse(readFile('partyplay/data/help-faq.json'));
  check('the VenuePlay FAQ has its patron and venue sections', VPF.patron.items.length >= 6 && VPF.venue.items.length >= 6);
  check('the PartyPlay FAQ has its guest and host sections', PPF.guest.items.length >= 5 && PPF.host.items.length >= 5);
  function words(f) { var out = []; ['patron', 'venue', 'guest', 'host'].forEach(function (k) { (f[k] && f[k].items || []).forEach(function (i) { out.push(i.q + ' ' + i.a); }); }); return out.join('\n'); }
  var allWords = words(VPF) + '\n' + words(PPF);
  check('no long dashes anywhere in either FAQ', !/[\u2013\u2014]/.test(allWords));
  check('never "roster"; it is your members list', !/roster/i.test(allWords) && /members list/.test(words(VPF)));
  check('never "the ACT"', !/\bthe ACT\b/.test(allWords));
  var claim = VPF.patron.items.filter(function (i) { return /BINGO/.test(i.q); })[0];
  check('a bingo prize is claimed from the host, never the bar', claim && /claimed from the host, never the bar/.test(claim.a) && !/claim[^.]*from the bar/i.test(allWords.replace('never the bar', '')), claim && claim.a);
  check('each Help panel names its own support address', VPF.support_email === 'support@venueplay.com.au' && PPF.support_email === 'support@partyplay.com.au' && /support@venueplay\.com\.au/.test(words(VPF)) && /support@partyplay\.com\.au/.test(words(PPF)));

  print('');
  print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL the suite threw: ' + (e && e.stack || e)); print('1 FAILED'); });
