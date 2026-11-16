/* A KNOWN PHONE, FIRST NAME + MOBILE AT EVERY VENUE, AND ONE CONSENT BOX PER SENDER (INBOX 416, Sunday 22 Nov 2026).

   RUNS the real venueplay-game.js on tools/rig-game-worker.js through the handlers a real night uses (/session,
   /join/info, /join/known, /join). Player data is tier one, so most of this file is about what must NOT happen:
     1. every venue asks first name + mobile (/join/info), and /join keeps both whatever the venue's switches say; the
        mobile in the one form (+614xxxxxxxx), a junk number not kept; the demo keeps its own screen
     2. a first join with a first name and a mobile makes ONE row for THIS venue, keeping only the HASH of a key the phone
        is handed once; the key is never stored
     3. the next game at the same venue (another session) sends the key and nothing else: the player row gets the first
        name and mobile from the row, server side; no second row; no new key
     4. /join/known tells the phone a first name and the NAMES of missing fields, never a value (no mobile, no email)
     5. a field the venue adds later is the only one asked; what is given is added to the row; nothing is overwritten
     6. never across venues: the same key at another venue is not known and fills nothing
     7. before migration 202 (the tables missing) every join works exactly as today
     8. consent: 'single' unless env.CONSENT_BLOCK is 'three'; then venueplay + the venue, plus the host only when a
        HOST login with a brand card opened the game (never the owner); each box its own row with its answer, version,
        source; the venue box is the venue's own marketing tick on the player row (only where the venue collects it);
        a known phone is not asked a box it already answered; a new host's box is still asked
     9. the 90-day purge lives in tools/test-retention-sweep.js

   Run from the repo root:  jsc tools/test-known-phone.js */
load('tools/rig-game-worker.js');

/* A stand-in SHA-256 that is a real function of its input (the rig's digest answers zeros for everything). */
sha256Hex = async function (s) {
  var out = '', h1 = 2166136261 >>> 0, h2 = 5381 >>> 0;
  for (var r = 0; r < 8; r++) {
    for (var i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i) + r; h1 = Math.imul(h1, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + s.charCodeAt(i) + r) >>> 0; }
    out += ('00000000' + ((h1 ^ h2) >>> 0).toString(16)).slice(-8);
  }
  return out;
};
var OTHER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
var rigFetch = fetch, MISSING = false;
fetch = async function (url, opts) {
  var u = String(url);
  if (MISSING && /\/rest\/v1\/vp_(known_players|player_consents)/.test(u)) return resp(404, { code: '42P01', message: 'relation does not exist' });
  if (/\/rest\/v1\/vp_players$/.test(u) && opts && opts.method === 'POST') {
    var pb = JSON.parse(opts.body); (Array.isArray(pb) ? pb : [pb]).forEach(function (r) { if (r.kicked === undefined) r.kicked = false; });
    opts = Object.assign({}, opts, { body: JSON.stringify(pb) });
  }
  return rigFetch(url, opts);
};
var STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000001', role: 'owner' };
requireStaff = async function (env, uid, venueId) { return { id: STAFF.id, role: STAFF.role, venue_id: venueId, auth_user_id: uid }; };
function world(cfg) {
  DB = {}; LOG.length = 0; MISSING = false; STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000001', role: 'owner' }; delete ENV.CONSENT_BLOCK;
  DB.vp_venues = [
    { id: VENUE, name: 'The Royal', slug: 'royal', status: 'active', au_state: 'QLD', entity_type: 'for_profit', terms_required: false, max_players: 50, founding_id: 'f1', timezone: 'Australia/Brisbane', created_at: '2026-01-01T00:00:00Z' },
    { id: OTHER, name: 'The Other Pub', slug: 'other', status: 'active', au_state: 'QLD', entity_type: 'for_profit', terms_required: false, max_players: 50, founding_id: 'f2', timezone: 'Australia/Brisbane', created_at: '2026-01-01T00:00:00Z' }];
  DB.venueplay_founding = [
    { id: 'f1', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', first_signin_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', contact_email: 'gm@royal.com.au' },
    { id: 'f2', status: 'active', stripe_customer_id: 'cus_2', stripe_subscription_id: 'sub_2', first_signin_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', contact_email: 'gm@other.com.au' }];
  DB.vp_sessions = []; DB.vp_players = []; DB.vp_games = []; DB.vp_known_players = []; DB.vp_player_consents = [];
  DB.vp_venue_settings = [Object.assign({ venue_id: VENUE }, cfg || { collect_first_name: true }), { venue_id: OTHER, collect_first_name: true }];
  DB.vp_venue_staff = [{ id: '5a5a5a5a-0000-4000-8000-000000000001', venue_id: VENUE, role: 'owner', auth_user_id: 'u-owner', hosted_by: { trivia: true } },
                       { id: '5a5a5a5a-0000-4000-8000-000000000011', venue_id: VENUE, role: 'host', auth_user_id: 'u-host', hosted_by: { trivia: true } },
                       { id: '5a5a5a5a-0000-4000-8000-000000000033', venue_id: VENUE, role: 'host', auth_user_id: 'u-plain', hosted_by: null }];
  DB.vp_host_brands = [{ auth_user_id: 'u-host', name: 'Quiz Masters Co' }, { auth_user_id: 'u-owner', name: 'Owner Brand' }];
}
async function call(fn, body) {
  BODY = body;
  try { return await fn({ headers: { get: function () { return ''; } }, url: 'https://game.example/x' }, ENV, json); }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
}
async function open(venueId, fmt) {
  var r = await call(handleCreateSession, { venue_id: venueId || VENUE, format: fmt || 'trivia', road: 'supabase' });
  var s = DB.vp_sessions.filter(function (x) { return x.id === r.body.session_id; })[0];
  return s;
}
function close(s) { s.status = 'finished'; s.ended_at = new Date().toISOString(); }
function player(id) { return DB.vp_players.filter(function (p) { return p.id === id; })[0]; }
function lastPlayer() { return DB.vp_players[DB.vp_players.length - 1]; }
var PID = 0;
function pid() { PID++; return 'phone-' + ('00000000' + PID).slice(-8); }

(async function () {
  print('1. FIRST NAME + MOBILE AT EVERY VENUE');
  world();
  var s1 = await open();
  var ji = await call(handleJoinInfo, { code: s1.join_code, fresh: 1 });
  var c = ji.body.collect || {};
  show('a venue that collects nothing: /join/info asks first name and mobile, mobile required', c.first_name === true && c.mobile === true && c.mobile_required === true && !c.email && !c.marketing_optin, JSON.stringify(c));
  var j = await call(handleJoin, { code: s1.join_code, name: 'Quiz Kids', pid: pid(), first_name: 'Alan', mobile: '0412 345 678' });
  var p = lastPlayer();
  show('/join keeps the first name and the mobile there, the mobile in the one form +614xxxxxxxx', j.status === 200 && p.first_name === 'Alan' && p.mobile === '+61412345678', JSON.stringify(p));
  show('...and still nothing the venue does not collect (an email sent is not kept)', (await call(handleJoin, { code: s1.join_code, name: 'B', pid: pid(), first_name: 'Bea', mobile: '0412000111', email: 'bea@x.com' })).status === 200 && lastPlayer().email === undefined, JSON.stringify(lastPlayer()));
  await call(handleJoin, { code: s1.join_code, name: 'C', pid: pid(), first_name: 'Cal', mobile: '12ab' });
  show('a junk mobile is not kept', lastPlayer().mobile === undefined && lastPlayer().first_name === 'Cal', JSON.stringify(lastPlayer()));
  world({ collect_first_name: false });
  s1 = await open();
  await call(handleJoin, { code: s1.join_code, name: 'Team', pid: pid(), first_name: 'Dee', mobile: '0412999888' });
  show('a venue that had first name switched OFF still keeps it now (asked at every venue)', lastPlayer().first_name === 'Dee' && lastPlayer().mobile === '+61412999888', JSON.stringify(lastPlayer()));

  print('2. THE FIRST JOIN MAKES ONE ROW FOR THIS VENUE, BY HASH');
  world();
  s1 = await open();
  j = await call(handleJoin, { code: s1.join_code, name: 'Alan', pid: pid(), first_name: 'Alan', mobile: '0412345678' });
  var KEY = j.body.known_key;
  show('the phone is handed a 64-character key once', typeof KEY === 'string' && /^[0-9a-f]{64}$/.test(KEY), JSON.stringify(j.body.known_key));
  var kr = DB.vp_known_players;
  show('ONE row, for THIS venue, with the first name and mobile', kr.length === 1 && kr[0].venue_id === VENUE && kr[0].first_name === 'Alan' && kr[0].mobile === '+61412345678', JSON.stringify(kr));
  show('the key itself is never stored, only its hash', JSON.stringify(DB).indexOf(KEY) === -1 && kr[0].key_hash === (await sha256Hex('vpk:' + KEY)));
  await call(handleJoin, { code: s1.join_code, name: 'Nomob', pid: pid(), first_name: 'Nomob' });
  show('no mobile, no row (nothing to remember them by)', DB.vp_known_players.length === 1);

  print('3. THE NEXT GAME AT THE SAME VENUE ASKS NOTHING');
  close(s1);
  var s2 = await open(VENUE, 'musical_bingo');
  var jk = await call(handleJoinKnown, { code: s2.join_code, keys: [KEY] });
  show('/join/known: known, hello is the first name, nothing needed', jk.body.known && jk.body.known.hello === 'Alan' && jk.body.known.need.length === 0 && jk.body.known.ix === 0, JSON.stringify(jk.body));
  show('...and never a value we hold: no mobile, no number, no email in the answer', JSON.stringify(jk.body).indexOf('412345678') === -1 && JSON.stringify(jk.body).indexOf('@') === -1 && !('mobile' in jk.body.known) && !('first_name' in jk.body.known), JSON.stringify(jk.body));
  show('the venue name is the organiser for the join line', jk.body.organiser === 'The Royal', JSON.stringify(jk.body.organiser));
  var before = DB.vp_known_players.length;
  j = await call(handleJoin, { code: s2.join_code, name: 'Alan', pid: pid(), known_keys: [KEY] });
  p = lastPlayer();
  show('the join sends only the key: the player row gets the first name and mobile from this venue\'s row', j.status === 200 && p.session_id === s2.id && p.first_name === 'Alan' && p.mobile === '+61412345678', JSON.stringify(p));
  show('...no second row and no new key', DB.vp_known_players.length === before && !j.body.known_key, JSON.stringify(j.body.known_key));
  show('...and the answer to the phone carries no detail', JSON.stringify(j.body).indexOf('412345678') === -1);
  jk = await call(handleJoinKnown, { code: s2.join_code, keys: ['f'.repeat(64), KEY] });
  show('the matching key is named by its place in the list (for Not me)', jk.body.known && jk.body.known.ix === 1, JSON.stringify(jk.body.known));
  jk = await call(handleJoinKnown, { code: s2.join_code, keys: ['f'.repeat(64)] });
  show('a key nobody holds: not known', jk.body.known === null, JSON.stringify(jk.body));
  jk = await call(handleJoinKnown, { code: s2.join_code, keys: ['not-a-key', 12, null] });
  show('junk keys: not known, no error', jk.status === 200 && jk.body.known === null, JSON.stringify(jk));

  print('4. A FIELD THE VENUE ADDS LATER IS THE ONLY ONE ASKED');
  DB.vp_venue_settings[0].collect_email = true;
  jk = await call(handleJoinKnown, { code: s2.join_code, keys: [KEY] });
  show('the venue now collects email: need is ["email"] and nothing else', jk.body.known && JSON.stringify(jk.body.known.need) === '["email"]', JSON.stringify(jk.body.known));
  j = await call(handleJoin, { code: s2.join_code, name: 'Alan', pid: pid(), known_keys: [KEY], email: 'alan@example.com', first_name: 'Alfred', mobile: '0400000000' });
  p = lastPlayer();
  show('the email is kept on the player and added to the row', p.email === 'alan@example.com' && DB.vp_known_players[0].email === 'alan@example.com', JSON.stringify(DB.vp_known_players[0]));
  show('what the row already held is never overwritten', DB.vp_known_players[0].first_name === 'Alan' && DB.vp_known_players[0].mobile === '+61412345678', JSON.stringify(DB.vp_known_players[0]));
  jk = await call(handleJoinKnown, { code: s2.join_code, keys: [KEY] });
  show('asked once: nothing needed after', jk.body.known && jk.body.known.need.length === 0, JSON.stringify(jk.body.known));

  print('5. NEVER ACROSS VENUES');
  var so = await open(OTHER);
  jk = await call(handleJoinKnown, { code: so.join_code, keys: [KEY] });
  show('the same key at another venue is not known', jk.body.known === null, JSON.stringify(jk.body));
  j = await call(handleJoin, { code: so.join_code, name: 'X', pid: pid(), known_keys: [KEY] });
  p = lastPlayer();
  show('...and its join fills nothing from the first venue', p.session_id === so.id && p.mobile === undefined && p.first_name === undefined, JSON.stringify(p));
  show('...and the first venue\'s row is untouched by it', DB.vp_known_players.filter(function (r) { return r.venue_id === OTHER; }).length === 0 && DB.vp_known_players[0].venue_id === VENUE);

  print('6. BEFORE MIGRATION 202');
  world();
  MISSING = true;
  s1 = await open();
  j = await call(handleJoin, { code: s1.join_code, name: 'Old', pid: pid(), first_name: 'Olive', mobile: '0412111222', known_keys: ['a'.repeat(64)] });
  show('a join works exactly as today (seat, first name, mobile) and no key is handed out', j.status === 200 && !!j.body.token && !j.body.known_key && lastPlayer().first_name === 'Olive', JSON.stringify(j.body.known_key));
  jk = await call(handleJoinKnown, { code: s1.join_code, keys: ['a'.repeat(64)] });
  show('/join/known says not known, no error', jk.status === 200 && jk.body.known === null, JSON.stringify(jk));
  MISSING = false;

  print('7. CONSENT: ONE BOX PER SENDER');
  world({ collect_first_name: true, collect_marketing_optin: true });
  s1 = await open();
  jk = await call(handleJoinKnown, { code: s1.join_code, keys: [] });
  show('switch off (no CONSENT_BLOCK): the single tick, as today', jk.body.consent && jk.body.consent.mode === 'single', JSON.stringify(jk.body.consent));
  ENV.CONSENT_BLOCK = 'three';
  jk = await call(handleJoinKnown, { code: s1.join_code, keys: [] });
  var parties = (jk.body.consent && jk.body.consent.parties) || [];
  show('switch on, the owner opened the game: venueplay and the venue, no host box', jk.body.consent.mode === 'three' && parties.length === 2 && parties[0].party === 'venueplay' && parties[1].party === 'venue' && parties[1].name === 'The Royal', JSON.stringify(jk.body.consent));
  show('...with the wording version', jk.body.consent.version === 'vpc-4-22nov');
  close(s1);
  STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000011', role: 'host' };
  var sh = await open();
  jk = await call(handleJoinKnown, { code: sh.join_code, keys: [] });
  parties = jk.body.consent.parties;
  show('a HOST with a brand card (switched on) opened it: a third box with the host\'s brand', parties.length === 3 && parties[2].party === 'host' && parties[2].name === 'Quiz Masters Co', JSON.stringify(parties));
  show('...and the host box never carries the login id to the phone', JSON.stringify(jk.body).indexOf('u-host') === -1);
  close(sh);
  STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000033', role: 'host' };
  var sp = await open();
  jk = await call(handleJoinKnown, { code: sp.join_code, keys: [] });
  show('a staff host with no card switched on: no host box', jk.body.consent.parties.length === 2, JSON.stringify(jk.body.consent.parties));
  close(sp);
  STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000011', role: 'host' };
  sh = await open();
  j = await call(handleJoin, { code: sh.join_code, name: 'Alan', pid: pid(), first_name: 'Alan', mobile: '0412345678', consent: { venueplay: true, venue: false, host: true } });
  KEY = j.body.known_key;
  var rows = DB.vp_player_consents;
  var by = function (pt) { return rows.filter(function (r) { return r.party === pt; })[0]; };
  show('three rows, one per box, each with its own answer', rows.length === 3 && by('venueplay').granted === true && by('venue').granted === false && by('host').granted === true, JSON.stringify(rows));
  show('...each with the wording version, the source game and the session', rows.every(function (r) { return r.wording_version === 'vpc-4-22nov' && r.source === 'trivia' && r.session_id === sh.id && r.venue_id === VENUE; }), JSON.stringify(rows));
  show('...the host box names the host login and the brand shown; the others carry no host', by('host').host_auth_user_id === 'u-host' && by('host').party_name === 'Quiz Masters Co' && by('venue').host_auth_user_id === null && by('venueplay').host_auth_user_id === null);
  show('...tied to the known row', rows.every(function (r) { return r.known_id === DB.vp_known_players[0].id; }));
  show('the venue box unticked: the venue\'s own marketing tick is NOT on the player row', lastPlayer().marketing_optin !== true, JSON.stringify(lastPlayer()));
  jk = await call(handleJoinKnown, { code: sh.join_code, keys: [KEY] });
  show('a known phone that answered every box is not asked again', jk.body.consent.parties.length === 0, JSON.stringify(jk.body.consent));
  close(sh);
  STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000001', role: 'owner' };
  DB.vp_venue_staff.push({ id: '5a5a5a5a-0000-4000-8000-000000000022', venue_id: VENUE, role: 'host', auth_user_id: 'u-host2', hosted_by: { musical: true } });
  DB.vp_host_brands.push({ auth_user_id: 'u-host2', name: 'Bingo Belles' });
  STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000022', role: 'host' };
  var sh2 = await open(VENUE, 'musical_bingo');
  jk = await call(handleJoinKnown, { code: sh2.join_code, keys: [KEY] });
  show('a NEW host at the same venue: only that host\'s box is asked', jk.body.consent.parties.length === 1 && jk.body.consent.parties[0].party === 'host' && jk.body.consent.parties[0].name === 'Bingo Belles', JSON.stringify(jk.body.consent));
  close(sh2);
  STAFF = { id: '5a5a5a5a-0000-4000-8000-000000000001', role: 'owner' };
  s1 = await open();
  rows.length = 0;
  j = await call(handleJoin, { code: s1.join_code, name: 'Bo', pid: pid(), first_name: 'Bo', mobile: '0412555666', consent: { venueplay: false, venue: true, host: true } });
  show('the venue box ticked: the venue\'s marketing tick is on the player row, as the single tick always was', lastPlayer().marketing_optin === true && !!lastPlayer().marketing_optin_at && lastPlayer().consent_version === 'vpc-4-22nov', JSON.stringify(lastPlayer()));
  show('no host on this game: a host answer sent anyway is not kept', DB.vp_player_consents.length === 2 && !DB.vp_player_consents.some(function (r) { return r.party === 'host'; }), JSON.stringify(DB.vp_player_consents));
  DB.vp_venue_settings[0].collect_marketing_optin = false;
  j = await call(handleJoin, { code: s1.join_code, name: 'Cy', pid: pid(), first_name: 'Cy', mobile: '0412777888', consent: { venueplay: true, venue: true } });
  show('a venue not approved to collect the tick: its box is kept as a consent row, never as the venue\'s marketing tick', lastPlayer().marketing_optin !== true && DB.vp_player_consents.some(function (r) { return r.party === 'venue' && r.granted === true && r.player_id === lastPlayer().id; }), JSON.stringify(lastPlayer()));
  delete ENV.CONSENT_BLOCK;
  var n0 = DB.vp_player_consents.length;
  await call(handleJoin, { code: s1.join_code, name: 'Di', pid: pid(), first_name: 'Di', mobile: '0412000999', consent: { venueplay: true, venue: true } });
  show('switch off: a consent object sent by a page is ignored, nothing written', DB.vp_player_consents.length === n0);

  print('8. THE DEMO KEEPS ITS OWN SCREEN');
  world();
  var dm = await call(handleCreateSession, { venue_id: VENUE, format: 'trivia', road: 'supabase', demo: true });
  var dcode = DB.vp_sessions.filter(function (x) { return x.id === dm.body.session_id; })[0].join_code;
  jk = await call(handleJoinKnown, { code: dcode, keys: [] });
  show('/join/known on a demo: not known, single', jk.body.known === null && jk.body.consent.mode === 'single', JSON.stringify(jk.body));
  j = await call(handleJoin, { code: dcode, name: 'Demo', pid: pid(), first_name: 'Demo', mobile: '0412000000' });
  show('a demo join makes no known row and hands out no key', DB.vp_known_players.length === 0 && !j.body.known_key, JSON.stringify(j.body.known_key));

  print('9. THE BINGO PHONE (POST /capture) BY THE SAME RULES');
  world();
  var VC = fnvVenueCode('royal');
  var sb = await open(VENUE, 'bingo');
  DB.vp_players.push({ id: 'bbbbbbbb-0000-4000-8000-000000000001', session_id: sb.id, token_hash: await sha256Hex('tokB'), display_name: 'Bo', kicked: false });
  async function cap(body, tok) {
    BODY = body; var h = { 'x-player-token': tok || '' };
    try { return await handleCapture({ headers: { get: function (k) { return h[String(k).toLowerCase()] || ''; } }, url: 'https://game.example/capture' }, ENV, json); }
    catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
  }
  var cr = await cap({ code: VC, first_name: 'Bo', mobile: '0412 333 444' }, 'tokB');
  var cc = DB.vp_captures[DB.vp_captures.length - 1];
  show('a venue that collects nothing: the bingo capture keeps the first name and mobile (+614...)', cr.body.stored === true && cc && cc.first_name === 'Bo' && cc.mobile === '+61412333444', JSON.stringify(cc));
  var BK = cr.body.known_key;
  show('...and hands the phone a key, with one known row for this venue', /^[0-9a-f]{64}$/.test(BK || '') && DB.vp_known_players.length === 1 && DB.vp_known_players[0].venue_id === VENUE, JSON.stringify(cr.body));
  cr = await cap({ code: VC, first_name: 'Bo', known_keys: [BK] }, 'tokB');
  cc = DB.vp_captures[DB.vp_captures.length - 1];
  show('next time the key alone fills the mobile, server side; no new row, no new key', cc.mobile === '+61412333444' && DB.vp_known_players.length === 1 && !cr.body.known_key, JSON.stringify(cr.body));
  ENV.CONSENT_BLOCK = 'three';
  await cap({ code: VC, first_name: 'Bo', known_keys: [BK], consent: { venueplay: true, venue: true } }, 'tokB');
  await cap({ code: VC, first_name: 'Bo', known_keys: [BK], consent: { venueplay: true, venue: true } }, 'tokB');
  var bc = DB.vp_player_consents;
  show('three mode: one row per box, source bingo, the session from the token; sent twice the same night, kept once', bc.length === 2 && bc.every(function (r) { return r.source === 'bingo' && r.session_id === sb.id && r.known_id === DB.vp_known_players[0].id; }), JSON.stringify(bc));
  delete ENV.CONSENT_BLOCK;

  print('');
  print(bad ? ('FAILED ' + bad + ' of ' + ran) : ('ALL ' + ran + ' CHECKS PASSED'));
  if (bad) throw new Error('known phone: ' + bad + ' failed');
})().catch(function (e) { print('CRASH ' + e + '\n' + (e && e.stack)); bad++; print('FAILED'); });
drainMicrotasks();
