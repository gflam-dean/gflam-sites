#!/usr/bin/env python3
"""THE GATE LINE FOR "TEST MATCHES LIVE", OFFLINE (INBOX 357B / 326, 13 Nov 2026). Runs check-schema-gate.py in a temp tree built from
the fixtures. Network off. Checks: OFF (and says so) with no STAGING-ON; ON and no snapshot, an old snapshot, a future
one, an unreadable one, a snapshot that differs, a swapped (live-marked) one: all FAIL with words; a matching fresh one
passes, against the baselines and against a fresh live snapshot; a stale live snapshot is ignored (baselines used); and
release-check.py really calls it, as its own line.

Run: python3 tools/staging/check-schema-gate.test.py      Ends on "ALL N CHECKS PASSED".
"""
import copy, importlib.util, json, os, shutil, socket, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FX = os.path.join(HERE, 'fixtures')
spec = importlib.util.spec_from_file_location('csg', os.path.join(HERE, 'check-schema-gate.py'))
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)
RAN, BAD = [0], [0]


def show(name, cond, saw=None):
    RAN[0] += 1
    if cond:
        print('  ok   ' + name)
    else:
        BAD[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: %s' % (str(saw)[:220],)))


def no_network(*a, **k):
    raise AssertionError('the test tried the network')
socket.socket.connect = no_network
socket.create_connection = no_network


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def put(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


NOW = 1_800_000_000.0
tmp = tempfile.mkdtemp(prefix='schema-gate-')
try:
    root = os.path.join(tmp, 'tree')
    sup = os.path.join(root, 'venueplay-backend', 'supabase')
    put(os.path.join(sup, 'RLS-BASELINE.json'), read(os.path.join(FX, 'rls-baseline.json')))
    put(os.path.join(sup, 'COLUMNS-BASELINE.json'), read(os.path.join(FX, 'columns-baseline.json')))
    snap = os.path.join(tmp, 'test-snapshot.json')
    livesnap = os.path.join(tmp, 'live-snapshot.json')
    flag = os.path.join(root, 'tools', 'staging', 'STAGING-ON')

    def go(**kw):
        lines = []
        kw.setdefault('snapshot', snap)
        kw.setdefault('live_snapshot', livesnap)
        code = G.run(root=root, now=NOW, out=lines.append, **kw)
        return code, ' | '.join(lines)

    def age(path, hours):
        os.utime(path, (NOW - hours * 3600, NOW - hours * 3600))

    code, msg = go()
    show('no STAGING-ON: passes and says it is OFF', code == 0 and msg.startswith('OFF:'), msg)
    put(flag, 'on 14 Nov 2026\n')
    code, msg = go()
    show('STAGING-ON and no snapshot: FAIL, with the command to take one', code == 1 and 'no test snapshot' in msg and 'schema-snapshot.sql' in msg, msg)
    shutil.copy(os.path.join(FX, 'test-snapshot.json'), snap)
    age(snap, 2)
    code, msg = go()
    show('a fresh matching snapshot passes against the repo baselines', code == 0 and msg.startswith('MATCH against the repo baselines'), msg)
    age(snap, 30)
    code, msg = go()
    show('a snapshot over 24 hours old FAILS', code == 1 and 'hours old' in msg, msg)
    age(snap, -5)
    code, msg = go()
    show('a snapshot dated in the future FAILS', code == 1 and 'hours old' in msg, msg)
    age(snap, 2)
    put(snap, 'not json {')
    age(snap, 2)
    code, msg = go()
    show('an unreadable snapshot FAILS', code == 1, msg)
    d = json.loads(read(os.path.join(FX, 'test-snapshot.json')))
    d2 = copy.deepcopy(d)
    first = sorted(d2['columns'])[0]
    d2['columns'][first] = d2['columns'][first][:-1]
    put(snap, json.dumps(d2))
    age(snap, 2)
    code, msg = go()
    show('a test database missing a column FAILS and says it does not match', code == 1 and 'does NOT match' in msg, msg)
    d3 = copy.deepcopy(d)
    del d3['policies'][sorted(d3['policies'])[0]]
    put(snap, json.dumps(d3))
    age(snap, 2)
    code, msg = go()
    show('a test database missing a policy FAILS', code == 1 and 'does NOT match' in msg, msg)
    live_marked = json.loads(read(os.path.join(FX, 'live-snapshot.json')))
    put(snap, json.dumps(live_marked))
    age(snap, 2)
    code, msg = go()
    show('a LIVE-marked snapshot given as the test one FAILS (swapped files)', code == 1, msg)
    shutil.copy(os.path.join(FX, 'test-snapshot.json'), snap)
    age(snap, 2)
    shutil.copy(os.path.join(FX, 'live-snapshot.json'), livesnap)
    age(livesnap, 3)
    code, msg = go()
    show('with a fresh live snapshot too, the full comparison runs against it', code == 0 and 'against a live snapshot' in msg, msg)
    age(livesnap, 40)
    code, msg = go()
    show('a stale live snapshot is ignored (the baselines are used)', code == 0 and 'against the repo baselines' in msg, msg)
    shutil.copy(os.path.join(FX, 'live-snapshot.json'), livesnap)
    age(livesnap, 3)
    dl = json.loads(read(os.path.join(FX, 'live-snapshot.json')))
    k0 = list(dl['functions'])[0] if dl.get('functions') else None
    if k0:
        dl['functions'][k0] = 'changed'
        put(livesnap, json.dumps(dl))
        age(livesnap, 3)
        code, msg = go()
        show('a difference in a part only the live snapshot has (functions) FAILS', code == 1, msg)
    else:
        show('the fixture has functions to change', False)
    rc = read(os.path.join(REPO, 'tools', 'release-check.py'))
    show('release-check.py calls check-schema-gate.py as its own line', "os.path.join(ROOT, 'tools', 'staging', 'check-schema-gate.py')" in rc and "[sys.executable, _sg, '--root', ROOT]" in rc and 'The TEST database matches live' in rc)
    show('the real tree has no STAGING-ON yet (so the real gate says OFF until main commits it)', not os.path.exists(os.path.join(REPO, 'tools', 'staging', 'STAGING-ON')))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

if BAD[0]:
    print('\nFAILED %d of %d' % (BAD[0], RAN[0]))
    sys.exit(1)
print('\nALL %d CHECKS PASSED' % RAN[0])
