#!/usr/bin/env python3
"""Give every song its YEAR, take the studio baggage out of the titles it shows,
and hold each song once.

Dean, 31 Aug: "we should know what year all the songs were... all the songs need
to be ones that australians know."

THREE THINGS, all to the same file:

1. YEAR. song-years.py already asked the AU iTunes store for 5,119 of them and
   nothing ever merged the answers in, so the library shipped with no year at
   all. With it, the decade packs can be rebuilt from fact and the screen can
   say what year a song is.

   The year is the STORE's release date, so a remaster reads as the year it was
   remastered, not the year the song came out. That is fine for the packs (they
   were built from these same numbers) but it is why a Boston track reads 2026.

2. THE DISPLAYED TITLE. 123 songs are called things like "Get Down Tonight
   (2004 Remastered Version)". The card shows that whole string in a cell about
   a centimetre wide, and the fitter shrinks the words until it fits. Only the
   suffixes that name the SAME recording everyone knows are dropped: a Live,
   Acoustic, Remix or Radio Edit is a different recording and the host may have
   chosen it deliberately, so those stay exactly as they are.

3. ONE ROW PER SONG. The library held 15 songs twice, usually the original and
   its remaster, plus 7 exact duplicate ids. On a 60-song night that is a real
   chance of hearing the same song twice.

   Playlist ORDER IS PRESERVED. Every playlist is sorted most-known first and
   drawGameSet weights the draw by position, so a rebuild that reordered them
   would quietly undo the fix that made nights singable again.

Run: python3 venueplay-backend/tools/clean-library.py [--write]
"""
import collections
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
YEARS = os.path.join(ROOT, 'venueplay-backend', 'tools', 'song-years.jsonl')

DROP = re.compile(
    r'\s*[\(\[]\s*(?:\d{4}\s+)?(?:digital\s+)?(?:re-?master(?:ed)?(?:\s+\d{4})?(?:\s+version)?'
    r'|bonus\s+track|album\s+version|single\s+version|deluxe(?:\s+edition)?'
    r'|expanded\s+edition|stereo(?:\s+version)?)\s*[\)\]]', re.I)
# A different recording. Never touched.
KEEP = re.compile(r'\b(live|acoustic|remix|radio edit|demo|instrumental|karaoke)\b', re.I)

# A YEAR WE DO NOT BELIEVE IS WORSE THAN NO YEAR, because the decade packs get
# rebuilt from these numbers and a wrong one puts a song in front of the wrong
# room. The store hands back a COMPILATION's release date when it has nothing
# better, and it shows: 13 songs claim 1900, two claim 1913, and "The Sound of
# Silence" claims 1920. From 1955 the counts climb smoothly (7, 6, 12, 9, 8, 16,
# 13, 26, 29, 41, 42, 57, 66) like a real catalogue; below it they are scattered
# singletons around a spike of 13. That is a default value, not a distribution.
# The band is contaminated rather than merely old: "Ring of Fire" sits in it at
# 1947, and it is 1963.
MIN_YEAR = 1955


def clean_title(t):
    if KEEP.search(t):
        return t
    return re.sub(r'\s{2,}', ' ', DROP.sub('', t)).strip().rstrip(' -')


def main():
    write = '--write' in sys.argv
    lib = json.load(io.open(LIB, encoding='utf-8'))
    songs, playlists = lib['songs'], lib['playlists']

    years = {}
    for line in io.open(YEARS, encoding='utf-8'):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r.get('id') and r.get('year'):
            years[r['id']] = int(r['year'])

    # ---- 1. year, 2. title ----
    dated = retitled = 0
    for s in songs:
        y = years.get(s['id'])
        if y and y < MIN_YEAR:
            y = None
        if y and not s.get('year'):
            s['year'] = y
            dated += 1
        t = clean_title(s['title'])
        if t and t != s['title']:
            s['title'] = t
            retitled += 1

    # ---- 2b. forget the years we do not believe ----
    forgot = 0
    for s in songs:
        if s.get('year') and s['year'] < MIN_YEAR:
            del s['year']
            forgot += 1

    # ---- 3. one row per song ----
    # Keep the FIRST occurrence, so position (and therefore how well known the
    # library says a song is) is never disturbed. Later copies redirect to it.
    keep, redirect, seen = [], {}, {}
    for s in songs:
        k = (s['title'].lower(), s['artist'].lower())
        first = seen.get(k)
        if first is None and s['id'] not in redirect:
            seen[k] = s['id']
            keep.append(s)
            continue
        target = first or s['id']
        redirect[s['id']] = target
        # A survivor missing a preview but the copy has one: take it.
        surv = next(x for x in keep if x['id'] == target)
        if not surv.get('previewUrl') and s.get('previewUrl'):
            surv['previewUrl'] = s['previewUrl']
        if not surv.get('year') and s.get('year'):
            surv['year'] = s['year']

    valid = {s['id'] for s in keep}
    moved = dropped = 0
    for p in playlists:
        out, been = [], set()
        for i in p['songIds']:
            j = redirect.get(i, i)
            if j != i:
                moved += 1
            if j in valid and j not in been:
                been.add(j)
                out.append(j)
            else:
                dropped += 1
        p['songIds'] = out

    lib['songs'] = keep
    print('songs        %d -> %d   (%d duplicate row(s) merged)' % (len(songs), len(keep), len(songs) - len(keep)))
    print('years added  %d   (%d song(s) still have none)' % (dated, sum(1 for s in keep if not s.get('year'))))
    print('titles tidied %d' % retitled)
    print('years dropped as not believable %d  (before %d)' % (forgot, MIN_YEAR))
    print('playlist entries repointed %d, removed as duplicates %d' % (moved, dropped))

    left = 0
    for p in playlists:
        c = collections.Counter(x.lower() for x in
                                (next(s for s in keep if s['id'] == i)['title'] for i in p['songIds']))
        left += sum(1 for v in c.values() if v > 1)
    print('packs still showing one title twice: %d  (different songs that share a name)' % left)

    if not write:
        print('\ndry run. --write to save.')
        return
    tmp = LIB + '.tmp'
    # COMPACT, like the file we were handed. Every phone at the party downloads
    # this on join, and pretty-printing it put 289 KB back on pub wifi for
    # whitespace nobody reads.
    io.open(tmp, 'w', encoding='utf-8').write(
        json.dumps(lib, ensure_ascii=False, separators=(',', ':')))
    os.replace(tmp, LIB)
    print('\nwritten', LIB)


main()
