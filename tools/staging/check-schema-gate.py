#!/usr/bin/env python3
"""THE RELEASE-GATE LINE FOR "THE TEST DATABASE MATCHES LIVE" (INBOX 357B / 326, 13 Nov 2026). Offline: reads files, connects to nothing.

    check-schema-gate.py [--root DIR] [--snapshot FILE] [--live-snapshot FILE] [--max-age-hours N] [--now EPOCH]

release-check.py runs this as one line of its local half. It wraps check-schema-matches-live.py:

  * OFF until tools/staging/STAGING-ON exists. main commits that file after the match check says MATCH for the first
    time (README step 10). While it is absent the line passes and SAYS it is off: "OFF: ...". It is the only way the
    gate can stay green on a tree before staging exists, and it says so out loud instead of looking like a check.
  * ON: the TEST snapshot (default ~/.gflam-migrate/test-snapshot.json, or $VP_TEST_SNAPSHOT) must exist, be younger
    than 24 hours (a release is checked the day it ships; main refreshes it with the read-only schema-snapshot.sql), carry
    the TEST marker, and match. If a LIVE snapshot is also there and fresh, the full comparison runs against it;
    otherwise the test is compared with the repo's RLS-BASELINE.json and COLUMNS-BASELINE.json (locks and column names).
  * ON and the file is missing, old, unreadable or different = FAIL, with the words to fix it.

Exit 0 pass (including OFF), 1 fail. The last line is the one the gate prints.
"""
import importlib.util, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_DEFAULT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location('csm', os.path.join(HERE, 'check-schema-matches-live.py'))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)


def run(root=ROOT_DEFAULT, snapshot=None, live_snapshot=None, max_age_hours=24, now=None, out=print):
    now = time.time() if now is None else now
    flag = os.path.join(root, 'tools', 'staging', 'STAGING-ON')
    if not os.path.isfile(flag):
        out('OFF: the test database is not built yet (tools/staging/STAGING-ON does not exist), so nothing is compared. '
            'main commits that file when the match check first says MATCH.')
        return 0
    snapshot = snapshot or os.environ.get('VP_TEST_SNAPSHOT') or os.path.expanduser('~/.gflam-migrate/test-snapshot.json')
    live_snapshot = live_snapshot or os.environ.get('VP_LIVE_SNAPSHOT') or os.path.expanduser('~/.gflam-migrate/live-snapshot.json')
    if not os.path.isfile(snapshot):
        out('FAIL: no test snapshot at %s. Take one (read only): PGOPTIONS=\'-c default_transaction_read_only=on\' psql "$TEST_DB_URL" '
            '-X -q -A -t -v ON_ERROR_STOP=1 -f tools/staging/schema-snapshot.sql > %s' % (snapshot, snapshot))
        return 1
    age_h = (now - os.path.getmtime(snapshot)) / 3600.0
    if age_h > max_age_hours or age_h < -1:
        out('FAIL: the test snapshot is %.1f hours old (limit %d). Take a fresh one before this release (README, "before EVERY release").' % (age_h, max_age_hours))
        return 1
    lines = []
    use_live = os.path.isfile(live_snapshot) and 0 <= (now - os.path.getmtime(live_snapshot)) / 3600.0 <= max_age_hours
    if use_live:
        argv = ['--live', live_snapshot, '--test', snapshot]
        how = 'against a live snapshot'
    else:
        sup = os.path.join(root, 'venueplay-backend', 'supabase')
        argv = ['--live-baselines', os.path.join(sup, 'RLS-BASELINE.json'), os.path.join(sup, 'COLUMNS-BASELINE.json'), '--test', snapshot]
        how = 'against the repo baselines'
    code = C.main(argv, out=lines.append)
    last = lines[-1] if lines else ''
    if code == 0:
        out('MATCH %s, snapshot %.1f hours old. %s' % (how, age_h, last))
        return 0
    out('FAIL: the test database does NOT match live %s (exit %d). %s  Run the same command by hand for the list.' % (how, code, last))
    return 1


def main(argv):
    def opt(n, d=None):
        return argv[argv.index(n) + 1] if n in argv and argv.index(n) + 1 < len(argv) else d
    return run(opt('--root', ROOT_DEFAULT), opt('--snapshot'), opt('--live-snapshot'), float(opt('--max-age-hours', 24)),
               float(opt('--now')) if opt('--now') else None)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
