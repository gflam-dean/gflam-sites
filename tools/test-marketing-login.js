/* The marketing login: what it may see, and everything it must be refused.

   Dean, 22 Sep 2026: an optional login for whoever does a venue's marketing. Numbers, brand kit,
   signs, advertising screens; the opt-in list ONLY if the owner ticked the box; never games,
   billing or what player data is collected.

   Runs the REAL routes on tools/rig-billing-worker.js. Only the token check is stood in for (a
   token here IS the user id). The part that matters most is the long list of owner routes a
   marketing login is thrown at: in this Worker an `o` with no perms object reads as the OWNER,
   so one careless guard is full access.

   Run from the repo root:  jsc tools/test-marketing-login.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
function U(n) { return '50000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OWNER = U(1), MANAGER = U(2), HOST = U(3), OTHER_OWNER = U(8);
function as(user, body, extra) { var h = { Authorization: 'Bearer ' + user }; for (var k in (extra || {})) h[k] = extra[k];
  return { headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(JSON.stringify(body || {})); }, json: function () { return Promise.resolve(body || {}); } }; }
async function call(fn, user, body) { try { return await fn(as(user, body), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e) } }; } }

function world() {
  DB = {}; sent.length = 0; FAIL = {};
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@royalhotel.com.au', contact_name: 'Sam', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_1', optin_release_approved: true },
                           { id: 'f2', contact_email: 'x@otherpub.com.au', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_2' }];
  DB.vp_venues = [{ id: 'vA', name: 'The Royal Hotel', founding_id: 'f1', slug: 'royal', status: 'active', timezone: 'Australia/Sydney', max_players: 80, created_at: '2026-01-01T00:00:00Z' },
                  { id: 'vB', name: 'The Anchor Hotel', founding_id: 'f1', slug: 'anchor', status: 'active', timezone: 'Australia/Sydney', max_players: 50, created_at: '2026-01-02T00:00:00Z' },
                  { id: 'vZ', name: 'Somebody Else Hotel', founding_id: 'f2', slug: 'else', status: 'active', max_players: 50, created_at: '2026-01-03T00:00:00Z' }];
  DB.vp_platform_admins = [];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: 'vA', role: 'owner', permissions: null }, { id: 's2', auth_user_id: OWNER, venue_id: 'vB', role: 'owner', permissions: null },
                       { id: 's3', auth_user_id: MANAGER, venue_id: 'vA', role: 'manager', permissions: { players_optin: false, add_hosts: true } },
                       { id: 's4', auth_user_id: HOST, venue_id: 'vA', role: 'host', permissions: null },
                       { id: 's8', auth_user_id: OTHER_OWNER, venue_id: 'vZ', role: 'owner', permissions: null }];
  DB.auth = [{ id: HOST, phone: '61400000003' }];
  DB.vp_sessions = [{ id: 'sesA1', venue_id: 'vA', opened_at: '2026-09-04T09:00:00Z' }, { id: 'sesA2', venue_id: 'vA', opened_at: '2026-09-11T09:00:00Z' }, { id: 'sesA3', venue_id: 'vA', opened_at: '2026-09-18T09:00:00Z' },
                    { id: 'sesZ', venue_id: 'vZ', opened_at: '2026-09-04T09:00:00Z' }];
  DB.vp_games = [{ id: 'gT', session_id: 'sesA1', format: 'trivia' }, { id: 'gB', session_id: 'sesA2', format: 'bingo90' }, { id: 'gR', session_id: 'sesA3', format: 'raffle' }, { id: 'gZ', session_id: 'sesZ', format: 'trivia' }];
  DB.vp_players = [];
  ['sesA1', 'sesA2', 'sesA3'].forEach(function (s, i) { for (var n = 0; n < 4 + i; n++) DB.vp_players.push({ id: s + 'p' + n, session_id: s, device_id: 'dev' + n, is_test: false, email: 'secret' + n + '@example.com', first_name: 'Secret', mobile: '0400000000' }); });
  for (var z = 0; z < 50; z++) DB.vp_players.push({ id: 'zp' + z, session_id: 'sesZ', device_id: 'zdev' + z, is_test: false });
  DB.vp_trivia_answers = [{ id: 'a1', game_id: 'gT', question_id: 'q1' }, { id: 'a2', game_id: 'gT', question_id: 'q1' }, { id: 'a3', game_id: 'gT', question_id: 'q2' }, { id: 'az', game_id: 'gZ', question_id: 'q9' }];
  DB.vp_raffle_results = [{ id: 'r1', game_id: 'gR' }, { id: 'r2', game_id: 'gR' }];
  DB.vp_member_draws = []; DB.vp_member_draw_results = []; DB.v_vp_prizes_given = [{ venue_id: 'vA', prizes_given_count: 3, prizes_given_value_cents: 15000, cash_given_count: 1, cash_given_value_cents: 5000 }];
  DB.v_vp_player_optins = [{ venue_id: 'vA', first_name: 'Opted', last_name: 'In', email: 'optedin@example.com', mobile: '0411111111', postcode: '2000', opted_in_at: '2026-09-04T10:00:00Z' },
                           { venue_id: 'vZ', first_name: 'Not', last_name: 'Yours', email: 'notyours@example.com', mobile: '0422222222', postcode: '3000', opted_in_at: '2026-09-04T10:00:00Z' }];
  DB.vp_admin_audit = [];
}
function mkt() { return DB.vp_venue_staff.filter(function (r) { return r.role === 'marketing'; }); }
var GOOD = { label: 'Mia from the agency', mobile: '0412 000 111', email: 'Mia@Agency.com.au', all_venues: true };

(async function () {
  print('adding one');
  world();
  var a = await call(vpbMarketingAdd, OWNER, GOOD);
  var MIA = a.body.auth_user_id;
  check('the owner can add a marketing login', a.status === 200 && mkt().length === 2, a);
  check('it is stored as its own role, with the email a removal request goes to', mkt().every(function (r) { return r.role === 'marketing' && r.notify_email === 'mia@agency.com.au'; }), mkt());
  check('the opt-in box is OFF unless the owner ticked it', mkt().every(function (r) { return r.permissions && r.permissions.players_optin === false; }) && a.body.may_see_optins === false, mkt());
  check('a manager cannot add one', (await call(vpbMarketingAdd, MANAGER, GOOD)).status === 403);
  check('nor can the marketing login add another', (await call(vpbMarketingAdd, MIA, GOOD)).status >= 400);
  check('no email, no login: it is where removal requests go', (await call(vpbMarketingAdd, OWNER, { label: 'X', mobile: '0412 000 222', all_venues: true })).status === 400);
  var clash = await call(vpbMarketingAdd, OWNER, { label: 'Hosty', mobile: '0400 000 003', email: 'h@x.com.au', venue_ids: ['vA'] });
  check('a mobile that already hosts here is refused, not given two logins at one venue', clash.status === 409 && mkt().length === 2, clash);
  check('they cannot be added to SOMEBODY ELSE\'S venue', (await call(vpbMarketingAdd, OWNER, { label: 'X', mobile: '0412 000 333', email: 'x@x.com.au', venue_ids: ['vZ'] })).status === 400);

  print('what it must be refused');
  check('it is not an owner or a manager to the owner guard', (await vpbRequireOwner(as(MIA), ENV)).status === 403);
  var ownerRoutes = { vpbAccountSummary: vpbAccountSummary, vpbSetPlayers: vpbSetPlayers, vpbAddVenue: vpbAddVenue, vpbCancelVenue: vpbCancelVenue, vpbAddHost: vpbAddHost,
                      vpbListHosts: vpbListHosts, vpbRemoveHost: vpbRemoveHost, vpbBillingPortal: vpbBillingPortal, vpbSetReminders: vpbSetReminders,
                      vpbMarketingList: vpbMarketingList, vpbMarketingRemove: vpbMarketingRemove, vpbListManagers: vpbListManagers };
  var let_in = [];
  for (var name in ownerRoutes) { var r = await call(ownerRoutes[name], MIA, { venue_id: 'vA', players: 500, name: 'New', label: 'x', mobile: '0412 999 999', all_venues: true, auth_user_id: HOST });
    if (!(r.status >= 400 && r.status < 500)) let_in.push(name + ':' + r.status); }
  check('every owner route refuses it: billing, players, venues, hosts, managers (' + Object.keys(ownerRoutes).length + ' routes)', let_in.length === 0, let_in);
  check('and nothing was changed by trying', DB.vp_venue_staff.filter(function (r) { return r.role === 'host'; }).length === 1 && DB.vp_venues.length === 3 && stripeCalls.length === 0, stripeCalls.length);

  print('what it can see');
  var s = await call(vpmSummary, MIA, {});
  var t = s.body.stats && s.body.stats.total, vA = s.body.stats && s.body.stats.venues.filter(function (v) { return v.venue_id === 'vA'; })[0];
  check('its own page answers, for its own two venues only', s.status === 200 && s.body.venues.length === 2 && s.body.role === 'marketing', s.body.venues);
  check('games: three, by type', t.games === 3 && t.games_by_type.trivia === 1 && t.games_by_type.bingo === 1 && t.games_by_type.raffle === 1, t.games_by_type);
  check('players through the door: 4 + 5 + 6', t.players === 15 && t.nights === 3, [t.players, t.nights]);
  check('different phones: 6, and the four seen on all three nights are regulars', vA.phones === 6 && vA.regulars === 4, [vA.phones, vA.regulars]);
  check('questions asked: 2, from 3 answers', t.questions_asked === 2 && t.answers_given === 3, [t.questions_asked, t.answers_given]);
  check('raffle draws 2, prizes 4 worth $200, opt-ins 1', t.raffle_draws === 2 && t.prizes_given === 4 && t.prizes_value_cents === 20000 && t.opt_ins === 1, t);
  check('biggest night and busiest day', vA.biggest_night && vA.biggest_night.players === 6 && vA.busiest_day === 'Friday', [vA.biggest_night, vA.busiest_day]);
  check('NOTHING from the other account: not its 50 players, not its game', t.players === 15 && JSON.stringify(s.body).indexOf('Somebody Else') === -1);
  check('and not one name, address or number of any player is in it', !/secret|optedin|0400000000|0411111111|Opted/i.test(JSON.stringify(s.body)));
  var so = await call(vpmSummary, OWNER, {});
  check('the owner can open the same page and sees the same numbers', so.status === 200 && so.body.stats.total.players === 15 && so.body.role === 'owner', so.body.role);
  check('a stranger cannot', (await call(vpmSummary, U(99), {})).status === 403);

  print('the opt-in list, and the owner\'s tick');
  var e1 = await call(vpbOptinExport, MIA, {});
  check('box not ticked: the list is refused', e1.status === 403 && !e1.body.csv, e1);
  await call(vpbMarketingAdd, OWNER, Object.assign({}, GOOD, { optin: true }));
  check('the owner ticks the box (same person, updated, not duplicated)', mkt().length === 2 && mkt().every(function (r) { return r.permissions.players_optin === true; }), mkt());
  var e2 = await call(vpbOptinExport, MIA, {});
  check('box ticked: the list downloads', e2.status === 200 && /optedin@example\.com/.test(e2.body.csv || ''), e2);
  check('only her own venues are in it', !/notyours/.test(e2.body.csv || ''));
  var row = DB.vp_admin_audit.filter(function (r) { return r.action === 'optin_exported'; }).slice(-1)[0];
  check('the download is logged, and logged as the marketing login, not as the owner', row && row.actor_label === 'marketing', row);
  mkt()[1].permissions = { players_optin: false };
  check('ticked at one venue and not the other: refused. The most restrictive wins', (await call(vpbOptinExport, MIA, {})).status === 403);
  mkt()[1].permissions = { players_optin: true };
  FAIL['vp_venue_staff:GET'] = 3;
  var down = await call(vpbOptinExport, MIA, {});
  check('if her access cannot be READ, she is refused, never waved through', down.status >= 400 && !down.body.csv, down);
  FAIL = {};

  print('who else notices she exists');
  var hosts = await call(vpbListHosts, OWNER, {});
  check('she is not listed among the hosts and managers', JSON.stringify(hosts.body).indexOf(MIA) === -1, hosts.body);
  /* Her LOGIN may carry an email of its own, as some do. Staff emails are gathered from the login,
     so without the role filter that is exactly where a cancellation notice would go. */
  DB.auth.filter(function (u) { return u.id === MIA; })[0].email = 'mia-login@agency.com.au';
  DB.auth.filter(function (u) { return u.id === HOST; })[0].email = 'host@royalhotel.com.au';
  var contacts = await vpaAccountContacts(ENV, DB.venueplay_founding[0], 'vA');
  check('CONTROL: a real staff member\'s email IS gathered', contacts.indexOf('host@royalhotel.com.au') !== -1, contacts);
  check('billing and account emails do not go to her', contacts.indexOf('mia-login@agency.com.au') === -1 && contacts.indexOf('mia@agency.com.au') === -1, contacts);
  var mv = await call(vpbMyVenues, MIA, {});
  check('the sign-in picker is told this login is marketing only', mv.body.marketing_only === true && mv.body.venues.length === 2, mv.body);
  check('and an owner is not', (await call(vpbMyVenues, OWNER, {})).body.marketing_only === false);

  print('a removal request goes to her');
  vpaRequireAdmin = async function () { return { id: 'admin', label: 'Dean', role: 'owner' }; };
  DB.vp_players.push({ id: 'pM', session_id: 'sesA1', email: 'margaret@example.com.au', first_name: 'Margaret', marketing_optin: true, marketing_optin_at: '2026-09-04T10:00:00Z' });
  DB.vp_captures = [];
  DB.vp_admin_audit.push({ id: 'x', action: 'optin_exported', target: 'account:f1', created_at: '2026-09-10T00:00:00Z' });
  sent.length = 0;
  await call(vpaHandlePlayerRemove, 'admin', { q: 'margaret@example.com.au' });
  check('the venue has a marketing login, so SHE is told, not the billing address', sent.length === 1 && sent[0].to[0] === 'mia@agency.com.au', sent.map(function (m) { return m.to[0]; }));

  print('removing her');
  check('the marketing-remove route cannot remove a HOST', (await call(vpbMarketingRemove, OWNER, { auth_user_id: HOST })).status === 200 && DB.vp_venue_staff.some(function (r) { return r.auth_user_id === HOST; }));
  await call(vpbMarketingRemove, OWNER, { auth_user_id: MIA });
  check('the owner removes her, from every venue', mkt().length === 0);
  check('and she is locked out at once', (await call(vpmSummary, MIA, {})).status === 403);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('marketing login: ' + fails + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
