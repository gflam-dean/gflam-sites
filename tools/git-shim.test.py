#!/usr/bin/env python3
"""A SUITE THE GATE RUNS CANNOT PUSH, FETCH OR CLONE ANYWHERE BUT THIS DISK. RUN. GATELIB_NO_CHROME.

    python3 tools/git-shim.test.py

tools/git-shim/git is put first on every suite's PATH by gatelib.suite_env (which also drops the
GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE that git exports to a hook). This runs the shim as a suite
would: through PATH, in a throwaway repo whose remotes are a bare temp repo (allowed) and addresses
that are not paths on this disk (refused, recorded). Then it runs gatelib.run_suite itself with a
leaked GIT_DIR and a suite that tries to push, and reads the record the gate goes red on.

The addresses that must be refused use the reserved name github.invalid: a name that can never
resolve, because tools/prove-checks.py breaks the shim on purpose and the test must then fail, not
reach a real repository.
"""
import io, os, shutil, stat, subprocess, sys, tempfile, textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
sys.path.insert(0, TOOLS)
import gatelib  # noqa: E402

SHIM_DIR = os.path.join(TOOLS, 'git-shim')
SHIM = os.path.join(SHIM_DIR, 'git')
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


TMP = os.path.realpath(tempfile.mkdtemp(prefix='git-shim-'))
repo, bare, log = os.path.join(TMP, 'repo'), os.path.join(TMP, 'bare.git'), os.path.join(TMP, 'shim.log')
REAL = gatelib.real_git()
BASE = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
BASE.update(GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t',
            GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1')
# What a suite gets: the shim first on PATH, the real git named, the log named.
ENV = dict(BASE, PATH=SHIM_DIR + os.pathsep + os.environ.get('PATH', os.defpath), VP_GIT_REAL=REAL, VP_GIT_SHIM_LOG=log)


def g(*args, **kw):
    cwd = kw.pop('cwd', repo)
    env = dict(ENV, **kw.pop('env', {}))
    return subprocess.run(['git'] + list(args), cwd=cwd, capture_output=True, text=True, env=env, **kw)


def real(*args, **kw):
    cwd = kw.pop('cwd', repo)
    return subprocess.run([REAL] + list(args), cwd=cwd, capture_output=True, text=True, env=BASE).stdout.strip()


def attempts():
    return gatelib.git_shim_attempts(log)


try:
    os.makedirs(repo)
    real('init', '-q', '-b', 'main')
    real('config', 'commit.gpgsign', 'false')
    io.open(os.path.join(repo, 'a.txt'), 'w').write('a\n')
    real('add', '-A'); real('commit', '-q', '-m', 'first')
    head = real('rev-parse', 'HEAD')
    real('init', '-q', '--bare', bare, cwd=TMP)
    real('remote', 'add', 'local', bare)
    real('remote', 'add', 'origin', 'https://github.invalid/gflam-dean/gflam-sites.git')
    real('remote', 'add', 'sshy', 'git@github.invalid:gflam-dean/gflam-sites.git')

    print('1. the shim is what a suite finds as "git", and ordinary commands go straight through')
    ok('the shim exists and is executable', os.path.isfile(SHIM) and os.access(SHIM, os.X_OK), SHIM)
    which = subprocess.run(['sh', '-c', 'command -v git'], capture_output=True, text=True, env=ENV).stdout.strip()
    ok('"git" on a suite\'s PATH is tools/git-shim/git', os.path.realpath(which) == os.path.realpath(SHIM), which)
    ok('the real git it hands over to is not the shim and runs', os.path.realpath(REAL) != os.path.realpath(SHIM) and 'git version' in real('--version'), REAL)
    r = g('rev-parse', 'HEAD')
    ok('git rev-parse HEAD passes through and answers the real sha', r.returncode == 0 and r.stdout.strip() == head)
    r = g('-C', repo, 'status', '--porcelain', cwd=TMP)
    ok('git -C <dir> status passes through (global options before the verb are skipped, with their values)', r.returncode == 0 and r.stdout == '')
    io.open(os.path.join(repo, 'b.txt'), 'w').write('b\n')
    r = g('add', '-A'); r2 = g('commit', '-q', '-m', 'second')
    head2 = real('rev-parse', 'HEAD')
    ok('git add and git commit pass through and the commit lands', r.returncode == 0 and r2.returncode == 0 and head2 != head)
    ok('... and nothing was recorded for any of that', attempts() == [])

    print('\n2. a push, fetch, pull, clone or ls-remote to a path on this disk is allowed')
    r = g('push', '-q', 'local', 'HEAD:main')
    ok('git push local HEAD:main (a remote NAME that is a bare repo on disk) goes through and lands', r.returncode == 0 and real('rev-parse', 'main', cwd=bare) == head2, r.stderr.strip()[-160:])
    r = g('push', '-q', bare, 'HEAD:refs/heads/by-path')
    ok('git push <path> goes through', r.returncode == 0 and real('rev-parse', 'by-path', cwd=bare) == head2)
    r = g('fetch', '-q', 'local')
    ok('git fetch local goes through', r.returncode == 0, r.stderr.strip()[-120:])
    r = g('ls-remote', 'file://' + bare)
    ok('git ls-remote file://<path> goes through', r.returncode == 0 and head2 in r.stdout)
    r = g('clone', '-q', bare, os.path.join(TMP, 'clone-ok'), cwd=TMP)
    ok('git clone <path> goes through', r.returncode == 0 and os.path.isdir(os.path.join(TMP, 'clone-ok', '.git')))
    r = g('pull', '-q', '--ff-only', 'local', 'main')
    ok('git pull local main goes through', r.returncode == 0, r.stderr.strip()[-120:])
    ok('... and still nothing was recorded', attempts() == [])

    print('\n3. anywhere that is not a path on this disk is refused, exit 128, and written down')
    n = 0

    def refused(label, r, want_in_log):
        global n
        n += 1
        lines = attempts()
        last = lines[-1] if lines else ''
        ok(label, r.returncode == 128 and 'REFUSED' in r.stderr and len(lines) == n and 'REFUSED' in last and want_in_log in last and 'cwd=' in last,
           (r.returncode, (r.stderr.strip().splitlines() or [''])[0][:120], last[-100:]))

    r = g('push', 'origin', 'HEAD:main')
    refused('git push origin HEAD:main, where origin is an https address', r, 'https://github.invalid/')
    ok('... and the bare repo on disk did not change meanwhile', real('rev-parse', 'main', cwd=bare) == head2)
    r = g('push', 'sshy', 'HEAD:main')
    refused('git push to a remote named by an ssh address (git@host:path)', r, 'git@github.invalid:')
    r = g('push', 'https://github.invalid/x/y.git', 'HEAD:main')
    refused('git push <https url> HEAD:main', r, 'https://github.invalid/x/y.git')
    r = g('push', '-o', 'ci.skip', 'origin', 'HEAD:main')
    refused('git push -o <option> origin: the option\'s value is not mistaken for the remote', r, 'https://github.invalid/')
    r = g('push')
    refused('git push with no remote named: the branch\'s default (origin) is resolved and refused', r, 'https://github.invalid/')
    r = g('fetch', 'origin')
    refused('git fetch origin', r, 'https://github.invalid/')
    r = g('pull', 'origin', 'main')
    refused('git pull origin main', r, 'https://github.invalid/')
    r = g('ls-remote', 'https://github.invalid/x/y.git')
    refused('git ls-remote <https url>', r, 'https://github.invalid/x/y.git')
    r = g('clone', 'https://github.invalid/x/y.git', os.path.join(TMP, 'clone-no'), cwd=TMP)
    refused('git clone <https url>', r, 'https://github.invalid/x/y.git')
    ok('... and no clone folder was made', not os.path.exists(os.path.join(TMP, 'clone-no')))
    r = g('push', 'ext::sh -c true', 'HEAD:main')
    refused('git push to a remote-helper address (<helper>::...)', r, 'ext::')
    r = g('-C', repo, 'push', 'origin', 'HEAD:main', cwd=TMP)
    refused('git -C <dir> push origin: the verb is found behind global options', r, 'https://github.invalid/')
    ok('every refusal is one line in the log, dated, with the command and the address it resolved to',
       len(attempts()) == n and all(l[:4].isdigit() and ' REFUSED: git ' in l and ' -> ' in l for l in attempts()), attempts()[:1])
    r = g('push', 'origin', 'HEAD:main', env={'VP_GIT_SHIM_LOG': ''})
    ok('with no log named the push is still refused (the log is a record, not the fence)', r.returncode == 128 and 'REFUSED' in r.stderr)
    r = g('push', 'origin', 'HEAD:main', env={'VP_GIT_REAL': ''})
    ok('with VP_GIT_REAL unset the shim finds the next git on PATH itself and still refuses', r.returncode == 128 and 'REFUSED' in r.stderr, r.stderr.strip()[:100])

    print('\n4. gatelib gives every suite this PATH and drops what git exports to a hook')
    leaked = {'GIT_DIR': '/nowhere/.git', 'GIT_WORK_TREE': '/nowhere', 'GIT_INDEX_FILE': '/nowhere/index', 'GIT_PREFIX': '', 'GIT_COMMON_DIR': '/nowhere/.git'}
    env = gatelib.suite_env(dict(os.environ, **leaked))
    ok('suite_env drops GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_PREFIX and GIT_COMMON_DIR', not any(k in env for k in leaked))
    ok('... keeps everything else', all(env.get(k) == v for k, v in os.environ.items() if not k.startswith('GIT_') and k not in ('PATH', 'VP_GIT_REAL', 'VP_GIT_SHIM_LOG')))
    ok('... puts tools/git-shim first on PATH, once', env['PATH'].split(os.pathsep)[0] == SHIM_DIR and env['PATH'].split(os.pathsep).count(SHIM_DIR) == 1)
    env2 = gatelib.suite_env(env)
    ok('... and a second pass does not stack it', env2['PATH'].split(os.pathsep).count(SHIM_DIR) == 1)
    ok('... names the real git for the shim (VP_GIT_REAL), and it is not the shim', os.path.realpath(env['VP_GIT_REAL']) != os.path.realpath(SHIM) and os.access(env['VP_GIT_REAL'], os.X_OK))
    ok('... and names the log (VP_GIT_SHIM_LOG), the one release-check.py reads', env['VP_GIT_SHIM_LOG'] == gatelib.GIT_SHIM_LOG)

    # run_suite for real, with GIT_DIR leaked into THIS process, as it was inside the hook on 27 Oct 2026.
    probe = os.path.join(TMP, 'probe.py')
    io.open(probe, 'w').write(textwrap.dedent('''\
        import os, shutil
        print('GIT_DIR=' + os.environ.get('GIT_DIR', '<unset>'))
        print('GIT_WORK_TREE=' + os.environ.get('GIT_WORK_TREE', '<unset>'))
        print('git=' + str(shutil.which('git')))
        '''))
    saved_log, gatelib.GIT_SHIM_LOG = gatelib.GIT_SHIM_LOG, os.path.join(TMP, 'gate.log')
    os.environ.update(GIT_DIR='/nowhere/.git', GIT_WORK_TREE='/nowhere')
    try:
        r = gatelib.run_suite([sys.executable, probe], cwd=TMP, timeout=60)
    finally:
        del os.environ['GIT_DIR']; del os.environ['GIT_WORK_TREE']
    ok('gatelib.run_suite: a suite started while GIT_DIR and GIT_WORK_TREE are set in the gate does not see them',
       r.rc == 0 and 'GIT_DIR=<unset>' in r.out and 'GIT_WORK_TREE=<unset>' in r.out, ' | '.join(r.lines[-3:]))
    ok('... and the git it finds is the shim', 'git=' + SHIM in r.out or 'git=' + os.path.realpath(SHIM) in r.out, r.last)
    pusher = os.path.join(TMP, 'pusher.py')
    io.open(pusher, 'w').write(textwrap.dedent('''\
        import subprocess, sys
        r = subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=%r, capture_output=True, text=True)
        print('rc=%%d' %% r.returncode); print((r.stderr.strip().splitlines() or [''])[0]); sys.exit(0 if r.returncode == 0 else 3)
        ''' % repo))
    r = gatelib.run_suite([sys.executable, pusher], cwd=TMP, timeout=60)
    rec = gatelib.git_shim_attempts()
    ok('gatelib.run_suite: a suite that runs "git push origin HEAD:main" (an https origin) is refused', r.rc == 3 and 'rc=128' in r.out and 'REFUSED' in r.out, ' | '.join(r.lines[-2:]))
    ok('... and gatelib.git_shim_attempts() has the one line the gate turns red on', len(rec) == 1 and 'https://github.invalid/' in rec[0] and 'REFUSED: git push origin HEAD:main' in rec[0], rec[:1])
    ok('... with nothing recorded for a suite that pushes nowhere', (gatelib.run_suite([sys.executable, probe], cwd=TMP, timeout=60).rc == 0) and len(gatelib.git_shim_attempts()) == 1)
    gatelib.GIT_SHIM_LOG = saved_log

    print('\n5. wired in: the gate reads the record, the ledger and the jsc runner go through run_suite, the hook drops GIT_DIR')
    rc_src = io.open(os.path.join(TOOLS, 'release-check.py'), encoding='utf-8').read()
    i = rc_src.find("ok('no suite tried to push, fetch, pull or clone anywhere but a local path'")
    ok('release-check.py has the line "no suite tried to push, fetch, pull or clone anywhere but a local path"', i > 0)
    ok('... judged on gatelib.git_shim_attempts(), not on a word in a file', 'attempts = gatelib.git_shim_attempts()' in rc_src[max(0, i - 400):i] and 'not attempts' in rc_src[i:i + 200])
    ok('... and every .test.py and .test.js the gate runs goes through gatelib.run_suite', 'gatelib.run_suite_with_retry(' in rc_src and 'gatelib.run_suite([JSC, t]' in rc_src)
    gl_src = io.open(os.path.join(TOOLS, 'gatelib.py'), encoding='utf-8').read()
    ok('gatelib.run_suite applies suite_env to every Popen it makes', 'env=suite_env(env)' in gl_src and gl_src.count('subprocess.Popen(') == 1)
    ledger_src = io.open(os.path.join(TOOLS, 'check-suite-ledger.py'), encoding='utf-8').read()
    ok('check-suite-ledger.py runs suites through gatelib.run_suite too', 'gatelib.run_suite(' in ledger_src and 'subprocess.Popen' not in ledger_src)
    hook_src = io.open(os.path.join(TOOLS, 'hooks', 'pre-push'), encoding='utf-8').read()
    ok('tools/hooks/pre-push unsets GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE before it runs the gate',
       '\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE' in hook_src and hook_src.index('unset GIT_DIR') < hook_src.index('release-check.py'))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
