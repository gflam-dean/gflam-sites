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
 * Two letters of advice from Mark Armstrong, Anisimoff Legal (their ref 9380), and the threshold
 * tables at the end of each one are the source of truth for every figure a venue is shown:
 *   1 Oct 2026  NSW, the general position, and the Interactive Gambling Act (Cth)
 *   8 Oct 2026  QLD, VIC, ACT and TAS
 * The letters establish that VenuePlay is not the conductor of any game and not a third-party
 * operator: the venue conducts the game, holds any permit, licence or authority, and carries
 * compliance. Monitoring and hard blocks are "prudent, not mandatory"; Dean asked for them anyway
 * (15 Oct 2026), so a venue that may not charge in its state is offered a free-entry game and not
 * a paid one. WA, SA and NT are not yet advised, so their text is what we read ourselves in
 * August 2026 from each state's own legislation and regulator guidance:
 *   WA   Gaming and Wagering Commission Act 1987 (Gaming and Wagering Commission), plus point 4
 *        of the 1 Oct letter on raffle certification
 *   SA   Lottery and Gaming Act 1936 / Lottery and Gaming Regulations (Consumer and Business Services)
 *   NT   Gaming Control Act 1993 (Licensing NT)
 * SA and NT were read again from the legislation on 22 Oct 2026 (venue-enrich/state-rules/
 * SA-NT-WA-FINDINGS-2026-10-22.md), and Dean decided what to do with it the same day:
 *   SA   Lotteries Act 2019, Lotteries Regulations 2021: bingo and raffles are for not-for-profit
 *        organisations only; a pub's members draw is a minor trade promotion lottery (prizes up to
 *        $5,000 including the jackpot, no "present to win", winners published for 7 days).
 *   NT   Gaming Control Act 1993, Community Gaming Regulations 2006: bingo and raffles are for
 *        approved associations; a pub's members draw is a minor trade lottery (up to $5,000, staff
 *        and their families cannot enter, winners named in a newspaper); no prize may be only
 *        alcohol; no prize to anyone under 18.
 *   Number bingo is HIDDEN for SA and NT pubs (numberBingoHidden below). MUSICAL BINGO IS NOT
 *   BINGO and none of this touches it, in any state.
 * It moves. Victoria has changes landing through 2027. Treat this as a prompt to check, never
 * as advice: the footer of every popup says exactly that.
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------------------
     Which of our formats is which kind of game.
     Musical bingo is its OWN kind, 'musical', with no state table. Dean, 19 Oct 2026, every
     state, Queensland included: "Musical bingo is not bingo, not the bingo rules". So no paper
     rule, permit, jackpot figure, bingo hard block or OLGR block reaches it; a paid musical
     night shows only that the venue conducts it (assess, below). A members draw is a draw, which nearly everywhere is
     a trade promotion when entry is free. Trivia is skill and never appears here.
     --------------------------------------------------------------------------- */
  function kindOf(format) {
    if (format === 'bingo90' || format === 'bingo') return 'bingo';
    if (format === 'musical' || format === 'musical_bingo') return 'musical';
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

     permit: 'required'       the state will not let this be charged for without a permit,
                              licence or authority, so the gate will not open a PAID game
                              until one is recorded on the account (vp_venues.permits)
             'unless_exempt'  a permit is needed above an exemption the letters describe;
                              the gate warns when none is recorded and lets the host decide
     holder: 'npo'            the permit belongs to the charity or non-profit the game is
                              run for, not the venue: recording their name and the date of
                              their written authorisation counts (see permitRecorded)
     ads:    one line on what an ad for the game must not do, where a letter gives one
     --------------------------------------------------------------------------- */
  var STATES = {

    NSW: {
      confirmed: true, name: 'New South Wales', regulator: 'NSW Fair Trading',
      /* Anisimoff, 1 Oct 2026, table p.9. The "$1,000 if tied to the gaming machines" line that
         used to sit in three places here is gone: the lawyer says it is not relevant to anything
         this platform runs. A members draw with a jackpot that rolls over week to week is a
         progressive lottery in NSW, which is where the $7,000 cash figure comes from. */
      free: { all: ['A free-entry game is a free lottery: anyone may run one, total prizes up to $30,000, and no cash prizes. Run as a trade promotion (free entry, promoting the venue) it needs an authority from NSW Fair Trading above $10,000 in prizes.'],
              members: ['A jackpot that rolls over from week to week is a progressive lottery: no authority up to $30,000 in total prizes, and cash prizes are capped at $7,000.'] },
      /* Permitted: Regulation s23(a), "appropriate computer-generated documents" (Anisimoff, 1 Oct 2026). */
      phones: { bingo: true },
      ads: 'An ad for this game must not encourage anyone to break the law, show children taking part, or suggest that winning is certain or that entering will improve anyone’s finances (Anisimoff, 1 Oct 2026, point 15).',
      for_profit: {
        bingo:  { paid: 'no', notes: [
          'Paid bingo in NSW is club bingo (registered clubs only, on club premises, $70 a game and no cash prizes) or charity housie (run to raise funds for a charity or non-profit). A hotel cannot run either in its own right.',
          'Social housie (a $40 prize pool a session, $200 jackpot) cannot be run on licensed premises, so it is not open to a pub or a club.',
          'Free entry is always open to you: a free lottery, up to $30,000 in prizes and no cash prizes.'] },
        raffle: { paid: 'cause', permit: 'required', holder: 'npo', notes: [
          'A pub may run a paid raffle FOR a charity or non-profit under their written authorisation. The charity holds the authority from NSW Fair Trading and you operate under it. Record their authority on the account page before you sell a ticket.',
          'How much of the gross goes to the charity (30 to 40%, depending on the kind of lottery) is between you and them.',
          'A draw lottery is up to $30,000 in total prizes, cash allowed. A promotional raffle to attract patrons is for club licences only, up to $5,000 and no cash prizes.'] },
        members:{ paid: 'no', notes: [
          'A members draw is free entry: a free lottery (up to $30,000 in prizes, no cash prizes) or a trade promotion (free entry, authority above $10,000).',
          'A jackpot that rolls over week to week is a progressive lottery: no authority up to $30,000 in total, and cash prizes are capped at $7,000.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'Club bingo: by or on the authority of a registered club, to attract patrons. A maximum of $70 a game, one bonus prize up to $70, and no cash prizes.',
          'Charity housie: to raise funds for a charity or non-profit. Total prizes up to $10,000 and no more than 75% of gross, 48 tickets a person. No authority needed for either.'] },
        raffle: { paid: 'yes', notes: [
          'A draw lottery: for non-profits, no authority needed, total prizes up to $30,000. A promotional raffle (club licence, to attract patrons) is up to $5,000 with no cash prizes.',
          'An art union (a prize pool of $30,000 or more) needs an authority from NSW Fair Trading.'] },
        members:{ paid: 'no', notes: [
          'Entry must be free: a free lottery (up to $30,000 in prizes, no cash prizes) or a trade promotion (free entry, authority above $10,000).',
          'A jackpot that rolls over week to week is a progressive lottery: no authority up to $30,000 in total, and cash prizes are capped at $7,000.'] }
      }
    },

    QLD: {
      confirmed: true, name: 'Queensland', regulator: 'OLGR',
      /* Anisimoff, 8 Oct 2026, table p.7 to p.8. Dean's settled decision is "leave QLD": the paid-entry
         block below stays until our number generator is approved. Only the words changed. */
      free: { all: ['In Queensland a free-entry game is a Category 4 promotional game: any business may run one, no licence, and no prize limit. Entry must be free apart from buying goods or services at their normal price.'] },
      /* Permitted: Schedule 2, to "give" a ticket "includes allot electronically" (Anisimoff, 8 Oct 2026). */
      phones: { bingo: true },
      /* Our number generator is not yet approved here, which blocks the DRAW itself
         regardless of what the venue is allowed to do. This is about us, not them. */
      blocked: 'Our number generator is still going through OLGR approval, so we cannot run paid bingo, raffles or members draws in Queensland yet. Trivia and musical bingo are unaffected.',
      for_profit: {
        bingo:  { paid: 'no', notes: [
          'Businesses cannot conduct bingo in Queensland. Bingo is for an association (four or more people with a common purpose) or for an individual who takes no personal gain and returns every cent as prizes.',
          'A for-profit venue may only run a Category 4 promotional game, which means free entry. No licence, no limit on the prize, but nobody may pay to enter.'] },
        raffle: { paid: 'no', notes: ['Category 4 promotional game only: free entry, no licence, open to any business. To sell tickets the raffle must be conducted by an eligible association, which holds any licence itself.'] },
        members:{ paid: 'no', notes: ['Free entry. Category 4 promotional game: no licence, no prize limit.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: [
          'Category 1 is up to $2,000 of ticket sales a session (any association); Category 2 is $2,000 to $20,000 (an eligible association). No licence for either. Prizes cannot exceed 75% of gross unless every cent goes back as prizes and the game is off licensed premises.',
          'A jackpot may only be paid from money set aside from earlier and current sessions. The first jackpot of a series may start at no more than $1,000 (Category 1) or $5,000 (Category 2).'] },
        raffle: { paid: 'yes', notes: [
          'Category 1 is up to $2,000 of ticket sales (an association); Category 2 is $2,000 to $50,000 (an eligible association). No licence for either, no more than $25,000 in cash prizes, and prizes worth at least 20% of gross.',
          'Category 3, above $50,000 of ticket sales, needs a licence and an incorporated eligible association.'] },
        members:{ paid: 'no', notes: ['Free entry keeps it a Category 4 promotional game with no licence and no prize limit.'] }
      }
    },

    VIC: {
      confirmed: true, name: 'Victoria', regulator: 'VGCCC',
      /* Anisimoff, 8 Oct 2026, table p.8 and point 1(a). Section 8.4.4 makes it an offence to supply
         bingo tickets or a number generator to anyone without a minor gaming permit, which is why
         paid bingo here is the one place the gate will not open without a permit on record. */
      free: { all: ['In Victoria a free-entry draw is a trade promotion: no permit.'],
              bingo: ['Free-entry bingo may be run by anyone with no permit (s8.2.4A), but it cannot be advertised or opened to the general public, any entry fee goes back in full as prizes, and it is for entertainment only, not for the venue’s commercial benefit.',
                      'No minors may take part in bingo in Victoria, free or paid, and players must be physically present.'],
              raffle: ['A free-entry raffle is a trade promotion: no permit, and entry is free apart from goods or services at their normal price.'],
              members: ['A members draw is a trade promotion: no permit, entry free.'] },
      phones: { bingo: false },
      paperBingo: 'Victoria does not allow a phone as a bingo ticket. Section 8.4.7B of the Gambling Regulation Act 2003 bars conducting bingo, or selling bingo tickets, through a website or online platform. A device at the venue is allowed, so the calling and the big screen run as normal: hand out paper tickets and mark them off. Trivia and musical bingo are unaffected.',
      ads: 'A gambling ad in Victoria must not encourage anyone to break the law, show children taking part, suggest winning is certain or that playing will improve anyone’s finances, or promote drinking while gambling (Anisimoff, 8 Oct 2026, point 10).',
      for_profit: {
        bingo:  { paid: 'no', notes: [
          'Paid bingo in Victoria is for non-profits only, with VGCCC approval and a minor gaming permit. A venue cannot charge for it in its own right.',
          'Free entry is open to you (s8.2.4A): no permit, any entry fee back in full as prizes, not advertised or open to the general public, entertainment only. No minors, and players must be present.'] },
        raffle: { paid: 'cause', permit: 'required', holder: 'npo', notes: [
          'A paid raffle is for non-profits only. The non-profit holds the VGCCC permit; a for-profit running it for them needs their written permission and a commercial organiser’s licence. Record their permission on the account page first.',
          'Ticket sales must be between two and six times the prize pool. No cash prizes (travel money up to 10% of the prize is the exception; store gift cards are fine, debit cards are not). No reverse draws.',
          'Above $23,060 in prizes the raffle needs a VGCCC permit and printed tickets. A small raffle (up to $500) uses a blank raffle book, and the day’s raffles together stay under $1,000.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free, no permit.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', permit: 'required', notes: [
          'You must be declared a community or charitable organisation by VGCCC, hold a minor gaming permit for bingo and have notified VGCCC that you will run it. Record the permit on the account page before you charge: Victoria bars anyone supplying bingo tickets or a number generator to an organisation without one (s8.4.4).',
          'Prizes must be at least 20% of entry fees, and over any seven days between 50% and 90%. Prizes of $20,000 or more need VGCCC notification. Cash prizes of $1,000 or more are paid by cheque or EFT.',
          'No minors, and players must be physically present. A jackpot may be carried from one game or session to a later one, but only one jackpot pool runs in a session.'] },
        raffle: { paid: 'yes', permit: 'unless_exempt', notes: [
          'Above $23,060 in prizes the raffle needs a VGCCC permit and printed tickets: record the permit on the account page. Below that, no permit.',
          'Ticket sales must be between two and six times the prize pool. No cash prizes (travel money up to 10% is the exception; store gift cards fine, debit cards not). No reverse draws.',
          'Small raffles (up to $500 each, $1,000 a day) use a blank raffle book.'] },
        members:{ paid: 'no', notes: ['Entry free as a trade promotion, no permit.'] }
      }
    },

    WA: {
      confirmed: true, name: 'Western Australia', regulator: 'the Gaming and Wagering Commission',
      free: { all: ['In Western Australia this is a trade promotion, and any electronic cost of entering is capped at 55c.'] },
      phones: { bingo: true },
      /* Anisimoff, 1 Oct 2026, point 4: the certification is the applicant's to provide, from a
         university or a reputable accounting firm, and we can lodge ours with the Commission once. */
      warn: 'A raffle drawn by our number generator needs independent certification that it picks at random, from a university or a reputable accounting firm, before the Commission grants the permit. The applicant provides it, and VenuePlay can lodge ours with the Commission (rgl@lgirs.wa.gov.au) once so that venues do not each have to. Ask us where that is up to before you apply.',
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
      free: { all: ['In South Australia a trade promotion with prizes up to $5,000 needs no licence. Above $5,000, check with Consumer and Business Services first.'] },
      /* By what the venue is (22 Oct 2026 research). A pub's members draw is a minor trade
         promotion lottery: reg 9(2) lets only the casino make a winner be present, so a pub's
         drawn member wins whether or not they are in the room (the members console enforces it,
         noPresentToWin below). A club's members-only free draw is a participation lottery, which
         may ask the winner to be present with at least 15 minutes to claim (Sch 6 r 4(a)). */
      freeBy: {
        for_profit: {
          members: ['A pub members draw in South Australia is a minor trade promotion lottery: total prizes, jackpot included, up to $5,000, and it runs for 12 months at most.',
                    'The winner cannot be required to be present: the member drawn wins whether or not they are in the room. Contact them, and publish the winners for 7 days.',
                    'The terms must give the draw date, time and place. Keep the records for 3 months.'],
          raffle:  ['Only a not-for-profit organisation may sell raffle tickets in South Australia. A free-entry draw is a trade promotion: prizes up to $5,000, no licence.']
        },
        non_profit: {
          members: ['A club draw open only to members, with free entry, is a participation lottery. You may ask the winner to be present, but give them at least 15 minutes to claim.']
        }
      },
      phones: { bingo: false },
      paperBingo: 'South Australia recognises only physical bingo sheets, bought from a licensed supplier. Players cannot use their phones as tickets here. Run the paper sheets and use our calling and our screen. Trivia and musical bingo are unaffected.',
      for_profit: {
        bingo:  { paid: 'no', notes: ['Bingo in South Australia is for not-for-profit organisations only, so a pub or hotel cannot run it.'] },
        raffle: { paid: 'no', notes: [
          'Only a not-for-profit organisation may run a raffle in South Australia, so a pub cannot sell raffle tickets.',
          'Free entry as a trade promotion allows prizes up to $5,000 with no licence.'] },
        members:{ paid: 'no', notes: ['Minor trade promotion lottery: entry free, total prizes including the jackpot up to $5,000, no licence. The winner cannot be required to be present.'] }
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
      confirmed: true, name: 'ACT', regulator: 'the Gambling and Racing Commission',
      /* Anisimoff, 8 Oct 2026, table p.9. A phone as a bingo ticket is "not specifically prohibited",
         so phones are back on here: they were off on the strength of the housie Model Rules, which
         the letter does not raise. Anyone may run housie or a raffle in ACT and charge for it. */
      free: { all: ['In ACT a trade promotion (free entry) is exempt up to $3,000 in prizes. Above that, check with the Gambling and Racing Commission first.'],
              bingo: ['Housie is exempt from a permit up to $1,000 in prizes a session. Record the winning ticket and make the results available to the people who entered.'],
              raffle: ['A raffle is exempt from a permit up to $2,500 in prizes.'] },
      phones: { bingo: true },
      ads: 'A housie ad in ACT must not encourage anyone to break a gaming law, show anyone under 25 gambling, encourage under-18s to gamble, suggest gambling is an investment, or show or promote drinking while gambling (Anisimoff, 8 Oct 2026, point 10).',
      for_profit: {
        bingo:  { paid: 'yes', permit: 'unless_exempt', notes: [
          'Anyone may run housie in ACT and charge for it. Exempt with no permit while the prize pool is $1,000 or less a session (or prizes are only rebates on goods or services, or it is members-only with no outside advertising).',
          'Above $1,000 a session you need a permit, and no minors or intoxicated people may play. Record the permit on the account page.',
          'Record the winning ticket and make the results available to the people who entered.'] },
        raffle: { paid: 'yes', permit: 'unless_exempt', notes: [
          'Anyone may run a raffle and charge. Exempt with no permit up to $2,500 in prizes. Above that a permit, and ticket sales no more than five times the prize pool (ten times at $10,000 or more).',
          'Clubs and other organisations with members may run a serial raffle (same prizes and ticket price each draw) for up to 12 months.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free, exempt up to $3,000 in prizes.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', permit: 'unless_exempt', notes: [
          'Exempt with no permit while the prize pool is $1,000 or less a session (or prizes are only rebates on goods or services, or it is members-only with no outside advertising).',
          'Above $1,000 a session you need a permit, and no minors or intoxicated people may play. Record the permit on the account page.',
          'Record the winning ticket and make the results available to the people who entered.'] },
        raffle: { paid: 'yes', permit: 'unless_exempt', notes: [
          'Exempt with no permit up to $2,500 in prizes. Above that a permit, and ticket sales no more than five times the prize pool (ten times at $10,000 or more).',
          'Organisations with members may run a serial raffle (same prizes and ticket price each draw) for up to 12 months.'] },
        members:{ paid: 'no', notes: ['Trade promotion: entry free, exempt up to $3,000 in prizes.'] }
      }
    },

    TAS: {
      confirmed: true, name: 'Tasmania', regulator: 'Liquor and Gaming Tasmania',
      /* Anisimoff, 8 Oct 2026, table p.9. Bingo and raffles can be run by anyone but only FOR a
         non-profit; exempt social bingo (one fee a session of $30 or less, no prize over $300) needs
         no permit and, technically, may use phone tickets. The phone page cannot tell which night
         this is, so it plays safe and the host is told why. */
      free: { bingo: ['Social bingo is exempt from a permit when it is mainly social, one entry fee a session of $30 or less is charged (or none), and no prize is over $300.'],
              raffle: ['A free draw in Tasmania still follows the raffle rules: no minors may take part, cash prizes are capped at $5,000, and a prize pool above $10,000 needs a minor gaming permit.'],
              members: ['A free draw in Tasmania still follows the raffle rules: no minors may take part, cash prizes are capped at $5,000, and a prize pool above $10,000 needs a minor gaming permit.'] },
      phones: { bingo: false },
      paperBingo: 'Tasmania does not allow a phone as a ticket for permit ("authorised") bingo: every card must carry a printed serial number. Exempt social bingo (mainly social, one entry fee of $30 or less a session, no prize over $300) is not caught by that rule, but the phone page cannot tell which night this is and plays safe. Run paper and use our calling and our screen. Trivia and musical bingo are unaffected.',
      for_profit: {
        bingo:  { paid: 'cause', permit: 'unless_exempt', notes: [
          'Anyone may run bingo in Tasmania, but only for a non-profit and with their authorisation. A minor gaming permit is needed unless the game is exempt: mainly social, one entry fee a session of $30 or less, and no prize over $300.',
          'All prizes must be cash and at least 50% of proceeds. At most two jackpot games a session: the first jackpot is $300 or less, it grows by no more than $50 a session, and at $2,000 it must be paid out in that session.',
          'Promotional games alongside bingo: no jackpot, prizes up to $1,000 a game and $2,000 a session. Records kept 7 years.'] },
        raffle: { paid: 'cause', permit: 'unless_exempt', notes: [
          'Anyone may run a raffle, but the proceeds go to a non-profit, with their authorisation. No permit up to $10,000 in prizes; above that a minor gaming permit. Cash and cash-equivalent prizes (prepaid cards) are capped at $5,000.',
          'No minors may take part. No reverse draws (first ticket out wins the smallest prize).'] },
        members:{ paid: 'no', notes: ['Entry free. No minors may take part, and cash prizes are capped at $5,000.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', permit: 'unless_exempt', notes: [
          'Exempt from a permit when mainly social, one entry fee a session of $30 or less, and no prize over $300. Otherwise a minor gaming permit, played only at the place and times on it.',
          'All prizes must be cash and at least 50% of proceeds. At most two jackpot games a session: the first jackpot is $300 or less, it grows by no more than $50 a session, and at $2,000 it must be paid out in that session.',
          'Promotional games alongside bingo: no jackpot, prizes up to $1,000 a game and $2,000 a session. Records kept 7 years.'] },
        raffle: { paid: 'yes', permit: 'unless_exempt', notes: [
          'No permit up to $10,000 in prizes for a non-profit; above that a minor gaming permit. Cash prizes are capped at $5,000. No minors may take part. No reverse draws.'] },
        members:{ paid: 'no', notes: ['Entry free. No minors may take part, and cash prizes are capped at $5,000.'] }
      }
    },

    NT: {
      confirmed: true, name: 'the Northern Territory', regulator: 'Licensing NT',
      /* The published permit condition on payments to organisations used to block every paid game
         here. Dean, 22 Oct 2026: ignore it (that part can be offered free; they pay for something
         else). So NT is no longer blocked, and a club is unlocked like anywhere else.
         Prize rules (Community Gaming Regulations reg 20): no prize that is only alcohol, or money
         with alcohol; no tobacco or weapons; no prize to anyone under 18 in a trade lottery. The
         raffle console refuses an alcohol-only prize here (liquorOnlyPrize below). */
      free: { all: ['In the Northern Territory this is a trade lottery: prizes up to $5,000 need no permit.',
                    'A prize cannot be only alcohol, or money and alcohol, and cannot be tobacco or a weapon. Nobody under 18 can win.'] },
      freeBy: {
        for_profit: {
          members: ['A pub members draw is a minor trade lottery: prizes up to $5,000, and everyone in it has an equal chance.',
                    'Your staff and their families cannot enter.',
                    'Publish the winners\u2019 names in a newspaper that circulates in the Territory, and keep the records for 2 years.']
        },
        non_profit: {
          members: ['A club attendance or membership lottery: the prize is capped at $10,000.']
        }
      },
      phones: { bingo: true },
      for_profit: {
        bingo:  { paid: 'no', notes: ['Bingo in the Northern Territory is for approved associations only, so a pub or hotel cannot run it.'] },
        raffle: { paid: 'no', notes: ['Raffles are for approved associations. A pub may run a free-entry trade lottery: prizes up to $5,000 need no permit.'] },
        members:{ paid: 'no', notes: ['Minor trade lottery: entry free, prizes up to $5,000. Staff and their families cannot enter, and the winners are named in a newspaper.'] }
      },
      non_profit: {
        bingo:  { paid: 'yes', notes: ['Approved non-profit associations only. Prizes must be worth at least a third of the ticket value. Nobody under 18 can win.'] },
        raffle: { paid: 'yes', notes: [
          'Approved non-profit associations only.',
          'Up to $5,000 needs no permit. $5,001 to $20,000 needs a permit. Above that, a major lottery permit.',
          'Prizes must be worth at least a third of the ticket value. No prize may be only alcohol.'] },
        members:{ paid: 'no', notes: ['Entry free. A club attendance or membership lottery prize is capped at $10,000.'] }
      }
    }
  };

  /* ---------------------------------------------------------------------------
     assess(): everything the popup needs, in one call.

     opts: { state, entityType, format, paidEntry, paidEntryEnabled, venueName, permits }
     Returns:
       { applies, confirmed, ok, blocked, headline, points[], warnings[], paper, state,
         hardBlock, permit, permitRecorded }
     ok=false means "do not go ahead as described". hardBlock=true means the popup will not
     offer to start a PAID game at all: only "Start as a free-entry game" (Dean, 15 Oct 2026,
     on the lawyer's "prudent, not mandatory"). The free path is never blocked by anything here.
     --------------------------------------------------------------------------- */
  /* WHY PAID ENTRY IS OFF, in words that are true for THIS venue (state audit, 20 Oct 2026, C7).
     It used to tell every venue "we turn paid entry on once we know club or pub, email us", which
     was false for a pub (the Worker never unlocks a for-profit venue) and for Queensland and the
     Northern Territory (blocked whatever the venue is). Mirrors the billing Worker's
     vpaPaidEntryDefault and /admin/venue-gaming. */
  function paidOffWhy(opts) {
    var st = STATES[String(opts.state || '').toUpperCase()];
    if (st && st.blocked) return 'Paid entry is not available in ' + st.name + ' yet, for any venue. Free entry is open to you every night.';
    if (opts.entityType === 'for_profit') return 'Paid entry is for clubs and other non-profits. A pub runs games as free entry.';
    if (opts.entityType !== 'non_profit') return 'We have not recorded whether this venue is a club or a pub yet. Until we have, games run as free entry.';
    return 'Paid entry has not been switched on for this venue yet. Until it is, games run as free entry.';
  }

  function assess(opts) {
    opts = opts || {};
    var out = { applies: true, confirmed: false, ok: true, blocked: null, paper: false,
                headline: '', points: [], warnings: [], state: opts.state || null,
                hardBlock: false, permit: null, permitRecorded: false };

    var kind = kindOf(opts.format);
    if (!kind) {
      out.applies = false;
      out.headline = 'Trivia is a game of skill, so the gaming rules do not apply.';
      out.points.push('Competition rules still apply. Those sit with Fair Trading and the ACCC, not the gaming regulator.');
      return out;
    }

    /* MUSICAL BINGO (Dean, 19 Oct 2026): not bingo in any state. Nothing from the state table
       applies. A free night is a promotional game; a paid night still needs this venue unlocked
       to charge (that is ours, not a bingo rule), and then only says who conducts it. */
    if (kind === 'musical') {
      out.confirmed = !!(STATES[opts.state] && STATES[opts.state].confirmed);
      if (!opts.paidEntry) {
        out.headline = 'Free entry. Nobody pays to play musical bingo tonight.';
        out.points.push('Musical bingo is a music quiz on a grid, not bingo, so no bingo rules apply.');
        return out;
      }
      if (opts.paidEntryEnabled === false) {
        out.ok = false; out.hardBlock = true;
        out.headline = 'Paid entry is switched off for this venue.';
        out.warnings.push(paidOffWhy(opts));
        out.points.push('A free-entry game is open to you right now: the button below starts tonight as free entry.');
        return out;
      }
      out.headline = 'Musical bingo is a music quiz on a grid, not bingo, so no state bingo rules apply.';
      out.points.push('Your venue conducts tonight\u2019s game and is responsible for it, including what you charge and the prizes you give.');
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
    /* NOT FOR MUSICAL BINGO. Dean, 21 Sep 2026: "musical bingo don't count that as bingo in
       other states it's fine." The paper rules in SA, Victoria and Tasmania are written around
       housie: numbered sheets and printed cards. Musical bingo is a music quiz on a grid, and its
       tickets stay on the phone. His call as the owner; Queensland is a separate matter.
       Asked again when the Victorian letter arrived (its table heading reads "Housie / Bingo
       (incl. Musical)"), Dean, 15 Oct 2026: "musical bingo cards stay in every state. Its not
       bingo." So this line is the same in Victoria as everywhere else. */
    if (kind === 'bingo' && st.phones && st.phones.bingo === false) {   // musical is its own kind (kindOf), so never here
      out.paper = true;
      out.warnings.push(st.paperBingo);
    }

    /* A state-wide warning, shown to everybody. This used to sit much further down, inside
       the branch that only runs when a venue may charge, so it never reached a for-profit
       pub in any configuration. That silently hid the two that matter most: Victoria's
       "bingo must not be conducted online", and WA's independent certification. Placed here
       with the paper warning, before the early returns, so everybody sees it. */
    /* WA's warning is about a RAFFLE's number generator (Anisimoff, 1 Oct 2026, point 4), so
       it goes on raffles only (state audit, 20 Oct 2026: it was on bingo and members draws too). */
    if (st.warn && kind === 'raffle') out.warnings.push(st.warn);

    /* What an ad for the game must not do, where a letter says (NSW, VIC, ACT). On both paths:
       the rules are about advertising gambling, and a free game is advertised just the same. */
    if (st.ads) out.warnings.push(st.ads);

    /* Something stopping the whole format in this state, regardless of the venue. This is about
       PAID gaming approval, so it must not appear on the free-entry path: free entry is a
       promotional game and lawful everywhere, as this function says two branches down. Showing a
       Queensland venue a red "we cannot run bingo here" box before a free game made the product
       look unlawful in the state the regulator's letter came from, and it was the default for
       every venue, because paid entry ships switched off. */
    /* Never musical bingo: it returned above with no state rules (Dean, 19 Oct 2026, Queensland
       included: it is out of the OLGR submission, so the wait on OLGR does not stop it). */
    if (st.blocked && opts.paidEntry) { out.blocked = st.blocked; out.ok = false; }

    var entity = (opts.entityType === 'non_profit') ? 'non_profit' : 'for_profit';
    var rule = (st[entity] || {})[kind] || { paid: 'no', notes: [] };

    /* Free entry is the safe path everywhere, so handle it first and briefly.

       BUT NOT WITH TWO SENTENCES THAT ARE TRUE NOWHERE IN PARTICULAR. This said a free game
       "needs no licence anywhere" and "there is no limit on what you put up as a prize", to
       every venue in every state, while this same file knew that NSW wants an authority over
       $10,000, South Australia stops at $5,000 and ACT at $3,000. Those facts sat in notes that
       are only read on the PAID branch, below this early return, so the path every venue is
       actually on never showed them. A members draw carries a jackpot that grows every week,
       and the host's "I understand" is recorded against that headline. It broke the rule at the
       top of this file: where something is not confirmed we say so. Found by audit, 20 Sep 2026.

       So: what is true everywhere, then what THIS state says about a free game, and where we
       hold nothing for the state, exactly that. */
    if (!opts.paidEntry) {
      out.headline = 'Free entry. Nobody pays to play, so this is a promotional game, not a paid one.';
      out.points.push('Nobody may pay to enter, buy a ticket or buy a book, and entry cannot depend on a purchase.');
      var free = ((st.free && st.free.all) || []).concat((st.free && st.free[kind]) || [])
                 .concat((st.freeBy && st.freeBy[entity] && st.freeBy[entity][kind]) || []);
      if (free.length) {
        for (var fi = 0; fi < free.length; fi++) out.points.push(free[fi]);
      } else {
        out.points.push('We have not confirmed a prize threshold for free-entry games in ' + st.name + '. Before a large prize, check with ' + st.regulator + '.');
      }
      if (rule.paid === 'yes') {
        out.points.push('In ' + st.name + ' you could charge for entry if you wanted to. Ask us to turn paid entry on for this venue.');
      }
      return out;
    }

    // Paid entry, but we have not switched it on for this venue.
    /* A HARD BLOCK TOO (live audit, 16 Oct 2026). This set ok:false and nothing else, so the popup
       still said "I understand, start the game" and the console went ahead in its PAID mode at a
       venue we have not unlocked to charge. Same rule as the two blocks below: the popup offers a
       free-entry game and tells the console { free: true }. The free path is never blocked. */
    if (opts.paidEntryEnabled === false) {
      out.ok = false; out.hardBlock = true;
      out.headline = 'Paid entry is switched off for this venue.';
      out.warnings.push(paidOffWhy(opts));
      out.points.push('A free-entry game is open to you right now: the button below starts tonight as free entry, and the rules for a free game are what is recorded.');
      return out;
    }

    var who = entity === 'non_profit' ? 'a non-profit' : 'a for-profit venue';
    var game = formatName(opts.format).toLowerCase();

    /* THE HARD BLOCK (Dean, 15 Oct 2026). Where the state says this venue may not charge, the
       popup no longer offers to start a paid game: it offers a free-entry one. The same when the
       state will not let the game be charged for without a permit and none is on record. The
       free path is lawful everywhere and is never touched by any of this. */
    if (rule.paid === 'no') {
      out.ok = false; out.hardBlock = true;
      out.headline = 'In ' + st.name + ', ' + who + ' cannot charge for entry to ' + game + '.';
      out.points = rule.notes.slice();
      out.warnings.push('This game can only start as free entry here. Check with ' + st.regulator + ' before you sell a ticket.');
      return out;
    }

    /* Permits, licences and authorities. The venue records them on the account page (Settings,
       Permits and authorities); the gate reads them back here. permitRecorded is the one rule
       for "is there one", shared with the settings page and HQ. */
    out.permit = rule.permit || null;
    out.permitRecorded = permitRecorded({ permits: opts.permits }, kind);
    var permitWhat = rule.holder === 'npo' ? 'the organisation’s authority' : 'your permit';
    var permitName = kind === 'members' ? 'members draw' : kind;
    if (rule.permit === 'required' && !out.permitRecorded) {
      out.ok = false; out.hardBlock = true;
      out.headline = 'Before you charge for ' + game + ' in ' + st.name + ', record ' + permitWhat + ' on the account page.';
      out.points = rule.notes.slice();
      out.warnings.push('No permit or authority is recorded for ' + permitName + ' at this venue. ' +
                        (rule.holder === 'npo'
                          ? 'Add the organisation you are running it for and the date of their written authorisation under Settings, Permits and authorities, '
                          : 'Add it under Settings, Permits and authorities, ') +
                        'or run tonight as free entry.');
      return out;
    }
    if (rule.permit === 'unless_exempt' && !out.permitRecorded) {
      out.warnings.push('No permit is recorded for ' + permitName + ' at this venue. That is fine while the game stays inside the exemption above; beyond it, record the permit under Settings, Permits and authorities first.');
    }
    if (out.permitRecorded) {
      var pr = permitSummary(opts.permits, kind);
      if (pr) out.points.push(pr);
      var exp = permitExpired(opts.permits, kind);
      if (exp) out.warnings.push('The ' + permitName + ' permit recorded for this venue expired on ' + exp + '. Renew it and update the account page.');
    }

    if (rule.paid === 'cause') {
      out.headline = 'You can charge, but the game has to be run for a cause, not for the venue.';
      out.points = rule.notes.concat(out.points);
      out.warnings.push('Get the benefiting organisation’s authorisation in writing before you sell a ticket, and keep it.');
      return out;
    }

    out.headline = 'You can charge for entry to this game in ' + st.name + '.';
    out.points = rule.notes.concat(out.points);
    return out;
  }

  /* ---------------------------------------------------------------------------
     PERMITS ON RECORD. vp_venues.permits (migration 100) is keyed by game kind:
       { bingo: { number, holder: 'venue'|'npo', npo_name, authorised_on, expires, note },
         raffle: {...}, members: {...} }
     A kind counts as RECORDED when it has a permit number, OR the holder is the charity or
     non-profit the game is run for and their name and the date of their written authorisation
     are both there. That is the whole rule, shared with the settings page and HQ; nothing here
     verifies a number with a regulator (the lawyer calls that prudent, not mandatory, and the
     venue warrants it in the Terms). Never throws: a bad shape is simply "not recorded".
     --------------------------------------------------------------------------- */
  function permitOf(permits, kind) {
    var p = permits;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return null; } }
    var k = p && typeof p === 'object' ? p[kind] : null;
    return (k && typeof k === 'object') ? k : null;
  }
  function permitRecorded(venue, kind) {
    try {
      var k = permitOf(venue && venue.permits, kind);
      if (!k) return false;
      if (String(k.number || '').trim()) return true;
      return k.holder === 'npo' && !!String(k.npo_name || '').trim() &&
             /^\d{4}-\d{2}-\d{2}$/.test(String(k.authorised_on || ''));
    } catch (e) { return false; }
  }
  function permitSummary(permits, kind) {
    var k = permitOf(permits, kind);
    if (!k) return '';
    var who = String(k.npo_name || '').trim(), num = String(k.number || '').trim();
    var s = 'On record: ' + (num ? ('permit or authority ' + num) : 'written authorisation');
    if (who) s += ' held by ' + who;
    if (k.authorised_on) s += ', from ' + k.authorised_on;
    if (k.expires) s += ', expires ' + k.expires;
    return s + '.';
  }
  function permitExpired(permits, kind) {
    var k = permitOf(permits, kind);
    if (!k || !k.expires || !/^\d{4}-\d{2}-\d{2}$/.test(String(k.expires))) return '';
    var d = new Date();
    var today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return String(k.expires) < today ? String(k.expires) : '';
  }

  /* ---------------------------------------------------------------------------
     THE JACKPOT FIGURE for a state, from the letters' tables. The members and raffle consoles
     show it beside the "Maximum jackpot" field and warn when a jackpot passes it; they do not
     enforce it, the venue's own cap does (Anisimoff, 1 Oct 2026, point 10: the jackpot must not
     exceed the threshold for that type of activity, and the venue should set the figure first).
       jackpotLimit({ state, entityType, format, paidEntry }) -> { cents: number|null, why }
     null means no figure is confirmed for that case, and why says so. WA has no figure yet.
     --------------------------------------------------------------------------- */
  /* "the Victorian figure", as a whole phrase, so no console ever composes "the ACT" (house rule:
     write ACT, never "the ACT"). */
  var FIGURE_PHRASE = { NSW: 'the New South Wales figure', QLD: 'the Queensland figure', VIC: 'the Victorian figure',
                        ACT: 'the figure for ACT', TAS: 'the Tasmanian figure', SA: 'the South Australian figure',
                        NT: 'the Northern Territory figure', WA: 'the Western Australian figure' };
  function jackpotLimit(opts) {
    opts = opts || {};
    var kind = kindOf(opts.format), state = String(opts.state || '').toUpperCase();
    var np = opts.entityType === 'non_profit', paid = !!opts.paidEntry;
    if (!kind) return { cents: null, why: 'Trivia is a game of skill: no prize limit applies.' };
    if (kind === 'musical') return { cents: null, why: 'Musical bingo is not bingo: no bingo prize limit applies.' };
    var st = STATES[state];
    if (!st) return { cents: null, why: state ? ('We have not confirmed a prize figure for ' + state + ' yet.') : 'We do not know which state this venue is in yet.' };
    var T = {
      NSW: {
        members: [700000, 'NSW progressive lottery (a jackpot that rolls over week to week): cash prizes up to $7,000, no authority up to $30,000 in total'],
        raffle: paid ? [3000000, 'NSW draw lottery: $30,000 in total prizes'] : [3000000, 'NSW free lottery: $30,000, and no cash prizes'],
        bingo: (paid && np) ? [1000000, 'NSW charity housie: $10,000 in total prizes (club bingo: $70 a game, no cash prizes)'] : [3000000, 'NSW free lottery: $30,000, and no cash prizes']
      },
      QLD: {
        members: [null, 'Queensland Category 4 promotional game: no prize limit'],
        raffle: paid ? [2500000, 'Queensland Category 1 and 2 raffles: no more than $25,000 in cash prizes'] : [null, 'Queensland Category 4 promotional game: no prize limit'],
        bingo: paid ? [100000, 'Queensland bingo: the first jackpot may start at no more than $1,000 (Category 1) or $5,000 (Category 2); after that only money set aside from earlier and current sessions'] : [null, 'Queensland Category 4 promotional game: no prize limit']
      },
      VIC: {
        members: [null, 'Victoria trade promotion: no prize figure confirmed'],
        /* cents:0, not $23,060 (live audit, 16 Oct 2026): the letter's table says a Victorian raffle
           has NO cash prizes (travel is the one exception, and at most 10% of the prize value), so
           ANY cash jackpot is above the figure. $23,060 is the permit line for the prize pool as a
           whole, which the why still says. */
        raffle: paid ? [0, 'Victoria raffle: no cash prizes at all (the one exception is travel, up to 10% of the prize value); a prize pool above $23,060 needs a VGCCC permit and printed tickets'] : [null, 'Victoria trade promotion: no prize figure confirmed'],
        bingo: paid ? [2000000, 'Victoria bingo: prizes of $20,000 or more need VGCCC notification; cash of $1,000 or more by cheque or EFT'] : [null, 'Victoria free-entry bingo: every entry fee back as prizes, no figure beyond that']
      },
      ACT: {
        members: [300000, 'ACT trade promotion: $3,000'],
        raffle: [250000, 'ACT raffle: $2,500 without a permit'],
        bingo: [100000, 'ACT housie: $1,000 a session without a permit']
      },
      TAS: {
        members: [500000, 'Tasmania: cash prizes capped at $5,000; a prize pool above $10,000 needs a minor gaming permit'],
        raffle: [500000, 'Tasmania: cash prizes capped at $5,000; a prize pool above $10,000 needs a minor gaming permit'],
        bingo: [200000, 'Tasmania jackpot bingo: the first jackpot is $300 or less, grows by no more than $50 a session, and is paid out at $2,000']
      },
      SA: {
        members: np ? [500000, 'South Australia trade promotion: $5,000 without a licence'] : [500000, 'South Australia minor trade promotion lottery: $5,000 in total prizes, jackpot included'],
        raffle: paid ? [500000, 'South Australia minor lottery: $5,000 without a licence'] : [500000, 'South Australia trade promotion: $5,000 without a licence'],
        bingo: [null, 'South Australia: no prize figure confirmed for bingo (the licence turns on gross takings a session)']
      },
      NT: {
        members: np ? [1000000, 'Northern Territory club attendance or membership lottery: $10,000'] : [500000, 'Northern Territory minor trade lottery: $5,000'],
        raffle: [500000, 'Northern Territory: $5,000 without a permit'],
        bingo: [500000, 'Northern Territory: $5,000 without a permit']
      },
      WA: {
        members: [null, 'Western Australia: no prize figure confirmed yet'],
        raffle: [null, 'Western Australia: no prize figure confirmed yet'],
        bingo: [null, 'Western Australia: no prize figure confirmed yet']
      }
    };
    var row = (T[state] || {})[kind];
    if (!row) return { cents: null, why: 'We have not confirmed a prize figure for ' + st.name + '.' };
    /* where: "the Victorian figure", so a console can compose a plain sentence around the figure
       and put the why after it as its own sentence (16 Oct 2026). The raffle console used to
       splice the why INTO "is above <why> of $23,060". */
    return { cents: row[0], why: row[1], where: FIGURE_PHRASE[state] || ('the ' + st.name + ' figure') };
  }

  function money(cents) {
    var n = (Number(cents) || 0) / 100;
    return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: (n % 1 ? 2 : 0), maximumFractionDigits: 2 });
  }

  /* The words the venue ticks. Deliberately says who does what, because the regulator's
     letter read as though WE supply the prizes and take the money. */
  /* "and with every law that applies": Anisimoff, 1 Oct 2026, point 5, recommends the
     acknowledgement extend to complying with all applicable laws, not just the category. */
  function declaration(venueName) {
    return 'I confirm that ' + (venueName || 'this venue') + ' is the conductor of this game. ' +
           'We provide the prize, we handle any ticket sales and we keep the proceeds. ' +
           'VenuePlay supplies the software only. We are responsible for meeting the rules ' +
           'for our category, including any licence, and with every law that applies to this ' +
           'game, including permits, attendance and age rules.';
  }

  /* ===========================================================================
     THE POPUP.

     gate(opts, onProceed) shows the venue their own state's rules for the game they
     are about to start, and waits for them to press OK.

     Two things it deliberately does NOT do:
       * It never blocks the GAME. When the state says this venue cannot charge, or will not
         let it charge without a permit that is not on record, the popup no longer offers to
         start a paid game (Dean, 15 Oct 2026): it offers "Start as a free-entry game", and
         onProceed is called with { free: true } so the console switches its paid mode off
         first. A free game is lawful everywhere, so a host mid-shift with a room full of
         people always has a way on. It informs and records.
       * It does not fire before every single game. Once a night, per format, per venue.
         A popup on game 7 of a bingo night gets clicked through without being read,
         which is worse for everyone than showing it once when the night starts.

     opts: { format, venue:{id,name,au_state,entity_type,paid_entry_enabled,permits}, paidEntry, force }
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

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  /* Mirrors the localStorage flag in memory, so a kiosk tablet that clears storage, or a private
     window, still only sees this once. Without it a raffle with eight prizes showed eight modals,
     which is precisely the click-through-without-reading the once-a-night rule exists to avoid. */
  var _ackMem = {};
  function ackKey(venueId, format) {
    var d = new Date();
    var day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return 'vpGamingAck:' + (venueId || 'x') + ':' + format + ':' + day;
  }
  function alreadyAcked(venueId, format) {
    var k = ackKey(venueId, format);
    if (_ackMem[k]) return true;
    try { return !!localStorage.getItem(k); } catch (e) { return false; }
  }
  function markAcked(venueId, format) {
    var k = ackKey(venueId, format);
    _ackMem[k] = 1;
    try { localStorage.setItem(k, String(Date.now())); } catch (e) {}
  }

  /* Keep the record server-side too, because a localStorage flag proves nothing to anybody.
     Best-effort in the strongest sense: a failed write must never stop a night. */
  /* shown: did a person actually see the rules and press the button? The table's own note calls
     declared_by "whoever ticked it", and the Terms said we "record that you have seen it", but a
     free bingo game writes this row with nobody having seen or pressed anything. The row was
     true about the state, the format and free entry, and false about the one thing it exists to
     evidence. Found by audit, 20 Sep 2026. There is no column for it, so the record says so in
     words, at the front of the text a regulator would read. */
  var NOT_SHOWN = 'RECORDED AUTOMATICALLY, NOT SHOWN TO THE HOST (free entry game). ';
  function record(venue, format, a, paidEntry, shown) {
    try {
      if (!root.VP || !VP.gameApiPost) return null;
      return VP.gameApiPost('/host/gaming/declare', {
        venue_id: venue.id, format: format,
        entity_type: venue.entity_type || null,
        state: venue.au_state || null,
        paid_entry: !!paidEntry,
        category_claimed: ((shown === false ? NOT_SHOWN : '') + (a.headline || '')).slice(0, 300) || null
      });
    } catch (e) { return null; }
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
      venueName: venue.name, permits: venue.permits
    });

    // One at a time. Two taps on Start used to stack two identical overlays, and because the
    // bingo button flips to "start calling numbers" as soon as the lobby opens, OK-then-OK
    // opened the lobby and immediately started calling, so nobody got to scan the QR.
    if (document.querySelector('.vpg-wrap')) return;
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
          '<button type="button" class="vpg-go">' + (a.hardBlock ? 'Start as a free-entry game' : 'I understand, start the game') + '</button>' +
          '<button type="button" class="vpg-no">Not now</button>' +
        '</div>' +
        '<p class="vpg-fine">This is a prompt to check, not legal advice, and the rules change. ' +
        'You are the one running the game. Shown once a night for each game type.</p>' +
      '</div>';

    function close() { try { wrap.remove(); } catch (e) {} document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') { close(); } }

    wrap.querySelector('.vpg-go').addEventListener('click', function () {
      markAcked(venue.id, format);
      /* THE FREE WAY ON. A hard block means the host pressed "Start as a free-entry game", so
         what is recorded is the FREE assessment, as a declaration the host saw and accepted
         (not the automatic kind: the Worker refuses a draw whose only record is automatic),
         and the console is told { free: true } so it switches its paid mode off before it
         starts. If the free assessment itself throws, the game still goes, as free. */
      var arg;
      var recA = a, recPaid = !!opts.paidEntry;
      if (a.hardBlock) {
        arg = { free: true };
        recPaid = false;
        try {
          recA = assess({ state: venue.au_state, entityType: venue.entity_type, format: format,
                          paidEntry: false, paidEntryEnabled: venue.paid_entry_enabled !== false,
                          venueName: venue.name, permits: venue.permits }) || a;
        } catch (e) { recA = a; }
      }
      var rec = record(venue, format, recA, recPaid);
      close();
      /* waitRecord: the raffle and members draw are refused by the Worker until this row exists
         (14 Oct 2026), so the draw waits for it to land, four seconds at most. Everything else
         goes straight on, as it always has: a record must never hold up a game. */
      if (!opts.waitRecord || !rec || !rec.then) { proceed(arg); return; }
      var gone = false;
      function go() { if (gone) return; gone = true; proceed(arg); }
      rec.then(go, go);
      setTimeout(go, 4000);
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
  function gateFor(format, onProceed, opts) {
    var proceed = typeof onProceed === 'function' ? onProceed : function () {};
    opts = opts || {};
    try {
      if (!isGaming(format)) { proceed(); return; }
      var ctx = (root.VP && VP.getContext && VP.getContext()) || null;
      var venue = ctx && ctx.venue;
      if (!venue) { proceed(); return; }

      /* onlyIfPaid: skip the popup entirely while this venue is free-entry only.
         Musical bingo uses this. A free game is a promotional game and lawful in every
         state whatever the prize is worth, so the prompt would be friction with nothing
         behind it. The moment a venue is unlocked to charge, it is bingo like any other
         and the popup comes back on its own: regulators draw the line at whether people
         pay to play, never at how big the prize is. */
      if (opts.onlyIfPaid && venue.paid_entry_enabled !== true) { proceed(); return; }

      /* gameIsPaid:false - THIS game is free, whatever the venue is allowed to do.
         onlyIfPaid above asks "may this venue charge at all", which is a venue-level switch, so a
         venue that CAN charge saw the full charging rules even on a night it was giving the game
         away. Every line in that popup is about taking money: the entry cap, the proceeds split,
         the licence. None of it applies to a free game, which is a promotional game and lawful in
         every state whatever the prize is worth. Asking anyway trains hosts to tap through the
         one screen we need them to actually read on the nights it matters.
         The trade-off, deliberately: no gaming declaration is recorded for a free game. If that
         record is wanted for every game, record it silently rather than by making the host
         dismiss rules that do not apply to them. */
      if (opts.gameIsPaid === false) {
        /* Skipping the SCREEN, not the RECORD. The declaration is the part that is worth keeping:
           who conducted the game, in which state, under which category, and that entry was free.
           Writing it silently keeps that record for every game while sparing the host a wall of
           charging rules that do not apply to them. Best-effort in the same way the tapped one is:
           a failed write never stops a night, and nothing here can throw into the caller. */
        try {
          record(venue, format, assess({
            state: venue.au_state, entityType: venue.entity_type, format: format,
            paidEntry: false, paidEntryEnabled: venue.paid_entry_enabled !== false,
            venueName: venue.name
          }) || {}, false, false);
        } catch (e) {}
        proceed(); return;
      }

      /* force: the Worker refused a draw because it holds no acceptance for tonight (the record
         was lost, or this browser's note says yes and the server's says no). Show the rules again,
         whatever this browser remembers, and keep the new acceptance. */
      if (!opts.force && alreadyAcked(venue.id, format)) { proceed(); return; }
      /* paidEntry MUST be whether THIS game charges, not whether the venue is unlocked to
         charge at all. It used to pass the venue-level flag, which ships false. So a venue
         selling tickets tonight was shown "Free entry, nobody pays to play", and
         handleGamingDeclare then wrote paid_entry:false into vp_gaming_declarations. The
         record we would hand a regulator said free entry on a night that took money. */
      /* freeEntry: THIS game is free and the host should still SEE the rules once a night (unlike
         gameIsPaid:false, which records silently). The members draw is always free entry, so the
         hard block above can never fire for it, and a raffle or musical night that chose "Start as
         a free-entry game" passes it from then on. The Worker refuses a draw whose only record
         tonight is the silent kind, which is why this is not the silent path. */
      var thisGameIsPaid = opts.freeEntry ? false
        : (opts.gameIsPaid != null) ? !!opts.gameIsPaid
        : (venue.paid_entry_enabled === true);
      gate({ format: format, venue: venue, paidEntry: thisGameIsPaid, force: !!opts.force, waitRecord: !!opts.waitRecord }, proceed);
    } catch (e) { proceed(); }
  }

  /* ===========================================================================
     NUMBER BINGO FOR SA AND NT PUBS (Dean, 22 Oct 2026; migration 116).

     In South Australia bingo is for not-for-profit organisations only (Lotteries Regulations 2021
     reg 3 and 5); in the Northern Territory, approved associations only (Gaming Control Act s 47(b),
     s 52; Community Gaming Regulations reg 4). A pub or hotel in either place cannot run it, so the
     90-ball bingo tile and its routes are HIDDEN for them: not greyed out, gone (Dean: staff would
     think a dead tile was broken). HQ can switch it back on for one venue that shows its bingo is
     run by a not-for-profit (vp_venues.number_bingo_on, HQ only, audited).

     A venue not recorded as a club (entity_type null or for_profit) counts as a pub here: a club
     whose type is not recorded yet has it hidden until HQ records it, which is the safe way round.

     MUSICAL BINGO IS NOT BINGO. Nothing here reads or touches musical bingo, trivia, raffles or
     members draws, in any state.

     THE SAME RULE LIVES IN THREE MORE PLACES, because a Worker cannot load this file:
       venueplay-game.js       numberBingoHiddenFor()   refuses the draw and the bingo session
       venueplay-api-FULL.js   vpaNoNumberBingo()       picks the welcome email variant
       index.html (signup)     vpNoBingoAt()            shows the note under the postcode
     tools/test-sant-bingo.js runs all four over the same table of venues and fails if any differs.
     =========================================================================== */
  var NO_PUB_BINGO_STATES = { SA: 'South Australia', NT: 'the Northern Territory' };
  function numberBingoHidden(venue) {
    if (!venue) return false;
    var st = String(venue.au_state || '').toUpperCase();
    if (!NO_PUB_BINGO_STATES[st]) return false;
    if (venue.entity_type === 'non_profit') return false;
    return venue.number_bingo_on !== true;
  }

  /* AU postcode to state. The same map as vpaStateFromPostcode in the billing Worker (the suite
     compares the two over every postcode from 0000 to 9999), for pages that only hold a postcode:
     HQ's Add venue form, before a venue row exists. */
  function stateFromPostcode(pc) {
    var t = String(pc == null ? '' : pc).replace(/\D/g, '');
    if (!t) return null;
    var n = parseInt(t, 10);
    if (!(n >= 0)) return null;
    if ((n >= 200 && n <= 299) || (n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT';
    if ((n >= 1000 && n <= 2599) || (n >= 2619 && n <= 2899) || (n >= 2921 && n <= 2999)) return 'NSW';
    if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8999)) return 'VIC';
    if ((n >= 4000 && n <= 4999) || (n >= 9000 && n <= 9999)) return 'QLD';
    if (n >= 5000 && n <= 5999) return 'SA';
    if (n >= 6000 && n <= 6797) return 'WA';
    if (n >= 7000 && n <= 7799) return 'TAS';
    if (n >= 800 && n <= 999) return 'NT';
    return null;
  }

  /* MEMBERS DRAW: may the winner be required to be present? Not at an SA pub: a members draw there
     is a minor trade promotion lottery and reg 9(2) lets only the casino ask for "present to win".
     The members console then has no "not here, jackpot to next week" button and the game Worker
     refuses a rollover. A club, and every other state, is unchanged. */
  function noPresentToWin(venue) {
    if (!venue) return false;
    return String(venue.au_state || '').toUpperCase() === 'SA' && venue.entity_type !== 'non_profit';
  }
  /* The shortest claim window, in seconds, a members draw may have: 15 minutes for an SA club's
     participation lottery (Sch 6 r 4(a)); 30 seconds (the console's own floor) everywhere else. */
  function minClaimSeconds(venue) {
    if (venue && String(venue.au_state || '').toUpperCase() === 'SA' && venue.entity_type === 'non_profit') return 900;
    return 30;
  }
  /* What the host is reminded to do after a members draw is won, where the state asks for it.
     '' everywhere else. */
  function afterWinReminder(venue) {
    if (!venue) return '';
    var st = String(venue.au_state || '').toUpperCase();
    if (venue.entity_type === 'non_profit') return '';
    if (st === 'SA') return 'South Australia: publish the winner for 7 days (on your screen and a noticeboard is fine), and contact them if they were not here. The prize is theirs either way.';
    if (st === 'NT') return 'Northern Territory: publish the winner\u2019s name in a newspaper that circulates in the Territory, and keep the record for 2 years.';
    return '';
  }

  /* NT: no prize may be only alcohol, or money and alcohol (Community Gaming Regulations reg 20).
     True when, after taking out the alcohol words, the amounts and the joining words, nothing is
     left but money. "Slab of XXXX", "$50 and a bottle of wine" -> true. "Meat tray and a bottle of
     wine", "Dinner voucher" -> false. A prompt, not a parser: the host can reword the prize. */
  var LIQUOR_WORDS = /\b(beers?|wines?|slabs?|cartons?|bottles?|spirits?|vodka|rum|bourbon|whiske?y|scotch|gin|tequila|champagne|prosecco|sparkling|ciders?|ales?|lagers?|schooners?|pints?|stubbies|tinnies|cans?|six ?packs?|4 ?packs?|6 ?packs?|alcohol|grog|booze|liquor|xxxx|vb|great northern|corona|carlton|coopers|hahn|tooheys|jim beam|bundy|bundaberg|cruisers?|seltzers?|rtds?|premix|cocktails?|jugs?)\b/gi;
  var FILLER_WORDS = /\b(a|an|and|the|of|with|plus|x|or|bottle|case|box|pack|dozen|ml|l|litre|litres|ltr|cold|chilled|red|white|rose|ros\u00e9|cash|money|dollars?|bucks|aud|prize|winner|draw|jackpot|tonight|bonus|free|cases|boxes|packs|block|blocks|mixed|assorted|premium|local|imported|craft|full|strength|mid|light)\b/gi;
  function liquorOnlyPrize(text) {
    var t = String(text || '').toLowerCase();
    if (!t.trim()) return false;
    LIQUOR_WORDS.lastIndex = 0;
    if (!LIQUOR_WORDS.test(t)) return false;
    LIQUOR_WORDS.lastIndex = 0;
    var rest = t.replace(LIQUOR_WORDS, ' ').replace(FILLER_WORDS, ' ')
                .replace(/[$0-9.,&+\-x\/()'"!:;]/g, ' ').replace(/\s+/g, ' ').trim();
    return rest === '';
  }
  function liquorPrizeBlocked(venue, text) {
    return !!venue && String(venue.au_state || '').toUpperCase() === 'NT' && liquorOnlyPrize(text);
  }
  var LIQUOR_PRIZE_MSG = 'In the Northern Territory a prize cannot be only alcohol, or money and alcohol. Add something that is not alcohol (a meat tray, a voucher, a meal) or pick another prize.';

  root.VPGaming = {
    NOT_SHOWN: NOT_SHOWN,
    assess: assess, isGaming: isGaming, kindOf: kindOf, formatName: formatName,
    money: money, declaration: declaration, states: STATES,
    gate: gate, gateFor: gateFor, alreadyAcked: alreadyAcked,
    permitRecorded: permitRecorded, jackpotLimit: jackpotLimit,
    numberBingoHidden: numberBingoHidden, NO_PUB_BINGO_STATES: NO_PUB_BINGO_STATES,
    stateFromPostcode: stateFromPostcode,
    noPresentToWin: noPresentToWin, minClaimSeconds: minClaimSeconds, afterWinReminder: afterWinReminder,
    liquorOnlyPrize: liquorOnlyPrize, liquorPrizeBlocked: liquorPrizeBlocked, LIQUOR_PRIZE_MSG: LIQUOR_PRIZE_MSG
  };
})(window);
