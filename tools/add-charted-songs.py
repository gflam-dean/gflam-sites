#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADD CHARTED SONGS TO THE MUSICAL BINGO LIBRARY.

   Dean asked on 8 September 2026 whether an agent could read the charts and find
   the songs the library was missing. This applies the answer.

   It is ADD ONLY. It never reorders a pack, never removes a song and never
   rewrites a pack list, because the packs were hand ranked most known first on
   8 September and the host page deals sixty songs weighted toward the front of
   that order. Everything new goes on the END of a pack, where it lengthens the
   night without pushing a banger out of the deal.

   The plan file holds the decisions, the tool holds none:

     new_songs        [song objects]              resolved from the iTunes AU store
     pack_additions   {playlist name: [song id]}  ids to append, in order

   The key is pack_additions, NOT packs, on purpose. curate-songs.py reads a
   `packs` key and REPLACES each list with it. Naming this one differently means
   the two plans can never be fed to the wrong tool.

   Run from the repo root:
       python3 tools/add-charted-songs.py
       python3 tools/add-charted-songs.py venueplay/data/some-other-plan.json
   Then:
       python3 tools/release-check.py --local
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
DEFAULT_PLAN = os.path.join(ROOT, 'venueplay', 'data',
                            'song-charts-2026-09-09.json')
BACKUP = os.path.join(ROOT, 'venueplay', 'data',
                      'musical-library.backup-2026-09-09-pre-charts.json')


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def main(argv):
    plan_path = argv[1] if len(argv) > 1 else DEFAULT_PLAN
    if not os.path.exists(plan_path):
        print('no plan file at %s' % plan_path)
        return 1
    lib = load(LIB)
    plan = load(plan_path)
    songs = lib['songs']
    by_id = {s['id']: s for s in songs}
    before_count = len(songs)

    # 1. The backup, written once and never overwritten, so a second run cannot
    #    destroy the state the first run started from.
    if not os.path.exists(BACKUP):
        save(BACKUP, lib)
        print('backup written  %s' % os.path.basename(BACKUP))
    else:
        print('backup already there  %s' % os.path.basename(BACKUP))

    # 2. New songs. A song with no preview clip is thirty seconds of silence on
    #    the TV, so it is refused here as well as in the plan builder.
    added, skipped = 0, 0
    seen_ta = set()
    for s in songs:
        seen_ta.add((s['title'].strip().lower(), s['artist'].strip().lower()))
    for s in plan.get('new_songs', []):
        clean = dict((k, v) for k, v in s.items() if not k.startswith('_'))
        if clean['id'] in by_id:
            skipped += 1
            continue
        ta = (clean['title'].strip().lower(), clean['artist'].strip().lower())
        if ta in seen_ta:
            print('SKIPPED (already held under another id)  %s - %s'
                  % (clean['title'], clean['artist']))
            skipped += 1
            continue
        if not clean.get('previewUrl') or not clean.get('year'):
            print('SKIPPED (no audio or no year)  %s - %s'
                  % (clean['title'], clean['artist']))
            skipped += 1
            continue
        songs.append(clean)
        by_id[clean['id']] = clean
        seen_ta.add(ta)
        added += 1
    print('songs added: %d   songs skipped: %d' % (added, skipped))

    # 3. Pack additions, appended to the end of each list. The same three guards
    #    curate-songs.py uses apply here: a decade pack holds its decade only, a
    #    song id appears once, and two songs that READ the same on a card are one
    #    square, so the second is dropped.
    before = dict((p['name'], len(p['songIds'])) for p in lib['playlists'])
    strays, dupes = [], 0
    for p in lib['playlists']:
        extra = plan.get('pack_additions', {}).get(p['name'])
        if not extra:
            continue
        have_ids = set(p['songIds'])
        have_titles = set()
        for sid in p['songIds']:
            s = by_id.get(sid)
            if s:
                have_titles.add(flat_title(s['title']))
        m = re.search(r'(\d{2})s\b', p['name'])
        decade = None
        if m:
            d = int(m.group(1))
            decade = 1900 + d if d >= 50 else 2000 + d
        for sid in extra:
            s = by_id.get(sid)
            if not s:
                print('MISSING song id in plan, dropped: %s -> %s' % (p['name'], sid))
                continue
            if sid in have_ids:
                dupes += 1
                continue
            if decade is not None:
                y = s.get('year')
                if not y or not (decade <= int(str(y)[:4]) < decade + 10):
                    strays.append('%s: %s (%s)' % (p['name'], s['title'], y or 'undated'))
                    continue
            t = flat_title(s['title'])
            if t and t in have_titles:
                dupes += 1
                continue
            if t:
                have_titles.add(t)
            have_ids.add(sid)
            p['songIds'].append(sid)
    print('pack entries skipped as already there or a repeated title: %d' % dupes)
    if strays:
        print('decade strays dropped by the safety net: %d  (%s)'
              % (len(strays), '; '.join(strays[:5])))
    else:
        print('decade strays dropped by the safety net: 0')

    note = lib.get('note', '')
    stamp = ('charted additions 2026-09-09 (ARIA and Kent year-end top 25, '
             'Australian number ones, triple j all time countdowns)')
    if stamp not in note:
        lib['note'] = (note + ' | ' + stamp) if note else stamp

    save(LIB, lib)

    print('')
    print('%-16s %7s %7s %7s' % ('pack', 'before', 'added', 'after'))
    total_added = 0
    for p in lib['playlists']:
        after = len(p['songIds'])
        gain = after - before[p['name']]
        total_added += gain
        print('%-16s %7d %7d %7d' % (p['name'], before[p['name']], gain, after))
    print('')
    print('pack places added: %d' % total_added)
    print('library was %d songs, now %d' % (before_count, len(lib['songs'])))
    return 0


def flat_title(title):
    return re.sub(r'[^a-z0-9]', '',
                  re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', '', title.lower()))


if __name__ == '__main__':
    sys.exit(main(sys.argv))
