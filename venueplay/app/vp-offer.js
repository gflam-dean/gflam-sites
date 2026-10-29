/* THE MONTHLY OFFER, IN ONE PLACE (29 Oct 2026).

   Dean's phone test, 29 Oct 2026: the offer page said "$2.50 a player, if you lock it in by
   30 November" while the homepage pricing card said "$3.00" and "Your rate is $3 per player, per
   month, and it never changes." Two pages, two answers. The offer rows used to live inside the
   offer page (nsw.html) only, so the homepage could not know an offer was running.

   Now both pages read THIS file:
     - the offer page (/nsw, /offer-<mon>, all served from nsw.html) picks the row named by its
       address, exactly as before;
     - the homepage shows the row the campaign is being sent for (WRITTEN_FOR) while it is in date,
       and sends that row's code with its signup, so the venue is charged the price the card shows.
   Either page then asks the billing Worker (GET /founding?code=) whether the code is still open,
   and goes back to the standard rate if it is not: FOUNDING_CODES in Cloudflare decides the price.

   A new month is a new row here, its code added to FOUNDING_CODES on the day its campaign starts,
   and WRITTEN_FOR moved together with the vpc-date / vpc-day spans typed into nsw.html (the gate
   holds those to this row). Each code ENDS by itself at the end of its month, Brisbane time, here
   and in the Worker (vpaCodeInDate). */
(function (root) {
  var OFFERS = {
    oct: { code: 'OFFER-OCT-2026',    date: '31 October 2026',  day: '31 October',  month: 'October'  },
    nov: { code: 'OFFER-NOV-2026',  date: '30 November 2026', day: '30 November', month: 'November' },
    dec: { code: 'OFFER-DEC-2026',  date: '31 December 2026', day: '31 December', month: 'December' },
    jan: { code: 'OFFER-JAN-2027',  date: '31 January 2027',  day: '31 January',  month: 'January'  },
    feb: { code: 'OFFER-FEB-2027',  date: '28 February 2027', day: '28 February', month: 'February' },
    mar: { code: 'OFFER-MAR-2027',  date: '31 March 2027',    day: '31 March',    month: 'March'    }
  };
  /* THE ROW THE WORDS IN nsw.html ARE WRITTEN FOR, and the campaign being sent now. Every
     /offer-<mon> address is that one file, so the dates typed into its HTML are what a reader
     without JavaScript (a crawler, a link preview, curl) sees on ALL of them. The gate holds the
     typed dates to this row, and goes red once this row's month has ended. */
  var WRITTEN_FOR = 'nov';

  /* The prices, per player a month, GST inclusive. They must match the Stripe prices the billing
     Worker charges: offer = STRIPE_PRICE_MONTHLY / _ANNUAL, standard = STRIPE_PRICE_STANDARD_*. */
  var RATES = {
    offer:    { monthly: 2.50, annual: 2.30 },
    standard: { monthly: 3.00, annual: 2.85 }
  };

  var MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  /* Midnight at the end of the code's month, Brisbane (UTC+10 all year), the same instant the
     Worker's vpaCodeInDate stops honouring it. */
  function endsAt(row) {
    var m = /-([A-Z]{3})-(20\d\d)$/.exec(String(row && row.code || ''));
    if (!m || !(m[1] in MON)) return Infinity;
    return Date.UTC(Number(m[2]), MON[m[1]] + 1, 1) - 10 * 3600 * 1000;
  }
  function inDate(row, nowMs) { return !!row && (nowMs == null ? Date.now() : nowMs) < endsAt(row); }

  /* The offer page: the row its address names (/offer-nov), else October (/nsw, the link already
     in venues' inboxes). */
  function forPath(pathname) {
    var m = /^\/offer-([a-z]{3})\b/i.exec(pathname || '');
    var key = (m && OFFERS[m[1].toLowerCase()]) ? m[1].toLowerCase() : 'oct';
    return { key: key, row: OFFERS[key] };
  }
  /* The homepage: the campaign being sent now, or null once its month has ended. */
  function current(nowMs) {
    var row = OFFERS[WRITTEN_FOR];
    return inDate(row, nowMs) ? row : null;
  }

  root.VPOffer = { OFFERS: OFFERS, WRITTEN_FOR: WRITTEN_FOR, RATES: RATES, endsAt: endsAt, inDate: inDate, forPath: forPath, current: current };
})(typeof window !== 'undefined' ? window : this);
