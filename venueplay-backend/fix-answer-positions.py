#!/usr/bin/env python3
"""One-time repair: shuffle every question's options so the correct answer isn't
always Answer A. The bulk "VenuePlay Original" batch was generated with the correct
answer first (correct_index=0) ~90% of the time, so pulled rounds came out all-A.

Shuffle is deterministic per question (seeded by the question id), so re-running is
stable and idempotent-ish. We identify the correct option by value (options[correctIndex])
BEFORE shuffling, then re-point correctIndex to its new slot afterwards.
"""
import json, os, random, collections

LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "trivia-library.json")

d = json.load(open(LIB, encoding="utf-8"))
rows = d.get("questions") if isinstance(d, dict) else d

fixed = 0
skipped = 0
before = collections.Counter()
after = collections.Counter()

for r in rows:
    opts = r.get("options")
    ci = r.get("correctIndex")
    if not (isinstance(opts, list) and len(opts) == 4 and isinstance(ci, int) and 0 <= ci < 4):
        skipped += 1
        continue
    before[ci] += 1
    correct_val = opts[ci]
    # deterministic per-question shuffle
    rnd = random.Random(str(r.get("id", "")) + "|" + r.get("question", ""))
    new_opts = opts[:]
    rnd.shuffle(new_opts)
    new_ci = new_opts.index(correct_val)   # duplicates equal anyway
    r["options"] = new_opts
    r["correctIndex"] = new_ci
    if "answer" in r:
        r["answer"] = correct_val   # keep the answer field truthful
    after[new_ci] += 1
    if new_ci != ci:
        fixed += 1

print("rows:", len(rows), "| repositioned:", fixed, "| skipped(malformed):", skipped)
print("BEFORE correctIndex dist:", {k: before[k] for k in sorted(before)})
print("AFTER  correctIndex dist:", {k: after[k] for k in sorted(after)})

json.dump(d, open(LIB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", LIB)
