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
 *                                         increment_cents. (The draw opens the row as 'drawn'; this UPDATES it, so
 *                                         one draw is one row. See the schema note above handleMembersDraw.)
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
const BUILD = '11 Sep 2026, 21:05 · 9aef92c6';   // tools/stamp-workers.py, do not edit by hand
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
/* Bingo tickets must be on paper in these jurisdictions. See handleJoinInfo. */
const PAPER_BINGO_STATES = new Set(['SA', 'ACT', 'TAS']);
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
      /* HEALTH. This Worker had none, and that is how something can be quietly
         broken for days.

         PartyPlay's health check said "ok" while every photo upload was failing,
         because R2 is a BINDING and health only looked at secrets. Same shape of
         hole here, and this one is running a real venue: if the RL namespace goes
         missing the anti-abuse limiter drops to allow-mode silently, and player
         count is what a venue is BILLED on. If SUPABASE_JWT_SECRET goes missing
         no host can sign in at all.

         Names and booleans only. Never a value: this endpoint is public. */
      if (method === 'GET' && path === '/health')             return await handleHealth(env, json);

      if (method === 'POST' && path === '/session')            return await handleCreateSession(request, env, json);
      if (method === 'POST' && path === '/session/close')      return await handleSessionClose(request, env, json);
      if (method === 'POST' && path === '/join')               return await handleJoin(request, env, json);
      if (method === 'POST' && path === '/join/info')          return await handleJoinInfo(request, env, json);
      if (method === 'POST' && path === '/capture')            return await handleCapture(request, env, json);
      if (method === 'POST' && path === '/feedback')           return await handleFeedback(request, env, json);
      if (method === 'GET'  && path === '/feedback/tally')     return await handleFeedbackTally(request, env, json);
      if (method === 'POST' && path === '/report')             return await handleReport(request, env, json);
      if (method === 'GET'  && path === '/venue')              return await handleVenueLookup(request, env, json);
      /* The room server (see ROOM-SERVER.md). Both answer 503 without the ROOM
         binding, and every page falls back to Supabase Realtime on a 503, so a
         Worker deployed without the binding behaves exactly as it did before. */
      if (method === 'GET'  && path === '/room/ws')            return await handleRoomSocket(request, env, json);
      if (method === 'GET'  && path === '/room/presence')      return await handleRoomPresence(request, env, json);
      if (method === 'GET'  && path === '/venues/like')        return await handleVenueLike(request, env, json);
      if (method === 'POST' && path === '/venue/code/refresh')  return await handleVenueCodeRefresh(request, env, json);
      if (method === 'POST' && path === '/screen/reload')      return await handleScreenReload(request, env, json, await readJson(request));
      if (method === 'POST' && path === '/screen/command')     return await handleScreenCommand(request, env, json, await readJson(request));
      if (method === 'GET'  && path === '/admin/group-overage') return await handleGroupOverage(request, env, json);
      /* Broadcast signing (migrations 38 + 55). vp-sign.js has been loaded by every TV, phone and
         console since 20 Aug calling these three; they were never written, so every page fell back
         to send-unsigned / render-everything and the signing was decorative. */
      if (method === 'GET'  && path === '/venue/signing/public')  return await handleSigningPublic(request, env, json);
      if (method === 'POST' && path === '/host/signing/private')  return await handleSigningPrivate(request, env, json);
      if (method === 'POST' && path === '/host/signing/mint')     return await handleSigningMint(request, env, json);
      if (method === 'GET'  && path === '/play/live')          return await handlePlayLive(request, env, json);
      if (method === 'GET'  && path === '/screen')             return await handleScreen(request, env, json);
      if (method === 'POST' && path === '/host/game')          return await handleHostGame(request, env, json);
      if (method === 'POST' && path === '/host/game/pattern')  return await handleMusicPattern(request, env, json);
      if (method === 'POST' && path === '/host/trivia/set')                return await handleTriviaSet(request, env, json);
      if (method === 'POST' && path === '/host/trivia/set/delete')         return await handleTriviaSetDelete(request, env, json);
      if (method === 'GET'  && path === '/host/trivia/set/questions')      return await handleTriviaSetQuestions(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/add')      return await handleTriviaAdd(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/update')   return await handleTriviaUpdate(request, env, json);
      if (method === 'POST' && path === '/host/trivia/image-upload')       return await handleTriviaImageUpload(request, env, json);
      if (method === 'POST' && path === '/host/question/add-time')         return await handleHostAddTime(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/from-library') return await handleTriviaFromLibrary(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/search')       return await handleTriviaSearch(request, env, json);
      if (method === 'POST' && path === '/admin/trivia/submissions')           return await handleAdminSubmissions(request, env, json);
      if (method === 'POST' && path === '/admin/trivia/submissions/resolve')   return await handleAdminResolve(request, env, json);
      if (method === 'POST' && path === '/host/trivia/questions/remove')   return await handleTriviaRemove(request, env, json);
      if (method === 'POST' && path === '/host/overage/ack')   return await handleOverageAck(request, env, json);
      if (method === 'POST' && path === '/host/game/end')      return await handleGameEnd(request, env, json);
      if (method === 'POST' && path === '/host/ball')          return await handleHostBall(request, env, json);
      if (method === 'POST' && path === '/host/bingo/draw')      return await handleBingoDrawStart(request, env, json);
      if (method === 'POST' && path === '/host/bingo/ball')      return await handleBingoBall(request, env, json);
      if (method === 'POST' && path === '/host/bingo/fallback')  return await handleBingoFallback(request, env, json);
      if (method === 'POST' && path === '/host/play')          return await handleHostPlay(request, env, json);
      if (method === 'POST' && path === '/host/song/flag')      return await handleSongFlag(request, env, json);
      if (method === 'POST' && path === '/host/question')      return await handleHostQuestion(request, env, json);
      if (method === 'POST' && path === '/host/reveal')        return await handleHostReveal(request, env, json);
      if (method === 'POST' && path === '/host/draw')          return await handleHostDraw(request, env, json);
      if (method === 'POST' && path === '/host/draw/resolve')  return await handleDrawResolve(request, env, json);
      if (method === 'POST' && path === '/host/members/draw')         return await handleMembersDraw(request, env, json);
      if (method === 'POST' && path === '/host/members/draw/resolve') return await handleMembersResolve(request, env, json);
      if (method === 'POST' && path === '/host/members/settings')     return await handleMembersSettings(request, env, json);
      if (method === 'POST' && path === '/host/gaming/declare')       return await handleGamingDeclare(request, env, json);
      if (method === 'POST' && path === '/admin/sweep-sessions')      return await handleAdminSweep(request, env, json);
      if (method === 'POST' && path === '/host/members/roster')       return await handleMembersRoster(request, env, json);
      if (method === 'POST' && path === '/host/members/import')        return await handleMembersImport(request, env, json);
      if (method === 'POST' && path === '/host/members/remove')        return await handleMembersRemove(request, env, json);
      if (method === 'POST' && path === '/host/members/update')        return await handleMembersUpdate(request, env, json);
      if (method === 'POST' && path === '/host/members/draw-remove')   return await handleDrawRemove(request, env, json);
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

     THE TRIGGER IS SET AND IT WORKS. "0 17 * * *", 3am Brisbane, confirmed live on
     5 Sep 2026: session 9206e83c opened 6 Aug, collected 12 players across two separate
     occasions because nothing closed it, and this sweep ended it at 17:00:42 UTC on
     28 Aug, which is 03:00:42 Brisbane. Forty-two seconds after the cron fired.

     The lag was the DEPLOY, not the trigger. This handler landed in the repo on 18 Aug
     and the Workers go in by hand, so the first 3am run after the paste is what closed a
     session that had been open for 23 days. Nothing to fix here; the note that used to
     say the trigger had never been set was wrong and was read as evidence. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweepStaleSessions(env, null, true).then(function (r) {
      // A sweep whose query failed used to print exactly what a quiet night prints. Say which.
      if (r.error) { console.log('[sweep] FAILED to list stale sessions: ' + r.error); return; }
      console.log('[sweep] closed ' + r.closed + ', failed ' + r.failed + ', of ' + r.found + ' stale sessions');
    }));
  },
};

/* The sweep itself, so the nightly Cron Trigger and the button in HQ run the SAME code.
 * Closing a session is what bills an approved busy-night overage, so there must never be two
 * versions of this: one that bills and one that does not. */
/* WHAT TIME IS IT WHERE THE VENUE IS?

   Every venue closes at 3am ITS OWN time, not 3am Brisbane. A Sydney pub in daylight
   saving is an hour ahead of a Brisbane one, so a single national close would shut a
   NSW room at 2am local through summer, or leave a QLD one open until 4am. Dean, 11 Sep
   2026: "Can we do the close off state by state so its on the right time?"

   Intl is in the Workers runtime, so the offset comes from the tz database and daylight
   saving is handled for free. An unknown or missing timezone falls back to Brisbane,
   which is where this product started and the safest guess for an Australian venue.

   NOTE FOR WHOEVER READS THIS IN OCTOBER: on 11 Sep 2026 six venues were marked NSW
   while carrying Australia/Brisbane. Until DST starts on 5 October those two clocks
   agree, so the fault is invisible today and becomes an hour wrong that morning. The
   code below is right; the DATA needs checking. */
function venueLocalHour(tz) {
  try {
    const f = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz || 'Australia/Brisbane', hour: 'numeric', hour12: false,
    });
    return parseInt(f.format(new Date()), 10);
  } catch (e) {
    return parseInt(new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane', hour: 'numeric', hour12: false,
    }).format(new Date()), 10);
  }
}

/* atLocal3am: the nightly run. It closes EVERY unended session at a venue whose own
   clock has just passed 3am, however young that session is, because Dean asked for
   exactly that: "just close everything at 3am". The old twelve hour rule meant a lobby
   opened at 4pm survived the 3am run and lived another full day.

   Called without it (the HQ button) it keeps the age rule, because a human pressing
   Close now means the ones that have been sitting there, not tonight's room. */
async function sweepStaleSessions(env, staleHours, atLocal3am) {
  const STALE_HOURS = staleHours || 12;
  const cutoff = atLocal3am ? null
                            : new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();
  let rows = [];
  try {
    /* ASK FOR "NOT ENDED", NOT FOR A LIST OF STATUSES.

       This used to be status=in.(lobby,running,paused). A session at the-average-joe
       was opened on 26 Aug 2026, was never ended, and sat there until 10 Sep with four
       players who had actually played and three over the venue's cap. Its status was
       'cancelled', which is not in that list, so the sweep never even asked about it.
       Fifteen nightly runs, every one of them reporting a quiet night.

       'cancelled' is in the table's CHECK constraint and NOTHING IN THIS PRODUCT EVER
       WRITES IT. It is a state with no producer, which is exactly the kind that gets
       left out of a whitelist, and any status added later would inherit the same fault
       silently. ended_at is what "closed" means everywhere else that counts: the
       metering view, HQ, and check-stale-sessions.py. So ask for that. */
    rows = await sbGet(env, 'vp_sessions',
      'ended_at=is.null' + (cutoff ? ('&opened_at=lt.' + enc(cutoff)) : '') +
      '&select=id,venue_id,opened_at,status&order=opened_at.asc&limit=200');
  } catch (e) {
    return { found: 0, closed: 0, failed: 0, error: String((e && e.message) || e) };
  }
  if (!rows.length) return { found: 0, closed: 0, failed: 0 };

  /* Only the venues whose own clock says 3am. One read for the whole batch rather than
     one per session, because this runs every hour now. */
  if (atLocal3am) {
    const ids = Array.from(new Set(rows.map(function (r) { return r.venue_id; }).filter(Boolean)));
    let tzById = {};
    try {
      const vs = await sbGet(env, 'vp_venues',
        'id=in.(' + ids.map(enc).join(',') + ')&select=id,timezone');
      (vs || []).forEach(function (v) { tzById[v.id] = v.timezone; });
    } catch (e) { /* no timezones read: everything falls back to Brisbane below */ }
    rows = rows.filter(function (r) { return venueLocalHour(tzById[r.venue_id]) === 3; });
    if (!rows.length) return { found: 0, closed: 0, failed: 0 };
  }

  let closed = 0, failed = 0;
  for (const s of rows) {
    try {
      const session = await getSession(env, s.id);
      // Somebody closed it between listing and now. ended_at, not status, for the reason above.
      if (session.ended_at) continue;
      /* A NIGHT THAT RAN GETS BILLED. ANYTHING ELSE GETS CLOSED AND NOT BILLED.
         lobby, running and paused are the three states a real night passes through, and
         those bill exactly as they did before. A status outside that set reached here
         only because nothing in this product writes it, so nobody can say what it was
         meant to mean, and inventing an invoice from a state whose meaning is undefined
         is the worse of the two mistakes. Close it so it stops being invisible, say so
         in the log, and leave the money alone. */
      const ranANight = (session.status === 'lobby' || session.status === 'running' || session.status === 'paused');
      // Exactly the sequence handleSessionClose uses, so a swept night is billed and
      // recorded identically to one the host closed themselves.
      await sbPatch(env, 'vp_games', 'session_id=eq.' + enc(session.id) + '&status=eq.running',
        { status: 'finished', ended_at: new Date().toISOString() });
      await sbPatch(env, 'vp_sessions', 'id=eq.' + enc(session.id),
        { status: 'finished', ended_at: new Date().toISOString() });
      try { await emitEvent(env, session, 'session.closed', {}, 'system'); } catch (e2) {}
      if (ranANight) {
        try { await chargeNightOverage(env, session); }
        catch (e2) { await recordOverageCrash(env, session, e2, 'sweep'); }   // billing never blocks close
      } else {
        console.log('[sweep] closed ' + session.id + ' with status "' + session.status +
                    '" and did NOT bill it: nothing in this product writes that status, ' +
                    'so what it was meant to mean is not knowable from here.');
      }
      closed++;
    } catch (e) {
      failed++;
      console.log('[sweep] session ' + s.id + ' failed: ' + String((e && e.message) || e));
    }
  }
  return { found: rows.length, closed: closed, failed: failed };
}

/* POST /admin/sweep-sessions  (Gflam owner/accounts) : close the stale ones NOW.
 * The nightly Cron Trigger is the real answer and it IS set and working (see the scheduled
 * handler above). This stays because a paste can precede the next 3am run by a whole day, and
 * because a night that needs closing now should not wait for one. Same function, same billing,
 * same idempotency key, so a swept close is identical whichever way it is started. */
async function handleAdminSweep(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const admins = await sbGet(env, 'vp_platform_admins',
    'auth_user_id=eq.' + enc(authUserId) + '&role=in.(owner,accounts)&select=auth_user_id');
  if (!admins.length) return json({ error: 'Not authorised.' }, 403);
  const b = await readJson(request).catch(function () { return {}; });
  const hours = Math.max(1, Math.min(168, parseInt(b.stale_hours, 10) || 12));
  const r = await sweepStaleSessions(env, hours);
  return json({ ok: true, ...r, stale_hours: hours });
}

/* =====================================================================
 * ROUTE HANDLERS
 * ===================================================================== */

/* ------------------------------ POST /session ------------------------------
 * Host creates a lobby session for their venue. Auth is enforced twice: a valid
 * Supabase host JWT, then staff membership at the target venue.
 */
/* ONE GAME AT A TIME, PER VENUE.

   The schema allows a venue only one live session, and /session is an idempotent
   open, so a host who runs musical bingo and then starts BINGO does not get a new
   session: they get handed the musical one back, with its vp_games row still
   status 'running'. Everything downstream then reads the venue as being mid
   musical set. A player typing the venue code is sent to musical bingo, eleven
   songs in, while the host is drawing balls.

   That happened to a real room. Ending the previous game was left to the host
   remembering to press End game, and hosts do not, because from where they stand
   they already moved on.

   So starting a game now ends any OTHER format still running on that venue's live
   session. Same format is left alone: that is a host reloading, re-pairing a TV or
   starting round two, and killing their game would be far worse than the bug.
*/
/* BINGO HAS TO LEAVE THE SAME TRACE EVERY OTHER GAME LEAVES.

   Ending the old game is only half the fix, and the half that was missing is
   the one that would have kept biting.

   A phone resolves what to load in two different ways, and they do not agree:

     - typing the VENUE code looks for a RUNNING game. Ending the musical set is
       enough there: nothing is running, so the phone falls through to bingo.
     - typing the SESSION join code, the six characters that were on the TV all
       through the musical set, takes the latest game of ANY status. The musical
       row is still the latest one, finished or not, so that phone is sent right
       back into musical bingo.

   Trivia, musical and raffles all write a vp_games row. Broadcast bingo never
   has, so it leaves nothing for the second path to find. That is the actual
   root of tonight's fault, and ending games does not touch it.

   So when a bingo game starts, write the row bingo has always been missing.
   Now it is the latest game AND the running one, and both paths land on bingo.
   Idempotent: a report retry or a second start finds the row already there.
*/
async function markBroadcastGameLive(env, venueId, format) {
  try {
    const root = String(format || '').toLowerCase().split('_')[0].replace(/\d+$/, '');
    if (root !== 'bingo') return { ok: false };          // only bingo lacks a row
    const live = await sbGet(env, 'vp_sessions',
      'venue_id=eq.' + enc(venueId) + '&status=in.(lobby,running,paused)&select=id&order=created_at.desc&limit=1');
    if (!live.length) return { ok: false };              // no session, nothing to mark
    const sid = live[0].id;
    const existing = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(sid) + '&status=eq.running&select=id,format');
    for (const g of existing) {
      const r = String(g.format || '').toLowerCase().split('_')[0].replace(/\d+$/, '');
      if (r === 'bingo') return { ok: true, already: true };
    }
    const seqRows = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(sid) + '&select=seq&order=seq.desc&limit=1');
    const seq = (seqRows.length && seqRows[0].seq != null) ? (parseInt(seqRows[0].seq, 10) || 0) + 1 : 1;
    await sbInsert(env, 'vp_games', {
      session_id: sid,
      seq: seq,
      format: 'bingo90',      // the value migration 07 widened the check constraint to allow
      status: 'running',
      started_at: new Date().toISOString(),
    }, false);
    console.log('[one-game] bingo now has a game row on session ' + sid + ' seq ' + seq);
    return { ok: true, seq: seq };
  } catch (e) {
    // The game is on air either way. A missing row costs us the second lookup
    // path, not the night.
    console.log('[one-game] could not mark bingo live: ' + String((e && e.message) || e));
    return { ok: false, error: true };
  }
}

async function endOtherRunningGames(env, venueId, keepFormat) {
  try {
    const live = await sbGet(env, 'vp_sessions',
      'venue_id=eq.' + enc(venueId) + '&status=in.(lobby,running,paused)&select=id&order=created_at.desc&limit=1');
    if (!live.length) return { ended: 0 };
    const games = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(live[0].id) + '&status=eq.running&select=id,format');
    /* Formats are written more than one way in this codebase: a bingo game is
       reported as 'bingo' but its vp_games row is 'bingo90', and musical bingo
       is 'musical' in some places and 'musical_bingo' in others. Comparing the
       raw strings makes a game end ITSELF, which the tests caught. So reduce
       each to its leading word with any trailing digits stripped. */
    const root = function (f) {
      return String(f || '').toLowerCase().split('_')[0].replace(/\d+$/, '');
    };
    const keep = root(keepFormat);
    // No format means we cannot tell what is starting, and the safe answer to
    // "which games should I end" when you do not know is none of them.
    if (!keep) return { ended: 0 };
    const same = function (f) {
      const a = root(f);
      return !!a && a === keep;
    };
    const stale = games.filter(function (g) { return !same(g.format); });
    for (const g of stale) {
      await sbPatch(env, 'vp_games', 'id=eq.' + enc(g.id),
                    { status: 'finished', ended_at: new Date().toISOString() });
      console.log('[one-game] ended ' + g.format + ' on venue ' + venueId + ' because ' + keep + ' started');
    }
    return { ended: stale.length };
  } catch (e) {
    // Never fail the caller. The game starting matters more than the tidy-up,
    // and the sweep will catch anything left behind.
    console.log('[one-game] could not tidy up: ' + String((e && e.message) || e));
    return { ended: 0, error: true };
  }
}

/* GET /health. Public, unauthenticated, and polled by the release gate, the daily
   audit and anyone curious, so nothing in here may cost more than a few indexed
   round trips or grow with the number of venues. The clash sweep is the one
   exception and it is cached per isolate for sixty seconds in refreshVenueCodes. */
async function handleHealth(env, json) {
  // SUPABASE_JWT_SECRET is only needed while the project signs host logins with the
  // legacy shared secret. A project on asymmetric signing keys (Sydney) verifies hosts
  // against its published public keys instead, so it is reported, not required.
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'IP_HASH_SALT'];
  const missing = need.filter((k) => !env[k]);
  const hostLogin = env.SUPABASE_JWT_SECRET ? 'shared secret + public keys' : 'public keys only';
  const rl = !!env.RL;
  /* Two venues whose slugs hash to the same six characters. Reported here
     because a clash is invisible from everywhere else: both venues keep
     working normally except that the shared code stops resolving, and the
     codes are on printed signage, so somebody has to be told BEFORE the
     second venue's table talkers go to the printer. */
  let clashes = [];
  try { await refreshVenueCodes(env); clashes = _vcDupes || []; } catch (e) { clashes = []; }

  /* IS THE BROADCAST SIGNING ACTUALLY ON, and for how many venues?
     Realtime channels are named from a hash of the venue's PUBLIC slug and
     carry no RLS, so anyone with the anon key printed in every page could
     join a venue's channel and send on it: fake balls, a fake winner, mid
     game, on the TV and every phone. ECDSA signing closed that on 22 Aug.
     But enforcement is per venue and defaults OFF, so the code being
     present says nothing about whether any room is actually protected.
     That distinction is what made the original hole so hard to see: it
     read as closed in every file you would look at.
     Two numbers, so it takes a curl instead of a database session. */
  /* COUNTED BY THE DATABASE, NOT READ INTO THE WORKER. This used to pull every
   venue and every signing key into memory to count them: two full scans on a
   public, unauthenticated route, on every call, growing with every venue signed.
   At nineteen venues it took most of the route's 2.7 seconds; at three thousand
   it would be a free denial-of-service against the Worker's subrequest budget.
   Three HEAD requests with count=exact answer the same three numbers in one
   round trip each, whatever the table size. venue_id is the signing table's
   primary key, so its row count IS the number of venues holding a key. */
let oneTrip = null;
  try { oneTrip = await oneTripPresent(env); } catch (e) { oneTrip = null; }
let signing = null;
try {
  const [venues, withKey, enforcing] = await Promise.all([
    sbCount(env, 'vp_venues', 'select=id'),
    sbCount(env, 'vp_venue_signing_keys', 'select=venue_id'),
    sbCount(env, 'vp_venues', 'select=id&broadcast_enforce=is.true'),
  ]);
  signing = { venues, with_a_key: withKey, enforcing };
} catch (e) { signing = { error: 'could not be read' }; }

  return json({
    worker: 'venueplay-game',
    host_login: hostLogin,
    build: BUILD,
    ok: !missing.length && rl && !clashes.length,
    missing,
    rateLimiter: 'memory',   // per isolate since 8 Sep 2026; no store on the request path
    joinDedupCache: rl,
    room: !!env.ROOM && !roomOff(env),   // is the room server actually serving right now
    room_off: roomOff(env) || undefined, // the global off switch, if somebody has thrown it
    one_trip: oneTrip,       // which of migrations 71/72/73 this database really has
    broadcast_signing: signing,
    venue_code_clashes: clashes.length,
    venue_code_clash_detail: clashes.length ? clashes.slice(0, 5) : undefined,
    warning: clashes.length
      ? ('Two venues share a join code (' + clashes.map(function (c) { return c.slugs.join(' / '); }).join('; ') +
         '). That code is refused for both until one is re-slugged. Do not print signage for either.')
      : (rl ? undefined
            : 'The RL KV namespace is not bound. The join dedup cache is off (the device_id column still dedups, one database read slower), and player counts are what venues are billed on.')
  }, missing.length ? 503 : 200);
}

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
    /* Reusing a session is exactly the moment a venue can end up with two games
       believing they are on air. If the console told us which format it is
       starting, end any other one still running before we hand the session back. */
    if (b.format) await endOtherRunningGames(env, venueId, b.format);
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
  /* THE VENUE'S CODE, NOT A NEW ONE. A fresh random code per session is why the
     wall changed codes when a lobby opened, and why nothing could be printed.
     If the venue somehow has no code (migration 68 not run), fall back to minting
     one so a night can still start - a missing column must not stop a game. */
  const ownCode = await venueJoinCode(env, venueId);
  let session = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const joinCode = (attempt === 0 && ownCode) ? ownCode : genCode(6);
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
  let roomCode = '';   // set only when the code typed was the venue code and a session is live
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
  } else {
    venueId = await venueByCode(env, code);   // broadcast bingo has no session: resolve by venue code
    /* ONE CODE PER VENUE, whatever is on tonight.
       The venue code is a pure hash of the slug, so it never changes and can go on a table
       talker or be printed on the wall. Bingo needs nothing more, because host, TV and phones
       all meet on that code. Trivia and musical open a session with a RANDOM join code, so a
       phone arriving on the venue code used to land on the bingo channel and wait forever.
       Resolve the venue's live session here too, and hand back its real join code so the player
       page can move the phone to the right room. Nothing to type twice, nothing to reprint. */
    if (venueId) {
      const live = await sbGet(env, 'vp_sessions',
        'venue_id=eq.' + enc(venueId) + '&status=in.(lobby,running,paused)&select=id,join_code&order=created_at.desc&limit=1');
      if (live.length) {
        /* A RUNNING game only. This deliberately does NOT match the session branch above, which
           takes the latest game of any status so that a code typed between rounds still resolves.
           Here the code typed was the venue's PERMANENT one, which is also bingo's channel, so
           the bar for sending a phone somewhere else has to be much higher: proof a game is
           actually on. A session left open from a previous night otherwise sent an entire bingo
           room into a dead trivia or musical room they could not get back out of, and minted a
           metered player row against the stale session for every one of them. Same rule as
           /play/live, which is the other half of this pair and always had it right. */
        const g = await sbGet(env, 'vp_games',
          'session_id=eq.' + enc(live[0].id) + '&status=eq.running&select=format&order=seq.desc&limit=1');
        if (g.length) {
          format = String(g[0].format || '');
          // Only worth handing back when it actually differs, so bingo is untouched.
          if (live[0].join_code && live[0].join_code !== code) roomCode = live[0].join_code;
        }
      }
    }
  }
  if (!venueId) return json({ collect: null, format: '' }); // unknown code; join screen falls back to name only
  const rows = await sbGet(env, 'vp_venue_settings',
    'venue_id=eq.' + enc(venueId) + '&select=collect_first_name,collect_last_name,collect_postcode,collect_email,collect_mobile,collect_marketing_optin&limit=1');
  const cfg = (rows && rows[0]) || {};
  /* The venue's NAME, so the join screen can say who is asking for these details. A collection
     notice that cannot name the recipient is not much of a notice. Name only: no slug, no id, no
     other venue data, so this stays what it has always been, a public lookup for one join code. */
  let venueName = '';
  let paperBingo = false;
  /* THE CHANNEL THE ROOM IS ON.
     Bingo's broadcast channel is named from a hash of the slug: the television and
     the console derive it with no round trip, which is what lets a bingo night
     survive this Worker being down. A phone, though, connects to a channel named
     from whatever code was TYPED, and since migration 68 the typed code is the
     issued join_code, which an owner can change. Once changed, every phone in the
     room sat on an empty channel while the wall called balls. So tell the phone
     where the room actually is. It is the hash of a public slug that /venue already
     returns, so nothing new is exposed. */
  let channel = '';
  try {
    const vrows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=name,au_state,slug&limit=1');
    if (vrows && vrows[0] && vrows[0].name) venueName = String(vrows[0].name);
    if (vrows && vrows[0] && vrows[0].slug) channel = fnvVenueCode(vrows[0].slug);
    /* PAPER-TICKET STATES. Three jurisdictions still expect a printed ticket in the player's hand
       for bingo, so a phone must not show one:
         SA  - the rules recognise only physical bingo sheets bought from a licensed supplier
         ACT - housie Model Rules r12 bar players from holding electronic devices in the playing area
         TAS - the rules are written around a printed card the supervisor collects to verify a win
       Decided HERE and not in the console, because a venue must not be able to route around it by
       opening the phone page directly. The rest of the night is unaffected: the host still calls,
       the board still shows, players just mark paper. */
    /* ONLY FOR BINGO. This used to be decided from the state alone, ignoring the format, and
       play.html acts on it by wiping the page and printing "tonight you play on paper". So in
       SA, the ACT and Tasmania a punter typing the code for a TRIVIA night had their phone
       blanked and could not join anything. Trivia is a game of skill, is not gaming at all, and
       has no ticket to print: the whole product says so. An unknown format means bingo here,
       because broadcast bingo has no session and so never resolves one. */
    const paperFormat = !format || format.indexOf('bingo') === 0 || format.indexOf('musical') === 0;
    if (paperFormat && vrows && vrows[0] && PAPER_BINGO_STATES.has(String(vrows[0].au_state || '').toUpperCase())) {
      paperBingo = true;
    }
  } catch (e) { /* the notice falls back to "the venue you are playing at" */ }
  return json({ format: format, room_code: roomCode, channel: channel, venue_name: venueName, paper_bingo: paperBingo, collect: {
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
let _vcMap = null, _vcAt = 0, _vcHashMap = {}, _vcMapAll = {}, _vcSuspended = {};
function fnvVenueCode(slug) {
  let s = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, ''), h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const A = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'; let out = '', x = h || 1;
  for (let j = 0; j < 6; j++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out += A[x % A.length]; }
  return out;
}
/* EVERY VENUE'S CODE HAS TO BE ITS OWN.

   The code is a hash of the slug, so two different venues CAN land on the same six
   characters. This map used to be built with a plain assignment, which means the
   second venue quietly overwrote the first and every phone typing that code went to
   the wrong pub: the wrong game, and a marketing opt-in written against the wrong
   venue's list. Nothing anywhere would have said so.

   It is not a hypothetical for much longer. Six venues is one chance in about
   thirty thousand; five thousand venues is better than even money. Signage carries
   these codes, so the answer cannot be to change one after the fact.

   So a clash is recorded rather than resolved. An ambiguous code stops working for
   BOTH venues, which is a phone saying "check the code" instead of a room joining
   somebody else's night, and the count is reported by /health so the release check
   can watch it and Dean gets told before a sign is printed. */
let _vcDupes = [];
async function venueByCode(env, code, opts) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[ACDEFGHJKMNPQRSTUVWXYZ2345679]{6}$/.test(code)) return null;
  /* A SUSPENDED VENUE STILL EXISTS. Every caller that spends money (join, capture,
     report, signing) wants a suspended venue to read as absent, and that is the
     default. The television and /play/live are different: they need to know the
     venue is there AND suspended, so they can say so instead of telling the room
     the venue does not exist. Before this flag the suspended branch in /play/live
     could never run, because this function had already answered null. */
  const includeSuspended = !!(opts && opts.includeSuspended);

  /* ASK FOR THE ONE ROW. DO NOT BUILD A MAP OF EVERY VENUE TO ANSWER IT.
   *
   * This used to call refreshVenueCodes first, which reads EVERY venue in the
   * table. A Cloudflare isolate starts with that map empty, so every fresh
   * isolate paid for a full table scan before it could answer, and a burst of
   * traffic spawns a lot of isolates. On 8 Sep a ramp at fifty requests a second
   * measured a median of 413ms and a 95th percentile of ELEVEN SECONDS with no
   * errors at all: almost everything fine, a few requests scanning the table.
   * It also gets worse with every venue signed, which is the wrong direction for
   * something on the path a television takes.
   *
   * Migration 68 put a unique index on join_code, so this is one indexed row and
   * two venues cannot hold the same code - the ambiguity the map existed to
   * catch is now impossible by constraint rather than by sweep. limit=2 anyway,
   * because trusting a constraint you have not checked is how the first version
   * of this went wrong.
   *
   * The map survives for two things that are not on this path: venues whose
   * join_code is still null because migration 68 has not reached them, and the
   * clash count /health reports. */
  const hit = await sbGet(env, 'vp_venues',
    'join_code=eq.' + enc(code) + (includeSuspended ? '' : '&status=neq.suspended') + '&select=id&limit=2').catch(() => null);
  if (hit && hit.length === 1) return hit[0].id;
  if (hit && hit.length > 1) return null;          // should be impossible; refuse rather than guess

  /* Nothing stored under that code. It may still be a venue that predates the
     migration and is only reachable through the derived code, so fall back to
     the map - which is the slow path now, taken once per isolate, and only for
     a code that would otherwise have failed. */
  await refreshVenueCodes(env);
  const legacy = (includeSuspended ? _vcMapAll : _vcMap)[code];
  if (legacy && legacy !== AMBIGUOUS) return legacy;

  /* THE CODE A SCREEN DERIVES, NOT THE CODE A VENUE WAS ISSUED.

     tv.html has no round trip at boot: it hashes its slug into six characters and
     uses that as the broadcast channel AND as the code it polls /venue with every
     thirty seconds. The console, and every bingo phone that arrives off a table
     talker (/play?venue=slug), do the same, which is why bingo survives a Worker
     outage: nothing in the room needs this Worker to agree on a channel.

     Migration 68 made the ISSUED code a column the owner can change. The two were
     equal for every venue that existed (the backfill made them so), which is how
     this went unnoticed: the moment an owner pressed Change code, the screen's
     hashed code stopped resolving here, the poll answered exists:false twice, the
     wall showed "not linked to an account" and forgot its venue, and every phone
     off a table talker lost its identity claim, so the night went unmetered.
     Nothing in the console looked wrong. The Average Joe's two codes are identical
     today, so this has not happened to them yet.

     So BOTH codes name the venue: the issued one (one indexed row, above) and the
     derived one (this map). The derived code is not a secret an owner can revoke,
     because it is a hash of a slug that is in the venue's public URL; Change code
     changes the code printed in the room, and the channel stays put. */
  const derived = _vcHashMap[code];
  if (!derived || derived === AMBIGUOUS) return null;
  if (!includeSuspended && _vcSuspended[derived]) return null;
  return derived;
}

const AMBIGUOUS = '__two_venues__';
/* THE VENUE'S OWN CODE, ISSUED ONCE.
 *
 * Two codes used to exist and both were wrong. The screen code was a HASH of the
 * slug, so two unrelated venues can land on the same six characters (about 0.75%
 * likely somewhere at 3,000 venues, 3% at 6,000, 8% at 10,000) and the only
 * defence was to refuse BOTH until somebody re-slugged one. The player code was
 * random and NEW EVERY SESSION, so nothing printable was ever right for long and
 * the wall changed codes the moment a lobby opened.
 *
 * Migration 68 gives each venue one code it owns: unique by constraint rather
 * than by luck, independent of the slug so correcting a slug does not invalidate
 * a table talker, and the same code the console shows and a player types.
 *
 * The BROADCAST CHANNEL is deliberately still derived from the slug and is not
 * this. It is plumbing nobody sees, and deriving it is what lets a TV and a
 * console find each other with no round trip - which is why bingo survives a
 * Worker outage. It was never secret either: the algorithm is in public page
 * JavaScript, so anyone can compute it. Broadcast SIGNING is the protection
 * there, not obscurity.
 */
async function venueJoinCode(env, venueId) {
  const rows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=join_code,slug&limit=1')
    .catch(() => null);
  const v = rows && rows[0];
  if (!v) return null;
  // Fall back to the legacy hash if migration 68 has not run yet, so pasting this
  // Worker before the migration cannot leave a venue with no code at all.
  return v.join_code || (v.slug ? fnvVenueCode(v.slug) : null);
}

async function refreshVenueCodes(env) {
  const now = Date.now();
  if (_vcMap && now - _vcAt <= 60000) return;
  /* A suspended venue cannot run a game, so it has no business holding a code -
     and before this it was still taking up one of the 5,000 slots. */
  /* Suspended venues are read and then kept OUT of the issued-code map, rather
     than filtered in the query, because the screen index below needs them: a
     suspended venue's television must still know which venue it is. */
  const rows = await sbGetAll(env, 'vp_venues',
    'slug=not.is.null&select=id,slug,join_code,status');
  const map = {}, seen = {}, dupes = [], hashMap = {}, hashSeen = {}, all = {}, susp = {};
  for (const v of rows) {
    if (!v || !v.slug) continue;
    /* The derived code, for every venue whatever its status. Two slugs CAN hash
       alike (that is why the issued code exists), so the same clash rule applies. */
    const h = fnvVenueCode(v.slug);
    if (hashMap[h] && hashSeen[h] !== v.slug) hashMap[h] = AMBIGUOUS;
    else { hashMap[h] = v.id; hashSeen[h] = v.slug; }
    if (v.join_code) all[v.join_code] = v.id;
    if (v.status === 'suspended') { susp[v.id] = true; continue; }
    /* THE CODE IS THE ONE THE VENUE WAS ISSUED, not the one we can derive.

       This used to hash the slug. Migration 68 made the code a column the venue
       OWNS - unique by constraint, changeable by the owner - and the backfill set
       it to the same hash, so every existing venue kept working and nothing looked
       wrong. The moment an owner pressed "Change code", though, the console showed
       them the new code and this map still answered to the old one: the code on
       their screen was refused and the code they had just replaced still let people
       in. A test only catches that if it uses a join_code that is NOT the hash. */
    const c = v.join_code || fnvVenueCode(v.slug);
    if (map[c] && seen[c] !== v.slug) {
      map[c] = AMBIGUOUS;
      dupes.push({ code: c, slugs: [seen[c], v.slug] });
      console.log('[venue-code] CLASH on ' + c + ': ' + seen[c] + ' and ' + v.slug +
                  '. Both are refused until one venue is re-slugged.');
      continue;
    }
    map[c] = v.id; seen[c] = v.slug;
  }
  _vcMap = map; _vcAt = now; _vcDupes = dupes; _vcHashMap = hashMap; _vcMapAll = all; _vcSuspended = susp;
}

/* Opt-in capture for a broadcast game. Anon; best-effort. Stores ONLY the fields the venue's
   settings allow (which migration 21 already forces off for unapproved accounts), always keyed
   by venue_id, never by name. Unknown code = silently ignored so a player is never blocked. */
/* Did this venue have a game running in the last few hours? The bingo console posts a report row
   at game start and patches the same row at the end, so an open-ended row (or one that ended very
   recently, because people fill the form as the room empties) means a real night is under way.
   Deliberately generous, and it FAILS OPEN: if this lookup errors we say yes, because refusing a
   genuine opt-in to be strict about a forgery is the wrong way round. */
async function venueHasGameOpen(env, venueId) {
  try {
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const rows = await sbGet(env, 'vp_game_reports',
      'venue_id=eq.' + enc(venueId) + '&started_at=gte.' + enc(since) + '&select=id&limit=1');
    return !!(rows && rows.length);
  } catch (e) { return true; }
}

/* ------------------------------ POST /feedback ---------------------------
 * How was that? One tap, three options, from the room or from the host.
 *
 * Anonymous on purpose and it stores NOTHING about who tapped: no name, no
 * device id, no player id, no free text. A rating is not worth the consent
 * conversation any of those would start. That also means there is nothing here
 * worth forging - the worst somebody with the venue code can do is tell us
 * their own night was good - so this asks for no token from a player, only a
 * rate limit so a bored punter cannot sit there tapping.
 *
 * The HOST's answer is different: it goes in the same table under source
 * 'host' and is read separately, because the host knows whether the tech
 * worked while the room knows whether it was fun. That one needs the host's
 * JWT, or a rating from the venue's own staff would be worth nothing.
 */
const FEEDBACK_MAX_PER_IP = 12;

async function handleFeedback(request, env, json) {
  const b = await readJson(request);
  const rating = parseInt(b.rating, 10);
  if (!(rating >= 1 && rating <= 3)) return json({ error: 'rating must be 1, 2 or 3' }, 400);
  const source = b.source === 'host' ? 'host' : 'player';

  const ipHash = await abuseIpHash(request, env);
  if (ipHash) {
    const rl = await rateLimit(env, 'fb:ip:' + ipHash, FEEDBACK_MAX_PER_IP, 300);
    if (!rl.ok) return json({ ok: true, throttled: true });   // never an error to a punter
  }

  const code = String(b.code || '').trim().toUpperCase();
  let venueId = null, sessionId = null;
  if (code) {
    const live = await sbGet(env, 'vp_sessions',
      'join_code=eq.' + enc(code) + '&status=in.(lobby,running,paused)&select=id,venue_id&limit=1');
    if (live.length) { venueId = live[0].venue_id; sessionId = live[0].id; }
    else venueId = await venueByCode(env, code);
  }
  if (b.session_id) { assertUuid(String(b.session_id), 'session_id'); sessionId = String(b.session_id); }

  if (source === 'host') {
    // A venue rating its own night has to be the venue.
    const authUserId = await verifyHostJwt(request, env);
    if (!venueId) return json({ error: 'Unknown venue' }, 404);
    await requireStaff(env, authUserId, venueId);
  }
  if (!venueId) return json({ ok: true, ignored: 'unknown code' });   // silent, like /capture

  await sbInsert(env, 'vp_game_feedback', {
    venue_id: venueId,
    session_id: sessionId || null,
    game_id: b.game_id ? String(b.game_id) : null,
    format: b.format ? String(b.format).slice(0, 24) : null,
    source,
    rating,
  });
  return json({ ok: true });
}

/* What the host sees the moment the game ends: the room's answer, live.
 * Public and countable only - no rows, no identities, nothing to mine. */
async function handleFeedbackTally(request, env, json) {
  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get('session') || '').trim();
  if (!sessionId) return json({ ratings: 0 });
  assertUuid(sessionId, 'session');
  const rows = await sbGet(env, 'vp_game_feedback',
    'session_id=eq.' + enc(sessionId) + '&source=eq.player&select=rating&limit=2000');
  const n = rows.length;
  const loved = rows.filter((r) => r.rating === 3).length;
  const ok = rows.filter((r) => r.rating === 2).length;
  return json({
    ratings: n,
    loved,
    ok,
    poor: n - loved - ok,
    positive_pct: n ? Math.round((100 * (loved + ok)) / n) : null,
  });
}

async function handleCapture(request, env, json) {
  const b = await readJson(request);
  const ipHash = await abuseIpHash(request, env);
  if (ipHash) {
    const rl = await rateLimit(env, 'capture:ip:' + ipHash, CAPTURE_MAX_PER_IP, 60);
    if (!rl.ok) return json({ error: 'Too many sign-ups from this network right now' }, 429);
  }
  /* WHO IS THIS? A player token is minted by /join against a SESSION code, which exists only
     while that game runs and is only ever on the venue's own screen, so holding one is evidence
     of having been in the room. The venue code in the body is derived from the venue's public
     slug and proves nothing at all: that is the whole reason this endpoint was forgeable.
     A capture with no token is still STORED (never lose a real punter's details) but is marked
     unverified below and stays out of the export the venue mails. */
  let player = null;
  try { player = await verifyPlayerToken(request, env); } catch (e) { player = null; }

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
  /* PROVENANCE, because this cannot be authenticated yet and pretending otherwise would be worse.
     Broadcast bingo has no session and no player token, so there is genuinely nothing to check
     beyond a venue code derived from a public slug: anyone can post a forged capture, including a
     forged marketing_optin with a consent timestamp, which is a Spam Act problem for the VENUE
     rather than for us. Until the broadcast signing work lands (migration 38, designed and never
     built), record where each row came from so a poisoned list can be identified and removed
     rather than silently mailed. Hashed, so this is not itself new personal data. */
  if (ipHash) row.source_ip_hash = ipHash;
  /* Was a game actually on? This is the only thing about a capture we can check.
     /capture authorises on a venue code derived from the venue's PUBLIC slug, so anyone who knows
     a venue exists can post one, including a marketing_optin with a consent timestamp for someone
     who never consented. Nothing on the phone's side can fix that. But the console posts a report
     row the moment a game starts, so we can ask whether this venue was mid-game when the capture
     landed. A real punter fills the form in the room during bingo; a forged one turns up at 4am.
     Marked, not rejected: the row is still stored either way, and the export view is what leaves
     the unmarked ones out, so a console whose report failed to send never costs a venue real
     opt-ins that they can go and look at. */
  /* A joined player IS in the room, by definition, so a token is the strongest evidence there is
     and it settles the question on its own. Without one we fall back to the weaker check (was a
     game even running) and, since a real phone always holds a token now, the honest reading of a
     token-less capture is "cannot vouch for this": marked, kept, excluded from the export. */
  if (player) {
    row.player_id = player.id;
    row.during_game = true;
  } else {
    row.during_game = false;
  }
  /* The column may not be migrated yet, and a player's details must NEVER be lost to a schema
     mismatch: PostgREST rejects the whole insert on an unknown column. So try it, and if that is
     the only thing wrong, store the capture without it. Order of deploy and migration then does
     not matter, which is the lesson from the empty HQ venue list. */
  try {
    await sbInsert(env, 'vp_captures', row, false);
    return json({ ok: true, stored: true });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (msg.indexOf('source_ip_hash') === -1 && msg.indexOf('during_game') === -1 &&
        msg.indexOf('player_id') === -1 && msg.indexOf('42703') === -1) throw e;
    // Migration 47 or 58 has not run yet. A player's details must never be lost to a schema
    // mismatch, so drop the columns the database does not know about and store the capture.
    delete row.source_ip_hash;
    delete row.during_game;
    delete row.player_id;
  }
  if (!row.first_name && !row.last_name && !row.email && !row.mobile) return json({ ok: true, stored: false });
  await sbInsert(env, 'vp_captures', row, false);
  return json({ ok: true, stored: true });
}

/* Does this screen code map to a real venue? Lets the TV warn a venue that mistyped its
   screen link (/tv?venue=...) instead of silently sitting on a dead channel. */

/* ===========================================================================
 * BROADCAST SIGNING (migrations 38 + 55)
 *
 * Broadcast games meet on a Supabase Realtime channel named from the venue's
 * PUBLIC slug, and the anon key is printed in every page, so the channel was
 * never a secret and anyone could shout into it: a ball that was never called,
 * a winner who never won, a TV pushed back to ads mid-round. There is no game
 * server to appeal to for broadcast bingo, so authenticity has to travel with
 * the message.
 *
 * Each venue gets one ECDSA P-256 keypair. The private half goes only to a
 * signed-in host who is staff at that venue; the public half goes to anyone,
 * because verifying is the entire point. The KEYPAIR IS MINTED IN THE BROWSER:
 * the Workers runtime cannot generateKey for ECDSA, so the console makes it and
 * posts both halves here. This Worker only stores and serves.
 *
 * kid is derived from the public key rather than stored, so there is no extra
 * column to migrate and two Workers can never disagree about a key's name.
 * ======================================================================== */

/* A short, stable name for a public key: the first 12 hex of SHA-256 over its
   curve point. Informational only (vp-sign.js excludes _kid from the signed
   bytes), but it makes a rotation visible in a log. */
async function signingKid(pub) {
  try {
    return (await sha256Hex('vpkid:' + String(pub.crv || '') + ':' + String(pub.x || '') + ':' + String(pub.y || ''))).slice(0, 12);
  } catch (e) { return null; }
}

/* Store only what we can prove is an ECDSA P-256 JWK of the half we asked for.
   Without this the table becomes a place a signed-in host can park arbitrary
   JSON, and a malformed key would fail to import on every TV in the venue,
   silently, for as long as it sat there. */
function validJwk(j, wantPrivate) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  if (j.kty !== 'EC' || j.crv !== 'P-256') return false;
  if (typeof j.x !== 'string' || typeof j.y !== 'string') return false;
  if (!j.x || !j.y || j.x.length > 128 || j.y.length > 128) return false;
  if (wantPrivate) { if (typeof j.d !== 'string' || !j.d || j.d.length > 128) return false; }
  else if (j.d != null) return false;    // a public half must NOT carry the private scalar
  return true;
}

/* Resolve the venue a RECEIVER is asking about. A TV knows its slug, a phone in
   a broadcast game knows only the venue code it derived from that slug, and a
   phone in a server-backed format knows its session id. All three are public
   identifiers, which is fine: this route serves the public half only. */
async function signingVenueForReceiver(env, url) {
  const venue = String(url.searchParams.get('venue') || '').trim().toLowerCase().slice(0, 80);
  if (venue) {
    if (!/^[a-z0-9-]+$/.test(venue)) return null;
    const rows = await sbGet(env, 'vp_venues', 'slug=eq.' + enc(venue) + '&select=id,broadcast_enforce&limit=1');
    return (rows && rows[0]) || null;
  }
  const code = String(url.searchParams.get('code') || '').trim();
  if (code) {
    const id = await venueByCode(env, code);
    if (!id) return null;
    const rows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(id) + '&select=id,broadcast_enforce&limit=1');
    return (rows && rows[0]) || null;
  }
  const session = String(url.searchParams.get('session') || '').trim();
  if (session) {
    if (!/^[0-9a-fA-F-]{36}$/.test(session)) return null;
    const ss = await sbGet(env, 'vp_sessions', 'id=eq.' + enc(session) + '&select=venue_id&limit=1');
    const vid = ss && ss[0] && ss[0].venue_id;
    if (!vid) return null;
    const rows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(vid) + '&select=id,broadcast_enforce&limit=1');
    return (rows && rows[0]) || null;
  }
  return null;
}

/* GET /venue/signing/public?venue=<slug> | ?code=<venue code> | ?session=<id>
   Public by design. Returns the enforce flag even when no key exists yet, so a
   screen that booted before the venue's first host login knows to keep polling
   rather than settle into fail-open forever. */
async function handleSigningPublic(request, env, json) {
  const url = new URL(request.url);
  const venue = await signingVenueForReceiver(env, url);
  if (!venue) return json({ exists: false });
  const enforce = !!venue.broadcast_enforce;
  const rows = await sbGet(env, 'vp_venue_signing_keys',
    'venue_id=eq.' + enc(venue.id) + '&select=public_jwk&limit=1');
  const key = rows && rows[0];
  if (!key || !key.public_jwk) return json({ exists: false, enforce: enforce });
  return json({
    exists: true,
    enforce: enforce,
    public_jwk: key.public_jwk,
    kid: await signingKid(key.public_jwk),
  });
}

/* Shared front door for the two host routes: a valid host JWT, a real slug, and
   staff membership at THAT venue. requireStaff also enforces the kill-switch, so
   a suspended venue cannot mint or fetch a key. */
async function signingHostVenue(request, env) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const slug = String((b && b.slug) || '').trim().toLowerCase().slice(0, 80);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw httpError(400, 'Missing venue');
  const rows = await sbGet(env, 'vp_venues', 'slug=eq.' + enc(slug) + '&select=id,broadcast_enforce&limit=1');
  const venue = rows && rows[0];
  if (!venue) throw httpError(404, 'Venue not found');
  await requireStaff(env, authUserId, venue.id);
  return { venue: venue, body: b };
}

/* POST /host/signing/private  { slug }
   Hands the venue's private half to a host who has passed the staff check. When
   there is no key yet it says so and the console mints one (next route), because
   the Workers runtime cannot generate an ECDSA key itself. */
async function handleSigningPrivate(request, env, json) {
  const { venue } = await signingHostVenue(request, env);
  const rows = await sbGet(env, 'vp_venue_signing_keys',
    'venue_id=eq.' + enc(venue.id) + '&select=public_jwk,private_jwk&limit=1');
  const key = rows && rows[0];
  const enforce = !!venue.broadcast_enforce;
  if (!key) return json({ has_key: false, enforce: enforce });
  return json({
    has_key: true,
    enforce: enforce,
    private_jwk: key.private_jwk,
    public_jwk: key.public_jwk,
    kid: await signingKid(key.public_jwk),
  });
}

/* POST /host/signing/mint  { slug, public_jwk, private_jwk }
   Stores a keypair the console generated. Two hosts opening their consoles at
   the same moment would both mint; the venue_id primary key means the second
   insert loses, and rather than fail we RE-READ and return whatever the table
   settled on, so both consoles converge on one key instead of signing with two.
   An existing key is never overwritten: rotation is deleting the row on purpose,
   not a race. */
async function handleSigningMint(request, env, json) {
  const { venue, body } = await signingHostVenue(request, env);
  const pub = body && body.public_jwk;
  const priv = body && body.private_jwk;
  if (!validJwk(pub, false) || !validJwk(priv, true)) {
    return json({ error: 'That is not an ECDSA P-256 key pair.' }, 400);
  }
  if (pub.x !== priv.x || pub.y !== priv.y) {
    return json({ error: 'The two halves are not the same key.' }, 400);
  }
  const existing = await sbGet(env, 'vp_venue_signing_keys',
    'venue_id=eq.' + enc(venue.id) + '&select=public_jwk,private_jwk&limit=1');
  if (!(existing && existing.length)) {
    try {
      await sbInsert(env, 'vp_venue_signing_keys', {
        venue_id: venue.id, public_jwk: pub, private_jwk: priv,
      }, false);
    } catch (e) {
      // 409 on the primary key: another console minted first. Fall through and read theirs.
      const msg = String((e && e.message) || e);
      if (msg.indexOf('409') === -1 && msg.indexOf('duplicate') === -1 && msg.indexOf('23505') === -1) throw e;
    }
  }
  const rows = await sbGet(env, 'vp_venue_signing_keys',
    'venue_id=eq.' + enc(venue.id) + '&select=public_jwk,private_jwk&limit=1');
  const key = rows && rows[0];
  if (!key) return json({ error: 'Could not store the signing key.' }, 502);
  return json({
    has_key: true,
    enforce: !!venue.broadcast_enforce,
    private_jwk: key.private_jwk,
    public_jwk: key.public_jwk,
    kid: await signingKid(key.public_jwk),
  });
}


/* WHICH GRAND HOTEL DID YOU MEAN?
   ---------------------------------------------------------------------------
   Seven per cent of Australian venue names are shared, so new slugs carry the
   postcode: the-grand-hotel-4210. Somebody setting up a screen types what is
   over the door, the-grand-hotel, and gets "not linked to an account" with no
   idea that twenty-two other Grand Hotels are the reason the plain name was not
   free. Telling them to guess a postcode on a TV remote is not an answer.

   So the screen can ask what a typed slug ALMOST matches and offer the list.

   WHAT THIS DELIBERATELY WILL NOT DO. It will not hand over the venue list.
   Anyone can already confirm one slug at a time through /screen, but a search
   that answers a bare letter would turn that into a download of every customer
   we have. So:

     * the typed slug must be at least six characters, which means you have to
       know most of a venue's name before this will say anything at all,
     * it only matches that exact slug or that slug followed by a dash, never a
       substring, so "hotel" finds nothing and "the-grand-hotel" finds the
       Grand Hotels and no other pub,
     * at most twenty-five come back, and only the four fields needed to tell
       them apart on a wall: name, suburb by postcode, state, and the slug to
       click. */

/* POST /venue/code/refresh   { venue_id }   (owner or manager, never a host)
 *
 * A venue's code is printed on table talkers, so it must not change on a whim -
 * a host reprinting the room because they fancied a new code is a support call.
 * But it has to be changeable deliberately: a code can leak, or a venue can
 * simply want a new one. So this sits with the people who own the account.
 *
 * Refusing a HOST is the point of this endpoint, not an afterthought.
 */
async function handleVenueCodeRefresh(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const venueId = String(b.venue_id || '').trim();
  if (!venueId) return json({ error: 'Missing venue_id' }, 400);
  assertUuid(venueId, 'venue_id');

  const staff = await requireStaff(env, authUserId, venueId);   // staff at THIS venue (also kill-switch)
  const role = String((staff && staff.role) || '').toLowerCase();
  if (role !== 'owner' && role !== 'manager') {
    return json({ error: 'Only the account owner or a manager can change the venue code. It is printed in the room, so a host cannot.' }, 403);
  }

  /* Unique across every venue, not just the live ones: a cancelled venue's code
     must never be handed to somebody else while the old table talkers are still
     on a wall somewhere. The unique index is what actually enforces it; this
     retries on the 409 it raises. */
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genCode(6);
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_venues?id=eq.' + enc(venueId), {
      method: 'PATCH',
      headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({ join_code: code, join_code_set_at: new Date().toISOString() }),
    });
    if (res.ok) {
      _vcMap = null;          // the code map is now stale; rebuild on the next lookup
      await sbInsert(env, 'vp_admin_audit', {
        action: 'venue_code_refreshed', target: 'venue:' + venueId,
        detail: { by: authUserId, role: role },
      }, false).catch(() => {});
      return json({ ok: true, join_code: code });
    }
    if (res.status === 409) continue;    // taken by another venue, draw again
    throw dbError('update', 'vp_venues', await res.text());
  }
  return json({ error: 'Could not allocate a free code, please try again' }, 409);
}

async function handleVenueLike(request, env, json) {
  const url = new URL(request.url);
  const typed = String(url.searchParams.get('slug') || '').trim().toLowerCase().slice(0, 80);
  if (!typed || !/^[a-z0-9-]+$/.test(typed)) return json({ matches: [] });
  if (typed.length < 6) return json({ matches: [], why: 'too short to search' });

  /* PostgREST 'or' with a like: the slug itself, or the slug plus a dash and
     anything. The dash matters - without it the-grand would match the-grande
     and hand somebody a different pub's screen. */
  /* 25 WAS NOT ENOUGH. The prospect register holds 99 Royal Hotels, 75
     Commercials and 45 Railways: a cap of 25 would have silently hidden 74 Royal
     Hotels from the one screen trying to find itself, and there is no way for
     the venue to tell that the list they are looking at is a third of the truth.
     The biggest real family is 99, so 200 covers it with room to spare and is
     still far too small a page to be worth scraping.
     A state can be given to narrow it, which is what the screen does once a
     family is too big to fit on a wall. */
  const state = String(url.searchParams.get('state') || '').trim().toUpperCase().slice(0, 3);
  const q = 'or=(slug.eq.' + enc(typed) + ',slug.like.' + enc(typed + '-*') + ')'
          + (/^[A-Z]{2,3}$/.test(state) ? '&state=eq.' + enc(state) : '')
          + '&select=slug,name,postcode,state&order=state.asc,postcode.asc&limit=200';
  let rows = [];
  try {
    rows = (await sbGet(env, 'vp_venues', q)) || [];
  } catch (e) {
    return json({ matches: [] });     // a search that fails is not a screen that fails
  }
  return json({
    matches: rows.map((r) => ({
      slug: r.slug, name: r.name || r.slug,
      postcode: r.postcode || '', state: r.state || '',
    })),
  });
}

let screenPollRpcMissing = false;   // per isolate: once PostgREST says the function is not there, stop asking

async function handleVenueLookup(request, env, json) {
  const url = new URL(request.url);
  /* THE SCREEN KNOWS ITS SLUG. ASK BY THAT.
     A screen that identifies itself by a hash of its slug is one Change code away
     from being told it does not exist (see the derived-code fallback in venueByCode). tv.html now sends
     the slug as well, which is one indexed row and cannot drift from anything.
     The code is still honoured, for every screen in the field that has not
     reloaded yet - and the reload it needs rides this very answer. */
  const slug = String(url.searchParams.get('venue') || '').trim().toLowerCase().slice(0, 80);
  const slugOk = !!slug && /^[a-z0-9-]+$/.test(slug);
  /* The screen sends the build it is running. A screen that sends nothing is, by
     that silence, from before this existed - which is exactly the state that had a
     screen reporting healthy while ignoring every reload, because it predated the
     reload code. Recorded so HQ can say "ok, and current" rather than just "ok". */
  const ver = String(url.searchParams.get('v') || '').slice(0, 24).replace(/[^A-Za-z0-9.-]/g, '') || 'pre-5-sep';
  const isProbe = url.searchParams.get('probe') === '1';   // a monitoring tool, not a screen

  /* ONE TRIP, NOT THREE (migration 72).
     This is the most frequent request the Worker gets: every screen, every thirty
     seconds, for as long as the venue is open. On 8 Sep 2026 the load test measured
     the Supabase gateway at about fifty REST calls a second on the compute we have,
     and this route spent three of them one after the other (find the venue, read the
     row, write the heartbeat). vp_screen_poll does the same three things in one call
     and hands back the same fields. If the function is not there yet (migration 72
     not run) PostgREST answers 404 and this isolate takes the old path from then on;
     any other failure falls through to the old path for this one request, because a
     screen must never be told its venue is missing over a bookkeeping call. An empty
     answer also falls through: the old path still knows the derived-code map for a
     venue whose join_code predates migration 68. */
  /* A PROBE TAKES THE SLOW PATH ON PURPOSE.
     vp_screen_poll finds the venue, reads the row AND writes the heartbeat in one
     database call, so there is no way to ask it for a read-only answer without a new
     migration. A probe is a handful of requests in an audit run, not thirty seconds
     of every screen, so it can afford three REST calls to get an answer that leaves
     no footprint. The guard in venueLookupThreeTrips is what actually holds the write
     back; this is what makes sure a probe reaches it.

     Found by testing the deployed Worker against a real database rather than the fake
     one: the unit suite passed while probe=1 still wrote, because it exercised the
     fallback and the fleet uses the RPC. */
  let v = null;
  if (!screenPollRpcMissing && !isProbe) {
    const code = String(url.searchParams.get('code') || '').trim().toUpperCase().slice(0, 6);
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/vp_screen_poll', {
      method: 'POST', headers: sbHeaders(env),
      body: JSON.stringify({ p_slug: slugOk ? slug : '', p_code: code, p_version: ver }),
    }).catch(() => null);
    if (res && res.status === 404) {
      screenPollRpcMissing = true;
      console.warn('vp_screen_poll missing (migration 72 not run); polling the slow way');
    } else if (res && res.ok) {
      const rows = await res.json().catch(() => null);
      if (Array.isArray(rows) && rows.length === 1) v = rows[0];
    }
  }
  if (v === null) v = await venueLookupThreeTrips(env, url, slugOk ? slug : '', ver);
  if (v === null) return json({ exists: false });
  return venueLookupReply(json, v);
}

/* The pre-72 path, kept as the fallback above. Returns the venue row (the fields the
   reply needs) or null when no venue answers to the slug or the code. */
async function venueLookupThreeTrips(env, url, slug, ver) {
  let venueId = null;
  if (slug) {
    const bySlug = await sbGet(env, 'vp_venues', 'slug=eq.' + enc(slug) + '&select=id&limit=1').catch(() => null);
    venueId = (bySlug && bySlug[0] && bySlug[0].id) || null;
  }
  if (!venueId) venueId = await venueByCode(env, url.searchParams.get('code') || '', { includeSuspended: true });
  if (!venueId) return null;
  /* SURVIVE BEING PASTED BEFORE THE MIGRATION.
     This route is what the screen polls every thirty seconds to check its venue
     still exists, and two consecutive failures put a full-screen "not linked to an
     account" card over the venue's advertising. If this Worker went in before
     migration 63, selecting screen_reload_at would answer 42703 and every screen in
     the country would show that card. The order in MIGRATIONS.md is right, but the
     cost of getting it wrong should not be every venue's wall, so ask for the column
     and fall back to the old select if the database does not have it yet. */
  let rows = await sbGet(env, 'vp_venues',
    'id=eq.' + enc(venueId) + '&select=name,screen_reload_at,screen_seen_at,screen_version,screen_command,screen_command_at,slug,status&limit=1')
    .catch(() => null);
  if (!rows || !rows.length) {
    rows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=name,status&limit=1');
  }
  const v = (rows && rows[0]) || {};

  /* THE HEARTBEAT WE WERE THROWING AWAY.
     This request happens every thirty seconds from every screen, over ordinary
     HTTPS, whatever the websocket is doing. That makes it the only reliable
     evidence a screen is alive - and until now nothing recorded it, so a screen
     with a dead socket was indistinguishable in HQ from a working one. It cost
     most of an afternoon on 5 Sep, because every diagnosis had to begin by
     guessing whether the screen was receiving anything at all.

     Written at most once every 25 seconds per venue: the poll is 30s, so this is
     one write per poll in the normal case and none at all if two screens at the
     same venue happen to land together. Awaited rather than left dangling, because
     an unawaited promise in a Worker can be cancelled when the response returns,
     and a heartbeat that only sometimes records is worse than none. Best effort:
     a screen must never be told its venue is missing because a bookkeeping write
     failed. */
  /* A MONITORING TOOL MUST NOT BE ABLE TO FAKE THE THING IT MONITORS.
     On 11 Sep 2026 daily-venue-audit.py was changed to sweep all seventeen active
     venues instead of the one that was hardcoded. It polls this very route, so one
     run wrote screen_seen_at for every venue in the fleet and set screen_version to
     'daily-audit'. HQ's SCREEN OK / SCREEN DOWN badge reads screen_seen_at. So the
     audit made every venue's TV look alive, including any that had been black for a
     day, and the badge that exists to catch a black screen was reporting the health
     of the tool that asked.
     A probe says so and gets a read-only answer. Everything else about the reply is
     identical, so the audit still proves the route works, the venue resolves and the
     code matches. It just cannot leave a footprint. */
  const isProbe = url.searchParams.get('probe') === '1';
  if ('screen_seen_at' in v && !isProbe) {
    const last = v.screen_seen_at ? Date.parse(v.screen_seen_at) : 0;
    if (!isFinite(last) || Date.now() - last > 25000 || ver !== v.screen_version) {
      try {
        await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venueId),
          { screen_seen_at: new Date().toISOString(), screen_version: ver });
      } catch (e) { /* never let this affect the answer */ }
    }
  }
  return v;
}

/* The reply a screen gets, from either path. reload_at RIDES THIS REQUEST ON PURPOSE.
   The screen already calls this every thirty seconds over ordinary HTTPS, so a
   reload delivered here reaches a screen whose websocket has died - which is
   precisely the screen that needs reloading, and the one a broadcast can never
   reach. Costs no extra request and no extra query. */
function venueLookupReply(json, v) {
  return json({
    exists: true,
    name: v.name || '',
    /* A suspended venue's screen keeps its venue and its advertising. It is the
       lobby and the join code that must not be offered, and /play/live carries
       that. Before this the screen was told the venue did not exist and forgot it,
       so a venue that settled up came back to a wall asking to be paired again. */
    suspended: v.status === 'suspended',
    /* THE SLUG, SO A SCREEN CAN BE SENT TO ITS OWN ADDRESS.
       A venue that lands on the wrong address can key in the six characters
       already shown on the host console; this is what lets the screen then send
       itself to /tv?venue=<slug>, remember it, and print it for the venue to
       write down. The code is a hash of the slug and every screen already asks
       this route every thirty seconds, so nothing new is exposed. */
    slug: v.slug || '',
    reload_at: v.screen_reload_at || null,
    // A STATE, not just a restart. A reload puts the ads up and then anything still
    // broadcasting takes the wall straight back, which is why a reload alone could
    // not rescue a screen stuck on a finished board. See migration 65.
    command: v.screen_command || null,
    command_at: v.screen_command_at || null,
  });
}

/* POST /screen/reload   { slug }   (HQ admin only)
 *
 * Rings the doorbell. Sets vp_venues.screen_reload_at, and every screen at that
 * venue picks it up on its next poll and reloads itself.
 *
 * This exists because the broadcast path cannot be trusted as the only path: a
 * screen with a dropped socket hears nothing, looks completely healthy because the
 * advertising is timed locally, and has had to be reset by hand. HQ still fires the
 * broadcast as well, because when it works it is instant. This is the floor.
 */
/* GET /admin/group-overage?months=3   (HQ admin only)
 *
 * WHAT A GROUP OWES THAT NOTHING HAS ASKED FOR.
 *
 * venueCanBeCharged returns false for a venue with no founding_id - a grouped venue -
 * and its comment says "invoiced by hand". That is a deliberate decision and it is
 * also a leak: the host is never shown the overage consent screen, nothing is
 * charged, and NOTHING ANYWHERE tells anyone the night happened. Invoicing by hand
 * requires knowing what to invoice, and there was no way to know.
 *
 * So this is the missing half, and it is deliberately only a REPORT. It reads
 * sessions, works out which grouped venues went past their plan and by how much, and
 * prices it at the rate the rest of the system already uses. It charges nothing and
 * changes nothing: what a group is billed is a conversation, and this is the sheet
 * you have that conversation from.
 */
async function handleGroupOverage(request, env, json) {
  const admin = await requireScreenAdmin(request, env, json);
  if (admin.error) return admin.error;
  const url = new URL(request.url);
  let months = parseInt(url.searchParams.get('months') || '3', 10);
  if (!isFinite(months) || months < 1) months = 3;
  if (months > 24) months = 24;
  const since = new Date(Date.now() - months * 31 * 24 * 3600 * 1000).toISOString();

  /* Grouped venues only: a venue with a founding_id is metered and charged the normal
     way, and including it here would double-count money already taken. */
  const venues = await sbGet(env, 'vp_venues',
    'group_id=not.is.null&founding_id=is.null&select=id,name,slug,group_id,max_players');
  if (!venues || !venues.length) {
    return json({ ok: true, months: months, venues: 0, nights: [], total_cents: 0,
                  note: 'no grouped venues without their own billing account' });
  }
  const byId = {};
  for (const v of venues) byId[v.id] = v;

  /* Asked per venue rather than one in.() of every id: that URL would be absurd at
     scale, there are not many grouped venues, and this is an on-demand report rather
     than a hot path. */
  const nights = [];
  let total = 0;
  for (const v of venues) {
    const sessions = await sbGet(env, 'vp_sessions',
      'venue_id=eq.' + enc(v.id) + '&opened_at=gte.' + enc(since) +
      '&select=id,opened_at,ended_at,status&order=opened_at.desc&limit=200')
      .catch(() => null);
    if (!sessions) continue;
    const cap = parseInt(v.max_players, 10) || 0;
    for (const ses of sessions) {
      /* COUNTED THE SAME WAY THE MONEY IS COUNTED.
         The first version of this read vp_sessions.players_attached, which is not
         what the billing path uses and appears nowhere else in this file. The
         authoritative figure is countPlayers over vp_players, deduplicated by
         device_id - one phone is one player, however many times it joined. A report
         that quotes a different number from the one we would charge is worse than no
         report: it would be quoted to a group and then not match the invoice. */
      const roster = await sbGet(env, 'vp_players',
        'session_id=eq.' + enc(ses.id) + '&select=id,device_id&limit=2000').catch(() => null);
      if (!roster) continue;
      const peak = countPlayers(roster);
      if (!cap || peak <= cap) continue;
      const over = peak - cap;
      // $2 a head, the same figure the metered path charges for a first big night.
      const cents = over * 200;
      total += cents;
      nights.push({
        venue: v.name, slug: v.slug, group_id: v.group_id,
        night: String(ses.opened_at || '').slice(0, 10),
        plan_cap: cap, players: peak, over: over, cents: cents,
        session: ses.id, still_open: ses.status !== 'finished',
      });
    }
  }
  nights.sort((a, b) => (a.night < b.night ? 1 : -1));
  return json({ ok: true, months: months, venues: venues.length,
                nights: nights.length, rows: nights, total_cents: total,
                note: 'a report only: nothing here has been charged or asked for' });
}

/* POST /screen/command   { slug, command }   (HQ admin only)
 *   command: 'ads'     put the venue's advertising back on the wall and hold it
 *            'reload'  restart the page (what /screen/reload did)
 *
 * Same delivery as the reload: a column the screen reads on the poll it already
 * makes every thirty seconds over ordinary HTTPS. Nothing here touches a realtime
 * channel, because the screens that need instructing are the ones that cannot hear
 * one.
 */
const SCREEN_COMMANDS = { ads: 1, reload: 1 };

async function handleScreenCommand(request, env, json, body) {
  const admin = await requireScreenAdmin(request, env, json);
  if (admin.error) return admin.error;
  const cmd = String((body && body.command) || '').trim().toLowerCase();
  if (!SCREEN_COMMANDS[cmd]) return json({ error: 'unknown command' }, 400);

  /* WHEN, not just what. A screen reload is a deployment, and a deployment has no
     business interrupting a room at 8pm on a Friday. So HQ can hand a time, and the
     screens act at that time instead of now - the timestamp simply sits in the
     column until their poll finds it is in the past. Nothing has to stay awake or
     remember anything: the schedule IS the stored time.
     Capped at 48 hours so a typo cannot park a reload on every screen in the country
     for a month. */
  let at = new Date().toISOString();
  if (body && body.at) {
    const t = Date.parse(String(body.at));
    if (!isFinite(t)) return json({ error: 'bad time' }, 400);
    if (t > Date.now() + 48 * 3600 * 1000) return json({ error: 'too far ahead' }, 400);
    at = new Date(t).toISOString();
  }

  /* ONE VENUE OR ALL OF THEM. Dean asked for a single button rather than three, so
     the bulk case is a mode of the same route: one place for this to be right or
     wrong, rather than two that can drift apart. */
  let venues;
  if (body && body.all) {
    venues = await sbGet(env, 'vp_venues',
      'slug=not.is.null&status=neq.suspended&select=id,name,slug');
  } else {
    const slug = String((body && body.slug) || '').trim().toLowerCase().slice(0, 80);
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'bad slug' }, 400);
    venues = await sbGet(env, 'vp_venues', 'slug=eq.' + enc(slug) + '&select=id,name,slug&limit=1');
  }
  if (!venues || !venues.length) return json({ error: 'no venues matched' }, 404);

  const patch = { screen_command: cmd, screen_command_at: at };
  // Keep reload_at in step so a screen still on the migration-63 page at least
  // restarts rather than ignoring the press entirely.
  if (cmd === 'reload') patch.screen_reload_at = at;

  let done = 0, failed = 0;
  for (const v of venues) {
    const ok = await sbPatch(env, 'vp_venues', 'id=eq.' + enc(v.id), patch);
    if (ok === false) failed++; else done++;
  }
  try {
    await sbInsert(env, 'vp_admin_audit', {
      actor_admin: null, actor_label: admin.label,
      action: 'screen_command',
      target: (body && body.all) ? ('venues:' + done) : (venues[0] && venues[0].id),
      detail: { command: cmd, at: at, venues: done, failed: failed,
                all: !!(body && body.all), auth_user: admin.auth },
    }, false);
  } catch (e) { /* audit is best effort */ }
  /* Same as the reload route: the column is still the truth for a screen that is
     not in a room, and the room, when it is on, carries it there in a second.
     Only for a command meant to happen NOW; a scheduled one has to wait for its
     time, and the poll is what knows the time has come. */
  let heard = 0;
  if (!(at > new Date().toISOString())) {
    for (const v of venues) {
      if (!v || !v.slug) continue;
      try { heard += await roomPublish(env, 'vp-' + fnvVenueCode(v.slug), { type: 'command', command: cmd, at: at }); } catch (e) {}
    }
  }
  return json({ ok: true, command: cmd, at: at, venues: done, failed: failed,
                scheduled: at > new Date().toISOString(), heard: heard,
                note: 'screens act within 30 seconds of that time' });
}

/* The same admin test both screen routes use. Written once: requireStaff already
   made the mistake of accepting any vp_platform_admins row, which handed a Gflam
   'staff' admin owner rights at every venue in the country. */
async function requireScreenAdmin(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  if (!authUserId) return { error: json({ error: 'sign in first' }, 401) };
  const admins = await sbGet(env, 'vp_platform_admins',
    'auth_user_id=eq.' + enc(authUserId) + '&role=in.(owner,accounts)&select=auth_user_id,role');
  if (!admins || !admins.length) return { error: json({ error: 'not allowed' }, 403) };
  return { label: 'hq:' + (admins[0].role || 'admin'), auth: authUserId };
}

async function handleScreenReload(request, env, json, body) {
  /* HQ ADMINS ONLY, and the same definition the rest of this file uses: a row in
     vp_platform_admins with role owner or accounts. requireStaff already made the
     mistake of accepting any row once, which handed a Gflam 'staff' admin owner
     rights at every venue in the country, so this matches it rather than inventing
     a second answer to the same question. */
  const authUserId = await verifyHostJwt(request, env);
  if (!authUserId) return json({ error: 'sign in first' }, 401);
  const admins = await sbGet(env, 'vp_platform_admins',
    'auth_user_id=eq.' + enc(authUserId) + '&role=in.(owner,accounts)&select=auth_user_id,role');
  if (!admins || !admins.length) return json({ error: 'not allowed' }, 403);
  const admin = { id: null, label: 'hq:' + (admins[0].role || 'admin'), auth: authUserId };
  const slug = String((body && body.slug) || '').trim().toLowerCase().slice(0, 80);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'bad slug' }, 400);
  const rows = await sbGet(env, 'vp_venues', 'slug=eq.' + enc(slug) + '&select=id,name&limit=1');
  const venue = rows && rows[0];
  if (!venue) return json({ error: 'no such venue' }, 404);
  const at = new Date().toISOString();
  const ok = await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id), { screen_reload_at: at });
  if (ok === false) return json({ error: 'could not set it' }, 502);
  try {
    await sbInsert(env, 'vp_admin_audit', {
      actor_admin: null,
      actor_label: admin.label,
      action: 'screen_reload_requested',
      target: venue.id,
      detail: { venue_name: venue.name || null, at: at, via: 'poll',
                auth_user: admin.auth },
    }, false);
  } catch (e) { /* audit is best effort */ }
  /* The column above is what a TV's 30 second poll reads, and it stays the truth:
     a screen that is not in a room still reloads exactly as before. If the room
     server is on, the same instruction also goes straight down the socket, so the
     screen acts in about a second instead of within thirty. roomPublish never
     throws and answers 0 when there is no binding. */
  let heard = 0;
  try { heard = await roomPublish(env, 'vp-' + fnvVenueCode(slug), { type: 'reload', at: at }); } catch (e) { heard = 0; }
  return json({ ok: true, at: at, heard: heard,
                note: heard ? 'screens reload now' : 'screens reload within 30 seconds' });
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
/* GET /screen?venue=<slug>   (anon)
 *   -> { exists, name, logo_url, slides[], raffle, draws[] }
 *
 * Everything a venue TV needs to paint itself, for ONE venue, by slug.
 *
 * Why this exists: the TV and the four game screens used to read vp_venue_screen straight from
 * Supabase with the public key. That worked, but the same grant answered a request with NO slug
 * filter, so one line of curl returned every venue's slug, id and advertising URLs: the platform's
 * entire customer list, and the first step to deriving live join codes. A confirmed finding on
 * 20 Aug 2026. An RLS policy that tried to require a slug filter did not work, because PostgREST
 * does not expose the query string the way that policy assumed.
 *
 * So the public grant goes (migration 48) and this replaces it. Nothing changes for a venue: the
 * TV link is the same, still public, still no login. A stranger who knows a slug can still see
 * that one venue's screen, which is the same thing they could see by walking into the bar. What
 * they can no longer do is ask for the list.
 */
async function handleScreen(request, env, json) {
  const url = new URL(request.url);
  const slug = String(url.searchParams.get('venue') || '').trim().toLowerCase().slice(0, 80);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return json({ exists: false });

  /* THE DRAWS BOARD DOES NOT DEPEND ON THE SCREEN CONFIG, SO IT SHOULD NOT WAIT
     BEHIND IT.

     Every TV asks this endpoint every thirty seconds, always, whether a game is
     on or not, so it is the single most-called thing in the product and its cost
     is multiplied by every venue that exists. Measured on 8 Sep 2026 it took
     about 700ms, of which roughly 435ms was database: three round trips, one
     after another, because they were written in reading order rather than
     dependency order.

     Only two of them actually depend on each other - the venue row is found via
     the screen config's venue_id. The draws board is keyed on the slug we already
     have, so it can be in flight the whole time the other two are talking.

     Its .catch is attached HERE, at creation, not at the await. A promise that
     rejects before anything is awaiting it is an unhandled rejection, and in a
     Worker that can take down the request that a venue's screen is waiting on.
     The board was always a nicety that must never fail the screen; starting it
     early must not quietly change that. */
  const drawsPromise = sbGet(env, 'v_vp_screen_draws',
    'slug=eq.' + enc(slug) + '&select=name,current_jackpot_cents,draw_day,draw_time,timezone')
    .catch(() => null);

  const rows = await sbGet(env, 'vp_venue_screen',
    'slug=eq.' + enc(slug) + '&select=slides,raffle,logo_url,venue_id&limit=1');
  const cfg = (rows && rows[0]) || null;

  /* A REAL VENUE THAT HAS NEVER SET UP A SCREEN IS STILL A REAL VENUE.

     `exists` used to mean "there is a vp_venue_screen row", and the TV reads it as
     "there is such a venue": loadScreen() answers a false with askWhichVenue(). So an
     ACTIVE venue that nobody had configured a screen for was reported byte for byte
     the same as a slug typed in wrong, and its television ran the setup flow, counted
     down 45 seconds, redirected to the same link, and did it again. For ever. It never
     showed a night in its life.

     Tugun Bowls Club, active since 29 July 2026, was doing exactly that on 10 Sep, and
     so was one other. Dean saw it on the wall: "tugun has no slides or anything and
     keeps doing the screen setup".

     The extra lookup happens ONLY when there is no screen row. This endpoint is the
     single most-called thing in the product, every TV every thirty seconds, and the
     ordinary path must not pay for a case that is rare by definition. */
  let name = '', joinCode = '', venueIsReal = !!cfg;
  if (!cfg) {
    const v0 = await sbGet(env, 'vp_venues',
      'slug=eq.' + enc(slug) + '&select=name,join_code&limit=1').catch(() => null);
    if (v0 && v0[0]) {
      venueIsReal = true;
      name = v0[0].name || '';
      joinCode = v0[0].join_code || '';
    }
  }
  if (cfg && cfg.venue_id) {
    const v = await sbGet(env, 'vp_venues',
      'id=eq.' + enc(cfg.venue_id) + '&select=name,join_code&limit=1').catch(() => null);
    name = (v && v[0] && v[0].name) || '';
    /* The venue's own code, so the screen shows what the console shows and what a
       player types. Absent until migration 68 runs, and the TV falls back to the
       legacy derived code in that case rather than showing nothing. */
    joinCode = (v && v[0] && v[0].join_code) || '';
  }

  // The members-draw board, same one venue. Only draws with a night set are advertised, which is
  // also what takes an archived or retired draw off the screen.
  let draws = [];
  try {
    const d = await drawsPromise;          // already in flight since the top
    draws = (d || []).filter((x) => x && x.draw_day);
  } catch (e) { /* the board is a nicety; never fail the whole screen for it */ }

  return json({
    exists: venueIsReal,
    name: name,
    join_code: joinCode,
    logo_url: (cfg && cfg.logo_url) || '',
    slides: (cfg && Array.isArray(cfg.slides)) ? cfg.slides : [],
    raffle: (cfg && cfg.raffle) || null,
    draws: draws,
  });
}

async function handlePlayLive(request, env, json) {
  const url = new URL(request.url);
  /* includeSuspended, or the suspended branch below is unreachable: the default
     lookup answers null for a suspended venue and this returned exists:false first. */
  const venueId = await venueByCode(env, url.searchParams.get('code') || '', { includeSuspended: true });
  if (!venueId) return json({ exists: false, live: false });
  const vrows = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=name,status&limit=1');
  const name = (vrows && vrows[0] && vrows[0].name) || '';
  /* BILLING CLOSING SOMETHING HAS TO REACH THE WALL.

     This asked the session and nothing else, so a venue suspended for non-payment
     kept a lobby up on its own television inviting the room to join a night that
     the kill-switch would refuse to start. The suspension is enforced everywhere
     that costs money (starting a game, joining, claiming, minting a key) and was
     invisible on the one surface the public actually looks at.

     Answering live:false here clears the wall within one check and stops phones
     being sent into a game that cannot run. It does not end anything: closing a
     session is a billing action and stays with the host, HQ and the sweep. */
  if (vrows.length && vrows[0].status === 'suspended') {
    return json({ exists: true, name, live: false, suspended: true });
  }

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

  /* PROVE YOU ARE THE HOST. This authorised on the venue code alone, and that code is a plain
     hash of the venue's PUBLIC slug, so anyone could write invented player counts and prize
     figures against any venue. These rows drive the quiet-venue retention list, whose remedy is
     an Archive button, so poisoning them is a way to get a real customer chased or archived.
     The only caller is the bingo console, which is signed in, so the token costs nothing. */
  let reporter = null;
  try { reporter = await verifyHostJwt(request, env); } catch (e) { reporter = null; }
  if (!reporter) return json({ error: 'Sign in to report a game.' }, 401);
  try { await requireStaff(env, reporter, venueId); }
  catch (e) { return json({ error: 'That venue is not yours to report on.' }, 403); }
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
  /* THIS REPORT NO LONGER BILLS ANYTHING.
     It briefly did, because broadcast bingo had no server session and no player rows, so the
     console's own count was the only number available. Bingo now opens a session and its players
     join like every other format, so the meter is vp_players: a count the SERVER made, not one a
     browser reported. That is the more defensible number by a distance, and it means there is
     exactly one meter rather than two that could disagree or double up.
     The report stays exactly as it was for the retention list, which is what it was always for. */

  const reportId = String(b.report_id || '').trim();
  if (reportId) {
    if (!UUID_RE.test(reportId)) return json({ error: 'Invalid report_id' }, 400);
    // Scoped to the venue the code resolved to, so a report id alone can never rewrite
    // another venue's figures.
    await sbPatch(env, 'vp_game_reports',
      'id=eq.' + enc(reportId) + '&venue_id=eq.' + enc(venueId), row);
    return json({ ok: true, id: reportId });
  }
  /* Bingo reports the moment a game STARTS, which is the only server-side signal
     broadcast bingo gives us. Use it: this fires even when the console has not
     been updated to send a format on /session, so the fix works on the Worker
     alone. Only on the insert, never on the patch that ends a game. */
  if (!row.ended_at) {
    await endOtherRunningGames(env, venueId, row.format);
    await markBroadcastGameLive(env, venueId, row.format);
  }

  const ins = await sbInsert(env, 'vp_game_reports', row, true);
  const created = Array.isArray(ins) ? ins[0] : ins;
  const newId = (created && created.id) || null;
  return json({ ok: true, id: newId });
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

  // Anti-abuse rate limit (in this isolate's memory; see rateLimit). /join is the
  // one unauthenticated write and it
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
  /* The venue kill-switch and the device dedup below both need only the session, so they
     are asked together (assertVenueActive throws, and Promise.all lets the throw through). */
  const venueCheck = assertVenueActive(env, session.venue_id);

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
    /* The cache and the durable column are read at the same time, alongside the venue check:
       three trips that used to queue behind each other. The database row wins when it exists
       (it already proves session + not kicked); the cache only matters in the seconds before
       the row is visible. */
    const [cached, byDevice] = await Promise.all([
      dedupKey ? env.RL.get(dedupKey).catch(function () { rlWarn(); return null; }) : null,
      sbGet(env, 'vp_players',
        'session_id=eq.' + enc(session.id) + '&device_id=eq.' + enc(devId) +
        '&kicked=eq.false&select=id&order=joined_at.asc&limit=1'),
      venueCheck,
    ]);
    let priorId = byDevice.length ? byDevice[0].id : null;
    let proven = !!priorId;   // the row came from the session-scoped, not-kicked query
    if (!priorId && cached && UUID_RE.test(cached)) priorId = cached;
    if (priorId && UUID_RE.test(priorId)) {
      const existing = proven ? [{ id: priorId }] : await sbGet(env, 'vp_players',
        'id=eq.' + enc(priorId) + '&session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id');
      if (existing.length) {
        const token = randomTokenHex(32);            // fresh 256-bit token onto the SAME row
        const patch = { token_hash: await sha256Hex(token), last_seen_at: new Date().toISOString() };
        if (name) patch.display_name = name;
        const [, snapshot] = await Promise.all([
          sbPatch(env, 'vp_players', 'id=eq.' + enc(priorId), patch),
          getPublicSnapshot(env, session.id),
        ]);
        return json({ token, snapshot });
      }
    }
  } else {
    await venueCheck;
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
  // Not awaited: a KV write is the slowest thing on this path (0.5 to 1 s) and the phone
  // does not need it to finish before it hears "you're in". The durable record is the
  // device_id column; this is only the cache in front of it.
  if (dedupKey && newPlayer && newPlayer.id) {
    try { env.RL.put(dedupKey, newPlayer.id, { expirationTtl: JOIN_DEDUP_TTL }).catch(function () { rlWarn(); }); } catch (e) { rlWarn(); }
  }

  // Broadcast player.joined (this insert is what pushes the TV welcome ticker).
  // AUDIT 8 SEP 2026, LOOKED AT AND LEFT: this reads every player in the session on
  // every join, so a 200-seat lobby reads about 20,000 rows over the night. It is
  // bounded by the ROOM, not by how many venues we have, so it is not the kind of
  // cost that grows with the business. A count query cannot replace it, because
  // countPlayers dedupes by device_id (a phone that rejoins is one player, and that
  // is the number the host is billed on) and PostgREST has no count-distinct. Doing
  // it properly means a Postgres view; two extra selected columns is cheaper than a
  // migration for a read that costs a few milliseconds.
  // The TV's welcome ticker (count, then the event) and the phone's snapshot do not
  // depend on each other, so they run side by side.
  const ticker = sbGet(env, 'vp_players', 'session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id,device_id')
    .then(function (players) {
      const payload = { player_count: countPlayers(players) };   // the number the host is billed on
      if (name) payload.display_name = name;       // name on TV only if the player gave one
      return emitEvent(env, session, 'player.joined', payload, 'system');
    });
  const [, snapshot] = await Promise.all([ticker, getPublicSnapshot(env, session.id)]);
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
      /* Never ask a venue to consent to a charge that cannot happen. chargeNightOverage bails out
         when the account has no Stripe customer and subscription behind it, which is every comp
         venue and every venue we onboarded from HQ that has not added a card yet. Those hosts were
         still being shown "the extra players are $2 each, OK?" and made to tap it before their game
         would start: a promise about their money that we then did not keep in either direction.
         Asking is the same decision as billing, so it reads the same condition. */
      const chargeable = (count > planCap && (!session.overage_approved || count > ceiling))
        ? await venueCanBeCharged(env, session.venue_id)
        : true;
      if (chargeable && count > planCap && (!session.overage_approved || count > ceiling)) {
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

  // Remember this venue's trivia settings (migration 50), so the next night pre-fills to what they
  // last used instead of resetting to the built-in defaults. Only writes the fields the host actually
  // sent, and never fails a game start if it cannot save. Built on fix/audit-40 in Aug 2026 and
  // never merged: the console read these columns for a month while nothing wrote them.
  if (session.venue_id) {
    const prefs = { venue_id: session.venue_id, trivia_speed_bonus: speedBonus };
    if (config.time_limit_s != null) prefs.trivia_time_limit_s = config.time_limit_s;
    if (config.base_points != null) prefs.trivia_base_points = config.base_points;
    try { await sbUpsert(env, 'vp_venue_settings', prefs, 'venue_id'); } catch (e) { /* non-fatal */ }
  }

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
  // Floor it. Nothing enforced the min="30" on the input (not in a form, checkValidity never
  // called), so a mistyped 5 gave the room five seconds to reach the bar. 0 is still allowed and
  // means "no claim window at all", which is a deliberate setting; anything between is a typo.
  if (timeToPresent !== null && timeToPresent > 0 && timeToPresent < 30) timeToPresent = 30;

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

  // The spin the TV runs when a ticket is drawn, fixed onto the raffle when it is created. The
  // draw's double-tap guard is sized from THIS (plus two seconds), so a console cannot shrink the
  // guard under the animation the room is watching. Clamped to the 3 to 8 the console offers.
  let spinSeconds = parseInt(b.spin_seconds, 10);
  if (!(spinSeconds >= 0)) spinSeconds = 4;
  config.spin_seconds = Math.max(3, Math.min(8, spinSeconds));

  const gameRows = await sbInsert(env, 'vp_games', {
    session_id: session.id, seq, format: 'raffle', status: 'running', config,
    started_at: new Date().toISOString(),
  }, true);
  const game = Array.isArray(gameRows) ? gameRows[0] : gameRows;
  await finishOtherRunningGames(env, session.id, game.id);   // now safe: the new round exists

  // Remember this raffle's SETUP as the venue's template (migration 51), so a weekly raffle pre-fills
  // to what they last ran instead of re-entering the range, times and settings each week. The prizes
  // were already saved per venue; this is the rest of the setup, spin length included. Best-effort,
  // never fails a draw. Built on fix/audit-40 in Aug 2026 and never merged: the console read this
  // column for a month while nothing wrote it, so every venue re-typed its raffle every week.
  if (session.venue_id) {
    try {
      await sbUpsert(env, 'vp_venue_settings', { venue_id: session.venue_id, raffle_template: {
        range_min: rangeMin, range_max: rangeMax, time_to_present: timeToPresent, winners: winners,
        allow_redraw: allowRedraw, jackpot_on: jackpotOn, jackpot_amount_cents: jackpotCents,
        leading_zeros: leadingZeros, excluded_ranges: config.excluded_ranges || null,
        prizes: config.prizes || null, spin_seconds: config.spin_seconds,
      } }, 'venue_id');
    } catch (e) { /* non-fatal */ }
  }

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

/* How long a draw button is locked after a draw, in ms: the spin the room is watching plus two
 * seconds of grace. Shared by the raffle and the members draw so the two cannot drift apart. The
 * spin comes from the caller (the raffle console sends it, the members draw stores it); anything
 * unparseable falls back to the default and everything is clamped to what the consoles offer. */
function drawHoldMs(spinSeconds, dflt, lo, hi) {
  let spin = parseInt(spinSeconds, 10);
  if (!(spin >= 0)) spin = dflt;
  spin = Math.max(lo, Math.min(hi, spin));
  return (spin + 2) * 1000;
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

  // Double-tap guard, sized to the SPIN. The TV animates a draw for the spin length the host
  // chose (3 to 8 seconds), so a second draw inside that window lands a new winner while the
  // first is still spinning on the wall: one number settles and a different one is announced.
  // The old guard was a flat 3 seconds, shorter than every spin but the shortest. The console
  // sends its spin length; it is clamped to the range the console offers, defaults to the
  // console's default, and gets two seconds of grace. Dean's call, 8 Sep 2026. A deliberate
  // later draw is unaffected. (A redraw is a separate, explicit action and is not gated here.)
  if (!isRedraw && prior.length && prior[0].drawn_at) {
    const since = Date.now() - new Date(prior[0].drawn_at).getTime();
    // The spin fixed onto the raffle when it was created is the floor; a console may send a longer
    // one (it can change the spin mid-raffle) but can never send a shorter one and get under it.
    const baked = parseInt(game.config && game.config.spin_seconds, 10) || 0;
    const sent = parseInt(b.spin_seconds, 10) || 0;
    const holdMs = drawHoldMs(Math.max(baked, sent) || undefined, 4, 3, 8);
    if (since >= 0 && since < holdMs) {
      return json({ error: 'The draw is still on the screen. You can draw again in ' + Math.ceil((holdMs - since) / 1000) + ' seconds.' }, 429);
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
 * SCHEMA NOTE: vp_member_draw_results.outcome is NOT NULL. It used to check
 * in ('claimed','jackpot_rolled') only, with no value meaning "drawn but not yet
 * resolved", so a draw whose reply was lost on bad wifi left NOTHING behind: the
 * date said drawn tonight and no row said who. Migration 74 adds 'drawn'. The DRAW
 * now writes that row and RESOLVE updates it to claimed or jackpot_rolled, so one
 * draw is one row. Both sides are forgiving: without the migration the insert is
 * refused, is caught, and the draw behaves exactly as it did before.
 * An 'drawn' row is UNRESOLVED. Any list or total must filter it out or label it;
 * v_vp_prizes_given already totals only 'claimed' rows, so money figures are safe.
 * The timestamp column here is drawn_at. There is NO created_at.
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
  /* ONE TRIP, NOT EIGHT (migration 76; see the note above handleBingoBall).
     The pick still happens with THIS Worker's CSPRNG. Eight uint32 values are minted here
     with crypto.getRandomValues and handed to the function, which applies the same
     rejection rule randInt applies (discard anything at or above floor(2 ** 32 / n) * n,
     then take it modulo n), so the distribution is identical and the entropy never comes
     from the database. Eight is far more than enough: a single value is rejected with
     probability under n / 2 ** 32. If they were all rejected the function says so and we
     draw the old way. */
  const rand = [];
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < buf.length; i++) rand.push(buf[i]);
  const r = await hostDrawRpc(request, env, json, 'vp_members_draw', {
    p_rand: rand, p_hold_default: 4, p_hold_lo: 2, p_hold_hi: 30,
  });
  if (r.reply) return r.reply;
  if (r.pre) return handleMembersDrawManyTrips(request, env, json, r.pre);
  const d = r.rpc;
  if (d.status === 'hold') {
    return json({ error: 'The draw is still on the screen. You can draw again in ' + d.wait_seconds + ' seconds.' }, 429);
  }
  if (d.status === 'pending') {
    return json({
      draw_id: r.drawId, draw_name: d.draw_name,
      member_id: d.member_id, member_number: d.member_number,
      first_name: null, last_name: null,
      winner_name: d.winner_name,
      jackpot_cents: d.jackpot_cents != null ? d.jackpot_cents : 0,
      time_to_claim_seconds: d.time_to_claim_seconds != null ? d.time_to_claim_seconds : null,
      draw_length_seconds: d.draw_length_seconds != null ? d.draw_length_seconds : null,
      valid_count: null,
      pending: true,
    });
  }
  // The name the room sees is formatted HERE, by the same formatMemberName the old path
  // used, from the same three inputs. The function formats the copy it writes down.
  return json({
    draw_id: r.drawId, draw_name: d.draw_name,
    member_id: d.member_id, member_number: d.member_number,
    first_name: d.first_name, last_name: d.last_name,
    winner_name: formatMemberName(d.first_name, d.last_name, d.name_display),
    jackpot_cents: d.jackpot_cents != null ? d.jackpot_cents : 0,
    time_to_claim_seconds: d.time_to_claim_seconds != null ? d.time_to_claim_seconds : null,
    draw_length_seconds: d.draw_length_seconds != null ? d.draw_length_seconds : null,
    valid_count: d.valid_count,
  });
}

// The pre-76 path, kept only as the fallback above. `pre` carries the verified host and the
// body already read (a request body can only be read once).
async function handleMembersDrawManyTrips(request, env, json, pre) {
  const authUserId = pre ? pre.authUserId : await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = pre ? pre.b : await readJson(request);
  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return json({ error: 'Missing draw_id' }, 400);
  assertUuid(drawId, 'draw_id');

  const draws = await sbGet(env, 'vp_member_draws',
    'id=eq.' + enc(drawId) + '&select=id,venue_id,roster_id,name,current_jackpot_cents,starting_amount_cents,increment_cents,draw_length_seconds,time_to_claim_seconds');
  if (!draws.length) return json({ error: 'Draw not found' }, 404);
  const draw = draws[0];
  await requireStaff(env, authUserId, draw.venue_id);            // ENFORCED: staff at the draw's venue (also kill-switch)

  // Double-tap guard, sized to the SPIN (migration 69 adds last_drawn_at). The console locks
  // its own Draw button, but two hosts on two consoles, or one request retried on bad wifi,
  // reach here with nothing in the way, and the raffle had a guard while this never did. A
  // second draw inside the spin names a second member while the first is still spinning on the
  // wall. Nothing is written until the host resolves, so no money was ever at risk; the room's
  // trust in the draw was. Read separately and forgiven if the column is not there yet, so a
  // Worker pasted before the migration still draws.
  const holdMs = drawHoldMs(draw.draw_length_seconds, 4, 2, 30);
  let lastAt = null;
  try {
    const t = await sbGet(env, 'vp_member_draws', 'id=eq.' + enc(drawId) + '&select=last_drawn_at');
    lastAt = t.length ? t[0].last_drawn_at : null;
  } catch (e) { lastAt = null; }
  if (lastAt) {
    const since = Date.now() - new Date(lastAt).getTime();
    if (since >= 0 && since < holdMs) {
      return json({ error: 'The draw is still on the screen. You can draw again in ' + Math.ceil((holdMs - since) / 1000) + ' seconds.' }, 429);
    }
  }

  /* PICK UP TONIGHT'S DRAW. last_drawn_date is stamped below, at DRAW time, so a reply lost on
     bad wifi used to leave the host with "Drawn tonight" and no winner anywhere. The console can
     now draw again; this is what makes that safe, by handing back the SAME member rather than
     picking a second one. Only an unresolved 'drawn' row from the last 30 minutes counts.
     drawn_at, NOT created_at: this table has no created_at, and PostgREST rejects the whole
     select when a name is unknown, which is how the reset jackpot once reached a TV. */
  let pending = [];
  try {
    pending = await sbGet(env, 'vp_member_draw_results',
      'draw_id=eq.' + enc(drawId) + '&outcome=eq.drawn&select=id,member_id,member_number,winner_name,amount_cents,drawn_at' +
      '&order=drawn_at.desc&limit=1');
  } catch (e) { pending = []; }
  if (pending.length && pending[0].drawn_at && (Date.now() - new Date(pending[0].drawn_at).getTime()) < 30 * 60 * 1000) {
    const p = pending[0];
    return json({
      draw_id: drawId, draw_name: draw.name,
      member_id: p.member_id, member_number: p.member_number,
      first_name: null, last_name: null,
      winner_name: p.winner_name,
      jackpot_cents: p.amount_cents != null ? p.amount_cents : (draw.current_jackpot_cents != null ? draw.current_jackpot_cents : 0),
      time_to_claim_seconds: draw.time_to_claim_seconds != null ? draw.time_to_claim_seconds : null,
      draw_length_seconds: draw.draw_length_seconds != null ? draw.draw_length_seconds : null,
      valid_count: null,
      pending: true,
    });
  }

  const members = await validMembers(env, draw);
  if (!members.length) return json({ error: 'No valid members to draw from' }, 409);

  // UNBIASED uniform pick over the valid members, using the SAME rejection-sampled
  // CSPRNG (randInt over crypto.getRandomValues) the ball/raffle draws use.
  const winner = members[randInt(members.length)];
  const nameDisplay = await venueNameDisplay(env, draw.venue_id);
  const winnerName = formatMemberName(winner.first_name, winner.last_name, nameDisplay);

  // Once-per-day schedule audit stamp (schema column last_drawn_date). Host-allowed,
  // not metered. We stamp it rather than hard-block a re-draw so testing stays easy.
  // last_drawn_at is what the guard above reads; written first so the guard is armed before
  // the winner is returned, and retried without it if the column is not there yet.
  const today = new Date().toISOString().slice(0, 10);
  try {
    await sbPatch(env, 'vp_member_draws', 'id=eq.' + enc(drawId), { last_drawn_date: today, last_drawn_at: new Date().toISOString() });
  } catch (e) {
    await sbPatch(env, 'vp_member_draws', 'id=eq.' + enc(drawId), { last_drawn_date: today });
  }

  /* The durable record now starts HERE, not at resolve. A draw that was picked and then lost on
     bad wifi left nothing behind at all, so the morning after nobody could say who was drawn.
     Resolve UPDATES this row to claimed or jackpot_rolled. Forgiven if the migration that allows
     'drawn' has not been run yet, so a Worker deployed early still draws exactly as before. */
  try {
    await sbInsert(env, 'vp_member_draw_results', {
      draw_id: drawId, outcome: 'drawn',
      amount_cents: draw.current_jackpot_cents != null ? draw.current_jackpot_cents : 0,
      member_id: winner.id, member_number: winner.member_number, winner_name: winnerName,
    }, false);
  } catch (e) { /* the constraint has not been widened yet: the draw still runs */ }

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

  /* Idempotency: a double-tap or a retry must not write a second audit row or
     advance the jackpot twice.

     THIRTY SECONDS WAS SHORTER THAN THE CONSOLE'S OWN PATIENCE. The members
     console aborts its fetch at FIFTEEN seconds and tells the host "Could not
     roll the jackpot over. Try again." A host reads that, looks up, and taps
     again forty seconds later - past the window - so the rollover row was
     written twice and the increment applied twice. A $2,400 jackpot with a $100
     increment became $2,600 rather than $2,500, permanently, and the wall
     announced the wrong number every week after. The claim path has the same
     shape: a second 'claimed' row means the prizes-given report says the venue
     handed over $2,900 when it handed over $2,400.

     Five minutes covers a human reading a banner and trying again, and is far
     inside the gap between two genuine draws on the same draw row: resolving,
     drawing again and resolving again inside five minutes is not something a
     members draw does. */
  const lastResolved = draw.last_resolved_at ? new Date(draw.last_resolved_at).getTime() : 0;
  if (lastResolved && (Date.now() - lastResolved) < 300000) {
    /* AND REPORT WHAT ACTUALLY HAPPENED, not what the jackpot is now.

       This returned draw.current_jackpot_cents, which after a claim is the
       RESET starting amount. The console feeds that straight to the TV, so a
       room that had just been told the winner took $2,400 watched the screen
       count up to $500. The audit row is the truth; read it. */
    let saidAmount = draw.current_jackpot_cents, saidOutcome = outcome;
    try {
      // drawn_at, NOT created_at: this table has no created_at, so PostgREST
      // rejected the whole select and the catch below swallowed it. The fallback
      // is draw.current_jackpot_cents, which after a claim is the RESET starting
      // amount -- exactly the fault the comment above says was fixed. A room told
      // the winner took $2,400 watched the screen count up to $500. This read has
      // never once succeeded. Confirmed against the live database 5 Sep 2026.
      const prev = await sbGet(env, 'vp_member_draw_results',
        'draw_id=eq.' + enc(drawId) + '&select=outcome,amount_cents&order=drawn_at.desc&limit=1');
      if (prev.length) {
        if (prev[0].amount_cents != null) saidAmount = prev[0].amount_cents;
        if (prev[0].outcome) saidOutcome = prev[0].outcome;
      }
    } catch (e) { /* fall back to the draw row rather than fail a duplicate */ }
    return json({ draw_id: drawId, outcome: saidOutcome, amount_cents: saidAmount,
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
  /* Finish the row the DRAW opened, so one draw is one row. Falls back to an insert when there
     is no open row (an older Worker drew it, or the migration widening the outcome check has not
     been run yet), which is exactly the old behaviour. drawn_at, not created_at: this table has
     no created_at column. */
  let closed = 0;
  try {
    const open = await sbGet(env, 'vp_member_draw_results',
      'draw_id=eq.' + enc(drawId) + '&outcome=eq.drawn&select=id&order=drawn_at.desc&limit=1');
    if (open.length) {
      await sbPatch(env, 'vp_member_draw_results', 'id=eq.' + enc(open[0].id), resultRow);
      closed = 1;
    }
  } catch (e) { closed = 0; }
  if (!closed) await sbInsert(env, 'vp_member_draw_results', resultRow, false);

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
/* ------------------------------ POST /host/gaming/declare ------------------------------
 * A host pressed OK on their state's gaming rules before starting a game. Record it.
 *
 * This is the thing that answers OLGR's Third Party Operator point. The venue states, at
 * the time and in its own account, that IT is the conductor: it supplies the prize, it
 * handles any ticket sales, it keeps the proceeds. We supply software.
 *
 * Deliberately forgiving. It never refuses a declaration over a bad optional field, because
 * a rejected write here would mean no record of an acknowledgement that genuinely happened.
 * Any signed-in staff member may write one: the host on the floor is exactly who sees the
 * popup, and a record from a host is worth more than no record at all.
 * ------------------------------------------------------------------------------------ */
async function handleGamingDeclare(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);

  const venueId = String(b.venue_id || '').trim();
  if (!venueId) return json({ error: 'Missing venue_id' }, 400);
  assertUuid(venueId, 'venue_id');

  // Staff membership at THIS venue, so one venue cannot write records against another.
  const staff = await requireStaff(env, authUserId, venueId);

  const FORMATS = ['bingo90', 'bingo', 'musical', 'raffle', 'members'];
  const format = FORMATS.indexOf(String(b.format || '')) !== -1 ? String(b.format) : null;
  if (!format) return json({ error: 'Unknown format' }, 400);

  const entity = (b.entity_type === 'non_profit' || b.entity_type === 'for_profit') ? b.entity_type : null;
  const state = typeof b.state === 'string' ? b.state.slice(0, 8) : null;

  await sbInsert(env, 'vp_gaming_declarations', {
    venue_id: venueId,
    format: format,
    entity_type: entity,
    state: state,
    paid_entry: !!b.paid_entry,
    category_claimed: typeof b.category_claimed === 'string' ? b.category_claimed.slice(0, 300) : null,
    declared_by: staff && staff.id ? staff.id : null,
  }, false);

  return json({ ok: true });
}

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
  if (!staffCan(staff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
  }

  // Build the patch from the numeric/schedule columns only.
  const patch = {};
  /* min/max are enforced HERE, not by the input attributes: the settings fields are not inside a
     form and nothing calls checkValidity(), so a typo saved happily. A 5 second claim window gives
     the member five seconds to reach the bar before the host is prompted to roll the jackpot. */
  const intField = (key, min, max) => {
    if (b[key] == null) return;
    let n = parseInt(b[key], 10);
    if (isNaN(n)) return;
    if (min != null && n > 0 && n < min) n = min;   // 0 stays 0: that means "no window", a real choice
    if (min != null && n < 0) n = min;
    if (max != null && n > max) n = max;
    patch[key] = n;
  };
  intField('starting_amount_cents', 0);
  intField('increment_cents', 0);
  intField('current_jackpot_cents', 0);
  intField('time_to_claim_seconds', 30, 3600);
  intField('draw_length_seconds');
  // The name is editable on an EXISTING draw too. It was only ever read on the create branch, so
  // a venue renaming its draw was told "saved" and the TV kept showing the old name forever.
  if (b.name != null) { const nm = String(b.name).slice(0, 120).trim(); if (nm) patch.name = nm; }
  if (b.draw_day != null) patch.draw_day = String(b.draw_day).slice(0, 20);
  if (b.draw_time != null) patch.draw_time = String(b.draw_time).slice(0, 20);
  // The owner sets when the draw started running (shown as "running since" on the TV). Only a
  // real YYYY-MM-DD is accepted so a bad value can never overwrite it.
  /* An empty string is a real instruction: clear it. The pages now always send this field, but a
     blank failed the date regex and fell through, so the value silently stayed put and "running
     since" could still never be removed. The column is a date, so clearing means null, not ''. */
  if (b.date_started != null) {
    const ds = String(b.date_started).trim().slice(0, 10);
    if (!ds) patch.date_started = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) patch.date_started = ds;
  }
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
  /* Default the two numbers the jackpot maths depends on. Neither was required anywhere, and a
     draw created with just a name behaved badly on the night: a CLAIM resets the jackpot to
     starting_amount_cents, so with none set it either stayed at the full amount just paid out or
     dropped to whatever the column default was, and a ROLLOVER grows it by increment_cents, so
     the TV announced "Grew by $0, be here next week" and the board never moved.
     A venue that wants different numbers sets them; this just stops a silent nonsense. */
  if (row.starting_amount_cents == null) row.starting_amount_cents = 0;
  if (row.increment_cents == null) row.increment_cents = 0;
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
  if (!staffCan(_rstaff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
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
  if (!staffCan(staff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
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
  /* "Added 0" on a re-paste reads like a failure when it is the list already being right.
     skipped_existing is the difference between "nothing happened" and "they were all
     already there", and the account page shows it the moment it arrives. */
  const skipped = members.length - rows.length;
  return json({ ok: true, added: rows.length, skipped_existing: skipped > 0 ? skipped : 0, roster_id: rosterId });
}

/* POST /host/members/update  (MANAGER/OWNER) : fix a name on the members list.
 *   body: { draw_id | venue_id, number, first_name?, last_name?, name? }  -> { ok, member }
 *
 * Import splits a pasted name on the FIRST space, so "Mary Anne Smith" is stored as first name
 * Mary and surname "Anne Smith", and that is what goes on the TV when she wins. Until now the
 * only fix was to remove her and paste her back, which also detaches her past wins. This edits
 * the row in place. Either send first_name and last_name separately, which is the whole point,
 * or send name and it splits the same way import does.
 * The member NUMBER is not editable here on purpose: it is the key the club prints on cards and
 * the one thing the draw is announced by. Changing it is a remove and a re-add, deliberately.
 */
async function handleMembersUpdate(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);

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
    return json({ error: 'Only a manager or owner can change the members list' }, 403);
  }
  if (!staffCan(staff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
  }

  const num = parseInt(b.number, 10);
  if (isNaN(num)) return json({ error: 'Enter the member number to change' }, 400);

  if (!rosterId) {
    const rosters = await sbGet(env, 'vp_member_rosters', 'venue_id=eq.' + enc(venueId) + '&select=id&limit=1');
    if (!rosters.length) return json({ error: 'This venue has no members list yet' }, 404);
    rosterId = rosters[0].id;
  }

  const found = await sbGet(env, 'vp_members',
    'roster_id=eq.' + enc(rosterId) + '&member_number=eq.' + enc(String(num)) + '&select=id,first_name,last_name&limit=1');
  if (!found.length) return json({ error: 'No member with that number on this list' }, 404);

  let first = b.first_name != null ? String(b.first_name).trim() : null;
  let last = b.last_name != null ? String(b.last_name).trim() : null;
  if (first === null && last === null && b.name != null) {
    const nm = String(b.name).trim();
    const sp = nm.indexOf(' ');
    first = sp === -1 ? nm : nm.slice(0, sp);
    last = sp === -1 ? '' : nm.slice(sp + 1).trim();
  }
  if (first === null && last === null) return json({ error: 'Send the name to change it to' }, 400);
  const patch = {};
  if (first !== null) {
    if (!first) return json({ error: 'A member needs a first name' }, 400);
    patch.first_name = first.slice(0, 80);
  }
  if (last !== null) patch.last_name = last.slice(0, 80);

  const ok = await sbPatch(env, 'vp_members', 'id=eq.' + enc(found[0].id), patch);
  if (ok === false) return json({ error: 'Could not save that name. Please try again.' }, 502);
  return json({ ok: true, member: { number: num,
    first_name: patch.first_name != null ? patch.first_name : found[0].first_name,
    last_name: patch.last_name != null ? patch.last_name : found[0].last_name } });
}

/* POST /host/members/remove  (MANAGER/OWNER) : take one person off the members list.
 *   body: { draw_id | venue_id, number }  -> { ok, removed }
 *
 * The list could be imported and never edited, which is a problem well beyond tidiness: a member
 * asking to come off a list a venue holds about them is a privacy request, not a preference, and
 * until now the honest answer was that we could not do it. So this is a real delete, not a flag.
 * Their past wins in vp_member_draw_results are keyed by the result row, not by this row, so the
 * club's own history of who won what survives them leaving the list.
 */
async function handleMembersRemove(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);

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
    return json({ error: 'Only a manager or owner can change the members list' }, 403);
  }
  if (!staffCan(staff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
  }

  const num = parseInt(b.number, 10);
  if (isNaN(num)) return json({ error: 'Enter the member number to remove' }, 400);

  if (!rosterId) {
    const rosters = await sbGet(env, 'vp_member_rosters', 'venue_id=eq.' + enc(venueId) + '&select=id&limit=1');
    if (!rosters.length) return json({ error: 'This venue has no members list yet' }, 404);
    rosterId = rosters[0].id;
  }

  const found = await sbGet(env, 'vp_members',
    'roster_id=eq.' + enc(rosterId) + '&member_number=eq.' + enc(String(num)) + '&select=id,first_name,last_name&limit=1');
  if (!found.length) return json({ error: 'No member with that number on this list' }, 404);

  /* Detach their past wins FIRST. vp_member_draw_results.member_id references this row, and which
     ON DELETE rule that FK carries is not readable from here. Both possibilities are bad: RESTRICT
     fails the delete for exactly the long-standing members most likely to ask to come off, and
     CASCADE quietly destroys the club's record of who won what. Nulling the link removes the
     ambiguity, and the result row already carries member_number and winner_name, so the history
     reads the same afterwards. */
  await sbPatch(env, 'vp_member_draw_results', 'member_id=eq.' + enc(found[0].id), { member_id: null })
    .catch(function () { /* no wins, or already detached: the delete below is still correct */ });

  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_members?id=eq.' + enc(found[0].id), {
    method: 'DELETE', headers: sbHeaders(env),
  });
  // No raw PostgREST text to the client: this file's rule is that no constraint or SQL detail leaks.
  if (!res.ok) return json({ error: 'Could not remove that member. Please try again.' }, 500);

  const nm = [found[0].first_name, found[0].last_name].filter(Boolean).join(' ');
  return json({ ok: true, removed: { number: num, name: nm } });
}

/* POST /host/members/draw-remove  (MANAGER/OWNER) : retire a draw the venue no longer runs.
 *   body: { draw_id }  -> { ok }
 *
 * ARCHIVES rather than deletes. vp_member_draw_results holds who won and when, which is what a
 * club reaches for when a member queries a draw months later, so the draw row has to stay put.
 * Clearing the day and time at the same time is what takes it off the TV. Note the filtering is
 * done by tv.html, which drops rows with no draw_day, NOT by the v_vp_screen_draws view, which has
 * no WHERE clause and will happily return an archived draw. One line of JS in one file is the whole
 * safety net; if another screen ever reads that view directly it must filter for itself.
 */
async function handleDrawRemove(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);

  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return json({ error: 'Missing draw_id' }, 400);
  assertUuid(drawId, 'draw_id');

  const dr = await sbGet(env, 'vp_member_draws',
    'id=eq.' + enc(drawId) + '&select=id,venue_id,name,archived_at,last_drawn_date,last_resolved_at');
  if (!dr.length) return json({ error: 'Draw not found' }, 404);

  const staff = await requireStaff(env, authUserId, dr[0].venue_id);
  if (staff.role !== 'owner' && staff.role !== 'manager') {
    return json({ error: 'Only a manager or owner can remove a draw' }, 403);
  }
  if (!staffCan(staff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
  }
  // Answer "is it already gone" only AFTER proving the caller has rights here, so this cannot be
  // used to probe whether a draw id exists at a venue the caller has nothing to do with.
  if (dr[0].archived_at) return json({ ok: true, already: true });

  /* A draw mid-round must not vanish from under the host running it.
     This CANNOT be asked of vp_member_draw_results: as the schema note above handleMembersDraw
     explains, outcome is NOT NULL and a row is only written at RESOLVE, so a live round has no
     row there at all. An earlier version queried outcome=is.null, which is a valid query that
     matches nothing, so the guard was decoration and a manager could archive a draw mid-round.
     The real signals are the two stamps on the draw itself: last_drawn_date is set when the
     winner is drawn, last_resolved_at when the claim or rollover lands. Drawn today and not yet
     resolved today means a round is on air. */
  // Same clock the draw itself stamps with (handleMembersDraw, "const today = new
  // Date().toISOString().slice(0,10)"). Matching it matters more than being clever about the
  // venue's timezone: comparing a locally-derived date against a UTC-stamped one would make this
  // guard fire on the wrong day. An earlier version called a helper that does not exist in this
  // file at all, which the syntax check could not see because an undefined function is a runtime
  // error, not a parse error.
  const today = new Date().toISOString().slice(0, 10);
  const drawnToday = String(dr[0].last_drawn_date || '').slice(0, 10) === today;
  const resolvedToday = String(dr[0].last_resolved_at || '').slice(0, 10) === today;
  if (drawnToday && !resolvedToday) {
    return json({ error: 'That draw has a round on air. Finish it, then remove the draw.' }, 409);
  }

  await sbPatch(env, 'vp_member_draws', 'id=eq.' + enc(drawId),
    { archived_at: new Date().toISOString(), draw_day: '', draw_time: '' });
  return json({ ok: true, name: dr[0].name || 'Members draw' });
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
  if (!staffCan(staff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
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
  if (!staffCan(staff, 'draws_raffles')) {
    return json({ error: 'You do not have permission to change draws and raffles. Ask the account owner.' }, 403);
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

/* --- POST /host/trivia/questions/update : fix a typo instead of deleting and retyping. ---
   body { question_id, question, options[4], correct_index, category, difficulty, image_url },
   Authorization: host JWT. Staff-gated through the question's own set, exactly like remove.
   The builder falls back to add-then-remove when this route is missing, which works but moves
   the question to the end of the night and mints a new id. */
async function handleTriviaUpdate(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);             // ENFORCED: valid host JWT
  const b = await readJson(request);
  const qid = String(b.question_id || '').trim();
  assertUuid(qid, 'question_id');
  const qrows = await sbGet(env, 'vp_questions', 'id=eq.' + enc(qid) + '&select=id,set_id');
  if (!qrows.length) return json({ error: 'Question not found' }, 404);
  await triviaSetForVenue(env, qrows[0].set_id, authUserId);        // ENFORCED: staff at the set's venue
  const clean = sanitizeQuestion(b);
  if (!clean) return json({ error: 'Fill the question, all four answers, and tick the correct one.' }, 400);
  if (clean.image_url && !/^https:\/\//i.test(clean.image_url)) {
    return json({ error: 'The picture link needs to start with https://' }, 400);
  }
  await sbPatch(env, 'vp_questions', 'id=eq.' + enc(qid), clean);
  return json({ ok: true });
}

/* --- POST /host/trivia/image-upload : the picture round. ---
   body { set_id, data:"data:image/webp;base64,..." }, Authorization: host JWT. Staff-gated
   through the set's venue. The builder shrinks the photo on the device first, so what arrives
   here is a small web copy, never the 4MB original. The returned URL goes in image_url on the
   question, which already flows to the TV and every phone.

   webp or jpeg only and 300KB, because that is what the builder sends and because a picture
   that has to load on forty phones at once over pub wifi has to be small. The bucket is public
   (a phone reads it with no key) and every path is under the venue's own id. */
function gB64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
async function gEnsureBucket(env, id) {
  try {
    await fetch(env.SUPABASE_URL + '/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, name: id, public: true, file_size_limit: 524288, allowed_mime_types: ['image/webp', 'image/jpeg'] }),
    });
  } catch (_) { /* already there: the POST 400s and the upload below still works */ }
}
async function handleTriviaImageUpload(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);             // ENFORCED: valid host JWT
  const b = await readJson(request);
  const set = await triviaSetForVenue(env, b.set_id, authUserId);   // ENFORCED: staff at the set's venue
  const m = String(b.data || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return json({ error: 'That did not look like a picture.' }, 400);
  const contentType = m[1].toLowerCase();
  if (!/^image\/(webp|jpeg)$/.test(contentType)) return json({ error: 'Pictures are saved as WEBP or JPG.' }, 400);
  const bytes = gB64ToBytes(m[2]);
  if (bytes.length > 300 * 1024) return json({ error: 'That picture is too big. Keep it under 300KB.' }, 400);
  await gEnsureBucket(env, 'trivia-images');
  const ext = contentType === 'image/webp' ? 'webp' : 'jpg';
  // Venue-scoped path. The question id is not known yet (the host picks the photo before the
  // question is saved), so the file gets a random name inside the venue's own folder.
  const path = 'trivia/' + set.owner_venue_id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.' + ext;
  const up = await fetch(env.SUPABASE_URL + '/storage/v1/object/trivia-images/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'apikey': env.SUPABASE_SERVICE_KEY, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!up.ok) { const t = await up.text(); return json({ error: 'The picture did not save. ' + t.slice(0, 160) }, 500); }
  return json({ ok: true, url: env.SUPABASE_URL + '/storage/v1/object/public/trivia-images/' + path });
}

/* --- POST /host/question/add-time : give the room a few more seconds. ---
   body { game_id, seconds }, Authorization: host JWT. Moves the REAL deadline, because the
   Worker is what throws away a late answer: a console that stretched only its own clock would
   promise the room ten more seconds and then bin what they tapped. Capped at 60 seconds a tap
   and only while a question is actually open. */
async function handleHostAddTime(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);             // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');
  const seconds = Math.max(1, Math.min(60, parseInt(b.seconds, 10) || 10));
  const [games, tg] = await Promise.all([
    sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=id,session_id,status,format'),
    sbGet(env, 'vp_trivia_games', 'game_id=eq.' + enc(gameId) + '&select=current_seq,phase,question_ends_at'),
  ]);
  if (!games.length) return json({ error: 'Game not found' }, 404);
  const game = games[0];
  if (game.format !== 'trivia') return json({ error: 'Not a trivia game' }, 400);
  if (game.status !== 'running') return json({ error: 'This game is not running' }, 409);
  if (!tg.length || tg[0].phase !== 'asking') return json({ error: 'No question is open' }, 409);
  const session = await getSession(env, game.session_id);
  await requireStaff(env, authUserId, session.venue_id);            // ENFORCED: staff at the game's venue
  const was = Date.parse(tg[0].question_ends_at) || Date.now();
  const endsAt = new Date(Math.max(was, Date.now()) + seconds * 1000).toISOString();
  const moved = await sbPatchReturning(env, 'vp_trivia_games',
    'game_id=eq.' + enc(gameId) + '&current_seq=eq.' + tg[0].current_seq + '&phase=eq.asking',
    { question_ends_at: endsAt });
  if (!moved || !moved.length) return json({ error: 'That question has already moved on.' }, 409);
  return json({ ok: true, ends_at: endsAt, seconds });
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
/* The host's Next question and Reveal in ONE database trip each (migration 73). Measured
 * 8 Sep 2026 under a Tuesday-shaped load of 1,000 rooms: both took 5 to 6 s at only 3 host
 * requests a second, because each is eight to twelve round trips made one after another
 * (game, trivia state, session, staff, venue, group, question, compare-and-set, event,
 * preview; a reveal also reads every answer and writes one PATCH per points bucket), and at
 * the gateway's ceiling every trip queues behind every other room's. vp_host_question and
 * vp_host_reveal make the same checks in the same order and return a status word plus the
 * same fields; the table below maps the word to the exact reply the many-trip path gave.
 *
 * If the functions are not there yet (migration 73 not run) PostgREST answers 404 and we
 * fall back to the old path, so the paste order cannot break a night. */
const HOST_TRIVIA_STATUS = {
  no_game:         [404, 'Game not found'],
  not_trivia:      [400, 'Not a trivia game'],
  not_running:     [409, 'This game is not running'],
  no_session:      [404, 'Session not found'],
  session_closed:  [409, 'This session is closed'],
  not_staff:       [403, 'Not authorised: you are not staff at this venue'],
  venue_missing:   [403, 'Venue not available'],
  venue_paused:    [403, 'Games are paused here tonight. Have a word with the staff.'],
  moved_on:        [409, 'That question has already moved on. Check the screen before tapping again.'],
  no_question:     [409, 'No question to reveal'],
  no_question_row: [404, 'Question not found'],
};
let hostTriviaRpcMissing = false;   // per isolate: once PostgREST says the functions are not there, stop asking
// Common front half of both host routes: verify the host, read the body, ask the function.
// Returns { rpc: <parsed jsonb> } on success, { pre } when the function is missing (fall back),
// or { reply } when the status word maps to an error reply.
async function hostTriviaRpc(request, env, json, fn) {
  const authUserId = await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return { reply: json({ error: 'Missing game_id' }, 400) };
  assertUuid(gameId, 'game_id');
  const pre = { authUserId, b, gameId };
  /* PHASE 2: WHAT THE ROOM IS HOLDING GOES IN BEFORE ANYTHING IS SCORED.
     It has to be first, because vp_host_reveal scores what is in the table at the moment it
     runs and nothing ever comes back for a question once the round has moved on. It is
     wrapped because it is an OPTIMISATION, not the game: if the room is missing, off, slow
     or broken the reveal goes ahead on what the database already has, which is exactly what
     a venue that is not on the room server does every night. */
  if (fn === 'vp_host_reveal') {
    try { await flushRoomAnswers(env, gameId); }
    catch (e) { console.warn('room answer flush failed, revealing on what the database has: ' + (e && e.message)); }
  }
  if (hostTriviaRpcMissing) return { pre };
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: sbHeaders(env),
    body: JSON.stringify({ p_game_id: gameId, p_auth_user_id: authUserId }),
  });
  if (res.status === 404) {   // function not deployed yet: old path, and remember for this isolate
    hostTriviaRpcMissing = true;
    console.warn(fn + ' missing (migration 73 not run); answering the slow way');
    return { pre };
  }
  if (!res.ok) throw dbError('rpc', fn, await res.text());
  const rpc = await res.json();
  const status = rpc && rpc.status;
  if (status === 'ok' || status === 'done') return { rpc };
  const reply = HOST_TRIVIA_STATUS[status];
  if (!reply) throw dbError('rpc', fn, 'unexpected status ' + status);
  return { reply: json({ error: reply[1] }, reply[0]) };
}

async function handleHostQuestion(request, env, json) {
  const r = await hostTriviaRpc(request, env, json, 'vp_host_question');
  if (r.reply) return r.reply;
  if (r.pre) return handleHostQuestionManyTrips(request, env, json, r.pre);
  const d = r.rpc;
  if (d.status === 'done') return json({ done: true });
  // HOST-ONLY response (authenticated staff): may include correct_index for the console.
  // The public trivia.question event was emitted inside the function, options only.
  return json({
    qseq: d.qseq, qi: d.qi, qtotal: d.qtotal,
    text: d.text, options: d.options, correct_index: d.correct_index,
    ends_at: d.ends_at, secs: d.secs, image_url: d.image_url || null,
    next_preview: d.next_preview ? {
      qseq: d.next_preview.qseq, text: d.next_preview.text,
      options: Array.isArray(d.next_preview.options) ? d.next_preview.options : [],
      correct_index: d.next_preview.correct_index,
      image_url: d.next_preview.image_url || null,
    } : null,
  });
}

// The pre-73 path, kept only as the fallback above. `pre` carries the verified host and the
// body already read (a request body can only be read once).
async function handleHostQuestionManyTrips(request, env, json, pre) {
  const authUserId = pre ? pre.authUserId : await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = pre ? pre.b : await readJson(request);
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

/* ================= PHASE 2: THE ANSWERS THE ROOM IS HOLDING GO IN, IN ONE INSERT =========
 *
 * WHY. Measured on the Sydney staging project, 10 Sep 2026:
 *
 *     6 trivia rooms,  359 players    15 calls a second   healthy, the TVs polled in 89 ms
 *    15 trivia rooms,  811 players    asked 36, got 25    COLLAPSED, the TVs polled in 19 s
 *    35 bingo rooms,   300 venues     13 calls a second   healthy, a ball on the wall in 84 ms
 *
 * A trivia room costs about 1.2 database calls a second, because thirty phones each answer
 * every twenty-five seconds and every single answer is its own write. A bingo room costs a
 * tenth of that. The database gateway serves roughly 20 a second on Micro, so trivia ran
 * out at eight to ten venues while bingo ran to hundreds, and trivia is the format Dean can
 * sell in Queensland today.
 *
 * So the phones send their answers to the room instead (venueplay-room.js). The room holds
 * them on its own disk and tells each phone it is in. When the host reveals, this runs
 * FIRST: it takes everything the room holds for the question that is actually open, writes
 * it in ONE insert, and then vp_host_reveal scores it exactly as it always has. Thirty
 * writes a question become one.
 *
 * The four things this must never get wrong:
 *   1. NOTHING IS LOST. The room only forgets an answer once this has written it (the ack
 *      below) and Durable Object storage is on disk, so an evicted room still has it.
 *   2. NOTHING IS SCORED HERE. This writes rows. vp_host_reveal decides right, wrong and
 *      how many points, on the same path as an answer that came in over HTTP.
 *   3. A LATE ANSWER STILL LOSES. The room stamps the moment an answer ARRIVED; anything
 *      stamped after question_ends_at, which is read fresh from the database right here, is
 *      dropped and never written.
 *   4. IT IS OPTIONAL. No ROOM binding, the global off switch on, an empty room or a room
 *      that does not answer inside a second and a half: this returns and the reveal carries
 *      on with whatever the database has, which is exactly today's behaviour.
 *
 * The caches below hold only things that cannot change while a game is running (which
 * session a game belongs to, and which question sits at a position in its set), so a reveal
 * costs three to four database calls in the steady state instead of thirty one.
 */
const ROOM_FLUSH_CACHE_MAX = 400;      // games kept in this isolate; past that, start again
const ROOM_PLAYER_TTL_MS   = 60000;    // re-read the players once a minute, so a kick lands within one
const roomGameCache   = new Map();     // game_id -> {session_id}
const roomQuestionCache = new Map();   // set_id|seq -> {id, n}
const roomPlayerCache = new Map();     // game_id -> {at, byHash: Map(token hash -> {id, session_id, kicked})}

function roomCachePut(cache, key, value) {
  if (cache.size >= ROOM_FLUSH_CACHE_MAX) cache.clear();
  cache.set(key, value);
  return value;
}

/* Which session this game belongs to. Fixed for the life of a game, so it is read once. */
async function roomGameContext(env, gameId) {
  const had = roomGameCache.get(gameId);
  if (had) return had;
  const games = await sbGet(env, 'vp_games', 'id=eq.' + enc(gameId) + '&select=session_id,format,status');
  if (!games.length || games[0].format !== 'trivia') return null;
  return roomCachePut(roomGameCache, gameId, { session_id: games[0].session_id });
}

/* THE ONE QUESTION, NOT THE SET.
 * This first read the whole set in one go and kept a seq -> id map, which is fewer calls
 * and wrong twice over. A venue's question bank is one SET, not one night: the load
 * project has 4,076 questions in the set every game draws from, so the read pulled a
 * thousand rows and their options on the first reveal of every room at once (measured
 * 10 Sep: the venue TVs' check-in jumped to 8.7 s at exactly that moment), and the row
 * limit that stopped it being worse silently dropped every question past the thousandth,
 * so an answer to one of those would never have been written at all.
 * One row per question, cached by set and seq because a question never changes. */
async function roomQuestion(env, setId, seq) {
  const key = setId + '|' + seq;
  const had = roomQuestionCache.get(key);
  if (had) return had;
  const qs = await sbGet(env, 'vp_questions',
    'set_id=eq.' + enc(setId) + '&seq=eq.' + encodeURIComponent(String(seq)) + '&select=id,options&limit=1');
  if (!qs.length) return null;
  return roomCachePut(roomQuestionCache, key, { id: qs[0].id, n: Array.isArray(qs[0].options) ? qs[0].options.length : 0 });
}

/* The phones in the room are known by the sha256 of their player token, which is the same
 * thing vp_player_answer looks a phone up by. This turns those hashes into player rows for
 * the one session, so a token minted at another venue resolves to nothing here. Re-read
 * whenever a hash turns up that is not in the map (somebody joined) or once a minute
 * (somebody was kicked). */
async function roomPlayerMap(env, gameId, sessionId, held) {
  const had = roomPlayerCache.get(gameId);
  let stale = !had || (Date.now() - had.at) > ROOM_PLAYER_TTL_MS;
  if (!stale) {
    for (let i = 0; i < held.length; i++) { if (!had.byHash.has(held[i].h)) { stale = true; break; } }
  }
  if (!stale) return had.byHash;
  const rows = await sbGet(env, 'vp_players',
    'session_id=eq.' + enc(sessionId) + '&select=id,token_hash,session_id,kicked&limit=5000');
  const byHash = new Map();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].token_hash) byHash.set(String(rows[i].token_hash).toLowerCase(), rows[i]);
  }
  return roomCachePut(roomPlayerCache, gameId, { at: Date.now(), byHash: byHash }).byHash;
}

/* ONE INSERT FOR THE WHOLE ROOM.
 * resolution=ignore-duplicates on the (game, question, player) unique index, because a
 * phone that got no acknowledgement from the room falls back to posting the answer to the
 * Worker, so the same answer legitimately arrives twice. The database keeps the first, as
 * it always has, rather than the batch failing whole because one row of it is a repeat. */
async function roomInsertAnswers(env, rows) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_trivia_answers?on_conflict=game_id,question_id,player_id', {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw dbError('insert', 'vp_trivia_answers', await res.text());
}

// Returns how many answers it wrote. Never throws: the caller reveals either way.
async function flushRoomAnswers(env, gameId) {
  if (!env.ROOM || roomOff(env)) return 0;
  // The open question and its deadline, read fresh. This is what decides which answers
  // count and which are too late, and it is the database's word, not the room's.
  const tg = await sbGet(env, 'vp_trivia_games',
    'game_id=eq.' + enc(gameId) + '&select=question_set_id,current_seq,phase,question_ends_at');
  if (!tg.length || !tg[0].current_seq || !tg[0].question_set_id) return 0;
  const t = tg[0];
  const qseq = t.current_seq;
  const held = await roomAnswersTake(env, gameId, qseq);
  if (!held || !held.length) return 0;

  const [ctx, q] = await Promise.all([
    roomGameContext(env, gameId),
    roomQuestion(env, t.question_set_id, qseq),
  ]);
  if (!ctx || !q) return 0;
  const endsAtMs = t.question_ends_at ? Date.parse(t.question_ends_at) : 0;
  const byHash = await roomPlayerMap(env, gameId, ctx.session_id, held);

  const rows = [], done = [], seen = new Set();
  for (let i = 0; i < held.length; i++) {                 // the room hands them over oldest first
    const a = held[i];
    const p = byHash.get(String(a.h || '').toLowerCase());
    if (!p || p.kicked || p.session_id !== ctx.session_id) continue;   // not a player in this game
    if (!(a.i >= 0 && a.i < q.n)) continue;                            // an option this question does not have
    if (endsAtMs && a.at > endsAtMs) continue;                         // LATE ANSWERS STILL LOSE
    if (seen.has(p.id)) continue;                                      // one answer per player, earliest wins
    seen.add(p.id);
    rows.push({
      game_id: gameId, question_id: q.id, player_id: p.id,
      answer_index: a.i, answered_at: new Date(a.at).toISOString(),
    });
    done.push(a.h);
  }
  if (!rows.length) return 0;
  await roomInsertAnswers(env, rows);
  // Only now, with the rows actually in the database, does the room let them go.
  await roomAnswersAck(env, gameId, qseq, done);
  return rows.length;
}

/* ------------------------------ POST /host/reveal ------------------------------
 * Host reveals the answer to the current question. The Worker is the ONLY place that
 * decides correctness and points: it reads correct_index server-side, stamps is_correct
 * and points_awarded onto every answer for this question, flips the phase to 'revealed',
 * and only THEN emits the correct_index + updated leaderboard on the PUBLIC channel.
 */
async function handleHostReveal(request, env, json) {
  const r = await hostTriviaRpc(request, env, json, 'vp_host_reveal');
  if (r.reply) return r.reply;
  if (r.pre) return handleHostRevealManyTrips(request, env, json, r.pre);
  const d = r.rpc;   // the phase was flipped, the answers scored and trivia.reveal emitted inside the function
  return json({ qseq: d.qseq, correct_index: d.correct_index, split: d.split, leaderboard: d.leaderboard, already: d.already === true });
}

// The pre-73 path, kept only as the fallback above (see handleHostQuestionManyTrips).
async function handleHostRevealManyTrips(request, env, json, pre) {
  const authUserId = pre ? pre.authUserId : await verifyHostJwt(request, env);           // ENFORCED: valid host JWT
  const b = pre ? pre.b : await readJson(request);
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

  /* CLOSE THE QUESTION FIRST, THEN SCORE IT. Not the other way round.

     This read the answers, scored them, and only THEN flipped the phase to revealed.
     For the whole of that stretch (a read plus a PATCH per points bucket, several
     hundred milliseconds in a full room) /player/answer still saw phase 'asking' and
     kept accepting answers. Any answer that landed in the gap was stored with
     is_correct null and never scored: the reveal had already read the table, and
     nothing ever comes back for a question once the round moves on. A host who
     reveals as the clock hits zero, which is every host, hits this with the
     player who tapped last. That player answered in time by the server's own
     clock and was scored as if they had not answered at all.

     The same shape let a double tap on Reveal run two full reveals: both read
     'asking', both scored, both broadcast.

     So the phase is flipped with a compare-and-set BEFORE anything is read:
     phase=eq.asking in the filter, and an empty result means either it was
     already revealed or another reveal got there first. From that instant
     /player/answer refuses. Only then are the answers read, so the set is closed.
     What can still slip through is an insert that passed the phase check before
     the flip and landed after our read; that is one round trip wide instead of
     the whole scoring pass, and the unscored-row sweep below picks it up on any
     later call. */
  let already = t.phase === 'revealed';
  let racedOut = false;   // another reveal is flipping it RIGHT NOW; it will do the scoring
  if (!already) {
    const flipped = await sbPatchReturning(env, 'vp_trivia_games',
      'game_id=eq.' + enc(gameId) + '&phase=eq.asking', { phase: 'revealed' });
    if (!flipped.length) { already = true; racedOut = true; }
  }

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
    /* Score whatever is UNSCORED, whether or not this call did the reveal. A row with
       is_correct null after a reveal is a player the race above left behind, or a
       reveal that threw between buckets; skipping them on the second call was how a
       question stayed half-scored for good. Scored rows are never touched again. The
       one caller that scores nothing is the loser of the compare-and-set above: the
       winner is scoring this same set at this same moment, and a later retry sweeps
       anything either of them missed. */
    if (racedOut) continue;
    if (a.is_correct !== null && a.is_correct !== undefined) continue;
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
  if (scored.length) {
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

  // (the phase was flipped above, before the answers were read)

  // Running totals from the leaderboard view (sums points_awarded per player).
  const board = await sbGet(env, 'v_vp_trivia_leaderboard',
    'game_id=eq.' + enc(gameId) + '&select=player_id,display_name,points&order=points.desc&limit=50');
  const leaderboard = board.map((r) => ({ name: r.display_name || 'Player', points: r.points || 0 }));

  // PUBLIC broadcast: NOW it is safe to send correct_index, the reveal has happened.
  await emitEvent(env, session, 'trivia.reveal', {
    qseq: t.current_seq, correct_index: q.correct_index, options, split, leaderboard,
  }, actorRef(staff));

  return json({ qseq: t.current_seq, correct_index: q.correct_index, split, leaderboard, already });
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

/* ------------------------------ POST /host/bingo/draw ------------------------------
 * THE BINGO CONSOLE'S DRAW LIVES HERE NOW. The console on /app is broadcast-only: it deals
 * its own cards and talks to the TV and the phones over the realtime channel, and for two
 * years of pub nights it also picked every ball itself, one at a time, with a rejection-
 * sampled CSPRNG. That is fair but not provable: the pick happened on the host's tablet and
 * nothing recorded it until the end-of-game report, which the same tablet wrote.
 *
 * From 8 Sep 2026 the console asks the Worker for a draw at game start and for every ball
 * after that. The whole order of 1..90 is shuffled here (shuffle1to90, the same Fisher-Yates
 * the Worker-dealt bingo uses), written to vp_bingo_draws and NEVER returned to any client;
 * each ball is handed over one at a time by vp_bingo_next_ball, which advances the index and
 * writes the ball row in one statement. Migration 70.
 *
 * FOOLPROOF BEATS PURE. If this Worker cannot be reached inside a few seconds the console
 * carries on from its own remaining pool for the rest of that game, exactly as it always
 * did, and reports the fallback here (best effort). A night must never stall on a server.
 * The record then says honestly which balls came from where. (Dean, 8 Sep 2026: "fine as
 * long as it's foolproof and also legal".)
 */
const BINGO_SERVER_HOLD_MS = 4000;   // the console holds 5s; this is the backstop against a double request

async function handleBingoDrawStart(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const venueId = String(b.venue_id || '').trim();
  if (!venueId) return json({ error: 'Missing venue_id' }, 400);
  assertUuid(venueId, 'venue_id');
  await requireStaff(env, authUserId, venueId);            // staff at THIS venue, and the kill-switch
  await assertVenueActive(env, venueId);
  let sessionId = null;
  if (b.session_id) { try { assertUuid(String(b.session_id), 'session_id'); sessionId = String(b.session_id); } catch (e) { sessionId = null; } }

  const rows = await sbInsert(env, 'vp_bingo_draws', {
    venue_id: venueId,
    session_id: sessionId,
    draw_seed: randomTokenHex(16),
    draw_order: shuffle1to90(),   // never leaves this function
    draw_index: 0,
  }, true);
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json({ draw_id: row.id });
}

/* The host's Call a ball and Draw a member in ONE database trip each (migration 76).
 * Measured from Dean's machine on 10 Sep 2026, three samples each: a Cloudflare-only call
 * (room presence) answers in 0.09 s and a single Supabase read through this Worker takes
 * 0.84 s, because the live database is in Singapore and the Worker runs at an Australian
 * edge. Calling a ball made six of those reads one after another (the draw row, the staff
 * row, the venue, its group, the last ball, then the draw itself), so the host waited two
 * to three seconds while the room, which gets the ball over the Cloudflare room in a tenth
 * of a second, watched the host's finger. The members draw made eight to ten.
 *
 * vp_bingo_ball and vp_members_draw make the same checks in the same order, including the
 * staff check in full, and return a status word plus the same fields; the table below maps
 * the word to the exact reply the many-trip path gave. The randomness has not moved: bingo
 * still hands out the order vp_bingo_next_ball wrote at game start, and the members draw
 * still picks with random values minted HERE by crypto.getRandomValues under the same
 * rejection rule randInt uses.
 *
 * If the functions are not there yet (migration 76 not run) PostgREST answers 404 and we
 * fall back to the old path, so the paste order cannot break a night. */
const HOST_DRAW_STATUS = {
  no_draw:       [404, 'Draw not found'],
  not_staff:     [403, 'Not authorised: you are not staff at this venue'],
  venue_missing: [403, 'Venue not available'],
  venue_paused:  [403, 'Games are paused here tonight. Have a word with the staff.'],
  finished:      [409, 'This game is finished'],
  local_mode:    [409, 'This game is being called from the tablet'],
  all_drawn:     [409, 'All 90 balls have been drawn'],
  no_members:    [409, 'No valid members to draw from'],
};
let hostDrawRpcMissing = false;   // per isolate: once PostgREST says the functions are not there, stop asking
// Common front half of both host draw routes: verify the host, read the body, ask the function.
// Returns { rpc: <parsed jsonb> } on success, { pre } when the function is missing (fall back),
// or { reply } when the status word maps to an error reply.
async function hostDrawRpc(request, env, json, fn, extra) {
  const authUserId = await verifyHostJwt(request, env);          // ENFORCED: valid host JWT
  const b = await readJson(request);
  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return { reply: json({ error: 'Missing draw_id' }, 400) };
  assertUuid(drawId, 'draw_id');
  const pre = { authUserId, b, drawId };
  if (hostDrawRpcMissing) return { pre, drawId };
  const args = Object.assign({ p_draw_id: drawId, p_auth_user_id: authUserId }, extra || {});
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify(args),
  });
  if (res.status === 404) {   // function not deployed yet: old path, and remember for this isolate
    hostDrawRpcMissing = true;
    console.warn(fn + ' missing (migration 76 not run); answering the slow way');
    return { pre, drawId };
  }
  if (!res.ok) throw dbError('rpc', fn, await res.text());
  const rpc = await res.json();
  const status = rpc && rpc.status;
  if (status === 'ok' || status === 'hold' || status === 'pending') return { rpc, drawId };
  if (status === 'retry') return { pre, drawId };   // every random value was rejected: draw the old way
  const reply = HOST_DRAW_STATUS[status];
  if (!reply) throw dbError('rpc', fn, 'unexpected status ' + status);
  return { reply: json({ error: reply[1] }, reply[0]) };
}

async function handleBingoBall(request, env, json) {
  const r = await hostDrawRpc(request, env, json, 'vp_bingo_ball', { p_hold_ms: BINGO_SERVER_HOLD_MS });
  if (r.reply) return r.reply;
  if (r.pre) return handleBingoBallManyTrips(request, env, json, r.pre);
  const d = r.rpc;
  if (d.status === 'hold') {
    return json({ error: 'The last ball is still going up. You can call again in ' + d.wait_seconds + ' seconds.' }, 429);
  }
  return json({ number: d.number, index: d.index });
}

// The pre-76 path, kept only as the fallback above. `pre` carries the verified host and the
// body already read (a request body can only be read once).
async function handleBingoBallManyTrips(request, env, json, pre) {
  const authUserId = pre ? pre.authUserId : await verifyHostJwt(request, env);
  const b = pre ? pre.b : await readJson(request);
  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return json({ error: 'Missing draw_id' }, 400);
  assertUuid(drawId, 'draw_id');

  const draws = await sbGet(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&select=id,venue_id,draw_index,mode,finished_at');
  if (!draws.length) return json({ error: 'Draw not found' }, 404);
  const draw = draws[0];
  await requireStaff(env, authUserId, draw.venue_id);
  if (draw.finished_at) return json({ error: 'This game is finished' }, 409);
  // Once the tablet has taken over, the server order is abandoned for the rest of the game:
  // handing out a server ball now could repeat a number the room has already daubed.
  if (draw.mode === 'local') return json({ error: 'This game is being called from the tablet' }, 409);

  // Double-request guard. The console holds its own button for five seconds; this catches a
  // second console, or one request retried by a phone on bad wifi. Read from the ball log, so
  // it is the time the LAST ball was actually written, not a timestamp anyone else maintains.
  if (draw.draw_index > 0) {
    const last = await sbGet(env, 'vp_bingo_draw_balls',
      'draw_id=eq.' + enc(drawId) + '&select=drawn_at&order=ordinal.desc&limit=1');
    if (last.length && last[0].drawn_at) {
      const since = Date.now() - new Date(last[0].drawn_at).getTime();
      if (since >= 0 && since < BINGO_SERVER_HOLD_MS) {
        return json({ error: 'The last ball is still going up. You can call again in ' + Math.ceil((BINGO_SERVER_HOLD_MS - since) / 1000) + ' seconds.' }, 429);
      }
    }
  }

  const drawn = await sbRpc(env, 'vp_bingo_next_ball', { p_draw: drawId });
  const row = Array.isArray(drawn) ? drawn[0] : drawn;
  if (!row || row.number == null) return json({ error: 'All 90 balls have been drawn' }, 409);
  return json({ number: row.number, index: row.new_index });
}

/* The console could not reach us and has started calling from its own pool. Record that,
 * and every ball it calls from then on, so the game's record is complete and honest. Best
 * effort from the console's side; from ours, refuse anything that does not add up (a number
 * already out, an ordinal that skips) rather than write a record that lies. */
async function handleBingoFallback(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return json({ error: 'Missing draw_id' }, 400);
  assertUuid(drawId, 'draw_id');
  const draws = await sbGet(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&select=id,venue_id,draw_index,mode');
  if (!draws.length) return json({ error: 'Draw not found' }, 404);
  const draw = draws[0];
  await requireStaff(env, authUserId, draw.venue_id);

  const number = parseInt(b.number, 10);
  const ordinal = parseInt(b.ordinal, 10);
  if (!(number >= 1 && number <= 90) || !(ordinal >= 1 && ordinal <= 90)) return json({ error: 'Bad ball' }, 400);

  if (draw.mode !== 'local') {
    await sbPatch(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId), {
      mode: 'local', fallback_at: ordinal,
      fallback_why: String(b.reason || 'worker unreachable').slice(0, 200),
    });
  }
  // The unique (draw_id, number) and primary key (draw_id, ordinal) refuse a repeat or a clash
  // with a server ball; sbInsert turns that into a 409, which the console ignores.
  await sbInsert(env, 'vp_bingo_draw_balls', { draw_id: drawId, ordinal, number, source: 'local' }, false);
  return json({ ok: true });
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

  // Anti-abuse rate limit (in this isolate's memory; see rateLimit). A joined
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
/* The whole answer in ONE database trip (migration 71). Before this the phone paid eight
 * round trips in a row (token, game, session, venue, group, trivia state, question, insert),
 * 1.25 s on an idle project and 2 s under a hundred rooms, while a TV lookup on the same
 * Worker took 0.15 s. vp_player_answer makes the same checks in the same order and returns a
 * status word; the table below maps it to the exact reply the eight-trip path gave, so a
 * phone cannot tell the difference except that it stops waiting.
 *
 * The rate limit is an anti-flood guard (30 a minute), not a correctness check, so it runs
 * ALONGSIDE the database call rather than before it: one answer that squeaks through while
 * the limiter is being read is still bounded by the one-per-question unique constraint.
 *
 * If the function is not there yet (migration 71 not run) PostgREST answers 404 and we fall
 * back to the old path, so the paste order cannot break a night. */
const ANSWER_STATUS = {
  bad_token:       [401, 'Invalid player token'],
  kicked:          [403, 'You have been removed from this game'],
  no_game:         [404, 'Game not found'],
  not_trivia:      [400, 'Not a trivia game'],
  wrong_game:      [403, 'Player is not in this game'],
  not_running:     [409, 'This game is not running'],
  no_session:      [404, 'Session not found'],
  session_closed:  [409, 'This session is closed'],
  venue_missing:   [403, 'Venue not available'],
  venue_paused:    [403, 'Games are paused here tonight. Have a word with the staff.'],
  no_question:     [409, 'No question is open'],
  time_up:         [409, 'Time is up for this question'],
  moved_on:        [409, 'That question has moved on'],
  no_question_row: [404, 'Question not found'],
  bad_index:       [400, 'Invalid answer_index'],
};
let answerRpcMissing = false;   // per isolate: once PostgREST says the function is not there, stop asking
async function handlePlayerAnswer(request, env, json) {
  if (answerRpcMissing) return handlePlayerAnswerEightTrips(request, env, json);
  const raw = request.headers.get('X-Player-Token') || '';
  if (!raw) throw httpError(401, 'Missing X-Player-Token');
  const b = await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');
  const answerIndex = parseInt(b.answer_index, 10);
  if (!(answerIndex >= 0 && answerIndex <= 9)) return json({ error: 'Invalid answer_index' }, 400);
  const qseq = b.qseq != null && b.qseq !== '' ? parseInt(b.qseq, 10) : null;
  const hash = await sha256Hex(raw);

  const rpc = fetch(env.SUPABASE_URL + '/rest/v1/rpc/vp_player_answer', {
    method: 'POST', headers: sbHeaders(env),
    body: JSON.stringify({ p_token_hash: hash, p_game_id: gameId, p_answer_index: answerIndex, p_qseq: Number.isFinite(qseq) ? qseq : null }),
  });
  const [res, rl] = await Promise.all([rpc, rateLimit(env, 'answer:player:' + hash, ANSWER_MAX_PER_PLAYER, 60)]);
  if (res.status === 404) {   // function not deployed yet: old path, and remember for this isolate
    answerRpcMissing = true;
    console.warn('vp_player_answer missing (migration 71 not run); answering the slow way');
    return handlePlayerAnswerEightTrips(request, env, json, { player: null, b, gameId, answerIndex, raw });
  }
  if (!res.ok) throw dbError('rpc', 'vp_player_answer', await res.text());
  if (!rl.ok) return json({ error: 'Too many answers right now, please wait a moment' }, 429);
  const rows = await res.json();
  const status = rows && rows[0] && rows[0].status;
  if (status === 'recorded') return json({ ok: true, recorded: true });   // NO correctness: that is only known after reveal
  if (status === 'already')  return json({ ok: true, recorded: false, reason: 'already_answered' });
  const reply = ANSWER_STATUS[status];
  if (!reply) throw dbError('rpc', 'vp_player_answer', 'unexpected status ' + status);
  return json({ error: reply[1] }, reply[0]);
}

// The pre-71 path, kept only as the fallback above. `pre` carries the body already read
// (a request body can only be read once).
async function handlePlayerAnswerEightTrips(request, env, json, pre) {
  const player = pre && pre.raw ? await verifyPlayerTokenRaw(pre.raw, env) : await verifyPlayerToken(request, env);   // ENFORCED: valid player token
  const b = pre ? pre.b : await readJson(request);
  const gameId = String(b.game_id || '').trim();
  if (!gameId) return json({ error: 'Missing game_id' }, 400);
  assertUuid(gameId, 'game_id');
  const answerIndex = parseInt(b.answer_index, 10);
  if (!(answerIndex >= 0 && answerIndex <= 9)) return json({ error: 'Invalid answer_index' }, 400);

  // Anti-abuse rate limit (in this isolate's memory; see rateLimit).
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
  // Equal points share a place, so the phone agrees with the wall. Ranking by list position
  // told two teams on 850 they were 3rd and 4th, decided by database order.
  let total = 0, rank = board.length ? board.length : 1, found = false;
  for (let i = 0; i < board.length; i++) {
    if (board[i].player_id === player.id) {
      total = board[i].points || 0;
      rank = i + 1;
      for (let j = i - 1; j >= 0 && (board[j].points || 0) === total; j--) rank = j + 1;
      found = true; break;
    }
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
  // Counted the same way the charge counts, or the approved figure and the
  // billed figure are unrelated numbers again.
  const approvedCount = countPlayersWhoPlayed(roster, await playerIdsWhoPlayed(env, sessionId));
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
  // Busy-night overage: if this night's metered headcount beat the plan cap, bill the
  // extra players now. Wrapped so a billing hiccup never blocks close, but never silently.
  try { await chargeNightOverage(env, session); }
  catch (e) { await recordOverageCrash(env, session, e, 'host_close'); }
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

/* WHO ACTUALLY COLLECTS A PENDING INVOICE ITEM.
 *
 * Every charge in this file is a Stripe invoiceitem, which is a line waiting for
 * an invoice. On a MONTHLY plan the next cycle is at most a month away and sweeps
 * it up, which is what we want: one invoice, all the extras on it.
 *
 * On an ANNUAL plan the next invoice can be eleven months away. Until then the
 * line just sits there, does not appear on any invoice, and IS DISCARDED IF THE
 * VENUE CANCELS. So an annual venue could run big night after big night, agree to
 * every charge on the console, and we would never be paid for any of it. There are
 * no annual venues yet, which is the only reason this has not already cost money.
 *
 * Two details matter and both are easy to get wrong:
 *
 *  - An invoiceitem created WITH `subscription` rides that subscription's next
 *    invoice. It is NOT safe from a standalone invoice: on 11 Sep 2026, live, an
 *    invoice raised with pending_invoice_items_behavior 'include' swept a $2.00 line
 *    that had just been moved onto Jess's monthly bill straight back onto a card
 *    charge. The comment that used to sit here said the opposite.
 *  - So a one-off invoice is opened EMPTY ('exclude'), and the night's line is
 *    created ON it by id (openInvoice, then invoiceitems with `invoice`). It carries
 *    exactly that line. An earlier night that could not be collected is tied to the
 *    subscription and waits for the renewal, which is what the venue was told.
 *
 * Keyed, because this moves money and a retry must not raise a second invoice.
 */
async function subscriptionInterval(env, acct) {
  try {
    if (!acct || !acct.stripe_subscription_id) return null;
    const sub = await stripeGet(env, 'subscriptions/' + enc(acct.stripe_subscription_id));
    const item = sub && sub.items && sub.items.data && sub.items.data[0];
    return (item && item.price && item.price.recurring && item.price.recurring.interval) || null;
  } catch (e) { return null; }
}

/* The payment method a standalone invoice should charge: the subscription's card first
   (where Checkout puts it), then the customer's own default. A string id or null. */
async function subscriptionPaymentMethod(env, acct) {
  const idOf = (x) => (typeof x === 'string' ? x : (x && x.id) || null);
  if (acct.stripe_subscription_id) {
    const sub = await stripeGet(env, 'subscriptions/' + enc(acct.stripe_subscription_id));
    const pm = sub && !sub.error && (idOf(sub.default_payment_method) || idOf(sub.default_source));
    if (pm) return pm;
  }
  const cus = await stripeGet(env, 'customers/' + enc(acct.stripe_customer_id));
  if (!cus || cus.error) return null;
  return idOf(cus.invoice_settings && cus.invoice_settings.default_payment_method) || idOf(cus.default_source) || null;
}

/* OPEN THE NIGHT'S INVOICE, EMPTY, WITH NOTHING ELSE ON IT.

   This used to be one step that created the invoice with pending_invoice_items_behavior
   'include', on the theory that a subscription-tied item would be left alone and anything else
   waiting on the customer might as well go out now. Live Stripe disagreed on 11 Sep 2026: the
   second Jess test night raised a $4.00 invoice, because the $2.00 the webhook had just moved
   onto her NEXT MONTHLY BILL (tied to the subscription and all) was swept straight back onto a
   same-day card charge. The same sweep would take a plan-add line or anything else parked for
   the renewal. So the invoice is opened EMPTY and the night's line is put on it by id; nothing
   the venue was told would wait for the monthly bill can ride it. auto_advance is off here so a
   crash between this and the line leaves a harmless empty draft, not an hour-later surprise. */
async function openInvoice(env, acct, idemKey, why) {
  if (!acct || !acct.stripe_customer_id) return { ok: false, reason: 'no_customer' };

  /* A GROUP BILLED BY INVOICE MUST NOT HAVE ITS CARD CHARGED.
     Everything here used to be charge_automatically, which is right for one pub and
     wrong for a group: a fifteen-venue total can exceed what a business card takes
     in a single charge, and groups generally will not pay by card at all - they want
     an invoice, a PO reference on it, and terms. So for those accounts we issue the
     invoice and let it sit until it is paid, rather than collecting now. See
     migration 67. */
  const byInvoice = acct.bill_by_invoice === true;
  const body = {
    customer: acct.stripe_customer_id,
    auto_advance: false,                      // finalised by hand in settleInvoice, never by Stripe's clock
    pending_invoice_items_behavior: 'exclude',
    description: why || 'VenuePlay extras',
  };
  if (byInvoice) {
    body.collection_method = 'send_invoice';
    // Stripe REQUIRES days_until_due with send_invoice, and rejects the call without
    // it, so a missing terms value falls back rather than failing the charge.
    body.days_until_due = Math.max(1, Math.min(120, parseInt(acct.invoice_terms_days, 10) || 14));
    if (acct.invoice_reference) {
      body['custom_fields[0][name]'] = 'Reference';
      body['custom_fields[0][value]'] = String(acct.invoice_reference).slice(0, 30);
    }
  } else {
    body.collection_method = 'charge_automatically';
    /* THE CARD IS ON THE SUBSCRIPTION, NOT THE CUSTOMER. Checkout attaches the card to the
       subscription as its default_payment_method and leaves the customer's own default empty,
       and a standalone invoice only looks at the customer. The third live Jess night (11 Sep
       2026, 9FGBRAJG-0009) was raised and finalised and then refused with "There is no
       default_payment_method set on this Customer or Invoice". So the subscription's card is
       named on the invoice itself. If there is none to find, the invoice is still raised and
       the caller records it unpaid; nothing here guesses a card. */
    const pm = await subscriptionPaymentMethod(env, acct);
    if (pm) body.default_payment_method = pm;
  }
  const inv = await stripePost(env, 'invoices', body, idemKey ? ('inv_' + idemKey) : null);
  if (!inv || inv.error) {
    console.log('[billing] could not open an invoice to collect now: ' +
                ((inv && inv.error && inv.error.message) || 'unknown') +
                ' - the line will ride the renewal instead');
    return { ok: false, reason: (inv && inv.error && inv.error.message) || 'unknown' };
  }
  return { ok: true, invoice: inv, byInvoice: byInvoice };
}

/* NOW MEANS NOW. Creating an invoice with auto_advance leaves it a DRAFT that Stripe
   finalises and charges on its own clock, about an hour later. The first real overage
   night to get this far (The Jolly Jess, 11 Sep 2026, in_1UEEss5JnH4tsSwMStIksM0D) sat
   as a $2.00 draft: right line, right date, nothing taken, no receipt. The point of
   collecting on the night is that the venue can match the charge to the night, so
   finalise it here and, for a card account, pay it here. A group billed by invoice gets
   the invoice sent instead, and its terms start now rather than in an hour.

   A declined card is reported as exactly that (ok, unpaid, the invoice stays OPEN and the
   billing Worker's webhook decides what happens next: up to $30 moves onto the next monthly
   bill, more stays open for Stripe's retries). It is not a failure of the night's billing,
   the money is owed and on the books, so the streak still advances. */
async function settleInvoice(env, opened, idemKey, cents) {
  const inv = opened.invoice, byInvoice = opened.byInvoice;
  const fin = await stripePost(env, 'invoices/' + enc(inv.id) + '/finalize', { auto_advance: true },
                               idemKey ? ('fin_' + idemKey) : null);
  if (!fin || fin.error) {
    console.log('[billing] invoice ' + inv.id + ' raised but could not be finalised: ' +
                ((fin && fin.error && fin.error.message) || 'unknown') + ' - it is a DRAFT and needs a hand');
    return { ok: true, invoice: inv.id, cents: cents, status: 'draft' };
  }
  if (fin.status === 'paid') return { ok: true, invoice: inv.id, cents: cents, status: 'paid' };
  const step = byInvoice ? 'send' : 'pay';
  const done = await stripePost(env, 'invoices/' + enc(inv.id) + '/' + step, {},
                                idemKey ? (step + '_' + idemKey) : null);
  if (!done || done.error) {
    console.log('[billing] invoice ' + inv.id + ' finalised but ' + step + ' failed: ' +
                ((done && done.error && done.error.message) || 'unknown') + ' - it is OPEN');
    return { ok: true, invoice: inv.id, cents: cents, status: 'open', problem: (done && done.error && done.error.message) || 'unknown' };
  }
  return { ok: true, invoice: inv.id, cents: cents, status: done.status || (byInvoice ? 'open' : 'paid') };
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
          /* NO `subscription` HERE, DELIBERATELY. This branch only runs on an annual
             plan, so the next subscription invoice is up to eleven months away and an
             item reserved for it would sit unbilled until then - and be discarded if
             the venue cancelled. Left unattached it can be swept onto an invoice we
             raise right now, a few lines below. */
          const idem = 'uplift_' + venue.id + '_' + newMax + '_' + Math.floor(periodEnd / 86400);
          /* The invoice is opened EMPTY first and this line is put on it by id, so nothing else
             waiting on the customer (a big-night extra moved to the monthly bill, say) is swept
             onto a same-day card charge. See openInvoice. If it cannot be opened the line is
             left on the customer as before and recorded as left pending. */
          const upliftInv = await openInvoice(env, acct, idem,
            (venue.name || 'Venue') + ': plan raised to ' + newMax + ' players');
          const upliftItem = {
            customer: acct.stripe_customer_id,
            currency: 'aud',
            amount: cents,
            description: (venue.name || 'Venue') + ': plan raised to ' + newMax + ' players after three big nights, '
                       + added + ' extra pro rata to renewal (' + months + ' months)',
          };
          if (upliftInv.ok) upliftItem.invoice = upliftInv.invoice.id;
          const res = await stripePost(env, 'invoiceitems', upliftItem, idem);
          if (res && res.error) {
            if (upliftInv.ok) {
              try { await stripePost(env, 'invoices/' + enc(upliftInv.invoice.id) + '/void', {}, 'void_' + idem); } catch (e) { /* recorded below */ }
            }
            /* AN ANNUAL UPLIFT IS COLLECTED BY THIS CALL AND NOTHING ELSE.
               The quantity update above carries proration_behavior 'none' on an
               annual plan, so it changes what they pay from the NEXT renewal and
               collects nothing now. This invoiceitem is the only thing that bills
               the extra capacity before then. quantityOk stayed true when it
               failed, so the venue kept the bigger plan, paid nothing for it until
               renewal, and stopped paying per head as well: the exact outcome the
               comment above says was fixed -- "an annual venue that outgrew its
               plan in month two got the bigger plan, and an end to paying per head,
               free until renewal".
               There was also no audit row, and the one written below recorded
               effective: 'next_invoice' because prorata was null, which is
               indistinguishable from a monthly venue. Found by audit 5 Sep 2026. */
            console.log('[overage] venue ' + venue.id + ' annual pro rata FAILED: ' +
                        ((res.error && res.error.message) || 'unknown') + '; rolling the uplift back');
            await sbInsert(env, 'vp_admin_audit', {
              action: 'plan_uplift_rolled_back_charge_failed',
              target: 'venue:' + venue.id,
              detail: { from: current, attempted: newMax, nights: peaks, cents: cents,
                        months: months, tier: tier,
                        stripe_error: (res.error && res.error.message) || 'unknown' },
            }, false).catch(() => {});
            quantityOk = false;
          } else {
            prorata = { cents: cents, months: months, added: added };
            const got = upliftInv.ok ? await settleInvoice(env, upliftInv, idem, cents) : upliftInv;
            if (!got.ok) {
              /* The line is still on the customer and the renewal will carry it, so
                 the uplift is NOT rolled back - they keep the bigger plan and we are
                 paid, just later than intended. Recorded so it can be chased. */
              prorata.collected = false;
              prorata.collect_error = got.reason;
              await sbInsert(env, 'vp_admin_audit', {
                action: 'plan_uplift_prorata_left_pending',
                target: 'venue:' + venue.id,
                detail: { from: current, to: newMax, cents: cents, months: months,
                          tier: tier, reason: got.reason },
              }, false).catch(() => {});
            } else {
              prorata.collected = true;
              prorata.invoice = got.invoice;
            }
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
/* Can this venue's account actually be billed? Exactly the condition chargeNightOverage uses
   before it writes a Stripe invoiceitem, so the consent screen and the charge can never disagree:
   no founding row, no Stripe customer, or no subscription means nothing will ever be charged, and
   a comp account has none of them by definition. Failure is treated as CHARGEABLE, so a Supabase
   blip shows the host the consent screen rather than quietly skipping it. */
async function venueCanBeCharged(env, venueId) {
  try {
    const vs = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=founding_id&limit=1');
    const foundingId = vs && vs[0] && vs[0].founding_id;
    if (!foundingId) return false;   // a grouped venue is invoiced by hand; nothing meters it here
    const accts = await sbGet(env, 'venueplay_founding',
      'id=eq.' + enc(foundingId) + '&select=status,stripe_customer_id,stripe_subscription_id&limit=1');
    const a = accts && accts[0];
    if (!a) return false;
    if (a.status === 'comp') return false;
    return !!(a.stripe_customer_id && a.stripe_subscription_id);
  } catch (e) { return true; }
}

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
/* WHO ACTUALLY PLAYED, as opposed to who opened the page.

   Dean's rule, and it is the right one: "They have to be in the game and have
   to answer one question."

   A vp_players row is minted the moment a phone loads /play while a session is
   live - before any name is typed, before any game starts. So somebody who
   scanned the QR on the table, looked at it and put the phone back in their
   pocket was a billable player, and the host's console never showed them,
   because the console counts people who typed a name and joined. The venue was
   invoiced for a room bigger than the one the host was looking at.

   What the server genuinely knows about participation:

     trivia          a row in vp_trivia_answers. Literally answered a question.
     bingo, musical  a row in vp_cards. A card is only ever dealt to a player who
                     is in the game when it starts, or who joins it after.

   Anything else - raffle, members draw - mints no vp_players at all and is
   unaffected.

   If this lookup fails for any reason it returns null and the caller falls back
   to counting every row, which is exactly what happened before this existed. A
   billing change must not become a billing outage. */
async function playerIdsWhoPlayed(env, sessionId) {
  try {
    const games = await sbGet(env, 'vp_games',
      'session_id=eq.' + enc(sessionId) + '&select=id&limit=200');
    if (!games.length) return null;   // no game rows at all: cannot tell, count everyone
    const ids = games.map((g) => g.id).join(',');
    const played = new Set();
    /* PAGED, because a truncated read here UNDER-BILLS and says nothing.
       This set decides who is charged for a big night. A fixed limit does not
       raise an error when it is hit, it just returns fewer players, so the
       fail-open guard above - which catches an exception and falls back to
       counting everyone - never fires. A busy club running several rounds is
       exactly the night this matters on, and exactly the night that overruns
       the cap. */
    const cards = await sbGetAll(env, 'vp_cards',
      'game_id=in.(' + ids + ')&select=player_id');
    for (const c of cards) if (c && c.player_id) played.add(c.player_id);
    const answers = await sbGetAll(env, 'vp_trivia_answers',
      'game_id=in.(' + ids + ')&select=player_id');
    for (const a of answers) if (a && a.player_id) played.add(a.player_id);

    /* BROADCAST BINGO LEAVES NO PER-PLAYER TRACE, AND THIS FUNCTION MADE IT FREE.
       vp_cards is written only inside /host/game and the musical starter. The bingo
       console never calls /host/game -- broadcast bingo has no server game at all,
       by design, so a night survives a Worker outage. So the set came back EMPTY,
       peak was 0, and chargeNightOverage returned before billing a cent. The
       flagship format has been unbillable since the day this was written, and the
       overage_streak never advanced either, so the three-big-nights plan uplift
       could never fire for a bingo-only venue. Found by audit 5 Sep 2026; it is my
       own regression from fixing a double-count.

       An empty set is not evidence that nobody played. It is evidence that this
       format records nothing, so fall back to counting PEOPLE who joined, which is
       both the old behaviour and the number the host was shown and consented to.
       The ceiling still clamps it to what they approved. */
    if (!played.size) return null;
    return played;
  } catch (e) {
    console.log('[overage] could not tell who played: ' + String((e && e.message) || e));
    return null;   // caller falls back to the old count
  }
}

/* Only the rows that belong to somebody who played, deduped by device. */
function countPlayersWhoPlayed(rows, played) {
  if (!played) return countPlayers(rows);
  return countPlayers((rows || []).filter((p) => p && played.has(p.id)));
}

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

/* Which NIGHT is it, on a 2am-to-2am Brisbane clock?
 *
 * A bingo session that finishes at 12:30am belongs to the night it started, not to the next day,
 * and a venue running three games on one Saturday must not read as three consecutive big nights.
 * Brisbane is a fixed UTC+10 with no daylight saving, so this is +10 for the timezone and -2 for
 * the boundary: eight hours forward, then take the date. */
function brisbaneNightKey(ms) {
  return new Date((ms || Date.now()) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* THE MONEY, in one place.
 *
 * Overage used to live entirely inside chargeNightOverage, which starts from a vp_sessions row
 * and counts vp_players. Broadcast bingo has neither: it has no server session and mints no
 * player rows, so the flagship format could never be billed a cent no matter how big the room
 * got. Rather than write a second copy of the pricing (two answers to "what does an extra head
 * cost" is how a venue gets billed twice, or not at all), the decision is factored out here and
 * both paths hand it the same three numbers: who, how many turned up, and what they are on.
 *
 * peak      players actually counted, already clamped to what the host approved
 * cap       the plan they are paying for
 * idemKey   Stripe idempotency: a retry of the same night must never bill twice
 */
async function applyOverageCharge(env, o) {
  const venueId = o.venueId, peak = Number(o.peak || 0), cap = Number(o.cap || 0);
  if (!env.STRIPE_SECRET_KEY) return;                          // overage billing not configured
  if (!cap || peak <= 0) return;

  const venues = await sbGet(env, 'vp_venues',
    'id=eq.' + enc(venueId) +
    '&select=id,name,founding_id,max_players,pending_players,overage_streak,overage_streak_peaks,overage_streak_day');
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
        { overage_streak: 0, overage_streak_peaks: [], overage_streak_day: null });
    }
    return;
  }
  if (!venue.founding_id) return;
  // Overage is charged ONLY when the host approved it on the night: when the room passed the
  // plan cap they saw a "you are over your plan, extra players are $X each" warning and tapped
  // OK (POST /host/overage/ack). No approval means no charge and no streak, so a fake-join flood
  // can never bill a venue or push one onto a bigger plan.
  if (!o.approved) return;
  const accts = await sbGet(env, 'venueplay_founding',
    'id=eq.' + enc(venue.founding_id) + '&select=id,stripe_customer_id,stripe_subscription_id,bill_by_invoice,invoice_terms_days,invoice_reference');
  const acct = accts && accts[0];
  if (!acct || !acct.stripe_customer_id || !acct.stripe_subscription_id) return;   // comp/test venue: never charge

  // Tier ('founding' | 'standard') comes from the subscription metadata we set at checkout,
  // the authoritative source (no price-id guessing, no extra env vars). If we cannot read a
  // known tier, do NOT guess a rate on real money: log and skip for manual handling.
  let tier = '';
  let subStatus = '';
  try {
    const sub = await stripeGet(env, 'subscriptions/' + enc(acct.stripe_subscription_id));
    tier = (sub && sub.metadata && sub.metadata.tier) || '';
    subStatus = (sub && sub.status) || '';
  } catch (e) { tier = ''; }

  /* THE FREE MONTH HAD FOUR DIFFERENT DEFINITIONS AND STRIPE'S IS THE REAL ONE.
     venueInFreeMonth reads vp_venues.created_at + 30 days. The billing Worker asks
     Stripe whether the subscription is trialing. The bingo console counts a
     CALENDAR month. And Stripe's own trial_end is set when the card is added.

     For an HQ-onboarded venue created_at is when HQ BUILT the venue, which can be
     weeks before the owner adds a card, and the billing Worker says so in as many
     words: "Their free month starts when they add the card, not when HQ built the
     venue." So HQ builds on day 0, the card goes in on day 20, Stripe's trial runs
     to day 50, and days 30 to 50 were billed $2 a head inside a window the welcome
     email and the terms both call free.

     This path already reads the subscription for metadata.tier and never looked at
     status. Stripe is the only one of the four that knows when the trial actually
     ends, so ask it. Found by audit 5 Sep 2026. */
  if (subStatus === 'trialing') {
    console.log('[overage] ' + o.idemKey + ' subscription is trialing: inside the free month, not charging');
    return;
  }

  if (tier !== 'founding' && tier !== 'standard') {
    console.log('[overage] ' + o.idemKey + ' unknown tier (metadata.tier="' + tier +
                '"): skipping charge for manual review');
    return;
  }
  /* Dean's model (12 Aug 2026): $2 a head for the first two big nights in a row. On the THIRD
     consecutive one they pay $1 a head and the plan moves up, because at that point it is not a
     big night any more, it is their crowd. The uplift is the SMALLEST of the three nights: a
     venue capped at 10 that draws 12, 13, 15 moves to 12, since 12 is the only number they hit
     every time. Paying twice at $2 and once at $1 is also what makes moving up the cheaper
     outcome for them, which is the point. */
  /* The streak counts NIGHTS, not charges. Bingo is billed per game, so without this a venue with
     three sessions on one Saturday would hit "three big nights in a row" before closing time and
     be moved onto a bigger plan permanently, off a single day's trade. A second game the same
     night is still charged in full; it just does not advance the run. */
  const night = brisbaneNightKey(Date.now());
  const sameNight = venue.overage_streak_day === night;
  const peaks = sameNight
    ? (Array.isArray(venue.overage_streak_peaks) && venue.overage_streak_peaks.length
        ? venue.overage_streak_peaks.slice()
        : [peak])
    : (Array.isArray(venue.overage_streak_peaks) ? venue.overage_streak_peaks.slice(-2) : []).concat([peak]);
  // A bigger room later the same night replaces that night's figure rather than adding to the run.
  if (sameNight && peaks.length) peaks[peaks.length - 1] = Math.max(peaks[peaks.length - 1], peak);
  const thirdInARow = !sameNight && peaks.length >= 3;

  /* THE HALF PRICE IS PAID FOR BY THE UPLIFT, SO DO THE UPLIFT FIRST.
     $1 a head on the third night exists because the venue moves up a plan and
     starts paying more every month from then on. upliftPlan returns null WITHOUT
     erroring in three ordinary cases: the venue has a reduction already scheduled,
     it raised its own cap mid-streak, or the Stripe call failed and was rolled
     back. The charge went out at $1 BEFORE any of that was known, its return value
     was discarded, and the streak was reset regardless -- so the venue got the
     discount, no uplift, and a fresh run. Repeatable for ever: a venue holding a
     scheduled reduction paid $20 instead of $40 every third big night, indefinitely.

     Attempting it first costs nothing: the pro-rata invoiceitem and the overage
     invoiceitem are separate documents and the order between them does not matter.
     Found by audit 5 Sep 2026. */
  let upliftedTo = null;
  if (thirdInARow) {
    upliftedTo = await upliftPlan(env, venue, acct, Math.min.apply(null, peaks), peaks, tier);
    if (upliftedTo == null) {
      console.log('[overage] ' + o.idemKey + ' third big night but the uplift did not happen: ' +
                  'charging the full $2 and keeping the streak');
    }
  }
  const halfPrice = thirdInARow && upliftedTo != null;
  const rateDollars = halfPrice ? 1.00 : 2.00;
  const amountCents = Math.round(overage * rateDollars * 100);
  if (amountCents <= 0) return;

  /* THE NIGHT THEY PLAYED, IN AUSTRALIAN ORDER. Not the moment we billed it.

     new Date() was wrong twice over. It read 2026-09-10, which is not how an Australian
     invoice states a date. And it was the time of the CHARGE, not of the night: the
     nightly sweep raises these at 3am, so a Saturday night closed by the sweep was
     labelled Sunday on the venue's own bill. Nobody can reconcile that against their
     till.

     brisbaneNightKey is the same function the billing streak uses to decide which night
     a game belongs to, including the 2am rollover that keeps a late finish on the right
     night. Feeding it the SESSION's own opening time means the date on the bill is the
     night the streak counted and the night the room was actually full. Then day/month/
     year, which is what a pub's bookkeeper reads. */
  /* FROM o.openedAt, NOT FROM A `session` THIS FUNCTION DOES NOT HAVE.

     The first version of this line read session.opened_at. applyOverageCharge takes (env, o)
     and has no session in scope, so that was a ReferenceError on every ACTIVE subscription,
     thrown after the trialing check and before the Stripe call, and swallowed whole by the
     "billing never blocks close" catch in both callers. The live test on 11 Sep 2026 opened a
     night at The Jolly Jess with one player over the cap, the host approved it, the round was
     played and the night closed cleanly, and Stripe never heard a word: no item, no invoice,
     no audit row, streak still 0. A trialing venue tested a minute earlier had passed, because
     it returned before reaching the line. See overage-charge.test.js, which now RUNS this
     function to the Stripe call, and the crash audit rows both callers write. */
  const nightMs = Date.parse(o.openedAt || '') || Date.now();
  const when = brisbaneNightKey(nightMs).split('-').reverse().join('/');
  /* ANNUAL IS BILLED NOW, MONTHLY RIDES THE NEXT INVOICE.
     A pending invoiceitem needs an invoice to land on. Monthly gets one within the
     month, so attach it to the subscription and let the cycle collect it. Annual
     might not see another invoice for eleven months, and the item is discarded if
     they cancel, so it is raised on its own invoice immediately - which means NOT
     attaching it to the subscription, or a standalone invoice cannot pick it up. */
  /* EVERY CHARGE GETS ITS OWN INVOICE, MONTHLY OR ANNUAL.

     Dean, 11 Sep 2026: "We need to invoice every time we charge someone so their accounts
     team isnt waiting a month to verify a charge."

     A monthly venue's overage used to be attached to the subscription and swept up by the
     next cycle, so a $6 charge agreed on a Saturday appeared on an invoice up to a month
     later, by which time the person who tapped OK has forgotten and the venue's bookkeeper
     has an unexplained line. A pub's accounts team checks a charge against the night it
     happened or not at all.

     So the item is created WITHOUT `subscription` and collected straight away, which is
     exactly what the annual path already did. If collection fails the line simply stays on
     the customer and the next invoice carries it, with an audit row saying so: it is never
     lost, only late.

     THE COST OF THIS, so it is a decision and not a surprise: each invoice is its own card
     transaction, and Stripe's fixed fee is about 30c. On a $6 overage that is 5%, where the
     same $6 riding the monthly invoice costs almost nothing extra. Dean's call, made
     knowingly: a venue that can verify a charge on the night is worth more than the fee. */
  const billNow = true;
  /* QUANTITY x UNIT PRICE, AND THE DATE OF THE NIGHT IT WAS FOR.

     This used to be one lump `amount` with everything crammed into the description:
     "Big night extra players - The Jolly Jess - 2026-09-10 - 3 over 1 at $2.00". A
     bookkeeper reading the invoice got a single figure and a sentence to parse.

     Dean, 11 Sep 2026: "it should say Not Jess - 1 Extra Player - <DATE> then the QTY
     changes. I guess all I want is transparency."

     So Stripe is given the quantity and the unit price and does what it is good at:
     the invoice shows 3 x $2.00 against a line naming the venue and the night. The
     arithmetic is exact, not a rounding of a lump: amountCents was already
     overage x rateDollars x 100, so the unit divides evenly by construction. */
  const item = {
    customer: acct.stripe_customer_id,
    currency: 'aud',
    quantity: overage,
    /* unit_amount_decimal, NOT unit_amount. Stripe's invoice item has no top-level unit_amount
       (a Price does, which is where the name came from). On 11 Sep 2026 the first real overage
       night to reach Stripe was refused with "Received unknown parameter: unit_amount" and the
       venue was not billed. The fake Stripe in overage-charge.test.js now refuses any parameter
       the real one does not document. */
    unit_amount_decimal: String(Math.round(rateDollars * 100)),
    description: (venue.name || 'Venue') + ' - Extra Player - ' + when +
                 /* SHORT, because this is a line on Stripe's own invoice page and a long
                    parenthetical wraps badly beside the amount. The email explains it
                    properly; this only has to be recognisable. Kept in step with the
                    matcher in vpaUpliftNoticeHtml, which looks for "plan moved up". */
                 (halfPrice ? ' (3rd big night, plan moved up)' : ''),
  };
  /* THE INVOICE IS OPENED BEFORE THE LINE EXISTS, and the line is created ON it. That is the
     only way Stripe lets a one-off invoice carry exactly one line and nothing else that
     happens to be waiting on the customer (see openInvoice). If the invoice cannot be opened,
     the line is tied to the subscription instead and rides the renewal, which is the old
     "left pending" behaviour, now with the tie that makes it land there and nowhere else. */
  let opened = { ok: false, reason: 'not billing now' };
  if (billNow) {
    opened = await openInvoice(env, acct, o.idemKey,
      'VenuePlay: big night extra players, ' + (venue.name || 'venue') + ' ' + when);
  }
  if (opened.ok) item.invoice = opened.invoice.id;
  else item.subscription = acct.stripe_subscription_id;
  const res = await stripePost(env, 'invoiceitems', item, o.idemKey);
  if (!res || res.error) {
    /* The empty draft must not be left behind to confuse a bookkeeper. Best effort, keyed. */
    if (opened.ok) {
      try { await stripePost(env, 'invoices/' + enc(opened.invoice.id) + '/void', {}, 'void_' + o.idemKey); } catch (e) { /* the audit row below still says what happened */ }
    }
    console.log('[overage] ' + o.idemKey + ' Stripe invoiceitem FAILED: ' +
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
          source: o.idemKey,
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

  if (billNow) {
    const got = opened.ok ? await settleInvoice(env, opened, o.idemKey, amountCents) : opened;
    if (!got.ok) {
      /* Not a failure to bill: the line is still on the customer and the renewal
         invoice will carry it. But on an annual plan that is months away, so it is
         worth an audit row somebody can find. */
      try {
        await sbInsert(env, 'vp_admin_audit', {
          actor_admin: null, actor_label: 'system',
          action: 'overage_left_pending_until_renewal',
          target: venue.id,
          detail: { source: o.idemKey, venue_name: venue.name || null,
                    amount_cents: amountCents, reason: got.reason },
        }, false);
      } catch (e) { /* audit is best effort */ }
    } else if (got.status !== 'paid') {
      /* Raised, finalised, and the card said no (or a group's invoice went out with
         terms). The money is owed and on the books, so this is not a billing failure,
         but a card that keeps declining is something HQ has to know about. */
      console.log('[overage] ' + o.idemKey + ' invoice ' + got.invoice + ' is ' + got.status +
                  (got.problem ? ' (' + got.problem + ')' : ''));
      if (!acct.bill_by_invoice) {
        try {
          await sbInsert(env, 'vp_admin_audit', {
            actor_admin: null, actor_label: 'system',
            action: 'overage_invoice_unpaid',
            target: venue.id,
            detail: { source: o.idemKey, venue_name: venue.name || null, invoice: got.invoice,
                      amount_cents: amountCents, status: got.status, reason: got.problem || null },
          }, false);
        } catch (e) { /* audit is best effort */ }
      }
    } else {
      console.log('[overage] ' + o.idemKey + ' PAID: invoice ' + got.invoice + ' ' +
                  (amountCents / 100).toFixed(2) + ' AUD, ' + overage + ' x ' + rateDollars.toFixed(2));
      /* A SUCCESSFUL CHARGE LEFT NO RECORD ANYWHERE WE CAN QUERY.
         Every failing path writes a row: overage_invoice_unpaid, extras_moved_to_monthly,
         payment_failed_email. The success path wrote a console line, which expires with the
         Worker's logs and cannot be searched. On 11 Sep 2026 the first overage ever collected
         in production (invoice 9FGBRAJG-0016, $2.00) could only be found by asking Stripe:
         vp_admin_audit held six unpaid rows and not one paid one.
         "Did we bill this venue extra, and did the money arrive" has to be answerable from
         our own records, not from a third party's dashboard. */
      try {
        await sbInsert(env, 'vp_admin_audit', {
          actor_admin: null, actor_label: 'system',
          action: 'overage_charged',
          target: venue.id,
          detail: { source: o.idemKey, venue_name: venue.name || null, invoice: got.invoice,
                    amount_cents: amountCents, players_over: overage, rate_dollars: rateDollars,
                    night: night },
        }, false);
      } catch (e) { /* audit is best effort: it must never undo a charge that worked */ }
    }
  }

  // The streak only resets when the uplift actually happened. Without that, a
  // venue whose uplift keeps returning null starts a fresh run every third night
  // and collects the discount again each time.
  if (!halfPrice) {
    await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id),
      { overage_streak: peaks.length, overage_streak_peaks: peaks, overage_streak_day: night });
    return;
  }
  await sbPatch(env, 'vp_venues', 'id=eq.' + enc(venue.id),
    { overage_streak: 0, overage_streak_peaks: [], overage_streak_day: null });
}


/* The server-backed formats: trivia, musical bingo, raffles. A session exists and every player
   minted a row, so the count is the Worker's own and the host's approval is on the session. */
/* A CRASH IN THE CHARGE PATH IS A BILLING EVENT, NOT A LOG LINE.

   Both callers wrap chargeNightOverage so a Stripe hiccup can never stop a night from
   closing. That is right. What was wrong is that the catch was EMPTY, so a bug that threw
   on every active venue (a ReferenceError, 11 Sep 2026) looked identical to a quiet night:
   session closed, nothing owed, nothing anywhere. This writes the row the failed-Stripe
   branch already writes, so check-billing-truth.py and the HQ audit list can see it, and
   the night can be billed by hand. The audit insert is itself best effort. */
async function recordOverageCrash(env, session, err, where) {
  // message AND stack: some runtimes put the message in the stack, some do not.
  const msg = (String((err && err.message) || err) + ((err && err.stack) ? '\n' + err.stack : '')).slice(0, 500);
  console.log('[overage] CRASHED for session ' + (session && session.id) + ' (' + where + '): ' + msg);
  try {
    await sbInsert(env, 'vp_admin_audit', {
      actor_admin: null, actor_label: 'system',
      action: 'overage_charge_crashed',
      target: (session && session.venue_id) || null,
      detail: { source: 'overage_' + (session && session.id), where: where, error: msg,
                plan_cap: (session && session.plan_cap_at_start) || null },
    }, false);
  } catch (e) { /* never let the audit mask the close */ }
}

async function chargeNightOverage(env, session) {
  if (!env.STRIPE_SECRET_KEY) return;
  const cap = Number(session.plan_cap_at_start || 0);
  if (!cap) return;
  const players = await sbGet(env, 'vp_players',
    'session_id=eq.' + enc(session.id) + '&kicked=eq.false&select=id,device_id');
  const played = await playerIdsWhoPlayed(env, session.id);
  const counted = countPlayersWhoPlayed(players, played);
  if (played && players.length !== counted) {
    console.log('[overage] session ' + session.id + ': ' + players.length + ' phones opened the page, ' +
                counted + ' actually played. Billing the ' + counted + '.');
  }
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
  await applyOverageCharge(env, {
    venueId: session.venue_id, peak: peak, cap: cap,
    idemKey: 'overage_' + session.id,
    approved: !!session.overage_approved,
    // The night the room was full, for the date on the bill. See applyOverageCharge.
    openedAt: session.opened_at || session.started_at || null,
  });
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
    'auth_user_id=eq.' + enc(authUserId) + '&venue_id=eq.' + enc(venueId) + '&select=id,role,venue_id,permissions');
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

/* An owner can switch OFF an individual manager's rights, per manager, from the billing console.
   The billing Worker honours that (vpbCan) and billing.html hides the sections, but THIS Worker
   only ever asked the role, so a manager with "Draws & raffles" switched off could still set a
   jackpot to any figure, import or delete the members list, or archive a draw -- by calling the
   route the hidden button would have called. A permission enforced in one of the two places that
   check it is not enforced at all.  (2 Sep 2026)

   Same rule as vpbCan(): no perms object means full rights (owners and View-as admins have none),
   and a right is only withheld when the owner has explicitly set it false. */
function staffCan(staff, key) {
  if (!staff || staff.role === 'owner') return true;
  const p = staff.permissions;
  return !p || p[key] !== false;
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
  return verifyPlayerTokenRaw(raw, env);
}
async function verifyPlayerTokenRaw(raw, env) {
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
  /* Three reads that only need the session id go out together, and every running game
     of the session comes back in one read instead of one read per format. Measured 8 Sep
     2026: a lobby snapshot was six trips one after another (session, slug, players, then
     bingo, trivia, musical, raffle each asked separately), a trivia one was nine, at 0.1 to
     0.15 s each, so the join answered in over a second. The result is byte-for-byte what it
     was: the same fields, the same one-game-wins-in-this-order rule below. */
  const [sessions, players, running] = await Promise.all([
    sbGet(env, 'vp_sessions', 'id=eq.' + enc(sessionId) + '&select=id,venue_id,status,state_version,join_code,plan_cap_at_start,title'),
    sbGet(env, 'vp_players', 'session_id=eq.' + enc(sessionId) + '&kicked=eq.false&select=id,device_id'),
    sbGet(env, 'vp_games', 'session_id=eq.' + enc(sessionId) + '&status=eq.running&select=id,seq,format,config,status&order=seq.desc'),
  ]);
  if (!sessions.length) throw httpError(404, 'Session not found');
  const s = sessions[0];
  // the newest running game of a format, or an empty list: what each per-format read returned
  const runningOf = (format) => { const g = running.find((x) => x.format === format); return g ? [g] : []; };
  /* The venue's slug, because a broadcast-bingo phone now joins with a SESSION code and still has
     to find the venue's realtime channel, which is named from the slug. Without this the phone
     would know its session and not know which room it is in. */
  let venueSlug = null;
  try {
    const vs = await sbGet(env, 'vp_venues', 'id=eq.' + enc(s.venue_id) + '&select=slug&limit=1');
    venueSlug = (vs && vs[0] && vs[0].slug) || null;
  } catch (e) { venueSlug = null; }

  const playerCount = countPlayers(players);   // devices, not joins: matches what the venue is billed on

  const snap = {
    session_id: s.id,
    venue_slug: venueSlug,
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
  const games = runningOf('bingo90');
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
    const tgames = runningOf('trivia');
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
    const mgames = runningOf('musical_bingo');
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
    const rgames = runningOf('raffle');
    if (rgames.length) {
      const g = rgames[0];
      const cfg = g.config || {};
      const rg = await sbGet(env, 'vp_raffle_games',
        'game_id=eq.' + enc(g.id) + '&select=range_min,range_max,draws_count,allow_redraw,time_to_claim_seconds,jackpot_on,jackpot_amount_cents');
      const r = rg.length ? rg[0] : {};
      const leadingZeros = cfg.leading_zeros !== false;
      const padWidth = leadingZeros ? String(Math.max(r.range_max || 1, 1)).length : 1;
      /* The latest draw round's winning tickets (for a TV that reconnected after a draw), AND
         the whole result history, because the host console rebuilds its audit log from this.
         It has had the code to do that for a while; this select never returned the rows, so a
         host who reloaded mid-night watched "who won what" reset to "No draws yet" while the
         drawn-ticket count carried on climbing. prize_text and outcome come with it: without
         them a restored row shows a blank prize and cannot tell a claim from a no-show. */
      const last = await sbGet(env, 'vp_raffle_results',
        'game_id=eq.' + enc(g.id) +
        '&select=seq,ticket_number,prize_text,outcome,drawn_at&order=seq.desc&limit=50');
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
        /* Baked at start; a reloading host restores its spin from here, not from the venue template,
           so a spin changed mid-night survives the reload the same way the range and prize do. */
        spin_seconds: cfg.spin_seconds != null ? cfg.spin_seconds : null,
        /* The gaps are baked onto the game at start. Without them a reloading console shows an
           empty "tickets that did not sell" box beside a game that HAS gaps, so the count is
           wrong and the host cannot tell what is still in the barrel. */
        excluded_ranges: (cfg && Array.isArray(cfg.excluded_ranges)) ? cfg.excluded_ranges : null,
        time_to_present: r.time_to_claim_seconds != null ? r.time_to_claim_seconds : null,
        jackpot_on: !!r.jackpot_on,
        jackpot_amount_cents: r.jackpot_amount_cents != null ? r.jackpot_amount_cents : null,
        pad: padWidth, last_seq: lastSeq, last_tickets: lastTickets, all_tickets: allTickets,
        /* Oldest first: the console reverses this into newest-first, matching the order it uses
           when it appends a live draw, so a restored log and a live one read the same way. */
        results: last.slice().reverse().map((r) => ({
          ticket: r.ticket_number,
          prize: r.prize_text || '',
          outcome: r.outcome || 'drawn',
          drawn_at: r.drawn_at || null,
        })),
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
    let keys = env ? await fetchJwks(env) : [];
    let jwk = keys.find(function (k) { return k.kid === header.kid; });
    if (!jwk && env) { _gameJwks = null; keys = await fetchJwks(env); jwk = keys.find(function (k) { return k.kid === header.kid; }); }   // a key rotated since we cached
    if (!jwk) jwk = keys[0];
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

/* HOW MANY, without reading any of them. PostgREST answers a HEAD with
   Prefer: count=exact by putting the total after the slash in Content-Range
   ("0-0/19", or "*\/0" for an empty table). One round trip, no rows, no growth. */
async function sbCount(env, table, query) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/' + table + '?' + (query || 'select=id') + '&limit=1', {
    method: 'HEAD', headers: Object.assign({}, sbHeaders(env), { 'Prefer': 'count=exact' }),
  });
  if (!res.ok) throw dbError('count', table, '');
  const range = res.headers.get('content-range') || '';
  const n = parseInt(range.split('/')[1], 10);
  if (!Number.isFinite(n)) throw dbError('count', table, 'no count in Content-Range: ' + range);
  return n;
}

/* EVERY row, not the first N of them.
 *
 * A `limit=5000` on a table that only grows is a wall you hit silently. The
 * venue-code map was built that way: PostgREST returned the first 5,000 venues,
 * every venue after that had no code, and their screens showed "not linked to an
 * account" while their join codes resolved to nothing. No error anywhere. And
 * the count is every venue EVER created - three thousand trading plus three
 * thousand cancelled is six thousand rows, so live venues would have broken
 * while cancelled ones held the slots, in whatever order Postgres felt like.
 *
 * Pages until a short page comes back, so there is no ceiling to raise later.
 * Capped at 40 pages (40,000 rows) purely so a runaway query cannot spin a
 * Worker for ever; if that is ever reached the venue count is a happier problem
 * than this bug.
 */
async function sbGetAll(env, table, query, pageSize) {
  const size = pageSize || 1000;
  let out = [], offset = 0;
  for (let page = 0; page < 40; page++) {
    const q = query + '&limit=' + size + '&offset=' + offset;
    const rows = await sbGet(env, table, q);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out = out.concat(rows);
    /* Advance by what CAME BACK, and stop only on an empty page.
       Stopping on a SHORT page was the first version of this and it has the same
       fault as the bug it replaces: Supabase enforces its own max-rows on
       PostgREST, so if that ceiling is lower than the page size asked for, every
       page is short, the loop stops after one, and the truncation is silent
       again. Asking until nothing comes back is correct whatever the platform
       cap turns out to be. */
    offset += rows.length;
  }
  return out;
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
/* ARE THE ONE-TRIP DATABASE FUNCTIONS ACTUALLY ON THIS DATABASE?
 *
 * Migrations 71, 72 and 73 replace a handful of round trips with one, and the Worker
 * falls back to the slow path on a PostgREST 404, which is what makes pasting them
 * safe in any order. The cost of that safety is that nothing tells you whether they
 * landed: the venue simply stays slow and nobody knows why.
 *
 * It cannot be asked from outside either. PostgREST answers a function the caller may
 * not execute with the SAME "could not find the function" 404 it gives a name that was
 * never there, so a probe with the public key reports every function as missing,
 * including vp_emit_event, which every join in the country depends on. Checked on
 * 10 Sep 2026: a known-present function and a made-up one were indistinguishable.
 *
 * So the Worker asks, with the service key, on a route that already exists. Each one is
 * called with arguments that cannot match anything real, so the answer is about the
 * FUNCTION and never about a venue. Cached for five minutes, because /health is public
 * and this is three round trips.
 */
const ONE_TRIP_FNS = ['vp_player_answer', 'vp_screen_poll', 'vp_host_staff', 'vp_host_question', 'vp_host_reveal',
                      'vp_bingo_ball', 'vp_members_draw'];
let _otAt = 0, _otSeen = null;
async function oneTripPresent(env) {
  const now = Date.now();
  if (_otSeen && now - _otAt < 300000) return _otSeen;
  const out = {};
  try {
    /* PostgREST publishes its own OpenAPI description at the root, and every function the
       caller may execute appears in it as an /rpc/<name> path. One request answers all five,
       and it cannot be fooled the way calling the function can: a call with the wrong
       ARGUMENT NAMES answers PGRST202 "could not find the function" exactly as a missing
       function does, so the first version of this check reported all three as absent on a
       database that demonstrably has them. */
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/', { headers: sbHeaders(env) });
    if (!res.ok) throw new Error('spec ' + res.status);
    const spec = await res.text();
    ONE_TRIP_FNS.forEach(function (fn) { out[fn] = spec.indexOf('/rpc/' + fn) >= 0; });
  } catch (e) {
    ONE_TRIP_FNS.forEach(function (fn) { out[fn] = null; });   // could not tell: never call an unknown present
  }
  _otSeen = out; _otAt = now;
  return out;
}

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

/* ---- anti-abuse: soft rate limit (per-isolate memory; env.RL only for the join dedup cache) ---- */

// One-time warning so an absent/erroring KV binding is visible in logs without
// spamming every request. Isolate-level flag; resets on a cold start, which is fine.
let rlWarned = false;
function rlWarn() {
  if (rlWarned) return;
  rlWarned = true;
  console.log('[RL] KV binding env.RL absent or erroring: the join dedup cache is off (the device_id column still dedups). Add a KV namespace binding named RL at deploy.');
}

// Count requests per key in THIS isolate's memory and report whether the key is
// within its limit. No store on the request path.
//
// Until 8 Sep 2026 this did a KV get and an awaited KV put per call, and that put was
// the wait: measured on an idle Worker in the same city as the database, an answer
// took 0.8 to 1.3 s of which the database work was 20 ms. Every rate-limited route
// paid it (join twice, answer, claim, report, capture, feedback). It also could not
// do its job: KV is cached for at least 60 s at the edge, so a counter written by
// the last request was invisible to the next one for the whole window, and KV allows
// one write per second per key, so a room of phones joining together tripped that
// limit on the shared join:ip key and the limiter fell back to allow. A limiter that
// is slow when idle and blind under a burst is the wrong tool.
//
// Memory is exact, instant, and per isolate. A burst from one source lands in one
// Cloudflare location, so the count that matters is the local one. It is still SOFT
// (a spread-out attacker gets the limit once per location, an evicted isolate starts
// from zero), which is what this was always meant to be: abuse control, not a quota.
// env.RL is still used by the join dedup cache, so the binding stays.
const rlMem = new Map();   // key -> { n, until }
let rlSweptAt = 0;
async function rateLimit(env, key, limit, windowSecs) {
  const now = Date.now();
  if (now - rlSweptAt > 30000) {
    rlSweptAt = now;
    for (const [k, v] of rlMem) if (v.until <= now) rlMem.delete(k);
  }
  let m = rlMem.get(key);
  if (!m || m.until <= now) { m = { n: 0, until: now + windowSecs * 1000 }; rlMem.set(key, m); }
  if (m.n >= limit) return { ok: false, count: m.n };
  m.n += 1;
  return { ok: true, count: m.n };
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

/* ============================================================================
 * ROOM SERVER (copied from venueplay-room.js, kept identical by the gate)
 *
 * A Worker is ONE file, so the Durable Object class lives here as well as in its
 * own file, where its test can reach it. release-check.py fails if the two ever
 * differ, the same rule esc(), cryptoInt() and tvSend() already live under.
 * Edit venueplay-room.js, run its test, then re-copy. Never edit this copy alone.
 *
 * Everything below is inert without the ROOM binding: no binding, no change.
 * ========================================================================== */
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
