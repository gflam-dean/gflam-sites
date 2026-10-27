#!/usr/bin/env python3
"""THE REGULATED BINGO CODE CANNOT CHANGE SILENTLY: tools/regulated.py, run against copies of the real files.

Every way a regulated change could slip through is made here, in a throwaway folder holding copies of the two
VP-DRAW halves, venueplay-game.js and the manifest, and regulated.py must catch each one. The real files are
never touched. Run from the repo root:  python3 tools/regulated.test.py
"""
import importlib.util, io, json, os, re, shutil, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('regulated', os.path.join(ROOT, 'tools', 'regulated.py'))
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    if not cond: bad += 1

def fresh():
    d = tempfile.mkdtemp(prefix='regulated-')
    for rel in R.FILES + [R.GAME, R.MANIFEST]:
        os.makedirs(os.path.join(d, os.path.dirname(rel)), exist_ok=True)
        shutil.copyfile(os.path.join(ROOT, rel), os.path.join(d, rel))
    return d
def edit(d, rel, old, new):
    p = os.path.join(d, rel); t = io.open(p, encoding='utf-8', newline='').read()
    assert t.count(old) == 1, (rel, old, t.count(old))
    io.open(p, 'w', encoding='utf-8', newline='').write(t.replace(old, new))
def manifest(d): return json.loads(io.open(os.path.join(d, R.MANIFEST), encoding='utf-8').read())
def update(d):
    try: R.update(d); return ''
    except SystemExit as e: return str(e)

CUR = R.worker_version(io.open(os.path.join(ROOT, R.WORKER_MODULE), encoding='utf-8').read())
NXT = CUR + '-next'
def bump(d):
    edit(d, R.WORKER_MODULE, "const VP_DRAW_VERSION = '%s';" % CUR, "const VP_DRAW_VERSION = '%s';" % NXT)
    edit(d, R.CONSOLE_MODULE, 'var VERSION = "%s";' % CUR, 'var VERSION = "%s";' % NXT)
real = R.check(ROOT)
ok('the repo as committed is clean: both halves match the manifest, the copy and the /health hash', real == [], real)
base = manifest(fresh())

d = fresh(); edit(d, R.WORKER_MODULE, "  return x % max;", "  return (x + 1) % max;")
p = R.check(d, base)
ok('a one-character change to the server half, nothing else: refused (the file no longer matches the manifest)', any('changed without the manifest' in x for x in p), p)
ok('and the Worker copy no longer matches it either', any('copy inside venueplay-game.js differs' in x for x in p), p)
why = update(d)
ok('--update refuses to bless it while the version is unchanged', 'REFUSED' in why and 'version' in why, why)

d = fresh(); edit(d, R.CONSOLE_MODULE, "return pool.splice(k,1)[0];", "return pool.splice(0,1)[0];")
ok('a change to the tablet half alone: refused', any('venueplay/app/vp-draw.js changed without the manifest' in x for x in R.check(d, base)))

d = fresh(); edit(d, R.GAME, "function generateStrip() {", "function generateStrip() {\n  // edited in the copy")
p = R.check(d, base)
ok('an edit to the copy inside venueplay-game.js, the module untouched: refused', any('copy inside venueplay-game.js differs' in x for x in p), p)

d = fresh(); edit(d, R.WORKER_MODULE, "const TABLET_FALLBACK_OFF_STATES = new Set([]);", "const TABLET_FALLBACK_OFF_STATES = new Set(['QLD']);")
bump(d)
why = update(d)
ok('switching Queensland off in the server half only: --update refuses (the halves must agree)', 'REFUSED' in why and 'switch' in why, why)
edit(d, R.CONSOLE_MODULE, "var TABLET_FALLBACK_OFF_STATES = [];", "var TABLET_FALLBACK_OFF_STATES = ['QLD'];")
why = update(d)
ok('a new version with no reason on the record: --update refuses', 'REFUSED' in why and 'reason' in why, why)
try: R.update(d, 'test: Queensland off'); why = ''
except SystemExit as e: why = str(e)
p = R.check(d, base)
ok('switching it off in both halves, version raised in both, --update run with its reason: accepted, and clean against what is live', why == '' and p == [], (why, p))
ok('and /health would report the new version and the new manifest hash',
   re.search(r"^const VP_DRAW_MANIFEST = '%s';" % manifest(d)['manifest_hash'], io.open(os.path.join(d, R.GAME), encoding='utf-8').read(), re.M) is not None and manifest(d)['version'] == NXT and any(c.get('version') == NXT and c.get('reason') for c in manifest(d).get('changes', [])))

d = fresh(); edit(d, R.WORKER_MODULE, "const TABLET_FALLBACK_OFF_STATES = new Set([]);", "const TABLET_FALLBACK_OFF_STATES = new Set(['QLD']);")
p = R.check(d, base)
ok('the gate itself names a switch that differs between the halves', any('switch differs' in x for x in p), p)

d = fresh(); edit(d, R.WORKER_MODULE, "const VP_DRAW_VERSION = '%s';" % CUR, "const VP_DRAW_VERSION = '%s';" % NXT)
p = R.check(d, base)
ok('raising the version in one half only: refused', any('different versions' in x for x in p), p)

d = fresh(); edit(d, R.WORKER_MODULE, "  return x % max;", "  return (x + 1) % max;")
os.remove(os.path.join(d, R.MANIFEST)); R.update(d, 'pretending this is new')
p = R.check(d, base)
ok('a change blessed by deleting the manifest and regenerating it at the same version: refused against what is live', any('changed since what is on main but the version is still' in x for x in p), p)

d = fresh(); m = manifest(d); m['manifest_hash'] = '0' * 64
io.open(os.path.join(d, R.MANIFEST), 'w', encoding='utf-8').write(json.dumps(m))
p = R.check(d, base)
ok('a manifest whose hash was edited by hand: refused', any('manifest hash does not match' in x for x in p), p)

d = fresh(); edit(d, R.GAME, "const VP_DRAW_MANIFEST = '%s';" % base['manifest_hash'], "const VP_DRAW_MANIFEST = 'abc';")
p = R.check(d, base)
ok('a Worker that would report a different manifest hash on /health: refused', any('VP_DRAW_MANIFEST' in x for x in p), p)

g = io.open(os.path.join(ROOT, R.GAME), encoding='utf-8').read()
ok('/health reports the module version and the manifest hash', re.search(r"draw_module: VP_DRAW_VERSION,", g) is not None and re.search(r"draw_manifest: VP_DRAW_MANIFEST,", g) is not None)
rel = io.open(os.path.join(ROOT, 'tools', 'release.py'), encoding='utf-8').read()
ok('release.py runs the regulated check itself, before anything is pushed', 'regulated.py' in rel and re.search(r"regulated\.py'?,?\s*'--check'", rel) is not None)

wm = io.open(os.path.join(ROOT, R.WORKER_MODULE), encoding='utf-8').read()
cm = io.open(os.path.join(ROOT, R.CONSOLE_MODULE), encoding='utf-8').read()
envs = sorted(set(re.findall(r'env\.([A-Z_][A-Z0-9_]*)', wm)))
ok('no environment variable can change the server half: the only one it reads is the database address', envs == ['SUPABASE_URL'], envs)
ok('no venue, host or HQ setting can change it: it reads no settings or admin table', not re.search(r"vp_venue_settings|vp_platform_admins|vp_group|config\.", wm))
ok('nothing on the page can change the tablet half: no storage, no address bar, no network, and its rules are frozen',
   not re.search(r'localStorage|sessionStorage|location\.|fetch\(|XMLHttpRequest', cm) and 'Object.freeze(' in cm)

d = fresh(); edit(d, R.CONSOLE_MODULE, "  function stripTicketRows(rnd, counts){", "  function stripTicketRows(rnd, counts){ counts = counts.slice();")
p = R.check(d, base)
ok('the strip algorithm edited in the tablet half only: refused (both halves must make tickets the same way)', any('VP-STRIP' in x for x in p), p)
m = manifest(fresh())
ok('the manifest records a reason for the version in force', any(c.get('version') == m.get('version') and c.get('reason') for c in m.get('changes', [])), m.get('changes'))
d = fresh(); mm = manifest(d)
for c in mm.get('changes', []):
    if c.get('version') == mm.get('version'): c['reason'] = ''
io.open(os.path.join(d, R.MANIFEST), 'w', encoding='utf-8').write(json.dumps(mm, indent=2))
p = R.check(d)
ok('a manifest whose version in force has no reason on the record: refused', any('no reason' in x for x in p), p)

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
