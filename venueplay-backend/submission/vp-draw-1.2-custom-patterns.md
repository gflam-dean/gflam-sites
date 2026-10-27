# VP-DRAW 1.1 to 1.2: a venue's own winning patterns

Prepared 25 Oct 2026 as input for the OLGR paperwork. Plain-terms record of the one change between
VP-DRAW-1.1 and VP-DRAW-1.2, the versioned bingo module (draw, tickets, claim rule, tablet fallback)
that the game Worker reports on /health.

- Version: VP-DRAW-1.2. Manifest hash 889556b56c9d... (full value in `tools/regulated-manifest.json`,
  which also records the reason for the change).
- Files: `venueplay-backend/worker/vp-draw.js` (server half) and `venueplay/app/vp-draw.js` (tablet
  half). `tools/regulated.py --check` confirms both match the manifest and the Worker carries the same
  copy byte for byte.
- Branch `feature/custom-bingo-patterns`. Asked for by Dean on 24 Oct 2026, after a Drag Bingo show that
  played "any 5 numbers on the card". On 25 Oct Dean decided phone tickets are checked against custom
  patterns too.

## What a custom pattern is

A venue can save its own named winning pattern for 90-ball bingo, next to the seven standard ones (one
line, two lines, full house, four corners, top line, middle line, bottom line). It has a name (up to 30
characters, shown on the TV and on phones) and exactly one of two rules:

1. **Any N numbers.** At least N of the numbers on one ticket have been called, with N from 1 to 15
   (a 90-ball ticket holds 15 numbers).
2. **A shape.** The venue picks squares on the 3 x 9 ticket grid. A ticket wins when every number
   inside those squares has been called. A chosen square that is blank on a ticket has nothing to call,
   so it counts as done. A ticket that has no number inside the shape at all can never win on it.

Nothing else can be saved: any other rule is refused when it is saved and is never a win when judged.
Only the venue's owner, or a manager with games rights, can save or delete a pattern. Any host can pick
one.

## How a claim on a custom pattern is judged

- The server decides, exactly as for the standard patterns: it uses its own copy of the ticket and its
  own record of the balls called (unchanged from 1.1).
- The rule is applied by one fixed function, `customTicketWins`, in the module. `bingoRuleClean` is the
  only way a rule is read.
- The console names **which** pattern by its id. The server reads that pattern's rule from the venue's
  saved row (`vp_bingo_patterns`, migration 118), **only for the venue that owns the draw**. Another
  venue's pattern is refused and nothing is recorded.
- The rule the console sends is **only compared**, never used. If it differs (for example a stale
  console), the saved rule is used and a note goes on the claim record.
- Every custom claim on the record keeps the name and rule it was judged on (`custom_pattern_id`,
  `custom_pattern`).
- A pattern deleted during a game is kept (it is marked deleted, not removed), so claims in that game are
  still judged on the rule the room was playing.
- On a real-balls (caller mode) night there are no phone tickets. The host checks the paper book and
  confirms, as before; the custom pattern there is only the name on the screens.

## What did not change

- The draw and the RNG: `randInt`, `shuffle1to90`, the ball order and how balls are handed out.
- The ticket maker (strips of six, 1 to 90 once each) and ticket validation.
- The seven standard patterns: same rule, same result, and a claim on one writes exactly the record it
  did in 1.1.
- The tablet fallback switch, and the outage and record rules from 1.1.
- Musical bingo (not bingo, and not part of this module).

## Test evidence

All of these run the real code. Paths are relative to the repo root.

- `tools/test-bingo-server-tickets.js` (80 of 80 pass). It covers:
  - The server and tablet halves agree on custom rules over 1,500 random tickets (any N and shapes,
    with both wins and non-wins common). An existing check still covers the seven standard patterns
    over 2,800 tickets.
  - Any 5: five called numbers win and four do not. A shape wins only when every number in it is
    called. A shape that sits only on blank squares never wins. Rules outside the two types are never
    a win. A full ticket still wins all seven standard patterns.
  - Server claims:
    - any 5 wins and any 6 is "not yet" on the same five balls
    - a top-row shape wins, and the same shape plus one uncalled square does not
    - a console that sends a laxer rule (any 1) is judged on the saved rule (any 6), with a note
    - another venue's pattern is refused
    - a deleted pattern is still judged
    - a standard-pattern claim writes no custom fields
  - A full phone game on a custom pattern: one non-win claim and one win, judged by the server.
  - Saving: who may save and delete, the rules on names and rules, and "not switched on" before
    migration 118 is run.
- `tools/test-caller-mode.js` (117 of 117) and `tools/caller-winner-in-chrome.test.py` cover the caller
  mode side. The Chrome suite was still to run at the time of writing; see the branch.
- `tools/prove-checks.py`: each new check has a mutation that breaks the code. Each was applied in a copy
  and turned its suite red (for example: any N accepting fewer than N, a shape accepting one number, the
  server trusting the console's rule, reading another venue's pattern, and the two halves disagreeing).
- `python3 tools/regulated.py --check`: both halves match the manifest, version VP-DRAW-1.2.
