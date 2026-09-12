# Bingo: after a winner is confirmed, the host cannot end the game

Found 12 Sep 2026 on the LIVE site (venueplay.com.au), signed in as Dean, viewing
**Test Alpha** through HQ's View as. Sydney is the live database. Reproduced twice,
including on a freshly reloaded host console.

## What happens

1. Host opens the lobby, a phone joins, host starts calling. **All of this works.**
   The TV follows every ball, the phone's ticket marks itself, the counts agree on all
   three screens.
2. Phone taps BINGO on an incomplete ticket. The server **correctly refuses**: "Not yet,
   keep playing. That pattern is not complete on any of your tickets." Good.
3. Host ticks **Allow early BINGO calls**. Phone taps BINGO again.
4. The claim reaches the host with the ticket drawn and an honest verdict:
   "NOT A WIN YET - Called early, One line is not complete on card #332."
   The TV shows "BINGO? Test Phone - checking the card against the called numbers".
   **All of this works and is well designed.**
5. Host taps **Confirm winner**. The host console updates: "Test Phone won One line!"

## And then nothing moves again

- The TV stays on "BINGO? ... checking the card" for ever.
- The winner's phone stays on "BINGO sent. The host is checking your ticket..."
- On the host, **Finish game**, **End game / Back to ads** and **Keep playing** all do
  nothing. No error, no toast, no console message.
- Reloading the HOST recovers its state from the server ("Announce it on the mic, then
  Keep playing for the next prize or Finish game") and the buttons **still** do nothing.
- Reloading the TV clears the claim screen but shows the BOARD OF A FINISHED GAME,
  8 of 90 called, not the winner and not the venue's advertising.

## Why this matters

Bingo is the flagship format. In a room: somebody calls bingo, the wall says "checking
the card", the host confirms, and the wall never changes. The room is looking at
"checking the card" while the host has already announced the winner on the mic. The host
cannot start the next game or put the advertising back. The only way out is a reload of
the screen, which lands on a stale board rather than the ads.

## What is NOT the cause

- **Not the Sydney move.** Ball calls travel host -> TV perfectly in the same session.
- **Not CORS.** This is the deployed site, not localhost. An earlier round of this test on
  localhost produced a false "Server not answering" because the Worker refuses that origin;
  that does not happen here.
- **Not broadcast signing.** The claim and every ball arrive.
- **Not a dead realtime channel.** The TV's 30-second poll keeps answering throughout, and
  the host recovers server state on reload.
- **Not a stuck UI.** A freshly loaded console behaves identically.

## Where to look

Whatever `Confirm winner` puts the console into, the three follow-on actions do not fire
from it. Start at the click handlers for Finish game / End game / Keep playing in
`venueplay/app/index.html` and at the guard on line ~2153,
`if(G.lastWins.length){ showToast("Announce the win first: keep playing, or finish the
game."); return; }` - note that ANNOUNCE THE WIN is a DISABLED label (index.html:1233
sets `b.disabled=true`), so if any path expects it to be pressed, that path can never be
taken.

## The check this needs

A suite that drives the real console through claim -> confirm -> finish and asserts the
console leaves the win state and broadcasts the finish. There is no test today that goes
past `Confirm winner`; every existing bingo suite stops at the claim. That is why this
survived: the tests cover the half of the flow that works.
