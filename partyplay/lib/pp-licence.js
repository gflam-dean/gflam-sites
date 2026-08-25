/* PartyPlay licence window.
 *
 * A buyer picks THEIR STATE and A DATE, and 1 to 3 days. Play runs from midnight on the
 * first nominated day until 6am the morning after the last one, as a courtesy so a party
 * that runs late is not cut off mid-game.
 *
 * Building the games is NOT limited by any of this. A host can spend a fortnight writing
 * questions and uploading photographs. Only PLAY is bound to the window.
 *
 * Why the state is asked for at all: it is the timezone. Midnight in Perth is not midnight
 * in Sydney, and four states move for daylight saving while four do not. VenuePlay got away
 * with a hardcoded "+8 hours" because every venue was in Brisbane. PartyPlay cannot.
 *
 * DELIBERATE: the window is WALL CLOCK, not elapsed hours. On the night daylight saving
 * starts a one-day licence is 29 real hours, and on the night it ends it is 31. That is
 * correct: people understand "midnight until 6am", not "30 hours".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PPLicence = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ZONES = {
    NSW: 'Australia/Sydney',    VIC: 'Australia/Melbourne', QLD: 'Australia/Brisbane',
    SA:  'Australia/Adelaide',  WA:  'Australia/Perth',     TAS: 'Australia/Hobart',
    NT:  'Australia/Darwin',    ACT: 'Australia/Sydney'
  };
  var MAX_DAYS = 3;
  var END_HOUR = 6;

  function zoneFor(state) {
    var z = ZONES[String(state || '').toUpperCase().trim()];
    if (!z) throw new Error('Unknown state: ' + state);
    return z;
  }

  /* Wall-clock parts of an instant, as seen in a zone. */
  function partsInZone(ms, tz) {
    var f = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) {
      if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
    });
    if (o.hour === 24) o.hour = 0;            // some ICU builds report midnight as 24
    return o;
  }

  /* A wall-clock time in a zone -> the UTC instant. Two passes so a DST jump between the
     guess and the answer is absorbed; a third would never change it. */
  function zonedToUtc(y, mo, d, hh, mi, tz) {
    var want = Date.UTC(y, mo - 1, d, hh, mi, 0);
    var ms = want;
    for (var i = 0; i < 2; i++) {
      var p = partsInZone(ms, tz);
      var got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      var drift = want - got;
      if (!drift) break;
      ms += drift;
    }
    return ms;
  }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) throw new Error('Date must be YYYY-MM-DD, got: ' + s);
    var y = +m[1], mo = +m[2], d = +m[3];
    var probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
      throw new Error('Not a real date: ' + s);
    }
    return { y: y, mo: mo, d: d };
  }

  /* The whole contract, in one call.
     window('NSW', '2026-11-15', 1) -> { startsAt, endsAt, ... }  (epoch ms, UTC) */
  function windowFor(state, date, days) {
    var tz = zoneFor(state);
    /* Integer only. Math.floor would quietly turn 2.5 into 2 and sell a shorter licence
       than the number the buyer saw, which is exactly the sort of silent coercion that
       shows up later as a refund. */
    var n = Number(days);
    if (!isFinite(n) || n !== Math.trunc(n) || n < 1 || n > MAX_DAYS) {
      throw new Error('Days must be a whole number from 1 to ' + MAX_DAYS + ', got: ' + days);
    }
    var p = parseDate(date);

    var startsAt = zonedToUtc(p.y, p.mo, p.d, 0, 0, tz);
    // The morning AFTER the last nominated day. Built by adding days to the calendar date,
    // never by adding milliseconds, so a DST shift in between cannot move the 6am.
    var lastDay = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
    var endsAt = zonedToUtc(lastDay.getUTCFullYear(), lastDay.getUTCMonth() + 1,
                            lastDay.getUTCDate(), END_HOUR, 0, tz);

    return {
      state: String(state).toUpperCase().trim(),
      timezone: tz,
      date: date,
      days: n,
      startsAt: startsAt,
      endsAt: endsAt,
      startsAtIso: new Date(startsAt).toISOString(),
      endsAtIso: new Date(endsAt).toISOString(),
      elapsedHours: Math.round((endsAt - startsAt) / 36e5 * 100) / 100
    };
  }

  function isLive(w, nowMs) {
    var t = nowMs == null ? Date.now() : nowMs;
    return t >= w.startsAt && t < w.endsAt;
  }

  /* What the buyer is told, in their own words and their own time. */
  function describe(w) {
    var f = new Intl.DateTimeFormat('en-AU', {
      timeZone: w.timezone, weekday: 'long', day: 'numeric', month: 'long'
    });
    var first = f.format(new Date(w.startsAt + 12 * 36e5));       // midday, so the label is the right day
    var lastMorning = f.format(new Date(w.endsAt));
    return w.days === 1
      ? 'Midnight to 6am: ' + first + ', running until 6am on ' + lastMorning + '.'
      : w.days + ' days from midnight on ' + first + ', running until 6am on ' + lastMorning + '.';
  }

  return {
    ZONES: ZONES, MAX_DAYS: MAX_DAYS, PLAYER_CAP: 50,
    PRICE_CENTS: { 1: 5000, 3: 12000 },
    zoneFor: zoneFor, windowFor: windowFor, isLive: isLive, describe: describe
  };
}));
