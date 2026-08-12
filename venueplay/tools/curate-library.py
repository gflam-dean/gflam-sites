#!/usr/bin/env python3
"""
Trim the musical bingo library down to songs an Australian pub crowd actually knows.

WHY THIS EXISTS
The library grew to 17,188 songs and the first live test was a flop: "I did not know half
the songs." The cause is depth, not junk. Whoever built it pulled whole discographies, so
there are 33 Alan Jackson tracks and 35 Morgan Wallen tracks, and about 30 of each are album
cuts nobody has heard.

THE ONE USEFUL THING ABOUT THE FILE
Its order is popularity ranked WITHIN each artist. Cold Chisel starts Khe Sanh, Flame Trees,
Cheap Wine. AC/DC starts Long Way to the Top, Highway to Hell, Thunderstruck. So "keep each
artist's first N" really does keep their best known songs, and everything after is the tail.

Separately: playlist SIZE was what actually broke the game night, not song choice. A card is
24 songs, so running a game off 17,188 gave a 0.14% chance any played song marked a cell.
That is fixed in the host page (a game now draws a 60 song set). Curating the library is
about the songs being singable, which is a different problem.

RULES, in order
  1. drop non-Latin scripts (K-pop, Bollywood, Japanese covers)
  2. drop remix / live / karaoke / tribute versions
  3. drop multi-artist credits ("Sigala & Talia Mar"): almost all one-off dance features,
     and a pub singalong belongs to one act
  4. drop artists the library only has a handful of tracks for: usually a one-off, not an act
  5. drop anything in data/au-artists-exclude.txt (EDIT THAT FILE, it is the human judgement)
  6. keep each surviving artist's top N

USAGE
  python3 tools/curate-library.py                 # dry run, prints what it would do
  python3 tools/curate-library.py --write         # writes data/musical-library.json
  python3 tools/curate-library.py --cap 4 --min 5 --write
  python3 tools/curate-library.py --artists       # dump the surviving artist list for review

The original is kept as data/musical-library-full.json the first time you write, so nothing
is ever lost and you can re-run with different settings.
"""
import json, re, sys, os, collections, argparse

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(HERE, 'data', 'musical-library.json')
FULL = os.path.join(HERE, 'data', 'musical-library-full.json')
EXCLUDE = os.path.join(HERE, 'data', 'au-artists-exclude.txt')

NON_LATIN = re.compile(r'[^\x00-\x7FÀ-ɏ‘’“”–—…]')
VERSION = re.compile(r'\b(karaoke|tribute|made popular by|in the style of|originally performed|'
                     r'backing track|8-bit|lullaby|remix|live at|live from|demo version|\(live\))\b', re.I)
COLLAB = re.compile(r'\s(?:&|feat\.?|featuring|with|x|vs\.?|,)\s', re.I)


def load_excludes():
    """One artist per line. # starts a comment. Case and spacing are ignored."""
    out = set()
    if not os.path.exists(EXCLUDE):
        return out
    for line in open(EXCLUDE, encoding='utf-8'):
        line = line.split('#')[0].strip()
        if line:
            out.add(re.sub(r'\s+', ' ', line).lower())
    return out


def akey(artist):
    """Group an artist case- and spacing-insensitively.

    The library stores some acts twice: "Men at Work" (2 songs) alongside "Men At Work" (13),
    "Icehouse" (1) alongside "ICEHOUSE" (26). Counting them separately meant the small variant
    fell under the minimum and was deleted, and the small variant is where the hits were. That is
    how Down Under and Great Southern Land were dropped from an Australian pub library.
    """
    return re.sub(r'\s+', ' ', (artist or '')).strip().lower()


def curate(songs, cap, minimum, excludes):
    counts = collections.Counter(akey(s.get('artist', '')) for s in songs)
    kept, dropped = [], collections.Counter()
    per_artist = collections.Counter()
    for s in songs:
        artist = s.get('artist') or ''
        title = s.get('title') or ''
        key = akey(artist)
        if NON_LATIN.search(artist) or NON_LATIN.search(title):
            dropped['not in the Latin alphabet']+= 1
        elif VERSION.search(title) or VERSION.search(artist):
            dropped['remix, live or karaoke version']+= 1
        elif counts[key] < minimum and COLLAB.search(artist):
            # A thin artist is only dropped when the NAME also reads as a multi-artist credit,
            # which is what a one-off dance feature looks like ("Sigala & Talia Mar"). Dropping
            # every thin artist deleted the one-hit wonders instead, and a one-hit wonder is the
            # backbone of pub musical bingo: Cotton Eye Joe, Kung Fu Fighting, Groove Is In the
            # Heart. A real band survives on its catalogue either way.
            dropped['one-off credit with fewer than %d songs' % minimum] += 1
        elif key in excludes:
            dropped['artist on your exclude list']+= 1
        elif per_artist[key] >= cap:
            dropped['past this artist\'s top %d' % cap] += 1
        else:
            per_artist[key] += 1
            kept.append(s)
    return kept, dropped, per_artist


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cap', type=int, default=3, help="how many songs to keep per artist (default 3)")
    ap.add_argument('--min', type=int, default=3, dest='minimum',
                    help="drop MULTI-ARTIST CREDITS with fewer than this many songs (default 3). A solo act is never dropped for being thin: that is what one-hit wonders are.")
    ap.add_argument('--write', action='store_true', help="actually write the trimmed library")
    ap.add_argument('--artists', action='store_true', help="print the surviving artists and exit")
    a = ap.parse_args()

    source = FULL if os.path.exists(FULL) else LIB
    raw = json.load(open(source, encoding='utf-8'))
    songs = raw if isinstance(raw, list) else raw.get('songs', [])
    excludes = load_excludes()

    kept, dropped, per_artist = curate(songs, a.cap, a.minimum, excludes)

    if a.artists:
        for artist, n in sorted(per_artist.items()):
            print('%-44s %d' % (artist[:44], n))
        return

    print('reading   %s' % os.path.relpath(source, HERE))
    print('starting  %d songs, %d artists' % (len(songs), len(set(s.get('artist') for s in songs))))
    print('excluding %d artists from %s' % (len(excludes), os.path.relpath(EXCLUDE, HERE)))
    print()
    for reason, n in dropped.most_common():
        print('  removed %6d  %s' % (n, reason))
    print()
    print('keeping   %d songs, %d artists' % (len(kept), len(per_artist)))

    if not a.write:
        print('\n(dry run. add --write to save, or --artists to review who survived)')
        return

    if not os.path.exists(FULL):
        json.dump(raw, open(FULL, 'w', encoding='utf-8'), ensure_ascii=False)
        print('\nkept the original as %s' % os.path.relpath(FULL, HERE))

    if isinstance(raw, list):
        out = kept
    else:
        out = dict(raw)
        out['songs'] = kept
    json.dump(out, open(LIB, 'w', encoding='utf-8'), ensure_ascii=False)
    print('wrote %s' % os.path.relpath(LIB, HERE))


if __name__ == '__main__':
    main()
