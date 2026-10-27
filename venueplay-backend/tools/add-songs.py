#!/usr/bin/env python3
"""
Add songs to the musical bingo library from the Australian iTunes store.

WHY
The library is strong on the classics but has holes, and after a live night you always come
away with "how is X not in there". This adds them, in the same shape as everything else, with
the real Australian-store preview clip and artwork.

HOW TO USE
Put one song per line in data/au-songs-add.txt as:

    Artist - Song title

Then:
    python3 tools/add-songs.py                # look them up and show what it found
    python3 tools/add-songs.py --write        # actually add them to the library

It searches the AU storefront, so you get the release an Australian would hear, and it skips
anything already in the library. Lines it cannot find are listed at the end so you can fix the
spelling and run it again. Nothing is ever overwritten: songs are appended.

A NOTE ON ORDER
The library's order matters. tools/curate-library.py keeps each artist's FIRST few songs on the
basis that the file is popularity ranked within an artist, so new songs are inserted next to
that artist's existing ones in the order you list them, not dumped at the end. List an artist's
biggest song first.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(HERE, 'data', 'musical-library.json')
FULL = os.path.join(HERE, 'data', 'musical-library-full.json')
WANT = os.path.join(HERE, 'data', 'au-songs-add.txt')
API = 'https://itunes.apple.com/search'


def slug(title, artist):
    s = ('%s-%s' % (title, artist)).lower()
    s = re.sub(r"['’]", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s


def lookup(artist, title):
    term = '%s %s' % (artist, title)
    url = API + '?' + urllib.parse.urlencode({
        'term': term, 'country': 'AU', 'media': 'music', 'entity': 'song', 'limit': 8,
    })
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return None, 'lookup failed (%s)' % e
    results = data.get('results') or []
    if not results:
        return None, 'no match in the AU store'

    def norm(s):
        return re.sub(r'[^a-z0-9]', '', (s or '').lower())
    want_a, want_t = norm(artist), norm(title)
    # BOTH the artist and the title have to match. An earlier version fell back to "close enough"
    # and quietly added Killing Heidi's Superstar when asked for Mascara, and a 2016 TV cast
    # recording of Summer Nights instead of the film. A wrong song added silently is worse than a
    # line you have to retype, so anything less than a real match is reported as not found.
    # The store is full of soundalikes, and a substring test happily matched "Garth Brooks
    # Tribute" for Garth Brooks. Never accept one: the whole point is the record people know.
    FAKE = re.compile(r'\b(tribute|karaoke|made famous by|in the style of|cover band|'
                      r'originally performed|backing track|the hit crew|party tyme)\b', re.I)
    best = None
    for r in results:
        if not r.get('previewUrl'):
            continue
        if FAKE.search(r.get('artistName') or '') or FAKE.search(r.get('collectionName') or ''):
            continue
        a, t = norm(r.get('artistName')), norm(r.get('trackName'))
        if (want_a in a or a in want_a) and (want_t in t or t in want_t):
            best = r
            break
    if best is None:
        near = results[0]
        return None, 'no confident match (closest was "%s" by %s)' % (
            near.get('trackName', '?'), near.get('artistName', '?'))
    art = (best.get('artworkUrl100') or '').replace('100x100bb', '600x600bb')
    return {
        'id': slug(best['trackName'], best['artistName']),
        'title': best['trackName'],
        'artist': best['artistName'],
        'previewUrl': best['previewUrl'],
        'artworkUrl': art,
    }, None


def main():
    write = '--write' in sys.argv
    if not os.path.exists(WANT):
        print('make a list first: %s' % os.path.relpath(WANT, HERE))
        print('one song per line, as:  Artist - Song title')
        return

    wants = []
    for line in open(WANT, encoding='utf-8'):
        line = line.split('#')[0].strip()
        if not line:
            continue
        if ' - ' not in line:
            print('  skipping (needs "Artist - Song"): %s' % line)
            continue
        a, t = line.split(' - ', 1)
        wants.append((a.strip(), t.strip()))

    # Add to BOTH the curated library and the full backup, so a later re-curate keeps them.
    targets = [p for p in (LIB, FULL) if os.path.exists(p)]
    raw = json.load(open(targets[0], encoding='utf-8'))
    songs = raw if isinstance(raw, list) else raw.get('songs', [])
    have = {(s.get('artist', '').lower(), s.get('title', '').lower()) for s in songs}

    found, missing, already = [], [], 0
    for artist, title in wants:
        if (artist.lower(), title.lower()) in have:
            already += 1
            continue
        song, err = lookup(artist, title)
        if song is None:
            missing.append('%s - %s  (%s)' % (artist, title, err))
            continue
        if (song['artist'].lower(), song['title'].lower()) in have:
            already += 1
            continue
        have.add((song['artist'].lower(), song['title'].lower()))
        found.append(song)
        print('  found  %-34s %s' % (song['title'][:34], song['artist'][:30]))
        time.sleep(0.25)   # be polite to the store

    print()
    print('wanted %d, already there %d, found %d, not found %d'
          % (len(wants), already, len(found), len(missing)))
    if missing:
        print('\ncould not find:')
        for m in missing:
            print('   ' + m)

    if not write:
        print('\n(dry run. add --write to save)')
        return
    if not found:
        print('\nnothing new to add')
        return

    for path in targets:
        raw = json.load(open(path, encoding='utf-8'))
        songs = raw if isinstance(raw, list) else raw.get('songs', [])
        # Insert each new song directly after that artist's existing songs, so the
        # "first N per artist" curation keeps a sensible order.
        for song in found:
            at = None
            for i, s in enumerate(songs):
                if (s.get('artist', '').lower() == song['artist'].lower()):
                    at = i + 1
            if at is None:
                songs.append(song)
            else:
                songs.insert(at, song)
        if isinstance(raw, list):
            out = songs
        else:
            out = dict(raw)
            out['songs'] = songs
        json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
        print('added %d songs to %s' % (len(found), os.path.relpath(path, HERE)))


if __name__ == '__main__':
    main()
