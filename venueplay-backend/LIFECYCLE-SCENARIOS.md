# VenuePlay lifecycle scenarios: what the product may not handle

Read-only audit, 12 September 2026. Nothing in this pass changed a file.

## What was read

- `venueplay-backend/worker/venueplay-api-FULL.js` (all 5,974 lines available; read in
  full for checkout, the Stripe webhook, provisioning, the `vpb*` account routes, the
  `vpa*` admin routes, staff management and the archive sweep)
- `venueplay-backend/worker/venueplay-game.js` (function index plus the sections that
  decide sessions, the kill-switch, staff auth, overage and plan uplift)
- `venueplay/app/vp-session.js` (in full)
- `venueplay/app/index.html` (sign-in, venue picker, shift/session close, bingo hold)
- `venueplay/app/billing.html` (cancel and undo UI), `venueplay/app/settings.html` (in full)
- `venueplay-backend/supabase/venueplay-{17,41,48,67,77}*.sql` and `MIGRATIONS.md`

## What was NOT checked

- **Nothing was executed.** No Worker call, no Supabase query, no Stripe call. Every
  "what happens today" below is read off the code, not observed.
- **The base schema is not in this repo.** `venueplay-backend/supabase/` starts at
  migration 13. There is no `CREATE TABLE` for `vp_venues`, `venueplay_founding` or
  `vp_venue_staff` anywhere in the tree, so column types, defaults and unique
  constraints are unverified. Two findings below turn on the sort order of
  `venueplay_founding.id` and I could not confirm its type. Marked accordingly.
- **Which migrations are actually live.** `MIGRATIONS.md` is verified only to 67 and
  its own last paragraph warns it drifts. Migration 77 matters a lot below; its live
  state is asserted from the ledger, not probed.
- **Stripe's real behaviour** on a deleted subscription, a zero quantity, or a
  trial_end floor. Anything depending on it is marked unknown without testing.
- `hq.html` was not read line by line (only grepped); the HQ-side experience of these
  scenarios is therefore inferred from the `/admin/*` routes it calls.
- Group accounts (`vp_venue_groups`, `group_id`) were read only where they intersect
  billing. A group-invoiced account (migration 67) has its own lifecycle and is not
  covered here.

---

# Ranked by blast radius, worst first

## 1. A login that is staff at two billing accounts silently gets ONE of them, chosen by a sort

**Covers scenarios 1, 2 and 4.** This is the single fault behind most of what follows.

**What happens today.** `vpbRequireOwner` (`venueplay-api-FULL.js:4230`) resolves the
caller's account like this: it reads every `vp_venue_staff` row for the login with
`role=in.(manager,owner)`, loads those venues ordered `founding_id.asc,created_at.asc`
(line 4283), then takes `const foundingId = venues[0].founding_id` (line 4287) and
filters the venue list down to that one account. Every owner-side route in the product
goes through it: `/account/summary`, `/account/players`, `/account/cancel-venue`,
`/account/add-venue`, `/account/hosts`, `/account/optin-export`, `/account/managers`.

So a person who is a manager or owner at venues belonging to two different
`venueplay_founding` rows sees exactly one of those accounts on the Account page, with
no picker, no notice, and no error. The other account is unreachable from the app.

The permissions lookup at the bottom of the same function has the same shape and is
worse: it re-reads all their manager/owner rows across every account and takes the
first one carrying a `permissions` object — `for (const s of (pr||[])) { if (s &&
s.permissions) { perms = s.permissions; break; } }`. Restrictions set by account B's
owner are therefore applied to the caller while they are acting on account A. It can
only restrict, never widen, so it is not an escalation; it is an owner losing their own
buttons because of a job somewhere else.

**Correct, wrong, or unknown.** Wrong. Which account they land on is
**unknown without testing**: it depends on the type and ordering of
`venueplay_founding.id`, which is not in this repo. If it is a UUID the winner is
effectively random per account pair.

**Blast radius.** Money and lockout, silent. The owner of a returning venue can be shown
their old dead account and never see the one they are paying for. A multi-site manager
can change the player count, cancel a venue, or export the marketing list on whichever
account happened to sort first. No error is raised in any of those cases.

**How to break-test it.** Take one AU mobile. Create account A with one venue, account B
with one venue, and add that mobile as a manager at both (`/account/manager-add` from
each owner). Sign in as that mobile and open `/app/billing.html`. Record which account
renders. Then swap the two `founding_id` values' sort position (create a third account
whose id sorts first and add the same mobile) and reload. If the page changes account
without the user doing anything, it is confirmed. Second half: set one toggle to `false`
in account B's manager permissions and check whether the button disappears on account A.

---

## 2. A venue that has already cancelled can still be moved up a plan and charged for it

**What happens today.** `upliftPlan` (`venueplay-game.js:5778`) raises `max_players` after
three big nights. Its only guard is `if (venue.pending_players != null) return null` — a
scheduled *reduction*. It never looks at `cancel_at_period_end` or `status`. A venue that
cancelled on the 3rd and keeps playing until the 30th (which is exactly what
`vpbCancelVenue` promises them) can run three big nights inside that window and be moved
to a bigger plan.

On an annual plan the same function then raises a pro-rata Stripe invoiceitem, opens an
invoice for it and settles it immediately (`openInvoice` / `settleInvoice`, lines
5827-5880) — a real card charge against a venue that is leaving.

Meanwhile `accountBilledTotal` (`venueplay-game.js:5617`) skips venues with
`cancel_at_period_end`, so the `subscription_items` quantity write in the same function
is a no-op for this venue. The quantity does not move, `quantityOk` is still true
(the Stripe call succeeded, it just changed nothing), so the rollback at line 5893 does
not fire. The venue keeps the raised `max_players` and the charge stands.

**Correct, wrong, or unknown.** Wrong on the charge. The `max_players` change is
harmless (the venue is going). The annual pro-rata charge is money taken from a
cancelling customer for capacity they will never renew.

**Blast radius.** Money, and the worst kind: an unexpected card charge to a customer who
has just told you they are leaving. Also a refund conversation and a likely dispute
(`vpaRecordDispute`, `:3833`).

**How to break-test it.** On a test annual account: cancel the venue via
`/account/cancel-venue`, confirm `cancel_at_period_end` is true, then run three
sessions over the plan cap on three separate Brisbane nights (`tools/prove-the-uplift.py`
exists for this) and watch Stripe for an `invoiceitem` plus an immediately-settled
invoice. `tools/live-overage-test.py` is the nearest existing harness.

---

## 3. Undoing a cancellation after the period has rolled restores the billing and not the games

**What happens today.** `vpbCancelVenue` (`venueplay-api-FULL.js:5116`) writes exactly one
column on undo: `await vpaPatch(env, 'vp_venues', ..., { cancel_at_period_end: !undo })`.
It then calls `vpaSyncAccountQuantity`, which puts the Stripe quantity back up and clears
`cancel_at_period_end` on the subscription. It never touches `status`.

But by the time the period has rolled, `vpbApplyPendingOnInvoice` (`:5311`) has already
run on `invoice.paid` and set that venue to `status: 'suspended'`. `assertVenueActive`
(`venueplay-game.js:6592`) refuses anything but `active`, and `blockedByHold`
(`index.html:1641`) stops broadcast bingo in the console.

So: owner cancels, period ends, owner changes their mind, presses Undo on the billing
page (`billing.html:756`), the page says it worked, the quantity goes back up and they
are billed again at the next renewal — and every game stays off. The only route back is
`/admin/venue-status` with `status:'active'`, which is HQ-only.

**Correct, wrong, or unknown.** Wrong, and it is a one-line class of bug: two writers of
the same lifecycle (`cancel_at_period_end` and `status`) that only one of them maintains.

**Blast radius.** Money (they pay) plus lockout (they cannot play), and silent — the UI
reports success.

**How to break-test it.** Cancel a test venue, force the period to roll (fire an
`invoice.paid` webhook for that subscription, or advance the Stripe test clock), confirm
`vp_venues.status` is now `suspended`, then press Undo in `billing.html` and try to start
a game. Expect the "settle up" toast.

---

## 4. Un-archiving an owner-cancelled venue turns the games back on while it stays unbilled

**What happens today.** `vpaHandleVenueStatus` (`:2255`) writes the status **first**,
unconditionally:

```
await vpaPatch(env, 'vp_venues', 'id=eq.'+venueId, {
  status: archiving ? 'suspended' : status, ... });
```

Only afterwards does the billing block run, and for a venue whose reason is
`archived_cancelling` (i.e. the owner had cancelled before we archived it) that block
deliberately does nothing but set a warning string:

```
billing = { changed: false, error: 'This venue was cancelled by the owner before it was
archived, so it is still set to stop ... Turning it back on does not restart their billing.' }
```

The comment above it describes exactly this bug being fixed — but what was fixed was the
*message*. The venue is still `active`, `cancel_at_period_end` is still true, so
`vpbAccountTotal` (`:4452`) and `accountBilledTotal` still exclude it, and it plays for
free until the next `invoice.paid` re-suspends it through `vpbApplyPendingOnInvoice`.

**Correct, wrong, or unknown.** Wrong. HQ is told, the venue is not, and the service is
given away in the meantime.

**Blast radius.** Money (free service for up to a billing period, up to a year on
annual), and invisible to everybody except whoever read the HQ response body.

**How to break-test it.** Owner-cancel a test venue, archive it from HQ (it becomes
`suspended` / `archived_cancelling`), then un-archive it. Assert that either the status
stays suspended or `cancel_at_period_end` is cleared and the quantity moves. Today
neither is true.

---

## 5. A venue that is sold cannot change hands, and the previous owner cannot be removed

**Scenario 3.**

**What happens today.** Nothing in either Worker ever writes `vp_venues.founding_id`
after creation. It is set in `vpaProvisionFromCheckout` (`:2477`), `vpaProvisionOneVenue`
(`:2782`) and `vpaHandleVenue` (`:1158`), and nowhere else — grep for a patch of that
column returns only a comment. There is no route, admin or otherwise, that moves a venue
to a different billing account.

Nor can the outgoing owner be removed. `vpbRemoveHost` (`:5850`) refuses any target whose
rows are full-access:

```
const targetIsFullAccess = (targetRows||[]).some(r => (r.role === 'owner') || (r.role !== 'host' && !r.permissions));
if (targetIsFullAccess) return json({ error: 'That login has full access to this account,
  so it cannot be removed here. Email hello@venueplay.com.au ...' }, 403);
```

and every provisioning path writes the owner's row as `role:'manager'` with **no**
`permissions` object (`:2589`, `:2837`, `:1283`, and `tools/repair-venue.py:185`), which
is the definition of full access. `vpbSetStaffVenues` (`:5899`) refuses them too. There
is no `/admin/*` route for venue staff either — `/admin/staff` (`vpaHandleStaff`, `:2369`)
manages `vp_platform_admins`, i.e. Gflam people, not venue logins.

So the only path for a sale is: old owner cancels; venue goes dark; new owner signs up
fresh. That gets them a **new venue row with a new slug** — `vpaUniqueSlug` (`:1081`)
sees the old slug still taken and appends the postcode, so `royal-hotel` becomes
`royal-hotel-4218` — which changes the join code and every printed table talker, and
leaves the members list, draw history, opt-in list and game history attached to the dead
row. And the old owner's login keeps full access to all of it, forever, removable only by
hand-written SQL.

**Correct, wrong, or unknown.** Wrong as a product gap; the individual guards are each
correct in isolation (they exist to stop a manager deleting the publican).

**Blast radius.** Data leak — the seller keeps `/account/optin-export` on a venue they no
longer own, which is the venue's marketing database and a Privacy Act problem. Plus data
loss for the buyer and new signage.

**How to break-test it.** Set up venue V under account A with an opt-in list. Cancel it.
Sign up account B for the same venue, same postcode. Then, as account A's owner, call
`/account/optin-export` and see whether the old list still comes back. Separately, as
account B's owner, try to remove account A's login from the Hosts list.

---

## 6. The real account owner cannot save the owner-only settings, and is not told

**What happens today.** Migration 77 (`venueplay-77-owner-only-settings.sql`) adds a
`BEFORE UPDATE` trigger on `vp_venue_settings` that silently reverts `name_display` and
all six `collect_*` columns unless the caller is a platform admin or has

```
select 1 from public.vp_venue_staff s
 where s.venue_id = new.venue_id and s.auth_user_id = auth.uid() and s.role = 'owner'
```

**No code path in this repo ever inserts a staff row with `role: 'owner'`.** Every insert
is `'manager'` or `'host'` (`:1283`, `:2589`, `:2837`, `:5412`, `:5823`, and
`tools/repair-venue.py:185`). The migration's own header acknowledges it — "a real
owner's row can be stored with role 'manager' at a group, which is why the Worker uses
perms rather than the role word. Here the role word IS the question being asked" — and
uses the role word anyway.

`settings.html` saves through `VP.saveSettings` (`vp-session.js:369`), which is a direct
PostgREST upsert as the signed-in user, so the trigger applies. `gateOwnerOnly`
(`settings.html:230`) uses the *correct* test (no `permissions` object = owner) and
therefore shows the owner the cards and the Save button. The read-back at
`settings.html:288` only re-checks the four marketing toggles, so a reverted
`name_display`, `collect_first_name` or `collect_last_name` reports a plain "Saved."

**Correct, wrong, or unknown.** Wrong, *if* migration 77 is live. `MIGRATIONS.md` is only
verified to 67; the working assumption is that 77 is in (79 is the latest file). **Verify
before acting.** The mechanism itself is unambiguous from the SQL.

**Blast radius.** Silent, and it is a compliance surface: the owner-only cards are what
decide what personal data the venue asks players for. An owner who believes they have
turned name-on-TV off, or first-name collection off, may not have.

**How to break-test it.** As a self-serve venue owner (not an HQ admin), change
`name_display` on `/app/settings.html`, save, reload. If it comes back to the old value
with no warning, confirmed. Second probe: `select role, count(*) from vp_venue_staff
group by role` — if there are zero `owner` rows, the guard can never pass for a customer.

---

## 7. A venue that comes back gets a second free month of overage

**Scenario 1, money leg.**

**What happens today.** `sbReturningAccount` (`:667`) exists precisely to deny a returning
venue a second free month, and it works — but only on the Stripe *trial*:
`const trialTs = returning ? MIN_TRIAL : launchTs` (`:360`).

The game Worker has a second, independent free-month rule. `venueInFreeMonth`
(`venueplay-game.js:5931`) returns true when `Date.now() - Date.parse(vp_venues.created_at)
< 30 days`, and `chargeNightOverage` / the consoles use it to skip the overage consent
screen and the charge entirely. A returning venue is provisioned as a **brand new
`vp_venues` row** (new `founding_id`, so the find-by-founding_id lookup in
`vpaProvisionFromCheckout:2535` misses the old one), so `created_at` is today and they get
a fresh 30 days of uncharged overage.

`sbReturningAccount` also matches `mobile.eq.<raw trimmed input>` against the stored raw
`mobile`, with no normalisation on either side, so `0400 123 456` and `0400123456` do not
match each other. The email match is the only reliable leg.

**Correct, wrong, or unknown.** Wrong, and it is two rules for one promise living in two
Workers.

**Blast radius.** Money, small per venue, silent, and it scales with churn.

**How to break-test it.** Provision a second account on the same email, run a night over
the plan cap on day one, and assert Stripe receives the overage invoiceitem. Today it
will not.

---

## 8. Owner leaves the business and the mobile is disconnected

**Scenario 5.**

**What happens today.** Identity is the mobile number: sign-in is `signInWithOtp({phone})`
(`index.html:675`), and every staff row hangs off the `auth.users` id that
`vpaAuthCreateUser` / `vpaFindAuthUser` (`:974`, `:998`) resolve from that phone. **No
route in either Worker changes an existing login's phone number** — `vpaAuthGetUser` is
read-only and there is no update-user call anywhere.

Managers added the normal way cannot stand in. `vpbAddManager` (`:5369`) always writes a
`permissions` object, so `vpbIsOwner` (`:4331`) is false for them and `vpbOwnerOnly`
(`:4333`) blocks cancelling a venue, adding a venue, managing managers, and the
owner-only settings.

The only route back is a Gflam admin using View-as: `vpbRequireOwner` honours the
`X-VP-Venue` header for a `vp_platform_admins` row with role `owner` or `accounts`
(`:4258-4272`). That is a real, working path — it is just manual and not documented to
the customer anywhere I could find.

**Correct, wrong, or unknown.** Correct that it is recoverable; wrong that it is only
recoverable by ringing Dean, and that nothing in the product says so. There is no
"transfer ownership" and no second full-access login by design.

**Blast radius.** Lockout of a paying account, plus the billing keeps running while
nobody can cancel it. Not silent — they will ring.

**How to break-test it.** Create a venue, add a restricted manager, then disable the
owner's phone in Supabase Auth. Sign in as the manager and try to cancel a venue, add a
venue, and change `collect_email`. All three should refuse. Then confirm an HQ admin with
role `accounts` can do all three via View-as.

---

## 9. A recycled mobile number inherits somebody else's staff rows

**What happens today.** `vpbAddHost` (`:5783`) and `vpbAddManager` (`:5369`) both do
create-then-find: on `alreadyExists` they call `vpaFindAuthUser(env, {phone})`, which
matches on digits only (`String(u.phone).replace(/[^\d]/g,'')`, `:1014`). The staff rows
already attached to that auth user are never reviewed. Nothing ever removes a staff row
on a lifecycle event — not cancellation, not archiving, not suspension.

So when an AU carrier recycles a number (they do, after about six months of
disconnection), the new holder of that number signs in with an SMS code and inherits every
`vp_venue_staff` row the old holder had, at every venue, including any full-access
`role:'manager'` row with no permissions.

**Correct, wrong, or unknown.** Wrong, but **unknown without testing** how often it bites
in practice. The code is unambiguous: there is no second factor and no re-verification.

**Blast radius.** Data leak (opt-in export, members list) and potentially money (a
full-access legacy row reaches `/account/players`). Silent.

**How to break-test it.** Not testable end-to-end without a real recycled number. Test the
mechanism instead: add mobile X as a host at venue A, remove nothing, then add mobile X as
a host at venue B from a different account. Assert that `/account/my-venues` for that login
returns both — it will (`vpbMyVenues:5953` does not scope by account). That is the same
inheritance, proven.

---

## 10. The cancelled venue is still in the host's venue picker, and it tells them to settle up

**Scenario 1, the sign-in leg.**

**What happens today.** Three separate faults stack:

1. `resolveRole` (`vp-session.js:147`) selects `vp_venue_staff` with **no `order` clause**,
   and `pickVenue` (`:214`) takes `mine[0]`. With staff rows at both the old and the new
   venue, which one becomes the default venue after sign-in is arbitrary.
2. `showVenuePick` (`index.html:755`) filters out only archived venues —
   `isArchivedVenue` (`:1634`) tests `suspended_reason === 'archived' ||
   'archived_cancelling'`. A venue that ended through `customer.subscription.deleted`
   carries `suspended_reason: 'ended'` (`handleWebhook:596`) and a venue suspended by
   `vpbApplyPendingOnInvoice` (`:5324`) carries **no reason at all** — that patch writes
   `{ status: 'suspended' }` and nothing else. Neither is filtered, so both stay in the
   picker beside the live venue, usually under the same name.
3. Tapping one hits `blockedByHold` (`index.html:1641`), which for anything that is not
   archived says *"Your tab has run a bit long. Settle up on your account page and we
   will get your games going again."* That is a debt-collection message shown to a venue
   that deliberately left, or that cancelled one venue of five and kept paying.

**Correct, wrong, or unknown.** Wrong on all three. Note the fact in the brief — "a
cancelled venue ends as `suspended_reason='ended'`" — holds only for a whole-subscription
cancellation. A partial cancel (one venue on a multi-venue account) goes through
`vpbApplyPendingOnInvoice` and ends with a **null** reason, which nothing downstream
recognises.

**Blast radius.** Not money, but it is the first thing a returning or multi-site customer
sees and it reads as either a broken login or an invoice they do not owe.

**How to break-test it.** Cancel one venue on a two-venue account, fire the renewal
`invoice.paid`, then sign in as that account's manager and open the venue picker. Expect
both venues listed and a "settle up" toast on the dead one. Check
`select status, suspended_reason from vp_venues` to confirm the null reason.

---

## 11. A cancelled venue on an annual plan keeps playing for up to a year

**What happens today.** The only automatic thing that suspends a venue flagged
`cancel_at_period_end` is `vpbApplyPendingOnInvoice`, and it runs **only on
`invoice.paid`** (`handleWebhook:524`). On a monthly account that is ~30 days away and is
exactly right. On an **annual** account the next `invoice.paid` is up to eleven months
away.

Meanwhile `vpaSyncAccountQuantity` (`:4480`) drops the Stripe quantity the moment they
cancel, with `proration_behavior: 'none'` — so the credit lands at renewal and the venue
is off the bill from that moment, while still fully playable.

The backstop is `vpaAutoArchiveSweep` (`:2157`), which is admin-triggered
(`/admin/auto-archive`), **dry-run unless `dry_run:false` is explicitly sent** (`:2153`),
and skips anything still inside its paid period. There is no cron behind it that I found.

**Correct, wrong, or unknown.** For a whole-account annual cancellation, Stripe fires
`customer.subscription.deleted` at period end and `vpaSuspendForNonpayment(..., 'ended')`
catches it, so that case is covered. For a **partial** cancellation on an annual account —
one venue of five — **unknown without testing**, but the code path says the venue stays
`active` and unbilled until the annual renewal.

**Blast radius.** Money, up to a year of one venue's service, silent.

**How to break-test it.** Two-venue annual account. Cancel venue A. Assert the Stripe
quantity drops immediately. Then, without any `invoice.paid`, open a session at venue A.
If it opens, confirmed.

---

## 12. The billing page shows a live bill for a dead subscription

**What happens today.** `venueplay_founding.stripe_subscription_id` is never cleared —
`vpaClearCreditOnEnd` (`:3929`) zeroes the customer balance and nothing else. So for an
ended account, `vpbAccountSummary` (`:4537`) reports `has_subscription: true` and
`comp: false`, and `vpbSubItem` (`:4516`) returns `{ sub }` with no `itemId` for a
deleted subscription, which makes `stripeQty` null and sends `totalPlayers` to the local
sum. The page then renders a monthly total and a per-venue price for an account that is
paying nothing.

`vpaAddCardRedirect` (`:3083`) makes this a dead end rather than a recovery: it refuses
whenever `f.stripe_subscription_id` is set — `if (f.stripe_subscription_id) return
Response.redirect(site + '/app/billing.html', 302)` — which for an ended account is
always. So the one HQ-assisted route that could put a card back on an existing account
bounces them to the page described above.

**Correct, wrong, or unknown.** The redirect guard is right for its intended case (a
paying venue clicking an old link twice) and wrong for a dead one. What Stripe returns
for `items` on a deleted subscription is **unknown without testing**, so the exact
numbers rendered are unverified; that it is not a `comp` and not a blank page is certain
from the code.

**Blast radius.** Silent and confusing, and it is what closes off the only re-subscribe
path. Combined with #1 it is how a returning venue ends up looking at their old account's
price list.

**How to break-test it.** Cancel a test account to completion, let Stripe delete the
subscription, then open `/app/billing.html` as that owner and hit the `/add-card` link
from their original welcome email.

---

## 13. Two different answers to "which venues are mine"

**What happens today.** `vpbMyVenues` (`:5953`) — which drives the sign-in venue picker —
returns every venue the login has **any** staff row at, across all accounts, with no
`founding_id` filter. `vpbRequireOwner` (`:4230`) returns exactly one account's venues.
`vp-session.js`'s `listVenues` (`:347`) returns whatever RLS allows, which is a third
definition. `showVenuePick` (`index.html:755`) then re-filters client-side.

**Correct, wrong, or unknown.** Wrong as a consistency matter. Each individual answer is
defensible; four of them is how a manager ends up running a game at a venue whose Account
page they cannot open.

**Blast radius.** Silent confusion, and it is the visible symptom of #1.

**How to break-test it.** One login, two accounts, one venue each. Compare
`/account/my-venues` (two venues) against `/account/summary` (one). Both are correct
according to their own code.

---

## 14. Re-adding a venue you cancelled is refused as a duplicate

**What happens today.** `vpbAddVenue` (`:4952`) calls `vpaProvisionOneVenue` (`:2782`),
which is idempotent by `founding_id` + **exact name** and does not filter on status. A
cancelled, suspended venue still matches, so `r.created` is false and the route answers
`409 'You already have a venue with that name. Use a different name.'`

Combined with #3 (undo restores billing but not status) there is no self-serve way for a
multi-venue owner to bring back a venue they cancelled. Either they rename it — which
produces a new slug and a new join code (`vpaUniqueSlug:1081`) and new signage — or they
ring us.

**Correct, wrong, or unknown.** Wrong. The 409 is correct behaviour for a live duplicate
and wrong for a suspended one.

**Blast radius.** Lockout of a paying customer from a purchase they are trying to make.
Not silent.

**How to break-test it.** Cancel one venue on a two-venue account, roll the period, then
try to add a venue with the same name from the Account page.

---

## 15. Hosts and managers are never pruned by any lifecycle event

**Scenario 2, the leg that is actually correct.**

**What happens today.** Per-venue authorisation is genuinely sound. `requireStaff`
(`venueplay-game.js:6533`) re-derives the venue per request and matches a staff row for
that exact venue, and `vpbOptinExport` (`:5436`) scopes strictly to `o.venues`. A manager
who moves from A to B and is added at B **cannot** reach B's data through A or vice versa.

What is missing is any offboarding. No cancellation, archive, suspension or sale removes a
staff row. Removal is manual, through `/account/host-remove`, and is refused entirely for
full-access logins (see #5). `vpbListHosts` (`:5702`) is scoped to the caller's one
account, so an owner cannot even *see* that their manager also works for a competitor.

**Correct, wrong, or unknown.** The access control is correct. The absence of offboarding
is a gap, not a bug.

**Blast radius.** Data leak over time: staff accumulate access to venues they left.
Silent.

**How to break-test it.** Add a host at venue A, then have venue A cancelled and archived.
Query `vp_venue_staff` for that login. The row is still there, and if A is ever
un-archived they are back in with no action by anyone.

---

## 16. A venue suspended for non-payment is reactivated by any payment on the account

**What happens today.** `vpaReactivateOnPayment` (`:3892`) loops every venue on the
customer and flips `suspended_reason === 'nonpayment'` back to active. The trigger is
`invoice.paid` on **any** invoice for that customer (`handleWebhook:607`). The game Worker
raises standalone invoices of its own for overage and plan uplift (`openInvoice`,
`venueplay-game.js:5697`).

So a $2.00 overage invoice settling could reactivate a whole account that is behind on its
subscription. `vpaIsExtrasInvoice` (`:4026`) exists and is used on the *failure* path to
stop a $2 decline suspending a venue, but the reactivation path does not use it.

**Correct, wrong, or unknown.** **Unknown without testing** — an extras invoice on a
suspended venue is unlikely because the kill-switch stops sessions opening, but a session
opened before the suspension and closed after would do it (`handleSessionClose:5560` calls
`chargeNightOverage` with no status check, and `venueCanBeCharged:5917` checks only for
`comp` and the presence of Stripe ids, not venue status).

**Blast radius.** Money, small, and it undermines the suspension. Silent.

**How to break-test it.** Suspend a test account for non-payment, then settle a $2 extras
invoice on the same customer and check whether the venues come back to `active`.

---

## 17. A nonpayment suspension sweeps in venues that had already left

**What happens today.** `vpaSuspendForNonpayment` (`:3864`) and `vpaReactivateOnPayment`
(`:3892`) both operate on every venue under the customer's `founding_id`, with the only
filter being the current status/reason. The suspend loop skips anything already
suspended, so an 'ended' venue is left alone — that part is right.

The gap is the reverse: a venue suspended by `vpbApplyPendingOnInvoice` carries a **null**
reason (see #10). It is not `nonpayment`, so it is correctly not reactivated. But nothing
distinguishes it from a venue we suspended by hand, and HQ's filters and
`isArchivedVenue` both key off that column.

**Correct, wrong, or unknown.** The money behaviour is correct. The data is wrong: one
lifecycle end-state has no label.

**Blast radius.** Silent. It is a reporting and support problem, and it is what makes #10
show the wrong message.

**How to break-test it.** After a partial cancellation rolls, `select id, status,
suspended_reason from vp_venues where status='suspended'` and look for the null.

---

## 18. Provisioning finds the venue by `founding_id`, so a returning venue can never resume its old row

**What happens today.** `vpaProvisionFromCheckout` (`:2477`) looks for an existing venue
with `founding_id=eq.<new founding row>` (`:2535`). A returning venue's checkout always
creates a fresh `venueplay_founding` row (`sbInsert`, `:301`), so that lookup can never
match their old venue. The auth user, by contrast, **is** reused —
`vpaAuthCreateUser` throws `alreadyExists` and `vpaFindAuthUser` returns the original id
(`:2519-2528`) — which is exactly what produces the two-account login in #1.

**Correct, wrong, or unknown.** Correct as written (matching on `founding_id` is the only
safe key at that point), but it is the mechanism that makes "come back six months later"
produce a duplicate rather than a resumption. There is no code anywhere that looks for a
returning venue's previous venue row and offers to reattach it.

**Blast radius.** Compounds #1, #7, #10 and #5. On its own, silent.

**How to break-test it.** Run a second checkout with the same email and mobile as an ended
account and diff `vp_venues` before and after: expect a second row with a
postcode-suffixed slug and a second staff row for the same `auth_user_id`.

---

# Suggested break-test order

Cheapest first, and each one proves something the one above it depends on.

1. **`select role, count(*) from vp_venue_staff group by role`** — if `owner` is zero,
   #6 is confirmed by one query.
2. **One mobile, two accounts** (#1, #13, #9). This is the highest-value single fixture
   in the list and it exercises four findings.
3. **Cancel one venue on a two-venue account, roll the renewal** (#3, #10, #11, #14, #17).
4. **Cancel to completion, then try to come back** (#5, #7, #12, #18).
5. **Annual account, cancel, then three big nights** (#2) — the most expensive to set up
   and the most expensive to get wrong.

# One structural note

Almost every finding above is the same shape: **two writers of one lifecycle, and only one
of them knows the whole story.** `status` and `cancel_at_period_end` are maintained by
different functions. The free month is decided in two Workers off two different columns.
"Which account am I" is answered four ways. "Who is an owner" is answered by `perms` in
the Workers, by `perms` in `settings.html`, and by `role='owner'` in migration 77 — and the
third one can never be true.

A single `vp_venue_lifecycle` state machine (or even just a rule that `status`,
`suspended_reason` and `cancel_at_period_end` are only ever written by one function) would
remove #3, #4, #10, #11 and #17 outright.
