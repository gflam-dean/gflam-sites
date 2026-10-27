#!/usr/bin/env python3
"""THE PRE-PUSH GATE RECORD AND release.py STEP 5, RUN. GATELIB_NO_CHROME.

    python3 tools/gate-record.test.py

A throwaway git repo is built in a temp folder with a copy of tools/gate-record.py, the REAL
tools/hooks/pre-push, and fake stamp-workers.py and release-check.py that exit as told. The hook is
run for real (green and red), the record is read back, and release.py's own step-5 code (gate_after,
loaded from the real file) is called with a fake runner that records the command it was given.

REBUILT 27 Oct 2026 after this suite took venueplay.com.au down. The first version ran its git with
the environment it was given. The pre-push hook ran the gate, the gate ran this suite, and git push
had exported GIT_DIR to the hook: the "throwaway" git init re-initialised the REAL checkout's gitdir,
"one, reworded", "two" and "three" (a tree of five files) were committed on the real branch, the push
delivered "three" to GitHub, and every path on the site served <html>three</html> for 29 minutes.
So now, and checked on every run:
  - every git this suite runs gets a CLEAN environment: nothing git exports to a hook survives
  - the throwaway's gitdir is proven to be inside the temp folder before anything is committed
  - its only remote is a bare repo in the same temp folder (git init --bare); its URL is checked
    to be that path and never to contain github; its one push is proven to land there
  - the real repository's HEAD, working tree and config are read before and after, and must match
  - the hook is run the way git runs it, with GIT_DIR exported, and the gate it runs must not see it

What it runs:
  0. the fence      the clean environment, the temp gitdir, the bare temp remote, the real repo untouched
  1. the record     --write writes tree, commit and time; refuses over a dirty tree; --clear removes it
  2. the decision   no record, another tree, too old, dirty, unreadable, future-dated: full gate, each
                    with its own reason; same tree under two hours: skip Chrome, reason names the
                    tree, the age and --skip-chrome; a commit-message amend keeps the same tree
  3. the hook       a green gate writes the record for the pushed tree; a red gate writes none and
                    removes an older one; the gate the hook runs does not inherit GIT_DIR
  4. release.py     step 5 runs release-check.py --skip-chrome only on a fresh matching record, the
                    full gate otherwise, prints the reason first, and returns the gate's own exit
  5. git            tools/gate-record.json is ignored, so the hook's own dirty-tree check and release.py
                    step 0 cannot be tripped by the record they just wrote
  6. the fence      the push landed in the bare temp remote and the real repository has not moved
"""
import contextlib, importlib.util, io, json, os, re, shutil, stat, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
PASS, FAIL = [0], [0]

# THE CLEAN ENVIRONMENT. git exports GIT_DIR (and GIT_WORK_TREE, GIT_INDEX_FILE, GIT_PREFIX when it has
# them) to every hook it runs, and a hook's children inherit them. Any of them makes "git init" in a
# temp folder a re-init of the real gitdir. So every git this suite runs starts from os.environ with
# every GIT_* removed, and only the identity it needs added back.
LEAK = ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_CONFIG_PARAMETERS')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
ENV.update(GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')


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


def git(repo, *args, **kw):
    env = dict(ENV, **kw.pop('env', {}))
    return subprocess.run(['git'] + list(args), cwd=repo, capture_output=True, text=True, env=env, **kw)


def out(repo, *args):
    return git(repo, *args).stdout.strip()


def put(path, text, exe=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    if exe:
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)


def real_state():
    """What the REAL repository looks like: HEAD, its working tree, and its core.bare. Read with the
    clean environment from ROOT, so this is the checkout the suite sits in whatever the parent exported."""
    return (out(ROOT, 'rev-parse', 'HEAD'), out(ROOT, 'status', '--porcelain'), out(ROOT, 'config', '--get', 'core.bare'),
            out(ROOT, 'rev-parse', '--absolute-git-dir'))


TMP = os.path.realpath(tempfile.mkdtemp(prefix='gate-record-'))
repo = os.path.join(TMP, 'repo')
bare = os.path.join(TMP, 'origin.git')
os.makedirs(repo)
try:
    print('0. the fence: a clean environment, a temp gitdir, a bare temp remote, the real repo read before')
    before = real_state()
    ok('this suite was started with no GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE, or has dropped them',
       not any(k in ENV for k in LEAK), 'inherited: ' + ', '.join(k for k in LEAK if k in os.environ))
    # BEFORE git init: an empty temp folder must not answer to "which repository is this". With a GIT_DIR
    # from the parent it answers with the real gitdir, and the init that follows would re-initialise it.
    r = git(repo, 'rev-parse', '--absolute-git-dir')
    ok('before git init, the empty temp folder is inside no repository at all', r.returncode != 0, r.stdout.strip())
    if r.returncode == 0:
        raise SystemExit('REFUSING TO GO ON: git init here would re-initialise %s' % r.stdout.strip())
    git(repo, 'init', '-q')
    gitdir = os.path.realpath(out(repo, 'rev-parse', '--absolute-git-dir'))
    ok('the throwaway\'s gitdir is inside the temp folder, not the real repository\'s',
       gitdir.startswith(TMP + os.sep) and gitdir != os.path.realpath(before[3]), gitdir)
    if not gitdir.startswith(TMP + os.sep):
        raise SystemExit('REFUSING TO GO ON: the throwaway would be the real repository (%s)' % gitdir)
    git(repo, 'config', 'commit.gpgsign', 'false')
    git(TMP, 'init', '-q', '--bare', bare)
    git(repo, 'remote', 'add', 'origin', bare)
    url = out(repo, 'remote', 'get-url', 'origin')
    ok('its only remote is "origin", a bare repository in the same temp folder (git init --bare)',
       out(repo, 'remote').split() == ['origin'] and os.path.realpath(url) == bare and os.path.isdir(os.path.join(bare, 'objects')), url)
    ok('git remote get-url origin does not contain github', 'github' not in url.lower(), url)
    ok('the real repository\'s core.bare did not change when the throwaway was made', out(ROOT, 'config', '--get', 'core.bare') == before[2])

    os.makedirs(os.path.join(repo, 'tools'))
    shutil.copy(os.path.join(TOOLS, 'gate-record.py'), os.path.join(repo, 'tools', 'gate-record.py'))
    put(os.path.join(repo, 'tools', 'stamp-workers.py'), 'import sys; sys.exit(0)\n')
    # The fake gate: green unless a file called RED sits beside it. It is what the hook runs. It also
    # writes down the GIT_DIR it was given, because the hook must have dropped it (section 3).
    put(os.path.join(repo, 'tools', 'release-check.py'),
        'import os, sys\nhere = os.path.dirname(os.path.abspath(__file__))\n'
        'open(os.path.join(here, "SEEN_GIT_DIR"), "w").write(os.environ.get("GIT_DIR", ""))\n'
        'print("fake gate", "RED" if os.path.exists(os.path.join(here, "RED")) else "green")\n'
        'sys.exit(1 if os.path.exists(os.path.join(here, "RED")) else 0)\n')
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>one</html>\n')
    put(os.path.join(repo, '.gitignore'), 'tools/gate-record.json\ntools/gate-record.json.tmp\ntools/RED\ntools/SEEN_GIT_DIR\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'one')
    ok('the first commit is on the throwaway, and the real HEAD has not moved',
       out(repo, 'rev-parse', 'HEAD') != before[0] and out(ROOT, 'rev-parse', 'HEAD') == before[0])
    gr = load('gate_record_copy', os.path.join(repo, 'tools', 'gate-record.py'))
    ok('the copy under test is the real tools/gate-record.py, byte for byte',
       io.open(os.path.join(repo, 'tools', 'gate-record.py'), 'rb').read() == io.open(os.path.join(TOOLS, 'gate-record.py'), 'rb').read())
    ok('the module\'s ROOT is the repo it sits in', gr.ROOT == repo, gr.ROOT)
    tree1 = out(repo, 'rev-parse', 'HEAD^{tree}')
    head1 = out(repo, 'rev-parse', 'HEAD')
    rec_path = os.path.join(repo, 'tools', 'gate-record.json')

    # gate-record.py runs git itself, with ITS environment: the suite's clean one, handed to it below.
    saved_environ = dict(os.environ)
    for k in LEAK:
        os.environ.pop(k, None)

    print('\n1. the record')
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
    head1b = out(repo, 'rev-parse', 'HEAD')
    skip, why = gr.decide(repo, now=1000600.0)
    ok('a commit-message amend (new sha, same files) still matches: the record is the TREE', head1b != head1 and skip is True, why)
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>two</html>\n')
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'two')
    tree2 = out(repo, 'rev-parse', 'HEAD^{tree}')
    skip, why = gr.decide(repo, now=1000600.0)
    ok('another tree: full gate, names both trees', skip is False and tree1[:12] in why and tree2[:12] in why and 'have not judged' in why, why)
    put(rec_path, '{not json')
    skip, why = gr.decide(repo, now=1000600.0)
    ok('an unreadable record: full gate, says unreadable', skip is False and 'unreadable' in why, why)
    put(rec_path, json.dumps({'tree': tree2, 'time': 'yesterday'}))
    skip, why = gr.decide(repo, now=1000600.0)
    ok('a record with a time that is not a number: full gate', skip is False and 'unreadable' in why)
    os.remove(rec_path)
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'gate-record.py'), '--decide'], capture_output=True, text=True, cwd=repo, env=ENV)
    ok('the CLI: --decide exits 1 and prints the reason when the full gate is due', r.returncode == 1 and 'full gate' in r.stdout, r.stdout.strip())
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'gate-record.py'), '--write'], capture_output=True, text=True, cwd=repo, env=ENV)
    ok('the CLI: --write exits 0 and names the tree', r.returncode == 0 and tree2[:12] in r.stdout, r.stdout.strip())
    r = subprocess.run([sys.executable, os.path.join(repo, 'tools', 'gate-record.py'), '--decide'], capture_output=True, text=True, cwd=repo, env=ENV)
    ok('the CLI: --decide exits 0 on a fresh matching record', r.returncode == 0 and 'Chrome suites skipped' in r.stdout, r.stdout.strip())
    os.remove(rec_path)

    print('\n3. the real pre-push hook writes the record on green and removes it on red')
    hook = os.path.join(repo, 'hook')
    shutil.copy(os.path.join(TOOLS, 'hooks', 'pre-push'), hook)
    # Run it the way git runs it: cwd at the top of the checkout, GIT_DIR exported. The checkout is the
    # throwaway, so the exported GIT_DIR is the throwaway's own; what matters is whether the gate the hook
    # runs still sees it (it must not: that is how the real gitdir was reached on 27 Oct 2026).
    hook_env = dict(ENV, GIT_DIR=os.path.join(repo, '.git'), GIT_PREFIX='')
    seen = os.path.join(repo, 'tools', 'SEEN_GIT_DIR')
    r = subprocess.run(['bash', hook], cwd=repo, capture_output=True, text=True, stdin=subprocess.DEVNULL, env=hook_env)
    rec = json.load(io.open(rec_path)) if os.path.isfile(rec_path) else None
    ok('green gate: the hook exits 0 and the record names the pushed tree', r.returncode == 0 and rec and rec['tree'] == tree2 and rec['by'] == 'pre-push', (r.returncode, r.stdout[-200:]))
    ok('... and the hook said so', 'gate record: recorded: tree ' + tree2[:12] in r.stdout)
    ok('... written under two seconds ago', rec and abs(time.time() - rec['time']) < 120)
    ok('... and the gate the hook ran did NOT inherit the GIT_DIR git exported to the hook',
       os.path.isfile(seen) and io.open(seen).read() == '', (io.open(seen).read() if os.path.isfile(seen) else 'the fake gate did not run'))
    put(os.path.join(repo, 'tools', 'RED'), '')
    r = subprocess.run(['bash', hook], cwd=repo, capture_output=True, text=True, stdin=subprocess.DEVNULL, env=hook_env)
    ok('red gate: the hook refuses the push', r.returncode == 1 and 'PUSH REFUSED' in r.stdout)
    ok('... and the record from the green run is GONE, so a failed tree cannot ride it', not os.path.exists(rec_path) and 'gate record: removed' in r.stdout)
    os.remove(os.path.join(repo, 'tools', 'RED'))
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>dirty</html>\n')
    r = subprocess.run(['bash', hook], cwd=repo, capture_output=True, text=True, stdin=subprocess.DEVNULL, env=hook_env)
    ok('dirty tree: the hook refuses before the gate and writes no record', r.returncode == 1 and 'differ from the commit' in r.stdout and not os.path.exists(rec_path))
    git(repo, 'checkout', '-q', '--', 'venueplay/index.html')
    hook_src = io.open(os.path.join(TOOLS, 'hooks', 'pre-push'), encoding='utf-8').read()
    ok('the hook tolerates a branch without gate-record.py (older checkouts share the installed hook)',
       hook_src.count('[ -f "$ROOT/tools/gate-record.py" ] &&') == 2)
    ok('the hook drops GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE right after it has found ROOT',
       re.search(r'^unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE', hook_src, re.M) is not None
       and hook_src.index('unset GIT_DIR') < hook_src.index('release-check.py'))

    print('\n4. release.py step 5 runs the Chrome suites only when the hook has not already, and says why')
    rel = load('release_py', os.path.join(TOOLS, 'release.py'))
    ran = []

    class Done(object):
        def __init__(self, rc):
            self.returncode = rc

    def fake_run(argv, cwd=None, env=None, **kw):
        ran.append((list(argv), cwd, dict(env if env is not None else os.environ)))
        return Done(int(os.environ.get('FAKE_GATE_RC', '0')))

    o = io.StringIO()
    with contextlib.redirect_stdout(o):
        r = rel.gate_after(repo, run=fake_run)
    ok('no record: the FULL gate, release-check.py with no --skip-chrome', ran[-1][0][1:] == ['tools/release-check.py'] and ran[-1][1] == repo, ran[-1])
    ok('... and the reason is printed before it runs', 'full gate: no record' in o.getvalue() and o.getvalue().index('full gate') < o.getvalue().index('running:'), o.getvalue())
    gr.write_record(repo)
    o = io.StringIO()
    with contextlib.redirect_stdout(o):
        r = rel.gate_after(repo, run=fake_run)
    ok('fresh matching record: release-check.py --skip-chrome (the live half still runs: no --local)',
       ran[-1][0][1:] == ['tools/release-check.py', '--skip-chrome'], ran[-1])
    ok('... and the printed reason says exactly why', 'Chrome suites skipped: the pre-push gate ran all of them green on this same tree' in o.getvalue(), o.getvalue())
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
    o = io.StringIO()
    with contextlib.redirect_stdout(o):
        rel.gate_after(repo, run=fake_run)
    ok('a 3 hour old record: the full gate again', ran[-1][0][1:] == ['tools/release-check.py'] and 'over the 2 hour limit' in o.getvalue())
    gr.write_record(repo)
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>three</html>\n')
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'three')
    o = io.StringIO()
    with contextlib.redirect_stdout(o):
        rel.gate_after(repo, run=fake_run)
    ok('a record for the previous tree: the full gate', ran[-1][0][1:] == ['tools/release-check.py'] and 'have not judged these files' in o.getvalue())
    rel_src = io.open(os.path.join(TOOLS, 'release.py'), encoding='utf-8').read()
    i5 = rel_src.index("step(5, 'the full gate, after')")
    ok('release.py step 5 is gate_after and stops on its exit', 'gate_after(ROOT)' in rel_src[i5:i5 + 300] and 'stop(' in rel_src[i5:i5 + 500])
    ok('step 4 (the live-screen stamp) still runs before step 5', rel_src.index("step(4, 'a real browser looks at the screens") < i5 and "'tools/verify-live.py', '--stamp'" in rel_src)

    print('\n5. git ignores the record (the repo\'s own .gitignore, asked in the throwaway repo: prove-checks copies this repo without .git)')
    shutil.copy(os.path.join(ROOT, '.gitignore'), os.path.join(repo, '.gitignore'))
    r = git(repo, 'check-ignore', '-q', 'tools/gate-record.json')
    ok('tools/gate-record.json is ignored by the repo\'s .gitignore', r.returncode == 0)
    r = git(repo, 'check-ignore', '-q', 'tools/gate-record.json.tmp')
    ok('... and its .tmp', r.returncode == 0)
    r = git(repo, 'check-ignore', '-q', 'tools/gate-record.py')
    ok('... and the TOOL itself is not', r.returncode == 1)

    print('\n6. the fence, after: the throwaway\'s push lands in the bare temp remote, and the real repository has not moved')
    os.environ.clear(); os.environ.update(saved_environ)
    head3 = out(repo, 'rev-parse', 'HEAD')
    r = git(repo, 'push', '-q', 'origin', 'HEAD:main')
    ok('the throwaway pushes "three" to origin, and origin is the bare repo in the temp folder',
       r.returncode == 0 and out(bare, 'rev-parse', 'main') == head3 and out(repo, 'remote', 'get-url', 'origin') == url, (r.returncode, r.stderr.strip()[-160:]))
    ok('git remote get-url origin still does not contain github', 'github' not in out(repo, 'remote', 'get-url', 'origin').lower())
    after = real_state()
    ok('the real repository\'s HEAD is where it was before this suite ran', after[0] == before[0], '%s -> %s' % (before[0][:8], after[0][:8]))
    ok('... and its working tree reads the same (git status --porcelain)', after[1] == before[1])
    ok('... and its core.bare and gitdir are unchanged', after[2] == before[2] and after[3] == before[3])
    ok('... and "three" is not on the real repository\'s HEAD', head3 != after[0] and out(ROOT, 'log', '-1', '--format=%s') != 'three')
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
