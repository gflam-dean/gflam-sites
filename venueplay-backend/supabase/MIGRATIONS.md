# Which migrations are actually in the live database

Read this before writing a new one, and before running an old one.

## Why this file exists

On 22 August 2026 four migrations were written on `main` numbered 49, 50, 51 and
52, while `fix/audit-40` already had entirely different files with those same four
numbers. **The branch's versions had already been run against production.** The
branch has never been merged, so `main` did not know they existed, and its own
`supabase/` folder read as if the database stopped at 48.

That is worse than untidy. `main` ships code reading `trivia_time_limit_s`,
`trivia_base_points`, `raffle_template` and `hide_from_trusted`, four columns that
only ever existed because of migrations on a branch. Rebuild the database from
`main` alone and PostgREST rejects the whole select on the first missing column,
which is exactly how the HQ venue list came back empty on 19 August.

Fixed by copying the six applied files into `main` unchanged, and renumbering the
four written on 22 August to 55 to 58. Nothing was re-run and no content changed.

## The rule

**A number is spent the moment a file claims it, on any branch.** Before you add
one, check every branch, not just the one you are on:

    git fetch origin '+refs/heads/*:refs/remotes/origin/*'
    for b in $(git branch -r | grep -v HEAD); do
      git ls-tree --name-only "$b" venueplay-backend/supabase/ | sed 's|.*/||'
    done | sort -u | tail -20

## State on 22 August 2026, verified against the live database

Verified by asking PostgREST for each column, not by reading the files.

| # | File | In live DB |
|---|------|-----------|
| 44 | gaming-compliance | yes |
| 45 | draw-archive | yes |
| 46 | lock-anon-access | yes |
| 47 | capture-provenance | yes |
| 48 | close-venue-enumeration | yes |
| 49 | sign-enforce | yes, from fix/audit-40 |
| 50 | trivia-defaults | yes, from fix/audit-40 |
| 51 | raffle-template | yes, from fix/audit-40 |
| 52 | founding-comp-status | yes, from fix/audit-40 (this is what lets status be 'comp') |
| 53 | trusted-exclude-comp | yes, from fix/audit-40 |
| 54 | hide-from-trusted | yes, from fix/audit-40 |
| 55 | broadcast-enforce | yes, run 22 Aug |
| 56 | one-enforce-flag | **not yet** |
| 57 | overage-streak-day | **not yet** |
| 58 | bingo-optins-reachable | applied |
| 59 | capture-player | applied |
| 60 | game-feedback | applied |
| 61 | lock-remaining-views | applied |
| 63 | screen-reload-pull | applied 5 Sep |
| 64 | screen-heartbeat | applied 5 Sep |
| 65 | screen-command | applied 5 Sep |

Verified against the live database on 5 Sep 2026, not from memory: vp_captures
.player_id and .source exist, vp_venues.overage_streak_day exists,
vp_game_feedback answers, and v_vp_prizes_given refuses the public key. Nothing
is pending. This table said "58 not yet" for weeks after 58 had gone in, which is
the drift that makes a ledger worse than no ledger - so check the database, and
correct this line when you do.

56, 57 and 58 all say at the top that they go AFTER the Worker paste, and 56
carries the query to run first in case a venue was switched to enforce under the
old build.

## Do not merge fix/audit-40

It is stale. Merging it would delete `welcome-hq.html`, `venue-onboarding.html`,
`add-card.html`, `repair-venue.py` and the guard-path fixes, and revert the trivia
count. Its six SQL files are now here; anything else worth having gets cherry
picked, never merged.

## Checking, rather than assuming

    SUPABASE_SERVICE_KEY='...' python3 venueplay-backend/tools/check-schema.py

That asks the live database whether every column the code reads is really there.
It is the only thing that catches this class of problem, because the code is
correct and the database is the thing that disagrees with it.
