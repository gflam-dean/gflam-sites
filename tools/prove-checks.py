#!/usr/bin/env python3
"""Prove the checks can fail.

A check that cannot fail is worse than no check: the green line says the job was
done. This has been the single most common shape of my own mistakes, and it does
not show up in a normal run, because a normal run is all green either way.

  release-check.py asks "is the code right?"
  this asks         "would we know if it wasn't?"

HOW. The repo is copied to a scratch directory ONCE, and every mutation happens
there. The working tree is never written to.

The first version of this did mutate the real files and put them back in a
finally block, which is fine until the process is killed between the two: a
timeout did exactly that on the first run and left musical/host.html broken. A
tool built to stop me introducing bugs introduced one, in the ten minutes it
took to write. Restore-afterwards is not a safety property. Never-touch-it is.

For each entry: break the thing the check watches in the COPY, run the gate
there, and require that THAT check goes red.

WHAT IT DOES NOT DO. Only the checks listed here are proven. The rest are
printed as UNPROVEN so the gap is visible rather than assumed away, which is the
whole point: the failure being guarded against is quiet confidence.

  prove-checks.py            prove them all
  prove-checks.py esc        just the ones whose label matches
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

# (what we expect to go red, file, find, replace, why this mutation is the right one)
#
# A mutation has to actually change what the check reads. Three of the first
# batch did not, and were reported as blind checks when the fault was mine:
# 'function' -> 'function ' is a no-op, and replacing the FIRST '"year":' takes
# the year off one song out of 5,080 when the check allows 5% to be missing. So
# find may also be a directive:
#
#   <<ALL:text>>   replace every occurrence, not the first
#   <<TRUNCATE>>   cut the file in half
#   <<EMPTY>>      leave it zero bytes
#
# Half a Worker does not parse, so four other checks catch it before the
# wholeness check is reached. Zero bytes parses perfectly, which is the case
# that check was actually written for.
MUTATIONS = [
    ('every playlist points at songs that exist',
     'venueplay/data/musical-library.json',
     '"songIds":["', '"songIds":["no-such-song","',
     'a playlist pointing at a song that is not there deals a blank cell'),

    ('esc() is the same in all',
     'venueplay/app/musical/host.html',
     'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,',
     'function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,',
     'one copy of esc quietly stops escaping quotes'),

    ('tvSend() is the same in all',
     'venueplay/app/raffle/screen.html',
     'try{ ch.send({ type:"broadcast", event:"msg", payload:obj }); }catch(e){}',
     'ch.send({ type:"broadcast", event:"msg", payload:obj });',
     'one screen loses the guard and a dead socket blacks it out'),

    ('no em dashes in copy',
     'venueplay/app/vp-feedback.js',
     'Thanks, that helps the venue',
     'Thanks — that helps the venue',
     'an em dash reaches player-facing copy through a shared script'),

    ('never "the ACT"',
     'venueplay/app/vp-gaming.js',
     "name: 'ACT'", "name: 'the ACT'",
     'the house rule breaks in the one file that is not .html'),

    ('every test reads the code this repo ships',
     'venueplay/app/vp-follow.test.js',
     '"/Users/dean.tindale/gflam-sites-current/venueplay/app/vp-follow.js"',
     '"/Users/dean.tindale/somewhere-else/vp-follow.js"',
     'a suite starts testing a copy nobody ships'),

    # AIM AT THE THING THE CHECK WATCHES. The first version of this replaced the
    # first 'pid:' in the file, which is P.pid in the state object at line 390,
    # nowhere near a /join. The check stayed green, correctly, and was reported
    # BLIND. A mutation that misses is the same mistake one level up, so every
    # entry here targets a string that only exists at the call site.
    ('every page that joins a player sends its device id',
     'venueplay/play.html',
     'playerPost("/join", { code:d.join_code, name:P.name, pid:deviceId() })',
     'playerPost("/join", { code:d.join_code, name:P.name })',
     'a phone stops sending its id and every rejoin bills a new player'),

    ('a winner is sent to the host, never the bar',
     'venueplay/tv.html',
     'show your phone to the host',
     'show your phone to the bar',
     'the locked wording drifts on one of the screens'),

    ('every shared script loads before it is used',
     'venueplay/play.html',
     '<script src="/app/vp-sign.js"></script>\n<script src="/app/vp-feedback.js"></script>',
     '<script src="/app/vp-sign.js"></script>',
     'a page uses a global and never loads the script that defines it'),

    # ---- the basics: does anything catch a broken file at all ----
    ('every script in',
     'venueplay/play.html',
     'function route(){', 'function route(){ this is not javascript',
     'a page ships with a syntax error'),

    ('every Worker actually loads',
     'venueplay-backend/worker/venueplay-game.js',
     'async function handleFeedback(', 'async function handleFeedback(((',
     'a Worker parses but cannot be loaded'),

    ('definition check across',
     'venueplay/tv.html',
     'function renderLobby(){', 'function renderLobby(){ aFunctionThatDoesNotExistAnywhere();',
     'a page calls something that does not exist'),

    # ---- the test suites: can each one still fail? ----
    ('pp-ticket.test.js',
     'partyplay-backend/lib/pp-ticket.js',
     '<<ALL:return>>', 'return null; //', 'the ticket library changes under its own suite'),

    ('pp-licence.test.js',
     'partyplay-backend/lib/pp-licence.js',
     '<<ALL:days>>', 'daze', 'the licence library changes under its own suite'),

    ('pp-quiz.test.js',
     'partyplay-backend/lib/pp-quiz.js',
     '<<ALL:return>>', 'return null; //', 'the quiz library changes under its own suite'),

    ('partyplay-api.test.js',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "if (request.method !== 'POST') {", 'if (false) {',
     'unsubscribe goes back to firing on a GET'),

    ('manager-permissions.test.js',
     'venueplay-backend/worker/venueplay-game.js',
     "&select=id,role,venue_id,permissions", "&select=id,role,venue_id",
     'requireStaff stops fetching the column every permission check reads'),

    ('live-fixes.test.js',
     'venueplay/app/musical/screen.html',
     'LOBBY_MAX_MS', 'LOBBY_MAX_MS_DISABLED',
     'the 60 minute lobby cap disappears'),

    ('slug-ladder.test.js',
     'venueplay-backend/worker/venueplay-api-FULL.js',
     'vpaUniqueSlug', 'vpaUniqueSlugRenamed',
     'the slug ladder that keeps 100 Royal Hotels apart is renamed away'),

    ('check-venue-scoping.py',
     'venueplay/app/index.html',
     '<<ALL:founding_id>>', 'founding_id_removed',
     'the venue switcher stops narrowing by account and shows one operator everybody else venues'),

    ('no song is held twice',
     'venueplay/data/musical-library.json',
     '"songs":[', '"songs":[{"id":"the-horses-daryl-braithwaite","title":"The Horses",'
                  '"artist":"Daryl Braithwaite","previewUrl":"https://x","artworkUrl":"https://x"},',
     'the same song is in the library twice and can be played twice in a night'),

    # ---- the data ----
    ('every song has audio',
     'venueplay/data/musical-library.json',
     '"previewUrl":"https', '"previewUrl":"", "x":"https',
     'a song loses its audio and the host plays silence'),

    ('songs know what year they are',
     'venueplay/data/musical-library.json',
     '<<ALL:"year":>>', '"yearWas":',
     'the years vanish and every decade pack empties'),

    # ---- the house rules and the locked wording ----
    ('never "roster" in copy',
     'venueplay/app/billing.html',
     '<h1>', '<h1>roster ',
     'the word Dean banned reaches the screen'),

    ('no file claims an exemption vp-sign does not grant',
     'venueplay/app/vp-screen-router.js',
     'screen_refresh', 'screen_refresh, winner',
     'a file claims an exemption the signer does not actually grant'),

    # ---- the Workers you paste ----
    ('venueplay-game.js is whole',
     'venueplay-backend/worker/venueplay-game.js',
     '<<EMPTY>>', '',
     'the Worker file ends up empty, which is the case this check exists for: '
     'zero bytes parses perfectly and half a file does not, so the parser catches '
     'the truncation and only this catches the emptying'),

    # This check compares the BUILD STAMP the source carries against the one in
    # the built file, so the mutation has to move the stamp. Editing the source's
    # code does not: the stamp only changes when stamp-workers.py runs, which the
    # pre-push hook does before this ever runs. That is the real guard against an
    # edited-but-unbuilt source, and it is why editing code here proves nothing.
    ('the build is this source, not an older one',
     'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
     "const BUILD = '", "const BUILD = 'not the same stamp",
     'the source is rebuilt and the deployed copy is left behind'),
]


def gate(only_label, root):
    # --local: no network. The checks proven here are all about the files, and a
    # dozen full runs with live fetches would take longer than anyone will wait.
    r = subprocess.run([sys.executable, os.path.join(root, 'tools', 'release-check.py'), '--local'],
                       capture_output=True, text=True, cwd=root)
    out = re.sub(r'\033\[[0-9;]*m', '', r.stdout + r.stderr)
    for line in out.splitlines():
        s = line.strip()
        if s.startswith('FAIL ') and only_label in s:
            return True
    return False


def scratch():
    """A copy of the repo to break. Skips .git and the workbook backups, which are
    the bulk of it and nothing here reads them."""
    d = tempfile.mkdtemp(prefix='prove-checks-')
    dst = os.path.join(d, 'repo')
    shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(
        '.git', 'node_modules', '*.backup-*', '__pycache__', '*.pyc'))
    return d, dst


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else ''
    proven = broken = skipped = 0
    tmp, repo = scratch()
    print('\n%sPROVING THE CHECKS CAN FAIL%s' % (YEL, OFF))
    print('%s  each one is broken on purpose, in a copy at %s%s\n' % (DIM, repo, OFF))

    for label, rel, find, repl, why in MUTATIONS:
        if want and want.lower() not in label.lower():
            continue
        path = os.path.join(repo, rel)
        if find is None or not os.path.exists(path):
            print('  %s----%s %s %s(no mutation written yet)%s' % (YEL, OFF, label.ljust(52), DIM, OFF))
            skipped += 1
            continue
        before = io.open(path, encoding='utf-8').read()
        if find == '<<EMPTY>>':
            after = ''
        elif find == '<<TRUNCATE>>':
            after = before[:len(before) // 2]
        elif find.startswith('<<ALL:'):
            target = find[len('<<ALL:'):-2] if find.endswith('>>') else find[len('<<ALL:'):]
            if target not in before:
                print('  %s----%s %s %sthe mutation no longer applies, rewrite it%s'
                      % (YEL, OFF, label.ljust(52), DIM, OFF))
                skipped += 1
                continue
            after = before.replace(target, repl)
        elif find not in before:
            print('  %s----%s %s %sthe mutation no longer applies, rewrite it%s'
                  % (YEL, OFF, label.ljust(52), DIM, OFF))
            skipped += 1
            continue
        else:
            after = before.replace(find, repl, 1)
        if after == before:
            print('  %s----%s %s %sthe mutation changes nothing, rewrite it%s'
                  % (YEL, OFF, label.ljust(52), DIM, OFF))
            skipped += 1
            continue
        io.open(path, 'w', encoding='utf-8').write(after)
        caught = gate(label, repo)
        io.open(path, 'w', encoding='utf-8').write(before)
        if caught:
            proven += 1
            print('  %sok%s   %s %s%s%s' % (GRN, OFF, label.ljust(52), DIM, why, OFF))
        else:
            broken += 1
            print('  %sBLIND%s %s stayed green while %s' % (RED, OFF, label.ljust(52), why))

    shutil.rmtree(tmp, ignore_errors=True)
    print('\n  %d proven, %d BLIND, %d without a mutation yet' % (proven, broken, skipped))
    if broken:
        print('  %sA check that stays green while its subject is broken is not a check.%s' % (RED, OFF))
    return 1 if broken else 0


sys.exit(main())
