#!/usr/bin/env python3
"""FOUR FAULTS SEEN PLAYING A REAL NIGHT ON THE LIVE CODE, EACH PLAYED IN CHROME (live play, 15 Nov 2026; Tue 17 Nov release).

The evidence frames are in ~/venue-enrich/reports/live-play-15nov/. Each fault is played here the way a person meets it,
on the REAL pages served from this checkout, in headless Chrome:

  1. THE PHONE NAMES THE GAME THAT IS OPEN. A phone that has played here before scans /play while a TRIVIA lobby is open.
     It said "You're in ... NEXT Bingo Tonight" until the lookup moved it to the trivia phone. Every screen the phone
     paints is recorded (40 ms), on /play?room=<code> and on /play?venue=<slug> (the table talker), with the Worker taking
     a realistic 1.5 s to answer: no /play screen may name bingo, and the phone ends on the trivia page, which names
     trivia. CONTROL: a bingo night still gets "You're in" and Bingo, once the Worker says bingo.
  2. THE MEMBERS DRAW WALL WITH NO DRAW SET UP is a clean holding screen: "Members draw" once, no "$0", one line saying
     the draw starts here; before the host speaks and after a host state with no draw. CONTROL: a named draw with a
     jackpot still shows its name and its jackpot.
  3. "PRODUCT UPDATES FROM VENUEPLAY?" NEVER OVER A GAME. The real bingo console, signed in as a staff host, on the real
     game Worker (tools/browser-rig/worker-stdio.js). The billing Worker's /account/updates-ask is answered here with
     { ask: true }, held until the test lets it go:
       a. let go while a bingo game is RUNNING: no card while it runs; End game, and the card comes up
       b. let go in the lobby: the card is up; Start the game, and it steps out of the way; End game, and it is back
  4. NO "YOU WON!" ON 0 POINTS. A trivia phone at the podium where the score says rank 1 and 0 points (nobody scored):
     "That's a wrap", no trophy, no "1st place". CONTROLS: a team on 0 behind a scorer keeps "You finished 2nd" (Dean's
     "show the place", pinned by trivia-ux-in-chrome); a real winner on 290 points still gets "YOU WON!".

The pages are served with one line added beside the trivia phone's and the members wall's own onMsg (window.__tvMsg), so
the suite can hand them a host message the way the channel does; nothing else in a page is changed. Nothing here
reaches the network: the billing Worker and the game Worker are this test's.
Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
VP_SHOTS=<dir> saves a screenshot of each moment judged.

    python3 tools/older-faults-tue17-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, re, subprocess, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import waits
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS', '')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


# ---------------- the real game Worker on a pipe (fault 3) ----------------
class Worker(object):
    def __init__(self):
        self.p = subprocess.Popen([JSC, 'tools/browser-rig/worker-stdio.js'], cwd=ROOT, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.lock = threading.Lock()
        self.info = json.loads(self.p.stdout.readline())
    def ask(self, method, path, body, headers):
        with self.lock:
            self.p.stdin.write(json.dumps({'method': method, 'path': path, 'body': body, 'headers': headers}) + '\n')
            self.p.stdin.flush()
            line = self.p.stdout.readline()
        return json.loads(line) if line else {'status': 502, 'body': {'error': 'worker rig died'}}
    def close(self):
        try: self.p.stdin.close(); self.p.terminate()
        except Exception: pass


UID = '11111111-1111-4111-8111-111111111111'
GID = '44444444-4444-4444-8444-444444444444'
SLUG = 'test-alpha'
R = {'worker': None, 'fmt': 'trivia', 'delay': 1.5, 'score': {'total': 0, 'rank': 1, 'players_count': 2},
     'ask_open': threading.Event(), 'asks': 0}


def venue_code(slug):
    """play.html's venueCode(): the venue's permanent code off a table talker."""
    s = re.sub(r'[^a-z0-9]', '', slug.lower()); h = 2166136261
    for ch in s:
        h ^= ord(ch); h = (h * 16777619) & 0xffffffff
    A = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'; x = h or 1; out = ''
    for _ in range(6):
        x = (x * 1103515245 + 12345) & 0xffffffff; out += A[x % len(A)]
    return out


def fake_db():
    W = R['worker']
    if not W: return {}
    return {'vp_platform_admins': [],
            'vp_venue_staff': [{'auth_user_id': UID, 'venue_id': W.info['venue'], 'role': 'owner', 'display_name': 'Test Host'}],
            'vp_venues': [{'id': W.info['venue'], 'name': 'Test Alpha', 'slug': W.info['slug'], 'status': 'active', 'suspended_reason': None,
                           'join_code': W.info['code'], 'au_state': 'QLD', 'max_players': 100, 'included_players': None,
                           'created_at': '2026-01-01T00:00:00Z', 'postcode': '4000', 'logo_url': None, 'paid_entry_enabled': False}],
            'vp_venue_settings': [], 'vp_question_sets': []}


HOOK_AT = '  function onMsg(m){'
HOOK = '  window.__tvMsg=function(o){ return onMsg(o); };\n'


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n) if n else b''
        try: return json.loads(raw or b'{}')
        except Exception: return {}
    def fake_game(self, method, path, body):
        """The game Worker, for the phone faults: a trivia (or bingo) night open at Test Alpha."""
        p = path.split('?')[0]
        live = R['fmt']
        if p == '/join/info':
            time.sleep(R['delay'])
            return self.send(200, json.dumps({'exists': True, 'venue_name': 'Test Alpha', 'format': live, 'room_code': 'ACDE23',
                                              'collect': {}, 'live': True}), 'application/json')
        if p == '/play/live':
            time.sleep(R['delay'])
            return self.send(200, json.dumps({'exists': True, 'name': 'Test Alpha', 'live': True, 'format': live,
                                              'join_code': 'ACDE23' if live != 'bingo90' else venue_code(SLUG)}), 'application/json')
        if p == '/join' and method == 'POST':
            return self.send(200, json.dumps({'token': 'tok1', 'snapshot': {'session_id': '22222222-2222-4222-8222-222222222222', 'status': 'lobby', 'game': None}}), 'application/json')
        if p == '/player/score':
            return self.send(200, json.dumps(R['score']), 'application/json')
        return self.send(404, '{"error":"No active game with that code"}', 'application/json')
    def route(self, method):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'):
            path = self.path[len('/__worker'):] or '/'
            body = self.body() if method == 'POST' else {}
            if R['worker']:
                r = R['worker'].ask(method, path, body, {k: v for k, v in self.headers.items()})
                return self.send(r.get('status', 500), json.dumps(r.get('body')), 'application/json')
            return self.fake_game(method, path, body)
        if u.path.startswith('/__api'):
            # The billing Worker: "Product updates?" is asked for (held until the test lets it go); nothing else answers.
            self.body()
            if u.path == '/__api/account/updates-ask':
                R['asks'] += 1
                R['ask_open'].wait(240)
                return self.send(200, '{"ask":true}', 'application/json')
            if u.path == '/__api/account/updates-optin':
                return self.send(200, '{"ok":true}', 'application/json')
            return self.send(404, '{"error":"not in this test"}', 'application/json')
        return None
    def do_POST(self):
        if self.route('POST') is None: self.send(404, '{}', 'application/json')
    def do_OPTIONS(self):
        self.send(204, b'', 'text/plain')
    def do_GET(self):
        if self.route('GET') is not None: return
        u = urllib.parse.urlparse(self.path)
        if u.path == '/__fake/supabase.js':
            host = urllib.parse.parse_qs(u.query).get('host', ['0'])[0] == '1'
            pre = 'window.__FAKE_DB=%s;window.__FAKE_SIGNED_IN=%s;window.__FAKE_UID=%s;\n' % (json.dumps(fake_db()), 'true' if host else 'false', json.dumps(UID))
            return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);},toDataURL:function(t,o,cb){var f=typeof o==="function"?o:cb;if(f)f(null,"data:,");return Promise.resolve("data:,");}};', 'application/javascript')
        if u.path == '/__fake/blank.css':
            return self.send(200, '', 'text/css')
        p = u.path
        if p in ('/app', '/app/'): p = '/app/index.html'
        elif p in ('/play', '/tv'): p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not os.path.splitext(f)[1] and os.path.isfile(f + '.html'): f += '.html'; p += '.html'
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'not here', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.json', '.css', '.txt'):
            t = io.open(f, encoding='utf-8').read()
            host_page = p == '/app/index.html' or bool(re.match(r'^/app/\w+/host\.html$', p))
            if ext == '.html':
                t = t.replace('<head>', '<head><script>window.__errs=[];window.addEventListener("error",function(e){__errs.push(String(e.message)+" @"+(e.filename||"").split("/").pop()+":"+e.lineno)});</script>', 1)
                t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js?host=%d' % (1 if host_page else 0))
                t = t.replace('/app/vendor/qrcode-1.4.4.min.js', '/__fake/qrcode.js')
                t = t.replace('https://fonts.googleapis.com/css2', '/__fake/blank.css')
                if p in ('/app/trivia/play.html', '/app/members/screen.html') and t.count(HOOK_AT) == 1:
                    t = t.replace(HOOK_AT, HOOK + HOOK_AT)
            t = t.replace('https://game.venueplay.com.au', '/__worker').replace('https://api.venueplay.com.au', '/__api')
            ctype = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css'}.get(ext, 'text/plain')
            return self.send(200, t, ctype + '; charset=utf-8')
        ctype = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ctype)


class Chrome(object):
    def __init__(self, base):
        self.base = base; self.B = VL.Browser()
    def open(self, path, w, h, mobile, pre=''):
        tid = self.B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        sid = self.B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        self.B.call('Page.enable', {}, session=sid)
        self.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
        if pre: self.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': pre}, session=sid)
        self.B.call('Page.navigate', {'url': self.base + path}, session=sid)
        return tid, sid
    def js(self, sid, expr, wait=10):
        r = self.B.evaluate(sid, expr, wait)
        return 'HUNG' if r is None else r.get('result', {}).get('value')
    def json(self, sid, expr, default=None):
        try: return waits.as_json(self.js(sid, expr), default, expr[:40])
        except waits.PageThrew as e: return {'__page': str(e)} if isinstance(default, dict) else default
    def until(self, sid, expr, secs=15):
        t = time.time() + secs
        while time.time() < t:
            v = self.js(sid, expr)
            if v == 'HUNG' or v: return v
            time.sleep(0.25)
        return False
    def tap(self, sid, expr):
        return self.js(sid, 'setTimeout(function(){ %s }, 0); true' % expr)
    def shot(self, sid, name):
        if SHOTS:
            open(os.path.join(SHOTS, 'older-faults-%s.png' % name), 'wb').write(base64.b64decode(self.B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data']))
    def close_tab(self, tid): self.B.close_tab(tid)
    def close(self): self.B.close()


TEXT = 'document.body.innerText.replace(/\\s+/g," ").trim().slice(0,400)'


# ---------------- 1. the phone names the game that is open ----------------
def recorder(ls):
    """Seeds storage ONCE for the tab (the hop to the trivia page keeps it), then notes every screen the phone paints."""
    return (r'''(function(){
  try{ if(!sessionStorage.getItem("__seeded")){ sessionStorage.setItem("__seeded","1"); localStorage.clear(); %s } }catch(e){}
  function snap(){ try{ var t=(document.body&&document.body.innerText||"").replace(/\s+/g," ").trim().slice(0,300); if(!t) return;
    var f=JSON.parse(localStorage.getItem("__frames")||"[]"), k=location.pathname+" | "+t;
    if(!f.length||f[f.length-1]!==k){ f.push(k); localStorage.setItem("__frames", JSON.stringify(f.slice(-300))); } }catch(e){} }
  setInterval(snap, 40); document.addEventListener("DOMContentLoaded", snap);
})();''' % ls)


def phone_names_the_game(C):
    print('\n1. A PHONE THAT HAS PLAYED HERE BEFORE SCANS /play WHILE A TRIVIA LOBBY IS OPEN')
    vcode = venue_code(SLUG)
    for tag, path, code in (('the code on the TV (/play?room=)', '/play?room=ACDE23&sting=0', 'ACDE23'),
                            ('the table talker (/play?venue=)', '/play?venue=%s&sting=0' % SLUG, vcode)):
        R.update(fmt='trivia', delay=1.5)
        ls = "localStorage.setItem('vp-name-%s','Ann');localStorage.setItem('vp-pid-%s','pidbingo1');" % (code, code)
        tid, sid = C.open(path, 390, 844, True, recorder(ls))
        moved = C.until(sid, 'location.pathname.indexOf("/app/trivia/play")===0', 25)
        time.sleep(3)
        frames = C.json(sid, 'localStorage.getItem("__frames")', [])
        on_play = [f for f in frames if f.startswith('/play')]
        named = [f for f in on_play if re.search(r'bingo', f, re.I)]
        ok(tag + ': the phone moves to the trivia phone', moved is True, [C.js(sid, 'location.pathname'), frames[-3:]])
        ok(tag + ': and saw /play on the way (the recorder is working)', len(on_play) > 0, frames[:4])
        ok(tag + ': no screen on /play names bingo ("You\'re in ... Next Bingo Tonight" was the fault)', moved is True and not named, named[:3] or frames[:6])
        last = C.js(sid, TEXT) or ''
        ok(tag + ': the trivia phone names trivia', bool(re.search(r'trivia', last, re.I)), last)
        C.shot(sid, 'phone-trivia-' + ('room' if 'room=' in path else 'venue'))
        C.close_tab(tid)
    print('\n   CONTROL: the same phone on a bingo night')
    R.update(fmt='bingo90', delay=1.5)
    ls = "localStorage.setItem('vp-name-ACDE23','Ann');localStorage.setItem('vp-pid-ACDE23','pidbingo1');"
    tid, sid = C.open('/play?room=ACDE23&sting=0', 390, 844, True, recorder(ls))
    inb = C.until(sid, '/You.re in/i.test(document.body.innerText) && /Bingo/.test(document.body.innerText)', 20)
    ok('CONTROL: once the Worker says bingo, the phone is in, and the lobby names Bingo', inb is True, C.js(sid, TEXT))
    ok('CONTROL: and it stays on /play', C.js(sid, 'location.pathname') in ('/play', '/play.html'), C.js(sid, 'location.pathname'))
    C.shot(sid, 'phone-bingo-control')
    C.close_tab(tid)


# ---------------- 2. the members draw wall with no draw set up ----------------
MEMBERS = r'''JSON.stringify((function(){ var i=document.getElementById("tvIdle"); var t=(i&&!i.classList.contains("hidden"))?i.innerText.replace(/\s+/g," ").trim():"";
  var j=document.getElementById("idleJack"); return { idle:t, all:document.getElementById("tv").innerText.replace(/\s+/g," ").trim(),
  jack:(j && j.offsetParent!==null) ? j.textContent : "" }; })())'''


def members_wall(C):
    print('\n2. THE MEMBERS DRAW WALL WITH NO DRAW SET UP')
    pre = 'try{ localStorage.clear(); }catch(e){}'
    tid, sid = C.open('/app/members/screen.html?sting=0', 1280, 720, False, pre)
    C.until(sid, 'document.readyState==="complete" && !!window.__tvMsg', 20); time.sleep(2)
    for moment, msg in (('before the host speaks', None),
                        ('after a host state with no draw', {'t': 'state', 'playing': False, 'drawName': 'Members Draw', 'jackpotCents': 0, 'draws': []})):
        if msg: C.js(sid, '__tvMsg(%s); true' % json.dumps(msg)); time.sleep(1.2)
        x = C.json(sid, MEMBERS, {})
        idle = x.get('idle') or ''
        ok(moment + ': the holding screen is up', bool(idle), x)
        ok(moment + ': "Members draw" says itself once, not twice', len(re.findall(r'members draw', idle, re.I)) == 1, idle)
        ok(moment + ': no "$0" anywhere on the wall', '$0' not in (x.get('all') or '') and not x.get('jack'), x)
        ok(moment + ': one line says the draw starts here', 'the draw will start here when the host is ready' in idle.lower(), idle)
        C.shot(sid, 'members-' + ('cold' if not msg else 'nodraw'))
    C.js(sid, '__tvMsg(%s); true' % json.dumps({'t': 'state', 'playing': False, 'drawName': 'Thursday Draw', 'jackpotCents': 25000, 'draws': []})); time.sleep(1.2)
    x = C.json(sid, MEMBERS, {})
    ok('CONTROL: a named draw with a jackpot shows its name and its jackpot ($250)', 'thursday draw' in (x.get('idle') or '').lower() and x.get('jack') == '$250'
       and 'be here when your number is drawn' in (x.get('idle') or '').lower(), x)
    C.close_tab(tid)


# ---------------- 3. "Product updates?" never over a game ----------------
# The card is position:fixed, so offsetParent is always null for it: judged by its box and its display.
CARD_UP = '(function(){ var c=document.getElementById("vpUpdatesOptin"); return !!c && getComputedStyle(c).display!=="none" && c.getBoundingClientRect().height>40; })()'
CONSOLE = ('JSON.stringify({start:(document.getElementById("startBtn")||{}).textContent, ask:((document.getElementById("vpAsk")||{}).innerText||"").slice(0,200),'
           ' err:((document.getElementById("hostErrText")||{}).textContent||""), errs:window.__errs||[], live:!document.getElementById("liveBlock").classList.contains("hidden")})')
RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
ONETAB_SETTLED = '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")'
ANSWER_ASK = 'var a=document.getElementById("vpAskGo"); if(a) a.click();'


def watch_card(C, sid, secs):
    """True if the card was on screen at any moment in the next secs seconds (checked every 200 ms)."""
    t = time.time() + secs
    while time.time() < t:
        if C.js(sid, CARD_UP) is True: return True
        time.sleep(0.2)
    return False


def bingo_lobby(C, sid):
    C.js(sid, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    C.until(sid, '!document.getElementById("setupBlock").classList.contains("hidden")', 15)
    C.until(sid, ONETAB_SETTLED, 10)
    C.js(sid, 'var $=function(i){return document.getElementById(i)}; $("prizeInput").value="Meat tray"; $("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change")); true')
    C.tap(sid, 'document.getElementById("startBtn").click();')
    return C.until(sid, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 20)


def bingo_start(C, sid):
    time.sleep(2)
    C.tap(sid, 'document.getElementById("startBtn").click();')
    t = time.time() + 30
    while time.time() < t:
        if C.js(sid, RUNNING) is True: return True
        C.js(sid, ANSWER_ASK + ' true'); time.sleep(0.5)
    return False


def bingo_end(C, sid):
    C.tap(sid, 'document.getElementById("endGameBtn").click();'); time.sleep(1)
    C.tap(sid, 'document.getElementById("endGameBtn").click();'); time.sleep(1)
    C.js(sid, ANSWER_ASK + ' true')
    return C.until(sid, '!(' + RUNNING + ')', 20)


def console_card(C):
    print('\n3. "PRODUCT UPDATES FROM VENUEPLAY?" ON THE REAL BINGO CONSOLE')
    for scene in ('a', 'b'):
        R['worker'] = Worker(); R['ask_open'].clear(); R['asks'] = 0
        try:
            tid, sid = C.open('/app/', 1280, 900, False, 'try{ if(!sessionStorage.getItem("__s")){ sessionStorage.setItem("__s","1"); localStorage.clear(); } }catch(e){}')
            ready = C.until(sid, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40)
            ok(scene + ': the console is signed in, on the games menu', ready is True, C.js(sid, TEXT))
            if scene == 'a':
                print('   a. the answer comes back while a bingo game is running')
                lob = bingo_lobby(C, sid)
                run = lob is True and bingo_start(C, sid)
                ok('a: the bingo game is running (Open lobby, Start)', run is True, [lob, C.js(sid, CONSOLE)])
                R['ask_open'].set()
                ok('a: the console asked the billing Worker (the card is wanted for this host)', C.until(sid, 'true', 1) and R['asks'] >= 1, R['asks'])
                seen = watch_card(C, sid, 9)
                ok('a: no card over the running game, for 9 seconds after the answer', run is True and seen is False, C.js(sid, TEXT))
                C.shot(sid, 'console-running')
                ended = bingo_end(C, sid)
                ok('a: End game', ended is True, C.js(sid, TEXT))
                ok('a: the game over, the card comes up', C.until(sid, CARD_UP, 15) is True, C.js(sid, TEXT))
                C.shot(sid, 'console-after')
            else:
                print('   b. the card is up in the lobby when the host starts the game')
                R['ask_open'].set()
                lob = bingo_lobby(C, sid)
                up = C.until(sid, CARD_UP, 15)
                ok('b: in the lobby (a calm moment) the card is up', lob is True and up is True, C.js(sid, TEXT))
                run = bingo_start(C, sid)
                ok('b: Start: the game is running', run is True, C.js(sid, CONSOLE))
                time.sleep(3)
                ok('b: and the card has stepped out of the way', run is True and watch_card(C, sid, 4) is False, C.js(sid, TEXT))
                ok('b: unanswered: it is still there to come back', C.js(sid, '!!document.getElementById("vpUpdatesOptin")') is True)
                ended = bingo_end(C, sid)
                ok('b: End game: the card is back', ended is True and C.until(sid, CARD_UP, 10) is True, C.js(sid, TEXT))
            ok(scene + ': no script errors', C.js(sid, 'window.__errs.length') == 0, C.js(sid, 'JSON.stringify(window.__errs)'))
            C.close_tab(tid)
        finally:
            R['ask_open'].set()
            R['worker'].close(); R['worker'] = None


# ---------------- 4. no "YOU WON!" on 0 points ----------------
FINAL = 'JSON.stringify({big:document.getElementById("finalBig").textContent, score:document.getElementById("finalScore").textContent, rank:document.getElementById("finalRank").textContent, sub:document.getElementById("finalSub").textContent, shown:!document.getElementById("vFinal").classList.contains("hidden")})'
JOIN = 'document.getElementById("nameIn").value="Sam"; var b=document.getElementById("joinBtn"); (b.form && b.form.requestSubmit) ? b.form.requestSubmit(b) : b.click(); true'


def trivia_end(C):
    print('\n4. THE TRIVIA PHONE AT THE PODIUM')
    R.update(fmt='trivia', delay=0)
    for tag, score, want_win in (('rank 1 on 0 points (nobody scored)', {'total': 0, 'rank': 1, 'players_count': 2}, False),
                                 ('CONTROL: rank 2 on 0 points, behind a team that scored', {'total': 0, 'rank': 2, 'players_count': 3}, 'second'),
                                 ('CONTROL: rank 1 on 290 points', {'total': 290, 'rank': 1, 'players_count': 3}, True)):
        R['score'] = score
        tid, sid = C.open('/app/trivia/play.html?room=ACDE23&sting=0', 390, 844, True, 'try{ localStorage.clear(); }catch(e){}')
        C.until(sid, 'document.readyState==="complete" && !!window.__tvMsg && !!document.getElementById("joinBtn") && !document.getElementById("joinBtn").disabled', 30)
        time.sleep(1.5)
        C.js(sid, JOIN)
        C.until(sid, '/You.re in/i.test(document.body.innerText)', 15)
        C.js(sid, '__tvMsg(%s); true' % json.dumps({'t': 'state', 'phase': 'lobby', 'game_id': GID}))
        time.sleep(0.5)
        C.js(sid, '__tvMsg(%s); true' % json.dumps({'t': 'podium', 'reveal': 1}))
        C.until(sid, '!document.getElementById("vFinal").classList.contains("hidden")', 10); time.sleep(1.5)
        x = C.json(sid, FINAL, {})
        if want_win == 'second':
            ok(tag + ': the final screen is up', x.get('shown') is True, x)
            ok(tag + ': no "YOU WON!" on 0 points', 'WON' not in (x.get('big') or '').upper(), x)
            ok(tag + ': keeps its place, as tools/trivia-ux-in-chrome.test.py pins it ("You finished 2nd")', x.get('rank') == 'You finished 2nd', x)
        elif want_win:
            ok(tag + ': "YOU WON!", 1st place, 290 points', x.get('big') == 'YOU WON!' and x.get('rank') == '1st place' and x.get('score') == '290 points', x)
        else:
            ok(tag + ': the final screen is up', x.get('shown') is True, x)
            ok(tag + ': no "YOU WON!" and no "place!" on 0 points', 'WON' not in (x.get('big') or '').upper() and 'place' not in (x.get('big') or ''), x)
            ok(tag + ': "That\'s a wrap", thanks for playing, and no place line', x.get('big') == "That's a wrap" and x.get('sub') == 'Thanks for playing tonight' and not x.get('rank'), x)
        C.shot(sid, 'trivia-end-%d-%d' % (score['rank'], score['total']))
        C.close_tab(tid)


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('older-faults-tue17-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site); srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    C = Chrome('http://127.0.0.1:%d' % srv.server_address[1])
    try:
        phone_names_the_game(C)
        members_wall(C)
        trivia_end(C)
        console_card(C)
    finally:
        R['ask_open'].set()
        C.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
