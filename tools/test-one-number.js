/* ONE PHONE NUMBER PER PLAYER, CHANGED ONLY WITH A TEXT CODE (Dean, 17 Nov 2026 ~23:15; migration 214).

   RUNS the real venueplay-game.js on tools/rig-game-worker.js through the handlers a real night uses (/join, /join/known,
   /join/number/start, /join/number/verify). The database function vp_number_change_apply is stood in for by FAKE_APPLY
   below, which does what the SQL does (the SQL itself was run and read back on TEST, rolled back). The text provider is
   stood in for: nothing leaves, and the code is read out of the would-be text.
     1. the switch: off by default (no "Not my number", both routes 503, nothing texted); on needs the Mobile Message login
     2. /join/known: "Playing as" is the first name and the MASKED number (last three digits), nothing more
     3. start: a code texted to the NEW number only, never the old; the same number, a junk number, an unknown phone refused;
        only a hash of the code is kept; the text names venueplay, the code, the expiry; no em dash
     4. verify: a wrong code counts a try and says how many are left; five wrong and even the right code is refused;
        an expired code refused; the right code swaps the number
     5. the swap: the known row, and ONLY the venues that already had this player's number; a venue that did not have it
        is untouched; consent rows are untouched (per player, not per number); the next game at a venue that had it
        carries the NEW number
     6. send again: 30 seconds apart, three texts at most, the old code stops working
     7. abuse limits: five changes a day per player, three codes a day to any one new number
     8. no "Different number" path left on the phone module; the outbox guard swallows fiction numbers on live
   Run from the repo root:  jsc tools/test-one-number.js */
load('tools/rig-game-worker.js');

sha256Hex = async function (s) {
  var out = '', h1 = 2166136261 >>> 0, h2 = 5381 >>> 0;
  for (var r = 0; r < 8; r++) {
    for (var i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i) + r; h1 = Math.imul(h1, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + s.charCodeAt(i) + r) >>> 0; }
    out += ('00000000' + ((h1 ^ h2) >>> 0).toString(16)).slice(-8);
  }
  return out;
};
var _uuid = 0;
crypto.randomUUID = function () { _uuid++; return 'c0c0c0c0-0000-4000-8000-' + ('000000000000' + _uuid).slice(-12); };
if (typeof btoa !== 'function') btoa = function (s) { return 'b64:' + s; };
if (typeof AbortController !== 'function') AbortController = function () { this.signal = {}; this.abort = function () {}; };
var OTHER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', THIRD = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
var TEXTS = [], SMS_FAIL = false, MISSING = false;
/* what migration 214's function does, in JS (the SQL was proven on TEST) */
function FAKE_APPLY(id) {
  var c = (DB.vp_number_changes || []).filter(function (x) { return x.id === id; })[0];
  if (!c) return { ok: false, why: 'none' };
  if (c.done_at) return { ok: true, rows: c.rows_changed || 0, already: true };
  if (Date.parse(c.expires_at) < Date.now()) return { ok: false, why: 'expired' };
  var k = DB.vp_known_players.filter(function (x) { return x.id === c.known_id; })[0];
  var venues = Object.keys(k.shared || {}).filter(function (v) { return Array.isArray(k.shared[v]) && k.shared[v].indexOf('mobile') >= 0; });
  var n = 0;
  if (k.mobile && k.mobile !== c.new_mobile) {
    DB.vp_players.forEach(function (p) {
      var s = DB.vp_sessions.filter(function (x) { return x.id === p.session_id; })[0];
      if (s && venues.indexOf(s.venue_id) >= 0 && p.mobile === k.mobile) { p.mobile = c.new_mobile; n++; }
    });
    (DB.vp_captures || []).forEach(function (r) { if (venues.indexOf(r.venue_id) >= 0 && r.mobile === k.mobile) { r.mobile = c.new_mobile; n++; } });
  }
  k.mobile = c.new_mobile;
  c.done_at = new Date().toISOString(); c.rows_changed = n;
  DB.vp_number_changes.forEach(function (x) { if (x.known_id === k.id && x.id !== c.id && !x.done_at) x.attempts = 5; });
  return { ok: true, rows: n };
}
var rigFetch = fetch;
fetch = async function (url, opts) {
  var u = String(url);
  if (u.indexOf('https://api.mobilemessage.com.au/') === 0) {
    var m = JSON.parse(opts.body).messages[0]; TEXTS.push(m);
    if (SMS_FAIL) return resp(500, { status: 'error' });
    return resp(200, { status: 'complete', results: [{ to: m.to, status: 'success', message_id: 'x', cost: 1 }] });
  }
  if (MISSING && /\/rest\/v1\/(vp_number_changes|rpc\/vp_number_change_apply)/.test(u)) return resp(404, { code: '42P01', message: 'relation does not exist' });
  if (/\/rest\/v1\/rpc\/vp_number_change_apply$/.test(u)) return resp(200, FAKE_APPLY(JSON.parse(opts.body).p_change));
  if (/\/rest\/v1\/vp_number_changes$/.test(u) && opts && opts.method === 'POST') {
    var b = JSON.parse(opts.body); (Array.isArray(b) ? b : [b]).forEach(function (r) {
      if (r.attempts === undefined) r.attempts = 0; if (r.sends === undefined) r.sends = 1; if (r.done_at === undefined) r.done_at = null;
      if (!r.created_at) r.created_at = new Date().toISOString(); if (!r.last_sent_at) r.last_sent_at = r.created_at; });
    opts = Object.assign({}, opts, { body: JSON.stringify(b) });
  }
  if (/\/rest\/v1\/vp_players$/.test(u) && opts && opts.method === 'POST') {
    var pb = JSON.parse(opts.body); (Array.isArray(pb) ? pb : [pb]).forEach(function (r) { if (r.kicked === undefined) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(pb) });
  }
  return rigFetch(url, opts);
};
requireStaff = async function (env, uid, venueId) { return { id: 'staff-1', role: 'owner', venue_id: venueId, auth_user_id: uid }; };
function world() {
  DB = {}; LOG.length = 0; TEXTS.length = 0; SMS_FAIL = false; MISSING = false;
  delete ENV.CONSENT_BLOCK; delete ENV.NUMBER_CHANGE_SMS_ON; delete ENV.MOBILEMESSAGE_USERNAME; delete ENV.MOBILEMESSAGE_PASSWORD;
  DB.vp_venues = [VENUE, OTHER, THIRD].map(function (id, i) { return { id: id, name: ['The Royal', 'The Other Pub', 'The Third'][i], slug: 'v' + i, status: 'active', au_state: 'QLD', entity_type: 'for_profit', terms_required: false, max_players: 50, founding_id: 'f' + i, timezone: 'Australia/Brisbane', created_at: '2026-01-01T00:00:00Z' }; });
  DB.venueplay_founding = [0, 1, 2].map(function (i) { return { id: 'f' + i, status: 'active', stripe_customer_id: 'cus_' + i, stripe_subscription_id: 'sub_' + i, first_signin_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', contact_email: 'gm' + i + '@pub.com.au' }; });
  DB.vp_sessions = []; DB.vp_players = []; DB.vp_games = []; DB.vp_known_players = []; DB.vp_player_consents = []; DB.vp_number_changes = []; DB.vp_captures = [];
  DB.vp_venue_settings = [VENUE, OTHER, THIRD].map(function (id) { return { venue_id: id, collect_first_name: true, collect_marketing_optin: true }; });
  DB.vp_venue_staff = [];
}
function on() { ENV.NUMBER_CHANGE_SMS_ON = 'on'; ENV.MOBILEMESSAGE_USERNAME = 'u'; ENV.MOBILEMESSAGE_PASSWORD = 'p'; }
async function call(fn, body) {
  BODY = body;
  try { return await fn({ headers: { get: function () { return ''; } }, url: 'https://game.example/x' }, ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
}
async function open(venueId) {
  var r = await call(handleCreateSession, { venue_id: venueId || VENUE, format: 'trivia', road: 'supabase' });
  return DB.vp_sessions.filter(function (x) { return x.id === r.body.session_id; })[0];
}
function lastPlayer() { return DB.vp_players[DB.vp_players.length - 1]; }
var PID = 0;
function pid() { PID++; return 'phone-' + ('00000000' + PID).slice(-8); }
function codeIn(t) { var m = /code is ([0-9]{6})/.exec(t && t.message || ''); return m ? m[1] : null; }
function later(ms) { NOWMS += ms; }

(async function () {
  print('1. THE SWITCH: OFF BY DEFAULT');
  world();
  var s1 = await open(VENUE);
  var j = await call(handleJoin, { code: s1.join_code, name: 'Sarah', pid: pid(), first_name: 'Sarah', mobile: '0412345123', marketing_optin: true });
  var KEY = j.body.known_key;
  var jk = await call(handleJoinKnown, { code: s1.join_code, keys: [KEY] });
  show('off: no "Not my number" offered (change_number false)', jk.body.known && jk.body.known.change_number === false, JSON.stringify(jk.body.known));
  var st = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456' });
  show('off: start answers 503 and nothing is texted or written', st.status === 503 && st.body.off === true && TEXTS.length === 0 && DB.vp_number_changes.length === 0, JSON.stringify(st));
  show('off: verify answers 503', (await call(handleNumberVerify, { keys: [KEY], change_id: 'c0c0c0c0-0000-4000-8000-000000000001', sms_code: '123456' })).status === 503);
  ENV.NUMBER_CHANGE_SMS_ON = 'on';
  show('on, but no Mobile Message login on this Worker: still off', (await call(handleNumberStart, { keys: [KEY], mobile: '0412000456' })).status === 503 && TEXTS.length === 0);
  ENV.NUMBER_CHANGE_SMS_ON = 'yes'; ENV.MOBILEMESSAGE_USERNAME = 'u'; ENV.MOBILEMESSAGE_PASSWORD = 'p';
  show('only the word "on" switches it on', (await call(handleNumberStart, { keys: [KEY], mobile: '0412000456' })).status === 503 && TEXTS.length === 0);

  print('2. PLAYING AS SARAH, 04.. ... 123');
  on();
  jk = await call(handleJoinKnown, { code: s1.join_code, keys: [KEY] });
  show('the first name and the number masked to its last three digits; "Not my number" offered', jk.body.known.hello === 'Sarah' && jk.body.known.mobile_masked === '04•• ••• 123' && jk.body.known.change_number === true, JSON.stringify(jk.body.known));
  show('...and never the whole number', JSON.stringify(jk.body).indexOf('412345123') < 0 && JSON.stringify(jk.body).indexOf('345') < 0);

  print('3. START: A CODE TO THE NEW NUMBER ONLY');
  show('an unknown phone is refused, nothing texted', (await call(handleNumberStart, { keys: ['f'.repeat(64)], mobile: '0412000456' })).status === 404 && TEXTS.length === 0);
  show('a junk number is refused', (await call(handleNumberStart, { keys: [KEY], mobile: '12345' })).status === 400 && TEXTS.length === 0);
  show('the number we already hold is refused', (await call(handleNumberStart, { keys: [KEY], mobile: '0412 345 123' })).status === 400 && TEXTS.length === 0);
  MISSING = true;
  st = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456' });
  show('before migration 214: 503, nothing texted', st.status === 503 && TEXTS.length === 0, JSON.stringify(st));
  MISSING = false;
  st = await call(handleNumberStart, { keys: [KEY], mobile: '0412 000 456' });
  show('a code is texted, once, to the NEW number in the one form', st.status === 200 && TEXTS.length === 1 && TEXTS[0].to === '+61412000456', JSON.stringify([st, TEXTS]));
  show('...never to the old number', TEXTS.every(function (t) { return t.to !== '+61412345123'; }));
  show('...from venueplay', TEXTS[0].sender === 'venueplay', TEXTS[0].sender);
  var CODE = codeIn(TEXTS[0]);
  show('the text: venueplay, a six-digit code, the expiry; one part; no em dash', /^Your venueplay code is [0-9]{6}\. It expires in 10 minutes\./.test(TEXTS[0].message) && TEXTS[0].message.length <= 160 && TEXTS[0].message.indexOf('\u2014') < 0, TEXTS[0].message);
  var ch = DB.vp_number_changes[0];
  show('the answer names the change and the new number masked, with the expiry and the resend wait', st.body.change_id === ch.id && st.body.to === '04•• ••• 456' && st.body.expires_in === 600 && st.body.resend_in === 30, JSON.stringify(st.body));
  show('only a HASH of the code is kept, with the change id in it; the old number only as its last three digits', JSON.stringify(DB.vp_number_changes).indexOf(CODE) < 0 && ch.code_hash === (await sha256Hex('vpnc:' + ch.id + ':' + CODE)) && ch.old_last3 === '123', JSON.stringify(ch));
  show('it lives ten minutes', Date.parse(ch.expires_at) - Date.now() === 600000, ch.expires_at);
  show('nothing has changed yet', DB.vp_known_players[0].mobile === '+61412345123');
  SMS_FAIL = true;
  st = await call(handleNumberStart, { keys: [KEY], mobile: '0412000999' });
  show('a text that fails to go: the player is told, no code to type', st.status === 502 && !st.body.change_id, JSON.stringify(st));
  SMS_FAIL = false;

  print('4. VERIFY: TRIES, EXPIRY, THE RIGHT CODE');
  var wrong = CODE === '000000' ? '111111' : '000000';
  var v = await call(handleNumberVerify, { keys: [KEY], change_id: ch.id, sms_code: wrong });
  show('a wrong code: refused, the try counted, four left', v.status === 400 && v.body.tries_left === 4 && ch.attempts === 1 && DB.vp_known_players[0].mobile === '+61412345123', JSON.stringify(v));
  show('another phone cannot use this change (the key must be the same player\'s)', (await call(handleNumberVerify, { keys: ['e'.repeat(64)], change_id: ch.id, sms_code: CODE })).status === 404);
  show('a code that is not six numbers is refused before a try is spent', (await call(handleNumberVerify, { keys: [KEY], change_id: ch.id, sms_code: '12' })).status === 400 && ch.attempts === 1);
  for (var t = 0; t < 4; t++) v = await call(handleNumberVerify, { keys: [KEY], change_id: ch.id, sms_code: wrong });
  show('five wrong: no tries left', v.status === 429 && v.body.tries_left === 0 && ch.attempts === 5, JSON.stringify(v));
  v = await call(handleNumberVerify, { keys: [KEY], change_id: ch.id, sms_code: CODE });
  show('...and then even the RIGHT code is refused', v.status === 429 && DB.vp_known_players[0].mobile === '+61412345123', JSON.stringify(v));
  later(61000);
  st = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456' });
  ch = DB.vp_number_changes.filter(function (x) { return x.id === st.body.change_id; })[0];
  CODE = codeIn(TEXTS[TEXTS.length - 1]);
  later(601000);
  v = await call(handleNumberVerify, { keys: [KEY], change_id: ch.id, sms_code: CODE });
  show('a code after ten minutes: expired, nothing changed, and refused before a try is spent', v.status === 410 && v.body.expired === true && DB.vp_known_players[0].mobile === '+61412345123' && ch.attempts === 0, JSON.stringify([v, ch.attempts]));

  print('5. THE SWAP: EVERY VENUE THAT HAD IT, AND ONLY THOSE');
  /* Sarah plays at OTHER and gives it her number (Use this, box ticked); THIRD never gets it */
  var so = await open(OTHER);
  await call(handleJoin, { code: so.join_code, name: 'Sarah', pid: pid(), known_keys: [KEY], use_fields: ['mobile'], marketing_optin: true });
  var atOther = lastPlayer();
  var s3 = await open(THIRD);
  await call(handleJoin, { code: s3.join_code, name: 'Sarah', pid: pid(), known_keys: [KEY] });
  var atThird = lastPlayer();
  DB.vp_players.push({ id: 'stranger-row', session_id: s3.id, first_name: 'Kim', mobile: '+61412345123' });   // the old number at a venue that never had it from Sarah
  DB.vp_captures.push({ id: 'cap-other', venue_id: OTHER, first_name: 'Sarah', mobile: '+61412345123' });
  DB.vp_player_consents.push({ id: 'cons-1', venue_id: OTHER, known_id: DB.vp_known_players[0].id, party: 'venue', granted: true, wording_version: 'vpc-4-22nov', source: 'trivia' });
  var consBefore = JSON.stringify(DB.vp_player_consents);
  show('before: OTHER had the old number from Sarah, THIRD had none', atOther.mobile === '+61412345123' && atThird.mobile === undefined, JSON.stringify([atOther, atThird]));
  later(31000);
  st = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456' });
  ch = DB.vp_number_changes.filter(function (x) { return x.id === st.body.change_id; })[0];
  CODE = codeIn(TEXTS[TEXTS.length - 1]);
  v = await call(handleNumberVerify, { keys: [KEY], change_id: ch.id, sms_code: CODE });
  show('the right code: ok, the new number masked', v.status === 200 && v.body.ok === true && v.body.masked === '04•• ••• 456', JSON.stringify(v));
  show('the known row now holds the NEW number, and only it', DB.vp_known_players[0].mobile === '+61412000456' && JSON.stringify(DB.vp_known_players[0]).indexOf('412345123') < 0, JSON.stringify(DB.vp_known_players[0]));
  show('every venue that had it from Sarah has the new one (the first venue\'s rows, the other venue\'s row and capture)', DB.vp_players.filter(function (p) { return p.first_name === 'Sarah'; }).every(function (p) { return p.mobile !== '+61412345123'; }) && atOther.mobile === '+61412000456' && DB.vp_captures[0].mobile === '+61412000456', JSON.stringify(DB.vp_players));
  show('a venue that never had it from her is untouched (a stranger with the old number there keeps it)', DB.vp_players.filter(function (p) { return p.id === 'stranger-row'; })[0].mobile === '+61412345123' && atThird.mobile === undefined);
  show('consent rows untouched: each venue\'s answer stays, per player', JSON.stringify(DB.vp_player_consents) === consBefore);
  show('the change is marked done', !!ch.done_at, JSON.stringify(ch));
  v = await call(handleNumberVerify, { keys: [KEY], change_id: ch.id, sms_code: CODE });
  show('the same code again: ok, nothing changes twice', v.status === 200 && DB.vp_known_players[0].mobile === '+61412000456');
  await call(handleJoin, { code: (await open(OTHER)).join_code, name: 'Sarah', pid: pid(), known_keys: [KEY] });
  show('the next game at a venue that had her number carries the NEW one', lastPlayer().mobile === '+61412000456', JSON.stringify(lastPlayer()));
  await call(handleJoin, { code: (await open(VENUE)).join_code, name: 'Sarah', pid: pid(), known_keys: [KEY] });
  show('...at the first venue too: never the old number again', lastPlayer().mobile === '+61412000456', JSON.stringify(lastPlayer()));
  jk = await call(handleJoinKnown, { code: s3.join_code, keys: [KEY] });
  show('a venue that never had it still asks before it gets it (Playing as shows the NEW number)', jk.body.known.mobile_masked === '04•• ••• 456' && jk.body.known.confirm.some(function (x) { return x.field === 'mobile' && x.masked === '04•• ••• 456'; }), JSON.stringify(jk.body.known));

  print('6. SEND AGAIN');
  world(); on();
  s1 = await open(VENUE);
  j = await call(handleJoin, { code: s1.join_code, name: 'Sarah', pid: pid(), first_name: 'Sarah', mobile: '0412345123' });
  KEY = j.body.known_key;
  st = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456' });
  var cid = st.body.change_id, first = codeIn(TEXTS[0]);
  var again = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456', change_id: cid });
  show('send again within 30 seconds: refused with the wait, nothing texted', again.status === 429 && again.body.resend_in > 0 && TEXTS.length === 1, JSON.stringify(again));
  later(31000);
  again = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456', change_id: cid });
  show('after 30 seconds: a new code, same change, to the same new number', again.status === 200 && again.body.change_id === cid && TEXTS.length === 2 && TEXTS[1].to === '+61412000456' && again.body.sends_left === 1, JSON.stringify(again));
  var second = codeIn(TEXTS[1]);
  show('send again for a DIFFERENT number on the same change is refused', (await call(handleNumberStart, { keys: [KEY], mobile: '0412000777', change_id: cid })).status === 410 && TEXTS.length === 2);
  if (first !== second) {
    v = await call(handleNumberVerify, { keys: [KEY], change_id: cid, sms_code: first });
    show('the first code stops working once a new one is sent', v.status === 400 && DB.vp_known_players[0].mobile === '+61412345123', JSON.stringify(v));
  } else show('the first code stops working once a new one is sent (codes differ)', false, 'same code twice: ' + first);
  later(31000);
  again = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456', change_id: cid });
  later(31000);
  var fourth = await call(handleNumberStart, { keys: [KEY], mobile: '0412000456', change_id: cid });
  show('three texts per change at most', again.status === 200 && fourth.status === 429 && TEXTS.length === 3, JSON.stringify(fourth));
  show('the clock restarts on each text but never past 30 minutes from the start', Date.parse(DB.vp_number_changes[0].expires_at) <= Date.parse(DB.vp_number_changes[0].created_at) + 1800000);

  print('7. ABUSE LIMITS');
  world(); on();
  s1 = await open(VENUE);
  KEY = (await call(handleJoin, { code: s1.join_code, name: 'Sarah', pid: pid(), first_name: 'Sarah', mobile: '0412345123' })).body.known_key;
  for (var n = 0; n < 5; n++) await call(handleNumberStart, { keys: [KEY], mobile: '04120004' + (10 + n) });
  st = await call(handleNumberStart, { keys: [KEY], mobile: '0412000499' });
  show('five changes a day per player, then refused, nothing texted', st.status === 429 && TEXTS.length === 5, JSON.stringify(st));
  var keys = [];
  for (n = 0; n < 4; n++) { var jj = await call(handleJoin, { code: s1.join_code, name: 'P' + n, pid: pid(), first_name: 'P' + n, mobile: '04129990' + (10 + n) }); keys.push(jj.body.known_key); }
  TEXTS.length = 0;
  for (n = 0; n < 3; n++) await call(handleNumberStart, { keys: [keys[n]], mobile: '0412777888' });
  st = await call(handleNumberStart, { keys: [keys[3]], mobile: '0412777888' });
  show('three codes a day to any one new number, whoever asks (nobody can text-bomb a stranger)', st.status === 429 && TEXTS.length === 3, JSON.stringify(st));

  print('8. THE PHONE MODULE, AND THE OUTBOX GUARD');
  var VK = readFile('venueplay/app/vp-known.js');
  show('no "Different number" button left on the phone', VK.indexOf('Different number') < 0);
  show('the phone says "Playing as" and offers "Not my number" only when the Worker says change_number', VK.indexOf('"Playing as "') >= 0 && /known\.change_number === true/.test(VK));
  show('no em dash in the phone module', VK.indexOf('\u2014') < 0);
  var GSRC = readFile('venueplay-backend/worker/vp-outbox-guard.js');
  var G = (new Function('Response', 'URL', GSRC.slice(GSRC.indexOf('/* OUTBOX GUARD BEGIN'), GSRC.indexOf('/* OUTBOX GUARD END */')) + '\nreturn { vpgIsTestMobile: vpgIsTestMobile };'))(Response, URL);
  show('the outbox guard treats 0491 570 xxx (and +61 491 570 xxx) as fiction: never delivered', G.vpgIsTestMobile('0491 570 001') && G.vpgIsTestMobile('+61491570123') && !G.vpgIsTestMobile('+61412000456'));

  print('');
  print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('one number: ' + bad + ' failed');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; print('FAILED'); });
drainMicrotasks();
