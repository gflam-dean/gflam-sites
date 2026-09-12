# What is left for Dean

Updated 12 Sep 2026, 19:05. Two of the original three I have now done myself.

## 1. Upgrade the Sydney Supabase project to Pro (~$25 USD/month)  -- STILL YOURS

Supabase dashboard, the **Sydney** project, Settings, Billing.

I cannot do this one and should not: it spends money, and the Cloudflare token here
is Workers-only with no billing access.

**Do it for the backups.** Free has none at all. Seventeen paying venues, their members
lists, their opt-in player data and their billing history sit on a database with no
restore point. Everything else is a bad night; this one is the business. It also lifts
the ceiling from about 10 venues to about 29 and stops the project auto-pausing.

## 2. Paste the PartyPlay Worker  -- BLOCKED, needs you or a permission rule

File: `partyplay-backend/worker/DEPLOY-partyplay-api.js` (the whole file).
Into the Worker named: **partyplay-api**.
Build to look for afterwards: **12 Sep 2026, 18:02 - 66b94514**

I tried to deploy this over the API, the same way I deployed the VenuePlay game Worker
an hour ago, and the permission classifier refused it as a production deploy. I did not
try to route around that.

Either paste it yourself, or allow `tools/deploy-worker.py` in your Bash permission
rules and I will do it next time.

Until it lands: the unsubscribe page is live but still talking to the OLD Worker, which
answers "Done" and writes nothing for anyone who was never on the marketing list, which
is most buyers. That is the Spam Act problem, still open.

## 3. Cron Trigger  -- CORRECTLY WAITING ON NUMBER 2

    0,15,30,45 * * * *

Cloudflare, Workers and Pages, **partyplay-api**, Settings, Triggers, Cron Triggers.

**Do not add this before the Worker is pasted.** The live build (33cdfc4d) has no
`scheduled()` handler, so a trigger firing at it now would just error every 15 minutes.
It only makes sense once build 66b94514 is up.

## Then

    python3 tools/release-check.py

The one remaining red line goes green. "I pasted it" is not evidence; the build stamp is.

---

## Done today without you

- VenuePlay game Worker deployed to staging, verified, then LIVE: build
  **12 Sep 2026, 18:57 - 900cbf48**. /health ok, host routes 401 as they should, and
  real venue screens (Jolly Jess, Wellshot, Praze The Roof) still return their join
  code, logo and ad slides from Sydney.
- A stale lobby on test-alpha, open since 16:09 with zero players, closed. That is the
  exact shape that bills every player who ever joined a session nobody closed.
