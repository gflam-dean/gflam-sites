#!/usr/bin/env python3
"""Build the decade and genre packs out of what the AU store told us.

Dean asked for more categories, and for every song to be one Australians know.
Two things make that possible now: song-years.py fetched a release year and a
genre for every song, and the playlists were already ordered most-known first.

WHAT THIS DOES AND DOES NOT DO

  It never deletes a song. The library keeps everything; only playlist membership
  changes. A song dropped from the 2000s for being a 2014 release is still in the
  library and still in whatever else it belongs to.

  It keeps the ORDER. Position in a playlist is the recognisability signal the
  draw weights by, so every pack it writes preserves the order the songs already
  had, and new packs inherit it from the library's own order.

  It caps an artist at three per pack. Ten Coldplay songs is not a category, it
  is a Coldplay album, and a night that draws four of them is a worse night.

  It only includes songs that are sold in the AU store, which is the closest
  thing to "would this room know it" that can be answered from data rather than
  taste. A song we could not ask about is left where it is rather than assumed.

  build-categories.py [--write]      without --write it only reports
"""
import json, os, re, sys, collections, shutil, datetime

HERE  = os.path.dirname(os.path.abspath(__file__))
ROOT  = os.path.dirname(os.path.dirname(HERE))
LIB   = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
FACTS = os.path.join(HERE, 'song-years.jsonl')
WRITE = '--write' in sys.argv
PER_ARTIST = 3
MIN_PACK   = 60          # a pack smaller than a single game is not a pack

DECADES = [('60s', 1960, 1969), ('70s', 1970, 1979), ('80s', 1980, 1989),
           ('90s', 1990, 1999), ('2000s', 2000, 2009), ('2010s', 2010, 2019)]

# Apple's genre names, grouped into what a pub would actually call a night.
GENRES = [
    ('Rock',            ['rock', 'hard rock', 'classic rock', 'album rock', 'arena rock']),
    ('Pop',             ['pop', 'teen pop', 'adult contemporary', 'dance pop']),
    ('Country',         ['country', 'contemporary country', 'americana']),
    ('Dance & Club',    ['dance', 'electronic', 'house', 'techno', 'edm', 'club/dance']),
    ('Hip-Hop & R&B',   ['hip-hop/rap', 'hip hop/rap', 'rap', 'r&b/soul', 'r&b', 'soul']),
    ('Alternative',     ['alternative', 'indie rock', 'britpop', 'grunge', 'punk']),
    ('Metal',           ['metal', 'heavy metal', 'hard rock/metal']),
    ('Reggae & Ska',    ['reggae', 'ska', 'dancehall']),
]
# Packs a person curated. Never rebuilt, only checked.
CURATED = {'Pub Classics', 'Aussie', '80s Rock', 'Disco', 'Funk', 'Soul & Motown', 'Modern Pop'}

def main():
    lib = json.load(open(LIB))
    facts = {}
    for line in (open(FACTS) if os.path.exists(FACTS) else []):
        try:
            r = json.loads(line)
            if r.get('ok'):
                facts[r['id']] = r
        except Exception:
            pass
    songs = lib['songs']
    print('  %d songs, %d with an answer from the store' % (len(songs), len(facts)))
    if len(facts) < len(songs) * 0.9:
        print('  STOPPING: the lookup is not finished. Building packs now would file every')
        print('  song that has not been asked about yet as "not sold in Australia".')
        return 1

    order = {s['id']: i for i, s in enumerate(songs)}     # the library's own order = popularity
    byid  = {s['id']: s for s in songs}

    def eligible(sid):
        f = facts.get(sid)
        return bool(f and f.get('in_au_store'))

    def capped(ids):
        seen, out = collections.Counter(), []
        for sid in sorted(ids, key=lambda x: order.get(x, 1 << 30)):
            a = (byid[sid]['artist'] or '').strip().lower()
            if seen[a] >= PER_ARTIST:
                continue
            seen[a] += 1
            out.append(sid)
        return out

    built, report = {}, []

    for name, lo, hi in DECADES:
        ids = [s['id'] for s in songs
               if eligible(s['id']) and (facts[s['id']].get('year') or 0) >= lo
               and (facts[s['id']].get('year') or 0) <= hi]
        built[name] = capped(ids)

    for name, keys in GENRES:
        ids = []
        for s in songs:
            if not eligible(s['id']):
                continue
            g = (facts[s['id']].get('genre') or '').strip().lower()
            if g and any(g == k or g.startswith(k) for k in keys):
                ids.append(s['id'])
        built[name] = capped(ids)

    existing = {p['name']: p for p in lib['playlists']}
    for name, ids in built.items():
        was = len(existing[name]['songIds']) if name in existing else 0
        report.append((name, was, len(ids), 'rebuilt' if name in existing else 'new'))

    print('\n  %-16s %8s %8s   %s' % ('pack', 'was', 'now', ''))
    kept = {}
    for name, was, now, how in sorted(report, key=lambda r: -r[2]):
        skip = now < MIN_PACK
        print('  %-16s %8s %8d   %s%s' % (name, was or '-', now, how,
                                          '  (too small, skipped)' if skip else ''))
        if not skip:
            kept[name] = built[name]

    # What the era fix actually removed, named, because "the 2000s lost 300 songs"
    # deserves an example rather than a number.
    for name, lo, hi in DECADES:
        if name not in existing or name not in kept:
            continue
        gone = [i for i in existing[name]['songIds'] if i not in set(kept[name])]
        wrong_era = [i for i in gone if facts.get(i) and facts[i].get('year')
                     and not (lo <= facts[i]['year'] <= hi)]
        if wrong_era:
            eg = ', '.join('%s (%d)' % (byid[i]['title'][:26], facts[i]['year']) for i in wrong_era[:3])
            print('\n  %s: %d were not from the %s, e.g. %s' % (name, len(wrong_era), name, eg))

    if not WRITE:
        print('\n  Nothing written. Re-run with --write.')
        return 0

    shutil.copy(LIB, LIB.replace('.json', '.backup-%s.json'
                                 % datetime.datetime.now().strftime('%Y-%m-%d-%H%M')))
    for name, ids in kept.items():
        if name in CURATED:
            continue
        if name in existing:
            existing[name]['songIds'] = ids
        else:
            lib['playlists'].append({'id': re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'),
                                     'name': name, 'songIds': ids})
    json.dump(lib, open(LIB, 'w'), separators=(',', ':'))
    print('\n  written: %d packs, %d playlists in the library'
          % (len(kept), len(lib['playlists'])))
    return 0

if __name__ == '__main__':
    sys.exit(main())
