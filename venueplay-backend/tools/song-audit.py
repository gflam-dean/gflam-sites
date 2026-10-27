#!/usr/bin/env python3
"""Would an Australian pub know this song?

Dean, after a live night: "all the songs need to be ones that australians know."
That cannot be measured directly, so this is careful about what it claims. Four
things CAN be answered from data, and each is reported separately rather than
blended into one score somebody would then trust too much:

  IS IT SOLD HERE.      The lookup runs against the AU store. No AU match means
                        nobody here has bought it, streamed it, or heard it on
                        the radio from an Australian account.

  IS IT THE RIGHT ERA.  A decade pack has one job. The 2000s list carries songs
                        from 2014, 2021 and 2024, and a room asked to name a
                        2000s song is not helped by a 2024 one.

  IS IT EVEN THE SONG.  Karaoke versions, tribute-band covers, "made famous by"
                        recordings, instrumentals, live takes, womb sounds. These
                        are not the record anyone remembers, and some are not
                        music at all.

  HOW FAMOUS IS IT.     Position in the playlist, which is Apple's own popularity
                        order and the only recognisability signal in the data. It
                        is a proxy, and it is named as one.

What this does NOT know: whether a song was a hit in Australia specifically, and
whether a song famous elsewhere passed us by. A human still has to look at the
list. This narrows what they have to look at.

  song-audit.py [--fix]     --fix rewrites the library: junk out, eras corrected
"""
import json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
LIB  = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
FACTS = os.path.join(HERE, 'song-years.jsonl')
OUT  = os.path.join(HERE, 'song-audit.csv')
FIX  = '--fix' in sys.argv

# Editions that are not the record anybody remembers.
JUNK = re.compile(r'\b(karaoke|backing track|made famous by|in the style of|tribute|'
                  r'instrumental|8-?bit|lullab(y|ies)|sleep|womb|white noise|nature sounds|'
                  r'workout mix|hypnosis|meditation|ringtone|as made popular)\b', re.I)
LIVEISH = re.compile(r'\b(live at|live from|live in|live version|\(live\)|acoustic version|demo version)\b', re.I)
DECADES = {'60s': (1960, 1969), '70s': (1970, 1979), '80s': (1980, 1989),
           '90s': (1990, 1999), '2000s': (2000, 2009), '2010s': (2010, 2019),
           '80s Rock': (1980, 1989)}

def main():
    lib = json.load(open(LIB))
    facts = {}
    if os.path.exists(FACTS):
        for line in open(FACTS):
            try:
                r = json.loads(line)
                if r.get('ok'):
                    facts[r['id']] = r
            except Exception:
                pass
    print('  %d songs in the library, %d looked up' % (len(lib['songs']), len(facts)))
    if len(facts) < len(lib['songs']) * 0.9:
        print('  WARNING: the lookup is not finished. Run song-years.py to completion first,')
        print('  or this will call songs "not sold in Australia" that were never asked about.')

    byid = {s['id']: s for s in lib['songs']}
    rows, per_pack = [], collections.OrderedDict()
    for pl in lib['playlists']:
        name = pl['name']
        lo, hi = DECADES.get(name, (None, None))
        counts = collections.Counter()
        for pos, sid in enumerate(pl['songIds']):
            s = byid.get(sid)
            if not s:
                continue
            f = facts.get(sid)
            why = []
            if JUNK.search(s['title']):
                why.append('not the real record')
            if LIVEISH.search(s['title']):
                why.append('live or alternate take')
            if f is None:
                why.append('never looked up')
            else:
                if not f.get('in_au_store'):
                    why.append('not sold in the AU store')
                y = f.get('year')
                if lo and y and not (lo <= y <= hi):
                    why.append('released %d, outside the %s' % (y, name))
                if lo and not y:
                    why.append('no year, cannot place it in the %s' % name)
            counts['total'] += 1
            if why:
                counts['flagged'] += 1
                rows.append({'playlist': name, 'position': pos, 'title': s['title'],
                             'artist': s['artist'],
                             'year': (f or {}).get('year') or '',
                             'genre': (f or {}).get('genre') or '',
                             'why': '; '.join(why)})
        per_pack[name] = counts

    import csv
    with open(OUT, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['playlist', 'position', 'title', 'artist',
                                           'year', 'genre', 'why'])
        w.writeheader()
        for r in sorted(rows, key=lambda r: (r['playlist'], r['position'])):
            w.writerow(r)

    print('\n  %-16s %6s %8s %7s' % ('playlist', 'songs', 'flagged', 'share'))
    for name, c in per_pack.items():
        t, fl = c['total'], c['flagged']
        print('  %-16s %6d %8d %6d%%' % (name, t, fl, round(100 * fl / t) if t else 0))
    print('\n  %d flagged in total  ->  %s' % (len(rows), os.path.basename(OUT)))

    if FIX:
        if len(facts) < len(lib['songs']) * 0.9:
            print('  --fix REFUSED: the lookup is not finished, so this would delete songs')
            print('  that were simply never asked about. Finish song-years.py first.')
            return
        import shutil, datetime
        stamp = datetime.datetime.now().strftime('%Y-%m-%d-%H%M')
        shutil.copy(LIB, LIB.replace('.json', '.backup-%s.json' % stamp))
        drop = set()
        for r in rows:
            if 'not the real record' in r['why'] or 'not sold in the AU store' in r['why'] \
               or 'outside the' in r['why']:
                for s in lib['songs']:
                    if s['title'] == r['title'] and s['artist'] == r['artist']:
                        drop.add((r['playlist'], s['id']))
        removed = 0
        for pl in lib['playlists']:
            before = len(pl['songIds'])
            pl['songIds'] = [i for i in pl['songIds'] if (pl['name'], i) not in drop]
            removed += before - len(pl['songIds'])
        json.dump(lib, open(LIB, 'w'), separators=(',', ':'))
        print('  --fix: removed %d playlist entries. Songs stay in the library, they just\n'
              '         no longer sit in a pack they do not belong in.' % removed)

if __name__ == '__main__':
    main()
