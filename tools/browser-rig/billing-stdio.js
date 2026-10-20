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
  } }, getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 2654435761) & 255; return a; } };
}
var STORED = [];
var _rf = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (/\/storage\/v1\//.test(u)) {
    if (m === 'POST' && /\/storage\/v1\/object\//.test(u)) {
      var b = opts.body, n = b && (b.length || b.byteLength) || 0, head = [];
      for (var i = 0; i < Math.min(32, n); i++) head.push(b[i]);
      STORED.push({ path: u.split('/storage/v1/object/')[1], bytes: n, type: (opts.headers || {})['Content-Type'] || '', head: head });
    }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } });
  }
  return _rf(url, opts);
};

print(JSON.stringify({ ready: true, uid: UID, venue: VENUE, venue2: VENUE2 }));
for (;;) {
  var line = readline();
  if (!line) break;
  var rq = JSON.parse(line), out = null;
  if (rq.ask === 'stored') { print(JSON.stringify({ status: 200, body: STORED })); continue; }
  if (rq.ask === 'db') { print(JSON.stringify({ status: 200, body: DB[rq.table] || [] })); continue; }
  if (rq.ask === 'seed') { DB[rq.table] = rq.rows || []; print(JSON.stringify({ status: 200, body: DB[rq.table] })); continue; }
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
