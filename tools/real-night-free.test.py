#!/usr/bin/env python3
"""THE FREE REAL NIGHT (tools/real-night-free.py), ITS RECORD (tools/real-night-check.py, automated mode) AND RELEASE.PY'S
STEP 6 THAT RUNS IT (INBOX 365B, 13 Nov 2026). RUN, not read.

    python3 tools/real-night-free.test.py

Everything outside this Mac is a fake: the test server (a runner that writes the results file remote-run.sh would bring
back, with the nonce and the manifest of the tree), the shots it returns, verify-live --all, and the Kogan tool (small
scripts in a temp folder: one writes a PNG, one sleeps past its cap, one fails). The tree is a throwaway git repo holding
copies of the tools the step reads, so the "is the checkout clean, is it the tree that ran" rules run for real.
release.py's real_night is always handed a fake run: this suite never starts a release, a server run, a verify-live or a
Kogan shot, and VP_RN_FAULTS / VP_RN_KILL_FILE / VP_REAL_NIGHT_DIR point into the temp folder.
"""
import importlib.util, io, json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    sys.stdout.flush()
    if not cond:
        bad += 1


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


TMP = tempfile.mkdtemp(prefix='rn-free-')
REC = os.path.join(TMP, 'records')
os.makedirs(REC)
FAULTS = os.path.join(TMP, 'INBOX.md')
KILL = os.path.join(TMP, 'STOP')
os.environ['VP_REAL_NIGHT_DIR'] = REC
GENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}

# ---------------------------------------------------------------- a clean throwaway tree with the tools the step reads
TREE = os.path.join(TMP, 'sites-wt-fixture')
os.makedirs(os.path.join(TREE, 'tools'))
for f in ('gate-server.py', 'passwording.py', 'release-check.py', 'check-suite-ledger.py', 'suite-counts.json',
          'real-night-check.py', 'real-night-free.py', 'release.py'):
    shutil.copy(os.path.join(ROOT, 'tools', f), os.path.join(TREE, 'tools', f))
for c in (['git', 'init', '-q'], ['git', 'config', 'user.email', 't@t'], ['git', 'config', 'user.name', 't'],
          ['git', 'add', '-A'], ['git', 'commit', '-qm', 'fixture']):
    subprocess.run(c, cwd=TREE, capture_output=True, env=GENV)
FR = load('rn_free_under_test', os.path.join(TREE, 'tools', 'real-night-free.py'))
GS = load('gate_server_for_test', os.path.join(TREE, 'tools', 'gate-server.py'))
RN = load('rn_check_for_free_test', os.path.join(TREE, 'tools', 'real-night-check.py'))
REL = load('release_for_free_test', os.path.join(ROOT, 'tools', 'release.py'))
WANT = json.load(io.open(os.path.join(ROOT, 'tools', 'suite-counts.json')))['tools/' + FR.SUITE]['checks']
BUILD = 'c0ffee12' + '0' * 32
ENV = {'VP_RN_FAULTS': FAULTS, 'VP_RN_KILL_FILE': KILL, 'VP_RN_KOGAN_TIMEOUT': '2', 'PATH': os.environ.get('PATH', '')}

# ---------------------------------------------------------------- fakes
PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 400
KDIR = os.path.join(TMP, 'kogan-tools')
os.makedirs(KDIR)
def script(name, body):
    p = os.path.join(KDIR, name)
    io.open(p, 'w').write('#!/bin/bash\n' + body + '\n')
    os.chmod(p, 0o755)
    return p
K_GOOD = script('good.sh', 'printf "\\x89PNG\\r\\n\\x1a\\n" > "$1"; head -c 400 /dev/zero >> "$1"; echo "$1" >> %s/calls' % KDIR)
K_SLOW = script('slow.sh', 'echo slow >> %s/calls; sleep 30' % KDIR)
K_FAIL = script('fail.sh', 'echo fail >> %s/calls; echo "no debug port"; exit 2' % KDIR)
K_NOPNG = script('nopng.sh', 'echo nopng >> %s/calls; echo text > "$1"' % KDIR)


def calls():
    p = os.path.join(KDIR, 'calls')
    n = len(io.open(p).read().splitlines()) if os.path.exists(p) else 0
    if os.path.exists(p):
        os.remove(p)
    return n


def suite_out(n_ok, fails=()):
    lines = ['  ok   check %d' % i for i in range(n_ok)] + ['  FAIL %s   saw: x' % f for f in fails]
    lines.append(('%d FAILED, %d run' % (len(fails), n_ok + len(fails))) if fails else 'ALL %d CHECKS PASSED' % n_ok)
    return '\n'.join(lines) + '\n'


class Server(object):
    """The test server, faked: what remote-run.sh brings back, and the shot folder vp-tests-1 would hold."""
    def __init__(self, n_ok=None, fails=(), rc=None, nonce=None, manifest=None, end_manifest=None, missing=None,
                 night=True, night_ran=None, tree_name=None, no_results=False, sleep=0, shots=True):
        self.n_ok = WANT if n_ok is None else n_ok
        self.fails, self.rc = list(fails), (rc if rc is not None else (1 if fails else 0))
        self.nonce, self.manifest, self.end_manifest, self.missing = nonce, manifest, end_manifest, missing
        self.night, self.night_ran, self.tree_name, self.no_results, self.sleep, self.shots = night, night_ran, tree_name, no_results, sleep, shots
        self.called = 0

    def runner(self, nonce, paths, timeout):
        self.called += 1
        time.sleep(self.sleep)
        if self.no_results:
            return '', 'rsync failed'
        digest = GS.manifest(TREE)[0]   # what the real server measures: the files it was sent
        run = {'nonce': self.nonce or nonce, 'manifest_start': self.manifest or digest,
               'manifest_end': self.end_manifest or self.manifest or digest, 'missing': self.missing or [], 'wall': 60}
        p = os.path.join(TMP, 'results-%d.jsonl' % time.time_ns())
        with io.open(p, 'w') as fh:
            fh.write(json.dumps({'run': run}) + '\n')
            fh.write(json.dumps({'suite': 'tools/' + FR.SUITE, 'rc': self.rc, 'out': suite_out(self.n_ok, self.fails), 'seconds': 400}) + '\n')
        self.t_end = time.time()
        return p, 'results: ' + p

    def fetch(self, dest):
        os.makedirs(dest, exist_ok=True)
        if not self.shots:
            return 'the shots did not come back (rsync 23)'
        for i, (tv, ph) in enumerate(zip(FR.TV_PICK, FR.PHONE_PICK)):
            for f in (tv, ph, '%s-extra' % FR.GAMES[i][0].rstrip('-')):
                io.open(os.path.join(dest, f + '.jpg'), 'wb').write(b'\xff\xd8 fake jpg')
        if self.night:
            json.dump({'tree_name': self.tree_name or os.path.basename(TREE), 'bad': len(self.fails),
                       'ran': self.night_ran if self.night_ran is not None else self.n_ok + len(self.fails),
                       'started': time.time() - 400, 'finished': time.time()}, io.open(os.path.join(dest, 'night.json'), 'w'))
        return ''


def VL(rc=0, venues=27, green_line=True, sleep=0, timeout=False, bad_venue=None):
    def run(t):
        time.sleep(sleep)
        if timeout:
            return 'timeout', 'partial'
        out = ['\x1b[33mThe screen check, run in a real browser\x1b[0m', '']
        out += ['  venue-%d ... \x1b[32mall 23 checks passed\x1b[0m  (65s)' % i for i in range(venues)]
        if bad_venue:
            out.append('  %s ... \x1b[31m2 of 23 FAILED\x1b[0m' % bad_venue)
        if green_line:
            out += ['', '\x1b[32m' + FR.VL_GREEN + '\x1b[0m']
        return rc, '\n'.join(out) + '\n'
    run.calls = 0
    return run


def night(server=None, vl=None, tool=K_GOOD, verify=True, kogan=True, env_extra=None):
    server = server or Server()
    env = dict(ENV, VP_RN_KOGAN_TOOL=tool, **(env_extra or {}))
    t0 = time.time()
    green, reasons, path, look = FR.run_night(BUILD, root=TREE, record_dir=REC, runner=server.runner, fetch=server.fetch,
                                              vl_runner=vl or VL(), env=env, verify=verify, kogan=kogan, say=lambda *a: None)
    text = io.open(path, encoding='utf-8').read() if os.path.isfile(path) else ''
    return green, reasons, path, look, text, time.time() - t0, server


def has(reasons, word):
    return any(word.lower() in r.lower() for r in reasons)


# ================================================================================================ (1) + (2) + (3), green
print('\nThe free night, everything green')
if os.path.exists(FAULTS):
    os.remove(FAULTS)
calls()
g, why, path, look, text, took, srv = night()
ok('dry run green on this tree + verify-live green + 5 Kogan shots: GREEN, no reasons', g is True and why == [], why)
ok('the record is <build8>.md in VP_REAL_NIGHT_DIR and tools/real-night-check.py passes it', path == os.path.join(REC, BUILD[:8] + '.md') and RN.check(BUILD, path)[0], RN.check(BUILD, path)[1])
ok('the record says it is automated, the TV is "Chrome /tv (test server)", and "Kogan app shots: 5 of 5"',
   'Mode: automated' in text and 'TV: Chrome /tv (test server)' in text and 'Kogan app shots: 5 of 5' in text, text[:600])
ok('the record names the tree the server ran and "Dry run: GREEN, %d checks"' % WANT,
   ('Tree: ' + GS.current_tree(TREE)[0]) in text and ('Dry run: GREEN, %d checks' % WANT) in text, text[:900])
ok('"Verify live: GREEN ... 27 venues, read-only"', 'Verify live: GREEN, verify-live.py --all, 27 venues, read-only' in text, text[:900])
ok('every game has a TV shot, a phone shot and a Kogan shot on disk, and PASS', all(
    os.path.isfile(os.path.join(REC, l.split(': ', 1)[1])) for l in text.splitlines() if l.startswith(('TV shot:', 'Phone shot:', 'Kogan shot:')))
   and text.count('Result: PASS by ') == 5 and text.count('TV shot:') == 5 and text.count('Phone shot:') == 5 and text.count('Kogan shot: ') == 5, text)
ok('the Kogan tool was called once per game (5)', calls() == 5)
lk = io.open(look, encoding='utf-8').read() if os.path.isfile(look) else ''
ok('the LOOK page is written beside the record, says GREEN, and shows the shots and the Kogan app (shot, not played)',
   look == os.path.join(REC, BUILD[:8], 'LOOK.html') and '>GREEN<' in lk and 'shots/01-trivia-tv-question.jpg' in lk and 'Kogan app (shot, not played)' in lk, lk[:300])
ok('the dry run and verify-live outputs are kept beside it', os.path.isfile(os.path.join(REC, BUILD[:8], 'dryrun.txt')) and os.path.isfile(os.path.join(REC, BUILD[:8], 'verify-live.txt')))
ok('a green night writes no fault', not os.path.exists(FAULTS))
g, why, _, _, _, took, _ = night(server=Server(sleep=1.5), vl=VL(sleep=1.5))
ok('the dry run and verify-live run at the same time (two 1.5 s fakes take under 2.6 s)', g and took < 2.6, (g, took, why))
calls()

# ================================================================================================ (3) the Kogan is informational
print('\nThe Kogan TV app: informational, never holds the release')
g, why, _, _, text, took, _ = night(tool=K_SLOW)
n = calls()
ok('a TV that never answers: the release is still GREEN', g is True, why)
ok('it waited for ONE capped call, then skipped the rest (1 call, under 10 s)', n == 1 and took < 10, (n, took))
ok('the record says "Kogan app shots: 0 of 5" and why each was skipped', 'Kogan app shots: 0 of 5' in text and text.count('Kogan shot: skipped (the TV did not answer in 2s)') == 5, text)
g, why, _, _, text, _, _ = night(tool=K_FAIL)
ok('a Kogan tool that fails: GREEN, 1 call, the reason written', g is True and calls() == 1 and 'Kogan shot: skipped (the Kogan tool exit 2 - no debug port)' in text, (g, why, text[-600:]))
g, why, _, _, text, _, _ = night(tool=K_NOPNG)
ok('a Kogan tool that writes something that is not a PNG: not counted, GREEN', g is True and calls() == 1 and 'Kogan app shots: 0 of 5' in text, (g, text[:700]))
g, why, _, _, text, _, _ = night(tool=os.path.join(KDIR, 'not-there.sh'))
ok('no Kogan tool on this Mac: GREEN, nothing called, and it says so', g is True and calls() == 0 and 'is not on this Mac' in text, (g, text[-500:]))
ok('kogan_argv: main\'s kogan-shot.sh is called "bash <tool> <out.png>"', FR.kogan_argv('/k/kogan-shot.sh', '/o/a.png') == ['bash', '/k/kogan-shot.sh', '/o/a.png'])
ok('kogan_argv: "{out}" is filled in (python3 tools/kogan-shot.py --out {out})',
   FR.kogan_argv('python3 tools/kogan-shot.py --out {out}', '/o/a.png') == ['python3', 'tools/kogan-shot.py', '--out', '/o/a.png'])
ok('the default Kogan tool is main\'s kogan-shot.sh', FR.tool_of({}).endswith('reports/real-night/kogan/kogan-shot.sh'), FR.tool_of({}))

# ================================================================================================ (1) the dry run's rules
print('\n(1) the dry run on the test server: red unless green on THIS tree')
g, why, _, _, text, _, _ = night(server=Server(fails=['bingo: the TV and the phones agree']))
ok('a FAIL in the dry run: NOT green, the record has Bingo FAIL and real-night-check fails it', not g and has(why, '(1) the dry run') and 'Result: FAIL by' in text and not RN.check(BUILD)[0], why)
ok('a red night writes a fault to the build session INBOX file (VP_RN_FAULTS), nothing sent', os.path.isfile(FAULTS) and 'REAL NIGHT (free) RED on c0ffee12' in io.open(FAULTS).read())
g, why, *_ = night(server=Server(n_ok=WANT - 20))
ok('fewer checks than the ledger (%d of %d): NOT green' % (WANT - 20, WANT), not g and has(why, 'the ledger says'), why)
g, why, *_ = night(server=Server(nonce='0' * 32))
ok('results that answer another request (wrong nonce): NOT green', not g and has(why, 'another request'), why)
g, why, *_ = night(server=Server(manifest='f' * 64))
ok('the server ran other files (manifest differs): NOT green', not g and has(why, 'not this tree'), why)
g, why, *_ = night(server=Server(end_manifest='e' * 64))
ok('the files changed on the server while it ran: NOT green', not g and has(why, 'changed while the suites ran'), why)
g, why, *_ = night(server=Server(missing=['tools/x.py']))
ok('the server is missing a file of this tree: NOT green', not g and has(why, 'missing'), why)
g, why, *_ = night(server=Server(no_results=True))
ok('no results came back: NOT green', not g and has(why, 'sent no results'), why)
io.open(os.path.join(TREE, 'tools', 'dirty.txt'), 'w').write('x')
s = Server()
g, why, *_ = night(server=s)
os.remove(os.path.join(TREE, 'tools', 'dirty.txt'))
ok('a dirty checkout: NOT green, and nothing was sent to the server', not g and has(why, 'dirty') and s.called == 0, (why, s.called))
g, why, _, _, text, _, _ = night(server=Server(night_ran=WANT - 1))
ok('shots whose night.json is another run\'s: not attached, NOT green', not g and has(why, 'shots did not come back') and 'TV shot:' not in text, why)
g, why, *_ = night(server=Server(tree_name='sites-wt-other'))
ok('shots from another tree\'s folder: NOT green', not g and has(why, 'another tree'), why)
g, why, *_ = night(server=Server(night=False))
ok('shots with no night.json: NOT green', not g and has(why, 'no night.json'), why)
g, why, *_ = night(server=Server(shots=False))
ok('no shots came back at all: NOT green', not g and has(why, 'shots did not come back'), why)

# ================================================================================================ (2) verify-live --all
print('\n(2) verify-live --all against live: read-only, must be green')
g, why, *_ = night(vl=VL(rc=1, green_line=False, bad_venue='tugun-bowls'))
ok('verify-live red: NOT green, and the venue is named', not g and has(why, 'verify-live --all is not green') and has(why, 'tugun-bowls'), why)
g, why, *_ = night(vl=VL(timeout=True))
ok('verify-live past its cap: NOT green', not g and has(why, 'did not finish'), why)
g, why, *_ = night(vl=VL(rc=0, green_line=False))
ok('verify-live exit 0 without its green line: NOT green', not g and has(why, 'verify-live --all exit 0'), why)
g, why, *_ = night(vl=VL(venues=0))
ok('verify-live that checked no venue: NOT green', not g and has(why, 'checked no venue'), why)
g, why, _, _, text, _, _ = night(verify=False)
ok('--no-verify-live: NOT green, and the record says SKIPPED', not g and 'Verify live: SKIPPED' in text, (why, text[:900]))
src = io.open(os.path.join(ROOT, 'tools', 'real-night-free.py'), encoding='utf-8').read()
ok('verify-live is run with --all only (never --stamp: read-only, nothing committed)', "[PY, 'tools/verify-live.py', '--all']" in src and "'--stamp'" not in src)

# ================================================================================================ the kill file
print('\nThe kill file')
io.open(KILL, 'w').write('stop')
s = Server()
g, why, *_ = night(server=s)
ok('the kill file is there: stopped before anything runs, NOT green', not g and has(why, 'kill file') and s.called == 0, (why, s.called))
os.remove(KILL)

# ================================================================================================ the record, judged
print('\ntools/real-night-check.py, automated mode')
calls()
g, why, path, _, good_text, _, _ = night()
calls()
def judge(t):
    return RN.check_text(t, BUILD, REC)
def fails(name, t, word):
    w = judge(t)
    ok(name, bool(w) and any(word.lower() in x.lower() for x in w), w)
ok('the good automated record passes', judge(good_text) == [], judge(good_text))
fails('the TV line names the Kogan (pretending it was played)', good_text.replace('TV: Chrome /tv (test server)', 'TV: Chrome /tv (test server) and the Kogan TV app 192.168.68.58'), 'never played the Kogan')
fails('the TV line is not "Chrome /tv (test server)"', good_text.replace('TV: Chrome /tv (test server)', 'TV: Chrome on the Mac'), 'Chrome /tv (test server)')
fails('the Venue line hides that it was the test server', good_text.replace('on the test server rig (vp-tests-1), not the live venue', 'live'), 'test server')
fails('"Kogan app shots: 5 of 5" with no Kogan files', good_text.replace(BUILD[:8] + '/kogan/', BUILD[:8] + '/kogan-gone/'), 'not a PNG')
t = good_text
for i in range(5):
    t = t.replace('Kogan shot: %s/kogan/%s%s.png' % (BUILD[:8], FR.GAMES[i][0], FR.GAMES[i][2]), 'Kogan shot: skipped (dark)')
fails('the count says 5 of 5 but every Kogan shot is skipped', t, 'does not match')
ok('the same record saying "0 of 5" honestly passes (the Kogan is informational)', judge(t.replace('Kogan app shots: 5 of 5', 'Kogan app shots: 0 of 5')) == [], judge(t.replace('Kogan app shots: 5 of 5', 'Kogan app shots: 0 of 5')))
fails('no "Kogan app shots" line', '\n'.join(l for l in good_text.splitlines() if not l.startswith('Kogan app shots:')), 'Kogan app shots')
fails('the dry run is RED', good_text.replace('Dry run: GREEN, %d checks' % WANT, 'Dry run: RED, exit 1'), 'Dry run')
fails('the dry run counted 0 checks', good_text.replace('Dry run: GREEN, %d checks' % WANT, 'Dry run: GREEN, 0 checks'), 'Dry run')
fails('verify-live is not GREEN', good_text.replace('Verify live: GREEN', 'Verify live: RED'), 'Verify live')
fails('no Tree line', '\n'.join(l for l in good_text.splitlines() if not l.startswith('Tree:')), 'Tree')
fails('the LOOK page is not there', good_text.replace('Look: %s/LOOK.html' % BUILD[:8], 'Look: %s/GONE.html' % BUILD[:8]), 'Look page')
fails('a game marked FAIL', good_text.replace('Result: PASS by', 'Result: FAIL by', 1), 'Trivia: FAIL')
fails('a game with no phone shot', '\n'.join(l for l in good_text.splitlines() if not l.startswith('Phone shot: %s/shots/04-' % BUILD[:8])), 'Raffle: no phone shot')
hand = good_text.replace('Mode: automated, tools/real-night-free.py (no Dean step, no SMS)\n', '')
fails('without "Mode: automated" the hand rules apply: the Chrome /tv is not the Kogan app', hand, 'Kogan TV app')

# ================================================================================================ release.py step 6
print('\nrelease.py step 6, free mode (always a fake run here)')
class Run(object):
    def __init__(self, rc):
        self.rc, self.argv = rc, None
    def __call__(self, argv, **kw):
        self.argv = argv
        return subprocess.CompletedProcess(argv, self.rc)
r = Run(0)
on, good, lines = REL.real_night(BUILD, env={}, run=r)
ok('OFF by default: nothing runs', on is False and good is True and r.argv is None, (on, good, r.argv))
r = Run(0)
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_DIR': REC}, run=r)
ok('ON: it runs tools/real-night-free.py --build <sha>', r.argv is not None and r.argv[1:] == ['tools/real-night-free.py', '--build', BUILD], r.argv)
ok('ON, the run green and the record good: DONE', on is True and good is True, (on, good, lines))
r = Run(1)
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_DIR': REC}, run=r)
ok('ON, the run red: NOT done, and it says nothing was rolled back', on is True and good is False and 'nothing rolled back' in ' '.join(lines), lines)
io.open(path, 'w', encoding='utf-8').write(good_text.replace('Verify live: GREEN', 'Verify live: RED'))
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_DIR': REC}, run=Run(0))
ok('ON, the run says 0 but the record is red: still NOT done (the record is judged too)', on is True and good is False, lines)
io.open(path, 'w', encoding='utf-8').write(good_text)
r = Run(0)
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_MODE': 'hand', 'VP_REAL_NIGHT_DIR': REC}, run=r)
ok('VP_REAL_NIGHT_MODE=hand: the free night does not run, the hand-played record is asked for', r.argv is None and on is True, (r.argv, lines))
on, good, lines = REL.real_night(BUILD, env={'VP_REAL_NIGHT': '1', 'VP_REAL_NIGHT_DIR': REC})
ok('ON with no runner handed in (anything but release.py main): nothing is started and it is NOT done', on is True and good is False and 'without a runner' in ' '.join(lines), lines)
ok('release.py main hands step 6 the real runner', 'real_night(head, run=subprocess.run)' in io.open(os.path.join(ROOT, 'tools', 'release.py'), encoding='utf-8').read())
pl = REL.real_night_plan(BUILD, env={})
ok('--plan, OFF: says it would not ask', pl == ['not ask for a real night (VP_REAL_NIGHT is not 1)'], pl)
pl = ' '.join(REL.real_night_plan(BUILD, env={'VP_REAL_NIGHT': '1'}))
ok('--plan, ON: names the dry run on vp-tests-1, verify-live --all and the Kogan shots', 'real-night-free.py' in pl and 'vp-tests-1' in pl and 'verify-live.py --all' in pl and 'Kogan' in pl, pl)
rsrc = io.open(os.path.join(ROOT, 'tools', 'release.py'), encoding='utf-8').read()
i6, iL = rsrc.find('step(6, '), rsrc.find("LIVE and checked: %s")
ok('step 6 never deploys, pushes or rolls back (no deploy-worker, push or --emergency between step 6 and the end)',
   0 < i6 < iL and not any(w in rsrc[i6:iL] for w in ('deploy-worker', 'push_exactly', '--emergency', 'git', 'revert')), rsrc[i6:iL][:300])
r = subprocess.run([sys.executable, os.path.join(TREE, 'tools', 'real-night-free.py'), '--build', BUILD, '--plan'], cwd=TREE, capture_output=True, text=True,
                   env=dict(os.environ, VP_RN_KOGAN_TOOL=K_GOOD))
ok('real-night-free.py --plan says what it would run and runs nothing', r.returncode == 0 and 'would run (1)' in r.stdout and 'would run (2)' in r.stdout and calls() == 0, (r.returncode, r.stdout[-400:], r.stderr[-300:]))

shutil.rmtree(TMP, ignore_errors=True)
print('\n' + ('%d FAILED, %d run' % (bad, ran) if bad else 'ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
