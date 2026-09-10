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

## The whole thing was rehearsed on 10 Sep 2026, and it failed the first time

Every step was run against Sydney, in order, and it ended in **ALL MATCH**: 73 tables,
19 views, 25 functions, 106 policies, 5 triggers, 143 indexes, 15 auth users, 15 auth
identities, 94 storage objects, and 92 tables/views compared with **0 differing row
counts**. Then `tools/play-a-game.py` played all five formats against the refreshed data:
146 checks, no failures.

**IT FAILED THE FIRST TIME, at `refresh`, and that is the point of rehearsing.** The error:

    ERROR: duplicate key value violates unique constraint "identities_pkey"
    STOP: auth.identities refresh failed

The tool deleted `auth.users` only, and left `auth.identities` to the ON DELETE CASCADE.
That cascade never fires here, because the same command sets
`session_replication_role = replica`, which switches foreign key triggers OFF, which is the
whole reason it is there for the data load. So the old identities survived and the COPY
collided with them. The identities step was a literal `select 1` no-op.

On the morning that would have stopped the move with **the public data already replaced and
auth half loaded**, which is the worst place to be interrupted. Fixed: both tables are now
deleted explicitly.

## What this means for the day

The Sydney data was stale before the rehearsal, and would have been on Saturday too: 19
venues against live's 22, and **10 signing keys against live's 17, with 1 venue enforcing
instead of 17**. Cutting over on that would have silently undone a day's security work.
`refresh` is what fixes it, and it now demonstrably works. Sydney currently mirrors live
exactly, including all 17 keys and all 17 venues enforcing.

**Re-run `dump` and `refresh` ON THE DAY regardless.** Anything written to live between the
copy and the cut-over is lost, and today's copy will be days old by Saturday.

## The load-test seed venues are gone

The 5,000 `load-` rows are OFF Sydney as of 10 Sep. It holds 19 venues, which is the real
number. `refresh` would have emptied them anyway, but there is now nothing to verify.

## The plan we are actually on (corrected 10 Sep 2026)

Dean: "im not on pro". Both projects are on the FREE tier, not Pro. Two notes in
this repo said otherwise and were wrong; this is the corrected record.

That changes the ceiling, and not because of the database. **Realtime connections
are capped at 200 on free.** Every TV, host tablet and phone holds one, so a venue
with forty players is forty-two connections. That is about FOUR VENUES PLAYING AT
ONCE, whatever the database does.

    free                    ~4 venues at once   ceiling is Realtime connections
    Pro, about US$25/mo     500 connections     ~10 to 12, ceiling becomes the database
    Pro plus Small compute  about twice that
    Pro plus the room server  connections stop mattering: the phones are on Cloudflare

It also explains the load test numbers. What collapsed at fifteen trivia rooms was
free-tier shared compute, not a paid Micro. Roughly 20 database calls a second
sustained, where a paid Postgres of any size would do far more.

DECIDED, 10 Sep 2026: buy nothing yet. Let the room server's phase 2 land and be
measured first, because it removes the exact limit the free tier imposes hardest.
Go to Pro before selling into Queensland, because four concurrent venues is not a
business and no engineering gets around a connection cap.
