# What changed between VP-DRAW-1.1 and VP-DRAW-1.2 (v1.2)

For the Office of Liquor and Gaming Regulation, Technical Unit. One page. Prepared 27 October 2026 by GFLAM GROUP PTY LTD trading as VenuePlay, ABN 35 679 383 049. Supersedes the 26 October version (`vp-draw-1.1-to-1.2-change-summary.md`), which described the module before it was deployed; the facts that changed are the deployment state, the branch and the commit.

**What VP-DRAW is.** VP-DRAW is the named, versioned bingo module inside VenuePlay: the code that draws the balls, makes the phone tickets, decides whether a BINGO claim is a win, and says when the host's tablet may stand in for the server. It is two files, one on our server and one on the host's tablet, hashed together in a manifest. The live server reports the module's version and manifest hash at https://venueplay-game.dean-tindale.workers.dev/health, so what is running can be checked against what is described here.

| | VP-DRAW-1.1 | VP-DRAW-1.2 |
|---|---|---|
| Date | 20 October 2026 | 26 October 2026; live 27 October 2026 |
| Manifest hash | `9d1b390ad1e63d30fd8e7e358726c0ca0630d9114fcb808c25556fd4a4b366ae` | `889556b56c9dc21830f3edb36aa90fd4ba12cfab7a7487187d05471dc0495d6d` |
| Server file `venueplay-backend/worker/vp-draw.js` | (hash in the 1.1 manifest, commit 8eace3fb) | `8bf72207c6c6c9bdde86fefee031bac2f1b0638c55b45ef6f1650b46d5c64243` |
| Tablet file `venueplay/app/vp-draw.js` | (hash in the 1.1 manifest, commit 8eace3fb) | `ea48ee30ce9289d85952cf61d8cf7fd95acadff9537868326cb4381a8ecd892b` |
| Repository commit | `main`, live from 20 October 2026 | `main`, module from commit 859ecb88; live site at 18e2c58d |
| Database change | migrations 104, 105, 109 | adds migration 118 (`venueplay-118-custom-bingo-patterns.sql`), run on the live database 26 October 2026 |
| Live on 27 October 2026 | No | Yes (`/health`: build e7318f47, `draw_module VP-DRAW-1.2`) |

**The one change.** A venue may now save a winning pattern of its own, with a name, beside the seven standard patterns (one line, two lines, full house, four corners, top line, middle line, bottom line). A saved pattern is one of two rules and nothing else:

1. **Any N numbers**: at least N of the 15 numbers on a ticket have been called, N from 1 to 15.
2. **A shape**: every number inside a chosen set of squares on the 3 by 9 ticket has been called.

Only the venue's owner, or a manager the owner has allowed, can save or delete one. A host can pick one for a game and cannot change it. Each pattern records who saved it and when; a deleted pattern is kept on file, marked deleted.

**How a claim on it is decided.** Exactly as for the seven standard patterns. When a player presses BINGO, our server reads its own copy of that player's ticket and its own record of the balls called, and applies the rule itself. For a venue's own pattern, the server reads the rule from the venue's saved record, for that venue only. The host's tablet names which pattern; the server does not take the rule from the tablet or the phone, and if the tablet's copy of the rule disagrees with the saved one, the saved one is used and the disagreement is written on the claim. A pattern saved by one venue cannot be used in another venue's game. The host cannot confirm a claim the server has judged not to be a win.

**How it is recorded.** Every claim on a venue's own pattern is written to the claim record with the pattern's identifier and a copy of its name and rule as they stood at the time, so a claim can be read back correctly even if the venue later changes or deletes the pattern. The pattern table and the claim table are readable only by our server; no venue login, host login or public connection can read or write them.

**What did not change.** The random number generator (the platform's `crypto.getRandomValues`, the rejection-sampling scaler and the Fisher-Yates shuffle of 1 to 90) is the same text as in VP-DRAW-1.1 and in the dossier. The ball order, the one-ball-per-tap hand-out, the ticket maker, the seven standard patterns and the tablet fallback are unchanged. A claim on a standard pattern writes exactly the record it wrote in 1.1. The result range (1 to 90), the frequency of calling and the number of results drawn in a game are unchanged, so the intended-use statement under clause 4.1.5 of the RNG minimum technical requirements v1.5 is unchanged. A winning pattern is a condition tested against a ticket after the balls are drawn; it does not call or alter the generator.

**Tests.** The repository's bingo suite (`tools/test-bingo-server-tickets.js`, 80 checks) and caller-mode suite (`tools/test-caller-mode.js`, 117 checks) passed on 26 October 2026 at commit 373f6920, whose two module files are byte-identical to the ones live; the checks include the two halves of the module agreeing on 1,500 random tickets under the new rules, a laxer rule sent by the tablet not being used, another venue's pattern refused, and a deleted pattern still judged. `python3 tools/regulated.py --check` on 27 October 2026 confirms both files match the manifest.
