#!/usr/bin/env python3
"""ONE QUEUE, ONE ORDER: THE CHROME SUITES, ONCE, ON THE MERGED TREE (written 10 Nov 2026).

    python3 tools/suite-queue.py <release-tree> <base> --plan              dry run: print the queue, execute nothing
    python3 tools/suite-queue.py <release-tree> <base>                     run it
    ... --stop-before 0430       do not START a suite that would still be running at 04:30
    ... --no-cache               ignore the result cache (run everything chosen; still records passes)
    ... --all                    every Chrome suite in the tree, not only the ones the changes reach
    ... --stop-on-fail           stop at the first red (default: run the rest, report all reds at the end)
    ... --list                   the cache, as tools/suite-cache.py --list

<release-tree> is the merged worktree (uncommitted work counts); <base> is what it started from
(release/10nov, main). Chosen suites = the Chrome suites that
  - tools/suite-impact.py names (still mention something the changes removed, or open a changed page),
  - the changes edited or added themselves (a branch's own new suite runs once), and
  - read any changed file at all, shared files included (tools/suite-cache.py "reads"): a changed
    vp-session.js or Worker makes every reader a candidate.
Candidates are ordered by area (tools/suite-areas.json: TV, host console, phone, HQ, emails, billing, other),
then by name, and run ONE AT A TIME. Each takes /tmp/vp-heavy.lock through tools/gatelib.py (the helper
every suite and release-check.py already use), waiting VP_WAIT_LOCK seconds (default 1800) and never
clearing anybody else's, and gives it back between suites.

Before each suite: HOLD file (~/venue-enrich/builds/HOLD, or VP_HOLD) present = stop, nothing more starts;
--stop-before time reached = stop. Before running, the result cache is asked: same hash of every file the
suite reads as its last green = "cached green <time>", not run. Only a clean pass is ever recorded.

Exit: 0 all green (run or cached), 1 a suite red, 3 stopped early (HOLD or time) with suites left, 2 usage.
Plan mode and the unit tests never take the lock and never start Chrome.
"""
import importlib.util, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HOLD = os.environ.get('VP_HOLD') or os.path.expanduser('~/venue-enrich/builds/HOLD')
SUITE_RX = re.compile(r'(\.test\.(py|js)$|^tools/test-.*\.js$)')


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


cache = _load(os.path.join(HERE, 'suite-cache.py'), 'suite_cache')


# ---------------------------------------------------------------- areas

def _tokens(text):
    return set(re.findall(r'[a-z0-9]+', text.lower()))


def _has(words, toks):
    return any(w.strip('-') in toks if '-' not in w.strip('-') else all(x in toks for x in w.strip('-').split('-')) for w in words)


def area_of(suite, pages, cfg):
    """The area a suite belongs to: an explicit entry, else the first area (in 'order') with a word among
    the suite's file-name tokens, else the area most of the pages it reads (tools/ and shared files left out)
    fall in, else 'other'. Words match whole tokens: 'tv' is in old-tv-x but not in 'activity'."""
    if suite in cfg.get('suites', {}):
        return cfg['suites'][suite]
    words = cfg.get('words', {})
    order = cfg.get('order', [])
    nt = _tokens(os.path.basename(suite))
    for area in order:
        if _has(words.get(area, []), nt):
            return area
    own = [p for p in pages if not p.startswith('tools/') and p not in cfg.get('shared', []) and not p.startswith('venueplay-backend/worker/')]
    best, best_n = 'other', 0
    for area in order:
        n = sum(1 for p in own if _has(words.get(area, []), _tokens(p)))
        if n > best_n:
            best, best_n = area, n
    return best


def order_suites(suites, reads_of, cfg):
    """[(area, suite)] in the fixed order: area rank, then name."""
    order = cfg.get('order', [])
    rank = {a: i for i, a in enumerate(order)}
    rows = [(area_of(s, reads_of(s), cfg), s) for s in suites]
    return sorted(rows, key=lambda r: (rank.get(r[0], len(order)), r[1]))


# ---------------------------------------------------------------- choosing

def impact_suites(tree, base):
    """(set of Chrome suites suite-impact names, set of changed files) for the tree against base.
    Uses the tree's own tools/suite-impact.py and gatelib.py, so it judges with the tree's code."""
    sys.path.insert(0, os.path.join(tree, 'tools'))
    si = _load(os.path.join(tree, 'tools', 'suite-impact.py'), 'suite_impact_tree')
    gl = _load(os.path.join(tree, 'tools', 'gatelib.py'), 'gatelib_tree')
    branch = 'dir:' + tree
    changed = set(si.diff_names(base, branch))
    # files git does not track yet (a suite or page not yet added) are changes too
    new = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard'], cwd=tree, capture_output=True, text=True)
    changed |= set(new.stdout.split())
    pages = si.changed_pages(base, branch)
    suites = si.suite_files(base, branch)
    picked = {}
    for p in pages:
        for t, kind in si.gone_tokens(base, branch, p).items():
            for s, src in suites.items():
                if s != p and s != 'tools/prove-checks.py' and si.mentions(src, t, kind):
                    picked.setdefault(s, 'still names %s removed from %s' % (t[:30], p))
    for s, src in suites.items():
        if s == 'tools/prove-checks.py' or s in picked:
            continue
        for p in pages:
            leaf = os.path.basename(p)
            if leaf in ('index.html', 'play.html', 'screen.html', 'host.html'):
                leaf = '/'.join(p.split('/')[-2:])
            if leaf in src:
                picked[s] = 'opens changed page %s' % p
                break
    for s in sorted(changed):
        if SUITE_RX.search(s) and os.path.isfile(os.path.join(tree, s)):
            picked.setdefault(s, 'edited or added by the changes')
    chrome = {s: why for s, why in picked.items()
              if SUITE_RX.search(s) and os.path.isfile(os.path.join(tree, s)) and gl.uses_chrome(os.path.join(tree, s))}
    return chrome, changed, gl


def choose(tree, base, everything=False):
    """{suite: why} the Chrome suites to queue."""
    chrome, changed, gl = impact_suites(tree, base)
    cfg = cache.load_config(tree)
    found = dict(chrome)
    cache.forget_index()
    for dirpath, dirs, files in os.walk(tree):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git') and not d.startswith('.')]
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), tree)
            if not SUITE_RX.search(rel) or rel.startswith('.') or rel in found:
                continue
            if not gl.uses_chrome(os.path.join(tree, rel)):
                continue
            if everything:
                found[rel] = '--all'
                continue
            hit = [c for c in cache.reads(tree, rel, cfg) if c in changed and c != rel]
            if hit:
                found[rel] = 'reads changed %s' % hit[0]
    return found


# ---------------------------------------------------------------- stop rules

def deadline_from(hhmm, now):
    """Epoch of the NEXT HH:MM after `now` (local time)."""
    m = re.match(r'^(\d{2}):?(\d{2})$', hhmm or '')
    if not m:
        raise ValueError('--stop-before wants HHMM, e.g. 0430')
    lt = time.localtime(now)
    t = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, int(m.group(1)), int(m.group(2)), 0, 0, 0, -1))
    return t if t > now else t + 86400


def judged_pass(rc, out, timed_out=False):
    """A clean pass and nothing else, by THE ONE PASS JUDGE (tools/passwording.py, 12 Nov 2026), the same
    function the full gate, the deploy fast gate and the test server use: exit 0, no FAIL line, and a last
    line that says every check passed. This had its own copy of the rule, as did three other readers."""
    return _passwording().judged_pass(rc, out, timed_out)


def _passwording():
    """tools/passwording.py beside this file, loaded once."""
    if 'pw' not in _PW:
        _PW['pw'] = _load(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'passwording.py'), 'passwording_sq')
    return _PW['pw']


_PW = {}


# ---------------------------------------------------------------- running

def default_runner(tree, suite, timeout):
    sys.path.insert(0, os.path.join(tree, 'tools'))
    gl = _load(os.path.join(tree, 'tools', 'gatelib.py'), 'gatelib_run')
    cmd = [gl.JSC, suite] if suite.endswith('.js') else [sys.executable, suite]
    r = gl.run_suite(cmd, cwd=tree, timeout=timeout)
    return r.rc, r.out, r.timed_out, r.seconds


def default_lock(tree):
    """(take(), give()) on /tmp/vp-heavy.lock, through gatelib's own helper."""
    sys.path.insert(0, os.path.join(tree, 'tools'))
    gl = _load(os.path.join(tree, 'tools', 'gatelib.py'), 'gatelib_lock')
    wait = int(os.environ.get('VP_WAIT_LOCK', '1800') or 1800)
    return (lambda tool: gl.hold_lock_or_refuse(tool, wait_s=wait)), gl._release_lock


def make_plan(tree, base, chosen, cfg, cache_file=None, no_cache=False):
    rows = []
    ordered = order_suites(sorted(chosen), lambda s: cache.reads(tree, s, cfg), cfg)
    for area, s in ordered:
        digest, _ = cache.fingerprint(tree, s, cfg)
        e = None if no_cache else cache.lookup(s, digest, cache_file)
        rows.append({'area': area, 'suite': s, 'why': chosen[s], 'hash': digest,
                     'cached': e, 'seconds': (cache.load(cache_file).get(s) or {}).get('seconds', 0)})
    return rows


def run_queue(tree, rows, say=print, now=time.time, hold=None, stop_at=None, no_cache=False,
              stop_on_fail=False, runner=None, lock=None, cache_file=None, timeout=3600, plan_only=False):
    """Walk the plan. Returns {'ran': [...], 'cached': [...], 'failed': [...], 'left': [...], 'stopped': why or ''}."""
    hold = HOLD if hold is None else hold
    res = {'ran': [], 'cached': [], 'failed': [], 'left': [], 'stopped': ''}
    for i, r in enumerate(rows):
        s = r['suite']
        if plan_only:
            tag = 'cached green %s, skipped' % cache.clock(r['cached']) if r['cached'] else 'RUN'
            say('%2d. [%-7s] %s   %s   (%s)' % (i + 1, r['area'], s, tag, r['why']))
            continue
        if os.path.exists(hold):
            res['stopped'] = 'HOLD file present (%s)' % hold
            res['left'] = [x['suite'] for x in rows[i:]]
            say('STOPPED before %s: %s. %d suite(s) not started.' % (s, res['stopped'], len(res['left'])))
            return res
        if r['cached']:
            say('%2d. %s: cached green %s (nothing it reads has changed)' % (i + 1, s, cache.clock(r['cached'])))
            res['cached'].append(s)
            continue
        if stop_at is not None and now() + r.get('seconds', 0) >= stop_at:
            res['stopped'] = 'stop-before %s reached' % time.strftime('%H:%M', time.localtime(stop_at))
            res['left'] = [x['suite'] for x in rows[i:] if not x['cached']]
            say('STOPPED before %s: %s. %d suite(s) not started.' % (s, res['stopped'], len(res['left'])))
            return res
        take, give = lock if lock else default_lock(tree)
        if not take('suite-queue ' + os.path.basename(s)):
            res['failed'].append(s)
            say('%2d. %s: NOT RUN, could not take the heavy lock' % (i + 1, s))
            res['stopped'] = 'heavy lock refused'
            res['left'] = [x['suite'] for x in rows[i + 1:]]
            return res
        try:
            say('%2d. %s: running ...' % (i + 1, s))
            rc, out, timed_out, secs = (runner or default_runner)(tree, s, timeout)
        finally:
            give()
        last = ((out or '').strip().splitlines() or [''])[-1]
        if judged_pass(rc, out, timed_out):
            # hash AGAIN after the run: if the files moved while it ran, the pass is for files we no longer have
            digest, _ = cache.fingerprint(tree, s, cache.load_config(tree))
            if digest == r['hash']:
                cache.record_pass(s, digest, secs, last, cache_file)
            else:
                say('    (files changed during the run; the pass is not cached)')
            say('    green: %s (%.0fs)' % (last, secs))
            res['ran'].append(s)
        else:
            fails = [l.strip() for l in (out or '').splitlines() if l.strip().startswith('FAIL')]
            say('    RED: %s (rc %s%s) %s' % (last[:100], rc, ', timed out' if timed_out else '', ('| ' + ' | '.join(fails[:2])) if fails else ''))
            res['failed'].append(s)
            if stop_on_fail:
                res['stopped'] = 'red suite, --stop-on-fail'
                res['left'] = [x['suite'] for x in rows[i + 1:]]
                return res
    return res


def main(argv):
    flags = [a for a in argv if a.startswith('--')]
    pos = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--stop-before')]
    if '--list' in argv:
        return cache.main(['--list'] + (['--root', pos[0]] if pos else []))
    if len(pos) != 2:
        print(__doc__); return 2
    tree, base = os.path.abspath(os.path.expanduser(pos[0])), pos[1]
    stop_at = None
    if '--stop-before' in argv:
        try:
            stop_at = deadline_from(argv[argv.index('--stop-before') + 1], time.time())
        except (ValueError, IndexError) as e:
            print(e); return 2
    cfg = cache.load_config(tree)
    chosen = choose(tree, base, everything='--all' in flags)
    rows = make_plan(tree, base, chosen, cfg, no_cache='--no-cache' in flags)
    plan_only = '--plan' in flags
    print('# suite queue: %s onto %s: %d Chrome suite(s), %d cached green, %d to run%s'
          % (tree, base, len(rows), sum(1 for r in rows if r['cached']), sum(1 for r in rows if not r['cached']),
             ' (PLAN ONLY, nothing executed)' if plan_only else ''))
    res = run_queue(tree, rows, stop_at=stop_at, no_cache='--no-cache' in flags, stop_on_fail='--stop-on-fail' in flags,
                    plan_only=plan_only)
    if plan_only:
        return 0
    print('\nran green %d, cached green %d, red %d, not started %d%s'
          % (len(res['ran']), len(res['cached']), len(res['failed']), len(res['left']),
             ('; stopped: ' + res['stopped']) if res['stopped'] else ''))
    for s in res['failed']:
        print('  RED  ' + s)
    return 1 if res['failed'] else (3 if res['left'] else 0)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
