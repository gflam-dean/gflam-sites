/* JOURNEY TRACKING (INBOX 413, 15 Nov 2026), RUN NOT WORD-SEARCHED: POST /track, GET /track/lookup, the scanner filter, the HQ funnel. Same rig as test-quick-start.js.
   Run from the repo root:  jsc tools/test-journey-track.js */
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
var TEXTS = [], AUTH = [], JOINS = 0, HITS = {}, AUTH_CAP = 0;
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
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
  /* A batch insert (PostgREST takes an array; the rig's fake takes one row): each row is filed as the database would. */
  if (method === 'POST' && /\/rest\/v1\/vp_journey_events$/.test(u) && !FAIL['vp_journey_events:POST']) { var arr = JSON.parse(opts.body); arr = Array.isArray(arr) ? arr : [arr];
    arr.forEach(function (r) { r.id = (DB.vp_journey_events.length + 1); r.at = r.at || '2026-11-16T00:00:00.000Z'; r.venue_id = r.venue_id || null; DB.vp_journey_events.push(r); });
    return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve(arr); }, text: function () { return Promise.resolve(''); } }); }
  return rigFetch(url, opts);
};
function U(nn) { return '61000000-0000-4000-8000-' + ('000000000000' + nn).slice(-12); }
var ADMIN = U(9001), ACCTS = U(9002), STAFFADMIN = U(9003);
function world() {
  DB = {}; sent.length = 0; stripeCalls.length = 0; FAIL = {}; TEXTS = []; AUTH = []; AUTH_CAP = 0;
  DB.vp_journey_events = []; DB.vp_track_links = []; CF = {};
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: STAFFADMIN, label: 'Helper', role: 'staff' }];
  ['vp_venues', 'venueplay_founding', 'vp_venue_staff', 'vp_admin_audit', 'vp_venue_settings', 'vp_screens', 'vp_venue_screen', 'vp_signin_links',
   'vp_prospect_welcomes', 'vp_prospects', 'vp_help_tickets', 'vp_sessions', 'vp_signup_starts', 'vp_licensed_venues'].forEach(function (t) { DB[t] = []; });
  ENV.SEND_SMS_HOOK_URL = 'https://sms-hook.example/'; ENV.SEND_SMS_HOOK_SECRET = 'dGVzdC1zZWNyZXQtb25seQ==';
  rateLimitReset();
}
/* The in-memory rate limits (helpLimit falls back to them when the rig's rpc answers 0) belong to one world. */
function rateLimitReset() { HITS = {}; }
var CF = {};
function req(path, body, headers, method) {
  var h = {}; for (var k in (headers || {})) h[k.toLowerCase()] = headers[k];
  var txt = body === undefined ? '' : JSON.stringify(body);
  return { cf: CF, method: method || 'POST', url: 'https://venueplay-api.example' + path,
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
/* ---- the world ---- */
var PERSON_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
var DESK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
var SID = 'a1b2c3d4e5f60718293a4b5c';
var SID2 = 'b1b2c3d4e5f60718293a4b5d';
function addLink(o) {
  var code = o.code || 'MPYXPG';
  return helpSha256Hex('vp-track-v1|track|' + code).then(function (h) {
    DB.vp_track_links.push({ id: o.id || (DB.vp_track_links.length + 1), code_hash: h, lead_ref: o.lead_ref || 'L1', venue_name: o.venue || 'The Grand Hotel', first_name: o.first || 'Sam', state: 'QLD',
      likely_games: o.games || ['trivia', 'bingo'], campaign: o.campaign || 'offer-nov', email_step: o.step || 1, link_label: o.label || 'play-button', page: 'offer-nov',
      sent_at: o.sent_at || null, expires_at: o.expires || '2027-06-01T00:00:00.000Z', revoked_at: o.revoked || null, venue_id: o.venue_id || null });
  });
}
function hdr(ua, extra) { var h = { 'user-agent': ua || PERSON_UA, 'cf-connecting-ip': '10.1.0.' + (++IP) }; for (var k in (extra || {})) h[k] = extra[k]; return h; }
var IP = 0;
async function track(batch, ua, extra) { return await call('/track', batch, hdr(ua, extra)); }
function ev(e, p, age) { var o = { e: e }; if (p) o.p = p; if (age) o.age = age; return o; }
function rows() { return DB.vp_journey_events; }
function ofSid(s) { return rows().filter(function (r) { return r.sid === s; }); }

(async function () {
  world();
  section('1. /track: a normal visitor');
  CF = { regionCode: 'QLD', country: 'AU', asn: 1221 };
  var r = await track({ sid: SID, path: '/quick', ref: 'www.google.com.au', events: [ev('page_opened'), ev('button_tapped', { btn: 'Play a quick game' })] });
  check('answers ok', r.status === 200 && r.body.ok === true, r);
  check('two rows kept', ofSid(SID).length === 2, rows());
  var row = ofSid(SID)[0];
  check('region is the AU state from Cloudflare', row.region === 'QLD', row);
  check('referrer is a FAMILY (google), never the URL', row.ref_source === 'google', row);
  check('device kind from the UA, no UA kept', row.device === 'mobile' && !('ua' in row) && JSON.stringify(row).indexOf('Mozilla') < 0, row);
  check('no IP, no user agent anywhere in the stored row', JSON.stringify(rows()).indexOf('10.1.0.') < 0 && JSON.stringify(rows()).indexOf('iPhone') < 0, rows());
  check('source is website with no code', row.src === 'website' && row.link_id === null, row);

  section('2. /track: the same answer to rubbish, nothing kept');
  var n0 = rows().length;
  var rubbish = [
    await track({ sid: 'nope', events: [ev('page_opened')] }),
    await track({ sid: SID, events: [ev('made_up_step')] }),
    await track({ sid: SID, events: [] }),
    await call('/track', { sid: SID, events: [ev('page_opened')] }, { 'cf-connecting-ip': '10.9.9.9' }),               // no user agent
    await track({ sid: SID, events: [ev('page_opened')] }, 'Googlebot/2.1 (+http://www.google.com/bot.html)'),            // a crawler
    await track({ sid: SID, events: [ev('page_opened')] }, PERSON_UA, { dnt: '1' }) ];                                    // Do Not Track
  check('every rubbish request answers 200 {ok:true}', rubbish.every(function (x) { return x.status === 200 && x.body.ok === true; }), rubbish.map(function (x) { return x.status; }));
  check('none of them kept a row', rows().length === n0, rows().length - n0);
  var big = { sid: SID, events: [ev('page_opened')], pad: new Array(7000).join('x') };
  await track(big); check('an over-size body is dropped', rows().length === n0);
  var many = []; for (var i = 0; i < 40; i++) many.push(ev('page_opened'));
  await track({ sid: SID2, events: many }); check('a batch is capped at 12 events', ofSid(SID2).length === 12, ofSid(SID2).length);

  section('3. props: only the whitelist, nothing personal can ride in');
  await track({ sid: SID, events: [ev('form_abandon', { field: 'contact', ms: 4200, email: 'sam@x.com', name: 'Sam', mobile: '0412345678', note: 'hello' }),
    ev('venue_search_none', { q: 'The Wobbly Goat 0412 345 678 sam@x.com' })] });
  var ab = ofSid(SID).filter(function (x) { return x.event === 'form_abandon'; })[0];
  check('form_abandon keeps field + ms and drops email, name, mobile, note', ab && ab.props.field === 'contact' && ab.props.ms === 4200 && Object.keys(ab.props).length === 2, ab);
  var sn = ofSid(SID).filter(function (x) { return x.event === 'venue_search_none'; })[0];
  check('the search text keeps the words, loses digits and @', sn && sn.props.q.indexOf('0412') < 0 && sn.props.q.indexOf('@') < 0 && /Wobbly Goat/.test(sn.props.q), sn);
  check('q is only ever kept on venue_search_none', ofSid(SID).filter(function (x) { return x.event !== 'venue_search_none' && x.props && x.props.q; }).length === 0);
  var pa = await track({ sid: SID, path: '/offer-nov/MPYXPG', events: [ev('page_view')] });
  check('a code in the path is replaced by :code', ofSid(SID).filter(function (x) { return x.path === '/offer-nov/:code'; }).length === 1 && JSON.stringify(rows()).indexOf('MPYXPG') < 0, rows().map(function (x) { return x.path; }));

  section('4. tracked link: a person hit is logged against the link');
  await addLink({ code: 'MPYXPG', id: 7, venue_id: null, sent_at: '2026-11-16T00:00:00.000Z' });
  CF = { regionCode: 'NSW', country: 'AU', asn: 1221 };
  var h = await track({ sid: SID2, code: 'MPYXPG', path: '/offer-nov/MPYXPG', events: [ev('link_hit'), ev('page_view')] }, DESK_UA);
  var hits = ofSid(SID2).filter(function (x) { return x.event === 'link_hit'; });
  check('a link_hit row exists, tied to the link, source cold_email', hits.length === 1 && hits[0].link_id === 7 && hits[0].src === 'cold_email' && hits[0].scanner === false, hits);
  check('the page_view in the same batch is tied to the link too', ofSid(SID2).filter(function (x) { return x.event === 'page_view' && x.link_id === 7; }).length === 1);
  check('region is the state', hits[0].region === 'NSW', hits[0]);
  var sub = await track({ sid: SID, code: 'ZZZZZZ', events: [ev('page_opened'), ev('link_hit')] });
  check('an unknown code: ok, no link_hit, the other event is kept with no link', sub.body.ok === true && ofSid(SID).filter(function (x) { return x.event === 'link_hit'; }).length === 0 && ofSid(SID).slice(-1)[0].link_id === null && ofSid(SID).slice(-1)[0].src === 'website');
  var cl = await track({ sid: 'c1b2c3d4e5f60718293a4b5e', code: 'MPYXPG', src: 'cold_email', events: [ev('page_opened')] });
  check('src=cold_email with a real code is cold email', rows().filter(function (x) { return x.sid === 'c1b2c3d4e5f60718293a4b5e'; })[0].src === 'cold_email');
  var cl2 = await track({ sid: 'd1b2c3d4e5f60718293a4b5f', code: 'QQQQQQ', src: 'cold_email', events: [ev('page_opened')] });
  check('src=cold_email with an unknown code becomes website', rows().filter(function (x) { return x.sid === 'd1b2c3d4e5f60718293a4b5f'; })[0].src === 'website');

  section('5. scanner filter');
  await addLink({ code: 'SCNR22', id: 8, lead_ref: 'L2', sent_at: '2026-11-16T00:00:00.000Z' });
  var RealNow = Date.now;
  Date.now = function () { return Date.parse('2026-11-16T00:00:20.000Z'); };
  var sUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  var sc1 = await track({ sid: 'e1b2c3d4e5f60718293a4b60', code: 'SCNR22', events: [ev('link_hit')] }, sUa);
  var s1 = ofSid('e1b2c3d4e5f60718293a4b60')[0];
  check('a hit 20 s after the send is a scanner (timing, soft)', s1.event === 'scanner_hit' && s1.scanner === true && s1.props.why === 'timing' && s1.props.hard === false, s1);
  Date.now = function () { return Date.parse('2026-11-16T03:00:00.000Z'); };
  var sc2 = await track({ sid: 'e2b2c3d4e5f60718293a4b61', code: 'SCNR22', events: [ev('link_hit')] }, 'Mozilla/5.0 (compatible; MSIE 9.0) Proofpoint/ URL Defense');
  check('a Proofpoint user agent is a HARD scanner', ofSid('e2b2c3d4e5f60718293a4b61')[0].event === 'scanner_hit' && ofSid('e2b2c3d4e5f60718293a4b61')[0].props.hard === true);
  CF = { regionCode: 'VIC', country: 'AU', asn: 8075 };   // the network number alone; no organisation name to fall back on
  var sc3 = await track({ sid: 'e3b2c3d4e5f60718293a4b62', code: 'SCNR22', events: [ev('link_hit')] }, sUa);
  check('a Microsoft network hit is a soft scanner (asn)', ofSid('e3b2c3d4e5f60718293a4b62')[0].event === 'scanner_hit' && ofSid('e3b2c3d4e5f60718293a4b62')[0].props.why === 'asn' && ofSid('e3b2c3d4e5f60718293a4b62')[0].props.hard === false);
  var sc4 = await track({ sid: 'e4b2c3d4e5f60718293a4b63', code: 'SCNR22', wd: true, events: [ev('link_hit')] }, PERSON_UA);
  check('a webdriver browser is a hard scanner', ofSid('e4b2c3d4e5f60718293a4b63')[0].event === 'scanner_hit' && ofSid('e4b2c3d4e5f60718293a4b63')[0].props.why === 'webdriver');
  await track({ sid: 'e4b2c3d4e5f60718293a4b63', code: 'SCNR22', events: [ev('page_view'), ev('human')] }, PERSON_UA);
  check('a hard scanner later events stay scanner and never upgrade', ofSid('e4b2c3d4e5f60718293a4b63').every(function (x) { return x.scanner === true; }) && ofSid('e4b2c3d4e5f60718293a4b63').filter(function (x) { return x.event === 'link_hit'; }).length === 0);
  await track({ sid: 'e2b2c3d4e5f60718293a4b61', events: [ev('human')] }, PERSON_UA);
  check('a hard scanner is not lifted by a human beacon that arrives without the code', ofSid('e2b2c3d4e5f60718293a4b61').filter(function (x) { return x.event === 'link_hit'; }).length === 0 && ofSid('e2b2c3d4e5f60718293a4b61').filter(function (x) { return x.event === 'scanner_hit'; }).length === 1, ofSid('e2b2c3d4e5f60718293a4b61'));
  // soft scanner then a human
  await track({ sid: 'e3b2c3d4e5f60718293a4b62', code: 'SCNR22', events: [ev('human')] }, sUa);
  var up = ofSid('e3b2c3d4e5f60718293a4b62').filter(function (x) { return x.props && x.props.upgraded; });
  check('a soft scanner flag is upgraded to a person click by a human beacon', up.length === 1 && up[0].event === 'link_hit' && up[0].scanner === false, ofSid('e3b2c3d4e5f60718293a4b62'));
  CF = { regionCode: 'QLD', country: 'AU', asn: 1221 };
  Date.now = RealNow;
  var cls = vpjClassify({ ua: PERSON_UA, asn: 1221, now: Date.parse('2026-11-16T05:00:00Z'), sentAt: '2026-11-16T00:00:00Z' });
  check('vpjClassify: an ordinary phone hours later is a person', cls.scanner === false, cls);
  check('vpjClassify: no user agent at all is a scanner', vpjClassify({ ua: '', now: 0 }).scanner === true);
  check('vpjClassify: Mimecast and Safe Links agents', vpjClassify({ ua: 'Mimecast Link Check', now: 0 }).scanner && vpjClassify({ ua: 'Mozilla/5.0 SafeLinks', now: 0 }).scanner);

  section('6. /track/lookup: what the pre-fill needs, and nothing more');
  var lk = await call('/track/lookup?c=MPYXPG', undefined, hdr(PERSON_UA), 'GET');
  check('a known code returns venue, first name, likely games, state', lk.body.found === true && lk.body.venue === 'The Grand Hotel' && lk.body.first_name === 'Sam' && lk.body.games.join() === 'trivia,bingo' && lk.body.state === 'QLD', lk.body);
  check('and nothing else (no id, lead_ref, campaign, email)', Object.keys(lk.body).sort().join() === 'first_name,found,games,state,venue', Object.keys(lk.body));
  var lc = await call('/track/lookup?c=mpyxpg', undefined, hdr(PERSON_UA), 'GET');
  check('codes are not case sensitive (people retype them)', lc.body.found === true);
  await addLink({ code: 'REVOKD', id: 9, revoked: '2026-11-01T00:00:00.000Z' });
  await addLink({ code: 'OLDONE', id: 10, expires: '2026-01-01T00:00:00.000Z' });
  var un = await call('/track/lookup?c=ZZZZZZ', undefined, hdr(PERSON_UA), 'GET');
  var rv = await call('/track/lookup?c=REVOKD', undefined, hdr(PERSON_UA), 'GET');
  var ol = await call('/track/lookup?c=OLDONE', undefined, hdr(PERSON_UA), 'GET');
  var mf = await call('/track/lookup?c=%27%3Bdrop', undefined, hdr(PERSON_UA), 'GET');
  var nc = await call('/track/lookup', undefined, hdr(PERSON_UA), 'GET');
  var same5 = [un, rv, ol, mf, nc].every(function (x) { return x.status === 200 && JSON.stringify(x.body) === JSON.stringify({ found: false }); });
  check('unknown, revoked, expired, malformed and missing codes are the SAME answer', same5, [un.body, rv.body, ol.body, mf.body, nc.body]);
  var lim = null; for (var q = 0; q < 45; q++) lim = await call('/track/lookup?c=AAAAA' + (q % 9 + 1), undefined, { 'user-agent': PERSON_UA, 'cf-connecting-ip': '10.77.0.1' }, 'GET');
  check('over the per-network limit it looks like no code (200, found:false), not an error', lim.status === 200 && lim.body.found === false, lim);
  var lim2 = await call('/track/lookup?c=MPYXPG', undefined, { 'user-agent': PERSON_UA, 'cf-connecting-ip': '10.77.0.1' }, 'GET');
  check('and a real code from that same busy network is refused too', lim2.body.found === false, lim2.body);
  check('the lookup writes no event', rows().filter(function (x) { return x.event === 'lookup'; }).length === 0);

  section('7. rate limits on /track');
  var ipx = { 'user-agent': PERSON_UA, 'cf-connecting-ip': '10.88.0.1' };
  function sidn(n) { return 'f1b2c3d4e5f6071829' + ('000000' + n.toString(16)).slice(-6); }
  for (var z = 0; z < 405; z++) await call('/track', { sid: sidn(z), events: [ev('page_opened')] }, ipx);
  var kept = rows().filter(function (x) { return x.sid.indexOf('f1b2c3d4e5f6071829') === 0; }).length;
  check('one network is capped at 400 batches an hour (the rest answered ok, kept nothing)', kept === 400, kept);
  for (var z2 = 0; z2 < 155; z2++) await call('/track', { sid: sidn(9999), events: [ev('page_opened')] }, hdr(PERSON_UA));
  check('one session is capped at 150 batches an hour', ofSid(sidn(9999)).length === 150, ofSid(sidn(9999)).length);
  var lastr = await call('/track', { sid: sidn(7777), events: [ev('page_opened')] }, ipx);
  check('over the cap still answers 200 {ok:true}', lastr.status === 200 && lastr.body.ok === true);

  section('8. signed in: the venue comes from the sign-in, and earlier steps are tied to it');
  world(); IP = 0; CF = { regionCode: 'QLD', country: 'AU', asn: 1221 };
  var acc = account({ name: 'Tied Venue' });
  await addLink({ code: 'TIED22', id: 1, venue_id: null });
  await track({ sid: SID, code: 'TIED22', events: [ev('link_hit'), ev('form_sent')] }, DESK_UA);
  await track({ sid: SID, code: 'TIED22', events: [ev('signed_in')] }, DESK_UA, { authorization: 'Bearer ' + acc.owner, 'x-vp-venue': acc.vid });
  var tied = ofSid(SID);
  check('the signed_in row carries the venue', tied.filter(function (x) { return x.event === 'signed_in'; })[0].venue_id === acc.vid, tied);
  check('the earlier anonymous steps are now tied to the venue', tied.every(function (x) { return x.venue_id === acc.vid; }), tied);
  check('the link now says which venue it became', DB.vp_track_links[0].venue_id === acc.vid, DB.vp_track_links[0]);
  await track({ sid: SID2, events: [ev('card_added')] }, DESK_UA, { authorization: 'Bearer ' + acc.owner });
  check('one venue on the login: no X-VP-Venue needed', ofSid(SID2).filter(function (x) { return x.event === 'card_added'; })[0].venue_id === acc.vid, ofSid(SID2));
  var other = account({ name: 'Other' });
  await track({ sid: SID2, events: [ev('signed_in')] }, DESK_UA, { authorization: 'Bearer ' + acc.owner, 'x-vp-venue': other.vid });
  check('a venue id the login does not own is ignored', ofSid(SID2).filter(function (x) { return x.event === 'signed_in'; })[0].venue_id === null, ofSid(SID2));

  section('9. HQ: the funnel');
  world(); IP = 0; CF = { regionCode: 'QLD', country: 'AU', asn: 1221 };
  async function visit(sid, steps, extra) { for (var i = 0; i < steps.length; i++) await track({ sid: sid, events: [ev(steps[i][0], steps[i][1], 1000 * (steps.length - i))] }, DESK_UA); }
  var S = function (n) { return ('0000000000000000000000' + n).slice(-24).replace(/./g, function (c, i) { return c; }); };
  for (var u = 1; u <= 12; u++) {
    var s = ('a0000000000000000000' + ('0000' + u).slice(-4));
    var steps = [['page_opened'], ['button_tapped']];
    if (u <= 9) steps.push(['form_started']);
    if (u <= 6) { steps.push(['contact_kind', { kind: u % 2 ? 'mobile' : 'email' }]); steps.push(['form_sent']); }
    if (u <= 4) { steps.push(['account_made']); }
    if (u <= 2) { steps.push(['signed_in']); }
    if (u === 9 || u === 8) steps.push(['form_abandon', { field: 'contact', ms: 9000 }]);
    if (u === 7) { steps.push(['venue_search_none', { q: 'wobbly goat' }]); steps.push(['venue_search_none', { q: 'wobbly goat' }]); steps.push(['venue_search_none', { q: 'goat inn' }]); steps.push(['form_abandon', { field: 'venue', ms: 20000 }]); }
    await visit(s, steps);
  }
  var admin = await call('/admin/journey-funnel', { days: 7 }, AS(ADMIN));
  check('HQ funnel answers ok for the owner', admin.status === 200 && admin.body.ok === true, admin);
  var st = {}; (admin.body.steps || []).forEach(function (x) { st[x.step] = x; });
  check('reached counts distinct sessions per step', st.page_opened.reached === 12 && st.button_tapped.reached === 12 && st.form_started.reached === 9 && st.form_sent.reached === 6 && st.account_made.reached === 4 && st.signed_in.reached === 2, admin.body.steps);
  check('% lost is against the step before', st.form_started.lost_pct === 25 && st.form_sent.lost_pct === 33 && st.signed_in.lost_pct === 50, admin.body.steps.map(function (x) { return x.step + ':' + x.lost_pct; }));
  check('median seconds to the next step is there', typeof st.page_opened.median_secs_to_next === 'number', st.page_opened);
  check('form detail: mobile vs email chosen', admin.body.form.chose_mobile === 3 && admin.body.form.chose_email === 3, admin.body.form);
  check('form detail: abandoned at which field', admin.body.form.abandoned_at[0].field === 'contact' && admin.body.form.abandoned_at[0].n === 2, admin.body.form.abandoned_at);
  check('searches that found nothing are listed with counts', admin.body.form.searches_found_nothing[0].q === 'wobbly goat' && admin.body.form.searches_found_nothing[0].n === 2, admin.body.form.searches_found_nothing);
  check('a plain-English reason and a fix sit beside the step', st.form_sent.reason.length > 20 && st.form_sent.fix.length > 10, st.form_sent);
  check('the reason names the missing venue when 3+ searches found nothing', /missing from our list/.test(st.form_sent.reason), st.form_sent.reason);
  var noAuth = await call('/admin/journey-funnel', { days: 7 });
  var staff = await call('/admin/journey-funnel', { days: 7 }, AS(STAFFADMIN));
  check('the report refuses no login and a staff-role login', noAuth.status === 401 && staff.status === 403, [noAuth.status, staff.status]);
  // scanner sessions are not people
  await addLink({ code: 'SCAN33', id: 3, sent_at: '2026-11-16T00:00:00.000Z' });
  await track({ sid: 'a99999999999999999999999', code: 'SCAN33', events: [ev('link_hit'), ev('page_opened')] }, 'Mimecast Link Check');
  var after = await call('/admin/journey-funnel', { days: 7 }, AS(ADMIN));
  check('a scanner session is not in the funnel, and is counted apart', after.body.steps[0].reached === 12 && after.body.scanner_hits === 1, [after.body.steps[0].reached, after.body.scanner_hits]);

  section('10. HQ: per campaign and email step');
  world(); IP = 0; CF = { regionCode: 'QLD', country: 'AU', asn: 1221 };
  await addLink({ code: 'AAA111', id: 1, lead_ref: 'L1', campaign: 'offer-nov', step: 1, label: 'play-button' });
  await addLink({ code: 'BBB222', id: 2, lead_ref: 'L2', campaign: 'offer-nov', step: 1, label: 'play-button' });
  await addLink({ code: 'CCC333', id: 3, lead_ref: 'L3', campaign: 'offer-nov', step: 1, label: 'play-button' });
  await addLink({ code: 'DDD444', id: 4, lead_ref: 'L1', campaign: 'offer-nov', step: 2, label: 'pricing' });
  await track({ sid: S(11), code: 'AAA111', events: [ev('link_hit'), ev('page_view'), ev('form_sent'), ev('account_made'), ev('signed_in'), ev('card_added')] }, DESK_UA);
  await track({ sid: S(12), code: 'BBB222', events: [ev('link_hit')] }, DESK_UA);
  await track({ sid: S(13), code: 'CCC333', events: [ev('link_hit')] }, 'Proofpoint');
  var ca = await call('/admin/journey-campaigns', {}, AS(ADMIN));
  var r1 = (ca.body.rows || []).filter(function (x) { return x.email_step === 1; })[0] || {}, r2 = (ca.body.rows || []).filter(function (x) { return x.email_step === 2; })[0] || {};
  check('email 1: sent 3, clicked 2 (the scanner is not a click), visited 1', r1.sent === 3 && r1.clicked === 2 && r1.visited === 1, r1);
  check('email 1: enquired 1, signed up 1, signed in 1, card 1', r1.enquired === 1 && r1.signed_up === 1 && r1.signed_in === 1 && r1.card === 1, r1);
  check('email 1: the scanner-only lead is counted apart', r1.scanner_only === 1, r1);
  check('email 2 sent 1 and nobody clicked', r2.sent === 1 && r2.clicked === 0, r2);
  var direct = vpjCampaignTable([{ id: 1, lead_ref: 'Z1', campaign: 'c', email_step: 1, link_label: 'a' }], [{ link_id: 1, event: 'link_hit', scanner: true }, { link_id: 1, event: 'page_view', scanner: true }]);
  check('the table function itself counts a scanner-flagged row as no click and no visit', direct[0].clicked === 0 && direct[0].visited === 0 && direct[0].sent === 1, direct);
  check('the campaign table refuses a non-admin', (await call('/admin/journey-campaigns', {}, AS(STAFFADMIN))).status === 403);

  section('11. HQ: one venue journey in order');
  world(); IP = 0; CF = { regionCode: 'QLD', country: 'AU', asn: 1221 };
  var a2 = account({ name: 'Journey Venue' });
  await addLink({ code: 'JJJ111', id: 1, lead_ref: 'L1', campaign: 'offer-nov', step: 2, label: 'play-button', sent_at: '2026-11-10T01:00:00.000Z', venue_id: a2.vid });
  DB.vp_journey_events.push({ id: 1, sid: SID, link_id: 1, event: 'link_hit', props: {}, src: 'cold_email', path: '/offer-nov/:code', region: 'QLD', device: 'mobile', scanner: false, venue_id: a2.vid, at: '2026-11-10T03:00:00.000Z' });
  DB.vp_journey_events.push({ id: 2, sid: SID, link_id: 1, event: 'form_sent', props: {}, src: 'cold_email', path: '/quick', region: 'QLD', device: 'mobile', scanner: false, venue_id: a2.vid, at: '2026-11-10T03:05:00.000Z' });
  DB.vp_journey_events.push({ id: 3, sid: SID, link_id: 1, event: 'page_view', props: {}, src: 'cold_email', path: '/nsw', region: 'QLD', device: 'mobile', scanner: false, venue_id: null, at: '2026-11-10T03:02:00.000Z' });
  var jv = await call('/admin/journey-venue', { venue_id: a2.vid }, AS(ADMIN));
  var words = (jv.body.journey || []).map(function (x) { return x.what; });
  check('the venue journey is in time order, email first', jv.status === 200 && /^Email 2 of offer-nov sent/.test(words[0]) && /play-button link in email 2 of offer-nov/.test(words[1]) && /Looked at \/nsw/.test(words[2]) && /Sent the form/.test(words[3]), words);
  check('the venue journey refuses a bad id and a non-admin', (await call('/admin/journey-venue', { venue_id: 'x' }, AS(ADMIN))).status === 400 && (await call('/admin/journey-venue', { venue_id: a2.vid }, AS(STAFFADMIN))).status === 403);

  section('12a. migration 196 is locked down');
  var SQL = readFile('venueplay-backend/supabase/venueplay-196-journey-tracking.sql').split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
  ['vp_track_links', 'vp_journey_events'].forEach(function (t) {
    check(t + ': RLS on, nothing for public / anon / authenticated, service role only', new RegExp('alter table public\\.' + t + ' enable row level security;').test(SQL) && new RegExp('revoke all on public\\.' + t + ' from public, anon, authenticated;').test(SQL) && new RegExp('grant select, insert(, update)? on public\\.' + t + ' to service_role;').test(SQL) && !new RegExp('to (anon|authenticated|public)').test(SQL));
  });
  check('the events table has no column for an address, a user agent or a person', !/\b(ip|ip_address|user_agent|ua|email|mobile|phone|name|fingerprint)\b\s+(text|inet|varchar)/i.test(SQL.split('create table if not exists public.vp_journey_events')[1].split(');')[0]), 'columns');
  check('only a hash of the code is stored', /code_hash\s+text not null unique check \(code_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/.test(SQL) && !/\bcode\s+text/.test(SQL));

  section('12. migration 196 not run: nothing breaks');
  world(); delete DB.vp_journey_events; delete DB.vp_track_links; FAIL['vp_journey_events:POST'] = 99;
  var nm = await track({ sid: SID, events: [ev('page_opened')] });
  check('/track still answers ok', nm.status === 200 && nm.body.ok === true, nm);
  var nl = await call('/track/lookup?c=MPYXPG', undefined, hdr(PERSON_UA), 'GET');
  check('/track/lookup still answers found:false', nl.status === 200 && nl.body.found === false, nl);

  print(''); print(bad ? (bad + ' FAILED of ' + ran + ' checks') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('journey tests failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); bad++; });
