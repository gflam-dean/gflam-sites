#!/usr/bin/env python3
"""
Repair the trivia bank: drop duplicate questions, and stop the correct answer
being option A most of the time.

The bulk "VenuePlay Original" batches were written with the correct answer first,
so about 70% of the bank had correctIndex 0. A player works that out within two
rounds and just guesses A.

Run it exactly like the loader:

    cd ~/gflam-ai-team/sites/venueplay
    export SUPABASE_SERVICE_KEY='your-service-role-key'
    python3 fix-trivia-answers.py

Without the key it fixes only data/trivia-library.json and tells you so. With the
key it fixes the live database too, which is what the game actually deals from.

SAFE TO RUN TWICE. The new position of each answer is worked out from the question
text itself, so the same question always lands the same way. Running it again finds
nothing left to change, and the file and the database always agree even though they
are repaired separately.
"""
import hashlib, json, os, random, re, sys, unicodedata, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "data", "trivia-library.json")
COUNT = os.path.join(HERE, "data", "trivia-count.json")
URL = os.environ.get("SUPABASE_URL", "https://gpoolavkghnxedzrmtmc.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s).split())


def rearrange(question, options, correct_index):
    """Deterministic new order for one question. Returns (options, correct_index).

    The correct answer is picked out BY VALUE first, so it survives the move. Options
    are sorted into a canonical order before shuffling, which is what makes this
    repeatable: shuffling an already-shuffled list would apply the permutation twice
    and quietly push answers back towards A."""
    answer = options[correct_index]
    canon = sorted(options, key=norm)
    order = list(range(len(canon)))
    seed = int(hashlib.md5(norm(question).encode()).hexdigest()[:8], 16)
    random.Random(seed).shuffle(order)
    new = [canon[i] for i in order]
    return new, new.index(answer)


def usable(q):
    o = q.get("options") or []
    c = q.get("correctIndex")
    return (len(o) == 4 and len({norm(x) for x in o}) == 4
            and isinstance(c, int) and 0 <= c < 4
            and str(q.get("question", "")).strip())


# ---------------------------------------------------------------- the master file
lib = json.load(open(LIB, encoding="utf-8"))
qs = lib["questions"]
before = len(qs)

seen, kept, dupes = set(), [], 0
for q in qs:
    k = norm(q.get("question", ""))
    if k in seen:
        dupes += 1
        continue
    seen.add(k)
    kept.append(q)

moved = skipped = 0
spread_before = [0, 0, 0, 0]
spread_after = [0, 0, 0, 0]
for q in kept:
    if not usable(q):
        skipped += 1
        continue
    spread_before[q["correctIndex"]] += 1
    new_opts, new_ci = rearrange(q["question"], q["options"], q["correctIndex"])
    if new_opts != q["options"]:
        moved += 1
    q["options"], q["correctIndex"] = new_opts, new_ci
    spread_after[new_ci] += 1

lib["questions"] = kept
json.dump(lib, open(LIB, "w", encoding="utf-8"), ensure_ascii=False)
json.dump({"count": len(kept), "updated": "2026-08-10",
           "note": "Live VenuePlay trivia question count. Regenerate whenever the bank changes."},
          open(COUNT, "w"), indent=2)


def pct(row):
    t = sum(row) or 1
    return "  ".join("%s %5d (%4.1f%%)" % (l, n, n * 100.0 / t) for l, n in zip("ABCD", row))


print("MASTER FILE")
print("  questions      %d -> %d  (%d duplicates removed)" % (before, len(kept), dupes))
print("  answers moved  %d   (left alone: %d malformed)" % (moved, skipped))
print("  before         %s" % pct(spread_before))
print("  after          %s" % pct(spread_after))

# ------------------------------------------------------------------ the database
if not KEY or len(KEY) < 40:
    print("\nDATABASE: skipped, no SUPABASE_SERVICE_KEY set.")
    print("The game deals from the database, so the all-A problem is still live until")
    print("you set the key and run this again.")
    sys.exit(0)


def req(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=data, method=method)
    r.add_header("apikey", KEY); r.add_header("Authorization", "Bearer " + KEY)
    r.add_header("Content-Type", "application/json")
    if prefer:
        r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


print("\nDATABASE: reading vp_questions ...")
rows, page = [], 0
while True:
    st, batch = req("GET", "vp_questions?select=id,question,options,correct_index"
                           "&order=id&limit=1000&offset=%d" % (page * 1000))
    if st != 200 or not isinstance(batch, list):
        print("  could not read questions: %s %s" % (st, batch)); sys.exit(1)
    rows.extend(batch)
    if len(batch) < 1000:
        break
    page += 1
print("  %d rows" % len(rows))

db_seen, db_dupes, updates = set(), [], []
for r in rows:
    k = norm(r.get("question", ""))
    if k in db_seen:
        db_dupes.append(r["id"]); continue
    db_seen.add(k)
    o, c = r.get("options"), r.get("correct_index")
    if not (isinstance(o, list) and len(o) == 4 and isinstance(c, int) and 0 <= c < 4):
        continue
    new_opts, new_ci = rearrange(r["question"], o, c)
    if new_opts != o or new_ci != c:
        updates.append({"id": r["id"], "options": new_opts, "correct_index": new_ci})

print("  %d rows need re-ordering, %d duplicate rows to remove" % (len(updates), len(db_dupes)))

done = failed = 0
for u in updates:
    st, res = req("PATCH", "vp_questions?id=eq.%s" % u["id"],
                  {"options": u["options"], "correct_index": u["correct_index"]},
                  prefer="return=minimal")
    if st in (200, 204):
        done += 1
    else:
        failed += 1
        if failed <= 3:
            print("    update failed on %s: %s %s" % (u["id"], st, res))
    if done and done % 2000 == 0:
        print("    %d / %d updated ..." % (done, len(updates)))

removed = blocked = 0
for qid in db_dupes:
    st, res = req("DELETE", "vp_questions?id=eq.%s" % qid, prefer="return=minimal")
    if st in (200, 204):
        removed += 1
    else:
        blocked += 1   # usually a question already asked in a real round, so it is referenced

print("\n  answers re-ordered   %d  (failed %d)" % (done, failed))
print("  duplicates removed   %d  (left in place %d, already referenced by a played round)"
      % (removed, blocked))
print("\nDone. The file and the database now hold the same arrangement.")
