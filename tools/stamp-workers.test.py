#!/usr/bin/env python3
"""STAMP-WORKERS READS ITS COMMAND LINE BEFORE IT TOUCHES A WORKER. Pure Python, no network.

    python3 tools/stamp-workers.test.py

18 Nov 2026 (Sunday runsheet S9): `python3 tools/stamp-workers.py --help` STAMPED the Workers
instead of printing help, because main() only looked for '--check' and treated every other word
as "go". Same shape as canary-night.py --help playing a real night (009f1350).

Everything here runs on a COPY: tools/stamp-workers.py and every Worker it names are copied into
a temp folder, and the copy is what runs (its ROOT is its own folder). One copied Worker is made
stale on purpose, so a run that stamps WOULD write a file; the positive control proves that, so
"nothing was written" means something. The real Workers in this checkout are never opened for
writing.
"""
import hashlib, importlib.util, io, os, re, shutil, subprocess, sys, tempfile
from contextlib import redirect_stdout, redirect_stderr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, 'tools', 'stamp-workers.py')
PASS, FAIL = [0], [0]
ROW = re.compile(r'^  (stamped|unchanged|STALE|MISSING) ', re.M)   # one line per Worker main() looked at


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


def load(path):
    spec = importlib.util.spec_from_file_location('stamp_workers_copy_%d' % id(path), path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


REAL = load(TOOL)
TMP = os.path.realpath(tempfile.mkdtemp(prefix='stamp-workers-'))


def fresh():
    """A temp copy of the tool and its Workers, one Worker made stale. Returns (root, copy of the tool)."""
    root = tempfile.mkdtemp(dir=TMP)
    os.makedirs(os.path.join(root, 'tools'))
    shutil.copy(TOOL, os.path.join(root, 'tools', 'stamp-workers.py'))
    for rel in REAL.WORKERS:
        dst = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        src = os.path.join(ROOT, rel)
        if os.path.isfile(src):
            shutil.copy(src, dst)
        else:
            io.open(dst, 'w', encoding='utf-8').write('/* stand-in */\nexport default {};\n')
    first = os.path.join(root, REAL.WORKERS[0])
    with io.open(first, 'a', encoding='utf-8') as f:
        f.write('\n// changed after its stamp, so a stamping run must write this file\n')
    return root, os.path.join(root, 'tools', 'stamp-workers.py')


def snapshot(root):
    """Every file under root: its bytes' hash. Also any *.writing left behind."""
    out = {}
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f)
            out[os.path.relpath(p, root)] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    return out


def run_main(argv):
    """main()'s parse step for real, in-process, on a fresh copy. (rc, output, files changed)."""
    root, tool = fresh()
    before = snapshot(root)
    m = load(tool)
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            rc = m.main(list(argv))
        except SystemExit as e:
            rc = e.code
    after = snapshot(root)
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    return rc, out.getvalue() + err.getvalue(), changed


def run_script(argv):
    """The copied script as a person types it. (rc, output, files changed)."""
    root, tool = fresh()
    before = snapshot(root)
    r = subprocess.run([sys.executable, tool] + list(argv), capture_output=True, text=True, timeout=60, cwd=root)
    after = snapshot(root)
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    return r.returncode, r.stdout + r.stderr, changed


try:
    # ---- the fixture can see a write (positive control)
    rc, out, changed = run_main([])
    ok('CONTROL: no flag on a stale copy stamps it (exit 0, the stale Worker rewritten)',
       rc == 0 and changed == [REAL.WORKERS[0]], [rc, changed])
    rc, out, changed = run_main(['--check'])
    ok('CONTROL: --check on a stale copy exits 1 and writes nothing', rc == 1 and not changed and 'STALE' in out, [rc, changed])

    # ---- help
    for argv in (['--help'], ['-h'], ['--check', '--help'], ['--help', '--nope']):
        rc, out, changed = run_main(argv)
        ok('CMDLINE: %s exits 0 with usage' % ' '.join(argv), rc == 0 and 'usage' in out.lower() and '--check' in out, [rc, out[-160:]])
        ok('CMDLINE: %s writes no file' % ' '.join(argv), not changed, changed)
        ok('CMDLINE: %s opens no Worker (no stamp lines printed)' % ' '.join(argv),
           not ROW.search(out), out[-160:])

    # ---- anything unknown
    for argv in (['--nope'], ['--check', '--nope'], ['stray'], ['--check', 'stray'], ['--chec'], ['--check=yes'], ['-c'], ['--dry-run']):
        rc, out, changed = run_main(argv)
        ok('CMDLINE: %s exits 2 with an error' % ' '.join(argv), rc == 2 and 'error' in out.lower(), [rc, out[-160:]])
        ok('CMDLINE: %s writes no file' % ' '.join(argv), not changed, changed)

    # ---- the real script, as typed (on the copy)
    rc, out, changed = run_script(['--help'])
    ok('SCRIPT: python3 tools/stamp-workers.py --help exits 0 with usage and writes nothing',
       rc == 0 and 'usage' in out.lower() and not changed, [rc, changed, out[-160:]])
    rc, out, changed = run_script(['--bogus'])
    ok('SCRIPT: python3 tools/stamp-workers.py --bogus exits 2 and writes nothing', rc == 2 and not changed, [rc, changed, out[-160:]])
    rc, out, changed = run_script(['--check'])
    ok('SCRIPT: --check still exits 1 on a stale Worker and writes nothing (release.py, pre-push)', rc == 1 and not changed, [rc, changed])
    rc, out, changed = run_script([])
    ok('SCRIPT: no flag still stamps the stale Worker', rc == 0 and changed == [REAL.WORKERS[0]], [rc, changed])
    # ---- release.py, same fault, worse (18 Nov flag audit): `release.py --help` read only '--plan' and
    # went on to push main and deploy the live Workers. Run in-process with every way out to git, the
    # network or a subprocess replaced by a recorder that throws, so even a regression acts on nothing.
    spec = importlib.util.spec_from_file_location('release_flags_under_test', os.path.join(ROOT, 'tools', 'release.py'))
    R = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = ['release.py', '--plan']
    try:
        spec.loader.exec_module(R)
    finally:
        sys.argv = saved

    class _Acted(Exception):
        pass

    def release_main(argv):
        acted = []

        def rec(what):
            def f(*a, **k):
                acted.append(what)
                raise _Acted(what)
            return f
        real = (R.sh, R.remote_main, R.subprocess.run)
        R.sh, R.remote_main, R.subprocess.run = rec('sh'), rec('remote_main'), rec('subprocess.run')
        out, err = io.StringIO(), io.StringIO()
        sys.argv = ['release.py'] + list(argv)
        try:
            with redirect_stdout(out), redirect_stderr(err):
                try:
                    rc = R.main()
                except SystemExit as e:
                    rc = e.code
                except _Acted:
                    rc = 'acted'
        finally:
            sys.argv = saved
            R.sh, R.remote_main, R.subprocess.run = real
        return rc, acted, out.getvalue() + err.getvalue()

    for argv in (['--help'], ['-h'], ['--plan', '--help']):
        rc, acted, out = release_main(argv)
        ok('RELEASE: release.py %s exits 0 with usage and runs nothing (no git, no network)' % ' '.join(argv),
           rc == 0 and 'usage' in out.lower() and not acted, [rc, acted, out[-160:]])
    for argv in (['--nope'], ['--plan', '--nope'], ['--pla'], ['stray'], ['--help', '--nope']):
        rc, acted, out = release_main(argv)
        ok('RELEASE: release.py %s exits 2 and runs nothing' % ' '.join(argv),
           rc == 2 and 'error' in out.lower() and not acted, [rc, acted, out[-160:]])
    rc, acted, out = release_main(['--plan'])
    ok('RELEASE: release.py --plan still goes on to read git (the guard lets it through)', acted[:1] == ['sh'], [rc, acted])
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
