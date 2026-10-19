#!/usr/bin/env python3
"""THE REAL BINGO CONSOLE AND A REAL PHONE, IN A REAL BROWSER, AND A HUNG PAGE IS A FAILURE.

19 Oct 2026: the release of cfe35a7 froze the live host console the moment Open lobby was pressed for
90-ball bingo at Test Alpha, with a phone already waiting on the code. Every suite in the gate was green,
because every one of them runs the pages in jsc with the shared scripts stubbed out. This one does not.

It serves the repo's own venueplay/ pages from a local web server and changes only the outside addresses:
  - supabase-js            -> tools/browser-rig/fake-supabase.js (a signed-in host or nobody, the few
                              tables vp-session.js reads, and realtime carried between the tabs)
  - the game Worker        -> the REAL venueplay-game.js, running in jsc behind a pipe
                              (tools/browser-rig/worker-stdio.js), with a fake database
  - the QR code library    -> a no-op
Everything else is the shipped code: index.html, play.html and every /app/vp-*.js they load.

Then, in headless Chrome, exactly the steps that froze it: a phone joins code 4NJPNQ and waits; the host
picks Bingo, free tickets, 1 each, types a prize, and taps Open lobby (once with Allow early BINGO ticked,
once without). After every step the page must answer a trivial question inside a few seconds. A page that
does not answer is HUNG, and that is a FAIL, never a timeout to shrug at. The game then goes on to Start,
a ball, and the phone must hold its ticket.

    python3 tools/test-console-in-chrome.py
"""
import http.server, importlib.util, io, json, os, re, socket, subprocess, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(spec); spec.loader.exec_module(VL)

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    if not cond: bad += 1

# ---------------- the real Worker on a pipe ----------------
class Worker(object):
    def __init__(self):
        self.p = subprocess.Popen([JSC, 'tools/browser-rig/worker-stdio.js'], cwd=ROOT, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.lock = threading.Lock()
        self.info = json.loads(self.p.stdout.readline())
        self.calls = []
    def ask(self, method, path, body, headers):
        with self.lock:
            self.calls.append(path.split('?')[0])
            self.p.stdin.write(json.dumps({'method': method, 'path': path, 'body': body, 'headers': headers}) + '\n')
            self.p.stdin.flush()
            line = self.p.stdout.readline()
        return json.loads(line) if line else {'status': 502, 'body': {'error': 'worker rig died'}}
    def close(self):
        try: self.p.stdin.close(); self.p.terminate()
        except Exception: pass

W = Worker()
UID = '11111111-1111-4111-8111-111111111111'
FAKE_DB = {
    'vp_platform_admins': [],
    'vp_venue_staff': [{'auth_user_id': UID, 'venue_id': W.info['venue'], 'role': 'owner', 'display_name': 'Test Host'}],
    'vp_venues': [{'id': W.info['venue'], 'name': 'Test Alpha', 'slug': W.info['slug'], 'status': 'active', 'suspended_reason': None,
                   'join_code': W.info['code'], 'au_state': 'QLD', 'max_players': 100, 'included_players': None,
                   'created_at': '2026-01-01T00:00:00Z', 'postcode': '4000', 'logo_url': None, 'paid_entry_enabled': False}],
    'vp_venue_settings': [],
}

# ---------------- the local site ----------------
EXTERNAL = [
    ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', None),            # replaced per page below
    ('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js', '/__fake/qrcode.js'),
    ('https://venueplay-game.dean-tindale.workers.dev', '/__worker'),
]
ERRS = ('<script>window.__errs=[];window.addEventListener("error",function(e){__errs.push(String(e.message)+" @"+(e.filename||"").split("/").pop()+":"+e.lineno)});'
        'window.addEventListener("unhandledrejection",function(e){__errs.push("rejected: "+String(e.reason&&e.reason.message||e.reason))});</script>')
def rewrite(text, host_page):
    if '<head>' in text: text = text.replace('<head>', '<head>' + ERRS, 1)
    for a, b in EXTERNAL:
        text = text.replace(a, b if b else ('/__fake/supabase.js?host=%d' % (1 if host_page else 0)))
    return text

class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(b)
    def worker(self, method):
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}') if n else {}
        path = self.path[len('/__worker'):] or '/'
        r = W.ask(method, path, body, {k: v for k, v in self.headers.items()})
        self.send(r.get('status', 500), json.dumps(r.get('body')), 'application/json')
    def do_POST(self):
        if self.path.startswith('/__worker'): return self.worker('POST')
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'): return self.worker('GET')
        if u.path == '/__fake/supabase.js':
            host = urllib.parse.parse_qs(u.query).get('host', ['0'])[0] == '1'
            pre = 'window.__FAKE_DB=%s;window.__FAKE_SIGNED_IN=%s;window.__FAKE_UID=%s;\n' % (json.dumps(FAKE_DB), 'true' if host else 'false', json.dumps(UID))
            return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);},toDataURL:function(t,o,cb){var f=typeof o==="function"?o:cb;if(f)f(null,"data:,");return Promise.resolve("data:,");}};', 'application/javascript')
        p = u.path
        if p in ('/app', '/app/'): p = '/app/index.html'
        elif p == '/play': p = '/play.html'
        elif p == '/tv': p = '/tv.html'
        f = os.path.normpath(os.path.join(ROOT, 'venueplay', p.lstrip('/')))
        if not f.startswith(os.path.join(ROOT, 'venueplay')) or not os.path.isfile(f):
            return self.send(404, 'not here', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.json', '.css', '.txt'):
            text = io.open(f, encoding='utf-8').read()
            ctype = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css'}.get(ext, 'text/plain')
            return self.send(200, rewrite(text, p == '/app/index.html'), ctype + '; charset=utf-8')
        ctype = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, io.open(f, 'rb').read(), ctype)

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

# ---------------- Chrome ----------------
B = VL.Browser()
def ask(sid, expr, wait=8):
    """Evaluate in the page and return the value, or the string 'HUNG' if the page does not answer in time."""
    B.ws.s.settimeout(wait)
    try:
        return B.eval(sid, expr)
    except (socket.timeout, OSError):
        return 'HUNG'
    finally:
        B.ws.s.settimeout(60)
def until(sid, expr, secs=15):
    t = time.time() + secs
    while time.time() < t:
        v = ask(sid, expr)
        if v == 'HUNG' or v: return v
        time.sleep(0.25)
    return False
def alive(sid):
    return ask(sid, '1+1', 6) == 2

def scene(early):
    print('\nOpen lobby with a phone already waiting%s' % (', Allow early BINGO ticked' if early else ''))
    ptid, phone = B.open_tab(BASE + '/play?room=' + W.info['code'])
    ok('the phone page loads (the real play.html)', until(phone, '!!document.getElementById("joinBtn")') is True)
    time.sleep(2)   # the phone asks the Worker about the room first (/join/info) before Join does anything
    ask(phone, 'document.getElementById("nameIn").value="Ann"; document.getElementById("joinBtn").click(); true')
    until(phone, '/YOU.RE IN/i.test(document.body.innerText)', 10)
    ctid, host = B.open_tab(BASE + '/app/')
    ok('the console loads, signed in, on the games menu', until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20) is True,
       ask(host, 'document.body.innerText.slice(0,200)'))
    ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    ok('bingo opens', until(host, '!document.getElementById("setupBlock").classList.contains("hidden")') is True)
    time.sleep(1.5)   # the console asks the other tabs for half a second after Bingo is tapped (vp-onetab.js)
    ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
               '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";'
               '$("allowEarlyChk").checked=%s;$("allowEarlyChk").dispatchEvent(new Event("change"));true') % ('true' if early else 'false'))
    ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
    time.sleep(3)
    ok('after Open lobby the console still answers (it froze live on cfe35a7)', alive(host), 'the page did not answer within 6 seconds')
    ok('and the phone still answers', alive(phone))
    ok('the phone is in, waiting for the game', until(phone, '!document.getElementById("vWait").classList.contains("hidden")', 20) is True,
       ask(phone, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    ok('the lobby is open: Start calling numbers', until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"') is True,
       ask(host, 'document.getElementById("startBtn").textContent'))
    time.sleep(4)
    ok('a few seconds of the lobby later, still answering', alive(host) and alive(phone))
    ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
    time.sleep(4)
    ok('after Start the console still answers', alive(host))
    ok('the phone is dealt its ticket by the server', until(phone, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of 1/.test(document.body.innerText)', 15) is True,
       ask(phone, 'document.body.innerText.slice(0,300)'))
    ask(host, 'setTimeout(function(){ document.getElementById("nextBtn").click(); }, 0); true')
    time.sleep(3)
    ok('a ball is called and the console still answers', alive(host) and until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 10) is True,
       ask(host, 'document.getElementById("liveCount").textContent'))
    B.close_tab(ctid); B.close_tab(ptid)

def leftover():
    print('\nOpen lobby when the server still has a game open at the venue (a tablet closed mid-night, 19 Oct 2026)')
    r = W.ask('POST', '/session', {'venue_id': W.info['venue'], 'format': 'bingo'}, {})
    ok('CONTROL: the server now says a game is open at this venue', W.ask('GET', '/play/live?code=' + W.info['code'], {}, {})['body'].get('live') is True, r)
    ctid, host = B.open_tab(BASE + '/app/')
    B.call('Page.enable', {}, session=host)
    until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20)
    ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    until(host, '!document.getElementById("setupBlock").classList.contains("hidden")'); time.sleep(1.5)
    ask(host, 'var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";true')
    ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
    time.sleep(4)
    ok('the console still answers when it has to ask about the game already open (live it hung here)', alive(host))
    try:
        B.call('Page.handleJavaScriptDialog', {'accept': False}, session=host); was_dialog = True
    except Exception:
        was_dialog = False
    ok('and no native browser dialog is holding the page (a confirm() blocks a kiosk tablet and any automation)', not was_dialog, 'a window.confirm() was open')
    ok('the host is asked on the page instead, and can still open the lobby here', until(host, '!!document.getElementById("vpTakeover")') is True and
       ask(host, 'document.getElementById("vpTakeoverGo").click(); true') is True and
       until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"') is True,
       ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    B.close_tab(ctid)

def fresh():
    """A new database and a new browser profile for each scene: nothing left over from the last."""
    global W, B
    try: B.close()
    except Exception: pass
    try: W.close()
    except Exception: pass
    W = Worker(); B = VL.Browser()

try:
    leftover()
    fresh(); scene(True)
    fresh(); scene(False)
finally:
    B.close(); W.close(); srv.shutdown()

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
