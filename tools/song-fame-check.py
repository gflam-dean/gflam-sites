#!/usr/bin/env python3
"""HOW KNOWN IS THIS SONG, asked of something other than an Australian sales chart.

    python3 tools/song-fame-check.py

WHY. The pruning list (song-unknown-candidates-2026-09-10.json) holds 1,053 songs with
no Australian chart evidence, and it is nearly useless for cutting, because the only
evidence this repo holds is what people BOUGHT here from 1970 on. Music that arrived by
radio, film, jukebox and reissue is invisible to it: Soul and Motown scores 162
unevidenced out of 189, and every automatic dud rule lands on Ain't No Sunshine, Free
Bird and Lady Marmalade.

So this asks a different question: does the song have its own encyclopaedia article, and
does that article name the act. It is a proxy for "is this song a thing people know",
which is what a pub actually cares about.

    2   its own article, naming the act        Sexual Healing, Free Bird
    1   its own article, act not confirmed
    0   nothing                                Buffalo Traffic Jam

WHAT IT CANNOT DO, and this matters. Fame is not suitability, and suitability is DEAN'S
call, not a tool's and not mine. I spent an afternoon using Hot Potato by The Wiggles as
the obvious famous-but-wrong example and he corrected me: "hot potato would be great in
australia with drunk people lol". He is right and he runs the rooms: a nostalgia
singalong everyone under forty knows every word to is exactly what musical bingo wants.
So a score of 0 is good evidence for cutting, a 2 is not evidence for keeping, and
nothing with real listeners gets filtered out on somebody's taste before he sees it.

Read-only, writes one dated file, changes no pack and no song. Polite: one request at a
time with a real user agent, which is what the Wikimedia API asks for.
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'venueplay', 'data', 'song-unknown-candidates-2026-09-10.json')
OUT  = os.path.join(ROOT, 'venueplay', 'data', 'song-fame-2026-09-10.json')
UA   = 'VenuePlay-song-check/1.0 (contact: dean.tindale@outlook.com)'
API  = 'https://en.wikipedia.org/w/api.php?'

def get(params):
    req = urllib.request.Request(API + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for attempt in range(3):
        try: return json.load(urllib.request.urlopen(req, timeout=25))
        except Exception: time.sleep(1.5 * (attempt + 1))
    return {}

def fame(title, artist):
    d = get({'action': 'query', 'list': 'search', 'srsearch': '%s %s' % (title, artist),
             'srlimit': 5, 'format': 'json', 'formatversion': 2})
    hits = (d.get('query') or {}).get('search') or []
    if not hits: return 0, None
    tnorm = re.sub(r'[^a-z0-9]', '', title.lower())
    anorm = re.sub(r'[^a-z0-9]', '', (artist or '').lower())[:12]
    for h in hits:
        pt = h.get('title', '')
        pn = re.sub(r'[^a-z0-9]', '', pt.lower())
        sn = re.sub(r'[^a-z0-9]', '', re.sub(r'<[^>]+>', '', h.get('snippet', '')).lower())
        own = tnorm and (pn.startswith(tnorm) or pn.startswith(tnorm + 'song'))
        if own and anorm and (anorm in sn or anorm in pn): return 2, pt
        if own: return 1, pt
    return 0, hits[0].get('title')

def main():
    rows = json.load(io.open(LIST, encoding='utf-8'))['list']
    # PROVE THE HARNESS FIRST. Wayback once reported nothing found and it was the
    # harness, not the archive. Two nobody would cut, one that should score zero.
    checks = [('Sexual Healing', 'Marvin Gaye', 2), ('Free Bird', 'Lynyrd Skynyrd', 2),
              ('Buffalo Traffic Jam', 'Charley Crockett', 0)]
    for t, a, want in checks:
        got, _ = fame(t, a)
        if got != want:
            print('STOP: harness check failed. %s by %s scored %d, expected %d.' % (t, a, got, want))
            sys.exit(1)
        time.sleep(0.4)
    print('harness proved on %d known cases\n' % len(checks))

    out, n = [], 0
    for r in rows:
        s, page = fame(r.get('title', ''), r.get('artist', ''))
        out.append({'id': r.get('id'), 'title': r.get('title'), 'artist': r.get('artist'),
                    'year': r.get('year'), 'in': r.get('in'), 'fame': s, 'page': page})
        n += 1
        if n % 50 == 0:
            print('  %d of %d, %d with nothing' % (n, len(rows), sum(1 for x in out if x['fame'] == 0)), flush=True)
        time.sleep(0.35)
    json.dump({'generated': '2026-09-10',
               'what_this_is': 'A fame score for every song on the pruning list, from whether it has its own encyclopaedia article naming the act.',
               'what_this_is_not': "Suitability, which is Dean's call and not a tool's. A 0 is evidence for cutting; a 2 is not evidence for keeping.",
               'scores': {'2': 'its own article, naming the act', '1': 'its own article, act unconfirmed', '0': 'nothing'},
               'list': out}, io.open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    z = [x for x in out if x['fame'] == 0]
    print('\n%d checked. %d scored nothing.' % (len(out), len(z)))
    print('-> %s' % OUT)

if __name__ == '__main__':
    main()
