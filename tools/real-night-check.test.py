#!/usr/bin/env python3
"""THE REAL-NIGHT RECORD, AND RELEASE.PY'S STEP 6 THAT READS IT (INBOX 295.1, 12 Nov 2026). RUN, not read.

    python3 tools/real-night-check.test.py

A full record (five games, shots on disk, PASS by a named person, The Mini Bar, the Kogan TV app, two phones)
is written to a temp folder and must pass tools/real-night-check.py. Then each thing the night needs is taken
away, one at a time, and the check must fail and say why: a missing game, a game out of order, no TV shot, no
phone shot, a shot whose file is not there, no PASS line, a FAIL, a result with no name, another build's record,
another venue, a TV that is not the Kogan app, one phone, the same phone twice, a game not played on both phones,
a line still in the template. The template itself, as shipped, must fail (nothing filled in).

Then release.py's step 6 (real_night): OFF unless VP_REAL_NIGHT=1 (and it says so); ON with no record or a bad
one it is not done; ON with the good record it is. Nothing here touches git, the network or the live site;
VP_REAL_NIGHT_DIR points both tools at the temp folder.
"""
import importlib.util, io, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


TMP = tempfile.mkdtemp(prefix='real-night-')
os.environ['VP_REAL_NIGHT_DIR'] = TMP
RN = load('real_night_check', 'tools/real-night-check.py')
BUILD = '7b65d053a1b2c3d4e5f60718293a4b5c6d7e8f90'
GAMES = ['Trivia', 'Musical bingo', 'Bingo', 'Raffle', 'Members draw']
os.makedirs(os.path.join(TMP, 'shots'))
for g in GAMES:
    k = g.split()[0].lower()
    for w in ('tv', 'phone-a'):
        io.open(os.path.join(TMP, 'shots', '%s-%s.png' % (k, w)), 'wb').write(b'\x89PNG fake')


def section(g, tv=True, phone=True, phones='A, B', result='PASS by Claude (main)'):
    k = g.split()[0].lower()
    out = ['## ' + g]
    if tv: out.append('TV shot: shots/%s-tv.png' % k)
    if phone: out.append('Phone shot: shots/%s-phone-a.png' % k)
    if phones is not None: out.append('Phones: ' + phones)
    if result is not None: out.append('Result: ' + result)
    out.append('Notes: none')
    return '\n'.join(out)


def record(build=BUILD[:8], venue='The Mini Bar', tv='Kogan TV app 192.168.68.58', pa="Dean's iPhone 15", pb='Test Android',
           games=None, settings='The Mini Bar as saved live', **per):
    head = ['# Real night: ' + build, '', 'Build: ' + build, 'Date: 2026-11-12 19:30 Brisbane', 'Venue: ' + venue, 'TV: ' + tv]
    if pa is not None: head.append('Phone A: ' + pa)
    if pb is not None: head.append('Phone B: ' + pb)
    head.append('Settings: ' + settings)
    body = []
    for g in (games or GAMES):
        body.append(section(g, **per.get(g, {})))
    return '\n'.join(head) + '\n\n' + '\n\n'.join(body) + '\n'


def judge(text, build=BUILD):
    return RN.check_text(text, build, TMP)


def fails(name, text, word, build=BUILD):
    why = judge(text, build)
    ok(name, bool(why) and any(word.lower() in w.lower() for w in why), why)


print('\nA full record passes')
why = judge(record())
ok('the good record (five games, shots on disk, PASS by name, Mini Bar, Kogan app, two phones) passes', why == [], why)
ok('the full 40-character id in the record passes too', judge(record(build=BUILD)) == [], judge(record(build=BUILD)))
io.open(RN.record_path(BUILD), 'w', encoding='utf-8').write(record())
good, why, path = RN.check(BUILD)
ok('check() finds <build[:8]>.md in VP_REAL_NIGHT_DIR and passes it', good and path == os.path.join(TMP, BUILD[:8] + '.md'), (good, why, path))
r = subprocess.run([sys.executable, 'tools/real-night-check.py', BUILD], cwd=ROOT, capture_output=True, text=True, env=dict(os.environ))
ok('the command says REAL NIGHT RECORDED and exits 0', r.returncode == 0 and 'REAL NIGHT RECORDED' in r.stdout, (r.returncode, r.stdout[-300:]))

print('\nEach missing piece fails, and says why')
for g in GAMES:
    fails('no %s section' % g, record(games=[x for x in GAMES if x != g]), '%s section is missing' % g)
fails('a game twice', record(games=GAMES + ['Bingo']), 'there 2 times')
fails('the games out of order (bingo before musical bingo)', record(games=['Trivia', 'Bingo', 'Musical bingo', 'Raffle', 'Members draw']), 'order')
fails('a section that is not one of the five', record(games=GAMES + ['Karaoke']), 'not one of the five')
for g in ('Trivia', 'Raffle', 'Members draw'):
    fails('%s: no TV shot' % g, record(**{g: {'tv': False}}), '%s: no TV shot' % g)
    fails('%s: no phone shot' % g, record(**{g: {'phone': False}}), '%s: no phone shot' % g)
    fails('%s: no Result line' % g, record(**{g: {'result': None}}), '%s: no "Result' % g)
fails('a TV shot whose file is not on disk', record().replace('shots/bingo-tv.png', 'shots/bingo-tv-MISSING.png'), 'Bingo: the TV shot')
fails('a phone shot whose file is not on disk', record().replace('shots/musical-phone-a.png', 'shots/nope.png'), 'Musical bingo: the phone shot')
fails('a FAIL in any game', record(**{'Musical bingo': {'result': 'FAIL by Claude (main)'}}), 'Musical bingo: FAIL')
fails('a PASS with no name', record(**{'Bingo': {'result': 'PASS'}}), 'Bingo: the result')
fails('a result that is neither PASS nor FAIL', record(**{'Raffle': {'result': 'looked ok by Claude'}}), 'Raffle: the result')
fails('a game not played on both phones (Phones: A)', record(**{'Bingo': {'phones': 'A'}}), 'Bingo: does not say')
fails('a game with no Phones line', record(**{'Trivia': {'phones': None}}), 'Trivia: does not say')
fails('another build\'s record', record(build='606b3959'), 'not this release')
fails('a Build line that is not a commit id', record(build='tonight'), 'Build line')
fails('a record checked against no build at all', record(), 'not this release', build='')
fails('another venue (Test Alpha)', record(venue='Test Alpha'), 'Venue')
fails('a TV that is not the Kogan app (a laptop Chrome tab)', record(tv='Chrome on the Mac'), 'Kogan TV app')
fails('the Kogan, but not its address', record(tv='Kogan TV app'), 'Kogan TV app')
fails('only one phone named', record(pb=None), 'Phone A and Phone B must both')
fails('the same phone twice', record(pb="Dean's iPhone 15"), 'same phone')
fails('no Settings line (fresh defaults are not a real night)', record().replace('Settings: The Mini Bar as saved live\n', ''), 'Settings')
fails('a line still in the template\'s angle brackets', record().replace('Notes: none', 'Notes: <what was seen>', 1), 'placeholder')
fails('a TODO left in', record(pa='TODO'), 'Phone A and Phone B must both')
t = io.open(os.path.join(ROOT, 'tools', 'real-night-template.md'), encoding='utf-8').read()
why = judge(t.replace('BUILD8', BUILD[:8]))
ok('the template as shipped (nothing filled in) fails, on its placeholders', len(why) >= 10 and any('placeholder' in w for w in why), why[:4])
r = subprocess.run([sys.executable, 'tools/real-night-check.py', 'deadbeefcafe'], cwd=ROOT, capture_output=True, text=True, env=dict(os.environ))
ok('the command with no record says NO REAL NIGHT and exits 1', r.returncode == 1 and 'NO REAL NIGHT' in r.stdout and 'no real-night record' in r.stdout, (r.returncode, r.stdout[-300:]))

print('\nrelease.py step 6 (real_night), the hand-played record (VP_REAL_NIGHT_MODE=hand); the free mode is tools/real-night-free.test.py')
REL = load('release_under_test', 'tools/release.py')
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT_MODE': 'hand'})
ok('ON by default (INBOX 374): no VP_REAL_NIGHT set, the hand-played record is asked for', on is True, (on, good, lines))
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '0', 'VP_REAL_NIGHT_MODE': 'hand'})
ok('VP_REAL_NIGHT=0 with no reason is ignored: still on, and the log says a reason is needed', on is True and 'ignored' in ' '.join(lines) and 'VP_REAL_NIGHT_REASON' in ' '.join(lines), (on, lines))
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '0', 'VP_REAL_NIGHT_REASON': 'rehearsal'})
ok('VP_REAL_NIGHT=0 with a reason is off, and the reason is in the lines', on is False and good is True and 'rehearsal' in ' '.join(lines), (on, good, lines))
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_MODE': 'hand'})
ok('ON with the good record for this build: done', on is True and good is True and 'recorded' in lines[0], (on, good, lines))
on, good, lines = REL.real_night('606b3959aaaaaaaa', env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_MODE': 'hand'})
ok('ON with no record for this build: NOT done, and it names the file to write', on is True and good is False and '606b3959.md' in ' '.join(lines), (on, good, lines))
io.open(RN.record_path(BUILD), 'w', encoding='utf-8').write(record(**{'Raffle': {'result': 'FAIL by Claude (main)'}}))
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_MODE': 'hand'})
ok('ON with a record that has a FAIL: NOT done, and the FAIL is printed', on is True and good is False and any('Raffle: FAIL' in l for l in lines), lines)
src = io.open(os.path.join(ROOT, 'tools', 'release.py'), encoding='utf-8').read()
i5, i6, iL = src.find("step(5, 'the full gate, after')"), src.find('step(6, '), src.find("LIVE and checked: %s")
ok('step 6 comes after the full gate and before "LIVE and checked" (and stops the release when ON and not done)',
   0 < i5 < i6 < iL and 'if on and not good:\n        stop(' in src[i6:iL], (i5, i6, iL))

shutil.rmtree(TMP, ignore_errors=True)
print('\n' + ('%d FAILED, %d run' % (bad, ran) if bad else 'ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
