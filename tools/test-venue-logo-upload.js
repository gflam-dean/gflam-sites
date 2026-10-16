/* A venue's logo goes up through the billing Worker, and nothing else gets on the TV: RUN, not read.

   Dean, 7 Aug 2026 (banked), built 16 Oct 2026 with migration 102. The logo is painted on every
   TV a venue has and on the public homepage strip, so it is the one venue-supplied address that
   reaches strangers. It used to ride the advertising upload (any image type, 5 MB, the type the
   browser CLAIMED) and then /account/screen-save stored any string starting "http".

   Runs the REAL billing Worker on tools/rig-billing-worker.js:
     vpbLogoUpload    owner ok, manager with the advertising right ok, manager without it, a host
                      and a stranger refused; over 1 MB refused before a byte is stored; a JPEG,
                      a GIF, an SVG, or a JPEG LABELLED as a PNG refused; too small and too big
                      refused by the header's own width and height; written to the public
                      venue-logos bucket as <venue_id>/<sha256>.png and the URL saved on the venue
     vpbLogoRemove    clears the URL, and a host cannot
     vpbLogoSite      writes show_logo_on_site both ways, refuses a non-answer, refuses a manager
                      without the right, and says so when migration 102 is not run yet
     vpbScreenGet     hands the tick back to the page
     vpbScreenSave    no longer stores a pasted address; our own storage address, or a clear, only

   Run from the repo root:  jsc tools/test-venue-logo-upload.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

/* jsc has no WebCrypto. A stand-in digest that is a pure function of the bytes is enough for
   what these checks claim (same file, same address; different file, different address); the
   Workers runtime supplies the real SHA-256. */
if (typeof crypto === 'undefined') {
  crypto = { subtle: { digest: function (alg, bytes) {
    var out = new Uint8Array(32), h = 2166136261 >>> 0;
    for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; out[i % 32] ^= h & 255; }
    for (var j = 0; j < 32; j++) { h ^= j; h = Math.imul(h, 16777619) >>> 0; out[j] ^= (h >>> 8) & 255; }
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
/* A PNG header that is honest about its size and colour type, then a little IDAT, then IEND.
   pad adds bytes inside the IDAT so a file can be made as big as a test needs. */
function png(w, h, colourType, opts) {
  opts = opts || {};
  var b = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  b = b.concat(chunk('IHDR', be32(w).concat(be32(h), [8, colourType, 0, 0, 0])));
  if (opts.trns) b = b.concat(chunk('tRNS', [0, 0]));
  var idat = []; for (var i = 0; i < (opts.pad || 20); i++) idat.push((i * 7 + (opts.salt || 0)) & 255);
  b = b.concat(chunk('IDAT', idat), chunk('IEND', []));
  return new Uint8Array(b);
}
function webpX(w, h, alpha) {
  var b = [];
  'RIFF'.split('').forEach(function (c) { b.push(c.charCodeAt(0)); });
  b.push(40, 0, 0, 0);
  'WEBPVP8X'.split('').forEach(function (c) { b.push(c.charCodeAt(0)); });
  b.push(10, 0, 0, 0, alpha ? 0x10 : 0, 0, 0, 0);
  var W = w - 1, H = h - 1;
  b.push(W & 255, (W >> 8) & 255, (W >> 16) & 255, H & 255, (H >> 8) & 255, (H >> 16) & 255);
  for (var i = 0; i < 16; i++) b.push(0);
  return new Uint8Array(b);
}
function dataUrl(type, bytes) { return 'data:' + type + ';base64,' + b64(bytes); }
function bytesOf(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }

/* Storage: the rig only fakes PostgREST. Record every storage call and answer it the way
   Supabase does, and make vp_venue_screen's upsert MERGE on venue_id, which is what
   Prefer: resolution=merge-duplicates does there (the rig's POST only appends). */
var rigFetch = globalThis.fetch, STORAGE = [], BUCKETS = {}, REFUSE_COLUMN = '';
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  var res = function (status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
    json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } }); };
  var sm = /\/storage\/v1\/(bucket|object)\/?(.*)$/.exec(u);
  if (sm) {
    STORAGE.push({ url: u, method: method, headers: (opts && opts.headers) || {}, bytes: opts && opts.body && opts.body.length });
    if (sm[1] === 'bucket') {
      if (method === 'GET') return res(BUCKETS[decodeURIComponent(sm[2])] ? 200 : 404, {});
      var bk = JSON.parse(opts.body); BUCKETS[bk.id] = bk; return res(200, { name: bk.id });
    }
    return res(200, { Key: sm[2] });
  }
  var m = /\/rest\/v1\/([a-zA-Z_]+)\??(.*)$/.exec(u);
  if (m && REFUSE_COLUMN && (u.indexOf(REFUSE_COLUMN) !== -1 || (opts && opts.body && String(opts.body).indexOf(REFUSE_COLUMN) !== -1))) {
    return res(400, { code: '42703', message: 'column vp_venues.' + REFUSE_COLUMN + ' does not exist' });
  }
  if (m && m[1] === 'vp_venue_screen' && method === 'POST' && /merge-duplicates/.test(((opts.headers || {}).Prefer) || '')) {
    var row = JSON.parse(opts.body), have = tbl('vp_venue_screen').filter(function (r) { return r.venue_id === row.venue_id; })[0];
    if (have) { for (var k in row) have[k] = row[k]; } else tbl('vp_venue_screen').push(row);
    return res(201, '');
  }
  return rigFetch(url, opts);
};

function U(n) { return '50000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OWNER = U(1), MANAGER = U(2), NOADS = U(3), HOST = U(4), STRANGER = U(5);
var ROYAL = V(1), ELSEWHERE = V(2);
function as(user, body) {
  var h = { Authorization: 'Bearer ' + user, 'X-VP-Venue': ROYAL };
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; sent.length = 0; FAIL = {}; STORAGE = []; BUCKETS = {}; REFUSE_COLUMN = '';
  DB.vp_platform_admins = [];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'royal@example.com', plan: 'monthly', status: 'active', stripe_subscription_id: 'sub_1' },
                           { id: 'f2', contact_email: 'else@example.com', plan: 'monthly', status: 'active', stripe_subscription_id: 'sub_2' }];
  DB.vp_venues = [{ id: ROYAL, name: 'The Royal Hotel', founding_id: 'f1', slug: 'royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z', show_logo_on_site: true },
                  { id: ELSEWHERE, name: 'Somebody Else Hotel', founding_id: 'f2', slug: 'else', status: 'active', max_players: 40, created_at: '2026-01-02T00:00:00Z', show_logo_on_site: true }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: ROYAL, role: 'owner', permissions: null },
                       { id: 's2', auth_user_id: MANAGER, venue_id: ROYAL, role: 'manager', permissions: { advertising: true, draws_raffles: false, players_optin: false, add_hosts: false } },
                       { id: 's3', auth_user_id: NOADS, venue_id: ROYAL, role: 'manager', permissions: { advertising: false, draws_raffles: true, players_optin: false, add_hosts: true } },
                       { id: 's4', auth_user_id: HOST, venue_id: ROYAL, role: 'host', permissions: null },
                       { id: 's5', auth_user_id: STRANGER, venue_id: ELSEWHERE, role: 'owner', permissions: null }];
  DB.vp_venue_screen = [{ venue_id: ROYAL, slug: 'royal', slides: [{ image_url: 'https://db/storage/v1/object/public/venue-ads/x.png', seconds: 7 }], logo_url: null }];
  DB.vp_admin_audit = [];
}
function screenRow() { return DB.vp_venue_screen.filter(function (r) { return r.venue_id === ROYAL; })[0] || {}; }
function objectPuts() { return STORAGE.filter(function (s) { return s.method === 'POST' && s.url.indexOf('/storage/v1/object/') !== -1; }); }
var PUBLIC = ENV.SUPABASE_URL + '/storage/v1/object/public/venue-logos/' + ROYAL + '/';

(async function () {
  print('the owner uploads a transparent PNG');
  world();
  var logo = png(600, 200, 6);
  var r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  check('200 and an address back', r.status === 200 && r.body.ok === true && typeof r.body.url === 'string', r);
  var hex = r.body.url ? r.body.url.slice(PUBLIC.length).replace(/\.png$/, '') : '';
  check('the address is the PUBLIC venue-logos bucket, in this venue\'s folder, named by a 64-hex digest',
        r.body.url && r.body.url.indexOf(PUBLIC) === 0 && /^[0-9a-f]{64}$/.test(hex) && /\.png$/.test(r.body.url), r.body.url);
  var put = objectPuts()[0] || {};
  check('the bytes went to storage at that same path, with the service key', put.url === ENV.SUPABASE_URL + '/storage/v1/object/venue-logos/' + ROYAL + '/' + hex + '.png'
        && put.headers.Authorization === 'Bearer ' + ENV.SUPABASE_SERVICE_KEY && put.bytes === logo.length, put);
  check('stored as image/png, judged from the bytes', put.headers['Content-Type'] === 'image/png', put.headers);
  check('the bucket was created PUBLIC, 1 MB, PNG and WebP only', BUCKETS['venue-logos'] && BUCKETS['venue-logos'].public === true
        && BUCKETS['venue-logos'].file_size_limit === 1048576 && JSON.stringify(BUCKETS['venue-logos'].allowed_mime_types) === '["image/png","image/webp"]', BUCKETS);
  check('the URL is saved on the venue\'s screen row', screenRow().logo_url === r.body.url, screenRow());
  check('and the slides on that row are untouched', (screenRow().slides || []).length === 1, screenRow().slides);
  check('the answer says it has a transparent background, and its size', r.body.transparent === true && r.body.width === 600 && r.body.height === 200, r.body);
  check('an audit row says the logo was set, by whom', DB.vp_admin_audit.some(function (a) { return a.action === 'logo_set' && a.target === 'venue:' + ROYAL && a.actor_label === 'owner'; }), DB.vp_admin_audit);
  var first = r.body.url;
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  check('the same file again is the same address (named by its contents)', r.status === 200 && r.body.url === first, [first, r.body.url]);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: b64(png(600, 200, 6, { salt: 9 })) }), ENV, J);
  check('a changed file is a new address, so no TV can be showing a cached old one (bare base64 accepted too)', r.status === 200 && r.body.url !== first && r.body.url.indexOf(PUBLIC) === 0, r.body);

  print('who may');
  world();
  r = await vpbLogoUpload(as(MANAGER, { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  check('a manager with the advertising right uploads it', r.status === 200 && screenRow().logo_url === r.body.url, r);
  world();
  r = await vpbLogoUpload(as(NOADS, { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  check('a manager WITHOUT the advertising right is refused, and nothing is stored', r.status === 403 && objectPuts().length === 0 && !screenRow().logo_url, r);
  r = await vpbLogoUpload(as(HOST, { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  check('a host is refused, and nothing is stored', (r.status === 403 || r.status === 401) && objectPuts().length === 0 && !screenRow().logo_url, r);
  r = await vpbLogoUpload(as(STRANGER, { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  check('the owner of a different venue is refused for this one', r.status === 403 && objectPuts().length === 0 && !screenRow().logo_url, r);
  r = await vpbLogoUpload(as('', { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  check('nobody signed in is refused', r.status === 401 && objectPuts().length === 0, r);

  print('what may');
  world();
  var big = png(600, 200, 6, { pad: 1024 * 1024 });
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', big) }), ENV, J);
  check('a real PNG over 1 MB is refused, and nothing reaches storage', r.status === 413 && /1MB/.test(r.body.error) && objectPuts().length === 0 && !screenRow().logo_url, r);
  var exact = png(600, 200, 6, { pad: 1024 * 1024 - 57 });
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', exact) }), ENV, J);
  check('one of exactly 1 MB is taken (the limit is "1MB or less")', exact.length === 1048576 && r.status === 200, [exact.length, r.status, r.body && r.body.error]);
  world();
  var jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/jpeg', jpeg) }), ENV, J);
  check('a JPEG is refused (it cannot be transparent), with what to use instead', r.status === 415 && /PNG/.test(r.body.error) && objectPuts().length === 0, r);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', jpeg) }), ENV, J);
  check('a JPEG LABELLED image/png is refused: the bytes decide, not the label', r.status === 415 && objectPuts().length === 0, r);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/gif', bytesOf('GIF89a' + new Array(40).join('\u0000'))) }), ENV, J);
  check('a GIF is refused', r.status === 415 && objectPuts().length === 0, r);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', bytesOf('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="9" height="9"/></svg>')) }), ENV, J);
  check('an SVG (which can carry script) is refused', r.status === 415 && objectPuts().length === 0, r);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: 'not base64 at all!' }), ENV, J);
  check('a string that is not base64 is refused', r.status === 400 && objectPuts().length === 0, r);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', png(8, 8, 6)) }), ENV, J);
  check('an 8 by 8 pixel image is refused by its own header, too small to read on a TV', r.status === 400 && /8 by 8/.test(r.body.error) && objectPuts().length === 0, r);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', png(6000, 300, 6)) }), ENV, J);
  check('a 6000 pixel wide image is refused by its header', r.status === 400 && /6000 by 300/.test(r.body.error) && objectPuts().length === 0, r);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', png(600, 200, 2)) }), ENV, J);
  check('a PNG with a solid background is taken, and the answer says it is not transparent', r.status === 200 && r.body.transparent === false, r.body);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', png(600, 200, 3, { trns: true })) }), ENV, J);
  check('a palette PNG with a tRNS chunk counts as transparent', r.status === 200 && r.body.transparent === true, r.body);
  r = await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/webp', webpX(512, 128, true)) }), ENV, J);
  check('a WebP is taken, stored as .webp and image/webp, with its size read from VP8X', r.status === 200 && /\.webp$/.test(r.body.url) && r.body.width === 512 && r.body.height === 128 && r.body.transparent === true
        && (objectPuts().slice(-1)[0] || { headers: {} }).headers['Content-Type'] === 'image/webp', r.body);

  print('remove');
  world();
  await vpbLogoUpload(as(OWNER, { venue_id: ROYAL, data: dataUrl('image/png', logo) }), ENV, J);
  var had = screenRow().logo_url;
  r = await vpbLogoRemove(as(HOST, { venue_id: ROYAL }), ENV, J);
  check('a host cannot remove it', (r.status === 403 || r.status === 401) && screenRow().logo_url === had && !!had, r);
  r = await vpbLogoRemove(as(NOADS, { venue_id: ROYAL }), ENV, J);
  check('nor a manager without the advertising right', r.status === 403 && screenRow().logo_url === had, r);
  r = await vpbLogoRemove(as(OWNER, { venue_id: ROYAL }), ENV, J);
  check('the owner removes it: the screen row has no logo', r.status === 200 && screenRow().logo_url === null, screenRow());
  check('and the slides are still there', (screenRow().slides || []).length === 1, screenRow());
  check('an audit row says so', DB.vp_admin_audit.some(function (a) { return a.action === 'logo_removed'; }), DB.vp_admin_audit);

  print('"Show our logo on the VenuePlay website"');
  world();
  r = await vpbLogoSite(as(OWNER, { venue_id: ROYAL, show: false }), ENV, J);
  check('unticked: written false on the venue', r.status === 200 && DB.vp_venues[0].show_logo_on_site === false && r.body.show_logo_on_site === false, [r, DB.vp_venues[0]]);
  r = await vpbScreenGet(as(OWNER, { venue_id: ROYAL }), ENV, J);
  check('the Screen tab reads it back unticked', r.status === 200 && r.body.show_logo_on_site === false, r.body);
  r = await vpbLogoSite(as(MANAGER, { venue_id: ROYAL, show: true }), ENV, J);
  check('ticked again by a manager with the advertising right: true', r.status === 200 && DB.vp_venues[0].show_logo_on_site === true, DB.vp_venues[0]);
  r = await vpbLogoSite(as(NOADS, { venue_id: ROYAL, show: false }), ENV, J);
  check('a manager without the right is refused and nothing moves', r.status === 403 && DB.vp_venues[0].show_logo_on_site === true, r);
  r = await vpbLogoSite(as(HOST, { venue_id: ROYAL, show: false }), ENV, J);
  check('a host is refused and nothing moves', (r.status === 403 || r.status === 401) && DB.vp_venues[0].show_logo_on_site === true, r);
  r = await vpbLogoSite(as(OWNER, { venue_id: ROYAL, show: 'no' }), ENV, J);
  check('"no" as a string is not an answer: 400, nothing moves', r.status === 400 && DB.vp_venues[0].show_logo_on_site === true, r);
  r = await vpbLogoSite(as(STRANGER, { venue_id: ROYAL, show: false }), ENV, J);
  check('another venue\'s owner cannot untick it for this one', r.status === 403 && DB.vp_venues[0].show_logo_on_site === true, r);
  world(); REFUSE_COLUMN = 'show_logo_on_site'; delete DB.vp_venues[0].show_logo_on_site;
  r = await vpbLogoSite(as(OWNER, { venue_id: ROYAL, show: false }), ENV, J);
  check('before migration 102 it says it is not switched on yet, never "saved"', r.status === 503 && !r.body.ok, r);
  r = await vpbScreenGet(as(OWNER, { venue_id: ROYAL }), ENV, J);
  check('and the Screen tab still loads, the tick showing its default, on', r.status === 200 && r.body.show_logo_on_site === true && Array.isArray(r.body.slides) && r.body.slides.length === 1, r.body);

  print('screen-save no longer stores a pasted address');
  world();
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, logo_url: 'https://evil.example/x.png' }), ENV, J);
  check('a stranger\'s address is refused and nothing is written', r.status === 400 && !screenRow().logo_url, r);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, logo_url: ENV.SUPABASE_URL + '/storage/v1/object/public/venue-logos/' + ELSEWHERE + '/abc.png' }), ENV, J);
  check('our storage, but ANOTHER venue\'s folder, is refused', r.status === 400 && !screenRow().logo_url, r);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, logo_url: ENV.SUPABASE_URL + '/storage/v1/object/public/venue-ads/' + ROYAL + '/1-old.png' }), ENV, J);
  check('a logo uploaded the old way (the ad bucket, this venue) is still accepted', r.status === 200 && /venue-ads/.test(screenRow().logo_url || ''), [r, screenRow()]);
  r = await vpbScreenSave(as(NOADS, { venue_id: ROYAL, logo_url: '' }), ENV, J);
  check('a manager without the advertising right cannot clear it through screen-save either', r.status === 403 && !!screenRow().logo_url, r);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, logo_url: '' }), ENV, J);
  check('an empty one clears it', r.status === 200 && screenRow().logo_url === null, screenRow());

  print('the routes are reachable');
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  ['logo-upload', 'logo-remove', 'logo-site'].forEach(function (p) {
    check('the dispatcher routes POST /account/' + p, src.indexOf("request.method === 'POST' && path === '/account/" + p + "'") !== -1);
  });
  finished = true;
})().catch(function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });
drainMicrotasks();
if (!finished) { fails++; print('  FAIL the suite did not finish'); }
print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
if (fails) throw new Error(fails + ' failed');
