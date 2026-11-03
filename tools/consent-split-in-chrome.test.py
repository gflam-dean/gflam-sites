#!/usr/bin/env python3
"""YOUR DETAILS: "I'M 18 OR OVER" AND "KEEP ME POSTED" ARE TWO TICKS, NEVER ONE (3 Nov 2026).

The three player phones ended the details step with ONE tick, "I am 18 or over. Keep me posted on
what is on at the venue", which bundled a condition of entry with marketing consent. Marketing
consent must be optional and must not be bundled (Spam Act 2003, APP 7). Now the details step shows
two ticks, built once in venueplay/app/vp-consent.js:

  #x18     "I'm 18 or over"                            needed ONLY with the opt-in (4 Nov 2026): a gate on
                                                       the phone; nothing new is sent to the Worker
  #xOptin  "Keep me posted on what's on at the venue"  OPTIONAL, unticked; marketing_optin comes from
                                                       this tick ONLY, and only with an email or mobile

This opens the REAL bingo, musical bingo and trivia phones in headless Chrome, served from this
checkout, with the Worker answered here, and plays the details step:

  A  two separate ticks, each its own label, both unticked, in that order, the words exact, and no
     label anywhere on the step says both "18" and "posted"
  B  opt-in ticked, 18+ left empty: refused with "To get venue news, tick I'm 18 or over.", nothing sent
  N  neither ticked, email typed: joins, no opt-in (joining works as it did before)
  C  18+ ticked, opt-in left empty, email typed: joins, and what reaches the Worker has NO opt-in
  D  18+ and opt-in ticked, email typed: marketing_optin true reaches the Worker
  E  18+ and opt-in ticked, NO email or mobile typed: no opt-in reaches the Worker
  F  a venue collecting the opt-in with no email or mobile box: neither tick (nothing to keep posted by)
  G  at 320 wide: both ticks on screen, side by side with nothing, inside the screen, no sideways
     scroll, boxes at least 18px, pink, the shared .optin style
  H  bingo only, a state that asks at the age screen: no double ask. Ticked on the age screen, the
     details step's 18+ tick comes down; reloaded the same night, it is never drawn; the opt-in stays

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
            return self.send(200, json.dumps({'ok': True, 'exists': True, 'venue_name': 'The Test Hotel', 'collect': collect_for(code),
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

def join(sid, name, age=False, optin=False, email=''):
    ask(sid, '''(function(){
      function tick(id,v){ var c=document.getElementById(id); if(c && c.checked!==v) c.click(); }
      document.getElementById("nameIn").value=%s;
      %s %s
      var e=document.getElementById("xEmail"); if(e) e.value=%s;
      document.getElementById("joinBtn").click(); return true; })()''' % (
        json.dumps(name), 'tick("x18",true);' if age else '', 'tick("xOptin",true);' if optin else '', json.dumps(email)))

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
AGE_TEXT, OPTIN_TEXT, AGE_NEEDED = "I'm 18 or over", "Keep me posted on what's on at the venue", "To get venue news, tick I'm 18 or over."
# A room code is six letters from the code alphabet (no O, 0, 1, I, L, B, 8): three say the scenario,
# three count, so every page gets codes nobody else used.
ALPHA = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'
CODES = iter(a + b + c for a in ALPHA for b in ALPHA for c in ALPHA)
def code(prefix): return prefix + next(CODES)

def page(game, path):
    sep = '&' if '?' in path else '?'
    print('\n%s phone (%s)' % (game, path))

    # A, G and the screenshot: the details step of a venue that collects email, mobile and the opt-in.
    for w, h in ((375, 812), (320, 640)):
        c = code('PTN'); tid, sid = open_page(path + sep + 'room=' + c, w, h)
        try:
            ok('%s %d: the details step is drawn' % (game, w), until(sid, READY), ask(sid, 'document.getElementById("joinExtra").innerHTML.slice(0,200)'))
            time.sleep(0.4)
            t = ticks(sid); L = t.get('labels', [])
            if w == 375: shot(sid, '%s-details-375' % game)
            ids = [x['id'] for x in L]
            ok('A %s %d: two ticks, 18+ then the opt-in, each its own label' % (game, w), ids == ['x18', 'xOptin'], ids)
            ok('A %s %d: the words are exact: "%s" and "%s"' % (game, w, AGE_TEXT, OPTIN_TEXT),
               [x['text'] for x in L] == [AGE_TEXT, OPTIN_TEXT], [x['text'] for x in L])
            ok('A %s %d: neither is ticked, in the markup or by a script' % (game, w),
               L and all(x['checked'] is False and x['defaultChecked'] is False for x in L), L)
            ok('A %s %d: no label on the step says both 18 and "posted" (nothing bundled)' % (game, w),
               not [x for x in L if '18' in x['text'] and 'posted' in x['text'].lower()], [x['text'] for x in L])
            if len(L) == 2:
                a, b = L[0]['r'], L[1]['r']
                ok('G %s %d: both ticks on screen, inside the screen width' % (game, w),
                   all(x['r']['w'] > 0 and x['r']['l'] >= 0 and x['r']['r'] <= t['W'] + 0.5 for x in L), [x['r'] for x in L])
                ok('G %s %d: stacked, not overlapping' % (game, w), b['t'] >= a['b'] - 0.5, (a, b))
                ok('G %s %d: no sideways scroll' % (game, w), t['sw'] <= t['W'], (t['sw'], t['W']))
                ok('G %s %d: the shared on-brand tick (.optin, flex, boxes 18px or more, pink)' % (game, w),
                   all('optin' in x['cls'].split() and x['display'] == 'flex' and x['box']['w'] >= 17.5 and x['box']['h'] >= 17.5
                       and x['accent'] not in ('', 'auto') for x in L), [(x['cls'], x['display'], x['box'], x['accent']) for x in L])
        finally:
            B.close_tab(tid)

    # B: Join without the 18+ tick is refused, and nothing is sent.
    c = code('PTN'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
    try:
        until(sid, READY)
        join(sid, 'Sam', age=False, optin=True, email='sam@example.com')
        time.sleep(0.8)
        err = ask(sid, 'document.getElementById("joinErr").textContent')
        ok('B %s: opt-in ticked, 18+ empty: Join is refused: "%s"' % (game, AGE_NEEDED), err == AGE_NEEDED, err)
        ok('B %s: and nothing was sent to the Worker (no join, no details)' % game, sent(c, 1.5) == [], sent(c, 0.1))
        # then ticking 18+ clears the message and the same press goes through
        ask(sid, 'document.getElementById("x18").click(); true')
        ok('B %s: ticking 18+ takes the message down' % game, ask(sid, 'document.getElementById("joinErr").textContent') == '',
           ask(sid, 'document.getElementById("joinErr").textContent'))
        ask(sid, 'document.getElementById("joinBtn").click(); true')
        got = sent(c)
        ok('B %s: and Join then goes through, with the opt-in that was ticked' % game, any(b.get('marketing_optin') is True for b in got), got)
    finally:
        B.close_tab(tid)

    # C, D, E: what reaches the Worker comes from the opt-in tick alone, and only with a contact method.
    for tag, age, optin, email, want in (('N', False, False, 'nee@example.com', False), ('C', True, False, 'cee@example.com', False),
                                         ('D', True, True, 'dee@example.com', True), ('E', True, True, '', False)):
        c = code('PTN'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
        try:
            until(sid, READY)
            join(sid, 'Pat', age=age, optin=optin, email=email)
            got = sent(c)
            has = any(b.get('marketing_optin') is True for b in got)
            say = {'N': 'neither ticked, email typed: joins with NO opt-in, as joining worked before',
                   'C': '18+ ticked, opt-in empty, email typed: joins with NO opt-in',
                   'D': '18+ and opt-in ticked, email typed: marketing_optin reaches the Worker',
                   'E': '18+ and opt-in ticked, no email or mobile: NO opt-in (nothing to keep posted by)'}[tag]
            ok('%s %s: %s' % (tag, game, say), bool(got) and has == want, got)
            ok('%s %s: the 18+ tick is not sent anywhere (no new field for the Worker)' % (tag, game),
               not [b for b in got if [k for k in b if '18' in k or k.startswith('age')]], got)
        finally:
            B.close_tab(tid)

    # F: an opt-in with no email or mobile box shows neither tick, and Join works with just a name.
    c = code('NCX'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
    try:
        until(sid, READY)
        ids = [x['id'] for x in ticks(sid).get('labels', [])]
        ok('F %s: opt-in collected but no email or mobile box: neither tick is drawn' % game, ids == [], ids)
        join(sid, 'Lee')
        got = sent(c)
        ok('F %s: and Join goes through with just a name, no opt-in' % game, bool(got) and not any(b.get('marketing_optin') for b in got), got)
    finally:
        B.close_tab(tid)


def bingo_age_screen():
    print('\nbingo phone: a state that asks at the age screen (no double ask)')
    c = code('AGE'); tid, sid = open_page('/play?room=' + c, 375, 812)
    try:
        ok('H: the age screen is up', until(sid, 'document.getElementById("age18Chk")!==null'), '')
        until(sid, READY)
        ask(sid, 'document.getElementById("age18Chk").click(); document.getElementById("age18Btn").click(); true')
        ok('H: ticked on the age screen, the details step\'s 18+ tick comes down', until(sid, 'document.getElementById("x18")===null && document.getElementById("age18Chk")===null', 6),
           [x['id'] for x in ticks(sid).get('labels', [])])
        L = ticks(sid).get('labels', [])
        ok('H: and the opt-in stays, unticked and on its own', [(x['id'], x['text'], x['checked']) for x in L] == [('xOptin', OPTIN_TEXT, False)], L)
        if SHOTS: shot(sid, 'bingo-details-375-after-age-screen')
        join(sid, 'Max', optin=False, email='max@example.com')
        got = sent(c)
        ok('H: Join goes through without asking 18+ again, and with no opt-in', bool(got) and not any(b.get('marketing_optin') for b in got)
           and ask(sid, 'document.getElementById("joinErr").textContent') != AGE_NEEDED, got)
    finally:
        B.close_tab(tid)
    # Reloaded the same night (sessionStorage says ok): the 18+ tick is never drawn.
    c = code('AGE'); tid, sid = open_page('/play?room=' + c, 375, 812)
    try:
        until(sid, 'document.getElementById("age18Chk")!==null')
        ask(sid, 'document.getElementById("age18Chk").click(); document.getElementById("age18Btn").click(); true')
        time.sleep(0.5)
        B.call('Page.navigate', {'url': BASE + '/play?room=' + c}, session=sid)
        time.sleep(1.0)
        until(sid, READY)
        time.sleep(0.5)
        ids = [x['id'] for x in ticks(sid).get('labels', [])]
        ok('H: reloaded the same night: no age screen, and the details step draws only the opt-in',
           ids == ['xOptin'] and ask(sid, 'document.getElementById("age18Chk")===null'), ids)
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
