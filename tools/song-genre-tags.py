#!/usr/bin/env python3
"""WHAT KIND OF SONG IS THIS, from Last.fm's own tags.

    python3 tools/song-genre-tags.py

Dean, 10 Sep 2026, on 256 well-known songs the curation had removed: "most of those songs
are okay I think its the ones that arent sing alongs like the metal ones that wont sit
well in a pub", then "well I guess it has to be both right? I mean we should have a metal
list with maybe 500 songs in it but it doesnt need to be heaps of lists or songs".

So the answer is not to throw the heavy material away, it is to give it a pack of its own.
A venue running a metal night gets one, and the general packs stop carrying songs a bar
full of people will not sing along to.

This asks Last.fm for the top tags on every song in the library and records them, so the
decision can be made from data rather than from artist names somebody half remembers.
Tags are folksonomy, not gospel: hard rock is a broad church that holds both Ozzy Osbourne
and Creed, so the OUTPUT is a candidate list for a person to read, never a pack builder.

Read-only. Writes one dated file. Changes no song and no pack.
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV  = Path.home() / '.gflam-migrate.env'
LIB  = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
OUT  = os.path.join(ROOT, 'venueplay', 'data', 'song-tags-2026-09-10.json')
UA   = 'VenuePlay-song-check/1.0 (contact: dean.tindale@outlook.com)'

HEAVY = re.compile(r'^(metal|heavy metal|nu metal|nu-metal|numetal|metalcore|deathcore|death metal|'
                   r'thrash|thrash metal|hardcore|post-hardcore|screamo|black metal|doom metal|'
                   r'grindcore|industrial metal|alternative metal|speed metal|power metal)$', re.I)
# Deliberately NOT counted as heavy: hard rock, punk, emo. Sum 41 and blink-182 are
# singalongs in any pub in the country, and hard rock holds Ozzy Osbourne and AC/DC.
# Dean reads the list and decides; the tool does not get to decide for him.

def key():
    for line in ENV.read_text().splitlines():
        if line.startswith('LASTFM_API_KEY='):
            k = line.split('=', 1)[1].strip()
            if k: return k
    print('STOP: LASTFM_API_KEY is not in %s' % ENV); sys.exit(1)

def tags(k, title, artist):
    u = 'https://ws.audioscrobbler.com/2.0/?' + urllib.parse.urlencode(
        {'method': 'track.getTopTags', 'api_key': k, 'artist': artist or '', 'track': title or '',
         'autocorrect': 1, 'format': 'json'})
    for a in range(3):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=25))
            break
        except Exception:
            time.sleep(1.5 * (a + 1))
    else:
        return None
    t = (d.get('toptags') or {}).get('tag') or []
    if isinstance(t, dict): t = [t]
    return [x.get('name', '') for x in t][:8]

def main():
    k = key()
    lib = json.load(io.open(LIB, encoding='utf-8'))
    inpack = set()
    for p in lib['playlists']: inpack.update(p['songIds'])
    songs = lib['songs']
    print('tagging %d songs, one every third of a second\n' % len(songs))
    out, n, heavy = [], 0, 0
    for s in songs:
        t = tags(k, s.get('title'), s.get('artist'))
        h = [x for x in (t or []) if HEAVY.match(x.strip())]
        if h: heavy += 1
        out.append({'id': s['id'], 'title': s.get('title'), 'artist': s.get('artist'),
                    'in_a_pack': s['id'] in inpack, 'tags': t or [], 'heavy_tags': h})
        n += 1
        if n % 250 == 0: print('  %d of %d, %d heavy so far' % (n, len(songs), heavy), flush=True)
        time.sleep(0.3)
    json.dump({'generated': '2026-09-10',
               'what_this_is': "Last.fm top tags for every song in the library, so a Metal pack can be built from data.",
               'how_to_read_it': ("Tags are folksonomy, not gospel. hard rock holds both Ozzy Osbourne and Creed, and punk "
                                  "holds Sum 41, who are a singalong in any pub in the country. This is a candidate list "
                                  "for Dean to read, never a pack builder."),
               'heavy_definition': 'metal and its subgenres only. hard rock, punk and emo are deliberately excluded.',
               'heavy_count': heavy, 'list': out},
              io.open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('\n%d songs tagged. %d carry a metal tag.' % (len(out), heavy))
    print('-> %s' % OUT)

if __name__ == '__main__':
    main()
