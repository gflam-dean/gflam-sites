/* A MEMBERS LIST'S CONTACTS AND BIRTH MONTH ARE THE OWNER'S AND MANAGERS' ONLY (migration 226, INBOX 707 + 710, 19 Nov 2026).

   Before 226, policy vp_members_host_select let ANY login with a staff row at the venue (vp_staff_venue_ids(): owner,
   manager, host, marketing) read every column of that venue's members list straight from the API: email, mobile and
   postcode since migration 200, birth year and month with 213. A visiting trivia host could read a club's member
   contacts with its own token. 226 swaps that policy for vp_members_owner_manager_select (owner and manager only,
   through the new definer helper vp_owner_manager_venue_ids()), and hosts read number and names through 208's view
   v_vp_members_list, which the members console now reads first.

   This suite:
     1. reads migration 226: guard, one transaction, the refusals, the helper (definer, stable, pinned search_path, the
        role list), its grants, the ONE policy on vp_members and what it calls, the rollback and read-back;
     2. RUNS a row-security model built FROM THE SQL (226's role list and helper, 208's view columns and filter) for
        every kind of login: owner, manager, host, marketing, another venue's owner, HQ, anon, service role; and the
        same model with the OLD policy as a control (the host must read contacts there, or the model is blind);
     3. RUNS the shipped loadAllMembers out of members/host.html against that model as a host and as an owner;
     4. reads RLS-BASELINE.json and COLUMNS-BASELINE.json (hand-written from the SQL; the live dump wins);
     5. reads REFERENCE-vp-staff-venue-ids-READ-ONLY.sql: the staff helper written down, nothing runnable.

   Run:  jsc tools/test-members-owner-manager-only.js
*/
var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 400) : '')); }
}
function strip(sql) { return sql.replace(/--[^\n]*/g, ''); }

var SQL = readFile('venueplay-backend/supabase/venueplay-226-members-owner-manager-only.sql');
var SQL208 = readFile('venueplay-backend/supabase/venueplay-208-hq-no-member-contacts.sql');
var REF = readFile('venueplay-backend/supabase/REFERENCE-vp-staff-venue-ids-READ-ONLY.sql');
var HOST = readFile('venueplay/app/members/host.html');
var BASE = JSON.parse(readFile('venueplay-backend/supabase/RLS-BASELINE.json'));
var COLS = JSON.parse(readFile('venueplay-backend/supabase/COLUMNS-BASELINE.json'));
var NAMES = ['id', 'roster_id', 'member_number', 'first_name', 'last_name', 'status', 'updated_at'];
var PRIVATE = ['email', 'mobile', 'postcode', 'marketing_optin', 'marketing_optin_at', 'birth_year', 'birth_month', 'date_of_birth', 'note'];

/* ---------------------------------------------------------------- 1. the migration */
print('1. migration 226');
var body = strip(SQL);
var g0 = SQL.indexOf('-- VP-STAGING-GUARD-BEGIN'), g1 = SQL.indexOf('-- VP-STAGING-GUARD-END');
check('the TEST guard block comes before any statement, and names the TEST project',
      g0 > 0 && g1 > g0 && SQL.slice(g0, g1).indexOf("project_ref = ''rkfaftxgzpsmmrzudlqy''") > 0 && strip(SQL.slice(0, g0)).trim() === '');
var live = body.slice(body.indexOf('$guard$;') + 8).trim();
check('the pasted part is one transaction (begin first, commit before the schema reload)',
      /^begin;/.test(live) && /commit;\s*notify pgrst, 'reload schema';\s*$/.test(live), live.slice(-80));
var pre = /do \$pre\$([\s\S]*?)\$pre\$;/.exec(live);
check('a refusal block runs before any change', !!pre && live.indexOf(pre[0]) < live.indexOf('create or replace function'));
check('it refuses when the names view (208) is missing',
      !!pre && /to_regclass\('public\.v_vp_members_list'\) is null then\s*raise exception 'REFUSED/.test(pre[1]));
var allowed = pre && /column_name not in \(([^)]*)\)/.exec(pre[1]);
var allowedList = allowed ? allowed[1].split(',').map(function (c) { return c.trim().replace(/'/g, ''); }) : [];
check('it refuses when the view names any column but the seven names columns',
      allowedList.slice().sort().join(',') === NAMES.slice().sort().join(',') && /if extra is not null then\s*raise exception 'REFUSED/.test(pre[1]), allowedList);

var fn = /create or replace function public\.vp_owner_manager_venue_ids\(\)\s*returns setof uuid\s*language sql\s*stable\s*security definer\s*set search_path = public\s*as \$fn\$([\s\S]*?)\$fn\$;/.exec(live);
check('the helper: returns setof uuid, sql, stable, SECURITY DEFINER, search_path pinned', !!fn);
var fnBody = fn ? fn[1] : '';
var roleM = /\bs\.role in \(([^)]*)\)/.exec(fnBody);
var ROLES = roleM ? roleM[1].split(',').map(function (x) { return x.trim().replace(/'/g, ''); }) : [];
check('the helper reads vp_venue_staff for the CALLER only (auth.uid())',
      /from public\.vp_venue_staff s\b/.test(fnBody) && /s\.auth_user_id = auth\.uid\(\)/.test(fnBody) && /select s\.venue_id\b/.test(fnBody));
check('the helper names exactly owner and manager (no host, no marketing)',
      ROLES.slice().sort().join(',') === 'manager,owner', ROLES);
var fgr = live.match(/(grant|revoke)[^;]*vp_owner_manager_venue_ids[^;]*;/g) || [];
check('the helper: everything revoked first, then execute to authenticated and service_role only, never anon',
      fgr.length === 3 && /^revoke all on function public\.vp_owner_manager_venue_ids\(\) from public, anon, authenticated;$/.test(fgr[0])
      && fgr[1] === 'grant execute on function public.vp_owner_manager_venue_ids() to authenticated;'
      && fgr[2] === 'grant execute on function public.vp_owner_manager_venue_ids() to service_role;', fgr);

check('drops the any-staff read vp_members_host_select', /drop policy if exists vp_members_host_select on public\.vp_members;/.test(live));
var pols = live.match(/create policy [^;]*;/g) || [];
check('creates exactly ONE policy in the whole file', pols.length === 1, pols);
var pol = /^create policy vp_members_owner_manager_select on public\.vp_members\s+for select to authenticated\s+using \(([\s\S]*)\);$/.exec(pols[0] || '');
check('it is vp_members_owner_manager_select: FOR SELECT, to authenticated', !!pol, pols[0]);
var polUsing = pol ? pol[1] : '';
check('its rows: rosters at vp_owner_manager_venue_ids(), never vp_staff_venue_ids()',
      /roster_id in \(select r\.id from public\.vp_member_rosters r\s+where r\.venue_id in \(select public\.vp_owner_manager_venue_ids\(\)\)\)/.test(polUsing)
      && polUsing.indexOf('vp_staff_venue_ids') < 0, polUsing);
check('safe to run twice: the new policy is dropped if there before it is created',
      live.indexOf('drop policy if exists vp_members_owner_manager_select on public.vp_members;') >= 0
      && live.indexOf('drop policy if exists vp_members_owner_manager_select') < live.indexOf('create policy vp_members_owner_manager_select'));
check('no table grant or revoke anywhere (a column grant cannot tell a host from an owner: one database role)',
      !/(grant|revoke)[^;]*\bon (table )?public\.(vp_members|vp_member_rosters|v_vp_members_list)\b/i.test(live));
check('the names view and the staff helper are NOT redefined here (208 owns the view; the helper is reference only)',
      !/create (or replace )?view/i.test(live) && !/function public\.vp_staff_venue_ids/.test(live));
check('nothing in it touches a player table, the player profile or subscribers',
      !/\b(vp_players|vp_captures|vp_known_players|vp_player_consents|vp_marketing_optins|v_vp_player_optins|vp_subscribers|pp_players)\b/.test(live));
var rb = SQL.slice(SQL.indexOf('-- ROLLBACK'));
check('the rollback puts the any-staff policy back and drops the helper',
      /drop policy if exists vp_members_owner_manager_select on public\.vp_members;/.test(rb)
      && /create policy vp_members_host_select on public\.vp_members for select to authenticated/.test(rb)
      && /select public\.vp_staff_venue_ids\(\)/.test(rb) && /drop function if exists public\.vp_owner_manager_venue_ids\(\);/.test(rb));
check('the read-back asks for the live staff helper body and the role counts (read only)',
      /select pg_get_functiondef\('public\.vp_staff_venue_ids\(\)'::regprocedure\);/.test(SQL)
      && /select role, count\(\*\) from public\.vp_venue_staff group by role/.test(SQL));
check('says WRITTEN, NOT RUN, and carries a rollback-safe line', /WRITTEN, NOT RUN/.test(SQL) && /^\s*--\s*rollback-safe:\s*\S/m.test(SQL));

/* ---------------------------------------------------------------- 2. a row-security model built from the SQL */
print('');
print('2. who reads what: a row-security model built from 226 (helper + policy) and 208 (the view)');
var view = /create or replace view public\.v_vp_members_list[^;]*?\bas\s+select([\s\S]*?)\bfrom public\.vp_members m([\s\S]*?);/i.exec(strip(SQL208));
var VIEW_COLS = view ? view[1].split(',').map(function (c) { return c.trim().replace(/^m\./, ''); }) : [];
var VIEW_ADMIN = view ? /or public\.vp_is_platform_admin\(\)/.test(view[2]) : false;
var VIEW_STAFF = view ? /r\.venue_id in \(select public\.vp_staff_venue_ids\(\)\)/.test(view[2]) : false;
check('read the names view out of 208 (columns + filter)', VIEW_COLS.length === 7 && VIEW_STAFF && VIEW_ADMIN, VIEW_COLS);

var STAFF = [ // vp_venue_staff
  { auth_user_id: 'u-owner', venue_id: 'v1', role: 'owner' }, { auth_user_id: 'u-manager', venue_id: 'v1', role: 'manager' },
  { auth_user_id: 'u-host', venue_id: 'v1', role: 'host' }, { auth_user_id: 'u-mkt', venue_id: 'v1', role: 'marketing' },
  { auth_user_id: 'u-other', venue_id: 'v2', role: 'owner' }, { auth_user_id: 'u-visiting', venue_id: 'v3', role: 'host' }];
var ADMINS = ['u-hq'];
var ROSTERS = [{ id: 'r1', venue_id: 'v1' }, { id: 'r2', venue_id: 'v2' }];
var MEMBERS = [];
for (var i = 1; i <= 4; i++) MEMBERS.push({ id: 'm' + i, roster_id: i < 4 ? 'r1' : 'r2', member_number: i, first_name: 'F' + i, last_name: 'L' + i,
  status: 'valid', updated_at: '2026-11-19', note: null, email: 'm' + i + '@example.invalid', mobile: '+6149157000' + i, postcode: '4000',
  marketing_optin: true, birth_year: 1980, birth_month: 5 });

/* The helpers. vp_staff_venue_ids: any staff row (REFERENCE file; the live body is unproven). The new one: the role list
   READ FROM 226 above, so a host or marketing role added to the SQL changes what this model lets through. */
function staffVenueIds(uid) { return STAFF.filter(function (s) { return s.auth_user_id === uid; }).map(function (s) { return s.venue_id; }); }
function ownerManagerVenueIds(uid) { return STAFF.filter(function (s) { return s.auth_user_id === uid && ROLES.indexOf(s.role) >= 0; }).map(function (s) { return s.venue_id; }); }
var HELPERS = { vp_staff_venue_ids: staffVenueIds, vp_owner_manager_venue_ids: ownerManagerVenueIds };
function helperIn(text) { var m = /(vp_[a-z_]+_venue_ids)\(\)/.exec(text); return m && HELPERS[m[1]] ? HELPERS[m[1]] : function () { return []; }; }

/* who: { uid } for a signed-in login, 'anon', or 'service' (service_role bypasses row security). */
function rostersVisible(who) { // vp_member_rosters_host_select (unchanged) + admin_select
  if (who === 'service') return ROSTERS;
  if (who === 'anon') return [];
  var mine = staffVenueIds(who.uid);
  return ROSTERS.filter(function (r) { return mine.indexOf(r.venue_id) >= 0 || ADMINS.indexOf(who.uid) >= 0; });
}
function tableRead(who, policyUsing) { // PostgREST select * from vp_members as this login
  if (who === 'service') return MEMBERS.slice();
  if (who === 'anon' || !policyUsing) return [];
  var venues = helperIn(policyUsing)(who.uid);
  var rosterIds = rostersVisible(who).filter(function (r) { return venues.indexOf(r.venue_id) >= 0; }).map(function (r) { return r.id; });
  return MEMBERS.filter(function (m) { return rosterIds.indexOf(m.roster_id) >= 0; });
}
function viewRead(who) { // v_vp_members_list: owner rights (no table policy), its own filter, select to authenticated only
  if (who === 'anon') return null;   // no grant: refused
  var ok = function (m) {
    if (who === 'service') return true;
    var r = ROSTERS.filter(function (x) { return x.id === m.roster_id; })[0];
    return (VIEW_STAFF && staffVenueIds(who.uid).indexOf(r.venue_id) >= 0) || (VIEW_ADMIN && ADMINS.indexOf(who.uid) >= 0);
  };
  return MEMBERS.filter(ok).map(function (m) { var o = {}; VIEW_COLS.forEach(function (c) { o[c] = m[c]; }); return o; });
}
function privateIn(rows) { return rows.some(function (r) { return PRIVATE.some(function (c) { return c in r && c !== 'note'; }); }); }

var NEW = polUsing, OLD = 'roster_id in (select vp_member_rosters.id from public.vp_member_rosters where vp_member_rosters.venue_id in (select public.vp_staff_venue_ids()))';
var U = function (uid) { return { uid: uid }; };

/* Control first: the model must SEE the hole that 226 closes, or every "nothing" below proves nothing. */
var oldHost = tableRead(U('u-host'), OLD);
check('CONTROL, old policy: a host reads the venue\'s members WITH email, mobile and birth month (the hole)', oldHost.length === 3 && privateIn(oldHost), oldHost.length);
var oldMkt = tableRead(U('u-mkt'), OLD);
check('CONTROL, old policy: so does a marketing login', oldMkt.length === 3 && privateIn(oldMkt), oldMkt.length);

var r;
r = tableRead(U('u-host'), NEW);
check('226: a HOST reads nothing from the table (no email, mobile, postcode or birth month)', r.length === 0, r);
r = tableRead(U('u-mkt'), NEW);
check('226: a MARKETING login reads nothing from the table', r.length === 0, r);
r = tableRead(U('u-visiting'), NEW);
check('226: a host of another venue reads nothing', r.length === 0, r);
r = tableRead(U('u-owner'), NEW);
check('226: the OWNER reads the whole list, every column (contacts and birth month kept for the account page)', r.length === 3 && r[0].email === 'm1@example.invalid' && r[0].birth_year === 1980, r.length);
r = tableRead(U('u-manager'), NEW);
check('226: a MANAGER reads the whole list, every column', r.length === 3 && r[2].mobile === '+61491570003', r.length);
r = tableRead(U('u-other'), NEW);
check('226: another venue\'s owner reads only its own venue', r.length === 1 && r[0].roster_id === 'r2', r);
r = tableRead(U('u-hq'), NEW);
check('226: an HQ admin with no staff row reads nothing from the table (as after 208)', r.length === 0, r);
r = tableRead('anon', NEW);
check('226: anon reads nothing', r.length === 0, r);
r = tableRead('service', NEW);
check('226: the service role (Workers, the draw) is unaffected: every row', r.length === 4 && privateIn(r), r.length);

r = viewRead(U('u-host'));
check('the names view: a host gets every member of its venue by name (the draw console still works)', r.length === 3 && r[2].first_name === 'F3', r);
check('the names view: exactly the seven names columns, no contact or birth column',
      r.length && Object.keys(r[0]).sort().join(',') === NAMES.slice().sort().join(',') && !privateIn(r), r[0]);
r = viewRead(U('u-visiting'));
check('the names view: a host of another venue gets nobody', r.length === 0, r);
r = viewRead(U('u-hq'));
check('the names view: HQ gets names for every venue, never contacts', r.length === 4 && !privateIn(r), r.length);
check('the names view: anon is refused', viewRead('anon') === null);

/* ---------------------------------------------------------------- 3. the members console, as a host and as an owner */
var mHost = /function loadAllMembers\(ids\)\{[\s\S]*?\n  \}/.exec(HOST);
function modelClient(who, viewMissing, log) {
  return {
    from: function (rel) {
      var cols = '*', lo = 0, hi = 1e9;
      var q = {
        select: function (c) { cols = c; return q; }, in: function () { return q; }, order: function () { return q; },
        range: function (a, b) { lo = a; hi = b; return q; },
        then: function (ok, bad) {
          log.push(rel + ' ' + cols);
          var res, rows;
          if (rel === 'v_vp_members_list') {
            if (viewMissing) res = { error: { code: 'PGRST205', message: 'Could not find the table public.v_vp_members_list' } };
            else rows = viewRead(who);
          } else if (rel === 'vp_members') rows = tableRead(who, NEW);
          else res = { error: { message: 'unexpected ' + rel } };
          if (rows) {
            var want = cols === '*' ? null : cols.split(',');
            rows = rows.slice(lo, hi + 1).map(function (m) { if (!want) return m; var o = {}; want.forEach(function (c) { o[c] = m[c]; }); return o; });
            res = { data: rows, error: null };
          }
          return Promise.resolve(res).then(ok, bad);
        }
      };
      return q;
    }
  };
}
function loadFail(what, x) { return new Error('could not load ' + what); }
function runHost(who, viewMissing) {
  var log = [], client = modelClient(who, viewMissing, log), loadAllMembers;
  eval(mHost[0]);
  return loadAllMembers(['r1']).then(function (rows) { return { rows: rows, log: log }; }, function (e) { return { error: e, log: log }; });
}

var chain = Promise.resolve().then(function () {
  print('');
  print('3. members/host.html loadAllMembers, run against the 226 model');
  check('loadAllMembers is in host.html', !!mHost);
  check('the console never asks for "*" from the members list',
        !!mHost && !/select\("\*"\)/.test(mHost[0]) && !/cols\s*=\s*"\*"/.test(mHost[0]));
  return runHost(U('u-host'));
}).then(function (x) {
  check('a host gets every member by name', x.rows && x.rows.length === 3, x);
  check('a host gets no contact or birth column', x.rows && !privateIn(x.rows), x.rows && x.rows[0]);
  check('it asked the names view first, with the seven names columns',
        x.log[0] === 'v_vp_members_list ' + NAMES.join(','), x.log);
  check('and never the table while the view answered', x.log.every(function (l) { return l.indexOf('vp_members ') !== 0; }), x.log);
  return runHost(U('u-owner'));
}).then(function (x) {
  check('the owner\'s console shows the same names (the console needs no contact)', x.rows && x.rows.length === 3 && !privateIn(x.rows), x.rows && x.rows[0]);
  return runHost(U('u-host'), true);
}).then(function (x) {
  check('a database without the view (before 208): the table is asked with NAMED columns, and a host gets nobody, no error',
        x.rows && x.rows.length === 0 && !x.error && x.log[1] === 'vp_members ' + NAMES.join(','), x);
  return runHost(U('u-owner'), true);
}).then(function (x) {
  check('a database without the view: the owner still gets the list by name from the table', x.rows && x.rows.length === 3 && !privateIn(x.rows), x.log);
});

/* ---------------------------------------------------------------- 4. the baselines */
chain = chain.then(function () {
  print('');
  print('4. RLS-BASELINE.json and COLUMNS-BASELINE.json after 226 (hand-written from the SQL; the live dump wins)');
  var mp = Object.keys(BASE.policies).filter(function (k) { return k.indexOf('vp_members.') === 0; });
  check('vp_members has exactly one policy: vp_members_owner_manager_select', mp.length === 1 && mp[0] === 'vp_members.vp_members_owner_manager_select', mp);
  var p = BASE.policies['vp_members.vp_members_owner_manager_select'] || {};
  check('it is SELECT to authenticated through vp_owner_manager_venue_ids(), never vp_staff_venue_ids()',
        p.cmd === 'SELECT' && p.roles === 'authenticated' && /vp_owner_manager_venue_ids\(\)/.test(p.using || '') && (p.using || '').indexOf('vp_staff_venue_ids') < 0 && p.with_check === '', p);
  var f = BASE.security_definer_functions['vp_owner_manager_venue_ids()'];
  check('the helper is a definer function authenticated may run and anon may not', !!f && f.anon === false && f.authenticated === true, f);
  check('vp_staff_venue_ids() is still listed as a definer function (unchanged)', !!BASE.security_definer_functions['vp_staff_venue_ids()']);
  check('the rosters read is unchanged (headings only, no person data)',
        !!BASE.policies['vp_member_rosters.vp_member_rosters_host_select'] && /vp_staff_venue_ids/.test(BASE.policies['vp_member_rosters.vp_member_rosters_host_select'].using));
  var vg = BASE.grants.filter(function (g) { return g.indexOf('v_vp_members_list ') === 0; });
  check('the names view: authenticated SELECT only', vg.length === 1 && vg[0] === 'v_vp_members_list authenticated SELECT', vg);
  var vc = COLS['v_vp_members_list'] || [];
  check('the names view\'s columns carry no contact or birth column', vc.length === 7 && !vc.some(function (c) { return PRIVATE.indexOf(c) >= 0; }), vc);
});

/* ---------------------------------------------------------------- 5. the staff helper, written down */
chain = chain.then(function () {
  print('');
  print('5. REFERENCE-vp-staff-venue-ids-READ-ONLY.sql');
  var runnable = strip(REF);
  check('the expected definition is written down (commented)', /--\s+create or replace function public\.vp_staff_venue_ids\(\)/.test(REF) && /--\s+security definer/.test(REF));
  check('says it must match live and is checked with pg_get_functiondef', /MUST MATCH LIVE/.test(REF) && /select pg_get_functiondef\('public\.vp_staff_venue_ids\(\)'::regprocedure\)/.test(runnable));
  check('nothing runnable in it changes anything (selects only)',
        !/\b(create|alter|drop|grant|revoke|insert|update|delete|truncate)\b/i.test(runnable), runnable.match(/\b(create|alter|drop|grant|revoke|insert|update|delete|truncate)\b/i));
});

chain.then(function () {
  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) throw new Error(FAIL + ' check(s) failed');
  print('ALL ' + PASS + ' CHECKS PASSED');
}).catch(function (e) { print('ERROR ' + e); FAIL++; throw e; });
