#!/usr/bin/env python3
"""YOUR DETAILS BOXES AUTOFILL ON IPHONE AND ANDROID (5 Nov 2026, for the 6 Nov release).

Dean: "On the player screen we've asked for details... it doesn't autofill every detail." The three
player phones built the boxes with innerHTML: autocomplete words but no name=, and not inside a
<form>, so iPhone Safari AutoFill and Android's Google autofill often skipped them. Now
venueplay/app/vp-details.js (ONE helper, all three phones) puts the name box, the details boxes and
Join inside a real <form autocomplete="on"> and gives every box its name= and autocomplete word.

This opens the REAL bingo, musical bingo and trivia phones in headless Chrome, served from this
checkout, with the Worker answered here, and checks, per phone:

  A  the name box, every details box and the Join button are INSIDE one form (autocomplete on, Join is
     its submit button); the 18+ and "Keep me posted" ticks are inside it too
  B  every box has the right name=, autocomplete, type, inputmode and pattern, and an accessible label
     (bingo and musical: given-name; trivia's TEAM name: name "team", autocomplete off, and NO
     given-name box anywhere); email is type=email, mobile type=tel, postcode numeric
  C  only the boxes the venue asks for appear (an email-only venue: just email; name-only: none), and
     nothing new is collected: the details that reach the Worker are the same fields as before
  D  a real Enter key in the name box joins, once, and nothing navigates; so does a tap on Join
  E  a real Enter key in the email box joins too (the keyboard's Go button)
  F  every text box is 15px or more on the phone, and the form adds nothing to the layout (display:contents)
  G  AN ACTUAL FILL, where this Chrome can do one: a saved address is handed to Chrome's autofill
     (DevTools Autofill domain) and the boxes fill. Where Chrome cannot, it says so and the attribute
     checks above are the floor.

    python3 tools/details-autofill-in-chrome.test.py
    VP_DETAILS_SITE=<a venueplay folder>               serves that folder instead (the "before" picture)
Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib  # noqa: E402
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SHOTS = os.environ.get('VP_SHOTS', '')
SITE = os.path.abspath(os.environ.get('VP_DETAILS_SITE') or os.path.join(ROOT, 'venueplay'))

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

# The room code says what the venue collects. Every scenario has its own code, so a name one phone
# saved can never sign the next one in.
FULL = {'first_name': True, 'last_name': True, 'postcode': True, 'email': True, 'mobile': True, 'marketing_optin': True}
def collect_for(code):
    if code.startswith('EMA'): return {'first_name': True, 'email': True}   # a venue that asks for an email only
    if code.startswith('NAM'): return {'first_name': True}                   # a venue that asks for just a name
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
READY_NAME = '!!document.getElementById("nameIn") && !document.getElementById("joinBtn").disabled'

DUMP = r"""(function(){
  var f=document.getElementById("joinForm"); function R(e){ var b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]; }
  var all=[].slice.call(document.querySelectorAll("#vJoin input, #vJoin button"));
  return JSON.stringify({
    form: f?{ac:f.getAttribute("autocomplete"), display:getComputedStyle(f).display, tag:f.tagName, inView:!!f.closest("#vJoin"),
             ids:[].slice.call(f.querySelectorAll("input,button")).map(function(e){return e.id;})}:null,
    inputs: all.map(function(e){ return {id:e.id, type:e.type, name:e.getAttribute("name"), ac:e.getAttribute("autocomplete"),
      im:e.getAttribute("inputmode"), pat:e.getAttribute("pattern"), label:e.getAttribute("aria-label"), ph:e.getAttribute("placeholder"),
      form:e.form?e.form.id:null, fs:parseFloat(getComputedStyle(e).fontSize), r:R(e)}; }),
    labelFor: [].slice.call(document.querySelectorAll("#vJoin label[for]")).map(function(l){return l.htmlFor;})
  });
})()"""

def dump(sid): return json.loads(ask(sid, DUMP) or '{}')

def by_id(d): return dict((x['id'], x) for x in d.get('inputs', []))

def key(sid, k, code, vk):
    """A real key press, through the browser, the way a phone's Go button presses it."""
    for t in ('keyDown', 'keyUp'):
        p = {'type': t, 'key': k, 'code': k, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk}
        if t == 'keyDown': p['text'] = '\r'
        B.call('Input.dispatchKeyEvent', p, session=sid)

def sent(code, secs=6, n=1):
    """Every body the phone posted to /join or /capture for this code that carries the player."""
    t = time.time() + secs
    while time.time() < t:
        with LOCK:
            got = [b for (p, c, b) in POSTS if c == code and (p == '/capture' or p == '/join') and (b.get('first_name') or b.get('name'))]
        if len(got) >= n: return got
        time.sleep(0.2)
    return got

PAGES = [('bingo', '/play'), ('musical', '/app/musical/play.html'), ('trivia', '/app/trivia/play.html')]
ALPHA = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'
CODES = iter(a + b + c for a in ALPHA for b in ALPHA for c in ALPHA)
def code(prefix): return prefix + next(CODES)

# What the Worker was sent before this change: nothing may be added to this list.
KNOWN_KEYS = set(['code', 'name', 'first_name', 'last_name', 'postcode', 'email', 'mobile', 'marketing_optin', 'pid', 'did', 'room',
                  'venue', 'game', 'token', 'tickets', 'player_id', 'device_id', 'source', 'game_id', 'venue_id', 'player', 'ts', 'kind'])

def fill(sid, ids_vals):
    ask(sid, '(function(){ var v=%s; for(var k in v){ var e=document.getElementById(k); if(e){ e.value=v[k]; e.dispatchEvent(new Event("input",{bubbles:true})); } } return true; })()' % json.dumps(ids_vals))

def page(game, path):
    sep = '&' if '?' in path else '?'
    team = game == 'trivia'
    print('\n%s phone (%s)' % (game, path))

    # A, B, F: a venue that asks for everything.
    c = code('FDC'); tid, sid = open_page(path + sep + 'room=' + c, 375, 812)
    try:
        ok('%s: the details step is drawn' % game, until(sid, READY), ask(sid, 'document.getElementById("joinExtra").innerHTML.slice(0,200)'))
        time.sleep(0.4)
        d = dump(sid); I = by_id(d); f = d.get('form')
        want_ids = ['nameIn', 'xLast', 'xPost', 'xEmail', 'xMobile', 'xOptin', 'joinBtn']
        ok('A %s: the name box, the details boxes, the ticks and Join are inside ONE form' % game,
           bool(f) and f['tag'] == 'FORM' and f['inView'] and f['ids'] == want_ids, f)
        ok('A %s: the form is autocomplete="on" and every box belongs to it' % game,
           bool(f) and f['ac'] == 'on' and all(x['form'] == 'joinForm' for x in d['inputs'] if x['id'] in want_ids), [(x['id'], x['form']) for x in d['inputs']])
        ok('A %s: Join is the form\'s submit button' % game, I.get('joinBtn', {}).get('type') == 'submit', I.get('joinBtn'))
        # B: names, autocomplete words, types, input modes.
        spec = [('xLast', 'text', 'family-name', 'family-name', None, None, 'Last name'),
                ('xPost', 'text', 'postal-code', 'postal-code', 'numeric', '[0-9]*', 'Postcode'),
                ('xEmail', 'email', 'email', 'email', None, None, 'Email'),
                ('xMobile', 'tel', 'tel', 'tel', 'tel', None, 'Mobile')]
        for i, ty, nm, ac, im, pat, lab in spec:
            x = I.get(i, {})
            ok('B %s: %s is type=%s name=%s autocomplete=%s inputmode=%s%s' % (game, i, ty, nm, ac, im, ' pattern=' + pat if pat else ''),
               x.get('type') == ty and x.get('name') == nm and x.get('ac') == ac and x.get('im') == im and x.get('pat') == pat, x)
            ok('B %s: %s has an accessible label "%s" and its placeholder is unchanged' % (game, i, lab), x.get('label') == lab and x.get('ph') == lab, x)
        n = I.get('nameIn', {})
        if team:
            ok('B trivia: the TEAM name box is name="team" and autocomplete="off" (not a person\'s name)', n.get('name') == 'team' and n.get('ac') == 'off', n)
            ok('B trivia: its label is "Team name" and its placeholder is still "Team name"', n.get('label') == 'Team name' and n.get('ph') == 'Team name', n)
            ok('B trivia: no first-name box was added (nothing new is asked)', not [x for x in d['inputs'] if x.get('ac') == 'given-name' or x.get('name') == 'given-name'], d['inputs'])
        else:
            ok('B %s: the name box is name="given-name" autocomplete="given-name"' % game, n.get('name') == 'given-name' and n.get('ac') == 'given-name', n)
            ok('B %s: its label is "First name" and its placeholder is still "Your name"' % game, n.get('label') == 'First name' and n.get('ph') == 'Your name', n)
        # F: size and layout.
        boxes = [x for x in d['inputs'] if x['type'] in ('text', 'email', 'tel')]
        ok('F %s: every text box is 15px or more on the phone' % game, boxes and all(x['fs'] >= 15 for x in boxes), [(x['id'], x['fs']) for x in boxes])
        ok('F %s: the form is display:contents (it adds nothing to the layout)' % game, f and f['display'] == 'contents', f)
        # a signature of the layout, for a before and after comparison (VP_DETAILS_SITE)
        if os.environ.get('VP_LAYOUT'): print('  layout %s %s' % (game, json.dumps([(x['id'], x['r']) for x in d['inputs']])))
    finally:
        B.close_tab(tid)

    # C: a venue that asks only for an email, and one that asks for nothing but a name.
    for pre, want_extra in (('EMA', ['xEmail']), ('NAM', [])):
        c = code(pre); tid, sid = open_page(path + sep + 'room=' + c, 375, 812)
        try:
            until(sid, READY_NAME); time.sleep(0.8)
            d = dump(sid)
            extra = [x['id'] for x in d['inputs'] if x['id'].startswith('x') and x['id'] not in ('x18', 'xOptin')]
            ok('C %s: a venue asking %s shows %s and nothing else' % (game, 'for an email only' if want_extra else 'for just a name', want_extra or 'no extra box'), extra == want_extra, extra)
        finally:
            B.close_tab(tid)

    # D: a real Enter in the name box joins, once, with no navigation. E: and in the email box.
    for tag, focus, say in (('D', 'nameIn', 'the name box'), ('E', 'xEmail', 'the email box')):
        c = code('FDC'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
        try:
            until(sid, READY)
            ask(sid, 'window.__stay=1; true')
            fill(sid, {'nameIn': 'Sam Team' if team else 'Sam', 'xLast': 'Smith', 'xPost': '4217', 'xEmail': 'sam@example.com', 'xMobile': '0412345678'})
            url0 = ask(sid, 'location.href')
            ask(sid, 'document.getElementById(%s).focus(); true' % json.dumps(focus))
            key(sid, 'Enter', 'Enter', 13)
            got = sent(c)
            ok('%s %s: a real Enter in %s joins' % (tag, game, say), bool(got), got)
            time.sleep(1.2)
            got = sent(c, 0.1, 1)
            ok('%s %s: and joins ONCE (not twice)' % (tag, game), len(got) == 1, len(got))
            ok('%s %s: nothing navigated (same page, same address, no reload)' % (tag, game),
               ask(sid, 'window.__stay') == 1 and ask(sid, 'location.href') == url0, (ask(sid, 'window.__stay'), ask(sid, 'location.href'), url0))
            if got:
                b = got[0]
                ok('C %s: what reaches the Worker is only fields it already took' % game, set(b) <= KNOWN_KEYS, sorted(set(b) - KNOWN_KEYS))
                if tag == 'D':
                    ok('C %s: and the details typed are the ones sent (last name, postcode, email, mobile)' % game,
                       (b.get('last_name'), b.get('postcode'), b.get('email'), b.get('mobile')) == ('Smith', '4217', 'sam@example.com', '0412345678'), b)
        finally:
            B.close_tab(tid)

    # D again: a tap on Join joins once and nothing navigates.
    c = code('FDC'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
    try:
        until(sid, READY)
        ask(sid, 'window.__stay=1; true')
        fill(sid, {'nameIn': 'Pat'})
        ask(sid, 'document.getElementById("joinBtn").click(); true')
        got = sent(c); time.sleep(1.0); got = sent(c, 0.1, 1)
        ok('D %s: a tap on Join joins once' % game, len(got) == 1, len(got))
        ok('D %s: and nothing navigated' % game, ask(sid, 'window.__stay') == 1, ask(sid, 'location.href'))
        # an empty name is still refused, in the page's own words, and nothing is sent
    finally:
        B.close_tab(tid)
    c = code('FDC'); tid, sid = open_page(path + sep + 'room=' + c, 390, 844)
    try:
        until(sid, READY)
        ask(sid, 'document.getElementById("nameIn").focus(); true'); key(sid, 'Enter', 'Enter', 13); time.sleep(0.8)
        err = ask(sid, 'document.getElementById("joinErr").textContent')
        ok('D %s: Enter with no name is refused in the page\'s own words and sends nothing' % game, 'first' in (err or '') and sent(c, 1.0) == [], err)
    finally:
        B.close_tab(tid)


def actual_fill():
    """G: hand Chrome a saved address and ask it to fill the bingo phone's boxes. Where this Chrome
    has no autofill in headless, say so: the attribute checks above are then the floor."""
    print('\nan actual autofill (DevTools Autofill domain)')
    c = code('FDC'); tid, sid = open_page('/app/musical/play.html?room=' + c, 390, 844)
    try:
        until(sid, READY)
        try:
            B.call('Autofill.enable', {}, session=sid)
            B.call('Autofill.setAddresses', {'addresses': [{'fields': [
                {'name': 'NAME_FIRST', 'value': 'Alex'}, {'name': 'NAME_LAST', 'value': 'Rivers'},
                {'name': 'ADDRESS_HOME_ZIP', 'value': '4217'}, {'name': 'EMAIL_ADDRESS', 'value': 'alex@example.com'},
                {'name': 'PHONE_HOME_WHOLE_NUMBER', 'value': '0412345678'},
                {'name': 'ADDRESS_HOME_COUNTRY', 'value': 'AU'}]}]}, session=sid)
            B.call('DOM.enable', {}, session=sid)
            doc = B.call('DOM.getDocument', {'depth': 0}, session=sid)
            node = B.call('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#nameIn'}, session=sid)
            desc = B.call('DOM.describeNode', {'nodeId': node['nodeId']}, session=sid)['node']
            fr = B.call('Page.getFrameTree', {}, session=sid)['frameTree']['frame']['id']
            B.call('Autofill.trigger', {'fieldId': desc['backendNodeId'], 'frameId': fr, 'address': {'fields': [
                {'name': 'NAME_FIRST', 'value': 'Alex'}, {'name': 'NAME_LAST', 'value': 'Rivers'},
                {'name': 'ADDRESS_HOME_ZIP', 'value': '4217'}, {'name': 'EMAIL_ADDRESS', 'value': 'alex@example.com'},
                {'name': 'PHONE_HOME_WHOLE_NUMBER', 'value': '0412345678'}, {'name': 'ADDRESS_HOME_COUNTRY', 'value': 'AU'}]}}, session=sid)
        except Exception as e:
            print('  (this Chrome cannot run autofill headless: %s)' % str(e)[:200])
            return
        time.sleep(1.0)
        v = json.loads(ask(sid, 'JSON.stringify(["nameIn","xLast","xPost","xEmail","xMobile"].map(function(i){return document.getElementById(i).value;}))') or '[]')
        print('  autofill result: %s' % v)
        ok('G: Chrome\'s autofill filled the boxes from a saved address', v[0] == 'Alex' and v[1] == 'Rivers' and v[3] == 'alex@example.com', v)
    finally:
        B.close_tab(tid)


if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('details-autofill-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BASE = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        for g, p in PAGES:
            page(g, p)
        actual_fill()
    finally:
        B.close()
        srv.shutdown()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    sys.exit(1 if bad else 0)
