/* A manager's restrictions belong to the account they were set on, and nowhere else.

   vpbRequireOwner resolved a person's permissions with a query that had NO venue filter: it read
   every staff row they hold anywhere and took the first one carrying a permissions object. A
   travelling host or duty manager working at venues on two DIFFERENT accounts got one account's
   restrictions applied to the other, in whichever order Postgres returned the rows. It could fall
   either way: losing buttons where they were trusted, or keeping access somebody had taken away.

   This lifts the real lookup out of the shipped Worker and runs it.

   Run:  jsc tools/test-manager-perms-scope.js
*/
var SRC = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

var block = /if \(!actingAsAdmin\) \{\s*try \{[\s\S]*?\n  \}/.exec(SRC);
check('the permissions lookup was found', !!block);
if (!block) { print('FAILED 1'); throw new Error('not found'); }

var asked = [];
function run(accountVenues, rowsByQuery, authUserId) {
  asked = [];
  var env = {}, actingAsAdmin = false, perms = null;
  /* The lookup goes through vpaSelectAll now, the reader that THROWS, because vpaSelect
     answers [] on a failed read and an empty answer here reads as "the owner". The stub is
     handed in under the name the shipped block actually calls. rowsByQuery === 'DOWN' makes
     the read fail, the way a 429 does. */
  var vpaSelectAll = function (e, table, q) {
    asked.push(q);
    if (rowsByQuery === 'DOWN') return Promise.reject(new Error('read vp_venue_staff: 429'));
    return Promise.resolve(rowsByQuery);
  };
  var body = 'return (async function(){ var perms = null; ' + block[0] + ' return perms; })();';
  var f = new Function('env', 'actingAsAdmin', 'accountVenues', 'authUserId', 'vpaSelectAll', 'encodeURIComponent', body);
  var out = null;
  f(env, actingAsAdmin, accountVenues, authUserId || 'u1', vpaSelectAll, encodeURIComponent)
    .then(function (p) { out = { perms: p }; });
  drainMicrotasks();
  return out && out.perms;
}
var VENUES = [{ id: 'v1' }, { id: 'v2' }];

print('a manager\'s restrictions stay on the account they were set on');

/* 1. THE FAULT. The query has to name the venues, or it reads the whole world. */
run(VENUES, []);
var q = asked[0] || '';
check('the lookup is scoped to this account\'s venues', /venue_id=in\.\(v1,v2\)/.test(q), q);
check('it still asks for this person only', /auth_user_id=eq\.u1/.test(q), q);
check('and only manager or owner rows', /role=in\.\(manager,owner\)/.test(q), q);

/* 2. No permissions anywhere on this account means full access, as it always has. */
check('no permissions rows: full access (perms stays null)',
  run(VENUES, [{ permissions: null }, {}]) === null);

/* 3. One restricted row applies. */
var one = run(VENUES, [{ permissions: { advertising: false, players_optin: true } }]);
check('a single restricted row is used', one && one.advertising === false && one.players_optin === true, one);

/* 4. THE MOST RESTRICTIVE ROW WINS, not whichever came back first. Order must not matter. */
var a = run(VENUES, [{ permissions: { players_optin: true } }, { permissions: { players_optin: false } }]);
var b = run(VENUES, [{ permissions: { players_optin: false } }, { permissions: { players_optin: true } }]);
check('refused on one venue, refused for the call (first order)', a && a.players_optin === false, a);
check('refused on one venue, refused for the call (other order)', b && b.players_optin === false, b);
check('and the answer does not depend on row order', JSON.stringify(a) === JSON.stringify(b), [a, b]);

/* 5. Keys only one row mentions still come through. */
var m = run(VENUES, [{ permissions: { advertising: false } }, { permissions: { add_hosts: false } }]);
check('keys from every row are merged', m && m.advertising === false && m.add_hosts === false, m);

/* 6. No venues on the account: ask nothing rather than ask for everything. An empty
      venue_id=in.() would be a syntax error, and worse, dropping the filter would be the
      original fault back again. */
/* A FAILED READ IS A REFUSAL. It used to be swallowed, perms stayed null, and null is the
   owner. The block now returns the 503 straight out of vpbRequireOwner. */
var down = run(VENUES, 'DOWN');
check('a failed permissions read is a 503 refusal, never null (null means owner)',
      !!down && down.status === 503 && !!down.error, down);

check('no venues: the lookup is not run at all', run([], [{ permissions: { advertising: false } }]) === null && asked.length === 0, asked);

print(fails ? ('FAILED ' + fails) : 'PASS');
if (fails) { throw new Error('perms scope: ' + fails + ' failed'); }
