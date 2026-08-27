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
VenuePlay Workers use it too. The site has this address baked into
`lib/pp-config.js`, so a different Worker name means editing that file.

## Two addresses, on purpose

The Worker needs to answer on both:

| Address | Used by | How |
|---|---|---|
| `api.partyplay.com.au` | the live site | Worker > Settings > Domains & Routes > Add Custom domain |
| `partyplay-api.dean-tindale.workers.dev` | pages.dev previews, local testing | free with every Worker |

`lib/pp-config.js` picks between them from the hostname, so a preview build can
never quietly take a real payment. **If you only set up one, checkout works in
one place and fails in the other**, and it will be the live site that fails.
