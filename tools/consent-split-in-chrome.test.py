#!/usr/bin/env python3
"""YOUR DETAILS: ONE TICK, "Send me offers from {venue}. I'm 18 or over." (Dean, 4 Nov 2026, 6 Nov release).

The 3 Nov step had two ticks ("I'm 18 or over" and "Keep me posted"). Dean folded 18+ into the offers
opt-in: one optional tick, built once in venueplay/app/vp-consent.js, consent version vpc-2-6nov.

This opens the REAL bingo, musical bingo and trivia phones in headless Chrome, served from this
checkout, with the Worker answered here, and plays the details step:

  A  one tick, #xOptin, unticked, the words exact with the venue's name; no #x18 and no other 18+
     words anywhere on the step
  V  a venue with no name: "Send me offers from this venue. I'm 18 or over."
  N  not ticked, email typed: joins, no opt-in, no consent_version (playing never depends on it)
  D  ticked, email typed: marketing_optin true and consent_version vpc-2-6nov reach the Worker
  E  ticked, NO email or mobile typed: nothing about consent reaches the Worker
  F  a venue collecting the opt-in with no email or mobile box: no tick, joins with a name
  G  at 320, 375 and 390 wide: on screen, inside the width, clear of the island (top 59px) and the
     home bar, no sideways scroll, box at least 18px, pink, the shared .optin style
  H  bingo only, a state that asks at its own age screen (the state rule, unchanged): after it is
     ticked the one offers tick stays, unticked and in the same words, and Join goes through

    python3 tools/consent-split-in-chrome.test.py      screenshots of the details step at 375 wide go
                                                       to $VP_SHOTS if set
    VP_CONSENT_SITE=<a venueplay folder>               serves that folder instead (the "before" picture)
Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib  # noqa: E402
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SHOTS = os.environ.get('VP_SHOTS', '')
SITE = os.path.abspath(os.environ.get('VP_CONSENT_SITE') or os.path.join(ROOT, 'venueplay'))

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

# The room code says what the venue collects. Every scenario has its own code, so a name one phone
# saved can never sign the next one in.
FULL = {'first_name': True, 'email': True, 'mobile': True, 'marketing_optin': True}
def collect_for(code):
    if code.startswith('NCX'): return {'first_name': True, 'last_name': True, 'marketing_optin': True}
    return dict(FULL)
POSTS = []   # (path, room code, body) of every POST the phone made to the Worker
LOCK = threading.Lock()


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def worker(self, body):
        u = urllib.parse.urlparse(self.path); p = u.path[len('/__worker'):]
        q = urllib.parse.parse_qs(u.query)
        code = str((body or {}).get('code') or q.get('code', [''])[0])
        ageq = code.startswith('AGE')
        if p.startswith('/join/info'):
            return self.send(200, json.dumps({'ok': True, 'exists': True, 'venue_name': '' if code.startswith('NVN') else 'The Test Hotel', 'collect': collect_for(code),
                                              'age_gate': ageq, 'paper_bingo': False}), 'application/json')
        if p.startswith('/play/live'):
            return self.send(200, json.dumps({'live': True, 'exists': True, 'age_gate': ageq, 'paper_bingo': False}), 'application/json')
        if p.startswith('/join'):
            return self.send(200, json.dumps({'token': 'tok-' + code, 'snapshot': None}), 'application/json')
        return self.send(200, '{}', 'application/json')
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); raw = self.rfile.read(n)
        if self.path.startswith('/__worker'):
            try: body = json.loads(raw.decode('utf-8') or '{}')
            except Exception: body = {}
            with LOCK: POSTS.append((urllib.parse.urlparse(self.path).path[len('/__worker'):], str(body.get('code') or ''), body))
            return self.worker(body)
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'): return self.worker({})
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB={};window.__FAKE_SIGNED_IN=false;window.__FAKE_UID="x";\n'
            return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        p = u.path
        if p == '/play': p = '/play.html'
        elif not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js')
            t = t.replace('https://game.venueplay.com.au', '/__worker')
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


def ask(sid, expr, wait=10):
    r = B.evaluate(sid, expr, wait)
    return None if r is None else r.get('result', {}).get('value')

def until(sid, expr, secs=15):
    t = time.time() + secs
    while time.time() < t:
        v = ask(sid, expr)
        if v: return v
        time.sleep(0.2)
    return False

def open_page(path, w, h):
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    B.call('Page.enable', {}, session=sid)
    B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    B.call('Page.navigate', {'url': BASE + path}, session=sid)
    return tid, sid

def shot(sid, name):
    if not SHOTS: return
    try:
        ask(sid, 'var e=document.getElementById("joinBtn"); if(e) e.scrollIntoView({block:"end"}); true')
        time.sleep(0.3)
        r = B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        open(os.path.join(SHOTS, name + '.png'), 'wb').write(base64.b64decode(r['data']))
        print('  shot ' + os.path.join(SHOTS, name + '.png'))
    except Exception as e:
        print('  (no screenshot: %s)' % e)

READY = 'document.querySelectorAll("#joinExtra input").length>0 && !document.getElementById("joinBtn").disabled'

# What the details step shows: every label in it, its words, its tick and where it sits.
TICKS = r'''(function(){
  var box=document.getElementById("joinExtra"); if(!box) return JSON.stringify({none:true});
  function R(e){ var b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}; }
  var out=[], ls=box.querySelectorAll("label");
  for(var i=0;i<ls.length;i++){ var l=ls[i], c=l.querySelector("input[type=checkbox]");
    out.push({text:(l.textContent||"").replace(/\s+/g," ").trim(), cls:l.className, id:c?c.id:"", checked:c?c.checked:null,
              defaultChecked:c?c.defaultChecked:null, r:R(l), box:c?R(c):null, accent:c?getComputedStyle(c).accentColor:"",
              display:getComputedStyle(l).display}); }
  return JSON.stringify({labels:out, W:innerWidth, sw:document.documentElement.scrollWidth});
})()'''

def ticks(sid):
    return json.loads(ask(sid, TICKS) or '{}')

def join(sid, name, optin=False, email=''):
    ask(sid, """(function(){
      var c=document.getElementById("xOptin"); if(c && c.checked!==%s) c.click();
      document.getElementById("nameIn").value=%s;
      var e=document.getElementById("xEmail"); if(e) e.value=%s;
      document.getElementById("joinBtn").click(); return true; })()""" % ('true' if optin else 'false', json.dumps(name), json.dumps(email)))

def sent(code, secs=6):
    """Every body the phone posted to /join or /capture for this code (the details travel on one of them)."""
    t = time.time() + secs
    while time.time() < t:
        with LOCK:
            # only the posts that carry the player (a name): the bingo phone also asks /join on load
            got = [b for (p, c, b) in POSTS if c == code and (p == '/capture' or p == '/join') and (b.get('first_name') or b.get('name'))]
        if got: return got
        time.sleep(0.2)
    return []

PAGES = [('bingo', '/play'), ('musical', '/app/musical/play.html'), ('trivia', '/app/trivia/play.html')]
WORDS = "Send me offers from The Test Hotel. I'm 18 or over."
NO_NAME_WORDS = "Send me offers from this venue. I'm 18 or over."
VERSION = 'vpc-2-6nov'
ISLAND = 59   # the iPhone's Dynamic Island and status bar: nothing a person taps sits in the top 59px
# A room code is six letters from the code alphabet (no O, 0, 1, I, L, B, 8): three say the scenario,
# three count, so every page gets codes nobody else used.
ALPHA = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'
CODES = iter(a + b + c for a in ALPHA for b in ALPHA for c in ALPHA)
def code(prefix): return prefix + next(CODES)

STEP_TEXT = 'document.getElementById("joinExtra").textContent'
VIEW = r"""(function(){ var c=document.getElementById("xOptin"); if(!c) return "{}"; var l=c.closest("label");
  l.scrollIntoView({block:"center"}); var r=l.getBoundingClientRect();
  return JSON.stringify({t:r.top,b:r.bottom,H:innerHeight}); })()"""

def page(game, path):
    sep = '&' if '?' in path else '?'
    print('\n%s phone (%s)' % (game, path))

    # A, G and the screenshot: the details step of a venue that collects email, mobile and the opt-in.
    for w, h in ((375, 812), (320, 640), (390, 844)):
        c = code('PTN'); tid, sid = open_page(path + sep + 'room=' + c, w, h)
        try:
            ok('%s %d: the details step is drawn' % (game, w), until(sid, READY), ask(sid, 'document.getElementById("joinExtra").innerHTML.slice(0,200)'))
            time.sleep(0.4)
            t = ticks(sid); L = t.get('labels', [])
            if w == 375: shot(sid, '%s-details-375' % game)
            ids = [x['id'] for x in L]
            ok('A %s %d: one tick, #xOptin, and no #x18' % (game, w), ids == ['xOptin'] and ask(sid, 'document.getElementById("x18")===null'), ids)
            ok('A %s %d: the words are exact: "%s"' % (game, w, WORDS), [x['text'] for x in L] == [WORDS], [x['text'] for x in L])
            ok('A %s %d: not ticked, in the markup or by a script' % (game, w),
               L and all(x['checked'] is False and x['defaultChecked'] is False for x in L), L)
            st = ask(sid, STEP_TEXT) or ''
            ok('A %s %d: the step says 18 once, inside the offers tick, and nowhere else' % (game, w), st.count('18') == 1, st)
            if len(L) == 1:
                x = L[0]
                ok('G %s %d: on screen, inside the screen width' % (game, w), x['r']['w'] > 0 and x['r']['l'] >= 0 and x['r']['r'] <= t['W'] + 0.5, x['r'])
                ok('G %s %d: no sideways scroll' % (game, w), t['sw'] <= t['W'], (t['sw'], t['W']))
                ok('G %s %d: the shared on-brand tick (.optin, flex, box 18px or more, pink)' % (game, w),
                   'optin' in x['cls'].split() and x['display'] == 'flex' and x['box']['w'] >= 17.5 and x['box']['h'] >= 17.5
                   and x['accent'] not in ('', 'auto'), (x['cls'], x['display'], x['box'], x['accent']))
                v = json.loads(ask(sid, VIEW) or '{}')
                ok('G %s %d: scrolled to, clear of the island and the home bar' % (game, w),
                   v and v['t'] >= ISLAND and v['b'] <= v['H'] - 20, v)
        finally:
            B.close_tab(tid)

    # V: no venue name.
    c = code('NVN'); tid, sid = open_page(path + sep + 'room=' + c, 375, 812)
    try:
        until(sid, READY); time.sleep(0.3)
        got = [x['text'] for x in ticks(sid).get('labels', [])]
        ok('V %s: a venue with no name: "%s"' % (game, NO_NAME_WORDS), got == [NO_NAME_WORDS], got)
    finally:
        B.close_tab(tid)

    # N, D, E: what reaches the Worker comes from the one tick alone, and only with a contact method.
    for tag, optin, email, want in (('N', False, 'nee@example.com', False), ('D', True, 'dee@example.com', True), ('E', True, '', False)):
        c = code('PTN'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
        try:
            until(sid, READY)
            join(sid, 'Pat', optin=optin, email=email)
            got = sent(c)
            has = any(b.get('marketing_optin') is True for b in got)
            ver = any(b.get('consent_version') == VERSION for b in got)
            say = {'N': 'not ticked, email typed: joins with NO opt-in and no consent version',
                   'D': 'ticked, email typed: marketing_optin true and consent_version %s reach the Worker' % VERSION,
                   'E': 'ticked, no email or mobile: nothing about consent reaches the Worker'}[tag]
            ok('%s %s: %s' % (tag, game, say), bool(got) and has == want and ver == want, got)
            ok('%s %s: no age field is sent anywhere' % (tag, game),
               not [b for b in got if [k for k in b if '18' in k or k.startswith('age')]], got)
        finally:
            B.close_tab(tid)

    # F: an opt-in with no email or mobile box shows no tick, and Join works with just a name.
    c = code('NCX'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
    try:
        until(sid, READY)
        ids = [x['id'] for x in ticks(sid).get('labels', [])]
        ok('F %s: opt-in collected but no email or mobile box: no tick is drawn' % game, ids == [], ids)
        join(sid, 'Lee')
        got = sent(c)
        ok('F %s: and Join goes through with just a name, no opt-in' % game, bool(got) and not any(b.get('marketing_optin') for b in got), got)
    finally:
        B.close_tab(tid)


def bingo_age_screen():
    print('\nbingo phone: a state that asks at its own age screen (the state rule, unchanged)')
    c = code('AGE'); tid, sid = open_page('/play?room=' + c, 375, 812)
    try:
        ok('H: the state age screen is still up where the state asks', until(sid, 'document.getElementById("age18Chk")!==null'), '')
        until(sid, READY)
        ask(sid, 'document.getElementById("age18Chk").click(); document.getElementById("age18Btn").click(); true')
        ok('H: ticked, the age screen comes down', until(sid, 'document.getElementById("age18Chk")===null', 6), '')
        L = ticks(sid).get('labels', [])
        ok('H: and the one offers tick stays, unticked, in the same words', [(x['id'], x['text'], x['checked']) for x in L] == [('xOptin', WORDS, False)], L)
        if SHOTS: shot(sid, 'bingo-details-375-after-age-screen')
        join(sid, 'Max', optin=False, email='max@example.com')
        got = sent(c)
        ok('H: Join goes through with no opt-in', bool(got) and not any(b.get('marketing_optin') for b in got), got)
    finally:
        B.close_tab(tid)


if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('consent-split-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BASE = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        for g, p in PAGES:
            page(g, p)
        bingo_age_screen()
    finally:
        B.close()
        srv.shutdown()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    sys.exit(1 if bad else 0)
