/* =====================================================================
 * VP-DRAW: THE REGULATED BINGO CODE OF THE VENUEPLAY GAME WORKER
 * =====================================================================
 * Everything an OLGR assessor needs to read about how a bingo game is drawn, dealt and judged on the
 * server, and when the venue's tablet may stand in for it, is in this one file:
 *
 *   randInt            the scaler: a uniform integer from crypto.getRandomValues by rejection sampling
 *   shuffle1to90       THE ball order (one Fisher-Yates over 1..90 at game start, kept on the server)
 *   generateStrip      THE ticket maker (a strip of six housie tickets holding 1..90 once)
 *   bingoTicketWins    THE claim rule (one/two/full house, top/middle/bottom line, four corners)
 *   /host/bingo/draw, /ball, /fallback, /deal, /claim, /claim/resolve   the routes that use them
 *   TABLET_FALLBACK_OFF_STATES and the gates that let the tablet stand in only after an outage the
 *   server itself recorded
 *
 * HOW IT SHIPS. This file is the source. tools/regulated.py copies it, byte for byte, into
 * venueplay-game.js between the VP-DRAW BEGIN and END markers (a Worker deploys as one file), and the
 * gate refuses the Worker if that copy differs from this file. Nothing in here reads a setting from a
 * venue, a host, HQ, an environment variable or a database row: its rules are constants in this file.
 *
 * HOW IT CHANGES. Any change to this file must raise VP_DRAW_VERSION and regenerate
 * tools/regulated-manifest.json (python3 tools/regulated.py --update) in the same commit. The local gate
 * and release.py refuse anything else, and /health reports the version and the manifest hash, so what
 * is running can be checked against what was described to OLGR.
 */
const VP_DRAW_VERSION = 'VP-DRAW-1.1';

// Uniform random integer in [0, max) using rejection sampling over getRandomValues.
function randInt(max) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % max;
}

// Fisher-Yates shuffle of 1..90: THE bingo ball order (VP-SHUFFLE). Stored as vp_bingo_draws.draw_order.
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


/* ------------------------------ POST /host/bingo/draw ------------------------------
 * THE BINGO CONSOLE'S DRAW LIVES HERE NOW. The console on /app is broadcast-only: it deals
 * its own cards and talks to the TV and the phones over the realtime channel, and for two
 * years of pub nights it also picked every ball itself, one at a time, with a rejection-
 * sampled CSPRNG. That is fair but not provable: the pick happened on the host's tablet and
 * nothing recorded it until the end-of-game report, which the same tablet wrote.
 *
 * From 8 Sep 2026 the console asks the Worker for a draw at game start and for every ball
 * after that. The whole order of 1..90 is shuffled here (shuffle1to90, the one bingo ball
 * generator in this Worker), written to vp_bingo_draws and NEVER returned to any client;
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

/* THE ONE SWITCH FOR THE TABLET FALLBACKS (19 Oct 2026). A state named here gets NO tablet fallback:
   no ball called on the tablet, no ticket dealt on it, no claim confirmed on its check. The server
   refuses all three for that state's venues, and the console learns the list from /host/bingo/draw
   and /host/bingo/seat (and keeps it on the tablet) so it waits for the server instead. Default:
   none, which is Dean's decision to keep the fallbacks. If OLGR asks, Queensland off is this line:
     const TABLET_FALLBACK_OFF_STATES = new Set(['QLD']);  */
const TABLET_FALLBACK_OFF_STATES = new Set([]);
function fallbackOffList() { return Array.from(TABLET_FALLBACK_OFF_STATES); }
function tabletFallbackOk(state) { return !TABLET_FALLBACK_OFF_STATES.has(String(state || '').toUpperCase()); }
async function venueState(env, venueId) {
  const v = await sbGet(env, 'vp_venues', 'id=eq.' + enc(venueId) + '&select=au_state&limit=1');
  return String((v[0] && v[0].au_state) || '').toUpperCase();
}
// How many balls stand on the record (withdrawn ones do not count): the next ball's place is this + 1.
async function standingBallCount(env, drawId) {
  const r = await sbGetStandingBalls(env, 'draw_id=eq.' + enc(drawId) + '&select=ordinal&order=ordinal.desc&limit=1');
  return r.length ? r[0].ordinal : 0;
}
// A draw opened for real balls (caller mode). Nothing else may post a 'caller' ball, and nothing
// but a caller ball goes on one.
function isCallerDraw(draw) { return !!draw && draw.draw_seed === CALLER_NO_SEED && draw.fallback_why === CALLER_REASON; }
/* The server's own evidence that it failed to serve the ball at `ordinal`: it was asked for that
   place and failed (bingoRecordFailedAsk), and the place is still empty (ordinal = standing + 1). */
function serverFailedBall(draw, ordinal) { return !!draw && draw.ball_asked_ordinal != null && draw.ball_asked_ordinal === ordinal; }
// A recorded outage on this draw: the server itself switched it to the tablet, or a deal it received failed.
function drawHadOutage(draw) { return !!draw && ((draw.mode === 'local' && draw.fallback_why !== CALLER_REASON) || !!draw.deal_failed_at); }
const BINGO_DRAW_COLS = 'id,venue_id,session_id,draw_index,draw_seed,mode,fallback_at,fallback_why,finished_at,ball_asked_ordinal,deal_failed_at,deal_asked_at';
/* A server ball drawn this recently, in the very place the tablet has just called, is one the room never
   saw: the console gave up waiting (4 s) and the server answered late. Past this, a "the server never
   answered" for a place the server filled is not believed. */
const BINGO_UNSEEN_WINDOW_MS = 30000;
// A game is over: its draw is finished (Finish game, End game, a new game, the session closing, the 3am sweep).
async function bingoFinishDraws(env, filter) {
  try { await sbPatch(env, 'vp_bingo_draws', filter + '&finished_at=is.null', { finished_at: new Date().toISOString() }); }
  catch (e) { /* the night goes on; the next close or the sweep finishes it */ }
}

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

  /* CALLER MODE: the balls are real, so the record says so from ball one. The draw opens already
     'local' with the reason 'caller', which also makes /host/bingo/ball refuse it: no ball from
     this server's order can ever land on a night the room is watching a barrel. And no order is
     made at all: the barrel is the draw, so the row holds an empty order (the column is not null)
     and no seed, rather than a shuffle nobody uses sitting beside the real record. */
  const caller = b.caller === true;
  const rows = await sbInsert(env, 'vp_bingo_draws', Object.assign({
    venue_id: venueId,
    session_id: sessionId,
  }, caller ? {
    draw_seed: CALLER_NO_SEED,
    draw_order: [],
    draw_index: 0,
    mode: 'local', fallback_at: 1, fallback_why: CALLER_REASON,
  } : {
    draw_seed: randomTokenHex(16),
    draw_order: shuffle1to90(),   // never leaves this function
    draw_index: 0,
  }), true);
  const row = Array.isArray(rows) ? rows[0] : rows;
  // A new game is the end of the last one at this venue: its draw is finished on the record (VP-DRAW-1.1).
  await bingoFinishDraws(env, 'venue_id=eq.' + enc(venueId) + '&id=neq.' + enc(row.id));
  const state = await venueState(env, venueId);
  return json({ draw_id: row.id, tablet_fallback: tabletFallbackOk(state), fallback_off_states: fallbackOffList() });
}

/* THE SERVER'S OWN RECORD OF FAILING TO CALL A BALL (migration 105; tightened in VP-DRAW-1.1).
   Written only when this server was asked for a ball and FAILED to call it (the draw threw), only after
   the host has been checked as staff at the draw's venue, and only for the next empty place
   (ordinal = balls on the record + 1). Never on a refusal and never on the 4 second hold: those are
   answers, not failures. That record is what lets the tablet call that one place on a server draw. */
async function bingoRecordFailedAsk(env, authUserId, drawId, b) {
  try {
    const o = parseInt(b && b.ordinal, 10);
    if (!(o >= 1 && o <= 90) || !drawId) return;
    const d = await sbGet(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&select=id,venue_id,mode,finished_at&limit=1');
    if (!d.length || d[0].finished_at || d[0].mode !== 'server') return;
    await requireStaff(env, authUserId, d[0].venue_id);
    if (o !== (await standingBallCount(env, drawId)) + 1) return;
    await sbPatch(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&finished_at=is.null&mode=eq.server',
      { ball_asked_ordinal: o, ball_asked_at: new Date().toISOString() });
  } catch (e) { /* the database is down too: nothing to record with, and nothing is believed without it */ }
}
async function handleBingoBall(request, env, json) {
  const seen = {};   // the request as hostDrawRpc read it (a body can be read once): kept for a failure record
  const keep = async function (env2, json2, authUserId, drawId, b) { seen.uid = authUserId; seen.drawId = drawId; seen.b = b; return null; };
  try {
    const r = await hostDrawRpc(request, env, json, 'vp_bingo_ball', { p_hold_ms: BINGO_SERVER_HOLD_MS }, keep);
    if (r.reply) return r.reply;
    if (r.pre) return await handleBingoBallManyTrips(request, env, json, r.pre);
    return bingoBallReply(json, r.rpc);
  } catch (e) {
    if (!(e && e.status >= 400 && e.status < 500)) await bingoRecordFailedAsk(env, seen.uid, seen.drawId, seen.b);
    throw e;
  }
}
function bingoBallReply(json, d) {
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
    // A server draw (this path refuses a 'local' one above) never has a withdrawn ball: only a
    // tablet ball can be marked withdrawn (migration 103's check), so no filter is needed here.
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
/* WITHDRAWN BALLS (migration 103). vp_bingo_draw_balls.withdrawn_at marks a caller-mode ball that
   was taken back; the row stays on the record. Every read of the balls that STAND asks for
   withdrawn_at is null. PostgREST refuses a filter, or a write, on a column the table does not have
   yet (400, naming the column), and that is the one failure read here as "not run yet": the read is
   asked again without the filter (before 103 there are no withdrawn rows, so it is the same
   answer), and the mark answers null so the caller can fall back. Never cached: the moment 103 is
   run, the very next request keeps the record. */
function withdrawnColumnMissing(status, text) {
  return status === 400 && /withdrawn_at/.test(String(text || '')) &&
    /42703|PGRST204|does not exist|Could not find/.test(String(text || ''));
}
async function sbGetStandingBalls(env, query) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_bingo_draw_balls?' + query + '&withdrawn_at=is.null', { headers: sbHeaders(env) });
  if (res.ok) return await res.json();
  const text = await res.text();
  if (withdrawnColumnMissing(res.status, text)) return await sbGet(env, 'vp_bingo_draw_balls', query);
  throw dbError('read', 'vp_bingo_draw_balls', text);
}
// The rows it marked ([] when none was still standing), or null when the column is not there yet.
async function markBallWithdrawn(env, filter) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/vp_bingo_draw_balls?' + filter + '&withdrawn_at=is.null', {
    method: 'PATCH', headers: Object.assign({}, sbHeaders(env), { 'Prefer': 'return=representation' }),
    body: JSON.stringify({ withdrawn_at: new Date().toISOString() }),
  });
  if (res.ok) { try { const r = await res.json(); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  const text = await res.text();
  if (withdrawnColumnMissing(res.status, text)) return null;
  throw dbError('update', 'vp_bingo_draw_balls', text);
}

async function handleBingoFallback(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const drawId = String(b.draw_id || '').trim();
  if (!drawId) return json({ error: 'Missing draw_id' }, 400);
  assertUuid(drawId, 'draw_id');
  const draws = await sbGet(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&select=' + BINGO_DRAW_COLS);
  if (!draws.length) return json({ error: 'Draw not found' }, 404);
  const draw = draws[0];
  await requireStaff(env, authUserId, draw.venue_id);
  if (draw.finished_at) return json({ error: 'This game is finished' }, 409);

  const number = parseInt(b.number, 10);
  const ordinal = parseInt(b.ordinal, 10);
  if (!(number >= 1 && number <= 90) || !(ordinal >= 1 && ordinal <= 90)) return json({ error: 'Bad ball' }, 400);
  /* 'caller' is the one reason sent exactly: a ball called off a real barrel (caller mode). Every
     other reason is the console's own words about why the server could not be reached. */
  const reason = String(b.reason || 'worker unreachable').slice(0, 200);
  const callerBall = reason === 'caller';

  /* CALLER MODE'S UNDO. The operator tapped the wrong number and withdrew it before the next call.
     Only on a caller-mode draw, only the LAST standing ball on the record, and only a ball the
     tablet put there: a server-drawn ball, or a ball on any other kind of night, is never touched.
     The row is KEPT and marked withdrawn (migration 103), so the night's record shows the number
     was called and taken back; the next call can take its place and the number can be called
     again, because the table's keys hold for standing balls only. Before 103 is run the column
     is not there and the ball comes off the record as it always did, so either order is safe. */
  /* A 'caller' ball only on a draw OPENED for real balls, and only caller balls on one: a host cannot
     call a server night "real balls" to post numbers on it (audit, 19 Oct 2026). */
  if (callerBall !== isCallerDraw(draw)) {
    return json({ error: callerBall ? 'Only a draw opened for real balls takes caller balls' : 'This draw is called with real balls' }, 409);
  }
  if (b.withdraw === true) {
    if (!callerBall || draw.mode !== 'local' || draw.fallback_why !== 'caller') {
      return json({ error: 'Only a caller-mode ball can be withdrawn' }, 409);
    }
    const lastQ = 'draw_id=eq.' + enc(drawId) + '&select=ordinal,number,source&order=ordinal.desc&limit=1';
    const last = await sbGetStandingBalls(env, lastQ);
    if (!last.length || last[0].ordinal !== ordinal || last[0].number !== number || last[0].source !== 'local') {
      return json({ error: 'That is not the last call' }, 409);
    }
    const which = 'draw_id=eq.' + enc(drawId) + '&ordinal=eq.' + ordinal + '&number=eq.' + number + '&source=eq.local';
    const marked = await markBallWithdrawn(env, which);
    if (marked === null) {   // migration 103 not run: the old behaviour, until it is
      await sbDelete(env, 'vp_bingo_draw_balls', which);
      return json({ ok: true, withdrawn: number, kept: false });
    }
    if (!marked.length) return json({ error: 'That is not the last call' }, 409);   // a second undo got there first
    return json({ ok: true, withdrawn: number, kept: true });
  }

  let standing = await standingBallCount(env, drawId);
  let unseen = false;
  if (!callerBall) {
    if (!tabletFallbackOk(await venueState(env, draw.venue_id))) return json({ error: 'Calling from the tablet is switched off at this venue' }, 403);
    /* A SLOW SERVER, NOT A DEAD ONE (VP-DRAW-1.1). The console gave up on ball N after four seconds and
       called it from the tablet; this server answered late and recorded its own ball N, which the room
       never saw. The room's ball is the one that was called, so it takes place N, and the server's is
       kept on the record as VOID with the reason (migration 108). Only for the very last place, only a
       server ball, and only one drawn moments ago: a ball the room has had time to see is never undone. */
    if (draw.mode !== 'local' && standing === ordinal) {
      const at = await sbGetStandingBalls(env, 'draw_id=eq.' + enc(drawId) + '&ordinal=eq.' + ordinal + '&select=ordinal,number,source,drawn_at&limit=1');
      const late = at[0];
      if (late && late.source === 'server' && late.number !== number && late.drawn_at &&
          Date.now() - new Date(late.drawn_at).getTime() <= BINGO_UNSEEN_WINDOW_MS) {
        const why = 'never seen by the room: the server answered after the console had called this place from the tablet (' + reason + ')';
        const marked = await sbPatchReturning(env, 'vp_bingo_draw_balls', 'draw_id=eq.' + enc(drawId) + '&ordinal=eq.' + ordinal +
          '&source=eq.server&withdrawn_at=is.null', { withdrawn_at: new Date().toISOString(), void_reason: why });
        if (marked.length) { unseen = true; standing = ordinal - 1; }
      }
    }
  }
  /* IN ORDER, NOTHING SKIPPED: the ball goes in the next empty place or not at all. */
  if (ordinal !== standing + 1) return json({ error: 'Out of order: the record holds ' + standing + ' balls, so the next is ball ' + (standing + 1) }, 409);
  if (!callerBall && draw.mode !== 'local') {
    /* THE SERVER DECIDES THAT IT FAILED. A healthy server draw is handed to the tablet only when the
       server answered this place late (above) or itself failed to call exactly this place
       (bingoRecordFailedAsk). A host cannot declare an outage the server did not have. */
    if (!unseen && !serverFailedBall(draw, ordinal)) return json({ error: 'The server has not failed to call this ball, so it does not take one from the tablet' }, 409);
    await sbPatch(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&mode=eq.server', { mode: 'local', fallback_at: ordinal, fallback_why: reason });
  }
  // The table's keys still refuse a repeat or a clash with a server ball; sbInsert turns that into a 409.
  await sbInsert(env, 'vp_bingo_draw_balls', { draw_id: drawId, ordinal, number, source: 'local' }, false);
  return json({ ok: true });
}

/* ------------------------------ BINGO PHONE TICKETS, ON THE SERVER ------------------------------
 * Dean, 19 Oct 2026: "Lets go the server". The bingo console used to make every phone ticket on the
 * host's tablet and check every BINGO against its own copy, so the record of who held what, and
 * whether a claim was good, lived in the tablet's browser storage. The system that draws the balls
 * now also deals the tickets and decides the claims, and keeps both (migration 104):
 *
 *   POST /host/bingo/deal           {draw_id, hands:[{pid, did, want}]}
 *        -> {ok, hands:{pid:[{card_no, cells:3x9, source}]}, refused:[pid]}
 *        "Make sure this phone holds `want` tickets in this game", for every phone named. Idempotent:
 *        asking again for the same count deals nothing and answers the same hand, so a console that
 *        timed out and asks again cannot double anybody's tickets. A count corrected DOWN (a paid
 *        sale undone) voids the newest tickets; the rows stay. Tickets come in STRIPS of six, so a
 *        player's book holds every number once, and a ticket bought later is the next page of the
 *        same book. The pages not dealt yet sit here with dealt_at null and are never sent anywhere.
 *        In a session, only a phone whose device id holds a row in that session is dealt: the same
 *        rule /host/bingo/seat applies, so a stranger on the channel is never given a ticket.
 *        A hand with `tablet:[{cells, card_no}]` instead RECORDS tickets the tablet dealt while it
 *        could not reach us, marked source 'tablet', so the record is complete after an outage.
 *
 *   POST /host/bingo/claim          {draw_id, ref, pid, card_no, pattern, balls, called?, tablet_draw?}
 *        -> {claim_id, verdict:'win'|'not_yet'|'no_ticket', card_no, cells, swapped, winning_cells, balls}
 *        The verdict is computed HERE from this server's copy of the ticket and this server's record
 *        of the balls (the first `balls` of them: the ones out when the player pressed BINGO). The
 *        console's list of called numbers is used for one thing only: on a draw the tablet has taken
 *        over (its fallback), balls the server never heard about are appended to the record in
 *        order, exactly as /host/bingo/fallback would have. On a server draw the tablet can add
 *        nothing. Every claim is written to vp_bingo_claims, the false ones too. `ref` is the
 *        console's key for the claim, so a retry is the same row. With decided_on:'tablet' and
 *        decision, the console records a claim it had to decide on its own check in an outage.
 *
 *   POST /host/bingo/claim/resolve  {claim_id, decision:'confirmed'|'rejected'|'dropped'} -> {ok, status}
 *
 * THE NIGHT STILL SURVIVES THIS WORKER BEING DOWN. The console tries the server for a few seconds,
 * then deals that game from the tablet and says so (and records the tickets here once it can), and
 * a claim the server cannot check inside four seconds is shown to the host as checked on the
 * tablet, labelled. Same shape as the ball fallback Dean kept on 8 Sep 2026.
 */
const BINGO_PID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const BINGO_DID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const BINGO_REF_RE = /^[A-Za-z0-9_-]{6,80}$/;
const BINGO_DEAL_MAX_HANDS = 120;
const BINGO_DEAL_MAX_TICKETS = 24;   // the console's PAID_MAX_TICKETS: four sheets
const BINGO_CLAIM_PATTERNS = ['one', 'two', 'full', 'top', 'middle', 'bottom', 'corners'];

/* VP-TICKET-2: THE TICKET MAKER. The strip algorithm below is shared, byte for byte, with the tablet half
   (venueplay/app/vp-draw.js), so the tablet in an outage makes tickets exactly the way the server does. */
  // ---- VP-STRIP BEGIN: the one strip algorithm, the same text in both halves of VP-DRAW (tools/regulated.py refuses a difference) ----
  /* A STRIP of six 90-ball tickets that between them hold 1..90 exactly once, the way paper housie is sold.
     rnd(n) is the half's own uniform integer in [0, n): randInt on the server, cryptoInt on the tablet,
     the same rejection sampler over crypto.getRandomValues. Every strip is checked before it is returned
     (stripIsValid); one that is not is thrown away and another made. Returns six tickets of 27 values,
     row-major, blanks 0, or null if 200 tries all failed (never seen). */
  function stripColRange(c){ return c === 0 ? [1, 9] : (c === 8 ? [80, 90] : [c * 10, c * 10 + 9]); }
  function stripColCounts(rnd){
    var TOTAL = [9, 10, 10, 10, 10, 10, 10, 10, 11];   // numbers per column across a strip: sums to 90
    for (var attempt = 0; attempt < 600; attempt++) {
      var extra = [], rowLeft = [], r, c, i, ok = true;
      for (r = 0; r < 6; r++) { extra.push([0, 0, 0, 0, 0, 0, 0, 0, 0]); rowLeft.push(6); }   // 15 - the 9 every ticket starts with
      var cols = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (i = cols.length - 1; i > 0; i--) { var j = rnd(i + 1), t = cols[i]; cols[i] = cols[j]; cols[j] = t; }
      for (var ci = 0; ci < 9 && ok; ci++) {
        c = cols[ci];
        var need = TOTAL[c] - 6, keys = [];
        for (r = 0; r < 6; r++) keys.push({ r: r, k: rnd(1000000) });
        // fill from the tickets with most room left, so nothing gets stranded; ties broken at random
        keys.sort(function (a, b) { return (rowLeft[b.r] - rowLeft[a.r]) || (a.k - b.k); });
        for (i = 0; i < 6 && need > 0; i++) {
          r = keys[i].r;
          var take = Math.min(2 - extra[r][c], rowLeft[r], need);
          if (take <= 0) continue;
          extra[r][c] += take; rowLeft[r] -= take; need -= take;
        }
        if (need > 0) ok = false;
      }
      for (r = 0; r < 6 && ok; r++) { if (rowLeft[r] !== 0) ok = false; }
      if (!ok) continue;
      var out = [];
      for (r = 0; r < 6; r++) { var row = []; for (c = 0; c < 9; c++) row.push(1 + extra[r][c]); out.push(row); }
      return out;
    }
    return null;
  }
  function stripTicketRows(rnd, counts){
    for (var attempt = 0; attempt < 400; attempt++) {
      var assign = [], tally = [0, 0, 0], c, i;
      for (c = 0; c < 9; c++) {
        var pick = [0, 1, 2];
        for (i = pick.length - 1; i > 0; i--) { var j = rnd(i + 1), t = pick[i]; pick[i] = pick[j]; pick[j] = t; }
        var rows = pick.slice(0, counts[c]).sort(function (a, b) { return a - b; });
        assign.push(rows);
        for (i = 0; i < rows.length; i++) tally[rows[i]]++;
      }
      if (tally[0] === 5 && tally[1] === 5 && tally[2] === 5) return assign;
    }
    return null;
  }
  // A valid 90-ball ticket: 27 cells, 5 numbers a row, 1 to 3 a column, each in its column's range,
  // ascending down the column, no repeats.
  function ticketIsValid(cells){
    if (!cells || cells.length !== 27) return false;
    var seen = {}, r, c;
    for (r = 0; r < 3; r++) { var n = 0; for (c = 0; c < 9; c++) { if (cells[r * 9 + c]) n++; } if (n !== 5) return false; }
    for (c = 0; c < 9; c++) {
      var rg = stripColRange(c), last = 0, k = 0;
      for (r = 0; r < 3; r++) {
        var v = cells[r * 9 + c];
        if (!v) continue;
        if (v !== Math.floor(v) || v < rg[0] || v > rg[1] || v <= last || seen[v]) return false;
        seen[v] = true; last = v; k++;
      }
      if (k < 1 || k > 3) return false;
    }
    return true;
  }
  function stripIsValid(tickets){
    if (!tickets || tickets.length !== 6) return false;
    var seen = {}, n = 0;
    for (var t = 0; t < 6; t++) {
      if (!ticketIsValid(tickets[t])) return false;
      for (var i = 0; i < 27; i++) { var v = tickets[t][i]; if (v) { if (seen[v]) return false; seen[v] = true; n++; } }
    }
    return n === 90;
  }
  function stripOfSix(rnd){
    for (var attempt = 0; attempt < 200; attempt++) {
      var m = stripColCounts(rnd); if (!m) continue;
      var assigns = [], t, c, i, ok = true;
      for (t = 0; t < 6 && ok; t++) { var a = stripTicketRows(rnd, m[t]); if (!a) ok = false; else assigns.push(a); }
      if (!ok) continue;
      var tickets = [];
      for (t = 0; t < 6; t++) { var cells = []; for (i = 0; i < 27; i++) cells.push(0); tickets.push(cells); }
      for (c = 0; c < 9; c++) {
        var rg = stripColRange(c), pool = [];
        for (i = rg[0]; i <= rg[1]; i++) pool.push(i);
        for (i = pool.length - 1; i > 0; i--) { var j = rnd(i + 1), x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
        var at = 0;
        for (t = 0; t < 6; t++) {
          var chunk = pool.slice(at, at + m[t][c]).sort(function (p, q) { return p - q; });
          at += m[t][c];
          for (i = 0; i < assigns[t][c].length; i++) tickets[t][assigns[t][c][i] * 9 + c] = chunk[i];
        }
      }
      if (stripIsValid(tickets)) return tickets;
    }
    return null;
  }
  // ---- VP-STRIP END ----
function generateStrip() {
  const t = stripOfSix(randInt);
  if (t) return t;
  /* There is ONE ticket maker on the server, this one, so it does not fall back to another: it fails, the
     console reads that as an outage and deals that game from the tablet, labelled and recorded. */
  throw httpError(503, 'Could not build a strip of tickets. Try again.');
}
function validTicket27(cells) { return ticketIsValid(cells); }
function validStrip(tickets) { return stripIsValid(tickets); }
function ticketRows3x9(cells) { return [cells.slice(0, 9), cells.slice(9, 18), cells.slice(18, 27)]; }
function ticketFlat27(t) {
  if (Array.isArray(t) && t.length === 3 && t.every((r) => Array.isArray(r) && r.length === 9)) t = [].concat(t[0], t[1], t[2]);
  if (!Array.isArray(t) || t.length !== 27) return null;
  const out = t.map((v) => parseInt(v, 10) || 0);
  return validTicket27(out) ? out : null;
}
// A ticket number for the server to hand out: 100 to 999 at random, never one already in this game;
// past 900 tickets in one game, the next free number from 1000.
function freshCardNo(used) {
  for (let tries = 0; tries < 400; tries++) { const n = 100 + randInt(900); if (!used.has(n)) { used.add(n); return n; } }
  let n = 1000; while (used.has(n)) n++;
  used.add(n); return n;
}

/* THE CLAIM RULE, in the console's words (checkPattern in app/index.html, which stays there as the
   display aid and the outage check). A row is complete when every number on it has been called.
   one/two/full = at least that many complete rows; top/middle/bottom = that row; corners = the first
   and last number of the top and bottom rows. Returns {win, cells:[row-major indices that won]}. */
function bingoTicketWins(cells, called, pattern) {
  const rowIdx = [], rowDone = [];
  for (let r = 0; r < 3; r++) {
    const idx = []; let done = true;
    for (let c = 0; c < 9; c++) { const v = cells[r * 9 + c]; if (v) { idx.push(r * 9 + c); if (!called.has(v)) done = false; } }
    rowIdx.push(idx); rowDone.push(done);
  }
  const rows = (list) => { const out = []; list.forEach((r) => rowIdx[r].forEach((i) => out.push(i))); return out; };
  const doneRows = [0, 1, 2].filter((r) => rowDone[r]);
  switch (pattern) {
    case 'one': return doneRows.length >= 1 ? { win: true, cells: rows(doneRows.slice(0, 1)) } : { win: false, cells: [] };
    case 'two': return doneRows.length >= 2 ? { win: true, cells: rows(doneRows.slice(0, 2)) } : { win: false, cells: [] };
    case 'full': return doneRows.length === 3 ? { win: true, cells: rows([0, 1, 2]) } : { win: false, cells: [] };
    case 'top': return rowDone[0] ? { win: true, cells: rows([0]) } : { win: false, cells: [] };
    case 'middle': return rowDone[1] ? { win: true, cells: rows([1]) } : { win: false, cells: [] };
    case 'bottom': return rowDone[2] ? { win: true, cells: rows([2]) } : { win: false, cells: [] };
    case 'corners': {
      const cs = [];
      [0, 2].forEach((r) => {
        const idx = rowIdx[r]; if (!idx.length) return;
        cs.push(idx[0]); if (idx[idx.length - 1] !== idx[0]) cs.push(idx[idx.length - 1]);
      });
      if (!cs.length) return { win: false, cells: [] };
      return cs.every((i) => called.has(cells[i])) ? { win: true, cells: cs } : { win: false, cells: [] };
    }
  }
  return { win: false, cells: [] };
}

// The draw a host route is about, after proving the host works at its venue. Shared by the three
// ticket routes: each one still calls verifyHostJwt and requireStaff itself, through this.
async function bingoDrawForStaff(env, authUserId, drawId) {
  if (!drawId) throw httpError(400, 'Missing draw_id');
  assertUuid(drawId, 'draw_id');
  const draws = await sbGet(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&select=' + BINGO_DRAW_COLS);
  if (!draws.length) throw httpError(404, 'Draw not found');
  const staff = await requireStaff(env, authUserId, draws[0].venue_id);   // staff at THIS venue, and the kill-switch
  return { draw: draws[0], staff };
}

async function handleBingoDeal(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const { draw } = await bingoDrawForStaff(env, authUserId, String(b.draw_id || '').trim());
  if (draw.finished_at) return json({ error: 'This game is finished' }, 409);
  const drawId = draw.id;

  // What was asked: one hand per phone, a sane count, and tablet tickets only in a sane shape.
  let hands = [];
  const named = new Set();
  (Array.isArray(b.hands) ? b.hands : []).slice(0, BINGO_DEAL_MAX_HANDS).forEach(function (h) {
    if (!h) return;
    const pid = String(h.pid || '');
    if (!BINGO_PID_RE.test(pid) || named.has(pid)) return;
    const did = (typeof h.did === 'string' && BINGO_DID_RE.test(h.did) && !isPaperDevice(h.did)) ? h.did : null;
    const hand = { pid, did };
    if (Array.isArray(h.tablet)) {
      hand.tablet = [];
      h.tablet.slice(0, BINGO_DEAL_MAX_TICKETS).forEach(function (t) {
        const cells = ticketFlat27(t && t.cells);
        const no = parseInt(t && t.card_no, 10);
        // When the tablet says it dealt it: kept beside the server's own time, never in the future.
        let at = Date.parse(t && t.dealt_at);
        at = (Number.isFinite(at) && at <= Date.now()) ? new Date(at).toISOString() : null;
        if (cells && no > 0 && no < 100000) hand.tablet.push({ cells, card_no: no, at });
      });
    } else {
      const want = parseInt(h.want, 10);
      hand.want = Math.max(0, Math.min(BINGO_DEAL_MAX_TICKETS, Number.isFinite(want) ? want : 0));
    }
    named.add(pid);
    hands.push(hand);
  });
  const refused = [];
  /* NO PHONE TICKET WHERE BINGO IS PLAYED ON PAPER: SA, VIC and TAS (the same list /join/info tells
     the phones from), and a real-balls night anywhere (caller mode). The phones there are already
     told to play on paper and never join the room; this is the server saying so too, so a stale page
     cannot be dealt one. Refused per phone, not as an error, so the console does not take the refusal
     for an outage and deal from the tablet instead. Tablet tickets are refused here too (audit,
     19 Oct 2026): a ticket the rules forbid does not become allowed by being dealt on a tablet. */
  let paperNight = draw.fallback_why === CALLER_REASON;
  if (!paperNight) {
    const v = await sbGet(env, 'vp_venues', 'id=eq.' + enc(draw.venue_id) + '&select=au_state&limit=1');
    paperNight = !!(v[0] && PAPER_BINGO_STATES.has(String(v[0].au_state || '').toUpperCase()));
  }
  if (paperNight) hands = hands.filter(function (h) { refused.push(h.pid); return false; });
  /* THE SEAT RULE. In a session, a ticket goes only to a phone whose device id holds a live row in
     it: the phone has been to /join for this night, and it is what the bill counts. A phone on the
     channel with no server identity is never dealt (it is asked to check in, by the console). */
  if (draw.session_id && hands.length) {
    const dids = hands.filter((h) => h.did).map((h) => h.did);
    const rows = dids.length ? await sbGet(env, 'vp_players', 'session_id=eq.' + enc(draw.session_id) + '&kicked=eq.false&device_id=in.(' +
      dids.map(enc).join(',') + ')&select=device_id&limit=' + (dids.length * 4)) : [];
    const known = new Set(rows.map((r) => r.device_id));
    hands = hands.filter(function (h) { if (h.did && known.has(h.did)) return true; refused.push(h.pid); return false; });
  }
  /* TABLET TICKETS ONLY AFTER AN OUTAGE THE SERVER ITSELF RECORDED (audit, 19 Oct 2026). They used to be
     taken for any phone at any time and judged like the server's own, so a host could put a made-up
     ticket on the record after the balls were out and have a claim confirmed on it. Now a tablet
     ticket is recorded only when: the server logged a failed deal on this draw (deal_failed_at), no
     ball is on the record yet, the venue's state allows tablet fallbacks, and the phone holds no
     ticket the server dealt. The seat rule and the paper refusal above apply to it like any ticket. */
  const standingNow = await standingBallCount(env, drawId);
  /* THE SERVER WAS ASKED TO DEAL (migration 108). Written once per draw, after the staff check. With no
     ball yet on the record, it is the server's own evidence that the console asked, which is what lets the
     tablet's tickets on when the console never got the answer (a slow server, not only a dead one). */
  if (hands.some((h) => !h.tablet) && !draw.deal_asked_at) {
    try { await sbPatch(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&deal_asked_at=is.null', { deal_asked_at: new Date().toISOString() }); draw.deal_asked_at = 'now'; }
    catch (e) { /* the deal itself is what matters */ }
  }
  if (hands.some((h) => h.tablet)) {
    /* Tablet tickets go on the record only before the first ball, only where the state allows the tablet
       to stand in, and only on a draw the server was asked to deal on (or failed a deal on). A server
       ticket the same phone holds was then never seen by it (the console gave up before the answer): it
       is kept on the record as VOID, with the reason, and the phone's tablet ticket stands. Before the
       first ball no ticket is worth more than another, so the swap gives nobody anything. */
    const okHere = tabletFallbackOk(await venueState(env, draw.venue_id)) && standingNow === 0 && !!(draw.deal_failed_at || draw.deal_asked_at);
    if (okHere) {
      const tp = hands.filter((h) => h.tablet).map((h) => h.pid);
      const unseen = (await sbGetAll(env, 'vp_bingo_tickets', 'draw_id=eq.' + enc(drawId) + '&pid=in.(' + tp.map(enc).join(',') +
        ')&source=eq.server&dealt_at=not.is.null&voided_at=is.null&select=id,pid,book,page&order=pid.asc,book.asc,page.asc')).map((t) => t.id);
      if (unseen.length) {
        await sbPatch(env, 'vp_bingo_tickets', 'id=in.(' + unseen.map(enc).join(',') + ')&voided_at=is.null',
          { voided_at: new Date().toISOString(), void_reason: 'never reached the phone: the console dealt this phone from the tablet in an outage, before any ball' });
      }
    }
    hands = hands.filter(function (h) { if (!h.tablet || okHere) return true; refused.push(h.pid); return false; });
  }
  if (!hands.length) return json({ ok: true, hands: {}, refused, paper: paperNight });
  try {
    return await bingoDealHands(env, json, draw, hands, refused, paperNight, standingNow);
  } catch (e) {
    /* THE SERVER'S OWN RECORD THAT A DEAL FAILED. A deal it received and could not complete is the one
       outage the server can vouch for, and the only thing that lets tablet tickets on the record. */
    if (!(e && e.status >= 400 && e.status < 500)) {
      try { await sbPatch(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId), { deal_failed_at: new Date().toISOString(), deal_fail_why: String((e && e.message) || e).slice(0, 200) }); } catch (e2) {}
    }
    throw e;
  }
}
async function bingoDealHands(env, json, draw, hands, refused, paperNight, standingNow) {
  const drawId = draw.id;
  const pidIn = 'pid=in.(' + hands.map((h) => enc(h.pid)).join(',') + ')';
  const held = await sbGetAll(env, 'vp_bingo_tickets', 'draw_id=eq.' + enc(drawId) + '&' + pidIn +
    '&select=id,pid,book,page,card_no,source,dealt_at,voided_at&order=pid.asc,book.asc,page.asc');
  const used = new Set((await sbGetAll(env, 'vp_bingo_tickets', 'draw_id=eq.' + enc(drawId) +
    '&source=eq.server&card_no=not.is.null&select=card_no&order=card_no.asc')).map((r) => r.card_no));
  const now = new Date().toISOString();
  const inserts = [], deal = [], voids = [];
  hands.forEach(function (h) {
    const mine = held.filter((t) => t.pid === h.pid);
    let book = mine.reduce((m, t) => Math.max(m, t.book + 1), 0);
    if (h.tablet) {
      // Recording what the tablet dealt in an outage. A number already on the record for this
      // player is already recorded (the console sends the whole hand each time it tries).
      const have = new Set(mine.filter((t) => t.card_no != null).map((t) => t.card_no));
      let k = 0;
      h.tablet.forEach(function (t) {
        if (have.has(t.card_no)) return;
        have.add(t.card_no);
        inserts.push({ draw_id: drawId, pid: h.pid, device_id: h.did, book: book + Math.floor(k / 6), page: k % 6,
                       cells: t.cells, card_no: t.card_no, source: 'tablet', dealt_at: now, tablet_dealt_at: t.at, balls_at_deal: standingNow });
        k++;
      });
      return;
    }
    const live = mine.filter((t) => t.dealt_at && !t.voided_at);
    if (h.want > live.length) {
      let need = h.want - live.length;
      // The next pages of a book this player already holds come first: the same book, continued.
      mine.filter((t) => !t.dealt_at && !t.voided_at && t.source === 'server').forEach(function (t) {
        if (need <= 0) return;
        deal.push({ id: t.id, card_no: freshCardNo(used), device_id: h.did });
        need--;
      });
      while (need > 0) {
        const strip = generateStrip();
        for (let pg = 0; pg < 6; pg++) {
          const now1 = need > 0;
          inserts.push({ draw_id: drawId, pid: h.pid, device_id: h.did, book, page: pg, cells: strip[pg],
                         card_no: now1 ? freshCardNo(used) : null, source: 'server', dealt_at: now1 ? now : null, balls_at_deal: standingNow });
          if (now1) need--;
        }
        book++;
      }
    } else if (h.want < live.length) {
      // Fewer than they hold (a sale corrected at the bar): the newest go back. Voided, never deleted.
      live.slice(h.want).forEach((t) => voids.push(t.id));
    }
  });
  try {
    if (inserts.length) await sbInsert(env, 'vp_bingo_tickets', inserts, false);
  } catch (e) {
    // A racing deal for the same game took a page or a number first. Nothing was written (the
    // insert is one statement); ask again and the next answer is computed from what is there now.
    if (e && e.status === 409) return json({ error: 'Dealing already in progress. Try again.' }, 429);
    throw e;
  }
  for (const d of deal) {
    await sbPatch(env, 'vp_bingo_tickets', 'id=eq.' + enc(d.id) + '&dealt_at=is.null',
      { dealt_at: now, card_no: d.card_no, device_id: d.device_id, balls_at_deal: standingNow });
  }
  if (voids.length) {
    await sbPatch(env, 'vp_bingo_tickets', 'id=in.(' + voids.map(enc).join(',') + ')&voided_at=is.null', { voided_at: now });
  }
  // The answer is what is ON THE RECORD now, read back, not what this request meant to write.
  const after = await sbGetAll(env, 'vp_bingo_tickets', 'draw_id=eq.' + enc(drawId) + '&' + pidIn +
    '&dealt_at=not.is.null&voided_at=is.null&select=pid,book,page,cells,card_no,source&order=pid.asc,book.asc,page.asc');
  const out = {};
  hands.forEach((h) => { out[h.pid] = []; });
  after.forEach((t) => { if (out[t.pid]) out[t.pid].push({ card_no: t.card_no, cells: ticketRows3x9(t.cells), source: t.source }); });
  return json({ ok: true, hands: out, refused, paper: paperNight });
}

async function handleBingoClaim(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const { draw } = await bingoDrawForStaff(env, authUserId, String(b.draw_id || '').trim());
  const drawId = draw.id;
  const pid = String(b.pid || ''), ref = String(b.ref || ''), pattern = String(b.pattern || '');
  if (!BINGO_PID_RE.test(pid)) return json({ error: 'Bad player' }, 400);
  if (!BINGO_REF_RE.test(ref)) return json({ error: 'Bad claim reference' }, 400);
  if (BINGO_CLAIM_PATTERNS.indexOf(pattern) < 0) return json({ error: 'Bad pattern' }, 400);
  const balls = parseInt(b.balls, 10);
  if (!(balls >= 0 && balls <= 90)) return json({ error: 'Bad ball count' }, 400);
  const cardNoCalled = parseInt(b.card_no, 10) || null;
  const decision = ['confirmed', 'rejected', 'dropped'].indexOf(b.decision) >= 0 ? b.decision : null;
  const decidedOnTablet = b.decided_on === 'tablet';
  const tabletVerdict = (b.tablet_verdict === 'win' || b.tablet_verdict === 'not_yet') ? b.tablet_verdict : null;

  // The same claim again (the console retrying after a timeout): the first verdict stands.
  const prior = await sbGet(env, 'vp_bingo_claims', 'draw_id=eq.' + enc(drawId) + '&ref=eq.' + enc(ref) + '&select=*&limit=1');
  if (prior.length) return await bingoClaimAnswer(env, json, draw, prior[0], authUserId, decision);

  // THE BALLS: this server's own record, in the order they were called.
  const standing = await sbGetStandingBalls(env, 'draw_id=eq.' + enc(drawId) + '&select=ordinal,number,source&order=ordinal.asc&limit=90');
  let note = null;
  const called = Array.isArray(b.called) ? b.called.map((n) => parseInt(n, 10)) : null;
  if (called && called.length <= 90 && called.every((n) => n >= 1 && n <= 90) && new Set(called).size === called.length) {
    const agrees = standing.every((r, i) => called[i] === r.number);
    if (!agrees) {
      note = 'The tablet\'s called numbers disagree with the server record; the server record was used.';
    } else if (called.length > standing.length) {
      /* Balls the tablet called while it could not reach us, which the best-effort fallback reports
         never delivered. Taken ONLY on the rules /host/bingo/fallback applies (audit, 19 Oct 2026):
         never on a finished or real-balls draw, never where the state's tablet fallback is off, and on
         a server draw only if the server itself was asked for the next place and never filled it.
         The console's word (tablet_draw) is not enough. Appended in order; the table's keys refuse a
         repeat. Otherwise the tablet adds nothing and the claim is judged on the server's record. */
      let local = !draw.finished_at && !isCallerDraw(draw) && tabletFallbackOk(await venueState(env, draw.venue_id)) &&
        (draw.mode === 'local' || serverFailedBall(draw, standing.length + 1));
      if (local && draw.mode !== 'local') {
        await sbPatch(env, 'vp_bingo_draws', 'id=eq.' + enc(drawId) + '&mode=eq.server',
          { mode: 'local', fallback_at: standing.length + 1, fallback_why: String(b.tablet_why || 'worker unreachable').slice(0, 200) });
        draw.mode = 'local'; draw.fallback_why = String(b.tablet_why || 'worker unreachable').slice(0, 200);
      }
      if (local) {
        for (let i = standing.length; i < Math.min(called.length, balls); i++) {
          try {
            await sbInsert(env, 'vp_bingo_draw_balls', { draw_id: drawId, ordinal: i + 1, number: called[i], source: 'local' }, false);
            standing.push({ ordinal: i + 1, number: called[i], source: 'local' });
          } catch (e) { note = 'A tablet ball could not be added to the record.'; break; }
        }
      } else {
        note = 'The tablet showed more numbers than the server has on its record, and the server did not fail to call them; the server record was used.';
      }
    }
  }
  const out = standing.slice(0, balls);
  const set = new Set(out.map((r) => r.number));

  // THE TICKET: this server's copy, never anything the phone or the tablet says is on it.
  /* A tablet ticket counts only if it was on the record before ANY ball (balls_at_deal 0): a ticket
     recorded after the numbers it needs were out proves nothing (audit, 19 Oct 2026). */
  const tickets = (await sbGet(env, 'vp_bingo_tickets', 'draw_id=eq.' + enc(drawId) + '&pid=eq.' + enc(pid) +
    '&dealt_at=not.is.null&voided_at=is.null&select=id,card_no,cells,source,device_id,balls_at_deal&order=book.asc,page.asc&limit=48'))
    .filter((t) => t.source !== 'tablet' || t.balls_at_deal === 0);
  let tk = cardNoCalled ? (tickets.find((t) => t.card_no === cardNoCalled) || null) : null, swapped = false;
  if (!tk) {
    // They pressed on a number we do not hold for them (they slept through a re-deal): check the
    // ticket of theirs that does win, if any, and say it was swapped. The console's rule exactly.
    tk = tickets.find((t) => bingoTicketWins(t.cells, set, pattern).win) || null;
    if (tk) swapped = true;
  }
  const won = tk ? bingoTicketWins(tk.cells, set, pattern) : { win: false, cells: [] };
  const verdict = !tickets.length ? 'no_ticket' : (won.win ? 'win' : 'not_yet');
  const row = {
    draw_id: drawId, ref, pid, device_id: (tk && tk.device_id) || (tickets[0] && tickets[0].device_id) || null,
    card_no_called: cardNoCalled, ticket_id: tk ? tk.id : null, card_no: tk ? tk.card_no : null, swapped,
    pattern, balls: out.length, last_ball: out.length ? out[out.length - 1].number : null,
    verdict, winning_cells: won.cells, decided_on: decidedOnTablet ? 'tablet' : 'server',
    tablet_verdict: decidedOnTablet ? tabletVerdict : null, record_note: note,
  };
  let saved;
  try {
    const rows = await sbInsert(env, 'vp_bingo_claims', row, true);
    saved = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    if (!(e && e.status === 409)) throw e;
    // Two copies of the same retry crossed: the one that landed first is the claim.
    const again = await sbGet(env, 'vp_bingo_claims', 'draw_id=eq.' + enc(drawId) + '&ref=eq.' + enc(ref) + '&select=*&limit=1');
    if (!again.length) throw e;
    saved = again[0];
  }
  // record_short: the claim needs more balls than the server has on its record (the tablet called
  // them in an outage the server did not see). The console then knows the server could not judge it.
  return await bingoClaimAnswer(env, json, draw, saved, authUserId, decision, tk, { record_short: balls > out.length });
}
/* CONFIRMED ONLY WHAT THE SERVER CAN STAND BEHIND (audit, 19 Oct 2026). A claim is recorded as confirmed
   only if the server's own verdict is a win, or the host had to decide it on the tablet's check during
   an outage this server itself recorded on the draw (and the state allows tablet fallbacks). A host who
   confirms anything else is refused: the claim stays on the record as it was, with the server's verdict. */
async function bingoMayConfirm(env, draw, c) {
  if (c.verdict === 'win') return true;
  if (c.decided_on !== 'tablet' || !drawHadOutage(draw)) return false;
  return tabletFallbackOk(await venueState(env, draw.venue_id));
}
async function bingoClaimAnswer(env, json, draw, c, authUserId, decision, tk, extra) {
  if (decision === 'confirmed' && c.status === 'pending' && !(await bingoMayConfirm(env, draw, c))) {
    return json({ error: 'The server checked this ticket and it is not a win, so it cannot be confirmed.', claim_id: c.id, verdict: c.verdict, status: c.status }, 409);
  }
  return json(Object.assign(await bingoClaimReply(env, c, authUserId, decision, tk), extra || {}));
}
// One shape for a claim's answer, whether it was just made or is being asked about again.
async function bingoClaimReply(env, c, authUserId, decision, tk) {
  if (decision && c.status === 'pending') {
    await sbPatch(env, 'vp_bingo_claims', 'id=eq.' + enc(c.id) + '&status=eq.pending',
      { status: decision, resolved_at: new Date().toISOString(), resolved_by: authUserId });
    c.status = decision;
  }
  let ticket = tk || null;
  if (!ticket && c.ticket_id) {
    const t = await sbGet(env, 'vp_bingo_tickets', 'id=eq.' + enc(c.ticket_id) + '&select=card_no,cells,source&limit=1');
    ticket = t[0] || null;
  }
  return { claim_id: c.id, verdict: c.verdict, card_no: c.card_no, swapped: !!c.swapped,
           cells: ticket ? ticketRows3x9(ticket.cells) : null, ticket_source: ticket ? ticket.source : null,
           winning_cells: c.winning_cells || [], balls: c.balls, status: c.status, note: c.record_note || null };
}

/* POST /host/bingo/finish {draw_id}: the game is over (Finish game, End game). The draw is finished on the
   record, so no ball, deal or tablet fallback is taken on it after (VP-DRAW-1.1). Idempotent. */
async function handleBingoFinish(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const { draw } = await bingoDrawForStaff(env, authUserId, String(b.draw_id || '').trim());
  await bingoFinishDraws(env, 'id=eq.' + enc(draw.id));
  return json({ ok: true });
}

async function handleBingoClaimResolve(request, env, json) {
  const authUserId = await verifyHostJwt(request, env);
  const b = await readJson(request);
  const claimId = String(b.claim_id || '').trim();
  if (!claimId) return json({ error: 'Missing claim_id' }, 400);
  assertUuid(claimId, 'claim_id');
  const decision = String(b.decision || '');
  if (['confirmed', 'rejected', 'dropped'].indexOf(decision) < 0) return json({ error: 'Bad decision' }, 400);
  const claims = await sbGet(env, 'vp_bingo_claims', 'id=eq.' + enc(claimId) + '&select=id,draw_id,status,verdict,decided_on&limit=1');
  if (!claims.length) return json({ error: 'Claim not found' }, 404);
  const { draw } = await bingoDrawForStaff(env, authUserId, claims[0].draw_id);   // staff at the claim's venue
  if (claims[0].status !== 'pending') return json({ ok: true, status: claims[0].status });   // a retry: already decided
  if (decision === 'confirmed' && !(await bingoMayConfirm(env, draw, claims[0]))) {
    return json({ error: 'The server checked this ticket and it is not a win, so it cannot be confirmed.', status: 'pending', verdict: claims[0].verdict }, 409);
  }
  const done = await sbPatchReturning(env, 'vp_bingo_claims', 'id=eq.' + enc(claimId) + '&status=eq.pending',
    { status: decision, resolved_at: new Date().toISOString(), resolved_by: authUserId });
  return json({ ok: true, status: done.length ? decision : 'already decided' });
}
