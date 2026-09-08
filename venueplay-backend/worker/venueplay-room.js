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
const ROOM_MAX_PER_SEC   = 20;               // per socket; the excess is dropped, the socket kept
const ROOM_ROLES         = ['tv', 'host', 'phone', 'hq'];
const ROOM_NAME_RE       = /^[A-Za-z0-9-]{3,90}$/;   // the channel name the page already uses, e.g. vp-3A7TES

function roomJson(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

export class VenueRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/ws') return this.connect(request, url);
    if (path === '/publish' && request.method === 'POST') return this.publish(request);
    if (path === '/presence') return roomJson(this.presence());
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
  webSocketMessage(ws, message) {
    if (typeof message !== 'string') return;                 // binary is not a game message
    if (message.length > ROOM_MAX_MSG_CHARS) return;
    const a = ws.deserializeAttachment() || { role: 'phone', since: 0, win: 0, n: 0 };
    const win = Math.floor(Date.now() / 1000);
    if (a.win !== win) { a.win = win; a.n = 0; }
    a.n += 1;
    ws.serializeAttachment(a);
    if (a.n > ROOM_MAX_PER_SEC) return;                      // a flood is dropped; the socket stays up
    let obj;
    try { obj = JSON.parse(message); } catch (e) { return; }
    if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') return;
    this.relay(JSON.stringify(obj), ws);
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
    if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') return roomJson({ error: 'payload needs a type' }, 400);
    const str = JSON.stringify(payload);
    if (str.length > ROOM_MAX_MSG_CHARS) return roomJson({ error: 'too big' }, 413);
    return roomJson({ ok: true, delivered: this.relay(str, null) });
  }

  // Counts by role only. Never a name, a token or an address.
  presence() {
    const out = { total: 0 };
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
async function handleRoomSocket(request, env, json) {
  if (!env.ROOM) return json({ error: 'room server not enabled' }, 503);
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
  if (!env.ROOM) return json({ error: 'room server not enabled' }, 503);
  const url = new URL(request.url);
  const name = String(url.searchParams.get('room') || '').trim();
  if (!ROOM_NAME_RE.test(name)) return json({ error: 'bad room' }, 400);
  const res = await roomStub(env, name).fetch('https://room/presence');
  return json(await res.json());
}

// Drop a message into a room from the Worker. Returns how many screens heard it.
// Never throws: no binding, a bad name or a room error all mean 0 and life goes on.
async function roomPublish(env, name, payload) {
  if (!env.ROOM || !ROOM_NAME_RE.test(String(name || ''))) return 0;
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

export { handleRoomSocket, handleRoomPresence, roomPublish, ROOM_NAME_RE, ROOM_ROLES, ROOM_MAX_PER_SEC, ROOM_MAX_MSG_CHARS };
