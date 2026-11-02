/* TWO LIVE GAME FAULTS FROM DEAN'S JOB LIST, THE WORKER'S HALF (3 Nov 2026). The real game Worker runs
   here (tools/rig-game-worker.js: only the network and the database are fakes).

   Row 39. "Trivia: a phone left on a finished quiz answers the next session." A phone still open on the
   final screen holds the closed night's token. The next quiz on the same code is a NEW session. The
   phone (trivia/play.html) re-joins when the console says which night a message belongs to, but when it
   was not told (a console page older than those messages, a message it missed) its answer went:
     - straight to the Worker, which refused it "Player is not in this game", and the phone showed those
       words for the rest of the quiz with nothing it could do about it, or
     - to the answers room, which acknowledged it ("Answer in!") and the Worker dropped it at Reveal.
   So: the refusal now carries rejoin:true (the phone re-joins and sends the tap again), and the room's
   presence answer says whether the game is the night the phone's token came from (session_ok), so a
   stale phone re-joins before it is let into the room.

   Row 40. "Musical bingo: double tap on End game queues a second End." Every End for a game wrote a
   game.ended into the night's event log, and two at once both read 'running'. Now only the End that
   finished the game emits; the rest are answered "finished, already" and change nothing.

   Run: jsc tools/test-stale-phone-and-end-once.js   (from the repo root) */
load('tools/rig-game-worker.js');

sha256Hex = async function (s) { return 'h-' + s; };          // distinct hashes, so tokens are told apart
readJson = async function (req) { return (req && req._body) || BODY; };
var S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
var G1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', GM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
var SET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', CODE = 'ACDEFG';
function req(body, headers, url) { var h = headers || {}; return { _body: body, url: url || 'https://w/x', headers: { get: function (k) { return h[k] == null ? '' : h[k]; } } }; }
async function call(fn, body, headers, url) {
  try { return await fn(req(body, headers, url), ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function events(type) { return (DB.__events || []).filter(function (e) { return e.type === type; }); }

function world() {
  var soon = new Date(NOWMS + 20000).toISOString();
  DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: CODE, au_state: 'QLD' }],
         vp_venue_groups: [], vp_venue_settings: [],
         // last night, closed; tonight, running
         vp_sessions: [{ id: S1, venue_id: VENUE, status: 'finished', join_code: CODE, lobby_format: 'trivia' },
                       { id: S2, venue_id: VENUE, status: 'running', join_code: CODE, lobby_format: 'trivia' }],
         vp_players: [{ id: 'p-old', session_id: S1, token_hash: 'h-tok-old', display_name: 'Quiz Kids', kicked: false, device_id: 'dev-1' },
                      { id: 'p-new', session_id: S2, token_hash: 'h-tok-new', display_name: 'Quiz Kids', kicked: false, device_id: 'dev-1' },
                      { id: 'p-gone', session_id: S2, token_hash: 'h-tok-gone', display_name: 'Rowdy', kicked: true, device_id: 'dev-2' }],
         vp_games: [{ id: G1, session_id: S1, seq: 1, format: 'trivia', status: 'finished', config: {} },
                    { id: G2, session_id: S2, seq: 1, format: 'trivia', status: 'running', config: { question_seqs: [1] } },
                    { id: GM, session_id: S2, seq: 2, format: 'musical_bingo', status: 'running', config: {} }],
         vp_trivia_games: [{ game_id: G2, question_set_id: SET, current_seq: 1, phase: 'asking', question_ends_at: soon }],
         vp_questions: [{ id: 'q-1', set_id: SET, seq: 1, options: ['A', 'B', 'C', 'D'], correct_index: 2 }],
         vp_trivia_answers: [], vp_admin_audit: [], __events: [] };
}

(async function () {

print('\nROW 39, the Worker: a closed night\'s token answering tonight\'s quiz is told to re-join');
/* The one-trip path (migration 71) is what production runs: its status word wrong_game must carry the flag too.
   Asked FIRST: the rig answers 404 for any function, after which this isolate stops asking (answerRpcMissing),
   and that flag lives inside the Worker's own scope where a test cannot reset it. */
var _fetch = fetch, said = 'wrong_game';
fetch = async function (url, opts) {
  if (/\/rpc\/vp_player_answer/.test(String(url))) return resp(200, [{ status: said, session_id: S1 }]);
  return _fetch(url, opts);
};
world();
r = await call(handlePlayerAnswer, { game_id: G2, answer_index: 1, qseq: 1 }, { 'X-Player-Token': 'tok-old' });
show('e. the one-trip answer (migration 71) saying wrong_game: 403 with rejoin:true', r.status === 403 && r.body.rejoin === true, r.status + ' ' + JSON.stringify(r.body));
said = 'kicked';
r = await call(handlePlayerAnswer, { game_id: G2, answer_index: 1, qseq: 1 }, { 'X-Player-Token': 'tok-gone' });
show('f. CONTROL: the one-trip answer saying kicked: refused, no rejoin', r.status === 403 && r.body.rejoin !== true, r.status + ' ' + JSON.stringify(r.body));
said = 'time_up';
r = await call(handlePlayerAnswer, { game_id: G2, answer_index: 1, qseq: 1 }, { 'X-Player-Token': 'tok-new' });
show('g. CONTROL: time up is a 409 with no rejoin', r.status === 409 && r.body.rejoin !== true, r.status + ' ' + JSON.stringify(r.body));
fetch = _fetch;

print('  (and the same on the eight-trip path, which a venue on an older database runs)');
world();
var r = await call(handlePlayerAnswer, { game_id: G2, answer_index: 1, qseq: 1 }, { 'X-Player-Token': 'tok-old' });
show('a. last night\'s token answering tonight\'s game: 403 "Player is not in this game", with rejoin:true',
     r.status === 403 && r.body.error === 'Player is not in this game' && r.body.rejoin === true, r.status + ' ' + JSON.stringify(r.body));
show('b. and nothing is recorded for it', DB.vp_trivia_answers.length === 0, JSON.stringify(DB.vp_trivia_answers));
r = await call(handlePlayerAnswer, { game_id: G2, answer_index: 1, qseq: 1 }, { 'X-Player-Token': 'tok-new' });
show('c. CONTROL: the same phone re-joined (tonight\'s token) answers, and it is recorded', r.status === 200 && r.body.recorded === true && DB.vp_trivia_answers.length === 1 && DB.vp_trivia_answers[0].player_id === 'p-new',
     r.status + ' ' + JSON.stringify(r.body));
r = await call(handlePlayerAnswer, { game_id: G2, answer_index: 0, qseq: 1 }, { 'X-Player-Token': 'tok-gone' });
show('d. CONTROL: a removed player is refused as before, and NOT told to re-join', r.status === 403 && r.body.rejoin !== true, r.status + ' ' + JSON.stringify(r.body));


print('\nROW 39, the room road: the answers room\'s presence says whether the game is the phone\'s night');
world();
var roomAsked = 0;
ENV.ROOM = { idFromName: function (n) { return n; }, get: function () { return { fetch: async function () { roomAsked++; return new Response(JSON.stringify({ total: 3, phone: 2, answers: true }), { status: 200 }); } }; } };
LOG.length = 0;
// Through __worker.fetch, as Cloudflare calls it: the route table picks the handler, so a route still
// pointing at the room server's bare presence answer is caught here, not only a handler that changed.
async function presence(q) {
  var res = await __worker.fetch({ method: 'GET', url: 'https://game.test/room/presence?' + q, headers: { get: function () { return null; } } }, ENV);
  var b = null; try { b = JSON.parse(res._b); } catch (e) { b = res._b; }
  return { status: res.status, body: b || {} };
}
r = await presence('room=vpa-' + G2 + '&s=' + S1);
show('h. a phone naming LAST night\'s session for tonight\'s game: session_ok:false (and the room\'s own answer is kept)',
     r.status === 200 && r.body.session_ok === false && r.body.answers === true && r.body.total === 3, JSON.stringify(r.body));
r = await presence('room=vpa-' + G2 + '&s=' + S2);
show('i. CONTROL: a phone naming tonight\'s session: session_ok:true', r.body.session_ok === true && r.body.answers === true, JSON.stringify(r.body));
var reads = LOG.filter(function (l) { return /^GET vp_games/.test(l); }).length;
for (var k = 0; k < 20; k++) await presence('room=vpa-' + G2 + '&s=' + (k % 2 ? S1 : S2));
var reads2 = LOG.filter(function (l) { return /^GET vp_games/.test(l); }).length;
show('j. the game\'s night is read once and kept: twenty more phones ask and the database is not asked again', reads === 1 && reads2 === 1, reads + ' then ' + reads2);
r = await presence('room=vpa-' + G2);
show('k. CONTROL: a phone (or an older page) that names no session gets the room\'s answer exactly as before', r.body.session_ok === undefined && r.body.answers === true, JSON.stringify(r.body));
r = await presence('room=vp-' + CODE + '&s=' + S1);
show('l. CONTROL: the venue\'s own room (not an answers room) is never asked about a session', r.body.session_ok === undefined, JSON.stringify(r.body));
r = await presence('room=vpa-' + GM + '&s=' + S1);
show('m. CONTROL: a game that is not trivia says nothing either way', r.body.session_ok === undefined && r.status === 200, JSON.stringify(r.body));
var _sbGet = sbGet, G9 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9';   // a game nobody has asked about, so nothing is kept for it
sbGet = async function () { throw new Error('database down'); };
r = await presence('room=vpa-' + G9 + '&s=' + S1);
sbGet = _sbGet;
show('n. CONTROL: when the database cannot be read the room\'s answer still comes back, saying nothing about the session', r.status === 200 && r.body.answers === true && r.body.session_ok === undefined, r.status + ' ' + JSON.stringify(r.body));
delete ENV.ROOM;

print('\nROW 40: one End per game, however many times it is tapped');
world();
r = await call(handleGameEnd, { game_id: GM });
show('o. the first End finishes the game and writes one game.ended', r.status === 200 && r.body.status === 'finished' && !r.body.already && DB.vp_games[2].status === 'finished' && events('game.ended').length === 1,
     r.status + ' ' + JSON.stringify(r.body) + ' events ' + events('game.ended').length);
var endedAt = DB.vp_games[2].ended_at;
r = await call(handleGameEnd, { game_id: GM });
show('p. a second End for the same game: answered finished, already, and NO second game.ended', r.status === 200 && r.body.status === 'finished' && r.body.already === true && events('game.ended').length === 1,
     r.status + ' ' + JSON.stringify(r.body) + ' events ' + events('game.ended').length);
show('q. and the game\'s end time is the first End\'s, untouched', DB.vp_games[2].ended_at === endedAt, endedAt + ' / ' + DB.vp_games[2].ended_at);
world();
var both = await Promise.all([call(handleGameEnd, { game_id: GM }), call(handleGameEnd, { game_id: GM })]);
show('r. two Ends at the same moment (a double tap): one game.ended, and exactly one of the two says already',
     events('game.ended').length === 1 && both.filter(function (x) { return x.body.already === true; }).length === 1 && both.every(function (x) { return x.status === 200 && x.body.status === 'finished'; }),
     JSON.stringify(both.map(function (x) { return x.body; })) + ' events ' + events('game.ended').length);
/* The race itself, made certain rather than left to how the two calls interleave: the second End read
   the game as running BEFORE the first End's write landed. The database now says finished; the read it
   acts on still says running. Only the compare-and-set on status=running can tell. */
world();
DB.vp_games[2].status = 'finished';
var _f2 = fetch;
fetch = async function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (m === 'GET' && /\/rest\/v1\/vp_games\?id=eq\./.test(u) && u.indexOf(GM) >= 0) return resp(200, [Object.assign({}, DB.vp_games[2], { status: 'running' })]);
  return _f2(url, opts);
};
r = await call(handleGameEnd, { game_id: GM });
fetch = _f2;
show('r2. an End that read the game as running just before another End finished it: already, and NO game.ended',
     r.status === 200 && r.body.already === true && events('game.ended').length === 0, r.status + ' ' + JSON.stringify(r.body) + ' events ' + events('game.ended').length);
world();
var trivia = await Promise.all([call(handleGameEnd, { game_id: G2 }), call(handleGameEnd, { game_id: G2 })]);
var tgReads = LOG.filter(function (l) { return /^GET vp_trivia_games\?game_id=eq\.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2&select=current_seq/.test(l); }).length;
show('s. a trivia End tapped twice notes the night once, not twice', tgReads === 1 && events('game.ended').length === 1, 'notes ' + tgReads + ', events ' + events('game.ended').length);
world();
LOG.length = 0;
r = await call(handleGameEnd, { game_id: G1 });
show('t. CONTROL: an End for a game already finished another way is still a 200 "finished", and changes nothing',
     r.status === 200 && r.body.status === 'finished' && events('game.ended').length === 0 && !LOG.some(function (l) { return /^PATCH vp_games/.test(l); }),
     r.status + ' ' + JSON.stringify(r.body));

print('');
print(bad ? ('  ' + bad + ' FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
if (bad) throw new Error(bad + ' failed');
})().catch(function (e) { print('  FAIL the suite threw: ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
