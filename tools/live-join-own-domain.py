#!/usr/bin/env python3
"""A REAL JOIN AT A TEST VENUE, THROUGH game.venueplay.com.au, FROM HEADLESS CHROME (31 Oct 2026).

    python3 tools/live-join-own-domain.py                 the pages in THIS checkout, served as venueplay.com.au
    python3 tools/live-join-own-domain.py --live-pages    the pages venueplay.com.au is serving now (after a deploy)
    python3 tools/live-join-own-domain.py --venue test-bravo

The Workers got their own names on 31 Oct 2026 (Dean: no .dev links in anything a customer sees):
game.venueplay.com.au and api.venueplay.com.au are the same Workers as venueplay-game / venueplay-api
on dean-tindale.workers.dev. Tugun plays every week on a TV and phones, so before the pages move, this
plays the path a room uses, for real, at one of Dean's test venues (Test Alpha / Bravo; opening lobbies
and playing there is always fine):

  1. the test host signs in and opens a bingo lobby at the venue on game.venueplay.com.au
  2. a TV (tv.html?<slug>) and a phone (play.html?room=<code>) open in headless Chrome, both AS
     https://venueplay.com.au: without --live-pages every venueplay.com.au request is answered from
     this checkout (Chrome's Fetch domain), so the browser's origin, CORS and cookies are exactly the
     live site's while the page code is the branch's
  3. the phone types a name and taps Join; the TV shows the lobby with the venue's code
  4. every Worker call either page made is on game.venueplay.com.au (none on workers.dev), and the
     phone's room socket (wss://game.venueplay.com.au/room/ws) opened
  5. THE OLD ADDRESS STILL WORKS (the TV app and old pages): /play/live, a second phone's /join and
     /room/presence on venueplay-game.dean-tindale.workers.dev, and both names see the same room
  6. the lobby is closed again, on the new name

LIVE, and it writes: one session and two test players at a test venue, nothing else. Never a real
venue (it refuses any slug that does not start test-), never while that venue has a night open.
It takes /tmp/vp-heavy.lock for its Chrome (VP_WAIT_LOCK=<seconds> to wait for it).
"""
import base64, io, json, mimetypes, os, re, secrets, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'venueplay-backend', 'tools'))
import gatelib                     # noqa: E402
from vp_live import live           # noqa: E402
import importlib.util              # noqa: E402
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)

GAME = 'https://game.venueplay.com.au'
GAME_OLD = 'https://venueplay-game.dean-tindale.workers.dev'
SITE = 'https://venueplay.com.au'
UA = {'User-Agent': 'venueplay-live-join-own-domain/1.0', 'Content-Type': 'application/json'}
PASS_FILE = os.path.expanduser('~/.gflam-migrate/test-host.pass')
TEST_HOST_EMAIL = 'test-host@venueplay.invalid'
IPHONE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
             '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')

args = sys.argv[1:]
VENUE = args[args.index('--venue') + 1] if '--venue' in args else 'test-alpha'
LIVE_PAGES = '--live-pages' in args
if not VENUE.startswith('test-'):
    sys.exit('STOP: %s is not a test venue. This opens a lobby and joins phones; only test- venues.' % VENUE)

bad = 0
ran = 0


def ok(what, cond, saw=''):
    global bad, ran
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + what + (('   saw: ' + str(saw)[:300]) if (saw != '' and not cond) else ''), flush=True)
    if not cond:
        bad += 1
    return cond


def http(url, method='GET', body=None, headers=None, timeout=30):
    h = dict(UA); h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            t = r.read().decode('utf-8', 'replace'); st = r.status
    except urllib.error.HTTPError as e:
        t = e.read().decode('utf-8', 'replace'); st = e.code
    try:
        return st, json.loads(t)
    except Exception:
        return st, {'_text': t[:200]}


# ---------------------------------------------------------------- Chrome, answering venueplay.com.au from disk
def local_file(path):
    p = urllib.parse.urlparse(path).path
    if p in ('/app', '/app/'): p = '/app/index.html'
    elif p.endswith('/'): p += 'index.html'
    elif not os.path.splitext(p)[1]: p += '.html'
    f = os.path.normpath(os.path.join(ROOT, 'venueplay', p.lstrip('/')))
    return f if f.startswith(os.path.join(ROOT, 'venueplay')) and os.path.isfile(f) else None


class Chrome(VL.Browser):
    served = 0

    def handle(self, m):
        if m.get('method') != 'Fetch.requestPaused':
            return
        p, sid = m['params'], m.get('sessionId')
        url = p['request']['url']
        f = local_file(url[len(SITE):]) if url.startswith(SITE + '/') else None
        self.n += 1
        if f:
            body = io.open(f, 'rb').read()
            ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
            if f.endswith('.js'): ctype = 'application/javascript'
            self.ws.send({'id': self.n, 'sessionId': sid, 'method': 'Fetch.fulfillRequest', 'params': {
                'requestId': p['requestId'], 'responseCode': 200,
                'responseHeaders': [{'name': 'Content-Type', 'value': ctype}, {'name': 'Cache-Control', 'value': 'no-store'}],
                'body': base64.b64encode(body).decode()}})
            Chrome.served += 1
        else:
            self.ws.send({'id': self.n, 'sessionId': sid, 'method': 'Fetch.continueRequest', 'params': {'requestId': p['requestId']}})

    def call(self, method, params=None, session=None):
        self.n += 1
        want = self.n
        msg = {'id': want, 'method': method, 'params': params or {}}
        if session: msg['sessionId'] = session
        self.ws.send(msg)
        while True:
            m = self.ws.recv()
            if 'method' in m:
                self.handle(m); continue
            if m.get('id') == want:
                if 'error' in m: raise IOError('%s: %s' % (method, m['error']))
                return m.get('result', {})

    def tab(self, url, mobile=False):
        tid = self.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        sid = self.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        self.call('Page.enable', {}, session=sid)
        self.call('Runtime.enable', {}, session=sid)
        # Record every fetch and socket the page makes, before its own scripts run.
        self.call('Page.addScriptToEvaluateOnNewDocument', {'source': (
            'window.__net=[];window.__ws=[];(function(){var f=window.fetch;window.fetch=function(u,o){try{__net.push(String(u&&u.url||u))}catch(e){}return f.apply(this,arguments)};'
            'var W=window.WebSocket;window.WebSocket=function(u,p){var s=p?new W(u,p):new W(u);var r={u:String(u),open:false};__ws.push(r);'
            's.addEventListener("open",function(){r.open=true});return s};window.WebSocket.prototype=W.prototype;'
            'window.WebSocket.OPEN=1;window.WebSocket.CONNECTING=0;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;})();')}, session=sid)
        if mobile:
            self.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
            self.call('Emulation.setUserAgentOverride', {'userAgent': IPHONE_UA, 'platform': 'iPhone'}, session=sid)
        if not LIVE_PAGES:
            self.call('Fetch.enable', {'patterns': [{'urlPattern': SITE + '/*', 'requestStage': 'Request'}]}, session=sid)
        self.call('Page.navigate', {'url': url}, session=sid)
        return sid

    def ask(self, sid, expr):
        r = self.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True}, session=sid)
        return (r.get('result') or {}).get('value')

    def until(self, sid, expr, secs=30):
        end = time.time() + secs
        v = None
        while time.time() < end:
            try:
                v = self.ask(sid, expr)
            except Exception as e:
                v = 'error: %s' % e
            if v is True:
                return True
            time.sleep(0.4)
        return v


VISIBLE = ('(function(id){var e=document.getElementById(id);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')


def main():
    L = live()
    print('A real join at %s through %s, pages from %s' % (VENUE, GAME, 'venueplay.com.au as served now' if LIVE_PAGES else 'this checkout'))
    print('  ' + L.banner())
    st, h = http(GAME + '/health')
    ok('game.venueplay.com.au/health answers as venueplay-game', st == 200 and h.get('worker') == 'venueplay-game', (st, h))
    st, ho = http(GAME_OLD + '/health')
    ok('and the old address answers as the same build', st == 200 and ho.get('build') == h.get('build'), (h.get('build'), ho.get('build')))

    sb = lambda path: http(L.rest_url + '/rest/v1/' + path, headers={'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key})[1]
    vs = sb('vp_venues?slug=eq.%s&select=id,name,status' % VENUE)
    if not isinstance(vs, list) or not vs:
        sys.exit('STOP: no venue %s' % VENUE)
    venue = vs[0]
    open_now = sb('vp_sessions?venue_id=eq.%s&status=in.(lobby,running,paused)&select=id' % venue['id'])
    if open_now:
        sys.exit('STOP: %s has a session open (%s). Not touching it.' % (VENUE, open_now[0]['id']))
    st, d = http(L.rest_url + '/auth/v1/token?grant_type=password', 'POST',
                 {'email': TEST_HOST_EMAIL, 'password': io.open(PASS_FILE).read().strip()}, {'apikey': L.service_key})
    if st != 200:
        sys.exit('STOP: the test host could not sign in (%s)' % st)
    H = {'Authorization': 'Bearer ' + d['access_token']}

    if not gatelib.hold_lock_or_refuse('live-join-own-domain', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0'))):
        sys.exit(1)
    sid_ = None
    B = None
    try:
        st, s = http(GAME + '/session', 'POST', {'venue_id': venue['id'], 'format': 'bingo90'}, H)
        sid_, code = s.get('session_id'), s.get('join_code')
        if not ok('the host opens a bingo lobby at %s on game.venueplay.com.au' % venue['name'], st == 200 and sid_ and code, (st, s)):
            return
        st, pl = http(GAME + '/play/live?code=' + code)
        ok('/play/live on the new name finds the lobby', st == 200 and pl.get('live') is not False, (st, pl))
        st, plo = http(GAME_OLD + '/play/live?code=' + code)
        ok('/play/live on the OLD address finds the same lobby (the TV app, cached pages)', st == 200 and json.dumps(plo, sort_keys=True) == json.dumps(pl, sort_keys=True), (st, plo))

        B = Chrome()
        tv = B.tab(SITE + '/tv?' + VENUE)
        phone = B.tab(SITE + '/play?room=' + code, mobile=True)
        ready = ('document.readyState!=="loading" && (function(b){return !!b && !b.disabled && b.textContent.trim()==="Join";})'
                 '(document.getElementById("joinBtn"))')
        ok('the phone page loads as venueplay.com.au and is ready to take a name', B.until(phone, ready, 60) is True,
           B.ask(phone, 'location.href + " | " + document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        if not LIVE_PAGES:
            ok('the pages were answered from this checkout (%d files)' % Chrome.served, Chrome.served >= 4, Chrome.served)
        B.ask(phone, 'document.getElementById("nameIn").value="Own domain test"; document.getElementById("joinBtn").click(); true')
        ok('THE PHONE JOINS: it is in, waiting for the game', B.until(phone, VISIBLE + '("vWait")', 25) is True,
           B.ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        # The lobby QR goes up when the HOST CONSOLE tells the screens (Supabase channel); a lobby opened
        # by API alone leaves the TV on the venue's own screen, which is what this asks for.
        ok('the TV loads Test Alpha\'s own screen from the game Worker', B.until(tv, 'document.body.innerText.toUpperCase().indexOf(%s) !== -1' % json.dumps(venue['name'].upper()), 40) is True,
           B.ask(tv, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        # THE ROOM SERVER (Durable Object over a WebSocket) is off by default (vp-room.js DEFAULT_ON) and
        # switched on per page with ?roomserver=1. A second phone asks for it, so the upgrade path on
        # game.venueplay.com.au is played for real too.
        phone2 = B.tab(SITE + '/play?room=' + code + '&roomserver=1', mobile=True)
        ok('a second phone, with the room server on, is ready to take a name', B.until(phone2, ready, 60) is True)
        B.ask(phone2, 'document.getElementById("nameIn").value="Own domain room"; document.getElementById("joinBtn").click(); true')
        ok('and joins too', B.until(phone2, VISIBLE + '("vWait")', 25) is True, B.ask(phone2, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        B.until(phone2, '(window.__ws||[]).some(function(w){return w.open && /\\/room\\/ws/.test(w.u)})', 20)
        time.sleep(4)
        for name, t in (('phone', phone), ('TV', tv), ('room-server phone', phone2)):
            net = B.ask(t, 'window.__net') or []
            api = [u for u in net if re.match(r'https://[^/]*(workers\.dev|venueplay\.com\.au)/', u) and not u.startswith(SITE + '/') and not u.startswith('https://www.venueplay.com.au/')]
            ok('every Worker call the %s made is on game.venueplay.com.au or api.venueplay.com.au (%d calls), none on workers.dev' % (name, len(api)),
               api and all(re.match(r'https://(game|api)\.venueplay\.com\.au/', u) for u in api), [u for u in api if 'workers.dev' in u][:3] or api[:3])
        wss = B.ask(phone2, 'window.__ws') or []
        ok('the room-server phone\'s socket is wss://game.venueplay.com.au/room/ws and it opened (the Durable Object upgrade on the new name)',
           any(w['u'].startswith('wss://game.venueplay.com.au/room/ws?room=') and w['open'] for w in wss), wss)
        room = next((urllib.parse.parse_qs(urllib.parse.urlparse(w['u']).query).get('room', [''])[0] for w in wss if 'room=' in w['u']), '')
        if room:
            st, pn = http(GAME + '/room/presence?room=' + urllib.parse.quote(room))
            st2, po = http(GAME_OLD + '/room/presence?room=' + urllib.parse.quote(room))
            ok('/room/presence on both names sees the same room with the phone in it (one Durable Object, whichever host)',
               st == 200 and st2 == 200 and (pn.get('phone') or 0) >= 1 and pn.get('total') == po.get('total'), (pn, po))
        st, j = http(GAME_OLD + '/join', 'POST', {'code': code, 'name': 'Old address test', 'pid': 'owndomain-' + secrets.token_hex(8)},
                     {'User-Agent': 'venueplay-live-join-own-domain/1.0 old-address phone'})
        ok('a second phone joins through the OLD address (venueplay-game.dean-tindale.workers.dev/join)', st == 200 and (j.get('token') or j.get('player_token') or j.get('player_id')), (st, j))
        st, pre = http(L.rest_url + '/rest/v1/vp_players?session_id=eq.%s&select=display_name' % sid_,
                       headers={'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key})
        names = sorted(p.get('display_name') or '' for p in pre) if isinstance(pre, list) else pre
        ok('both players are in the session in the database', isinstance(names, list) and len(names) >= 2, names)
    finally:
        if sid_:
            st, c = http(GAME + '/session/close', 'POST', {'session_id': sid_}, H)
            ok('the lobby is closed again, on game.venueplay.com.au', st == 200, (st, c))
        if B:
            B.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


main()
