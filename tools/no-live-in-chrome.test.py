#!/usr/bin/env python3
"""A TEST CHROME CANNOT REACH PRODUCTION, AND SAYS SO WHEN IT TRIES (16 Nov 2026).

A real headless Chrome, started the way every suite starts one (verify-live.py Browser), opens a page
from this machine that tries production every way a page can: fetch, a WebSocket, an image, a script
tag, a beacon, a dedicated Worker's fetch, the live database, the workers.dev account. Then:

  the page's own server still answers it (the block is not "no network")
  every production request fails in the page, and the WebSocket never opens
  every production host reached this process's trap, not the internet
  the full URL of each is known, the WebSocket's too
  a CHILD run of the same page with no allow ends "FAIL the test browser tried to reach production: <url>
  (tools/no-live-in-chrome.test.py)" and exit 1, after printing its own pass line

    python3 tools/no-live-in-chrome.test.py

The block itself: tools/nolive.py. Its logic without Chrome: tools/nolive.test.py.
"""
import http.server, importlib.util, os, subprocess, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
import nolive  # noqa: E402

CHILD = '--child' in sys.argv

TRIES = [
    ('fetch', 'https://game.venueplay.com.au/health'),
    ('fetch', 'https://api.venueplay.com.au/billing/me'),
    ('fetch', 'https://ijkzgmdtwtgfkedqspxm.supabase.co/rest/v1/vp_venues?select=id'),
    ('fetch', 'https://venueplay-game.dean-tindale.workers.dev/health'),
    ('fetch', 'http://api.partyplay.com.au/health'),
    ('ws', 'wss://game.venueplay.com.au/room/ws?room=NOLIVE&role=tv'),
    ('img', 'https://venueplay.com.au/icons/nolive.png'),
    ('script', 'https://www.venueplay.com.au/app/nolive.js'),
    ('beacon', 'https://send.venueplay.com.au/nolive'),
    ('worker', 'https://help.partyplay.com.au/nolive'),
]

PAGE = '''<!doctype html><meta charset="utf-8"><title>nolive</title><body><script>
window.R = {};
var T = %s;
function done(k, v) { R[k] = v; }
fetch('/ok').then(function (r) { return r.text(); }).then(function (t) { done('own', t); }, function (e) { done('own', 'error ' + e); });
T.forEach(function (t, i) {
  var k = t[0] + ' ' + t[1];
  try {
    if (t[0] === 'fetch') fetch(t[1], {mode: 'no-cors'}).then(function () { done(k, 'ANSWERED'); }, function () { done(k, 'failed'); });
    if (t[0] === 'ws') { var w = new WebSocket(t[1]); w.onopen = function () { done(k, 'OPEN'); }; w.onclose = function () { if (!(k in R)) done(k, 'failed'); }; }
    if (t[0] === 'img') { var im = new Image(); im.onload = function () { done(k, 'ANSWERED'); }; im.onerror = function () { done(k, 'failed'); }; im.src = t[1]; }
    if (t[0] === 'script') { var s = document.createElement('script'); s.onload = function () { done(k, 'ANSWERED'); }; s.onerror = function () { done(k, 'failed'); }; s.src = t[1]; document.head.appendChild(s); }
    if (t[0] === 'beacon') { navigator.sendBeacon(t[1], 'x'); done(k, 'failed'); }
    if (t[0] === 'worker') {
      var wk = new Worker(URL.createObjectURL(new Blob(["fetch('" + t[1] + "',{mode:'no-cors'}).then(function(){postMessage('ANSWERED')},function(){postMessage('failed')})"], {type: 'text/javascript'})));
      wk.onmessage = function (e) { done(k, e.data); };
    }
  } catch (e) { done(k, 'failed'); }
});
</script>''' % __import__('json').dumps(TRIES)


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = (b'own server' if self.path == '/ok' else PAGE.encode())
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain' if self.path == '/ok' else 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:%d/' % srv.server_address[1]

if CHILD:
    # No allow: this run must end with the FAIL lines and exit 1, after its own last line.
    B = VL.Browser()
    tid, sid = B.open_tab('about:blank')   # attach + Network.enable first, then load (see the note in the main run)
    B.call('Page.navigate', {'url': URL}, session=sid)
    end = time.time() + 60
    while time.time() < end and (B.eval(sid, 'Object.keys(window.R || {}).length') or 0) < len(TRIES) + 1:
        time.sleep(0.25)
    time.sleep(1)
    print('ALL 1 CHECKS PASSED')
    sys.exit(0)

# This run tries production ON PURPOSE, to prove it is stopped; it would otherwise fail itself.
for _kind, u in TRIES:
    nolive.allow(u, 'no-live-in-chrome tries production on purpose to prove the block')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600]))
    sys.stdout.flush()
    if not cond:
        bad += 1

B = VL.Browser()
try:
    # OPEN BLANK, THEN LOAD: Target.createTarget with the page's address starts loading before Browser's
    # Network.enable lands, and on a busy server (vp-tests-1, 16 Nov 2026, -j 3) every request went out before it:
    # the trap saw all 9 hosts, the URL log saw none. A blank tab is attached and listening before the page loads.
    tid, sid = B.open_tab('about:blank')
    B.call('Page.navigate', {'url': URL}, session=sid)
    end = time.time() + 90
    R = {}
    while time.time() < end:
        R = __import__('json').loads(B.eval(sid, 'JSON.stringify(window.R || {})') or '{}')
        if len(R) >= len(TRIES) + 1:
            break
        time.sleep(0.25)
    time.sleep(1.5)
    ok('the page\'s own server still answers it (the block is not "no network")', R.get('own') == 'own server', R)
    answered = sorted(k for k, v in R.items() if k != 'own' and v != 'failed')
    ok('every one of the %d production requests failed in the page, the WebSocket never opened' % len(TRIES),
       len(R) == len(TRIES) + 1 and not answered, R)
    hosts = sorted(set(nolive.host_of(u) for _k, u in TRIES))
    with nolive._LOCK:
        hit = dict(nolive._HITS)
        urls = {k: list(v) for k, v in nolive._URLS.items()}
    ok('every production host (%d) reached this process\'s trap, not the internet' % len(hosts),
       all(hit.get(h) for h in hosts), (hosts, hit))
    page_urls = [u for k, u in TRIES if k != 'worker']
    seen = [u for u in page_urls if u in urls.get(nolive.host_of(u), [])]
    ok('the full address of every request from the tab is known, the WebSocket\'s too',
       seen == page_urls, (sorted(set(page_urls) - set(seen)), urls))
    ok('the attempts are all allowed here, so this run does not fail itself', all(why for _u, why in nolive.attempts()), nolive.attempts())
finally:
    B.close()

p = subprocess.run([sys.executable, os.path.abspath(__file__), '--child'], cwd=ROOT, capture_output=True, text=True, timeout=300)
lines = (p.stdout or '').strip().splitlines()
fails = [l for l in lines if l.startswith('FAIL the test browser tried to reach production: ')]
ok('a run with no allow exits 1 even though it printed its own pass line', p.returncode == 1 and 'ALL 1 CHECKS PASSED' in lines, (p.returncode, lines[-5:], p.stderr[-400:]))
ok('and its last lines name each address and the suite: "FAIL the test browser tried to reach production: <url> (tools/no-live-in-chrome.test.py)"',
   lines and lines[-1] in fails and all(any(l.startswith('FAIL the test browser tried to reach production: ' + u + ' (tools/no-live-in-chrome.test.py)') for l in fails)
                                        for k, u in TRIES if k != 'worker'), fails)

print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
