# PartyPlay: the money and licence path

12 September 2026. A read-only audit of checkout, the Stripe webhook, licence activation,
the 24/72 window, preparation, and the 50 player cap. Nothing was changed and nothing was
run: every claim below names the function and the line it came from. Where the code cannot
answer the question, it says "unknown without testing" rather than guessing.

Files read in full: `worker/SOURCE-do-not-paste-partyplay-api.js` (1969 lines),
`lib/pp-licence.js`, `worker/partyplay-api.test.js`, `supabase/partyplay-01` through `13`,
`tools/check-paid-not-delivered.py`, `tools/build-worker.py`, and the front end pages
`start.html`, `booked.html`, `run.html`, `play.html`, `practice.html`, `tv.html`,
`admin.html`, `lib/pp-config.js`.

`DEPLOY-partyplay-api.js` was checked against the source: it is `SOURCE` with
`lib/pp-licence.js` inlined at the marker, same build stamp `12 Sep 2026, 07:16 · 33cdfc4d`,
same webhook code at lines 1691 to 1749. Reading the source is reading what ships.

Worst first.

---

## 1. A buyer can pay Stripe and sit at `pending` forever, and nothing inside the business will ever notice

**What happens.** `handleCheckout` (line 1489) writes the licence row as `status: 'pending'`
(line 1536) and then sends the buyer to Stripe. The row only becomes `paid` in
`handleWebhook` (line 1643). Every read path filters on `status=eq.paid`: `handleLicence`
(line 1681), `requireHost` (line 373), `handleJoin` (line 1741), `handleAlbumShare`
(line 685). So if the webhook never arrives, or arrives and throws before the PATCH, the
buyer has been charged and owns nothing at all: no code that resolves, no host key, no
email, no way into `/host` or `/run`.

Nothing reconciles this. `tools/check-paid-not-delivered.py` is the only money-side check in
the repo and its SQL is:

```sql
where l.status = 'paid' and l.welcome_sent_at is null
```

It only looks at rows that already reached `paid`. A row stuck at `pending` is outside its
`where` clause entirely. Nothing anywhere calls the Stripe API to list sessions and compare
them against `pp_licences`, so the authoritative record of who paid is never read back.

`handleStats` (line 1382) reads `status=in.(paid,refunded)`, so a stuck row is also absent
from every revenue figure and from `now.upcoming`. The loss is invisible from the inside in
three places at once.

**Evidence.** `handleCheckout` line 1536; `handleWebhook` line 1643; `handleStats`
line 1382; `tools/check-paid-not-delivered.py` line 50.

**Blast radius.** One customer per missed webhook, $50 or $120 each, and a complaint that
arrives by email days later if it arrives at all. Cloudflare Worker outages, a Worker
returning 503 because a secret is missing (line 1911 answers 503 to the webhook path too,
since `missingSecrets` is checked before routing at line 1908), and Stripe giving up after
its 3 day retry window all produce this silently. The first witness is the customer.

**Smallest fix.** A `tools/check-stripe-vs-licences.py` that lists Stripe Checkout Sessions
with `payment_status=paid` for the last 30 days and reports any whose
`metadata.licence_id` is not a `paid` row in `pp_licences`. Roughly the shape of
`check-paid-not-delivered.py`, with one Stripe list call instead of nothing. It is the only
check that can see this class of fault, because the licence table on its own cannot.

---

## 2. The welcome email cannot fail loudly, and `handleResendWelcome` stamps "sent" before it sends, which blinds the only check that exists

**What happens.** PartyPlay is delivered by one email. Four things stack up so a failed
send is indistinguishable from a successful one:

1. `sendLicenceEmail` (line 1786) opens with `if (!env.RESEND_API_KEY) return;`. No key, no
   email, no complaint, and `RESEND_API_KEY` is not in `REQUIRED` (line 1836), so `/health`
   answers `ok: true` on a Worker that cannot send anything.
2. The Resend call at line 1809 is a bare `await fetch(...)` with no look at `r.ok`. A 401
   from an unverified domain, a 429, a rejected address: all of them resolve normally and
   throw nothing. The same is true of all four senders (`sendLicenceEmail` 1809,
   `sendFollowupEmail` 526, `sendAlbumEmail` 790, `sendNudgeEmail` 1235).
3. In `handleWebhook` the `try` at line 1661 therefore succeeds, and line 1663 stamps
   `welcome_sent_at`. The row now asserts the email went.
4. `handleResendWelcome` (line 1273) is worse. It PATCHes `welcome_sent_at` at line 1293
   and only then calls `sendLicenceEmail` at line 1296. A real throw leaves a false stamp
   behind, and `RESEND_GAP_MS` (line 1271) then refuses to try again for three minutes.

`check-paid-not-delivered.py` reads `welcome_sent_at is null` and nothing else. Every one of
the four failures above leaves that column populated. It is a check that cannot go red.

This is the fourth instance of the swallow-with-no-record pattern this week in the sibling
product, and it is the highest value one here because it sits directly on the delivery path.

**Evidence.** `sendLicenceEmail` line 1787 and line 1809; `REQUIRED` line 1836;
`handleWebhook` lines 1661 to 1667; `handleResendWelcome` lines 1293 to 1296.

**Blast radius.** Every buyer, on every send, for as long as Resend is unhappy. A domain
verification that lapses takes out 100 percent of deliveries with `/health` still green and
`check-paid-not-delivered.py` still clean.

**Smallest fix.** Three edits, all small:

```js
const r = await fetch('https://api.resend.com/emails', {...});
if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text()).slice(0, 200));
```

in all four senders; add `RESEND_API_KEY` to `REQUIRED` at line 1836; and move the
`welcome_sent_at` PATCH in `handleResendWelcome` to after the send, the way
`handleSendAlbums` already does it deliberately at line 770 with a comment explaining why.

---

## 3. The 24 and 72 hours are enforced on the server at exactly two doors, and gameplay is not one of them

**What happens.** The window is a real server side check, but only in these places:

| Where | Line | What it guards |
|---|---|---|
| `handleJoin` | 1745, 1746 | a new guest joining |
| `handlePhotoUpload` | 599 to 602 | a guest adding to the album |
| `handleSendAlbums` | 757 | not emailing an album before the party ends |
| `handleFollowups` | 498 | not chasing a party that is still running |

And these places report the window without enforcing anything: `handleLicence` (line 1689),
`handleGamesList` (line 396), `handleAdminParty` (line 1087). `requireHost` (line 369) has
no window check at all, which is correct and deliberate: preparation is unlimited.

The night itself never touches the Worker. `PPConfig.channel` (`lib/pp-config.js` line 49)
names a Supabase Realtime broadcast channel `pp-<CODE>`, and `run.html` line 158, `tv.html`
line 224 and `play.html` line 288 all connect to it with `SUPA_ANON`, the publishable key
that is printed in `pp-config.js` for anyone to read. Every ball, question, answer and
leaderboard is a browser to browser broadcast. No server is in that loop, so no server can
stop it when the clock runs out.

The only thing that ends a host's night is client side: `run.html` lines 364 to 370, a
30 second `setInterval` that recomputes `PPLicence.isLive` from `PARTY.endsAt` held in a
JavaScript variable and flips the page to `finished`.

**How a host could change it client-side, exactly.** Open devtools on `/run`, and either
set `PARTY.endsAt` to a later ISO string (the interval reads that variable, not the server),
or simply never let that interval matter, since the broadcast functions `send()` and the
game runners are reachable from the console directly. A guest cannot do this: `play.html`
and `tv.html` hold no window at all and only react to what is broadcast. So the client side
escape belongs to the person who already paid, and the ceiling on it is that no NEW guest
can join after `expires_at`, because `handleJoin` is a real server check.

There is a second, worse version of the same hole. Because the channel is unauthenticated,
anybody who learns the six character code can subscribe with the public anon key and both
read and send on it, without ever calling `/join`. They never appear in `pp_players`, never
count against the 50 cap, and are never subject to the window. This is the same
unauthenticated realtime posture as the sibling product's known hole. No migration in
`supabase/` configures Realtime Authorization, so there is nothing standing in front of it.

**Evidence.** `handleJoin` 1745 to 1746; `handlePhotoUpload` 599 to 602; `run.html` 364 to
370; `lib/pp-config.js` 44 and 49; `play.html` 288 to 295; `tv.html` 224.

**Blast radius.** For the window: a host buying 24 hours and taking 72 costs $70 of margin
per occurrence and requires devtools, so it is small and it is bounded by guests not being
able to join. For the open channel: anyone with the code can inject a message onto a
television in someone's living room. The code is read aloud at a party and shown on a TV,
so the population who could is "guests, and anyone they tell". 27^6 is 387 million, so it
cannot be guessed.

**Smallest fix.** For the window, nothing urgent: the join gate is the one that matters and
it is server side. For the channel, turn on Supabase Realtime Authorization so the anon role
cannot read or write `realtime.messages`, and have the Worker mint a short lived channel
token at `/join` and at `requireHost`. That is a real piece of work, not a one liner, and it
should be sized before launch rather than after.

---

## 4. The host presses start a day early. It is irreversible from their side, and the screen they end up on offers them no way out

**What happens.** `startClock` (`run.html` line 295) puts up `window.confirm` with
`PPLicence.startWarning` (`lib/pp-licence.js` line 86), which reads:

> Start your 24 hours now? The clock runs from this moment, so only do this when the party
> is actually happening. You can keep building games without starting it.

That is a good warning and it is the right words. If they confirm anyway,
`POST /licence/start` reaches `handleStart` (line 1704), which writes `activated_at` and
`expires_at` under an `activated_at=is.null` filter (line 1720) so a double tap is safe.

What the host sees next is the running console: the code, the clock, the games. Nothing on
that page says "started by mistake?" and there is no undo button anywhere in `run.html` or
`host.html`. I grepped both.

Twenty four hours later the licence expires. When they open `/run` on the actual night,
`render()` (line 324) draws this and nothing else:

> **That is a wrap**
> Your time is up. Hope it was a good one.

No explanation, no email address, no support link, no mention that it can be fixed. Guests
who try to join get `handleJoin` line 1746: "This party has finished." Also a dead end.

**Is it recoverable.** Yes, but only by staff. `handleAdminAction` (line 1114) has
`unstart` at line 1133, which PATCHes `activated_at: null, expires_at: null`, and `extend`
at line 1142, which adds up to 72 hours. Both are buttons in `admin.html` at lines 445 and
446 ("Put the clock back", "Give them 24h more"), both are logged to `pp_admin_log` with the
actor and a reason (line 1177). So a support person has exactly the right tool and can fix
it in one click, once they know.

**What it costs the host.** Nothing in money, everything in time and nerve. They have to
find `hello@partyplay.com.au`, which is not on the screen they are looking at, email it, and
wait for a human. There is no phone number and no on-call rota in the repo. If the mistake
is discovered at 8pm on a Saturday with guests arriving, the product is dead until somebody
answers an inbox.

Two smaller things that follow from `unstart`: it leaves `activated_days` and
`activated_note` (migration 05) populated from the mistaken start, and it removes the party
from `ranTotal` in `handleStats` (line 1399), so a corrected accident quietly changes a
month that has already been reported.

**Evidence.** `run.html` 295 to 309 and 324 to 328; `handleStart` 1704 to 1731;
`handleAdminAction` 1133 to 1140; `admin.html` 445 and 446.

**Blast radius.** One customer at a time, on the single worst night to have a problem. It is
the most likely support call in the product after "I lost the email".

**Smallest fix.** Two lines of copy on the `finished` gate in `run.html` line 324: "Started
it by mistake, or the party moved? Email hello@partyplay.com.au and we will put the clock
back." A host who can see the way out will take it, and staff already have the button.
Better still, and still small: a self-service undo on `/run` for the first 30 minutes after
`activated_at`, guarded by the host key, calling the existing `unstart` logic. That turns
the worst experience in the product into a non-event, and it cannot be abused because a
party that has genuinely run for half an hour has players in `pp_players` to prove it.

---

## 5. The 50 cap counts everyone who ever joined, not who is in the room, and the host's own counter disagrees with it

**What happens to player 51.** `handleJoin` (line 1771) inserts into `pp_players`. The cap
is the database trigger `pp_enforce_player_cap` (`partyplay-01-core.sql` line 115):

```sql
select count(*) into n from pp_players where licence_id = new.licence_id;
if n >= 50 then raise exception 'PartyPlay is capped at 50 players' ...
```

`handleJoin` catches it at line 1775, matches `/50 players/i` against the wrapped PostgREST
message, and returns 409 with "This party is full, it is capped at 50 players." That is a
readable, correct refusal and `partyplay-api.test.js` line 251 covers it.

**What happens when 50 join, 30 leave and 30 more arrive.** The 30 who left are still rows.
There is no leave route anywhere in the Worker: I grepped for one and the only DELETE
against `pp_players` is `handleAdminAction`'s `clear-players` (line 1154) and `kick`
(line 1160). So the trigger counts 50, and all 30 new arrivals are refused, in a room with
20 people in it.

That is arguably correct for a 50 person licence. What is not correct is the drift around
it:

- **A rejoin burns a seat.** `play.html` line 852 reuses a saved token from `localStorage`,
  so a normal reload is free. But private browsing, a cleared browser, a second phone, or a
  guest who joined on their laptop and switches to their phone all call `/join` again. The
  worker gives them "Sam 2" (line 1762) and the cap loses a seat.
- **The host's counter is a different number.** `run.html` line 93 builds `players` from
  realtime `hello` broadcasts (line 162), deduplicated by name. So the strip says
  "34 playing" while the database holds 50 rows. When guest 51 is refused, the host is
  looking at a screen that says there is plenty of room and has no way to find out otherwise.
- **The trigger races.** It does `select count(*)` and then inserts with no lock, so two
  concurrent joins can both read 49 and both commit. 51 players is possible. Minor, and it
  fails in the customer's favour.

**Evidence.** `partyplay-01-core.sql` 115 to 127; `handleJoin` 1759 to 1782; `run.html` 93,
162, 292; `play.html` 852 to 857; `handleAdminAction` 1151 to 1162.

**Blast radius.** A party that hits the cap with a half empty room, at the moment guests are
arriving, with a host who cannot see why. The recovery exists (`clear-players` in the admin
console, line 1154, "Empty the room") but again requires ringing somebody.

**Smallest fix.** Have `handleJoin` return the current seat count in its reply, and have
`run.html` show "34 here, 41 of 50 seats used" from the server number rather than from the
broadcast count. The host can then see the problem coming and ask the duplicates to stop.
A `last_seen_at` based reclaim is the bigger fix and is not needed yet.

---

## 6. Revenue is recorded at list price, never at what Stripe actually took

**What happens.** `handleCheckout` writes `price_cents: priceCents` from
`PPLicence.plan()` (line 1506 and 1536). `handleWebhook` never reads `s.amount_total` or
`s.currency`: the PATCH at lines 1643 to 1651 writes only `status`, `paid_at` and
`stripe_payment_intent`. `handleStats` then reports `b.revenueCents += (r.price_cents || 0)`
(line 1434) and refunds the same way (line 1440).

Checkout sets `allow_promotion_codes: 'true'` (line 1552), and `sendFollowupEmail` ships a
live 10 percent code (`FOLLOWUP_PROMO_CODE`, default `AGAIN10`, line 524). So the discount
path is not hypothetical, it is marketed. Every redemption overstates revenue by $5 or $12,
and the books never learn.

There is a second consequence. A 100 percent off promotion code produces
`payment_status: 'no_payment_required'`, which `handleWebhook` line 1636 explicitly accepts
as a grant. That is the right behaviour for a comp, but it means a leaked or guessed
Stripe promotion code is a free party recorded in the database at full price. Nothing in
the Worker can tell that apart from a real sale.

**Evidence.** `handleCheckout` 1506, 1536, 1552; `handleWebhook` 1636, 1643 to 1651;
`handleStats` 1434, 1440; `sendFollowupEmail` 524.

**Blast radius.** The monthly and quarterly numbers in `/admin/stats`, which is the only
revenue reporting in the product. Wrong by the value of every discount ever redeemed, and
wrong in the flattering direction.

**Smallest fix.** One line in the webhook PATCH:
`price_cents: (typeof s.amount_total === 'number' ? s.amount_total : undefined)` alongside
the existing fields, so the row records what was actually charged. Keep `is_comp` for the
zero cases so comps stay distinguishable from a 100 percent code.

---

## 7. The one control that stops a bank transfer becoming a free licence has no test

**What happens.** `handleWebhook` line 1636:

```js
if (s.payment_status && s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') {
  return json({ ok: true, pending: s.payment_status });
}
```

This is the guard that stops BECS and bank transfer, which Stripe completes with
`payment_status: 'unpaid'` while the money is in transit, from being granted a licence. The
comment above it explains exactly that.

The test payload at `worker/partyplay-api.test.js` line 135 has no `payment_status` field at
all. `s.payment_status` is `undefined`, the whole condition short circuits false, and every
webhook test in the file takes the grant path. There is no test anywhere that sends
`payment_status: 'unpaid'` and asserts no licence was granted. Delete line 1636 and the
suite stays green.

**Evidence.** `handleWebhook` 1636; `partyplay-api.test.js` 135 to 136.

**Blast radius.** One free licence per delayed payment method purchase, only if the guard
regresses. Nothing today is wrong. What is wrong is that nothing would notice if it broke,
and the guard is the kind of line that gets "simplified" in a refactor.

**Smallest fix.** Two more cases in `partyplay-api.test.js`: a `completed` event with
`payment_status: 'unpaid'` that must not PATCH anything, and an
`async_payment_succeeded` event with `payment_status: 'paid'` that must. Both are four lines
each, using the `sigHeader` helper already there.

---

## 8. The idempotency test proves the branch, not the behaviour

**What happens.** "second delivery is idempotent" (`partyplay-api.test.js` line 167) sets
`FETCH.plan = [{ status:200, body:"[]" }]`, which makes the stubbed Supabase return an empty
array, and then asserts `j.already === true`. It proves that the Worker handles an empty
PATCH result correctly. It does not prove that `?status=eq.pending` is on the PATCH URL,
which is the entire mechanism. Remove the filter from line 1643 and this test still passes,
because the stub returns `[]` regardless of what was asked.

The real protection is sound: the PATCH is filtered on `status=eq.pending` at line 1643, so
PostgREST returns zero rows on a retry and line 1652 returns early before the email and
before the subscriber write. Stripe retries and a duplicate delivery are both safe. The
concern is only that the test cannot fail.

**Evidence.** `partyplay-api.test.js` 167 to 172; `handleWebhook` 1643 and 1652.

**Blast radius.** None today. It is a green line that means less than it looks like it
means, and this repo has been caught by exactly that before.

**Smallest fix.** Have the stub assert on the URL it was given, not just return a body. One
line: record `FETCH.lastUrl` and `ok(/status=eq\.pending/.test(FETCH.lastUrl))`.

---

## 9. Replay, signature, and the routes that can create or activate a licence

Recording the answers to question 1 in full, because they are mostly good news.

**Every route that creates a licence row.** Two, and only two.
`handleCheckout` (line 1489) creates it as `pending`, and no `pending` row is usable
anywhere: `requireHost` (line 373), `handleLicence` (1681), `handleJoin` (1741) and
`handleAlbumShare` (685) all filter `status=eq.paid`.
`handleComp` (line 452) creates one directly as `paid`, guarded by `adminActor`.

**Every route that flips a row to paid.** One. `handleWebhook` line 1643. That is the whole
surface, and it is behind a signature check.

**Every route that activates a licence.** One. `handleStart` (line 1704), behind
`requireHost`, so the join code alone is not enough. `partyplay-api.test.js` line 208 covers
a guest with only the code being refused.

**Is the signature verified.** Yes, properly. `stripeVerify` (line 240) recomputes
HMAC-SHA256 over `t + '.' + rawBody`, compares with `timingSafeEqual` (line 266), handles
multiple `v1` values, and `handleWebhook` reads the raw text at line 1584 before any parse.
The router sends `/stripe/webhook` straight to it at line 1917 before anything else touches
the body.

**Can it be replayed.** Within the 300 second tolerance, a captured request can be sent
back and will verify (line 252 to 253). It achieves nothing: the PATCH is filtered on
`status=eq.pending`, so the second delivery returns `{ok:true, already:true}` at line 1652
without sending an email or rewriting `paid_at`. Outside 300 seconds it is rejected, and
`partyplay-api.test.js` line 158 covers that. A future timestamp is also bounded, because
line 252 uses `Math.abs`.

**The residual risk is the admin key, not Stripe.** `isAdmin` (line 297) accepts the key
from `X-Admin-Key`, from the JSON body, or from `?key=` in the query string. A leaked
`ADMIN_KEY` is unlimited free three day licences through `handleComp` (line 452), which
chooses 3 days by default (line 462). Failed admin attempts are not logged anywhere:
`logAdmin` (line 1361) only runs on success. **Smallest fix:** drop the query string branch
at line 301 now that `admin.html` uses the header, and log refusals with the source IP.

---

## 10. Preparation cannot be turned into a free party

Recording the answer to question 4, because it is clean and worth having written down.

**What `practice.html` can do.** Nothing that touches anything. The whole file is 188 lines
with one `<script>` block, no `fetch`, no `PPConfig.API`, no Supabase client, and no
`localStorage` write. It builds three hardcoded guests (line 105), shuffles 90 balls from
the fixed seed `42` (line 122), and paints real tickets through `PPTicket.build`. It is
bingo only. There is no channel for a phone to connect to, so no guest can see it and no
guest can play it. Its banner is accurate: "Nothing here touches your party, nothing is
saved, and none of your time is used."

**What the build screens can do.** `handleGamesList`, `handleGameSave` and
`handleGameDelete` (lines 388, 403, 441) deliberately have no window check, which is the
documented product decision at line 385: "Building games is NOT limited by the licence
window". But all three go through `requireHost` (line 369), which requires
`status=eq.paid` AND a matching `host_key`. So preparation is unlimited only for somebody
who has already paid. A `pending` licence cannot build anything.

**Could a host run a whole party without starting the clock.** No, and the reason is
`handleJoin` line 1745: a guest cannot join a licence with `activated_at` null, so there is
nobody to play with. The host could put `/tv` on a television and broadcast to it from
`/run`, but `run.html` line 314 draws the "Ready when you are" gate instead of the console
whenever `PARTY.status === 'ready'`, so there are no game buttons to press.

The only way to play without paying is the open realtime channel in finding 3, and that
requires a live party belonging to somebody who did pay.

---

## 11. Swallowed failures, all of them, with no record left behind

The pattern that has caused four real faults in the sibling product this week. Every
instance in this Worker:

| Line | What is swallowed | Does it matter |
|---|---|---|
| 1667 | `sendLicenceEmail` failure in the webhook | **Yes.** Finding 2. The product is this email. |
| 1809 etc | all four Resend calls ignore `r.ok` | **Yes.** Finding 2. A failure is not even thrown. |
| 483 | comp email failure, `console.log` only | Yes, smaller. A comp winner gets nothing and staff think it went. |
| 1658 | subscriber write failure after payment | Small. A consented subscriber is silently lost. |
| 1183 | `pp_admin_log` write failure in `handleAdminAction` | Yes. The audit line for a support action that already happened. |
| 1367 | `logAdmin` catch, empty | Same, for staff changes. |
| 350 | `pp_admins.last_seen_at` PATCH, `.catch(() => {})` | No. Genuinely best effort. |
| 741 | `recordSubscriber` in `handleNotifyMe` | Small. |
| 946 | R2 orphan listing in `handlePhotoSweep` | No. The row sweep above it is the real job. |
| 624, 847 | R2 delete after a failed index write | No. Correct compensating action. |
| 985 | unsubscribe body parse | No. Falls through to a readable page. |
| 1225 | `handleNudgeExpiring` per row | No. It collects codes into `failed` and returns them. This is the pattern the others should copy. |

`handleNudgeExpiring` line 1214 is the one that does it right: it accumulates `failed` and
puts it in the response. `handleFollowups` (line 512) and `handleComp` (line 483) log to a
console nobody reads.

**Smallest fix.** Make the four Resend senders throw on `!r.ok` (finding 2), and have
`handleFollowups` and `handleComp` return a `failed` array the way `handleNudgeExpiring`
already does. The admin log failures at 1183 and 1367 should at minimum be counted in the
response so a support person sees "your action worked but was not logged".

---

## 12. Smaller notes on the money path

- **`handleCheckout` claims an idempotency key it does not have.** The comment at line 1555
  says "Stripe dedupes on this, so a double-tapped button cannot create two sessions. The
  header form is set below via a second call parameter." `stripe()` (line 274) takes no
  headers and sets none. A double tap makes two pending rows and two codes. The button is
  disabled client side at `start.html` line 214, so this is database litter rather than a
  double charge, but the comment asserts a control that does not exist, and a comment is a
  claim.
- **A Stripe failure orphans the pending row.** `handleCheckout` writes the row at line 1528
  and calls Stripe at line 1542. If Stripe throws, the row stays `pending` forever with no
  session id. `checkout.session.expired` cannot clean it up because no session was ever
  created. Harmless, but it inflates `now.upcoming` in `handleStats` and it is the same
  shape of row as finding 1, so a reconciliation tool will need to tell them apart:
  `stripe_session_id is null` is the discriminator.
- **`price_cents` is `not null` in migration 01 and comps write 0** (line 479) while
  carrying `is_comp: true`. That is deliberate and the comment in migration 03 explains it.
  It works.
- **Migration 01 declares `au_state`, `start_date`, `starts_at` and `ends_at` as NOT NULL,
  and `handleCheckout` writes none of them.** Migration 04 drops all four constraints
  (lines 30 to 33). If 04 were not applied, every checkout would 500 on the insert. Two real
  paid licences from 26 and 29 August are recorded in `check-paid-not-delivered.py`'s
  header, so 04 is live. Strictly this is unknown without testing, but the evidence is
  strong.
- **`/health` does not prove the money path.** It checks seven secrets, the R2 binding and
  the admin count, all good, but none of Stripe reachability, the price IDs resolving, or
  Resend. The live Worker answering `{"ok":true}` is not evidence that a purchase works.
  Whether the end to end path works today is **unknown without testing**, and a single
  $50 test purchase would settle findings 1, 2, 6 and 7 at once.

---

## What I could not determine from the code

- Whether the live Supabase project has Realtime Authorization configured outside the
  migrations in this repo. Nothing in `supabase/` touches it, but a dashboard setting would
  not appear here. **Unknown without testing:** subscribe to `pp-XXXXXX` with the published
  anon key and see whether it connects.
- Whether `hello@send.partyplay.com.au` is a monitored inbox. Every email says "just reply"
  and none of the four senders sets `reply_to`.
- Whether any Stripe promotion codes currently exist, and at what discount.
- Whether the webhook endpoint is actually registered in the Stripe dashboard for all four
  event types the Worker handles. It handles `checkout.session.completed`,
  `async_payment_succeeded`, `async_payment_failed` and `expired` (lines 1612 and 1613). If
  the dashboard only subscribes to the first, the delayed payment handling that finding 7
  discusses never fires at all.
