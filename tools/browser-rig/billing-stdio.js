/* THE REAL BILLING WORKER, ANSWERING ON A PIPE (tools/logo-tools-in-chrome.test.py,
   tools/dropdowns-in-chrome.test.py).

   Loads the real venueplay-api-FULL.js through tools/rig-billing-worker.js (only the network,
   Stripe, Resend and the database are fakes), then reads one request per line on stdin as JSON
   {method, path, body, headers}, sends it through the Worker's OWN fetch handler and router, and
   prints one JSON line {status, body}. So when the real Your account page in Chrome saves a logo,
   the bytes are judged by the real vpbLogoUpload, not by a stand-in that might agree with the page.

   A signed-in user is whatever the page's Bearer token says (the fake supabase-js hands out
   "fake-token" for the test's one login, mapped to UID below). Storage uploads are recorded in
   STORED so the test can ask what was written.

   Run by the tests, from the repo root:  jsc tools/browser-rig/billing-stdio.js */
load('tools/rig-billing-worker.js');
var UID = '11111111-1111-4111-8111-111111111111';
var VENUE = '22222222-2222-4222-8222-222222222222', VENUE2 = '22222222-2222-4222-8222-222222222223';
vpaVerifyJWT = async function (t) { return t === 'fake-token' ? { sub: UID, email: 'owner@test.local' } : null; };

function Response(body, init) { this._b = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; }
function URL(u) { var m = /^https?:\/\/[^\/]+([^?#]*)(\?[^#]*)?/.exec(u) || []; this.pathname = m[1] || '/'; this.search = m[2] || '';
  var sp = {}; (this.search.slice(1)).split('&').filter(Boolean).forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(i < 0 ? p : p.slice(0, i))] = i < 0 ? '' : decodeURIComponent(p.slice(i + 1)); });
  this.searchParams = { get: function (k) { return sp[k] == null ? null : sp[k]; }, has: function (k) { return k in sp; } }; }

DB = {};
DB.vp_platform_admins = [];
DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@test.local', contact_name: 'Olive Owner', venue_name: 'Deepwater Hotel', plan: 'monthly', status: 'card_on_file',
                           max_seats: 80, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', created_at: '2026-09-01T00:00:00Z' }];
DB.vp_venues = [{ id: VENUE, name: 'Deepwater Hotel', slug: 'deepwater-hotel', founding_id: 'f1', status: 'active', max_players: 80, au_state: 'NSW', postcode: '2371',
                  created_at: '2026-09-01T00:00:00Z', timezone: 'Australia/Sydney', join_code: 'DPW123', show_logo_on_site: false },
                { id: VENUE2, name: 'The Royal Arms', slug: 'the-royal-arms', founding_id: 'f1', status: 'active', max_players: 60, au_state: 'NSW', postcode: '2000',
                  created_at: '2026-09-02T00:00:00Z', timezone: 'Australia/Sydney', join_code: 'RYL456', show_logo_on_site: false }];
DB.vp_venue_staff = [{ id: 's1', auth_user_id: UID, venue_id: VENUE, role: 'owner', permissions: null, display_name: 'Olive Owner' },
                     { id: 's2', auth_user_id: UID, venue_id: VENUE2, role: 'owner', permissions: null, display_name: 'Olive Owner' }];
DB.vp_venue_screen = []; DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = [];
DB.vp_raffle_settings = []; DB.vp_raffle_prizes = []; DB.vp_member_draws = []; DB.vp_sessions = [];

/* jsc has no WebCrypto. The Worker names a stored logo by the SHA-256 of its bytes; a stand-in digest
   that is a pure function of the bytes keeps "same file, same address" true, which is all a page needs. */
if (typeof crypto === 'undefined') {
  crypto = { subtle: { digest: function (alg, bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), out = new Uint8Array(32), h = 2166136261 >>> 0;
    for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; out[i % 32] ^= h & 255; }
    return Promise.resolve(out.buffer);
  } }, getRandomValues: (function () { var n = 0; return function (a) { n++; for (var i = 0; i < a.length; i++) a[i] = (i * 2654435761 + n * 40503) & 255; return a; }; })() };   // different bytes each call, so two sign-in links differ
}
/* 29 Oct 2026: the invite-back email (HQ "Reactivate") is marketing and must carry a one-click
   unsubscribe, so the Worker refuses to send it when VP_UNSUB_SECRET is unset. The live Worker has
   the secret (set 29 Oct); this rig's Worker must too, the same way tools/test-audit-search.js does. */
ENV.VP_UNSUB_SECRET = 'billing-rig-test-secret';
load('partyplay-backend/worker/_test-sha256.js');   // a real HMAC for the unsubscribe token
if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = function () { this.encode = function (s) { return { _s: String(s) }; }; };
if (!crypto.subtle.importKey) crypto.subtle.importKey = function (fmt, k) { return Promise.resolve({ _k: (k && k._s != null) ? k._s : String.fromCharCode.apply(null, Array.prototype.slice.call(k || [])) }); };   // raw bytes too (the no-card start signs its SMS hook call with a base64 secret)
if (!crypto.subtle.sign) crypto.subtle.sign = function (alg, key, msg) { return Promise.resolve(new Uint8Array(SHA.hmac(key._k, msg._s)).buffer); };
/* crypto.randomUUID is on Cloudflare and not in jsc: the What's on save names a new event with it (INBOX 110). */
if (!crypto.randomUUID) { var _uu = 0; crypto.randomUUID = function () { _uu++; var h = ('00000000' + (_uu * 2654435761 >>> 0).toString(16)).slice(-8); return h + '-0000-4000-8000-' + ('000000000000' + _uu).slice(-12); }; }
var STORED = [], TEXTS = [];
/* A TABLE THAT IS NOT THERE YET (29 Oct 2026, tools/helpdesk-hq-in-chrome.test.py): {ask:'missing', table, on}
   makes every request to it answer the way live PostgREST answered for vp_help_saved_replies before
   migration 126 (read-only check, 29 Oct 2026): 404, code PGRST205. The fake database would otherwise
   make any table it is asked for, so "before the migration" could never be seen in a browser. */
/* vp_host_updates_optin (migration 164, NOT RUN on 5 Nov 2026) starts missing, as it is live, so the
   console's product-updates card (vp-updates-optin.js) stays away from every Chrome suite written before it;
   {ask:'missing', table:'vp_host_updates_optin', on:false} brings it in. */
var MISSING = { vp_host_updates_optin: true };
var _rf = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  /* THE ONE-OFF SIGN-IN LINK, end to end in Chrome (29 Oct 2026): Auth's generate_link answers with a hashed
     token (it sends nothing), and the link's one conditional PATCH hands back the row it marked, as
     PostgREST does when asked for return=representation. */
  if (/\/auth\/v1\/admin\/generate_link/.test(u)) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ hashed_token: 'rig-hashed-token', verification_type: 'magiclink' }); } });
  }
  if (/\/rest\/v1\/vp_signin_links\?/.test(u) && m === 'PATCH' && /return=representation/.test(((opts && opts.headers) || {}).Prefer || '')) {
    var q = parseQ(u.split('?')[1] || ''), set = JSON.parse(opts.body), got = [];
    tbl('vp_signin_links').forEach(function (r) { if (match(r, q)) { for (var k in set) r[k] = set[k]; got.push({ auth_user_id: r.auth_user_id, venue_id: r.venue_id }); } });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(got); } });
  }
  /* THE NO-CARD START (6 Nov 2026, tools/signup-start-in-chrome.test.py). Its code goes out through the SMS hook, which
     this rig takes and keeps ({ask:'texts'}), never sends. Its one-request-wins claim is a conditional PATCH asking for
     return=representation, answered with the rows it changed, as PostgREST does. Auth's user list is paged as Auth
     pages it (page from 1, per_page), because the start's strict search reads to an EMPTY page. */
  if (u.indexOf('sms-hook.rig') !== -1) {
    TEXTS.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } });
  }
  /* Every new venue gets its join code from the database (migration 91's trigger); the TV code on the start's done screen
     reads it. The rig's database has no trigger, so it is given here, the same shape. */
  if (m === 'POST' && /\/rest\/v1\/vp_venues$/.test(u)) {
    var vb0 = JSON.parse(opts.body);
    if (vb0 && !Array.isArray(vb0) && !vb0.join_code) { vb0.join_code = 'RG' + ('0000' + (tbl('vp_venues').length + 1)).slice(-4); opts = Object.assign({}, opts, { body: JSON.stringify(vb0) }); }
  }
  if (/\/rest\/v1\/vp_signup_starts\?/.test(u) && m === 'PATCH' && /return=representation/.test(((opts && opts.headers) || {}).Prefer || '')) {
    var sq = parseQ(u.split('?')[1] || ''), sset = JSON.parse(opts.body), sgot = [];
    tbl('vp_signup_starts').forEach(function (r) { if (match(r, sq)) { for (var k in sset) r[k] = sset[k]; sgot.push({ id: r.id }); } });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(sgot); } });
  }
  if (m === 'POST' && /\/auth\/v1\/admin\/users$/.test(u)) {
    var nb0 = JSON.parse(opts.body), ph0 = nb0.phone ? String(nb0.phone).replace('+', '') : '', em0 = String(nb0.email || '').toLowerCase();
    var clash = tbl('auth').filter(function (x) { return (ph0 && x.phone === ph0) || (em0 && x.email === em0); })[0];
    if (clash) return Promise.resolve({ ok: false, status: 422, json: function () { return Promise.resolve({ msg: 'already registered', error_code: ph0 && clash.phone === ph0 ? 'phone_exists' : 'email_exists' }); } });
    var nu0 = { id: newId(), phone: ph0, email: em0 }; tbl('auth').push(nu0);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(nu0); } });
  }
  if (m === 'GET' && /\/auth\/v1\/admin\/users\?/.test(u)) {
    var pg = /[?&]page=(\d+)/.exec(u), pp = /[?&]per_page=(\d+)/.exec(u), per = pp ? +pp[1] : 50, from = ((pg ? +pg[1] : 1) - 1) * per;
    var ul = tbl('auth').slice(from, from + per);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ users: ul }); } });
  }
  var mt = /\/rest\/v1\/([a-z_]+)/.exec(u);
  if (mt && MISSING[mt[1]]) {
    var nb = JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public." + mt[1] + "' in the schema cache" });
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve(JSON.parse(nb)); }, text: function () { return Promise.resolve(nb); } });
  }
  if (/\/storage\/v1\//.test(u)) {
    if (m === 'POST' && /\/storage\/v1\/object\//.test(u)) {
      var b = opts.body, n = b && (b.length || b.byteLength) || 0, head = [];
      for (var i = 0; i < Math.min(32, n); i++) head.push(b[i]);
      STORED.push({ path: u.split('/storage/v1/object/')[1], bytes: n, type: (opts.headers || {})['Content-Type'] || '', head: head });
    }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } });
  }
  /* A COLUMN THE DATABASE DOES NOT HAVE YET (24 Oct 2026, multi-raffle): a read or write naming a column
     in REFUSE answers PostgREST's 400, so a page can be driven as it is before a migration has run. */
  var refused = REFUSE.filter(function (c) { return /\/rest\/v1\//.test(u) && (new RegExp('select=[^&]*\\b' + c + '\\b').test(u) || (m !== 'GET' && new RegExp('"' + c + '"').test(String((opts && opts.body) || '')))); });
  if (refused.length) {
    var msg = JSON.stringify({ message: 'column ' + refused[0] + ' does not exist' });
    return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve(JSON.parse(msg)); }, text: function () { return Promise.resolve(msg); } });
  }
  /* THE SCREEN ROW IS AN UPSERT ON venue_id (resolution=merge-duplicates): merge it, as PostgREST does.
     The rig's fake database appends every POST, which left a page reading back the venue's FIRST row. */
  if (m === 'POST' && /\/rest\/v1\/vp_venue_screen(\?|$)/.test(u)) {
    var row = JSON.parse(String(opts.body || '{}')), rows = DB.vp_venue_screen || (DB.vp_venue_screen = []);
    var have = rows.filter(function (x) { return x.venue_id === row.venue_id; })[0];
    if (have) { for (var k in row) have[k] = row[k]; } else rows.push(row);
    return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve(''); } });
  }
  return _rf(url, opts);
};
var REFUSE = [];

print(JSON.stringify({ ready: true, uid: UID, venue: VENUE, venue2: VENUE2 }));
for (;;) {
  var line = readline();
  if (!line) break;
  var rq = JSON.parse(line), out = null;
  if (rq.ask === 'stored') { print(JSON.stringify({ status: 200, body: STORED })); continue; }
  if (rq.ask === 'texts') { print(JSON.stringify({ status: 200, body: TEXTS })); continue; }   // the codes the no-card start texted (6 Nov 2026)
  if (rq.ask === 'sent') { print(JSON.stringify({ status: 200, body: sent })); continue; }   // the emails the fake Resend took (29 Oct 2026)
  if (rq.ask === 'missing') { MISSING[rq.table] = !!rq.on; print(JSON.stringify({ status: 200, body: { missing: !!rq.on } })); continue; }
  if (rq.ask === 'db') { print(JSON.stringify({ status: 200, body: DB[rq.table] || [] })); continue; }
  /* The homepage offer (tools/site-offer-footer-in-chrome.test.py, 29 Oct 2026): which month codes the Worker
     honours (FOUNDING_CODES), and what was asked of Stripe, so a test can see the price a signup was given. */
  if (rq.ask === 'env') { for (var ek in (rq.set || {})) ENV[ek] = rq.set[ek]; print(JSON.stringify({ status: 200, body: { ok: true } })); continue; }
  if (rq.ask === 'stripe') { print(JSON.stringify({ status: 200, body: stripeCalls })); continue; }
  if (rq.ask === 'refuse') { REFUSE = rq.cols || []; print(JSON.stringify({ status: 200, body: REFUSE })); continue; }
  if (rq.ask === 'seed') { DB[rq.table] = rq.rows || []; print(JSON.stringify({ status: 200, body: DB[rq.table] })); continue; }
  /* What Stripe's checkout.session.completed hands the Worker, run through the REAL provisioning
     (tools/signup-tick-in-chrome.test.py: a signup made in Chrome, provisioned, then read in HQ). */
  if (rq.ask === 'provision') {
    var pdone = null;
    Promise.resolve().then(function () { return vpaProvisionFromCheckout(ENV, rq.session); })
      .then(function () { pdone = { status: 200, body: { ok: true } }; }, function (e) { pdone = { status: 500, body: { error: String(e && e.message || e) } }; });
    for (var pi = 0; pi < 400 && !pdone; pi++) drainMicrotasks();
    print(JSON.stringify(pdone || { status: 504, body: { error: 'provisioning did not finish' } }));
    continue;
  }
  var h = rq.headers || {}, txt = JSON.stringify(rq.body || {});
  var req = { method: rq.method || 'POST', url: 'https://api.test' + rq.path,
              headers: { get: function (k) { for (var x in h) { if (x.toLowerCase() === String(k).toLowerCase()) return h[x]; } return null; } },
              text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
  Promise.resolve().then(function () { return _d.fetch(req, ENV); }).then(function (r) {
    var body = null; try { body = JSON.parse(r._b); } catch (e) { body = r._b; }
    out = { status: r.status, body: body };
  }, function (e) { out = { status: 500, body: { error: String(e && e.message || e) } }; });
  for (var i = 0; i < 400 && !out; i++) drainMicrotasks();
  print(JSON.stringify(out || { status: 504, body: { error: 'the billing rig did not answer' } }));
}
