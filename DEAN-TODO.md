# Morning list

Updated overnight, 12 Sep 2026. Two of the original three are done. Read the first two
sections, the rest is background.

## 1. Upgrade the Sydney Supabase project to Pro (~$25 USD/month)  -- ONLY YOU CAN

Supabase dashboard, the **Sydney** project, Settings, Billing.

I cannot and should not: it spends money, and the Cloudflare token here is Workers-only.

**Do it for the backups.** Free has none. Seventeen paying venues, their members lists,
their opt-in player data and their billing history sit on a database with no restore point.
Everything else is a bad night. This one is the business. It also lifts the ceiling from
about 10 venues to about 29 and stops the project auto-pausing.

## 2. Paste the PartyPlay Worker  -- BLOCKED FOR ME, one minute for you

File: `partyplay-backend/worker/DEPLOY-partyplay-api.js` (the whole file).
Into the Worker named: **partyplay-api**.

**The build stamp moved several times overnight.** Do not look for an old one. Run this
and paste whatever it prints:

    grep -m1 "BUILD" partyplay-backend/worker/DEPLOY-partyplay-api.js

I tried to deploy it over the API, the same way I deployed the VenuePlay game Worker
yesterday, and the permission classifier refused it as a production deploy. I did not try
to route around that. If you want me to do it next time, allow `tools/deploy-worker.py` in
your Bash permission rules.

What is waiting in it: the unsubscribe that actually records an opt-out, the privacy sweep
that deletes guests' emails and nicknames 30 days after a party, the player-cap message that
no longer breaks if you change the cap, the game ordering tiebreak, and the expiry constant
fix.

## 3. Cron Trigger  -- ONLY AFTER 2

    0,15,30,45 * * * *

Cloudflare, Workers and Pages, **partyplay-api**, Settings, Triggers, Cron Triggers.

**Do not add it before the paste.** The live build has no `scheduled()` handler, so a trigger
now just errors every fifteen minutes.

## Then

    python3 tools/release-check.py

---

# What happened overnight

## PartyPlay could not reach its own database. At all.

`pp-config.js` paired **Sydney's URL with Singapore's publishable key**. The migration
updated VenuePlay's key and missed this one, so Supabase answered every browser request 401.
That is the whole product: host console, television and every guest phone share one realtime
channel. A host pressing a button reached nobody.

It was invisible because the Worker uses the service key from its own environment, so
`/health` said ok, licences were created, emails went out, and the gate was green. And
`play.html` printed "You are in. Watch the big screen." before it ever tried to connect, then
swallowed the failure.

Fixed, and **proved**: two clients on one channel from the live site, the phone received the
host's message. I then ran a real party end to end. Host to telly to phone, bingo ticket
auto-marking, "5 to go for a line".

The gate now asks Supabase directly, per product, every run.

## Other things found by running it rather than reading it

- The host console and the **television** showed the database's word for each game:
  "headstails", "truths", "draw". Names now live in one place and both pages ask.
- A host who **reloaded** the console mid-party lost the whole room: "0 playing" in a full
  house, and charades could not be started at all. The console now asks who is there.
- The privacy page promises three deletions after a party and only one happened. Guest
  **email addresses** were never deleted. Now swept on the same 30 day clock.
- partyplay.com.au had a 4 hour browser cache TTL at the zone, overriding its own headers,
  so a config fix could sit unreachable in a guest's phone. Set to respect headers.

## Three reviewers played the games overnight

I gave three of them a disposable party each and asked them to play like guests, not
developers: does it work, does it make sense after two drinks, does it look good on a
television, does it end properly. Their findings will be waiting for you.

## Test data to delete when you are happy

Four disposable licences, all named `CLAUDE TEST`:

    FKGSAJ  C6VPDA  9QAXSP  YPC6TT

    delete from pp_licences where buyer_name like 'CLAUDE TEST%';

They cost nothing and are marked comp, but they are not real parties.
