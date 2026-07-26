/**
 * VenuePlay GAME Worker  (venueplay-game)  -- DRAFT FOR REVIEW, NOT FOR DEPLOY
 * ----------------------------------------------------------------------------
 * The server-authoritative referee for the live game. This Worker is the ONLY
 * writer of game state. It holds the service_role key (which bypasses RLS by
 * design), so it re-implements every authorisation check in its own code before
 * it writes anything. Phones and the TV never write; they read snapshots and
 * listen to Realtime broadcasts. A broadcast happens because the Worker inserts
 * a row into vp_session_events, which a database trigger fans out to the session
 * topic. Writing an event row IS how we push to the TV and the phones.
 *
 * This is a separate Worker from the billing one (venueplay-api). That Worker
 * keeps owning /checkout, /webhook and /contact. This one owns the game.
 *
 * ROUTES (all JSON; CORS enabled)
 *   POST /session            (host)   create a lobby session for the host's venue
 *   POST /join               (player) join by code, mint a player token
 *   POST /host/game          (host)   start a 90-ball bingo game: draw order + deal tickets
 *   POST /host/ball          (host)   draw the next ball
 *   POST /player/claim       (player) claim a win; server verifies against its card
 *   POST /host/claim/resolve (host)   confirm or reject a claim
 *   GET  /snapshot?session=  (public) PUBLIC projection only, for TV and late joiners
 *
 * ENV VARS (set in the Worker: Settings -> Variables; use a TEST project first)
 *   SUPABASE_URL           https://gpoolavkghnxedzrmtmc.supabase.co
 *   SUPABASE_SERVICE_KEY   service_role key (NOT the anon key -- keep secret;
 *                          this is what lets the Worker write past RLS)
 *   SUPABASE_JWT_SECRET    the project's JWT secret (HS256) used to verify host
 *                          Supabase Auth tokens
 *   SITE_URL               https://www.venueplay.com.au  (for CORS / links)
 *   ALLOW_ORIGIN           (optional) e.g. https://www.venueplay.com.au; default *
 *   IP_HASH_SALT           (optional) salt for the ip/device hashes; default 'venueplay'
 *
 * WORKER BINDINGS TO ADD AT DEPLOY (wrangler config, not code)
 *   RL   (recommended) a Workers KV namespace binding named RL. It powers the
 *        anti-abuse rate limit + soft dedup on the two abuse-facing endpoints,
 *        /join (unauthenticated) and /player/claim. When the RL binding is
 *        PRESENT the limiter and dedup are LIVE; when it is ABSENT the Worker
 *        logs one warning and degrades safely (every endpoint still functions,
 *        just without the throttle). Add it before launch so a scripted /join
 *        flood cannot inflate an honest venue onto peak-player overage, spam the
 *        TV or grow vp_players unbounded. Tune the JOIN_MAX_* / CLAIM_MAX_*
 *        constants below to the venue sizes you serve (a whole venue shares one
 *        NAT IP, so the per-IP cap is deliberately generous).
 *   TURNSTILE_SECRET (optional, future) a Cloudflare Turnstile secret. The
 *        limiter is the launch control; a Turnstile challenge on the phone once
 *        the per-IP counter trips is the planned escalation (design section 7).
 *        Verify the token server-side here before allowing the join when wired.
 *
 * All game randomness (ball shuffle, card deals, tokens, codes) is CSPRNG via
 * crypto.getRandomValues / crypto.subtle. Australian English throughout.
 * ----------------------------------------------------------------------------
 */

/* ---------------------------------------------------------------------------
 * ANTI-ABUSE TUNING (soft limits; Workers KV is eventually consistent so these
 * are approximate under a burst, which is fine for abuse control). All windows
 * are 60s because Workers KV requires expirationTtl >= 60.
 * ------------------------------------------------------------------------- */
const JOIN_MAX_PER_IP = 300;      // joins per 60s per network. Generous: a whole venue shares one NAT IP. Raise for big venues.
const JOIN_MAX_PER_DEVICE = 8;    // joins per 60s per device hint. One phone should not join many times a minute.
const CLAIM_MAX_PER_PLAYER = 20;  // claims per 60s per player. Stops a joined attacker spamming BINGO + the TV overlay.
const JOIN_DEDUP_TTL = 120;       // seconds a device's player_id is remembered, so a rapid re-join reuses its row.

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Player-Token',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    // CORS preflight, same shape as the billing Worker.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = request.method;

    try {
      if (method === 'POST' && path === '/session')            return await handleCreateSession(request, env, json);
      if (method === 'POST' && path === '/join')               return await handleJoin(request, env, json);
      if (method === 'POST' && path === '/host/game')          return await handleHostGame(request, env, json);
      if (method === 'POST' && path === '/host/ball')          return await handleHostBall(request, env, json);
      if (method === 'POST' && path === '/player/claim')       return await handlePlayerClaim(request, env, json);
      if (method === 'POST' && path === '/host/claim/resolve') return await handleClaimResolve(request, env, json);
      if (method === 'GET'  && path === '/snapshot')           return await handleSnapshot(request, env, json);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      // M5: only errors we raised on purpose (they carry a numeric .status and a
      // curated, safe message) are echoed to the client. Anything unexpected is
      // logged server-side under an opaque ref and returned as a generic 500, so
      // no stack, constraint, column or SQL detail ever leaks.
      if (e && e.status) return json({ error: String(e.message) }, e.status);
      const code = errRef();
      console.log('[' + code + '] unhandled: ' + String((e && e.stack) || (e && e.message) || e));
      return json({ error: 'Something went wrong', code }, 500);
    }
  },
};

/* =====================================================================
 * ROUTE HANDLERS
 * ===================================================================== */

/* ------------------------------ POST /session ------------------------------
 * Host creates a lobby session for their venue. Auth is enforced twice: a valid
 * Supabase host JWT, then staff membership at the target venue.
 */
async function handleCreateSession(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const venueId = String(b.venue_id || '').trim();
  if (!venueId) return json({ error: 'Missing venue_id' }, 400);
  assertUuid(venueId, 'venue_id');                                // reject anything that is not a UUID before it reaches PostgREST

  const staff = await requireStaff(env, authUserId, venueId);     // ENFORCED: staff at THIS venue (also enforces the kill-switch)

  // Freeze the plan cap into the session so historical metering stays stable.
  // Independent venues: cap = venueplay_founding.max_seats. Grouped venues:
  // cap = vp_venues.included_players.
  const venues = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=id,founding_id,included_players');
  if (!venues.length) return json({ error: 'Venue not found' }, 404);
  const venue = venues[0];
  let planCap = venue.included_players != null ? venue.included_players : null;
  if (venue.founding_id) {
    const f = await sbGet(env, 'venueplay_founding', 'id=eq.' + enc(venue.founding_id) + '&select=max_seats');
    if (f.length) planCap = f[0].max_seats;
  }

  // Generate a join code from the 29-char ambiguity-free alphabet. A partial
  // unique index enforces uniqueness among live sessions, so retry on a clash.
  const tvPairingCode = genCode(4);
  let session = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const joinCode = genCode(6);
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_sessions', {
      method: 'POST',
      headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({
        venue_id: venueId,
        join_code: joinCode,
        tv_pairing_code: tvPairingCode,
        status: 'lobby',
        state_version: 0,
        plan_cap_at_start: planCap,
        opened_at: new Date().toISOString(),
        created_by: staff.id,   // vp_venue_staff.id, for the audit trail
      }),
    });
    if (res.ok) { const d = await res.json(); session = Array.isArray(d) ? d[0] : d; break; }
    if (res.status === 409) continue;   // join_code (or one-live-session) clash, try another code
    throw dbError('insert', 'vp_sessions', await res.text());   // M5: log detail, return generic + code
  }
  if (!session) return json({ error: 'Could not allocate a unique join code, or a session is already live for this venue' }, 409);

  return json({ session_id: session.id, join_code: session.join_code, tv_pairing_code: session.tv_pairing_code });
}

/* ------------------------------ POST /join ------------------------------
 * Player joins with a code. No auth. The Worker mints a 256-bit token, stores
 * ONLY its sha256, and returns the raw token once plus a public snapshot.
 */
async function handleJoin(request, env, json) {
  const b = await readJson(request);
  const code = String(b.code || '').trim().toUpperCase();
  assertJoinCode(code);   // reject anything not in the 6-char, no-lookalike alphabet before it reaches PostgREST

  // Salted, coarse abuse signals. Raw IP / UA are NEVER stored; only these hashes.
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '';
  const salt = env.IP_HASH_SALT || 'venueplay';
  const ipHash = ip ? await sha256Hex(salt + ':' + ip) : null;
  const ua = request.headers.get('user-agent') || '';
  const deviceHint = ua ? (await sha256Hex(salt + ':ua:' + ua)).slice(0, 32) : null;

  // Anti-abuse rate limit (LIVE when the env.RL KV binding exists; degrades safely
  // to allow-and-warn when absent). /join is the one unauthenticated write and it
  // mints a metered vp_players row, so a scripted flood would inflate an honest
  // venue onto peak-player overage, spam the TV and grow rows unbounded. Cap per
  // network (generous: a whole venue shares one NAT IP) and per device hint.
  if (ipHash) {
    const rl = await rateLimit(env, 'join:ip:' + ipHash, JOIN_MAX_PER_IP, 60);
    if (!rl.ok) return json({ error: 'Too many joins from this network right now, please wait a moment' }, 429);
  }
  if (deviceHint) {
    const rl = await rateLimit(env, 'join:dev:' + deviceHint, JOIN_MAX_PER_DEVICE, 60);
    if (!rl.ok) return json({ error: 'Too many joins from this device right now, please wait a moment' }, 429);
  }

  const sessions = await sbGet(env, 'vp_sessions', 'join_code=eq.' + enc(code) + '&status=in.(lobby,running,paused)&select=*');
  if (!sessions.length) return json({ error: 'No active game with that code' }, 404);
  const session = sessions[0];

  // Kill-switch: a suspended venue (or its group) must not accrue more metered
  // rows/events, even though /join has no host login to gate on. Same check
  // requireStaff applies to host routes.
  await assertVenueActive(env, session.venue_id);

  const name = cleanName(b.name);

  // Soft dedup (LIVE only with env.RL): a rapid re-join from the same network +
  // device hint reuses that device's existing player row instead of minting a new
  // metered one. We remembered the player_id in KV under a short TTL, so this is a
  // burst-window guard (double-tap / retry / refresh), NOT a permanent identity
  // merge, keeping the risk of collapsing two distinct patrons who share a NAT IP
  // and browser to the TTL window. On reuse we rotate a fresh token onto the row
  // and do NOT re-broadcast player.joined (the player count has not changed).
  const dedupKey = (env.RL && (ipHash || deviceHint))
    ? 'joindedup:' + session.id + ':' + (ipHash || '-') + ':' + (deviceHint || '-')
    : null;
  if (dedupKey) {
    let priorId = null;
    try { priorId = await env.RL.get(dedupKey); } catch (e) { rlWarn(); }
    if (priorId && UUID_RE.test(priorId)) {
      const existing = await sbGet(env, 'vp_players',
        'id=eq.' + enc(priorId) + '&session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id');
      if (existing.length) {
        const token = randomTokenHex(32);            // fresh 256-bit token onto the SAME row
        const patch = { token_hash: await sha256Hex(token), last_seen_at: new Date().toISOString() };
        if (name) patch.display_name = name;
        await sbPatch(env, 'vp_players', 'id=eq.' + enc(priorId), patch);
        const snapshot = await getPublicSnapshot(env, session.id);
        return json({ token, snapshot });
      }
    }
  }

  const token = randomTokenHex(32);            // 256-bit, returned once, never stored raw
  const tokenHash = await sha256Hex(token);    // only the hash is stored

  const playerRow = {
    session_id: session.id,
    token_hash: tokenHash,
    display_name: name,
    joined_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };
  if (ipHash) playerRow.ip_hash = ipHash;          // salted hash only, never a raw IP
  if (deviceHint) playerRow.device_hint = deviceHint;  // coarse fingerprint, soft dedup signal only
  const inserted = await sbInsert(env, 'vp_players', playerRow, true);
  const newPlayer = Array.isArray(inserted) ? inserted[0] : inserted;

  // Remember this device's player_id so the next rapid re-join reuses this row.
  if (dedupKey && newPlayer && newPlayer.id) {
    try { await env.RL.put(dedupKey, newPlayer.id, { expirationTtl: JOIN_DEDUP_TTL }); } catch (e) { rlWarn(); }
  }

  // Broadcast player.joined (this insert is what pushes the TV welcome ticker).
  const players = await sbGet(env, 'vp_players', 'session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id');
  const payload = { player_count: players.length };
  if (name) payload.display_name = name;       // name on TV only if the player gave one
  await emitEvent(env, session, 'player.joined', payload, 'system');

  const snapshot = await getPublicSnapshot(env, session.id);
  return json({ token, snapshot });
}

/* ------------------------------ POST /host/game ------------------------------
 * Host starts a 90-ball bingo game. The Worker builds the server-side
 * Fisher-Yates draw order (CSPRNG), stores it (never sent to clients), and deals
 * a valid 3-row x 9-column ticket to every current non-kicked player.
 */
async function handleHostGame(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const sessionId = String(b.session_id || '').trim();
  const pattern = b.pattern;
  const validPatterns = ['one_line', 'two_lines', 'full_house'];   // 90-ball patterns; no four_corners
  if (!sessionId) return json({ error: 'Missing session_id' }, 400);
  assertUuid(sessionId, 'session_id');   // reject non-UUID before it reaches PostgREST
  if (!validPatterns.includes(pattern)) return json({ error: 'Invalid pattern' }, 400);

  const sessions = await sbGet(env, 'vp_sessions', 'id=eq.' + enc(sessionId) + '&select=*');
  if (!sessions.length) return json({ error: 'Session not found' }, 404);
  const session = sessions[0];
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the session's venue (also kill-switch)

  // Next game sequence number within the session.
  const existing = await sbGet(env, 'vp_games', 'session_id=eq.' + enc(sessionId) + '&select=seq&order=seq.desc&limit=1');
  const seq = existing.length ? existing[0].seq + 1 : 1;

  const config = {};
  if (b.prize) config.prize = String(b.prize).slice(0, 120);   // host-typed prize text, shown on TV
  if (b.title) config.title = String(b.title).slice(0, 120);

  const gameRows = await sbInsert(env, 'vp_games', {
    session_id: sessionId,
    seq,
    format: 'bingo90',   // 90-ball housie; migration 07 widened vp_games_format_check to allow this
    status: 'running',
    config,
    started_at: new Date().toISOString(),
  }, true);
  const game = Array.isArray(gameRows) ? gameRows[0] : gameRows;

  // Server draw: a full CSPRNG Fisher-Yates permutation of 1..90. Stored in
  // vp_bingo_games.draw_order and NEVER sent to any client.
  const drawOrder = shuffle1to90();
  const drawSeed = randomTokenHex(16);   // stored for audit ("prove the draw was fair")
  await sbInsert(env, 'vp_bingo_games', {
    game_id: game.id,
    draw_seed: drawSeed,
    draw_order: drawOrder,
    draw_index: 0,
    pattern,
    auto_daub: false,
  }, false);

  // Deal one ticket to every current non-kicked player.
  const players = await sbGet(env, 'vp_players', 'session_id=eq.' + enc(sessionId) + '&kicked=eq.false&select=id');
  const cards = players.map((p, i) => ({
    game_id: game.id,
    player_id: p.id,
    card_no: i + 1,
    cells: generateTicket(),
  }));
  if (cards.length) await sbInsert(env, 'vp_cards', cards, false);

  // One broadcastable change: the game started.
  await emitEvent(env, session, 'game.started', {
    game_id: game.id, seq, format: 'bingo90', pattern,
    prize: config.prize || null, title: config.title || null,
  }, 'host:' + staff.id);

  return json({ game_id: game.id, seq, pattern, cards_dealt: cards.length });
}

/* ------------------------------ POST /host/ball ------------------------------
 * Host draws the next ball. Advance draw_index, read the next number from the
 * pre-shuffled order, broadcast bingo.ball_drawn.
 */
async function handleHostBall(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');   // reject non-UUID before it reaches PostgREST

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  // L9: a ball can only be drawn while the game is actually running.
  if (games[0].status !== 'running') return json({ error: 'This game is not running' }, 409);
  const session = await getSession(env, games[0].session_id);
  // L9: and never on a session that has been closed.
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the game's venue (also kill-switch)

  // M2/M3: draw atomically in Postgres. vp_draw_next_ball advances draw_index and
  // returns the newly drawn number in one statement, so two concurrent draws can
  // never read the same index and emit the same ball. An empty result means every
  // ball is already drawn (or the game has no bingo row).
  const drawn = await sbRpc(env, 'vp_draw_next_ball', { p_game: gameId });
  const row = Array.isArray(drawn) ? drawn[0] : drawn;
  if (!row || row.number == null) return json({ error: 'All 90 balls have been drawn' }, 409);
  const number = row.number;
  const newIndex = row.new_index;

  // 90-ball has no letter: emit just the number and its position in the draw.
  await emitEvent(env, session, 'bingo.ball_drawn', {
    number, index: newIndex, ordinal: newIndex, drawn_count: newIndex,
  }, 'host:' + staff.id);

  return json({ number, index: newIndex });
}

/* ------------------------------ POST /player/claim ------------------------------
 * Player taps BINGO. The Worker NEVER trusts the phone: it loads the server's
 * copy of the card and the server's drawn set, and computes the verdict itself.
 */
async function handlePlayerClaim(request, env, json) {
  const player = await verifyPlayerToken(request, env);          // ENFORCED: valid player token
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');   // reject non-UUID before it reaches PostgREST

  // Anti-abuse rate limit (LIVE with env.RL, else allow-and-warn). A joined
  // attacker could otherwise spam claims, flooding vp_claims and the TV overlay.
  const rl = await rateLimit(env, 'claim:player:' + player.id, CLAIM_MAX_PER_PLAYER, 60);
  if (!rl.ok) return json({ error: 'Too many claims right now, please wait a moment' }, 429);

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.session_id !== player.session_id) return json({ error: 'Player is not in this game' }, 403);
  // L9: claims are only accepted while the game is running.
  if (game.status !== 'running') return json({ error: 'This game is not running' }, 409);

  const session = await getSession(env, game.session_id);
  // L9: and never on a closed session.
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  // Kill-switch: a suspended venue (or group) must not accrue more metered events.
  await assertVenueActive(env, session.venue_id);

  const cards = await sbGet(env, 'vp_cards', 'game_id=eq.' + enc(gameId) + '&player_id=eq.' + enc(player.id) + '&select=id,card_no,cells');
  if (!cards.length) return json({ error: 'No card for this player in this game' }, 404);
  const card = cards[0];

  // Soft per-(game, player, card) uniqueness: if a pending claim for this exact
  // card is already awaiting the host, return it rather than inserting a duplicate
  // row and re-broadcasting the claim to the TV overlay. There is no DB unique
  // index for this, so the guard lives here.
  const pending = await sbGet(env, 'vp_claims',
    'game_id=eq.' + enc(gameId) + '&player_id=eq.' + enc(player.id) + '&card_id=eq.' + enc(card.id) +
    '&status=eq.pending&select=id,auto_verdict,winning_cells&order=claimed_at.desc&limit=1');
  if (pending.length) {
    const p = pending[0];
    return json({ claim_id: p.id, auto_verdict: p.auto_verdict, winning_cells: p.winning_cells || null, card_no: card.card_no });
  }

  const bg = await sbGet(env, 'vp_bingo_games', 'game_id=eq.' + enc(gameId) + '&select=draw_order,draw_index,pattern');
  if (!bg.length) return json({ error: 'Not a bingo game' }, 404);
  const order = bg[0].draw_order || [];
  const drawnSet = new Set(order.slice(0, bg[0].draw_index || 0));   // only numbers actually drawn

  // Server-authoritative verdict: does the pattern complete on the server ticket
  // using the drawn numbers alone (there is no free centre in 90-ball)? Daubs and
  // anything client-side are irrelevant.
  const result = checkPattern(bg[0].pattern, card.cells, drawnSet);
  const verdict = result.valid ? 'valid' : 'invalid';

  const claimRows = await sbInsert(env, 'vp_claims', {
    game_id: gameId,
    player_id: player.id,
    card_id: card.id,
    claimed_at: new Date().toISOString(),   // server clock; ties resolve in this order
    auto_verdict: verdict,
    winning_cells: result.valid ? result.cells : null,
    status: 'pending',
  }, true);
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;

  await emitEvent(env, session, 'bingo.claim_submitted', {
    claim_id: claim.id, display_name: player.display_name || null, card_no: card.card_no,
  }, 'player:' + player.id);

  return json({ claim_id: claim.id, auto_verdict: verdict, winning_cells: result.valid ? result.cells : null, card_no: card.card_no });
}

/* ------------------------------ POST /host/claim/resolve ------------------------------
 * Host confirms or rejects a claim (prize handover is a human act on top of the
 * mathematical auto_verdict).
 */
async function handleClaimResolve(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);          // ENFORCED: valid host JWT
  const b = await readJson(request);
  const claimId = String(b.claim_id || '').trim();
  const decision = b.decision;
  if (!claimId) return json({ error: 'Missing claim_id' }, 400);
  assertUuid(claimId, 'claim_id');   // reject non-UUID before it reaches PostgREST
  if (decision !== 'confirm' && decision !== 'reject') return json({ error: 'decision must be "confirm" or "reject"' }, 400);

  const claims = await sbGet(env, 'vp_claims', 'id=eq.' + enc(claimId) + '&select=*');
  if (!claims.length) return json({ error: 'Claim not found' }, 404);
  const claim = claims[0];
  // Idempotency: an already-resolved claim cannot be re-resolved or re-broadcast.
  // Without this, a host double-tap would flip status again and fire a second
  // bingo.claim_result to the TV overlay.
  if (claim.status !== 'pending') return json({ error: 'This claim has already been resolved' }, 409);

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(claim.game_id) + '&select=id,session_id');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const session = await getSession(env, games[0].session_id);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the claim's venue (also kill-switch)

  const status = decision === 'confirm' ? 'confirmed' : 'rejected';
  await sbPatch(env, 'vp_claims', 'id=eq.' + enc(claimId), {
    status, resolved_by: staff.id, resolved_at: new Date().toISOString(),
  });

  // Enrich the broadcast for the TV overlay.
  const players = await sbGet(env, 'vp_players', 'id=eq.' + enc(claim.player_id) + '&select=display_name');
  const cards = await sbGet(env, 'vp_cards', 'id=eq.' + enc(claim.card_id) + '&select=card_no');
  const payload = {
    claim_id: claimId, status,
    display_name: players.length ? players[0].display_name : null,
    card_no: cards.length ? cards[0].card_no : null,
  };
  if (status === 'confirmed' && claim.winning_cells) payload.winning_cells = claim.winning_cells;
  await emitEvent(env, session, 'bingo.claim_result', payload, 'host:' + staff.id);

  return json({ claim_id: claimId, status });
}

/* ------------------------------ GET /snapshot ------------------------------
 * PUBLIC projection only. Safe for the TV and late joiners: no draw_order, no
 * token_hash, no correct answers, no PII.
 */
async function handleSnapshot(request, env, json) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  if (!sessionId) return json({ error: 'Missing session' }, 400);
  const snapshot = await getPublicSnapshot(env, sessionId);
  return json(snapshot);
}

/* =====================================================================
 * AUTH HELPERS  (re-checked on EVERY request; service_role bypasses RLS,
 * so authorisation lives here in code)
 * ===================================================================== */

// Verify the Supabase Auth JWT (HS256) from Authorization: Bearer, return the
// auth user id (the JWT "sub" claim). Enforced at the top of every host route.
async function verifyHostJwt(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw httpError(401, 'Missing Authorization bearer token');
  const payload = await verifyJwtHS256(m[1], env.SUPABASE_JWT_SECRET);
  if (!payload.sub) throw httpError(401, 'Token has no subject');
  return payload.sub;   // auth.users.id
}

// Confirm the auth user is staff at the target venue. Returns the staff row
// (id + role). This is the cross-venue-leakage gate: the venue is re-derived
// per request and matched against the target.
async function requireStaff(env, authUserId, venueId) {
  assertUuid(authUserId, 'user');     // sub claim from the verified JWT
  assertUuid(venueId, 'venue_id');    // re-derived per request; never trusted raw
  const rows = await sbGet(env, 'vp_venue_staff',
    'auth_user_id=eq.' + enc(authUserId) + '&venue_id=eq.' + enc(venueId) + '&select=id,role,venue_id');
  if (!rows.length) throw httpError(403, 'Not authorised: you are not staff at this venue');

  // M6 kill-switch: an admin-suspended venue (or its group) cannot run games,
  // regardless of a valid host login or Stripe state.
  await assertVenueActive(env, venueId);
  return rows[0];
}

// M6 kill-switch, shared by requireStaff (host routes) and the player routes
// (/join, /player/claim). An admin-suspended venue (or its group) must not accrue
// more metered vp_players rows or vp_session_events, so this is re-checked on
// every write path even the unauthenticated ones. Throws on suspension.
async function assertVenueActive(env, venueId) {
  assertUuid(venueId, 'venue_id');   // re-derived per request; never trusted raw
  const venues = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=status,group_id');
  if (!venues.length) throw httpError(403, 'Venue not available');
  if (venues[0].status !== 'active') throw httpError(403, 'This venue is currently suspended');
  if (venues[0].group_id) {
    const groups = await sbGet(env, 'vp_venue_groups', 'id=eq.' + enc(venues[0].group_id) + '&select=status');
    if (groups.length && groups[0].status !== 'active') throw httpError(403, 'This venue group is currently suspended');
  }
}

// Verify the player: read X-Player-Token, sha256 it, match vp_players.token_hash.
// Enforced at the top of every player route.
async function verifyPlayerToken(request, env) {
  const raw = request.headers.get('X-Player-Token') || '';
  if (!raw) throw httpError(401, 'Missing X-Player-Token');
  const hash = await sha256Hex(raw);
  // L14: select only the columns the caller needs, never *.
  const rows = await sbGet(env, 'vp_players', 'token_hash=eq.' + enc(hash) + '&select=id,session_id,display_name,kicked');
  if (!rows.length) throw httpError(401, 'Invalid player token');
  const player = rows[0];
  if (player.kicked) throw httpError(403, 'You have been removed from this game');
  return player;
}

/* =====================================================================
 * EVENTS + STATE VERSION
 * ---------------------------------------------------------------------
 * Every broadcastable change bumps vp_sessions.state_version and inserts a
 * vp_session_events row whose seq equals the new version. The database trigger
 * on that table does the actual Realtime broadcast. Writing the row IS the push.
 * ===================================================================== */

async function emitEvent(env, session, type, payload, actor) {
  // M2: the version bump and the event insert now happen atomically inside
  // Postgres (vp_emit_event), called over PostgREST RPC. Concurrent Worker
  // invocations can no longer read the same state_version and collide on seq.
  // The function merges state_version into the payload exactly as before, so the
  // event a client sees is unchanged.
  const newVersion = await sbRpc(env, 'vp_emit_event', {
    p_session: session.id,
    p_type: type,
    p_payload: payload,     // PUBLIC payload only; nothing secret ever goes here
    p_actor: actor,
  });
  session.state_version = newVersion;   // keep the local object in sync for multiple emits
  return newVersion;
}

/* =====================================================================
 * SNAPSHOT  (public projection only)
 * ===================================================================== */

async function getPublicSnapshot(env, sessionId) {
  assertUuid(sessionId, 'session');   // the ?session= query param is validated here before any PostgREST use
  const sessions = await sbGet(env, 'vp_sessions',
    'id=eq.' + enc(sessionId) + '&select=id,status,state_version,join_code,plan_cap_at_start,title');
  if (!sessions.length) throw httpError(404, 'Session not found');
  const s = sessions[0];

  const players = await sbGet(env, 'vp_players', 'session_id=eq.' + enc(sessionId) + '&kicked=eq.false&select=id');

  const snap = {
    session_id: s.id,
    status: s.status,
    state_version: s.state_version,
    join_code: s.join_code,
    title: s.title || null,
    player_count: players.length,
    plan_cap: s.plan_cap_at_start != null ? s.plan_cap_at_start : null,
    over_cap: s.plan_cap_at_start != null ? players.length > s.plan_cap_at_start : false,
    game: null,
  };

  // Current running bingo game, public state only.
  const games = await sbGet(env, 'vp_games',
    'session_id=eq.' + enc(sessionId) + '&format=eq.bingo90&status=eq.running&select=id,seq,format,config,status&order=seq.desc&limit=1');
  if (games.length) {
    const g = games[0];
    const bg = await sbGet(env, 'vp_bingo_games', 'game_id=eq.' + enc(g.id) + '&select=draw_order,draw_index,pattern');
    if (bg.length) {
      const b = bg[0];
      const order = b.draw_order || [];
      // ONLY the numbers already drawn are exposed; the full draw_order stays secret.
      // 90-ball has no letter, so each called ball is just its number.
      const called = order.slice(0, b.draw_index || 0).map((n) => ({ number: n }));
      snap.game = {
        game_id: g.id,
        seq: g.seq,
        format: g.format,
        pattern: b.pattern,
        prize: (g.config && g.config.prize) || null,
        title: (g.config && g.config.title) || null,
        called_balls: called,
        called_count: called.length,
        current_ball: called.length ? called[called.length - 1] : null,
      };
    }
  }
  return snap;
}

/* =====================================================================
 * GAME LOGIC  (all CSPRNG)
 * ===================================================================== */

// Uniform random integer in [0, max) using rejection sampling over getRandomValues.
function randInt(max) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % max;
}

// Fisher-Yates shuffle of 1..90. Stored as vp_bingo_games.draw_order.
// Note: Postgres int[] is 1-indexed, so draw_order[1..draw_index] in the DB is
// this JS array's slice(0, draw_index). We always read it back as a JS array
// and use JS indexing, so the two conventions stay consistent.
function shuffle1to90() {
  const a = [];
  for (let i = 1; i <= 90; i++) a.push(i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Column number range for a 90-ball ticket column (0..8):
//   col 0 -> 1-9, col 1 -> 10-19, ... col 7 -> 70-79, col 8 -> 80-90.
function colRange(c) {
  if (c === 0) return [1, 9];
  if (c === 8) return [80, 90];
  return [c * 10, c * 10 + 9];
}

// Generate a valid 90-ball housie TICKET: a 3-row x 9-column grid holding exactly
// 15 numbers (5 per row, 4 blanks per row). Every column holds 1..3 numbers drawn
// from its range, ascending down the column. There is NO free centre. Blanks are
// stored as 0. Returned row-major as 27 values for vp_cards.cells.
function generateTicket() {
  // 1. Choose a fill mask: per-column counts 1..3 summing to 15, laid out so each
  //    row has exactly 5 filled cells. Retry the CSPRNG layout until it is valid.
  let mask = null;
  for (let attempt = 0; attempt < 1000 && !mask; attempt++) {
    const colCount = new Array(9).fill(1);        // every column starts with one number (9 so far)
    for (let extra = 0; extra < 6; extra++) {     // add 6 more to reach 15, capped at 3 per column
      let c;
      do { c = randInt(9); } while (colCount[c] >= 3);
      colCount[c]++;
    }
    // Spread each column's cells across the 3 rows, then require exactly 5 per row.
    const grid = [new Array(9).fill(false), new Array(9).fill(false), new Array(9).fill(false)];
    for (let c = 0; c < 9; c++) {
      const rows = [0, 1, 2];
      for (let i = rows.length - 1; i > 0; i--) { const j = randInt(i + 1); const t = rows[i]; rows[i] = rows[j]; rows[j] = t; }
      for (let k = 0; k < colCount[c]; k++) grid[rows[k]][c] = true;
    }
    const rowFilled = (r) => grid[r].reduce((n, v) => n + (v ? 1 : 0), 0);
    if (rowFilled(0) === 5 && rowFilled(1) === 5 && rowFilled(2) === 5) mask = grid;
  }
  // The retry budget is generous; if it is somehow exhausted, fail cleanly rather
  // than deal an invalid ticket.
  if (!mask) throw httpError(500, 'Could not generate a valid ticket');

  // 2. Fill numbers: per column, pick as many distinct values as the mask needs
  //    from that column's range, sort ascending, and drop them down the filled rows.
  const cells = new Array(27).fill(0);
  for (let c = 0; c < 9; c++) {
    const [lo, hi] = colRange(c);
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) { const j = randInt(i + 1); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    const need = (mask[0][c] ? 1 : 0) + (mask[1][c] ? 1 : 0) + (mask[2][c] ? 1 : 0);
    const picks = pool.slice(0, need).sort((a, b) => a - b);
    let p = 0;
    for (let r = 0; r < 3; r++) if (mask[r][c]) cells[r * 9 + c] = picks[p++];
  }
  return cells;
}

// Server-authoritative pattern check for a 90-ball ticket. cells is the 27-value
// row-major ticket (blanks = 0); drawnSet is a Set of numbers actually drawn. A
// number cell is covered once it has been called; blank cells (0) are never
// required (no free centre in 90-ball). Returns {valid, cells:[row-major indices]}.
function checkPattern(pattern, cells, drawnSet) {
  // For each row: the indices of its number cells, and whether every one is called.
  const rowCells = [];
  const rowComplete = [];
  for (let r = 0; r < 3; r++) {
    const nums = [];
    let all = true;
    for (let col = 0; col < 9; col++) {
      const idx = r * 9 + col;
      const v = cells[idx];
      if (v) {                                   // a real number, not a blank (0)
        nums.push(idx);
        if (!drawnSet.has(v)) all = false;
      }
    }
    rowCells.push(nums);
    rowComplete.push(nums.length > 0 && all);
  }

  if (pattern === 'one_line') {
    for (let r = 0; r < 3; r++) if (rowComplete[r]) return { valid: true, cells: rowCells[r] };
    return { valid: false, cells: [] };
  }
  if (pattern === 'two_lines') {
    const done = [0, 1, 2].filter((r) => rowComplete[r]);
    if (done.length >= 2) {
      const cs = [];
      done.slice(0, 2).forEach((r) => rowCells[r].forEach((idx) => cs.push(idx)));
      return { valid: true, cells: cs };
    }
    return { valid: false, cells: [] };
  }
  if (pattern === 'full_house') {
    if (rowComplete[0] && rowComplete[1] && rowComplete[2]) {
      const cs = [];
      for (let r = 0; r < 3; r++) rowCells[r].forEach((idx) => cs.push(idx));
      return { valid: cs.length === 15, cells: cs };
    }
    return { valid: false, cells: [] };
  }
  return { valid: false, cells: [] };
}

// Basic profanity filter + length cap for names shown on the TV.
function cleanName(name) {
  if (!name) return null;
  let n = String(name).trim().slice(0, 20);
  if (!n) return null;
  const bad = ['fuck', 'shit', 'cunt', 'bitch', 'dick', 'wank', 'slut', 'nigger', 'faggot', 'arsehole'];
  const low = n.toLowerCase();
  for (const w of bad) if (low.includes(w)) return 'Player';
  return n;
}

/* =====================================================================
 * CRYPTO HELPERS  (CSPRNG + hashing + JWT verify)
 * ===================================================================== */

const CODE_ALPHABET = 'ACDEFGHJKMNPQRSTUVWXYZ2345679';   // 29 chars, no lookalikes

function genCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
  return s;
}

function randomTokenHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Decode a base64url string to a UTF-8 string.
function b64urlToString(b64) {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

// Decode a base64url string to raw bytes.
function b64urlToBytes(b64) {
  const bin = b64urlToString(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Verify a Supabase Auth JWT (HS256) against SUPABASE_JWT_SECRET and return the
// decoded payload. Throws on a bad signature or an expired token.
async function verifyJwtHS256(token, secret) {
  if (!secret) throw httpError(500, 'SUPABASE_JWT_SECRET is not configured');
  if (!token) throw httpError(401, 'Missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'Malformed token');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = b64urlToBytes(parts[2]);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw httpError(401, 'Bad token signature');

  let payload;
  try { payload = JSON.parse(b64urlToString(parts[1])); } catch (e) { throw httpError(401, 'Bad token payload'); }

  // L8: a token with no expiry is rejected outright (an unbounded token is a
  // standing key). We never fall back to "no exp means never expires".
  if (!payload.exp) throw httpError(401, 'Token has no expiry');
  if ((Date.now() / 1000) > payload.exp) throw httpError(401, 'Token expired');

  // L8: the token must be a genuine Supabase Auth user token. Supabase sets
  // role = 'authenticated' and aud = 'authenticated' on signed-in user tokens;
  // require at least one of those so a non-user token (e.g. anon/service) cannot
  // be presented as a host login. HMAC verification above already blocks alg
  // confusion; this narrows the accepted claim set.
  const aud = payload.aud;
  const audOk = payload.role === 'authenticated'
    || aud === 'authenticated'
    || (Array.isArray(aud) && aud.includes('authenticated'));
  if (!audOk) throw httpError(401, 'Token is not an authenticated user token');

  return payload;
}

/* =====================================================================
 * SUPABASE REST HELPERS  (service_role; same call style as venueplay-api)
 * ===================================================================== */

function sbHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
}

async function sbGet(env, table, query) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + query, { headers: sbHeaders(env) });
  if (!res.ok) throw dbError('read', table, await res.text());   // M5: log detail, return generic + code
  return await res.json();
}

// obj may be a single object or an array of rows. returnRep=true asks Supabase
// to return the inserted representation.
async function sbInsert(env, table, obj, returnRep) {
  const headers = { ...sbHeaders(env) };
  if (returnRep) headers['Prefer'] = 'return=representation';
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST', headers, body: JSON.stringify(obj),
  });
  if (!res.ok) throw dbError('insert', table, await res.text());   // M5: log detail, return generic + code
  if (returnRep) return await res.json();
  return null;
}

async function sbPatch(env, table, filter, obj) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH', headers: sbHeaders(env), body: JSON.stringify(obj),
  });
  if (!res.ok) throw dbError('update', table, await res.text());   // M5: log detail, return generic + code
}

// Call a Postgres function over PostgREST RPC with the service_role headers.
// Used for the atomic vp_emit_event and vp_draw_next_ball (M2/M3).
async function sbRpc(env, fn, args) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify(args),
  });
  if (!res.ok) throw dbError('rpc', fn, await res.text());   // M5: log detail, return generic + code
  return await res.json();
}

// Load a full session row (used to re-derive the venue and the state_version).
async function getSession(env, sessionId) {
  assertUuid(sessionId, 'session');
  const rows = await sbGet(env, 'vp_sessions', 'id=eq.' + enc(sessionId) + '&select=*');
  if (!rows.length) throw httpError(404, 'Session not found');
  return rows[0];
}

/* =====================================================================
 * SMALL UTILITIES
 * ===================================================================== */

async function readJson(request) {
  try { return await request.json(); } catch (e) { throw httpError(400, 'Invalid or missing JSON body'); }
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---- anti-abuse: soft rate limit (Workers KV binding env.RL) ---- */

// One-time warning so an absent/erroring KV binding is visible in logs without
// spamming every request. Isolate-level flag; resets on a cold start, which is fine.
let rlWarned = false;
function rlWarn() {
  if (rlWarned) return;
  rlWarned = true;
  console.log('[RL] KV binding env.RL absent or erroring: anti-abuse limiter/dedup is in DEGRADED (allow) mode. Add a KV namespace binding named RL at deploy to enforce.');
}

// Increment a salted counter in KV and report whether it is within the limit.
// Workers KV is eventually consistent and get-then-put is not atomic, so this is
// a SOFT limiter (it can under-count under a heavy concurrent burst) which is
// acceptable for abuse control. Degrades safely when env.RL is absent or errors:
// it warns once and allows the request, so the endpoint still functions.
async function rateLimit(env, key, limit, windowSecs) {
  if (!env.RL) { rlWarn(); return { ok: true, degraded: true }; }
  try {
    const cur = await env.RL.get(key);
    const n = cur ? (parseInt(cur, 10) || 0) : 0;
    if (n >= limit) return { ok: false, count: n };
    // Workers KV requires expirationTtl >= 60; the TTL is the rolling window.
    await env.RL.put(key, String(n + 1), { expirationTtl: Math.max(60, windowSecs) });
    return { ok: true, count: n + 1 };
  } catch (e) {
    rlWarn();
    return { ok: true, degraded: true };
  }
}

/* ---- validation + safe-error helpers (injection defence + M5) ---- */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const JOIN_CODE_RE = /^[ACDEFGHJKMNPQRSTUVWXYZ2345679]{6}$/;

// Reject any id that is not a well-formed UUID BEFORE it is concatenated into a
// PostgREST filter. Returns the id so it can be used inline.
function assertUuid(id, label) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw httpError(400, 'Invalid ' + (label || 'id'));
  return id;
}

// Reject any join code that is not exactly 6 chars from the no-lookalike alphabet.
function assertJoinCode(code) {
  if (typeof code !== 'string' || !JOIN_CODE_RE.test(code)) throw httpError(400, 'Invalid join code');
  return code;
}

// Percent-encode a value before it goes into a querystring. Defence in depth on
// top of the validation above (ids are already validated; codes/hashes too).
function enc(v) {
  return encodeURIComponent(String(v));
}

// Short opaque reference that ties a client-facing generic error to a server log
// line, so support can find the detail without ever leaking it to the client.
function errRef() {
  return 'E' + randomTokenHex(4).toUpperCase();
}

// M5: log the real Supabase/PostgREST detail server-side, return a generic error
// carrying only the opaque ref. No constraint, column or SQL text reaches the client.
function dbError(op, target, detail) {
  const code = errRef();
  console.log('[' + code + '] db ' + op + ' ' + target + ' failed: ' + String(detail));
  const e = httpError(502, 'A database error occurred (' + code + ')');
  return e;
}

/* =====================================================================
 * REVIEW NOTES  (endpoints, env vars, what a human must do, assumptions)
 * ---------------------------------------------------------------------
 * ENDPOINTS
 *   POST /session            host   -> {session_id, join_code, tv_pairing_code}
 *   POST /join               player -> {token, snapshot}
 *   POST /host/game          host   -> {game_id, seq, pattern, cards_dealt}
 *   POST /host/ball          host   -> {number, index}
 *   POST /player/claim       player -> {claim_id, auto_verdict, winning_cells, card_no}
 *   POST /host/claim/resolve host   -> {claim_id, status}
 *   GET  /snapshot?session=  public -> public projection (no secrets)
 *
 * ENV VARS
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (service_role), SUPABASE_JWT_SECRET,
 *   SITE_URL, ALLOW_ORIGIN (optional), IP_HASH_SALT (optional).
 *
 * WORKER BINDINGS
 *   RL   Workers KV namespace (recommended). Powers the /join + /player/claim
 *        rate limit and the /join soft dedup. Present = live; absent = degraded
 *        (warn + allow). Add before launch.
 *   TURNSTILE_SECRET  optional future escalation (see header).
 *
 * WHAT A HUMAN MUST CONFIGURE BEFORE THIS RUNS
 *   1. Run venueplay-game-schema.sql on the Supabase project first (tables,
 *      the vp_session_events broadcast trigger, RLS). This Worker assumes it exists.
 *      Also run venueplay-07-bingo90-format.sql so vp_games_format_check allows
 *      'bingo90' (this Worker stores/broadcasts that format).
 *   2. Set SUPABASE_JWT_SECRET to the project's JWT secret (Supabase: Settings ->
 *      API -> JWT Settings). This is what host logins are verified against.
 *   3. Set SUPABASE_SERVICE_KEY to the service_role key (secret; never in page source).
 *   4. Set SUPABASE_URL and SITE_URL (and ALLOW_ORIGIN to lock CORS to the site).
 *   5. Add a Workers KV namespace binding named RL (Settings -> Variables ->
 *      KV Namespace Bindings). Without it the anti-abuse limiter/dedup run in
 *      degraded (allow) mode and a scripted /join flood is unthrottled.
 *   6. Onboard a venue: create the Supabase Auth user(s), a vp_venues row, and a
 *      vp_venue_staff row linking them (this is the existing admin runbook). The
 *      host console signs in with supabase.auth and sends the JWT as Bearer.
 *   7. Deploy as its own Worker (separate from venueplay-api). NOT DONE HERE.
 *
 * ASSUMPTIONS MADE
 *   - Supabase legacy HS256 JWTs (verified with the JWT secret). If the project is
 *     moved to asymmetric (ES256/JWKS) signing keys, swap verifyJwtHS256 for a
 *     JWKS verify. The rest is unchanged.
 *   - draw_order round-trips as a JSON array via PostgREST; we always index it in
 *     JS (0-based slice), which matches the DB's draw_order[1..draw_index].
 *   - The state_version bump (emitEvent) and the ball draw (handleHostBall) are
 *     now atomic Postgres functions (vp_emit_event, vp_draw_next_ball) called via
 *     RPC, so concurrent Worker calls can no longer collide. See the add-on
 *     migration venueplay-05-atomic-events.sql (run it after the main migration).
 *   - /session takes venue_id in the body; the host console knows its venue.
 *   - plan_cap_at_start reads venueplay_founding.max_seats for independent venues,
 *     falling back to vp_venues.included_players for grouped venues.
 *   - /join and /player/claim are rate-limited and /join is soft-deduped using the
 *     salted ip_hash + device_hint. This is LIVE when the env.RL KV binding exists
 *     and degrades to warn-and-allow when absent (add RL before launch). The
 *     Turnstile escalation (design section 7) is left as a documented future hook
 *     (TURNSTILE_SECRET). The soft dedup reuses a device's player row within a
 *     JOIN_DEDUP_TTL window only, so two distinct patrons who share a NAT IP AND
 *     browser AND join inside that window could be merged onto one row: a
 *     HUMAN DECISION on the TTL / whether to pass a stable client device id for a
 *     stronger key. Thresholds (JOIN_MAX_*, CLAIM_MAX_*) are tunable constants at
 *     the top of the file; the per-IP cap is deliberately generous because a whole
 *     venue shares one NAT IP.
 *   - Kill-switch (assertVenueActive) is re-checked on /join and /player/claim as
 *     well as the host routes, so a suspended venue/group accrues no more metered
 *     rows/events. /snapshot is left unchecked on purpose: it is a read-only public
 *     projection and writes nothing metered.
 *   - One ticket per player per game (MVP), card_no assigned 1..N in player order.
 *   - Tickets are dealt at game start to all current non-kicked players. Dealing a
 *     ticket to a player who joins AFTER a game has started is a separate join-time
 *     path (design 5.1) and is not wired in this draft.
 *   - checkPattern covers the 90-ball patterns one_line, two_lines, full_house.
 *     Custom jsonb masks are a later extension (per schema).
 *   - Only the 90-ball bingo format is implemented here, plus shared plumbing.
 *     Members draws, raffles, trivia and musical bingo are separate handlers to add.
 *   - profanity filter is a minimal wordlist; extend before launch.
 * ===================================================================== */
