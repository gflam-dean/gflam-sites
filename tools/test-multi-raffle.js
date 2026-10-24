/* MORE THAN ONE RAFFLE A VENUE (Dean, 24 Oct 2026: "Absolutely"; migration 117). RUN, not word-searched.

   Runs the REAL billing Worker on tools/rig-billing-worker.js, before and after migration 117:
     BEFORE  (vp_venue_screen.raffles refused by the database, as PostgREST refuses a column that is
             not there) screen-get says raffles_ready:false and still hands back the slides and the one
             routine; a raffles save is refused in words and changes nothing; the single routine still
             saves.
     AFTER   a venue with a routine and an empty list is shown that routine as its first raffle; two
             raffles save with distinct ids (a new one gets one made), the single routine mirrors the
             first; removing one is saving the list without it; nine are refused; HQ's screen history
             names every raffle.
   And the TV's own functions, lifted out of venueplay/tv.html: one card per raffle with a night set,
   none for a raffle with no night, and the single routine exactly as before when there is no list.

   Run from the repo root:  jsc tools/test-multi-raffle.js */
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
/* jsc has no WebCrypto; the Worker only needs getRandomValues to name a new raffle. */
if (typeof crypto === 'undefined') { var _n = 0; crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (++_n * 37 + i * 11) & 255; return a; } }; }

/* BEFORE migration 117: the database refuses any read or write naming `raffles`, with the 400 PostgREST
   gives for an unknown column. AFTER: the rig's ordinary fake database, which stores whatever it is given. */
var PRE = true;
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), method = (opts && opts.method) || 'GET';
  if (PRE && /\/rest\/v1\/vp_venue_screen/.test(u) &&
      ((method === 'GET' && /select=[^&]*raffles/.test(u)) || (method !== 'GET' && opts && /"raffles"/.test(String(opts.body || ''))))) {
    return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({ message: "column vp_venue_screen.raffles does not exist" }); },
                             text: function () { return Promise.resolve('{"message":"column vp_venue_screen.raffles does not exist"}'); } });
  }
  /* An upsert on venue_id MERGES into the venue's row, as resolution=merge-duplicates does (the rig appends). */
  if (method === 'POST' && /\/rest\/v1\/vp_venue_screen(\?|$)/.test(u)) {
    var b = JSON.parse(String(opts.body || '{}')), rows = DB.vp_venue_screen || (DB.vp_venue_screen = []);
    var have = rows.filter(function (x) { return x.venue_id === b.venue_id; })[0];
    if (have) { for (var k in b) have[k] = b[k]; } else rows.push(b);
    return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve(''); } });
  }
  return rigFetch(url, opts);
};
var OWNER = '50000000-0000-4000-8000-000000000001', ROYAL = '60000000-0000-4000-8000-000000000001';
function as(user, body) {
  var h = { Authorization: 'Bearer ' + user }, txt = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function J(o, status) { return { status: status || 200, body: o }; }
function world() {
  DB = {}; FAIL = {};
  DB.vp_platform_admins = [];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'royal@example.com', plan: 'monthly', status: 'card_on_file', max_seats: 80 }];
  DB.vp_venues = [{ id: ROYAL, name: 'The Royal Hotel', founding_id: 'f1', slug: 'royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z', au_state: 'NSW' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: ROYAL, role: 'owner', permissions: null }];
  DB.vp_venue_screen = [{ venue_id: ROYAL, slug: 'royal', slides: [{ image_url: 'https://x/y.png', seconds: 8 }], draws: [], logo_url: null,
                          raffle: { label: 'Meat Raffle', day: 'Friday', time: '6:30pm' } }];
  DB.vp_admin_audit = []; DB.vp_venue_settings = []; DB.vp_screens = [];
}
/* The rig's fake PostgREST appends an upsert rather than merging it; the row as it now stands is every
   write for the venue laid over the last, which is what resolution=merge-duplicates does. */
function screen() { var o = {}; DB.vp_venue_screen.filter(function (r) { return r.venue_id === ROYAL; }).forEach(function (r) { for (var k in r) o[k] = r[k]; }); return o; }

(async function () {
  print('before migration 117: the one routine, exactly as it was');
  world(); PRE = true;
  var r = await vpbScreenGet(as(OWNER, { venue_id: ROYAL }), {}, J).catch(function (e) { return { status: 500, body: { error: String(e) } }; });
  check('screen-get answers, with the slides and the single routine, and says the list is not there yet',
        r.status === 200 && r.body.raffles_ready === false && r.body.slides.length === 1 && r.body.raffle && r.body.raffle.label === 'Meat Raffle', r.body);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, raffles: [{ label: 'Chook Raffle', day: 'Sunday', time: '3pm' }] }), {}, J);
  check('a raffles save is refused in words ("run migration 117 first") and changes nothing',
        r.status === 409 && /migration 117/.test(r.body.error) && screen().raffle.label === 'Meat Raffle' && screen().raffles === undefined, [r.status, r.body, screen()]);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, raffle: { label: 'Meat Raffle', day: 'Saturday', time: '5pm' } }), {}, J);
  check('the single routine still saves', r.status === 200 && screen().raffle.day === 'Saturday', [r.body, screen().raffle]);

  print('after migration 117: a list');
  world(); PRE = false;
  r = await vpbScreenGet(as(OWNER, { venue_id: ROYAL }), {}, J);
  check('a venue whose list is empty but has a routine is shown that routine as its first raffle',
        r.status === 200 && r.body.raffles_ready === true && r.body.raffles.length === 1 && r.body.raffles[0].label === 'Meat Raffle' && r.body.raffles[0].day === 'Friday', r.body.raffles);
  var first = r.body.raffles[0];
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, raffles: [first, { label: 'Chook Raffle', day: 'Sunday', time: '3pm' }] }), {}, J);
  var st = screen().raffles || [];
  check('two raffles save: the first keeps its id, the new one gets its own',
        r.status === 200 && st.length === 2 && st[0].id === first.id && /^r[0-9a-f]{16}$/.test(st[1].id) && st[1].label === 'Chook Raffle', [r.body, st]);
  check('the single routine mirrors the FIRST raffle, for anything still reading it', screen().raffle && screen().raffle.label === 'Meat Raffle' && screen().raffle.day === 'Friday', screen().raffle);
  r = await vpbScreenGet(as(OWNER, { venue_id: ROYAL }), {}, J);
  check('screen-get hands back both, in order', r.body.raffles.map(function (x) { return x.label; }).join('|') === 'Meat Raffle|Chook Raffle', r.body.raffles);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, raffles: [st[0], st[1], { id: st[1].id, label: 'Copy', day: 'Monday', time: '1pm' }, { label: '', day: '', time: '' }] }), {}, J);
  var st2 = screen().raffles || [];
  check('an empty raffle is dropped, and a repeated id is given a new one rather than two raffles sharing it',
        st2.length === 3 && st2[2].label === 'Copy' && st2[2].id !== st2[1].id, st2);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, raffles: [st2[1]] }), {}, J);
  check('removing is saving the list without it: Meat Raffle gone, the routine now mirrors Chook Raffle',
        (screen().raffles || []).length === 1 && screen().raffles[0].label === 'Chook Raffle' && screen().raffle.label === 'Chook Raffle', screen());
  var nine = []; for (var i = 0; i < 9; i++) nine.push({ label: 'R' + i, day: 'Friday', time: '6pm' });
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, raffles: nine }), {}, J);
  check('nine raffles are refused, saying how many a venue can have', r.status === 400 && /up to 8 raffles/.test(r.body.error) && screen().raffles.length === 1, r.body);
  r = await vpbScreenSave(as(OWNER, { venue_id: ROYAL, raffles: [] }), {}, J);
  check('removing the last raffle empties the list and the routine', r.status === 200 && screen().raffles.length === 0 && screen().raffle === null, screen());
  check('HQ screen history names every raffle', vpaScreenRaffleLabel({ raffles: [{ label: 'Meat Raffle', day: 'Friday', time: '6:30pm' }, { label: 'Chook Raffle', day: 'Sunday', time: '3pm' }] })
        === 'Meat Raffle, Friday, 6:30pm / Chook Raffle, Sunday, 3pm');

  print('the TV: one card per raffle with a night set');
  var html = readFile('venueplay/tv.html');
  function grab(name) {
    var i = html.indexOf('function ' + name + '('); if (i < 0) return null;
    var d = 0, started = false;
    for (var j = i; j < html.length; j++) { if (html[j] === '{') { d++; started = true; } else if (html[j] === '}') { d--; if (started && d === 0) return html.slice(i, j + 1); } }
    return null;
  }
  var ADS = { slides: [], draws: [], raffle: null, raffles: null, rotationSecs: 7 }, BAD_IMG = {};
  function slideVisible() { return true; } function venuePending() { return false; }
  function esc(s) { return String(s == null ? '' : s); } function escBr(s) { return esc(s); } function accentHex() { return '#FF1F8E'; }
  eval(grab('hasRaffle')); eval(grab('rafflesOnWall')); eval(grab('loopEntries')); eval(grab('entryInner'));
  function raffleCards() { return loopEntries().filter(function (e) { return e.type === 'auto-raffle'; }).map(function (e) { return entryInner(e); }); }
  ADS.raffle = { label: 'Meat Raffle', day: 'Friday', time: '6:30pm' };
  var c = raffleCards();
  check('no list yet (null): the single routine, one card, as always', c.length === 1 && /Meat Raffle/.test(c[0]) && /Drawn Friday 6:30pm/.test(c[0]), c);
  ADS.raffles = [{ id: 'a1b2c3', label: 'Meat Raffle', day: 'Friday', time: '6:30pm' }, { id: 'd4e5f6', label: 'Chook Raffle', day: 'Sunday', time: '3pm' },
                 { id: 'g7h8i9', label: 'Not yet', day: '', time: '' }];
  c = raffleCards();
  check('a list: one card per raffle with a night set, each its own words; none for the raffle with no night',
        c.length === 2 && /Meat Raffle/.test(c[0]) && /Chook Raffle/.test(c[1]) && /Drawn Sunday 3pm/.test(c[1]) && !/Not yet/.test(c.join('')), c);
  ADS.raffles = [];
  check('an empty list: no raffle card, even with the old routine still set', raffleCards().length === 0);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('multi-raffle: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
