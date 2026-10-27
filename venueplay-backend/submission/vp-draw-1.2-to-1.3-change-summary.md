# What changed between VP-DRAW-1.2 and VP-DRAW-1.3

For the Office of Liquor and Gaming Regulation, Technical Unit. One page. Prepared 29 October 2026 by GFLAM GROUP PTY LTD trading as VenuePlay, ABN 35 679 383 049. Read with `vp-draw-1.1-to-1.2-change-summary-v1.2.md`, which describes VP-DRAW-1.2.

**What VP-DRAW is.** VP-DRAW is the named, versioned bingo module inside VenuePlay: the code that draws the balls, makes the phone tickets, decides whether a BINGO claim is a win, and says when the host's tablet may stand in for the server. It is two files, one on our server and one on the host's tablet, hashed together in a manifest. The live server reports the module's version and manifest hash at https://venueplay-game.dean-tindale.workers.dev/health, so what is running can be checked against what is described here.

| | VP-DRAW-1.2 | VP-DRAW-1.3 |
|---|---|---|
| Date | 26 October 2026; live 27 October 2026 | 28 October 2026; live [date of release, filled at release] |
| Manifest hash | `889556b56c9dc21830f3edb36aa90fd4ba12cfab7a7487187d05471dc0495d6d` | `5a38cc075ab78ca7f8454df47914fc862b204b86c0bdd44471bd7a7f1001f244` |
| Server file `venueplay-backend/worker/vp-draw.js` | `8bf72207c6c6c9bdde86fefee031bac2f1b0638c55b45ef6f1650b46d5c64243` | `66cbd0473fd42db3e535338fef94835dcb53eb78dbdcc47e5762d2317f76ec6c` |
| Tablet file `venueplay/app/vp-draw.js` | `ea48ee30ce9289d85952cf61d8cf7fd95acadff9537868326cb4381a8ecd892b` | `ccfd7b9335636d16dc80591bc7efa287a4d03744b4fdc4dd0968e12e7c85ae0d` |
| Repository commit | `main`, live site at 18e2c58d | `main`, [release commit, filled at release] |
| Database change | migration 118 | none |
| Live | Yes, from 27 October 2026 | [`/health`: build and `draw_module VP-DRAW-1.3`, filled at release] |

**The one change.** It concerns only what happens after an outage, when the server could not be reached and the host's tablet dealt a player's ticket itself. When the server is reachable again, the tablet sends it the tickets it dealt so the server can record them and judge any claim on them. The server skips a ticket it has already recorded, because the tablet sends the whole hand each time it tries.

In VP-DRAW-1.2 the server treated a tablet ticket as already recorded when any of that player's tickets carried the same ticket number, including a server ticket that had been voided when the tablet took over. Ticket numbers are random, from 100 to 999, so in about 1 in 900 cases the tablet ticket the player was actually holding was not recorded, and a BINGO claim on it found no ticket. In VP-DRAW-1.3 only an earlier tablet ticket with the same number counts as already recorded. The ticket the player holds is always recorded, and sending the same hand again still records it once.

This was found by our own testing on 27 October 2026. We know of no game in which it happened. It could only arise after a recorded outage, which is when the tablet may stand in.

**What did not change.** The random number generator (the platform's `crypto.getRandomValues`, the rejection-sampling scaler `randInt` and the Fisher-Yates shuffle of 1 to 90) is the same text as in VP-DRAW-1.2. The component hashes in `VERSION-NAMES-v1.2.md` for the scaler (VP-SCALE-1, `0e024aa3...`), the shuffle, the ticket maker, the claim rule and the custom patterns are unchanged. The ball order, the one-ball-per-tap hand-out, the seven standard patterns, the venue's own patterns, the claim record and the rule for when the tablet may stand in are unchanged. The tablet file changes only in its version line. The result range (1 to 90), the frequency of calling and the number of results drawn in a game are unchanged, so the intended-use statement under clause 4.1.5 of the RNG minimum technical requirements v1.5 is unchanged.

The one component whose text changed is the second part of VP-DEAL-1, `bingoDealHands` (server file, lines 724 to 799 at 1.3). Its SHA-256 was `62273b3b0cc11dad2bfd378a3f57c8ae6e70b1c026a7b64d82280f3be059c5cf` at 1.2 and is `550a64aa0821b39da7b5d03b853021f2fb96467926119fcadb7e5fd8dd3fd524` at 1.3, computed with the script in `VERSION-NAMES-v1.2.md`. The line numbers of every server component after the header move down by 4 because the header gained a paragraph describing 1.3; their text and hashes are unchanged.

**Tests.** On 29 October 2026 at the branch commit: `tools/test-vp-draw-11.js` 46 of 46, which forces the shared number on every run and checks that the tablet ticket is recorded once and stands; `tools/test-bingo-server-tickets.js` 80 of 80; `tools/test-caller-mode.js` 119 of 119; `tools/test-bingo-draw-record-18-oct.js` 27; `tools/test-one-bingo-path.js` 18 of 18; `tools/test-draws-keep-an-honest-record.js` 24; `venueplay-backend/worker/rng-evidence.test.js` 12 of 12. `python3 tools/regulated.py --check` confirms both files match the manifest. [Live check after release, filled at release: `/health` reports VP-DRAW-1.3 and the manifest hash above, and a bingo game played at a test venue.]
