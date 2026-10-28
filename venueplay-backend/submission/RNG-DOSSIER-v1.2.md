# VenuePlay random number generation and phone bingo tickets: technical description for approval

Version of this document: 1.2, 27 October 2026. Supersedes version 1.1 of 17 October 2026 (`~/venue-enrich/rng-certification/RNG-DOSSIER-v1.1.md`, kept unchanged) and folds in the insert sections of 26 October 2026 (`vp-draw-1.2-submission-sections.md`, kept unchanged). CHANGES.md in this folder lists every supersession.
Prepared by: GFLAM GROUP PTY LTD trading as VenuePlay, ABN 35 679 383 049, 80 Michigan Drive, Oxenford QLD 4210, hello@venueplay.com.au
Equipment described: **VenuePlay Draw RNG v1.2** and **VenuePlay Phone Ticket v1.2**, whose bingo parts are the one named module **VP-DRAW-1.2** (manifest hash `889556b56c9dc21830f3edb36aa90fd4ba12cfab7a7487187d05471dc0495d6d`), as deployed from repository https://github.com/gflam-dean/gflam-sites, branch `main`, commit **18e2c58dea30cc42805dda0e3beed09a67862d73** (18e2c58d below). On 27 October 2026 the live game Worker reports build "24 Oct 2026, 23:08 · e7318f47", `draw_module VP-DRAW-1.2` and `draw_manifest 889556b5...` at https://venueplay-game.dean-tindale.workers.dev/health, and every in-scope page and script served from https://venueplay.com.au/ is byte-identical to that commit (section 12).

Written to clause 4.1 of the Queensland OLGR "Random number generator minimum technical requirements" v1.5 and sections 8 to 10 of the OLGR "Submission requirements" v1.7. Section numbers are this document's own and follow version 1.1 where the subject is the same. Line numbers are to the files at commit 18e2c58d.

A reading note. Everything in this document was checked against the code at that commit on 27 October 2026 unless it says otherwise. Where a statement rests on a test that was run on 17 October 2026 against earlier code, or on a fact only Dean Tindale can confirm, the text says so in place. Nothing here is carried forward from version 1.1 without that check.

## 0. What changed since version 1.1

1. **The regulated bingo code is one named, versioned module, VP-DRAW** (19 October 2026, after version 1.1). The draw, the ticket maker, the claim rule and the tablet-fallback switch live in two files, one on the server and one on the host's tablet, hashed together in a manifest whose hash the live Worker reports on /health. Version 1.1 described the same functions spread across the console page and the Worker; sections 2 and 12.
2. **The server deals the phone tickets and decides every claim** (VP-DRAW-1.0, 19 October 2026, migration 104). Version 1.1 section 5.6 and PHONE-TICKETS.md described tickets held on the host's tablet and a verdict computed in the console. That is no longer the product. Sections 5.5 and 5.6.
3. **The tablet stands in only after an outage the server itself recorded** (VP-DRAW-1.1, 20 October 2026, migrations 105 and 109). Section 5.3.
4. **A venue's own winning pattern** (VP-DRAW-1.2, live 27 October 2026, migration 118). Section 5.8. The random number generator is unchanged.
5. **Scope.** This application covers 90-ball bingo (balls and phone tickets), raffles and members draws. Nothing else is submitted.
6. **Closed since 1.1:** caller-mode undo keeps the withdrawn ball on the record (section 5.4); caller mode makes no shuffle at all (section 5.4); the single-ticket and Worker ticket makers of version 1.1 (VP-TICKET-2, VP-TICKET-3) no longer exist in the code.
7. **The statistical evidence of 17 October 2026** (section 11) is carried forward only for the components whose text is unchanged, and is marked as needing a rerun for the ones whose text changed. Section 11.6 says which is which.

## 1. Summary

VenuePlay is software that a club, charity or pub uses to run its own bingo, raffle or members draw on the venue's television, with players joining from their phones. The venue conducts the game and handles any money. VenuePlay supplies the software, the random selection, and for bingo the tickets shown on players' phones.

There is no proprietary generator. Every random value comes from `crypto.getRandomValues`, the Web Cryptography API's cryptographically strong generator, as implemented by the runtime: the Cloudflare Workers runtime on the server and the browser on the host's tablet (VP-ENTROPY-1). VenuePlay's own code is the scaling and selection on top of it:

- one scaling algorithm, VP-SCALE-1, a rejection sampler giving a uniform integer in [0, n) with zero modulo bias;
- one shuffle, VP-SHUFFLE-1, a Fisher-Yates permutation built on VP-SCALE-1;
- selection procedures: VP-BALL-1 and VP-POOL-1 (bingo balls), VP-STRIP-1 and VP-CARDNO-2 (bingo tickets), VP-RAFFLE-1 (raffle) and VP-MEMBERS-1 (members draw);
- two rules that call the generator zero times: VP-CLAIM-1 (the seven standard bingo patterns) and VP-PATTERN-1 (a venue's own pattern);
- and one path with no RNG at all, VP-CALLER-1, for a bingo night called with real balls.

The overall designations proposed for the submission letter (clause 4.1.2):

| Name | Version | Covers |
|---|---|---|
| VenuePlay Draw RNG | 1.2 | VP-ENTROPY-1, VP-SCALE-1, VP-SHUFFLE-1, VP-BALL-1, VP-POOL-1, VP-RAFFLE-1, VP-MEMBERS-1; VP-CALLER-1 named as the no-RNG path |
| VenuePlay Phone Ticket | 1.2 | VP-STRIP-1, VP-CARDNO-2, VP-CLAIM-1, VP-PATTERN-1, the phone page, the console page and the two signing modules |

The bingo parts of both are the module VP-DRAW-1.2. The raffle and members draw code is in the game Worker outside that module (section 16, item 9).

## 2. Files and versions in scope

The full component table, with the line range of every function and the SHA-256 of its exact text, is VERSION-NAMES-v1.2.md in this folder. The files at commit 18e2c58d:

| File (repository path) | Bytes | SHA-256 | Checked live | Role |
|---|---|---|---|---|
| `venueplay-backend/worker/vp-draw.js` | 61,013 | `8bf72207c6c6c9bdde86fefee031bac2f1b0638c55b45ef6f1650b46d5c64243` | as the copy inside the Worker (stamp, section 12) | VP-DRAW, server half, 963 lines: `randInt`, `shuffle1to90`, the strip maker, `freshCardNo`, the claim rule including a venue's own pattern, the routes `/host/bingo/draw`, `/ball`, `/fallback`, `/deal`, `/claim`, `/claim/resolve`, `/finish`, and the tablet-fallback switch |
| `venueplay/app/vp-draw.js` | 11,373 | `ea48ee30ce9289d85952cf61d8cf7fd95acadff9537868326cb4381a8ecd892b` | byte-for-byte download | VP-DRAW, tablet half, 211 lines: `cryptoInt`, `drawFromPool`, `makeStrip` (the same strip text as the server), `cardWins`, `ruleClean`, `customWins`, `isRefusal`, `standInAllowed` |
| `tools/regulated-manifest.json` | 1,877 | `dd008b95383e84a554cb5bb134828985a69e593a7fb3b8855ac985b58444b497` | its `manifest_hash` is on /health | The manifest: module name, version, the two file hashes above, one hash over all of it, and the reason for every version change. Written only by `tools/regulated.py --update` |
| `venueplay-backend/worker/venueplay-game.js` | 729,334 | `0ecee6ab1808dab9ed56b009042b0ac569e9a4dc59ced66d88ec425fd01ea52b` | /health stamp `e7318f47` | The game Worker as deployed (one file). Carries the VP-DRAW copy (lines 6541 to 7505), `VP_DRAW_MANIFEST` (line 151), the three pattern routes (lines 346 to 348, handlers 7542 to 7599), VP-RAFFLE-1 (lines 3721 to 3735) and VP-MEMBERS-1 (lines 3869 to 3872 and 3976) |
| `venueplay/play.html` | 149,761 | `d0a812d666343945517009dff821e4339e995c5ffcecd700aaed0a335dfbe4b0` | byte-for-byte download | The bingo phone page: shows the ticket, sends the signed claim. Its own `cryptoInt` is non-prize |
| `venueplay/app/index.html` | 286,347 | `5ec3b42a022a976937c70ed2ddd220d9d365c87a57ddb595e33f17050d58a74c` | byte-for-byte download | The bingo console: loads `/app/vp-draw.js` (line 708) and refuses to deal, draw or judge without it (line 3095); carries the claim to the server; caller mode |
| `venueplay/app/vp-phonekey.js` | 9,213 | `39dc4931ad8b3612397501b6ea54c0ca7d5e72754fda488d0fd5bdad5064948f` | byte-for-byte download | Phone keypair and message signing (pid = key fingerprint). Unchanged since 17 October |
| `venueplay/app/vp-sign.js` | 32,478 | `841354af9280a86e57817f17846af44e62ddb31b1fe175c3310bdccf69aab71f` | byte-for-byte download | Console and TV broadcast signing. Unchanged since 17 October |
| `venueplay/tv.html` | 192,413 | `bfda5b1087f6f52112c78276aad02be75d5f2966da687a7e2e3afa364d8ec1e1` | byte-for-byte download | Display only; contains the VP-SCALE-1 text for non-prize animation |
| `venueplay-backend/supabase/venueplay-70-bingo-server-draw.sql` | 6,038 | `c9a16c3ac8461d62a28e4a7452eaf8a541222421e1bdd09bd63ffdc569dd6836` | not reachable from outside | `vp_bingo_next_ball` (VP-BALL-1), draw tables and their access rules. Unchanged since 17 October |
| `venueplay-backend/supabase/venueplay-76-one-trip-host-draws.sql` | 16,326 | `490051d6e997b554e64dc5d128dc86bdfe5cd281cfa5e2b85ef289ab1af0114f` | not reachable from outside | `vp_bingo_ball` (VP-BALL-1 one-trip wrapper). Unchanged since 17 October |
| `venueplay-backend/supabase/venueplay-90-members-draw-one-at-a-time.sql` | 6,907 | `aad3875ffafb0efe398a9c0b0fecd7362a153a358b5286dac57fbc08fea24fa7` | not reachable from outside | `vp_members_draw` (VP-MEMBERS-1 Postgres half). Unchanged since 17 October |
| `venueplay-backend/supabase/venueplay-104-bingo-server-tickets.sql` | 8,572 | `3ecad04c15cee4d76938ea1224294d1cdfed97f70728be9b149c40774bf82093` | not reachable from outside | Tables `vp_bingo_tickets` and `vp_bingo_claims` |
| `venueplay-backend/supabase/venueplay-105-bingo-outage-record.sql` | 3,658 | `9f2e0b4ca5a772a67a2abd9c9af63c3750fa01802eb0aac82be37b32cc15dd58` | not reachable from outside | The server's own record of a failed ball or deal |
| `venueplay-backend/supabase/venueplay-109-bingo-unseen-and-finished.sql` | 4,115 | `fb2db1fa89baaeb9e3a664bd021b07400cc2d72e275ae225d6ffaa1e1939601b` | not reachable from outside | Voided balls and tickets with a reason, finished draws, deal and ask timestamps |
| `venueplay-backend/supabase/venueplay-118-custom-bingo-patterns.sql` | 4,915 | `fc58d15b62c9b3735c2e1afdde7ca07cc4a61c4c0aab668e45ed75beb381daa0` | not reachable from outside | Table `vp_bingo_patterns` and the two claim columns for a custom claim |
| `venueplay-backend/worker/rng-evidence.test.js` | 7,060 | `55965b567d2888266b371d629b513f01e05d373cddb6ebd0518656aaac233333` | not deployed | Release-gate evidence suite. Unchanged since 17 October |

**Versioning rule for the module.** Any change to either VP-DRAW file must raise the version string in both halves and regenerate the manifest in the same commit. `python3 tools/regulated.py --check` runs in the release gate and refuses a Worker whose module copy, file hashes, version strings or fallback switch differ from the manifest or from each other (`tools/regulated.py`, lines 21 to 28). Version history: VP-DRAW-1.0 (19 October 2026, commit 1b43beed), VP-DRAW-1.1 (20 October 2026, commit 8eace3fb), VP-DRAW-1.2 (26 October 2026, commit 859ecb88; on `main` and live 27 October 2026). The manifest records the reason for each.

**Proposed approval boundary** (Submission Requirements 6.9; the Act s 100B(2)): the approved equipment is the two VP-DRAW files, identified by the manifest hash, plus the three SQL functions and the raffle and members selection code named in VERSION-NAMES-v1.2.md. A change elsewhere in the same deployed file (a menu, a colour) changes the Worker's build stamp but not the manifest hash, which is how VenuePlay proposes to show that such a change is not a modification of the approved equipment. The submission letter should ask OLGR whether it accepts that (section 18).

JavaScript and SQL are not compiled. "Building" is deploying the files as they are: the Worker by Cloudflare's API (`tools/deploy-worker.py`), the pages by Cloudflare's static hosting from the repository, the SQL by running the migration files in order in the Supabase SQL editor.

## 3. The entropy source: VP-ENTROPY-1

Unchanged from version 1.1 in substance; restated here so this document stands alone.

**Name:** Web Cryptography API `Crypto.getRandomValues()` (W3C Web Cryptography API).

**Where it runs and how VenuePlay calls it:**

- Server: the Cloudflare Workers runtime (workerd, on V8). `deploy-game/wrangler.toml` sets compatibility date 2026-08-01; the deploy tool keeps whatever the deployed Worker already has, so the date in force is to be read from the Cloudflare dashboard at lodgement. Calls: `Uint32Array(1)` (VP-SCALE-1), `Uint32Array(8)` (VP-MEMBERS-1), `Uint8Array(16)` and `Uint8Array(32)` (audit identifiers and tokens, `randomTokenHex`, `venueplay-game.js` line 10709).
- Browser: the host's tablet, whatever browser the venue uses, for VP-POOL-1 and for tickets dealt on the tablet during a recorded outage. Calls: `Uint32Array(1)`.

**Why no generator source is submitted.** Clause 4.9.1 allows an RNG within a commercially available product whose source is not submitted, where the process for generating randomness is known and the product is well known with a demonstrated track record. The Web Crypto generator is specified by the W3C and implemented in open-source runtimes (workerd, V8, Chromium, WebKit) that use it for every TLS session they make. VenuePlay has no seed, no state and no reseeding logic of its own; the runtime's generator state is never exposed to script (clause 4.2.2).

**Cryptographic strength (clause 4.5).** On the server, workerd is built on BoringSSL and is understood to fill `getRandomValues` from BoringSSL's generator, which seeds from the operating system and reseeds; in browsers the vendor's implementation draws on the operating system's CSPRNG. Neither statement has been traced to a source line for this pack; the exact library call and reseeding interval are to be cited with source references at lodgement (section 19).

**Failsafe (clause 4.2.5).** `getRandomValues` either fills the array or throws; it never returns weak output. On the server a throw fails the request, so no ball, winner or ticket is recorded. On the tablet a throw interrupts the function that was dealing or drawing, so no ticket or ball is produced from it.

**Cycle (Submission Requirements 10.2.6):** not applicable; the generator is continuously reseeded by the runtime.

**Measured.** Section 11 tests 320 MiB of raw output from each of two runtimes, taken on 17 October 2026. The raw source has not changed, so that evidence stands.

## 4. Scaling and mapping

### 4.1 VP-SCALE-1: uniform integer in [0, n) by rejection sampling

Version 1, text unchanged since the Worker's review of 4 August 2026 and identical to the text quoted in version 1.1. Server form, `venueplay-backend/worker/vp-draw.js` lines 33 to 39 (the same text at `venueplay-game.js` lines 6574 to 6580):

```js
function randInt(max) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % max;
}
```

Tablet form, `venueplay/app/vp-draw.js` line 28:

```js
  function cryptoInt(max){ var a=new Uint32Array(1),lim=Math.floor(4294967296/max)*max,x; do{ crypto.getRandomValues(a); x=a[0]; }while(x>=lim); return x%max; }
```

Let L = floor(2^32 / n) x n. Draw a uniform 32-bit x; if x >= L discard it and draw again; otherwise return x mod n. L is a whole multiple of n, so over 0..L-1 every residue occurs exactly L/n times and every result has probability exactly 1/n (clause 4.7.1). The rejection probability is below n / 2^32: under 2.1 x 10^-8 for n = 90. The prize-relevant callers use n from 2 to 1,000,000 (the strip maker's tie-break keys, section 5.5), plus the raffle span, which is whatever range the venue types (section 7); the method is exact for any n up to 2^32.

### 4.2 VP-SHUFFLE-1: Fisher-Yates permutation of 1 to 90

Version 1, text identical to version 1.1. `vp-draw.js` lines 45 to 53:

```js
function shuffle1to90() {
  const a = [];
  for (let i = 1; i <= 90; i++) a.push(i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
```

At step i a uniform j in [0, i] is chosen with VP-SCALE-1 and positions i and j are swapped (Durstenfeld's form). Every j is exactly uniform, so each of the 90! orders has probability exactly 1/90!. Section 11 tests the loop exhaustively on five items (all 120 orders, 1,200,000 shuffles, 17 October).

## 5. Intended use 1: 90-ball bingo

**Game.** 90-ball housie on phone tickets, or (caller mode) on the venue's paper books. The host calls one number at a time; players mark; a player claims an announced pattern: one of seven standard patterns (one line, two lines, full house, top, middle, bottom line, four corners) or a pattern the venue has saved (section 5.8).

**Result range.** 1 to 90, each at most once per game. **Results and frequency.** Up to 90 per game, one per host tap, a five-second hold in the console and a four-second hold on the server (`BINGO_SERVER_HOLD_MS`, line 75). Two to six games a night, typically one night a week.

**Prizes.** VenuePlay records the prize the host types for the screen and no value. The maximum prize to be stated for the approval is Dean's decision (section 18); the proposal is AUD 20,000, with category 3 games out of scope.

### 5.1 Where the order is generated

At game start the console calls `POST /host/bingo/draw`. `handleBingoDrawStart` (lines 114 to 149) shuffles 1 to 90 with VP-SHUFFLE-1 and stores the order in `vp_bingo_draws.draw_order` with a 16-byte audit identifier in `draw_seed` (an identifier, not a seed; nothing is derived from it), and replies with the draw's id, whether the tablet may stand in at this venue, and the list of states where it may not. The order is never sent to any client (line 141: "never leaves this function"). Opening a new draw finishes the venue's previous draw on the record (line 145).

### 5.2 VP-BALL-1: one ball per tap

Version 1 (migrations 70 and 76; the two SQL files are byte-identical to 17 October). Each tap calls `POST /host/bingo/ball` (`handleBingoBall`, lines 168 to 180), which calls Postgres `vp_bingo_ball` with the four-second hold; that function checks host and venue, the hold, and refuses a finished or tablet-mode draw, then calls `vp_bingo_next_ball` (migration 70, from line 79): lock the draw row, advance the index by one, return that one number and write it to `vp_bingo_draw_balls` with its ordinal, time and `source = 'server'`. The row lock means the same index can never be handed out twice; the unique keys on `(draw_id, number)` and `(draw_id, ordinal)` make a repeated number impossible to record. VP-BALL-1 has no randomness of its own.

New since 1.1: if the server fails to answer a ball request for any reason other than a refusal, it records the failure itself against that place in the order (`bingoRecordFailedAsk`, line 156; migration 105). That record is what later lets the tablet's ball for that place be accepted (5.3).

### 5.3 VP-POOL-1: the tablet fallback, and when it is allowed

Version 2 (the text changed from version 1.1: the function takes the pool as an argument; the algorithm is the same). If the Worker does not answer within four seconds, the console calls the rest of that game itself, one ball at a time, uniformly from the numbers not yet called. `venueplay/app/vp-draw.js` lines 140 to 144:

```js
  function drawFromPool(pool){
    if(!pool || !pool.length) return null;
    var k=cryptoInt(pool.length);
    return pool.splice(k,1)[0];
  }
```

Drawing a uniform element of the remaining pool at each step gives exactly the distribution of a Fisher-Yates order read out in turn, and no future number exists anywhere until it is drawn. Each tablet ball is reported to `POST /host/bingo/fallback` (`handleBingoFallback`, lines 262 to 351), which marks the draw `mode = 'local'` with the ordinal where the fallback began and the console's reason, and records the ball with `source = 'local'`; the server refuses a repeated number or a skipped ordinal rather than record something false.

**The rules the server applies before it accepts a tablet ball** (VP-DRAW-1.1, read from the module on 27 October 2026):

- The switch. `TABLET_FALLBACK_OFF_STATES` (server line 83, tablet line 26) names the states whose venues get no tablet fallback at all: no ball, no ticket, no claim confirmed on the tablet's check. The server refuses all three for such a venue and the console learns the list from `/host/bingo/draw` and waits instead. The list is empty at this commit (Dean's decision to keep the fallbacks, section 18). Queensland off is one line in each half and a version bump; `tools/test-fallback-switch.js` makes that change in memory and proves the switch works.
- A refusal is not an outage. A 4xx answer (signed out, paused, finished) never lets the tablet stand in (`isRefusal`, tablet line 201).
- A tablet ball for a place the server itself failed to fill is accepted on the server's own record of that failure (`serverFailedBall`, line 100). A server ball that the room never saw, because the console gave up at four seconds and the server answered late, is voided on the record with a reason and the room's ball stands, but only within `BINGO_UNSEEN_WINDOW_MS` (30 seconds, line 107) of the server ball. Section 16 item 2 records the 20 October finding about that window.

Whether to keep this fallback for Queensland is Dean's decision (section 18).

### 5.4 VP-CALLER-1: caller mode, real balls, no RNG

For a venue that draws real balls, the console offers "Real balls (caller mode)". Nothing in VenuePlay selects a number on such a night:

- The draw is opened already `mode = 'local'`, `fallback_why = 'caller'`, with an empty order and `draw_seed = 'none: real balls'` (`handleBingoDrawStart`, lines 125 to 138). **No shuffle is made** (version 1.1 item 6 is closed). `vp_bingo_ball` refuses to hand any ball out on such a draw.
- No phone ticket is dealt: `/host/bingo/deal` refuses every hand on a caller draw (lines 659 to 664), and the phones are told to use their paper book.
- The operator taps the number just called; it is recorded through `POST /host/bingo/fallback` with the reason `caller`. A `caller` ball is accepted only on a draw opened for real balls, and only caller balls on one (lines 290 to 293).
- Undo: the operator can withdraw the last standing ball only, only on a caller-mode draw, only a ball the tablet put there. **The row is kept and marked `withdrawn_at`** (migration 103; lines 283 to 290). Version 1.1 item 5 is closed.

Caller mode is, in RNG terms, outside the approval sought. It is included so the record's sources are complete: every bingo ball on the record is `server` (VP-BALL-1), `local` with a fallback reason (VP-POOL-1), or `local` with the reason `caller` (a physical ball).

### 5.5 The phone tickets: VP-STRIP-1 and VP-CARDNO-2

A ticket is a 3 x 9 grid of 15 numbers, five per row, column 1 holding 1 to 9, columns 2 to 8 the tens, column 9 80 to 90, ascending down each column, no free square.

**Who deals them (changed since 1.1).** The server deals every phone ticket. The console asks `POST /host/bingo/deal` with one hand per phone (the phone's pid, its server device id and the number of tickets wanted); `handleBingoDeal` (lines 619 to 719) checks the host works at the draw's venue, refuses a finished draw, refuses every hand on a caller draw or at a venue in a paper-only state, and `bingoDealHands` (lines 720 to 792) writes the tickets into `vp_bingo_tickets` and answers with what is now on the record for each phone. The console then sends each phone its tickets over the venue's realtime channel in a signed `cards` message, as it always did (`app/index.html` lines 2004 to 2010). The number of tickets is the host's default on a free night, or the units the bar sold (tapped in by the host) on a paid night, capped at 24 (`BINGO_DEAL_MAX_TICKETS`, line 394).

**VP-STRIP-1: a strip of six.** Version 1. Paper bingo is sold in strips of six tickets that between them carry 1 to 90 exactly once. The strip algorithm is one block of text, `VP-STRIP BEGIN` to `VP-STRIP END`, carried byte for byte in both halves of the module (server lines 399 to 499; tablet lines 30 to 130; SHA-256 of the block `bc58cb3dc40d14929faac9df17dd43192a1385f305e80a58da3831cc226e26a9` in each) and `tools/regulated.py` refuses a release if the two differ. The server calls it as `generateStrip()` (lines 500 to 506) with `randInt`; the tablet as `makeStrip()` (lines 133 to 137) with `cryptoInt`. The full text is in the source archive.

*The model (clause 4.7.2).* `stripColCounts` decides how many numbers each of the six tickets has in each column: every ticket starts with one per column; the columns are taken in a shuffled order; each column's remaining numbers are handed out in blocks of up to two to the tickets with the most room left, ties broken by a random key per ticket (`rnd(1000000)`, line 416). `stripTicketRows` places each ticket's column counts into three rows of five, shuffling [0, 1, 2] per column and retrying until the rows balance. `stripOfSix` then shuffles each column's numbers with VP-SCALE-1 (Fisher-Yates) and deals them to the six tickets in order, ascending within a ticket, and **validates the whole strip** (`stripIsValid`: six valid tickets, 90 distinct numbers) before returning it; a strip that fails is thrown away and another made. The final step is exactly uniform: given the layout, every assignment of a column's numbers to the six tickets is equally likely. The layout steps are not uniform over all valid strips and are not meant to be.

Two differences from the text version 1.1 described: the tie-break is now a random key per ticket, not a random comparator inside `sort` (so it no longer depends on the browser's sort implementation), and every strip is validated. The 17 October ticket samples were generated from the older console text and do not describe this block; they are to be regenerated (section 11.6).

A player's ticket k is page k mod 6 of their book floor(k / 6), so tickets bought one at a time come from the same strip; the pages not yet dealt are stored with `dealt_at` null and are never sent to any client before they are dealt (migration 104 header; `bingoDealHands` lines 752 to 766).

There is one ticket maker on the server. If it cannot build a strip in 200 attempts it fails the request with 503 (lines 503 to 505); the console reads that as an outage and, where the switch allows, deals that game's opening hands from the tablet with the same block, labelled `source = 'tablet'` on the record. Version 1.1's single-ticket fallback (VP-TICKET-2, `makeCard`) and the Worker's old `generateTicket` (VP-TICKET-3) are not in the code at this commit.

**VP-CARDNO-2: the ticket number.** Version 2 (moved to the server). `freshCardNo` (lines 518 to 522): 100 to 999 by `100 + randInt(900)`, never one already used in this game; past 900 tickets in one game, the next free number from 1000. The number identifies the ticket in a claim; it is not a game outcome.

**Tablet tickets during an outage.** A ticket the tablet dealt is written to the server's record with `source = 'tablet'`, the tablet's own deal time, and `balls_at_deal`, the number of balls standing when the server received it (lines 733 to 745). At claim time a tablet ticket counts only if `balls_at_deal` is 0 (line 869), so a ticket recorded after the numbers it needs were out proves nothing.

### 5.6 How a claim is checked, and where the record is (changed since 1.1)

The phone never sends a ticket. A BINGO press sends a message signed with the phone's own key carrying only the ticket number (`pressBingo`, `play.html` line 1457; signing in `vp-phonekey.js`). The console verifies the signature against the pid and carries the claim to the server as `POST /host/bingo/claim` (`handleBingoClaim`, lines 794 to 902). The server then:

1. reads its own copy of the player's tickets for this draw (`vp_bingo_tickets`, line 867), never anything the phone or the tablet says is on a ticket;
2. reads its own record of the balls called, in order (line 828), and uses the first `balls` of them, the number out when the player pressed;
3. applies the claim rule `bingoTicketWins` (lines 529 to 557) for the pattern named in the claim, and for a custom pattern the venue's saved rule (section 5.8);
4. writes one row to `vp_bingo_claims` whether the verdict is a win or not: the ticket, the pattern, the ball count, the last ball, the verdict, the winning cells, and where it was decided (lines 879 to 898);
5. answers the console, and the host confirms or rejects through `POST /host/bingo/claim/resolve` (lines 945 to 963). A host cannot confirm a claim the server judged a non-win (`bingoMayConfirm`, lines 907 to 911), except a claim the host had to decide on the tablet during an outage the server itself recorded, and only where the state's tablet fallback is on.

The console's list of called numbers is sent with the claim and is compared, not used; if it disagrees with the server record, the server record is used and a note is written on the claim. The same claim sent again (a console retrying after a timeout) returns the first verdict (lines 810 to 812).

**What the server does not check.** The phone's signature on the claim is verified by the console (`vp-phonekey.js`, `verify`), not by the server; the server trusts the signed-in host's console to have done so and does not store the signature. This was found by the 20 October check and is unchanged; section 16 item 4.

The record of the night is therefore on VenuePlay's server: the draw and every ball with its source, every ticket dealt with the number of balls out when it was dealt, every claim with its verdict and the host's decision. The tablet holds a copy for the room's display.

### 5.7 Clause 4.2.7: is the game closed before the numbers exist?

Raffle and members draw: yes, each result is drawn at the tap. Bingo: the order exists from game start, and `/host/bingo/deal` may be called at any point in a game that is not finished (line 623), so a late phone or a paid top-up can be dealt tickets after balls are out. The answer offered is clause 4.2.2: nobody can read the order (service role only; never returned), so no interval exists in which access could confer a benefit. The 20 October check judged this insufficient on its own (section 16 item 2) and proposed closing deals at ball 1 on the server; that is a decision for Dean (section 18).

### 5.8 The venue's own winning pattern (VP-PATTERN-1, new in VP-DRAW-1.2)

#### 5.8.1 What it is

Beside the seven standard patterns, a venue may save named patterns of its own for 90-ball bingo. A saved pattern has a name of 1 to 30 characters, shown on the television and on players' phones, and exactly one rule:

- **Any N numbers.** A ticket wins when at least N of its 15 numbers have been called, N from 1 to 15.
- **A shape.** The venue marks squares on the 3 by 9 ticket grid. A ticket wins when every number inside the marked squares has been called. A marked square that is blank on a particular ticket has nothing to call, so it counts as done; a ticket with no number inside the shape at all can never win on it.

No other rule can be saved or judged. The reading of a rule is one function, `bingoRuleClean` (lines 566 to 584): anything that is not one of these two shapes reads as null and is never a win. The database enforces the same two shapes with a check constraint on `vp_bingo_patterns.rule` (migration 118). A venue may keep up to 30 saved patterns; a name that matches a standard pattern or another saved pattern at the same venue is refused.

```js
function bingoRuleClean(rule) {
  if (!rule || typeof rule !== 'object') return null;
  if (rule.type === 'any') {
    const n = Number(rule.n);
    return (Number.isInteger(n) && n >= 1 && n <= 15) ? { type: 'any', n } : null;
  }
  if (rule.type === 'shape') {
    if (!Array.isArray(rule.cells) || !rule.cells.length || rule.cells.length > 27) return null;
    const seen = {}, out = [];
    for (const v of rule.cells) {
      const i = Number(v);
      if (!Number.isInteger(i) || i < 0 || i > 26) return null;
      if (!seen[i]) { seen[i] = true; out.push(i); }
    }
    out.sort((a, b) => a - b);
    return { type: 'shape', cells: out };
  }
  return null;
}
function customTicketWins(cells, called, rule) {
  const r = bingoRuleClean(rule);
  if (!r) return { win: false, cells: [] };
  if (r.type === 'any') {
    const hit = [];
    for (let i = 0; i < 27; i++) { if (cells[i] && called.has(cells[i])) hit.push(i); }
    return hit.length >= r.n ? { win: true, cells: hit.slice(0, r.n) } : { win: false, cells: [] };
  }
  const inShape = r.cells.filter((i) => !!cells[i]);
  if (!inShape.length) return { win: false, cells: [] };
  return inShape.every((i) => called.has(cells[i])) ? { win: true, cells: inShape } : { win: false, cells: [] };
}
```

#### 5.8.2 Who can create one

Saving and deleting a pattern is `POST /host/bingo/patterns/save` and `/delete` in the game Worker (lines 7560 to 7599). Both require a signed-in staff member of that venue and then one of two roles (`bingoPatternStaff`, lines 7542 to 7550): the venue's owner, or a manager of that venue whose owner has not switched off the manager's draws and raffles right. A host can list and play the venue's patterns (`POST /host/bingo/patterns`) and cannot save, change or delete one. A member of staff at another venue cannot see them. Every row records who created it and who last changed it, with times. A delete marks the row `deleted_at` and keeps it.

#### 5.8.3 How a claim on it is judged

Exactly as section 5.6, with the rule read from the venue's own row:

1. The console names **which** pattern by its id. The server reads that pattern's rule from `vp_bingo_patterns`, filtered to the venue that owns the draw (`bingoCustomPattern`, lines 600 to 606). A pattern saved for another venue is not found: the claim is refused and nothing is written (lines 818 to 821).
2. The rule the console sends alongside is **compared only**. If it differs from the saved rule, the saved rule is used and a note is written on the claim (lines 824 to 826). A stale console, or a doctored request, cannot play a laxer rule than the venue saved.
3. The rule is applied by `customTicketWins` (lines 585 to 596), a constant in the module, to the server's copy of the ticket and the server's record of the balls.
4. A pattern deleted during a game is still read, so a claim in that game is judged on the rule the room was playing.
5. On a real-balls night there are no phone tickets to judge; the custom pattern is the name on the screens and the host checks the paper book.

The seven standard patterns are judged by the same code path as in VP-DRAW-1.1, and a claim on one writes exactly the row it did in 1.1 (line 887: the two custom columns are written only on a custom claim).

#### 5.8.4 How it is logged

Every claim on a custom pattern carries, on the `vp_bingo_claims` row, the id of the pattern and a copy of the name and rule as they stood when the claim was judged (migration 118). The pattern table keeps every row ever saved. `vp_bingo_patterns` has row-level security on with no policy and every grant revoked from the anonymous and signed-in roles, the same lock as the draw, ticket and claim tables; the repository's `RLS-BASELINE.json` (`venueplay-backend/supabase/`, line 1716) records this and the release gate compares the live database against it.

#### 5.8.5 What did not change

The entropy source, VP-SCALE-1, VP-SHUFFLE-1, the ball order, the ball hand-out, the tablet fallback, the strip maker and ticket validation are the same text as VP-DRAW-1.1. A custom pattern is a winning condition applied to a ticket; it calls the generator zero times, and the intended use for clause 4.1.5 is unchanged.

## 6. (Reserved)

Version 1.1 used this section for a product that is not part of this application. Nothing is submitted under it.

## 7. Intended use 2: raffle

**Game.** The venue sells its own paper tickets and types the first and last number sold and any unsold blocks; the host taps Draw; the Worker picks the winner(s). **Range.** Integers in [first, last] as typed; excluded blocks and numbers already drawn in that raffle are never drawn. **Results.** 1 to 50 winners per draw (exactly one for a cash-jackpot raffle); typically one raffle a night with one to five draws. A hold of the TV spin length plus two seconds is enforced on the server.

### 7.1 VP-RAFFLE-1

Version 1. Server only, inside `handleHostDraw`, `venueplay-game.js` lines 3721 to 3735 (the same text version 1.1 quoted at lines 3676 to 3707; the line numbers moved, the text did not):

```js
  // UNBIASED uniform draw: randInt(span) is rejection-sampled over crypto.getRandomValues,
  // so every ticket in [min,max] is equally likely (no modulo bias). Reject duplicates and
  // already-drawn numbers.
  const picks = [];
  const chosen = {};
  let guard = 0;
  const guardMax = span * 8 + 100;
  while (picks.length < winners && guard < guardMax) {
    guard++;
    const n = min + randInt(span);
    if (drawn[n] || chosen[n] || inExcluded(n)) continue;
    chosen[n] = true;
    picks.push(n);
  }
  if (picks.length < winners) return json({ error: 'Could not draw enough unique tickets, please try again' }, 409);
```

Each candidate is `min + VP-SCALE-1(span)`; excluded, drawn and already chosen candidates are rejected and another drawn, which leaves the result uniform over the eligible tickets. The winners are written to `vp_raffle_results` before the TV is told. The 17 October evidence (section 11) was produced from this text and stands.

## 8. Intended use 3: members draw

**Game.** A club's recurring draw of one financial member; if present they win the jackpot, otherwise it grows. **Range.** The valid members on the draw's list, typically 200 to 5,000, ordered by member id. **Results.** One per draw, typically weekly; an unresolved draw under 30 minutes old hands back the same member instead of drawing again.

### 8.1 VP-MEMBERS-1

Version 1 (migration 76; migration 90 added a row lock). The Worker mints eight 32-bit values (`handleMembersDraw`, lines 3869 to 3872, the same text as version 1.1):

```js
  const rand = [];
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < buf.length; i++) rand.push(buf[i]);
```

and Postgres `vp_members_draw` (migration 90, lines 104 to 112; the file is byte-identical to 17 October) applies VP-SCALE-1's rule to them over the id-ordered list, taking the first value below the rejection limit. If all eight are rejected (probability below (n / 2^32)^8) the Worker draws `members[randInt(members.length)]` instead (line 3976). The 17 October evidence stands.

## 9. Where the state lives, and who can see it

| Use | What exists before it is needed | Where | Who can read it |
|---|---|---|---|
| Bingo, server draw | The order of 90 | `vp_bingo_draws.draw_order` (Postgres, Supabase Sydney) | The Worker's service role only: row-level security on, `revoke all` from public, anon and authenticated (migration 70). Never returned. Readable by anyone holding the service-role key or the database dashboard: section 16 item 3. |
| Bingo, tablet fallback | Nothing | Host's browser | The remaining pool is the complement of the board, public. |
| Bingo, caller mode | Nothing in VenuePlay | The barrel or bag | The room. |
| Bingo tickets | Each phone's dealt tickets; the undealt pages of its book | `vp_bingo_tickets` (migration 104), service role only | The host sees all dealt tickets; each phone receives its own over the venue's channel in a signed message. Undealt pages are never sent. Tickets are not secret (a ticket is visible to the player and anyone near them, as on paper); integrity rests on the server holding the master copy and judging every claim against it. |
| Bingo claims | Nothing | `vp_bingo_claims`, service role only | The console receives each verdict; a phone is told win or not. |
| A venue's saved patterns | The name and the rule | `vp_bingo_patterns` (migration 118), service role only | The console and phones receive the name and rule for display; the server never takes the rule back from them. |
| Raffle | Nothing | Worker, at the tap | Nobody. |
| Members draw | Nothing | Eight values inside one request and one transaction | Nobody. |

Every selection is written to a timestamped row before any client is told: `vp_bingo_draw_balls` (with `source`), `vp_bingo_tickets`, `vp_bingo_claims`, `vp_raffle_results`, `vp_member_draw_results`.

## 10. Intended use statement (clause 4.1.5)

| Use | Result range | Results per game | Frequency | Application cycle need against the generator | Entropy calls |
|---|---|---|---|---|---|
| Bingo balls | 1 to 90 without replacement | up to 90 | one per tap, at least 4 to 5 s apart; 2 to 6 games a night | 90! orders (about 2^459). Given uniform inputs each order has probability exactly 1/90!; each step needs only a uniform integer below 90, which VP-SCALE-1 supplies exactly from 32 bits. The runtime CSPRNG is reseeded and has no cycle a game could exhaust | 89 per game (server), 90 per game (fallback); measured 17 October, text unchanged |
| Bingo tickets | valid 90-ball tickets; strips of six | 1 to 24 tickets per player | at the deal and at each paid top-up | uniform within each column given the layout | to be measured for VP-STRIP-1 at lodgement (the 17 October figure of about 1,044 per strip was for the earlier text) |
| Raffle | any typed range, up to 1,000,000 tested | 1 to 50 winners | 1 to 5 draws a night | uniform over the eligible tickets | 1 per winner plus rejections of ineligible numbers |
| Members draw | a list of up to 5,000 or more | 1 | weekly | uniform over the list | 1 call (8 values) per draw |

Winning patterns. The server judges a bingo claim on one of seven standard patterns or on a pattern the venue has saved (any N of the ticket's 15 numbers, N from 1 to 15, or every number within a chosen set of squares on the 3 by 9 ticket). The pattern is a winning condition applied to the server's copy of the ticket against the server's record of the balls; it does not call, parameterise or alter the random number generator, and it does not change the result range, the frequency of calling, or the number of results drawn in a game.

Non-prize uses of the same source (Submission Requirements 10.2.5): join codes, audit identifiers, player and host tokens (16 or 32 bytes), trivia question order (a game of skill, out of scope), confetti and animation on the TV pages. None affects any outcome.

**Maximum prize and scope.** Proposed for Dean's confirmation: AUD 20,000, for category 1, 2 and 4 games. Category 3 games are outside the intended use, so clause 4.9.2 does not apply. VenuePlay stores no prize value that affects any selection.

## 11. Statistical evidence

### 11.1 What was run, and when

The evidence pack at `~/venue-enrich/rng-certification/qld/evidence/` was produced on 17 October 2026 by lifting the real functions verbatim from the repository at commit 9c56748a and running them in headless Google Chrome 155 on macOS 26.6.2 and in workerd 1.20261016.1 (the open-source Cloudflare Workers runtime) with the production compatibility date. Its `harness/lifted-manifest.tsv` records the SHA-256 of every lifted piece. Version 1.1 sections 11.1 to 11.5 describe it in full and are not repeated here; what follows is the summary and, in 11.6, what still applies.

### 11.2 Standard batteries over the raw and scaled output (clauses 4.2.1 and 4.7.3)

NIST SP 800-22 STS 2.1.2 (100 streams x 1,000,000 bits, all 15 tests), PractRand 0.94 and ent were run over 320 MiB of raw output from each runtime and over scaled output of VP-SCALE-1 (`randInt(256)` and `cryptoInt(2)`). Results: no NIST row failed the uniformity criterion in any run; 7 of 1,504 rows across all runs fell below the minimum pass proportion against about 5 to 8 expected by chance, and the one run with 5 such rows was rechecked on three further independent segments (0, 0 and 1 rows); PractRand reported no FAIL and no anomaly at full length in any stream; ent is descriptive (entropy 7.999999 bits per byte on the raw files). Negative controls (a textbook LCG and modulo-biased bytes) failed both batteries immediately. Full results: `evidence/tests/BATTERIES-SUMMARY.txt` and the files it names. **This evidence stands:** the raw source and VP-SCALE-1's text are unchanged.

### 11.3 The clause 4.7 suite over every intended use

`harness/tests.py` (Python standard library only) ran chi-square, serial, runs, gap, poker, permutation and lag-1 correlation tests, and for every shuffle positional uniformity, first and last position, fixed points, cycle counts and mean inversions against their exact distributions, over at least 500,000 scaled outcomes per use. Pass criteria were fixed before the run (FAIL below p = 0.0001; the run as a whole needs no FAIL, no excess of p < 0.01 results, and the p-values together uniform by Kolmogorov-Smirnov). Result: 247 statistical tests and 20 structural checks, FAIL 0, WEAK 1 (rechecked six times, p between 0.049 and 0.91), OVERALL PASS. Positive and negative controls (`harness/controls.py`) all behaved as required.

### 11.4 The repository's own suites at this commit (27 October 2026)

Run on 27 October 2026 in the read-only checkout of commit 18e2c58d: `python3 tools/regulated.py --check` reports "VP-DRAW VP-DRAW-1.2, manifest 889556b56c9d: both halves match the manifest". The suites `tools/test-bingo-server-tickets.js` (80 checks) and `tools/test-caller-mode.js` (117 checks) were run on 26 October 2026 at commit 373f6920 by the author of the 26 October sections, both passing; the VP-DRAW files are byte-identical between 373f6920 and 18e2c58d (same SHA-256), so those results describe this code. They were not rerun on 27 October. The repository's suite ledger commit c60325cb (26 October) records the same counts. `rng-evidence.test.js` is unchanged since 17 October, when it passed 12 of 12.

### 11.5 Proof that the tests can fail

Version 1.1 section 11.4: the same functions and thresholds were run over a sound source (passed) and over sources with a known defect (modulo bias, a power-of-two LCG, a random walk, a sticky source, a naive shuffle), each of which failed; PractRand and `verify-live.sh` were likewise fed a known-bad input and reported it. Those control files are in `evidence/tests/`.

### 11.6 Which 17 October evidence still describes the live code, and which does not

| Component | Text at 18e2c58d compared with the 17 October lifted text | 17 October evidence |
|---|---|---|
| VP-ENTROPY-1 raw output | not VenuePlay code; unchanged runtime call | STANDS |
| VP-SCALE-1 `randInt`, `cryptoInt` | identical text | STANDS (samples 01, 02, 71; batteries) |
| VP-SHUFFLE-1 `shuffle1to90` | identical text | STANDS (samples 10, 72, 60) |
| VP-BALL-1 (SQL, migrations 70 and 76) | identical files | STANDS (no randomness of its own) |
| VP-POOL-1 `drawFromPool` | same algorithm, text changed (takes `pool` as an argument) | TO RERUN (sample 11 was of the old text) |
| VP-STRIP-1 | new shared text: random-key tie-break, per-strip validation | TO RERUN (samples 50, 54 were of the old console `makeStrip`); the two-numbers-in-a-column observation of version 1.1 is unverified for this text |
| VP-CARDNO-2 `freshCardNo` | moved to the server; 100 to 999 then 1000 upward | TO RERUN (sample 53 was of the console's `nextCardNo`) |
| VP-RAFFLE-1 | identical text | STANDS (samples 20 to 23, 73) |
| VP-MEMBERS-1 | identical text and SQL file | STANDS (samples 30 to 32, 74) |
| VP-CLAIM-1, VP-PATTERN-1 | new; call the generator zero times | no randomness to test; correctness is covered by the repository suites (11.4) |
| Samples 40 to 44 and 75, and sample files 51 and 52 | relate to code that is not part of this application or no longer exists | NOT USED |

The `evidence/README.md` of 17 October gives the order to regenerate for a new commit; `harness/extract.py` and `harness/make-version-table.py` are pinned to the file layout of 9c56748a and will need their line ranges and file list updated to VP-DRAW before they run. That is a task for the lodgement pass (section 18, item 10).

### 11.7 What these tests do not cover

- The raw source was sampled in Chrome and in workerd on one Mac, not inside Cloudflare's production network and not in Safari.
- The members draw's Postgres rule was run as a line-for-line transliteration, not in Postgres.
- The ticket layout tests describe the model; they do not, and need not, show the layouts uniform over all valid tickets.

## 12. Verifying the live system against the source (clause 4.1.6; Submission Requirements 8.2.3, 8.2.4)

Done on 27 October 2026 from the read-only checkout of `origin/main` at 18e2c58d, with curl and shasum only:

| What | How | Result |
|---|---|---|
| The six in-scope pages and scripts | downloaded from https://venueplay.com.au/ (www. answers 301 to the apex) and hashed | `app/vp-draw.js`, `app/index.html` (served at `/app/`), `play.html` (at `/play`), `tv.html` (at `/tv`), `app/vp-phonekey.js`, `app/vp-sign.js`: every one byte-identical to the commit (hashes in section 2) |
| The game Worker | `/health` read; the fingerprint recomputed from the committed file (SHA-256 of the file with its `BUILD` line removed, first eight hex digits, the rule in `tools/stamp-workers.py` line 82) | /health: build "24 Oct 2026, 23:08 · e7318f47", `draw_module VP-DRAW-1.2`, `draw_manifest 889556b56c9dc21830f3edb36aa90fd4ba12cfab7a7487187d05471dc0495d6d`, `ok true`. Recomputed fingerprint: `e7318f47`. Match |
| The module manifest | `python3 tools/regulated.py --check` | both halves match the manifest; the manifest hash equals the one /health reports |
| The SQL functions and tables as live | not reachable from outside | NOT CHECKED. The live definitions can be dumped with `select pg_get_functiondef('public.vp_bingo_next_ball'::regproc)` (and `vp_bingo_ball`, `vp_members_draw`) and the table locks with `python3 venueplay-backend/tools/dump-rls-baseline.py` in the Supabase SQL editor and compared with the files; to be done at lodgement |

Two limits, stated plainly: the Worker check is a 32-bit fingerprint plus the module's full manifest hash, not a full hash of the deployed script, because the deployed script can be fetched only with the Cloudflare account's API token (version 1.1 item 8, still open; section 16 item 6); and `tv.html` at the commit the screens were verified against (22b7864, 27 October 09:45) differs from 18e2c58d by five lines of display-clock code outside the regulated module, which is why the site is pinned to 18e2c58d here.

## 13. Flow charts and block diagram (Submission Requirements 8.3, 10.2.1)

The 17 October charts in `evidence/flowcharts/` (`00-block-diagram`, `01-bingo-90-ball`, `02-bingo-caller-mode`, `04-raffle`, `05-members-draw`) show the raffle and members draw as they still are, and the bingo chart shows the tablet dealing tickets and the console judging claims, which is no longer the product. `01-bingo-90-ball` and `02-bingo-caller-mode` are to be redrawn for VP-DRAW-1.2 (the server deals, the server judges, the recorded-outage rule, the custom pattern read from the venue's row); chart `03` is not part of this application. Section 18, item 10.

## 14. Monitoring (clause 4.1.9)

There is no runtime health monitoring of the entropy source, because it is the runtime's CSPRNG (clause 4.8 requires monitoring for hardware RNGs). VenuePlay's monitoring is: (a) the release gate, which runs `regulated.py --check`, `rng-evidence.test.js` and the draw suites on every deployment, so a change that broke the scaler, the shuffle, the module copy or the selection rules cannot ship; (b) the recorded draws, tickets and claims, which allow retrospective statistical checks of production output at any time; (c) the database's unique keys, which make a repeated ball impossible to record; and (d) /health, which reports the module version and manifest hash on every request.

## 15. How to reproduce

```
git clone https://github.com/gflam-dean/gflam-sites.git && cd gflam-sites && git checkout 18e2c58d
python3 tools/regulated.py --check                   # both halves match the manifest
jsc tools/test-bingo-server-tickets.js               # 80 checks: the real console and phone pages against the real Worker handlers
jsc tools/test-caller-mode.js                        # 117 checks
jsc tools/test-fallback-switch.js                    # the Queensland switch, proved by making the change in memory
jsc venueplay-backend/worker/rng-evidence.test.js    # 12 checks: scaler, shuffle, clause 4.7.1 by arithmetic
curl -s https://venueplay-game.dean-tindale.workers.dev/health   # build, draw_module, draw_manifest
```

The 17 October harness (`evidence/harness/`, version 1.1 section 15) regenerates the samples and batteries once its file list is updated to VP-DRAW. The repository is private; VenuePlay will grant read access or supply an archive.

## 16. Known issues and open items (Submission Requirements 6.10)

1. **The tablet fallback** (section 5.3): fair and recorded, allowed only after an outage the server itself recorded, provable only by the tablet that drew. On at this commit for every state. Decision for Dean.
2. **Two findings of the 20 October 2026 compliance check** (`qld/compliance-check-2026-10-20/REPORT.md`, made against VP-DRAW-1.1 and unchanged in 1.2): (a) within the 30-second unseen-ball window a host may post a ball for the last place in place of a server ball (clause 4.2.4); (b) tickets may be dealt after balls are out (clause 4.2.7). The constants and routes involved are present unchanged at 18e2c58d; the attack scripts were not rerun on 27 October.
3. **The whole 90-ball order of a live game sits in the database** (`draw_order`), readable with the service-role key or the dashboard (clause 4.2.2). The alternative, drawing each ball from the numbers left at the tap, is the shape the members draw already uses.
4. **The phone's claim signature is verified by the console, not the server**, and is not stored (section 5.6).
5. **The opt-in data capture is on the bingo phone page** (`play.html` lines 1444 to 1454, `/capture`; Submission Requirements 6.17). Decision for Dean.
6. **The Worker's live check is a 32-bit stamp plus the manifest hash**, not a full hash of the deployed script (section 12). Recommended: full SHA-256 and deployment id on /health.
7. **The SQL functions and table locks as live** have not been dumped and compared with the migration files for this pack (section 12).
8. **No production-network entropy sample**; Safari not sampled (section 11.7).
9. **The raffle and members draw code is outside the VP-DRAW manifest and its change control**, as are the three SQL ball and draw functions (20 October check, fix 4). Their text is hashed in VERSION-NAMES-v1.2.md; a change to them is not caught by `regulated.py`.
10. **Bingo record tables cascade-delete with the venue** and no retention period is stated (20 October check, fix 5).
11. **The pattern a claim is judged on is the one the console names in that claim**; the server does not separately record "the pattern announced for this game" before claims arrive. The claim row keeps the pattern, and for a custom pattern the name and rule, so the record is complete per claim.
12. **The 17 October statistical samples for VP-POOL-1, VP-STRIP-1 and VP-CARDNO-2 were of earlier text** (section 11.6) and are to be regenerated; the flow charts for bingo are to be redrawn (section 13).
13. **The server comment at `vp-draw.js` line 397 calls the strip maker "VP-TICKET-2"**, a name this document retires. Wording in a comment; to be corrected in the next module version.
14. **Cloudflare Email Obfuscation** can alter a served page that contains an email address (version 1.1 item 9). None of the in-scope pages contained one on 17 October; the 27 October byte-for-byte match shows none does today.

Closed since version 1.1: tablet-held tickets and verdicts (item 1 of 1.1); caller-mode undo deleting the row (item 5); the unused shuffle in caller mode (item 6); the random-comparator tie-break in the strip maker (item 7).

## 17. The clause 4.1 checklist

| Clause | Status at 1.2 | What closed it, or what is still missing |
|---|---|---|
| 4.1 (comply with Submission Requirements) | OPEN | The technical package exists (this document, VERSION-NAMES-v1.2.md, EVIDENCE-v1.2.md, the 17 October samples and results). Still missing: the submission letter and the signed, witnessed C&I form. |
| 4.1.1 (device or reasons) | CLOSED (text) | Server and browser software, no device to ship. A test venue login for OLGR officers is to be named at lodgement. |
| 4.1.2 (overall name and version) | CLOSED | VenuePlay Draw RNG v1.2; VenuePlay Phone Ticket v1.2; the module VP-DRAW-1.2 (section 1). |
| 4.1.3 (every scaling and mapping algorithm named and versioned) | CLOSED | VERSION-NAMES-v1.2.md: every component with the SHA-256 of its exact text at 18e2c58d. |
| 4.1.4 (references) | CLOSED (runtime source links still to add) | Section 19. |
| 4.1.5 (intended use) | PARTIAL | Section 10. Still missing: Dean's written confirmation of the maximum prize figure; the VP-STRIP-1 entropy-call count. |
| 4.1.6 (source, sample output, live verification) | PARTIAL | Live: every in-scope page byte-identical to 18e2c58d, Worker stamp and manifest hash matched (section 12). Samples: stand for the unchanged components, to rerun for three (section 11.6). Still missing: a full-hash check of the deployed Worker, a dump of the live SQL, the complete-file archive. |
| 4.1.7, 4.1.8 (mechanical) | N/A | No mechanical RNG. |
| 4.1.9 (monitoring) | CLOSED (text) | Section 14. |
| 4.1.10 (literature) | CLOSED (runtime source links still to add) | Section 19 and the battery results. |
| 4.2.1 (independent, uniform, unpredictable) | CLOSED | Section 11.2 and 11.3 for the unchanged components. |
| 4.2.2 (state secret) | MET with disclosure | `draw_order` readable by the service role (item 3); tickets not secret by design (section 9). |
| 4.2.4 (no external influence) | OPEN | The 30-second unseen-ball window (item 2a). Raffle exclusions are a disclosed, configurable parameter. |
| 4.2.5 (failsafe) | CLOSED (text) | Section 3. |
| 4.2.7 (game closed first) | OPEN | Deals after balls (item 2b). Section 5.7. |
| 4.2.8 (security in proportion) | OPEN | Needs the operational security statement: who holds the Supabase service-role key and the Cloudflare account, MFA on both. Only Dean can state it. |
| 4.5.1, 4.5.2 (CRNG) | PARTIAL | Section 3; runtime source references still to be cited. |
| 4.7.1 (unbiased scaling) | MET | By arithmetic (section 4.1) and by measurement (section 11). |
| 4.7.2 (correct probabilities per model) | PARTIAL | The strip model is written down (5.5); its measurement is to be rerun for the new text. |
| 4.7.3 (scaled results pass the tests) | CLOSED for the unchanged components | Section 11.6. |
| 4.9.2 (category 3) | CLOSED (scope statement) | Section 10. |
| SR 6.3 (C&I form) | OPEN | Not written. Dean signs, witnessed. |
| SR 6.7 (prior test report) | CLOSED | Section 11 names the tools, versions, machine, method and results; testing body VenuePlay, run by Claude (Anthropic's AI assistant) for Dean Tindale, director, 17 and 27 October 2026. |
| SR 6.9 (labelling, versioning) | CLOSED | Section 2: the module, the manifest, the gate. |
| SR 6.10 (known issues) | CLOSED | Section 16. |
| SR 6.17 (patron data separated) | RISK | Item 5. Decision for Dean. |
| SR 8.2.1 (off-the-shelf versions) | PARTIAL | workerd 1.20261016.1 and Chrome 155 tested; the production compatibility date and the Postgres version to be read at lodgement. |
| SR 8.2.3 (SHA-256 manifest) | CLOSED | Section 2, VERSION-NAMES-v1.2.md, `tools/regulated-manifest.json`. |
| SR 8.2.4 (facility to SHA-256 production files) | PARTIAL | Pages: download and hash; Worker: stamp and manifest hash on /health (item 6). |
| SR 8.3 (block diagram, flow charts) | PARTIAL | Raffle and members charts stand; bingo charts to be redrawn (section 13). |
| SR 9 (source, build) | PARTIAL | No compile step, stated. Still to supply the archive and the git log of the listed files. |
| SR 10.2.1 to 10.2.7 | CLOSED except 10.2.5 for VP-STRIP-1 | Sections 4 to 10; the 500,000 raw outcomes in ASCII are `samples/00-raw-u32-500000.txt` and `samples/70-workerd-raw-u32-500000.txt`. |
| SR 16 (phone the Technical Unit) | OPEN | Dean's call to (07) 3738 8535; not recorded as made. |

## 18. Decisions that need Dean

1. **The maximum prize figure** for clause 4.1.5 (proposed AUD 20,000; Dean said on 19 October 2026 that this is VenuePlay's own Queensland category 2 ceiling for this application). Confirm in writing.
2. **The tablet fallback for Queensland.** Keep it on and declared (as now), or set `TABLET_FALLBACK_OFF_STATES` to QLD in both halves (VP-DRAW-1.3). Open since 19 October.
3. **The two 20 October findings** (section 16 item 2). Fix before lodgement (close deals at ball 1 on the server; accept a late-ball takeover only when the server measured its own answer as late), or lodge with them listed.
4. **Opt-in capture on the bingo phone page** (section 16 item 5). Argue separation or move it off the page for Queensland venues.
5. **Custom patterns in the regulated module.** Phone claims on a venue's own pattern are judged by VP-DRAW-1.2 on the server, which is what is live. The alternative that needs no regulated change is caller-mode only. Confirm, because it sets which version is described.
6. **Operational security statement** (clause 4.2.8): who holds the Supabase service-role key and the Cloudflare account, and that MFA is on both.
7. **Test venue login** for OLGR officers (clause 4.1.1).
8. **Evaluator route**: OLGR evaluates (cheapest, Dean's preference) or an approved evaluator (BMM, ENEX, GTA, QALAB). Wait for OLGR's answer to the enquiry email's question (c).
9. **Three hardening changes** this pack recommends before lodgement: full SHA-256 and deployment id on /health; the raffle, members and SQL draw code brought under the manifest; a retention rule for the bingo record tables.
10. **Regenerate the evidence pack and the bingo flow charts for the lodged commit** (section 11.6, section 13) and produce this document as a PDF.
11. **Whether to take an in-production entropy sample** with a test-only Worker deployed beside the live one.
12. **What to ask OLGR to approve** (section 2): the named module and components, versioned by hash, rather than the whole web application.

## 19. References

- W3C, Web Cryptography API (Recommendation), `Crypto.getRandomValues()`: https://www.w3.org/TR/WebCryptoAPI/
- Cloudflare Workers documentation, Web Crypto: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- workerd, the open-source Workers runtime: https://github.com/cloudflare/workerd (exact file for `getRandomValues` to be cited at lodgement)
- BoringSSL: https://boringssl.googlesource.com/boringssl/ (random number generation)
- R. Durstenfeld, "Algorithm 235: Random permutation", Communications of the ACM 7(7), 1964, p. 420.
- D. E. Knuth, The Art of Computer Programming, vol. 2, Seminumerical Algorithms, 3rd edition, 1997: sections 3.3.2 and 3.4.2.
- H. Levene and J. Wolfowitz, "The covariance matrix of runs up and down", Annals of Mathematical Statistics 15, 1944, pp. 58 to 69.
- D. Lemire, "Fast random integer generation in an interval", ACM Transactions on Modeling and Computer Simulation 29(1), 2019.
- NIST SP 800-22 Rev. 1a, 2010; software STS 2.1.2.
- NIST SP 800-90A Rev. 1, 2015.
- PractRand 0.94, C. Doty-Humphrey: https://pracrand.sourceforge.net/
- ent, J. Walker, Fourmilab: https://www.fourmilab.ch/random/
