#!/usr/bin/env python3
"""
Seed VenuePlay trivia questions into Supabase (vp_question_sets + vp_questions)
from data/trivia-library.json.

SECURITY: this needs your Supabase SERVICE key. Keep it SECRET - never paste it into
a chat, never commit it. Set it in your terminal just before running:

    cd sites/venueplay
    export SUPABASE_SERVICE_KEY='paste-your-service-key-here'

Then do a small TEST run first (30 questions per category, ~450 total):

    SEED_LIMIT=30 SEED_RESET=1 python3 seed-trivia.py

If that looks good in the trivia host's question-set dropdown, do the full run:

    SEED_RESET=1 python3 seed-trivia.py

Options (environment variables):
    SUPABASE_URL   defaults to the VenuePlay project
    SEED_RESET=1   delete existing LIBRARY sets first (safe: leaves venue-owned sets alone),
                   so you can re-run cleanly without duplicating.
    SEED_LIMIT=N   only seed N questions per category (for a quick test). 0 = all.
"""
import json, os, sys, urllib.request, urllib.error, random

URL = os.environ.get("SUPABASE_URL", "https://gpoolavkghnxedzrmtmc.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "trivia-library.json")
RESET = os.environ.get("SEED_RESET") == "1"
PERCAT_LIMIT = int(os.environ.get("SEED_LIMIT", "0"))

if not KEY:
    sys.exit("ERROR: set SUPABASE_SERVICE_KEY in your environment first (keep it secret).")
if len(KEY) < 40:
    sys.exit("ERROR: that doesn't look like a service key. Use the service_role key, not the anon key.")


def req(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=data, method=method)
    r.add_header("apikey", KEY)
    r.add_header("Authorization", "Bearer " + KEY)
    r.add_header("Content-Type", "application/json")
    if prefer:
        r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# 1. load the library
if not os.path.exists(LIB):
    sys.exit("ERROR: can't find " + LIB + " - run this from sites/venueplay.")
lib = json.load(open(LIB, encoding="utf-8"))
questions = lib.get("questions") or []
print("Loaded %d questions from the library." % len(questions))


def valid(q):
    o = q.get("options")
    ci = q.get("correctIndex")
    return (isinstance(o, list) and len(o) == 4
            and isinstance(ci, int) and 0 <= ci <= 3
            and bool(q.get("question")))


# group by category
by_cat = {}
for q in questions:
    if valid(q):
        by_cat.setdefault(q.get("category") or "General Knowledge", []).append(q)
print("Grouped into %d categories." % len(by_cat))

# 2. optional clean reset of our library sets (never touches venue-owned sets)
if RESET:
    print("SEED_RESET: removing existing library sets...")
    st, sets = req("GET", "vp_question_sets?visibility=eq.library&select=id")
    if st == 200 and isinstance(sets, list):
        for s in sets:
            req("DELETE", "vp_questions?set_id=eq." + s["id"])
            req("DELETE", "vp_question_sets?id=eq." + s["id"])
        print("  removed %d old library set(s)." % len(sets))
    else:
        print("  (could not list existing sets: %s %s)" % (st, sets))

# 3. create a set per category and bulk-insert its questions
total = 0
for cat, items in sorted(by_cat.items()):
    random.shuffle(items)
    if PERCAT_LIMIT:
        items = items[:PERCAT_LIMIT]
    if not items:
        continue
    st, res = req("POST", "vp_question_sets",
                  {"title": cat, "visibility": "library", "owner_venue_id": None,
                   "status": "active", "question_count": len(items)},
                  prefer="return=representation")
    if st not in (200, 201) or not isinstance(res, list) or not res:
        sys.exit("ERROR creating set '%s': %s %s\n(send me this exact message and I'll fix the mapping)" % (cat, st, res))
    set_id = res[0]["id"]
    rows = [{"set_id": set_id, "seq": i + 1, "question": q["question"],
             "options": q["options"], "correct_index": q["correctIndex"]}
            for i, q in enumerate(items)]
    for b in range(0, len(rows), 500):
        st, r = req("POST", "vp_questions", rows[b:b + 500], prefer="return=minimal")
        if st not in (200, 201):
            sys.exit("ERROR inserting '%s' (batch at %d): %s %s\n(send me this and I'll fix it)" % (cat, b, st, r))
    total += len(rows)
    print("  %-28s %d questions" % (cat, len(rows)))

print("\nDone. Inserted %d questions across %d category sets." % (total, len(by_cat)))
print("Open the trivia host - the question-set dropdown should now be full.")
