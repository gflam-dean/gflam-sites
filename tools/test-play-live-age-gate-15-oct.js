/* THE AGE TICK AND THE PAPER FLAG, decided by the Worker, for the format that is on.

   Anisimoff Legal, 8 Oct 2026: no minors in Victorian bingo (free or paid), none in ACT housie
   under a permit, none in a Tasmanian raffle or draw. Phones as bingo tickets: not in Victoria
   (s8.4.7B) or Tasmania (authorised bingo); ACT not prohibited, so ACT is back on the phone.
   Dean, 15 Oct 2026: musical bingo is not bingo, so it is never on paper and never asked its age.

   Part one RUNS the real handlePlayLive and handleJoinInfo out of the shipped game Worker on the
   rig (tools/rig-game-worker.js), against the fake database. Part two lifts the age-tick code out
   of the shipped play.html and RUNS it: the ticket is held until the tick, remembered for the
   night, and released on its own when the Worker does not answer (fail open).

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
  print('/play/live on a quiet night (broadcast bingo: no session row, format is bingo)');
  var r = await live('VIC');
  show('VIC: age_gate true, paper_bingo true, not live', r.age_gate === true && r.paper_bingo === true && r.live === false && r.exists === true, JSON.stringify(r));
  r = await live('ACT');
  show('ACT: age_gate true, paper_bingo FALSE (phones are back on)', r.age_gate === true && r.paper_bingo === false, JSON.stringify(r));
  r = await live('TAS');
  show('TAS: bingo is paper, and bingo does not ask the age there', r.age_gate === false && r.paper_bingo === true, JSON.stringify(r));
  r = await live('SA');
  show('SA: paper as before, no age tick', r.age_gate === false && r.paper_bingo === true, JSON.stringify(r));
  r = await live('NSW');
  show('NSW: neither', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  r = await live('QLD');
  show('QLD: neither', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r));
  r = await live('VICOFF');
  show('a suspended Victorian venue still answers live:false, suspended:true, and does not throw', r.live === false && r.suspended === true, JSON.stringify(r));
  r = await live('NOWHERE');
  show('an unknown code is exists:false', r.exists === false, JSON.stringify(r));

  print('/play/live on a live night: the format that is on decides');
  night('VIC', null, 'lobby', 'trivia');
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
  show('VIC bingo: age_gate true and paper_bingo true', r.age_gate === true && r.paper_bingo === true, JSON.stringify(r).slice(0, 160));
  r = await info('VENUE-ACT');
  show('ACT bingo: age_gate true, paper_bingo false', r.age_gate === true && r.paper_bingo === false, JSON.stringify(r).slice(0, 160));
  r = await info('VENUE-TAS');
  show('TAS bingo: paper, no age tick', r.age_gate === false && r.paper_bingo === true, JSON.stringify(r).slice(0, 160));
  r = await info('VENUE-NSW');
  show('NSW bingo: neither', r.age_gate === false && r.paper_bingo === false, JSON.stringify(r).slice(0, 160));
  var mu = await info(night('VIC', 'musical'));
  show('VIC musical: neither, and the format is musical', mu.format === 'musical' && mu.age_gate === false && mu.paper_bingo === false, JSON.stringify(mu).slice(0, 160));
  var tr = await info(night('VIC', 'trivia'));
  show('VIC trivia: neither', tr.format === 'trivia' && tr.age_gate === false && tr.paper_bingo === false, JSON.stringify(tr).slice(0, 160));
  clearNights();
  var realFetch = fetch;
  fetch = async function (u, o) { if (/vp_venues\?id=eq/.test(String(u))) return { ok: false, status: 503, json: async function () { return {}; }, text: async function () { return 'down'; } }; return realFetch(u, o); };
  r = await info('VENUE-VIC');
  fetch = realFetch;
  show('a database that cannot answer the venue row: no age tick, no paper, no throw (fails open)', r && r.age_gate === false && r.paper_bingo === false && !!r.collect, JSON.stringify(r).slice(0, 160));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }

/* ---- part two: the phone page holds its ticket until the tick ---- */
print('play.html: the age tick holds the ticket, remembers the night, and fails open');
var PLAY = readFile('venueplay/play.html');
var a0 = PLAY.indexOf('  var _ageHold=false'), a1 = PLAY.indexOf('  var PATTERN_NAMES', a0);
if (a0 < 0 || a1 < 0) { print('  FAIL the age-tick block is not where this test lifts it from'); bad++; }
else {
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
  (0, eval)(PLAY.slice(a0, a1));
  function tick() { var box = boxes[boxes.length - 1]; var chk = box.querySelector('#age18Chk'); chk.checked = true; box.querySelector('#age18Chk').listeners.change[0](); box.querySelector('#age18Btn').listeners.click[0](); }

  // a first-time player at a Victorian venue: the answer lands, then they type a name and tap Join
  ageAsk();
  ageAnswer({ age_gate: true });
  show('age_gate:true puts up the tick before anyone has joined', boxes.length === 1 && /18 or over/.test(boxes[0].innerHTML) && _ageHold === true, boxes[0] && boxes[0].innerHTML.slice(0, 80));
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
  // the page cannot build the box
  delete store['vpAge18:ROYAL1']; sent = []; _agePendingJoin = false; _ageHold = false; _ageBox = null;
  var realCreate = document.createElement; document.createElement = function () { throw new Error('no DOM'); };
  ageAsk(); ageAnswer({ age_gate: true }); sendJoin();
  document.createElement = realCreate;
  show('FAIL OPEN: a page that cannot show the tick does not hold the ticket', sent.length === 1 && _ageHold === false, sent);
  show('the join is always the same five-field announcement the console seats', sent.every(function (m) { return m.t === 'join' && 'pid' in m && 'name' in m && 'cards' in m && 'did' in m; }));
}

if (bad) throw new Error('age gate: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
