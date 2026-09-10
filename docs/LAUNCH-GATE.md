# The launch gate

Written 10 Sep 2026, after Dean said: "That stops testing becoming 'I'm pretty sure
Claude checked that bit.'"

This is a list of the things that have to be true before VenuePlay is sold to a second
venue, and next to each one, what actually proves it. Not what probably proves it.

## How to read it

**Covered** is one of three words and they mean exactly this:

* **yes**: something ran, and if the thing broke, the something would go red. A file
  name, a tool, a number, or a live incident is in the evidence column.
* **partly**: a real guard exists in the code and something checks that the guard is
  still written down, but nothing has ever run the guard and watched it work. This is
  the honest word for most of this list.
* **no**: nothing proves it. The evidence column is blank on purpose. A blank is not
  a gap in this document, it is the point of this document.

**Evidence** is a file, a tool, a build number, a measurement, or a date something
happened. "It looks right in the code" is not evidence and does not appear here.

**Who can prove it** matters, because a lot of this cannot be proved by any tool in
the repo. A host login, a real television and a phone in a pub are the only way to
see some of it, and that means Dean.

Three levels:

* **CRITICAL**: a venue loses a night, loses money, or sees another venue's data.
* **HIGH**: a bad experience, or a slow recovery from something ordinary.
* **LATER**: real, but not at one venue. Deliberately not launch blockers.

Everything below was checked on 10 Sep 2026 against the working copy at
`~/gflam-ai-team/sites` and, where it says live, against the live Workers by an
ordinary GET.

## What moved on 10 Sep, later the same day

Seven CRITICAL rows went from **no** or **partly** to **yes**, and each one is a tool
that would go red rather than a paragraph saying it looks right:

* Broadcast signing is ENFORCED at all 17 venues, not one. `check-signing.py` proves the
  key route both ways by signing in as a real host.
* A manager can no longer change the owner-only settings, in the DATABASE and not just in
  the page. Migration 77 is run on both.
* All 8 Stripe calls that move money carry an idempotency key. Four were not, and the new
  suite found the fourth itself.
* A retried Stripe webhook cannot run a branch twice. Migration 79, on both databases.
* One answer per player per question is now written down as a migration, having existed
  only by hand.
* The two databases are proved identical by a tool instead of a hand-written ledger, which
  is what caught Sydney missing two things before Saturday's cut-over.
* The room server's own suite has had its break-it half done.

**The biggest hole on this page did not move: nothing opens a page and asserts what is on
the screen.** Everything above still reads source or runs a function lifted out of a file.

**And both Workers still need pasting.** Nothing in the money rows above runs until they
are. Migrations 78 and 79 are already on both databases, and both Workers treat a missing
table as old behaviour, so the order is safe.

---

# CRITICAL

## Compliance

| What is tested | Why it matters in a pub | Covered | Evidence | Who can prove it |
|---|---|---|---|---|
| OLGR approval to run bingo, musical bingo, members draws and raffles in Queensland | Four of the five formats fall under the Charitable and Non-Profit Gaming Act. Running them for a for-profit pub without approval is not a bug, it is the regulator writing to Dean again. Trivia is exempt because it is skill. | **no** | | Dean. Two submissions to OLGRTechCNPG@justice.qld.gov.au: the RNG, and the bingo cards on players' phones (Portable Electronic Tickets). Neither has been sent. |
| The RNG stays server side, because that is what is being submitted | If the ball order moves back to the tablet, the machine drawing the numbers is a different machine from the one approved. | yes | Migration 70 draws the whole order server side. `bingo-server-draw.test.js`, 48 checks, green 10 Sep. `rng-evidence.test.js`, 12 checks, green. | The tools. Already true. |
| The venue is told which state rules apply and declares it is the conductor | OLGR treats VenuePlay as a Third Party Operator with a duty to make sure its clients comply. | **no** | | Dean, plus a build. The design is decided (state notes shown, a declaration recorded, no prize values asked for) and none of it is built. |

## A venue's data stays its own

| What is tested | Why it matters in a pub | Covered | Evidence | Who can prove it |
|---|---|---|---|---|
| A venue operator cannot see another venue's list, members or takings | An operator notices this once and never trusts the product again. It has been got wrong three separate times already. | **partly** | `venueplay-backend/tools/check-venue-scoping.py`, 7 of 7 pass, run 10 Sep. But read what it is: it opens `app/index.html`, `app/billing.html` and `app/settings.html` as text and runs regular expressions over them. It never signs in, never asks the database anything, and covers three pages out of the whole app. | Dean, or a tool nobody has written: sign in as venue A, ask for venue B, expect nothing back. |
| A manager cannot change the owner-only settings | The owner-only half is what players are asked for: email, mobile, marketing opt-in. A manager turning email collection back on at a venue whose owner turned it off is a privacy problem, not a preference. | **yes**, in the database | Migration 77 is RUN, on live AND Sydney, 10 Sep. It is a `before update` trigger on `vp_venue_settings`: anyone who is not an owner (and not the Worker or a platform admin) has the seven owner-only columns put back to what they were, silently and server side, so hiding the cards in the page is no longer the only thing stopping it. Sydney did not have it until today and nothing would have said so at cut-over: see `check-databases-match.py`. | Dean, to confirm the feel: sign in as a manager, turn email collection on, save, and watch it come back off. |
| Nobody outside a venue can send a fake ball or a fake winner to its TV | The realtime channel is named from a hash of the public slug and carries no row-level security, so the anon key printed in every page is enough to join it. | **yes**, 17 of 17 | Enforcement is ON at every active venue since 10 Sep. `venueplay-backend/tools/check-signing.py`, 8 checks green: every venue holds a key, none enforces without one, every x/y/d is 43 characters of URL-safe base64 (the only shape `crypto.subtle.importKey` takes), and the route is proved BOTH ways by signing in as a real host: it fetches its own key (200), is refused another venue's (403), and is refused with no login (401). Proved by breaking it. Rollback is `enforce-signing.py --off ALL`, effective on the next message. | Already proved. The one silent failure to watch: a console that cannot fetch its key sends UNSIGNED and an enforcing screen bins it, which looks exactly like "the console is not talking to the TV". |

## Money

| What is tested | Why it matters in a pub | Covered | Evidence | Who can prove it |
|---|---|---|---|---|
| A Stripe webhook that Stripe retries cannot charge twice | Stripe retries a webhook it did not get a 200 for. A retried event that bills is real money out of a venue's account. | **yes** | The signature is still verified before anything is parsed. Migration 79 adds the ledger, on BOTH databases 10 Sep. The claim is one insert that does nothing on a primary key clash, so of two deliveries arriving together exactly one proceeds; a finished event is answered 200 and dropped; an event claimed but not finished is left alone for five minutes and then TAKEN OVER, because stranding an event whose first attempt died would leave a venue that paid switched off. It fails open on every error path. `webhook-ledger.test.js`, 16 checks, runs the real function against a fake Supabase and asserts the HTTP. Proved by breaking it three ways. | The Worker must be PASTED for any of this to run. |
| Every Stripe call that moves money carries an idempotency key | Same reason. A key is what makes "run it twice" safe. | **yes**, 8 of 8 | Four were unkeyed on 10 Sep and all four are fixed: the discount rollback, the discount removal, clearing credit when a subscription ends (keyed on the Stripe event id, since that path is a webhook), and creating a coupon, which the new suite found rather than a human. `stripe-idempotency.test.js` now fails the gate on any future one: it parses every `vpbStripePost` call, splits the real arguments, works out which endpoint is being posted to, and requires a fourth argument on anything that moves money. It also refuses a key built from the clock or a random value, which would deduplicate nothing. Settings-shaped calls (a portal session, a quantity) are deliberately exempt. | Already proved. |
| The busy-night overage is billed once for a night, not twice | A double close, or the 3am sweep closing a night the host also closed, must not bill the same night twice. | **partly** | The key `overage_<session.id>` covers it, and `money.test.js` asserts the up, down and restore keys carry their direction. But that assertion is a string match on the Worker's source, not a replay: nothing constructs two keys and compares them, and nothing calls the charge twice. There is also no row in the database saying "this session has been billed", and Stripe forgets an idempotency key after 24 hours. | An agent can write the replay test. Dean can prove it once on a real invoice. |
| A session nobody closed does not bill every player who ever joined it | This one already happened. Session 9206e83c sat open for 23 days and collected 12 players across two separate nights. | **yes** | Nightly Cron Trigger `0 17 * * *`, which is 3am Brisbane, confirmed on the live Worker: it closed that session at 17:00:42 UTC on 28 Aug, 42 seconds after the cron fired. `release-check.py` also has a live check, "No venue has a session nobody closed", green 10 Sep. The sweep bills through exactly the same path a host close does, with the same key. | Already proved, on live, with a date and a session id. |
| The same phone joining twice is billed once | Venues are billed per head. A patron who refreshes must not become two patrons. Item 9 on the live-only list for exactly this reason. | **partly** | The phone mints a device id and the Worker reuses the existing row for it (`venueplay-game.js:2015-2053`), and the bill counts distinct devices, not rows (`countPlayers`, `:5829`). Migration 39 deliberately does NOT make the index unique, and says why: a failed insert means a patron cannot join, which is worse than a duplicate row. But no test anywhere exercises the join dedup path: `grep "handlePlayerJoin\|devIdValid\|b\.pid"` across every test file returns nothing. The one test that checks the counting uses its own copy of `countPlayers` pasted into the test file (`group-billing.test.js:55`), so the shipped one could regress and it would still pass. | Dean, with two phones, on the live-only checklist. And an agent, with a real test of the shipped counter. |

## The night itself

| What is tested | Why it matters in a pub | Covered | Evidence | Who can prove it |
|---|---|---|---|---|
| The TV never goes black and stays black | It has happened twice. A screen runs unattended for weeks and nobody is walking over to refresh it. | **partly** | `check-tv-watchdog.py`, 10 of 10 pass, run 10 Sep. Read what it is: ten string searches in `tv.html`. It never runs a line of that JavaScript, never builds a DOM, never opens a URL. It stops the watchdog being deleted by accident, which is its stated job, and that is all it proves. `tv-states.test.js` DOES execute the real `enterAds`, `enterHolding` and `gameLooksFrozen` lifted out of the page. The watchdog loop itself, `screenIsAlive()`, the four-minute deaf reload, the reload rate limit and the offline guard are executed by nothing. | Dean, with the venue TV: pull the wifi, put it back, and watch. Nothing in the repo can do it. |
| A bingo ball is called once, whoever called it | Two balls with the same number, or a ball lost, ends the game as an argument. | **yes** | Migration 70 holds a row lock (`for update`) and a `unique (draw_id, number)` constraint. This is the only properly serialised path in the product. `bingo-server-draw.test.js` green, and `one-trip-draws.test.js` runs the real `handleBingoBall` and proves a double tap returns 429 with nothing drawn. | Already proved by a test that runs the shipped code. |
| A members draw does not run twice | Two winners for one jackpot in front of a room. | **partly** | Two guards: a time hold on `last_drawn_at` (migration 69) and a pending record written the moment a winner is picked (migration 74), so a draw whose reply was lost on bad wifi hands back the SAME member on retry. `one-trip-draws.test.js` runs the real `handleMembersDraw` and proves exactly that, including that no second record is written. What it does not prove is a race: every test call is sequential, and neither guard uses a lock. Two consoles pressing at the same instant can still both get through. | The test covers the wifi retry, which is the case that actually happens. A race needs a concurrency test nobody has written. |
| A raffle draw does not run twice | Same. | **partly** | Same time-hold shape (`venueplay-game.js:2743`), 429 on a repeat inside the spin length. No test drives the repeat path. `redraw-confirm.test.js` only checks the console asks before a redraw. | Dean, on the live-only checklist. |
| One answer per player per question in trivia | The scoring is the game. A second answer after the reveal is cheating. | **yes** | The index IS there, on live and on Sydney, checked 10 Sep: `vp_trivia_answers_one_per_player_question` on `(game_id, question_id, player_id)`. It was in both databases and in NO migration, created by hand, so a rebuild from this repo would have dropped the guard with no error at all: `vp_player_answer` leans on the conflict to tell a phone it has already answered, and with no index there is no conflict, so the second answer goes in. It is migration 78 now. Phase 2 of the room server makes it matter more, because a whole question's answers arrive in one insert. | Already proved, by asking both databases. |

## Things nobody has ever done

| A backup has been restored | A backup nobody has restored is a belief, not a backup. | **yes**, 10 Sep 2026 | The 13.6 MB dump of the live database was taken and LOADED into the Sydney project, and `migrate-sydney.py verify` said **ALL MATCH**: 73 tables, 19 views, 25 functions, 106 policies, 5 triggers, 143 indexes, 15 auth users, 15 auth identities, 94 storage objects, and 92 tables/views compared with ZERO differing row counts. Then `play-a-game.py` played all five formats against the restored data: 146 checks, no failures. So it is a restore that was proved by USING it, not by the file existing. It also found a real fault: the restore failed the first time on a duplicate auth identity, because the tool relied on an ON DELETE CASCADE that cannot fire with foreign key triggers switched off. On the day that would have stopped the move with the public data replaced and auth half loaded. | Already proved. Whether the free tier takes its own daily backup is still unchecked in the dashboard, and that is a separate question. |
| Anything opens a page and asserts what is on the screen | This was the biggest hole on the list and it is why a blank console and a flashing slide both reached Dean on the day this was written. | **partly**, and it needs no toolchain | `venueplay/screen-check.html` loads the venue screen in a frame and asserts what is actually PAINTED, not what is in the DOM: something is on the wall, it says connected, it records which road it took, at most ONE six-character code is up (item 8 of the live-only list), a slide is lit, and waking the screen neither flashes the wall nor jumps back to slide one. That last pair is the fault Dean watched on a real screen and nothing had ever tested it. It is one HTML file on the same origin, so it runs on whatever device you open it on, INCLUDING THE FIRE STICK BEHIND THE BAR. What it still does not do: drive a game, click a host console, or hear a song. | Anyone, by opening /screen-check.html. Note a background tab throttles its timers, so a screen being tested must be the tab in front. |
| How many venues can play at once | This is the number that decides whether there is a business. | **measured properly on 10 Sep, and the answer changed** | Trivia is the format that runs out first, and the only one Queensland is open to today. Like for like on the free tier, same build, same afternoon, 18 trivia rooms and 736 players: **old path, phone answers p95 8.9 SECONDS, worst 17.0s, TV polls p95 1.9s. Room server, p95 183ms, worst 780ms, TV polls p95 205ms.** About fifty times, and every answer recorded on both. Pushed further on the room server: 36 rooms (1,504 players) p95 207ms, and 60 rooms (2,475 players, 99 answers a second) p50 54ms with 11,101 answers recorded and no failures. The remaining weak spot is the TV poll, which still costs a database call per venue. **The "1% tail of about ten seconds" was the harness, not the database, and is resolved:** every room started at the same instant, so every room hit its first reveal together, and a reveal scores a whole room. 60 rooms had 0 slow requests for ten seconds, then 517 in one burst at 24-29s, then 9 more in the next 95 seconds; 36 rooms had 0 for sixteen seconds, then 174 in a burst, then none. The round is 25 seconds and the burst is the first round boundary. Steady state was clean throughout. game-load.py staggers room starts now, with --in-step to measure a thundering herd on purpose. | Measured with `game-load.py` against Sydney. **Read the note below before re-running it.** |
| A game survives three hours | A night is three hours. Everything ever tested is two or three minutes. | **no** | `game-load.py` is documented and run with `--minutes 3`. `play-a-game.py` runs each format for about thirty seconds. Nothing has ever been left running. Memory leaks, an expiring token, a channel that quietly dies at ninety minutes and a watchdog that has never fired in anger all live in the gap between three minutes and three hours. | Dean, or an overnight agent run: one room, three hours, on staging, and read the log at the end. |

## Recovery when something drops

| What is tested | Why it matters in a pub | Covered | Evidence | Who can prove it |
|---|---|---|---|---|
| The whole night when the venue loses the internet | Nothing helps. Both roads out of the pub go through a server. | **no**, and it is written down honestly | `docs/OFFLINE-NIGHT.md` says it plainly: bingo degrades to the host calling from the tablet by voice with paper tickets, and the TV and every phone go quiet. Trivia and musical bingo stop. This is on the list, not built, and correctly sits behind the room server and Sydney. | Nobody, yet. It is a build, not a test. |
| The TV rejoins a game in progress after a reboot | A power cut mid-bingo. | **partly** | It does, and the path is real: the TV paints ads first so it is never black, announces itself with `hello:true`, and the HOST replays the current state from memory. The catch is in that sentence: if the host console is also down, nothing replies and the TV sits on ads. There is no server-side snapshot to rejoin from. No test drives a TV boot against a live host. | Dean, with the TV's power switch, mid-game. |
| A host tablet that goes to sleep comes back and puts the game back on the wall | This exact fault was seen at The Mini Bar: the wall dropped to the venue's ads and stayed there. | **partly** | The fix is built and is on all four host consoles: `pageshow` and `visibilitychange` both call `reassertToTv()`, guarded so a burst of both only speaks once, and refusing to re-post a game more than three hours old. No test touches it: `grep "reassertToTv\|reassertOnReturn\|STALE_GAME_MS"` across every test file returns nothing. | Dean, with the tablet: open a lobby, let it sleep, wake it, and watch the TV. |
| A phone that loses wifi mid-question comes back | Forty people, one bad access point. | **partly** | The phone repaints "Reconnecting" and re-announces itself so the host re-deals its ticket. But the console handles the `CLOSED` case and the phone does not, so a phone whose channel closes keeps believing it is connected and keeps sending into a dead socket. That is the exact fault that was already found and fixed on the console. | An agent can copy the console's fix across. Dean can see it with a phone in flight mode. |
| The room server dying mid-question falls back to Supabase | The fallback is the whole safety argument for the room server. | **partly**, and there is a real gap | The fallback works on the path it was designed for: the client asks over HTTPS first, and a 503 or 404 sends the page straight back to Supabase. But if the socket simply closes mid-question, the client calls `retry()` and re-probes forever on a 1 to 30 second backoff. Nothing ever converts sustained failure into "give up and use Supabase". `room-optin.test.js` checks the 503 path with regular expressions over the source and never opens a socket. | An agent, with an attempt threshold. Note phase 2 of the room server is being built right now by another agent, so this may already be moving. |
| `venueplay-room.test.js`, the room server's own suite | It is the real Durable Object class, and its header used to say "not yet run". | **yes** | 66 checks, green 10 Sep, and the break-it half is done: it has been broken on purpose more than once and gone red, including the message-key guard and the relay. Its own suite grew with phase 2 to cover the room holding answers. | Already proved. |

## Time

| What is tested | Why it matters in a pub | Covered | Evidence | Who can prove it |
|---|---|---|---|---|
| A game that runs past midnight is one night, not two | The billing streak counts nights. A night split in two could uplift a venue's plan on three games that were really one. | **yes**, for Queensland | `money.test.js:174-191` lifts the real `brisbaneNightKey` out of the shipped Worker and runs it: 9pm Saturday and 12:30am Sunday are the same night, 3am Sunday is a different one. Two assertions, real file, executed. | Already proved. |
| That boundary is right in New South Wales and Victoria during daylight saving | Queensland has no daylight saving, so the code uses a fixed UTC+10 and says so. A Sydney or Melbourne venue in summer is UTC+11, so its night boundary lands at 3am local, not 2am. A game finishing at 2:15am in Melbourne is counted as the next night. | **no** | `brisbaneNightKey` is `new Date(ms + 8*60*60*1000).toISOString().slice(0,10)`. It takes no venue and reads no column. A per-venue `timezone` column DOES exist and is populated from the postcode (migration 24, including Sydney, Melbourne, Adelaide, Perth, Hobart, Darwin), and the only thing that reads it is the TV deciding which weekday to print. No test covers daylight saving anywhere: `grep -i "daylight\|DST"` across every test file returns nothing. Perth is four hours off this boundary all year. | An agent, by passing the venue's timezone into the night key. Not a blocker while every venue is in Queensland, which is why this is HIGH and not CRITICAL. |
| The same night boundary in the Worker and on the phone | Two copies of the same arithmetic that nothing keeps in step. | **no** | `venueplay-game.js:5836` and `play.html:588` each carry their own `+8h` version. `money.test.js` cross-checks the two pricing functions for exactly this reason and does not cross-check these. | An agent. One assertion. |

## Deploys and the things that quietly disappear

| What is tested | Why it matters in a pub | Covered | Evidence | Who can prove it |
|---|---|---|---|---|
| A deploy does not silently remove the rate limiter, the room server or the 3am sweep | A Cloudflare deploy replaces a Worker's bindings with whatever the config declares. Anything not declared is removed, with nothing to tell you. | **no** | `venueplay-backend/worker/deploy-game/wrangler.toml` declares one KV binding whose id is still the literal text `PASTE_THE_RL_KV_NAMESPACE_ID_HERE`, no Durable Object binding and no cron trigger. Live has all three: `/health` reports `joinDedupCache:true` and `room:true`, and the 3am sweep is proved working. So if anyone ever deploys with wrangler from that folder, the join dedup, the room server and the nightly sweep all vanish at once. | Dean or an agent: either fill the config in properly or delete it so nobody uses it. Deploys today go through `tools/deploy-worker.py`, which is why this has not bitten. |
| The gate itself can still fail | A check that cannot fail is worse than no check, because the green line says the job was done. | **partly** | `tools/prove-checks.py` exists and does exactly this: it breaks the thing each check watches, in a scratch copy, and requires that check to go red. It has already caught a real one. It takes about fifteen minutes and it is not run every time. | Dean or an agent, before a release that matters. |
| The full release gate is green | | **yes** | `python3 tools/release-check.py --local`, run 10 Sep: exit code 0, every unit suite green, `check-tv-watchdog.py` and `check-venue-scoping.py` both green. | Already run. Run it again after the push, not just before. |

## The six faults only a person can see

These came out of a real musical bingo night on 31 Aug. No tool in the repo can see any
of them, and they are on the release checklist for that reason. Covered: **no**, all six.
Only Dean, in a pub, with a TV and a phone.

1. One code on the wall, and it is the one the console shows.
2. Join, refresh, and join again from the table link: the player count goes up by one, not three.
3. Album art stays up while a song plays, including when somebody joins.
4. The card does not flash when a song is played.
5. Open a lobby right after ending a game and leave it: it stays a lobby and does not drop to the ads.
6. Turn the room volume past 100% and confirm the TV gets louder without distorting.

---

# LATER

Real, and not launch blockers at one venue. Saying so is more useful than a checklist
nobody finishes.

| What | Why it can wait |
|---|---|
| A full device and browser matrix | One venue, one TV, one tablet, and phones that are almost all recent iPhones and Androids. Test the devices that are actually in the room. This becomes real at twenty venues. |
| A web application firewall, and WAF rules | The Worker already rate limits joins per IP and refuses admin routes to strangers, and `release-check` probes both. A WAF is a subscription and a tuning job for a product with four concurrent venues. |
| Multi-factor authentication tooling for host logins | Host logins already time out for a compliance reason and that is the part that matters. MFA on a pub tablet behind the bar is a worse experience for a smaller gain, today. |
| A feature flag framework | There are already two flags that work and are used: `?roomserver=1` and `ROOM_OFF=1`. A framework is what you buy when you have fifty. |
| An error tracking service | Worth having eventually. Today the faults that reach Dean are visual, and no error tracker would have caught a flashing slide or a blank console. The browser test would. Build that first. |
| SOC 2, ISO 27001, HIPAA | Not needed and never were. The Spam Act and the Privacy Act are the ones that apply, and the ABN belongs in every email footer. |
| The offline night, where the tablet becomes the room | Written up honestly in `docs/OFFLINE-NIGHT.md`. It sits behind the room server going live and behind Sydney, and it should not be started until a room has carried real nights. |
| A penetration test | After the browser test, after Pro, and after the OLGR submissions. It costs money and it will mostly find things this page already names. |

---

# What to do first

In this order, because each one is cheap and each one closes something on this page
that nothing else closes.

1. **Run migration 77.** A manager can currently change what players are asked for at a
   venue whose owner turned it off. The fix is written and has never been run.
2. **Ask the live database whether the trivia answer index exists.** One line. Right now
   nobody knows whether a player can answer twice, and three code paths assume they cannot.
3. **Deploy the game Worker**, which is behind the repo, then run `release-check.py`
   after, not just before.
4. **Deploy while two phones are connected**, at The Mini Bar, and watch what happens.
   Fifteen minutes, and it is the last unknown in an ordinary Friday.
5. **Restore the 8 Sep dump into Sydney and run `verify` until it says ALL MATCH.** That
   is the only thing that turns a file on a laptop into a backup.
6. **Send the two OLGR submissions.** The lead time is the risk, not the work, and
   nothing in the code moves it along.
7. **Correct `MIGRATIONS.md`** against what `/health` already reports.
8. Then, and it is the biggest one: **something that opens a page and asserts what is on
   it.** Every other line on this page is checked by reading text. That is why the two
   faults that reached Dean today were invisible to all of it.

## Added 10 Sep 2026, after a second review

Three rows the first version of this page did not have. Two came from an outside
review, one from Dean.

| what | why it matters in a pub | level | covered | evidence | who can prove it |
|---|---|---|---|---|---|
| **The fallback stampede.** If the room server goes away while N venues are on it, they all fall back to Supabase in the same few seconds. | The fallback exists so a room never notices. If everyone arrives at once and the database cannot take them, the safety net becomes a second, larger outage. Measured today: the free tier bends at roughly 20 to 25 database calls a second, and fifteen trivia rooms already collapsed. | CRITICAL | **no** | | me, once phase 2 lands: put N rooms on the room server, kill the room mid game, and measure what the database does |
| **Silent to the pub, deafening to us.** A fallback is invisible today: nothing records it and nothing tells anyone. | Every room fault on 10 Sep was invisible. A page said Connected while talking to nobody. If a venue silently spends a month on the slow path we would never know. | CRITICAL | **no** | | me: record venue, session, time, transport, reason and retries, and alert. Then pin the session rather than bouncing it between transports |
| **A minimum supported-device list.** Not a full matrix: current iPhone Safari, Android Chrome, the host's actual iPad, the venue's actual TV. | Before taking money you have to be able to say what VenuePlay supports. Right now nobody can. | CRITICAL | **no** | | Dean, on the actual devices in the room. No tool can stand in for this |

And two changes of level, both from the same review and both accepted:

* **Basic error tracking** moves from LATER to **HIGH**. Not a launch blocker, but once
  somebody pays, a JavaScript error on their Samsung should not have to be described to
  us over the phone. Browser testing first, error tracking soon after.
* **MFA on the high-privilege HQ accounts** moves from LATER to **HIGH**. MFA for the
  bloke running Tuesday trivia stays in LATER. A host account and an account that can
  reach every venue in the country have completely different blast radii.

One thing left where it was, with the reason: a paid penetration test stays in LATER,
but **automated adversarial tenant isolation is now CRITICAL and DONE**, which is the
part of a pentest that matters most for a multi-tenant product. See
tools/tenant-isolation-attack.py and the commit that added it.
