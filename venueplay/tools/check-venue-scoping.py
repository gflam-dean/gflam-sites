#!/usr/bin/env python3
"""
THE RULE: a venue must only ever see its own account's data.

Only VenuePlay HQ (app/hq.html) may list every venue. Everywhere else, "which venues can
this person see" must be answered by their staff rows, or by the account (founding_id) or
group (group_id) of the venue being viewed. Never by "all of them".

Run before pushing any change to the app:

    python3 tools/check-venue-scoping.py

WHY THIS EXISTS
This has been got wrong three times in one day, each time by assuming everyone is venue
staff, then over-correcting:
  - vpbRequireOwner returned 403 to HQ admins because they have no staff rows
  - vpbMyVenues returned them an empty list
  - the host console's venue switcher was "fixed" by showing every venue in the database,
    which meant a venue operator could see every other operator's venues

The failure mode is always the same shape. The gate is written for venue staff, an admin
does not fit, and the quick fix is to open it up entirely. Opening it up is never the fix.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
def read(p):
    with open(os.path.join(HERE, "..", p), encoding="utf-8") as f:
        return f.read()

idx = read("app/index.html")
ses = read("app/vp-session.js")

CHECKS = []

# --- the host console must never render an unscoped venue list -------------------------
picker = ""
m = re.search(r"function showVenuePick\(\)\{.*?\n  \}", idx, re.S)
if m:
    picker = m.group(0)

CHECKS.append((
    "the venue switcher exists and is scoped",
    bool(picker) and "founding_id" in picker and "group_id" in picker,
    "showVenuePick() must narrow the list by the viewed venue's account or group.",
))

CHECKS.append((
    "the switcher never assigns the whole list to an admin",
    bool(picker) and not re.search(r"mine\s*=\s*isAdmin\s*\?\s*\(vs\|\|\[\]\)", picker),
    "'mine = isAdmin ? (vs||[]) : ...' hands one operator every other operator's venues.\n"
    "     Scope to the account of the venue being viewed instead.",
))

CHECKS.append((
    "non-admin staff are still scoped by their staff rows",
    bool(picker) and "ids[v.id]" in picker,
    "Venue staff must keep seeing only venues they have a vp_venue_staff row for.",
))

CHECKS.append((
    "listVenues stays RLS-scoped, not filtered client-side only",
    'from("vp_venues")' in ses,
    "The database is the real boundary. Client-side filtering alone is not security.",
))

# --- only HQ may enumerate everything --------------------------------------------------
for page in ["app/index.html", "app/billing.html", "app/settings.html"]:
    try:
        src = read(page)
    except OSError:
        continue
    # a bare select of all venues with no filtering anywhere near it
    bad = re.search(r'from\("vp_venues"\)\s*\.select\([^)]*\)\s*(?!.*(eq|in|filter|match))', src)
    CHECKS.append((
        "%s does not enumerate every venue" % page,
        not bad,
        "Only app/hq.html should ever list the whole database.",
    ))

print("Checking venues cannot see each other's data\n")
bad = 0
for name, ok, why in CHECKS:
    print(("  PASS  " if ok else "  FAIL  ") + name)
    if not ok:
        bad += 1
        print("     -> " + why)

if bad:
    print("\n%d check(s) failed. DO NOT DEPLOY.\n" % bad)
    print("  A venue seeing another venue's data is not a cosmetic bug. It is the kind of")
    print("  thing an operator notices once and never trusts the product again.")
    print("  Scope it to the account being viewed. Do not open it up to everything.")
    sys.exit(1)
print("\nAll good. Venues can only see their own account.")
