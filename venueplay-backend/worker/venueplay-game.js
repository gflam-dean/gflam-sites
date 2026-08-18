/**
 * VenuePlay GAME Worker  (venueplay-game)  -- REVIEWED + HARDENED 4 Aug 2026; FIXES 7 Aug 2026.
 * Review blockers fixed: a failed start no longer ends the live game; overage is HOST-APPROVED
 * (a game over the plan cap will NOT start until the host taps OK via /host/overage/ack, and
 * only approved overage is billed - tier read from subscription metadata, failures logged);
 * members double-resolve guarded; one card per player; raffle draw double-tap guarded; a
 * round-number clash returns a clean retryable 409. Billing basis is joiners = players (a
 * phone reload reuses its stored token, so no new row).
 * 7 Aug 2026 fixes: "create a night" inserted visibility='venue' which the DB CHECK rejects -> now
 * 'private'; overage is a flat $2/head (no cap); venue+host suspend kill-switch; trivia no-repeat
 * (365-day memory, graceful if that table is unmigrated) + theme search.
 * MIGRATIONS: needs through 27 for the trivia features (24 venue timezone, 25 question meta,
 * 26 vp_asked_questions no-repeat, 27 vp_question_submissions). (Old note said "13 + 14" - stale.)
 * Remaining (not a blocker): a musical /host/play double-tap can nudge played_count by one (low).
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
 * ROUTES  (all JSON; CORS enabled).  "host" = Authorization: Bearer <Supabase
 * access token>, verified against SUPABASE_JWT_SECRET AND confirmed to be staff/
 * admin of the venue before any write.  "player" = X-Player-Token header (the
 * raw token handed out by /join).  "public" = no auth (read-only projection).
 *
 *   METHOD PATH                 WHO      BODY (JSON)                       -> RESPONSE
 *   POST  /session              host     {venue_id}                        -> {session_id, join_code, tv_pairing_code, reused?}
 *   POST  /session/close        host     {session_id}                      -> {session_id, status:'finished'}
 *   POST  /join                 player   {code, name?}                     -> {token, snapshot}
 *   POST  /host/game            host     {session_id, pattern,             -> {game_id, seq, pattern, cards_dealt}
 *                                          prize?, title?, cards_per_player?}
 *                                         BINGO (format omitted or 'bingo90') as above; TRIVIA below.
 *   POST  /host/game (trivia)   host     {session_id, format:'trivia',     -> {game_id, seq, format:'trivia', question_count}
 *                                          question_set_id, title?, prize?,
 *                                          time_limit_s?, base_points?, speed_bonus?, colour?}
 *   POST  /host/game (musical)  host     {session_id, format:'musical',    -> {game_id, seq, format:'musical_bingo', pattern,
 *                                          pattern, playlist_id? | playlist/    cards_dealt, playlist_id, playlist_name,
 *                                          songs[], prize?, title?, auto_daub?} song_count, songs:[{song_id,title,artist}]}
 *   POST  /host/game (raffle)   host     {session_id, format:'raffle',     -> {game_id, seq, format:'raffle', range_min,
 *                                          range_min, range_max, winners?,      range_max, winners, allow_redraw,
 *                                          time_to_present?, allow_redraw?,      time_to_present, pad, jackpot_on}
 *                                          leading_zeros?, jackpot_on?,
 *                                          jackpot_amount_cents?, prize?}
 *                                         RAFFLE is HOST-ONLY and NOT metered: no /join, no vp_players. The venue
 *                                         sells its own PAPER tickets; the host types the START/END number sold.
 *   POST  /host/draw            host     {game_id, winners?, prize?,       -> {game_id, seq, tickets:[..], pad,
 *                                          prize_type?, prize_value_cents?,     allow_redraw, time_to_present, prize, prize_type}
 *                                          redraw_of_seq?}
 *                                         Picks winner ticket number(s) UNIFORMLY at random in [range_min,range_max]
 *                                         with a rejection-sampled CSPRNG (randInt; NOT modulo-biased), excluding
 *                                         numbers already drawn. Writes vp_raffle_results, emits 'raffle.winner'.
 *                                         redraw_of_seq marks that round no_show (drops it from prizes-given) then
 *                                         draws a replacement (only when the raffle allows a redraw).
 *   POST  /host/draw/resolve    host     {game_id, seq, outcome}           -> {game_id, seq, outcome, tickets}
 *                                         Records whether the drawn winner(s) presented: outcome 'claimed' or
 *                                         'no_show' (raffle's parallel to /host/claim/resolve).
 *   POST  /host/members/draw    host     {draw_id}                         -> {draw_id, member_id, member_number,
 *                                          winner_name, jackpot_cents, valid_count, ...}
 *                                         MEMBERS DRAW is HOST-ONLY and NOT metered (no /join, no vp_players, no
 *                                         session/vp_games row). Picks a random VALID vp_members row (status 'valid')
 *                                         from the draw's roster UNIFORMLY via the unbiased CSPRNG randInt, formats the
 *                                         name per the venue name_display setting, stamps last_drawn_date.
 *   POST  /host/members/draw/resolve  host {draw_id, member_id?,            -> {draw_id, outcome, amount_cents,
 *                                          member_number?, outcome}             new_jackpot_cents, increment_cents}
 *                                         claim -> write vp_member_draw_results 'claimed' + RESET current_jackpot_cents
 *                                         to starting_amount_cents; rollover -> write 'jackpot_rolled' + GROW jackpot by
 *                                         increment_cents. (Result row is written here, not at draw: outcome is NOT NULL
 *                                         with no 'pending' value.)
 *   POST  /host/members/settings host*   {draw_id?|venue_id, name?,        -> {draw}
 *                                          starting_amount_cents?, increment_cents?, current_jackpot_cents?,
 *                                          time_to_claim_seconds?, draw_length_seconds?, draw_day?, draw_time?, roster_id?}
 *                                         *MANAGER/OWNER ONLY. The draw/jackpot SETTINGS-write path. With draw_id it
 *                                         updates a recurring draw; without one it creates a new one. Hosts are refused.
 *   POST  /host/members/roster  host     {member_id, status}               -> {member_id, status}
 *                                         Roster management (host-allowed): enable ('valid') / disable ('excluded') a
 *                                         saved member for the draw.
 *   POST  /host/game/end        host     {game_id}                         -> {game_id, status:'finished'}
 *   POST  /host/ball            host     {game_id}                         -> {number, index}
 *   POST  /host/play            host     {game_id, song_id}                -> {song_id, title, artist, seq, played_count}
 *                                         Musical bingo's equivalent of /host/ball: the host plays (reveals)
 *                                         the next song. Records vp_music_plays and emits PUBLIC 'music.song_played'
 *                                         (title + artist are public; players daub by ear). Idempotent per song.
 *   POST  /host/question        host     {game_id}                         -> {qseq, qi, qtotal, text, options, correct_index, ends_at, secs} | {done:true}
 *                                         Advances the trivia game to the next question. The PUBLIC broadcast
 *                                         'trivia.question' carries options but NEVER correct_index; correct_index
 *                                         is returned ONLY in this host-only (authenticated) response.
 *   POST  /host/reveal          host     {game_id}                         -> {qseq, correct_index, split, leaderboard}
 *                                         Stamps is_correct + points_awarded server-side, then emits 'trivia.reveal'.
 *   GET   /player/card          player   ?game=<id> (optional)             -> BINGO:   {game_id, card_no, cells, pattern, called_numbers}
 *                                         Serves BINGO tickets AND musical cards           MUSICAL: {game_id, format:'musical_bingo', card_no,
 *                                         (branches on the running game format).                     cells, pattern, played_songs} | {game:null}
 *   POST  /player/claim         player   {game_id}                         -> {claim_id, auto_verdict, winning_cells, card_no}
 *                                         Works for BINGO (drawn numbers) AND musical bingo (played songs);
 *                                         the Worker loads its own card + play log and computes the verdict.
 *   POST  /player/answer        player   {game_id, answer_index, qseq?}    -> {ok:true, recorded} (first answer is final; NO correctness returned)
 *   GET   /player/score         player   ?game=<id>                        -> {total, rank, players_count, last:{answered,is_correct,points_awarded}}
 *   POST  /host/claim/resolve   host     {claim_id, decision:confirm|reject} -> {claim_id, status}
 *   GET   /snapshot?session=<id> public  (query only)                      -> public projection (no secrets), for TV + late joiners
 *
 *   pattern is one of: one_line | two_lines | full_house  (90-ball has no four_corners).
 *   The DB is the source of truth for EVERY write above. Pages may also mirror
 *   these changes over a Supabase Realtime broadcast for instant UX, but nothing
 *   a client broadcasts is authoritative; it is re-derivable from /snapshot.
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
const REPORT_MAX_PER_IP = 30;    // game reports per 60s per network. A venue finishes a round every few minutes.
const CAPTURE_MAX_PER_IP = 120;  // opt-in captures per 60s per network. A whole venue shares one NAT IP, so keep it generous.
const JOIN_MAX_PER_DEVICE = 8;    // joins per 60s per device hint. One phone should not join many times a minute.
const CLAIM_MAX_PER_PLAYER = 20;  // claims per 60s per player. Stops a joined attacker spamming BINGO + the TV overlay.
const ANSWER_MAX_PER_PLAYER = 30; // trivia answers per 60s per player. One answer per question is normal; this only blocks a flood.
const JOIN_DEDUP_TTL = 120;       // seconds a device's player_id is remembered, so a rapid re-join reuses its row.

export default {
  async fetch(request, env) {
    /* Reflect any venueplay.com.au origin, the same way the billing Worker does.
       This was a single origin with no list and no reflection, set by deploy note to
       https://www.venueplay.com.au. A host who reached the apex (no www) had every game call
       blocked at preflight and got a dead console with nothing explaining it. The billing Worker
       solved this and the fix was never carried across. */
    const reqOrigin = request.headers.get('Origin') || '';
    const allowList = (env.ALLOW_ORIGIN || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const originOk = /^https:\/\/([a-z0-9-]+\.)?venueplay\.com\.au$/.test(reqOrigin) || allowList.indexOf(reqOrigin) !== -1;
    const CANONICAL = 'https://www.venueplay.com.au';
    // Safe with no env var set: venueplay.com.au origins are reflected, anything else gets the
    // canonical site (which the browser will refuse), never a wildcard. ALLOW_ORIGIN is now
    // purely additive, for a staging or preview host.
    const origin = originOk ? reqOrigin : (allowList[0] || CANONICAL);
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Player-Token, X-VP-Venue',
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
      if (method === 'POST' && path === '/session/close')      return await handleSessionClose(request, env, json);
      if (method === 'POST' && path === '/join')               return await handleJoin(request, env, json);
      if (method === 'POST' && path === '/join/info')          return await handleJoinInfo(request, env, json);
      if (method === 'POST' && path === '/capture')            return await handleCapture(request, env, json);
      if (method === 'POST' && path === '/report')             return await handleReport(request, env, json);
      if (method === 'GET'  && path === '/venue')              return await handleVenueLookup(request, env, json);
      if (method === 'GET'  && path === '/play/live')          return await handlePlayLive(request, env, json);
      if (method === 'POST' && path === '/host/game')          return await handleHostGame(request, env, json);
      if (method === 'POST' && path === '/host/game/pattern')  return await handleMusicPattern(request, env, json);
      if (method === 'POST' && path === '/host/trivia/set')                return await handleTriviaSet(request, env, json);
      if (method === 'POST' && path === '/host/trivia/set/delete')         return await handleTriviaSetDelete(request, env, json);
      if (method === 'GET'  && path === '/host/trivia/set/questions')      return await handleTriviaSetQuestions(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/add')      return await handleTriviaAdd(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/from-library') return await handleTriviaFromLibrary(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/search')       return await handleTriviaSearch(request, env, json);
      if (method === 'POST' && path === '/admin/trivia/submissions')           return await handleAdminSubmissions(request, env, json);
      if (method === 'POST' && path === '/admin/trivia/submissions/resolve')   return await handleAdminResolve(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/remove')   return await handleTriviaRemove(request, env, json);
      if (method === 'POST' && path === '/host/overage/ack')   return await handleOverageAck(request, env, json);
      if (method === 'POST' && path === '/host/game/end')      return await handleGameEnd(request, env, json);
      if (method === 'POST' && path === '/host/ball')          return await handleHostBall(request, env, json);
      if (method === 'POST' && path === '/host/play')          return await handleHostPlay(request, env, json);
      if (method === 'POST' && path === '/host/song/flag')      return await handleSongFlag(request, env, json);
      if (method === 'POST' && path === '/host/question')      return await handleHostQuestion(request, env, json);
      if (method === 'POST' && path === '/host/reveal')        return await handleHostReveal(request, env, json);
      if (method === 'POST' && path === '/host/draw')          return await handleHostDraw(request, env, json);
      if (method === 'POST' && path === '/host/draw/resolve')  return await handleDrawResolve(request, env, json);
      if (method === 'POST' && path === '/host/members/draw')         return await handleMembersDraw(request, env, json);
      if (method === 'POST' && path === '/host/members/draw/resolve') return await handleMembersResolve(request, env, json);
      if (method === 'POST' && path === '/host/members/settings')     return await handleMembersSettings(request, env, json);
      if (method === 'POST' && path === '/host/members/roster')       return await handleMembersRoster(request, env, json);
      if (method === 'POST' && path === '/host/members/import')        return await handleMembersImport(request, env, json);
      if (method === 'POST' && path === '/host/raffle/prize-add')      return await handleRafflePrizeAdd(request, env, json);
      if (method === 'POST' && path === '/host/raffle/prize-remove')   return await handleRafflePrizeRemove(request, env, json);
      if (method === 'GET'  && path === '/player/card')        return await handlePlayerCard(request, env, json);
      if (method === 'POST' && path === '/player/claim')       return await handlePlayerClaim(request, env, json);
      if (method === 'POST' && path === '/player/answer')      return await handlePlayerAnswer(request, env, json);
      if (method === 'GET'  && path === '/player/score')       return await handlePlayerScore(request, env, json);
      if (method === 'POST' && path === '/host/claim/resolve') return await handleClaimResolve(request, env, json);
      if (method === 'GET'  && path === '/snapshot')           return await handleSnapshot(request, env, json);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      // M5: only errors we raised on purpose (they carry a numeric .status and a
      // curated, safe message) are echoed to the client. Anything unexpected is
      // logged server-side under an opaque ref and returned as a generic 500, so
      // no stack, constraint, column or SQL detail ever leaks.
      const err = /** @type {any} */ (e);
      if (err && err.status) return json({ error: String(err.message) }, err.status);
      const code = errRef();
      console.log('[' + code + '] unhandled: ' + String((e && e.stack) || (e && e.message) || e));
      return json({ error: 'Something went wrong', code }, 500);
    }
  },

  /* NIGHTLY SWEEP: close sessions nobody ever closed.

     /session/close is only ever called from the browser (vp-session.js), and its own comment
     admits there is no server-side sweeper and a lost id is lost permanently. So a host who shut
     the tablet without signing out, or a kiosk that was reset, left the session 'lobby' or
     'running' for good. Two consequences, both real:
       - the venue reads as live in HQ forever, and
       - every later night's players append to that SAME session, so whenever some device finally
         did sign out, one invoiceitem billed every player who had ever joined it, minus one cap.

     Closing here goes through the same handleSessionClose path, so the overage is billed exactly
     as it would have been, with the same Stripe idempotency key per session. Sessions younger
     than the cutoff are left alone: a long night is not an abandoned one.

     Needs a Cron Trigger on this Worker in the Cloudflare dashboard. Suggested: "0 17 * * *"
     (3am Brisbane). With no trigger configured this simply never runs, which is today's
     behaviour, so it is safe to deploy before the trigger is set up. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const STALE_HOURS = 12;
      const cutoff = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();
      let rows = [];
      try {
        rows = await sbGet(env, 'vp_sessions',
          'status=in.(lobby,running,paused)&opened_at=lt.' + enc(cutoff) +
          '&select=id,venue_id,opened_at&order=opened_at.asc&limit=200');
      } catch (e) {
        console.log('[sweep] could not list stale sessions: ' + String((e && e.message) || e));
        return;
      }
      if (!rows.length) { console.log('[sweep] nothing to close'); return; }
      let closed = 0, failed = 0;
      for (const s of rows) {
        try {
          const session = await getSession(env, s.id);
          if (session.status === 'finished' || session.status === 'cancelled') continue;
          // Exactly the sequence handleSessionClose uses, so a swept night is billed and
          // recorded identically to one the host closed themselves.
          await sbPatch(env, 'vp_games', 'session_id=eq.' + enc(session.id) + '&status=eq.running',
            { status: 'finished', ended_at: new Date().toISOString() });
          await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(session.id),
            { status: 'finished', ended_at: new Date().toISOString() });
          try { await emitEvent(env, session, 'session.closed', {}, 'system'); } catch (e2) {}
          try { await chargeNightOverage(env, session); } catch (e2) { /* billing never blocks close */ }
          closed++;
        } catch (e) {
          failed++;
          console.log('[sweep] session ' + s.id + ' failed: ' + String((e && e.message) || e));
        }
      }
      console.log('[sweep] closed ' + closed + ', failed ' + failed + ', of ' + rows.length + ' stale sessions');
    })());
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

  // Idempotent open: the schema allows only ONE live session per venue
  // (partial unique index vp_sessions_one_live_per_venue). If the host already
  // has a live session tonight (they reloaded, re-tapped Start, or re-paired a
  // TV), return THAT session instead of failing on the unique index. This makes
  // "open the session" safe to call repeatedly from the host console.
  const liveNow = await sbGet(env, 'vp_sessions',
    'venue_id=eq.' + enc(venueId) + '&status=in.(lobby,running,paused)&select=id,join_code,tv_pairing_code,plan_cap_at_start&order=created_at.desc&limit=1');
  if (liveNow.length) {
    return json({ session_id: liveNow[0].id, join_code: liveNow[0].join_code, tv_pairing_code: liveNow[0].tv_pairing_code, plan_cap: (liveNow[0].plan_cap_at_start != null ? liveNow[0].plan_cap_at_start : null), reused: true });
  }

  /* Freeze THIS VENUE'S plan into the session so historical metering stays stable.
     It used to prefer venueplay_founding.max_seats, which is written exactly twice, at signup and
     by HQ create, and is the TOTAL ACROSS THE WHOLE ACCOUNT. Everything that actually changes a
     plan writes vp_venues.max_players: the billing page, add-venue, and the three-big-nights
     uplift. Three money faults came out of that one line.
       - A ten venue group at 200 each froze a cap of 2000 at every venue, so no venue in a group
         was ever over its plan and none was ever billed a cent of overage.
       - A venue that PAID to go from 100 to 300 was still capped at 100, so it was billed overage
         on 200 players it had already bought.
       - The uplift raised max_players and the enforced cap did not move, so the venue paid the
         bigger plan AND kept paying per head on the same crowd, forever, which is the opposite of
         what the Terms and the welcome email both promise. */
  const venues = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=id,founding_id,included_players,max_players');
  if (!venues.length) return json({ error: 'Venue not found' }, 404);
  const venue = venues[0];
  let planCap = null;
  if (venue.max_players != null) planCap = parseInt(venue.max_players, 10) || 0;
  else if (venue.included_players != null) planCap = parseInt(venue.included_players, 10) || 0;
  else if (venue.founding_id) {
    // Nothing on the venue at all: fall back to the signup figure rather than leave it uncapped.
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
        created_by: staff.id || null,   // vp_venue_staff.id; null for an HQ admin, who has no staff row
      }),
    });
    if (res.ok) { const d = await res.json(); session = Array.isArray(d) ? d[0] : d; break; }
    if (res.status === 409) continue;   // join_code (or one-live-session) clash, try another code
    throw dbError('insert', 'vp_sessions', await res.text());   // M5: log detail, return generic + code
  }
  if (!session) return json({ error: 'Could not allocate a unique join code, or a session is already live for this venue' }, 409);

  return json({ session_id: session.id, join_code: session.join_code, tv_pairing_code: session.tv_pairing_code, plan_cap: (planCap != null ? planCap : null) });
}

/* ------------------------------ POST /join ------------------------------
 * Player joins with a code. No auth. The Worker mints a 256-bit token, stores
 * ONLY its sha256, and returns the raw token once plus a public snapshot.
 */
/* POST /join/info  (anon) : which fields the join screen should ask for at this venue.
   body: { code }  -> { collect: {first_name,last_name,postcode,email,mobile,marketing_optin} }
   The Worker reads vp_venue_settings with the service key (the anon player can't), and returns
   ONLY the collect_* flags, never any venue data. */
async function handleJoinInfo(request, env, json) {
  const b = await readJson(request);
  const code = String(b.code || '').trim().toUpperCase();
  if (!code) return json({ collect: null });
  let venueId = null;
  /* WHICH GAME is this code for? Every printed sign says venueplay.com.au/play, so /play has to
     be able to resolve ANY code the room is shown: a bingo venue code, or the random join code a
     trivia or musical session hands out. It could not before. Typing a trivia code into /play
     connected the phone to the bingo channel and sat there forever, because the only thing that
     ever hopped to another game was the /play?venue= path off a table talker. */
  let format = '';
  const sessions = await sbGet(env, 'vp_sessions', 'join_code=eq.' + enc(code) + '&status=in.(lobby,running,paused)&select=id,venue_id&limit=1');
  if (sessions.length) {
    venueId = sessions[0].venue_id;
    /* The LATEST game of any status, not just a live one. No vp_games row is ever written with
       status 'lobby' (every insert is 'running'), so filtering on a live status meant the format
       was unknown in exactly the window the code is typed in: after the session opens and before
       round one starts, which is when the join code is up on the TV and the room is reading it.
       It went blank again between rounds, because ending a round marks it finished. A session
       that has run a trivia round is a trivia session whether or not a round is live right now. */
    const games = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(sessions[0].id) + '&select=format&order=seq.desc&limit=1');
    if (games.length) format = String(games[0].format || '');
  } else venueId = await venueByCode(env, code);   // broadcast bingo has no session: resolve by venue code
  if (!venueId) return json({ collect: null, format: '' }); // unknown code; join screen falls back to name only
  const rows = await sbGet(env, 'vp_venue_settings',
    'venue_id=eq.' + enc(venueId) + '&select=collect_first_name,collect_last_name,collect_postcode,collect_email,collect_mobile,collect_marketing_optin&limit=1');
  const cfg = (rows && rows[0]) || {};
  /* The venue's NAME, so the join screen can say who is asking for these details. A collection
     notice that cannot name the recipient is not much of a notice. Name only: no slug, no id, no
     other venue data, so this stays what it has always been, a public lookup for one join code. */
  let venueName = '';
  try {
    const vrows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=name&limit=1');
    if (vrows && vrows[0] && vrows[0].name) venueName = String(vrows[0].name);
  } catch (e) { /* the notice falls back to "the venue you are playing at" */ }
  return json({ format: format, venue_name: venueName, collect: {
    first_name: cfg.collect_first_name !== false, // first name defaults on
    last_name: !!cfg.collect_last_name,
    postcode: !!cfg.collect_postcode,
    email: !!cfg.collect_email,
    mobile: !!cfg.collect_mobile,
    marketing_optin: !!cfg.collect_marketing_optin,
  } });
}

/* Resolve a broadcast venueCode (6 chars, derived from the venue slug on the host + TV) to a
   venue_id. Bingo has no session to look up, so we recompute the code for every venue and match.
   Keyed by the unique slug/id, so two same-named venues never collide. The venue list is cached
   ~60s in the isolate to avoid a full scan on every capture. */
let _vcMap = null, _vcAt = 0;
function fnvVenueCode(slug) {
  let s = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, ''), h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const A = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'; let out = '', x = h || 1;
  for (let j = 0; j < 6; j++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out += A[x % A.length]; }
  return out;
}
async function venueByCode(env, code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[ACDEFGHJKMNPQRSTUVWXYZ2345679]{6}$/.test(code)) return null;
  const now = Date.now();
  if (!_vcMap || now - _vcAt > 60000) {
    const rows = await sbGet(env, 'vp_venues', 'select=id,slug&limit=5000');
    const map = {};
    for (const v of rows) { if (v && v.slug) map[fnvVenueCode(v.slug)] = v.id; }
    _vcMap = map; _vcAt = now;
  }
  return _vcMap[code] || null;
}

/* Opt-in capture for a broadcast game. Anon; best-effort. Stores ONLY the fields the venue's
   settings allow (which migration 21 already forces off for unapproved accounts), always keyed
   by venue_id, never by name. Unknown code = silently ignored so a player is never blocked. */
async function handleCapture(request, env, json) {
  const b = await readJson(request);
  const ipHash = await abuseIpHash(request, env);
  if (ipHash) {
    const rl = await rateLimit(env, 'capture:ip:' + ipHash, CAPTURE_MAX_PER_IP, 60);
    if (!rl.ok) return json({ error: 'Too many sign-ups from this network right now' }, 429);
  }
  const venueId = await venueByCode(env, b.code);
  if (!venueId) return json({ ok: false, stored: false });
  const rows = await sbGet(env, 'vp_venue_settings',
    'venue_id=eq.' + enc(venueId) + '&select=collect_first_name,collect_last_name,collect_postcode,collect_email,collect_mobile,collect_marketing_optin&limit=1');
  const cfg = (rows && rows[0]) || {};
  const s = v => (v == null ? null : String(v).slice(0, 120));
  const row = { venue_id: venueId, source: 'bingo' };
  if (cfg.collect_first_name !== false) row.first_name = s(b.first_name);
  if (cfg.collect_last_name)  row.last_name = s(b.last_name);
  if (cfg.collect_postcode)   row.postcode  = s(b.postcode);
  if (cfg.collect_email)      row.email     = s(b.email);
  if (cfg.collect_mobile)     row.mobile    = s(b.mobile);
  if (cfg.collect_marketing_optin && b.marketing_optin === true) { row.marketing_optin = true; row.marketing_optin_at = new Date().toISOString(); }
  if (!row.first_name && !row.last_name && !row.email && !row.mobile) return json({ ok: true, stored: false });
  await sbInsert(env, 'vp_captures', row, false);
  return json({ ok: true, stored: true });
}

/* Does this screen code map to a real venue? Lets the TV warn a venue that mistyped its
   screen link (/tv?venue=...) instead of silently sitting on a dead channel. */
async function handleVenueLookup(request, env, json) {
  const url = new URL(request.url);
  const venueId = await venueByCode(env, url.searchParams.get('code') || '');
  if (!venueId) return json({ exists: false });
  const rows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=name&limit=1');
  return json({ exists: true, name: (rows && rows[0] && rows[0].name) || '' });
}

/* What is on at this venue right now?  (anon)
 *   GET /play/live?code=<venue code>  ->  { exists, name, live, format, join_code }
 *
 * This is what makes a PRINTED sign possible. The venue code is a pure hash of the venue
 * slug, so venueplay.com.au/play?venue=<slug> never changes and can go on a table talker.
 * Bingo needs nothing here (host, TV and phones all meet on the venue code), but trivia and
 * musical open a session and hand out a RANDOM join code, so a phone arriving from a printed
 * sign has to ask which room it is tonight. Unknown/quiet venue = live:false, and the play
 * page just waits on the venue code, which is exactly right for broadcast bingo.
 */
async function handlePlayLive(request, env, json) {
  const url = new URL(request.url);
  const venueId = await venueByCode(env, url.searchParams.get('code') || '');
  if (!venueId) return json({ exists: false, live: false });
  const vrows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=name&limit=1');
  const name = (vrows && vrows[0] && vrows[0].name) || '';
  const sessions = await sbGet(env, 'vp_sessions',
    'venue_id=eq.' + enc(venueId) + '&status=in.(lobby,running,paused)&select=id,join_code&order=created_at.desc&limit=1');
  if (!sessions.length) return json({ exists: true, name, live: false });
  const games = await sbGet(env, 'vp_games',
    'session_id=eq.' + enc(sessions[0].id) + '&status=eq.running&select=format&order=seq.desc&limit=1');
  return json({
    exists: true, name, live: true,
    join_code: sessions[0].join_code,
    format: (games && games[0] && games[0].format) || '',
  });
}

async function abuseIpHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || '';   // Cloudflare-set; x-real-ip is client-suppliable
  if (!ip) return null;
  return await sha256Hex((env.IP_HASH_SALT || 'venueplay') + ':' + ip);
}

async function handleReport(request, env, json) {
  const b = await readJson(request);
  const ipHash = await abuseIpHash(request, env);
  if (ipHash) {
    const rl = await rateLimit(env, 'report:ip:' + ipHash, REPORT_MAX_PER_IP, 60);
    if (!rl.ok) return json({ error: 'Too many reports from this network right now' }, 429);
  }
  const venueId = await venueByCode(env, b.code);
  if (!venueId) return json({ ok: false });
  const row = {
    venue_id: venueId,
    format: String(b.format || 'bingo').slice(0, 20),
    players: Math.max(0, parseInt(b.players, 10) || 0),
    tickets: Math.max(0, parseInt(b.tickets, 10) || 0),
    prizes: Array.isArray(b.prizes) ? b.prizes.slice(0, 20) : [],
    started_at: b.started_at || null,
    ended_at: b.ended_at || null
  };
  /* A night that was PLAYED but never formally ended used to leave no trace whatsoever, because
     the console only reported on "new game" and "end game". A host who shut the iPad mid-night,
     or whose battery went, produced a venue that read as never having run a game at all. The
     retention list then put that venue at the very top, most urgent, with an Archive button
     sitting beside it: the cure for a busy venue was one click away from switching it off.

     So the console now reports the moment a game STARTS and patches that same row when it
     finishes. The trace exists from ball one, and there is still exactly one row per game. */
  const reportId = String(b.report_id || '').trim();
  if (reportId) {
    if (!UUID_RE.test(reportId)) return json({ error: 'Invalid report_id' }, 400);
    // Scoped to the venue the code resolved to, so a report id alone can never rewrite
    // another venue's figures.
    await sbPatch(env, 'vp_game_reports',
      'id=eq.' + enc(reportId) + '&venue_id=eq.' + enc(venueId), row);
    return json({ ok: true, id: reportId });
  }
  const ins = await sbInsert(env, 'vp_game_reports', row, true);
  const created = Array.isArray(ins) ? ins[0] : ins;
  return json({ ok: true, id: (created && created.id) || null });
}

async function handleJoin(request, env, json) {
  const b = await readJson(request);
  const code = String(b.code || '').trim().toUpperCase();
  assertJoinCode(code);   // reject anything not in the 6-char, no-lookalike alphabet before it reaches PostgREST

  // Salted, coarse abuse signals. Raw IP / UA are NEVER stored; only these hashes.
  const ip = request.headers.get('cf-connecting-ip') || '';   // Cloudflare-set; x-real-ip is client-suppliable so not trusted for the rate-limit bucket
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

  // Optional player data, per the venue's collect_* settings on the join screen. Stored on the
  // player row. The marketing opt-in is ONLY ever recorded true if the player ticked it
  // themselves (a locked rule: never pre-ticked, never defaulted on).
  const capStr = (v, n) => { const s = String(v == null ? '' : v).trim().slice(0, n); return s || null; };
  const cap = {};
  if (b.first_name != null) cap.first_name = capStr(b.first_name, 80);
  if (b.last_name != null) cap.last_name = capStr(b.last_name, 80);
  if (b.email != null) cap.email = capStr(b.email, 200);
  if (b.mobile != null) cap.mobile = capStr(b.mobile, 40);
  if (b.postcode != null) cap.postcode = capStr(b.postcode, 10);
  if (b.marketing_optin === true) { cap.marketing_optin = true; cap.marketing_optin_at = new Date().toISOString(); }

  // Soft dedup (LIVE only with env.RL): a rapid re-join from the same network +
  // device hint reuses that device's existing player row instead of minting a new
  // metered one. We remembered the player_id in KV under a short TTL, so this is a
  // burst-window guard (double-tap / retry / refresh), NOT a permanent identity
  // merge, keeping the risk of collapsing two distinct patrons who share a NAT IP
  // and browser to the TTL window. On reuse we rotate a fresh token onto the row
  // and do NOT re-broadcast player.joined (the player count has not changed).
  /* DEDUP ONLY ON A KEY THE DEVICE ITSELF SUPPLIES.
     This used to key on network + user-agent hash. Both are shared by a whole venue: everyone is
     behind one NAT IP, and iOS Safari user-agent strings are byte-identical across every phone on
     the same iOS build. So two different patrons joining within the window collapsed onto ONE
     vp_players row: the second person was handed a fresh token bound to the FIRST person's row,
     the first person's token was destroyed, her card disappeared mid-game with a 401, and the TV
     renamed her to him. In a room of iPhones that is most of the room, and it also under-counted
     the metering the venue is billed on.
     play.html already mints a per-device id and sends it as `pid`, so dedup keys on that. A phone
     retrying or refreshing sends the same pid and is correctly reused; two different phones can
     never collide, whatever network they share. No pid (an older page) means no dedup, which is
     the safe direction: a spare row costs a metered player, a collision costs somebody's game. */
  const devId = String(b.pid || '').trim();
  const devIdValid = /^[A-Za-z0-9_-]{6,64}$/.test(devId);
  const dedupKey = (env.RL && devIdValid)
    ? 'joindedup:' + session.id + ':' + devId
    : null;
  /* The KV key above is a 120 second cache in front of the real check, which is the DB. KV alone
     could never carry a patron from trivia to musical bingo hours later in the same session, so
     the same person was inserted again and billed again. device_id (migration 39) is the durable
     record, so look there whenever the fast path misses. */
  if (devIdValid) {
    let priorId = null;
    if (dedupKey) { try { priorId = await env.RL.get(dedupKey); } catch (e) { rlWarn(); } }
    if (!priorId) {
      const byDevice = await sbGet(env, 'vp_players',
        'session_id=eq.' + enc(session.id) + '&device_id=eq.' + enc(devId) +
        '&kicked=eq.false&select=id&order=joined_at.asc&limit=1');
      if (byDevice.length) priorId = byDevice[0].id;
    }
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
  if (devIdValid) playerRow.device_id = devId;     // durable rejoin + billing key (migration 39)
  Object.assign(playerRow, cap);                        // optional first/last/email/mobile/postcode + opt-in
  const inserted = await sbInsert(env, 'vp_players', playerRow, true);
  const newPlayer = Array.isArray(inserted) ? inserted[0] : inserted;

  // Remember this device's player_id so the next rapid re-join reuses this row.
  if (dedupKey && newPlayer && newPlayer.id) {
    try { await env.RL.put(dedupKey, newPlayer.id, { expirationTtl: JOIN_DEDUP_TTL }); } catch (e) { rlWarn(); }
  }

  // Broadcast player.joined (this insert is what pushes the TV welcome ticker).
  const players = await sbGet(env, 'vp_players', 'session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id,device_id');
  const payload = { player_count: countPlayers(players) };   // the number the host is billed on
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
// Finish every OTHER game still marked running in this session (all except keepGameId), so
// /snapshot and the ball draw point at the newest round. Run AFTER the new game row exists,
// so a start that fails validation never touches the game already in progress.
async function finishOtherRunningGames(env, sessionId, keepGameId) {
  await sbPatch(env, 'vp_games',
    'session_id=eq.' + enc(sessionId) + '&status=eq.running&id=neq.' + enc(keepGameId),
    { status: 'finished', ended_at: new Date().toISOString() });
}
async function handleHostGame(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const sessionId = String(b.session_id || '').trim();
  if (!sessionId) return json({ error: 'Missing session_id' }, 400);
  assertUuid(sessionId, 'session_id');   // reject non-UUID before it reaches PostgREST

  // The format decides which per-format tables we write. Bingo is the default so the
  // existing bingo host (which sends no format) is unchanged. Pattern is a bingo-only
  // concept, so it is only required/validated on the bingo path.
  const format = String(b.format || 'bingo90');
  const bingoFormats = ['bingo90', 'bingo'];
  const isTrivia = format === 'trivia';
  const isMusical = format === 'musical' || format === 'musical_bingo';
  const isRaffle = format === 'raffle';
  if (!isTrivia && !isMusical && !isRaffle && !bingoFormats.includes(format)) return json({ error: 'Unsupported format' }, 400);
  // Pattern is validated per-format: 90-ball has three patterns and NO four_corners;
  // musical bingo is a 5x5 grid that DOES include four_corners (see hostStartMusical).
  // Raffle has no pattern at all (a random ticket number in a range).
  let pattern = null;
  if (!isTrivia && !isMusical && !isRaffle) {
    pattern = b.pattern;
    const validPatterns = ['one_line', 'two_lines', 'full_house'];   // 90-ball patterns; no four_corners
    if (!validPatterns.includes(pattern)) return json({ error: 'Invalid pattern' }, 400);
  }

  const sessions = await sbGet(env, 'vp_sessions', 'id=eq.' + enc(sessionId) + '&select=*');
  // SUSPEND kill-switch: a suspended venue's hosts cannot start any game (blocks the venue AND its hosts).
  if (sessions && sessions[0] && sessions[0].venue_id) {
    const _sv = await sbGet(env, 'vp_venues', 'id=eq.' + enc(sessions[0].venue_id) + '&select=status');
    if (_sv && _sv[0] && _sv[0].status === 'suspended') {
      return json({ error: 'Your tab has run a bit long. Settle up on your account page and we will get your games going again.' }, 403);
    }
  }
  if (!sessions.length) return json({ error: 'Session not found' }, 404);
  const session = sessions[0];
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the session's venue (also kill-switch)

  // Once-a-week limit for trivia + musical bingo, checked BEFORE the rollover below so a
  // blocked start can never finish the game already running. Extra rounds within THIS
  // session are always allowed; bingo, raffle and members draw are unlimited.
  if (isTrivia || isMusical) {
    const limitMsg = await checkWeeklyFormatLimit(env, session, isTrivia);
    if (limitMsg) return json({ error: limitMsg }, 429);
  }

  // Overage approval gate: if the room is already over the venue's plan cap and the host has
  // not approved the overage yet, the game will NOT start. The host UI catches this response,
  // shows "you are over your X-player plan, the extra Z players are billed at your per-player
  // rate this month - OK?", and on OK calls POST /host/overage/ack, which sets the flag for
  // the night so games start freely (and chargeNightOverage will then bill at close).
  {
    const planCap = Number(session.plan_cap_at_start || 0);
    if (planCap > 0) {
      const roster = await sbGet(env, 'vp_players', 'session_id=eq.' + enc(sessionId) + '&kicked=eq.false&select=id,device_id');
      const count = countPlayers(roster);   // devices, not joins: never ask a host to approve phantom players
      /* An approval covers the number the host actually saw, plus a margin for stragglers still
         walking in. Past that we ask again rather than quietly billing on. Before this, one tap
         on "5 extra players, $10" at 7pm silently covered 200 players at 11pm. */
      const ceiling = overageCeiling(session, planCap);
      if (count > planCap && (!session.overage_approved || count > ceiling)) {
        /* Whether the night is inside the free first month is decided HERE and sent back, because
           this is the code that decides whether to charge. The consoles were working it out
           themselves with a calendar month while this Worker counts a fixed 30 days, so a venue
           created on 1 March got no consent screen on 31 March and was billed anyway, against a
           terms page that promises nothing is charged without that confirmation. */
        const freeMonth = await venueInFreeMonth(env, session.venue_id);
        return json({ error: 'overage_approval_required', needs_overage_ack: true,
          players: count, plan_cap: planCap, extra: count - planCap, free_month: freeMonth }, 402);
      }
    }
  }

  // NOTE: the old running game is NOT finished here. Each start path finishes the OTHER
  // running games (via finishOtherRunningGames) only AFTER its new game row is safely
  // inserted, so a start that fails validation (empty question set, short playlist, bad
  // raffle range, weekly limit) can never destroy the game already in progress.

  // Next game sequence number within the session.
  const existing = await sbGet(env, 'vp_games', 'session_id=eq.' + enc(sessionId) + '&select=seq&order=seq.desc&limit=1');
  const seq = existing.length ? existing[0].seq + 1 : 1;

  // TRIVIA + MUSICAL branches reuse everything above (auth, staff, kill-switch,
  // rollover, seq) and only differ in the per-format tables they write.
  if (isTrivia) return await hostStartTrivia(env, json, b, session, staff, seq);
  if (isMusical) return await hostStartMusical(env, json, b, session, staff, seq);
  if (isRaffle) return await hostStartRaffle(env, json, b, session, staff, seq);

  const config = {};
  if (b.prize) config.prize = String(b.prize).slice(0, 120);   // host-typed prize text, shown on TV
  if (b.title) config.title = String(b.title).slice(0, 120);

  // Cards per player: the host may ask for more than one card. SCHEMA LIMIT:
  // vp_cards has a unique index (game_id, player_id) plus vp_cards_one_per_player_game,
  // so at most ONE card per player per game can exist today. We therefore deal
  // exactly one and record the requested number in config, so when that index is
  // relaxed (a later slice) this endpoint can honour it without a client change.
  let cardsPerPlayer = parseInt(b.cards_per_player, 10);
  if (!(cardsPerPlayer >= 1)) cardsPerPlayer = 1;
  if (cardsPerPlayer > 1) { config.cards_per_player_requested = cardsPerPlayer; cardsPerPlayer = 1; }

  const gameRows = await sbInsert(env, 'vp_games', {
    session_id: sessionId,
    seq,
    format: 'bingo90',   // 90-ball housie; migration 07 widened vp_games_format_check to allow this
    status: 'running',
    config,
    started_at: new Date().toISOString(),
  }, true);
  const game = Array.isArray(gameRows) ? gameRows[0] : gameRows;
  await finishOtherRunningGames(env, session.id, game.id);   // now safe: the new round exists

  // The night is now underway: move the session from 'lobby' to 'running' on the
  // first game so the status reflects reality (and stamps started_at once).
  if (session.status === 'lobby') {
    await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(sessionId), { status: 'running', started_at: new Date().toISOString() });
  }

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
  }, actorRef(staff));

  return json({ game_id: game.id, seq, pattern, cards_dealt: cards.length });
}

/* ------------------------------ TRIVIA: start a game ------------------------------
 * Called from /host/game when format='trivia'. Writes the vp_games row and the
 * vp_trivia_games row for the chosen question set. The set must belong to THIS venue
 * or be a VenuePlay library set (owner_venue_id null + visibility='library'); a
 * private set from another venue is rejected here even though service_role bypasses
 * RLS. No question content (and never a correct_index) is read or emitted at start.
 */
async function hostStartTrivia(env, json, b, session, staff, seq) {
  const setId = String(b.question_set_id || '').trim();
  if (!setId) return json({ error: 'Missing question_set_id' }, 400);
  assertUuid(setId, 'question_set_id');

  const sets = await sbGet(env, 'vp_question_sets',
    'id=eq.' + enc(setId) + '&select=id,owner_venue_id,visibility,title,question_count');
  if (!sets.length) return json({ error: 'Question set not found' }, 404);
  const set = sets[0];
  const ownedHere = set.owner_venue_id === session.venue_id;
  const isLibrary = set.owner_venue_id == null && set.visibility === 'library';
  if (!ownedHere && !isLibrary) return json({ error: 'That question set is not available to this venue' }, 403);

  // Count the questions now: it drives qtotal on the phones/TV and the end-of-round
  // check in /host/question. We select only ids, never correct_index.
  /* parked_at is set on questions pulled from play (flagged by venues, or withdrawn by us as
     unfit for a pub screen). Migration 32 added the column and listed this filter as still to do,
     so until now parking a question did nothing at all and it kept coming up in rounds. */
  const qs = await sbGet(env, 'vp_questions', 'set_id=eq.' + enc(setId) + '&parked_at=is.null&select=id,seq');
  const allSeqs = qs.map((r) => r.seq).filter((s) => s != null);
  if (!allSeqs.length) return json({ error: 'That question set has no questions' }, 409);
  const seqToId = {};
  qs.forEach((r) => { if (r.seq != null) seqToId[r.seq] = r.id; });
  // Host can play fewer than the whole set this round (default = whole set).
  let questionCount = allSeqs.length;
  const wantN = parseInt(b.question_count, 10);
  if (wantN >= 1 && wantN < questionCount) questionCount = wantN;

  // VARIETY + NO-REPEAT: pick this round's questions AT RANDOM, skipping (a) ones already used
  // earlier THIS session, and (b) ones this VENUE has asked in the last 12 months (per-venue
  // "already asked" memory in vp_asked_questions). A question recycles 12 months after its last
  // ask. If that leaves too few, we relax the 12-month rule rather than block the game. Chosen
  // seqs are stored on the game (config.question_seqs) and served from there.
  const priorTrivia = await sbGet(env, 'vp_games',
    'session_id=eq.' + enc(session.id) + '&format=eq.trivia&select=config');
  const used = {};
  priorTrivia.forEach((g) => { const sq = g && g.config && g.config.question_seqs; if (Array.isArray(sq)) sq.forEach((s) => { used[s] = true; }); });
  // Cross-night memory: ids this venue asked within the last 365 days. Wrapped so that if the
  // vp_asked_questions table is not migrated yet, we simply fall back to session-only variety.
  const askedIds = {};
  if (session.venue_id) {
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const askedRows = await sbGet(env, 'vp_asked_questions',
        'venue_id=eq.' + enc(session.venue_id) + '&asked_at=gt.' + enc(cutoff) + '&select=question_id');
      askedRows.forEach((r) => { if (r.question_id) askedIds[r.question_id] = true; });
    } catch (e) { /* table not migrated yet -> session-only variety */ }
  }
  let pool = allSeqs.filter((s) => !used[s] && !askedIds[seqToId[s]]);
  if (pool.length < questionCount) pool = allSeqs.filter((s) => !used[s]);   // relax the 12-month rule (recycle early)
  if (pool.length < questionCount) pool = allSeqs.slice();                   // whole set used this session -> reset
  const chosenSeqs = shuffleArray(pool.slice()).slice(0, questionCount);
  questionCount = chosenSeqs.length;

  // vp_trivia_games has no per-game points/time/prize columns, so the host's overrides
  // and display text live in vp_games.config (same place bingo keeps prize/title).
  /* chosenSeqs has to be SAVED, and this line not existing is why none of the above did anything.
     Everything around it was built and correct: the shuffle, the within-session no-repeat, the
     twelve-month per-venue memory, and the server that serves a game by config.question_seqs
     when it finds one. It never found one. So every round fell through to the legacy path and
     played the set in plain seq order, which is why a venue running two rounds in a night got
     the same questions in the same order both times.

     It was also quietly poisoning the long memory. vp_asked_questions was written from
     chosenSeqs, so we recorded questions as "asked at this venue" that the room had never been
     asked, and then refused to ask them for twelve months. The bank was being burned through
     without a single one of those questions reaching a player. */
  const config = { question_set_id: setId, question_count: questionCount, question_seqs: chosenSeqs };
  if (b.title) config.title = String(b.title).slice(0, 120);
  if (b.prize) config.prize = String(b.prize).slice(0, 120);
  const base = parseInt(b.base_points, 10);
  if (base >= 0 && base <= 100000) config.base_points = base;
  const tl = parseInt(b.time_limit_s, 10);
  if (tl >= 3 && tl <= 300) config.time_limit_s = tl;
  if (typeof b.colour === 'boolean') config.colour = b.colour;
  const speedBonus = b.speed_bonus !== false;   // default on
  config.speed_bonus = speedBonus;

  const gameRows = await sbInsert(env, 'vp_games', {
    session_id: session.id, seq, format: 'trivia', status: 'running', config,
    started_at: new Date().toISOString(),
  }, true);
  const game = Array.isArray(gameRows) ? gameRows[0] : gameRows;
  await finishOtherRunningGames(env, session.id, game.id);   // now safe: the new round exists

  /* Record the questions as asked ONLY now the round exists. This used to run before the insert,
     so a host double-tapping "Start round" hit the unique (session_id, seq) index, the round was
     never created, and twenty questions were still burned at that venue for twelve months. Same
     fault migration 36 was written to clean up, just smaller. Best-effort: a logging failure must
     never stop a game that has already started. */
  if (session.venue_id) {
    const askedInsert = chosenSeqs.map((sq) => ({ venue_id: session.venue_id, question_id: seqToId[sq] })).filter((r) => r.question_id);
    if (askedInsert.length) { try { await sbInsert(env, 'vp_asked_questions', askedInsert, false); } catch (e) { /* non-fatal */ } }
  }

  await sbInsert(env, 'vp_trivia_games', {
    game_id: game.id, question_set_id: setId, current_seq: 0, phase: 'idle', speed_bonus: speedBonus,
  }, false);
  await stampWeeklyFormat(env, session, true);   // once-a-week slot used only now the game exists

  if (session.status === 'lobby') {
    await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(session.id), { status: 'running', started_at: new Date().toISOString() });
  }

  await emitEvent(env, session, 'game.started', {
    game_id: game.id, seq, format: 'trivia',
    question_count: questionCount, title: config.title || null, prize: config.prize || null,
    colour: config.colour !== false,
  }, actorRef(staff));

  return json({ game_id: game.id, seq, format: 'trivia', question_count: questionCount });
}

/* ------------------------------ MUSICAL BINGO: start a game ------------------------------
 * Called from /host/game when format='musical' (or 'musical_bingo'). Musical bingo is
 * BINGO WITH SONGS: the "balls" are songs the host plays in the room, and a card cell is
 * a song title instead of a number. This writes the vp_games row and the vp_music_games
 * row, then deals a 5x5 card (index 12 is the FREE centre) of song titles to every player.
 *
 * WHERE THE SONGS COME FROM. vp_music_plays.song_id is a FOREIGN KEY to
 * vp_playlist_songs(id), so a played song must be a real vp_playlist_songs row. This
 * endpoint accepts EITHER:
 *   - playlist_id : an existing vp_playlists uuid (venue-authored, owned here, OR a
 *                   VenuePlay library playlist with owner_venue_id null), the exact
 *                   parallel to trivia's question_set_id; OR
 *   - playlist    : an inline { name, songs:[{title, artist, hint?}] } which the Worker
 *                   MATERIALISES into vp_playlists + vp_playlist_songs (reused on replay).
 * The inline path is what the host page uses today: the 430-song library lives in
 * data/musical-library.json (client asset for the audio previews) and is not seeded into
 * the DB, so the Worker turns the chosen playlist into real rows the FK can point at.
 * AUDIO IS A CLIENT CONCERN: the host device plays the ~30s previewUrl clip through the
 * PA. The Worker never stores or streams audio; it only tracks WHICH song was played.
 */
async function hostStartMusical(env, json, b, session, staff, seq) {
  // Pattern: accept the host UI values (one/two/corners/full) and the DB values, map to
  // the four vp_music_games patterns. Musical bingo DOES have four_corners (5x5 grid).
  const patternMap = {
    one: 'one_line', two: 'two_lines', corners: 'four_corners', full: 'full_house',
    one_line: 'one_line', two_lines: 'two_lines', four_corners: 'four_corners', full_house: 'full_house',
  };
  const pattern = patternMap[String(b.pattern || '')];
  if (!pattern) return json({ error: 'Invalid pattern' }, 400);

  // Resolve the playlist to a vp_playlists id whose vp_playlist_songs the card is dealt
  // from and the host plays against. Either an existing id or an inline materialise.
  let playlistId = null;
  let playlistName = b.playlist_name ? String(b.playlist_name).slice(0, 120) : null;
  if (b.playlist_id) {
    playlistId = String(b.playlist_id).trim();
    assertUuid(playlistId, 'playlist_id');
    const pls = await sbGet(env, 'vp_playlists', 'id=eq.' + enc(playlistId) + '&select=id,owner_venue_id,title');
    if (!pls.length) return json({ error: 'Playlist not found' }, 404);
    const pl = pls[0];
    const ownedHere = pl.owner_venue_id === session.venue_id;
    const isLibrary = pl.owner_venue_id == null;   // library playlists have a null owner
    if (!ownedHere && !isLibrary) return json({ error: 'That playlist is not available to this venue' }, 403);
    if (!playlistName) playlistName = pl.title || 'Playlist';
  } else {
    // Inline materialise. songs is metadata only (title + artist [+ hint]); previewUrl is
    // never sent here or stored (licensing: VenuePlay hosts no audio).
    const raw = Array.isArray(b.songs) ? b.songs : (b.playlist && Array.isArray(b.playlist.songs) ? b.playlist.songs : null);
    if (!raw) return json({ error: 'Provide a playlist_id or an inline songs list' }, 400);
    const clean = [];
    for (let i = 0; i < Math.min(raw.length, 500); i++) {   // cap materialised songs at 500
      const t = raw[i] && raw[i].title != null ? String(raw[i].title).trim().slice(0, 200) : '';
      const a = raw[i] && raw[i].artist != null ? String(raw[i].artist).trim().slice(0, 200) : '';
      if (t && a) clean.push({ title: t, artist: a, hint: raw[i].hint ? String(raw[i].hint).slice(0, 200) : null });
    }
    if (!playlistName) playlistName = (b.playlist && b.playlist.name) ? String(b.playlist.name).slice(0, 120) : 'Playlist';
    if (!clean.length) return json({ error: 'The playlist has no valid songs' }, 400);
    playlistId = await ensureMusicPlaylist(env, session.venue_id, playlistName, clean);
  }

  // Read the playlist's songs (with their real uuids) once. These uuids are what the host
  // plays (/host/play) and what the claim check matches; the card stores them per cell.
  const songs = await sbGet(env, 'vp_playlist_songs',
    'playlist_id=eq.' + enc(playlistId) + '&select=id,title,artist&order=seq.asc.nullslast,title.asc');
  if (songs.length < 24) return json({ error: 'A musical bingo playlist needs at least 24 songs' }, 409);

  const autoDaub = b.auto_daub !== false;   // default on; maps to reveal_mode
  const config = { pattern, playlist_id: playlistId, playlist_name: playlistName, song_count: songs.length, auto_daub: autoDaub };
  if (b.prize) config.prize = String(b.prize).slice(0, 120);
  if (b.title) config.title = String(b.title).slice(0, 120);

  const gameRows = await sbInsert(env, 'vp_games', {
    session_id: session.id, seq, format: 'musical_bingo', status: 'running', config,
    started_at: new Date().toISOString(),
  }, true);
  const game = Array.isArray(gameRows) ? gameRows[0] : gameRows;
  await finishOtherRunningGames(env, session.id, game.id);   // now safe: the new round exists

  await sbInsert(env, 'vp_music_games', {
    game_id: game.id, playlist_id: playlistId, pattern,
    reveal_mode: autoDaub ? 'instant' : 'manual',   // auto-daub on = titles reveal on every card the instant a song is played
  }, false);
  await stampWeeklyFormat(env, session, false);   // once-a-week slot used only now the game exists

  if (session.status === 'lobby') {
    await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(session.id), { status: 'running', started_at: new Date().toISOString() });
  }

  // Deal one 5x5 card of song titles to every current non-kicked player.
  const players = await sbGet(env, 'vp_players', 'session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id');
  const cards = players.map((p, i) => ({
    game_id: game.id, player_id: p.id, card_no: i + 1, cells: generateMusicCard(songs),
  }));
  if (cards.length) await sbInsert(env, 'vp_cards', cards, false);

  await emitEvent(env, session, 'game.started', {
    game_id: game.id, seq, format: 'musical_bingo', pattern,
    prize: config.prize || null, title: config.title || null,
    playlist_name: playlistName, song_count: songs.length, auto_daub: autoDaub,
  }, actorRef(staff));

  // The host response carries the playlist's songs WITH their uuids so the host page can
  // map each to its previewUrl/artwork from the library (client-side) and send song_id to
  // /host/play. The card contents dealt to phones stay private (fetched via /player/card).
  return json({
    game_id: game.id, seq, format: 'musical_bingo', pattern,
    cards_dealt: cards.length, playlist_id: playlistId, playlist_name: playlistName,
    song_count: songs.length,
    songs: songs.map((s) => ({ song_id: s.id, title: s.title, artist: s.artist })),
  });
}

/* ------------------------------ RAFFLE: start a game ------------------------------
 * Called from /host/game when format='raffle'. RAFFLE IS HOST-ONLY and is NEVER metered:
 * the venue sells its own PAPER tickets, so there is no /join, no vp_players and nothing
 * that the peak-player billing view counts (that view only counts players dealt a bingo/
 * musical card or who answered a trivia question; a raffle creates none of those). It is a
 * free selling point. This writes the vp_games row (format='raffle') and the vp_raffle_games
 * row in number_range mode: the host types the START (range_min) and END (range_max) ticket
 * number they sold, plus how many winners, a time-to-present countdown, allow-redraw, and an
 * optional cash jackpot. The prize text/type lives in vp_games.config (vp_raffle_games has no
 * prize column) and is stamped onto each vp_raffle_results row at draw time. leading_zeros is
 * DERIVED from range_max at render time (schema note: no column); we carry the host's toggle
 * in config purely so the screen pads consistently.
 */
async function hostStartRaffle(env, json, b, session, staff, seq) {
  // number_range mode only. player_pool (auto-numbered tickets on join) is a dormant schema
  // seam and is deliberately not wired: raffle has no player join and must stay unmetered.
  const rangeMin = parseInt(b.range_min, 10);
  const rangeMax = parseInt(b.range_max, 10);
  if (isNaN(rangeMin) || isNaN(rangeMax)) return json({ error: 'Enter a valid ticket range (first and last number)' }, 400);
  if (rangeMin < 0 || rangeMax < rangeMin) return json({ error: 'The last ticket number must be at or above the first' }, 400);
  const span = rangeMax - rangeMin + 1;
  if (span > 1000000) return json({ error: 'That ticket range is too large' }, 400);

  const jackpotOn = b.jackpot_on === true;
  let jackpotCents = null;
  if (jackpotOn) {
    jackpotCents = parseInt(b.jackpot_amount_cents, 10);
    if (isNaN(jackpotCents) || jackpotCents <= 0) return json({ error: 'Enter a cash jackpot amount' }, 400);
  }

  // Winners: cap 50; a cash-jackpot raffle forces exactly 1 winner (locked).
  let winners = parseInt(b.winners != null ? b.winners : b.draws_count, 10);
  if (!(winners >= 1)) winners = 1;
  if (winners > 50) winners = 50;
  if (jackpotOn) winners = 1;
  if (winners > span) return json({ error: 'Not enough tickets in that range for ' + winners + ' winners' }, 400);

  let timeToPresent = parseInt(b.time_to_present != null ? b.time_to_present : b.time_to_claim_seconds, 10);
  if (!(timeToPresent >= 0)) timeToPresent = null;

  const allowRedraw = b.allow_redraw !== false;    // default on
  const leadingZeros = b.leading_zeros !== false;  // default on; display width is derived from range_max

  // Prize text + type live in vp_games.config (same place bingo/trivia keep prize/title).
  const config = { leading_zeros: leadingZeros };
  if (b.prize) config.prize = String(b.prize).slice(0, 120);
  if (b.title) config.title = String(b.title).slice(0, 120);
  const pt = String(b.prize_type || '').toLowerCase();
  if (pt === 'cash' || pt === 'other') config.prize_type = pt;
  if (jackpotOn) { config.prize_type = 'cash'; config.jackpot_amount_cents = jackpotCents; }
  if (Array.isArray(b.prizes)) config.prizes = b.prizes.slice(0, 12).map((p) => String(p).slice(0, 120));

  // Tickets that were never sold. Two sellers working from one book leaves a hole in the middle,
  // and drawing a number nobody holds means standing there re-drawing in front of the room.
  // Kept on the game config as [[from,to],...] so it needs no schema change.
  const excluded = [];
  if (Array.isArray(b.excluded_ranges)) {
    for (const r of b.excluded_ranges.slice(0, 20)) {
      const a = parseInt(Array.isArray(r) ? r[0] : r && r.from, 10);
      const z = parseInt(Array.isArray(r) ? r[1] : r && r.to, 10);
      if (isNaN(a) || isNaN(z)) continue;
      const lo = Math.max(rangeMin, Math.min(a, z));
      const hi = Math.min(rangeMax, Math.max(a, z));
      if (hi >= lo) excluded.push([lo, hi]);
    }
  }
  if (excluded.length) {
    let out = 0;
    for (const [lo, hi] of excluded) out += (hi - lo + 1);
    if (rangeMax - rangeMin + 1 - out < 1) {
      return json({ error: 'That excludes every ticket in the range' }, 400);
    }
    config.excluded_ranges = excluded;   // straight onto the config the game row is built from
  }

  const gameRows = await sbInsert(env, 'vp_games', {
    session_id: session.id, seq, format: 'raffle', status: 'running', config,
    started_at: new Date().toISOString(),
  }, true);
  const game = Array.isArray(gameRows) ? gameRows[0] : gameRows;
  await finishOtherRunningGames(env, session.id, game.id);   // now safe: the new round exists

  const rngSeed = randomTokenHex(16);   // stored for audit ("prove the draw was fair")
  await sbInsert(env, 'vp_raffle_games', {
    game_id: game.id,
    mode: 'number_range',
    range_min: rangeMin,
    range_max: rangeMax,
    draws_count: winners,
    time_to_claim_seconds: timeToPresent,
    allow_redraw: allowRedraw,
    jackpot_on: jackpotOn,
    jackpot_amount_cents: jackpotCents,
    rng_seed: rngSeed,
  }, false);

  if (session.status === 'lobby') {
    await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(session.id), { status: 'running', started_at: new Date().toISOString() });
  }

  const padWidth = leadingZeros ? String(Math.max(rangeMax, 1)).length : 1;
  await emitEvent(env, session, 'game.started', {
    game_id: game.id, seq, format: 'raffle',
    range_min: rangeMin, range_max: rangeMax, winners,
    prize: config.prize || null, prize_type: config.prize_type || null,
    allow_redraw: allowRedraw, time_to_present: timeToPresent, pad: padWidth,
    jackpot_on: jackpotOn, jackpot_amount_cents: jackpotCents,
  }, actorRef(staff));

  return json({
    game_id: game.id, seq, format: 'raffle',
    range_min: rangeMin, range_max: rangeMax, winners,
    allow_redraw: allowRedraw, time_to_present: timeToPresent, pad: padWidth,
    jackpot_on: jackpotOn,
  });
}

/* ------------------------------ POST /host/draw ------------------------------
 * The host taps Draw. The Worker (NOT the phone or the TV) picks the winning ticket
 * number(s) UNIFORMLY at random in [range_min, range_max] with a rejection-sampled CSPRNG
 * (randInt over crypto.getRandomValues), so the draw is unbiased and NOT modulo-biased. It
 * excludes any number already drawn in this raffle, writes vp_raffle_results (prize_text +
 * prize_type + optional value for the cash-given-away rollup), and emits 'raffle.winner' to
 * the screen. Optional redraw_of_seq marks that earlier round no_show (dropping it from the
 * prizes-given view) before drawing a replacement, only when the raffle allows a redraw.
 * NOT metered: this writes no vp_players and touches nothing the peak-player view counts.
 */
async function handleHostDraw(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format,config');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'raffle') return json({ error: 'Not a raffle game' }, 400);
  if (game.status !== 'running') return json({ error: 'This raffle is not running' }, 409);
  const session = await getSession(env, game.session_id);
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the venue (also kill-switch)

  const rg = await sbGet(env, 'vp_raffle_games',
    'game_id=eq.' + enc(gameId) + '&select=range_min,range_max,draws_count,allow_redraw,time_to_claim_seconds,jackpot_on,jackpot_amount_cents');
  if (!rg.length) return json({ error: 'Not a raffle game' }, 404);
  const raffle = rg[0];
  const min = raffle.range_min, max = raffle.range_max;
  if (min == null || max == null || max < min) return json({ error: 'This raffle has no ticket range' }, 409);

  // Optional redraw: mark the previous round a no_show (which drops it from the prizes-given
  // rollup) before drawing its replacement. Honoured only when the raffle allows a redraw.
  const redrawSeq = (b.redraw_of_seq != null) ? parseInt(b.redraw_of_seq, 10) : NaN;
  const isRedraw = !isNaN(redrawSeq);
  if (isRedraw) {
    if (!raffle.allow_redraw) return json({ error: 'This raffle does not allow a redraw' }, 409);
    await sbPatch(env, 'vp_raffle_results', 'game_id=eq.' + enc(gameId) + '&seq=eq.' + redrawSeq,
      { status: 'no_show', outcome: 'no_show' });
  }

  // Numbers already drawn in this raffle (ANY outcome) are never drawn again.
  const prior = await sbGet(env, 'vp_raffle_results', 'game_id=eq.' + enc(gameId) + '&select=ticket_number,seq,drawn_at&order=seq.desc');
  const drawn = {};
  let maxSeq = 0;
  for (let i = 0; i < prior.length; i++) {
    if (prior[i].ticket_number != null) drawn[prior[i].ticket_number] = true;
    if (prior[i].seq != null && prior[i].seq > maxSeq) maxSeq = prior[i].seq;
  }

  // Double-tap guard: if a draw for this raffle just happened (<3s ago), treat a second tap as
  // the same click and do NOT draw again - stops duplicate winners / a colliding round number
  // from a fast double-click. A deliberate later draw is unaffected. (A redraw is a separate,
  // explicit action and is not gated here.)
  if (!isRedraw && prior.length && prior[0].drawn_at) {
    const since = Date.now() - new Date(prior[0].drawn_at).getTime();
    if (since >= 0 && since < 3000) {
      return json({ error: 'A draw just happened. Give it a second before drawing again.' }, 429);
    }
  }

  const span = max - min + 1;
  let winners = raffle.draws_count || 1;
  if (b.winners != null) { const w = parseInt(b.winners, 10); if (w >= 1) winners = w; }   // per-draw override
  winners = Math.max(1, Math.min(50, winners));
  if (raffle.jackpot_on) winners = 1;   // a cash-jackpot raffle always draws exactly one
  // Unsold blocks count as already gone, so the draw never lands on a ticket nobody holds.
  const excl = (game.config && Array.isArray(game.config.excluded_ranges)) ? game.config.excluded_ranges : [];
  const inExcluded = (n) => { for (const r of excl) { if (n >= r[0] && n <= r[1]) return true; } return false; };
  let excludedInRange = 0;
  for (const r of excl) {
    const lo = Math.max(min, r[0]), hi = Math.min(max, r[1]);
    if (hi >= lo) excludedInRange += (hi - lo + 1);
  }
  const drawnCount = Object.keys(drawn).length;
  const available = span - drawnCount - excludedInRange;
  if (available < winners) return json({ error: 'Not enough tickets left for ' + winners + ' winner(s). Check your sold ranges.' }, 409);

  // UNBIASED uniform draw: randInt(span) is rejection-sampled over crypto.getRandomValues,
  // so every ticket in [min,max] is equally likely (no modulo bias). Reject duplicates and
  // already-drawn numbers.
  const picks = [];
  const chosen = {};
  let guard = 0;
  const guardMax = span * 8 + 100;
  while (picks.length < winners && guard < guardMax) {
    guard++;
    const n = min + randInt(span);
    if (drawn[n] || chosen[n] || inExcluded(n)) continue;
    chosen[n] = true;
    picks.push(n);
  }
  if (picks.length < winners) return json({ error: 'Could not draw enough unique tickets, please try again' }, 409);

  // Prize for THIS round: body override, else the game config. A cash jackpot is always cash.
  const cfg = game.config || {};
  let prizeText = (b.prize != null) ? String(b.prize).slice(0, 120) : (cfg.prize || null);
  let prizeType = null;
  const bpt = String(b.prize_type || '').toLowerCase();
  if (bpt === 'cash' || bpt === 'other') prizeType = bpt;
  else if (cfg.prize_type === 'cash' || cfg.prize_type === 'other') prizeType = cfg.prize_type;
  let prizeValueCents = null;
  if (b.prize_value_cents != null) { const v = parseInt(b.prize_value_cents, 10); if (v >= 0) prizeValueCents = v; }
  if (raffle.jackpot_on) {
    prizeType = 'cash';
    if (prizeValueCents == null) prizeValueCents = raffle.jackpot_amount_cents;
    if (!prizeText) prizeText = 'Cash jackpot';
  }

  const newSeq = maxSeq + 1;
  const now = new Date().toISOString();
  const rows = picks.map((n) => {
    const row = { game_id: gameId, seq: newSeq, ticket_number: n, status: 'winner', outcome: 'drawn', drawn_at: now };
    if (prizeText) row.prize_text = prizeText;
    if (prizeType) row.prize_type = prizeType;
    if (prizeValueCents != null) row.prize_value_cents = prizeValueCents;
    return row;
  });
  await sbInsert(env, 'vp_raffle_results', rows, false);

  const leadingZeros = cfg.leading_zeros !== false;
  const padWidth = leadingZeros ? String(Math.max(max, 1)).length : 1;
  await emitEvent(env, session, 'raffle.winner', {
    game_id: gameId, seq: newSeq, tickets: picks,
    prize: prizeText || null, prize_type: prizeType || null,
    allow_redraw: raffle.allow_redraw, time_to_present: raffle.time_to_claim_seconds,
    range_min: min, range_max: max, pad: padWidth, redraw: isRedraw,
  }, actorRef(staff));

  return json({
    game_id: gameId, seq: newSeq, tickets: picks, pad: padWidth,
    allow_redraw: raffle.allow_redraw, time_to_present: raffle.time_to_claim_seconds,
    prize: prizeText || null, prize_type: prizeType || null,
  });
}

/* ------------------------------ POST /host/draw/resolve ------------------------------
 * Records whether the drawn winner(s) actually presented at the bar. Raffle's parallel to
 * /host/claim/resolve. outcome 'claimed' (presented, prize handed over) or 'no_show'. A
 * no_show drops that round from the prizes-given rollup; the host can then draw again via
 * /host/draw (with or without redraw_of_seq). Host JWT + venue staff + kill-switch enforced.
 */
async function handleDrawResolve(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');
  const seq = parseInt(b.seq, 10);
  if (isNaN(seq)) return json({ error: 'Missing or invalid seq' }, 400);
  const outcome = b.outcome;
  if (outcome !== 'claimed' && outcome !== 'no_show') return json({ error: 'outcome must be "claimed" or "no_show"' }, 400);

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,format');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  if (games[0].format !== 'raffle') return json({ error: 'Not a raffle game' }, 400);
  const session = await getSession(env, games[0].session_id);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the venue (also kill-switch)

  const results = await sbGet(env, 'vp_raffle_results',
    'game_id=eq.' + enc(gameId) + '&seq=eq.' + seq + '&select=id,ticket_number');
  if (!results.length) return json({ error: 'No draw with that seq' }, 404);

  const patch = { outcome };
  patch.status = (outcome === 'no_show') ? 'no_show' : 'winner';
  await sbPatch(env, 'vp_raffle_results', 'game_id=eq.' + enc(gameId) + '&seq=eq.' + seq, patch);

  const tickets = results.map((r) => r.ticket_number);
  await emitEvent(env, session, 'raffle.result', { game_id: gameId, seq, outcome, tickets }, actorRef(staff));
  return json({ game_id: gameId, seq, outcome, tickets });
}

/* =====================================================================
 * MEMBERS DRAW  (HOST-ONLY, NOT metered, runs off the saved member ROSTER)
 * ---------------------------------------------------------------------
 * Members draw is unlike the other four formats: it does NOT open a vp_sessions
 * row or a vp_games row and is NEVER metered (no /join, no vp_players, nothing the
 * peak-player billing view counts). It runs directly off a venue's PERSISTENT data:
 *   - vp_member_rosters + vp_members : the saved member "database" (name + badge
 *     number). A member with status 'excluded' is barred from the draw; only
 *     status 'valid' members are ever picked (that IS the saved exclude list).
 *   - vp_member_draws               : the NAMED, RECURRING draws a venue runs (e.g.
 *     "Friday Members Badge Draw"), each carrying its own live current_jackpot_cents,
 *     the starting_amount_cents it resets to on a win, and the increment_cents it
 *     grows by on a rollover.
 *   - vp_member_draw_results        : the previous-winners audit log.
 *
 * Because there is no session, the Worker emits nothing to vp_session_events here;
 * the TV/host pair over the pages' Realtime broadcast channel ("vp-members-"+CODE)
 * exactly like the raffle screen does, and the Worker stays the authoritative PICKER
 * and WRITER (unbiased CSPRNG pick; jackpot maths; the durable audit row).
 *
 * ROLE SPLIT: a host may RUN a draw (/host/members/draw + /resolve) and MANAGE the
 * roster (/host/members/roster, enable/disable a member). Only a manager or owner
 * may change the draw/jackpot SETTINGS numbers (/host/members/settings) -- that gate
 * is enforced on the write path below, not just in the UI.
 *
 * SCHEMA NOTE (flagged, not faked): vp_member_draw_results.outcome is NOT NULL and
 * checks in ('claimed','jackpot_rolled'). There is no 'pending' value to write when
 * the winner is first drawn, so the DRAW does not insert a result row; the durable
 * row is written at RESOLVE once the outcome (claim or rollover) is known. The draw
 * only stamps last_drawn_date and returns the winner for the host + TV.
 */

/* ------------------------------ POST /host/members/draw ------------------------------
 * The host taps Draw on a chosen recurring draw. The Worker (NOT the page) reads the
 * draw's roster, keeps only status 'valid' members (respecting the saved exclude list),
 * and picks ONE UNIFORMLY at random with the rejection-sampled CSPRNG randInt (NOT
 * modulo-biased). The winner's name is formatted per the venue's name_display setting
 * (default abbreviate last name -> "John S"). It stamps last_drawn_date and returns the
 * winning member number + name. NOT metered: writes only last_drawn_date, no vp_players.
 */
async function handleMembersDraw(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return json({ error: 'Missing draw_id' }, 400);
  assertUuid(drawId, 'draw_id');

  const draws = await sbGet(env, 'vp_member_draws',
    'id=eq.' + enc(drawId) + '&select=id,venue_id,roster_id,name,current_jackpot_cents,starting_amount_cents,increment_cents,draw_length_seconds,time_to_claim_seconds');
  if (!draws.length) return json({ error: 'Draw not found' }, 404);
  const draw = draws[0];
  await requireStaff(env, authUserId, draw.venue_id);            // ENFORCED: staff at the draw's venue (also kill-switch)

  const members = await validMembers(env, draw);
  if (!members.length) return json({ error: 'No valid members to draw from' }, 409);

  // UNBIASED uniform pick over the valid members, using the SAME rejection-sampled
  // CSPRNG (randInt over crypto.getRandomValues) the ball/raffle draws use.
  const winner = members[randInt(members.length)];
  const nameDisplay = await venueNameDisplay(env, draw.venue_id);
  const winnerName = formatMemberName(winner.first_name, winner.last_name, nameDisplay);

  // Once-per-day schedule audit stamp (schema column last_drawn_date). Host-allowed,
  // not metered. We stamp it rather than hard-block a re-draw so testing stays easy.
  const today = new Date().toISOString().slice(0, 10);
  await sbPatch(env, 'vp_member_draws', 'id=eq.' + enc(drawId), { last_drawn_date: today });

  return json({
    draw_id: drawId, draw_name: draw.name,
    member_id: winner.id, member_number: winner.member_number,
    first_name: winner.first_name, last_name: winner.last_name,
    winner_name: winnerName,
    jackpot_cents: draw.current_jackpot_cents != null ? draw.current_jackpot_cents : 0,
    time_to_claim_seconds: draw.time_to_claim_seconds != null ? draw.time_to_claim_seconds : null,
    draw_length_seconds: draw.draw_length_seconds != null ? draw.draw_length_seconds : null,
    valid_count: members.length,
  });
}

/* ------------------------------ POST /host/members/draw/resolve ------------------------------
 * The host confirms the outcome of the drawn member: 'claim' (present at the bar, jackpot
 * handed over) or 'rollover' ("jackpot to next week", not present). This is where the durable
 * vp_member_draw_results row is written (see the schema note above) AND the jackpot maths runs:
 *   - claim    -> record outcome 'claimed', then RESET current_jackpot_cents to starting_amount_cents.
 *   - rollover -> record outcome 'jackpot_rolled', then GROW current_jackpot_cents by increment_cents.
 * The jackpot amount and the reset/increment maths are re-read from vp_member_draws server-side
 * (never trusted from the client); a supplied member_id must belong to this draw's roster and its
 * name is re-formatted per the venue setting. Host JWT + venue staff + kill-switch enforced.
 */
async function handleMembersResolve(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return json({ error: 'Missing draw_id' }, 400);
  assertUuid(drawId, 'draw_id');

  // Accept the host words (claim / rollover) OR the raw DB enum values.
  const raw = String(b.outcome || '').toLowerCase();
  let outcome = null;
  if (raw === 'claim' || raw === 'claimed') outcome = 'claimed';
  else if (raw === 'rollover' || raw === 'roll' || raw === 'jackpot_rolled') outcome = 'jackpot_rolled';
  if (!outcome) return json({ error: 'outcome must be "claim" or "rollover"' }, 400);

  const draws = await sbGet(env, 'vp_member_draws',
    'id=eq.' + enc(drawId) + '&select=id,venue_id,roster_id,current_jackpot_cents,starting_amount_cents,increment_cents,last_resolved_at');
  if (!draws.length) return json({ error: 'Draw not found' }, 404);
  const draw = draws[0];
  await requireStaff(env, authUserId, draw.venue_id);            // ENFORCED: staff at the draw's venue (also kill-switch)

  // Idempotency: a double-tap (or retry) on resolve must not write a second audit row or
  // advance the jackpot twice. If this draw was resolved in the last 30s, treat it as the
  // same action and return the current state unchanged. A genuine re-resolve after the next
  // draw (minutes later) proceeds normally.
  const lastResolved = draw.last_resolved_at ? new Date(draw.last_resolved_at).getTime() : 0;
  if (lastResolved && (Date.now() - lastResolved) < 30000) {
    return json({ draw_id: drawId, outcome, amount_cents: draw.current_jackpot_cents,
      new_jackpot_cents: draw.current_jackpot_cents,
      increment_cents: draw.increment_cents != null ? draw.increment_cents : 0, duplicate: true });
  }

  // Re-derive the winner server-side. A supplied member_id MUST belong to this draw's roster
  // (never trust a client-named winner); the name is re-formatted per the venue setting. A drawn
  // number that is not a member (member_id absent) is recorded from member_number/winner_name.
  let memberId = null, memberNumber = null, winnerName = null;
  if (b.member_id != null && String(b.member_id).trim()) {
    memberId = String(b.member_id).trim();
    assertUuid(memberId, 'member_id');
    const mem = await memberInDraw(env, draw, memberId);
    if (!mem) return json({ error: 'That member is not in this draw' }, 400);
    memberNumber = mem.member_number;
    const nameDisplay = await venueNameDisplay(env, draw.venue_id);
    winnerName = formatMemberName(mem.first_name, mem.last_name, nameDisplay);
  } else {
    if (b.member_number != null) { const n = parseInt(b.member_number, 10); if (!isNaN(n)) memberNumber = n; }
    if (b.winner_name != null) winnerName = String(b.winner_name).slice(0, 80);
  }

  const jackpotAtDraw = draw.current_jackpot_cents != null ? draw.current_jackpot_cents : 0;

  // Durable audit row (written HERE at resolve; see the schema note). amount_cents = the jackpot
  // that was on offer at the draw; v_vp_prizes_given totals ONLY the 'claimed' rows.
  const resultRow = { draw_id: drawId, outcome, amount_cents: jackpotAtDraw };
  if (memberId) resultRow.member_id = memberId;
  if (memberNumber != null) resultRow.member_number = memberNumber;
  if (winnerName) resultRow.winner_name = winnerName;
  await sbInsert(env, 'vp_member_draw_results', resultRow, false);

  // Jackpot maths, computed server-side from the stored numbers.
  let newJackpot;
  if (outcome === 'claimed') {
    newJackpot = draw.starting_amount_cents != null ? draw.starting_amount_cents : jackpotAtDraw;
  } else {
    newJackpot = jackpotAtDraw + (draw.increment_cents != null ? draw.increment_cents : 0);
  }
  await sbPatch(env, 'vp_member_draws', 'id=eq.' + enc(drawId),
    { current_jackpot_cents: newJackpot, last_resolved_at: new Date().toISOString() });

  return json({
    draw_id: drawId, outcome,
    amount_cents: jackpotAtDraw,
    new_jackpot_cents: newJackpot,
    increment_cents: draw.increment_cents != null ? draw.increment_cents : 0,
  });
}

/* ------------------------------ POST /host/members/settings ------------------------------
 * MANAGER/OWNER ONLY. This is the SETTINGS-WRITE path: the draw/jackpot numbers a host must not
 * be able to change (starting amount, weekly increment, the live jackpot, claim/draw-length
 * seconds, the day/time shown on ads, and which roster the draw uses). With a draw_id it updates
 * that recurring draw; without one it creates a new recurring draw (name required). The role gate
 * is enforced HERE in code, not just hidden in the UI. requireStaff also enforces the kill-switch.
 */
async function handleMembersSettings(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);

  const drawId = b.draw_id != null ? String(b.draw_id).trim() : '';
  let venueId, existing = null;
  if (drawId) {
    assertUuid(drawId, 'draw_id');
    const rows = await sbGet(env, 'vp_member_draws', 'id=eq.' + enc(drawId) + '&select=id,venue_id');
    if (!rows.length) return json({ error: 'Draw not found' }, 404);
    existing = rows[0]; venueId = existing.venue_id;
  } else {
    venueId = String(b.venue_id || '').trim();
    if (!venueId) return json({ error: 'Missing venue_id' }, 400);
    assertUuid(venueId, 'venue_id');
  }

  // MANAGER GATE: hosts run draws + manage the roster, but only a manager/owner may change the
  // draw and jackpot SETTINGS numbers. requireStaff returns the staff row (with .role).
  const staff = await requireStaff(env, authUserId, venueId);
  if (staff.role !== 'owner' && staff.role !== 'manager') {
    return json({ error: 'Only a manager or owner can change the draw and jackpot settings' }, 403);
  }

  // Build the patch from the numeric/schedule columns only.
  const patch = {};
  const intField = (key) => { if (b[key] != null) { const n = parseInt(b[key], 10); if (!isNaN(n)) patch[key] = n; } };
  intField('starting_amount_cents');
  intField('increment_cents');
  intField('current_jackpot_cents');
  intField('time_to_claim_seconds');
  intField('draw_length_seconds');
  // The name is editable on an EXISTING draw too. It was only ever read on the create branch, so
  // a venue renaming its draw was told "saved" and the TV kept showing the old name forever.
  if (b.name != null) { const nm = String(b.name).slice(0, 120).trim(); if (nm) patch.name = nm; }
  if (b.draw_day != null) patch.draw_day = String(b.draw_day).slice(0, 20);
  if (b.draw_time != null) patch.draw_time = String(b.draw_time).slice(0, 20);
  // The owner sets when the draw started running (shown as "running since" on the TV). Only a
  // real YYYY-MM-DD is accepted so a bad value can never overwrite it.
  if (b.date_started != null) { const ds = String(b.date_started).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) patch.date_started = ds; }
  if (b.roster_id != null && String(b.roster_id).trim()) {
    const rid = String(b.roster_id).trim(); assertUuid(rid, 'roster_id'); patch.roster_id = rid;
  }

  if (existing) {
    if (Object.keys(patch).length) await sbPatch(env, 'vp_member_draws', 'id=eq.' + enc(drawId), patch);
    const rows = await sbGet(env, 'vp_member_draws', 'id=eq.' + enc(drawId) + '&select=*');
    return json({ draw: rows[0] });
  }
  // Create a new recurring draw (manager-only). A name is required.
  const name = b.name != null ? String(b.name).slice(0, 120).trim() : '';
  if (!name) return json({ error: 'A draw needs a name' }, 400);
  const row = Object.assign({ venue_id: venueId, name }, patch);
  if (row.current_jackpot_cents == null && row.starting_amount_cents != null) row.current_jackpot_cents = row.starting_amount_cents;
  if (row.date_started == null) row.date_started = new Date().toISOString().slice(0, 10);
  const inserted = await sbInsert(env, 'vp_member_draws', row, true);
  return json({ draw: Array.isArray(inserted) ? inserted[0] : inserted });
}

/* ------------------------------ POST /host/members/roster ------------------------------
 * Roster management (HOST-ALLOWED, not metered): enable or disable a saved member for the draw.
 * status 'valid' puts them back in the draw; status 'excluded' bars them (barred / not financial).
 * The member's roster must belong to the caller's venue. This is deliberately host-allowed to
 * prove the role split: a host CAN write the roster but CANNOT write the settings numbers above.
 */
async function handleMembersRoster(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const memberId = String(b.member_id || '').trim();
  if (!memberId) return json({ error: 'Missing member_id' }, 400);
  assertUuid(memberId, 'member_id');
  const status = String(b.status || '').toLowerCase();
  if (status !== 'valid' && status !== 'excluded') return json({ error: 'status must be "valid" or "excluded"' }, 400);

  const rows = await sbGet(env, 'vp_members', 'id=eq.' + enc(memberId) + '&select=id,roster_id');
  if (!rows.length) return json({ error: 'Member not found' }, 404);
  const rosters = await sbGet(env, 'vp_member_rosters',
    'id=eq.' + enc(rows[0].roster_id) + '&select=id,venue_id');
  if (!rosters.length) return json({ error: 'Member not found' }, 404);
  // MANAGER GATE (Dean, 12 Aug 2026): the members list is edited in the Account page, not on the
  // host console. A host runs the draw; who is on the list is an account decision. This matches
  // the gate already on /host/members/settings and /host/members/import.
  const _rstaff = await requireStaff(env, authUserId, rosters[0].venue_id);
  if (_rstaff.role !== 'owner' && _rstaff.role !== 'manager') {
    return json({ error: 'Only a manager or owner can change the members list' }, 403);
  }

  await sbPatch(env, 'vp_members', 'id=eq.' + enc(memberId), { status, updated_at: new Date().toISOString() });
  return json({ member_id: memberId, status });
}

/* POST /host/members/import  (MANAGER/OWNER) : bulk-add to the venue's members list.
   body: { draw_id?|venue_id, members:[{number, name}] }  -> { added }
   Members with a number already in the list are skipped (idempotent re-paste). A venue draw
   with no roster of its own draws from every member at the venue, so we add to (or create) one
   members list for the venue. */
async function handleMembersImport(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const members = Array.isArray(b.members) ? b.members : [];
  if (!members.length) return json({ error: 'No members to add' }, 400);

  let venueId, rosterId = null;
  const drawId = b.draw_id != null ? String(b.draw_id).trim() : '';
  if (drawId) {
    assertUuid(drawId, 'draw_id');
    const dr = await sbGet(env, 'vp_member_draws', 'id=eq.' + enc(drawId) + '&select=venue_id,roster_id');
    if (!dr.length) return json({ error: 'Draw not found' }, 404);
    venueId = dr[0].venue_id; rosterId = dr[0].roster_id || null;
  } else {
    venueId = String(b.venue_id || '').trim();
    if (!venueId) return json({ error: 'Missing venue_id' }, 400);
    assertUuid(venueId, 'venue_id');
  }

  const staff = await requireStaff(env, authUserId, venueId);
  if (staff.role !== 'owner' && staff.role !== 'manager') {
    return json({ error: 'Only a manager or owner can add to the members list' }, 403);
  }

  // Find (or create) one members list for the venue.
  if (!rosterId) {
    const rosters = await sbGet(env, 'vp_member_rosters', 'venue_id=eq.' + enc(venueId) + '&select=id&limit=1');
    if (rosters.length) rosterId = rosters[0].id;
    else {
      const made = await sbInsert(env, 'vp_member_rosters', { venue_id: venueId, name: 'Members list' }, true);
      rosterId = Array.isArray(made) ? made[0].id : made.id;
    }
  }

  // Skip numbers already present; insert the rest as valid (pickable) members.
  const existing = await sbGet(env, 'vp_members', 'roster_id=eq.' + enc(rosterId) + '&select=member_number');
  const have = {}; existing.forEach((m) => { have[String(m.member_number)] = true; });
  const rows = [];
  members.forEach((m) => {
    const num = parseInt(m.number, 10);
    if (isNaN(num) || have[String(num)]) return;
    have[String(num)] = true;
    // vp_members stores first_name/last_name; split the pasted name on the first space.
    const nm = String(m.name || '').trim();
    const sp = nm.indexOf(' ');
    const first = (sp === -1 ? nm : nm.slice(0, sp)).slice(0, 80);
    const last = (sp === -1 ? '' : nm.slice(sp + 1).trim()).slice(0, 80);
    rows.push({ roster_id: rosterId, member_number: num, first_name: first, last_name: last, status: 'valid' });
  });
  if (rows.length) await sbInsert(env, 'vp_members', rows, false);
  return json({ ok: true, added: rows.length, roster_id: rosterId });
}

/* POST /host/raffle/prize-add  (MANAGER/OWNER) : add a reusable prize to the venue's list.
   body: { venue_id, label }  -> { prize } */
async function handleRafflePrizeAdd(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const venueId = String(b.venue_id || '').trim();
  if (!venueId) return json({ error: 'Missing venue_id' }, 400);
  assertUuid(venueId, 'venue_id');
  const label = String(b.label || '').trim().slice(0, 120);
  if (!label) return json({ error: 'Enter a prize' }, 400);
  const staff = await requireStaff(env, authUserId, venueId);
  if (staff.role !== 'owner' && staff.role !== 'manager') {
    return json({ error: 'Only a manager or owner can change the prize list' }, 403);
  }
  const made = await sbInsert(env, 'vp_raffle_prizes', { venue_id: venueId, label: label }, true);
  return json({ ok: true, prize: Array.isArray(made) ? made[0] : made });
}

/* POST /host/raffle/prize-remove  (MANAGER/OWNER) : remove a prize from the venue's list.
   body: { prize_id }  -> { ok } */
async function handleRafflePrizeRemove(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const prizeId = String(b.prize_id || '').trim();
  if (!prizeId) return json({ error: 'Missing prize_id' }, 400);
  assertUuid(prizeId, 'prize_id');
  const rows = await sbGet(env, 'vp_raffle_prizes', 'id=eq.' + enc(prizeId) + '&select=id,venue_id');
  if (!rows.length) return json({ error: 'Prize not found' }, 404);
  const staff = await requireStaff(env, authUserId, rows[0].venue_id);
  if (staff.role !== 'owner' && staff.role !== 'manager') {
    return json({ error: 'Only a manager or owner can change the prize list' }, 403);
  }
  await sbDelete(env, 'vp_raffle_prizes', 'id=eq.' + enc(prizeId));
  return json({ ok: true });
}

/* ---- MEMBERS DRAW helpers ---- */

// The valid (drawable) members for a draw. If the draw names a roster, use it; otherwise use
// every roster at the venue. Only status 'valid' members are returned (the exclude list is
// encoded as status 'excluded' rows, which are never drawable).
async function validMembers(env, draw) {
  let rosterIds = [];
  if (draw.roster_id) rosterIds = [draw.roster_id];
  else {
    const rosters = await sbGet(env, 'vp_member_rosters', 'venue_id=eq.' + enc(draw.venue_id) + '&select=id');
    rosterIds = rosters.map((r) => r.id);
  }
  if (!rosterIds.length) return [];
  const inList = '(' + rosterIds.map((id) => enc(id)).join(',') + ')';
  return await sbGet(env, 'vp_members',
    'roster_id=in.' + inList + '&status=eq.valid&select=id,roster_id,member_number,first_name,last_name');
}

// Confirm a member belongs to this draw's roster (or, when the draw names no roster, to any
// roster at the draw's venue). Returns the member row or null.
async function memberInDraw(env, draw, memberId) {
  const rows = await sbGet(env, 'vp_members',
    'id=eq.' + enc(memberId) + '&select=id,roster_id,member_number,first_name,last_name');
  if (!rows.length) return null;
  const m = rows[0];
  if (draw.roster_id) return m.roster_id === draw.roster_id ? m : null;
  const rosters = await sbGet(env, 'vp_member_rosters',
    'id=eq.' + enc(m.roster_id) + '&venue_id=eq.' + enc(draw.venue_id) + '&select=id');
  return rosters.length ? m : null;
}

// The venue's name_display preference (how a winner's name shows on the TV). Default 'abbrev_last'.
async function venueNameDisplay(env, venueId) {
  const s = await sbGet(env, 'vp_venue_settings', 'venue_id=eq.' + enc(venueId) + '&select=name_display&limit=1');
  return (s.length && s[0].name_display) ? s[0].name_display : 'abbrev_last';
}

// Format a member's name per the venue's name_display setting.
//   abbrev_last  (default) -> "John S"
//   abbrev_first          -> "J Smith"
//   full                  -> "John Smith"
function formatMemberName(first, last, mode) {
  let f = (first || '').trim();
  let l = (last || '').trim();
  // Robustness: if a member was imported as a single field ("John Smith" all in first_name,
  // last_name empty), split the last word off so the abbreviation options still work. Without
  // this, "first initial + last name" shows only "J" and "first name + last initial" shows the
  // whole name.
  if (!l && f.indexOf(' ') !== -1) {
    const parts = f.split(/\s+/);
    l = parts.pop();
    f = parts.join(' ');
  }
  if (mode === 'full') return (f + ' ' + l).trim();
  if (mode === 'abbrev_first') return ((f ? f[0] + ' ' : '') + l).trim();
  return (f + ' ' + (l ? l[0] : '')).trim();
}

/* ------------------------------ POST /host/play ------------------------------
 * The musical-bingo equivalent of /host/ball: the host plays (reveals) the next song.
 * The Worker records it in vp_music_plays (played_at, which is what counts toward claim
 * checks) and broadcasts 'music.song_played' with the title + artist so every card can
 * daub the matching square and the TV shows what is playing. The song title is PUBLIC by
 * design (players daub it by ear), unlike a trivia correct_index. AUDIO STAYS ON THE HOST:
 * this endpoint only tracks which song was played; the ~30s preview clip plays through the
 * host device into the PA and is never touched here.
 */
// POST /host/game/pattern {game_id, pattern, prize?} - advance the pattern (and new prize) on a RUNNING
// musical game so players can "carry on" to the next prize (one line -> two lines -> full house) on the
// SAME cards. Claims are verified against vp_music_games.pattern, so this must update it server-side.
async function handleMusicPattern(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');
  const patternMap = {
    one: 'one_line', two: 'two_lines', corners: 'four_corners', full: 'full_house',
    one_line: 'one_line', two_lines: 'two_lines', four_corners: 'four_corners', full_house: 'full_house',
  };
  const pattern = patternMap[String(b.pattern || '')];
  if (!pattern) return json({ error: 'Invalid pattern' }, 400);

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format,config');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'musical_bingo') return json({ error: 'Not a musical game' }, 400);
  if (game.status !== 'running') return json({ error: 'This game is not running' }, 409);
  const session = await getSession(env, game.session_id);
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  await requireStaff(env, authUserId, session.venue_id);           // ENFORCED: staff at the game's venue

  const mg = await sbGet(env, 'vp_music_games', 'game_id=eq.' + enc(gameId) + '&select=game_id');
  if (!mg.length) return json({ error: 'Not a musical game' }, 404);

  await sbPatch(env, 'vp_music_games', 'game_id=eq.' + enc(gameId), { pattern });
  const config = Object.assign({}, game.config || {});
  if (typeof b.prize === 'string' && b.prize.trim()) config.prize = b.prize.trim().slice(0, 120);
  await sbPatch(env, 'vp_games', 'id=eq.' + enc(gameId), { config });

  return json({ ok: true, game_id: gameId, pattern, prize: config.prize || null });
}

/* ---- Trivia night builder: venue-owned question sets (create, fill from the library, write your own) ----
 * All host-authed. A venue can only touch its OWN sets (owner_venue_id === venue); library sets are read-only. */
async function triviaSetForVenue(env, setId, authUserId) {
  setId = String(setId || '').trim();
  assertUuid(setId, 'set_id');
  const sets = await sbGet(env, 'vp_question_sets', 'id=eq.' + enc(setId) + '&select=id,owner_venue_id,visibility,title,question_count');
  if (!sets.length) throw httpError(404, 'Set not found');
  const set = sets[0];
  if (!set.owner_venue_id) throw httpError(403, 'That is a library set and cannot be edited');
  await requireStaff(env, authUserId, set.owner_venue_id);        // ENFORCED: staff at the set's venue
  return set;
}
async function nextTriviaSeq(env, setId) {
  const rows = await sbGet(env, 'vp_questions', 'set_id=eq.' + enc(setId) + '&select=seq&order=seq.desc&limit=1');
  return rows.length ? (rows[0].seq || 0) + 1 : 1;
}
async function retagSetCount(env, setId) {
  const rows = await sbGet(env, 'vp_questions', 'set_id=eq.' + enc(setId) + '&select=seq');
  await sbPatch(env, 'vp_question_sets', 'id=eq.' + enc(setId), { question_count: rows.length });
}
async function handleTriviaSet(request, env, json) {              // create a new set, or rename an existing one
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const title = (String(b.title || '').trim().slice(0, 80)) || 'My trivia night';
  if (b.set_id) {
    const set = await triviaSetForVenue(env, b.set_id, authUserId);
    await sbPatch(env, 'vp_question_sets', 'id=eq.' + enc(set.id), { title });
    return json({ ok: true, set_id: set.id, title });
  }
  const venueId = String(b.venue_id || '').trim();
  if (!venueId) return json({ error: 'Missing venue_id' }, 400);
  assertUuid(venueId, 'venue_id');
  await requireStaff(env, authUserId, venueId);
  const rows = await sbInsert(env, 'vp_question_sets',
    // visibility MUST be one of the DB CHECK values ('private','library'); a venue's own night is
    // 'private'. Using 'venue' here violated the constraint and made "create a night" fail with a DB
    // error. Venue ownership is tracked by owner_venue_id, never by a 'venue' visibility value.
    { owner_venue_id: venueId, visibility: 'private', title, status: 'active', question_count: 0 }, true);
  return json({ ok: true, set_id: rows[0].id, title });
}
async function handleTriviaSetDelete(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const set = await triviaSetForVenue(env, b.set_id, authUserId);
  await sbDelete(env, 'vp_questions', 'set_id=eq.' + enc(set.id));
  await sbDelete(env, 'vp_question_sets', 'id=eq.' + enc(set.id));
  return json({ ok: true });
}
async function handleTriviaSetQuestions(request, env, json) {     // list a venue set's questions for editing
  const authUserId = await verifyHostJwt(request, env);
  const setId = new URL(request.url).searchParams.get('set') || '';
  await triviaSetForVenue(env, setId, authUserId);
  const rows = await sbGet(env, 'vp_questions',
    'set_id=eq.' + enc(String(setId).trim()) + '&select=id,seq,question,options,correct_index,category,difficulty,image_url&order=seq.asc');
  return json({ questions: rows });
}
function sanitizeQuestion(q) {                                    // -> a valid row shape or null
  const options = Array.isArray(q.options) ? q.options.map((o) => String(o || '').slice(0, 200)) : [];
  const ci = parseInt(q.correct_index, 10);
  const question = String(q.question || '').trim();
  if (!question || options.length !== 4 || !options.every((o) => o.trim()) || !(ci >= 0 && ci < 4)) return null;
  return {
    question: question.slice(0, 500), options, correct_index: ci,
    category: q.category ? String(q.category).slice(0, 60) : null,
    difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
    image_url: q.image_url ? String(q.image_url).slice(0, 600) : null,
  };
}
async function handleTriviaAdd(request, env, json) {              // write your own questions (bulk)
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const set = await triviaSetForVenue(env, b.set_id, authUserId);
  const items = (Array.isArray(b.questions) ? b.questions : []).map(sanitizeQuestion).filter(Boolean);
  if (!items.length) return json({ error: 'No valid questions (each needs 4 answers and a correct one)' }, 400);
  let seq = await nextTriviaSeq(env, set.id);
  const rows = items.map((q) => Object.assign({ set_id: set.id, seq: seq++ }, q));
  await sbInsert(env, 'vp_questions', rows);
  await retagSetCount(env, set.id);
  // Also queue these host-written questions for review so the weekly run can fact-check +
  // improve them and promote the good ones into the shared library. Best-effort (never blocks
  // the host adding their question, and no-ops if the submissions table is not migrated yet).
  try {
    const subs = rows.map((r) => ({
      venue_id: set.owner_venue_id || null, question: r.question, options: r.options,
      correct_index: r.correct_index, category: r.category || null,
      difficulty: r.difficulty || null, image_url: r.image_url || null, status: 'pending',
    }));
    if (subs.length) await sbInsert(env, 'vp_question_submissions', subs, false);
  } catch (e) { /* non-fatal: the review queue is best-effort */ }
  return json({ ok: true, added: rows.length });
}

// --- Review queue admin (used by the weekly fact-check run). Gated by env.ADMIN_KEY. ---
async function handleAdminSubmissions(request, env, json) {
  const b = await readJson(request);
  if (!env.ADMIN_KEY || b.key !== env.ADMIN_KEY) return json({ error: 'Not authorised' }, 401);
  const limit = Math.max(1, Math.min(200, parseInt(b.limit, 10) || 50));
  const rows = await sbGet(env, 'vp_question_submissions',
    'status=eq.pending&select=id,venue_id,question,options,correct_index,category,difficulty,image_url&order=created_at.asc&limit=' + limit);
  return json({ ok: true, pending: rows });
}

async function handleAdminResolve(request, env, json) {
  const b = await readJson(request);
  if (!env.ADMIN_KEY || b.key !== env.ADMIN_KEY) return json({ error: 'Not authorised' }, 401);
  const id = String(b.id || '').trim();
  if (!id) return json({ error: 'Missing id' }, 400);
  const status = ['approved', 'rejected', 'review'].includes(b.status) ? b.status : 'review';
  // On approve, copy the (weekly-run-improved) question into the named library theme set.
  if (status === 'approved' && b.question && Array.isArray(b.options) && b.options.length === 4 && b.correct_index >= 0 && b.correct_index <= 3) {
    const theme = String(b.theme || 'General Knowledge').trim();
    const libSets = await sbGet(env, 'vp_question_sets', 'visibility=eq.library&title=eq.' + enc(theme) + '&select=id&limit=1');
    if (libSets.length) {
      const seq = await nextTriviaSeq(env, libSets[0].id);
      await sbInsert(env, 'vp_questions', [{
        set_id: libSets[0].id, seq, question: String(b.question), options: b.options, correct_index: b.correct_index,
        category: b.category || theme, difficulty: ['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : 'medium',
        image_url: b.image_url || null,
      }], false);
      await retagSetCount(env, libSets[0].id);
    }
  }
  await sbPatch(env, 'vp_question_submissions', 'id=eq.' + enc(id),
    { status, review_note: (String(b.review_note || '').slice(0, 500)) || null, reviewed_at: new Date().toISOString() });
  return json({ ok: true, id, status });
}
async function handleTriviaFromLibrary(request, env, json) {     // copy N library questions into the set
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const set = await triviaSetForVenue(env, b.set_id, authUserId);
  const count = Math.max(1, Math.min(100, parseInt(b.count, 10) || 20));
  // library sets are one-per-category, titled by category
  let setQ = 'visibility=eq.library&select=id';
  if (b.category) setQ += '&title=eq.' + enc(String(b.category));
  const libSets = await sbGet(env, 'vp_question_sets', setQ);
  if (!libSets.length) return json({ error: 'No matching library category' }, 404);
  const inList = '(' + libSets.map((s) => enc(s.id)).join(',') + ')';
  let q = 'set_id=in.' + inList + '&select=question,options,correct_index,category,difficulty,image_url';
  if (['easy', 'medium', 'hard'].includes(b.difficulty)) q += '&difficulty=eq.' + enc(b.difficulty);
  q += '&limit=' + (count * 5);   // over-fetch, then shuffle + take count (PostgREST has no cheap random order)
  const pool = await sbGet(env, 'vp_questions', q);
  if (!pool.length) return json({ error: 'No library questions match that filter' }, 404);
  for (let i = pool.length - 1; i > 0; i--) { const j = randInt(i + 1); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  let seq = await nextTriviaSeq(env, set.id);
  const rows = pool.slice(0, count).map((p) => ({
    set_id: set.id, seq: seq++, question: p.question, options: p.options, correct_index: p.correct_index,
    category: p.category, difficulty: p.difficulty, image_url: p.image_url,
  }));
  await sbInsert(env, 'vp_questions', rows);
  await retagSetCount(env, set.id);
  return json({ ok: true, added: rows.length });
}

// Search the WHOLE library by keyword (question text or tag) and copy N matches into the venue's
// set - this is what powers a themed night on any topic (e.g. "Neighbours", "the 90s").
async function handleTriviaSearch(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const set = await triviaSetForVenue(env, b.set_id, authUserId);
  const query = String(b.query || '').replace(/[(),]/g, ' ').trim().slice(0, 60);
  if (query.length < 2) return json({ error: 'Type at least 2 characters to search' }, 400);
  const count = Math.max(1, Math.min(100, parseInt(b.count, 10) || 20));
  const libSets = await sbGet(env, 'vp_question_sets', 'visibility=eq.library&select=id');
  if (!libSets.length) return json({ error: 'The question library is empty' }, 404);
  const inList = '(' + libSets.map((s) => enc(s.id)).join(',') + ')';
  const like = enc('*' + query + '*');
  let q = 'set_id=in.' + inList
        + '&parked_at=is.null'   // a parked question must not come back through the library search either
        + '&or=(question.ilike.' + like + ',category.ilike.' + like + ')'
        + '&select=question,options,correct_index,category,difficulty,image_url';
  if (['easy', 'medium', 'hard'].includes(b.difficulty)) q += '&difficulty=eq.' + enc(b.difficulty);
  q += '&limit=' + (count * 6);
  const pool = await sbGet(env, 'vp_questions', q);
  if (!pool.length) return json({ ok: true, added: 0, matched: 0 });
  for (let i = pool.length - 1; i > 0; i--) { const j = randInt(i + 1); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  let seq = await nextTriviaSeq(env, set.id);
  const rows = pool.slice(0, count).map((p) => ({
    set_id: set.id, seq: seq++, question: p.question, options: p.options, correct_index: p.correct_index,
    category: p.category, difficulty: p.difficulty, image_url: p.image_url,
  }));
  await sbInsert(env, 'vp_questions', rows);
  await retagSetCount(env, set.id);
  return json({ ok: true, added: rows.length, matched: pool.length });
}
/* POST /host/song/flag  {game_id, song_id, reason?, note?}
   The host taps "this song did not work" during a night. One flag never removes anything: a
   single room can dislike a song for a hundred reasons that are not the song. It is one vote per
   VENUE, keyed on artist+title rather than a row id, because songs are copied into each game's
   playlist with fresh ids and flagging the copy would leave the library original going out to
   everybody. Three separate venues is the signal, and tools/review-songs.py acts on it. */
async function handleSongFlag(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  const songId = String(b.song_id || '').trim();
  assertUuid(gameId, 'game_id');
  assertUuid(songId, 'song_id');

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const session = await getSession(env, games[0].session_id);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at this venue

  const mg = await sbGet(env, 'vp_music_games', 'game_id=eq.' + enc(gameId) + '&select=playlist_id');
  if (!mg.length) return json({ error: 'That is not a musical bingo game' }, 409);
  const rows = await sbGet(env, 'vp_playlist_songs',
    'id=eq.' + enc(songId) + '&playlist_id=eq.' + enc(mg[0].playlist_id) + '&select=id,title,artist&limit=1');
  if (!rows.length) return json({ error: 'That song is not in this game' }, 404);
  const song = rows[0];

  const skey = ((song.artist || '') + '|' + (song.title || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  const allowed = { didnt_work: 1, wrong_track: 1, unknown_song: 1 };
  const reason = allowed[String(b.reason || '')] ? String(b.reason) : 'didnt_work';

  // One vote per venue: upsert on the primary key so a host tapping twice does not stack votes.
  await sbUpsert(env, 'vp_song_flags', {
    skey: skey, venue_id: session.venue_id, reason: reason,
    title: song.title, artist: song.artist,
    note: b.note ? String(b.note).slice(0, 300) : null,
  }, 'skey,venue_id');

  const counts = await sbGet(env, 'v_vp_song_flag_counts', 'skey=eq.' + enc(skey) + '&select=venues');
  const venues = (counts && counts[0] && Number(counts[0].venues)) || 1;
  await emitEvent(env, session, 'song.flagged',
    { song_id: songId, title: song.title, venues: venues }, actorRef(staff));
  return json({ ok: true, title: song.title, artist: song.artist, venues: venues, retires_at: 3 });
}

async function handleTriviaRemove(request, env, json) {           // remove one question, then re-sequence 1..N
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const qid = String(b.question_id || '').trim();
  assertUuid(qid, 'question_id');
  const qrows = await sbGet(env, 'vp_questions', 'id=eq.' + enc(qid) + '&select=id,set_id');
  if (!qrows.length) return json({ error: 'Question not found' }, 404);
  const set = await triviaSetForVenue(env, qrows[0].set_id, authUserId);
  await sbDelete(env, 'vp_questions', 'id=eq.' + enc(qid));
  const rest = await sbGet(env, 'vp_questions', 'set_id=eq.' + enc(set.id) + '&select=id,seq&order=seq.asc');
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].seq !== i + 1) await sbPatch(env, 'vp_questions', 'id=eq.' + enc(rest[i].id), { seq: i + 1 });
  }
  await sbPatch(env, 'vp_question_sets', 'id=eq.' + enc(set.id), { question_count: rest.length });
  return json({ ok: true });
}

async function handleHostPlay(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');
  const songId = String(b.song_id || '').trim();
  if (!songId) return json({ error: 'Missing song_id' }, 400);
  assertUuid(songId, 'song_id');

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format,config');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'musical_bingo') return json({ error: 'Not a musical game' }, 400);
  if (game.status !== 'running') return json({ error: 'This game is not running' }, 409);
  const session = await getSession(env, game.session_id);
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the game's venue (also kill-switch)

  const mg = await sbGet(env, 'vp_music_games', 'game_id=eq.' + enc(gameId) + '&select=playlist_id');
  if (!mg.length) return json({ error: 'Not a musical game' }, 404);

  // The song must belong to THIS game's playlist (so a played song is always a real
  // vp_playlist_songs row the FK can point at, and never a song from another playlist).
  const songRows = await sbGet(env, 'vp_playlist_songs',
    'id=eq.' + enc(songId) + '&playlist_id=eq.' + enc(mg[0].playlist_id) + '&select=id,title,artist&limit=1');
  if (!songRows.length) return json({ error: 'That song is not in this game playlist' }, 404);
  const song = songRows[0];

  // Idempotent: if this song was already played in this game, return its position rather
  // than logging it twice or re-broadcasting (a host double-tap must not double-count).
  const existing = await sbGet(env, 'vp_music_plays',
    'game_id=eq.' + enc(gameId) + '&song_id=eq.' + enc(songId) + '&select=id,seq&order=seq.asc&limit=1');
  const totalPlayed = await sbGet(env, 'vp_music_plays', 'game_id=eq.' + enc(gameId) + '&select=seq&order=seq.desc&limit=1');
  if (existing.length) {
    const count = totalPlayed.length ? totalPlayed[0].seq : existing[0].seq;
    return json({ song_id: songId, title: song.title, artist: song.artist, seq: existing[0].seq, played_count: count, replayed: true });
  }

  const nextSeq = totalPlayed.length ? totalPlayed[0].seq + 1 : 1;
  const now = new Date().toISOString();
  await sbInsert(env, 'vp_music_plays', {
    game_id: gameId, song_id: songId, seq: nextSeq, played_at: now, revealed_at: now,
  }, false);

  await emitEvent(env, session, 'music.song_played', {
    song_id: songId, title: song.title, artist: song.artist, seq: nextSeq, played_count: nextSeq,
  }, actorRef(staff));

  return json({ song_id: songId, title: song.title, artist: song.artist, seq: nextSeq, played_count: nextSeq });
}

/* ------------------------------ POST /host/question ------------------------------
 * Host advances the trivia game to the next question. The Worker reads the question
 * (including correct_index) server-side, sets the shared answer deadline, and emits a
 * PUBLIC 'trivia.question' event carrying the text + OPTIONS but NEVER the correct_index.
 * correct_index is returned ONLY in this response, which reaches the authenticated host
 * console alone (host staff legitimately hold the answers). Scoring stays server-side.
 */
async function handleHostQuestion(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');

  // Two independent reads (both keyed by the game) run in parallel to cut per-question latency.
  const [games, tg] = await Promise.all([
    sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format,config'),
    sbGet(env, 'vp_trivia_games', 'game_id=eq.' + enc(gameId) + '&select=question_set_id,current_seq,phase'),
  ]);
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'trivia') return json({ error: 'Not a trivia game' }, 400);
  if (game.status !== 'running') return json({ error: 'This game is not running' }, 409);
  if (!tg.length) return json({ error: 'Not a trivia game' }, 404);
  const setId = tg[0].question_set_id;
  const curSeq = tg[0].current_seq || 0;
  const cfg = game.config || {};
  const seqList = Array.isArray(cfg.question_seqs) ? cfg.question_seqs : null;

  // Pick the next question IN PARALLEL with the session read. Which question is served does not
  // depend on who is calling, so overlapping the two reads is safe; auth still gates the response
  // (nothing is broadcast or returned until requireStaff passes, below).
  const pickNext = async () => {
    if (seqList) {
      // Randomised game: config.question_seqs is this round's order (a shuffle, no repeats vs
      // earlier rounds tonight). current_seq stores the SEQ of the last question served so
      // /host/reveal still finds it; we advance by POSITION in the list.
      const nextIdx = seqList.indexOf(curSeq) + 1;   // curSeq=0 at start -> indexOf=-1 -> idx 0
      if (nextIdx >= seqList.length) return { done: true };
      const rows = await sbGet(env, 'vp_questions',
        'set_id=eq.' + enc(setId) + '&seq=eq.' + seqList[nextIdx] +
        '&select=id,seq,question,options,correct_index,time_limit_s,points,image_url&limit=1');
      if (!rows.length) return { done: true };
      return { q: rows[0], qi: nextIdx + 1, qtotal: seqList.length };
    }
    // Legacy game started before the randomiser: serve seq 1..N in order.
    const roundLimit = (typeof cfg.question_count === 'number') ? cfg.question_count : null;
    if (roundLimit != null && curSeq >= roundLimit) return { done: true };
    const nextQs = await sbGet(env, 'vp_questions',
      'set_id=eq.' + enc(setId) + '&seq=gt.' + curSeq +
      '&select=id,seq,question,options,correct_index,time_limit_s,points,image_url&order=seq.asc&limit=1');
    if (!nextQs.length) return { done: true };
    return { q: nextQs[0], qi: nextQs[0].seq, qtotal: (cfg.question_count != null) ? cfg.question_count : null };
  };

  const [session, sel] = await Promise.all([ getSession(env, game.session_id), pickNext() ]);
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the game's venue (also kill-switch)
  if (sel.done) return json({ done: true });
  const q = sel.q, qi = sel.qi, qtotal = sel.qtotal;

  const secs = (cfg.time_limit_s != null) ? cfg.time_limit_s : (q.time_limit_s || 20);
  const endsAt = new Date(Date.now() + secs * 1000).toISOString();
  const options = Array.isArray(q.options) ? q.options : [];

  /* COMPARE AND SET on the question we believed we were leaving.

     This patch was filtered on game_id alone, and the phase read at the top of the handler was
     never used. G.busy on the console was the only guard, and it is per tab. So two hosts on one
     game, or a client retry after a response was lost, silently advanced PAST a question: its
     answers could never be scored, because /host/reveal only ever reads current_seq. Players who
     had already answered got a 409 from the stale-qseq check, which the phone swallows, so they
     sat on "Answer in! Good luck" for a question that scored them nothing.

     Filtering on the prior current_seq means the second caller changes no rows and is told so,
     instead of quietly skipping a question in front of the room. */
  const advanced = await sbPatchReturning(env, 'vp_trivia_games',
    'game_id=eq.' + enc(gameId) + '&current_seq=eq.' + curSeq,
    { current_seq: q.seq, phase: 'asking', question_ends_at: endsAt });
  if (!advanced || !advanced.length) {
    return json({ error: 'That question has already moved on. Check the screen before tapping again.' }, 409);
  }

  // PUBLIC broadcast: options only, NEVER correct_index.
  await emitEvent(env, session, 'trivia.question', {
    qseq: q.seq, qi, qtotal,
    text: q.question, options, ends_at: endsAt, secs,
    image_url: q.image_url || null,   // picture rounds: the phones + TV show the image with the question
    colour: cfg.colour !== false,
  }, actorRef(staff));

  /* Read one further ahead, HOST ONLY, so the console can show what is coming.
     A host reads the question aloud, and until now they first saw it at the same instant the room
     did, so every question began with a pause while they read it to themselves. With the next one
     in front of them they can start reading and tap Next as they finish, which also makes the
     round trip on Next stop mattering. Never broadcast: this is the console's copy. */
  let nextPreview = null;
  try {
    if (seqList) {
      const afterIdx = seqList.indexOf(q.seq) + 1;
      if (afterIdx > 0 && afterIdx < seqList.length) {
        const rows = await sbGet(env, 'vp_questions',
          'set_id=eq.' + enc(setId) + '&seq=eq.' + seqList[afterIdx] +
          '&select=seq,question,options,correct_index,image_url&limit=1');
        if (rows.length) nextPreview = rows[0];
      }
    } else {
      const roundLimit = (typeof cfg.question_count === 'number') ? cfg.question_count : null;
      if (roundLimit == null || q.seq < roundLimit) {
        const rows = await sbGet(env, 'vp_questions',
          'set_id=eq.' + enc(setId) + '&seq=gt.' + q.seq +
          '&select=seq,question,options,correct_index,image_url&order=seq.asc&limit=1');
        if (rows.length) nextPreview = rows[0];
      }
    }
  } catch (e) { nextPreview = null; }   // a preview is a convenience; never fail the question on it

  // HOST-ONLY response (authenticated staff): may include correct_index for the console.
  return json({
    qseq: q.seq, qi, qtotal,
    text: q.question, options, correct_index: q.correct_index,
    ends_at: endsAt, secs, image_url: q.image_url || null,
    next_preview: nextPreview ? {
      qseq: nextPreview.seq, text: nextPreview.question,
      options: Array.isArray(nextPreview.options) ? nextPreview.options : [],
      correct_index: nextPreview.correct_index,
      image_url: nextPreview.image_url || null,
    } : null,
  });
}

/* ------------------------------ POST /host/reveal ------------------------------
 * Host reveals the answer to the current question. The Worker is the ONLY place that
 * decides correctness and points: it reads correct_index server-side, stamps is_correct
 * and points_awarded onto every answer for this question, flips the phase to 'revealed',
 * and only THEN emits the correct_index + updated leaderboard on the PUBLIC channel.
 */
async function handleHostReveal(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format,config');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'trivia') return json({ error: 'Not a trivia game' }, 400);
  const session = await getSession(env, game.session_id);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the game's venue (also kill-switch)
  if (game.status !== 'running') return json({ error: 'This game is not running' }, 409);
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);

  const tg = await sbGet(env, 'vp_trivia_games',
    'game_id=eq.' + enc(gameId) + '&select=question_set_id,current_seq,phase,question_ends_at');
  if (!tg.length) return json({ error: 'Not a trivia game' }, 404);
  const t = tg[0];
  if (!t.current_seq) return json({ error: 'No question to reveal' }, 409);
  const already = t.phase === 'revealed';   // idempotent: do not re-stamp or double-broadcast

  const qrows = await sbGet(env, 'vp_questions',
    'set_id=eq.' + enc(t.question_set_id) + '&seq=eq.' + t.current_seq +
    '&select=id,options,correct_index,points,time_limit_s&limit=1');
  if (!qrows.length) return json({ error: 'Question not found' }, 404);
  const q = qrows[0];
  const cfg = game.config || {};
  const base = (cfg.base_points != null) ? cfg.base_points : (q.points || 100);
  const secs = (cfg.time_limit_s != null) ? cfg.time_limit_s : (q.time_limit_s || 20);
  const speedBonus = cfg.speed_bonus !== false;
  const options = Array.isArray(q.options) ? q.options : [];
  const endsAtMs = t.question_ends_at ? Date.parse(t.question_ends_at) : 0;

  const answers = await sbGet(env, 'vp_trivia_answers',
    'game_id=eq.' + enc(gameId) + '&question_id=eq.' + enc(q.id) +
    '&select=id,player_id,answer_index,answered_at,is_correct,points_awarded');

  // Answer distribution for the TV/host, plus per-answer scoring (server-authoritative).
  const split = new Array(options.length).fill(0);
  const scored = [];
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (a.answer_index >= 0 && a.answer_index < split.length) split[a.answer_index]++;
    if (already) continue;
    const correct = a.answer_index === q.correct_index;
    let pts = 0;
    if (correct) {
      let bonus = 0;
      if (speedBonus && endsAtMs && a.answered_at && secs > 0) {
        // Faster answers keep more of the +50% bonus: remaining/secs of base*0.5.
        const remaining = Math.max(0, Math.min(secs, (endsAtMs - Date.parse(a.answered_at)) / 1000));
        bonus = Math.round(base * 0.5 * (remaining / secs));
      }
      pts = base + bonus;
    }
    // Collected, not written one at a time. See the batch below.
    scored.push({ id: a.id, is_correct: correct, points_awarded: pts });
  }

  /* GROUPED, not one write per player. This was a sequential PATCH per answer, and a Worker gets
     a limited number of subrequests per request: past roughly forty answers the reveal threw
     mid-loop and escaped as a 500. Because the phase was only marked revealed AFTER the loop, the
     retry re-ran it and failed identically, so the question could never be revealed, some answers
     were scored and some were not, and nothing can score a question once the round has moved on.
     Answers that share a result share a write. Every wrong answer is one request (usually most of
     the room), and correct answers group by their points, so a full room collapses from hundreds
     of round trips to a handful. Grouping rather than upserting on purpose: an upsert has to
     satisfy every NOT NULL column on the insert path, and the base schema for this table is not
     in the repo to check against. */
  if (!already && scored.length) {
    const buckets = new Map();
    for (const r of scored) {
      const key = r.is_correct + ':' + r.points_awarded;
      if (!buckets.has(key)) buckets.set(key, { is_correct: r.is_correct, points_awarded: r.points_awarded, ids: [] });
      buckets.get(key).ids.push(r.id);
    }
    for (const b of buckets.values()) {
      await sbPatch(env, 'vp_trivia_answers',
        'id=in.(' + b.ids.map(enc).join(',') + ')',
        { is_correct: b.is_correct, points_awarded: b.points_awarded });
    }
  }

  if (!already) await sbPatch(env, 'vp_trivia_games', 'game_id=eq.' + enc(gameId), { phase: 'revealed' });

  // Running totals from the leaderboard view (sums points_awarded per player).
  const board = await sbGet(env, 'v_vp_trivia_leaderboard',
    'game_id=eq.' + enc(gameId) + '&select=player_id,display_name,points&order=points.desc&limit=50');
  const leaderboard = board.map((r) => ({ name: r.display_name || 'Player', points: r.points || 0 }));

  // PUBLIC broadcast: NOW it is safe to send correct_index, the reveal has happened.
  await emitEvent(env, session, 'trivia.reveal', {
    qseq: t.current_seq, correct_index: q.correct_index, options, split, leaderboard,
  }, actorRef(staff));

  return json({ qseq: t.current_seq, correct_index: q.correct_index, split, leaderboard });
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
  }, actorRef(staff));

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

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format');
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

  // Server-authoritative verdict. The phone is NEVER trusted: the Worker loads its own
  // copy of the card and its own record of what has been played, and computes the pattern
  // itself. BINGO checks drawn numbers on a 3x9 ticket; MUSICAL checks played songs on a
  // 5x5 card (FREE centre). Daubs and anything client-side are irrelevant either way.
  let result;
  let claimEvent = 'bingo.claim_submitted';
  if (game.format === 'musical_bingo') {
    const mg = await sbGet(env, 'vp_music_games', 'game_id=eq.' + enc(gameId) + '&select=pattern');
    if (!mg.length) return json({ error: 'Not a musical game' }, 404);
    // Only songs actually played (played_at set) count toward the claim.
    const plays = await sbGet(env, 'vp_music_plays', 'game_id=eq.' + enc(gameId) + '&played_at=not.is.null&select=song_id');
    const playedSet = new Set(plays.map((p) => p.song_id));
    result = checkMusicPattern(mg[0].pattern, card.cells, playedSet);
    claimEvent = 'music.claim_submitted';
  } else {
    const bg = await sbGet(env, 'vp_bingo_games', 'game_id=eq.' + enc(gameId) + '&select=draw_order,draw_index,pattern');
    if (!bg.length) return json({ error: 'Not a bingo game' }, 404);
    const order = bg[0].draw_order || [];
    const drawnSet = new Set(order.slice(0, bg[0].draw_index || 0));   // only numbers actually drawn
    result = checkPattern(bg[0].pattern, card.cells, drawnSet);        // no free centre in 90-ball
  }
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

  await emitEvent(env, session, claimEvent, {
    claim_id: claim.id, display_name: player.display_name || null, card_no: card.card_no,
    // A bingo/musical card is not secret, so the public claim event carries the card
    // and the matched cells. That lets the TV/host render the claimant's card for
    // the suspense/confirm view straight off the broadcast, with no extra read.
    cells: card.cells,
    winning_cells: result.valid ? result.cells : null,
  }, 'player:' + player.id);

  return json({ claim_id: claim.id, auto_verdict: verdict, winning_cells: result.valid ? result.cells : null, card_no: card.card_no });
}

/* ------------------------------ POST /player/answer ------------------------------
 * Player taps an option in trivia. The Worker resolves WHICH question is open from
 * vp_trivia_games server-side (the phone cannot answer a different or stale question),
 * rejects anything after the shared deadline, and stores the FIRST answer only. The
 * (game_id, question_id, player_id) unique index makes a second answer a no-op. No
 * correctness is ever returned here; scoring happens only at /host/reveal.
 */
async function handlePlayerAnswer(request, env, json) {
  const player = await verifyPlayerToken(request, env);           // ENFORCED: valid player token
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');
  const answerIndex = parseInt(b.answer_index, 10);
  if (!(answerIndex >= 0 && answerIndex <= 9)) return json({ error: 'Invalid answer_index' }, 400);

  // Anti-abuse rate limit (LIVE with env.RL, else allow-and-warn).
  const rl = await rateLimit(env, 'answer:player:' + player.id, ANSWER_MAX_PER_PLAYER, 60);
  if (!rl.ok) return json({ error: 'Too many answers right now, please wait a moment' }, 429);

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'trivia') return json({ error: 'Not a trivia game' }, 400);
  if (game.session_id !== player.session_id) return json({ error: 'Player is not in this game' }, 403);
  if (game.status !== 'running') return json({ error: 'This game is not running' }, 409);
  const session = await getSession(env, game.session_id);
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  await assertVenueActive(env, session.venue_id);   // kill-switch: an answer is a metered event

  const tg = await sbGet(env, 'vp_trivia_games',
    'game_id=eq.' + enc(gameId) + '&select=question_set_id,current_seq,phase,question_ends_at');
  if (!tg.length) return json({ error: 'Not a trivia game' }, 404);
  const t = tg[0];
  if (t.phase !== 'asking' || !t.current_seq) return json({ error: 'No question is open' }, 409);
  // Late answers are rejected by the SERVER clock and never stored.
  if (t.question_ends_at && Date.now() > Date.parse(t.question_ends_at)) return json({ error: 'Time is up for this question' }, 409);
  // Stale-question guard: the phone tags its answer with the qseq it saw.
  if (b.qseq != null && parseInt(b.qseq, 10) !== t.current_seq) return json({ error: 'That question has moved on' }, 409);

  const qrows = await sbGet(env, 'vp_questions',
    'set_id=eq.' + enc(t.question_set_id) + '&seq=eq.' + t.current_seq + '&select=id,options&limit=1');
  if (!qrows.length) return json({ error: 'Question not found' }, 404);
  const q = qrows[0];
  const optCount = Array.isArray(q.options) ? q.options.length : 0;
  if (!(answerIndex < optCount)) return json({ error: 'Invalid answer_index' }, 400);

  // First answer is final: rely on the unique index. A 409 means this player already
  // answered this question, which we report as recorded:false rather than an error.
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_trivia_answers', {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      game_id: gameId, question_id: q.id, player_id: player.id,
      answer_index: answerIndex, answered_at: new Date().toISOString(),
    }),
  });
  if (res.status === 409) return json({ ok: true, recorded: false, reason: 'already_answered' });
  if (!res.ok) throw dbError('insert', 'vp_trivia_answers', await res.text());
  return json({ ok: true, recorded: true });   // NO correctness: that is only known after reveal
}

/* ------------------------------ GET /player/score ------------------------------
 * A player pulls its OWN authoritative trivia result: running total, rank, and how the
 * last question went. The phone knows only its token (never its player_id or any answer
 * key), so this is how it learns its score after a reveal. Correctness is computed
 * server-side and only exists here once the host has revealed (is_correct is null before).
 */
async function handlePlayerScore(request, env, json) {
  const player = await verifyPlayerToken(request, env);           // ENFORCED: valid player token
  const url = new URL(request.url);
  const gameId = (url.searchParams.get('game') || '').trim();
  if (!gameId) return json({ error: 'Missing game' }, 400);
  assertUuid(gameId, 'game');

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,format');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'trivia') return json({ error: 'Not a trivia game' }, 400);
  if (game.session_id !== player.session_id) return json({ error: 'Player is not in this game' }, 403);

  // Whole leaderboard for this game, so we can derive both this player's total and rank.
  const board = await sbGet(env, 'v_vp_trivia_leaderboard',
    'game_id=eq.' + enc(gameId) + '&select=player_id,points&order=points.desc&limit=1000');
  let total = 0, rank = board.length ? board.length : 1, found = false;
  for (let i = 0; i < board.length; i++) {
    if (board[i].player_id === player.id) { total = board[i].points || 0; rank = i + 1; found = true; break; }
  }
  if (!found) { total = 0; rank = board.length + 1; }

  // The player's most recent stamped answer in this game. NOTE: this is not necessarily the
  // question just revealed. vp_trivia_answers is keyed by question_id, not qseq, and resolving a
  // qseq here would cost two extra queries per player per question. The phone knows whether IT
  // answered the current question, so it decides whether to trust this. See trivia/play.html.
  const last = await sbGet(env, 'vp_trivia_answers',
    'game_id=eq.' + enc(gameId) + '&player_id=eq.' + enc(player.id) +
    '&select=answer_index,is_correct,points_awarded,answered_at&order=answered_at.desc&limit=1');
  const lastRow = last.length
    ? { answered: true, answer_index: last[0].answer_index, is_correct: last[0].is_correct, points_awarded: last[0].points_awarded }
    : { answered: false, is_correct: null, points_awarded: null };

  return json({ total, rank, players_count: board.length, last: lastRow });
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

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(claim.game_id) + '&select=id,session_id,format');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const session = await getSession(env, games[0].session_id);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the claim's venue (also kill-switch)

  const status = decision === 'confirm' ? 'confirmed' : 'rejected';
  await sbPatch(env, 'vp_claims', 'id=eq.' + enc(claimId), {
    status, resolved_by: staff.id || null, resolved_at: new Date().toISOString(),
  });

  // WRITE THE RESULT. There is no separate bingo winners table: the confirmed
  // vp_claims row IS the durable winner record (who, which card, which cells,
  // resolved by whom, when). On a confirm we also finish the game, so the round
  // is closed in the DB and /snapshot stops treating it as running. A reject
  // leaves the game running so play continues.
  // b.continue === true means the host is carrying the game on to the next prize (musical bingo:
  // one line -> two lines -> full house on the SAME cards), so record the winner but keep the game
  // running. Otherwise a confirmed win finishes the game as usual.
  if (decision === 'confirm' && b.continue !== true) {
    await sbPatch(env, 'vp_games', 'id=eq.' + enc(claim.game_id) + '&status=eq.running',
      { status: 'finished', ended_at: new Date().toISOString() });
  }

  // Enrich the broadcast for the TV overlay.
  const players = await sbGet(env, 'vp_players', 'id=eq.' + enc(claim.player_id) + '&select=display_name');
  const cards = await sbGet(env, 'vp_cards', 'id=eq.' + enc(claim.card_id) + '&select=card_no');
  const payload = {
    claim_id: claimId, status,
    display_name: players.length ? players[0].display_name : null,
    card_no: cards.length ? cards[0].card_no : null,
  };
  if (status === 'confirmed' && claim.winning_cells) payload.winning_cells = claim.winning_cells;
  // The result event name matches the game format so each TV/host listens for its own.
  const resultEvent = games[0].format === 'musical_bingo' ? 'music.claim_result' : 'bingo.claim_result';
  await emitEvent(env, session, resultEvent, payload, actorRef(staff));

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

/* ------------------------------ GET /player/card ------------------------------
 * A joined player fetches THEIR ticket for the running game. The Worker deals
 * cards (never the phone), so this is how a phone learns its ticket. It also
 * covers the late-joiner case (design 5.1): a player who joined after the game
 * started has no card yet, so if none exists and a game is running we deal one
 * on the spot. Returns {game:null} when no bingo game is running (the phone then
 * shows the lobby/wait screen). Auth: valid player token only.
 */
async function handlePlayerCard(request, env, json) {
  const player = await verifyPlayerToken(request, env);           // ENFORCED: valid player token
  const url = new URL(request.url);

  // Resolve the game: an explicit ?game= (validated) or the latest running BINGO or
  // MUSICAL game in this player's session. Both formats deal a vp_cards row, so this one
  // endpoint serves both and branches on the format below.
  let gameId = (url.searchParams.get('game') || '').trim();
  let fmt = '';
  if (gameId) {
    assertUuid(gameId, 'game');
    const g = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format');
    if (!g.length) return json({ error: 'Game not found' }, 404);
    if (g[0].session_id !== player.session_id) return json({ error: 'Player is not in this game' }, 403);
    if (g[0].status !== 'running') return json({ game: null });
    fmt = g[0].format;
  } else {
    const games = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(player.session_id) + '&format=in.(bingo90,musical_bingo)&status=eq.running&select=id,format&order=seq.desc&limit=1');
    if (!games.length) return json({ game: null });   // nothing running yet; phone waits
    gameId = games[0].id;
    fmt = games[0].format;
  }

  const session = await getSession(env, player.session_id);
  await assertVenueActive(env, session.venue_id);   // kill-switch: a late-join deal is a metered write

  // MUSICAL: a 5x5 card of song titles. Deals on demand for late joiners, same as bingo.
  if (fmt === 'musical_bingo') return await playerMusicCard(env, json, gameId, player);

  const bg = await sbGet(env, 'vp_bingo_games', 'game_id=eq.' + enc(gameId) + '&select=pattern,draw_order,draw_index');
  if (!bg.length) return json({ error: 'Not a bingo game' }, 404);

  // Find this player's ticket, dealing one if they joined after the deal. The
  // retry loop copes with the two unique indexes on vp_cards: (game_id, player_id)
  // -- if a concurrent call already dealt us a card we re-read and use it -- and
  // (game_id, card_no) -- if another late joiner took the next number we retry.
  let card = null;
  for (let attempt = 0; attempt < 6 && !card; attempt++) {
    const mine = await sbGet(env, 'vp_cards',
      'game_id=eq.' + enc(gameId) + '&player_id=eq.' + enc(player.id) + '&select=id,card_no,cells');
    if (mine.length) { card = mine[0]; break; }

    const top = await sbGet(env, 'vp_cards', 'game_id=eq.' + enc(gameId) + '&select=card_no&order=card_no.desc&limit=1');
    const nextNo = top.length ? top[0].card_no + 1 : 1;
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_cards', {
      method: 'POST',
      headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({ game_id: gameId, player_id: player.id, card_no: nextNo, cells: generateTicket() }),
    });
    if (res.ok) { const d = await res.json(); card = Array.isArray(d) ? d[0] : d; break; }
    if (res.status === 409) continue;   // either index clashed; loop re-reads then retries
    throw dbError('insert', 'vp_cards', await res.text());
  }
  if (!card) return json({ error: 'Could not deal a card, please try again' }, 409);

  const order = bg[0].draw_order || [];
  const called = order.slice(0, bg[0].draw_index || 0);   // only numbers actually drawn; never the whole order
  return json({
    game_id: gameId,
    card_no: card.card_no,
    cells: card.cells,
    pattern: bg[0].pattern,
    called_numbers: called,
  });
}

/* ------------------------------ MUSICAL: a player's 5x5 card ------------------------------
 * Called from /player/card when the running game is musical bingo. Returns this player's
 * card of song titles, dealing one on demand for a late joiner (design 5.1), plus the
 * songs already played so a reloading phone can rebuild its daubs. Cells are stored as
 * { song_id, title } per square, with index 12 the FREE centre (0). The song_id lets the
 * claim check match the card against played songs; the title is what the phone renders.
 */
async function playerMusicCard(env, json, gameId, player) {
  const mg = await sbGet(env, 'vp_music_games', 'game_id=eq.' + enc(gameId) + '&select=playlist_id,pattern');
  if (!mg.length) return json({ error: 'Not a musical game' }, 404);
  const songs = await sbGet(env, 'vp_playlist_songs',
    'playlist_id=eq.' + enc(mg[0].playlist_id) + '&select=id,title,artist&order=seq.asc.nullslast,title.asc');
  if (!songs.length) return json({ error: 'This playlist has no songs' }, 409);

  // Reuse this player's card or deal one. The retry loop copes with the (game_id, card_no)
  // unique index if a concurrent late-join deal took the next number.
  let card = null;
  for (let attempt = 0; attempt < 6 && !card; attempt++) {
    const mine = await sbGet(env, 'vp_cards',
      'game_id=eq.' + enc(gameId) + '&player_id=eq.' + enc(player.id) + '&select=id,card_no,cells&order=card_no.asc&limit=1');
    if (mine.length) { card = mine[0]; break; }

    const top = await sbGet(env, 'vp_cards', 'game_id=eq.' + enc(gameId) + '&select=card_no&order=card_no.desc&limit=1');
    const nextNo = top.length ? top[0].card_no + 1 : 1;
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_cards', {
      method: 'POST',
      headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({ game_id: gameId, player_id: player.id, card_no: nextNo, cells: generateMusicCard(songs) }),
    });
    if (res.ok) { const d = await res.json(); card = Array.isArray(d) ? d[0] : d; break; }
    if (res.status === 409) continue;   // card_no clash under a concurrent late-join; re-read then retry
    throw dbError('insert', 'vp_cards', await res.text());
  }
  if (!card) return json({ error: 'Could not deal a card, please try again' }, 409);

  // Songs already played, titled from the playlist, so a reloading phone rebuilds daubs.
  const titleById = {};
  for (let i = 0; i < songs.length; i++) titleById[songs[i].id] = songs[i].title;
  const plays = await sbGet(env, 'vp_music_plays',
    'game_id=eq.' + enc(gameId) + '&played_at=not.is.null&select=song_id,seq&order=seq.asc');
  const played = plays.map((p) => ({ song_id: p.song_id, title: titleById[p.song_id] || '' }));

  return json({
    game_id: gameId, format: 'musical_bingo', card_no: card.card_no,
    cells: card.cells, pattern: mg[0].pattern, played_songs: played,
  });
}

/* ------------------------------ POST /host/game/end ------------------------------
 * Host ends the current round and returns the TV to the ad loop, without closing
 * the night. Marks the game finished (if still running) and broadcasts game.ended.
 * The session stays live so the next round reuses it. Auth: host JWT + venue staff.
 */
async function handleGameEnd(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');

  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status');
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const session = await getSession(env, games[0].session_id);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the game's venue (also kill-switch)

  if (games[0].status === 'running') {
    await sbPatch(env, 'vp_games', 'id=eq.' + enc(gameId), { status: 'finished', ended_at: new Date().toISOString() });
  }
  await emitEvent(env, session, 'game.ended', { game_id: gameId }, actorRef(staff));
  return json({ game_id: gameId, status: 'finished' });
}

/* ------------------------------ POST /session/close ------------------------------
 * Host closes the night. Finishes any running game, marks the session finished and
 * stamps ended_at. This frees the one-live-session-per-venue index so the venue can
 * open a fresh session next time. Auth: host JWT + venue staff.
 */
// POST /host/overage/ack — the host has accepted going over their plan cap for this night.
// Sets a flag on the session so games can start over cap AND chargeNightOverage will bill the
// extra players (at the monthly rate) at close. One tap covers the whole night.
async function handleOverageAck(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const sessionId = String(b.session_id || '').trim();
  if (!sessionId) return json({ error: 'Missing session_id' }, 400);
  assertUuid(sessionId, 'session_id');
  const session = await getSession(env, sessionId);
  await requireStaff(env, authUserId, session.venue_id);         // ENFORCED: staff at the session's venue (also kill-switch)
  if (session.status === 'finished' || session.status === 'cancelled') return json({ error: 'This session is closed' }, 409);
  /* Record WHAT WAS APPROVED, not just that something was. The host taps OK against a specific
     number of extra players and a specific dollar figure on screen. Storing a bare boolean meant
     the amount was whatever the count happened to be at close, hours later, with no ceiling. */
  const roster = await sbGet(env, 'vp_players',
    'session_id=eq.' + enc(sessionId) + '&kicked=eq.false&select=id,device_id');
  const approvedCount = countPlayers(roster);
  await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(sessionId),
    { overage_approved: true, overage_approved_at: new Date().toISOString(),
      overage_approved_count: approvedCount });
  return json({ ok: true, overage_approved: true, approved_count: approvedCount });
}

async function handleSessionClose(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const sessionId = String(b.session_id || '').trim();
  if (!sessionId) return json({ error: 'Missing session_id' }, 400);
  assertUuid(sessionId, 'session_id');

  const session = await getSession(env, sessionId);
  const staff = await requireStaff(env, authUserId, session.venue_id);   // ENFORCED: staff at the session's venue
  if (session.status === 'finished' || session.status === 'cancelled') {
    return json({ session_id: sessionId, status: session.status });
  }

  await sbPatch(env, 'vp_games', 'session_id=eq.' + enc(sessionId) + '&status=eq.running',
    { status: 'finished', ended_at: new Date().toISOString() });
  await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(sessionId),
    { status: 'finished', ended_at: new Date().toISOString() });
  await emitEvent(env, session, 'session.closed', {}, actorRef(staff));
  // Busy-night overage: if this night's metered headcount beat the plan cap, add the
  // extra players to the next Stripe invoice. Wrapped so a billing hiccup never blocks close.
  try { await chargeNightOverage(env, session); } catch (e) { /* billing never blocks session close */ }
  return json({ session_id: sessionId, status: 'finished' });
}

/* ============================================================
   Busy-night overage billing.
   A night's "peak" is the count of metered players who joined this session (bingo,
   trivia and musical bingo mint vp_players; raffle and members draw do not, so a
   host-only night naturally has zero overage). If peak beats the plan cap that was
   frozen at session start, the extra players are billed at the MONTHLY per-player
   rate (even on an annual plan) as a pending Stripe invoice item, so they land on
   the venue's next normal invoice. One charge per session, made idempotent by the
   Stripe idempotency key so a double close can never double charge. Comp/test venues
   (no Stripe subscription) are skipped. Requires STRIPE_SECRET_KEY in this Worker's
   env; if it is absent, overage billing is simply off.
   ============================================================ */
async function stripeGet(env, path) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  return await res.json();
}
async function stripePost(env, path, params, idemKey) {
  const form = new URLSearchParams();
  for (const k in params) form.set(k, String(params[k]));
  const headers = {
    'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  const res = await fetch('https://api.stripe.com/v1/' + path, { method: 'POST', headers, body: form.toString() });
  return await res.json();
}
/* The account's billed player total, mirroring vpbAccountTotal in the billing Worker: a venue
   with a scheduled reduction is billed at that lower number, so an uplift here must not silently
   re-inflate it. Keep the two in step. */
async function accountBilledTotal(env, foundingId) {
  const vs = await sbGet(env, 'vp_venues',
    'founding_id=eq.' + enc(foundingId) + '&select=max_players,pending_players,cancel_at_period_end');
  return (vs || []).reduce((n, v) => {
    if (v.cancel_at_period_end) return n;
    const billed = (v.pending_players != null) ? parseInt(v.pending_players, 10) : parseInt(v.max_players, 10);
    return n + (billed || 0);
  }, 0);
}

/* Move a venue up a plan after three consecutive big nights. The new max is the SMALLEST of the
   three, i.e. the crowd they proved every time; the bigger nights in the streak were spikes and
   stay as per-night overage. Charged from the NEXT invoice (proration 'none'), but the capacity
   is theirs immediately, so the following week they are simply not over any more. */
/* Per player, per month. Mirrors vpbRate in the billing Worker; keep the two in step. */
function upliftRate(tier, annual) {
  if (annual) return tier === 'founding' ? 2.30 : 2.85;
  return tier === 'founding' ? 2.50 : 3.00;
}

async function upliftPlan(env, venue, acct, newMax, peaks, tier) {
  const current = parseInt(venue.max_players, 10) || 0;
  if (!(newMax > current)) return null;
  // A venue with a reduction already scheduled has deliberately chosen a smaller plan for next
  // renewal. Lifting it now is invisible to Stripe (the billed total uses pending_players, so the
  // quantity never moves and the rollback never fires) and the renewal then overwrites
  // max_players with the pending figure anyway, silently undoing it. Leave their choice alone.
  if (venue.pending_players != null) {
    console.log('[overage] venue ' + venue.id + ' uplift skipped: a reduction to ' +
                venue.pending_players + ' is already scheduled');
    return null;
  }
  await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id), { max_players: newMax });
  let quantityOk = false, prorata = null;
  try {
    const sub = await stripeGet(env, 'subscriptions/' + enc(acct.stripe_subscription_id));
    const item = sub && sub.items && sub.items.data && sub.items.data[0];
    if (item && item.id) {
      const total = await accountBilledTotal(env, venue.founding_id);
      const upd = await stripePost(env, 'subscription_items/' + enc(item.id),
        { quantity: Math.max(total, 1), proration_behavior: 'none' });
      quantityOk = !(upd && upd.error);

      /* ANNUAL. "From your next invoice" is next month on a monthly plan and up to ELEVEN MONTHS
         away on an annual one, and the extra capacity is theirs the moment we lift it. Left as it
         was, an annual venue that outgrew its plan in month two got the bigger plan, and an end to
         paying per head, free until renewal. So the added players are charged PRO RATA to the
         renewal date, which is the same rule the Account page already applies when a venue adds
         players by hand, and the same one terms.html already promises for annual.
         Nothing to claw back if they shrink again: dropping the maximum banks the unused value as
         a credit against the next renewal, which is already how reductions work. */
      const interval = item.price && item.price.recurring && item.price.recurring.interval;
      const periodEnd = sub.current_period_end || item.current_period_end;
      if (quantityOk && interval === 'year' && periodEnd) {
        const left = (periodEnd * 1000 - Date.now()) / (365 * 24 * 3600 * 1000);
        const frac = Math.max(0, Math.min(1, left));
        const added = newMax - current;
        const cents = Math.round(added * upliftRate(tier, true) * 12 * frac * 100);
        if (cents > 0) {
          const months = Math.round(frac * 12 * 10) / 10;
          const res = await stripePost(env, 'invoiceitems', {
            customer: acct.stripe_customer_id,
            subscription: acct.stripe_subscription_id,
            currency: 'aud',
            amount: cents,
            description: (venue.name || 'Venue') + ': plan raised to ' + newMax + ' players after three big nights, '
                       + added + ' extra pro rata to renewal (' + months + ' months)',
          }, 'uplift_' + venue.id + '_' + newMax + '_' + Math.floor(periodEnd / 86400));
          if (res && res.error) {
            console.log('[overage] venue ' + venue.id + ' annual pro rata FAILED: ' +
                        ((res.error && res.error.message) || 'unknown') + ' (needs manual billing)');
          } else {
            prorata = { cents: cents, months: months, added: added };
          }
        }
      }
    }
  } catch (e) { quantityOk = false; }
  if (!quantityOk) {
    // Never leave them on a bigger plan we failed to bill for: put the cap back and let the
    // streak run again rather than hand out capacity for free.
    await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id), { max_players: current });
    console.log('[overage] venue ' + venue.id + ' uplift ' + current + '->' + newMax + ' FAILED at Stripe; rolled back');
    return null;
  }
  await sbInsert(env, 'vp_admin_audit', {
    action: 'plan_uplift_after_three_big_nights',
    target: 'venue:' + venue.id,
    detail: { from: current, to: newMax, nights: peaks,
              effective: prorata ? 'pro_rata_now' : 'next_invoice', prorata: prorata },
  }, false).catch(() => {});
  return newMax;
}

/* Is this venue still inside its free first month? The consoles check this and skip the consent
   popup entirely when it is true, telling the host "your first month is free, so no charge this
   time". The Worker never checked, so it billed the night regardless: money taken after the
   product said, on screen, that none would be. It also counted toward the three-night streak that
   moves a venue onto a bigger plan. The billing Worker already refuses to charge a trialing
   subscription; this is the same rule, applied where the night is actually billed. */
async function venueInFreeMonth(env, venueId) {
  try {
    const rows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=created_at&limit=1');
    const created = rows && rows[0] && rows[0].created_at;
    if (!created) return false;
    const t = Date.parse(created);
    if (!isFinite(t)) return false;
    return (Date.now() - t) < 30 * 24 * 60 * 60 * 1000;
  } catch (e) { return false; }   // cannot tell: bill it, and the consent screen was shown
}

/* The most a night can be billed for on one host approval.

   The host approves a specific number of extra players and a specific dollar figure shown on
   screen. Stragglers still arrive after that, so the approval carries a margin rather than
   pinning to the exact number. Beyond the margin the host is asked again, and chargeNightOverage
   will not bill past it either, so an approval can never become an open cheque. A session
   approved before migration 39 has no recorded count and falls back to the plan cap plus the
   margin, which is the smallest defensible reading of what that host agreed to.

   OVERAGE_ABSOLUTE_MAX is a second, blunter backstop. /join needs no login, so a flood cannot be
   ruled out by authorisation alone; nothing legitimate reaches it. */
const OVERAGE_ACK_MARGIN = 10;
const OVERAGE_ABSOLUTE_MAX = 500;
function overageCeiling(session, planCap) {
  const approved = Number(session.overage_approved_count || 0);
  const base = approved > 0 ? approved : planCap;
  // Proportional above ~40, so a genuinely big night is not re-prompting the host every ten
  // people, while a small venue still gets a tight bound.
  const margin = Math.max(OVERAGE_ACK_MARGIN, Math.ceil(base * 0.25));
  return Math.min(base + margin, OVERAGE_ABSOLUTE_MAX);
}

/* Count PEOPLE, not join rows. A vp_players row is one join, and one patron makes several over a
   night: a phone locking and reloading, a tab iOS discarded, private browsing, and a second format
   later in the same session. Billing on rows charged a venue twice for the same crowd when they
   ran trivia and then musical bingo, and three such nights moved them permanently up a plan.
   Rows with no device_id predate migration 39, or came from a page that sends none: those are
   counted individually, which is the old behaviour and errs in the venue's favour rather than
   silently collapsing two real patrons into one. Callers must select device_id. */
function countPlayers(rows) {
  const seen = new Set();
  let n = 0;
  for (const p of (rows || [])) {
    const d = p && p.device_id;
    if (d) { if (!seen.has(d)) { seen.add(d); n++; } }
    else n++;
  }
  return n;
}

async function chargeNightOverage(env, session) {
  if (!env.STRIPE_SECRET_KEY) return;                          // overage billing not configured
  const cap = Number(session.plan_cap_at_start || 0);
  if (!cap) return;
  const players = await sbGet(env, 'vp_players',
    'session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id,device_id');
  const counted = countPlayers(players);
  /* Never bill past what the host approved. The count is re-read here, hours after the tap, so
     without this the approved figure and the billed figure were unrelated numbers. */
  const ceiling = overageCeiling(session, cap);
  const peak = Math.min(counted, ceiling);
  if (counted > ceiling) {
    console.log('[overage] session ' + session.id + ' counted ' + counted +
                ' players but the host approved up to ' + ceiling + '; billing the approved figure');
  }
  // No metered players at all means this was not a player night (a raffle and a members draw
  // mint no vp_players). It is neither a big night nor a quiet one, so the streak is untouched:
  // otherwise bingo, then a raffle, then bingo could never add up to three in a row.
  if (peak <= 0) return;

  const venues = await sbGet(env, 'vp_venues',
    'id=eq.' + enc(session.venue_id) +
    '&select=id,name,founding_id,max_players,pending_players,overage_streak,overage_streak_peaks');
  const venue = venues && venues[0];
  if (!venue) return;

  const overage = peak - cap;
  // Free first month: the consoles promise no charge and show no consent screen, so honour that
  // here rather than invoice it. The streak is left alone too, or a venue could be moved onto a
  // bigger plan by nights they were told were free.
  if (overage > 0 && await venueInFreeMonth(env, venue.id)) {
    console.log('[overage] free first month, not charging venue ' + venue.id);
    return;
  }
  if (overage <= 0) {
    // A night back inside their cap breaks the run, so the next big night starts again at $2.
    if (venue.overage_streak) {
      await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id),
        { overage_streak: 0, overage_streak_peaks: [] });
    }
    return;
  }
  if (!venue.founding_id) return;
  // Overage is charged ONLY when the host approved it on the night: when the room passed the
  // plan cap they saw a "you are over your plan, extra players are $X each" warning and tapped
  // OK (POST /host/overage/ack). No approval means no charge and no streak, so a fake-join flood
  // can never bill a venue or push one onto a bigger plan.
  if (!session.overage_approved) return;
  const accts = await sbGet(env, 'venueplay_founding',
    'id=eq.' + enc(venue.founding_id) + '&select=id,stripe_customer_id,stripe_subscription_id');
  const acct = accts && accts[0];
  if (!acct || !acct.stripe_customer_id || !acct.stripe_subscription_id) return;   // comp/test venue: never charge

  // Tier ('founding' | 'standard') comes from the subscription metadata we set at checkout,
  // the authoritative source (no price-id guessing, no extra env vars). If we cannot read a
  // known tier, do NOT guess a rate on real money: log and skip for manual handling.
  let tier = '';
  try {
    const sub = await stripeGet(env, 'subscriptions/' + enc(acct.stripe_subscription_id));
    tier = (sub && sub.metadata && sub.metadata.tier) || '';
  } catch (e) { tier = ''; }
  if (tier !== 'founding' && tier !== 'standard') {
    console.log('[overage] session ' + session.id + ' unknown tier (metadata.tier="' + tier +
                '"): skipping charge for manual review');
    return;
  }
  /* Dean's model (12 Aug 2026): $2 a head for the first two big nights in a row. On the THIRD
     consecutive one they pay $1 a head and the plan moves up, because at that point it is not a
     big night any more, it is their crowd. The uplift is the SMALLEST of the three nights: a
     venue capped at 10 that draws 12, 13, 15 moves to 12, since 12 is the only number they hit
     every time. Paying twice at $2 and once at $1 is also what makes moving up the cheaper
     outcome for them, which is the point. */
  const peaks = (Array.isArray(venue.overage_streak_peaks) ? venue.overage_streak_peaks.slice(-2) : []).concat([peak]);
  const thirdInARow = peaks.length >= 3;
  const rateDollars = thirdInARow ? 1.00 : 2.00;
  const amountCents = Math.round(overage * rateDollars * 100);
  if (amountCents <= 0) return;

  const when = new Date().toISOString().slice(0, 10);
  const res = await stripePost(env, 'invoiceitems', {
    customer: acct.stripe_customer_id,
    subscription: acct.stripe_subscription_id,
    currency: 'aud',
    amount: amountCents,
    description: 'Big night extra players - ' + (venue.name || 'venue') + ' - ' + when +
                 ' - ' + overage + ' over ' + cap + ' at $' + rateDollars.toFixed(2) +
                 (thirdInARow ? ' (third big night in a row)' : ''),
  }, 'overage_' + session.id);
  if (!res || res.error) {
    console.log('[overage] session ' + session.id + ' Stripe invoiceitem FAILED: ' +
                ((res && res.error && res.error.message) || 'unknown') + ' (needs manual billing)');
    /* A FAILED CHARGE MUST NOT ADVANCE THE STREAK.
       The code used to log and fall straight through to the streak patch and, on the third night,
       to upliftPlan(). So three consecutive over-nights whose invoiceitems all failed (an expired
       card, a Stripe outage) never billed the venue a cent for the overage but did move them
       permanently onto a bigger monthly plan. Leave the streak where it is: the night can be
       billed by hand, and a real third night will still count once a charge actually succeeds. */
    try {
      await sbInsert(env, 'vp_admin_audit', {
        actor_admin: null,
        actor_label: 'system',
        action: 'overage_charge_failed',
        target: venue.id,
        detail: {
          session_id: session.id,
          venue_name: venue.name || null,
          amount_cents: amountCents,
          players_over: overage,
          plan_cap: cap,
          error: (res && res.error && res.error.message) || 'unknown',
        },
      }, false);
    } catch (e) { /* audit is best effort; never let it mask the billing failure */ }
    return;
  }

  if (!thirdInARow) {
    await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id),
      { overage_streak: peaks.length, overage_streak_peaks: peaks });
    return;
  }
  // Third in a row: move them up to the crowd they proved every time, and start counting again.
  const newMax = Math.min.apply(null, peaks);
  await upliftPlan(env, venue, acct, newMax, peaks, tier);
  await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id),
    { overage_streak: 0, overage_streak_peaks: [] });
}

/* Once-a-week limit for Trivia and Musical Bingo. A venue may only start a NEW
   night of that format once per rolling 7 days. Tracking by session id means
   more rounds within the SAME night never count. Returns an error message to
   show the host if blocked, otherwise stamps this session as the current night
   and returns null. */
async function checkWeeklyFormatLimit(env, session, isTrivia) {
  const col = isTrivia ? 'last_trivia' : 'last_musical';
  const label = isTrivia ? 'Trivia' : 'Musical bingo';
  const venues = await sbGet(env, 'vp_venues',
    'id=eq.' + enc(session.venue_id) + '&select=id,' + col + '_at,' + col + '_session_id');
  const v = venues && venues[0];
  if (!v) return null;
  const lastAt = v[col + '_at'];
  const lastSession = v[col + '_session_id'];
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  // Already running this format in THIS session: it is the same night, always allow.
  if (lastSession && lastSession === session.id) return null;

  // Same night, NEW session id: allow. A session can end while the night is still going on
  // (the 4 hour forced sign-out, a host signing out at handover, a closed tablet), and the
  // restart mints a fresh session id. Keying the weekly slot on the session id alone meant
  // that restart read as "a second trivia night this week" and refused the host with a room
  // already seated, with nothing in either Worker able to clear it. Nobody runs the same
  // format twice inside this window except when picking a night back up.
  const RESUME_GRACE = 8 * 60 * 60 * 1000;
  // Ran this format in a DIFFERENT session within the last 7 days: block.
  if (lastAt) {
    const elapsed = Date.now() - new Date(lastAt).getTime();
    if (elapsed >= 0 && elapsed < RESUME_GRACE) return null;
    if (elapsed >= 0 && elapsed < WEEK) {
      // Display the "available from" day in Brisbane (UTC+10, no DST in QLD).
      const nextDay = new Date(new Date(lastAt).getTime() + WEEK + 10 * 3600 * 1000).toISOString().slice(0, 10);
      return label + ' runs once a week per venue. Your next ' + label.toLowerCase() +
             ' night is available from ' + nextDay + '.';
    }
  }
  return null;   // allowed; the slot is stamped by stampWeeklyFormat AFTER the game starts
}

// Stamp this session as the venue's current trivia/musical night. Called AFTER the game row
// is inserted, so a start that fails validation never burns the once-a-week slot.
async function stampWeeklyFormat(env, session, isTrivia) {
  const col = isTrivia ? 'last_trivia' : 'last_musical';
  const patch = {};
  patch[col + '_at'] = new Date().toISOString();
  patch[col + '_session_id'] = session.id;
  await sbPatch(env, 'vp_venues', 'id=eq.' + enc(session.venue_id), patch);
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
  const payload = await verifyJwtHS256(m[1], env.SUPABASE_JWT_SECRET, env);
  if (!payload.sub) throw httpError(401, 'Token has no subject');
  return payload.sub;   // auth.users.id
}

// Confirm the auth user is staff at the target venue. Returns the staff row
// (id + role). This is the cross-venue-leakage gate: the venue is re-derived
// per request and matched against the target.
/* Who did this, for the event log. A VenuePlay HQ admin using "View as" has no vp_venue_staff
   row to name, and 'host:null' in an audit trail reads as data loss rather than as us acting on
   the venue's behalf. The auth user id is the thing that is actually true about them. */
function actorRef(staff) {
  if (!staff) return 'host:unknown';
  if (staff.is_admin) return 'vpadmin:' + (staff.auth_user_id || 'unknown');
  return 'host:' + (staff.id || 'unknown');
}

async function requireStaff(env, authUserId, venueId) {
  assertUuid(authUserId, 'user');     // sub claim from the verified JWT
  assertUuid(venueId, 'venue_id');    // re-derived per request; never trusted raw
  const rows = await sbGet(env, 'vp_venue_staff',
    'auth_user_id=eq.' + enc(authUserId) + '&venue_id=eq.' + enc(venueId) + '&select=id,role,venue_id');
  if (!rows.length) {
    /* A VenuePlay HQ admin using "View as" is staff nowhere, and this Worker had no concept of an
       admin at all, so every host route refused them. The consoles do not refuse them: they read
       ctx.isAdmin and show the full manager controls. So an admin got a working-looking members
       draw where creating a draw, adding members and drawing a winner all failed.

       It looked format-specific from the outside, which is what made it hard to place: broadcast
       bingo has no Worker, so bingo worked perfectly while everything with a server behind it did
       nothing. This is the same gap the billing Worker had, fixed there this morning.

       The admin still has to BE an admin: this is a real lookup against vp_platform_admins, not a
       header or a client claim. */
    /* Role matters. vp_platform_admins.role is 'owner' | 'accounts' | 'staff', and the billing
       Worker already gates its admin routes on ['owner','accounts']. Accepting ANY row here
       handed a Gflam 'staff' admin owner rights at every venue in the country, including setting
       a members-draw jackpot to any figure. Match the other Worker rather than invent a second
       answer to the same question. */
    const admins = await sbGet(env, 'vp_platform_admins',
      'auth_user_id=eq.' + enc(authUserId) + '&role=in.(owner,accounts)&select=auth_user_id,role');
    if (!admins.length) throw httpError(403, 'Not authorised: you are not staff at this venue');
    // The kill-switch still applies: an admin must not be able to run games at a venue we have
    // switched off, or the suspension would not mean anything.
    await assertVenueActive(env, venueId);
    // 'owner' so the manager-gated routes (draw settings, members list) work, which is the whole
    // point of View as. id is null: there is no staff row to attribute to, and the audit trail
    // records the auth user either way.
    return { id: null, role: 'owner', venue_id: venueId, is_admin: true, auth_user_id: authUserId };
  }

  // M6 kill-switch: an admin-suspended venue (or its group) cannot run games,
  // regardless of a valid host login or Stripe state.
  await assertVenueActive(env, venueId);
  return Object.assign({ auth_user_id: authUserId }, rows[0]);
}

// M6 kill-switch, shared by requireStaff (host routes) and the player routes
// (/join, /player/claim). An admin-suspended venue (or its group) must not accrue
// more metered vp_players rows or vp_session_events, so this is re-checked on
// every write path even the unauthenticated ones. Throws on suspension.
async function assertVenueActive(env, venueId) {
  assertUuid(venueId, 'venue_id');   // re-derived per request; never trusted raw
  const venues = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=status,group_id');
  if (!venues.length) throw httpError(403, 'Venue not available');
  if (venues[0].status !== 'active') throw httpError(403, 'Games are paused here tonight. Have a word with the staff.');
  if (venues[0].group_id) {
    const groups = await sbGet(env, 'vp_venue_groups', 'id=eq.' + enc(venues[0].group_id) + '&select=status');
    if (groups.length && groups[0].status !== 'active') throw httpError(403, 'Games are paused here tonight. Have a word with the staff.');
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

  const players = await sbGet(env, 'vp_players', 'session_id=eq.' + enc(sessionId) + '&kicked=eq.false&select=id,device_id');
  const playerCount = countPlayers(players);   // devices, not joins: matches what the venue is billed on

  const snap = {
    session_id: s.id,
    status: s.status,
    state_version: s.state_version,
    join_code: s.join_code,
    title: s.title || null,
    player_count: playerCount,
    plan_cap: s.plan_cap_at_start != null ? s.plan_cap_at_start : null,
    over_cap: s.plan_cap_at_start != null ? playerCount > s.plan_cap_at_start : false,
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

  // Current running trivia game, public state only (used by a reconnecting TV or a
  // late-joining phone). The correct_index is exposed ONLY once the phase is
  // 'revealed'; while a question is 'asking'/'locked' it is never in the projection.
  if (!snap.game) {
    const tgames = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(sessionId) + '&format=eq.trivia&status=eq.running&select=id,seq,config&order=seq.desc&limit=1');
    if (tgames.length) {
      const g = tgames[0];
      const cfg = g.config || {};
      const game = {
        game_id: g.id, seq: g.seq, format: 'trivia',
        title: cfg.title || null, prize: cfg.prize || null,
        question_count: cfg.question_count != null ? cfg.question_count : null,
        colour: cfg.colour !== false, phase: 'idle', question: null,
      };
      const tg = await sbGet(env, 'vp_trivia_games',
        'game_id=eq.' + enc(g.id) + '&select=question_set_id,current_seq,phase,question_ends_at');
      if (tg.length) {
        const t = tg[0];
        game.phase = t.phase;
        if (t.current_seq) {
          const qrows = await sbGet(env, 'vp_questions',
            'set_id=eq.' + enc(t.question_set_id) + '&seq=eq.' + t.current_seq +
            '&select=question,options,correct_index&limit=1');
          if (qrows.length) {
            const q = qrows[0];
            /* qi is the POSITION IN THE ROUND ("Question 3 of 10"); qseq is the question's id
               within the set. They were the same number only because the randomiser was dead and
               rounds ran seq 1..N in order. Now that config.question_seqs is honoured, current_seq
               is a random seq from the whole library set, so a host reload mid-round rebroadcast
               "Question 412 of 10" to the TV and every phone, and the console's isLast test
               (qi >= qtotal) went true on question one and offered to end the round. */
            const _seqs = Array.isArray((g.config || {}).question_seqs) ? g.config.question_seqs : null;
            const _pos = _seqs ? (_seqs.indexOf(t.current_seq) + 1) : t.current_seq;
            const pub = {
              qseq: t.current_seq, qi: _pos > 0 ? _pos : t.current_seq,
              text: q.question, options: Array.isArray(q.options) ? q.options : [],
              ends_at: t.question_ends_at || null,
            };
            if (t.phase === 'revealed') pub.correct_index = q.correct_index;   // only after reveal
            game.question = pub;
          }
        }
      }
      snap.game = game;
    }
  }

  // Current running musical bingo game, public state only (a reconnecting TV or a
  // late-joining/reloading phone). Song titles ARE public (players daub them by ear), so
  // the projection exposes the songs played so far; the per-player card is fetched by the
  // phone via /player/card, never here.
  if (!snap.game) {
    const mgames = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(sessionId) + '&format=eq.musical_bingo&status=eq.running&select=id,seq,config&order=seq.desc&limit=1');
    if (mgames.length) {
      const g = mgames[0];
      const cfg = g.config || {};
      const mg = await sbGet(env, 'vp_music_games', 'game_id=eq.' + enc(g.id) + '&select=playlist_id,pattern,reveal_mode');
      let played = [];
      let allSongs = [];   // the whole game's song list (id + title) so a reloading HOST can rebuild its play queue
      if (mg.length) {
        const songs = await sbGet(env, 'vp_playlist_songs', 'playlist_id=eq.' + enc(mg[0].playlist_id) + '&select=id,title');
        const titleById = {};
        for (let i = 0; i < songs.length; i++) titleById[songs[i].id] = songs[i].title;
        allSongs = songs.map((s) => ({ song_id: s.id, title: s.title }));
        const plays = await sbGet(env, 'vp_music_plays',
          'game_id=eq.' + enc(g.id) + '&played_at=not.is.null&select=song_id,seq&order=seq.asc');
        played = plays.map((p) => ({ song_id: p.song_id, title: titleById[p.song_id] || '' }));
      }
      snap.game = {
        game_id: g.id, seq: g.seq, format: 'musical_bingo',
        pattern: mg.length ? mg[0].pattern : null,
        prize: cfg.prize || null, title: cfg.title || null,
        playlist_name: cfg.playlist_name || null, song_count: cfg.song_count != null ? cfg.song_count : null,
        auto_daub: cfg.auto_daub !== false,
        played_songs: played, played_count: played.length,
        all_songs: allSongs,   // titles are already public (players daub by ear); no secrets here
      };
    }
  }

  // Current running raffle, public projection only. Raffle is HOST-ONLY (no players), so
  // this is purely so a reconnecting TV can redraw the prize and the latest winning ticket(s).
  if (!snap.game) {
    const rgames = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(sessionId) + '&format=eq.raffle&status=eq.running&select=id,seq,config&order=seq.desc&limit=1');
    if (rgames.length) {
      const g = rgames[0];
      const cfg = g.config || {};
      const rg = await sbGet(env, 'vp_raffle_games',
        'game_id=eq.' + enc(g.id) + '&select=range_min,range_max,draws_count,allow_redraw,time_to_claim_seconds,jackpot_on,jackpot_amount_cents');
      const r = rg.length ? rg[0] : {};
      const leadingZeros = cfg.leading_zeros !== false;
      const padWidth = leadingZeros ? String(Math.max(r.range_max || 1, 1)).length : 1;
      // The latest draw round's winning tickets (for a TV that reconnected after a draw).
      const last = await sbGet(env, 'vp_raffle_results',
        'game_id=eq.' + enc(g.id) + '&select=seq,ticket_number&order=seq.desc&limit=50');
      let lastSeq = null;
      const lastTickets = [];
      const allTickets = [];   // every number drawn so far (up to 50) so a reloading HOST rebuilds its drawn grid
      for (let i = 0; i < last.length; i++) {
        if (lastSeq == null) lastSeq = last[i].seq;
        if (last[i].seq === lastSeq && last[i].ticket_number != null) lastTickets.push(last[i].ticket_number);
        if (last[i].ticket_number != null) allTickets.push(last[i].ticket_number);
      }
      snap.game = {
        game_id: g.id, seq: g.seq, format: 'raffle',
        prize: cfg.prize || null, prize_type: cfg.prize_type || null,
        range_min: r.range_min != null ? r.range_min : null,
        range_max: r.range_max != null ? r.range_max : null,
        winners: r.draws_count != null ? r.draws_count : null,
        allow_redraw: r.allow_redraw !== false,
        time_to_present: r.time_to_claim_seconds != null ? r.time_to_claim_seconds : null,
        jackpot_on: !!r.jackpot_on,
        jackpot_amount_cents: r.jackpot_amount_cents != null ? r.jackpot_amount_cents : null,
        pad: padWidth, last_seq: lastSeq, last_tickets: lastTickets, all_tickets: allTickets,
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
// Fair (CSPRNG) in-place Fisher-Yates shuffle for any array. Used to randomise trivia questions.
function shuffleArray(a) {
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

/* ---- MUSICAL BINGO card + pattern (5x5, FREE centre) ---- */

// Deal a 5x5 musical bingo card: 24 distinct songs plus a FREE centre (index 12 = 0).
// Each non-free cell is { song_id, title }; song_id (a vp_playlist_songs uuid) is what the
// claim check matches against played songs, title is what the phone renders. songs is the
// playlist's rows [{id,title,artist}]. CSPRNG pick, order does not matter on the card.
function generateMusicCard(songs) {
  const pool = songs.slice();
  const picks = [];
  const need = Math.min(24, pool.length);
  for (let i = 0; i < need; i++) {
    const idx = randInt(pool.length);
    picks.push(pool[idx]);
    pool.splice(idx, 1);
  }
  const cells = new Array(25).fill(0);
  let ti = 0;
  for (let p = 0; p < 25; p++) {
    if (p === 12) { cells[p] = 0; continue; }   // FREE centre
    const s = picks[ti++];
    cells[p] = s ? { song_id: s.id, title: s.title } : { song_id: null, title: '' };
  }
  return cells;
}

// Server-authoritative pattern check for a 5x5 musical card. cells is the 25-value grid
// ({song_id,title} per square, 0 at the FREE centre); playedSet is a Set of song_ids
// actually played. A square is covered if it is the FREE centre or its song_id has been
// played. Line patterns check ROWS only (matching the host/player UI: "any full row").
// Returns {valid, cells:[covered indices]}.
function checkMusicPattern(pattern, cells, playedSet) {
  const covered = (i) => {
    if (i === 12) return true;                  // FREE centre
    const c = cells[i];
    const sid = c && (c.song_id || c.s);        // tolerate a compact {s,t} shape too
    return !!sid && playedSet.has(sid);
  };
  const rowCells = [];
  const rowComplete = [];
  for (let r = 0; r < 5; r++) {
    const idxs = [];
    let all = true;
    for (let col = 0; col < 5; col++) {
      const i = r * 5 + col;
      idxs.push(i);
      if (!covered(i)) all = false;
    }
    rowCells.push(idxs);
    rowComplete.push(all);
  }
  if (pattern === 'one_line') {
    for (let r = 0; r < 5; r++) if (rowComplete[r]) return { valid: true, cells: rowCells[r] };
    return { valid: false, cells: [] };
  }
  if (pattern === 'two_lines') {
    const done = [0, 1, 2, 3, 4].filter((r) => rowComplete[r]);
    if (done.length >= 2) {
      const cs = [];
      done.slice(0, 2).forEach((r) => rowCells[r].forEach((i) => cs.push(i)));
      return { valid: true, cells: cs };
    }
    return { valid: false, cells: [] };
  }
  if (pattern === 'four_corners') {
    const cor = [0, 4, 20, 24];
    if (cor.every(covered)) return { valid: true, cells: cor };
    return { valid: false, cells: [] };
  }
  if (pattern === 'full_house') {
    const cs = [];
    for (let i = 0; i < 25; i++) { if (!covered(i)) return { valid: false, cells: [] }; cs.push(i); }
    return { valid: true, cells: cs };
  }
  return { valid: false, cells: [] };
}

// Materialise an inline library playlist into vp_playlists + vp_playlist_songs so the
// vp_music_plays FK has real rows to point at (the library JSON is a client asset, not
// seeded). Idempotent-ish: if this venue already has a playlist with the same title AND
// song_count AND that many song rows, reuse it rather than duplicating on every replay.
// songs is [{title, artist, hint?}], already validated (title + artist present).
async function ensureMusicPlaylist(env, venueId, name, songs) {
  const existing = await sbGet(env, 'vp_playlists',
    'owner_venue_id=eq.' + enc(venueId) + '&title=eq.' + enc(name) +
    '&song_count=eq.' + songs.length + '&select=id&order=created_at.desc&limit=1');
  if (existing.length) {
    const have = await sbGet(env, 'vp_playlist_songs', 'playlist_id=eq.' + enc(existing[0].id) + '&select=id');
    if (have.length === songs.length) return existing[0].id;   // exact reuse
  }
  const plRows = await sbInsert(env, 'vp_playlists',
    { owner_venue_id: venueId, title: name, song_count: songs.length }, true);
  const pl = Array.isArray(plRows) ? plRows[0] : plRows;
  const songRows = songs.map((s, i) => ({
    playlist_id: pl.id, seq: i + 1, title: s.title, artist: s.artist, hint: s.hint || null,
  }));
  await sbInsert(env, 'vp_playlist_songs', songRows, false);
  return pl.id;
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

// Supabase's asymmetric (ES256) signing keys, cached per isolate (they rotate rarely).
let _gameJwks = null;
async function fetchJwks(env) {
  if (_gameJwks && (Date.now() - _gameJwks.at) < 3600000) return _gameJwks.keys;
  try {
    const url = (env.SUPABASE_URL || '').replace(/\/+$/, '') + '/auth/v1/.well-known/jwks.json';
    const res = await fetch(url);
    if (!res.ok) return _gameJwks ? _gameJwks.keys : [];
    const data = await res.json();
    const keys = (data && data.keys) || [];
    _gameJwks = { keys: keys, at: Date.now() };
    return keys;
  } catch (e) { return _gameJwks ? _gameJwks.keys : []; }
}

// Verify a Supabase Auth JWT and return the decoded payload. Handles BOTH the legacy shared
// secret (HS256 against SUPABASE_JWT_SECRET) and the new asymmetric signing keys (ES256 against
// the published JWKS). Throws on a bad signature or an expired token.
async function verifyJwtHS256(token, secret, env) {
  if (!token) throw httpError(401, 'Missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'Malformed token');

  const enc = new TextEncoder();
  const header = JSON.parse(b64urlToString(parts[0]));
  const signed = enc.encode(parts[0] + '.' + parts[1]);
  const sigBytes = b64urlToBytes(parts[2]);
  let ok = false;
  if (header.alg === 'HS256') {
    if (!secret) throw httpError(500, 'SUPABASE_JWT_SECRET is not configured');
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('HMAC', key, sigBytes, signed);
  } else if (header.alg === 'ES256') {
    const keys = env ? await fetchJwks(env) : [];
    const jwk = keys.find(function (k) { return k.kid === header.kid; }) || keys[0];
    if (!jwk) throw httpError(401, 'No verification key available');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, signed);
  } else {
    throw httpError(401, 'Unsupported token algorithm');   // block alg:none / anything unexpected
  }
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
/* Insert or update on the primary key. Used where a repeat is EXPECTED and must not be an error:
   a host tapping "this song did not work" twice is one venue's single vote either way, not a
   conflict. PostgREST does this with resolution=merge-duplicates plus the conflict columns. */
async function sbUpsert(env, table, obj, onConflict) {
  const headers = { ...sbHeaders(env), 'Prefer': 'resolution=merge-duplicates' };
  const q = onConflict ? '?on_conflict=' + encodeURIComponent(onConflict) : '';
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + q, {
    method: 'POST', headers, body: JSON.stringify(obj),
  });
  if (!res.ok) throw dbError('upsert', table, await res.text());
  return null;
}

async function sbInsert(env, table, obj, returnRep) {
  const headers = { ...sbHeaders(env) };
  if (returnRep) headers['Prefer'] = 'return=representation';
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST', headers, body: JSON.stringify(obj),
  });
  if (res.status === 409) {
    // Unique-constraint clash: almost always a double-tap race (a duplicate round number, or
    // the one-card-per-player guard). Surface a clean, retryable 409 rather than a generic 502.
    // Callers that already catch conflicts (join-code loop, player card/answer) are unaffected.
    throw httpError(409, 'That was already starting. Please try again.');
  }
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

/* Like sbPatch, but returns the rows it actually changed, so a caller can tell "I updated it"
   apart from "the filter matched nothing". That difference is what makes a compare-and-set
   possible: patch WHERE the value is still what we read, and an empty result means somebody else
   got there first. */
async function sbPatchReturning(env, table, filter, obj) {
  const headers = Object.assign({}, sbHeaders(env), { 'Prefer': 'return=representation' });
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH', headers, body: JSON.stringify(obj),
  });
  if (!res.ok) throw dbError('update', table, await res.text());
  try { return await res.json(); } catch (e) { return []; }
}

async function sbDelete(env, table, filter) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'DELETE', headers: sbHeaders(env),
  });
  if (!res.ok) throw dbError('delete', table, await res.text());
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
  const e = /** @type {any} */ (new Error(message));   // carry a numeric .status the router echoes
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
 * DEPLOY + REVIEW NOTES  (endpoints, env vars, exact Cloudflare setup,
 * the reusable pattern for the other four formats, assumptions)
 * =====================================================================
 *
 * ENDPOINTS (full contract is in the header at the top of this file)
 *   POST /session              host   -> {session_id, join_code, tv_pairing_code, reused?}
 *   POST /session/close        host   -> {session_id, status}
 *   POST /join                 player -> {token, snapshot}
 *   POST /host/game            host   -> {game_id, seq, pattern, cards_dealt}
 *   POST /host/game/end        host   -> {game_id, status}
 *   POST /host/ball            host   -> {number, index}
 *   POST /host/play            host   -> {song_id, title, artist, seq, played_count}   (musical bingo)
 *   GET  /player/card          player -> {game_id, card_no, cells, pattern, called_numbers} | {game:null}
 *   POST /player/claim         player -> {claim_id, auto_verdict, winning_cells, card_no}
 *   POST /host/claim/resolve   host   -> {claim_id, status}
 *   GET  /snapshot?session=    public -> public projection (no secrets)
 *
 * ENV VARS (secrets: use `wrangler secret put`; plain vars: `[vars]` or the dashboard)
 *   SUPABASE_URL           https://gpoolavkghnxedzrmtmc.supabase.co   (plain var)
 *   SUPABASE_SERVICE_KEY   service_role key            (SECRET -- never in any page)
 *   SUPABASE_JWT_SECRET    Supabase JWT secret         (SECRET -- host-login verify)
 *   SITE_URL               https://www.venueplay.com.au  (plain var)
 *   ALLOW_ORIGIN           https://www.venueplay.com.au  (plain var; locks CORS. Use * only while testing)
 *   IP_HASH_SALT           any long random string       (SECRET; salts the coarse abuse hashes)
 *
 * WORKER BINDINGS
 *   RL   Workers KV namespace binding named exactly RL. Powers the /join +
 *        /player/claim rate limit and the /join soft dedup. Present = live;
 *        absent = degraded (warn + allow, everything still works). Add before launch.
 *   TURNSTILE_SECRET  optional future escalation (see the file header).
 *
 * EXACT CLOUDFLARE SETUP DEAN MUST DO TO DEPLOY + TEST  (nothing here deploys)
 *   This is its OWN Worker, separate from the billing Worker (venueplay-api). It
 *   sits at, e.g., https://venueplay-game.dean-tindale.workers.dev (same account
 *   subdomain the billing Worker already uses). The pages call it via a VP_GAME_API
 *   constant -- confirm that constant matches the deployed URL.
 *
 *   Option A -- Wrangler CLI (recommended). From the worker/ folder:
 *     1. Create a minimal wrangler.toml next to this file:
 *          name = "venueplay-game"
 *          main = "venueplay-game.js"
 *          compatibility_date = "2024-11-01"
 *          [vars]
 *          SITE_URL = "https://www.venueplay.com.au"
 *          ALLOW_ORIGIN = "https://www.venueplay.com.au"
 *          SUPABASE_URL = "https://gpoolavkghnxedzrmtmc.supabase.co"
 *          [[kv_namespaces]]
 *          binding = "RL"
 *          id = "<paste the id from step 3>"
 *     2. Log in once:                       wrangler login
 *     3. Make the KV namespace:             wrangler kv namespace create RL
 *          -> copy the printed id into the [[kv_namespaces]] block above.
 *     4. Put the three secrets (you are prompted to paste each value):
 *          wrangler secret put SUPABASE_SERVICE_KEY
 *          wrangler secret put SUPABASE_JWT_SECRET
 *          wrangler secret put IP_HASH_SALT
 *     5. Deploy:                            wrangler deploy
 *     6. Note the deployed URL it prints and set VP_GAME_API in app/index.html,
 *        tv.html and play.html to that URL (they default to the venueplay-game
 *        subdomain shown above).
 *
 *   Option B -- Cloudflare dashboard. Create a Worker named venueplay-game, paste
 *   this file, then under Settings -> Variables add SUPABASE_URL / SITE_URL /
 *   ALLOW_ORIGIN as plain text and SUPABASE_SERVICE_KEY / SUPABASE_JWT_SECRET /
 *   IP_HASH_SALT as encrypted secrets; under KV Namespace Bindings add one named RL.
 *
 *   Database prerequisites (run in the Supabase SQL editor, in this order, ONCE):
 *     venueplay-01-tables.sql, -02-views.sql, -03-security.sql,
 *     venueplay-05-atomic-events.sql  (vp_emit_event + vp_draw_next_ball RPCs),
 *     venueplay-06-bingo90.sql        (90-ball patterns on vp_bingo_games),
 *     venueplay-07-bingo90-format.sql (allows format='bingo90' on vp_games).
 *   (venueplay-game-schema.sql is the same content as 01/02/03 combined; either path is fine.)
 *   TRIVIA needs NO new infra: it reuses this same venueplay-game Worker and the trivia
 *   tables already in 01/02/03 (vp_question_sets, vp_questions, vp_trivia_games,
 *   vp_trivia_answers + the v_vp_trivia_leaderboard view). Load venueplay-seed-trivia-library.sql
 *   once for the shared VenuePlay library sets; a venue's own sets come through the app.
 *   MUSICAL BINGO also needs NO new infra and NO seed: it reuses this Worker and the musical
 *   tables already in 01/02/03 (vp_playlists, vp_playlist_songs, vp_cards, vp_music_games,
 *   vp_music_plays). vp_games.format='musical_bingo' is already allowed by -07's CHECK. The
 *   host page sends the chosen library playlist inline and the Worker materialises it into
 *   vp_playlists/vp_playlist_songs on first use (reused after), so nothing must be pre-seeded.
 *   NOTE: migration -09 dropped vp_cards_one_per_player_game, so the (game_id, card_no) unique
 *   index is the only one left on vp_cards; the on-demand card deal relies on that.
 *
 *   Quick smoke test after deploy (a real host JWT is needed for host routes):
 *     - Sign into app/index.html on a real venue-staff login, pair a TV (tv.html),
 *       tap Start, draw a few balls, join on a phone (play.html), press BINGO,
 *       confirm on the host. Then check the Supabase tables: vp_sessions (1 row,
 *       status running->finished), vp_games, vp_bingo_games.draw_index advancing,
 *       vp_players, vp_cards, vp_claims (status confirmed, resolved_by set).
 *
 * HOW THE OTHER FOUR FORMATS REUSE THIS  (this is a pattern, not a bingo one-off)
 *   Everything above the format line is shared and already generic:
 *     - /session, /session/close, /join, /snapshot, verifyHostJwt, requireStaff,
 *       assertVenueActive (kill-switch), the RL rate-limit/dedup, and emitEvent
 *       (the atomic state_version bump + vp_session_events insert that IS the
 *       Realtime broadcast). None of these know or care what the game is.
 *   To add trivia / musical bingo / raffle / members draw, add ONE per-format
 *   handler set that writes to that format's tables and emits public events. The
 *   session, player, join-code, metering and broadcast plumbing do NOT change:
 *     - vp_games.format carries the format string ('trivia','musical_bingo',
 *       'raffle','members_draw'); create the vp_games row exactly like /host/game.
 *     - TRIVIA (BUILT, this slice): /host/game with format='trivia' inserts vp_trivia_games
 *       (question_set_id). /host/question advances current_seq + sets phase 'asking' +
 *       question_ends_at and emits 'trivia.question' with options but NEVER correct_index
 *       (correct_index is returned only in the authenticated host response). /player/answer
 *       writes vp_trivia_answers (first answer final, late answers rejected by the server
 *       clock, no correctness returned). /host/reveal stamps is_correct/points_awarded and
 *       emits 'trivia.reveal' with the correct_index + leaderboard. /player/score lets a
 *       phone pull its own total/rank/last-result. Leaderboard is v_vp_trivia_leaderboard.
 *       TEAM NAME: the schema has no team_name column, so the team name captured at /join
 *       is stored in vp_players.display_name (which the leaderboard view already groups on).
 *     - MUSICAL BINGO (BUILT, this slice): same skeleton as bingo but the "draw" is a song.
 *       /host/game with format='musical' inserts vp_music_games (playlist_id, pattern,
 *       reveal_mode) and deals a 5x5 vp_cards grid of song titles (FREE centre; each cell is
 *       {song_id,title}). /host/play records vp_music_plays (played_at) and emits PUBLIC
 *       'music.song_played' (title+artist are public, players daub by ear; idempotent per song).
 *       /player/card serves the musical card + played songs (deals on demand for late joiners).
 *       /player/claim checks the card's song_ids against played songs (checkMusicPattern:
 *       one_line/two_lines/four_corners/full_house, rows only, FREE centre) and reuses the SAME
 *       claim + /host/claim/resolve flow as bingo (confirmed vp_claims row IS the winner;
 *       confirm finishes the game). Emits music.claim_submitted / music.claim_result.
 *       PLAYLIST SOURCE: vp_music_plays.song_id is a FK to vp_playlist_songs, so songs must be
 *       real rows. /host/game accepts either an existing playlist_id (venue-owned or a library
 *       playlist with owner null, the trivia-parallel) OR an inline {name, songs[]} that the
 *       Worker MATERIALISES into vp_playlists + vp_playlist_songs (reused on replay). The
 *       430-song library (data/musical-library.json) is a CLIENT asset for the audio previews
 *       and is not seeded, so the host page uses the inline path. AUDIO IS HOST-SIDE ONLY: the
 *       host device plays the ~30s previewUrl clip through the PA; the Worker only tracks which
 *       song was played and never stores or streams audio (licensing: OneMusic at the venue).
 *     - RAFFLE (BUILT, this slice): HOST-ONLY and NOT metered. The venue sells its own PAPER
 *       tickets, so there is NO /join, NO vp_players and nothing the peak-player billing view
 *       counts (that view only counts bingo/musical cards + trivia answers). /host/game with
 *       format='raffle' inserts vp_raffle_games in number_range mode (range_min/range_max,
 *       draws_count [cap 50; a cash jackpot forces 1 winner], time_to_claim_seconds,
 *       allow_redraw, jackpot_on/amount, rng_seed for audit); the prize text/type and the
 *       leading_zeros toggle live in vp_games.config (no columns for them). /host/draw picks
 *       the winning ticket number(s) UNIFORMLY at random in [range_min,range_max] with the
 *       rejection-sampled CSPRNG randInt (NOT modulo-biased), excluding already-drawn numbers,
 *       writes vp_raffle_results (prize_text + prize_type cash|other + optional prize_value_cents
 *       for the cash-given-away rollup) and emits 'raffle.winner'. redraw_of_seq marks the prior
 *       round no_show then draws a replacement (when allow_redraw). /host/draw/resolve records
 *       claimed|no_show (raffle's parallel to /host/claim/resolve). NO new infra and NO seed:
 *       reuses this Worker and the raffle tables already in 01/02/03 (+ prize_type from 04).
 *       leading_zeros display width is DERIVED from range_max (schema note: no column).
 *     - MEMBERS DRAW (BUILT, this slice): HOST-ONLY and NOT metered, and unlike the other four it opens
 *       NO session and NO vp_games row -- it runs directly off the venue's persistent roster
 *       (vp_member_rosters + vp_members) and its named recurring draws (vp_member_draws). /host/members/draw
 *       reads the draw's roster, keeps only status 'valid' members (the saved exclude list is the status
 *       'excluded' rows) and picks ONE UNIFORMLY with the rejection-sampled CSPRNG randInt (NOT modulo-biased),
 *       formats the winner name per the venue name_display setting (default abbrev_last -> "John S"), stamps
 *       last_drawn_date and returns the winner. /host/members/draw/resolve writes the durable
 *       vp_member_draw_results row (claim -> 'claimed', rollover -> 'jackpot_rolled') and runs the jackpot maths
 *       server-side: a claim RESETS current_jackpot_cents to starting_amount_cents, a rollover GROWS it by
 *       increment_cents. SCHEMA NOTE: vp_member_draw_results.outcome is NOT NULL and checks
 *       ('claimed','jackpot_rolled'), so there is no result row at draw time (no 'pending' value to write); the
 *       row is written at resolve. /host/members/settings is the MANAGER/OWNER-ONLY settings-write path for the
 *       draw/jackpot numbers (hosts are refused in code); /host/members/roster lets a host enable/disable a member.
 *       Because there is no session the Worker emits nothing to vp_session_events; the host + TV pair over the
 *       page Realtime broadcast channel ("vp-members-"+CODE), with the Worker the authoritative picker/writer.
 *       NO new infra and NO seed: reuses the members tables already in 01/02/03 and v_vp_prizes_given (which totals
 *       ONLY the 'claimed' members-draw rows). Host reads (roster/draws/results) are direct via RLS (03-security
 *       grants host SELECT on all four member tables); every write goes through this Worker (service_role).
 *   In every case: the Worker stays the ONLY writer, re-checks host JWT + venue
 *   staff + kill-switch, keeps secrets (correct_index, draw_order, rng_seed) out of
 *   every payload, and pushes to clients only by inserting a vp_session_events row.
 *
 * ASSUMPTIONS + THINGS TO KNOW
 *   - Supabase legacy HS256 JWTs (verified with SUPABASE_JWT_SECRET). If the project
 *     moves to asymmetric (ES256/JWKS) signing, swap verifyJwtHS256 for a JWKS verify;
 *     nothing else changes.
 *   - draw_order round-trips as a JSON array via PostgREST; we index it in JS (0-based
 *     slice), which matches the DB's 1-indexed draw_order[1..draw_index].
 *   - The state_version bump (emitEvent) and the ball draw (handleHostBall) are atomic
 *     Postgres functions (vp_emit_event, vp_draw_next_ball) via RPC, so concurrent
 *     Worker calls cannot collide. See venueplay-05-atomic-events.sql.
 *   - /session is IDEMPOTENT: if a live session already exists for the venue (the
 *     one-live-per-venue partial index), it is returned rather than erroring, so the
 *     host can re-tap Start / reload / re-pair safely.
 *   - plan_cap_at_start reads venueplay_founding.max_seats for independent venues,
 *     falling back to vp_venues.included_players for grouped venues, frozen at open.
 *   - Cards: exactly ONE ticket per player per game. SCHEMA LIMIT -- vp_cards has a
 *     unique index (game_id, player_id) plus vp_cards_one_per_player_game, so more
 *     than one card per player per game is IMPOSSIBLE without dropping that index.
 *     /host/game accepts cards_per_player and records the request in config, but
 *     deals one. Multi-card is a schema change (a later slice), flagged here, not faked.
 *   - Late joiners ARE handled now: GET /player/card deals a ticket on demand if the
 *     player has none for the running game (design 5.1), inside the same unique-index
 *     retry loop, so a patron who scans in mid-game still gets a valid ticket.
 *   - Winner persistence: bingo has no separate winners table -- the CONFIRMED
 *     vp_claims row is the durable winner (player, card, winning_cells, resolved_by,
 *     resolved_at). Confirming also finishes the game (vp_games.status='finished').
 *   - Kill-switch (assertVenueActive) is re-checked on /join, /player/card and
 *     /player/claim as well as the host routes. /snapshot is intentionally unchecked:
 *     read-only public projection, writes nothing metered.
 *   - /join and /player/claim are rate-limited and /join is soft-deduped using the
 *     salted ip_hash + device_hint. LIVE when env.RL exists, else warn-and-allow. The
 *     soft dedup reuses a device's player row within JOIN_DEDUP_TTL only, so two
 *     patrons sharing a NAT IP AND browser AND joining inside that window could be
 *     merged onto one row: a HUMAN DECISION on the TTL / a stronger device key.
 *   - Broadcast model: the pages ALSO mirror state over a Supabase client broadcast
 *     channel ("vp-"+join_code) for instant UX, but the Worker's DB writes are
 *     authoritative and re-derivable via /snapshot. The Worker additionally emits
 *     every change to the DB Realtime topic session:<id> via vp_session_events, so a
 *     future TV/host can move entirely onto that server-authoritative feed.
 *   - checkPattern covers one_line, two_lines, full_house. Custom jsonb masks later.
 *   - profanity filter is a minimal wordlist; extend before launch.
 * ===================================================================== */
