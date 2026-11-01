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

print('\nNO PAGE NEEDS A PUBLIC CDN FOR ITS LIBRARIES, AND WHAT IS LEFT IS PINNED')
found, loose = 0, []
VENDOR_SRC = re.compile(r'<script[^>]*\bsrc="(/(?:app/)?vendor/[^"]+)"', re.I)
LIB_SRC = re.compile(r'<script[^>]*\bsrc="([^"]*(?:supabase-js|qrcode)[^"]*)"', re.I)
supa, qr, vendor_refs, missing, unversioned = {}, {}, 0, [], []
for f in shipped_files():
    try:
        s = io.open(f, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    rel = os.path.relpath(f, ROOT)
    if '/vendor/' in '/' + rel:
        continue                                  # the vendored libraries themselves
    for u in scan(s):
        found += 1
        if not pinned(u):
            loose.append('%s: %s' % (rel, u))
    for m in LIB_SRC.finditer(s):
        src = m.group(1)
        (supa if 'supabase-js' in src else qr).setdefault(src, []).append(rel)
    for m in VENDOR_SRC.finditer(s):
        vendor_refs += 1
        src = m.group(1)
        site = rel.split(os.sep)[0]
        disk = os.path.join(ROOT, site, src.lstrip('/'))
        if not os.path.isfile(disk):
            missing.append('%s: %s' % (rel, src))
        if not re.search(r'-\d+\.\d+\.\d+(\.min)?\.js$', src):
            unversioned.append('%s: %s' % (rel, src))
ok('every CDN script that is left names an exact version (%d addresses)' % found, not loose, loose[:4])
ok('no page loads supabase-js or qrcode from a CDN', not [k for k in list(supa) + list(qr) if k.startswith('http')],
   [k for k in list(supa) + list(qr) if k.startswith('http')][:4])
ok('the pages that load our own copies are found (%d script tags)' % vendor_refs, vendor_refs >= 30, vendor_refs)
ok('every self-hosted script a page names is on disk in that site', not missing, missing[:4])
ok('every self-hosted script carries its version in its name', not unversioned, unversioned[:4])
names = set(os.path.basename(k) for k in supa)
ok('every page loads the same supabase-js (%s)' % ', '.join(sorted(names)), len(names) == 1 and sum(len(v) for v in supa.values()) >= 25,
   {k: len(v) for k, v in supa.items()})
qnames = set(os.path.basename(k) for k in qr)
ok('every page loads the same qrcode (%s)' % ', '.join(sorted(qnames)), len(qnames) == 1, {k: len(v) for k, v in qr.items()})

print('\nTHE SELF-HOSTED FILES ARE BYTE FOR BYTE WHAT WAS COPIED, WITH THEIR LICENCES')
import hashlib, json
man = json.load(io.open(os.path.join(ROOT, 'tools', 'vendor-manifest.json'), encoding='utf-8'))['files']
on_disk = []
for site in ('venueplay/app/vendor', 'partyplay/vendor'):
    d = os.path.join(ROOT, site)
    for f in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        if f.endswith('.js'): on_disk.append(site + '/' + f)
ok('every vendored script is in tools/vendor-manifest.json (%d)' % len(on_disk), on_disk and all(p in man for p in on_disk), [p for p in on_disk if p not in man])
for p, e in sorted(man.items()):
    fp = os.path.join(ROOT, p)
    h = hashlib.sha256(open(fp, 'rb').read()).hexdigest() if os.path.isfile(fp) else None
    ok('%s is the file copied from %s' % (p, e['from']), h == e['sha256'], h)
    ok('%s has its licence beside it' % p, os.path.isfile(os.path.join(ROOT, e['licence'])) and 'Permission is hereby granted' in io.open(os.path.join(ROOT, e['licence']), encoding='utf-8').read(), e['licence'])

print('\nEVERY CHROME RIG SWAPS THE ADDRESS THE PAGES LOAD FOR ITS STAND-IN')
want = set(supa)
rigs = []
for d, dirs, fs in os.walk(os.path.join(ROOT, 'tools')):
    dirs[:] = [x for x in dirs if x != '__pycache__']
    for f in fs:
        if not f.endswith(('.py', '.js')) or f in ('pinned-cdn.test.py', 'prove-checks.py'):
            continue
        p = os.path.join(d, f)
        s = io.open(p, encoding='utf-8', errors='replace').read()
        for m in re.finditer(r"['\"]((?:https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@[\w.]+)|(?:/(?:app/)?vendor/supabase-js-[\w.]+\.js))['\"]", s):
            rigs.append((os.path.relpath(p, ROOT), m.group(1)))
ok('the rigs that swap supabase-js are found (%d)' % len(set(r for r, _ in rigs)), len(set(r for r, _ in rigs)) >= 5, rigs)
wrong = ['%s: %s' % r for r in rigs if r[1] not in want]
ok('every one swaps an address the pages load, so no test loads the real library', not wrong, wrong[:4])

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
