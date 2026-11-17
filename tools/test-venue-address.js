/* HQ MOVE TV ADDRESS, RUN (Dean's open question 32, "yes, step 2"; migration 212; the Lunatic Hotel fix).
   Runs the shipped code with fakes, never reads it for words:
     1. the billing Worker's POST /admin/venue-address (venueplay-api-FULL.js, indirect eval, its own router);
     2. the game Worker's answers to an OLD address: the TV poll (/venue), the slides (/screen), the signing key, and an
        old address's printed code (functions lifted out of venueplay-game.js);
     3. the pages: VPVenueURL.moved (the TV's new address), VPTvPaired.move, tv.html following moved_from, the
        console's old-address lookup (vp-session.js), and HQ (vp-rename-hq.js + hq.html).
   The database half (no two venues ever hold one address, the move is one transaction with its audit row, a game on
   refuses) is migration 212's own triggers and function, run on TEST twice.

   Run from the repo root:  jsc tools/test-venue-address.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); } }
function run(promise) { var out, err, done = false; promise.then(function (v) { out = v; done = true; }, function (e) { err = e; done = true; }); drainMicrotasks(); if (err) throw err; if (!done) throw new Error('did not settle'); return out; }
function q(query, key) { var m = new RegExp('(?:^|&)' + key + '=([^&]*)').exec(query); return m ? decodeURIComponent(m[1]) : null; }
console = { log: function () {}, warn: function () {}, error: function () {} };

/* ============ 1. THE BILLING WORKER ============ */
var apiSrc = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
(0, eval)(apiSrc.replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '') + '\n;globalThis.__worker = _d;');

var V1 = '11111111-1111-4111-8111-111111111111', V2 = '22222222-2222-4222-8222-222222222222';
var db, rpcCalls, rpcAnswer;
function reset() {
  db = {
    admins: [{ auth_user_id: 'u-owner', role: 'owner', label: 'Dean' }, { auth_user_id: 'u-acc', role: 'accounts', label: 'Acc' }, { auth_user_id: 'u-sup', role: 'support', label: 'Sup' }],
    venues: [
      { id: V1, name: 'The Lunatic', slug: 'lunatic-hotel', postcode: '4220', join_code: 'LUNA22' },
      { id: V2, name: 'The Royal', slug: 'the-royal', postcode: '2000', join_code: 'ROYL22' },
    ],
    aliases: [{ slug: 'the-lunatic', venue_id: V2, retired_at: '2026-11-01T00:00:00Z', retired_by: 'Dean' }],
  };
  rpcCalls = []; rpcAnswer = function (a) { return { status: 200, body: { ok: true, from: 'lunatic-hotel', to: a.p_new_slug, join_code: 'LUNA22', old_addresses: ['lunatic-hotel'] } }; };
}
vpaVerifyJWT = async function (token) { return token ? { sub: token, email: token + '@x' } : null; };
vpaSelect = async function (env, table, query) {
  if (table === 'vp_platform_admins') { var id = q(query, 'auth_user_id').replace(/^eq\./, ''); return db.admins.filter(function (a) { return a.auth_user_id === id; }); }
  if (table === 'vp_venues') {
    var rows = db.venues.slice(), idq = q(query, 'id'), sl = q(query, 'slug');
    if (idq) rows = rows.filter(function (v) { return v.id === idq.slice(3); });
    if (sl) rows = rows.filter(function (v) { return v.slug === sl.slice(3); });
    return rows.map(function (v) { return Object.assign({}, v); });
  }
  if (table === 'vp_venue_slug_aliases') {
    var a = db.aliases.slice(), s2 = q(query, 'slug'), vq = q(query, 'venue_id');
    if (s2) a = a.filter(function (r) { return r.slug === s2.slice(3); });
    if (vq) a = a.filter(function (r) { return r.venue_id === vq.slice(3); });
    return a.map(function (r) { return Object.assign({}, r); });
  }
  return [];
};
fetch = async function (url, init) {
  if (String(url).indexOf('/rest/v1/rpc/vp_venue_move_address') >= 0) {
    var args = JSON.parse(init.body); rpcCalls.push(args);
    var r = rpcAnswer(args);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async function () { return r.body; } };
  }
  return { status: 500, ok: false, json: async function () { return null; } };
};
var ENV = { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_KEY: 'k', SUPABASE_JWT_SECRET: 's' };
function req(who, body) {
  var h = { 'content-type': 'application/json', 'origin': 'https://venueplay.com.au' };
  if (who) h.authorization = 'Bearer ' + who;
  return { method: 'POST', url: 'https://api.test/admin/venue-address', headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
           text: async function () { return JSON.stringify(body); }, json: async function () { return body; } };
}
function jsonFake(body, status) { return { body: body, status: status || 200 }; }
function call(who, body) { return run(vpaHandleVenueAddress(req(who, body), ENV, jsonFake)); }

print('THE ROUTE AND WHO MAY USE IT');
check('the Worker routes POST /admin/venue-address to the handler', /path === '\/admin\/venue-address'[^\n]*vpaHandleVenueAddress\(request, env, json\)/.test(apiSrc));
['u-venue-login', ''].forEach(function (who) {
  reset(); var r = call(who, { venue_id: V1, preview: true });
  check('a preview is refused for ' + (who || 'no login'), r.status === 401 || r.status === 403, r);
});
['u-acc', 'u-sup'].forEach(function (who) {
  reset(); var r = call(who, { venue_id: V1, preview: true });
  check(who + ' may read the addresses (preview)', r.status === 200 && r.body.ok === true && r.body.slug === 'lunatic-hotel', r);
  r = call(who, { venue_id: V1, slug: 'the-lunatic-4220' });
  check(who + ' may NOT move one: 403, the database never asked', r.status === 403 && rpcCalls.length === 0, [r, rpcCalls]);
});
reset();
var r = call('', { venue_id: V1, slug: 'x-y' });
check('no login: refused, the database never asked', (r.status === 401 || r.status === 403) && rpcCalls.length === 0, r);

print('\nTHE PREVIEW: what the new name gives, never a taken address');
reset();
r = call('u-owner', { venue_id: V1, preview: true });
check('"The Lunatic" is another venue\'s OLD address, so the proposal skips it (postcode added)', r.body.proposed === 'the-lunatic-4220' && r.body.matches_name === false, r.body);
check('the preview changes nothing', rpcCalls.length === 0 && db.venues[0].slug === 'lunatic-hotel');
reset(); db.aliases = [{ slug: 'lunatic-hotel-old', venue_id: V1, retired_at: '2026-11-02T00:00:00Z', retired_by: 'Dean' }];
r = call('u-owner', { venue_id: V1, preview: true });
check('a free name proposes exactly the name, and lists this venue\'s own old addresses', r.body.proposed === 'the-lunatic' && r.body.old_addresses.length === 1 && r.body.old_addresses[0].slug === 'lunatic-hotel-old', r.body);
reset(); db.venues[0].name = 'Lunatic Hotel';
r = call('u-owner', { venue_id: V1, preview: true });
check('a name that already matches the address says so', r.body.matches_name === true && r.body.proposed === 'lunatic-hotel', r.body);
reset(); db.aliases = [{ slug: 'the-lunatic', venue_id: V1, retired_at: '2026-11-02T00:00:00Z' }];
r = call('u-owner', { venue_id: V1, preview: true });
check('the venue\'s OWN old address may be taken back', r.body.proposed === 'the-lunatic', r.body);

print('\nTHE MOVE: owner only, one database call, every refusal a plain sentence');
reset();
r = call('u-owner', { venue_id: V1, slug: ' The-Lunatic-4220 ' });
check('moved: one call to vp_venue_move_address with the venue, the new address and the owner',
  r.status === 200 && r.body.ok === true && r.body.to === 'the-lunatic-4220' && rpcCalls.length === 1 &&
  rpcCalls[0].p_venue_id === V1 && rpcCalls[0].p_new_slug === 'the-lunatic-4220' && rpcCalls[0].p_actor_admin === 'u-owner' && rpcCalls[0].p_actor_label === 'Dean', [r, rpcCalls]);
check('the answer names the old address that still forwards and the unchanged join code', r.body.from === 'lunatic-hotel' && r.body.old_addresses[0] === 'lunatic-hotel' && r.body.join_code === 'LUNA22', r.body);
[['Bad Slug!', 'spaces and punctuation'], ['a', 'one character'], ['-x-', 'leading hyphen'], ['lunatic-hotel', 'its own address']].forEach(function (c) {
  reset(); var rr = call('u-owner', { venue_id: V1, slug: c[0] });
  check('refused before the database: ' + c[1], rr.status === 400 && rpcCalls.length === 0, rr);
});
[['taken', /Another venue already has/], ['taken_old', /can never be used again/], ['code_clash', /screen channel/], ['game_on', /game is open/], ['no_code', /printed code/]].forEach(function (c) {
  reset(); rpcAnswer = function () { return { status: 200, body: { ok: false, reason: c[0] } }; };
  var rr = call('u-owner', { venue_id: V1, slug: 'the-lunatic-4220' });
  check('the database says ' + c[0] + ': 409 and a plain reason', rr.status === 409 && c[1].test(rr.body.error) && rr.body.reason === c[0], rr);
});
reset(); rpcAnswer = function () { return { status: 404, body: null }; };
r = call('u-owner', { venue_id: V1, slug: 'the-lunatic-4220' });
check('migration 212 not run yet: "not set up yet", 503', r.status === 503 && /not set up yet/.test(r.body.error), r);
reset(); rpcAnswer = function () { return { status: 500, body: null }; };
r = call('u-owner', { venue_id: V1, slug: 'the-lunatic-4220' });
check('a database failure: 500, "Nothing changed"', r.status === 500 && /Nothing changed/.test(r.body.error), r);
reset();
r = call('u-owner', { venue_id: '99999999-9999-4999-8999-999999999999', slug: 'x-y' });
check('a venue that does not exist: 404, the database never asked', r.status === 404 && rpcCalls.length === 0, r);

print('\nA NEW VENUE NEVER GETS AN OLD ADDRESS');
reset();
check('vpaSlugTaken: another venue\'s old address is taken', run(vpaSlugTaken(ENV, 'the-lunatic')) === true);
check('vpaSlugTaken: a current address is taken, a free one is not', run(vpaSlugTaken(ENV, 'the-royal')) === true && run(vpaSlugTaken(ENV, 'free-pub')) === false);
check('vpaUniqueSlug steps past an old address (sign-up, Add a venue, HQ new venue)', run(vpaUniqueSlug(ENV, 'the-lunatic', 'seed', '4220')) === 'the-lunatic-4220');

/* ============ 2. THE GAME WORKER ============ */
print('\nTHE GAME WORKER ANSWERS AN OLD ADDRESS');
var gsrc = readFile('venueplay-backend/worker/venueplay-game.js');
function lift(n) {
  var i = gsrc.indexOf('async function ' + n + '('); if (i < 0) i = gsrc.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('cannot find ' + n);
  var d = 0, k = gsrc.indexOf('{', i);
  do { if (gsrc[k] === '{') d++; else if (gsrc[k] === '}') d--; k++; } while (d > 0 && k < gsrc.length);
  return gsrc.slice(i, k) + '\n';
}
function URL(u) {
  var base = u.split('?')[0], qs = u.indexOf('?') >= 0 ? u.slice(u.indexOf('?') + 1) : '', keys = [], map = {};
  qs.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i); if (!(k in map)) keys.push(k); map[k] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1)); });
  this.searchParams = { get: function (k) { return k in map ? map[k] : null; }, set: function (k, v) { if (!(k in map)) keys.push(k); map[k] = String(v); } };
  this.toString = function () { return base + '?' + keys.map(function (k) { return k + '=' + encodeURIComponent(map[k]); }).join('&'); };
}
function Request(u) { this.url = u; }
var G = { venues: [], aliases: [], screens: [], reads: [] };
var enc = encodeURIComponent, AMBIGUOUS = '__two__';
var _vcMap = null, _vcAt = 0, _vcHashMap = {}, _vcMapAll = {}, _vcSuspended = {}, _vcDupes = [];
var screenPollRpcMissing = true, screenShownRpcMissing = true, screenKindRpcMissing = true;
function screenShownTally() { return null; } function screenKindParam() { return null; }
function publicEvents() { return []; } function screenWeek() { return []; }
async function sbGet(env, table, query) {
  G.reads.push(table + '?' + query);
  if (table === 'vp_venue_slug_aliases') { if (G.noAliasTable) throw new Error('404'); var s = q(query, 'slug').slice(3); return G.aliases.filter(function (a) { return a.slug === s; }); }
  if (table === 'vp_venues') {
    var rows = G.venues.slice(), sl = q(query, 'slug'), id = q(query, 'id'), jc = q(query, 'join_code');
    if (sl) rows = rows.filter(function (v) { return v.slug === sl.slice(3); });
    if (id) rows = rows.filter(function (v) { return v.id === id.slice(3); });
    if (jc) rows = rows.filter(function (v) { return v.join_code === jc.slice(3); });
    return rows.map(function (v) { return Object.assign({}, v); });
  }
  if (table === 'vp_venue_screen') { var s3 = q(query, 'slug').slice(3); return G.screens.filter(function (x) { return x.slug === s3; }); }
  return [];
}
async function sbGetAll(env, table) { if (table === 'vp_venue_slug_aliases') { if (G.noAliasTable) throw new Error('404'); return G.aliases; } return G.venues; }
async function sbPatch() {}
(0, eval)(['fnvVenueCode', 'venueSlugMoved', 'handleVenueLookup', 'venueLookupThreeTrips', 'venueLookupReply', 'handleScreen',
  'signingVenueForReceiver', 'refreshVenueCodes', 'venueByCode', 'venueByCodeNotIssued'].map(lift).join('\n'));
var gjson = function (b, s) { return { body: JSON.parse(JSON.stringify(b)), status: s || 200 }; };
var GV = { id: V1, name: 'The Lunatic', slug: 'the-lunatic-4220', join_code: 'MNPQRS', status: 'active', screen_seen_at: null };
function greset() { G = { venues: [Object.assign({}, GV)], aliases: [{ slug: 'lunatic-hotel', venue_id: V1 }], screens: [{ slug: 'the-lunatic-4220', venue_id: V1, slides: [{ image_url: 'x' }] }], reads: [] }; _vcMap = null; }
function poll(slug, code) { return run(handleVenueLookup(new Request('https://g.test/venue?venue=' + slug + '&code=' + (code || 'ZZZZZZ') + '&v=1'), {}, gjson)); }

greset();
var a = poll('lunatic-hotel');
check('/venue at the OLD address: the venue, its new address, and moved_from', a.body.exists === true && a.body.slug === 'the-lunatic-4220' && a.body.moved_from === 'lunatic-hotel', a.body);
greset();
a = poll('lunatic-hotel', 'MNPQRS');
check('...also when the old address\'s code found the venue first (the TV sends hash(slug), the join code)', a.body.slug === 'the-lunatic-4220' && a.body.moved_from === 'lunatic-hotel', a.body);
greset();
a = poll('the-lunatic-4220');
check('/venue at the CURRENT address: no moved_from, and the old-address table is never read',
  a.body.exists === true && a.body.moved_from === undefined && G.reads.every(function (x) { return x.indexOf('vp_venue_slug_aliases') < 0; }), [a.body, G.reads]);
greset();
a = poll('never-a-pub');
check('an address nobody ever had: exists:false, as before', a.body.exists === false, a.body);
greset(); G.noAliasTable = true;
a = poll('lunatic-hotel');
check('before migration 212 runs: an old address is just not found (exists:false), nothing throws', a.body.exists === false, a.body);
greset();
a = poll('lunatichotel4220x', 'MNPQRS');
check('an address found only by its code (never this venue\'s old address) is NOT called a move', a.body.exists === true && a.body.moved_from === undefined, a.body);

greset();
var sc = run(handleScreen(new Request('https://g.test/screen?venue=lunatic-hotel'), {}, gjson));
check('/screen at the OLD address: the venue\'s slides, its new address, moved_from', sc.body.exists === true && sc.body.slides.length === 1 && sc.body.slug === 'the-lunatic-4220' && sc.body.moved_from === 'lunatic-hotel', sc.body);
greset();
sc = run(handleScreen(new Request('https://g.test/screen?venue=never-a-pub'), {}, gjson));
check('/screen at an unknown address: exists:false', sc.body.exists === false, sc.body);
greset();
var sv = run(signingVenueForReceiver({}, new URL('https://g.test/x?venue=lunatic-hotel')));
check('a TV on the old address gets its venue\'s signing key', sv && sv.id === V1, sv);

greset(); G.venues[0].join_code = 'CHNGDX';   // the owner pressed Change code, then the address moved
var oldCode = fnvVenueCode('lunatic-hotel');
var found = run(venueByCode({}, oldCode));
check('an old table talker\'s printed code (hash of the old address) still finds the venue', found === V1, [oldCode, found]);
greset(); G.venues[0].join_code = 'CHNGDX'; G.venues.push({ id: V2, name: 'Clash', slug: 'lunatichotel', join_code: 'ACDEFG', status: 'active' });   // its OWN derived code is the old address's (hyphens do not count)
found = run(venueByCode({}, oldCode));
check('a current venue\'s own derived code always beats an old address\'s', fnvVenueCode('lunatichotel') === oldCode && found === V2, found);

/* ============ 3. THE PAGES ============ */
print('\nTHE TV FOLLOWS THE NEW ADDRESS');
var window = { location: { search: '' }, console: console };
(0, eval)(readFile('venueplay/app/vp-venueurl.js'));
var U = window.VPVenueURL;
check('?venue=old -> ?venue=new', U.moved('?venue=lunatic-hotel', 'the-lunatic-4220') === '?venue=the-lunatic-4220', U.moved('?venue=lunatic-hotel', 'the-lunatic-4220'));
check('settings are kept, in order: ?venue=old&intro=0&ads=1', U.moved('?venue=lunatic-hotel&intro=0&ads=1', 'new-pub') === '?venue=new-pub&intro=0&ads=1', U.moved('?venue=lunatic-hotel&intro=0&ads=1', 'new-pub'));
check('the short forms go too: ?lunatic-hotel, ?=lunatic-hotel, ?Slug=x', U.moved('?lunatic-hotel', 'n-p') === '?venue=n-p' && U.moved('?=lunatic-hotel', 'n-p') === '?venue=n-p' && U.moved('?unified=1&Slug=lunatic-hotel', 'n-p') === '?venue=n-p&unified=1', [U.moved('?lunatic-hotel', 'n-p'), U.moved('?unified=1&Slug=lunatic-hotel', 'n-p')]);
check('the new address reads back as the new venue', U.slug(U.moved('?venue=lunatic-hotel&intro=0', 'the-lunatic-4220')) === 'the-lunatic-4220');

var mem = {};
window.localStorage = { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
(0, eval)(readFile('venueplay/app/vp-tvpaired.js'));
var P = window.VPTvPaired;
mem.vpTvPaired = JSON.stringify({ slug: 'lunatic-hotel', at: 123 });
check('a screen paired to the old address stays paired, to the new one, same pairing time', P.move('lunatic-hotel', 'the-lunatic-4220') === true && JSON.parse(mem.vpTvPaired).slug === 'the-lunatic-4220' && JSON.parse(mem.vpTvPaired).at === 123, mem.vpTvPaired);
mem.vpTvPaired = JSON.stringify({ slug: 'some-other-pub', at: 5 });
check('a screen paired to another venue is left alone', P.move('lunatic-hotel', 'the-lunatic-4220') === false && JSON.parse(mem.vpTvPaired).slug === 'some-other-pub');

var tv = readFile('venueplay/tv.html');
var vv = tv.slice(tv.indexOf('function validateVenue(){'), tv.indexOf('window.__vpTvAsk = ask;'));
var follow = /if\(d\.moved_from && d\.slug && d\.moved_from===VENUE_SLUG && d\.slug!==VENUE_SLUG[^\n]*\{([\s\S]*?)\n          \}/.exec(vv);
check('tv.html: the poll answer with moved_from for THIS address sends the screen to the new one', !!follow && /location\.replace\(location\.pathname \+ VPVenueURL\.moved\(location\.search, d\.slug\) \+ location\.hash\)/.test(follow[1]));
check('tv.html: before that, it moves vpTvVenue, vpTvConfirmed and the pairing to the new address', !!follow && /setItem\("vpTvVenue", d\.slug\)/.test(follow[1]) && /setItem\("vpTvConfirmed", d\.slug\)/.test(follow[1]) && /VPTvPaired\.move\(VENUE_SLUG, d\.slug\)/.test(follow[1]));
check('tv.html: never in a demo or a probe', !!follow && /!VP_DEMO && !\/\[\?&\]probe=1/.test(vv));
check('tv.html: it follows BEFORE the screen is confirmed at the old address', vv.indexOf('d.moved_from') > 0 && vv.indexOf('d.moved_from') < vv.indexOf('localStorage.setItem("vpTvConfirmed", VENUE_SLUG)'));

print('\nTHE CONSOLE ON AN OLD ADDRESS');
var ses = readFile('venueplay/app/vp-session.js');
var rfn = (function () { var i = ses.indexOf('function resolveUrlVenue('), d = 0, k = ses.indexOf('{', i); do { if (ses[k] === '{') d++; else if (ses[k] === '}') d--; k++; } while (d > 0); return ses.slice(i, k); })();
var UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var resolveUrlVenue = (0, eval)('(' + rfn + ')');
function fakeClient(rows, aliasTo, rpcFails) {
  var calls = [];
  return { calls: calls,
    from: function () { var f = null; var o = { select: function () { return o; }, eq: function (k, v) { f = [k, v]; return o; },
      maybeSingle: function () { calls.push('from:' + f[1]); var hit = rows.filter(function (r) { return r[f[0]] === f[1]; })[0] || null; return Promise.resolve({ data: hit }); } }; return o; },
    rpc: function (n, a) { calls.push('rpc:' + a.p_slug); return rpcFails ? Promise.reject(new Error('404')) : Promise.resolve({ data: aliasTo[a.p_slug] || null }); } };
}
var rowsC = [{ id: V1, name: 'The Lunatic', slug: 'the-lunatic-4220' }];
var c1 = fakeClient(rowsC, { 'lunatic-hotel': 'the-lunatic-4220' });
var got = run(resolveUrlVenue(c1, 'lunatic-hotel'));
check('a console opened at the old address finds its venue (vp_venue_current_slug, then the venue)', got && got.id === V1 && c1.calls.join(',') === 'from:lunatic-hotel,rpc:lunatic-hotel,from:the-lunatic-4220', [got, c1.calls]);
var c2 = fakeClient(rowsC, {});
got = run(resolveUrlVenue(c2, 'the-lunatic-4220'));
check('at the current address: one read, no extra call', got && got.id === V1 && c2.calls.length === 1, c2.calls);
var c3 = fakeClient(rowsC, {}, true);
got = run(resolveUrlVenue(c3, 'lunatic-hotel'));
check('before migration 212 (the call fails): null, as before, never a throw', got === null, got);

print('\nHQ: MOVE TV ADDRESS (vp-rename-hq.js)');
window.document = { _el: { innerHTML: '' }, querySelector: function () { return window.document._el; } };
(0, eval)(readFile('venueplay/app/vp-rename-hq.js'));
var R = window.VPRename, owner = true, posts, asks, tells, textAnswer, askAnswers, worker;
function setup() { posts = []; asks = []; tells = []; askAnswers = []; worker = function (b) { return b.preview ? { ok: true, slug: 'lunatic-hotel', proposed: 'the-lunatic-4220', matches_name: false, old_addresses: [] } : { ok: true, from: 'lunatic-hotel', to: b.slug, old_addresses: ['lunatic-hotel'] }; }; }
R.init({ isOwner: function () { return owner; },
  post: function (p, b) { posts.push({ p: p, b: b }); return Promise.resolve(worker(b)); },
  ask: function (m) { asks.push(m); return Promise.resolve(askAnswers.length ? askAnswers.shift() : true); },
  askText: function (m, v) { asks.push(m + '|' + v); return Promise.resolve(textAnswer); },
  tell: function (m) { tells.push(m); return Promise.resolve(); } });
var row = { id: V1, name: 'The Lunatic', slug: 'lunatic-hotel' };
owner = true;
check('an owner sees Move TV address', /data-moveaddr="11111111-1111-4111-8111-111111111111"[^>]*>Move TV address</.test(R.addressButton(row)));
owner = false;
check('anyone else sees no button, and a tap sends nothing', R.addressButton(row) === '' && (setup(), run(R.moveAddress(row, false))) === null && posts.length === 0);
owner = true;
setup(); textAnswer = 'the-lunatic-4220'; askAnswers = [true];
var out = run(R.moveAddress(row, false));
check('the button: preview, the address box filled with the proposal, a confirm naming old and new, then the move',
  posts.length === 2 && posts[0].b.preview === true && /\|the-lunatic-4220$/.test(asks[0]) && posts[1].p === '/admin/venue-address' && posts[1].b.slug === 'the-lunatic-4220' && !posts[1].b.preview, [posts, asks]);
check('the confirm shows both full addresses and says the old one keeps working', /Now: venueplay\.com\.au\/tv\?venue=lunatic-hotel/.test(asks[1]) && /New: venueplay\.com\.au\/tv\?venue=the-lunatic-4220/.test(asks[1]) && /old address keeps working/.test(asks[1]) && /join code stays the same/.test(asks[1]), asks[1]);
check('moved: told plainly, old address named as still working, the row takes the new address', out && row.slug === 'the-lunatic-4220' && /still opens this venue/.test(tells[0]), tells);
row.slug = 'lunatic-hotel';
setup(); textAnswer = null;
check('Cancel on the address box sends no move and says nothing', run(R.moveAddress(row, false)) === null && posts.length === 1 && tells.length === 0, tells);
setup(); textAnswer = 'the-lunatic-4220'; askAnswers = [false];
check('No on the confirm sends no move', run(R.moveAddress(row, false)) === null && posts.length === 1);
setup(); textAnswer = 'The Lunatic 4220!';
run(R.moveAddress(row, false));
check('a typed address is tidied the Worker\'s way (lowercase, hyphens)', posts[1] && posts[1].b.slug === 'the-lunatic-4220', posts);
row.slug = 'lunatic-hotel';
setup(); textAnswer = 'x-y'; worker = function (b) { return b.preview ? { ok: true, slug: 'lunatic-hotel', proposed: 'x-y' } : { error: 'Another venue already has that TV address.', reason: 'taken' }; };
out = run(R.moveAddress(row, false));
check('a refusal is told plainly and nothing changes here', out === null && /did not move: Another venue already has/.test(tells[0]) && row.slug === 'lunatic-hotel', tells);
setup(); askAnswers = [false];
out = run(R.moveAddress(row, true));
check('after a rename it OFFERS first, and No sends no move', out === null && posts.length === 1 && /Move it to venueplay\.com\.au\/tv\?venue=the-lunatic-4220 to match the new name\? The old address keeps working/.test(asks[0]), asks);
setup(); worker = function () { return { ok: true, slug: 'lunatic-hotel', proposed: 'lunatic-hotel', matches_name: true, old_addresses: [] }; };
out = run(R.moveAddress(row, true));
check('after a rename whose name already matches the address: nothing asked', out === null && asks.length === 0 && posts.length === 1, asks);
setup(); worker = function () { return { ok: true, slug: 'the-lunatic-4220', old_addresses: [{ slug: 'lunatic-hotel' }, { slug: 'lunatic-<b>' }] }; };
R.fillAddresses(V1); drainMicrotasks();
var shown = window.document._el.innerHTML;
check('Details lists the old addresses that still open the venue, escaped', /Old addresses<\/b> \(still open this venue\) venueplay\.com\.au\/tv\?venue=lunatic-hotel, venueplay\.com\.au\/tv\?venue=lunatic-&lt;b&gt;/.test(shown), shown);

var hq = readFile('venueplay/app/hq.html');
check('hq.html: the button sits beside Rename venue, the old addresses beside the screen address',
  /window\.VPRename\.button\(v\) \+ window\.VPRename\.addressButton\(v\)/.test(hq) && /Screen address<\/b> venueplay\.com\.au\/tv\?venue='\+esc\(v\.slug\|\|""\)\+\s*\n\s*\/\*[^\n]*\*\/\s*\n\s*\(window\.VPRename \? window\.VPRename\.addressSlot\(v\)/.test(hq));
check('hq.html: a tap moves it, a rename then offers it, and an open venue\'s old addresses are filled after every draw',
  /closest\("button\[data-moveaddr\]"\)[\s\S]{0,200}VPRename\.moveAddress\(mv, false\)/.test(hq) && /VPRename\.rename\(rv\)[^\n]*VPRename\.moveAddress\(rv, true\)/.test(hq) && /if\(S\.openVenue && window\.VPRename\) window\.VPRename\.fillAddresses\(S\.openVenue\);/.test(hq));

/* ============ 4. THE PRINTED SIGN (signage.html) ============ */
var sg = readFile('venueplay/signage.html');
check('signage.html: the code a sign prints is the venue\'s issued join_code from the server, the slug hash only the fallback (a moved address keeps its code)',
  /function printCode\(\)\{ return state\.code \|\| \(state\.slug \? venueCode\(state\.slug\) : "------"\); \}/.test(sg) && /var code=printCode\(\);\s*\n\s*var url = venueUrl\(\);/.test(sg) && /state\.code=String\(d\.join_code\)\.toUpperCase\(\);/.test(sg));
check('signage.html: opened on an old address it asks /screen, prints the CURRENT address in the QR, and only falls back to the hash check when the server cannot say',
  /fetch\(VP_SCREEN_API\+"\/screen\?venue="\+encodeURIComponent\(state\.slug\)\)[\s\S]{0,400}d\.slug && d\.slug!==state\.slug\)\{ state\.slug=d\.slug; \}[\s\S]{0,500}checkByHash\(\);/.test(sg));

print('\n' + (fails ? fails + ' FAILED, ' : '') + (ran - fails) + ' of ' + ran + ' checks passed');
if (fails) throw new Error(fails + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
