# There is no wrangler.toml here on purpose

It was removed on 10 Sep 2026 because it was a loaded trap.

`wrangler deploy` REPLACES a Worker's bindings with whatever the config declares.
Anything not declared is removed. The file that used to sit here declared exactly
one binding, with the placeholder text PASTE_THE_RL_KV_NAMESPACE_ID_HERE where the
real id belongs. The live Worker has seven:

    IP_HASH_SALT          plain_text
    RL                    kv_namespace
    ROOM                  durable_object_namespace     the room server
    STRIPE_SECRET_KEY     secret_text
    SUPABASE_JWT_SECRET   secret_text
    SUPABASE_SERVICE_KEY  secret_text
    SUPABASE_URL          plain_text

So one deploy from this folder would have taken the room server away, pointed the
rate limiter at a namespace that does not exist, and removed SUPABASE_URL: the
Worker would no longer know where the database is. Every venue, at once, with no
error to explain it.

## Deploy this way instead

    python3 tools/deploy-worker.py --live venueplay-game venueplay-backend/worker/venueplay-game.js

That tool exists because of this exact class of accident. It refuses a file whose
BUILD stamp does not match its contents, refuses the wrong file for a slot by name,
KEEPS every existing binding rather than declaring them, checks afterwards that
none were lost, and waits for /health to answer with the build it just sent.
"I deployed it" is not evidence; /health answering is.

If Workers Builds is ever connected to this repo, this file being absent makes the
build fail, which is the safe outcome. Do not put a wrangler.toml back without
declaring all seven bindings and checking them against the live Worker first.
