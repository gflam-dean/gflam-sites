# Room server test night (the default, before it reaches a real venue)

Branch `feature/room-server-default-31oct`: 771f3da0 (one road per venue) then 26350ce2 (the flip).
Run this on the test venues only: Test Alpha, Test Bravo, Test Charlie, The Mini Bar. Lobbies and
games there are always fine to open. One Chrome check at a time, in the main session.

Every link is on venueplay.com.au or game.venueplay.com.au. Never a workers.dev address.

## 0. Before anything: order of release

1. Deploy the **game Worker first** (it carries the handover route, the heartbeat and the ROOM_OFF
   fix). Confirm `https://game.venueplay.com.au/health` shows the new build and, in the detailed
   health, `"room": true` and no `room_off`.
2. Then publish the site (the flip is `var DEFAULT_ON = true;` in `venueplay/app/vp-room.js`).
   If the site lands first nothing breaks: pages ask the Worker, see it cannot hand a room over,
   and stay on Supabase.
3. Publish in the daytime, not during a game. Idle TVs reload onto the new code within about ten
   minutes (TV_BUILD changed); a TV in the middle of a game keeps the old code until it is idle.

**How to see which road a page is on** (a punter never can): open Chrome DevTools on that tab,
Console, type `document.documentElement.dataset.vpTransport`. It says `"room"` or `"supabase"`.
The console log also prints `[VenuePlay] transport: room`.

**How to see who is in a room:**
`https://game.venueplay.com.au/room/presence?room=vp-<CODE>` where CODE is the venue code on the
wall. It answers counts like `{"total":3,"tv":1,"host":1,"phone":1,...,"handover":true}`. A 503
saying `room handed over` means that venue has moved to Supabase for the next six hours.

## 1. Bingo, the healthy night (Test Alpha)

Open, in this order, with no `?roomserver=` on any of them:

- TV: `https://venueplay.com.au/tv?venue=test-alpha`
- Console: `https://venueplay.com.au/app/?venue=test-alpha` (sign in as the test host), pick Bingo
- Phone 1: scan the TV's QR, or `https://venueplay.com.au/play?venue=test-alpha`
- Phone 2: same, on a second phone (mobile data, not the venue wifi)

Look at:
- all four say `room` (step 0 how-to); presence shows tv 1, host 1, phone 2
- Open lobby: QR and names on the TV, both phones on "waiting"
- Start, call 10 balls: each ball on the TV and both phones within a second
- Claim from phone 1 with a real line; confirm on the console; the win screen on phone 1 and the TV
- Keep playing to a second prize, then Finish game: TV goes to the ads

Then the same night in **caller mode** (real balls, 1 to 90 grid): tap 10 numbers, check TV and phones.

## 2. The drops (still Test Alpha, game running)

- **Flight mode (the 1 Nov fault)**: flight mode on an iPhone for 25 seconds while you call 8 or 9
  balls, then off. Within a couple of seconds, with no reload, the phone shows its ticket with every
  missed ball marked and gets the next one. Presence still shows tv 1 and host 1 (the venue did NOT
  move), and the phone says `room`. Then once more for a full minute.
- **Phone locked**: lock phone 1 for two minutes, unlock. Same result.
- **Console reload**: reload the console tab mid-game. The game comes back, the next ball reaches
  the TV and both phones.
- **TV covered**: put another window fully over the TV window for six minutes, call two balls,
  uncover. The TV catches up at once and stays on `room`.
- **Late phone**: a third phone joins after ball 10. It is dealt a ticket and gets the next ball.

## 3. Old page drill: a TV from before the switch (Test Bravo)

This hands Test Bravo to Supabase for six hours, so do it after section 1 and 2.

- TV: `https://venueplay.com.au/tv?venue=test-bravo&roomserver=0` (pretends to be an old TV)
- Console: `https://venueplay.com.au/app/?venue=test-bravo`, pick Bingo
- Phone: `https://venueplay.com.au/play?venue=test-bravo`

Look at: within a second or two the console says `supabase`, presence for Test Bravo answers 503
`room handed over`, the phone (new) also says `supabase`, and a full game plays: lobby, balls,
claim, win. Close the TV tab afterwards: `?roomserver=0` sticks for that tab.

## 4. The other formats follow the one TV link (Test Charlie)

Musical bingo, trivia, raffle and members draw are still on Supabase (only bingo moved). What
changed is the TV: on the room it now makes the Supabase client the router needs, so it must
still follow every game. Musical bingo is not regulated bingo and is played exactly as before.

- TV: `https://venueplay.com.au/tv?venue=test-charlie` (check it says `room`)
- Musical bingo: `https://venueplay.com.au/app/musical/host.html?venue=test-charlie`, open lobby,
  phone joins from the TV QR, play 3 songs, a phone claims, host confirms. The TV switched to the
  musical screen on its own and back to the ads after End game.
- Trivia: `https://venueplay.com.au/app/trivia/host.html?venue=test-charlie`, 3 questions, phones
  answer, Reveal shows the right scores. (Trivia and musical run once a week per venue; if the
  "ran this week" banner shows, use The Mini Bar.)
- Raffle: `https://venueplay.com.au/app/raffle/host.html?venue=test-charlie`, draw one prize.
  (QLD rules screen is Dean's to accept, never ours.)
- Then back to bingo on the console: the TV leaves the last game and shows the bingo lobby.
- Venue settings, Screen tab: upload or change a slide. The TV (on the room) shows it within
  seconds.

## 5. The Mini Bar, a real-length night

Section 1 on The Mini Bar with the real TV, left running for the whole evening between games.
Look at the TV after an hour idle: still `room`, and the first ball of the next game arrives.

## 6. The global switch (only when no real venue is playing)

Cloudflare dashboard, Workers, `venueplay-game`, Settings, Variables: add `ROOM_OFF` = `1`.

During a game on Test Alpha: call the next ball. Every screen moves to Supabase together (one
ball may be replayed from the board), and the game carries on. Presence answers 503. Any room
that carried a message while the switch was on stays on Supabase for six hours after it is
cleared, on purpose, so a late phone never lands in an empty room.

## Rollback

- **Everything back to Supabase, no deploy:** set `ROOM_OFF = 1` on the venueplay-game Worker
  (as in section 6). Takes effect on the next request.
- **Undo the flip itself:** revert commit 26350ce2 (`var DEFAULT_ON = false;` in
  `venueplay/app/vp-room.js`) and publish. Pages then use the room only with `?roomserver=1`.
- A single venue stuck on one road: it clears itself six hours after the last handover.
