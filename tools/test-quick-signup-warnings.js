/* QUICK GAME SIGN-UPS ARE WARNED BEFORE DAY 30, TOLD WHEN HQ APPROVES, AND CLUBS ARE CLUBS (18 Nov 2026;
   reports/release-wed-18nov/quick-game-email-gap.md), RUN AND NOT WORD-SEARCHED.

   Runs the REAL billing Worker (tools/rig-billing-worker.js) through its REAL router and its REAL hourly sweep, against the
   rig's fake database (PostgREST-like, paged: offset then limit, at most 1000 rows a read), fake Resend and a fake Mobile
   Message (the SMS provider every text uses, vpaSendSms):
     1. club signals: the link's ?vt= (sent as kind) first, then the venue's name; a club gets a club's paid entry by state
     2. no email: the day 3, 23 and last-day reminders go as TEXTS to the mobile that passed the code, in the send window,
        once each, with no email; then the pause is on time (they were warned)
     3. the sweep reads every page: a quick venue behind 1000 other prospect rows still gets its text
     4. could not be warned (no text provider, or opted out): NOT paused; ONE urgent HQ ticket; held until HQ closes it,
        then paused; a read that fails holds the pause and makes no second ticket
     5. HQ approves a held quick sign-up: the account-ready text goes (no email); a held sign-up with an email gets the
        welcome once and the text says so

   Run from the repo root:  jsc tools/test-quick-signup-warnings.js */
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
if (typeof btoa === 'undefined') { btoa = function (s) { var B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = ''; for (var i = 0; i < s.length; i += 3) { var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2); var n = (a << 16) | ((b || 0) << 8) | (c || 0); o += B[(n >> 18) & 63] + B[(n >> 12) & 63] + (isNaN(b) ? '=' : B[(n >> 6) & 63]) + (isNaN(c) ? '=' : B[n & 63]); } return o; }; }

/* What left the Worker, besides the database: texts (the SMS hook), Stripe and Resend (the rig records those two). */
var MMS = [], MM_BLOCK = [], READS = [];
var TEXTS = [], AUTH = [], JOINS = 0, HITS = {}, AUTH_CAP = 0;
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  /* Mobile Message, the SMS provider (vpaSendSms). MM_BLOCK: numbers the provider says opted out. */
  if (u.indexOf('api.mobilemessage.com.au') !== -1) { var mb = JSON.parse(opts.body).messages[0]; MMS.push(mb);
    var st = MM_BLOCK.indexOf(mb.to) !== -1 ? 'blocked' : 'success';
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ results: [{ status: st, message_id: 'mm_' + MMS.length }] }); } }); }
  if (/\/rest\/v1\/(vp_prospects|vp_admin_audit)\?/.test(u) && method === 'GET') READS.push(u);
  if (u.indexOf('sms-hook.example') !== -1) { TEXTS.push({ headers: (opts && opts.headers) || {}, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } }); }
  /* The durable rate limit (vp_help_hit, the help desk's counter): counted here, per world, as the database counts it. */
  if (u.indexOf('/rest/v1/rpc/vp_help_hit') !== -1) { var hb = JSON.parse(opts.body); HITS[hb.p_key] = (HITS[hb.p_key] || 0) + 1; var allowed = HITS[hb.p_key] <= hb.p_limit;
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(allowed); } }); }
  if (u.indexOf('challenges.cloudflare.com') !== -1) { var ok = JSON.parse(opts.body).response === 'human'; return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ success: ok }); } }); }
  /* PostgREST answers a PATCH with Prefer: return=representation with the rows it changed. The rig answers no body, so
     the one-request-wins claim on a sign-up is modelled here, the way the real database does it. */
  if (method === 'PATCH' && /\/rest\/v1\/vp_signup_starts\?/.test(u) && /return=representation/.test(JSON.stringify((opts && opts.headers) || {}))) {
    var qs = u.split('?')[1].split('&'), want = {}; qs.forEach(function (p) { var i = p.indexOf('='); var k = p.slice(0, i), v = decodeURIComponent(p.slice(i + 1)); if (/^eq\./.test(v)) want[k] = v.slice(3); });
    var ch = JSON.parse(opts.body), hit2 = (DB.vp_signup_starts || []).filter(function (r) { for (var k in want) if (String(r[k]) !== want[k]) return false; return true; });
    hit2.forEach(function (r) { for (var k in ch) r[k] = ch[k]; });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(hit2.map(function (r) { return { id: r.id }; })); } });
  }
  /* The database gives every new venue its join code (migration 91's trigger); the fake does the same. */
  if (method === 'POST' && /\/rest\/v1\/vp_venues$/.test(u)) { var vb = JSON.parse(opts.body); if (vb && !Array.isArray(vb) && !vb.join_code) { vb.join_code = 'TV' + ('0000' + (++JOINS)).slice(-4); opts = Object.assign({}, opts, { body: JSON.stringify(vb) }); } }
  if (u.indexOf('/auth/v1/admin/users') !== -1) {
    var one = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(u);
    var RS = function (st, b) { return Promise.resolve({ ok: st < 300, status: st, json: function () { return Promise.resolve(b); }, text: function () { return Promise.resolve(JSON.stringify(b)); } }); };
    if (FAIL['auth:GET'] > 0 && method === 'GET') { FAIL['auth:GET']--; return RS(503, {}); }
    if (method === 'POST') { var b = JSON.parse(opts.body); var nu = { id: newId(), email: b.email || '', phone: b.phone ? String(b.phone).replace('+', '') : '' }; AUTH.push(nu); return RS(200, nu); }
    if (one) { var hit = AUTH.filter(function (x) { return x.id === one[1]; })[0]; return hit ? RS(200, hit) : RS(404, {}); }
    /* Paged as Auth pages it (page from 1, per_page): a fake that answers every page with everyone never ends. */
    var pg = /[?&]page=(\d+)/.exec(u), pp = /[?&]per_page=(\d+)/.exec(u);
    var per = pp ? +pp[1] : 50, from = ((pg ? +pg[1] : 1) - 1) * per;
    /* AUTH_CAP: an Auth whose own maximum page sits below the size asked for, so EVERY page is short. */
    var give = AUTH_CAP ? Math.min(per, AUTH_CAP) : per; from = ((pg ? +pg[1] : 1) - 1) * give;
    return RS(200, { users: AUTH.slice(from, from + give) });
  }
  return rigFetch(url, opts);
};
function U(nn) { return '61000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9001), ACCTS = U(9002), STAFFADMIN = U(9003);
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; TEXTS = []; AUTH = []; AUTH_CAP = 0; MMS = []; MM_BLOCK = []; READS = [];
  ENV.MOBILEMESSAGE_USERNAME = 'mm-user'; ENV.MOBILEMESSAGE_PASSWORD = 'mm-pass'; delete ENV.CLICKSEND_USERNAME; delete ENV.CLICKSEND_API_KEY;
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: STAFFADMIN, label: 'Helper', role: 'staff' }];
  ['vp_venues', 'venueplay_founding', 'vp_venue_staff', 'vp_admin_audit', 'vp_venue_settings', 'vp_screens', 'vp_venue_screen', 'vp_signin_links',
   'vp_prospect_welcomes', 'vp_prospects', 'vp_help_tickets', 'vp_sessions', 'vp_signup_starts', 'vp_licensed_venues'].forEach(function (t) { DB[t] = []; });
  ENV.SEND_SMS_HOOK_URL = 'https://sms-hook.example/'; ENV.SEND_SMS_HOOK_SECRET = 'dGVzdC1zZWNyZXQtb25seQ==';
  rateLimitReset();
}
/* The in-memory rate limits (helpLimit falls back to them when the rig's rpc answers 0) belong to one world. */
function rateLimitReset() { HITS = {}; }
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
  return { status: res.status, body: parsed || {}, headers: res.headers || {} };
}
var AS = function (who, venue) { var h = { Authorization: 'Bearer ' + who }; if (venue) h['X-VP-Venue'] = venue; return h; };
var N = 100;
/* An account with one venue and its owner login. */
function account(o) {
  o = o || {}; var n = ++N;
  var fid = U(n), vid = U(n + 500), owner = U(n + 1000);
  DB.venueplay_founding.push({ id: fid, venue_name: o.name || 'Venue ' + n, contact_email: o.email || ('owner' + n + '@venue.example'), contact_name: o.contact || 'Owner',
    mobile: o.mobile || null, status: o.status || 'active', plan: 'monthly', stripe_subscription_id: o.sub || null, created_at: '2026-10-01T00:00:00.000Z' });
  DB.vp_venues.push({ id: vid, name: o.name || 'Venue ' + n, slug: 'venue-' + n, postcode: ('postcode' in o) ? o.postcode : '4000', founding_id: fid, group_id: null,
    status: o.venueStatus || 'active', suspended_reason: o.reason || null, max_players: 10, created_at: '2026-10-01T00:00:00.000Z' });
  DB.vp_venue_staff.push({ venue_id: vid, auth_user_id: owner, role: 'owner' });
  if (o.login !== false) AUTH.push({ id: owner, email: o.email || ('owner' + n + '@venue.example'), phone: o.phone || '' });
  return { fid: fid, vid: vid, owner: owner };
}
function tickets() { return DB.vp_help_tickets || []; }
function alerts() { return sent.filter(function (m) { return /Same venue, another account/.test(m.subject || ''); }); }

function lastCode() { return TEXTS.length ? TEXTS[TEXTS.length - 1].body.sms.otp : null; }
function listed() {
  DB.vp_licensed_venues = [
    { id: 1, name: 'The Grand Hotel', name_key: 'grand-hotel', postcode: '4217', suburb: 'Surfers Paradise', au_state: 'QLD', source: 'venue master list' },
    { id: 2, name: 'Royal Hotel', name_key: 'royal-hotel', postcode: '4000', suburb: 'Brisbane', au_state: 'QLD', source: 'send list' },
    { id: 3, name: 'Railway Hotel', name_key: 'railway-hotel', postcode: '4350', suburb: 'Toowoomba', au_state: 'QLD', source: 'send list' },
    { id: 4, name: 'Commercial Hotel', name_key: 'commercial-hotel', postcode: '2800', suburb: 'Orange', au_state: 'NSW', source: 'send list' } ];
}
var FIVE = { venue: 'the grand hotel', postcode: '4217', kind: 'pub', name: 'Sam Jones', mobile: '0412 345 678', email: 'sam@grandhotel.example' };
function five(o) { var b = {}; for (var k in FIVE) b[k] = FIVE[k]; for (var k2 in (o || {})) b[k2] = o[k2]; return b; }
var IP = 0;
function NET() { return { 'cf-connecting-ip': '10.0.0.' + (++IP) }; }
async function start(o) {
  var r = await call('/start/begin', five(o), NET());
  if (r.status !== 200) return { begin: r };
  var v = await call('/start/verify', { start_id: r.body.start_id, code: lastCode(), kind: five(o).kind }, NET());
  return { begin: r, verify: v, id: r.body.start_id };
}
function count(t) { return (DB[t] || []).length; }
function snapshot() { return { f: count('venueplay_founding'), v: count('vp_venues'), auth: AUTH.length, s: count('vp_venue_staff'), p: count('vp_prospects') }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function qbegin(o) {
  var b = { name: 'Sam', mobile: '0412 345 678', venue: 'The Grand Hotel', postcode: '4217' };
  for (var k in (o || {})) b[k] = o[k];
  return await call('/quick/begin', b, NET());
}
async function qstart(o) {
  var r = await qbegin(o);
  if (r.status !== 200 || !r.body.start_id) return { begin: r };
  var v = await call('/start/verify', { start_id: r.body.start_id, code: lastCode() }, NET());
  return { begin: r, verify: v, id: r.body.start_id };
}
function bne(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 10, mi || 0); }   // a Brisbane wall-clock time as epoch ms
var FIRST = bne(2026, 11, 2, 10, 0);   // first sign-in Mon 2 Nov: day 3 Thu 5 Nov, 23 Wed 25 Nov, 30 Wed 2 Dec (the month's last day)
var AFTER = bne(2026, 12, 3, 9, 0);    // Thu 3 Dec, the month is over
function venueOf(s) { var vid = DB.vp_signup_starts.filter(function (r) { return r.id === s.id; })[0].venue_id; return DB.vp_venues.filter(function (v) { return v.id === vid; })[0]; }
function prospectOf(v) { return DB.vp_prospects.filter(function (p) { return p.venue_id === v.id; })[0]; }
/* A quick game account, signed in on FIRST: migration 127's columns as the real database has them, the month started by the Worker. */
async function quickSignedIn(o) {
  var s = await qstart(o);
  if (!s.verify || s.verify.body.outcome !== 'made') throw new Error('quick account not made ' + JSON.stringify(s.verify || s.begin));
  var v = venueOf(s); if (!v.status) v.status = 'active'; if (!('suspended_reason' in v)) v.suspended_reason = null;
  var p = prospectOf(v);
  ['first_signin_at', 'free_month_ends_at', 'card_choice', 'card_choice_at', 'paused_at', 'cancelled_at', 'offer_rate'].forEach(function (k) { if (!(k in p)) p[k] = null; });
  if (!('reminders_sent' in p)) p.reminders_sent = [];
  await vpaProspectStartMonth(ENV, p, FIRST);
  return { s: s, v: v, p: function () { return prospectOf(v); } };
}
async function walk(fromMs, toMs, stepMs) { var at = []; for (var t = fromMs; t <= toMs; t += (stepMs || 3600000)) { var n = MMS.length; await vpaProspectReminderSweep(ENV, t); for (var i = n; i < MMS.length; i++) at.push(t); } return at; }
function REMS() { return MMS.filter(function (m) { return /^rem-/.test(m.custom_ref || ''); }); }   // the card reminders, not the account-ready text
function bneHour(ms) { return new Date(ms + 10 * 3600000).getUTCHours(); }
function inWindow(ms) { var h = bneHour(ms); return (h >= 9 && h < 12) || (h >= 14 && h < 17); }
function heldTickets(v) { return tickets().filter(function (t) { return t.venue_id === v.id && /could not warn/.test(t.subject || ''); }); }
var LIFT_SRC = (function () { try { return readFile('venueplay/app/vp-quick.js'); } catch (e) { return readFile('../venueplay/app/vp-quick.js'); } })();

async function main() {
  section('1. Pub or club: the link first, then the name; a club gets a club\'s paid entry by state');
  world(); listed();
  var club = async function (o) { var s = await qstart(o); return s.verify && s.verify.body.outcome === 'made' ? venueOf(s) : { failed: s }; };
  var c1 = await club({ venue: 'Orange Ex-Services Club', postcode: '2800', mobile: '0412 000 001' });
  check('a club\'s name in NSW: a club (non_profit), paid entry on (NSW allows it for clubs)', c1.entity_type === 'non_profit' && c1.paid_entry_enabled === true, c1);
  check('...and the start row says so too', DB.vp_signup_starts.filter(function (r) { return r.venue_name === 'Orange Ex-Services Club'; })[0].entity_type === 'non_profit');
  var c2 = await club({ venue: 'Kedron Wavell RSL', postcode: '4031', mobile: '0412 000 002' });
  check('an RSL in QLD: a club, paid entry OFF (QLD blocks it, the club rule by state)', c2.entity_type === 'non_profit' && c2.paid_entry_enabled === false, c2);
  var c3 = await club({ venue: 'Club Hotel', postcode: '2800', mobile: '0412 000 003' });
  check('"Club Hotel" is a pub (a pub word wins over club)', c3.entity_type === 'for_profit' && c3.paid_entry_enabled === false, c3);
  var c4 = await club({ venue: 'Commercial Hotel', postcode: '2800', mobile: '0412 000 004', kind: 'club' });
  check('?vt=club (kind club) wins over a pub name: a club', c4.entity_type === 'non_profit' && c4.paid_entry_enabled === true, c4);
  var c5 = await club({ venue: 'Orange RSL', postcode: '2800', mobile: '0412 000 005', kind: 'pub' });
  check('?vt=pub (kind pub) wins over a club name: a pub', c5.entity_type === 'for_profit', c5);
  var c6 = await club({ venue: 'Railway Hotel', postcode: '4350', mobile: '0412 000 006', kind: 'bar' });
  var c7 = await club({ venue: 'The Bowlo', postcode: '2830', mobile: '0412 000 007', kind: 'bar' });
  check('a kind we do not know is no answer: the name decides (a hotel a pub, a bowlo a club)', c6.entity_type === 'for_profit' && c7.entity_type === 'non_profit', [c6.entity_type, c7.entity_type]);
  check('the shared rule, one copy: vpqKindFor', vpqKindFor('CLUB', 'x') === 'non_profit' && vpqKindFor('', 'Grand Hotel') === 'for_profit' && vpqKindFor(null, 'Merrylands Bowls Club') === 'non_profit' && vpqKindFor(null, 'Leagues Tavern') === 'for_profit');
  /* The page's own line, run: ?vt= is sent as kind (vp-quick.js, shared with the offer page's quick form). */
  var line = (/\n(\s*var vt = [^\n]+)/.exec(LIFT_SRC) || [])[1] || '';
  function pageKind(search) { var root = { location: { search: search } }, body = {}; (new Function('root', 'body', line))(root, body); return body.kind; }
  check('the page sends ?vt=club and ?vt=PUB as kind, and nothing for ?vt=bar or no ?vt', !!line && pageKind('?vt=club') === 'club' && pageKind('?src=x&vt=PUB') === 'pub' && pageKind('?vt=bar') === undefined && pageKind('') === undefined, [line, pageKind('?vt=club')]);

  section('2. No email: every reminder goes as a text to the mobile that passed the code');
  world(); listed();
  var A = await quickSignedIn({});
  check('set up: a quick account, no email anywhere, its month started on Mon 2 Nov', !A.p().email && A.p().first_signin_at === new Date(FIRST).toISOString(), A.p());
  var mailsBefore = sent.length;
  check('the account-ready text went when it was made (the existing path), and is not a reminder', MMS.length === 1 && /^ready-/.test(MMS[0].custom_ref), MMS);
  MMS = [];
  var at = await walk(FIRST, bne(2026, 12, 4, 17, 0));
  check('three texts and no more: day 3, day 23 and the last day', MMS.length === 3 && JSON.stringify(A.p().reminders_sent) === '[3,23,30]', [MMS.length, A.p().reminders_sent]);
  check('on their days: Thu 5 Nov, Wed 25 Nov, Wed 2 Dec', at.map(function (t) { return vpaBneDay(t); }).join(' ') === '2026-11-05 2026-11-25 2026-12-02', at.map(function (t) { return vpaBneDay(t); }));
  check('each inside the send window (9 to 12, 2 to 5, the venue\'s own time)', at.length === 3 && at.every(inWindow), at.map(bneHour));
  check('to the mobile that passed the code, in +61 form, from venueplay', MMS.every(function (m) { return m.to === '+61412345678' && m.sender === 'venueplay'; }), MMS);
  check('the words: their name and venue, the date, how to add the card, and the opt-out', /^Hi Sam, how is venueplay going at The Grand Hotel\? Your first month ends on Wed 2 December\./.test(MMS[0].message) && /venueplay\.com\.au\/app/.test(MMS[0].message) && /\{optout\}$/.test(MMS[0].message), MMS[0].message);
  check('one week left names the end and the pause', /^Hi Sam, your first month of venueplay at The Grand Hotel ends on Wed 2 December\./.test(MMS[1].message) && /pause then/.test(MMS[1].message), MMS[1].message);
  check('the last day says today and tonight', /today is the last day of your first month/.test(MMS[2].message) && /pause tonight/.test(MMS[2].message), MMS[2].message);
  check('no "free", no long dash, no link, no capital-V brand in any text', MMS.every(function (m) { return !/free|Free|\u2014|\u2013|https?:|VenuePlay/.test(m.message); }), MMS.map(function (m) { return m.message; }));
  check('no email went (none is held), and none to a placeholder', sent.length === mailsBefore, sent.slice(mailsBefore).map(function (m) { return m.subject; }));
  check('each text is audited as a card reminder sent by text', DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_reminder_sent' && a.detail.via === 'text'; }).length === 3);
  check('warned, so the pause is on time (Thu 3 Dec), and no HQ ticket', A.v.status === 'suspended' && A.v.suspended_reason === 'free_month_ended' && !!A.p().paused_at && heldTickets(A.v).length === 0, [A.v.status, A.p().paused_at]);

  section('3. The sweep reads every page: a quick venue behind 1000 other prospect rows');
  world(); listed();
  var P = await quickSignedIn({});
  for (var i = 0; i < 1000; i++) DB.vp_prospects.push({ venue_id: '00000000-0000-4000-8000-' + ('000000000000' + i).slice(-12), cancelled_at: null, paused_at: null, first_signin_at: null, reminders_sent: [] });
  READS = []; MMS = [];
  await vpaProspectReminderSweep(ENV, bne(2026, 11, 5, 9, 30));
  var pages = READS.filter(function (u) { return /vp_prospects\?cancelled_at=is\.null/.test(u); });
  check('two pages read (offset 0 and 1000), not one', pages.length >= 2 && /offset=1000/.test(pages[1] || ''), pages);
  check('the venue on the second page got its day 3 text', MMS.length === 1 && JSON.stringify(P.p().reminders_sent) === '[3]', [MMS.length, P.p().reminders_sent]);

  section('4. Could not be warned: never paused before HQ has seen it');
  world(); listed();
  delete ENV.MOBILEMESSAGE_USERNAME; delete ENV.MOBILEMESSAGE_PASSWORD;   // no text provider
  var H = await quickSignedIn({});
  var out = await vpaProspectReminderSweep(ENV, bne(2026, 11, 5, 9, 30));
  check('no provider: the day 3 text stays due (nothing marked sent) and the sweep says why', JSON.stringify(H.p().reminders_sent) === '[]' && out.text_not_sent && out.text_not_sent[0].why === 'no text provider', out);
  await walk(bne(2026, 11, 5, 10, 0), bne(2026, 12, 2, 23, 0), 3 * 3600000);
  var o1 = await vpaProspectReminderSweep(ENV, AFTER);
  check('the month ends unwarned: NOT paused, the venue stays on', H.v.status === 'active' && !H.p().paused_at && (o1.held || []).indexOf(H.v.id) !== -1, [H.v.status, o1]);
  var hk = heldTickets(H.v);
  check('ONE urgent sales ticket for HQ, with their name, mobile and venue, saying it is not paused', hk.length === 1 && hk[0].priority === 'urgent' && hk[0].category === 'sales' && /NOT been paused/.test(hk[0].message) && /0412 345 678/.test(hk[0].message) && /The Grand Hotel/.test(hk[0].message), hk);
  check('...recorded once in the audit with the ticket', DB.vp_admin_audit.filter(function (a) { return a.action === 'prospect_pause_held' && a.target === 'venue:' + H.v.id && a.detail.ticket_id === hk[0].id; }).length === 1);
  await walk(AFTER + 3600000, AFTER + 48 * 3600000, 3600000);
  check('two more days of sweeps: still on, still ONE ticket', H.v.status === 'active' && heldTickets(H.v).length === 1, heldTickets(H.v).length);
  hk[0].status = 'waiting';
  await vpaProspectReminderSweep(ENV, AFTER + 49 * 3600000);
  check('a ticket HQ has answered but not closed: still held', H.v.status === 'active');
  hk[0].status = 'closed';
  FAIL['vp_help_tickets:GET'] = 1;
  await vpaProspectReminderSweep(ENV, AFTER + 50 * 3600000);
  check('HQ closed it but the ticket read fails: held, no second ticket', H.v.status === 'active' && heldTickets(H.v).length === 1);
  await vpaProspectReminderSweep(ENV, AFTER + 51 * 3600000);
  check('HQ closed the ticket: the next sweep pauses it, as any other', H.v.status === 'suspended' && H.v.suspended_reason === 'free_month_ended' && !!H.p().paused_at, [H.v.status, H.p().paused_at]);
  check('an audit read that fails holds the pause and makes no ticket', await (async function () {
    world(); listed(); delete ENV.MOBILEMESSAGE_USERNAME; delete ENV.MOBILEMESSAGE_PASSWORD;
    var F = await quickSignedIn({ mobile: '0412 345 679' });
    FAIL['vp_admin_audit:GET'] = 1;
    await vpaProspectReminderSweep(ENV, AFTER);
    return F.v.status === 'active' && heldTickets(F.v).length === 0;
  })());
  world(); listed();
  var O = await quickSignedIn({});
  MM_BLOCK.push('+61412345678');
  await walk(bne(2026, 11, 5, 9, 0), bne(2026, 11, 5, 12, 0));
  check('a mobile the provider says opted out: recorded, the reminder not marked sent', JSON.stringify(O.p().reminders_sent) === '[]' && DB.vp_admin_audit.some(function (a) { return a.action === 'sms_opted_out' && a.target === 'sms:+61412345678'; }));
  var before = MMS.length;
  await walk(bne(2026, 11, 25, 9, 0), bne(2026, 12, 2, 17, 0));
  check('...and is never texted again (checked before each send)', MMS.length === before, MMS.length - before);
  await vpaProspectReminderSweep(ENV, AFTER);
  check('...so at the end it is held for HQ, not paused', O.v.status === 'active' && heldTickets(O.v).length === 1);

  section('5. HQ approves a held sign-up: the same account-ready message');
  world(); listed();
  var first = await qstart({});
  var held = await qstart({ venue: 'Royal Hotel', postcode: '4000' });
  check('set up: the same mobile again is held for HQ', held.verify && held.verify.body.outcome === 'held', held.verify);
  var mails0 = sent.length, mm0 = MMS.length;
  var ap = await call('/admin/signup-start/decide', { start_id: held.id, decision: 'approve' }, AS(ADMIN));
  check('approved: the account is made', ap.status === 200 && ap.body.outcome === 'approved', ap);
  var readyTexts = MMS.slice(mm0);
  check('the account-ready text goes to their mobile (no email held), naming the venue', readyTexts.length === 1 && readyTexts[0].to === '+61412345678' && /^Welcome to venueplay! Your account for Royal Hotel is ready\./.test(readyTexts[0].message) && !/emailed/.test(readyTexts[0].message), readyTexts);
  check('no email to anyone, and never to the placeholder login address (the welcome went there before 18 Nov)', sent.length === mails0 && !ap.body.welcome_sent, sent.slice(mails0).map(function (m) { return [m.to, m.subject]; }));
  check('the answer says it was texted, and the ready audit is there once', ap.body.ready && ap.body.ready.texted === true && DB.vp_admin_audit.filter(function (a) { return a.action === 'signup_ready_sent' && a.target === 'venue:' + ap.body.venue.id; }).length === 1, ap.body.ready);
  var ap2 = await call('/admin/signup-start/decide', { start_id: held.id, decision: 'approve' }, AS(ADMIN));
  check('a second tap decides nothing and texts nothing', ap2.status === 409 && MMS.length === mm0 + 1, ap2);
  /* A held /start sign-up WITH an email: the welcome goes, once; the text says we emailed. */
  world(); listed();
  await start({});
  var hs = await start({ venue: 'Royal Hotel', postcode: '4000', email: 'other@royal.example' });
  check('set up: a /start sign-up with an email, held (same mobile)', hs.verify && hs.verify.body.outcome === 'held', hs.verify);
  var m1 = sent.length, mm1 = MMS.length;
  var ap3 = await call('/admin/signup-start/decide', { start_id: hs.id, decision: 'approve' }, AS(ACCTS));
  var toThem = sent.slice(m1).filter(function (m) { return JSON.stringify(m.to) .indexOf('other@royal.example') !== -1; });
  check('approved with an email: the welcome went ONCE (no second welcome from the ready path)', ap3.status === 200 && ap3.body.welcome_sent === true && toThem.length === 1, [ap3.body, toThem.map(function (m) { return m.subject; })]);
  check('...and the text says the login was emailed too', MMS.length === mm1 + 1 && /We've emailed your login too/.test(MMS[mm1].message), MMS.slice(mm1));

  print('');
  if (bad) print(bad + ' of ' + ran + ' checks FAILED'); else print('ALL ' + ran + ' CHECKS PASSED');
}

var done = false;
main().then(function () { done = true; }, function (e) { bad++; print('  FAIL the suite threw: ' + (e && e.stack || e)); done = true; });
drainMicrotasks();
if (!done) print('  FAIL the suite never finished');
