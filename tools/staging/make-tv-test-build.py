#!/usr/bin/env python3
"""Make the 'venueplay TV (test)' app for the Kogan (INBOX 357B / 326, 13 Nov 2026). NEVER for a store.

    python3 tools/staging/make-tv-test-build.py --tv-apps ~/venueplay-tv-apps --out OUT_DIR

Reads the finished TV app project (shared/, samsung/, lg/) READ-ONLY and writes OUT_DIR/samsung, OUT_DIR/lg and two zips
into OUT_DIR. The test app is a different app from the store one, so both can sit on the same TV:
  * points at staging: SITE and GAME_API in the app become the STAGING addresses from venueplay/app/vp-env.js
  * its own identity: Samsung package/application id and LG id get a "test" twin, the name is "venueplay TV (test)",
    the footer on its settings page says "(test)", the version sent to the site is "<version>-test"
  * Samsung may only navigate to the staging site; the live site is removed from its allow list
Then it SCANS the output and refuses if any live address is left. Refuses an OUT_DIR inside the TV project, and a TV project
whose lines it cannot find exactly once (a changed app must be looked at, not guessed at).

It does not sign, package for a store, upload, sideload or touch a TV. Signing (Samsung, Dean's "venueplay" certificate in
Tizen Studio) and the sideload (sdb / ares-install) are the two commands printed at the end, run by whoever has the TV.
No network, no database.
"""
import json, os, re, shutil, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import importlib.util
_spec = importlib.util.spec_from_file_location('mss', os.path.join(HERE, 'make-staging-site.py'))
mss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mss)

COPY = ['index.html', 'css', 'js', 'img', 'fonts']
TEST_TITLE = 'venueplay TV (test)'
SAMSUNG_PACKAGE = 'VnPlyTest1'                         # 10 letters/digits, its own, so it never replaces the store app
SAMSUNG_APP = SAMSUNG_PACKAGE + '.venueplayTVtest'
WEBOS_ID_LIVE, WEBOS_ID_TEST = 'au.com.venueplay.tv', 'au.com.venueplay.tv.test'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit('REFUSED: expected %r exactly once (%s), found %d. The TV app changed: look at it, then update this tool.' % (old[:70], label, n))
    return text.replace(old, new)


def build(tv_apps, out, env_js=None):
    tv_apps, out = os.path.realpath(tv_apps), os.path.realpath(out)
    if out == tv_apps or out.startswith(tv_apps + os.sep):
        raise SystemExit('REFUSED: the output folder is inside the TV project; it is never written to.')
    live, stg = mss.load_env(env_js or os.path.join(ROOT, 'venueplay', 'app', 'vp-env.js'))
    bad = mss.problems(live, stg, True)
    if bad:
        raise SystemExit('REFUSED: ' + '; '.join(bad))
    site_live, site_stg = 'https://venueplay.com.au', stg['site']
    if os.path.exists(out):
        shutil.rmtree(out)
    shared = os.path.join(tv_apps, 'shared')
    versions = {}
    for plat in ('samsung', 'lg'):
        dst = os.path.join(out, plat)
        shutil.copytree(os.path.join(tv_apps, plat), dst, ignore=shutil.ignore_patterns('.buildResult', '*.md', 'js', 'css', 'img', 'fonts', 'index.html'))
        for item in COPY:
            s = os.path.join(shared, item)
            if os.path.isdir(s):
                shutil.copytree(s, os.path.join(dst, item))
            elif os.path.isfile(s):
                shutil.copy2(s, os.path.join(dst, item))
        app = os.path.join(dst, 'js', 'app.js')
        t = read(app)
        t = once(t, 'var SITE = "%s";' % site_live, 'var SITE = "%s";' % site_stg, 'SITE')
        t = once(t, 'var GAME_API = "%s";' % live['game'], 'var GAME_API = "%s";' % stg['game'], 'GAME_API')
        t = once(t, 'var APP_ID_WEBOS = "%s";' % WEBOS_ID_LIVE, 'var APP_ID_WEBOS = "%s";' % WEBOS_ID_TEST, 'APP_ID_WEBOS')
        t = once(t, 'small(p, "venueplay TV " + VERSION + ".', 'small(p, "venueplay TV (test) " + VERSION + ".', 'settings footer')
        write(app, t)
        # the version the site is told, and the platform, come from the store build's own build.js
        bj = os.path.join(tv_apps, plat, 'js', 'build.js')
        m = re.search(r'platform:\s*"(\w+)",\s*version:\s*"([0-9.]+)"', read(bj))
        if not m:
            raise SystemExit('REFUSED: %s has no VP_BUILD platform and version' % bj)
        versions[plat] = m.group(2)
        write(os.path.join(dst, 'js', 'build.js'), '/* Written by tools/staging/make-tv-test-build.py. A TEST build, never for a store. */\nwindow.VP_BUILD = { platform: "%s", version: "%s-test" };\n' % (m.group(1), m.group(2)))
    # Samsung identity
    cfg_p = os.path.join(out, 'samsung', 'config.xml')
    c = read(cfg_p)
    c = once(c, 'id="https://venueplay.com.au/tv-app/samsung"', 'id="%s/tv-app/samsung-test"' % site_stg, 'widget id')
    c = re.sub(r'<tizen:application id="[^"]+" package="[^"]+"', '<tizen:application id="%s" package="%s"' % (SAMSUNG_APP, SAMSUNG_PACKAGE), c, count=1)
    c = once(c, '<name>venueplay TV</name>', '<name>%s</name>' % TEST_TITLE, 'name')
    c = once(c, '<tizen:allow-navigation>venueplay.com.au www.venueplay.com.au</tizen:allow-navigation>', '<tizen:allow-navigation>%s</tizen:allow-navigation>' % mss.host(stg['site']), 'allow-navigation')
    c = once(c, '<description>The venueplay screen', '<description>TEST BUILD, not for a store. The venueplay screen', 'description')
    write(cfg_p, c)
    # LG identity
    ai_p = os.path.join(out, 'lg', 'appinfo.json')
    a = json.loads(read(ai_p))
    a['id'] = WEBOS_ID_TEST
    a['title'] = TEST_TITLE
    a['appDescription'] = 'TEST BUILD, not for a store. ' + a.get('appDescription', '')
    write(ai_p, json.dumps(a, indent=4) + '\n')
    # scan: no live address anywhere
    left = []
    live_urls = ['https://venueplay.com.au', 'https://www.venueplay.com.au', live['game'], live['api'], mss.host(live['supabaseUrl']), 'http://venueplay.com.au']
    for dp, dn, fn in os.walk(out):
        for f in fn:
            p = os.path.join(dp, f)
            try:
                t = read(p)
            except (UnicodeDecodeError, OSError):
                continue
            for line in t.splitlines():
                if '<author' in line:      # who wrote it, not an address the app talks to
                    continue
                for tok in live_urls:
                    if tok in line:
                        left.append('%s: %s' % (os.path.relpath(p, out), line.strip()[:90]))
    # comments in app.js describe the live shape; only a real string literal or attribute matters
    left = [l for l in left if not re.search(r'^\S+app\.js: (-|\*|/\*|GET |then opens|venueplay\.com\.au domain)', l)]
    left = [l for l in left if not re.search(r'app\.js: (GET https|- then opens https|the address instead)', l)]
    if left:
        raise SystemExit('REFUSED: a live address is left in the test build:\n  ' + '\n  '.join(left[:12]))
    zips = []
    for plat in ('samsung', 'lg'):
        z = os.path.join(out, 'venueplayTV-test-%s-%s-UNSIGNED.zip' % (plat, versions[plat]))
        with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
            for dp, dn, fn in sorted(os.walk(os.path.join(out, plat))):
                dn.sort()
                for f in sorted(fn):
                    p = os.path.join(dp, f)
                    zf.write(p, os.path.relpath(p, os.path.join(out, plat)))
        zips.append(z)
    return {'out': out, 'versions': versions, 'zips': zips, 'site': site_stg, 'samsung_app': SAMSUNG_APP}


def main(argv):
    def opt(name):
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None
    tv, out = opt('--tv-apps'), opt('--out')
    if not tv or not out:
        print(__doc__)
        return 2
    r = build(os.path.expanduser(tv), os.path.expanduser(out))
    print('test build written to %s (%s)' % (r['out'], ', '.join('%s %s-test' % kv for kv in r['versions'].items())))
    print('  points at %s. Not signed, not installed.' % r['site'])
    print('NEXT (whoever holds the TV; the Kogan is Samsung/Tizen):')
    print('  sign:      tizen package -t wgt -s venueplay -- %s/samsung      (Dean\'s "venueplay" certificate profile)' % r['out'])
    print('  sideload:  sdb connect 192.168.68.58 && tizen install -n <the .wgt> -t <the Kogan\'s target name>')
    print('  start it:  tizen run -p VnPlyTest1.venueplayTVtest -t <target>      (or open "venueplay TV (test)" on the TV)')
    print('  The store app "venueplay TV" is a different app and is left alone. LG: ares-package %s/lg then ares-install.' % r['out'])
    print('  The staging site is behind the Cloudflare Access lock: the Kogan\'s address must be on its let-through list.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit as e:
        if isinstance(e.code, str):
            print(e.code)
            sys.exit(1)
        raise
