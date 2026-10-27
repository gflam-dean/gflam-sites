#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT THE ADDED SONGS IN ORDER OF HOW WELL AUSTRALIA KNOWS THEM.

   The 805 songs added on 9 September went on the end of each pack in alphabetical
   order of their id, which means nothing at all. That matters more than it sounds,
   because the host page does not deal a pack evenly. drawGameSet in
   venueplay/app/musical/host.html weights position i by 1/(1+i/45) and takes 60
   songs, so a song at the front of a 700 song pack is about three times as likely
   to be dealt as one at position 400. Sorting the tail alphabetically put A Bar
   Song (Tipsy) ahead of We Are the World.

   This tool re-orders ONLY the part of each pack that was appended on 9 September.
   The songs that were there before keep their exact positions and their exact
   order: the first N ids of every pack stay byte-identical to the pre-charts
   backup, and the tool refuses to write if that is not true.

   HOW A SONG IS SCORED, out of about 100. Every number comes from
   venueplay/data/song-charts-strength-2026-09-09.json, which is the parsed
   Wikipedia chart data:

     year-end placing   102 - 2 x rank      a whole year of sales is the best
                                            single sign of how played a song is.
                                            Year-end number one scores 100,
                                            top five 92 or better, 25th scores 52.
     Australian number one          85      big, but it can be one quiet fortnight,
                                            so it sits below a year-end top five.
     top ten peak       84 - 4 x peak       a number two peak scores 76, a number
                                            nine peak scores 48.
     triple j all time  92 - 0.42 x rank    number one on an all time countdown
                                            scores 92, hundredth scores 50.

   A song takes the BEST of whichever of those apply, then:

     +6   if two or more independent sources rate it (a year-end placing AND a
          number one, say). Two charts agreeing is worth something.
     +20  for a triple j all time placing, but ONLY in the Aussie, Alternative and
          Rock packs. Killing in the Name never troubled the year-end top 25 and
          belongs near the front of a rock pack anyway. The same placing earns
          nothing extra in Pop or Country, where that crowd is not the audience.

   So the score is per song PER PACK, and the same song can sit high in Alternative
   and lower in Pop. Ties break on the better year-end placing, then the older song
   first, then the id, so a re-run always produces the identical order.

   Run from the repo root:   python3 tools/order-charted-songs.py
   Then:                     python3 tools/release-check.py --local
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'venueplay', 'data')
LIB = os.path.join(D, 'musical-library.json')
BACKUP = os.path.join(D, 'musical-library.backup-2026-09-09-pre-charts.json')
PLAN = os.path.join(D, 'song-charts-2026-09-09.json')
STRENGTH = os.path.join(D, 'song-charts-strength-2026-09-09.json')

TRIPLE_J_PACKS = ('Aussie', 'Alternative', 'Rock')


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def score(ev, pack):
    """How well Australia knows this song, in this pack. See the note above."""
    parts = []
    ye = ev.get('best_year_end')
    if ye:
        parts.append(102 - 2 * ye)
    if ev.get('number_one'):
        parts.append(85)
    pk = ev.get('best_peak')
    if pk and not ev.get('number_one'):
        parts.append(84 - 4 * pk)
    h1 = ev.get('best_hottest100')
    if h1:
        parts.append(92 - 0.42 * h1)
    s = max(parts) if parts else 0

    sources = 0
    if ye:
        sources += 1
    if ev.get('number_one'):
        sources += 1
    if h1:
        sources += 1
    if sources >= 2:
        s += 6
    if h1 and pack in TRIPLE_J_PACKS:
        s += 20
    return s


def sort_key(sid, ev, pack):
    return (-score(ev, pack),
            ev.get('best_year_end') or 999,
            ev.get('year') or 9999,
            sid)


def main():
    lib = load(LIB)
    before = load(BACKUP)
    plan = load(PLAN)
    strength = load(STRENGTH)['songs']

    b_packs = dict((p['name'], p['songIds']) for p in before['playlists'])
    moved, unscored = 0, 0
    report = []

    for p in lib['playlists']:
        head = b_packs.get(p['name'], [])
        n = len(head)
        if p['songIds'][:n] != head:
            print('REFUSING TO WRITE: %s does not start with the songs it had '
                  'before. Nothing was changed.' % p['name'])
            return 1
        tail = p['songIds'][n:]
        if not tail:
            report.append((p['name'], n, 0, 0))
            continue
        missing = [i for i in tail if i not in strength]
        unscored += len(missing)
        new_tail = sorted(tail, key=lambda sid: sort_key(
            sid, strength.get(sid, {}), p['name']))
        assert sorted(new_tail) == sorted(tail), 'the tail changed contents'
        changed = sum(1 for a, b in zip(tail, new_tail) if a != b)
        moved += changed
        p['songIds'] = head + new_tail
        report.append((p['name'], n, len(tail), changed))

        # Keep the plan file in step, so re-running add-charted-songs.py from the
        # backup rebuilds this exact order rather than the alphabetical one.
        add = plan.get('pack_additions', {}).get(p['name'])
        if add:
            plan['pack_additions'][p['name']] = sorted(
                add, key=lambda sid: sort_key(sid, strength.get(sid, {}), p['name']))

    note = lib.get('note', '')
    stamp = ('added songs ordered by chart strength 2026-09-09 '
             '(year-end placing, Australian number ones, top ten peaks, '
             'triple j all time countdowns)')
    if stamp not in note:
        lib['note'] = (note + ' | ' + stamp) if note else stamp

    save(LIB, lib)
    save(PLAN, plan)

    print('%-16s %7s %7s %9s' % ('pack', 'kept', 'tail', 'moved'))
    for name, kept, tail, changed in report:
        print('%-16s %7d %7d %9d' % (name, kept, tail, changed))
    print('')
    print('tail places re-ordered: %d' % moved)
    print('tail songs with no chart evidence: %d' % unscored)
    print('library holds %d songs' % len(lib['songs']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
