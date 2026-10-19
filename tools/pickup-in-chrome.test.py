#!/usr/bin/env python3
"""PICK UP A RUNNING QUIZ (AND A MUSICAL GAME) FROM ANOTHER DEVICE, IN THE REAL CONSOLES, IN REAL BROWSERS.

Dean, 20 Oct 2026: "it would be shit to not be able to fix something to let a venue play a night on a
night". The consoles recovered a live game only from their own tablet's localStorage, so a tablet that
died mid-quiz left every other device on a fresh setup screen with the room still seated.

Two separate Chromes are two devices (separate profiles: no shared localStorage, no BroadcastChannel
between them, which is how two real tablets are). The pages are the shipped venueplay/ files; only the
outside addresses change (tools/browser-rig/: supabase-js is a stand-in signed in as the venue's host,
and the game Worker is the REAL venueplay-game.js in jsc behind a pipe, with a fake database).

  trivia   A quiz is running at the venue, question 2 open, one phone in. The TABLET, with its own
           save, opens the console and gets its quiz back silently (as before). A PHONE, a new device,
           opens the console and is asked on the page (never a native dialog) "A quiz is running at
           this venue. Pick it up?"; Pick it up here restores the same quiz: the same question, its
           answer, the phone already in, the scores; and the Worker records the phone as the holder.
           The TABLET, waking, stands down: a notice, and it sends nothing. Its "Pick it up here"
           brings the quiz back to the tablet and the PHONE then stands down. A third device that
           says Not now gets the setup screen and changes nothing. The next round in the picked-up
           night is not refused by the once-a-week rule.
  musical  A musical game is running; a new device is asked "A musical bingo game is running at this
           venue. Pick it up?", picks it up, gets the songs already played, and the trivia holder is
           untouched (one entry per format).

    python3 tools/pickup-in-chrome.test.py
"""
import datetime, http.server, importlib.util, io, json, os, socket, subprocess, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(spec); spec.loader.exec_module(VL)

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

class Worker(object):
    def __init__(self):
        self.p = subprocess.Popen([JSC, 'tools/browser-rig/worker-stdio.js'], cwd=ROOT, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.lock = threading.Lock()
        self.info = json.loads(self.p.stdout.readline())
    def _line(self, obj):
        with self.lock:
            self.p.stdin.write(json.dumps(obj) + '\n'); self.p.stdin.flush()
            line = self.p.stdout.readline()
        return json.loads(line) if line else {'status': 502, 'body': {'error': 'worker rig died'}}
    def ask(self, method, path, body, headers):
        return self._line({'method': method, 'path': path, 'body': body, 'headers': headers})
    def seed(self, table, rows, replace=False):
        return self._line({'seed': table, 'rows': rows, 'replace': replace})
    def table(self, name):
        return self._line({'table': name})['body']
    def close(self):
        try: self.p.stdin.close(); self.p.terminate()
        except Exception: pass

W = Worker()
UID = '11111111-1111-4111-8111-111111111111'
VENUE = W.info['venue']
FAKE_DB = {
    'vp_platform_admins': [],
    'vp_venue_staff': [{'auth_user_id': UID, 'venue_id': VENUE, 'role': 'owner', 'display_name': 'Test Host'}],
    'vp_venues': [{'id': VENUE, 'name': 'Test Alpha', 'slug': W.info['slug'], 'status': 'active', 'suspended_reason': None,
                   'join_code': W.info['code'], 'au_state': 'QLD', 'max_players': 100, 'included_players': None,
                   'created_at': '2026-01-01T00:00:00Z', 'postcode': '4000', 'logo_url': None, 'paid_entry_enabled': False}],
    'vp_venue_settings': [],
}

EXTERNAL = [
    ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/__fake/supabase.js'),
    ('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js', '/__fake/qrcode.js'),
    ('https://venueplay-game.dean-tindale.workers.dev', '/__worker'),
]
ERRS = ('<script>window.__errs=[];window.addEventListener("error",function(e){__errs.push(String(e.message)+" @"+(e.filename||"").split("/").pop()+":"+e.lineno)});'
        'window.addEventListener("unhandledrejection",function(e){__errs.push("rejected: "+String(e.reason&&e.reason.message||e.reason))});</script>')

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
        r = W.ask(method, self.path[len('/__worker'):] or '/', body, {k: v for k, v in self.headers.items()})
        self.send(r.get('status', 500), json.dumps(r.get('body')), 'application/json')
    def do_POST(self):
        if self.path.startswith('/__worker'): return self.worker('POST')
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'): return self.worker('GET')
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB=%s;window.__FAKE_SIGNED_IN=true;window.__FAKE_UID=%s;\n' % (json.dumps(FAKE_DB), json.dumps(UID))
            return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);},toDataURL:function(t,o,cb){var f=typeof o==="function"?o:cb;if(f)f(null,"data:,");return Promise.resolve("data:,");}};', 'application/javascript')
        if u.path == '/__blank':
            return self.send(200, '<!doctype html><title>blank</title>', 'text/html')
        f = os.path.normpath(os.path.join(ROOT, 'venueplay', u.path.lstrip('/')))
        if not f.startswith(os.path.join(ROOT, 'venueplay')) or not os.path.isfile(f):
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
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

class Device(object):
    """One Chrome, one profile: one tablet or phone."""
    def __init__(self, name):
        self.name = name; self.B = VL.Browser(); self.tid = None; self.sid = None
    def ask(self, expr, wait=8):
        self.B.ws.s.settimeout(wait)
        try: return self.B.eval(self.sid, expr)
        except (socket.timeout, OSError): return 'HUNG'
        finally: self.B.ws.s.settimeout(60)
    def until(self, expr, secs=15):
        t = time.time() + secs
        while time.time() < t:
            v = self.ask(expr)
            if v == 'HUNG' or v: return v
            time.sleep(0.25)
        return False
    def open(self, path, storage=None):
        """Open a page; storage (a dict) is put in this device's localStorage first, as a tablet would have it."""
        if self.tid: self.B.close_tab(self.tid)
        self.tid, self.sid = self.B.open_tab(BASE + '/__blank')
        self.until('document.readyState==="complete"', 10)
        if storage:
            self.ask(';'.join('localStorage.setItem(%s,%s)' % (json.dumps(k), json.dumps(json.dumps(v))) for k, v in storage.items()) + ';true')
        self.ask('location.href=%s;true' % json.dumps(BASE + path))
        time.sleep(0.5)
        self.until('document.readyState==="complete"', 15)
    def text(self):
        return self.ask('document.body.innerText.replace(/\\s+/g," ")') or ''
    def save(self, key):
        v = self.ask('localStorage.getItem(%s)' % json.dumps(key))
        return json.loads(v) if isinstance(v, str) else None
    def close(self):
        try: self.B.close()
        except Exception: pass

def iso(dt): return dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')
NOW = datetime.datetime.now(datetime.timezone.utc)
SESSION = '33333333-3333-4333-8333-333333333333'
GAME = '55555555-5555-4555-8555-555555555555'
MGAME = '66666666-6666-4666-8666-666666666666'
SET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
Q2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
TKEY = 'vpTriviaGame-' + VENUE
MKEY = 'vpMusicGame-' + VENUE
TRIVIA_URL = '/app/trivia/host.html?tv=AAAAAA'    # pairs with a screen code nobody uses: no TV needed here
MUSIC_URL = '/app/musical/host.html?tv=AAAAAA'

W.seed('vp_sessions', [{'id': SESSION, 'venue_id': VENUE, 'status': 'running', 'join_code': 'ABC234',
                        'created_at': iso(NOW - datetime.timedelta(hours=1)), 'opened_at': iso(NOW - datetime.timedelta(hours=1)),
                        'started_at': iso(NOW - datetime.timedelta(minutes=50)), 'console_holders': None}])
W.seed('vp_games', [{'id': GAME, 'session_id': SESSION, 'seq': 1, 'format': 'trivia', 'status': 'running',
                     'config': {'title': 'Tuesday Trivia', 'question_count': 3, 'question_seqs': [1, 2, 3], 'colour': True}}])
W.seed('vp_trivia_games', [{'game_id': GAME, 'question_set_id': SET, 'current_seq': 2, 'phase': 'asking',
                            'question_ends_at': iso(NOW + datetime.timedelta(minutes=15))}])
W.seed('vp_questions', [{'id': 'q1', 'set_id': SET, 'seq': 1, 'question': 'Which planet is red?', 'options': ['Mars', 'Venus'], 'correct_index': 0},
                        {'id': Q2, 'set_id': SET, 'seq': 2, 'question': 'Which river runs through Brisbane?', 'options': ['Murray', 'Yarra', 'Brisbane River'], 'correct_index': 2},
                        {'id': 'q3', 'set_id': SET, 'seq': 3, 'question': 'Third?', 'options': ['a', 'b'], 'correct_index': 1}])
W.seed('vp_players', [{'id': 'p-ann', 'session_id': SESSION, 'device_id': 'dev-ann', 'display_name': 'Quiz Kids', 'kicked': False, 'token': 'tok-p-ann'}])
W.seed('vp_trivia_answers', [{'id': 1, 'game_id': GAME, 'question_id': Q2, 'player_id': 'p-ann', 'answer_index': 2}])
W.seed('v_vp_trivia_leaderboard', [{'game_id': GAME, 'player_id': 'p-ann', 'display_name': 'Quiz Kids', 'points': 100}])

def holders():
    s = [x for x in W.table('vp_sessions') if x.get('id') == SESSION]
    return (s[0].get('console_holders') if s else None) or {}

LIVE = '!document.getElementById("liveBlock").classList.contains("hidden")'
ASKED = '!!document.getElementById("vpTakeover")'
DOWN = '!!document.getElementById("vpOneTab")'
devs = []
try:
    print('\ntrivia: the tablet has its own save and gets its quiz back silently')
    tablet = Device('tablet'); devs.append(tablet)
    tablet.open(TRIVIA_URL, {TKEY: {'v': 1, 'ts': int(time.time() * 1000), 'sessionId': SESSION,
                                    'cur': {'qseq': 2, 'ci': 2, 'pids': {'dev-ann': True}}, 'cid': 'cTABLET000001'}})
    ok('the tablet is back on the live quiz', tablet.until(LIVE, 20) is True, tablet.text()[:300])
    ok('...without being asked anything (its own quiz, nobody else has it)', tablet.ask(ASKED) is False)
    ok('...the open question is on its console', 'Which river runs through Brisbane?' in tablet.text(), tablet.text()[:300])

    print('\ntrivia: a phone (a new device, nothing saved) is asked, on the page')
    phone = Device('phone'); devs.append(phone)
    phone.open(TRIVIA_URL)
    ok('the phone is asked on the page', phone.until(ASKED, 20) is True, phone.text()[:300])
    ok('...in Dean\'s words: "A quiz is running at this venue. Pick it up?"',
       phone.ask('document.getElementById("vpTakeoverT").textContent') == 'A quiz is running at this venue. Pick it up?',
       phone.ask('document.getElementById("vpTakeoverT").textContent'))
    try:
        phone.B.call('Page.handleJavaScriptDialog', {'accept': False}, session=phone.sid); native = True
    except Exception:
        native = False
    ok('...and no native browser dialog is holding the page', not native)
    ok('CONTROL: nobody holds the quiz on the server yet', not holders().get('trivia'), holders())
    phone.ask('document.getElementById("vpTakeoverGo").click();true')
    ok('Pick it up here: the phone is on the live quiz', phone.until(LIVE, 20) is True, phone.text()[:300])
    ok('...the same question', 'Which river runs through Brisbane?' in phone.text(), phone.text()[:300])
    ok('...and then goes on to pair with the venue screen as usual', phone.until('/Waiting for screen|Connected/.test(document.getElementById("statusText").textContent)', 10) is True,
       phone.ask('document.getElementById("statusText").textContent'))
    ps = phone.save(TKEY)
    ok('...it knows the answer to the open question, as the tablet did (Brisbane River)', ps and ps.get('cur') and ps['cur'].get('ci') == 2, ps)
    ok('...and that the phone already in has answered', ps and ps.get('cur') and ps['cur'].get('pids', {}).get('dev-ann') is True, ps)
    ok('...the scores so far are on its board', phone.until('/Quiz Kids/.test(document.getElementById("hostBoard").innerText)', 10) is True,
       phone.ask('document.getElementById("hostBoard").innerText'))
    h = holders().get('trivia') or {}
    ok('the Worker records the phone as the console running it', h.get('id') and ps and h.get('id') == ps.get('cid') and h.get('game_id') == GAME, (h, ps and ps.get('cid')))

    print('\ntrivia: the tablet wakes and stands down')
    tablet.ask('document.dispatchEvent(new Event("visibilitychange"));true')
    ok('the tablet covers itself with a notice', tablet.until(DOWN, 15) is True, tablet.text()[:300])
    ok('...worded for a device: "This quiz was picked up on another device"',
       'This quiz was picked up on another device' in (tablet.ask('document.getElementById("vpOneTab").innerText') or ''),
       tablet.ask('document.getElementById("vpOneTab").innerText'))
    ok('...and it sends nothing now (stood down)', tablet.ask('window.VP_ONETAB.live()') is False)
    ok('...and forgot its own save, so a reload asks first', tablet.save(TKEY) is None, tablet.save(TKEY))

    print('\ntrivia: the tablet picks it back up, and the phone stands down')
    tablet.ask('document.getElementById("vpOneTabTake").click();true')
    time.sleep(1.5)
    tablet.until('document.readyState==="complete"', 15)
    ok('after its reload the tablet is asked again (the phone holds it now)', tablet.until(ASKED, 20) is True, tablet.text()[:300])
    tablet.ask('document.getElementById("vpTakeoverGo").click();true')
    ok('...and is back on the live quiz', tablet.until(LIVE, 20) is True, tablet.text()[:300])
    ts = tablet.save(TKEY)
    ok('the Worker now names the tablet', ts and (holders().get('trivia') or {}).get('id') == ts.get('cid'), (holders(), ts))
    phone.ask('document.dispatchEvent(new Event("visibilitychange"));true')
    ok('the phone stands down in turn', phone.until(DOWN, 15) is True and phone.ask('window.VP_ONETAB.live()') is False, phone.text()[:300])

    print('\ntrivia: a third device says Not now')
    spare = Device('spare'); devs.append(spare)
    before = json.dumps(holders(), sort_keys=True)
    spare.open(TRIVIA_URL)
    ok('it is asked', spare.until(ASKED, 20) is True, spare.text()[:300])
    spare.ask('document.getElementById("vpTakeoverCancel").click();true')
    time.sleep(1.5)
    ok('Not now leaves it on the setup screen', spare.ask('!document.getElementById("setupBlock").classList.contains("hidden")') is True, spare.text()[:300])
    ok('...and takes nothing: the tablet still holds the quiz', json.dumps(holders(), sort_keys=True) == before, holders())
    ok('...and the tablet is still running it', tablet.ask(DOWN) is False and tablet.ask('window.VP_ONETAB.live()') is True)

    print('\ntrivia: the night picked up is the same night')
    r = W.ask('POST', '/host/game', {'session_id': SESSION, 'format': 'trivia'}, {'Authorization': 'Bearer x'})
    ok('starting the next round in it is not refused by the once-a-week rule', r['status'] != 429 and 'once a week' not in json.dumps(r['body']), r)
    for d in devs:
        errs = d.ask('JSON.stringify(window.__errs||[])')
        ok('no script error on the %s' % d.name, errs == '[]', errs)

    print('\nmusical bingo: the same, on its own console')
    W.seed('vp_games', [{'id': MGAME, 'session_id': SESSION, 'seq': 2, 'format': 'musical_bingo', 'status': 'running',
                         'config': {'prize': 'Meat tray', 'playlist_name': 'Aussie Classics', 'song_count': 3, 'auto_daub': True}}])
    W.seed('vp_music_games', [{'game_id': MGAME, 'playlist_id': 'pl-1', 'pattern': 'one_line', 'reveal_mode': 'instant'}])
    W.seed('vp_playlist_songs', [{'id': 's1', 'playlist_id': 'pl-1', 'title': 'Khe Sanh', 'artist': 'Cold Chisel', 'seq': 1},
                                 {'id': 's2', 'playlist_id': 'pl-1', 'title': 'Down Under', 'artist': 'Men at Work', 'seq': 2},
                                 {'id': 's3', 'playlist_id': 'pl-1', 'title': 'Horses', 'artist': 'Daryl Braithwaite', 'seq': 3}])
    W.seed('vp_music_plays', [{'game_id': MGAME, 'song_id': 's1', 'seq': 1, 'played_at': iso(NOW)}])
    # the snapshot shows one running game per night and trivia comes first, so the quiz is over by now
    W.seed('vp_games', [dict(g, status='finished') if g.get('id') == GAME else g for g in W.table('vp_games')], replace=True)
    trivia_holder = json.dumps(holders().get('trivia'), sort_keys=True)
    laptop = Device('laptop'); devs.append(laptop)
    laptop.open(MUSIC_URL)
    ok('a new device is asked about the musical game', laptop.until(ASKED, 25) is True, laptop.text()[:300])
    ok('...in its own words', laptop.ask('document.getElementById("vpTakeoverT").textContent') == 'A musical bingo game is running at this venue. Pick it up?',
       laptop.ask('document.getElementById("vpTakeoverT").textContent'))
    laptop.ask('document.getElementById("vpTakeoverGo").click();true')
    ok('Pick it up here: the laptop is running the game (Play next is live)', laptop.until('document.getElementById("playNextBtn") && document.getElementById("playNextBtn").disabled===false && !!localStorage.getItem(%s)' % json.dumps(MKEY), 20) is True,
       laptop.text()[:300])
    ms = laptop.save(MKEY)
    ok('...it is this device\'s game now (saved here, for a reload)', ms and ms.get('sessionId') == SESSION, ms)
    ok('...the song already played is on its list', 'Khe Sanh' in laptop.text(), laptop.text()[:400])
    mh = holders().get('musical_bingo') or {}
    ok('the Worker records the laptop as the musical console', ms and mh.get('id') == ms.get('cid') and mh.get('game_id') == MGAME, (mh, ms))
    ok('...and the trivia entry is untouched (one entry per format)', json.dumps(holders().get('trivia'), sort_keys=True) == trivia_holder, holders())
    errs = laptop.ask('JSON.stringify(window.__errs||[])')
    ok('no script error on the laptop', errs == '[]', errs)
finally:
    for d in devs: d.close()
    W.close(); srv.shutdown()

print('\n%d of %d checks passed' % (ran - bad, ran))
EXPECTED = 38
if ran != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, ran))
    sys.exit(1)
sys.exit(1 if bad else 0)
