/* THE MONTHLY OFFER ROWS, IN ONE FILE (29 Oct 2026).

   Every /offer-<mon> address is served from nsw.html (by _redirects), and that page reads its rows
   here: the row its address names, exactly as when the table was written out inside the page.
   Then it asks the billing Worker (GET /founding?code=) whether the code is still open, and says
   the offer has ended if it is not: FOUNDING_CODES in Cloudflare decides the price.

   THE HOMEPAGE NEVER LOADS THIS FILE. Dean, 29 Oct 2026: "Never put offers on the home page unless
   I say so." The homepage sells the standard rate; tools/site-offer-footer-in-chrome.test.py holds
   it to that.

   A new month is a new row here, its code added to FOUNDING_CODES on the day its campaign starts,
   and WRITTEN_FOR moved together with the vpc-date / vpc-day spans typed into nsw.html (the gate
   holds those to this row). Each code ENDS by itself at the end of its month, Brisbane time, in the
   Worker (vpaCodeInDate).

   ENDED ROWS STAY (1 Nov 2026). /nsw and /offer-oct are already in venues' inboxes, so an ended
   month keeps its row and is marked `ended: true` once its month is out. The page still asks the
   Worker, which answers open:false, and the page then says "This offer ended on <day>" and quotes
   only the standard rate (nsw.html, tools/offer-ended-in-chrome.test.py). The gate's "no founding
   page has outlived its own deadline" stays red for a row whose month has ended and is NOT marked. */
(function (root) {
  var OFFERS = {
    oct: { code: 'OFFER-OCT-2026',    date: '31 October 2026',  day: '31 October',  month: 'October',  ended: true },
    nov: { code: 'OFFER-NOV-2026',  date: '30 November 2026', day: '30 November', month: 'November' },
    dec: { code: 'OFFER-DEC-2026',  date: '31 December 2026', day: '31 December', month: 'December' },
    jan: { code: 'OFFER-JAN-2027',  date: '31 January 2027',  day: '31 January',  month: 'January'  },
    feb: { code: 'OFFER-FEB-2027',  date: '28 February 2027', day: '28 February', month: 'February' },
    mar: { code: 'OFFER-MAR-2027',  date: '31 March 2027',    day: '31 March',    month: 'March'    }
  };
  /* THE ROW THE WORDS IN nsw.html ARE WRITTEN FOR (the campaign being sent now). Every
     /offer-<mon> address is that one file, so the dates typed into its HTML are what a reader
     without JavaScript (a crawler, a link preview, curl) sees on ALL of them. The gate holds the
     typed dates to this row, and goes red once this row's month has ended. */
  var WRITTEN_FOR = 'nov';

  /* THE ROW FOR TODAY (Dean, 4 Nov 2026). The row whose code belongs to this calendar month in
     Brisbane (UTC+10 all year, no daylight saving): the code the billing Worker honours today
     (vpaCodeInDate ends each code with its month). The year comes from the code, so a 'nov' row
     written for 2026 is never picked in November 2027. No row for this month, or the row is
     marked ended: null, and the caller shows the standard rate. */
  var MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function forDate(nowMs) {
    var d = new Date((nowMs == null ? Date.now() : nowMs) + 10 * 3600 * 1000);
    var key = MON3[d.getUTCMonth()], row = OFFERS[key];
    if (!row || row.ended) return null;
    var y = /-(20\d\d)$/.exec(row.code || '');
    if (!y || Number(y[1]) !== d.getUTCFullYear()) return null;
    return key;
  }

  /* THE GFLAM GROUP SITE'S BANNER LINK, venueplay.com.au/gflam (Dean, 4 Nov 2026: "if someone
     lands on the Gflam group website and clicks the venueplay banner, send them to a discount
     link because they've come from us"). _redirects serves /gflam from this same page, and it
     shows whichever month's row is live today, so the group site never needs editing when the
     month rolls over. Past the last row it falls back to October, which is ended: the page then
     says the offer ended and quotes the standard rate, never a price the Worker will not charge.
     vp-subscribe.js tags a visit to /gflam as utm_source=gflam.com.au, so the sign-up is counted
     in HQ > Reports. */
  function isGflam(pathname) { return /^\/gflam\/?$/i.test(pathname || ''); }

  /* The offer page: the row its address names (/offer-nov), today's row for /gflam, else October
     (/nsw, the link already in venues' inboxes). */
  function forPath(pathname, nowMs) {
    if (isGflam(pathname)) {
      var today = forDate(nowMs);
      return { key: today || 'oct', row: OFFERS[today || 'oct'] };
    }
    var m = /^\/offer-([a-z]{3})\b/i.exec(pathname || '');
    var key = (m && OFFERS[m[1].toLowerCase()]) ? m[1].toLowerCase() : 'oct';
    return { key: key, row: OFFERS[key] };
  }
  root.VPOffer = { OFFERS: OFFERS, WRITTEN_FOR: WRITTEN_FOR, forPath: forPath, forDate: forDate, isGflam: isGflam };
})(typeof window !== 'undefined' ? window : this);
