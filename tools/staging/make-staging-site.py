#!/usr/bin/env python3
"""Build the STAGING copy of the venueplay site (INBOX 357B / 326, 13 Nov 2026).

    python3 tools/staging/make-staging-site.py OUT_DIR [--src venueplay] [--allow-placeholder]

Copies venueplay/ to OUT_DIR and changes ONLY these things:
  1. every LIVE address in venueplay/app/vp-env.js (the live database, the live api, the live game Worker, the live
     public key) becomes its STAGING twin from the STAGING block in the same file;
  2. every .html gets <script src="/app/vp-env.js"> first in <head> (the staging tripwire, see that file);
  3. _headers gains X-Robots-Tag: noindex.
Then it SCANS the result and refuses (exit 1) if any live address is left, if the staging block still names a live
address, or if the staging public key has not been filled in (--allow-placeholder is for the offline test only).

Reads files, writes only inside OUT_DIR. No network, no database, no git write. The staging Pages branch is this
folder committed on branch "staging" by main; Cloudflare Pages deploys it. A release is tested AS ITSELF: the pages
differ from the release only by the lines above.
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEXT_EXT = {'.html', '.js', '.css', '.json', '.txt', '.xml', '.svg', '.md', '.webmanifest', ''}
TAG = '<script src="/app/vp-env.js"></script>'
PLACEHOLDER = 'TEST_ANON_KEY_NOT_SET_YET'
# Stripe's TEST-mode publishable key (Dean, 16 Nov 2026: staging sign-up must take a test card). Publishable keys are
# public by design (they sit in the page); this one only works against Stripe test mode. Every live pk_live_ key in a
# staging page is swapped for it, and the build refuses if a pk_live_ key is left.
STRIPE_TEST_PK = 'pk_test_51TqKod4zQxMz9so2TVds8I3KU0l70Ljpy3kMAtJ58xTO3K5km0Z1kGDVYdEpX68eIJFm6qNV1Qf4ujiHIjZQ9nhw00viu0hkRR'
PK_LIVE = re.compile(r'pk_live_[A-Za-z0-9]+')


def read_block(src, begin_pat, end_pat, label):
    return src


def js_obj(src, var):
    """The string fields of `var NAME = { key: "value", ... };` in vp-env.js."""
    m = re.search(r'var\s+%s\s*=\s*\{(.*?)\};' % var, src, re.S)
    if not m:
        raise SystemExit('vp-env.js has no "var %s = {...}": cannot read the addresses' % var)
    return dict(re.findall(r'(\w+)\s*:\s*"([^"]*)"', m.group(1)))


def host(u):
    m = re.match(r'^[a-z]+://([^/?#:]+)', u or '')
    return m.group(1).lower() if m else ''


def load_env(env_js):
    src = open(env_js, encoding='utf-8').read()
    live, stg = js_obj(src, 'LIVE'), js_obj(src, 'STAGING')
    for k in ('site', 'api', 'game', 'supabaseUrl', 'supabaseAnon'):
        if not live.get(k) or not stg.get(k):
            raise SystemExit('vp-env.js: %s missing in LIVE or STAGING' % k)
    return live, stg


def problems(live, stg, allow_placeholder):
    bad = []
    live_tokens = [host(live['supabaseUrl']), host(live['api']), host(live['game']), live['supabaseAnon']]
    live_ref = host(live['supabaseUrl']).split('.')[0]
    for k in ('site', 'api', 'game', 'supabaseUrl'):
        h = host(stg[k])
        if not h:
            bad.append('STAGING %s is not an address: %r' % (k, stg[k]))
        if h in (host(live['site']), 'venueplay.com.au') or h in live_tokens or live_ref in stg[k]:
            bad.append('STAGING %s names a LIVE address: %s' % (k, stg[k]))
    if stg['supabaseAnon'] == live['supabaseAnon']:
        bad.append('STAGING supabaseAnon is the LIVE public key')
    if stg['supabaseAnon'] == PLACEHOLDER and not allow_placeholder:
        bad.append('STAGING supabaseAnon is still the placeholder: put the TEST project\'s public key in vp-env.js first (main, after the key rotation)')
    for k in ('api', 'game', 'supabaseUrl'):
        if live[k] == stg[k]:
            bad.append('STAGING %s equals LIVE' % k)
    return bad


def swaps(live, stg):
    """(live text, staging text) pairs. Hosts first (covers https://, wss:// and bare), then the key."""
    return [
        (host(live['supabaseUrl']), host(stg['supabaseUrl'])),
        (host(live['game']), host(stg['game'])),
        (host(live['api']), host(stg['api'])),
        (live['supabaseAnon'], stg['supabaseAnon']),
    ]


def inject_tag(text):
    if 'vp-env.js' in text:
        return text, False
    m = re.search(r'<head[^>]*>', text, re.I)
    if m:
        return text[:m.end()] + '\n' + TAG + text[m.end():], True
    m = re.search(r'<html[^>]*>', text, re.I)
    if m:
        return text[:m.end()] + '\n' + TAG + text[m.end():], True
    return TAG + '\n' + text, True


def build(src_dir, out_dir, allow_placeholder=False):
    env_js = os.path.join(src_dir, 'app', 'vp-env.js')
    try:
        live, stg = load_env(env_js)
    except SystemExit as e:
        return {'ok': False, 'problems': [str(e)]}
    bad = problems(live, stg, allow_placeholder)
    if bad:
        return {'ok': False, 'problems': bad}
    pairs = swaps(live, stg)
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    changed, tagged, files = 0, 0, 0
    for dp, dn, fn in os.walk(src_dir):
        dn[:] = [d for d in dn if d not in ('.git', 'node_modules')]
        for f in fn:
            s = os.path.join(dp, f)
            rel = os.path.relpath(s, src_dir)
            d = os.path.join(out_dir, rel)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            files += 1
            if os.path.splitext(f)[1].lower() not in TEXT_EXT:
                shutil.copy2(s, d)
                continue
            try:
                t = open(s, encoding='utf-8').read()
            except UnicodeDecodeError:
                shutil.copy2(s, d)
                continue
            o = t
            if rel != os.path.join('app', 'vp-env.js'):      # vp-env.js keeps BOTH sets: it is the config
                for a, b in pairs:
                    t = t.replace(a, b)
                t = PK_LIVE.sub(STRIPE_TEST_PK, t)
            if f.lower().endswith('.html'):
                t, did = inject_tag(t)
                tagged += 1 if did else 0
            if rel == '_headers':
                t = t.rstrip('\n') + '\n\n/*\n  X-Robots-Tag: noindex, nofollow\n'
            if t != o:
                changed += 1
            open(d, 'w', encoding='utf-8').write(t)
    left = []
    live_tokens = [a for a, _ in pairs] + ['pk_live_']
    for dp, dn, fn in os.walk(out_dir):
        for f in fn:
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, out_dir)
            if rel == os.path.join('app', 'vp-env.js'):
                continue
            try:
                t = open(p, encoding='utf-8').read()
            except (UnicodeDecodeError, OSError):
                continue
            for tok in live_tokens:
                if tok in t:
                    left.append('%s still names %s' % (rel, tok[:40]))
    if left:
        return {'ok': False, 'problems': left}
    manifest = {'built_from': 'venueplay/', 'staging': stg['site'], 'files': files, 'changed': changed, 'tagged_html': tagged,
                'commit': _commit()}
    open(os.path.join(out_dir, 'staging-build.json'), 'w').write(json.dumps(manifest, indent=1) + '\n')
    return {'ok': True, 'files': files, 'changed': changed, 'tagged': tagged}


def _commit():
    try:
        return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        return ''


def main(argv):
    allow = '--allow-placeholder' in argv
    args = [a for a in argv if not a.startswith('--')]
    src = os.path.join(ROOT, 'venueplay')
    if '--src' in argv:
        src = argv[argv.index('--src') + 1]
        args = [a for a in args if a != src]
    if len(args) != 1:
        print(__doc__)
        return 2
    r = build(src, args[0], allow)
    if not r['ok']:
        print('REFUSED:')
        for p in r['problems'][:30]:
            print('  - ' + p)
        return 1
    print('staging site built in %s: %d files, %d changed, %d pages given the vp-env tag' % (args[0], r['files'], r['changed'], r['tagged']))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
