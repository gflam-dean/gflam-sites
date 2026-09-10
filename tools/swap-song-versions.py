#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SWAP THE WRONG RECORDING FOR THE ONE THE ROOM KNOWS.

   A musical bingo card shows the TITLE and the host plays thirty seconds of
   audio. If that audio is a remix, a live cut, an acoustic take or a 2024
   remaster, the room reads a title it knows and hears music that sounds wrong.
   That is worse than a song nobody knows: a dud is a dead square, this is a
   familiar song that feels broken.

   The evidence is venueplay/data/song-version-swaps-2026-09-10.json, measured
   with Last.fm listener counts on 10 Sep 2026: 174 least-played songs carry a
   version marker in the title AND have a plain version with more listeners.
   Umbrella held 6,256 listeners where the plain record pulls 2,444,078.

   WHAT THIS DOES. For each of those songs it asks the Australian iTunes store
   for the plain recording (through tools/itunes-au.py, one request every five
   seconds, cached), and where it is confident the store is offering the same
   song by the same act it either swaps the recording or adds the plain one
   beside it:

     held version under 250,000 listeners   SWAP it in place. Nobody is playing
       that recording; it is simply the wrong clip for a title people know.
       Title, artist, previewUrl, artworkUrl and year are replaced and the song
       id never changes, so every card, pack and position stays where it was.

     held version at 250,000 or more        KEEP it and ADD the plain recording
       as a separate song with its own id, appended to the END of each pack the
       held one sits in. Both takes are genuinely known, so a venue gets one or
       the other on the night. A card shows titles only and the draw refuses two
       songs with the same title on one card, so the room never sees a double.
       Nothing moves: the new id goes on the end of the pack.

   SOMETIMES THE RECORDING IS ALREADY RIGHT and only the title is wrong: the
   store hands back the very clip we hold, under a cluttered name like
   "Errol (2013 Remaster)". Those get the title tidied and the audio left alone,
   because the square still has to read the way the song is known.

   WHEN IT LEAVES A SONG ALONE, and each reason is printed:
     no clip          the store has no plain recording of it
     same version     the store only offers the take we already hold
     other act        the closest match is somebody else's recording
     wrong title      the store's title is not the song we asked for
     duplicate        the library ALREADY holds that plain recording, so the
                      swap would leave two identical squares on one card

   YEARS. A 1985 song on a 2011 remaster listing would move out of its decade
   pack and turn the release gate red, so the earliest credible year wins, and
   if that still falls outside a decade pack the song sits in, the year we
   already had is kept.

       python3 tools/swap-song-versions.py             look everything up, change nothing
       python3 tools/swap-song-versions.py --apply     write the library

   Both runs write the plan to venueplay/data/song-version-swap-plan-2026-09-10.json.
   Take a backup before --apply; tools/check-song-swaps.py proves the result
   against it.
"""
import importlib.util
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
SWAPS = os.path.join(ROOT, 'venueplay', 'data', 'song-version-swaps-2026-09-10.json')
PLAN = os.path.join(ROOT, 'venueplay', 'data', 'song-version-swap-plan-2026-09-10.json')

_spec = importlib.util.spec_from_file_location(
    'itunes_au', os.path.join(ROOT, 'tools', 'itunes-au.py'))
itunes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(itunes)

# A different performance of the same song. A remaster is the same performance
# played back cleaner, so it is allowed through; the year rule below stops it
# dragging the song into the wrong decade.
OTHER_TAKE = re.compile(
    r'\b(live|remix|mix|acoustic|unplugged|demo|karaoke|instrumental'
    r"|re-?record(?:ed|ing)?|taylor's version|reprise|session|extended"
    r'|dub|cover|orchestral|a ?cappella|sped up|slowed|workout|tribute'
    r'|in the style of|edit)\b', re.I)


# A note the store puts on a title that does NOT mean a different recording:
# a guest credit, a remaster, a single or album listing, a part number.
BENIGN = re.compile(
    r'\b(remaster(?:ed)?|version|single|album|original|mono|stereo|explicit'
    r'|clean|bonus|deluxe|reissue|digital|anniversary|feat\.?|featuring|ft\.?'
    r'|with|duet|pts?\.? ?\d|parts? ?\d|\d{4})\b', re.I)


def bracket_groups(name):
    """Every top level (...) or [...] in a title, as (start, end, inside).
       Counting depth is the only way to see the whole of
       "A Whiter Shade of Pale (Original Single Version (2007 Remaster))"."""
    out, depth, start = [], 0, None
    for i, ch in enumerate(name or ''):
        if ch in '([':
            if depth == 0:
                start = i
            depth += 1
        elif ch in ')]' and depth:
            depth -= 1
            if not depth and start is not None:
                out.append((start, i, name[start + 1:i]))
                start = None
    return out


def judge(store_name, want_title):
    """What the card should say, and whether this is even the right recording.

       Returns (title, None) when the store's listing is the record we asked for,
       or (None, reason) when it is a different take. Every note on the store's
       title has to be either something the plain title itself carries, or one of
       the harmless ones above. "Blue (Da Ba Dee) [Gabry Ponte Ice Pop Radio]"
       keeps Da Ba Dee, which is part of the song, and is thrown out for the Ice
       Pop Radio, which is somebody's remix."""
    want = itunes.fold(want_title or '')
    name = store_name or ''
    drop = []
    for start, end, inside in bracket_groups(name):
        low = itunes.fold(inside)
        if start == 0 or low and low in want:
            continue                       # part of the song's actual name
        if OTHER_TAKE.search(inside) and not OTHER_TAKE.search(want_title or ''):
            return None, inside
        if BENIGN.search(inside):
            drop.append((start, end))
            continue
        return None, inside
    tail = re.search(r'\s[-–]\s(.+)$', name)
    if tail and itunes.fold(tail.group(1)) not in want:
        if OTHER_TAKE.search(tail.group(1)) and not OTHER_TAKE.search(want_title or ''):
            return None, tail.group(1)
        if BENIGN.search(tail.group(1)):
            drop.append((tail.start(), len(name) - 1))
        else:
            return None, tail.group(1)
    out = name
    for start, end in sorted(drop, reverse=True):
        out = out[:start] + out[end + 1:]
    out = re.sub(r'\s{2,}', ' ', out).strip().strip('-').strip()
    return (out or name), None


# Dean's line: a held recording this many people still play is a banger in its
# own right, so we keep it AND add the plain one beside it instead of swapping.
KEEP_BOTH = 250000


def shape(r):
    """The store's answer in the shape the library stores a song."""
    art = (r.get('artworkUrl100') or r.get('artworkUrl60') or '')
    art = art.replace('100x100bb', '600x600bb').replace('60x60bb', '600x600bb')
    y = (r.get('releaseDate') or '')[:4]
    return {'title': itunes.clean_track_title(r['trackName']),
            'artist': r['artistName'], 'previewUrl': r['previewUrl'],
            'artworkUrl': art, 'year': int(y) if y.isdigit() else None,
            '_trackName': r.get('trackName', '')}


def wide_plain(title, artist):
    """Look wider for a listing with NO take marker on it.

       The store's top twelve for Run It! are eight remixes, an a cappella and a
       no rap version with the record everybody knows sitting below them, so the
       narrow search reports "only the remix exists" when the plain record is
       right there. This asks for fifty and throws out every marked take first."""
    want_t, want_a = itunes.norm_title(title), itunes.norm_artist(artist)
    for term in ('%s %s' % (artist, title), '%s %s' % (title, artist)):
        keep = []
        for r in itunes.search(term, 50)['results']:
            if r.get('kind') != 'song' or not r.get('previewUrl'):
                continue
            if judge(r.get('trackName'), title)[1]:
                continue
            keep.append(r)
        r = itunes.pick(keep, want_t, want_a)
        if r:
            return shape(r)
    return None


def same_name(held, found):
    """Keep the artist we already show when the store has simply added the
       guests. Stardust is the act the room knows; Last.fm has 851,223 for
       Stardust and 38 for "Stardust, Benjamin Diamond & Alan Braxe", and the
       host screen has one line for it."""
    h, f = itunes.fold(held or '').strip(), itunes.fold(found or '').strip()
    return bool(h) and (h == f or f.startswith(h + ' ') or f.startswith(h + ','))


def norm_pair(title, artist):
    return (itunes.norm_title(title), itunes.norm_artist(artist))


def unique_id(base, byid):
    if base not in byid:
        return base
    n = 2
    while '%s-%d' % (base, n) in byid:
        n += 1
    return '%s-%d' % (base, n)


def fits_pack(name, year):
    """A pack named after a decade only takes songs from that decade."""
    m = re.search(r'(\d{2})s\b', name)
    if not m:
        return True
    d = int(m.group(1))
    d = 1900 + d if d >= 50 else 2000 + d
    return isinstance(year, int) and d <= year < d + 10


def decades_for(lib):
    """id -> list of (pack name, first year of that decade) for decade packs."""
    out = {}
    for p in lib['playlists']:
        m = re.search(r'(\d{2})s\b', p['name'])
        if not m:
            continue
        d = int(m.group(1))
        d = 1900 + d if d >= 50 else 2000 + d
        for sid in p['songIds']:
            out.setdefault(sid, []).append((p['name'], d))
    return out


# A greatest hits record carries the compilation's date, not the song's. The
# store sells Jackson on Columbia Country Classics dated 1958 and Shake Your Body
# on The Essential Jacksons dated 1976, and both are years out.
COMPILATION = re.compile(
    r"\b(essential|greatest hits|very best|best of|collection|anthology"
    r"|classics|number ones|ultimate|gold|vol\.? ?\d|now that's what)\b", re.I)


def choose_year(existing, found, decades, collection=''):
    """The most likely ORIGINAL release year that keeps the song inside its
       decade packs. Earliest usually means the original, because the later date
       is a remaster or a reissue, but a compilation listing is not evidence of
       anything so the year we already had wins there."""
    cands = [y for y in (found, existing) if isinstance(y, int) and y > 1900]
    if not cands:
        return existing, 'no year offered'
    if COMPILATION.search(collection or '') and isinstance(existing, int):
        order = [existing] + [y for y in cands if y != existing]
        note = 'kept ours, the store sells it on a compilation'
    else:
        order = sorted(set(cands))
        note = 'earliest of %s' % ', '.join(str(y) for y in order)
    for y in order:
        if all(d <= y < d + 10 for _, d in decades or []):
            return y, note if not decades else '%s, and it fits %s' % (
                note, ', '.join(n for n, _ in decades))
    return existing, 'kept %s so it stays in %s' % (
        existing, ', '.join(n for n, _ in decades or []))


def main():
    apply = '--apply' in sys.argv
    lib = json.load(io.open(LIB, encoding='utf-8'))
    swaps = json.load(io.open(SWAPS, encoding='utf-8'))['list']
    rows = [r for r in swaps if isinstance(r.get('gain'), int) and r['gain'] > 0]
    for a in sys.argv[1:]:
        if a.startswith('--limit='):  # a smoke test on the first few, dry run only
            rows = rows[:int(a.split('=', 1)[1])]
    byid = {s['id']: s for s in lib['songs']}
    dec = decades_for(lib)

    # Every title+artist pair already in the library, minus the songs we are
    # about to change. Swapping a live cut to its plain title on top of a plain
    # recording we already hold puts the same square on a card twice.
    swapping = {r['id'] for r in rows}
    held_pairs = {}
    for s in lib['songs']:
        if s['id'] in swapping:
            continue
        held_pairs.setdefault(norm_pair(s['title'], s['artist']), s['id'])

    plan, done, paired, tidied, left = [], 0, 0, 0, 0
    for n, r in enumerate(rows, 1):
        song = byid.get(r['id'])
        entry = {'id': r['id'], 'held_title': song['title'] if song else None,
                 'held_artist': song['artist'] if song else None,
                 'held_year': song.get('year') if song else None,
                 'held_listeners': r.get('held_listeners'),
                 'plain_title': r['plain_title'],
                 'plain_listeners': r.get('plain_listeners'),
                 'gain': r.get('gain')}
        if not song:
            entry.update(action='left', reason='not in the library any more')
            plan.append(entry)
            left += 1
            continue

        got = itunes.resolve(r['plain_title'], song['artist'])
        if got is not None and (judge(got.get('_trackName'), r['plain_title'])[1]
                                or got['previewUrl'] == song.get('previewUrl')):
            better = wide_plain(r['plain_title'], song['artist'])
            if better and better['previewUrl'] != song.get('previewUrl'):
                got = better
        if got is None:
            entry.update(action='left', reason='no clip: the store has no plain '
                                               'recording of it')
        elif itunes.norm_title(got['title']) != itunes.norm_title(r['plain_title']):
            entry.update(action='left', reason='wrong title: the store offered "%s"'
                         % got['title'], store_title=got['title'],
                         store_artist=got['artist'])
        elif not artist_ok(song['artist'], got['artist']):
            entry.update(action='left', reason='other act: the store offered "%s"'
                         % got['artist'], store_title=got['title'],
                         store_artist=got['artist'])
        elif judge(got.get('_trackName'), r['plain_title'])[1]:
            entry.update(action='left', reason='same version: the store only offers '
                         'the "%s" take, "%s"'
                         % (judge(got.get('_trackName'), r['plain_title'])[1],
                            got['_trackName']), store_title=got['_trackName'])
        elif norm_pair(got['title'], got['artist']) in held_pairs:
            entry.update(action='left', reason='duplicate: the library already holds '
                         '"%s" by %s (%s)' % (got['title'], got['artist'],
                                              held_pairs[norm_pair(got['title'],
                                                                   got['artist'])]))
        elif got['previewUrl'] == song.get('previewUrl'):
            # The recording is already right and only the title carries the
            # marker. Nothing to swap, but the square should still read the way
            # the song is known, so tidy the title and leave the audio alone.
            clean = judge(got['_trackName'], r['plain_title'])[0]
            if clean and clean != song['title']:
                entry.update(action='title', new_title=clean,
                             new_artist=song['artist'], new_year=song.get('year'),
                             reason='the recording is already the right one, the '
                                    'title just read wrong on the card',
                             store_title=got.get('_trackName'))
                if apply:
                    song['title'] = clean
                held_pairs[norm_pair(clean, song['artist'])] = song['id']
            else:
                entry.update(action='left', reason='same version: the store points '
                                                   'at the clip we already hold')
        elif (r.get('held_listeners') or 0) >= KEEP_BOTH:
            year, why = choose_year(None, got.get('year'), dec.get(r['id']),
                                    got.get('_collection'))
            newid = unique_id(itunes.kebab(judge(got['_trackName'], r['plain_title'])[0],
                                          got['artist']), byid)
            packs = [p for p in lib['playlists'] if r['id'] in p['songIds']
                     and fits_pack(p['name'], year)]
            entry.update(action='pair', new_id=newid,
                         new_title=judge(got['_trackName'], r['plain_title'])[0],
                         new_artist=got['artist'], new_year=year, year_note=why,
                         new_preview=got['previewUrl'],
                         added_to=[p['name'] for p in packs],
                         store_title=got.get('_trackName'))
            if apply:
                fresh = {'id': newid, 'title': judge(got['_trackName'], r['plain_title'])[0],
                         'artist': got['artist'], 'previewUrl': got['previewUrl'],
                         'artworkUrl': got['artworkUrl'], 'year': year}
                lib['songs'].append(fresh)
                byid[newid] = fresh
                for p in packs:
                    p['songIds'].append(newid)  # the end, so nothing moves
            held_pairs[norm_pair(got['title'], got['artist'])] = newid
        else:
            year, why = choose_year(song.get('year'), got.get('year'),
                                    dec.get(r['id']), got.get('_collection'))
            artist = (song['artist'] if same_name(song['artist'], got['artist'])
                      else got['artist'])
            entry.update(action='swap',
                         new_title=judge(got['_trackName'], r['plain_title'])[0],
                         new_artist=artist, new_year=year,
                         year_note=why, new_preview=got['previewUrl'],
                         old_preview=song.get('previewUrl'),
                         store_title=got.get('_trackName'))
            if apply:
                song['title'] = judge(got['_trackName'], r['plain_title'])[0]
                song['artist'] = artist
                song['previewUrl'] = got['previewUrl']
                song['artworkUrl'] = got['artworkUrl'] or song.get('artworkUrl')
                song['year'] = year
            held_pairs[norm_pair(got['title'], got['artist'])] = song['id']
        if entry['action'] == 'swap':
            done += 1
        elif entry['action'] == 'pair':
            paired += 1
        elif entry['action'] == 'title':
            tidied += 1
        else:
            left += 1
        plan.append(entry)
        sys.stdout.write('%3d/%d  %-8s %s\n' % (n, len(rows), entry['action'],
                                                entry['held_title']))
        sys.stdout.flush()

    with io.open(PLAN, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps({'generated': '2026-09-10',
                             'what_this_is': 'Every wrong recording we tried to '
                             'replace with the version people actually know, and '
                             'what happened to it.',
                             'applied': apply, 'swapped': done,
                             'kept_as_a_pair': paired, 'title_tidied': tidied,
                             'left': left,
                             'list': plan}, ensure_ascii=False, indent=1))
    if apply:
        with io.open(LIB, 'w', encoding='utf-8') as fh:
            fh.write(json.dumps(lib, ensure_ascii=False, indent=1))
    print('\n%d swapped, %d kept as a pair, %d titles tidied, %d left alone.'
          '\nPlan: %s%s'
          % (done, paired, tidied, left, PLAN,
             '' if apply else '  (nothing written, dry run)'))
    return 0


def artist_ok(held, found):
    """Same act. The store spells names its own way, so a lead artist match
       counts, but a different act never does."""
    a, b = itunes.norm_artist(held), itunes.norm_artist(found)
    if not a or not b:
        return False
    if a == b:
        return True
    full = re.sub(r'[^a-z0-9]+', '', itunes.fold(found))
    return len(a) >= 5 and (a in full or a in b or b in a)


if __name__ == '__main__':
    sys.exit(main())
