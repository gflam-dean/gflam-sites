# Three jobs only Dean can do

As at 12 Sep 2026, 18:10. Everything else on these is finished and pushed.

## 1. Upgrade the Sydney Supabase project to Pro (~$25 USD/month)

Supabase dashboard, the **Sydney** project, Settings, Billing.

**Do this one first, and not for the speed.** Free has no backups at all. Seventeen paying
venues, their members lists, their opt-in player data and their billing history sit on a
database with no restore point. Everything else on this page is a bad night; this one is
the business.

It also takes the ceiling from about 10 venues to about 29, and stops the project
auto-pausing after a quiet week.

## 2. Paste the PartyPlay Worker

File: `partyplay-backend/worker/DEPLOY-partyplay-api.js` (the whole file).
Into the Worker named: **partyplay-api**.
Build to look for afterwards: **12 Sep 2026, 18:02 - 66b94514**

Until this lands, the unsubscribe page is live but still talking to the OLD Worker, which
writes nothing. A person who presses Unsubscribe is told "Done" and keeps getting email.
That is the Spam Act problem, still open until this paste.

## 3. Add the Cron Trigger

Cloudflare, Workers and Pages, **partyplay-api**, Settings, Triggers, Cron Triggers,
Add Cron Trigger:

    0,15,30,45 * * * *

Nothing runs on a schedule until this button is pressed, including the photo sweep that
keeps the "deleted 30 days after the party" promise on privacy.html and terms.html.

## Then

    python3 tools/release-check.py

The one remaining red line should go green. "I pasted it" is not evidence; the build stamp is.
