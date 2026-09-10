#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SWAP A WRONG RECORDING FOR THE ONE AUSTRALIA ACTUALLY KNOWS.

   Musical bingo plays thirty seconds and asks the room to name it. If the
   library holds Sorrow by Bad Religion instead of David Bowie, or Little Lion
   Man by a lullaby covers project instead of Mumford & Sons, the tune is close
   enough to look right on the card and wrong enough that nobody gets it.

   This tool reads venueplay/data/song-recording-fixes-2026-09-10.json, which
   holds one decision per song and the reason for it, resolves the correct
   recording on the iTunes AU store through tools/itunes-au.py, and swaps the
   recording IN PLACE. The song keeps its id and therefore keeps its exact
   position in every pack it sits in. Only artist, previewUrl, artworkUrl and
   year change, plus the title where the old title carried a cover marker.

   Nothing is ever deleted. If the store has no preview clip for the correct
   recording the song is LEFT EXACTLY AS IT WAS and listed at the end, because
   a song with no clip is thirty seconds of silence on the TV.

   Safe to run twice: a song whose artist already matches the decision is
   reported as done and skipped.

   Run from the repo root:  python3 tools/fix-song-recordings.py
   Then:                    python3 tools/release-check.py --local
"""
import importlib.util
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'venueplay', 'data')
LIB = os.path.join(D, 'musical-library.json')
FIXES = os.path.join(D, 'song-recording-fixes-2026-09-10.json')

_spec = importlib.util.spec_from_file_location(
    'itunes_au', os.path.join(ROOT, 'tools', 'itunes-au.py'))
itunes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(itunes)


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def main():
    lib = load(LIB)
    plan = load(FIXES)
    by_id = dict((s['id'], s) for s in lib['songs'])
    packs = dict((p['name'], p['songIds']) for p in lib['playlists'])

    swapped, already, noclip, missing = [], [], [], []
    for fx in plan['fixes']:
        s = by_id.get(fx['id'])
        if s is None:
            missing.append(fx['id'])
            continue
        where = [n for n, ids in packs.items() if fx['id'] in ids]
        if itunes.norm_artist(s['artist']) == itunes.norm_artist(fx['correct_artist']):
            already.append((fx['id'], s['artist']))
            continue
        got = itunes.resolve(fx.get('correct_title_hint') or fx['title'],
                             fx['correct_artist'])
        if not got or not got.get('previewUrl') or not got.get('year'):
            noclip.append((fx['id'], s['artist'], fx['correct_artist']))
            continue
        old = (s['artist'], s.get('year'), s['title'])
        s['artist'] = got['artist']
        s['previewUrl'] = got['previewUrl']
        s['artworkUrl'] = got['artworkUrl']
        s['year'] = got['year']
        if fx.get('retitle'):
            s['title'] = got['title']
        swapped.append((fx['id'], old, (s['artist'], s['year'], s['title']), where))

    if swapped:
        note = lib.get('note', '')
        stamp = 'wrong recordings swapped for the Australian version 2026-09-10'
        if stamp not in note:
            lib['note'] = (note + ' | ' + stamp) if note else stamp
        save(LIB, lib)

    for sid, old, new, where in swapped:
        print('SWAPPED %s' % sid)
        print('        was  %s (%s)' % (old[0], old[1]))
        print('        now  %s (%s)  %s' % (new[0], new[1], new[2]))
        print('        packs: %s' % (', '.join(where) if where else 'none'))
    for sid, art in already:
        print('ALREADY DONE  %s is %s' % (sid, art))
    for sid, held, want in noclip:
        print('LEFT ALONE, no preview clip for %s  %s (still %s)'
              % (want, sid, held))
    for sid in missing:
        print('NOT IN LIBRARY  %s' % sid)
    print('')
    print('%d swapped, %d already right, %d left alone with no clip, %d not found'
          % (len(swapped), len(already), len(noclip), len(missing)))
    print('library holds %d songs' % len(lib['songs']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
