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
| 66 | screen-version | applied 5 Sep |
| 67 | group-invoicing | applied on live and Sydney (columns seen in both databases, 9 Sep) |
| 68 | venue-join-code | applied on live and Sydney (vp_venues.join_code seen in both, 9 Sep) |
| 69 | members-draw-hold | applied on live and Sydney (last_drawn_at seen in both, 9 Sep) |
| 70 | bingo-server-draw | applied on live and Sydney (vp_bingo_draws exists in both, 9 Sep) |
| 71 | one-trip-answer | ON BOTH. live and Sydney, checked 10 Sep 2026 |
| 72 | one-trip-screen-poll | ON BOTH, checked 10 Sep 2026 |
| 73 | one-trip-host-trivia | ON BOTH, checked 10 Sep 2026. This table said "Sydney only, not on live" and that was WRONG: live has had it since 9 Sep |
| 74 | members-draw-pending | ON BOTH. Was live only; run on Sydney 10 Sep. Adds the outcome CHECK and the open-draw index |
| 75 | CHECK-settings-policies | read only, one query. Nothing to apply |
| 76 | one-trip-host-draws | ON BOTH, checked 10 Sep 2026. This table said "NOT RUN anywhere" and that was WRONG: live has it |
| 77 | owner-only-settings | ON BOTH. Was live only; run on Sydney 10 Sep. Without it a MANAGER could change the columns only an owner may change, and nothing would have said so |
| 78 | trivia-one-answer-index | ON BOTH, and a no-op on both because the index was already there. Written down 10 Sep because it had been created BY HAND and lived in no migration at all: rebuild from this repo and the duplicate-answer guard silently disappears |

## Stop reading this table. Ask the databases.

    python3 venueplay-backend/tools/check-databases-match.py

It compares the live database with Sydney on tables, columns, functions, triggers,
indexes and policies, and names anything live has that Sydney does not, because at
cut-over those stop existing. Almost none of them fail loudly: a missing trigger
means a rule quietly stops applying, a missing unique index means a guard quietly
stops guarding, a missing function only makes the Worker take its slower fallback.

ON 10 SEP 2026 IT FOUND TWO, and this table had three lines backwards at the same
time. Sydney was missing 77's owner-only trigger and 74's index, while this file
claimed 73 and 76 were not on live when live had both. Four days after the note
below was written about exactly this. A ledger drifts because it is written by
hand and the database is not; the tool cannot drift. Run it before Saturday, and
run it again after the cut-over.

    python3 venueplay-backend/tools/check-signing.py

Same idea for the other thing a database cannot tell you by being read: it signs
in as a real host and proves the signing key route works, and refuses everyone
else.

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
