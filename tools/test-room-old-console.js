/* A CONSOLE FROM BEFORE THE ROOM SERVER OPENS A GAME: THE GAME WORKER MOVES THE VENUE TO MEET IT.

   1 Nov 2026. A TV on the room no longer keeps an ear on Supabase all day (that ear was one
   Supabase connection per TV, which is what the room exists to save). So a console cached from
   before the switch, which talks only on Supabase, has to be heard somewhere else: by the game
   Worker, when it opens a game. Every console new enough to know about the room says road:"room",
   "supabase" or "off" on POST /session (and on the members draw, which opens no session). One that
   says nothing is from before the switch, and every room of its venue is handed over.

   Runs the REAL handleCreateSession and membersDrawThenRoad out of venueplay-game.js (through
   tools/rig-game-worker.js, which loads the shipped Worker against a fake database), with a Durable
   Object namespace that records what it is asked. The members draw itself is stood in for: it is
   not what is being tested, and it is the regulated-adjacent path this change does not touch.

   Run from the repo root:  jsc tools/test-room-old-console.js
*/
load('tools/rig-game-worker.js');

readJson = async function (req) { return (req && req._body) || {}; };
var CODE = fnvVenueCode('test-pub');
DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: CODE, au_state: 'QLD', max_players: 100 }],
       vp_venue_groups: [], vp_venue_settings: [], vp_sessions: [], vp_players: [], vp_games: [], vp_cards: [],
       vp_member_draws: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', venue_id: VENUE, name: 'Thursday draw' }] };
venueJoinCode = async function () { return CODE; };

var ASKED = [];
function ns() {
  return { idFromName: function (n) { return n; },
           get: function (n) { return { fetch: function (u, init) { ASKED.push(n + ' ' + (typeof u === 'string' ? u : u.url)); return Promise.resolve(new Response(JSON.stringify({ ok: true, closed: 1 }), { status: 200 })); } }; } };
}
var FIVE = ['vp-' + fnvVenueCode('test-pub'), 'vp-' + fnvVenueCode('trivia-test-pub'), 'vp-' + fnvVenueCode('musical-test-pub'),
            'vp-' + fnvVenueCode('raffle-test-pub'), 'vp-' + fnvVenueCode('members-test-pub')];
function req(path, body) { return { _body: body, url: 'https://game.test' + path, headers: { get: function () { return ''; } },
                                    clone: function () { return { json: function () { return Promise.resolve(body); } }; } }; }
function allFive(soft) {
  return FIVE.every(function (n) { return ASKED.some(function (a) { return a.indexOf(n + ' https://room/handover') === 0 && (soft ? /soft=1/.test(a) : !/soft=1/.test(a)); }); });
}
async function open(fmt, road) {
  ASKED = []; DB.vp_sessions = [];
  var b = { venue_id: VENUE, format: fmt }; if (road !== undefined) b.road = road;
  return await handleCreateSession(req('/session', b), ENV, json);
}

(async function () {
  ENV.ROOM = ns();
  /* Which formats the Worker has on the room. The constant is out of reach of a test (the Worker is
     one script), so the one function that reads it answers for it here. */
  var ON = { musical: false, trivia: false, raffle: false, members: false };
  var realFormatsOn = roomFormatsOn;
  var shipped = realFormatsOn();
  show('control: the shipped Worker answers on or off for each of the four formats', Object.keys(ON).every(function (x) { return typeof shipped[x] === 'boolean'; }), JSON.stringify(shipped));
  roomFormatsOn = function () { var o = {}; for (var x in ON) o[x] = ON[x]; return o; };

  print('== POST /session ==');
  var r = await open('musical', 'room');
  show('a console on the room opens its game and no room is touched', r.status === 200 && ASKED.length === 0, ASKED.join(' | '));
  r = await open('musical');
  show('a console that says no road (from before the switch) opens its game as always', r.status === 200 && !!r.body.session_id, JSON.stringify(r.body));
  show('and the Worker handed over all five of the venue\'s rooms, hard', allFive(false) && ASKED.length === 5, ASKED.join(' | '));
  r = await open('trivia', 'supabase');
  show('a console that already left the room passes the word on, softly', allFive(true), ASKED.join(' | '));
  r = await open('raffle', 'off');
  show('a console told raffle is off, with raffle still off, changes nothing', r.status === 200 && ASKED.length === 0, ASKED.join(' | '));
  ON.raffle = true;
  r = await open('raffle', 'off');
  show('the same console once raffle is on decided before the flip: the venue moves to meet it', allFive(false), ASKED.join(' | '));
  ON.raffle = false;
  r = await open('bingo');
  show('an old bingo console too (bingo has been on the room by default since 31 Oct)', allFive(false));
  var noRoom = ENV.ROOM; delete ENV.ROOM; ASKED = [];
  r = await open('musical');
  show('a Worker with no room binding opens the game and asks no room', r.status === 200 && ASKED.length === 0);
  ENV.ROOM = noRoom;

  print('== the members draw ==');
  var drew = 0;
  handleMembersDraw = async function () { drew++; return json({ draw_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', winner_name: 'Sam' }); };
  ASKED = [];
  r = await membersDrawThenRoad(req('/host/members/draw', { draw_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', road: 'room' }), ENV, json);
  show('a members console on the room draws, and no room is touched', r.status === 200 && drew === 1 && ASKED.length === 0);
  r = await membersDrawThenRoad(req('/host/members/draw', { draw_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), ENV, json);
  show('an old members console draws exactly as before', r.status === 200 && drew === 2 && r.body.winner_name === 'Sam');
  show('and the draw\'s venue is found and every room of it handed over', allFive(false), ASKED.join(' | '));
  ASKED = [];
  handleMembersDraw = async function () { drew++; return json({ error: 'The draw is still on the screen.' }, 429); };
  r = await membersDrawThenRoad(req('/host/members/draw', { draw_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), ENV, json);
  show('a draw that was refused moves nothing, and its answer is passed back untouched', r.status === 429 && ASKED.length === 0);

  print('');
  print(bad ? (bad + ' OF ' + ran + ' CHECKS FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('room old console: ' + bad + ' failed');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
