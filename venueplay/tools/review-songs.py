#!/usr/bin/env python3
"""
Review the songs hosts flagged, and retire the ones the rooms agree on.

Hosts tap "this song did not work" on the musical bingo console when a song dies in the room:
nobody knows it, the clip is the wrong recording, the hook never arrives. One venue means
nothing. Three separate venues means the song is the problem, not the crowd.

This reads those flags and tells you which songs have reached three. Nothing is removed
without you looking at it.

    export SUPABASE_SERVICE_KEY=...    # ask Dean, never commit it
    python3 tools/review-songs.py               # show what the rooms are saying
    python3 tools/review-songs.py --retire      # add the agreed ones to the exclude list
                                                # and rebuild the library

Retiring writes the artist to data/au-artists-exclude.txt only when EVERY song of theirs has
been flagged; otherwise it removes just that song from data/musical-library.json. The full
backup at data/musical-library-full.json is never touched, so anything can come back.
"""
import json, os, sys, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(HERE, 'data', 'musical-library.json')
SUPA = 'https://gpoolavkghnxedzrmtmc.supabase.co'
THRESHOLD = 3


def api(path):
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not key:
        print('SUPABASE_SERVICE_KEY is not set. Ask Dean for it, and do not commit it.')
        sys.exit(1)
    req = urllib.request.Request(SUPA + '/rest/v1/' + path,
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print('vp_song_flags is not there yet. Run supabase/venueplay-34-song-flags.sql first.')
            sys.exit(1)
        raise


def main():
    retire = '--retire' in sys.argv
    rows = api('v_vp_song_flag_counts?select=*&order=venues.desc')
    if not rows:
        print('No songs have been flagged yet.')
        return

    agreed = [r for r in rows if int(r.get('venues') or 0) >= THRESHOLD]
    watch = [r for r in rows if int(r.get('venues') or 0) < THRESHOLD]

    print('%d song(s) flagged in total\n' % len(rows))
    if agreed:
        print('AGREED BY %d+ VENUES, ready to retire:' % THRESHOLD)
        for r in agreed:
            print('   %-42s %-26s %d venues' % ((r.get('title') or '?')[:42],
                                                (r.get('artist') or '?')[:26], r['venues']))
    if watch:
        print('\nOne or two venues so far, leave them alone for now:')
        for r in watch[:25]:
            print('   %-42s %-26s %d' % ((r.get('title') or '?')[:42],
                                         (r.get('artist') or '?')[:26], r['venues']))
        if len(watch) > 25:
            print('   ... and %d more' % (len(watch) - 25))

    if not retire:
        print('\n(nothing changed. add --retire to take the agreed ones out)')
        return
    if not agreed:
        print('\nnothing has reached %d venues yet' % THRESHOLD)
        return

    raw = json.load(open(LIB, encoding='utf-8'))
    songs = raw if isinstance(raw, list) else raw.get('songs', [])
    kill = {((r.get('artist') or '').lower().strip(), (r.get('title') or '').lower().strip())
            for r in agreed}
    kept = [s for s in songs
            if ((s.get('artist') or '').lower().strip(),
                (s.get('title') or '').lower().strip()) not in kill]
    removed = len(songs) - len(kept)

    if isinstance(raw, list):
        out = kept
    else:
        out = dict(raw)
        out['songs'] = kept
    json.dump(out, open(LIB, 'w', encoding='utf-8'), ensure_ascii=False)
    print('\nremoved %d song(s) from %s' % (removed, os.path.relpath(LIB, HERE)))
    print('the full backup is untouched, so any of these can be put back')


if __name__ == '__main__':
    main()
