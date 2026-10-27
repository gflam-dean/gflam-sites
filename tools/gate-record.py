#!/usr/bin/env python3
"""THE PRE-PUSH GATE'S RECORD OF WHAT IT GATED, so release.py does not run the same Chrome twice.

    python3 tools/gate-record.py --write        the pre-push hook, after release-check.py --local is green
    python3 tools/gate-record.py --decide       print the step-5 decision for this tree and exit 0 (skip) or 1 (full)

WHY (27 Oct 2026). release.py step 1 pushes, and the pre-push hook runs the whole local gate on the
tree being pushed: 15 Chrome suites, 26 to 27 minutes. Step 5 then runs release-check.py again,
which runs the same 15 Chrome suites on the identical tree, minutes later. Twice per release,
observed today. The live half of step 5 is the point of step 5 (is the release UP, does Pages
serve it, does the live database match); the Chrome half has nothing new to say about a tree it
just judged.

So the hook, once its gate is GREEN, writes a small record the gate owns, tools/gate-record.json
(ignored by git, never committed): the tree it gated (git rev-parse HEAD^{tree}: the content, not
the commit, so a commit message or a rebase that leaves the files alone still matches), the
commit, and the time. release.py step 5 reads it and, ONLY when the recorded tree is this tree and
the record is under MAX_AGE_S old, runs release-check.py --skip-chrome (every other local check and
the whole live half) and prints exactly why. Any other state (no record, another tree, too old, a
dirty tree, an unreadable record) is the full gate, as before, with the reason printed.

What "this tree" means: the tree hash is only the truth when the gated folders are clean, so the
record is refused (not written) over a dirty tree, and never matches one. The hook and release.py
step 0 both refuse a dirty tree already; this is the same rule in the same words.

The record is written ONLY on a green gate. A red gate writes nothing and REMOVES any record for
this tree, so a tree that failed can never ride an older record.
"""
import io, json, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECORD = os.path.join('tools', 'gate-record.json')
GATED_DIRS = ['venueplay', 'partyplay', 'venueplay-backend', 'partyplay-backend', 'tools']
MAX_AGE_S = 2 * 60 * 60


def _git(root, *args):
    r = subprocess.run(['git'] + list(args), cwd=root, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ''


def current_tree(root):
    """(tree hash, head sha, dirty text). The tree hash is '' when the gated folders are dirty: a
    tree with uncommitted edits has no honest hash."""
    dirty = _git(root, 'status', '--porcelain', '--', *GATED_DIRS)
    dirty = '\n'.join(l for l in dirty.splitlines() if not (l.startswith('?? ') and '.backup-' in l))
    tree = _git(root, 'rev-parse', 'HEAD^{tree}')
    head = _git(root, 'rev-parse', 'HEAD')
    if dirty or not tree:
        return '', head, dirty or 'no HEAD'
    return tree, head, ''


def record_path(root):
    return os.path.join(root, RECORD)


def read_record(root):
    try:
        with io.open(record_path(root), encoding='utf-8') as fh:
            d = json.load(fh)
        if not isinstance(d, dict) or not d.get('tree') or not isinstance(d.get('time'), (int, float)):
            return None
        return d
    except Exception:
        return None


def write_record(root, now=None, gate='release-check.py --local', by='pre-push'):
    """Write the record for the CURRENT tree. Returns (ok, text). Refuses over a dirty tree."""
    tree, head, dirty = current_tree(root)
    if not tree:
        return False, 'not recorded: the gated folders are dirty, so the tree has no honest hash:\n' + dirty[:400]
    now = time.time() if now is None else now
    d = {'tree': tree, 'head': head, 'time': now, 'when': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now)),
         'gate': gate, 'by': by}
    tmp = record_path(root) + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, indent=1, sort_keys=True)
        fh.write('\n')
    os.replace(tmp, record_path(root))
    return True, 'recorded: tree %s (commit %s) gated green by %s at %s' % (tree[:12], head[:8], by, d['when'])


def clear_record(root):
    try:
        os.remove(record_path(root))
        return True
    except FileNotFoundError:
        return False


def decide(root, now=None, max_age_s=MAX_AGE_S):
    """(skip_chrome, reason). skip_chrome is True ONLY when the record names this exact tree and is
    under max_age_s old. The reason is one plain sentence, printed by release.py either way."""
    now = time.time() if now is None else now
    tree, head, dirty = current_tree(root)
    rec = read_record(root)
    if not tree:
        return False, 'full gate: the tree is dirty, so nothing recorded can be this tree (%s)' % (dirty.splitlines() or ['no HEAD'])[0][:80]
    if rec is None:
        if os.path.isfile(record_path(root)):
            return False, 'full gate: tools/gate-record.json is unreadable'
        return False, 'full gate: no record of a pre-push gate (tools/gate-record.json is not here)'
    age = now - rec['time']
    if rec['tree'] != tree:
        return False, ('full gate: the pre-push gate ran on tree %s at %s and this is tree %s (commit %s), so the Chrome suites have not judged these files'
                       % (rec['tree'][:12], rec.get('when', '?'), tree[:12], head[:8]))
    if age < 0:
        return False, 'full gate: the record is dated in the future (%s), so the clock cannot be trusted' % rec.get('when', '?')
    if age >= max_age_s:
        return False, ('full gate: the pre-push gate ran on this tree (%s) but %d minutes ago, over the %d hour limit'
                       % (tree[:12], age // 60, max_age_s // 3600))
    return True, ('Chrome suites skipped: the pre-push gate ran all of them green on this same tree (%s, commit %s) %d minute(s) ago at %s, under the %d hour limit; '
                  'running release-check.py --skip-chrome, which is every other local check plus the whole live half'
                  % (tree[:12], rec.get('head', '')[:8], age // 60, rec.get('when', '?'), max_age_s // 3600))


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    root = ROOT
    if '--root' in argv:
        root = argv[argv.index('--root') + 1]
    if '--write' in argv:
        good, text = write_record(root)
        print('  gate record: ' + text)
        return 0 if good else 1
    if '--clear' in argv:
        print('  gate record: %s' % ('removed' if clear_record(root) else 'none to remove'))
        return 0
    if '--decide' in argv:
        skip, why = decide(root)
        print('  ' + why)
        return 0 if skip else 1
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
