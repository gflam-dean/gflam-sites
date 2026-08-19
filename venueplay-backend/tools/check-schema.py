#!/usr/bin/env python3
"""
check-schema.py -- does every column the code asks for actually exist in the live database?

WHY THIS EXISTS
---------------
On 19 Aug 2026 the HQ venue list was empty for every admin. Nothing was broken in HQ.
vp-session.js asked vp_venues for entity_type and paid_entry_enabled, two columns that
only existed in migration 44, and migration 44 had never been run. PostgREST rejects the
WHOLE select when one column is missing, so the query 400'd, and a "|| []" turned that
error into an empty list. It read as "you have no venues".

No amount of reading the code finds that bug. The code is correct. The database is the
thing that disagrees with it. So this tool does the one check code review cannot: it pulls
every column name the code mentions and asks the live database whether it is really there.

It catches drift in both directions:
  * code shipped ahead of its migration (what bit us),
  * a migration that dropped or renamed a column the code still reads.

USAGE
-----
    python3 check-schema.py                 # checks against the public (anon) key
    SUPABASE_SERVICE_KEY=... python3 check-schema.py    # also covers service-only tables

Run it before every push that touches a select, and after every migration.

WHAT IT CANNOT SEE
------------------
  * Selects built at runtime from variables. The literal part is checked, the rest is not.
  * Columns only ever written (insert/upsert bodies), not read.
  * Tables the anon key cannot reach at all: reported as SKIPPED, never as a pass.
    Pass a service key to cover those.
A SKIPPED line is not a green light. It means "not checked".
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

SUPA_URL = "https://gpoolavkghnxedzrmtmc.supabase.co"
# The public anon key. Already shipped in every page on the site, so it is not a secret.
# A service key, if you have one, comes from the environment and is never written here.
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwb29sYXZrZ2h"
        "ueGVkenJtdG1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjM3MzcsImV4cCI6MjA5Mjc5OTczN30."
        "5si7UoInmLJqkllXNnyVn9yBw_U9GhBARDZvgR_p0DE")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # venueplay-backend/
REPO = os.path.dirname(ROOT)
SCAN_DIRS = [os.path.join(REPO, "venueplay"), os.path.join(ROOT, "worker")]
SCAN_EXT = (".html", ".js")

# PostgREST names a table it does not know, or a column it does not know, in the message.
MISSING_COL = re.compile(r"column\s+\S*?\.?(\w+)\s+does not exist", re.I)

# Chained filter/order helpers whose first argument is a column name. A wrong name in any of
# these 400s exactly like a wrong name in select().
#
# "contains" is deliberately NOT here. It is a real PostgREST filter, but classList.contains()
# is far more common in this codebase, and the first run of this tool duly reported a missing
# column called "hidden" on two tables. A checker that cries wolf gets ignored, which is worse
# than not having one. The lookbehind below covers the same ground for the rest.
FILTERS = ("eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "order")

# Things that appear inside a select() but are not columns of the table itself.
NOT_A_COLUMN = {"*", "count", ""}


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def files():
    out = []
    for base in SCAN_DIRS:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
            for name in filenames:
                if name.endswith(SCAN_EXT):
                    out.append(os.path.join(dirpath, name))
    return sorted(out)


def split_select(spec):
    """Top-level column names from a PostgREST select list.

    Handles alias:col, embedded resources table(a,b) (the embed is skipped, since a
    relationship name is not necessarily a column), and json paths col->>key.
    """
    cols, depth, buf = [], 0, ""
    for ch in spec:
        if ch == "(":
            depth += 1
            buf += ch
        elif ch == ")":
            depth -= 1
            buf += ch
        elif ch == "," and depth == 0:
            cols.append(buf)
            buf = ""
        else:
            buf += ch
    cols.append(buf)

    clean = []
    for c in cols:
        c = c.strip()
        if not c or "(" in c:          # embedded resource: skip, it is not a plain column
            continue
        if ":" in c:                   # alias:column -> keep the real column
            c = c.split(":", 1)[1]
        c = re.split(r"->|::", c)[0]   # json path / cast
        c = c.strip().strip('"')
        if c and c not in NOT_A_COLUMN and re.fullmatch(r"\w+", c):
            clean.append(c)
    return clean


def scan(text, path):
    """Yield (table, column, path) for everything this file reads."""
    found = set()

    # 1. supabase-js: .from("X") ... .select("a,b") / .eq("c", ...) / .order("d")
    for m in re.finditer(r'\.from\(\s*["\'](\w+)["\']', text):
        table = m.group(1)
        # The chain runs until the next .from( or a sensible cutoff.
        rest = text[m.end(): m.end() + 900]
        nxt = rest.find(".from(")
        if nxt != -1:
            rest = rest[:nxt]
        for sm in re.finditer(r'\.select\(\s*["\']([^"\']*)["\']', rest):
            for col in split_select(sm.group(1)):
                found.add((table, col))
        # The lookbehind keeps DOM calls out of it: classList.is/in/order never happens, but
        # keeping the guard means adding a filter name later cannot quietly reintroduce noise.
        for fm in re.finditer(r'(?<!classList)\.(' + "|".join(FILTERS) + r')\(\s*["\']([\w,]+)["\']', rest):
            for col in fm.group(2).split(","):
                col = col.strip()
                if col and col not in NOT_A_COLUMN:
                    found.add((table, col))

    # 2. Direct REST: /rest/v1/X?...select=a,b   and   ?col=eq.something
    for m in re.finditer(r'/rest/v1/(\w+)\?([^"\'`\s]*)', text):
        table, qs = m.group(1), m.group(2)
        sm = re.search(r'select=([\w,:>\-\(\)\*]+)', qs)
        if sm:
            for col in split_select(sm.group(1)):
                found.add((table, col))
        for pm in re.finditer(r'[?&](\w+)=(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.', qs):
            found.add((table, pm.group(1)))

    # 3. Worker helper: vpaSelect(env, 'X', '...select=a,b...')
    for m in re.finditer(r'vpaSelect\(\s*\w+\s*,\s*["\'](\w+)["\']\s*,\s*["\']([^"\']*)["\']', text):
        table, qs = m.group(1), m.group(2)
        sm = re.search(r'select=([\w,:>\-\(\)\*]+)', qs)
        if sm:
            for col in split_select(sm.group(1)):
                found.add((table, col))

    return {(t, c, path) for (t, c) in found}


def probe(table, column, key):
    """Ask the live database for one column. Returns 'ok' | 'missing' | 'notable' | 'blocked'."""
    url = "%s/rest/v1/%s?select=%s&limit=1" % (SUPA_URL, table, column)
    req = urllib.request.Request(url, headers={
        "apikey": key, "Authorization": "Bearer " + key, "Accept": "application/json",
    })
    try:
        urllib.request.urlopen(req, timeout=25).read()
        return "ok"
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(body).get("message", "") or ""
        except Exception:
            msg = body
        low = msg.lower()
        if "does not exist" in low and "column" in low:
            return "missing"
        if "does not exist" in low or "could not find the table" in low or "unknown" in low:
            return "notable"
        if "permission denied" in low or e.code in (401, 403):
            return "blocked"
        return "blocked"
    except Exception:
        return "blocked"


def main():
    key = os.environ.get("SUPABASE_SERVICE_KEY") or ANON
    using_service = bool(os.environ.get("SUPABASE_SERVICE_KEY"))

    wanted = set()
    for path in files():
        wanted |= scan(read(path), path)

    by_pair = {}
    for table, column, path in wanted:
        by_pair.setdefault((table, column), set()).add(os.path.relpath(path, REPO))

    print("Checking %d column reads across %d tables, against the live database."
          % (len(by_pair), len({t for (t, _) in by_pair})))
    print("Key: %s\n" % ("service (full coverage)" if using_service
                         else "public anon (service-only tables will be skipped)"))

    missing, notable, blocked, ok = [], [], [], 0
    table_state = {}

    for (table, column) in sorted(by_pair):
        # If the table itself is unreachable, do not re-probe every column on it.
        if table_state.get(table) in ("notable", "blocked"):
            (notable if table_state[table] == "notable" else blocked).append((table, column))
            continue
        state = probe(table, column, key)
        if state == "ok":
            ok += 1
        elif state == "missing":
            missing.append((table, column))
        elif state == "notable":
            table_state[table] = "notable"
            notable.append((table, column))
        else:
            table_state[table] = "blocked"
            blocked.append((table, column))

    if missing:
        print("MISSING: the code reads these, the database does not have them.")
        print("Any select naming one of these fails ENTIRELY, taking every other column with it.\n")
        for table, column in missing:
            print("  %-26s %-28s" % (table, column))
            for src in sorted(by_pair[(table, column)]):
                print("      read in %s" % src)
        print()

    if notable:
        tables = sorted({t for (t, _) in notable})
        print("UNKNOWN TABLE (%d): %s" % (len(tables), ", ".join(tables)))
        print("  Either not migrated, or not exposed through the API. Check before trusting.\n")

    if blocked:
        tables = sorted({t for (t, _) in blocked})
        print("SKIPPED (%d tables): %s" % (len(tables), ", ".join(tables)))
        print("  The public key cannot read these, so their columns were NOT checked.")
        print("  Re-run with SUPABASE_SERVICE_KEY set to cover them.\n")

    print("%d checked and present, %d missing, %d on unknown tables, %d not checked."
          % (ok, len(missing), len(notable), len(blocked)))

    if missing:
        print("\nFAIL: fix the migration or the select before pushing.")
        return 1
    print("\nPASS: every column this tool could check exists.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
