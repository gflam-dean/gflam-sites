# Where things stand, 17 September, evening

The whole audit is done. Gate went 189 -> 197 checks, every new one proved by
breaking it on purpose and watching it go red.

---

## ONE JOB FOR YOU. Two minutes.

**Run `venueplay-85-prizes-tally-for-signed-in-venues.sql` in Supabase.**
It is open in TextEdit.

Until you do, every venue's Raffles panel says "No prizes recorded yet" when the
data is actually sitting there, one venue with $2,900 of prizes. It has been
wrong since the Sydney cut-over and nobody noticed because a failed read looks
identical to an empty tally.

Migration 84 is already in, you ran it. Nothing else is waiting on you.

---

## Those 2,234 Supabase errors: mostly us, and that is good news

`check-columns.py`, `check-writes.py` and `tenant-isolation-attack.py` all run as
an anonymous visitor and EXPECT to be refused. Every "401 permission denied" from
Python-urllib is one of them confirming the database is locked. Including the
deliberate `column vp_venues.a_column_that_cannot_exist does not exist`, which is
a check proving it can fail. I ran the gate about fifteen times today. That is
the spike. Nothing is falling over.

Three real things were hiding in there, all now fixed or explained:

  - the prizes tally above
  - every image upload wrote a `buckets_pkey` error to the log. Fixed: it asks
    before creating. A log you have learned to ignore is not a log.
  - the auth 422 during your GEN HOTEL signup is the HANDLED path, not a fault.
    All three venues have a working manager login. Checked.

The advisor's four SECURITY DEFINER criticals are Drag Bingo and Party Hire
views, not VenuePlay. Worth doing, not urgent, not tonight.

---

## What went live today

**Billing.** One account per email. A phone number no longer blocks a publican
who moved pubs. The free month the pages actually promise. One price whichever
door they come through. A venue added to a paying account gets its first month
free. A cancelled venue can come back instead of being told to invent a new name.

**Player data, all seven.** Unsubscribing now does something. A venue only keeps
what it agreed to keep. A manager is not handed the customer list by default.
Never collect what you will not hand back. A venue is told what its list is not
showing. Consent with no way to contact anyone is refused. The 90-day deletion
promise finally has a clock.

**Games.** Three host consoles that never told the host they had gone deaf. A
screen router that subscribed and never listened to the answer. A BINGO claim
that could be dropped on the floor instead of queued.

**Isolation.** Manager permissions no longer bleed between accounts.

**The account page.** Four venue pickers that could send a promo, or a members
list, to the wrong venue without you noticing. That one was yours to spot.

---

## The one thing I deliberately did NOT do

A host who CLOSES THE TAB rather than pressing end leaves the wall on a dead join
screen for up to **90 minutes**. Ending the night properly already works.

The audit said to put `to_ads` back in the signing exemption list. That is wrong:
a forged one lets any patron in the room kill a live game, repeatedly. The real
fix is for the TV to decide for itself, with a much shorter silence timeout while
it is showing a join screen rather than an actual game.

That is a timing change in tv.html, the file that has twice taken a venue's
screen down. Not something to do at the end of a fourteen hour day. It is written
up in the commit and it is the first thing on the list tomorrow.

---

## Still yours, from this morning's list

The **18 Exchange mailboxes**. You have had the domains since Monday but the
mailbox clock has not started, and that is what decides whether October is a full
sending month. Everything else on that list can wait.
