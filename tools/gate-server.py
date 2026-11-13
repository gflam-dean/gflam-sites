#!/usr/bin/env python3
"""THE PRE-PUSH GATE'S CHROME HALF, RUN ON vp-tests-1 AND ACCEPTED ONLY UNDER A RECORD THE MAC SIGNED (INBOX 265.4
of 12 Nov 2026, tightened as the FAST GATE of 13 Nov 2026, INBOX 357A; design and threat model:
~/venue-enrich/reports/fast-gate-13nov/DESIGN.md).

    python3 tools/gate-server.py run          the ONE trusted path that writes a record: sends this exact tree to
                                              vp-tests-1, runs every Chrome suite the gate would run (minus MAC_ONLY)
                                              there 4 at a time (about 30 min), judges the raw output HERE, signs HERE
    python3 tools/gate-server.py check        read only: would the gate accept a record for THIS tree, and why (0 yes, 1 no)
    python3 tools/gate-server.py init-key     once per Mac: make the signing key file if it is not there (mode 600, never printed)

WHY. The pre-push hook (release-check.py --local) runs about 117 Chrome suites one at a time on the Mac: 2 h 12 min on
12 Nov 2026. The same suites run 4 at a time on the Hetzner box vp-tests-1 in about 30 min, with the same results
(~/venue-enrich/builds/TEST-SERVER.md). So the gate may take the Chrome half from a server run, but only from a
run the MAC can prove it asked for, on these exact files, green, recently:

  release-check.py --chrome-record   (what the hook runs) asks accepted() below. A Chrome suite is left out on the
                                     Mac ONLY when a record that passes EVERY rule below covers it. Anything else, the
                                     suite runs on the Mac exactly as before (one at a time, one retry), so nothing is
                                     ever weaker than the gate it replaces. MAC_ONLY suites always run on the Mac.

WHO SIGNS. The key lives only in KEY_FILE on this Mac (mode 600, never printed, never sent, no environment variable
moves it). The server never signs anything and never sees the key. The Mac:
  1. computes the tree (git HEAD^{tree} of a CLEAN checkout) and a MANIFEST of it: the git blob id of every file
     remote-run.sh copies (manifest() below), and a fresh random NONCE for this run;
  2. sends that folder, the path list and the nonce; the server hashes the copied files itself before the first
     suite and again after the last, and echoes the nonce, in its results file;
  3. refuses to sign unless the nonce is this run's, both server hashes equal the Mac's manifest, no listed file is
     missing on the server, every Chrome suite the gate runs came back, and the Mac's OWN copy of the rules (the
     tree's passwording.verdict and check-suite-ledger.judge, run HERE on the server's full raw output) calls each
     one green at or over its ledger count; and the Mac's own tree did not move during the run.

THE RECORD (one JSON file per tree in RECORD_DIR, outside the repo, written only by `run`):
  tree      git rev-parse HEAD^{tree}. Any change to any file, even an amend that changes one byte, is another tree.
  manifest  the sha256 of the files the server ran, as the server measured them (equal to the Mac's, or no record)
  time      when the run finished; refused at MAX_AGE_S (2 h) or if dated in the future
  suites    every Chrome suite run: exit code, last line, the one pass judge's verdict and the ledger's count (both
            worked out on the Mac from the raw output), FAIL lines, seconds
  sig       HMAC-SHA256 over everything else, with the Mac's key. A record edited by hand, or signed with another
            key, is refused.

REFUSED (the gate then runs every Chrome suite on the Mac): no key file or a key file others can read; no record for
this tree; an empty, unreadable or wrong-version record; no signature or a bad one; a record for another tree; older
than 2 h or from the future; a Chrome suite the gate would run that is missing from the record; a suite that is not
green the way the gate judges green; a suite with a FAIL line; a suite that counted fewer checks than
tools/suite-counts.json, printed only a total where the ledger counts lines, or is not in the ledger at all; a record
carrying re-runs (the server never retries). There is no partial acceptance: one bad suite and the record covers none.

FLAKES. No retries on the server. A red in the 4-at-a-time pass means NO record is signed, and the hook then runs
every Chrome suite on the Mac under its usual one-retry rule. MAC_ONLY (signin-logo-in-chrome: it flakes on Linux
only, TEST-SERVER.md) is never sent to the server and never covered: the Mac runs it under the existing rule. Whether
to keep that, or send it to the server and let its Linux flake block, is a decision for main (DESIGN.md).

WHAT THIS DOES NOT STOP. Anyone holding the key can sign anything; the key is the trust. A server that lies about
running a suite on files it WAS sent can make the Mac sign that lie for that tree (it cannot make the Mac sign any
other tree, and it cannot write a record by itself). DESIGN.md says what that costs and what would close it.

The server half is ~/venue-enrich/builds/tools-remote/remote-run.sh (not in the repo; TEST-SERVER.md). Its path is
fixed here, never taken from the environment, so no environment variable can put a fake runner behind a real key.
"""
import ast, fnmatch, hashlib, hmac, io, json, os, re, secrets, stat, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = 2
MAX_AGE_S = 2 * 60 * 60
JOBS = 4
MAC_ONLY = ('signin-logo-in-chrome.test.py',)
KEY_NAME = 'GATE_RECORD_KEY'
KEY_FILE = os.path.expanduser('~/.gflam-gate.env')
RECORD_DIR = os.path.expanduser('~/venue-enrich/reports/gate-records')
REMOTE_RUN = os.path.expanduser('~/venue-enrich/builds/tools-remote/remote-run.sh')
HOST = '65.109.160.187'
GATED_DIRS = ['venueplay', 'partyplay', 'venueplay-backend', 'partyplay-backend', 'tools']


# ---------------------------------------------------------------- the gate's own rules, read from the gate's own files

def _fn_from(path, name, env):
    """One top-level function from a tool, compiled from that tool's own source, so the rule used here is the
    gate's rule and not a second copy of it. Nothing else in the file runs."""
    src = io.open(path, encoding='utf-8').read()
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            mod = ast.Module(body=[node], type_ignores=[])
            ns = dict(env)
            exec(compile(mod, path, 'exec'), ns)
            return ns[name]
    raise LookupError('%s has no function %s' % (path, name))


def passwording_of(root):
    """tools/passwording.py of the tree, the one pass judge every gate reader asks (INBOX 270)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('passwording_for_gate_server', os.path.join(root, 'tools', 'passwording.py'))
    pw = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pw)
    return pw


def suite_passed_rule(root):
    """release-check.py's own suite_passed. Since 12 Nov 2026 (INBOX 270) that asks the one pass judge,
    tools/passwording.py, so the judge is loaded from the same tree and handed to it: lifted alone, the
    function would only know 're' and fail on its first call (NameError: passwording)."""
    pw = passwording_of(root)
    return _fn_from(os.path.join(root, 'tools', 'release-check.py'), 'suite_passed', {'re': re, 'passwording': pw})


def ledger_judge(root):
    """check-suite-ledger.py's own judge(rc, out) -> (rc, checks, FAIL lines, counted_by), with the three patterns it
    reads, compiled from the tree's file (nothing else in it runs). The Mac counts the server's raw output with this,
    so a server that reported its own count is never believed."""
    path = os.path.join(root, 'tools', 'check-suite-ledger.py')
    tree = ast.parse(io.open(path, encoding='utf-8').read())
    ns = {'re': re}
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') in ('OK_LINE', 'SUMMARY', 'BAD_LINE') for t in node.targets):
            exec(compile(ast.Module(body=[node], type_ignores=[]), path, 'exec'), ns)
    return _fn_from(path, 'judge', ns)


def chrome_suites(root):
    """The Chrome suites release-check.py --local runs, found the way it finds them (section C): every
    tools/*.test.py that gatelib.uses_chrome says drives Chrome. Basenames, sorted."""
    sys.path.insert(0, os.path.join(root, 'tools'))
    import importlib.util
    spec = importlib.util.spec_from_file_location('gatelib_for_gate_server', os.path.join(root, 'tools', 'gatelib.py'))
    gl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gl)
    tools = os.path.join(root, 'tools')
    return sorted(f for f in os.listdir(tools) if f.endswith('.test.py') and gl.uses_chrome(os.path.join(tools, f)))


def ledger(root):
    try:
        with io.open(os.path.join(root, 'tools', 'suite-counts.json'), encoding='utf-8') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


# ---------------------------------------------------------------- git

def _git(root, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    r = subprocess.run(['git'] + list(args), cwd=root, capture_output=True, text=True, env=env)
    return r.stdout.strip() if r.returncode == 0 else ''


def current_tree(root):
    """(tree, head, dirty). tree is '' unless the WHOLE checkout is clean (backups aside): the server gets a copy of
    the folder, so every file in it has to be the commit's."""
    dirty = _git(root, 'status', '--porcelain')
    dirty = '\n'.join(l for l in dirty.splitlines() if not (l.startswith('?? ') and '.backup-' in l))
    tree = _git(root, 'rev-parse', 'HEAD^{tree}')
    head = _git(root, 'rev-parse', 'HEAD')
    if dirty or not tree:
        return '', head, dirty or 'no HEAD'
    return tree, head, ''


# What remote-run.sh leaves out of the copy it sends (its rsync --exclude list). A tracked file that matches is not
# on the server, so it is not in the manifest; everything else is, by its git blob id.
SYNC_EXCLUDE_PARTS = ('.git', 'node_modules')
SYNC_EXCLUDE_PREFIX = ('venueplay-backend/data/archive/',)
SYNC_EXCLUDE_NAMES = ('.env', '.env.*', '*.env', '.dev.vars*', '*.pem', '*.key')
SYNC_EXCLUDE_PATHS = ('tools/flake-log.jsonl',)


def synced(path):
    """Is this repo path one remote-run.sh copies to the server?"""
    parts = path.split('/')
    if any(p in SYNC_EXCLUDE_PARTS for p in parts) or path.startswith(SYNC_EXCLUDE_PREFIX) or path in SYNC_EXCLUDE_PATHS:
        return False
    return not any(fnmatch.fnmatchcase(parts[-1], pat) for pat in SYNC_EXCLUDE_NAMES)


def manifest_digest(pairs):
    """sha256 over 'blobid path\n' lines sorted by path (bytes). vp-run-suites.py --paths writes the same form."""
    h = hashlib.sha256()
    for path, blob in sorted(pairs):
        h.update(blob + b' ' + path + b'\n')
    return h.hexdigest()


def manifest(root, rev='HEAD'):
    """(digest, [paths as bytes]) of every file in the commit that the server is sent, from git's own blob ids. On a
    clean checkout those are the bytes on disk, so they are the bytes rsync copies."""
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    r = subprocess.run(['git', 'ls-tree', '-r', '-z', '--full-tree', rev], cwd=root, capture_output=True, env=env)
    if r.returncode != 0:
        return '', []
    pairs = []
    for item in r.stdout.split(b'\0'):
        if not item:
            continue
        meta, _, path = item.partition(b'\t')
        mode, kind, blob = meta.split(b' ')
        if kind != b'blob' or not synced(path.decode('utf-8', 'surrogateescape')):
            continue
        pairs.append((path, blob))
    return manifest_digest(pairs), [p for p, _ in pairs]


# ---------------------------------------------------------------- the key (never printed, never sent anywhere)

def read_key(path=KEY_FILE):
    """(key bytes or None, reason). Refuses a key file that anyone but its owner can read."""
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return None, 'no signing key on this Mac (%s); run python3 tools/gate-server.py init-key once' % path
    if st.st_mode & 0o077:
        return None, 'the signing key file %s can be read by others (mode %o); chmod 600 it' % (path, stat.S_IMODE(st.st_mode))
    if hasattr(os, 'getuid') and st.st_uid != os.getuid():
        return None, 'the signing key file %s is not owned by this user' % path
    try:
        for line in io.open(path, encoding='utf-8'):
            k, _, v = line.strip().partition('=')
            if k.strip() == KEY_NAME:
                v = v.strip()
                if re.fullmatch(r'[0-9a-f]{64,}', v):
                    return bytes.fromhex(v), ''
                return None, 'the signing key in %s is not 64+ hex characters' % path
    except Exception as e:
        return None, 'the signing key file %s cannot be read (%s)' % (path, type(e).__name__)
    return None, 'no %s line in %s' % (KEY_NAME, path)


def init_key(path=KEY_FILE):
    if os.path.exists(path):
        k, why = read_key(path)
        return (True, 'a key is already in place') if k else (False, why)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as fh:
        fh.write('# The pre-push gate record signing key (tools/gate-server.py). Never print it, never copy it\n'
                 '# to the test server, never commit it. Delete this file to stop trusting every record.\n'
                 '%s=%s\n' % (KEY_NAME, secrets.token_hex(32)))
    return True, 'made %s (mode 600); its value was not printed' % path


def _canon(body):
    return json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def key_id(key):
    return hashlib.sha256(b'venueplay gate record key id\0' + key).hexdigest()[:12]


def sign(body, key):
    body = {k: v for k, v in body.items() if k != 'sig'}
    body['key_id'] = key_id(key)
    out = dict(body)
    out['sig'] = hmac.new(key, _canon(body), hashlib.sha256).hexdigest()
    return out


# ---------------------------------------------------------------- judging one suite the gate's way

def suite_green(entry, want, passed_rule):
    """'' if this one run is green the way the gate (and its ledger) would call it, else why not."""
    if not isinstance(entry, dict):
        return 'no result'
    if entry.get('rc') != 0:
        return 'exit %s' % entry.get('rc')
    v = entry.get('verdict')
    if not (isinstance(v, list) and len(v) == 2):
        return 'the one pass judge (tools/passwording.py) never read its output on the Mac'
    if v[0] is not True:
        return 'the one pass judge says: %s' % str(v[1])[:80]
    if not passed_rule(entry.get('last') or ''):
        return 'last line is not a pass: %r' % (entry.get('last') or '')[:80]
    if entry.get('bad'):
        return 'FAIL line: %s' % str(entry['bad'][0])[:80]
    n = entry.get('checks')
    if not isinstance(n, int) or n <= 0:
        return 'no checks counted'
    if want is None:
        return 'not in tools/suite-counts.json'
    if want.get('counted_by') == 'lines' and entry.get('counted_by') != 'lines':
        return 'printed only a total where the ledger counts each check'
    if n < int(want.get('checks', 0)):
        return 'ran %d checks, the ledger says %d' % (n, int(want.get('checks', 0)))
    return ''


def suite_accepted(name, entry, want, passed_rule):
    """A suite is covered only when its ONE 4-at-a-time run is green (13 Nov 2026, INBOX 357A: no retries on the
    server, a red blocks). A record that carries re-runs at all is from the old rule and is refused."""
    if not isinstance(entry, dict):
        return 'no result'
    if 'reruns' in entry:
        return 'it carries re-runs, and the server never retries'
    return suite_green(entry, want, passed_rule)


# ---------------------------------------------------------------- the verdict

def verify(raw, tree, key, now, required, counts, passed_rule, max_age_s=MAX_AGE_S):
    """(covered basenames, reason). covered is EMPTY unless every rule holds: there is no partial acceptance, so a
    record that is wrong about one suite covers none."""
    if raw is None:
        return set(), 'no gate record for this tree'
    if not raw.strip():
        return set(), 'the gate record is an empty file'
    try:
        rec = json.loads(raw)
    except Exception:
        return set(), 'the gate record is not readable JSON'
    if not isinstance(rec, dict):
        return set(), 'the gate record is not a record'
    if key is None:
        return set(), 'no key to check the signature with'
    sig = rec.get('sig')
    if not isinstance(sig, str) or not re.fullmatch(r'[0-9a-f]{64}', sig):
        return set(), 'the gate record is not signed'
    body = {k: v for k, v in rec.items() if k != 'sig'}
    if not hmac.compare_digest(hmac.new(key, _canon(body), hashlib.sha256).hexdigest(), sig):
        if body.get('key_id') and body.get('key_id') != key_id(key):
            return set(), 'the gate record was signed with a different key'
        return set(), 'the gate record signature does not match: it was edited after it was signed'
    if rec.get('v') != VERSION:
        return set(), 'the gate record is version %r, this gate reads %d' % (rec.get('v'), VERSION)
    if not tree:
        return set(), 'this checkout is dirty, so no record can be for it'
    if rec.get('tree') != tree:
        return set(), 'the gate record is for tree %s and this is tree %s' % (str(rec.get('tree'))[:12], tree[:12])
    t = rec.get('time')
    if not isinstance(t, (int, float)):
        return set(), 'the gate record has no time'
    if t > now + 60:
        return set(), 'the gate record is dated in the future'
    if now - t >= max_age_s:
        return set(), 'the gate record is %d min old, over the %d h limit' % ((now - t) // 60, max_age_s // 3600)
    suites = rec.get('suites')
    if not isinstance(suites, dict):
        return set(), 'the gate record lists no suites'
    need = [s for s in required if s not in MAC_ONLY]
    if not need:
        return set(), 'there are no Chrome suites to cover'
    missing = [s for s in need if s not in suites]
    if missing:
        return set(), 'the gate record does not cover %d Chrome suite(s) the gate runs: %s' % (len(missing), ', '.join(missing[:4]))
    for s in need:
        why = suite_accepted(s, suites[s], counts.get('tools/' + s), passed_rule)
        if why:
            return set(), 'the gate record has %s not green: %s' % (s, why)
    return set(need), ('%d Chrome suite(s) ran green on %s (%s jobs) on this tree %s, %d min ago at %s, signed on this Mac; %s'
                       % (len(need), rec.get('host', '?'), rec.get('jobs', '?'), tree[:12], (now - t) // 60, rec.get('when', '?'),
                          'on the Mac: ' + ', '.join(s for s in MAC_ONLY if s in required)))


def record_path(tree, record_dir=RECORD_DIR):
    return os.path.join(record_dir, tree + '.json')


def accepted(root=ROOT, now=None, key_file=KEY_FILE, record_dir=RECORD_DIR):
    """What release-check.py --chrome-record asks. (covered basenames, one-line reason). Never raises."""
    try:
        now = time.time() if now is None else now
        tree, head, dirty = current_tree(root)
        if not tree:
            return set(), 'this checkout is dirty, so no record can be for it'
        key, why = read_key(key_file)
        if key is None:
            return set(), why
        p = record_path(tree, record_dir)
        raw = io.open(p, encoding='utf-8', errors='replace').read() if os.path.isfile(p) else None
        return verify(raw, tree, key, now, chrome_suites(root), ledger(root), suite_passed_rule(root))
    except Exception as e:
        return set(), 'the gate record could not be checked (%s: %s)' % (type(e).__name__, str(e)[:120])


# ---------------------------------------------------------------- the one trusted writer

def collect(root, runner, suites, nonce, paths, jobs=JOBS, say=print):
    """Run `suites` ONCE through runner(suites, jobs, nonce, paths) -> {name: entry, RUN_KEY: run facts}. No re-runs.
    Returns (results, still red, run facts)."""
    counts, passed_rule = ledger(root), suite_passed_rule(root)
    got = runner(suites, jobs, nonce, paths) or {}
    run = got.get(RUN_KEY) if isinstance(got.get(RUN_KEY), dict) else {}
    results, red = {}, []
    for s in suites:
        e = dict(got.get(s) or {'rc': 'missing', 'last': '', 'bad': ['the runner returned no result'], 'checks': 0})
        why = suite_accepted(s, e, counts.get('tools/' + s), passed_rule)
        if why:
            say('  %s red on the server (%s)' % (s, why))
            red.append(s)
        results[s] = e
    return results, red, run


RUN_KEY = '__run__'


def run_bound(run, nonce, digest):
    """'' when the server's run facts tie its results to THIS request and THESE files, else why not."""
    if not isinstance(run, dict) or not run:
        return 'the server sent no run facts (nonce, manifest), so its results cannot be tied to this tree'
    if run.get('nonce') != nonce:
        return 'the results answer another request (nonce %r, this run sent %r)' % (str(run.get('nonce'))[:12], nonce[:12])
    if run.get('missing'):
        return 'the server is missing %s file(s) of this tree, e.g. %s' % (run.get('missing_n', len(run['missing'])), str(run['missing'][0])[:80])
    if run.get('manifest_start') != digest:
        return 'the files the server ran are not this tree (manifest %s, the Mac has %s)' % (str(run.get('manifest_start'))[:12], digest[:12])
    if run.get('manifest_end') != digest:
        return 'the files on the server changed while the suites ran (manifest %s at the end)' % str(run.get('manifest_end'))[:12]
    return ''


def make_record(root, runner, key, now=None, say=print, host=HOST, host_key=''):
    """THE ONLY WRITER. Returns (ok, text, record or None). Refuses over a dirty tree, refuses if the tree moved
    while the suites ran, refuses results it cannot tie to this request and these files, signs nothing unless every
    Chrome suite (MAC_ONLY aside) came back green on its first and only run."""
    tree, head, dirty = current_tree(root)
    if not tree:
        return False, 'not run: the checkout is dirty, so the server would judge files that are not a commit:\n' + dirty[:400], None
    suites = [s for s in chrome_suites(root) if s not in MAC_ONLY]
    if not suites:
        return False, 'not run: no Chrome suites found', None
    digest, paths = manifest(root)
    if not digest:
        return False, 'not run: the manifest of this tree could not be read', None
    nonce = secrets.token_hex(16)
    t0 = time.time()
    results, red, run = collect(root, runner, suites, nonce, paths, say=say)
    tree2, head2, dirty2 = current_tree(root)
    if tree2 != tree:
        return False, 'NOT SIGNED: the checkout changed while the suites ran (tree %s, now %s)' % (tree[:12], (tree2 or 'dirty')[:12]), None
    why = run_bound(run, nonce, digest)
    if why:
        return False, 'NOT SIGNED: ' + why, None
    if red:
        return False, 'NOT SIGNED: %d Chrome suite(s) red on the server: %s' % (len(red), ', '.join(red[:6])), None
    now = time.time() if now is None else now
    body = {'v': VERSION, 'tree': tree, 'head': head, 'manifest': digest, 'files': len(paths), 'time': now,
            'when': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now)), 'host': host, 'host_key': host_key,
            'jobs': JOBS, 'mac_only': list(MAC_ONLY), 'wall_s': round(time.time() - t0),
            'server_wall_s': run.get('wall'), 'suites': results}
    rec = sign(body, key)
    covered, why = verify(json.dumps(rec), tree, key, now, chrome_suites(root), ledger(root), suite_passed_rule(root))
    if not covered:
        return False, 'NOT SIGNED: the record would not pass its own check: ' + why, None
    return True, 'signed: %d Chrome suites green on tree %s (commit %s), %d files matched on the server' % (len(suites), tree[:12], head[:8], len(paths)), rec


def write_record(rec, record_dir=RECORD_DIR):
    os.makedirs(record_dir, mode=0o700, exist_ok=True)
    p = record_path(rec['tree'], record_dir)
    tmp = p + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as fh:
        json.dump(rec, fh, indent=1, sort_keys=True)
        fh.write('\n')
    os.replace(tmp, p)
    return p


OUT_CAP = 4 * 1024 * 1024


def judge_raw(root):
    """entry_from(server line) -> the entry the record keeps, judged HERE from the raw output with the tree's own
    passwording.verdict and check-suite-ledger.judge. The server's own 'judge', 'passed' and 'last' are not used."""
    pw, judge = passwording_of(root), ledger_judge(root)

    def entry_from(d):
        out = d.get('out')
        if not isinstance(out, str) or d.get('out_truncated'):
            return {'rc': d.get('rc'), 'last': '', 'checks': 0, 'counted_by': '', 'verdict': [False, 'no whole output came back'],
                    'bad': ['the server sent no whole output for the Mac to judge'], 'seconds': d.get('seconds')}
        rc = d.get('rc')
        lines = out.strip().splitlines()
        j = judge(rc if isinstance(rc, int) else 124, out)
        ok, why = pw.verdict(rc if isinstance(rc, int) else 124, out, rc == 'timeout')
        return {'rc': rc, 'last': lines[-1] if lines else '', 'checks': j[1], 'bad': list(j[2])[:10], 'counted_by': j[3],
                'verdict': [bool(ok), str(why)[:200]], 'seconds': d.get('seconds'),
                'out_sha256': hashlib.sha256(out.encode('utf-8', 'surrogateescape')).hexdigest()}
    return entry_from


def read_results(path, root):
    """{suite basename: entry, RUN_KEY: run facts} from a vp-run-suites.py results file."""
    entry_from = judge_raw(root)
    out = {}
    for line in io.open(path, encoding='utf-8'):
        d = json.loads(line)
        if 'run' in d and isinstance(d['run'], dict):
            out[RUN_KEY] = d['run']
        if 'suite' not in d:
            continue
        out[os.path.basename(d['suite'])] = entry_from(d)
    return out


def remote_runner(root):
    """runner(suites, jobs, nonce, paths) for the real server: remote-run.sh with the nonce and the path list (the
    server hashes those files before and after the suites), its results file read back and judged here."""
    def run(suites, jobs, nonce, paths):
        fd, plist = tempfile.mkstemp(prefix='gate-paths-', suffix='.bin')
        with os.fdopen(fd, 'wb') as fh:
            fh.write(b'\0'.join(paths))
        try:
            env = dict(os.environ, VP_RUN_NONCE=nonce, VP_RUN_PATHS=plist)
            r = subprocess.run(['bash', REMOTE_RUN, root, '-j', str(jobs)] + ['tools/' + s for s in suites],
                               capture_output=True, text=True, env=env)
        finally:
            os.remove(plist)
        print('\n'.join('    ' + l for l in (r.stdout or '').strip().splitlines()[-(len(suites) + 3):]))
        m = re.findall(r'^results: (\S+\.jsonl)$', r.stdout or '', re.M)
        if not m:
            return {}
        return read_results(m[-1], root)
    return run


def host_key_fingerprint():
    r = subprocess.run(['ssh-keygen', '-F', HOST, '-l'], capture_output=True, text=True)
    fps = re.findall(r'(SHA256:\S+)', r.stdout or '')
    return fps[-1] if fps else ''


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    cmd = argv[0] if argv else ''
    if cmd == 'init-key':
        good, text = init_key()
        print('  gate key: ' + text)
        return 0 if good else 1
    if cmd == 'check':
        covered, why = accepted(ROOT)
        print('  gate record: %s: %s' % ('ACCEPTED' if covered else 'not used', why))
        return 0 if covered else 1
    if cmd == 'run':
        key, why = read_key()
        if key is None:
            print('  gate record: not run: ' + why)
            return 1
        if not os.path.isfile(REMOTE_RUN):
            print('  gate record: not run: %s is not on this Mac' % REMOTE_RUN)
            return 1
        good, text, rec = make_record(ROOT, remote_runner(ROOT), key, host='vp-tests-1 ' + HOST, host_key=host_key_fingerprint())
        if good:
            text += '; written to ' + write_record(rec)
        print('  gate record: ' + text)
        return 0 if good else 1
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
