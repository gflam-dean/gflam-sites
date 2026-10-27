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
    'vp_question_sets': [{'id': '33333333-3333-4333-8333-333333333333', 'title': 'Pub Classics', 'question_count': 10, 'visibility': 'public',
                          'owner_venue_id': None, 'status': 'active'}],
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
        if not os.path.splitext(f)[1] and os.path.isfile(f + '.html'): f = f + '.html'; p = p + '.html'   # Pages serves /app/musical/play as play.html
        if not f.startswith(os.path.join(ROOT, 'venueplay')) or not os.path.isfile(f):
            return self.send(404, 'not here', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.json', '.css', '.txt'):
            text = io.open(f, encoding='utf-8').read()
            ctype = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css'}.get(ext, 'text/plain')
            return self.send(200, rewrite(text, p == '/app/index.html' or bool(re.match(r'^/app/\w+/host\.html$', p))), ctype + '; charset=utf-8')
        ctype = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, io.open(f, 'rb').read(), ctype)

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
srv.socket.listen(128)   # Python's default queue of 5 drops scripts when a page asks for many at once (browser-rig/rig.py Server, 26 Oct 2026)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

# ---------------- Chrome ----------------
B = VL.Browser()
def ask(sid, expr, wait=8):
    """Evaluate in the page and return the value, or the string 'HUNG' if the PAGE has stopped.

    Until 20 Oct 2026 HUNG meant "no answer in 8 seconds", and on a busy machine the answer to a page
    that was idle sometimes took 40 to 96 seconds. Browser.evaluate (tools/verify-live.py) now asks the
    page's own CPU clock which it was: a page that spun, or never answered, is HUNG; a page that sat
    idle waiting for a core is not, and its answer stands."""
    r = B.evaluate(sid, expr, wait)
    return 'HUNG' if r is None else r.get('result', {}).get('value')
def until(sid, expr, secs=15):
    t = time.time() + secs
    while time.time() < t:
        v = ask(sid, expr)
        if v == 'HUNG' or v: return v
        time.sleep(0.25)
    return False
def alive(sid):
    return ask(sid, '1+1', 6) == 2

# After Bingo is tapped the console asks the other tabs on this tablet for half a second whether one
# of them is already running the night (vp-onetab.js). This slept 1.5 seconds and hoped; on a busy
# machine half a second of page time is longer than that. Wait for the answer instead.
ONETAB_SETTLED = '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")'

def scene(early):
    print('\nOpen lobby with a phone already waiting%s' % (', Allow early BINGO ticked' if early else ''))
    ptid, phone = B.open_tab(BASE + '/play?room=' + W.info['code'])
    """READY MEANS THE SCRIPT HAS RUN, NOT THAT THE BUTTON IS THERE (20 Oct 2026).
    The Join button is in play.html's markup, above the eight scripts that make it do anything, so
    it exists from the moment the parser passes it. This waited for the button, slept two seconds,
    and tapped. On a busy machine the scripts were still arriving after two seconds: every run that
    failed "the phone is in, waiting for the game" had tapped with document.readyState "loading",
    and every run that passed had tapped with it "complete" (12 of 12 under load). The tap landed
    on a button with no listener, the phone sat on JOIN THE GAME, and the release was blocked.
    So: the page has finished parsing (every script tag above has run, so Join is wired), and the
    Worker has been asked about the room, as it is before a punter can type a name. Up to two
    minutes: play.html fetches eight scripts one after another, each a trip through Chrome and this
    test's server, and at load 650 that took 10 to 13 seconds a time and once over 30."""
    ok('the phone page loads (the real play.html)', until(phone, 'document.readyState!=="loading" && !!document.getElementById("joinBtn")', 120) is True,
       ask(phone, 'document.readyState'))
    t_end = time.time() + 15
    while time.time() < t_end and '/join/info' not in W.calls: time.sleep(0.1)
    ask(phone, 'document.getElementById("nameIn").value="Ann"; document.getElementById("joinBtn").click(); true')
    until(phone, '/YOU.RE IN/i.test(document.body.innerText)', 15)
    ctid, host = B.open_tab(BASE + '/app/')
    ok('the console loads, signed in, on the games menu', until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20) is True,
       ask(host, 'document.body.innerText.slice(0,200)'))
    ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    ok('bingo opens', until(host, '!document.getElementById("setupBlock").classList.contains("hidden")') is True)
    until(host, ONETAB_SETTLED)
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
    # 45 s, not 15: when /host/bingo/seat gives up after its own 6 s the console deals on its next try,
    # 15 s later (seatFailed in index.html), and on a starved machine that path is the normal one.
    ok('the phone is dealt its ticket by the server', until(phone, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of 1/.test(document.body.innerText)', 45) is True,
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
    until(host, '!document.getElementById("setupBlock").classList.contains("hidden")'); until(host, ONETAB_SETTLED)
    ask(host, 'document.getElementById("prizeInput").value=""; setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
    time.sleep(4)
    ok('with no prize typed, the prize is asked for first, before any question about the other device',
       ask(host, '!document.getElementById("vpTakeover") && document.activeElement===document.getElementById("prizeInput")') is True,
       ask(host, '(document.activeElement&&document.activeElement.id)+" takeover:"+!!document.getElementById("vpTakeover")'))
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

# ---------------- every question on the page, never a native dialog (19 Oct 2026) ----------------
def no_native(sid):
    """True when no native browser dialog is open on the page. Page.handleJavaScriptDialog only succeeds
    when one is, and answering it here also frees the page so the rest of the run can carry on."""
    try:
        B.call('Page.handleJavaScriptDialog', {'accept': False}, session=sid); return False
    except Exception:
        return True
def key(sid, k):
    code = {'Enter': 13, 'Escape': 27, 'Tab': 9}[k]
    for t in ('keyDown', 'keyUp'):
        B.call('Input.dispatchKeyEvent', {'type': t, 'key': k, 'code': k, 'windowsVirtualKeyCode': code}, session=sid)
def asked(sid, words):
    return until(sid, '!!document.getElementById("vpAsk") && /%s/.test(document.getElementById("vpAsk").innerText)' % words, 6)
def tap(sid, expr):
    """Click in a timer, so a native dialog it opens cannot hold the evaluation that clicked."""
    return ask(sid, 'setTimeout(function(){ %s }, 0); true' % expr)

def sign_out():
    print('\nSign out of the bingo console with a trivia night still running here (was a native confirm())')
    ctid, host = B.open_tab(BASE + '/app/')
    B.call('Page.enable', {}, session=host)
    until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20)
    ask(host, 'localStorage.setItem("vpTriviaGame-%s", JSON.stringify({ts:Date.now()})); true' % W.info['venue'])
    tap(host, 'document.getElementById("signoutBtn").click();')
    time.sleep(1)
    ok('after Sign out the console still answers inside 6 seconds', alive(host), 'the page did not answer within 6 seconds')
    ok('no native browser dialog is holding it', no_native(host), 'a native dialog was open')
    ok('the question is asked on the page, in the same words', asked(host, 'still running') is True and
       asked(host, 'Sign out anyway') is True, ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    ok('the answer it starts on is Sign out (OK has the focus, as the native box had)',
       ask(host, 'document.activeElement && document.activeElement.id') == 'vpAskGo', ask(host, 'document.activeElement && document.activeElement.id'))
    key(host, 'Tab')
    ok('Tab stays inside the question', ask(host, 'document.activeElement && document.activeElement.id') == 'vpAskCancel',
       ask(host, 'document.activeElement && document.activeElement.id'))
    key(host, 'Escape')
    ok('Escape answers no: the question goes and the host is still signed in',
       until(host, '!document.getElementById("vpAsk")', 4) is True and alive(host) and
       not ask(host, '/Thanks for using VenuePlay/.test(document.body.innerText)'))
    tap(host, 'document.getElementById("signoutBtn").click();')
    asked(host, 'Sign out anyway')
    key(host, 'Enter')
    ok('Enter answers yes: the host is signed out', until(host, '/Thanks for using VenuePlay/.test(document.body.innerText)', 6) is True and alive(host),
       ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    B.close_tab(ctid)

def musical_end():
    print('\nEnd game on the musical bingo console (was a native confirm())')
    ctid, host = B.open_tab(BASE + '/app/musical/host.html')
    B.call('Page.enable', {}, session=host)
    ok('the musical console loads', until(host, 'document.readyState==="complete" && !!document.getElementById("endGameBtn")', 20) is True)
    time.sleep(2)
    tap(host, 'document.getElementById("endGameBtn").click();')
    time.sleep(1)
    ok('after End game the console still answers inside 6 seconds', alive(host), 'the page did not answer within 6 seconds')
    ok('no native browser dialog is holding it', no_native(host), 'a native dialog was open')
    ok('End this game? is asked on the page', asked(host, 'End this game') is True, ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    tap(host, 'document.getElementById("vpAskCancel").click();')
    ok('Cancel leaves the game alone and the console answers', until(host, '!document.getElementById("vpAsk")', 4) is True and alive(host))
    tap(host, 'document.getElementById("endGameBtn").click();')
    asked(host, 'End this game')
    tap(host, 'document.getElementById("vpAskGo").click();')
    ok('End game, answered yes on the page, goes through and the console answers', until(host, '!document.getElementById("vpAsk")', 4) is True and alive(host)
       and not ask(host, '(window.__errs||[]).join(" | ")'), ask(host, '(window.__errs||[]).join(" | ")'))
    B.close_tab(ctid)

def raffle_settings():
    print('\nChange the raffle settings after a number has been drawn tonight (was a native confirm())')
    venue = W.info['venue']
    W.ask('POST', '/host/gaming/declare', {'venue_id': venue, 'format': 'raffle', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    sess = W.ask('POST', '/session', {'venue_id': venue, 'format': 'raffle'}, {})['body'].get('session_id')
    game = W.ask('POST', '/host/game', {'session_id': sess, 'format': 'raffle', 'range_min': 1, 'range_max': 150, 'excluded_ranges': [], 'winners': 1,
                                        'time_to_present': 0, 'spin_seconds': 3, 'allow_redraw': True, 'leading_zeros': True, 'jackpot_on': False,
                                        'jackpot_amount_cents': None, 'prize': 'Meat tray', 'prize_type': 'other', 'prizes': []}, {})['body'].get('game_id')
    drew = W.ask('POST', '/host/draw', {'game_id': game, 'winners': 1, 'spin_seconds': 3, 'prize': 'Meat tray', 'prize_type': 'other'}, {})
    ok('CONTROL: a raffle is running at the venue with a number drawn tonight', drew.get('status') == 200 and (drew.get('body') or {}).get('tickets'), drew)
    ctid, host = B.open_tab(BASE + '/app/raffle/host.html')
    B.call('Page.enable', {}, session=host)
    until(host, 'document.readyState==="complete"', 20)
    ask(host, ('localStorage.setItem("vpRaffleGame-%s", JSON.stringify({v:2, ts:Date.now(), sessionId:%s, prizes:["Meat tray","Meat tray"], prizeIdx:1}));'
               'location.reload(); true') % (venue, json.dumps(sess)))
    time.sleep(1)
    ok('the raffle console picks the running raffle back up', until(host, 'document.readyState==="complete" && document.getElementById("rfEnd").value==="150"', 20) is True,
       ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    time.sleep(2)
    for i in range(3):    # the night's rules, asked once a day on the page, then the prize card if one is up
        tap(host, 'var w=document.getElementById("winnerCard"); var c=document.getElementById("claimBtn"); if(w && w.classList.contains("show") && c) c.click();')
        time.sleep(1)
    ask(host, 'var e=document.getElementById("rfEnd"); e.value="200"; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); true')
    tap(host, 'document.getElementById("drawBtn").click();')
    time.sleep(1)
    for i in range(6):    # vp-gaming.js may put the state rules up first; accept them in the rig, then the question comes
        if ask(host, '!!document.getElementById("vpAsk")') is True: break
        tap(host, 'var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && /I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click();')
        time.sleep(1)
    ok('after Draw with new settings the console still answers inside 6 seconds', alive(host), 'the page did not answer within 6 seconds')
    ok('no native browser dialog is holding it', no_native(host), 'a native dialog was open')
    ok('Start a fresh raffle? is asked on the page, in the same words', asked(host, 'starts a FRESH raffle') is True,
       ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,300)'))
    key(host, 'Escape')
    ok('No keeps the raffle that is running and says so', until(host, '!document.getElementById("vpAsk") && /Kept the current raffle/.test(document.body.innerText)', 6) is True
       and alive(host), ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,300)'))
    B.close_tab(ctid)

def live_now():
    return W.ask('GET', '/play/live?code=' + W.info['code'], {}, {})['body'].get('live') is True
def until_live(want, secs=8):
    t = time.time() + secs
    while time.time() < t:
        if live_now() == want: return True
        time.sleep(0.3)
    return False
def visible(sid, el_id):
    return ask(sid, '(function(){var e=document.getElementById("%s"); return !!e && e.offsetParent!==null && getComputedStyle(e).display!=="none";})()' % el_id)

def done_closes_the_night():
    """Live audit, 19 Oct 2026: Close lobby and End game left the session open, so the venue read live and
    the next format on the SAME tablet was asked about a game "on another device"."""
    print('\nClose lobby and End game close the night, on every console, and the next format is not asked about another device')
    ctid, host = B.open_tab(BASE + '/app/')
    until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20)
    ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    until(host, '!document.getElementById("setupBlock").classList.contains("hidden")'); time.sleep(1.5)
    ask(host, 'document.getElementById("prizeInput").value="Meat tray"; true')
    tap(host, 'document.getElementById("startBtn").click();')
    ok('CONTROL: bingo Open lobby makes the venue live', until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"') is True and until_live(True))
    tap(host, 'document.getElementById("cancelLobbyBtn").click();')
    ok('bingo Close lobby closes the night: /play/live is not live', until_live(False), 'still live after Close lobby')
    ok('and the console still answers', alive(host))
    B.close_tab(ctid)

    ctid, host = B.open_tab(BASE + '/app/musical/host.html')
    until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 20); time.sleep(4)
    ask(host, 'document.getElementById("prizeInput").value="Bar tab"; true')
    tap(host, 'document.getElementById("startBtn").click();')
    time.sleep(3)
    ok('the next format on the same tablet (musical) opens with no takeover question', not ask(host, '!!document.getElementById("vpTakeover")') and
       until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 10) is True,
       ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,300)'))
    ok('CONTROL: the musical lobby is live', until_live(True))
    tap(host, 'document.getElementById("cancelLobbyBtn").click();')
    ok('musical Close lobby closes the night', until_live(False))
    tap(host, 'document.getElementById("startBtn").click();')
    until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 10)
    ok('CONTROL: a second musical lobby is live again, still no takeover question', until_live(True) and not ask(host, '!!document.getElementById("vpTakeover")'))
    tap(host, 'document.getElementById("endGameBtn").click();')
    asked(host, 'End this game')
    tap(host, 'document.getElementById("vpAskGo").click();')
    ok('musical End game closes the night', until_live(False))
    B.close_tab(ctid)

    ctid, host = B.open_tab(BASE + '/app/trivia/host.html')
    until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 20); time.sleep(4)
    tap(host, 'document.getElementById("startBtn").click();')
    time.sleep(3)
    ok('trivia on the same tablet opens its lobby with no takeover question', not ask(host, '!!document.getElementById("vpTakeover")') and
       until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 10) is True,
       ask(host, '((document.getElementById("hostErrText")||{}).textContent||"")+" | "+(window.__errs||[]).join(" | ")+" | "+document.getElementById("startBtn").textContent'))
    ok('CONTROL: the trivia lobby is live', until_live(True))
    tap(host, 'document.getElementById("cancelLobbyBtn").click();')
    ok('trivia Close lobby closes the night', until_live(False))
    tap(host, 'document.getElementById("startBtn").click();')
    until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 10)
    ok('CONTROL: a second trivia lobby is live', until_live(True))
    tap(host, 'document.getElementById("toAdsBtn").click();')
    time.sleep(0.5)
    if ask(host, '!!document.getElementById("vpAsk")') is True: tap(host, 'document.getElementById("vpAskGo").click();')
    ok('trivia End game (back to ads) closes the night', until_live(False))
    ok('and the console still answers', alive(host))
    B.close_tab(ctid)

def name_follows_the_phone():
    """Live audit, 19 Oct 2026: a phone that played bingo was asked its name again when the room went to
    musical bingo. The phone is its own browser here (its own profile and storage), not a tab of the host's."""
    print('\nA phone that played bingo keeps its name when the room moves to musical bingo (phone in its own browser)')
    PB = VL.Browser()
    try:
        ptid, phone = PB.open_tab(BASE + '/play?room=' + W.info['code'])
        def pask(expr, wait=8):
            PB.ws.s.settimeout(wait)
            try: return PB.eval(phone, expr)
            except (socket.timeout, OSError): return 'HUNG'
            finally: PB.ws.s.settimeout(60)
        def puntil(expr, secs=20):
            t = time.time() + secs
            while time.time() < t:
                v = pask(expr)
                if v == 'HUNG' or v: return v
                time.sleep(0.4)
            return False
        puntil('!!document.getElementById("joinBtn")'); time.sleep(2)
        pask('document.getElementById("nameIn").value="Ann"; document.getElementById("joinBtn").click(); true')
        ok('CONTROL: the phone joins bingo as Ann', puntil('/YOU.RE IN/i.test(document.body.innerText)', 15) is True)
        ctid, host = B.open_tab(BASE + '/app/')
        until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 20)
        ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        until(host, '!document.getElementById("setupBlock").classList.contains("hidden")'); time.sleep(1.5)
        ask(host, 'document.getElementById("prizeInput").value="Meat tray"; true')
        tap(host, 'document.getElementById("startBtn").click();')
        until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"')
        time.sleep(3)
        tap(host, 'document.getElementById("cancelLobbyBtn").click();')
        until_live(False)
        B.close_tab(ctid)
        mtid, mhost = B.open_tab(BASE + '/app/musical/host.html')
        until(mhost, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 20); time.sleep(4)
        ask(mhost, 'document.getElementById("prizeInput").value="Bar tab"; true')
        tap(mhost, 'document.getElementById("startBtn").click();')
        moved = puntil('/\\/app\\/musical\\/play/.test(location.pathname)', 40)
        ok('CONTROL: the phone follows the room to musical bingo', moved is True, pask('location.href'))
        time.sleep(3)
        ok('and is not asked for its name again: the box already says Ann, or it is already in',
           puntil('(document.getElementById("nameIn") && document.getElementById("nameIn").value==="Ann") || /YOU.RE IN/i.test(document.body.innerText)', 10) is True,
           pask('(document.getElementById("nameIn")||{}).value+" | "+document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        B.close_tab(mtid)
    finally:
        PB.close()

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
    fresh(); sign_out()
    fresh(); musical_end()
    fresh(); raffle_settings()
    fresh(); done_closes_the_night()
    fresh(); name_follows_the_phone()
finally:
    B.close(); W.close(); srv.shutdown()

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
