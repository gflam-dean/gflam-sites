#!/usr/bin/env python3
"""THE ONE PASS JUDGE, both ways, and every gate reader asking it (12 Nov 2026, INBOX 270).

No network, no Chrome. tools/passwording.py decides whether a suite passed; this feeds it every
format it accepts and every shape it must refuse, the REAL last lines the 12 Nov sweep found (118
suites, before and after), and then checks that the four readers that used to keep their own rule
(the full gate, the deploy fast gate, suite-queue.py, prove-checks.py) and the ledger all call it.
"""
import importlib.util, io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
sys.path.insert(0, TOOLS)
import passwording as pw

ran = bad = 0


def ok(name, cond, saw=None):
    global ran, bad
    ran += 1
    if cond:
        print('  ok   ' + name)
    else:
        bad += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: ' + str(saw)[:300]))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


print('1. every format it accepts, as the last line of a clean run')
for out in ('  ok   one\nALL 22 CHECKS PASSED',
            '  ok   one\nAll 22 checks passed',
            '  ok   one\nall 22 checks passed',
            'ALL 1 CHECK PASSED',
            '  ok   one\nAll 22 checks passed.',
            '\n36 of 36 checks passed',
            '36 OF 36 CHECKS PASSED',
            '  ok   one\nPASS 27 checks',
            '  ok   one\n42 passed, 0 failed\nPASS',
            '  ok   one\n42 passed, 0 failed\n\nPASS\n\n',
            '\x1b[32m  ok   one\x1b[0m\nALL 3 CHECKS PASSED\n'):
    ok('accepted: %r' % out.strip().splitlines()[-1], pw.judged_pass(0, out), pw.verdict(0, out))

print('2. every shape it must refuse')
for out, why in (('', 'no output'),
                 ('PASS', 'a bare PASS'),
                 ('  ok   one\nPASS', 'a bare PASS after an ok line'),
                 ('ok', 'a bare ok'),
                 ('  ok   one\n  ok   two', 'an ok line last (a pass line that is not last)'),
                 ('PASS: the hook\n  ok   the hook fails over', 'PASS first, then more checks'),
                 ('ALL 3 CHECKS PASSED\n  ok   a late check', 'the pass line is not the last line'),
                 ('ALL CHECKS PASSED', 'ALL CHECKS PASSED with no count'),
                 ('ALL 0 CHECKS PASSED', 'a count of zero'),
                 ('0 of 0 checks passed', 'zero of zero'),
                 ('PASS 0 checks', 'PASS 0 checks'),
                 ('0 passed, 0 failed\nPASS', 'a pair counting nothing'),
                 ('21 of 22 checks passed', 'N of M with N != M'),
                 ('23 of 22 checks passed', 'more passed than ran'),
                 ('41 passed, 1 failed\nPASS', 'the pair with a failure'),
                 ('19 passed, 0 failed', 'the pair without its closing PASS'),
                 ('26/26 passed', 'N/N passed'),
                 ('ALL 9 CHECKS PASSED  (partyplay/admin.html)', 'words after the count'),
                 ('36 of 36 checks passed, give or take', 'words after N of N'),
                 ('PASS picture links', 'PASS and words'),
                 ('ALL 22 CHECKS PASSEDX', 'a pass word run on'),
                 ('xALL 22 CHECKS PASSED', 'a pass line with something in front'),
                 ('3 OF 95 CHECKS FAILED', 'a failure summary'),
                 ('FAILED 2 of 22', 'FAILED'),
                 ('TIMED OUT after 300s; the suite and its Chrome were killed', 'a timeout line')):
    ok('refused: %s' % why, not pw.judged_pass(0, out), pw.verdict(0, out))

print('3. the run around the last line')
ok('exit 1 with a perfect last line is refused', not pw.judged_pass(1, 'ALL 3 CHECKS PASSED'))
ok('exit 3 (jsc threw) is refused', not pw.judged_pass(3, 'ALL 3 CHECKS PASSED'))
ok('exit 124 (timeout) is refused', not pw.judged_pass(124, 'ALL 3 CHECKS PASSED'))
ok('timed_out is refused even at exit 0', not pw.judged_pass(0, 'ALL 3 CHECKS PASSED', timed_out=True))
ok('a FAIL line anywhere is refused', not pw.judged_pass(0, '  FAIL one\nALL 3 CHECKS PASSED'))
ok('a FAIL line at the very top is refused', not pw.judged_pass(0, 'FAIL x\n  ok   y\n36 of 36 checks passed'))
ok('a FAILED line is refused', not pw.judged_pass(0, 'FAILED 1 so far\n  ok   y\nALL 3 CHECKS PASSED'))
ok('an ok line that mentions FAIL in its words is still fine', pw.judged_pass(0, '  ok   a FAIL line is caught\nALL 1 CHECKS PASSED'))
ok('the verdict says why, naming the last line', 'not a pass line' in pw.verdict(0, 'PASS')[1] and "'PASS'" in pw.verdict(0, 'PASS')[1])
ok('last_line_ok agrees on one line', pw.last_line_ok('ALL 2 CHECKS PASSED') and pw.last_line_ok('2 of 2 checks passed')
   and not pw.last_line_ok('2 of 3 checks passed') and not pw.last_line_ok('PASS') and not pw.last_line_ok(''))


class Run:
    def __init__(self, rc, out, timed_out=False):
        self.rc, self.out, self.timed_out = rc, out, timed_out


ok('run_passed reads a gatelib.SuiteRun-shaped run', pw.run_passed(Run(0, 'ALL 2 CHECKS PASSED'))
   and not pw.run_passed(Run(0, 'ALL 2 CHECKS PASSED', True)) and not pw.run_passed(Run(2, 'ALL 2 CHECKS PASSED')))

print('4. the REAL last lines the 12 Nov sweep found (before the fix), judged as the gate now judges them')
# (suite, the lines it ended on, accepted?). Accepted ones were harmless to every reader once all of them
# ask this judge; the refused ones are the suites that had to change. Each changed suite now ends ALL N CHECKS PASSED.
REAL = (
    ('test-try-demo-billing.js', 'All 22 checks passed', True),             # the line that stopped the release
    ('test-try-demo.js', 'All 49 checks passed', True),
    ('test-vp-demo.js', 'All 52 checks passed', True),
    ('test-help-desk.js and 70 more', '  ok   x\nPASS 32 checks', True),
    ('test-billing-panels.js and 17 more', '  ok   x\n68 passed, 0 failed\nPASS', True),
    ('test-abandoned-lobby.js and 14 more', '  ok   a running game still gets its ninety minutes\nPASS', False),
    ('test-archived-venue-restore.js', '  ok   x\n\n19 passed, 0 failed', False),
    ('test-checkout-trial-and-duplicates.js', 'PASS\n  ok   returning venue: three days, and the email is told three days', False),
    ('test-library-pull-reaches-the-whole-bank.js', 'PASS 40 checks\n  ok   x\nPASS picture links', False),
    ('test-trivia-question-space.js', '  ok   x\n\n26/26 passed', False),
    ('test-trivia-reveal.js', '  ok   x\n\n28/28 passed', False),
    ('pp-admin-auth.test.js', '  ok   x\nALL 9 CHECKS PASSED  (partyplay/admin.html)', False),
    ('slug-ladder.test.js, live-fixes, musical-draw, trivia-night', '  ok   x\nALL CHECKS PASSED', False),
    ('screen-history-sql.test.py', '  ok   x\n\nALL CHECKS PASSED', False),
    ('trivia-live-fixes-in-chrome.test.py with no Chrome', '\n0 of 1 checks passed', False),
    ('signin-logo-in-chrome.test.py red on the server', '  FAIL x\n3 OF 95 CHECKS FAILED', False),
    ('console-in-chrome.test.py and the Chrome suites', '  ok   x\n\n61 of 61 checks passed', True),
    ('the house line, now every changed suite', '  ok   x\nALL 22 CHECKS PASSED', True),
)
for name, out, want in REAL:
    rc = 1 if 'FAIL' in out or '0 of 1' in out else 0
    got = pw.judged_pass(rc, out)
    ok('%s: %r is %s' % (name, out.strip().splitlines()[-1], 'a pass' if want else 'refused'), got == want, pw.verdict(rc, out))

print('5. a real suite, run under jsc, judged green; and the same output with its last line changed, red')
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
if os.path.exists(JSC):
    r = subprocess.run([JSC, os.path.join(TOOLS, 'test-try-demo-billing.js')], cwd=ROOT, capture_output=True, text=True, timeout=120)
    out = (r.stdout or '') + (r.stderr or '')
    ok('tools/test-try-demo-billing.js passes the judge (exit %d)' % r.returncode, pw.judged_pass(r.returncode, out), pw.verdict(r.returncode, out))
    ok('...and ends on the house line', bool(re.match(r'^ALL \d+ CHECKS PASSED$', out.strip().splitlines()[-1])), out.strip().splitlines()[-1:])
    lines = out.strip().splitlines()
    ok('...and the same output ending "PASS" is refused', not pw.judged_pass(r.returncode, '\n'.join(lines[:-1] + ['PASS'])))
else:
    ok('jsc is where the gate expects it', False, JSC)

print('6. every gate reader asks this judge, and none keeps its own rule')
dw = src('tools/deploy-worker.py')
fg = dw[dw.index('def fast_gate('):dw.index('def _suite_passed(')]
ok('deploy-worker.py fast gate: passwording.run_passed and verdict', 'passwording.run_passed(rr)' in fg and 'passwording.verdict(rr.rc, rr.out, rr.timed_out)' in fg, fg[-400:])
ok('deploy-worker.py fast gate: no "PASS" in text rule of its own', "'PASS' in text" not in fg and "'PASS' in" not in fg)
rc_src = src('tools/release-check.py')
ok('release-check.py: suite_passed is the judge\'s one-line form', 'return passwording.last_line_ok(line)' in rc_src)
ok('release-check.py: every swept suite (.test.js, .test.py) judged by run_passed',
   rc_src.count('passwording.run_passed(r)') >= 3 and 'suite_passed(r.last)' not in rc_src)
named = re.findall(r"r\.returncode == 0 and (?:'PASS'|'PASSED') in out", rc_src)
ok('release-check.py: no named suite block judges by "PASS" in the output', not named, named[:2])
rcl = rc_src.split('\n')
starts = [i for i, l in enumerate(rcl) if 'subprocess.run([JSC, t]' in l]
loose = [i + 1 for i in starts if not any('passwording.judged_pass(r.returncode, out)' in l for l in rcl[i:i + 14])]
ok('release-check.py: every named jsc suite block (%d) asks passwording.judged_pass' % len(starts), len(starts) >= 25 and not loose,
   'unjudged at line(s) %s' % loose[:4])
ok('release-check.py: D211 reads the ledger\'s WORDING lines', "head('D211." in rc_src and "startswith('WORDING ')" in rc_src)
led = src('tools/check-suite-ledger.py')
ok('check-suite-ledger.py: every suite it judges goes through judged() and the WORDING lines',
   'passwording.verdict(rc, out)' in led and 'return judged(rel, rc, io.open(o' in led and 'res = judged(rel, r.rc, r.out)' in led and 'judge(r.rc' not in led and "print('WORDING %s :: %s'" in led)
pc = src('tools/prove-checks.py')
sw = pc[pc.index('def suite_went_red('):pc.index('def gate(')]
ok('prove-checks.py: a suite proof is judged by run_passed', 'passwording.run_passed(r)' in sw and "'ALL' in last" not in sw, sw[-300:])

sq = load('sq', os.path.join(TOOLS, 'suite-queue.py'))
cases = [(0, 'ALL 3 CHECKS PASSED'), (0, 'All 22 checks passed'), (0, '3 of 3 checks passed'), (0, '2 of 3 checks passed'),
         (0, 'PASS 27 checks'), (0, '42 passed, 0 failed\nPASS'), (0, 'PASS'), (0, 'ALL CHECKS PASSED'), (0, 'ALL 0 CHECKS PASSED'),
         (0, 'FAIL x\nALL 3 CHECKS PASSED'), (1, 'ALL 3 CHECKS PASSED'), (0, '26/26 passed'), (0, 'PASS: x\n  ok   y')]
dis = [c for c in cases if sq.judged_pass(*c) != pw.judged_pass(*c)]
ok('suite-queue.py judged_pass gives the same answer as the judge on %d outputs' % len(cases), not dis, dis)
dws = load('dw', os.path.join(TOOLS, 'deploy-worker.py'))
lines = ['ALL 3 CHECKS PASSED', 'All 22 checks passed', '3 of 3 checks passed', '2 of 3 checks passed', 'PASS 27 checks',
         'PASS', 'ALL CHECKS PASSED', 'ALL 0 CHECKS PASSED', '26/26 passed', '']
dis = [l for l in lines if dws._suite_passed(l) != pw.last_line_ok(l)]
ok('deploy-worker.py _suite_passed gives the same answer as the judge on %d last lines' % len(lines), not dis, dis)

print('')
print(('%d of %d checks passed' % (ran - bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
