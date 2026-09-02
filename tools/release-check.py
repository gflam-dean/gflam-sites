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

# THE PARTYPLAY FILES THAT DEPLOY ARE IN THIS REPO, and for a long time this
# gate read a different copy of them. ~/partyplay is an older working copy: it
# has no practice.html at all, and its admin, host, index, run and tv pages had
# all drifted from the ones on partyplay.com.au. So the sweep was parsing five
# pages nobody serves, skipping one that everybody does, and blessing a Worker
# build that was two changes behind its own source.
#
# Everything now reads the repo. The old copy is still where Dean edits by hand
# sometimes, so it is checked too when it is there, but it is never the one that
# decides. One comment further down already warned about this for the trivia
# packs; it turned out to be true of nearly the whole PartyPlay half.
PARTYPLAY_SITE  = os.path.join(ROOT, 'partyplay')
PARTYPLAY_BACK  = os.path.join(ROOT, 'partyplay-backend')
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
    for base, name in ((ROOT, ''), (PARTYPLAY_LOCAL, '~/partyplay/')):
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


_JS_LIT = re.compile(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\]|\\.)*)`', re.S)


def js_prose(path):
    """The sentences inside a .js file: its string literals, comments already
    stripped, and only the ones that read like prose.

    A literal with no space in it is a route, a key, a class name or an id, and
    "/host/members/roster" is not a house-rule breach. Requiring a space and
    three letters keeps the scan to things a punter could actually read, which
    is what the rules are about. Checked when it was written: two real breaches,
    no false positives, across every shipped script in both products.
    """
    out = []
    for m in _JS_LIT.finditer(copy_text(path)):
        lit = m.group(1) or m.group(2) or m.group(3) or ''
        if ' ' in lit and re.search(r'[A-Za-z]{3}', lit):
            out.append(lit)
    return '\n'.join(out)


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
    if which in ('both', 'partyplay'):
        for d in (PARTYPLAY_SITE, os.path.join(PARTYPLAY_SITE, 'lib'),
                  os.path.join(PARTYPLAY_BACK, 'lib'),
                  os.path.join(PARTYPLAY_BACK, 'worker')):
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
    checker = os.path.join(PARTYPLAY_SITE, 'check-defs.py')
    if not os.path.isfile(checker):
        checker = os.path.join(PARTYPLAY_LOCAL, 'check-defs.py')
    if os.path.isfile(checker):
        args = [a for a in files if a.endswith('.html') or a.endswith('.js')]
        r = subprocess.run([sys.executable, checker] + args,
                           capture_output=True, text=True, cwd=ROOT)
        out = (r.stdout + r.stderr).strip().splitlines()
        ok('definition check across %d file(s)' % len(args), r.returncode == 0,
           out[-1].strip() if out else '')
    else:
        ok('definition checker present', False, 'check-defs.py not found')

    head('C. Unit tests')
    for base in ([PARTYPLAY_SITE, PARTYPLAY_BACK] if which in ('both', 'partyplay') else []):
        for sub in ('', 'lib', 'worker'):
            d = os.path.join(base, sub) if sub else base
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

    """AND EVERY LINK ON THOSE PAGES GOES SOMEWHERE.

    The pages are checked. What is ON them was not, and the cold outreach is
    about to send venue owners to them, where a dead link is the entire first
    impression. check-links.py resolves our own links against the repo rather
    than following them, because Pages answers a missing path with the homepage
    and a 200, so following them would call every broken one healthy."""
    lp = os.path.join(ROOT, 'tools', 'check-links.py')
    if os.path.isfile(lp):
        r = subprocess.run([sys.executable, lp,
                            which if which in ('venueplay', 'partyplay') else 'both'],
                           capture_output=True, text=True, cwd=ROOT)
        out = [l for l in (r.stdout + r.stderr).strip().splitlines() if l.strip()]
        summary = next((l.strip() for l in out if 'link(s) followed' in l), '')
        broken = [l for l in out if 'BROKEN' in l]
        ok('every link on our own pages goes somewhere', r.returncode == 0,
           re.sub(r'\033\[[0-9;]*m', '', summary),
           why='; '.join(re.sub(r'\033\[[0-9;]*m', '', b).strip() for b in broken[:3]))

    # The trivia pack suite used to be run by name here, because the loop above
    # only knew about the OTHER working copy and would never have found it. The
    # loop reads the repo now, so it picks the suite up like every other one and
    # running it again by name only printed it twice.

    """VenuePlay's own suites, wherever they sit.

    one-game.test.js used to be named here on its own, so the musical draw suite
    written after the live night would have sat in the repo passing nothing. Sweep
    the game folders instead: a suite that is added is a suite that runs.

    They are run from ROOT because each one reads the page or the library it is
    about, rather than a copy of it, and resolves those paths from here."""
    vp_suites = []
    # Both trees, swept. one-game.test.js used to be named here on its own, and the
    # slug ladder suite written next to it would have run nowhere.
    for base in (os.path.join(ROOT, 'venueplay', 'app'),
                 os.path.join(ROOT, 'venueplay-backend', 'worker')):
        for d, _, fs in os.walk(base):
            for f in sorted(fs):
                if f.endswith('.test.js'):
                    vp_suites.append(os.path.join(d, f))
    for t in vp_suites:
        r = subprocess.run([JSC, t], capture_output=True, text=True, cwd=ROOT)
        out = (r.stdout + r.stderr).strip().splitlines()
        line = out[-1] if out else ''
        ok(os.path.basename(t), 'ALL' in line and 'PASSED' in line, line)

    head('D. One answer per question, everywhere it is asked')
    """THE SAME FUNCTION, COPIED INTO TWENTY FILES, DRIFTS.

    Dean, 31 Aug, on a rule fixed in one place a month earlier: "I asked you to
    fix this a month ago and you only fixed it in one place." This is the check
    for that, on the handful of functions where a difference is dangerous rather
    than merely untidy.

    esc() is what stands between text a venue typed and the screen, and it was
    ELEVEN DIFFERENT FUNCTIONS across 23 files. Fifteen of them left quotes
    alone. Nothing was exploitable when it was found -- every interpolation into
    an attribute was checked, and there were none -- but the next one written in
    the wrong file would have been, silently, with no way to notice.

    cryptoInt() is the unbiased draw behind every raffle and members draw, in 11
    files. One copy quietly losing its rejection loop is a biased draw, and that
    is a licence matter, not a bug.

    tvSend() is called from repaint paths and ch.send throws once the socket is
    gone. tv.html caught that; the other three screens did not, so the same dead
    socket left bingo's wall alone and blacked out musical, trivia and raffle.

    NOT drawQR: signage prints a wider quiet zone on purpose, and see-a-night
    draws a fake one for the marketing page. Different jobs, same name."""
    SAME = ['esc', 'cryptoInt', 'tvSend']
    def fnbody(src, name):
        m = re.search(r'\n\s*function\s+' + name + r'\s*\(', src)
        if not m:
            return None
        i = src.index('{', m.end() - 1)
        d = 0
        for j in range(i, len(src)):
            if src[j] == '{':
                d += 1
            elif src[j] == '}':
                d -= 1
                if d == 0:
                    return src[m.start():j + 1]
        return None

    def flatten(t):
        t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
        t = re.sub(r'//[^\n]*', '', t)
        return re.sub(r'\s+', ' ', t).strip()

    for name in SAME:
        seen = {}
        for f in files:
            if not (f.endswith('.html') or f.endswith('.js')):
                continue
            b = fnbody(io.open(f, encoding='utf-8', errors='replace').read(), name)
            if b:
                seen.setdefault(flatten(b), []).append(short(f))
        if not seen:
            continue
        biggest = max(seen.values(), key=len)
        odd = [f for v in seen.values() if v is not biggest for f in v]
        ok('%s() is the same in all %d file(s)' % (name, sum(len(v) for v in seen.values())),
           len(seen) == 1, '%d file(s)' % sum(len(v) for v in seen.values()),
           why='%d version(s); the odd ones out: %s' % (len(seen), ', '.join(odd[:4])))

    head('D. The song library holds together')
    """5,131 songs and 19 playlists in one JSON file that every musical bingo night
    is dealt from, and nothing checked it. A playlist pointing at a song id that is
    not there deals a blank cell nobody can ever tap, and a song held twice can be
    played twice in one night.

    Cheap to check and impossible to notice by reading: this is data, not code, so
    it parses fine no matter how wrong it is."""
    libp = os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json')
    try:
        lib = json.load(io.open(libp, encoding='utf-8'))
        songs, pls = lib['songs'], lib['playlists']
        ids = set()
        dupe_ids = [s_['id'] for s_ in songs if s_['id'] in ids or ids.add(s_['id'])]
        pairs = {}
        same = []
        for s_ in songs:
            k = (s_['title'].lower(), s_['artist'].lower())
            if k in pairs:
                same.append(s_['title'])
            pairs[k] = 1
        broken = [(p_['name'], i) for p_ in pls for i in p_['songIds'] if i not in ids]
        empty = [p_['name'] for p_ in pls if not p_['songIds']]
        noaudio = [s_['title'] for s_ in songs if not s_.get('previewUrl')]
        dated = sum(1 for s_ in songs if s_.get('year'))
        ok('every playlist points at songs that exist', not broken,
           '%d songs, %d playlists' % (len(songs), len(pls)),
           why='; '.join('%s -> %s' % b for b in broken[:3]))
        ok('no song is held twice', not dupe_ids and not same,
           why='; '.join((dupe_ids + same)[:3]))
        ok('every song has audio', not noaudio, why='; '.join(noaudio[:3]))
        ok('no playlist is empty', not empty, why=', '.join(empty[:3]))
        # A host picking "2000s" gets the 2000s only if the years are actually there.
        ok('songs know what year they are', dated >= int(len(songs) * 0.95),
           '%d of %d dated' % (dated, len(songs)),
           why='only %d%% dated' % (100 * dated // max(1, len(songs))))
    except Exception as e:
        ok('the song library parses', False, why=str(e)[:120])

    head('D. A shared script is loaded before it is used')
    """A page that uses PPConfig above the tag that loads it throws a
    ReferenceError and everything after it in that block simply never runs. It is
    silent: the page looks fine, the feature just never happens. partyplay's
    parties counter was dead this way and nobody could have noticed, because it
    hides itself below 25 parties and there are none yet."""
    GLOBALS = {'pp-config.js': 'PPConfig', 'pp-ticket.js': 'PPTicket', 'pp-quiz.js': 'PPQuiz',
               'pp-photo.js': 'PPPhoto', 'pp-video.js': 'PPVideo', 'vp-sign.js': 'VPSign',
               'vp-gaming.js': 'VPGaming', 'vp-follow.js': 'VPFollow',
               'vp-screen-router.js': 'VPScreenRouter', 'vp-session.js': 'VPSession',
               'vp-feedback.js': 'VPFeedback', 'vp-celebrate.js': 'VPCelebrate',
               'vp-qr.js': 'VPQR'}
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
        # AND IT MUST BE THIS STATE'S CODE. The month check would not blink at
        # tas.html carrying VIC-OCT-2026, and the Worker prices founding off the
        # POSTCODE's state, so every Tasmanian venue would see $2.50 on the page
        # and be charged $3.00 with nothing on screen to explain it. These pages
        # are made by cloning each other, which is exactly how that happens.
        # ACT and NSW are deliberately one market: the Worker accepts an ACT
        # postcode on an NSW code and says so where it does it.
        pre = set(re.findall(r'([A-Z]{2,3})-[A-Z]{3}-20\d\d', src))
        want = b[:-5].upper()
        allowed = {want} | ({'NSW'} if want == 'ACT' else set())
        if not pre or not pre <= allowed:
            wrong.append('%s carries %s' % (b, ', '.join(sorted(pre)) or 'no code'))
            continue
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

    """EVERY PAGE THAT JOINS A PLAYER MUST SAY WHICH DEVICE IT IS.

    The Worker de-duplicates a re-join on the `pid` the phone sends. A page that
    posts /join without one mints a NEW metered player row every time, so a
    refresh, or a phone hopped from the venue link into a game room, is billed as
    another person. /play did that for the whole of its life, and the comment
    above the call said the opposite, which is why nothing caught it: the claim
    was checked by eye and believed.

    This is a money check, not a tidiness one."""
    joiners = []
    for f in files:
        if not f.endswith('.html'):
            continue
        # VenuePlay only, deliberately. PartyPlay's /join is not metered and is not
        # per head: a party is one flat price, and its phone keeps its token in
        # storage and reuses it, so a reload does not re-join. The most a second
        # trip through its join form costs is a guest called "Sam 2". Worth tidying
        # one day; it is not this check's fault to raise.
        if '%svenueplay%s' % (os.sep, os.sep) not in f:
            continue
        src = io.open(f, encoding='utf-8').read()
        # Every POST to /join in the file, with the object literal that follows it.
        for m in re.finditer(r'["\']/join["\']\s*,\s*(\{[^}]*\}|[A-Za-z_$][\w$]*)', src):
            arg = m.group(1)
            if arg.startswith('{'):
                if 'pid' not in arg:
                    joiners.append(short(f))
            else:
                # A variable: it has to be built with a pid somewhere in the file.
                if not re.search(r'\b%s\s*=\s*\{[^}]*pid' % re.escape(arg), src):
                    joiners.append(short(f))
    ok('every page that joins a player sends its device id', not joiners,
       why='no pid, so every rejoin mints and bills another player: ' +
           ', '.join(sorted(set(joiners))[:3]))

    """AND NO SCREEN MAY SHOW A SECOND CODE.

    Every game screen carries a setup line telling a host which code to type. It is
    a DIFFERENT code from the player one, and a live musical bingo night had both on
    the wall at once, because the line was only hidden once a session opened. A
    punter who reads the pairing code out lands on a channel with no game on it.

    The rule: whatever decides to hide that line must include the host being seen.
    Checked by reading the decision itself, because the failure looks like nothing
    at all until there are two codes in front of a room."""
    unhidden = []
    for game in ('trivia', 'musical', 'raffle', 'members'):
        f = os.path.join(ROOT, 'venueplay', 'app', game, 'screen.html')
        if not os.path.isfile(f):
            continue
        src = io.open(f, encoding='utf-8').read()
        if 'hostLine' not in src and 'hostline' not in src:
            continue
        # The line that decides, whichever shape that screen uses.
        decides = re.findall(r'(?:setupDone\s*=|hostLine"?\)?\.classList\.toggle\("hidden",)([^;\n]*)', src)
        if not any('hostSeen' in d for d in decides):
            unhidden.append('%s/screen.html' % game)
    ok('no screen leaves a second code up once the host is connected', not unhidden,
       why='the pairing code stays on the wall beside the player code on: ' + ', '.join(unhidden))

    """A COMMENT MAY NOT CLAIM AN EXEMPTION THE CODE DOES NOT GRANT.

    Five files said a message type was exempt from broadcast signing. The list
    in vp-sign.js is screen_refresh, tv_here, hello and rollcall, and none of
    the five named any of those. They all named to_ads or idle, which are the
    "give the wall back" messages, so on a venue with signing enforced every one
    of those pagehide handlers was silently a no-op and the TV sat on a finished
    game until the 90 minute timeout.

    That is the single most common fault in this codebase: a comment read as
    documentation that was never true, or stopped being true. A general check
    for lying comments is not possible. A check for THIS claim is, and it is the
    one that decides whether a pub's screen gets released."""
    signp = os.path.join(ROOT, 'venueplay', 'app', 'vp-sign.js')
    if os.path.isfile(signp):
        src = io.open(signp, encoding='utf-8').read()
        m = re.search(r'var EXEMPT\s*=\s*\{([^}]*)\}', src)
        real = set(re.findall(r'(\w+)\s*:', m.group(1))) if m else set()
        liars = []
        for d, _, fs in os.walk(os.path.join(ROOT, 'venueplay')):
            for f in sorted(fs):
                if not (f.endswith('.html') or f.endswith('.js')):
                    continue
                fp = os.path.join(d, f)
                if fp == signp:
                    continue
                for line in io.open(fp, encoding='utf-8', errors='replace'):
                    for claim in re.findall(r'(\w+)\s+is\s+EXEMPT', line):
                        if claim not in real:
                            liars.append('%s says %s' % (short(fp), claim))
        ok('no file claims an exemption vp-sign does not grant', not liars,
           'the real list is ' + ', '.join(sorted(real)),
           why='; '.join(liars[:3]) + '. Those messages are DROPPED under enforce.')

    """AND TWO MIGRATIONS MAY NOT SHARE A NUMBER.

    partyplay-12 exists twice. Migrations are run by hand, in order, from a
    folder listing, so two files with the same number is two people each
    believing they ran 12. This is cheap to check and impossible to notice."""
    for label, folder in (('VenuePlay', 'venueplay-backend/supabase'),
                          ('PartyPlay', 'partyplay-backend/supabase')):
        d = os.path.join(ROOT, folder)
        if not os.path.isdir(d):
            continue
        nums = {}
        for f in sorted(os.listdir(d)):
            # A letter suffix (12b) is a deliberate sibling of an already-run
            # migration, not a collision: renumbering a migration that has been
            # applied would tell the next person to run it again.
            m = re.match(r'\w+?-(\d+[a-z]?)-', f)
            if m:
                nums.setdefault(m.group(1), []).append(f)
        dupes = ['%s: %s' % (n, ' and '.join(v)) for n, v in sorted(nums.items()) if len(v) > 1]
        ok('%s migrations are numbered once each' % label, not dupes,
           '%d migrations' % len(nums),
           why='; '.join(dupes[:2]))

    head('D. House rules')
    # An em dash used as PUNCTUATION, which is the house rule. A lone "—" in a
    # table cell is a glyph meaning "no value yet", not a sentence, and flagging
    # forty of those buries the one real breach.
    #
    # THE .js FILES COUNT TOO. This scanned .html only, and shared widgets are
    # exactly where reusable player-facing copy now lives, so all three rules
    # were blind to them. On 2 Sep that was hiding an em dash in the feedback
    # widget every player sees after a game, and "the ACT" in the gaming licence
    # advice, a month after Dean asked for ACT. Both had been rewritten in every
    # .html and left standing in the one file no rule could see.
    rules = [('no em dashes in copy', r'\w\s*[—–]\s*\w', r'\w\s*[—–]\s*\w'),
             ('never "the ACT"', r'\bthe ACT\b', r'\bthe ACT\b'),
             # In markup a bare word is copy. In code "roster" is a table name, a
             # route and a variable, and those stay: only prose counts.
             ('never "roster" in copy', r'>[^<>]{0,60}\broster\b', r'\broster\b')]
    for label, pat, jspat in rules:
        hits = []
        for f in files:
            if f.endswith('.html'):
                text, p2 = copy_text(f), pat
            elif f.endswith('.js'):
                text, p2 = js_prose(f), jspat
            else:
                continue
            if not re.search(p2, text, re.I if 'roster' in label else 0):
                continue
            # Full path: both products have an index.html, and "index.html" on
            # its own sent me looking in the wrong one.
            hits.append(short(f))
        ok(label, not hits, why=', '.join(hits[:4]))

    """A WINNER IS SENT TO THE HOST, NEVER TO THE BAR.

    Dean's locked rule for bingo and paid tickets. It was applied to the phone a
    month ago and left standing in four other places: the TV's own win card, and
    three in the training simulator. So the room's two screens disagreed with
    each other in front of a winner, for a month, because a rule was fixed where
    somebody happened to be looking rather than everywhere it was written.

    That is the shape of half the faults in this codebase, and it is the one
    thing here a check can genuinely prevent. Copy only: the comment scanner
    strips code, so the several honest comments about "a dispute at the bar" and
    "a host walking to the bar" are not breaches.

    MEMBERS DRAWS ARE EXEMPT, deliberately. A club members' draw really is
    claimed at the bar, the member has to be present, and that is the venue's
    own practice rather than ours to overrule. If that ever changes it is a
    decision to make here, not an oversight to tidy."""
    bar_hits = []
    for f in files:
        if not f.endswith('.html') or '/members/' in f.replace('\\', '/'):
            continue
        for m in re.finditer(r'[^<>]{0,70}\b(?:at|to) the bar\b[^<>]{0,40}', copy_text(f), re.I):
            line = m.group(0)
            if re.search(r'\b(claim|collect|show|present|winner|prize|jackpot)\b', line, re.I):
                bar_hits.append('%s: "%s"' % (short(f), line.strip()[:60]))
    ok('a winner is sent to the host, never the bar', not bar_hits,
       why='; '.join(bar_hits[:3]))

    """A WORKER FILE THAT IS EMPTY PARSES PERFECTLY.

    venueplay-api-FULL.js was found at nought bytes on 31 Aug, truncated by a
    writer that died between the truncate and the write. Every check above was
    happy: an empty file parses, and an empty module loads without throwing. The
    only reason it was noticed is that a test tried to read it for something else.

    That file is the source of the billing Worker and it is deployed by pasting.
    So: it has to be big, and it has to still have the thing that makes it a
    Worker. Both tools that write these files use an atomic rename now, which
    should mean this never fires. It is here because it did.
    """
    for rel, floor in (('venueplay-backend/worker/venueplay-game.js', 150),
                       ('venueplay-backend/worker/venueplay-api-FULL.js', 150),
                       ('partyplay-backend/worker/DEPLOY-partyplay-api.js', 50),
                       ('partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js', 50)):
        f = os.path.join(ROOT, rel)
        if not os.path.isfile(f):
            continue
        kb = os.path.getsize(f) / 1024.0
        src = io.open(f, encoding='utf-8').read()
        ok('%s is whole' % os.path.basename(rel),
           kb >= floor and 'export default' in src,
           '%d KB' % kb,
           why='%d KB and %s an entry point. A truncated Worker still parses, so nothing '
               'else here would have caught it.'
               % (kb, 'has' if 'export default' in src else 'has NO'))

    head('E. The Worker you are about to paste')
    dep = os.path.join(PARTYPLAY_BACK, 'worker', 'DEPLOY-partyplay-api.js')
    if which in ('both', 'partyplay') and os.path.isfile(dep):
        src = io.open(dep, encoding='utf-8').read()
        stamp = re.search(r'Built ([^\n]+?)\s+fingerprint', src)
        good, msg = parses(re.sub(r'^export default', 'var _d =', src, flags=re.M))
        ok('deploy build parses', good, msg if not good else (stamp.group(1) if stamp else ''))
        ok('the licence library is inlined, not a marker', 'const PPLicence = (function' in src)

        """AND IT MUST BE BUILT FROM THE SOURCE AS IT STANDS NOW.

        Every check around this one reads the DEPLOY file, so a deploy file that
        was never rebuilt passes all of them while the change you just made sits
        only in the source. That is exactly what happened to the admin count in
        /health: written into the source at 01:32, and the file Dean pastes was
        still the build from the afternoon before, so the live Worker answered
        without it and this tool reported the gap as a note about the DEPLOYED
        Worker being old. It was not. The paste file was.

        build-worker.py copies the source's own BUILD line into the build, so
        the two lines agreeing is the same question as "was this built from
        that", and it needs no rebuild to ask."""
        stamp_line = lambda t: (re.search(r"^const BUILD = '[^']*';", t, re.M) or [''])[0] \
            if re.search(r"^const BUILD = '[^']*';", t, re.M) else ''
        srcf = os.path.join(PARTYPLAY_BACK, 'worker', 'SOURCE-do-not-paste-partyplay-api.js')
        if os.path.isfile(srcf):
            want = re.search(r"^const BUILD = '([^']*)';", io.open(srcf, encoding='utf-8').read(), re.M)
            got = re.search(r"^const BUILD = '([^']*)';", src, re.M)
            ok('the build is this source, not an older one',
               bool(want and got) and want.group(1) == got.group(1),
               got.group(1) if got else 'no stamp in the build',
               why='the source says %s and the build says %s. Run '
                   'partyplay-backend/tools/build-worker.py.'
                   % (want.group(1) if want else '?', got.group(1) if got else '?'))
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


def shared_scripts_live(base, folder):
    """EVERY shared script a page loads must come back as JavaScript.

    Cloudflare Pages answers a path it does not have with the HOMEPAGE and a 200,
    so a script that failed to deploy does not 404: the browser fetches 107 KB of
    HTML, fails to parse it, and the global it was supposed to define is simply
    not there. Nothing throws until the first call. On 2 Sep vp-qr.js came back
    exactly like that while it was mid-deploy, and the only symptom would have
    been no QR code on the venue's television.

    The list is derived from the folder rather than written down, because the
    hand-kept table above is where vp-qr.js, vp-feedback.js and vp-celebrate.js
    were all missing: a list of the files is a second copy of the files, and it
    goes stale the moment somebody adds one."""
    head('Shared scripts: served as JavaScript, not the homepage in disguise')
    names = sorted(f for f in os.listdir(folder)
                   if f.endswith('.js') and not f.endswith('.test.js'))
    for f in names:
        local = io.open(os.path.join(folder, f), encoding='utf-8').read()
        m = re.search(r'root\.(VP[A-Za-z]+)\s*=', local)
        status, body, _ = get(base + '/app/' + f)
        looks_html = '<html' in body[:2000].lower() or '<!doctype' in body[:200].lower()
        why = ''
        good = status == 200 and not looks_html
        if looks_html:
            why = 'the homepage came back, so this script is not deployed'
        elif status != 200:
            why = 'HTTP %s' % status
        elif m and m.group(1) not in body:
            good, why = False, 'served, but does not define %s' % m.group(1)
        ok(f, good, '%s' % (('defines ' + m.group(1)) if (good and m) else ''), why=why)


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
    """HTTP 200 PROVES NOTHING ON THESE SITES.

    Cloudflare Pages serves the homepage, with a 200, for any path it does not
    have. /does-not-exist-probe returns the same 20 KB of index.html a real typo
    would. So this check, which asked for a 200 and a body over 300 bytes, would
    have passed a page that was never deployed at all - which is the only thing
    it was here to catch.

    The fallback is recognisable, though: it IS the homepage. So fetch the
    homepage once, and a page that comes back identical to it did not deploy.
    index.html is excused, being the homepage on purpose."""
    def same_page(x, y):
        """Two responses of the SAME page are not byte-identical: Cloudflare
        re-encodes every obfuscated email address with a fresh key on each
        response, so the homepage differs from itself in about 115 characters.
        Normalise those away and the comparison means what it says."""
        n = lambda t: re.sub(r'email-protection#[0-9a-f]+', 'email-protection',
                     re.sub(r'data-cfemail="[0-9a-f]+"', '', t or ''))
        return bool(x) and bool(y) and n(x) == n(y)

    _, home, _ = get(base + '/')
    home_len = len(home or '')
    for rel in sorted(pages):
        url = base + '/' + rel
        status, body, _ = get(url)
        if status != 200 or len(body) < 300:
            bad.append('%s (HTTP %s)' % (rel, status))
        elif rel != 'index.html' and same_page(body, home):
            bad.append('%s (the homepage came back, so this page is not deployed)' % rel)
    ok('all %d page(s) serve, and none of them is the homepage in disguise' % len(pages),
       not bad, '%d KB homepage to compare against' % (home_len // 1024),
       why='not served: ' + ', '.join(bad[:5]))


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
                      os.path.join(PARTYPLAY_SITE, 'lib', 'pp-config.js')):
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


def each_worker_is_the_right_worker():
    """IS THE THING AT THIS URL THE WORKER THAT BELONGS HERE?

    A Worker is deployed by pasting a file into a browser, and there are three of
    them. On 31 Aug the game Worker went into the billing Worker's slot. Checkout
    answered 404, every founding page lost its price check, the account page and
    the add-card links died, and what this tool said was "billing health HTTP 503",
    which is true and tells you nothing about why.

    Each Worker already says its own name in /health. Ask it. A Worker that is
    healthy but is the WRONG ONE is the failure that reads as something else."""
    head('Each Worker is the one that belongs at its URL')
    for label, url, want in (('billing', VP_API, 'venueplay-api'),
                             ('game', VP_GAME, 'venueplay-game')):
        status, body, _ = get(url + '/health')
        try:
            got = (json.loads(body) or {}).get('worker')
        except Exception:
            got = None
        ok('the %s URL is answering as %s' % (label, want), got == want,
           got or 'no name in the reply',
           why='it is answering as "%s". The wrong file was pasted into this Worker: '
               'billing takes venueplay-api-FULL.js, game takes venueplay-game.js.' % got)


def venue_codes_are_unique():
    """ONE CODE, ONE VENUE.

    A venue's join code is a hash of its slug, so two venues can land on the same
    six characters, and the Worker's lookup used to keep whichever it read last:
    every phone typing that code would have joined the wrong pub's game, and any
    marketing opt-in behind it would have been written to the wrong venue's list.
    The Worker now refuses an ambiguous code for both venues and counts the clashes.

    This asks it. The count must be zero, and it matters before it is a problem,
    because these codes go on printed signage."""
    head('Every venue has a code of its own')
    status, body, _ = get(VP_GAME + '/health')
    try:
        d = json.loads(body)
    except Exception:
        d = {}
    if 'venue_code_clashes' not in d:
        note('venue code clashes', 'the deployed game Worker predates this check')
        return
    n = d.get('venue_code_clashes')
    ok('no two venues share a join code', n == 0,
       '%s venue(s) clash' % n if n else 'checked against every venue',
       why=str(d.get('venue_code_clash_detail'))[:160] +
           '. Re-slug one of them, and do not print signage for either until it is fixed.')


def founding_windows_are_open():
    """THE PAGE PROMISES A PRICE. THE WORKER DECIDES ONE. Do they agree?

    A state page is static HTML with a founding code baked into it. The Worker
    grants the founding rate only if that code is in its FOUNDING_CODES
    environment variable. Nothing has ever compared the two, and when they
    disagree the venue reads $2.50 on the page, is charged $3.00 at the card,
    and there is nothing on screen to explain it. The Worker's own comments
    describe that happening on /qld and /vic.

    /founding?code= is public and answers yes or no, so this can ask for every
    page in the repo. A window Dean has deliberately retired should have had its
    page taken down or its code rolled to the new month, so a "no" here is worth
    a look either way.
    """
    head('Every founding page can still get the price it promises')
    root = os.path.join(ROOT, 'venueplay')
    pages = [f for f in sorted(os.listdir(root))
             if f in ('nsw.html','qld.html','vic.html','sa.html','wa.html',
                      'nt.html','tas.html','act.html')] if os.path.isdir(root) else []
    if not pages:
        return
    shut = []
    for b in pages:
        src = io.open(os.path.join(root, b), encoding='utf-8').read()
        codes = sorted(set(re.findall(r'[A-Z]{2,3}-[A-Z]{3}-20\d\d', src)))
        if not codes:
            continue
        code = codes[0]
        status, body, _ = get(VP_API + '/founding?code=' + code)
        try:
            open_ = json.loads(body).get('open') is True
        except Exception:
            open_ = False
        if not open_:
            shut.append('%s (%s)' % (b, code))
    ok('all %d founding page(s) have a live code' % len(pages), not shut,
       why='the Worker will charge STANDARD on: ' + ', '.join(shut[:4]) +
           '. Either add the code to FOUNDING_CODES or take the page down.')


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

  And the six that a musical bingo night found on 31 Aug, none of which any
  tool here can see. Check them EVERY time a game is touched:

    8.  ONE code on the wall, and it is the one the console shows.
    9.  Join, refresh, and join again from the table link: the player count
        goes up by ONE, not by three. This is billed per head.
   10.  Album art stays up while a song plays, including when somebody joins.
   11.  The card does not flash when a song is played.
   12.  Open a lobby right after ending a game and leave it: it stays a lobby
        and does not drop to the ads.
   13.  Turn the room volume up past 100% and confirm the TV gets louder than
        the device on its own can go, without distorting.

  If the release only touched copy, a document or an email template, the list
  above can be skipped. If it touched a game, it cannot.""")

    print('%sTHE RELEASE, IN ORDER%s' % (YEL, OFF))
    print("""  Every one of these exists because skipping it cost something real.

    1. Run this tool BEFORE the push. A red gate is cheaper than a red venue.
    2. Push. The site deploys itself from main; Workers and SQL do not.
    3. Run any new migration FIRST, then paste the Worker that needs it.
       A Worker writing to a table that is not there fails silently.
    4. Paste each Worker into the Worker whose NAME matches the file. On
       31 Aug the game Worker went into the billing slot: checkout answered
       404 and nobody could sign up until it was noticed.
    5. RUN THIS TOOL AGAIN, AFTER. This is the step that gets skipped and it
       is the one that catches a bad paste. It asks each Worker its own name
       and compares its build stamp to the repo, so a file that went to the
       wrong URL, or a paste that did not land, is named in one line.
    6. If the release touched a game, do the live list above. No tool here
       can open a browser or hear a pub.

  Nothing is deployed until step 5 says so. "I pasted it" is not evidence;
  /health answering with the right build is.""")
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
            shared_scripts_live(VP, os.path.join(ROOT, 'venueplay', 'app'))
            every_page_is_reachable('VenuePlay', VP, 'venueplay',
                                    skip=('test.html',))
            worker_health('VenuePlay game', VP_GAME)
            worker_health('VenuePlay billing', VP_API)
            cors_checks('VenuePlay', VP_GAME, '/play/live',
                        ['https://venueplay.com.au', 'https://www.venueplay.com.au'])
            each_worker_is_the_right_worker()
            venue_codes_are_unique()
            founding_windows_are_open()
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
