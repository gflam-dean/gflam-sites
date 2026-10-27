#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LIFT THE TWENTY BEST ADDITIONS IN EACH PACK UP BEHIND THE TOP FIFTY.

   Background. 805 songs were added from the Australian charts on 9 September and
   put on the END of every pack, then the tail was sorted by chart strength. The
   sorting was right and it bought almost nothing, because the host page does not
   deal a pack evenly: drawGameSet in venueplay/app/musical/host.html weights
   position i by 1 / (1 + i / 45) and takes 60 songs, so everything past position
   250 is worth between 0.15 and 0.06 of a front row seat. Shuffling inside the
   tail cannot beat that curve. The gap that matters is between the front of a
   pack and the whole tail.

   What this does, which Dean approved on 10 September: in every pack, the twenty
   best known additions move to sit directly BEHIND THE EXISTING TOP FIFTY, at
   positions 50 to 69. Nothing is deleted and nothing else is re-ordered. The
   first fifty hand ranked songs keep their exact places, the rest of the hand
   ranked songs follow in their exact order, and the remaining additions follow
   those in their exact order.

   "Best known" is the same chart strength score used by
   tools/order-charted-songs.py, read from
   venueplay/data/song-charts-strength-2026-09-09.json. It is per song PER PACK,
   because a triple j all time placing counts for 20 extra in Aussie, Alternative
   and Rock and nothing in Pop or Country.

   Before and after are MEASURED, not claimed: tools/song-draw-sim.py runs 1,500
   simulated games a pack against the real weighting and the real same-title rule.

   Safe to run twice. The second run finds the same twenty songs already sitting
   at positions 50 to 69 and writes the identical file.

   Run from the repo root:  python3 tools/lift-charted-songs.py
   Then:                    python3 tools/release-check.py --local
"""
import io
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'venueplay', 'data')
LIB = os.path.join(D, 'musical-library.json')
STRENGTH = os.path.join(D, 'song-charts-strength-2026-09-09.json')

HEAD_KEEP = 50      # how many hand ranked songs stay in front of the lifted ones
LIFT_N = 20         # how many additions are lifted per pack
GAMES = 1500

TRIPLE_J_PACKS = ('Aussie', 'Alternative', 'Rock')

_spec = importlib.util.spec_from_file_location(
    'song_draw_sim', os.path.join(ROOT, 'tools', 'song-draw-sim.py'))
sim = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sim)


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def save(path, data):
    with io.open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def score(ev, pack):
    """How well Australia knows this song, in this pack. Same rules as
       tools/order-charted-songs.py, kept identical on purpose."""
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
    strength = load(STRENGTH)['songs']
    titles = sim.title_map(lib)
    added_ids = set(strength)

    rows = []
    lifted_examples = []
    for p in lib['playlists']:
        ids = p['songIds']
        before_order = list(ids)
        existing = [i for i in ids if i not in added_ids]
        adds = [i for i in ids if i in added_ids]
        if not adds:
            rows.append((p['name'], len(ids), 0, None, None, None))
            continue

        best = sorted(adds, key=lambda sid: sort_key(
            sid, strength.get(sid, {}), p['name']))[:LIFT_N]
        bestset = set(best)
        rest_adds = [a for a in adds if a not in bestset]
        after_order = (existing[:HEAD_KEEP] + best
                       + existing[HEAD_KEEP:] + rest_adds)

        if sorted(after_order) != sorted(before_order):
            print('REFUSING TO WRITE: %s would change contents. Nothing saved.'
                  % p['name'])
            return 1

        r_before = sim.deal_rates(before_order, titles, GAMES)
        r_after = sim.deal_rates(after_order, titles, GAMES)
        keep_rate = sum(r_before[i] for i in existing) / float(len(existing))
        b20_before = sum(r_before[i] for i in best) / float(len(best))
        b20_after = sum(r_after[i] for i in best) / float(len(best))

        p['songIds'] = after_order
        rows.append((p['name'], len(ids), len(best),
                     keep_rate, b20_before, b20_after))
        for sid in best[:3]:
            ev = strength.get(sid, {})
            lifted_examples.append((p['name'], sid, ev.get('title'),
                                    ev.get('artist'), ev.get('year')))

    note = lib.get('note', '')
    stamp = ('best 20 chart additions lifted behind the top 50 of each pack '
             '2026-09-10')
    if stamp not in note:
        lib['note'] = (note + ' | ' + stamp) if note else stamp

    save(LIB, lib)

    print('%-16s %6s %7s %10s %10s %10s' % (
        'pack', 'songs', 'lifted', 'kept each', 'b20 before', 'b20 after'))
    tot = [0.0, 0.0, 0.0, 0]
    for name, n, lifted, keep, b, a in rows:
        if keep is None:
            print('%-16s %6d %7d %10s %10s %10s' % (name, n, lifted, '-', '-', '-'))
            continue
        print('%-16s %6d %7d %9.1f%% %9.1f%% %9.1f%%' % (
            name, n, lifted, 100 * keep, 100 * b, 100 * a))
        tot[0] += keep
        tot[1] += b
        tot[2] += a
        tot[3] += 1
    if tot[3]:
        print('%-16s %6s %7s %9.1f%% %9.1f%% %9.1f%%' % (
            'AVERAGE', '', '', 100 * tot[0] / tot[3],
            100 * tot[1] / tot[3], 100 * tot[2] / tot[3]))
    print('')
    print('library holds %d songs' % len(lib['songs']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
