/* A PLAYER'S SEAT CANNOT BE TAKEN WITH THE DEVICE ID THE PHONE USED TO BROADCAST (security review 13 Nov 2026, A1;
   the 5 Nov 2026 review's F1), run through the REAL game Worker (tools/rig-game-worker.js) with a REAL SHA-256.

   The finding: every musical bingo, bingo and trivia phone put its device id in its {t:"join"} room message, and POST
   /join with that id as pid re-issued a fresh token onto the victim's row. The attacker held the victim's card and its
   win; the victim's own token died mid-game. The PoC it came from: ~/venue-enrich/reports/security-13nov/poc/
   poc-A1-device-id-takeover.js (4 of 5 FAIL on main and Tuesday).

     1. /join naming a seat that is not yours (no token of that seat, seat older than the race grace): a seat of your
        own, with no device id; the real seat, its token and its card untouched
     2. the real phone gets back onto its OWN seat with any token it holds (header or body.tokens), as before
     3. two joins from one phone racing (migration 192): the second is still taken onto the first's seat (grace)
     4. the unique-index path (409) only takes a seat back with proof
     5. the room hears a public id: the three phone pages and the Worker give the same answer, it is never the device
        id, the pages never put deviceId() in a room message, and the seat and deal routes take the public id (and a
        raw id from an older cached console) and record the real device id on the ticket

   Run from the repo root:  jsc tools/test-seat-takeover.js */
load('tools/rig-game-worker.js');

/* ---- a real SHA-256 for this suite (the rig's answers zeros, which would make every token prove every seat) ---- */
var SHA_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
  0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,
  0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,
  0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,
  0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function sha256Bytes(bytes) {
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var l = bytes.length, withPad = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(withPad), i;
  m.set(bytes); m[l] = 0x80; var bits = l * 8;
  for (i = 0; i < 4; i++) m[withPad - 1 - i] = (bits >>> (8 * i)) & 255;
  m[withPad - 5] = Math.floor(bits / 4294967296) & 255;
  var w = new Array(64);
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  for (var o = 0; o < withPad; o += 64) {
    for (i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
    for (i = 16; i < 64; i++) { var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = new Uint8Array(32);
  for (i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = (H[i] >>> 16) & 255; out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255; }
  return out;
}
TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
crypto.subtle.digest = async function (alg, data) { return sha256Bytes(new Uint8Array(data)).buffer; };

var finished = false;
var SID = 'a1000000-0000-4000-8000-000000000001', GID = 'a1000000-0000-4000-8000-000000000002';
function req(ip, token) { return { url: 'https://w/join', headers: { get: function (k) {
  k = k.toLowerCase(); if (k === 'cf-connecting-ip') return ip; if (k === 'user-agent') return 'UA-' + ip; if (k === 'x-player-token') return token || ''; return ''; } } }; }
async function call(fn, body, r) { BODY = body; try { return await fn(r, ENV, json); } catch (e) { return { status: e.status || 500, body: { error: String(e.message) } }; } }
function world() {
  DB = {
    vp_sessions: [{ id: SID, venue_id: VENUE, join_code: 'ACDEFG', status: 'running', lobby_format: 'musical_bingo', created_at: new Date(NOWMS).toISOString() }],
    vp_venues: [{ id: VENUE, status: 'active', slug: 'test-pub', group_id: null }],
    vp_venue_settings: [{ venue_id: VENUE }],
    vp_players: [], vp_games: [], vp_cards: [], vp_claims: [], vp_session_events: [],
  };
}
function ago(ms) { return new Date(NOWMS - ms).toISOString(); }
async function whoIs(tok) { return await verifyPlayerTokenRaw(tok, ENV).catch(function () { return null; }); }

(async function () {
  var sane = await sha256Hex('abc');
  show('the suite\'s SHA-256 is the real one (abc)', sane === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', sane);

  print('1. a seat that is not yours: you get a seat of your own, theirs is untouched');
  world();
  var VICTIM_DID = 'victimDeviceId0001';
  var v = await call(handleJoin, { code: 'ACDEFG', name: 'Sam', pid: VICTIM_DID }, req('1.1.1.1'));
  show('the victim joins', v.status === 200 && !!v.body.token, JSON.stringify(v.status));
  var victimRow = DB.vp_players[0];
  victimRow.kicked = false; victimRow.joined_at = ago(5 * 60000);   // joined five minutes ago: past the race grace
  DB.vp_games.push({ id: GID, session_id: SID, status: 'running', format: 'musical_bingo' });
  DB.vp_cards.push({ id: 'card-1', game_id: GID, player_id: victimRow.id, card_no: 7, cells: [] });
  var a = await call(handleJoin, { code: 'ACDEFG', name: 'Sam', pid: VICTIM_DID }, req('9.9.9.9'));
  show('the attacker is answered (a seat of their own)', a.status === 200 && !!a.body.token, JSON.stringify(a));
  show('the attacker gets a NEW row of their own (not the victim\'s)', DB.vp_players.length === 2, 'player rows: ' + DB.vp_players.length);
  var who = await whoIs(a.body.token);
  show('the attacker\'s token does not resolve to the victim\'s player id', !!who && who.id !== victimRow.id, who ? who.id : 'null');
  show('the new row carries no device id (the one-phone index and the bill are not the victim\'s)', DB.vp_players[1] && DB.vp_players[1].device_id == null, DB.vp_players[1]);
  var still = await whoIs(v.body.token);
  show('the victim\'s own token still works', !!still && still.id === victimRow.id);
  var card = await sbGet(ENV, 'vp_cards', 'game_id=eq.' + GID + '&player_id=eq.' + (who && who.id));
  show('the attacker cannot reach the victim\'s card', !(card && card.length));
  var wrong = await call(handleJoin, { code: 'ACDEFG', name: 'Sam', pid: VICTIM_DID, tokens: ['ab'.repeat(32)] }, req('9.9.9.9', 'cd'.repeat(32)));
  var who2 = await whoIs(wrong.body.token);
  show('a made-up token proves nothing either', wrong.status === 200 && !!who2 && who2.id !== victimRow.id && !!(await whoIs(v.body.token)));

  print('2. the real phone gets back onto its own seat with a token it holds');
  var back = await call(handleJoin, { code: 'ACDEFG', name: 'Sam', pid: VICTIM_DID, tokens: [v.body.token] }, req('1.1.1.1'));
  var me = await whoIs(back.body.token);
  show('body.tokens (the other pages\' copies): the same row', back.status === 200 && !!me && me.id === victimRow.id, me ? me.id : 'null');
  var back2 = await call(handleJoin, { code: 'ACDEFG', name: 'Sam', pid: VICTIM_DID }, req('1.1.1.1', back.body.token));
  var me2 = await whoIs(back2.body.token);
  show('X-Player-Token: the same row, a fresh token', back2.status === 200 && !!me2 && me2.id === victimRow.id && back2.body.token !== back.body.token);
  show('no extra row for the real phone', DB.vp_players.filter(function (p) { return p.device_id === VICTIM_DID; }).length === 1);

  print('3. two joins from one phone at once (migration 192): the second is taken onto the first\'s seat');
  world();
  var f1 = await call(handleJoin, { code: 'ACDEFG', name: 'Kim', pid: 'raceDevice000001' }, req('2.2.2.2'));
  DB.vp_players[0].kicked = false;   // the column's database default (the rig's fake table has no defaults)
  var f2 = await call(handleJoin, { code: 'ACDEFG', name: 'Kim', pid: 'raceDevice000001' }, req('2.2.2.2'));
  var w1 = await whoIs(f2.body.token);
  show('one row, the second join holds it', DB.vp_players.length === 1 && !!w1 && w1.id === DB.vp_players[0].id, DB.vp_players.length);

  print('4. the unique-index path (409) takes a seat back only with proof');
  world();
  var o1 = await call(handleJoin, { code: 'ACDEFG', name: 'Lee', pid: 'indexDevice00001' }, req('3.3.3.3'));
  DB.vp_players[0].kicked = false; DB.vp_players[0].joined_at = ago(10 * 60000);
  /* The read that finds the phone's seat misses (a stale read), and the insert hits the unique index. */
  var realSbGet = sbGet, realSbInsert = sbInsert;
  sbGet = async function (env, table, qs) {
    if (table === 'vp_players' && String(qs).indexOf('device_id=eq.indexDevice00001&kicked=eq.false') !== -1) return [];   // the first lookup only
    return realSbGet.apply(this, arguments);
  };
  sbInsert = async function (env, table, row) {
    if (table === 'vp_players' && row.device_id === 'indexDevice00001') { var e = new Error('duplicate'); e.status = 409; throw e; }
    return realSbInsert.apply(this, arguments);
  };
  var o2 = await call(handleJoin, { code: 'ACDEFG', name: 'Lee', pid: 'indexDevice00001' }, req('4.4.4.4'));
  show('no proof: refused, the seat keeps its token', o2.status === 409 && !!(await whoIs(o1.body.token)), JSON.stringify(o2));
  var o3 = await call(handleJoin, { code: 'ACDEFG', name: 'Lee', pid: 'indexDevice00001', tokens: [o1.body.token] }, req('3.3.3.3'));
  var w3 = await whoIs(o3.body.token);
  show('with the seat\'s token: taken back onto it', o3.status === 200 && !!w3 && w3.id === DB.vp_players[0].id, JSON.stringify(o3.status));
  sbGet = realSbGet; sbInsert = realSbInsert;

  print('5. the room hears a public id, the same everywhere, never the device id');
  var pubW = await publicDeviceId(VICTIM_DID);
  var gameSrcAll = readFile('venueplay-backend/worker/venueplay-game.js');
  show('the Worker\'s public id is "p" and 31 hex, not the device id', /^p[0-9a-f]{31}$/.test(pubW) && pubW.indexOf(VICTIM_DID) === -1, pubW);
  var BLOCK_AT = '  /* THE ROOM HEARS A PUBLIC ID, NEVER THE DEVICE ID';
  var pages = ['venueplay/play.html', 'venueplay/app/musical/play.html', 'venueplay/app/trivia/play.html'], blocks = [];
  for (var i = 0; i < pages.length; i++) {
    var src = readFile(pages[i]), at = src.indexOf(BLOCK_AT), endMark = '  function vpPublicId(){ return "p"+vpPubSha("vp-pub-v1:"+deviceId()).slice(0,31); }\n', end = src.indexOf(endMark, at);
    var blk = (at >= 0 && end > at) ? src.slice(at, end + endMark.length) : '';
    blocks.push(blk);
    show(pages[i] + ': the public-id block is there', !!blk);
    var fn = new Function('deviceId', 'localStorage', blk + '\nreturn { pub: vpPublicId, held: vpHeldTokens, sha: vpPubSha };')(
      function () { return VICTIM_DID; },
      { getItem: function (k) { return { 'vp-mtoken-ACDEFG': 'ab'.repeat(32), 'vp-token-ACDEFG': 'ab'.repeat(32), 'vp-ttoken-ACDEFG': 'not-a-token' }[k] || null; } });
    var pubP = fn.pub();
    show(pages[i] + ': vpPublicId gives the Worker\'s answer', pubP === pubW, pubP + ' vs ' + pubW);
    show(pages[i] + ': its SHA-256 is the real one (abc, and a two-block input)', fn.sha('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' &&
      fn.sha('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    var wsha = gameSrcAll.slice(gameSrcAll.indexOf('function vpPubSha(s){'), gameSrcAll.indexOf('\n}\n', gameSrcAll.indexOf('function vpPubSha(s){')) + 3);
    var psha = src.slice(src.indexOf('  function vpPubSha(s){'), src.indexOf('\n  }\n', src.indexOf('  function vpPubSha(s){')) + 5).replace(/\n  /g, '\n').replace(/^  /, '');
    show(pages[i] + ': its vpPubSha is the game Worker\'s, word for word', !!wsha && wsha === psha);
    var held = fn.held('ACDEFG');
    show(pages[i] + ': vpHeldTokens sends each real token once, nothing else', held.length === 1 && held[0] === 'ab'.repeat(32), JSON.stringify(held));
    var noDid = src.replace(/\/\*[\s\S]*?\*\//g, '');
    show(pages[i] + ': no room message carries deviceId()', !/did\s*:\s*deviceId\(\)/.test(noDid) && !/send\(\{[^}]*deviceId\(\)/.test(noDid));
    var joins = noDid.match(/playerPost\("\/join",\s*(\{[^}]*\}|body)/g) || [], bodyLit = noDid.match(/var body=\{ code:P\.room, name:P\.name, pid:deviceId\(\)[^}]*\}/g) || [];
    show(pages[i] + ': every /join sends the tokens it holds', joins.length > 0 && joins.every(function (j) { return /tokens\s*:\s*vpHeldTokens\(/.test(j) || /body$/.test(j); }) &&
      bodyLit.every(function (j) { return /tokens:vpHeldTokens\(P\.room\)/.test(j); }) && (!joins.some(function (j) { return /body$/.test(j); }) || bodyLit.length > 0), JSON.stringify(joins.concat(bodyLit)).slice(0, 300));
  }
  show('the block is word for word the same in the three pages', blocks[0] && blocks[0] === blocks[1] && blocks[1] === blocks[2]);

  print('   the seat and deal routes take the public id and record the real device id');
  world();
  var p1 = await call(handleJoin, { code: 'ACDEFG', name: 'Ana', pid: 'seatDevice000001' }, req('5.5.5.5'));
  var p2 = await call(handleJoin, { code: 'ACDEFG', name: 'Bo', pid: 'seatDevice000002' }, req('5.5.5.6'));
  DB.vp_players.forEach(function (p) { p.kicked = false; });
  var pubA = await publicDeviceId('seatDevice000001');
  var rows = await sessionSeatRows(ENV, SID, [pubA, 'seatDevice000002', 'pnot0000000000000000000000000000']);
  show('a public id and an older console\'s raw id both find their seat; a stranger finds none',
    rows.length === 2 && rows.some(function (r) { return r.asked === pubA && r.device_id === 'seatDevice000001'; }) && rows.some(function (r) { return r.asked === 'seatDevice000002'; }), JSON.stringify(rows));
  requireStaff = async function () { return { id: 'staff-1', role: 'host' }; };
  verifyHostJwt = async function () { return 'host-1'; };
  var seat = await call(handleBingoSeat, { session_id: SID, dids: [pubA, 'pnot0000000000000000000000000000'] }, req('6.6.6.6'));
  show('/host/bingo/seat answers in the console\'s own words', seat.status === 200 && JSON.stringify(seat.body.seated) === JSON.stringify([pubA]), JSON.stringify(seat.body));
  show('...and tells the signed-in console each seated phone\'s deal key (its device id), by the id it asked with',
    seat.body.keys && seat.body.keys[pubA] === 'seatDevice000001' && Object.keys(seat.body.keys).length === 1, JSON.stringify(seat.body.keys));
  var gameSrc = readFile('venueplay-backend/worker/venueplay-game.js');
  var IDX = readFile('venueplay/app/index.html');
  show('the bingo console deals by the deal key, keeps it off the room, and forgets it when a phone\'s id changes',
    (IDX.match(/did:p\.dealKey\|\|p\.did\|\|null/g) || []).length === 2 && /q\.dealKey=j\.keys\[q\.did\]/.test(IDX) && /_p\.did=m\.did; _p\.dealKey=null;/.test(IDX) &&
    !/send\(\{[^}]*dealKey/.test(IDX));
  show('the regulated deal (VP-DRAW) is unchanged: it still seats by the device id the console sends',
    gameSrc.indexOf("const known = new Set(rows.map((r) => r.device_id));") > 0);
  var runAt = gameSrc.indexOf('async function findRunningGame('), runSrc = gameSrc.slice(runAt, gameSrc.indexOf('\nasync function ', runAt + 10));
  show('a console picking up a running quiz is told public ids, never a phone\'s device id', /dev\[p\.id\] = p\.device_id \? await publicDeviceId\(p\.device_id\)/.test(runSrc));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('seat takeover: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
