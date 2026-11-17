/* THE HQ TEAM LIST: THE BROWSER READS IT, ONLY THE WORKER WRITES IT (18 Nov 2026, HQ admin routes review F1).

   Policy vp_platform_admins_admin_all (FOR ALL, any admin) let ANY HQ login write any row of vp_platform_admins from
   the browser, so a staff login could set its own role to owner and then pass every owner/accounts gate (they all read
   the role from that table). Migration 217 leaves the browser SELECT only; the Team tab's one browser write (Remove)
   now goes through POST /admin/staff-remove, owner only, audited.

   Runs the REAL billing Worker on tools/rig-billing-worker.js (only the token check is stood in for: a token IS the
   user, so an EXPIRED token cannot be modelled here; vpaVerifyJWT's own suites cover expiry). Both routes write through
   vp_hq_team_change (migration 217, review R4); the fake database below answers /rpc/vp_hq_team_change with the SAME
   rules the SQL function enforces (owner rows locked = one call at a time; caller still an owner; never your own row;
   never zero owners), and section 4 checks the SQL text carries each of those rules.
     1. /admin/staff-remove: owner removes another login (row gone, audit row); staff, accounts, a venue owner and a
        stranger get 403, no login 401, and nothing changes; an owner cannot remove themselves (so the last owner can
        never go); a login not on the list is 404; a failed read is 503 and nothing is deleted
     2. /admin/staff: an owner can never change their OWN role by re-adding their own mobile; a role change of somebody
        else is audited with the role it was; staff and accounts cannot add or change anyone (403)
     3. hq.html: Remove posts to /admin/staff-remove; no page writes vp_platform_admins from the browser
     4. migration 217 and RLS-BASELINE.json: SELECT-only policy, no write grant to anon or authenticated

   Run from the repo root:  jsc tools/test-platform-admins-no-browser-write.js */
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
function U(n) { return 'e0000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACC = U(2), STAFF = U(3), OWNER2 = U(4), VENUE_OWNER = U(5), STRANGER = U(6);
function req(user, body) { var h = user ? { Authorization: 'Bearer ' + user } : {};
  return { headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(JSON.stringify(body || {})); }, json: function () { return Promise.resolve(body || {}); } }; }
async function call(fn, user, body) { try { return await fn(req(user, body), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e) } }; } }
function world() {
  DB = {}; FAIL = {}; sent.length = 0;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACC, label: 'Sam', role: 'accounts' },
                           { auth_user_id: STAFF, label: 'Pat', role: 'staff' }, { auth_user_id: OWNER2, label: 'Olive', role: 'owner' }];
  DB.vp_venue_staff = [{ auth_user_id: VENUE_OWNER, venue_id: 'v1', role: 'owner' }];
  DB.vp_admin_audit = [];
  DB.auth = [{ id: DEAN, phone: '61400000001' }, { id: STAFF, phone: '61400000003' }, { id: OWNER2, phone: '61400000004' }];
  RPC_CALLS.length = 0; RPC_DOWN = 0;
}
/* vp_hq_team_change as the fake database runs it: the same checks, in the same order, as the SQL in migration 217.
   JavaScript runs one call to completion at a time, which is what the function's "lock every owner row" gives live. */
var RPC_CALLS = [], RPC_DOWN = 0, AUTH_DELETES = [];
function fakeTeamChange(a) {
  RPC_CALLS.push(a);
  var T = DB.vp_platform_admins;
  if (!a.p_actor || !a.p_target) return { ok: false, reason: 'bad_args' };
  if (['remove', 'set'].indexOf(a.p_action) === -1) return { ok: false, reason: 'bad_action' };
  if (a.p_action === 'set' && ['owner', 'accounts', 'staff'].indexOf(a.p_role) === -1) return { ok: false, reason: 'bad_role' };
  if (a.p_actor === a.p_target) return { ok: false, reason: 'self' };
  var owners = T.filter(function (r) { return r.role === 'owner'; }).map(function (r) { return r.auth_user_id; });
  if (owners.indexOf(a.p_actor) === -1) return { ok: false, reason: 'not_owner' };
  var row = T.filter(function (r) { return r.auth_user_id === a.p_target; })[0];
  var othersLeft = owners.filter(function (o) { return o !== a.p_target; }).length;
  if (a.p_action === 'remove') {
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.role === 'owner' && othersLeft < 1) return { ok: false, reason: 'last_owner' };
    DB.vp_platform_admins = T.filter(function (r) { return r !== row; });
    return { ok: true, was_role: row.role, label: row.label };
  }
  if (row && row.role === 'owner' && a.p_role !== 'owner' && othersLeft < 1) return { ok: false, reason: 'last_owner' };
  var was = row ? row.role : null;
  if (row) { row.role = a.p_role; row.label = a.p_label; } else T.push({ auth_user_id: a.p_target, role: a.p_role, label: a.p_label });
  return { ok: true, was_role: was, label: a.p_label };
}
var rigFetch = fetch;
fetch = function (url, opts) {
  url = String(url);
  if (url.indexOf('/rest/v1/rpc/vp_hq_team_change') !== -1) {
    if (RPC_DOWN > 0) { RPC_DOWN--; return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('blip'); } }); }
    var out = fakeTeamChange(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(out); }, text: function () { return Promise.resolve(JSON.stringify(out)); } });
  }
  var del = /\/auth\/v1\/admin\/users\/([0-9a-fA-F-]{36})/.exec(url);
  if (del && opts && opts.method === 'DELETE') { AUTH_DELETES.push(del[1]); DB.auth = DB.auth.filter(function (u) { return u.id !== del[1]; }); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } }); }
  return rigFetch(url, opts);
};
function snap() { return JSON.stringify(DB.vp_platform_admins); }
function roleOf(id) { var r = DB.vp_platform_admins.filter(function (a) { return a.auth_user_id === id; }); return r.length ? r.map(function (a) { return a.role; }).join('|') : null; }

(async function () {
  print('1. POST /admin/staff-remove');
  world();
  var r = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: STAFF });
  check('an owner removes a staff login: 200 and the row is gone', r.status === 200 && r.body.ok === true && roleOf(STAFF) === null, r);
  var au = DB.vp_admin_audit.filter(function (a) { return a.action === 'staff_removed'; });
  check('...and it is in the audit log with who did it, the name and the role it had',
        au.length === 1 && au[0].actor_admin === DEAN && au[0].target === 'admin:' + STAFF && au[0].detail.role === 'staff' && au[0].detail.label === 'Pat', au);

  world();
  var before = snap();
  var who = [['a staff HQ login', STAFF, 403], ['an accounts HQ login', ACC, 403], ["a venue's own owner login (not HQ)", VENUE_OWNER, 403],
             ['a signed-in stranger', STRANGER, 403], ['no login at all', null, 401]];
  for (var i = 0; i < who.length; i++) {
    var x = await call(vpaHandleStaffRemove, who[i][1], { auth_user_id: OWNER2 });
    check(who[i][0] + ' cannot remove anyone (' + who[i][2] + ')', x.status === who[i][2] && !x.body.ok, x);
  }
  check('...and after all of them the Team list is exactly as it was, with no audit row', snap() === before && DB.vp_admin_audit.length === 0, DB.vp_platform_admins);
  var me = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: DEAN });
  check('an owner cannot remove their own login (403), so the last owner can never be removed', me.status === 403 && roleOf(DEAN) === 'owner', me);
  var o2 = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: OWNER2 });
  check('one owner can remove another owner', o2.status === 200 && roleOf(OWNER2) === null, o2);
  var gone = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: U(99) });
  check('a login not on the Team list is a 409 with gone:true (never a 404, which HQ reads as "not deployed") and nothing is deleted',
        gone.status === 409 && gone.body.gone === true && /not on the Team list any more/.test(gone.body.error) && DB.vp_platform_admins.length === 3, gone);
  var bad = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: 'not-a-uuid' });
  check('an auth_user_id that is not a uuid is a 400', bad.status === 400, bad);
  world();
  FAIL['vp_platform_admins:GET'] = 1;
  // vpaRequireAdmin's own read uses the first failure; spend it, then fail the handler's read.
  var spent = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: STAFF });
  check('a failed role read refuses (not signed in as admin) and deletes nothing', spent.status === 403 && roleOf(STAFF) === 'staff', spent);
  RPC_DOWN = 1;
  var f = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: STAFF });
  check('the database not answering is a 503 and nothing is deleted or audited', f.status === 503 && roleOf(STAFF) === 'staff' && DB.vp_admin_audit.length === 0, f);
  world();
  var viaFn = await call(vpaHandleStaffRemove, DEAN, { auth_user_id: STAFF });
  check('the remove goes through vp_hq_team_change (one transaction), with the caller as actor',
        viaFn.status === 200 && RPC_CALLS.length === 1 && RPC_CALLS[0].p_actor === DEAN && RPC_CALLS[0].p_target === STAFF && RPC_CALLS[0].p_action === 'remove', RPC_CALLS);

  print('');
  print('1b. two owners at the same moment (review R4)');
  world();
  var both = await Promise.all([call(vpaHandleStaffRemove, DEAN, { auth_user_id: OWNER2 }), call(vpaHandleStaffRemove, OWNER2, { auth_user_id: DEAN })]);
  var owners = DB.vp_platform_admins.filter(function (a) { return a.role === 'owner'; });
  check('two owners removing each other at once: both passed the role check, one wins, the other is refused, one owner is left',
        RPC_CALLS.length === 2 && owners.length === 1 && [both[0].status, both[1].status].sort().join(',') === '200,403', [both, owners]);
  check('...and the refusal says the caller is not an Owner any more, with one staff_removed audit row only',
        /not an Owner any more/.test((both[0].status === 403 ? both[0] : both[1]).body.error) && DB.vp_admin_audit.filter(function (a) { return a.action === 'staff_removed'; }).length === 1, [both, DB.vp_admin_audit]);
  world();
  var dem = await Promise.all([call(vpaHandleStaff, DEAN, { name: 'Olive', mobile: '0400 000 004', role: 'staff' }), call(vpaHandleStaff, OWNER2, { name: 'Dean', mobile: '0400 000 001', role: 'staff' })]);
  owners = DB.vp_platform_admins.filter(function (a) { return a.role === 'owner'; });
  check('two owners demoting each other at once through /admin/staff: one owner is left, the other call is refused',
        owners.length === 1 && [dem[0].status, dem[1].status].sort().join(',') === '200,403', [dem, owners]);
  world();
  // Olive's request read her role (owner) just before Dean demoted her: her request goes on with that stale answer.
  var realReq = vpaRequireAdmin;
  DB.vp_platform_admins.forEach(function (a) { if (a.auth_user_id === OWNER2) a.role = 'staff'; });
  vpaRequireAdmin = async function () { return { actorId: OWNER2, role: 'owner', label: 'Olive', email: null }; };
  var inflight = await call(vpaHandleStaffRemove, OWNER2, { auth_user_id: DEAN });
  vpaRequireAdmin = realReq;
  check('an owner demoted while their own request is in flight: refused (403, not an Owner any more), Dean stays owner, no audit',
        inflight.status === 403 && /not an Owner any more/.test(inflight.body.error) && roleOf(DEAN) === 'owner' && DB.vp_admin_audit.length === 0, inflight);

  print('');
  print('2. POST /admin/staff never changes your own role');
  world();
  var self = await call(vpaHandleStaff, DEAN, { name: 'Dean', mobile: '0400 000 001', role: 'staff' });
  check('an owner re-adding their OWN mobile as staff is refused (403) and stays owner', self.status === 403 && roleOf(DEAN) === 'owner', self);
  check('...and nothing is audited', DB.vp_admin_audit.length === 0, DB.vp_admin_audit);
  var up = await call(vpaHandleStaff, DEAN, { name: 'Pat', mobile: '0400 000 003', role: 'accounts' });
  var ua = DB.vp_admin_audit.filter(function (a) { return a.action === 'staff_added'; });
  check("an owner changing somebody else's role is allowed and audited with the role it was",
        up.status === 200 && ua.length === 1 && ua[0].detail.was_role === 'staff' && ua[0].detail.role === 'accounts', [up, ua]);
  world();
  before = snap();
  var s1 = await call(vpaHandleStaff, STAFF, { name: 'Pat', mobile: '0400 000 003', role: 'owner' });
  var s2 = await call(vpaHandleStaff, ACC, { name: 'Sam', mobile: '0400 000 002', role: 'owner' });
  check('a staff login cannot make itself owner through /admin/staff (403)', s1.status === 403, s1);
  check('an accounts login cannot either (403)', s2.status === 403, s2);
  check('...and the Team list is unchanged', snap() === before, DB.vp_platform_admins);
  var n1 = await call(vpaHandleStaff, null, { name: 'X', mobile: '0400 000 009', role: 'owner' });
  check('no login at all is a 401', n1.status === 401, n1);
  world();
  RPC_DOWN = 1; AUTH_DELETES.length = 0;
  var nu = await call(vpaHandleStaff, DEAN, { name: 'New', mobile: '0400 000 077', role: 'staff' });
  check('a NEW mobile whose Team write fails: 503, and the sign-in login it just made is taken away again (review R7)',
        nu.status === 503 && AUTH_DELETES.length === 1 && DB.auth.filter(function (u) { return u.phone === '61400000077'; }).length === 0 && DB.vp_platform_admins.length === 4, [nu, AUTH_DELETES, DB.auth]);
  world();
  RPC_DOWN = 1; AUTH_DELETES.length = 0;
  var old1 = await call(vpaHandleStaff, DEAN, { name: 'Pat', mobile: '0400 000 003', role: 'accounts' });
  check('an EXISTING login whose Team write fails: 503 and its sign-in login is left alone', old1.status === 503 && AUTH_DELETES.length === 0 && roleOf(STAFF) === 'staff', [old1, AUTH_DELETES]);
  world();
  var add = await call(vpaHandleStaff, DEAN, { name: 'New', mobile: '0400 000 078', role: 'staff' });
  var nr = DB.vp_platform_admins.filter(function (a) { return a.label === 'New'; });
  check('a new login is added through vp_hq_team_change: one row, the role and name given, audited with was_role null',
        add.status === 200 && nr.length === 1 && nr[0].role === 'staff' && RPC_CALLS[0].p_action === 'set' && DB.vp_admin_audit[0].detail.was_role === null, [add, nr, DB.vp_admin_audit]);

  print('');
  print('3. the pages');
  var HQ = readFile('venueplay/app/hq.html'), SES = readFile('venueplay/app/vp-session.js');
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  var WRITE = /from\(\s*["']vp_platform_admins["']\s*\)\s*\.\s*(insert|update|upsert|delete)\s*\(/;
  check('hq.html writes vp_platform_admins from the browser nowhere', !WRITE.test(HQ), WRITE.exec(HQ));
  check('vp-session.js writes vp_platform_admins from the browser nowhere', !WRITE.test(SES), WRITE.exec(SES));
  var rm = /var b=e\.target\.closest\("button\[data-rmadmin\]"\)[\s\S]*?\n  \}\);/.exec(HQ);
  check('Team > Remove posts to /admin/staff-remove with the login id', !!rm && rm[0].indexOf('workerPost("/admin/staff-remove", { auth_user_id: uid })') !== -1, rm && rm[0].slice(0, 300));
  check('...and shows the Worker refusal instead of removing the row from the list', !!rm && /if\(!res \|\| res\.error\)\{ b\.disabled=false; vpTell\("Could not remove: "/.test(rm[0]));
  var gi = rm ? rm[0].indexOf('if(res && res.gone){') : -1, ei = rm ? rm[0].indexOf('if(!res || res.error)') : -1;
  check('...and an answer of gone:true (already off the list) shows that message and takes the stale row away, before the error branch',
        gi !== -1 && ei > gi && /if\(res && res\.gone\)\{ vpTell\(res\.error\|\|"[^"]+"\); S\.admins=S\.admins\.filter\(function\(a\)\{ return a\.auth_user_id!==uid; \}\); renderTeam\(\);/.test(rm[0]), rm && rm[0].slice(0, 600));
  check('the dispatcher sends POST /admin/staff-remove to the handler',
        src.indexOf("if (request.method === 'POST' && path === '/admin/staff-remove'    && typeof vpaHandleStaffRemove === 'function')    return await vpaHandleStaffRemove(request, env, json);") !== -1);

  print('');
  print('4. migration 217 and the baseline');
  var SQL = readFile('venueplay-backend/supabase/venueplay-217-platform-admins-no-browser-write.sql');
  var body = SQL.replace(/--[^\n]*/g, '');
  var g0 = SQL.indexOf('-- VP-STAGING-GUARD-BEGIN'), g1 = SQL.indexOf('-- VP-STAGING-GUARD-END');
  check('the TEST guard block comes before any statement', g0 > 0 && g1 > g0 && SQL.slice(g0, g1).indexOf("project_ref = ''rkfaftxgzpsmmrzudlqy''") > 0 && SQL.slice(0, g0).replace(/--[^\n]*/g, '').trim() === '');
  check('drops the FOR ALL policy', /drop policy if exists vp_platform_admins_admin_all on public\.vp_platform_admins;/.test(body));
  var pols = body.match(/create policy[^;]*;/g) || [];
  check('creates exactly one policy, SELECT only, for authenticated, using vp_is_admin()',
        pols.length === 1 && /^create policy vp_platform_admins_admin_select on public\.vp_platform_admins\s+for select to authenticated\s+using \(public\.vp_is_admin\(\)\);$/.test(pols[0]), pols);
  check('revokes every write right from public, anon and authenticated, and select from public and anon',
        /revoke insert, update, delete, truncate, references, trigger on public\.vp_platform_admins from public, anon, authenticated;/.test(body) &&
        /revoke select on public\.vp_platform_admins from public, anon;/.test(body));
  var grants = body.match(/\bgrant [^;]*;/g) || [];
  check('grants nothing but SELECT to authenticated, and EXECUTE on the team function to service_role only',
        grants.length === 2 && grants[0] === 'grant select on public.vp_platform_admins to authenticated;' &&
        grants[1] === 'grant execute on function public.vp_hq_team_change(uuid, uuid, text, text, text) to service_role;', grants);
  var fn = /create or replace function public\.vp_hq_team_change\(([^)]*)\)[\s\S]*?\$fn\$;/.exec(body);
  var fb = fn ? fn[0] : '';
  check('vp_hq_team_change is SECURITY DEFINER with search_path pinned, returns jsonb',
        !!fn && /\nreturns jsonb\n/.test(fb) && /\nsecurity definer\n/.test(fb) && /\nset search_path = public, pg_temp\n/.test(fb), fb.slice(0, 300));
  check('...and locks every owner row in one order before it checks anything about owners',
        /where a\.role::text = 'owner' order by a\.auth_user_id for update\) o;/.test(fb) && fb.indexOf('for update) o;') < fb.indexOf("'not_owner'"), fb.slice(0, 900));
  check('...refuses unless the actor is (still) an owner, and refuses the actor\'s own row',
        /if not \(p_actor = any\(v_owners\)\) then return jsonb_build_object\('ok', false, 'reason', 'not_owner'\); end if;/.test(fb) &&
        /if p_actor = p_target then return jsonb_build_object\('ok', false, 'reason', 'self'\); end if;/.test(fb));
  var lo = fb.match(/cardinality\(array_remove\(v_owners, p_target\)\) < 1 then\s+return jsonb_build_object\('ok', false, 'reason', 'last_owner'\);/g) || [];
  check('...refuses a remove or a demote that would leave zero owners (two last_owner checks, each before its write)',
        lo.length === 2 && fb.indexOf(lo[0]) < fb.indexOf('delete from public.vp_platform_admins') && fb.lastIndexOf("'last_owner'") < fb.indexOf('insert into public.vp_platform_admins'), lo);
  check('execute on it is revoked from public, anon and authenticated',
        /revoke all on function public\.vp_hq_team_change\(uuid, uuid, text, text, text\) from public, anon, authenticated;/.test(body));
  check('the ORDER says paste 217 FIRST, then release (review R1)', /PASTE THIS FIRST, read it back, THEN release/.test(SQL) && !/Paste this ONLY AFTER/.test(SQL));
  check('says plainly it is NOT rollback-safe, and carries no rollback-safe line',
        /NOT rollback-safe/.test(SQL) && !/^\s*--\s*rollback-safe:/mi.test(SQL) && /WRITTEN, NOT RUN/.test(SQL));
  var BASE = JSON.parse(readFile('venueplay-backend/supabase/RLS-BASELINE.json'));
  var pk = Object.keys(BASE.policies).filter(function (k) { return k.indexOf('vp_platform_admins.') === 0; });
  var p = BASE.policies['vp_platform_admins.vp_platform_admins_admin_select'];
  check('the baseline has one policy on vp_platform_admins and it is SELECT', pk.length === 1 && p && p.cmd === 'SELECT' && p.roles === 'authenticated' && p.using === 'vp_is_admin()' && p.with_check === '', pk);
  var gr = BASE.grants.filter(function (g) { return g.indexOf('vp_platform_admins ') === 0; });
  check('the baseline grants authenticated SELECT only (no write, nothing to anon)', gr.length === 1 && gr[0] === 'vp_platform_admins authenticated SELECT', gr);
  check('vp_is_admin() stays SECURITY DEFINER, so its own read of the table needs no grant', !!BASE.security_definer_functions['vp_is_admin()']);
  var bf = BASE.security_definer_functions['vp_hq_team_change(p_actor uuid, p_target uuid, p_action text, p_role text, p_label text)'];
  check('the baseline lists vp_hq_team_change as a definer function anon and authenticated cannot execute', !!bf && bf.anon === false && bf.authenticated === false, bf);
  finished = true;
})().catch(function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });
drainMicrotasks();
if (!finished) { fails++; print('  FAIL the suite did not finish'); }
print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
