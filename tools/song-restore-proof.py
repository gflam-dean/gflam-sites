#!/usr/bin/env python3
"""DID THE RESTORE PUT SONGS BACK WITHOUT MOVING ANYTHING ELSE?

    python3 tools/song-restore-proof.py BEFORE.json AFTER.json PLAN.json

The 8 September curation dropped 252 well known songs out of every pack. Putting them
back is only safe if three things are true, and this proves all three against the real
files rather than trusting the script that did the work.

  1. No song is lost and no song is quietly changed. Same ids, same titles, artists,
     clips and artwork.
  2. Nothing already in a pack moves. The host deals 60 songs a game weighted towards
     the front, so an insert would change what every venue hears. Every restored song
     must sit at the END of its pack, so the first N ids of each pack must be identical
     before and after.
  3. Every restored song plays. A dead preview is silence in a pub. Each one is checked
     with a live HEAD request unless a clip report is supplied.

Exit code 0 green, 1 red.
"""
import io, json, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

UA = 'VenuePlay-restore-proof/1.0 (contact: dean.tindale@outlook.com)'
FAILED = []

RAN = []

def ok(name, good, detail='', why=''):
    RAN.append(name)
    print(('  PASS  ' if good else '  FAIL  ') + name + (('   ' + detail) if detail else ''))
    if not good:
        if why: print('        ' + why)
        FAILED.append(name)

def head(url):
    if not url: return 'no url'
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA}), timeout=20)
        return r.status
    except urllib.error.HTTPError as x:
        return x.code
    except Exception as e:
        return type(e).__name__

def load(p): return json.load(io.open(p, encoding='utf-8'))

def main():
    before, after, planp = sys.argv[1], sys.argv[2], sys.argv[3]
    b, a, plan = load(before), load(after), load(planp)
    sep = load(plan['pack_history_file'])          # the 8 Sep library, the only authority on where a song used to sit
    restore = plan['restore']                      # id -> list of pack ids
    held = {h['id'] for h in plan['held_metal']}

    bs = {s['id']: s for s in b['songs']}
    as_ = {s['id']: s for s in a['songs']}
    bp = {p['id']: p['songIds'] for p in b['playlists']}
    ap = {p['id']: p['songIds'] for p in a['playlists']}
    sp = {p['id']: set(p['songIds']) for p in sep['playlists']}

    print('\nsong restore proof')
    print('  before %s' % before)
    print('  after  %s\n' % after)

    ok('no song id is lost or invented', set(bs) == set(as_),
       '%d songs' % len(as_),
       why='lost %s; new %s' % (sorted(set(bs) - set(as_))[:3], sorted(set(as_) - set(bs))[:3]))

    changed = [i for i in set(bs) & set(as_) if bs[i] != as_[i]]
    ok('no song record is changed', not changed, why='%d changed: %s' % (len(changed), changed[:3]))

    ok('no pack appears or disappears', set(bp) == set(ap),
       '%d packs' % len(ap), why='%s' % sorted(set(bp) ^ set(ap))[:3])

    moved = [pid for pid in bp if ap.get(pid, [])[:len(bp[pid])] != bp[pid]]
    ok('no existing song moves position', not moved,
       'first %d ids of every pack identical' % min(len(v) for v in bp.values()),
       why='packs whose opening order changed: %s' % moved[:3])

    added = {pid: ap[pid][len(bp[pid]):] for pid in bp if pid in ap}
    flat = [(pid, i) for pid, ids in added.items() for i in ids]
    ok('everything added was on the restore list', all(i in restore and pid in restore[i] for pid, i in flat),
       '%d appended' % len(flat),
       why='not planned: %s' % [x for x in flat if x[1] not in restore or x[0] not in restore[x[1]]][:3])

    ok('everything added was in that pack on 8 September',
       all(i in sp.get(pid, set()) for pid, i in flat),
       why='%s' % [x for x in flat if x[1] not in sp.get(x[0], set())][:3])

    missing = [(pid, i) for i, pids in restore.items() for pid in pids if i not in added.get(pid, [])]
    ok('every planned restore actually landed', not missing, why='%s' % missing[:3])

    dupes = [pid for pid, ids in ap.items() if len(ids) != len(set(ids))]
    ok('no pack holds the same song twice', not dupes, why='%s' % dupes[:3])

    inpack = set()
    for ids in ap.values(): inpack.update(ids)
    stillout = sorted(held & inpack)
    ok('no metal song is put into a general pack', not stillout,
       '%d held back' % len(held), why='%s' % stillout[:3])

    ok('every song a pack points at exists', all(i in as_ for ids in ap.values() for i in ids),
       why='%s' % [i for ids in ap.values() for i in ids if i not in as_][:3])

    # Clips. A restored song with a dead preview is silence in a pub.
    ids = sorted({i for _, i in flat})
    pre = plan.get('clip_results') or {}
    todo = [i for i in ids if str(pre.get(i)) != '200']
    res = dict(pre)
    if todo:
        print('  ... checking %d clips live' % len(todo))
        with ThreadPoolExecutor(max_workers=8) as ex:
            for i, st in zip(todo, ex.map(lambda x: head(as_[x].get('previewUrl')), todo)):
                res[i] = st
    dead = [i for i in ids if str(res.get(i)) != '200']
    ok('every restored song has a clip that answers 200', not dead,
       '%d clips checked' % len(ids), why='dead: %s' % [(i, res.get(i)) for i in dead][:5])

    print('\n%s  %d checks, %d failed\n' % ('RED' if FAILED else 'GREEN', len(RAN), len(FAILED)))
    return 1 if FAILED else 0

if __name__ == '__main__':
    sys.exit(main())
