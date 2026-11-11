#!/usr/bin/env python3
"""THE ONE PASS JUDGE: did a suite pass, read from its exit code and its output (12 Nov 2026).

On 12 Nov 2026 release.py pushed 606b3959 (pre-push gate 529 of 529 green) and then stopped at the
Worker deploy, because the deploy tool's fast gate read tools/test-try-demo-billing.js as red: it
ended "All 22 checks passed", and the fast gate only knew "ALL N CHECKS PASSED" and "N of N checks
passed". The full gate had passed the same suite by counting its ok lines. Four readers (the full
gate, the deploy fast gate, suite-queue.py and the test server's vp-run-suites.py) each had their
own rule, so the same output was green in one and red in another. Pages had already gone live on
old Workers and had to be rolled back by hand.

Every reader now asks this file. A suite PASSES only when ALL of these hold:
  - it exited 0 and did not time out
  - no line of its output starts with FAIL (FAILED included)
  - its LAST line is one of the formats below, with a count above zero, and where the line says
    "N of M", N equals M

THE FORMATS, and nothing else:
  ALL 22 CHECKS PASSED          the house line. Every suite should print this one.
  All 22 checks passed          the same words in any case
  22 of 22 checks passed        (touring-api and the Chrome suites)
  PASS 22 checks                the older tools/test-*.js line
  22 passed, 0 failed / PASS    the older jsc pair: the count on the line before a closing PASS

Refused, on purpose: a bare "PASS" or "ok", "ALL CHECKS PASSED" with no count, "ALL 0 CHECKS
PASSED", "21 of 22 checks passed", "22/22 passed", a last line with words after the count, and a
pass line that is not the LAST line (a suite that printed PASS and then kept running).

A NEW SUITE THAT ENDS ANY OTHER WAY is red in the gate (release-check.py D211) the day it is added,
not on the morning of a release. tools/passwording.test.py runs every format both ways.
"""
import re

# (name, pattern for the LAST line, how the count is read)
FORMATS = (
    ('ALL N CHECKS PASSED', re.compile(r'^all (\d+) checks? passed\.?$', re.I)),
    ('N of N checks passed', re.compile(r'^(\d+) of (\d+) checks? passed\.?$', re.I)),
    ('PASS N checks', re.compile(r'^PASS (\d+) checks?$')),
)
PAIR_COUNT = re.compile(r'^(\d+) passed, (\d+) failed$')
CANONICAL = 'ALL %d CHECKS PASSED'


def _lines(out):
    return [l.rstrip() for l in re.sub(r'\x1b\[[0-9;]*m', '', out or '').strip().splitlines()]


def last_line_verdict(lines):
    """(True, format name) when the last line of `lines` is a pass line, else (False, why)."""
    lines = [l for l in lines if l.strip()]
    if not lines:
        return False, 'no output at all'
    last = lines[-1].strip()
    for name, rx in FORMATS:
        m = rx.match(last)
        if not m:
            continue
        nums = [int(g) for g in m.groups()]
        if nums[0] <= 0:
            return False, 'the last line counts no checks: %r' % last
        if len(nums) == 2 and nums[0] != nums[1]:
            return False, 'not every check passed: %r' % last
        return True, name
    if last == 'PASS' and len(lines) > 1:
        m = PAIR_COUNT.match(lines[-2].strip())
        if m:
            if int(m.group(2)) != 0:
                return False, 'the line before PASS has failures: %r' % lines[-2].strip()
            if int(m.group(1)) <= 0:
                return False, 'the line before PASS counts no checks: %r' % lines[-2].strip()
            return True, 'N passed, 0 failed then PASS'
    return False, 'the last line is not a pass line the gate reads: %r (print "ALL N CHECKS PASSED")' % last[:120]


def verdict(rc, out, timed_out=False):
    """(passed, why). why names the format on a pass and the reason on a refusal."""
    if timed_out:
        return False, 'timed out'
    if rc != 0:
        return False, 'exit %s' % rc
    lines = _lines(out)
    fails = [l.strip() for l in lines if l.strip().startswith('FAIL')]
    if fails:
        return False, 'a FAIL line: %s' % fails[0][:160]
    return last_line_verdict(lines)


def judged_pass(rc, out, timed_out=False):
    """True only for a clean pass. See verdict() for why not."""
    return verdict(rc, out, timed_out)[0]


def last_line_ok(line):
    """For readers that only kept the last line: is it a pass line (one of FORMATS)?
    The two-line "N passed, 0 failed / PASS" pair cannot be judged from one line and is refused."""
    return last_line_verdict([line or ''])[0]


def run_passed(run):
    """A gatelib.SuiteRun (rc, out, timed_out)."""
    return judged_pass(run.rc, run.out, getattr(run, 'timed_out', False))


if __name__ == '__main__':
    # python3 tools/passwording.py < output   (exit code 0 assumed): prints the verdict
    import sys
    ok, why = verdict(0, sys.stdin.read())
    print(('PASS ' if ok else 'REFUSED ') + why)
    sys.exit(0 if ok else 1)
