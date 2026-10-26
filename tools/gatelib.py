"""THE PARTS OF THE GATE THAT EVERY TOOL ON THIS SHARED MAC NEEDS TO AGREE ON.

release-check.py, deploy-worker.py, prove-checks.py and check-suite-ledger.py all start
Chrome, all share one Mac with other agents, and until 27 Oct 2026 each did these things
its own way or not at all. Since 25 Oct every release stalled for hours behind the test
system, not the product: two deploys in a row were refused by ONE Chrome check each that
had passed minutes earlier; 50 to 70 leaked headless Chromes pushed the load past 10 and
made the next suites time out; and a timed-out suite left its Chrome behind because
subprocess.run only kills the Python it started.

So, in one place:

  heavy lock    /tmp/vp-heavy.lock, one heavy Chrome run at a time. Held by a LIVE pid
                (kill -0) or it is stale and may be cleared; a tool whose own ancestor holds
                it (deploy-worker runs release-check runs a suite) is not refused by itself.
  quiet wait    wait until the 1-minute load average is under 4, or 60 s, before a retry
  run_suite     a suite runs in its own process group; on timeout the WHOLE group is
                killed, Chrome included; any headless Chrome still in the group afterwards
                is counted as a leak, killed, and reported
  flake retry   a CHROME suite that fails is run once more on a quiet machine before it is
                called red; both runs are written to tools/flake-log.jsonl with the load at
                the time; a suite that fails twice is red, as before. jsc and Worker suites
                are deterministic and are never retried.

Everything here is plain Python 3.9, no third party modules, like the rest of tools/.
"""
import io, json, os, re, signal, subprocess, sys, time, atexit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEAVY_LOCK = '/tmp/vp-heavy.lock'
FLAKE_LOG = os.path.join(ROOT, 'tools', 'flake-log.jsonl')
QUIET_LOAD = 4.0
QUIET_WAIT_S = 60
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'

FLAKES = []            # every retry this process made, for the one-line summary at the end
_LOCK_TAKEN_BY_ME = False


# ---------------------------------------------------------------- load

def load_avg():
    try:
        return os.getloadavg()[0]
    except Exception:
        return 0.0


def wait_quiet(below=QUIET_LOAD, max_wait=QUIET_WAIT_S, say=None):
    """Wait until the 1-minute load average is under `below`, or `max_wait` seconds.
    Returns (load now, seconds waited)."""
    t0 = time.time()
    load = load_avg()
    while load >= below and time.time() - t0 < max_wait:
        if say and int(time.time() - t0) % 15 == 0:
            say('  waiting for a quiet machine: load %.1f (want under %.0f)' % (load, below))
        time.sleep(3)
        load = load_avg()
    return load, time.time() - t0


# ---------------------------------------------------------------- the heavy lock

def is_live_pid(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return False


def my_ancestors():
    """This process and every parent above it, so a tool run BY the lock holder is not
    refused by its own parent's lock."""
    pids, pid = [], os.getpid()
    for _ in range(40):
        pids.append(pid)
        try:
            out = subprocess.run(['ps', '-o', 'ppid=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
            pid = int(out)
        except Exception:
            break
        if pid <= 1:
            pids.append(pid)
            break
    return pids


def lock_holder():
    """(pid or None, owner text) for /tmp/vp-heavy.lock, or (None, '') when it is free.

    The owner file is free text written by whoever took the lock. Ours say pid=<n>; older
    ones wrote the pid loose between words and dates ("main session deploy venueplay-game
    retry 64387 Tue 27 Oct 2026 08:41:05 AEST"), so the fallback takes the first number
    that could be a pid (100 to 99999, not a year) and asks the kernel whether it is alive."""
    if not os.path.isdir(HEAVY_LOCK):
        return None, ''
    text = ''
    for name in ('owner', 'pid'):
        p = os.path.join(HEAVY_LOCK, name)
        if os.path.isfile(p):
            try:
                text += io.open(p, encoding='utf-8', errors='replace').read().strip() + ' '
            except Exception:
                pass
    m = re.search(r'pid=(\d+)', text)
    if m:
        return int(m.group(1)), text.strip()
    for tok in re.findall(r'\b(\d{3,5})\b', text):
        n = int(tok)
        if 2000 <= n <= 2100:
            continue
        return n, text.strip()
    return None, text.strip() or '(no owner file)'


def lock_state():
    """'free', 'mine' (held by this process or an ancestor), 'stale' (owner pid is dead or
    unreadable) or 'held' (a live pid that is not ours)."""
    pid, text = lock_holder()
    if not os.path.isdir(HEAVY_LOCK):
        return 'free', pid, text
    if pid is None:
        return 'stale', pid, text
    if pid in my_ancestors():
        return 'mine', pid, text
    if not is_live_pid(pid):
        return 'stale', pid, text
    return 'held', pid, text


def _release_lock():
    global _LOCK_TAKEN_BY_ME
    if _LOCK_TAKEN_BY_ME:
        try:
            for n in os.listdir(HEAVY_LOCK):
                os.remove(os.path.join(HEAVY_LOCK, n))
            os.rmdir(HEAVY_LOCK)
        except Exception:
            pass
        _LOCK_TAKEN_BY_ME = False


def hold_lock_or_refuse(tool, say=print, wait_s=0):
    """Before any Chrome run. Takes /tmp/vp-heavy.lock for this process (released at exit),
    passes if an ancestor already holds it, clears a stale one and says so, and REFUSES when a
    live pid that is not ours holds it, naming the holder. With wait_s > 0 it waits that long
    for the holder to finish before refusing.

    Returns True when this process may run Chrome. On refusal it prints why and returns False;
    the caller exits non-zero. It never removes another live process's lock."""
    global _LOCK_TAKEN_BY_ME
    deadline = time.time() + wait_s
    said = False
    while True:
        state, pid, text = lock_state()
        if state == 'mine':
            say('  heavy lock: held by our own run (pid %s), carrying on' % pid)
            return True
        if state == 'stale':
            say('  heavy lock: STALE, its owner (pid %s) is gone: "%s". Clearing it.' % (pid, text[:100]))
            try:
                for n in os.listdir(HEAVY_LOCK):
                    os.remove(os.path.join(HEAVY_LOCK, n))
                os.rmdir(HEAVY_LOCK)
            except Exception as e:
                say('  could not clear it (%s); refusing' % e)
                return False
            state = 'free'
        if state == 'free':
            try:
                os.mkdir(HEAVY_LOCK)
            except FileExistsError:
                continue        # somebody took it between the look and the mkdir; look again
            with io.open(os.path.join(HEAVY_LOCK, 'owner'), 'w', encoding='utf-8') as fh:
                fh.write('pid=%d %s %s\n' % (os.getpid(), tool, time.strftime('%a %d %b %Y %H:%M:%S')))
            _LOCK_TAKEN_BY_ME = True
            atexit.register(_release_lock)
            say('  heavy lock: taken by %s (pid %d)' % (tool, os.getpid()))
            return True
        # held by a live pid that is not ours
        if time.time() < deadline:
            if not said:
                say('  heavy lock: held by pid %s ("%s"), waiting up to %ds' % (pid, text[:100], wait_s))
                said = True
            time.sleep(5)
            continue
        say('  REFUSED: %s will not start Chrome while /tmp/vp-heavy.lock is held by a live process.' % tool)
        say('  holder: pid %s, "%s" (load %.1f). Wait for it, or run with VP_WAIT_LOCK=<seconds>.' % (pid, text[:120], load_avg()))
        return False


# ---------------------------------------------------------------- running a suite

SUITE_NAME = re.compile(r'(\.test\.(js|py)$|^test-[\w.-]+\.js$)')


def uses_chrome(path):
    """Does this SUITE drive a real Chrome? Judged by what it imports, not by its name:
    touring-cards.test.py, touring-signups.test.py and help-desk-pages.test.py all open
    Chrome and none of them says in-chrome. Only a suite file can say yes: release-check.py
    and prove-checks.py mention verify-live in prose and start no Chrome of their own."""
    if not SUITE_NAME.search(os.path.basename(path)):
        return False
    try:
        src = io.open(path, encoding='utf-8', errors='replace').read()
    except Exception:
        return False
    if 'GATELIB_NO_CHROME' in src:        # a suite that talks ABOUT Chrome without starting one says so
        return False
    return 'verify-live.py' in src or 'browser-rig' in src or 'browser_rig' in src or '--headless' in src


def headless_chrome(pgid=None):
    """[(pid, pgid, etime)] of every 'Google Chrome --headless' process, or only those in one
    process group. Other agents' Chromes are in other groups, so a group count is ours alone."""
    try:
        out = subprocess.run(['ps', '-axo', 'pid=,pgid=,etime=,command='], capture_output=True, text=True).stdout
    except Exception:
        return []
    found = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        pid, pg, et, cmd = parts
        if 'Google Chrome' in cmd and '--headless' in cmd:
            if pgid is None or int(pg) == int(pgid):
                found.append((int(pid), int(pg), et))
    return found


def kill_group(pgid, sig=signal.SIGKILL):
    try:
        os.killpg(int(pgid), sig)
        return True
    except Exception:
        return False


class SuiteRun(object):
    def __init__(self, rc, out, timed_out, leaked, seconds):
        self.rc, self.out, self.timed_out, self.leaked, self.seconds = rc, out, timed_out, leaked, seconds

    @property
    def lines(self):
        return self.out.strip().splitlines()

    @property
    def last(self):
        return self.lines[-1] if self.lines else ''

    @property
    def fails(self):
        return [l.strip() for l in self.lines if l.strip().startswith('FAIL')]


def run_suite(cmd, cwd=ROOT, timeout=None, env=None):
    """Run one suite in a process group of its own and wait. On timeout the whole group is
    killed (the suite AND the Chrome it started: subprocess.run's timeout kills only the
    Python and left the Chrome behind, 24 to 26 Oct 2026). Any headless Chrome still in the
    group when the suite has ended is a leak: counted, killed, and reported in .leaked."""
    import threading
    t0 = time.time()
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         start_new_session=True, env=env)
    # The output is read on a thread and the SUITE is what is waited for. communicate() waits for
    # the pipe to close instead, and a child the suite left behind holds the pipe open: a leaked
    # Chrome would have made the gate sit out the whole timeout after the suite had ended.
    chunks = []
    reader = threading.Thread(target=lambda: chunks.append(p.stdout.read()), daemon=True)
    reader.start()
    timed_out = False
    try:
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_group(p.pid, signal.SIGTERM)
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            kill_group(p.pid, signal.SIGKILL)
            p.wait()
    leaked = headless_chrome(pgid=p.pid)
    if leaked:
        kill_group(p.pid, signal.SIGKILL)
        time.sleep(0.5)
    reader.join(timeout=10)
    if reader.is_alive():                     # something else in the group still holds the pipe
        kill_group(p.pid, signal.SIGKILL)
        reader.join(timeout=5)
    out = ''.join(chunks) if chunks else ''
    if timed_out:
        out += '\nTIMED OUT after %ds; the suite and its Chrome were killed\n' % timeout
    return SuiteRun(p.returncode if not timed_out else 124, out, timed_out, leaked, time.time() - t0)


def log_flake(record, path=FLAKE_LOG):
    record = dict(record)
    record.setdefault('time', time.strftime('%Y-%m-%dT%H:%M:%S%z'))
    try:
        with io.open(path, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(record, sort_keys=True) + '\n')
    except Exception:
        pass
    FLAKES.append(record)


def run_suite_with_retry(cmd, suite, passed, cwd=ROOT, timeout=None, chrome=True, say=print, log_path=FLAKE_LOG):
    """Run a suite; if it is a CHROME suite and it fails, wait for a quiet machine and run it
    once more. `passed(SuiteRun) -> bool` is the caller's own judgement of a pass, so the gate
    judges a retry exactly as it judges a first run. Returns (SuiteRun, flake record or None).

    Never for jsc or Worker suites: pass chrome=False and a failure is red first time."""
    first = run_suite(cmd, cwd=cwd, timeout=timeout)
    if passed(first) or not chrome:
        return first, None
    load1 = load_avg()
    say('  %s failed (load %.1f): %s. Retrying once on a quiet machine ...'
        % (suite, load1, (first.fails[:1] or [first.last])[0][:110]))
    load2, waited = wait_quiet(say=say)
    second = run_suite(cmd, cwd=cwd, timeout=timeout)
    rec = {'suite': suite, 'check': (first.fails[:1] or [first.last])[0][:200], 'load_at_fail': round(load1, 2),
           'load_at_retry': round(load2, 2), 'waited_s': round(waited), 'first_seconds': round(first.seconds),
           'retry_seconds': round(second.seconds), 'timed_out': first.timed_out,
           'outcome': 'passed on retry' if passed(second) else 'failed twice',
           'retry_check': (second.fails[:1] or [second.last])[0][:200]}
    log_flake(rec, log_path)
    say('  %s on retry: %s (load %.1f, waited %ds)' % (suite, rec['outcome'], load2, waited))
    return second, rec


def flake_summary_line():
    if not FLAKES:
        return 'FLAKES: none (no Chrome suite needed a retry)'
    soft = [f for f in FLAKES if f['outcome'] == 'passed on retry']
    hard = [f for f in FLAKES if f['outcome'] != 'passed on retry']
    bits = []
    if soft:
        bits.append('%d passed on retry (%s)' % (len(soft), ', '.join('%s: %s' % (f['suite'], f['check'][:60]) for f in soft)))
    if hard:
        bits.append('%d failed twice, RED (%s)' % (len(hard), ', '.join(f['suite'] for f in hard)))
    return 'FLAKES: ' + '; '.join(bits) + '. Logged to tools/flake-log.jsonl'
