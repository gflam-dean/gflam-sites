/* THE ROOM SERVER (Durable Object). See ROOM-SERVER.md in this folder.
 *
 * WRITTEN OVERNIGHT 9 SEP 2026, NOT RUN, NOT DEPLOYED, NOT WIRED INTO THE GAME WORKER.
 * Run venueplay-room.test.js before believing any of it.
 *
 * One room per channel name. The pages already meet on a Supabase Realtime channel called
 * "vp-<code>" (the TV, the host's tablet, every phone). A room is that channel, held by
 * Cloudflare instead: every screen keeps one WebSocket to it, and whatever one of them sends
 * the room hands to everyone else in the room (never back to the sender, matching Supabase's
 * broadcast {self:false}). The game Worker can also drop a message into a room over HTTP
 * (/publish) for HQ reloads and commands.
 *
 * A room never invents a message. Hosts sign what they send (vp-sign.js) and every screen
 * verifies, so a message arriving by the room is checked exactly as one arriving by Supabase.
 *
 * WebSocket hibernation: an idle room costs nothing. All per-socket state lives in the
 * socket's attachment, so nothing is lost when Cloudflare puts the room to sleep.
 */

const ROOM_MAX_MSG_CHARS = 16 * 1024;        // a game message is a few hundred characters
/* PER SOCKET, PER SECOND, AND THE HOST IS NOT A PHONE.
   One cap of 20 was written for the shape of a flood: a phone hammering the room. It is
   the wrong shape for a HOST. A bingo console answers every phone's rollcall with that
   phone's own cards, so a forty player room is forty messages out of one socket in a
   moment, and it is the console doing exactly what it is supposed to do. Measured on
   staging 10 Sep 2026: the host sent 40, the TV heard 20, and NOTHING said so. Half a
   room would have sat there with no card and no screen able to tell anyone why.
   So the host and the TV, which are the venue's own equipment and whose messages are
   signed, get room to do their job. Phones stay capped, because a phone is the thing an
   outsider can point at us. */
const ROOM_MAX_PER_SEC   = 20;               // a phone, or anything unrecognised
const ROOM_MAX_PER_SEC_HOST = 240;           // a host or a TV: a rollcall answers every phone at once
const ROOM_ROLES         = ['tv', 'host', 'phone', 'hq'];
const ROOM_NAME_RE       = /^[A-Za-z0-9-]{3,90}$/;   // the channel name the page already uses, e.g. vp-3A7TES

/* PHASE 2: THE ROOM HOLDS THE TRIVIA ANSWERS UNTIL THE HOST REVEALS.
   Measured on the Sydney project 10 Sep 2026: a trivia room costs about 1.2 database calls
   a second, because thirty phones each answer every twenty-five seconds and every answer is
   its own write. Fifteen rooms asked for 36 calls a second, got 25, and the venue TVs went
   from an 89 ms poll to a 19 second one. A bingo room costs a tenth of that, so trivia, the
   one format Queensland is open to today, is the one that runs out of room first.
   So a phone sends its answer over the socket instead. The room writes it to its OWN
   storage, tells that phone it is in, and at Reveal the Worker takes the lot and writes
   them in ONE insert. Thirty writes become one.
   THE ROOM SCORES NOTHING. It stamps the time it received the answer and hands it over;
   the deadline, the correctness and the points are still the database's, exactly as today.
   Durable Object storage is on disk and survives hibernation and eviction, which is why the
   answers go to storage and not to a variable: a variable dies with the isolate and takes a
   punter's prize with it. */
const ROOM_MAX_ANSWERS_PER_Q = 1000;                 // a room is 30 to 100 phones; this is a flood guard, not a limit
const ROOM_UUID_RE  = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ROOM_HASH_RE  = /^[0-9a-f]{64}$/;              // sha256 of the phone's player token, computed on the phone
const ROOM_TAKE_MS  = 1500;                          // the host's Reveal never waits longer than this on a room
const ROOM_ANSWER_TTL_MS = 6 * 60 * 60 * 1000;       // three times the longest trivia night: nothing live is ever swept

function roomJson(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

export class VenueRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /* How many answers are already stored for a question, so a flood does not cost a
       storage listing per message. It is a cache of what storage says, never the record
       itself: after an eviction it is empty and gets counted again from storage. */
    this.counts = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/ws') return this.connect(request, url);
    if (path === '/publish' && request.method === 'POST') return this.publish(request);
    if (path === '/presence') return roomJson(this.presence());
    /* These two are reachable only from the game Worker's own code, through the Durable
       Object stub. There is deliberately no public /room/answers route: the answers a room
       is holding are the night's result, and nothing on the internet gets to ask for them
       or to close a question early. */
    if (path === '/answers' && request.method === 'POST') return this.take(request);
    if (path === '/answers/ack' && request.method === 'POST') return this.ack(request);
    return roomJson({ error: 'no such room route' }, 404);
  }

  // A screen joins the room. role is only a tag for presence counts; it grants nothing.
  connect(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') return roomJson({ error: 'expected a websocket' }, 426);
    const role = String(url.searchParams.get('role') || 'phone');
    if (ROOM_ROLES.indexOf(role) < 0) return roomJson({ error: 'bad role' }, 400);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role: role, since: Date.now(), win: 0, n: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Something in the room spoke: hand it to everyone else in the room.
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string') return;                 // binary is not a game message
    if (message.length > ROOM_MAX_MSG_CHARS) return;
    const a = ws.deserializeAttachment() || { role: 'phone', since: 0, win: 0, n: 0 };
    const win = Math.floor(Date.now() / 1000);
    if (a.win !== win) { a.win = win; a.n = 0; }
    a.n += 1;
    ws.serializeAttachment(a);
    const cap = (a.role === 'host' || a.role === 'tv') ? ROOM_MAX_PER_SEC_HOST : ROOM_MAX_PER_SEC;
    if (a.n > cap) return;                                   // a flood is dropped; the socket stays up
    let obj;
    try { obj = JSON.parse(message); } catch (e) { return; }
    /* A GAME MESSAGE IS {t: "ball"}, NOT {type: "ball"}.
       This asked for `type` and dropped everything else, so on 10 Sep the console and
       two TVs all joined the room correctly, presence counted three, and not one ball
       reached the wall. The smoke test passed throughout because it sends {type:"smoke"},
       which is the only shape in the codebase that uses that key. Every real message
       from every console and every phone uses `t`.
       Both are accepted, because /publish from the Worker does use `type` (reload,
       command) and the pages use `t`. */
    if (!obj || typeof obj !== 'object' || !(typeof obj.t === 'string' || typeof obj.type === 'string')) return;
    /* NOTHING CARRYING A CREDENTIAL IS EVER RELAYED. A relay hands a message to every other
       screen in the room, so one page sending a raw token in a field the room does not know
       about would hand that token to thirty strangers' phones. Belt and braces: no page
       sends one today, and the answer below carries a hash, never the token itself. */
    if (obj.tok || obj.token) return;
    /* A trivia answer is HELD, not relayed. The other phones must never learn what this one
       picked, and the TV's "answered" ticker is a separate cosmetic message the phone sends
       once the answer is in. */
    if (obj.t === 'ans') return await this.answer(ws, obj, a);
    this.relay(JSON.stringify(obj), ws);
  }

  /* A PHONE ANSWERS A TRIVIA QUESTION.
     Stored, stamped with the moment it ARRIVED, and acknowledged to that phone alone. The
     room decides nothing about it: not whether it is right, not whether it is in time. The
     Worker reads question_ends_at out of the database at Reveal and throws away anything
     stamped after it, exactly as the database does on the HTTP path today. */
  async answer(ws, obj, a) {
    const g = String(obj.g || '');
    const qseq = parseInt(obj.q, 10);
    const idx = parseInt(obj.i, 10);
    const h = String(obj.h || '').toLowerCase();
    const id = (typeof obj.id === 'string' && obj.id.length <= 40) ? obj.id : null;
    if (!ROOM_UUID_RE.test(g) || !ROOM_HASH_RE.test(h)
        || !(qseq >= 1 && qseq <= 100000) || !(idx >= 0 && idx <= 9)) return this.ansSay(ws, 'ans_no', id, qseq);
    /* ONE SOCKET, ONE IDENTITY, FOR AS LONG AS IT IS OPEN. The first token hash a socket
       uses is the only one it may ever use. Without this, one phone could spray made-up
       hashes and fill a room's storage with answers that belong to nobody. */
    if (a.h && a.h !== h) return this.ansSay(ws, 'ans_no', id, qseq);
    if (!a.h) { a.h = h; try { ws.serializeAttachment(a); } catch (e) {} }
    /* THE PHONE TELLS THE ROOM WHEN THE QUESTION SHUTS, so that a punter who is a second
       late hears "Too late, next one!" at the moment they always have, instead of
       "Answer in! Good luck." followed by no score. The room is not the authority on this
       and cannot be: the Worker still reads question_ends_at out of the database and drops
       anything stamped after it. A phone that sends a made up deadline, or none at all,
       gains nothing by it, because that check has not moved. */
    const shuts = (typeof obj.e === 'number' && obj.e > 0) ? obj.e : 0;
    if (shuts && Date.now() > shuts) return this.ansSay(ws, 'ans_late', id, qseq);
    const st = this.state.storage;
    /* A QUESTION IS CLOSED ONCE THE WORKER HAS TAKEN ITS ANSWERS, which is the room's half
       of the phase flip the database does at Reveal. The phone is told, and posts to the
       Worker instead, which answers with the same 409 it always did.
       ONE MARK PER QUESTION, and never "everything up to here". A trivia night is served in
       a RANDOM order (vp_host_question walks config.question_seqs by position, so
       current_seq is the seq of the question just served, not a counter), which means the
       next question can easily have a LOWER number than the one before it. A tidier
       "closed up to" mark was written first and would have refused every answer to every
       question after the first high-numbered one, on every randomised night, silently. */
    if (await st.get('c|' + g + '|' + qseq)) return this.ansSay(ws, 'ans_late', id, qseq);
    const key = 'a|' + g + '|' + qseq + '|' + h;
    // FIRST ANSWER IS FINAL, same rule the (game, question, player) unique index enforces.
    if (await st.get(key)) return this.ansSay(ws, 'ans_dup', id, qseq);
    const ck = g + '|' + qseq;
    let n = this.counts.get(ck);
    if (n == null) n = (await st.list({ prefix: 'a|' + g + '|' + qseq + '|' })).size;
    if (n >= ROOM_MAX_ANSWERS_PER_Q) return this.ansSay(ws, 'ans_no', id, qseq);
    /* AWAITED ON PURPOSE. The phone is not told "Answer in!" until the write has been
       confirmed, so the words on the screen mean the answer is on disk. */
    await st.put(key, { i: idx, at: Date.now() });
    this.counts.set(ck, n + 1);
    return this.ansSay(ws, 'ans_ok', id, qseq);
  }

  // The answering phone hears this, and only the answering phone.
  ansSay(ws, t, id, qseq) {
    try { ws.send(JSON.stringify({ t: t, id: id, q: (qseq >= 1 ? qseq : null) })); } catch (e) {}
  }

  /* THE HOST REVEALED: close this question and hand the Worker everything it holds for it.
     Called only from the game Worker's own code. Nothing is deleted here: the Worker acks
     once the row is actually in the database, so a failed write leaves the answers where
     they are rather than throwing away a punter's prize. */
  async take(request) {
    let b;
    try { b = await request.json(); } catch (e) { return roomJson({ error: 'bad json' }, 400); }
    const g = String((b && b.game_id) || '');
    const qseq = parseInt(b && b.qseq, 10);
    if (!ROOM_UUID_RE.test(g) || !(qseq >= 1)) return roomJson({ error: 'bad game or qseq' }, 400);
    const st = this.state.storage;
    const now = Date.now();
    await st.put('c|' + g + '|' + qseq, now);
    /* SWEPT BY AGE, not by question number, for the same reason the mark above is per
       question: the numbers are not in order. Six hours is three times the longest trivia
       night, so nothing a host could still reveal is ever swept, and an answer the database
       refused to take stays put long enough for the host to tap Reveal again. */
    const cutoff = now - ROOM_ANSWER_TTL_MS;
    const rows = await st.list({ prefix: 'a|' + g + '|' });
    const out = [], stale = [];
    rows.forEach(function (v, k) {
      const p = k.split('|');
      if (parseInt(p[2], 10) === qseq) out.push({ h: p[3], i: v.i, at: v.at });
      else if (!(v.at > cutoff)) stale.push(k);
    });
    const marks = await st.list({ prefix: 'c|' + g + '|' });
    marks.forEach(function (v, k) { if (!(v > cutoff)) stale.push(k); });
    if (stale.length) await st.delete(stale);
    out.sort(function (x, y) { return x.at - y.at; });   // oldest first: the earliest answer wins any tie
    return roomJson({ ok: true, qseq: qseq, answers: out });
  }

  // The Worker got them into the database. Now, and only now, the room lets them go.
  async ack(request) {
    let b;
    try { b = await request.json(); } catch (e) { return roomJson({ error: 'bad json' }, 400); }
    const g = String((b && b.game_id) || '');
    const qseq = parseInt(b && b.qseq, 10);
    if (!ROOM_UUID_RE.test(g) || !(qseq >= 1)) return roomJson({ error: 'bad game or qseq' }, 400);
    const hs = Array.isArray(b && b.hashes) ? b.hashes : [];
    const keys = [];
    for (let i = 0; i < hs.length; i++) {
      const h = String(hs[i] || '').toLowerCase();
      if (ROOM_HASH_RE.test(h)) keys.push('a|' + g + '|' + qseq + '|' + h);
    }
    let n = 0;
    if (keys.length) n = await this.state.storage.delete(keys);
    this.counts.delete(g + '|' + qseq);
    return roomJson({ ok: true, deleted: n || 0 });
  }

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) {}
  }

  webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch (e) {}
  }

  // The game Worker (HQ reload, a command) drops a message in. Everyone hears it.
  async publish(request) {
    let body;
    try { body = await request.json(); } catch (e) { return roomJson({ error: 'bad json' }, 400); }
    const payload = body && body.payload;
    if (!payload || typeof payload !== 'object' || !(typeof payload.t === 'string' || typeof payload.type === 'string')) return roomJson({ error: 'payload needs a type' }, 400);
    const str = JSON.stringify(payload);
    if (str.length > ROOM_MAX_MSG_CHARS) return roomJson({ error: 'too big' }, 413);
    return roomJson({ ok: true, delivered: this.relay(str, null) });
  }

  // Counts by role only. Never a name, a token or an address.
  presence() {
    /* answers: true says THIS room can hold a trivia answer, which is how a phone knows the
       Worker it is talking to is new enough to hand them over at Reveal. The site deploys
       itself from a push and a Worker is deployed separately, so for a while the new phone
       page will be talking to the old Worker. Without this flag that phone would post its
       answer into a room that only knows how to relay, nothing would write it, and the
       punter would lose the question. It is a boolean, never a count of anything. */
    const out = { total: 0, answers: true };
    for (let i = 0; i < ROOM_ROLES.length; i++) {
      const n = this.state.getWebSockets(ROOM_ROLES[i]).length;
      out[ROOM_ROLES[i]] = n;
      out.total += n;
    }
    return out;
  }

  // Send to every socket but `except`. A dead socket is skipped, not fatal.
  relay(str, except) {
    const all = this.state.getWebSockets();
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      if (all[i] === except) continue;
      try { all[i].send(str); n += 1; } catch (e) {}
    }
    return n;
  }
}

/* ---------------------------------------------------------------------------
 * The game Worker's side. These three go into venueplay-game.js next to /venue
 * (see ROOM-SERVER.md, "Wiring"). Every one of them is a no-op without env.ROOM.
 * ------------------------------------------------------------------------- */

function roomStub(env, name) {
  return env.ROOM.get(env.ROOM.idFromName(name));
}

// GET /room/ws?room=vp-XXXXXX&role=tv|host|phone|hq  (a WebSocket upgrade)
/* THE GLOBAL OFF SWITCH.
   Set the Worker variable ROOM_OFF to 1 in the Cloudflare dashboard and every venue in
   the country is back on Supabase Realtime within seconds, with no deploy, no push and
   nothing for a venue to do. It works by answering the same 503 that a Worker with no
   room binding answers, which is the fallback every page has been using and testing all
   along, rather than a second escape route that has never carried a night.
   Dean, 10 Sep 2026: "yes a global switch is good hopefully never have to use it." */
function roomOff(env) {
  const v = String(env.ROOM_OFF == null ? '' : env.ROOM_OFF).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
async function handleRoomSocket(request, env, json) {
  if (!env.ROOM || roomOff(env)) return json({ error: 'room server not enabled' }, 503);
  const url = new URL(request.url);
  const name = String(url.searchParams.get('room') || '').trim();
  if (!ROOM_NAME_RE.test(name)) return json({ error: 'bad room' }, 400);
  const role = String(url.searchParams.get('role') || 'phone');
  if (ROOM_ROLES.indexOf(role) < 0) return json({ error: 'bad role' }, 400);
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a websocket' }, 426);
  return roomStub(env, name).fetch(new Request('https://room/ws?role=' + encodeURIComponent(role), request));
}

// GET /room/presence?room=vp-XXXXXX  -> {total, tv, host, phone, hq}
async function handleRoomPresence(request, env, json) {
  if (!env.ROOM || roomOff(env)) return json({ error: 'room server not enabled' }, 503);
  const url = new URL(request.url);
  const name = String(url.searchParams.get('room') || '').trim();
  if (!ROOM_NAME_RE.test(name)) return json({ error: 'bad room' }, 400);
  const res = await roomStub(env, name).fetch('https://room/presence');
  return json(await res.json());
}

// Drop a message into a room from the Worker. Returns how many screens heard it.
// Never throws: no binding, a bad name or a room error all mean 0 and life goes on.
async function roomPublish(env, name, payload) {
  if (!env.ROOM || roomOff(env) || !ROOM_NAME_RE.test(String(name || ''))) return 0;
  try {
    const res = await roomStub(env, name).fetch('https://room/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: payload }),
    });
    const d = await res.json();
    return (d && d.delivered) || 0;
  } catch (e) {
    return 0;
  }
}

/* ---------------------------------------------------------------------------
 * THE ANSWERS ROOM IS PER GAME, NOT PER VENUE.
 *
 * The venue's room is "vp-<code>" and carries the host's messages to the screens. The
 * answers live in their own room named after the game, "vpa-<game id>", for two reasons
 * that are both about not being clever:
 *   - the Worker already has the game id when the host reveals, so it needs no lookup at
 *     all to find the right room. A reveal that had to work out a venue code first would
 *     be another database call on the one path this whole change exists to shorten.
 *   - everything the room holds is keyed by that game id as well, so a message aimed at
 *     the wrong room finds nothing and disturbs nothing.
 * ------------------------------------------------------------------------- */
function roomAnswerName(gameId) {
  return 'vpa-' + String(gameId || '');
}

/* THE HOST'S REVEAL NEVER WAITS ON THE ROOM.
   If the room is slow, missing, hibernating or wedged, the reveal goes ahead with whatever
   the database already has, which is exactly what happens for a venue that is not on the
   room server at all. A frozen screen in a full pub is worse than a lost second. */
function roomRace(p, ms) {
  let timer = null;
  const late = new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, ms); });
  return Promise.race([p, late]).then(function (v) { clearTimeout(timer); return v; },
                                      function (e) { clearTimeout(timer); throw e; });
}

// Close the question in the room and take every answer it holds for it. Null means
// "no room, or the room did not answer in time", and the caller carries on regardless.
async function roomAnswersTake(env, gameId, qseq) {
  if (!env.ROOM || roomOff(env)) return null;
  const name = roomAnswerName(gameId);
  if (!ROOM_NAME_RE.test(name) || !(qseq >= 1)) return null;
  try {
    const res = await roomRace(roomStub(env, name).fetch('https://room/answers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: gameId, qseq: qseq }),
    }), ROOM_TAKE_MS);
    if (!res || !res.ok) return null;
    const d = await res.json();
    return (d && Array.isArray(d.answers)) ? d.answers : null;
  } catch (e) {
    return null;
  }
}

// They are in the database now, so the room may forget them. Never throws.
async function roomAnswersAck(env, gameId, qseq, hashes) {
  if (!env.ROOM || roomOff(env) || !hashes || !hashes.length) return 0;
  const name = roomAnswerName(gameId);
  if (!ROOM_NAME_RE.test(name)) return 0;
  try {
    const res = await roomRace(roomStub(env, name).fetch('https://room/answers/ack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: gameId, qseq: qseq, hashes: hashes }),
    }), ROOM_TAKE_MS);
    if (!res || !res.ok) return 0;
    const d = await res.json();
    return (d && d.deleted) || 0;
  } catch (e) {
    return 0;
  }
}

export { handleRoomSocket, handleRoomPresence, roomPublish, roomOff, roomAnswerName, roomAnswersTake, roomAnswersAck, ROOM_NAME_RE, ROOM_ROLES, ROOM_MAX_PER_SEC, ROOM_MAX_MSG_CHARS, ROOM_MAX_ANSWERS_PER_Q, ROOM_TAKE_MS };
