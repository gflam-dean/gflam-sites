#!/usr/bin/env python3
"""EVERY SUITE, AND HOW MANY CHECKS IT RAN LAST TIME SOMEBODY LOOKED.

    python3 tools/check-suite-ledger.py            # compare with tools/suite-counts.json
    python3 tools/check-suite-ledger.py --update   # rewrite the ledger (shows in git, on purpose)

The audit of 20 Sep 2026 replaced money.test.js (44 checks, the only suite on rates) with one
line, print("ALL 0 CHECKS PASSED"), and the gate stayed green. It added a new suite that printed
FAIL and threw, and the gate stayed green, because tools/test-*.js suites are wired in one by one
by hand and nothing noticed an extra one. Four suites print no count at all.

A model tidying up a flaky test does exactly this by accident: deletes the checks that fail,
keeps the line that says PASSED. The gate's own per-suite blocks cannot see it, so this does not
trust what a suite SAYS. It runs every suite itself, counts the checks that actually printed ok,
and compares with a committed ledger:

  a suite on disk that is not in the ledger        red: somebody added one and nothing runs it
  a suite in the ledger that is not on disk        red: somebody deleted one
  a suite that exits non-zero or prints a FAIL     red
  a suite that ran FEWER checks than the ledger    red: checks were removed
  a suite that ran more                            fine, and --update records the new floor

Shrinking a suite is sometimes right. Then run --update, and the diff to suite-counts.json is
the record that it was a decision.
"""
import glob, io, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib       # run_suite (own process group, kills the Chrome on timeout) and uses_chrome
LEDGER = os.path.join(ROOT, 'tools', 'suite-counts.json')
# Live integration tests that create real venues. Run by hand, never on a gate. Same list, same
# reason, as RUN_BY_HAND in release-check.py.
BY_HAND = {'venueplay-backend/tools/purge-closed-player-data.test.py'}
OK_LINE = re.compile(r'^\s*(ok|pass)\b(?!\w)', re.I)
SUMMARY = re.compile(r'^\s*(pass\s+\d+\s+checks|passed\b|pass$)', re.I)   # "PASS 12 checks" is a total, not a check
BAD_LINE = re.compile(r'^\s*FAIL\b')


def discover():
    found = set()
    for pat in ('**/*.test.js', '**/*.test.py', 'tools/test-*.js'):
        for f in glob.glob(os.path.join(ROOT, pat), recursive=True):
            rel = os.path.relpath(f, ROOT)
            if rel.startswith('.') or '/node_modules/' in rel or '/.claude/' in rel:
                continue
            if rel not in BY_HAND:
                found.add(rel)
    return sorted(found)


def judge(rc, out):
    """(exit code, checks counted, what was wrong, counted_by) from a suite's output."""
    lines = out.splitlines()
    n = len([l for l in lines if OK_LINE.match(l) and not SUMMARY.match(l)])
    by = 'lines'
    if n == 0:
        by = 'total'
        # Fifteen suites print only their failures and a total. For those the total is all
        # there is, so it is what gets pinned. Weaker, because it is the suite's own word, but
        # "ALL 0 CHECKS PASSED" still fails and a total that DROPS still fails.
        n = 0
        for l in lines:
            m = re.match(r'^\s*(?:ALL (\d+) CHECKS PASSED|(\d+) of \d+ checks? passed)', l)
            if m:
                n += int(m.group(1) or m.group(2))
    bad = [l.strip()[:110] for l in lines if BAD_LINE.match(l)]
    return (rc, n, bad or ([lines[-1].strip()[:110]] if rc and lines else []), by)


# --reuse <dir>: the gate (release-check.py) keeps every suite's output as it runs it, so a suite
# it has already run is COUNTED from that output here rather than run a second time. Before 27 Oct
# 2026 this ran all fifteen Chrome suites again, six at once, inside every gate: the load spike
# that made the next suite time out and the reason a gate took ten minutes of Chrome per deploy.
REUSE = None
if '--reuse' in sys.argv:
    REUSE = sys.argv[sys.argv.index('--reuse') + 1]
REUSED = []


def run(rel):
    if REUSE:
        name = rel.replace(os.sep, '__')
        o, c = os.path.join(REUSE, name + '.out'), os.path.join(REUSE, name + '.rc')
        if os.path.isfile(o) and os.path.isfile(c):
            try:
                rc = int(io.open(c, encoding='utf-8').read().strip() or '1')
                REUSED.append(rel)
                return judge(rc, io.open(o, encoding='utf-8', errors='replace').read())
            except Exception:
                pass
    cmd = [sys.executable, rel] if rel.endswith('.py') else [JSC, rel]
    best = None
    # From the repo root first, which is how the gate runs them. A few older suites find their
    # files relative to themselves, so a suite that cannot even start is tried from its own folder.
    for cwd, arg in ((ROOT, rel), (os.path.join(ROOT, os.path.dirname(rel)), os.path.basename(rel))):
        try:
            # Its own process group, and the whole group is killed on timeout (the Chrome too).
            # A Chrome suite gets the gate's own allowance (900 s, release-check._suite_timeout): tv-and-phone
            # takes about 400 s on its own and was being killed at 300 s here on every --update (27 Oct 2026).
            _chrome = gatelib.uses_chrome(os.path.join(ROOT, rel))
            r = gatelib.run_suite(cmd[:-1] + [arg], cwd=cwd,
                                  timeout=int(os.environ.get('VP_LEDGER_TIMEOUT', '900' if _chrome else '300')))
        except Exception as e:
            best = best or (1, 0, ['could not run: %s' % e], 'lines'); continue
        res = judge(r.rc, r.out)
        if r.rc == 0 and not res[2]:
            return res
        if best is None or res[1] > best[1]:
            best = res
    return best


def main():
    suites = discover()
    skipped = []
    if '--skip-chrome' in sys.argv:
        # A targeted prove run: the gate did not run its Chrome suites, so they are not judged
        # here either, and they are named so nobody reads "ok" as covering them.
        skipped = [s for s in suites if gatelib.uses_chrome(os.path.join(ROOT, s))]
        suites = [s for s in suites if s not in skipped]
        print('note %d Chrome suite(s) SKIPPED by --skip-chrome, not judged: %s' % (len(skipped), ', '.join(os.path.basename(s) for s in skipped)))
    # VP_LEDGER_JOBS: fewer at once on a loaded Mac. Six Chrome suites at once timed tv-and-phone out at 300 s (25 Oct 2026).
    with ThreadPoolExecutor(max_workers=int(os.environ.get('VP_LEDGER_JOBS', '6'))) as ex:
        results = dict(zip(suites, ex.map(run, suites)))
    if '--update' in sys.argv:
        broken = {s: r for s, r in results.items() if r[0] != 0 or r[2]}
        if broken:
            print('NOT UPDATED. A ledger is only written from suites that pass:')
            for s, r in sorted(broken.items()):
                print('  %s  exit %s  %s' % (s, r[0], '; '.join(r[2][:2])))
            return 1
        json.dump({s: {'checks': results[s][1], 'counted_by': results[s][3]} for s in suites}, io.open(LEDGER, 'w', encoding='utf-8'), indent=1, sort_keys=True)
        print('wrote %s: %d suites, %d checks' % (os.path.relpath(LEDGER, ROOT), len(suites), sum(r[1] for r in results.values())))
        return 0
    try:
        ledger = json.load(io.open(LEDGER, encoding='utf-8'))
    except Exception:
        print('FAIL there is no ledger. Run: python3 tools/check-suite-ledger.py --update'); return 1
    bad = 0
    for s in suites:
        rc, n, why, by = results[s]
        want = ledger.get(s) or {}
        if s not in ledger:
            print('FAIL %s is on disk and not in the ledger: was it added without being wired into the gate? (%d checks)' % (s, n)); bad += 1
        elif rc != 0 or why:
            print('FAIL %s does not pass on its own: %s' % (s, '; '.join(why[:2]) or 'exit %s' % rc)); bad += 1
        elif want.get('counted_by') == 'lines' and by != 'lines':
            # It used to print every check as it passed and now prints only a total. A total is the
            # suite's own word, and a one line file that says "ALL 44 CHECKS PASSED" is how a gutted
            # suite would look. The checks themselves have to be seen again.
            print('FAIL %s used to print each check it ran (%d) and now prints only a total: has it been replaced?' % (s, want.get('checks', 0))); bad += 1
        elif n < want.get('checks', 0):
            print('FAIL %s ran %d checks and the ledger says %d: checks have been removed' % (s, n, want.get('checks', 0))); bad += 1
        elif n == 0:
            print('FAIL %s ran no checks at all' % s); bad += 1
    for s in sorted(set(ledger) - set(suites) - set(skipped)):
        print('FAIL %s is in the ledger and gone from disk: a suite was deleted' % s); bad += 1
    total = sum(r[1] for r in results.values())
    print(('FAILED: %d problem(s)' % bad) if bad else ('ok   %d suites ran %d checks, none fewer than the ledger%s'
          % (len(suites), total, (' (%d counted from the gate\'s own run)' % len(REUSED)) if REUSED else '')))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
