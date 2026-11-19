/* HQ RENAME VENUE, RUN (Jobs sheet "HQ Rename venue button", 16 Nov 2026).
   Runs the shipped Worker (indirect eval of venueplay-api-FULL.js) with a fake database and drives
   POST /admin/venue-rename through the Worker's own router, then runs the HQ file vp-rename-hq.js
   with a fake page.

   Proves: only an HQ OWNER can rename (accounts, support, a venue login, no login: refused, nothing
   written); the name changes and NOTHING ELSE (slug and join code are never in the patch); the audit
   row carries the old and the new name; a failed audit puts the name back; a name another venue has
   is refused until confirmed; a one-venue account's matching account name follows, a multi-venue
   account's does not; bad names are refused; the HQ button shows for an owner only and Cancel sends
   nothing.

   Run from the repo root:  jsc tools/test-venue-rename.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
(0, eval)(src + '\n;globalThis.__worker = _d;');

var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); } }
function run(promise) { var out, err, done = false; promise.then(function (v) { out = v; done = true; }, function (e) { err = e; done = true; }); drainMicrotasks(); if (err) throw err; if (!done) throw new Error('did not settle'); return out; }

var V1 = '11111111-1111-4111-8111-111111111111', V2 = '22222222-2222-4222-8222-222222222222', V3 = '33333333-3333-4333-8333-333333333333';
var db, patched, audits, auditFails;
function reset() {
  db = {
    admins: [{ auth_user_id: 'u-owner', role: 'owner', label: 'Dean' }, { auth_user_id: 'u-acc', role: 'accounts', label: 'Acc' }, { auth_user_id: 'u-sup', role: 'support', label: 'Sup' }],
    venues: [
      { id: V1, name: 'The Lunatic Hotel', slug: 'lunatic-hotel', join_code: 'LUNA', founding_id: 'f1' },
      { id: V2, name: 'The Royal', slug: 'the-royal', join_code: 'ROYL', founding_id: 'f2' },
      { id: V3, name: 'The Crown', slug: 'the-crown', join_code: 'CRWN', founding_id: 'f2' },
    ],
    founding: [{ id: 'f1', venue_name: 'The Lunatic Hotel' }, { id: 'f2', venue_name: 'The Royal' }],
  };
  patched = []; audits = []; auditFails = false;
}
function q(query, key) { var m = new RegExp('(?:^|&)' + key + '=([^&]*)').exec(query); return m ? decodeURIComponent(m[1]) : null; }
vpaVerifyJWT = async function (token) { return token ? { sub: token, email: token + '@x' } : null; };
vpaSelect = async function (env, table, query) {
  if (table === 'vp_platform_admins') { var id = q(query, 'auth_user_id').replace(/^eq\./, ''); return db.admins.filter(function (a) { return a.auth_user_id === id; }); }
  if (table === 'vp_venues') {
    var rows = db.venues.slice(), idq = q(query, 'id'), nm = q(query, 'name'), fq = q(query, 'founding_id');
    if (idq && idq.indexOf('eq.') === 0) rows = rows.filter(function (v) { return v.id === idq.slice(3); });
    if (idq && idq.indexOf('neq.') === 0) rows = rows.filter(function (v) { return v.id !== idq.slice(4); });
    if (fq) rows = rows.filter(function (v) { return v.founding_id === fq.slice(3); });
    if (nm) { var want = nm.slice(6).replace(/\\(.)/g, '$1').toLowerCase(); rows = rows.filter(function (v) { return v.name.toLowerCase() === want; }); }
    var lim = q(query, 'limit'); if (lim) rows = rows.slice(0, +lim);
    return rows.map(function (v) { return Object.assign({}, v); });
  }
  if (table === 'venueplay_founding') { var fid = q(query, 'id').slice(3); return db.founding.filter(function (f) { return f.id === fid; }).map(function (f) { return Object.assign({}, f); }); }
  return [];
};
vpaPatch = async function (env, table, filter, obj) {
  patched.push({ table: table, filter: filter, obj: obj });
  var id = decodeURIComponent(filter.replace(/^id=eq\./, ''));
  var list = table === 'vp_venues' ? db.venues : (table === 'venueplay_founding' ? db.founding : []);
  list.forEach(function (r) { if (r.id === id) Object.assign(r, obj); });
  return [];
};
vpaInsert = async function (env, table, row) {
  if (table === 'vp_admin_audit') { if (auditFails) throw new Error('down'); audits.push(row); }
  return null;
};

var ENV = { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_KEY: 'k', SUPABASE_JWT_SECRET: 's' };
function req(who, body) {
  var h = { 'content-type': 'application/json', 'origin': 'https://venueplay.com.au' };
  if (who) h.authorization = 'Bearer ' + who;
  return { method: 'POST', url: 'https://api.test/admin/venue-rename', headers: { get: function (k) { return h[String(k).toLowerCase()] || null; } },
           text: async function () { return JSON.stringify(body); }, json: async function () { return body; } };
}
function jsonFake(body, status) { return { body: body, status: status || 200 }; }
function call(who, body) { return run(vpaHandleVenueRename(req(who, body), ENV, jsonFake)); }

print('WHO MAY RENAME: an HQ owner only');
['u-acc', 'u-sup', 'u-venue-login', ''].forEach(function (who) {
  reset();
  var r = call(who, { venue_id: V1, name: 'The Lunatic' });
  check('refused for ' + (who || 'no login') + ', nothing written, nothing audited',
    (r.status === 401 || r.status === 403) && patched.length === 0 && audits.length === 0 && db.venues[0].name === 'The Lunatic Hotel', [r, patched]);
});
reset();
var src0 = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
check('the Worker routes POST /admin/venue-rename to the handler', /path === '\/admin\/venue-rename'[^\n]*vpaHandleVenueRename\(request, env, json\)/.test(src0));
var fnBody = src0.slice(src0.indexOf('async function vpaHandleVenueRename('), src0.indexOf('async function vpaHandleVenueStatus('));
check("the handler's first line asks for the owner role and nothing else", /^async function vpaHandleVenueRename\(request, env, json\) \{\n  const actor = await vpaRequireAdmin\(request, env, \['owner'\]\);\n  if \(actor\.error\) return json/.test(fnBody), fnBody.slice(0, 200));

print('\nTHE RENAME: the name, and nothing else');
reset();
var r = call('u-owner', { venue_id: V1, name: '  The   Lunatic  ' });
check('an owner renames: ok, the tidied name saved', r.status === 200 && r.body.ok === true && db.venues[0].name === 'The Lunatic', r);
var vp = patched.filter(function (p) { return p.table === 'vp_venues'; });
check('the venue patch is the name ONLY: no slug, no join code', vp.length === 1 && Object.keys(vp[0].obj).join(',') === 'name', vp);
check('the TV address and join code are unchanged', db.venues[0].slug === 'lunatic-hotel' && db.venues[0].join_code === 'LUNA');
check('audited once: venue_renamed, old and new name, by the owner',
  audits.length === 1 && audits[0].action === 'venue_renamed' && audits[0].target === 'venue:' + V1 && audits[0].detail.from === 'The Lunatic Hotel' && audits[0].detail.to === 'The Lunatic' && audits[0].actor_admin === 'u-owner', audits);
check("a one-venue account whose name was the venue's follows it", db.founding[0].venue_name === 'The Lunatic' && r.body.account_renamed === true && audits[0].detail.account_renamed === true, db.founding[0]);

reset();
r = call('u-owner', { venue_id: V2, name: 'The Royal Hotel' });
check("a multi-venue account's own name is left alone, even when it was named after this pub", r.status === 200 && db.venues[1].name === 'The Royal Hotel' && db.founding[1].venue_name === 'The Royal' && r.body.account_renamed === false, [r, db.founding[1]]);

print('\nAUDIT OR NOTHING');
reset(); auditFails = true;
r = call('u-owner', { venue_id: V1, name: 'The Lunatic' });
check('the audit row cannot be written: refused and the name put back', r.status === 500 && db.venues[0].name === 'The Lunatic Hotel' && db.founding[0].venue_name === 'The Lunatic Hotel', [r, db.venues[0], db.founding[0]]);

print('\nSAME NAME AS ANOTHER VENUE: asked first');
reset();
r = call('u-owner', { venue_id: V1, name: 'the royal' });
check('refused with needs_confirm and the other venue named, nothing written', r.status === 409 && r.body.needs_confirm === true && r.body.same_name.length === 1 && r.body.same_name[0].slug === 'the-royal' && patched.length === 0 && audits.length === 0, r);
r = call('u-owner', { venue_id: V1, name: 'the royal', confirm_same_name: true });
check('confirmed: saved, and the audit says it was confirmed', r.status === 200 && db.venues[0].name === 'the royal' && audits[0].detail.same_name_confirmed === true, [r, audits]);
reset();
r = call('u-owner', { venue_id: V1, name: 'The R%yal' });
check('a % in the name matches only itself (no wildcard hit on The Royal)', r.status === 200 && db.venues[0].name === 'The R%yal', r);

print('\nBAD INPUT');
reset();
[['', 'empty'], ['   ', 'spaces only'], [new Array(122).join('a'), '121 characters'], ['<b>Pub</b>', 'angle brackets'], ['The Lunatic Hotel', 'the same name']].forEach(function (c) {
  var rr = call('u-owner', { venue_id: V1, name: c[0] });
  check('refused: ' + c[1], rr.status === 400 && patched.length === 0 && audits.length === 0, rr);
});
r = call('u-owner', { venue_id: 'nope', name: 'X' });
check('refused: a venue id that is not an id', r.status === 400 && patched.length === 0, r);
r = call('u-owner', { venue_id: '99999999-9999-4999-8999-999999999999', name: 'X' });
check('refused: a venue that does not exist (404)', r.status === 404 && patched.length === 0, r);

print('\nTHE HQ BUTTON (vp-rename-hq.js)');
window = {};
(0, eval)(readFile('venueplay/app/vp-rename-hq.js'));
var R = window.VPRename, owner = true, posts, asks, tells, textAnswer, askAnswers, worker;
function setup() { posts = []; asks = []; tells = []; askAnswers = []; worker = function () { return { ok: true, from: 'The Lunatic Hotel', name: 'The Lunatic' }; }; }
R.init({ isOwner: function () { return owner; },
  post: function (p, b) { posts.push({ p: p, b: b }); return Promise.resolve(worker(b)); },
  ask: function (m) { asks.push(m); return Promise.resolve(askAnswers.length ? askAnswers.shift() : true); },
  askText: function (m, v) { asks.push(m + '|' + v); return Promise.resolve(textAnswer); },
  tell: function (m) { tells.push(m); return Promise.resolve(); } });
var row = { id: V1, name: 'The Lunatic Hotel' };
owner = true;
check('an owner sees the Rename venue button', /data-rename="11111111-1111-4111-8111-111111111111"[^>]*>Rename venue</.test(R.button(row)));
owner = false;
check('anyone else sees no button', R.button(row) === '');
setup(); textAnswer = 'The Lunatic';
var out = run(R.rename(row));
check('a non-owner tap sends nothing', out === null && posts.length === 0);
owner = true;
setup(); textAnswer = null;
out = run(R.rename(row));
check('Cancel on the name box sends nothing and says nothing', out === null && posts.length === 0 && tells.length === 0, tells);
setup(); textAnswer = 'The Lunatic'; askAnswers = [false];
out = run(R.rename(row));
check('the confirm names the old and new name; No sends nothing', out === null && posts.length === 0 && /The Lunatic Hotel.*to.*The Lunatic/.test(asks[1]) && /TV address and join code stay the same/.test(asks[1]), asks);
setup(); textAnswer = ' The  Lunatic ';
out = run(R.rename(row));
check('Yes: one POST to /admin/venue-rename with the tidied name, the row takes the new name',
  posts.length === 1 && posts[0].p === '/admin/venue-rename' && posts[0].b.name === 'The Lunatic' && posts[0].b.venue_id === V1 && !posts[0].b.confirm_same_name && row.name === 'The Lunatic', posts);
row.name = 'The Lunatic Hotel';
setup(); textAnswer = 'The Royal'; askAnswers = [true, false];
worker = function (b) { return b.confirm_same_name ? { ok: true, name: 'The Royal' } : { needs_confirm: true, same_name: [{ name: 'The Royal', slug: 'the-royal' }], error: 'x' }; };
out = run(R.rename(row));
check('same name: asked, No sends no second POST and keeps the old name', out === null && posts.length === 1 && /already called/.test(asks[2]) && row.name === 'The Lunatic Hotel', [posts, asks]);
setup(); textAnswer = 'The Royal'; askAnswers = [true, true];
worker = function (b) { return b.confirm_same_name ? { ok: true, from: 'The Lunatic Hotel', name: 'The Royal' } : { needs_confirm: true, same_name: [{ name: 'The Royal', slug: 'the-royal' }] }; };
out = run(R.rename(row));
check('same name: Yes sends it again with confirm_same_name', posts.length === 2 && posts[1].b.confirm_same_name === true && row.name === 'The Royal', posts);
row.name = 'The Lunatic Hotel';
setup(); textAnswer = 'X'; worker = function () { return { error: 'Your role (accounts) is not permitted to do this.' }; };
out = run(R.rename(row));
check('a refusal is told plainly and the name is unchanged', out === null && /did not save: Your role/.test(tells[0]) && row.name === 'The Lunatic Hotel', tells);

var hq = readFile('venueplay/app/hq.html');
check('hq.html loads vp-rename-hq.js and starts it with the owner test', /<script src="vp-rename-hq\.js"><\/script>/.test(hq) && /VPRename\.init\(\{ post:workerPost, ask:vpAsk, askText:vpAskText, tell:vpTell, isOwner:function\(\)\{ return S\.adminRole==="owner"; \} \}\)/.test(hq));
check("hq.html puts the button in a venue's Details and answers its tap", /window\.VPRename\.button\(v\)/.test(hq) && /closest\("button\[data-rename\]"\)[\s\S]{0,200}VPRename\.rename\(rv\)/.test(hq));

print('\n' + (fails ? fails + ' FAILED, ' : '') + (ran - fails) + ' of ' + ran + ' checks passed');
if (fails) throw new Error(fails + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
