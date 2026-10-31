/* The monthly report, RUN on a fake month and every number checked against a hand count.

   Dean, 30 to 31 Oct 2026: "make sure that we're capturing those details of how many people have
   returned", "how many times the same person came in a month", a report for the venue and one for
   us. Runs the REAL billing Worker on tools/rig-billing-worker.js (a fake PostgREST that stops at
   1,000 rows a page, the way the live one does), so the code under test is the code that ships.
   Only the token check is stood in for (a token here IS the user id), and the clock is pinned.

   THE HAND COUNT, The Royal Hotel (Brisbane, UTC+10), October 2026:
     Fri 2 Oct   trivia + musical   phones d1 d2 d3 (a test player and a kicked one left out)   3
     Fri 9 Oct   trivia + raffle    d1 d2 d4 and a paper team; d10 never showed life           4
     Fri 16 Oct  bingo, broadcast only, the host's end report said 40                         40
     Sat 31 Oct  bingo at 1:30am on 1 Nov (still the 31st's night); d1 twice, d5 in two
                 sessions, d6                                                                  3
     = 4 nights, 6 games, 50 players, 6 different phones (the paper team is not a phone).
     d1 came 3 nights, d2 came 2: 2 came back (1 twice, 1 three times), most 3.
     Seen before October: d1 (12 Sep), d4 (20 Aug) -> 2 back from before, 4 new.
   September: 12 Sep trivia (d1 d9) and a musical game at 1:30am on 1 Oct, which is 30 Sep's
   night (d7 d8): 2 nights, 4 players, 4 phones, all new (d4 from August is not in September).

   Run from the repo root:  jsc tools/test-monthly-report.js
*/
load('tools/rig-billing-worker.js');
/* jsc has no WebCrypto. The unsubscribe link is an HMAC; a stand-in that is deterministic and
   different for every input is all a link needs here (the same stand-in as test-no-workersdev-links). */
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
if (typeof crypto === 'undefined') crypto = { subtle: {
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } } };
var VA = 'a0000000-0000-4000-8000-0000000000aa', VZ = 'a0000000-0000-4000-8000-0000000000ff', VP = 'a0000000-0000-4000-8000-0000000000bb',
    VT = 'a0000000-0000-4000-8000-0000000000cc', VQ = 'a0000000-0000-4000-8000-0000000000dd';
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
var REAL_NOW = Date.now;
var NOW = Date.parse('2026-11-01T22:00:00Z');          // 8am on 2 Nov in Brisbane: October is finished
Date.now = function () { return NOW; };
function U(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OWNER = U(1), MANAGER = U(2), HOST = U(3), MKT = U(4), OTHER_OWNER = U(8), ADMIN = U(9), STAFF_ADMIN = U(10);
function as(user, body, extra) { var h = { Authorization: 'Bearer ' + user }; for (var k in (extra || {})) h[k] = extra[k];
  return { headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(JSON.stringify(body || {})); }, json: function () { return Promise.resolve(body || {}); } }; }
async function call(fn, user, body, extra) { try { return await fn(as(user, body, extra), ENV, J); } catch (e) { return { status: 'THREW', body: { error: String(e) } }; } }
var READS = 0;
var RIG_FETCH = globalThis.fetch;
var NEWS_TABLE_MISSING = false;
globalThis.fetch = function (url, opts) {
  if (String(url).indexOf('/rest/v1/') !== -1) READS++;
  /* Before migration 133 the live database answers 404 for vp_monthly_news. */
  if (NEWS_TABLE_MISSING && String(url).indexOf('/rest/v1/vp_monthly_news') !== -1)
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({ code: 'PGRST205' }); }, text: function () { return Promise.resolve('relation does not exist'); } });
  return RIG_FETCH(url, opts);
};

var gid = 0;
function P(session, dev, joined, extra) {
  var row = { id: 'pl' + (++gid), session_id: session, device_id: dev, is_test: false, kicked: false, joined_at: joined, played_at: null,
              email: 'person' + gid + '@example.com', first_name: 'Private', last_name: 'Person', mobile: '04000000' + ('0' + gid).slice(-2) };
  for (var k in (extra || {})) row[k] = extra[k];
  DB.vp_players.push(row); return row;
}
function world() {
  DB = {}; sent.length = 0; FAIL = {}; gid = 0; vprForget();
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@royalhotel.com.au', contact_name: 'Sam Smith', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_1' },
                           { id: 'f2', contact_email: 'boss@anchorpub.com.au', contact_name: 'Jo', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_2' },
                           { id: 'f3', contact_email: 'big@bigclub.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f4', contact_email: 'dean@test.com.au', plan: 'monthly', status: 'card_on_file' },
                           { id: 'f5', contact_email: 'quiet@quietinn.com.au', plan: 'monthly', status: 'card_on_file' }];
  DB.vp_venues = [{ id: VA, name: 'The Royal Hotel', founding_id: 'f1', slug: 'royal', status: 'active', timezone: 'Australia/Brisbane', created_at: '2026-08-01T00:00:00Z' },
                  { id: VZ, name: 'The Anchor Pub', founding_id: 'f2', slug: 'anchor', status: 'active', timezone: 'Australia/Sydney', created_at: '2026-08-01T00:00:00Z' },
                  { id: VP, name: 'The Big Club', founding_id: 'f3', slug: 'big-club', status: 'active', timezone: 'Australia/Brisbane', created_at: '2026-08-01T00:00:00Z' },
                  { id: VT, name: 'Test Alpha', founding_id: 'f4', slug: 'test-alpha', status: 'active', timezone: 'Australia/Brisbane', created_at: '2026-08-01T00:00:00Z' },
                  { id: VQ, name: 'The Quiet Inn', founding_id: 'f5', slug: 'quiet-inn', status: 'active', timezone: 'Australia/Brisbane', created_at: '2026-08-01T00:00:00Z' }];
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, role: 'owner', label: 'Dean' }, { auth_user_id: STAFF_ADMIN, role: 'staff', label: 'Helper' }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: VA, role: 'owner', permissions: null },
                       { id: 's2', auth_user_id: MANAGER, venue_id: VA, role: 'manager', permissions: { players_optin: false } },
                       { id: 's3', auth_user_id: HOST, venue_id: VA, role: 'host', permissions: null },
                       { id: 's4', auth_user_id: MKT, venue_id: VA, role: 'marketing', permissions: { players_optin: false } },
                       { id: 's8', auth_user_id: OTHER_OWNER, venue_id: VZ, role: 'owner', permissions: null }];
  DB.vp_admin_audit = []; DB.vp_unsubscribes = [];
  DB.vp_sessions = [
    { id: 'S1', venue_id: VA, created_at: '2026-10-02T08:30:00Z', opened_at: '2026-10-02T08:30:00Z', ended_at: '2026-10-02T12:00:00Z' },
    { id: 'S2', venue_id: VA, created_at: '2026-10-09T08:30:00Z', opened_at: '2026-10-09T08:30:00Z', ended_at: '2026-10-09T12:00:00Z' },
    { id: 'S3', venue_id: VA, created_at: '2026-10-31T09:00:00Z', opened_at: '2026-10-31T09:00:00Z', ended_at: '2026-10-31T11:30:00Z' },
    { id: 'S3b', venue_id: VA, created_at: '2026-10-31T12:00:00Z', opened_at: '2026-10-31T12:00:00Z', ended_at: '2026-10-31T16:00:00Z' },
    { id: 'S4', venue_id: VA, created_at: '2026-09-30T14:00:00Z', opened_at: '2026-09-30T14:00:00Z', ended_at: '2026-09-30T16:00:00Z' },
    { id: 'S5', venue_id: VA, created_at: '2026-09-12T08:30:00Z', opened_at: '2026-09-12T08:30:00Z', ended_at: '2026-09-12T12:00:00Z' },
    { id: 'S6', venue_id: VA, created_at: '2026-08-20T08:30:00Z', opened_at: '2026-08-20T08:30:00Z', ended_at: '2026-08-20T12:00:00Z' },
    // The Anchor (Sydney, UTC+11 in October): three nights of 10 in September, one of 4 in October.
    { id: 'Z1', venue_id: VZ, created_at: '2026-09-04T08:00:00Z' }, { id: 'Z2', venue_id: VZ, created_at: '2026-09-11T08:00:00Z' },
    { id: 'Z3', venue_id: VZ, created_at: '2026-09-18T08:00:00Z' }, { id: 'Z4', venue_id: VZ, created_at: '2026-10-31T13:30:00Z' },
    { id: 'P1', venue_id: VP, created_at: '2026-10-10T08:00:00Z' },
    { id: 'T1', venue_id: VT, created_at: '2026-10-10T08:00:00Z' },
    { id: 'Q1', venue_id: VQ, created_at: '2026-09-05T08:00:00Z' }];
  DB.vp_games = [
    { id: 'g01', session_id: 'S1', format: 'trivia', started_at: '2026-10-02T09:00:00Z' },
    { id: 'g02', session_id: 'S1', format: 'musical', started_at: '2026-10-02T10:30:00Z' },
    { id: 'g03', session_id: 'S2', format: 'trivia', started_at: '2026-10-09T09:00:00Z' },
    { id: 'g04', session_id: 'S2', format: 'raffle', started_at: '2026-10-09T11:00:00Z' },
    { id: 'g05', session_id: 'S3b', format: 'bingo90', started_at: '2026-10-31T15:30:00Z' },      // 1:30am Sun 1 Nov in Brisbane
    { id: 'g06', session_id: 'S4', format: 'musical_bingo', started_at: '2026-09-30T15:30:00Z' }, // 1:30am Thu 1 Oct
    { id: 'g07', session_id: 'S5', format: 'trivia', started_at: '2026-09-12T09:00:00Z' },
    { id: 'gZ1', session_id: 'Z1', format: 'trivia', started_at: '2026-09-04T08:30:00Z' }, { id: 'gZ2', session_id: 'Z2', format: 'trivia', started_at: '2026-09-11T08:30:00Z' },
    { id: 'gZ3', session_id: 'Z3', format: 'trivia', started_at: '2026-09-18T08:30:00Z' },
    // 1:30am on 1 Nov in SYDNEY (UTC+11) is 14:30Z on the 31st: still October's last night.
    { id: 'gZ4', session_id: 'Z4', format: 'bingo90', started_at: '2026-10-31T14:30:00Z' },
    { id: 'gP1', session_id: 'P1', format: 'bingo90', started_at: '2026-10-10T09:00:00Z' },
    { id: 'gT1', session_id: 'T1', format: 'bingo90', started_at: '2026-10-10T09:00:00Z' },
    { id: 'gQ1', session_id: 'Q1', format: 'trivia', started_at: '2026-09-05T09:00:00Z' }];
  DB.vp_players = [];
  var d1a = P('S1', 'd1', '2026-10-02T08:40:00Z'), d2a = P('S1', 'd2', '2026-10-02T08:41:00Z'), d3a = P('S1', 'd3', '2026-10-02T08:42:00Z');
  var tst = P('S1', 'dT', '2026-10-02T08:43:00Z', { is_test: true }); P('S1', 'dK', '2026-10-02T08:44:00Z', { kicked: true });
  var t = '2026-10-09T08:50:00Z', pa = '2026-10-09T09:01:00Z';
  var d1b = P('S2', 'd1', t, { played_at: pa }), d2b = P('S2', 'd2', t, { played_at: pa }), d4b = P('S2', 'd4', t, { played_at: pa });
  var pap = P('S2', 'paper-ab12cd', t, { played_at: pa }); P('S2', 'd10', t);
  P('S3', 'd1', '2026-10-31T09:10:00Z'); P('S3', 'd1', '2026-10-31T09:20:00Z'); P('S3', 'd5', '2026-10-31T09:11:00Z');
  P('S3b', 'd5', '2026-10-31T12:05:00Z'); P('S3b', 'd6', '2026-10-31T12:06:00Z');
  var d7 = P('S4', 'd7', '2026-09-30T15:00:00Z'), d8 = P('S4', 'd8', '2026-09-30T15:01:00Z');
  var d1s = P('S5', 'd1', '2026-09-12T08:40:00Z'), d9 = P('S5', 'd9', '2026-09-12T08:41:00Z');
  P('S6', 'd4', '2026-08-20T08:40:00Z');
  ['Z1', 'Z2', 'Z3'].forEach(function (s, i) { for (var n = 0; n < 10; n++) P(s, 'z' + n, DB.vp_sessions.filter(function (x) { return x.id === s; })[0].created_at); });
  for (var n = 0; n < 4; n++) P('Z4', 'z' + n, '2026-10-31T13:40:00Z');
  for (var m = 0; m < 1500; m++) P('P1', 'big' + m, '2026-10-10T08:30:00Z');
  for (var q = 0; q < 7; q++) P('T1', 'tt' + q, '2026-10-10T08:30:00Z');
  for (var r = 0; r < 5; r++) P('Q1', 'q' + r, '2026-09-05T08:30:00Z');
  DB.v_vp_trivia_leaderboard = [
    { game_id: 'g01', player_id: d1a.id, display_name: 'The Quizzards', points: 30 },
    { game_id: 'g01', player_id: d2a.id, display_name: 'Pub Legends', points: 20 },
    { game_id: 'g01', player_id: d3a.id, display_name: 'Trivia Newbies', points: 10 },
    { game_id: 'g01', player_id: tst.id, display_name: 'Dean Testing', points: 99 },          // a test player: not a team, not a win
    { game_id: 'g03', player_id: d1b.id, display_name: 'the  quizzards ', points: 25 },
    { game_id: 'g03', player_id: d2b.id, display_name: 'Pub Legends', points: 25 },
    { game_id: 'g03', player_id: pap.id, display_name: 'Paper Tigers', points: 15 },
    { game_id: 'g03', player_id: d4b.id, display_name: 'Late Crew', points: 5 },
    { game_id: 'g07', player_id: d1s.id, display_name: 'September Team', points: 12 },
    { game_id: 'g07', player_id: d9.id, display_name: 'Other September', points: 8 },
    { game_id: 'gZ1', player_id: 'zz', display_name: 'Anchor Secret Team', points: 50 }];
  DB.vp_cards = [{ id: 'c1', game_id: 'g02', player_id: d1a.id }, { id: 'c2', game_id: 'g02', player_id: d2a.id },
                 { id: 'c3', game_id: 'g06', player_id: d7.id }, { id: 'c4', game_id: 'g06', player_id: d8.id }];
  DB.vp_game_reports = [{ id: 'rep1', venue_id: VA, format: 'bingo', players: 40, tickets: 80, started_at: '2026-10-16T09:00:00Z', ended_at: '2026-10-16T10:00:00Z', created_at: '2026-10-16T10:00:00Z' },
                        // inside S1's window: already S1's game, must not be counted twice
                        { id: 'rep2', venue_id: VA, format: 'bingo', players: 99, started_at: '2026-10-02T09:30:00Z', created_at: '2026-10-02T09:30:00Z' }];
  DB.vp_bingo_tickets = [];
  DB.v_vp_player_optins = [{ venue_id: VA, first_name: 'Opted', email: 'optedin1@example.com', mobile: '0411111111', opted_in_at: '2026-10-05T10:00:00Z' },
                           { venue_id: VA, first_name: 'Opted', email: 'optedin2@example.com', mobile: '0411111112', opted_in_at: '2026-10-20T10:00:00Z' },
                           { venue_id: VA, first_name: 'Opted', email: 'optedin3@example.com', mobile: '0411111113', opted_in_at: '2026-10-31T15:00:00Z' },  // 1am on 1 Nov: October's night
                           { venue_id: VA, first_name: 'Opted', email: 'optedin4@example.com', mobile: '0411111114', opted_in_at: '2026-09-10T10:00:00Z' },
                           { venue_id: VZ, first_name: 'Not', email: 'notyours@example.com', mobile: '0422222222', opted_in_at: '2026-10-05T10:00:00Z' }];
  for (var o = 0; o < 1200; o++) DB.v_vp_player_optins.push({ venue_id: VP, email: 'p' + o + '@example.com', opted_in_at: '2026-10-10T10:00:00Z' });
}

(async function () {
  world();
  print('the 2am boundary, where the venue is');
  check('1:30am on 1 Nov in Brisbane is the 31st\'s night', vprNightKey('2026-10-31T15:30:00Z', 'Australia/Brisbane') === '2026-10-31');
  check('2:30am on 1 Nov in Brisbane is the 1st\'s night', vprNightKey('2026-10-31T16:30:00Z', 'Australia/Brisbane') === '2026-11-01');
  check('1:30am on 1 Nov in Sydney (daylight saving, UTC+11) is the 31st\'s night', vprNightKey('2026-10-31T14:30:00Z', 'Australia/Sydney') === '2026-10-31');
  check('the same instant in Brisbane is still before 2am too, and in Perth it is the 31st at 10:30pm', vprNightKey('2026-10-31T14:30:00Z', 'Australia/Perth') === '2026-10-31');
  check('the month the 1st reports on is the month before, on Brisbane\'s clock (at 1am it is still the 31st\'s night)', vprLastMonth(Date.parse('2026-10-31T17:00:00Z')) === '2026-10' && vprLastMonth(Date.parse('2026-10-31T15:00:00Z')) === '2026-09');

  print('one venue\'s month, counted by hand');
  var A = DB.vp_venues[0];
  var rep = (await vprMonth(ENV, [A], '2026-10', NOW))[VA], o = rep.this_month, s = rep.last_month;
  check('4 nights: 2, 9, 16 and 31 October', o.nights === 4 && o.night_list.map(function (n) { return n.night; }).join() === '2026-10-02,2026-10-09,2026-10-16,2026-10-31', o.night_list);
  check('6 games: two trivia, a musical, a raffle, two bingo (the report inside a session is not a second game)', o.games === 6, o.games);
  check('a night of games is not a drawn night', o.night_list.every(function (n) { return n.drawn === false; }));
  check('players a night: 3, 4, 40, 3', o.night_list.map(function (n) { return n.players; }).join() === '3,4,40,3', o.night_list);
  check('a test player and a kicked player are not players', o.night_list[0].players === 3);
  check('a phone that never showed life, in a session where others did, is not a player', o.night_list[1].players === 4);
  check('one phone twice in a night, or in two sessions on one night, is one player', o.night_list[3].players === 3);
  check('the game at 1:30am on 1 Nov is on Saturday 31 October\'s night', o.night_list[3].weekday === 'Saturday' && o.night_list[3].formats.join() === 'bingo90');
  check('50 players across the month, 13 a night (50 / 4, rounded)', o.player_visits === 50 && o.avg_per_night === 13, [o.player_visits, o.avg_per_night]);
  check('6 different phones: the paper team is a player, not a phone', o.unique_phones === 6, o.unique_phones);
  check('2 came back: one twice, one three times, most nights by one phone 3',
        o.returning === 2 && o.returning_times.two === 1 && o.returning_times.three === 1 && o.returning_times.four_plus === 0 && o.most_nights_one_phone === 3, [o.returning, o.returning_times, o.most_nights_one_phone]);
  check('across weeks: d4 last seen in August and d1 in September are back from before, 4 are new', o.back_from_before === 2 && o.new_phones === 4, [o.back_from_before, o.new_phones]);
  check('per game: trivia 3 and 4 (teams on the board), musical 2 (cards), bingo 40 and 3, raffle not a played game',
        o.formats.trivia.avg_players === 4 && o.formats.musical_bingo.avg_players === 2 && o.formats.bingo90.avg_players === 22 && o.formats.raffle.avg_players === null, o.formats);
  check('nights per game: trivia 2, bingo 2, musical 1, raffle 1', o.formats.trivia.nights === 2 && o.formats.bingo90.nights === 2 && o.formats.musical_bingo.nights === 1 && o.formats.raffle.nights === 1, o.formats);
  check('average a game 10 ((3 + 2 + 4 + 40 + 3) / 5, the raffle left out)', o.avg_per_game === 10, o.avg_per_game);
  check('busiest night Friday 16 October with 40, busiest game that bingo', o.busiest_night.night === '2026-10-16' && o.busiest_night.weekday === 'Friday' && o.busiest_night.players === 40
        && o.busiest_game.format === 'bingo90' && o.busiest_game.players === 40, [o.busiest_night, o.busiest_game]);
  var tt = o.top_teams.map(function (x) { return x.name + ':' + x.wins + ':' + x.points; }).join('|');
  check('top teams: The Quizzards 2 wins (however it was typed), Pub Legends 1 (a tie is a win each), then points',
        tt === 'The Quizzards:2:55|Pub Legends:1:45|Paper Tigers:0:15|Trivia Newbies:0:10|Late Crew:0:5', tt);
  check('a test player\'s team is not a team and its 99 is not the winning score', tt.indexOf('Dean Testing') === -1);
  check('3 opt-ins in October (the one at 1am on 1 Nov is October\'s night), 1 in September', o.optins === 3 && s.optins === 1, [o.optins, s.optins]);
  check('adverts: not counted, and said so rather than guessed', o.ads === null);
  var drawnOnly = vprFigures({ id: 'x', timezone: 'Australia/Brisbane' }, { sessions: [{ id: 'R1', created_at: '2026-10-07T08:00:00Z' }],
    games: [{ id: 'gr', session_id: 'R1', format: 'raffle', started_at: '2026-10-07T09:00:00Z' }], players: [], boards: [], cards: [], reports: [], optins: [] }, '2026-10');
  check('a night of only a raffle is a night, said as drawn for the room, and in no per-game average', drawnOnly.nights === 1 && drawnOnly.night_list[0].drawn === true && drawnOnly.avg_per_game === 0, drawnOnly.night_list);
  print('the month before, from the same reads');
  check('September: 12 Sep and the musical at 1:30am on 1 Oct (30 Sep\'s night)', s.nights === 2 && s.night_list.map(function (n) { return n.night; }).join() === '2026-09-12,2026-09-30', s.night_list);
  check('September: 4 players, 4 phones, nobody back twice, all 4 new (August\'s d4 did not play in September)', s.player_visits === 4 && s.unique_phones === 4 && s.returning === 0 && s.new_phones === 4, [s.player_visits, s.unique_phones, s.returning, s.new_phones]);
  check('the comparison: nights 4 from 2 (+100%), players 50 from 4', rep.compare.nights.diff === 2 && rep.compare.nights.pct === 100 && rep.compare.player_visits.was === 4 && rep.compare.player_visits.now === 50, rep.compare.nights);
  check('a finished month is marked finished', rep.finished === true);

  print('pages past the 1,000-row ceiling');
  var big = (await vprMonth(ENV, [DB.vp_venues[2]], '2026-10', NOW))[VP].this_month;
  check('a night of 1,500 phones counts 1,500, not the first page', big.player_visits === 1500 && big.unique_phones === 1500, [big.player_visits, big.unique_phones]);
  check('1,200 opt-ins count 1,200', big.optins === 1200, big.optins);

  print('a finished month is kept, so a second look costs nothing');
  READS = 0; await vprMonth(ENV, [A], '2026-10', NOW);
  check('the second ask for the same finished month reads nothing', READS === 0, READS);
  READS = 0; await vprMonth(ENV, [A], '2026-11', NOW);
  check('a month still running is read every time', READS > 0, READS);

  print('the venue sees its own, and only its own');
  world();
  var r1 = await call(vpbMonthReport, OWNER, { venue_id: VA, month: '2026-10' });
  check('the owner gets their month', r1.status === 200 && r1.body.report.this_month.player_visits === 50, r1.body.error || r1.status);
  var j1 = JSON.stringify(r1.body);
  check('nothing of any other venue is in it: no Anchor, no Big Club, no other team', !/Anchor|Big Club|Test Alpha|Secret Team|notyours/.test(j1));
  check('and not one player name, email or mobile', !/Private|Person|example\.com|04000000|0411111|Opted/.test(j1));
  check('it lists the months they can pick, newest first, back to when they joined', r1.body.months[0] === '2026-11' && r1.body.months.indexOf('2026-08') !== -1 && r1.body.months.indexOf('2026-07') === -1, r1.body.months);
  var r2 = await call(vpbMonthReport, OWNER, { venue_id: VZ, month: '2026-10' });
  check('another account\'s venue id is refused, not answered', r2.status === 400 && !r2.body.report, r2.body);
  check('the other owner sees their own, and none of the Royal', (await call(vpbMonthReport, OTHER_OWNER, { venue_id: VZ, month: '2026-10' })).body.report.venue_name === 'The Anchor Pub');
  check('a manager sees the counts', (await call(vpbMonthReport, MANAGER, { venue_id: VA, month: '2026-10' })).status === 200);
  var mk = await call(vpbMonthReport, MKT, { venue_id: VA, month: '2026-10' });
  check('a marketing login sees the counts, the same numbers', mk.status === 200 && mk.body.report.this_month.player_visits === 50, mk.body);
  check('a host is refused', (await call(vpbMonthReport, HOST, { venue_id: VA, month: '2026-10' })).status === 403);
  check('a stranger is refused', (await call(vpbMonthReport, U(77), { venue_id: VA, month: '2026-10' })).status === 403);
  var va = await call(vpbMonthReport, ADMIN, { venue_id: VZ, month: '2026-10' }, { 'X-VP-Venue': VZ });
  check('HQ through View as gets the venue it is viewing', va.status === 200 && va.body.report.venue_id === VZ, va.body);
  check('and View as one venue cannot ask for another', (await call(vpbMonthReport, ADMIN, { venue_id: VA, month: '2026-10' }, { 'X-VP-Venue': VZ })).status === 400);
  check('a month that has not started is refused', (await call(vpbMonthReport, OWNER, { venue_id: VA, month: '2026-12' })).status === 400);
  check('nonsense for a month is refused', (await call(vpbMonthReport, OWNER, { venue_id: VA, month: '2026-13' })).status === 400);
  FAIL['vp_players:GET'] = 2;
  var down = await call(vpbMonthReport, OWNER, { venue_id: VA, month: '2026-09' });
  check('a failed page is an error to try again, never a short report', down.status === 503 && !down.body.report, down.body);
  FAIL = {};

  print('HQ: every venue, the totals and who is trending down');
  world();
  check('a venue login cannot open it', (await call(vpaHandleMonthReport, OWNER, { month: '2026-10' })).status === 403);
  var hq = await call(vpaHandleMonthReport, ADMIN, { month: '2026-10' });
  var hb = hq.body || {};
  check('HQ answers', hq.status === 200 && hb.ok, hb.error);
  var byId = {}; (hb.venues || []).forEach(function (v) { byId[v.venue_id] = v; });
  check('a row for every venue that ran something, test venues marked', byId[VA] && byId[VZ] && byId[VP] && byId[VT] && byId[VT].test === true && byId[VA].test === false, Object.keys(byId));
  check('totals leave the test venue out: 50 + 4 + 1,500 players, 4 + 1 + 1 nights', hb.totals.player_visits === 1554 && hb.totals.nights === 6 && hb.totals.venues_with_nights === 3, hb.totals);
  check('the per-venue row agrees with the venue\'s own report', byId[VA].player_visits === 50 && byId[VA].returning === 2 && byId[VA].new_phones === 4 && byId[VA].top_team === 'The Quizzards', byId[VA]);
  var churn = (hb.churn || []).map(function (c) { return c.venue_id + ':' + c.level; }).join();
  check('the Quiet Inn stopped (a night in September, none in October) and the Anchor is down (30 to 4)', churn === VQ + ':stopped,' + VZ + ':down', hb.churn);
  check('the Sydney venue\'s 1:30am bingo is on its October night', byId[VZ].nights === 1 && byId[VZ].player_visits === 4, byId[VZ]);
  check('it says adverts are not counted', hb.ads === null && /not counted/.test(hb.ads_note || ''));
  DB.vp_admin_audit.push({ id: 'a1', action: 'venue_marked_test', target: 'venue:' + VP, created_at: '2026-10-01T00:00:00Z' });
  vprForget();
  var hq2 = (await call(vpaHandleMonthReport, ADMIN, { month: '2026-10' })).body;
  check('a venue marked test in HQ comes out of the totals too', hq2.totals.player_visits === 54, hq2.totals.player_visits);

  print('the email');
  world();
  var repA = (await vprMonth(ENV, [DB.vp_venues[0]], '2026-10', NOW))[VA];
  var mail = await vprEmailHtml(ENV, DB.vp_venues[0], repA, { to: 'owner@royalhotel.com.au', contactName: 'Sam Smith' });
  var h = mail.html;
  check('subject: Your October at The Royal Hotel', mail.subject === 'Your October at The Royal Hotel', mail.subject);
  check('first name only in the greeting', /Good (morning|afternoon|evening), Sam\./.test(h) && h.indexOf('Smith') === -1);
  check('the four numbers are the counted ones: 4 nights, 50 players, 6 phones, 2 came back',
        />4<\/div>[\s\S]{0,120}nights with a game on/.test(h) && />50<\/div>/.test(h) && />6<\/div>[\s\S]{0,80}different phones/.test(h) && />2<\/div>[\s\S]{0,80}came back/.test(h));
  check('how many times: 1 came twice, 1 came three times', /1 came twice, 1 came three times/.test(h));
  check('the busiest night in words', /Friday 16 October<\/b>, with <b>40 players/.test(h));
  check('top team, by name, which the TV already showed', /1\. The Quizzards/.test(h));
  check('opt-ins as a count', /3 players<\/b> said yes to hearing from you/.test(h));
  check('compared with September', /Compared with September/.test(h) && /50 <span[^>]*>\(4\)/.test(h));
  check('no player\'s name, email or mobile anywhere in it', !/Private|Person|example\.com|04000000|0411111|Opted/.test(h));
  check('no em dash', h.indexOf('\u2014') === -1 && mail.subject.indexOf('\u2014') === -1);
  check('VenuePlay, ABN, and never Gflam', /VenuePlay, ABN 35 679 383 049/.test(h) && !/gflam/i.test(h));
  var links = (h.match(/href="[^"]+"/g) || []).map(function (x) { return x.slice(6, -1); });
  check('every link is our own domain, none .dev', links.length >= 3 && links.every(function (l) { return /^(https:\/\/(www\.)?venueplay\.com\.au\/|https:\/\/api\.venueplay\.com\.au\/|tel:)/.test(l); }) && !/\.dev\b|workers\.dev/.test(h), links);
  check('the button opens that month for that venue in their account', h.indexOf('https://www.venueplay.com.au/app/report.html?venue=' + VA + '&amp;month=2026-10') !== -1);
  check('it has an unsubscribe link', /unsubscribe\?e=owner%40royalhotel\.com\.au/.test(h));
  var quiet = await vprEmailHtml(ENV, DB.vp_venues[4], (await vprMonth(ENV, [DB.vp_venues[4]], '2026-10', NOW))[VQ], { to: 'quiet@quietinn.com.au' });
  check('a venue with no October nights is told plainly, with last month\'s numbers', /No games ran in October\. In September you ran 1 night with 5 players/.test(quiet.html), quiet.html.slice(0, 200));

  print('the sender: off until Dean switches it on');
  world();
  READS = 0;
  var off = await vprMonthlySweep(ENV, Date.parse('2026-10-31T17:00:00Z'));
  check('with no switch it sends nothing and reads nothing', off.off === true && sent.length === 0 && READS === 0, [off, READS]);
  var ENVON = Object.assign({}, ENV, { MONTHLY_REPORTS: 'on', VP_UNSUB_SECRET: 'u' });
  check('anything but exactly "on" is off', (await vprMonthlySweep(Object.assign({}, ENV, { MONTHLY_REPORTS: 'yes' }), Date.parse('2026-10-31T17:00:00Z'))).off === true && sent.length === 0);
  check('switched on, mid month: nothing', (await vprMonthlySweep(ENVON, Date.parse('2026-11-12T17:00:00Z'))).waiting === true && sent.length === 0);
  check('switched on, the 1st at 8pm: nothing (a game night)', (await vprMonthlySweep(ENVON, Date.parse('2026-11-01T10:00:00Z'))).waiting === true && sent.length === 0);
  DB.vp_unsubscribes.push({ email: 'boss@anchorpub.com.au' });
  var run1 = await vprMonthlySweep(ENVON, Date.parse('2026-10-31T17:00:00Z'));    // 3am on 1 Nov in Brisbane
  var tos = sent.map(function (m) { return m.to[0]; }).sort().join();
  check('3am on the 1st: the Royal, the Big Club and the Quiet Inn get October', run1.month === '2026-10' && tos === 'big@bigclub.com.au,owner@royalhotel.com.au,quiet@quietinn.com.au', [run1, tos]);
  var why = {}; DB.vp_admin_audit.filter(function (a) { return a.action === 'monthly_report_skipped'; }).forEach(function (a) { why[a.target] = a.detail.why; });
  check('the test venue and the unsubscribed contact are skipped, and the reason is recorded', why['month-report:' + VT + ':2026-10'] === 'test venue' && why['month-report:' + VZ + ':2026-10'] === 'unsubscribed', why);
  var royal = sent.filter(function (m) { return m.to[0] === 'owner@royalhotel.com.au'; })[0];
  check('the email sent is the counted one, with the one-click unsubscribe headers', royal && royal.subject === 'Your October at The Royal Hotel' && />50<\/div>/.test(royal.html)
        && royal.headers && /api\.venueplay\.com\.au\/unsubscribe/.test(royal.headers['List-Unsubscribe'] || '') && royal.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', royal && royal.headers);
  check('each send is recorded', DB.vp_admin_audit.filter(function (a) { return a.action === 'monthly_report_sent'; }).length === 3);
  var run2 = await vprMonthlySweep(ENVON, Date.parse('2026-10-31T18:00:00Z'));
  check('the next tick sends nobody twice', sent.length === 3 && run2.sent === 0, run2);
  world();
  var ENV1 = Object.assign({}, ENVON, { MONTHLY_REPORTS_BATCH: '1' });
  await vprMonthlySweep(ENV1, Date.parse('2026-10-31T17:00:00Z'));
  var afterOne = sent.length + DB.vp_admin_audit.filter(function (a) { return a.action === 'monthly_report_skipped'; }).length;
  check('a batch of one does one venue a tick', afterOne === 1, afterOne);


  print('what\'s new at VenuePlay: written once in HQ, in every venue\'s one email');
  world();
  var GOOD = [{ title: 'Custom bingo patterns', text: 'Draw your own pattern for the last game.', link: 'https://venueplay.com.au/help' },
              { title: 'Melbourne Cup is on 3 November', text: 'Run a sweep with a raffle.' }];
  check('good news is kept as typed', !vprNewsClean(GOOD).error && vprNewsClean(GOOD).items.length === 2);
  check('a long dash is refused', /dashes/.test(vprNewsClean([{ title: 'New \u2014 bingo' }]).error || ''));
  check('Gflam is refused', /Gflam/.test(vprNewsClean([{ title: 'From the Gflam team' }]).error || ''));
  check('a .dev address is refused', /\.dev/.test(vprNewsClean([{ title: 'Try it', text: 'at venueplay.pages.dev' }]).error || ''));
  check('a link to anywhere but venueplay.com.au is refused', /venueplay\.com\.au/.test(vprNewsClean([{ title: 'x', link: 'https://example.com' }]).error || ''));
  check('five items is too many for one email', /Four/.test(vprNewsClean([1, 2, 3, 4, 5].map(function (i) { return { title: 'Item ' + i }; })).error || ''));
  check('an item with no heading is refused', /heading/.test(vprNewsClean([{ text: 'words' }]).error || ''));
  check('a venue login cannot write the news', (await call(vpaHandleMonthNews, OWNER, { action: 'save', month: '2026-10', items: GOOD, ready: true })).status === 403);
  check('an HQ staff login can read it but not change it', (await call(vpaHandleMonthNews, STAFF_ADMIN, { action: 'save', month: '2026-10', items: GOOD, ready: true })).status === 403
        && (await call(vpaHandleMonthNews, STAFF_ADMIN, { action: 'get', month: '2026-10' })).status === 200);
  var sv = await call(vpaHandleMonthNews, ADMIN, { action: 'save', month: '2026-10', items: GOOD, ready: false });
  check('HQ saves it for the October email, not ready yet', sv.status === 200 && DB.vp_monthly_news.length === 1 && DB.vp_monthly_news[0].ready === false, sv.body);
  var sv2 = await call(vpaHandleMonthNews, ADMIN, { action: 'save', month: '2026-10', items: GOOD.concat([{ title: '<script>x</script>Tips' }]), ready: true });
  check('saving again changes the one row, now ready', sv2.status === 200 && DB.vp_monthly_news.length === 1 && DB.vp_monthly_news[0].ready === true && DB.vp_monthly_news[0].items.length === 3, DB.vp_monthly_news);
  check('reading it back gives what was saved', (await call(vpaHandleMonthNews, ADMIN, { action: 'get', month: '2026-10' })).body.items.length === 3);
  var pv = await call(vpaHandleMonthNews, ADMIN, { action: 'preview', month: '2026-10', items: GOOD });
  check('the preview is the real email for Test Alpha, with the words as typed', pv.status === 200 && pv.body.venue_name === 'Test Alpha' && /What's new at VenuePlay/.test(pv.body.html) && /Custom bingo patterns/.test(pv.body.html), pv.body.error);
  var ENVON2 = Object.assign({}, ENV, { MONTHLY_REPORTS: 'on', VP_UNSUB_SECRET: 'u' });
  await vprMonthlySweep(ENVON2, Date.parse('2026-10-31T17:00:00Z'));
  var rm = sent.filter(function (m) { return m.to[0] === 'owner@royalhotel.com.au'; })[0];
  check('one email: the report first, then the news', rm && rm.html.indexOf('Compared with September') !== -1 && rm.html.indexOf('What\'s new at VenuePlay') > rm.html.indexOf('Compared with September'), rm && rm.subject);
  check('the same news in every venue\'s email (four venues: the test venue is left out)', sent.every(function (m) { return m.html.indexOf('Melbourne Cup is on 3 November') !== -1; }) && sent.length === 4);
  check('what HQ typed is escaped, never run', rm.html.indexOf('<script>') === -1 && rm.html.indexOf('&lt;script&gt;') !== -1);
  check('it says it is the one email a month, and the report is always in the account', /the one email we send you each month/.test(rm.html) && /always in your account/.test(rm.html));
  check('the send records that news went with it', DB.vp_admin_audit.filter(function (a) { return a.action === 'monthly_report_sent' && a.detail.news === 3; }).length === 4);
  world();
  DB.vp_monthly_news = [{ month: '2026-10', items: GOOD, ready: false }];
  await vprMonthlySweep(ENVON2, Date.parse('2026-10-31T17:00:00Z'));
  check('news not marked ready stays out; the report still goes', sent.length === 4 && sent.every(function (m) { return m.html.indexOf('What\'s new') === -1 && /Here is how October went/.test(m.html); }));
  world();
  NEWS_TABLE_MISSING = true;
  var miss = await call(vpaHandleMonthNews, ADMIN, { action: 'save', month: '2026-10', items: GOOD, ready: true });
  check('before migration 133, Save says why and keeps nothing', miss.status === 409 && /migration 133/.test(miss.body.error), miss.body);
  check('and Get says so too', (await call(vpaHandleMonthNews, ADMIN, { action: 'get', month: '2026-10' })).body.missing === true);
  await vprMonthlySweep(ENVON2, Date.parse('2026-10-31T17:00:00Z'));
  check('before migration 133 the reports still go, without news', sent.length === 4 && sent.every(function (m) { return m.html.indexOf('What\'s new') === -1; }));
  NEWS_TABLE_MISSING = false;
  Date.now = REAL_NOW;
  print(fails ? (fails + ' of ' + ran + ' checks FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL the suite threw: ' + e + '\n' + (e && e.stack)); print('1 of 1 checks FAILED'); });
