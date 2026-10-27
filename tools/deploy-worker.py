#!/usr/bin/env python3
"""Deploy a Worker file to a named Cloudflare Worker over the API. No dashboard, no paste.

    python3 tools/deploy-worker.py venueplay-game-sydney venueplay-backend/worker/venueplay-game.js
    python3 tools/deploy-worker.py --live venueplay-game venueplay-backend/worker/venueplay-game.js
    python3 tools/deploy-worker.py --live --full-gate venueplay-game venueplay-backend/worker/venueplay-game.js
    python3 tools/deploy-worker.py --gate-only venueplay-game venueplay-backend/worker/venueplay-game.js
    python3 tools/deploy-worker.py --list

THE GATE IT RUNS (27 Oct 2026). A LIVE deploy runs the FAST gate for the file: parse, definitions,
the game Worker's guards and regulated-code check, every suite whose source names the file (Chrome
ones under /tmp/vp-heavy.lock with one retry on a quiet machine), and live signing. It prints the
gate-labels checks on the file that only the FULL gate judges, and the full gate still runs after
the deploy (release.py step 5). --full-gate runs the whole local gate first instead, as before.
--gate-only runs the fast gate and stops: no credentials, nothing uploaded. The last line is always
EXIT n: 0 deployed and proved, 1 nothing uploaded (red gate or refused), 2 uploaded but /health has
not confirmed, 3 the heavy lock is held by another live run.

What it does, in order, and it stops at the first thing that is wrong:
  1. Reads CF_API_TOKEN and CF_ACCOUNT_ID from ~/.gflam-migrate.env (mode 600, outside
     the repo). Never prints either.
  2. Refuses a file whose BUILD stamp does not match its own contents (run
     tools/stamp-workers.py first), because /health would then report a build that is not
     the one running, and that is the one number every check trusts.
  3. Refuses a LIVE Worker (one a venue is on) unless --live is given, and refuses the
     wrong file for a slot by name: venueplay-game.js only goes to a Worker whose name
     starts venueplay-game, and so on. On 31 Aug the game Worker was pasted into the
     billing slot and nobody could sign up until it was noticed. Not again.
  4. Uploads the file, KEEPING every variable, secret and binding the Worker already has
     (Cloudflare's keep_bindings). Variables are set in the dashboard; this only ships code.
  5. Waits until the Worker's own /health answers with the file's build stamp, and says so.
     "It uploaded" is not evidence; /health answering with the right build is.

The token can only edit Workers (the "Edit Cloudflare Workers" template): no DNS, no
billing, no Pages.

--do-class=VenueRoom (added 9 Sep 2026 for the room server, see
venueplay-backend/worker/ROOM-SERVER.md; NOT YET EXERCISED against the API): binds a
Durable Object class the file exports as env.ROOM. The first time the class is seen on
that Worker the upload carries a new_sqlite_classes migration; every time after, the
existing binding is simply kept, because Cloudflare rejects a "new class" migration for
a class that already exists. Needs the Workers Paid plan for anything beyond 100k
requests a day. Staging first, always.
"""
import io, json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path

ENV_FILE = Path.home() / '.gflam-migrate.env'
REPO = Path(__file__).resolve().parents[1]
API = 'https://api.cloudflare.com/client/v4'
HEALTH_HOST = '{name}.dean-tindale.workers.dev'

# A venue is on these. Anything else is staging and may be deployed freely.
LIVE = {'venueplay-game', 'venueplay-api', 'partyplay-api', 'touring-api', 'venueplay-sms', 'drag-bingo-music'}
# Which file belongs in which slot. The slot name must START with the key.
SLOT_OF_FILE = {
    'venueplay-game.js':            'venueplay-game',
    'venueplay-api-FULL.js':        'venueplay-api',
    'DEPLOY-partyplay-api.js':      'partyplay-api',
    'touring-api.js':               'touring-api',
    # The file is named DEPLOY-touring-api.js, so the line above never matched it and the
    # touring Worker could only be pasted. Added 19 Oct 2026.
    'DEPLOY-touring-api.js':        'touring-api',
    'venueplay-sms-hook.js':        'venueplay-sms',
}
NEVER_PASTE = {'venueplay-api.js', 'SOURCE-do-not-paste-partyplay-api.js'}   # stubs and sources

sys.path.insert(0, str(REPO / 'tools'))
from stamp_workers import fingerprint, STAMP   # the same hash the gate and /health use

def die(msg):
    print('STOP: ' + msg)
    print('EXIT 1 (nothing was uploaded)')
    sys.exit(1)

def creds():
    if not ENV_FILE.exists(): die(f'{ENV_FILE} is missing')
    if oct(ENV_FILE.stat().st_mode)[-3:] != '600': die(f'{ENV_FILE} must be mode 600')
    e = {}
    for line in ENV_FILE.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    tok, acct = e.get('CF_API_TOKEN', ''), e.get('CF_ACCOUNT_ID', '')
    if not tok.startswith('cfut_') and not re.fullmatch(r'[A-Za-z0-9_-]{30,}', tok): die('CF_API_TOKEN is not set in the env file')
    if not re.fullmatch(r'[0-9a-f]{32}', acct): die('CF_ACCOUNT_ID is not set (32 hex characters) in the env file')
    return tok, acct

def cf(tok, method, path, body=None, content_type=None):
    req = urllib.request.Request(API + path, data=body, method=method, headers={'Authorization': 'Bearer ' + tok})
    if content_type: req.add_header('Content-Type', content_type)
    try:
        r = urllib.request.urlopen(req, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read())
        except Exception: return x.code, {'errors': [{'message': 'unreadable error body'}]}

def errors(d):
    return '; '.join(str(m.get('message')) for m in d.get('errors', [])) or 'unknown error'

def list_workers(tok, acct):
    st, d = cf(tok, 'GET', f'/accounts/{acct}/workers/scripts')
    if st != 200: die('could not list Workers: ' + errors(d))
    for s in sorted(d['result'], key=lambda s: s['id']):
        name = s['id']
        health = fetch_health(name)
        print(f"  {'LIVE   ' if name in LIVE else 'staging'}  {name:<24} {health}")

def fetch_health(name):
    req = urllib.request.Request(f'https://{HEALTH_HOST.format(name=name)}/health', headers={'User-Agent': 'venueplay-deploy/1.0'})
    try:
        r = urllib.request.urlopen(req, timeout=15); d = json.loads(r.read())
        return f"build {d.get('build', '?')}" + ('' if d.get('ok') else f"  NOT OK missing={d.get('missing')}")
    except urllib.error.HTTPError as x:
        return f'/health answered {x.code}'
    except Exception as x:
        return f'/health unreachable ({type(x).__name__})'

DO_BINDING = 'ROOM'   # the name the Worker reads: env.ROOM

def upload(tok, acct, name, path, do_class=None):
    src = path.read_text()
    m = STAMP.search(src)
    if not m: die(f'{path.name} has no BUILD stamp line; run tools/stamp-workers.py')
    stamped, actual = m.group(1), fingerprint(src)
    if stamped != actual: die(f'{path.name} is stamped {stamped} but hashes to {actual}; run tools/stamp-workers.py')
    if do_class and not re.search(r'^export\s+class\s+' + re.escape(do_class) + r'\b', src, re.M):
        die(f'{path.name} does not "export class {do_class}"; a Durable Object binding to it would fail at upload')
    # current settings: keep the compatibility date and confirm the bindings we are keeping
    st, d = cf(tok, 'GET', f'/accounts/{acct}/workers/scripts/{name}/settings')
    if st != 200: die(f'could not read settings of {name}: ' + errors(d))
    cur = d['result']
    kept = [(b['type'], b['name']) for b in cur.get('bindings', [])]
    print(f"  keeping {len(kept)} binding(s): " + ', '.join(n for _, n in kept))
    meta = {
        'main_module': 'worker.js',
        'compatibility_date': cur.get('compatibility_date') or '2026-01-01',
        'compatibility_flags': cur.get('compatibility_flags') or [],
        'keep_bindings': sorted({t for t, _ in kept} | {'secret_text', 'plain_text', 'kv_namespace'}),
    }
    if do_class:
        have = [b for b in cur.get('bindings', []) if b.get('type') == 'durable_object_namespace' and b.get('class_name') == do_class]
        if have:
            print(f'  Durable Object {do_class} already bound as {have[0].get("name")}; keeping it')
        else:
            # First time: the class must be created by a migration in the same upload, and the
            # binding is sent explicitly (keep_bindings only keeps what already exists).
            meta['migrations'] = {'new_sqlite_classes': [do_class]}
            meta['bindings'] = [{'type': 'durable_object_namespace', 'name': DO_BINDING, 'class_name': do_class}]
            print(f'  first deploy of Durable Object {do_class}: creating it and binding it as {DO_BINDING}')
    boundary = 'vp' + str(int(time.time() * 1000))
    body = io.BytesIO()
    def part(fieldname, filename, ctype, data):
        body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{fieldname}"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode())
        body.write(data); body.write(b'\r\n')
    part('metadata', 'metadata.json', 'application/json', json.dumps(meta).encode())
    part('worker.js', 'worker.js', 'application/javascript+module', src.encode())
    body.write(f'--{boundary}--\r\n'.encode())
    st, d = cf(tok, 'PUT', f'/accounts/{acct}/workers/scripts/{name}', body.getvalue(), f'multipart/form-data; boundary={boundary}')
    if st != 200: die(f'upload to {name} failed ({st}): ' + errors(d))
    print(f'  uploaded {path.name} ({len(src):,} bytes) to {name}')
    # after: bindings still there?
    st, d = cf(tok, 'GET', f'/accounts/{acct}/workers/scripts/{name}/settings')
    after = [(b['type'], b['name']) for b in d.get('result', {}).get('bindings', [])] if st == 200 else []
    lost = sorted(set(kept) - set(after))
    if lost: die(f'bindings LOST in the upload: {lost}. Re-add them in the dashboard before anything else.')
    return stamped

def wait_for_build(name, stamp, seconds=90):
    t0 = time.time()
    while time.time() - t0 < seconds:
        h = fetch_health(name)
        if stamp in h and 'NOT OK' not in h:
            print(f'  /health on {name}: {h}  ({time.time() - t0:.0f}s)'); return True
        time.sleep(3)
    print(f'  /health on {name} after {seconds}s: {h}'); return False

sys.path.insert(0, str(REPO / 'tools'))
import gatelib          # the shared-Mac rules: heavy lock, process-group suite runs, Chrome-only retry


# A deploy file is built from a source the suites name instead: DEPLOY-partyplay-api.js is the
# SOURCE plus its libraries pasted in (build-worker.py), so a suite on the SOURCE is a suite on
# the deploy. The FULL billing Worker is what the stub's name refers to in older suites.
ALSO_NAMED = {
    'DEPLOY-partyplay-api.js': ['SOURCE-do-not-paste-partyplay-api.js', 'partyplay-api.js', 'pp-licence.js'],
    'DEPLOY-touring-api.js': ['touring-api.js'],
    'venueplay-api-FULL.js': ['venueplay-api.js'],
}


def suites_naming(fname, slot):
    """Every suite in the repo whose source names this Worker file (or the source it is built
    from, see ALSO_NAMED). Chrome suites included: a rig that drives the real Worker through a
    pipe names its file too."""
    import glob
    names = [fname] + ALSO_NAMED.get(fname, [])
    found = []
    for pat in ('**/*.test.js', '**/*.test.py', 'tools/test-*.js'):
        for f in glob.glob(str(REPO / pat), recursive=True):
            rel = os.path.relpath(f, REPO)
            if rel.startswith('.') or '/node_modules/' in rel or '/.claude/' in rel or 'worktrees' in rel:
                continue
            if os.path.basename(rel) in ('purge-closed-player-data.test.py',    # live, by hand only
                                         'gate-reliability.test.py'):           # tests this tool, names every Worker
                continue
            try:
                src = io.open(f, encoding='utf-8', errors='replace').read()
            except Exception:
                continue
            if any(n in src for n in names):
                found.append(rel)
    return sorted(set(found))


def _release_check():
    """release-check.py as a module (as release.py loads it), for its parse and judgement helpers."""
    import importlib.util
    try:
        spec = importlib.util.spec_from_file_location('rc', str(REPO / 'tools' / 'release-check.py'))
        rc = importlib.util.module_from_spec(spec)
        saved = sys.argv; sys.argv = ['release-check.py', '--local', '--skip-chrome']
        try:
            spec.loader.exec_module(rc)
        finally:
            sys.argv = saved
        return rc
    except Exception:
        return None


def labels_naming(fname):
    """The gate-labels.json checks that name this file: what the FULL gate will judge after the
    deploy. Printed so the fast path never reads as if it had covered them."""
    try:
        labels = json.load(io.open(REPO / 'tools' / 'gate-labels.json', encoding='utf-8')).get('labels', [])
    except Exception:
        return []
    return [l for l in labels if fname in l]


def fast_gate(name, path, skip_live=False):
    """THE FAST PATH FOR A WORKER DEPLOY (27 Oct 2026). Returns the list of red lines (empty = green).

    The full local gate is 348 checks and ten minutes of Chrome, and a Worker deploy used to run all
    of it, after the pre-push hook had just run all of it, to upload one file. Two deploys in a row
    were then refused by one Chrome layout reading each, in suites that never load a Worker. So a
    deploy now runs what can judge THIS file:
      1. it parses, under the same jsc the gate uses
      2. nothing in it calls a function that does not exist (check-defs.py)
      3. for the game Worker: every host route keeps its staff check and draws use crypto
         (check-worker-guards.py), and the regulated bingo code matches its manifest (regulated.py)
      4. every suite in the repo whose source names this file, jsc and Chrome alike, Chrome under the
         heavy lock with the flake retry
      5. every active venue still enforces broadcast signing (live, skipped only under --gate-only
         with VP_SKIP_LIVE=1, which is what the tool's own test uses)
    and then prints, by name, the gate-labels checks on this file that the FULL gate still judges
    after the deploy (release.py step 5 runs it; so must anyone deploying by hand)."""
    import subprocess
    red = []
    tools = REPO / 'tools'
    t0 = time.time()

    def line(label, good, detail=''):
        print('  %s %s %s' % ('ok  ' if good else 'FAIL', label, detail))
        if not good:
            red.append('FAIL %s %s' % (label, detail))

    # The same parse the gate does (release-check.parses, through its unexport), imported rather
    # than copied, so the two cannot drift.
    rc = _release_check()
    src = io.open(path, encoding='utf-8').read()
    good, msg = rc.parses(rc.unexport(src)) if rc else (False, 'release-check.py would not load')
    line('%s parses' % path.name, good, (msg or '')[:120])

    checker = REPO / 'partyplay-backend' / 'check-defs.py'
    if checker.is_file():
        r = subprocess.run([sys.executable, str(checker), str(path)], capture_output=True, text=True, cwd=REPO)
        out = (r.stdout + r.stderr).strip().splitlines()
        line('nothing in %s calls a function that does not exist' % path.name, r.returncode == 0, out[-1][:120] if out else '')
    else:
        line('check-defs.py is here', False, 'partyplay-backend/check-defs.py is missing')

    if path.name == 'venueplay-game.js':
        for tool, label in (('check-worker-guards.py', 'every host route keeps its staff check, draws use crypto, big reads are paged'),
                            ('regulated.py', 'the regulated bingo code (VP-DRAW) matches its manifest and version')):
            t = tools / tool
            args = [sys.executable, str(t)] + (['--check'] if tool == 'regulated.py' else [])
            r = subprocess.run(args, capture_output=True, text=True, cwd=REPO, timeout=180)
            out = re.sub(r'\x1b\[[0-9;]*m', '', (r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            line(label, r.returncode == 0 and not bad, ('; '.join(bad[:2]) if bad else (out.splitlines() or [''])[-1])[:120])

    suites = suites_naming(path.name, name.split('-sydney')[0])
    chrome = [s for s in suites if gatelib.uses_chrome(str(REPO / s))]
    print('  %d suite(s) name %s (%d in Chrome)' % (len(suites), path.name, len(chrome)))
    if chrome and not gatelib.hold_lock_or_refuse('deploy-worker', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0'))):
        line('the heavy lock is free for the Chrome suites', False, 'another live run holds /tmp/vp-heavy.lock')
        return red
    for s in suites:
        is_chrome = s in chrome
        cmd = [sys.executable, str(REPO / s)] if s.endswith('.py') else [gatelib.JSC, str(REPO / s)]

        def _passed(rr):
            # The gate's rule for the tools/test-*.js suites as well (release-check.py section D: exit 0,
            # "PASS" printed, no FAIL line). They print "PASS 27 checks", which _suite_passed does not know,
            # so on 28 Oct 2026 this fast gate called 13 green suites red and refused a deploy the full gate
            # had passed. A FAIL line or a non-zero exit is still red either way.
            if rr.rc != 0:
                return False
            if _suite_passed(rr.last):
                return True
            text = re.sub(r'\x1b\[[0-9;]*m', '', rr.out or '')
            return (rr.last or '').strip().startswith('PASS') and not any(
                l.strip().startswith('FAIL') for l in text.splitlines())
        rr, flake = gatelib.run_suite_with_retry(cmd, os.path.basename(s), _passed, cwd=str(REPO),
                                                 timeout=900 if is_chrome else 300, chrome=is_chrome,
                                                 say=lambda x: print('  ' + x))
        line(os.path.basename(s), _passed(rr), '%s (%.0fs%s)' % (rr.last[:90], rr.seconds,
             ', passed on retry' if flake and flake['outcome'] == 'passed on retry' else ''))
        if rr.leaked:
            line('%s left no headless Chrome behind' % os.path.basename(s), False, '%d killed' % len(rr.leaked))

    if skip_live:
        print('  note signing and health skipped (VP_SKIP_LIVE=1, the tool\'s own test)')
    else:
        r = subprocess.run([sys.executable, str(tools / 'check-signing-enforced.py')], capture_output=True, text=True, cwd=REPO, timeout=60)
        out = (r.stdout + r.stderr).strip().splitlines()
        line('every active venue enforces broadcast signing', r.returncode == 0, (out or [''])[0][:120])

    deferred = labels_naming(path.name)
    print('  fast gate: %d line(s) in %.0fs. %s' % (len(red) + 0, time.time() - t0, gatelib.flake_summary_line()))
    print('  THE FULL GATE STILL RUNS AFTER THE DEPLOY (release.py step 5, or python3 tools/release-check.py by hand).')
    if deferred:
        print('  It judges these on %s, which this fast path did not: %s' % (path.name, '; '.join(deferred)))
    return red


def _suite_passed(line):
    """The gate's own rule (release-check.suite_passed): ALL n CHECKS PASSED, or "n of n checks passed"."""
    line = (line or '').strip()
    if 'ALL' in line and 'PASSED' in line:
        return True
    m = re.match(r'^(\d+) of (\d+) checks? passed', line)
    return bool(m) and m.group(1) == m.group(2) and int(m.group(1)) > 0


def gate_or_die(flags, name, path):
    """A LIVE WORKER DOES NOT GO UP OVER A RED GATE.

    This tool used to say "add --live if you mean it, after the gate is green" and then upload
    whatever it was handed. It never ran the gate, so "after the gate is green" was a sentence,
    not a rule, and a careless hand (or a model in a hurry) could put an untested Worker in
    front of a paying venue with one command. Found by audit, 20 Sep 2026.

    Since 27 Oct 2026 it runs the FAST gate for the file (fast_gate above) by default, and the
    whole local gate with --full-gate, the old behaviour. Either way a red line means nothing is
    uploaded and the exit code is 1: on 27 Oct a refused deploy was read as a success by a
    script that trusted the exit code, so the code is now printed on the last line as well.

    --emergency="why" skips it, for the one case that needs it: rolling back a bad deploy while
    the gate is red for some unrelated reason. It is loud, and the reason is printed, so it is a
    decision somebody made and not a habit."""
    why = [f.split('=', 1)[1] for f in flags if f.startswith('--emergency=')]
    if why:
        if len(why[0].strip()) < 12: die('--emergency needs a real reason in words, for whoever reads this later')
        print('  GATE SKIPPED, EMERGENCY: ' + why[0].strip())
        return
    import subprocess
    here = Path(__file__).resolve().parent
    if '--full-gate' not in flags:
        print('  running the FAST gate for %s (the full gate runs after the deploy) ...' % path.name)
        red = fast_gate(name, path, skip_live=os.environ.get('VP_SKIP_LIVE') == '1')
        if red:
            print('  THE GATE IS RED, so nothing was uploaded:')
            for l in red[:6]: print('    ' + l[:150])
            print('EXIT 1 (red gate, nothing uploaded)')
            sys.exit(1)
        print('  fast gate green')
        return
    print('  running the full local gate first (several minutes, Chrome included) ...')
    if not gatelib.hold_lock_or_refuse('deploy-worker', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0'))):
        print('EXIT 3 (heavy lock held by another live run, nothing uploaded)')
        sys.exit(3)
    r = subprocess.run([sys.executable, str(here / 'release-check.py'), '--local'], capture_output=True, text=True)
    out = re.sub(r'\x1b\[[0-9;]*m', '', (r.stdout or '') + (r.stderr or ''))
    fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
    real = [l for l in fails if 'is running the current code' not in l]
    ran = re.search(r'(\d+) checks in total|All (\d+) checks passed', out)
    flakes = [l for l in out.splitlines() if l.startswith('FLAKES:')]
    if flakes: print('  ' + flakes[-1][:200])
    if not ran:
        print('EXIT 1 (the gate did not finish, nothing uploaded)')
        die('the gate did not finish, so nothing was uploaded. Run python3 tools/release-check.py --local and read it.')
    if real:
        print('  THE GATE IS RED, so nothing was uploaded:')
        for l in real[:6]: print('    ' + l[:150])
        print('EXIT 1 (red gate, nothing uploaded)')
        sys.exit(1)
    print('  gate green (%s checks)' % (ran.group(1) or ran.group(2)))


def main():
    """Exit codes, printed on the last line as EXIT n so a tee'd log still shows them:
         0  deployed and proved by /health (or --gate-only and the gate is green)
         1  refused, red gate, or anything else that means NOTHING WAS UPLOADED
         2  uploaded, but /health has not confirmed the build
         3  the heavy lock is held by another live run; nothing was uploaded

       --gate-only <worker> <file>   run the fast gate for that file and stop: no credentials, no upload.
       --full-gate                   the whole local gate instead of the fast one (the old behaviour)."""
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    gate_only = '--gate-only' in flags
    tok = acct = None
    if not gate_only:
        tok, acct = creds()
    if '--list' in flags or not args:
        if gate_only: die('--gate-only needs <worker name> <file>')
        print('Workers in the account (build per /health):'); list_workers(tok, acct); return
    if len(args) != 2: die('usage: deploy-worker.py [--live] [--full-gate] [--gate-only] <worker name> <file>')
    name, path = args[0], (REPO / args[1]).resolve() if not Path(args[1]).is_absolute() else Path(args[1])
    if not path.exists(): die(f'{path} does not exist')
    if path.name in NEVER_PASTE: die(f'{path.name} is a stub or a source file, never deployed. See the CLAUDE.md deploy rules.')
    slot = SLOT_OF_FILE.get(path.name)
    if not slot: die(f'{path.name} is not a Worker file this tool knows ({", ".join(SLOT_OF_FILE)})')
    if not name.startswith(slot): die(f'{path.name} belongs in a Worker named {slot}*, not {name}')
    if name in LIVE and '--live' not in flags and not gate_only: die(f'{name} is LIVE (a venue is on it). Add --live if you mean it, after the gate is green.')
    do_class = None
    for f in flags:
        if f.startswith('--do-class='):
            do_class = f.split('=', 1)[1]
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', do_class): die(f'--do-class needs a class name, got {do_class!r}')
    unknown = flags - {'--live', '--list', '--full-gate', '--gate-only'} - {f for f in flags if f.startswith('--do-class=') or f.startswith('--emergency=')}
    if unknown: die('unknown flag(s): ' + ', '.join(sorted(unknown)))
    print(f"DEPLOY {path.name} -> {name}{'  (LIVE)' if name in LIVE else '  (staging)'}{'  (GATE ONLY, no upload)' if gate_only else ''}")
    if name in LIVE or gate_only:
        gate_or_die(flags, name, path)
    if gate_only:
        print('GATE ONLY: green. Nothing was uploaded, on purpose.')
        print('EXIT 0 (gate only)')
        sys.exit(0)
    print(f'  before: {fetch_health(name)}')
    stamp = upload(tok, acct, name, path, do_class)
    ok = wait_for_build(name, stamp)
    print('DEPLOYED and proved by /health' if ok else 'UPLOADED but /health has not confirmed the build; do not trust it yet')
    print('  THE FULL GATE STILL RUNS AFTER THE DEPLOY: release.py step 5 does it; by hand, python3 tools/release-check.py')
    print('EXIT %d' % (0 if ok else 2))
    sys.exit(0 if ok else 2)

if __name__ == '__main__':
    main()
