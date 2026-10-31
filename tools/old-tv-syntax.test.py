#!/usr/bin/env python3
"""EVERY SCRIPT A VENUE SCREEN RUNS MUST PARSE ON AN OLDER TELEVISION (1 Nov 2026).

The televisions venues already own run old browser engines: Samsung Tizen 5.5 is Chromium 69,
LG webOS 5 is Chromium 68, and a 2019 Samsung (Tizen 5.0) is Chromium 63. One piece of syntax
newer than the engine (an `a?.b`, an `x ?? y`, a `catch {}`, a class field) is a SyntaxError,
and a SyntaxError throws away the WHOLE script it is in: the wall stays on whatever the markup
painted and never connects to a game. A newer method (`.replaceAll`, `Object.fromEntries`,
`structuredClone`) parses but throws the first time it runs.

So this PARSES every script the screens load, the way an old engine would: as ECMAScript 2017
(esprima, already on this Mac), refusing object spread and rest (ES2018), and refusing the
ES2018 regular expression features (named groups, lookbehind, the s flag, \\p{...}), which esprima
itself lets through. Then it reads the parsed TOKENS, so comments and strings cannot set it off,
for methods and globals newer than Chromium 63. `globalThis` is allowed only behind `typeof`.

Which scripts: tv.html and every venueplay/app/*/screen.html (found, not listed, so a new screen
is covered the day it is added), each inline <script>, and each /app/ script they load. And
every one of those pages must load /app/vp-oldtv.js in its <head>, after its <style>, which is
what lets an old engine read the CSS (tools/old-tv-in-chrome.test.py runs it).

    python3 tools/old-tv-syntax.test.py
"""
import glob, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'venueplay')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

try:
    import esprima
except Exception as e:                      # never pass by not looking
    print('  FAIL esprima (the ES2017 parser) is not importable: %s' % e)
    print('\n0 of 1 checks passed')
    sys.exit(1)

PAGES = ['tv.html'] + sorted(os.path.relpath(p, SITE) for p in glob.glob(os.path.join(SITE, 'app', '*', 'screen.html')))

# Methods and globals newer than Chromium 63, as tokens: (token, what it needs)
NEWER = {
    'globalThis': 'Chromium 71', 'queueMicrotask': 'Chromium 71', 'structuredClone': 'Chromium 98',
    'fromEntries': 'Chromium 73', 'flatMap': 'Chromium 69', 'matchAll': 'Chromium 73', 'replaceAll': 'Chromium 85',
    'allSettled': 'Chromium 76', 'randomUUID': 'Chromium 92', 'trimStart': 'Chromium 66', 'trimEnd': 'Chromium 66',
    'hasOwn': 'Chromium 93', 'findLast': 'Chromium 97', 'findLastIndex': 'Chromium 97', 'replaceChildren': 'Chromium 86',
    'toggleAttribute': 'Chromium 69', 'requestIdleCallback': 'Chromium 47, but never on Safari', 'AggregateError': 'Chromium 85',
    'WeakRef': 'Chromium 84', 'FinalizationRegistry': 'Chromium 84', 'toSorted': 'Chromium 110', 'toReversed': 'Chromium 110',
}
# Only as a method call (a property called "at" or "flat" on our own objects is fine)
NEWER_METHOD = {'at': 'Chromium 92', 'flat': 'Chromium 69', 'any': 'Promise.any, Chromium 85'}


def scripts_of(page):
    """[(name, code)] for one page: each inline script and each /app/ script it loads."""
    s = io.open(os.path.join(SITE, page), encoding='utf-8').read()
    out = []
    for i, m in enumerate(re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)):
        out.append(('%s inline script %d' % (page, i + 1), m.group(1)))
    for m in re.finditer(r'<script[^>]*\bsrc="(/app/[^"]+\.js)"', s):
        f = os.path.join(SITE, m.group(1).lstrip('/'))
        if os.path.isfile(f):
            out.append((m.group(1), io.open(f, encoding='utf-8').read()))
        else:
            out.append((m.group(1), None))
    return out


def es2018_nodes(tree):
    """Object spread/rest, which esprima 4 accepts and an ES2017 engine does not."""
    found = []
    def walk(n):
        if isinstance(n, list):
            for x in n: walk(x)
            return
        if not hasattr(n, 'type'):
            return
        if n.type == 'ObjectExpression':
            for p in n.properties or []:
                if getattr(p, 'type', '') == 'SpreadElement': found.append('object spread {...x}')
        if n.type == 'ObjectPattern':
            for p in n.properties or []:
                if getattr(p, 'type', '') == 'RestElement': found.append('object rest {...x} =')
        for k, v in vars(n).items():
            if k in ('type', 'loc', 'range'): continue
            if isinstance(v, list) or hasattr(v, 'type'): walk(v)
    walk(tree)
    return found


def regex_problems(tok):
    pat, flags = tok.regex.pattern, tok.regex.flags
    out = []
    if 's' in flags: out.append('the s flag')
    if 'd' in flags: out.append('the d flag')
    if 'v' in flags: out.append('the v flag')
    # strip escaped characters and character classes before looking for group syntax
    body = re.sub(r'\\.', 'x', pat)
    body = re.sub(r'\[[^\]]*\]', 'x', body)
    if re.search(r'\(\?<[=!]', body): out.append('a lookbehind (?<= or (?<!')
    if re.search(r'\(\?<[A-Za-z_$]', body): out.append('a named group (?<name>')
    if re.search(r'\\[pP]\{', pat): out.append('a \\p{...} property escape')
    return out


def api_problems(tokens):
    out = []
    for i, t in enumerate(tokens):
        if t.type != 'Identifier':
            continue
        v = t.value
        prev = tokens[i - 1] if i else None
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        if v in NEWER:
            if v == 'globalThis' and prev is not None and prev.type == 'Keyword' and prev.value == 'typeof':
                continue
            # `x ? globalThis : this` behind a typeof test on the same line is the guarded form
            if v == 'globalThis' and any(tokens[j].value == 'typeof' and tokens[j + 1].value == 'globalThis'
                                         for j in range(max(0, i - 12), i) if j + 1 < len(tokens)):
                continue
            out.append('%s (%s), line %s' % (v, NEWER[v], t.loc.start.line if t.loc else '?'))
        elif v in NEWER_METHOD and prev is not None and prev.value == '.' and nxt is not None and nxt.value == '(':
            out.append('.%s() (%s), line %s' % (v, NEWER_METHOD[v], t.loc.start.line if t.loc else '?'))
    return out


print('THE SCRIPTS EVERY VENUE SCREEN RUNS, parsed as an older television would')
ok('the screens are all found (tv.html and every app/*/screen.html)', len(PAGES) >= 6, PAGES)
seen = {}
for page in PAGES:
    for name, code in scripts_of(page):
        if name in seen:
            continue
        seen[name] = True
        if code is None:
            ok('%s: the script %s exists' % (page, name), False, 'missing'); continue
        try:
            tree = esprima.parseScript(code, {'loc': True, 'tokens': True})
            tokens = tree.tokens
            perr = ''
        except Exception as e:
            tree, tokens, perr = None, [], str(e)
        ok('%s parses as ECMAScript 2017' % name, not perr, perr)
        if tree is None:
            continue
        ok('%s: no object spread or rest (ES2018)' % name, not es2018_nodes(tree), es2018_nodes(tree)[:3])
        rx = []
        for t in tokens:
            if t.type == 'RegularExpression':
                for p in regex_problems(t):
                    rx.append('/%s/%s: %s' % (t.regex.pattern[:40], t.regex.flags, p))
        ok('%s: no ES2018 regular expression features' % name, not rx, rx[:3])
        api = api_problems(tokens)
        ok('%s: no method or global newer than Chromium 63, unguarded' % name, not api, api[:4])

print('\nEVERY SCREEN LOADS THE OLD-ENGINE CSS FALLBACK IN ITS HEAD')
for page in PAGES:
    s = io.open(os.path.join(SITE, page), encoding='utf-8').read()
    head = s[:s.find('</head>')] if '</head>' in s else ''
    tag = head.find('<script src="/app/vp-oldtv.js"></script>')
    st = head.rfind('</style>')
    ok('%s loads /app/vp-oldtv.js in its <head>, after its <style>' % page, tag >= 0 and st >= 0 and tag > st, (tag, st))

# The detector must be able to see what it is looking for (a scan that cannot match is a check that
# cannot fail): run it over known-bad samples.
print('\nTHE DETECTORS SEE WHAT THEY ARE FOR')
for code, why in (('var a = b?.c;', 'optional chaining'), ('var a = b ?? c;', 'nullish'), ('try{}catch{}', 'optional catch')):
    try:
        esprima.parseScript(code); refused = False
    except Exception:
        refused = True
    ok('an ES2020 sample is refused: %s' % why, refused)
ok('object spread is seen', bool(es2018_nodes(esprima.parseScript('var a = {...b};'))))
def toks(code): return esprima.parseScript(code, {'loc': True, 'tokens': True}).tokens
ok('a lookbehind and the s flag are seen', len([p for t in toks('var r=/(?<=a)b/s;') if t.type == 'RegularExpression' for p in regex_problems(t)]) == 2)
ok('.replaceAll() is seen, and in a comment it is not', bool(api_problems(toks('s.replaceAll("a","b")')))
   and not api_problems(toks('// s.replaceAll("a","b")\nvar x=1;')))
ok('a bare globalThis is seen, a typeof-guarded one is not', bool(api_problems(toks('var g=globalThis;')))
   and not api_problems(toks('var g=typeof globalThis!=="undefined"?globalThis:this;')))

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
