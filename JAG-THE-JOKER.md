# Jag the Joker: built, switched off

Built 27 Sep 2026 on the branch `feature/jag-joker`. Nothing here is live. Venues cannot see it.

## What it does

A weekly jackpot. Each week a ticket is drawn (the venue's own raffle), and that person picks
one face-down card on the TV board. If it is the Joker, they win the jackpot. If not, the card
stays turned over and the jackpot carries to next week.

- **Host console:** `/app/jag/host`. Start a jackpot (name, 10 to 100 cards, starting
  jackpot), tap a card, tap Turn twice, update the jackpot, and end it (owners and managers only).
- **TV board:** `/app/jag/screen?venue=<slug>`. Shows the cards and the jackpot. A newly turned
  card goes full screen: "No Joker" or "JOKER! See the host to claim."
- **Public check page:** `/jag-check?venue=<slug>`. Proves the Joker never moved.

## The proof (what you asked for: "a random spot where it stays")

1. When a jackpot starts, the server picks the Joker's card with the same random-number
   generator every VenuePlay draw uses.
2. The card and a long secret key are locked in a table nothing but the server can read.
   Not the venue, not the console, not the TV. A database trigger refuses any change to it.
3. A fingerprint of the game, the card and the key goes on the TV from the first week.
4. When the Joker is found (or the jackpot is ended), the card and key are revealed. The check
   page puts them back through the same recipe. If the Joker had moved even one card, the
   fingerprint would not match.

Names typed on the console stay on the console. The TV and the public page never show them.

## Tests

- `tools/test-jag-joker.js`: 34 checks. Runs the real Worker routes and the real check page.
  Covers the off switch, the Queensland refusal, staff only, random and even across all
  cards, the spot never shown early, the fingerprint, and the proof working.
- `tools/test-jag-pages.js`: 22 checks. Runs the real console and TV page the way a host
  would.
- 7 break-tests, each proven to turn the gate red.

The database part (migration 95) cannot be tested here, because there is no copy of the
database to run it on. Its read-back at the bottom asks the three questions that matter.

## To switch it on, in order

1. **Licensing first.** It is a game of chance with a jackpot, the same footing as raffles
   and members draws. Queensland is refused in code. Confirm the other states before step 5.
2. Run `venueplay-backend/supabase/venueplay-95-jag-the-joker.sql` on Sydney. All three
   read-back answers should say true.
3. Run `python3 venueplay-backend/tools/dump-rls-baseline.py` and commit `RLS-BASELINE.json`.
4. Merge `feature/jag-joker` into main and run `python3 tools/release.py`. This deploys the
   game Worker with Jag still OFF.
5. Add the variable `JAG_ON` = `1` to the venueplay-game Worker in Cloudflare.
6. Play it at test-alpha: start, turn a card, find the Joker, open `/jag-check`.
7. Then add it to the game list in the app.
