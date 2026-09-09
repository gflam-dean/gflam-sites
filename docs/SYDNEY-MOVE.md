# Moving the database to Sydney

Written 10 Sep 2026, after Dean asked "when can we move to Sydney?"

## Why, in one number

Measured this morning from Dean's Mac, by `migrate-sydney.py check`:

    Singapore (live)  1.53 seconds round trip
    Sydney (new)      0.38 seconds round trip

That is the whole story. Calling a bingo ball makes ten database round trips,
which is why it takes two to three seconds on the wall. The room server already
carries the ball to the TV and the phone in 45 milliseconds; it is the database
the host is waiting for.

Two separate fixes, and they multiply:

  one trip instead of ten   ten round trips become one
  Singapore to Sydney       each round trip gets about four times faster

Do them both and calling a ball goes from two to three seconds to well under a
quarter of a second.

## Is it ready

Yes, mechanically. `migrate-sydney.py check` passes: both projects reachable,
Postgres tools found, 91 tables on each side, 14 auth users, 94 files in the
venue-ads bucket, and a baseline of 43,329 rows saved for the verify step.

Sydney is NOT empty: it holds the schema, the one-trip functions, and the
load-test venues from 8 Sep. So cut-over uses `refresh` (which empties the DATA
and keeps the schema) and NOT `restore`.

## What is left before the day

1. The one-trip work for bingo and the members draw, so the move is not covering
   for ten round trips that should have been one.
2. A test game that passes against a Sydney-backed staging Worker
   (`python3 tools/play-a-game.py`), not just against Singapore.
3. Dean's two open decisions: whether Sydney goes from Micro to Small (US$15 a
   month) and whether the spend cap comes off.

## The day itself, in order

Pick a quiet morning. Not a night with a game booked. Allow two to four hours,
most of which is waiting.

    python3 venueplay-backend/tools/migrate-sydney.py check       read only
    python3 venueplay-backend/tools/migrate-sydney.py dump        read only on Singapore
    python3 venueplay-backend/tools/migrate-sydney.py refresh --dry-run
    python3 venueplay-backend/tools/migrate-sydney.py refresh     writes to Sydney
    python3 venueplay-backend/tools/migrate-sydney.py storage     copies the 94 ad images
    python3 venueplay-backend/tools/migrate-sydney.py verify      must say ALL MATCH

Then, and only after ALL MATCH:

    python3 venueplay-backend/tools/migrate-sydney.py checklist   what to paste where
    the two Workers redeployed with the Sydney variables
    auth settings on the new project
    python3 venueplay-backend/tools/migrate-sydney.py rewrite --write     77 files
    git push origin HEAD:main
    reload every venue screen from HQ
    python3 tools/play-a-game.py
    prove a real game on The Mini Bar
    check The Average Joe is untouched and healthy

Singapore is never written to. It stays exactly as it is, which is the rollback:
if anything is wrong, the Workers point back at it and the night carries on.

Rotate the Singapore key about a week later, once nothing has needed it.

## The one thing that would hurt

The load-test seed venues (5,000 `load-` rows and 1,000 mid-game rooms) are on
Sydney from 8 Sep. `refresh` empties the data, so they go, but VERIFY before
believing it: a live venue list with 5,000 fake pubs in it would reach HQ, the
"trusted by" marquee and every count we quote.
