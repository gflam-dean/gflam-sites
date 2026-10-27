#!/usr/bin/env python3
"""HOW MANY PEOPLE ACTUALLY LISTEN TO THIS SONG. Last.fm listener counts.

    python3 tools/song-listeners.py            every song sitting in a pack (3,193)
    python3 tools/song-listeners.py --list     only the songs with no chart evidence (1,053)
    python3 tools/song-listeners.py --cut      the 2,977 in the library but in NO pack

THE --cut RUN IS DEAN'S IDEA AND IT IS THE BETTER QUESTION. "maybe you should do all
11,000 songs to see if you got any wrong by pulling them out?" Curation on 8 Sep took
songs OUT of packs and nothing has ever checked those decisions. A song sitting in no
pack with a million listeners is a mistake we made, and no amount of checking the songs
we KEPT would ever find it. Verify the cuts, not just the keeps.

WHY IT EXISTS, and why the two obvious answers did not work.

The only evidence this repo held was Australian SALES charts from 1970 on. That measures
what people bought here in one year, not what a room knows now, so every automatic dud
rule landed on Ain't No Sunshine, Free Bird and Lady Marmalade. Soul and Motown scored
162 unevidenced out of 189, because that music arrived by radio, film and reissue.

Spotify was the obvious fix and it is gone: checked with real credentials on 10 Sep 2026,
/v1/search, /v1/tracks/{id} and /v1/artists/{id} all return 200 with the popularity and
follower fields simply ABSENT, which looks exactly like a song nobody listens to. See
tools/song-popularity.py.

Last.fm still answers it properly, with a real count rather than a scaled score:

    Free Bird            Lynyrd Skynyrd      1,629,737
    Sexual Healing       Marvin Gaye           923,463
    Hot Potato           The Wiggles            78,894
    Buffalo Traffic Jam  Charley Crockett      not found

HOW TO READ IT. A LOW count is evidence for cutting. A high count is NOT evidence for
keeping. Suitability is Dean's judgement, and he overruled mine on the obvious example:
"hot potato would be great in australia with drunk people lol". This only tells you
whether anyone is listening.

Read-only. Writes one dated file. Changes no song and no pack.
"""
import io, json, os, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV  = Path.home() / '.gflam-migrate.env'
LIB  = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
CAND = os.path.join(ROOT, 'venueplay', 'data', 'song-unknown-candidates-2026-09-10.json')
OUT  = os.path.join(ROOT, 'venueplay', 'data', 'song-listeners-2026-09-10.json')
OUTCUT = os.path.join(ROOT, 'venueplay', 'data', 'song-listeners-cut-2026-09-10.json')
UA   = 'VenuePlay-song-check/1.0 (contact: dean.tindale@outlook.com)'

def die(m): print('STOP: ' + m); sys.exit(1)

def key():
    if not ENV.exists(): die('%s is missing' % ENV)
    if oct(ENV.stat().st_mode)[-3:] != '600': die('%s must be mode 600' % ENV)
    for line in ENV.read_text().splitlines():
        if line.startswith('LASTFM_API_KEY='):
            k = line.split('=', 1)[1].strip()
            if k: return k
    die('LASTFM_API_KEY is not in %s. Add it with: open -t %s' % (ENV, ENV))

def listeners(k, title, artist):
    """Returns (listeners, playcount, corrected name) or (None, None, None).
    autocorrect fixes spelling and punctuation, which matters: our titles come from a
    store listing and theirs from scrobbles."""
    u = 'https://ws.audioscrobbler.com/2.0/?' + urllib.parse.urlencode(
        {'method': 'track.getInfo', 'api_key': k, 'artist': artist or '', 'track': title or '',
         'autocorrect': 1, 'format': 'json'})
    for attempt in range(3):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=25))
            break
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    else:
        return None, None, None
    tr = d.get('track') or {}
    if not tr: return None, None, None
    try:
        return int(tr.get('listeners') or 0), int(tr.get('playcount') or 0), tr.get('name')
    except ValueError:
        return None, None, None

def main():
    k = key()
    only_list = '--list' in sys.argv
    cut_only = '--cut' in sys.argv

    # PROVE THE HARNESS BEFORE TRUSTING A SINGLE NUMBER. This is the check that caught
    # Spotify quietly returning nothing, and the Wayback run that "found nothing" when
    # the harness was broken. Two everybody knows, one nobody does.
    print('harness check')
    a = listeners(k, 'Sexual Healing', 'Marvin Gaye')[0]; time.sleep(0.3)
    b = listeners(k, 'Free Bird', 'Lynyrd Skynyrd')[0]; time.sleep(0.3)
    c = listeners(k, 'Buffalo Traffic Jam', 'Charley Crockett')[0]; time.sleep(0.3)
    print('   Sexual Healing %s | Free Bird %s | Buffalo Traffic Jam %s' % (a, b, c))
    if not a or not b or a < 100000 or b < 100000:
        die('two songs everybody knows did not come back with real numbers. The lookup is wrong, not the data.')
    if c and c > min(a, b) / 10:
        die('a song nobody knows scored close to the standards. Stop and look at the matching.')
    print('harness proved\n')

    lib = json.load(io.open(LIB, encoding='utf-8'))
    inpack = set()
    for p in lib['playlists']: inpack.update(p['songIds'])
    if only_list:
        want = {r['id'] for r in json.load(io.open(CAND, encoding='utf-8'))['list']}
        rows = [s for s in lib['songs'] if s['id'] in want]
    elif cut_only:
        rows = [s for s in lib['songs'] if s['id'] not in inpack]
    else:
        rows = [s for s in lib['songs'] if s['id'] in inpack]
    print('looking up %d songs, one every third of a second\n' % len(rows))

    out, n, miss = [], 0, 0
    for s in rows:
        l, pc, name = listeners(k, s.get('title'), s.get('artist'))
        if l is None: miss += 1
        out.append({'id': s['id'], 'title': s.get('title'), 'artist': s.get('artist'),
                    'year': s.get('year'), 'listeners': l, 'playcount': pc, 'matched_as': name})
        n += 1
        if n % 100 == 0:
            print('  %d of %d, %d not found' % (n, len(rows), miss), flush=True)
        time.sleep(0.3)
    json.dump({'generated': '2026-09-10',
               'what_this_is': 'Last.fm listener counts for songs sitting in a musical bingo pack.',
               'how_to_read_it': "A LOW count is evidence for cutting. A high count is NOT evidence "
                                 "for keeping, and that call is Dean's, not a tool's.",

               'scope': ('the songs with no Australian chart evidence' if only_list else ('songs in the library but in NO pack, to check what curation removed' if cut_only else 'every song in a pack')),
               'not_found': miss, 'list': out},
              io.open(OUTCUT if cut_only else OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    got = sorted([r for r in out if r['listeners'] is not None], key=lambda r: r['listeners'])
    print('\n%d looked up, %d found, %d not on Last.fm at all' % (len(out), len(got), miss))
    if got:
        if cut_only:
            print('\nthe twenty MOST listened to that we pulled out of every pack:')
            for r in sorted(got, key=lambda x: -x['listeners'])[:20]:
                print('   %8d  %-38s %s' % (r['listeners'], (r['title'] or '')[:37], (r['artist'] or '')[:24]))
            print('\nthe twenty fewest listeners:')
        else:
            print('\nthe twenty fewest listeners:')
        for r in got[:20]:
            print('   %8d  %-38s %s' % (r['listeners'], (r['title'] or '')[:37], (r['artist'] or '')[:24]))
    print('\n-> %s' % (OUTCUT if cut_only else OUT))

if __name__ == '__main__':
    main()
