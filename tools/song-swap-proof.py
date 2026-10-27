#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IS THE NEW CLIP THE ONE PEOPLE ACTUALLY PLAY? Last.fm listener counts, before
   and after, for the songs tools/swap-song-versions.py changed.

   The whole point of the swap is that the room hears the recording it knows. A
   listener count is the only outside evidence of that, so this asks Last.fm for
   the recording we USED to hold and the recording we hold NOW, and prints them
   side by side, biggest jump first.

       python3 tools/song-swap-proof.py            the twenty biggest
       python3 tools/song-swap-proof.py --all      every song that changed

   It proves the lookup before it trusts a single number: two songs everybody
   knows must come back with real counts and one nobody knows must not. That
   harness check is what caught Spotify answering 200 with the popularity field
   simply missing, which looks exactly like a song nobody listens to.

   Read-only. Changes no song and no pack. Needs LASTFM_API_KEY in
   ~/.gflam-migrate.env.
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, 'venueplay', 'data',
                    'song-version-swap-plan-2026-09-10.json')
ENV = Path.home() / '.gflam-migrate.env'
UA = 'VenuePlay-song-check/1.0 (contact: dean.tindale@outlook.com)'


def die(m):
    print('STOP: ' + m)
    sys.exit(1)


def key():
    if not ENV.exists():
        die('%s is missing' % ENV)
    if oct(ENV.stat().st_mode)[-3:] != '600':
        die('%s must be mode 600' % ENV)
    for line in ENV.read_text().splitlines():
        if line.startswith('LASTFM_API_KEY='):
            k = line.split('=', 1)[1].strip()
            if k:
                return k
    die('LASTFM_API_KEY is not in %s' % ENV)


def listeners(k, title, artist):
    u = 'https://ws.audioscrobbler.com/2.0/?' + urllib.parse.urlencode(
        {'method': 'track.getInfo', 'api_key': k, 'artist': artist or '',
         'track': title or '', 'autocorrect': 1, 'format': 'json'})
    for attempt in range(3):
        try:
            d = json.load(urllib.request.urlopen(
                urllib.request.Request(u, headers={'User-Agent': UA}), timeout=25))
            break
        except Exception:  # noqa: BLE001
            time.sleep(1.5 * (attempt + 1))
    else:
        return None
    tr = d.get('track') or {}
    try:
        return int(tr.get('listeners') or 0) if tr else None
    except ValueError:
        return None


def main():
    k = key()
    print('harness check')
    a = listeners(k, 'Sexual Healing', 'Marvin Gaye')
    time.sleep(0.3)
    b = listeners(k, 'Free Bird', 'Lynyrd Skynyrd')
    time.sleep(0.3)
    c = listeners(k, 'Buffalo Traffic Jam', 'Charley Crockett')
    time.sleep(0.3)
    print('   Sexual Healing %s | Free Bird %s | Buffalo Traffic Jam %s' % (a, b, c))
    if not a or not b or a < 100000 or b < 100000:
        die('two songs everybody knows did not come back with real numbers. '
            'The lookup is wrong, not the data.')
    if c and c > min(a, b) / 10:
        die('a song nobody knows scored close to the standards. Stop and look '
            'at the matching.')
    print('harness proved\n')

    plan = json.load(io.open(PLAN, encoding='utf-8'))['list']
    rows = [r for r in plan if r.get('action') in ('swap', 'pair')]
    rows.sort(key=lambda r: -(r.get('gain') or 0))
    if '--all' not in sys.argv:
        rows = rows[:20]

    out = []
    print('%-42s %-20s %12s %12s' % ('song', 'artist', 'before', 'after'))
    for r in rows:
        was = listeners(k, r['held_title'], r['held_artist'])
        time.sleep(0.3)
        now = listeners(k, r['new_title'], r['new_artist'])
        time.sleep(0.3)
        used = r['new_artist']
        if r['new_artist'] != r['held_artist'] and (now or 0) < (was or 0):
            # Same act, different credit. Last.fm files Music Sounds Better With
            # You under Stardust and has 38 scrobbles for "Stardust, Benjamin
            # Diamond & Alan Braxe", so ask again under the name we started with.
            alt = listeners(k, r['new_title'], r['held_artist'])
            time.sleep(0.3)
            if (alt or 0) > (now or 0):
                now, used = alt, r['held_artist']
        out.append({'id': r['id'], 'held_title': r['held_title'],
                    'new_title': r['new_title'], 'artist': r['new_artist'],
                    'artist_asked': used, 'before': was, 'after': now})
        print('%-42s %-20s %12s %12s'
              % (r['held_title'][:42], (r['new_artist'] or '')[:20],
                 '{:,}'.format(was) if was is not None else 'not found',
                 '{:,}'.format(now) if now is not None else 'not found'))
    lifted = sum(1 for r in out if (r['after'] or 0) > (r['before'] or 0))
    print('\n%d of %d now point at a recording more people play.' % (lifted, len(out)))
    path = os.path.join(ROOT, 'venueplay', 'data',
                        'song-swap-proof-2026-09-10.json')
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps({'generated': '2026-09-10',
                             'what_this_is': 'Last.fm listeners for the recording '
                             'each song used to hold and the one it holds now.',
                             'lifted': lifted, 'checked': len(out), 'list': out},
                            ensure_ascii=False, indent=1))
    print('written to %s' % path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
