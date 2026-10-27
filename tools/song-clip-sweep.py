#!/usr/bin/env python3
"""DOES EVERY CLIP STILL PLAY? A dead preview is silence in a pub.

    python3 tools/song-clip-sweep.py

Every song in a pack is checked with one HEAD request to its preview URL and its artwork.
Apple rotates and retires preview links, and nothing in this product would notice: the
host taps a song, the room gets nothing, and the only person who finds out is the host
standing in front of it.

A 60-song sample on 10 Sep 2026 came back with 0 dead, so this is a sweep for certainty
rather than a rescue, and it is the kind of thing worth running monthly.

Polite: eight at a time with a real user agent, HEAD only, no audio downloaded.
Read-only. Writes one dated file.
"""
import io, json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB  = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
OUT  = os.path.join(ROOT, 'venueplay', 'data', 'song-dead-clips-2026-09-10.json')
UA   = 'VenuePlay-clip-sweep/1.0 (contact: dean.tindale@outlook.com)'

def head(url):
    if not url: return 'no url'
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA}), timeout=20)
        return r.status
    except urllib.error.HTTPError as x:
        return x.code
    except Exception as e:
        return type(e).__name__

def main():
    lib = json.load(io.open(LIB, encoding='utf-8'))
    inpack = set()
    for p in lib['playlists']: inpack.update(p['songIds'])
    songs = [s for s in lib['songs'] if s['id'] in inpack]
    print('checking %d clips and %d artwork images\n' % (len(songs), len(songs)))
    out, done = [], [0]
    def one(s):
        c = head(s.get('previewUrl'))
        a = head(s.get('artworkUrl'))
        done[0] += 1
        if done[0] % 250 == 0: print('  %d of %d' % (done[0], len(songs)), flush=True)
        return {'id': s['id'], 'title': s.get('title'), 'artist': s.get('artist'),
                'clip': c, 'artwork': a}
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = list(ex.map(one, songs))
    deadc = [r for r in out if r['clip'] != 200]
    deada = [r for r in out if r['artwork'] != 200]
    json.dump({'generated': '2026-09-10',
               'what_this_is': 'Every song in a pack, checked that its audio clip and artwork still load.',
               'why': 'A dead preview is silence in a pub and nothing in the product would notice.',
               'dead_clips': len(deadc), 'dead_artwork': len(deada),
               'list': deadc + [r for r in deada if r not in deadc]},
              io.open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('\n%d clips checked. %d dead. %d artwork images dead.' % (len(out), len(deadc), len(deada)))
    for r in (deadc + deada)[:20]:
        print('   %-40s %-22s clip %s artwork %s' % ((r['title'] or '')[:39], (r['artist'] or '')[:21], r['clip'], r['artwork']))
    print('\n-> %s' % OUT)

if __name__ == '__main__':
    main()
