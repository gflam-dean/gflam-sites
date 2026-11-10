/* HELP DESK BLOCK SENDER AND PHISHING FILTER, RUN (Dean, 10 Nov 2026).
   Runs the shipped Worker code (indirect eval of venueplay-api-FULL.js, as support-phone-emails.test.js
   does) with a fake database, and drives helpTicketFromEmail and the HQ block endpoints.

   Proves: a blocked sender (the seeded secure.net, an address, a whole domain, a subdomain) makes NO
   ticket, NO note on an old ticket, NO acknowledgement, NO alert; the real American Express-style phish
   is filed as spam; and real-looking customer mail is NOT caught: a venue manager mentioning PayPal or
   Westpac, a reply to one of our tickets, an account contact, a customer named like a brand, real brand
   mail from the real domain. Block sender closes the ticket, refuses a free-mail domain block, refuses
   our own addresses, says so plainly when migration 184 has not run, and writes nothing then.

   Run from the repo root:  jsc venueplay-backend/worker/help-block-sender.test.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
var logs = [];
console = { log: function (m) { logs.push(String(m)); }, warn: function () {}, error: function () {} };
(0, eval)(src + '\n;globalThis.__seed = HELP_BLOCK_SEED;');

var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }

// ---- a fake database and a record of everything the help desk does -------------------
var db, inserted, patched, sentMail, tableThere;
function reset() { db = { blocklist: [], tickets: [], founding: [] }; inserted = []; patched = []; sentMail = []; tableThere = true; logs = []; }
vpaSelect = async function (env, table, q) {
  if (table === 'vp_help_blocklist') { if (!tableThere) throw new Error('relation does not exist'); return db.blocklist.slice(); }
  if (table === 'vp_help_tickets') {
    var m = /ticket_no=eq\.(\d+)/.exec(q); if (m) return db.tickets.filter(function (t) { return String(t.ticket_no) === m[1]; });
    var m2 = /\bid=eq\.([^&]+)/.exec(q); if (m2) return db.tickets.filter(function (t) { return t.id === decodeURIComponent(m2[1]); });
    return [];
  }
  if (table === 'venueplay_founding') return db.founding.slice();
  return [];
};
vpaInsert = async function (env, table, row) {
  if (table === 'vp_help_blocklist' && !tableThere) throw new Error('relation does not exist');
  inserted.push({ table: table, row: row }); return Object.assign({ id: 'id' + inserted.length, ticket_no: 2000 + inserted.length }, row);
};
vpaPatch = async function (env, table, filter, patch) { patched.push({ table: table, filter: filter, patch: patch }); return []; };
helpInsertTicket = async function (env, t) { inserted.push({ table: 'vp_help_tickets', row: t }); return Object.assign({ id: 'tk' + inserted.length, ticket_no: 3000 + inserted.length, reply_token: 'tok' }, t); };
var alerts = 0, acks = 0;
helpAnnounce = async function () { alerts++; };
helpAcknowledge = async function () { acks++; };
helpNotifyStaff = async function () { alerts++; };
helpVenueName = async function () { return ''; };
vpaAudit = async function () { return true; };
function ticketsMade() { return inserted.filter(function (i) { return i.table === 'vp_help_tickets' || i.table === 'vp_help_ticket_notes'; }).length; }
function run(promise) { var out, err, done = false; promise.then(function (v) { out = v; done = true; }, function (e) { err = e; done = true; }); drainMicrotasks(); if (err) throw err; if (!done) throw new Error('did not settle'); return out; }
function mail(fromName, fromEmail, title, extra) {
  return Object.assign({ headers: {}, title: title, from: { name: fromName, email: fromEmail }, reply_to: null, message_id: '<m' + Math.random() + '@x>', text: 'Hello there' }, extra || {});
}
var ENV = { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_KEY: 'k' };
function ingest(m, to) { alerts = 0; acks = 0; inserted = []; return run(helpTicketFromEmail(ENV, to || 'hello@venueplay.com.au', m)); }

print('The seeded entry: secure.net, before migration 184 has run');
reset(); tableThere = false;
var r = ingest(mail('American Express', 'donotreply_us@secure.net', 'American Express | Non-Compliance Issues'));
check('ticket 1027 is filed as spam', r.action === 'spam', r);
check('no ticket, no note, no acknowledgement, no alert', ticketsMade() === 0 && acks === 0 && alerts === 0, [ticketsMade(), acks, alerts]);
r = ingest(mail('Someone', 'billing@mail.secure.net', 'Hello'));
check('a subdomain of a blocked domain is blocked too', r.action === 'spam', r);
r = ingest(mail('Sam', 'sam@secureplay.net', 'Can you help with our trivia night'));
check('a different domain that merely ends the same way is NOT blocked', r.action === 'ticket', r);

print('');
print('A block from HQ');
reset(); db.blocklist.push({ kind: 'email', value: 'bad@example.org' }, { kind: 'domain', value: 'evil.co' });
r = ingest(mail('Bad', 'BAD@example.org', 'Hi'));
check('a blocked address (any letter case) is filed as spam', r.action === 'spam' && ticketsMade() === 0 && acks === 0, r);
r = ingest(mail('Other', 'good@example.org', 'Trivia question'));
check('another address at the same domain is not blocked by an address block', r.action === 'ticket', r);
r = ingest(mail('X', 'x@evil.co', 'Hi'));
check('a blocked domain is blocked', r.action === 'spam', r);
db.tickets.push({ id: 'old', ticket_no: 1500, reply_token: 'abcdefabcdef', brand: 'venueplay', contact_email: 'x@evil.co', status: 'waiting' });
r = ingest(mail('X', 'x@evil.co', 'Re: your enquiry (ticket 1500, ref ABCD-EFGH)'));
check('a blocked sender cannot reopen or write on an old ticket either', r.action === 'spam' && patched.length === 0 && ticketsMade() === 0, r);
check('the pure matcher: nobody blocked when the list is empty', helpBlockedBy('a@b.com', []) === false && helpBlockedBy('', __seed) === false);

print('');
print('Brand impersonation caught');
reset();
var phish = [
  ['American Express', 'statements@amexsecure-alerts.com', 'Account notice'],
  ['AMEX Security', 'info@random-mailer.ru', 'Your card'],
  ['PayPal Service', 'service@paypa1-support.com', 'Invoice 4471'],
  ['Westpac Online', 'alerts@westpac-secure.top', 'Action'],
  ['Commonwealth Bank', 'netbank@cba-verify.net', 'Hello'],
  ['', 'billing@acme-corp.biz', 'PayPal account suspended, verify now'],
  ['', 'x@somewhere.xyz', 'American Express | Non-Compliance Issues'],
];
phish.forEach(function (p) {
  reset(); var res = ingest(mail(p[0], p[1], p[2]));
  check('phish filed as spam: ' + (p[0] || '(no name)') + ' <' + p[1] + '> "' + p[2] + '"', res.action === 'spam' && ticketsMade() === 0 && acks === 0 && alerts === 0, res);
});

print('');
print('Real customer mail is NOT caught');
var real = [
  ['Sam Taylor', 'sam@thecrownhotel.com.au', 'Trivia night question'],
  ['Jo Nguyen', 'jo.nguyen@gmail.com', 'Paying with PayPal, how do I change my card?'],
  ['Jo Nguyen', 'jo.nguyen@gmail.com', 'PayPal payment failed, account locked out of venueplay'],
  ['Pat Lee', 'pat@westpacclub.com.au', 'Question about Westpac Rescue Helicopter charity trivia night'],
  ['Kim Ho', 'kim@bowlo.org.au', 'Our bank is Commonwealth Bank, is the direct debit ok?'],
  ['The Royal Hotel', 'manager@royalhotel.com.au', 'Microsoft Teams link for the demo'],
  ['Amy Stripe', 'amy@stripeyzebra.com.au', 'Booking trivia'],
  ['Dan Netflix-Fan', 'dan@pubco.com.au', 'We watch Netflix in the beer garden, can the TV app run on that screen?'],
  ['American Express', 'statements@americanexpress.com', 'Your statement'],
  ['PayPal', 'service@paypal.com.au', 'Receipt for your payment'],
  ['Westpac', 'alerts@mail.westpac.com.au', 'Notice'],
  ['Stripe Dan', 'dan@pubco.com.au', 'Booking trivia'],
  ['Pat', 'pat@anzaccentre.com.au', 'Anzac Day trivia'],
];
real.forEach(function (p) {
  reset(); var res = ingest(mail(p[0], p[1], p[2]));
  check('real mail makes a ticket: ' + p[1] + ' "' + p[2] + '"', res.action === 'ticket' && ticketsMade() === 1, res);
});
reset(); db.founding.push({ id: 'f1', contact_email: 'boss@pubco.biz' });
(function () {
  var oldV = vpaSelect;
  vpaSelect = async function (env, table, q) { if (table === 'vp_venues') return [{ id: 'v1' }]; return oldV(env, table, q); };
  var res = ingest(mail('PayPal Service', 'boss@pubco.biz', 'Re our venue'));
  vpaSelect = oldV;
  check('an account contact is never caught, whatever their display name', res.action === 'ticket', res);
})();
reset(); db.tickets.push({ id: 'old', ticket_no: 1500, reply_token: 'abcdefabcdef', brand: 'venueplay', contact_email: 'jo@gmail.com', status: 'waiting' });
(function () {
  var res = ingest(mail('PayPal Support', 'jo@elsewhere.com', 'Re: your enquiry (ticket 1500, ref ' + helpRefOf('abcdefabcdef') + ')'));
  check('a genuine reply to one of our tickets is never dropped by the phishing filter', res.action === 'note', res);
})();
function helpRefOf(tok) { return helpRef(tok); }

print('');
print('The Block sender button (POST /admin/help/block)');
var jsonOut;
function json(o, status) { jsonOut = { body: o, status: status || 200 }; return jsonOut; }
function hq(body, email) {
  reset(); db.tickets.push({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ticket_no: 1027, brand: 'venueplay', status: 'new', subject: 'American Express | Non-Compliance Issues', contact_email: email });
  vpaRequireAdmin = async function () { return { label: 'Dean', actorId: 'adm1' }; };
  vpaBody = async function () { return { ok: true, body: body }; };
  return run(helpAdminBlock({}, ENV, json));
}
hq({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', scope: 'domain' }, 'donotreply_us@evil-amex.com');
var blk = inserted.filter(function (i) { return i.table === 'vp_help_blocklist'; })[0];
check('block by domain writes one domain row', blk && blk.row.kind === 'domain' && blk.row.value === 'evil-amex.com', blk);
check('the ticket is closed with closed_at set', patched.some(function (p) { return p.table === 'vp_help_tickets' && p.patch.status === 'closed' && !!p.patch.closed_at; }), patched);
check('a note says what was blocked', inserted.some(function (i) { return i.table === 'vp_help_ticket_notes' && /Blocked everything from @evil-amex\.com/.test(i.row.body); }));
check('nothing is emailed to the sender', sentMail.length === 0 && !inserted.some(function (i) { return i.table === 'vp_help_ticket_notes' && i.row.kind === 'reply'; }));
hq({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', scope: 'email' }, 'Donotreply_US@Evil-Amex.com');
blk = inserted.filter(function (i) { return i.table === 'vp_help_blocklist'; })[0];
check('block by address writes the address, lowercase', blk && blk.row.kind === 'email' && blk.row.value === 'donotreply_us@evil-amex.com', blk);
hq({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', scope: 'domain' }, 'jo@gmail.com');
check('blocking the whole of gmail.com is refused, nothing written, ticket left open',
      jsonOut.status === 400 && inserted.length === 0 && patched.length === 0, jsonOut);
hq({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', scope: 'email' }, 'jo@gmail.com');
check('blocking one gmail address is allowed', jsonOut.status === 200 && jsonOut.body.blocked === 'jo@gmail.com', jsonOut);
hq({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', scope: 'email' }, 'hello@send.venueplay.com.au');
check('our own addresses cannot be blocked', jsonOut.status === 400 && inserted.length === 0, jsonOut);
hq({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', scope: 'email' }, null);
check('a ticket with no email address cannot be blocked', jsonOut.status === 400, jsonOut);
reset(); db.tickets.push({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ticket_no: 1027, brand: 'venueplay', status: 'new', subject: 'x', contact_email: 'a@evil.io' });
tableThere = false; vpaBody = async function () { return { ok: true, body: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', scope: 'email' } }; };
run(helpAdminBlock({}, ENV, json));
check('before migration 184 it says so plainly and closes nothing', jsonOut.status === 503 && /migration 184/.test(jsonOut.body.error) && patched.length === 0, jsonOut);

print('');
if (fails) { print(fails + ' of ' + ran + ' checks FAILED'); throw new Error(fails + ' failed'); }
print('ALL ' + ran + ' CHECKS PASSED');
