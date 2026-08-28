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

  python3 tools/release-check.py --vp-base https://my-branch.venueplay.pages.dev
        Check a Cloudflare Pages PREVIEW instead of production. This is the point
        of a staging step: the branch build gets the full page sweep before
        anything reaches the venue. Note what a preview does NOT isolate: it
        serves branch SITE code but talks to the same Workers and the same
        database as production, so play on it with a throwaway venue slug.
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


def note(label, detail=''):
    """Something looked at but NOT judged. Counts as neither a pass nor a fail.

    A check that cannot decide must not answer "ok". The stale-session check only
    judges between four and ten in the morning, and at 10:04 it reported ok on a
    session that was still sitting there open. That is the exact false pass this
    tool exists to prevent, produced by the tool itself.
    """
    print('  %snote%s %s %s%s%s' % (YEL, OFF, label.ljust(52), DIM, detail, OFF))


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
        # The Workers too. They were NOT in this sweep, and on 28 Aug a Worker
        # with three junk characters injected before its opening comment went
        # through the pre-push gate untouched, straight to main. The gate had
        # never once parsed the file it was letting past.
        wdir = os.path.join(ROOT, 'venueplay-backend', 'worker')
        if os.path.isdir(wdir):
            for f in sorted(os.listdir(wdir)):
                if f.endswith('.js') and not f.endswith('.test.js'):
                    files.append(os.path.join(wdir, f))
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

    """A WORKER MUST ALSO LOAD, NOT JUST PARSE.

    A stray token pasted above the opening comment, ' QLD/**' instead of '/**',
    parses perfectly: JavaScript reads it as an expression statement. It then
    throws ReferenceError the instant the module is evaluated, and the entire
    Worker is dead, every route, on the first request.

    That got into main and sat there. The parse check said fine, and check-defs
    only looks at things that are CALLED, so a bare identifier sailed past both.
    This runs the module's top level and insists it survives. It is the only
    check here that asks whether the code would actually start.

    Handlers are never invoked: nothing reaches the network or the database. All
    that runs is what a Worker runs at load, which is the declarations."""
    worker_bad = []
    for f in files:
        b = os.path.basename(f)
        if not b.endswith('.js') or 'worker' not in f.replace('\\', '/'):
            continue
        src = io.open(f, encoding='utf-8').read()
        src = re.sub(r'^export default', 'var _d =', src, flags=re.M)
        io.open('/tmp/_rc_load.js', 'w', encoding='utf-8').write(src)
        r = subprocess.run([JSC, '-e',
            'try{ (new Function(readFile("/tmp/_rc_load.js")))(); print("OK"); }'
            'catch(e){ print("ERR "+e); }'], capture_output=True, text=True)
        if 'OK' not in r.stdout:
            worker_bad.append('%s: %s' % (b, r.stdout.strip()[:90]))
    ok('every Worker actually loads, not just parses', not worker_bad,
       why='; '.join(worker_bad[:2]))

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

    gt = os.path.join(ROOT, 'venueplay-backend', 'worker', 'one-game.test.js')
    if os.path.isfile(gt):
        r = subprocess.run([JSC, gt], capture_output=True, text=True)
        out = (r.stdout + r.stderr).strip().splitlines()
        line = out[-1] if out else ''
        ok('one-game.test.js', 'ALL' in line and 'PASSED' in line, line)

    head('D. A shared script is loaded before it is used')
    """A page that uses PPConfig above the tag that loads it throws a
    ReferenceError and everything after it in that block simply never runs. It is
    silent: the page looks fine, the feature just never happens. partyplay's
    parties counter was dead this way and nobody could have noticed, because it
    hides itself below 25 parties and there are none yet."""
    GLOBALS = {'pp-config.js': 'PPConfig', 'pp-ticket.js': 'PPTicket', 'pp-quiz.js': 'PPQuiz',
               'pp-photo.js': 'PPPhoto', 'pp-video.js': 'PPVideo', 'vp-sign.js': 'VPSign',
               'vp-gaming.js': 'VPGaming', 'vp-follow.js': 'VPFollow',
               'vp-screen-router.js': 'VPScreenRouter', 'vp-session.js': 'VPSession'}
    late = []
    for f in files:
        if not f.endswith('.html'):
            continue
        src = io.open(f, encoding='utf-8').read()
        loads = {}
        for m in re.finditer(r'<script[^>]*\bsrc="([^"]+)"', src):
            loads.setdefault(m.group(1).split('/')[-1], m.start())
        for tag, body in re.findall(r'(<script(?![^>]*\bsrc=)[^>]*>)(.*?)</script>', src, re.S):
            at = src.index(body)
            for lib, g in GLOBALS.items():
                if lib not in loads:
                    continue
                m = re.search(r'(?<![.\w])' + g + r'\s*\.', body)
                if m and at + m.start() < loads[lib]:
                    late.append('%s uses %s before %s' % (short(f), g, lib))
    ok('every shared script loads before it is used', not late, why='; '.join(late[:3]))

    head('D. Founding pages: the code, the month and the date agree')
    """Each state page carries its founding code, its month in prose, and a
    closing date, in several places. They are edited by hand and they drift. On
    28 Aug a month replacement produced "31 September 2026", a date that does not
    exist, and left "31 August" further down the same page saying something else.
    A venue reads the page and is charged on the code."""
    import calendar as _cal
    MON = ('January|February|March|April|May|June|July|August|September|October|'
           'November|December')
    ABBR = {m[:3].upper(): i + 1 for i, m in enumerate(
        ['January','February','March','April','May','June','July','August',
         'September','October','November','December'])}
    wrong = []
    for f in files:
        b = os.path.basename(f)
        if b not in ('nsw.html','qld.html','vic.html','sa.html','wa.html','nt.html','tas.html','act.html'):
            continue
        src = io.open(f, encoding='utf-8').read()
        codes = set(re.findall(r'[A-Z]{2,3}-([A-Z]{3})-(20\d\d)', src))
        if len(codes) != 1:
            wrong.append('%s has %d different codes' % (b, len(codes)))
            continue
        mon3, yr = codes.pop()
        num = ABBR.get(mon3)
        if not num:
            wrong.append('%s: %s is not a month' % (b, mon3))
            continue
        name = _cal.month_name[num]
        last = _cal.monthrange(int(yr), num)[1]
        text = re.sub(r'<script.*?</script>|<style.*?</style>', '', src, flags=re.S)
        text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', text))
        for m in re.finditer(r'(\d{1,2})?\s*(%s)\b' % MON, text):
            day, said = m.group(1), m.group(2)
            if said != name:
                wrong.append('%s says %s but its code says %s' % (b, said, name)); break
            if day and int(day) != last:
                wrong.append('%s says %s %s, but %s %s has %d days'
                             % (b, day, said, said, yr, last)); break
    ok('every founding page agrees with its own code', not wrong, why='; '.join(wrong[:3]))

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


def changed_files_since(ref='HEAD~1'):
    """The files this release actually changed, so we can wait for THOSE."""
    try:
        out = subprocess.run(['git', 'diff', '--name-only', ref, 'HEAD'],
                             capture_output=True, text=True, cwd=ROOT).stdout
        return [f.strip() for f in out.splitlines() if f.strip()]
    except Exception:
        return []


def live_matches_local(path_in_repo):
    """Is the live page byte-identical to the file in this working copy?

    THIS is how you tell a deploy has landed. The fixed markers below never
    change between releases, so waiting on them returned "deployed" instantly
    even when the old build was still up, which is precisely the false pass this
    whole tool exists to stop. It caught me the first time I used it.
    """
    local = os.path.join(ROOT, path_in_repo)
    if not os.path.isfile(local):
        return None
    if path_in_repo.startswith('venueplay/'):
        base, rel = VP, path_in_repo[len('venueplay/'):]
    elif path_in_repo.startswith('partyplay/'):
        base, rel = PP, path_in_repo[len('partyplay/'):]
    else:
        return None                       # tools, docs: nothing is served
    url = base + '/' + rel
    status, body, _ = get(url)
    if status != 200:
        return False
    want = io.open(local, encoding='utf-8').read()
    return body.strip() == want.strip()


def wait_for_deploy(minutes=30):
    """Sit here until THIS release is actually being served.

    Cloudflare Pages has taken anywhere from three to twenty-five minutes, and
    checking too early reads the old build. So compare the live pages against the
    files this release changed, which is the only thing that actually moves.
    """
    import time
    head('Waiting for Cloudflare Pages')
    changed = [f for f in changed_files_since()
               if f.startswith(('venueplay/', 'partyplay/')) and f.endswith(('.html', '.js'))]
    if changed:
        print('  %swaiting on %d changed file(s), e.g. %s%s' % (DIM, len(changed), changed[0], OFF))
        deadline = time.time() + minutes * 60
        started = time.time()
        while time.time() < deadline:
            stale = [f for f in changed if live_matches_local(f) is False]
            if not stale:
                ok('this release is live', True, 'took %d seconds' % (time.time() - started))
                break
            print('  %s...%s %d still on the old build, e.g. %s' % (DIM, OFF, len(stale), stale[0]))
            time.sleep(30)
        else:
            ok('this release is live', False,
               why='still stale after %d minutes: %s' % (minutes, ', '.join(stale[:3])))
    else:
        print('  %snothing served was changed in the last commit%s' % (DIM, OFF))

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
    head('%s pages: is the CURRENT build actually being served%s'
         % (name, '' if base in (VP, PP) else '   [%s]' % base))
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


def every_page_is_reachable(name, base, folder, skip=()):
    """Every page in the repo, not only the ones somebody remembered to list.

    The table above is hand-written and will drift: a page added next month is a
    page nobody checks. This walks what is actually in the repository, so a file
    that stops being served is noticed by the tool rather than by a customer.
    """
    head('%s: every page in the repo is reachable' % name)
    root = os.path.join(ROOT, folder)
    if not os.path.isdir(root):
        # Not a fault in the site: this checkout does not have that folder, which
        # almost always means it is behind. Say THAT, rather than "no such folder",
        # which reads like the pages are missing when they are serving perfectly.
        ok('%s pages enumerated from the repo' % name, False,
           why='this working copy has no %s/ folder, so the pages could not be '
               'listed. It is probably out of date: run "git fetch && git status" '
               'and see how far behind it is.' % folder)
        return
    pages, bad = [], []
    for d, _, fs in os.walk(root):
        if any(x in d for x in ('emails', '.git')):
            continue
        for f in fs:
            if not f.endswith('.html') or f.startswith('_'):
                continue
            rel = os.path.relpath(os.path.join(d, f), root)
            if rel in skip:
                continue
            pages.append(rel)
    for rel in sorted(pages):
        url = base + '/' + rel
        status, body, _ = get(url)
        if status != 200 or len(body) < 300:
            bad.append('%s (HTTP %s)' % (rel, status))
    ok('all %d page(s) serve' % len(pages), not bad, why='not served: ' + ', '.join(bad[:5]))


# Which source file each deployed Worker is pasted from, so a build stamp coming
# back from /health can be compared with the one in the repo.
WORKER_SOURCE = {
    'VenuePlay game':    'venueplay-backend/worker/venueplay-game.js',
    'VenuePlay billing': 'venueplay-backend/worker/venueplay-api-FULL.js',
    'PartyPlay':         'partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js',
}


def repo_build(name):
    """The stamp the repo says this Worker should be carrying."""
    src_path = WORKER_SOURCE.get(name)
    if not src_path:
        return None
    p = os.path.join(ROOT, src_path)
    if not os.path.isfile(p):
        return None
    m = re.search(r"const BUILD = '([0-9a-f]{8})'", io.open(p, encoding='utf-8').read())
    return m.group(1) if m else None


def worker_health(name, api, needs_config=True):
    head('%s Worker' % name)
    status, body, _ = get(api + '/health')
    if status == 200:
        try:
            d = json.loads(body)
            ok('%s health' % name, d.get('ok') is True,
               why='missing: %s%s' % (', '.join(d.get('missing', [])) or 'nothing',
                                      '. ' + d['warning'] if d.get('warning') else ''))
            # Things that fail QUIETLY: no SMS and staff never get a sign-in code,
            # no email and welcome and invoice emails simply stop.
            for cap, on in (d.get('can') or {}).items():
                ok('%s can %s' % (name, cap), bool(on),
                   why='not configured, and it fails without saying anything')
            # A Worker is deployed by pasting it into a browser: no build, no
            # version, no way to tell which copy is running. "Did I paste that?"
            # was unanswerable, and today it was asked about a fix that decides
            # whether a discount can be applied at all.
            want = repo_build(name)
            if want:
                live = d.get('build')
                if not live:
                    note('%s build' % name,
                         'this deployed copy predates build stamps. Paste it once more and '
                         'this becomes a straight yes or no.')
                else:
                    ok('%s is running the current code' % name, live == want,
                       'build %s' % live,
                       why='deployed %s, repo has %s. Paste %s.'
                           % (live, want, os.path.basename(WORKER_SOURCE[name])))
            if 'photos' in d:
                ok('%s photo store is bound' % name, d.get('photos') is True,
                   why='R2 is not bound as PHOTOS, so every photo and video upload '
                       'fails and the album is empty. Cloudflare > the Worker > '
                       'Settings > Bindings > R2 bucket, variable name PHOTOS.')
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
    ok('refuses %s' % bad_origin, got != bad_origin,
       why='it was ALLOWED IN. That site is not ours, so a stranger can call this '
           'Worker from a visitor browser. Paste the current Worker build.')


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


# Venues to watch for a session nobody closed. Add a slug here when a venue goes
# live. Read-only: it asks the same public endpoint a phone asks.
WATCH_VENUES = ['the-average-joe']


def venue_code(slug):
    """The same hash the site uses to turn a slug into a channel code."""
    t = ''.join(c for c in slug.lower() if c.isalnum())
    h = 2166136261
    for ch in t:
        h ^= ord(ch)
        h = (h * 16777619) & 0xffffffff
    A, out, x = 'ACDEFGHJKMNPQRSTUVWXYZ2345679', '', (h or 1)
    for _ in range(6):
        x = (x * 1103515245 + 12345) & 0xffffffff
        out += A[x % len(A)]
    return out


def no_session_left_open():
    """A session nobody closed is a billing problem, not just untidy.

    /session/close only ever runs in the browser, so a host who shuts the tablet
    without signing out leaves the session open. Every later night's players then
    append to that SAME session, and when it finally closes one invoice bills
    every player who ever joined it. The Worker has a nightly sweep for exactly
    this, but it does nothing at all unless a Cron Trigger is configured in the
    Cloudflare dashboard.

    So: check. A session reading live with no game running, in the small hours, is
    one nobody closed.
    """
    import datetime
    head('No venue has a session nobody closed')
    hour = datetime.datetime.now().hour
    # Between four and ten in the morning nobody is running a bingo night, so a
    # session reading live then was left open. At other hours it might be real,
    # and calling a live night "stale" would be worse than saying nothing.
    quiet = 4 <= hour < 10
    for slug in WATCH_VENUES:
        status, body, _ = get(VP_GAME + '/play/live?code=' + venue_code(slug))
        try:
            d = json.loads(body)
        except Exception:
            ok('%s reachable' % slug, False, why='no JSON back')
            continue
        if not d.get('exists'):
            ok('%s is a known venue' % slug, False, why='the Worker does not know that slug')
            continue
        live, fmt = d.get('live'), (d.get('format') or '')
        if live and not fmt and quiet:
            ok('%s has no session left open' % slug, False,
               why='a session reads LIVE at %02d:00 with no game running. Nobody closed it. '
                   'Set a Cron Trigger on the game Worker (0 17 * * * is 3am Brisbane) '
                   'so the nightly sweep runs.' % hour)
        elif live and not fmt:
            note('%s: cannot judge right now' % slug,
                 'a session is live with no game running, but at %02d:00 that may be a '
                 'real lobby. Run this again between 4am and 10am for an answer.' % hour)
        else:
            ok('%s has no session left open' % slug, True,
               'live=%s game=%s' % (live, fmt or 'none'))


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

    """AND SOMEBODY MUST BE ABLE TO GET IN.

    Everything above proves the lock works. It says nothing about whether any
    key fits, and that is not a hypothetical: pp_admins shipped with no rows,
    so comping a party answered 'no' and every check here still passed. A door
    nobody can open is not secure, it is broken.

    Health reports the count, so this can ask without holding a credential."""
    status, body, _ = get(PP_API + '/health')
    try:
        d = json.loads(body)
    except Exception:
        d = {}
    if 'admins' not in d:
        note('PartyPlay admin count', 'the deployed Worker predates this check')
    else:
        n = d.get('admins')
        ok('somebody can actually sign in to the PartyPlay admin',
           n is None or n > 0,
           why='pp_admins has %s active rows, so nobody can comp, refund or resend' % n)


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

    # A preview URL to check instead of production, so a branch can be swept
    # before anything reaches a venue.
    global VP, PP
    for flag, which_base in (('--vp-base', 'vp'), ('--pp-base', 'pp')):
        if flag in args:
            i = args.index(flag)
            if i + 1 >= len(args):
                sys.exit('%s needs a URL after it' % flag)
            url = args[i + 1].rstrip('/')
            if which_base == 'vp':
                VP = url
                which = 'venueplay'
            else:
                PP = url
                which = 'partyplay'
            print('%sChecking a preview:%s %s' % (YEL, OFF, url))

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
            every_page_is_reachable('VenuePlay', VP, 'venueplay',
                                    skip=('test.html',))
            worker_health('VenuePlay game', VP_GAME)
            worker_health('VenuePlay billing', VP_API)
            cors_checks('VenuePlay', VP_GAME, '/play/live',
                        ['https://venueplay.com.au', 'https://www.venueplay.com.au'])
            no_session_left_open()
        if which in ('both', 'partyplay'):
            pages_live('PartyPlay', PP, PP_PAGES)
            every_page_is_reachable('PartyPlay', PP, 'partyplay')
            worker_health('PartyPlay', PP_API)
            cors_checks('PartyPlay', PP_API, '/join',
                        ['https://partyplay.com.au', 'https://www.partyplay.com.au'],
                        bad_origin='https://partyplay.pages.dev')   # NOT ours, see allowedOrigin
            admin_routes_refuse()
            cannot_change_a_party_without_the_key()
        # A preview serves branch SITE code but talks to the production Workers
        # and the production database, so these are the same either way. Run them
        # anyway: it is worth knowing they are still sound.
        public_key_cannot_reach_data()

    sys.exit(summary(which, not local_only))


if __name__ == '__main__':
    main()
