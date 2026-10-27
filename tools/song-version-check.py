#!/usr/bin/env python3
"""THE RIGHT SONG, THE WRONG RECORDING: ask Last.fm what the plain version pulls.

    python3 tools/song-version-check.py

Dean, reading the least-played list on 10 Sep 2026: "5 9 19 22 42 54 69 79 84 86 117 126
172 184 187 178 227 237 244 from a quick look were all good! so maybe they are the wrong
version? do we look at the ones that say feat. and version and see if those songs pull a
different number" and then "or mix is another one".

He is right. Nutbush City Limits (1993 Version) has 183 listeners. Ladies Night
(Rerecorded Version) has 11. Blue (Da Ba Dee) [Gabry Ponte Video Edit] has 3,490. The
room knows every one of those songs and would hear a clip that sounds wrong, which is
worse than not having the song at all.

So for every title carrying a version marker, this strips the marker and asks what the
PLAIN recording pulls. A big gap means swap the clip, not cut the song.

IT ALSO FINDS THE OPPOSITE, and that is the more important half. Slim Dusty's A Pub With
No Beer sits on 3,169 listeners and Lee Kernaghan's Boys from the Bush on 2,013, with no
version marker at all. They are not obscure, they are AUSTRALIAN, and Last.fm is a global
service. The same blind spot as the sales-chart data, pointing the other way. Anything
flagged australian_maybe must never be cut on this number.

Read-only. Writes one dated file. Changes no song and no pack.
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV  = Path.home() / '.gflam-migrate.env'
SRC  = os.path.join(ROOT, 'venueplay', 'data', 'song-listeners-2026-09-10.json')
OUT  = os.path.join(ROOT, 'venueplay', 'data', 'song-version-swaps-2026-09-10.json')
UA   = 'VenuePlay-song-check/1.0 (contact: dean.tindale@outlook.com)'

VER = re.compile(r'\s*[\(\[][^\)\]]*?(live|acoustic|accoustic|remix|mixed|mix|rerecorded|re-recorded'
                 r'|remaster|cover|medley|a cappella|acappella|mono|version|edit|instrumental|feat\.?|with )'
                 r'[^\)\]]*[\)\]]', re.I)
# Acts whose audience is here rather than on a global service. A low count for these says
# nothing at all, and cutting one would be the worst mistake this whole exercise could make.
AUSSIE = re.compile(r'slim dusty|lee kernaghan|john williamson|skyhooks|the angels|cold chisel|'
                    r'hunters & collectors|hunters and collectors|paul kelly|daryl braithwaite|'
                    r'jimmy barnes|the screaming jets|australian crawl|dragon|mental as anything|'
                    r'icehouse|hoodoo gurus|the church|noiseworks|james reyne|richard clapton|'
                    r'the whitlams|you am i|spiderbait|regurgitator|grinspoon|the living end|'
                    r'the seekers|normie rowe|russell morris|little river band|sherbet|'
                    r'the easybeats|masters apprentices|billy thorpe|john farnham|kylie|'
                    r'delta goodrem|guy sebastian|shannon noll|the whitlams|thirsty merc|'
                    r'eskimo joe|jet |wolfmother|powderfinger|silverchair|missy higgins', re.I)

def key():
    for line in ENV.read_text().splitlines():
        if line.startswith('LASTFM_API_KEY='):
            k = line.split('=', 1)[1].strip()
            if k: return k
    print('STOP: LASTFM_API_KEY is not in %s' % ENV); sys.exit(1)

def listeners(k, title, artist):
    u = 'https://ws.audioscrobbler.com/2.0/?' + urllib.parse.urlencode(
        {'method': 'track.getInfo', 'api_key': k, 'artist': artist or '', 'track': title or '',
         'autocorrect': 1, 'format': 'json'})
    for a in range(3):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=25))
            break
        except Exception:
            time.sleep(1.5 * (a + 1))
    else:
        return None, None
    tr = d.get('track') or {}
    if not tr: return None, None
    try: return int(tr.get('listeners') or 0), tr.get('name')
    except ValueError: return None, None

def plain(title):
    """Nutbush City Limits (1993 Version) -> Nutbush City Limits"""
    t = VER.sub('', title or '')
    t = re.sub(r'\s{2,}', ' ', t).strip(' -')
    return t

def main():
    k = key()
    rows = [r for r in json.load(io.open(SRC, encoding='utf-8'))['list'] if r.get('listeners') is not None]
    rows.sort(key=lambda r: r['listeners'])
    band = rows[:1500]
    marked = [r for r in band if VER.search(r['title'] or '') and plain(r['title']) != (r['title'] or '')]
    print('%d of the least played 1,500 carry a version marker. Asking what the plain recording pulls.\n' % len(marked))

    out, n = [], 0
    for r in marked:
        p = plain(r['title'])
        # strip a featured artist off the ARTIST field too: "Tina Turner & X" -> "Tina Turner"
        a = re.split(r'\s*(?:&|feat\.?|featuring|with|vs\.?|x )\s*', r['artist'] or '', 1)[0].strip()
        got, name = listeners(k, p, a)
        out.append({'id': r['id'], 'held_as': r['title'], 'held_artist': r['artist'],
                    'held_listeners': r['listeners'], 'plain_title': p, 'plain_artist': a,
                    'plain_listeners': got, 'matched_as': name,
                    'gain': (got - r['listeners']) if got else None})
        n += 1
        if n % 25 == 0: print('  %d of %d' % (n, len(marked)), flush=True)
        time.sleep(0.3)

    aussie = [r for r in band if AUSSIE.search((r['artist'] or '')) and not VER.search(r['title'] or '')]
    json.dump({'generated': '2026-09-10',
               'what_this_is': 'For every least-played song whose title carries a version marker, what the PLAIN recording pulls on Last.fm.',
               'how_to_read_it': 'A big gain means swap the clip, not cut the song. The room knows the song; it would hear the wrong recording.',
               'australian_warning': ('Songs by Australian acts sit low on a GLOBAL service whatever their standing here. '
                                      'Slim Dusty, Lee Kernaghan and Skyhooks are on this list and must never be cut on this number.'),
               'australian_maybe': [{'id': r['id'], 'title': r['title'], 'artist': r['artist'], 'listeners': r['listeners']} for r in aussie],
               'list': out}, io.open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

    swaps = sorted([r for r in out if r['gain'] and r['gain'] > 0], key=lambda r: -r['gain'])
    print('\n%d checked. %d have a plain version with MORE listeners.' % (len(out), len(swaps)))
    print('%d least-played songs are by Australian acts and are flagged never to cut on this number.\n' % len(aussie))
    print('the twenty biggest gaps:')
    for r in swaps[:20]:
        print('   %9s -> %-10s  %-40s' % (f"{r['held_listeners']:,}", f"{r['plain_listeners']:,}", (r['plain_title'] or '')[:39]))
    print('\n-> %s' % OUT)

if __name__ == '__main__':
    main()
