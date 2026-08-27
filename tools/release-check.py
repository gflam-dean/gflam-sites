#!/usr/bin/env python3
"""RELEASE CHECK: run this after every deploy, on both products.

WHY THIS EXISTS, written down so it does not get watered back down.

Every fault that reached a customer this month got past a check that looked like
it passed:

  * A page answered HTTP 200 with a fallback HTML body for a script that was not
    there at all, so a "200 = deployed" check reported success for a missing file.
  * Extensionless URLs 308-redirect, so curl without -L read an empty body and a
    live page looked broken.
  * check-defs.py globbed site/*.html and ignored the filename it was handed, so
    running it on a Worker printed "ok" without opening the file. Two admin routes
    shipped calling a function that does not exist.
  * Four of five faults found in live testing only appear when a game is actually
    running. Nothing static could have caught them.

So this tool has four rules:
  1. Compare CONTENT, never status codes.
  2. Follow redirects.
  3. Report how many things were actually checked, so a silent no-op cannot pass
     for a pass.
  4. Say plainly what it CANNOT check, at the end, every time.

It is read-only against production. It writes nothing, joins nothing, and
broadcasts on no real venue's channel: VenuePlay has a live client.

  python3 tools/release-check.py            both products
  python3 tools/release-check.py partyplay  one of them
  python3 tools/release-check.py --local    the pre-push half only
  python3 tools/release-check.py --live     production only, skip the local half
  python3 tools/release-check.py --wait     wait for the deploy first, then check
"""
import io, json, os, re, subprocess, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_scanner():
    """check-defs.py owns the comment scanner. Import it rather than keeping a
    second copy that will drift, which is exactly how four screen routers ended
    up disagreeing with each other."""
    import importlib.util
    p = os.path.join(os.path.expanduser('~/partyplay'), 'check-defs.py')
    if not os.path.isfile(p):
        return None
    spec = importlib.util.spec_from_file_location('_cd', p)
    mod = importlib.util.module_from_spec(spec)
    argv, out = sys.argv[:], sys.stdout
    sys.argv = ['check-defs.py', '--no-targets-on-purpose']
    sys.stdout = io.StringIO()          # it prints its own summary on import
    try:
        spec.loader.exec_module(mod)
    except SystemExit:
        pass
    finally:
        sys.argv, sys.stdout = argv, out
    return getattr(mod, 'strip_comments', None)
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
PARTYPLAY_LOCAL = os.path.expanduser('~/partyplay')
_scanner = None   # filled in at start-up, see _load_scanner

RED, GRN, YEL, DIM, OFF = '\033[31m', '\033[32m', '\033[33m', '\033[2m', '\033[0m'

# A real browser's, because Cloudflare refuses urllib's default before the Worker
# is reached and the answer then looks like a fault that is not there.
BROWSER_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')

passed = failed = 0
checked_things = 0
failures = []


def ok(label, good, detail='', why=''):
    """detail is shown either way. why explains a FAILURE and is shown only then,
    because an explanation of what went wrong printed next to a tick reads as if
    something did go wrong."""
    global passed, failed, checked_things
    checked_things += 1
    if good:
        passed += 1
        print('  %sok%s   %s %s%s%s' % (GRN, OFF, label.ljust(52), DIM, detail, OFF))
    else:
        msg = ' '.join(x for x in (detail, why) if x)
        failed += 1
        failures.append(label + ('  ' + msg if msg else ''))
        print('  %sFAIL%s %s %s' % (RED, OFF, label.ljust(52), msg))


def head(title):
    print('\n%s── %s ──%s' % (YEL, title, OFF))


class _Follow308(urllib.request.HTTPRedirectHandler):
    """Python 3.9's urllib does not follow a 308, and Cloudflare Pages answers
    every .html URL with one. Without this, every page checked by its real
    filename came back as an empty body and read as broken when it was fine."""
    def http_error_308(self, req, fp, code, msg, headers):
        return self.http_error_301(req, fp, 301, msg, headers)


_opener = urllib.request.build_opener(_Follow308)


def get(url, timeout=20):
    """Body and status, following redirects. Never trust the status alone."""
    req = urllib.request.Request(url, headers={'User-Agent': BROWSER_UA})
    try:
        with _opener.open(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace'), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), url
    except Exception as e:
        return 0, str(e), url


def post(url, body=None, headers=None, timeout=20, method='POST'):
    data = json.dumps(body or {}).encode()
    h = {'content-type': 'application/json', 'User-Agent': BROWSER_UA}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)


def preflight(api, path, origin):
    """What origin does the Worker hand back to a browser standing at `origin`?

    The User-Agent matters: Cloudflare turns away urllib's default one with a 403
    before the Worker ever sees the request, and the header then comes back empty.
    That looked exactly like a CORS fault and was not one.
    """
    req = urllib.request.Request(api + path, method='OPTIONS')
    req.add_header('Origin', origin)
    req.add_header('Access-Control-Request-Method', 'POST')
    req.add_header('Access-Control-Request-Headers', 'content-type')
    req.add_header('User-Agent', BROWSER_UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.headers.get('Access-Control-Allow-Origin')
    except urllib.error.HTTPError as e:
        if e.code == 403 and not e.headers.get('Access-Control-Allow-Origin'):
            return 'BLOCKED-AT-THE-EDGE'      # not a CORS answer at all, say so
        return e.headers.get('Access-Control-Allow-Origin')
    except Exception as e:
        return 'UNREACHABLE: %s' % e


def is_real_page(body):
    """A page that exists, rather than the catch-all HTML served for one that
    does not. The tell is that the fallback is always the site's index."""
    return len(body) > 500 and '<html' in body.lower()


# ===========================================================================
#  A. BEFORE YOU PUSH.  Run in the working copy, no network needed.
# ===========================================================================

def js_blocks(path):
    """Only the things a browser will actually run as script.

    <script type="application/ld+json"> is search-engine data, not code, and
    parsing it as JavaScript reports a syntax error on a perfectly good page.
    """
    src = io.open(path, encoding='utf-8').read()
    if path.endswith('.js'):
        # `export default` is valid in a Worker module and not in new Function.
        return [re.sub(r'^export default', 'var _x =', src, flags=re.M)]
    out = []
    for tag, body in re.findall(r'(<script(?![^>]*\bsrc=)[^>]*>)(.*?)</script>', src, re.S):
        t = re.search(r'type\s*=\s*["\']([^"\']+)', tag)
        if t and not re.match(r'(text/javascript|module|application/javascript)$', t.group(1).strip()):
            continue                      # json-ld, templates, anything not code
        out.append(body)
    return out


def parses(js):
    io.open('/tmp/_rc.js', 'w', encoding='utf-8').write(js)
    r = subprocess.run([JSC, '-e',
        'try{ new Function(readFile("/tmp/_rc.js")); print("OK"); }catch(e){ print("ERR "+e); }'],
        capture_output=True, text=True)
    return ('OK' in r.stdout), r.stdout.strip()


def short(path):
    """A path you can actually go and open, not a bare filename."""
    for base, name in ((ROOT, ''), (PARTYPLAY_LOCAL, 'partyplay/')):
        if path.startswith(base):
            return name + os.path.relpath(path, base)
    return path


def copy_text(path):
    """What a person actually reads: the markup and the strings that get written
    into it, with every comment removed.

    House rules are about COPY. An em dash inside a code comment explaining a
    past bug breaks no rule, and flagging it buries the one that does. The
    comment scanner lives in check-defs.py because it took three attempts to get
    right, and there should be exactly one of it.
    """
    src = io.open(path, encoding='utf-8').read()
    src = re.sub(r'<!--.*?-->', '', src, flags=re.S)
    if _scanner:
        try:
            return _scanner(src)
        except Exception:
            pass
    return re.sub(r'/\*.*?\*/', '', src, flags=re.S)


def local_checks(which):
    head('A. Every script parses')
    files = []
    if which in ('both', 'venueplay'):
        for d, _, fs in os.walk(os.path.join(ROOT, 'venueplay')):
            if 'emails' in d:
                continue
            for f in fs:
                if f.endswith('.html') or (f.endswith('.js') and not f.endswith('.test.js')):
                    files.append(os.path.join(d, f))
    if which in ('both', 'partyplay') and os.path.isdir(PARTYPLAY_LOCAL):
        for sub in ('site', 'site/lib', 'lib', 'worker'):
            d = os.path.join(PARTYPLAY_LOCAL, sub)
            if not os.path.isdir(d):
                continue
            for f in sorted(os.listdir(d)):
                if f.endswith('.test.js') or f.startswith('DEPLOY-'):
                    continue
                if f.endswith('.html') or f.endswith('.js'):
                    files.append(os.path.join(d, f))

    bad = 0
    for f in files:
        for n, js in enumerate(js_blocks(f)):
            if not js.strip():
                continue
            good, msg = parses(js)
            if not good:
                bad += 1
                ok('%s block %d' % (os.path.relpath(f, ROOT), n), False, msg)
    ok('every script in %d file(s) parses' % len(files), bad == 0,
       '' if bad == 0 else '%d broken' % bad)

    head('B. Nothing calls a function that does not exist')
    checker = os.path.join(PARTYPLAY_LOCAL, 'check-defs.py')
    if os.path.isfile(checker):
        args = [a for a in files if a.endswith('.html') or a.endswith('.js')]
        r = subprocess.run([sys.executable, checker] + args,
                           capture_output=True, text=True, cwd=PARTYPLAY_LOCAL)
        out = (r.stdout + r.stderr).strip().splitlines()
        ok('definition check across %d file(s)' % len(args), r.returncode == 0,
           out[-1].strip() if out else '')
    else:
        ok('definition checker present', False, 'check-defs.py not found')

    head('C. Unit tests')
    for base in ([PARTYPLAY_LOCAL] if which in ('both', 'partyplay') else []):
        for sub in ('lib', 'worker'):
            d = os.path.join(base, sub)
            if not os.path.isdir(d):
                continue
            for f in sorted(os.listdir(d)):
                if not f.endswith('.test.js'):
                    continue
                r = subprocess.run([JSC, os.path.join(d, f)], capture_output=True, text=True)
                last = (r.stdout.strip().splitlines() or [''])[-1]
                ok(f, last.startswith('ALL '), last)
    for f in ['check-tv-watchdog.py', 'check-venue-scoping.py']:
        p = os.path.join(ROOT, 'venueplay-backend', 'tools', f)
        if which in ('both', 'venueplay') and os.path.isfile(p):
            r = subprocess.run([sys.executable, p], capture_output=True, text=True,
                               cwd=os.path.join(ROOT, 'venueplay-backend'))
            ok(f, r.returncode == 0 and 'All good' in r.stdout,
               (r.stdout.strip().splitlines() or [''])[-1])

    head('D. House rules')
    # An em dash used as PUNCTUATION, which is the house rule. A lone "—" in a
    # table cell is a glyph meaning "no value yet", not a sentence, and flagging
    # forty of those buries the one real breach.
    rules = [('no em dashes in copy', r'\w\s*[—–]\s*\w'),
             ('never "the ACT"', r'\bthe ACT\b'),
             ('never "roster" in copy', r'>[^<>]{0,60}\broster\b')]
    for label, pat in rules:
        hits = []
        for f in files:
            if not f.endswith('.html'):
                continue
            if not re.search(pat, copy_text(f), re.I if 'roster' in label else 0):
                continue
            # Full path: both products have an index.html, and "index.html" on
            # its own sent me looking in the wrong one.
            hits.append(short(f))
        ok(label, not hits, why=', '.join(hits[:4]))

    head('E. The Worker you are about to paste')
    dep = os.path.join(PARTYPLAY_LOCAL, 'worker', 'DEPLOY-partyplay-api.js')
    if which in ('both', 'partyplay') and os.path.isfile(dep):
        src = io.open(dep, encoding='utf-8').read()
        stamp = re.search(r'Built ([^\n]+?)\s+fingerprint', src)
        good, msg = parses(re.sub(r'^export default', 'var _d =', src, flags=re.M))
        ok('deploy build parses', good, msg if not good else (stamp.group(1) if stamp else ''))
        ok('the licence library is inlined, not a marker', 'const PPLicence = (function' in src)
        # The file's own header lists the names of the secrets to set, with
        # "sk_live_..." as an example. Only a plausible VALUE counts.
        leak = re.search(r'(sk_live_|rk_live_|whsec_|re_)[A-Za-z0-9_\-]{20,}'
                         r'|eyJ[A-Za-z0-9_\-]{40,}\.[A-Za-z0-9_\-]{20,}', src)
        ok('no secret got baked into it', not leak,
           why='found %s' % (leak.group(0)[:14] + '...' if leak else ''))


# ===========================================================================
#  B. AFTER THE DEPLOY.  Against production, read-only.
# ===========================================================================

VP = 'https://venueplay.com.au'
PP = 'https://partyplay.com.au'
VP_GAME = 'https://venueplay-game.dean-tindale.workers.dev'
VP_API  = 'https://venueplay-api.dean-tindale.workers.dev'
PP_API  = 'https://partyplay-api.dean-tindale.workers.dev'

# path -> a string that only appears when the page is genuinely there and current.
# A page answering 200 with the site's fallback HTML will not contain these.
VP_PAGES = {
    '/':                      'VenuePlay',
    '/play':                  'playingHere',
    '/tv':                    'adsRoot',
    '/app/':                  'vp-session.js',
    '/app/trivia/screen':     'VPScreenRouter',
    '/app/musical/screen':    'VPScreenRouter',
    '/app/raffle/screen':     'VPScreenRouter',
    '/app/members/screen':    'VPScreenRouter',
    '/app/trivia/play':       'VPFollow.start',
    '/app/musical/play':      'VPFollow.start',
    '/app/trivia/host':       'VenuePlay Trivia',
    '/app/musical/host':      'soundIsOnlyHere',
    '/app/raffle/host':       'VenuePlay Raffle',
    '/app/members/host':      'Members',
    '/app/settings.html':     'settings',
    '/app/billing.html':      'billing',
    '/app/hq.html':           'VenuePlay Admin',
    '/app/vp-follow.js':      'FOLLOW THE HOST',
    '/app/vp-screen-router.js': 'THE BIG SCREEN FOLLOWS',
    '/app/vp-sign.js':        'VenuePlay broadcast-message signing',
    '/terms':                 'Terms',
    '/privacy':               'Privacy',
}

PP_PAGES = {
    '/':            'PartyPlay',
    '/start':       'checkout',
    '/booked':      'Send the email again',
    '/host':        'PARTY',
    '/run':         'runCharades',
    '/tv':          'Or on your phone, go to',
    '/play':        'Want tonight',
    '/album':       'album',
    '/admin':       'Text me a code',
    '/setup':       'HDMI',
    '/terms':       'Terms',
    '/privacy':     'Privacy',
    '/lib/pp-config.js':  'PPConfig',
    '/lib/pp-ticket.js':  'PPTicket',
}


def wait_for_deploy(minutes=30):
    """Sit here until the new build is actually being served.

    Cloudflare Pages has taken anywhere from three to twenty-five minutes. Every
    time I checked too early I read the OLD build and had to work out whether the
    change was broken or simply not there yet. So wait, and say how long it took.
    """
    import time
    head('Waiting for Cloudflare Pages')
    targets = [(PP, p, m) for p, m in PP_PAGES.items()] + [(VP, p, m) for p, m in VP_PAGES.items()]
    deadline = time.time() + minutes * 60
    started = time.time()
    while time.time() < deadline:
        stale = []
        for base, path, marker in targets:
            status, body, _ = get(base + path)
            if status != 200 or marker not in body:
                stale.append(base.split('//')[1].split('.')[0] + path)
        if not stale:
            ok('both sites are serving the current build',
               True, 'took %d seconds' % (time.time() - started))
            return True
        print('  %s...%s %d page(s) still on the old build, e.g. %s'
              % (DIM, OFF, len(stale), stale[0]))
        time.sleep(30)
    ok('both sites are serving the current build', False,
       why='still stale after %d minutes: %s' % (minutes, ', '.join(stale[:3])))
    return False


def pages_live(name, base, table):
    head('%s pages: is the CURRENT build actually being served' % name)
    for path, marker in sorted(table.items()):
        status, body, final = get(base + path)
        if status != 200:
            ok(path, False, 'HTTP %s' % status)
        elif not is_real_page(body) and not path.endswith('.js'):
            ok(path, False, 'answered 200 with something that is not a page')
        elif marker not in body:
            ok(path, False, 'served, but "%s" is missing: the old build is still up' % marker[:34])
        else:
            ok(path, True, '%d KB' % (len(body) // 1024))


def worker_health(name, api, needs_config=True):
    head('%s Worker' % name)
    status, body, _ = get(api + '/health')
    if status == 200:
        try:
            d = json.loads(body)
            ok('%s health' % name, d.get('ok') is True,
               '' if d.get('ok') else 'missing: %s' % ', '.join(d.get('missing', [])))
        except Exception:
            ok('%s health' % name, False, 'health did not answer JSON')
    else:
        ok('%s health' % name, status in (200, 404),
           'HTTP %s' % status if status != 404 else 'no /health on this Worker')


def cors_checks(name, api, path, good_origins, bad_origin='https://evil.example'):
    head('%s: who the Worker lets in' % name)
    for o in good_origins:
        got = preflight(api, path, o)
        ok('allows %s' % o, got == o, why='answered %r, so a browser there throws the reply away' % got)
    got = preflight(api, path, bad_origin)
    ok('refuses an unknown origin', got != bad_origin, why='it was allowed in')


def public_key_cannot_reach_data():
    head('The public Supabase key must not reach anything')
    cfg = None
    for candidate in (os.path.join(ROOT, 'venueplay', 'app', 'trivia', 'screen.html'),
                      os.path.join(PARTYPLAY_LOCAL, 'site', 'lib', 'pp-config.js')):
        if os.path.isfile(candidate):
            cfg = io.open(candidate, encoding='utf-8').read()
            break
    if not cfg:
        ok('found a public key to test with', False, 'no config file')
        return
    url = (re.search(r'https://[a-z0-9]+\.supabase\.co', cfg) or [None])
    key = re.search(r'(eyJ[A-Za-z0-9_.-]{60,}|sb_publishable_[A-Za-z0-9_-]+)', cfg)
    if not url or not key:
        ok('found a public key to test with', False, 'could not read one out of the config')
        return
    url, key = url.group(0), key.group(0)
    h = {'apikey': key, 'authorization': 'Bearer ' + key}

    for t in ('vp_venues', 'vp_players', 'vp_sessions', 'vp_captures',
              'pp_licences', 'pp_admins', 'vp_games'):
        status, body, _ = get(url + '/rest/v1/' + t + '?select=*&limit=1')
        leaked = False
        try:
            d = json.loads(body)
            leaked = isinstance(d, list) and len(d) > 0
        except Exception:
            pass
        ok('cannot READ %s' % t, not leaked, why='IT RETURNED ROWS')

    for t in ('vp_venues', 'pp_licences', 'pp_admins'):
        status, body = post(url + '/rest/v1/' + t, {}, h)
        ok('cannot WRITE %s' % t, status in (401, 403),
           why='HTTP %s: the write was not refused' % status)


def admin_routes_refuse():
    head('Admin and money routes must refuse a stranger')
    for path, method in [('/admin/stats', 'GET'), ('/admin/whoami', 'GET'),
                         ('/admin/staff', 'GET')]:
        status, body, _ = get(PP_API + path)
        ok('PartyPlay %s refuses' % path, status == 403, why='HTTP %s' % status)
    for path in ['/admin/staff/add', '/admin/staff/off', '/admin/comp', '/admin/nudge-expiring']:
        status, body = post(PP_API + path, {})
        ok('PartyPlay %s refuses' % path, status == 403,
           why='HTTP %s %s' % (status, body[:60]))

    # A 500 here means it threw before it checked, which is how a broken route hides.
    status, body = post(PP_API + '/licence/resend', {'code': 'ZZZZZZ'})
    ok('/licence/resend answers cleanly', status in (200, 400, 503), 'HTTP %s %s' % (status, body[:60]))
    if status == 200:
        try:
            d = json.loads(body)
            ok('resend does not reveal which codes are real',
               'sent' not in d and 'tooSoon' not in d, json.dumps(d)[:60])
        except Exception:
            pass

    status, body = post(PP_API + '/stripe/webhook', {'type': 'x'})
    ok('Stripe webhook rejects an unsigned event', status == 400,
       why='HTTP %s: a 404 means the path is wrong, not that it is safe' % status)


def cannot_change_a_party_without_the_key():
    head('A party cannot be changed by someone who only knows the code')
    for path in ['/party/games', '/party/start']:
        status, body = post(PP_API + path, {'code': 'ZZZZZZ'})
        ok('%s refuses without the host key' % path, status in (400, 401, 403, 404),
           why='HTTP %s %s' % (status, body[:50]))


def summary(which, ran_live):
    print('\n' + '=' * 66)
    if failed:
        print('%s%d FAILED%s, %d passed, %d checks in total' % (RED, failed, OFF, passed, checked_things))
        print('\nWhat is wrong:')
        for f in failures:
            print('  - ' + f)
        print('\nA "the old build is still up" line usually means Cloudflare Pages has')
        print('not finished. It has been taking 15 to 25 minutes. Re-run before panicking.')
    else:
        print('%sAll %d checks passed.%s' % (GRN, checked_things, OFF))

    print('\n%sWHAT THIS DOES NOT CHECK%s' % (YEL, OFF))
    print("""  Four of the five faults found in live testing on 27 Aug only appear when a
  game is actually running, and nothing here would have caught any of them.
  This tool cannot open a browser. After a release that touches a game, a
  screen or a phone, somebody has to:

    1. Open /tv on a real screen and watch the ads rotate.
    2. Start each game from the host console and confirm the big screen follows.
    3. Start the WRONG game, then the right one, and confirm every phone moves.
    4. Join on a phone, put a name in, and confirm the name is on the screen.
    5. Play a musical bingo clip and confirm the room can hear it.
    6. On PartyPlay: charades shows the word on ONE phone and nothing on the TV.
    7. Watch the browser console on every screen. It should be silent.

  If the release only touched copy, a document or an email template, the list
  above can be skipped. If it touched a game, it cannot.""")
    return 1 if failed else 0


def main():
    args = [a for a in sys.argv[1:]]
    which = 'both'
    for a in args:
        if a in ('venueplay', 'partyplay'):
            which = a
    local_only = '--local' in args
    live_only = '--live' in args
    wait = '--wait' in args

    global _scanner
    _scanner = _load_scanner()
    print('%sRELEASE CHECK%s  %s%s' % (YEL, OFF, which, '  (local only)' if local_only else ''))

    if not live_only:
        local_checks(which)
    if not local_only:
        if wait:
            wait_for_deploy()
        if which in ('both', 'venueplay'):
            pages_live('VenuePlay', VP, VP_PAGES)
            worker_health('VenuePlay game', VP_GAME)
            worker_health('VenuePlay billing', VP_API)
            cors_checks('VenuePlay', VP_GAME, '/play/live',
                        ['https://venueplay.com.au', 'https://www.venueplay.com.au'])
        if which in ('both', 'partyplay'):
            pages_live('PartyPlay', PP, PP_PAGES)
            worker_health('PartyPlay', PP_API)
            cors_checks('PartyPlay', PP_API, '/join',
                        ['https://partyplay.com.au', 'https://www.partyplay.com.au'],
                        bad_origin='https://partyplay.pages.dev')   # NOT ours, see allowedOrigin
            admin_routes_refuse()
            cannot_change_a_party_without_the_key()
        public_key_cannot_reach_data()

    sys.exit(summary(which, not local_only))


if __name__ == '__main__':
    main()
