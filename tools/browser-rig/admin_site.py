"""THE ADMIN PAGES, SERVED LOCALLY, WITH THE REAL BILLING WORKER BEHIND THEM.

Shared by tools/logo-tools-in-chrome.test.py and tools/dropdowns-in-chrome.test.py. Not a test.

It serves a checkout's venueplay/ and touring/ folders from a local web server and changes only
the outside addresses each page names:
  supabase-js        -> tools/browser-rig/fake-supabase.js, signed in as a venue OWNER or as an HQ
                        ADMIN (?as=owner|admin), answering the few tables the pages read from FAKE_DB
  the billing Worker -> the REAL venueplay-api-FULL.js in jsc behind a pipe
                        (tools/browser-rig/billing-stdio.js), so Your account and HQ talk to the
                        real routes, and a logo is judged by the real vpbLogoUpload
  the game Worker    -> a 404, which the admin pages already treat as "not reachable"
  Google Fonts       -> nothing (for tests), or left alone (for screenshots, so they look right)
Everything else is the shipped page and the shipped /app/*.js and *.css it loads.

ROOT may be another checkout (a pristine origin/main for "before" screenshots). The rig files are
always this checkout's.
"""
import base64, http.server, importlib.util, io, json, os, socket, subprocess, threading, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(REPO, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(VL)

IPHONE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
             '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')


class BillingWorker(object):
    def __init__(self, root):
        self.p = subprocess.Popen([JSC, os.path.join(HERE, 'billing-stdio.js')], cwd=root, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.lock = threading.Lock()
        first = self.p.stdout.readline()
        if not first:
            raise RuntimeError('the billing Worker rig did not start')
        self.info = json.loads(first)
        self.calls = []

    def _send(self, obj):
        with self.lock:
            self.p.stdin.write(json.dumps(obj) + '\n')
            self.p.stdin.flush()
            line = self.p.stdout.readline()
        return json.loads(line) if line else {'status': 502, 'body': {'error': 'billing rig died'}}

    def ask(self, method, path, body, headers):
        self.calls.append((path, body))
        return self._send({'method': method, 'path': path, 'body': body, 'headers': headers})

    def seed(self, table, rows):
        return self._send({'ask': 'seed', 'table': table, 'rows': rows})['body']

    def sent(self):
        return self._send({'ask': 'sent'})['body']

    def stored(self):
        return self._send({'ask': 'stored'})['body']

    def provision(self, session):
        """Run the REAL vpaProvisionFromCheckout on a Stripe checkout session, as the webhook does."""
        return self._send({'ask': 'provision', 'session': session})

    def table(self, name):
        return self._send({'ask': 'db', 'table': name})['body']

    def close(self):
        try:
            self.p.stdin.close()
            self.p.terminate()
        except Exception:
            pass


def fake_db(info, admin):
    uid, v1, v2 = info['uid'], info['venue'], info['venue2']
    venues = [
        {'id': v1, 'name': 'Deepwater Hotel', 'slug': 'deepwater-hotel', 'status': 'active', 'suspended_reason': None,
         'join_code': 'DPW123', 'au_state': 'NSW', 'postcode': '2371', 'max_players': 80, 'included_players': None,
         'created_at': '2026-09-01T00:00:00Z', 'timezone': 'Australia/Sydney', 'founding_id': 'f1',
         'entity_type': None, 'paid_entry_enabled': False, 'weekly_limit_off': False},
        {'id': v2, 'name': 'The Royal Arms', 'slug': 'the-royal-arms', 'status': 'active', 'suspended_reason': None,
         'join_code': 'RYL456', 'au_state': 'NSW', 'postcode': '2000', 'max_players': 60, 'included_players': None,
         'created_at': '2026-09-02T00:00:00Z', 'timezone': 'Australia/Sydney', 'founding_id': 'f1',
         'entity_type': 'for_profit', 'paid_entry_enabled': False, 'weekly_limit_off': False},
    ]
    return {
        'vp_platform_admins': [{'auth_user_id': uid, 'role': 'owner', 'label': 'Dean'}] if admin else [],
        'vp_venue_staff': [] if admin else [
            {'auth_user_id': uid, 'venue_id': v1, 'role': 'owner', 'display_name': 'Olive Owner'},
            {'auth_user_id': uid, 'venue_id': v2, 'role': 'owner', 'display_name': 'Olive Owner'}],
        'vp_venues': venues,
        'vp_venue_settings': [],
        'venueplay_founding': [{'id': 'f1', 'venue_name': 'Deepwater Hotel', 'contact_email': 'owner@test.local',
                                'optin_release_approved': True}],
    }


TOURING = {
    'shows': [{'id': '6b3b81d0-5b13-46d8-b469-f39cda4e39c4', 'show_date': '2026-10-24', 'venue': 'Tugun Bowls Club',
               'suburb': 'Tugun', 'host': 'Vollie LaVont', 'queens': ['ShuShu Funtanna', 'Scarlett Fever'],
               'price': '$30+BF', 'time': '7:00 PM', 'doors': '6:30 PM', 'img_src': '', 'show_type': 'drag_bingo'}],
    'artists': [{'name': 'Vollie LaVont'}],
    'venues': [{'name': 'Tugun Bowls Club', 'suburb': 'Tugun'}],
    'tour_categories': [{'id': '757c779e-9cdf-4a86-a7a8-3925e52c9744', 'name': 'Drag Bingo at the Bowlo',
                         'tour_key': 'drag_bingo', 'priority': 10, 'categories': ['drag'], 'image_url': None},
                        {'id': '857c779e-9cdf-4a86-a7a8-3925e52c9745', 'name': 'Gflam Touring Shows',
                         'tour_key': 'touring', 'priority': 20, 'categories': ['drag'], 'image_url': None}],
    'experience': [], 'ticket_milestones': [],
}


class Site(object):
    def __init__(self, root=REPO, fonts=False, extra_db=None, live_tables=None, game=None, game_tables=None):
        """game: optionally the REAL game Worker on a pipe (tools/browser-rig/rig.py Worker), answering
        /__game instead of a 404; game_tables: tables the page reads live from THAT Worker's database
        (e.g. vp_member_draws, which the game Worker writes), named in live_tables as well."""
        self.game = game
        self.game_tables = game_tables or []
        self.root = os.path.abspath(root)
        self.extra_db = extra_db or {}          # more rows for the stand-in supabase-js, by table
        self.live_tables = live_tables or []    # tables the page reads from the Worker rig's database
        self.fonts = fonts
        self.W = BillingWorker(self.root)
        site = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def send(self, code, body, ctype):
                b = body.encode('utf-8') if isinstance(body, str) else body
                self.send_response(code)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(b)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(b)

            def api(self, method):
                n = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(n) or b'{}') if n else {}
                path = self.path[len('/__api'):] or '/'
                r = site.W.ask(method, path, body, {k: v for k, v in self.headers.items()})
                self.send(r.get('status', 500), json.dumps(r.get('body')), 'application/json')

            def do_OPTIONS(self):
                self.send(204, b'', 'text/plain')

            def game(self, method):
                n = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(n) or b'{}') if n else {}
                path = self.path[len('/__game'):] or '/'
                r = site.game.ask(method, path, body, {k: v for k, v in self.headers.items()})
                self.send(r.get('status', 500), json.dumps(r.get('body')), 'application/json')

            def do_POST(self):
                if self.path.startswith('/__api'):
                    return self.api('POST')
                if site.game and self.path.startswith('/__game'):
                    return self.game('POST')
                if self.path.startswith('/__touring/'):
                    n = int(self.headers.get('Content-Length') or 0)
                    if n:
                        self.rfile.read(n)
                    return self.send(200, '{"ok":true,"rows":[],"written":0}', 'application/json')
                self.send(404, '{"error":"not reachable in this test"}', 'application/json')

            def do_GET(self):
                u = urllib.parse.urlparse(self.path)
                if u.path.startswith('/__api'):
                    return self.api('GET')
                if u.path.startswith('/__sb/rest/v1/'):
                    table = u.path[len('/__sb/rest/v1/'):]
                    return self.send(200, json.dumps(TOURING.get(table, [])), 'application/json')
                if u.path.startswith('/__db/'):
                    t = u.path[len('/__db/'):]
                    if site.game and t in site.game_tables:
                        r = site.game_table(t)
                        return self.send(200, json.dumps(r or []), 'application/json')
                    return self.send(200, json.dumps(site.W.table(t)), 'application/json')
                if u.path.startswith('/__game'):
                    if site.game: return self.game('GET')
                    return self.send(404, '{"error":"not reachable in this test"}', 'application/json')
                if u.path == '/__fake/supabase.js':
                    admin = urllib.parse.parse_qs(u.query).get('as', ['owner'])[0] == 'admin'
                    db = fake_db(site.W.info, admin)
                    for t, rows in site.extra_db.items():
                        db[t] = (db.get(t) or []) + rows if t != 'vp_venues' else rows
                    pre = 'window.__FAKE_DB=%s;window.__FAKE_SIGNED_IN=true;window.__FAKE_UID=%s;window.__LIVE_TABLES=%s;\n' % (
                        json.dumps(db), json.dumps(site.W.info['uid']), json.dumps(site.live_tables))
                    return self.send(200, pre + io.open(os.path.join(HERE, 'fake-supabase.js'), encoding='utf-8').read(),
                                     'application/javascript')
                if u.path == '/__fake/blank.css':
                    return self.send(200, '', 'text/css')
                p = u.path
                base = 'venueplay'
                if p.startswith('/touring/'):
                    base, p = 'touring', p[len('/touring'):]
                if p in ('/app', '/app/'):
                    p = '/app/index.html'
                elif not os.path.splitext(p)[1] and not p.endswith('/'):
                    p = p + '.html'   # Pages serves /app/go from go.html (the one-off sign-in link, 29 Oct 2026)
                f = os.path.normpath(os.path.join(site.root, base, p.lstrip('/')))
                if not f.startswith(os.path.join(site.root, base)) or not os.path.isfile(f):
                    return self.send(404, 'not here', 'text/plain')
                ext = os.path.splitext(f)[1].lower()
                if ext in ('.html', '.js', '.json', '.css', '.txt'):
                    text = io.open(f, encoding='utf-8').read()
                    if ext == '.html':
                        text = site.rewrite(text, urllib.parse.parse_qs(u.query).get('as', ['owner'])[0])
                    elif ext == '.js':
                        # A shared script that calls the billing Worker itself (vp-oneclick.js, vp-about-you.js,
                        # vp-prospects-hq.js) talks to THIS rig's Worker, never the live one (29 Oct 2026).
                        text = text.replace('https://venueplay-api.dean-tindale.workers.dev', '/__api')
                    ctype = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
                             '.css': 'text/css'}.get(ext, 'text/plain')
                    return self.send(200, text, ctype + '; charset=utf-8')
                ctype = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
                         '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
                return self.send(200, io.open(f, 'rb').read(), ctype)

        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.srv.socket.listen(128)   # Python's default queue of 5 drops scripts when a page asks for many at once (rig.py Server, 26 Oct 2026)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = 'http://127.0.0.1:%d' % self.srv.server_address[1]
        self.B = VL.Browser()

    def game_table(self, name):
        """A table from the game Worker rig's database (worker-stdio.js answers {table})."""
        with self.game.lock:
            self.game.p.stdin.write(json.dumps({'table': name}) + '\n'); self.game.p.stdin.flush()
            line = self.game.p.stdout.readline()
        return (json.loads(line) or {}).get('body') if line else []

    ERRS = ('<script>window.__errs=[];window.addEventListener("error",function(e){__errs.push(String(e.message)+" @"+'
            '(e.filename||"").split("/").pop()+":"+e.lineno)});window.addEventListener("unhandledrejection",function(e)'
            '{__errs.push("rejected: "+String(e.reason&&e.reason.message||e.reason))});'
            'window.alert=function(m){(window.__alerts=window.__alerts||[]).push(String(m))};'
            'window.confirm=function(){return true};</script>')

    def rewrite(self, text, who):
        if '<head>' in text:
            text = text.replace('<head>', '<head>' + self.ERRS, 1)
        text = text.replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/__fake/supabase.js?as=' + who)
        text = text.replace('https://venueplay-api.dean-tindale.workers.dev', '/__api')
        text = text.replace('https://venueplay-game.dean-tindale.workers.dev', '/__game')
        # The touring show manager (touring/manage.html): its database and its Worker.
        text = text.replace('const SUPABASE_URL = "https://ijkzgmdtwtgfkedqspxm.supabase.co";', 'const SUPABASE_URL = "/__sb";')
        text = text.replace('const TOURING_API = "https://touring-api.dean-tindale.workers.dev";', 'const TOURING_API = "/__touring";')
        if not self.fonts:
            text = text.replace('https://fonts.googleapis.com/css2', '/__fake/blank.css')
        return text

    # ---- the browser ----
    def open(self, path, width=1280, height=900, mobile=False):
        tid, sid = self.B.open_tab('about:blank')
        self.B.call('Page.enable', {}, session=sid)
        self.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height,
                    'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
        if mobile:
            self.B.call('Emulation.setUserAgentOverride', {'userAgent': IPHONE_UA, 'platform': 'iPhone'}, session=sid)
            self.B.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5}, session=sid)
        self.B.call('Page.navigate', {'url': self.base + path}, session=sid)
        return tid, sid

    def js(self, sid, expr, wait=False, secs=10):
        # HUNG is the PAGE stopping (no answer, or its own CPU spent spinning), never just a slow
        # machine: see Browser.evaluate in tools/verify-live.py (20 Oct 2026).
        r = self.B.evaluate(sid, expr, secs, await_promise=wait)
        if r is None:
            return 'HUNG'
        if r.get('exceptionDetails'):
            return {'__threw': json.dumps(r['exceptionDetails'])[:300]}
        return r.get('result', {}).get('value')

    def until(self, sid, expr, secs=15):
        t = time.time() + secs
        while time.time() < t:
            v = self.js(sid, expr)
            if v == 'HUNG':
                return v
            if v and not (isinstance(v, dict) and '__threw' in v):
                return v
            time.sleep(0.2)
        return False

    def set_file(self, sid, selector, path):
        root = self.B.call('DOM.getDocument', {'depth': 0}, session=sid)['root']['nodeId']
        node = self.B.call('DOM.querySelector', {'nodeId': root, 'selector': selector}, session=sid)['nodeId']
        if not node:
            raise RuntimeError('no element for ' + selector)
        self.B.call('DOM.setFileInputFiles', {'files': [path], 'nodeId': node}, session=sid)

    def shot(self, sid, path, full=False):
        r = self.B.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': bool(full)}, session=sid)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(r['data']))
        return path

    def close_tab(self, tid):
        try:
            self.B.close_tab(tid)
        except Exception:
            pass

    def close(self):
        try:
            self.B.close()
        finally:
            self.W.close()
            self.srv.shutdown()
