#!/usr/bin/env python3
"""THE RESULT CACHE: A SUITE THAT PASSED ON THESE EXACT FILES DOES NOT RUN AGAIN (written 10 Nov 2026).

    python3 tools/suite-cache.py --list [--root <tree>]       every cached suite: green / stale / never run
    python3 tools/suite-cache.py --forget <suite> [...]       drop one suite's entry
    python3 tools/suite-cache.py --clear                      drop everything

Used by tools/suite-queue.py (and importable: load this file with importlib, it has a hyphen).

The rule: after a suite PASSES, record the pass, the time, and a sha256 over every file that suite reads.
Before running it again, hash those files again. Same hash = "cached green <time>", skip. Any file different
(or gone, or a new one the suite now names) = the entry is stale and the suite runs.

What a suite "reads" (over-counting only costs a re-run, so it counts generously):
  1. the suite file itself
  2. every file in the tree whose path, or whose file name, the suite's source names (a page, the Worker,
     a helper under tools/)
  3. the shared files in tools/suite-areas.json "shared" (vp-session.js, the Worker, the browser rig,
     gatelib.py ...). A change to ANY of those changes every suite's hash, so it clears every reader.

Never cached: a failed run, a timed-out run, an errored run, a run that was refused the lock. record_pass()
is only ever called by a caller that has judged a pass; there is no other way in.

The cache lives OUTSIDE the repo (default ~/venue-enrich/reports/suite-cache/cache.json; VP_SUITE_CACHE
overrides it), so it is never committed and never travels with a branch. It is keyed by suite path and
holds the hash of files on disk at the time, so a result recorded on one tree is reused on another only
if every file the suite reads is byte-identical there. Local only: no network, no Chrome here.
"""
import fnmatch, glob, hashlib, io, json, os, re, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_CACHE = os.path.expanduser('~/venue-enrich/reports/suite-cache/cache.json')
PAGE_EXT = ('.html', '.js', '.css', '.py', '.json')
SKIP_DIRS = ('node_modules', '.git', 'shots', 'docs')
PATHLIKE = re.compile(r'[A-Za-z0-9_][\w./-]*\.(?:html|js|css|py|json)')


def cache_path():
    return os.environ.get('VP_SUITE_CACHE') or DEFAULT_CACHE


def load_config(root):
    p = os.path.join(root, 'tools', 'suite-areas.json')
    if not os.path.isfile(p):
        p = os.path.join(HERE, 'suite-areas.json')
    try:
        with io.open(p, encoding='utf-8') as fh:
            return json.load(fh)
    except (IOError, OSError, ValueError):
        return {'order': ['other'], 'words': {}, 'suites': {}, 'shared': []}


def _read(path):
    try:
        with io.open(path, 'rb') as fh:
            return fh.read()
    except (IOError, OSError):
        return None


def file_sha(path):
    b = _read(path)
    return 'missing' if b is None else hashlib.sha256(b).hexdigest()


_INDEX = {}


def _tree_index(root):
    """{leaf name: [rel paths]} for every candidate file in the tree (walked once per root per process)."""
    if root in _INDEX:
        return _INDEX[root]
    idx = {}
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith('.')]
        for f in files:
            if f.endswith(PAGE_EXT):
                rel = os.path.relpath(os.path.join(d, f), root)
                idx.setdefault(f, []).append(rel)
    _INDEX[root] = idx
    return idx


def forget_index():
    _INDEX.clear()


GENERIC = ('index.html', 'play.html', 'screen.html', 'host.html', 'app.js', 'index.js', 'style.css')


def reads(root, suite, cfg=None):
    """Sorted rel paths of every file this suite is counted as reading (see the module doc)."""
    cfg = cfg or load_config(root)
    out = {suite}
    src = _read(os.path.join(root, suite))
    text = (src or b'').decode('utf-8', 'replace')
    idx = _tree_index(root)
    for tok in set(PATHLIKE.findall(text)):
        cand = tok.lstrip('./')
        if os.path.isfile(os.path.join(root, cand)):
            out.add(cand)
        leaf = os.path.basename(tok)
        if leaf in GENERIC:
            # a bare index.html names every index.html in the tree: only count it with its parent folder
            parent = os.path.basename(os.path.dirname(tok))
            if not parent:
                continue
            for rel in idx.get(leaf, []):
                if rel.endswith(parent + '/' + leaf):
                    out.add(rel)
        elif leaf in idx and leaf != os.path.basename(suite) and not re.search(r'\.test\.(py|js)$|^test-.*\.js$', leaf):
            for rel in idx[leaf]:
                out.add(rel)
    for pat in cfg.get('shared', []):
        for f in glob.glob(os.path.join(root, pat)):
            if os.path.isfile(f):
                out.add(os.path.relpath(f, root))
    return sorted(out)


def fingerprint(root, suite, cfg=None):
    """(sha256 over (path, file sha) of everything the suite reads, the file list)."""
    files = reads(root, suite, cfg)
    h = hashlib.sha256()
    for rel in files:
        h.update(rel.encode() + b'\0' + file_sha(os.path.join(root, rel)).encode() + b'\n')
    return h.hexdigest(), files


def load(path=None):
    try:
        with io.open(path or cache_path(), encoding='utf-8') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except (IOError, OSError, ValueError):
        return {}


def save(data, path=None):
    path = path or cache_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.cache-', dir=os.path.dirname(path))
    with os.fdopen(fd, 'w') as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
    os.replace(tmp, path)


def lookup(suite, digest, path=None):
    """The cache entry when this suite last passed on exactly these files, else None."""
    e = load(path).get(suite)
    return e if e and e.get('hash') == digest and e.get('passed') is True else None


def record_pass(suite, digest, seconds, summary, path=None, now=None):
    """ONLY for a caller that has judged a pass. Failures, timeouts and errors never come here."""
    data = load(path)
    t = now or time.time()
    data[suite] = {'passed': True, 'hash': digest, 'time': t,
                   'time_text': time.strftime('%a %d %b %H:%M', time.localtime(t)),
                   'seconds': round(float(seconds), 1), 'summary': (summary or '')[:160]}
    save(data, path)


def drop(suites, path=None):
    data = load(path)
    for s in suites:
        data.pop(s, None)
    save(data, path)


def clock(entry):
    return time.strftime('%H:%M', time.localtime(entry['time']))


def main(argv):
    root = ROOT
    if '--root' in argv:
        root = os.path.abspath(argv[argv.index('--root') + 1])
    if '--clear' in argv:
        save({}); print('cache cleared (%s)' % cache_path()); return 0
    if '--forget' in argv:
        names = [a for a in argv[argv.index('--forget') + 1:] if not a.startswith('--')]
        drop(names); print('forgot %d suite(s)' % len(names)); return 0
    if '--list' in argv:
        data = load()
        cfg = load_config(root)
        print('# suite cache: %s (%d entries), tree %s' % (cache_path(), len(data), root))
        for s in sorted(data):
            e = data[s]
            if not os.path.isfile(os.path.join(root, s)):
                state = 'not in this tree'
            else:
                state = 'GREEN' if fingerprint(root, s, cfg)[0] == e.get('hash') else 'stale (a file it reads has changed)'
            print('  %-60s %s  last pass %s (%.0fs)' % (s, state, e.get('time_text', '?'), e.get('seconds', 0)))
        return 0
    print(__doc__); return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
