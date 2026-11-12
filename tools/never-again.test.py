#!/usr/bin/env python3
"""NEVER AGAIN, KEPT HONEST (INBOX 295, Dean 12 Nov 2026). No Chrome, runs anywhere in a second.

    python3 tools/never-again.test.py

Last week's gate was green while a real night on the Kogan TV app broke in about 30 ways. tools/never-again-map.json
lists every one of those faults against the check that would have gone red. This suite fails when:
  - a row's check file is gone, or the words that make it THAT check are no longer in it;
  - a row's check has no prove-checks row, so nobody ever broke it on purpose to see it go red;
  - a fault has no check and no dated, explained 'gap' (a gap past its date is red too);
  - the map is not read by the gate (gate-labels.json must name this suite).
It then proves itself: each failure above is made in a scratch copy of the map and must be caught.
"""
import copy, datetime, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = failed = 0


def ok(label, good, detail=''):
    global passed, failed
    if good: passed += 1; print('  ok   ' + label)
    else: failed += 1; print('  FAIL ' + label + ('   saw: %s' % (detail,) if detail != '' else ''))


def rd(rel):
    try:
        return io.open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace').read()
    except IOError:
        return None


def judge(m, today, read=rd, prove_text=None):
    """list of (fault id, what is wrong)"""
    bad = []
    prove = prove_text if prove_text is not None else (rd('tools/prove-checks.py') or '')
    ids = set()
    for f in m.get('faults', []):
        fid = f.get('id', '?')
        if fid in ids: bad.append((fid, 'listed twice'))
        ids.add(fid)
        if f.get('status') == 'gap':
            try: until = datetime.date.fromisoformat(f.get('gap_until', ''))
            except ValueError: bad.append((fid, 'a gap needs a gap_until date')); continue
            if len(f.get('gap_note', '')) < 40: bad.append((fid, 'a gap needs a note saying why and who closes it'))
            if until < today: bad.append((fid, 'the gap is past its date %s' % until))
            continue
        t = read(f.get('check', ''))
        if t is None: bad.append((fid, 'check file %s is gone' % f.get('check'))); continue
        for w in f.get('words', []) or ['']:
            if not w or w.lower() not in t.lower(): bad.append((fid, 'words %r are no longer in %s' % (w, f['check'])))
        if not f.get('prove') or ("'" + f['prove'] + "'") not in prove: bad.append((fid, 'no prove-checks row for %s' % f.get('prove')))
    return bad


m = json.load(io.open(os.path.join(ROOT, 'tools', 'never-again-map.json'), encoding='utf-8'))
today = datetime.date.today()
print('1. The map as it stands')
ok('there is a row for each of the faults of 12 Nov (at least 14)', len(m['faults']) >= 14, len(m['faults']))
bad = judge(m, today)
ok('every fault has a live check with its words and a prove-checks row, or a dated gap', not bad, bad)
ok('the gate runs this suite (gate-labels.json)', 'never-again.test.py' in (rd('tools/gate-labels.json') or ''))
ok('every row names an INBOX number and says what broke', all(f.get('inbox') and len(f.get('fault', '')) > 15 for f in m['faults']))

print('2. It goes red when it should (the map is broken on purpose)')
def broken(fn):
    c = copy.deepcopy(m); fn(c); return judge(c, today)
ok('a check file that goes missing is caught', broken(lambda c: c['faults'][0].update(check='tools/not-there.py')))
ok('words that leave the check are caught', broken(lambda c: c['faults'][0].update(words=['zzzz-not-in-it'])))
ok('a check nobody has ever broken on purpose is caught', broken(lambda c: c['faults'][0].update(prove='zzzz.test.py')))
ok('a gap with no date is caught', broken(lambda c: c['faults'][-1].pop('gap_until')))
ok('a gap past its date is caught', broken(lambda c: c['faults'][-1].update(gap_until='2026-01-01')))
ok('a gap with no reason is caught', broken(lambda c: c['faults'][-1].update(gap_note='later')))
ok('a fault listed with nothing at all is caught', broken(lambda c: c['faults'].append({'id': 'x', 'inbox': '1', 'fault': 'a fault with no check'})))
ok('a fault listed twice is caught', broken(lambda c: c['faults'].append(copy.deepcopy(c['faults'][0]))))

print('\n%d of %d checks passed' % (passed, passed + failed))
sys.exit(0 if not failed else 1)
