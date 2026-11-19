/* 17 TABLES NO BROWSER WRITES ARE SELECT-ONLY FOR HQ (18 Nov 2026, review R2/R3 of the platform-admins fix, migration 218).

   Each of these tables had a FOR ALL policy for any HQ admin plus write grants to authenticated, so ANY HQ login (staff
   included) could add or delete discounts, edit or forge audit rows, rewrite draw results, invoices, screens and questions
   from the browser console with its own token. No page writes any of them (the Workers use the service key; the page scan
   is tools/admin-forall-no-browser-write.test.py). Migration 218 drops each FOR ALL policy (and the four content tables'
   FOR ALL host_write), adds a SELECT-only admin policy with the SAME roles and predicate, and revokes every write right
   from public, anon and authenticated. SELECT stays. The four tables a browser DOES write today (vp_venue_staff,
   vp_venue_groups, vp_venues, vp_venue_settings) need Worker routes first and are not touched.
     1. migration 218: guard first, one block per table, the same predicate as before, no grant, the four left alone
     2. RLS-BASELINE.json: no FOR ALL policy on any of the 17, the SELECT policy with the old roles and predicate, the
        host reads kept, anon/authenticated SELECT only; the four left-out tables still as they were

   TABLES below is copied from RLS-BASELINE.json at 77489811 (before this branch): the old FOR ALL policy's roles and
   predicate, and whether the table had a host_write / host_select policy.

   Run from the repo root:  jsc tools/test-admin-forall-lockdown.js */
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
var TABLES = {
  vp_admin_audit: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: false },
  vp_billing_usage: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: false },
  vp_discounts: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: false },
  vp_group_invoice_lines: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: false },
  vp_group_invoices: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: false },
  vp_member_draw_results: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: true },
  vp_member_draws: { roles: "public", fn: "vp_is_platform_admin()", hostWrite: false, hostSelect: true },
  vp_member_rosters: { roles: "public", fn: "vp_is_platform_admin()", hostWrite: false, hostSelect: true },
  vp_optin_exports: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: false },
  vp_playlist_songs: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: true, hostSelect: true },
  vp_playlists: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: true, hostSelect: true },
  vp_question_sets: { roles: "public", fn: "vp_is_platform_admin()", hostWrite: true, hostSelect: true },
  vp_questions: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: true, hostSelect: true },
  vp_raffle_prizes: { roles: "public", fn: "vp_is_platform_admin()", hostWrite: false, hostSelect: true },
  vp_raffle_schedules: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: true },
  vp_screen_slides: { roles: "authenticated", fn: "vp_is_admin()", hostWrite: false, hostSelect: true },
  vp_screens: { roles: "public", fn: "vp_is_platform_admin()", hostWrite: false, hostSelect: true }
};
var NAMES = Object.keys(TABLES);
var LEFT_OUT = ['vp_venue_staff', 'vp_venue_groups', 'vp_venues', 'vp_venue_settings'];
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

print('1. migration 218');
var SQL = readFile('venueplay-backend/supabase/venueplay-218-admin-forall-lockdown.sql');
var body = SQL.replace(/--[^\n]*/g, '');
var g0 = SQL.indexOf('-- VP-STAGING-GUARD-BEGIN'), g1 = SQL.indexOf('-- VP-STAGING-GUARD-END');
check('the TEST guard block comes before any statement, and names the TEST project',
      g0 > 0 && g1 > g0 && SQL.slice(g0, g1).indexOf("project_ref = ''rkfaftxgzpsmmrzudlqy''") > 0 && SQL.slice(0, g0).replace(/--[^\n]*/g, '').trim() === '');
var live = body.slice(body.indexOf('$guard$;') + 8).trim();
check('the pasted part is one transaction (begin first, commit before the schema reload)',
      /^begin;/.test(live) && /commit;\s*notify pgrst, 'reload schema';\s*$/.test(live), live.slice(0, 40) + ' ... ' + live.slice(-80));
check('says WRITTEN, NOT RUN, and the order: paste first, read back, then release',
      /WRITTEN, NOT RUN/.test(SQL) && /PASTE THIS FIRST, read it back, THEN release/.test(SQL));
check('carries a rollback-safe line (no build since 15 Oct writes these tables from a browser)', /^\s*--\s*rollback-safe:\s*\S/m.test(SQL));
NAMES.forEach(function (t) {
  var x = TABLES[t], T = esc(t);
  var pols = (body.match(new RegExp('create policy [a-z_0-9]+ on public\\.' + T + '\\b[^;]*;', 'g')) || []);
  var want = 'create policy ' + t + '_admin_select on public.' + t + '\n  for select to ' + x.roles + '\n  using (public.' + x.fn + ');';
  var dropsHost = new RegExp('drop policy if exists ' + T + '_host_write on public\\.' + T + ';').test(body);
  check(t + ': drops the FOR ALL admin policy' + (x.hostWrite ? ' and host_write' : '') + ', creates ONLY ' + t + '_admin_select FOR SELECT to ' + x.roles + ' using ' + x.fn + ', revokes every write right from public, anon, authenticated',
        new RegExp('drop policy if exists ' + T + '_admin_all on public\\.' + T + ';').test(body) &&
        dropsHost === x.hostWrite &&
        !new RegExp('drop policy if exists ' + T + '_host_select\\b').test(body) &&
        pols.length === 1 && pols[0] === want &&
        new RegExp('revoke insert, update, delete, truncate, references, trigger on public\\.' + T + ' from public, anon, authenticated;').test(body) &&
        !new RegExp('revoke [^;]*select[^;]* on public\\.' + T + '\\b').test(body),
        { pols: pols, dropsHost: dropsHost });
});
var touched = [];
body.replace(/\bon public\.([a-z_0-9]+)/g, function (_, t) { if (touched.indexOf(t) === -1) touched.push(t); });
check('touches the 17 tables and nothing else', touched.sort().join(',') === NAMES.slice().sort().join(','), touched);
check('names none of the four tables a browser writes today (vp_venue_staff, vp_venue_groups, vp_venues, vp_venue_settings)',
      LEFT_OUT.every(function (t) { return !new RegExp('\\b' + t + '\\b').test(body); }), LEFT_OUT.filter(function (t) { return new RegExp('\\b' + t + '\\b').test(body); }));
check('grants nothing, makes no FOR ALL / INSERT / UPDATE / DELETE policy, and creates no function',
      !/\bgrant\b/i.test(body.replace(/\$guard\$[\s\S]*?\$guard\$/, '')) && !/\bfor (all|insert|update|delete)\b/i.test(body) && !/create (or replace )?function/i.test(body));
check('vp_admin_audit gets no INSERT path: its only new policy is SELECT', /create policy vp_admin_audit_admin_select on public\.vp_admin_audit\n  for select to authenticated\n/.test(body) &&
      !/create policy [a-z_]+ on public\.vp_admin_audit\s+for insert/i.test(body));

print('');
print('2. RLS-BASELINE.json after 218');
var BASE = JSON.parse(readFile('venueplay-backend/supabase/RLS-BASELINE.json'));
NAMES.forEach(function (t) {
  var x = TABLES[t];
  var pk = Object.keys(BASE.policies).filter(function (k) { return k.indexOf(t + '.') === 0; });
  var allPol = pk.filter(function (k) { return BASE.policies[k].cmd === 'ALL'; });
  var sel = BASE.policies[t + '.' + t + '_admin_select'];
  var gr = BASE.grants.filter(function (g) { return g.indexOf(t + ' ') === 0; }).sort();
  var hs = BASE.policies[t + '.' + t + '_host_select'];
  check(t + ': no FOR ALL policy, ' + t + '_admin_select is SELECT to ' + x.roles + ' using ' + x.fn + (x.hostSelect ? ', host_select kept' : '') + ', grants anon + authenticated SELECT only',
        allPol.length === 0 && !!sel && sel.cmd === 'SELECT' && sel.permissive === 'PERMISSIVE' && sel.roles === x.roles && sel.using === x.fn && sel.with_check === '' &&
        !BASE.policies[t + '.' + t + '_admin_all'] && !BASE.policies[t + '.' + t + '_host_write'] &&
        (x.hostSelect ? (!!hs && hs.cmd === 'SELECT') : !hs) &&
        gr.join('|') === [t + ' anon SELECT', t + ' authenticated SELECT'].join('|') &&
        BASE.rls[t] && BASE.rls[t].enabled === true,
        { policies: pk, grants: gr });
});
check('vp_discounts and vp_billing_usage keep their admin_read policy too',
      ['vp_discounts', 'vp_billing_usage'].every(function (t) { var p = BASE.policies[t + '.' + t + '_admin_read']; return p && p.cmd === 'SELECT' && p.using === 'vp_is_platform_admin()'; }));
var leftOk = LEFT_OUT.map(function (t) {
  var p = BASE.policies[t + '.' + t + '_admin_all'];
  return { t: t, all: !!p && p.cmd === 'ALL', ins: BASE.grants.indexOf(t + ' authenticated INSERT') !== -1 };
});
check('the four left-out tables are unchanged: FOR ALL admin policy and the authenticated INSERT grant still there (Worker routes first)',
      leftOk.every(function (r) { return r.all && r.ins; }), leftOk);
check('vp_is_admin() and vp_is_platform_admin() stay SECURITY DEFINER (the SELECT policies need no other grant to work)',
      !!BASE.security_definer_functions['vp_is_admin()'] && !!BASE.security_definer_functions['vp_is_platform_admin()']);

print('');
if (fails) print(fails + ' FAILED');
print(ran - fails + ' of ' + ran + ' checks passed');
