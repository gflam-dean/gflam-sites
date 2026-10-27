#!/usr/bin/env python3
"""THE PRE-PUSH GATE RECORD AND release.py STEP 5, RUN. GATELIB_NO_CHROME.

    python3 tools/gate-record.test.py

A throwaway git repo is built in a temp folder with a copy of tools/gate-record.py, the REAL
tools/hooks/pre-push, and fake stamp-workers.py and release-check.py that exit as told. The hook is
run for real (green and red), the record is read back, and release.py's own step-5 code (gate_after,
loaded from the real file) is called with a fake runner that records the command it was given.

What it runs:
  1. the record     --write writes tree, commit and time; refuses over a dirty tree; --clear removes it
  2. the decision   no record, another tree, too old, dirty, unreadable, future-dated: full gate, each
                    with its own reason; same tree under two hours: skip Chrome, reason names the
                    tree, the age and --skip-chrome; a commit-message amend keeps the same tree
  3. the hook       a green gate writes the record for the pushed tree; a red gate writes none and
                    removes an older one
  4. release.py     step 5 runs release-check.py --skip-chrome only on a fresh matching record, the
                    full gate otherwise, prints the reason first, and returns the gate's own exit
  5. git            tools/gate-record.json is ignored, so the hook's own dirty-tree check and release.py
                    step 0 cannot be tripped by the record they just wrote
"""
import os as _os, sys as _sys
if _os.environ.get('VP_GATE_RECORD_TEST_UNSAFE') != '1':
    # DISABLED 27 Oct 2026 16:10 by the main session: a run of this suite inside the post-push gate pushed its
    # throwaway commits "one", "two", "three" to origin/main and took venueplay.com.au down (every path served
    # <html>three</html>). It must never touch a repository that has a remote. Re-enable only after it is
    # rebuilt to run against a bare local remote and proven unable to reach GitHub.
    print('DISABLED: gate-record.test.py is quarantined (see comment); 0 of 45 checks ran')
    _sys.exit(0)
import contextlib, importlib.util, io, json, os, re, shutil, stat, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = [path]
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = saved
    return mod


def git(repo, *args):
    return subprocess.run(['git'] + list(args), cwd=repo, capture_output=True, text=True,
                          env=dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t'))


def put(path, text, exe=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    if exe:
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)


TMP = tempfile.mkdtemp(prefix='gate-record-')
repo = os.path.join(TMP, 'repo')
os.makedirs(repo)
try:
    git(repo, 'init', '-q')
    git(repo, 'config', 'commit.gpgsign', 'false')
    shutil.copy(os.path.join(TOOLS, 'gate-record.py'), os.path.join(repo, 'tools', 'gate-record.py')) if os.path.isdir(os.path.join(repo, 'tools')) else (os.makedirs(os.path.join(repo, 'tools')), shutil.copy(os.path.join(TOOLS, 'gate-record.py'), os.path.join(repo, 'tools', 'gate-record.py')))
    put(os.path.join(repo, 'tools', 'stamp-workers.py'), 'import sys; sys.exit(0)\n')
    # The fake gate: green unless a file called RED sits beside it. It is what the hook runs.
    put(os.path.join(repo, 'tools', 'release-check.py'),
        'import os, sys\nprint("fake gate", "RED" if os.path.exists(os.path.join(os.path.dirname(__file__), "RED")) else "green")\n'
        'sys.exit(1 if os.path.exists(os.path.join(os.path.dirname(__file__), "RED")) else 0)\n')
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>one</html>\n')
    put(os.path.join(repo, '.gitignore'), 'tools/gate-record.json\ntools/gate-record.json.tmp\ntools/RED\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'one')
    gr = load('gate_record_copy', os.path.join(repo, 'tools', 'gate-record.py'))
    ok('the copy under test is the real tools/gate-record.py, byte for byte',
       io.open(os.path.join(repo, 'tools', 'gate-record.py'), 'rb').read() == io.open(os.path.join(TOOLS, 'gate-record.py'), 'rb').read())
    ok('the module\'s ROOT is the repo it sits in', gr.ROOT == repo, gr.ROOT)
    tree1 = git(repo, 'rev-parse', 'HEAD^{tree}').stdout.strip()
    head1 = git(repo, 'rev-parse', 'HEAD').stdout.strip()
    rec_path = os.path.join(repo, 'tools', 'gate-record.json')

    print('1. the record')
    good, text = gr.write_record(repo, now=1000000.0)
    rec = json.load(io.open(rec_path))
    ok('--write writes the tree, the commit and the time', good and rec['tree'] == tree1 and rec['head'] == head1 and rec['time'] == 1000000.0, text)
    ok('the record is the tree hash, not the commit', rec['tree'] != rec['head'] and len(rec['tree']) == 40)
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>dirty</html>\n')
    good, text = gr.write_record(repo, now=1000000.0)
    ok('--write refuses over a dirty gated folder and says so', not good and 'dirty' in text and 'venueplay/index.html' in text, text.splitlines()[0])
    git(repo, 'checkout', '-q', '--', 'venueplay/index.html')
    ok('--clear removes the record', gr.clear_record(repo) and not os.path.exists(rec_path))
    ok('--clear with no record says none', gr.clear_record(repo) is False)

    print('\n2. the decision')
    skip, why = gr.decide(repo, now=1000600.0)
    ok('no record: full gate, says there is no record', skip is False and 'full gate' in why and 'no record' in why, why)
    gr.write_record(repo, now=1000000.0)
    skip, why = gr.decide(repo, now=1000600.0)
    ok('same tree, 10 minutes old: skip Chrome', skip is True, why)
    ok('... the reason names the tree, the age, the limit and --skip-chrome',
       tree1[:12] in why and '10 minute' in why and '2 hour' in why and '--skip-chrome' in why and 'live half' in why, why)
    skip, why = gr.decide(repo, now=1000000.0 + 2 * 3600 - 1)
    ok('1 h 59 min 59 s old: still skip', skip is True)
    skip, why = gr.decide(repo, now=1000000.0 + 2 * 3600)
    ok('exactly 2 hours old: full gate, says over the limit', skip is False and 'over the 2 hour limit' in why and '120 minutes' in why, why)
    skip, why = gr.decide(repo, now=1000000.0 + 3 * 3600)
    ok('3 hours old: full gate', skip is False and 'over the 2 hour limit' in why)
    skip, why = gr.decide(repo, now=999000.0)
    ok('a record dated in the future: full gate, says the clock cannot be trusted', skip is False and 'future' in why, why)
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>dirty</html>\n')
    skip, why = gr.decide(repo, now=1000600.0)
    ok('a dirty gated folder: full gate even with a fresh matching record', skip is False and 'dirty' in why, why)
    git(repo, 'checkout', '-q', '--', 'venueplay/index.html')
    put(os.path.join(repo, 'README.txt'), 'not a gated folder\n')
    skip, why = gr.decide(repo, now=1000600.0)
    ok('an untracked file OUTSIDE the gated folders does not count as dirty', skip is True, why)
    os.remove(os.path.join(repo, 'README.txt'))
    git(repo, 'commit', '-q', '--amend', '-m', 'one, reworded')
    head1b = git(repo, 'rev-parse', 'HEAD').stdout.strip()
    skip, why = gr.decide(repo, now=1000600.0)
    ok('a commit-message amend (new sha, same files) still matches: the record is the TREE', head1b != head1 and skip is True, why)
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>two</html>\n')
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'two')
    tree2 = git(repo, 'rev-parse', 'HEAD^{tree}').stdout.strip()
    skip, why = gr.decide(repo, now=1000600.0)
    ok('another tree: full gate, names both trees', skip is False and tree1[:12] in why and tree2[:12] in why and 'have not judged' in why, why)
    put(rec_path, '{not json')
    skip, why = gr.decide(repo, now=1000600.0)
    ok('an unreadable record: full gate, says unreadable', skip is False and 'unreadable' in why, why)
    put(rec_path, json.dumps({'tree': tree2, 'time': 'yesterday'}))
    skip, why = gr.decide(repo, now=1000600.0)
    ok('a record with a time that is not a number: full gate', skip is False and 'unreadable' in why)
    os.remove(rec_path)
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'gate-record.py'), '--decide'], capture_output=True, text=True, cwd=repo)
    ok('the CLI: --decide exits 1 and prints the reason when the full gate is due', r.returncode == 1 and 'full gate' in r.stdout, r.stdout.strip())
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'gate-record.py'), '--write'], capture_output=True, text=True, cwd=repo)
    ok('the CLI: --write exits 0 and names the tree', r.returncode == 0 and tree2[:12] in r.stdout, r.stdout.strip())
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'gate-record.py'), '--decide'], capture_output=True, text=True, cwd=repo)
    ok('the CLI: --decide exits 0 on a fresh matching record', r.returncode == 0 and 'Chrome suites skipped' in r.stdout, r.stdout.strip())
    os.remove(rec_path)

    print('\n3. the real pre-push hook writes the record on green and removes it on red')
    hook = os.path.join(repo, 'hook')
    shutil.copy(os.path.join(TOOLS, 'hooks', 'pre-push'), hook)
    r = subprocess.run(['bash', hook], cwd=repo, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    rec = json.load(io.open(rec_path)) if os.path.isfile(rec_path) else None
    ok('green gate: the hook exits 0 and the record names the pushed tree', r.returncode == 0 and rec and rec['tree'] == tree2 and rec['by'] == 'pre-push', (r.returncode, r.stdout[-200:]))
    ok('... and the hook said so', 'gate record: recorded: tree ' + tree2[:12] in r.stdout)
    ok('... written under two seconds ago', rec and abs(time.time() - rec['time']) < 120)
    put(os.path.join(repo, 'tools', 'RED'), '')
    r = subprocess.run(['bash', hook], cwd=repo, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    ok('red gate: the hook refuses the push', r.returncode == 1 and 'PUSH REFUSED' in r.stdout)
    ok('... and the record from the green run is GONE, so a failed tree cannot ride it', not os.path.exists(rec_path) and 'gate record: removed' in r.stdout)
    os.remove(os.path.join(repo, 'tools', 'RED'))
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>dirty</html>\n')
    r = subprocess.run(['bash', hook], cwd=repo, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    ok('dirty tree: the hook refuses before the gate and writes no record', r.returncode == 1 and 'differ from the commit' in r.stdout and not os.path.exists(rec_path))
    git(repo, 'checkout', '-q', '--', 'venueplay/index.html')
    hook_src = io.open(os.path.join(TOOLS, 'hooks', 'pre-push'), encoding='utf-8').read()
    ok('the hook tolerates a branch without gate-record.py (older checkouts share the installed hook)',
       hook_src.count('[ -f "$ROOT/tools/gate-record.py" ] &&') == 2)

    print('\n4. release.py step 5 runs the Chrome suites only when the hook has not already, and says why')
    rel = load('release_py', os.path.join(TOOLS, 'release.py'))
    ran = []

    class Done(object):
        def __init__(self, rc):
            self.returncode = rc

    def fake_run(argv, cwd=None, env=None, **kw):
        ran.append((list(argv), cwd, dict(env if env is not None else os.environ)))
        return Done(int(os.environ.get('FAKE_GATE_RC', '0')))

    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        r = rel.gate_after(repo, run=fake_run)
    ok('no record: the FULL gate, release-check.py with no --skip-chrome', ran[-1][0][1:] == ['tools/release-check.py'] and ran[-1][1] == repo, ran[-1])
    ok('... and the reason is printed before it runs', 'full gate: no record' in out.getvalue() and out.getvalue().index('full gate') < out.getvalue().index('running:'), out.getvalue())
    gr.write_record(repo)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        r = rel.gate_after(repo, run=fake_run)
    ok('fresh matching record: release-check.py --skip-chrome (the live half still runs: no --local)',
       ran[-1][0][1:] == ['tools/release-check.py', '--skip-chrome'], ran[-1])
    ok('... and the printed reason says exactly why', 'Chrome suites skipped: the pre-push gate ran all of them green on this same tree' in out.getvalue(), out.getvalue())
    ok('... and the gate\'s green exit comes back', r.returncode == 0)
    ok('... and the gate is told the reason (VP_CHROME_GATED), so its summary does not call itself "NOT a release gate"',
       'Chrome suites skipped' in (ran[-1][2].get('VP_CHROME_GATED') or ''), sorted(k for k in ran[-1][2] if k.startswith('VP_')))
    ok('... which the full-gate path does not set', 'VP_CHROME_GATED' not in ran[-2][2])
    os.environ['FAKE_GATE_RC'] = '1'
    with contextlib.redirect_stdout(io.StringIO()):
        r = rel.gate_after(repo, run=fake_run)
    ok('a red gate on the skip path still comes back red (release.py stops on it)', r.returncode == 1)
    del os.environ['FAKE_GATE_RC']
    rec = json.load(io.open(rec_path)); rec['time'] -= 3 * 3600; put(rec_path, json.dumps(rec))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rel.gate_after(repo, run=fake_run)
    ok('a 3 hour old record: the full gate again', ran[-1][0][1:] == ['tools/release-check.py'] and 'over the 2 hour limit' in out.getvalue())
    gr.write_record(repo)
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>three</html>\n')
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'three')
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rel.gate_after(repo, run=fake_run)
    ok('a record for the previous tree: the full gate', ran[-1][0][1:] == ['tools/release-check.py'] and 'have not judged these files' in out.getvalue())
    rel_src = io.open(os.path.join(TOOLS, 'release.py'), encoding='utf-8').read()
    i5 = rel_src.index("step(5, 'the full gate, after')")
    ok('release.py step 5 is gate_after and stops on its exit', 'gate_after(ROOT)' in rel_src[i5:i5 + 300] and 'stop(' in rel_src[i5:i5 + 500])
    ok('step 4 (the live-screen stamp) still runs before step 5', rel_src.index("step(4, 'a real browser looks at the screens") < i5 and "'tools/verify-live.py', '--stamp'" in rel_src)

    print('\n5. git ignores the record (the repo\'s own .gitignore, asked in the throwaway repo: prove-checks copies this repo without .git)')
    shutil.copy(os.path.join(ROOT, '.gitignore'), os.path.join(repo, '.gitignore'))
    r = subprocess.run(['git', 'check-ignore', '-q', 'tools/gate-record.json'], cwd=repo)
    ok('tools/gate-record.json is ignored by the repo\'s .gitignore', r.returncode == 0)
    r = subprocess.run(['git', 'check-ignore', '-q', 'tools/gate-record.json.tmp'], cwd=repo)
    ok('... and its .tmp', r.returncode == 0)
    r = subprocess.run(['git', 'check-ignore', '-q', 'tools/gate-record.py'], cwd=repo)
    ok('... and the TOOL itself is not', r.returncode == 1)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
