# Making the two Workers deploy from git, like the website does

Do this once. After that, pushing to `main` updates the website **and** both
Workers, and the "paste the FULL file, not the stub" trap goes away for good.

Not urgent. Nothing is broken while it stays manual.

---

## Why there are two careful steps rather than just connecting it

A git deploy replaces a Worker's whole configuration with whatever the config
file says. Two things behave differently:

- **Encrypted variables (secrets) survive a deploy.** They are stored separately
  and a deploy does not touch them.
- **Plain-text variables and bindings do not.** If they are not written into
  `wrangler.toml`, the deploy removes them.

Two of those would fail *silently*, which is the dangerous part:

- Lose the `RL` KV binding and every rate limit in the game Worker degrades to
  allow-everything. Nothing errors. Nothing tells you.
- Lose `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` and an unrecognised price
  falls back to founding rates, so standard venues are billed $2.50 instead of
  $3.00.

So: encrypt the variables first, capture the KV id, then connect.

---

## Step 1: encrypt every variable, on BOTH Workers

Cloudflare dashboard → Workers & Pages → **venueplay-game** → Settings →
Variables and Secrets.

Any variable showing its value in plain text: click **Encrypt**. Repeat until
none show a value.

Then do exactly the same on **venueplay-api**.

Between them these Workers read 24 settings, including your Stripe secret key,
the Supabase service key and the SMS login credentials. Encrypting them is worth
doing on its own merits, deploy or no deploy.

## Step 2: get the KV namespace id

Cloudflare dashboard → **Storage & Databases** → **KV**.

Find the namespace the game Worker uses for `RL` (check under venueplay-game →
Settings → Bindings if you are not sure which). Copy its **ID**, a long string of
letters and numbers.

Paste it into `deploy-game/wrangler.toml`, replacing
`PASTE_THE_RL_KV_NAMESPACE_ID_HERE`, then commit and push.

## Step 3: connect each Worker to the repo

Cloudflare dashboard → Workers & Pages → **venueplay-game** → Settings → **Builds**
→ Connect to Git.

- Repository: `gflam-dean/gflam-sites`
- Branch: `main`
- **Root directory:** `venueplay-backend/worker/deploy-game`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`

Then the same for **venueplay-api**, with root directory
`venueplay-backend/worker/deploy-api`.

## Step 4: prove it worked before trusting it

Make a harmless change (add a blank line to a comment in the Worker), push, wait
for the build, then:

    python3 venueplay-backend/tools/check-live.py

Both "running the current code" checks should still pass. Then check the game
Worker still has its `RL` binding under Settings → Bindings. If the binding is
gone, the id in `wrangler.toml` is wrong: fix it and push again.

Do the game Worker first and confirm it, before connecting the billing one. The
billing Worker is the one that moves money.
