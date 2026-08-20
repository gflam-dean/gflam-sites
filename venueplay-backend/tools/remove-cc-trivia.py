#!/usr/bin/env python3
"""
Remove every Creative Commons question from the trivia bank, so the whole bank is ours.

WHY
---
About a quarter of the bank came from Open Trivia Database and OpenTriviaQA, both CC BY-SA 4.0.
That licence carries two costs: attribution has to be published and kept published, and ShareAlike
arguably reaches the compiled collection, which would mean the 31,000 questions WE wrote are
shared on the same terms. Deleting the borrowed quarter removes both problems at once. No
attribution page, no credits link, no licence clause in the terms, and nothing a competitor can
lift. 31,094 questions remain, which at 30 a week is twenty years of trivia.

THE AWKWARD BIT
---------------
vp_questions in the live database has NO source or license column (checked, 20 Aug 2026). Only
data/trivia-library.json knows where each question came from. So the borrowed ones are identified
here by their TEXT, normalised the same way add-trivia.py de-duplicates, and deleted by matching
that text in the live table. That is why this script exists rather than a one-line SQL delete.

USAGE
-----
    cd /Users/dean.tindale/gflam-ai-team/sites/venueplay
    python3 remove-cc-trivia.py                    # DRY RUN: says what it would do, changes nothing
    export SUPABASE_SERVICE_KEY='...'              # keep this secret, never commit it
    python3 remove-cc-trivia.py --apply            # actually do it
    python3 remove-cc-trivia.py --status           # read-only: how far did it get

Questions that have been answered in a real game cannot be deleted, because vp_trivia_answers
points at them. Those are PARKED instead (vp_questions.parked_at, which the game Worker already
filters on), which takes them out of play just as effectively and leaves game history alone.

ORDER MATTERS
-------------
Run this BEFORE the attribution comes off the site. While those questions are live, the licence
requires the credit to be published. Delete first, then drop the credits page and the licence
paragraph in the terms. Doing it the other way round is the one sequence that is a breach.

It writes data/trivia-library.BACKUP-<n>.json before touching anything.
"""
import json, os, re, sys, urllib.request, urllib.error

URL = os.environ.get("SUPABASE_URL", "https://gpoolavkghnxedzrmtmc.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "data", "trivia-library.json")
APPLY = "--apply" in sys.argv
STATUS = "--status" in sys.argv

CC_SOURCES = {
    "Open Trivia Database (opentdb.com)",
    "OpenTriviaQA (github.com/uberspot/OpenTriviaQA)",
}

def norm(s):
    """Same normalisation add-trivia.py uses to spot a duplicate, so matching is consistent."""
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())

class Refused(Exception):
    def __init__(self, code, body): self.code, self.body = code, body

def req(method, path, body=None, headers=None, soft=False):
    h = {
        "apikey": KEY,
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw.strip() else []
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        if soft:
            raise Refused(e.code, detail)
        sys.exit("\nSTOPPED: the database refused a %s request.\n  %s\n\n"
                 "Nothing further was changed. Re-running is safe: already-deleted rows are simply\n"
                 "not found again, and the library is only rewritten once everything else worked.\n"
                 % (method, detail))
    except urllib.error.URLError as e:
        sys.exit("\nSTOPPED: could not reach the database (%s).\nRe-running is safe.\n" % e)

def page_all(path, page=1000):
    """PostgREST caps a response, so walk it."""
    out, start = [], 0
    while True:
        rows = req("GET", path + ("&" if "?" in path else "?") + "limit=%d&offset=%d" % (page, start))
        out.extend(rows)
        if len(rows) < page:
            return out
        start += page

# ---------------------------------------------------------------- is the key even here?
# Printed FIRST, because the usual reason this stops early is an export that was typed in a
# different Terminal window. export only lasts for the window you typed it in.
HAVE_KEY = bool(KEY) and len(KEY) > 40
print("Service key: %s" % ("found" if HAVE_KEY else "NOT SET in this Terminal window"))
if not HAVE_KEY and (APPLY or STATUS):
    sys.exit(
        "\nThis needs the key. In THIS window, run:\n"
        "    export SUPABASE_SERVICE_KEY='paste-the-service-role-key-here'\n"
        "then run this again. The key is in Supabase under Project Settings, API,\n"
        "service_role. It only lasts for this window, so a new tab needs it again.\n")

# ---------------------------------------------------------------- the library
lib = json.load(open(LIB, encoding="utf-8"))
qs = lib.get("questions", lib if isinstance(lib, list) else [])
cc = [q for q in qs if q.get("source") in CC_SOURCES]
keep = [q for q in qs if q.get("source") not in CC_SOURCES]

print("Library: %d questions" % len(qs))
print("  Creative Commons, to remove : %d" % len(cc))
print("  Ours, to keep               : %d" % len(keep))
if not cc:
    sys.exit("\nNothing to remove. Already done.")

cc_keys = {norm(q.get("question")) for q in cc}
keep_keys = {norm(q.get("question")) for q in keep}
# A borrowed question whose text ALSO appears in one of ours must not be deleted: the text is the
# only handle we have, so an overlap would take one of ours with it.
collide = cc_keys & keep_keys
if collide:
    print("  %d texts appear in BOTH sets and will be LEFT ALONE (cannot tell them apart)" % len(collide))
    cc_keys -= collide

if STATUS:
    print("\nReading the live bank (about a minute, it pages through ~40,000 rows)...")
    live = page_all("vp_questions?select=id,question")
    live_keys = [norm(r.get("question")) for r in live]
    still = sum(1 for k in live_keys if k in cc_keys)
    print("\nLIVE DATABASE")
    print("  questions live now        : %d" % len(live))
    print("  still Creative Commons    : %d" % still)
    print("\nLOCAL LIBRARY")
    print("  questions in the file     : %d" % len(qs))
    print("  still Creative Commons    : %d" % len(cc))
    if still == 0 and len(cc) > 0:
        print("\nThe live bank is clean but the local file is not. The delete finished and the")
        print("rewrite did not. Re-run with --apply: it will find nothing to delete and just")
        print("tidy the file.")
    elif still == 0 and len(cc) == 0:
        print("\nAll done, both sides. Safe to take the attribution off the site.")
    else:
        print("\nNot finished. Re-run with --apply.")
    sys.exit(0)

if not HAVE_KEY:
    print("\nDRY RUN (no key in this window). Nothing was changed, locally or live.")
    print("Set the key and re-run with --apply to do it for real.")
    sys.exit(0)

# ---------------------------------------------------------------- the live database
print("\nReading the live question bank (this takes a minute, it pages through ~40,000 rows)...")
live = page_all("vp_questions?select=id,set_id,question")
print("  live rows: %d" % len(live))
doomed = [r for r in live if norm(r.get("question")) in cc_keys]
print("  matching a Creative Commons question: %d" % len(doomed))

by_set = {}
for r in doomed:
    by_set.setdefault(r["set_id"], []).append(r["id"])
print("  spread across %d question sets" % len(by_set))

if not APPLY:
    print("\nDRY RUN. Nothing was changed. Re-run with --apply to delete the %d rows above." % len(doomed))
    sys.exit(0)

# ---------------------------------------------------------------- do it
n = 1
while os.path.exists(os.path.join(HERE, "data", "trivia-library.BACKUP-%d.json" % n)):
    n += 1
backup = os.path.join(HERE, "data", "trivia-library.BACKUP-%d.json" % n)
json.dump(lib, open(backup, "w", encoding="utf-8"), ensure_ascii=False)
print("\nBacked up the library to %s" % os.path.basename(backup))

# A question that has been ANSWERED in a real game cannot simply be deleted: vp_trivia_answers
# holds a row per player per question and points back at it. There is no retire flag on
# vp_questions (checked, 20 Aug 2026), so a question that stays is a question that keeps being
# served, which keeps the licence obligation alive. The only way to actually retire one is to
# clear the answer rows first.
#
# That is real data, so it is never done by default. Without --purge-answers this stops and
# reports how many are stuck. With it, the answer rows for THOSE questions only are deleted
# first. What is lost is per-player per-question answer detail for questions we are retiring;
# who won a night lives in vp_game_reports and is untouched.
deleted = 0
parked = []
for set_id, ids in by_set.items():
    removed_here = 0
    for i in range(0, len(ids), 100):          # chunked: a URL has a length limit
        chunk = ids[i:i + 100]
        try:
            req("DELETE", "vp_questions?id=in.(%s)" % ",".join(chunk),
                headers={"Prefer": "return=minimal"}, soft=True)
            deleted += len(chunk); removed_here += len(chunk)
        except Refused as e:
            if "23503" not in e.body:
                sys.exit("\nSTOPPED: the database refused a DELETE.\n  %s\n" % e.body)
            # PARK them instead. vp_questions.parked_at already exists (migration 32) and the
            # game Worker filters on parked_at is null both when it picks a question and when it
            # searches the library, so a parked question is never served again. That is the same
            # outcome as deleting it, without touching a single row of game history.
            req("PATCH", "vp_questions?id=in.(%s)" % ",".join(chunk),
                {"parked_at": "now()"}, headers={"Prefer": "return=minimal"})
            parked.extend(chunk); removed_here += len(chunk)
    print("  set %s: -%d" % (set_id[:8], removed_here))

if parked:
    print("\n%d question%s had been answered in a real game, so %s parked instead of deleted."
          % (len(parked), "" if len(parked) == 1 else "s", "it was" if len(parked) == 1 else "they were"))
    print("Parked means never served again, and never returned by the library search either, so it")
    print("is the same outcome as deleting. The difference is that the game history that pointed at")
    print("them is left exactly as it was.")

print("Deleted %d rows. Recounting each set..." % deleted)
sets = req("GET", "vp_question_sets?select=id,title,question_count")
for s in sets:
    real = len(page_all("vp_questions?set_id=eq.%s&select=id" % s["id"]))
    if real != (s.get("question_count") or 0):
        req("PATCH", "vp_question_sets?id=eq.%s" % s["id"], {"question_count": real})
    print("  %-28s %d" % ((s.get("title") or "?")[:28], real))

if isinstance(lib, list):
    json.dump(keep, open(LIB, "w", encoding="utf-8"), ensure_ascii=False)
else:
    lib["questions"] = keep
    json.dump(lib, open(LIB, "w", encoding="utf-8"), ensure_ascii=False)
print("\nLibrary rewritten: %d questions, all ours." % len(keep))
print("NOW you can take the attribution off the site: /credits and the licence paragraph in /terms.")
