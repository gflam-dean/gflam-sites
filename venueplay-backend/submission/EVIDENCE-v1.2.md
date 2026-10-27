# Evidence pointers for the v1.2 pack: what is live, what was checked, and how

27 October 2026. Everything below was read on that day from a fresh read-only checkout of `origin/main` (worktree `~/gflam-ai-team/sites-wt-olgr-docs`, branch `docs/olgr-dossier-27-oct`), the live site and the live Worker, with git, curl, shasum and python only. No browser was opened, no code was changed, nothing was deployed.

## 1. The live build

| What | Value | How read |
|---|---|---|
| Game Worker /health | `build "24 Oct 2026, 23:08 · e7318f47"`, `draw_module "VP-DRAW-1.2"`, `draw_manifest "889556b56c9dc21830f3edb36aa90fd4ba12cfab7a7487187d05471dc0495d6d"`, `ok true`, `missing []`, `venue_code_clashes 0` | `curl https://venueplay-game.dean-tindale.workers.dev/health` |
| Site commit | `18e2c58dea30cc42805dda0e3beed09a67862d73` (short form `18e2c58d`), 27 October 2026, "Gate: the flake log is written by every gate run..." | `git fetch`; `git rev-parse origin/main` |
| Commit the screens were verified against | `22b78640` 27 October 2026 09:45 +1000, "Screens verified live for e7318f47 (custom patterns, VP-DRAW-1.2)" | `git log` |
| Difference between 22b7864 and 18e2c58d in any in-scope or regulated file | `venueplay/tv.html` only: five inserted lines (a comment and one `window.__vpAdClock` line for the screen check), outside the regulated module. The VP-DRAW files, the Worker, `play.html`, `app/index.html`, `vp-phonekey.js` and `vp-sign.js` are byte-identical in both | `git diff --stat 22b7864 HEAD -- <files>` |
| Worker fingerprint recomputed from the committed file | `e7318f47` (SHA-256 of `venueplay-game.js` with its `const BUILD` line removed, first eight hex digits, the rule in `tools/stamp-workers.py` line 82) | python, in the checkout |
| Module manifest check | "VP-DRAW VP-DRAW-1.2, manifest 889556b56c9d: both halves match the manifest" | `python3 tools/regulated.py --check` |

## 2. Hashes at 18e2c58d (SHA-256, bytes)

| File | SHA-256 | Bytes |
|---|---|---|
| `venueplay-backend/worker/vp-draw.js` | `8bf72207c6c6c9bdde86fefee031bac2f1b0638c55b45ef6f1650b46d5c64243` | 61,013 (963 lines) |
| `venueplay/app/vp-draw.js` | `ea48ee30ce9289d85952cf61d8cf7fd95acadff9537868326cb4381a8ecd892b` | 11,373 (211 lines) |
| `tools/regulated-manifest.json` | `dd008b95383e84a554cb5bb134828985a69e593a7fb3b8855ac985b58444b497` | 1,877 |
| `venueplay-backend/worker/venueplay-game.js` | `0ecee6ab1808dab9ed56b009042b0ac569e9a4dc59ced66d88ec425fd01ea52b` | 729,334 |
| `venueplay/play.html` | `d0a812d666343945517009dff821e4339e995c5ffcecd700aaed0a335dfbe4b0` | 149,761 |
| `venueplay/app/index.html` | `5ec3b42a022a976937c70ed2ddd220d9d365c87a57ddb595e33f17050d58a74c` | 286,347 |
| `venueplay/tv.html` | `bfda5b1087f6f52112c78276aad02be75d5f2966da687a7e2e3afa364d8ec1e1` | 192,413 |
| `venueplay/tv.html` at 22b7864 | `b97e68c45d046c61a7d2e6afc784e5434db270d7d27a54c6c9ccfe89efe93396` | (not served any more) |
| `venueplay/app/vp-phonekey.js` | `39dc4931ad8b3612397501b6ea54c0ca7d5e72754fda488d0fd5bdad5064948f` | 9,213 |
| `venueplay/app/vp-sign.js` | `841354af9280a86e57817f17846af44e62ddb31b1fe175c3310bdccf69aab71f` | 32,478 |
| `venueplay-backend/supabase/venueplay-70-bingo-server-draw.sql` | `c9a16c3ac8461d62a28e4a7452eaf8a541222421e1bdd09bd63ffdc569dd6836` | 6,038 |
| `venueplay-backend/supabase/venueplay-76-one-trip-host-draws.sql` | `490051d6e997b554e64dc5d128dc86bdfe5cd281cfa5e2b85ef289ab1af0114f` | 16,326 |
| `venueplay-backend/supabase/venueplay-90-members-draw-one-at-a-time.sql` | `aad3875ffafb0efe398a9c0b0fecd7362a153a358b5286dac57fbc08fea24fa7` | 6,907 |
| `venueplay-backend/supabase/venueplay-104-bingo-server-tickets.sql` | `3ecad04c15cee4d76938ea1224294d1cdfed97f70728be9b149c40774bf82093` | 8,572 |
| `venueplay-backend/supabase/venueplay-105-bingo-outage-record.sql` | `9f2e0b4ca5a772a67a2abd9c9af63c3750fa01802eb0aac82be37b32cc15dd58` | 3,658 |
| `venueplay-backend/supabase/venueplay-109-bingo-unseen-and-finished.sql` | `fb2db1fa89baaeb9e3a664bd021b07400cc2d72e275ae225d6ffaa1e1939601b` | 4,115 |
| `venueplay-backend/supabase/venueplay-118-custom-bingo-patterns.sql` | `fc58d15b62c9b3735c2e1afdde7ca07cc4a61c4c0aab668e45ed75beb381daa0` | 4,915 |
| `venueplay-backend/worker/rng-evidence.test.js` | `55965b567d2888266b371d629b513f01e05d373cddb6ebd0518656aaac233333` | 7,060 |

The VP-DRAW file hashes, the manifest hash, the Worker hash and the migration hashes are the same values the 26 October sections quoted at branch commit 373f6920: the module did not change between that commit and `main`.

Files whose hash is unchanged since the 17 October manifest (`qld/evidence/manifest.tsv`, commit 9c56748a): `vp-phonekey.js`, `vp-sign.js`, migrations 70, 76 and 90, `rng-evidence.test.js`. Everything else in scope changed.

## 3. The live site against the commit

Downloaded with curl from `https://venueplay.com.au/` (`www.venueplay.com.au` answers 301 to the apex; the first fetch without following the redirect returned a 167-byte Cloudflare redirect page, which is why the fetch was repeated with `-L`):

| Served path | Bytes | SHA-256 matches 18e2c58d |
|---|---|---|
| `/app/vp-draw.js` | 11,373 | yes |
| `/app/` (`app/index.html`) | 286,347 | yes |
| `/play` (`play.html`) | 149,761 | yes |
| `/tv` (`tv.html`) | 192,413 | yes (and therefore not 22b7864's) |
| `/app/vp-phonekey.js` | 9,213 | yes |
| `/app/vp-sign.js` | 32,478 | yes |

## 4. Commits that matter

| Commit | Date | What |
|---|---|---|
| 9c56748a | 17 Oct 2026 | The commit the v1.1 dossier and old evidence pack are pinned to (pre VP-DRAW) |
| 1b43beed | 19 Oct 2026 17:02 | VP-DRAW-1.0: the regulated bingo code in its own module; manifest; version rule in the gate; version and manifest hash on /health. Reverted the same evening (03482f25, a console freeze on Open lobby) and restored (b8f2087d) |
| 25cb767a, 20a7726a, 8eace3fb | 20 Oct 2026 14:04 | VP-DRAW-1.1: outage record after a real failure only, unseen ball and ticket voided, deal asks recorded, draws finished, shared strip algorithm; migration renumbered 109 |
| 7324c53 | 20 Oct 2026 | The commit the 20 October compliance check read (live that day: VP-DRAW-1.1, build e779a213) |
| 859ecb88 | 26 Oct 2026 15:47 | VP-DRAW-1.2: custom patterns per venue, migration 118, Back to the last game |
| 6f825453 | 26 Oct 2026 16:00 | "Migration 118 is run on live (vp_bingo_patterns exists, 26 Oct 2026)" |
| 20dd43e5 | 26 Oct 2026 22:01 | RLS baseline: vp_bingo_patterns, RLS on, no policy, no grant |
| 373f6920 | 26 Oct 2026 22:08 | The commit the 26 October sections were read at |
| e6e368f8 | 26 Oct 2026 22:18 | The four 26 October OLGR files committed |
| c60325cb | 26 Oct 2026 22:42 | Suite ledger: bingo-server-tickets 53 to 80, test-caller-mode 114 to 117, caller-winner 52 to 96 |
| 22b78640 | 27 Oct 2026 09:45 | Screens verified live for e7318f47 (custom patterns, VP-DRAW-1.2). Live play-through from 10:13 per the release note |
| 18e2c58d | 27 Oct 2026 | `origin/main` when this pack was made; gate tooling and the five tv.html lines only, after 22b7864 |

## 5. What was verified against the code on 27 October 2026

Read in the module and the Worker at 18e2c58d: `randInt` and `shuffle1to90` identical to the text in the v1.1 dossier; `cryptoInt` identical; the VP-STRIP block identical in both halves (same hash); `TABLET_FALLBACK_OFF_STATES` empty in both halves; caller mode opens a draw with an empty order and no shuffle; caller undo keeps the row marked withdrawn; `/host/bingo/deal` refuses a finished draw, a caller draw and a paper state, caps 24 tickets, writes tablet tickets with `balls_at_deal`; the claim handler reads the server's tickets and balls, compares the console's rule and ball list without using them, writes a row for every claim, and refuses a host confirmation of a non-win except on a recorded outage where the state allows; `bingoRuleClean` and `customTicketWins` as quoted; `bingoCustomPattern` filters by the draw's venue; the three pattern routes require owner or manager to save or delete; `BINGO_UNSEEN_WINDOW_MS` is 30,000; the raffle pick loop and the members eight-value block read the same as the v1.1 quotes; `members[randInt(members.length)]` fallback present; no `generateTicket` or `makeCard` in the Worker or the console; the phone's `/capture` call present; no signature verification in the server half.

## 6. What was not verified on 27 October 2026, and why

- The repository suites (`test-bingo-server-tickets.js` 80, `test-caller-mode.js` 117, `rng-evidence.test.js` 12) were not run; the pass counts are the 26 October author's at 373f6920 (same VP-DRAW bytes) and the suite ledger commit c60325cb. The brief for this pass was documents only and a light Mac.
- The 20 October attack scripts (`qld/compliance-check-2026-10-20/harness/attack-tests.js`) were not rerun; the constants and routes they exercise are present unchanged.
- The live database was not queried: migration 118 "run on live" rests on commits 6f825453 and 20dd43e5; the SQL function bodies as live were not dumped.
- No page was opened in a browser; nothing about what the phone, console or TV paints is claimed here beyond the code paths.
- The statistical samples were not regenerated (RNG-DOSSIER-v1.2.md section 11.6).
- `rng-test-results.md` in this folder (26 October) names no harness, date or raw file and says it tested a reimplementation of `randInt`; it is not relied on by this pack.
