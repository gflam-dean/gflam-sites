/* HQ > PROSPECTS > COASTER VENUES, RUN AND NOT WORD-SEARCHED (Dean, 4 Nov 2026, /live-here-now v2; migration 153).

   "COASTER VENUES: when Dean hands coasters to a venue, he adds it in HQ as a prospect of a new kind, 'coaster
   venue (no emails)': name, suburb, logo. It appears in the picker and gets its own leaderboard, and NO welcome
   or nudge emails go out until Dean switches it to a normal prospect." A typed-in pub "shows in HQ as 'coaster
   players at X, not on venueplay'", and "picking a pub that isn't a customer counts as a coaster lead for HQ".

   Runs the REAL billing Worker (tools/rig-billing-worker.js, a fake PostgREST that honours offset then limit and
   stops at 1,000 rows a read) through its REAL router, and the REAL HQ files:
     1. the name key is the game Worker's, character for character
     2. POST /admin/coaster/add: owner or accounts; state and timezone from the postcode; the logo through the
        venue logo's own rules into venue-logos/coaster/<id>/; refusals make nothing; audited
     3. POST /admin/coaster/list: coaster venues, leads, the boards (rounds 30 days, first names 7 days), a board
        over 1,000 rounds counted in full, prospects and customers told apart by the prospects tab's own rule;
        before migration 153 "Run migration 153" with need_migration 153, never an empty list
     4. POST /admin/coaster/remove: the row and its rounds; nothing else
     5. Make it a normal prospect: POST /admin/prospect with coaster_id switches the row and moves the board ONLY
        after the venue is made; a failure is a warning and never fails the setup; not from the autopilot
     6. NO EMAILS: the real nightly scheduler, the card reminder sweep, the last-day sweep, the monthly report,
        the autopilot's quiet list and its nudge email and text, run against a database full of coaster venues,
        leads and rounds: nothing reaches them and not one request reads vp_coaster_venues or vp_coaster_plays;
        and, scoped per function, no function that sends an email or a text reads either table
     7. the HQ section (venueplay/app/vp-coaster-hq.js) against the real Worker, and hq.html's own Set up a
        prospect form carrying the coaster id

   Run from the repo root:  jsc venueplay-backend/worker/coaster-hq.test.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400) : '')); } }
function section(t) { print(''); print(t); }
var __rnd = 11;

URL = function (u) { u = String(u); var q = u.indexOf('?'), sp = {}; var base = q >= 0 ? u.slice(0, q) : u;
  this.pathname = base.replace(/^https?:\/\/[^/]+/, '') || '/';
  if (q >= 0) u.slice(q + 1).split('&').forEach(function (p) { var i = p.indexOf('='); sp[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
  this.searchParams = { get: function (k) { return k in sp ? sp[k] : null; } }; };
Response = function (body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; };
Response.redirect = function (u, s) { return { redirect: u, status: s }; };

load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (tk) { return tk ? { sub: tk } : null; };
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
crypto = { subtle: {
  digest: function (alg, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) { __rnd = (Math.imul(__rnd, 1103515245) + 12345) >>> 0; a[i] = (__rnd >>> 16) & 255; } return a; } };
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
if (typeof atob === 'undefined') { atob = function (s) { s = s.replace(/=+$/, ''); var o = '', bits = 0, acc = 0; for (var i = 0; i < s.length; i++) { var v = B64.indexOf(s[i]); if (v < 0) throw new Error('bad base64'); acc = ((acc << 6) | v) & 0xffffff; bits += 6; if (bits >= 8) { bits -= 8; o += String.fromCharCode((acc >> bits) & 255); } } return o; }; }
function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 3) { var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0; var nn = (a << 16) | (b << 8) | c;
  s += B64[(nn >> 18) & 63] + B64[(nn >> 12) & 63] + (i + 1 < bytes.length ? B64[(nn >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[nn & 63] : '='); } return s; }
function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function chunk(name, data) { var c = be32(data.length); for (var i = 0; i < 4; i++) c.push(name.charCodeAt(i)); return c.concat(data, [0, 0, 0, 0]); }
function png(w, h) { var b = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; b = b.concat(chunk('IHDR', be32(w).concat(be32(h), [8, 6, 0, 0, 0])));
  var idat = []; for (var i = 0; i < 20; i++) idat.push((i * 7) & 255); b = b.concat(chunk('IDAT', idat), chunk('IEND', [])); return new Uint8Array(b); }
function dataUrl(type, bytes) { return 'data:' + type + ';base64,' + b64(bytes); }
var LOGO = dataUrl('image/png', png(600, 200));

var AUTH = [], SMS = [], STORE = [], LOG = [];
function RS(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  LOG.push({ url: u, method: method });
  if (u.indexOf('rest.clicksend.com/v3/sms/send') !== -1) { SMS.push(JSON.parse(opts.body)); return RS(200, { data: { messages: [{ status: 'SUCCESS', message_id: 'cs_' + SMS.length }] } }); }
  if (/api\.resend\.com\/emails\/[^/]+\/cancel$/.test(u)) return RS(200, { object: 'email', id: 'x' });
  if (u.indexOf('api.resend.com/emails') !== -1 && method === 'POST') { sent.push(JSON.parse(opts.body)); return RS(200, { id: 're_' + sent.length }); }
  if (u.indexOf('/storage/v1/') !== -1) { if (method === 'POST' && u.indexOf('/object/') !== -1) STORE.push(u); return RS(200, {}); }
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? b.phone.replace('+', '') : '' }; AUTH.push(nu); return RS(200, nu); }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
    return RS(200, { users: AUTH });
  }
  return rigFetch(url, opts);
};
function U(nn) { return '53000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
function C(nn) { return 'c0a57e00-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9), ACCTS = U(8), STAFF = U(7);
var KEY = 'k3y-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
var DAY = 86400000;
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; AUTH = []; SMS = []; STORE = []; LOG = [];
  ENV.FOUNDING_CODES = 'OFFER-NOV-2099'; ENV.PROSPECT_AUTOPILOT_KEY = KEY; ENV.CARD_LINK_SECRET = 'card-link-secret-for-tests-only-0123456789';
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: STAFF, label: 'Helper', role: 'staff' }];
  DB.vp_venues = []; DB.venueplay_founding = []; DB.vp_venue_staff = []; DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = []; DB.vp_venue_screen = [];
  DB.vp_signin_links = []; DB.vp_prospect_welcomes = []; DB.vp_prospects = []; DB.vp_coaster_venues = []; DB.vp_coaster_plays = [];
}
function req(path, body, headers, method) {
  var h = {}; for (var k in (headers || {})) h[k.toLowerCase()] = headers[k];
  var txt = body === undefined ? '' : JSON.stringify(body);
  return { method: method || 'POST', url: 'https://venueplay-api.example' + path,
    headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
    text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
async function call(path, body, headers, method) {
  var res = await _d.fetch(req(path, body, headers, method), ENV);
  var parsed = null; try { parsed = res.body ? JSON.parse(res.body) : null; } catch (e) { parsed = res.body; }
  return { status: res.status, body: parsed || {} };
}
var AS = function (who) { return { Authorization: 'Bearer ' + who }; };
var AP = { 'X-Autopilot-Key': KEY };
var NTH = 0;
function pbody(o) { var b = { name: 'Prospect Hotel ' + (++NTH), first_name: 'Sam', email: 'sam' + NTH + '@coaster.example', postcode: '4000', entity_type: 'for_profit', send_welcome: false };
  for (var k in (o || {})) b[k] = o[k]; return b; }
function coasterRow(id, kind, name, o) { var r = { id: id, kind: kind, name: name, name_key: vpaCoasterNameKey(name), suburb: null, postcode: null, au_state: null, timezone: null, logo_url: null,
  venue_id: null, switched_at: null, created_at: '2026-11-01T00:00:00.000Z', created_label: null }; for (var k in (o || {})) r[k] = o[k]; DB.vp_coaster_venues.push(r); return r; }
var PLAYN = 0;
function play(board, name, agoMs, finished) { PLAYN++; var t = new Date(Date.now() - agoMs).toISOString();
  DB.vp_coaster_plays.push({ id: 'p1a70000-0000-4000-8000-' + ('000000000000' + PLAYN).slice(-12), board: board, first_name: name, qids: ['a', 'b', 'c', 'd', 'e'],
    code: ('C' + (100000 + PLAYN)).slice(-6), token_hash: new Array(65).join('a'), answers: [], points: 300, correct: 3, ms_total: 9000,
    asked_at: t, started_at: t, finished_at: finished === false ? null : t, night: t.slice(0, 10), week: t.slice(0, 10) }); }
function auditOf(action) { return DB.vp_admin_audit.filter(function (a) { return a.action === action; }); }
function coasterReads() { return LOG.filter(function (l) { return /\/rest\/v1\/vp_coaster_(venues|plays)/.test(l.url); }); }
function bne(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 10, mi || 0); }
function nextTick() { return new Promise(function (r) { r(); }); }

(async function () {
  section('1. The name key is the game Worker\'s, character for character');
  /* The game Worker keys a typed-in lead with exactly this expression (its author's words); HQ's must agree on every input. */
  var GAME = function (s) { return String(s).toLowerCase().replace(/&/g, ' and ').replace(/['‘’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, ''); };
  var names = ['The Royal Hotel', 'royal hotel', '  Royal   Hotel!! ', 'Fox & Hounds', 'O\'Reilly’s Bar', 'THE  GRAND', 'The', 'Theatre Bar', 'Café Rex', 'Bob`s ‘Tavern’', '!!!'];
  check('"The Royal Hotel", "royal hotel" and "  Royal   Hotel!! " are one place: "royal hotel"',
    vpaCoasterNameKey(names[0]) === 'royal hotel' && vpaCoasterNameKey(names[1]) === 'royal hotel' && vpaCoasterNameKey(names[2]) === 'royal hotel', names.slice(0, 3).map(vpaCoasterNameKey));
  check('& reads "and", apostrophes (straight, curly, backtick) drop, a leading "the " goes but "theatre" stays',
    vpaCoasterNameKey('Fox & Hounds') === 'fox and hounds' && vpaCoasterNameKey('O\'Reilly’s Bar') === 'oreillys bar' && vpaCoasterNameKey('Theatre Bar') === 'theatre bar' && vpaCoasterNameKey('THE  GRAND') === 'grand',
    ['Fox & Hounds', 'O\'Reilly’s Bar', 'Theatre Bar', 'THE  GRAND'].map(vpaCoasterNameKey));
  check('the same answer as the game Worker\'s expression on every one of ' + names.length + ' names', names.every(function (n) { return vpaCoasterNameKey(n) === GAME(n); }),
    names.filter(function (n) { return vpaCoasterNameKey(n) !== GAME(n); }).map(function (n) { return [n, vpaCoasterNameKey(n), GAME(n)]; }));

  section('2. POST /admin/coaster/add: a coaster venue (no emails)');
  world();
  var r = await call('/admin/coaster/add', { name: '  The Royal  Hotel ', suburb: 'Paddington', postcode: '4064', logo: LOGO }, AS(ADMIN));
  var row = DB.vp_coaster_venues[0] || {};
  check('owner adds one: a kind "coaster" row with its name, the name key, suburb and postcode, nothing else to reach them by',
    r.status === 200 && r.body.ok === true && DB.vp_coaster_venues.length === 1 && row.kind === 'coaster' && row.name === 'The Royal Hotel' && row.name_key === 'royal hotel' &&
    row.suburb === 'Paddington' && row.postcode === '4064' && row.venue_id == null && !('email' in row) && DB.vp_venues.length === 0 && DB.vp_prospects.length === 0 && AUTH.length === 0, [r, row]);
  check('state and timezone come from the postcode: 4064 is QLD, Australia/Brisbane', row.au_state === 'QLD' && row.timezone === 'Australia/Brisbane', row);
  var r3 = await call('/admin/coaster/add', { name: 'Clifton Hill Hotel', suburb: 'Clifton Hill', postcode: '3068' }, AS(ACCTS));
  var vic = DB.vp_coaster_venues.filter(function (c) { return c.name === 'Clifton Hill Hotel'; })[0] || {};
  check('accounts can add one too; 3068 is VIC, Australia/Melbourne; no logo is fine', r3.status === 200 && vic.au_state === 'VIC' && vic.timezone === 'Australia/Melbourne' && vic.logo_url == null, [r3, vic]);
  check('the logo goes to the venue logo bucket under coaster/<its id>/<sha256>.png and its address is saved on the row',
    STORE.length === 1 && new RegExp('/storage/v1/object/venue-logos/coaster/' + row.id + '/[0-9a-f]{64}\\.png$').test(STORE[0]) &&
    row.logo_url === 'https://db/storage/v1/object/public/venue-logos/coaster/' + row.id + '/' + STORE[0].split('/').pop() && r.body.coaster.logo_url === row.logo_url, [STORE, row.logo_url]);
  var au = auditOf('coaster_venue_added');
  check('each add is audited: who, the name, the postcode, the logo\'s size', au.length === 2 && au[0].actor_label === 'Dean' && au[0].target === 'coaster:' + row.id && au[0].detail.name === 'The Royal Hotel' &&
    au[0].detail.postcode === '4064' && au[0].detail.logo && au[0].detail.logo.w === 600 && au[1].actor_label === 'Accounts', au);
  var before = DB.vp_coaster_venues.length;
  var st = await call('/admin/coaster/add', { name: 'Staff Pub', postcode: '4000' }, AS(STAFF));
  var none = await call('/admin/coaster/add', { name: 'Nobody Pub', postcode: '4000' }, {});
  check('a staff admin is refused (403) and no login is refused (401), nothing made', st.status === 403 && none.status === 401 && DB.vp_coaster_venues.length === before, [st, none]);
  /* The venue logo's own rules (vpbLogoCheck, the one copy vpbLogoUpload uses): same words, same limits. */
  var tiny = await call('/admin/coaster/add', { name: 'Tiny Logo Pub', postcode: '4000', logo: dataUrl('image/png', png(8, 8)) }, AS(ADMIN));
  var jpg = await call('/admin/coaster/add', { name: 'Jpeg Pub', postcode: '4000', logo: dataUrl('image/jpeg', new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0].concat(new Array(40).fill(1)))) }, AS(ADMIN));
  var huge = await call('/admin/coaster/add', { name: 'Huge Logo Pub', postcode: '4000', logo: 'data:image/png;base64,' + new Array(1500000).join('A') }, AS(ADMIN));
  check('a logo the venue logo rules refuse is refused here in the same words: too small (8 by 8), not a PNG or WebP, over 1MB; nothing made, nothing stored',
    tiny.status === 400 && /only 8 by 8 pixels/.test(tiny.body.error) && jpg.status === 415 && /Use a PNG \(or a WebP\)/.test(jpg.body.error) && huge.status === 413 && /1MB or less/.test(huge.body.error) &&
    /Nothing was added/.test(tiny.body.error) && DB.vp_coaster_venues.length === before && STORE.length === 1, [tiny.body, jpg.body, huge.body]);
  var nopc = await call('/admin/coaster/add', { name: 'No Postcode Pub' }, AS(ADMIN));
  var noname = await call('/admin/coaster/add', { name: ' !!! ', postcode: '4000' }, AS(ADMIN));
  check('no postcode, or a name with no letters in it: refused, nothing made', nopc.status === 400 && /postcode/.test(nopc.body.error) && noname.status === 400 && /venue name/.test(noname.body.error) && DB.vp_coaster_venues.length === before, [nopc.body, noname.body]);
  var twin = await call('/admin/coaster/add', { name: 'royal hotel', postcode: '4064' }, AS(ADMIN));
  DB.vp_venues.push({ id: U(50), name: 'Already On Hotel', postcode: '4000', status: 'active' });
  var onvp = await call('/admin/coaster/add', { name: 'Already On Hotel', postcode: '4000' }, AS(ADMIN));
  check('the same place twice (same name key and postcode), or a place already on venueplay: 409, one place, one board', twin.status === 409 && /already a coaster venue/.test(twin.body.error) &&
    onvp.status === 409 && /already on venueplay/.test(onvp.body.error) && DB.vp_coaster_venues.length === before, [twin.body, onvp.body]);
  var realF = globalThis.fetch;
  globalThis.fetch = function (url, opts) { if (/\/rest\/v1\/vp_coaster_(venues|plays)(\?|$)/.test(String(url))) return RS(404, { code: 'PGRST205', message: 'Could not find the table public.vp_coaster_venues' }); return realF(url, opts); };
  var pre = await call('/admin/coaster/add', { name: 'Before 153 Hotel', postcode: '4000', logo: LOGO }, AS(ADMIN));
  globalThis.fetch = realF;
  check('before migration 153: "Run migration 153" with need_migration 153, nothing stored', pre.status === 503 && /Run migration 153/.test(pre.body.error) && pre.body.need_migration === 153 && STORE.length === 1, pre);

  section('3. POST /admin/coaster/list: coaster venues, leads, and every board with play');
  world();
  var royal = coasterRow(C(1), 'coaster', 'The Royal Hotel', { suburb: 'Paddington', postcode: '4064', au_state: 'QLD', created_at: '2026-11-03T00:00:00.000Z' });
  var quiet = coasterRow(C(2), 'coaster', 'Quiet Tavern', { postcode: '4000', au_state: 'QLD', created_at: '2026-11-02T00:00:00.000Z' });
  var fox = coasterRow(C(3), 'lead', 'Fox & Hounds');
  var done = coasterRow(C(4), 'coaster', 'Switched Already Hotel', { venue_id: U(60), switched_at: '2026-11-04T00:00:00.000Z' });
  var pr = await call('/admin/prospect', pbody({ name: 'Coaster Prospect Inn' }), AS(ADMIN));
  var PV = pr.body.venue.id;
  DB.vp_venues.push({ id: U(61), name: 'Paying Customer Club', postcode: '2000', au_state: 'NSW', founding_id: U(62), status: 'active' });
  DB.venueplay_founding.push({ id: U(62), status: 'card_on_file', stripe_subscription_id: 'sub_1' });
  DB.vp_prospects.push({ venue_id: U(63), created_at: '2026-10-01T00:00:00.000Z' });   // was a prospect, now paying
  DB.vp_venues.push({ id: U(63), name: 'Was A Prospect Bar', postcode: '4000', au_state: 'QLD', founding_id: U(64), status: 'active' });
  DB.venueplay_founding.push({ id: U(64), status: 'card_on_file', stripe_subscription_id: 'sub_2' });
  // The Royal: 4 rounds in 30 days (3 finished), names Sam, sam and Jo in the last 7 days, one 9 days ago, one 32 days ago.
  play('c:' + C(1), 'Sam', 1 * 3600000); play('c:' + C(1), 'sam', 2 * DAY); play('c:' + C(1), 'Jo', 3 * DAY, false); play('c:' + C(1), 'Kim', 9 * DAY); play('c:' + C(1), 'Old', 32 * DAY);
  for (var i = 0; i < 1205; i++) play('c:' + C(3), 'Mate' + (i % 40), (i % 20) * 3600000);   // a lead with more rounds than one read returns
  play('v:' + PV, 'Ana', DAY); play('v:' + PV, 'Ben', DAY);
  play('v:' + U(61), 'Cat', DAY); play('v:' + U(63), 'Dan', 10 * DAY);
  play('c:' + C(4), 'Gone', DAY);   // a switched row's stray round: the row is not open, so no board is listed for it
  var l = await call('/admin/coaster/list', {}, AS(ADMIN));
  var byId = function (list, id) { return (list || []).filter(function (x) { return x.id === id; })[0] || {}; };
  var bd = function (key) { return (l.body.boards || []).filter(function (x) { return x.board === key; })[0] || null; };
  check('coaster venues and leads come back apart, newest first; a row already made a normal prospect is not listed',
    l.status === 200 && l.body.ok === true && (l.body.coaster || []).map(function (c) { return c.id; }).join() === [C(1), C(2)].join() && (l.body.leads || []).map(function (c) { return c.id; }).join() === C(3), l.body);
  var R = byId(l.body.coaster, C(1));
  check('The Royal: 3 rounds finished in the last 30 days (an unfinished one and one 32 days ago do not count); 2 different first names in the last 7 days (Sam and sam are one)',
    R.rounds_30d === 3 && R.players_7d === 2 && R.board === 'c:' + C(1) && R.suburb === 'Paddington' && R.postcode === '4064', R);
  check('a coaster venue nobody has played at reads 0 and 0', byId(l.body.coaster, C(2)).rounds_30d === 0 && byId(l.body.coaster, C(2)).players_7d === 0);
  check('a lead with 1,205 rounds is counted in full (the read is paged past the database\'s 1,000), and its 40 different names',
    byId(l.body.leads, C(3)).rounds_30d === 1205 && byId(l.body.leads, C(3)).players_7d === 40, byId(l.body.leads, C(3)));
  var bp = bd('v:' + PV), bc = bd('v:' + U(61)), bw = bd('v:' + U(63));
  check('a venueplay prospect with coaster play is listed as a prospect with its name (a coaster lead too, Dean item 9)', !!bp && bp.kind === 'venue' && bp.status === 'prospect' && bp.name === 'Coaster Prospect Inn' && bp.rounds_30d === 2 && bp.players_7d === 2, bp);
  check('a paying customer, and a prospect who has since added a card, read as customers (the prospects tab\'s own rule)', !!bc && bc.status === 'customer' && bc.name === 'Paying Customer Club' && !!bw && bw.status === 'customer' && bw.players_7d === 0 && bw.rounds_30d === 1, [bc, bw]);
  check('the boards: busiest first, and a switched row\'s board is not listed', (l.body.boards || [])[0].board === 'c:' + C(3) && !bd('c:' + C(4)) && !!bd('c:' + C(1)) && !bd('c:' + C(2)), (l.body.boards || []).map(function (b) { return b.board + ' ' + b.rounds_30d; }));
  var pagedReads = LOG.filter(function (x) { return /\/rest\/v1\/vp_coaster_plays\?/.test(x.url) && x.method === 'GET'; });
  check('the rounds are read in ordered pages (order, limit, offset), never one plain select', pagedReads.length >= 3 && pagedReads.every(function (x) { return /order=started_at\.asc,id\.asc/.test(x.url) && /limit=\d+/.test(x.url) && /offset=\d+/.test(x.url); }), pagedReads.map(function (x) { return x.url.slice(-80); }));
  var ls = await call('/admin/coaster/list', {}, AS(STAFF));
  var la = await call('/admin/coaster/list', {}, AS(ACCTS));
  check('owner and accounts only: staff 403', ls.status === 403 && !ls.body.coaster && la.status === 200, ls);
  globalThis.fetch = function (url, opts) { if (/\/rest\/v1\/vp_coaster_(venues|plays)(\?|$)/.test(String(url))) return RS(404, { code: 'PGRST205', message: 'Could not find the table public.vp_coaster_venues in the schema cache' }); return realF(url, opts); };
  var l0 = await call('/admin/coaster/list', {}, AS(ADMIN));
  globalThis.fetch = function (url, opts) { if (/\/rest\/v1\/vp_coaster_plays(\?|$)/.test(String(url))) return RS(500, 'upstream blip'); return realF(url, opts); };
  var l5 = await call('/admin/coaster/list', {}, AS(ADMIN));
  globalThis.fetch = realF;
  check('before migration 153: 503 "Run migration 153" with need_migration 153, not an empty list that looks like nobody', l0.status === 503 && /Run migration 153/.test(l0.body.error) && l0.body.need_migration === 153 && !l0.body.coaster, l0);
  check('a database that did not answer is said as that (502), never "run the migration" and never a short list', l5.status === 502 && !l5.body.need_migration && !l5.body.coaster, l5);

  section('4. POST /admin/coaster/remove: the row and its rounds');
  var playsBefore = DB.vp_coaster_plays.length;
  var rs = await call('/admin/coaster/remove', { id: C(1) }, AS(STAFF));
  check('staff cannot remove one', rs.status === 403 && DB.vp_coaster_venues.length === 4);
  var rm = await call('/admin/coaster/remove', { id: C(1) }, AS(ADMIN));
  check('owner removes The Royal: the row goes and its 5 rounds (first names only) go with it; every other board\'s rounds stay',
    rm.status === 200 && rm.body.rounds_deleted === 5 && !DB.vp_coaster_venues.some(function (c) { return c.id === C(1); }) && !DB.vp_coaster_plays.some(function (p) { return p.board === 'c:' + C(1); }) &&
    DB.vp_coaster_plays.length === playsBefore - 5, rm.body);
  var ra = auditOf('coaster_venue_removed');
  check('audited: who, the name and how many rounds went', ra.length === 1 && ra[0].actor_label === 'Dean' && ra[0].target === 'coaster:' + C(1) && ra[0].detail.name === 'The Royal Hotel' && ra[0].detail.rounds_deleted === 5, ra);
  var again = await call('/admin/coaster/remove', { id: C(1) }, AS(ADMIN));
  var bogus = await call('/admin/coaster/remove', { id: 'not-an-id' }, AS(ADMIN));
  var sw = await call('/admin/coaster/remove', { id: C(4) }, AS(ADMIN));
  check('removed twice: 404; not an id: 400; a row already made a normal prospect cannot be removed from here (its venue owns it now)',
    again.status === 404 && bogus.status === 400 && sw.status === 404 && DB.vp_coaster_venues.some(function (c) { return c.id === C(4); }), [again.status, bogus.status, sw.status]);
  var rl = await call('/admin/coaster/remove', { id: C(3) }, AS(ACCTS));
  check('accounts removes a lead the same way, its 1,205 rounds with it', rl.status === 200 && rl.body.rounds_deleted === 1205 && !DB.vp_coaster_plays.some(function (p) { return p.board === 'c:' + C(3); }), rl.body);

  section('5. Make it a normal prospect: Set up a prospect with coaster_id');
  world();
  var tav = coasterRow(C(10), 'coaster', 'Coaster Tavern', { postcode: '4217', au_state: 'QLD' });
  play('c:' + C(10), 'Sam', DAY); play('c:' + C(10), 'Jo', 2 * DAY); play('c:' + C(11), 'Other', DAY);
  var bad1 = await call('/admin/prospect', pbody({ name: 'Coaster Tavern', postcode: '4217', email: 'not an email', coaster_id: C(10) }), AS(ADMIN));
  check('a setup that is refused leaves the coaster venue and its board exactly as they were', bad1.status === 400 && tav.venue_id == null && DB.vp_coaster_plays.filter(function (p) { return p.board === 'c:' + C(10); }).length === 2, bad1.body);
  var dry = await call('/admin/prospect', pbody({ name: 'Coaster Tavern', postcode: '4217', coaster_id: C(10), dry_run: true }), AS(ADMIN));
  check('a dry run switches nothing', dry.status === 200 && dry.body.dry_run === true && tav.venue_id == null);
  LOG = [];
  var go = await call('/admin/prospect', pbody({ name: 'Coaster Tavern', postcode: '4217', coaster_id: C(10), send_welcome: true, send_in_minutes: 0 }), AS(ADMIN));
  var NV = go.body.venue && go.body.venue.id;
  check('the prospect is set up as normal (venue, account, login) and the coaster row now points at it, with when',
    go.status === 200 && !!NV && DB.vp_venues.some(function (v) { return v.id === NV; }) && tav.venue_id === NV && !!tav.switched_at && !(go.body.warnings || []).length, [go.body, tav]);
  check('its board moved: every round on c:<id> is now on v:<the new venue>; another board untouched',
    DB.vp_coaster_plays.filter(function (p) { return p.board === 'v:' + NV; }).length === 2 && !DB.vp_coaster_plays.some(function (p) { return p.board === 'c:' + C(10); }) && DB.vp_coaster_plays.some(function (p) { return p.board === 'c:' + C(11); }));
  var idx = function (pred) { for (var i = 0; i < LOG.length; i++) if (pred(LOG[i])) return i; return -1; };
  var iVenue = idx(function (x) { return /\/rest\/v1\/vp_venues(\?|$)/.test(x.url) && x.method === 'POST'; });
  var iProspect = idx(function (x) { return /\/rest\/v1\/vp_prospects(\?|$)/.test(x.url) && x.method === 'POST'; });
  var iSwitch = idx(function (x) { return /\/rest\/v1\/vp_coaster_venues\?/.test(x.url) && x.method === 'PATCH'; });
  var iMove = idx(function (x) { return /\/rest\/v1\/vp_coaster_plays\?/.test(x.url) && x.method === 'PATCH'; });
  var iSetupAudit = idx(function (x) { return /\/rest\/v1\/vp_admin_audit/.test(x.url) && x.method === 'POST' && DB.vp_admin_audit.length; });
  check('ONLY after the prospect is fully made: the switch and the board move come after the venue, the prospect row and the welcome',
    iVenue >= 0 && iProspect > iVenue && iSwitch > iProspect && iMove > iSwitch && idx(function (x) { return /api\.resend\.com/.test(x.url); }) < iSwitch, [iVenue, iProspect, iSwitch, iMove]);
  check('this is the moment emails start, by Dean\'s choice: the normal prospect welcome went to the email typed in the form', go.body.welcome_sent === true && sent.length === 1 && sent[0].to[0] === 'sam' + NTH + '@coaster.example', sent.map(function (m) { return m.to; }));
  var sa = auditOf('coaster_venue_switched');
  check('audited against the new venue, after prospect_set_up', sa.length === 1 && sa[0].target === 'venue:' + NV && sa[0].detail.coaster_id === C(10) && sa[0].detail.name === 'Coaster Tavern' &&
    DB.vp_admin_audit.indexOf(sa[0]) > DB.vp_admin_audit.indexOf(auditOf('prospect_set_up')[0]), sa);
  var l2 = await call('/admin/coaster/list', {}, AS(ADMIN));
  check('HQ\'s list: no longer a coaster venue; its board is now the new prospect\'s', !(l2.body.coaster || []).length &&
    (l2.body.boards || []).some(function (b) { return b.board === 'v:' + NV && b.status === 'prospect' && b.rounds_30d === 2; }), l2.body);
  var twice = await call('/admin/prospect', pbody({ name: 'Second Try Hotel', coaster_id: C(10) }), AS(ADMIN));
  var junk = await call('/admin/prospect', pbody({ name: 'Junk Id Hotel', coaster_id: 'nope' }), AS(ADMIN));
  var missing = await call('/admin/prospect', pbody({ name: 'Missing Id Hotel', coaster_id: C(99) }), AS(ADMIN));
  check('already switched, not an id, not there: the prospect is still set up (200) and HQ is told the board stays',
    [twice, junk, missing].every(function (x) { return x.status === 200 && x.body.ok === true && (x.body.warnings || []).some(function (w) { return /coaster board stays where it is/.test(w); }); }) && tav.venue_id === NV,
    [twice.body.warnings, junk.body.warnings, missing.body.warnings]);
  var lead = coasterRow(C(12), 'lead', 'Typed In Arms');
  play('c:' + C(12), 'Liv', DAY);
  FAIL['vp_coaster_plays:PATCH'] = 1;
  var blip = await call('/admin/prospect', pbody({ name: 'Typed In Arms', coaster_id: C(12) }), AS(ADMIN));
  check('a lead switches the same way; when its board cannot move, the setup still succeeds with a warning saying so',
    blip.status === 200 && blip.body.ok === true && (blip.body.warnings || []).some(function (w) { return /coaster board did not move/.test(w); }) && lead.venue_id === blip.body.venue.id, blip.body);
  var lead2 = coasterRow(C(13), 'lead', 'Autopilot Arms');
  var ap = await call('/autopilot/prospect', pbody({ name: 'Autopilot Arms', coaster_id: C(13) }), AP);
  check('the autopilot cannot switch a coaster venue: only HQ\'s button does', ap.status === 200 && lead2.venue_id == null, ap.body);

  section('6. No emails or texts reach a coaster venue: the real sweeps, against coaster venues, leads and rounds');
  world();
  ENV.MONTHLY_REPORTS = 'on';
  var CTL = await call('/admin/prospect', pbody({ name: 'Control Prospect Hotel', email: 'control@prospect.example', phone: '0432 071 622' }), AS(ADMIN));
  var cv = DB.vp_venues.filter(function (v) { return v.id === CTL.body.venue.id; })[0];
  cv.status = 'active'; cv.suspended_reason = null;
  var cp = DB.vp_prospects.filter(function (p) { return p.venue_id === cv.id; })[0];
  var T = bne(2026, 11, 5, 10, 0), firstMs = bne(2026, 11, 2, 10, 0);   // a fixed Thursday, 10am Brisbane; their month began Monday
  cp.first_signin_at = new Date(firstMs).toISOString(); cp.free_month_ends_at = new Date(vpaFreeMonthEnd(firstMs)).toISOString();
  cp.card_choice = null; cp.paused_at = null; cp.cancelled_at = null; cp.offer_rate = null; cp.reminders_sent = [];
  coasterRow(C(20), 'coaster', 'No Email Coaster Hotel', { postcode: '4000', au_state: 'QLD', timezone: 'Australia/Brisbane' });
  coasterRow(C(21), 'lead', 'Typed Lead Tavern');
  for (var j = 0; j < 30; j++) { play('c:' + C(20), 'Sam' + j, DAY); play('c:' + C(21), 'Jo' + j, DAY); }
  var COASTER_WORDS = /No Email Coaster Hotel|Typed Lead Tavern|c0a57e00/;
  sent.length = 0; SMS = []; LOG = [];
  var realNow = Date.now;
  Date.now = function () { return T; };
  try { await _d.scheduled({ cron: '0 * * * *', scheduledTime: T }, ENV, { waitUntil: function () {} }); } finally { Date.now = realNow; }
  check('control: the real scheduler DID send the control prospect its card reminder, so this harness sees a send when there is one',
    sent.some(function (m) { return m.to[0] === 'control@prospect.example'; }) && auditOf('prospect_reminder_sent').length === 1, sent.map(function (m) { return m.to; }));
  check('the last-day sweep ran (not failed) inside the same scheduler run', auditOf('last_day_sweep_ran').length === 1 && !auditOf('last_day_sweep_failed').length, DB.vp_admin_audit.map(function (a) { return a.action; }));
  check('nightly scheduler (archive, last day, screen history, card reminders, monthly report, HQ month): every email went to the control and none names a coaster venue or lead',
    sent.length >= 1 && sent.every(function (m) { return m.to.join() === 'control@prospect.example' && !COASTER_WORDS.test(JSON.stringify(m)); }) && SMS.length === 0, sent.map(function (m) { return [m.to, m.subject]; }));
  check('...and not one request in the whole run read or wrote vp_coaster_venues or vp_coaster_plays', LOG.length > 10 && coasterReads().length === 0, [LOG.length, coasterReads().map(function (x) { return x.method + ' ' + x.url; })]);
  LOG = []; var sentBefore = sent.length;
  var mr = await vprMonthlySweep(ENV, T, { anyTime: true });
  var mTargets = auditOf('monthly_report_sent').concat(auditOf('monthly_report_skipped')).map(function (a) { return a.target; });
  check('the monthly report email, run at any time: it went through every active venueplay venue and only those (' + DB.vp_venues.filter(function (v) { return v.status === 'active'; }).length + '), never a coaster id, never reading the coaster tables',
    mr && (mr.sent + mr.skipped) === DB.vp_venues.filter(function (v) { return v.status === 'active'; }).length && mTargets.length >= 1 && mTargets.every(function (t) { return t.indexOf('month-report:' + cv.id + ':') === 0; }) &&
    coasterReads().length === 0 && sent.slice(sentBefore).every(function (m) { return !COASTER_WORDS.test(JSON.stringify(m)); }), [mr, mTargets, coasterReads().length]);
  LOG = [];
  var quietList = await call('/autopilot/prospects/quiet', undefined, AP, 'GET');
  check('the autopilot\'s quiet list (the day-3 follow-up drafts start here) has no coaster venue or lead and reads neither table',
    quietList.status === 200 && !COASTER_WORDS.test(JSON.stringify(quietList.body)) && coasterReads().length === 0, quietList);
  sentBefore = sent.length;
  var nudge = await call('/autopilot/prospect/nudge', { venue_id: C(20), text: 'Hi there, just checking in about your venueplay account and coasters.' }, AP);
  var nudgeSms = await call('/autopilot/prospect/nudge-sms', { venue_id: C(20), text: 'Hi there, just checking in about venueplay. Reply STOP to opt out.' }, AP);
  check('the follow-up email and text, aimed straight at a coaster venue\'s id: refused, nothing sent', nudge.status !== 200 && nudgeSms.status !== 200 && sent.length === sentBefore && SMS.length === 0, [nudge, nudgeSms]);
  check('the coaster venue and lead are untouched by all of it: still open, no venue, no prospect row, no login', DB.vp_coaster_venues.every(function (c) { return c.venue_id == null; }) &&
    !DB.vp_prospects.some(function (p) { return /^c0a57e00/.test(p.venue_id); }) && !DB.vp_venues.some(function (v) { return COASTER_WORDS.test(v.name); }));

  /* SCOPED PER FUNCTION, never a whole-file word search. The Worker is cut at its top-level declarations
     (column 0), and the nightly handler is cut from its own object. A function SENDS if it posts to Resend
     or ClickSend itself, or calls vpaSendEmail or one of the vpaFire* senders. */
  var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  var cuts = [], rx = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/mg, m;
  while ((m = rx.exec(SRC))) cuts.push({ name: m[1], at: m.index });
  var tops = [], rxTop = /^(?:async\s+function|function|const|let|var|class|export)\b/mg, mt;
  while ((mt = rxTop.exec(SRC))) tops.push(mt.index);
  function bodyOf(c) { var end = SRC.length; for (var t = 0; t < tops.length; t++) if (tops[t] > c.at) { end = tops[t]; break; } return SRC.slice(c.at, end); }
  var FN = {}; cuts.forEach(function (c) { FN[c.name] = bodyOf(c); });
  var si = SRC.indexOf('  async scheduled(event, env, ctx) {'), se = SRC.indexOf('\n  },\n};', si);
  FN['(the nightly scheduled handler)'] = si >= 0 && se > si ? SRC.slice(si, se) : '';
  var SENDS = /api\.resend\.com|rest\.clicksend\.com|\bvpaSendEmail\(|\bvpaSendSms\(|\bvpaFire[A-Za-z]*\(|\bvpaSendSigninLink\(/;
  var COASTER_TABLE = /vp_coaster_venues|vp_coaster_plays/;
  var senders = Object.keys(FN).filter(function (n) { return SENDS.test(FN[n]); });
  var must = ['vpaSendEmail', 'vpaProspectReminderSweep', 'vprMonthlySweep', 'vpaLastDaySweep', 'vpaFireProspectWelcome', 'vpaFireWelcome', 'vpaSendSigninLink', 'vpaAutopilotProspectNudge', 'vpaAutopilotProspectNudgeSms', 'vpaSendSms'];
  /* The nightly handler and every function it calls by name are in scope too, sender or not. */
  var nightly = FN['(the nightly scheduled handler)'], nightlyCalls = [];
  nightly.replace(/\b((?:vpa|vpr|vpb)[A-Za-z0-9_]*)\(/g, function (_, n) { if (FN[n] && nightlyCalls.indexOf(n) === -1) nightlyCalls.push(n); });
  senders = senders.concat(['(the nightly scheduled handler)'], nightlyCalls.filter(function (n) { return senders.indexOf(n) === -1; }));
  check('the scan sees what it is about: ' + senders.length + ' functions, every one that sends an email or a text (the reminder sweep, the monthly report, the last-day sweep, the welcomes, the sign-in link, the nudge email and text) plus the nightly handler and the ' + nightlyCalls.length + ' functions it calls',
    senders.length >= 20 && nightly.length > 200 && nightlyCalls.indexOf('vpaAutoArchiveSweep') !== -1 && nightlyCalls.indexOf('vprStoreHqMonth') !== -1 && must.every(function (n) { return senders.indexOf(n) !== -1; }),
    [nightly.length, nightlyCalls, must.filter(function (n) { return senders.indexOf(n) === -1; })]);
  check('...and it can see a coaster table when one is there (vpaCoasterList, vpaCoasterSwitch), so the next line can fail',
    COASTER_TABLE.test(FN.vpaCoasterList || '') && COASTER_TABLE.test(FN.vpaCoasterSwitch || '') && COASTER_TABLE.test(FN.vpaCoasterRemove || ''));
  var leak = senders.filter(function (n) { return COASTER_TABLE.test(FN[n]); });
  check('no function that sends an email or a text reads vp_coaster_venues or vp_coaster_plays', leak.length === 0, leak);
  var coasterFns = Object.keys(FN).filter(function (n) { return /^vpaCoaster/.test(n); });
  check('and the coaster functions send nothing: ' + coasterFns.join(', '), coasterFns.length >= 5 && coasterFns.every(function (n) { return !SENDS.test(FN[n]); }), coasterFns.filter(function (n) { return SENDS.test(FN[n]); }));
  check('Set up a prospect reaches the coaster tables only through vpaCoasterSwitch, and only for HQ (not the autopilot)',
    !COASTER_TABLE.test(FN.vpaProspectSetUp || 'x') && /if \(b\.coaster_id != null && b\.coaster_id !== '' && !opts\.via\) \{\s*const cw = await vpaCoasterSwitch\(env, actor, b\.coaster_id, venue\.id\);/.test(FN.vpaProspectSetUp || ''));

  section('7. The HQ section (vp-coaster-hq.js) against the real Worker, and hq.html\'s own form');
  world();
  coasterRow(C(30), 'coaster', 'Sam\'s <b>Bar</b> & Grill', { suburb: 'Burleigh <i>Heads</i>', postcode: '4220', au_state: 'QLD', logo_url: 'https://db/storage/v1/object/public/venue-logos/coaster/' + C(30) + '/abc.png' });
  coasterRow(C(31), 'lead', 'Fox <script>alert(1)</script> Hounds');
  play('c:' + C(30), 'Sam', DAY); play('c:' + C(31), 'Jo', DAY); play('c:' + C(31), 'Kim', DAY);
  var pr7 = await call('/admin/prospect', pbody({ name: 'Prospect With Coasters' }), AS(ADMIN));
  play('v:' + pr7.body.venue.id, 'Ana', DAY);
  var PANE = readFile('venueplay/app/vp-coaster-hq.js');
  var API = 'https://api.venueplay.com.au';
  function mk(id) { return { id: id || '', value: '', innerHTML: '', textContent: '', hidden: false, className: '', disabled: false, kids: [], ls: {},
    appendChild: function (c) { this.kids.push(c); if (c.id) ELS[c.id] = c; if (c.id === 'coasterHq') ELS.cqBody = mk('cqBody'); return c; },
    addEventListener: function (t, f) { this.ls[t] = f; }, focus: function () {}, scrollIntoView: function () {} }; }
  var ELS = {}; ELS.paneProspects = mk('paneProspects'); ELS.hqNav = mk('hqNav');
  ['cqName', 'cqSuburb', 'cqPostcode', 'cqMsg'].forEach(function (id) { ELS[id] = mk(id); });
  var PREFILL = [], CALLS = [];
  var W = { VP: { getClient: function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: ADMIN } } }); } } }; } },
    setTimeout: function () {}, vpAsk: function () { return Promise.resolve(true); }, hqProspectPrefill: function (o) { PREFILL.push(o); },
    fetch: function (url, opts) { var path = String(url).replace(API, ''); CALLS.push(path);
      return _d.fetch(req(path, JSON.parse(opts.body), opts.headers), ENV).then(function (res) {
        return { status: res.status, ok: res.status >= 200 && res.status < 300, json: function () { return Promise.resolve(res.body ? JSON.parse(res.body) : {}); } }; }); } };
  W.document = { readyState: 'complete', getElementById: function (id) { return ELS[id] || null; }, createElement: function () { return mk(''); }, addEventListener: function () {} };
  (new Function('window', PANE))(W);
  var T7 = W.VPCoaster && W.VPCoaster._t;
  check('the file loads and starts on hq.html\'s nav: opening the Prospects tab loads it', !!T7 && typeof ELS.hqNav.ls.click === 'function');
  ELS.hqNav.ls.click({ target: { closest: function () { return { getAttribute: function () { return 'prospects'; } }; } } });
  await W.VPCoaster.load();
  var H = ELS.cqBody.innerHTML;
  check('opening the tab asks the real Worker for /admin/coaster/list and draws inside the Prospects pane', CALLS[0] === '/admin/coaster/list' && ELS.paneProspects.kids.length === 1 && ELS.paneProspects.kids[0].id === 'coasterHq' && /Coaster venues \(no emails\)/.test(H), [CALLS, H.slice(0, 200)]);
  check('names, suburbs and leads are escaped, never markup', H.indexOf('<b>Bar</b>') === -1 && H.indexOf('<script>') === -1 && H.indexOf('<i>Heads') === -1 &&
    H.indexOf('Sam&#39;s &lt;b&gt;Bar&lt;/b&gt; &amp; Grill') !== -1 && H.indexOf('Fox &lt;script&gt;alert(1)&lt;/script&gt; Hounds') !== -1);
  check('a coaster venue shows its logo, where it is, "No emails", its play, and both buttons', /<img class="cqlogo" alt="" src="https:\/\/db\/storage\/v1\/object\/public\/venue-logos\/coaster\//.test(H) &&
    /Burleigh &lt;i&gt;Heads&lt;\/i&gt;, 4220 QLD/.test(H) && /No emails/.test(H) && /1 round in the last 30 days, 1 player in the last 7 days/.test(H) &&
    new RegExp('data-cq-switch="' + C(30) + '">Make it a normal prospect<').test(H) && new RegExp('data-cq-remove="' + C(30) + '">Remove<').test(H), H);
  check('a lead reads "Coaster players at X, not on venueplay", with its play and the same two buttons', /Coaster players at Fox &lt;script&gt;alert\(1\)&lt;\/script&gt; Hounds, not on venueplay/.test(H) &&
    /1 round in the last 30 days|2 rounds in the last 30 days, 2 players in the last 7 days/.test(H) && new RegExp('data-cq-switch="' + C(31) + '"').test(H), H);
  check('a venueplay prospect with coaster play: "Coaster players at Prospect With Coasters", marked a prospect', /Coaster players at Prospect With Coasters<\/div><span class="cqtag cqst-prospect">a prospect<\/span>/.test(H), H);
  function btn(attr, id) { return { id: '', disabled: false, textContent: '', getAttribute: function (k) { return k === attr ? id : null; }, closest: function () { return this; } }; }
  T7.onClick({ target: btn('data-cq-switch', C(30)) });
  check('Make it a normal prospect opens hq.html\'s Set up a prospect with the name, the postcode and the coaster id', PREFILL.length === 1 && PREFILL[0].name === 'Sam\'s <b>Bar</b> & Grill' && PREFILL[0].postcode === '4220' && PREFILL[0].coaster_id === C(30), PREFILL);
  ELS.cqName.value = 'Pane Added Hotel'; ELS.cqSuburb.value = 'Tugun'; ELS.cqPostcode.value = '4224'; T7.S.logo = LOGO;
  var addBtn = { id: 'cqAdd', disabled: false, textContent: '' };
  await T7.add(addBtn);
  var padded = DB.vp_coaster_venues.filter(function (c) { return c.name === 'Pane Added Hotel'; })[0] || {};
  check('the add form goes through the real Worker: the row, its suburb and its logo, then the list again with it in', padded.kind === 'coaster' && padded.suburb === 'Tugun' && /venue-logos\/coaster\//.test(padded.logo_url || '') &&
    /Pane Added Hotel is added as a coaster venue/.test(ELS.cqMsg.textContent) && ELS.cqBody.innerHTML.indexOf('Pane Added Hotel') !== -1 && ELS.cqName.value === '', [padded, ELS.cqMsg.textContent]);
  ELS.cqName.value = 'No Postcode Pub'; ELS.cqPostcode.value = '';
  var nAdd = DB.vp_coaster_venues.length; T7.add(addBtn);
  check('the form says what is missing before asking the Worker', /4-digit postcode/.test(ELS.cqMsg.textContent) && DB.vp_coaster_venues.length === nAdd);
  await T7.remove(btn('data-cq-remove', C(31)), C(31));
  check('Remove goes through the real Worker and the lead is gone from the list', !DB.vp_coaster_venues.some(function (c) { return c.id === C(31); }) && ELS.cqBody.innerHTML.indexOf('data-cq-switch="' + C(31) + '"') === -1 && /is removed/.test(ELS.cqMsg.textContent), ELS.cqMsg.textContent);
  check('before migration 153 the section says "not switched on yet" in plain words', /Coaster venues are not switched on yet\. They start working once migration 153 has been run\./.test(T7.sectionHtml({ error: 'Run migration 153 first', need_migration: 153 })));
  var noFor = mk('coasterHq'); ELS.coasterHq.hidden = false;
  W.VP.getClient = function () { return { auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: STAFF } } }); } } }; };
  await W.VPCoaster.load();
  check('a role the Worker refuses (staff) gets no section at all', ELS.coasterHq.hidden === true);
  var sizes = []; PANE.replace(/font-size:\s*([0-9.]+)px/g, function (_, n) { sizes.push(+n); });
  check('nothing in the new section is under 15px (' + sizes.length + ' sizes declared)', sizes.length >= 8 && sizes.every(function (n) { return n >= 15; }), sizes);
  var HQ = readFile('venueplay/app/hq.html');
  check('house rules in the new file: no em or en dash, never "roster", lowercase venueplay, no .dev link', !/[—–]/.test(PANE) && !/roster/i.test(PANE) && !/VenuePlay/.test(PANE) && !/workers\.dev|\.dev\b/.test(PANE));
  check('hq.html loads it with one script line, right after vp-prospects-hq.js', /<script src="vp-prospects-hq\.js"><\/script>\n<script src="vp-coaster-hq\.js"><\/script>/.test(HQ) && (HQ.match(/vp-coaster-hq\.js"/g) || []).length === 1);

  /* hq.html's OWN form: window.hqProspectPrefill and the Set up and send handler, lifted and run. */
  function liftAt(src, start) {
    var i = src.indexOf(start); if (i < 0) throw new Error('cannot find ' + start + ': a test that cannot find its subject cannot fail');
    var k = src.indexOf('{', i + start.length - 1), d = 0, q = null;
    for (; k < src.length; k++) { var ch = src[k];
      if (q) { if (ch === '\\') { k++; continue; } if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) break; } }
    return src.slice(src.indexOf('function', i), k + 1);
  }
  var F = {}, posted = [], panes = [];
  function fel(id) { return F[id] || (F[id] = { id: id, value: '', checked: false, innerHTML: '', textContent: '', disabled: false, ls: {}, classList: { contains: function () { return false; } },
    addEventListener: function (t, f) { this.ls[t] = f; }, focus: function () {}, scrollIntoView: function () {} }); }
  var shown = {};
  var PP = { slides: [] };
  var prefillSrc = liftAt(HQ, 'window.hqProspectPrefill=function(o){');
  var clearSrc = liftAt(HQ, 'function ppCoasterClear(){');
  var goSrc = liftAt(HQ, '$("ppGo").addEventListener("click", function(){');
  var envFns = new Function('$', 'show', 'goPane', 'ppLoadWaiting', 'ppStateNote', 'esc', 'PP', 'errFlash', 'workerPost', 'ppWhen', 'ppThumbs', 'ppPriceNote', 'loadAll', 'window',
    clearSrc + '\nvar prefill=' + prefillSrc + ';\nvar go=' + goSrc + ';\nreturn { prefill: prefill, go: go, clear: ppCoasterClear };');
  var esc7 = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var WIN = { VPCoaster: { load: function () { WIN.reloaded = (WIN.reloaded || 0) + 1; } } };
  var HF = envFns(fel, function (el, on) { shown[typeof el === 'string' ? el : el.id] = on; }, function (p) { panes.push(p); }, function () {}, function () {}, esc7, PP,
    function (id, msg) { F[id] = F[id] || fel(id); F[id].textContent = msg; },
    function (path, body) { posted.push({ path: path, body: body }); return Promise.resolve({ ok: true, venue: { id: U(70), name: body.name }, welcome_sent: true, tv_url: 'https://www.venueplay.com.au/tv?x', login: { email: body.email }, phone: null, slides: 0 }); },
    function () { return ''; }, function () {}, function () {}, function () {}, WIN);
  HF.prefill({ name: 'Sam\'s <b>Bar</b>', postcode: '4220', coaster_id: C(30) });
  check('hq.html: the prefill goes to Venues, opens Set up a prospect, fills the name and postcode, carries the coaster id and says what will happen (escaped)',
    panes[0] === 'venues' && shown.prospectPanel === true && F.ppName.value === 'Sam\'s <b>Bar</b>' && F.ppPostcode.value === '4220' && PP.coasterId === C(30) &&
    /Making <b>Sam&#39;s &lt;b&gt;Bar&lt;\/b&gt;<\/b> a normal prospect/.test(F.ppCoaster.innerHTML) && /normal prospect emails/.test(F.ppCoaster.innerHTML) && shown.ppCoaster === true, [panes, F.ppCoaster && F.ppCoaster.innerHTML]);
  fel('ppEmail').value = 'owner@sams.example'; fel('ppKind').value = 'for_profit'; fel('ppPlayers').value = '10'; fel('ppDelay').value = '90';
  HF.go(); await nextTick(); await nextTick();
  check('Set up and send posts /admin/prospect with coaster_id, then clears it and reloads the coaster section', posted.length === 1 && posted[0].path === '/admin/prospect' && posted[0].body.coaster_id === C(30) &&
    posted[0].body.name === 'Sam\'s <b>Bar</b>' && posted[0].body.postcode === '4220' && PP.coasterId === null && WIN.reloaded === 1, [posted, PP.coasterId, F.ppErr && F.ppErr.textContent]);
  fel('ppName').value = 'Plain Prospect Hotel'; fel('ppEmail').value = 'plain@hotel.example'; fel('ppPostcode').value = '4000'; fel('ppKind').value = 'for_profit'; fel('ppPlayers').value = '10'; fel('ppDelay').value = '90';
  HF.go(); await nextTick(); await nextTick();
  check('an ordinary Set up a prospect (not from a coaster venue) sends no coaster_id', posted.length === 2 && !('coaster_id' in posted[1].body), posted[1]);
  var cancelBtn = /id="ppCoasterCancel"[^>]*style="font-size:15px/.test(HQ) && /id="ppCoaster"[^>]*font-size:15px/.test(HQ);
  check('the new words on the form are 15px', cancelBtn);

  print('');
  if (bad) { print(bad + ' of ' + ran + ' CHECKS FAILED'); throw new Error(bad + ' failed'); }
  print('ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { print('  FAIL ' + (e && e.message) + ' ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
