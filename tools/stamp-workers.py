#!/usr/bin/env python3
"""Put a fingerprint in every Worker, so you can see what is actually deployed.

The problem this solves: a Worker is deployed by pasting it into a browser. There
is no build, no version, no way to tell from outside which copy is running. So
"did I paste that?" is unanswerable, and today it was asked about a fix that
changes whether a discount can be applied at all.

Each Worker carries one line:

    const BUILD = '28 Aug 2026, 11:42 · a1b2c3d4';

The time is the readable half: paste a Worker, hit /health, and you can see at a
glance when what is running was written. The eight characters after it are a hash
of the file with the stamp line removed, which is the half a machine compares.

The time is when the CODE last changed, not when this tool last ran: if the hash
still matches, the line is left exactly as it was. So re-running this never
churns the stamp, and a stamp that has not moved means nothing has moved.

    python3 tools/stamp-workers.py          stamp any that have changed
    python3 tools/stamp-workers.py --check   fail if any is unstamped (for the hook)
"""
import datetime, hashlib, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKERS = [
    'venueplay-backend/worker/venueplay-game.js',
    'venueplay-backend/worker/venueplay-api-FULL.js',
    'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
]
LINE = re.compile(r"^const BUILD = '[^']*';.*$", re.M)
# For hashing: exactly the stamp line and its own newline. NOT the blank lines
# around it. An earlier version used \n* on both sides, which greedily ate a
# blank line that belonged to the file, so a stamped file hashed differently from
# the same file unstamped, and the stamp could never agree with its own contents.
# The pre-push gate caught that, on my own push, which is what it is for.
FOR_HASH = re.compile(r"^const BUILD = '[^']*';.*\n", re.M)
STAMP = re.compile(r"^const BUILD = '(?:.*\u00b7 )?([0-9a-f]{8})';", re.M)


def _write_atomic(path, text):
    """Write to a neighbour and rename over the top.

    open(path, 'w') truncates FIRST and writes second, so a process that dies in
    between leaves a nought byte file. That happened to venueplay-api-FULL.js on
    31 Aug: the source of the billing Worker, emptied on disk, while the pre-push
    gate said every script parses. An empty file parses perfectly.

    os.replace is atomic on this filesystem, so the file at `path` is either the
    old contents or the new ones, never nothing.
    """
    tmp = path + '.writing'
    with io.open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def fingerprint(src):
    """Of the file WITHOUT its stamp, or stamping would change the answer.

    The surrounding blank lines go too: an unstamped file and the same file
    stamped must hash identically, or the tool can never agree with itself.
    """
    return hashlib.sha256(FOR_HASH.sub('', src).encode('utf-8')).hexdigest()[:8]


def stamp(path, check_only=False):
    p = os.path.join(ROOT, path)
    src = io.open(p, encoding='utf-8').read()
    want = fingerprint(src)
    when = datetime.datetime.now().strftime('%-d %b %Y, %H:%M')
    line = ("const BUILD = '%s \u00b7 %s';   // tools/stamp-workers.py, do not edit by hand"
            % (when, want))

    m = LINE.search(src)
    if m:
        had = STAMP.search(src)
        # Same code, so leave the time alone. The stamp should say when the code
        # last changed, not when this tool last ran.
        if had and had.group(1) == want:
            return 'unchanged', had.group(0).split("'")[1]
        if check_only:
            return 'STALE', want
        src = LINE.sub(lambda _m: line, src, count=1)
    else:
        if check_only:
            return 'MISSING', want
        # after the opening comment block, before the first line of code
        anchor = src.find('*/')
        at = src.index('\n', anchor) + 1 if anchor != -1 else 0
        src = src[:at] + line + '\n' + src[at:]
    # The stamp must describe the file it is sitting in. If writing it changes
    # the answer, the tool disagrees with itself and every later check is noise.
    if fingerprint(src) != want:
        raise SystemExit('stamping changed the fingerprint of %s (%s -> %s). '
                         'The tool is wrong, not the file.' % (path, want, fingerprint(src)))
    _write_atomic(p, src)
    return 'stamped', want


def main():
    check_only = '--check' in sys.argv
    bad = 0
    for w in WORKERS:
        state, fp = stamp(w, check_only)
        if state in ('STALE', 'MISSING'):
            bad += 1
        print('  %-8s %-52s %s' % (state, os.path.basename(w), fp))
    if bad:
        print('\n  %d Worker(s) need stamping: run python3 tools/stamp-workers.py' % bad)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
