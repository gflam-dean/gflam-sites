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

## Added 16 Nov 2026: venues that look like real pubs, played like a real night

Dean, 16 Nov: "on the test server you do maybe 2-3 different venues with logos etc", then "maybe two venues and then
sign up a new one". On 15 Nov live faults (a doubled logo, the buzzer) could not be seen on staging because the one
staging venue had no logo, no slides and no sound. Everything here writes to the TEST project only (each script refuses
any other) and plays in a headless Chrome on the test server vp-tests-1, never on Dean's Mac.

| File | What |
|---|---|
| `seed-real-venues.py` | Makes / refreshes two TEST venues, mostly through the staging Workers' own routes as the test host. **Stage Mini Bar** (QLD, `5eed00b2-0000-4000-8000-0000000000a1`, slug `stage-mini-bar`): dark wordmark logo on transparent (`--logo box` = the same in a white box), 4 slides incl. a scan-to-join slide, What's on with 3 nights, sounds and the buzzer ON, raffle race look, members flip look, 20 members, a host login (0491 570 002) with a Hosted by card. **Stage Harbour Hotel** (NSW, `5eed00b2-0000-4000-8000-0000000000b1`, slug `stage-harbour-hotel`): no logo, raffle authority (charity) + trade promotion number recorded, 30 members written `Last,First`, draw moments and winner takes the screen ON, a purchase raffle set up to start in 2 days. `--check` reads back. Idempotent (fixed ids `5eed00b*`). |
| `real-venues/` | The made-up logos and slides it uploads (never a real venue's). |
| `real-venues-play.py` | Plays trivia, musical bingo, bingo, raffle, members draw at one venue, host only with 0 phones and with 2 phones. Saves every TV frame at 1920x1080 and 1280x720 (two TVs), the console at 390x844 and 375x667, the phones. Counts on every TV frame how often the venue shows (logo, name in words, Hosted by) and flags more than once; says when the console's main button is below the screen. |
| `real-venues-sheet.py` | The contact sheet (index.html) per run and a day index. |
| `real-venues-signup.py` | A fresh public sign-up from the staging home page ("Stage New Pub <ddmm>", VIC, fiction mobile, @example.invalid), taps counted, then the card (Stripe TEST mode only, test card 4242), sign-in by the staging test path, the setup wizard, its first trivia game. Older sign-ups get " (old sign-up)" on their name. |
| `real-venues-run.py` | The run sheet as one command (below). |

Run it (from the Mac, any worktree with these files):

    python3 tools/staging/real-venues-run.py --seed                 refresh the venues, play both, build the sheets
    python3 tools/staging/real-venues-run.py stage-harbour-hotel    one venue
    python3 tools/staging/real-venues-run.py --games trivia --modes nophone stage-mini-bar
    python3 tools/staging/real-venues-signup.py                     the fresh sign-up on its own

Sheets: `~/venue-enrich/reports/staging-real-venues-<date>/index.html`. A person LOOKS at every frame: a check that
reads words is not the test (15 Nov).

### The Kogan TV on staging, for a sound check (the installed store app is not touched)

The Kogan is a Tizen 7 TV (not Android). Its store app `VenuePlyTV.venueplayTV` has the live site written in and no
way to change it. A second app, "venueplay TV (test)" (`VnPlyTest1.venueplayTVtest`, own package, points only at
https://staging.venueplay.com.au), was built and signed on 13 Nov: `~/venue-enrich/reports/tv-test-build/venueplayTVtest.wgt`.
It installs BESIDE the store app. From the Mac on the office network (Tizen Studio, Dean's "venueplay" certificate):

    ~/tizen-studio/tools/sdb connect 192.168.68.58:26101          the TV's address may have moved (DHCP): check the TV's network screen
    ~/tizen-studio/tools/ide/bin/tizen install -n ~/venue-enrich/reports/tv-test-build/venueplayTVtest.wgt -s 192.168.68.58:26101
    ~/tizen-studio/tools/ide/bin/tizen run -p VnPlyTest1.venueplayTVtest -s 192.168.68.58:26101

On the TV the test app asks for the venue: type `stage-mini-bar` (sounds ON there). Press OK once on the remote (a TV
browser plays no sound before a press), then run a game from a phone or the test server on staging and listen for the
musical bingo clip, the trivia sounds and the time's-up buzzer on the 0. Nothing can hear the TV for us: kogan-shot.py
takes a picture, not sound, so a person listens (or a phone recording beside the TV). The staging site lets the office
network (157.85.251.201) through its access lock, which is where the Kogan is. If /tv or vp-env.js change, rebuild with
`make-tv-test-build.py` and sign again. To remove it later: `tizen uninstall -p VnPlyTest1.venueplayTVtest -s <tv>`.

## Added 16 Nov 2026 (Jobs rows 440 + 441): the full circle, every night

`lifecycle-run.py` lives a whole venue life on TEST and checks every step (players and their ticks, messages, the
weekly cancel, the 90-day deletion). Plain HTTP from the Mac to the TEST project and the staging Workers; the 90-day
sweep runs in node on vp-tests-1 (the TEST key goes over ssh on stdin, never written there). No browser, no
/tmp/vp-heavy.lock. Refuses any address that is not TEST or staging, and Stripe without a `sk_test_` key.

    python3 tools/staging/lifecycle-run.py                  nightly: players, messages, (Mondays) cancel, 90 days
    python3 tools/staging/lifecycle-run.py --cancel-now     cancel this run whatever the day
    python3 tools/staging/lifecycle-run.py --steps players,messages
    python3 tools/staging/lifecycle-run.py --alerts on      send the alert for real (default: DRY RUN, says what it would send)

Page: `~/venue-enrich/reports/staging-lifecycle-<date>/index.html` (+ `results-<run>.json`). Exit 1 when any FAULT.

What it does to TEST, on purpose: switches player collection on at Stage Mini Bar, Stage Harbour Hotel and the new pub
(and ticks `optin_release_approved` on their accounts, because migration 82's gate refuses an @example.invalid
contact); makes a "Stage New Pub ddmm (stand-in)" free-month pub when no real sign-up is active (none has ever got past
the card page); cancels the oldest Stage New Pub on Mondays; moves a cancelled one's `closed_at` back 91 days and runs
live's `sweepRetention`, lifted word for word out of `venueplay-backend/worker/venueplay-game.js` of THIS checkout.

The alert: one line, dry run unless `--alerts on`. Channel = what the Mac's own jobs use for Dean
(`promises/check-promises.py` send_email: Resend with RESEND_VENUEPLAY_KEY to dean@gflam.com.au), macOS notification
if that fails. The switch is `send_alert(line, on)` in the script.

Nightly (main loads it, with Dean's yes; NOT loaded): `~/Library/LaunchAgents/com.gflam.staging-lifecycle.plist`,
StartCalendarInterval Hour 2 Minute 30, ProgramArguments `/usr/bin/python3 <repo>/tools/staging/lifecycle-run.py
--alerts on`, StandardOutPath `~/venue-enrich/reports/staging-lifecycle.log`, then `launchctl load` it.
