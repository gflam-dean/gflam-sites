/* "HOSTED BY" ON THE TV, THE ACCOUNT HALF, AND THE TWO-PUB HOST (Dean, 6 Nov 2026, INBOX 120; migration 181).

   One trivia host, Sam, runs nights at two pubs that are NOT on the same account: The Royal (Olive's account)
   and The Anchor (Pat's account). Each owner adds Sam's mobile on Account > People without knowing about the
   other. Runs the REAL billing Worker on tools/rig-billing-worker.js:

     vpbAddHost         two owners, two accounts, one mobile: ONE login, a host row at each pub
     vpbMyVenues        Sam's login lists both pubs (what the console's Switch venue offers)
     vpbHostedBySave    Olive sets Sam's card (name and logo) and switches trivia on at The Royal; the logo goes
                        through the venue logo's own checks into venue-logos/hosts/<login>/; Pat sees the SAME
                        card (it follows the host) with The Anchor's switches still off, and switches trivia and
                        musical bingo on there without touching The Royal's
     the walls          Pat cannot switch The Royal, a stranger cannot touch Sam, Sam cannot set his own, an
                        owner's own login has no card, a bad or oversized logo changes nothing, a switch with no
                        name is refused, and before migration 181 the save says so and writes nothing
     vpbListHosts       the card and this account's switches on each row, hosted_by_ready true; a list from
                        before the migration is exactly the old list with hosted_by_ready false
   The game Worker's half (/host/hosted-by) is tools/test-hosted-by-game.js; the TV in Chrome is
   tools/hosted-by-in-chrome.test.py.

   Run from the repo root:  jsc tools/test-hosted-by.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
vpbSubItem = async function () { return null; };
if (typeof crypto === 'undefined') {
  crypto = { subtle: { digest: function (alg, bytes) {
    var out = new Uint8Array(32), h = 2166136261 >>> 0;
    for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; out[i % 32] ^= h & 255; }
    return Promise.resolve(out.buffer);
  } } };
}
function b64(bytes) {
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', s = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var n = (a << 16) | (b << 8) | c;
    s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? A[n & 63] : '=');
  }
  return s;
}
function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function chunk(name, data) { var c = be32(data.length); for (var i = 0; i < 4; i++) c.push(name.charCodeAt(i)); return c.concat(data, [0, 0, 0, 0]); }
function png(w, h, pad, salt) {
  var b = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].concat(chunk('IHDR', be32(w).concat(be32(h), [8, 6, 0, 0, 0])));
  var idat = []; for (var i = 0; i < (pad || 20); i++) idat.push((i * 7 + (salt || 0)) & 255);
  return new Uint8Array(b.concat(chunk('IDAT', idat), chunk('IEND', [])));
}
function dataUrl(bytes) { return 'data:image/png;base64,' + b64(bytes); }

/* Storage: the rig only fakes PostgREST. Record every object written and answer as Supabase does (the same
   stand-in as tools/test-venue-logo-upload.js). */
var rigFetch = globalThis.fetch, STORED = [], BUCKETS = {};
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  var res = function (status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
    json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } }); };
  var sm = /\/storage\/v1\/(bucket|object)\/?(.*)$/.exec(u);
  if (sm) {
    if (sm[1] === 'bucket') {
      if (method === 'GET') return res(BUCKETS[decodeURIComponent(sm[2])] ? 200 : 404, {});
      var bk = JSON.parse(opts.body); BUCKETS[bk.id] = bk; return res(200, { name: bk.id });
    }
    if (method === 'POST') STORED.push(sm[2]);
    return res(200, { Key: sm[2] });
  }
  return rigFetch(url, opts);
};
function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '80000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OLIVE = U(1), PAT = U(2), STRANGER = U(3), MGR = U(4);
var ROYAL = V(1), ANCHOR = V(2), ELSE = V(3);
var MOBILE = '0412 345 678';
function as(user, body, extra) {
  var h = { Authorization: 'Bearer ' + user }; for (var k in (extra || {})) h[k] = extra[k];
  var raw = JSON.stringify(body || {});
  return { headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(raw); }, json: function () { return Promise.resolve(JSON.parse(raw)); } };
}
function J(o, status) { return { status: status || 200, body: o }; }
function world() {
  DB = {}; sent.length = 0; FAIL = {};
  DB.venueplay_founding = [{ id: 'fa', contact_email: 'olive@royal.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_a' },
                           { id: 'fb', contact_email: 'pat@anchor.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_b' },
                           { id: 'fc', contact_email: 'kim@else.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_c' }];
  DB.vp_venues = [{ id: ROYAL, name: 'The Royal', founding_id: 'fa', slug: 'the-royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z' },
                  { id: ANCHOR, name: 'The Anchor', founding_id: 'fb', slug: 'the-anchor', status: 'active', max_players: 60, created_at: '2026-02-01T00:00:00Z' },
                  { id: ELSE, name: 'Somewhere Else', founding_id: 'fc', slug: 'somewhere-else', status: 'active', max_players: 50, created_at: '2026-03-01T00:00:00Z' }];
  DB.vp_platform_admins = [];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OLIVE, venue_id: ROYAL, role: 'owner', permissions: null, display_name: 'Olive' },
                       { id: 's2', auth_user_id: PAT, venue_id: ANCHOR, role: 'owner', permissions: null, display_name: 'Pat' },
                       { id: 's3', auth_user_id: STRANGER, venue_id: ELSE, role: 'owner', permissions: null, display_name: 'Kim' },
                       { id: 's4', auth_user_id: MGR, venue_id: ROYAL, role: 'manager', permissions: { advertising: true, draws_raffles: true, players_optin: false, add_hosts: false }, display_name: 'Mo' }];
  DB.vp_admin_audit = []; DB.vp_host_brands = []; DB.auth = [];
}
function row(uid, vid) { return DB.vp_venue_staff.filter(function (r) { return r.auth_user_id === uid && r.venue_id === vid; })[0]; }
function brand(uid) { return DB.vp_host_brands.filter(function (r) { return r.auth_user_id === uid; }); }
async function save(user, body, extra) { return await vpbHostedBySave(as(user, body, extra), ENV, J); }
async function list(user, extra) { return await vpbListHosts(as(user, {}, extra), ENV, J); }
function person(l, uid) { return ((l.body && l.body.hosts) || []).filter(function (h) { return h.auth_user_id === uid; })[0] || null; }

(async function () {
  world();
  print('two owners on two accounts add the same mobile');
  var a = await vpbAddHost(as(OLIVE, { label: 'Sam', mobile: MOBILE, venue_ids: [ROYAL] }), ENV, J);
  var b = await vpbAddHost(as(PAT, { label: 'Sam the quizmaster', mobile: MOBILE, venue_ids: [ANCHOR] }), ENV, J);
  var SAM = a.body && a.body.auth_user_id;
  check('Olive adds Sam at The Royal', a.status === 200 && !!SAM, a);
  check('Pat adds the same mobile at The Anchor and gets the SAME login, not a second one', b.status === 200 && b.body.auth_user_id === SAM && DB.auth.length === 1, [b, DB.auth]);
  check('Sam is a host at each pub, nothing more', row(SAM, ROYAL) && row(SAM, ROYAL).role === 'host' && row(SAM, ANCHOR) && row(SAM, ANCHOR).role === 'host', DB.vp_venue_staff);
  var mv = await vpbMyVenues(as(SAM), ENV, J);
  var mvn = ((mv.body && mv.body.venues) || []).map(function (v) { return v.name; }).sort().join(', ');
  check('Sam\'s login lists both pubs, the list the console\'s Switch venue offers', mvn === 'The Anchor, The Royal', mv);

  print('the lists before a card is set');
  var lo = await list(OLIVE), lp = await list(PAT);
  check('Olive sees Sam with no card yet, and the feature ready', lo.body.hosted_by_ready === true && person(lo, SAM) && person(lo, SAM).hosted_by === null, lo.body);
  check('Olive does not see Pat, Pat does not see Olive', !person(lo, PAT) && !person(lp, OLIVE), [lo.body.hosts, lp.body.hosts]);

  print('Olive sets Sam\'s card and switches trivia on at The Royal');
  var logo = png(400, 200, 40, 1);
  var s1 = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: '  Quiz Co   Trivia ', trivia: true, musical: false, logo_data: dataUrl(logo) });
  var br = brand(SAM)[0] || {};
  var pre = ENV.SUPABASE_URL + '/storage/v1/object/public/venue-logos/hosts/' + SAM + '/';
  check('it saves', s1.status === 200 && s1.body.ok === true, s1);
  check('one card for Sam\'s login, the name tidied', brand(SAM).length === 1 && br.name === 'Quiz Co Trivia', DB.vp_host_brands);
  check('the logo went through the venue logo\'s checks into venue-logos/hosts/<login>/', typeof br.logo_url === 'string' && br.logo_url.indexOf(pre) === 0 && /\.png$/.test(br.logo_url), br.logo_url);
  check('and the card records who set it', br.updated_by === OLIVE, br);
  check('the bytes went to the venue-logos bucket under hosts/<login>/', STORED.length === 1 && STORED[0].indexOf('venue-logos/hosts/' + SAM + '/') === 0, STORED);
  check('The Royal\'s switch: trivia on, musical bingo off', JSON.stringify(row(SAM, ROYAL).hosted_by) === '{"trivia":true,"musical":false}', row(SAM, ROYAL));
  check('The Anchor\'s switch is untouched (another account\'s TV)', row(SAM, ANCHOR).hosted_by == null, row(SAM, ANCHOR));
  var au = DB.vp_admin_audit.filter(function (x) { return x.action === 'hosted_by_set'; })[0];
  check('an audit row says who set what, before and after', !!au && au.target === 'venue:' + ROYAL && au.detail.host === SAM && au.detail.before === null && au.detail.after.name === 'Quiz Co Trivia', au);

  print('the card follows Sam to The Anchor; Pat\'s switches are Pat\'s');
  lp = await list(PAT);
  var ps = person(lp, SAM);
  check('Pat sees the same card on Sam\'s row', ps && ps.hosted_by && ps.hosted_by.name === 'Quiz Co Trivia' && ps.hosted_by.logo_url === br.logo_url, ps);
  check('with The Anchor\'s switches off', ps && ps.hosted_shows && ps.hosted_shows[ANCHOR] && ps.hosted_shows[ANCHOR].trivia === false && ps.hosted_shows[ANCHOR].musical === false, ps);
  check('and nothing about The Royal (not Pat\'s venue)', ps && ps.hosted_shows && !(ROYAL in ps.hosted_shows), ps && ps.hosted_shows);
  var s2 = await save(PAT, { auth_user_id: SAM, venue_id: ANCHOR, name: 'Quiz Co Trivia', trivia: true, musical: true });
  check('Pat switches trivia and musical bingo on at The Anchor', s2.status === 200 && JSON.stringify(row(SAM, ANCHOR).hosted_by) === '{"trivia":true,"musical":true}', [s2, row(SAM, ANCHOR)]);
  check('The Royal\'s switch is as Olive left it', JSON.stringify(row(SAM, ROYAL).hosted_by) === '{"trivia":true,"musical":false}', row(SAM, ROYAL));
  check('and the logo is kept when the save sends none', brand(SAM)[0].logo_url === br.logo_url && brand(SAM).length === 1, DB.vp_host_brands);

  print('the walls');
  var w1 = await save(PAT, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz Co Trivia', trivia: false });
  check('Pat cannot switch The Royal\'s TV', w1.status === 403 && JSON.stringify(row(SAM, ROYAL).hosted_by) === '{"trivia":true,"musical":false}', [w1, row(SAM, ROYAL)]);
  var w2 = await save(STRANGER, { auth_user_id: SAM, venue_id: ELSE, name: 'Hacked', trivia: true });
  check('a stranger cannot touch Sam\'s card (he is not on their account)', w2.status === 404 && brand(SAM)[0].name === 'Quiz Co Trivia', [w2, DB.vp_host_brands]);
  var w3 = await save(SAM, { auth_user_id: SAM, venue_id: ROYAL, name: 'Me', trivia: true });
  check('Sam cannot set his own card (a host has no Account page)', w3.status >= 400 && brand(SAM)[0].name === 'Quiz Co Trivia', [w3, DB.vp_host_brands]);
  var w4 = await save(OLIVE, { auth_user_id: PAT, venue_id: ROYAL, name: 'x', trivia: true });
  check('Olive cannot give Pat (another account\'s owner) a card', w4.status === 404 && brand(PAT).length === 0, w4);
  var w5 = await save(OLIVE, { auth_user_id: OLIVE, venue_id: ROYAL, name: 'Olive', trivia: true });
  check('an owner\'s own full-access login has no card', w5.status === 403 && brand(OLIVE).length === 0, w5);
  var w6 = await save(MGR, { auth_user_id: SAM, venue_id: ROYAL, name: 'Mo did this', trivia: true });
  check('a manager without "add hosts" is refused', w6.status === 403 && brand(SAM)[0].name === 'Quiz Co Trivia', w6);
  var w7 = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: '   ', trivia: true });
  check('switching on with no name is refused', w7.status === 400 && /name/.test(w7.body.error), w7);
  var w8 = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz Co Trivia', trivia: true, logo_data: 'data:image/png;base64,' + b64(new Uint8Array([1, 2, 3, 4, 5, 6])) });
  check('a file that is not a PNG or WebP is refused and the card is unchanged', w8.status === 415 && brand(SAM)[0].logo_url === br.logo_url, [w8, brand(SAM)]);
  var w9 = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz Co Trivia', trivia: true, logo_data: dataUrl(png(400, 200, 1100 * 1024, 2)) });
  check('a logo over 1MB is refused and the card is unchanged', w9.status === 413 && brand(SAM)[0].logo_url === br.logo_url, w9);
  var w10 = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz Co Trivia', trivia: true, logo_data: dataUrl(png(8, 8, 20, 3)) });
  check('a logo too small to read on a TV is refused', w10.status === 400 && brand(SAM)[0].logo_url === br.logo_url, w10);
  var long = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz <b>Co</b> and a very long trivia company name that goes on and on', trivia: true });
  check('a long name is cut to 40 characters, and no markup survives', long.status === 200 && brand(SAM)[0].name.length <= 40 && !/[<>]/.test(brand(SAM)[0].name), brand(SAM)[0]);
  await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz Co Trivia', trivia: true });

  print('switching off, and taking the logo away');
  var off = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz Co Trivia', trivia: false, musical: false });
  check('both off at The Royal stores nothing there (null)', off.status === 200 && row(SAM, ROYAL).hosted_by === null, row(SAM, ROYAL));
  check('and The Anchor still shows it', JSON.stringify(row(SAM, ANCHOR).hosted_by) === '{"trivia":true,"musical":true}', row(SAM, ANCHOR));
  var rl = await save(PAT, { auth_user_id: SAM, venue_id: ANCHOR, name: 'Quiz Co Trivia', trivia: true, musical: true, remove_logo: true });
  check('Remove logo leaves the name and no logo', rl.status === 200 && brand(SAM)[0].logo_url === null && brand(SAM)[0].name === 'Quiz Co Trivia', brand(SAM)[0]);
  await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Quiz Co Trivia', trivia: true, logo_data: dataUrl(logo) });

  print('before migration 181 runs');
  var realFetch = fetch;
  fetch = function (url, opts) {
    if (/\/rest\/v1\/vp_host_brands/.test(String(url)) || (/\/rest\/v1\/vp_venue_staff\?/.test(String(url)) && /select=[^&]*hosted_by/.test(String(url)))) {
      return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({ code: '42703' }); }, text: function () { return Promise.resolve('{"code":"42703"}'); } });
    }
    return realFetch(url, opts);
  };
  var keep = JSON.stringify([DB.vp_host_brands, DB.vp_venue_staff]);
  var nm = await save(OLIVE, { auth_user_id: SAM, venue_id: ROYAL, name: 'Something new', trivia: true, logo_data: dataUrl(png(300, 300, 30, 9)) });
  check('the save says Hosted by is not switched on yet', nm.status === 503 && /not switched on/.test(nm.body.error), nm);
  check('and writes nothing', JSON.stringify([DB.vp_host_brands, DB.vp_venue_staff]) === keep);
  var lm = await list(OLIVE);
  check('the People list still lists everyone, with hosted_by_ready false', lm.status === 200 && lm.body.hosted_by_ready === false && !!person(lm, SAM) && !!person(lm, MGR), lm.body);
  fetch = realFetch;

  finished = true;
})().catch(function (e) { print('  FAIL threw: ' + (e && e.stack || e)); fails++; }).then(function () {
  if (!finished) { print('  FAIL did not finish'); fails++; }
  print(fails ? (fails + ' of ' + ran + ' checks FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (fails) throw new Error('failed');
});
