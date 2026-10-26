#!/usr/bin/env python3
"""LOST THE WELCOME EMAIL: THE WAY BACK IN, IN THE REAL PAGES, IN A REAL BROWSER.

Dean, 23 Oct 2026: "when you click lost the email, send it again, it errors out asking for the code
to be entered." The code is IN the lost email, so /run's "Lost the email? Send it again" was a circle,
and /booked with no code said "email hello@ and we will sort it". Now both ask for the one thing a host
still knows, the address they paid with, and post it to /licence/recover; a code on its own still goes
to /licence/resend. host.html's two dead ends link to the sign-in.

The pages are the shipped partyplay/ files served locally; only the outside addresses change (the
Worker is a small fake here that records what it was asked, since partyplay-api.test.js tests the
real /licence/recover route; supabase-js, fonts and analytics are stubbed so nothing leaves the Mac).

    python3 tools/partyplay-resend-in-chrome.test.py
"""
import http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(spec); spec.loader.exec_module(VL)

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

CALLS = []          # every Worker request: (method, path, body)
LOCK = threading.Lock()
ERRS = ('<script>window.__errs=[];window.addEventListener("error",function(e){__errs.push(String(e.message)+" @"+(e.filename||"").split("/").pop()+":"+e.lineno)});'
        'window.addEventListener("unhandledrejection",function(e){__errs.push("rejected: "+String(e.reason&&e.reason.message||e.reason))});</script>')
SUPA_STUB = ('window.supabase={createClient:function(){return {channel:function(){var c={on:function(){return c},'
             'subscribe:function(){return c},send:function(){return Promise.resolve("ok")},unsubscribe:function(){}};return c}}}};')

class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers(); self.wfile.write(b)
    def worker(self, method):
        u = urllib.parse.urlparse(self.path)
        path = u.path[len('/__worker'):] or '/'
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}') if n else {}
        with LOCK: CALLS.append((method, path, body, dict(urllib.parse.parse_qsl(u.query))))
        if method == 'POST' and path == '/licence/recover':
            if body.get('email') == 'down@example.com':
                return self.send(500, json.dumps({'error': 'Something went wrong', 'ref': 'X'}), 'application/json')
            return self.send(200, json.dumps({'ok': True}), 'application/json')
        if method == 'POST' and path == '/licence/resend':
            return self.send(200, json.dumps({'ok': True}), 'application/json')
        if method == 'GET' and path == '/licence':
            return self.send(404, json.dumps({'error': 'Not found'}), 'application/json')
        if method == 'GET' and path == '/games':
            return self.send(403, json.dumps({'error': 'Not your party to change.'}), 'application/json')
        self.send(404, json.dumps({'error': 'not found'}), 'application/json')
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'content-type'); self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.end_headers()
    def do_POST(self):
        if self.path.startswith('/__worker'): return self.worker('POST')
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'): return self.worker('GET')
        if u.path == '/__fake/supabase.js': return self.send(200, SUPA_STUB, 'application/javascript')
        if u.path == '/__blank.js': return self.send(200, '', 'application/javascript')
        if u.path == '/__blank.css': return self.send(200, '', 'text/css')
        if u.path == '/__blank': return self.send(200, '<!doctype html><title>blank</title>', 'text/html')
        rel = u.path.lstrip('/') or 'index.html'
        f = os.path.normpath(os.path.join(ROOT, 'partyplay', rel))
        if os.path.isdir(f): f = os.path.join(f, 'index.html')
        if not os.path.isfile(f) and os.path.isfile(f + '.html'): f += '.html'      # /run is run.html on Pages
        if not f.startswith(os.path.join(ROOT, 'partyplay')) or not os.path.isfile(f):
            return self.send(404, 'not here', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.json', '.css', '.txt'):
            text = io.open(f, encoding='utf-8').read()
            if '<head>' in text: text = text.replace('<head>', '<head>' + ERRS, 1)
            for a, b in EXTERNAL: text = text.replace(a, b)
            ctype = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css'}.get(ext, 'text/plain')
            return self.send(200, text, ctype + '; charset=utf-8')
        return self.send(200, io.open(f, 'rb').read(), 'application/octet-stream')

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
srv.socket.listen(128)   # Python's default queue of 5 drops scripts when a page asks for many at once (browser-rig/rig.py Server, 26 Oct 2026)
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]
EXTERNAL = [
    ("'https://partyplay-api.dean-tindale.workers.dev'", "'%s/__worker'" % BASE),
    ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/__fake/supabase.js'),
    ('https://www.googletagmanager.com/gtag/js?id=G-73XKQG9TBN', '/__blank.js'),
    ('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@700;800&family=Manrope:wght@400;500;700&display=swap', '/__blank.css'),
]
threading.Thread(target=srv.serve_forever, daemon=True).start()

B = VL.Browser()
TID = [None]
def ask(sid, expr):
    try: return B.eval(sid, expr)
    except IOError: return None
def until(sid, expr, secs=30):
    t = time.time() + secs
    while time.time() < t:
        v = ask(sid, expr)
        if v: return v
        time.sleep(0.2)
    return False
def open_page(path, wait_expr):
    if TID[0]: B.close_tab(TID[0])
    tid, sid = B.open_tab(BASE + path)
    TID[0] = tid
    until(sid, 'document.readyState==="complete" && (' + wait_expr + ')')
    return sid
def text(sid): return ask(sid, 'document.body.innerText.replace(/\\s+/g," ")') or ''
def errs(sid): return ask(sid, 'JSON.stringify(window.__errs||[])')
def calls(method, path):
    with LOCK: return [c for c in CALLS if c[0] == method and c[1] == path]
def reset():
    with LOCK: del CALLS[:]

try:
    print('run.html, no code: the way back in with just the address')
    sid = open_page('/run', '!!document.getElementById("siEmail")')
    ok('the sign-in asks for the email you paid with', ask(sid, '!!document.getElementById("siEmail") && /email address you paid with/i.test(document.body.innerText)'), text(sid))
    reset()
    ask(sid, 'document.getElementById("siResend").click(); true')
    time.sleep(0.6)
    ok('pressing Send it again with nothing filled in asks for the EMAIL, not the code',
       'Put in the email address you paid with' in text(sid) and 'Put your party code in first' not in text(sid), text(sid))
    ok('and asked the Worker nothing', not CALLS, CALLS)
    ask(sid, 'document.getElementById("siEmail").value="dean@example.com"; document.getElementById("siResend").click(); true')
    until(sid, '/on its way/.test(document.getElementById("siSent").textContent)')
    rec = calls('POST', '/licence/recover')
    ok('the address goes to /licence/recover and nothing else', len(rec) == 1 and rec[0][2] == {'email': 'dean@example.com'} and len(CALLS) == 1, CALLS)
    ok('the page says the email is on its way if that address bought a party',
       'If that address bought a party, the email is on its way' in text(sid) and 'junk folder' in text(sid), text(sid))
    ok('the button says Sent and will not double-send', ask(sid, 'var b=document.getElementById("siResend"); b.disabled && b.textContent==="Sent"'), text(sid))
    ok('no script error on /run', errs(sid) == '[]', errs(sid))

    print('run.html, no code: the Worker is down')
    sid = open_page('/run', '!!document.getElementById("siEmail")')
    reset()
    ask(sid, 'document.getElementById("siEmail").value="down@example.com"; document.getElementById("siResend").click(); true')
    until(sid, '/Could not reach us/.test(document.getElementById("siSent").textContent)')
    ok('a Worker error says so plainly and leaves the button usable',
       'Could not reach us just now' in text(sid) and ask(sid, '!document.getElementById("siResend").disabled'), text(sid))
    ok('a half-typed address is caught on the page, not sent', (ask(sid, 'document.getElementById("siEmail").value="dean@"; document.getElementById("siResend").click(); document.getElementById("siSent").textContent') or '').startswith('That email does not look right') and len(calls('POST', '/licence/recover')) == 1, CALLS)

    print('run.html, a code and no email: the code path still works')
    sid = open_page('/run?code=ACDEFG', '!!document.getElementById("siEmail")')
    reset()
    ask(sid, 'document.getElementById("siResend").click(); true')
    until(sid, '/on its way/.test(document.getElementById("siSent").textContent)')
    rs = calls('POST', '/licence/resend')
    ok('a code on its own goes to /licence/resend with that code', len(rs) == 1 and rs[0][2] == {'code': 'ACDEFG'} and not calls('POST', '/licence/recover'), CALLS)
    ok('and says the email is on its way to the address you paid with', 'If that code is one of ours, the email is on its way to the address you paid with' in text(sid), text(sid))

    print('run.html, a wrong host key: the email field is on the same screen as the error')
    sid = open_page('/run?code=ACDEFG&key=notthekey', '!!document.getElementById("siEmail")')
    ok('the wrong-key message and the email box are on one screen',
       'That host key does not match party ACDEFG' in text(sid) and ask(sid, '!!document.getElementById("siEmail")'), text(sid))
    ok('no script error on /run with a bad key', errs(sid) == '[]', errs(sid))

    print('booked.html, no code: the same way back in')
    sid = open_page('/booked', 'document.getElementById("head").textContent!=="Checking your booking"')
    ok('with no code the page offers the email you paid with, not a support address',
       ask(sid, '!document.getElementById("lost").hidden') and 'Lost it? Put in the email you paid with' in text(sid) and 'hello@partyplay.com.au' not in text(sid), text(sid))
    ok('the code card and the by-code link are out of the way', ask(sid, 'document.querySelector(".codecard").hidden && document.querySelector(".again").hidden'), text(sid))
    reset()
    ask(sid, 'document.getElementById("lostEmail").value="dean@example.com"; document.getElementById("lostGo").click(); true')
    until(sid, '/on its way/.test(document.getElementById("lostMsg").textContent)')
    rec = calls('POST', '/licence/recover')
    ok('the address goes to /licence/recover', len(rec) == 1 and rec[0][2] == {'email': 'dean@example.com'}, CALLS)
    ok('and the page says the email is on its way', 'If that address bought a party, the email is on its way' in text(sid), text(sid))
    ok('no script error on /booked', errs(sid) == '[]', errs(sid))

    print('host.html: neither dead end is one')
    sid = open_page('/host?code=ACDEFG', '!!document.querySelector(".err")')
    ok('a link with no host key points at the sign-in, code carried over',
       ask(sid, 'var a=document.querySelector(".err a"); a && a.getAttribute("href")==="/run?code=ACDEFG" && /sent again/.test(a.textContent)'), text(sid))
    sid = open_page('/host?code=ACDEFG&key=notthekey', '!!document.querySelector(".err a")')
    ok('a wrong host key points at the sign-in too',
       ask(sid, 'var a=document.querySelector(".err a"); a && a.getAttribute("href")==="/run?code=ACDEFG"'), text(sid))
finally:
    try: B.close()
    except Exception: pass
    srv.shutdown()

print('\n%d of %d checks passed' % (ran - bad, ran))
EXPECTED = 20
if ran != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, ran))
    sys.exit(1)
sys.exit(1 if bad else 0)
