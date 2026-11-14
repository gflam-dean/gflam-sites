/* HELP DESK ALERTS BY TEAM AND BY BRAND, run for real (Dean, 2 Nov 2026: "every different email
   needs its own notifications for different teams", then "split notifications by brand too").

   1. The kind AND the brand of an emailed ticket come from the address the customer wrote to. Every
      email reaches the Worker through a hello@ mailbox forward (envelope hello@help.<brand>), so the
      original To, then Cc, is read: To, Cc, mixed case, display names, a PartyPlay email that lands
      first on venueplay's help address, and a forged display name that must not count.
   2. Each device ticks kinds per brand. The device filter, the old saved words mapped across, the
      subscribe before and after migration 144, the HQ page's own lists equal to the Worker's.
   3. Each alert email goes to that team's own address on the ticket's brand; VP_HELP_ALERT_ROUTES
      overrides, bad JSON is ignored, X-VP-Help: alert is on every one.

   Runs the REAL venueplay-api-FULL.js on tools/rig-billing-worker.js (fake PostgREST, fake Resend).
   Run from the repo root:  jsc tools/test-help-alerts.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
var __rnd = 7;
var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { __rnd = (Math.imul(__rnd, 1103515245) + 12345) >>> 0; a[i] = (__rnd >>> 16) & 255; } return a; },
  subtle: { digest: function (alg, data) { var b = new Uint8Array(data), out = new Uint8Array(32), h = 2166136261;
      for (var r = 0; r < 32; r++) { for (var i = 0; i < b.length; i++) { h ^= b[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return Promise.resolve(out.buffer); },
    importKey: function () { return Promise.resolve({ fake: true }); },
    sign: function () { return Promise.resolve(new Uint8Array(64).buffer); } } };

/* The column's CHECK as the database holds it: 106 allowed all and urgent_sales, 137 adds bad_feedback,
   144 adds a comma list of ticks. MIG = which have been run. */
var MIG = { m137: false, m144: false }, pushes = [];
function filterAllowed(f) {
  if (f === 'all' || f === 'urgent_sales') return true;
  if (f === 'bad_feedback') return MIG.m137 || MIG.m144;
  return MIG.m144 && f.length <= 400 && /^(venueplay|partyplay):[a-z_]{3,20}(,(venueplay|partyplay):[a-z_]{3,20}){0,19}$/.test(f);
}
var realFetch = globalThis.fetch, clock = Date.parse('2026-11-02T00:00:00Z');
function NOW() { clock += 1000; return new Date(clock).toISOString(); }
helpNow = function () { return NOW(); };
globalThis.fetch = function (url, opts) {
  url = String(url); opts = opts || {};
  if (/^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com)\//.test(url)) {
    pushes.push(url);
    return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve(''); } });
  }
  if (/\/rest\/v1\/rpc\/vp_help_hit$/.test(url)) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(true); } });
  if (/\/rest\/v1\/vp_help_push_subs/.test(url) && (opts.method || 'GET') === 'POST') {
    var ps = JSON.parse(opts.body);
    if (!filterAllowed(ps.filter)) return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({ code: '23514' }); },
      text: function () { return Promise.resolve('{"code":"23514","message":"new row violates check constraint \\"vp_help_push_subs_filter_check\\""}'); } });
    if (!ps.last_peek_at) ps.last_peek_at = NOW();
    opts = Object.assign({}, opts, { body: JSON.stringify(ps) });
  }
  if (/\/rest\/v1\/vp_help_tickets/.test(url) && (opts.method || 'GET') === 'POST') {
    var o = JSON.parse(opts.body); o.created_at = o.created_at || NOW(); opts = Object.assign({}, opts, { body: JSON.stringify(o) });
  }
  return realFetch(url, opts);
};
var ADMIN = '60000000-0000-4000-8000-000000000009', OWNER = '60000000-0000-4000-8000-000000000001';
function hdr(h) { return { get: function (k) { var f = Object.keys(h).filter(function (x) { return x.toLowerCase() === String(k).toLowerCase(); })[0]; return f ? h[f] : ''; } }; }
function req(user, body) { var h = { 'cf-connecting-ip': '203.0.113.9' }; if (user) h.Authorization = 'Bearer ' + user;
  return { headers: hdr(h), text: function () { return Promise.resolve(JSON.stringify(body || {})); } }; }
function world() {
  DB = {}; sent.length = 0; pushes.length = 0; MIG.m137 = false; MIG.m144 = false;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, role: 'owner', label: 'Dean' }];
  DB.vp_venue_staff = [{ auth_user_id: OWNER, venue_id: 'v1', role: 'owner' }];
  DB.venueplay_founding = []; DB.vp_venues = []; DB.vp_help_tickets = []; DB.vp_help_ticket_notes = []; DB.vp_help_push_subs = [];
}
function mail(o) {
  return ['From: ' + (o.from || '"Jo Bloggs" <jo@example.com>')].concat(o.to === null ? [] : ['To: ' + (o.to || 'hello@venueplay.com.au')])
    .concat(o.cc ? ['Cc: ' + o.cc] : []).concat(['Subject: ' + (o.subject || 'A question'), 'Message-ID: ' + (o.mid || '<m@x>'),
    'Content-Type: text/plain; charset=utf-8', '', 'Hello there.']).join('\r\n');
}
async function inbound(to, raw, env) { return await helpInboundEmail({ to: to, from: 'bounce@srs.migadu.com', raw: raw }, env || ENV); }
function last() { return DB.vp_help_tickets[DB.vp_help_tickets.length - 1]; }
function H(o) { return helpParseEmail(mail(o)).headers; }

(async function () {
  /* The HQ page's own tick lists, run (its ALERT_ROWS to alertPreset block). */
  var hq = readFile('venueplay/app/vp-helpdesk-hq.js');
  var HQ = (new Function(hq.slice(hq.indexOf('  var ALERT_BRANDS'), hq.indexOf('  function setTicks')).replace(/catLabel\([^)]*\)/g, '""') +
    '; return { all: alertAllTicks(), preset: alertPreset };'))();
  function sameSet(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }
  print('1. THE ADDRESS THE CUSTOMER WROTE TO');
  var VPH = 'hello@help.venueplay.com.au', PPH = 'hello@help.partyplay.com.au';
  check('To: support@ through the hello@ feed is that address', helpOriginalAddress(VPH, H({ to: 'support@venueplay.com.au' })) === 'support@venueplay.com.au');
  check('To with a display name and mixed case', helpOriginalAddress(VPH, H({ to: '"VenuePlay Sales" <Sales@VenuePlay.com.au>' })) === 'sales@venueplay.com.au');
  check('Cc is read when To has no team address', helpOriginalAddress(VPH, H({ to: 'hello@venueplay.com.au', cc: 'Bob <bob@example.com>, Accounts <ACCOUNTS@venueplay.com.au>' })) === 'accounts@venueplay.com.au');
  check('To wins over Cc', helpOriginalAddress(VPH, H({ to: 'sales@venueplay.com.au', cc: 'accounts@venueplay.com.au' })) === 'sales@venueplay.com.au');
  check('several in To, a quoted comma in a name: the team address is found', helpOriginalAddress(VPH, H({ to: '"Smith, Jo" <jo@pub.com.au>, "Support, VP" <support@venueplay.com.au>' })) === 'support@venueplay.com.au');
  check('a display name that LOOKS like a team address does not count', helpOriginalAddress(VPH, H({ to: '"support@venueplay.com.au" <hello@venueplay.com.au>' })) === 'hello@venueplay.com.au');
  check('a look-alike domain does not count', helpOriginalAddress(VPH, H({ to: 'support@venueplay.com.au.evil.example, sales@xvenueplay.com.au' })) === VPH);
  check('a PartyPlay team address is that brand', helpOriginalAddress(VPH, H({ to: 'support@partyplay.com.au' })) === 'support@partyplay.com.au');
  check('PartyPlay hello@ arriving on venueplay\'s help address: PartyPlay, General', helpOriginalAddress(VPH, H({ to: 'hello@partyplay.com.au' })) === 'hello@partyplay.com.au');
  check('no To and no Cc: the envelope, unchanged', helpOriginalAddress(VPH, H({ to: null })) === VPH);
  check('an encoded name is decoded before the address is read', helpOriginalAddress(VPH, H({ to: '=?utf-8?Q?Caf=C3=A9_Sales?= <sales@venueplay.com.au>' })) === 'sales@venueplay.com.au');
  check('a direct envelope is left as it came, headers not read', helpOriginalAddress('accounts@help.venueplay.com.au', H({ to: 'sales@venueplay.com.au' })) === 'accounts@help.venueplay.com.au');
  check('a direct envelope keeps its case (a +secret is case-sensitive)', helpOriginalAddress('support+1042-AbCdEfGh12@help.venueplay.com.au', H({})) === 'support+1042-AbCdEfGh12@help.venueplay.com.au');

  world();
  await inbound(VPH, mail({ to: 'Support <support@venueplay.com.au>', mid: '<a1@x>' }));
  var t = last();
  check('an email to support@ through the hello@ feed is a venueplay Venue support ticket', t.brand === 'venueplay' && t.category === 'venue_support' && t.source_address === 'support@venueplay.com.au', t);
  await inbound(VPH, mail({ to: 'hello@venueplay.com.au', cc: 'ACCOUNTS@VENUEPLAY.COM.AU', mid: '<a2@x>' }));
  check('Cc accounts@ is Accounts', last().category === 'accounts', last());
  await inbound(VPH, mail({ to: 'hello@venueplay.com.au', mid: '<a3@x>' }));
  check('plain hello@ stays General', last().category === 'general' && last().brand === 'venueplay', last());
  await inbound(VPH, mail({ to: 'Pat <hello@partyplay.com.au>', mid: '<pp1@x>' }));
  check('the same PartyPlay email landing FIRST on venueplay\'s help address makes a PartyPlay ticket', last().brand === 'partyplay' && last().category === 'general', last());
  var n = DB.vp_help_tickets.length;
  var dup = await inbound(PPH, mail({ to: 'Pat <hello@partyplay.com.au>', mid: '<pp1@x>' }));
  check('its second copy, on PartyPlay\'s own help address, is a duplicate (Message-ID kept)', dup.action === 'duplicate' && DB.vp_help_tickets.length === n, dup);
  await inbound(PPH, mail({ to: 'hello@partyplay.com.au', mid: '<pp2@x>' }));
  await inbound(VPH, mail({ to: 'hello@partyplay.com.au', mid: '<pp2@x>' }));
  check('raced the other way round, the brand comes out the same', DB.vp_help_tickets.filter(function (x) { return x.email_message_id === '<pp2@x>'; }).map(function (x) { return x.brand; }).join() === 'partyplay');
  await inbound(PPH, mail({ to: 'sales@partyplay.com.au', mid: '<pp3@x>' }));
  check('PartyPlay sales@ copied into PartyPlay hello@ is PartyPlay Sales', last().brand === 'partyplay' && last().category === 'sales', last());
  await inbound('sales@help.venueplay.com.au', mail({ to: 'hello@venueplay.com.au', mid: '<d1@x>' }));
  check('a direct envelope to sales@help keeps working as before', last().category === 'sales' && last().source_address === 'sales@venueplay.com.au', last());
  var ig = await inbound(VPH, mail({ to: 'support@venueplay.com.au', mid: '<al@x>', from: 'Help Desk <hello@send.venueplay.com.au>' }));
  check('our own alert copied round to hello@ is still ignored', ig.action === 'ignored', ig);

  print('2. WHICH TICKETS BUZZ WHICH DEVICE');
  var TK = {
    vpVenue: { brand: 'venueplay', category: 'venue_support', priority: 'normal' },
    vpPlayer: { brand: 'venueplay', category: 'patron_support', priority: 'normal' },
    vpAcc: { brand: 'venueplay', category: 'accounts', priority: 'normal' },
    vpSales: { brand: 'venueplay', category: 'sales', priority: 'normal' },
    vpGen: { brand: 'venueplay', category: 'general', priority: 'normal' },
    vpUrgent: { brand: 'venueplay', category: 'venue_support', priority: 'urgent' },
    vpBad: { brand: 'venueplay', category: 'patron_support', priority: 'normal', bad_feedback: true },
    ppHost: { brand: 'partyplay', category: 'venue_support', priority: 'normal' },
    ppGuest: { brand: 'partyplay', category: 'patron_support', priority: 'normal' },
    ppSales: { brand: 'partyplay', category: 'sales', priority: 'normal' },
    ppUrgent: { brand: 'partyplay', category: 'general', priority: 'urgent' },
  };
  function wants(f) { return Object.keys(TK).filter(function (k) { return helpPushWants({ filter: f }, TK[k]); }).join(); }
  check('"all" (every device saved before today) gets every ticket', wants('all') === Object.keys(TK).join(), wants('all'));
  check('an empty or missing filter gets every ticket (never no alerts)', wants('') === Object.keys(TK).join() && wants(null) === Object.keys(TK).join());
  check('"urgent_sales" maps to urgent and sales on both brands, and bad player feedback', wants('urgent_sales') === 'vpSales,vpUrgent,vpBad,ppSales,ppUrgent', wants('urgent_sales'));
  check('"bad_feedback" is bad player feedback only', wants('bad_feedback') === 'vpBad', wants('bad_feedback'));
  check('PartyPlay support only: host and guest support on PartyPlay, nothing venueplay', wants('partyplay:venue_support,partyplay:patron_support') === 'ppHost,ppGuest', wants('partyplay:venue_support,partyplay:patron_support'));
  check('venueplay accounts only', wants('venueplay:accounts') === 'vpAcc', wants('venueplay:accounts'));
  check('urgent ones always, per brand: venueplay urgent does not wake a PartyPlay-only device', wants('partyplay:sales,partyplay:urgent') === 'ppSales,ppUrgent', wants('partyplay:sales,partyplay:urgent'));
  check('an urgent ticket of an unticked kind still buzzes when Urgent is ticked', wants('venueplay:general,venueplay:urgent') === 'vpGen,vpUrgent', wants('venueplay:general,venueplay:urgent'));
  check('bad player feedback is its own tick: Player support alone does not take it', wants('venueplay:patron_support') === 'vpPlayer', wants('venueplay:patron_support'));
  check('ticks in mixed case and with spaces still read', wants(' VenuePlay:Sales , partyplay:SALES ') === 'vpSales,ppSales', wants(' VenuePlay:Sales , partyplay:SALES '));
  check('a list of nothing this desk knows reads as every ticket', wants('rubbish,venueplay:nope') === Object.keys(TK).join());
  check('the "Not for me" alert ticket (its raised_by) is bad feedback, and a Player support device without the tick does not get it',
    helpPushWants({ filter: 'bad_feedback' }, { brand: 'venueplay', category: 'general', raised_by: 'automatic (player feedback)' }) &&
    !helpPushWants({ filter: 'venueplay:general' }, { brand: 'venueplay', category: 'general', raised_by: 'automatic (player feedback)' }));
  var wk = readFile('venueplay-backend/worker/venueplay-api-FULL.js'), vpf = /const VPF_ALERT_BY = '([^']+)'/.exec(wk);
  check('the raised_by it reads is the feedback alert\'s own (when that work is in this file)', !vpf || vpf[1] === 'automatic (player feedback)', vpf && vpf[1]);

  print('   what is stored');
  check('every tick stores "all"', helpAlertFilter(helpAlertSet('all').slice()) === 'all');
  check('the urgent-and-sales ticks store "urgent_sales", in any order', helpAlertFilter(['partyplay:urgent', 'venueplay:bad_feedback', 'venueplay:sales', 'partyplay:sales', 'venueplay:urgent']) === 'urgent_sales');
  check('bad feedback alone stores "bad_feedback"', helpAlertFilter(['venueplay:bad_feedback']) === 'bad_feedback');
  check('anything else stores a comma list in one fixed order', helpAlertFilter(['partyplay:patron_support', 'venueplay:accounts']) === 'venueplay:accounts,partyplay:patron_support', helpAlertFilter(['partyplay:patron_support', 'venueplay:accounts']));
  check('nothing ticked, or ticks nobody offers, store "all"', helpAlertFilter([]) === 'all' && helpAlertFilter(['x:y']) === 'all' && helpAlertFilter('everything-please') === 'all');
  check('the old words store as themselves', helpAlertFilter('all') === 'all' && helpAlertFilter('urgent_sales') === 'urgent_sales' && helpAlertFilter('bad_feedback') === 'bad_feedback');
  check('the longest list fits the migration\'s 400 characters and its pattern', (function () { var l = helpAlertSet('all').slice(0, -1).join(','); MIG.m144 = true; var okk = filterAllowed(l); MIG.m144 = false; return okk && l.length <= 400; })());

  print('   subscribe, before and after migration 144');
  world();
  var EP = 'https://fcm.googleapis.com/fcm/send/dev-1';
  async function sub(body) { try { return await helpAdminPushSubscribe(req(ADMIN, Object.assign({ endpoint: EP }, body)), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e) } }; } }
  var r1 = await sub({ ticks: ['partyplay:venue_support', 'partyplay:patron_support'] });
  check('before 144: a team choice keeps the device on every ticket, one row, and says why', r1.body.ok && r1.body.filter === 'all' && DB.vp_help_push_subs.length === 1 && DB.vp_help_push_subs[0].filter === 'all' && /needs migration 144/.test(r1.body.note || ''), r1.body);
  check('and hands HQ back the ticks it really has (all of them)', r1.body.ticks && r1.body.ticks.length === helpAlertSet('all').length, r1.body.ticks);
  var r1b = await sub({ ticks: HQ.preset('urgent_sales') });
  check('before 144: the urgent-and-sales ticks store as "urgent_sales", no note', r1b.body.filter === 'urgent_sales' && !r1b.body.note && DB.vp_help_push_subs[0].filter === 'urgent_sales', r1b.body);
  var r1c = await sub({ filter: 'bad_feedback' });
  check('before 137 and 144: "Only bad player feedback" keeps every ticket and names 137', r1c.body.filter === 'all' && /needs migration 137/.test(r1c.body.note || ''), r1c.body);
  MIG.m144 = true;
  var r2 = await sub({ ticks: ['partyplay:venue_support', 'partyplay:patron_support'] });
  check('after 144: stored as the list, one row for the device, no note', r2.body.filter === 'partyplay:venue_support,partyplay:patron_support' && DB.vp_help_push_subs.length === 1 && DB.vp_help_push_subs[0].filter === r2.body.filter && !r2.body.note, r2.body);
  pushes.length = 0;
  var PENV = Object.assign({}, ENV, { VAPID_PUBLIC_KEY: 'BPub', VAPID_PRIVATE_JWK: JSON.stringify({ d: 'd', x: 'x', y: 'y' }) });
  await helpPushNew(PENV, { ticket_no: 1, brand: 'venueplay', category: 'venue_support', priority: 'normal' });
  await helpPushNew(PENV, { ticket_no: 2, brand: 'partyplay', category: 'venue_support', priority: 'normal' });
  check('a PartyPlay-support device is buzzed for the PartyPlay host ticket only', pushes.length === 1 && pushes[0] === EP, pushes);
  var mine = await helpAdminPushMine(req(ADMIN, { endpoint: EP }), ENV, J);
  check('HQ reads this device\'s ticks back', mine.body.on === true && mine.body.ticks.join() === 'partyplay:venue_support,partyplay:patron_support', mine.body);
  DB.vp_help_push_subs[0].filter = 'urgent_sales';
  mine = await helpAdminPushMine(req(ADMIN, { endpoint: EP }), ENV, J);
  check('an old "urgent_sales" device reads back as its ticks', mine.body.ticks.slice().sort().join() === 'partyplay:sales,partyplay:urgent,venueplay:bad_feedback,venueplay:sales,venueplay:urgent', mine.body);
  check('a device with no alerts reads as off, every tick offered', (await helpAdminPushMine(req(ADMIN, { endpoint: 'https://fcm.googleapis.com/fcm/send/none' }), ENV, J)).body.on === false);
  check('a venue owner cannot read a device\'s alerts', (await helpAdminPushMine(req(OWNER, { endpoint: EP }), ENV, J)).status === 403);
  check('the route is wired, HQ only', /path === '\/admin\/help\/push\/mine'\)\s+return await helpAdminPushMine/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')));

  print('   the HQ page offers the same ticks the Worker knows');
  check('every tick on the page is one the Worker knows, and none is missing', sameSet(HQ.all, helpAlertSet('all')), [HQ.all, helpAlertSet('all')]);
  check('the page\'s "Only urgent ones and sales" and "Only bad player feedback" are the Worker\'s sets', sameSet(HQ.preset('urgent_sales'), helpAlertSet('urgent_sales')) && sameSet(HQ.preset('bad_feedback'), helpAlertSet('bad_feedback')));
  check('the page sends ticks, not the old radio choice', /post\("\/admin\/help\/push\/subscribe", \{ endpoint: sub\.endpoint, ticks: ticks/.test(hq) && !/name="hdaF"/.test(hq));
  check('two columns, venueplay and PartyPlay', /data-hda-brand="' \+ b \+ '"/.test(hq) && /grid-template-columns:1fr 1fr/.test(hq));
  check('the old words are still offered as quick picks', /value="all">Every ticket/.test(hq) && /value="urgent_sales">/.test(hq) && /value="bad_feedback"> Only bad player feedback/.test(hq));

  print('3. EACH TEAM\'S OWN ALERT EMAIL');
  function to(brand, cat, env) { return helpAlertTo(env || ENV, { brand: brand, category: cat }); }
  check('venueplay: accounts, sales, both supports, general to their own mailboxes',
    to('venueplay', 'accounts') === 'accounts@venueplay.com.au' && to('venueplay', 'sales') === 'sales@venueplay.com.au' &&
    to('venueplay', 'venue_support') === 'support@venueplay.com.au' && to('venueplay', 'patron_support') === 'support@venueplay.com.au' && to('venueplay', 'general') === 'hello@venueplay.com.au');
  check('PartyPlay: support to support@, and accounts and sales to PartyPlay hello@ (it has only hello@ and support@)',
    to('partyplay', 'venue_support') === 'support@partyplay.com.au' && to('partyplay', 'patron_support') === 'support@partyplay.com.au' &&
    to('partyplay', 'accounts') === 'hello@partyplay.com.au' && to('partyplay', 'sales') === 'hello@partyplay.com.au' && to('partyplay', 'general') === 'hello@partyplay.com.au');
  check('VP_HELP_ALERT_EMAIL no longer sends every alert to one place', to('venueplay', 'sales', Object.assign({}, ENV, { VP_HELP_ALERT_EMAIL: 'one@venueplay.com.au', VP_INTERNAL_EMAIL: 'two@venueplay.com.au' })) === 'sales@venueplay.com.au');
  var RENV = Object.assign({}, ENV, { VP_HELP_ALERT_ROUTES: JSON.stringify({ sales: 'Dean@Gflam.com.au', 'partyplay:sales': 'pp-sales@partyplay.com.au', general: 'not an address', accounts: 42 }) });
  check('VP_HELP_ALERT_ROUTES: a kind overrides on both brands', to('venueplay', 'sales', RENV) === 'dean@gflam.com.au');
  check('VP_HELP_ALERT_ROUTES: a brand and kind wins over the kind', to('partyplay', 'sales', RENV) === 'pp-sales@partyplay.com.au');
  check('VP_HELP_ALERT_ROUTES: a value that is not an address is ignored', to('venueplay', 'general', RENV) === 'hello@venueplay.com.au' && to('venueplay', 'accounts', RENV) === 'accounts@venueplay.com.au');
  check('VP_HELP_ALERT_ROUTES: bad JSON is ignored, the default stands', to('venueplay', 'sales', Object.assign({}, ENV, { VP_HELP_ALERT_ROUTES: '{sales: dean@' })) === 'sales@venueplay.com.au' &&
    to('venueplay', 'sales', Object.assign({}, ENV, { VP_HELP_ALERT_ROUTES: '["a@b.com"]' })) === 'sales@venueplay.com.au');

  world();
  await inbound(PPH, mail({ to: 'support@partyplay.com.au', mid: '<e1@x>' }));
  await inbound(VPH, mail({ to: 'accounts@venueplay.com.au', mid: '<e2@x>' }));
  var alerts = sent.filter(function (m) { return m.headers && m.headers['X-VP-Help'] === 'alert'; });
  check('a PartyPlay support email alerts PartyPlay support@, subject starting PartyPlay, from PartyPlay', alerts[0] && alerts[0].to.join() === 'support@partyplay.com.au' && /^PartyPlay \u00b7 Action needed: Host support \[#/.test(alerts[0].subject) && /@send\.partyplay\.com\.au>$/.test(alerts[0].from), alerts[0]);
  check('a venueplay accounts email alerts accounts@, subject starting venueplay', alerts[1] && alerts[1].to.join() === 'accounts@venueplay.com.au' && /^venueplay \u00b7 Action needed: Accounts \[#/.test(alerts[1].subject), alerts[1]);
  check('every alert email carries X-VP-Help: alert, and goes to nobody else', alerts.length === 2 && sent.filter(function (m) { return /^\[(venueplay|PartyPlay)\]/.test(m.subject); }).every(function (m) { return m.headers['X-VP-Help'] === 'alert' && m.to.length === 1; }), sent.map(function (m) { return [m.to, m.subject, m.headers]; }));
  var back = await inbound(VPH, ['From: venueplay Help Desk <hello@send.venueplay.com.au>', 'To: accounts@venueplay.com.au', 'X-VP-Help: alert', 'Subject: ' + alerts[1].subject, 'Message-ID: <back@x>', '', 'x'].join('\r\n'));
  check('that alert, copied from accounts@ into hello@ and back in, never makes a ticket', back.action === 'ignored', back);

  print('4. PARTYPLAY MAIL GOES VIA PARTYPLAY (Dean, 2 Nov 2026: "return mail has to go via partyplay")');
  function fromFor(c, b) { var f = helpFromFor(c, b); return f.from.replace(/^.*</, '').replace('>', '') + ' / ' + f.reply_to; }
  check('PartyPlay accounts and sales answer from hello@send.partyplay.com.au, Reply-To hello@partyplay.com.au (it has no accounts@ that threads back)',
    fromFor('accounts', 'partyplay') === 'hello@send.partyplay.com.au / hello@partyplay.com.au' && fromFor('sales', 'partyplay') === 'hello@send.partyplay.com.au / hello@partyplay.com.au', [fromFor('accounts', 'partyplay'), fromFor('sales', 'partyplay')]);
  check('PartyPlay support answers from support@send.partyplay.com.au, General from hello@',
    fromFor('venue_support', 'partyplay') === 'support@send.partyplay.com.au / support@partyplay.com.au' && fromFor('patron_support', 'partyplay') === 'support@send.partyplay.com.au / support@partyplay.com.au' &&
    fromFor('general', 'partyplay') === 'hello@send.partyplay.com.au / hello@partyplay.com.au');
  check('venueplay accounts still answers from accounts@', fromFor('accounts', 'venueplay') === 'accounts@send.venueplay.com.au / accounts@venueplay.com.au');
  world();
  await inbound(VPH, mail({ to: 'Accounts <accounts@partyplay.com.au>', from: 'Pat <pat@example.com>', mid: '<ppa@x>' }));
  var ppt = last();
  check('a PartyPlay accounts email landing on venueplay\'s help address is a PartyPlay Accounts ticket', ppt.brand === 'partyplay' && ppt.category === 'accounts', ppt);
  sent.length = 0;
  var rp = await helpAdminReply(req(ADMIN, { id: ppt.id, body: 'All sorted, thanks.' }), ENV, J);
  var out = sent.filter(function (m) { return m.to.join() === 'pat@example.com'; });
  check('HQ\'s reply on it goes from hello@send.partyplay.com.au with Reply-To hello@partyplay.com.au', rp.status === 200 && out.length === 1 && /<hello@send\.partyplay\.com\.au>$/.test(out[0].from) && out[0].reply_to === 'hello@partyplay.com.au', [rp.body, out.map(function (m) { return [m.from, m.reply_to]; })]);
  world();
  await inbound(VPH, mail({ to: 'hello@partyplay.com.au', from: 'Pat <pat@example.com>', mid: '<ppb@x>' }));
  await inbound(PPH, mail({ to: 'support@partyplay.com.au', from: 'Lee <lee@example.com>', mid: '<ppc@x>' }));
  await inbound(VPH, mail({ to: 'sales@partyplay.com.au', from: 'Kim <kim@example.com>', mid: '<ppd@x>' }));
  check('three PartyPlay tickets made', DB.vp_help_tickets.length === 3 && DB.vp_help_tickets.every(function (t) { return t.brand === 'partyplay'; }), DB.vp_help_tickets.map(function (t) { return t.brand; }));
  check('every email for a PartyPlay ticket (alerts and acknowledgements) goes from the partyplay send domain, never venueplay',
    sent.length >= 6 && sent.every(function (m) { return /@send\.partyplay\.com\.au>$/.test(m.from) && !/venueplay/i.test(m.from + ' ' + (m.reply_to || '')); }), sent.map(function (m) { return [m.from, m.reply_to, m.subject]; }));
  check('and every PartyPlay alert subject starts PartyPlay (the staff subject, 6 Nov 2026: "PartyPlay \u00b7 Action needed: ...")', sent.filter(function (m) { return m.headers && m.headers['X-VP-Help'] === 'alert'; }).every(function (m) { return /^PartyPlay \u00b7 (Action needed|Urgent|FYI): /.test(m.subject); }) &&
    sent.filter(function (m) { return m.headers && m.headers['X-VP-Help'] === 'alert'; }).length === 3);

  print('5. AUTOMATED MAIL TO hello@ OPENS NO TICKET (reports, service notices), A REMITTANCE IS FILED CLOSED');
  function why(o) { return helpIgnoreEmail(helpParseEmail(mail(o))); }
  function rawWhy(lines) { return helpIgnoreEmail(helpParseEmail(lines.join('\r\n'))); }
  check('a Google DMARC aggregate report (its sender) is ignored', why({ from: 'noreply-dmarc-support@google.com', subject: 'Report domain: venueplay.com.au Submitter: google.com Report-ID: 1234' }) !== '');
  check('a DMARC report from any dmarc@ sender is ignored', why({ from: 'dmarcreport@microsoft.com', subject: 'Report Domain: venueplay.com.au Submitter: protection.outlook.com Report-ID: <a1>' }) === 'a DMARC report');
  check('a "Report domain:" subject is a DMARC report whoever sent it', why({ from: 'reports@mail.yahoo.com', subject: 'Report Domain: partyplay.com.au' }) === 'a DMARC report');
  check('"Submitter: ... Report-ID:" is a DMARC report', why({ from: 'rua@example.net', subject: 'Submitter: example.net Report-ID: 99' }) === 'a DMARC report');
  check('a delivery or feedback report (multipart/report) is ignored', rawWhy(['From: abuse@isp.example', 'To: hello@venueplay.com.au', 'Subject: Delivery Status Notification', 'Message-ID: <r@x>',
    'Content-Type: multipart/report; report-type=delivery-status; boundary="b"', '', '--b', 'Content-Type: text/plain', '', 'x', '--b--']) === 'an automatic report');
  check('no-reply senders in their many spellings are ignored', ['no-reply@accounts.google.com', 'noreply-billing@resend.com', 'no_reply@migadu.com', 'do-not-reply@instantly.ai', 'donotreply@bank.example', 'no.reply@x.example']
    .every(function (f) { return why({ from: f }) !== ''; }), ['no-reply@accounts.google.com', 'noreply-billing@resend.com', 'no_reply@migadu.com', 'do-not-reply@instantly.ai', 'donotreply@bank.example', 'no.reply@x.example'].map(function (f) { return [f, why({ from: f })]; }));
  check('service notices from Stripe, Resend, Google, Meta, Instantly and Migadu are ignored', ['notifications@stripe.com', 'notifications@resend.com', 'security@accounts.google.com', 'notification@facebookmail.com', 'alerts@instantly.ai', 'notifications@migadu.com']
    .every(function (f) { return why({ from: 'Service <' + f + '>' }) === 'a service notice'; }));
  check('a REAL PERSON is never dropped: a person at Stripe, a pub\'s own notifications@, a dmarc question in a subject, a gmail sender',
    why({ from: 'Ana from Stripe <ana@stripe.com>' }) === '' && why({ from: 'support@stripe.com' }) === '' && why({ from: 'notifications@royalhotel.com.au' }) === '' &&
    why({ from: 'jo@gmail.com', subject: 'Question about our DMARC report' }) === '' && why({ from: 'jo@gmail.com', subject: 'Can you report on my domain please' }) === '' &&
    why({ from: 'reply@pub.com.au' }) === '' && why({ from: 'Noreen <noreen@pub.com.au>' }) === '');
  world();
  var dm = await inbound(VPH, mail({ from: 'noreply-dmarc-support@google.com', subject: 'Report domain: venueplay.com.au Submitter: google.com Report-ID: 77', mid: '<dm@x>' }));
  check('a DMARC report through the hello@ feed opens no ticket and sends nothing', dm.action === 'ignored' && DB.vp_help_tickets.length === 0 && sent.length === 0, dm);
  var rm = await inbound(VPH, mail({ from: 'Accounts Payable <ap@bigclub.com.au>', to: 'hello@venueplay.com.au', subject: 'Remittance Advice 4471', mid: '<rm@x>' }));
  var rt = last();
  check('a remittance is filed as Accounts, already closed', rm.action === 'filed' && rt && rt.category === 'accounts' && rt.status === 'closed' && !!rt.closed_at, [rm, rt]);
  check('with no alert and no acknowledgement', sent.length === 0, sent.map(function (m) { return [m.to, m.subject]; }));
  await inbound(PPH, mail({ from: 'ap@party.example', to: 'support@partyplay.com.au', subject: 'Payment advice for invoice 12', mid: '<rm2@x>' }));
  check('"payment advice" is filed the same, on its own brand', last().category === 'accounts' && last().status === 'closed' && last().brand === 'partyplay' && sent.length === 0, last());
  await inbound(VPH, mail({ from: 'ap@bigclub.com.au', to: 'accounts@venueplay.com.au', subject: 'Question about our last invoice', mid: '<rm3@x>' }));
  check('an ordinary accounts question still opens a ticket that needs a reply, with its alert', last().status === 'new' && last().category === 'accounts' && sent.some(function (m) { return m.headers && m.headers['X-VP-Help'] === 'alert'; }), last());

  print('\n' + (fails ? fails + ' OF ' + ran + ' CHECKS FAILED' : 'ALL ' + ran + ' CHECKS PASSED'));   // the one pass judge's words (tools/passwording.py)
  if (fails) throw new Error(fails + ' failed');
})().catch(function (e) { print('THREW ' + (e && e.stack || e)); throw e; });
