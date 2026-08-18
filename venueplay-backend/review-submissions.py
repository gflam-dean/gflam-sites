#!/usr/bin/env python3
"""
The weekly host-question review. Back office only: venues never see any of this.

When a host writes their own trivia questions they play on that venue's night immediately.
A copy also lands in vp_question_submissions, and once a week we fact-check those, fix the
wording, and promote the good ones into the shared bank so every venue gets them.

    cd ~/gflam-ai-team/sites/venueplay
    export SUPABASE_SERVICE_KEY='your-service-role-key'

    python3 review-submissions.py                          # 1. show what is waiting
    python3 review-submissions.py --pull                    # 2. write them out for fact-checking
    python3 review-submissions.py --approve <ids> --go      # 3. promote the good ones
    python3 review-submissions.py --reject  <ids> --go      #    bin the rest

Step 2 writes data/generated/submissions-<date>.json in the same shape as every other
batch, so the existing loader takes it from there:

    python3 add-trivia.py data/generated/submissions-<date>.json

Nothing is written without --go. IDs can be comma separated, and a short prefix is enough.
"""
import json, os, re, sys, unicodedata, urllib.parse, urllib.request, urllib.error
from datetime import date

URL = os.environ.get("SUPABASE_URL", "https://gpoolavkghnxedzrmtmc.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
HERE = os.path.dirname(os.path.abspath(__file__))
if not KEY or len(KEY) < 40:
    sys.exit("Set SUPABASE_SERVICE_KEY first (the service_role key).")

args = sys.argv[1:]
GO = "--go" in args
def listarg(flag):
    if flag not in args: return []
    i = args.index(flag)
    return [x.strip() for x in args[i + 1].split(",")] if i + 1 < len(args) else []
APPROVE, REJECT = listarg("--approve"), listarg("--reject")
PULL = "--pull" in args


def call(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1" + path, data=data, method=method)
    r.add_header("apikey", KEY); r.add_header("Authorization", "Bearer " + KEY)
    r.add_header("Content-Type", "application/json")
    if prefer: r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s).split())


st, subs = call("GET", "/vp_question_submissions?status=eq.pending&select=*&order=created_at.asc")
if st != 200:
    sys.exit("Could not read submissions: %s %s" % (st, subs))
subs = subs or []

st, vs = call("GET", "/vp_venues?select=id,name")
venue = {v["id"]: v["name"] for v in (vs or [])}


def match(ids, row):
    return any(row["id"].startswith(x) or row["id"] == x for x in ids)


# ---- resolve ---------------------------------------------------------------
if APPROVE or REJECT:
    picked = [r for r in subs if match(APPROVE, r) or match(REJECT, r)]
    ok = [r for r in picked if match(APPROVE, r)]
    no = [r for r in picked if match(REJECT, r)]
    print("approving %d, rejecting %d" % (len(ok), len(no)))
    for r in ok + no:
        print("   %s  %s" % (r["id"][:8], r["question"][:70]))
    if not GO:
        print("\nDry run. Add --go to write it.")
        sys.exit(0)

    # approved questions become a normal batch file; add-trivia.py dedupes and loads it
    if ok:
        out = [{"question": r["question"].strip(), "options": r["options"],
                "correctIndex": r["correct_index"],
                "category": r.get("category") or "General Knowledge",
                "difficulty": r.get("difficulty") if r.get("difficulty") in ("easy", "medium", "hard") else "medium"}
               for r in ok]
        os.makedirs(os.path.join(HERE, "data", "generated"), exist_ok=True)
        p = os.path.join(HERE, "data", "generated", "submissions-%s.json" % date.today().isoformat())
        json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("\nwrote %s (%d questions)" % (p, len(out)))
        print("now run:  python3 add-trivia.py %s" % p.replace(HERE + os.sep, ""))

    for r, status in [(x, "approved") for x in ok] + [(x, "rejected") for x in no]:
        call("PATCH", "/vp_question_submissions?id=eq." + urllib.parse.quote(r["id"]),
             {"status": status, "reviewed_at": "now()"}, prefer="return=minimal")
    print("marked %d rows resolved" % len(ok + no))
    sys.exit(0)

# ---- pull for fact-checking ------------------------------------------------
if PULL:
    p = os.path.join(HERE, "data", "submissions-review-%s.json" % date.today().isoformat())
    json.dump(subs, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
    print("wrote %d pending submissions to %s" % (len(subs), p))
    print("Fact-check them, then approve or reject by id.")
    sys.exit(0)

# ---- default: show what is waiting -----------------------------------------
if not subs:
    print("Nothing waiting. No host has written a question since the last review.")
    sys.exit(0)

st, bank = call("GET", "/vp_questions?select=question&limit=100000")
have = {norm(q["question"]) for q in (bank or [])}

print("%d host question(s) waiting\n" % len(subs))
for r in subs:
    dupe = " [ALREADY IN THE BANK]" if norm(r["question"]) in have else ""
    opts = r.get("options") or []
    ci = r.get("correct_index")
    bad = "" if (len(opts) == 4 and isinstance(ci, int) and 0 <= ci < 4) else "  [MALFORMED]"
    print("  %s  %s%s%s" % (r["id"][:8], venue.get(r.get("venue_id"), "unknown venue"), dupe, bad))
    print("     %s" % r["question"])
    for i, o in enumerate(opts):
        print("       %s %s" % (">" if i == ci else " ", o))
    print()
print("Next:  python3 review-submissions.py --pull")
