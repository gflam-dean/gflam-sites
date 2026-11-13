#!/usr/bin/env python3
"""A RELEASE IS NOT DONE UNTIL A REAL NIGHT HAS BEEN PLAYED ON IT (Dean, 12 Nov 2026, INBOX 295.1).

The 15 Nov release passed the full gate and verify-live, and was called verified. Dean then played every game on
The Mini Bar with the Kogan TV app and found about thirty faults. "How do we not make this happen again?" This is
the record that says the night was played, on THIS build, the way Dean plays it:

    python3 tools/real-night-check.py <build>            check ~/venue-enrich/reports/real-night/<build[:8]>.md
    python3 tools/real-night-check.py <build> <file>     check that file instead

<build> is the commit release.py released (its full id, or at least 8 characters of it). The record's own
format is tools/real-night-template.md. The check fails (exit 1, every reason listed) when:
  - the file is missing, or its Build line is not this build
  - Venue is not The Mini Bar, or TV is not the Kogan TV app at 192.168.68.58
  - Phone A or Phone B is not named, or they are the same phone
  - any of the five games (Trivia, Musical bingo, Bingo, Raffle, Members draw) is missing, twice, or out of order
  - a game has no TV shot, no phone shot, or a shot path that does not exist
  - a game does not say it was played with the same two phones ("Phones: A, B")
  - a game has no "Result: PASS by <name>" line, or says FAIL
  - any line is still a template placeholder (<...>) or says TODO
It reads one local file and never touches the network. VP_REAL_NIGHT_DIR moves the folder (the suite uses it).

THE AUTOMATED, FREE RECORD (INBOX 365B, 13 Nov 2026, written by tools/real-night-free.py; its head says "Mode: automated").
It is judged by the same game rules (five sections in order, a TV shot and a phone shot on disk, "Phones: A, B", PASS by a
name) and, instead of the Kogan and Mini Bar lines, by what it honestly is:
  - Venue names The Mini Bar AND says "test server" (the rig played the venue's saved settings, not the live venue)
  - TV says "Chrome /tv (test server)" and never names the Kogan: the Kogan was not played
  - "Kogan app shots: n of 5" with n equal to the games whose "Kogan shot:" is a file on disk (a PNG); a skipped shot
    says "skipped (...)". The Kogan is informational: 0 of 5 passes, a count that does not match the files fails
  - "Dry run: GREEN, <n> checks ..." (n > 0), "Verify live: GREEN ..." and a "Tree:" line with the tree id
  - the "Look:" page is on disk
"""
import io, os, re, sys

DIR_DEFAULT = os.path.expanduser('~/venue-enrich/reports/real-night')
GAMES = ('Trivia', 'Musical bingo', 'Bingo', 'Raffle', 'Members draw')
VENUE = 'The Mini Bar'
TV_IP = '192.168.68.58'


def record_dir():
    return os.environ.get('VP_REAL_NIGHT_DIR') or DIR_DEFAULT


def record_path(build):
    return os.path.join(record_dir(), str(build)[:8] + '.md')


def _field(lines, name):
    """The value of the first 'Name: value' line (case-insensitive name), or None."""
    pat = re.compile(r'^\s*' + re.escape(name) + r'\s*:\s*(.*?)\s*$', re.I)
    for l in lines:
        m = pat.match(l)
        if m:
            return m.group(1)
    return None


def _fields(lines, name):
    pat = re.compile(r'^\s*' + re.escape(name) + r'\s*:\s*(.*?)\s*$', re.I)
    return [m.group(1) for m in (pat.match(l) for l in lines) if m]


def _placeholder(v):
    return v is None or not v.strip() or '<' in v or '>' in v or re.search(r'\bTODO\b', v, re.I) is not None


def _shot_ok(ref, base):
    """A shot is a URL, or a file that exists (relative to the record's folder)."""
    if _placeholder(ref):
        return False
    if re.match(r'^https?://', ref):
        return True
    p = ref if os.path.isabs(ref) else os.path.join(base, ref)
    return os.path.isfile(os.path.expanduser(p))


def _png(path):
    try:
        with open(path, 'rb') as fh:
            return fh.read(8) == b'\x89PNG\r\n\x1a\n'
    except Exception:
        return False


def _automated_head(head, sections, base):
    """The honest lines an automated record (tools/real-night-free.py) must carry instead of the Kogan/Mini Bar ones."""
    why = []
    venue = (_field(head, 'Venue') or '').lower()
    if VENUE.lower() not in venue or 'test server' not in venue:
        why.append('Venue is %r: an automated night names The Mini Bar\'s settings AND the test server it ran on' % _field(head, 'Venue'))
    tv = _field(head, 'TV') or ''
    if not tv.lower().startswith('chrome /tv (test server)'):
        why.append('TV is %r: an automated night says "Chrome /tv (test server)"' % tv)
    if 'kogan' in tv.lower():
        why.append('TV is %r: an automated night never played the Kogan, so its TV line must not name it' % tv)
    m = re.match(r'^(\d+) of (\d+)\b', (_field(head, 'Kogan app shots') or '').strip())
    shot_files = 0
    for name, body in sections:
        for k in _fields(body, 'Kogan shot'):
            if k.lower().startswith('skipped'):
                continue
            p = k if os.path.isabs(k) else os.path.join(base, k)
            if _png(os.path.expanduser(p)):
                shot_files += 1
            else:
                why.append('%s: the Kogan shot %r is not a PNG on disk' % (name, k))
    if not m:
        why.append('no "Kogan app shots: n of 5" line (say honestly how many the Kogan app gave, even 0)')
    elif int(m.group(2)) != len(GAMES) or int(m.group(1)) != shot_files:
        why.append('"Kogan app shots: %s of %s" does not match the %d Kogan shot file(s) on disk for the %d games'
                   % (m.group(1), m.group(2), shot_files, len(GAMES)))
    d = re.match(r'^GREEN, (\d+) checks\b', (_field(head, 'Dry run') or '').strip())
    if not d or int(d.group(1)) <= 0:
        why.append('Dry run is %r: the dry run on the test server must be "GREEN, <n> checks"' % _field(head, 'Dry run'))
    if not (_field(head, 'Verify live') or '').strip().startswith('GREEN'):
        why.append('Verify live is %r: verify-live --all against live must be GREEN' % _field(head, 'Verify live'))
    if not re.match(r'^[0-9a-f]{40}\b', (_field(head, 'Tree') or '').strip()):
        why.append('no Tree line with the tree the dry run ran')
    look = _field(head, 'Look')
    if _placeholder(look) or not os.path.isfile(os.path.join(base, look)):
        why.append('the Look page %r is not there' % look)
    return why


def check_text(text, build, base):
    """Every reason the record does not prove a real night on `build`. [] = it does."""
    why = []
    build = str(build or '').strip().lower()
    lines = text.splitlines()
    head, sections, cur = [], [], None
    for l in lines:
        m = re.match(r'^##\s+(.+?)\s*$', l)
        if m:
            cur = (m.group(1), [])
            sections.append(cur)
        elif cur is None:
            head.append(l)
        else:
            cur[1].append(l)

    got = (_field(head, 'Build') or '').strip().lower()
    if not re.match(r'^[0-9a-f]{8,40}$', got):
        why.append('the Build line is missing or not a commit id (at least 8 characters): %r' % got)
    elif not re.match(r'^[0-9a-f]{8,40}$', build) or not (build.startswith(got) or got.startswith(build)):
        why.append('the record is for build %s, not this release (%s)' % (got[:12], build[:12] or 'none given'))
    if _placeholder(_field(head, 'Date')):
        why.append('no Date line')
    auto = (_field(head, 'Mode') or '').strip().lower().startswith('automated')
    venue = _field(head, 'Venue') or ''
    tv = _field(head, 'TV') or ''
    if auto:
        why += _automated_head(head, sections, base)
    else:
        if venue.strip().lower() != VENUE.lower():
            why.append('Venue is %r, not %s' % (venue, VENUE))
        if 'kogan' not in tv.lower() or TV_IP not in tv:
            why.append('TV is %r: the night is played on the Kogan TV app at %s' % (tv, TV_IP))
    pa, pb = _field(head, 'Phone A'), _field(head, 'Phone B')
    if _placeholder(pa) or _placeholder(pb):
        why.append('Phone A and Phone B must both be named (two phones, kept across every game)')
    elif pa.strip().lower() == pb.strip().lower():
        why.append('Phone A and Phone B are the same phone (%r): the night needs two' % pa)
    if _placeholder(_field(head, 'Settings')):
        why.append('no Settings line (the venue\'s own saved settings, never fresh defaults)')

    names = [s[0] for s in sections]
    want = [g.lower() for g in GAMES]
    for g in GAMES:
        n = [x.lower() for x in names].count(g.lower())
        if n == 0:
            why.append('the %s section is missing' % g)
        elif n > 1:
            why.append('the %s section is there %d times' % (g, n))
    seen = [x.lower() for x in names if x.lower() in want]
    if len(seen) == len(want) and seen != want:
        why.append('the games are not in the night\'s order (%s): %s' % (', '.join(GAMES), ', '.join(names)))
    for extra in [x for x in names if x.lower() not in want]:
        why.append('a section that is not one of the five games: %r' % extra)

    for name, body in sections:
        if name.lower() not in want:
            continue
        tvs = _fields(body, 'TV shot')
        if not tvs:
            why.append('%s: no TV shot' % name)
        for s in tvs:
            if not _shot_ok(s, base):
                why.append('%s: the TV shot %r is not there' % (name, s))
        phs = _fields(body, 'Phone shot')
        if not phs:
            why.append('%s: no phone shot' % name)
        for s in phs:
            if not _shot_ok(s, base):
                why.append('%s: the phone shot %r is not there' % (name, s))
        phones = _field(body, 'Phones')
        if phones is None or set(re.findall(r'\b[AB]\b', phones)) != {'A', 'B'}:
            why.append('%s: does not say it was played on the same two phones ("Phones: A, B"), saw %r' % (name, phones))
        res = _fields(body, 'Result')
        if not res:
            why.append('%s: no "Result: PASS by <name>" line' % name)
        for r in res:
            m = re.match(r'^(PASS|FAIL)\s+by\s+(\S.*)$', r.strip(), re.I)
            if not m or _placeholder(r):
                why.append('%s: the result %r is not "PASS by <name>" or "FAIL by <name>"' % (name, r))
            elif m.group(1).upper() == 'FAIL':
                why.append('%s: FAIL (by %s). Fix it, then play the night again on the new build' % (name, m.group(2)))
    for i, l in enumerate(lines):
        if re.match(r'^\s*[A-Za-z][A-Za-z ]{0,20}:', l) and _placeholder(l.split(':', 1)[1]) and l.split(':', 1)[1].strip():
            why.append('line %d is still a template placeholder: %s' % (i + 1, l.strip()[:80]))
    return why


def check(build, path=None):
    """(ok, reasons, the file read)."""
    path = path or record_path(build)
    if not os.path.isfile(path):
        return False, ['no real-night record at %s. Play the night (tools/real-night-template.md says how) and write it.' % path], path
    text = io.open(path, encoding='utf-8').read()
    why = check_text(text, build, os.path.dirname(os.path.abspath(path)))
    return (not why), why, path


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[0]); print('usage: real-night-check.py <build> [record.md]'); return 2
    good, why, path = check(argv[1], argv[2] if len(argv) > 2 else None)
    if good:
        print('REAL NIGHT RECORDED for %s: %s' % (argv[1][:8], path))
        return 0
    print('NO REAL NIGHT for %s (%s):' % (argv[1][:8], path))
    for w in why:
        print('  - ' + w)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
