#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PROVE NOTHING WAS LOST.

   Every tool in this set is add only or reorder only, and every one of them says
   so in its own docstring. A docstring is a claim. This is the check.

   It compares the library against a backup taken before the work started and
   fails loudly if any of these is not true:

     1. every song id in the backup is still in the library
     2. every song a pack held is still in that pack
     3. no song id appears twice in the library
     4. no song id appears twice in one pack
     5. every id in every pack is a real song
     6. every song still has a preview clip

   It does NOT check that pack ORDER is unchanged, because reordering is the
   point of tools/lift-charted-songs.py. Losing a song is the thing that must
   never happen, so that is what is proved.

   Run from the repo root:

       python3 tools/prove-song-additions.py
       python3 tools/prove-song-additions.py venueplay/data/musical-library.backup-2026-09-10-pre-round2.json
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'venueplay', 'data')
LIB = os.path.join(D, 'musical-library.json')
DEFAULT_BACKUP = os.path.join(D, 'musical-library.backup-2026-09-10-pre-round2.json')


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def main(argv):
    backup_path = argv[1] if len(argv) > 1 else DEFAULT_BACKUP
    lib = load(LIB)
    old = load(backup_path)
    fails = []

    def check(name, ok_, detail=''):
        print('%-52s %s%s' % (name, 'PASS' if ok_ else 'FAIL',
                              ('  ' + detail) if detail else ''))
        if not ok_:
            fails.append(name)

    new_ids = [s['id'] for s in lib['songs']]
    new_set = set(new_ids)
    old_ids = [s['id'] for s in old['songs']]
    lost = [i for i in old_ids if i not in new_set]
    check('every song in the backup is still in the library', not lost,
          '%d songs before, %d now' % (len(old_ids), len(new_ids))
          if not lost else 'LOST: ' + ', '.join(lost[:5]))

    check('no song id is in the library twice', len(new_ids) == len(new_set),
          '%d ids' % len(new_ids))

    old_packs = dict((p['name'], set(p['songIds'])) for p in old['playlists'])
    dropped = []
    dupes = []
    dangling = []
    grew = 0
    for p in lib['playlists']:
        cur = p['songIds']
        if len(cur) != len(set(cur)):
            dupes.append(p['name'])
        for i in cur:
            if i not in new_set:
                dangling.append('%s: %s' % (p['name'], i))
        was = old_packs.get(p['name'], set())
        missing = was - set(cur)
        if missing:
            dropped.append('%s lost %d' % (p['name'], len(missing)))
        grew += len(cur) - len(was)
    check('every pack kept every song it held', not dropped,
          '%d pack places added' % grew if not dropped else '; '.join(dropped))
    check('no pack holds a song twice', not dupes,
          '' if not dupes else ', '.join(dupes))
    check('every id in every pack is a real song', not dangling,
          '' if not dangling else '; '.join(dangling[:5]))

    noaudio = [s['id'] for s in lib['songs'] if not s.get('previewUrl')]
    check('every song still has a preview clip', not noaudio,
          '' if not noaudio else '%d with no clip' % len(noaudio))

    print('')
    print('%d checks, %d failed' % (6, len(fails)))
    print('backup: %s' % os.path.basename(backup_path))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
