#!/usr/bin/env python3
"""ALL THE HITS (Dean, 6 Nov 2026, setup wizard round 3: "a Most popular / All the hits playlist, the top ~1000 songs,
as the first choice"). Every playlist in venueplay/data/musical-library.json is already ordered by how well known each
track is (musical/host.html, "WHY A NIGHT FULL OF SONGS NOBODY KNEW"), so the hits are the top of every list: this takes
them in turns, rank 1 of every list, then rank 2 of every list, and so on, each song once, until there are HITS songs.
The Pride list is left out (its own night). The playlist goes FIRST in the library as id "all-the-hits".
Safe to run again: it rebuilds the list in place.   python3 tools/make-hits-playlist.py"""
import json, os, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "venueplay", "data", "musical-library.json")
HITS, ID, NAME, SKIP = 1000, "all-the-hits", "All the hits", {"pride"}
d = json.load(open(P), object_pairs_hook=collections.OrderedDict)
known = {s["id"] for s in d["songs"] if s.get("hidden") is not True}   # a hidden song (Dean 16 Nov 2026: rude titles) is never a hit
lists = [p for p in d["playlists"] if p["id"] != ID and p["id"] not in SKIP]
out, seen, rank = [], set(), 0
while len(out) < HITS and any(rank < len(p["songIds"]) for p in lists):
    for p in lists:
        if rank < len(p["songIds"]):
            sid = p["songIds"][rank]
            if sid in known and sid not in seen:
                seen.add(sid); out.append(sid)
                if len(out) >= HITS: break
    rank += 1
hits = collections.OrderedDict([("id", ID), ("name", NAME), ("songIds", out)])
d["playlists"] = [hits] + [p for p in d["playlists"] if p["id"] != ID]
with open(P, "w") as f: json.dump(d, f, ensure_ascii=False, indent=1)   # the library's own layout
print("%s: %d songs, the top %d of %d lists" % (NAME, len(out), rank, len(lists)))
