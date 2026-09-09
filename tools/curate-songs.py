#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""APPLY THE SONG CURATION TO THE MUSICAL BINGO LIBRARY.

   Dean's note on 8 Sep 2026: "I asked for the bangers that we would have heard in
   Australia, not something we haven't heard of, for each category" and "I feel some
   of the songs in there are awful."

   He was right. A bulk load of 12,880 "singalong tracks" on 10 Aug 2026 poured
   whatever iTunes returned onto the end of every playlist, so Pub Classics finished
   on Buffalo Traffic Jam and Charley Crockett and the Aussie pack finished on Earl
   Thomas Conley and The Wiggles. The host page deals sixty songs a game weighted
   toward the front of a list, so the tail was not harmless: turn the hits weighting
   off, or run a long night, and the room gets songs nobody in it has heard.

   This tool does not decide anything. Every decision lives in the data file beside
   the library, venueplay/data/song-curation-2026-09-08.json, so the change can be
   read, argued with and re-run:

     packs       {playlist name: [song id, ...]}  the new list, most-known first
     new_songs   [song objects]                   bangers the library did not have,
                                                  resolved from the iTunes AU store
     year_fixes  {song id: year}                  wrong years that put a song in the
                                                  wrong decade pack

   Songs cut from a playlist STAY in the songs array. Nothing is deleted, so putting
   one back is a one-line edit to the data file, not a re-import.

   Run from the repo root:   python3 tools/curate-songs.py
   Then:                     python3 tools/release-check.py --local
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
PLAN = os.path.join(ROOT, 'venueplay', 'data', 'song-curation-2026-09-08.json')
BACKUP = os.path.join(ROOT, 'venueplay', 'data',
                      'musical-library.backup-2026-09-08-pre-curate.json')


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def main():
    lib = load(LIB)
    plan = load(PLAN)
    songs = lib['songs']
    by_id = {s['id']: s for s in songs}

    # 1. The backup. Taken before anything is written, and never overwritten if it
    #    is already there, so a second run cannot destroy the original.
    if not os.path.exists(BACKUP):
        save(BACKUP, lib)
        print('backup written  %s' % os.path.basename(BACKUP))
    else:
        print('backup already there  %s' % os.path.basename(BACKUP))

    # 2. New songs. A song id is the kebab-case of "title-artist", the style the
    #    library already uses, so a song that is somehow already here is reused
    #    rather than added twice.
    added = 0
    for s in plan.get('new_songs', []):
        if s['id'] in by_id:
            continue
        if not s.get('previewUrl') or not s.get('year'):
            print('SKIPPED (no audio or no year)  %s - %s' % (s['title'], s['artist']))
            continue
        songs.append(s)
        by_id[s['id']] = s
        added += 1
    print('songs added: %d' % added)

    # 3. Exact duplicates: two rows for the same title AND artist. The gate calls
    #    that "a song held twice"; on a card it is two squares that read the same.
    seen, dupes = {}, []
    keep_songs = []
    for s in songs:
        key = (s['title'].strip().lower(), s['artist'].strip().lower())
        if key in seen:
            dupes.append('%s - %s' % (s['title'], s['artist']))
            continue
        seen[key] = s['id']
        keep_songs.append(s)
    songs = keep_songs
    by_id = {s['id']: s for s in songs}
    lib['songs'] = songs
    if dupes:
        print('exact duplicates removed: %d  (%s)' % (len(dupes), '; '.join(dupes[:5])))
    else:
        print('exact duplicates removed: 0')

    # 4. Years. A wrong year is invisible until a punter shouts it out: the library
    #    had "Don't Stop 'Til You Get Enough" as 1966 and "We Didn't Start the Fire"
    #    as 1966, both from the release date of some compilation.
    fixed = 0
    for sid, year in plan.get('year_fixes', {}).items():
        s = by_id.get(sid)
        if s and s.get('year') != year:
            s['year'] = year
            fixed += 1
    print('years corrected: %d' % fixed)

    # 5. The playlists themselves.
    before = {p['name']: len(p['songIds']) for p in lib['playlists']}
    strays = []
    for p in lib['playlists']:
        new = plan['packs'].get(p['name'])
        if new is None:
            print('NO PLAN for playlist %s, left alone' % p['name'])
            continue
        out, seen_ids, seen_titles = [], set(), set()
        m = re.search(r'(\d{2})s\b', p['name'])
        decade = None
        if m:
            d = int(m.group(1))
            decade = 1900 + d if d >= 50 else 2000 + d
        for sid in new:
            s = by_id.get(sid)
            if not s:
                print('MISSING song id in plan, dropped: %s -> %s' % (p['name'], sid))
                continue
            if sid in seen_ids:
                continue
            # A decade pack holds its decade and nothing else. This is a safety net
            # under the plan, not a second opinion: if it ever fires, the plan and
            # the years have drifted apart and the line below says which song.
            if decade is not None:
                y = s.get('year')
                if not y or not (decade <= int(str(y)[:4]) < decade + 10):
                    strays.append('%s: %s (%s)' % (p['name'], s['title'], y or 'undated'))
                    continue
            # The card shows titles only, so two songs that read the same are a
            # coin flip for the room and a certainty for the Worker.
            t = re.sub(r'[^a-z0-9]', '', re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', '',
                                                s['title'].lower()))
            if t and t in seen_titles:
                continue
            if t:
                seen_titles.add(t)
            seen_ids.add(sid)
            out.append(sid)
        p['songIds'] = out
    if strays:
        print('decade strays dropped by the safety net: %d  (%s)'
              % (len(strays), '; '.join(strays[:5])))
    else:
        print('decade strays dropped by the safety net: 0')

    note = lib.get('note', '')
    stamp = ('curated for Australian pub recognition 2026-09-08 '
             '(ARIA year-end, Australian number ones, triple j Hottest 100)')
    if stamp not in note:
        lib['note'] = (note + ' | ' + stamp) if note else stamp
    lib['version'] = lib.get('version', 1)

    save(LIB, lib)

    print('')
    print('%-16s %7s %7s' % ('pack', 'before', 'after'))
    for p in lib['playlists']:
        print('%-16s %7d %7d' % (p['name'], before[p['name']], len(p['songIds'])))
    print('')
    print('library now holds %d songs' % len(lib['songs']))
    short = [p['name'] for p in lib['playlists'] if len(p['songIds']) < 180]
    if short:
        print('UNDER THE 180 FLOOR: %s' % ', '.join(short))
    return 0


if __name__ == '__main__':
    sys.exit(main())
