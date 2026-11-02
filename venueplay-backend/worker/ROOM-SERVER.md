# The room server: live games on Cloudflare, not on the database

Written overnight 9 Sep 2026. Design plus a skeleton (`venueplay-room.js`,
`venueplay-room.test.js`, `venueplay/app/vp-room.js`). NOTHING in here is
deployed or wired into a page. Read "What to do in the morning" at the end.

## The problem in one paragraph

Every live thing in VenuePlay goes through Supabase today: the Worker's
database calls, the TV's check-in every 30 seconds, and the realtime channel
that carries the host's messages to the TV and the phones. Measured on 8 Sep
against a Sydney project the same size as live: the database gateway serves
about 45 calls a second, whatever the route, and that number does not move
when the database itself is idle (each call runs in about 1 ms). Four thousand
TVs checking in every 30 seconds is 133 calls a second on their own. A Tuesday
with 1,000 rooms mid-game asked for 20 to 60 calls a second per format and got
21. On top of that, the realtime channel is priced per connection: the Pro plan
includes 500 at once, then $10 per 1,000, and a room is one TV, one host and
30 to 100 phones. Four thousand venues is well over 100,000 connections. No
compute size Supabase sells reaches that. So this is not "buy a bigger
database". The live part of the night has to live somewhere built for it.

## What Dean agreed to (8 Sep)

Move the live part to Cloudflare. "Sweet lets do it. Can we automate it though?
Dont forget about the other sites too."

## The shape

One **room** per venue, running on Cloudflare as a Durable Object (a small
program with its own memory that Cloudflare keeps alive near the venue). The
TV, the host's tablet and every phone in that venue hold one WebSocket to the
room. Whatever the host sends, the room hands to everyone else in the room.
Whatever the Worker or HQ needs a screen to hear (reload, a command, a
question, a reveal) goes into the room the same way.

    today                                   with the room
    ----------------------------------      ----------------------------------
    TV  --poll every 30 s--> Supabase       TV  ===websocket===+
    host --broadcast--> Supabase Realtime   host ===websocket==+==> ROOM (one per venue)
    phone <--broadcast-- Supabase Realtime  phone ==websocket==+       |
    Worker --REST x8--> Supabase            Worker --1 call--> ROOM     +--> everyone else
                                            Worker --1 trip--> Supabase (only what must be stored)

The database keeps what must be kept: sign-ins, sessions and games, players,
the answers that decide a prize, reports, members, billing. It stops carrying
the second-by-second traffic.

The messages themselves do not change. The pages already send `{type: ...,
...}` objects, signed by the host (vp-sign.js) and verified by every screen.
The room relays those objects untouched, so a TV cannot tell whether a message
arrived by Supabase or by the room, and the signature check still protects it.

## Why Durable Objects and not something else

* One object per venue is exactly one room per venue. Ordering inside a room
  is guaranteed, which a fan-out over a shared channel cannot promise.
* WebSocket hibernation: an idle room with 60 sockets open costs nothing while
  nobody speaks. Tuesday's 4,000 rooms are 4,000 objects, which is normal use.
* It runs where the game Worker already runs, on the same account, with the
  same deploy tool. No new vendor, no new bill to set up (see Cost).
* Everything else (Supabase Realtime bigger tiers, Ably, Pusher) is priced per
  connection or per message and puts the ceiling back, just higher.

## Cost

Durable Objects need the **Workers Paid plan, US$5 a month** for the account.
Dean turned it on 9 Sep 2026, before the first test ran.
The free plan allows Durable Objects but caps them at 100,000 requests a day,
which one Tuesday would exceed. Usage after that: about US$0.15 per million
messages and a little for time awake. A Tuesday of 4,000 rooms sending roughly
1,000 messages each is 4 million messages, so a month of Tuesdays and Thursdays
lands around US$5 to 10 in usage. Against that, the Supabase compute bump the
gateway ceiling was pushing us towards (Small US$15, Medium US$60 a month) is
not needed for this traffic, and Realtime overage never starts.

## What stays on Supabase, and does it fit

Per Tuesday night (1,000 rooms mid-game, the load driver's shape):

| what                              | calls a second | after the room |
|-----------------------------------|----------------|----------------|
| TV check-ins (4,000 TVs, 30 s)    | 133            | 0 (the socket is the heartbeat) |
| phone answers (50 a room, 35 s)   | ~1,400         | 0 live; one batched write per question (~30) |
| host Next / Reveal (one trip now) | ~50            | ~50 (still the Worker, migration 73) |
| joins (start of night burst)      | bursty         | unchanged (a join mints a billed row) |
| musical / bingo / raffle host taps| ~30            | 0 live; one write per draw or song for the record |

That is about 100 calls a second at peak against a ceiling of 45 on Micro, so
Micro is still tight on a Tuesday and Small (US$15) is the honest size for
5,000 venues even with the room. The room removes the traffic that scaled with
*people* (TVs, phones); the Worker's per-tap writes scale with *rooms*.

## Phases

**Phase 1, transport (the skeleton written tonight).**
The room relays messages and knows who is in it. Pages connect to the room
first and fall back to Supabase Realtime if the room is not there, so nothing
can go dark. TV polling drops from every 30 s to a slow safety poll (every 5
minutes) once the socket is up; HQ's reload and commands go into the room and
land in under a second instead of within 30 s.

**Phase 2, answers in the room.**
Phones send trivia answers over the socket. The room stores them (memory plus
its own storage), answers the phone instantly, and at Reveal the Worker asks
the room for the answers and writes them in ONE insert, then scores them with
vp_host_reveal. The 1,400-a-second line above becomes ~30.

**Phase 3, the room verifies signatures.**
The room fetches the venue's public key and drops unsigned or bad messages
before they leave the server when the venue is in enforce mode. That closes
"realtime is unauthenticated" (migration 46, section 4) for good: today a
forged message reaches every screen and is dropped there; then it reaches none.

**Phase 4, the other sites.** PartyPlay uses the same shape (a party is a
room). Drag Bingo's screen and the touring site do not have live rooms and
need nothing.

## The skeleton, file by file

`venueplay-backend/worker/venueplay-room.js`
:   The Durable Object class `VenueRoom` and the three routes the game Worker
    forwards to it. WRITTEN, NOT RUN. It is a separate file on purpose so the
    shipping Worker was not edited without the gate; wiring is a ten-line
    change listed below.

`venueplay-backend/worker/venueplay-room.test.js`
:   Runs the class against a scripted Durable Object state and sockets: relay
    to everyone but the sender, tags by role, presence counts, the size and
    rate caps, publish from the Worker. WRITTEN, NOT RUN. Run it with jsc
    before believing a word of it, and break the class once to see it go red.

`venueplay/app/vp-room.js`
:   The page-side client. `VPRoom.connect(apiBase, code, role, onMsg)` opens
    the socket, reconnects with backoff, and returns `{send, close, state}`.
    If the Worker says the room is not enabled (503) it calls `onUnavailable`
    so the page keeps using Supabase Realtime exactly as today. NOT wired into
    any page.

### Wiring into the game Worker (morning, after the test runs)

1. `import { VenueRoom } from './venueplay-room.js'` is not available (one
   file is pasted or uploaded), so the class is appended to venueplay-game.js
   by `tools/build-worker.py`-style concatenation, or the deploy tool learns a
   second module. Simplest: copy the class into the game Worker under a
   `/* ROOM SERVER */` banner and let the gate's duplicate-code check keep the
   two identical (the same rule esc/cryptoInt/tvSend already obey).
2. Routes, next to `/venue` in the router:
       if (method === 'GET' && path === '/room/ws')       return await handleRoomSocket(request, env, json);
       if (method === 'GET' && path === '/room/presence') return await handleRoomPresence(request, env, json);
3. `handleScreenReload` and `handleScreenCommand` call
   `roomPublish(env, slug, {type: 'reload', ...})` after their database write,
   inside a try so a missing binding changes nothing.
4. `handleHealth` reports `room: !!env.ROOM` (a boolean, never a value).
5. `tools/deploy-worker.py --do-class=VenueRoom` (WRITTEN 9 Sep, not yet
   exercised against the API): on the first deploy it sends
   `migrations: {new_sqlite_classes: ['VenueRoom']}` plus a
   `durable_object_namespace` binding named ROOM; on every later deploy it
   sees the binding already there and keeps it. It refuses a file that does
   not `export class VenueRoom`. Staging (`venueplay-game-sydney`) first,
   always.

### Safety rules the skeleton already follows

* No binding, no change: every room call is behind `if (env.ROOM)` and a
  try/catch; the pages fall back to Supabase Realtime on a 503.
* A room never invents a message. It relays what a host sent, or what the
  Worker published. Signing stays end to end.
* Presence is counts by role only. No names, no tokens, no IPs.
* A socket that sends more than 20 messages a second or a message over 16 KB
  is dropped, not served. A venue's whole night is a few hundred messages.

## What has actually run (9 Sep 2026, afternoon)

Everything in the "morning" list below except the last step, and all of it proved:

1. `jsc venueplay-room.test.js`: **ALL 20 CHECKS PASSED**. Then the test was broken
   on purpose twice, once so relay stopped skipping the sender (1 of 20 failed) and
   once so relay delivered to nobody (4 of 9 failed and it said which), then restored.
   The test can fail, so its green means something.
2. The class is now WIRED into venueplay-game.js: copied in under a
   `ROOM SERVER` banner, the two routes added next to `/venue`, `/screen/reload`
   and `/screen/command` publish into the room after their database write, and
   /health reports `room` as a boolean. release-check.py gained a check that the
   copy in the game Worker matches venueplay-room.js byte for byte, and that check
   was broken on purpose and went red before being restored.
3. Deployed to STAGING with `--do-class=VenueRoom`. The tool created the Durable
   Object and bound it as ROOM, kept all six existing bindings, and /health on
   venueplay-game-sydney answers `build ac056336, room: true`.
4. `python3 tools/room-smoke.py`: **ROOM SMOKE PASSED**. Two sockets on a made-up
   room, presence counted them, the host spoke and the TV heard it in **20 ms**
   (against up to 30 seconds for the poll it replaces), the host did not hear its
   own message, junk was dropped, and presence went back to nobody when they left.

Still to do: `vp-room.js` into tv.html behind `?roomserver=1`, then a live test on The
Mini Bar. The live game Worker is untouched and still on 870a8665; nothing about
this reaches a venue until Dean deploys and the page opts in.

## What to do in the morning

1. `jsc venueplay-backend/worker/venueplay-room.test.js` (it has never run).
   Then break `relay()` on purpose and confirm the test goes red.
2. Workers Paid: DONE 9 Sep. Supabase compute stays on Micro until the room
   server is live and re-measured; if the numbers then say Small, it is a
   two-minute dashboard change the night before cutover.
3. Wire per the list above, gate, deploy to `venueplay-game-sydney` with
   `--do-class=VenueRoom`, and smoke-test with `python3 tools/room-smoke.py`
   (written 9 Sep, never run: two sockets on a made-up room, the host sends,
   the TV hears it, the host does not, presence says 2 then 0; it refuses a
   LIVE Worker and stops politely at a 503 when the binding is not there).
4. Then, and only then, add `vp-room.js` to tv.html behind `?roomserver=1` and test
   on The Mini Bar.

## The global off switch

One variable, no deploy, no push, nothing for a venue to do.

**To put every venue in the country back on Supabase Realtime:** in the Cloudflare
dashboard, open the `venueplay-game` Worker, Settings, Variables, and set

    ROOM_OFF = 1

It takes effect on the next request, within seconds. Remove it or set it to 0 to
turn the room server back on.

It works by answering the same `503 room server not enabled` that a Worker with no
room binding answers. That is deliberate: it is the fallback every page has been
using and exercising since the first day, rather than a second escape route that
has never carried a night. A page seeing that 503 reconnects to Supabase and the
game carries on, and nobody in the room sees anything.

`/health` tells you which way it is set:

    "room": true            the room server is serving
    "room": false           it is not, either no binding or the switch is on
    "room_off": true        the switch is on (absent when it is not)

Dean, 10 Sep 2026: "yes a global switch is good hopefully never have to use it."

## 31 Oct 2026: the default, with one road per venue

`var DEFAULT_ON = true;` in `venueplay/app/vp-room.js` (commit 26350ce2), on top of 771f3da0, which
closes every way a venue could end up split across the two roads once nobody types a flag:

* **Leaving is the room's decision.** A page that gives up on the room by itself (budget spent,
  or it heard a bingo page on the old road) POSTs `/room/handover?room=vp-XXXX`. The room says
  `{t:"room_handover"}` to every socket, closes them with **4503**, and answers 503
  `room handed over` to anyone for **six hours** (a mark on disk). A console still on Supabase
  re-asserts every two hours for up to twelve. Bingo rooms only, never an answers room.
* **ROOM_OFF reaches open rooms**: the first message after the switch empties the room the same
  way, and marks it. Reveal still takes trivia answers a room holds while the switch is on.
* **One ear on the old road**: the TV (one channel on the connection its router already has) and
  the console (one connection) listen on the Supabase channel of the same name. A bingo console,
  TV or signed bingo phone heard there (never `rw`, never another format's `fmt`) hands the room
  over. A phone that finds the room with no TV and no console listens for 40 seconds.
* **Budgets are awake time**: tv/host 8 s cold, 6 s warm; phone 8 s / 15 s; answers room 2.5 s / 6 s;
  a timer that fires 5 s late was a frozen window, so the budget restarts. Heartbeat: `ping` every
  25 s, answered `pong` by Cloudflare's auto-response; two unanswered is a dead socket.
* **Mixed versions**: a page takes the room by default only when presence says `handover: true`.
* **Not moved yet**: musical bingo, trivia, raffle and members draw still meet on Supabase. Bingo
  is the only format whose phones left it. Moving the others is the next step for connections.

Tests: room-fallback (61), venueplay-room-handover (21), tools/test-room-default-bingo.js (32, the
real console, phone, vp-room.js and room class together), tools/test-tv-room-default.js (18).
Test night: `docs/ROOM-SERVER-TEST-NIGHT.md`.

## 1 Nov 2026: every format on the room, one flip each, the Worker decides

Branch `feature/room-trivia-musical-1nov`, on top of the bingo default above.

**The channels, as they are on Supabase today** (CODE = the FNV hash of a slug, the same in tv.html,
vp-session.js, the game Worker and the room):

| channel | who talks | who listens |
|---|---|---|
| `vp-<CODE(slug)>` (bingo's, and the musical/trivia players' channel: the session join code is the venue code) | bingo console, bingo phones; musical/trivia consoles' `gsend` (stamped `fmt`); musical/trivia phones (join, claim, answered) | TV (bingo), game screens' router, phones, consoles |
| `vp-<CODE(musical-slug)>` | musical console (screen channel, `send`) | musical screen, TV router, other screens' routers |
| `vp-<CODE(trivia-slug)>` | trivia console | trivia screen, TV router, other screens' routers |
| `vp-<CODE(raffle-slug)>` | raffle console | raffle screen, TV router, other screens' routers |
| `vp-<CODE(members-slug)>` | members console | members screen, TV router, other screens' routers |
| `vpa-<game id>` (room only) | trivia phones' answers | the Worker at Reveal (untouched by this branch) |
| HQ reload / command | the Worker (`roomPublish` into bingo's room; the `/venue` poll as well) | the TV |

Signing is unchanged: every console signs (`VPSign.signSend`), every receiver runs its own
`VPSign.gate`, and the room relays the signed object untouched.

**What moved.** Each of those Supabase channels is now a room of the same name, in the format's
own flip. A page swaps the one line that made its channel for `VPRoom.venue(api, slug).channel(...)`,
which is shaped like a Supabase channel (on, subscribe, send, unsubscribe) and builds the page's own
Supabase channel, exactly as before, the moment the venue goes back. In the room nothing touches
Supabase, so a TV, a screen, a phone or a console holds no Supabase connection at all.

* **The Worker decides which formats are on.** `ROOM_FORMATS_ON` in venueplay-room.js (all false).
  `/room/presence` answers `formats` and `venue: true`; the TV's `/venue` poll carries the same
  answer as `room_formats`. Every page follows that one answer, so a console cached from yesterday
  and a TV loaded this minute cannot disagree. A TV that decided its roads before a flip sees
  `room_formats` change and reloads between games.
* **One venue, one road, for every room a page holds.** A page's rooms at one venue are one group:
  the first to go takes the rest, and the word is passed to all five of the venue's rooms
  (`POST /room/handover?room=..&venue=<slug>`, `soft=1` when passing it on, so an existing six hour
  mark is not pushed later). Any handover a page sends names the venue.
* **Old cached pages.** A TV on the room keeps NO ear on Supabase any more (that ear was one
  connection per TV, all day). Instead every console says `road` when it opens a game (`POST
  /session`, and the members draw): `room`, `supabase`, or `off` (the Worker said its format was
  off). The Worker hands the whole venue over for a console that says nothing (from before the
  switch), or `off` for a format that has since gone on (decided before the flip). An OLD TV is
  heard by the consoles: musical and trivia keep a one-minute ear on the players' channel, raffle
  and members on the venue's bingo channel, each saying `host_here` (rw) so an old TV answers.
  Old TVs also reload themselves within about ten minutes (TV_BUILD changed).
* **What the room was holding goes out first** on the new road, and so does the last `mode` the
  console said in the room (unless an `idle` came after), so a wall that was on the other road
  still follows the game.
* **Untouched:** the trivia answers room (vpa-), every game rule, billing, max players, overage
  approve-on-screen, kicked players and paused venues (all the Worker's, unchanged), the regulated
  module VP-DRAW. Musical bingo is not bingo and is never restricted like it.

**Flip one format:** set its line in `ROOM_FORMATS_ON` to true in venueplay-room.js, re-copy into
venueplay-game.js (the gate checks they match), stamp, deploy the game Worker. Do it in the morning:
a phone that joins a musical night already running when the flip lands goes into the room while the
console that opened before it is still on Supabase. **Take one back off:** the same line to false
and a deploy, or `ROOM_OFF=1` for everything at once, no deploy.

Tests: tools/test-room-formats.js (the whole shipped TV, consoles, screens and phones with the real
vp-room.js and the real room class), tools/test-room-old-console.js (the real POST /session and
members draw), venueplay-room-handover.test.js (venue fan-out, soft, formats),
tools/test-tv-room-default.js (no ear when the Worker hears old consoles).

### Supabase live connections at 1,000 venues, before and after

Same assumptions as the 30 Oct capacity plan: 40 phones a room, 25% of venues live at the peak
(250 rooms), one TV per venue all evening, Pro includes 500 connections, then US$10 per 1,000,
A$1.53 to the US dollar. "Before" is this branch's base (bingo on the room, the rest on Supabase).

| | Queensland-like (every live room musical or trivia) | Half bingo |
|---|---|---|
| TVs (one connection each, all evening: router plus ear) | 1,000 | 1,000 |
| live non-bingo rooms: console 1 + embedded screen 1 + phones 40 | 250 x 42 = 10,500 | 125 x 42 = 5,250 |
| live bingo rooms: the console's ear | 0 | 125 |
| **before, at peak** | **11,500** | **6,375** |
| over 500, billed per 1,000 | 11 blocks: US$110 = **A$168.30 a month** | 6 blocks: US$60 = **A$91.80 a month** |
| **after, every format on** | **0** steady (each console's one-minute ear at lobby open; at most a few dozen at once) | **125** (the bingo console's ear, unchanged) plus the same short ears |
| over 500 | none: **A$0** | none: **A$0** |

The 500 included connections then carry the consoles' ears with room to spare, so Supabase
Realtime stops being what caps Queensland (it was about 45 venues on today's code). The next wall
is the database itself (the join, ~15 calls a phone), the same as the 30 Oct plan says.
Durable Objects cost for this [A]: a TV holds five sockets that ping every 25 s (answered by
Cloudflare without waking the room); at 1,000 venues that is about 26 million requests a month at
the 20:1 WebSocket rate, about US$4 (A$6) a month on top of the Workers Paid plan.
