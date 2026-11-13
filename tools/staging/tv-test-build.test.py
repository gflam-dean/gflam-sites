#!/usr/bin/env python3
"""THE 'venueplay TV (test)' BUILD, OFFLINE (INBOX 357B / 326, 13 Nov 2026). Runs make-tv-test-build.py on a small copy of the
real TV project (tools/staging/fixtures/tv-apps-mini: the real config.xml, appinfo.json, build.js and the real address lines
of app.js). No network, no TV, nothing signed or installed.

Checks: staging addresses in, live ones out; its own Samsung package/app id and LG id (never the store app's); the name and the
footer say (test); the version sent to the site ends -test; Samsung may navigate only to the staging site; the project is read
only and an output inside it is refused; a changed app (a line it cannot find once) is refused; a live address left in the
output is refused; two zips are written.

Run: python3 tools/staging/tv-test-build.test.py      Ends on "ALL N CHECKS PASSED".
"""
import importlib.util, json, os, re, shutil, socket, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mtb', os.path.join(HERE, 'make-tv-test-build.py'))
T = importlib.util.module_from_spec(spec)
spec.loader.exec_module(T)
FX = os.path.join(HERE, 'fixtures', 'tv-apps-mini')
RAN, BAD = [0], [0]


def show(name, cond, saw=None):
    RAN[0] += 1
    if cond:
        print('  ok   ' + name)
    else:
        BAD[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: %s' % (str(saw)[:200],)))


def no_network(*a, **k):
    raise AssertionError('the test tried the network')
socket.socket.connect = no_network
socket.create_connection = no_network


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def snapshot(d):
    out = {}
    for dp, dn, fn in os.walk(d):
        for f in fn:
            p = os.path.join(dp, f)
            out[os.path.relpath(p, d)] = read(p)
    return out


def refused(fn):
    try:
        fn()
        return None
    except SystemExit as e:
        return str(e.code) if isinstance(e.code, str) else 'exit'


tmp = tempfile.mkdtemp(prefix='tv-test-build-')
try:
    # env.js for the test: the real one with a made-up TEST key, so the staging block is complete
    repo_env = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'venueplay', 'app', 'vp-env.js')
    env = os.path.join(tmp, 'vp-env.js')
    txt0 = read(repo_env)
    open(env, 'w').write(txt0)
    proj = os.path.join(tmp, 'tvapps')
    shutil.copytree(FX, proj)
    before = snapshot(proj)
    out = os.path.join(tmp, 'out')
    r = T.build(proj, out, env_js=env)
    show('the build runs', os.path.isdir(os.path.join(out, 'samsung')) and os.path.isdir(os.path.join(out, 'lg')), r)
    show('the TV project is left exactly as it was', snapshot(proj) == before)
    sa, lg = read(os.path.join(out, 'samsung', 'js', 'app.js')), read(os.path.join(out, 'lg', 'js', 'app.js'))
    for nm, a in (('Samsung', sa), ('LG', lg)):
        show('%s: the app opens the STAGING site' % nm, 'var SITE = "https://staging.venueplay.com.au";' in a)
        show('%s: the app asks the STAGING game Worker for the screen code' % nm, 'var GAME_API = "https://game-staging.venueplay.com.au";' in a)
        show('%s: no live address is left in a line of code' % nm, not re.search(r'^\s*var \w+ = "https://(www\.)?(venueplay\.com\.au|game\.venueplay\.com\.au)', a, re.M))
        show('%s: the settings footer says (test)' % nm, 'small(p, "venueplay TV (test) " + VERSION' in a)
        show('%s: the WebOS id in the code is the test id' % nm, 'var APP_ID_WEBOS = "au.com.venueplay.tv.test";' in a)
    show('Samsung build.js: platform kept, version ends -test', 'platform: "tizen", version: "1.0.2-test"' in read(os.path.join(out, 'samsung', 'js', 'build.js')))
    show('LG build.js: platform kept, version ends -test', 'platform: "webos", version: "1.0.1-test"' in read(os.path.join(out, 'lg', 'js', 'build.js')))
    cfg = read(os.path.join(out, 'samsung', 'config.xml'))
    show('Samsung has its OWN package and application id, not the store app\'s', 'package="VnPlyTest1"' in cfg and 'VnPlyTest1.venueplayTVtest' in cfg and 'VenuePlyTV' not in cfg, cfg[:400])
    show('Samsung\'s package id is 10 letters and digits', re.fullmatch(r'[A-Za-z0-9]{10}', T.SAMSUNG_PACKAGE) is not None)
    show('Samsung is named venueplay TV (test)', '<name>venueplay TV (test)</name>' in cfg)
    show('Samsung may navigate ONLY to the staging site', '<tizen:allow-navigation>staging.venueplay.com.au</tizen:allow-navigation>' in cfg and 'www.venueplay.com.au' not in cfg)
    show('Samsung\'s description says it is a test build', 'TEST BUILD, not for a store' in cfg)
    show('Samsung\'s widget id is the staging address', 'id="https://staging.venueplay.com.au/tv-app/samsung-test"' in cfg)
    ai = json.loads(read(os.path.join(out, 'lg', 'appinfo.json')))
    show('LG has its own id and the test name', ai['id'] == 'au.com.venueplay.tv.test' and ai['title'] == 'venueplay TV (test)' and ai['id'] != 'au.com.venueplay.tv', ai)
    show('LG keeps every other setting (resolution, icons, back history)', ai['resolution'] == '1920x1080' and ai['icon'] == 'icon.png' and ai['disableBackHistoryAPI'] is True)
    show('the shared page and css are copied into both', os.path.isfile(os.path.join(out, 'samsung', 'index.html')) and os.path.isfile(os.path.join(out, 'lg', 'css', 'app.css')))
    zs = sorted(r['zips'])
    show('two zips are written, named for what they are', [os.path.basename(z) for z in zs] == ['venueplayTV-test-lg-1.0.1-UNSIGNED.zip', 'venueplayTV-test-samsung-1.0.2-UNSIGNED.zip'], zs)
    names = zipfile.ZipFile([z for z in zs if 'samsung' in z][0]).namelist()
    show('the Samsung zip has config.xml at its top', 'config.xml' in names and 'js/app.js' in names, names[:6])
    show('the store version numbers are not changed in config.xml (Tizen wants digits)', 'version="1.0.2"' in cfg)

    print('what it refuses')
    show('an output folder inside the TV project is refused', refused(lambda: T.build(proj, os.path.join(proj, 'out'), env_js=env)) is not None)
    show('...and the project is still untouched', snapshot(proj) == before)

    def changed(fname, old, new):
        d = os.path.join(tmp, 'chg')
        if os.path.exists(d):
            shutil.rmtree(d)
        shutil.copytree(FX, d)
        p = os.path.join(d, *fname.split('/'))
        txt = read(p).replace(old, new)
        open(p, 'w').write(txt)
        return refused(lambda: T.build(d, os.path.join(tmp, 'chgout'), env_js=env))
    m = changed('shared/js/app.js', 'var SITE = "https://venueplay.com.au";', 'var SITE = "https://venueplay.com.au"; // moved')
    show('a SITE line with a trailing comment still builds (it is found once)', m is None, m)
    m = changed('shared/js/app.js', 'var SITE = "https://venueplay.com.au";', 'var SITE = "https://venueplay.com.au/";')
    show('a changed SITE line is refused, not guessed at', m is not None and 'SITE' in m, m)
    m = changed('shared/js/app.js', 'var GAME_API = "https://game.venueplay.com.au";', 'var GAME_API = "https://game2.venueplay.com.au";')
    show('a changed GAME_API line is refused', m is not None and 'GAME_API' in m, m)
    m = changed('samsung/config.xml', '<name>venueplay TV</name>', '<name>venueplay screen</name>')
    show('a changed Samsung name line is refused', m is not None and 'name' in m, m)
    m = changed('shared/js/app.js', 'Help: support@venueplay.com.au");\n})();', 'Help: support@venueplay.com.au");\n  fetch("https://api.venueplay.com.au/x");\n})();')
    show('a live address added to the app is caught and refused', m is not None and 'live address' in m, m)
    m = changed('shared/js/app.js', '"venueplay TV " + VERSION', '"venueplay screen " + VERSION')
    show('a changed footer line is refused', m is not None and 'footer' in m, m)
    m = changed('samsung/js/build.js', 'platform: "tizen"', 'platform = "tizen"')
    show('a build.js with no platform and version is refused', m is not None and 'VP_BUILD' in m, m)
    badenv = os.path.join(tmp, 'bad-env.js')
    txt1 = read(repo_env).replace('https://staging.venueplay.com.au', 'https://www.venueplay.com.au')
    open(badenv, 'w').write(txt1)
    m = refused(lambda: T.build(proj, os.path.join(tmp, 'o2'), env_js=badenv))
    show('a staging site that is the live site is refused', m is not None and 'LIVE' in m, m)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

if BAD[0]:
    print('\nFAILED %d of %d' % (BAD[0], RAN[0]))
    sys.exit(1)
print('\nALL %d CHECKS PASSED' % RAN[0])
