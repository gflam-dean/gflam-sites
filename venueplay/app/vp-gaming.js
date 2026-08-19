/* VenuePlay: what can this venue actually run tonight, in this state.
 *
 * WHAT THIS IS FOR
 * OLGR wrote to us on 18 Aug 2026. Bingo, musical bingo, members draws and raffles are gaming.
 * Trivia is a game of skill and is not regulated. The rules then differ by state, and inside a
 * state they differ by what the venue IS: a club is a non-profit and may keep the takings, a pub
 * is not and generally may not.
 *
 * WHAT THIS IS NOT
 * We supply the software. The venue supplies the prize, sells any tickets and keeps the money.
 * This does not stop anybody doing anything. It shows the host the rules for their own state
 * before the game starts, and records that they saw them. Advice, not enforcement.
 *
 * THE RULE THAT MATTERS MOST
 * Where something is not confirmed we SAY SO and show nothing else. Guessing one state's rules
 * from another's would be worse than silence, because a venue would act on it.
 *
 * WHERE THE FACTS COME FROM
 * Each state's own legislation and regulator guidance, read in August 2026:
 *   NSW  Community Gaming Act 2018 + Community Gaming Regulation 2020 (NSW Fair Trading)
 *   QLD  Charitable and Non-Profit Gaming Act 1999 (OLGR), plus their letter of 18 Aug 2026
 *   VIC  Gambling Regulation Act 2003, Rules of Bingo Gazette S462 (VGCCC)
 *   WA   Gaming and Wagering Commission Act 1987 (Gaming and Wagering Commission)
 *   SA   Lottery and Gaming Act 1936 / Lottery and Gaming Regulations (Consumer and Business Services)
 *   ACT  Lotteries Act 1964, Unlawful Gambling Act 2009 (Gambling and Racing Commission)
 *   TAS  Gaming Control Act 1993 (Liquor and Gaming Tasmania)
 *   NT   Gaming Control Act 1993 (Licensing NT)
 * It moves. Victoria has changes landing through 2027. Treat this as a prompt to check, never
 * as advice: the footer of every popup says exactly that.
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------------------
     Which of our formats is which kind of game.
     Musical bingo is bingo. A members draw is a draw, which nearly everywhere is
     a trade promotion when entry is free. Trivia is skill and never appears here.
     --------------------------------------------------------------------------- */
  function kindOf(format) {
    if (format === 'bingo90' || format === 'bingo' || format === 'musical') return 'bingo';
    if (format === 'raffle') return 'raffle';
    if (format === 'members') return 'members';
    return null;                       // trivia, or anything not gaming
  }
  function isGaming(format) { return !!kindOf(format); }

  function formatName(format) {
    return { bingo90: 'Bingo', bingo: 'Bingo', musical: 'Musical bingo',
             raffle: 'Raffle', members: 'Members draw' }[format] || 'This game';
  }

  /* ---------------------------------------------------------------------------
     THE STATES.

     paid: 'yes'   the venue may charge for entry in its own right
           'cause' it may charge, but the game must be run for a charity or
                   non-profit and the proceeds go to them, not the venue
           'no'    it may not charge at all: free entry only
     Every state allows a FREE entry game for anyone, so 'no' never means
     "you cannot run this", only "you cannot sell tickets for it".
     --------------------------------------------------------------------------- */
  var STATES = {

    NSW: {
      confirmed: true, name: 'New South Wales', regulator: 'NSW Fair Trading',
      phones: { bingo: true },
      for_profit: {
        bingo:  { paid: 'no', notes: [
          'Paid bingo in NSW is for registered clubs only, and only on club premises. A hotel cannot run it, and unlike a raffle there is no route through a charity.',
          'Free entry is always open to you, with no permit and no limit on the prize.'] },
        raffle: { paid: 'cause', notes: [
          'A paid raffle has to be run by or on behalf of a charity or a non-profit. A pub can run one FOR a nominated cause: get their authorisation in writing first.',
          'At least 40% of the gross takings must go to the benefiting organisation. The pub cannot be its own beneficiary.',
          'Prizes up to $30,000, and cash prizes are allowed.'] },
        members:{ paid: 'no', notes: [
          'A members draw is a trade promotion, so entry must be free and cannot depend on a purchase.',
          'Over $10,000 in prize value you need an authority. If the draw is tied to the gaming machines the cap is $1,000.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'Club bingo: a maximum of $70 a game, and NO money prizes. On club premises. There is no cap on tickets and no proceeds rule.',
          'Charity housie is the alternative if you want cash prizes, up to $10,000 a session and 48 tickets a person, but 12.5% to charity plus 12.5% expenses plus 75% prizes leaves the club nothing.'] },
        raffle: { paid: 'yes', notes: [
          'No permit needed. At least 40% of the gross takings goes to the benefiting organisation.',
          'Prizes up to $30,000, and cash prizes are allowed.'] },
        members:{ paid: 'no', notes: [
          'Entry must be free: a members draw is a trade promotion.',
          'Over $10,000 in prize value you need an authority. Tied to the gaming machines, the cap is $1,000.'] }
      }
    },

    QLD: {
      confirmed: true, name: 'Queensland', regulator: 'OLGR',
      phones: { bingo: 'pending' },
      /* Our number generator is not yet approved here, which blocks the DRAW itself
         regardless of what the venue is allowed to do. This is about us, not them. */
      blocked: 'Our number generator is still going through OLGR approval, so we cannot run bingo, musical bingo, raffles or members draws in Queensland yet. Trivia is unaffected: it is a game of skill and OLGR do not regulate it.',
      for_profit: {
        bingo:  { paid: 'no', notes: ['A for-profit venue may only run a Category 4 promotional game, which means free entry. No licence, no limit on the prize, but nobody may pay to enter.'] },
        raffle: { paid: 'no', notes: ['Category 4 promotional game only: free entry. To sell tickets the game must be conducted by an eligible association, which holds any licence itself.'] },
        members:{ paid: 'no', notes: ['Free entry. Category 4 promotional game.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'Category 1 up to $2,000 of ticket sales, Category 2 up to $50,000, Category 3 above that with a licence whose number goes on every ticket.',
          'A bingo SESSION is capped at $20,000.',
          'Prizes must be worth at least 20% of expected ticket sales.'] },
        raffle: { paid: 'yes', notes: [
          'Category 1 up to $2,000 of ticket sales, Category 2 up to $50,000, Category 3 above that with a licence whose number goes on every ticket.',
          'Prizes must be worth at least 20% of expected ticket sales.'] },
        members:{ paid: 'no', notes: ['Free entry keeps it a Category 4 promotional game with no licence and no limits.'] }
      }
    },

    VIC: {
      confirmed: true, name: 'Victoria', regulator: 'VGCCC',
      phones: { bingo: 'unclear' },
      warn: 'Victoria publishes a rule that bingo "must not be conducted online" and nobody has defined what that covers. Until we have that in writing, do not rely on phone tickets for bingo here. Raffles and trivia are not affected.',
      for_profit: {
        bingo:  { paid: 'no', notes: [
          'A venue with gaming machines cannot hold a bingo operator licence in Victoria.',
          'Free entry is open to you as a trade promotion lottery: no permit, and any entry cost capped at $1.'] },
        raffle: { paid: 'cause', notes: [
          'A paid raffle must be run by a declared community or charitable organisation. A pub can host one for a cause, but the organisation is the one conducting it and holding any permit.',
          'Free entry as a trade promotion needs no permit, with entry costs capped at $1.'] },
        members:{ paid: 'no', notes: ['Trade promotion lottery: entry free, no permit, entry costs capped at $1.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'You must be a declared community or charitable organisation first.',
          'Seven days notice before a session. At least 20% of takings must go back as prizes in each game, and a session is capped at 30 games.'] },
        raffle: { paid: 'yes', notes: [
          'You must be a declared community or charitable organisation first.',
          'Raffles up to $23,060 in prizes need no permit. Above that, a permit.'] },
        members:{ paid: 'no', notes: ['Entry free as a trade promotion lottery.'] }
      }
    },

    WA: {
      confirmed: true, name: 'Western Australia', regulator: 'the Gaming and Wagering Commission',
      phones: { bingo: true },
      warn: 'A raffle using our draw needs independent certification BEFORE the permit is granted, and the venue pays for it. The Commission accepts a certificate from another state, so our Queensland one should cover it once granted. Verifying a win on screen needs separate approval.',
      for_profit: {
        bingo:  { paid: 'no', notes: ['No private gain is permitted at all in WA, so a for-profit venue cannot charge for entry. Free entry as a trade promotion is open to you, with any electronic entry cost capped at 55c.'] },
        raffle: { paid: 'cause', notes: ['No private gain is permitted. A pub can host a raffle for a cause, but the permitted body conducts it and holds the permit.'] },
        members:{ paid: 'no', notes: ['Trade promotion only: entry free, electronic entry cost capped at 55c.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'Bingo permit runs 6 months. One session a week, and a session is 3 hours or 32 games.',
          '1% of gross goes to the Commission, and expenses are capped at 20%.',
          'Electronic bingo cards are expressly allowed here.'] },
        raffle: { paid: 'yes', notes: ['A raffle permit runs 3 months.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free.'] }
      }
    },

    SA: {
      confirmed: true, name: 'South Australia', regulator: 'Consumer and Business Services',
      phones: { bingo: false },
      paperBingo: 'South Australia recognises only physical bingo sheets, bought from a licensed supplier. Players cannot use their phones as tickets here. Run the paper sheets and use our calling and our screen. Trivia on phones is unaffected.',
      for_profit: {
        bingo:  { paid: 'no', notes: ['Paper sheets only, and a for-profit venue cannot charge for entry in its own right.'] },
        raffle: { paid: 'cause', notes: [
          'Run it for a cause, or use the SA quirk: any person may run a lottery up to $2,000 gross if ALL proceeds go to the prizes and admin costs stay under 2%.',
          'Free entry as a trade promotion allows prizes up to $5,000 with no licence.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free, prizes up to $5,000, no licence.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'A session under $1,000 gross needs no licence. Above that you need a major bingo licence.',
          'Under a major bingo licence: session capped at $10,000 gross, 5 sessions a week, prizes at least 20%, and cash paid straight after each game.',
          'Paper sheets only. Phones cannot be used as tickets in South Australia.'] },
        raffle: { paid: 'yes', notes: ['A minor lottery with prizes up to $5,000 needs no licence. Above that, a major lottery licence, which costs $11.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free.'] }
      }
    },

    ACT: {
      confirmed: true, name: 'the ACT', regulator: 'the Gambling and Racing Commission',
      phones: { bingo: false },
      paperBingo: 'ACT housie rules do not allow players to hold electronic devices in the playing area, so phones cannot be used as bingo tickets here. Run paper and use our calling and our screen. Trivia is unaffected.',
      for_profit: {
        /* The ACT is the exception worth knowing: a for-profit may be its own beneficiary. */
        bingo:  { paid: 'yes', notes: [
          'Unusually, a for-profit venue may promote housie here and be its own beneficiary.',
          'Exempt up to $1,000 a session. Any single housie cash prize is capped at $1,000.',
          'Paper only: no phones in the playing area.'] },
        raffle: { paid: 'yes', notes: [
          'Unusually, a for-profit venue may promote raffles here and be its own beneficiary.',
          'Exempt up to $2,500 in prizes. Above that you need a permit.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free, prizes up to $3,000.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'Exempt up to $1,000 a session, and any single cash prize is capped at $1,000.',
          'Above the exemption the full harm-minimisation code applies: a nominated contact officer, trained staff and an incident register. Keep the session under $1,000 if you can.',
          'Paper only: no phones in the playing area.'] },
        raffle: { paid: 'yes', notes: ['Exempt up to $2,500 in prizes. Above that, a permit.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free, prizes up to $3,000.'] }
      }
    },

    TAS: {
      confirmed: true, name: 'Tasmania', regulator: 'Liquor and Gaming Tasmania',
      phones: { bingo: false },
      paperBingo: 'Tasmanian bingo rules are written around a printed card that the supervisor collects, so phones cannot be used as tickets here. Run paper and use our calling and our screen. Trivia is unaffected.',
      for_profit: {
        bingo:  { paid: 'cause', notes: [
          'A venue can hold the permit, but the proceeds cannot go to private gain: what is left goes to a not-for-profit.',
          'The economics are capped hard: cards at 50c, at least half of card sales back as prizes, operating costs capped at 5%. A venue can run it but cannot make money on it.',
          'Paper cards only. Records kept 7 years.'] },
        raffle: { paid: 'cause', notes: ['A venue can hold the permit, but proceeds cannot go to private gain. Prizes up to $10,000 are exempt, with cash prizes up to $5,000.'] },
        members:{ paid: 'no', notes: ['Entry free.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'Exempt if entry is $30 or less and no prize is over $300.',
          'Cards at 50c, at least half of card sales back as prizes, operating costs capped at 5%.',
          'Paper cards only. Records kept 7 years.'] },
        raffle: { paid: 'yes', notes: ['Prizes up to $10,000 are exempt, with cash prizes up to $5,000.'] },
        members:{ paid: 'no', notes: ['Entry free.'] }
      }
    },

    NT: {
      confirmed: true, name: 'the Northern Territory', regulator: 'Licensing NT',
      phones: { bingo: true },
      blocked: 'We are not selling paid games in the Northern Territory yet. A published permit condition says no payment, fee or commission whatsoever may be provided in relation to conducting a game, which may prevent an association paying us at all. We are checking it. Free entry games and trivia are fine.',
      for_profit: {
        bingo:  { paid: 'no', notes: ['Trade lottery only: entry free. Prizes up to $5,000 need no permit.'] },
        raffle: { paid: 'no', notes: ['Trade lottery only: entry free. Prizes up to $5,000 need no permit.'] },
        members:{ paid: 'no', notes: ['Entry free, and the prize is capped at $2,000.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: ['Approved non-profit associations only. Prizes must be worth at least a third of the ticket value.'] },
        raffle: { paid: 'yes', notes: [
          'Approved non-profit associations only.',
          'Up to $5,000 needs no permit. $5,001 to $20,000 needs a permit. Above that, a major lottery permit.',
          'Prizes must be worth at least a third of the ticket value.'] },
        members:{ paid: 'no', notes: ['Entry free, and the prize is capped at $2,000.'] }
      }
    }
  };

  /* ---------------------------------------------------------------------------
     assess(): everything the popup needs, in one call.

     opts: { state, entityType, format, paidEntry, paidEntryEnabled, venueName }
     Returns:
       { applies, confirmed, ok, blocked, headline, points[], warnings[], paper, state }
     ok=false means "do not go ahead as described", never "the button is disabled".
     --------------------------------------------------------------------------- */
  function assess(opts) {
    opts = opts || {};
    var out = { applies: true, confirmed: false, ok: true, blocked: null, paper: false,
                headline: '', points: [], warnings: [], state: opts.state || null };

    var kind = kindOf(opts.format);
    if (!kind) {
      out.applies = false;
      out.headline = 'Trivia is a game of skill, so the gaming rules do not apply.';
      out.points.push('Competition rules still apply. Those sit with Fair Trading and the ACCC, not the gaming regulator.');
      return out;
    }

    var st = STATES[opts.state];
    if (!st || !st.confirmed) {
      out.confirmed = false;
      out.headline = opts.state
        ? ('We have not confirmed the gaming rules for ' + opts.state + ' yet.')
        : 'We do not know which state this venue is in yet.';
      out.points.push('Free entry is the safe option everywhere. If nobody pays to play, it is a promotional game.');
      out.points.push('Before selling any ticket, check with your state regulator. We will not guess the rules for you.');
      if (!opts.state) out.warnings.push('Add this venue’s postcode on the account page and we can show you your own state’s rules here.');
      return out;
    }
    out.confirmed = true;

    // Paper-ticket states: true whatever else is going on, so say it every time.
    if (kind === 'bingo' && st.phones && st.phones.bingo === false) {
      out.paper = true;
      out.warnings.push(st.paperBingo);
    }

    // Something stopping the whole format in this state, regardless of the venue.
    if (st.blocked) { out.blocked = st.blocked; out.ok = false; }

    var entity = (opts.entityType === 'non_profit') ? 'non_profit' : 'for_profit';
    var rule = (st[entity] || {})[kind] || { paid: 'no', notes: [] };

    // Free entry is the safe path everywhere, so handle it first and briefly.
    if (!opts.paidEntry) {
      out.headline = 'Free entry. Nobody pays to play, so this is a promotional game and needs no licence anywhere.';
      out.points.push('Nobody may pay to enter, buy a ticket or buy a book, and entry cannot depend on a purchase.');
      out.points.push('There is no limit on what you put up as a prize.');
      if (rule.paid === 'yes') {
        out.points.push('In ' + st.name + ' you could charge for entry if you wanted to. Ask us to turn paid entry on for this venue.');
      }
      return out;
    }

    // Paid entry, but we have not switched it on for this venue.
    if (opts.paidEntryEnabled === false) {
      out.ok = false;
      out.headline = 'Paid entry is switched off for this venue.';
      out.warnings.push('We turn paid entry on once we have recorded whether you are a club or a pub, because that is what the rules turn on. Email hello@venueplay.com.au and we will sort it.');
      out.points.push('A free-entry game needs no licence anywhere and you can run one right now.');
      return out;
    }

    var who = entity === 'non_profit' ? 'a non-profit' : 'a for-profit venue';

    if (rule.paid === 'no') {
      out.ok = false;
      out.headline = 'In ' + st.name + ', ' + who + ' cannot charge for entry to ' + formatName(opts.format).toLowerCase() + '.';
      out.points = rule.notes.slice();
      out.warnings.push('Switch this game to free entry, or check with ' + st.regulator + ' before you sell a ticket.');
      return out;
    }

    if (rule.paid === 'cause') {
      out.headline = 'You can charge, but the game has to be run for a cause, not for the venue.';
      out.points = rule.notes.slice();
      out.warnings.push('Get the benefiting organisation’s authorisation in writing before you sell a ticket, and keep it.');
      return out;
    }

    out.headline = 'You can charge for entry to this game in ' + st.name + '.';
    out.points = rule.notes.slice();
    if (st.warn) out.warnings.push(st.warn);
    return out;
  }

  function money(cents) {
    var n = (Number(cents) || 0) / 100;
    return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: (n % 1 ? 2 : 0), maximumFractionDigits: 2 });
  }

  /* The words the venue ticks. Deliberately says who does what, because the regulator's
     letter read as though WE supply the prizes and take the money. */
  function declaration(venueName) {
    return 'I confirm that ' + (venueName || 'this venue') + ' is the conductor of this game. ' +
           'We provide the prize, we handle any ticket sales and we keep the proceeds. ' +
           'VenuePlay supplies the software only. We are responsible for meeting the rules ' +
           'for our category, including any licence.';
  }

  /* ===========================================================================
     THE POPUP.

     gate(opts, onProceed) shows the venue their own state's rules for the game they
     are about to start, and waits for them to press OK.

     Two things it deliberately does NOT do:
       * It never blocks the game. Even when the rules say they cannot charge, the
         button still says start, because we are not the regulator and a host mid-shift
         with a room full of people is not who you argue with. It informs and records.
       * It does not fire before every single game. Once a night, per format, per venue.
         A popup on game 7 of a bingo night gets clicked through without being read,
         which is worse for everyone than showing it once when the night starts.

     opts: { format, venue:{id,name,au_state,entity_type,paid_entry_enabled}, paidEntry, force }
     =========================================================================== */

  var CSS = [
    '.vpg-wrap{position:fixed;inset:0;z-index:99999;background:rgba(8,6,12,.78);backdrop-filter:blur(3px);',
    'display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto}',
    '.vpg-box{background:#17141d;color:#f4f1f5;border:1px solid #322c3b;border-radius:16px;max-width:530px;width:100%;',
    'font-family:-apple-system,BlinkMacSystemFont,"Hanken Grotesk","Segoe UI",sans-serif;box-shadow:0 24px 60px rgba(0,0,0,.5);margin:auto}',
    '.vpg-hd{padding:20px 24px 14px;border-bottom:1px solid #2a2532}',
    '.vpg-eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;font-weight:800;color:#FF1F8E;margin:0 0 6px}',
    '.vpg-hd h2{margin:0;font-size:20px;line-height:1.25;font-weight:750;letter-spacing:-.01em}',
    '.vpg-bd{padding:16px 24px 4px;max-height:52vh;overflow-y:auto}',
    '.vpg-lede{margin:0 0 14px;font-size:15px;line-height:1.45;color:#f4f1f5}',
    '.vpg-bd ul{margin:0 0 14px;padding-left:19px;display:flex;flex-direction:column;gap:7px}',
    '.vpg-bd li{font-size:13.5px;line-height:1.45;color:#c3bccb}',
    '.vpg-warn{border-left:3px solid #FFB020;background:rgba(255,176,32,.09);padding:11px 14px;border-radius:0 8px 8px 0;',
    'margin:0 0 12px;font-size:13.5px;line-height:1.45;color:#ffd89a}',
    '.vpg-stop{border-left:3px solid #FF4D6D;background:rgba(255,77,109,.1);padding:11px 14px;border-radius:0 8px 8px 0;',
    'margin:0 0 12px;font-size:13.5px;line-height:1.45;color:#ffbcc7}',
    '.vpg-decl{border:1px solid #2a2532;background:#100e16;border-radius:9px;padding:12px 14px;margin:2px 0 6px;',
    'font-size:12.5px;line-height:1.5;color:#9b93a5}',
    '.vpg-ft{padding:14px 24px 18px;border-top:1px solid #2a2532;display:flex;gap:9px;flex-wrap:wrap;align-items:center}',
    '.vpg-go{flex:1 1 auto;background:#FF1F8E;color:#fff;border:0;border-radius:10px;padding:13px 20px;font-size:14.5px;',
    'font-weight:750;cursor:pointer;font-family:inherit}',
    '.vpg-go:hover{background:#e50d78}',
    '.vpg-no{background:transparent;color:#c3bccb;border:1px solid #3a3444;border-radius:10px;padding:13px 18px;',
    'font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}',
    '.vpg-no:hover{border-color:#5a5268;color:#f4f1f5}',
    '.vpg-fine{padding:0 24px 18px;margin:0;font-size:11.5px;line-height:1.45;color:#7a7286}',
    '@media (max-width:520px){.vpg-go,.vpg-no{flex:1 1 100%}}'
  ].join('');

  function injectCss() {
    if (document.getElementById('vpg-css')) return;
    var s = document.createElement('style'); s.id = 'vpg-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ackKey(venueId, format) {
    var d = new Date();
    var day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return 'vpGamingAck:' + (venueId || 'x') + ':' + format + ':' + day;
  }
  function alreadyAcked(venueId, format) {
    try { return !!localStorage.getItem(ackKey(venueId, format)); } catch (e) { return false; }
  }
  function markAcked(venueId, format) {
    try { localStorage.setItem(ackKey(venueId, format), String(Date.now())); } catch (e) {}
  }

  /* Keep the record server-side too, because a localStorage flag proves nothing to anybody.
     Best-effort in the strongest sense: a failed write must never stop a night. */
  function record(venue, format, a, paidEntry) {
    try {
      if (!root.VP || !VP.gameApiPost) return;
      VP.gameApiPost('/host/gaming/declare', {
        venue_id: venue.id, format: format,
        entity_type: venue.entity_type || null,
        state: venue.au_state || null,
        paid_entry: !!paidEntry,
        category_claimed: a.headline || null
      });
    } catch (e) {}
  }

  function gate(opts, onProceed) {
    opts = opts || {};
    var venue = opts.venue || {};
    var format = opts.format;
    var proceed = typeof onProceed === 'function' ? onProceed : function () {};

    // Trivia never gets a popup: it is a game of skill.
    if (!isGaming(format)) { proceed(); return; }
    if (!opts.force && alreadyAcked(venue.id, format)) { proceed(); return; }

    var a = assess({
      state: venue.au_state, entityType: venue.entity_type, format: format,
      paidEntry: !!opts.paidEntry, paidEntryEnabled: venue.paid_entry_enabled !== false,
      venueName: venue.name
    });

    injectCss();
    var wrap = document.createElement('div');
    wrap.className = 'vpg-wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');

    var where = a.state ? esc(a.state) : 'Your state';
    var body = '';
    if (a.blocked) body += '<div class="vpg-stop">' + esc(a.blocked) + '</div>';
    body += '<p class="vpg-lede">' + esc(a.headline) + '</p>';
    if (a.points.length) {
      body += '<ul>';
      for (var i = 0; i < a.points.length; i++) body += '<li>' + esc(a.points[i]) + '</li>';
      body += '</ul>';
    }
    for (var j = 0; j < a.warnings.length; j++) body += '<div class="vpg-warn">' + esc(a.warnings[j]) + '</div>';
    body += '<div class="vpg-decl">' + esc(declaration(venue.name)) + '</div>';

    wrap.innerHTML =
      '<div class="vpg-box">' +
        '<div class="vpg-hd">' +
          '<p class="vpg-eyebrow">' + where + ' &middot; before you start</p>' +
          '<h2>' + esc(formatName(format)) + ' rules for your venue</h2>' +
        '</div>' +
        '<div class="vpg-bd">' + body + '</div>' +
        '<div class="vpg-ft">' +
          '<button type="button" class="vpg-go">I understand, start the game</button>' +
          '<button type="button" class="vpg-no">Not now</button>' +
        '</div>' +
        '<p class="vpg-fine">This is a prompt to check, not legal advice, and the rules change. ' +
        'You are the one running the game. Shown once a night for each game type.</p>' +
      '</div>';

    function close() { try { wrap.remove(); } catch (e) {} document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') { close(); } }

    wrap.querySelector('.vpg-go').addEventListener('click', function () {
      markAcked(venue.id, format);
      record(venue, format, a, opts.paidEntry);
      close();
      proceed();
    });
    wrap.querySelector('.vpg-no').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(wrap);
    try { wrap.querySelector('.vpg-go').focus(); } catch (e) {}
  }

  /* One-liner for the host consoles: work out the venue from the signed-in session and gate.
     Wrap whatever the start button already did:
        $("startBtn").addEventListener("click", function(){ VPGaming.gateFor("bingo90", start); });
     If anything at all goes wrong finding the venue, the game starts. A compliance prompt that
     can stop a night is a worse problem than the one it solves. */
  function gateFor(format, onProceed) {
    var proceed = typeof onProceed === 'function' ? onProceed : function () {};
    try {
      if (!isGaming(format)) { proceed(); return; }
      var ctx = (root.VP && VP.getContext && VP.getContext()) || null;
      var venue = ctx && ctx.venue;
      if (!venue) { proceed(); return; }
      if (alreadyAcked(venue.id, format)) { proceed(); return; }
      gate({ format: format, venue: venue, paidEntry: false }, proceed);
    } catch (e) { proceed(); }
  }

  root.VPGaming = {
    assess: assess, isGaming: isGaming, kindOf: kindOf, formatName: formatName,
    money: money, declaration: declaration, states: STATES,
    gate: gate, gateFor: gateFor, alreadyAcked: alreadyAcked
  };
})(window);
