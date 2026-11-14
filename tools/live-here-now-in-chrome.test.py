#!/usr/bin/env python3
"""THE DRINK-COASTER PAGE, v2, PLAYED IN A REAL BROWSER AT PHONE WIDTH (/live-here-now; v1 31 Oct to
1 Nov 2026, v2 Dean 4 Nov 2026: reports/live-here-now-v2/DEAN-NOTES.md, later items override earlier).

What Dean asked for, each a thing the page DOES, so this opens the real venueplay/live-here-now.html,
served from this checkout the way Cloudflare Pages serves it (tools/pagesim.py: clean addresses, the
real _redirects), in headless Chrome as a phone, and plays it by tapping and typing:

  - /here (the short address on the coaster) and /live answer 301 to /live-here-now
  - FIRST NAME first ("Nice one, Sam"), one box, nothing else asked; an empty name is refused
  - "What venue are you at?": three letters finds the pub (name, then suburb and postcode or state)
    from OUR WHOLE VENUE LIST (INBOX 229/232), each pick saying plainly whether it is on venueplay
    ("On venueplay", "Game on now") or "Not on venueplay yet"; two letters asks for more; nothing
    typed ever makes a board: "Can't find your venue? Add it" sends name, suburb, state and website
    to HQ's review list and the round plays with no board; "Play now" shows only while the search is down;
    the next scan offers the same venue first
  - the venue's own sign-up at the end (INBOX 232): only where the Worker says it is switched on, the
    phones' one tick unticked ("Send me offers from The Mini Bar. I'm 18 or over."), its consent
    version sent with it; never at a venue that is not on venueplay
  - the new look: the answers in the TV's full colours, the right one turns GREEN and says so, a
    wrong pick is outlined in its own colour and tagged; "Correct! +145" once the Worker answers;
    a second tap changes nothing
  - the end: "Nice one, Sam", "3 of 5", "435 points, N seconds", "1st tonight at The Mini Bar", the
    board (Tonight and This week) with your row marked, "Challenge your mates"
  - a mate on the challenge link (?c=CODE) gets the same five questions, skips the venue, lands on
    the same board
  - the board down (503 off): the page plays the v1 way, "Correct!" with no points, "3 of 5",
    "Done in N seconds", no board, no challenge
  - "From a venue? Click here" goes to /coaster (today's offer), and "Game on the TV? Join it"
    follows ?v=<slug> as before
  - the hour's five: the same on two phones in an hour, different the next; Play again and a rescan
    never repeat; storage blocked (private mode) still plays
  - at 320, 375, 390, 430 and 1440 wide: no sideways scroll, nothing off the screen or cut off in its
    box, buttons a thumb can hit, and no visible text under 15px, on every screen

THE GAME WORKER IS A STAND-IN HERE: a small local server answering the six /coaster routes in their
real shapes, pointed at through window.VP_GAME_API. The Worker's own behaviour (the search, scoring
by triviaAnswerPoints, first names only, the boards) is run against the shipped Worker by
venueplay-backend/worker/coaster-round.test.js; the page's own logic by coaster-page.test.js.
Nothing leaves this machine: fonts, analytics and every venueplay.com.au address are blocked.
Chrome runs under /tmp/vp-heavy.lock (VP_WAIT_LOCK=<seconds> to wait for it).

    python3 tools/live-here-now-in-chrome.test.py [--shots DIR]      (or VP_SHOTS=DIR)
"""
import argparse, base64, http.client, http.server, importlib.util, io, json, os, re, socketserver, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--shots', default=os.environ.get('LIVE_HERE_NOW_SCREENS', '') or os.environ.get('VP_SHOTS', ''))
A = ap.parse_args()


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


vl = _load('verify_live', 'tools/verify-live.py')
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import gatelib, pagesim
import waits   # as_json: the page's answer whatever its shape, and its reason when it threw (4 Nov 2026)
bankbuild = _load('live_here_now_bank', 'tools/live-here-now-bank.py')

fails = 0
ran = 0


def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    if ok:
        print('  ok   ' + name)
    else:
        fails += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: ' + json.dumps(saw, default=str)[:500]))


PAGE = os.path.join(ROOT, 'venueplay', 'live-here-now.html')
DATA = os.path.join(ROOT, 'venueplay', 'data', 'live-here-now.json')
HTML = io.open(PAGE, encoding='utf-8').read()
BANK = json.load(io.open(DATA, encoding='utf-8'))
BY_ID = dict((q[0], q) for q in BANK['q'])
GREEN = 'rgb(47, 208, 138)'
COLOURS = ['rgb(255, 90, 78)', 'rgb(77, 141, 255)', 'rgb(255, 165, 61)', 'rgb(165, 123, 255)']
HOUR = 491234          # a fixed hour (Sep 2026), never this machine's clock
T0 = HOUR * 3600000 + 20 * 60000
MINI = 'v:11111111-1111-4111-8111-111111111111'
TUGUN = 'c:44444444-4444-4444-8444-444444444444'
BODALLA = 'l:107'


# ---------------------------------------------------------------------------------------------
# THE STAND-IN GAME WORKER: the five /coaster routes in their real shapes.
# ---------------------------------------------------------------------------------------------
FAKE = {'off': False, 'rounds': {}, 'codes': {}, 'log': [], 'n': 0}
PLACES = [
    {'place': MINI, 'name': 'The Mini Bar', 'suburb': '', 'postcode': '2485', 'state': 'NSW', 'on': True},
    {'place': TUGUN, 'name': 'Tugun Tavern', 'suburb': 'Tugun', 'postcode': '4224', 'state': 'QLD', 'on': False},
    {'place': 'v:77777777-7777-4777-8777-777777777771', 'name': 'Royal Hotel', 'suburb': '', 'postcode': '2000', 'state': 'NSW', 'on': True, 'live': True},
    {'place': 'l:101', 'name': 'Royal Hotel', 'suburb': 'Bowral', 'postcode': '', 'state': 'NSW', 'on': False},
    {'place': 'l:103', 'name': 'Royal Oak Tavern', 'suburb': 'Ballarat', 'postcode': '', 'state': 'VIC', 'on': False},
    {'place': BODALLA, 'name': 'Bodalla Pub', 'suburb': 'Bodalla', 'postcode': '', 'state': 'NSW', 'on': False},
]
OPTIN = {MINI: {'email': True, 'mobile': False, 'marketing_optin': True}}   # the venue HQ switched the sign-up on for
DUCK = 'c:99999999-9999-4999-8999-999999999999'
NAMES = dict((p['place'], p['name']) for p in PLACES)
NAMES[DUCK] = 'Duck and Drake'


def fake_board(place, period, play):
    rows = [r for r in FAKE['rounds'].values() if r['place'] == place and r['done']]
    rows.sort(key=lambda r: (-r['points'], r['ms']))
    rank = None
    for i, r in enumerate(rows):
        if r['id'] == play:
            rank = i + 1
    return {'period': 'week' if period == 'week' else 'tonight', 'rank': rank, 'players': len(rows), 'more': False,
            'rows': [{'place': i + 1, 'name': r['name'], 'points': r['points'], 'correct': r['correct'], 'you': r['id'] == play}
                     for i, r in enumerate(rows[:10])]}


class FakeWorker(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send(204, {})

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        FAKE['log'].append(('GET', u.path, q))
        if FAKE['off']:
            return self.send(503, {'off': True})
        if u.path == '/coaster/venues':
            t = re.sub(r'[^a-z0-9]', '', re.sub(r'^\s*the\s+', '', q.get('q', '').lower()))
            if len(t) < 3:
                return self.send(200, {'matches': [], 'why': 'Type at least three letters of the name.'})
            m = [dict(p, exact=False) for p in PLACES if t in re.sub(r'[^a-z0-9]', '', p['name'].lower())]
            return self.send(200, {'matches': m})
        if u.path == '/coaster/ask':
            return self.send(200, {'optin': OPTIN.get(q.get('place'))})
        if u.path == '/coaster/board':
            b = fake_board(q.get('place'), q.get('period'), q.get('play'))
            b['venue'] = {'name': NAMES.get(q.get('place'), ''), 'suburb': '', 'logo_url': ''}
            return self.send(200, b)
        self.send(404, {'error': 'not found'})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        b = json.loads(self.rfile.read(n) or b'{}')
        FAKE['log'].append(('POST', self.path, b))
        if FAKE['off']:
            return self.send(503, {'off': True})
        if self.path == '/coaster/lead':
            if not b.get('suburb') or b.get('state') not in ('QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'):
                return self.send(400, {'error': 'Type the suburb or town.', 'field': 'suburb'})
            if b.get('name') == 'Duck and Drake':      # a venue the Worker could not confirm: a trivia-only board of its own (migration 194)
                return self.send(200, {'ok': True, 'added': True, 'place': DUCK, 'name': 'Duck and Drake'})
            return self.send(200, {'ok': True, 'added': True})
        if self.path == '/coaster/optin':
            r = FAKE['rounds'].get(b.get('play'))
            if not r or b.get('token') != r['token']:
                return self.send(403, {'error': 'That round is not yours.'})
            return self.send(200, {'ok': True, 'stored': r['place'] in OPTIN})
        if self.path == '/coaster/start':
            first = (b.get('name') or '').split(' ')[0][:14]
            if not first:
                return self.send(400, {'error': 'Type your first name.'})
            if b.get('code'):
                g = FAKE['codes'].get(b['code'])
                if not g:
                    return self.send(404, {'error': 'That challenge has finished.', 'gone': True})
                place, qids = g['place'], g['qids']
            else:
                place, qids = b.get('place'), b.get('qids')
            FAKE['n'] += 1
            rid = '00000000-0000-4000-8000-%012d' % FAKE['n']
            code = 'CODE%02d' % FAKE['n']
            r = {'id': rid, 'token': 'tok%d' % FAKE['n'], 'place': place, 'qids': qids, 'name': first.capitalize(), 'answers': [],
                 'points': 0, 'correct': 0, 'ms': 0, 'done': False}
            FAKE['rounds'][rid] = r
            FAKE['codes'][code] = {'place': place, 'qids': qids}
            out = {'ok': True, 'play': rid, 'token': r['token'], 'code': code, 'place': place, 'name': r['name'],
                   'venue': {'name': NAMES.get(place, ''), 'suburb': '', 'logo_url': '', 'on': place.startswith('v:')}, 'qids': qids, 'base': 100}
            if place in OPTIN:
                out['optin'] = OPTIN[place]
            return self.send(200, out)
        if self.path == '/coaster/answer':
            r = FAKE['rounds'].get(b.get('play'))
            if not r or b.get('token') != r['token']:
                return self.send(403, {'error': 'That round is not yours.'})
            if len(r['answers']) != b.get('i'):
                return self.send(409, {'error': 'That question is already answered.'})
            right = BY_ID[r['qids'][b['i']]][3]
            good = b.get('a') == right
            pts = 145 if good else 0
            r['answers'].append(b['a'])
            r['points'] += pts
            r['correct'] += 1 if good else 0
            r['ms'] += 2000
            out = {'ok': True, 'i': b['i'], 'right': right, 'correct': good, 'points': pts, 'total': r['points'], 'done': b['i'] == 4}
            if b['i'] == 4:
                r['done'] = True
                out['score'] = {'correct': r['correct'], 'points': r['points'], 'secs': r['ms'] // 1000}
                out['board'] = fake_board(r['place'], 'night', r['id'])
            return self.send(200, out)
        self.send(404, {'error': 'not found'})


def fake_worker():
    class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
    s = S(('127.0.0.1', 0), FakeWorker)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, 'http://127.0.0.1:%d' % s.server_address[1]


# ---------------------------------------------------------------------------------------------
# THE BROWSER
# ---------------------------------------------------------------------------------------------
def no_follow(base, path):
    host = base.split('//', 1)[1]
    c = http.client.HTTPConnection(host, timeout=10)
    c.request('GET', path)
    r = c.getresponse()
    r.read()
    c.close()
    return r.status, r.getheader('Location')


KIT = os.environ.get('VP_LOGO_KIT', os.path.expanduser('~/venue-enrich/logo-kit-1nov'))


def fonts_script():
    """The brand's own fonts from the logo kit (Anton, Manrope, Hanken Grotesk, JetBrains Mono) as data: URLs, so every width
       and every shot is measured in the real faces, never a server's fallback (Google Fonts stays blocked: nothing leaves)."""
    d = os.path.join(KIT, 'guidelines-v3', 'fonts')
    faces = (('Anton', 'Anton-Regular.ttf', '400', 'font/ttf'), ('Manrope', 'Manrope.woff2', '200 800', 'font/woff2'),
             ('Hanken Grotesk', 'HankenGrotesk.woff2', '100 900', 'font/woff2'), ('JetBrains Mono', 'JetBrainsMono.woff2', '100 800', 'font/woff2'))
    css = ''
    for fam, fn, wt, mime in faces:
        fp = os.path.join(d, fn)
        if os.path.exists(fp):
            css += "@font-face{font-family:'%s';font-weight:%s;src:url(data:%s;base64,%s)}" % (fam, wt, mime, base64.b64encode(open(fp, 'rb').read()).decode())
    if not css:
        return ''
    return ('document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent=%s;document.head.appendChild(s);});' % json.dumps(css))


FONTS = fonts_script()


def pre(clock_ms, api, block_storage=False):
    """Before the page's own scripts: a pinned clock, the stand-in Worker, a record of script errors,
       and (optionally) storage that throws the way Safari's private mode does."""
    s = ('(function(){var T=%d,p0=performance.now();Date.now=function(){return T+Math.floor(performance.now()-p0);};'
         'window.VP_GAME_API=%s;window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message));});})();') % (clock_ms, json.dumps(api)) + FONTS
    if block_storage:
        s += ('(function(){try{Object.defineProperty(window,"localStorage",{configurable:true,get:function(){'
              'throw new DOMException("The operation is insecure.","SecurityError");}});}catch(e){}})();')
    return s


class Tab(object):
    def __init__(self, b, base, api, w=375, h=740, clock=T0, block_storage=False, mobile=True):
        self.b, self.base, self.api, self.h = b, base, api, h
        self.tid = b.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        self.sid = b.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        b.call('Page.enable', session=self.sid)
        b.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': mobile}, session=self.sid)
        b.call('Emulation.setTouchEmulationEnabled', {'enabled': True}, session=self.sid)
        self.script = b.call('Page.addScriptToEvaluateOnNewDocument', {'source': pre(clock, api, block_storage)}, session=self.sid)['identifier']
        b.call('Network.enable', session=self.sid)
        b.call('Network.setBlockedURLs', {'urls': ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*googletagmanager*',
                                                   '*google-analytics*', '*facebook*', '*workers.dev*', '*venueplay.com.au*']}, session=self.sid)

    def go(self, path, sting=False):
        # the start-of-game show ("Let's play trivia", 2.3 s) is switched off with ?sting=0 for every walk but the one that tests it
        if not sting and 'sting=' not in path:
            path += ('&' if '?' in path else '?') + 'sting=0'
        self.b.call('Page.navigate', {'url': self.base + path}, session=self.sid)
        time.sleep(0.2)

    def fonts(self):
        self.b.call('Runtime.evaluate', {'expression': 'document.fonts.ready.then(function(){return true;})', 'awaitPromise': True, 'returnByValue': True}, session=self.sid)

    def js(self, expr):
        if expr is FIT:
            self.fonts()
        r = self.b.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True}, session=self.sid)
        if r.get('exceptionDetails'):
            return {'__threw': json.dumps(r['exceptionDetails'])[:300]}
        return r.get('result', {}).get('value')

    def until(self, expr, secs=15):
        end = time.time() + secs
        while time.time() < end:
            v = self.js(expr)
            if v and not (isinstance(v, dict) and v.get('__threw')):
                return v
            time.sleep(0.1)
        return None

    def tap(self, x, y):
        for t in ('touchStart', 'touchEnd'):
            pts = [{'x': x, 'y': y}] if t == 'touchStart' else []
            self.b.call('Input.dispatchTouchEvent', {'type': t, 'touchPoints': pts}, session=self.sid)

    def tap_id(self, el_id):
        """Taps the middle of an element, scrolling it into view first, as a thumb would."""
        r = self.js('(function(){var e=document.getElementById(%s);if(!e||e.hidden)return null;e.scrollIntoView({block:"center"});'
                    'var r=e.getBoundingClientRect();return r.width&&r.height?[r.left+r.width/2,r.top+r.height/2]:null;})()' % json.dumps(el_id))
        if not r or isinstance(r, dict):
            return False
        time.sleep(0.05)
        self.tap(r[0], r[1])
        return True

    def type_into(self, el_id, text):
        """Taps the box and types, the way a phone keyboard does (input events, one insertText)."""
        self.tap_id(el_id)
        self.js('(function(){var e=document.getElementById(%s);e.focus();e.value="";})()' % json.dumps(el_id))
        self.b.call('Input.insertText', {'text': text}, session=self.sid)

    def shot(self, name):
        if not A.shots:
            return
        self.fonts()
        d = self.b.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False}, session=self.sid)['data']
        os.makedirs(A.shots, exist_ok=True)
        with open(os.path.join(A.shots, name), 'wb') as f:
            f.write(base64.b64decode(d))

    def close(self):
        self.b.close_tab(self.tid)


STATE = r'''(function(){
  function shown(id){var e=document.getElementById(id);return !!e && !e.hidden && e.getBoundingClientRect().height>0;}
  function txt(id){var e=document.getElementById(id);return e?e.textContent.replace(/\s+/g," ").trim():"";}
  var q=document.getElementById("q");
  var btns=Array.prototype.map.call(document.querySelectorAll("#answers .ans"),function(b){
    var r=b.getBoundingClientRect(), cs=getComputedStyle(b), tg=b.querySelector(".tg");
    return {text:b.querySelector(".t").textContent, x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height, left:r.left, right:r.right, bottom:r.bottom,
      bg:cs.backgroundColor, cls:b.className, tag:tg?tg.textContent:"", disabled:b.disabled};
  });
  var picks=Array.prototype.map.call(document.querySelectorAll("#picks .pick, #againBox .pick"),function(b){
    var r=b.getBoundingClientRect(); return {text:b.textContent.replace(/\s+/g," ").trim(), x:r.left+r.width/2, y:r.top+r.height/2, h:r.height};
  });
  var rows=Array.prototype.map.call(document.querySelectorAll("#rows li"),function(li){return {text:li.textContent.replace(/\s+/g," ").trim(), you:/\byou\b/.test(li.className)};});
  return JSON.stringify({
    view:["vName","vWhere","vPlay","score","failed"].filter(shown)[0]||"",
    id:q.hidden?"":q.getAttribute("data-id"), q:q.hidden?"":q.textContent, btns:btns, picks:picks, rows:rows,
    count:txt("count"), verdict:txt("verdict"), total:txt("ptotal"), hdr:txt("hdrName"), tag:shown("hdrTag"), addedPill:shown("addedPill"), foot:shown("venueLogo")?"venue":"ours",
    nameKick:shown("nameKick")?txt("nameKick"):"", nameErr:txt("nameErr"), whereKick:"", hint:txt("whereHint"), leadOpen:shown("leadForm"),
    leadVal:(document.getElementById("leadIn")||{}).value||"", nameVal:(document.getElementById("nameIn")||{}).value||"",
    kick:txt("scoreKick"), scoreN:txt("scoreN"), pts:shown("scorePts")?txt("scorePts"):"", place:shown("scorePlace")?txt("scorePlace"):"",
    sub:txt("scoreSub"), board:shown("board"), challenge:shown("challenge"),
    optin:shown("optinEmailRow")||shown("optinMobileRow"), optinEmail:shown("optinEmailRow"), optinMobile:shown("optinMobileRow"), lastRow:shown("lastRow"),
    optinTick:txt("optinTick"), optinTicked:!!(document.getElementById("xOptin")||{}).checked,
    notListed:shown("notListed"),
    tabNight:(document.getElementById("tabNight")||{getAttribute:function(){return ""}}).getAttribute("aria-selected"),
    next:document.getElementById("joinGame").getAttribute("href"), owner:document.getElementById("ownerLink").getAttribute("href"),
    ownerText:txt("ownerLink"), inputs:Array.prototype.filter.call(document.querySelectorAll("input"),function(i){return i.offsetParent!==null;}).length,
    vw:innerWidth, sw:document.documentElement.scrollWidth, errs:window.__errs||[]});
})()'''


FIT = r'''(function(){
  var vw=innerWidth, out=[], clipped=[], small=[];
  Array.prototype.forEach.call(document.querySelectorAll("#app *"),function(e){
    var r=e.getBoundingClientRect(); if(!r.width||!r.height) return;
    var cs=getComputedStyle(e); if(cs.visibility==="hidden"||cs.display==="none") return;
    if(r.left<-0.5||r.right>vw+0.5) out.push((e.id||e.className||e.tagName)+" "+Math.round(r.left)+".."+Math.round(r.right));
    if(/^(BUTTON|A|H1|H2|P|SPAN|B|LI)$/.test(e.tagName) && e.scrollWidth>e.clientWidth+1 && cs.overflow!=="visible")
      clipped.push((e.id||e.className||e.tagName)+" "+e.scrollWidth+">"+e.clientWidth);
    if(/^(BUTTON|A)$/.test(e.tagName) && e.scrollWidth>e.clientWidth+1) clipped.push((e.id||e.className||e.tagName)+" text wider than its button");
    var own=Array.prototype.some.call(e.childNodes,function(n){return n.nodeType===3&&n.textContent.trim();});
    if(own && parseFloat(cs.fontSize)<15 && !e.closest('#optinTick')) small.push((e.id||e.className||e.tagName)+" "+cs.fontSize);
  });
  var tall=Array.prototype.filter.call(document.querySelectorAll("button, .btn"),function(b){var r=b.getBoundingClientRect();return r.height && /btn|ans|pick/.test(b.className) && !/linkbtn|sndtoggle/.test(b.className) && r.height<54;})
    .map(function(b){return (b.id||b.className)+" "+Math.round(b.getBoundingClientRect().height);});
  return JSON.stringify({sw:document.documentElement.scrollWidth, out:out.slice(0,6), clipped:clipped.slice(0,6), small:small.slice(0,6), short:tall.slice(0,6)});
})()'''


def state(t):
    v = t.js(STATE)
    return json.loads(v) if isinstance(v, str) else {'__bad': v}


def wait(t, pred, secs=12):
    end = time.time() + secs
    s = {}
    while time.time() < end:
        s = state(t)
        if pred(s):
            return s
        time.sleep(0.1)
    return s


def clear_storage(b, base, seen=None):
    """Forget this phone, from a page of the same site (Storage.clearDataForOrigin answered
       "Internal error" on this Chrome, 1 Nov 2026, and so cleared nothing)."""
    tid = b.call('Target.createTarget', {'url': base + '/llms.txt', 'newWindow': True})['targetId']
    sid = b.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    for _ in range(50):
        put = '' if seen is None else ', localStorage.setItem("vp-lhn-seen", %s)' % json.dumps(json.dumps(seen))
        r = b.call('Runtime.evaluate', {'expression': 'location.href.indexOf("/llms.txt")>0 && document.readyState==="complete" && (localStorage.clear()%s, localStorage.length===%d)' % (put, 0 if seen is None else 1),
                                        'returnByValue': True}, session=sid)
        if r.get('result', {}).get('value') is True:
            break
        time.sleep(0.1)
    else:
        b.close_tab(tid)
        raise RuntimeError('could not clear the phone\'s storage')
    b.close_tab(tid)


PENDING = {}


def name_step(t, name):
    """The venue comes first now (INBOX 309.1): the name is typed on the details step after it. On a challenge link
       the details step is the first screen, so it is filled now; otherwise it is kept for that step."""
    s = wait(t, lambda s: s.get('view') in ('vName', 'vWhere'))
    if s.get('view') == 'vName':
        t.type_into('nameIn', name)
        t.tap_id('nameBtn')
    else:
        PENDING[id(t)] = name


def details_step(t, secs=6):
    """The details step after a venue, Add it or Play now: the kept first name (and an email where the venue's
       sign-up shows; the tick is left alone), then Play."""
    s = wait(t, lambda s: s.get('view') in ('vName', 'vPlay', 'score'), secs)
    if s.get('view') == 'vName':
        time.sleep(0.3)
        s = state(t)
        if PENDING.get(id(t)) or not s.get('nameVal'):
            t.type_into('nameIn', PENDING.get(id(t)) or 'Pat')
        if s.get('optinEmail'):
            t.type_into('optinEmail', 'player@example.com')
        t.tap_id('nameBtn')
    return s


def where_step(t, typed, pick_text):
    s = wait(t, lambda s: s.get('view') == 'vWhere')
    t.type_into('whereIn', typed)
    s = wait(t, lambda s: any(pick_text in p['text'] for p in s.get('picks', [])))
    p = [p for p in s.get('picks', []) if pick_text in p['text']]
    if p:
        t.js('(function(){var b=Array.prototype.filter.call(document.querySelectorAll("#picks .pick"),function(b){return b.textContent.indexOf(%s)>=0;})[0];if(b)b.scrollIntoView({block:"center"});})()' % json.dumps(pick_text))
        s = state(t)
        p = [p for p in s.get('picks', []) if pick_text in p['text']]
        t.tap(p[0]['x'], p[0]['y'])
    return s


def wait_question(t, not_id=None, secs=12):
    if state(t).get('view') in ('vWhere', 'vName'):
        details_step(t)
    return wait(t, lambda s: (s.get('id') and s.get('id') != not_id and len(s.get('btns', [])) == 4 and not s['btns'][0]['disabled'])
                or s.get('view') in ('score', 'failed'), secs)


def play_round(t, pattern):
    """Taps five questions: pattern[i] True taps the right answer, False a wrong one."""
    ids, seen = [], []
    s = wait_question(t)
    for want_right in pattern:
        if not s.get('id'):
            break
        q = BY_ID.get(s['id'])
        ids.append(s['id'])
        if not q:
            seen.append({'id': s['id'], 'unknown': True})
            break
        pick = q[3] if want_right else (q[3] + 1) % 4
        before = s
        if s['btns'][pick]['y'] > t.js('window.innerHeight') - 4:
            # a 320x568 phone: the ring row (INBOX 310) pushes the fourth answer just under the fold; a thumb
            # scrolls to it. 375x667 and up are held to all four on the first screen below.
            t.js('document.querySelectorAll("#answers .ans")[%d].scrollIntoView({block:"center"})' % pick)
            time.sleep(0.15)
            s2 = state(t)
            if s2.get('btns'):
                s = dict(s, btns=s2['btns'])
        b = s['btns'][pick]
        t.tap(b['x'], b['y'])
        time.sleep(0.12)
        locked = t.js('(function(){var l=document.querySelector("#answers .vpq-locked");return l?getComputedStyle(l,"::after").content:"";})()')
        after = wait(t, lambda x: bool(x.get('verdict')), 3)
        time.sleep(0.35)          # the colour lands, and the Worker's points arrive
        after = state(t)
        other = after['btns'][(pick + 2) % 4] if after.get('btns') else None
        if other:
            t.tap(other['x'], other['y'])
        late = state(t)
        seen.append({'id': s['id'], 'right': want_right, 'pick': pick, 'answer': q[3], 'before': before,
                     'text_match': [x['text'] for x in s['btns']] == q[2], 'qtext': s['q'] == q[1], 'after': after, 'late': late, 'locked': locked})
        s = wait_question(t, not_id=s['id'])
    # In the lead or top 3, the podium (INBOX 313) covers the end for a few seconds: note what it said, then tap it
    # away the way a player can, so the end's own checks read the board underneath.
    PODIUM[id(t)] = None
    if s.get('view') == 'score':
        time.sleep(0.3)
        pod = t.js('(function(){var p=document.getElementById("vpPodium");return p?JSON.stringify({t:(p.querySelector(".vpp-t")||{}).textContent,'
                   'you:(p.querySelector(".vpp-col.you .vpp-step")||{}).textContent,n:p.querySelectorAll(".vpp-col").length,'
                   'conf:p.querySelectorAll(".vpp-confetti").length}):"";})()')
        if pod:
            PODIUM[id(t)] = json.loads(pod)
            t.js('document.getElementById("vpPodium").click()')
            time.sleep(0.3)
            s = state(t)
    return ids, s, seen


PODIUM = {}


def main():
    print('THE QUESTION FILE')
    out, _dropped, _eligible, _per = bankbuild.build()
    check('the file is exactly what tools/live-here-now-bank.py builds from the bank (nobody edited it by hand)',
          out == BANK['q'] and BANK['count'] == len(out), (len(out), BANK.get('count')))
    bank = json.load(io.open(bankbuild.BANK, encoding='utf-8'))['questions']
    src = dict((bankbuild.short_id(q['id']), q) for q in bank if q.get('id'))
    bad = []
    for q in BANK['q']:
        b = src.get(q[0])
        if not b or (b.get('source') or '').lower() != 'venueplay original' or b.get('difficulty') != 'easy' \
                or b['question'].strip() != q[1] or sorted(str(o).strip() for o in b['options']) != sorted(q[2]) \
                or str(b['options'][b['correctIndex']]).strip() != q[2][q[3]]:
            bad.append(q[0])
    check('every question is an easy VenuePlay Original from the trivia bank, word for word, with the bank\'s own right answer',
          not bad and len(BANK['q']) > 0, bad[:5])
    check('a big enough bank: at least 600 questions (120 scans before a phone could need a repeat)', len(BANK['q']) >= 600, len(BANK['q']))
    check('every question has four different answers, one marked right, and an id of its own',
          all(len(q[2]) == 4 and len(set(q[2])) == 4 and 0 <= q[3] < 4 for q in BANK['q']) and len(BY_ID) == len(BANK['q']))
    check('small enough for pub wifi: the page under 75 KB (about 20 KB compressed) and the questions under 200 KB',
          os.path.getsize(PAGE) < 75000 and os.path.getsize(DATA) < 200000, (os.path.getsize(PAGE), os.path.getsize(DATA)))

    print('\nTHE PAGE FILE')
    check('analytics is the site\'s own vp-analytics.js; no Meta pixel',
          '<script src="/app/vp-analytics.js" defer></script>' in HTML and 'vp-pixel' not in HTML and 'fbq(' not in HTML)
    check('INBOX 405.5/405.6: NO footer at all (no Help, Privacy, Terms, no (c) line) and nothing of Gflam',
          '<footer' not in HTML and '&copy;' not in HTML and 'href="/help"' not in HTML and 'href="/privacy"' not in HTML and 'href="/terms"' not in HTML and 'Gflam' not in HTML)
    check('no "60-second" and no "Coaster trivia" anywhere, and no top bar: our logo (or the venue\'s) sits at the foot (396)',
          '60-second' not in HTML and 'Coaster trivia' not in HTML and '<header' not in HTML and 'id="venueLogo"' in HTML)
    check('the game\'s own foot carries the venueplay wordmark (data-vp-mark="wordmark") at the bottom, as the trivia phone',
          'data-vp-mark="wordmark"' in HTML and '<div class="pfoot" id="footMark">' in HTML)
    red = [l.split() for l in io.open(os.path.join(ROOT, 'venueplay', '_redirects'), encoding='utf-8').read().splitlines()
           if l.strip() and not l.lstrip().startswith('#')]
    check('_redirects sends /here (and /here.html), the address printed on the coaster, to /live-here-now with a 301',
          ['/here', '/live-here-now', '301'] in red and ['/here.html', '/live-here-now', '301'] in red, [r for r in red if 'here' in ' '.join(r)])
    check('and /live (and /live.html), the other spelling people try, with a 301 too',
          ['/live', '/live-here-now', '301'] in red and ['/live.html', '/live-here-now', '301'] in red, [r for r in red if 'live' in ' '.join(r)])
    check('and /coaster, "From a venue? Click here", is served by the offer page (today\'s offer)', ['/coaster', '/nsw', '200'] in red)
    sm = io.open(os.path.join(ROOT, 'venueplay', 'sitemap.xml'), encoding='utf-8').read()
    check('the sitemap lists https://venueplay.com.au/live-here-now', '<loc>https://venueplay.com.au/live-here-now</loc>' in sm)

    srv, base = pagesim.serve(os.path.join(ROOT, 'venueplay'))
    fsrv, api = fake_worker()
    print('\nTHE SHORT ADDRESS UNDER THE QR')
    for short in ('/here', '/live'):
        st, loc = no_follow(base, short)
        check('%s answers 301 to /live-here-now (Pages reading the real _redirects)' % short, st == 301 and loc == '/live-here-now', (st, loc))
    st2, _ = no_follow(base, '/live-here-now')
    check('/live-here-now answers 200, and a made-up address beside it answers a real 404 (the control)',
          st2 == 200 and no_follow(base, '/live-here-not')[0] == 404, st2)
    if not gatelib.hold_lock_or_refuse('live-here-now-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        check('the heavy lock is free for Chrome', False)
        return
    b = vl.Browser()
    try:
        clear_storage(b, base)
        tl = Tab(b, base, api, w=390, h=844)
        tl.go('/here')
        s = wait(tl, lambda s: s.get('view') == 'vWhere')
        check('a phone that types venueplay.com.au/here lands on /live-here-now, asking where they are playing',
              tl.js('location.pathname') == '/live-here-now' and s.get('view') == 'vWhere', s.get('view'))
        tl.close()

        print('\nA PHONE SCANS THE COASTER (375 x 740)')
        clear_storage(b, base)
        FAKE['log'][:] = []
        t = Tab(b, base, api)
        t.go('/live-here-now')
        s = wait(t, lambda s: s.get('view') == 'vWhere')
        check('the first screen is "What venue are you at?" (the venue first, INBOX 309.1a), one search box', s.get('view') == 'vWhere' and s.get('inputs') == 1, (s.get('view'), s.get('inputs')))
        wh = t.js('document.getElementById("whereHead").textContent')
        check('...and its heading reads exactly "What venue are you at?" (never "Where are you playing?")', wh == 'What venue are you at?', wh)
        ph = t.js('document.getElementById("whereIn").getAttribute("placeholder")')
        sub = t.js('(function(){var h=document.getElementById("whereHead");var n=h.nextElementSibling;return n?n.tagName+" "+(n.className||""):"";})()')
        check('the search box carries "Start typing your pub or club" as its placeholder and no helper line sits under the heading (INBOX 405.3)',
              ph == 'Start typing your pub or club' and not (sub or '').startswith('P '), (ph, sub))
        check('our wordmark is at the foot (no venue yet), not a top bar', s.get('foot') == 'ours' and t.js('document.querySelector("header")') is None, s.get('foot'))
        one = t.js('(function(){var h=document.getElementById("whereHead"),r=h.getBoundingClientRect(),cs=getComputedStyle(h);return JSON.stringify([r.height/parseFloat(cs.lineHeight),h.scrollWidth<=h.clientWidth+1,cs.color]);})()')
        one = waits.as_json(one, [], 'ONE')
        check('"What venue are you at?" is on ONE line, white', one and one[0] < 1.4 and one[1] and one[2] == 'rgb(255, 255, 255)', one)
        t.type_into('whereIn', 'mi')
        s = wait(t, lambda s: bool(s.get('hint')), 3)
        check('two letters asks for three, and searches nothing', 'three letters' in s.get('hint', '') and not s.get('picks') and
              not any(x[1] == '/coaster/venues' for x in FAKE['log']), s.get('hint'))
        t.type_into('whereIn', 'min')
        s = wait(t, lambda s: bool(s.get('picks')))
        check('three letters finds The Mini Bar, with its state (never a postcode), and says it is "On venueplay"', [p['text'] for p in s.get('picks', [])] == ['The Mini BarNSWOn venueplay'], s.get('picks'))
        check('each pick is a thumb-sized button (56 px or taller)', all(p['h'] >= 56 for p in s.get('picks', [])), s.get('picks'))
        t.shot('lhn-where-375.png')
        t.type_into('whereIn', 'tug')
        s = wait(t, lambda s: any('Tugun Tavern' in p['text'] for p in s.get('picks', [])))
        check('a coaster venue shows its suburb and state and says plainly "Not on venueplay yet"', any(p['text'] == 'Tugun TavernTugun, QLDNot on venueplay yet' for p in s.get('picks', [])), s.get('picks'))
        t.type_into('whereIn', 'roy')
        s = wait(t, lambda s: len(s.get('picks', [])) == 3)
        check('our whole list: a venueplay venue with a game open reads "Game on now"; the same name on our list reads "Not on venueplay yet", with suburb and state, no postcode',
              [p['text'] for p in s.get('picks', [])] == ['Royal HotelNSWGame on now', 'Royal HotelBowral, NSWNot on venueplay yet', 'Royal Oak TavernBallarat, VICNot on venueplay yet'], s.get('picks'))
        word = t.js('(function(){var o=document.querySelector("#picks .pick .on"),f=document.querySelector("#picks .pick .off");'
                    'return JSON.stringify([o&&getComputedStyle(o).color,f&&getComputedStyle(f).color,o&&parseFloat(getComputedStyle(o).fontSize)]);})()')
        word = waits.as_json(word, [], 'WORD')
        check('"On venueplay" is green; "Not on venueplay yet" is muted grey, never the green; both 15px or more, in words, no dot',
              word and word[0] == GREEN and word[1] != GREEN and word[2] >= 15 and 'dot' not in HTML.split('.pick .on')[1][:80], word)
        t.shot('lhn-typeahead-375.png')
        where_step(t, 'min', 'The Mini Bar')
        s = wait(t, lambda s: s.get('view') == 'vName' and s.get('optin'))
        check('then the details, BEFORE play: "Playing at The Mini Bar", the first name, the email box only (it collects no mobile), the phones\' one tick, NOT ticked',
              s.get('nameKick') == 'Playing at The Mini Bar' and s.get('optinEmail') and not s.get('optinMobile') and not s.get('lastRow') and
              s.get('optinTick') == "Send me offers from The Mini Bar. I'm 18 or over." and not s.get('optinTicked'), (s.get('nameKick'), s.get('optinEmail'), s.get('optinMobile'), s.get('optinTick'), s.get('optinTicked')))
        gone = t.js('document.getElementById("vName").textContent.indexOf("never on the board")<0 && document.getElementById("vName").textContent.indexOf("goes on the board")<0')
        check('the name step does NOT carry the long "details go to the venue, never on the board" lines (INBOX 405.8)', gone is True, gone)
        f = waits.as_json(t.js(FIT), {}, "FIT")
        check('the details step fits one screen at 375 (Play on screen, nothing cut off)', not f['out'] and not f['clipped'] and
              t.js('document.getElementById("nameBtn").getBoundingClientRect().bottom <= innerHeight'), f)
        t.shot('lhn-name-375.png')
        t.tap_id('nameBtn')
        s = wait(t, lambda s: bool(s.get('nameErr')), 3)
        check('Play with no name says "Type your first name." and stays', s.get('view') == 'vName' and s.get('nameErr') == 'Type your first name.', s.get('nameErr'))
        t.type_into('nameIn', 'sam smith')
        t.tap_id('nameBtn')
        s = wait(t, lambda s: s.get('nameErr') == 'Type your email.', 3)
        check('no email asks for one and starts nothing', s.get('view') == 'vName' and not any(x[1] in ('/coaster/start', '/coaster/optin') for x in FAKE['log']), s.get('nameErr'))
        t.type_into('optinEmail', 'sam@example.com')
        t.tap_id('xOptin')
        t.tap_id('nameBtn')
        s = wait_question(t)
        sent = [x[2] for x in FAKE['log'] if x[1] == '/coaster/optin']
        check('ticked: after the round starts, the email, the tick and the consent words\' version (vpc-2-6nov) go with the round\'s secret',
              len(sent) == 1 and sent[0].get('email') == 'sam@example.com' and sent[0].get('marketing_optin') is True and sent[0].get('consent_version') == 'vpc-2-6nov' and
              sent[0].get('token', '').startswith('tok'), sent)
        start = [x[2] for x in FAKE['log'] if x[1] == '/coaster/start']
        check('picking it starts a round on its board, sending only the first name, the place and five question ids',
              len(start) == 1 and sorted(start[0].keys()) == ['name', 'place', 'qids'] and start[0]['place'] == MINI and len(start[0]['qids']) == 5, start)
        check('the game screen has no top bar and no venue-name pill: just the ring row, the question and our logo at the bottom (this venue has no logo switched on)',
              s.get('foot') == 'ours' and not s.get('tag') and t.js('document.querySelector("header")') is None, (s.get('foot'), s.get('tag')))
        btns = s.get('btns', [])
        check('four answers in the TV\'s full colours: coral, blue, amber, violet', [x['bg'] for x in btns] == COLOURS, [x['bg'] for x in btns])
        check('each a thumb can hit: 64 px tall or more, the width of the phone less the margins, all on screen',
              len(btns) == 4 and all(x['h'] >= 64 and x['w'] >= 330 and x['right'] <= 375 for x in btns), [(round(x['w']), round(x['h'])) for x in btns])
        t.shot('lhn-question-375.png')
        ids1, s, seen = play_round(t, [True, False, True, False, True])
        r = [x for x in seen if x.get('right')]
        w = [x for x in seen if x.get('right') is False]
        check('a tap shows LOCKED IN on the pick first, as on the trivia phone, then the reveal (INBOX 309.3)',
              len(seen) == 5 and all(x.get('locked') == '"Locked in"' for x in seen), [x.get('locked') for x in seen])
        check('each question and its four answers are the bank\'s', len(seen) == 5 and all(x.get('qtext') and x.get('text_match') for x in seen), seen[:1])
        check('a right tap turns that answer GREEN, tagged "Right answer", and the Worker\'s points follow: "Correct! +145"',
              len(r) == 3 and all(x['after']['btns'][x['pick']]['bg'] == GREEN and x['after']['btns'][x['pick']]['tag'] == 'Right answer'
                                  and x['after']['verdict'] == 'Correct!+145' for x in r),
              [(x['after'].get('verdict'), x['after']['btns'][x['pick']]['bg']) for x in r])
        check('a wrong tap outlines your pick in its own colour, tagged "Yours", shows the right one GREEN, and says "The answer was B" (its letter)',
              len(w) == 2 and all(' mine' in x['after']['btns'][x['pick']]['cls'] and x['after']['btns'][x['pick']]['tag'] == 'Yours'
                                  and x['after']['btns'][x['answer']]['bg'] == GREEN and x['after']['verdict'] == 'The answer was ' + 'ABCD'[x['answer']] for x in w),
              [(x['after'].get('verdict'), [y['cls'] for y in x['after'].get('btns', [])]) for x in w])
        check('a second tap on an answered question changes nothing (and the Worker hears one answer a question)',
              all(x['late'].get('verdict') == x['after'].get('verdict') and [y['cls'] for y in x['late']['btns']] == [y['cls'] for y in x['after']['btns']] for x in seen)
              and len([y for y in FAKE['log'] if y[1] == '/coaster/answer']) == 5, len([y for y in FAKE['log'] if y[1] == '/coaster/answer']))
        check('the running total shows under the answers: "435 points" after the fifth', seen and seen[-1]['after'].get('total') == '435 points', seen and seen[-1]['after'].get('total'))
        check('five different questions, then the end', len(ids1) == 5 and len(set(ids1)) == 5 and s.get('view') == 'score', ids1)
        check('the result hero is personal and leads with the number: "Nice one, Sam", "435 pts"', s.get('kick') == 'Nice one, Sam' and s.get('scoreN') == '435 pts', (s.get('kick'), s.get('scoreN')))
        check('under it: "3 of 5 correct"', s.get('pts') == '3 of 5 correct', s.get('pts'))
        check('and the place: "1st tonight at The Mini Bar"', s.get('place') == '1st tonight at The Mini Bar', s.get('place'))
        pod = PODIUM.get(id(t)) or {}
        check('in the lead: the podium first (INBOX 313), "You\'re in the lead!", Sam on the top step, with confetti, then the board',
              pod.get('t') == "You're in the lead!" and pod.get('you') == '1' and pod.get('conf', 0) > 0 and s.get('board'), pod)
        check('the board, Tonight selected, with Sam\'s row marked "(you)"',
              s.get('board') and s.get('tabNight') == 'true' and len(s.get('rows', [])) == 1 and s['rows'][0]['you'] and 'Sam (you)' in s['rows'][0]['text'], s.get('rows'))
        check('"Want to challenge your mates?" and ONE pink button "Share" is offered, above the board (396 update 2)', s.get('challenge') is True and
              t.js('document.getElementById("challenge").textContent') in ('Share', 'Text your mates a challenge') and
              t.js('document.getElementById("challengeBox").getBoundingClientRect().bottom <= document.getElementById("board").getBoundingClientRect().top'))
        check('"From a venue? Click here" goes to /coaster (today\'s offer), never the home page',
              s.get('owner') == '/coaster' and s.get('ownerText') == 'From a venue? Click here', (s.get('owner'), s.get('ownerText')))
        check('"Game on the TV? Join it" goes to /play when the coaster names no venue', s.get('next') == '/play', s.get('next'))
        t.shot('lhn-score-375.png')
        t.tap_id('tabWeek')
        s = wait(t, lambda s: s.get('tabNight') == 'false' and s.get('rows') and 'Loading' not in s['rows'][0]['text'])
        check('This week loads the week\'s board for the same venue', any(x[1] == '/coaster/board' and x[2].get('period') == 'week' and x[2].get('place') == MINI for x in FAKE['log'])
              and s['rows'] and s['rows'][0]['you'], s.get('rows'))
        code1 = [x for x in FAKE['codes']][-1]

        print('\nPLAY AGAIN, AND SCAN AGAIN')
        t.tap_id('again')
        ids2, s, _ = play_round(t, [True, True, True, True, False])
        check('Play again: five questions this phone has not seen, on the same board, no questions asked',
              len(set(ids2)) == 5 and not set(ids2) & set(ids1) and s.get('scoreN') == '580 pts', (ids1, ids2, s.get('scoreN')))
        check('and the board now has both rounds, the better one first', [x['text'][:3] for x in s.get('rows', [])][:2] == ['1st', '2nd'] and s.get('rows')[0]['you'] and s.get('place') == '1st tonight at The Mini Bar', s.get('rows'))
        stored = t.js('localStorage.getItem("vp-lhn-seen")')
        check('the phone keeps every question it has shown', isinstance(stored, str) and set(ids1 + ids2) <= set(json.loads(stored)), stored)
        t.go('/live-here-now')
        s = wait(t, lambda s: s.get('view') == 'vWhere' and s.get('picks'))
        check('a rescan offers the same venue first: "Still at The Mini Bar?"', bool(s.get('picks')) and s['picks'][0]['text'].startswith('Still at The Mini Bar?'), s.get('picks'))
        t.tap(s['picks'][0]['x'], s['picks'][0]['y'])
        s = wait(t, lambda s: s.get('view') == 'vName')
        time.sleep(0.4)
        s = state(t)
        check('...then has the name ready ("Sam") and does not ask for the sign-up again on this phone', s.get('nameVal') == 'Sam' and not s.get('optin'), (s.get('nameVal'), s.get('optin')))
        t.tap_id('nameBtn')
        ids3, s, _ = play_round(t, [True] * 5)
        check('a rescan in the same hour: five more, none seen before', len(set(ids3)) == 5 and not set(ids3) & set(ids1 + ids2), ids3)
        check('a perfect round: "Perfect round, Sam", "5 of 5"', s.get('kick') == 'Perfect round, Sam' and s.get('scoreN') == '725 pts', (s.get('kick'), s.get('scoreN')))
        check('no script error on the page', not s.get('errs'), s.get('errs'))
        t.close()

        print('\nA MATE ON THE CHALLENGE LINK')
        clear_storage(b, base)
        tm = Tab(b, base, api)
        tm.go('/live-here-now?c=' + code1)
        s = wait(tm, lambda s: s.get('view') == 'vName')
        check('the link opens on the name, saying "You have been challenged"', s.get('nameKick') == 'You have been challenged', s.get('nameKick'))
        name_step(tm, 'Mia')
        s = wait_question(tm)
        check('then straight to the questions, no venue asked (the link carries it), on The Mini Bar\'s board',
              s.get('id') and s.get('view') == 'vPlay', (s.get('view'), s.get('hdr')))
        idsm, s, _ = play_round(tm, [True, True, False, False, False])
        check('the same five questions the challenger had', idsm == ids1, (idsm, ids1))
        check('and the same board: Mia is on it with Sam', any('Mia (you)' in x['text'] for x in s.get('rows', [])) and any('Sam' in x['text'] for x in s.get('rows', [])), s.get('rows'))
        tm.close()

        print('\nTHE NAME STEP, THE START SHOW AND SHARE (INBOX 396 and update 2)')
        SHARE_STUB = ('(function(){window.__shares=[];window.__copied=[];var mode=%s;'
                      'if(mode==="none"){try{Object.defineProperty(navigator,"share",{value:undefined,configurable:true});}catch(e){}}'
                      'else{Object.defineProperty(navigator,"share",{configurable:true,value:function(d){window.__shares.push(d);'
                      'return mode==="cancel"?Promise.reject(new DOMException("cancelled","AbortError")):Promise.resolve();}});}'
                      'try{Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:function(t){window.__copied.push(t);return Promise.resolve();}}});}catch(e){}})();')
        UAS = {'iphone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
               'android': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'}
        for dev, (dw, dh), mode in (('iphone', (390, 844), 'ok'), ('android', (412, 915), 'ok'), ('iphone', (390, 844), 'cancel'), ('android', (412, 915), 'none')):
            clear_storage(b, base)
            FAKE['log'][:] = []
            tsh = Tab(b, base, api, w=dw, h=dh)
            tsh.b.call('Emulation.setUserAgentOverride', {'userAgent': UAS[dev]}, session=tsh.sid)
            tsh.b.call('Page.addScriptToEvaluateOnNewDocument', {'source': SHARE_STUB % json.dumps(mode)}, session=tsh.sid)
            tsh.go('/live-here-now')
            where_step(tsh, 'min', 'The Mini Bar')
            s = wait(tsh, lambda s: s.get('view') == 'vName' and s.get('optin'))
            if mode == 'ok' and dev == 'iphone':
                hd = waits.as_json(tsh.js('(function(){var h=document.getElementById("nameHead"),b=document.getElementById("nameBtn"),t=document.querySelector("#optinTick input"),'
                                         'f=document.querySelector(".facts"),cs=getComputedStyle(h);return JSON.stringify([h.textContent,cs.color,f&&f.textContent,'
                                         'getComputedStyle(b).backgroundColor,t?getComputedStyle(t).borderTopColor:"",b.getBoundingClientRect().height]);})()'), [], 'NAMEHEAD')
                check('the name step: heading "Ready to play?" in WHITE, "5 questions, 20 seconds each", no helper lines, the tick box ringed in the brand pink and Play the bright brand pink, 44 px or taller',
                      hd and hd[0] == 'Ready to play?' and hd[1] == 'rgb(255, 255, 255)' and hd[2] == '5 questions, 20 seconds each' and
                      hd[3] == 'rgb(255, 31, 142)' and hd[4] == 'rgb(255, 31, 142)' and hd[5] >= 44, hd)
            tsh.type_into('nameIn', 'Sam')
            tsh.type_into('optinEmail', 'sam@example.com')
            tsh.tap_id('nameBtn')
            s = wait_question(tsh)
            ids_sh, s, _ = play_round(tsh, [True, False, True, False, True])
            s = wait(tsh, lambda x: x.get('view') == 'score')
            tsh.js('(function(){var p=document.getElementById("vpPodium");if(p)p.click();})()')
            time.sleep(0.3)
            lab = tsh.js('document.getElementById("challenge").textContent')
            cp = tsh.js('document.getElementById("copyLink").hidden')
            tsh.shot('lhn-share-%s-%s.png' % (dev, mode))
            if mode != 'none':          # the text-message link would navigate the tab away to sms: (jsc proves its address)
                tsh.tap_id('challenge')
            time.sleep(0.4)
            shares = waits.as_json(tsh.js('JSON.stringify(window.__shares)'), [], 'SHARES')
            shown_err = tsh.js('document.getElementById("shared").textContent')
            where = tsh.js('location.href')
            tag = '%s %dx%d %s' % (dev, dw, dh, mode)
            if mode in ('ok', 'cancel'):
                check('%s: the button reads "Share", Copy link is not shown, and a tap opens the phone\'s own share sheet with the title, the words and the link' % tag,
                      lab == 'Share' and cp is True and len(shares) == 1 and shares[0].get('title') and
                      shares[0].get('text') == "I'm %s on the Coaster Trivia board at The Mini Bar tonight. Come down and knock me off." % tsh.js('document.getElementById("scorePlace").textContent.split(" ")[0]') and shares[0].get('title') == 'Coaster Trivia' and
                      re.match(r'^https://venueplay\.com\.au/live-here-now\?c=[A-Z0-9]{6}$', shares[0].get('url') or ''), (lab, cp, shares))
            if mode == 'cancel':
                check('%s: a cancelled share does nothing and says nothing (no error line, the page stays put)' % tag,
                      shown_err == '' and 'sms:' not in where and tsh.js('document.getElementById("score").hidden') is False, (shown_err, where))
            if mode == 'none':
                check('%s: no share sheet (a desktop): the pink button reads "Text your mates a challenge" and Copy link is shown' % tag, lab == 'Text your mates a challenge' and cp is False, (lab, cp))
                href_ok = tsh.js('(function(){var o=window.location.href;return o;})()')
                tsh.tap_id('copyLink')
                time.sleep(0.3)
                done = tsh.js('document.getElementById("shared").textContent')
                copied = waits.as_json(tsh.js('JSON.stringify(window.__copied)'), [], 'COPIED')
                check('%s: Copy link says "Link copied" and copies the words with the link' % tag, done == 'Link copied' and len(copied) == 1 and copied[0].startswith("I'm ") and ' on the Coaster Trivia board at The Mini Bar tonight. Come down and knock me off. https://venueplay.com.au/live-here-now?c=' in copied[0], (done, copied))
            f = waits.as_json(tsh.js(FIT), {}, 'FIT')
            check('%s: the result screen fits: nothing sideways, cut off, under 15px or too short to tap' % tag, f['sw'] <= dw and not f['out'] and not f['clipped'] and not f['small'], f)
            tsh.close()
        # the start-of-game show before question 1, with the round started AFTER it (the Worker's clock for question 1)
        clear_storage(b, base)
        FAKE['log'][:] = []
        tst = Tab(b, base, api)
        tst.go('/live-here-now', sting=True)
        where_step(tst, 'tug', 'Tugun Tavern')
        s = wait(tst, lambda s: s.get('view') == 'vName')
        tst.type_into('nameIn', 'Pip')
        tst.tap_id('nameBtn')
        words = None
        for _ in range(20):
            words = tst.js('(function(){var a=document.getElementById("vppL1"),b=document.getElementById("vppL2");return a?JSON.stringify([a.textContent,b?b.textContent:""]):"";})()')
            if words:
                break
            time.sleep(0.1)
        words = waits.as_json(words, [], 'STING') if words else None
        n_start = len([x for x in FAKE['log'] if x[1] == '/coaster/start'])
        tst.shot('lhn-sting-375.png')
        check('before question 1 the start-of-game show plays ("LET’S PLAY" "TRIVIA", the trivia phone\'s) and the round has not started yet', words and 'TRIVIA' in ' '.join(words) and n_start == 0, (words, n_start))
        s = wait_question(tst, secs=15)
        check('then question 1 shows with all four answers and the round started once', s.get('id') and len(s.get('btns', [])) == 4 and len([x for x in FAKE['log'] if x[1] == '/coaster/start']) == 1, s.get('view'))
        tst.close()

        print('\nNOT ON OUR LIST: "CAN\'T FIND YOUR VENUE? ADD IT", AND JUST PLAY')
        clear_storage(b, base)
        tn = Tab(b, base, api)
        tn.go('/live-here-now')
        name_step(tn, 'Kai')
        wait(tn, lambda s: s.get('view') == 'vWhere')
        tn.type_into('whereIn', 'Duck and Drake')
        s = wait(tn, lambda s: 'Not on our list' in s.get('hint', ''))
        check('a venue that is not on our list says so in ONE line, and nothing typed becomes a pick or a board', s.get('hint') == 'Not on our list? Add it below.' and not s.get('picks'),
              (s.get('hint'), s.get('picks')))
        s = wait(tn, lambda s: s.get('leadOpen'))
        tn.shot('lhn-notfound-375.png')
        check('not on our list: the Add your venue form drops down straight away, the name already filled in (INBOX 309.1b)',
              s.get('leadOpen') and s.get('leadVal') == 'Duck and Drake' and not s.get('notListed'), (s.get('leadOpen'), s.get('leadVal')))
        n_lead = len([x for x in FAKE['log'] if x[1] == '/coaster/lead'])
        tn.tap_id('leadBtn')
        time.sleep(0.4)
        err = tn.js('document.getElementById("leadErr").textContent')
        check('no suburb: the form says so and sends nothing', err == 'Type the suburb or town.' and len([x for x in FAKE['log'] if x[1] == '/coaster/lead']) == n_lead, err)
        tn.type_into('leadSuburb', 'Fitzroy')
        err2 = tn.js('document.getElementById("leadErr").textContent')
        check('once the suburb is typed, the "Type the suburb or town." line goes', err2 == '', err2)
        tn.shot('lhn-addit-375.png')
        tn.js('(function(){var e=document.getElementById("leadBtn");if(e)e.scrollIntoView({block:"end"});})()')
        time.sleep(0.2)
        tn.shot('lhn-addit-lower-375.png')
        tn.tap_id('leadBtn')
        s = wait(tn, lambda s: s.get('view') == 'vName', 4)
        lead = [x[2] for x in FAKE['log'] if x[1] == '/coaster/lead']
        check('Add it sends ONLY the name and suburb the player typed (the state is the phone own time-zone guess), for HQ to review, and says thanks',
              lead and lead[-1].get('name') == 'Duck and Drake' and lead[-1].get('suburb') == 'Fitzroy' and lead[-1].get('state') in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT') and lead[-1].get('website') == '' and sorted(lead[-1].keys()) == ['name', 'state', 'suburb', 'website'] and
              s.get('addedPill') and s.get('nameKick') == 'Playing at Duck and Drake', (lead[-1:], s.get('addedPill'), s.get('nameKick')))
        check('after Add: just "Added", straight to the name step (no "we will check it"), the old search box and its "no venue" line cleared',
              tn.js('document.getElementById("addedPill").textContent') == 'Added' and 'check it' not in (tn.js('document.getElementById("vName").textContent') or '') and
              tn.js('document.getElementById("whereIn").value') == '' and tn.js('document.getElementById("whereHint").textContent') == '', s.get('view'))
        tn.shot('lhn-added-375.png')
        s = wait_question(tn)
        starts = [x for x in FAKE['log'] if x[1] == '/coaster/start']
        check('then the round plays on the added venue\'s OWN board when the Worker hands one back (nothing typed makes a board by itself)',
              s.get('id') and [x for x in starts if x[2].get('name') == 'Kai' and x[2].get('place') == DUCK], (s.get('hdr'), starts[-1:]))
        _, s, _ = play_round(tn, [True, False, True, True, False])
        check('...and ends on that board with Share, and no venue sign-up (it is not on venueplay)', s.get('view') == 'score' and s.get('board') and s.get('challenge') and not s.get('optin') and 'Duck and Drake' in (s.get('place') or ''), (s.get('view'), s.get('place')))
        tn.shot('lhn-score-added-375.png')
        tn.close()
        clear_storage(b, base)
        tq = Tab(b, base, api)
        tq.go('/live-here-now')
        name_step(tq, 'Ivy')
        where_step(tq, 'bodalla', 'Bodalla Pub')
        _, s, _ = play_round(tq, [True, True, False, False, False])
        st_b = [x[2] for x in FAKE['log'] if x[1] == '/coaster/start'][-1]
        check('a venue on our list (not on venueplay) has its own board, and never a sign-up box', st_b.get('place') == BODALLA and s.get('board') and not s.get('optin'), (st_b, s.get('optin')))
        tq.close()
        clear_storage(b, base)
        ts = Tab(b, base, api)
        ts.go('/live-here-now')
        name_step(ts, 'Lou')
        wait(ts, lambda s: s.get('view') == 'vWhere')
        ts.type_into('whereIn', 'mini')
        wait(ts, lambda s: len(s.get('picks', [])) >= 1)
        hid = ts.js('document.getElementById("skipWhere").hidden')
        check('with the search working there is no "play without a venue": they pick or add one (INBOX 309.1a)', hid is True, hid)
        ts.close()

        print('\nTHE BOARD DOWN (MIGRATION 153 NOT RUN, OR THE WORKER FAILING)')
        FAKE['off'] = True
        clear_storage(b, base)
        to = Tab(b, base, api)
        to.go('/live-here-now')
        name_step(to, 'Ava')
        s = wait(to, lambda s: s.get('view') == 'vWhere')
        to.type_into('whereIn', 'mini')
        s = wait(to, lambda s: 'having a rest' in s.get('hint', ''))
        check('the search down says so and offers to just play', 'having a rest' in s.get('hint', '') and 'just play' in s.get('hint', '') and not s.get('leadOpen'), s.get('hint'))
        check('...and only then shows "Play now"', to.js('document.getElementById("skipWhere").hidden') is False)
        to.tap_id('skipWhere')
        ids_off, s, seen = play_round(to, [True, False, True, True, False])
        check('the round still plays, the v1 way: "Correct!" with no points', len(ids_off) == 5 and seen[0]['after'].get('verdict') == 'Correct!', seen and seen[0]['after'].get('verdict'))
        check('the end: "3 of 5", "Done in N seconds. ... Beat the table?", no board, no challenge',
              s.get('scoreN') == '3 of 5' and re.match(r'^Done in \d+ seconds?\. .*Beat the table\?$', s.get('sub') or '') is not None
              and not s.get('board') and not s.get('challenge') and not s.get('pts'), (s.get('scoreN'), s.get('sub')))
        check('no script error with the board down', not s.get('errs'), s.get('errs'))
        to.close()
        FAKE['off'] = False

        print('\nTHE RING RUNS OUT (INBOX 310-312): TIME\'S UP, THEN THE RIGHT ANSWER')
        clear_storage(b, base)
        tr = Tab(b, base, api)
        tr.go('/live-here-now')
        name_step(tr, 'Rex')
        where_step(tr, 'min', 'The Mini Bar')
        s = wait_question(tr)
        ring0 = tr.js('document.getElementById("pqCdNum").textContent')
        check('the question shows the trivia phone\'s ring at 20', ring0 in ('20', '19'), ring0)
        n_ans = len([x for x in FAKE['log'] if x[1] == '/coaster/answer'])
        tr.js('(function(){var o=Date.now;Date.now=function(){return o()+21000;};})()')   # 21 seconds later
        saw_up = []
        wait(tr, lambda x: saw_up.append(tr.js('(document.querySelector(".vpq-up")||{}).textContent||""')) or "Time's up!" in saw_up, 3)
        check('at 0 the "Time\'s up!" moment shows', "Time's up!" in saw_up, saw_up[-3:])
        s = wait(tr, lambda x: (x.get('verdict') or '').startswith("Time's up"), 4)
        sent = [x[2] for x in FAKE['log'] if x[1] == '/coaster/answer'][n_ans:]
        check('then it reads "Time\'s up", the right answer is marked, and the board gets a -1 (time\'s up)',
              re.match(r"^Time's up\. The answer was [ABCD]\.$", s.get('verdict') or '') and sent and sent[0].get('a') == -1 and tr.js('!!document.querySelector("#answers .ans.right")'), (s.get('verdict'), sent))
        snd = tr.js('(function(){var b=document.getElementById("vpqMute");return b?JSON.stringify([b.textContent.trim(),b.getBoundingClientRect().height,localStorage.getItem("vpqMute")]):"";})()')
        snd = waits.as_json(snd, [], 'SND')
        check('sound starts OFF with a visible label "Sound off" and a 44 px tap area (396.k)', snd and snd[0] == 'Sound off' and snd[1] >= 44 and snd[2] == '1', snd)
        tr.close()

        print('\nTHE HOUR CHANGES THE SET')
        def first_five(clock):
            clear_storage(b, base)
            tt = Tab(b, base, api, clock=clock)
            tt.go('/live-here-now')
            name_step(tt, 'Jo')
            wait(tt, lambda s: s.get('view') == 'vWhere')
            FAKE['off'] = True     # Play now shows only while the search is down; the five are the hour's either way
            tt.type_into('whereIn', 'mini')
            wait(tt, lambda s: 'having a rest' in s.get('hint', ''))
            tt.tap_id('skipWhere')
            ids, last, _ = play_round(tt, [True] * 5)
            FAKE['off'] = False
            tt.close()
            return ids
        a = first_five(T0)
        a2 = first_five(T0 + 30 * 60000)
        nxt = first_five(T0 + 3600000)
        check('two phones scanning in the same hour get the same five', len(a) == 5 and a == a2 and a == ids1, (a, a2, ids1))
        check('the next hour, a fresh phone gets a different five', len(nxt) == 5 and len(set(nxt) & set(a)) <= 1, (a, nxt))

        print('\nSTORAGE BLOCKED (private mode)')
        tb = Tab(b, base, api, block_storage=True)
        tb.go('/live-here-now')
        threw = tb.js('(function(){try{localStorage.length;return false;}catch(e){return true;}})()')
        name_step(tb, 'Max')
        where_step(tb, 'min', 'The Mini Bar')
        p1, s, _ = play_round(tb, [False] * 5)
        check('with storage throwing, it still plays to the end: "0 pts"', threw is True and s.get('scoreN') == '0 pts', (threw, s.get('scoreN')))
        tb.tap_id('again')
        p2, s, _ = play_round(tb, [True] * 5)
        check('and Play again is still five fresh ones, remembered in memory', len(set(p2)) == 5 and not set(p1) & set(p2), (p1, p2))
        check('no script error with storage blocked', not s.get('errs'), s.get('errs'))
        tb.close()

        print('\n"GAME ON THE TV? JOIN IT" FOR A VENUE')
        for q, want in (('?v=tugun-bowls-club', '/play?venue=tugun-bowls-club'),
                        ('?v=Tugun%20Bowls%20Club', '/play?venue=tugun-bowls-club'),
                        ('?v=', '/play')):
            tv = Tab(b, base, api)
            tv.go('/live-here-now' + q)
            wait(tv, lambda s: s.get('view') == 'vName')
            got = tv.js('document.getElementById("joinGame").getAttribute("href")')
            check('%s links "Game on the TV? Join it" to %s' % (q, want), got == want, got)
            tv.close()

        print('\nFIVE SCREENS: 320, 375, 390, 430 AND 1440 WIDE')
        LONG = max(BANK['q'], key=lambda q: max(len(o) for o in q[2]))
        others = [q[0] for q in BANK['q'] if q[0] != LONG[0]]
        for w, h, mob in ((320, 568, True), (375, 667, True), (390, 844, True), (430, 932, True), (1440, 900, False)):
            clear_storage(b, base, seen=others)
            tf = Tab(b, base, api, w=w, h=h, mobile=mob)
            tf.go('/live-here-now')
            wait(tf, lambda s: s.get('view') == 'vWhere')
            f = waits.as_json(tf.js(FIT), {}, "FIT")
            check('%d px, where are you playing: nothing sideways, off the screen, cut off, under 15px or too small to tap' % w,
                  f['sw'] <= w and not f['out'] and not f['clipped'] and not f['small'] and not f['short'], f)
            hl = waits.as_json(tf.js('(function(){var h=document.getElementById("whereHead"),cs=getComputedStyle(h);return JSON.stringify([h.getBoundingClientRect().height/parseFloat(cs.lineHeight),h.scrollWidth<=h.clientWidth+1]);})()'), [], 'HL')
            check('%d px: "What venue are you at?" is on ONE line, not cut off (396.1)' % w, hl and hl[0] < 1.4 and hl[1], hl)
            tf.shot('lhn-where-%d.png' % w)
            tf.type_into('whereIn', 'ro')
            tf.type_into('whereIn', 'roy')
            wait(tf, lambda s: len(s.get('picks', [])) == 3)
            f = waits.as_json(tf.js(FIT), {}, "FIT")
            check('%d px, the type-ahead picks with their on/not on venueplay words: the same' % w,
                  f['sw'] <= w and not f['out'] and not f['clipped'] and not f['small'] and not f['short'], f)
            tf.shot('lhn-typeahead-%d.png' % w)
            tf.type_into('whereIn', 'Duck and Drake')
            wait(tf, lambda s: 'Not on our list' in s.get('hint', ''))
            wait(tf, lambda s: s.get('leadOpen'))
            tf.shot('lhn-notfound-%d.png' % w)
            tf.type_into('leadSuburb', 'Fitzroy')
            f = waits.as_json(tf.js(FIT), {}, "FIT")
            check('%d px, "Add your venue" (the short form open): the same' % w,
                  f['sw'] <= w and not f['out'] and not f['clipped'] and not f['small'] and not f['short'], f)
            tf.js('window.scrollTo(0, 0)')
            tf.shot('lhn-addit-%d.png' % w)
            # The ring gives each question 20 seconds (INBOX 310); the shots below can take longer than that on a
            # slow machine, so this tab's clock stands still while it is measured. The ring itself is tested above.
            tf.js('(function(){var t=Date.now();Date.now=function(){return t;};})()')
            where_step(tf, 'min', 'The Mini Bar')
            wait(tf, lambda s: s.get('view') == 'vName' and s.get('optin'))
            f = waits.as_json(tf.js(FIT), {}, "FIT")
            on1 = tf.js('document.getElementById("nameBtn").getBoundingClientRect().bottom <= innerHeight')
            check('%d px, your details with the venue\'s sign-up (INBOX 309.1c): the same%s' % (w, ', and Play is on the first screen' if h >= 667 else ''),
                  f['sw'] <= w and not f['out'] and not f['clipped'] and not f['small'] and not f['short'] and (on1 or h < 667), (f, on1))
            tf.shot('lhn-name-%d.png' % w)
            tf.type_into('nameIn', 'Christabel-Anne')
            tf.type_into('optinEmail', 'christabel@example.com')
            tf.tap_id('nameBtn')
            s = wait_question(tf)
            check('%d px: the first question is the one with the longest answer ("%s")' % (w, max(LONG[2], key=len)), s.get('id') == LONG[0], s.get('id'))
            f = waits.as_json(tf.js(FIT), {}, "FIT")
            check('%d px, a question: the same' % w, f['sw'] <= w and not f['out'] and not f['clipped'] and not f['small'] and not f['short'], f)
            one = waits.as_json(tf.js('(function(){var m=document.getElementById("footMark").getBoundingClientRect();return JSON.stringify([document.documentElement.scrollHeight,innerHeight,m.bottom,m.height>0]);})()'), [], 'ONESCREEN')
            check('%d x %d: a game screen is ONE screen, no scroll, and the logo at the bottom is on it (memory: one screen no scroll)' % (w, h),
                  one and one[0] <= one[1] + 1 and one[2] <= one[1] and one[3], one)
            if h >= 667:
                check('%d px: the question and all four answers are on the first screen' % w, all(x['bottom'] <= h for x in s.get('btns', [])),
                      [round(x['bottom']) for x in s.get('btns', [])])
            tf.shot('lhn-question-%d.png' % w)
            _, s, _ = play_round(tf, [True, False, True, True, False])
            time.sleep(0.4)
            f = waits.as_json(tf.js(FIT), {}, "FIT")
            check('%d px, the end with the board: "435 pts", the same' % w,
                  s.get('scoreN') == '435 pts' and s.get('board') and f['sw'] <= w and not f['out'] and not f['clipped'] and not f['small'] and not f['short'], (s.get('scoreN'), s.get('board'), f))
            tf.shot('lhn-score-%d.png' % w)
            tf.close()
    finally:
        b.close()
        srv.shutdown()
        fsrv.shutdown()


try:
    main()
except Exception as e:
    check('the suite ran to the end', False, repr(e))
print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
