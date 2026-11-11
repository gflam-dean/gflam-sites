#!/usr/bin/env python3
"""THE SERVER GATE RECORD CANNOT BE FORGED, STRETCHED OR SHORTENED. GATELIB_NO_CHROME.

    python3 tools/gate-server.test.py

No network, no Chrome, no real key. A throwaway git repo is built in a temp folder with copies of the real
tools/gate-server.py, gatelib.py and release-check.py (read for its suite_passed, never run), three fake Chrome
suites (one of them signin-logo, which stays on the Mac), one plain suite and a ledger. A FAKE RUNNER stands in for
vp-tests-1. Two throwaway keys are made in the temp folder; the real ~/.gflam-gate.env is never read.

  1. the writer     a green run is signed and accepted; signin-logo is never sent and never covered; a dirty tree
                    is refused; a tree that moves during the run is not signed; a red suite is not signed
  2. flakes         red at -j 4 then 3 green lone re-runs: signed, all four runs kept; a red lone re-run: not signed;
                    a signed record with only 2 lone re-runs: refused
  3. every bypass   (each refused, so the gate runs that suite on the Mac): no key, a key others can read, no
                    record, an empty file, not JSON, unsigned, a zeroed signature, a tampered count, a tampered suite
                    list, a tampered time, signed with a different key, another tree (a real commit, and a record
                    renamed to it), stale (25 h), dated in the future, a missing suite, red, a FAIL line, a last
                    line that is not a pass, fewer checks than the ledger, a total where the ledger counts lines,
                    a suite not in the ledger, wrong version; a message-only amend keeps the same files: accepted
  4. wiring         release-check.py skips only what the record covers, never with --skip-chrome, finds Chrome suites
                    the way gate-server does; the ledger skips only named Chrome suites; no environment variable can
                    move the key, the records or the runner; the real hook runs --chrome-record and still refuses red
  5. the runner     remote_runner reads the server's result file (last line and the ledger's own count)
  6. the fence      the real repository has not moved
"""
import importlib.util, io, json, os, re, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
PASS, FAIL = [0], [0]
ENV = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
ENV.update(GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('ok  ' if good else 'FAIL', label, ('  (%s)' % (str(detail)[:200],)) if detail and not good else ''))


def git(repo, *a):
    return subprocess.run(['git'] + list(a), cwd=repo, env=ENV, capture_output=True, text=True)


def put(path, text, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, 'w', encoding='utf-8').write(text)
    if mode is not None:
        os.chmod(path, mode)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


real_before = (git(ROOT, 'rev-parse', 'HEAD').stdout.strip(), git(ROOT, 'status', '--porcelain').stdout)
TMP = tempfile.mkdtemp(prefix='gate-server-test-')
try:
    repo = os.path.join(TMP, 'repo')
    os.makedirs(os.path.join(repo, 'tools'))
    git(repo, 'init', '-q')
    ok('the throwaway gitdir is inside the temp folder',
       os.path.realpath(git(repo, 'rev-parse', '--absolute-git-dir').stdout.strip()).startswith(os.path.realpath(TMP)))
    for f in ('gate-server.py', 'gatelib.py', 'release-check.py'):
        shutil.copy(os.path.join(TOOLS, f), os.path.join(repo, 'tools', f))
    CHROME = ['alpha-in-chrome.test.py', 'bravo-in-chrome.test.py', 'signin-logo-in-chrome.test.py']
    for c in CHROME:
        put(os.path.join(repo, 'tools', c), '# drives tools/browser-rig\nprint("ALL 5 CHECKS PASSED")\n')
    put(os.path.join(repo, 'tools', 'plain.test.py'), 'print("ALL 2 CHECKS PASSED")\n')
    counts = {'tools/' + c: {'checks': 5, 'counted_by': 'lines'} for c in CHROME}
    counts['tools/plain.test.py'] = {'checks': 2, 'counted_by': 'lines'}
    put(os.path.join(repo, 'tools', 'suite-counts.json'), json.dumps(counts, indent=1))
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>one</html>\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'one')
    gs = load('gate_server_t', os.path.join(repo, 'tools', 'gate-server.py'))
    key_file = os.path.join(TMP, 'gate.env')
    other_key_file = os.path.join(TMP, 'other.env')
    rec_dir = os.path.join(TMP, 'records')
    ok('init-key makes a key file, mode 600, and prints nothing of the key',
       gs.init_key(key_file)[0] and (os.stat(key_file).st_mode & 0o777) == 0o600
       and re.search(r'[0-9a-f]{64}', gs.init_key(key_file)[1]) is None)
    gs.init_key(other_key_file)
    KEY, _ = gs.read_key(key_file)
    OTHER, _ = gs.read_key(other_key_file)
    ok('two different throwaway keys', KEY and OTHER and KEY != OTHER)

    GREEN = {'rc': 0, 'last': 'ALL 5 CHECKS PASSED', 'checks': 5, 'counted_by': 'lines', 'bad': [], 'seconds': 1.0}
    sent = []

    def runner_from(script):
        """script: {suite: [entry for call 1, call 2, ...]}; default green."""
        calls = {}

        def run(suites, jobs):
            sent.append((list(suites), jobs))
            out = {}
            for s in suites:
                i = calls.get(s, 0)
                calls[s] = i + 1
                seq = script.get(s) or [GREEN]
                out[s] = dict(seq[min(i, len(seq) - 1)])
            return out
        return run

    def acc(now=None, kf=key_file):
        return gs.accepted(repo, now=now, key_file=kf, record_dir=rec_dir)

    print('\n1. the writer')
    ok('chrome_suites finds the three Chrome suites and not the plain one', gs.chrome_suites(repo) == sorted(CHROME), gs.chrome_suites(repo))
    good, text, rec = gs.make_record(repo, runner_from({}), KEY, say=lambda s: None)
    ok('a green run is signed', good and rec and rec.get('sig'), text)
    ok('signin-logo was never sent to the server', all('signin-logo-in-chrome.test.py' not in s for s, j in sent) and sent[0][1] == 4, sent)
    ok('the record lists the two server suites with their counts', sorted(rec['suites']) == CHROME[:2] and rec['suites'][CHROME[0]]['checks'] == 5)
    ok('the record names the tree it judged', rec['tree'] == git(repo, 'rev-parse', 'HEAD^{tree}').stdout.strip())
    path = gs.write_record(rec, rec_dir)
    ok('the record file is mode 600 in its own folder', (os.stat(path).st_mode & 0o777) == 0o600 and os.path.basename(path) == rec['tree'] + '.json')
    covered, why = acc()
    ok('accepted: covers the two server suites', covered == set(CHROME[:2]), why)
    ok('... and never signin-logo, which the Mac runs', 'signin-logo-in-chrome.test.py' not in covered and 'on the Mac: signin-logo' in why, why)
    signed_good = io.open(path, encoding='utf-8').read()

    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>dirty</html>\n')
    good, text, _ = gs.make_record(repo, runner_from({}), KEY, say=lambda s: None)
    ok('a dirty checkout is not run, so not signed', not good and 'dirty' in text, text)
    ok('a dirty checkout accepts no record', acc()[0] == set() and 'dirty' in acc()[1])
    git(repo, 'checkout', '-q', '--', 'venueplay/index.html')

    def moving_runner(suites, jobs):
        put(os.path.join(repo, 'venueplay', 'index.html'), '<html>moved</html>\n')
        git(repo, 'commit', '-qam', 'moved during the run')
        return {s: dict(GREEN) for s in suites}
    base_head = git(repo, 'rev-parse', 'HEAD').stdout.strip()
    good, text, _ = gs.make_record(repo, moving_runner, KEY, say=lambda s: None)
    ok('the checkout changed while the suites ran: not signed', not good and 'changed while' in text, text)
    git(repo, 'reset', '-q', '--hard', base_head)

    red = dict(GREEN, rc=1, last='4 of 5 checks passed', bad=['FAIL the logo'])
    good, text, _ = gs.make_record(repo, runner_from({CHROME[0]: [red]}), KEY, say=lambda s: None)
    ok('a suite red at -j 4 and red alone: not signed, named', not good and CHROME[0] in text, text)

    print('\n2. flakes: red at -j 4 is green only after 3 green lone re-runs')
    sent[:] = []
    good, text, frec = gs.make_record(repo, runner_from({CHROME[1]: [red, GREEN, GREEN, GREEN]}), KEY, say=lambda s: None)
    ok('red once, then 3 green lone re-runs: signed', good, text)
    ok('... the 3 lone re-runs ran one at a time, and only for that suite', [x for x in sent if x[1] == 1] == [([CHROME[1]], 1)] * 3, sent)
    ok('... and all four runs are in the record', frec and frec['suites'][CHROME[1]]['rc'] == 1 and len(frec['suites'][CHROME[1]]['reruns']) == 3)
    good, text, _ = gs.make_record(repo, runner_from({CHROME[1]: [red, GREEN, red, GREEN]}), KEY, say=lambda s: None)
    ok('red once, then a red lone re-run: not signed', not good, text)
    two = json.loads(json.dumps(frec))
    two['suites'][CHROME[1]]['reruns'] = two['suites'][CHROME[1]]['reruns'][:2]
    two = gs.sign(two, KEY)
    gs.write_record(two, rec_dir)
    ok('a signed record with only 2 lone re-runs: refused', acc()[0] == set() and '2 of 3 lone re-runs' in acc()[1], acc()[1])
    gs.write_record(frec, rec_dir)
    c, w = acc()
    ok('the flake record is accepted and says which suite needed the re-runs', c == set(CHROME[:2]) and 'lone re-runs: ' + CHROME[1] in w, w)

    print('\n3. every bypass is refused (the gate then runs the suite on the Mac)')

    def refused(label, raw, want, now=None, kf=key_file):
        io.open(path, 'w', encoding='utf-8').write(raw)
        c, w = acc(now=now, kf=kf)
        ok(label, c == set() and want in w, w)

    def resigned(edit, key=KEY):
        r = json.loads(signed_good)
        edit(r)
        return json.dumps(gs.sign(r, key))

    def edited(edit):
        r = json.loads(signed_good)
        edit(r)
        return json.dumps(r)

    io.open(path, 'w', encoding='utf-8').write(signed_good)
    ok('(the good record is accepted again before the bypasses)', acc()[0] == set(CHROME[:2]))
    ok('no key file: refused', acc(kf=os.path.join(TMP, 'none.env'))[0] == set() and 'no signing key' in acc(kf=os.path.join(TMP, 'none.env'))[1])
    os.chmod(key_file, 0o644)
    ok('a key file others can read: refused', acc()[0] == set() and 'read by others' in acc()[1], acc()[1])
    os.chmod(key_file, 0o600)
    os.remove(path)
    ok('no record for this tree: refused', acc()[0] == set() and 'no gate record' in acc()[1], acc()[1])
    refused('an empty record file: refused', '', 'empty file')
    refused('a record that is not JSON: refused', '{"tree": ', 'not readable JSON')
    refused('a JSON list, not a record: refused', '[]', 'not a record')
    refused('unsigned (no sig): refused', edited(lambda r: r.pop('sig')), 'not signed')
    refused('a zeroed signature: refused', edited(lambda r: r.update(sig='0' * 64)), 'does not match')
    refused('a tampered count (5 -> 50): refused', edited(lambda r: r['suites'][CHROME[0]].update(checks=50)), 'edited after it was signed')
    refused('a tampered suite list (one removed): refused', edited(lambda r: r['suites'].pop(CHROME[1])), 'edited after it was signed')
    refused('a tampered suite result (red made green): refused',
            edited(lambda r: r['suites'][CHROME[0]].update(rc=0, last='ALL 9 CHECKS PASSED')), 'edited after it was signed')
    refused('a tampered time (made fresh): refused', edited(lambda r: r.update(time=time.time())), 'edited after it was signed')
    refused('a tampered tree: refused', edited(lambda r: r.update(tree='f' * 40)), 'edited after it was signed')
    refused('signed with a different key: refused', resigned(lambda r: None, OTHER), 'different key')
    refused('signed with a different key, key id copied across: refused',
            edited(lambda r: r.update(sig=gs.sign(json.loads(signed_good), OTHER)['sig'])), 'does not match')
    refused('stale (25 h old): refused', resigned(lambda r: r.update(time=time.time() - 25 * 3600)), 'over the 24 h limit')
    refused('dated in the future: refused', resigned(lambda r: r.update(time=time.time() + 3600)), 'future')
    refused('a missing suite (validly signed, one left out): refused', resigned(lambda r: r['suites'].pop(CHROME[1])), 'does not cover 1 Chrome suite')
    refused('a red suite (validly signed): refused', resigned(lambda r: r['suites'][CHROME[0]].update(rc=1)), 'exit 1')
    refused('a FAIL line (validly signed): refused', resigned(lambda r: r['suites'][CHROME[0]].update(bad=['FAIL x'])), 'FAIL line')
    refused('a last line that is not a pass (validly signed): refused',
            resigned(lambda r: r['suites'][CHROME[0]].update(last='PASS: 19 passed')), 'last line is not a pass')
    refused('"4 of 5 checks passed" (validly signed): refused', resigned(lambda r: r['suites'][CHROME[0]].update(last='4 of 5 checks passed')), 'not a pass')
    refused('fewer checks than the ledger (validly signed): refused', resigned(lambda r: r['suites'][CHROME[0]].update(checks=4)), 'the ledger says 5')
    refused('a total where the ledger counts lines (validly signed): refused',
            resigned(lambda r: r['suites'][CHROME[0]].update(counted_by='total')), 'only a total')
    refused('no checks counted (validly signed): refused', resigned(lambda r: r['suites'][CHROME[0]].update(checks=0)), 'no checks counted')
    refused('a wrong version (validly signed): refused', resigned(lambda r: r.update(v=0)), 'version')
    refused('suites not a mapping (validly signed): refused', resigned(lambda r: r.update(suites=[])), 'lists no suites')
    refused('a record of the right shape for a different tree (validly signed, renamed to this tree): refused',
            resigned(lambda r: r.update(tree='e' * 40)), 'is for tree eeeeeeeeeeee')
    io.open(path, 'w', encoding='utf-8').write(signed_good)
    git(repo, 'commit', '-q', '--amend', '-m', 'one, reworded')
    ok('a commit-message-only amend keeps the same files, so the same tree: accepted', acc()[0] == set(CHROME[:2]), acc()[1])
    put(os.path.join(repo, 'venueplay', 'index.html'), '<html>two</html>\n')
    git(repo, 'commit', '-qam', 'two')
    ok('another tree (a real commit): no record for it, refused', acc()[0] == set() and 'no gate record' in acc()[1], acc()[1])
    tree2 = git(repo, 'rev-parse', 'HEAD^{tree}').stdout.strip()
    shutil.copy(path, gs.record_path(tree2, rec_dir))
    ok('the old tree\'s record copied to the new tree\'s name: refused', acc()[0] == set() and 'is for tree' in acc()[1], acc()[1])
    put(os.path.join(repo, 'tools', 'charlie-in-chrome.test.py'), '# drives tools/browser-rig\n')
    counts['tools/charlie-in-chrome.test.py'] = {'checks': 5, 'counted_by': 'lines'}
    put(os.path.join(repo, 'tools', 'suite-counts.json'), json.dumps(counts, indent=1))
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'a new Chrome suite')
    tree3 = git(repo, 'rev-parse', 'HEAD^{tree}').stdout.strip()
    gs.write_record(gs.sign(dict(json.loads(signed_good), tree=tree3), KEY), rec_dir)
    ok('a new Chrome suite the record never ran (validly signed for this tree): refused',
       acc()[0] == set() and 'charlie-in-chrome.test.py' in acc()[1], acc()[1])
    nl = json.loads(signed_good)
    nl['tree'] = tree3
    nl['suites']['charlie-in-chrome.test.py'] = dict(GREEN)
    counts.pop('tools/charlie-in-chrome.test.py')
    put(os.path.join(repo, 'tools', 'suite-counts.json'), json.dumps(counts, indent=1))
    git(repo, 'commit', '-qam', 'ledger without charlie')
    nl['tree'] = git(repo, 'rev-parse', 'HEAD^{tree}').stdout.strip()
    gs.write_record(gs.sign(nl, KEY), rec_dir)
    ok('a suite not in tools/suite-counts.json (validly signed): refused', acc()[0] == set() and 'not in tools/suite-counts.json' in acc()[1], acc()[1])
    covered, why = gs.verify(None, 'a' * 40, KEY, time.time(), CHROME, counts, lambda l: True)
    ok('verify() with no record at all covers nothing', covered == set())
    ok('no partial acceptance: one bad suite and the record covers NONE',
       gs.verify(resigned(lambda r: r['suites'][CHROME[0]].update(rc=1)), json.loads(signed_good)['tree'], KEY, time.time(),
                 CHROME, counts, gs.suite_passed_rule(repo))[0] == set())

    print('\n4. wiring')
    rc_src = io.open(os.path.join(TOOLS, 'release-check.py'), encoding='utf-8').read()
    gs_src = io.open(os.path.join(TOOLS, 'gate-server.py'), encoding='utf-8').read()
    led_src = io.open(os.path.join(TOOLS, 'check-suite-ledger.py'), encoding='utf-8').read()
    hook_src = io.open(os.path.join(TOOLS, 'hooks', 'pre-push'), encoding='utf-8').read()
    ok('release-check: --chrome-record never applies with --skip-chrome',
       "CHROME_RECORD = '--chrome-record' in sys.argv and not SKIP_CHROME" in rc_src)
    ok('release-check: the covered set comes from gate-server.accepted(ROOT) and nowhere else',
       rc_src.count('_CHROME_COVERED, _CHROME_RECORD_WHY = _gs.accepted(ROOT)') == 1
       and len(re.findall(r'_CHROME_COVERED\s*(?:=|\.add|\.update|\|=)', rc_src)) == 0
       and rc_src.count('_CHROME_COVERED, _CHROME_RECORD_WHY = set()') == 2)
    ok('release-check: a Chrome suite is left out only if it is IN the covered set, and is still listed as skipped',
       "        if chrome and f in _CHROME_COVERED:\n            _CHROME_SKIPPED.add(os.path.abspath(p))" in rc_src)
    ok('release-check: the gate finds Chrome suites the way gate-server does (tools/*.test.py, gatelib.uses_chrome)',
       "if not f.endswith('.test.py'):" in rc_src and 'chrome = gatelib.uses_chrome(p)' in rc_src
       and "f.endswith('.test.py') and gl.uses_chrome(os.path.join(tools, f))" in gs_src)
    real_list = load('gate_server_real', os.path.join(TOOLS, 'gate-server.py')).chrome_suites(ROOT)
    sys.path.insert(0, TOOLS)
    import gatelib as _gl
    ok('on this tree both find the same Chrome suites (%d)' % len(real_list),
       real_list == sorted(f for f in os.listdir(TOOLS) if f.endswith('.test.py') and _gl.uses_chrome(os.path.join(TOOLS, f))) and len(real_list) > 50)
    ok('release-check: the ledger is told only the covered suites', "(['--judged-elsewhere', _elsewhere] if _CHROME_COVERED else [])" in rc_src)
    ok('the ledger leaves out only NAMED CHROME suites, and lists them as skipped',
       "elsewhere = [s for s in suites if s in named and gatelib.uses_chrome(os.path.join(ROOT, s))]" in led_src
       and 'skipped = skipped + elsewhere' in led_src)
    ok('the gate rules are the gate\'s own: suite_passed is read from release-check.py, not copied',
       "_fn_from(os.path.join(root, 'tools', 'release-check.py'), 'suite_passed'" in gs_src and 'def suite_passed(' not in gs_src)
    ok('no environment variable can move the key, the records or the runner',
       not re.search(r'environ\.get|getenv|environ\[', gs_src) and "KEY_FILE = os.path.expanduser('~/.gflam-gate.env')" in gs_src)
    ok('signin-logo-in-chrome stays on the Mac', "MAC_ONLY = ('signin-logo-in-chrome.test.py',)" in gs_src)
    ok('the age limit is 24 hours and the lone re-runs are 3', 'MAX_AGE_S = 24 * 60 * 60' in gs_src and 'LONE_RERUNS = 3' in gs_src)
    ok('the signature is compared in constant time', 'hmac.compare_digest(' in gs_src)

    # The REAL hook, run the way git runs it, in the throwaway, with a fake gate that writes down its arguments.
    hrepo = os.path.join(TMP, 'hookrepo')
    os.makedirs(os.path.join(hrepo, 'tools', 'hooks'))
    git(hrepo, 'init', '-q')
    shutil.copy(os.path.join(TOOLS, 'hooks', 'pre-push'), os.path.join(hrepo, 'tools', 'hooks', 'pre-push'))
    put(os.path.join(hrepo, 'tools', 'stamp-workers.py'), 'import sys; sys.exit(0)\n')
    put(os.path.join(hrepo, 'tools', 'release-check.py'),
        'import os, sys\nhere = os.path.dirname(os.path.abspath(__file__))\n'
        'open(os.path.join(here, "ARGS"), "w").write(" ".join(sys.argv[1:]))\n'
        'sys.exit(1 if os.path.exists(os.path.join(here, "RED")) else 0)\n')
    put(os.path.join(hrepo, '.gitignore'), 'tools/ARGS\ntools/RED\n')
    git(hrepo, 'add', '-A'); git(hrepo, 'commit', '-qm', 'h')
    henv = dict(ENV)
    henv.pop('VP_GATE_SERVER', None)
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=henv, capture_output=True, text=True)
    args = io.open(os.path.join(hrepo, 'tools', 'ARGS')).read() if os.path.exists(os.path.join(hrepo, 'tools', 'ARGS')) else ''
    ok('the real hook runs release-check.py --local --chrome-record, and a green gate lets the push go', r.returncode == 0 and args == '--local --chrome-record', (r.returncode, args, r.stdout[-200:]))
    put(os.path.join(hrepo, 'tools', 'RED'), '')
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=henv, capture_output=True, text=True)
    ok('a red gate still refuses the push, record or none', r.returncode == 1 and 'PUSH REFUSED' in r.stdout, r.stdout[-200:])
    ok('the hook runs the server only when asked (VP_GATE_SERVER=1) and never fails the push on it',
       '[ "${VP_GATE_SERVER:-}" = "1" ]' in hook_src and 'gate-server.py" run || echo' in hook_src)

    print('\n5. the runner reads the server\'s own result file')
    res = os.path.join(TMP, 'res.jsonl')
    put(res, json.dumps({'suite': 'tools/' + CHROME[0], 'rc': 0, 'seconds': 3, 'summary': 'x', 'last': 'ALL 5 CHECKS PASSED',
                         'judge': [0, 5, [], 'lines']}) + '\n' + json.dumps({'suite': 'tools/' + CHROME[1], 'rc': 0, 'last': 'ALL 5 CHECKS PASSED'})
        + '\n' + json.dumps({'wall': 1, 'jobs': 4}) + '\n')
    fake = os.path.join(TMP, 'fake-remote-run.sh')
    put(fake, '#!/bin/bash\necho "synced"\necho "results: %s"\n' % res, 0o755)
    gs.REMOTE_RUN = fake
    got = gs.remote_runner(repo)(CHROME[:2], 4)
    ok('a suite the server counted the ledger way comes back with its last line and count',
       got.get(CHROME[0], {}).get('checks') == 5 and got[CHROME[0]]['last'] == 'ALL 5 CHECKS PASSED' and got[CHROME[0]]['counted_by'] == 'lines', got)
    ok('a suite the server did NOT count comes back red (no checks, a reason), never green',
       got.get(CHROME[1], {}).get('checks') == 0 and got[CHROME[1]]['bad'], got.get(CHROME[1]))
    put(fake, '#!/bin/bash\necho "rsync failed"\nexit 2\n', 0o755)
    ok('no result file: nothing comes back, so nothing can be signed', gs.remote_runner(repo)(CHROME[:2], 4) == {})

    print('\n6. the fence')
    ok('the real repository\'s HEAD and status did not move',
       (git(ROOT, 'rev-parse', 'HEAD').stdout.strip(), git(ROOT, 'status', '--porcelain').stdout) == real_before)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
if FAIL[0]:
    print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
    sys.exit(1)
print('ALL %d CHECKS PASSED' % PASS[0])
