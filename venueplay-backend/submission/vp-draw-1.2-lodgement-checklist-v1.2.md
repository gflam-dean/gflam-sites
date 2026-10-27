# VP-DRAW-1.2 lodgement checklist (v1.2): what Dean must supply, what could not be verified, and what the drafts got wrong

27 October 2026. Supersedes the 26 October checklist (`vp-draw-1.2-lodgement-checklist.md`), which was written against a branch before the module was live. Read only, against `origin/main` at 18e2c58d, the live Worker's /health, the live site, and the old pack in `~/venue-enrich/rng-certification/`. Nothing here is guessed: UNVERIFIED means I could not check it from the code or the documents in this pass; CONTRADICTS means a draft and the code disagreed and the v1.2 file now says what the code does.

Resolved since 26 October: A2 (VP-DRAW-1.2 is live; /health says so), A15 partly (the "live since" date is 27 October 2026), A16 partly (the dossier, version names, phone tickets, enquiry email and evidence pointers are rewritten at v1.2; the statistical samples and the bingo flow charts are still to regenerate), B7 and A1 partly (the custom patterns ARE live in the regulated module, so the submission describes 1.2; Dean still confirms that this is what he wants described).

## A. What Dean has to supply or decide (DEAN)

| # | Item | Why | Where it goes |
|---|---|---|---|
| A1 | **Confirm that the submission describes VP-DRAW-1.2 with custom patterns in the regulated module** (what is live), not a caller-mode-only alternative. | Sets which version the C&I form names. | Dossier section 18 item 5 |
| A2 | **Signed, witnessed Certification and Indemnity form** (Submission Requirements 6.3) naming "VenuePlay Draw RNG v1.2", "VenuePlay Phone Ticket v1.2", module VP-DRAW-1.2, manifest hash `889556b5...`, commit 18e2c58d (or whatever is live on the day). | OLGR will not open a submission without it. | Lodgement pack |
| A3 | **Submission letter** to the Executive Director, OLGR, ATTN Technical Unit (SR 6.2), dated, signed by Dean as director, with the file hashes of dossier section 2 on it (SR 8.2.3). | Not written; the enquiry email is first contact, not the letter. | Lodgement pack |
| A4 | **Company details check**: GFLAM GROUP PTY LTD t/a VenuePlay, ABN 35 679 383 049, 80 Michigan Drive, Oxenford QLD 4210, hello@venueplay.com.au, Dean Tindale, Director; whether the support phone belongs in a regulator letter. | Taken from the earlier drafts; not verified against a register. | Every document header |
| A5 | **Maximum prize figure**: AUD 20,000 (category 1, 2 and 4; category 3 out). Dean's 19 October answer; confirm in writing. | The RNG is approved with respect to it. | Dossier section 10; letter |
| A6 | **Tablet fallback for Queensland**: keep on and declared (as now), or set `TABLET_FALLBACK_OFF_STATES` to QLD in both halves (VP-DRAW-1.3). | Open since 19 October; the enquiry email now offers the switch to OLGR. | Dossier section 18 item 2 |
| A7 | **The two 20 October findings** (late-ball takeover within 30 s; deals after balls are out). Fix before lodgement or lodge with them listed. | Each was judged enough for a refusal. Unchanged in 1.2. | Dossier section 16 item 2 |
| A8 | **Opt-in capture on the bingo phone page** (SR 6.17): argue separation or move it off the page for Queensland venues. | Still on `play.html` at 18e2c58d. | Dossier section 16 item 5 |
| A9 | **The one scope sentence in the enquiry email** (marked DEAN TO DECIDE): keep it, reword it, or strike it. OLGR's 18 August letter named that product; the 20 October check said the letter needs a reason it is not submitted; Dean's standing rule is that it is not bingo and stays out of the submission. The dossier itself does not mention it. | Only Dean can settle how much OLGR is told. | OLGR-ENQUIRY-EMAIL-v1.2.md |
| A10 | **Operational security statement** (clause 4.2.8): who holds the Supabase service-role key and the Cloudflare account; MFA on both. | Only Dean knows. | Dossier section 17 |
| A11 | **Test venue login for OLGR officers** (clause 4.1.1): name the venue and how OLGR signs in. | To be named at lodgement. | Dossier section 15 |
| A12 | **Produce the v1.2 dossier as a PDF** and attach it to the enquiry email; the old `RNG-DOSSIER.pdf` is version 1.0 and must not be sent. | The email names the attachment. | Email attachment |
| A13 | **Evaluator route**: OLGR evaluates (Dean's preference) or an approved evaluator (BMM, ENEX, GTA, QALAB). Wait for OLGR's answer to question (c). | Decides whether a concept submission and a Third Party Correspondence form are needed. | QLD-PATH.md |
| A14 | **Accept or rename the component names** VP-STRIP-1, VP-CARDNO-2, VP-CLAIM-1, VP-PATTERN-1, VP-SWITCH-1, VP-DEAL-1 (new in VERSION-NAMES-v1.2.md), and the retirement of VP-TICKET-1/2/3 and VP-CARDNO-1. | Clause 4.1.3 wants every algorithm named; the names are proposals. | VERSION-NAMES-v1.2.md |
| A15 | **Phone the Technical Unit Manager** on 07 3738 8535 before lodging (SR 16). | Due 20 October; not recorded as made. | QLD-PATH.md |
| A16 | **Regenerate the statistical samples for VP-POOL-1, VP-STRIP-1 and VP-CARDNO-2 and redraw the two bingo flow charts** for the lodged commit (dossier sections 11.6 and 13). Needs the 17 October harness's file list and line ranges updated to VP-DRAW, then about 30 minutes of Chrome and workerd runs. | The 17 October samples for those three were of earlier text. | Evidence folder |
| A17 | **Dump the live SQL function bodies and the RLS baseline** at lodgement and compare with the files (dossier section 12). | Never done for any version of the pack. | Dossier section 12 |
| A18 | **Three hardening changes** (recommended, each a code change and a version bump): full SHA-256 and deployment id on /health; the raffle, members and SQL draw code under the manifest; a retention rule for the bingo record tables. | 20 October fixes 3 to 5; dossier section 18 item 9. | Code |
| A19 | **Dates**: lodgement date, C&I form date; "live since" for VP-DRAW-1.2 is 27 October 2026. | | Letter, form, cover email |

## B. Claims I could not verify in this pass (UNVERIFIED)

| # | Claim | Where it is made | What I checked, and why it is still open |
|---|---|---|---|
| B1 | `test-bingo-server-tickets.js` 80 of 80 and `test-caller-mode.js` 117 of 117 pass at the live module. | Dossier 11.4; change summary | Reported by the 26 October author at 373f6920 and by the suite ledger commit c60325cb; the VP-DRAW bytes are identical at 18e2c58d. Not rerun on 27 October (documents-only brief, light Mac). |
| B2 | Every new VP-DRAW-1.2 check has a prove-checks mutation that turns its suite red. | `vp-draw-1.2-custom-patterns.md` | `--list` was reported as "all 1,673 apply" on 26 October; the two-hour full run was not done then or now. |
| B3 | The TV and the phones show a custom pattern's name; the phone's BINGO button lights on a custom rule. | `vp-draw-1.2-custom-patterns.md`; PHONE-TICKETS-v1.2 item 4 | Code paths exist (`play.html` 529, 747, 768); not seen on a screen. The release note says a live play-through at Test Bravo was to follow the 27 October release; no record of it was read in this pass. |
| B4 | Migration 118 is run on the live database and `vp_bingo_patterns` is locked. | Migration header; commits 6f825453, 20dd43e5 | I did not query the live database. |
| B5 | The 20 October findings (late-ball takeover, deals after balls) still reproduce. | Dossier section 16 item 2 | The constant (`BINGO_UNSEEN_WINDOW_MS` 30,000) and the deal route's checks are present unchanged; the attack scripts were not rerun. |
| B6 | The strip maker's layout statistics (how often a column holds two numbers) for the new VP-STRIP-1 text. | Dossier 5.5 | Measured on 17 October for the old console text only. The dossier now says so instead of quoting the old figures. |
| B7 | The raffle and members selection text is unchanged since 17 October. | Dossier 7.1, 8.1 | Compared line by line with the v1.1 quotations by eye: the same. The 17 October lifted hashes covered different line ranges, so they are not a byte proof; the SQL file for members is byte-identical (hash). |
| B8 | The company details and the regulator addresses and fees in QLD-PATH.md are current. | QLD-PATH.md (16 October) | Not rechecked against the sources in this pass. |

## C. Where the earlier drafts contradicted the code (CONTRADICTS), now corrected in the v1.2 files

| # | The draft said | The code does (at 18e2c58d) | Corrected in |
|---|---|---|---|
| C1 | Dossier v1.1 sections 5.5, 5.6, 9, 16 item 1 and 18 item 3; PHONE-TICKETS.md sections 3 to 5; QLD-PATH.md question (e): tickets made on the host's tablet, master copy and verdict in the console and localStorage, "Path B" built but unused. | The server deals every ticket into `vp_bingo_tickets` and judges every claim from its own ticket and ball record, writing `vp_bingo_claims` (VP-DRAW-1.0, migration 104; live since 19 October). | RNG-DOSSIER-v1.2 5.5, 5.6, 9; PHONE-TICKETS-v1.2 |
| C2 | VERSION-NAMES.md: VP-TICKET-1 is the console's `makeStrip` in `index.html`, VP-TICKET-2 the console's `makeCard`, VP-TICKET-3 the Worker's `generateTicket`, VP-CARDNO-1 the console's `nextCardNo`. | One shared strip block in both VP-DRAW halves (`stripOfSix`); `makeCard` and `generateTicket` no longer exist; the ticket number is the server's `freshCardNo`. | VERSION-NAMES-v1.2 |
| C3 | OLGR-ENQUIRY-EMAIL.md: VenuePlay's own code is "under 150 lines in all, every line reproduced in the dossier". | The random selection is under 150 lines; the module that uses it is 963 + 211 lines plus three Worker routes. | OLGR-ENQUIRY-EMAIL-v1.2 |
| C4 | OLGR-ENQUIRY-EMAIL.md: attachment "RNG-DOSSIER.pdf, version 1.0, 16 October 2026"; "Safari and Chrome on the host's tablet"; "Each phone signs ... so a claim cannot be made for someone else's ticket" (implying the server checks it). | v1.2 supersedes; nothing limits the browser; the console verifies the signature, the server does not. | OLGR-ENQUIRY-EMAIL-v1.2 |
| C5 | Dossier v1.1 sections 1, 6, 9, 10, 16, 18 and VERSION-NAMES.md listed a second intended use with four named components. | Dean's ruling of 19 October 2026: not bingo, out of the Queensland approval. VP-DRAW has never included it. | Removed everywhere in the v1.2 pack; one optional sentence left in the email for Dean (A9) |
| C6 | Dossier v1.1 section 16 item 5: caller-mode undo deletes the withdrawn ball's row. | The row is kept and marked `withdrawn_at` (migration 103; `vp-draw.js` 283 to 290). | Dossier v1.2 5.4, 16 (closed) |
| C7 | Dossier v1.1 section 5.4 and 16 item 6: caller mode makes an unused shuffle. | A caller draw opens with an empty order and no seed; no shuffle (`vp-draw.js` 125 to 138). | Dossier v1.2 5.4 (closed) |
| C8 | Dossier v1.1 section 5.5: the strip tie-break is a random comparator inside `sort`; item 7 discloses it. | A random key per ticket (`rnd(1000000)`), and every strip validated. | Dossier v1.2 5.5 |
| C9 | 26 October sections and change summary: "The module is not yet deployed", branch `feature/custom-bingo-patterns`, commit 373f6920, "Live on 26 October: No". | On `main`; live 27 October 2026 (build e7318f47). | Change summary v1.2; dossier v1.2 |
| C10 | 26 October cover email: "[commit] as deployed on [date]". | 18e2c58d, 27 October 2026 (restate on the day). | Cover email v1.2 |
| C11 | Memory note of 25 October: migration 118 "written NOT run"; branch at b192add. | Run on live 26 October per commits 6f825453 and 20dd43e5; the memory file was updated on 27 October. | Memory, not the submission |
| C12 | `vp-draw.js` line 397 comment: "VP-TICKET-2: THE TICKET MAKER". | The strip maker, which the pack names VP-STRIP-1. A comment, not behaviour. | Dossier v1.2 section 16 item 13; fix in the next module version |

## D. Verified against the code and the live system on 27 October 2026 (for the record)

EVIDENCE-v1.2.md sections 1, 3 and 5: the live Worker's build, module version and manifest hash; the fingerprint recomputed from the committed Worker; `regulated.py --check` green; every in-scope page and script byte-identical to 18e2c58d; the function texts and behaviours listed there.
