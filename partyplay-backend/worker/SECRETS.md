# PartyPlay Worker secrets

Set these in the Cloudflare dashboard under the Worker's
**Settings > Variables and Secrets**, as **Secret** (encrypted), not Text.

**Never put a value in this file, in the Worker source, or anywhere in the repo.**
The repo auto-deploys, so a key committed here is a key published to the internet.

| Name | Where it comes from | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe > Developers > API keys | `sk_test_...` now, `sk_live_...` at launch |
| `STRIPE_WEBHOOK_SECRET` | Stripe > Developers > Webhooks > your endpoint | `whsec_...`. NOT from the API keys page, it is per endpoint |
| `STRIPE_PRICE_1DAY` | Stripe > Products > PartyPlay One Day | `price_1U8GIB4dQY1PPBAyW60lnkYX` **(LIVE)** |
| `STRIPE_PRICE_3DAY` | Stripe > Products > PartyPlay Three Days | `price_1U8GHj4dQY1PPBAyZPvwjXTv` **(LIVE)** |
| `SUPABASE_URL` | Supabase > Project Settings > API | Same project as VenuePlay |
| `SUPABASE_SERVICE_KEY` | Supabase > Project Settings > API | The **service_role** key. Never the anon key |
| `RESEND_API_KEY` | Resend > API Keys | `re_...` |
| `SITE_ORIGIN` | n/a | `https://partyplay.com.au`. Plain Text is fine for this one |
| `ADMIN_KEY` | make one up, 32+ random characters | Guards `/admin/comp` and `/admin/followups`. Anyone holding it can issue free licences |
| `FOLLOWUP_PROMO_CODE` | Stripe > Products > Coupons > promotion code | Optional. Defaults to `AGAIN10`. Plain Text |

## The Cron Trigger (this is not a secret, but it is on the same screen)

The Worker has four scheduled jobs in it: album links, the photo sweep that keeps
the 30 day deletion promise on privacy.html and terms.html, the follow up email
and the reminder about an unused code. **None of them happens until a Cron
Trigger is added**, because a Worker with no trigger only ever runs when somebody
asks it for a page.

    Cloudflare dashboard > Workers & Pages > partyplay-api > Settings
      > Triggers > Cron Triggers > Add Cron Trigger

    Type exactly:   0,15,30,45 * * * *

That is every fifteen minutes. Every job is idempotent and each one is a single
database query when there is nothing to do, so there is nothing to tune and only
one line to get wrong. The two jobs that email somebody who is not waiting for it
keep daytime hours on their own, between 9am and 8pm Brisbane time.

The buttons on /admin still work and still run the same code, for when you want
one of them to happen right now.

## THESE ARE LIVE, NOT TEST

Verified 26 Aug 2026: a checkout call returned a `cs_live_` session, which only a
live secret key can produce. So the Worker is holding `sk_live_` and the two
price IDs above are live prices.

**That means partyplay.com.au can take a real payment from a real card right
now.** Nothing is stopping a stranger who finds the site from being charged $50.

That is fine if it is deliberate. If you wanted to test first, swap the secret
key and both price IDs to their test-mode equivalents together: a test price with
a live key, or the reverse, fails at checkout with an unhelpful error.

Test card once you are in test mode: 4242 4242 4242 4242, any future expiry.

## The publishable key

`pk_test_...` / `pk_live_...` is designed to be public and can sit in the page
source. The Worker does not need it at all: it creates the Checkout Session
server-side and returns a URL, so the browser never talks to Stripe directly.

## If a secret key is ever exposed

Rotate it. Stripe > Developers > API keys > roll the key. It takes ten seconds and
invalidates the old one. Do it any time a key has been pasted into a chat, an email,
a screenshot or a support ticket, even a test key, because the habit is what protects
the live one later.

## PartyPlay has its OWN Stripe account

Not the VenuePlay one. Different dashboard, different secret key, different
webhook secret, different price IDs. Before copying anything out of Stripe,
check the account switcher at the top left, and check the Test/Live toggle at
the top right.

Copying VenuePlay's webhook secret in here is the failure that costs the most
time: every webhook then fails its signature check, so customers pay and never
receive a code, and nothing says why in plain words.

## The Worker address

Name the Worker exactly **`partyplay-api`**. Your workers.dev subdomain is
**`dean-tindale`**, so it will answer on:

    https://partyplay-api.dean-tindale.workers.dev

That subdomain is per Cloudflare **account**, not per project, which is why both
VenuePlay Workers use it too.

## Two addresses (31 Oct 2026)

| Address | Used by | How |
|---|---|---|
| `api.partyplay.com.au` | the site (`lib/pp-config.js`) and the List-Unsubscribe header in every email | Worker > Settings > Domains & Routes > Custom domain (added by Dean 31 Oct 2026) |
| `partyplay-api.dean-tindale.workers.dev` | anything cached or already emailed before 31 Oct, any webhook set up with it, the deploy tool's /health proof | free with every Worker; never remove it |

Dean's rule, 31 Oct 2026: no .dev address in anything a customer sees. Both names
are the same Worker, so nothing else differs between them.
