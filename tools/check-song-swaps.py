#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PROVE THE VERSION SWAP DID NOT BREAK THE SONG LIBRARY.

   tools/swap-song-versions.py replaces the recording behind a song without
   touching its id, and may append a second recording to the end of a pack. Both
   of those are safe only if nothing else moved, so this reads the dated backup
   taken before the run and the library as it stands now, and refuses to pass
   unless all five of these hold:

     1. no song id was lost
     2. no pack got shorter
     3. no existing pack position moved: what a pack held before is still the
        first part of what it holds now, in the same order
     4. every id in every pack is a song that exists
     5. every song whose recording changed answers HTTP 200 on its preview clip,
        which is the thirty seconds the pub actually hears

   Run it after the swap:

       python3 tools/check-song-swaps.py
       python3 tools/check-song-swaps.py --quick          skip the clip fetches
       python3 tools/check-song-swaps.py --lib X --backup Y   check other copies

   The --lib and --backup arguments exist so the check can be proved: break a
   scratch copy of the library on purpose and this must go red. A check that
   cannot fail is worse than no check.
"""
import io
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'venueplay', 'data')
LIB = os.path.join(DATA, 'musical-library.json')
BACKUP = os.path.join(DATA, 'musical-library.backup-2026-09-10-pre-versionswap.json')
UA = 'VenuePlay-song-check/1.0 (contact: dean.tindale@outlook.com)'

GREEN, RED, DIM, OFF = '\033[32m', '\033[31m', '\033[2m', '\033[0m'
fails = [0]


def ok(name, good, note='', why=''):
    print('  %s%s%s   %-52s %s%s%s'
          % (GREEN if good else RED, 'ok' if good else 'NO', OFF, name,
             DIM, note if good else why, OFF))
    if not good:
        fails[0] += 1


def clip_ok(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA,
                                                   'Range': 'bytes=0-1023'})
        r = urllib.request.urlopen(req, timeout=20)
        return r.status in (200, 206)
    except Exception:  # noqa: BLE001
        return False


def arg(flag, default):
    if flag in sys.argv:
        return sys.argv[sys.argv.index(flag) + 1]
    return default


def main():
    lib_path, back_path = arg('--lib', LIB), arg('--backup', BACKUP)
    lib = json.load(io.open(lib_path, encoding='utf-8'))
    old = json.load(io.open(back_path, encoding='utf-8'))
    now = {s['id']: s for s in lib['songs']}
    before = {s['id']: s for s in old['songs']}
    packs_now = {p['id']: p for p in lib['playlists']}

    print('\nThe song library after the version swap')
    print('  library %s\n  backup  %s\n' % (lib_path, back_path))

    lost = [i for i in before if i not in now]
    ok('no song id was lost', not lost,
       '%d songs before, %d now' % (len(before), len(now)),
       why='%d gone: %s' % (len(lost), ', '.join(lost[:3])))

    shorter, moved, missing_pack = [], [], []
    for p in old['playlists']:
        cur = packs_now.get(p['id'])
        if cur is None:
            missing_pack.append(p['name'])
            continue
        if len(cur['songIds']) < len(p['songIds']):
            shorter.append('%s %d -> %d' % (p['name'], len(p['songIds']),
                                            len(cur['songIds'])))
        elif cur['songIds'][:len(p['songIds'])] != p['songIds']:
            n = next((i for i, s in enumerate(p['songIds'])
                      if cur['songIds'][i] != s), 0)
            moved.append('%s at position %d' % (p['name'], n + 1))
    ok('every pack is still there', not missing_pack,
       '%d packs' % len(old['playlists']), why=', '.join(missing_pack[:3]))
    ok('no pack got shorter', not shorter, why='; '.join(shorter[:3]))
    ok('no existing pack position moved', not moved, why='; '.join(moved[:3]))

    broken = [(p['name'], i) for p in lib['playlists'] for i in p['songIds']
              if i not in now]
    ok('every pack points at a song that exists', not broken,
       why='; '.join('%s -> %s' % b for b in broken[:3]))

    changed = [i for i, s in now.items()
               if i in before and s.get('previewUrl') != before[i].get('previewUrl')]
    added = [i for i in now if i not in before]
    noclip = [i for i in changed + added if not now[i].get('previewUrl')]
    ok('every changed or added song has a clip', not noclip,
       '%d changed, %d added' % (len(changed), len(added)),
       why='%d with no clip: %s' % (len(noclip), ', '.join(noclip[:3])))

    if '--quick' in sys.argv:
        print('  %s..%s   the clip fetches were skipped (--quick)' % (DIM, OFF))
    else:
        bad = []
        for n, i in enumerate(changed + added, 1):
            url = now[i].get('previewUrl')
            if not url or not clip_ok(url):
                bad.append(now[i].get('title', i))
            sys.stdout.write('\r  fetching clip %d of %d   '
                             % (n, len(changed) + len(added)))
            sys.stdout.flush()
        sys.stdout.write('\r' + ' ' * 40 + '\r')
        ok('every changed or added clip answers 200', not bad,
           '%d clips fetched' % (len(changed) + len(added)),
           why='%d dead: %s' % (len(bad), ', '.join(bad[:3])))

    print('\n%s\n' % ('All checks passed.' if not fails[0]
                      else '%d CHECK%s FAILED.' % (fails[0],
                                                   '' if fails[0] == 1 else 'S')))
    return 1 if fails[0] else 0


if __name__ == '__main__':
    sys.exit(main())
