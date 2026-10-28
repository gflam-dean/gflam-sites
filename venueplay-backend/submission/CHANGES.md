# The OLGR submission pack: what supersedes what (27 October 2026)

The pack now has two homes. The old files stay where they were, unchanged. The v1.2 files are in this folder (`venueplay-backend/submission/`, branch `docs/olgr-dossier-27-oct`) and a copy is placed beside the old pack at `~/venue-enrich/rng-certification/qld/v1.2/` for Dean.

Why a v1.2 pack: custom bingo patterns (VP-DRAW-1.2) went live on 27 October 2026. The 26 October review of the pack found that the dossier, the version table, the phone-ticket description and the evidence pack were pinned to 17 October, before the regulated module existed, and that four of their statements no longer matched the code. The v1.2 files describe what is live, with every fact checked against commit 18e2c58d, the live site and the live Worker on 27 October (EVIDENCE-v1.2.md).

## File by file

| Old file (kept, not edited) | Status | Superseded by | Why |
|---|---|---|---|
| `~/venue-enrich/rng-certification/RNG-DOSSIER.md` (v1.0, 16 Oct) and `RNG-DOSSIER.pdf` | superseded twice | `RNG-DOSSIER-v1.2.md` | v1.0 predates even v1.1. The PDF is v1.0 and must not be attached to anything. |
| `~/venue-enrich/rng-certification/RNG-DOSSIER-v1.1.md` (17 Oct) | superseded | `RNG-DOSSIER-v1.2.md` | Pinned to 9c56748a, pre VP-DRAW: tickets and verdicts on the tablet, a second intended use Dean ruled out on 19 Oct, caller undo and the unused shuffle as open issues (both closed), the strip maker's old text. Its statistical sections are cited from v1.2 for the components whose text is unchanged. |
| `~/venue-enrich/rng-certification/qld/evidence/VERSION-NAMES.md` (17 Oct) | superseded | `VERSION-NAMES-v1.2.md` | VP-TICKET-1/2/3 and VP-CARDNO-1 name functions that moved into the shared module or no longer exist; four components of a product not submitted; no VP-DRAW. |
| `~/venue-enrich/rng-certification/qld/PHONE-TICKETS.md` (16 Oct) | superseded | `PHONE-TICKETS-v1.2.md` | Described two paths and recommended the server one; the server path is the only path since 19 Oct. The thirteen regulator questions are kept; the answers are new. |
| `~/venue-enrich/rng-certification/qld/OLGR-ENQUIRY-EMAIL.md` (19 Oct) and `.before-19oct.md` | superseded | `OLGR-ENQUIRY-EMAIL-v1.2.md` | Named a v1.0 PDF; "under 150 lines"; "Safari and Chrome"; implied the server checks the phone's signature; the 19 Oct decisions are carried forward. |
| `~/venue-enrich/rng-certification/qld/evidence/` (manifest.tsv, samples, tests, flowcharts, harness, README) | partly superseded | `EVIDENCE-v1.2.md` says which results stand and which must be rerun | The raw-source batteries and the samples for VP-SCALE-1, VP-SHUFFLE-1, VP-RAFFLE-1 and VP-MEMBERS-1 still describe the live text. The samples for VP-POOL-1, the strip maker and the ticket number, and the two bingo flow charts, do not. The harness is pinned to the 9c56748a file layout and needs updating before it is rerun. |
| `~/venue-enrich/rng-certification/qld/QLD-PATH.md` and `CLAUSE-4-1-CHECKLIST.md` (16 Oct) | still current for the path, stale on the product | not superseded | The lodgement path, addresses, fees and law are unchanged. Its open question (e) (phone ticket's home) is answered; question (f) is settled by Dean's 19 Oct ruling. The clause checklist is restated in the dossier's section 17. |
| `~/venue-enrich/rng-certification/qld/compliance-check-2026-10-20/` | still current | not superseded | Its two findings are unchanged in VP-DRAW-1.2 and are carried in the dossier's section 16. |
| `vp-draw-1.2-submission-sections.md` (26 Oct, this folder) | folded in | `RNG-DOSSIER-v1.2.md` | Its REPLACES and NEW sections are now the dossier's own sections 0, 2, 5.6, 5.8, 9, 10, 12, 16, 18. Nothing from it was dropped except the "not yet deployed" statements. |
| `vp-draw-1.1-to-1.2-change-summary.md` (26 Oct) | superseded | `vp-draw-1.1-to-1.2-change-summary-v1.2.md` | Said "not yet deployed", branch `feature/custom-bingo-patterns`, commit 373f6920. Now live, on `main`. |
| `vp-draw-1.2-lodgement-checklist.md` (26 Oct) | superseded | `vp-draw-1.2-lodgement-checklist-v1.2.md` | Items A2, A16 (part), B7 resolved by the release; the contradiction list now records where each was corrected. |
| `vp-draw-1.2-cover-email.md` (26 Oct) | superseded | `vp-draw-1.2-cover-email-v1.2.md` | Square brackets filled with the live commit, build and date. |
| `vp-draw-1.2-custom-patterns.md` (26 Oct, the module note) | still current | not superseded | The engineering note for the change; the submission does not cite it directly. |
| `rng-test-results.md` (26 Oct) | not relied on | none | Names no harness, date or raw file and says it tested a reimplementation of `randInt`; the 17 October batteries are the evidence the dossier cites. Dean may delete it or have its harness and raw output added. |

## New in this pack

- `RNG-DOSSIER-v1.2.md`: the dossier describing what is live (server-side tickets and verdicts, phones signing for themselves and the console verifying, custom patterns, the recorded-outage rule for the tablet, no second intended use), with every carried-forward statistic marked as standing or to rerun.
- `VERSION-NAMES-v1.2.md`: every component named and versioned with the SHA-256 of its exact text at 18e2c58d, and the script that computed them.
- `PHONE-TICKETS-v1.2.md`: the thirteen regulator questions answered against the live code.
- `OLGR-ENQUIRY-EMAIL-v1.2.md`: the first email, corrected; one sentence marked for Dean.
- `EVIDENCE-v1.2.md`: the live build, the hashes, the commits, what was verified on 27 October and what was not.
- `vp-draw-1.1-to-1.2-change-summary-v1.2.md`, `vp-draw-1.2-lodgement-checklist-v1.2.md`, `vp-draw-1.2-cover-email-v1.2.md`: as above.
- `CHANGES.md`: this file.

## What is still owed before lodgement

The lodgement checklist's section A, in short: Dean's confirmations (version described, prize figure, fallback for Queensland, the two 20 October findings, opt-in capture, the scope sentence in the email), the signed forms and letter, the security statement, the test venue login, the PDF, the regenerated samples and bingo flow charts, the live SQL dump, and the phone call to the Technical Unit.
