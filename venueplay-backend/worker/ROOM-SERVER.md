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
