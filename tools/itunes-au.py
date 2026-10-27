#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FIND THE REAL RECORDING ON THE AUSTRALIAN ITUNES STORE.

   Every song in musical-library.json needs four things the store gives us: the
   thirty second preview clip the pub actually hears, the cover art the TV shows,
   the release year, and the artist name spelled the way the act spells it. This
   file is the one place that asks for them, so the rate limiting and the
   "is this the right recording" rules exist once.

   THE THREE RULES THAT MATTER

   1. One request every five seconds, no exceptions. The store answers 403 when
      it has had enough, and it stays cross for several minutes.
   2. A 403 is WAITED OUT, never recorded as a miss. This is the trap that ate
      the first run on 9 September: a miss reads exactly like a song with no
      preview clip, so the result quietly shrinks and nothing looks wrong.
   3. Every search is cached to disk. A re-run costs nothing and gives the same
      answer, which is the only way any of this is checkable.

   WHAT COUNTS AS THE RIGHT RECORDING. Not a karaoke track, not a tribute band,
   not an instrumental, not a lullaby version, and not a live, acoustic, extended
   or remixed take when the plain studio record exists. The room is being asked
   to name a song off three seconds of it. Give them the record they own.

   Used as a library by tools/fix-song-recordings.py and tools/add-known-songs.py.
   Run directly to look one up:

       python3 tools/itunes-au.py "Sorrow" "David Bowie"
"""
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('VP_ITUNES_CACHE') or os.path.join(
    os.path.expanduser('~'), '.venueplay-itunes-cache')
UA = 'VenuePlay-song-research/1.0 (dean.tindale@outlook.com)'
GAP = 5.0

BAD = re.compile(r'karaoke|tribute|made famous|as made popular|originally performed'
                 r'|cover version|instrumental version|8[- ]bit|lullaby|workout'
                 r'|piano version|music box|sing[- ]?along version|in the style of'
                 r'|hit crew|studio group|ameritz|the countdown singers'
                 r'|rockabye baby|little rock star|kidz bop', re.I)

QUAL = re.compile(
    r'\s*[\(\[][^()\[\]]*\b(?:remaster(?:ed)?|version|edit|mix|mono|stereo|bonus'
    r'|deluxe|explicit|re-?record(?:ing|ed)?|anniversary|non recoupable|instrumental'
    r'|digitally|reissue|take \d+)\b[^()\[\]]*[\)\]]\s*$', re.I)

SPLIT = re.compile(r'\s+(?:feat\.?|featuring|ft\.?|with|and|&|x|vs\.?|versus|/)\s+', re.I)

_last = [0.0]


def fold(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def clean_title(s):
    if '"' in s:
        s = s.split('"')[0]
    s = re.split(r'\s+/\s+', s)[0]
    return s.strip().strip('"').strip()


def norm_title(s):
    s = fold(clean_title(s or ''))
    s = re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', ' ', s)
    s = re.sub(r'\s*-\s*(single|radio edit|remaster(ed)?|live|remix).*$', ' ', s)
    return re.sub(r'[^a-z0-9]+', '', s)


def norm_artist(s):
    s = fold(s or '')
    s = re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', ' ', s)
    lead = SPLIT.split(s)[0]
    lead = re.sub(r'^the\s+', '', lead)
    return re.sub(r'[^a-z0-9]+', '', lead)


def kebab(title, artist):
    s = fold(title + ' ' + artist)
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def clean_track_title(name):
    """Strip the store's format notes off the end of a track name. A card shows
       the title, so "Red Right Hand (2011 Remaster)" is a square of small print
       nobody reads. The audio is the same either way."""
    for _ in range(4):
        cut = QUAL.sub('', name).strip()
        if not cut or cut == name:
            break
        name = cut
    return name


def search(term, limit=12):
    """One cached iTunes AU search. Never returns a miss for a throttled call.

       limit 12 is the default because 901 searches were already cached at that
       width on 9 September and re-fetching them would cost 75 minutes of waiting
       for the same answers. limit 50 is the wide second look, cached separately."""
    key = re.sub(r'[^a-z0-9]+', '_', term.lower())[:110]
    if limit != 12:
        key = '%s__w%d' % (key, limit)
    path = os.path.join(CACHE, key + '.json')
    if os.path.exists(path):
        try:
            with io.open(path, encoding='utf-8') as fh:
                return json.load(fh)
        except ValueError:
            pass
    url = ('https://itunes.apple.com/search?country=AU&media=music&entity=song'
           '&limit=%d&term=%s' % (limit, urllib.parse.quote(term)))
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    data = None
    for _ in range(200):
        wait = GAP - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            raw = urllib.request.urlopen(req, timeout=25).read().decode('utf-8')
            _last[0] = time.time()
            data = json.loads(raw)
            break
        except Exception as e:  # noqa: BLE001
            _last[0] = time.time()
            if '403' in str(e) or '429' in str(e):
                # Blocked, not broken. Waiting is the whole point: giving up here
                # records a miss that looks exactly like a song with no clip.
                sys.stderr.write('  throttled, waiting 10 minutes\n')
                sys.stderr.flush()
                time.sleep(600)
                continue
            time.sleep(5)
    if data is None:
        return {'resultCount': 0, 'results': [], 'error': True}
    if not os.path.isdir(CACHE):
        os.makedirs(CACHE)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(data, ensure_ascii=False))
    return data


def pick(results, want_t, want_a):
    """The best studio recording of want_t by want_a, or None."""
    best, best_score = None, -1
    for r in results:
        if r.get('kind') != 'song' or not r.get('previewUrl'):
            continue
        name = r.get('trackName', '')
        art = r.get('artistName', '')
        coll = r.get('collectionName', '') or ''
        if BAD.search(art) or BAD.search(coll) or BAD.search(name):
            continue
        if re.search(r'\binstrumental\b', name, re.I):
            continue
        t, a = norm_title(name), norm_artist(art)
        score = 0
        if t == want_t:
            score += 60
        elif t.startswith(want_t) or want_t.startswith(t):
            score += 30
        else:
            continue
        na = re.sub(r'[^a-z0-9]+', '', fold(art))
        if a == want_a:
            score += 40
        elif want_a and (want_a in a or a in want_a or want_a in na):
            score += 25
        else:
            continue
        alt = re.search(r'[\(\[][^()\[\]]*\b(acoustic|live|demo|unplugged|reprise'
                        r'|orchestral|piano|session|extended|radio edit|remix|karaoke'
                        r'|single version|edit)\b[^()\[\]]*[\)\]]', name, re.I)
        if alt and not re.search(r'[\(\[]', want_t):
            score -= 45
        low = (name + ' ' + coll).lower()
        if 'live' in low and 'live' not in want_t:
            score -= 15
        if 'remix' in low and 'remix' not in want_t:
            score -= 10
        if 're-record' in low or 'rerecord' in low:
            score -= 20
        if r.get('trackExplicitness') == 'explicit':
            score -= 2
        y = (r.get('releaseDate') or '')[:4]
        if y.isdigit():
            score += max(0, (2030 - int(y))) * 0.01
        if score > best_score:
            best, best_score = r, score
    return best


def resolve(title, artist):
    """Return a library shaped song dict, or None if the store has no clip."""
    want_t, want_a = norm_title(title), norm_artist(artist)
    lead = SPLIT.split(artist, 1)[0]
    r = pick(search('%s %s' % (title, lead))['results'], want_t, want_a)
    if r is None and lead != artist:
        r = pick(search('%s %s' % (title, artist))['results'], want_t, want_a)
    if r is None:
        r = pick(search('%s %s' % (clean_title(title), lead))['results'],
                 want_t, want_a)
    if r is None:
        # The wide look. The store's top twelve for a covered song can be twelve
        # lullaby and bluegrass versions with the real record below them.
        r = pick(search('%s %s' % (artist, title), 50)['results'], want_t, want_a)
    if r is None or not r.get('previewUrl'):
        return None
    name = clean_track_title(r['trackName'])
    art = (r.get('artworkUrl100') or r.get('artworkUrl60') or '')
    art = art.replace('100x100bb', '600x600bb').replace('60x60bb', '600x600bb')
    y = (r.get('releaseDate') or '')[:4]
    return {'id': kebab(name, r['artistName']),
            'title': name,
            'artist': r['artistName'],
            'previewUrl': r['previewUrl'],
            'artworkUrl': art,
            'year': int(y) if y.isdigit() else None,
            '_trackName': r.get('trackName', ''),
            '_collection': r.get('collectionName', ''),
            '_genre': r.get('primaryGenreName', '')}


def main():
    if len(sys.argv) < 3:
        print('usage: python3 tools/itunes-au.py "<title>" "<artist>"')
        return 1
    got = resolve(sys.argv[1], sys.argv[2])
    print(json.dumps(got, ensure_ascii=False, indent=1) if got else 'no clip found')
    return 0


if __name__ == '__main__':
    sys.exit(main())
