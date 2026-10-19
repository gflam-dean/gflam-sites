/* Pick up a running quiz or musical game from ANY device: RUN, not read.

   Dean, 20 Oct 2026: "it would be shit to not be able to fix something to let a venue play a night
   on a night". A tablet that died mid-quiz left every other device on a fresh setup screen, because
   the consoles recovered only from their own localStorage.

   Runs the REAL game Worker on tools/rig-game-worker.js and the REAL shared console logic
   (venueplay/app/vp-pickup.js):
     /host/running       finds this venue's running trivia (or musical) game in an open night, and
                         nobody else's; says who holds it; for an open question gives the host the
                         answer and which phones are in (by the phone's own id, as the console counts
                         them); nothing running is null; only staff at THAT venue are answered
     /host/running/take  records this console as the holder, per format (a trivia pickup leaves a
                         musical console's record alone); refuses another venue's game, a finished
                         game, a bad console id, and a non-staff caller; before migration 110 it
                         still answers ok (held:false) so a pickup is never lost to a missing column
     the weekly rule     the night picked up is the same night: the next round in it is not refused
     VP_PICKUP.decide    this tablet's own game comes back silently; a game picked up elsewhere since,
                         or started elsewhere, is asked about; nothing running is nothing
     VP_PICKUP.check     a console whose game was picked up elsewhere stands down; one that still holds
                         it, or cannot tell (network), does not; a later round of the same night still
                         counts; heard() never stands anything down on a heartbeat alone, ignores its
                         own id, and asks at most once per burst

   Run from the repo root:  jsc tools/test-console-pickup.js
*/
load('tools/rig-game-worker.js');
var _iv = [];
function setInterval(f) { _iv.push(f); return _iv.length; }
function clearInterval() {}
load('venueplay/app/vp-pickup.js');

var SESSION = '33333333-3333-4333-8333-333333333333', OLDSESS = '44444444-4444-4444-8444-444444444444';
var GAME = '55555555-5555-4555-8555-555555555555', MGAME = '66666666-6666-4666-8666-666666666666';
var OTHERV = '77777777-7777-4777-8777-777777777777', OTHERS = '88888888-8888-4888-8888-888888888888', OTHERG = '99999999-9999-4999-8999-999999999990';
var SET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', Q2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
var NO_HOLDERS = false;   // the live database before migration 110
var rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase();
  if (NO_HOLDERS && /\/rest\/v1\/vp_sessions\?/.test(u) && (/console_holders/.test(u) || (m === 'PATCH' && /console_holders/.test(String(opts.body || ''))))) {
    LOG.push('REFUSED ' + u);
    return resp(400, { code: '42703', message: 'column vp_sessions.console_holders does not exist' });
  }
  return rigFetch(url, opts);
};
var STAFF_AT = {};   // which venues the caller is staff at; the rig's own requireStaff lets anyone in
var CALLS = [];
requireStaff = async function (env, uid, venueId) {
  CALLS.push(venueId);
  if (!STAFF_AT[venueId]) { var e = new Error('Not authorised: you are not staff at this venue'); e.status = 403; throw e; }
  return { id: 'staff-1', role: 'owner', venue_id: venueId, auth_user_id: uid };
};
function iso(ms) { return new Date(ms).toISOString(); }
function world() {
  STAFF_AT = {}; STAFF_AT[VENUE] = true; CALLS = []; NO_HOLDERS = false;
  DB = {
    vp_venues: [{ id: VENUE, name: 'Test Alpha', slug: 'test-alpha', status: 'active', weekly_limit_off: false,
                  last_trivia_at: iso(NOWMS - 3600000), last_trivia_session_id: SESSION },
                { id: OTHERV, name: 'Elsewhere', slug: 'elsewhere', status: 'active' }],
    vp_sessions: [{ id: OLDSESS, venue_id: VENUE, status: 'finished', join_code: 'OLD111', created_at: iso(NOWMS - 9 * 86400000) },
                  { id: SESSION, venue_id: VENUE, status: 'running', join_code: 'ABC234', created_at: iso(NOWMS - 3600000), console_holders: null },
                  { id: OTHERS, venue_id: OTHERV, status: 'running', join_code: 'ZZZ999', created_at: iso(NOWMS - 60000) }],
    vp_games: [{ id: 'fin-1', session_id: OLDSESS, seq: 1, format: 'trivia', status: 'running' },   // a stale row in a CLOSED night
               { id: GAME, session_id: SESSION, seq: 2, format: 'trivia', status: 'running', config: {} },
               { id: MGAME, session_id: SESSION, seq: 3, format: 'musical_bingo', status: 'running', config: {} },
               { id: OTHERG, session_id: OTHERS, seq: 1, format: 'trivia', status: 'running', config: {} }],
    vp_trivia_games: [{ game_id: GAME, question_set_id: SET, current_seq: 2, phase: 'asking', question_ends_at: iso(NOWMS + 20000) }],
    vp_questions: [{ id: 'q1', set_id: SET, seq: 1, question: 'One?', options: ['a', 'b'], correct_index: 0 },
                   { id: Q2, set_id: SET, seq: 2, question: 'Two?', options: ['a', 'b', 'c'], correct_index: 2 }],
    vp_players: [{ id: 'p-ann', session_id: SESSION, device_id: 'dev-ann', kicked: false },
                 { id: 'p-bob', session_id: SESSION, device_id: 'dev-bob', kicked: false }],
    vp_trivia_answers: [{ id: 1, game_id: GAME, question_id: Q2, player_id: 'p-ann', answer_index: 1 },
                        { id: 2, game_id: GAME, question_id: 'q1', player_id: 'p-bob', answer_index: 0 }],
    vp_admin_audit: [], vp_venue_settings: [],
  };
  LOG.length = 0;
}
async function call(fn, body) {
  BODY = body;
  try { return await fn({ headers: { get: function () { return 'Bearer x'; } } }, ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: String(e.message || e) } }; }
}
function running(fmt, venue) { return call(handleHostRunning, { venue_id: venue || VENUE, format: fmt || 'trivia' }); }
function take(game, cid, venue) { return call(handleHostRunningTake, { venue_id: venue || VENUE, game_id: game || GAME, console_id: cid }); }
function sess() { return DB.vp_sessions.filter(function (s) { return s.id === SESSION; })[0]; }

(async function () {
  print('\n/host/running: is a game on at my venue?');
  world();
  var r = await running('trivia');
  var g = r.body && r.body.running;
  show('finds this venue\'s running trivia game, in its open night', r.status === 200 && g && g.game_id === GAME && g.session_id === SESSION && g.join_code === 'ABC234', JSON.stringify(r.body));
  show('...not the stale row in a closed night, and not another venue\'s', g && g.game_id !== 'fin-1' && g.game_id !== OTHERG);
  show('...nobody has picked it up yet', g && g.holder === null);
  show('...the open question\'s answer, for the host', g && g.current && g.current.qseq === 2 && g.current.ci === 2, JSON.stringify(g && g.current));
  show('...and the phones already in, by the id the console counts them by (Ann answered this one, Bob only the last)',
    g && g.current && g.current.pids['dev-ann'] === true && !g.current.pids['dev-bob'] && Object.keys(g.current.pids).length === 1, JSON.stringify(g && g.current));
  show('...after a staff check at THIS venue', CALLS.length === 1 && CALLS[0] === VENUE, JSON.stringify(CALLS));
  r = await running('musical_bingo');
  show('musical bingo is found the same way', r.body.running && r.body.running.game_id === MGAME && r.body.running.current === null, JSON.stringify(r.body));
  DB.vp_trivia_games[0].phase = 'revealed';
  r = await running('trivia');
  show('between questions there is no open question to hand over', r.body.running && r.body.running.current === null, JSON.stringify(r.body));
  DB.vp_games.forEach(function (x) { if (x.id === GAME) x.status = 'finished'; });
  r = await running('trivia');
  show('a finished game: nothing running', r.status === 200 && r.body.running === null, JSON.stringify(r.body));
  world();
  STAFF_AT = {};
  r = await running('trivia');
  show('somebody who is not staff at this venue is refused, and told nothing', r.status === 403 && !r.body.running, JSON.stringify(r.body));
  world();
  r = await running('bingo90');
  show('only trivia and musical bingo', r.status === 400, JSON.stringify(r.body));

  print('\n/host/running/take: "Pick it up here"');
  world();
  r = await take(GAME, 'cNEWDEVICE01');
  show('records this console as the trivia holder of the night', r.status === 200 && r.body.held === true &&
    sess().console_holders && sess().console_holders.trivia && sess().console_holders.trivia.id === 'cNEWDEVICE01', JSON.stringify(sess().console_holders));
  r = await running('trivia');
  show('/host/running now names it', r.body.running.holder === 'cNEWDEVICE01' && !!r.body.running.taken_at, JSON.stringify(r.body.running));
  r = await take(MGAME, 'cMUSICDEV002');
  show('a musical pickup is its own entry: the trivia holder is untouched',
    sess().console_holders.trivia.id === 'cNEWDEVICE01' && sess().console_holders.musical_bingo.id === 'cMUSICDEV002', JSON.stringify(sess().console_holders));
  r = await take(GAME, 'cOLDTABLET03');
  show('picking it back up on the first tablet replaces the holder', sess().console_holders.trivia.id === 'cOLDTABLET03');
  STAFF_AT[OTHERV] = false;
  r = await take(OTHERG, 'cSNEAKYDEV04');
  show('another venue\'s game, named with MY venue id, is refused (403)', r.status === 403 && !(DB.vp_sessions[2].console_holders), JSON.stringify(r.body));
  r = await take(OTHERG, 'cSNEAKYDEV04', OTHERV);
  show('...and with its own venue id the staff check refuses it', r.status === 403, JSON.stringify(r.body));
  DB.vp_games.forEach(function (x) { if (x.id === GAME) x.status = 'finished'; });
  r = await take(GAME, 'cLATEDEVICE5');
  show('a finished game cannot be picked up (409)', r.status === 409 && sess().console_holders.trivia.id === 'cOLDTABLET03', JSON.stringify(r.body));
  world();
  r = await take(GAME, 'x');
  show('a console id that is not one is refused (400)', r.status === 400 && !sess().console_holders, JSON.stringify(r.body));
  world();
  STAFF_AT = {};
  r = await take(GAME, 'cNOTSTAFF006');
  show('a caller who is not staff here is refused and nothing is written', r.status === 403 && !sess().console_holders, JSON.stringify(r.body));

  print('\nbefore migration 110 is run on the live database');
  world();
  NO_HOLDERS = true;
  r = await running('trivia');
  show('/host/running still finds the game (the read falls back)', r.status === 200 && r.body.running && r.body.running.game_id === GAME && r.body.running.holder === null, JSON.stringify(r.body));
  r = await take(GAME, 'cBEFORE11007');
  show('a pickup still goes ahead (ok, held:false): it is never lost to a missing column', r.status === 200 && r.body.ok === true && r.body.held === false, JSON.stringify(r.body));
  show('...it really was refused first', LOG.some(function (l) { return /^REFUSED/.test(l); }), LOG.join(' | '));

  print('\nthe weekly rule: the night picked up is the same night');
  world();
  await take(GAME, 'cNEWDEVICE01');
  var s = Object.assign({}, sess());
  var m = await checkWeeklyFormatLimit(ENV, s, true);
  show('the next round in the picked-up night is not refused', m === null, m);
  DB.vp_venues[0].last_trivia_at = iso(NOWMS - 2 * 86400000); DB.vp_venues[0].last_trivia_session_id = OLDSESS;
  m = await checkWeeklyFormatLimit(ENV, Object.assign({}, sess()), true);
  show('CONTROL: a different night two days on is refused (the rule is live in this rig)', typeof m === 'string' && /once a week/.test(m), m);

  print('\nVP_PICKUP.decide (the console\'s choice)');
  var run = { session_id: SESSION, game_id: GAME, holder: null };
  show('nothing running: none', VP_PICKUP.decide({ sessionId: SESSION }, null) === 'none');
  show('this tablet\'s own game, nobody else has it: restore silently', VP_PICKUP.decide({ sessionId: SESSION, cid: 'cMINE0000001' }, run) === 'restore');
  show('an older save without a console id, nobody else has it: restore silently', VP_PICKUP.decide({ sessionId: SESSION }, run) === 'restore');
  show('this tablet picked it up itself: restore silently', VP_PICKUP.decide({ sessionId: SESSION, cid: 'cMINE0000001' }, { session_id: SESSION, game_id: GAME, holder: 'cMINE0000001' }) === 'restore');
  show('picked up on another device since: ask', VP_PICKUP.decide({ sessionId: SESSION, cid: 'cMINE0000001' }, { session_id: SESSION, game_id: GAME, holder: 'cOTHER000002' }) === 'ask');
  show('no save on this device (a new tablet): ask', VP_PICKUP.decide(null, run) === 'ask');
  show('a save from another night: ask', VP_PICKUP.decide({ sessionId: OLDSESS }, run) === 'ask');
  var w = VP_PICKUP.words('trivia');
  show('the question, in Dean\'s words', w.title === 'A quiz is running at this venue. Pick it up?' && /musical/.test(VP_PICKUP.words('musical_bingo').title), w.title);

  print('\nVP_PICKUP.check: a replaced console stands down, through the real Worker');
  world();
  var post = async function (path, body) {
    var fn = path === '/host/running' ? handleHostRunning : path === '/host/running/take' ? handleHostRunningTake : null;
    var res = await call(fn, body);
    if (res.status >= 400) { var e = new Error(res.body.error); e.status = res.status; throw e; }
    return res.body;
  };
  var found = await VP_PICKUP.find(post, VENUE, 'trivia');
  show('find() through the real route', found && found.game_id === GAME, JSON.stringify(found));
  var moved = 0, mySession = SESSION;
  VP_PICKUP.arm({ post: post, venueId: VENUE, format: 'trivia', sessionId: function () { return mySession; },
                  cid: function () { return 'cTABLET00001'; }, onMoved: function () { moved++; } });
  var still = await VP_PICKUP.check();
  show('nobody has picked it up: this console carries on', still === true && moved === 0);
  await VP_PICKUP.take(post, VENUE, found, 'cTABLET00001');
  still = await VP_PICKUP.check();
  show('it picked it up itself: carries on', still === true && moved === 0);
  NOWMS += 20000;
  VP_PICKUP.heard('cTABLET00001');
  show('hearing its OWN heartbeat asks nothing', moved === 0);
  await take(GAME, 'cPHONE000002');   // the host picks it up on their phone
  var failing = async function () { throw new Error('The game server did not answer.'); };
  VP_PICKUP.arm({ post: failing, venueId: VENUE, format: 'trivia', sessionId: function () { return mySession; },
                  cid: function () { return 'cTABLET00001'; }, onMoved: function () { moved++; } });
  still = await VP_PICKUP.check();
  show('a failed read is not a takeover: carries on', still === true && moved === 0);
  VP_PICKUP.arm({ post: post, venueId: VENUE, format: 'trivia', sessionId: function () { return mySession; },
                  cid: function () { return 'cTABLET00001'; }, onMoved: function () { moved++; } });
  // the next round of the same night is a new game row: the holder is on the night, so it still counts
  DB.vp_games.forEach(function (x) { if (x.id === GAME) x.status = 'finished'; });
  DB.vp_games.push({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', session_id: SESSION, seq: 4, format: 'trivia', status: 'running', config: {} });
  var asked = LOG.length;
  VP_PICKUP.heard('cPHONE000002');
  for (var i = 0; i < 50; i++) await Promise.resolve();
  show('hearing another console\'s heartbeat makes it ASK the Worker', LOG.length > asked, LOG.slice(asked).join(' | '));
  still = await VP_PICKUP.check();
  show('picked up on the phone (even into round two): the tablet stands down, once', still === false && moved === 1 && VP_PICKUP.isDown() === true, 'moved=' + moved);
  VP_PICKUP.heard('cSOMEONE0003');
  show('...and asks nothing more once down', moved === 1);
  VP_PICKUP.arm({ post: post, venueId: VENUE, format: 'trivia', sessionId: function () { return mySession; },
                  cid: function () { return 'cTABLET00001'; }, onMoved: function () { moved++; } });
  await take('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cTABLET00001');   // the tablet picks it back up: the Worker now says it holds it
  asked = LOG.length; NOWMS += 20000;
  VP_PICKUP.heard('cFAKE0000099'); VP_PICKUP.heard('cFAKE0000098'); VP_PICKUP.heard('cFAKE0000097');
  for (var j = 0; j < 50; j++) await Promise.resolve();
  var asks = LOG.slice(asked).filter(function (l) { return /^GET vp_sessions/.test(l); }).length;
  show('a burst of heartbeats is one question to the Worker', asks === 1, LOG.slice(asked).join(' | '));
  show('a stranger\'s heartbeat alone never stands it down: the Worker says it still holds the game', moved === 1 && VP_PICKUP.isDown() === false, 'moved=' + moved);
  mySession = '';
  still = await VP_PICKUP.check();
  show('with no quiz on, it does not ask at all', still === true);

  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' pickup checks failed');
})().catch(function (e) { print('  FAIL the test itself threw: ' + (e && e.stack || e)); throw e; });
