#!/usr/bin/env python3
"""DID IT ACTUALLY WORK, ON A REAL SCREEN?

release-check.py has said, in its own closing paragraph, that it cannot open a browser,
and that after a release which touches a game or a screen somebody has to go and look.
On 16 September 2026 that sentence cost a live venue a day.

Three faults shipped that morning and every one of them read correctly in the file:

  - a CONNECTING badge painted across the sales page, because a markup hidden attribute
    lost to a display:flex twenty lines above it
  - the venue name missing from four game walls, because the code sat inside a function
    that returns early when there is no slug, and a demo has no slug on purpose
  - tvStatus declared inside an if, so it was only bound when that if ran, and Tugun
    Bowls Club's television spent the day throwing "tvStatus is not a function" out of
    its connection handler: no status, no transport recorded, and no way to mark itself
    deaf when the channel closed

All 292 checks in the gate were green through all three. The only thing that could see
them was venueplay/screen-check.html, which renders the real screen and asserts what is
PAINTED, and that is a page a person has to remember to open.

This runs that page from the command line, in a real headless Chrome, in REAL TIME, and
turns it into an exit code. Nobody has to remember anything.

  python3 tools/verify-live.py                    the venues that have real screens
  python3 tools/verify-live.py --all              every active venue
  python3 tools/verify-live.py --venue wellshot-hotel
  python3 tools/verify-live.py --stamp            record a pass for this commit

WHY NOT --dump-dom AND --virtual-time-budget, which is three lines instead of two hundred:
because Chrome's virtual clock races ahead while a WebSocket sits open and idle, so the
forty second watch elapses before Supabase has had any real time to answer. Tried first,
and it reported Tugun as FAILED on the two checks that had just been fixed and proven by
hand. A check that cries wolf on the one thing it exists to watch is worse than no check,
so this drives Chrome over the debug protocol and waits in real seconds.
"""

import argparse
import base64
import io
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SITE = 'https://venueplay.com.au'
PARTY = 'https://partyplay.com.au'
STAMP = os.path.join(ROOT, '.verify-live.json')

# THE SCREENS THAT ARE REAL. Every other active venue in the database is a test account
# somebody made on a laptop; running all seventeen takes half an hour and tells you
# nothing new, because tv.html is the same file for all of them. --all is there for when
# a change could plausibly land differently per venue (advertising, logos, a slug fix).
REAL_SCREENS = ['tugun-bowls', 'wellshot-hotel']

# PartyPlay has ONE check and no venues, because it has no venues: a party is a licence
# somebody paid for. Its check drives /practice, which is the same 90 ball engine with
# three made-up guests and no licence, plus the telly, the join page and the page that
# takes the money. The ten games themselves still need a real party and a real room.
PARTYPLAY_CHECK = PARTY + '/screen-check'

# Any change under these paths is a change a person would have had to go and look at.
WATCHED = (
    'venueplay/tv.html',
    'venueplay/app/trivia/screen.html',
    'venueplay/app/musical/screen.html',
    'venueplay/app/raffle/screen.html',
    'venueplay/app/members/screen.html',
    'venueplay/app/vp-',
    'venueplay/screen-check.html',
    'partyplay/tv.html',
    'partyplay/play.html',
    'partyplay/host.html',
    'partyplay/practice.html',
    'partyplay/index.html',
    'partyplay/screen-check.html',
)

GREEN, RED, DIM, YELL, OFF = '\033[32m', '\033[31m', '\033[2m', '\033[33m', '\033[0m'


class WS(object):
    """The smallest WebSocket client that can carry the debug protocol.

    Python 3.9 on this machine has no websocket library and there is no pip install in
    the deploy path, so the handshake and the frames are done here. It only ever speaks
    to Chrome on 127.0.0.1, so there is no TLS and no fragmentation handling.
    """

    def __init__(self, url, timeout=60):
        rest = url.split('://', 1)[1]
        hostport, _, path = rest.partition('/')
        host, port = hostport.split(':')
        self.s = socket.create_connection((host, int(port)), timeout=timeout)
        self.s.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n'
                        'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
                        'Sec-WebSocket-Version: 13\r\n\r\n' % (path, hostport, key)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise IOError('Chrome closed the debug socket during the handshake')
            buf += chunk
        self.buf = buf.split(b'\r\n\r\n', 1)[1]

    def _read(self, n):
        while len(self.buf) < n:
            d = self.s.recv(65536)
            if not d:
                raise IOError('Chrome closed the debug socket')
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, obj):
        p = json.dumps(obj).encode()
        h = bytearray([0x81])
        n = len(p)
        if n < 126:
            h.append(0x80 | n)
        elif n < 65536:
            h.append(0x80 | 126); h += struct.pack('>H', n)
        else:
            h.append(0x80 | 127); h += struct.pack('>Q', n)
        m = os.urandom(4); h += m
        self.s.sendall(bytes(h) + bytes(b ^ m[i % 4] for i, b in enumerate(p)))

    def recv(self):
        while True:
            b0, b1 = self._read(2)
            n = b1 & 127
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            if b1 & 0x80:
                self._read(4)
            payload = self._read(n)
            op = b0 & 0x0F
            if op == 1:
                return json.loads(payload.decode('utf-8', 'replace'))
            if op == 8:
                raise IOError('Chrome closed the debug socket')

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass


class Browser(object):
    def __init__(self):
        if not os.path.exists(CHROME):
            raise SystemExit('Google Chrome is not at %s. This tool needs a real browser;\n'
                             'there is no way to check what a screen PAINTS without one.' % CHROME)
        self.profile = tempfile.mkdtemp(prefix='verify-live-')
        self.port = self._free_port()
        self.proc = subprocess.Popen(
            [CHROME, '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run',
             '--no-default-browser-check', '--window-size=1280,800',
             '--user-data-dir=' + self.profile,
             '--remote-debugging-port=%d' % self.port, 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ver = None
        for _ in range(80):
            try:
                ver = json.loads(urllib.request.urlopen(
                    'http://127.0.0.1:%d/json/version' % self.port, timeout=2).read())
                break
            except Exception:
                time.sleep(0.5)
        if not ver:
            self.close()
            raise SystemExit('Chrome would not open its debug port. Nothing was checked.')
        self.ws = WS(ver['webSocketDebuggerUrl'])
        self.n = 0

    @staticmethod
    def _free_port():
        # A FIXED PORT IS A RACE. release-check and this tool can both be running, and
        # prove-checks.py runs the gate over and over. Two Chromes on 9222 means the
        # second one silently attaches to the first one's tabs.
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        p = s.getsockname()[1]
        s.close()
        return p

    def call(self, method, params=None, session=None):
        self.n += 1
        msg = {'id': self.n, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        self.ws.send(msg)
        while True:
            m = self.ws.recv()
            if m.get('id') == self.n:
                if 'error' in m:
                    raise IOError('%s: %s' % (method, m['error']))
                return m.get('result', {})

    def open_tab(self, url):
        tid = self.call('Target.createTarget', {'url': url})['targetId']
        sid = self.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        return tid, sid

    def eval(self, session, expr):
        r = self.call('Runtime.evaluate',
                      {'expression': expr, 'returnByValue': True, 'awaitPromise': False},
                      session=session)
        return r.get('result', {}).get('value')

    def close_tab(self, tid):
        try:
            self.call('Target.closeTarget', {'targetId': tid})
        except Exception:
            pass

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
        try:
            self.proc.terminate()
            self.proc.wait(timeout=10)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        shutil.rmtree(self.profile, ignore_errors=True)


# The page writes its rows as <div class="row ok|bad|info"><div class="tag">..</div>
# <div><div>TEXT</div><div class="why">WHY</div></div></div>. Read them out of the live
# DOM rather than the HTML source, because half of them do not exist until it has run.
READ_ROWS = """
(function () {
  var v = document.getElementById('verdict');
  var rows = [].map.call(document.querySelectorAll('#out .row'), function (r) {
    var t = r.querySelector('.tag'), w = r.querySelector('.why'),
        h = r.querySelector('div > div');
    return { kind: (r.className.split(' ')[1] || ''),
             tag: t ? t.textContent.trim() : '',
             text: h ? h.textContent.trim() : '',
             why: w ? w.textContent.trim() : '' };
  });
  return JSON.stringify({ verdict: v ? v.textContent.trim() : '', rows: rows });
})()
"""


def check_one(br, slug, url, patience):
    tid, sid = br.open_tab(url)
    started = time.time()
    try:
        while True:
            time.sleep(5)
            try:
                raw = br.eval(sid, READ_ROWS)
            except Exception as e:
                return {'slug': slug, 'verdict': '', 'rows': [],
                        'broke': 'could not read the page: %s' % e}
            data = json.loads(raw) if raw else {'verdict': '', 'rows': []}
            verdict = data.get('verdict', '')
            if verdict and 'running' not in verdict.lower():
                data['slug'] = slug
                data['broke'] = ''
                data['seconds'] = int(time.time() - started)
                return data
            if time.time() - started > patience:
                # NEVER REPORT A HALF RUN AS A PASS. An hour after the screen-check was
                # written I read it while it was still going, saw nothing but green, and
                # said the four game walls were fine. Two of them had not been checked
                # yet. An unfinished run is a FAILURE to check, which is its own red.
                data['slug'] = slug
                data['broke'] = ('the check never finished. It reached %d of its rows in %d '
                                 'seconds and the verdict still said "%s"'
                                 % (len(data.get('rows', [])), int(time.time() - started),
                                    verdict or 'nothing'))
                return data
    finally:
        br.close_tab(tid)


def changed_files(ref):
    try:
        out = subprocess.run(['git', '-C', ROOT, 'diff', '--name-only', ref],
                             capture_output=True, text=True)
        return [l.strip() for l in out.stdout.splitlines() if l.strip()]
    except Exception:
        return []


def head():
    try:
        return subprocess.run(['git', '-C', ROOT, 'rev-parse', 'HEAD'],
                              capture_output=True, text=True).stdout.strip()
    except Exception:
        return ''


def read_stamp():
    try:
        with open(STAMP) as f:
            return json.load(f)
    except Exception:
        return {}


def deploy_has_landed():
    """Is the LIVE site actually serving the code in this working copy?

    --stamp used to write the local git HEAD with no check at all. So the honest
    sequence (push, then verify) produced a DISHONEST stamp: Cloudflare Pages takes
    three to twenty-five minutes, the browser drove the PREVIOUS build, it passed,
    and the new commit was recorded as browser-checked. The gate then printed "a real
    browser has checked the venue screens on this build" and it was not true.

    That is the exact shape this repo exists to stamp out: a check that cannot fail,
    dressed as a green line. Caught 19 Sep 2026 while changing vp-session.js, which
    every console loads, and the stamp written at 12:31 that day was already false.
    (Harmlessly: that commit touched no screen file. The next one would not have been.)

    So compare what is LIVE against what is on disk, for the files the stamp is a
    claim about: the shared vp-*.js scripts and the screen pages. Any difference and
    the deploy has not landed, so there is nothing honest to stamp yet.

    Returns (ok, [list of files that differ]).
    """
    import hashlib
    watched = []
    appdir = os.path.join(ROOT, 'venueplay', 'app')
    for fn in sorted(os.listdir(appdir)):
        if fn.startswith('vp-') and fn.endswith('.js'):
            watched.append(('venueplay/app/' + fn, '/app/' + fn))
    # Cloudflare Pages serves .html at an EXTENSIONLESS path and 308s the .html form,
    # and index.html at the directory. Asking for the file name gets a redirect, which
    # read as "could not fetch" and would have failed the guard for the wrong reason.
    for rel in ('venueplay/tv.html', 'venueplay/app/index.html',
                'venueplay/app/members/host.html'):
        if not os.path.isfile(os.path.join(ROOT, rel)):
            continue
        path = '/' + rel.split('venueplay/', 1)[1]
        if path.endswith('/index.html'):
            path = path[:-len('index.html')]
        elif path.endswith('.html'):
            path = path[:-len('.html')]
        watched.append((rel, path))

    def normalise(b):
        """Cloudflare REWRITES HTML on the way out, so live is never byte-identical.

        It obfuscates email addresses: hello@venueplay.com.au becomes an
        <a class="__cf_email__" data-cfemail="..."> link, and a decode script is
        injected near the end of the document. Comparing raw bytes therefore reported
        EVERY html file as stale, for ever, which would have blocked stamping
        altogether. A check that always fails is no better than one that cannot.

        Flatten both sides to the same shape before comparing. .js is served verbatim
        and is unaffected.
        """
        t = b.decode('utf-8', 'replace')
        # Match each injected tag through its CLOSING tag, not with [^>]*. The beacon
        # carries data-cf-beacon='{...json...}', so an attribute-by-attribute pattern
        # is one stray > away from not matching, and a normaliser that silently stops
        # matching makes this guard refuse every html file with no explanation.
        t = re.sub(r'<script[^>]*email-decode[\s\S]*?</script>', '', t)
        t = re.sub(r'<a href="/cdn-cgi/l/email-protection"[^>]*>.*?</a>', 'EMAIL', t,
                   flags=re.S)
        t = re.sub(r'/cdn-cgi/l/email-protection[^"\']*', 'EMAIL', t)
        t = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'EMAIL', t)
        # Cloudflare injects a Web Analytics beacon too, with a build hash in the URL
        # that changes on their schedule and not ours. Two separate injections, and
        # missing either one makes this guard refuse every html file for ever.
        t = re.sub(r'<script[^>]*cloudflareinsights[\s\S]*?</script>', '', t)
        # Deleting an injected tag leaves the blank line it sat on, and all three html
        # files then differed by exactly one empty line. Compare CONTENT, not layout.
        t = re.sub(r'\s+', ' ', t).strip()
        return hashlib.sha256(t.encode('utf-8')).hexdigest()

    stale = []
    for rel, path in watched:
        try:
            with io.open(os.path.join(ROOT, rel), 'rb') as f:
                mine = normalise(f.read())
        except (IOError, OSError):
            continue
        try:
            req = urllib.request.Request(SITE + path, headers={
                'User-Agent': 'verify-live', 'Cache-Control': 'no-cache'})
            live = normalise(urllib.request.urlopen(req, timeout=20).read())
        except Exception as e:
            stale.append('%s (could not fetch: %s)' % (rel, str(e)[:40]))
            continue
        if live != mine:
            stale.append(rel)
    return (not stale), stale


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--venue', action='append', default=[],
                    help='a slug to check; repeatable. Default: %s' % ', '.join(REAL_SCREENS))
    ap.add_argument('--all', action='store_true', help='every ACTIVE venue in the database')
    ap.add_argument('--only', choices=('venueplay', 'partyplay'),
                    help='check one product instead of both')
    ap.add_argument('--patience', type=int, default=300,
                    help='seconds to let one venue run before calling it unfinished')
    ap.add_argument('--stamp', action='store_true',
                    help='on a clean pass, record this commit in .verify-live.json')
    args = ap.parse_args()

    venues = list(args.venue) or list(REAL_SCREENS)
    if args.all:
        sys.path.insert(0, os.path.join(ROOT, 'tools'))
        import urllib.request as u
        env = {}
        try:
            for line in open(os.path.expanduser('~/.gflam-migrate.env')):
                if '=' in line and not line.startswith('#'):
                    k, _, v = line.strip().partition('=')
                    env[k] = v
        except Exception:
            pass
        base, key = env.get('NEW_SUPABASE_URL'), env.get('NEW_SERVICE_KEY')
        if not base or not key:
            raise SystemExit('--all needs NEW_SUPABASE_URL and NEW_SERVICE_KEY in ~/.gflam-migrate.env')
        req = u.Request(base + '/rest/v1/vp_venues?select=slug&status=eq.active&order=slug',
                        headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        venues = [v['slug'] for v in json.loads(u.urlopen(req, timeout=20).read())]

    # (label, url) pairs. The label is what gets printed and what goes in the stamp.
    jobs = []
    if args.only != 'partyplay':
        jobs += [(s, '%s/screen-check?venue=%s' % (SITE, s)) for s in venues]
    if args.only != 'venueplay' and not args.venue and not args.all:
        jobs.append(('partyplay', PARTYPLAY_CHECK))
    if args.only == 'partyplay':
        jobs = [('partyplay', PARTYPLAY_CHECK)]

    print('\n%sThe screen check, run in a real browser%s' % (YELL, OFF))
    print('%s  %d page(s). A venue watches its screen for 40 seconds and then checks the four\n'
          '  game walls; PartyPlay plays thirty balls of its practice run. Allow a minute or\n'
          '  two apiece.%s\n' % (DIM, len(jobs), OFF))

    br = Browser()
    results = []
    try:
        for slug, url in jobs:
            sys.stdout.write('  %s ... ' % slug)
            sys.stdout.flush()
            r = check_one(br, slug, url, args.patience)
            results.append(r)
            reds = [x for x in r['rows'] if x['kind'] == 'bad']
            if r['broke']:
                print('%sCOULD NOT CHECK%s' % (RED, OFF))
                print('      %s%s%s' % (DIM, r['broke'], OFF))
            elif reds:
                print('%s%s%s  %s(%ds)%s' % (RED, r['verdict'], OFF, DIM, r.get('seconds', 0), OFF))
            else:
                print('%s%s%s  %s(%ds)%s' % (GREEN, r['verdict'], OFF, DIM, r.get('seconds', 0), OFF))
            for x in reds:
                print('      %sFAIL%s %s' % (RED, OFF, x['text']))
                if x['why']:
                    print('           %s%s%s' % (DIM, x['why'], OFF))
    finally:
        br.close()

    bad = [r for r in results if r['broke'] or any(x['kind'] == 'bad' for x in r['rows'])]
    print('')
    if bad:
        print('%sNOT OK. %d of %d screen(s) are wrong.%s' % (RED, len(bad), len(results), OFF))
        first = dict(jobs).get(bad[0]['slug'], SITE + '/screen-check')
        print('%s  Do not tell anybody this release is fine. Open\n'
              '  %s in a browser and watch it.%s' % (DIM, first, OFF))
        return 1

    print('%sEvery screen checked is painting what it should.%s' % (GREEN, OFF))
    if args.stamp:
        # REFUSE TO STAMP A BUILD THE BROWSER DID NOT SEE. See deploy_has_landed().
        landed, stale = deploy_has_landed()
        if not landed:
            print('')
            print('%sNOT STAMPED. The live site is not serving this working copy yet:%s'
                  % (YEL, OFF))
            for f in stale[:8]:
                print('   %s' % f)
            print('%s  Cloudflare Pages takes 3 to 25 minutes. The screens above were')
            print('  checked against the PREVIOUS build, so stamping this commit would')
            print('  be a lie. Wait for the deploy and run this again.%s' % OFF)
            return 1
        with open(STAMP, 'w') as f:
            json.dump({'commit': head(), 'when': time.strftime('%Y-%m-%d %H:%M:%S'),
                       'venues': [r['slug'] for r in results]}, f, indent=2)
        print('%s  recorded in .verify-live.json for %s%s' % (DIM, head()[:8], OFF))
    return 0


if __name__ == '__main__':
    sys.exit(main())
