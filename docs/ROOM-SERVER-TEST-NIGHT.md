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
- **Wi-Fi off, 4G off, no flight mode (the 4 Nov fix, job list row 60)**: on the iPhone, turn Wi-Fi
  off and then mobile data off (Control Centre), wait 40 seconds while you call balls, turn them back
  on. This is the drop the browser is NOT told about. Same result: ticket back with every ball, the
  status says Connected (never "Waiting for the host"), the phone says `room`, presence still has the
  host. Then walk the phone from the venue Wi-Fi onto 4G mid-game (a hand-off): no visible gap.
- **Trivia and musical bingo**: the same Wi-Fi-off drop for 40 seconds while the next question goes up
  (or a song plays). Back within a few seconds on the question that is up now (or the card with
  every song played), never "You're in".
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

Before any format flip (branch `feature/room-trivia-musical-1nov` with every line of
`ROOM_FORMATS_ON` false), musical bingo, trivia, raffle and members draw are still on Supabase (only
bingo moved). What
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

## 7. Each format on the room, one flip at a time (1 Nov 2026 branch)

Release order: the game Worker with every format still off first (it carries the venue-wide
handover, `formats` in presence, `room_formats` on the poll and the old-console check), then the
site. Nothing moves until a format's flip. Then ONE format per morning, before any venue plays:
its line in `ROOM_FORMATS_ON` (venueplay-backend/worker/venueplay-room.js) to `true`, re-copy into
venueplay-game.js, stamp, deploy the game Worker, and run this section for that format. TVs reload
onto the flip by themselves within a minute or two while they are on the ads.

**Finding a format's room.** On any VenuePlay console tab, DevTools Console:
`VP.venueCode("musical-test-charlie")` (or trivia-, raffle-, members-). Presence for it:
`https://game.venueplay.com.au/room/presence?room=vp-<that code>`. It should now also answer
`"venue":true` and `"formats":{...}` with the flipped format `true`.

For the flipped format, on Test Charlie (The Mini Bar if the once-a-week banner shows), no
`?roomserver=` on any link:

- TV `https://venueplay.com.au/tv?venue=test-charlie`, console
  `https://venueplay.com.au/app/<format>/host.html?venue=test-charlie`, and for musical or trivia two
  phones from the TV's QR (one on mobile data).
- **All in the room:** `document.documentElement.dataset.vpTransport` says `"room"` on the console,
  the phones and (inside the TV's game frame) the screen. Presence for the format's room shows
  tv 2 (the TV's router and its game screen) and host 1; presence for `vp-<venue code>` shows the
  phones (musical and trivia players meet there).
- **No Supabase connection:** after a minute (the console's ear lets go), Supabase dashboard,
  Realtime, Inspector, shows no client for Test Charlie's TV, screen or phones. With EVERY format
  flipped, the TV shows none at all, all evening.
- **Play it:** musical, 3 songs, a phone claims, host confirms; trivia, 3 questions, Reveal scores
  right; raffle, one prize drawn (QLD rules screen is Dean's to accept); members, one draw. The TV
  goes to the game's screen and back to the ads after End game.
- **Phone drop (musical, trivia):** airplane mode 10 s, back: still `room`, next song or question
  arrives, presence for the format's room did NOT go 503.
- **Console reload:** reload the console mid-game: back in the room, next message reaches TV and phones.
- **Late phone:** a third phone joins mid-game, straight into the room, gets the next message.
- **Format switch mid-night:** bingo (section 1), End game, then this format's lobby: the TV
  leaves bingo for this format's screen; end it, open another flipped format: the TV follows.

**Old page drills (Test Bravo, which then sits on Supabase for six hours):**
- *Old TV:* TV `https://venueplay.com.au/tv?venue=test-bravo&roomserver=0`, then the format's
  console normally. Within a second of the console opening (musical, trivia: of Open lobby) the
  console says `supabase`, presence for the format's room answers 503 `room handed over`, and the
  TV still follows the game.
- *Old console:* console with `&roomserver=0` (it says road "supabase" when it opens the game), TV
  and phones normal: when it opens the game every one of Test Bravo's five rooms answers 503 and
  the TV, screen and phones follow it on Supabase.

**ROOM_OFF mid-game** (section 6) once per flipped format: the whole venue, bingo's room as well,
goes across together and the next song, question or draw reaches everyone.

**Taking a format back off:** its line to `false` and a Worker deploy (TVs reload onto it between
games), or `ROOM_OFF=1` for everything at once with no deploy.

## Rollback

- **Everything back to Supabase, no deploy:** set `ROOM_OFF = 1` on the venueplay-game Worker
  (as in section 6). Takes effect on the next request.
- **Undo the flip itself:** revert commit 26350ce2 (`var DEFAULT_ON = false;` in
  `venueplay/app/vp-room.js`) and publish. Pages then use the room only with `?roomserver=1`.
- A single venue stuck on one road: it clears itself six hours after the last handover.
