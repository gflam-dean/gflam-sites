#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""HOW OFTEN DOES A SONG ACTUALLY GET DEALT?

   Every claim about pack order in this project is measured with this file,
   never asserted. It reproduces drawGameSet from venueplay/app/musical/host.html
   exactly:

     - 60 songs a game (GAME_SONGS)
     - position i is weighted 1 / (1 + i / 45) (HITS_ALPHA), the "hits only"
       setting the host page ships with on
     - picks are drawn one at a time without replacement, proportional to weight
     - a pick whose lowercase letters-and-digits title is already on the card is
       thrown away and does not count toward the 60

   The draw is simulated with the exponential race, which is the standard
   identity for successive weighted sampling without replacement: give every
   song a key of Exp(1) / weight and read them in increasing key order, and the
   order you get has exactly the same distribution as the JavaScript loop. That
   matters because the honest way, walking a running total for every one of the
   60 picks, is a thousand times slower and this file is run on twenty packs.

   Used as a library by tools/lift-charted-songs.py and tools/prune-candidates.py.
   Run directly to print the deal rate of one pack:

       python3 tools/song-draw-sim.py "Pub Classics" 1500
"""
import io
import json

import os
import random
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')

GAME_SONGS = 60
HITS_ALPHA = 45.0
NON_ALNUM = re.compile(r'[^a-z0-9]')


def norm_title(t):
    return NON_ALNUM.sub('', (t or '').lower())


def deal_rates(song_ids, titles, games=1500, seed=20260910):
    """Fraction of games in which each id is dealt. Returns {id: rate}."""
    n = len(song_ids)
    w = [1.0 / (1.0 + i / HITS_ALPHA) for i in range(n)]
    keys_scale = [1.0 / x for x in w]
    tnorm = [norm_title(titles.get(sid, '')) for sid in song_ids]
    hits = [0] * n
    rng = random.Random(seed)
    expo = rng.expovariate
    order = list(range(n))
    for _ in range(games):
        k = [expo(1.0) * keys_scale[i] for i in range(n)]
        order.sort(key=k.__getitem__)
        seen = set()
        got = 0
        for pos in order:
            t = tnorm[pos]
            if t:
                if t in seen:
                    continue
                seen.add(t)
            hits[pos] += 1
            got += 1
            if got >= GAME_SONGS:
                break
        order = list(range(n))
    return dict((song_ids[i], hits[i] / float(games)) for i in range(n))


def load_library(path=LIB):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def title_map(lib):
    return dict((s['id'], s.get('title', '')) for s in lib['songs'])


def main():
    lib = load_library()
    titles = title_map(lib)
    want = sys.argv[1] if len(sys.argv) > 1 else 'Pub Classics'
    games = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
    for p in lib['playlists']:
        if p['name'].lower() == want.lower():
            r = deal_rates(p['songIds'], titles, games)
            avg = sum(r.values()) / len(r)
            print('%s: %d songs, average deal rate %.1f%%' % (p['name'], len(r), 100 * avg))
            top = sorted(r.items(), key=lambda kv: -kv[1])[:5]
            for sid, rate in top:
                print('  %-50s %.1f%%' % (sid[:50], 100 * rate))
            return 0
    print('no pack called %s' % want)
    return 1


if __name__ == '__main__':
    sys.exit(main())
