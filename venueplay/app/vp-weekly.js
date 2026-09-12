/* THE ONCE-A-WEEK RULE, MIRRORED FOR THE HOST BEFORE THE ROOM IS IN.
 *
 * The Worker is the referee. venueplay-game.js checkWeeklyFormatLimit refuses a NEW trivia or
 * musical bingo night inside a rolling 7 days, and it runs on the GAME START route. That means
 * it fires after the host has opened the lobby, after the QR has gone up on the TV, and after
 * the room has scanned in. Being refused at that moment, in front of a full room, is the worst
 * possible time to learn it.
 *
 * So the console mirrors the rule and says it while the host is still on the setup screen.
 *
 * WHY THIS IS A SHARED FILE. The mirror was written for trivia on one day and never added to
 * musical bingo, even though the Worker rule covers both. A musical host still got the old
 * behaviour in full: lobby up, room seated, then a 429. That is the fault this repo keeps
 * getting bitten by, and the fix is not to copy the rule into the second console, it is to
 * have one rule that both ask. Found 12 Sep 2026.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not decide anything. It returns what to SAY, and
 * the console decides what to do with it. This is a mirror of a server rule read from a venue
 * row the console may have loaded minutes ago, so it can be wrong, which is exactly why the
 * host keeps a way to go ahead anyway.
 *
 * The three numbers below are the Worker's, and they have to stay the Worker's:
 *   WEEK          7 days, the limit itself
 *   RESUME_GRACE  8 hours, inside which a restart is the SAME night and is always allowed
 *   BNE_OFFSET    Brisbane is UTC+10 with no daylight saving, used only to name the day
 */
(function (root) {
  'use strict';

  var WEEK = 7 * 24 * 60 * 60 * 1000;
  var RESUME_GRACE = 8 * 60 * 60 * 1000;
  var BNE_OFFSET = 10 * 3600 * 1000;

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];

  /* "2026-09-19" -> "Saturday 19 September". Built in UTC on purpose: the string handed in is
     already a Brisbane calendar day, so reading it in local time would slide it by one. */
  function friendlyDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }

  /* Any yyyy-mm-dd inside a server message becomes a day a person can read. The Worker's
     refusal carries a bare date, and "available from 2026-09-19" is not how anyone speaks. */
  function friendlyMsg(msg) {
    return String(msg == null ? '' : msg).replace(/\b(\d{4}-\d{2}-\d{2})\b/g, function (_, iso) {
      return friendlyDay(iso);
    });
  }

  /* venue: the vp_venues row the console holds. format: "trivia" or "musical".
     now: injectable for tests only.
     Returns null when there is nothing to say, otherwise { nextIso, nextDay, text }. */
  function check(venue, format, now) {
    if (!venue) return null;
    var col = format === 'musical' ? 'last_musical_at' : 'last_trivia_at';
    var label = format === 'musical' ? 'Musical bingo' : 'Trivia';
    var lastAt = venue[col];
    if (!lastAt) return null;
    var last = new Date(lastAt).getTime();
    if (isNaN(last)) return null;

    var elapsed = (now == null ? Date.now() : now) - last;
    // Negative means the row is ahead of this device's clock. Say nothing rather than
    // guess: the Worker will decide, and a wrong warning is worse than none.
    if (elapsed < 0) return null;
    if (elapsed < RESUME_GRACE) return null;   // same night, picking it back up
    if (elapsed >= WEEK) return null;          // the week is up, nothing to warn about

    var nextIso = new Date(last + WEEK + BNE_OFFSET).toISOString().slice(0, 10);
    return {
      nextIso: nextIso,
      nextDay: friendlyDay(nextIso),
      text: label + ' has already run at this venue this week. Your next ' +
            label.toLowerCase() + ' night is available from '
    };
  }

  root.VPWeekly = { check: check, friendlyDay: friendlyDay, friendlyMsg: friendlyMsg,
                    WEEK: WEEK, RESUME_GRACE: RESUME_GRACE };
}(typeof globalThis === 'object' ? globalThis : this));
