/* PartyPlay licence: a stopwatch, not a calendar.
 *
 * It used to be a fixed window, midnight to 6am on a date chosen at purchase, in
 * the buyer's own state. That worked but it made everybody else's life harder:
 * the buyer had to commit to a date before they had a date, the form needed a
 * state and a date they did not want to think about yet, and every screen had to
 * explain a 6am cutoff nobody asked about.
 *
 * Now the clock starts when the host says go. They buy it, they build their games
 * whenever they like, and on the night they press start and confirm. Twenty four
 * hours, or seventy two, from that moment.
 *
 * What that quietly deletes: every timezone, daylight saving, and the whole
 * question of whose midnight. A duration is the same length everywhere.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPLicence = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HOUR = 3600 * 1000;
  var PLANS = {
    1: { days: 1, hours: 24, cents: 5000,  label: '24 hours' },
    3: { days: 3, hours: 72, cents: 12000, label: '3 days' }
  };

  /* An unstarted licence does not sit there forever. Twelve months is generous
     enough that nobody real ever hits it, and it stops a liability accruing
     indefinitely on something bought once and forgotten. */
  var UNUSED_EXPIRY_DAYS = 365;

  function plan(days) {
    var n = Number(days);
    if (!isFinite(n) || n !== Math.trunc(n) || !PLANS[n]) {
      throw new Error('Days must be 1 or 3, got: ' + days);
    }
    return PLANS[n];
  }

  /* Called when the host confirms. Everything after this is arithmetic. */
  function activate(days, nowMs) {
    var p = plan(days);
    var start = nowMs == null ? Date.now() : nowMs;
    return {
      days: p.days,
      hours: p.hours,
      startsAt: start,
      endsAt: start + p.hours * HOUR,
      startsAtIso: new Date(start).toISOString(),
      endsAtIso: new Date(start + p.hours * HOUR).toISOString()
    };
  }

  function isLive(lic, nowMs) {
    if (!lic || !lic.startsAt) return false;
    var t = nowMs == null ? Date.now() : nowMs;
    return t >= lic.startsAt && t < lic.endsAt;
  }

  function msLeft(lic, nowMs) {
    if (!lic || !lic.endsAt) return 0;
    return Math.max(0, lic.endsAt - (nowMs == null ? Date.now() : nowMs));
  }

  /* What a host reads on the console while the night is running. Rounded UP,
     because a clock that says "0 hours left" while the game is still going is
     worse than one that says "1 hour". */
  function timeLeft(lic, nowMs) {
    var ms = msLeft(lic, nowMs);
    if (ms <= 0) return 'Finished';
    var mins = Math.ceil(ms / 60000);
    if (mins < 60) return mins + (mins === 1 ? ' minute left' : ' minutes left');
    var hrs = Math.floor(mins / 60), rem = mins % 60;
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ' : ' hours ') + (rem ? rem + ' min left' : 'left');
    var d = Math.floor(hrs / 24), h = hrs % 24;
    return d + (d === 1 ? ' day ' : ' days ') + (h ? h + 'h left' : 'left');
  }

  function unusedExpiry(purchasedMs) {
    return purchasedMs + UNUSED_EXPIRY_DAYS * 24 * HOUR;
  }

  /* The words on the confirmation box. This is the only moment the buyer can
     make an expensive mistake, so it says the consequence, not the mechanism. */
  function startWarning(days) {
    var p = plan(days);
    return 'Start your ' + p.label + ' now? The clock runs from this moment, so ' +
           'only do this when the party is actually happening. You can keep building ' +
           'games without starting it.';
  }

  return {
    PLANS: PLANS, PLAYER_CAP: 50, UNUSED_EXPIRY_DAYS: UNUSED_EXPIRY_DAYS,
    PRICE_CENTS: { 1: 5000, 3: 12000 },
    plan: plan, activate: activate, isLive: isLive, msLeft: msLeft,
    timeLeft: timeLeft, unusedExpiry: unusedExpiry, startWarning: startWarning
  };
}));
