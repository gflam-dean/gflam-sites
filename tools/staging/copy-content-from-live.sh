#!/bin/bash
# copy-content-from-live.sh: READS LIVE (read-only), WRITES TEST. Main runs it; nobody else.
#
# Copies the tables in content-tables.txt (trivia library, musical library, help desk articles,
# saved replies, the licensed-venue register) from LIVE to TEST, so games on TEST have questions
# and songs. These are our own content, not people. Nothing else is ever copied from live.
#
#   LIVE_DB_URL=... TEST_DB_URL=... bash tools/staging/copy-content-from-live.sh
#
# LOCKS, all checked before anything moves:
#   * TEST_DB_URL must contain gpoolavkghnxedzrmtmc and must NOT contain ijkzgmdtwtgfkedqspxm.
#   * LIVE_DB_URL must contain ijkzgmdtwtgfkedqspxm, and every live session is forced read-only
#     (PGOPTIONS default_transaction_read_only=on), so even a typo cannot write to live.
#   * the content list must pass check-schema-matches-live.py --check-content (no person columns).
#   * the TEST side starts with the TEST lock (guard.sql) in the same transaction as the load.
# Never prints a URL. The copied rows sit in a private temp folder that is removed at the end.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
die() { echo "STOP: $*" >&2; exit 1; }

: "${LIVE_DB_URL:?set LIVE_DB_URL (the live database address) in the environment}"
: "${TEST_DB_URL:?set TEST_DB_URL (the TEST database address) in the environment}"
case "$TEST_DB_URL" in *ijkzgmdtwtgfkedqspxm*) die "TEST_DB_URL names the LIVE project. Nothing done.";; esac
case "$TEST_DB_URL" in *gpoolavkghnxedzrmtmc*) ;; *) die "TEST_DB_URL does not name gpoolavkghnxedzrmtmc. Nothing done.";; esac
case "$LIVE_DB_URL" in *ijkzgmdtwtgfkedqspxm*) ;; *) die "LIVE_DB_URL does not name the live project. Nothing done.";; esac
command -v psql >/dev/null || die "psql is not installed (Postgres.app or brew install libpq)"

python3 "$HERE/check-schema-matches-live.py" --check-content "$HERE/content-tables.txt" \
  --columns "$ROOT/venueplay-backend/supabase/COLUMNS-BASELINE.json" || die "the content list names a table that can hold people"

WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
LOAD="$WORK/load.sql"
{
  echo "begin;"
  sed -n '/VP-STAGING-GUARD-BEGIN/,/VP-STAGING-GUARD-END/p' "$HERE/guard.sql"
} > "$LOAD"

TABLES=()
while IFS= read -r line; do
  line="${line%%#*}"; [ -z "${line// }" ] && continue
  t="${line%% *}"; w=""; [ "$t" != "$line" ] && w="${line#* }"
  TABLES+=("$t")
  echo "  reading live: $t ${w:+($w)}"
  PGOPTIONS='-c default_transaction_read_only=on' psql "$LIVE_DB_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "\\copy (select * from public.$t ${w}) to '$WORK/$t.tsv'"
done < "$HERE/content-tables.txt"

# Children first when emptying, parents first when loading (the list is written parents first).
for (( i=${#TABLES[@]}-1; i>=0; i-- )); do echo "delete from public.${TABLES[$i]};" >> "$LOAD"; done
for t in "${TABLES[@]}"; do echo "\\copy public.$t from '$WORK/$t.tsv'" >> "$LOAD"; done
echo "commit;" >> "$LOAD"

psql "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$LOAD"
echo "COPIED ${#TABLES[@]} content table(s) live -> TEST. No people, nothing written to live."
