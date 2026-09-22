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
import ast
import importlib.util
import hashlib
import atexit, io, json, os, re, shutil, subprocess, sys, tempfile, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


_SCANNER_ERROR = None


def _load_scanner():
    """check-defs.py owns the comment scanner. Import it rather than keeping a
    second copy that will drift, which is exactly how four screen routers ended
    up disagreeing with each other."""
    import importlib.util
    # WAS ~/partyplay/check-defs.py: a copy outside this repo entirely, and a
    # different one again from the two inside it. Three versions of the scanner
    # existed on 7 Sep and the gate used whichever the lookup reached first. The
    # backend copy is the one that ships nowhere and is therefore the only one
    # safe to depend on.
    p = os.path.join(ROOT, 'partyplay-backend', 'check-defs.py')
    if not os.path.isfile(p):
        p = os.path.join(os.path.expanduser('~/partyplay'), 'check-defs.py')
    if not os.path.isfile(p):
        return None
    spec = importlib.util.spec_from_file_location('_cd', p)
    mod = importlib.util.module_from_spec(spec)
    argv, out = sys.argv[:], sys.stdout
    sys.argv = ['check-defs.py', '--no-targets-on-purpose']
    sys.stdout = io.StringIO()          # it prints its own summary on import
    # A BROKEN SCANNER MUST NOT TAKE THE WHOLE GATE WITH IT. Breaking this file
    # on purpose on 7 Sep did not produce a failed check: it produced a
    # traceback, exit 1, and not one of the other 65 checks ran. The push was
    # correctly refused, so nothing unsafe got through, but the operator learns
    # nothing about the release they are trying to make and has no way to tell a
    # broken tool from a broken change. Catch it, hand back nothing, and let the
    # caller report it as the one failure it is.
    global _SCANNER_ERROR
    try:
        spec.loader.exec_module(mod)
    except SystemExit:
        pass
    except Exception as e:
        _SCANNER_ERROR = '%s: %s' % (type(e).__name__, str(e)[:120])
        return None
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


def get(url, timeout=20, headers=None):
    """Body and status, following redirects. Never trust the status alone.

    headers was missing until 5 Sep, and the RLS check below built an apikey
    header and handed it to a function that had nowhere to put it. Every request
    went out unauthenticated, came back 401, and the check read that as "no rows
    leaked". Seven tables were reported safe by a probe that never asked."""
    h = {'User-Agent': BROWSER_UA}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
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

def unexport(src):
    """A Worker is an ES module and jsc -e / new Function are not. `export default`
    has always been rewritten here; the room server (9 Sep) adds `export class
    VenueRoom` (Cloudflare needs the Durable Object class exported by name) and a
    named export list. All three become plain script; nothing else changes."""
    src = re.sub(r'^export default', 'var _d =', src, flags=re.M)
    src = re.sub(r'^export\s+(?=(async\s+)?(class|function|const|let|var)\b)', '', src, flags=re.M)
    src = re.sub(r'^export\s*\{[^}]*\}\s*;?', '', src, flags=re.M)
    return src

def js_blocks(path):
    """Only the things a browser will actually run as script.

    <script type="application/ld+json"> is search-engine data, not code, and
    parsing it as JavaScript reports a syntax error on a perfectly good page.
    """
    src = io.open(path, encoding='utf-8').read()
    if path.endswith('.js'):
        # `export default` is valid in a Worker module and not in new Function.
        return [unexport(src)]
    out = []
    for tag, body in re.findall(r'(<script(?![^>]*\bsrc=)[^>]*>)(.*?)</script>', src, re.S):
        t = re.search(r'type\s*=\s*["\']([^"\']+)', tag)
        if t and not re.match(r'(text/javascript|module|application/javascript)$', t.group(1).strip()):
            continue                      # json-ld, templates, anything not code
        out.append(body)
    return out


# A PRIVATE SCRATCH FILE PER RUN, NOT A FIXED NAME IN /tmp.
#
# This handed JavaScript to jsc through /tmp/_rc.js, a fixed path, and every
# script in the repo went through the same one. Two of these running at once
# overwrite each other between the write and the read: run A writes vic.html's
# script, run B replaces it with wa.html's, and run A reports a syntax error
# against vic.html quoting code that is not in it. That is exactly what it did on
# 10 Sep 2026, naming four innocent state pages and blaming a fragment reading
# "Cloudflare", while the same files parsed perfectly on the next run.
#
# Two runs at once is not exotic. prove-checks.py RUNS this tool, over and over,
# and the release notes tell you to run prove-checks before a release that
# matters, so anybody doing that alongside the gate gets nonsense.
#
# AND THE FAILURE IS NOT ALWAYS NOISY, WHICH IS THE REAL PROBLEM. Reverse the
# order and run A writes a BROKEN script, run B overwrites it with a valid one,
# and run A reads the valid one and says OK. A gate that can pass code that does
# not parse is the one thing this whole tool exists to prevent.
_SCRATCH = tempfile.mkdtemp(prefix='release-check-')
atexit.register(lambda: shutil.rmtree(_SCRATCH, ignore_errors=True))


def parses(js):
    f = os.path.join(_SCRATCH, 'parse.js')
    io.open(f, 'w', encoding='utf-8').write(js)
    r = subprocess.run([JSC, '-e',
        'try{ new Function(readFile(%s)); print("OK"); }catch(e){ print("ERR "+e); }' % json.dumps(f)],
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

    """AND EVERY FILE SCANNED MUST BE ONE THIS REPO ACTUALLY SHIPS.

    On 7 Sep the gate reported a missing database column and a Worker calling
    eleven functions it never defines. Both were real readings of real files,
    and both were meaningless: venueplay/worker/ held three UNTRACKED leftovers
    from the 18 Aug move to venueplay-backend/. Nothing deploys them, git does
    not know them, and they had drifted a month behind the Workers that do ship.
    The gate spent two of its three failures describing dead code, which is the
    same fault as a test pointed at the wrong checkout: it cannot be right, and
    it hides whatever is actually wrong.

    A file git is not tracking is not a release artefact. Skip it, and SAY SO,
    because a silent skip is how the count stops meaning anything."""
    untracked, asked_git = [], False
    try:
        r = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard'],
                           capture_output=True, text=True, cwd=ROOT)
        asked_git = r.returncode == 0
        if asked_git:
            loose = {os.path.join(ROOT, l.strip()) for l in r.stdout.splitlines() if l.strip()}
            untracked = sorted(f for f in files if os.path.abspath(f) in loose)
            files = [f for f in files if os.path.abspath(f) not in loose]
    except Exception:
        pass
    if not asked_git:
        # NOT A PASS. prove-checks copies the repo without .git, so git cannot
        # answer there and this check has no way to fail. Saying "ok" would be
        # the exact thing this gate exists to stop: a green line for a question
        # nobody asked.
        note('every file checked is one git tracks',
             'SKIPPED, not a git checkout: %d file(s) scanned unfiltered' % len(files))
    else:
        ok('every file checked is one git tracks', not untracked,
           '%d file(s) scanned' % len(files),
           why='not tracked, so not shipped: ' + ', '.join(short(f) for f in untracked[:4]))

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
        src = unexport(src)
        lf = os.path.join(_SCRATCH, 'load.js')          # per run, see the note on parses()
        io.open(lf, 'w', encoding='utf-8').write(src)
        r = subprocess.run([JSC, '-e',
            'try{ (new Function(readFile(%s)))(); print("OK"); }'
            'catch(e){ print("ERR "+e); }' % json.dumps(lf)], capture_output=True, text=True)
        if 'OK' not in r.stdout:
            worker_bad.append('%s: %s' % (b, r.stdout.strip()[:90]))
    ok('every Worker actually loads, not just parses', not worker_bad,
       why='; '.join(worker_bad[:2]))

    head('A. Every tool parses too, not just the site')
    """THE GATE PARSED THE SITE AND THE WORKERS AND NOTHING ELSE.

    tools/song-popularity.py had been in the repo since 10 Sep 2026 with an
    apostrophe inside a single-quoted string:

        'what_this_is_not': 'Suitability, which is Dean's judgement ...'

    It is a SyntaxError on the first line of the file that Python reads, so the
    tool had never once run since that line was written, and nothing said so. The
    checks in this repo are mostly Python; a checker that cannot start is a check
    that cannot fail, and it reports nothing at all rather than red.

    ast.parse only, no import: importing runs module-level code, and several of
    these tools hit Stripe or Supabase the moment they load."""
    pyfiles, broken = [], []
    for d, dirs, fs in os.walk(ROOT):
        dirs[:] = [x for x in dirs
                   if x not in ('.git', 'node_modules', '__pycache__', '.claude')]
        for f in sorted(fs):
            if not f.endswith('.py'):
                continue
            full = os.path.join(d, f)
            pyfiles.append(full)
            try:
                ast.parse(io.open(full, encoding='utf-8', errors='replace').read())
            except SyntaxError as e:
                broken.append('%s line %s' % (short(full), e.lineno))
    ok('every .py in the repo parses', bool(pyfiles) and not broken,
       '%d tool(s) checked' % len(pyfiles),
       why=('nothing was read at all' if not pyfiles else
            'these cannot run: ' + '; '.join(broken[:4])))

    head('B. Nothing calls a function that does not exist')
    # partyplay/ is the directory Pages deploys, so a tool kept there is served
    # to the public: check-defs.py was downloadable from partyplay.com.au on
    # 7 Sep. Run the backend copy, which ships nowhere.
    checker = os.path.join(ROOT, 'partyplay-backend', 'check-defs.py')
    if not os.path.isfile(checker):
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
                _SUITES_RUN.add(os.path.abspath(os.path.join(d, f)))
                ok(f, suite_passed(last), last)
    """A .test.py under tools/ runs the same way a .test.js does. redirect-verdict.test.py is
    the first: it drives redirect_verdict with the answers a broken edge rule would give, which
    a live probe can never produce while the rule is working."""
    for f in sorted(os.listdir(os.path.join(ROOT, 'tools'))):
        if not f.endswith('.test.py'):
            continue
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', f)],
                           capture_output=True, text=True, cwd=ROOT)
        last = (r.stdout.strip().splitlines() or [''])[-1]
        _SUITES_RUN.add(os.path.abspath(os.path.join(ROOT, 'tools', f)))
        ok(f, r.returncode == 0 and suite_passed(last), last)

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

    # WHICH SUITES THIS GATE ACTUALLY RAN. Recorded as they run, never re-derived,
    # because a second list of the suites is a second thing to keep in step.
    # every_suite_is_run() below reads this.
    """VenuePlay's own suites, wherever they sit.

    one-game.test.js used to be named here on its own, so the musical draw suite
    written after the live night would have sat in the repo passing nothing. Sweep
    the game folders instead: a suite that is added is a suite that runs.

    They are run from ROOT because each one reads the page or the library it is
    about, rather than a copy of it, and resolves those paths from here."""
    vp_suites = []
    # EVERY .test.js under venueplay/ and venueplay-backend/, not two named folders.
    # This swept venueplay/app and venueplay-backend/worker only, so a suite written
    # beside the page it tests ran nowhere: on 10 Sep 2026 a new suite for
    # venueplay/signage.html sat at venueplay/ level and was silently never run. A
    # test that does not run is the same as no test, except that nobody knows.
    # touring-backend joined this on 18 Sep 2026. Its suite passed 36 of 36 and had never
    # been run by anything, because the sweep named two folders and it is in a third. It
    # also prints "36 of 36 checks passed" rather than "ALL n CHECKS PASSED", so even once
    # swept it would have read as a failure until suite_passed learned both shapes.
    for base in (os.path.join(ROOT, 'venueplay'),
                 os.path.join(ROOT, 'venueplay-backend'),
                 os.path.join(ROOT, 'touring-backend')):
        for d, _, fs in os.walk(base):
            if os.sep + 'node_modules' in d or os.sep + '.git' in d:
                continue
            for f in sorted(fs):
                if f.endswith('.test.js'):
                    vp_suites.append(os.path.join(d, f))
    vp_suites = sorted(set(vp_suites))
    for t in vp_suites:
        r = subprocess.run([JSC, t], capture_output=True, text=True, cwd=ROOT)
        out = (r.stdout + r.stderr).strip().splitlines()
        line = out[-1] if out else ''
        _SUITES_RUN.add(os.path.abspath(t))
        ok(os.path.basename(t), suite_passed(line), line)

    every_suite_is_run()
    every_page_loads_what_it_calls()

    head('C. Nothing internal sits in a directory the world can download')
    """A DEPLOY DIRECTORY IS A PUBLIC DIRECTORY. Everything under venueplay/ and
    partyplay/ is uploaded to Cloudflare Pages and served to anyone who asks for
    it by name, whether or not a page links to it.

    check-exposure.py has been saying so for days, but it asks the LIVE site, so
    it can only speak after the push, and the pre-push gate does not run it. On
    11 Sep 2026 it found twenty-seven: twenty-four .test.js suites under
    venueplay/app/ served from venueplay.com.au, partyplay/check-defs.py (already
    copied to the backend a week earlier and never deleted from the deploy
    directory), and partyplay/lib/pp-trivia-pack.test.js, which printed the path
    /Users/dean.tindale to the world.

    None of them could break a venue's night, which is exactly why they sat there:
    nothing that fails loudly was failing. So this asks the question BEFORE the
    push instead, off the same rule check-exposure uses, imported rather than
    copied so the two definitions cannot drift apart.

    It walks the directory on disk rather than asking git what is tracked, for two
    reasons. prove-checks.py copies the repo WITHOUT .git, so a git-based version
    of this check would have found nothing tracked there, reported "0 files" and
    gone green in the one harness whose whole job is to prove it can go red. And
    an untracked script sitting in the deploy directory is one `git add .` from
    being served anyway: on 11 Sep there were eighteen old migrations and a
    grant-admin-access.py in there, none of them tracked, all of them one command
    from the public. They now live in venueplay-backend/tools/.

    The root .gitignore refuses to stage a .py, .sql, .sh or .test.js under either
    deploy directory, so this check and git say no to the same thing."""
    never = None
    try:
        _spec = importlib.util.spec_from_file_location(
            '_exposure', os.path.join(ROOT, 'tools', 'check-exposure.py'))
        _mod = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_mod)
        never = _mod.NEVER
    except Exception as e:
        ok('the rule for what must never ship could be read', False,
           why='check-exposure.py would not import: %s' % e)
    if never is not None:
        # The rule has to be able to say no. If this probe stops working the rule has
        # been widened into one that flags nothing, and every tick below is empty.
        probe = (bool(never.search('app/x.test.js')) and bool(never.search('tools/a.py'))
                 and not never.search('app/index.html'))
        ok('the rule can tell an internal file from a page', probe,
           'probe verified' if probe else 'THE RULE FLAGS NOTHING')
        for site in (['venueplay'] if which in ('both', 'venueplay') else []) + \
                    (['partyplay'] if which in ('both', 'partyplay') else []):
            base = os.path.join(ROOT, site)
            walked, bad = 0, []
            for d, dirs, fs in os.walk(base):
                dirs[:] = [x for x in dirs if x not in ('node_modules', '__pycache__')]
                for f in fs:
                    walked += 1
                    rel = os.path.relpath(os.path.join(d, f), ROOT)
                    if never.search(rel):
                        bad.append(rel)
            # walked == 0 means the directory moved and this check read nothing at
            # all, which must never be reported as a pass. Rule 3 of this tool.
            ok('%s/ holds nothing internal' % site, probe and walked > 0 and not bad,
               '%d file(s) walked' % walked,
               why=(('the directory is empty or gone' if not walked else
                     'anyone can download these: ' + ', '.join(sorted(bad)[:6])
                     + ('' if len(bad) <= 6 else ' and %d more' % (len(bad) - 6)))))

    head('D. No test reads code from outside the repo')
    """A TEST POINTED AT THE WRONG FILE CANNOT FAIL, and it is worse than no test,
    because the green line says it did the job.

    This has now happened twice. vp-follow.test.js read from /tmp/vp-work, a
    scratch directory that no longer existed. partyplay-api.test.js read the
    Worker from /Users/dean.tindale/partyplay, a copy of the project that stopped
    being the one we ship: on 3 Sep it was 6.5 KB and 148 lines behind, and the
    suite reported ALL 63 CHECKS PASSED against a Worker nobody deploys.

    Both were only found by reading the test, never by running it. So: no suite
    may name an absolute path outside this repo. A path inside it is allowed,
    since that is still the code we ship."""
    strays = []
    for d, _, fs in os.walk(ROOT):
        if '/.git' in d or 'node_modules' in d:
            continue
        for f in fs:
            if not f.endswith('.test.js'):
                continue
            full = os.path.join(d, f)
            src = io.open(full, encoding='utf-8', errors='replace').read()
            for m in re.finditer(r'["\'](/(?:Users|tmp|var|private)/[^"\']{4,})["\']', src):
                path = m.group(1)
                if path.startswith(ROOT + os.sep) or path == ROOT:
                    continue
                strays.append('%s -> %s' % (short(full), path))
    ok('every test reads the code this repo ships', not strays,
       why='; '.join(strays[:3]))

    head('D. One answer per question, everywhere it is asked')
    """THE SAME FUNCTION, COPIED INTO TWENTY FILES, DRIFTS.

    Dean, 31 Aug, on a rule fixed in one place a month earlier: "I asked you to
    fix this a month ago and you only fixed it in one place." This is the check
    for that, on the handful of functions where a difference is dangerous rather
    than merely untidy.

    esc() is what stands between text a venue typed and the screen, and it was
    ELEVEN DIFFERENT FUNCTIONS across 23 files. Fifteen of them left quotes
    alone.

    CORRECTION, same day: the first pass here reported no attribute
    interpolations in those files. That was wrong, and wrong because the
    detector was: its pattern could not cross the JavaScript string quote that
    always sits between an attribute quote and the value, so
    data-title="'+esc(s.title)+'" did not match. There were four such sites, in
    musical/host.html and billing.html. None was exploitable, but for a weaker
    reason than "there are none": every one carried an id or a song title of
    ours, never text a venue or a player typed. Venue names went into element
    text, not attributes. One new attribute in either file would have changed
    that with nothing to notice it.

    cryptoInt() is the unbiased draw behind every raffle and members draw, in 11
    files. One copy quietly losing its rejection loop is a biased draw, and that
    is a licence matter, not a bug.

    tvSend() is called from repaint paths and ch.send throws once the socket is
    gone. tv.html caught that; the other three screens did not, so the same dead
    socket left bingo's wall alone and blacked out musical, trivia and raffle.

    NOT drawQR: signage prints a wider quiet zone on purpose, and see-a-night
    draws a fake one for the marketing page. Different jobs, same name."""
    # tvStatus joined the list on 16 Sep 2026. It is the same twelve lines in all five
    # screens, and the reason it has to stay that way is that the fault it fixes was
    # exactly this: five screens each deciding for themselves when to show the
    # Reconnecting pill, and all five getting it wrong in two different directions.
    SAME = ['esc', 'cryptoInt', 'tvSend', 'tvStatus']
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

    """HOW LONG AN UNSTARTED PARTYPLAY CODE KEEPS, written once.

    lib/pp-licence.js owns UNUSED_EXPIRY_DAYS and expires codes by it. The Worker
    wrote "365 * 86400e3" twice by hand instead, in the nudge that chases unused
    codes and in the admin figures. Change the library to 180 and the code would
    have died at 180 while the Worker still chased at 365: the warning email fires
    six months after the thing it warns about, and the people owed a warning get
    none. Nothing would have gone red. Found 12 Sep 2026.

    The number is only allowed to appear in the library. Anywhere else has to ask."""
    lib_p = os.path.join(PARTYPLAY_BACK, 'lib', 'pp-licence.js')
    wsrc_p2 = os.path.join(PARTYPLAY_BACK, 'worker', 'SOURCE-do-not-paste-partyplay-api.js')
    if os.path.isfile(lib_p) and os.path.isfile(wsrc_p2):
        lib = io.open(lib_p, encoding='utf-8').read()
        m = re.search(r'var\s+UNUSED_EXPIRY_DAYS\s*=\s*(\d+)', lib)
        ok('the unused-code expiry is declared in the licence library',
           bool(m), m.group(1) + ' days' if m else 'UNUSED_EXPIRY_DAYS is not in pp-licence.js',
           why='nothing owns the number, so every copy of it is a guess')
        if m:
            days = m.group(1)
            w = io.open(wsrc_p2, encoding='utf-8').read()
            w = re.sub(r'/\*.*?\*/', '', w, flags=re.S)      # a comment may say 365
            w = re.sub(r'//[^\n]*', '', w)
            hard = re.findall(r'(?<![\d.])' + days + r'\s*\*\s*86400', w)
            ok('the Worker asks the library for it rather than writing it again',
               not hard, '%d hardcoded copy(ies)' % len(hard),
               why='the Worker would keep chasing at %s days after the library changed' % days)
            ok('and the Worker can actually reach the constant',
               'PPLicence.UNUSED_EXPIRY_DAYS' in w,
               'PPLicence.UNUSED_EXPIRY_DAYS' if 'PPLicence.UNUSED_EXPIRY_DAYS' in w else 'never asked for',
               why='a check that only forbids the literal passes a Worker that lost the rule entirely')

    """THE FIFTY PLAYER CAP: ENFORCED ONCE, PROMISED ONCE, AND THEY HAVE TO AGREE.

    The cap is a DATABASE TRIGGER. terms.html states it as a contractual promise. The licence
    library exports it. The Worker turns the trigger's error into words a guest can read. Four
    places, one number, and nothing tied them together.

    The sharp end was the Worker, which matched the trigger's message with /50 players/i. Raise
    the cap and the trigger says "capped at 60 players", that stops matching, and a guest gets a
    raw constraint error at the exact moment the party fills up. It now matches "capped at" and
    prints PPLicence.PLAYER_CAP.

    What is left is the promise. If the trigger and terms.html disagree, one of them is a lie to
    a customer, so this reads all three and requires the same number. Found 12 Sep 2026."""
    sql_p = os.path.join(PARTYPLAY_BACK, 'supabase', 'partyplay-01-core.sql')
    lib_p2 = os.path.join(PARTYPLAY_BACK, 'lib', 'pp-licence.js')
    terms_p = os.path.join(PARTYPLAY_SITE, 'terms.html')
    if all(os.path.isfile(x) for x in (sql_p, lib_p2, terms_p)):
        sql = io.open(sql_p, encoding='utf-8').read()
        m_sql = re.search(r"capped at (\d+) players", sql)
        m_lib = re.search(r"PLAYER_CAP:\s*(\d+)", io.open(lib_p2, encoding='utf-8').read())
        m_trm = re.search(r"capped at\s*<strong>\s*(\d+) players", io.open(terms_p, encoding='utf-8').read())
        ok('the player cap is enforced by a database trigger',
           bool(m_sql), (m_sql.group(1) + ' players') if m_sql else 'no cap found in partyplay-01-core.sql',
           why='without the trigger nothing stops a 200 person party on a 50 player licence')
        ok('and the licence library states the same number',
           bool(m_sql and m_lib and m_sql.group(1) == m_lib.group(1)),
           'trigger %s, library %s' % (m_sql and m_sql.group(1), m_lib and m_lib.group(1)))
        ok('and the Terms promise the same number',
           bool(m_sql and m_trm and m_sql.group(1) == m_trm.group(1)),
           'trigger %s, terms %s' % (m_sql and m_sql.group(1), m_trm and m_trm.group(1)),
           why='a cap in the Terms that is not the cap enforced is a promise we are not keeping')
        wsrc3 = io.open(os.path.join(PARTYPLAY_BACK, 'worker',
                                     'SOURCE-do-not-paste-partyplay-api.js'), encoding='utf-8').read()
        # STRIP THE COMMENTS FIRST. The note beside the fix QUOTES the old pattern to explain
        # what was wrong with it, so the first version of this check failed on the very code
        # that fixed it. Third time in one day a comment tripped one of my own scans, which is
        # why the repo's other detectors all strip first.
        wcode3 = re.sub(r'/\*.*?\*/', '', wsrc3, flags=re.S)
        wcode3 = re.sub(r'(^|[^:])//[^\n]*', r'\1', wcode3)
        ok('the "party is full" message is not matched on the NUMBER',
           '/50 players/i' not in wcode3 and re.search(r"/capped at/i", wcode3) is not None,
           why='matching the figure means raising the cap hands a guest a raw constraint error')

    """HOW MANY ADVERTISING IMAGES A VENUE MAY HAVE, WRITTEN TWICE.

    The Worker trims the list to its cap and saves without complaint, and billing.html decides
    for itself when to stop offering "Add slide". Until 17 Sep 2026 both said 12, separately,
    so raising one would have let a venue add slides the Worker quietly threw away and the
    television would never play. Nothing would have looked broken: the page says Saved, the
    slide is on screen until you reload, and then it is gone.

    Same shape as the fifty player cap above and the album keep window below. One number, two
    files, nothing tying them together. Raised to 20 on Dean's word the same day."""
    wbill_p = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')
    bill_p = os.path.join(ROOT, 'venueplay', 'app', 'billing.html')
    if os.path.isfile(wbill_p) and os.path.isfile(bill_p):
        wb = io.open(wbill_p, encoding='utf-8').read()
        bp = io.open(bill_p, encoding='utf-8').read()
        # Strip comments first: the note beside each one names the other one's number.
        wbc = re.sub(r'/\*.*?\*/', ' ', wb, flags=re.S)
        bpc = re.sub(r'/\*.*?\*/', ' ', bp, flags=re.S)
        bpc = re.sub(r'(^|[^:])//[^\n]*', r'\1', bpc)
        m_w = re.search(r'VPB_MAX_SLIDES\s*=\s*(\d+)', wbc)
        m_b = re.search(r'VP_MAX_SLIDES\s*=\s*(\d+)', bpc)
        ok('the advertising image cap is a named number in the Worker', bool(m_w),
           (m_w.group(1) + ' images') if m_w else 'VPB_MAX_SLIDES is gone',
           why='a bare 12 in a slice() is a number nobody can find when it needs changing')
        ok('and the billing page offers exactly that many',
           bool(m_w and m_b and m_w.group(1) == m_b.group(1)),
           'Worker %s, page %s' % (m_w and m_w.group(1), m_b and m_b.group(1)),
           why='the page would let a venue add slides the Worker throws away, and the '
               'television would never play them')
        # THE BIGGEST IMAGE THE WORKER TAKES, AND WHAT THE PAGE SENDS.
        #
        # The page gated on 8MB and the Worker refused over 5MB. Most images are shrunk on
        # the way, which is why the page was generous, but resizeAdImage passes an animated
        # GIF through UNTOUCHED, and also returns the original when the shrink fails or comes
        # out bigger. So a 7MB GIF was uploaded in full over pub wifi and refused at the far
        # end, quoting a smaller number than the page had just quoted. Found 18 Sep 2026.
        m_wi = re.search(r'VPB_MAX_IMAGE_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024', wbc)
        m_bi = re.search(r'VP_MAX_IMAGE_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024', bpc)
        ok('the image size limit is a named number in the Worker', bool(m_wi),
           (m_wi.group(1) + 'MB') if m_wi else 'VPB_MAX_IMAGE_BYTES is gone',
           why='it was written three times: this check, the bucket file_size_limit, and the '
               'page, and the page had a different number')
        ok('and the billing page knows the same limit',
           bool(m_wi and m_bi and m_wi.group(1) == m_bi.group(1)),
           'Worker %sMB, page %sMB' % (m_wi and m_wi.group(1), m_bi and m_bi.group(1)))
        ok('and the page checks what it is about to SEND, not what was picked',
           re.search(r'dataUrlBytes\(\s*data\s*\)\s*>\s*VP_MAX_IMAGE_BYTES', bpc) is not None,
           why='an animated GIF is never shrunk, so gating on the picked file lets a bigger '
               'one through and the venue finds out after the upload')

        # AND THE WORKER MUST SAY NO, not trim in silence.
        ok('a venue over the cap is told, not quietly trimmed',
           re.search(r'b\.slides\.length\s*>\s*VPB_MAX_SLIDES', wbc) is not None,
           why='slicing to the cap and answering Saved loses images with nothing on screen '
               'to say which ones went')

    """WHAT THE PRIVACY PAGE PROMISES ABOUT A FINISHED PARTY, SOMETHING HAS TO DO.

    privacy.html makes three promises, not one: the album goes 30 days after the party, the
    nickname goes when the album does, and guest emails go with everything else. Only the
    first was kept. pp_players and pp_album_requests both hold guest EMAIL ADDRESSES and
    nothing had ever deleted either, so a party from a year ago still had its guests'
    addresses in the database while the page said otherwise. 114 passing checks did not
    notice, because they all tested the photos.

    This is the same shape as the fifty player cap: a promise in a customer-facing document
    and an enforcement somewhere else, with nothing tying them together. Found 12 Sep 2026."""
    priv_p = os.path.join(PARTYPLAY_SITE, 'privacy.html')
    wsrc4_p = os.path.join(PARTYPLAY_BACK, 'worker', 'SOURCE-do-not-paste-partyplay-api.js')
    if os.path.isfile(priv_p) and os.path.isfile(wsrc4_p):
        priv = io.open(priv_p, encoding='utf-8').read()
        w4 = io.open(wsrc4_p, encoding='utf-8').read()
        w4c = re.sub(r'/\*.*?\*/', '', w4, flags=re.S)
        w4c = re.sub(r'(^|[^:])//[^\n]*', r'\1', w4c)
        m_days = re.search(r'ALBUM_KEEP_DAYS\s*=\s*(\d+)', w4c)
        ok('the album keep window is written once, in the Worker',
           bool(m_days), (m_days.group(1) + ' days') if m_days else 'ALBUM_KEEP_DAYS is gone')
        if m_days:
            ok('and the privacy page promises the same number of days',
               re.search(r'\b' + m_days.group(1) + r'\s*days\b', priv) is not None,
               'code keeps %s days' % m_days.group(1),
               why='a retention period on the page that is not the one enforced is a promise we do not keep')
        # The page names three things. The sweep has to touch all three.
        #
        # THIS USED TO ASK WHETHER THE WORDS pp_players AND DELETE BOTH APPEARED SOMEWHERE
        # IN THE FILE. They do, in unrelated places: line 1414 is the admin "clear players"
        # button a host presses by hand, which is exactly the delete the comment beside the
        # sweep says is NOT the one that keeps the promise. So all three checks were green
        # before the sweep existed and would stay green if it were deleted tomorrow. A check
        # that cannot fail for the fault it names is not a check. Found 17 Sep 2026 while
        # trying to break it on purpose and finding there was nothing to break.
        #
        # Now it looks inside runPhotoSweep only, and wants a DELETE actually aimed at that
        # table in the same statement.
        m_fn = re.search(r'async function runPhotoSweep\(env\)\s*\{(.*?)\n\}', w4c, re.S)
        sweep = m_fn.group(1) if m_fn else ''
        ok('the retention sweep is still in the Worker', bool(m_fn),
           why='runPhotoSweep is where all three privacy promises are kept')
        for label, table in (('the album', 'pp_photos'),
                             ("the guests' nicknames", 'pp_players'),
                             ("the guests' email addresses", 'pp_album_requests')):
            hit = re.search(r"'" + table + r"\?[^']*'[^;]{0,200}method:\s*'DELETE'", sweep, re.S)
            ok('%s are actually deleted, not just promised' % label,
               hit is not None, table,
               why='privacy.html says this goes 30 days after the party, and only a DELETE '
                   'inside runPhotoSweep keeps that promise')
        # Same fault as above: this searched the whole file, and pp_players?licence_id=eq.
        # appears in four unrelated places. Scoped to the sweep, it now asks the question it
        # is named for: does the sweep clear a WHOLE PARTY, or one row somebody named.
        """THE SIZE A BROWSER WILL SEND AND THE SIZE THE WORKER WILL TAKE.

        Written twice each, and nothing tied them together. Whichever way they drift it is
        bad, but one way is much worse: if the browser allows more than the Worker takes, a
        guest records a clip at a party, waits through the whole upload on party wifi, and
        gets a 413 at the end. The other way round they simply cannot send something the
        Worker would have accepted, and nobody ever finds out why.

        Same shape as the venue slides cap and the fifty player cap. Added 18 Sep 2026; both
        pairs agreed."""
        for label, libname, wconst in (('photo', 'pp-photo.js', 'PHOTO_MAX_BYTES'),
                                       ('video', 'pp-video.js', 'VIDEO_MAX_BYTES')):
            lp = os.path.join(PARTYPLAY_BACK, 'lib', libname)
            if not os.path.isfile(lp):
                continue
            lt = re.sub(r'/\*.*?\*/', ' ', io.open(lp, encoding='utf-8').read(), flags=re.S)
            m_lib = re.search(r'HARD_LIMIT\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024', lt)
            m_w = re.search(wconst + r'\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024', w4c)
            ok('the %s size limit is the same in the browser and the Worker' % label,
               bool(m_lib and m_w and m_lib.group(1) == m_w.group(1)),
               'browser %sMB, Worker %sMB' % (m_lib and m_lib.group(1), m_w and m_w.group(1)),
               why='if the browser sends more than the Worker takes, a guest waits through '
                   'the whole upload on party wifi and gets a 413 at the end of it')

        """AND NOTHING GOES INTO THE ALBUM WITHOUT A DATE IT LEAVES.

        runPhotoSweep finds photo rows by delete_after. A row written without one is never
        found, so it lives for ever, and privacy.html says it went thirty days after the
        party. There is no error and nothing to see: the album just quietly keeps things.

        Three inserts today and all three set it. The point is the fourth one, written by
        somebody adding an upload path six months from now. Privacy by construction rather
        than by remembering. Added 18 Sep 2026."""
        inserts = []
        for m in re.finditer(r"sb\(env, 'pp_photos'\s*,\s*\{", w4c):
            chunk = w4c[m.start():m.start() + 700]
            cut = chunk.find('});')
            inserts.append('delete_after' in (chunk[:cut + 3] if cut > 0 else chunk))
        ok('nothing is written to the album without a date it goes',
           bool(inserts) and all(inserts),
           '%d insert(s), %d set delete_after' % (len(inserts), sum(1 for x in inserts if x)),
           why='a photo row with no delete_after is never found by the sweep, so it lives '
               'for ever while privacy.html says it went thirty days after the party')

        ok("the sweep removes guest rows, not only picture rows",
           re.search(r"pp_players\?licence_id=eq\.", sweep) is not None and
           re.search(r"pp_album_requests\?licence_id=eq\.", sweep) is not None,
           why='both of those tables hold guest email addresses')

    head('Every PartyPlay game has a name a person would say out loud')
    """THE HOST'S CONSOLE AND THE TELEVISION SHOWED THE DATABASE'S WORD FOR IT.

    The names lived only in host.html's TYPES, which draws the "Add a game" tiles, so the
    BUILD page looked perfect. run.html, the screen a host actually runs the night from, had
    none of them and fell back to pp_games.format. A host mid-party read "headstails",
    "truths", "draw" and "bingo90" off their own console, and run.html sends the same string
    to the TELEVISION when a game starts, so the slug went up in front of the room.

    Nothing was broken in the usual sense. Every game ran. Found 12 Sep 2026 by running a
    party, not by reading the code.

    They are in lib/pp-games.js now. This checks both pages ask it, and that every format the
    product can store has an entry, because one that does not falls straight back to its slug."""
    gl = os.path.join(PARTYPLAY_SITE, 'lib', 'pp-games.js')
    hh = os.path.join(PARTYPLAY_SITE, 'host.html')
    rh = os.path.join(PARTYPLAY_SITE, 'run.html')
    if all(os.path.isfile(x) for x in (gl, hh, rh)):
        glib = io.open(gl, encoding='utf-8').read()
        host = io.open(hh, encoding='utf-8').read()
        run = io.open(rh, encoding='utf-8').read()
        named = set(re.findall(r"\n    ([a-z0-9]+):\s*\{\s*name:", glib))
        ok('the game names live in lib/pp-games.js', len(named) >= 10, '%d game(s)' % len(named))
        for page, src, label in ((hh, host, 'host.html'), (rh, run, 'run.html')):
            ok('%s loads the shared names' % label,
               '/lib/pp-games.js' in src,
               why='without it PPGames is undefined and the page falls back to the slug')
        # PRESENCE on BOTH lines of the card. Absence alone is not enough and I proved that
        # twice in one evening: a mutation that fed the slug through a variable instead of
        # esc(g.format) satisfied "the old pattern is gone" and prove-checks called it BLIND.
        # So name what must be TRUE: the heading asks PPGames, and so does the line under it.
        head_named = 'esc(PPGames.name(g.format,g.title))' in run
        sub_named = re.search(r"var kind = PPGames\.name\(g\.format\);", run) is not None
        no_raw = re.search(r"esc\(g\.format\)", run) is None
        ok('run.html names a game rather than printing its format',
           head_named and sub_named and no_raw,
           'heading=%s subtitle=%s no-raw-slug=%s' % (head_named, sub_named, no_raw),
           why="a host mid-party should not be reading 'headstails' off their own console")
        # PRESENCE, not absence. The first version of this only checked that the OLD
        # expression was gone, so a mutation that put the slug back a DIFFERENT way sailed
        # through and prove-checks called it BLIND. Assert what has to be true: the string
        # handed to the television is the one PPGames produced.
        tv_named = re.search(r'var _n=PPGames\.name\(g\.format,g\.title\);', run) is not None
        tv_uses = re.search(r'send\(\{t:"big",text:_n,', run) is not None
        ok('and the TELEVISION gets the name too, not the slug',
           tv_named and tv_uses,
           'named=%s used=%s' % (tv_named, tv_uses),
           why='this is the half the whole room sees')
        ok('host.html takes its names from the same place, so they cannot drift',
           'name:PPGames.name(' in host and re.search(r'\{ icon:"[^"]*", name:"', host) is None,
           why='two lists of the same names is the next one of these')
        # every format the TYPES table knows must have a name in the shared map
        types = set(re.findall(r"\n    ([a-z0-9]+):\s*\{\s*icon:PPGames", host))
        missing = sorted(types - named)
        ok('every format the product offers has a name',
           not missing, ', '.join(missing) if missing else '%d format(s)' % len(types),
           why='a format with no entry falls back to its slug, on the console and on the TV')

    head('D. Nothing shares a corner of the venue TV')
    """A TV is the one surface a whole room looks at, and its corners are crowded.

    On 5 Sep a venue called The Mini Bar had a screen reading "Join now UZRHJU bar".
    Three things were pinned bottom-left: the fullscreen button at bottom:2.4cqw,
    the join panel carrying the QR and the code at bottom:2cqw, and the venue name
    at bottom:16px. cqw is 1% of the stage width, so on a 1920 TV the name sat
    clear beneath the panel, and at 800px wide 2cqw IS 16px and the panel landed
    on top of it. The name's z-index was ten times the panel's, so it drew across
    the QR with its tail hanging out the side.

    Mixing cqw and px in one corner is the fault, not the exact numbers: the two
    move at different rates, so they are only ever correct at one screen width."""
    corners = []
    for rel in ('venueplay/tv.html', 'venueplay/signage.html',
                'venueplay/app/musical/screen.html', 'venueplay/app/trivia/screen.html',
                'venueplay/app/raffle/screen.html', 'venueplay/app/members/screen.html'):
        f = os.path.join(ROOT, rel)
        if not os.path.isfile(f):
            continue
        # COMMENTS STRIPPED FIRST. The first version of this scanned the raw file
        # and its only finding was the comment I had just written ABOUT the bug,
        # which describes bottom:2cqw and left:22px in prose. A check that reads
        # its own documentation as evidence is worse than no check.
        src = copy_text(f)
        # Anything anchored to a corner, with the units it used to get there.
        pinned = {}
        # THE GAP MUST ALLOW A SEMICOLON. The first version used [^;"'], which
        # cannot cross the ; that separates two CSS declarations, so the only
        # thing it ever matched was comment prose where the separator is a comma.
        # It reported my own documentation and stayed silent on the real rule.
        for m in re.finditer(r'(bottom|top)\s*:\s*([0-9.]+)(cqw|px|cqh|%)[^{}]{0,90}?'
                             r'(left|right)\s*:\s*([0-9.]+)(cqw|px|cqh|%)', src):
            if not (m.group(5) == '50' and m.group(6) == '%'):
                pinned.setdefault((m.group(1), m.group(4)), set()).add((m.group(3), m.group(6)))
        for m in re.finditer(r'(left|right)\s*:\s*([0-9.]+)(cqw|px|cqh|%)[^{}]{0,90}?'
                             r'(bottom|top)\s*:\s*([0-9.]+)(cqw|px|cqh|%)', src):
            if not (m.group(2) == '50' and m.group(3) == '%'):
                pinned.setdefault((m.group(4), m.group(1)), set()).add((m.group(6), m.group(3)))
        # left:50% with a translate is CENTRING, not a corner anchor. Counting it
        # made the check report a three-way "% and cqw and px" clash the moment I
        # centred the status indicator to get it OUT of a corner.
        for m in re.finditer(r'(left|top)\s*:\s*50%', src):
            pass
        pinned = {k: v for k, v in pinned.items()}
        for corner, unitsets in pinned.items():
            units = set()
            for a, b in unitsets:
                units.add(a); units.add(b)
            if len(units) > 1:
                corners.append('%s: %s-%s mixes %s' %
                               (short(f), corner[0], corner[1], ' and '.join(sorted(units))))
    ok('no corner of a screen mixes cqw and px', not corners,
       why='; '.join(corners[:3]) + '. Two units in one corner are only correct at one width.')

    """A DROPPED CHANNEL MUST NOT BE WRITTEN INTO.

    Every console keeps a boolean saying whether its realtime channel is up, and
    every send is queued instead when it is down. The bingo console said
    "Reconnecting" on screen and never cleared the flag, so it kept calling
    ch.send() into a dead socket: balls, claim resolutions and the winner
    announcement went nowhere and the room simply stopped. Bingo has no game
    Worker behind it - the broadcast IS the game - so it was the one format that
    could lose a whole house with nothing to replay from. Musical had the same
    gap on its players' channel.

    Reading the code will not catch this: the drop branch LOOKS handled because it
    updates the status text. The flag is the part that matters."""
    # THE PHONE AND THE SCREEN ARE ON THIS LIST NOW, and they were the whole point.
    #
    # This scanned five HOST consoles. play.html was not among them, and that is
    # exactly where the bug was found on 10 Sep: the phone did not handle CLOSED at
    # all and never cleared its flag, so it wrote every answer into a dead channel
    # while showing Connected. This check was green throughout. The docstring above
    # even says "musical had the same gap on its PLAYERS' channel" and the players'
    # page was never opened.
    #
    # A hand-maintained list of files to check is the same shape of fault as a
    # hand-maintained list of venues to watch, found earlier the same day.
    consoles = [os.path.join(ROOT, 'venueplay', 'app', x) for x in
                ('index.html', 'musical/host.html', 'trivia/host.html',
                 'raffle/host.html', 'members/host.html')] + \
               [os.path.join(ROOT, 'venueplay', x) for x in ('play.html', 'tv.html')]
    deaf = []
    cbs = 0
    for f in consoles:
        if not os.path.exists(f):
            deaf.append('%s is missing' % short(f)); continue
        body = io.open(f, encoding='utf-8').read()
        # AND A NAMED HANDLER COUNTS. This only matched .subscribe(function(status){,
        # so the moment play.html's callback was pulled out and given a name - which is
        # what made it testable at all - this check would have stopped seeing it and
        # gone quietly green. A checker that only recognises one spelling punishes the
        # refactor that makes code testable.
        for m in re.finditer(r'\.subscribe\(\s*(function\s*\(\s*status\s*\)\s*\{|([A-Za-z_$][\w$]*)\s*\))', body):
            cbs += 1
            named = m.group(2)
            if named:
                d = re.search(r'function\s+' + re.escape(named) + r'\s*\(', body)
                if not d:
                    deaf.append('%s: subscribe(%s) but %s is not defined here' % (short(f), named, named)); continue
                win = body[d.start(): d.start() + 2600]
            else:
                win = body[m.start(): m.start() + 2600]
            win = _no_comments(win)          # prose is not evidence; see _no_comments
            drops = re.findall(r'CHANNEL_ERROR|TIMED_OUT|CLOSED', win)
            if not drops:
                deaf.append('%s: a subscribe with no drop branch' % short(f)); continue
            if 'CLOSED' not in drops:
                deaf.append('%s: the drop branch does not handle CLOSED' % short(f)); continue
            after = win[win.index(drops[0]):][:900]
            if not re.search(r'(subscribed|gsub|tvSubscribed)\s*=\s*false', after):
                deaf.append('%s: drop branch never clears the flag' % short(f))
    ok('a dropped channel is never written into', not deaf and cbs >= 7,
       '%d subscribe callbacks across %d consoles' % (cbs, len(consoles)),
       why='; '.join(deaf[:3]) or 'found only %d callbacks, expected at least 7' % cbs)

    """EVERY UNSIGNED ADMIN BROADCAST MUST BE EXEMPT FROM SIGNING.

    HQ and billing.html broadcast straight onto a venue channel. They cannot sign:
    the venue private key is minted in the host console and never leaves it. So the
    moment a venue is switched to broadcast_enforce, any message type they send
    that is not on vp-sign.js's EXEMPT list is silently dropped.

    That happened. tv_reload was missing from the list, and the day The Mini Bar
    was switched to enforce, "reload all TVs" in HQ quietly did nothing - no error
    anywhere, because being dropped is the correct behaviour for an unsigned
    message. screen_refresh was already exempt, which is what made it look fine."""
    signp = os.path.join(ROOT, 'venueplay', 'app', 'vp-sign.js')
    admin_pages = [os.path.join(ROOT, 'venueplay', 'app', x) for x in
                   ('hq.html', 'billing.html', 'settings.html', 'onboard.html')]
    unexempt = []
    raw_types = set()
    if not os.path.exists(signp):
        unexempt.append('vp-sign.js is missing')
    else:
        sign = io.open(signp, encoding='utf-8').read()
        m = re.search(r'var EXEMPT\s*=\s*\{([^}]*)\}', sign)
        exempt = set(re.findall(r'(\w+)\s*:', m.group(1))) if m else set()
        for f in admin_pages:
            if not os.path.exists(f):
                continue
            body = io.open(f, encoding='utf-8').read()
            for mm in re.finditer(r'\.send\(\s*\{\s*type\s*:\s*["\']broadcast["\']'
                                  r'[^}]*payload\s*:\s*\{\s*t\s*:\s*["\'](\w+)["\']',
                                  body, re.S):
                t = mm.group(1)
                raw_types.add(t)
                if t not in exempt:
                    unexempt.append('%s broadcasts t:"%s" unsigned and it is not EXEMPT'''
                                    % (short(f), t))
    ok('an unsigned admin broadcast is exempt from signing', not unexempt,
       '%d raw type(s): %s' % (len(raw_types), ', '.join(sorted(raw_types)) or 'none'),
       why='; '.join(unexempt[:3]) + '. Any venue on broadcast_enforce drops it, silently.')
    """A CONSOLE THAT SENDS THE TV TO THE ADS MUST BE ABLE TO BRING IT BACK.

    All five consoles tell the TV t:"to_ads" on pagehide, and not one had a
    pageshow or visibilitychange handler. So tabbing away from the console,
    switching apps, or letting the tablet sleep with a lobby open dropped the wall
    to the venue's advertising and left it there until the TV's 90 minute
    host-silence timer gave up. Reported live at The Mini Bar: host panel still
    holding the game, TV showing ads.

    Checked as a pair. Sending to_ads is right; sending it with no way back is the
    fault."""
    consoles = [os.path.join(ROOT, 'venueplay', 'app', x) for x in
                ('index.html', 'musical/host.html', 'trivia/host.html',
                 'raffle/host.html', 'members/host.html')]
    oneway = []
    for f in consoles:
        if not os.path.exists(f):
            oneway.append('%s is missing' % short(f)); continue
        body = io.open(f, encoding='utf-8').read()
        # LOOK FOR THE LISTENER, NOT THE WORD. The first version of this check
        # searched the file for "pageshow", which appears in the comment ABOVE the
        # listener explaining why it is there. Deleting the listener therefore left
        # the check green: it was reading my own prose as evidence of the code.
        sends_to_ads = re.search(r'''t:\s*["']to_ads["']''', body) is not None
        comes_back = (re.search(r'''addEventListener\(\s*["']pageshow["']''', body) or
                      re.search(r'''addEventListener\(\s*["']visibilitychange["']''', body))
        if sends_to_ads and not comes_back:
            oneway.append('%s sends to_ads and never says it is back' % short(f))
        if comes_back and 'reassertToTv' not in body:
            oneway.append('%s listens for the return but replays nothing' % short(f))
    ok('a console can put the game back on the wall', not oneway,
       '%d consoles' % len(consoles),
       why='; '.join(oneway[:3]) + '. The TV drops to ads on pagehide and nothing '
           'restores it until the 90 minute silence timer.')

    """THE PUBLIC KEY MUST NOT WRITE THE TOUR TABLES.

    touring/manage.html used to insert, update and delete shows, experience,
    ticket_milestones and tour_categories straight from the browser under the
    PUBLIC Supabase key, behind a four digit PIN whose SHA-256 was in the page
    source. Ten thousand guesses, and beside the point: the key went out with
    every request whether the PIN was typed or not. The tables are now locked and
    only touring-api may write them.

    Reads are deliberately still direct - the public tour pages read the same
    tables - so this looks for a WRITE, not for any mention of the table."""
    mp = os.path.join(ROOT, 'touring', 'manage.html')
    leaks = []
    if not os.path.exists(mp):
        leaks.append('touring/manage.html is missing')
    else:
        body = io.open(mp, encoding='utf-8').read()
        for m in re.finditer(r'fetch\(\s*`?\$?\{?SUPABASE_URL\}?/rest/v1/'
                             r'(shows|experience|ticket_milestones|tour_categories)'
                             r'[^`\)]*`?\s*,\s*\{([^}]{0,220})', body):
            opts = m.group(2)
            if re.search(r"method\s*:\s*['\"](POST|PATCH|PUT|DELETE)", opts, re.I):
                leaks.append('%s writes %s with the public key' % (short(mp), m.group(1)))
        if 'PIN_HASH' in body:
            leaks.append('%s still carries a PIN hash in its source' % short(mp))
    ok('the public key cannot write the tour tables', not leaks,
       why='; '.join(leaks[:3]) + '. Those tables answer 42501 now, so the write '
           'fails anyway - route it through touring-api.')

    """A RELOADED TV MUST GET THE LOBBY BACK.

    A screen announces itself with hello:true and the host replays whatever is on
    air. musical replayed only when the game was already "running", so a TV that
    reloaded while the room was still filling up was never told the format or the
    lobby state: the host could see players joining and the wall showed nothing,
    with no way back short of ending the game. sendState() has always carried
    lobby:, and the console's own resize path has always used both statuses, so
    only the hello path was wrong.

    Checked as "the hello replay covers a lobby", not as an exact string, so
    rewording the condition does not break the check."""
    lobbyless = []
    for f in [os.path.join(ROOT, 'venueplay', 'app', x) for x in
              ('musical/host.html', 'trivia/host.html')]:
        if not os.path.exists(f):
            continue
        body = io.open(f, encoding='utf-8').read()
        i = body.find('m.hello')
        if i < 0:
            lobbyless.append('%s: nothing handles hello' % short(f)); continue
        block = body[i: i + 1600]
        # The wording differs on purpose: musical says lobby || running, trivia says
        # != setup. Both cover a lobby. The fault is gating the replay on "running"
        # ALONE, so check for that rather than for a particular spelling - the first
        # draft of this check looked for the word "lobby" and wrongly failed trivia.
        gates = re.findall(r'G\.status\s*(===|!==)\s*"(\w+)"', block)
        covers_lobby = any(
            (op == '===' and val in ('lobby',)) or (op == '!==' and val == 'setup')
            for op, val in gates)
        if gates and not covers_lobby:
            lobbyless.append('%s: the hello replay only fires for %s'
                             % (short(f), ', '.join(sorted({v for o, v in gates}))))
    ok('a reloaded TV gets the lobby back', not lobbyless,
       why='; '.join(lobbyless[:3]) + '. A screen that reloads mid-lobby is then '
           'stuck and the host cannot recover it without ending the game.')

    """A JOIN MUST NOT REBUILD A HOST CONSOLE.

    renderConsole reaches the panel that holds the host's own controls. In bingo
    that panel carries the "Next prize" dropdown, so a punter scanning in while
    the host was choosing the next pattern silently reset the choice and "Keep
    playing" ran a pattern nobody picked. In trivia it rebuilds the "Next
    question" button with a fresh listener, and in musical the whole song list.
    People join constantly on a busy night, which is why hosts reported taps
    going nowhere."""
    rebuilt = []
    for f in consoles:
        if not os.path.exists(f):
            continue
        body = io.open(f, encoding='utf-8').read()
        i = body.find('m.t==="join"')
        if i < 0:
            continue
        # the handler runs until the next else-if branch
        j = body.find('else if(m.t', i)
        handler = body[i: j if j > i else i + 2600]
        if re.search(r'\brenderConsole\(\)', handler):
            rebuilt.append(short(f))
    ok('a join never rebuilds a host console', not rebuilt,
       '%d consoles' % len(consoles),
       why=', '.join(rebuilt) + ' calls renderConsole() on a join, which replaces the '
           'host\'s own controls mid-tap. Update the counts only.')

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
        # A pack CALLED a decade holds only that decade. On 8 Sep 2026 "80s Rock" held 122
        # songs from the 70s, 90s and 2000s (Aerosmith 1975, Bon Jovi 2000): a punter who
        # knows their music calls that out across the room. An undated song in a decade
        # pack counts as wrong too, because nobody can say it belongs.
        by_id = {s_['id']: s_ for s_ in songs}
        stray = []
        for p_ in pls:
            m_ = re.search(r'(\d{2})s\b', p_['name'])
            if not m_:
                continue
            d_ = int(m_.group(1))
            d_ = 1900 + d_ if d_ >= 50 else 2000 + d_
            for i in p_['songIds']:
                y_ = by_id.get(i, {}).get('year')
                if not y_ or not (d_ <= int(str(y_)[:4]) < d_ + 10):
                    stray.append('%s: %s (%s)' % (p_['name'], by_id.get(i, {}).get('title', i), y_ or 'undated'))
        ok('every decade pack holds only its decade', not stray,
           '%d decade packs' % sum(1 for p_ in pls if re.search(r'(\d{2})s\b', p_['name'])),
           why='%d stray; ' % len(stray) + '; '.join(stray[:3]))
    except Exception as e:
        ok('the song library parses', False, why=str(e)[:120])

    head('D. A shared script is loaded before it is used')
    """A page that uses PPConfig above the tag that loads it throws a
    ReferenceError and everything after it in that block simply never runs. It is
    silent: the page looks fine, the feature just never happens. partyplay's
    parties counter was dead this way and nobody could have noticed, because it
    hides itself below 25 parties and there are none yet."""
    """THE TABLE IS DERIVED, NOT REMEMBERED.

    It used to be typed out by hand, and it said 'vp-session.js': 'VPSession'. Nothing in this
    repo has ever been called VPSession: the global is VP. So the row covering the most widely
    used shared script in the product, loaded by thirteen pages, could never fail. It was a
    check that could not fail hiding inside a check that could, which is the worst shape of all
    because the surrounding green makes it look covered.

    vp-room.js and pp-licence.js were simply missing from the table, so those were not covered
    either. A hand-kept list of what a file exports drifts from the file the moment somebody
    renames an export, and nothing says so.

    So read it off the files. Whatever each shared script assigns to root/window IS the global,
    by definition, and a rename moves the check with it."""
    GLOBALS = {}
    for root_dir in ('venueplay', 'partyplay'):
        for dirpath, _dirs, names in os.walk(os.path.join(ROOT, root_dir)):
            for n in names:
                if not (n.startswith(('vp-', 'pp-')) and n.endswith('.js')):
                    continue
                try:
                    src = io.open(os.path.join(dirpath, n), encoding='utf-8').read()
                except Exception:
                    continue
                src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
                src = re.sub(r'^\s*//.*$', ' ', src, flags=re.M)
                for m in re.finditer(r'\b(?:root|window|self|globalThis)\s*\.\s*([A-Z][A-Za-z0-9_]*)\s*=', src):
                    GLOBALS.setdefault(n, m.group(1))
    # A file that exports nothing recognisable is not a shared library; say so rather than
    # silently covering nothing. Zero of them would mean the scan above stopped working.
    if not GLOBALS:
        ok('the shared-script table could be built at all', False,
           why='no vp-*.js or pp-*.js assigns a global; this check can no longer see anything')
        return

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
            # A MENTION IN A COMMENT IS NOT A CALL. Blanked rather than removed, so every
            # offset below still lines up with the real file and "used before loaded" stays
            # true. This never mattered while the table named a global that did not exist;
            # the moment the names were right it produced three false alarms, all of them
            # comments saying which files keep a helper in lockstep by hand.
            code = re.sub(r'/\*.*?\*/', lambda m: ' ' * len(m.group(0)), body, flags=re.S)
            code = re.sub(r'^([ \t]*)//.*$', lambda m: m.group(1) + ' ' * (len(m.group(0)) - len(m.group(1))),
                          code, flags=re.M)
            for lib, g in GLOBALS.items():
                m = re.search(r'(?<![.\w])' + g + r'\s*\.', code)
                if not m:
                    continue
                # NOT LOADED AT ALL is worse than loaded late, and this used to
                # skip it: `if lib not in loads: continue` meant a page calling
                # VPFeedback.ask() while loading nothing passed silently. Found by
                # prove-checks.py, which broke the page that way and watched this
                # stay green.
                if lib not in loads:
                    late.append('%s uses %s but never loads %s' % (short(f), g, lib))
                elif at + m.start() < loads[lib]:
                    late.append('%s uses %s before %s' % (short(f), g, lib))
    ok('every shared script loads before it is used', not late, why='; '.join(late[:3]))

    head('The 90 days the privacy page promises')
    """A PROMISE WITH NO SCHEDULER IS A PROMISE NOBODY KEEPS.

       venueplay.com.au/privacy says a closed venue's player list is deleted within 90
       days. purge-closed-player-data.py does it, and NOTHING RUNS THAT TOOL. That is the
       same shape as the 30-day archive sweep, which sat in the Worker unrun from the day
       it was written until 16 Sep 2026 because nobody had added a Cron Trigger.

       So the gate nags instead. It runs the tool in its read-only mode and goes red the
       moment a venue is overdue, which is the only thing that will make anyone run it.
       It does NOT reimplement the rule: a second copy of "what counts as closed" is
       exactly how the two would drift apart."""
    tool = os.path.join(ROOT, 'venueplay-backend', 'tools', 'purge-closed-player-data.py')
    if not os.path.isfile(tool):
        ok('a closed venue\'s player data is deleted within 90 days', False,
           why='purge-closed-player-data.py is missing entirely')
    else:
        try:
            r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=180)
            out = r.stdout + r.stderr
        except Exception as e:
            out = 'could not run it: %s' % e
        due = [l.strip() for l in out.splitlines() if l.strip().startswith('DUE')]
        soon = [l.strip() for l in out.splitlines() if 'to go' in l]
        # GREEN WHEN THE TOOL CRASHED. This never read the exit code, and its verdict was "no
        # line starts with DUE", which a tool that died saying "STOP: cannot reach the database"
        # satisfies perfectly. The audit of 20 Sep 2026 swapped the tool for one that does
        # exactly that and the gate stayed green. A pass now needs the tool to have exited
        # cleanly AND to have said how many venues it looked at, and a venue it could not date
        # is a failure that names the venue, not a line nobody reads.
        skipped = [l.strip() for l in out.splitlines() if l.strip().startswith('SKIPPED')]
        counted = re.search(r'(\d+) suspended venue\(s\), (\d+) of them closed for good', out)
        rc = getattr(r, 'returncode', 1) if 'could not run it' not in out else 1
        if 'could not run it' in out:
            ok('a closed venue\'s player data is deleted within 90 days', False, why=out[:120])
        elif rc != 0 or not counted:
            ok('a closed venue\'s player data is deleted within 90 days', False,
               detail='the tool did not finish (exit %s)' % rc,
               why='purge-closed-player-data.py said: ' + (out.strip().splitlines() or ['nothing'])[-1][:140])
        elif skipped:
            ok('a closed venue\'s player data is deleted within 90 days', False,
               detail='%d closed venue(s) cannot be dated' % len(skipped),
               why='; '.join(x[:80] for x in skipped[:3]) + '. A venue with no closing date never comes due')
        else:
            nearest = ''
            if soon:
                try:
                    nearest = min(int(re.search(r'(\d+) to go', l).group(1)) for l in soon
                                  if re.search(r'(\d+) to go', l))
                    nearest = 'nearest is %d day(s) away' % nearest
                except Exception:
                    nearest = ''
            ok('a closed venue\'s player data is deleted within 90 days', not due,
               detail=nearest or ('%d venue(s) overdue' % len(due)),
               why=('OVERDUE: ' + '; '.join(x[:70] for x in due[:3])
                    + '. Run venueplay-backend/tools/purge-closed-player-data.py --apply') if due else '')

    head('A hidden element is actually hidden')
    """display:flex BEATS THE hidden ATTRIBUTE, and nothing here could see it.

       The connection badge on all five venue screens is markup-hidden and styled
       display:flex, so it was painted from the first frame reading "Connecting" until
       tvStatus(true) ran. On ?demo=1 the screens never connect on purpose, so it never
       ran, and see-a-night -- the page every cold email points at -- showed a permanent
       CONNECTING badge over a game playing perfectly. Found 16 Sep 2026 by opening the
       page, not by reading it.

       An attribute and a stylesheet disagreeing is invisible to every other check in this
       file, because each half is correct on its own."""
    import glob as _glob
    """EVERY PAGE, not the five screens it was first written for. signage.html carries the
       same shape on .vlogo and was guarded but unwatched, which is the state tv.html was in
       right up until it shipped a CONNECTING badge to the sales page."""
    clash = []
    _pages = sorted(_glob.glob(os.path.join(ROOT, 'venueplay', '**', '*.html'), recursive=True))
    for f in _pages:
        try:
            src = open(f, encoding='utf-8').read()
        except Exception:
            continue
        for cls in set(re.findall(r'class="([a-z0-9 _-]*)"[^>]*\shidden(?=[\s>])', src)):
            for one in cls.split():
                rule = re.search(r'\.' + re.escape(one) + r'\s*\{([^}]*)\}', src)
                if not rule or 'display:' not in rule.group(1).replace(' ', ''):
                    continue
                guard = re.search(r'\.' + re.escape(one) + r'\[hidden\]\s*\{[^}]*display\s*:\s*none',
                                  src)
                if not guard:
                    clash.append('%s: .%s sets display, so hidden does nothing' % (short(f), one))
    ok('a markup-hidden element is not made visible by its own stylesheet',
       not clash, why='; '.join(clash[:4]),
       detail='%d page(s) checked' % len(_pages))

    head('No function is declared inside an if, where it may never be bound')
    """THE FAULT THIS IS HERE FOR SHIPPED TO A LIVE VENUE AND PASSED ALL 292 CHECKS.

       tvStatus was written inside connectRealtime's first if - the branch that runs only
       while the Supabase library is still loading. A function declaration in a BLOCK is
       bound when the block RUNS, so on any screen where the CDN was quick it was never
       bound, and Tugun Bowls Club's television threw "tvStatus is not a function" out of
       its SUBSCRIBED handler all day. It never said Connected, never recorded which road
       it took, and could no longer mark itself unsubscribed when the channel closed: a
       deaf screen would have gone on claiming it was fine.

       The file PARSED. Every other check here was true. Only screen-check.html, which
       opens the real screen in a frame, could see it.

       It only counts as a fault when the name is called from outside the block too,
       which is the combination that actually breaks."""
    stray = []
    # IT SCANNED VENUEPLAY'S JAVASCRIPT AND NOT PARTYPLAY'S. VenuePlay got .html and .js,
    # PartyPlay got .html only, so all seven of its shared browser libraries and both
    # Workers were outside the net. Nothing was hiding there, checked 18 Sep 2026 by
    # pointing the same detector at all twenty files: zero. But this is the fault that
    # blinded a live venue television for a day while every other check stayed green, and
    # half a net is how it got there in the first place.
    for f in sorted(_glob.glob(os.path.join(ROOT, 'venueplay', '**', '*.html'), recursive=True)
                    + _glob.glob(os.path.join(ROOT, 'venueplay', '**', '*.js'), recursive=True)
                    + _glob.glob(os.path.join(ROOT, 'partyplay', '**', '*.html'), recursive=True)
                    + _glob.glob(os.path.join(ROOT, 'partyplay', '**', '*.js'), recursive=True)
                    + _glob.glob(os.path.join(ROOT, 'partyplay-backend', 'lib', '*.js'))
                    + _glob.glob(os.path.join(ROOT, 'partyplay-backend', 'worker', '*.js'))
                    + _glob.glob(os.path.join(ROOT, 'venueplay-backend', 'worker', '*.js'))
                    + _glob.glob(os.path.join(ROOT, 'touring-backend', '**', '*.js'), recursive=True)):
        if f.endswith('.test.js'):
            continue
        try:
            body = io.open(f, encoding='utf-8').read()
        except Exception:
            continue
        for name, line in _decls_inside_blocks(body):
            stray.append('%s:%d: %s() is declared inside a block' % (short(f), line, name))
    ok('every function is declared where it will actually be bound',
       not stray, why='; '.join(sorted(set(stray))[:4]),
       detail='%d stray' % len(set(stray)) if stray else '')





    head('D. One place decides whether a screen may make a noise')
    """Dean, 12 Sep 2026: "Why are you not checking everywhere this code shit lives at once?"

    Fair. He asked for the demo to be silent, I guarded the win fanfare, he heard it again, I
    found three more vibrate calls in one page, and a proper sweep then found two more in two
    other pages. Five call sites across four files, each with its own try/catch, found one at a
    time as he ran into them. This repo already knows the answer to that and I did not apply
    it: the same answer must exist in ONE place, which is why esc, cryptoInt and tvSend are
    held identical by the checks above.

    So no deployed page calls the vibration API at all. VPCelebrate.buzz does, once, and asks
    whether the page is a demonstration before it fires. A page added next month gets the guard
    without anybody remembering, and if one calls the API directly this goes red naming the
    file and the line."""
    SOUND_HOME = 'venueplay/app/vp-celebrate.js'
    direct = []
    for f in files:
        if not f.endswith(('.html', '.js')):
            continue
        rel = short(f)
        if rel.replace('\\', '/').endswith('vp-celebrate.js'):
            continue                      # the one place that is allowed to
        src = io.open(f, encoding='utf-8').read()
        # Comments explain the rule and are not calls. Strip them before looking.
        body = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
        body = re.sub(r'^\s*//.*$', ' ', body, flags=re.M)
        for m in re.finditer(r'navigator\s*\.\s*vibrate\s*\(', body):
            line = body[:m.start()].count('\n') + 1
            direct.append('%s:%d' % (rel, line))
    ok('nothing buzzes a phone except %s' % SOUND_HOME, not direct,
       why='; '.join(direct[:4]))

    """AND THE ONE PLACE ACTUALLY ASKS. A single call site is only an improvement if the guard
    is in front of it; without this the check above would pass a shared helper that buzzes
    unconditionally, which is a worse fault than five guarded copies."""
    home = os.path.join(ROOT, SOUND_HOME)
    guarded = False
    if os.path.isfile(home):
        h = io.open(home, encoding='utf-8').read()
        i = h.find('function buzz(')
        if i >= 0:
            blk = h[i:i + 400]
            guarded = ('isDemoPage()' in blk
                       and blk.index('isDemoPage()') < (blk.index('vibrate') if 'vibrate' in blk else 10 ** 9))
    ok('and it asks whether the page is a demo BEFORE it does', guarded,
       why='the guard must be in front of the call, not after it')

    head('D. No screen can sit on a "loading" line nothing will finish')
    """A pane that says "Reading the meter..." and never stops is indistinguishable from a
    slow request, and there is nothing on the screen to tell you which. HQ's Usage tab did
    exactly that on 12 Sep 2026: the loader was fired from renderBilling alone, so opening
    Usage first waited for ever. Found in a browser, because no check here could see it.

    THE RULE IT ENFORCES. A page that renders a "still loading" branch off S.<name> must have
    a loader for that state reachable from the pane switch, not only from one pane's render.
    goPane is where every pane change goes through, so that is where the ask belongs."""
    spinners = []
    for f in files:
        if not f.endswith('.html'):
            continue
        src = io.open(f, encoding='utf-8').read()
        if 'function goPane(' not in src:
            continue
        gp = src[src.index('function goPane('):]
        gp = gp[:gp.index('\n  }') + 4] if '\n  }' in gp else gp[:2000]
        # Every lazily-loaded state: a render branch that tests S.<name> === undefined.
        for name in sorted(set(re.findall(r'S\.(\w+)\s*===\s*undefined', src))):
            cap = name[0].upper() + name[1:]
            # Which panes read it? Anything inside a render<Pane> function that names S.<name>.
            readers = []
            for rm in re.finditer(r'function render(\w+)\s*\(', src):
                body = src[rm.start():]
                end = body.find('\n  }')
                body = body[:end if end > 0 else 4000]
                if re.search(r'S\.' + name + r'\b', body):
                    readers.append(rm.group(1).lower())
            panes = re.findall(r'data-pane="(\w+)"', src)
            need = [p for p in readers if p in panes]
            if not need:
                continue
            asked = re.findall(r'pane\s*===\s*"(\w+)"', gp)
            asked += re.findall(r'pane\s*===\s*"(\w+)"\s*\|\|\s*pane\s*===\s*"(\w+)"', gp) and []
            for extra in re.finditer(r'pane\s*===\s*"(\w+)"', gp):
                asked.append(extra.group(1))
            missing = [p for p in need if p not in asked]
            if missing:
                spinners.append('%s: %s is shown as loading on %s, but goPane never asks for it there'
                                % (short(f), 'S.' + name, '/'.join(sorted(set(missing)))))
    ok('every loading line has something that will finish it', not spinners,
       why='; '.join(spinners[:3]))

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
        if b not in ('nsw.html','qld.html','vic.html','sa.html','wa.html','nt.html','tas.html','act.html',
                     'last-call.html'):
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
        # /last-call is the one NATIONAL page: it carries a code for every state and
        # chooses between them from the venue's postcode, because the Worker compares
        # a code's prefix to that postcode and no made-up national prefix matches.
        # So it may carry all seven, and it must carry all seven: a state missing here
        # is a state that reads $2.50 and is charged $3.00.
        if b == 'last-call.html':
            allowed = {'NSW','VIC','QLD','SA','WA','TAS','NT'}
            if pre != allowed:
                wrong.append('last-call.html carries %d state codes, needs all 7 (missing %s)'
                             % (len(pre), ', '.join(sorted(allowed - pre)) or 'none'))
                continue
        else:
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

    head('D. The deploy directory serves no data file nothing reads')
    """THE PRODUCT WAS FREE TO DOWNLOAD FROM THE PRODUCT'S OWN WEBSITE.

    On 11 Sep 2026 venueplay.com.au/data/trivia-library.json answered 200 with
    15 MB of application/json: 37,570 pub trivia questions WITH their answers.
    Behind it sat 55 more copies of the same bank, 75 generated question batches
    and the xlsx source chunks. 182 files, 754 MB, every one of them public,
    and the site loads exactly three: musical-library.json, trivia-count.json
    and music-count.json.

    A player sitting in the pub could have downloaded the answers mid-quiz. A
    competitor could have taken the bank whole. check-live.py had been reporting
    that one file as "not published: still deployed" for days, in a tool nobody
    runs on a schedule, and the earlier exposure rule could not see it because
    .json is legitimately served and three of them genuinely are.

    So the rule is not about the extension. A data file that is deployed must be
    one something actually asks for: a page that fetches it, or a tool or suite
    that reads it by that path. Anything else is dead weight on a public URL.
    """
    dead, walked = [], 0
    for site in (['venueplay'] if which in ('both', 'venueplay') else []) + \
                (['partyplay'] if which in ('both', 'partyplay') else []):
        ddir = os.path.join(ROOT, site, 'data')
        if not os.path.isdir(ddir):
            continue
        # WALK THE DISK, NOT GIT, for the same reason the internal-file check two sections
        # below already states: prove-checks.py copies the repo WITHOUT .git, so `git ls-files`
        # returns nothing there, this check read zero files, and it could neither pass nor be
        # proven. I wrote that reason down for the other check and then used git here anyway.
        # An untracked data file in a deploy directory is one `git add .` from being served,
        # so the disk is the honest question in both places.
        tracked = []
        for d, dirs, fs in os.walk(ddir):
            dirs[:] = [x for x in dirs if x not in ('node_modules', '__pycache__')]
            for f in fs:
                tracked.append(os.path.relpath(os.path.join(d, f), ROOT))
        if not tracked:
            continue
        # Everything that could name one, EXCLUDING the data folder itself: a backup
        # named inside another backup must not vouch for itself. Scanning only the .py
        # tools the first time would have moved a file a .test.js suite reads.
        blob = []
        for d, dirs, fs in os.walk(ROOT):
            dirs[:] = [x for x in dirs if x not in ('.git', 'node_modules', '__pycache__', '.claude')]
            if os.path.join(site, 'data') in d:
                continue
            for f in fs:
                # A MENTION IN THE MUTATION CATALOGUE IS NOT A READER.
                # prove-checks.py names the file each mutation creates, so the mutation written
                # to prove THIS check made the check pass: the file it planted was "named
                # somewhere in the repo", by the very entry condemning it. Reported BLIND, and
                # it was the mutation vouching for its own victim. Nothing in that file reads a
                # data file; it is a list of strings.
                if os.path.join('tools', 'prove-checks.py') in os.path.join(d, f):
                    continue
                if f.rsplit('.', 1)[-1] in ('py', 'js', 'html', 'json', 'md', 'sh', 'txt'):
                    try:
                        blob.append(io.open(os.path.join(d, f), encoding='utf-8', errors='replace').read())
                    except Exception:
                        pass
        blob = '\n'.join(blob)
        # A WHOLE DIRECTORY CAN BE FETCHED BY A NAME BUILT AT RUN TIME, and every file
        # in it is then genuinely served on purpose. PartyPlay does exactly that:
        #     fetch("/data/trivia/" + encodeURIComponent(slug) + ".json")
        # so its 24 packs are named nowhere and are all live, correctly. The first
        # version of this check called every one of them dead, which would have taken
        # PartyPlay's trivia offline. A rule that cannot tell those apart is worse than
        # no rule, because the fix it demands breaks the product.
        served_dirs = set()
        for m in re.finditer(r'["\']/data/([A-Za-z0-9._-]+)/["\']\s*\+', blob):
            served_dirs.add(m.group(1))
        for rel in tracked:
            walked += 1
            parts = rel.split('/')
            if len(parts) > 3 and parts[2] in served_dirs:
                continue                      # <site>/data/<dir>/... and <dir> is fetched by name
            if os.path.basename(rel) not in blob:
                dead.append(rel)
    ok('every deployed data file is one something reads', walked > 0 and not dead,
       '%d tracked data file(s) checked' % walked,
       why=(('no data file was read at all, so nothing was checked' if not walked else
             '%d file(s) served to the public that nothing asks for: %s'
             % (len(dead), ', '.join(dead[:4]) + ('' if len(dead) <= 4 else ' and %d more' % (len(dead) - 4))))))

    head('D. No host console can be frozen by a browser dialog')
    """A HOST CONSOLE THAT POPS AN alert() STOPS BEING A HOST CONSOLE.

    On 11 Sep 2026 a members draw was run on a test venue with nobody in the draw.
    startDraw() called alert("No TV connected yet...") and the whole page stopped:
    no rendering, no websocket handling, no buttons, until somebody walks over and
    taps OK. On a tablet behind a bar, mid-service, that is a dead console and a room
    staring at a frozen wall. It also froze the browser automation that found it,
    which is how obvious the failure mode is.

    Every console already has hostError(): a dismissible bar that scrolls itself into
    view and blocks nothing. musical/host.html has said in a comment for weeks that it
    is "the ONLY error surface". members/host.html had six alert() calls and raffle
    four, all of them bypassing the bar sitting right there in the same file.

    confirm() is deliberately NOT included. It asks a question and waits for an answer
    from a host who is standing right there, which is the point of it."""
    consoles = ['venueplay/app/index.html', 'venueplay/app/members/host.html',
                'venueplay/app/musical/host.html', 'venueplay/app/raffle/host.html',
                'venueplay/app/trivia/host.html']
    seen, noisy = 0, []
    for rel in consoles:
        full = os.path.join(ROOT, rel)
        if not os.path.isfile(full):
            noisy.append(rel + ' is missing')
            continue
        seen += 1
        src = io.open(full, encoding='utf-8', errors='replace').read()
        hits = len(re.findall(r'(?<![.\w])alert\s*\(', src))
        if hits:
            noisy.append('%s (%d)' % (rel.split('/app/')[-1], hits))
    ok('no host console calls alert()', seen == len(consoles) and not noisy,
       '%d console(s) read' % seen,
       why=('a dialog freezes the whole page until somebody taps OK: ' + ', '.join(noisy)))

    head('D. The sales pages still show the real screen')
    """Dean, 12 Sep 2026: "Can you double check that the set up guide and the look at a
    night things both have the current look of the screens? Can you do that say once a
    month?"

    There are no screenshots to go stale. It is worse: see-a-night.html and index.html
    draw the screens BY HAND in CSS, under .vps-* names that appear nowhere in tv.html.
    So the real screen can be redesigned completely and both sales pages keep showing
    last month's product for ever, with nothing going red.

    This is the tripwire. It is silent until a real screen's styling changes, and then it
    fails until somebody has looked and run --accept. It cannot tell you they LOOK alike,
    because nothing here renders a pixel. It can only make sure nobody redesigns the
    screen without being asked whether the sales page still matches."""
    tool = os.path.join(ROOT, 'tools', 'check-mockups.py')
    if not os.path.isfile(tool):
        ok('the mockup tripwire exists', False, why='tools/check-mockups.py is missing')
    else:
        r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=120)
        out = re.sub(r'\033\[[0-9;]*m', '', (r.stdout or '') + (r.stderr or ''))
        line = [l.strip() for l in out.splitlines() if l.strip().startswith(('LOOK', '--', 'ok'))]
        ok('no screen has changed since the sales pages were last checked', r.returncode == 0,
           detail=(line[0][:90] if line else 'nothing to say'),
           why='run python3 tools/check-mockups.py, look at /see-a-night beside a real /tv, then --accept')

    # THE DEMO PANELS ARE NOT INSIDE .vp-wrap, so they do not inherit the page's white
    # text. The modal has to set a colour of its own or every element that does not set
    # one renders black on a black console. That is how the VenuePlay wordmark and four
    # game headings came to be invisible on the page every cold email points at, while
    # every tool that reads the DOM reported the text present and correct.
    san = os.path.join(ROOT, 'venueplay', 'see-a-night.html')
    if os.path.isfile(san):
        css = io.open(san, encoding='utf-8').read()
        m = re.search(r'\.vp-modal\s*\{(.*?)\}', css, re.S)
        # STRIP THE COMMENT FIRST. The note explaining this fix contains the words
        # "color:var(--white)", so the first version of this check passed on the strength
        # of its own explanation and stayed green with the declaration deleted. Fourth
        # time this exact trap has been walked into; comments are claims, code decides.
        body = re.sub(r'/\*.*?\*/', ' ', m.group(1), flags=re.S) if m else ''
        ok('the demo panel sets its own text colour',
           bool(m) and re.search(r'(^|[;{\s])color\s*:', body),
           why='see-a-night.html .vp-modal has no color, so anything inside it that does '
               'not set one inherits black onto a black console')

    # CONSENT IS A CHOICE SOMEBODY MAKES, NOT ONE ALREADY MADE FOR THEM. All ten
    # VenuePlay signup pages shipped the marketing box pre-ticked, which is not express
    # consent under the Spam Act and is not an active choice under the Privacy Act.
    # PartyPlay got this right from the start, which is exactly why nobody noticed.
    tick_hits = []
    for f in files:
        if not f.endswith('.html'):
            continue
        text = io.open(f, encoding='utf-8', errors='ignore').read()
        for m in re.finditer(r'<input[^>]*type=["\']checkbox["\'][^>]*>', text, re.I):
            tag = m.group(0)
            if not re.search(r'\bchecked\b', tag, re.I):
                continue
            # SKIP A TAG THAT IS BUILT AT RUN TIME. PartyPlay writes
            #   '<input type="checkbox" id="mkt"' + (saved.mkt ? " checked" : "") + '>'
            # which restores the guest's OWN earlier choice and renders unticked by
            # default. A static scan cannot tell that from a pre-tick, and calling it a
            # breach would be wrong: the browser was checked and the box comes up empty.
            # The fault this guards against is a literal checked in the markup.
            if "' +" in tag or '" +' in tag or '+ \'' in tag:
                continue
            # A pre-ticked box is only a breach when it is CONSENT TO BE CONTACTED.
            # Reading the tag's own attributes is too blunt: the first version of this
            # check failed billing.html's manager permission toggles because one of them
            # is value="players_optin" and "opt" was in the pattern. Ticking a manager's
            # permissions on by default is the owner setting a sensible default, not a
            # consent breach. So read the LABEL a person actually sees.
            said = re.sub(r'<[^>]+>', ' ', text[m.end():m.end() + 260])
            if re.search(r'send me|unsubscribe|marketing|newsletter|news, tips|'
                         r'agree to receive|keep me (posted|updated)', said, re.I):
                tick_hits.append('%s:%d' % (short(f), text[:m.start()].count('\n') + 1))
    ok('no consent box is pre-ticked', not tick_hits, why=', '.join(tick_hits[:4]))
    # AND NOT TICKED FROM A SCRIPT EITHER. The audit of 20 Sep 2026 added
    #   l.querySelector("input").checked = true;
    # under the join screen's opt-in box and the check above stayed green: it reads the
    # markup, and the markup was unticked. So read the script too: any write that ticks a
    # box within reach of a consent box's id or its label is the same breach.
    js_hits = []
    ids = r'(xOptin|vp-marketing|"optin"|\bmkt\b|marketing_optin)'
    for f in files:
        if not f.endswith('.html'):
            continue
        text = io.open(f, encoding='utf-8', errors='ignore').read()
        for m in re.finditer(r'(\.checked\s*=\s*true|\.defaultChecked\s*=\s*true|setAttribute\(\s*["\']checked["\'])', text):
            near = text[max(0, m.start() - 400):m.end() + 120]
            if re.search(ids, near) or re.search(r'send me|marketing|newsletter|keep me (posted|updated)', near, re.I):
                js_hits.append('%s:%d' % (short(f), text[:m.start()].count('\n') + 1))
    ok('no consent box is ticked from a script', not js_hits, why=', '.join(js_hits[:4]))

    # EVERY MERGE TAG IN AN EMAIL THE WORKER SENDS HAS TO BE FILLED IN BY THE WORKER.
    # {{unsubscribe_url}} sat in four templates and nothing anywhere replaced it, so the
    # link in every welcome email was the literal text and a venue clicking it went
    # nowhere. Nothing could see it: the template is valid, the Worker is valid, and the
    # fault only exists in the gap between them.
    #
    # Only the templates the Worker actually LOADS are checked. upcoming-payment.html is
    # referenced nowhere and has never been sent, so holding it to this would be red for
    # a thing that does not happen.
    api = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')
    edir = os.path.join(ROOT, 'venueplay', 'emails')
    if os.path.isfile(api) and os.path.isdir(edir):
        worker = io.open(api, encoding='utf-8', errors='ignore').read()
        # AND STRIP THE WORKER'S COMMENTS, for the third time in one session. The note
        # explaining this very fix quotes {{unsubscribe_url}}, so the first version of the
        # check stayed green with every substitution deleted, on the strength of the
        # sentence describing what used to be wrong. The // pattern spares https:// .
        worker = re.sub(r'/\*.*?\*/', ' ', worker, flags=re.S)
        worker = re.sub(r'(^|[^:])//[^\n]*', r'\1', worker)
        unfilled = []
        for name in sorted(os.listdir(edir)):
            if not name.endswith('.html') or name not in worker:
                continue
            body = io.open(os.path.join(edir, name), encoding='utf-8', errors='ignore').read()
            # STRIP THE COMMENTS FIRST, for the second time today. welcome-group.html
            # documents its per-venue tokens in a note at the top and keeps a commented
            # out copy of the block the Worker generates, so {{venue_monthly}} appears
            # twice and renders never. A check that reads a comment is reading a claim.
            body = re.sub(r'<!--.*?-->', ' ', body, flags=re.S)
            for tag in sorted(set(re.findall(r'\{\{\s*([A-Za-z0-9_.]+)\s*\}\}', body))):
                if tag not in worker:
                    unfilled.append('%s {{%s}}' % (name, tag))
        ok('every merge tag in a live email gets filled in', not unfilled,
           detail='%d template(s) the Worker sends' %
                  len([n for n in os.listdir(edir) if n.endswith('.html') and n in worker]),
           why=', '.join(unfilled[:4]))

    # THE SITE SOLD A FEATURE THE PRODUCT DELIBERATELY REFUSES TO HAVE. All ten pages
    # said bingo cards were "auto-marked". play.html says the opposite twice, on purpose:
    #   "manual play by default: the player dabs their own numbers, we never mark for them"
    #   "It never marks anything. It shows what you have not marked yet and you still tap
    #    every one, which is what the board behind the caller does in a real hall."
    # Dabbing IS bingo, so the product is right and the sales copy was wrong. This is the
    # cheapest possible guard against it drifting back.
    auto_hits = []
    for f in files:
        if not f.endswith('.html'):
            continue
        # A NEGATED MENTION IS FINE and is how this was first found to be wrong in only
        # one direction: the paper-bingo FAQ says what a venue does NOT get, which is
        # honest. Only an unqualified claim is a breach.
        for m in re.finditer(r'auto[\s-]?mark', copy_text(f), re.I):
            before = copy_text(f)[max(0, m.start() - 30):m.start()]
            if re.search(r'\b(no|not|never|without|cannot|lose|lost)\b[^.]*$', before, re.I):
                continue
            auto_hits.append(short(f))
            break
    ok('nothing claims the bingo cards mark themselves', not auto_hits,
       why=', '.join(auto_hits[:4]) + ' (play.html: "we never mark for them")')

    # A FOUNDING PAGE THAT HAS OUTLIVED ITS OWN DEADLINE IS A TRAP, in both directions.
    # The pages are static: nothing on /qld notices 30 September passing. So the morning
    # after, either the Worker still honours QLD-SEP-2026 and the discount runs past the
    # date the page promised it would end, or FOUNDING_CODES has been trimmed and a QLD
    # venue reads $2.50, signs up, and is charged $3 with no error and no explanation.
    # The Worker's own comment says that exact thing has happened before for a different
    # reason. Nothing here could see the date arrive, so this watches the clock.
    import datetime as _dt
    import calendar as _cal
    _MON = {m.upper()[:3]: i for i, m in enumerate(_cal.month_name) if m}
    today = _dt.date.today()
    gone, soon = [], []
    for f in files:
        if not f.endswith('.html'):
            continue
        for code in sorted(set(re.findall(r'\b([A-Z]{2,3})-([A-Z]{3})-(20\d\d)\b', io.open(f, encoding='utf-8', errors='ignore').read()))):
            st, mon, yr = code
            if mon not in _MON:
                continue
            last = _cal.monthrange(int(yr), _MON[mon])[1]
            end = _dt.date(int(yr), _MON[mon], last)
            left = (end - today).days
            tag = '%s-%s-%s on %s' % (st, mon, yr, short(f))
            if left < 0:
                gone.append(tag + ' ended %d days ago' % -left)
            elif left <= 21:
                soon.append(tag + ' ends in %d days' % left)
    ok('no founding page has outlived its own deadline', not gone,
       detail=('; '.join(soon[:3]) if soon else 'none close'),
       why='; '.join(gone[:4]) + '. Update the page AND env.FOUNDING_CODES together')

    # THE PRIVACY PAGE PROMISES PLAYER DATA IS DELETED WITHIN 90 DAYS OF AN ACCOUNT
    # CLOSING, and nothing implements it. The only tables either Worker deletes from are
    # staff, questions, question sets, raffle prizes and discounts, plus a single member
    # row when somebody asks to come off a list. The nightly cron archives a venue, which
    # sets a status and removes nothing.
    #
    # Nothing is overdue yet. The oldest closed venue is 50 days old, so this is green
    # today and red in 40 days unless somebody builds the sweep or changes the page.
    tool = os.path.join(ROOT, 'venueplay-backend', 'tools', 'check-player-retention.py')
    if os.path.isfile(tool):
        r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=120)
        out = ((r.stdout or '') + (r.stderr or '')).strip().splitlines()
        ok('no closed venue is still holding its players', r.returncode == 0,
           detail=(out[0][:88] if out else ''),
           why='the privacy page promises deletion within 90 days and nothing does it: '
               'run venueplay-backend/tools/check-player-retention.py')

    # A CSS VARIABLE USED IN A FILE THAT DOES NOT DEFINE IT kills the whole declaration
    # silently. --ink3 was declared in run.html, host.html and album.html and used, but
    # never declared, in play.html, which is the one a guest holds. The video button
    # rendered as a shadow with an emoji in it and every camera message came out as pale
    # text over the game. Nothing errors, nothing logs, the page just quietly loses a
    # rule. Cheap to check and it covers every page at once.
    var_hits = []
    for f in files:
        if not f.endswith('.html'):
            continue
        text = io.open(f, encoding='utf-8', errors='ignore').read()
        # Comments first, for the FOURTH time today. billing.html carries a note that
        # literally reads "this page does not have: class ghost, var(--card) and
        # var(--dim)", which is a sentence describing a fixed fault, not a use of one.
        clean = re.sub(r'<!--.*?-->', ' ', text, flags=re.S)
        clean = re.sub(r'/\*.*?\*/', ' ', clean, flags=re.S)
        declared = set(re.findall(r'(--[a-zA-Z0-9-]+)\s*:', clean))
        # And a variable the page sets from JavaScript is declared, just not in the CSS.
        # --cz is the bingo card zoom: setProperty("--cz", n) on every pinch.
        declared |= set(re.findall(r'setProperty\(\s*["\'](--[a-zA-Z0-9-]+)', clean))
        for used in set(re.findall(r'var\(\s*(--[a-zA-Z0-9-]+)', clean)):
            if used not in declared:
                var_hits.append('%s %s' % (short(f), used))
    ok('no page uses a CSS variable it never defines', not var_hits,
       why=', '.join(sorted(set(var_hits))[:5]))

    # A PRINTED HANDOUT CANNOT BE UPDATED ONCE IT IS ON A BAR. All four leave-behinds
    # said "Go live 24 August 2026, first payment 24 September 2026", which on 16 Sep
    # promised a go-live date three weeks in the past. A rep hands one over, a publican
    # reads it a fortnight later, and the first concrete thing on it has already expired.
    # A page can carry a date because a page can be edited. A handout cannot, so it may
    # not carry one at all.
    MONTHS = ('January|February|March|April|May|June|July|August|September|October'
              '|November|December')
    hand_hits = []
    for f in files:
        base = os.path.basename(f)
        if not base.startswith('leave-behind') or not base.endswith('.html'):
            continue
        for m in re.finditer(r'\b\d{1,2} (?:' + MONTHS + r')\b', copy_text(f)):
            hand_hits.append('%s "%s"' % (short(f), m.group(0)))
    ok('no printed handout carries a date that can go stale', not hand_hits,
       detail='%d handout(s)' % len([f for f in files
                                     if os.path.basename(f).startswith('leave-behind')
                                     and f.endswith('.html')]),
       why=', '.join(hand_hits[:4]) + '. Say "the day you sign up", not a date')

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

    # A TERNARY WHOSE TWO ARMS ARE THE SAME STRING decides nothing, and it is
    # always a half-finished thought rather than a deliberate one. The photos
    # game carried `right.length===1 ? " got it" : " got it"` for its whole
    # life, so the plural it was reaching for never happened and a round nobody
    # got read "0 got it" on the wall in front of the room. Nothing else in the
    # repo can see this: it parses, it runs, and it prints a sentence.
    tern = re.compile(r'\?\s*(".*?"|\'.*?\')\s*:\s*(".*?"|\'.*?\')')
    tern_hits = []
    for f in files:
        if not (f.endswith('.html') or f.endswith('.js')):
            continue
        text = io.open(f, encoding='utf-8', errors='ignore').read()
        for m in tern.finditer(text):
            if m.group(1) == m.group(2):
                tern_hits.append('%s:%d' % (short(f), text[:m.start()].count('\n') + 1))
    ok('no ternary picks between two identical strings', not tern_hits,
       why=', '.join(tern_hits[:4]))

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

    """AND ITS STAMP HAS TO BE THE STAMP OF WHAT IS IN IT.

    A Worker is deployed by pasting, so /health's BUILD line is the only way to
    answer "is my fix live". That answer is worth nothing if the line can be
    stale. This morning it was: the venue-code fix went into venueplay-game.js
    and stamp-workers.py was never run, so the file Dean pasted carried the
    PREVIOUS build's fingerprint. He pasted the right code, /health reported the
    old id, and neither of us could tell from outside whether it had landed. The
    gate was green through all of it, because nothing here compared the stamp to
    the bytes underneath it.

    stamp-workers.py already computes that hash. It just was not asked."""
    try:
        sys.path.insert(0, os.path.join(ROOT, 'tools'))
        import stamp_workers as _sw
    except Exception:
        _sw = None
    if _sw is None:
        try:
            import importlib.util as _ilu
            _spec = _ilu.spec_from_file_location('stamp_workers', os.path.join(ROOT, 'tools', 'stamp-workers.py'))
            _sw = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_sw)
        except Exception as e:
            _sw = None
            ok('the stamp tool can be asked', False, str(e)[:60],
               why='without it nothing can compare a Worker stamp to its own contents')
    if _sw is not None:
        for rel in getattr(_sw, 'WORKERS', []):
            f = os.path.join(ROOT, rel)
            if not os.path.isfile(f):
                continue
            src = io.open(f, encoding='utf-8').read()
            want = _sw.FOR_HASH.sub('', src)
            digest = hashlib.sha256(want.encode('utf-8')).hexdigest()[:8]
            got = _sw.STAMP.search(src)
            got = got.group(1) if got else None
            ok('%s carries its own fingerprint' % os.path.basename(rel),
               got == digest,
               (got or 'no stamp at all'),
               why='the file hashes to %s and the stamp says %s, so /health would report a '
                   'build that is not the one running. Run tools/stamp-workers.py.'
                   % (digest, got or 'nothing'))

    """THE ROOM SERVER COPY IN THE GAME WORKER IS THE ROOM SERVER.

    A Cloudflare Worker is one file, so the Durable Object class lives twice: in
    venueplay-room.js, where its test can reach it, and inside venueplay-game.js,
    where it actually runs. That is the exact shape of nearly every real fault in
    this codebase (esc, drawQR, tvSend): one copy fixed, the other left standing.
    So the two are compared here byte for byte, ignoring the named-export line
    that only the test needs. Fix venueplay-room.js, run its test, re-copy."""
    room = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-room.js')
    game = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-game.js')
    if os.path.isfile(room) and os.path.isfile(game):
        rsrc = io.open(room, encoding='utf-8').read()
        gsrc = io.open(game, encoding='utf-8').read()
        want = re.sub(r'\nexport \{[^}]*\};\s*$', '\n', rsrc).strip()
        # FIND THE COPY BY ITS FIRST LINE OF CODE, not by the last comment before the
        # class. This used to walk back to the nearest '/* ' and call that the start,
        # which held only while no comment sat between ROOM_MAX_MSG_CHARS and the class.
        # On 10 Sep one did (a note about the host rate cap), the slice began in the
        # wrong place, and the check reported the two copies as different when they were
        # identical. A check that a comment can break is a check somebody will weaken.
        i = gsrc.find('export class VenueRoom')
        start = want.find('const ROOM_MAX_MSG_CHARS')
        cstart = gsrc.find('const ROOM_MAX_MSG_CHARS')
        copy = gsrc[cstart:].strip() if cstart >= 0 else ''
        cstart = 0 if cstart >= 0 else -1
        ok('the room server in the game Worker matches venueplay-room.js',
           i > 0 and start >= 0 and cstart >= 0 and copy[cstart:] == want[start:],
           'wired' if i > 0 else 'not wired into the game Worker yet',
           why='the class runs from venueplay-game.js and is tested from '
               'venueplay-room.js, so a fix made in one and not the other is a fix '
               'that did not happen. Re-copy the file under the ROOM SERVER banner.')

    head('D. Every link in an email goes somewhere that exists')
    """A LINK IN AN EMAIL IS FOLLOWED BY SOMEBODY WE CANNOT WATCH.

    The Unsubscribe link in every PartyPlay follow-up was built as SITE_ORIGIN +
    "/unsubscribe", and the handler that does the work is on the WORKER. Cloudflare
    Pages answers a path it does not have with the homepage and a 200, so the
    recipient pressed Unsubscribe, landed on a page selling them PartyPlay, and
    nothing was recorded anywhere. pp_subscribers.unsubscribed_at could never be set
    by a recipient, and the opt-out check that reads it was guarding nothing. Under
    the Spam Act a working unsubscribe is not optional.

    Nothing could catch that: check-links.py reads the PAGES, and this link is
    assembled inside the Worker out of an environment variable and a string. So the
    Worker is read the same way: every path an email sends a person to has to be a
    file this site actually serves.

    The second half is the one that let it happen twice. The expiry reminder had no
    unsubscribe link AT ALL, so the roster of senders is closed: a new one fails
    this check until somebody says which kind it is.
    """
    wsrc_p = os.path.join(PARTYPLAY_BACK, 'worker', 'SOURCE-do-not-paste-partyplay-api.js')
    if which in ('both', 'partyplay') and os.path.isfile(wsrc_p):
        wsrc = io.open(wsrc_p, encoding='utf-8').read()

        def serves(path):
            """Would Cloudflare Pages have a file for this path, really."""
            rel = path.lstrip('/')
            if not rel:
                rel = 'index.html'
            cand = [rel]
            if '.' not in os.path.basename(rel):
                cand = [rel + '.html', os.path.join(rel, 'index.html')]
            return any(os.path.isfile(os.path.join(PARTYPLAY_SITE, c)) for c in cand)

        # site is always SITE_ORIGIN with the trailing slash taken off, so every
        # link an email carries is written as: site + '/something'
        # The closing double quote of an HTML attribute lives INSIDE the JavaScript
        # string, so href="' + site + '/setup" captured /setup" and read as a missing
        # page. The first pass of this check reported two of those, and a check that
        # cries wolf on a file that is sitting right there is one nobody reads.
        linked = sorted(set(re.findall(r"""site \+ '(/[^'?"\s]*)""", wsrc)))
        # A scan that finds nothing must never pass. Every email has a logo and a
        # button in it, so an empty reading means the pattern stopped matching.
        ok('the email links could be read at all', len(linked) >= 3,
           '%d link(s): %s' % (len(linked), ', '.join(linked[:6])),
           why='no "site + \'/...\'" links were found in the Worker at all, which '
               'means this check is reading the wrong thing, not that the emails '
               'have no links in them')
        for path in linked:
            ok('an email links to %s' % path, serves(path),
               why='partyplay/ has no file for it, so Cloudflare Pages answers the '
                   'HOMEPAGE with a 200 and the person who pressed it sees an advert '
                   'instead of whatever they asked for')

        # Marketing goes to somebody who is not waiting for it, so it carries a way
        # to stop it. A receipt and an album link do not: they are the thing that
        # was bought and the thing that was asked for at the party.
        MARKETING = {'sendFollowupEmail': 'the "how was the party" follow-up',
                     'sendNudgeEmail': 'the reminder about an unused code'}
        ASKED_FOR = {'sendLicenceEmail', 'sendAlbumEmail'}
        # sendEmail is the one door all four go through, not a message of its own.
        NOT_A_SENDER = {'sendEmail'}
        senders = re.findall(r'async function (send\w*Email)\(', wsrc)
        senders = [n for n in senders if n not in NOT_A_SENDER]
        unknown = [n for n in senders if n not in MARKETING and n not in ASKED_FOR]
        # A COUNT OF ZERO IS NOT A PASS. If the pattern stops matching, every
        # sender becomes invisible and "none of them is unjudged" is true and
        # worthless. Four are known to be there, so fewer than four is the check
        # failing to read, not the Worker having fewer emails.
        ok('every email sender has been judged marketing or not',
           not unknown and len(senders) >= 4,
           '%d sender(s)' % len(senders),
           why=('new sender(s) %s: decide whether it goes to somebody who asked for '
                'it. If it does not, it needs an unsubscribe link and the opt-out '
                'check, and either way add it to this list in tools/release-check.py'
                % ', '.join(unknown)) if unknown else
               ('only %d email sender(s) were found in the Worker and there are at '
                'least four, so this check is no longer reading them' % len(senders)))
        for name, what in sorted(MARKETING.items()):
            m = re.search(r'async function ' + name + r'\(.*?\n\}\n', wsrc, re.S)
            body = m.group(0) if m else ''
            ok('%s can be stopped' % what, "/unsubscribe?e=" in body,
               why='%s does not put an unsubscribe link in the email it sends. That '
                   'is a Spam Act problem, not a nicety' % name)

    # A VENUE ADDED TO A PAYING ACCOUNT GETS ITS FIRST MONTH FREE, AND THIS RUNS IT.
    #
    # Dean, 17 Sep 2026. Until that day a venue added while the account was inside its own
    # free month rode that month for nothing, while a venue added by a PAYING account was
    # charged a full month the instant the owner clicked Add. So expanding cost a group
    # money on the day they decided to do it.
    #
    # This is not a source read. tools/test-add-venue-free-month.js CALLS vpbAddVenue with
    # the network helpers replaced and vpbAdjustPlayerBilling, vpbRateStrict and
    # vpbYearFractionLeft left real, and asserts the money: one month charged and one month
    # credited on monthly, pro rata charged and one month credited on annual, and NOTHING
    # credited in the three cases where crediting would be giving money away (still in the
    # free month, the charge was refused, the rate is unknown). Proved against three
    # mutations on the day it was written; all three went red.
    if which in ('both', 'venueplay'):
        head('D. A venue added to a paying account gets its first month free')
        t = os.path.join(ROOT, 'tools', 'test-add-venue-free-month.js')
        if not os.path.isfile(t):
            ok('the add-venue free month test exists', False,
               why='tools/test-add-venue-free-month.js is missing, so nothing is checking '
                   'that adding a venue still credits the month back')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('adding a venue charges a month and credits it straight back (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-add-venue-free-month.js. Either the credit stopped '
                   'happening, which means groups are being charged to expand, or it started '
                   'happening where it should not, which is money given away')

    # SIGNING UP: THE FREE MONTH, AND ONE BILL PER PERSON.
    #
    # Three faults found on 17 Sep 2026, all of which reached Stripe:
    #   - one email could open a SECOND subscription, and because vpbRequireOwner resolves an
    #     account from venues[0].founding_id the duplicate never appeared on their billing page,
    #     so they could not cancel the thing they were being charged for
    #   - anyone who had ever held an account got a 3-day trial while every page on the site
    #     promised a free month, so a venue coming back after two years was charged in three days
    #   - checkout stopped pricing off the postcode, and the card link and the HQ welcome email
    #     did not, so a Queensland venue we onboarded by hand paid $3.00 while the identical one
    #     that signed itself up paid $2.50. That is the SECOND time those two paths have been
    #     left behind by a pricing change; see the comment above vpaFoundingStateOk.
    #
    # The test RUNS handleCheckout and vpaFireHqWelcome with only global fetch replaced, so the
    # real query, the real trial arithmetic and the real form sent to Stripe are all exercised,
    # and it reads the assertions back out of that form. Proved against four mutations.
    if which in ('both', 'venueplay'):
        head('D. Signing up: the free month, and one bill per person')
        t = os.path.join(ROOT, 'tools', 'test-checkout-trial-and-duplicates.js')
        if not os.path.isfile(t):
            ok('the signup billing test exists', False,
               why='tools/test-checkout-trial-and-duplicates.js is missing, so nothing is '
                   'checking that one email cannot open two subscriptions')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('one email, one bill, and the promised free month (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-checkout-trial-and-duplicates.js. This guards money at '
                   'the front door: a duplicate subscription the venue cannot see to cancel, a '
                   'charge landing three days after we promised a free month, or two prices for '
                   'the same venue depending which link they came through')

    # ASKING US TO STOP HAS TO ACTUALLY STOP US.
    #
    # Found 17 Sep 2026. Unsubscribing WORKED: /unsubscribe wrote a row to vp_unsubscribes and a
    # live test landed one. Then nothing anywhere read it. Not the venue marketing export, and not
    # the outreach tools either, despite a comment in the Worker saying the outreach tools did. So
    # a venue could click unsubscribe in one of our emails and appear on the very next list we used
    # to market to them. That is the Spam Act, and it is the only fault on this platform that
    # carries a fine rather than an apology.
    #
    # The test RUNS vpaHandleVenueMarketingExport with only global fetch replaced, so the real
    # query, the real matching and the real CSV are exercised. It also checks the export FAILS
    # CLOSED: vpaSelect answers [] for any non-2xx, so a database wobble would otherwise read as
    # "nobody has ever unsubscribed" and hand over every one of them. Proved against four
    # mutations, including failing open and matching case-sensitively.
    if which in ('both', 'venueplay'):
        head('D. Asking us to stop actually stops us')
        t = os.path.join(ROOT, 'tools', 'test-unsubscribe-is-honoured.js')
        if not os.path.isfile(t):
            ok('the unsubscribe test exists', False,
               why='tools/test-unsubscribe-is-honoured.js is missing, so nothing is checking that '
                   'an opt-out keeps people off the marketing list')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('an unsubscribe keeps them off the marketing list (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-unsubscribe-is-honoured.js. This is the Spam Act one: '
                   'marketing to somebody who has withdrawn consent is the single fault here that '
                   'costs money in a fine rather than an apology')

    # A VENUE ONLY KEEPS WHAT IT AGREED TO KEEP, WHICHEVER DOOR THE PLAYER CAME THROUGH.
    #
    # Found 17 Sep 2026. There were two doors and only one asked. /capture read vp_venue_settings
    # and wrote only the fields a venue had switched on. /join read the settings NOT AT ALL and
    # assigned the request straight onto the player row. The join screen only renders enabled
    # fields, so nothing looked wrong, but the screen is not the gate: a crafted POST wrote an
    # email, a mobile, a postcode and a marketing_optin WITH a consent timestamp for a venue that
    # collects none of it. That walks straight round migration 43/82, which exists to stop an
    # account harvesting a room unless its contact domain reads like a real venue.
    #
    # Both doors now call one gatedCapture(). The test RUNS it out of the shipped Worker and
    # checks it fails CLOSED: sbGet answers [] on any non-2xx, so a database wobble must mean
    # "collect nothing", never "collect everything". Proved against four mutations.
    if which in ('both', 'venueplay'):
        head('D. A venue only keeps the player data it agreed to keep')
        t = os.path.join(ROOT, 'tools', 'test-collection-gate.js')
        if not os.path.isfile(t):
            ok('the collection gate test exists', False,
               why='tools/test-collection-gate.js is missing, so nothing is checking that a join '
                   'cannot write player data a venue never switched on')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('no join can write player data the venue never switched on (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-collection-gate.js. Player contact data ranks with billing '
                   'and the games working, and a fault here does not look like a fault: nothing '
                   'breaks and a room full of people are simply on a list nobody agreed to')

    # WHAT A MANAGER GETS WHEN NOBODY SAID.
    #
    # vpbCan is `!o.perms || o.perms[key] !== false`, so an ABSENT permission reads as GRANTED,
    # and both places that normalise a permissions object wrote players_optin the same generous
    # way. Right for advertising, raffles and adding hosts: reversible, worst case a changed promo
    # slide. Wrong for a venue's customer list, where the worst case is a duty manager or a
    # travelling host walking off with a room full of contact details and nobody noticing, because
    # nothing breaks. Dean, 17 Sep 2026: player data ranks with money and the games working.
    #
    # The test pulls EVERY permissions normaliser out of the Worker by shape and runs them all, so
    # fixing one copy and leaving the other goes red. That half-fix is this repo's oldest failure
    # mode and the mutation run proves this check catches it.
    if which in ('both', 'venueplay'):
        head('D. A manager is not handed the customer list by default')
        t = os.path.join(ROOT, 'tools', 'test-manager-permissions.js')
        if not os.path.isfile(t):
            ok('the manager permission test exists', False,
               why='tools/test-manager-permissions.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('player-data permission needs an explicit tick, in every copy (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-manager-permissions.js. An absent permission must not '
                   'grant a manager a venue customer list')

    # NEVER COLLECT WHAT YOU WILL NOT HAND BACK.
    #
    # Two gates asked the same question with two different word lists: collecting is gated on the
    # contact EMAIL DOMAIN (migration 43, widened by 82), exporting was gated on the VENUE NAME
    # with a shorter list. Eleven words were on one and not the other, so The Mini Bar could
    # collect its customers' details on its own domain and was then refused its own list back. We
    # hold their data and will not give it to them, which reads as keeping it deliberately.
    #
    # The test lifts the real regexes AND the real decision line out of the Worker, and reads
    # migration 82's word list straight out of the SQL, so the two cannot drift again. It also
    # pins the anchoring SPLIT: migration 82 leaves the original words loose on purpose and
    # anchors only the new ones, and an export gate stricter than the collection gate is the same
    # fault in the other direction.
    if which in ('both', 'venueplay'):
        head('D. Never collect what you will not hand back')
        t = os.path.join(ROOT, 'tools', 'test-optin-export-gate.js')
        if not os.path.isfile(t):
            ok('the opt-in export gate test exists', False,
               why='tools/test-optin-export-gate.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('anything a venue may collect, it may also download (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-optin-export-gate.js. If you change the words in one gate, '
                   'change them in the other: venueplay-backend/supabase/venueplay-82-*.sql and '
                   'VPA_VENUE_WORDS_LOOSE/ANCHORED in the Worker')

    # AN OPT-IN A VENUE CANNOT SEE MUST BE ONE A VENUE IS TOLD ABOUT.
    #
    # Broadcast bingo has no session, so a capture arriving without a player token cannot be
    # vouched for and is stored, marked during_game false, and left out of v_vp_player_optins.
    # That exclusion is correct and stays: an unverifiable opt-in is a Spam Act problem for the
    # VENUE. What was wrong is that nobody was told. The venue collected details, somebody really
    # consented, and the list simply did not contain them. As at 17 Sep 2026, 9 of 30 captures
    # arrive with no token, so it is about a third of them the day a venue switches collection on.
    if which in ('both', 'venueplay'):
        head('D. A venue is told what its opt-in list is not showing')
        t = os.path.join(ROOT, 'tools', 'test-optin-held-back.js')
        if not os.path.isfile(t):
            ok('the held-back opt-in test exists', False, why='tools/test-optin-held-back.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('held-back opt-ins are counted and reported, never silent (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-optin-held-back.js. A venue that collected details and '
                   'sees an empty file concludes the product does not work')

    # A FAILED PAGE MUST NOT READ AS THE END OF THE LIST.
    #
    # vpaSelectAll was built on vpaSelect, which returns [] on any non-2xx. A paging loop reads
    # [] as "no more pages", so one transient Supabase error halfway through an opt-in export
    # handed the venue a SHORT copy of its own customer list and reported success. Proved on
    # 18 Sep against the old code: a failure on page two returned 1000 rows out of 2500 and the
    # export said count=1000. The empty file this replaced was at least noticeable. A wrong one
    # is not. Player data is tier one.
    if which in ('both', 'venueplay'):
        head('D. A failed page is not the end of the list')
        t = os.path.join(ROOT, 'tools', 'test-optin-fails-closed.js')
        if not os.path.isfile(t):
            ok('the fail-closed paging test exists', False,
               why='tools/test-optin-fails-closed.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a failed page throws instead of truncating the export (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-optin-fails-closed.js. A short customer list with no '
                   'error is worse than no list at all: nobody questions it')

        # AN ARCHIVED VENUE MUST LET GO OF THE HOST.
        #
        # Dean, 18 Sep: "the GFLAM group has the Mini Bar loaded but says the games are on
        # hold at the moment again." A fix shipped that morning and did not fix it, because
        # pickVenue() only ever had venue IDS and vp_venue_staff comes back UNORDERED: when
        # the archived venue happened to sit first, the host landed right back on it. Same
        # user, same data, different outcome depending on Postgres row order. The same fix
        # also broke HQ "View as", because hq.html stores an id then NAVIGATES, so a
        # deliberate choice arrived looking exactly like a restore.
        #
        # This suite runs the SHIPPED vp-session.js and controls the staff-row order, which
        # is the whole bug. Every check here was watched go red against the broken build.
        # A FAILED READ MUST NOT PUT A VENUE IN THE DARK.
        #
        # The nightly sweep decides "have they played since they cancelled?" from two
        # reads, and they used vpaSelect, which returns [] on ANY non-2xx. One 503 at
        # 3:30am and every cancelling venue read as "never played again" and was switched
        # off. The reads were also unpaged over 90 days across every venue. Reverting to
        # the old code archives the test venue in both cases, which is what these checks
        # were watched doing before the fix.
        # OUR OWN CHECKS MUST NOT BE COUNTED AS VISITORS.
        #
        # verify-live.py drives a REAL browser through three live pages every run and waits
        # forty seconds on each. GA4 filters known spiders; it cannot filter us, and to it
        # that is the most engaged visitor of the day. vp-analytics.js drops the tag when
        # navigator.webdriver is set, which travels with the robot rather than with an IP.
        head('D4. Analytics ignores our own robots')
        t = os.path.join(ROOT, 'tools', 'test-analytics-ignores-robots.js')
        if not os.path.isfile(t):
            ok('the analytics robot-guard test exists', False,
               why='tools/test-analytics-ignores-robots.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a real visitor is counted, an automated browser is not (%d checks)' % n,
               r.returncode == 0 and n > 0 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-analytics-ignores-robots.js. Our own live checks '
                   'inflating the numbers makes every marketing decision off them wrong')

        # A club over 1,000 members saw the first 1,000 on the host console and nothing
        # said so. PostgREST stops there silently. The DRAW was always right, because it
        # runs server side, which is what hid this: the console lied while the draw was
        # correct, so there was no reason to doubt either.
        head('D5. The members console shows every member')
        t = os.path.join(ROOT, 'tools', 'test-members-paged.js')
        if not os.path.isfile(t):
            ok('the member paging test exists', False,
               why='tools/test-members-paged.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a club past 1,000 members sees all of them (%d checks)' % n,
               r.returncode == 0 and n > 0 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-members-paged.js. A member the host cannot see '
                   'is a member who cannot be drawn, and the screen gives no hint')

        # A PAGED READ WITH NO ORDER IS NOT STABLE. Postgres makes no promise about row
        # order without one, so LIMIT/OFFSET across pages can repeat a row and skip
        # another. Eight of the fourteen sbGetAll calls had no order on 19 Sep, including
        # the vp_cards, vp_players and vp_games reads that feed the who-played counter,
        # which is what BILLS a venue. A skipped row there is a player who was never
        # counted, and nothing anywhere would have said so.
        # Sixteen handlers did a bare `await request.json()`. That rejects on a
        # malformed body, and the top-level catch turned it into a 500 "Something went
        # wrong": reads as our fault, says nothing, and it is almost always our own
        # front end sending the bad body.
        # The draw filters parked_at=is.null, so a parked question can never come up,
        # but retagSetCount counted them anyway. "General Knowledge" advertised 1,169
        # questions to a host when 1,158 were playable.
        # listVenues is the venue list behind HQ and behind the venue picker on every
        # console, and it was unpaged. At a thousand venues HQ stops showing the ones
        # past it, silently: the same fault sbGetAll's header describes, where venues
        # past the ceiling resolved to nothing and their screens said "not linked to
        # an account".
        # The 90-day purge has NO UNDO. Until 20 Sep 2026 the HQ status handler never
        # stamped closed_at on archive (players kept for ever) and never cleared it on
        # reactivation (a live customer one failed card away from the 3am purge).
        # The group welcome went out with a raw {{VENUE_BLOCKS}} tag and no venues, and every
        # welcome handed over a bare /tv link naming no venue. Both on a customer's first day.
        # Three things that FAILED OPEN: unreadable manager permissions read as owner, a
        # player-typed formula ran in the venue's spreadsheet, the contact form had no limits.
        # Rated CRITICAL by the audit of 20 Sep 2026. A winner's "You won, show the host"
        # screen was wiped inside thirty seconds by ordinary heartbeat traffic, and the BINGO
        # button came back to life on a finished game. The fault lives BETWEEN the console and
        # the phone page, so this runs the two REAL pages against each other.
        # One wifi blip deafened four of the five game screens for the rest of the night: the
        # retry re-subscribed the SAME channel object, which supabase-js forbids, so it threw
        # inside its own timer and never tried again.
        # D17: members-draw resolve took the winner from the request, its duplicate test was a
        # stopwatch that was wrong both ways, and a raffle reload re-armed a claimed prize.
        # Two money faults from the audit of 20 Sep 2026 that nothing ran. "Keep this venue"
        # wrote the venue ACTIVE before Stripe agreed and rolled back only one of the fields,
        # and a Stripe event that threw was answered "already handled" on its retry, so a paid
        # signup got no venue and Stripe stopped asking.
        # D21: one reveal made every phone in the room pull its score in the same instant, four
        # database trips each: 160 calls in a second from one 40 player room.
        head('D21. One reveal is not 160 database calls')
        t = os.path.join(ROOT, 'tools', 'test-score-pull-is-shared.js')
        if not os.path.isfile(t):
            ok('the score pull test exists', False, why='tools/test-score-pull-is-shared.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120, cwd=ROOT)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a room shares one leaderboard read, and nobody sees another question\'s numbers',
               r.returncode == 0 and n >= 11 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-score-pull-is-shared.js. The gateway sustains about 50 calls a '
                   'second for the whole platform; two rooms revealing together stalled every venue')
        phone = io.open(os.path.join(ROOT, 'venueplay', 'app', 'trivia', 'play.html'), encoding='utf-8').read()
        a = phone.find('function showResult(')
        b = phone.find('\n  // ---- win celebration', a)
        body = phone[a:b] if a >= 0 and b > a else ''
        ok('the phones do not all ask in the same instant, and say which question they mean',
           bool(body) and 'Math.random()' in body and 'setTimeout(function(){' in body
           and '"&q="' in body and '&last=0' in body
           and body.find('setTimeout(function(){') < body.find('playerGet(_url)'),
           why='venueplay/app/trivia/play.html showResult() must stagger its /player/score pull and '
               'send &q=. Without the stagger every phone misses the warm copy together')

        # D25: two pieces of customer copy that were simply wrong, both found by the audit of
        # 20 Sep 2026. Ten sales pages said extra players "just join at the same per-player rate"
        # when they are $2 a head for the night, and the live contract's clause 2 had lost its
        # subject when the word "founding" was deleted from it: "2. offer" and " pricing is
        # offered by invitation".
        head('D25. What we promise on the sales pages and in the Terms is what we charge')
        import glob as _glob
        pages = sorted(_glob.glob(os.path.join(ROOT, 'venueplay', '*.html')))
        wrong = [os.path.basename(f) for f in pages
                 if 'same per-player rate' in io.open(f, encoding='utf-8').read()]
        ok('no page says extra players join "at the same per-player rate" (%d pages read)' % len(pages),
           len(pages) >= 10 and not wrong, detail=', '.join(wrong[:5]),
           why='extras are $2 each for that night, host approved. The plan rate is per MONTH')
        terms = io.open(os.path.join(ROOT, 'venueplay', 'terms.html'), encoding='utf-8').read()
        starts = re.findall(r'<(?:h2|p)[^>]*>\s*(?:\d+\.\s*)?([a-z][a-z]+)', terms)
        ok('no heading or paragraph of the Terms starts with a lower-case word',
           len(re.findall(r'<h2', terms)) >= 8 and not starts, detail=', '.join(starts[:4]),
           why='a sentence that starts in lower case in a contract has had its subject deleted. '
               'Clause 2 read "2. offer" and " pricing is offered by invitation" for four days')

        # D26: the privacy policy described a product that collects "a name only". It also holds
        # every club member's name, a device identifier and a hashed IP on every player, pointed
        # at the Cookies section for its contact address, and promised a removal button that
        # does not exist. Audit, 20 Sep 2026.
        head('D26. The privacy policy describes what is actually collected')
        pol = io.open(os.path.join(ROOT, 'venueplay', 'privacy.html'), encoding='utf-8').read()
        heads = re.findall(r'<h2[^>]*>\s*(\d+)\.\s*([^<]+)', pol)
        contact = [n for n, t in heads if 'contact' in t.lower()]
        cited = set(re.findall(r'address in section (\d+)', pol))
        ok('every "address in section N" points at the section that is really Contact us',
           bool(contact) and bool(cited) and cited == set(contact),
           detail='cites %s, Contact us is %s' % (sorted(cited), contact),
           why='privacy.html sent people to the Cookies section for our address')
        ok('it discloses members lists, the browser identifier and the hashed address, and never says "a name only"',
           'Members lists' in pol and 'random identifier' in pol and 'hashed' in pol and 'name only' not in pol,
           why='the join handler stores device_id and ip_hash on every player, and a members import '
               'stores a name for people who never open VenuePlay. The policy has to say so')
        ok('it does not promise that a venue can remove a player itself, which no screen can do',
           'the venue can remove them from its list' not in pol,
           why='there is no remove-a-player control. Until there is, the policy says we do it')

        # D30: the audit replaced the money suite with one line that printed ALL 0 CHECKS PASSED
        # and the gate stayed green; it added a failing suite nobody wired in and the gate stayed
        # green. This does not trust what a suite says: it runs every one and counts.
        head('D30. No suite has been gutted, shrunk, deleted or added unseen')
        t = os.path.join(ROOT, 'tools', 'check-suite-ledger.py')
        if not os.path.isfile(t) or not os.path.isfile(os.path.join(ROOT, 'tools', 'suite-counts.json')):
            ok('the suite ledger and its checker exist', False, why='tools/check-suite-ledger.py or tools/suite-counts.json is missing')
        else:
            r = subprocess.run([sys.executable, t], capture_output=True, text=True, timeout=900, cwd=ROOT)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            m = re.search(r'(\d+) suites ran (\d+) checks', out)
            ok('every suite still runs at least the checks the ledger recorded',
               r.returncode == 0 and not bad and bool(m) and int(m.group(1)) >= 100,
               detail=('; '.join(b[:120] for b in bad[:3]) if bad else (m.group(0) if m else out[-120:])),
               why='run python3 tools/check-suite-ledger.py. If a suite was shrunk ON PURPOSE, run it '
                   'with --update and commit the ledger: the diff is the record that it was a decision')

        # D24: HQ said "Screen ok" about a screen that had been silent for 29 hours, because the
        # page never refreshed. Dean found it by asking "is that right?", 21 Sep 2026.
        head('D24. HQ does not keep saying "Screen ok" about a screen that has gone quiet')
        hq = io.open(os.path.join(ROOT, 'venueplay', 'app', 'hq.html'), encoding='utf-8').read()
        a = hq.find('function refreshScreens(')
        body = hq[a:hq.find('function loadAll(', a)] if a >= 0 else ''
        ok('the screen badges are re-read every minute, and say so when they cannot be',
           bool(body) and 'setInterval(refreshScreens, 60000)' in body and 'visibilitychange' in body
           and 'S._screenBadge(' in body and 'unknown()' in body and 'data-screenbadge' in hq
           and "screen_seen_at" in body,
           why='venueplay/app/hq.html must refresh [data-screenbadge] from vp_venues.screen_seen_at on '
               'a timer, with the SAME screenBadge() judgement, and paint "unknown" on a failed read')

        # D19 and D20: the audit made five careless edits to a Worker, one at a time, and the
        # whole local gate stayed green for every one of them.
        head('D20. A host route cannot lose its staff check, nor a draw its generator')
        t = os.path.join(ROOT, 'tools', 'check-worker-guards.py')
        if not os.path.isfile(t):
            ok('the worker guards check exists', False, why='tools/check-worker-guards.py is missing')
        else:
            r = subprocess.run([sys.executable, t], capture_output=True, text=True, timeout=120, cwd=ROOT)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('every host route checks the login and the venue, draws use crypto, big tables are paged',
               r.returncode == 0 and n >= 40 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run python3 tools/check-worker-guards.py. Any signed-in host drawing any '
                   'venue\'s raffle, or a draw on Math.random, ships with a green gate otherwise')

        for label, fn, title, floor, why in (
            ('D34. A login with venues on two accounts can reach both, and nobody else\'s',
             'test-two-accounts-one-login.js',
             'naming a venue you hold picks its account; naming one you do not changes nothing', 14,
             'A publican who signed up two pubs separately was shown the older account on every '
             'call with no way to the other; the fix must not let a stranger\'s venue id in'),
            ('D33. Add from library deals from the whole bank, never a parked question',
             'test-library-pull-reaches-the-whole-bank.js',
             'ten weeks of "add 20" reach past the first hundred rows, and no parked question is dealt', 6,
             'A venue pulling General Knowledge every week was drawing from the same 100 questions '
             'out of thousands, and a question pulled for a fact-check was still being dealt'),
            ('D32. A marketing login cannot run a game',
             'test-marketing-cannot-run-games.js',
             'the staff check names its roles, in the Worker and in the database alike', 10,
             'A marketing login has a staff row at the venue. If any row counts as staff, somebody '
             'from an outside agency can call a bingo ball or draw a raffle'),
            ('D31. A marketing login sees numbers, and player details only if the owner ticked the box',
             'test-marketing-login.js',
             'a marketing login is refused by every owner route and sees no player it was not given', 38,
             'In this Worker an access object with no permissions reads as the OWNER. One careless '
             'guard and a marketing login has billing, hosts and every player\'s details'),
            ('D29. A player who asks to be removed is removed, and a venue holding a copy is told',
             'test-remove-a-player.js',
             'removal blanks exactly that person, and emails only a venue that downloaded them', 26,
             'The privacy policy promises this. A near miss deleted, a venue not told about the copy '
             'in its mailing tool, or the address kept in the audit trail, all break that promise'),
            ('D28. Only housie is told to play on paper',
             'test-paper-is-for-bingo-only.js',
             'the paper flag is set for bingo in SA, ACT and TAS and for nothing else', 8,
             'A trivia or musical bingo player in Adelaide has their phone blanked, or the Worker '
             'and the phone page disagree about it again'),
            ('D27. A signup that had to be resumed is still welcomed, once',
             'test-welcome-is-sent-once.js',
             'the welcome email goes out on whichever run finishes provisioning, and never twice', 8,
             'A paying customer gets a working account and silence, and we never hear about the signup'),
            ('D23. One network blip does not leave the venue TV re-joining for ever',
             'test-tv-does-not-flap.js',
             'after a blip the TV settles on four channels and stops', 11,
             'Two re-joins a second per screen, all night, each one a short gap of deafness, '
             'and nothing on the wall to say so'),
            ('D22. Nobody on the bingo channel can speak for somebody else\'s phone',
             'test-phones-cannot-be-impersonated.js',
             'a forged join, claim or leave for another player is dropped by the bingo console', 34,
             'Any stranger could rename a player, shout BINGO on her ticket, or wipe the room\'s '
             'tickets mid game, from anywhere, with a browser console'),
            ('D19. A captured Stripe event stops working after five minutes',
             'test-stripe-signature-expires.js',
             'an old or altered Stripe signature is refused', 10,
             'One captured invoice.paid replayed for ever keeps a suspended venue switched on'),
            ('D18. A free game is told its own state\'s rules, not "no licence anywhere"',
             'test-free-entry-rules-are-the-states-own.js',
             'the free-entry popup shows each state its own prize thresholds', 24,
             'A club runs a $12,000 members jackpot in NSW on our written say-so that a free '
             'game needs no licence anywhere and has no prize limit'),
            ('D17. The record of a draw says what the draw did, not what the console says',
             'test-draws-keep-an-honest-record.js',
             'a draw record cannot be rewritten by a stale tablet, a repeat tap or a reload', 18,
             'A members jackpot recorded against the wrong member, or a claimed raffle prize '
             'rewritten to no-show with a second ticket drawn, in a regulated game of chance'),
            ('D16. A Stripe event that failed is run again, not waved away',
             'test-webhook-retry-is-not-dropped.js',
             'only a FINISHED Stripe event is answered 200; a failed one is retried', 10,
             'A 200 tells Stripe never to send it again. Paid, no venue, and nothing says so'),
            ('D15. A refused "Keep this venue" leaves the venue exactly as it was',
             'test-undo-cancel-rolls-back.js',
             'a refused undo puts back every field it wrote, the 90-day clock included', 12,
             'A venue left active with no subscription behind it plays for nothing, for ever'),
        ):
            head(label)
            t = os.path.join(ROOT, 'tools', fn)
            if not os.path.isfile(t):
                ok(title, False, why='tools/%s is missing' % fn)
                continue
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120, cwd=ROOT)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok(title, r.returncode == 0 and n >= floor and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/%s. %s' % (fn, why))

        head('D14. The wall heals itself after a network blip')
        t = os.path.join(ROOT, 'tools', 'test-router-heals-after-a-blip.js')
        if not os.path.isfile(t):
            ok('the router healing test exists', False,
               why='tools/test-router-heals-after-a-blip.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120, cwd=ROOT)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a dropped game channel is rebuilt, and the screen still follows the host',
               r.returncode == 0 and n >= 10 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-router-heals-after-a-blip.js. A telly on a wall has '
                   'nobody to press reload; if it cannot heal itself it stays wrong all night')

        head('D13. A winner still has her win screen when she reaches the host')
        t = os.path.join(ROOT, 'tools', 'test-winner-screen-survives.js')
        if not os.path.isfile(t) or not os.path.isfile(os.path.join(ROOT, 'tools', 'rig-bingo-room.js')):
            ok('the winner-screen test and its rig exist', False,
               why='tools/test-winner-screen-survives.js or tools/rig-bingo-room.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=180, cwd=ROOT)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a win survives heartbeats and reconnects, and a new round still clears it',
               r.returncode == 0 and n >= 10 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-winner-screen-survives.js from the repo root. The win '
                   'screen is what a player shows the host to be paid')

        head('D12. Permissions, the CSV and the contact form fail closed')
        t = os.path.join(ROOT, 'tools', 'test-fail-closed-batch.js')
        if not os.path.isfile(t):
            ok('the fail-closed test exists', False, why='tools/test-fail-closed-batch.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a manager whose permissions cannot be read is refused, never promoted',
               r.returncode == 0 and n >= 25 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-fail-closed-batch.js. Not knowing what somebody may do '
                   'is a reason to ask them to try again, never to let them do everything')

        head('D11. The welcome email a customer is actually sent')
        t = os.path.join(ROOT, 'tools', 'test-welcome-email-renders.js')
        if not os.path.isfile(t):
            ok('the welcome-render test exists', False,
               why='tools/test-welcome-email-renders.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('the real templates render with every venue, its own TV link and no raw tags',
               r.returncode == 0 and n >= 9 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-welcome-email-renders.js. This is the first thing a '
                   'paying venue reads, and the TV link in it is how their screen finds them')

        head('D10. The retention clock follows the venue status')
        t = os.path.join(ROOT, 'tools', 'test-status-moves-the-clock.js')
        if not os.path.isfile(t):
            ok('the status-clock test exists', False,
               why='tools/test-status-moves-the-clock.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('archiving starts the purge clock and reactivating clears it',
               r.returncode == 0 and n >= 6 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-status-moves-the-clock.js. A reactivated venue that '
                   'keeps an old closed date can have its players wiped, and that has no undo')

        head('D9. HQ sees every venue, and a host still costs one call')
        t = os.path.join(ROOT, 'tools', 'test-venue-list-paged.js')
        if not os.path.isfile(t):
            ok('the venue-list test exists', False,
               why='tools/test-venue-list-paged.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('the venue list is complete and still one call for a host (%d checks)' % n,
               r.returncode == 0 and n > 0 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-venue-list-paged.js. A venue HQ cannot see is a '
                   'venue nobody can fix, and a second call on every console boot costs '
                   'the gateway ceiling for a fault a thousand venues away')

        head('D8. The advertised question count is the playable count')
        t = os.path.join(ROOT, 'tools', 'test-set-count.js')
        if not os.path.isfile(t):
            ok('the question-count test exists', False,
               why='tools/test-set-count.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('parked questions are not advertised, and a bad count writes nothing (%d checks)' % n,
               r.returncode == 0 and n > 0 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-set-count.js. A host told there are more questions '
                   'than can be drawn runs short on the night')

        head('D7. A bad request body gets a 400, not a 500')
        t = os.path.join(ROOT, 'tools', 'test-body-reader.js')
        if not os.path.isfile(t):
            ok('the request-body test exists', False,
               why='tools/test-body-reader.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('a malformed body is refused with a reason (%d checks)' % n,
               r.returncode == 0 and n > 0 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-body-reader.js')

        # And no handler may go back to reading the body raw.
        apath = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')
        try:
            with io.open(apath, encoding='utf-8') as fh:
                asrc = fh.read()
        except (IOError, OSError):
            asrc = ''
        naked = []
        for i, ln in enumerate(asrc.splitlines()):
            if re.search(r'=\s*await request\.json\(\)\s*;', ln):
                naked.append('line %d' % (i + 1))
        ok('no handler reads the body without a guard',
           bool(asrc) and not naked,
           detail=('; '.join(naked[:5]) if naked else 'all go through vpaBody'),
           why='use vpaBody(request, json), which returns a 400 the caller returns as-is')

        head('D6. Every paged read has a stable order')
        # BOTH Workers. This covered only the game Worker at first, which left the billing
        # one free to lose an order silently, and its paged reads are over sessions, game
        # reports and the OPT-IN EXPORT: money and player data.
        WORKERS = [('venueplay-game.js', r"sbGetAll\(env, '([a-z_]+)'"),
                   ('venueplay-api-FULL.js', r"vpaSelectAll\(env, '([a-z_]+)'")]
        gsrc, glines, pattern = '', [], ''
        for wname, wpat in WORKERS:
            gpath = os.path.join(ROOT, 'venueplay-backend', 'worker', wname)
            try:
                with io.open(gpath, encoding='utf-8') as fh:
                    gsrc = fh.read()
            except (IOError, OSError):
                gsrc = ''
            if not gsrc:
                ok('%s is readable' % wname, False, why='could not read %s' % wname)
                continue
            glines = gsrc.splitlines()
            pattern = wpat
            unordered, seen = [], 0
            for i, ln in enumerate(glines):
                m = re.search(pattern, ln)
                if not m:
                    continue
                seen += 1
                # Read to the END of the statement. A two-line window reported one of
                # these as unordered when the order sat on the fourth line, which is a
                # scan that lies in the safe direction only by luck.
                stmt, j = '', i
                while j < len(glines) and j < i + 12:
                    stmt += glines[j]
                    if glines[j].rstrip().endswith(');'):
                        break
                    j += 1
                if 'order=' not in stmt:
                    unordered.append('%s line %d' % (m.group(1), i + 1))
            ok('paged reads in %s are ordered (%d)' % (wname, seen),
               seen > 0 and not unordered,
               detail=('; '.join(unordered[:4]) if unordered else '%d reads' % seen),
               why='add &order=id.asc. Without an order, paging can repeat and skip rows, '
                   'and the reads that do it are what bills a venue and what exports its '
                   'opt-in list')

            # AND THE CHECK MUST BE ABLE TO SEE ALL OF THEM. The pattern above only
            # matches a LITERAL table name. Write sbGetAll(env, table, ...) with a
            # variable and this check skips it in silence and still reports green, which
            # is the shape of every blind check in this repo's history. Count every call
            # site however it is written and require the two numbers to agree.
            helper = pattern.split('\\(')[0]
            every = len(re.findall(r'\b' + helper + r'\s*\(', gsrc))
            defs = len(re.findall(r'function\s+' + helper + r'\s*\(', gsrc))
            calls = every - defs
            ok('and the check can see every %s call in %s' % (helper, wname),
               calls == seen,
               detail='%d call sites, %d visible to this check' % (calls, seen),
               why='a call written with a variable table name is invisible to the pattern '
                   'above, so it would be skipped silently and still pass')

        head('D3. A failed read does not archive a venue')
        t = os.path.join(ROOT, 'tools', 'test-archive-sweep-fails-closed.js')
        if not os.path.isfile(t):
            ok('the archive-sweep fail-closed test exists', False,
               why='tools/test-archive-sweep-fails-closed.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('the nightly archive sweep fails closed (%d checks)' % n,
               r.returncode == 0 and n > 0 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-archive-sweep-fails-closed.js. A venue archived '
                   'by mistake is a dark room on a Friday night')

        head('D2. An archived venue lets go of the host')
        t = os.path.join(ROOT, 'tools', 'test-archived-venue-restore.js')
        if not os.path.isfile(t):
            ok('the archived-venue test exists', False,
               why='tools/test-archived-venue-restore.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('an archived venue is not restored, and an explicit choice still works '
               '(%d checks)' % n,
               r.returncode == 0 and n > 0 and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-archived-venue-restore.js. A host locked into an '
                   'archived venue reads as an outage, and an admin bounced out of View as '
                   'has no way to support them')

    # THE 90-DAY DELETION PROMISE, ACTUALLY KEPT.
    #
    # privacy.html says in writing, to every venue and every player: "When a venue's account is
    # closed, its player list is deleted within 90 days." Nothing did it. Not a cron, not a
    # sweep, not a hand procedure. It could not have been written either, because nothing
    # recorded WHEN a venue closed: vp_venues had status and suspended_reason and not one
    # timestamp. Migration 84 adds closed_at, every closing path stamps it, every comeback clears
    # it, and the nightly cron on venueplay-game does the work.
    #
    # The failure mode here is emptying the wrong venue's customer list with no undo, so most of
    # the test is about what the sweep must REFUSE to touch: not live venues, not venues closed
    # yesterday, not by venue when it should be by session, and never twice.
    if which in ('both', 'venueplay'):
        head('D. The 90-day deletion promise is actually kept')
        t = os.path.join(ROOT, 'tools', 'test-retention-sweep.js')
        if not os.path.isfile(t):
            ok('the retention sweep test exists', False, why='tools/test-retention-sweep.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('closed venues lose their player details, and nobody else does (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-retention-sweep.js. Getting this wrong in one direction '
                   'breaks a written promise; in the other it empties a paying venue\'s customer '
                   'list with no way back')

    # A MANAGER'S RESTRICTIONS BELONG TO THE ACCOUNT THEY WERE SET ON.
    #
    # vpbRequireOwner resolved permissions with a query that had NO venue filter: it read every
    # staff row the person holds anywhere and took the first one carrying a permissions object. A
    # travelling host or duty manager working at venues on two DIFFERENT accounts got one
    # account's restrictions applied to the other, in whichever order Postgres returned the rows.
    # It could fall either way: losing buttons where they were trusted, or keeping access somebody
    # had deliberately taken away. That is venue isolation broken from the inside.
    if which in ('both', 'venueplay'):
        head('D. Manager permissions do not bleed between accounts')
        t = os.path.join(ROOT, 'tools', 'test-manager-perms-scope.js')
        if not os.path.isfile(t):
            ok('the permission scope test exists', False, why='tools/test-manager-perms-scope.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('permissions are read per account, most restrictive wins (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-manager-perms-scope.js')

    # AN ABANDONED LOBBY GOES BACK TO THE VENUE'S ADS; A LIVE GAME DOES NOT.
    #
    # The ordinary end of a night is a host closing the tab, not pressing End. The t:"to_ads"
    # sent on pagehide has to go unsigned, and vp-sign.js drops unsigned to_ads on purpose
    # because a forged one would let any patron in the room kill a live game. So at an enforcing
    # venue, which is all of them, that message never arrives and the wall sat on a join code for
    # a game nobody was running until the 90 minute host-silence timeout.
    #
    # Four of the five consoles beat host_here every thirty seconds while a game or lobby is
    # open. Bingo never did, which is why a quiet lobby meant nothing at all. It does now, so
    # twelve missed beats really means the host has gone, and only THEN is a short window safe.
    # The long window stays for a game being played: pulling a live quiz off the wall is far
    # worse than leaving a dead code up.
    if which in ('both', 'venueplay'):
        head('D. An abandoned lobby goes back to ads, a live game does not')
        t = os.path.join(ROOT, 'tools', 'test-abandoned-lobby.js')
        if not os.path.isfile(t):
            ok('the abandoned lobby test exists', False, why='tools/test-abandoned-lobby.js is missing')
        else:
            r = subprocess.run([JSC, t], capture_output=True, text=True, timeout=120)
            out = ((r.stdout or '') + (r.stderr or '')).strip()
            bad = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
            n = len([l for l in out.splitlines() if l.strip().startswith('ok ')])
            ok('every console says it is there, and only a lobby times out fast (%d checks)' % n,
               r.returncode == 0 and 'PASS' in out and not bad,
               detail=('; '.join(bad[:3]) if bad else '%d checks' % n),
               why='run jsc tools/test-abandoned-lobby.js. Getting this wrong one way leaves a '
                   'venue looking at a dead join code all night; the other way pulls the wall '
                   'off a game that is being played')

    head('E. The Worker you are about to paste')
    dep = os.path.join(PARTYPLAY_BACK, 'worker', 'DEPLOY-partyplay-api.js')
    if which in ('both', 'partyplay') and os.path.isfile(dep):
        src = io.open(dep, encoding='utf-8').read()
        stamp = re.search(r'Built ([^\n]+?)\s+fingerprint', src)
        good, msg = parses(unexport(src))
        ok('deploy build parses', good, msg if not good else (stamp.group(1) if stamp else ''))
        ok('the licence library is inlined, not a marker', 'const PPLicence = (function' in src)

        """AND THE INLINED COPY MUST BE THE LIBRARY AS IT STANDS NOW.

        build-worker.py pastes lib/pp-licence.js into the build VERBATIM. So editing the
        library and not rebuilding leaves the Worker running the old copy, and every check
        around here stays green: 'inlined, not a marker' only asks whether the wrapper is
        there, and 'the build is at least as new as this source' compares the build against
        the SOURCE, which the edit never touched.

        pp-licence.test.js reads the library, so it would test the new code and pass, while
        the thing actually deployed ran the old code. That is the same shape as ten
        PartyPlay suites reading a copy nobody ships and reporting 699 passing checks.

        Because it is pasted verbatim, the honest question is a substring one. Found by
        asking, 18 Sep 2026; they matched, and nothing was checking."""
        lib_p3 = os.path.join(PARTYPLAY_BACK, 'lib', 'pp-licence.js')
        if os.path.isfile(lib_p3):
            lib3 = io.open(lib_p3, encoding='utf-8').read()
            ok('and it is the library as it stands now, character for character',
               lib3 in src, '%d characters' % len(lib3),
               why='lib/pp-licence.js has been edited and the Worker never rebuilt, so the '
                   'deployed build runs the old copy while its suite tests the new one. Run '
                   'partyplay-backend/tools/build-worker.py then tools/stamp-workers.py.')

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
            # The two stamps no longer have to be EQUAL, see WORKER_SOURCE above: the build
            # carries its own fingerprint so it can be deployed by tool at all. What still has
            # to be true is that the build is not OLDER than the source it was made from.
            def _when(m):
                import datetime as _dt
                try: return _dt.datetime.strptime((m.group(1).split(' \u00b7 ')[0]).strip(), '%d %b %Y, %H:%M')
                except Exception: return None
            sw, bw = (_when(want) if want else None), (_when(got) if got else None)
            ok('the build is at least as new as this source',
               bool(sw and bw) and bw >= sw,
               (got.group(1) if got else 'no stamp in the build'),
               why='the source says %s and the build says %s, so the build is older. Run '
                   'partyplay-backend/tools/build-worker.py then tools/stamp-workers.py.'
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


def every_page_loads_what_it_calls():
    """A PAGE THAT CALLS A SHARED SCRIPT MUST LOAD IT.

    The win fanfare was silent on all eight screens for half a day because it moved into
    /app/vp-celebrate.js and not one page got the script tag. Nothing threw until the first
    call, and the first call was in front of a room.

    shared_scripts_live asks whether the file SERVES. This asks the other half, and it needs
    no network: does the page that calls VPCelebrate or PPGames actually pull the file that
    defines it? Both halves have to be true and neither implies the other.

    Comments are stripped first, and so are the src attributes of script tags, or a page
    would satisfy this by mentioning the name it fails to load."""
    head('Every page loads the shared script it calls')
    defines = {}
    for folder in (os.path.join(ROOT, 'partyplay', 'lib'),
                   os.path.join(ROOT, 'venueplay', 'app')):
        if not os.path.isdir(folder):
            continue
        for f in sorted(os.listdir(folder)):
            if not f.endswith('.js') or f.endswith('.test.js'):
                continue
            t = io.open(os.path.join(folder, f), encoding='utf-8', errors='ignore').read()
            for g in re.findall(r'root\.((?:VP|PP)[A-Za-z0-9_]+)\s*=', t):
                defines.setdefault(g, f)
    pages = []
    for base in (os.path.join(ROOT, 'partyplay'), os.path.join(ROOT, 'venueplay')):
        for d, dirs, fs in os.walk(base):
            dirs[:] = [x for x in dirs if x not in ('node_modules', '.git')]
            pages += [os.path.join(d, f) for f in sorted(fs) if f.endswith('.html')]
    missing = []
    for page in sorted(set(pages)):
        raw = io.open(page, encoding='utf-8', errors='ignore').read()
        body = re.sub(r'<!--.*?-->', ' ', raw, flags=re.S)
        body = re.sub(r'/\*.*?\*/', ' ', body, flags=re.S)
        body = re.sub(r'(^|[^:])//[^\n]*', r'\1', body)
        # the src attribute must not count as "using" the global
        body_nosrc = re.sub(r'<script[^>]*?src=["\'][^"\']*["\'][^>]*?>\s*</script>', ' ', body)
        # THE FILE MUST BE IN A REAL SCRIPT TAG, not merely named somewhere in the page.
        # The first version asked "is the filename anywhere in this file", and play.html
        # explains vp-celebrate.js in TWO comments, so deleting the actual script tag left
        # the check green and prove-checks called it BLIND. Comments are claims.
        loaded = set()
        for tag_src in re.findall(r'<script[^>]*?src=["\']([^"\']+)["\']', raw):
            loaded.add(os.path.basename(tag_src.split('?')[0]))
        for g, src in sorted(defines.items()):
            if re.search(r'\b' + g + r'\s*\.', body_nosrc) and src not in loaded:
                missing.append('%s calls %s and never loads %s' % (short(page), g, src))
    ok('every page loads the shared script it calls', not missing,
       '%d page(s), %d shared global(s)' % (len(set(pages)), len(defines)),
       why='; '.join(missing[:4]))


def shared_scripts_live(base, folder, url_prefix='/app/'):
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
        # VP or PP: PartyPlay's shared scripts were never checked at all, and they fail
        # exactly the same way. Hardcoding VP here is why: it was written for one product.
        m = re.search(r'root\.((?:VP|PP)[A-Za-z]+)\s*=', local)
        status, body, _ = get(base + url_prefix + f)
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
    # THE BUILT FILE, because that is the one that goes to Cloudflare. It used to be the
    # SOURCE, which worked only while build-worker.py copied the source's BUILD line into the
    # build verbatim. It cannot any more: deploy-worker.py refuses a file whose stamp does not
    # match its OWN contents, and the build is source + inlined lib + header, so it never did.
    # PartyPlay was therefore the one Worker that could only be deployed by paste, which is
    # why its live build sat at 12 Sep. Now built, stamped, deployed and checked, all on the
    # same file. Found 17 Sep 2026. See the sibling check on the two stamps agreeing.
    'PartyPlay':         'partyplay-backend/worker/DEPLOY-partyplay-api.js',
}


def repo_build(name):
    """The stamp the repo says this Worker should be carrying.

    THIS RETURNED None FOR EVERY WORKER, ALWAYS, AND NOBODY NOTICED FOR WEEKS.

    It matched `const BUILD = '([0-9a-f]{8})'`: eight hex characters and nothing
    else. The real line has read `const BUILD = '11 Sep 2026, 05:39 - 9d0c48e0'`
    since stamps gained a date. No match, None returned, and the caller skips the
    check WITHOUT PRINTING ANYTHING, so "is running the current code" never once
    appeared in the output.

    What that cost: on 11 Sep 2026 five commits of BILLING changes sat undeployed
    while the full gate reported "All 205 checks passed". The one check whose whole
    job is to say "you have not pasted this yet" was the one that could not fire.
    The section footer of this very file still promises it: "it asks each Worker its
    own name and compares its build stamp to the repo".

    A regex that returns nothing looks exactly like a file that is fine. That is the
    third time this class has bitten this repo, so this one is loud: if the BUILD
    line cannot be read at all, say so instead of returning None quietly.
    """
    src_path = WORKER_SOURCE.get(name)
    if not src_path:
        return None
    p = os.path.join(ROOT, src_path)
    if not os.path.isfile(p):
        return None
    body = io.open(p, encoding='utf-8').read()
    m = re.search(r"const BUILD = '([^']+)'", body)
    if not m:
        return '(no BUILD line in %s)' % os.path.basename(src_path)
    return m.group(1)


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
                       live,
                       why='LIVE has %s but the repo has %s. Paste %s.'
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


_SUITES_RUN = set()


def suite_passed(line):
    """Did a suite's last line say every check passed?

    TWO SHAPES, because there are two. Most print "ALL 26 CHECKS PASSED"; touring-api
    prints "36 of 36 checks passed". The second was never recognised, so that suite
    would have read as a failure the moment anybody swept it in, which is one of the
    two reasons nobody had.

    The numbers must MATCH. "35 of 36 checks passed" is a failure and has to stay one."""
    line = (line or '').strip()
    if 'ALL' in line and 'PASSED' in line:
        return True
    m = re.match(r'^(\d+) of (\d+) checks? passed', line)
    return bool(m) and m.group(1) == m.group(2) and int(m.group(1)) > 0


# A SUITE THAT NOBODY RUNS, WITH THE REASON. Anything here is deliberately outside the
# gate. Anything NOT here and not run is a test that exists and proves nothing, which this
# repo has shipped twice.
RUN_BY_HAND = {
    'purge-closed-player-data.test.py':
        'it CREATES real venues and accounts, purges them and cleans up, so it is a live '
        'integration test and not something to run on every pre-push gate. Run it by hand '
        'before any change to purge-closed-player-data.py. It passed on 18 Sep 2026.',
}


def every_suite_is_run():
    """IS THERE A SUITE IN THIS REPO THAT NOTHING RUNS?

    The sweeps above say "a suite that is added is a suite that runs", and twice that was
    not true: a suite written beside venueplay/signage.html sat a directory above the sweep
    on 10 Sep, and ten PartyPlay suites read a copy of the project nobody ships and reported
    699 passing checks for weeks.

    Found again 18 Sep 2026, two of them. purge-closed-player-data.test.py, which covers the
    deletion of a closed venue's player list, so tier one, and touring-api.test.js. Neither
    was swept: .test.py is only collected under tools/, and .test.js only under venueplay,
    venueplay-backend and the PartyPlay folders. Both pass. Nobody knew, because a suite
    nobody runs is indistinguishable from one that does not exist.

    So this asks the level above: every test file in the repo is either run by this gate or
    named in RUN_BY_HAND with a reason."""
    head('Every suite in this repo is actually run')
    found = []
    for d, dirs, fs in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in ('.git', 'node_modules', 'worktrees', '__pycache__')]
        for f in fs:
            if f.endswith('.test.js') or f.endswith('.test.py'):
                found.append(os.path.abspath(os.path.join(d, f)))
    orphans = sorted(p for p in set(found)
                     if p not in _SUITES_RUN and os.path.basename(p) not in RUN_BY_HAND)
    ok('no suite in this repo is left unrun',
       not orphans,
       '%d suite(s) run, %d run by hand on purpose' % (len(_SUITES_RUN), len(RUN_BY_HAND)),
       why=('nothing runs these, so they prove nothing: '
            + ', '.join(short(p) for p in orphans[:4])))
    # AND THE EXCUSES MUST STILL POINT AT SOMETHING. A name left here after the file is
    # renamed excuses a suite that no longer exists and hides the one that replaced it.
    names = {os.path.basename(p) for p in found}
    stale = sorted(n for n in RUN_BY_HAND if n not in names)
    ok('every run-by-hand excuse still names a real suite', not stale,
       why='RUN_BY_HAND names a file that is not here any more: ' + ', '.join(stale[:4]))


def redirect_verdict(path, mustkeep, code, loc, apex='https://venueplay.com.au'):
    """Is this answer a correct www-to-apex redirect? Returns None if it is, else what is wrong.

    SPLIT OUT SO IT CAN BE PROVEN. As part of one_address_check it could only ever be tested
    against the live site, which currently answers correctly, so deleting either of the last
    two rules changed nothing and the mutation stayed green. A branch that cannot be made to
    fire is a branch nobody has checked. Here it takes the answer as arguments, so
    redirect-verdict.test.py can hand it the answers a broken edge rule would give."""
    if code not in (301, 302, 307, 308):
        return '%s answered %s, not a redirect' % (path, code)
    if not loc.startswith(apex):
        return '%s went to %s' % (path, loc)
    if loc.startswith(apex + '.'):
        return '%s went to a lookalike host: %s' % (path, loc)   # venueplay.com.au.evil.example
    if mustkeep and mustkeep not in loc:
        return '%s LOST the query string, went to %s' % (path, loc)
    return None


def one_address_check():
    """www.venueplay.com.au and venueplay.com.au both answered 200 and NEITHER redirected to the
    other, so they were two origins. Games worked on both, because the Workers reflect either,
    so nothing looked wrong. Logins did not: a browser keeps a session against the exact origin
    it was made on, so a host who signed in on one and later typed the other was silently signed
    out with nothing on screen to say why. Dean found it on 12 Sep 2026 by asking what a venue
    would actually type, which was a better question than any being asked in this file.

    Fixed at the edge with a Cloudflare redirect rule, which is the right place: it fires before
    a byte of HTML is sent, needs no JavaScript, and cannot flash the wrong page first. The
    first attempt was a snippet in all thirty-nine pages. It worked, and it was thirty-nine
    copies of one answer, so it came back out.

    THE CATCH WITH FIXING IT IN A DASHBOARD is that nothing in this repo would notice the rule
    being deleted. So this asks the live site. The query string is the part that matters most: a
    venue screen is /tv?their-slug, so a redirect that drops the query sends every television to
    the pairing screen instead of to their venue.

    LIVE ONLY. It was first written inside local_checks, where the name `live` does not exist,
    so the whole gate died with a NameError, and a grep over the output hid the crash and showed
    green. Read the last line of this tool, never a filtered slice of it."""
    head('Everything still arrives at one address')
    import urllib.request as _u

    class _NoRedir(_u.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    # BOTH PRODUCTS. This checked VenuePlay only, and on 18 Sep 2026
    # www.partyplay.com.au answered 200 and redirected nowhere, so PartyPlay was two
    # origins. www.getpartyplay.com.au and www.venueplay.com.au both redirect correctly,
    # so the rule was simply never made for this one domain.
    #
    # It matters for PartyPlay the same way it mattered for VenuePlay, for a different
    # reason: play.html keeps the guest's identity in localStorage["ppPlayer"], which is
    # per ORIGIN. A guest who lands on www and later on the apex is a new person to the
    # browser, gets asked for a nickname again, writes a SECOND pp_players row, and that
    # row counts against the fifty player cap. Their bingo card state goes too.
    for site, apex, paths in (
            ('https://www.venueplay.com.au', 'https://venueplay.com.au',
             [('/', None), ('/app/', None), ('/tv?the-mini-bar', 'the-mini-bar')]),
            ('https://www.partyplay.com.au', 'https://partyplay.com.au',
             [('/', None), ('/play?code=ABC123', 'code=ABC123')])):
      bad = []
      for path, mustkeep in paths:
        url = site + path
        try:
            opener = _u.build_opener(_NoRedir)
            code, loc = None, ''
            try:
                # WITH A USER AGENT. Cloudflare answers a bare Python-urllib 403 on some
                # zones and not others, so this probe reported "403, not a redirect" for
                # www.partyplay.com.au while curl got a 200. That is a check failing for
                # the wrong reason, and it would have stayed red after the rule was added.
                opener.open(_u.Request(url, headers={'User-Agent': 'curl/8.7.1'}), timeout=15)
                bad.append(path + ' did not redirect at all'); continue
            except Exception as e:
                code = getattr(e, 'code', None)
                hdrs = getattr(e, 'headers', None)
                loc = hdrs.get('Location', '') if hdrs else ''
            v = redirect_verdict(path, mustkeep, code, loc, apex)
            if v:
                bad.append(v)
        except Exception as ex:
            bad.append('%s could not be checked: %s' % (path, str(ex)[:50]))
      ok('%s lands on the one address, query string and all' % site.split('//')[1],
         not bad, why='; '.join(bad[:3]) +
         '. Cloudflare -> the zone -> Rules -> Redirect Rules: hostname equals '
         + site.split('//')[1] + ' -> dynamic 301 to concat("' + apex +
         '", http.request.uri.path) preserving the query string')


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

    # PROVE THE PROBE WORKS BEFORE TRUSTING A CLEAN RESULT. A table that is
    # readable must come back as a JSON LIST. If the key is refused, or the URL is
    # wrong, the answer is an object, and "no rows in an object" is not evidence of
    # anything. So a non-list is a FAILURE of the check, not a pass.
    reachable, _rb, _ = get(url + '/rest/v1/vp_venues?select=id&limit=1', headers=h)
    ok('the RLS probe can actually reach the database', reachable == 200,
       'HTTP %s' % reachable,
       why='the probe never asked, so every result below would be meaningless')

    for t in ('vp_venues', 'vp_players', 'vp_sessions', 'vp_captures',
              'pp_licences', 'pp_admins', 'vp_games'):
        status, body, _ = get(url + '/rest/v1/' + t + '?select=*&limit=1', headers=h)
        # FOUR ANSWERS, and only two of them are good:
        #   a list with rows   -> the table is READABLE. This is the leak.
        #   an empty list      -> reachable, RLS returned nothing. Good.
        #   permission denied  -> no grant at all. Better than good.
        #   anything else      -> we never asked, and silence is not safety.
        good, note = False, ''
        try:
            d = json.loads(body)
            if isinstance(d, list):
                good = len(d) == 0
                note = 'IT RETURNED %d ROW(S)' % len(d)
            else:
                msg = str(d.get('message') or '')
                if 'permission denied' in msg.lower() or d.get('code') == '42501':
                    good, note = True, 'no grant at all'
                else:
                    note = 'the probe could not ask: %s %s' % (status, msg[:60])
        except Exception:
            note = 'the probe could not ask: unreadable answer, HTTP %s' % status
        ok('cannot READ %s' % t, good, note if good else '', why=note)

    for t in ('vp_venues', 'pp_licences', 'pp_admins'):
        status, body = post(url + '/rest/v1/' + t, {}, h)
        ok('cannot WRITE %s' % t, status in (401, 403),
           why='HTTP %s: the write was not refused' % status)


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


def _no_comments(js):
    """Strip // and /* */ so a check reads CODE, not the prose explaining it.

    Without this, the comment written above the tv.html fix - which naturally says the
    word CLOSED several times - satisfied the search for CLOSED, and putting the bug
    back left this check GREEN. A checker that reads its own documentation as evidence
    proves nothing. The same fault was fixed in check-defs.py the same evening, where
    the words "time(s)" in a sentence were read as a call to a function called time.
    """
    out, i, n, q = [], 0, len(js), None
    while i < n:
        c = js[i]
        if q:
            out.append(c)
            if c == '\\' and i + 1 < n: out.append(js[i+1]); i += 2; continue
            if c == q: q = None
            i += 1; continue
        if c in ('"', "'", '`'): q = c; out.append(c); i += 1; continue
        if c == '/' and i + 1 < n and js[i+1] == '/':
            while i < n and js[i] != '\n': i += 1
            continue
        if c == '/' and i + 1 < n and js[i+1] == '*':
            i += 2
            while i + 1 < n and not (js[i] == '*' and js[i+1] == '/'): i += 1
            i += 2; continue
        out.append(c); i += 1
    return ''.join(out)



def _decls_inside_blocks(src):
    """Every `function name(...)` written as the FIRST thing inside an if/for/while/try
    block. Returns (name, line) pairs.

    WHY THIS EXISTS. On 16 September 2026 tvStatus landed inside connectRealtime's first
    if - the branch that runs only while the Supabase library is still loading. A function
    declaration in a block is BOUND WHEN THE BLOCK RUNS (Annex B), so on every screen where
    the CDN was quick it was never bound at all, and the venue television at Tugun Bowls
    Club spent the day throwing "TypeError: tvStatus is not a function" out of its
    SUBSCRIBED handler. It never said Connected, never recorded which road it took, and
    could no longer mark itself unsubscribed when the channel closed: a deaf screen would
    have gone on claiming it was fine. The file PARSED, and all 292 checks here were green.

    DELIBERATELY NARROW, because the wide version was wrong. The first attempt tracked
    brace depth across the whole script and named four innocent functions in two files: a
    regular expression literal containing a quote sends any scanner that is not a real
    JavaScript tokeniser off by one brace and it never recovers. Rather than ship a check
    that cries wolf, this reads only the shape that actually shipped - an opening control
    block, then comments, then a declaration - which needs no brace counting at all and
    which prove-checks.py can put back and watch go red.

    What it therefore does NOT catch: a declaration buried further down inside a block.
    Opening the screen is still the thing that finds those. See venueplay/screen-check.html.
    """
    lines = src.split('\n')
    # ...and the trailing { must be the block's own. `if(!DEMO) ch.subscribe(function(s){`
    # opens a FUNCTION body, where a declaration is bound perfectly normally, and reading
    # that as a control block named four healthy screens on the first run of this check.
    OPENS = re.compile(r'^\s*(?:\}\s*else\s+)?(?:if|for|while|switch|try|else)\b'
                       r'(?![^\n]*(?:function|=>))[^\n]*\{\s*$')
    DECL  = re.compile(r'^\s*function\s+([A-Za-z_$][\w$]*)\s*\(')
    CLOSE = re.compile(r'^\s*\}')
    # IT USED TO LOOK ONLY AT THE FIRST STATEMENT IN THE BLOCK, and only report that.
    # Proved blind on 17 Sep 2026: a function planted as the THIRD statement inside an if,
    # and called from outside it, sailed through. That is the same fault as tvStatus, just
    # a few lines lower down, and it is the more likely shape of the two.
    #
    # Widening to "a declaration ANYWHERE inside a control block" names 53 things in this
    # repo, and nearly all of them are honest little helpers used right where they are
    # declared, which is fine and is how the brace-counting version wrongly accused four
    # healthy screens. So this applies the rule the docstring above already states, and the
    # only one that is actually a fault: declared inside a block AND the name used OUTSIDE
    # that block. Measured across every page and script before changing it, that combination
    # occurs ZERO times today, so this is strictly more catching and costs nothing.
    out, i = [], 0
    while i < len(lines) - 1:
        if OPENS.match(lines[i]):
            base = len(lines[i]) - len(lines[i].lstrip())
            end = len(lines)
            for j in range(i + 1, len(lines)):
                t = lines[j]
                if t.strip() and (len(t) - len(t.lstrip())) <= base and CLOSE.match(t):
                    end = j
                    break
            outside = '\n'.join(lines[:i] + lines[end:])
            for j in range(i + 1, min(end, len(lines))):
                m = DECL.match(lines[j])
                if not m:
                    continue
                name = m.group(1)
                # Called from outside the block it lives in. The dot guard keeps obj.name()
                # from counting: that is a property, not this declaration.
                if re.search(r'(?<![\w$.])' + re.escape(name) + r'\s*\(', outside):
                    out.append((name, j + 1))
        i += 1
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
                             ('game', VP_GAME, 'venueplay-game'),
                             # PartyPlay only has one Worker, so it cannot be
                             # confused with its sibling -- but it CAN be handed a
                             # VenuePlay file, which is exactly what happened in
                             # the other direction on 31 Aug.
                             ('partyplay', PP_API, 'partyplay-api')):
        status, body, _ = get(url + '/health')
        try:
            got = (json.loads(body) or {}).get('worker')
        except Exception:
            got = None
        # TWO DIFFERENT ANSWERS, and only one of them is an emergency.
        #
        # A worker naming itself as a DIFFERENT worker means the wrong file went
        # into this slot, which is what happened on 31 Aug: checkout answered 404
        # and nobody could sign up. That fails.
        #
        # No name at all just means a build older than the line that added the
        # name. Saying "the wrong file was pasted" there would be a lie, and a
        # check that cries wolf is one people learn to push past.
        if got is None:
            ok('the %s URL names itself' % label, True, 'no name yet, so this build predates it',
               why='')
        else:
            ok('the %s URL is answering as %s' % (label, want), got == want, got,
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
    """A PAGE THAT ACTS ON SOMEONE ELSE'S VENUE MUST SAY SO ON SCREEN.

    Two localStorage keys decide which venue a page acts on. vpCurrentVenue is the
    venue the user picked. vpImpersonate is set by hq.html "View as" and is sent as
    the X-VP-Venue header, which is how an HQ admin acts on a venue they are staff of
    nowhere. Nothing clears vpImpersonate when you navigate straight to a page, so it
    can be left over from an earlier View-as.

    index.html has shown a gold "Viewing <venue> from VenuePlay Admin" banner since
    View-as shipped. billing.html sent the header and showed NOTHING, and billing.html
    is the page with the subscription, the plan change and the cancel button. An admin
    could read one venue's billing believing it was another's and cancel the wrong
    subscription. Found 14 Sep 2026.

    So: send the header, show the venue. This is a money check."""
    head('A page acting on another venue says whose account it is')
    silent = []
    appdir = os.path.join(ROOT, 'venueplay', 'app')
    pages = []
    if os.path.isdir(appdir):
        for dirpath, _dirs, names in os.walk(appdir):
            for n in names:
                if n.endswith('.html'):
                    pages.append(os.path.join(dirpath, n))
    for f in sorted(pages):
        src = io.open(f, encoding='utf-8').read()
        code = re.sub(r'<!--.*?-->', '', src, flags=re.S)
        code = re.sub(r'/\*.*?\*/', '', code, flags=re.S)
        # The danger is narrow: a page that takes the venue from the STORED flag, which
        # can be left over from an earlier View-as. onboard.html also sends X-VP-Venue but
        # passes the id straight into the call for a venue being created in that flow, so
        # there is nothing stale to be wrong about. Flagging it was a false positive, and
        # an over-broad check that cries wolf is a check people learn to ignore.
        if 'X-VP-Venue' not in code:
            continue
        if 'vpImpersonate' not in code:
            continue
        # IT MUST BUILD THE BANNER AND PUT IT IN THE DOCUMENT, not merely mention it.
        # First attempt matched the string "vpImpBar" anywhere in the file, so renaming
        # the element the banner is actually built from left the check green. A check
        # that cannot fail is worse than no check, because the green line says the job
        # was done. So: the venue's name must reach markup, and that markup must be
        # inserted into the page.
        # AND THE INSERTION MUST BE THE BANNER'S OWN. Matching insertBefore anywhere in
        # the file left this green when the insert was deleted: billing.html is 140KB of
        # DOM work and something always matches. So look only in the window around the
        # name, which is the banner's own code.
        m = re.search(r'(?:innerHTML|textContent)[\s\S]{0,400}?esc\(\s*imp\.name', code)
        ok_here = False
        if m:
            window = code[m.start():m.end() + 700]
            ok_here = bool(re.search(r'(?:insertBefore|prepend|appendChild)\s*\(', window))
        if not ok_here:
            silent.append(short(f))
    ok('every page sending X-VP-Venue shows whose venue it is', not silent,
       why='sends the header with nothing on screen naming the venue, so an admin can act '
           'on the wrong account: ' + ', '.join(sorted(silent)[:4]))

    head('Every founding page can still get the price it promises')
    root = os.path.join(ROOT, 'venueplay')
    pages = [f for f in sorted(os.listdir(root))
             if f in ('nsw.html','qld.html','vic.html','sa.html','wa.html',
                      'nt.html','tas.html','act.html',
                      # /last-call is NATIONAL. It carries one code per state and
                      # picks between them from the venue's postcode, because the
                      # Worker's gate compares a code's prefix to that postcode and
                      # a made-up national prefix matches nothing. See
                      # founding-postcode-agree.test.js.
                      'last-call.html')] if os.path.isdir(root) else []
    if not pages:
        return
    shut, unreachable = [], []
    for b in pages:
        src = io.open(os.path.join(root, b), encoding='utf-8').read()
        codes = sorted(set(re.findall(r'[A-Z]{2,3}-[A-Z]{3}-20\d\d', src)))
        if not codes:
            continue
        # Ask about EVERY code on the page. /last-call carries seven, one per state,
        # and taking codes[0] would have declared it healthy while six states were
        # shut and being charged $3.00 against a page promising $2.50.
        for code in codes:
            status, body, _ = get(VP_API + '/founding?code=' + code)
            # AN UNANSWERED QUESTION IS NOT A NO. /founding lives on the billing
            # Worker, so when the wrong file is pasted into that slot the route 404s
            # and every page looked shut. On 5 Sep this printed "the Worker will
            # charge STANDARD on act, nsw, nt, qld" when the truth was that nothing
            # had been asked. Say which, because the two need opposite actions: one
            # is an env var to edit, the other is a Worker to re-paste.
            try:
                answer = json.loads(body)
            except Exception:
                answer = None
            if not isinstance(answer, dict) or 'open' not in answer:
                unreachable.append('%s (HTTP %s)' % (b, status))
            elif answer.get('open') is not True:
                shut.append('%s (%s)' % (b, code))
    if unreachable:
        ok('the founding-code route answers at all', False,
           why='%s could not be asked: %s. That is the billing Worker refusing, '
               'not a closed window. Check the right file is in the venueplay-api slot.'
               % (len(unreachable), ', '.join(unreachable[:4])))
    ok('all %d founding page(s) have a live code' % len(pages), not shut,
       why='the Worker will charge STANDARD on: ' + ', '.join(shut[:4]) +
           '. Either add the code to FOUNDING_CODES or take the page down.')


def no_session_left_open():
    """A session nobody closed is a billing problem, not just untidy.

    /session/close only ever runs in the browser, so a host who shuts the tablet
    without signing out leaves the session open. Every later night's players then
    append to that SAME session, and when it finally closes one invoice bills
    every player who ever played across all of them. It has happened once
    already: session 9206e83c sat open for 23 days across two separate nights.

    THIS CHECK USED TO ASK THE WORKER ABOUT ONE VENUE, and it was wrong twice
    over. It asked the public /play/live endpoint about a hand-maintained list of
    slugs that held ONE name while seventeen venues were active, and it printed
    "has no session left open" for every answer that was not "live with no game",
    which includes every case it could not judge. On 10 Sep 2026 it said
    the-average-joe had no session left open while that venue held a session
    opened on 26 August, never ended, with 4 billable players and 3 over the plan
    cap. Both statements were true at once: the session read not-live because it
    was CANCELLED, and cancelled is not ended.

    ended_at is a column, so ask the database, and ask about every venue. That is
    what check-stale-sessions.py does, and it is a separate tool because it needs
    the service credentials this one deliberately does not carry.
    """
    head('No venue has a session nobody closed')
    tool = os.path.join(ROOT, 'venueplay-backend', 'tools', 'check-stale-sessions.py')
    env_file = os.path.join(os.path.expanduser('~'), '.gflam-migrate.env')
    if not os.path.exists(tool):
        ok('the stale session check exists', False,
           why='venueplay-backend/tools/check-stale-sessions.py is missing')
        return
    if not os.path.exists(env_file):
        note('sessions: NOT CHECKED',
             'no ~/.gflam-migrate.env on this machine, so the database was never asked. '
             'This is deliberately not a pass: run check-stale-sessions.py where the '
             'credentials are.')
        return
    r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=180)
    out = (r.stdout or '') + (r.stderr or '')
    last = [l for l in out.splitlines() if l.strip()]
    tail = last[-1].strip() if last else 'no output'
    ok('no unclosed session can be billed, at any venue', r.returncode == 0,
       detail=tail,
       why='run venueplay-backend/tools/check-stale-sessions.py for which venue and which session')


def nobody_can_reach_another_venue():
    """A REAL SIGNED-IN HOST TRIES TO READ AND WRITE SOMEBODY ELSE'S VENUE.

    tools/tenant-isolation-attack.py signs in as a real test host and then goes after another
    venue's members, players, staff rows, opt-in captures, draw results and night reports, both
    straight at the database with the key out of play.html and through the Worker with a valid
    token. Everything it tries must be refused.

    IT WAS ADDED TO THE GATE ON 17 SEP 2026 BECAUSE IT COULD NOT RUN. It looked only for a
    JWT-shaped anon key (eyJ...) and Supabase had moved to sb_publishable_, so it died on an
    AttributeError before making a single request. An isolation attack that never attacks is the
    worst kind of check to own: its silence reads as safety. It was not in the gate, so nothing
    noticed. Now it is, and a tool that cannot run is a FAILURE here, not a quiet skip.
    """
    # Called from inside the live-only branch, so there is no flag to test here.
    head('The isolation attack: a host tries to reach another venue')
    tool = os.path.join(ROOT, 'tools', 'tenant-isolation-attack.py')
    # READ THE PATH OUT OF THE TOOL, never guess it. My first version looked for
    # ~/.vp-test-host-password, which does not exist, so this printed NOT CHECKED while the tool
    # itself ran perfectly well minutes earlier. A check that reports "cannot run" when it can is
    # the same fault as one that reports "fine" when it is not: either way nobody learns anything.
    pw = os.path.join(os.path.expanduser('~'), '.gflam-migrate', 'test-host.pass')
    if not os.path.isfile(tool):
        ok('the isolation attack tool exists', False, why='tools/tenant-isolation-attack.py is missing')
        return
    if not os.path.isfile(pw):
        note('isolation attack: NOT CHECKED',
             'no test host password on this machine, so nobody signed in. Deliberately not a '
             'pass: run venueplay-backend/tools/make-test-host.py, then this tool, where the '
             'credentials are.')
        return
    r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=600)
    out = ((r.stdout or '') + (r.stderr or '')).strip()
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    bad = [l for l in lines if l.startswith('FAIL') or 'LEAK' in l]
    n = len([l for l in lines if l.startswith('ok ')])
    # A crash is not a pass. Traceback means the tool could not attack at all.
    crashed = 'Traceback' in out or r.returncode not in (0,)
    ok('no signed-in host can reach another venue (%d checks)' % n,
       not crashed and not bad and 'No leak found' in out,
       detail=('; '.join(bad[:2]) if bad else (lines[-1] if lines else 'no output')),
       why='run python3 tools/tenant-isolation-attack.py. If it crashed rather than failed, the '
           'attack never happened, which is not the same as nothing being wrong')

    # AND CAN IT STILL FAIL? Three of its six data lines could not, for ten days, because they
    # looked for a venue_id those tables do not have (audit, 20 Sep 2026). --prove tells it the
    # test venue's own members list is somebody else's. The host can read those members, so a
    # detector that works has to shout LEAK. One that stays green here is decoration.
    rp = subprocess.run([sys.executable, tool, '--prove'], capture_output=True, text=True, timeout=600)
    outp = (rp.stdout or '') + (rp.stderr or '')
    ok('and the members isolation check goes red when it is shown a foreign row',
       'Traceback' not in outp and any('LEAK' in l and 'members' in l for l in outp.splitlines()),
       detail='blinded on purpose, it said: ' + (([l.strip() for l in outp.splitlines() if 'members' in l] or ['nothing'])[0][:90]),
       why='tools/tenant-isolation-attack.py --prove must report a LEAK for members. If it does '
           'not, the members line is measuring an empty table again and proves nothing')


def every_active_venue_knows_its_state():
    """THE COMPLIANCE CARD THAT CANNOT NAME THE REGULATOR.

    Before bingo, musical bingo, a raffle or a members draw, vp-gaming.js shows the
    host their own state's rules. Which state comes from vp_venues.au_state, derived
    by the Worker from the venue's postcode. No postcode, no state, and the card says
    "We do not know which state this venue is in yet."

    Nothing goes red when that happens. The night runs. On a product whose gaming card
    exists because of Queensland's OLGR, that sentence is the one it must never show.

    Found on 11 Sep 2026 by running a real raffle on a test venue and READING the card,
    which is the only way it could have been found: no check in this repo looked at it.
    Four active venues were in that state, tugun-bowls among them.

    Separate tool, same reason as the stale-session check: it needs the service
    credentials this one deliberately does not carry. The public key reads vp_venues
    and gets zero rows, so a version built on the public key would pass for ever.
    """
    head('Every active venue can be shown its own state\'s gaming rules')
    tool = os.path.join(ROOT, 'venueplay-backend', 'tools', 'check-gaming-state.py')
    env_file = os.path.join(os.path.expanduser('~'), '.gflam-migrate.env')
    if not os.path.exists(tool):
        ok('the gaming state check exists', False,
           why='venueplay-backend/tools/check-gaming-state.py is missing')
        return
    if not os.path.exists(env_file):
        note('gaming state: NOT CHECKED',
             'no ~/.gflam-migrate.env on this machine, so the database was never asked. '
             'This is deliberately not a pass: run check-gaming-state.py where the '
             'credentials are.')
        return
    r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=180)
    out = (r.stdout or '') + (r.stderr or '')
    last = [l for l in out.splitlines() if l.strip()]
    tail = last[-1].strip() if last else 'no output'
    ok('no active venue is told we do not know its state', r.returncode == 0,
       detail=re.sub(r'\033\[[0-9;]*m', '', tail),
       why='run venueplay-backend/tools/check-gaming-state.py for which venue')


def stripe_fields_still_exist():
    """EVERY STRIPE FIELD THIS CODE READS, AGAINST REAL OBJECTS.

    Dean, 11 Sep 2026: "FML! Seriously you picked up old stripe code this morning. I told
    you to audit the billing." He was right. Stripe moved and removed fields in the 2025
    API versions and this repo had been bitten three times, each found by accident:
    subscription.current_period_end (moved onto the item), discount.coupon (now under
    source.coupon), and invoice.paid (gone), which broke live-overage-test.py in BOTH
    directions at once and reported the first overage ever collected as a failure.

    Fixing them one at a time is not an audit. This runs the sweep.
    """
    head('Every Stripe field this code reads still exists')
    tool = os.path.join(ROOT, 'venueplay-backend', 'tools', 'check-stripe-fields.py')
    env_file = os.path.join(os.path.expanduser('~'), '.gflam-migrate.env')
    if not os.path.exists(tool):
        ok('the Stripe field check exists', False, why='check-stripe-fields.py is missing')
        return
    if not os.path.exists(env_file):
        note('Stripe fields: NOT CHECKED',
             'no ~/.gflam-migrate.env on this machine, so Stripe was never asked. '
             'Deliberately not a pass.')
        return
    r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=180)
    out = re.sub(r'\033\[[0-9;]*m', '', (r.stdout or '') + (r.stderr or ''))
    last = [l for l in out.splitlines() if l.strip()]
    ok('no field is read that Stripe no longer sends', r.returncode == 0,
       detail=last[-1].strip() if last else 'no output',
       why='run venueplay-backend/tools/check-stripe-fields.py for which field and which line')


def nobody_paid_and_got_nothing():
    """PartyPlay is delivered by ONE email. A failed send is a log line nobody reads.

    The webhook catches a failed sendLicenceEmail on purpose, and that is right: an
    email that will not send must not undo a payment or make Stripe retry a webhook
    that already granted the licence. But it means the row stays 'paid', the buyer
    has no code and no host key, and nothing inside the business knows. The first
    anyone hears is somebody asking where their party went, if they bother.
    """
    head('Every browser key actually works against the project it is paired with')
    """A URL FROM ONE PROJECT AND A KEY FROM ANOTHER IS SILENT UNTIL SOMEBODY PLAYS.

    The Sydney move rewrote partyplay/lib/pp-config.js SUPA_URL and updated VenuePlay's
    publishable key, and missed PartyPlay's. The URL said Sydney, the key still belonged to
    SINGAPORE, and Supabase answered every browser request 401.

    That is the whole of PartyPlay. Host console, television and every guest phone talk over
    one realtime channel and nothing else, so a host pressing Call a number reached nobody.
    The WORKER was fine the entire time, because it uses the service key from its own
    environment: /health said ok, licence emails went out, and the gate was green.

    Nothing here could have caught it, because every existing check either read files or
    asked the Worker. So this asks SUPABASE, with the key a browser is actually handed.
    Found 12 Sep 2026 by opening play.html and watching a channel fail."""
    import urllib.request as _u, urllib.error as _ue
    pairs = []
    for label, rel, url_re, key_re in (
            ('PartyPlay', os.path.join('partyplay', 'lib', 'pp-config.js'),
             r"SUPA_URL:\s*'([^']+)'", r"SUPA_ANON:\s*'([^']+)'"),
            ('VenuePlay', os.path.join('venueplay', 'app', 'vp-session.js'),
             r"SUPA_URL\s*=\s*[\"']([^\"']+)", r"SUPA_ANON\s*=\s*[\"']([^\"']+)")):
        f = os.path.join(ROOT, rel)
        if not os.path.isfile(f):
            continue
        src = io.open(f, encoding='utf-8').read()
        mu, mk = re.search(url_re, src), re.search(key_re, src)
        if mu and mk:
            pairs.append((label, rel, mu.group(1).rstrip('/'), mk.group(1)))
    ok('both products declare a project and a browser key', len(pairs) == 2,
       '%d found' % len(pairs))
    for label, rel, url, key in pairs:
        try:
            # /auth/v1/settings, NOT /rest/v1/. The first version of this asked the REST
            # root, which answers 401 "Only secret API keys can be used for this endpoint"
            # for ANY publishable key, so it failed on VenuePlay too, which I knew was
            # working. A check that fails on known-good code gets switched off.
            # This one answers 200 for a good publishable key and 401 for a bad one,
            # verified both ways before it was written down.
            rq = _u.Request(url + '/auth/v1/settings',
                            headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                                     'User-Agent': 'VenuePlay-gate/1.0'})
            code = _u.urlopen(rq, timeout=20).status
        except _ue.HTTPError as x:
            code = x.code
        except Exception as x:
            note('%s browser key: NOT CHECKED' % label, str(x)[:90]); continue
        ok('%s: its browser key is accepted by the project its URL names' % label,
           code < 400, 'HTTP %s from %s' % (code, url.split('//')[-1].split('.')[0]),
           why='a 401 here means every realtime channel and every browser read is dead, '
               'while the Worker and /health stay perfectly healthy')

    """AND THE KEY A BROWSER IS ACTUALLY HANDED IS THE ONE IN THIS REPO.

    Everything above reads the repo copy. If the deployed copy is stale, the repo is right,
    the key it names works, the check is green, and every browser is still being handed the
    old one. That is the Sydney fault moved one step along: nothing in the gate compared the
    file a browser downloads with the file we think we shipped.

    shared_scripts_live already proves these serve as JavaScript and define their global. It
    does not look at what is IN them. Added 18 Sep 2026; both matched."""
    for label, rel, url, key in pairs:
        live_url = (PP if label == 'PartyPlay' else VP) + \
                   ('/lib/pp-config.js' if label == 'PartyPlay' else '/app/vp-session.js')
        status, body, _ = get(live_url)
        if status != 200 or not body:
            note('%s browser config: NOT CHECKED' % label, 'HTTP %s' % status)
            continue
        ok('%s: the config a browser downloads is the one in this repo' % label,
           url in body and key in body,
           'project %s' % url.split('//')[-1].split('.')[0],
           why='the deployed copy names a different project or key from the repo, so the '
               'gate is checking one file and every phone is running another')

    head('Nobody paid for a party and got nothing')
    tool = os.path.join(ROOT, 'partyplay-backend', 'tools', 'check-paid-not-delivered.py')
    env_file = os.path.join(os.path.expanduser('~'), '.gflam-migrate.env')
    if not os.path.exists(tool):
        ok('the undelivered-party check exists', False,
           why='partyplay-backend/tools/check-paid-not-delivered.py is missing')
        return
    if not os.path.exists(env_file):
        note('undelivered parties: NOT CHECKED',
             'no ~/.gflam-migrate.env on this machine, so the database was never asked. '
             'Deliberately not a pass.')
        return
    r = subprocess.run([sys.executable, tool], capture_output=True, text=True, timeout=180)
    out = (r.stdout or '') + (r.stderr or '')
    last = [l for l in out.splitlines() if l.strip()]
    tail = last[-1].strip() if last else 'no output'
    ok('every paid party was sent its code', r.returncode == 0, detail=tail,
       why='run partyplay-backend/tools/check-paid-not-delivered.py for who, and resend with /licence/resend')


def admin_routes_refuse():
    head('Admin and money routes must refuse a stranger')
    # THE LIST WAS SHORT BY FOUR. Found 18 Sep 2026 by asking which routes in the Worker
    # no suite and no check here mentions at all: /admin/party, /admin/party/do,
    # /admin/followups and /admin/send-albums were four admin routes nothing was watching.
    # Reading them showed all four do call adminActor, so nothing was open. That is not the
    # same as being checked: the reason the other four are on this list is that somebody
    # would notice if they changed, and these four had nobody.
    #
    # /admin/send-albums EMAILS GUESTS, so it is the one that matters most and the one I
    # read hardest before probing it. adminActor runs before anything is sent.
    for path, method in [('/admin/stats', 'GET'), ('/admin/whoami', 'GET'),
                         ('/admin/staff', 'GET'), ('/admin/party', 'GET')]:
        status, body, _ = get(PP_API + path)
        ok('PartyPlay %s refuses' % path, status == 403, why='HTTP %s' % status)
    for path in ['/admin/staff/add', '/admin/staff/off', '/admin/comp', '/admin/nudge-expiring',
                 '/admin/party/do', '/admin/send-albums', '/admin/followups']:
        status, body = post(PP_API + path, {})
        ok('PartyPlay %s refuses' % path, status == 403,
           why='HTTP %s %s' % (status, body[:60]))

    # AND THE HOST-KEY ROUTES. requireHost throws 403 on a short or missing key and compares
    # the real one with timingSafeEqual, which is right. Nothing was checking it stayed that
    # way. A 500 here would mean it threw before it checked, which is how a broken route
    # hides: refused, but for the wrong reason, and one refactor from not refusing.
    for path in ['/photos/pick', '/games']:
        status, body, _ = get(PP_API + path + '?code=ZZZZZZ&key=x')
        ok('PartyPlay %s refuses without a host key' % path, status in (403, 404),
           why='HTTP %s %s: a 500 means it threw before it checked' % (status, body[:50]))

    # The album is reached by a share link, not a login, so the link itself is the key.
    status, body, _ = get(PP_API + '/album/photo?share=short&id=1')
    ok('PartyPlay /album/photo refuses a short share key', status in (400, 404, 503),
       why='HTTP %s %s' % (status, body[:50]))

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
  This tool cannot open a browser. HALF of that gap is now closed by
  tools/verify-live.py, which drives a real headless Chrome through
  venueplay/screen-check.html and asserts what the venue screens actually
  PAINT. Run it after the deploy lands. It is the only thing in this repo that
  caught the three faults of 16 Sep, all of which read correctly in the file
  and left all 292 checks here green.

  The other half is still a person in a room. After a release that touches a
  game, a screen or a phone, somebody has to:

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

    7. NOT EVERY TIME, but before a release that matters and after adding a
       check: python3 tools/prove-checks.py

       It breaks the thing each check watches, in a scratch copy, and requires
       that check to go red. A check that cannot fail is worse than no check,
       because the green line says the job was done. It takes about fifteen
       minutes and it has already caught a live one: the win fanfare was silent
       on all eight screens for half a day because a shared script was called
       and never loaded, and the check that should have said so skipped any
       script a page did not load at all.

  Nothing is deployed until step 5 says so. "I pasted it" is not evidence;
  /health answering with the right build is.""")
    return 1 if failed else 0


def someone_actually_looked_at_a_screen():
    """HAS ANYBODY OPENED THE SCREEN SINCE THIS COMMIT TOUCHED IT?

    Every other check in this file reads a file or asks a server a question. Not one of
    them can see what a television in a pub is PAINTING, and on 16 September 2026 three
    separate faults shipped through a completely green run of this tool, one of which
    left a live venue's screen with no working connection status for a day.

    tools/verify-live.py closes that gap: it drives a real headless Chrome through
    venueplay/screen-check.html and writes .verify-live.json when every screen passes.
    This check is the part that makes it happen rather than hoping somebody remembers.

    It only fires AFTER a deploy, never before a push. Before the push the screens are
    still running the OLD build, so looking at them proves nothing about the change in
    hand, and a check that is red at a moment nobody can fix it is a check people learn
    to click past.
    """
    watched = ('venueplay/tv.html', 'venueplay/app/trivia/screen.html',
               'venueplay/app/musical/screen.html', 'venueplay/app/raffle/screen.html',
               'venueplay/app/members/screen.html', 'venueplay/app/vp-',
               'venueplay/screen-check.html',
               'partyplay/tv.html', 'partyplay/play.html', 'partyplay/host.html',
               'partyplay/practice.html', 'partyplay/index.html',
               'partyplay/screen-check.html')
    try:
        here = subprocess.run(['git', '-C', ROOT, 'rev-parse', 'HEAD'],
                              capture_output=True, text=True).stdout.strip()
    except Exception:
        return
    if not here:
        return
    stamp = {}
    try:
        with io.open(os.path.join(ROOT, '.verify-live.json'), encoding='utf-8') as f:
            stamp = json.load(f)
    except Exception:
        pass
    if stamp.get('commit') == here:
        head('Somebody has actually looked at the screens')
        ok('a real browser has checked the venue screens on this build', True,
           detail='%s, %s' % (stamp.get('when', ''), ', '.join(stamp.get('venues', []))))
        return

    since = stamp.get('commit') or 'HEAD~1'
    try:
        diff = subprocess.run(['git', '-C', ROOT, 'diff', '--name-only', since, here],
                              capture_output=True, text=True).stdout.splitlines()
    except Exception:
        diff = []
    touched = sorted({f.strip() for f in diff
                      if any(f.strip().startswith(w) for w in watched)})
    if not touched:
        return                       # nothing that paints on a wall has moved

    head('Somebody has actually looked at the screens')
    ok('a real browser has checked the venue screens on this build', False,
       why=('%s changed and no browser has seen the result. Run:  '
            'python3 tools/verify-live.py --stamp'
            % ', '.join(os.path.basename(t) for t in touched[:4])))


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
    # Say it out loud if the scanner did not load. Everything that depends on it
    # would otherwise just quietly check less, and the run would still end in a
    # green summary line.
    if _SCANNER_ERROR:
        head('The tools this gate is built from')
        ok('the comment scanner loads', False, why=_SCANNER_ERROR)

    if not live_only:
        local_checks(which)
    if not local_only:
        if wait:
            wait_for_deploy()
        if which in ('both', 'venueplay'):
            # EVERY COLUMN THE CODE NAMES, ASKED OF THE LIVE DATABASE.
            #
            # Three of the worst faults found on 5 Sep were one thing: a column the
            # database does not have. PostgREST rejects the whole statement and the
            # code turns that into an empty list or swallows it, so nothing looks
            # broken. Nobody could START A PARTYPLAY PARTY they had paid for; the
            # members draw announced the RESET jackpot to a room that had just been
            # told the winner took $2,400; HQ reported zero games on every night
            # ever recorded.
            #
            # check-schema.py existed, covered 65 of ~400 column references, could
            # not see write bodies or order= clauses by its own admission, did not
            # look at PartyPlay at all, and was never wired in here.
            # CAN A STRANGER CHANGE WHAT THE PUBLIC SITES SHOW? The gate had a check
            # for whether the public key could READ these tables and none for
            # whether it could WRITE, so the worst hole found on 5 Sep -- an empty
            # POST to /reviews returning 201 Created with stars = 5, rendering
            # immediately on a customer-facing page -- was invisible to it.
            _cw = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'check-writes.py')],
                                 capture_output=True, text=True, cwd=ROOT)
            _wo = re.sub(r'\033\[[0-9;]*m', '', _cw.stdout + _cw.stderr)
            _wsum = [l.strip() for l in _wo.splitlines() if 'finding(s)' in l]
            _wbad = [l.strip() for l in _wo.splitlines() if 'THE PUBLIC KEY CAN' in l or l.strip().startswith('STOP')]
            ok('a stranger cannot change what the public sites show',
               _cw.returncode == 0, _wsum[0] if _wsum else '',
               why=('; '.join(_wbad[:3]) if _wbad else
                    ('the checker could not run: ' + (_wo.strip().splitlines() or [''])[-1][:90])))

            _cc = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'check-columns.py')],
                                 capture_output=True, text=True, cwd=ROOT)
            _out = re.sub(r'\033\[[0-9;]*m', '', _cc.stdout + _cc.stderr)
            _sum = [l.strip() for l in _out.splitlines() if ' present,' in l]
            _miss = [l.strip() for l in _out.splitlines() if 'MISSING' in l or 'NO TABLE' in l]
            ok('every column the code names exists in the live database',
               _cc.returncode == 0,
               _sum[0] if _sum else '',
               why=('; '.join(_miss[:3]) if _miss else
                    ('the checker itself could not run: ' + _out.strip().splitlines()[-1][:90]
                     if _out.strip() else 'no output')))
            # A SCHEDULED HANDLER THAT NO CRON CALLS IS DEAD CODE THAT LOOKS ALIVE.
            # The 30 day album sweep sat in the PartyPlay Worker, written and correct and
            # exported, and never ran once, because nobody had added a Cron Trigger in a
            # dashboard. Nothing in this repo could see it. Three sweeps hang off the game
            # Worker's scheduled handler now and one of them is the 90 day deletion of a
            # closed venue's player list that the privacy page promises.
            _cr = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'check-cron-triggers.py')],
                                 capture_output=True, text=True, cwd=ROOT, timeout=180)
            _cro = re.sub(r'\033\[[0-9;]*m', '', _cr.stdout + _cr.stderr)
            _crbad = [l.strip() for l in _cro.splitlines()
                      if 'NO TRIGGER' in l or 'COULD NOT ASK' in l or l.strip().startswith('STOP')]
            _crok = [l.strip() for l in _cro.splitlines() if l.strip().startswith('ok')]
            ok('every scheduled job has a cron that calls it',
               _cr.returncode == 0,
               '%d Worker(s) with a trigger' % len(_crok),
               why=('; '.join(_crbad[:3]) if _crbad else
                    'the checker could not run: ' + (_cro.strip().splitlines() or [''])[-1][:90]))

            # AND IS THE PARTYPLAY SWEEP ACTUALLY KEEPING UP? The gate checks the code is
            # there and that a cron calls it. Neither says whether it WORKS. runPhotoSweep
            # returns {ok:false} into a scheduled handler nobody reads, so a sweep that is
            # throwing looks exactly like one with nothing to do, and the only symptom is
            # guest email addresses still sitting in a table a month after the page said
            # they went. This asks the database instead.
            _pr = os.path.join(ROOT, 'partyplay-backend', 'tools', 'check-partyplay-retention.py')
            if os.path.isfile(_pr):
                _prr = subprocess.run([sys.executable, _pr], capture_output=True, text=True,
                                      cwd=ROOT, timeout=180)
                _pro = re.sub(r'\033\[[0-9;]*m', '', _prr.stdout + _prr.stderr)
                _prbad = [l.strip() for l in _pro.splitlines()
                          if 'STILL HERE' in l or l.strip().startswith('STOP')]
                _prnear = [l.strip() for l in _pro.splitlines() if 'closest is' in l]
                ok('a finished party is not still holding its guests',
                   _prr.returncode == 0,
                   (_prnear[0][:60] if _prnear else ''),
                   why=('; '.join(_prbad[:3]) if _prbad else
                        'the checker could not run: ' + (_pro.strip().splitlines() or [''])[-1][:90]))

            pages_live('VenuePlay', VP, VP_PAGES)
            shared_scripts_live(VP, os.path.join(ROOT, 'venueplay', 'app'))
            every_page_is_reachable('VenuePlay', VP, 'venueplay',
                                    skip=('test.html',))
            worker_health('VenuePlay game', VP_GAME)
            worker_health('VenuePlay billing', VP_API)
            one_address_check()
            cors_checks('VenuePlay', VP_GAME, '/play/live',
                        ['https://venueplay.com.au', 'https://www.venueplay.com.au'])
            each_worker_is_the_right_worker()
            venue_codes_are_unique()
            founding_windows_are_open()
            no_session_left_open()
            nobody_can_reach_another_venue()
            every_active_venue_knows_its_state()
            stripe_fields_still_exist()
            someone_actually_looked_at_a_screen()
        if which in ('both', 'partyplay'):
            pages_live('PartyPlay', PP, PP_PAGES)
            # PARTYPLAY'S SHARED SCRIPTS WERE NEVER CHECKED. Cloudflare Pages answers a path
            # it does not have with the HOMEPAGE and a 200, so one that failed to deploy does
            # not 404: the browser fetches HTML, cannot parse it, and the global is simply
            # missing. That is how vp-qr.js behaved on 2 Sep. pp-games.js failing that way
            # would put every game's database slug on the television, which is the exact
            # fault lib/pp-games.js was created to stop.
            shared_scripts_live(PP, os.path.join(ROOT, 'partyplay', 'lib'), '/lib/')
            every_page_is_reachable('PartyPlay', PP, 'partyplay')
            worker_health('PartyPlay', PP_API)
            nobody_paid_and_got_nothing()
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
