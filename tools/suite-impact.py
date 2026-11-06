#!/usr/bin/env python3
"""WHICH SUITES A BRANCH WILL TURN RED, BEFORE IT IS MERGED (4 Nov 2026).

    python3 tools/suite-impact.py <base> <branch>              static: tokens the branch removes, who reads them
    python3 tools/suite-impact.py <base> <branch> --merge      also a trial merge in a temp worktree: conflicts,
                                                               prove rows that stop applying, ledger drift
    python3 tools/suite-impact.py <base> dir:<worktree>        a branch with UNCOMMITTED work: read its files from disk

Why: every red on the 4 Nov gate was a suite still asserting a layout, an id or a line of copy that a
branch had changed ON PURPOSE. The branch's own suites were green; the OTHER suites that read the same
page were never run against it, so the merge was the first time anybody looked. This reads the branch's
diff for everything a page stops having (ids, classes, data-* hooks, lines of copy, element ids a script
looks up) and names every suite and every prove-checks row that still mentions it. Run it on a branch
BEFORE the merge, fix or pre-adapt what it names, and the merge is green first time.

What it does NOT do: it cannot see a check that measures layout (a pixel, an order) without naming a token,
and it cannot see a token that stays in the file but moves (a field folded away keeps its id). Those are
caught only by running the suites it names against the merged tree, which `--merge` leaves ready in a
temp worktree (printed; delete it with `git worktree remove`). Everything here is local git: no remote.
"""
import io, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE_DIRS = ('venueplay/', 'partyplay/', 'venueplay-backend/worker/', 'partyplay-backend/', 'touring-backend/', 'gflam/')
PAGE_EXT = ('.html', '.js', '.css')
SUITE_RX = re.compile(r'(\.test\.(py|js)$|^tools/test-.*\.js$)')


def git(*args, cwd=ROOT, ok=True):
    r = subprocess.run(['git'] + list(args), cwd=cwd, capture_output=True, text=True)
    if r.returncode and ok:
        raise SystemExit('git %s failed: %s' % (' '.join(args[:3]), r.stderr.strip()[:200]))
    return r.stdout


def show(ref, path):
    """The file at a ref, or on disk when ref is dir:<worktree> (a branch with UNCOMMITTED work)."""
    if ref.startswith('dir:'):
        try:
            return io.open(os.path.join(ref[4:], path), encoding='utf-8', errors='replace').read()
        except (IOError, OSError):
            return None
    r = subprocess.run(['git', 'show', '%s:%s' % (ref, path)], cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def diff_names(base, branch):
    """Files that differ between base and branch; for dir:<worktree> the worktree's own uncommitted diff plus its commits."""
    if branch.startswith('dir:'):
        wt = branch[4:]
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=wt, capture_output=True, text=True).stdout.strip()
        names = set(git('diff', '--name-only', '%s...%s' % (base, head), ok=False).split())
        names |= set(subprocess.run(['git', 'diff', '--name-only', 'HEAD'], cwd=wt, capture_output=True, text=True).stdout.split())
        return sorted(names)
    return git('diff', '--name-only', '%s...%s' % (base, branch)).split()


ID_RX = re.compile(r'''\bid=["']([A-Za-z][\w-]*)["']''')
GETID_RX = re.compile(r'''getElementById\(\s*["']([A-Za-z][\w-]*)["']''')
QSEL_RX = re.compile(r'''querySelector(?:All)?\(\s*["']([^"']{2,80})["']''')
CLASS_RX = re.compile(r'''\bclass=["']([^"']+)["']''')
DATA_RX = re.compile(r'''\b(data-[a-z][\w-]*)=''')
COPY_RX = re.compile(r'''[>"'](?:\s*)([A-Z][A-Za-z0-9,.'$%()\- ]{13,}?[a-z.?!)])(?:\s*)[<"']''')
CSS_SEL_RX = re.compile(r'''(?m)^\s*((?:[.#][A-Za-z][\w-]*)(?:[^{]*?))\s*\{''')


def tokens(text):
    """{token: kind} for everything a suite could be pinned to in this text."""
    out = {}
    for m in ID_RX.finditer(text):
        out[m.group(1)] = 'id'
    for m in GETID_RX.finditer(text):
        out[m.group(1)] = 'id'
    for m in CLASS_RX.finditer(text):
        for c in m.group(1).split():
            if len(c) > 2:
                out[c] = 'class'
    for m in DATA_RX.finditer(text):
        out[m.group(1)] = 'data-attr'
    for m in QSEL_RX.finditer(text):
        for c in re.findall(r'[.#]([A-Za-z][\w-]*)', m.group(1)):
            out[c] = 'selector'
    for m in COPY_RX.finditer(text):
        s = m.group(1).strip()
        if ' ' in s and not s.startswith(('function', 'var ', 'return')):
            out[s] = 'copy'
    for m in CSS_SEL_RX.finditer(text):
        for c in re.findall(r'[.#]([A-Za-z][\w-]*)', m.group(1)):
            out[c] = 'css'
    return {t: k for t, k in out.items() if k == 'copy' or len(t) >= 3}


def changed_pages(base, branch):
    names = diff_names(base, branch)
    return [n for n in names if n.startswith(PAGE_DIRS) and n.endswith(PAGE_EXT)]


def gone_tokens(base, branch, path):
    """Tokens the branch REMOVES from `path`: in the merge-base's copy (what the branch started from) and
    nowhere in the branch's copy. Judged against the merge-base, not the base: a hook the base added while
    the branch was away is kept by the merge, and would otherwise read as removed by the branch."""
    before, after = show(merge_base(base, branch), path), show(branch, path)
    if before is None:
        return {}
    after = after or ''
    tb, ta = tokens(before), tokens(after)
    gone = {}
    for t, kind in tb.items():
        if t in ta:
            continue
        # still in the file in some other spelling (a class moved into a shared CSS file keeps its name here)
        if kind != 'copy' and re.search(r'(?<![\w-])' + re.escape(t) + r'(?![\w-])', after):
            continue
        if kind == 'copy' and t in after:
            continue
        gone[t] = kind
    return gone


_MB = {}


def merge_base(base, branch):
    if branch.startswith('dir:'):
        wt = branch[4:]
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=wt, capture_output=True, text=True).stdout.strip()
        return _MB.setdefault((base, branch), git('merge-base', base, head).strip())
    return _MB.setdefault((base, branch), git('merge-base', base, branch).strip())


def suite_files(base, branch):
    """Every suite as the MERGED tree would have it: the branch's copy where it changed one, else the base's."""
    names = set(git('ls-tree', '-r', '--name-only', base).split())
    if not branch.startswith('dir:'):
        names |= set(git('ls-tree', '-r', '--name-only', branch).split())
    changed = set(diff_names(base, branch))
    out = {}
    for n in sorted(names):
        if not SUITE_RX.search(n) or '/node_modules/' in n or n.startswith('.'):
            continue
        src = show(branch, n) if n in changed else show(base, n)
        if src is None:
            src = show(branch, n)
        if src is not None:
            out[n] = src
    # prove-checks rows read pages too
    pc = show(branch, 'tools/prove-checks.py') or show(base, 'tools/prove-checks.py') or ''
    out['tools/prove-checks.py'] = pc
    return out


def mentions(src, token, kind):
    if kind == 'copy':
        return token in src
    return re.search(r'(?<![\w-])' + re.escape(token) + r'(?![\w-])', src) is not None


def ledger_drift(base, branch):
    if branch.startswith('dir:'):
        return '(worktree)', ['(ledger drift is judged on commits; commit the branch and run again)']
    mb = git('merge-base', base, branch).strip()
    def load(ref):
        try:
            return json.loads(show(ref, 'tools/suite-counts.json') or '{}')
        except ValueError:
            return {}
    b0, br, ba = load(mb), load(branch), load(base)
    rows = []
    for k in sorted(set(b0) | set(br) | set(ba)):
        v0, v1, v2 = (b0.get(k) or {}).get('checks'), (br.get(k) or {}).get('checks'), (ba.get(k) or {}).get('checks')
        if v1 != v0 and v2 != v0 and v1 != v2:
            rows.append('BOTH CHANGED  %s: merge-base %s, branch %s, %s %s. The ledger after the merge must be a REAL run on the merged tree, not either number.' % (k, v0, v1, base, v2))
        elif v1 != v0:
            rows.append('branch delta  %s: %s -> %s (carry into the merged ledger)' % (k, v0, v1))
        elif v1 is not None and v2 is not None and v2 > v1 and v2 != v0:
            rows.append('%s grew  %s: %s -> %s while the branch was away; after the merge the suite must still run at least %s' % (base, k, v0, v2, v2))
    return mb, rows


def trial_merge(base, branch):
    d = tempfile.mkdtemp(prefix='suite-impact-')
    wt = os.path.join(d, 'wt')
    git('worktree', 'add', '--detach', wt, base)
    r = subprocess.run(['git', 'merge', '--no-commit', '--no-ff', branch], cwd=wt, capture_output=True, text=True)
    conflicts = subprocess.run(['git', 'diff', '--name-only', '--diff-filter=U'], cwd=wt, capture_output=True, text=True).stdout.split()
    lst = ''
    if os.path.isfile(os.path.join(wt, 'tools', 'prove-checks.py')):
        try:
            lst = subprocess.run([sys.executable, 'tools/prove-checks.py', '--list'], cwd=wt, capture_output=True, text=True, timeout=180).stdout
        except subprocess.TimeoutExpired:
            lst = '(--list did not finish in 180 s)'
    rot = [l.strip() for l in lst.splitlines() if re.match(r'^\s*(NEVER|AMBIG|GONE)\b', l)]
    tail = [l.strip() for l in lst.splitlines() if 'apply' in l or 'SKIPPED' in l]
    return wt, conflicts, rot, tail


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        print(__doc__); return 2
    base, branch = args
    print('# suite-impact: %s onto %s' % (branch, base))
    print('# %s' % (branch if branch.startswith('dir:') else git('log', '--oneline', '-1', branch).strip()))
    pages = changed_pages(base, branch)
    print('\n## Pages the branch changes (%d)' % len(pages))
    for p in pages:
        print('  ' + p)
    suites = suite_files(base, branch)
    changed = set(diff_names(base, branch))
    hits = {}     # suite -> [(page, token, kind)]
    total_gone = 0
    for p in pages:
        gone = gone_tokens(base, branch, p)
        total_gone += len(gone)
        for t, kind in gone.items():
            for s, src in suites.items():
                if s == p:
                    continue
                if mentions(src, t, kind):
                    hits.setdefault(s, []).append((p, t, kind))
    print('\n## Suites and prove rows that still name something the branch removes (%d tokens gone, %d readers)' % (total_gone, len(hits)))
    if not hits:
        print('  none found by token. Layout-only checks are not visible here: run the suites that open these pages.')
    for s in sorted(hits, key=lambda x: (x in changed, x)):
        tag = 'ALREADY EDITED BY THE BRANCH, check it' if s in changed else 'NOT touched by the branch: will go red or go blind'
        print('\n  %s   [%s]' % (s, tag))
        for p, t, kind in sorted(set(hits[s]))[:12]:
            print('     %-9s %-40s (was in %s)' % (kind, t[:40], p))
        if len(set(hits[s])) > 12:
            print('     ... %d more' % (len(set(hits[s])) - 12))
    # suites that open the changed pages at all (by path), even without a gone token
    openers = []
    for s, src in suites.items():
        if s == 'tools/prove-checks.py' or s in changed:
            continue
        for p in pages:
            leaf = os.path.basename(p)
            if leaf in ('index.html', 'play.html', 'screen.html', 'host.html'):
                leaf = '/'.join(p.split('/')[-2:])
            if leaf in src and s not in hits:
                openers.append((s, p)); break
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import gatelib
    chrome = [(s, p) for s, p in openers if gatelib.uses_chrome(os.path.join(ROOT, s))]
    print('\n## Chrome suites that open one of these pages and were not changed by the branch (%d of %d readers): run them on the merged tree, one at a time'
          % (len(chrome), len(openers)))
    for s, p in sorted(chrome):
        print('  %-55s %s' % (s, p))
    rest = sorted(set(s for s, p in openers) - set(s for s, p in chrome))
    if rest:
        print('  plus %d jsc suites that read these files; the gate runs them all in a few minutes (release-check.py --local --skip-chrome)' % len(rest))
    mb, drift = ledger_drift(base, branch)
    print('\n## Ledger (tools/suite-counts.json), merge-base %s' % mb[:8])
    for r in drift or ['  no drift']:
        print('  ' + r)
    if '--merge' in sys.argv and not branch.startswith('dir:'):
        wt, conflicts, rot, tail = trial_merge(base, branch)
        print('\n## Trial merge (local, in %s)' % wt)
        print('  conflicts: %s' % (', '.join(conflicts) if conflicts else 'none'))
        if 'tools/prove-checks.py' in conflicts:
            print('  prove-checks.py is in conflict, so its rows could not be listed here: resolve (keep both sides\' rows, drop a row whose anchor the other side moved) and run python3 tools/prove-checks.py --list')
        for l in rot:
            print('  prove row: ' + l)
        for l in tail:
            print('  ' + l)
        print('  (remove with: git worktree remove --force %s)' % wt)
    return 0


if __name__ == '__main__':
    sys.exit(main())
