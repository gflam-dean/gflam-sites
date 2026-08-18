/* VenuePlay: which gaming category is this night, and what does that mean.
 *
 * WHAT THIS IS FOR
 * OLGR wrote to us on 18 Aug 2026. Bingo, musical bingo, members draws and
 * raffles are gaming; trivia is a game of skill and is not. A for-profit venue
 * may only run a FREE ENTRY promotional game. A non-profit may run a bigger
 * game, and which one turns on how much the tickets raise.
 *
 * WHAT THIS IS NOT
 * We supply the software. The venue supplies the prize, sells any tickets and
 * keeps the money. This does not stop anybody doing anything: it works out the
 * numbers, says plainly which category that lands in, and records that the
 * venue is the conductor. Advice, not enforcement.
 *
 * THE ONE RULE THAT MATTERS MOST
 * Where a state has not been confirmed, we say so and show NOTHING else.
 * Guessing NSW rules from Queensland's would be worse than staying quiet:
 * a venue would act on it. Only QLD is filled in, because only QLD has
 * actually written to us. Adding a state means reading that state's
 * regulator, not copying the block below.
 */
(function (root) {
  'use strict';

  var C = 100;   // dollars -> cents, so the thresholds below read like the legislation

  /* QUEENSLAND. Source: OLGR email 18 Aug 2026 and
     business.qld.gov.au/industries/hospitality-tourism-sport/liquor-gaming/gaming/not-profit-charitable/competitions-raffles-bingo
     Charitable and Non-Profit Gaming Act 1999. Figures quoted are gross ticket
     sales, and every non-profit category also requires prizes to be at least
     20% of estimated sales. */
  var QLD = {
    confirmed: true,
    regulator: 'OLGR (Office of Liquor and Gaming Regulation)',
    minPrizeRatio: 0.20,
    forProfit: {
      // A pub or hotel. One option only, and it is the safe one.
      category: 'Category 4 promotional game',
      licence: false,
      freeEntryRequired: true,
      note: 'A for-profit venue can only run a free-entry promotional game. There is no licence and no limit on the prize, but nobody may pay to enter.'
    },
    nonProfit: [
      { max: 2000 * C,  category: 'Category 1', licence: false,
        note: 'Ticket sales up to $2,000. No licence needed.' },
      { max: 50000 * C, category: 'Category 2', licence: false,
        note: 'Ticket sales from $2,000 to $50,000. No licence needed. A bingo SESSION is capped at $20,000, and lucky envelopes at $5,000.' },
      { max: Infinity,  category: 'Category 3', licence: true,
        note: 'Ticket sales over $50,000. Needs a category 3 gaming licence, and the licence number must be printed on every ticket.' }
    ]
  };

  var STATES = {
    QLD: QLD,
    NSW: { confirmed: false }, VIC: { confirmed: false }, WA:  { confirmed: false },
    SA:  { confirmed: false }, TAS: { confirmed: false }, NT:  { confirmed: false },
    ACT: { confirmed: false }
  };

  /* Trivia is a game of skill. OLGR do not regulate it; competition rules sit
     with Fair Trading and the ACCC. It never gets a gaming category. */
  function isGaming(format) {
    return format === 'bingo90' || format === 'bingo' || format === 'musical' ||
           format === 'raffle'  || format === 'members';
  }

  /* The whole thing in one call.
     opts: { state, entityType, format, paidEntry, expectedSalesCents, totalPrizeCents }
     Returns { applies, confirmed, ok, category, licence, headline, points[], warnings[] } */
  function assess(opts) {
    opts = opts || {};
    var out = { applies: true, confirmed: false, ok: true, category: null,
                licence: false, headline: '', points: [], warnings: [] };

    if (!isGaming(opts.format)) {
      out.applies = false;
      out.headline = 'Trivia is a game of skill, so gaming rules do not apply.';
      out.points.push('Competition rules still apply: those sit with the Office of Fair Trading and the ACCC, not the gaming regulator.');
      return out;
    }

    var st = STATES[opts.state];
    if (!st || !st.confirmed) {
      // Say nothing rather than guess. A venue would act on a wrong answer.
      out.confirmed = false;
      out.headline = opts.state
        ? ('We have not confirmed the gaming rules for ' + opts.state + ' yet.')
        : 'We do not know which state this venue is in yet.';
      out.points.push('Free entry is the safe option everywhere: nobody pays to play, so it is a promotional game.');
      out.points.push('If you want to sell tickets, check with your state regulator first. We will not guess the rules for you.');
      return out;
    }
    out.confirmed = true;

    if (!opts.paidEntry) {
      out.category = st.forProfit.category;
      out.headline = 'Free entry. This is a ' + st.forProfit.category + ', which any venue can run.';
      out.points.push('No licence needed, and no limit on what you put up as a prize.');
      out.points.push('Nobody may pay to enter, buy a ticket or buy a book, and entry cannot be tied to a purchase.');
      return out;
    }

    // Paid entry from here on.
    if (opts.entityType !== 'non_profit') {
      out.ok = false;
      out.headline = 'A for-profit venue cannot charge for entry to this game.';
      out.warnings.push(st.forProfit.note);
      out.warnings.push('Switch the game to free entry, or check with ' + st.regulator + ' before selling tickets.');
      return out;
    }

    var sales = Number(opts.expectedSalesCents) || 0;
    var prize = Number(opts.totalPrizeCents) || 0;
    var band = null, i;
    for (i = 0; i < st.nonProfit.length; i++) {
      if (sales <= st.nonProfit[i].max) { band = st.nonProfit[i]; break; }
    }
    band = band || st.nonProfit[st.nonProfit.length - 1];

    out.category = band.category;
    out.licence = band.licence;
    out.headline = band.category + ' on ' + money(sales) + ' of expected ticket sales.';
    out.points.push(band.note);

    if (band.licence) {
      out.warnings.push('This needs a licence from ' + st.regulator + ' before you sell a ticket, and the licence number has to be printed on every ticket.');
      out.ok = false;
    }

    // The 20% prize rule, which is the one venues trip over.
    var need = Math.ceil(sales * st.minPrizeRatio);
    if (sales > 0 && prize < need) {
      out.ok = false;
      out.warnings.push('Prizes must be worth at least 20% of expected ticket sales. On ' + money(sales) +
                        ' that is ' + money(need) + ', and you have entered ' + money(prize) + '.');
    } else if (sales > 0) {
      out.points.push('Prizes are ' + Math.round((prize / sales) * 100) + '% of expected sales, and the minimum is 20%.');
    }
    return out;
  }

  function money(cents) {
    var n = (Number(cents) || 0) / 100;
    return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: (n % 1 ? 2 : 0), maximumFractionDigits: 2 });
  }

  /* The words the venue ticks. Deliberately says who does what, because the
     regulator's letter read as though WE supply the prizes and take the money. */
  function declaration(venueName) {
    return 'I confirm that ' + (venueName || 'this venue') + ' is the conductor of this game. ' +
           'We provide the prize, we handle any ticket sales and we keep the proceeds. ' +
           'VenuePlay supplies the software only. We are responsible for meeting the rules ' +
           'for our category, including any licence.';
  }

  root.VPGaming = {
    assess: assess,
    isGaming: isGaming,
    money: money,
    declaration: declaration,
    states: STATES
  };
})(window);
