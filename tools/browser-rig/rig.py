"""THE BROWSER RIG AS A MODULE: the repo's real venueplay/ pages, served locally, against the REAL game
Worker running in jsc behind a pipe, with supabase-js swapped for tools/browser-rig/fake-supabase.js
(realtime carried between tabs by BroadcastChannel). The same rig tools/console-in-chrome.test.py
builds inline, lifted out so more than one suite can stand it up. Never shipped: it lives under tools/.

    import rig;  r = rig.Rig();  tid, sid = r.open('/tv?venue=test-alpha');  ...;  r.close()
"""
import atexit, base64, http.server, importlib.util, io, json, os, subprocess, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
UID = '11111111-1111-4111-8111-111111111111'


class Worker(object):
    def __init__(self):
        self.p = subprocess.Popen([JSC, 'tools/browser-rig/worker-stdio.js'], cwd=ROOT, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.lock = threading.Lock()
        self.calls = []      # every path the pages asked, so a test can wait for "the Worker has been asked"
        self.info = json.loads(self.p.stdout.readline())

    def ask(self, method, path, body=None, headers=None):
        with self.lock:
            self.calls.append(path.split('?')[0])
            self.p.stdin.write(json.dumps({'method': method, 'path': path, 'body': body or {}, 'headers': headers or {}}) + '\n')
            self.p.stdin.flush()
            line = self.p.stdout.readline()
        return json.loads(line) if line else {'status': 502, 'body': {'error': 'worker rig died'}}

    def seed(self, table, rows, replace=False):
        """The test's own hands on the Worker's fake database (worker-stdio.js answers {seed}): rows in
        before a scene. Never a Worker route: the pages cannot reach it. Same shape as the seed in
        tools/pickup-in-chrome.test.py, lifted here so the TV scenes can stand up venues of their own."""
        with self.lock:
            self.p.stdin.write(json.dumps({'seed': table, 'rows': rows, 'replace': replace}) + '\n')
            self.p.stdin.flush()
            line = self.p.stdout.readline()
        return json.loads(line) if line else None

    def close(self):
        try: self.p.stdin.close()
        except Exception: pass
        try:
            if self.p.poll() is None:
                self.p.terminate()
                try: self.p.wait(timeout=5)
                except Exception: self.p.kill()
        except Exception: pass


ERRS = ('<script>window.__errs=[];window.addEventListener("error",function(e){__errs.push(String(e.message)+" @"+(e.filename||"").split("/").pop()+":"+e.lineno)});'
        'window.addEventListener("unhandledrejection",function(e){__errs.push("rejected: "+String(e.reason&&e.reason.message||e.reason))});</script>')


class Server(http.server.ThreadingHTTPServer):
    """A LISTEN QUEUE BIG ENOUGH FOR TWO SCREENS (26 Oct 2026). Python's default is 5. A TV and a
    console opening together ask for ~25 scripts at once, and past five waiting connections the
    kernel drops the rest: Chrome reports the script as a network error (status 0, no error event
    on the page), so a global like VPDraw or VP_HOLD is simply never defined. The caller-winner
    suite went red on games 1 to 5 that way, at random, with the TV sitting on the ads because the
    console never got as far as sending it the game. A harness fault that looks like a product one."""
    request_queue_size = 128
    daemon_threads = True


class Rig(object):
    def __init__(self, hold=None):
        """`hold` is {path: seconds}: the local site sits on that file for that long before serving it,
        as slow pub wifi does, so a test can look at a page whose scripts have not all arrived."""
        self.hold = dict(hold or {})
        self.W = Worker()
        W = self.W
        self.db = {
            'vp_platform_admins': [],
            'vp_venue_staff': [{'auth_user_id': UID, 'venue_id': W.info['venue'], 'role': 'owner', 'display_name': 'Test Host'}],
            'vp_venues': [{'id': W.info['venue'], 'name': 'Test Alpha', 'slug': W.info['slug'], 'status': 'active', 'suspended_reason': None,
                           'join_code': W.info['code'], 'au_state': 'QLD', 'max_players': 100, 'included_players': None,
                           'created_at': '2026-01-01T00:00:00Z', 'postcode': '4000', 'logo_url': None, 'paid_entry_enabled': False}],
            'vp_venue_settings': [],
        }
        rig = self

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
                r = rig.W.ask(method, path, body, {k: v for k, v in self.headers.items()})
                self.send(r.get('status', 500), json.dumps(r.get('body')), 'application/json')
            def do_POST(self):
                if self.path.startswith('/__worker'): return self.worker('POST')
                self.send(404, '{}', 'application/json')
            def do_GET(self):
                u = urllib.parse.urlparse(self.path)
                if u.path.startswith('/__worker'): return self.worker('GET')
                if u.path in rig.hold: time.sleep(rig.hold[u.path])
                if u.path == '/__fake/supabase.js':
                    host = urllib.parse.parse_qs(u.query).get('host', ['0'])[0] == '1'
                    pre = 'window.__FAKE_DB=%s;window.__FAKE_SIGNED_IN=%s;window.__FAKE_UID=%s;\n' % (json.dumps(rig.db), 'true' if host else 'false', json.dumps(UID))
                    return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
                if u.path == '/__fake/qrcode.js':
                    return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);},toDataURL:function(t,o,cb){var f=typeof o==="function"?o:cb;if(f)f(null,"data:,");return Promise.resolve("data:,");}};', 'application/javascript')
                if u.path == '/__blank':
                    return self.send(200, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000"></body></html>', 'text/html')
                p = u.path
                if p in ('/app', '/app/'): p = '/app/index.html'
                elif p.endswith('/'): p = p + 'index.html'
                elif p == '/play': p = '/play.html'
                elif p == '/tv': p = '/tv.html'
                elif not os.path.splitext(p)[1]: p = p + '.html'
                f = os.path.normpath(os.path.join(ROOT, 'venueplay', p.lstrip('/')))
                if not f.startswith(os.path.join(ROOT, 'venueplay')) or not os.path.isfile(f):
                    return self.send(404, 'not here', 'text/plain')
                ext = os.path.splitext(f)[1].lower()
                if ext in ('.html', '.js', '.json', '.css', '.txt'):
                    text = io.open(f, encoding='utf-8').read()
                    host_page = p in ('/app/index.html', '/app/purchase-raffle/index.html')   # pages that need a signed-in host
                    if '<head>' in text: text = text.replace('<head>', '<head>' + ERRS, 1)
                    text = text.replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/__fake/supabase.js?host=%d' % (1 if host_page else 0))
                    text = text.replace('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js', '/__fake/qrcode.js')
                    text = text.replace('https://game.venueplay.com.au', '/__worker')
                    ctype = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css'}.get(ext, 'text/plain')
                    return self.send(200, text, ctype + '; charset=utf-8')
                ctype = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
                return self.send(200, io.open(f, 'rb').read(), ctype)

        self.srv = Server(('127.0.0.1', 0), Site)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = 'http://127.0.0.1:%d' % self.srv.server_address[1]
        # The Browser registers itself with verify-live's atexit and SIGTERM handlers, so the Chrome
        # goes whatever ends this process (27 Oct 2026). The jsc Worker behind the pipe is ours to end.
        self.B = VL.Browser()
        atexit.register(self.close)

    # ---- tabs ----
    def open(self, path, before=None, width=None, height=None):
        """Open a page on the local site, in a WINDOW of its own. `before` is script run in the page
        before any of its own.

        Its own window, not a second tab (20 Oct 2026, as verify-live's Browser.open_tab): a tab behind
        another is "hidden", its timers held to once a second and its renderer given background
        priority, and on a busy machine it went 10 s and more without running. A TV, a phone and a bar
        tablet are three screens, each switched on, so three windows is the faithful model. That also
        retires front(): there is no tab to bring forward."""
        tid = self.B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        sid = self.B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        self.B.call('Page.enable', {}, session=sid)
        if width:
            self.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height or 800, 'deviceScaleFactor': 1, 'mobile': width < 600}, session=sid)
        if before:
            self.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': before}, session=sid)
        self.B.call('Page.navigate', {'url': self.base + path}, session=sid)
        return tid, sid

    def ask(self, sid, expr, wait=8):
        """The value, or 'HUNG' if the PAGE has stopped. Browser.evaluate (tools/verify-live.py) judges
        that by the page's own main-thread CPU, so an idle page that answered late on a starved machine
        is not called hung, and one that spun or never answered (a native dialog) still is."""
        r = self.B.evaluate(sid, expr, wait)
        return 'HUNG' if r is None else r.get('result', {}).get('value')

    def until(self, sid, expr, secs=15):
        t = time.time() + secs
        while time.time() < t:
            v = self.ask(sid, expr)
            if v == 'HUNG' or v: return v
            time.sleep(0.25)
        return False

    # The phone is ready for a name when its scripts have run (Join is enabled and says Join; until
    # then play.html shows it disabled, "Loading...") and the Worker has been asked about the room
    # (/join/info), as it is before a punter could have typed anything. Waiting for the BUTTON was the
    # console suite's flake (20 Oct 2026): it is in the markup above the scripts that wire it.
    JOIN_READY = ('document.readyState!=="loading" && (function(b){return !!b && !b.disabled && b.textContent.trim()==="Join";})'
                  '(document.getElementById("joinBtn"))')

    def phone_ready(self, sid, secs=120):
        """True once the phone could take a name (see JOIN_READY), or what it was showing instead."""
        v = self.until(sid, self.JOIN_READY, secs)
        if v is not True:
            return v
        t = time.time() + 15
        while time.time() < t and '/join/info' not in self.W.calls:
            time.sleep(0.1)
        return '/join/info' in self.W.calls

    def shot(self, sid, path):
        try:
            r = self.B.call('Page.captureScreenshot', {'format': 'jpeg', 'quality': 70}, session=sid)
            with open(path, 'wb') as f: f.write(base64.b64decode(r['data']))
        except Exception:
            pass

    def close_tab(self, tid):
        self.B.close_tab(tid)

    def close(self):
        """Idempotent: the suite's finally and atexit both call it."""
        if getattr(self, '_closed', False):
            return
        self._closed = True
        try: self.B.close()
        except Exception: pass
        self.W.close()
        try: self.srv.shutdown()
        except Exception: pass
