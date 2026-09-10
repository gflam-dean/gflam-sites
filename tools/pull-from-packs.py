#!/usr/bin/env python3
"""Take named songs OUT of every playlist, without deleting them from the library.

WRITTEN 9 Sep 2026 AND NOT RUN. It needs Dean's word first, because what a pack holds
is what a room hears.

Why it exists: the player's card shows the song TITLE and nothing else, and the TV shows
it again on the reveal. So a title is not metadata here, it is forty phones and a wall in
a pub. The chart work on 9 Sep added songs by chart position alone, and chart position
has no opinion about a title like "Fuck It (I Don't Want You Back)".

It removes an id from every playlist and leaves the song in the songs array, so putting
one back is a one-line edit rather than a re-import, and nothing else in the file moves.

    python3 tools/pull-from-packs.py --list        show what would go, change nothing
    python3 tools/pull-from-packs.py               do it
"""
import io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')

# Titles that would be printed on a bingo card in a family pub. The two marked "already
# there" predate the chart work; they are the reason to check the whole library and not
# only what arrived today.
# EXPLICIT TITLES: EMPTY ON PURPOSE. Dean, 10 Sep 2026: "Oh put those songs in these
# guys are 18+ anyway." A pub is an adult room and these are songs the room knows. Kept
# here, empty, so the next person can see the question was asked and answered.
#     Fuck It (I Don't Want You Back), Sexy Bitch, S&M, Bitch, Smack My Bitch Up
PULL = []

# THE ACTS THEMSELVES. Nothing in this pipeline ever asked whether a song is a PROBLEM.
# It asks whether it charted, whether it has a preview clip, whether the title is
# explicit. So Gary Glitter and Rolf Harris walked into three packs on 9 Sep 2026 inside
# 805 chart additions, purely because they charted, and sat live on the site until
# somebody read the list. Both men are convicted sex offenders, most Australian radio
# will not play either, and Two Little Boys coming up on a bingo card in a pub is not a
# music problem, it is a phone call.
#
# Dean, 10 Sep 2026: "pull glitter and harris."
#
# This list is a JUDGEMENT and it is Dean's, not a rule a tool should invent. Matched on
# the artist so a future addition cannot slip through under a different title.
PULL_ARTISTS = [
    'gary glitter',
    'rolf harris',
]
# Not the plain studio recording. A room singing along to a clip that starts somewhere
# unfamiliar is a worse game, and every one of these has a studio version people know.
PULL_VERSIONS = [
    'sweat-snoop-dogg-vs-david-guetta-remix-snoop-dogg-david-guetta',
    'talk-dirty-acoustic-jason-derulo',
    'i-m-easy-cooler-version-remix-faith-no-more',
]

def main():
    show = '--list' in sys.argv
    lib = json.load(io.open(LIB, encoding='utf-8'))
    byid = {s['id']: s for s in lib['songs']}
    targets = PULL + PULL_VERSIONS
    for sid, s_ in byid.items():
        who = (s_.get('artist') or '').strip().lower()
        if any(a in who for a in PULL_ARTISTS) and sid not in targets:
            targets.append(sid)
    missing = [i for i in targets if i not in byid]
    if missing:
        print('STOP: these ids are not in the library, so the list is stale:')
        for i in missing: print('   ' + i)
        sys.exit(1)
    moved = 0
    for i in targets:
        packs = [p['name'] for p in lib['playlists'] if i in p['songIds']]
        print('  %-46s %-26s %s' % (byid[i]['title'][:45], byid[i]['artist'][:25], ', '.join(packs) or 'no pack'))
        if show: continue
        for p in lib['playlists']:
            if i in p['songIds']:
                p['songIds'] = [x for x in p['songIds'] if x != i]
                moved += 1
    if show:
        print('\n--list: nothing was changed.')
        return
    json.dump(lib, io.open(LIB, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('\n%d pack place(s) removed. Every song stays in the library.' % moved)
    print('Now run: python3 tools/release-check.py --local')

if __name__ == '__main__':
    main()
