#!/usr/bin/env python3
"""THE SERVER GATE RECORD CANNOT BE FORGED, STRETCHED OR SHORTENED. GATELIB_NO_CHROME.

    python3 tools/gate-server.test.py

No network, no Chrome, no real key. A throwaway git repo is built in a temp folder with copies of the real
tools/gate-server.py, gatelib.py, release-check.py (read for its suite_passed, never run) and passwording.py (the judge it asks), three fake Chrome
suites (one of them signin-logo, which stays on the Mac), one plain suite and a ledger. A FAKE RUNNER stands in for
vp-tests-1. Two throwaway keys are made in the temp folder; the real ~/.gflam-gate.env is never read.

  1. the writer     a green run is signed and accepted; signin-logo is never sent and never covered; a dirty tree
                    is refused; a tree that moves during the run is not signed; a red suite is not signed
  2. no retries     (13 Nov 2026, INBOX 357A) the server runs each suite ONCE: one red and nothing is signed, the
                    runner is called once; a signed record that carries re-runs is refused
  2b. binding       results not tied to THIS request and THESE files are never signed: no run facts, another nonce,
                    a server manifest that is not this tree's (at the start or at the end), files missing on the server
  3. every bypass   (each refused, so the gate runs that suite on the Mac): no key, a key others can read, no
                    record, an empty file, not JSON, unsigned, a zeroed signature, a tampered count, a tampered suite
                    list, a tampered time, signed with a different key, another tree (a real commit, and a record
                    renamed to it), stale (2 h, and 3 h; 1 h 59 is fine), dated in the future, a missing suite, red, a FAIL line, a last
                    line that is not a pass, fewer checks than the ledger, a total where the ledger counts lines,
                    a suite not in the ledger, wrong version; a message-only amend keeps the same files: accepted
  4. wiring         release-check.py skips only what the record covers, never with --skip-chrome, finds Chrome suites
                    the way gate-server does; the ledger skips only named Chrome suites; no environment variable can
                    move the key, the records or the runner; the real hook runs --chrome-record and still refuses red
  5. the runner     remote_runner reads the server's result file and judges the RAW output on the Mac (the server's
                    own count and verdict are never used); no output, or a cut one, is red; the run facts come back
  5b. release.py    step 0b runs gate-server.py run unless VP_GATE_SERVER=0, and never stops the release
  6. the fence      the real repository has not moved
"""
import glob, hashlib, importlib.util, io, json, os, re, shutil, subprocess, sys, tempfile, time

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
    for f in ('gate-server.py', 'gatelib.py', 'release-check.py', 'passwording.py'):
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

    GREEN = {'rc': 0, 'last': 'ALL 5 CHECKS PASSED', 'checks': 5, 'counted_by': 'lines', 'bad': [], 'seconds': 1.0,
             'verdict': [True, 'ALL N CHECKS PASSED']}
    sent = []

    def honest_run(nonce, paths):
        """What an honest server says about the files it was sent: it hashes the repo's own files."""
        h = hashlib.sha256()
        for pth in sorted(paths):
            data = io.open(os.path.join(repo, pth.decode()), 'rb').read()
            h.update(hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest().encode() + b' ' + pth + b'\n')
        return {'nonce': nonce, 'manifest_start': h.hexdigest(), 'manifest_end': h.hexdigest(), 'missing': [], 'missing_n': 0, 'wall': 1}

    def runner_from(script, run_edit=None):
        """script: {suite: [entry for call 1, call 2, ...]}; default green. run_edit(run facts) plays a lying server."""
        calls = {}

        def run(suites, jobs, nonce, paths):
            sent.append((list(suites), jobs))
            out = {}
            for s in suites:
                i = calls.get(s, 0)
                calls[s] = i + 1
                seq = script.get(s) or [GREEN]
                out[s] = dict(seq[min(i, len(seq) - 1)])
            facts = honest_run(nonce, paths)
            if run_edit:
                facts = run_edit(facts)
            if facts is not None:
                out[gs.RUN_KEY] = facts
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

    def moving_runner(suites, jobs, nonce, paths):
        out = {s: dict(GREEN) for s in suites}
        out[gs.RUN_KEY] = honest_run(nonce, paths)
        put(os.path.join(repo, 'venueplay', 'index.html'), '<html>moved</html>\n')
        git(repo, 'commit', '-qam', 'moved during the run')
        return out
    base_head = git(repo, 'rev-parse', 'HEAD').stdout.strip()
    good, text, _ = gs.make_record(repo, moving_runner, KEY, say=lambda s: None)
    ok('the checkout changed while the suites ran: not signed', not good and 'changed while' in text, text)
    git(repo, 'reset', '-q', '--hard', base_head)

    red = dict(GREEN, rc=1, last='4 of 5 checks passed', bad=['FAIL the logo'], verdict=[False, 'exit 1'])
    good, text, _ = gs.make_record(repo, runner_from({CHROME[0]: [red]}), KEY, say=lambda s: None)
    ok('a suite red at -j 4: not signed, named by the red rule itself', not good and 'red on the server: ' + CHROME[0] in text, text)
    ok('... and a record that fails its own check is never signed either (the second lock behind the first)',
       "return False, 'NOT SIGNED: the record would not pass its own check: ' + why, None" in io.open(os.path.join(TOOLS, 'gate-server.py'), encoding='utf-8').read())

    print('\n2. no retries: one red on the server and nothing is signed')
    sent[:] = []
    good, text, _ = gs.make_record(repo, runner_from({CHROME[1]: [red, GREEN, GREEN, GREEN]}), KEY, say=lambda s: None)
    ok('red once (it would have been green alone): NOT signed', not good and 'red on the server: ' + CHROME[1] in text, text)
    ok('... and the server was asked exactly once, 4 at a time, never a lone re-run', sent == [(CHROME[:2], 4)], sent)
    green_only = dict(GREEN)
    green_only.pop('verdict')
    good, text, _ = gs.make_record(repo, runner_from({CHROME[0]: [green_only]}), KEY, say=lambda s: None)
    ok('a suite the one pass judge never read on the Mac: not signed', not good and CHROME[0] in text, text)
    good, text, _ = gs.make_record(repo, runner_from({CHROME[0]: [dict(GREEN, verdict=[False, 'two-line PASS pair'])]}), KEY, say=lambda s: None)
    ok('a suite the one pass judge refuses (exit 0, last line fine): not signed', not good and CHROME[0] in text, text)
    good, text, _ = gs.make_record(repo, runner_from({CHROME[0]: [dict(GREEN, reruns=[])]}), KEY, say=lambda s: None)
    ok('a server entry that carries re-runs: not signed', not good, text)

    print('\n2b. binding: results not tied to this request and these files are never signed')
    good, text, _ = gs.make_record(repo, runner_from({}, lambda f: None), KEY, say=lambda s: None)
    ok('no run facts from the server: not signed', not good and 'no run facts' in text, text)
    good, text, _ = gs.make_record(repo, runner_from({}, lambda f: dict(f, nonce='0' * 32)), KEY, say=lambda s: None)
    ok('another request\'s nonce (an old results file): not signed', not good and 'another request' in text, text)
    good, text, _ = gs.make_record(repo, runner_from({}, lambda f: dict(f, manifest_start='a' * 64, manifest_end='a' * 64)), KEY, say=lambda s: None)
    ok('the server ran other files (TREE MISMATCH on the server): not signed', not good and 'are not this tree' in text, text)
    good, text, _ = gs.make_record(repo, runner_from({}, lambda f: dict(f, manifest_end='b' * 64)), KEY, say=lambda s: None)
    ok('the files on the server changed while the suites ran: not signed', not good and 'changed while the suites ran' in text, text)
    good, text, _ = gs.make_record(repo, runner_from({}, lambda f: dict(f, missing=['venueplay/index.html'], missing_n=1)), KEY, say=lambda s: None)
    ok('a file of the tree missing on the server: not signed', not good and 'missing 1 file' in text, text)
    dg, pl = gs.manifest(repo)
    ok('the manifest lists every committed file and leaves out what remote-run.sh leaves out',
       b'venueplay/index.html' in pl and b'tools/gate-server.py' in pl and not gs.synced('a/.env') and not gs.synced('x/y.pem')
       and not gs.synced('venueplay-backend/data/archive/x.json') and not gs.synced('tools/flake-log.jsonl')
       and gs.synced('venueplay/environment.html') and not gs.synced('node_modules/a.js'), len(pl))
    good, text, rec2 = gs.make_record(repo, runner_from({}), KEY, say=lambda s: None)
    ok('an honest server: signed, and the record carries the manifest the server measured', good and rec2['manifest'] == dg, text)

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
    refused('stale (25 h old): refused', resigned(lambda r: r.update(time=time.time() - 25 * 3600)), 'over the 2 h limit')
    refused('STALE (3 h old, the old 24 h rule would have taken it): refused', resigned(lambda r: r.update(time=time.time() - 3 * 3600)), 'over the 2 h limit')
    refused('stale at exactly 2 h: refused', resigned(lambda r: r.update(time=time.time() - 2 * 3600 - 1)), 'over the 2 h limit')
    io.open(path, 'w', encoding='utf-8').write(resigned(lambda r: r.update(time=time.time() - 119 * 60)))
    ok('1 h 59 min old: still accepted', acc()[0] == set(CHROME[:2]), acc()[1])
    refused('a validly signed record carrying re-runs (the old rule): refused',
            resigned(lambda r: r['suites'][CHROME[1]].update(reruns=[dict(GREEN)] * 3)), 'never retries')
    refused('a validly signed suite with no verdict from the one pass judge: refused',
            resigned(lambda r: r['suites'][CHROME[0]].pop('verdict')), 'never read its output')
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
    ok('the age limit is 2 hours and there are no lone re-runs', 'MAX_AGE_S = 2 * 60 * 60' in gs_src and 'LONE_RERUNS' not in gs_src)
    ok('the record version is 2 (a v1 record, 24 h with lone re-runs, is refused)', 'VERSION = 2' in gs_src)
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
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=henv, capture_output=True, text=True, input='')
    args = io.open(os.path.join(hrepo, 'tools', 'ARGS')).read() if os.path.exists(os.path.join(hrepo, 'tools', 'ARGS')) else ''
    ok('the real hook runs release-check.py --local --chrome-record, and a green gate lets the push go', r.returncode == 0 and args == '--local --chrome-record', (r.returncode, args, r.stdout[-200:]))
    put(os.path.join(hrepo, 'tools', 'RED'), '')
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=henv, capture_output=True, text=True, input='')
    ok('a red gate still refuses the push, record or none', r.returncode == 1 and 'PUSH REFUSED' in r.stdout, r.stdout[-200:])
    os.remove(os.path.join(hrepo, 'tools', 'RED'))
    hhead = git(hrepo, 'rev-parse', 'HEAD').stdout.strip()
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=henv, capture_output=True, text=True,
                       input='refs/heads/x %s refs/heads/main %s\n' % (hhead, '0' * 40))
    args = io.open(os.path.join(hrepo, 'tools', 'ARGS')).read()
    ok('pushing THIS checkout\'s commit: the record may be used', r.returncode == 0 and args == '--local --chrome-record', (args, r.stdout[-200:]))
    put(os.path.join(hrepo, 'venueplay.txt'), 'other\n')
    git(hrepo, 'add', '-A'); git(hrepo, 'commit', '-qm', 'other')
    other = git(hrepo, 'rev-parse', 'HEAD').stdout.strip()
    git(hrepo, 'reset', '-q', '--hard', 'HEAD~1')
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=henv, capture_output=True, text=True,
                       input='refs/heads/x %s refs/heads/main %s\n' % (other, '0' * 40))
    args = io.open(os.path.join(hrepo, 'tools', 'ARGS')).read()
    ok('pushing a commit whose files are NOT this checkout\'s: no record, every Chrome suite on the Mac',
       r.returncode == 0 and args.strip() == '--local' and 'no server record is used' in r.stdout, (args, r.stdout[-300:]))
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=henv, capture_output=True, text=True,
                       input='refs/heads/x %s refs/heads/gone %s\n' % ('0' * 40, hhead))
    ok('a branch delete in the push does not count as other files', io.open(os.path.join(hrepo, 'tools', 'ARGS')).read() == '--local --chrome-record')
    os.remove(os.path.join(hrepo, 'tools', 'ARGS'))
    denv = dict(henv, VP_HOOK_DRY_RUN='1')
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=denv, capture_output=True, text=True,
                       input='refs/heads/x %s refs/heads/main %s\n' % (hhead, '0' * 40))
    ok('VP_HOOK_DRY_RUN=1 REFUSES the push and runs no gate (it can never let one through)',
       r.returncode == 1 and 'DRY RUN' in r.stdout and 'PUSH REFUSED' in r.stdout
       and not os.path.exists(os.path.join(hrepo, 'tools', 'ARGS')), (r.returncode, r.stdout[-300:]))
    r = subprocess.run(['bash', os.path.join(hrepo, 'tools', 'hooks', 'pre-push')], cwd=hrepo, env=denv, capture_output=True, text=True,
                       input='refs/heads/x %s refs/heads/main %s\n' % (other, '0' * 40))
    ok('... and for other files says the record is not used, still refusing',
       r.returncode == 1 and 'not this checkout' in r.stdout and 'DRY RUN' in r.stdout, r.stdout[-300:])
    ok('the hook runs the server only when asked (VP_GATE_SERVER=1) and never fails the push on it',
       '[ "${VP_GATE_SERVER:-}" = "1" ]' in hook_src and 'gate-server.py" run || echo' in hook_src)

    print('\n5. the runner: the Mac judges the server\'s RAW output itself')
    shutil.copy(os.path.join(TOOLS, 'check-suite-ledger.py'), os.path.join(repo, 'tools', 'check-suite-ledger.py'))
    res = os.path.join(TMP, 'res.jsonl')
    good_out = 'ok one\nok two\nok three\nok four\nok five\nALL 5 CHECKS PASSED\n'
    run_line = {'run': {'nonce': 'ab' * 16, 'manifest_start': 'c' * 64, 'manifest_end': 'c' * 64, 'missing': [], 'missing_n': 0}}
    lines = [run_line,
             {'suite': 'tools/' + CHROME[0], 'rc': 0, 'seconds': 3, 'last': 'ALL 5 CHECKS PASSED', 'out': good_out,
              'judge': [0, 5, [], 'lines'], 'passed': True},
             # a server that SAYS green and counted 5, over output with a FAIL line and 4 oks
             {'suite': 'tools/' + CHROME[1], 'rc': 0, 'last': 'ALL 5 CHECKS PASSED', 'judge': [0, 5, [], 'lines'], 'passed': True,
              'out': 'ok one\nok two\nFAIL three\nok four\nok five\nALL 5 CHECKS PASSED\n'},
             {'suite': 'tools/charlie-in-chrome.test.py', 'rc': 0, 'last': 'ALL 5 CHECKS PASSED', 'judge': [0, 5, [], 'lines'], 'passed': True},
             {'suite': 'tools/delta-in-chrome.test.py', 'rc': 0, 'last': 'ALL 5 CHECKS PASSED', 'judge': [0, 5, [], 'lines'], 'passed': True,
              'out': good_out, 'out_truncated': True},
             {'wall': 1, 'jobs': 4}]
    put(res, ''.join(json.dumps(l) + '\n' for l in lines))
    fake = os.path.join(TMP, 'fake-remote-run.sh')
    seen_env = os.path.join(TMP, 'seen-env')
    put(fake, '#!/bin/bash\necho "$VP_RUN_NONCE $(tr \'\\0\' \'\\n\' < "$VP_RUN_PATHS" | wc -l)" > %s\necho "synced"\necho "results: %s"\n' % (seen_env, res), 0o755)
    gs.REMOTE_RUN = fake
    got = gs.remote_runner(repo)(CHROME[:2] + ['charlie-in-chrome.test.py', 'delta-in-chrome.test.py'], 4, 'ab' * 16, [b'a', b'b', b'c'])
    g0 = got.get(CHROME[0], {})
    ok('a green suite: counted on the Mac from its raw output, the one pass judge says green',
       g0.get('checks') == 5 and g0.get('last') == 'ALL 5 CHECKS PASSED' and g0.get('counted_by') == 'lines' and g0.get('verdict', [0])[0] is True, g0)
    g1 = got.get(CHROME[1], {})
    ok('a server that claims green over output with a FAIL line: the Mac sees the FAIL and the real count (4)',
       g1.get('checks') == 4 and g1.get('bad') and gs.suite_green(g1, {'checks': 5, 'counted_by': 'lines'}, gs.suite_passed_rule(repo)), g1)
    ok('a suite with no raw output: red, never green',
       got.get('charlie-in-chrome.test.py', {}).get('verdict', [True])[0] is False and got['charlie-in-chrome.test.py']['bad'])
    ok('a suite whose output was cut: red, never green', got.get('delta-in-chrome.test.py', {}).get('verdict', [True])[0] is False)
    ok('the run facts come back for the binding check', got.get(gs.RUN_KEY, {}).get('nonce') == 'ab' * 16)
    ok('the runner hands remote-run.sh the nonce and the path list (then deletes the list)',
       io.open(seen_env).read().split()[0] == 'ab' * 16 and not glob.glob(os.path.join(tempfile.gettempdir(), 'gate-paths-*.bin')), io.open(seen_env).read())
    put(fake, '#!/bin/bash\necho "rsync failed"\nexit 2\n', 0o755)
    ok('no result file (server unreachable): nothing comes back, so nothing can be signed', gs.remote_runner(repo)(CHROME[:2], 4, 'ab' * 16, []) == {})

    print('\n5b. release.py step 0b')
    rel = load('release_t', os.path.join(TOOLS, 'release.py'))
    calls = []

    class R:
        def __init__(self, rc): self.returncode = rc
    out = rel.server_gate(ROOT, env={'VP_GATE_SERVER': '0'}, run=lambda *a, **k: calls.append(a) or R(0))
    ok('VP_GATE_SERVER=0: the server is not run, and it says the Mac runs every Chrome suite', calls == [] and 'Mac' in out[0], out)
    out = rel.server_gate(ROOT, env={}, run=lambda *a, **k: calls.append(a[0]) or R(0))
    ok('on by default: it runs tools/gate-server.py run', calls and calls[-1][1:] == ['tools/gate-server.py', 'run'], calls)
    out = rel.server_gate(ROOT, env={}, run=lambda *a, **k: R(1))
    ok('a red, refused or unreachable server run does not stop the release: the hook runs the Mac', 'no record' in out[0] and 'Mac' in out[0], out)
    rel_src = io.open(os.path.join(TOOLS, 'release.py'), encoding='utf-8').read()
    ok('step 0b comes before the push, and nothing in it can stop the release',
       rel_src.index("step('0b'") < rel_src.index("step(1, 'push") and 'stop(' not in rel_src[rel_src.index('def server_gate('):rel_src.index('def _rn(')])

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
