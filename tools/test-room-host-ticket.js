/* ONLY A SIGNED-IN HOST IS A HOST IN THE ROOM (security review 13 Nov 2026, A3; the 3 Nov audit's M2), run through
   the REAL game Worker (tools/rig-game-worker.js) with a REAL HMAC-SHA256.

   The finding: GET /room/ws?room=vp-<the code on the TV>&role=host was handed to the venue's room as a host with no
   sign-in, and a host socket may send 240 messages of 16 KB a second to every phone and TV. The PoC it came from:
   ~/venue-enrich/reports/security-13nov/poc/poc-A3-room-host-role-unauthenticated.js (FAIL on main and Tuesday).

     1. /room/ws: role=host without a good ticket for THIS room joins as a phone (no ticket, a forged, expired or
        another room's ticket); with one, as the host; tv and phone unchanged
     2. POST /room/ticket: a signed-in login that is staff at the room's venue gets one (by the venue code, or by one
        of the rooms its slug names); no sign-in, staff elsewhere, a room of nobody's: none
     3. the console (vp-room.js) asks for a ticket only for a host socket at a venue room, keeps it until a minute
        before it ends, and opens anyway without one (an old Worker, a lapsed sign-in)
     4. the room's own caps (venueplay-room.test.js runs the class): only the host gets the host's pace; a TV, a phone
        and anything unrecognised get 20 a second; only the host and HQ may send more than 4 KB

   Run from the repo root:  jsc tools/test-room-host-ticket.js */
load('tools/rig-game-worker.js');

/* ---- a real SHA-256 and HMAC for this suite (the rig's crypto answers zeros and has no HMAC) ---- */
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
function hmac(key, msg) {
  var k = key.length > 64 ? sha256Bytes(key) : key, kp = new Uint8Array(64); kp.set(k);
  var ip = new Uint8Array(64 + msg.length), op = new Uint8Array(64 + 32), i;
  for (i = 0; i < 64; i++) { ip[i] = kp[i] ^ 0x36; op[i] = kp[i] ^ 0x5c; }
  ip.set(msg, 64); op.set(sha256Bytes(ip), 64);
  return sha256Bytes(op);
}
TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
crypto.subtle.digest = async function (alg, data) { return sha256Bytes(new Uint8Array(data)).buffer; };
crypto.subtle.importKey = async function (fmt, raw) { return { raw: new Uint8Array(raw) }; };
crypto.subtle.sign = async function (alg, key, data) { return hmac(key.raw, new Uint8Array(data)).buffer; };

var finished = false;
var forwarded = [];
var ENV2 = Object.assign({}, ENV, { ROOM: { idFromName: function (n) { return n; },
  get: function (id) { return { fetch: async function (r) { forwarded.push((r && r.url) || String(r)); return { status: 101 }; } }; } } });
Request = function (u, init) { this.url = u; };
function wsReq(qs) { return { url: 'https://game/room/ws?' + qs, headers: { get: function (k) { return /upgrade/i.test(k) ? 'websocket' : ''; } } }; }
async function sock(qs) { forwarded = []; var out; try { out = await handleRoomSocket(wsReq(qs), ENV2, json); } catch (e) { out = { status: e.status || 500 }; }
  var f = forwarded[0] || ''; var m = /role=([a-z]+)/.exec(f); return m ? m[1] : ('refused ' + (out && out.status)); }

(async function () {
  var hm = hmac(new TextEncoder().encode('key'), new TextEncoder().encode('The quick brown fox jumps over the lazy dog'));
  var hx = ''; for (var i = 0; i < hm.length; i++) hx += ('0' + hm[i].toString(16)).slice(-2);
  show('the suite\'s HMAC-SHA256 is the real one (RFC test vector)', hx === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', hx);

  print('1. /room/ws: a host socket needs a ticket for THIS room');
  var R = 'vp-ACDEFG';
  show('no ticket: let in as a phone, never as the host', await sock('room=' + R + '&role=host') === 'phone');
  var t = await roomTicketMake(ENV2, R, Date.now());
  show('a ticket looks like expiry.40 hex and lasts 15 minutes', !!t && /^\d{10}\.[0-9a-f]{40}$/.test(t.ticket) && t.exp === Math.floor(Date.now() / 1000) + 15 * 60, JSON.stringify(t));
  show('with a good ticket: the host', await sock('room=' + R + '&role=host&tk=' + encodeURIComponent(t.ticket)) === 'host');
  var other = await roomTicketMake(ENV2, 'vp-HJKMNP', Date.now());
  show('another room\'s ticket: a phone', await sock('room=' + R + '&role=host&tk=' + encodeURIComponent(other.ticket)) === 'phone');
  var forged = t.ticket.slice(0, -1) + (t.ticket.slice(-1) === '0' ? '1' : '0');
  show('one character changed: a phone', await sock('room=' + R + '&role=host&tk=' + encodeURIComponent(forged)) === 'phone');
  var old = await roomTicketMake(ENV2, R, Date.now() - (15 * 60 + 5) * 1000);
  show('an expired ticket: a phone', await sock('room=' + R + '&role=host&tk=' + encodeURIComponent(old.ticket)) === 'phone');
  var exp2 = Math.floor(Date.now() / 1000) + 30 * 86400, late = exp2 + '.' + (await roomTicketSig(ENV2, R, exp2));
  show('a ticket dated far ahead (made with the key, but past the longest life): a phone', await sock('room=' + R + '&role=host&tk=' + encodeURIComponent(late)) === 'phone');
  var keyless = Object.assign({}, ENV2, { SUPABASE_SERVICE_KEY: '', ROOM_TICKET_KEY: '' });
  forwarded = []; await handleRoomSocket(wsReq('room=' + R + '&role=host&tk=' + encodeURIComponent(t.ticket)), keyless, json);
  show('no key on the Worker: no ticket is good', /role=phone/.test(forwarded[0] || ''), forwarded[0]);
  var offEnv = Object.assign({}, ENV2, { ROOM_HOST_TICKETS: 'off' });
  forwarded = []; await handleRoomSocket(wsReq('room=' + R + '&role=host'), offEnv, json);
  show('ROOM_HOST_TICKETS "off" (the release-day switch) lets a console with no ticket in as the host', /role=host/.test(forwarded[0] || ''), forwarded[0]);
  show('a TV and a phone join as before', await sock('room=' + R + '&role=tv') === 'tv' && await sock('room=' + R + '&role=phone') === 'phone');

  print('2. POST /room/ticket: staff at THIS room\'s venue only');
  var SLUG = 'the-royal', OTHERV = '99999999-9999-4999-8999-999999999999';
  DB = { vp_venues: [{ id: VENUE, slug: SLUG, status: 'active' }], vp_sessions: [] };
  verifyHostJwt = async function (request) { var a = request.headers.get('Authorization') || ''; if (!/^Bearer /.test(a)) { var e = new Error('Not signed in'); e.status = 401; throw e; } return a.slice(7); };
  venueByCode = async function (env, code) { return code === 'ACDEFG' ? VENUE : null; };
  requireStaff = async function (env, uid, venueId) { if (uid === 'staff-here' && venueId === VENUE) return { id: 's1', role: 'host' }; var e = new Error('Not staff at this venue'); e.status = 403; throw e; };
  function tReq(qs, who) { return { url: 'https://game/room/ticket?' + qs, headers: { get: function (k) { k = k.toLowerCase(); if (k === 'authorization') return who ? 'Bearer ' + who : ''; if (k === 'cf-connecting-ip') return '203.0.113.5'; return ''; } } }; }
  async function ask(qs, who) { try { return await handleRoomTicket(tReq(qs, who), ENV2, json); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } }
  var a1 = await ask('room=' + R, 'staff-here');
  show('staff at the venue the code names: a ticket, and it opens the room as the host', a1.status === 200 && await roomTicketGood(ENV2, R, a1.body.ticket, Date.now()), JSON.stringify(a1));
  var a2 = await ask('room=' + R, '');
  show('no sign-in: 401, no ticket', a2.status === 401 && !(a2.body && a2.body.ticket), JSON.stringify(a2));
  var a3 = await ask('room=' + R, 'staff-elsewhere');
  show('signed in but not staff there: 403, no ticket', a3.status === 403 && !(a3.body && a3.body.ticket), JSON.stringify(a3));
  var fmtRoom = roomVenueRooms(SLUG)[1];
  var a4 = await ask('room=' + encodeURIComponent(fmtRoom) + '&venue=' + SLUG, 'staff-here');
  show('a format room the venue\'s slug names: a ticket for that room', a4.status === 200 && await roomTicketGood(ENV2, fmtRoom, a4.body.ticket, Date.now()), JSON.stringify(a4));
  var a5 = await ask('room=vp-HJKMNP&venue=' + SLUG, 'staff-here');
  show('naming your own venue\'s slug for a room it does not have: no ticket', a5.status !== 200 && !(a5.body && a5.body.ticket), JSON.stringify(a5));
  var a6 = await ask('room=vpa-0123456789', 'staff-here');
  show('an answers room has no host: no ticket', a6.status === 400, JSON.stringify(a6));

  print('3. the console asks for it, and only the console');
  var VR = readFile('venueplay/app/vp-room.js');
  var wt = VR.slice(VR.indexOf('function withTicket('), VR.indexOf('function open()', VR.indexOf('function withTicket(')));
  show('only a host socket at a venue room asks for a ticket', /if \(role !== "host" \|\| !venueRoom\) \{ cb\(""\); return; \}/.test(wt));
  show('it asks POST /room/ticket with the console\'s own sign-in (post sends the Bearer)', /post\(api \+ "\/room\/ticket\?room=" \+ encodeURIComponent\(roomName\) \+ venueQ\(\)\)/.test(wt) && /Authorization: "Bearer " \+ tok/.test(VR));
  show('a ticket is kept until a minute before it ends, and a slow answer gives up after 4 seconds', /tk\.exp \* 1000 - now\(\) > 60000/.test(wt) && /setTimeout\(function \(\) \{ give\(""\); \}, 4000\)/.test(wt));
  var on = VR.slice(VR.indexOf('function openNow(t)'), VR.indexOf('function openNow(t)') + 600);
  show('the socket carries it as tk, and opens without one when there is none', /\(t \? "&tk=" \+ encodeURIComponent\(t\) : ""\)/.test(on) && /withTicket\(function \(t\) \{ if \(!st\.closed\) openNow\(t\); \}\)/.test(VR));
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + (e && e.stack)); bad++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); bad++; }
if (bad) throw new Error('room host ticket: ' + bad + ' of ' + ran + ' failed');
print('PASS ' + ran + ' checks');
