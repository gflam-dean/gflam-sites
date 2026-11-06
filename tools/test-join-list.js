/* "GET A HEADS UP BY EMAIL": POST /join/list, RUN on the REAL game Worker (Dean, 6 Nov 2026, round 5).

   tools/rig-game-worker.js loads the shipped venueplay-game.js over a fake PostgREST. This posts to the real
   handleJoinList and asserts what lands in the database:
     - a phone that played at THIS venue (its token's player row) gets the opt-in on its own player row, where the
       venue's export reads it, with the consent version
     - a phone that never played here is kept in vp_captures as source "nogame", during_game false (stored, never
       mailed: v_vp_player_optins leaves those out), with the network's hash
     - the same gate as every opt-in: nothing kept when the venue does not collect email; the offers tick only when the
       venue collects it; a token from ANOTHER venue's night is not trusted
     - a bad email, a missing code and an unknown venue are refused; a phone is limited per hour, a network per minute
     - before migration 174 the consent version is dropped and the sign-up still kept
     - the trivia phone switches the sign-up on only where the venue collects email, and sends its old token with it

   Run from the repo root:  jsc tools/test-join-list.js
*/
load('tools/rig-game-worker.js');
sha256Hex = async function (s) { return 'h-' + s; };
var V2 = '33333333-3333-4333-8333-333333333333', S1 = '44444444-4444-4444-8444-444444444444', S2 = '55555555-5555-4555-8555-555555555555';
var P1 = '66666666-6666-4666-8666-666666666666';
function reset(cfg) {
  DB = {};
  DB.vp_venues = [{ id: VENUE, slug: 'tugun-bowls', name: 'Tugun Bowls Club' }, { id: V2, slug: 'other', name: 'Other' }];
  DB.vp_sessions = [{ id: S1, venue_id: VENUE, join_code: 'ACDE23', status: 'finished', created_at: '2026-11-06T04:00:00Z' },
                    { id: S2, venue_id: V2, join_code: 'QQQQ22', status: 'finished', created_at: '2026-11-06T04:00:00Z' }];
  DB.vp_venue_settings = [Object.assign({ venue_id: VENUE }, cfg || { collect_first_name: true, collect_email: true, collect_marketing_optin: true })];
  DB.vp_players = [{ id: P1, session_id: S1, token_hash: 'h-tok-here', display_name: 'Sam', kicked: false },
                   { id: 'p-other', session_id: S2, token_hash: 'h-tok-other', display_name: 'X', kicked: false }];
  DB.vp_captures = [];
}
var IP = 1;
function post(body, token, ip) {
  BODY = body;
  var h = { 'X-Player-Token': token || '', 'cf-connecting-ip': ip || ('10.0.0.' + (IP++)) };
  return handleJoinList({ url: 'https://w/join/list', headers: { get: function (k) { return h[k] || h[k.toLowerCase()] || ''; } } }, ENV, json)
    .catch(function (e) { return { status: e.status || 500, body: { error: e.message } }; });
}
var GOOD = { code: 'ACDE23', email: ' Sam@Example.com ', marketing_optin: true, consent_version: 'vpc-2-6nov', pid: 'pid-aaaaaaaa' };

(async function () {
  print('A REGULAR (played here before)');
  reset();
  var r = await post(GOOD, 'tok-here');
  var p = DB.vp_players[0];
  show('stored on their own player row', r.status === 200 && r.body.stored === true && p.email === 'sam@example.com', JSON.stringify(r) + ' ' + JSON.stringify(p));
  show('with the offers tick, its time and the consent version', p.marketing_optin === true && !!p.marketing_optin_at && p.consent_version === 'vpc-2-6nov', JSON.stringify(p));
  show('and nothing in vp_captures', DB.vp_captures.length === 0);

  print('A NEW FACE (never played here)');
  reset();
  r = await post(Object.assign({}, GOOD, { pid: 'pid-bbbbbbbb' }), '');
  var c = DB.vp_captures[0];
  show('kept in vp_captures, source nogame, during_game false (never mailed), the network hashed', r.body.stored === true && c && c.venue_id === VENUE && c.source === 'nogame' && c.during_game === false && !!c.source_ip_hash && c.email === 'sam@example.com', JSON.stringify(c));
  reset();
  r = await post(Object.assign({}, GOOD, { pid: 'pid-cccccccc' }), 'tok-other');
  show('a token from another venue\'s night is not trusted: that player row is untouched', DB.vp_players[1].email === undefined && DB.vp_captures.length === 1, JSON.stringify(DB.vp_players[1]));

  print('THE SAME GATE AS EVERY OPT-IN');
  reset({ collect_first_name: true, collect_email: false, collect_marketing_optin: true });
  r = await post(Object.assign({}, GOOD, { pid: 'pid-dddddddd' }), 'tok-here');
  show('a venue that does not collect email: nothing kept', r.body.stored === false && DB.vp_players[0].email === undefined && DB.vp_captures.length === 0, JSON.stringify(r));
  reset({ collect_first_name: true, collect_email: true, collect_marketing_optin: false });
  r = await post(Object.assign({}, GOOD, { pid: 'pid-eeeeeeee' }), 'tok-here');
  show('a venue that does not collect the offers tick: the email, never the tick', DB.vp_players[0].email === 'sam@example.com' && DB.vp_players[0].marketing_optin !== true, JSON.stringify(DB.vp_players[0]));
  reset();
  r = await post(Object.assign({}, GOOD, { marketing_optin: false, pid: 'pid-ffffffff' }), 'tok-here');
  show('no tick: the email only', DB.vp_players[0].email === 'sam@example.com' && DB.vp_players[0].marketing_optin !== true);

  print('REFUSED');
  reset();
  r = await post(Object.assign({}, GOOD, { email: 'not an email', pid: 'pid-gggggggg' }));
  show('a bad email', r.status === 400 && DB.vp_captures.length === 0, JSON.stringify(r));
  r = await post(Object.assign({}, GOOD, { code: '', pid: 'pid-hhhhhhhh' }));
  show('no code', r.status === 400);
  r = await post(Object.assign({}, GOOD, { code: 'ZZZZ99', pid: 'pid-iiiiiiii' }));
  show('a code that is no venue', r.status === 404, JSON.stringify(r));
  reset();
  var codes = [];
  for (var i = 0; i < 6; i++) codes.push((await post(Object.assign({}, GOOD, { pid: 'pid-jjjjjjjj' }))).status);
  show('one phone: 5 an hour, the sixth refused', codes.slice(0, 5).every(function (x) { return x === 200; }) && codes[5] === 429, codes.join());
  var net = [];
  for (var n = 0; n < 31; n++) net.push((await post(Object.assign({}, GOOD, { pid: 'pid-net' + ('0000' + n).slice(-4) + 'x' }), '', '10.9.9.9')).status);
  show('one network: 30 a minute, the next refused', net.slice(0, 30).every(function (x) { return x === 200; }) && net[30] === 429, net.slice(28).join());

  print('BEFORE MIGRATION 174');
  reset();
  var _f = fetch;
  fetch = async function (u, o) { if (o && o.body && String(o.body).indexOf('consent_version') !== -1) return { ok: false, status: 400, json: async function () { return { code: '42703', message: 'column "consent_version" does not exist' }; }, text: async function () { return '{"code":"42703","message":"column \\"consent_version\\" does not exist"}'; }, headers: { get: function () { return null; } } }; return _f(u, o); };
  r = await post(Object.assign({}, GOOD, { pid: 'pid-kkkkkkkk' }), '');
  fetch = _f;
  show('the version is dropped and the sign-up still kept', r.body.stored === true && DB.vp_captures.length === 1 && DB.vp_captures[0].consent_version === undefined && DB.vp_captures[0].marketing_optin === true, JSON.stringify(r) + JSON.stringify(DB.vp_captures));

  show('the route is wired: POST /join/list goes to handleJoinList', /if \(method === 'POST' && path === '\/join\/list'\)\s+return await handleJoinList\(request, env, json\);/.test(SRC));
  print('THE TRIVIA PHONE');
  var PLAY = readFile('venueplay/app/trivia/play.html');
  show('switches the sign-up on only where the venue collects email, the tick only where it collects the tick',
       /signup: \(P\.collect && P\.collect\.email\) \? headsUp : null, offers: !!\(P\.collect && P\.collect\.marketing_optin\), signedUp: headsUpDone\(\)/.test(PLAY));
  show('posts to /join/list with the code, the consent version and the phone\'s id, and the token it joined with (even a finished night\'s)',
       /fetch\(VP_GAME_API\+"\/join\/list"/.test(PLAY) && /t=P\.token\|\|P\.lastToken; if\(t\) h\["X-Player-Token"\]=t;/.test(PLAY) && /consent_version:\(typeof VPConsent==="object" \? VPConsent\.VERSION : ""\), pid:deviceId\(\)/.test(PLAY));
  show('keeps the old token in memory when a finished night is dropped', /if\(P\.token\) P\.lastToken=P\.token;/.test(PLAY));
  show('is not asked again at this venue once sent', /localStorage\.setItem\(headsUpKey\(\),"1"\)/.test(PLAY));

  print('');
  print(bad ? (bad + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
})();
