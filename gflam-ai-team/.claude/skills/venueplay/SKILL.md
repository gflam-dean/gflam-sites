---
name: venueplay
description: Everything VenuePlay — Dean's SaaS platform for pubs/clubs to run bingo, trivia, musical bingo and raffles. Use whenever VenuePlay, venueplay.com.au, founding venues, the 100-spot counter, per-player pricing, the VenuePlay Worker, or VenuePlay Stripe comes up. Trigger for "the founding page", "the venue counter", "the checkout", or edits to index/terms/privacy on VenuePlay. Read before touching any VenuePlay file, copy, or config.
---

# VenuePlay

SaaS for pubs, clubs, bowls clubs, RSLs: bingo, trivia, musical bingo, raffles/members draws on one platform. Players join by phone (no app, no login); the game displays on any venue screen. **Launches August 2026.** Built by Gflam Touring.

## Brand

- Stage black `#0A0A0B`, neon pink `#FF1F8E` (deep `#C70F69`), white wordmark.
- Logo: unboxed glowing pink play triangle, thin divider, "VenuePlay" in **Hanken Grotesk ExtraBold**. Inline SVG on pages (never re-fetch PNGs from Drive — corruption incident).
- Type: Anton (uppercase display), Manrope (body), Hanken Grotesk (wordmark/card titles), JetBrains Mono (labels/data/prices).
- Copy voice: venue-facing, plain Australian, benefit-led. Hero: "Run a packed Tuesday. Every Tuesday." Positioning: "One pub, one platform." Modes header: "Four formats. One screen."

## Hard copy rules

- **Never "drag"** in VenuePlay copy: "who run bingo, live music and entertainment across Australia."
- **No em dashes** in site copy.
- Pricing labelled **per player** with "Max players / session" (never "seats" in UI copy).
- Screen wording: "plays on the screen you've already got" (TV/projector/streaming stick) — never lead with "HDMI" or promise "no extra gear".
- Printed cards: "**print your own** cards straight from the platform" — VenuePlay does NOT supply physical cards.
- Overage promise (committed to founding venues): extra players beyond plan max are billed at the same per-player monthly rate; the screen flags it live; no surprise fees. Automatic metering is a post-launch build — don't claim it exists in-app yet.

## Founding offer (the deal — locked)

- First 100 venues: 20% off for life. Monthly **$2.40/player**, annual **$2/player** ($24/yr per player). Standard at launch: $3/player. GST-inclusive.
- **First month free: launch August, first charge 1 September 2026.** Cancel before first charge = never charged. No lock-in.
- Counter counts committed venues only (`venueplay_spots_taken` RPC = status card_on_file/active).
- Consent boxes on the form: marketing box pre-ticked (Dean's call; flagged Spam Act risk once — decision made, don't re-litigate); Terms/Privacy box unticked and REQUIRED.
- Player marketing opt-in in the future game app must be UNTICKED by default (players are strangers — Spam Act).

## Site files

`index.html` (hero, 4 modes, founding offer + live counter, included list, Stripe signup form with plan toggle + live estimate, 12 FAQs, contact form, hidden venue wall, footer with /terms /privacy), `terms.html`, `privacy.html` (branded; placeholders [DATE]/[LEGAL ENTITY NAME]/[ABN] to fill; lawyer review pending).
Page config at the bottom of index.html: `VP_WORKER = 'https://venueplay-api.dean-tindale.workers.dev'`, `_SBK` anon key.

## Cloudflare Worker (`venueplay-api`, deployed at dean-tindale.workers.dev)

Routes: `POST /checkout` (writes pending row → Stripe Checkout session, subscription mode, `trial_end` = LAUNCH_TS, `payment_method_collection: always`, quantity = max players, returns {url}) · `POST /webhook` (verifies signature; on `checkout.session.completed` marks row card_on_file + stores stripe ids) · `POST /contact` (Resend email to dean@/hello@venueplay.com.au).
Env vars: `STRIPE_SECRET_KEY`🔒, `STRIPE_WEBHOOK_SECRET`🔒, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `RESEND_API_KEY`🔒 (optional until Resend set up), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`🔒, `SITE_URL`, `LAUNCH_TS` = **1788184800** (1 Sep 2026 00:00 Brisbane).
Success/cancel return: `SITE_URL/?vp=success|cancel` (page handles both).

## Stripe — CRITICAL account note

VenuePlay is **its own Stripe account** (split from Gflam Group). Any `price_…`/`prod_…`/keys created under Gflam Group are DEAD for VenuePlay — recreate in the VenuePlay account. Old IDs to ignore: price_1TgPddGASCz0KwspKeAKgc0W / price_1TgPhfGASCz0KwspW09vtM7F (wrong account).
Needed in the VenuePlay account (TEST mode first): Product "Founding Membership Monthly" $2.40 recurring monthly, unit label `player`; "Founding Membership Annual" $24 recurring yearly, unit label `player`; webhook → Worker `/webhook` for `checkout.session.completed`. Test card 4242 4242 4242 4242.
Trial mechanics: everyone charges automatically on LAUNCH_TS (absolute date, whole cohort same day). Nothing to run in September; just watch declines (Stripe auto-retries).

## Supabase

Table `venueplay_founding` + RPCs — see `gflam-supabase` skill. RLS locked; Worker writes with service_role; browser reads only via the two RPCs.

## Launch venue wall

Per venue: upload logo to Supabase Storage → set `logo_url` + `show_on_wall = true`. The wall section on index.html auto-appears once any row qualifies.

## Roadmap (agreed, not built)

Game app (play/host/screen MVP exists from earlier session, 75-ball logic, Supabase Realtime) · player opt-in capture with per-venue lists, monthly CSV export, venue privacy-terms tick before export, platform-enforced unsubscribe + collection notice · metered overage billing · printed-card generation · standard pricing page ($3 monthly / $2.25 annual / per-event tier) · possible charge-bank merch.
