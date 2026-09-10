#!/usr/bin/env python3
"""IS THIS RECORDING IN THE OPEN MUSIC DATABASE AT ALL?

    python3 tools/song-musicbrainz-check.py

A third free signal, needing no key and no account, alongside the Wikipedia article check.
MusicBrainz is catalogued by volunteers and is close to exhaustive for anything that had a
release: Sexual Healing resolves in one call. Buffalo Traffic Jam, off the August bulk
load, does not resolve at all.

So absence is worth something. Presence is worth almost nothing, because MusicBrainz also
holds every obscure release ever pressed. Read it as a vote against, never a vote for.

Why this exists at all: Spotify used to answer "how much is this listened to" with a
popularity score and REMOVED those fields for new apps in late 2024, returning 200 with
the field simply missing (see tools/song-popularity.py). Last.fm still answers it properly
but wants a key. This is what can be had for nothing while that is sorted.

MusicBrainz asks for one request a second and a real user agent. Both are honoured.
Read-only. Writes one dated file. Changes no song and no pack.
"""
import io, json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'venueplay', 'data', 'song-unknown-candidates-2026-09-10.json')
OUT  = os.path.join(ROOT, 'venueplay', 'data', 'song-musicbrainz-2026-09-10.json')
UA   = 'VenuePlay-song-check/1.0 (contact: dean.tindale@outlook.com)'

def get(url):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=25))
    except Exception:
        return None

def found(title, artist):
    """Returns (hit, score). score is MusicBrainz's own confidence, 0 to 100."""
    q = urllib.parse.quote('recording:"%s" AND artist:"%s"' % (title.replace('"', ''), (artist or '').replace('"', '')))
    d = get('https://musicbrainz.org/ws/2/recording?query=%s&fmt=json&limit=1' % q)
    if d is None: return None, None            # could not ask: never counted as absent
    recs = d.get('recordings') or []
    if not recs: return False, 0
    return True, recs[0].get('score')

def main():
    rows = json.load(io.open(LIST, encoding='utf-8'))['list']
    # PROVE THE HARNESS. One that must resolve, one that must not.
    a, _ = found('Sexual Healing', 'Marvin Gaye'); time.sleep(1.1)
    b, _ = found('Buffalo Traffic Jam', 'Charley Crockett'); time.sleep(1.1)
    if a is not True or b is not False:
        print('STOP: harness failed. Sexual Healing=%s, Buffalo Traffic Jam=%s. '
              'Absence would mean nothing until this passes.' % (a, b)); sys.exit(1)
    print('harness proved: a standard resolves, a dud does not\n')

    out, n, miss, err = [], 0, 0, 0
    for r in rows:
        hit, score = found(r.get('title', ''), r.get('artist', ''))
        if hit is None: err += 1
        elif not hit: miss += 1
        out.append({'id': r.get('id'), 'title': r.get('title'), 'artist': r.get('artist'),
                    'year': r.get('year'), 'in_musicbrainz': hit, 'mb_score': score})
        n += 1
        if n % 50 == 0:
            print('  %d of %d, %d not in it, %d could not be asked' % (n, len(rows), miss, err), flush=True)
        time.sleep(1.05)
    json.dump({'generated': '2026-09-10',
               'what_this_is': 'Whether each song on the pruning list resolves to a recording in MusicBrainz.',
               'how_to_read_it': 'Absence is a vote AGAINST a song. Presence is worth almost nothing: MusicBrainz holds every obscure release ever pressed.',
               'could_not_ask': err, 'not_found': miss, 'list': out},
              io.open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('\n%d checked, %d not in MusicBrainz at all, %d could not be asked' % (len(out), miss, err))
    print('-> %s' % OUT)

if __name__ == '__main__':
    main()
