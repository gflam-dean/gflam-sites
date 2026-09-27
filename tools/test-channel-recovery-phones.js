/* THE PHONES GET THEIR CHANNEL BACK, AND A CHANNEL THEY HUNG UP IS NOT NEWS.

   Audit, 27 Sep 2026:
     - the bingo phone (venueplay/play.html) said Reconnecting after a CLOSED and never rejoined,
       so every answer, join and BINGO after that waited in sendQueue for ever;
     - Leave and a code hop hung up the old channel, whose CLOSED arrived a moment later and
       painted "Reconnecting" over the enter-code screen, or over the new channel;
     - the trivia phone ignored CLOSED altogether and never cleared `subscribed`, so it said
       Connected and wrote answers into a dead channel;
     - /play?room=ABC234% threw out of decodeURIComponent and stopped the phone's startup.

   This lifts the REAL functions out of the shipped pages (connect, onChannelStatus, send,
   wireOut, flushQueue, setConn, rehome, finishLeaving) and runs them with the REAL
   /app/vp-channel.js against a fake client that keeps the library's rules
   (tools/rig-channel.js), and it runs each phone's real ?room= reader on a stray "%".

   Run from the repo root:  jsc tools/test-channel-recovery-phones.js
*/
load('tools/rig-channel.js');
var check = RIG.check;
var helper = RIG.loadHelper({ console: { log: function () {} } });

function take(html, names, file) {
  var out = [], missing = [];
  names.forEach(function (n) { var s = RIG.lift(html, n); if (s) out.push(s); else missing.push(n); });
  if (missing.length) print('  (' + file + ' has no ' + missing.join(', ') + ')');
  return { src: out.join('\n'), missing: missing };
}
function ans(c) { return c.sent.filter(function (m) { return m.payload && m.payload.t === 'ans'; }).length; }
function joinsSent(c) { return c.sent.filter(function (m) { return m.payload && m.payload.t === 'join'; }).length; }

/* ================= the bingo phone ================= */
print('\nthe bingo phone (play.html)');
var PLAY = readFile('venueplay/play.html');
check('play.html loads /app/vp-channel.js in a real script tag', RIG.loadsScript(PLAY, 'vp-channel.js'));
var bp = take(PLAY, ['connect', 'onChannelStatus', 'send', 'wireOut', 'flushQueue', 'setConn', 'rehome', 'finishLeaving'], 'play.html');
check('the real bingo phone functions came out of play.html', bp.missing.length === 0, bp.missing);

function bingoPhone() {
  var world = RIG.makeClient(), dom = RIG.makeDom(), conns = [], store = { 'vp-name-ACDEFG': 'Sam' }, views = [];
  var ls = { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
  var win = { VPChannel: helper, location: { replace: function () {} } };
  var sandbox = {
    client: world.client, window: win, VPChannel: helper, $: dom.$, document: dom.document,
    sessionStorage: ls, localStorage: ls, show: function (v) { views.push(v); },
    loadPid: function (r) { return store['vp-pid-' + r] || ''; }, savePid: function (r, v) { store['vp-pid-' + r] = v; },
    loadName: function (r) { return store['vp-name-' + r] || ''; }, saveName: function (r, v) { store['vp-name-' + r] = v; },
    loadWin: function () { return null; }, loadStage: function () { return null; }, randId: function () { return 'pid1'; },
    route: function () {}, loadJoinInfo: function () {}, renderPicker: function () {}, onMsg: function () {},
    __conns: conns
  };
  var names = Object.keys(sandbox);
  var body = 'var P = { numCards: 2 }, ch = null, subscribed = false, sendQueue = [], _room = null, _useRoom = false, _roomTried = false, _keyReady = null, _signChain = Promise.resolve();\n' +
    bp.src + '\n' +
    'var _realSetConn = setConn; setConn = function(s){ __conns.push(s); try{ _realSetConn(s); }catch(e){} };\n' +
    'return { P: function(){ return P; }, ch: function(){ return ch; }, sub: function(){ return subscribed; }, q: function(){ return sendQueue.length; },\n' +
    '  connect: connect, send: send, rehome: rehome, leave: finishLeaving };';
  var page = new Function(names.join(','), body).apply(null, names.map(function (n) { return sandbox[n]; }));
  return { world: world, page: page, conns: conns, views: views, dom: dom };
}

if (!bp.missing.length) {
  var b = bingoPhone(), bw = b.world;
  b.page.connect('ACDEFG');
  RIG.advance(200);
  check('CONTROL: it joins, and a returning player re-announces', bw.joined().length === 1 && b.page.sub() === true && joinsSent(bw.joined()[0]) === 1);

  print('  the server closes the channel');
  bw.drop(bw.joined()[0], 'CLOSED');
  check('it stops writing into it and says Reconnecting', b.page.sub() === false && b.conns[b.conns.length - 1] === 'reconnecting', b.conns.slice(-1));
  b.page.send({ t: 'ans', i: 1 });
  check('an answer tapped now is held, not lost', b.page.q() === 1, b.page.q());
  RIG.advance(5000);
  var nb = bw.live('vp-ACDEFG');
  check('A NEW CHANNEL IS JOINED. The phone used to sit on Reconnecting for the rest of the night', nb.length === 1 && nb[0].state === 'joined' && b.page.sub() === true, nb.length);
  check('the held answer reaches the host on it, and the player is re-announced', nb.length === 1 && ans(nb[0]) === 1 && joinsSent(nb[0]) === 1 && b.page.q() === 0, nb.length ? [ans(nb[0]), joinsSent(nb[0])] : null);

  try { b.page.leave(); } catch (e) {}
  RIG.advance(100);

  print('  a code hop (a fresh phone)');
  var hb = bingoPhone(), hw = hb.world;
  hb.page.connect('ACDEFG');
  RIG.advance(200);
  var before = hb.conns.length;
  hb.page.rehome('HGFEDC', 'ACDEFG');
  RIG.advance(500);
  var hop = hb.conns.slice(before);
  check('THE OLD CHANNEL\'S GOODBYE IS NOT NEWS: no Reconnecting while moving to the new code', hop.indexOf('reconnecting') < 0, hop);
  check('it is on exactly one channel, the new one, and connected', hw.live().length === 1 && hw.live()[0].name === 'vp-HGFEDC' && hw.live()[0].state === 'joined' && hb.page.sub() === true, hw.live().map(function (c) { return c.name; }));

  print('  Leave (a fresh phone)');
  var lb = bingoPhone(), lw = lb.world;
  lb.page.connect('ACDEFG');
  RIG.advance(200);
  before = lb.conns.length;
  var joinsBefore = lw.joins;
  lb.page.leave();
  RIG.advance(60 * 1000);
  var after = lb.conns.slice(before);
  check('LEAVE IS QUIET: the enter-code screen is not told Reconnecting afterwards', after.indexOf('reconnecting') < 0, after);
  check('and nothing rejoins the channel it left', lw.live().length === 0 && lw.joins === joinsBefore, [lw.live().length, lw.joins - joinsBefore]);
}

/* ================= the trivia phone ================= */
print('\nthe trivia phone (app/trivia/play.html)');
var TPLAY = readFile('venueplay/app/trivia/play.html');
check('trivia/play.html loads /app/vp-channel.js in a real script tag', RIG.loadsScript(TPLAY, 'vp-channel.js'));
var tp = take(TPLAY, ['connect', 'send', 'flushQueue'], 'trivia/play.html');
var tpStatus = RIG.lift(TPLAY, 'onChannelStatus');     // named since 27 Sep 2026; before that it lived inside connect
check('the real trivia phone functions came out of trivia/play.html', tp.missing.length === 0, tp.missing);

function triviaPhone() {
  var world = RIG.makeClient(), dom = RIG.makeDom(), views = [];
  var sandbox = {
    client: world.client, window: { VPChannel: helper }, VPChannel: helper, $: dom.$, document: dom.document,
    loadPid: function () { return 'pid1'; }, randId: function () { return 'pid1'; }, savePid: function () {},
    loadToken: function () { return 'tok'; }, loadSess: function () { return 's1'; }, loadName: function () { return 'Quizzers'; },
    rebuildFromSnapshot: function () {}, showWait: function () {}, loadJoinInfo: function () {}, show: function (v) { views.push(v); },
    onMsg: function () {}
  };
  var names = Object.keys(sandbox);
  var body = 'var P = {}, ch = null, subscribed = false, sendQueue = [];\n' + tp.src + '\n' + (tpStatus || '') + '\n' +
    'return { ch: function(){ return ch; }, sub: function(){ return subscribed; }, q: function(){ return sendQueue.length; }, connect: connect, send: send };';
  var page = new Function(names.join(','), body).apply(null, names.map(function (n) { return sandbox[n]; }));
  return { world: world, page: page, dom: dom, status: function () { return dom.el('statusText').textContent; } };
}

if (!tp.missing.length) {
  var t = triviaPhone(), tw = t.world;
  t.page.connect('ACDEFG');
  RIG.advance(200);
  check('CONTROL: it joins and says Connected', tw.joined().length === 1 && t.page.sub() === true && t.status() === 'Connected', t.status());

  print('  the server closes the channel');
  tw.drop(tw.joined()[0], 'CLOSED');
  check('CLOSED IS A DROP: it stops believing it is connected, and says Reconnecting', t.page.sub() === false && t.status() === 'Reconnecting', [t.page.sub(), t.status()]);
  var dead = tw.channels[0];
  try { t.page.send({ t: 'ans', i: 2 }); } catch (e) {}
  check('an answer tapped now is held, not written into the dead channel', t.page.q() === 1 && ans(dead) === 0, [t.page.q(), ans(dead)]);
  RIG.advance(5000);
  var nt = tw.live('vp-ACDEFG');
  check('A NEW CHANNEL IS JOINED, and it says Connected again', nt.length === 1 && nt[0].state === 'joined' && t.page.sub() === true && t.status() === 'Connected', [nt.length, t.status()]);
  check('the held answer reaches the host on it', nt.length === 1 && ans(nt[0]) === 1 && t.page.q() === 0, nt.length ? ans(nt[0]) : null);

  try { t.page.ch().unsubscribe(); } catch (e) {}
  RIG.advance(100);

  print('  typing another code (a fresh phone)');
  var t2 = triviaPhone(), tw2 = t2.world;
  t2.page.connect('ACDEFG');
  RIG.advance(200);
  t2.page.connect('HGFEDC');
  RIG.advance(500);
  check('it moves: one channel, the new one, and the old one\'s goodbye did not repaint Reconnecting',
        tw2.live().length === 1 && tw2.live()[0].name === 'vp-HGFEDC' && t2.status() === 'Connected', [tw2.live().map(function (c) { return c.name; }), t2.status()]);
}

/* ================= a stray % in ?room= ================= */
print('\na stray "%" in the address');
[['venueplay/play.html', 'bingo'], ['venueplay/app/trivia/play.html', 'trivia'], ['venueplay/app/musical/play.html', 'musical']].forEach(function (p) {
  var html = readFile(p[0]);
  var a = html.indexOf('var m=/[?&]room=([^&]+)/.exec(window.location.search);');
  var z = html.indexOf('if(room && CODE_RE.test(room))', a);
  if (a < 0 || z < 0) { check(p[1] + ': the ?room= reader is where it was', false); return; }
  var read = new Function('window', 'venueSlugFromURL', html.slice(a, z) + '\nreturn room;');
  function run(search) { return read({ location: { search: search } }, function () { return ''; }); }
  var threw = null, got;
  try { got = run('?room=ACD234%'); } catch (e) { threw = String(e); }
  check(p[1] + ' phone: /play?room=ACD234% does not throw, so the phone still starts', threw === null, threw);
  check(p[1] + ' phone: and a good code still reads as itself', run('?room=acd234') === 'ACD234' && run('?room=ACD%32%33%34') === 'ACD234');
});

RIG.done('channel recovery, phones');
