#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""READ THE AUSTRALIAN LISTS AND WORK OUT WHAT THE LIBRARY IS STILL MISSING.

   The 9 September run read the sales charts: year-end top 25, Australian number
   ones, top ten peaks, and the four triple j all time countdowns. That is what
   Australia BOUGHT. It misses what Australia VOTED for and what Australia still
   sings, so this run widens the net:

     triple j Hottest 100, every year from 1993 to 2025    the annual countdowns,
                                                           not just the all time ones
     triple j Hottest 100 of the 2010s                     the decade countdown
     APRA Top 30 Australian songs                          the songwriters' own vote
                                                           on the best Australian songs
     Triple M Ozzest 100                                   listener voted Australian
                                                           rock, which is pub music
                                                           by definition
     ARIA Hall of Fame                                     checked, see the report
     Kent year-end top 25, 1956 to 1969                    the fourteen years the
                                                           9 September run left out.
                                                           It started at 1970, and
                                                           the pages for the Countdown
                                                           era's parents do exist

   THE BAR IS STILL "WOULD A ROOM SING IT". A Hottest 100 placing at number 87 in
   2013 for a band that never played outside a festival tent is not a musical bingo
   square, so:

     - annual Hottest 100 top 20                 goes in
     - annual Hottest 100 21 to 50               goes in only if a second list
                                                 rates it too
     - annual Hottest 100 below 50               does not go in
     - decade, APRA and Ozzest lists             go in whole, they are short and
                                                 every entry on them is famous

   Output is venueplay/data/song-known-2026-09-10.json, the plan that
   tools/add-known-songs.py applies. Nothing is written to the library here.

   Wikipedia pages are cached, so a re-run costs nothing and gives the same list.

   Run from the repo root:  python3 tools/pull-known-songs.py
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'venueplay', 'data')
OUT = os.path.join(D, 'song-known-2026-09-10.json')
CACHE = os.environ.get('VP_WIKI_CACHE') or os.path.join(
    os.path.expanduser('~'), '.venueplay-wiki-cache')
UA = 'VenuePlay-song-research/1.0 (dean.tindale@outlook.com)'

H100_YEARS = list(range(1993, 2026))
EARLY_YEARS = list(range(1956, 1970))


def fetch(title):
    if not os.path.isdir(CACHE):
        os.makedirs(CACHE)
    path = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9]+', '_', title) + '.wiki')
    if os.path.exists(path):
        with io.open(path, encoding='utf-8') as fh:
            return fh.read()
    url = ('https://en.wikipedia.org/w/index.php?action=raw&title='
           + urllib.parse.quote(title))
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        s = urllib.request.urlopen(req, timeout=30).read().decode('utf-8')
    except Exception:  # noqa: BLE001
        s = ''
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(s)
    time.sleep(0.8)
    return s


def api(params):
    url = 'https://en.wikipedia.org/w/api.php?format=json&' + urllib.parse.urlencode(params)
    key = re.sub(r'[^A-Za-z0-9]+', '_', urllib.parse.urlencode(params))[:120]
    if not os.path.isdir(CACHE):
        os.makedirs(CACHE)
    path = os.path.join(CACHE, key + '.json')
    if os.path.exists(path):
        with io.open(path, encoding='utf-8') as fh:
            return json.load(fh)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    d = json.loads(urllib.request.urlopen(req, timeout=30).read().decode('utf-8'))
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(d, ensure_ascii=False))
    time.sleep(0.8)
    return d


LINK = re.compile(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]')
TAG = re.compile(r'<[^>]+>')
TEMPL = re.compile(r'\{\{[^{}]*\}\}')


def clean(cell):
    s = cell.strip()
    s = re.sub(r"^style=[^|]*\|", '', s).strip()
    s = re.sub(r'^\|', '', s).strip()
    for _ in range(3):
        s = TEMPL.sub('', s)
    s = LINK.sub(r'\1', s)
    s = TAG.sub(' ', s)
    s = s.replace("'''", '').replace("''", '')
    s = re.sub(r'\s*\(\s*\)', '', s)
    s = s.replace('&amp;', '&').replace('&nbsp;', ' ')
    s = s.strip().strip('"').strip()
    return re.sub(r'\s+', ' ', s)


def rows(wiki, want_cols=3):
    """Every data row of every wikitable, as a list of cleaned cells.

       Wikipedia writes a row two ways, all on one line separated by || or one
       cell per line, and both shapes turn up inside the same Hottest 100 page."""
    out = []
    for m in re.finditer(r'\{\|(.*?)\n\|\}', wiki, re.S):
        body = m.group(1)
        cur = []
        for line in body.split('\n'):
            line = line.rstrip()
            if line.startswith('|-') or line.startswith('|}'):
                if len(cur) >= want_cols:
                    out.append(cur)
                cur = []
                continue
            if line.startswith('!'):
                continue
            if not line.startswith('|'):
                continue
            piece = line[1:]
            if '||' in piece:
                cur.extend(clean(c) for c in piece.split('||'))
            else:
                cur.append(clean(piece))
        if len(cur) >= want_cols:
            out.append(cur)
    return out


def numeric(s):
    m = re.match(r'^(\d{1,3})$', (s or '').strip())
    return int(m.group(1)) if m else None


def parse_yearend(wiki, limit=25):
    """rank, title, artist from a Kent year-end top 25 page. The rank cell is
       written '''1.''' with the full stop inside the bold."""
    out, seen = [], set()
    for r in rows(wiki, 3):
        m = re.match(r'^(\d{1,2})\.?$', (r[0] or '').strip())
        if not m:
            continue
        n = int(m.group(1))
        if n < 1 or n > limit or n in seen:
            continue
        if not r[1] or not r[2]:
            continue
        seen.add(n)
        out.append((n, r[1], r[2]))
    return sorted(out)


def parse_h100(wiki, limit=100):
    """rank, title, artist from a Hottest 100 page."""
    got = []
    for r in rows(wiki, 3):
        n = numeric(r[0])
        if n is None or n < 1 or n > limit:
            continue
        title, artist = r[1], r[2]
        if not title or not artist or len(title) > 90:
            continue
        got.append((n, title, artist))
    seen, out = set(), []
    for n, t, a in got:
        if n in seen:
            continue
        seen.add(n)
        out.append((n, t, a))
    return sorted(out)


def parse_apra(wiki):
    """The page is two tables. The top ten are ranked. The other twenty are listed
       in year order with no rank at all, so they all take rank 20: APRA said they
       are among the thirty best Australian songs ever written and did not rank
       them, and inventing an order would be inventing evidence."""
    out, seen = [], set()
    for r in rows(wiki, 3):
        n = numeric(r[0])
        if n is not None and n <= 30:
            if n in seen:
                continue
            seen.add(n)
            out.append((n, r[1], r[2]))
            continue
        y = numeric(r[0])
        m = re.match(r'^(1[89]\d\d|20[0-2]\d)$', (r[0] or '').strip())
        if m and r[1] and r[2]:
            out.append((20, r[1], r[2]))
    return out


def ozzest():
    """Triple M's Ozzest 100 has no Wikipedia page of its own. Every song that
       made it says so in its own article, so the article search is the list."""
    got = {}
    for offset in (0, 500):
        d = api({'action': 'query', 'list': 'search', 'srlimit': 500,
                 'sroffset': offset, 'srsearch': 'insource:"Ozzest 100"'})
        for hit in d.get('query', {}).get('search', []):
            got[hit['title']] = None
        if len(d.get('query', {}).get('search', [])) < 500:
            break
    out = []
    for page in sorted(got):
        wiki = fetch(page)
        m = re.search(r'Ozzest 100[^.\n]{0,160}', wiki)
        rank = None
        if m:
            r = re.search(r'(?:number|no\.?|at|#)\s*(\d{1,3})', m.group(0), re.I)
            if r:
                rank = int(r.group(1))
        title = re.sub(r'\s*\((?:song|.*?song)\)\s*$', '', page).strip()
        art = re.search(r"\|\s*artist\s*=\s*(.+)", wiki)
        artist = clean(art.group(1)) if art else ''
        if artist:
            out.append((rank or 101, title, artist))
    return sorted(out)


def main():
    src = {}
    print('reading the lists')
    for y in H100_YEARS:
        wiki = fetch("Triple J's Hottest 100 of %d" % y)
        rowsy = parse_h100(wiki)
        src['h100-%d' % y] = rowsy
        print('  Hottest 100 of %d  %3d entries' % (y, len(rowsy)))
    dec = parse_h100(fetch("Triple J's Hottest 100 of the 2010s"))
    src['h100-2010s'] = dec
    print('  Hottest 100 of the 2010s  %d entries' % len(dec))
    apra = parse_apra(fetch('APRA Top 30 Australian songs'))
    src['apra30'] = apra
    print('  APRA Top 30 Australian songs  %d entries' % len(apra))
    ozz = ozzest()
    src['ozzest'] = ozz
    print('  Triple M Ozzest 100  %d entries' % len(ozz))
    for y in EARLY_YEARS:
        rowsy = parse_yearend(fetch('List of top 25 singles for %d in Australia' % y))
        src['yearend-%d' % y] = rowsy
        print('  Kent year-end top 25 for %d  %2d entries' % (y, len(rowsy)))

    with io.open(os.path.join(CACHE, 'parsed-lists.json'), 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(src, ensure_ascii=False, indent=1))
    total = sum(len(v) for v in src.values())
    print('')
    print('%d placings parsed from %d lists' % (total, len(src)))
    print('written to %s' % os.path.join(CACHE, 'parsed-lists.json'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
