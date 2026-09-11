#!/usr/bin/env python3
"""HOW MUCH IS THIS SONG ACTUALLY LISTENED TO.

SPOTIFY CANNOT ANSWER THIS ANY MORE. Do not spend another hour on it. Checked with real
credentials on 10 Sep 2026: /v1/search, /v1/tracks/{id} and /v1/artists/{id} all return
a valid 200 with the popularity and follower fields simply ABSENT. Not an error, not a
permission message, just missing, which is the worst shape a failure can take because it
looks exactly like a song nobody listens to. Spotify removed those fields for newly
registered apps in late 2024. The credentials are fine and the token works.

The harness at the bottom of this file is what caught it: it refuses to run unless two
songs everybody knows score higher than one nobody does, so instead of 3,193 rows of
null dressed up as data, it stopped and said the matching was wrong.

WHAT TO USE INSTEAD: Last.fm. api.last.fm track.getInfo returns listeners and playcount
per track, which is the number we actually want, and the key is free. This file keeps
the Spotify plumbing only as the record of a dead end.

Original note follows.

HOW MUCH IS THIS SONG ACTUALLY LISTENED TO, from Spotify's popularity score.

    python3 tools/song-popularity.py            the pruning list (1,053 songs)
    python3 tools/song-popularity.py --all      every song in a pack (3,193)

WHY. The only evidence this repo held was Australian SALES charts from 1970 on. That
measures what people bought here in one year, not what a room knows now, so every
automatic "dud" rule landed on Ain't No Sunshine, Free Bird and Lady Marmalade. Spotify
carries a popularity score from 0 to 100 per track, which is the question we actually
want answered: is anyone still listening to this.

WHAT IT CANNOT DO. Popularity is not suitability. Hot Potato by The Wiggles is famous
and, per Dean on 10 Sep, would go off in an Australian pub. A LOW score is good evidence
for cutting. A high score is not evidence for keeping, and that call is his.

CREDENTIALS. Two values, read from ~/.gflam-migrate.env (mode 600, outside the repo) and
never printed:

    SPOTIFY_CLIENT_ID=...
    SPOTIFY_CLIENT_SECRET=...

Get them from the Spotify developer dashboard: a free app registration, no user login,
no access to anybody's account, and it plays nothing. This uses the client credentials
flow, which is the one meant for exactly this.

It writes ONE dated file and changes no song and no pack.
"""
import base64, io, json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV  = Path.home() / '.gflam-migrate.env'
LIB  = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
LIST = os.path.join(ROOT, 'venueplay', 'data', 'song-unknown-candidates-2026-09-10.json')
OUT  = os.path.join(ROOT, 'venueplay', 'data', 'song-popularity-2026-09-10.json')

def die(m): print('STOP: ' + m); sys.exit(1)

def creds():
    if not ENV.exists(): die('%s is missing' % ENV)
    if oct(ENV.stat().st_mode)[-3:] != '600': die('%s must be mode 600' % ENV)
    e = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    cid, sec = e.get('SPOTIFY_CLIENT_ID', ''), e.get('SPOTIFY_CLIENT_SECRET', '')
    if not cid or not sec:
        die('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not in %s yet.\n'
            '      Add them with:  open -t %s     (never paste them into a chat)' % (ENV, ENV))
    return cid, sec

def token(cid, sec):
    body = urllib.parse.urlencode({'grant_type': 'client_credentials'}).encode()
    req = urllib.request.Request('https://accounts.spotify.com/api/token', data=body, headers={
        'Authorization': 'Basic ' + base64.b64encode(('%s:%s' % (cid, sec)).encode()).decode(),
        'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=25))['access_token']
    except urllib.error.HTTPError as x:
        die('Spotify refused the credentials (%s). Check the two values in the env file.' % x.code)

def api(tok, path, params):
    url = 'https://api.spotify.com/v1/' + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tok})
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=25))
        except urllib.error.HTTPError as x:
            if x.code == 429:
                wait = int(x.headers.get('Retry-After', '2')) + 1
                print('   (rate limited, waiting %ds)' % wait, flush=True); time.sleep(wait); continue
            if x.code in (500, 502, 503): time.sleep(2 * (attempt + 1)); continue
            return {}
        except Exception:
            time.sleep(2 * (attempt + 1))
    return {}

def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower())

def look(tok, title, artist):
    """Find the track and return (popularity, matched title, matched artist).
    Matching is deliberately strict: a wrong match would put a famous song's score
    against an obscure one and quietly protect a dud."""
    q = 'track:%s artist:%s' % (title, artist)
    d = api(tok, 'search', {'q': q, 'type': 'track', 'limit': 5, 'market': 'AU'})
    items = ((d.get('tracks') or {}).get('items')) or []
    if not items:
        d = api(tok, 'search', {'q': '%s %s' % (title, artist), 'type': 'track', 'limit': 5, 'market': 'AU'})
        items = ((d.get('tracks') or {}).get('items')) or []
    tn, an = norm(title), norm(artist)[:12]
    for it in items:
        itn = norm(it.get('name'))
        arts = ' '.join(norm(a.get('name')) for a in (it.get('artists') or []))
        if tn and (itn.startswith(tn) or tn.startswith(itn)) and (not an or an in arts):
            return it.get('popularity'), it.get('name'), ', '.join(a.get('name') for a in (it.get('artists') or []))
    return None, None, None

def main():
    every = '--all' in sys.argv
    cid, sec = creds()
    tok = token(cid, sec)

    # PROVE THE HARNESS BEFORE TRUSTING IT. The Wayback run once reported nothing found
    # and it was the harness, not the archive. A famous song must score high and an
    # obscure one must score low, or the numbers below mean nothing.
    print('harness check')
    known = [('Sexual Healing', 'Marvin Gaye'), ('Free Bird', 'Lynyrd Skynyrd'),
             ('Buffalo Traffic Jam', 'Charley Crockett')]
    got = []
    for t, a in known:
        p, mt, ma = look(tok, t, a)
        print('   %-22s %-20s popularity %s   (%s)' % (t[:21], a[:19], p, ma))
        got.append(p); time.sleep(0.2)
    if got[0] is None or got[1] is None:
        die('could not find two songs everybody knows. The matching is wrong, not the data.')
    if got[2] is not None and got[2] >= min(got[0], got[1]):
        die('an obscure track scored as high as a famous one. Stop and look at the matching.')
    print('harness proved\n')

    lib = json.load(io.open(LIB, encoding='utf-8'))
    inpack = set()
    for p in lib['playlists']: inpack.update(p['songIds'])
    if every:
        rows = [s for s in lib['songs'] if s['id'] in inpack]
    else:
        want = {r['id'] for r in json.load(io.open(LIST, encoding='utf-8'))['list']}
        rows = [s for s in lib['songs'] if s['id'] in want]
    print('looking up %d songs\n' % len(rows))

    out, n, miss = [], 0, 0
    for s in rows:
        p, mt, ma = look(tok, s.get('title', ''), s.get('artist', ''))
        if p is None: miss += 1
        out.append({'id': s['id'], 'title': s.get('title'), 'artist': s.get('artist'),
                    'year': s.get('year'), 'popularity': p, 'matched_as': ma})
        n += 1
        if n % 100 == 0: print('  %d of %d, %d not matched' % (n, len(rows), miss), flush=True)
        time.sleep(0.12)
    json.dump({'generated': '2026-09-10',
               'what_this_is': 'Spotify popularity, 0 to 100, for songs sitting in a musical bingo pack.',
               'what_this_is_not': "Suitability, which is Dean's judgement and not a tool's. A LOW score is evidence for cutting; a high one is not evidence for keeping.",
               'scope': 'every song in a pack' if every else 'the songs with no Australian chart evidence',
               'not_matched': miss, 'list': out},
              io.open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    scored = [r for r in out if r['popularity'] is not None]
    scored.sort(key=lambda r: r['popularity'])
    print('\n%d looked up, %d matched, %d not found on Spotify' % (len(out), len(scored), miss))
    if scored:
        print('\nthe twenty least listened to:')
        for r in scored[:20]:
            print('   %3d  %-38s %s' % (r['popularity'], (r['title'] or '')[:37], (r['artist'] or '')[:24]))
    print('\n-> %s' % OUT)

if __name__ == '__main__':
    main()
