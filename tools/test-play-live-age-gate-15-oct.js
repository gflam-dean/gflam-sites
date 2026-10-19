/* THE AGE TICK AND THE PAPER FLAG, decided by the Worker, for the format that is on.

   Anisimoff Legal, 8 Oct 2026: no minors in Victorian bingo (free or paid), none in ACT housie
   under a permit, none in a Tasmanian raffle or draw. Phones as bingo tickets: not in Victoria
   (s8.4.7B) or Tasmania (authorised bingo); ACT not prohibited, so ACT is back on the phone.
   Dean, 15 Oct 2026: musical bingo is not bingo, so it is never on paper and never asked its age.

   AND ONLY WHILE SOMETHING IS ON (live audit, 16 Oct 2026). With no session open, '' was read as
   bingo, so an idle ACT phone was asked its age and an idle Victorian phone was told "Tonight you
   play on paper" before the host had opened anything, including on trivia nights. A quiet night
   now asks nothing; a bingo LOBBY (a session with no game row and no lobby_format) still does.

   Part one RUNS the real handlePlayLive and handleJoinInfo out of the shipped game Worker on the
   rig (tools/rig-game-worker.js), against the fake database. Part two lifts the age-tick code out
   of the shipped play.html and RUNS it: the ticket is held until the tick, remembered for the
   night, released on its own when the Worker does not answer (fail open), and taken down again
   when the Worker stops asking. Part three lifts the paper notice and the /play/live poll handler
   and RUNS them: the notice is a cover the Worker can take down, and the poll acts on both flags.

   Run from the repo root:  jsc tools/test-play-live-age-gate-15-oct.js */
load('tools/rig-game-worker.js');
var finished = false;
var V = { VIC: '10000000-0000-4000-8000-000000000001', ACT: '10000000-0000-4000-8000-000000000002', TAS: '10000000-0000-4000-8000-000000000003',
          NSW: '10000000-0000-4000-8000-000000000004', SA: '10000000-0000-4000-8000-000000000005', QLD: '10000000-0000-4000-8000-000000000006',
          VICOFF: '10000000-0000-4000-8000-000000000007' };
DB.vp_venues = Object.keys(V).map(function (st) { return { id: V[st], name: 'The ' + st + ' Hotel', slug: 'the-' + st.toLowerCase(), au_state: st.replace('OFF', ''), status: st === 'VICOFF' ? 'suspended' : 'active' }; });
DB.vp_venue_settings = []; DB.vp_sessions = []; DB.vp_games = [];
var n = 0;
function night(st, format, status, lobbyFormat) {   // a session at that venue; a running game of that format unless status says lobby
  n++; var sid = '20000000-0000-4000-8000-' + ('000000000000' + n).slice(-12), code = 'CODE' + ('00' + n).slice(-2);
  DB.vp_sessions.push({ id: sid, venue_id: V[st], status: status || 'running', join_code: code, lobby_format: lobbyFormat || null, created_at: '2026-10-15T09:00:00Z' });
  if (format) DB.vp_games.push({ id: '30000000-0000-4000-8000-' + ('000000000000' + n).slice(-12), session_id: sid, seq: 1, format: format, status: 'running' });
  return code;
}
function clearNights() { DB.vp_sessions = []; DB.vp_games = []; }
venueByCode = async function (env, code) { var m = /^VENUE-(\w+)$/.exec(String(code)); return m ? V[m[1]] : null; };
async function live(st) { var r = await handlePlayLive({ url: 'https://w/play/live?code=VENUE-' + st, headers: { get: function () { return ''; } } }, ENV, json); return r.body; }
async function info(code) { BODY = { code: code }; var r = await handleJoinInfo({}, ENV, json); return r.body; }

(async function () {
  print('/play/live on a QUIET night (no session open): nothing is on, so nothing is asked');
  var r = await live('VIC');
  show('VIC quiet: live:false, NO paper notice, NO age tick', r.live === false && r.exists === true && r.paper_bingo === false && r.age_gate === false, JSON.stringify(r));
  r = await live('ACT');
  show('ACT quiet: no age tick (the idle phone of the 16 Oct audit)', r.live === false && r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  r = await live('TAS');
  show('TAS quiet: no paper notice', r.live === false && r.paper_bingo === false && r.age_gate === false, JSON.stringify(r));
  r = await live('SA');
  show('SA quiet: no paper notice', r.paper_bingo === false && r.age_gate === false, JSON.stringify(r));
  r = await live('NSW');
  show('NSW quiet: neither', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  r = await live('QLD');
  show('QLD quiet: neither', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  r = await live('VICOFF');
  show('a suspended Victorian venue still answers live:false, suspended:true, and does not throw', r.live === false && r.suspended === true, JSON.stringify(r));
  r = await live('NOWHERE');
  show('an unknown code is exists:false', r.exists === false, JSON.stringify(r));

  print('/play/live with a BINGO LOBBY open (a session, no game row yet, no lobby_format): the rules are on');
  night('VIC', null, 'lobby', null);
  r = await live('VIC');
  show('VIC bingo lobby: live:true, format empty, paper notice AND age tick', r.live === true && r.format === '' && r.paper_bingo === true && r.age_gate === true, JSON.stringify(r));
  clearNights(); night('ACT', null, 'lobby', null);
  r = await live('ACT');
  show('ACT bingo lobby: age tick, phones stay on', r.live === true && r.age_gate === true && r.paper_bingo === false, JSON.stringify(r));
  clearNights(); night('TAS', null, 'lobby', null);
  r = await live('TAS');
  show('TAS bingo lobby: paper, no age tick', r.live === true && r.paper_bingo === true && r.age_gate === false, JSON.stringify(r));
  clearNights(); night('SA', null, 'lobby', null);
  r = await live('SA');
  show('SA bingo lobby: paper as before, no age tick', r.paper_bingo === true && r.age_gate === false, JSON.stringify(r));
  clearNights(); night('VIC', 'bingo90');
  r = await live('VIC');
  show('VIC bingo RUNNING: the same as the lobby', r.live === true && r.format === 'bingo90' && r.paper_bingo === true && r.age_gate === true, JSON.stringify(r));

  print('/play/live on a live night: the format that is on decides');
  clearNights(); night('VIC', null, 'lobby', 'trivia');
  r = await live('VIC');
  show('VIC trivia lobby: live, format trivia, NO age tick, no paper', r.live === true && r.format === 'trivia' && r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  clearNights(); night('VIC', null, 'lobby', 'musical_bingo');
  r = await live('VIC');
  show('VIC musical lobby: NO age tick, no paper (Dean: musical is not bingo)', r.format === 'musical_bingo' && r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  clearNights(); night('VIC', 'musical');
  r = await live('VIC');
  show('VIC musical running: the same', r.format === 'musical' && r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  clearNights(); night('VIC', 'members');
  r = await live('VIC');
  show('VIC members draw running: age tick, no paper', r.format === 'members' && r.age_gate === true && r.paper_bingo === false, JSON.stringify(r));
  clearNights(); night('TAS', 'raffle');
  r = await live('TAS');
  show('TAS raffle running: age tick (no minors in a Tasmanian raffle), no paper', r.format === 'raffle' && r.age_gate === true && r.paper_bingo === false, JSON.stringify(r));
  clearNights(); night('TAS', 'bingo90');
  r = await live('TAS');
  show('TAS bingo running: paper, no age tick', r.format === 'bingo90' && r.age_gate === false && r.paper_bingo === true, JSON.stringify(r));
  clearNights(); night('ACT', 'raffle');
  r = await live('ACT');
  show('ACT raffle running: no age tick (ACT asks only for housie)', r.format === 'raffle' && r.age_gate === false, JSON.stringify(r));
  clearNights(); night('ACT', 'bingo90');
  r = await live('ACT');
  show('ACT bingo running: age tick, on the phone', r.age_gate === true && r.paper_bingo === false, JSON.stringify(r));
  clearNights(); night('NSW', 'trivia');
  r = await live('NSW');
  show('CONTROL: NSW trivia: live, nothing asked', r.live === true && r.join_code && r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  clearNights();

  print('/join/info: the call the phone page acts on, beside paper_bingo');
  r = await info('VENUE-VIC');
  show('VIC quiet: neither (the typed code sits waiting, nothing is blanked)', r.age_gate === false && r.paper_bingo === false && r.format === '', JSON.stringify(r).slice(0, 160));
  r = await info('VENUE-ACT');
  show('ACT quiet: no age tick', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r).slice(0, 160));
  r = await info('VENUE-TAS');
  show('TAS quiet: no paper notice', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r).slice(0, 160));
  var vicLobby = night('VIC', null, 'lobby', null);
  r = await info('VENUE-VIC');
  show('VIC bingo lobby, by the venue code: age_gate true and paper_bingo true', r.age_gate === true && r.paper_bingo === true, JSON.stringify(r).slice(0, 160));
  r = await info(vicLobby);
  show('VIC bingo lobby, by the session\'s own join code: the same', r.age_gate === true && r.paper_bingo === true, JSON.stringify(r).slice(0, 160));
  clearNights(); night('ACT', null, 'lobby', null);
  r = await info('VENUE-ACT');
  show('ACT bingo lobby: age_gate true, paper_bingo false', r.age_gate === true && r.paper_bingo === false, JSON.stringify(r).slice(0, 160));
  clearNights(); night('TAS', null, 'lobby', null);
  r = await info('VENUE-TAS');
  show('TAS bingo lobby: paper, no age tick', r.age_gate === false && r.paper_bingo === true, JSON.stringify(r).slice(0, 160));
  clearNights(); night('NSW', null, 'lobby', null);
  r = await info('VENUE-NSW');
  show('NSW bingo lobby: neither', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r).slice(0, 160));
  clearNights();
  var mu = await info(night('VIC', 'musical'));
  show('VIC musical: neither, and the format is musical', mu.format === 'musical' && mu.age_gate === false && mu.paper_bingo === false, JSON.stringify(mu).slice(0, 160));
  var tr = await info(night('VIC', 'trivia'));
  show('VIC trivia: neither', tr.format === 'trivia' && tr.age_gate === false && tr.paper_bingo === false, JSON.stringify(tr).slice(0, 160));
  clearNights(); night('VIC', null, 'lobby', null);   // a bingo lobby IS open, so a false here is the fail-open, not the quiet night
  var realFetch = fetch;
  fetch = async function (u, o) { if (/vp_venues\?id=eq/.test(String(u))) return { ok: false, status: 503, json: async function () { return {}; }, text: async function () { return 'down'; } }; return realFetch(u, o); };
  r = await info('VENUE-VIC');
  fetch = realFetch;
  show('a database that cannot answer the venue row: no age tick, no paper, no throw (fails open)', r && r.age_gate === false && r.paper_bingo === false && !!r.collect, JSON.stringify(r).slice(0, 160));
  clearNights();
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }

/* ---- part two: the phone page holds its ticket until the tick ---- */
print('play.html: the age tick holds the ticket, remembers the night, and fails open');
var PLAY = readFile('venueplay/play.html');
var a0 = PLAY.indexOf('  var _ageHold=false'), a1 = PLAY.indexOf('  var PATTERN_NAMES', a0);
var sent = [], store = {}, boxes = [];
var P = { room: 'ROYAL1', pid: 'p1', name: 'Ann', numCards: 2 };
var _paper = false;
function send(m) { sent.push(m); }
function deviceId() { return 'dev-1'; }
var sessionStorage = { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
function fakeEl() { var e = { attrs: {}, listeners: {}, children: [], style: {}, _html: '', _q: {},
  setAttribute: function (k, v) { this.attrs[k] = v; }, appendChild: function (c) { this.children.push(c); }, remove: function () { this._removed = true; },
  addEventListener: function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
  querySelector: function (s) { if (!this._q[s]) this._q[s] = fakeEl(); return this._q[s]; } };
  Object.defineProperty(e, 'innerHTML', { get: function () { return this._html; }, set: function (v) { this._html = String(v); } }); return e; }
var document = { body: fakeEl(), createElement: function () { var e = fakeEl(); boxes.push(e); return e; } };
if (a0 < 0 || a1 < 0) { print('  FAIL the age-tick block is not where this test lifts it from'); bad++; }
else {
  (0, eval)(PLAY.slice(a0, a1));
  function tick() { var box = boxes[boxes.length - 1]; var chk = box.querySelector('#age18Chk'); chk.checked = true; box.querySelector('#age18Chk').listeners.change[0](); box.querySelector('#age18Btn').listeners.click[0](); }

  // a first-time player at a Victorian venue: the answer lands, then they type a name and tap Join
  ageAsk();
  ageAnswer({ age_gate: true });
  show('age_gate:true puts up the tick before anyone has joined', boxes.length === 1 && /18 or over/.test(boxes[0].innerHTML) && _ageHold === true, boxes[0] && boxes[0].innerHTML.slice(0, 80));
  show('the backdrop is .97 and pinned to every edge of the viewport (the JOIN button read through .92 at desktop width)', /rgba\(8,6,12,\.97\)/.test(boxes[0].attrs.style) && /position:fixed/.test(boxes[0].attrs.style) && /top:0;left:0;right:0;bottom:0/.test(boxes[0].attrs.style) && /width:100%;height:100%/.test(boxes[0].attrs.style), boxes[0].attrs.style);
  show('and remembers that this room asks', store['vpAge18:ROYAL1'] === 'need', store);
  sendJoin();
  show('tapping Join under the tick queues the announcement: no ticket is asked for', sent.length === 0 && _agePendingJoin === true);
  tick();
  show('ticking it sends the one join that was waiting, with the phone\'s own pid and cards', sent.length === 1 && sent[0].t === 'join' && sent[0].pid === 'p1' && sent[0].cards === 2 && sent[0].did === 'dev-1', sent);
  show('the night is remembered as ticked', store['vpAge18:ROYAL1'] === 'ok' && boxes[0]._removed === true, store);
  sendJoin();
  show('a reconnect later in the night sends straight away', sent.length === 2);
  // a reload later the same night: the Worker says ask again, the session says ticked
  sent = []; _agePendingJoin = false;
  ageAsk(); sendJoin(); ageAnswer({ age_gate: true });
  show('a reload in the same night does not ask again and the join is not held', sent.length === 1 && boxes.length === 1 && _ageHold === false, sent);
  // a reload after the Worker said "need" but before the tick (the punter closed the tab)
  store['vpAge18:ROYAL1'] = 'need'; sent = []; _agePendingJoin = false;
  ageAsk(); sendJoin();
  show('a reload before the tick holds the join and asks again, without waiting on the Worker', sent.length === 0 && boxes.length === 2 && _ageHold === true);
  tick();
  show('and the tick releases it', sent.length === 1);
  // a venue that does not ask
  delete store['vpAge18:ROYAL1']; sent = []; _agePendingJoin = false;
  ageAsk(); sendJoin(); ageAnswer({ age_gate: false, paper_bingo: false });
  show('age_gate:false: the join went straight out and nothing is shown', sent.length === 1 && boxes.length === 2 && _ageHold === false, sent);
  // the Worker never answers (bingo is built to survive that)
  delete store['vpAge18:ROYAL1']; sent = []; _agePendingJoin = false;
  ageAsk(); sendJoin();
  show('FAIL OPEN: with no answer from the Worker, nothing is held and the join goes out as it always did', sent.length === 1 && _ageHold === false, sent);
  ageAnswer(null); ageAnswer(undefined); ageAnswer({});
  show('an empty or missing answer holds nothing either', _ageHold === false && boxes.length === 2);
  // THE ASK GOES AWAY (16 Oct 2026): the lobby that asked has closed, the Worker now says false
  delete store['vpAge18:ROYAL1']; sent = []; _agePendingJoin = false; _ageHold = false; _ageBox = null;
  ageAnswer({ age_gate: true }); sendJoin();
  show('a tick is up and a join is held', boxes.length === 3 && _ageHold === true && sent.length === 0 && store['vpAge18:ROYAL1'] === 'need');
  ageClear();
  show('ageClear takes the tick down, releases the held join and forgets "need"', boxes[2]._removed === true && _ageBox === null && _ageHold === false && sent.length === 1 && store['vpAge18:ROYAL1'] == null, { sent: sent, store: store });
  store['vpAge18:ROYAL1'] = 'ok'; ageClear();
  show('ageClear leaves a tick already given tonight ("ok") alone, and does nothing when nothing is up', store['vpAge18:ROYAL1'] === 'ok' && boxes.length === 3, store);
  // the page cannot build the box
  delete store['vpAge18:ROYAL1']; sent = []; _agePendingJoin = false; _ageHold = false; _ageBox = null;
  var realCreate = document.createElement; document.createElement = function () { throw new Error('no DOM'); };
  ageAsk(); ageAnswer({ age_gate: true }); sendJoin();
  document.createElement = realCreate;
  show('FAIL OPEN: a page that cannot show the tick does not hold the ticket', sent.length === 1 && _ageHold === false, sent);
  show('the join is always the same five-field announcement the console seats', sent.every(function (m) { return m.t === 'join' && 'pid' in m && 'name' in m && 'cards' in m && 'did' in m; }));
}

/* ---- part three: the paper notice is a cover the Worker can take down, and the poll acts on both flags ---- */
print('play.html: "Tonight you play on paper" comes down again, and the /play/live poll acts on the flags');
var p0 = PLAY.indexOf('  var _paper=false;'), p1 = PLAY.indexOf('  function randId(){', p0);
var w0 = PLAY.indexOf('function watchVenue(slug){'), w1 = w0 < 0 ? -1 : PLAY.indexOf('.then(function(d){', w0), w2 = w1 < 0 ? -1 : PLAY.indexOf('}).catch(function(){});', w1);
if (p0 < 0 || p1 < 0 || w0 < 0 || w1 < 0 || w2 < 0) { print('  FAIL the paper block or the watchVenue poll is not where this test lifts it from'); bad++; }
else {
  var unsubs = 0, closes = 0, connects = [], routes = 0, views = [], conns = [];
  var ch = { unsubscribe: function () { unsubs++; } }, _room = { close: function () { closes++; } }, subscribed = true, sendQueue = [{ t: 'join' }];
  function connect(room) { connects.push(room); }
  // The notice is the page's own #vPaper view since 20 Oct 2026, shown by show() in the normal frame.
  var vPaper = fakeEl(); vPaper.classList = { _h: true, add: function (c) { if (c === 'hidden') this._h = true; }, remove: function (c) { if (c === 'hidden') this._h = false; }, contains: function (c) { return c === 'hidden' && this._h; } };
  globalThis.$ = function (id) { return id === 'vPaper' ? vPaper : fakeEl(); };
  // the page's show() is renamed on the way in: this suite's own check function is called show
  var __pageShow = function (v) { views.push(v); if (v === 'vPaper') vPaper.classList.remove('hidden'); };
  globalThis.route = function () { routes++; };
  globalThis.setConn = function (st) { conns.push(st); };
  globalThis.setHeaderBall = function () {};
  var ageBox0 = fakeEl(); _ageBox = ageBox0; _ageHold = true;
  P.active = true; P.cards = [{ cardNo: 1 }]; P.called = [5, 9];
  boxes = []; var bodyKids = document.body.children.length;
  (0, eval)(PLAY.slice(p0, p1).replace(/\bshow\("vPaper"\)/g, '__pageShow("vPaper")'));
  showPaperBingo();
  show('the paper notice is the page\'s own view, shown in the normal frame (header, logo, Help), not a cover over the body', _paper === true && boxes.length === 0 && views[views.length - 1] === 'vPaper' && /Tonight you play on paper/.test(vPaper.innerHTML) && document.body.children.length === bodyKids, { views: views, kids: document.body.children.length - bodyKids, html: vPaper.innerHTML.slice(0, 80) });
  show('and the phone has left the room: channel and room socket closed, queue emptied', unsubs === 1 && closes === 1 && ch === null && _room === null && subscribed === false && sendQueue.length === 0);
  show('and it is no longer in a game: off the channel it would never hear the idle that ends one (20 Oct 2026)', P.active === false && P.cards.length === 0 && P.called.length === 0, { active: P.active, cards: P.cards.length });
  show('an age tick already up goes behind it, the hold kept for when the paper comes down', ageBox0._removed === true && _ageBox === null && _ageHold === true);
  show('the header says paper tonight, not "Reconnecting"', conns.indexOf('paper') >= 0, conns);
  showPaperBingo();
  show('a second paper answer shows nothing twice', boxes.length === 0 && unsubs === 1);
  var ageAsked = 0; requireAge18 = function () { ageAsked++; };
  hidePaperBingo();
  show('the Worker stops saying paper: the notice comes down, the page routes back, and the phone rejoins its room', _paper === false && vPaper.classList.contains('hidden') && routes === 1 && connects.length === 1 && connects[0] === 'ROYAL1', { connects: connects, routes: routes });
  show('and an age tick it was holding comes back up', ageAsked === 1, ageAsked);
  hidePaperBingo();
  show('taking it down twice does nothing the second time', connects.length === 1);

  var handler = (0, eval)('(' + PLAY.slice(w1 + '.then('.length, w2 + 1) + ')');
  var calls = [], hops = [], hopped = false;
  showPaperBingo = function () { calls.push('paper'); }; hidePaperBingo = function () { calls.push('nopaper'); };
  ageAnswer = function (d) { calls.push(d && d.age_gate === true ? 'age' : 'age?'); }; ageClear = function () { calls.push('noage'); };
  function hopToApp(u) { hops.push(u); }
  function $(id) { return { textContent: '', classList: { remove: function () {}, add: function () {} } }; }
  P.active = false;
  handler({ exists: true, live: true, format: '', join_code: 'VENUE1', paper_bingo: true, age_gate: true });
  show('a bingo lobby opens in Victoria: the poll shows the paper notice and asks the age, and does not hop', calls.join(',') === 'paper,age' && hops.length === 0, calls);
  calls = [];
  handler({ exists: true, live: false, paper_bingo: false, age_gate: false });
  show('the lobby closes: the poll takes the notice and the tick down', calls.join(',') === 'nopaper,noage' && hops.length === 0, calls);
  calls = [];
  handler({ exists: true, live: true, format: 'trivia', join_code: 'TRIV01', paper_bingo: false, age_gate: false });
  show('trivia opens instead: notice down, tick down, and the phone hops to the trivia room', calls.join(',') === 'nopaper,noage' && hops.length === 1 && /\/app\/trivia\/play\?room=TRIV01$/.test(hops[0]), { calls: calls, hops: hops });
  calls = []; hops = []; hopped = false; P.active = true;
  handler({ exists: true, live: true, format: 'trivia', join_code: 'TRIV01', paper_bingo: true, age_gate: true });
  show('a phone mid-game still obeys the flags, and still does not get yanked into another game', calls.join(',') === 'paper,age' && hops.length === 0, { calls: calls, hops: hops });
  calls = []; P.active = false;
  handler(null);
  show('no answer from the Worker: nothing is shown and nothing is touched', calls.length === 0, calls);
  handler({ exists: false, live: false });
  show('an unknown code (no flags in the answer): nothing is shown, the tick is left alone', calls.indexOf('paper') < 0 && calls.indexOf('age') < 0 && calls.indexOf('noage') < 0, calls);
}

/* ---- part four: a phone that TYPED the code keeps asking /join/info, and acts on the flags each time ---- */
print('play.html: the typed-code lookup acts on both flags every time, and keeps asking after a paper notice');
// Since 20 Oct 2026 the loop is three functions over one timer: lookLater, lookNow and look.
var k0 = PLAY.indexOf('    var tries=0, lookT=0, lastPush=0;'), k1 = k0 < 0 ? -1 : PLAY.indexOf('    look();\n  }', k0);
if (k0 < 0 || k1 < 0) { print('  FAIL the look() loop is not where this test lifts it from'); bad++; }
else {
  var timers = [], cleared = 0, unknowns = 0, rehomes = [], answer = null, calls2 = [], hops2 = [];
  var code = 'VENUE1', VP_LOOK_NOW = null, CODE_RE = /^[ACDEFGHJKMNPQRSTUVWXYZ2345679]{6}$/;
  function setTimeout(fn, ms) { timers.push(ms); return timers.length; }
  function clearTimeout(id) { if (id) cleared++; }
  (0, eval)(PLAY.slice(k0, k1));
  function playingHere() { return false; }
  function playerPost(path, body) { calls2.push(path + ':' + body.code); return Promise.resolve(answer); }
  function unknownCode() { unknowns++; }
  function rehome(c, shown) { rehomes.push(c); }
  function playerAppFor(format) { var f = String(format || ''); return f.indexOf('trivia') === 0 ? '/app/trivia/play' : f.indexOf('musical') === 0 ? '/app/musical/play' : ''; }
  hopToApp = function (u) { hops2.push(u); };
  showPaperBingo = function () { calls.push('paper'); }; hidePaperBingo = function () { calls.push('nopaper'); };
  ageAnswer = function (d) { calls.push(d && d.age_gate === true ? 'age' : 'age?'); }; ageClear = function () { calls.push('noage'); };
  P.room = 'VENUE1';
  calls = []; answer = { exists: true, format: '', paper_bingo: true, age_gate: true, channel: 'VENUE1' };
  look(); drainMicrotasks();
  show('a Victorian bingo lobby: the paper notice goes up, and the phone KEEPS asking (it used to stop for the night here)', calls.join(',') === 'paper' && timers.length === 1 && calls2[0] === '/join/info:VENUE1', { calls: calls, timers: timers });
  calls = []; timers = []; answer = { exists: true, format: '', paper_bingo: false, age_gate: true, channel: 'VENUE1' };
  look(); drainMicrotasks();
  show('an ACT bingo lobby: notice down, age asked, no hop, asks again', calls.join(',') === 'nopaper,age' && hops2.length === 0 && timers.length === 1, calls);
  calls = []; timers = []; answer = { exists: true, format: 'trivia', room_code: 'TRIV01', paper_bingo: false, age_gate: false };
  look(); drainMicrotasks();
  show('trivia opens: notice down, tick down, and the phone hops to the trivia room', calls.join(',') === 'nopaper,noage' && hops2.length === 1 && /\/app\/trivia\/play\?room=TRIV01$/.test(hops2[0]), { calls: calls, hops: hops2 });
  calls = []; timers = []; answer = { exists: false, format: '', collect: null };
  look(); drainMicrotasks();
  show('a code nobody holds: told so, and the asking stops', unknowns === 1 && timers.length === 0, { unknowns: unknowns, timers: timers });

  /* THE NIGHT IS LONGER THAN THIRTY MINUTES (live play audit, 20 Oct 2026): a phone on the paper
     notice is off the channel, so this lookup is its only way out, and it gave up after 225 tries. */
  answer = { exists: true, format: '', paper_bingo: true, paper_reason: 'caller', age_gate: false, channel: 'VENUE1' };
  timers = []; tries = 0;
  for (var i = 0; i < 400; i++) { look(); drainMicrotasks(); }
  show('four hundred lookups into a paper night (over an hour) it is STILL asking, every thirty seconds by then', timers.length === 400 && timers[0] === 8000 && timers[223] === 8000 && timers[399] === 30000, { n: timers.length, first: timers[0], last: timers[399] });
  timers = []; cleared = 0;
  look(); drainMicrotasks(); look(); drainMicrotasks();
  show('ONE timer: a lookup run early replaces the pending one instead of starting a second chain', cleared >= 2 && timers.length === 2, { cleared: cleared, timers: timers.length });
  show('a console announcing its mode brings the lookup forward through lookNow', VP_LOOK_NOW === lookNow);
  var before = calls2.length; lastPush = 0;
  VP_LOOK_NOW(); VP_LOOK_NOW(); VP_LOOK_NOW(); drainMicrotasks();
  show('three mode messages at once ask the Worker once, not three times', calls2.length - before === 1, calls2.length - before);
}

if (bad) throw new Error('age gate: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
