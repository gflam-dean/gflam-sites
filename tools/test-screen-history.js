/* A venue's screen never changes or vanishes without a record, and HQ can put any version back: RUN, not read.

   Why (21 Oct 2026): Dean uploaded Tugun Bowls Club's logo and ad slides into its account. Later
   there was no vp_venue_screen row, no stored file and no audit entry, so nobody could say what
   happened. Migration 114 adds vp_venue_screen_history, written by a trigger on every insert,
   update and delete of vp_venue_screen (the DATABASE half, proven on the real database by the
   self-test at the end of the migration, and its shape by tools/screen-history-sql.test.py).

   This runs the WORKER half, the REAL billing Worker on tools/rig-billing-worker.js:
     every write   logo upload, logo remove and screen save all go through one write that names
                   who is writing in X-VP-Actor (venue login, or HQ View as), and the audit row
                   carries the screen before and after; a slide upload is audited with its address;
                   a name the header cannot carry does not stop a save
     history       GET /admin/screen-history: Gflam admins only, never a venue login; newest first,
                   in words (what changed, who, through which door, a direct database change called
                   out); still shown when the venue row has gone; says so before migration 114
     restore       POST /admin/screen-restore: owner and accounts admins only; puts back EXACTLY
                   the old logo, slides, draws and raffle (a deleted row too); recorded as an HQ
                   restore naming the version, audited, and says which images are no longer stored;
                   another venue's version, or a venue that no longer exists, changes nothing
     nightly       scheduled() asks the database's check; drift or a vanished row is audited
     storage       nothing in either Worker or any page deletes a stored file
     HQ            the Screen history card, run: a Restore button only where allowed, a deleted
                   or direct change marked, and no address that is not https painted as an image

   The stand-in for the trigger below records the same columns migration 114's trigger records,
   from the same header, so the routes are tested against rows of the shape Postgres writes.

   Run from the repo root:  jsc tools/test-screen-history.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
var URL = function (u) { var m = /^(https?:\/\/[^\/?#]+)([^?#]*)(\?[^#]*)?/.exec(String(u)); this.origin = m[1]; this.pathname = m[2] || '/'; var q = (m[3] || '').slice(1);
  this.searchParams = { get: function (k) { var hit = q.split('&').map(function (kv) { return kv.split('='); }).filter(function (kv) { return decodeURIComponent(kv[0]) === k; })[0]; return hit ? decodeURIComponent(hit[1] || '') : null; } }; };

/* ---- the database's half, as migration 114 writes it ---- */
var rigFetch = globalThis.fetch, WRITES = [], HEADS = [], STORED = {}, NO_HISTORY = false, RPC = [], RPC_ANSWER = null, HID = 0;
function res(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
  json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } }); }
function clone(o) { return o == null ? null : JSON.parse(JSON.stringify(o)); }
/* Postgres compares jsonb by value, keys in any order. A replacer ARRAY would filter nested keys
   too (every slide would read as {}), so sort the top level by hand and keep the rest whole. */
function sansClock(o) { var c = clone(o) || {}; delete c.updated_at; return JSON.stringify(Object.keys(c).sort().map(function (k) { return [k, c[k]]; })); }
function capture(op, oldRow, newRow, headers) {
  var raw = headers && (headers['X-VP-Actor'] || headers['x-vp-actor']), act = null;
  if (raw) { try { act = JSON.parse(raw); } catch (e) { act = { unreadable: String(raw).slice(0, 300) }; } }
  if (op === 'update' && sansClock(oldRow) === sansClock(newRow)) return;
  var n = newRow || oldRow;
  tbl('vp_venue_screen_history').push({ id: ++HID, venue_id: n.venue_id, slug: n.slug, op: op, old_row: clone(oldRow), new_row: clone(newRow),
    changed_at: new Date(Date.UTC(2026, 9, 21, 0, HID)).toISOString(), actor: act, via: (act && act.via) || 'direct',
    db_session_user: raw ? 'authenticator' : 'postgres', db_role: raw ? 'service_role' : null, jwt_role: raw ? 'service_role' : null });
}
function directDelete(venueId) {   // the Supabase dashboard: no Worker, no header
  var row = screenOf(venueId); DB.vp_venue_screen = DB.vp_venue_screen.filter(function (r) { return r !== row; });
  capture('delete', row, null, null);
}
globalThis.fetch = function (url, opts) {
  var u = String(url); opts = opts || {}; var method = opts.method || 'GET', h = opts.headers || {};
  if (/\/storage\/v1\/object\/public\//.test(u) && method === 'HEAD') { HEADS.push(u); return res(STORED[u] ? 200 : 404, ''); }
  if (/\/storage\/v1\//.test(u)) return res(200, {});
  if (/\/rest\/v1\/rpc\/vp_screen_history_check/.test(u)) { RPC.push(u); return RPC_ANSWER ? res(200, RPC_ANSWER) : res(404, { code: 'PGRST202' }); }
  if (/\/rest\/v1\/vp_venue_screen_history/.test(u)) {
    if (NO_HISTORY) return res(404, { code: 'PGRST205', message: 'Could not find the table public.vp_venue_screen_history in the schema cache' });
    if (method !== 'GET') return res(403, { code: '42501', message: 'permission denied for table vp_venue_screen_history' });
  }
  if (/\/rest\/v1\/vp_venue_screen(\?|$)/.test(u) && method === 'POST') {
    WRITES.push({ headers: h, body: JSON.parse(opts.body) });
    if (!/merge-duplicates/.test(h.Prefer || '')) return res(400, 'expected an upsert');
    var row = JSON.parse(opts.body), have = screenOf(row.venue_id);
    if (have) { var before = clone(have); for (var k in row) have[k] = row[k]; capture('update', before, have, h); }
    else { var full = Object.assign({ slides: [], draws: [], raffle: null, logo_url: null }, row); tbl('vp_venue_screen').push(full); capture('insert', null, full, h); }
    return res(201, '');
  }
  /* The rig hands back its own row objects; a real database hands back copies. Without this a
     row read BEFORE a write changes when the write lands, and "before" reads as "after". */
  if (/\/rest\/v1\/vp_venue_screen\?/.test(u) && method === 'GET') {
    return rigFetch(url, opts).then(function (r) { return r.json().then(function (rows) { return res(r.status, clone(rows)); }); });
  }
  return rigFetch(url, opts);
};

function U(n) { return '90000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return 'a0000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OWNER = U(1), NOADS = U(2), HOST = U(3), STRANGER = U(4), DEAN = U(5), ACCOUNTS = U(6), STAFFADMIN = U(7), RENEE = U(8);
var TUGUN = V(1), OTHER = V(2);
var PUB = ENV.SUPABASE_URL + '/storage/v1/object/public/';
var AD1 = PUB + 'venue-ads/' + TUGUN + '/1-a.png', AD2 = PUB + 'venue-ads/' + TUGUN + '/2-b.png', AD3 = PUB + 'venue-ads/' + TUGUN + '/3-c.png';
var LOGO_OLD = PUB + 'venue-logos/' + TUGUN + '/' + '1'.repeat(64) + '.png';
function req(user, body, o) {
  o = o || {};
  var h = { Authorization: user ? 'Bearer ' + user : '' };
  if (o.viewAs) h['X-VP-Venue'] = o.viewAs;
  var txt = JSON.stringify(body || {});
  return { url: o.url || 'https://api/x', method: o.method || 'POST', headers: { get: function (k) { return h[k] || ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function world() {
  DB = {}; FAIL = {}; WRITES = []; HEADS = []; STORED = {}; NO_HISTORY = false; RPC = []; RPC_ANSWER = null; HID = 0;
  STORED[AD1] = STORED[AD2] = STORED[LOGO_OLD] = true;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' },
                           { auth_user_id: STAFFADMIN, label: 'Staff', role: 'staff' }, { auth_user_id: RENEE, label: 'Renée – HQ', role: 'owner' }];
  DB.venueplay_founding = [{ id: 'f1', contact_email: 't@example.com', plan: 'monthly', status: 'active', stripe_subscription_id: 'sub_1' },
                           { id: 'f2', contact_email: 'o@example.com', plan: 'monthly', status: 'active', stripe_subscription_id: 'sub_2' }];
  DB.vp_venues = [{ id: TUGUN, name: 'Tugun Bowls Club', founding_id: 'f1', slug: 'tugun-bowls', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z' },
                  { id: OTHER, name: 'Other Hotel', founding_id: 'f2', slug: 'other', status: 'active', max_players: 40, created_at: '2026-01-02T00:00:00Z' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: TUGUN, role: 'owner', permissions: null },
                       { id: 's2', auth_user_id: NOADS, venue_id: TUGUN, role: 'manager', permissions: { advertising: false } },
                       { id: 's3', auth_user_id: HOST, venue_id: TUGUN, role: 'host', permissions: null },
                       { id: 's4', auth_user_id: STRANGER, venue_id: OTHER, role: 'owner', permissions: null }];
  DB.vp_venue_screen = [{ venue_id: TUGUN, slug: 'tugun-bowls', slides: [{ image_url: AD1, seconds: 7 }], draws: [], raffle: null, logo_url: null, updated_at: '2026-10-01T00:00:00Z' }];
  DB.vp_venue_screen_history = [];
  DB.vp_admin_audit = [];
}
function screenOf(id) { return tbl('vp_venue_screen').filter(function (r) { return r.venue_id === id; })[0] || null; }
function hist(id) { return tbl('vp_venue_screen_history').filter(function (r) { return r.venue_id === (id || TUGUN); }); }
function last(a) { return a[a.length - 1] || {}; }
function audits(action) { return DB.vp_admin_audit.filter(function (a) { return a.action === action; }); }
function getHistory(user, venueId) { return vpaHandleScreenHistory(req(user, null, { method: 'GET', url: 'https://api/admin/screen-history?venue_id=' + (venueId || TUGUN) }), ENV, J); }
function restore(user, hid, venueId) { return vpaHandleScreenRestore(req(user, { venue_id: venueId || TUGUN, history_id: hid }), ENV, J); }
var PNG = (function () {   // a real 600 x 200 RGBA PNG header, enough for the Worker's own sniffing
  var b = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2, 88, 0, 0, 0, 200, 8, 6, 0, 0, 0, 0, 0, 0, 0];
  for (var i = 0; i < 40; i++) b.push(i); var s = ''; for (var j = 0; j < b.length; j++) s += String.fromCharCode(b[j]); return 'data:image/png;base64,' + btoa(s);
})();
if (typeof crypto === 'undefined') {
  crypto = { subtle: { digest: function (alg, bytes) { var out = new Uint8Array(32); for (var i = 0; i < bytes.length; i++) out[i % 32] ^= (bytes[i] * 31 + i) & 255; return Promise.resolve(out.buffer); } } };
}

(async function () {
  print('every write names who is writing, and the audit carries before and after');
  world();
  var r = await vpbLogoUpload(req(OWNER, { venue_id: TUGUN, data: PNG }), ENV, J);
  check('the venue owner uploads a logo', r.status === 200 && !!r.body.url, r);
  var h = last(hist());
  check('the history records it: an update, the logo before (none) and after, by the venue\'s own login',
    hist().length === 1 && h.op === 'update' && h.old_row.logo_url === null && h.new_row.logo_url === r.body.url && h.via === 'venue', hist());
  check('...naming the login, the role and the route', h.actor && h.actor.user === OWNER && h.actor.label === 'owner' && h.actor.route === 'logo-upload' && h.actor.admin === null, h.actor);
  var a = last(audits('logo_set'));
  check('the logo_set audit row has the screen before (no logo, 1 slide) and after (the new logo, still 1 slide)',
    a.detail && a.detail.before && a.detail.before.logo_url === null && a.detail.before.slides === 1 &&
    a.detail.after.logo_url === r.body.url && a.detail.after.slides === 1 && a.detail.after.slide_urls[0] === AD1 && a.detail.user === OWNER, a);
  var logoUrl = r.body.url;

  r = await vpbScreenSave(req(OWNER, { venue_id: TUGUN, slides: [{ image_url: AD1, seconds: 7 }, { image_url: AD2, seconds: 9 }] }), ENV, J);
  h = last(hist());
  check('a slide save is recorded: 1 slide before, 2 after, the logo kept', r.status === 200 && h.op === 'update' &&
    h.old_row.slides.length === 1 && h.new_row.slides.length === 2 && h.new_row.logo_url === logoUrl && h.actor.route === 'screen-save', h);
  a = last(audits('screen_updated'));
  check('...and its audit row says what was there and what is there now, by address', a.detail.before.slides === 1 && a.detail.after.slides === 2 &&
    a.detail.after.slide_urls.join(' ') === AD1 + ' ' + AD2 && a.detail.after.logo_url === logoUrl && a.detail.changed.indexOf('slides') !== -1, a.detail);
  check('...with no image data anywhere in the audit', JSON.stringify(DB.vp_admin_audit).indexOf('base64') === -1);

  r = await vpbScreenSave(req(OWNER, { venue_id: TUGUN, raffle: { label: 'Meat tray', day: 'Fri', time: '6pm' } }), ENV, J);
  check('a raffle save is recorded too', r.status === 200 && last(hist()).new_row.raffle.label === 'Meat tray' && last(hist()).old_row.raffle === null, last(hist()));

  r = await vpbLogoRemove(req(OWNER, { venue_id: TUGUN }), ENV, J);
  h = last(hist());
  check('removing the logo is recorded, with the address it had', r.status === 200 && h.old_row.logo_url === logoUrl && h.new_row.logo_url === null && h.actor.route === 'logo-remove', h);
  a = last(audits('logo_removed'));
  check('...and audited with before and after', a.detail.before.logo_url === logoUrl && a.detail.after.logo_url === null, a.detail);

  r = await vpbScreenUpload(req(OWNER, { venue_id: TUGUN, data: PNG }), ENV, J);
  a = last(audits('slide_uploaded'));
  check('a slide upload is audited with where the file lives, before any save', r.status === 200 && a.detail && a.detail.url === r.body.url && a.detail.user === OWNER && a.detail.bytes > 0, a);

  var noHeader = WRITES.filter(function (w) { return !w.headers['X-VP-Actor']; });
  check('every one of the ' + WRITES.length + ' writes to vp_venue_screen carried X-VP-Actor', WRITES.length === 4 && noHeader.length === 0, WRITES.map(function (w) { return w.headers; }));

  print('HQ View as is named as HQ, and a name the header cannot carry does not stop a save');
  r = await vpbScreenSave(req(DEAN, { venue_id: TUGUN, slides: [{ image_url: AD1, seconds: 7 }] }, { viewAs: TUGUN }), ENV, J);
  h = last(hist());
  check('Dean saving through View as is recorded as hq_view_as, by Dean', r.status === 200 && h.via === 'hq_view_as' && h.actor.admin === DEAN && h.actor.label === 'Dean', h.actor);
  r = await vpbScreenSave(req(RENEE, { venue_id: TUGUN, slides: [{ image_url: AD2, seconds: 7 }] }, { viewAs: TUGUN }), ENV, J);
  var hdr = last(WRITES).headers['X-VP-Actor'];
  check('an admin called "Renée – HQ" still saves; the header is plain ASCII and still readable',
    r.status === 200 && /^[\x20-\x7e]+$/.test(hdr) && JSON.parse(hdr).label === 'Ren?e ? HQ' && last(hist()).via === 'hq_view_as', [r, hdr]);
  r = await vpbScreenSave(req(NOADS, { venue_id: TUGUN, slides: [] }), ENV, J);
  check('a manager without the advertising right is still refused, and nothing is recorded because nothing changed',
    r.status === 403 && last(hist()).actor.admin === RENEE, r);

  print('the history, in HQ');
  world();
  await vpbScreenSave(req(OWNER, { venue_id: TUGUN, slides: [{ image_url: AD1, seconds: 7 }, { image_url: AD2, seconds: 9 }] }), ENV, J);
  await vpbScreenSave(req(OWNER, { venue_id: TUGUN, logo_url: LOGO_OLD }), ENV, J);
  var goodVersion = last(hist());
  directDelete(TUGUN);
  check('(a direct delete in the dashboard, as the trigger records it: via direct, the row it held)', last(hist()).op === 'delete' && last(hist()).via === 'direct' && !screenOf(TUGUN));
  r = await getHistory(OWNER);
  check('the venue\'s own owner cannot read it', r.status === 403 && !r.body.entries, r);
  r = await getHistory(HOST);
  check('nor a host', r.status === 403, r);
  r = await getHistory('');
  check('nor nobody', r.status === 401, r);
  r = await getHistory(STAFFADMIN);
  check('a Gflam staff admin can read it, and is told they cannot restore', r.status === 200 && r.body.entries.length === 3 && r.body.can_restore === false, r.body);
  r = await getHistory(DEAN);
  var e = r.body.entries || [];
  check('Dean reads it, newest first', r.status === 200 && e.length === 3 && e[0].op === 'delete' && e[2].op === 'update' && e[0].id > e[1].id, e);
  check('the delete says DELETED, what it held, and that it did NOT come through VenuePlay',
    /DELETED/.test(e[0].changes.join(' ')) && /a logo, 2 slides/.test(e[0].changes.join(' ')) && /NOT through VenuePlay/.test(e[0].who) && /postgres/.test(e[0].who), e[0]);
  check('...and the version it stands for is what was lost, restorable', e[0].version && e[0].version.logo_url === LOGO_OLD && e[0].version.slides.length === 2 && e[0].restorable === true, e[0].version);
  check('the logo change reads "Logo added." by the venue\'s own login', e[1].changes.join(' ') === 'Logo added.' && /venue's own login/.test(e[1].who), e[1]);
  check('the slide save reads "Slides 1 to 2 (1 added)."', e[2].changes.join(' ') === 'Slides 1 to 2 (1 added).', e[2].changes);
  check('the screen now is reported as nothing at all', r.body.current === null, r.body.current);
  check('no image data is sent to HQ, only addresses', JSON.stringify(r.body).indexOf('base64') === -1);

  print('restore puts back exactly the old row');
  r = await restore(STAFFADMIN, e[0].id);
  check('a staff admin cannot restore, and nothing is written', r.status === 403 && !screenOf(TUGUN), r);
  r = await restore(OWNER, e[0].id);
  check('the venue\'s owner cannot restore', r.status === 403 && !screenOf(TUGUN), r);
  r = await restore(DEAN, e[0].id);
  var back = screenOf(TUGUN);
  check('Dean restores the deleted version', r.status === 200 && !!back, r);
  check('the logo, slides, draws and raffle are EXACTLY the old row', back && JSON.stringify(back.slides) === JSON.stringify(goodVersion.new_row.slides) &&
    back.logo_url === goodVersion.new_row.logo_url && JSON.stringify(back.draws) === JSON.stringify(goodVersion.new_row.draws) &&
    JSON.stringify(back.raffle) === JSON.stringify(goodVersion.new_row.raffle) && back.slug === 'tugun-bowls', [back, goodVersion.new_row]);
  h = last(hist());
  check('the restore is itself recorded: via hq_restore, by Dean, naming the version it came from', h.via === 'hq_restore' && h.actor.admin === DEAN && h.actor.restored_from === e[0].id, h);
  a = last(audits('screen_restored'));
  check('...and audited with the version, before (nothing) and after', a.actor_admin === DEAN && a.detail.history_id === e[0].id && a.detail.before === null &&
    a.detail.after.logo_url === LOGO_OLD && a.detail.after.slides === 2, a);
  check('every image it points at was checked, and none is missing', HEADS.length === 3 && r.body.missing_files.length === 0, [HEADS, r.body]);

  await vpbScreenSave(req(OWNER, { venue_id: TUGUN, slides: [{ image_url: AD3, seconds: 5, starts: '2026-11-01' }], raffle: { label: 'Joker', day: 'Sat', time: '' } }), ENV, J);
  r = await getHistory(ACCOUNTS);
  var firstSave = r.body.entries.filter(function (x) { return x.op === 'update' && x.changes.join(' ') === 'Slides 1 to 2 (1 added).'; })[0];
  r = await restore(ACCOUNTS, firstSave.id);
  back = screenOf(TUGUN);
  check('an accounts admin restores an older UPDATE version: slides and timings exactly, raffle back to none, logo back to none',
    r.status === 200 && JSON.stringify(back.slides) === JSON.stringify([{ image_url: AD1, seconds: 7 }, { image_url: AD2, seconds: 9 }]) && back.raffle === null && back.logo_url === null, back);
  delete STORED[AD2];
  r = await restore(ACCOUNTS, e[0].id);
  check('a version whose image has gone from storage is still put back, and the answer names the missing file', r.status === 200 && r.body.missing_files.length === 1 && r.body.missing_files[0] === AD2, r.body);

  print('restore changes nothing it should not');
  var before = JSON.stringify(screenOf(TUGUN)), n0 = hist().length;
  tbl('vp_venue_screen_history').push({ id: ++HID, venue_id: OTHER, slug: 'other', op: 'baseline', old_row: null,
    new_row: { venue_id: OTHER, slug: 'other', slides: [{ image_url: 'https://x/evil.png', seconds: 7 }], draws: [], raffle: null, logo_url: null }, via: 'migration' });
  r = await restore(DEAN, HID, TUGUN);
  check('another venue\'s version cannot be put on this venue', r.status === 404 && JSON.stringify(screenOf(TUGUN)) === before && hist().length === n0, r);
  r = await restore(DEAN, 99999);
  check('a version that does not exist changes nothing', r.status === 404 && JSON.stringify(screenOf(TUGUN)) === before, r);
  r = await restore(DEAN, 'abc');
  check('a history_id that is not a number is refused', r.status === 400, r);
  DB.vp_venues = DB.vp_venues.filter(function (v) { return v.id !== TUGUN; });
  r = await getHistory(DEAN);
  check('when the venue row itself has gone, the history is still shown, just not restorable',
    r.status === 200 && r.body.entries.length > 3 && r.body.venue === null && r.body.entries.every(function (x) { return x.restorable === false; }), r.body);
  r = await restore(DEAN, e[0].id);
  check('...and a restore onto a venue that no longer exists says so and writes nothing', r.status === 404 && /no longer exists/.test(r.body.error) && JSON.stringify(screenOf(TUGUN)) === before, r);

  print('before migration 114 is run');
  world(); NO_HISTORY = true;
  r = await getHistory(DEAN);
  check('HQ is told the history starts when migration 114 is run', r.status === 200 && r.body.known === false && /114/.test(r.body.note), r.body);
  r = await restore(DEAN, 1);
  check('restore says run 114 first, and writes nothing', r.status === 409 && /114/.test(r.body.error) && WRITES.length === 0, r);
  r = await vpbScreenSave(req(OWNER, { venue_id: TUGUN, slides: [{ image_url: AD2, seconds: 7 }] }), ENV, J);
  check('a venue saving its slides is not held up by it', r.status === 200 && screenOf(TUGUN).slides[0].image_url === AD2, r);

  print('the nightly check');
  world();
  var ranRpc = await vpaScreenHistoryNightly(ENV);
  check('before migration 114 it is quiet: nothing audited', ranRpc.ran === false && audits('screen_history_drift').length === 0, ranRpc);
  RPC_ANSWER = { checked: 40, drift: 0, vanished: 0 };
  await vpaScreenHistoryNightly(ENV);
  check('nothing found: nothing audited', RPC.length === 2 && audits('screen_history_drift').length === 0, RPC);
  RPC_ANSWER = { checked: 40, drift: 1, vanished: 2 };
  await _d.scheduled({}, ENV, {});
  a = last(audits('screen_history_drift'));
  check('the nightly job runs it, and a vanished row or a change outside VenuePlay is audited with the counts',
    RPC.length === 3 && a.detail && a.detail.vanished === 2 && a.detail.drift === 1 && a.detail.checked === 40, [RPC.length, a]);
  tbl('vp_venue_screen_history').push({ id: ++HID, venue_id: TUGUN, slug: 'tugun-bowls', op: 'vanished',
    old_row: { venue_id: TUGUN, slug: 'tugun-bowls', slides: [{ image_url: AD1, seconds: 7 }], draws: [], raffle: null, logo_url: LOGO_OLD }, new_row: null,
    via: 'nightly-check', actor: { label: 'nightly check' } });
  r = await getHistory(DEAN);
  check('HQ reads a vanished row as DISAPPEARED, found by the nightly check, and offers what was lost',
    /DISAPPEARED/.test(r.body.entries[0].changes.join(' ')) && r.body.entries[0].who === 'The nightly check' && r.body.entries[0].version.logo_url === LOGO_OLD && r.body.entries[0].restorable, r.body.entries[0]);

  print('the product never deletes a stored file');
  var srcs = ['venueplay-backend/worker/venueplay-api-FULL.js', 'venueplay-backend/worker/venueplay-game.js', 'venueplay/app/billing.html', 'venueplay/app/hq.html', 'venueplay/app/settings.html'];
  var seen = 0, deletes = [];
  srcs.forEach(function (f) {
    var s = readFile(f), re = /storage\/v1\/object/g, m;
    while ((m = re.exec(s))) {
      seen++;
      var stmt = s.slice(m.index, m.index + 500).split(/\n\s*\}\);|\);\n/)[0];
      if (/DELETE|\/remove\b|\.remove\(/i.test(stmt)) deletes.push(f + ' @' + m.index);
    }
    if (/storage\s*\.\s*from\([^)]*\)\s*\.\s*remove\(/.test(s)) deletes.push(f + ' (supabase-js remove)');
  });
  check('the scan can see the storage calls it is about (' + seen + ')', seen >= 5, seen);
  check('no Worker or page deletes a stored file', deletes.length === 0, deletes);

  print('HQ\'s Screen history card, run');
  var hq = readFile('venueplay/app/hq.html');
  var from = hq.indexOf('  function screenHistoryHtml(v){'), to = hq.indexOf('  function loadScreenHistory(id, btn){');
  check('the card\'s code is where the test looks for it', from > 0 && to > from);
  var OUT = { innerHTML: '', textContent: '' };
  var card = new Function('esc', 'bneWhen', 'document', hq.slice(from, to) + '\nreturn { html: screenHistoryHtml, render: renderScreenHistory };')(
    function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
    function (iso) { return String(iso || '').slice(0, 16); },
    { querySelector: function () { return OUT; } });
  check('Venues > Details paints a Show button for the venue', /data-scrhist="[^"]+">Show<\/button>/.test(card.html({ id: TUGUN })));
  world();
  await vpbScreenSave(req(OWNER, { venue_id: TUGUN, logo_url: LOGO_OLD }), ENV, J);
  directDelete(TUGUN);
  tbl('vp_venue_screen_history')[0].new_row.slides.push({ image_url: 'javascript:alert(1)', seconds: 7 });
  r = await getHistory(DEAN); card.render(TUGUN, r.body);
  check('owner admins see "Restore this version" on each version', (OUT.innerHTML.match(/Restore this version/g) || []).length === 2, OUT.innerHTML.slice(0, 300));
  check('the delete is marked DELETED and as a change that did not come through VenuePlay', /DELETED/.test(OUT.innerHTML) && /NOT through VenuePlay/.test(OUT.innerHTML));
  check('the logo is shown as a picture', OUT.innerHTML.indexOf('<img src="' + LOGO_OLD + '"') !== -1);
  check('an address that is not https is never painted', OUT.innerHTML.indexOf('javascript:') === -1);
  r = await getHistory(STAFFADMIN); card.render(TUGUN, r.body);
  check('a staff admin sees no Restore button, and is told who can', OUT.innerHTML.indexOf('Restore this version') === -1 && /Only owner and accounts admins/.test(OUT.innerHTML));
  card.render(TUGUN, { ok: true, known: false, note: 'Screen history starts when migration 114 is run.' });
  check('before migration 114 the card says so', /114/.test(OUT.textContent));

  print('the routes are reachable');
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  check('the dispatcher routes GET /admin/screen-history', src.indexOf("request.method === 'GET'  && path === '/admin/screen-history'") !== -1);
  check('the dispatcher routes POST /admin/screen-restore', src.indexOf("request.method === 'POST' && path === '/admin/screen-restore'") !== -1);
  finished = true;
})().catch(function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });
drainMicrotasks();
if (!finished) { fails++; print('  FAIL the suite did not finish'); }
print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
