#!/bin/bash
# build-test-schema.sh: WRITES ONE SQL FILE. CONNECTS TO NOTHING. RUNS NOTHING ON ANY DATABASE.
#
# The file it writes is for the TEST project only (gpoolavkghnxedzrmtmc). It starts with the
# TEST lock (guard.sql), so if someone runs it on LIVE (ijkzgmdtwtgfkedqspxm) it refuses before
# its first change.
#
# TWO WAYS, and why the first is the real one:
#
#   --from-dump LIVE_SCHEMA.sql [--extras LIVE_EXTRAS.sql] [--out FILE]
#       RECOMMENDED. Turns a schema-only dump of LIVE (structure, no rows) into a file for TEST.
#       Live was itself rebuilt from a schema dump on 10 to 12 Sep (migrate-sydney.py), migration
#       files 1 to 12 are not in the repo, and MIGRATIONS.md records numbers that were run from a
#       branch. Replaying the migration folder cannot reproduce live; copying live's structure
#       does, including any change made by hand that no file records. The schema check
#       (check-schema-matches-live.py) then proves it: diff = 0.
#
#   --migrations [--from N] [--out FILE]
#       Joins venueplay-backend/supabase/venueplay-<N>-*.sql in number order. NOT a whole
#       database (it starts at 13). Use it ONLY on top of a TEST database built the first way, to
#       put the migrations since the last build on TEST (--from N = first number to include).
#       From now on each NEW migration normally goes on TEST on its own (README, the route).
#
# Then main runs the output on TEST only:
#   psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f <out>
#
# The live dump it reads is made by main, read-only:
#   PGOPTIONS='-c default_transaction_read_only=on' pg_dump "$LIVE_DB_URL" --schema-only \
#     --schema=public --no-owner --quote-all-identifiers -f ~/.gflam-migrate/live-schema.sql
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIG_DIR="$ROOT/venueplay-backend/supabase"
GUARD="$HERE/guard.sql"

die() { echo "STOP: $*" >&2; exit 1; }

MODE=""; DUMP=""; EXTRAS=""; FROM=0; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-dump) MODE=dump; DUMP="${2:-}"; shift 2 ;;
    --extras)    EXTRAS="${2:-}"; shift 2 ;;
    --migrations) MODE=migrations; shift ;;
    --from)      FROM="${2:-}"; shift 2 ;;
    --out)       OUT="${2:-}"; shift 2 ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done
[ -n "$MODE" ] || die "say --from-dump LIVE_SCHEMA.sql or --migrations (see --help)"
[ -f "$GUARD" ] || die "guard.sql is missing next to this script"
case "$FROM" in ''|*[!0-9]*) die "--from takes a migration number, e.g. --from 192" ;; esac

if [ -z "$OUT" ]; then
  mkdir -p "$HOME/.gflam-migrate"
  OUT="$HOME/.gflam-migrate/test-schema-$MODE.sql"
fi
case "$OUT" in "$ROOT"/*) die "write the output outside the repo (default ~/.gflam-migrate/)";; esac

GUARD_BLOCK="$(sed -n '/VP-STAGING-GUARD-BEGIN/,/VP-STAGING-GUARD-END/p' "$GUARD")"
[ -n "$GUARD_BLOCK" ] || die "guard.sql has no guard block"

if [ "$MODE" = dump ]; then
  [ -f "$DUMP" ] || die "no such dump file: $DUMP"
  # A schema dump has no rows. Refuse a file that has any: that would be live customer data.
  if grep -Eiq '^(COPY |INSERT INTO "?public"?\.)' "$DUMP"; then
    die "$DUMP holds ROWS (COPY / INSERT INTO public). Only a --schema-only dump may be used. Nothing written."
  fi
  grep -q 'CREATE TABLE' "$DUMP" || die "$DUMP has no CREATE TABLE: is it a pg_dump --schema-only of live?"
  if [ -n "$EXTRAS" ]; then
    [ -f "$EXTRAS" ] || die "no such extras file: $EXTRAS"
    if grep -Eiq '^(COPY |INSERT INTO "?public"?\.)' "$EXTRAS"; then die "$EXTRAS holds public rows. Nothing written."; fi
  fi
fi

{
  echo "-- WRITTEN BY tools/staging/build-test-schema.sh ($MODE) on $(date '+%Y-%m-%d %H:%M %Z')."
  echo "-- RUN ONLY ON THE OLD PROJECT gpoolavkghnxedzrmtmc (the venueplay TEST database), NEVER LIVE."
  echo "-- The first block below refuses on any project without the TEST marker."
  echo
} > "$OUT"

if [ "$MODE" = dump ]; then
  {
    echo "begin;"
    echo "$GUARD_BLOCK"
    echo
    if [ -n "$EXTRAS" ]; then
      echo "-- ===== live extras, part 1: extensions first (functions may need them) ====="
      grep -Ei '^create extension' "$EXTRAS" || true
      echo
    fi
    echo "-- ===== live public schema (structure only), from $(basename "$DUMP") ====="
    # Same clean-up migrate-sydney.py needed on 10 Sep:
    #  - CREATE SCHEMA public: the wipe already made it, so the restore would stop on line one;
    #  - ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin: only supabase_admin may set those;
    #  - SET transaction_timeout (pg_dump 17+) and \restrict / \unrestrict (pg_dump 17.6+): an
    #    older server or psql rejects them.
    sed -E \
      -e '/^CREATE SCHEMA "?public"?;/d' \
      -e '/^ALTER DEFAULT PRIVILEGES FOR ROLE "?supabase_admin"? /d' \
      -e '/^SET transaction_timeout/d' \
      -e '/^\\(restrict|unrestrict)( |$)/d' \
      "$DUMP"
    echo
    if [ -n "$EXTRAS" ]; then
      echo "-- ===== live extras, part 2: realtime publication, storage buckets, storage policies ====="
      grep -Eiv '^(create extension|--)' "$EXTRAS" | grep -v '^$' || true
      echo
    fi
    echo "commit;"
  } >> "$OUT"
else
  FILES=()
  while IFS= read -r f; do FILES+=("$f"); done < <(
    for f in "$MIG_DIR"/venueplay-[0-9]*.sql; do
      n="$(basename "$f" | sed -E 's/^venueplay-([0-9]+)-.*/\1/')"
      [ "$n" -ge "$FROM" ] && printf '%s\t%s\n' "$n" "$f"
    done | sort -n -k1,1 | cut -f2)
  [ "${#FILES[@]}" -gt 0 ] || die "no migration numbered $FROM or above"
  {
    echo "-- NOT a whole database: migration files from number $FROM on, in order."
    echo "-- Some files carry their own begin/commit, so this is NOT one transaction. The guard"
    echo "-- below still runs first and stops everything after it on any non-TEST project."
    echo "$GUARD_BLOCK"
    for f in "${FILES[@]}"; do
      echo
      echo "-- ======================================================================"
      echo "-- FILE: venueplay-backend/supabase/$(basename "$f")"
      echo "-- ======================================================================"
      cat "$f"
      echo
    done
  } >> "$OUT"
  echo "joined ${#FILES[@]} migration file(s), number $FROM and up"
fi

echo "WROTE $OUT"
echo "Nothing was run. Next (main, TEST only): psql \"\$TEST_DB_URL\" -X -v ON_ERROR_STOP=1 -f \"$OUT\""
