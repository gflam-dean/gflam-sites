#!/usr/bin/env python3
"""EVERY RISKY TOOL READS ITS COMMAND LINE BEFORE IT DOES ANYTHING. Pure Python, no network, no git, no DB.

    python3 tools/cmdline-guards.test.py

18 Nov 2026 (flag audit, ~/venue-enrich/reports/flag-audit-18nov.md): after `stamp-workers.py --help` stamped the
Workers and `release.py --help` was a real release, the same fault was found in eight more tools. `--help` or a
typo ran the whole gate (release-check, prove-checks, check-suite-ledger), read the LIVE database and overwrote the
committed baselines (dump-rls-baseline), acted on --write anywhere in the line (gate-record), ran the remote gate
over trailing junk (gate-server), read the Cloudflare credentials before refusing a flag (deploy-worker) or dropped
a misspelt --merge (suite-impact). Now each one: --help/-h prints usage and exits 0, anything unknown exits 2
(deploy-worker: EXIT 1, because 2 means "uploaded" there), BEFORE any work, and every flag its callers pass (the
pre-push hook, release.py, deploy-worker, prove-checks, gate-server, the runsheets) still gets through.

FRIDAY 20 NOV (fix/tool-flag-guards-fri, on 804525c6 + 157f8d78): the first guards refused lines Wednesday's tree
uses: `gate-server.py billing BASE HEAD` and `check --billing-range=...` (the 16 Nov hook), `release-check.py
--billing-range=BASE..HEAD` (the hook) and `release.py --rollback / --urgent` (the release lanes). Every one is now
accepted, and section C runs EVERY line the pre-push hook, release.py, release-lanes.py and the release runsheets
(~/venue-enrich/reports/release-*/) pass to a guarded tool, hook lines read from tools/hooks/pre-push itself.

HOW, WITHOUT RUNNING ANY OF THEM FOR REAL:
  * release-check, prove-checks, check-suite-ledger read the line at the very top of the file. The test cuts the
    file just after that guard, appends `print GUARD-PASSED; exit 99`, and runs THAT: the real guard, and nothing
    after it can run even if the guard is broken. A structural check proves nothing but imports, constants and
    function definitions comes before the guard.
  * dump-rls-baseline, gate-record, gate-server, deploy-worker, suite-impact: main() is run in-process with every
    function that would read the database, a key, a record, git, Cloudflare or the server replaced by a recorder
    that throws, and with subprocess.run, urlopen and socket connections replaced by the same, so even a regression
    acts on nothing. "Accepted" means main() went on to its first real action (the recorder saw it).
"""
import ast, importlib.util, io, os, shutil, socket, subprocess, sys, tempfile, urllib.request
from contextlib import redirect_stdout, redirect_stderr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
PASS, FAIL = [0], [0]
TMP = os.path.realpath(tempfile.mkdtemp(prefix='cmdline-guards-'))
REAL_RUN, REAL_URLOPEN, REAL_CONN = subprocess.run, urllib.request.urlopen, socket.create_connection


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


class Acted(Exception):
    pass


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = [os.path.basename(path)]
    try:
        spec.loader.exec_module(m)
    finally:
        sys.argv = saved
    return m


# ---------------------------------------------------------------- A. guards at the top of the file

SAFE_BEFORE = (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef)
UNSAFE_WORDS = ('sys.argv', 'open(', 'subprocess', 'mkdtemp', 'gatelib', 'lock', 'urlopen', 'atexit', 'exec')


def is_main_guard(node):
    t = node.test if isinstance(node, ast.If) else None
    return (isinstance(t, ast.Compare) and isinstance(t.left, ast.Name) and t.left.id == '__name__'
            and len(t.comparators) == 1 and isinstance(t.comparators[0], ast.Constant) and t.comparators[0].value == '__main__')


def top_guard(rel):
    """(source cut just after the first `if __name__ == '__main__': parse_cmdline(...)`, [what comes before it])."""
    src = io.open(os.path.join(ROOT, rel), encoding='utf-8').read()
    tree = ast.parse(src)
    for i, node in enumerate(tree.body):
        if is_main_guard(node):
            calls = [n for n in ast.walk(node) if isinstance(n, ast.Call) and getattr(n.func, 'id', '') == 'parse_cmdline']
            if not calls:
                return None, tree.body[:i]
            return '\n'.join(src.splitlines()[:node.end_lineno]) + '\n', tree.body[:i]
    return None, tree.body


def only_harmless(before):
    """Every statement before the guard: a docstring, an import, a def, or a plain assignment that runs nothing risky."""
    bad = []
    for n in before:
        if isinstance(n, SAFE_BEFORE) or (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)):
            continue
        if isinstance(n, ast.Assign):
            text = ast.unparse(n) if hasattr(ast, 'unparse') else ast.dump(n)
            if not any(w in text for w in UNSAFE_WORDS):
                continue
        bad.append(getattr(n, 'lineno', '?'))
    return bad


def run_top(rel, argv):
    """The tool's own top, up to and including its guard, run as typed. (rc, output)."""
    cut, _ = top_guard(rel)
    d = tempfile.mkdtemp(dir=TMP)
    os.makedirs(os.path.join(d, 'tools'))
    path = os.path.join(d, 'tools', os.path.basename(rel))
    io.open(path, 'w', encoding='utf-8').write(cut + "\nprint('GUARD-PASSED')\nsys.exit(99)\n")
    r = REAL_RUN([sys.executable, path] + list(argv), capture_output=True, text=True, timeout=60, cwd=d)
    return r.returncode, r.stdout + r.stderr


TOP = {
    # tool: (lines its callers pass, which must reach GUARD-PASSED; lines that must exit 2)
    'tools/release-check.py': (
        [[], ['--local'], ['--local', '--skip-chrome'], ['--local', '--chrome-record'],   # pre-push hook, deploy-worker
         ['--skip-chrome'], ['--live'], ['--live', '--skip-chrome'],                       # release.py step 5, prove-checks
         ['--wait'], ['partyplay'], ['venueplay', '--local'], ['--update-labels'], ['--local', '--update-labels'],
         ['--vp-base', 'https://b.venueplay.pages.dev'], ['--pp-base', 'https://b.partyplay.pages.dev', '--local'],
         ['--local', '--chrome-record', '--billing-range=efc35a34..HEAD'],                  # the 16 Nov hook, a billing push
         ['--local', '--chrome-record', '--billing-range=1daeabc3..804525c6', '--billing-range=efc35a34..f00dcafe'],
         ['--chrome-record'],                                                               # release-lanes after-gate
         ['--billing-range=abc..'], ['--local', '--live', '--wait']],
        [['--loca'], ['--local', '--nope'], ['stray'], ['venueplay', 'partyplay'], ['--vp-base'], ['--chrome'],
         ['--vp-base=https://b.venueplay.pages.dev'], ['--local=yes'], ['-l'],
         ['--local', '--billing-range', 'efc35a34..HEAD'], ['--billing-range=efc35a34'], ['--billing-range='],
         ['--billing-range=..HEAD'], ['--billing-range=a..b..c'], ['--billing-rang=a..b'], ['--billing-ranges=a..b'],
         ['--billing-range=-x..b']]),
    'tools/prove-checks.py': (
        [[], ['--list'], ['--list', 'all'], ['--live'], ['--full'], ['esc'], ['canary-night.test.py'], ['canary-night'],
         ['test-prospect-free-month.js'], ['test-welcome-inbox.js'],
         ['a label with spaces in it'], ['--live', 'esc'], ['esc', '--full']],
        [['--lis'], ['--nope'], ['esc', 'more'], ['-x'], ['--list=yes'], ['--full', '--fast']]),
    'tools/check-suite-ledger.py': (
        [[], ['--update'], ['--skip-chrome'], ['--reuse', '/tmp/x'], ['--reuse', '/tmp/x', '--skip-chrome'],
         ['--reuse', '/tmp/x', '--judged-elsewhere', '/tmp/y'], ['--reuse', '/tmp/x', '--skip-chrome', '--judged-elsewhere', '/tmp/y']],
        [['--updat'], ['--nope'], ['stray'], ['--reuse'], ['--judged-elsewhere'], ['--reuse=/tmp/x'], ['--update', '--nope']]),
}

try:
    print('\nA. release-check, prove-checks, check-suite-ledger: the guard is the first thing the file runs')
    for rel, (good_lines, bad_lines) in TOP.items():
        name = os.path.basename(rel)
        cut, before = top_guard(rel)
        ok('%s: has a top-level `if __name__ == "__main__": parse_cmdline(sys.argv[1:])`' % name, cut is not None)
        if cut is None:
            continue
        bad = only_harmless(before)
        ok('%s: only imports, constants and defs come before it' % name, not bad, 'lines %s' % bad)
        g = ast.parse(cut).body[-1]
        ok('%s: the guard reads the whole command line, parse_cmdline(sys.argv[1:])' % name,
           'parse_cmdline(sys.argv[1:])' in ast.unparse(g), ast.unparse(g).replace('\n', ' ')[:120])
        for argv in (['--help'], ['-h'], ['--local', '--help'] if 'release' in rel else ['--help', '--nope']):
            rc, out = run_top(rel, argv)
            ok('%s %s: exits 0 with usage and goes no further' % (name, ' '.join(argv)),
               rc == 0 and 'usage' in out.lower() and 'GUARD-PASSED' not in out, [rc, out[-160:]])
        for argv in bad_lines:
            rc, out = run_top(rel, argv)
            ok('%s %s: exits 2 with an error and goes no further' % (name, ' '.join(argv)),
               rc == 2 and 'error' in out.lower() and 'GUARD-PASSED' not in out, [rc, out[-160:]])
        for argv in good_lines:
            rc, out = run_top(rel, argv)
            ok('%s %s: still accepted (goes on past the guard)' % (name, ' '.join(argv) or '(no flag)'),
               rc == 99 and 'GUARD-PASSED' in out, [rc, out[-160:]])

    # ---------------------------------------------------------------- B. main() in-process, every way out a recorder
    acted = []

    def rec(what, value=None, throw=True):
        def f(*a, **k):
            acted.append((what, a, k))
            if throw:
                raise Acted(what)
            return value
        return f

    def call(fn, argv=None, sys_argv=None):
        """(rc, what it acted on, output). sys.argv is set when the tool reads it itself."""
        del acted[:]
        saved = sys.argv
        out = io.StringIO()
        subprocess.run, urllib.request.urlopen, socket.create_connection = rec('subprocess.run'), rec('urlopen'), rec('socket')
        if sys_argv is not None:
            sys.argv = [sys_argv[0]] + list(argv)
        try:
            with redirect_stdout(out), redirect_stderr(out):
                try:
                    rc = fn(list(argv)) if sys_argv is None else fn()
                except SystemExit as e:
                    rc = e.code
                except Acted:
                    rc = 'acted'
        finally:
            sys.argv = saved
            subprocess.run, urllib.request.urlopen, socket.create_connection = REAL_RUN, REAL_URLOPEN, REAL_CONN
        return rc, [a[0] for a in acted], out.getvalue()

    # ---- dump-rls-baseline: anything but --check used to read LIVE and overwrite both committed baselines
    print('\nB1. venueplay-backend/tools/dump-rls-baseline.py')
    D = load(os.path.join(ROOT, 'venueplay-backend', 'tools', 'dump-rls-baseline.py'), 'dump_rls_under_test')
    D.OUT, D.COLS_OUT = os.path.join(TMP, 'RLS-BASELINE.json'), os.path.join(TMP, 'COLUMNS-BASELINE.json')
    for p in (D.OUT, D.COLS_OUT):
        io.open(p, 'w').write('{"untouched": true}\n')
    D.connect, D.snapshot = rec('connect'), rec('snapshot')

    def untouched():
        return all(io.open(p).read() == '{"untouched": true}\n' for p in (D.OUT, D.COLS_OUT))
    for argv in (['--help'], ['-h'], ['--check', '--help']):
        rc, did, out = call(D.main, argv)
        ok('dump-rls-baseline %s: exits 0 with usage, no database, no file written' % ' '.join(argv),
           rc == 0 and 'usage' in out.lower() and not did and untouched(), [rc, did])
    for argv in (['--chek'], ['--check', '--nope'], ['stray'], ['--check=yes'], ['-c'], ['--dry-run']):
        rc, did, out = call(D.main, argv)
        ok('dump-rls-baseline %s: exits 2, no database, no file written' % ' '.join(argv),
           rc == 2 and 'error' in out.lower() and not did and untouched(), [rc, did])
    rc, did, out = call(D.main, ['--check'])
    ok('dump-rls-baseline --check: still goes to the database (release-check live half)', did[:1] == ['snapshot'], [rc, did])
    rc, did, out = call(D.main, [])
    ok('dump-rls-baseline (no flag): still goes to the database to rewrite the baselines', did[:1] == ['snapshot'], [rc, did])
    rc, did, out = call(D.main, ['--help'], sys_argv=['dump-rls-baseline.py'])
    ok('dump-rls-baseline main() with no argument reads sys.argv (how the script runs it)', rc == 0 and not did, [rc, did])

    # ---- gate-record
    print('\nB2. tools/gate-record.py')
    G = load(os.path.join(TOOLS, 'gate-record.py'), 'gate_record_under_test')
    G.write_record, G.clear_record, G.decide = rec('write'), rec('clear'), rec('decide')
    G.current_tree, G._git = rec('git'), rec('git')
    for argv in (['--help'], ['-h'], ['--help', '--write'], ['--write', '--help']):
        rc, did, out = call(G.main, argv)
        ok('gate-record %s: exits 0 with usage, no record touched' % ' '.join(argv), rc == 0 and 'usage' in out.lower() and not did, [rc, did])
    for argv in (['--nope'], ['--write', '--nope'], ['stray'], ['--write', 'stray'], ['--wri'], ['--root'], ['--decide', '--root']):
        rc, did, out = call(G.main, argv)
        ok('gate-record %s: exits 2, no record touched' % ' '.join(argv), rc == 2 and 'error' in out.lower() and not did, [rc, did])
    for argv, want in ((['--write'], 'write'), (['--clear'], 'clear'), (['--decide'], 'decide'),
                       (['--clear', '--write'], 'write'), (['--root', TMP, '--decide'], 'decide')):
        rc, did, out = call(G.main, argv)
        ok('gate-record %s: still acts (%s)' % (' '.join(argv), want), did[:1] == [want], [rc, did])
    rc, did, out = call(G.main, ['--root', TMP, '--decide'])
    ok('gate-record --root DIR: the record is looked for in DIR', acted and acted[0][1][:1] == (TMP,), acted[:1])
    rc, did, out = call(G.main, [])
    ok('gate-record (no flag): prints its doc and exits 2, as before', rc == 2 and 'PRE-PUSH GATE' in out and not did, [rc, did])

    # ---- gate-server
    print('\nB3. tools/gate-server.py')
    S = load(os.path.join(TOOLS, 'gate-server.py'), 'gate_server_under_test')
    fake_runner = os.path.join(TMP, 'remote-run.sh')
    io.open(fake_runner, 'w').write('exit 1\n')
    S.REMOTE_RUN = fake_runner
    S.init_key, S.accepted, S.write_record = rec('init-key'), rec('accepted'), rec('write_record')
    S.read_key = rec('read_key', ('k' * 64, ''), throw=False)
    S.remote_runner, S.host_key_fingerprint = rec('remote_runner', None, throw=False), rec('host_key', '', throw=False)
    S.make_record = rec('make_record')
    S.billing_changes, S.billing_suites, S.billing_verdict = rec('billing_changes'), rec('billing_suites'), rec('billing_verdict')
    for argv in (['--help'], ['-h'], ['run', '--help'], ['check', '-h']):
        rc, did, out = call(S.main, argv)
        ok('gate-server %s: exits 0 with usage, nothing run' % ' '.join(argv), rc == 0 and 'usage' in out.lower() and not did, [rc, did])
    for argv in (['bogus'], ['run', '--oops'], ['run', '-j', '9'], ['run', '-j'], ['run', '-j', '3', 'extra'],
                 ['check', 'extra'], ['init-key', '--force'], ['--run'], ['run', 'check'],
                 ['billing'], ['billing', 'efc35a34'], ['billing', 'a', 'b', 'c'], ['billing', '--x', 'b'], ['billing', 'a', '-j'],
                 ['check', '--billing-range'], ['check', '--billing-range', 'a..b'], ['check', '--billing-range=nodots'],
                 ['check', '--billing-range=..b'], ['check', '--billing-range=a..b', 'extra'], ['check', '--billing-rang=a..b'],
                 ['billing-suites', 'a'], ['billing-suites', 'a', 'b', 'c'], ['billing-suites', '--all'], ['billing-range']):
        rc, did, out = call(S.main, argv)
        ok('gate-server %s: exits 2, nothing run' % ' '.join(argv), rc == 2 and 'error' in out.lower() and not did, [rc, did])
    rc, did, out = call(S.main, ['check'])
    ok('gate-server check: still reads the record (pre-push hook)', did == ['accepted'], [rc, did])
    rc, did, out = call(S.main, ['init-key'])
    ok('gate-server init-key: still makes the key', did == ['init-key'], [rc, did])
    rc, did, out = call(S.main, ['check', '--billing-range=abc..def', '--billing-range=1a2b..HEAD'])
    ok('gate-server check --billing-range=A..B --billing-range=C..D: still reads the record, with both ranges (hook dry run)',
       did == ['accepted'] and acted[0][2].get('extra_ranges') == [('abc', 'def'), ('1a2b', 'HEAD')], [rc, did, acted[:1]])
    rc, did, out = call(S.main, ['billing', 'efc35a34', 'bb2d9d8c'])
    ok('gate-server billing BASE HEAD: still judges that exact range (the 16 Nov pre-push hook)',
       did == ['billing_changes'] and acted[0][1][1:] == ('efc35a34', 'bb2d9d8c'), [rc, did, acted[:1]])
    for argv in (['billing-suites'], ['billing-suites', 'efc35a34', 'HEAD']):
        rc, did, out = call(S.main, argv)
        ok('gate-server %s: still lists the billing suites (read only)' % ' '.join(argv),
           did[:1] == (['billing_suites'] if len(argv) == 1 else ['billing_changes']), [rc, did])
    for argv, jobs in ((['run'], S.JOBS), (['run', '-j', '3'], 3), (['run', '-j', '1'], 1)):
        rc, did, out = call(S.main, argv)
        mk = [a for a in acted if a[0] == 'make_record']
        ok('gate-server %s: still runs, %d at once (pre-push hook, release.py, runsheets)' % (' '.join(argv), jobs),
           did[:1] == ['read_key'] and mk and mk[0][2].get('jobs') == jobs, [rc, did, mk and mk[0][2].get('jobs')])
    rc, did, out = call(S.main, [])
    ok('gate-server (no subcommand): prints its doc and exits 2, as before', rc == 2 and 'vp-tests-1' in out and not did, [rc, did])

    # ---- deploy-worker
    print('\nB4. tools/deploy-worker.py')
    W = load(os.path.join(TOOLS, 'deploy-worker.py'), 'deploy_worker_under_test')
    W.creds, W.cf, W.list_workers = rec('creds'), rec('cf'), rec('list')
    W.gate_or_die, W.upload, W.fetch_health, W.wait_for_build = rec('gate'), rec('upload'), rec('health'), rec('wait')
    GAME = 'venueplay-backend/worker/venueplay-game.js'
    for argv in (['--help'], ['-h'], ['--live', '--help'], ['--help', 'venueplay-game', GAME], ['--nope', '--help']):
        rc, did, out = call(W.main, argv, sys_argv=['deploy-worker.py'])
        ok('deploy-worker %s: exits 0 with usage, no credentials read' % ' '.join(argv),
           rc == 0 and 'usage' in out.lower() and not did, [rc, did])
    for argv in (['--nope'], ['--lve', 'venueplay-game', GAME], ['--live', '--dry-run', 'venueplay-game', GAME], ['-x'],
                 ['--do-class', 'VenueRoom'], ['--list', '--all'], ['--gate-only', '-v', 'venueplay-game', GAME]):
        rc, did, out = call(W.main, argv, sys_argv=['deploy-worker.py'])
        ok('deploy-worker %s: refused, EXIT 1 nothing uploaded, no credentials read' % ' '.join(argv),
           rc == 1 and 'unknown flag' in out and 'EXIT 1' in out and not did, [rc, did, out[-120:]])
    for argv, first in ((['--list'], 'creds'), ([], 'creds'), (['--live', 'venueplay-game', GAME], 'creds'),
                        (['--live', '--full-gate', 'venueplay-game', GAME], 'creds'),
                        (['--do-class=VenueRoom', 'venueplay-game-sydney', GAME], 'creds'),
                        (['--live', '--emergency=rolling back a bad deploy, gate is down', 'venueplay-game', GAME], 'creds'),
                        (['--gate-only', 'venueplay-game', GAME], 'gate'),
                        # runsheets (release-fri-20nov, release-wed-18nov, release-15nov/rollback) and release-lanes R5:
                        (['--live', 'venueplay-api', 'venueplay-backend/worker/venueplay-api-FULL.js'], 'creds'),
                        (['--live', 'venueplay-api', '/Users/x/venue-enrich/reports/release-15nov/rollback/venueplay-api-FULL.LIVE-ca7c9886.js'], 'creds'),
                        (['--live', 'venueplay-api', 'venueplay-backend/worker/venueplay-api-FULL.js', '--emergency=api down, venues waiting'], 'creds'),
                        (['--live', '--emergency=rollback to efc35a34', 'venueplay-game', GAME], 'creds')):
        rc, did, out = call(W.main, argv, sys_argv=['deploy-worker.py'])
        ok('deploy-worker %s: still goes on (%s first; release.py passes --live)' % (' '.join(argv) or '(no flag)', first),
           did[:1] == [first], [rc, did, out[-120:]])

    # ---- suite-impact
    print('\nB5. tools/suite-impact.py')
    I = load(os.path.join(TOOLS, 'suite-impact.py'), 'suite_impact_under_test')
    I.git, I.changed_pages = rec('git'), rec('pages')
    for argv in (['--help'], ['-h'], ['main', 'HEAD', '--help']):
        rc, did, out = call(I.main, argv)
        ok('suite-impact %s: exits 0 with usage, no git' % ' '.join(argv), rc == 0 and 'suite-impact.py <base>' in out and not did, [rc, did])
    for argv in (['main', 'HEAD', '--merg'], ['main', 'HEAD', '--nope'], ['main', 'HEAD', '-m'], ['--merge=yes', 'main', 'HEAD']):
        rc, did, out = call(I.main, argv)
        ok('suite-impact %s: exits 2, no git' % ' '.join(argv), rc == 2 and 'error' in out.lower() and not did, [rc, did])
    for argv in ([], ['main'], ['a', 'b', 'c']):
        rc, did, out = call(I.main, argv)
        ok('suite-impact %s: not two refs, prints its doc and exits 2, as before' % (' '.join(argv) or '(nothing)'),
           rc == 2 and not did and 'suite-impact.py <base>' in out, [rc, did])
    for argv, first in ((['main', 'HEAD'], 'git'), (['main', 'HEAD', '--merge'], 'git'), (['--merge', 'main', 'HEAD'], 'git'),
                        (['main', 'dir:' + TMP], 'pages')):
        rc, did, out = call(I.main, argv)
        ok('suite-impact %s: still runs' % ' '.join(argv), did[:1] == [first], [rc, did])
    rc, did, out = call(I.main, ['--help'], sys_argv=['suite-impact.py'])
    ok('suite-impact main() with no argument reads sys.argv (how the script runs it)', rc == 0 and not did, [rc, did])

    # ---- release.py: the release itself AND the two fast lanes (release-lanes.py, Jobs 442) through one guard
    print('\nB6. tools/release.py (the release, --rollback, --urgent)')
    R = load(os.path.join(TOOLS, 'release.py'), 'release_under_test')

    class FakeLanes(object):
        main = staticmethod(rec('lanes.main'))
    R.sh, R.remote_main, R.lanes = rec('sh'), rec('remote_main'), rec('lanes', FakeLanes, throw=False)
    SHA = 'efc35a3438051b6264f643f73e31d56a13f05157'
    for argv in (['--help'], ['-h'], ['--plan', '--help'], ['--rollback', '--help'], ['--urgent', 'why', '-h']):
        rc, did, out = call(R.main, argv, sys_argv=['release.py'])
        ok('release.py %s: exits 0 with usage, nothing run' % ' '.join(argv), rc == 0 and 'usage' in out.lower() and not did, [rc, did])
    for argv in (['--nope'], ['--pla'], ['stray'], ['--rollbak'], ['--rollback', '--oops'], ['--rollback', 'stray'],
                 ['--rollback', '--to'], ['--rollback', '--reason', '--go'], ['--rollback', '--go=yes'], ['--urgent'],
                 ['--urgent', '--go'], ['--rollback', '--urgent', 'why'], ['--urgent', 'why', '--to', SHA],
                 ['--urgent', 'why', '--allow-migration', 'x.sql'], ['--rollback', '--help', '--nope'], ['--rollback', '-g']):
        rc, did, out = call(R.main, argv, sys_argv=['release.py'])
        ok('release.py %s: exits 2, nothing run' % ' '.join(argv), rc == 2 and 'error' in out.lower() and not did, [rc, did])
    for argv in ([], ['--plan']):
        rc, did, out = call(R.main, argv, sys_argv=['release.py'])
        ok('release.py %s: still goes on to git (the release)' % (' '.join(argv) or '(no flag)'), did[:1] == ['sh'], [rc, did])
    for argv in (['--rollback'], ['--rollback', '--go'], ['--rollback', '--to', SHA, '--reason', 'the canary night was red'],
                 ['--rollback', '--to', SHA, '--reason', 'why', '--go'], ['--rollback', '--plan'],
                 ['--rollback', '--allow-migration', 'venueplay-201-x.sql', '--allow-migration', 'y.sql', '--reason', 'why'],
                 ['--urgent', 'buzzer stuck on trivia'], ['--urgent', 'buzzer stuck', '--go']):
        rc, did, out = call(R.main, argv, sys_argv=['release.py'])
        lane = [a for a in acted if a[0] == 'lanes.main']
        ok('release.py %s: still hands the lane exactly its words' % ' '.join(argv),
           did == ['lanes', 'lanes.main'] and lane and lane[0][1][0] == [a for a in argv if a != '--plan'], [rc, did])

    # ---- C. EVERY LINE THE HOOK, release.py, release-lanes.py AND THE RUNSHEETS PASS TO A GUARDED TOOL IS ACCEPTED
    print('\nC. every line the pre-push hook, release.py, release-lanes.py and the release runsheets use')
    import re as _re
    W2 = load(os.path.join(TOOLS, 'stamp-workers.py'), 'stamp_workers_under_test')

    def accepted(tool, argv):
        """(accepted, detail). Each runs only the tool's guard, or its main() with every way out a recorder."""
        if tool in TOP:
            rc, out = run_top(tool, argv)
            return rc == 99, rc
        if tool == 'tools/stamp-workers.py':
            try:
                with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    W2.parse_args(list(argv))
                return True, 'parsed'
            except SystemExit as e:
                return False, e.code
        fn, sa = {'tools/gate-server.py': (S.main, None), 'tools/gate-record.py': (G.main, None),
                  'tools/deploy-worker.py': (W.main, ['deploy-worker.py']), 'tools/release.py': (R.main, ['release.py']),
                  'venueplay-backend/tools/dump-rls-baseline.py': (D.main, None), 'tools/suite-impact.py': (I.main, None)}[tool]
        rc, did, out = call(fn, argv, sys_argv=sa)
        return bool(did), [rc, did]   # accepted = it went on to its first real action (a recorder saw it)

    # The hook's own lines, read from tools/hooks/pre-push, its shell words filled in as a billing push fills them.
    hook = io.open(os.path.join(TOOLS, 'hooks', 'pre-push'), encoding='utf-8').read()
    fill = {'$CHROME_FLAG': '--chrome-record', '$BILLING_ARGS': '--billing-range=efc35a34..9f8e7d6c',
            '"$PBASE"': 'efc35a34', '"$LSHA"': '9f8e7d6c', '"$PUSH_SHA"': '9f8e7d6c', '"$REMOTE_SHA"': 'efc35a34'}
    hook_lines = []
    for m in _re.finditer(r'python3 "\$ROOT/(tools/[\w.-]+\.py)"([^;|\n]*)', hook):
        rest = m.group(2)
        rest = _re.sub(r'\s*(\|\||then|&&).*$', '', rest).strip()
        for k, v in fill.items():
            rest = rest.replace(k, v)
        hook_lines.append((m.group(1), rest.split()))
    tools_seen = sorted(set(t for t, _ in hook_lines))
    ok('the hook calls the tools this test knows (stamp-workers, gate-server, release-lanes, release-check, gate-record)',
       tools_seen == ['tools/gate-record.py', 'tools/gate-server.py', 'tools/release-check.py', 'tools/release-lanes.py',
                      'tools/stamp-workers.py'], tools_seen)
    ok('the hook hands release-check and gate-server check the exact pushed range (--billing-range=...)',
       ('tools/release-check.py', ['--local', '--chrome-record', '--billing-range=efc35a34..9f8e7d6c']) in hook_lines
       and ('tools/gate-server.py', ['check', '--billing-range=efc35a34..9f8e7d6c']) in hook_lines, hook_lines)
    hook_lines += [('tools/release-check.py', ['--local']), ('tools/release-check.py', ['--local', '--chrome-record']),
                   ('tools/gate-server.py', ['check']),
                   ('tools/release-check.py', ['--local', '--chrome-record', '--billing-range=a1..b2', '--billing-range=c3..d4'])]

    CALLERS = [
        # release.py
        ('tools/stamp-workers.py', ['--check']), ('tools/deploy-worker.py', ['--live', 'venueplay-api', 'venueplay-backend/worker/venueplay-api-FULL.js']),
        ('tools/deploy-worker.py', ['--live', 'venueplay-game', GAME]), ('tools/gate-server.py', ['run']),
        ('tools/release-check.py', ['--live']), ('tools/release-check.py', ['--local']),
        # release-lanes.py (rollback R5/R8, urgent U2/U4/U6, after-gate U9)
        ('tools/deploy-worker.py', ['--live', '--emergency=rollback to efc35a34', 'venueplay-api', 'venueplay-backend/worker/venueplay-api-FULL.js']),
        ('tools/release-check.py', ['--local', '--skip-chrome']), ('tools/release-check.py', ['--chrome-record']),
        # release-check.py (the ledger and the RLS line), deploy-worker.py (its fast gate), suite-impact --merge
        ('tools/check-suite-ledger.py', ['--reuse', '/tmp/suite-out']), ('tools/check-suite-ledger.py', ['--reuse', '/tmp/o', '--skip-chrome', '--judged-elsewhere', '/tmp/o/judged-elsewhere.txt']),
        ('venueplay-backend/tools/dump-rls-baseline.py', ['--check']), ('tools/prove-checks.py', ['--list']),
    ]
    RUNSHEETS = [
        # ~/venue-enrich/reports/release-fri-20nov/RUNSHEET.md, release-wed-18nov/RUNSHEET.md, release-sun-22nov/RUNSHEET.md,
        # release-15nov/rollback/ROLLBACK.md, the b2/b9/ledger notes and wed-to-fri-checklist-18nov.md (grep of 18 Nov)
        ('tools/stamp-workers.py', []), ('tools/stamp-workers.py', ['--check']),
        ('tools/prove-checks.py', ['--list', 'all']), ('tools/prove-checks.py', ['canary-night']),
        ('tools/prove-checks.py', ['canary-night.test.py']), ('tools/prove-checks.py', ['test-prospect-free-month.js']),
        ('tools/release-check.py', ['--local', '--skip-chrome']), ('tools/release-check.py', ['--skip-chrome']),
        ('tools/release-check.py', ['--local', '--update-labels']), ('tools/release-check.py', ['--live']),
        ('tools/release-check.py', ['--local', '--chrome-record', '--billing-range=efc35a34..HEAD']),
        ('tools/release-check.py', ['--vp-base', 'https://fix-x.venueplay.pages.dev']),
        ('tools/check-suite-ledger.py', []), ('tools/check-suite-ledger.py', ['--update']), ('tools/check-suite-ledger.py', ['--skip-chrome']),
        ('venueplay-backend/tools/dump-rls-baseline.py', ['--check']), ('venueplay-backend/tools/dump-rls-baseline.py', []),
        ('tools/gate-server.py', ['run', '-j', '3']), ('tools/gate-server.py', ['run', '-j', '4']), ('tools/gate-server.py', ['run']),
        ('tools/gate-server.py', ['check']), ('tools/gate-server.py', ['init-key']),
        ('tools/gate-server.py', ['billing', 'efc35a34', 'bb2d9d8c']),
        ('tools/deploy-worker.py', ['--live', 'venueplay-api', 'venueplay-backend/worker/venueplay-api-FULL.js']),
        ('tools/deploy-worker.py', ['--live', 'venueplay-game', 'venueplay-backend/worker/venueplay-game.js']),
        ('tools/deploy-worker.py', ['--live', 'venueplay-api', 'venueplay-backend/worker/venueplay-api-FULL.js', '--emergency=why']),
        ('tools/deploy-worker.py', ['--live', 'venueplay-game', 'venueplay-backend/worker/venueplay-game.js', '--emergency=why']),
        ('tools/deploy-worker.py', ['--live', 'venueplay-api', '/Users/x/venue-enrich/reports/release-15nov/rollback/venueplay-api-FULL.LIVE-ca7c9886.js']),
        ('tools/deploy-worker.py', ['--live', 'venueplay-game', '/Users/x/venue-enrich/reports/release-15nov/rollback/venueplay-game.LIVE-ca7c9886.js']),
        ('tools/release.py', []), ('tools/release.py', ['--plan']), ('tools/release.py', ['--rollback']),
        ('tools/release.py', ['--rollback', '--go']),
        ('tools/release.py', ['--rollback', '--to', 'efc35a3438051b6264f643f73e31d56a13f05157', '--reason', 'Wednesday never reached step 7']),
        ('tools/gate-record.py', ['--decide']), ('tools/suite-impact.py', ['origin/main', 'release/thu-19nov-d', '--merge']),
    ]
    for source, lines in (('hook', hook_lines), ('caller', CALLERS), ('runsheet', RUNSHEETS)):
        for tool, argv in lines:
            if tool == 'tools/release-lanes.py':
                continue   # not a guarded tool (it is reached through release.py, B6); its hook line is named above
            good, detail = accepted(tool, argv)
            ok('%s line accepted: %s %s' % (source, os.path.basename(tool), ' '.join(argv) or '(no flag)'), good, detail)
finally:
    subprocess.run, urllib.request.urlopen, socket.create_connection = REAL_RUN, REAL_URLOPEN, REAL_CONN
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
