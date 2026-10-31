#!/usr/bin/env python3
"""THE DRINK-COASTER PAGE, PLAYED IN A REAL BROWSER AT PHONE WIDTH (/live-here-now, 31 Oct 2026).

Dean's brief: "Opens straight into a question. No name, no sign-up, no room code. Four big buttons,
tap to answer, instant right/wrong in pink or yellow. Five questions per scan, then a score screen:
'4/5. Beat the table?' with a 'Play again' button and a 'Find out when the next trivia night is'
line ... The question bank changes every hour automatically, and the phone remembers which
questions it has already shown, so the same person scanning again gets fresh ones."

Every one of those is a thing the page DOES, so this opens the real venueplay/live-here-now.html,
served from this checkout the way Cloudflare Pages serves it (/live-here-now is live-here-now.html),
in headless Chrome as a 375 by 740 phone, and plays it by tapping the screen:

  - the first question is up with nothing typed: no input anywhere, four buttons a thumb can hit,
    no sideways scroll, and the same at 320 px
  - a right tap paints the button PINK and says so; a wrong tap paints it YELLOW and shows the
    right one in pink; a second tap on an answered question changes nothing
  - five questions, then "3/5. Beat the table?", Play again, and the next-night link
  - Play again: five more, none of them seen. A fresh scan (reload) in the same hour: five more again
  - two phones in the same hour get the same five (a fair "Beat the table?"); the next hour, a
    different five. The clock is pinned inside the page, never read from this machine
  - storage blocked (private mode): still plays, and Play again is still fresh
  - ?v=<slug> sends the next-night line to that venue's page, /play?venue=<slug>; none, to
    venueplay.com.au
  - the question file is the build script's output exactly, every question traces to an easy
    "VenuePlay Original" in the trivia bank, and it is small enough for pub wifi

Nothing leaves this machine: fonts, analytics and the pixel are blocked in the browser.

    python3 tools/live-here-now-in-chrome.test.py [--shots DIR]
"""
import argparse, base64, functools, http.server, importlib.util, io, json, os, re, socketserver, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--shots', default=os.environ.get('LIVE_HERE_NOW_SCREENS', ''))
A = ap.parse_args()


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


vl = _load('verify_live', 'tools/verify-live.py')
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
PINK, GOLD = 'rgb(255, 31, 142)', 'rgb(255, 194, 75)'
HOUR = 491234          # a fixed hour (Sep 2026), never this machine's clock
T0 = HOUR * 3600000 + 20 * 60000


def serve(folder):
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            p = self.path.split('?')[0]
            # Clean URLs, the way Cloudflare Pages serves them (/live-here-now is live-here-now.html).
            if p != '/' and not os.path.splitext(p)[1] and os.path.isfile(os.path.join(folder, p.lstrip('/') + '.html')):
                self.path = p + '.html' + self.path[len(p):]
            return super().do_GET()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=folder))
    srv.socket.listen(128)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d' % srv.server_address[1]


def pre(clock_ms, block_storage=False):
    """Before the page's own scripts: a pinned clock, a record of script errors, and (optionally) a
       phone whose storage throws the way Safari's private mode and locked-down phones do."""
    s = ('(function(){var T=%d,p0=performance.now();Date.now=function(){return T+Math.floor(performance.now()-p0);};'
         'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message));});})();') % clock_ms
    if block_storage:
        s += ('(function(){try{Object.defineProperty(window,"localStorage",{configurable:true,get:function(){'
              'throw new DOMException("The operation is insecure.","SecurityError");}});}catch(e){}})();')
    return s


class Tab(object):
    def __init__(self, b, base, w=375, h=740, clock=T0, block_storage=False):
        self.b, self.base = b, base
        self.tid = b.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        self.sid = b.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        b.call('Page.enable', session=self.sid)
        b.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=self.sid)
        b.call('Emulation.setTouchEmulationEnabled', {'enabled': True}, session=self.sid)
        self.script = b.call('Page.addScriptToEvaluateOnNewDocument', {'source': pre(clock, block_storage)}, session=self.sid)['identifier']
        b.call('Network.enable', session=self.sid)
        b.call('Network.setBlockedURLs', {'urls': ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*googletagmanager*',
                                                   '*google-analytics*', '*facebook*', '*workers.dev*', '*venueplay.com.au*']}, session=self.sid)

    def clock(self, ms):
        self.b.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': self.script}, session=self.sid)
        self.script = self.b.call('Page.addScriptToEvaluateOnNewDocument', {'source': pre(ms)}, session=self.sid)['identifier']

    def go(self, path):
        self.b.call('Page.navigate', {'url': self.base + path}, session=self.sid)
        time.sleep(0.2)

    def js(self, expr):
        r = self.b.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True}, session=self.sid)
        if r.get('exceptionDetails'):
            return {'__threw': json.dumps(r['exceptionDetails'])[:300]}
        return r.get('result', {}).get('value')

    def until(self, expr, secs=20):
        end = time.time() + secs
        while time.time() < end:
            v = self.js(expr)
            if v and not (isinstance(v, dict) and v.get('__threw')):
                return v
            time.sleep(0.1)
        return None

    def tap(self, x, y):
        """A real touch on the screen, where a thumb would land: whatever is painted there gets it."""
        for t in ('touchStart', 'touchEnd'):
            pts = [{'x': x, 'y': y}] if t == 'touchStart' else []
            self.b.call('Input.dispatchTouchEvent', {'type': t, 'touchPoints': pts}, session=self.sid)

    def shot(self, path):
        d = self.b.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False}, session=self.sid)['data']
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(d))

    def close(self):
        self.b.close_tab(self.tid)


STATE = r'''(function(){
  var q=document.getElementById("q"), sc=document.getElementById("score");
  var btns=Array.prototype.map.call(document.querySelectorAll("#answers .ans"),function(b){
    var r=b.getBoundingClientRect(), cs=getComputedStyle(b);
    return {text:b.lastChild.textContent, x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height, left:r.left, right:r.right, bottom:r.bottom,
      bg:cs.backgroundColor, disabled:b.disabled};
  });
  var qr=q.getBoundingClientRect();
  return JSON.stringify({id:q.getAttribute("data-id"), q:q.hidden?"":q.textContent, qRight:qr.right, btns:btns,
    count:document.getElementById("count").textContent, verdict:document.getElementById("verdict").textContent,
    verdictColor:getComputedStyle(document.getElementById("verdict")).color,
    score:sc.hidden?"":document.getElementById("scoreLine").textContent.replace(/\s+/g," ").trim(),
    scoreShown:!sc.hidden && sc.getBoundingClientRect().height>0,
    again:(function(){var a=document.getElementById("again"),r=a.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,shown:!sc.hidden};})(),
    next:document.getElementById("nextNight").getAttribute("href"), nextText:document.getElementById("nextNight").textContent,
    failed:!document.getElementById("failed").hidden,
    inputs:document.querySelectorAll("input,textarea,select").length,
    vw:innerWidth, sw:document.documentElement.scrollWidth, errs:window.__errs||[]});
})()'''


def state(t):
    v = t.js(STATE)
    return json.loads(v) if isinstance(v, str) else {'__bad': v}


def wait_question(t, not_id=None, secs=15):
    """The next question is on screen (a different one from not_id), its four buttons laid out."""
    end = time.time() + secs
    s = {}
    while time.time() < end:
        s = state(t)
        if s.get('id') and s.get('id') != not_id and len(s.get('btns', [])) == 4 and not s['btns'][0]['disabled']:
            return s
        if s.get('scoreShown') or s.get('failed'):
            return s
        time.sleep(0.1)
    return s


def play_round(t, pattern, label):
    """Plays five questions by tapping: pattern[i] True taps the right answer, False a wrong one.
       Returns (ids, last state, per-question observations)."""
    ids, seen = [], []
    s = wait_question(t)
    for i, want_right in enumerate(pattern):
        if not s.get('id'):
            break
        q = BY_ID.get(s['id'])
        ids.append(s['id'])
        if not q:
            seen.append({'id': s['id'], 'unknown': True})
            break
        pick = q[3] if want_right else (q[3] + 1) % 4
        b = s['btns'][pick]
        t.tap(b['x'], b['y'])
        after = None
        end = time.time() + 3
        while time.time() < end:
            after = state(t)
            if after.get('verdict'):
                break
            time.sleep(0.03)
        # A second, late tap on another answer must change nothing.
        other = after['btns'][(pick + 2) % 4] if after and after.get('btns') else None
        if other:
            t.tap(other['x'], other['y'])
        late = state(t)
        seen.append({'id': s['id'], 'right': want_right, 'pick': pick, 'answer': q[3], 'text_match': [x['text'] for x in s['btns']] == q[2],
                     'qtext': s['q'] == q[1], 'after': after, 'late': late})
        s = wait_question(t, not_id=s['id'])
    return ids, s, seen


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
    check('small enough for pub wifi: the page under 40 KB and the questions under 200 KB',
          os.path.getsize(PAGE) < 40000 and os.path.getsize(DATA) < 200000, (os.path.getsize(PAGE), os.path.getsize(DATA)))

    print('\nTHE WORDS ON THE PAGE')
    text = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<!--[\s\S]*?-->', ' ', HTML)
    text = re.sub(r'<[^>]+>', ' ', text) + ' '.join(re.findall(r"'([^']{3,})'", re.search(r'<script>\s*\(function[\s\S]*</script>', HTML).group(0)))
    check('no em dash, no "roster", no price or offer, no phone number',
          u'—' not in HTML and 'roster' not in HTML.lower() and not re.search(r'\$\s?\d|\boffer\b|\bprice', text, re.I)
          and not re.search(r'\b0\d[\s\d]{8,}', text), re.findall(r'.{20}(?:—|\$\d|offer|0\d \d{4}).{20}', HTML)[:3])
    sm = io.open(os.path.join(ROOT, 'venueplay', 'sitemap.xml'), encoding='utf-8').read()
    check('the sitemap lists https://venueplay.com.au/live-here-now', '<loc>https://venueplay.com.au/live-here-now</loc>' in sm)

    srv, base = serve(os.path.join(ROOT, 'venueplay'))
    b = vl.Browser()
    try:
        print('\nA PHONE SCANS THE COASTER (375 x 740)')
        t = Tab(b, base)
        b.call('Storage.clearDataForOrigin', {'origin': base, 'storageTypes': 'local_storage'})
        t.go('/live-here-now')
        s = wait_question(t)
        check('a question is on screen straight away, with nothing to type (no name, no code)',
              bool(s.get('id')) and s.get('inputs') == 0 and 'Question 1 of 5' == s.get('count'), s)
        btns = s.get('btns', [])
        check('four big buttons a thumb can hit: each at least 56 px tall and 300 px wide, all on screen',
              len(btns) == 4 and all(x['h'] >= 56 and x['w'] >= 300 and x['right'] <= s['vw'] and x['bottom'] <= 740 for x in btns),
              [(round(x['w']), round(x['h']), round(x['bottom'])) for x in btns])
        check('nothing scrolls sideways at 375 px', s.get('sw', 999) <= s.get('vw', 0), (s.get('sw'), s.get('vw')))
        first_id = s.get('id')

        ids1, s, seen = play_round(t, [True, False, True, False, True], 'first scan')
        r = [x for x in seen if x.get('right')]
        w = [x for x in seen if x.get('right') is False]
        check('each question and its four answers are the bank\'s, as shown on the buttons',
              len(seen) == 5 and all(x.get('qtext') and x.get('text_match') for x in seen), seen[:1])
        check('a right tap turns that button PINK and says "Right!" at once',
              len(r) == 3 and all(x['after'] and x['after']['btns'][x['pick']]['bg'] == PINK and x['after']['verdict'] == 'Right!'
                                  and x['after']['verdictColor'] == PINK for x in r),
              [(x['after'] or {}).get('verdict') for x in r] + [((x['after'] or {}).get('btns') or [{}] * 4)[x['pick']].get('bg') for x in r])
        check('a wrong tap turns that button YELLOW, shows the right answer in PINK, and says "Not quite"',
              len(w) == 2 and all(x['after'] and x['after']['btns'][x['pick']]['bg'] == GOLD and x['after']['btns'][x['answer']]['bg'] == PINK
                                  and x['after']['verdict'] == 'Not quite' and x['after']['verdictColor'] == GOLD for x in w),
              [((x['after'] or {}).get('verdict'), [y['bg'] for y in (x['after'] or {}).get('btns', [])]) for x in w])
        check('a second tap on an answered question changes nothing',
              all(x['late'] and x['late'].get('verdict') == x['after'].get('verdict')
                  and [y['bg'] for y in x['late'].get('btns', [])] == [y['bg'] for y in x['after'].get('btns', [])] for x in seen if x.get('after')),
              [(x['after'] or {}).get('verdict') for x in seen])
        check('five different questions, then the score', len(ids1) == 5 and len(set(ids1)) == 5 and ids1[0] == first_id, ids1)
        check('the score screen reads "3/5. Beat the table?"', s.get('scoreShown') and s.get('score') == '3/5. Beat the table?', s.get('score'))
        check('a Play again button a thumb can hit, on screen',
              s.get('again', {}).get('shown') and s['again']['h'] >= 56 and 0 < s['again']['y'] < 740, s.get('again'))
        check('"Find out when the next trivia night is" goes to venueplay.com.au when the coaster names no venue',
              s.get('next') == 'https://venueplay.com.au' and s.get('nextText') == 'Find out when the next trivia night is', s.get('next'))
        if A.shots:
            t.shot(os.path.join(A.shots, 'live-here-now-score-375.png'))

        print('\nPLAY AGAIN, AND SCAN AGAIN')
        t.tap(s['again']['x'], s['again']['y'])
        ids2, s, _ = play_round(t, [True, True, True, True, False], 'play again')
        check('Play again gives five questions this phone has not seen', len(set(ids2)) == 5 and not set(ids2) & set(ids1), (ids1, ids2))
        check('and the score counts the new round: "4/5. Beat the table?"', s.get('score') == '4/5. Beat the table?', s.get('score'))
        stored = t.js('localStorage.getItem("vp-lhn-seen")')
        check('the phone keeps every question it has shown', isinstance(stored, str) and set(ids1 + ids2) <= set(json.loads(stored)), stored)
        t.go('/live-here-now')
        s = wait_question(t)
        ids3, s, _ = play_round(t, [True] * 5, 'rescan')
        check('scanning again in the same hour: five more, none seen before',
              len(set(ids3)) == 5 and not set(ids3) & set(ids1 + ids2), ids3)
        check('a perfect round reads "5/5. Beat the table?"', s.get('score') == '5/5. Beat the table?', s.get('score'))
        check('no script error on the page', not s.get('errs'), s.get('errs'))
        t.close()

        print('\nTHE HOUR CHANGES THE SET')
        def first_five(clock, slug=''):
            b.call('Storage.clearDataForOrigin', {'origin': base, 'storageTypes': 'local_storage'})
            tt = Tab(b, base, clock=clock)
            tt.go('/live-here-now' + slug)
            ids, last, _ = play_round(tt, [True] * 5, 'first five')
            tt.close()
            return ids, last
        a, _ = first_five(T0)
        a2, _ = first_five(T0 + 30 * 60000)
        nxt, _ = first_five(T0 + 3600000)
        check('two phones scanning in the same hour get the same five, so the table plays the same round',
              len(a) == 5 and a == a2 and a == ids1, (a, a2, ids1))
        check('the next hour, a fresh phone gets a different five', len(nxt) == 5 and len(set(nxt) & set(a)) <= 1, (a, nxt))
        lat, _ = first_five(T0 + 5 * 3600000)
        check('and five hours on, different again', len(lat) == 5 and len(set(lat) & set(a)) <= 1 and len(set(lat) & set(nxt)) <= 1, lat)

        print('\nSTORAGE BLOCKED (private mode)')
        tb = Tab(b, base, block_storage=True)
        tb.go('/live-here-now')
        s = wait_question(tb)
        threw = tb.js('(function(){try{localStorage.length;return false;}catch(e){return true;}})()')
        check('with storage throwing, the first question still comes up', threw is True and bool(s.get('id')), (threw, s.get('id')))
        p1, s, _ = play_round(tb, [False] * 5, 'blocked')
        check('it plays to the end: "0/5. Beat the table?"', s.get('score') == '0/5. Beat the table?', s.get('score'))
        tb.tap(s['again']['x'], s['again']['y'])
        p2, s, _ = play_round(tb, [True] * 5, 'blocked again')
        check('and Play again is still five fresh ones, remembered in memory', len(set(p2)) == 5 and not set(p1) & set(p2), (p1, p2))
        check('no script error with storage blocked', not s.get('errs'), s.get('errs'))
        tb.close()

        print('\nTHE NEXT-NIGHT LINE FOR A VENUE')
        for q, want in (('?v=tugun-bowls-club', '/play?venue=tugun-bowls-club'),
                        ('?v=Tugun%20Bowls%20Club', '/play?venue=tugun-bowls-club'),
                        ('?v=', 'https://venueplay.com.au')):
            tv = Tab(b, base)
            tv.go('/live-here-now' + q)
            tv.until('!!document.getElementById("q").getAttribute("data-id")', 15)
            got = tv.js('document.getElementById("nextNight").getAttribute("href")')
            check('%s links the next-night line to %s' % (q, want), got == want, got)
            tv.close()
        check('/play?venue=<slug> is a page in this site (play.html reads the venue through vp-venueurl.js)',
              os.path.isfile(os.path.join(ROOT, 'venueplay', 'play.html'))
              and 'VPVenueURL.slug' in io.open(os.path.join(ROOT, 'venueplay', 'play.html'), encoding='utf-8').read())

        print('\nTHE SMALLEST PHONE (320 x 568)')
        b.call('Storage.clearDataForOrigin', {'origin': base, 'storageTypes': 'local_storage'})
        ts = Tab(b, base, w=320, h=568)
        ts.go('/live-here-now')
        s = wait_question(ts)
        btns = s.get('btns', [])
        check('at 320 px nothing scrolls sideways and the question and all four buttons fit across',
              s.get('sw', 999) <= 320 and s.get('qRight', 999) <= 320 and len(btns) == 4
              and all(x['left'] >= 0 and x['right'] <= 320 and x['h'] >= 56 for x in btns), (s.get('sw'), [(x['left'], x['right'], x['h']) for x in btns]))
        ts.close()

        if A.shots:
            # The picture for a person to look at: a wrong answer, so both colours are on screen.
            b.call('Storage.clearDataForOrigin', {'origin': base, 'storageTypes': 'local_storage'})
            tp = Tab(b, base)
            tp.go('/live-here-now')
            s = wait_question(tp)
            q = BY_ID[s['id']]
            tp.shot(os.path.join(A.shots, 'live-here-now-question-375.png'))
            wrong = s['btns'][(q[3] + 1) % 4]
            tp.tap(wrong['x'], wrong['y'])
            time.sleep(0.25)
            tp.shot(os.path.join(A.shots, 'live-here-now-wrong-375.png'))
            tp.close()
    finally:
        b.close()
        srv.shutdown()


try:
    main()
except Exception as e:
    check('the suite ran to the end', False, repr(e))
print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
