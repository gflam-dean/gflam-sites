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

`venueplay-117-multi-raffle.sql` (Dean, 24 Oct 2026: "Absolutely" to more than one raffle a venue): `vp_venue_screen.raffles`
(jsonb list of { id, label, day, time }, default '[]', backfilled from the single routine in `raffle`, which stays and is
mirrored to the first raffle by the billing Worker) and `vp_raffle_prizes.raffle_id` (which raffle a usual prize is for; null
is a prize from before, shown under the first raffle). No new table, policy, grant or function, so RLS-BASELINE.json does not
change; the screen history trigger (114) records the new column with the rest of the row. Either order with the Workers is safe:
both read `raffles` on a query of its own and fall back to the single routine; a raffles save before it is run is refused with
"run migration 117 first". Branch `fix/multi-raffle`, brought onto main as `fix/multi-raffle-8nov` (5 Nov 2026) with its number kept: it is already in the live database. RUN by Dean 26 Oct 2026. Rollback: in the file.

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
No grant or policy change, so RLS-BASELINE.json does not change. Branch `feature/gflam-one-click-unsub`, released on the
unsubscribe train (train/unsub-27-oct). RUN on the live database: the 28 Oct unsubscribe audit found it live, and on 3 Nov 2026
`gflam_customers?select=unsubscribe_source` answered 200 to the service key (one transaction, so the index came with it).
Rollback: `alter table public.gflam_customers drop column unsubscribe_source; drop index gflam_customers_unsubscribed_idx;`
(117 is multi-raffle and 118 is custom patterns, both above.)

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
(`vpaProspectReminderSweep`) sends the reminders on day 3, 23 and 29 (three, since 30 Oct 2026; it was day 3, 10, 17, 24, 28, 29 and 30), Mon to Fri 9am to 12 noon and 2pm to 5pm in the venue's local time (Dean's send window, 7 Nov 2026; it was 8am to 5pm Brisbane), and
pauses the venue (status suspended, reason free_month_ended; the TV keeps its ads) when the month ends with no card; a pause
drops the offer price, and a card after it switches the venue back on (webhook and sweep). `/account/prospect-start`,
`/account/card-choice`, `/prospect/cancel`. No new table or grant: RLS-BASELINE.json does not change. Run BEFORE the billing
Worker; without it the Worker behaves as before (no month starts, no reminders, no pause). Branch `feature/prospects-tab`.
RUN 29 Oct 2026 by Dean, read back after. Rollback: in the file.

`venueplay-128-autopilot-review-buttons.sql` (Dean, 29 Oct 2026, "can they just have a button to say yes no or edit maybe? I
can't copy and paste a command every time"): table `vp_autopilot_reviews` (folder primary key = the prospect folder on Dean's
Mac, round, company, class, their_words, reply, mailbox, reply_to, expires_at, decision yes|no|edit set once per round,
decided_at, decided_agent, reason, edited_reply, applied_at / applied_result / applied_note set once). The Mac registers each
review (`POST /autopilot/review/register`, X-Autopilot-Key) and emails Dean three signed links (HMAC with PROSPECT_AUTOPILOT_KEY
over folder, action, expiry and round; 7 days). `GET /autopilot/review` shows the page and never writes; its POST records the
choice. The Mac reads `GET /autopilot/decisions`, applies each with its own approve()/reject(), then `POST /autopilot/decisions/done`.
RLS on, no policies, revoked from public/anon/authenticated: service role only. Run BEFORE the billing Worker; without it the
Mac falls back to the plain review with the command line. After running, dump RLS-BASELINE.json (one new table). Branch
`feature/review-buttons`. RUN 30 Oct 2026 by Dean (read back: service 200, anon refused). Rollback: in the file.

`venueplay-129-help-ticket-lead-fields.sql` (Dean's phone test, 29 Oct 2026: the "Bring VenuePlay to your venue" form must
name the venue so a later job can set it up as a prospect): four nullable columns on `vp_help_tickets`, `lead_venue_name`
(<= 120), `lead_locality` (suburb or postcode, <= 80), `lead_website` (<= 200), written on VenuePlay sales tickets, and
`venue_matched_by` ('room' | 'code' | 'name'), how a PUBLIC ticket's venue_id was found by the billing Worker's soft match
(`helpMatchVenue`: a join or live code, or a whole name with the suburb or postcode when several share it; one venue or
none). One partial index for the sales leads. No new table, policy or grant, so RLS-BASELINE.json does not change. Run BEFORE
the billing Worker; without it the Worker retries the insert without the four fields (the venue, suburb and website are also in
the message), so no enquiry is lost. Branch `fix/site-mobile-sales-29oct`. RUN 30 Oct 2026 by Dean (read back: the four columns answer 200). Rollback: in the file.

`venueplay-130-review-edit-boxes.sql` (Dean, 30 Oct 2026, after the Sarah end-to-end test: the review email told him to type
"--postcode NNNN" and "--club"): four nullable columns on `vp_autopilot_reviews`, `details` (jsonb object <= 20,000: what the
Mac found, postcode, state, entity_type, login_email, its recommendation "yes" or "edit" with a reason, and its plain-words
warnings), and Dean's Edit page boxes `edited_postcode` (4 digits), `edited_entity_type` (for_profit | non_profit) and
`edited_login_email`. No new table, policy or grant, so RLS-BASELINE.json does not change. Run BEFORE the billing Worker;
without it the Worker retries every write and read without the four (no boxes on the Edit page, no recommendation on the
pages), so the buttons keep working as before. Branch `feature/review-email-v2-30oct`. RUN 30 Oct 2026 by Dean (read back: the four columns answer 200, anon still refused). Rollback: in the file.

`venueplay-131-help-faq-tv-app.sql` (Dean, 31 Oct 2026, "If you have a TV with a Google play store you can download our app...
It's called VenuePlay TV"): the venue Help answer "Setting up the TV" gets one new first line, "Got a TV with Google Play?
Download the VenuePlay TV app and put in your screen code. Otherwise open venueplay.com.au/tv in the TV's web browser."
Every word migration 120 wrote stays after it. One update, guarded on 120's words, so it does nothing if the answer was
edited in HQ, and it must run AFTER `venueplay-120-help-faq-tv-window.sql` (if 120 has not been run, run 120 first, then
this). Words only, no new table, policy or grant, so RLS-BASELINE.json does not change; any order with the Workers and the
site. Branch `feature/tv-landing-31oct`. RUN 31 Oct 2026 by Dean (read back: the answer starts with the Google Play line, updated_by migration 131). Migration 120 was already live. Rollback: in the file.

`venueplay-132-one-trip-join-context.sql` (31 Oct 2026, step 4 of the 12 Sep plan for 1,000+ venues: the join made
cheaper): one read-only function, `vp_join_context(p_code text, p_device text)`, returning in ONE call what POST /join
read in six (the open session for the code, the venue's status, group and slug, the group's status, the six collect
switches, the phone's earliest not-kicked row, the running games). It decides nothing: every refusal, the collection gate
and the dedup stay in the game Worker, on its rows, in the same words. Security definer, service role only (anon and
authenticated revoked). A new join goes from 8 database calls to 4, a re-join from 7 to 3. Any order with the Worker: without
it the Worker gets a 404 once per isolate and joins the old way. After running it, re-dump the baseline
(`python3 venueplay-backend/tools/dump-rls-baseline.py`) and commit RLS-BASELINE.json, which gains this function with anon
and authenticated both false. Branch `fix/join-cache-31oct`. NOT RUN. Rollback: in the file.
`venueplay-133-monthly-news.sql` (Dean, 31 Oct 2026: one routine email a month to a venue, "link that with our newsletter"):
one new table `vp_monthly_news` (month text primary key 'YYYY-MM', items jsonb array of at most four {title, text, link},
ready boolean, updated_at, updated_by), the "What's new at VenuePlay" words HQ writes once a month in HQ > Reports and the
monthly report email carries under each venue's own numbers. Keyed by the REPORT month ('2026-10' goes out on 1 November).
RLS on, no policies, revoked from public/anon/authenticated: service role only. Any order with the billing Worker: without
it HQ's Save answers "migration 133" and the report goes out without news. After running, dump RLS-BASELINE.json (one new
table). Branch `feature/venue-reports-31oct`. NOT RUN. Rollback: in the file.

`venueplay-135-screen-shows.sql` (Dean, 30 to 31 Oct 2026: "can we tell how much advertising is displayed", with no extra
database call at peak): one new table `vp_screen_shows` (venue_id, night, screen_id, slide_key, shows, seconds; primary key on
the first four) and one new definer function `vp_screen_poll_shown(p_slug, p_code, p_version, p_shown jsonb)`, which returns
exactly what `vp_screen_poll` (migration 72) returns and keeps the TV's running slide totals for tonight in the same call
(greatest of what it had and what came; tonight or last night on the venue's clock; at most 40 slides a call and 12 screens a
venue a night; its own exception block, so a bad tally never costs a screen its answer). Service role only. Any order with
the game Worker and tv.html: without it the Worker gets a 404, falls back to `vp_screen_poll` in the same request and stops
asking, and the monthly report says slides are not counted yet. After running, dump RLS-BASELINE.json (one table, one
function). tv.html changed, so `python3 tools/verify-live.py --stamp` after the release. Branch `feature/venue-reports-31oct`.
NOT RUN. Rollback: in the file.

`venueplay-136-month-reports-stored.sql` (Dean, 31 Oct 2026: HQ Reports shows "a stored copy made on the 1st" so opening HQ
during a game night never reads 13 months of every venue): one new table `vp_month_reports` (month text primary key, data jsonb,
made_at, made_by), written by the billing Worker's scheduled run between 2am and 7am Brisbane on the 1st and by HQ's
"Refresh this month" (owner or accounts). Service role only. Any order with the billing Worker: without it HQ says the stored
copy needs migration 136 and Refresh works the month out without keeping it. After running, dump RLS-BASELINE.json (one
table). Branch `feature/venue-reports-31oct`. NOT RUN. Rollback: in the file.
`venueplay-134-subscribers.sql` (31 Oct 2026, the "too scared to call us" sign-up): one new table `vp_subscribers` (email once,
lower case; venue name as typed, optional; source page; utm; the consent words and version; consent_at; country and AU state
from Cloudflare, never an IP; status active | held; confirm_sent_at; unsubscribed_at = the latest opt-out; resubscribed_at),
a new column `vp_unsubscribes.last_unsubscribed_at`, a BEFORE INSERT trigger on `vp_unsubscribes` that stamps the
subscriber's unsubscribed_at and, for an address already on the list, writes the repeat's date on the first row and skips the
duplicate (errors swallowed, so it can never stop an opt-out; a repeat now answers 201 instead of 409, both treated as done),
and the read-only view `v_vp_subscribers_monthly`. Dean, 31 Oct 2026: someone who unsubscribed and signs up again is back on;
they get the monthly email only while consent_at is later than their latest opt-out, and every other check still leaves them out. RLS on, no policies, anon and authenticated revoked; the trigger function is security
definer with its own search_path. Either order with the billing Worker: until it is run, POST /subscribe answers not ready and
keeps nothing, HQ > Subscribers says run it. After running: dump RLS-BASELINE.json. Branch `feature/vp-subscribers-31oct`.
NOT RUN. Rollback: in the file.

`venueplay-137-feedback-notes.sql` (Dean, 1 Nov 2026: every "How was that?" rating on a phone gets one short follow-up):
one new table `vp_feedback_notes`, HQ's only (one row per rating in `vp_game_feedback`, unique feedback_id; venue, session,
game, format, rating, up to six tags, a line of up to 300 characters, wants_reply, the help-desk ticket it made if any).
Never an email: a consented email goes only into a help-desk ticket. No name and no "share" column: Dean, 2 Nov 2026, removed
the ticks; a venue sees only counts of "Loved it" and "Good", read from `vp_game_feedback` (migration 60), which needs no new
column. It also widens `vp_help_push_subs.filter` to allow 'bad_feedback' ("Only bad player feedback" alerts). Service role
only (RLS on, no policies, anon/authenticated revoked). Any order with the billing Worker: until it is run, POST /help/feedback
keeps the rating and answers `missing: true` for the words, and HQ's /admin/feedback says the notes table is not there.
Built on `feature/player-screens-2nov`, approved by Dean 1 and 2 Nov 2026 on `release/tue-3nov`, which never reached main;
brought back on `fix/recover-3nov-10nov` (6 Nov 2026). STATUS: LIVE. RLS-BASELINE.json, dumped read-only from live on
3 Nov 2026 (commit 1ee4cbd7), records `vp_feedback_notes`, and the 3 Nov job list has Dean running 137. Which revision of the
file ran is not recorded; the Worker copes either way (it never writes the removed columns, and keeps a device on 'all' if
the filter check refuses 'bad_feedback'). DO NOT RUN AGAIN: migration 144 (`feature/help-alerts-by-team-2nov`) widens the
same filter check further, and 137 run after it would narrow it back. Read-back (read-only) in the file.

`venueplay-138-help-faq-lowercase-name.sql` (Dean, 1 Nov 2026: the name is "venueplay", lowercase, in all customer text): two
Help answers that live only in the database get the name in lowercase, one word each. The venue answer "Setting up the TV"
(row 67840db0, written by 131) reads "Download the venueplay TV app", every other word 131 wrote unchanged; the player answer
"Who gives out the prizes?" (row 2717ff1f, seeded by 106) reads "venueplay supplies the game software only". Each update is
guarded on the exact words it replaces, so an answer Dean has edited in HQ is left alone; run AFTER 131. The same words are in
`venueplay/data/help-faq.json` (tools/help-seed-matches-faq.test.py and tools/tv-app-setup-line.test.py hold them together).
Words only, no new table, policy or grant, so RLS-BASELINE.json does not change; any order with the Workers and the site.
The help desk's saved replies (126) still say "VenuePlay". Branch `feature/lowercase-legal-2nov`. NOT RUN. Rollback: in the file.

`venueplay-139-screen-devices.sql` (Dean, 1 Nov 2026: "we do not know what TVs our venues use"): one new table
`vp_screen_devices` (venue_id, device_id, kind, first_seen_at, last_seen_at; primary key on the first two) and one new
definer function `vp_screen_poll_kind(p_slug, p_code, p_version, p_kind, p_device)`, which returns exactly what
`vp_screen_poll` (migration 72) returns and keeps the TV's coarse type code (from `venueplay/app/vp-tvtype.js`, never the
user agent) and its random device id in the same call. The TV sends it once per page load, never on the same poll as the
slide tally of 135. Bounds: code and id shapes checked, at most 20 recent screens a venue, rows unseen for 180 days
cleared, its own exception block. anon nothing; authenticated SELECT with one policy, `vp_is_platform_admin()`, so only
HQ reads it; the function is service role only; a self-check refuses to commit otherwise. Any order with the game Worker
and tv.html: without it the Worker gets a 404, falls back to `vp_screen_poll` in the same request and stops asking, and HQ
says TV types start when 139 is run. After running, dump RLS-BASELINE.json (one table, one policy, one function).
NUMBER: written as 138 on 1 Nov, renumbered 139 when merged into release/mon-2nov (138 is the help-FAQ lowercase
migration above; 137 stays spent by the end-screen ratings work).
Branch `feature/tv-type-2nov`. NOT RUN. Rollback: in the file.

`venueplay-148-review-photos-decision.sql` (Dean, 3 Nov 2026: a prospect whose TV slides came back with no real photos, only
drawn icons, is "escalated to social media" with a button): the check on `vp_autopilot_reviews.decision` (128) also allows
'photos', so the review's fourth signed link, "Get photos from their socials", records like Yes / Edit / No, once per round.
The Mac holds the reply, writes a job for Claude to pick the venue's own photos from their Facebook or Instagram, rebuilds the
slides and sends the review again in a new round. No new table, column, policy or grant, so RLS-BASELINE.json does not change.
Either order with the billing Worker: before it runs the photos page says "not switched on yet" and records nothing; the other
buttons are unchanged. NUMBER: 140 to 147 are taken on other branches, so 148. Branch `feature/social-photos-3nov`. NOT RUN.
Rollback: in the file.

`venueplay-149-review-needs-you-decisions.sql` (Dean, 3 Nov 2026, on the plain "reply needs you" email about a help desk
auto-reply: "Has no options that help"): the check on `vp_autopilot_reviews.decision` (128) also allows 'stop', 'draft'
and 'ignore', so a reply that needs Dean comes as its own email with "Stop them (not a venue)", "Draft me a reply" and
"Ignore", recorded like Yes / Edit / No, once per round (a row of class 'needs you'). It keeps 'photos' (148). Run 148
BEFORE 149: 148 re-creates the check without the three new values. No new table, column, policy or grant, so
RLS-BASELINE.json does not change. Either order with the billing Worker: before it runs the needs-you pages say "not
switched on yet" and record nothing; the other buttons are unchanged. NUMBER: 140 to 148 are taken on other branches,
so 149. Branch `fix/autopilot-needs-you-buttons-3nov`. NOT RUN. Rollback: in the file.

`venueplay-150-prizes-unvalued-count.sql` (Dean, 3 Nov 2026: "$800 given away in prizes" left things out): adds ONE column
at the end of `v_vp_prizes_given`, `unvalued_given_count`, the raffle wins given with no dollar value typed and no jackpot (a
meat tray). Every existing column is unchanged row for row (the view's live definition, read back 3 Nov 2026, is the first
two branches). security_invoker, the authenticated grant and the anon revoke are put back exactly as 85 left them, so
RLS-BASELINE.json does not change. Either order with the site: Your account > Draws reads the new column when it is there and
says "not counted here" when it is not. NUMBER: 140 to 149 are taken on other branches, so 150. Branch `fix/console-hq-5nov`.
RUN live by Dean, Thu 5 Nov 2026 (read back OK, 20:50). Read-back queries in the file.

`venueplay-151-prospect-link-30-days.sql` (Dean, 4 Nov 2026, the two prospect journeys): lifts `vp_signin_links_life` from
15 to 31 days so a prospect's sign-in link can end 30 days from setup, the same moment every link resent to them ends at,
and the day-3 and "expires in 3 days" follow-ups say one true number; and adds `vp_prospects.link_from`, when HQ last
resent their link, which restarts those 30 days and re-dates the follow-ups (automatic follow-ups never set it). No policy
or grant changes, so RLS-BASELINE.json does not change. Either order with the billing Worker: before it runs the Worker makes the 14 day link
and prints the days that link really has. NUMBER: 140 to 150 are taken, so 151. Branch `fix/console-hq-5nov`. RUN live by Dean, Thu 5 Nov 2026 (read back OK, 20:50).
Read-back and rollback in the file.

`venueplay-160-left-accounts-90-day-clock.sql` (Dean, 5 Nov 2026, INBOX item 33, the account after a venue leaves): starts
the 90-day retention clock (`vp_venues.closed_at`) for prospects that had ALREADY left by cancelling or by being paused when
their free month ran out with no card, from the moment they left (`vp_prospects.cancelled_at` or `paused_at`), never from
today and never for a venue that is back on. The Worker change on the same branch stamps it for new ones, clears it when a
card brings a paused prospect back, and the sweep now includes `free_month_ended`. Data only: no table, column, policy or
grant, so RLS-BASELINE.json does not change. Either order with the Workers. NUMBER: 152 to 154 are on other branches and
tonight's agents take 155 onwards, so 160 (renumber at merge if taken). Branch `fix/account-review-8nov`. NOT RUN.
Read-back and rollback in the file. Dean, 5 Nov 2026 (INBOX item 54): player details deleted after 90 days, the venue's OWN details
kept and hidden, never deleted; the file now also re-comments `player_data_purged_at` as the HELD marker the rejoin flow will read.

`venueplay-164-host-updates-optin.sql` (Dean, 5 Nov 2026, INBOX item 21a, host sign-in asks for an email for product
updates): one new table, `vp_host_updates_optin`, one row per login (auth_user_id): email, opted_in (default false),
consent_at, consent_text (the exact tick wording), source ('host-sign-in'), asked_at (so a host who skips is asked at most
once every 30 days) and updated_at. A check keeps an email only with a tick. RLS on, no policies, revoked from anon and
authenticated: only the billing Worker's service role reaches it. Unsubscribes stay in `vp_unsubscribes`. RLS-BASELINE.json
CHANGES (one new table): after it is run, re-dump it with `python3 venueplay-backend/tools/dump-rls-baseline.py` and
commit (NEEDS DEAN). Either order with the billing Worker: before it runs, /account/updates-ask answers {ask:false} and the
console shows nothing. NUMBER: 152 to 154 are on other branches, tonight's agents take 155 onwards and 160 is on this
branch, so 164 (renumber at merge if taken). Branch `fix/host-updates-optin-8nov`. NOT RUN. Read-back and rollback in the file.
 NUMBER CLASH NOTE: first written as 161, renumbered 164 because 161 is the venue rating (fix/venue-rating-8nov).

`venueplay-162-help-faq-offer-grace.sql` (Dean, 5 Nov 2026, THE 5-DAY OFFER GRACE): words only. The help FAQ's "Billing and
players" answer (vp_help_faq, id d3a64ff4-...) now says a free month that ends with no card pauses the games, and a card
switches them back on. The 5-day grace is NOT announced (Dean, 5 Nov 2026, builds INBOX 55c; changed on fix/self-serve-restart-10nov).
REWRITTEN 11 Nov 2026 (INBOX 246, fix/migration-162-15nov): the first version guarded on migration 106's words, but 113 had
rewritten the answer on 22 Oct, so it would have been a silent no-op. It now guards on 113's words (the live words, read back
11 Nov), APPENDS Dean's approved sentence, and a DO block RAISES if the live answer is neither 113's words nor the finished
words. Running it twice appends once. check-migrations-live.py now compares a guarded update's guard with the live row. The grace itself needs NO column or table
(the Worker counts five days from vp_prospects.free_month_ends_at, migration 127), and no Worker waits for this file. No
policy or grant changes, so RLS-BASELINE.json does not change. NUMBER: 162 given by the main session (153 live-here-now, 155
security, 160 account-review, 161 venue rating). Branch `fix/offer-grace-10nov`. NOT RUN. Read-back and rollback in the file.

`venueplay-152-signin-texts-queue.sql` (Dean, 4 Nov 2026, HQ > Prospects: "Send them a new sign-in link" goes by email AND
text when we have a mobile): one new table, `vp_signin_texts`, the texts HQ asked for outside 9am to 8pm Brisbane (or on a
Sunday), queued for the next allowed time and sent by the billing Worker's hourly trigger, which makes the one-use link at
that moment (no token is ever stored here). Row security on, service role only. RLS-BASELINE.json gains one table: rerun
venueplay-backend/tools/dump-rls-baseline.py after running and commit it. Either order with the billing Worker: before it
runs nothing is queued, the email still goes, and HQ is told no text was queued and to press again after 9am. Texts stay
off until PROSPECT_SMS_ON and the ClickSend login are set, either way. NUMBER: 140 to 151 are taken, so 152. Branch
`fix/hq-prospects-6nov`. RUN live by Dean, Thu 5 Nov 2026 (read back OK, 20:50). Read-back and rollback in the file.

RUN LIVE, Thu 5 Nov 2026 (Dean, read back OK by 20:50): 150, 151, 152, 154 and 161. 154 (`venueplay-154-prospect-details.sql`, branch `fix/prospect-details-10nov`) and 161 (`venueplay-161-venue-ratings.sql`, branch `fix/venue-rating-8nov`) are not in the 6 Nov release: their files and entries come with those branches, and both numbers are TAKEN. RLS-BASELINE.json was dumped after all five (152 and 161 each add one table, RLS on, service role only) and committed with the 6 Nov release.

RUN LIVE, confirmed Fri 6 Nov 2026: 150, 151, 152, 154, 161, 163, 166, 167, 170, 171 and 172 (all of these are live; their files and entries come with their own branches where not yet on main). 162 (this branch) and 169 (trivia library swap) are NOT RUN.

`venueplay-156-saved-reply-lowercase-name.sql` (Dean, 1 and 4 Nov 2026: "venueplay" lowercase in all customer text): one
word in one help desk saved reply, seed_key 'player-prize' ("venueplay supplies the game software only"), only if it still
holds the words 126 seeded (an HQ edit is left alone). fix/site-polish-6nov lowercased the built-in starter set in
vp-helpdesk-hq.js; this brings the live row into line, and tools/test-help-saved-replies.js applies 126 then 156 before
comparing. No table, policy or grant, so RLS-BASELINE.json does not change. Either order with the site and Workers (HQ shows
the live row's words until it runs). NUMBER: 150 to 154 and 160 to 169 are taken and 155 is the security fix, so 156
(release/6nov, 5 Nov 2026). NOT RUN. Optional at the gate, on Dean's yes. Read-back and rollback in the file.
`venueplay-163-setup-answers.sql` (Dean, 5 Nov 2026, INBOX 44a and 46, the first sign-in setup wizard): adds ONE column,
`vp_venue_settings.setup_answers` (jsonb object, 2,000 characters at most), holding what a new venue tells the wizard: how
many TVs, which nights it runs games, which games it plays, and that its name is right. The page writes it with its own
`VP.saveSettings`, which the existing owner and manager policies (migration 77) already allow, so there is no new policy,
grant or function and RLS-BASELINE.json does not change. Either order with the site: before it runs, the wizard keeps the
answers on the device and says nothing, and the Account page card shows nothing. NUMBER: 160 to 162 are taken on other
branches, so 163 (Dean's number). Branch `fix/first-run-guide-10nov`. RUN LIVE (see the RUN LIVE line for 163, 166, 167, 170, 171, 172 above). Read-back and rollback in the file.

`venueplay-170-signup-starts.sql` (Dean, 5 Nov 2026, INBOX 80B and 81 as changed by 97: the no-card start, "Have a play for
free" on /offer-nov): ONE new table, `vp_signup_starts`, one row per sign-up attempt holding the five boxes and the text code's
HASH (never the code), and what came of it (pending, made, held_unlisted, held_known, approved, refused). Not an account:
nothing is made from a row until the code to THEIR mobile passes. RLS on, service role only. Also lets `vp_prospects.source`
say 'self'. Before it runs, /start/* answers "not switched on yet" (503) and makes nothing. NUMBER: 166 and 167 are prospect
details, 168 is reserved, 169 is the library questions, so 170. Branch `fix/signup-core-10nov`. RUN on the live database 6 Nov 2026 (Dean; read back OK, vp_prospects_source_check is hq/autopilot/self). (A copy on the
parked branch `fix/same-pub-later` has extra columns for item 61, known_login_id and code_to; this one does not, and that
branch must renumber or reconcile before it is ever picked up.)

`venueplay-171-licensed-venues.sql` (Dean, 5 Nov 2026, INBOX 81: "stop fake sign-ups getting a free month"): ONE new table,
`vp_licensed_venues`, our licensed venues keyed by the one matcher (vpVenueKey) and postcode, for the no-card start's check.
The rows are NOT in the migration: `python3 tools/build-licensed-venues.py --sql OUT.sql` writes them from the two files on
the Mac (~/venue-enrich/venueplay-SEND-pubs-and-clubs.csv and ~/venue-enrich/partyplay-fit-2026-10-27/master.csv, the
state registers), 32,415 name and postcode rows on 6 Nov 2026. Missing or empty, every start is held for HQ (the safe way
round). RLS on, service role only. NUMBER: 171 (172 is the try-it demo's, `fix/try-demo-10nov`). Branch
`fix/signup-core-10nov`. RUN on the live database 6 Nov 2026 (Dean; read back OK). Its ROWS are not loaded yet (the load file is in the branch's NOTES).

`venueplay-173-signup-starts-pub-or-club.sql` (Dean, 6 Nov 2026: ask pub or club at the no-card start): ONE nullable column,
`vp_signup_starts.entity_type` ('for_profit' or 'non_profit'), so a sign-up HQ approves later keeps the answer. The venue's
own entity_type is set when the account is made either way. 170 and 171 unchanged. Before it runs, the start still works.
NUMBER: 172 is the try-it demo's, so 173. Branch `fix/signup-core-10nov`. NOT RUN. Run after 170.

`venueplay-172-demo-sessions.sql` (Dean, 5 Nov 2026, INBOX 82 and 84b: the try-it demo is never billed): ONE new column,
`vp_sessions.is_demo boolean not null default false`, and a small partial index. Written once by the game Worker at
POST /session {demo:true}; honoured by chargeNightOverage (no charge, no streak change), the overage ask, the once-a-week
trivia check and stamp, vp_asked_questions, saved trivia prefs, metering, group overage and the billing Worker's stats
reads (VPA_NOT_DEMO). A demo's players stay on its venue's opt-in list and in the privacy paths on purpose. RUN IT BEFORE
deploying either Worker from this branch: their reads filter is_demo=not.is.true, which PostgREST refuses while the column
is missing. Additive; every existing row reads false. NUMBER: 172. Branch `fix/try-demo-10nov`. RUN LIVE (see the RUN LIVE line above).

`venueplay-169-library-questions-read-only.sql` (Dean, 5 Nov 2026, items 45c and 75d): a venue can no longer edit or delete a copy of a library question straight through the database, and can no longer set its own question set to the library. Adds `vp_questions.from_library` (backfilled for every existing copy by exact words, the Worker's own rule), replaces `vp_questions_host_write` (a venue writes only the questions it created) and `vp_question_sets_host_write` (a venue's own set must be `private`). Library reads, swap and remove are unchanged (the Worker uses the service key). Either order with the Worker. RLS-BASELINE.json policy TEXT changes: re-dump it after this runs. NUMBER: 169 is Dean's. Branch `fix/trivia-library-swap-10nov`. NOT RUN. Read-back and rollback in the file.

`venueplay-174-optin-consent-version.sql` (Dean, 6 Nov 2026, the "Get a heads up by email" sign-up on the phone with no
game on): two columns, `vp_players.consent_version` and `vp_captures.consent_version` (text, 20 characters at most), the
version of the offers + 18+ consent words the person ticked (VPConsent.VERSION). No new policy, grant or function, so
RLS-BASELINE.json does not change. Either order with the game Worker: before it runs, /join/list stores the sign-up
without the version. NUMBER: 174 (the coordinator's number, 6 Nov 2026). Branch `fix/trivia-live-fixes-6nov`. NOT RUN.
Read-back and rollback in the file.

`venueplay-141-subscriber-postcode.sql` (Dean, 2 Nov 2026: the monthly email sign-up asks for the venue's name and
postcode, needed, "so offers can be sent by state. We won't send a Queensland offer to a NSW venue"): two new columns on
134's `vp_subscribers`, `postcode` (4 digits, checked) and `au_state` (ACT | NSW | NT | QLD | SA | TAS | VIC | WA, checked,
indexed), the state worked out by the billing Worker from the postcode with `vpaStateFromPostcode`, and 134's view
`v_vp_subscribers_monthly` recreated with the two columns added at the end. Guarded: does nothing (with a notice) if 134 has
not been run, so run 134 first. Columns only, no new table, policy or grant: RLS-BASELINE.json records views by name, so a
re-dump after running shows no change from this one (134's own additions aside). Either order with the billing Worker:
before it is run, every write naming the columns is retried without them, so sign-ups are kept with no postcode and HQ
shows "No postcode". NUMBER: 137 to 139 spent, 140 earmarked for the help saved-reply lowercase fix, checked every branch
and worktree 2 Nov 2026. Branch `fix/signup-postcode-2nov`. NOT RUN. Rollback: in the file.
Brought back 6 Nov 2026 on `fix/recover-3nov-10nov` for the Tue 10 Nov release (Dean's yes); 134 is live (RLS-BASELINE.json
lists `vp_subscribers` and `v_vp_subscribers_monthly`). Still NOT RUN: run it before or with the billing Worker that carries it.

`venueplay-175-prospect-one-signin-link.sql` (Dean, 6 Nov 2026, ONE sign-in link per prospect): two columns,
`vp_prospects.signin_code_enc` (the short letters, sealed) and `vp_prospects.signin_code_hash`. The short link
venueplay.com.au/s/XXXXXXXXXXXX is never a login key: it opens the normal text-code sign-in with their mobile filled in, so
the welcome, the reply in their thread, every follow-up email and text and HQ's Resend all carry the same link with the same
end; only HQ's "Start a fresh 30 days" makes a new one. No table, policy, grant or function, so RLS-BASELINE.json does not
change. Either order with the billing Worker (before it, each send makes its own link as today). NUMBER: 175 (the main
session's; 173 is fix/signup-core-10nov's). Branch `fix/signin-thread-10nov`. NOT RUN. Read-back and rollback in the file.

`venueplay-177-whats-on.sql` (Dean, 6 Nov 2026, INBOX 110, the venue's own "What's on" guide, promised to Revolver
Upstairs for the Thu 12 Nov release): ONE column, `vp_venue_screen.events` (jsonb list, at most 60 entries and 40,000
characters; the billing Worker keeps 30 upcoming), plus one 'baseline' row per screen in `vp_venue_screen_history` so
migration 114's nightly check does not report every venue as drift because of the new key. Chosen over a new
vp_venue_events table: the TV's /screen and the phones' /join/info already read this row, 114 already records every
change to it, and it is already Worker-only (RLS on, no grant to anon or authenticated), so no new policy, grant or
function and RLS-BASELINE.json does not change. Either order with the Workers: before it runs the billing Worker answers
events_off (the account page says What's on is being switched on) and the game Worker asks again without the column (no
events on the TV or phones). NUMBER: 177 (the coordinator's number, 6 Nov 2026; 176 and below are taken). Branch
`feature/whats-on-12nov`. NOT RUN. Read-back and rollback in the file.

`venueplay-185-signin-link-90-days.sql` (Dean, 10 Nov 2026, INBOX 154: every one-tap sign-in link lasts 90 days from issue,
"because that's when we delete the data"): lifts `vp_signin_links_life` from 31 to 92 days (90, plus a day for a welcome
booked ahead, plus one spare), and gives every link already issued and still unused (used_at is null; retired links carry
used_at, so they stay dead) 90 days from its own created_at, unless those 90 days have already passed. The billing Worker's
`VPA_LINK_DAYS` is the one number; a prospect's window is worked out from it on every read, so needs nothing here. No policy
or grant changes, so RLS-BASELINE.json does not change. Either order with the billing Worker: before it runs the Worker is
refused the 90 day row and makes a 30 day link, printing the days that link really has. NUMBER: 180 to 184 taken (183 was
spoken for by an uncommitted link-life change), so 185. Branch `fix/link-90-days-15nov`. NOT RUN. Read-back and rollback in the file.

`venueplay-181-hosted-by.sql` (Dean, 6 Nov 2026, INBOX 120, "Hosted by" on the TV with the host's logo): one new table,
`vp_host_brands`, the Hosted by card per host LOGIN (name, 1 to 40 characters, and a logo in the venue-logos bucket under
hosts/<login>/), so it follows the host to every venue they run; RLS on, no policy, anon and authenticated grants revoked,
written only by the billing Worker. And ONE column, `vp_venue_staff.hosted_by` (jsonb, e.g. {"trivia":true,"musical":false}),
each venue's own switch per game on that host's staff row there. No existing policy, grant or function changes.
RLS-BASELINE.json gains one table: rerun venueplay-backend/tools/dump-rls-baseline.py after running and commit it. Either order
with the Workers and the site: before it runs the game Worker's /host/hosted-by answers "nothing to show", the TV shows no
line, and an owner's save on Account > People is told the feature is not switched on yet. NUMBER: 177 to 180 are taken, so
181. Branch `fix/hosted-by-12nov`. NOT RUN. Read-back and rollback in the file.

`venueplay-186-musical-any-line.sql` (Dean, 11 Nov 2026, INBOX 256: musical bingo "Any line", a full row, column or
diagonal, is the DEFAULT FOR NEW VENUES; existing venues keep theirs): (1) a snapshot table `vp_backup_186_game_prefs`
(every venue's game_prefs and whether it had a settings row; RLS on, nothing granted), (2) every venue with no saved
musical pattern gets `game_prefs.musical.pattern = 'one'` written explicitly (the pattern the console started on until
now; the same one-key merge as vp_set_game_prefs; a saved pattern is never touched), (3) `vp_music_games.pattern`
accepts 'any_line' (a CHECK naming pattern is replaced with one that includes it; an enum gets the value; neither, no
change). RUN IT BEFORE deploying the game Worker and the musical pages from this branch: the new console starts on Any
line for a venue with nothing saved. Early is safe (the live code never sends 'any_line'). RLS-BASELINE.json: one new
table, re-dump after. NUMBER: 181, 184, 185 live or taken, 183 spoken for, checked every branch and worktree 11 Nov 2026,
so 186. Branch `fix/any-line-15nov`. NOT RUN. Read-back and rollback in the file.

`venueplay-191-draw-looks-every-venue.sql` (Dean, 12 Nov 2026, INBOX 284: every venue on the new draw looks, his explicit
exception to "defaults never move existing venues" for the draw look only): (1) a snapshot table `vp_backup_191_draw_looks`
(every venue's game_prefs and whether it had a settings row; RLS on, nothing granted; taken once), (2) a guard that stops the
whole migration if any venue has no snapshot row, (3) `game_prefs.raffle.draw_style = 'ticket'` wherever it is not already
'ticket' or 'race', (4) `game_prefs.members.draw_style = 'flip'` wherever it is not already 'flip' or 'race' (an explicit
RACE PLATE is kept; only that one key per game moves, draw_time and everything else stay), (5) a venue with no settings row
gets one holding only the two looks. One transaction. ANY ORDER with the site from `fix/draw-looks-switch-12nov` (the game
Worker does not change: it already accepts ticket/flip/race; after the site ships a stored '' is the new look anyway). Run it
only on Dean's yes, after `python3 tools/draw-looks-snapshot.py --live` has written the dated CSV + JSON. Rollback:
`ROLLBACK-draw-looks-191.sql` (not numbered on purpose; puts the two looks back from the snapshot where they are still what
191 wrote; the old draw on the TVs also needs the site change reverted). Simulated in tools/migration-191-sim.test.py (no
database). RLS-BASELINE.json: one new table, re-dump after. NUMBER: 186 live, 187 to 190 written on branches, checked every
branch and worktree 12 Nov 2026, so 191. RUN LIVE, Thu 12 Nov 2026 (Dean ran it; main read it back: snapshot 44 rows, all 44 venues raffle draw_style 'ticket' and members draw_style 'flip'). RLS-BASELINE.json and COLUMNS-BASELINE.json carry the new table, written BY HAND from this migration file (RLS on, not forced, no policy, no grant to anon or authenticated; columns venue_id, had_row, game_prefs, taken_at), NOT from a live dump: confirm with `python3 venueplay-backend/tools/dump-rls-baseline.py --check`.

`venueplay-192-one-phone-one-player-index.sql` (13 Nov 2026, branch `fix/one-phone-index-13nov`, follow-up to the one-phone race): ONE statement,
`create unique index concurrently if not exists vp_players_session_device_uniq on vp_players (session_id, device_id) where device_id is
not null and kicked = false`, so two truly overlapping joins from one phone cannot make two player rows (migration 39 left the constraint
out on purpose; the Worker's join is check-then-insert). The game Worker is safe BEFORE and AFTER it: handleJoin (and ensurePaperPlayer)
treat the database's unique violation (PostgREST 409 / 23505) as "already joined" and take the phone back onto the row that won. NOT RUN, and
NOT TO BE RUN BLIND: main first reads the LIVE database, read-only, for existing duplicates (the exact SELECT is in the file's header). If it
returns rows the index will not build; the header gives the clean-up (copy to a backup table, then mark the newer twins `kicked = true`,
keeping the OLDEST row, nothing deleted) to run BEFORE the index. Paste the CREATE alone in the SQL editor (CONCURRENTLY cannot share a
transaction). Run EARLY by hand, never on a push morning. Index only: nothing the REST probe can see, no RLS-BASELINE.json or
COLUMNS-BASELINE.json change. NUMBER: 191 live, 190 on a branch, nothing at 192 or above on any branch or worktree, checked 13 Nov 2026.
Proved in tools/rig-join-unique-index.test.py (the rig enforces the index and can make the other join win). Rollback in the file.
RUN on LIVE by Dean 15 Nov 2026 ~06:50 (INBOX MAIN 06:31, read back OK), after the clean-up of 4 twin rows; the backup table
`vp_backup_192_duplicate_players` is kept until about 22 Nov 2026, then dropped. The file is FROZEN: never edit it.

`venueplay-193-manager-ticks-guard.sql` (13 Nov 2026, branch `fix/billing-security-13nov`, security review part B finding B9, INBOX 370):
a BEFORE UPDATE trigger on vp_venue_settings beside migration 77's, same shape (it KEEPS, it does not refuse): a manager whose
owner took away "Edit draws and raffles" (permissions draws_raffles false) or "Edit advertising" (advertising false) keeps
the old default_draw_length_seconds / raffle_time_limit_seconds / raffle_template, or screen_rotation_seconds /
auto_game_promos, when they save the row straight through the REST API. Owners, full-access managers (null permissions),
platform admins and the Worker are untouched; game_prefs, trivia_* and setup_answers stay writable by everyone who runs a
night, and no page writes the five guarded columns any more, so no honest save changes. The manager policy stays (dropping
it would break Game settings, which saves from the browser). NOT RUN, and NOT TO BE RUN BLIND: main first runs the four
read-only checks in the file's header against LIVE. After running: dump RLS-BASELINE.json (one new SECURITY DEFINER
function). No column change. NUMBER: 192 is the highest on any branch or worktree, checked 13 Nov 2026, so 193. Read-back and
rollback in the file.
RUN on LIVE by Dean 15 Nov 2026 ~06:45 (INBOX MAIN 06:31, read back OK). The file is FROZEN: never edit it. RLS-BASELINE.json
still to be re-dumped for its new SECURITY DEFINER function vp_settings_manager_ticks_guard (dump-rls-baseline.py against live).

`venueplay-197-purchase-raffle-members.sql` (Dean, 14 Nov 2026, INBOX 415 purchase raffle rework, branch `fix/t17-praffle`):
vp_purchase_raffle_entrants gains postcode and member_capture_id (+ index), last_name may be empty (not null and the length check
relaxed). Additive and safe to re-run. RUN on TEST only (tools/staging/run-on-test.py). NOT RUN ON LIVE. The file as committed
carries the VP-STAGING-GUARD block, which REFUSES on the live project: the live run is the statements between the guard's END
marker and the end of the file. Run it on LIVE BEFORE the game Worker of this release ships (that Worker writes the columns).
Rollback: in the file.

`venueplay-198-coaster-contacts.sql` (Dean, 15 Nov 2026, Coaster Trivia name + mobile always, branch `fix/sun15-coaster-mobile`): one new table
vp_coaster_contacts (board, coaster_venue_id, play_id, first_name, mobile +614..., unique board+mobile), RLS on, no policies, revoked from
public/anon/authenticated: the first name and mobile from a round at a board with NO venueplay account (a player-added venue, a coaster venue,
a listed pub), for venueplay only, never shown to a venue, never used for marketing. Additive only. RUN on TEST (rkfaftxgzpsmmrzudlqy) 15 Nov
2026 with the guard block (read back: service 200, anon permission denied). RUN on LIVE by Dean 15 Nov ~06:55 (with the RLS read-back);
file frozen as committed in f340f520. Still to do: dump RLS-BASELINE.json from live and commit it. NUMBER: 197 is the highest on any branch
or worktree (fix/praffle-lock-14nov), checked 15 Nov 2026, so 198.

`venueplay-194-coaster-lead-boards.sql` (Dean, 14 Nov 2026, INBOX 396 backend, branch `fix/coaster-stunning-396-14nov`): four columns on
vp_coaster_venues (lead_status unchecked/verified/unverified/flagged, board_until, checked_at, checked_by) so a venue a player ADDS is a free lead
that can play: the game Worker auto-checks it against the licensed list (vp_licensed_venues) and its website; real = a lead with a board that
stays; not real = a trivia-only board for 30 days then deleted by the nightly sweep; a rude name = flagged, never shown, a help-desk ticket for
Dean. Never cold-emailed (nothing here touches vp_venues, vp_prospects or any send path). RUN on LIVE by Dean 15 Nov ~06:30 (re-applied for
Sunday 15 Nov by reverting the hold a2a88646). The Worker still degrades to the old "no board" where the columns are missing. NUMBER: 193 is the highest on any branch or worktree, checked 14 Nov 2026, so 194. Read-back in the file.

`venueplay-153-coaster-boards.sql` (Dean, 4 Nov 2026, /live-here-now v2, the drink-coaster QR page; reworked 12 Nov 2026 for
INBOX 229/232 before it was ever run): three tables, all service role only (RLS on, no policies, revoked from
public/anon/authenticated). `vp_coaster_venues`: places on the coaster round that are NOT venueplay venues, kind 'coaster' (a
"coaster venue (no emails)" Dean adds in HQ, or a player-added venue HQ put in the picker; not a vp_venues row, no login, no
email, so no automatic email path can reach it until HQ switches it to a normal prospect, which sets venue_id/switched_at) or
kind 'lead' (a venue a player ADDED, "Can't find your venue? Add it": name, suburb, state, optional website, asks, lead_guard's
name note, review new/kept/listed/dismissed; a possible new lead for HQ, never a board, never cold email). `vp_coaster_plays`:
one row per round, first name only, scored and timed by the game Worker (triviaAnswerPoints), boards 'v:'/'c:'/'l:<licensed
venue id>' (the picker also lists our licensed list, migration 171, HOTEL/PUB/TAVERN/RSL/CLUB names only), by the place's local
night and week, deleted after 35 days by the game Worker's nightly sweep. `vp_coaster_optin_venues`: the venueplay venues HQ
switched the end-of-round sign-up on for (no row = off; every venue starts off); sign-ups go to vp_captures (source 'coaster',
consent_version per 174) exactly as the phones' do. Run BEFORE the game Worker (/coaster/*) and billing Worker
(/admin/coaster/*); before it, both answer "not switched on yet" and the page plays as before. After running, dump
RLS-BASELINE.json (three new tables). NUMBER: 153 is Dean's reserved number (INBOX 222). Branch `feature/live-here-now-v2`.
RUN LIVE (main checked the three tables and the reworked columns 12 Nov 2026, INBOX 302). Read-back and rollback in the file.
(140 to 144 are claimed on other branches: 140 help reply lowercase, 141 subscriber postcode, 142 venue suburb, 143 help FAQ
no public phone, 144 help alerts by team. Checked on every branch and worktree on 3 Nov 2026: 145, 146 and 147 were free and
are claimed by `fix/security-3nov` below. 148 is the next free number.)

STATE ON 13 NOV 2026 (fix/security-fixes-13nov brings these three files to the release line for the first time; the numbers
145 to 147 are claimed by no other branch, so they keep them). Commit 1ee4cbd7 (3 Nov, 14:56) refreshed RLS-BASELINE.json from
live "after migrations 145 to 149". 145: RUN LIVE (the baseline has no vp_venues authenticated/anon UPDATE and no
vp_venues_manager_update). 146: the column is RUN LIVE (COLUMNS-BASELINE.json has vp_venue_staff.is_account_owner); the backfill
and the trigger cannot be seen in a baseline. 147: PROBABLY RUN (named in 1ee4cbd7's message; an index is not in either
baseline). Main checks all three read-only before the billing and game Workers from this branch go live (NEEDS-DEAN.md,
"DECISION: security fixes"): the Worker treats as owner ONLY a row with is_account_owner = true or role owner, so an account
with no marked owner would lose its owner rights on deploy. Nothing here is to be re-run without that read-back.

`venueplay-145-venues-no-client-update.sql` (security audit 3 Nov 2026, H1): drops policy `vp_venues_manager_update`, revokes
UPDATE on `vp_venues` from anon and authenticated, and grants authenticated UPDATE on `group_id` only (HQ's Groups tick, the one
direct browser write, still limited to HQ admins by `vp_venues_admin_all` / `vp_venues_admin_write`). A manager could PATCH
max_players, status (undoing a suspension), pending_players, overage_streak*, last_trivia_at and more on their own venue. Every
venue-side write goes through a Worker as the service role, so no venue page changes. Self-check raises if the hole is still open
or the group tick lost its grant. Any order with the Workers. After running: dump RLS-BASELINE.json. Branch `fix/security-3nov`.
NOT RUN. Rollback: in the file.

`venueplay-146-account-owner-marker.sql` (security audit 3 Nov 2026, H2, M1, L6): new column
`vp_venue_staff.is_account_owner boolean not null default false`, backfilled per account (venueplay_founding) from: a role
'owner' row; else a login with no permissions object whose sign-in email is the account's contact_email or whose mobile matches
the account mobile (last 9 digits); else, only when neither found anyone, the earliest-created full-access login (GUESSED, shown
as such by the pre-check). A BEFORE INSERT trigger `vp_staff_mark_account_owner` (security invoker, never raises) marks the owner
on new accounts and venues whatever the Worker version. RUN FIRST: `PRECHECK-account-owner-146-READ-ONLY.sql` (read only: who
becomes owner, who loses owner rights). Either order with the billing Worker; recommended 146 first, then the billing Worker
from this branch (before 146 the new Worker gets 42703 and keeps the old rule; any other read failure is a 503). No new policy or
grant. Branch `fix/security-3nov`. NOT RUN. Rollback: in the file.

`venueplay-147-purchase-raffle-one-winner.sql` (security audit 3 Nov 2026, M4): unique partial index
`vp_purchase_raffle_draws_one_winner` on (raffle_id, prize_index) where outcome = 'drawn'. Any existing duplicate (expect none)
keeps the earliest draw and the rest are marked redrawn with a reason and an audit row, nothing deleted. RUN FIRST:
`PRECHECK-raffle-double-winners-147-READ-ONLY.sql` (expect no rows). Needs 115. Any order with the game Worker; recommended 147
first, then the game Worker from this branch (which answers 409 already_drawn). Branch `fix/security-3nov`. NOT RUN.
Rollback: in the file.

`venueplay-144-help-alerts-by-team.sql` (Dean, 2 Nov 2026: "every different email needs its own notifications for different
teams", then "split notifications by brand too"): widens the check on `vp_help_push_subs.filter` so a device can keep a comma
list of ticks (`venueplay:sales,partyplay:venue_support,...`) as well as the three named sets `all`, `urgent_sales` and
`bad_feedback`. No new table, column, policy or grant, so RLS-BASELINE.json does not change. Safe to re-run (drop if exists,
then add). Run AFTER 137. Any order with the billing Worker: until it is run, a device that picks teams is kept on every
ticket and HQ says why; the named sets keep working. Branch `feature/help-alerts-by-team-2nov`, merged into release/tuesday-17nov 14 Nov 2026. RUN on LIVE by Dean 14 Nov 2026 ~22:50
(Sydney project) and on the TEST database by main 14 Nov ~23:00 (tools/staging/run-on-test.py). Rollback: in the file.

`venueplay-195-quick-game.sql` (Dean, 14 Nov 2026, INBOX 412 Play a quick game): `vp_quick_events` (the quick game's own step table),
`vp_quick_leads` (per-lead cold-email links, hashed codes only), `vp_signup_starts.lead_id`, `vp_prospects.lead_source`, and
`venueplay_founding.unverified_email` / `unverified_email_at` with a partial unique index. All additive, all nullable.
RUN on LIVE by Dean 15 Nov 2026 ~02:44, from the ORIGINAL file (the one on feature/try-it-412-15nov, 322668be; identical in
ef44613b and on the 412 redo head 8cefd1d5). The file is FROZEN: never edit it (its header still says "WRITTEN, NOT RUN": that is the
text Dean ran, leave it). `vp_quick_events` is now UNUSED on live: the 413 journey store (196, `vp_journey_events`) replaced it and
no Worker code reads or writes it since 15 Nov 2026. Harmless; retire it later with a NEW migration (next free number, 199 or
above), never by editing 195. Rollback: in the file's read-back notes.

`venueplay-196-journey-tracking.sql` (Dean, 15 Nov 2026, INBOX 413 journey tracking; 195 is the 412 quick game's): two new tables, nothing existing is touched.
`vp_track_links` (one row per tracked email link: lead_ref, venue name, first name, state, likely games, campaign, email step, link label, page,
sent_at, expiry, revoked_at, venue_id; only a SALTED SHA-256 of the 6-character code is kept, never the code or an email address) and
`vp_journey_events` (one row per step: anonymous session id, event name, small props, source, path with any code cut out, referrer family,
AU state or country, device kind, scanner flag, venue_id once signed in; NO IP, user agent, fingerprint or personal data; the only free text
is the venue search that found nothing, digits and @ stripped; clear that text after 90 days, delete rows after 400). Both: RLS on, everything
revoked from public / anon / authenticated, select/insert/update to service_role only (so RLS-BASELINE.json gains two tables after it is run:
dump it then). Safe to run any time: until it runs, POST /track, GET /track/lookup and the HQ Journey routes answer "nothing recorded" and the pages
carry on. Needs vp_venues. Any order with the billing Worker. After loading the codes (tools/make-journey-codes.py output) set sent_at per send.
Branch `feature/journey-413-15nov`. NOT RUN. Rollback: `drop table public.vp_journey_events; drop table public.vp_track_links;`.

`venueplay-208-hq-no-member-contacts.sql` (Dean's open question 10, 16 Nov 2026: "Block HQ admin database reads of members'
email/mobile?", suggested yes; scope set by Dean 17 Nov: ONLY a club's uploaded members list, never players, the player profile or
subscribers, which HQ keeps seeing). Drops policy vp_members_admin_all (HQ admin FOR ALL on every club's members list) and adds view
v_vp_members_list (id, roster_id, member_number, first_name, last_name, status, updated_at: no email, mobile, postcode, consent or
note; own venues for staff, every venue for an HQ admin; owner rights, security_barrier, select to authenticated only). The members
console and the account page count read the table, then the view when the table answers nobody (HQ View as). vp_members_host_select,
every grant on vp_members and every player table are untouched. Branch `feature/hq-no-member-contacts-q10`. RUN on TEST only, twice
(17 Nov 2026 ~22:40, the second run "policy does not exist, skipping"), read back and proven with a rolled-back HQ-admin and venue-owner
session. NOT RUN ON LIVE: ships on Dean's yes. The file carries the VP-STAGING-GUARD block; the live run is the statements after
its END marker. Either order with the pages. After the live run dump RLS-BASELINE.json (this branch already carries the post-208
state). Rollback: in the file. NUMBER: 195 to 207 taken on other branches/worktrees (checked 17 Nov 2026), so 208.

`venueplay-212-venue-old-addresses.sql` (Dean's open question 32, 16 Nov 2026, "yes, step 2": HQ Move TV address, the Lunatic
Hotel fix). Additive: `vp_venue_slug_aliases` (one row per OLD TV address: slug primary key, venue_id, retired_at, retired_by; RLS on,
no policies, everything revoked from public / anon / authenticated, service role only); two triggers so no two venues can ever hold
one address, current or old, whatever path writes (each takes an advisory lock on the slug); `vp_venue_move_address(venue, new slug,
actor id, actor label)`, service role only, the ONE way an address moves: in one transaction it refuses a taken address, a channel
hash another venue uses, or a venue with a game open, keeps the join code (fills a null one with hash(old slug)), moves vp_venues.slug
and vp_venue_screen.slug, sets screen_reload_at, records the alias and writes the vp_admin_audit row `venue_address_moved`; and
`vp_venue_current_slug(slug)` (anon + authenticated may call it: slugs are public) for a console bookmarked on an old address.
Run BEFORE the billing Worker that offers the button (until then it answers "not set up yet"); the game Worker and pages are safe
either side. Needs 15, 63, 68, 91. Branch `feature/hq-rename-slug-q32`. RUN on TEST only, twice (17 Nov 2026), and exercised there in
rolled-back transactions. NOT RUN ON LIVE: ships on Dean's yes. The file carries the VP-STAGING-GUARD block; the live run is the
statements after its END marker. After the live run, dump RLS-BASELINE.json / COLUMNS-BASELINE.json. NUMBER: 210 is claimed twice
(replay/sun29-no-contact and the q28 worktree), so 211 is left for the loser; checked every branch and worktree 17 Nov 2026.
Rollback (only while no address has moved): in the file.

`venueplay-215-one-number-per-player.sql` (Dean, 17 Nov 2026 ~23:15: ONE phone number per venueplay player, the same at every
venue; replaces question 28's "keep both", whose migration 210 on feature/known-phone-keep-both-q28 is SHELVED and never ran on live).
Needs 202. Adds: a nullable `known_id` column (foreign key to vp_known_players, on delete set null, partial index where set) on
`vp_players` and `vp_captures`, written by the game Worker at the join or bingo capture that made the row; table
`vp_number_changes` (one row per "Not my number": the known row, the NEW number, the SHA-256 of the texted code, 10-minute expiry
capped at 30 minutes, 5 tries, 3 texts, the old number only as its last three digits) and the definer function
`vp_number_change_apply(uuid)` (one transaction: the known row's mobile, then ONLY at venues whose `shared` list had this player's
mobile, and there ONLY the vp_players (through vp_sessions) and vp_captures rows that carry THIS known row's id (known_id) and still
hold the old number; never a row by number alone, so rows from before 215 (known_id null) keep the old number; other open changes
closed). Locks: `set lock_timeout = '3s'` is the first statement after the guard (a busy table fails the paste in 3 seconds instead
of queueing every join; paste again), the two foreign keys are added NOT VALID inside a pg_constraint guard and then validated as
their own statements, `reset lock_timeout` at the end. Safe to run twice. RLS on vp_number_changes, no policies, nothing granted to
anon/authenticated; EXECUTE for service_role only. known_id is not readable by venue staff: RLS-BASELINE.json (live) has NO grants
on vp_players to anon or authenticated, so vp_players_host_select never applies through PostgREST; vp_captures has table grants but
RLS on and no policies (0 rows); no Worker read selects known_id. Never add it to a host or HQ select or export. Run AFTER 202 and
BEFORE (or with) the game Worker that writes known_id (the Worker before 215 is also safe: on "no such column known_id" alone it
stores the row once more without the link and logs one line; before 215, /join/number/* answer 503 and the phone shows no "Not my
number"; the switch NUMBER_CHANGE_SMS_ON is also off by default). TEST: the FIRST body (table + function only) ran on TEST twice
under number 213 (17 Nov 2026 ~23:22). THE EDITED FILE (18 Nov: known_id columns, own-rows WHERE, lock timeout, NOT VALID keys;
branch fix/215-review-fixes-18nov on fix/215-number-change-own-rows-18nov) HAS NOT BEEN RUN ON TEST: run it there twice, and read
back, before live. NOT RUN ON LIVE: ships on Dean's yes. The file carries the VP-STAGING-GUARD block; the live run is the
statements after its END marker. After the live run: `notify pgrst, 'reload schema';`, dump RLS-BASELINE.json and
COLUMNS-BASELINE.json (one table, one definer function, two columns). Rollback (after the Worker is rolled back or the switch is
off): `drop function if exists public.vp_number_change_apply(uuid); drop table if exists public.vp_number_changes;` and, only after
the Worker that writes it is rolled back, `alter table public.vp_players drop column if exists known_id; alter table
public.vp_captures drop column if exists known_id;`. NUMBER: 210 twice, 211 held for the loser of that clash, 212
venue-old-addresses; no 213 anywhere (it went to q9) (checked every branch and worktree 17 Nov 2026 23:20); RENUMBERED 214 the same
night, then 215 on 18 Nov (main claimed 214 for feature/hq-coaster-leads) because q9 (feature/members-upload-more-fields-q9) claimed
213 first.

`venueplay-202-known-phone-consents.sql` (Dean, 14 Nov 2026, INBOX 416 known phone + Moshtix-style consent; Sunday 22 Nov games
release; 200 is the members upload, 201 the retention sweep): two new tables, nothing existing is touched. `vp_known_players` (one row
per PHONE, held by venueplay: first name, mobile in +614 form, and what venues asked; each venue receives only the fields it asks;
found ONLY by the SHA-256 of a random 256-bit key the phone holds, never the key; first_venue_id; notice_version/notice_at for the
first-game notice) and `vp_player_consents` (one row per consent box answer: party venueplay / venue / host, granted, wording
version, source game, session, the host login for a host box). Both: RLS on, no policies, everything revoked from public / anon /
authenticated (service role only), so RLS-BASELINE.json gains two tables after it is run: dump it then; COLUMNS-BASELINE.json too.
The game Worker's 90-day sweep deletes a gone venue's consent rows (purgeKnownPlayers); the known row is venueplay's and stays (keeping rule: Dean). Safe in either order with the game Worker:
before it runs every lookup answers "not known" and nothing is written (tools/test-known-phone.js section 6). Run on TEST first
(tools/staging/run-on-test.py), then Dean pastes on live EARLY. Branch `feature/known-phone-416-sun22`. NOT RUN.
Rollback: `drop table public.vp_player_consents; drop table public.vp_known_players;`.
