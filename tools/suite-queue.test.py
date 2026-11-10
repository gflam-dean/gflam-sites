#!/usr/bin/env python3
"""THE TEST QUEUE AND RESULT CACHE, WITH FAKE SUITES. GATELIB_NO_CHROME.

    python3 tools/suite-queue.test.py

Nothing here starts a browser, takes /tmp/vp-heavy.lock, or touches the real cache, the real HOLD file or
this repo: every run happens in a temp folder, the cache and HOLD paths are pointed there, the lock is a
fake that counts, and the suites are scripts that print a result line. The one git test builds a throwaway
repo in the temp folder (clean environment, no remote) and copies this repo's suite-impact.py and gatelib.py
into it.

  1. cache hit            a green suite is "cached green <time>" and is not run again
  2. invalidation         editing a page the suite reads, or the suite itself, makes it run again
  3. shared file          one change to a shared file (vp-session.js) invalidates every reader
  4. failures             a red suite, a timeout, a non-zero exit with an all-passed line, a missing summary: never cached
  5. ordering             tv, console, phone, hq, emails, billing, other; the areas map file overrides names
  6. HOLD                 a HOLD file stops the queue before the next suite; nothing after it starts
  7. stop-before          a time cut-off stops the queue; HHMM parses to the next such time
  8. plan mode            --plan runs nothing, takes no lock, writes no cache
  9. lock                 taken and given back once per suite that runs, never for a cached one
 10. suite-impact         a throwaway git repo: a changed page picks the suites that open it, a changed
                          shared file picks every reader, --all picks them all
"""
import importlib.util, io, json, os, shutil, stat, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
for k in list(os.environ):
    if k.startswith('GIT_'):
        del os.environ[k]
TMP = tempfile.mkdtemp(prefix='suite-queue-test-')
os.environ['VP_SUITE_CACHE'] = os.path.join(TMP, 'cache', 'cache.json')
os.environ['VP_HOLD'] = os.path.join(TMP, 'HOLD')


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(TOOLS, name + '.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


cache = load('suite-cache')
queue = load('suite-queue')

N = [0, 0]


def ok(label, good, detail=''):
    N[0] += 1
    if good:
        N[1] += 1
        print('ok   ' + label)
    else:
        print('FAIL ' + label + (' | ' + detail if detail else ''))


def write(tree, rel, text):
    p = os.path.join(tree, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with io.open(p, 'w', encoding='utf-8') as fh:
        fh.write(text)
    return p


def suite_text(page, result='ALL 3 CHECKS PASSED'):
    return "# opens %s\nprint(%r)\n" % (page, result)


def fresh_tree(name):
    t = os.path.join(TMP, name)
    shutil.rmtree(t, ignore_errors=True)
    cfg = json.load(io.open(os.path.join(TOOLS, 'suite-areas.json')))
    cfg['shared'] = ['venueplay/app/vp-session.js', 'venueplay-backend/worker/*.js']
    write(t, 'tools/suite-areas.json', json.dumps(cfg))
    write(t, 'venueplay/tv.html', '<html>tv</html>')
    write(t, 'venueplay/app/host.html', '<html>host</html>')
    write(t, 'venueplay/app/hq.html', '<html>hq</html>')
    write(t, 'venueplay/app/vp-session.js', 'var vp = 1;')
    write(t, 'venueplay-backend/worker/index.js', 'var w = 1;')
    write(t, 'tools/zz-tv-in-chrome.test.py', suite_text('venueplay/tv.html'))
    write(t, 'tools/aa-hq-in-chrome.test.py', suite_text('venueplay/app/hq.html'))
    write(t, 'tools/mm-console-in-chrome.test.py', suite_text('venueplay/app/host.html'))
    return t


class Rec(object):
    """A fake runner and a fake lock that record what happened. `script` maps suite -> (rc, out, timed_out)."""
    def __init__(self, script=None):
        self.ran, self.taken, self.given, self.script = [], 0, 0, script or {}

    def runner(self, tree, suite, timeout):
        self.ran.append(suite)
        rc, out, to = self.script.get(suite, (0, 'ok a\nALL 3 CHECKS PASSED', False))
        return rc, out, to, 2.0

    def lock(self):
        def take(tool):
            self.taken += 1; return True
        def give():
            self.given += 1
        return (take, give)


def go(tree, suites, rec, **kw):
    cfg = cache.load_config(tree)
    chosen = dict((s, 'test') for s in suites)
    cf = os.environ['VP_SUITE_CACHE']
    rows = queue.make_plan(tree, 'base', chosen, cfg, cf, no_cache=kw.pop('no_cache_plan', False))
    out = []
    res = queue.run_queue(tree, rows, say=out.append, runner=rec.runner, lock=rec.lock(), cache_file=cf, **kw)
    return res, out, rows


def reset_cache():
    shutil.rmtree(os.path.dirname(os.environ['VP_SUITE_CACHE']), ignore_errors=True)
    if os.path.exists(os.environ['VP_HOLD']):
        os.remove(os.environ['VP_HOLD'])
    cache.forget_index()


ALL = ['tools/zz-tv-in-chrome.test.py', 'tools/aa-hq-in-chrome.test.py', 'tools/mm-console-in-chrome.test.py']

# ---- 1 cache hit
reset_cache(); t = fresh_tree('t1')
r1 = Rec(); res, out, rows = go(t, ALL, r1)
ok('first run runs all three', len(r1.ran) == 3 and len(res['ran']) == 3, str(r1.ran))
ok('a green run is written to the cache', len(cache.load()) == 3)
r2 = Rec(); res, out, rows = go(t, ALL, r2)
ok('second run runs nothing', r2.ran == [] and len(res['cached']) == 3, str(r2.ran))
ok('second run says "cached green HH:MM"', all('cached green' in l for l in out if l.strip().startswith(('1.', '2.', '3.'))) and any(time.strftime('%H:%M') in l or ':' in l for l in out), '\n'.join(out))
r3 = Rec(); res, out, rows = go(t, ALL, r3, no_cache_plan=True, no_cache=True)
ok('--no-cache runs everything again', len(r3.ran) == 3, str(r3.ran))

# ---- 2 invalidation by a read file, and by the suite itself
reset_cache(); t = fresh_tree('t2'); go(t, ALL, Rec())
write(t, 'venueplay/tv.html', '<html>tv changed</html>'); cache.forget_index()
r = Rec(); res, out, rows = go(t, ALL, r)
ok('a changed page re-runs only the suite that reads it', r.ran == ['tools/zz-tv-in-chrome.test.py'], str(r.ran))
ok('the other two stay cached green', sorted(res['cached']) == sorted(['tools/aa-hq-in-chrome.test.py', 'tools/mm-console-in-chrome.test.py']))
r = Rec(); go(t, ALL, r)
ok('and once it passes again it is cached again', r.ran == [])
write(t, 'tools/aa-hq-in-chrome.test.py', suite_text('venueplay/app/hq.html', 'ALL 4 CHECKS PASSED'))
r = Rec(); go(t, ALL, r)
ok('editing the suite itself re-runs it', r.ran == ['tools/aa-hq-in-chrome.test.py'], str(r.ran))
os.remove(os.path.join(t, 'venueplay/app/host.html')); cache.forget_index()
r = Rec(); go(t, ALL, r)
ok('a file the suite reads going missing invalidates it', r.ran == ['tools/mm-console-in-chrome.test.py'], str(r.ran))

# ---- 3 shared file
reset_cache(); t = fresh_tree('t3'); go(t, ALL, Rec())
write(t, 'venueplay/app/vp-session.js', 'var vp = 2;'); cache.forget_index()
r = Rec(); res, out, rows = go(t, ALL, r)
ok('one shared-file change (vp-session.js) invalidates every reader', sorted(r.ran) == sorted(ALL), str(r.ran))
go(t, ALL, Rec())
write(t, 'venueplay-backend/worker/index.js', 'var w = 2;'); cache.forget_index()
r = Rec(); go(t, ALL, r)
ok('so does a change to the Worker', sorted(r.ran) == sorted(ALL), str(r.ran))
ok('reads() lists the shared files and the suite itself', 'venueplay/app/vp-session.js' in cache.reads(t, ALL[0]) and ALL[0] in cache.reads(t, ALL[0]))

# ---- 4 failures are never cached
reset_cache(); t = fresh_tree('t4')
bad = {ALL[0]: (1, 'ok a\nFAIL b\n2 of 3 checks passed', False),
       ALL[1]: (124, 'ALL 3 CHECKS PASSED\nTIMED OUT after 5s', True),
       ALL[2]: (1, 'ALL 3 CHECKS PASSED', False)}
r = Rec(bad); res, out, rows = go(t, ALL, r)
ok('red, timed-out and non-zero runs are all reported red', len(res['failed']) == 3, str(res))
ok('none of them reaches the cache', cache.load() == {}, str(cache.load()))
r = Rec(); go(t, ALL, r)
ok('so the next run runs all three', len(r.ran) == 3)
ok('exit 0 with no summary line is not a pass', not queue.judged_pass(0, 'hello'))
ok('exit 0 with a FAIL line is not a pass', not queue.judged_pass(0, 'FAIL x\nALL 3 CHECKS PASSED'))
ok('"3 of 3 checks passed" is a pass, "2 of 3" is not', queue.judged_pass(0, '3 of 3 checks passed') and not queue.judged_pass(0, '2 of 3 checks passed'))
reset_cache(); t = fresh_tree('t4b'); go(t, ALL, Rec())
r = Rec({ALL[0]: (1, 'FAIL x', False)}); write(t, 'venueplay/tv.html', '<html>x</html>'); cache.forget_index()
go(t, ALL, r)
ok('a red re-run does not leave the old green behind as fresh', cache.lookup(ALL[0], cache.fingerprint(t, ALL[0])[0]) is None)
stop_on = Rec({ALL[0]: (1, 'FAIL x', False)}); reset_cache(); t = fresh_tree('t4c')
res, out, rows = go(t, ALL, stop_on, stop_on_fail=True)
ok('--stop-on-fail stops at the first red and lists what is left', len(res['failed']) == 1 and res['left'] and 'red' in res['stopped'], str(res))
# files that move while a suite runs
reset_cache(); t = fresh_tree('t4d')
class Moving(Rec):
    def runner(self, tree, suite, timeout):
        write(tree, 'venueplay/tv.html', '<html>moved while running</html>'); cache.forget_index()
        return Rec.runner(self, tree, suite, timeout)
res, out, rows = go(t, [ALL[0]], Moving())
ok('a pass on files that changed during the run is not cached', cache.load() == {} and any('not cached' in l for l in out))

# ---- 5 ordering
cfg = cache.load_config(fresh_tree('t5'))
names = ['tools/x-billing-in-chrome.test.py', 'tools/x-emails-in-chrome.test.py', 'tools/x-hq-in-chrome.test.py', 'tools/x-phone-in-chrome.test.py',
         'tools/x-console-in-chrome.test.py', 'tools/x-tv-in-chrome.test.py', 'tools/x-zzz-in-chrome.test.py']
rows5 = queue.order_suites(names, lambda s: [], cfg)
ok('areas run TV, console, phone, HQ, emails, billing, other', [a for a, s in rows5] == ['tv', 'console', 'phone', 'hq', 'emails', 'billing', 'other'], str(rows5))
cfg2 = dict(cfg); cfg2['suites'] = {'tools/x-zzz-in-chrome.test.py': 'tv'}
rows5b = queue.order_suites(names, lambda s: [], cfg2)
ok('the map file moves a named suite', rows5b[0][1] == 'tools/x-tv-in-chrome.test.py' and rows5b[1][1] == 'tools/x-zzz-in-chrome.test.py', str(rows5b[:2]))
rows5c = queue.order_suites(['tools/odd.test.py'], lambda s: ['venueplay/tv.html'], cfg)
ok('a suite with no area word in its name is placed by the page it reads', rows5c[0][0] == 'tv', str(rows5c))
reset_cache(); t = fresh_tree('t5b'); r = Rec(); go(t, ALL, r)
ok('the queue runs in area order, not name order', r.ran == ['tools/zz-tv-in-chrome.test.py', 'tools/mm-console-in-chrome.test.py', 'tools/aa-hq-in-chrome.test.py'], str(r.ran))

# ---- 6 HOLD
reset_cache(); t = fresh_tree('t6'); hold_hits = []
class HoldAfterFirst(Rec):
    def runner(self, tree, suite, timeout):
        io.open(os.environ['VP_HOLD'], 'w').write('main needs the machine'); return Rec.runner(self, tree, suite, timeout)
r = HoldAfterFirst(); res, out, rows = go(t, ALL, r)
ok('HOLD appearing mid-queue stops it before the next suite', len(r.ran) == 1 and len(res['left']) == 2 and 'HOLD' in res['stopped'], str(r.ran) + str(res))
ok('the first suite, which finished, is still cached', len(cache.load()) == 1)
r = Rec(); res, out, rows = go(t, ALL, r)
ok('with HOLD already there, nothing starts', r.ran == [] and r.taken == 0 and len(res['left']) == 3, str(res))
os.remove(os.environ['VP_HOLD'])
r = Rec(); res, out, rows = go(t, ALL, r)
ok('HOLD removed: the queue carries on and skips the cached one', len(r.ran) == 2 and len(res['cached']) == 1, str(r.ran))

# ---- 7 stop-before
reset_cache(); t = fresh_tree('t7'); now = time.time()
r = Rec(); res, out, rows = go(t, ALL, r, now=lambda: now, stop_at=now - 1)
ok('a passed cut-off starts nothing', r.ran == [] and 'stop-before' in res['stopped'], str(res))
r = Rec(); res, out, rows = go(t, ALL, r, now=lambda: now, stop_at=now + 3600)
ok('a cut-off an hour away lets it all run', len(r.ran) == 3)
reset_cache(); t = fresh_tree('t7b'); go(t, [ALL[0]], Rec())   # seconds recorded: 2.0
write(t, 'venueplay/tv.html', '<html>c</html>'); cache.forget_index()
r = Rec(); res, out, rows = go(t, ALL, r, now=lambda: now, stop_at=now + 1)
ok('a suite that would end after the cut-off (by its last duration) is not started', ALL[0] not in r.ran, str(r.ran))
lt = time.localtime(now); d = queue.deadline_from('%02d%02d' % (lt.tm_hour, lt.tm_min), now)
ok('HHMM now means the same time tomorrow', 86000 < d - now <= 86400, str(d - now))
d = queue.deadline_from('%02d%02d' % ((lt.tm_hour + 1) % 24, lt.tm_min), now)
ok('HHMM an hour on is an hour away', abs((d - now) % 86400 - 3600) < 61, str(d - now))
try:
    queue.deadline_from('soon', now); bad_hhmm = False
except ValueError:
    bad_hhmm = True
ok('a bad HHMM is refused', bad_hhmm)

# ---- 8 plan mode and 9 lock
reset_cache(); t = fresh_tree('t8'); go(t, [ALL[0]], Rec())
r = Rec(); before = cache.load()
res, out, rows = go(t, ALL, r, plan_only=True)
ok('plan mode runs nothing and takes no lock', r.ran == [] and r.taken == 0 and r.given == 0)
ok('plan mode writes no cache', cache.load() == before)
ok('plan mode prints every suite with its area, and "cached green" for the green one',
   len([l for l in out if '[' in l]) == 3 and any('cached green' in l and 'zz-tv' in l for l in out), '\n'.join(out))
ok('plan rows are in area order', [x['area'] for x in rows] == ['tv', 'console', 'hq'], str([x['area'] for x in rows]))
reset_cache(); t = fresh_tree('t9'); r = Rec(); go(t, ALL, r)
ok('the lock is taken and given back once per suite that ran', r.taken == 3 and r.given == 3, '%d/%d' % (r.taken, r.given))
r = Rec(); go(t, ALL, r)
ok('a cached suite never touches the lock', r.taken == 0 and r.given == 0)
class Refuse(Rec):
    def lock(self):
        return (lambda tool: False, lambda: None)
r = Refuse(); reset_cache(); res, out, rows = go(t, ALL, r)
ok('a refused lock runs nothing and caches nothing', r.ran == [] and cache.load() == {} and 'lock' in res['stopped'], str(res))

# ---- cache list and forget
reset_cache(); t = fresh_tree('t10'); go(t, ALL, Rec())
cache.drop([ALL[0]])
ok('forget drops one entry', ALL[0] not in cache.load() and len(cache.load()) == 2)

# ---- 10 suite-impact in a throwaway git repo
def git(cwd, *a):
    r = subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'] + list(a),
                       cwd=cwd, capture_output=True, text=True)
    return r.stdout
reset_cache()
g = os.path.join(TMP, 'repo'); shutil.rmtree(g, ignore_errors=True); os.makedirs(g)
assert os.path.realpath(g).startswith(os.path.realpath(TMP))
git(g, 'init', '-q', '-b', 'base')
shutil.copy(os.path.join(TOOLS, 'suite-impact.py'), os.path.join(g, 'tools_si.tmp'))
os.makedirs(os.path.join(g, 'tools')); shutil.move(os.path.join(g, 'tools_si.tmp'), os.path.join(g, 'tools', 'suite-impact.py'))
shutil.copy(os.path.join(TOOLS, 'gatelib.py'), os.path.join(g, 'tools', 'gatelib.py'))
shutil.copy(os.path.join(TOOLS, 'suite-areas.json'), os.path.join(g, 'tools', 'suite-areas.json'))
cfgp = os.path.join(g, 'tools', 'suite-areas.json'); c = json.load(io.open(cfgp)); c['shared'] = ['venueplay/app/vp-session.js']; json.dump(c, io.open(cfgp, 'w'))
def chrome_suite(page):
    return "# browser-rig\nimport sys\nprint('open %s')\nprint('ALL 1 CHECKS PASSED')\n" % page
write(g, 'venueplay/tv.html', '<div id="the-stage">ticket roll</div>')
write(g, 'venueplay/app/host.html', '<div id="the-host">console</div>')
write(g, 'venueplay/app/vp-session.js', 'var s=1;')
write(g, 'tools/a-tv-in-chrome.test.py', chrome_suite('venueplay/tv.html'))
write(g, 'tools/b-console-in-chrome.test.py', chrome_suite('venueplay/app/host.html'))
write(g, 'tools/c-nochrome.test.py', "print('ALL 1 CHECKS PASSED')\n# opens venueplay/tv.html\n")
git(g, 'add', '-A'); git(g, 'commit', '-q', '-m', 'base')
write(g, 'venueplay/tv.html', '<div id="the-stage-two">ticket roll</div>')
chosen = queue.choose(g, 'base')
ok('suite-impact: a changed page picks the Chrome suite that opens it', list(chosen) == ['tools/a-tv-in-chrome.test.py'], str(chosen))
ok('suite-impact: a suite with no Chrome in it is left out', 'tools/c-nochrome.test.py' not in chosen)
write(g, 'venueplay/app/vp-session.js', 'var s=2;'); cache.forget_index()
chosen = queue.choose(g, 'base')
ok('a changed shared file picks every Chrome suite that reads it', sorted(chosen) == ['tools/a-tv-in-chrome.test.py', 'tools/b-console-in-chrome.test.py'], str(chosen))
git(g, 'checkout', '-q', '.'); cache.forget_index()
chosen = queue.choose(g, 'base')
ok('nothing changed: nothing chosen', chosen == {}, str(chosen))
ok('--all picks every Chrome suite', sorted(queue.choose(g, 'base', everything=True)) == ['tools/a-tv-in-chrome.test.py', 'tools/b-console-in-chrome.test.py'])
write(g, 'tools/d-new-in-chrome.test.py', chrome_suite('venueplay/tv.html')); cache.forget_index()
ok('a brand-new suite is chosen (its own first run)', 'tools/d-new-in-chrome.test.py' in queue.choose(g, 'base'))

shutil.rmtree(TMP, ignore_errors=True)
print()
print('ALL %d CHECKS PASSED' % N[0] if N[0] == N[1] else '%d of %d checks passed' % (N[1], N[0]))
sys.exit(0 if N[0] == N[1] else 1)
