# There is no wrangler.toml here on purpose

Removed 10 Sep 2026, for the same reason as the game Worker's. See
../deploy-game/README.md.

`wrangler deploy` replaces a Worker's bindings with whatever the config declares.
The file that used to be here declared NONE. The live billing Worker has twenty,
including the Stripe price ids, the Stripe webhook secret, the SMS credentials, the
Resend key and SITE_URL. A deploy from this folder would have removed every
plain-text one of them: no checkout, no sign-up SMS, no emails.

## Deploy this way instead

    python3 tools/deploy-worker.py --live venueplay-api venueplay-backend/worker/venueplay-api-FULL.js

It keeps existing bindings, refuses the stub file, refuses the wrong slot, and
proves the deploy through /health afterwards.
