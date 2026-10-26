#!/usr/bin/env python3
"""THE GATE'S OWN RELIABILITY, RUN. No Chrome (GATELIB_NO_CHROME): every part of the shared-Mac machinery that the gate,
the deploy tool, prove-checks and the suite ledger lean on since 27 Oct 2026 is driven here with
fake suites and fake Chromes (a /bin/sleep wearing Chrome's name), so the gate's test of itself
costs seconds and runs on any Mac, loaded or not.

    python3 tools/gate-reliability.test.py

What it runs:
  1. flake handling    a Chrome suite that fails once and passes on the retry is a PASS and is
                        logged; a jsc suite is never retried; a suite that fails twice is red
  2. timeouts          a suite that hangs is killed WITH the child it started (its process group)
  3. Chrome leaks      a suite that exits leaving a "Google Chrome --headless" behind is counted,
                        the leak is killed, and the gate line for it is red
  4. the heavy lock    free: taken with pid=; held by a live stranger: refused, naming it; held by a
                        dead pid: cleared and said so; held by our own parent: allowed
  5. Browser cleanup   verify-live's Browser ends its Chrome on SIGTERM and at exit, not only in a
                        finally
  6. deploy-worker     --gate-only exits non-zero and says RED when a suite naming the Worker fails,
                        and its fast gate picks the suites that name the file
  7. prove-checks      a suite-labelled mutation routes to that one suite; a gate label routes to
                        the gate without Chrome; a broken Chrome suite file routes to the full gate
  8. the release gate  a FAIL line's detail and the FLAKES summary line survive to the output
"""
import importlib.util, io, json, os, re, shutil, signal, subprocess, sys, tempfile, textwrap, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
sys.path.insert(0, TOOLS)
import gatelib

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


def load(name, path, argv=None):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = argv or [path]
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = saved
    return mod


def alive(pid):
    try:
        os.kill(pid, 0); return True
    except Exception:
        return False


TMP = tempfile.mkdtemp(prefix='gate-reliability-')
quiet = lambda s: None


def fake_suite(name, body):
    p = os.path.join(TMP, name)
    io.open(p, 'w', encoding='utf-8').write('#!/usr/bin/env python3\nimport os, sys, time, subprocess\n' + textwrap.dedent(body))
    return p


try:
    print('1. flake handling: a Chrome suite is retried once on a quiet machine, a jsc suite never')
    counter = os.path.join(TMP, 'count')
    flaky = fake_suite('flaky.test.py', '''
        n = int(open(%r).read() or 0) if os.path.exists(%r) else 0
        open(%r, 'w').write(str(n + 1))
        if n == 0:
            print('  FAIL phone, 3 shows: the tour card is on the page'); print('69 of 70 checks passed'); sys.exit(1)
        print('  PASS everything'); print('70 of 70 checks passed')
    ''' % (counter, counter, counter))
    always = fake_suite('always.test.py', '''
        print('  FAIL the thing'); print('69 of 70 checks passed'); sys.exit(1)
    ''')
    log = os.path.join(TMP, 'flake-log.jsonl')
    gatelib.FLAKES[:] = []
    gatelib.QUIET_WAIT_S = 1      # the wait is for a quiet machine; this test is not about waiting
    passed = lambda r: r.rc == 0 and r.last.startswith('70 of 70')
    r, flake = gatelib.run_suite_with_retry([sys.executable, flaky], 'flaky.test.py', passed, timeout=30, chrome=True, say=quiet, log_path=log)
    ok('a Chrome suite that fails once and passes on the retry is a pass', passed(r), r.last)
    ok('and it was run exactly twice', open(counter).read() == '2', open(counter).read())
    ok('the flake is recorded: suite, the check, the load, the outcome',
       flake and flake['suite'] == 'flaky.test.py' and 'tour card' in flake['check'] and 'load_at_fail' in flake
       and flake['outcome'] == 'passed on retry', flake)
    rec = [json.loads(l) for l in io.open(log, encoding='utf-8')] if os.path.exists(log) else []
    ok('and written to the flake log as one JSON line', len(rec) == 1 and rec[0]['suite'] == 'flaky.test.py' and 'time' in rec[0], rec)
    ok('the summary line names it', 'passed on retry' in gatelib.flake_summary_line() and 'flaky.test.py' in gatelib.flake_summary_line(),
       gatelib.flake_summary_line())
    io.open(counter, 'w').write('0')
    r, flake = gatelib.run_suite_with_retry([sys.executable, flaky], 'flaky.test.py', passed, timeout=30, chrome=False, say=quiet, log_path=log)
    ok('a jsc or Worker suite (chrome=False) is red first time, never retried', not passed(r) and flake is None and open(counter).read() == '1', open(counter).read())
    r, flake = gatelib.run_suite_with_retry([sys.executable, always], 'always.test.py', passed, timeout=30, chrome=True, say=quiet, log_path=log)
    ok('a Chrome suite that fails twice is red', not passed(r) and flake and flake['outcome'] == 'failed twice', flake and flake['outcome'])
    ok('and the summary says so in red', 'failed twice, RED' in gatelib.flake_summary_line(), gatelib.flake_summary_line())
    gatelib.FLAKES[:] = []
    ok('with nothing retried the summary says none', gatelib.flake_summary_line().startswith('FLAKES: none'))

    print('\n2. a suite that hangs is killed with the child it started')
    pidfile = os.path.join(TMP, 'child.pid')
    hang = fake_suite('hang.test.py', '''
        p = subprocess.Popen(['/bin/sleep', '120'])
        open(%r, 'w').write(str(p.pid))
        time.sleep(120)
    ''' % pidfile)
    t0 = time.time()
    r = gatelib.run_suite([sys.executable, hang], timeout=2)
    child = int(open(pidfile).read()) if os.path.exists(pidfile) else 0
    time.sleep(0.5)
    ok('the suite timed out and says so', r.timed_out and 'TIMED OUT' in r.out and r.rc == 124, (r.rc, round(time.time() - t0)))
    ok('and the child it started is dead too (whole process group)', child and not alive(child), child)

    print('\n3. a headless Chrome left behind by a suite is counted, killed and red')
    leaker = fake_suite('leaker.test.py', '''
        p = subprocess.Popen(['Google Chrome --headless=new --fake-for-the-test', '120'], executable='/bin/sleep')
        open(%r, 'w').write(str(p.pid))
        print('  PASS looks fine'); print('1 of 1 checks passed')
    ''' % pidfile)
    r = gatelib.run_suite([sys.executable, leaker], timeout=30)
    leaked_pid = int(open(pidfile).read())
    time.sleep(0.5)
    ok('the leak is counted by process group', len(r.leaked) == 1 and r.leaked[0][0] == leaked_pid, r.leaked)
    ok('and killed', not alive(leaked_pid), leaked_pid)
    clean = fake_suite('clean.test.py', '''
        print('  PASS tidy'); print('1 of 1 checks passed')
    ''')
    r2 = gatelib.run_suite([sys.executable, clean], timeout=30)
    ok('a tidy suite leaks nothing (so the count is not always one)', r2.leaked == [] and r2.rc == 0)
    # the gate's own line for it
    rc_src = io.open(os.path.join(TOOLS, 'release-check.py'), encoding='utf-8').read()
    ok('release-check reports a leak as its own red line', "ok('no suite left a headless Chrome behind', not _LEAKED" in rc_src)
    ok('release-check runs every tools/*.test.py through the retrying runner, Chrome judged by imports',
       'gatelib.run_suite_with_retry(' in rc_src and 'chrome = gatelib.uses_chrome(p)' in rc_src)
    ok('uses_chrome is judged by what a suite imports, not its name',
       gatelib.uses_chrome(os.path.join(TOOLS, 'touring-cards.test.py')) and not gatelib.uses_chrome(os.path.join(TOOLS, 'redirect-verdict.test.py')))

    print('\n4. the heavy lock')
    gatelib.HEAVY_LOCK = os.path.join(TMP, 'vp-heavy.lock')
    gatelib._LOCK_TAKEN_BY_ME = False
    said = []
    ok('free: taken, with pid= in the owner file', gatelib.hold_lock_or_refuse('test', say=said.append)
       and 'pid=%d' % os.getpid() in io.open(os.path.join(gatelib.HEAVY_LOCK, 'owner')).read())
    ok('held by this very process: allowed (mine)', gatelib.hold_lock_or_refuse('test', say=said.append) and any('our own run' in s for s in said))
    gatelib._release_lock()
    ok('released at the end', not os.path.isdir(gatelib.HEAVY_LOCK))
    stranger = subprocess.Popen(['/bin/sleep', '60'])
    os.mkdir(gatelib.HEAVY_LOCK)
    io.open(os.path.join(gatelib.HEAVY_LOCK, 'owner'), 'w').write('main session deploy venueplay-game retry %d Tue 27 Oct 2026 08:41:05 AEST\n' % stranger.pid)
    said = []
    refused = not gatelib.hold_lock_or_refuse('test', say=said.append)
    ok('held by a LIVE stranger (a loose pid in the old owner format): refused', refused and os.path.isdir(gatelib.HEAVY_LOCK))
    ok('and the refusal names the holder', any(str(stranger.pid) in s and 'REFUSED' in s or ('holder' in s and str(stranger.pid) in s) for s in said), said[-2:])
    ok('and the stranger\'s lock was not touched', os.path.isdir(gatelib.HEAVY_LOCK) and 'retry %d' % stranger.pid in io.open(os.path.join(gatelib.HEAVY_LOCK, 'owner')).read())
    stranger.kill(); stranger.wait()
    said = []
    ok('held by a DEAD pid: cleared, said so, and taken', gatelib.hold_lock_or_refuse('test', say=said.append)
       and any('STALE' in s for s in said) and 'pid=%d' % os.getpid() in io.open(os.path.join(gatelib.HEAVY_LOCK, 'owner')).read(), said[:1])
    gatelib._release_lock()
    # held by our parent: a child process must see it as 'mine'
    os.mkdir(gatelib.HEAVY_LOCK)
    io.open(os.path.join(gatelib.HEAVY_LOCK, 'owner'), 'w').write('pid=%d test\n' % os.getpid())
    child = subprocess.run([sys.executable, '-c', textwrap.dedent('''
        import sys; sys.path.insert(0, %r); import gatelib
        gatelib.HEAVY_LOCK = %r
        print(gatelib.lock_state()[0])
    ''' % (TOOLS, gatelib.HEAVY_LOCK))], capture_output=True, text=True)
    ok('held by our parent: a child tool sees it as its own', child.stdout.strip() == 'mine', child.stdout.strip() or child.stderr[-200:])
    shutil.rmtree(gatelib.HEAVY_LOCK, ignore_errors=True)

    print('\n5. verify-live\'s Browser ends its Chrome on SIGTERM and at exit')
    stand_in = textwrap.dedent('''
        import importlib.util, os, subprocess, sys, tempfile, time
        spec = importlib.util.spec_from_file_location('vl', %r); vl = importlib.util.module_from_spec(spec); spec.loader.exec_module(vl)
        b = vl.Browser.__new__(vl.Browser)
        b.profile = tempfile.mkdtemp(prefix='fake-chrome-')
        b.proc = subprocess.Popen(['/bin/sleep', '120'])
        vl._install_handlers(); vl._LIVE.append(b)
        open(sys.argv[1], 'w').write(str(b.proc.pid))
        if sys.argv[2] == 'sleep':
            time.sleep(120)
        # 'exit': fall off the end without calling close(): atexit must do it
    ''' % os.path.join(TOOLS, 'verify-live.py'))
    for mode in ('sleep', 'exit'):
        pf = os.path.join(TMP, 'chrome-%s.pid' % mode)
        p = subprocess.Popen([sys.executable, '-c', stand_in, pf, mode])
        end = time.time() + 20
        while time.time() < end and not os.path.exists(pf):
            time.sleep(0.1)
        chrome_pid = int(open(pf).read()) if os.path.exists(pf) else 0
        if mode == 'sleep':
            time.sleep(0.3)
            p.send_signal(signal.SIGTERM)
        try:
            p.wait(timeout=20)
        except subprocess.TimeoutExpired:
            p.kill()
        time.sleep(0.5)
        ok('%s: the Chrome stand-in is dead once the suite process has ended' % ('SIGTERM' if mode == 'sleep' else 'plain exit without close()'),
           chrome_pid and not alive(chrome_pid), (chrome_pid, p.returncode))
    vl_src = io.open(os.path.join(TOOLS, 'verify-live.py'), encoding='utf-8').read()
    ok('every Browser registers itself for atexit and the signal handlers', '_LIVE.append(self)' in vl_src and 'atexit.register(close_all_browsers)' in vl_src)
    rig_src = io.open(os.path.join(TOOLS, 'browser-rig', 'rig.py'), encoding='utf-8').read()
    ok('the rig closes at exit too (its jsc Worker as well as the Chrome)', 'atexit.register(self.close)' in rig_src)

    print('\n6. deploy-worker: the fast gate picks the suites that name the file, and a red one exits non-zero')
    dw = load('dw', os.path.join(TOOLS, 'deploy-worker.py'))
    game = dw.suites_naming('venueplay-game.js', 'venueplay-game')
    sms = dw.suites_naming('venueplay-sms-hook.js', 'venueplay-sms')
    ok('the game Worker: dozens of suites, among them the Worker rig suites and no PartyPlay ones',
       len(game) >= 30 and any('bingo-server-draw' in s for s in game) and not any('/partyplay' in s for s in game), len(game))
    ok('the SMS hook: its two suites and nothing else', [os.path.basename(s) for s in sms] == ['sms-hook-failover.test.js', 'sms-hook-secrets.test.js'], sms)
    ok('the labels the full gate still judges on the file are listed by name',
       any('is whole' in l for l in dw.labels_naming('venueplay-game.js')))
    # A scratch repo with just what the fast gate needs for the SMS hook, and ONE suite naming it, broken.
    scratch = os.path.join(TMP, 'repo')
    for rel in ('tools', 'partyplay-backend', 'venueplay-backend/worker'):
        os.makedirs(os.path.join(scratch, rel), exist_ok=True)
    for f in os.listdir(TOOLS):
        if f.endswith('.py') and not f.endswith('.test.py'):
            shutil.copy(os.path.join(TOOLS, f), os.path.join(scratch, 'tools', f))
    shutil.copy(os.path.join(TOOLS, 'gate-labels.json'), os.path.join(scratch, 'tools', 'gate-labels.json'))
    shutil.copy(os.path.join(ROOT, 'partyplay-backend', 'check-defs.py'), os.path.join(scratch, 'partyplay-backend', 'check-defs.py'))
    shutil.copy(os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-sms-hook.js'), os.path.join(scratch, 'venueplay-backend', 'worker', 'venueplay-sms-hook.js'))
    broken = os.path.join(scratch, 'venueplay-backend', 'worker', 'sms-hook-broken.test.js')
    io.open(broken, 'w', encoding='utf-8').write('// reads venueplay-sms-hook.js\nprint("FAIL the hook does not fail over");\nprint("1 of 2 checks passed");\n')
    env = dict(os.environ, VP_SKIP_LIVE='1')
    r = subprocess.run([sys.executable, os.path.join(scratch, 'tools', 'deploy-worker.py'), '--gate-only', 'venueplay-sms',
                        'venueplay-backend/worker/venueplay-sms-hook.js'], capture_output=True, text=True, env=env, cwd=scratch, timeout=300)
    out = r.stdout + r.stderr
    ok('--gate-only with a failing suite naming the file: exit non-zero', r.returncode != 0, r.returncode)
    red_said = 'THE GATE IS RED' in out and 'sms-hook-broken.test.js' in out and 'EXIT 1' in out
    ok('and it says THE GATE IS RED, nothing uploaded, with the suite named', red_said, '' if red_said else out[-300:])
    ok('and it says the full gate still runs after a deploy', 'FULL GATE STILL RUNS' in out)
    io.open(broken, 'w', encoding='utf-8').write('// reads venueplay-sms-hook.js\nprint("ok the hook fails over");\nprint("ALL 1 CHECKS PASSED");\n')
    r = subprocess.run([sys.executable, os.path.join(scratch, 'tools', 'deploy-worker.py'), '--gate-only', 'venueplay-sms',
                        'venueplay-backend/worker/venueplay-sms-hook.js'], capture_output=True, text=True, env=env, cwd=scratch, timeout=300)
    out = r.stdout + r.stderr
    green_said = r.returncode == 0 and 'GATE ONLY: green' in out and 'EXIT 0' in out
    ok('with the suite green: exit 0, nothing uploaded on purpose', green_said, '' if green_said else out[-300:])
    ok('and the fast gate parsed the file and checked its definitions', 'venueplay-sms-hook.js parses' in out and 'calls a function that does not exist' in out)
    dw_src = io.open(os.path.join(TOOLS, 'deploy-worker.py'), encoding='utf-8').read()
    ok('a refused or red deploy never exits 0: die() and the red path both print EXIT 1', dw_src.count("EXIT 1") >= 3 and '--full-gate' in dw_src)

    print('\n7. prove-checks routes a proof to the one thing that judges it')
    pc = load('pc', os.path.join(TOOLS, 'prove-checks.py'), argv=['prove-checks.py', '--list'])
    ok('a suite-labelled mutation runs that one suite',
       pc.route('sms-hook-failover.test.js', 'venueplay-backend/worker/venueplay-sms-hook.js', ROOT)[0] == 'suite'
       and pc.route('sms-hook-failover.test.js', 'x', ROOT)[1].endswith('sms-hook-failover.test.js'))
    ok('a Chrome-suite label runs that one Chrome suite, not the gate',
       pc.route('console-in-chrome.test.py', 'venueplay/app/index.html', ROOT) == ('suite', os.path.join(TOOLS, 'console-in-chrome.test.py')))
    ok('a gate-check label runs the gate without Chrome', pc.route('no gate check has disappeared', 'tools/release-check.py', ROOT) == ('gate', ['--skip-chrome']))
    ok('a gate-check label over a broken CHROME suite file runs the full gate',
       pc.route('every suite still runs at least the checks the ledger recorded', 'tools/console-in-chrome.test.py', ROOT) == ('gate', []))
    pc.FULL = True
    ok('--full is the old behaviour for everything', pc.route('sms-hook-failover.test.js', 'x', ROOT) == ('gate', []))
    pc.FULL = False
    ok('a broken suite is seen red by the suite runner, a green one is not',
       pc.suite_went_red(broken, scratch) is False and (io.open(broken, 'w', encoding='utf-8').write('print("FAIL x");print("0 of 1 checks passed");') or True)
       and pc.suite_went_red(broken, scratch) is True)
    pc_src = io.open(os.path.join(TOOLS, 'prove-checks.py'), encoding='utf-8').read()
    ok('each proof prints its route and its time', 'gate.how, gate.seconds' in pc_src)
    ok('a one-label run does not end with a full gate for the coverage report', 'if not want:' in pc_src)

    print('\n8. the release gate, --skip-chrome and the ledger agree on what was skipped')
    ok('release-check knows --skip-chrome, tells the ledger, and prints the FLAKES line',
       "'--skip-chrome' in sys.argv" in rc_src and "'--reuse', _SUITE_OUT_DIR" in rc_src and 'gatelib.flake_summary_line()' in rc_src)
    ok('release-check refuses to start Chrome over a stranger\'s live lock', "hold_lock_or_refuse('release-check'" in rc_src and 'sys.exit(3)' in rc_src)
    led_src = io.open(os.path.join(TOOLS, 'check-suite-ledger.py'), encoding='utf-8').read()
    ok('the ledger counts from the gate\'s own run (--reuse) instead of running Chrome twice', "'--reuse'" in led_src and 'REUSED.append' in led_src)
    # the ledger really reuses: a saved output for a suite in the ledger is counted, not run
    reuse = os.path.join(TMP, 'reuse'); os.makedirs(reuse)
    ledger = json.load(io.open(os.path.join(TOOLS, 'suite-counts.json'), encoding='utf-8'))
    some = next(s for s in ledger if s.endswith('-in-chrome.test.py'))
    io.open(os.path.join(reuse, some.replace('/', '__') + '.out'), 'w').write(''.join('ok check %d\n' % i for i in range(ledger[some]['checks'])) + 'ALL %d CHECKS PASSED\n' % ledger[some]['checks'])
    io.open(os.path.join(reuse, some.replace('/', '__') + '.rc'), 'w').write('0')
    led = load('led', os.path.join(TOOLS, 'check-suite-ledger.py'), argv=['check-suite-ledger.py', '--reuse', reuse])
    res = led.run(some)
    ok('a Chrome suite with a saved gate output is counted from it, not run', res[0] == 0 and res[1] == ledger[some]['checks'] and some in led.REUSED, (res, some))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
