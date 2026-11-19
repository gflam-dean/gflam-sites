/* AN HQ ADMIN'S LOGIN NEVER GETS A CLUB MEMBER'S EMAIL OR MOBILE (Dean's open question 10, migration 208).

   A club's uploaded members list (vp_members; email and mobile since migration 200) is data the CLUB gave us. Before 208,
   policy vp_members_admin_all let any HQ admin login read every column of every club's list straight from the browser,
   and HQ's "View as" runs the venue's pages on that login. 208 drops that policy and gives HQ the count and the names
   through v_vp_members_list, which has no contact column at all.

   SCOPE (Dean, 17 Nov 2026): ONLY the members list. Players, the venueplay player profile and subscribers are
   venueplay's own and HQ keeps seeing them: section 4 checks 208 names none of those tables.

   This suite:
     1. reads the migration: the policy is dropped, the view names no contact column, only authenticated may select
        it, the TEST guard is there, and no player table is touched;
     2. RUNS the shipped loadAllMembers out of members/host.html against a fake PostgREST that applies 208's rules:
        the venue's own staff get the table (contacts included, as today), an HQ admin gets nothing from the table and
        the names from the view, a database without the view (before 208) still answers, a failed table read throws;
     3. RUNS the shipped members count out of billing.html the same way;
     4. reads RLS-BASELINE.json: the post-208 state.

   Run:  jsc tools/test-hq-no-member-contacts.js
*/
var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw) : '')); }
}
function strip(sql) { return sql.replace(/--[^\n]*/g, ''); }

var SQL = readFile('venueplay-backend/supabase/venueplay-208-hq-no-member-contacts.sql');
var HOST = readFile('venueplay/app/members/host.html');
var BILL = readFile('venueplay/app/billing.html');
var BASE = JSON.parse(readFile('venueplay-backend/supabase/RLS-BASELINE.json'));
var COLS = JSON.parse(readFile('venueplay-backend/supabase/COLUMNS-BASELINE.json'));
var CONTACT = ['email', 'mobile', 'postcode', 'marketing_optin', 'note'];

/* ---------------------------------------------------------------- 1. the migration */
print('1. migration 208');
var body = strip(SQL);
check('drops vp_members_admin_all', /drop policy if exists vp_members_admin_all on public\.vp_members\s*;/.test(body));
check('creates no other policy on vp_members', !/create policy[^;]*on public\.vp_members\b/i.test(body));
var view = /create or replace view public\.v_vp_members_list[^;]*?\bas\s+select([\s\S]*?)\bfrom public\.vp_members m([\s\S]*?);/i.exec(body);
check('creates v_vp_members_list over vp_members', !!view);
var picked = view ? view[1].split(',').map(function (c) { return c.trim().replace(/^m\./, ''); }) : [];
check('the view picks exactly the names columns',
      picked.join(',') === 'id,roster_id,member_number,first_name,last_name,status,updated_at', picked);
check('the view names no contact column anywhere in its select',
      view && CONTACT.every(function (c) { return !new RegExp('\\b' + c + '\\b').test(view[1]); }));
check('the view is filtered to the caller: own venues or an HQ admin',
      view && /r\.venue_id in \(select public\.vp_staff_venue_ids\(\)\)/.test(view[2]) && /or public\.vp_is_platform_admin\(\)/.test(view[2]));
check('security_barrier on', /v_vp_members_list with \(security_barrier = true\)/.test(body));
check('everything revoked from public, anon and authenticated first',
      /revoke all on public\.v_vp_members_list from public, anon, authenticated\s*;/.test(body));
var grants = body.match(/grant [^;]*v_vp_members_list[^;]*;/g) || [];
check('then select to authenticated and service_role only, never anon',
      grants.length === 2 && grants.every(function (g) { return /^grant select on public\.v_vp_members_list to (authenticated|service_role);$/.test(g); }), grants);
var g0 = SQL.indexOf('-- VP-STAGING-GUARD-BEGIN'), g1 = SQL.indexOf('-- VP-STAGING-GUARD-END');
check('the TEST guard block comes before any statement',
      g0 > 0 && g1 > g0 && SQL.slice(g0, g1).indexOf("project_ref = ''rkfaftxgzpsmmrzudlqy''") > 0
      && strip(SQL.slice(0, g0)).trim() === '');
check('nothing in it touches a player table, the player profile or subscribers',
      !/\b(vp_players|vp_captures|vp_known_players|vp_player_consents|vp_marketing_optins|v_vp_player_optins|vp_subscribers|pp_players)\b/.test(body));
check('no column is granted or revoked on vp_members itself (the venue keeps its own read)',
      !/(grant|revoke)[^;]*on (table )?public\.vp_members\b/i.test(body));

/* ---------------------------------------------------------------- 2. the members console */
print('');
print('2. members/host.html loadAllMembers, run against 208\'s rules');
var mHost = /function loadAllMembers\(ids\)\{[\s\S]*?\n  \}/.exec(HOST);
check('loadAllMembers is in host.html', !!mHost);

var MEMBERS = [];
for (var i = 1; i <= 5; i++) MEMBERS.push({ id: 'm' + i, roster_id: 'r1', member_number: i, first_name: 'F' + i, last_name: 'L' + i,
  status: 'valid', note: null, updated_at: '2026-11-17', email: 'p' + i + '@example.invalid', mobile: '+6149157000' + i, postcode: '4000' });

/* who: 'staff' (the venue's own login), 'admin' (an HQ admin's View as); viewMissing: a database before 208. */
function fakeClient(who, viewMissing, tableFails, log) {
  return {
    from: function (rel) {
      var cols = '*', lo = 0, hi = 1e9, head = false;
      var q = {
        select: function (c, opt) { cols = c; head = !!(opt && opt.head); return q; },
        in: function () { return q; }, order: function () { return q; },
        range: function (a, b) { lo = a; hi = b; return q; },
        then: function (fn, bad) {
          log.push(rel + ' ' + cols);
          var res;
          if (rel === 'vp_members') {
            if (tableFails) res = { error: { message: 'boom' } };
            else {
              var rows = who === 'staff' ? MEMBERS : [];             // RLS: the admin policy is gone
              res = head ? { count: rows.length, data: null } : { data: rows.slice(lo, hi + 1) };
            }
          } else if (rel === 'v_vp_members_list') {
            if (viewMissing === 'transient') res = { error: { code: '57014', message: 'canceling statement due to statement timeout' } };
            else if (viewMissing) res = { error: { code: 'PGRST205', message: 'relation does not exist' } };
            else {
              var want = cols === '*' ? null : cols.split(',');
              if (want && want.some(function (c) { return ['id', 'roster_id', 'member_number', 'first_name', 'last_name', 'status', 'updated_at'].indexOf(c) < 0; }))
                res = { error: { code: '42703', message: 'column does not exist' } };
              else {
                var names = MEMBERS.map(function (m) { return { id: m.id, roster_id: m.roster_id, member_number: m.member_number,
                  first_name: m.first_name, last_name: m.last_name, status: m.status, updated_at: m.updated_at }; });
                res = head ? { count: names.length, data: null } : { data: names.slice(lo, hi + 1) };
              }
            }
          } else res = { error: { message: 'unexpected ' + rel } };
          return Promise.resolve(res).then(fn, bad);
        }
      };
      return q;
    }
  };
}
function loadFail(what, r) { return new Error('could not load ' + what); }
function runHost(who, viewMissing, tableFails) {
  var log = [], client = fakeClient(who, viewMissing, tableFails, log), loadAllMembers;
  eval(mHost[0]);
  return loadAllMembers(['r1']).then(function (rows) { return { rows: rows, log: log }; },
                                     function (e) { return { error: e, log: log }; });
}
function hasContact(rows) {
  return rows.some(function (r) { return CONTACT.some(function (c) { return c in r && c !== 'note'; }) || 'email' in r || 'mobile' in r; });
}

var chain = Promise.resolve()
  .then(function () { return runHost('admin'); }).then(function (r) {
    check('HQ View as: every member comes back by name', r.rows && r.rows.length === 5 && r.rows[4].first_name === 'F5', r.rows && r.rows.length);
    check('HQ View as: no row carries an email, a mobile or a postcode', r.rows && !hasContact(r.rows));
    /* Since migration 226 the console reads the names view FIRST for every login (hosts read nobody from the table). */
    check('HQ View as: the names view, with named columns, and never the table',
          r.log.length >= 1 && /^v_vp_members_list id,roster_id,member_number,first_name,last_name,status,updated_at$/.test(r.log[0])
          && r.log.every(function (l) { return l.indexOf('vp_members ') !== 0; }), r.log);
  })
  .then(function () { return runHost('staff'); }).then(function (r) {
    check("the venue's own staff get every member by name from the view, no contact column (migration 226)",
          r.rows && r.rows.length === 5 && r.rows[4].first_name === 'F5' && !hasContact(r.rows), r.log);
    check("the venue's own staff never ask the table when the view answers",
          r.log.every(function (l) { return l.indexOf('vp_members ') !== 0; }), r.log);
  })
  .then(function () { return runHost('staff', true); }).then(function (r) {
    check('before 208 (no view) the venue\'s staff read the table, NAMED columns, never "*"',
          r.rows && r.rows.length === 5 && r.log[1] === 'vp_members id,roster_id,member_number,first_name,last_name,status,updated_at', r.log);
  })
  .then(function () { return runHost('admin', true); }).then(function (r) {
    check('before 208 (no view) HQ View as gets nobody, no error and nothing leaks', r.rows && r.rows.length === 0 && !r.error, r);
  })
  .then(function () { return runHost('staff', true, true); }).then(function (r) {
    check('no view and a FAILED table read still throws (never read as an empty list)', !!r.error, r);
  })
  /* Review 1 S3: a view that ERRORS (not missing) and a table that answers nobody (a host after 226, HQ) is "could not
     load", never an empty list; the venue's owner still gets the list from the table. */
  .then(function () { return runHost('admin', 'transient'); }).then(function (r) {
    check('a view ERROR then an empty table answer shows "could not load", not an empty list',
          !!r.error && /could not load/.test(String(r.error.message)) && r.log[1] === 'vp_members id,roster_id,member_number,first_name,last_name,status,updated_at', r);
  })
  .then(function () { return runHost('staff', 'transient'); }).then(function (r) {
    check('a view ERROR: the owner and managers still get the list by name from the table', r.rows && r.rows.length === 5 && !r.error
          && r.log[1] === 'vp_members id,roster_id,member_number,first_name,last_name,status,updated_at', r.log);
  });

/* ---------------------------------------------------------------- 3. the account page's count */
var mBill = /(var countIn = [\s\S]*?)\.then\(function\(rc\)\{\s*if \(stale\(\)\) return;/.exec(BILL);
chain = chain.then(function () {
  print('');
  print('3. billing.html members count, run against 208\'s rules');
  check('the count reads through countIn', !!mBill);
  if (!mBill) return;
  function count(who, viewMissing) {
    var log = [], client = fakeClient(who, viewMissing, false, log), ids = ['r1'];
    function readFailed(r) { return !r || !!r.error; }
    /* The shipped lines, run as they are (repo source, the same way the other suites run host.html). */
    var fn = new Function('client', 'ids', 'readFailed', mBill[1]);
    return fn(client, ids, readFailed).then(function (rc) { return { rc: rc, log: log }; });
  }
  return count('admin').then(function (r) {
    check('HQ View as counts every member (through the names view)', r.rc && r.rc.count === 5, r);
    check('HQ View as: the second ask is the view', r.log[1] && r.log[1].indexOf('v_vp_members_list') === 0, r.log);
    return count('staff');
  }).then(function (r) {
    check("the venue's own staff count from the table, one ask", r.rc && r.rc.count === 5 && r.log.length === 1, r.log);
    return count('admin', true);
  }).then(function (r) {
    check('before 208 (no view) HQ View as keeps the table\'s 0, no error', r.rc && r.rc.count === 0 && !r.rc.error, r.rc);
  });
});

/* ---------------------------------------------------------------- 4. the baseline */
chain = chain.then(function () {
  print('');
  print('4. RLS-BASELINE.json and COLUMNS-BASELINE.json after 208');
  check('vp_members_admin_all is not in the baseline', !BASE.policies['vp_members.vp_members_admin_all']);
  /* Migration 226 replaced the any-staff read (vp_members_host_select) with the owner's and managers' read. */
  check("the venue's own read is there (vp_members_owner_manager_select, migration 226)", !!BASE.policies['vp_members.vp_members_owner_manager_select']);
  check('v_vp_members_list is a view in the baseline', BASE.views.indexOf('v_vp_members_list') >= 0);
  var vg = BASE.grants.filter(function (g) { return g.indexOf('v_vp_members_list ') === 0; });
  check('its only grant: authenticated SELECT', vg.length === 1 && vg[0] === 'v_vp_members_list authenticated SELECT', vg);
  var vc = COLS['v_vp_members_list'] || [];
  check('its columns carry no email or mobile', vc.length === 7 && vc.indexOf('email') < 0 && vc.indexOf('mobile') < 0, vc);
  var keep = ['vp_players.vp_players_admin_select', 'vp_marketing_optins.vp_marketing_optins_admin_select'];
  check("HQ keeps its read of venueplay's own players (player policies unchanged)", keep.every(function (k) { return !!BASE.policies[k]; }));
});

chain.then(function () {
  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) throw new Error(FAIL + ' check(s) failed');
  print('ALL ' + PASS + ' CHECKS PASSED');
}).catch(function (e) { print('ERROR ' + e); FAIL++; });
