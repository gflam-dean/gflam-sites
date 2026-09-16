# Morning list, 17 September

Everything below was written with no Bash, so **nothing in this list has been run**. The
repo has uncommitted work in it. Run these in order and stop at the first red.

## 0. PartyPlay: one real fault found and fixed, and it is a launch blocker

**A guest who has been to ANY previous party could not join a new one.**

`play.html` restored any saved player for ever. The telly prints "go to
partyplay.com.au/play and put in this code", so a returning guest followed that
instruction, was put straight back into the party they went to in March, and read **"You
are in. Watch the big screen."** with no input, no button and no link anywhere on the
page. Subscribing to a dead party's channel still succeeds, because a channel is only a
name, so it even showed the green dot.

Found by opening the page on this laptop, which still had Dean's 15 September play-test
identity in it: party FKGSAJ, nickname Sam.

The QR code on the telly was never affected, because it carries `?code=`. Only the typed
route printed directly beside the QR was broken, which is the route anyone whose camera
will not cooperate takes. `tv.html` has had a "Wrong party? Use a different code" escape
hatch since it was written, and its comment describes this exact trap. The phone, the
surface every single guest holds, never got one.

Three changes, all in `partyplay/play.html`:

1. The waiting screen now always carries **"Not this party? Use a different code"**, the
   same wording and the same quiet styling the telly uses.
2. A saved party goes stale after **4 days** (3 day maximum party, plus a day of slack).
   Records saved before this change carry no timestamp at all, which is itself proof they
   are old, so every existing guest's phone heals itself the first time they open it.
3. `connect()` now holds its channel so backing out of one party and joining another does
   not leave two live subscriptions feeding the phone two parties' questions.

**Caught before it shipped:** my first draft of that fix called `hideCamera()` and
`_ppChannel`, neither of which existed. Under `"use strict"` the first would have thrown
and killed the link outright. Both are now properly defined. Exactly this morning's
mistake, caught this time by checking instead of assuming.

`partyplay/screen-check.html` now has a check that writes a synthetic returning guest,
loads the page as them, asserts there is always a way to the join form, and puts the
saved player back in a `finally`. So it cannot come back.

### Prove it yourself in thirty seconds, once it is deployed

On your phone or laptop, after the push has landed:

1. Go to **partyplay.com.au/play**. If it shows a join form, you are already fine.
2. To see the old behaviour, open the browser console on that page and run
   `localStorage.setItem('ppPlayer', JSON.stringify({code:'OLDPTY',nickname:'Test',token:'x'}))`
   then reload.
3. Before the fix: "You are in. Watch the big screen." and nothing to press.
   After the fix: the join form, with the name already filled in. And if it ever does
   restore a party, there is now a **"Not this party? Use a different code"** link under
   the status line.

**NOT RUN.** No gate, no push, no browser has loaded the edited file. The changed blocks
were syntax-checked by parsing them in Chrome, and the staleness decision was tested
against the real record in this browser and got all six cases right, including the live
one. That is not the same as having run it.

## 1. The gate, then push

    cd ~/gflam-ai-team/sites
    export DEVELOPER_DIR=/Library/Developer/CommandLineTools
    python3 tools/release-check.py

Expect **294 checks**, one more than yesterday. Two of the new ones have never run:
the PartyPlay paths added to the "somebody has actually looked at the screens" check,
and whatever the gate makes of the new `partyplay/screen-check.html`.

If it is green:

    git add -A
    git commit -m "verify-live: run the screen checks from the command line, both products"
    git push origin HEAD:main

## 2. Wait for the deploy, then the thing that matters

Pages takes 15 to 25 minutes. Then:

    python3 tools/verify-live.py --stamp

This is the new tool. It drives a real headless Chrome through both screen-check pages
and turns them into an exit code, which is the gap that let three faults reach a live
venue yesterday. Proven working last night against **tugun-bowls** and **wellshot-hotel**
(65 seconds each, all 23 checks passed, exit 0).

**The PartyPlay half has never executed.** Every assertion in it was run by hand against
the live pages last night before it was written down, but the page itself has not been
loaded once. Treat its first run as a test of the check, not of PartyPlay: if it goes red,
suspect the check first. That is the rule that has been right ten times out of eleven.

To look at it yourself instead:

    https://partyplay.com.au/screen-check
    https://venueplay.com.au/screen-check?venue=tugun-bowls

## 3. Two things already in the diary

- **~08:00 THE BIG ONE.** The last-day warning has never fired for real. Two venues are
  due this morning, which is two chances to see it rather than one:
  - **Praze The Roof**, to `dean.tindale@outlook.com`
  - **The Average Joe**, which scheduled its cancellation at 10:44pm on the 16th and stops
    on **19 September**. Two days before that is today, so it qualifies.

  If neither arrives by about 09:30, the sweep did not run or the two-day window is off by
  one. Check the Worker's cron and `vpaLastDaySweep` before changing any copy. Monday is
  GFLAM's, to `hello@theminibar.com.au`.

- **Instantly have replied, and half of what they said is wrong.** They claim DKIM is
  missing on all three domains. It is not: checked against public DNS last night, all
  three resolve a valid 2048 bit key through Hostinger's `hostingermail-a` selector, and
  both sending domains have SPF and `p=reject` DMARC. Their checker is most likely looking
  at the wrong selector. The reply to send them, and the one thing still genuinely
  unproven, is in `~/venue-enrich/REPLY-TO-INSTANTLY-dkim.md`.

  The real blocker is **MailChannels blocking Hostinger's relay**, 8 of 10 warmup sends,
  and they say fixing DKIM will not necessarily fix it. Warmup stays paused. This is the
  third piece of evidence for moving to Exchange Online, which the plan already says.

  `INSTANTLY-SUPPORT-not-sending.md` is now superseded by their reply. Do not send it.

- **Optional, one word.** The internal alert's subject reads `CANCELLED VENUE: <name>` while
  the body says they have only SCHEDULED it and are still playing. `CANCELLING:` is what
  actually happened and does not read, on a phone, as though they have already gone.

---

## What changed last night, and why

**Three faults reached the live site yesterday and all 292 gate checks stayed green.**
The one that mattered: `tvStatus` was declared inside an `if` block in `tv.html`, so it
only existed when that block ran, and that block only runs while the Supabase library is
still loading. On a screen where the library arrived quickly it never existed at all.
Tugun Bowls Club's television spent the day throwing `tvStatus is not a function` out of
its connection handler: no status, no transport recorded, and no way to mark itself deaf
when the channel closed. Fixed, deployed, and confirmed live.

Writing the gate check for that found two more, both in the game screens:

- `members/screen.html` had the same mistake, and its only other caller sits outside the
  block, so a members draw screen that lost its channel threw and kept its green dot up.
- None of the four game screens treated a `CLOSED` channel as a disconnection, so a screen
  whose channel simply closed went on announcing itself into a dead room.

**PartyPlay was checked by hand and is in good shape.** The practice run was played
through live: thirty balls, no duplicates, correct calls ("Key of the door" for 21), the
ticket is a real 15-number 90 ball ticket, every mark agreed with the board, "off a line"
only ever went down, and Start again really does clear everything. Two things that looked
like faults were not: the "the best one" badge on the home page renders correctly, and
Sam's "4 off a line" was right because 74 was on the third row.

## What else was checked last night, and passed

**VenuePlay.** `see-a-night`, the page every cold email points at, was opened and both of
yesterday's fixes confirmed on it: the venue name paints ("The Rose and Crown"), the
connection badge is present in the DOM but **not painted**, and a real bingo night is
running in the embed. That is the campaign's landing page proven, not assumed.

**PartyPlay, all verified by hand on the live site:**

- **The practice run plays correctly.** Balls are unique, the calls are right ("Key of the
  door" for 21), the ticket is a genuine 15 number 90 ball grid, every mark agreed with
  the board, "off a line" only ever went down, and **Start again really does clear
  everything** (board, ball, caption, marks and all three guests' counts).
- **The buy form is sound.** Picking 3 days changes the button to "Continue to pay $120"
  and back to $50, and 1 day is the default. Nothing was submitted, so no Stripe session
  and no charge.
- **Every page loads with a completely silent console:** home, play, tv, practice, run.
- **The terms are in good shape.** They name the entity (Gflam Group Pty Ltd), state the
  50 player cap, keep it to private use, explain the 12 month licence and the refund
  rules, and carry an Australian Consumer Law clause.

**Two false alarms, both checked before being reported:** the "the best one" badge on the
home page renders correctly, and Sam being "4 off a line" was right because 74 sat on his
third row.

## Small, and your call

- **PartyPlay's terms and privacy pages carry no ABN.** They do name Gflam Group Pty Ltd,
  so this is a nice-to-have rather than a gap. VenuePlay's emails carry
  "Gflam Group, ABN 35 679 383 049". I did not edit legal copy overnight for a
  nice-to-have.
- **see-a-night, your note:** if an email sends somebody there they will not know what
  they are looking at without reading. Put the demo higher up, or a button on the NSW
  page. Agreed, and left for today.
- The internal cancellation alert's subject says `CANCELLED VENUE` when they have only
  scheduled it. `CANCELLING:` is truer.

## Still open, and still yours

- OLGR with the lawyer. Queensland and WA only, and neither is marketed until it clears.
- Three or four free outlook.com accounts, plus one Exchange seat and a domain.
- Whether a latecomer should be able to join heads or tails, trivia, who here has ever or
  guess the photo mid-round. Left alone on purpose; it is a product call, not a bug.
- Guess the photo and "How well do you know" have still never been played end to end.
  They need a real party with real photos in it.
