# The venueplay TEST database (INBOX 326)

The old Supabase project **"Gflam", ref `gpoolavkghnxedzrmtmc` (Singapore)** becomes the venueplay
TEST database. **LIVE is `ijkzgmdtwtgfkedqspxm` (Sydney) and nothing in this folder ever writes to it.**
The full plan, costs and hours: `~/venue-enrich/reports/staging-plan-12nov/index.html`.

Nothing here has been run. Every script was written for main to read first.

## The files

| File | Touches | What |
|---|---|---|
| `01-mark-this-as-test.sql` | TEST, writes | Puts the TEST marker (`vp_staging.vp_staging_marker`, old ref only) on the old project. Needs a person's name typed in. Refuses a database with real sign-ins since 1 Oct 2026. |
| `guard.sql` | nothing | The TEST lock, kept once. The wipe, the seed and every file `build-test-schema.sh` writes start with this exact block (the test checks they are identical). |
| `wipe-test-db.sql` | TEST, **destroys** | Removes all of `public` (every Sep 2026 venue, player, members list, sign-up), all auth users, pg_cron jobs, Vault secrets. Keeps the marker. Refuses while Storage has files. One transaction. |
| `schema-snapshot.sql` | LIVE or TEST, read only | Prints one JSON line describing the database's shape (no rows). |
| `live-extras.sql` | LIVE, read only | Prints SQL for extensions, the realtime publication, storage buckets and storage policies (what a public-schema dump leaves out). |
| `build-test-schema.sh` | nothing (writes a file) | Turns a schema-only dump of live into a TEST-only SQL file with the lock first. `--migrations --from N` joins new migrations in order. |
| `seed-test-data.sql` | TEST, writes | 6 test venues (Alpha, Bravo, Charlie, Mini Bar (test), Echo, Foxtrot), a group of 3, a test host and manager on 0491 570 001/002, 85 fake members, 80 fake players. All `@example.invalid`. |
| `content-tables.txt` | nothing | The only tables ever copied from live: trivia and music libraries, help desk articles, saved replies, the news, the licensed-venue register. No people. |
| `copy-content-from-live.sh` | LIVE read only, TEST writes | Copies the content tables. Live sessions forced read-only; refuses unless the URLs name the right projects. |
| `check-schema-matches-live.py` | nothing (reads files) | Compares a live snapshot and a test snapshot (or the repo's RLS and columns baselines). MATCH = exit 0. |
| `check-schema-matches-live.test.py` | nothing | 78 offline checks, network switched off. `python3 tools/staging/check-schema-matches-live.test.py` |

## Addresses (main sets these once in `~/.gflam-migrate.env`, never in the repo)

    TEST_DB_URL=        the old project's database address (Settings, Database)
    TEST_SUPABASE_URL=  https://gpoolavkghnxedzrmtmc.supabase.co
    TEST_SERVICE_KEY=   the old project's service key (AFTER the key rotation in step 1)
    TEST_ANON_KEY=      the old project's public key (AFTER the rotation)
    LIVE_DB_URL=        the same value as NEW_DB_URL (live), used ONLY for read-only dumps

Load just the two you need into the shell, without printing them:

    export TEST_DB_URL="$(grep '^TEST_DB_URL=' ~/.gflam-migrate.env | cut -d= -f2-)"
    export LIVE_DB_URL="$(grep '^NEW_DB_URL=' ~/.gflam-migrate.env | cut -d= -f2-)"

## The order, and who does each step

| # | Who | Where | Step |
|---|---|---|---|
| 0 | main | | Answer the questions at the end of the plan page. Nothing runs before that. |
| 1 | Dean (main reads the screen with him) | Supabase dashboard, **Gflam (Singapore)** project | Settings, Infrastructure: note the Postgres version (must be the same major version as live, else upgrade the old one first). Settings, API: rotate the keys (old copies of the old keys stop working). Authentication: Site URL = the staging site; Send SMS hook OFF; custom SMTP OFF; Phone provider "Test phone numbers": `61491570001`, `61491570002` with a code main picks; email sign-ups off. Edge Functions: delete any. Database, Webhooks: delete any. |
| 2 | Dean decides, main does | dashboard, Storage | Old logo and photo FILES are not in the 12 Nov backup. Download them if Dean wants them kept, then "Empty bucket" on each bucket. |
| 3 | main | SQL Editor, Gflam (Singapore) | `01-mark-this-as-test.sql` with their name in place of CHANGE-ME. Address bar must show `gpoolavkghnxedzrmtmc`. |
| 4 | main | SQL Editor or psql, TEST | `wipe-test-db.sql`. Ends "WIPE DONE". |
| 5 | main | terminal, LIVE **read only** | The three read-only reads below. |
| 6 | main | terminal | `bash tools/staging/build-test-schema.sh --from-dump ~/.gflam-migrate/live-schema.sql --extras ~/.gflam-migrate/live-extras-out.sql`, then `psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f ~/.gflam-migrate/test-schema-dump.sql` |
| 7 | main | dashboard, TEST, Authentication, Users | Add user `test-admin@example.invalid`, a password from the password manager, auto-confirm. |
| 8 | main | psql, TEST | `seed-test-data.sql`. Ends "SEED DONE". If a column rule refuses a value, fix the value and run again (all or nothing). |
| 9 | main | terminal | `bash tools/staging/copy-content-from-live.sh` |
| 10 | main | terminal | The match check below. Must say MATCH. |

### Step 5: the read-only reads of live

    PGOPTIONS='-c default_transaction_read_only=on' pg_dump "$LIVE_DB_URL" --schema-only --schema=public \
      --no-owner --quote-all-identifiers -f ~/.gflam-migrate/live-schema.sql
    PGOPTIONS='-c default_transaction_read_only=on' psql "$LIVE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -f tools/staging/live-extras.sql > ~/.gflam-migrate/live-extras-out.sql
    PGOPTIONS='-c default_transaction_read_only=on' psql "$LIVE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -f tools/staging/schema-snapshot.sql > ~/.gflam-migrate/live-snapshot.json
    python3 venueplay-backend/tools/dump-rls-baseline.py --check      (existing tool, read only: baselines current?)

`pg_dump` must be the same major version as live's Postgres or newer (Postgres.app or `brew install libpq`).

### Step 10, and before EVERY release: does TEST match live?

    PGOPTIONS='-c default_transaction_read_only=on' psql "$TEST_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -f tools/staging/schema-snapshot.sql > ~/.gflam-migrate/test-snapshot.json
    python3 tools/staging/check-schema-matches-live.py --live ~/.gflam-migrate/live-snapshot.json \
      --test ~/.gflam-migrate/test-snapshot.json
    # quick form, no live read at all (locks + column names only):
    python3 tools/staging/check-schema-matches-live.py --live-baselines \
      venueplay-backend/supabase/RLS-BASELINE.json venueplay-backend/supabase/COLUMNS-BASELINE.json \
      --test ~/.gflam-migrate/test-snapshot.json

Not in the release gate yet. When it becomes a gate label, every part already has a break-on-purpose
case in the test (0 BLIND), so the prove rows can point at them.

## The migration route from now on

1. A new migration is written as today (`venueplay-backend/supabase/venueplay-NNN-*.sql`).
2. main runs it on **TEST first**: `psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f <the file>` (or in
   the SQL Editor of the Gflam (Singapore) project). Several at once: `build-test-schema.sh --migrations --from NNN`.
3. The release's suites and the real-night test run on staging, against TEST.
4. Only then Dean runs the same file on live (as today: early, read back by main).
5. Next release, the match check proves live and TEST still agree. A difference means something was run
   on one and not the other: find out which before anything else.

## Wiping TEST again later

Re-run steps 4, 6, 8, 9, 10 (the marker stays). Storage must be emptied again first.

## Added 13 Nov 2026 (INBOX 357B): the code side of staging

Branch `feature/staging-build-13nov`. Nothing here connects to a database, deploys, sends or installs; every part has an
offline test (`jsc tools/test-outbox-guard.js`, `jsc tools/test-vp-env.js`, and the `*.test.py` files in this folder).

| Part | Where | What it does |
|---|---|---|
| Outbox guard | `venueplay-backend/worker/vp-outbox-guard.js` (source), the same block inside `venueplay-api-FULL.js`, `venueplay-game.js`, `venueplay-sms-hook.js` | With `VP_ENV=staging` nothing real is sent: email, texts, push, the SMS hook and any write to a live venueplay address are answered "sent" and kept in an in-memory outbox; Stripe only with a test key; the Worker answers 503 and does not run if a live Stripe key, the live database address or a real-looking send key is set (staging send keys must start `staging-`). On live it only holds back a message addressed purely to `+61 491 57x xxx` or `@example.invalid`. All settings are in the `VPG` table at the top of the block. |
| Site, pointing at staging | `venueplay/app/vp-env.js` + `make-staging-site.py` | `vp-env.js` holds the LIVE and STAGING addresses in one place and, on a staging host only, refuses any request that still names a live address (fetch, XHR, WebSocket, beacon). `make-staging-site.py OUT` copies `venueplay/` swapping the live addresses for the staging ones and tags every page. Refuses while the public key is still the placeholder. Live pages do not load `vp-env.js`: nothing on live changes. |
| Worker settings | `staging-config.json` | Names and shapes only, no secret: the two staging Workers, their plain variables, which values come from the key file (`TEST_` names), dummy send keys, what is never set, fresh random salts, the access-lock hostnames. A test keeps it in agreement with `vp-env.js`, the guard, the seed and `deploy-worker.py`. |
| TV test app | `make-tv-test-build.py` | Reads `~/venueplay-tv-apps` read-only and writes a separate "venueplay TV (test)" app (own Samsung package `VnPlyTest1`, own LG id) pointed at staging. Not signed, not installed, never for a store. |
| Gate line | `check-schema-gate.py`, line D201 in `release-check.py` | OFF (and says so) until `tools/staging/STAGING-ON` is committed; then the test snapshot must be under 24 h old and match. |

### What main does with it (after the database steps above)

1. **Public key.** After the key rotation put the TEST project's public (publishable) key in the STAGING block of `venueplay/app/vp-env.js` (replacing `TEST_ANON_KEY_NOT_SET_YET`). It is safe in a page, like the live one.
2. **Staging Workers** (Cloudflare, `venueplay-api-staging`, `venueplay-game-staging`): variables and secrets exactly as listed in `staging-config.json`. `VP_ENV=staging` first. `RESEND_API_KEY` etc. get the placeholder `staging-dummy`; the SMS hook, autopilot and push keys are not set. Deploy with `python3 tools/deploy-worker.py venueplay-api-staging venueplay-backend/worker/venueplay-api-FULL.js` (and the game one with `--do-class=VenueRoom`, plus the `RL` KV binding). `deploy-worker.py` treats them as staging, not LIVE. Prove each by `/health`.
3. **Staging site.** `python3 tools/staging/make-staging-site.py /tmp/staging-site`, commit that folder's contents on a branch `staging` of the site repo, and point the Pages preview at it; custom domain `staging.venueplay.com.au`.
4. **Access lock.** Cloudflare Zero Trust over the three hostnames; the office address and the Kogan's address let through without a login.
5. **TV test app.** `python3 tools/staging/make-tv-test-build.py --tv-apps ~/venueplay-tv-apps --out ~/venue-enrich/reports/tv-test-build`, sign with Dean's "venueplay" certificate profile, sideload to the Kogan (commands are printed).
6. **Turn the gate line on.** When the match check first says MATCH: `touch tools/staging/STAGING-ON`, commit it. From then every release needs a fresh `test-snapshot.json` (README, "before EVERY release").
7. **Test phone numbers** in Supabase (Auth, Phone, Test phone numbers) are `61491570001` and `61491570002` (the seed's host and manager).
