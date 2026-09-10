#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LIST THE SONGS IN A PACK WITH NO EVIDENCE ANYBODY HERE KNOWS THEM.

   THIS TOOL DELETES NOTHING. It writes a list and stops. Dean decides what comes
   out, because a wrong cut is a song a room loves quietly disappearing and there
   is no way to notice it has gone.

   A song is left off the list, meaning there IS evidence, if any of these hold:

     - it placed on an Australian sales chart this repo holds: the Kent and ARIA
       year-end top 25 from 1956 to 2024, the Australian number ones from the
       1950s to 2024, or an ARIA top ten peak from 2019 to 2024
     - it placed on a countdown: any triple j Hottest 100 from 1993 to 2025, the
       Hottest 100 of the 2010s, the four triple j all time countdowns, the APRA
       Top 30 Australian songs, or Triple M's Ozzest 100
     - it is one of the 256 songs hand picked into Pub Classics on 8 September.
       Those were chosen as pub singalongs by ear, not by chart, and a chart is
       exactly what a pub singalong does not need

   THE EVIDENCE BAR HERE IS MUCH WIDER THAN THE BAR FOR ADDING A SONG. A Hottest
   100 placing at 87 is not enough to earn a place in a pack, but it is plenty to
   prove somebody here knows the song, so it keeps a song off this list.

   WHAT THIS LIST IS NOT. It is not proof a song is unknown. It is proof this
   repo holds no chart or countdown naming it. Three known gaps:

     - no ARIA weekly top 50 data, only the year-end top 25, so a song that spent
       three months at number 30 and never made the year-end shows up here
     - no radio airplay data of any kind, which is how most people actually hear
       a song
     - a song under a different title or a different spelling of the act's name
       will not match its own chart row

   The list is ordered by pack and by position, so the worst offenders in a
   pack's tail read first.

   Run from the repo root:  python3 tools/prune-candidates.py
"""
import collections
import importlib.util
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'venueplay', 'data')
LIB = os.path.join(D, 'musical-library.json')
CURATION = os.path.join(D, 'song-curation-2026-09-08.json')
STRENGTH = os.path.join(D, 'song-charts-strength-2026-09-09.json')
OUT = os.path.join(D, 'song-unknown-candidates-2026-09-10.json')
WIKI_CACHE = os.environ.get('VP_WIKI_CACHE') or os.path.join(
    os.path.expanduser('~'), '.venueplay-wiki-cache')
LISTS = os.path.join(WIKI_CACHE, 'parsed-lists.json')
# The 4,381 chart placings the 9 September run parsed out of 88 Wikipedia pages.
ENTRIES = os.environ.get('VP_CHART_ENTRIES') or ''

_spec = importlib.util.spec_from_file_location(
    'itunes_au', os.path.join(ROOT, 'tools', 'itunes-au.py'))
itunes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(itunes)


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def build_evidence():
    """(normalised title, normalised artist) -> the short reason it counts."""
    ev = {}
    by_artist = collections.defaultdict(set)

    def add(title, artist, why):
        k = (itunes.norm_title(title), itunes.norm_artist(artist))
        ev.setdefault(k, why)
        by_artist[k[1]].add(k[0])

    counts = collections.Counter()
    if ENTRIES and os.path.exists(ENTRIES):
        for e in load(ENTRIES):
            src = e.get('src')
            if src == 'yearend':
                why = 'year-end top 25, %s, number %s' % (e.get('year'), e.get('rank'))
            elif src == 'numberone':
                why = 'Australian number one, %s' % e.get('year')
            elif src == 'peak':
                why = 'ARIA top ten peak, %s' % e.get('year')
            else:
                why = '%s, %s' % (src, e.get('year'))
            add(e['title'], e['artist'], why)
            counts['sales charts and all time countdowns, 1970 to 2024'] += 1

    if os.path.exists(LISTS):
        for name, rows in load(LISTS).items():
            for rank, title, artist in rows:
                if name == 'apra30':
                    why = 'APRA Top 30 Australian songs'
                elif name == 'ozzest':
                    why = "Triple M's Ozzest 100"
                elif name == 'h100-2010s':
                    why = 'Hottest 100 of the 2010s, number %d' % rank
                elif name.startswith('h100-'):
                    why = 'Hottest 100 of %s, number %d' % (name[5:], rank)
                else:
                    why = 'year-end top 25, %s, number %d' % (name[8:], rank)
                add(title, artist, why)
                counts['Hottest 100 countdowns, APRA, Ozzest, 1956 to 1969 charts'] += 1

    strength = load(STRENGTH)['songs']
    return ev, by_artist, counts, strength


def main():
    lib = load(LIB)
    ev, ev_by_artist, counts, strength = build_evidence()
    pub = set(load(CURATION)['packs'].get('Pub Classics', []))
    by_id = dict((s['id'], s) for s in lib['songs'])

    # Which acts are known here at all, so the reason can say whether the act is
    # the problem or just this one song of theirs.
    known_acts = set(ev_by_artist)

    place = collections.defaultdict(list)
    for p in lib['playlists']:
        for i, sid in enumerate(p['songIds']):
            place[sid].append({'pack': p['name'], 'position': i})

    out = []
    for sid, where in place.items():
        s = by_id.get(sid)
        if s is None:
            continue
        if sid in strength:
            continue           # added 9 September off a chart, evidence by definition
        if sid in pub:
            continue           # hand picked into Pub Classics on 8 September
        t, a = itunes.norm_title(s['title']), itunes.norm_artist(s['artist'])
        if (t, a) in ev:
            continue
        hit = None
        for h in ev_by_artist.get(a, ()):
            if len(h) >= 7 and len(t) >= 7 and (h in t or t in h):
                hit = h
                break
        if hit:
            continue
        if a in known_acts:
            why = ('nothing found for this song. %s is on the lists for %d other '
                   'song%s, so the act is known here and this one is not'
                   % (s['artist'], len(ev_by_artist[a]),
                      '' if len(ev_by_artist[a]) == 1 else 's'))
        else:
            why = ('nothing found for this song and nothing found for %s at all '
                   'on any Australian chart or countdown this repo holds'
                   % s['artist'])
        out.append({'id': sid, 'title': s['title'], 'artist': s['artist'],
                    'year': s.get('year'), 'in': sorted(
                        where, key=lambda w: (w['pack'], w['position'])),
                    'why': why})

    out.sort(key=lambda r: (r['in'][0]['pack'], r['in'][0]['position']))

    per_pack = collections.Counter()
    pack_size = {}
    for p in lib['playlists']:
        pack_size[p['name']] = len(p['songIds'])
    for r in out:
        for w in r['in']:
            per_pack[w['pack']] += 1

    save(OUT, {
        'generated': '2026-09-10',
        'what_this_is': ('Every song sitting in a musical bingo pack for which this '
                         'repo holds no Australian chart placing, no countdown '
                         'placing, and no place in the hand picked Pub Classics of '
                         '8 September. NOTHING HAS BEEN REMOVED. This is a list for '
                         'Dean to read, not an instruction.'),
        'what_this_is_not': ('Proof a song is unknown. There is no ARIA weekly top 50 '
                             'here and no airplay data at all, so a song that lived at '
                             'number 30 for three months or that radio played to death '
                             'without selling will be on this list.'),
        'evidence_checked': dict(counts),
        'songs_in_a_pack': sum(pack_size.values()),
        'candidates': len(out),
        'per_pack': dict((k, {'pack_holds': pack_size[k], 'no_evidence': per_pack.get(k, 0)})
                         for k in pack_size),
        'list': out})

    print('%-16s %8s %12s %8s' % ('pack', 'songs', 'no evidence', 'share'))
    for p in lib['playlists']:
        n = per_pack.get(p['name'], 0)
        print('%-16s %8d %12d %7.0f%%' % (p['name'], pack_size[p['name']], n,
                                          100.0 * n / max(1, pack_size[p['name']])))
    print('')
    print('distinct songs with no evidence: %d' % len(out))
    print('pack places they take up:        %d of %d'
          % (sum(per_pack.values()), sum(pack_size.values())))
    print('written to %s' % os.path.basename(OUT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
