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

/* ONE ROAD PER ROOM, DECIDED HERE (31 Oct 2026, making the room the default).
   A room and a Supabase channel do not cross: a console in the room and a TV on Supabase is a
   host talking to nobody, and it looks exactly like a working night. While the room was opt in
   that was a matter of putting the flag on all three links. As the DEFAULT it can happen on
   its own: one screen's socket drops for longer than its budget and it goes back to Supabase
   alone, or a page cached from before the switch is still open. So the fallback is no longer
   one page's private decision. A page that leaves the room HANDS IT OVER: the room tells
   every socket in it to go to Supabase too (and closes them with 4503), and for the next six
   hours answers 503 to anybody who asks, so a phone that joins late, a console that reloads
   or a TV that comes back all land on the same road as everyone else. Six hours is longer
   than any night; a console still open after that asks again (vp-room.js).
   The mark is the room's own, on disk, so it survives the room being evicted. */
const ROOM_HANDOVER_MS = 6 * 60 * 60 * 1000;

/* WHICH FORMATS ARE ON THE ROOM, DECIDED HERE AND NOWHERE ELSE (1 Nov 2026). Bingo is on the room
   by default (vp-room.js DEFAULT_ON). The other four move one at a time, each by its own line here
   and a Worker deploy, and every page asks: presence answers formats, and the TV's /venue poll
   carries the same answer as room_formats, so a screen that decided before a flip reloads onto it
   between games. A console that decided before a flip says road:"off" for a format that is on by
   the time it opens a game, and the Worker hands the venue over to meet it (roomOldConsoleCheck).
   To take a format back off the room: set its line to false and deploy; ROOM_OFF=1 is still the
   switch for everything at once, no deploy. */
const ROOM_FORMATS_ON = { musical: true, trivia: true, raffle: true, members: true };
function roomFormatsOn() {
  const o = {};
  for (const k in ROOM_FORMATS_ON) o[k] = ROOM_FORMATS_ON[k] === true;
  return o;
}
// The same answer as one string, "musical,trivia": the TV compares it, so the order is fixed.
function roomFormatsKey() {
  const f = roomFormatsOn(), out = [];
  for (const k in f) { if (f[k]) out.push(k); }
  return out.sort().join(',');
}
const ROOM_HANDOVER_CLOSE = 4503;                    // "go to Supabase": the page does not retry the room

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
    /* Until when this room is handed to Supabase (ms), read from storage once per wake. */
    this.hoUntil = null;
    /* A HEARTBEAT THAT DOES NOT WAKE THE ROOM. A socket that is idle for an hour between games
       can be cut by the venue's router without either end hearing a thing, and the TV would sit
       there "connected" to nothing when the first ball is called. Supabase has a heartbeat for
       exactly that reason; this is ours. The page sends "ping" and Cloudflare answers "pong"
       itself, without waking this object, so it costs nothing in room time. Guarded, because
       the test rig and an older runtime do not have it; webSocketMessage answers instead. */
    try {
      if (typeof WebSocketRequestResponsePair === 'function' && state && typeof state.setWebSocketAutoResponse === 'function') {
        state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
      }
    } catch (e) {}
  }

  async handedOver() {
    if (this.hoUntil == null) {
      let v = 0;
      try { v = (await this.state.storage.get('ho')) || 0; } catch (e) { v = 0; }
      this.hoUntil = v;
    }
    return this.hoUntil > Date.now();
  }

  /* EVERYONE GOES TO SUPABASE TOGETHER. Marked (mark=true) when a page handed the room over,
     so late arrivals follow for the next six hours; also called with the mark when the global
     switch ROOM_OFF is found on, so a room that keeps its sockets through the switch still
     sends them all the same way. Every socket hears it in words first, then by close code, so
     a page that misses one still gets the other. */
  async handover(mark, soft) {
    /* SOFT: "the venue has moved, make sure this room knows", said by a page passing the word on
       from one of the venue's other rooms (1 Nov 2026, every format on the room). It marks a room
       that is not marked yet and leaves an existing mark where it is, so a venue that keeps
       getting new pages does not keep pushing its own six hours further out. */
    if (mark && !(soft && await this.handedOver())) {
      this.hoUntil = Date.now() + ROOM_HANDOVER_MS;
      try { await this.state.storage.put('ho', this.hoUntil); } catch (e) {}
    }
    const all = this.state.getWebSockets();
    const word = JSON.stringify({ t: 'room_handover' });
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      try { all[i].send(word); } catch (e) {}
      try { all[i].close(ROOM_HANDOVER_CLOSE, 'handed over'); n += 1; } catch (e) {}
    }
    return roomJson({ ok: true, closed: n, until: this.hoUntil || 0 });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/handover' && request.method === 'POST') return await this.handover(true, url.searchParams.get('soft') === '1');
    /* A room that has been handed over takes nobody in and says so in the same 503 words a
       Worker with no room answers, which is the answer every page already falls back on. */
    if ((path === '/ws' || path === '/presence') && await this.handedOver()) {
      return roomJson({ error: 'room handed over', handed_over: true, until: this.hoUntil }, 503);
    }
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
    /* An ANSWERS room ("vpa-<game>") holds answers and acknowledges each phone alone; it has
       nothing to relay, so nothing in it is ever relayed. Marked on the socket at connect,
       because a Durable Object is not told its own name; the Worker passes it (roomConnect). */
    const answersOnly = /^vpa-/.test(String(url.searchParams.get('room') || ''));
    server.serializeAttachment({ role: role, since: Date.now(), win: 0, n: 0, ao: answersOnly });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Something in the room spoke: hand it to everyone else in the room.
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string') return;                 // binary is not a game message
    if (message === 'ping') { try { ws.send('pong'); } catch (e) {} return; }   // where the auto-response is not available
    /* THE GLOBAL SWITCH REACHES A ROOM THAT IS ALREADY OPEN. ROOM_OFF used to stop only NEW
       sockets, so the screens already in a room stayed there while every page that reloaded,
       and every phone that joined late, went to Supabase: half a venue on each road. The first
       message after the switch now sends the whole room across, together. */
    if (roomOff(this.env)) { await this.handover(true); return; }
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
    /* Only the room says "hand over". Relayed from a phone, it would send a whole venue to
       Supabase on one stranger's say so. */
    if (obj.t === 'room_handover') return;
    /* A trivia answer is HELD, not relayed. The other phones must never learn what this one
       picked, and the TV's "answered" ticker is a separate cosmetic message the phone sends
       once the answer is in. */
    if (obj.t === 'ans') return await this.answer(ws, obj, a);
    /* In an answers room a stranger could otherwise send {t:"ans_ok", id:"a3"} and be relayed
       to every phone, and the phone with a3 pending would read it as its acknowledgement
       (audit, 20 Sep 2026). Nothing but an answer has any business here. */
    if (a.ao) return;
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
    /* handover: true says this room hands a venue over as a whole (above). A page uses the room
       BY DEFAULT only when it says so, so a new page against an old Worker stays on Supabase,
       which is where the whole venue is. pong: true, the heartbeat is answered. */
    /* venue: true, this Worker hands a WHOLE venue over (every format's rooms together, and when a
       console from before the switch opens a game), so a page of another format may take the room
       by default, and a TV in it needs no ear on the old road (1 Nov 2026). */
    const out = { total: 0, answers: true, handover: true, pong: true, venue: true, formats: roomFormatsOn() };
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
/* POST /room/handover?room=vp-XXXXXX : a page has gone back to Supabase, so the whole room does.
   No sign in, on purpose. The page that calls it may be a TV, which has no key, and the worst
   anybody can do with it is put a venue on the road every venue used before 31 Oct 2026 for
   six hours. It works with ROOM_OFF on as well, so a venue that went across while the switch
   was on stays across when it is turned off again, instead of late phones finding an empty
   room. Bingo rooms only: an answers room (vpa-) is per game and is never handed over. */
/* ONE VENUE IS FIVE ROOMS (1 Nov 2026, every format on the room). Bingo meets on "vp-" + the
   venue's code, and musical bingo, trivia, raffle and the members draw each have a screen channel
   of their own, "vp-" + the code of "<format>-<slug>", which the TV's router listens on all day.
   The players' channel for musical and trivia is the session's join code, which is the venue's
   own code, so it is the first room here. The same hash every page uses (venueCode in tv.html,
   VP.venueCode in vp-session.js, fnvVenueCode in the game Worker); a test holds all four to it. */
const ROOM_FORMATS = ['trivia', 'musical', 'raffle', 'members'];
const ROOM_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
function roomVenueCode(slug) {
  let s = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, ''), h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const A = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'; let out = '', x = h || 1;
  for (let j = 0; j < 6; j++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out += A[x % A.length]; }
  return out;
}
function roomVenueRooms(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!ROOM_SLUG_RE.test(s)) return [];
  const out = ['vp-' + roomVenueCode(s)];
  for (let i = 0; i < ROOM_FORMATS.length; i++) out.push('vp-' + roomVenueCode(ROOM_FORMATS[i] + '-' + s));
  return out;
}

/* Hand every named room over, side by side. Returns how many sockets were closed; never throws.
   A room that does not answer is left: the pages in it hear the word from the venue's other rooms
   (any page in two of them passes it on) or are turned away when they next ask. */
async function roomHandOverAll(env, names, soft) {
  if (!env.ROOM || !names || !names.length) return 0;
  const results = await Promise.all(names.map(function (n) {
    return roomStub(env, n).fetch('https://room/handover' + (soft ? '?soft=1' : ''), { method: 'POST' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
  }));
  let closed = 0;
  for (let i = 0; i < results.length; i++) closed += (results[i] && results[i].closed) || 0;
  return closed;
}

/* A CONSOLE FROM BEFORE THE SWITCH OPENS A GAME. It is on Supabase and will stay there, and a TV
   in the room no longer keeps an ear on the old road to hear it (that ear was one Supabase
   connection per TV, all day, which is what the room exists to save). So the Worker hears it
   instead: every console new enough to know about the room says which road it is on when it opens
   a game (road: "room", "supabase", or "off" for a format not on the room yet). One that says
   nothing is from before the switch, so the whole venue is handed over to meet it. "supabase" is a
   console that already handed the venue over itself; the word is passed on softly in case that
   did not land. Called from POST /session and the members draw with the format the console is
   opening; best effort, never throws, and costs nothing for a console on the room. */
async function roomOldConsoleCheck(env, road, fmt, slugOf) {
  if (!env.ROOM) return 0;
  const r = String(road == null ? '' : road);
  if (r === 'room' || r === 'checking') return 0;
  /* "off": the Worker said this format was not on the room when the console asked. Still true,
     nothing to do. On since then, the console is on the old road with the format's room open to
     everyone else, so it is handled as a console from before the switch. */
  if (r === 'off' && !(fmt && roomFormatsOn()[fmt] === true)) return 0;
  try {
    const slug = await slugOf();
    const names = roomVenueRooms(slug);
    if (!names.length) return 0;
    return (await roomRace(roomHandOverAll(env, names, r === 'supabase'), ROOM_TAKE_MS)) || 0;
  } catch (e) {
    return 0;
  }
}

/* venue=<slug> hands over every room of that venue, not just the one named (1 Nov 2026): a
   musical console that gives up must take the TV's router with it, and the raffle room nobody is
   in yet must turn the raffle console away when it opens tonight. soft=1 passes the word on
   without pushing an existing mark further out (see VenueRoom.handover). */
async function handleRoomHandover(request, env, json) {
  if (!env.ROOM) return json({ error: 'room server not enabled' }, 503);
  const url = new URL(request.url);
  const name = String(url.searchParams.get('room') || '').trim();
  if (!ROOM_NAME_RE.test(name) || !/^vp-/.test(name)) return json({ error: 'bad room' }, 400);
  const soft = url.searchParams.get('soft') === '1';
  const venue = url.searchParams.get('venue');
  if (venue != null && venue !== '') {
    const names = roomVenueRooms(venue);
    if (!names.length) return json({ error: 'bad venue' }, 400);
    if (names.indexOf(name) < 0) names.unshift(name);       // a players' room on a join code of its own
    const closed = await roomHandOverAll(env, names, soft);
    return json({ ok: true, rooms: names.length, closed: closed });
  }
  try {
    const res = await roomStub(env, name).fetch('https://room/handover' + (soft ? '?soft=1' : ''), { method: 'POST' });
    return json(await res.json());
  } catch (e) {
    return json({ error: 'the room did not answer' }, 502);
  }
}

async function handleRoomSocket(request, env, json) {
  if (!env.ROOM || roomOff(env)) return json({ error: 'room server not enabled' }, 503);
  const url = new URL(request.url);
  const name = String(url.searchParams.get('room') || '').trim();
  if (!ROOM_NAME_RE.test(name)) return json({ error: 'bad room' }, 400);
  const role = String(url.searchParams.get('role') || 'phone');
  if (ROOM_ROLES.indexOf(role) < 0) return json({ error: 'bad role' }, 400);
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected a websocket' }, 426);
  return roomStub(env, name).fetch(new Request('https://room/ws?role=' + encodeURIComponent(role) + '&room=' + encodeURIComponent(name), request));
}

// GET /room/presence?room=vp-XXXXXX  -> {total, tv, host, phone, hq}
async function handleRoomPresence(request, env, json) {
  if (!env.ROOM || roomOff(env)) return json({ error: 'room server not enabled' }, 503);
  const url = new URL(request.url);
  const name = String(url.searchParams.get('room') || '').trim();
  if (!ROOM_NAME_RE.test(name)) return json({ error: 'bad room' }, 400);
  const res = await roomStub(env, name).fetch('https://room/presence');
  return json(await res.json(), res.status);
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
/* NOT STOPPED BY ROOM_OFF. The switch stops pages using the room; it must not strand the answers
   a room is already holding. Before 31 Oct 2026 turning the switch on mid-question meant Reveal
   never asked the room, and every answer it held for that question scored nothing. */
async function roomAnswersTake(env, gameId, qseq) {
  if (!env.ROOM) return null;
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
  if (!env.ROOM || !hashes || !hashes.length) return 0;
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

export { handleRoomSocket, handleRoomPresence, handleRoomHandover, roomFormatsOn, roomFormatsKey, ROOM_FORMATS_ON, roomVenueCode, roomVenueRooms, roomHandOverAll, roomOldConsoleCheck, ROOM_FORMATS, ROOM_HANDOVER_MS, ROOM_HANDOVER_CLOSE, roomPublish, roomOff, roomAnswerName, roomAnswersTake, roomAnswersAck, ROOM_NAME_RE, ROOM_ROLES, ROOM_MAX_PER_SEC, ROOM_MAX_MSG_CHARS, ROOM_MAX_ANSWERS_PER_Q, ROOM_TAKE_MS };
