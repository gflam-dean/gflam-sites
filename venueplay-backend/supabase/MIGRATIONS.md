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
| 79 | stripe-event-ledger | ON LIVE. vp_stripe_events is being written and read right now: the live overage runs on 11 Sep read `claimed_at`/`completed_at` off it to prove the webhook finished. Was missing from this table entirely, which is the same fault row 76 and row 78 record. Sydney NOT verified |
| 80 | owner-test-matches-the-worker | **NOT RUN.** 77 asks `role = 'owner'` and only 3 of 17 active venues have such a row, so at 13 venues the real owner is silently refused and the page still says "Saved." This asks what the Worker asks: an owner-side role AND no permissions object. Measured on live data 12 Sep 2026. tugun-bowls stays locked out on purpose, it has no owner-side row at all |

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

## 86, marketing role (22 Sep 2026)

`venueplay-86-marketing-role.sql`: lets `vp_venue_staff.role` hold `marketing`, adds `notify_email`, and replaces
`vp_host_staff()` (the staff check behind every one-trip game function) with the same function plus one line,
`and s.role in (owner, manager, host)`. Run BEFORE deploying the Workers that read `notify_email`. The previous
function is at the bottom of the file, commented, to paste back.

`venueplay-87-played-at.sql`: adds `vp_players.played_at`, stamped once by `/player/alive` the moment a phone
holds a card or a question. Billing and the overage count treat a row with it as a player who showed life
(Dean's rule, 22 Sep 2026); a session where no row carries it is counted the old way. The Worker tolerates the
column being absent, so the order does not matter here; run it when convenient. Rollback at the bottom.

`venueplay-88-paper-players.sql`: adds `vp_sessions.paper` (jsonb), where the game Worker keeps a night's printed
musical bingo cards and how many trivia team sheets were printed (Dean, 25 Sep 2026). RUN ON SYDNEY 25 Sep 2026,
verified by information_schema and by a PostgREST select of the column. Run BEFORE deploying the game Worker that
writes it: /host/paper/print patches this column. Rollback: `alter table public.vp_sessions drop column paper;`

`venueplay-89-session-lobby-format.sql`: adds `vp_sessions.lobby_format` (text), the game the host last opened a
lobby for or started, so /join/info sends a code typed in a lobby to that game and not the last one played
(audit 25 Sep 2026). RUN ON SYDNEY 25 Sep 2026, verified by information_schema. The Worker tolerates it missing.

`venueplay-90-members-draw-one-at-a-time.sql`: `vp_members_draw` takes a row lock (FOR UPDATE) on the draw when it
first reads it, so two consoles pressing Draw together can no longer each name a different member (audit 25 Sep
2026). Otherwise identical to the live definition it was read from. RUN ON SYDNEY 25 Sep 2026; verified by
pg_get_functiondef, grants unchanged (postgres + service_role only), and by holding the row lock on one connection
while a second call waited until its 2s timeout. No Worker change. Rollback: re-run the function from migration 76.

`venueplay-91-one-code-per-venue.sql`: every venue's shown code (`join_code`) is now its channel code (the slug
hash), and a new venue is given it on insert by trigger `vp_venues_fill_code` (Dean, 25 Sep 2026: "make all the
venues the same code"). Before: 4 venues showed a code that was not their channel (Test Alpha/Bravo/Charlie, The
Mini Bar) and every venue created since 17 Sep had none, because migration 68 only backfilled existing venues
and nothing assigned one after. Uses 68's `vp_legacy_venue_code`; a clashing hash leaves the code null rather than
failing the sign-up. RUN ON SYDNEY 25 Sep 2026: 26 of 26 match; trigger proven on rolled-back inserts (new venue
gets its code; a clash inserts codeless). Old codes 62GTYQ, TMJ2TP, NCEM9A, 2Y3F9Q no longer resolve.

`venueplay-92-signing-on-by-default.sql`: `vp_venues.broadcast_enforce` defaults to TRUE and every active venue is
switched on (Dean, 25 Sep 2026: "make sure it doesn't happen again"). The four venues made after 10 Sep had run
without signing because the default was false. Safe with no key: vp-sign.js fails open until the first host login
mints one. RUN ON SYDNEY 25 Sep 2026: 0 active venues not enforcing; a rolled-back insert came back enforcing.
Live gate line "every active venue enforces broadcast signing" (tools/check-signing-enforced.py), proven red by
switching test-charlie off and back. Rollback: enforce-signing.py --off ALL.

`venueplay-93-reveal-honours-added-time.sql`: `vp_host_reveal` measures the trivia speed bonus against the window the
question was ASKED with, subtracting `config.time_added.ms` (from /host/question/add-time) as the Worker's fallback
always did. Found live by the play-test of 27 Sep 2026 (a 125-point answer scored 150; the audit fault of 20 Sep).
RUN ON SYDNEY 27 Sep 2026; verified by pg_get_functiondef and by replaying the live add-time test on test-bravo
(now 125). Grants unchanged. Rollback: re-run vp_host_reveal from migration 73.

`venueplay-94-paper-night-reveal-private.sql`: on a paper night (`config.defer_reveal`) `vp_host_reveal` emits
`trivia.reveal` WITHOUT `correct_index` or `split` (it went to the public session channel every joined phone reads,
before the paper teams handed in). The host's reply keeps the answer. Worker fallback changed to match.
RUN ON SYDNEY 27 Sep 2026; proven live on test-bravo (event keys: deferred, leaderboard, options, qseq). Keeps 93's fix.
Rollback: re-run 93.

`venueplay-95-jag-the-joker.sql`: NOT RUN. Number claimed so nothing else takes it. 19 Oct 2026: Jag the Joker was taken out
of the live code (an unapproved random draw game); the whole feature, this file included, is kept on branch
`jag-joker-parked` (main at 427f4f5). Run this only when Jag comes back.
Reworked in place 30 Sep 2026 (still NOT RUN): adds `vp_jag_log`, frozen turns/log/secrets (UPDATE and DELETE, cascade
from a deleted venue let through), a guard on the game row's fingerprint fields, the state check inside every play
(`vp_jag_gate`), one card a trading night, owner-only close with a reason, jackpot carry, and `vp_jag_public`.

`venueplay-96-double-points-final-round.sql`: `vp_venue_settings.trivia_double_points` + `trivia_double_last`, and
`vp_host_reveal` (identical to 94 otherwise) scores a correct answer twice, speed bonus included, when the question's
seq is in `config.double_seqs`; the reply says `double`. Safe before the Worker: no `double_seqs`, no change.
RUN ON SYDNEY by Dean 28 Sep 2026; read back: vp_host_reveal doubles on double_seqs and still hides the answer on
paper nights, both columns present, anon still cannot execute it.
Rollback: re-run 94.

`venueplay-97-paper-night-board-private.sql`: on a paper night the public `trivia.reveal` event also drops the
`leaderboard` (94 dropped the answer; a team's total moving is the answer by another name). Identical to 96
otherwise, so double points is kept. Worker fallback changed to match (shipped first; safe either order).
RUN ON SYDNEY by Dean 28 Sep 2026; read back: the deferred event has no leaderboard, double points kept. Rollback: re-run 96.

`venueplay-99-answer-membership-first.sql`: `vp_player_answer` checks the phone is in the game BEFORE the format, so a
phone from another venue posting a bingo game id hears "not in this game", not "Not a trivia game" (break test, 14 Oct
2026). Two lines swap; the rest is 71 exactly (live body compared 14 Oct). The Worker already maps a not_trivia for a
stranger to wrong_game, so either order is safe. NOT RUN. Rollback: re-run 71.

`venueplay-101-members-draw-jackpot-cap.sql`: `vp_member_draws.max_jackpot_cents` (int, null = no maximum, check >= 0)
and `reserve_cents` (int, not null, default 0, check >= 0). Anisimoff Legal 1 Oct 2026 point 10 and 8 Oct 2026 point 6:
a customer-set maximum jackpot, enforced before the draws, the draw continuing until won; the reserve banks the
increments the jackpot cannot take and seeds the next one. The game Worker reads both in a forgiving second trip and
only writes `reserve_cents` when the read succeeded, so either order is safe; run it BEFORE deploying that Worker so
the cap is live on the first night. No RLS change (rides on vp_member_draws). RUN on the live database (checked 19 Oct 2026 with the service key). Rollback: drop the two columns
(the file says how). 100 is agent B's (venue permits and compliance tick), written the same day.

`venueplay-103-bingo-withdrawn-ball-kept.sql`: `vp_bingo_draw_balls.withdrawn_at` (timestamptz, null = the ball stands).
Caller mode's Undo used to DELETE the ball's row, so the night's draw record had no trace of a number called and taken
back (certification review, 17 Oct 2026). The game Worker now marks the row instead. The table's two keys (one ball per
number, one per place) become partial unique indexes over standing balls only, because after an Undo the next ball takes
the same place and the withdrawn number may be called again; a check stops a server ball ever being marked withdrawn.
Replica identity set to full, since the primary key goes. Either order is safe: before it is run the Worker sees
PostgREST refuse the column and deletes the row as before; with it run, the old Worker's delete still works. Run it
BEFORE the Worker if possible so the first Undo is kept. No RLS change. RUN on the live database (checked 19 Oct 2026). Rollback: in the file.

`venueplay-104-bingo-server-tickets.sql`: `vp_bingo_tickets` (every bingo phone ticket: draw, pid, device id, strip book and
page, 27 cells, card number, source server or tablet, dealt_at, voided_at) and `vp_bingo_claims` (every BINGO pressed: the
ticket checked, the server's verdict from its own ticket and ball record, which check the host saw, the decision). Both
service-role only. Dean, 19 Oct 2026: "Lets go the server". Branch `feature/bingo-server-tickets`. Run BEFORE deploying the
game Worker that goes with it; either order is safe for a night (without the tables the console deals from the tablet as
before). After running, `python3 venueplay-backend/tools/dump-rls-baseline.py` and commit RLS-BASELINE.json (two new locked
tables). RUN on the live database 19 Oct 2026 (both tables answer the service key and refuse anon); RLS-BASELINE.json
re-dumped and committed on the branch the same day. Rollback: in the file.

`venueplay-100-permits-and-compliance-tick.sql`: RUN on the live database (checked 19 Oct 2026 with the service key).

## Retired, unused, for a later drop (19 Oct 2026)

Dean: "remove whatever doesn't need to be there or could jeopardise OLGR licensing". The game Worker no longer touches
these; nothing was dropped, so an old Worker still deploys safely. Drop them in a later migration once no Worker that
uses them can be redeployed.
- `vp_bingo_games` (migration 06 era): the draw order of the old `/host/game` bingo90 path. No code reads or writes it.
- `vp_draw_next_ball(p_game)`: the database function behind the old `/host/ball`. No code calls it.
- `vp_cards` and `vp_claims` rows for a `bingo90` game: no longer written. The tables stay; musical bingo uses them.
- The Jag tables and functions of migration 95 were never created on the live database.

`venueplay-105-bingo-outage-record.sql`: the server's own outage record (audit of a16446c, 19 Oct 2026).
`vp_bingo_draws.ball_asked_ordinal`, `ball_asked_at` (the place the console last asked the server for), `deal_failed_at`,
`deal_fail_why` (a deal the server received and could not finish); `vp_bingo_tickets.balls_at_deal`, `tablet_dealt_at`.
The tablet may stand in for the server only where these prove the server itself failed. MUST be run BEFORE the game
Worker of branch feature/bingo-server-tickets (VP-DRAW-1.0) is deployed: that Worker selects these columns and its bingo
routes error without them. No RLS change. RUN on the live database (19 Oct 2026; ball_asked_ordinal and the rest answer 200). Rollback: in the file (deploy the previous Worker first).

`venueplay-106-help-desk.sql`: the help desk, for VenuePlay AND PartyPlay (Dean, 19 Oct 2026). `vp_help_tickets` (ticket_no from
1001, brand venueplay or partyplay, category sales / venue_support / patron_support / accounts / general, channel patron_form /
venue_form / web_form / email / phone / manual, status new / open / waiting / closed, priority, subject, message, contact name,
email and phone, venue, room or party code, session, who raised it, who has it, closed_at, the address an email was sent to and its
Message-ID), `vp_help_ticket_notes` (internal notes, replies sent, emails in, changes), `vp_help_push_subs` (staff devices that
asked for phone alerts; a hash of each device's secret, never the secret), and the help words HQ edits: `vp_help_faq`,
`vp_help_issues` and `vp_help_steps` (guided triage, with try and fix counts and pins), `vp_help_triage_events` (each answer, for the
report) and `vp_help_reorders` (automatic step moves, with Undo). Seeded with the FAQ wording Dean approved and starter issues.
All eight service role only: no grants to anon or
authenticated and no policies, so the billing Worker is the only door, and it answers ticket reads to HQ (vp_platform_admins
owner, accounts, staff) and nobody else. Branch `feature/help-desk`. Run BEFORE deploying the billing Worker that goes with it;
either order is safe for a night (no game path touches it, and the website enquiry form still emails as before if the table is
missing). After running, `python3 venueplay-backend/tools/dump-rls-baseline.py` and commit RLS-BASELINE.json (eight new locked
tables). RUN on the live database 19 Oct 2026 (eight locked tables; FAQ rows 7, 7, 7, 6), after a stray duplicated line from
the seed was removed (commit 2373a94: a FAQ answer with a line break had been spliced twice). RLS-BASELINE.json re-dumped the same
night. Rollback: in the file.
`venueplay-107-unlimited-nights-switch.sql`: `vp_venues.weekly_limit_off` (boolean, not null, default false) and the
`vp_venues_weekly_limit_guard` trigger. Dean, 19 Oct 2026, for Deepwater Hotel: a per-venue switch that lifts the
once-a-week trivia and musical bingo rule. Set only from HQ (Venues > Details > "Unlimited trivia and musical bingo
nights", billing Worker `/admin/venue-gaming`, owner or accounts admins, audited as `venue_unlimited_nights_on` /
`_off`); the trigger puts the old value back when a venue's own login writes it. Not security definer and no new
policy or grant, so RLS-BASELINE.json does not change. Either order with the Workers is safe (both read the column
fail-safe). Branch `feature/venue-switches-logos-dropdowns`. RUN by Dean 20 Oct 2026. Rollback: in the file.

`venueplay-108-help-desk-hardening.sql`: help desk hardening after the independent review (19 Oct 2026, branch
`fix/help-desk-review`). `vp_help_limits` and `vp_help_hit(key, window_secs, limit)`: rate limits kept in the database, one atomic
statement per hit, so they hold across every Worker instance (keys hold a salted hash of a network address, never the address).
`vp_help_tickets.reply_token` (a per-ticket secret an emailed reply must quote; existing tickets get one), `contact_email_pending`
(a Reply-To held until HQ confirms it), `contact_typed` (an address HQ typed in; replies need the owner or a confirm).
`vp_help_push_subs.last_peek_at` defaults to now(), the only clock the phone-alert cursor uses. Run BEFORE the billing Worker of
that branch: it writes reply_token and contact_typed on every new ticket. After running, dump RLS-BASELINE.json (one new locked
table, one new definer function). RUN by Dean 20 Oct 2026. Rollback: in the file. (107 is claimed by feature/venue-switches-logos-dropdowns.)

`venueplay-109-bingo-unseen-and-finished.sql` (VP-DRAW-1.1, review of 1.0, 19 Oct 2026): `vp_bingo_draw_balls.void_reason`
and `vp_bingo_tickets.void_reason` (a server ball or ticket the room never saw, kept on the record as void with the
reason: a slow server answered after the console had called that place, or dealt that phone, from the tablet);
`vp_bingo_draws.deal_asked_at`; the check on withdrawn balls becomes "a tablet ball, or a server ball with a void reason"
(`vp_bingo_draw_balls_withdrawn_why`, replacing `_withdrawn_local`). MUST be run BEFORE the VP-DRAW-1.1 Worker. No RLS
change. RUN by Dean 20 Oct 2026. Rollback: in the file.

fail-safe). Branch `feature/venue-switches-logos-dropdowns`. NOT RUN. Rollback: in the file.
`venueplay-110-night-pass-and-console-pickup.sql`: Dean, 20 Oct 2026, "it would be shit to not be able to fix something to let
a venue play a night on a night". (1) A one-night pass: `vp_venues.night_pass_format` ('trivia', 'musical_bingo' or 'either'),
`night_pass_until` (granted + 24 hours), `night_pass_granted_at`, `night_pass_granted_by`, `night_pass_used_at`,
`night_pass_used_format`, `night_pass_used_session`, and the `vp_venues_night_pass_guard` trigger (a venue's own login cannot set
or clear any of them; the old values are put back, the same way as 107). Granted and cancelled only from HQ (Venues > Details >
"Let them run one more night", billing Worker `/admin/night-pass`, owner or accounts admins, audited as
`venue_night_pass_granted` / `_cancelled`); spent by the game Worker the first time the once-a-week rule would have refused a
night of that format (audited as `venue_night_pass_used`), without moving `last_trivia_at` / `last_musical_at`. (2) Picking up a
running game from another device: `vp_sessions.console_holders` (jsonb, per format: the console that last picked it up),
written by the game Worker's `/host/running/take` (staff at the venue only). Not security definer, no new policy or grant, so
RLS-BASELINE.json does not change. Either order with the Workers is safe (both read the new columns fail-safe). Branch
`feature/trivia-recover-and-night-pass`. RUN by Dean 20 Oct 2026. Rollback: in the file.
`venueplay-111-hq-chooses-trusted-logos.sql`: Dean, 20 Oct 2026, "I dont want a venue to be able to put it on our website we
should choose". `vp_venues.show_logo_on_site` (migration 102) becomes HQ's switch: default false, true only for
`deepwater-hotel` and `the-mini-bar` and false for every other venue (an audit row per change), and the
`vp_venues_logo_on_site_guard` trigger (a venue's own login cannot set it; the old value is put back, the same way as 107). Set
only from HQ (Venues > Details > "Show logo on our website", billing Worker `/admin/venue-gaming`, owner or accounts admins,
audited as `venue_logo_on_site_on` / `_off`). `hide_from_trusted` (54) is left in place and no longer read. Not security
definer, no new policy or grant. RUN IT BEFORE the billing Worker that comes with it: the new Worker drops the old "paying" and
"not a 1-player plan" rules, so on today's data (every venue true) it would show venues HQ never chose. Branch
`feature/hq-picks-logos-settings-tidy`, rebuilt as `feature/settings-tidy-26-oct`. RUN on the live database 20 Oct 2026
(verified 26 Oct 2026: its audit rows, and only those two venues on). Re-runnable: the data step runs only on the first run
(before the guard trigger exists), so HQ's later choices are never undone. Rollback: in the file.

`venueplay-112-help-faq-support-phone.sql`: the venue Help FAQ "Contacting us" names the support phone, 07 5228 3667
(Dean, 20 Oct 2026). One guarded update of a row 106 seeded; words only, no RLS change. RUN on the live database
(verified 22 Oct 2026). Rollback: put 106's words back in HQ > Help desk > Help words.
`venueplay-113-help-join-steps-true.sql`: the venue Help steps say what the product does (Dean, 21 Oct 2026): "Players
cannot join" reordered, steps 1 and 2 pinned, the plan never stops anyone joining; the TV step names {tv_link}; "Billing
and players" and "Contacting us" corrected (no "Happening now" tick). Every update is guarded by the words 106 or 112
wrote, so an HQ edit is left alone. Words and order only, no RLS change. Branch `feature/help-page`. RUN on the live
database (verified 22 Oct 2026). Rollback: edit the rows back in HQ > Help desk > Help words.

`venueplay-114-screen-history.sql` (21 Oct 2026, branch `feature/screen-history`): Tugun Bowls Club's logo and slides went with
no screen row, no stored file and no audit entry left to say when or who. `vp_venue_screen_history` gets one row for every
insert, update and delete of `vp_venue_screen`, written by the `vp_venue_screen_capture` trigger (security definer) inside the
same transaction: the whole row before and after (addresses, never image data), when, and who (`actor` from the billing
Worker's `X-VP-Actor` header: venue login, HQ View as or HQ restore; `via` 'direct' for anything that did not come through
the Worker, such as the dashboard, the SQL editor or a cascade from deleting the venue). Append-only for everyone (no write
grant to anyone, the service key included; a guard trigger refuses UPDATE, DELETE and TRUNCATE); RLS on with no policy and
no grant to anon or authenticated; SELECT for the service key only; no foreign key, so deleting a venue keeps its history.
A baseline row per existing screen. `vp_screen_history_check()` (security definer, service key only) is the nightly check the
billing Worker's cron calls: 'drift' and 'vanished' rows for anything the trigger did not see. The file ends with a self-test
that deletes one real screen row and changes another directly, requires both recorded as 'direct', requires the history to
refuse a delete, then rolls that back; any failure aborts the whole migration. Run BEFORE the billing Worker of that branch
(its HQ Screen history view says "run migration 114" until then; screen saves work either way). RLS-BASELINE.json already
carries the new table and two functions; dump it after running and commit if it differs. RUN on live (verified 22 Oct 2026:
the table exists with 20 baseline rows, one per screen row at the time). Rollback: in the file.
(111 is feature/c4-c5-onboarding, 112 feature/support-phone, 113 feature/help-page.)

`venueplay-115-purchase-raffle.sql`: Deepwater Hotel (NSW), 22 Oct 2026: a months-long raffle where every PURCHASE earns one
entry (never per drink or by the amount of alcohol). `vp_venues.purchase_raffle_on` (default false for every venue) with the
`vp_venues_purchase_raffle_guard` trigger (a venue's own login cannot set it; same shape as 107), set only from HQ (Venues >
Details > "Purchase raffle", billing Worker `/admin/venue-gaming`, audited as `venue_purchase_raffle_on` / `_off`). Four new
tables, RLS on with no policies and anon/authenticated revoked (service role only): `vp_purchase_raffles` (one open per
venue), `vp_purchase_raffle_entrants` (mobile as +614xxxxxxxx only, unique per raffle; names, email, their own marketing tick,
18+ timestamp), `vp_purchase_raffle_entries` (one row per purchase, who added it, venue day, voids kept), and
`vp_purchase_raffle_draws` (prize, winner, pool size and the index the server picked, redraws with their reason). Used by the
game Worker `/host/praffle/*` and the billing Worker `/account/purchase-raffle-export`. Either order with the Workers is safe
(both answer "not switched on" / "run 115 first" without it). After running, dump RLS-BASELINE.json (four new locked tables, one
new trigger function). Parsed by pglast (the real Postgres parser) and run twice on a real Postgres 16 with stub
auth/vp_venues before it was handed over. Branch `feature/purchase-raffle`. NOT RUN. Rollback: in the file.

`venueplay-116-number-bingo-switch.sql` (Dean, 22 Oct 2026, SA/NT rules): `vp_venues.number_bingo_on` (boolean, default false)
and the `vp_venues_number_bingo_guard` trigger (a venue's own login cannot set it; same shape as 107). Number bingo (90-ball) is
hidden for SA and NT venues not recorded as a club; this switch, set only from HQ (`/admin/venue-gaming`, audited as
`venue_number_bingo_on` / `_off`), shows it again for a venue whose bingo is run by a not-for-profit. Musical bingo never reads
it. Not security definer, no new policy or grant, so RLS-BASELINE.json does not change. Either order with the Workers is safe
(both read the column fail-safe). Branch `feature/sant-bingo`. NOT RUN. Rollback: in the file.

`venueplay-118-custom-bingo-patterns.sql` (Dean, 24 Oct 2026, after a Drag Bingo show played "any 5 numbers on the card"): a
venue's own NAMED winning patterns for number bingo. New table `vp_bingo_patterns` (venue_id, name 1 to 30 characters, rule
jsonb `{"type":"any","n":1..15}` or `{"type":"shape","cells":[0..26]}`, deleted_at kept so a game playing a deleted pattern is
still judged on it); RLS on with no policy and anon/authenticated revoked (service role only). `vp_bingo_claims.pattern` may
now be 'custom', with `custom_pattern_id` and `custom_pattern` (the name and rule the claim was judged on). Used by the game
Worker `/host/bingo/patterns` (list, any staff), `/save` and `/delete` (owner, or a manager with games rights), and by
VP-DRAW-1.2's claim rule. Either order with the Worker is safe: without the table the list answers available:false and the
console shows no custom option. After running, dump RLS-BASELINE.json (one new locked table). Branch
`feature/custom-bingo-patterns`. RUN on the live database (vp_bingo_patterns exists, 26 Oct 2026). Rollback: in the file.
`venueplay-119-gflam-customers-unsubscribe-source.sql` (Dean, 26 Oct 2026, one-click unsubscribe for Gflam Touring / Drag
Bingo email): `gflam_customers.unsubscribe_source` (text) and a partial index on `unsubscribed_at`. `gflam_customers` itself
was created by hand on 24 Oct 2026 from ~/venue-enrich/oztix/RUN-ME-gflam-customers.sql (not in this folder; RLS on, no
policies, service role only, unchanged here). Run BEFORE the touring-api build carrying `/unsubscribe` (it writes the column).
No grant or policy change, so RLS-BASELINE.json does not change. Branch `feature/gflam-one-click-unsub`. NOT RUN.
Rollback: `alter table public.gflam_customers drop column unsubscribe_source; drop index gflam_customers_unsubscribed_idx;`
(117 is fix/multi-raffle, unmerged; 118 is on main, above.)

`venueplay-121-game-prefs.sql` (Dean, 28 Oct 2026): every game's setup saved for the VENUE in one place.
`vp_venue_settings.game_prefs` (jsonb, not null, default `{}`, an object of at most 20,000 characters) keyed by game
(`bingo`, `trivia`, `musical`, `raffle`, `members`: every console's Basic and Advanced settings since 28 Oct 2026), and `vp_set_game_prefs(venue, game, prefs)`, security definer, which MERGES one
game's keys and leaves the other games alone. Revoked from PUBLIC, anon and authenticated; service role only. Written and
read by the game Worker's `GET` / `POST /host/game-prefs` (verifyHostJwt + requireStaff, any staff role at that venue, a
short list of allowed keys per game, a size cap). Never paid-or-free for the night, unsold tickets or permits. Either order
with the Worker is safe: without it the route answers an error and every console keeps this browser's own choices (trivia and
raffle still read their older trivia_* columns and raffle_template). After running, dump RLS-BASELINE.json (one new security
definer function). Branches `fix/console-banners-28-oct`, `feature/advanced-settings-28-oct`. RUN on the live database by Dean, 28 Oct 2026 (vp_set_game_prefs present; RLS-BASELINE.json dumped).
Rollback: in the file.

`venueplay-122-prospect-terms-first.sql` (Dean, 28 Oct 2026, "Set up a prospect"): `vp_venues.terms_required` (boolean, not
null, default false) and the `vp_venues_terms_required_guard` trigger (a venue's own login cannot change it; same shape as 116).
True only for a venue made by HQ > Set up a prospect (billing Worker `POST /admin/prospect`), which creates the venue with NO
compliance record because nobody read the line to them on a call. While `compliance_accepted_at` is null at such a venue the
console shows the one-time Terms card in place of the game picker (`VP.termsGate`), and the game Worker refuses `/session`, `/host/game`,
`/host/bingo/draw` and the members draw (`terms_first`); the TV keeps its ads. The block lifts by itself when the owner or a
manager accepts (`/account/compliance-accept`). Not security definer, no new policy or grant: RLS-BASELINE.json does not change.
Run BEFORE the billing Worker that carries `/admin/prospect` (it answers "Run migration 122 first" without it); either order is
safe for the game Worker and the console (both read it fail-safe). Branch `feature/prospect-setup-28-oct`. NOT RUN.
Rollback: in the file.

`venueplay-123-one-click-signin.sql` (Dean, 28 Oct 2026, "a link to click that automatically goes to that page"): table
`vp_signin_links` (token_hash = SHA-256 of 32 random bytes, auth_user_id, venue_id, created_at, expires_at at most 15 days on,
used_at). The prospect welcome's "Open your VenuePlay" button carries the raw token in the URL FRAGMENT (`/app/go#t=`), so it is
never sent to Pages or the Worker in a request line; the billing Worker `POST /auth/one-click` marks the row used in ONE
conditional update (`used_at is null and expires_at > now`) and only then mints a Supabase magic-link hash for that login.
RLS on, no policies, revoked from public/anon/authenticated: service role only. Run BEFORE the billing Worker; without it
/admin/prospect still works and the button opens the email sign-in (HQ is told). After running, dump RLS-BASELINE.json (one new
table). Branch `feature/one-click-signin-28-oct`. NOT RUN. Rollback: in the file.

`venueplay-124-prospect-welcome-delay.sql` (Dean, 28 Oct 2026, "an email that goes to the customer... on a delay"): table
`vp_prospect_welcomes` (venue_id, email, Resend's id, send_at, status scheduled|sent|sent_now|cancelled|failed, the SHA-256 of
the sign-in link the email carries, detail = what the email was made from, who set it up and who changed it). HQ > Set up a
prospect books the welcome with Resend (`scheduled_at`, default 90 minutes, 0 to 1440); `/admin/prospect/welcomes`,
`/welcome-cancel` and `/welcome-now` read and change it until its minute, retiring the old link each time. RLS on, no policies,
revoked from public/anon/authenticated: service role only. Run BEFORE the billing Worker; without it the email is still booked
for later and HQ is told it cannot cancel or send it early. After running, dump RLS-BASELINE.json (one new table). Branch
`feature/prospect-v2-28-oct`. RUN, live by 29 Oct 2026 (RLS-BASELINE.json shows the table). Rollback: in the file.

`venueplay-125-prospects-tab.sql` (Dean, 29 Oct 2026, "put the prospects into HQ as a tab ... if they haven't accessed it within
... three days it flags the venue ... so then we can actually give the person a call"): table `vp_prospects` (venue_id primary
key, founding_id, source hq|autopilot, contact_name, email, phone = the number to RING them on (a mobile or a landline; not a
login), auth_user_id, website, call_requested, created_at, created_label, called_at/called_by/called_label/call_note = HQ's
Called mark). Written by the billing Worker's one setup (`vpaProspectSetUp`, HQ's Set up a prospect and `/autopilot/prospect`);
read by `/admin/prospects` and changed by `/admin/prospect/called` (owner or accounts). Signed up is never stored: worked out on
each read from the account record. Backfills every earlier `prospect_set_up` audit row once. RLS on, no policies, revoked from
public/anon/authenticated: service role only. Run BEFORE the billing Worker; without it Set up a prospect still works (HQ is told,
the phone is on the audit row) and the Prospects tab says "Run migration 125". After running, dump RLS-BASELINE.json (one new
table). Branch `feature/prospects-tab`. RUN 29 Oct 2026 (RLS-BASELINE.json dumped after). Rollback: in the file.

`venueplay-126-help-saved-replies.sql` (Dean, 29 Oct 2026, "helpdesk needs to be easier to use with templates we can use to
reply"): table `vp_help_saved_replies` (audience venue|player|partyplay|any, title, body, position, seed_key unique, who changed
it last) and the 13 starter replies, the same rows as SEED in `venueplay/app/vp-helpdesk-hq.js` (tools/test-help-saved-replies.js,
D91, fails if they differ). HQ > Help desk > Saved replies adds, changes, deletes and reorders them through the billing Worker's
`/admin/help/replies/*`; in a ticket, "Use a saved reply" fills {first_name}, {venue}, {ticket_no}, {tv_link}, {party_code}. The
support line may only be in a venue reply (refused on save, and refused on SEND for a player or PartyPlay ticket). RLS on, no
policies, revoked from public/anon/authenticated: service role only. Either order with the Worker is safe: without the table the
list answers `missing` and HQ uses the built-in starter set; saving says to run this first. Seed is `on conflict do nothing`, so
running it twice never overwrites HQ's edits. After running, dump RLS-BASELINE.json (one new table). 125 is left for
feature/prospect-autopilot (built from the same base the same night). Branch `feature/helpdesk-easier`. RUN on the live database by Dean,
29 Oct 2026 (13 saved replies seeded; anon refused with 42501; RLS-BASELINE.json dumped: RLS on, no grants to anon or authenticated).
FROZEN from then: a change to the starter words needs a new migration (the seed is `on conflict do nothing`, so editing 126 changes
nothing live) and the same change to SEED in vp-helpdesk-hq.js. Rollback: in the file.

`venueplay-127-prospect-free-month.sql` (Dean, 29 Oct 2026, phase 2: "a prospect's free month starts at their FIRST SIGN-IN ... at
the end of the free month with no card, PAUSE the account ... Pausing also makes them LOSE whatever deal they had"): columns on
`vp_prospects` (125): first_signin_at, free_month_ends_at (11:59:59pm Brisbane on the 30th day after it), offer_rate (the price
open when they were set up, kept through the month), card_choice/_at (Now or Later at the setup guide's card step),
reminders_sent (jsonb, the days already sent), paused_at, cancelled_at. The billing Worker's hourly sweep
(`vpaProspectReminderSweep`) sends the reminders on day 3, 10, 17, 24, 28, 29 and 30, 8am to 5pm Mon to Fri Brisbane, and
pauses the venue (status suspended, reason free_month_ended; the TV keeps its ads) when the month ends with no card; a pause
drops the offer price, and a card after it switches the venue back on (webhook and sweep). `/account/prospect-start`,
`/account/card-choice`, `/prospect/cancel`. No new table or grant: RLS-BASELINE.json does not change. Run BEFORE the billing
Worker; without it the Worker behaves as before (no month starts, no reminders, no pause). Branch `feature/prospects-tab`.
RUN 29 Oct 2026 by Dean, read back after. Rollback: in the file.
