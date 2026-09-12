# VenuePlay: how many venues, and what it costs

Measured against the live Sydney system on 12 September 2026. Prices read off Supabase and
Cloudflare the same day.

**The headline: the plan is not what stops you. The architecture is.**

---

## How many venues each road carries

Assumes 40 phones in an average room, and a quarter of all venues playing at the same moment
on a peak night.

| Road | Venues it carries | What actually stops it |
|---|---|---|
| Today. Free plan, nothing changed | **10** | database calls |
| Pro $25/month, same code | 29 | database calls |
| Pro + buy more connections | 29 | database calls |
| + cache the 8 second lobby poll | 549 | database calls |
| + turn the room server on | 773 | database calls |

Then the wall becomes the JOIN itself, which costs 12 database calls every time one phone
scans the code:

| Join costs | Venues |
|---|---|
| 12 calls (today) | 773 |
| 6 calls | 1,549 |
| 3 calls | 3,101 |
| 2 calls | **4,650** |

**These are conservative.** Every number assumes you never buy bigger compute than the small
box you are on now, because 155 calls a second is the only paid figure actually measured.
Bigger compute should raise every row, possibly a lot. That is not measured, so it is not
claimed.

---

## What it costs at 5,000 venues

| | Per month |
|---|---|
| Supabase Pro | $25 |
| Compute, XL to 2XL | $210 to $410 |
| Cloudflare Workers Paid | $5 |
| Durable Objects (the room server) | $300 to $400 |
| Residual Supabase realtime | about $50 |
| **Total** | **roughly $600 to $900 USD** |

Against 5,000 venues at 50 seats and $3 a player, that is **about $750,000 a month of
revenue**. Infrastructure is around **0.1%**.

Money is never your constraint on this curve. Engineering is.

---

## What to do, in order

1. **Supabase Sydney to Pro, about $25 USD a month.** Mostly for the BACKUPS. Free has none
   at all, and seventeen paying venues currently sit on a database with no restore point.
   It also lifts 10 venues to 29 and stops the project auto-pausing.
2. **Cache the 8 second lobby poll.** Biggest single win, 29 venues to about 550, and cheap.
   `/play/live` returns the same four fields to every phone on the same code, so caching it
   at Cloudflare for three seconds removes about 99% of the dominant load.
3. **Turn the room server on.** Already built, already tested, took 500 phones in one room.
   Gets you to about 775 and moves live traffic off Supabase entirely.
4. **Make the join cheaper.** 12 calls to 3 is what takes you past 3,000 venues. This is the
   real engineering job and nobody has started it.

---

## The numbers behind all of the above, measured not guessed

| What | Free (Sydney, today) | Paid (Singapore, same size box) |
|---|---|---|
| Database calls per second | **45** | 155 |
| Phones holding a live channel | **about 200**, then refused | 600+ |
| Speed of one call when idle | 109ms | 282ms |

- A phone WAITING in a lobby costs **0.5 database calls a second**, every second, forever.
  Four calls every eight seconds. This is the dominant load and the cheapest thing to fix.
- A phone JOINING costs **10 to 14 calls**, once.
- A venue mid-trivia costs about **0.33 calls a second**.
- Both projects report identical `max_connections`, `shared_buffers` and `work_mem`. Same
  size box. So the gap above is the PLAN, not the hardware.
- Database size is a non-issue: **35 MB** of the 500 MB free ceiling, and 14 MB of that is
  the 37,678 question trivia bank, which barely grows.

One room is fine to about **80 phones**, visibly slows at 90, and falls over at 100. Because
the ceiling is shared, a hundred phones in one pub is felt by all seventeen venues at once.

**The speed win from the Sydney move is real and it only exists when the system is quiet.**
Under a crowd, Sydney is slower than Singapore was, because it runs out of capacity sooner.

---

## Supabase prices, for reference

| Plan | Price | Database | Realtime connections | Backups |
|---|---|---|---|---|
| Free | $0 | 500 MB | 200 | **none** |
| Pro | $25 | 8 GB | 500 | 7 days |
| Team | $599 | 8 GB | **still 500** | 14 days |

A bigger plan does not buy you more rooms. Overage does: **$10 per 1,000 connections**,
$2.50 per million realtime messages, $0.125/GB database, $0.09/GB egress.

Compute add-ons: Micro $10, Small $15, Medium $60, Large $110, XL $210, 2XL $410, 4XL $960.
