#!/usr/bin/env python3
"""A KNOWN PHONE, FIRST NAME + MOBILE AT EVERY VENUE, THE THREE BOXES: THE REAL PHONES IN CHROME (INBOX 416, 22 Nov 2026).

Opens the REAL bingo (/play), musical bingo and trivia phones in headless Chrome, served from this checkout, with the
game Worker answered here the way venueplay-backend/worker/venueplay-game.js answers (tools/test-known-phone.js runs
that half for real), at 375x812 and 390x844, and checks per phone:

  N  a NEW phone at a venue that collects nothing: the first name and the mobile are asked (trivia: team name, its own
     first-name box, mobile); the join line "Your details go to <venue> to run tonight's game and contact winners.";
     one screen, no scroll, Join on screen
  J  joining sends the details; the Worker's known_key is kept on the phone
  K  the same phone back for the next game: /join/known is asked with the key; "Welcome back, Alan" and a Not me link;
     no box for anything held (bingo/musical: the name box is out of the way); the join sends the key and no detail;
     no detail we hold is anywhere on the screen
  A  a field the venue added since: only that box
  M  Not me: the key goes from the phone, the full form is back
  T  the three boxes (switched on, a visiting host): pre-ticked, the venueplay / venue / host names, the exact words;
     a venue asking EVERYTHING plus the three boxes still fits one screen; an unticked box goes to the Worker as false
Frames go to ~/venue-enrich/reports/sun22-known-phone/ (one PNG per screen and size).

    python3 tools/known-phone-in-chrome.test.py
Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib  # noqa: E402
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS') or os.path.expanduser('~/venue-enrich/reports/sun22-known-phone')
try: os.makedirs(SHOTS, exist_ok=True)
except Exception: SHOTS = ''

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

KEY = 'ab' * 32
NOTHING = {'first_name': True, 'last_name': False, 'postcode': False, 'email': False, 'mobile': True, 'mobile_required': False, 'marketing_optin': False}
EVERYTHING = {'first_name': True, 'last_name': True, 'postcode': True, 'email': True, 'mobile': True, 'mobile_required': False, 'marketing_optin': True}
THREE = {'mode': 'three', 'version': 'vpc-4-22nov', 'parties': [{'party': 'venueplay', 'name': 'venueplay'}, {'party': 'venue', 'name': 'The Royal Hotel'}, {'party': 'host', 'name': 'Quiz Masters Co'}]}
# The room code says what the fake Worker answers. NEW..: a new phone; KNW..: known, nothing missing; ADD..: known, the
# venue added email; THR..: everything plus the three boxes.
NOTICE = {'version': 'vpn-3-16nov', 'before': 'By playing you agree to ', 'link': "venueplay's terms and privacy policy", 'after': '. A ticked box shares your details with that sender for news and offers.', 'href': '/privacy'}
NOTICE['text'] = NOTICE['before'] + NOTICE['link'] + NOTICE['after']
PRIV = os.path.expanduser('~/venue-enrich/reports/privacy-update-16nov/returning')
try: os.makedirs(PRIV, exist_ok=True)
except Exception: PRIV = ''
# RETURNING (Dean 16 Nov 2026): RSM.. a NEW venue asking the same fields; RMR.. a new venue asking one MORE (postcode);
# RNT.. the same venue, a second night. All known, no notice, the boxes as each sender's current answer.
RET = {
  'RSM': ({'mode': 'three', 'version': 'vpc-4-22nov', 'parties': [{'party': 'venueplay', 'name': 'venueplay', 'current': True}, {'party': 'venue', 'name': 'The Royal Hotel'}]}, []),
  'RMR': ({'mode': 'three', 'version': 'vpc-4-22nov', 'parties': [{'party': 'venueplay', 'name': 'venueplay', 'current': True}, {'party': 'venue', 'name': 'The Royal Hotel'}]}, ['postcode']),
  'RNT': ({'mode': 'three', 'version': 'vpc-4-22nov', 'parties': [{'party': 'venueplay', 'name': 'venueplay', 'current': True}, {'party': 'venue', 'name': 'The Royal Hotel', 'current': False}]}, []),
}
def answer_for(code):
    if code.startswith('RMR'): return dict(NOTHING, postcode=True)
    if code.startswith('ADD'): return dict(NOTHING, email=True)
    if code.startswith('THR'): return dict(EVERYTHING)
    return dict(NOTHING)
POSTS = []
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
        J = lambda o: self.send(200, json.dumps(o), 'application/json')
        if p == '/join/info':
            return J({'ok': True, 'exists': True, 'venue_name': 'The Royal Hotel', 'collect': answer_for(code), 'age_gate': False, 'paper_bingo': False})
        if p == '/join/known':
            keys = (body or {}).get('keys') or []
            known = None
            if KEY in keys and (code.startswith('KNW') or code.startswith('ADD')):
                known = {'hello': 'Alan', 'need': ['email'] if code.startswith('ADD') else [], 'ix': keys.index(KEY)}
            consent = THREE if code.startswith('THR') else {'mode': 'single'}
            if KEY in keys and code[:3] in RET:
                consent, need = RET[code[:3]]
                known = {'hello': 'Grace', 'need': need, 'ix': keys.index(KEY)}
            return J({'known': known, 'consent': consent, 'organiser': 'The Royal Hotel', 'notice': None if known else NOTICE})
        if p == '/play/live':
            return J({'live': True, 'exists': True, 'age_gate': False, 'paper_bingo': False})
        if p in ('/join', '/capture'):
            b = body or {}
            r = {'token': 'tok-' + code, 'snapshot': None, 'ok': True, 'stored': True}
            if b.get('mobile') and b.get('first_name') and not b.get('known_keys'): r['known_key'] = KEY
            return J(r)
        return J({})
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

def open_page(path, w, h, keys=None):
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    B.call('Page.enable', {}, session=sid)
    B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    pre = 'try{localStorage.clear();sessionStorage.clear();%s}catch(e){}' % (('localStorage.setItem("vpKnownKeys",%s);' % json.dumps(json.dumps(keys))) if keys else '')
    B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'if(!window.__vpPre){window.__vpPre=1;if(!sessionStorage.getItem("__vpOnce")){%s;sessionStorage.setItem("__vpOnce","1");}}' % pre}, session=sid)
    B.call('Page.navigate', {'url': BASE + path}, session=sid)
    return tid, sid

def shot(sid, name):
    if not SHOTS: return
    try:
        time.sleep(0.3)
        r = B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        f = os.path.join(SHOTS, name + '.png')
        open(f, 'wb').write(base64.b64decode(r['data']))
        print('  shot ' + f)
    except Exception as e:
        print('  (no screenshot: %s)' % e)

READY = '!!document.getElementById("nameIn") && !document.getElementById("joinBtn").disabled && document.getElementById("joinBtn").textContent.indexOf("Loading")<0'
LOOK = r"""(function(){
  var v=document.getElementById("vJoin"), b=document.getElementById("joinBtn"), r=b.getBoundingClientRect();
  var ids=[].slice.call(document.querySelectorAll("#vJoin input")).filter(function(e){ return e.offsetParent!==null; }).map(function(e){ return e.id; });
  var labs=[].slice.call(document.querySelectorAll("#joinExtra label")).map(function(l){ var i=l.querySelector("input"); return [l.textContent.trim(), !!(i&&i.checked)]; });
  var se=document.scrollingElement||document.documentElement;
  return JSON.stringify({ ids:ids, labs:labs, text:(v?v.innerText:""), btnBottom:Math.round(r.bottom), btnTop:Math.round(r.top), vh:innerHeight,
    scroll:Math.round(se.scrollHeight), notme:!!document.getElementById("vpKnownNotMe"),
    head:((document.getElementById("joinHead")||{}).textContent||""), keys:localStorage.getItem("vpKnownKeys") });
})()"""
def look(sid): return json.loads(ask(sid, LOOK) or '{}')
def fits(L): return bool(L) and L.get('btnBottom', 9999) <= L.get('vh', 0) and L.get('scroll', 9999) <= L.get('vh', 0) + 1

def fill(sid, vals):
    ask(sid, '(function(){ var v=%s; for(var k in v){ var e=document.getElementById(k); if(e){ e.value=v[k]; e.dispatchEvent(new Event("input",{bubbles:true})); } } return true; })()' % json.dumps(vals))

def joins(code, secs=6):
    t = time.time() + secs
    while time.time() < t:
        with LOCK:
            got = [b for (p, c, b) in POSTS if c == code and p in ('/join', '/capture') and (b.get('first_name') or b.get('known_keys'))]
        if got: return got
        time.sleep(0.2)
    return []
def knowns(code):
    with LOCK: return [b for (p, c, b) in POSTS if c == code and p == '/join/known']

PAGES = [('bingo', '/play'), ('musical', '/app/musical/play.html'), ('trivia', '/app/trivia/play.html')]
ALPHA = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'
CODES = iter(a + b + c for a in ALPHA for b in ALPHA for c in ALPHA)
def code(prefix): return prefix + next(CODES)

def phone(game, path, w, h):
    sep = '&' if '?' in path else '?'
    team = game == 'trivia'
    size = '%dx%d' % (w, h)
    print('\n%s phone at %s' % (game, size))

    # N + J: a new phone
    c = code('NEW'); tid, sid = open_page(path + sep + 'room=' + c, w, h)
    try:
        ok('N %s %s: the join screen is up' % (game, size), until(sid, READY + ' && !!document.getElementById("xMobile")'), ask(sid, 'document.getElementById("vJoin").innerText.slice(0,300)'))
        time.sleep(0.6)
        L = look(sid); shot(sid, '%s-%s-1-new' % (game, size))
        want = ['nameIn', 'xFirst', 'xMobile'] if team else ['nameIn', 'xMobile']
        ok('N %s %s: a venue that collects nothing asks %s' % (game, size, ', '.join(want)), L.get('ids') == want, L.get('ids'))
        ok('N %s %s: no line saying the venue gets the details (only a ticked box shares them, Dean 16 Nov)' % (game, size), 'Your details go to' not in L.get('text', '') and 'go to the venue' not in L.get('text', ''), L.get('text'))
        ok('N %s %s: the heading is "Join the game" (Dean 16 Nov: never "Your name")' % (game, size), team or L.get('head') == 'Join the game', L.get('head'))
        ok('N %s %s: the notice link is quiet: the line\'s own colour, no underline' % (game, size), ask(sid, '(function(){ var a=document.querySelector("#vpJoinNotice a"), p=a&&a.parentNode; if(!a) return false; var A=getComputedStyle(a), B=getComputedStyle(p); return A.color===B.color && A.fontWeight===B.fontWeight && A.textDecorationLine==="none"; })()'), '')
        ok('N %s %s: one screen, no scroll, Join on screen' % (game, size), fits(L), dict((k, L.get(k)) for k in ('btnBottom', 'scroll', 'vh')))
        ok('N %s %s: the first-game notice, once, its link on "venueplay\'s terms and privacy policy"' % (game, size), NOTICE['text'] in L.get('text', '') and ask(sid, '!!document.querySelector("#vpJoinNotice a[href=\\"/privacy\\"]")'), L.get('text'))
        fill(sid, {'nameIn': 'Quiz Kids' if team else 'Alan', 'xFirst': 'Alan', 'xMobile': '0412 345 678'})
        ask(sid, 'document.getElementById("joinBtn").click(); true')
        got = joins(c)
        ok('J %s %s: the join sends the first name and mobile' % (game, size), bool(got) and got[0].get('first_name') == 'Alan' and got[0].get('mobile') == '0412 345 678', got)
        ok('J %s %s: and says which notice it showed' % (game, size), bool(got) and got[0].get('notice_version') == 'vpn-3-16nov', got)
        ok('J %s %s: the key the Worker hands back is kept on the phone' % (game, size), until(sid, 'localStorage.getItem("vpKnownKeys")===%s' % json.dumps(json.dumps([KEY])), 6), ask(sid, 'localStorage.getItem("vpKnownKeys")'))
    finally:
        B.close_tab(tid)

    # K: the same phone, the next game
    c = code('KNW'); tid, sid = open_page(path + sep + 'room=' + c, w, h, keys=[KEY])
    try:
        ok('K %s %s: the join screen is up with the first name' % (game, size), until(sid, READY + ' && !!document.getElementById("vpKnownNotMe")'), ask(sid, 'document.getElementById("vJoin").innerText.slice(0,300)'))
        time.sleep(0.6)
        L = look(sid); shot(sid, '%s-%s-2-known' % (game, size))
        kb = knowns(c)
        ok('K %s %s: /join/known was asked with the key' % (game, size), bool(kb) and KEY in (kb[-1].get('keys') or []), kb)
        ok('K %s %s: no name, no hello, only a small "Not my details" link' % (game, size), 'Not my details' in L.get('text', '') and L.get('notme') and 'alan' not in L.get('text', '').lower() and 'welcome' not in L.get('text', '').lower(), [L.get('head'), L.get('text')])
        ok('K %s %s: the notice does not show again' % (game, size), 'A ticked box shares' not in L.get('text', ''), L.get('text'))
        ok('K %s %s: no box for anything held (%s)' % (game, size, 'the team name only' if team else 'none at all'), L.get('ids') == (['nameIn'] if team else []), L.get('ids'))
        ok('K %s %s: no detail we hold anywhere on the screen (no number, no @)' % (game, size), '0412' not in L.get('text', '') and '@' not in L.get('text', ''), L.get('text'))
        ok('K %s %s: one screen, no scroll' % (game, size), fits(L), L)
        if team: fill(sid, {'nameIn': 'Quiz Kids'})
        ask(sid, 'document.getElementById("joinBtn").click(); true')
        got = joins(c)
        ok('K %s %s: the join sends the key and no detail' % (game, size), bool(got) and got[0].get('known_keys') == [KEY] and not got[0].get('mobile') and not (team and got[0].get('first_name')), got)
    finally:
        B.close_tab(tid)

    # A: a field the venue added since
    c = code('ADD'); tid, sid = open_page(path + sep + 'room=' + c, w, h, keys=[KEY])
    try:
        until(sid, READY + ' && !!document.getElementById("vpKnownNotMe")'); time.sleep(0.6)
        L = look(sid); shot(sid, '%s-%s-3-known-new-field' % (game, size))
        ok('A %s %s: only the email box (the venue added it since)' % (game, size), L.get('ids') == (['nameIn', 'xEmail'] if team else ['xEmail']), L.get('ids'))
        ok('A %s %s: one screen, no scroll' % (game, size), fits(L), L)
        # M: Not me
        ask(sid, 'document.getElementById("vpKnownNotMe").click(); true'); time.sleep(0.5)
        L = look(sid); shot(sid, '%s-%s-4-not-me' % (game, size))
        ok('M %s %s: Not my details takes the key off the phone and the full form is back' % (game, size), L.get('keys') == '[]' and 'xMobile' in L.get('ids', []) and 'nameIn' in L.get('ids', []) and not L.get('notme'), L)
    finally:
        B.close_tab(tid)

    # T: everything asked, plus the three boxes (a visiting host); a 667 px phone is not asked to fit all of that
    if h < 700: return
    c = code('THR'); tid, sid = open_page(path + sep + 'room=' + c, w, h)
    try:
        until(sid, READY + ' && !!document.getElementById("xConsent3")'); time.sleep(0.6)
        L = look(sid); shot(sid, '%s-%s-5-three-boxes' % (game, size))
        ok('T %s %s: three boxes, pre-ticked: venueplay, the venue, the host' % (game, size), L.get('labs') == [['venueplay', True], ['The Royal Hotel', True], ['Quiz Masters Co', True]], L.get('labs'))
        ok('T %s %s: the heading and the line under, word for word' % (game, size), 'Yes! Send me news and offers by SMS and email from:' in L.get('text', '') and 'Each one uses your details under its own privacy policy. Unsubscribe any time.' in L.get('text', ''), L.get('text'))
        ok('T %s %s: a venue asking everything plus the three boxes is still one screen, no scroll' % (game, size), fits(L), dict((k, L.get(k)) for k in ('btnBottom', 'scroll', 'vh')))
        fill(sid, {'nameIn': 'Quiz Kids' if team else 'Bo', 'xFirst': 'Bo', 'xMobile': '0412 000 111'})
        ask(sid, 'document.getElementById("xC_host").click(); document.getElementById("joinBtn").click(); true')
        got = joins(c)
        ok('T %s %s: each answer its own, the unticked host box goes as false' % (game, size), bool(got) and got[0].get('consent') == {'venueplay': True, 'venue': True, 'host': False}, got)
    finally:
        B.close_tab(tid)


def returning(game, path, w, h):
    """Dean 16 Nov 2026: what a RETURNING player sees, not creepy. Frames to reports/privacy-update-16nov/returning/."""
    sep = '&' if '?' in path else '?'
    team = game == 'trivia'
    size = '%dx%d' % (w, h)
    print('\n%s returning player at %s' % (game, size))
    for pre, tag, want_box, ticks in (('RSM', '1-new-venue-same-fields', [], [['venueplay', True], ['The Royal Hotel', True]]),
                                      ('RMR', '2-new-venue-one-more-field', ['xPost'], [['venueplay', True], ['The Royal Hotel', True]]),
                                      ('RNT', '3-same-venue-second-night', [], [['venueplay', True], ['The Royal Hotel', False]])):
        c = code(pre); tid, sid = open_page(path + sep + 'room=' + c, w, h, keys=[KEY])
        try:
            ok('R %s %s %s: up with the first name' % (game, size, tag), until(sid, READY + ' && !!document.getElementById("vpKnownNotMe") && !!document.getElementById("xConsent3")'), ask(sid, 'document.getElementById("vJoin").innerText.slice(0,300)'))
            time.sleep(0.6)
            L = look(sid)
            if PRIV:
                try:
                    r = B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
                    f = os.path.join(PRIV, '%s-%s-%s.png' % (game, size, tag)); open(f, 'wb').write(base64.b64decode(r['data'])); print('  shot ' + f)
                except Exception as e: print('  (no screenshot: %s)' % e)
            t = L.get('text', '')
            ok('R %s %s %s: no name, never a number, an address or a venue played at; only "Not my details"' % (game, size, tag), 'Not my details' in t and 'grace' not in t.lower() and '04' not in t and '@' not in t and 'welcome' not in t.lower() and 'last played' not in t.lower(), t)
            ok('R %s %s %s: boxes asked: %s' % (game, size, tag, want_box or 'none'), [i for i in L.get('ids', []) if i.startswith('x') and not i.startswith('xC_')] == want_box, L.get('ids'))
            ok('R %s %s %s: each sender\'s current answer, a new sender pre-ticked' % (game, size, tag), L.get('labs') == ticks, L.get('labs'))
            ok('R %s %s %s: no first-game notice again' % (game, size, tag), 'A ticked box shares' not in t, t)
            ok('R %s %s %s: one screen, no scroll' % (game, size, tag), fits(L), dict((k, L.get(k)) for k in ('btnBottom', 'scroll', 'vh')))
            if pre == 'RNT':
                ask(sid, 'document.getElementById("vpKnownNotMe").click(); true'); time.sleep(0.5)
                L = look(sid)
                if PRIV:
                    try:
                        r = B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
                        f = os.path.join(PRIV, '%s-%s-4-not-my-details.png' % (game, size)); open(f, 'wb').write(base64.b64decode(r['data'])); print('  shot ' + f)
                    except Exception as e: print('  (no screenshot: %s)' % e)
                ok('R %s %s: Not my details clears it: the normal empty form, every box fresh and ticked' % (game, size), L.get('keys') == '[]' and 'xMobile' in L.get('ids', []) and 'Not my details' not in L.get('text', '') and all(x[1] for x in L.get('labs', [])) and ask(sid, '(document.getElementById("nameIn")||{}).value===""'), L)
        finally:
            B.close_tab(tid)


if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('known-phone-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BASE = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        for w, h in ((375, 667), (375, 812), (390, 844)):
            for g, p in PAGES:
                phone(g, p, w, h)
        for w, h in ((375, 667), (390, 844)):
            for g, p in PAGES:
                returning(g, p, w, h)
    finally:
        try: B.close()
        except Exception: pass
        srv.shutdown()
    print('\n%d checks, %d failed' % (ran, bad))
    print('ALL %d CHECKS PASSED' % ran if not bad else 'FAILED %d of %d' % (bad, ran))
    sys.exit(1 if bad else 0)
