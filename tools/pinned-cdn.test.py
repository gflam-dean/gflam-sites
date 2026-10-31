#!/usr/bin/env python3
"""EVERY SCRIPT WE LOAD FROM A PUBLIC CDN NAMES ONE EXACT VERSION (1 Nov 2026).

Every VenuePlay and PartyPlay page loaded supabase-js as `.../@supabase/supabase-js@2`: whatever
2.x the CDN thought was newest that day. Nobody chose 2.118.0, it simply arrived, and with it a build
that uses optional chaining, `??`, `||=` and class fields, which a Samsung or LG set before about 2021
(Chromium 84 and older) cannot even parse. A release nobody made can change every screen, every
console and every phone overnight, and the gate would stay green, because nothing here changed.

So a script from an npm CDN (jsdelivr, unpkg, cdnjs, esm.sh, skypack) must name x.y.z. And because a
pinned version is only as good as everyone agreeing on it:
  - every page loads the SAME supabase-js version, and
  - every Chrome rig that swaps supabase-js for tools/browser-rig/fake-supabase.js swaps exactly that
    address. A rig still swapping an old one would let the real library load from the internet
    inside a test, talking to the live database.

Read from the files the sites ship (every .html and .js outside tools/ and dot folders), including
script addresses a script builds in a string. The scanner is run against known-bad samples first.

    python3 tools/pinned-cdn.test.py

It reads files only and starts no browser (GATELIB_NO_CHROME: it names the Chrome rigs, it does not run them).
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

CDN = re.compile(r'https?://(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|cdn\.skypack\.dev)/[^\s"\'<>)`]+', re.I)

def pinned(url):
    """Does this CDN address name one exact version?"""
    u = url.split('?')[0].split('#')[0]
    m = re.match(r'https?://cdn\.jsdelivr\.net/(?:npm|gh)/((?:@[^/@]+/)?[^/@]+)@([^/]+)', u, re.I)
    if m: return bool(re.match(r'^v?\d+\.\d+\.\d+([-+][\w.]+)?$', m.group(2)))
    m = re.match(r'https?://(?:unpkg\.com|esm\.sh|cdn\.skypack\.dev)/((?:@[^/@]+/)?[^/@]+)@([^/]+)', u, re.I)
    if m: return bool(re.match(r'^v?\d+\.\d+\.\d+([-+][\w.]+)?$', m.group(2)))
    m = re.match(r'https?://cdnjs\.cloudflare\.com/ajax/libs/[^/]+/([^/]+)/', u, re.I)
    if m: return bool(re.match(r'^\d+\.\d+\.\d+([-+][\w.]+)?$', m.group(1)))
    return False                                  # a CDN address with no version at all

def scan(text):
    return [m.group(0) for m in CDN.finditer(text)]

def shipped_files():
    for d, dirs, fs in os.walk(ROOT):
        rel = os.path.relpath(d, ROOT)
        dirs[:] = [x for x in dirs if not x.startswith('.') and x not in ('node_modules', 'tools', 'worktrees', '__pycache__')]
        if rel.split(os.sep)[0] in ('tools',):
            continue
        for f in fs:
            if f.endswith(('.html', '.js')) and not f.endswith(('.test.js',)):
                yield os.path.join(d, f)

print('THE SCANNER SEES WHAT IT IS FOR')
for u, want in (('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', False), ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js', False),
                ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@latest', False), ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118', False),
                ('https://unpkg.com/qrcode@1/build/qrcode.min.js', False), ('https://cdnjs.cloudflare.com/ajax/libs/jquery/3/jquery.min.js', False),
                ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0', True), ('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js', True),
                ('https://unpkg.com/react@18.3.1/umd/react.production.min.js', True), ('https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js', True)):
    ok('%s is %s' % (u, 'pinned' if want else 'NOT pinned'), pinned(u) == want)
ok('a script address built in a JS string is found', scan('s.src = "https://unpkg.com/x@1/y.js";') == ['https://unpkg.com/x@1/y.js'])

print('\nEVERY CDN SCRIPT THE SITES SHIP NAMES ONE EXACT VERSION')
found, loose, supa = 0, [], {}
for f in shipped_files():
    try:
        s = io.open(f, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    for u in scan(s):
        found += 1
        rel = os.path.relpath(f, ROOT)
        if not pinned(u):
            loose.append('%s: %s' % (rel, u))
        m = re.search(r'@supabase/supabase-js@([^/"\'\s<>)]+)', u)
        if m:
            supa.setdefault(m.group(1), []).append(rel)
ok('the CDN scripts are found at all (%d addresses)' % found, found >= 30, found)
ok('every one names an exact version', not loose, loose[:4])
ok('every page loads the same supabase-js version (%s)' % ', '.join(sorted(supa)), len(supa) == 1, {k: len(v) for k, v in supa.items()})

print('\nEVERY CHROME RIG SWAPS THAT EXACT ADDRESS FOR ITS STAND-IN')
want = ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@' + sorted(supa)[0]) if len(supa) == 1 else None
rigs = []
for d, dirs, fs in os.walk(os.path.join(ROOT, 'tools')):
    dirs[:] = [x for x in dirs if x != '__pycache__']
    for f in fs:
        if not f.endswith(('.py', '.js')) or f == 'pinned-cdn.test.py':
            continue
        p = os.path.join(d, f)
        s = io.open(p, encoding='utf-8', errors='replace').read()
        for m in re.finditer(r'https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@[\w.]+', s):
            rigs.append((os.path.relpath(p, ROOT), m.group(0)))
ok('the rigs that swap supabase-js are found (%d)' % len(set(r for r, _ in rigs)), len(set(r for r, _ in rigs)) >= 5, rigs)
wrong = ['%s: %s' % r for r in rigs if want is None or r[1] != want]
ok('every one swaps the address the pages load, so no test loads the real library', not wrong, wrong[:4])

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
