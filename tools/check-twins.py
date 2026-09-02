#!/usr/bin/env python3
"""The same thing, written in more than one place, and no longer saying the same.

Dean, after finding a rule fixed on the phone a month ago and still wrong on the
TV: "shall we maybe go through past changes... or even checking things that are
in multiple places?"

The second one, and this is it. Re-reading a month of commits cannot work: a diff
shows what changed, never whether the same thing exists in four other files. What
CAN be checked is duplication, because that is where a fix lands in one copy and
not the others. Every fault of that shape found this week - the claim copy, the
signing exemption comment, the venue code, the stale PartyPlay tree, two
migrations numbered 12 - was one thing written down more than once.

It reports two kinds:

  DIVERGED   the same function name in several files with DIFFERENT bodies. One
             of them has been fixed and the others have not, or they were never
             the same. This is the dangerous kind.

  TWINNED    the same function in several files with identical bodies. Not a
             fault today, and the thing most likely to become one: the next
             person fixes the copy in front of them.

Bodies are compared with comments and whitespace stripped, so a difference is a
difference in behaviour rather than in wording.

  check-twins.py [--quiet]
"""
import io, os, re, sys, collections, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOOK = ['venueplay', 'venueplay-backend/worker', 'partyplay', 'partyplay-backend/worker',
        'partyplay-backend/lib']
SKIP = re.compile(r'\.test\.js$|/DEPLOY-|node_modules')
QUIET = '--quiet' in sys.argv

# Names so generic that sharing one means nothing.
IGNORE = {'$', 'esc', 'json', 'ok', 'get', 'post', 'show', 'hide', 'pad', 'toast', 'flash',
          'money', 'fmt', 'clamp', 'log', 'main', 'init', 'render', 'load', 'save', 'send',
          'work', 'run', 'pass', 'read', 'write', 'sleep', 'wait', 'norm', 'nn', 'slug'}

def files():
    for rel in LOOK:
        base = os.path.join(ROOT, rel)
        for d, _, fs in os.walk(base) if os.path.isdir(base) else []:
            for f in sorted(fs):
                p = os.path.join(d, f)
                if (f.endswith('.html') or f.endswith('.js')) and not SKIP.search(p):
                    yield p

def strip(js):
    """Comments and ALL whitespace, so a difference is a difference in behaviour.

    The first version of this collapsed runs of whitespace instead of removing
    it, and immediately reported venueCode as two versions across eight files -
    the one function this codebase most wants kept in lockstep, and the one with
    printed signage behind it. The whole difference was `String(slug || "")`
    against `String(slug||"")`. All eight are identical.

    A checker that reports formatting as divergence is worse than no checker: it
    is read once, disbelieved, and ignored from then on."""
    js = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
    js = re.sub(r'(^|[^:])//[^\n]*', r'\1', js)
    return re.sub(r'\s+', '', js).strip()

def bodies(src):
    """Every `function name(...) { ... }`, with its body, brace-matched."""
    out = {}
    for m in re.finditer(r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\(', src):
        name = m.group(1)
        i = src.find('{', m.end())
        if i < 0:
            continue
        depth, j = 0, i
        while j < len(src):
            if src[j] == '{': depth += 1
            elif src[j] == '}':
                depth -= 1
                if depth == 0: break
            j += 1
        body = strip(src[i:j + 1])
        if len(body) > 40:
            out.setdefault(name, []).append(body)
    return out

seen = collections.defaultdict(list)
for p in files():
    try:
        src = io.open(p, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    for name, bs in bodies(src).items():
        if name in IGNORE or len(name) < 4:
            continue
        for b in bs:
            seen[name].append((os.path.relpath(p, ROOT), hashlib.sha1(b.encode()).hexdigest()[:8], b))

diverged, twinned = [], []
for name, entries in seen.items():
    places = {e[0] for e in entries}
    if len(places) < 2:
        continue
    shapes = {e[1] for e in entries}
    (diverged if len(shapes) > 1 else twinned).append((name, sorted(places), len(shapes)))

diverged.sort(key=lambda x: -len(x[1]))
twinned.sort(key=lambda x: -len(x[1]))

print('  %d function(s) live in more than one file' % (len(diverged) + len(twinned)))
print()
if diverged:
    print('  DIVERGED - same name, different behaviour. One copy may already be fixed:')
    for name, places, n in diverged:
        print('    %-26s %d versions across %s' % (name, n, ', '.join(places)))
    print()
if twinned and not QUIET:
    print('  TWINNED - identical today, and the next fix will land in one of them:')
    for name, places, _ in twinned:
        print('    %-26s %s' % (name, ', '.join(places)))
print()
print('  Diverged is a bug hunt. Twinned is a refactor: move it to venueplay/app/ and')
print('  load it, the way vp-session, vp-sign and vp-follow already are.')
sys.exit(1 if diverged else 0)
