/* A marketing login has a staff row at the venue. Can it run a game?

   The rig stands requireStaff in for every other test, because they are not about it. This one
   IS about it, so it lifts the REAL requireStaff back out of the shipped Worker and runs that
   against the fake database. The database's own twin of this check is migration 86
   (vp_host_staff), and the last block here holds the two to the same words.

   Run from the repo root:  jsc tools/test-marketing-cannot-run-games.js
*/
load('tools/rig-game-worker.js');
var finished = false;
function lift(name) { var i = SRC.indexOf('async function ' + name + '('); if (i < 0) throw new Error('no ' + name);
  var d = 0, k = SRC.indexOf('{', SRC.indexOf(')', i)); do { if (SRC[k] === '{') d++; else if (SRC[k] === '}') d--; k++; } while (d > 0); return SRC.slice(i, k); }
(0, eval)(lift('requireStaff'));          // the real one, replacing the rig's stand-in

var U = function (n) { return '40000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); };
DB.vp_venues = [{ id: VENUE, status: 'active', group_id: null, slug: 'the-pub' }];
DB.vp_venue_groups = []; DB.vp_platform_admins = [{ auth_user_id: U(9), role: 'owner' }];
DB.vp_venue_staff = [
  { id: 's-owner', auth_user_id: U(1), venue_id: VENUE, role: 'owner', permissions: null },
  { id: 's-manager', auth_user_id: U(2), venue_id: VENUE, role: 'manager', permissions: null },
  { id: 's-host', auth_user_id: U(3), venue_id: VENUE, role: 'host', permissions: null },
  { id: 's-mkt', auth_user_id: U(4), venue_id: VENUE, role: 'marketing', permissions: { players_optin: true } },
  { id: 's-odd', auth_user_id: U(5), venue_id: VENUE, role: 'intern', permissions: null }];

(async function () {
  async function may(n) { try { var r = await requireStaff(ENV, U(n), VENUE); return r.role; } catch (e) { return 'refused ' + (e.status || e); } }
  print('who may run a game at this venue');
  show('CONTROL: the owner may', (await may(1)) === 'owner', await may(1));
  show('CONTROL: a manager may', (await may(2)) === 'manager', await may(2));
  show('CONTROL: a host may', (await may(3)) === 'host', await may(3));
  show('a MARKETING login may not, though it has a staff row here', (await may(4)) === 'refused 403', await may(4));
  show('nor may a role nobody has taught this Worker about', (await may(5)) === 'refused 403', await may(5));
  show('a stranger may not', (await may(6)) === 'refused 403', await may(6));
  show('CONTROL: an HQ admin using View as still may', (await may(9)) === 'owner', await may(9));

  print('the Worker and the database say it in the same words');
  var sql = readFile('venueplay-backend/supabase/venueplay-86-marketing-role.sql');
  var live = sql.slice(sql.indexOf('create or replace function public.vp_host_staff('), sql.indexOf('-- TO UNDO PART 3 ONLY'));
  show("migration 86's staff check names owner, manager and host, and only those", /and s\.role in \('owner', 'manager', 'host'\)/.test(live), live.slice(0, 80));
  show('and the Worker asks for exactly the same three', /role=in\.\(owner,manager,host\)/.test(lift('requireStaff')));
  var orig = readFile('venueplay-backend/supabase/venueplay-73-one-trip-host-trivia.sql');
  var f73 = orig.slice(orig.indexOf('create or replace function public.vp_host_staff('), orig.indexOf('$$;', orig.indexOf('create or replace function public.vp_host_staff(')) + 3);
  var f86 = live.slice(0, live.indexOf('$$;') + 3).replace(/\n\s*-- THE ONE LINE THIS MIGRATION IS FOR[^\n]*\n[^\n]*\n\s*and s\.role in \('owner', 'manager', 'host'\)/, '');
  show('apart from that one line, the function is migration 73 word for word', f86 === f73, [f86.length, f73.length]);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('marketing cannot run games: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
