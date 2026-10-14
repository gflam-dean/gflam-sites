/* WHO A BINGO NIGHT BILLS, AND WHAT A DRAW NEEDS FIRST: the game Worker half of the 14 Oct 2026
   audit fixes. Runs the REAL handlers out of the shipped venueplay-game.js on the rig
   (tools/rig-game-worker.js): handleJoin, handleJoinInfo, handlePlayerAlive, handleBingoSeat,
   handleOverageAck, playerIdsWhoPlayed, handleHostDraw and handleMembersDraw. Nothing is restated.

   What the audit found, in the order checked here:
     - a mistyped code on /play said YOU'RE IN for ever: /join/info never said "no such code"
     - anyone with the public venue code could POST /join with made-up pids and call
       /player/alive, and bingo billed every one of them: twenty ghosts, twenty heads
     - the host's OK on the consent screen covered the server's count, ghosts included
     - the raffle and members draw only asked for tonight's rules in the browser

   Run from the repo root:  jsc tools/test-bingo-worker-15-oct.js */
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };          // distinct hashes, so tokens are told apart
readJson = async function (req) { return (req && req._body) || BODY; };
var finished = false;
var S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
var GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', DRAW = '55555555-5555-4555-8555-555555555555', ROSTER = '66666666-6666-4666-8666-666666666666';
var CODE = 'ACDEFG';
function req(body, headers) { var h = headers || {}; return { _body: body, url: 'https://w/x', headers: { get: function (k) { return h[k] == null ? '' : h[k]; } } }; }
async function call(fn, body, headers) {
  try { return await fn(req(body, headers), ENV, json); }
  catch (e) { return { status: (e && e.status) || 500, body: { error: String(e && e.message) } }; }
}
function world(fmt) {
  DB = { vp_venues: [{ id: VENUE, name: 'Test Pub', slug: 'test-pub', status: 'active', join_code: CODE, au_state: 'QLD' }],
         vp_venue_groups: [], vp_venue_settings: [],
         vp_sessions: [{ id: S1, venue_id: VENUE, status: 'lobby', join_code: CODE, lobby_format: fmt || 'bingo90', plan_cap_at_start: 2, overage_approved: false }],
         vp_players: [], vp_games: [], vp_cards: [], vp_trivia_answers: [], vp_claims: [], vp_gaming_declarations: [] };
}
// The real table defaults kicked to false; the rig's fake one has no defaults, so give it the same.
async function joinAs(pid, name) { var r = await call(handleJoin, { code: CODE, pid: pid, name: name || '' });
  DB.vp_players.forEach(function (p) { if (p.kicked == null) p.kicked = false; }); return r.body && r.body.token; }
function rowOf(pid) { return DB.vp_players.filter(function (p) { return p.device_id === pid; })[0]; }
async function billed(sid) { return countPlayersWhoPlayed(DB.vp_players.filter(function (p) { return p.session_id === sid && !p.kicked; }), await playerIdsWhoPlayed(ENV, sid)); }

(async function () {
  print('/join/info: a code nobody holds says so');
  world();
  var r = await call(handleJoinInfo, { code: 'ZZZZZZ' });
  show('an unknown code answers exists:false', r.body && r.body.exists === false, JSON.stringify(r.body));
  r = await call(handleJoinInfo, { code: CODE });
  show('CONTROL: the venue\'s own code is not called unknown, and still says what to collect',
       r.body && r.body.exists !== false && !!r.body.collect, JSON.stringify(r.body));
  r = await call(handleJoinInfo, { code: '' });
  show('an empty code answers exists:false', r.body && r.body.exists === false, JSON.stringify(r.body));
  DB.vp_sessions = [];
  r = await call(handleJoinInfo, { code: CODE });
  show('a venue with nothing on tonight is not called a typo either', r.body && r.body.exists !== false && !!r.body.collect, JSON.stringify(r.body));
  var realFetch = fetch;
  fetch = async function (u, o) { if (/vp_venues/.test(String(u))) return { ok: false, status: 503, json: async function () { return {}; }, text: async function () { return 'down'; } }; return realFetch(u, o); };
  r = await call(handleJoinInfo, { code: 'ZZZZZZ' });
  fetch = realFetch;
  show('a database that does not answer is never read as "no such code"', !(r.body && r.body.exists === false), JSON.stringify(r));

  print('ghosts: twenty made-up pids POST /join and say they are alive, four real phones are dealt');
  world();
  var real = ['realphone01', 'realphone02', 'realphone03', 'realphone04'], ghosts = [], toks = {};
  for (var i = 0; i < real.length; i++) toks[real[i]] = await joinAs(real[i], 'P' + i);
  for (var g = 0; g < 20; g++) { var gp = 'ghost' + ('000' + g).slice(-3) + 'xx'; ghosts.push(gp); toks[gp] = await joinAs(gp, 'G' + g); }
  show('CONTROL: all 24 got a token and a row (a script can still do this much)', DB.vp_players.length === 24 && !!toks.ghost000xx, DB.vp_players.length);
  for (g = 0; g < ghosts.length; g++) {
    await call(handlePlayerAlive, {}, { 'X-Player-Token': toks[ghosts[g]] });
  }
  show('a ghost saying it is alive in a BINGO session stamps nothing', DB.vp_players.filter(function (p) { return p.played_at; }).length === 0,
       DB.vp_players.filter(function (p) { return p.played_at; }).length + ' stamped');
  r = await call(handleBingoSeat, { session_id: S1, dids: real.concat(['strangerkey1']), deal: false });
  show('the seat check names the four real phones and not the channel stranger',
       r.status === 200 && r.body.seated.length === 4 && r.body.seated.indexOf('strangerkey1') < 0, JSON.stringify(r.body));
  show('asking in the lobby stamps nobody', DB.vp_players.filter(function (p) { return p.played_at; }).length === 0);
  DB.vp_sessions[0].status = 'running';
  r = await call(handleBingoSeat, { session_id: S1, dids: real, deal: true });
  show('no start-of-game report reached the server, so there was no game row: the deal makes one',
       DB.vp_games.filter(function (x) { return x.session_id === S1 && x.format === 'bingo90' && x.status === 'running'; }).length === 1, JSON.stringify(DB.vp_games));
  show('the deal stamps exactly the four phones the console dealt to',
       r.status === 200 && real.every(function (d) { return !!rowOf(d).played_at; }) && ghosts.every(function (d) { return !rowOf(d).played_at; }));
  var n = await billed(S1);
  show('the bill counts the four people, not the 24 rows', n === 4, n + ' billed');
  r = await call(handleBingoSeat, { session_id: S1, dids: [], count: true });
  show('the console\'s night card is given the same number the bill uses', r.body && r.body.counted === 4, JSON.stringify(r.body));
  r = await call(handleBingoSeat, { session_id: S1, dids: ['paper-m-1', '<img src=x>', 'ab'], deal: true });
  show('a paper card id, markup or a too-short id is never looked up or stamped', r.status === 200 && r.body.seated.length === 0, JSON.stringify(r.body));
  DB.vp_sessions[0].status = 'finished';
  var late = rowOf('ghost001xx'); late.played_at = null;
  r = await call(handleBingoSeat, { session_id: S1, dids: ['ghost001xx'], deal: true });
  show('a closed session takes no new stamps', !late.played_at && r.status === 200);
  DB.vp_sessions[0].status = 'running';
  var keepStaff = requireStaff;
  requireStaff = async function () { var e = new Error('Not authorised: you are not staff at this venue'); e.status = 403; throw e; };
  r = await call(handleBingoSeat, { session_id: S1, dids: real, deal: true });
  requireStaff = keepStaff;
  show('a host from another venue is refused', r.status === 403, JSON.stringify(r));

  print('a trivia session keeps the phone\'s own stamp');
  world('trivia');
  var tt = await joinAs('triviaphone1', 'T');
  await call(handlePlayerAlive, {}, { 'X-Player-Token': tt });
  show('CONTROL: a trivia phone saying it is alive is stamped, as before', !!rowOf('triviaphone1').played_at);

  print('the OK covers what the host was shown');
  world(); DB.vp_sessions[0].status = 'running';
  for (i = 0; i < real.length; i++) await joinAs(real[i], 'P' + i);
  for (g = 0; g < 20; g++) await joinAs('ghost' + ('000' + g).slice(-3) + 'xx', 'G' + g);
  r = await call(handleOverageAck, { session_id: S1, approved_count: 4 });
  show('a bingo host shown 4 approves 4, not the 24 rows', r.status === 200 && DB.vp_sessions[0].overage_approved_count === 4, JSON.stringify(r.body));
  r = await call(handleOverageAck, { session_id: S1 });
  show('CONTROL: a console that sends no number (trivia, musical) records the server\'s count, as before', DB.vp_sessions[0].overage_approved_count === 24, DB.vp_sessions[0].overage_approved_count);
  r = await call(handleOverageAck, { session_id: S1, approved_count: 90 });
  show('a number bigger than the room is never recorded', DB.vp_sessions[0].overage_approved_count === 24, DB.vp_sessions[0].overage_approved_count);

  print('the raffle draw asks for tonight\'s rules');
  function raffleWorld() {
    world(); DB.vp_sessions[0].status = 'running';
    DB.vp_games = [{ id: GAME, session_id: S1, seq: 1, format: 'raffle', status: 'running', config: {} }];
    DB.vp_raffle_games = [{ game_id: GAME, range_min: 1, range_max: 200, draws_count: 1, allow_redraw: true, time_to_claim_seconds: 0 }];
    DB.vp_raffle_results = [];
  }
  function decl(fmt, hoursAgo, text) { DB.vp_gaming_declarations.push({ id: 'd' + DB.vp_gaming_declarations.length, venue_id: VENUE, format: fmt, category_claimed: text, declared_at: new Date(NOWMS - hoursAgo * 3600000).toISOString() }); }
  raffleWorld();
  r = await call(handleHostDraw, { game_id: GAME, prize: 'Meat tray', prize_type: 'other' });
  show('no acceptance: refused 428, needs_rules, and no ticket drawn', r.status === 428 && r.body.needs_rules === true && DB.vp_raffle_results.length === 0, JSON.stringify(r));
  decl('raffle', 1, 'RECORDED AUTOMATICALLY, NOT SHOWN TO THE HOST (free entry game). Free entry.');
  r = await call(handleHostDraw, { game_id: GAME, prize: 'Meat tray', prize_type: 'other' });
  show('a row written automatically for a game nobody saw is not an acceptance', r.status === 428 && DB.vp_raffle_results.length === 0, r.status);
  decl('raffle', 25, 'Free entry. Nobody pays to play.');
  r = await call(handleHostDraw, { game_id: GAME, prize: 'Meat tray', prize_type: 'other' });
  show('yesterday\'s acceptance (25 hours) does not cover tonight', r.status === 428, r.status);
  decl('bingo90', 1, 'Free entry. Nobody pays to play.');
  r = await call(handleHostDraw, { game_id: GAME, prize: 'Meat tray', prize_type: 'other' });
  show('accepting the BINGO rules does not cover the raffle', r.status === 428, r.status);
  decl('raffle', 1, 'Free entry. Nobody pays to play.');
  r = await call(handleHostDraw, { game_id: GAME, prize: 'Meat tray', prize_type: 'other' });
  show('CONTROL: accepted an hour ago, the draw goes ahead', r.status === 200 && DB.vp_raffle_results.length === 1, JSON.stringify(r.body));

  print('the members draw asks too');
  function membersWorld() {
    world();
    DB.vp_member_draws = [{ id: DRAW, venue_id: VENUE, roster_id: ROSTER, name: 'Friday Draw', current_jackpot_cents: 50000, starting_amount_cents: 50000,
                            increment_cents: 10000, draw_length_seconds: 4, time_to_claim_seconds: 60, last_drawn_at: null, last_drawn_date: null }];
    DB.vp_member_rosters = [{ id: ROSTER, venue_id: VENUE }];
    DB.vp_members = [];
    for (var k = 1; k <= 10; k++) DB.vp_members.push({ id: '77777777-7777-4777-8777-0000000000' + (10 + k), roster_id: ROSTER, member_number: 100 + k, first_name: 'M', last_name: 'N' + k, status: 'valid' });
    DB.vp_venue_settings = [{ venue_id: VENUE, name_display: 'abbrev_last' }];
    DB.vp_member_draw_results = [];
  }
  membersWorld();
  r = await call(handleMembersDraw, { draw_id: DRAW });
  show('no acceptance: refused 428 and no member drawn', r.status === 428 && r.body.needs_rules === true && DB.vp_member_draw_results.length === 0 && !DB.vp_member_draws[0].last_drawn_at, JSON.stringify(r));
  requireStaff = async function () { var e = new Error('Not authorised: you are not staff at this venue'); e.status = 403; throw e; };
  r = await call(handleMembersDraw, { draw_id: DRAW });
  requireStaff = keepStaff;
  show('a host from another venue is told 403, never whether this venue has accepted', r.status === 403, JSON.stringify(r));
  decl('members', 2, 'Free entry. Nobody pays to play.');
  r = await call(handleMembersDraw, { draw_id: DRAW });
  show('CONTROL: accepted tonight, a member is drawn', r.status === 200 && !!r.body.member_number, JSON.stringify(r.body));

  print('and the console shows the rules again when the server says it has none');
  /* The REAL vp-gaming.js, with a page small enough to hold its popup. The raffle and members
     consoles call gateFor(fmt, startDraw, {waitRecord:true}), and on a 428 call it again with
     force:true (rulesAgain in their host.html). */
  function gamingPage(declare) {
    var store = {}, wraps = [], timers = [], posts = [];
    function node() { var n = { _q: {}, setAttribute: function () {}, remove: function () { n.removed = true; }, addEventListener: function () {},
      querySelector: function (sel) { if (!n._q[sel]) n._q[sel] = { addEventListener: function (ev, fn) { this['on' + ev] = fn; }, focus: function () {} }; return n._q[sel]; } }; return n; }
    var doc = { getElementById: function () { return null; }, createElement: function () { return node(); }, head: { appendChild: function () {} },
      body: { appendChild: function (n) { wraps.push(n); } }, addEventListener: function () {}, removeEventListener: function () {},
      querySelector: function (sel) { return sel === '.vpg-wrap' ? (wraps.filter(function (w) { return !w.removed; })[0] || null) : null; } };
    var win = { VP: { getContext: function () { return { venue: { id: VENUE, name: 'Test Pub', au_state: 'QLD' } }; },
                      gameApiPost: function (p, b) { posts.push(p); return declare(p, b); } } };
    var ls = { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); } };
    new Function('window', 'document', 'localStorage', 'setTimeout', 'VP', readFile('venueplay/app/vp-gaming.js'))(win, doc, ls, function (f) { timers.push(f); return timers.length; }, win.VP);
    return { G: win.VPGaming, open: function () { return wraps.filter(function (w) { return !w.removed; })[0] || null; }, timers: timers, posts: posts };
  }
  var landed = null, pg = gamingPage(function () { return new Promise(function (res) { landed = res; }); }), drew = 0;
  pg.G.gateFor('raffle', function () { drew++; }, { waitRecord: true });
  show('CONTROL: the first draw of the night shows the rules', !!pg.open());
  pg.open()._q['.vpg-go'].onclick();
  drainMicrotasks();
  show('after "I understand" the draw WAITS for the acceptance to reach the server', drew === 0 && pg.posts.indexOf('/host/gaming/declare') >= 0, drew);
  landed({ ok: true }); drainMicrotasks();
  show('and goes the moment it lands', drew === 1, drew);
  pg.G.gateFor('raffle', function () { drew++; }, { waitRecord: true });
  show('CONTROL: the next draw tonight is not asked again', drew === 2 && !pg.open(), drew);
  pg.G.gateFor('raffle', function () { drew++; }, { force: true, waitRecord: true });
  show('but when the server refused (force), the rules come back whatever this browser remembers', drew === 2 && !!pg.open(), drew);
  pg.open()._q['.vpg-go'].onclick(); drainMicrotasks();
  pg.timers.forEach(function (f) { f(); }); drainMicrotasks();
  show('and a record that never answers holds the draw four seconds at most, never for ever', drew === 3, drew);
  var pg2 = gamingPage(function () { return Promise.resolve({ ok: true }); }), drew2 = 0;
  pg2.G.gateFor('bingo90', function () { drew2++; });
  pg2.open()._q['.vpg-go'].onclick();
  show('CONTROL: bingo, which asks for no wait, starts at the tap exactly as before', drew2 === 1, drew2);

  print('the running bingo wall fits a 16:9 telly and keeps out of the JOIN NOW card');
  /* Measured in Chrome on 14 Oct 2026 at 1280x720, 1366x768, 1600x900, 1920x1080 and 3840x2160:
     no layer painted under the card, the corner mark or the logo, and NUMBER CALLED sat 48px down
     at 720p (it was 8). The column is sized by the rules below; this works them out at each size. */
  var TV = readFile('venueplay/tv.html');
  function cssRule(sel) { var m = new RegExp('\\n\\s*\\' + sel + '\\{([^}]*)\\}').exec(TV); return m ? m[1] : ''; }
  function evalLen(expr, W, H) {   // min()/clamp() of px, cqw (container = the wall's width) and vh
    var e = expr.replace(/(\d*\.?\d+)cqw/g, function (_, n) { return '(' + n + '*' + W / 100 + ')'; })
                .replace(/(\d*\.?\d+)vh/g, function (_, n) { return '(' + n + '*' + H / 100 + ')'; })
                .replace(/(\d*\.?\d+)px/g, '$1').replace(/clamp\(/g, 'Math.max(').replace(/min\(/g, 'Math.min(');
    e = e.replace(/Math\.max\(([^,]+),(.+),([^,()]+)\)$/, 'Math.max($1,Math.min($2,$3))');
    return eval(e);
  }
  var ball = /width:([^;]+);/.exec(cssRule('.curball'))[1], prev = /width:([^;]+);/.exec(cssRule('.prevball'))[1];
  var fits = [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [3840, 2160]].every(function (s) {
    var col = evalLen(ball, s[0], s[1]) + evalLen(prev, s[0], s[1]);
    return col <= 0.36 * s[1];
  });
  show('at every size the ball and the recent balls take at most 36% of the height (the label then clears overscan)', fits, ball + ' + ' + prev);
  var qr = /width:(clamp\([^;]+\));/.exec(cssRule('.qrmini'))[1];
  show('the column still reserves the JOIN NOW card\'s own QR size under it', cssRule('.runleft').indexOf('padding-bottom:calc(5.1cqw + ' + qr + ')') >= 0, cssRule('.runleft'));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('bingo worker 15 Oct: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
