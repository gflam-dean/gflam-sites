#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADD THE SONGS AUSTRALIA VOTED FOR, ON TOP OF THE ONES IT BOUGHT.

   Reads the lists tools/pull-known-songs.py parsed, throws away everything the
   library already holds, resolves the rest on the iTunes AU store and appends
   what is left to the packs it belongs in.

   IT IS ADD ONLY. It never removes a song and never reorders the front of a
   pack. Everything new goes on the END, behind the twenty chart additions that
   were lifted up on 10 September, so nothing new can push a banger out of a deal.

   DEDUPING IS THE PART THAT GOES WRONG. Matching on the exact title misses
   Long Way to the Top against It's a Long Way to the Top (If You Wanna Rock 'n'
   Roll), which is the same record, so a candidate is also treated as held when
   the library has a song BY THE SAME ACT whose normalised title contains the
   candidate's or the other way around. Both have to be at least seven characters
   long, because otherwise Go by Pearl Jam matches everything.

   HOW A SONG IS SCORED, out of about 100, and the score decides the order it is
   appended in. Nothing here is a guess: every number comes off a published list.

     Kent year-end top 25    102 - 2 x rank      a whole year of sales
     APRA Top 30             96 - 0.5 x rank     what Australian songwriters
                                                 voted the best songs ever written
                                                 here. The twenty APRA left
                                                 unranked all take rank 20
     Hottest 100 of the 2010s 90 - 0.35 x rank   a whole decade of listener votes
     Triple M Ozzest 100     88 - 0.3 x rank     listener voted Australian rock
     Hottest 100, one year   88 - 0.9 x rank     number one for a year scores 87,
                                                 twentieth scores 70
     hand picked             80                  the ARIA Hall of Fame and the pub
                                                 singalong are not lists of songs,
                                                 so they were tested by hand. See
                                                 venueplay/data/song-handpicked-2026-09-10.json

   Best of whichever apply, +6 when two independent lists rate it, and +20 for a
   triple j placing but only in Aussie, Alternative and Rock, exactly as
   tools/order-charted-songs.py does it.

   Run from the repo root, after tools/pull-known-songs.py:

       python3 tools/add-known-songs.py --dry     shows the numbers, writes nothing
       python3 tools/add-known-songs.py           resolves and appends
       python3 tools/release-check.py --local

   The resolve step is one iTunes call every five seconds and there are hundreds
   of them, so the first run takes about an hour. Every call is cached, so the
   second run takes seconds and gives the identical answer.
"""
import collections
import importlib.util
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'venueplay', 'data')
LIB = os.path.join(D, 'musical-library.json')
AUSSIE = os.path.join(D, 'song-aussie-artists.json')
OUT = os.path.join(D, 'song-known-2026-09-10.json')
HANDPICKED = os.path.join(D, 'song-handpicked-2026-09-10.json')
WIKI_CACHE = os.environ.get('VP_WIKI_CACHE') or os.path.join(
    os.path.expanduser('~'), '.venueplay-wiki-cache')
LISTS = os.path.join(WIKI_CACHE, 'parsed-lists.json')

_spec = importlib.util.spec_from_file_location(
    'itunes_au', os.path.join(ROOT, 'tools', 'itunes-au.py'))
itunes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(itunes)

# There is no 50s pack, and the gate fails if a decade pack holds a song from
# outside its decade, so a 1956 record joins its genre packs and no decade pack.
DECADE = {1960: '60s', 1970: '70s', 1980: '80s', 1990: '90s',
          2000: '2000s', 2010: '2010s', 2020: '2020s'}
TRIPLE_J_PACKS = ('Aussie', 'Alternative', 'Rock')

# A title that is read out on a TV in a family pub. Eight songs were pulled from
# the packs on 10 September for exactly this and for being the wrong take of a
# record, so nothing new is allowed back in through the same door.
RUDE = re.compile(r"\b(f+u+c+k|shit|bitch|cunt|nigga|asshole|arsehole|"
                  r"motherf|wank|slut|whore)", re.I)
VERSION = re.compile(r"[\(\[][^()\[\]]*\b(remix|acoustic|live|demo|unplugged|"
                     r"reprise|extended|radio edit|cooler version|karaoke|"
                     r"single version|version)\b[^()\[\]]*[\)\]]", re.I)


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def evidence():
    """Every song on every list, keyed by normalised title and artist."""
    lists = load(LISTS)
    ev = {}
    for name, entries in lists.items():
        for rank, title, artist in entries:
            key = (itunes.norm_title(title), itunes.norm_artist(artist))
            e = ev.setdefault(key, {'title': title, 'artist': artist,
                                    'h100': [], 'decade': None, 'apra': None,
                                    'ozzest': None, 'year_end': []})
            if name == 'h100-2010s':
                e['decade'] = min(rank, e['decade'] or 999)
            elif name == 'apra30':
                e['apra'] = min(rank, e['apra'] or 999)
            elif name == 'ozzest':
                e['ozzest'] = min(rank, e['ozzest'] or 999)
            elif name.startswith('h100-'):
                e['h100'].append([int(name[5:]), rank])
            elif name.startswith('yearend-'):
                e['year_end'].append([int(name[8:]), rank])
    # Two of the sources on the brief, the ARIA Hall of Fame and the pub
    # singalong, are not lists of songs and cannot be scraped. They were tested
    # by hand instead and what survived that test lives in the hand picked file.
    # A hand picked song scores 80, which puts it level with a year-end top ten
    # finish: high enough to sit near the front of the new tail, not so high that
    # a judgement call outranks a whole year of Australian sales.
    if os.path.exists(HANDPICKED):
        for h in load(HANDPICKED)['songs']:
            key = (itunes.norm_title(h['title']), itunes.norm_artist(h['artist']))
            e = ev.setdefault(key, {'title': h['title'], 'artist': h['artist'],
                                    'h100': [], 'decade': None, 'apra': None,
                                    'ozzest': None, 'year_end': []})
            e['handpicked'] = h['why']
            e['handpicked_score'] = h.get('score', 80)
            if h.get('year'):
                e['handpicked_year'] = h['year']

    for e in ev.values():
        e['h100'].sort()
        e['year_end'].sort()
        e['best_h100'] = min([r for _, r in e['h100']] or [None] or [None]) \
            if e['h100'] else None
        e['best_year_end'] = min([r for _, r in e['year_end']]) if e['year_end'] else None
    return ev


def sources(e):
    n = 0
    for k in ('decade', 'apra', 'ozzest'):
        if e.get(k):
            n += 1
    if e.get('h100'):
        n += 1
    if e.get('year_end'):
        n += 1
    return n


EXCLUDED_ACTS = ('rolfharris', 'garyglitter')
EXCLUDED_SONGS = (('ascottishsoldier', 'andystewart'),
                  ('myboomerangwontcomeback', 'charliedrake'),
                  ('advanceaustraliafair', ''))


def excluded(t, a):
    """Kept out on judgement, not on evidence. The reasons are written down in
       venueplay/data/song-handpicked-2026-09-10.json under "excluded" so they
       can be argued with rather than quietly applied."""
    if a in EXCLUDED_ACTS:
        return True
    for xt, xa in EXCLUDED_SONGS:
        if t == xt and (not xa or a == xa):
            return True
    return False


def clears_bar(e):
    """Would a room sing it. See the note at the top of the file."""
    if e.get('handpicked'):
        return True
    if e.get('decade') or e.get('apra') or e.get('ozzest'):
        return True
    ye = e.get('best_year_end')
    if ye:
        # The 1956 to 1969 year-end pages are new to this run, and the further
        # back they go the less of that year a pub would name today. 1963 is where
        # the line sits: from there on the top 25 is Beatles, Stones, Seekers and
        # Elvis, which still gets sung. Before that, a year-end finish outside the
        # top ten is Mitch Miller and Johnnie Ray.
        first = min(y for y, _ in e['year_end'])
        if first >= 1963 or ye <= 10:
            return True
    h = e.get('best_h100')
    if h and h <= 20:
        return True
    if h and h <= 50 and sources(e) >= 2:
        return True
    return False


def score(e, pack):
    parts = []
    if e.get('best_year_end'):
        parts.append(102 - 2 * e['best_year_end'])
    if e.get('apra'):
        parts.append(96 - 0.5 * e['apra'])
    if e.get('decade'):
        parts.append(90 - 0.35 * e['decade'])
    if e.get('ozzest'):
        parts.append(88 - 0.3 * e['ozzest'])
    if e.get('best_h100'):
        parts.append(88 - 0.9 * e['best_h100'])
    if e.get('handpicked'):
        parts.append(e.get('handpicked_score', 80))
    s = max(parts) if parts else 0
    if sources(e) >= 2:
        s += 6
    if (e.get('decade') or e.get('best_h100')) and pack in TRIPLE_J_PACKS:
        s += 20
    return s


def sort_key(sid, e, pack):
    return (-score(e, pack), e.get('best_year_end') or 999,
            e.get('best_h100') or 999, sid)


def genre_packs(genre, year, artist_norm, aussie, best_year_end, e):
    """Which packs a song belongs in. Same rules the 9 September run used, with
       the two new Australian lists added: everything on the Ozzest 100 or the
       APRA Top 30 is Australian by definition, so it goes in the Aussie pack
       whether or not the act is on the hand-kept Australian artist list."""
    g = (genre or '').lower()
    out = []
    if 'hip-hop' in g or 'rap' in g:
        out.append('Hip-Hop & R&B')
    elif 'r&b' in g or 'soul' in g:
        out.append('Soul & Motown' if year < 1980 else 'Hip-Hop & R&B')
    elif 'country' in g:
        out.append('Country')
    elif 'disco' in g:
        out.append('Disco')
    elif 'funk' in g:
        out.append('Funk')
    elif 'dance' in g or 'electronic' in g or 'house' in g or 'techno' in g:
        out.append('Dance & Club')
    elif 'alternative' in g or 'punk' in g or 'grunge' in g or 'indie' in g:
        out.append('Alternative')
    elif 'metal' in g or 'hard rock' in g or g == 'rock':
        out.append('Rock')
        if 1980 <= year < 1990:
            out.append('80s Rock')
    elif 'pop' in g or 'singer' in g or 'contemporary' in g or 'easy' in g \
            or 'soundtrack' in g or 'vocal' in g:
        out.append('Pop')
        if year >= 2010:
            out.append('Modern Pop')
    if artist_norm in aussie or e.get('ozzest') or e.get('apra'):
        out.append('Aussie')
    # Pub Classics is what a host reaches for when the room is mixed and older.
    # A top ten finish for a WHOLE year, or a place on the two Australian all
    # time lists, and old enough to have been played to death since.
    #
    # The floor of 1963 is new and it exists because the 1956 to 1969 year-end
    # charts are new. The hand picked pack does hold nineteen songs from the
    # 1950s, and every one of them is rock and roll: Tutti Frutti, Long Tall
    # Sally, Bye Bye Love. The year-end charts of those same years are Bing
    # Crosby, Perry Como, Mitch Miller and Doris Day, and a bar will not sing
    # Just Walking in the Rain. They still go in the 60s pack and their genre
    # packs, at the back, where the weighting keeps them rare.
    if 1963 <= year < 2000 and ((best_year_end and best_year_end <= 10)
                        or (e.get('ozzest') and e['ozzest'] <= 50)
                        or e.get('apra')
                        or e.get('handpicked_score', 0) >= 80):
        out.append('Pub Classics')
    return out


def main(argv):
    dry = '--dry' in argv
    lib = load(LIB)
    ev = evidence()
    aussie = set(a for a in load(AUSSIE) if len(a) >= 4)
    pack_names = set(p['name'] for p in lib['playlists'])

    have_ta = set()
    by_artist = collections.defaultdict(set)
    have_ids = set()
    for s in lib['songs']:
        t, a = itunes.norm_title(s['title']), itunes.norm_artist(s['artist'])
        have_ta.add((t, a))
        by_artist[a].add(t)
        have_ids.add(s['id'])

    def held(t, a):
        if (t, a) in have_ta:
            return True
        for h in by_artist.get(a, ()):
            if len(h) >= 7 and len(t) >= 7 and (h in t or t in h):
                return True
        return False

    cands = []
    for (t, a), e in ev.items():
        if held(t, a) or excluded(t, a):
            continue
        if not clears_bar(e):
            continue
        cands.append(((t, a), e))
    cands.sort(key=lambda c: -score(c[1], ''))
    print('%d songs across the lists, %d not held, %d clear the bar'
          % (len(ev), sum(1 for (t, a) in ev if not held(t, a)), len(cands)))
    if dry:
        for (t, a), e in cands[:15]:
            print('  %-44s %-28s %s' % (e['title'][:44], e['artist'][:28],
                                        round(score(e, ''), 1)))
        return 0

    resolved, noclip, xmas, dupe, rude = [], [], [], [], []
    for i, ((t, a), e) in enumerate(cands):
        if i % 25 == 0:
            print('  ... %d of %d looked up, %d resolved'
                  % (i, len(cands), len(resolved)))
            sys.stdout.flush()
        got = itunes.resolve(e['title'], e['artist'])
        if not got or not got.get('previewUrl') or not got.get('year'):
            noclip.append(e)
            continue
        if RUDE.search(got['title']) or VERSION.search(got['title']):
            rude.append(dict(e, store_title='%s, %s'
                             % (got['title'], got['artist'])))
            continue
        g = (got.get('_genre') or '').lower()
        if 'christmas' in g or 'holiday' in g or 'christmas' in got['title'].lower() \
                or 'children' in g or "kid" == g:
            xmas.append(e)
            continue
        if got['id'] in have_ids:
            dupe.append(e)
            continue
        if held(itunes.norm_title(got['title']), itunes.norm_artist(got['artist'])):
            dupe.append(e)
            continue
        have_ids.add(got['id'])
        by_artist[itunes.norm_artist(got['artist'])].add(itunes.norm_title(got['title']))
        # The store's release date is the date of the album it served up, which
        # for an old single is usually a much later compilation. Deep Purple's
        # Black Night comes back as 2004. The year the song CHARTED is the real
        # one, and it is the number the decade packs are built on.
        chart_years = [y for y, _ in e.get('year_end', [])] + \
                      [y for y, _ in e.get('h100', [])]
        if chart_years:
            got['year'] = min(chart_years)
        if e.get('handpicked_year'):
            got['year'] = e['handpicked_year']
        got['_ev'] = e
        resolved.append(got)

    additions = collections.defaultdict(list)
    detail = []
    for s in resolved:
        e = s['_ev']
        year = int(s['year'])
        packs = []
        d = DECADE.get(year // 10 * 10)
        if d:
            packs.append(d)
        packs += genre_packs(s.get('_genre'), year,
                             itunes.norm_artist(s['artist']), aussie,
                             e.get('best_year_end'), e)
        packs = [p for p in dict.fromkeys(packs) if p in pack_names]
        for p in packs:
            additions[p].append(s['id'])
        detail.append({'id': s['id'], 'title': s['title'], 'artist': s['artist'],
                       'year': year, 'genre': s.get('_genre'), 'packs': packs,
                       'evidence': e})

    for name in additions:
        e_by_id = dict((d2['id'], d2['evidence']) for d2 in detail)
        additions[name] = sorted(additions[name],
                                 key=lambda sid: sort_key(sid, e_by_id[sid], name))

    plan = {'generated': '2026-09-10',
            'why': ('Songs Australia voted for rather than bought: the triple j '
                    'Hottest 100 for every year from 1993 to 2025, the Hottest 100 '
                    'of the 2010s, the APRA Top 30 Australian songs, Triple M\'s '
                    'Ozzest 100, and the Kent year-end top 25 for 1956 to 1969, '
                    'which the 9 September run left out because it started at 1970. '
                    'Everything here was missing from the library, clears the bar '
                    'in tools/pull-known-songs.py and has a real preview clip. '
                    'pack_additions go on the END of each pack.'),
            'new_songs': [dict((k, v) for k, v in s.items()
                               if not k.startswith('_')) for s in resolved],
            'pack_additions': dict((k, v) for k, v in sorted(additions.items())),
            'detail': detail,
            'dropped_no_clip': [{'title': e['title'], 'artist': e['artist']}
                                for e in noclip],
            'dropped_christmas_or_kids': [{'title': e['title'], 'artist': e['artist']}
                                          for e in xmas],
            'dropped_already_held_under_another_name':
                [{'title': e['title'], 'artist': e['artist']} for e in dupe],
            'dropped_rude_title_or_wrong_take':
                [{'title': e['title'], 'artist': e['artist'],
                  'the_only_recording_the_store_offered': e.get('store_title')}
                 for e in rude]}
    save(OUT, plan)

    # The resolve step takes about an hour, and another session edits this file.
    # Re-read it now so an hour old copy cannot quietly undo somebody else's work:
    # on 10 September the five songs Dean asked to be put back went in during a
    # run exactly like this one.
    lib = load(LIB)
    before = dict((p['name'], len(p['songIds'])) for p in lib['playlists'])
    by_id = dict((s['id'], s) for s in lib['songs'])
    added = 0
    for s in plan['new_songs']:
        if s['id'] in by_id:
            continue
        lib['songs'].append(s)
        by_id[s['id']] = s
        added += 1
    for p in lib['playlists']:
        for sid in plan['pack_additions'].get(p['name'], []):
            if sid not in p['songIds']:
                p['songIds'].append(sid)
    note = lib.get('note', '')
    stamp = ('songs Australia voted for added from the Hottest 100 year '
             'countdowns, the APRA Top 30, the Ozzest 100 and the 1956 to 1969 '
             'year-end charts 2026-09-10')
    if stamp not in note:
        lib['note'] = (note + ' | ' + stamp) if note else stamp
    save(LIB, lib)

    print('')
    print('%-16s %8s %8s %8s' % ('pack', 'before', 'added', 'after'))
    for p in lib['playlists']:
        n = len(plan['pack_additions'].get(p['name'], []))
        print('%-16s %8d %8d %8d' % (p['name'], before[p['name']], n,
                                     len(p['songIds'])))
    print('')
    print('resolved with a clip   %d' % len(resolved))
    print('no clip in the store   %d' % len(noclip))
    print('Christmas or kids      %d' % len(xmas))
    print('already held           %d' % len(dupe))
    print('rude title or a remix  %d' % len(rude))
    print('songs added            %d' % added)
    print('library holds          %d songs' % len(lib['songs']))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
