# Jag the Joker: built, switched off

Built 27 Sep 2026 on the branch `feature/jag-joker`. Reworked 30 Sep 2026 after two reviews.
Nothing here is live. Venues cannot see it.

## What it does

A weekly jackpot. Each week a ticket is drawn (the venue's own raffle), and that person picks
one face-down card on the TV board. If it is the Joker, they win the jackpot. If not, the card
stays turned over and the jackpot carries to next week.

- **Host console:** `/app/jag/host`, reached from the Jag tile on `/app?jag=1` (the tile is
  hidden without `?jag=1`). Start a jackpot, tap a card, type the winner's name or ticket
  number, confirm, update the jackpot, and (owners only) end it early. It has End game and
  Games buttons like the other consoles.
- **Venue TV:** the usual `/tv?venue=<slug>` link. Opening the Jag console puts the board on
  the wall, the same way the raffle console does. A turned card goes full screen: "No Joker" or
  "JOKER! See the host to claim." The wall shows 32 characters of the fingerprint and a QR code
  to the check page, and goes back to the venue's ads when the host presses End game, closes the
  console, or after 10 quiet minutes.
- **Public check page:** `/jag-check?venue=<slug>`. Proves the Joker never moved, checks every
  turned card against it, shows any early ending and its reason, and lists past jackpots so last
  week's can still be checked after a new one starts.

## The proof (what you asked for: "a random spot where it stays")

1. When a jackpot starts, the server picks the Joker's card with the same random-number
   generator every VenuePlay draw uses.
2. The card and a long secret key are locked in a table nothing but the server can read.
   Not the venue, not the console, not the TV. The database refuses any change to it, or to a
   turned card, or to the game's fingerprint, and refuses deleting any of them.
3. A fingerprint of the game, the card and the key goes on the TV from the first week.
4. When the Joker is found (or the jackpot is ended), the card and key are revealed. The check
   page puts them back through the same recipe, and also checks that no card the room was told
   was "No Joker" was really the Joker.

Names typed on the console stay on the console. The TV and the public page never show them.

## What changed on 30 Sep 2026

- The TV now actually shows Jag (it never did): the console broadcasts on the venue's signed
  channel, `/tv` and every game screen follow it, and the screen has the same safety plumbing
  as the raffle screen (bounces to `/tv` if opened directly, goes back to ads, follows the host
  to other games). It only polls the server every 30 seconds as a backup.
- Turning a card asks "Turn card 17 for $500?" with a short lockout, so a double tap cannot
  turn one. The turn uses the SAVED jackpot, never an unsaved figure in the box. Start asks too.
- One card per trading night (2am to 2am Brisbane) unless an owner or manager overrides it,
  and every turn needs a name or ticket number.
- The jackpot can only go down by an owner or manager. Every change is logged.
- Ending a jackpot early: owner (or HQ) only, with a reason that goes on the public check page,
  logged, and the pot carries into the next jackpot by default (only the owner can decline).
- Queensland and "no state on file" are refused on every play, not only at the start, and the
  staff check comes first so a stranger learns nothing.
- The public board is cached for 5 seconds per venue and limited per network.

## Tests

- `tools/test-jag-joker.js`: 74 checks. Runs the real Worker routes and the real check page.
- `tools/test-jag-pages.js`: 67 checks. Runs the real console, the TV screen, `/tv`'s game
  router, the shared screen router and the `/app` tile the way a host would.
- The Jag screen and console were also added to the shared venue-link and channel-recovery suites.
- 45 break-tests in `tools/prove-checks.py`, each proven to turn the gate red.

The database part (migration 95) still cannot be run here: there is no copy of the database.
Its read-back at the bottom asks the six questions that matter.

## To switch it on, in order (Dean)

1. **Licensing first, per state.** It is a game of chance with a jackpot, the same footing as
   raffles and members draws. Queensland is refused in code. Confirm each other state's rules
   (including whether the one-card-a-night and owner-only early ending fit them) before step 5.
2. Run `venueplay-backend/supabase/venueplay-95-jag-the-joker.sql` on Sydney. All six
   read-back answers should say true.
3. Run `python3 venueplay-backend/tools/dump-rls-baseline.py` and commit `RLS-BASELINE.json`.
4. Merge `feature/jag-joker` into main and run `python3 tools/release.py`. This deploys the
   game Worker with Jag still OFF. Every venue TV then also listens on a (silent) Jag channel.
5. Add the variable `JAG_ON` = `1` to the venueplay-game Worker in Cloudflare.
6. Play it at test-alpha from `/app?jag=1`: start, turn a card, watch the TV, find the Joker,
   open `/jag-check` from the QR.
7. Then show the tile to everyone (take the `?jag=1` condition off in `app/index.html`).

## Decisions for Dean

- Should managers be allowed to end a jackpot early? Right now it is owners only.
- The reason for an early ending is public. Happy with that?
- Default of 10 quiet minutes before the TV goes back to the ads.
