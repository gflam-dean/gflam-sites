#!/usr/bin/env python3
"""RELEASE.PY PUSHES ONE NAMED COMMIT AND PROVES IT ARRIVED (27 Oct 2026, the "three" incident).

    python3 tools/release-push.test.py

A bare git repository in a temp folder stands in for GitHub; a clone of it stands in for this
checkout. release.py is loaded as a module with ROOT pointed at the clone, and push_exactly() is
driven through the four things that went wrong or could have on 27 Oct:

  1. a plain release: the planned commit is what origin/main points at afterwards
  2. THE INCIDENT: a pre-push hook that moves HEAD (commits "three" onto the branch while the
     push is in flight). The release must stop, and "three" must never reach the remote
  3. origin/main moved before the push (someone else released): refused, nothing pushed
  4. a red gate (the hook exits 1): refused, remote and HEAD unchanged

Every git call here goes to a local path; the gate's git shim allows that and refuses anything
else, and this suite asserts that no remote but the temp folder was ever configured.
"""
import importlib.util, io, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


TMP = tempfile.mkdtemp(prefix='release-push-')
ENV = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t',
           GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1')
for k in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR'):
    ENV.pop(k, None)


def git(cwd, *args):
    return subprocess.run(['git'] + list(args), cwd=cwd, env=ENV, capture_output=True, text=True)


def commit(cwd, name):
    io.open(os.path.join(cwd, name), 'w').write(name + '\n')
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', name)
    return git(cwd, 'rev-parse', 'HEAD').stdout.strip()


def remote_main(bare):
    r = git(bare, 'rev-parse', 'refs/heads/main')
    return r.stdout.strip()


def load_release(clone):
    spec = importlib.util.spec_from_file_location('release_under_test', os.path.join(ROOT, 'tools', 'release.py'))
    mod = importlib.util.module_from_spec(spec)
    saved = sys.argv; sys.argv = ['release.py', '--plan']
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = saved
    mod.ROOT = clone
    # the module's sh() and push use ROOT as cwd; its git must not see this process's GIT_* either
    mod.sh = lambda args, **kw: subprocess.run(args, cwd=clone, capture_output=True, text=True, env=ENV, **kw)
    return mod


def fresh(name):
    """A bare remote and a clone with one pushed commit. Returns (bare, clone, sha_on_main)."""
    bare = os.path.join(TMP, name + '.git'); clone = os.path.join(TMP, name)
    subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', bare], env=ENV, check=True)
    subprocess.run(['git', 'clone', '-q', bare, clone], env=ENV, check=True)
    git(clone, 'checkout', '-q', '-b', 'main')
    base = commit(clone, 'base')
    r = git(clone, 'push', '-q', '-u', 'origin', 'main')
    assert r.returncode == 0, r.stderr
    return bare, clone, base


def run_push(mod, sha, expected, what):
    """Call push_exactly with stdout captured. Returns (stopped, printed)."""
    buf = io.StringIO(); saved = sys.stdout; sys.stdout = buf
    stopped = False
    try:
        mod.push_exactly(sha, expected, what)
    except SystemExit:
        stopped = True
    finally:
        sys.stdout = saved
    return stopped, buf.getvalue()


def hook(clone, body):
    p = os.path.join(clone, '.git', 'hooks', 'pre-push')
    io.open(p, 'w').write('#!/bin/sh\n' + body + '\n')
    os.chmod(p, 0o755)


try:
    print('1. a plain release lands the planned commit')
    bare, clone, base = fresh('plain')
    mod = load_release(clone)
    planned = commit(clone, 'feature')
    ok('the clone has exactly one local remote, the temp bare repo',
       git(clone, 'remote', 'get-url', 'origin').stdout.strip() == bare)
    ok('remote_main() reads the remote, not a local copy', mod.remote_main() == base, mod.remote_main()[:8])
    stopped, out = run_push(mod, planned, base, 'push')
    ok('push_exactly did not stop', not stopped, out.strip().splitlines()[-1][:80] if out.strip() else '')
    ok('origin/main is the planned commit', remote_main(bare) == planned)
    ok('it said so by SHA', planned[:8] in out and 'as planned' in out)

    print('2. THE INCIDENT: a hook moves HEAD while the push is in flight')
    bare, clone, base = fresh('incident')
    mod = load_release(clone)
    planned = commit(clone, 'feature')
    # what gate-record.test.py did on 27 Oct, in one line: commit onto the real branch from inside the hook
    hook(clone, 'cd "$(git rev-parse --show-toplevel)" && unset GIT_DIR && '
                'echo three > three && git add -A && git -c user.name=t -c user.email=t@t commit -q -m three && exit 0')
    stopped, out = run_push(mod, planned, base, 'push')
    head_now = git(clone, 'rev-parse', 'HEAD').stdout.strip()
    ok('the hook really moved HEAD (the fixture reproduces the incident)', head_now != planned,
       git(clone, 'log', '-1', '--format=%s').stdout.strip())
    ok('the release STOPPED', stopped)
    ok('it said HEAD moved, naming both commits', 'HEAD moved' in out and planned[:8] in out and head_now[:8] in out)
    ok('"three" never reached the remote', remote_main(bare) != head_now, remote_main(bare)[:8])
    ok('what reached the remote is the planned commit or nothing new', remote_main(bare) in (planned, base))

    print('3. origin/main moved before the push: refused, nothing pushed')
    bare, clone, base = fresh('moved')
    mod = load_release(clone)
    planned = commit(clone, 'feature')
    other = os.path.join(TMP, 'other-clone')
    subprocess.run(['git', 'clone', '-q', bare, other], env=ENV, check=True)
    theirs = commit(other, 'someone-elses-release')
    assert git(other, 'push', '-q', 'origin', 'HEAD:main').returncode == 0
    stopped, out = run_push(mod, planned, base, 'push')
    ok('the release STOPPED', stopped)
    ok('it said origin/main moved', 'origin/main moved' in out)
    ok('nothing was pushed: origin/main is still the other release', remote_main(bare) == theirs)

    print('4. a red gate (the hook exits 1): refused, remote and HEAD unchanged')
    bare, clone, base = fresh('red')
    mod = load_release(clone)
    planned = commit(clone, 'feature')
    hook(clone, 'echo "PUSH REFUSED (fixture)"; exit 1')
    stopped, out = run_push(mod, planned, base, 'push')
    ok('the release STOPPED', stopped)
    ok('it said the push was refused', 'refused' in out)
    ok('origin/main did not move', remote_main(bare) == base)
    ok('HEAD did not move', git(clone, 'rev-parse', 'HEAD').stdout.strip() == planned)

    print('5. release.py itself never pushes HEAD by name any more')
    src = io.open(os.path.join(ROOT, 'tools', 'release.py'), encoding='utf-8').read()
    ok("no 'HEAD:main' push left in release.py", "'HEAD:main']" not in src)
    ok('the push is by SHA to refs/heads/main', "sha + ':refs/heads/main'" in src)
    ok('the stamp commit goes through the same guard', "push_exactly(stamp, head, 'stamp push')" in src)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
