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
| `seed-test-data.sql` | TEST, writes | 6 test venues (Alpha, Bravo, Charlie, Mini Bar (test), Echo, Foxtrot), a group of 3, a test host and manager on 0400 000 001/002, 85 fake members, 80 fake players. All `@example.invalid`. |
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
| 1 | Dean (main reads the screen with him) | Supabase dashboard, **Gflam (Singapore)** project | Settings, Infrastructure: note the Postgres version (must be the same major version as live, else upgrade the old one first). Settings, API: rotate the keys (old copies of the old keys stop working). Authentication: Site URL = the staging site; Send SMS hook OFF; custom SMTP OFF; Phone provider "Test phone numbers": `61400000001`, `61400000002` with a code main picks; email sign-ups off. Edge Functions: delete any. Database, Webhooks: delete any. |
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
