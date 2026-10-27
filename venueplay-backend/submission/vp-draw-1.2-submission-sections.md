# VenuePlay random number generation: submission sections updated for VP-DRAW-1.2

Version of this document: 1.0, 26 October 2026. Prepared as replacement and insert sections for RNG-DOSSIER-v1.1.md (17 October 2026) so that the dossier describes the regulated bingo module as it stands, VP-DRAW-1.2. Section numbers follow the dossier's own; a section marked REPLACES stands in for the dossier's section of that number, and a section marked NEW is inserted where its number says.
Prepared by: GFLAM GROUP PTY LTD trading as VenuePlay, ABN 35 679 383 049, 80 Michigan Drive, Oxenford QLD 4210, hello@venueplay.com.au
Equipment described: the regulated bingo module **VP-DRAW-1.2** (manifest hash `889556b56c9dc21830f3edb36aa90fd4ba12cfab7a7487187d05471dc0495d6d`), repository https://github.com/gflam-dean/gflam-sites, branch `feature/custom-bingo-patterns`, read at commit `373f69200a83452819b8cc0626a54ef4f975a0e8` (26 October 2026, 22:08 AEST). The module is not yet deployed: on 26 October 2026 the live game Worker reports `draw_module VP-DRAW-1.1` and `draw_manifest 9d1b390a...` at https://venueplay-game.dean-tindale.workers.dev/health. The commit, build stamp and hashes below are to be restated for whatever is live on the day of lodgement.

Nothing in this document is new randomness. VP-DRAW-1.2 changes one thing: a venue may save a winning pattern of its own, and the server judges a claim on it the way it already judges the seven standard patterns. The entropy source, the scaler, the shuffle, the ball hand-out, the ticket maker and the tablet fallback are the same text as VP-DRAW-1.1.

---

## 0. What changed since version 1.1 (ADD to the list)

6. **The regulated bingo code is one named, versioned module, VP-DRAW** (19 October 2026, after this dossier's version 1.1). The draw, the ticket maker, the claim rule and the tablet-fallback switch live in two files, one on the server and one on the host's tablet, hashed together in a manifest whose hash the live Worker reports on /health. Sections 2 and 12 below.
7. **The server deals the phone tickets and decides every claim** (VP-DRAW-1.0, 19 October 2026). The dossier's section 5.6 and PHONE-TICKETS.md described tickets held on the host's tablet and a verdict computed in the console. That is no longer the live product: the ticket, the called numbers, the claim and the verdict are all held on VenuePlay's server (tables `vp_bingo_tickets` and `vp_bingo_claims`, migration 104). Section 5.6 below replaces the old one.
8. **A venue's own winning pattern** (VP-DRAW-1.2, 24 October 2026). Section 5.8 below. The RNG is unchanged.

## 2. Files and versions in scope (ADD these rows)

| File (repository path) | Role | Bytes | SHA-256 at commit 373f6920 |
|---|---|---|---|
| `venueplay-backend/worker/vp-draw.js` | VP-DRAW, server half. `randInt` (VP-SCALE-1), `shuffle1to90` (VP-SHUFFLE-1), the strip maker, the claim rule including the venue's own pattern, the routes `/host/bingo/draw`, `/ball`, `/fallback`, `/deal`, `/claim`, `/claim/resolve`, `/finish`, and the tablet-fallback switch. 963 lines. Copied byte for byte into `venueplay-game.js` between the `VP-DRAW BEGIN` and `VP-DRAW END` markers by `tools/regulated.py`; the release gate refuses the Worker if the copy differs. | 61,013 | `8bf72207c6c6c9bdde86fefee031bac2f1b0638c55b45ef6f1650b46d5c64243` |
| `venueplay/app/vp-draw.js` | VP-DRAW, tablet half. `cryptoInt`, `drawFromPool`, `makeStrip` (the same strip text as the server), `cardWins` and `ruleClean` (the same claim rule as the server, used only to light the host's screen and, in a recorded outage, to stand in). 211 lines. | 11,373 | `ea48ee30ce9289d85952cf61d8cf7fd95acadff9537868326cb4381a8ecd892b` |
| `tools/regulated-manifest.json` | The manifest: module name, version, the two file hashes above, one hash over all of it (`889556b5...`), and the reason for every version change. Written only by `tools/regulated.py --update`. | 1,877 | `dd008b95383e84a554cb5bb134828985a69e593a7fb3b8855ac985b58444b497` |
| `venueplay-backend/supabase/venueplay-104-bingo-server-tickets.sql` | Tables `vp_bingo_tickets` and `vp_bingo_claims`: the server's copy of every ticket dealt and every claim made. | 8,572 | `3ecad04c15cee4d76938ea1224294d1cdfed97f70728be9b149c40774bf82093` |
| `venueplay-backend/supabase/venueplay-109-bingo-unseen-and-finished.sql` | VP-DRAW-1.1 record columns (voided balls with a reason, finished draws, deal and ask timestamps). | 4,115 | `fb2db1fa89baaeb9e3a664bd021b07400cc2d72e275ae225d6ffaa1e1939601b` |
| `venueplay-backend/supabase/venueplay-118-custom-bingo-patterns.sql` | Table `vp_bingo_patterns` (a venue's saved patterns) and the two claim columns that keep what a custom claim was judged on. Run on the live database 26 October 2026. | 4,915 | `fc58d15b62c9b3735c2e1afdde7ca07cc4a61c4c0aab668e45ed75beb381daa0` |
| `venueplay-backend/worker/venueplay-game.js` | The game Worker as deployed (one file). Carries the VP-DRAW copy, `VP_DRAW_VERSION` and `VP_DRAW_MANIFEST` (line 151), and the three pattern routes `/host/bingo/patterns`, `/save`, `/delete` (lines 346 to 348, handlers from line 7507). | 729,334 | `0ecee6ab1808dab9ed56b009042b0ac569e9a4dc59ced66d88ec425fd01ea52b` |

Versioning rule for the module: any change to either VP-DRAW file must raise the version string in both halves and regenerate the manifest in the same commit; `tools/regulated.py --check` runs in the release gate and refuses a Worker whose module copy, file hashes, version strings or fallback switch differ from the manifest or from each other. The version history to date: VP-DRAW-1.0 (19 October 2026), VP-DRAW-1.1 (19 October 2026, review of 1.0), VP-DRAW-1.2 (24 October 2026, the venue's own pattern). The manifest records the reason for each.

## 5.6 How a claim is checked, and where the record is (REPLACES)

The phone never sends a ticket. A BINGO press sends a signed message carrying only the ticket number; the host's console carries that claim to the server as `POST /host/bingo/claim` (`vp-draw.js` lines 794 to 902). The server then:

1. reads its own copy of the player's tickets for this draw (`vp_bingo_tickets`), never anything the phone or the tablet says is on a ticket (line 864 onward);
2. reads its own record of the balls called, in order (`vp_bingo_draw_balls`, line 829), and uses the first `balls` of them, the number out when the player pressed;
3. applies the claim rule `bingoTicketWins` (lines 529 to 557) for the pattern named in the claim, and for a custom pattern the venue's saved rule (section 5.8);
4. writes one row to `vp_bingo_claims` whether the verdict is a win or not: the ticket, the pattern, the ball count, the last ball, the verdict, the winning cells, and where it was decided (lines 879 to 898);
5. answers the console, and the host confirms or rejects through `POST /host/bingo/claim/resolve` (lines 945 to 963). A host cannot confirm a claim the server judged a non-win (`bingoMayConfirm`, lines 907 to 911), except a claim the host had to decide on the tablet during an outage the server itself recorded, and only where the state's tablet fallback is on.

The console's list of called numbers is sent with the claim and is compared, not used; if it disagrees with the server record, the server record is used and a note is written on the claim (lines 830 to 834). The same claim sent again (a console retrying after a timeout) returns the first verdict (lines 810 to 812).

The record of the night is therefore on VenuePlay's server: the draw and every ball with its source, every ticket dealt with the number of balls out when it was dealt, every claim with its verdict and the host's decision. The tablet holds a copy for the room's display. This replaces the dossier's description of a tablet-held master copy, which was true at commit 9c56748a and is not true since VP-DRAW-1.0.

## 5.8 The venue's own winning pattern (NEW, VP-DRAW-1.2)

### 5.8.1 What it is

Beside the seven standard patterns (one line, two lines, full house, four corners, top line, middle line, bottom line), a venue may save named patterns of its own for 90-ball bingo. A saved pattern has a name of 1 to 30 characters, shown on the television and on players' phones, and exactly one rule:

- **Any N numbers.** A ticket wins when at least N of its 15 numbers have been called, N from 1 to 15. "Any 15" is a full house by another name.
- **A shape.** The venue marks squares on the 3 by 9 ticket grid. A ticket wins when every number inside the marked squares has been called. A marked square that is blank on a particular ticket has nothing to call, so it counts as done; a ticket with no number inside the shape at all can never win on it.

No other rule can be saved or judged. The reading of a rule is one function, `bingoRuleClean` (lines 566 to 584): anything that is not one of these two shapes reads as null and is never a win. The database enforces the same two shapes with a check constraint on `vp_bingo_patterns.rule` (migration 118), so a row that is not one of them cannot exist.

A venue may keep up to 30 saved patterns. A name that matches one of the seven standard patterns, or another saved pattern at the same venue, is refused.

### 5.8.2 Who can create one

Saving and deleting a pattern is `POST /host/bingo/patterns/save` and `/delete` in the game Worker (`venueplay-game.js` lines 7560 to 7599). Both require a signed-in staff member of that venue and then one of two roles (`bingoPatternStaff`, lines 7541 to 7549):

- the venue's **owner**, or
- a **manager** of that venue whose owner has not switched off the manager's draws and raffles right (the owner-set per-manager toggle; a manager starts with it on).

A **host** can list and play the venue's patterns (`POST /host/bingo/patterns`) and cannot save, change or delete one. A member of staff at another venue cannot see them. Every row records who created it and who last changed it (`created_by`, `updated_by`), with times. A delete marks the row `deleted_at` and keeps it, for the reason in 5.8.3.

### 5.8.3 How a claim on it is judged

Exactly as section 5.6, with the rule read from the venue's own row:

1. The console names **which** pattern by its id (`custom_id`). The server reads that pattern's rule from `vp_bingo_patterns`, filtered to the venue that owns the draw (`bingoCustomPattern`, lines 600 to 606). A pattern saved for another venue is not found: the claim is refused with "That pattern is not saved for this venue" and nothing is written (lines 818 to 821).
2. The rule the console sends alongside (`custom_rule`) is **compared only**. If it differs from the saved rule, the saved rule is used and a note is written on the claim: "The tablet showed a different rule for [name]; the rule saved for the venue was used" (lines 824 to 826). A stale console, or a doctored request, cannot play a laxer rule than the venue saved.
3. The rule is applied by `customTicketWins` (lines 585 to 596), a constant in the module, to the server's copy of the ticket and the server's record of the balls. The venue's row supplies the two inputs of the rule, N or the squares, and nothing else.
4. A pattern deleted during a game is still read (the read does not filter on `deleted_at`), so a claim in that game is judged on the rule the room was playing.
5. On a real-balls night (caller mode) there are no phone tickets to judge (`/host/bingo/deal` refuses every hand on a caller draw, lines 659 to 664). The custom pattern there is the name on the screens; the host checks the paper book and confirms, as for any pattern in caller mode.

The seven standard patterns are judged by the same code path as in VP-DRAW-1.1 and a claim on one writes exactly the row it did in 1.1 (line 886 to 887: the two custom columns are written only on a custom claim).

### 5.8.4 How it is logged

Every claim on a custom pattern carries, on the `vp_bingo_claims` row, the id of the pattern (`custom_pattern_id`) and a copy of the name and rule as they stood when the claim was judged (`custom_pattern`, migration 118). An inspector reading a claim from last month sees the rule it was judged on even if the venue has since renamed, changed or deleted the pattern. The pattern table itself keeps every row ever saved, with `created_by`, `updated_by`, `created_at`, `updated_at` and `deleted_at`.

Access: `vp_bingo_patterns` has row-level security on with no policy and every grant revoked from the anonymous and signed-in roles (migration 118), the same lock as the draw, ticket and claim tables (migrations 70 and 104). Only the game Worker, with the service role, reads or writes it. The repository's `RLS-BASELINE.json` records this and the release gate compares the live database against it.

### 5.8.5 What did not change

- The entropy source (VP-ENTROPY-1), the scaler `randInt` (VP-SCALE-1, lines 33 to 39) and the shuffle `shuffle1to90` (VP-SHUFFLE-1, lines 45 to 53): the same text as quoted in the dossier's section 4, unchanged since 4 August 2026.
- The ball order, the ball hand-out (VP-BALL-1) and the tablet fallback (VP-POOL-1): unchanged from VP-DRAW-1.1.
- The strip maker (a strip of six tickets holding 1 to 90 once, lines 399 to 499) and ticket validation: unchanged from VP-DRAW-1.1.
- The intended use for clause 4.1.5: still 1 to 90 without replacement, one ball per host tap, the same result range, frequency and number of results. A custom pattern is a winning condition applied to a ticket; it calls the generator zero times.
- Musical bingo is a separate product, is not bingo, and has never been part of VP-DRAW.

### 5.8.6 Test evidence

All of these run the real module. Paths are relative to the repository root. The first two were run again on 26 October 2026 at commit 373f6920 for this document.

- `jsc tools/test-bingo-server-tickets.js`: **80 of 80 checks passed.** It drives the real console page and real phone pages on one channel against the real Worker handlers over a fake database, and covers: the server and tablet halves agreeing on custom rules over 1,500 random tickets (and the seven standard patterns over 2,800); any 5 winning on five called numbers and not on four; a shape winning only when every number in it is called; a shape on blank squares never winning; rules outside the two shapes never winning; a console sending a laxer rule (any 1) being judged on the saved rule (any 6) with the note written; another venue's pattern refused; a deleted pattern still judged; a standard-pattern claim writing no custom fields; a full phone game on a custom pattern with one non-win claim and one win, judged by the server; who may save and delete; the name and rule limits; and "not switched on" before migration 118.
- `jsc tools/test-caller-mode.js`: **117 of 117 checks passed.**
- `python3 tools/regulated.py --check`: "VP-DRAW VP-DRAW-1.2, manifest 889556b56c9d: both halves match the manifest."
- `python3 tools/prove-checks.py --list`: all 1,673 mutations apply (1,658 local, 15 live). The full run, in which each new check is broken on purpose and must go red, is reported in the module's note (`vp-draw-1.2-custom-patterns.md`) and was not rerun for this document.
- `tools/caller-winner-in-chrome.test.py` (the caller-mode Chrome suite): recorded in the module's note as still to run at the time of writing; not run for this document.

## 9. Where the state lives, and who can see it (ADD one row)

| What | Where | Who can read it |
|---|---|---|
| A venue's saved patterns (name, N or squares) | `vp_bingo_patterns`, one row per pattern per venue, rows kept on delete | The game Worker (service role) only. The console and phones receive the name and rule for display over the venue's channel; the server never takes the rule back from them. |

## 10. Intended use statement (ADD one paragraph)

Winning patterns. The server judges a bingo claim on one of seven standard patterns or on a pattern the venue has saved (any N of the ticket's 15 numbers, N from 1 to 15, or every number within a chosen set of squares on the 3 by 9 ticket). The pattern is a winning condition applied to the server's copy of the ticket against the server's record of the balls; it does not call, parameterise or alter the random number generator, and it does not change the result range (1 to 90), the frequency of calling, or the number of results drawn in a game.

## 12. Verifying the live system (ADD)

The game Worker's `/health` answers with `draw_module` (the VP-DRAW version string) and `draw_manifest` (the SHA-256 over the module manifest). On the day of lodgement the two values must read `VP-DRAW-1.2` and `889556b56c9dc21830f3edb36aa90fd4ba12cfab7a7487187d05471dc0495d6d`, and the two module files in the submission archive must hash to the values in section 2. `python3 tools/regulated.py --check` in a checkout of the lodged commit reproduces the check OLGR can make by hand.

## 16. Known issues and open items (REPLACE item 1, ADD items 13 and 14)

1. (Replaced.) Bingo tickets and claim verdicts are held on VenuePlay's server since VP-DRAW-1.0 (19 October 2026); the tablet stands in only during an outage the server itself recorded, before the first ball for tickets, and labelled on the claim record for verdicts. The 20 October 2026 compliance check (`qld/compliance-check-2026-10-20/REPORT.md`) found two matters in VP-DRAW-1.1 that are unchanged in 1.2 and remain open: a host may post a ball for the last place within 30 seconds of a server ball (clause 4.2.4), and tickets may be dealt after balls are out (clause 4.2.7). Both are decisions for Dean (section 18).
13. The pattern a claim is judged on is the one the console names in that claim, as it has been for the seven standard patterns since VP-DRAW-1.0; the server does not separately record "the pattern announced for this game" before claims arrive. The claim row keeps the pattern, and for a custom pattern the name and rule, so the record is complete per claim.
14. The dossier's version 1.1, VERSION-NAMES.md, PHONE-TICKETS.md and the evidence pack are pinned to commit 9c56748a (17 October 2026), before VP-DRAW existed. Their descriptions of tablet-held tickets, the console's `checkPattern` verdict and the component names VP-TICKET-1 and VP-TICKET-2 (console strip and single card at that commit) no longer match the code: the strip maker is now the shared text in both VP-DRAW halves. The evidence pack is to be regenerated for the lodged commit (README.md in the evidence folder gives the order).

## 18. Decisions that need Dean (ADD)

9. **Custom patterns in the regulated module.** Phone claims on a venue's own pattern are judged by VP-DRAW-1.2 on the server (Dean, 25 October 2026). The alternative that needs no change to the regulated module is to offer custom patterns in caller mode only, where there are no phone tickets. Confirm the 25 October decision before lodgement, because it sets which version is described.

## Proposed component rows for VERSION-NAMES.md (clause 4.1.3)

Names proposed in the same style as the existing table; Dean to accept. Lifted-text hashes are produced by `harness/make-version-table.py` at lodgement and are not given here.

| ID | Ver | Status | What it is | File | Where |
|---|---|---|---|---|---|
| VP-CLAIM-1 | 1 | IN USE (server; tablet copy for display and recorded outages) | The claim rule for the seven standard patterns, `bingoTicketWins`; the tablet's `cardWins` is the same rule and a suite runs both. | `venueplay-backend/worker/vp-draw.js`; `venueplay/app/vp-draw.js` | lines 529 to 557; line 150 |
| VP-PATTERN-1 | 1 | IN USE from VP-DRAW-1.2 | The venue's own pattern: `bingoRuleClean` (the one reading of a rule) and `customTicketWins` (any N, or a shape); the saved row read by `bingoCustomPattern` for the draw's venue only. | `venueplay-backend/worker/vp-draw.js`; `venueplay/app/vp-draw.js` | lines 566 to 606; lines 178 to 207 |
| VP-STRIP-1 | 1 | IN USE from VP-DRAW-1.1 | The strip of six tickets holding 1 to 90 once, the same text in both halves (`stripOfSix` and its helpers), replacing the console-only VP-TICKET-1 and VP-TICKET-2 of commit 9c56748a. | both VP-DRAW files | `VP-STRIP BEGIN` to `VP-STRIP END` |

Neither VP-CLAIM-1 nor VP-PATTERN-1 calls the random number generator.
