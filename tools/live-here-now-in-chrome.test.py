#!/usr/bin/env python3
"""THE DRINK-COASTER PAGE, PLAYED IN A REAL BROWSER AT PHONE WIDTH (/live-here-now, 31 Oct 2026;
finished 1 Nov 2026 for the Mon 2 Nov release: the coaster reads "Scan for 60 seconds of trivia while
you wait for your drink", and venueplay.com.au/here is the short address printed under the QR).

Dean's brief: "Opens straight into a question. No name, no sign-up, no room code. Four big buttons,
tap to answer, instant right/wrong in pink or yellow. Five questions per scan, then a score screen:
'4/5. Beat the table?' with a 'Play again' button and a 'Find out when the next trivia night is'
line ... The question bank changes every hour automatically, and the phone remembers which
questions it has already shown, so the same person scanning again gets fresh ones."

Every one of those is a thing the page DOES, so this opens the real venueplay/live-here-now.html,
served from this checkout the way Cloudflare Pages serves it (tools/pagesim.py: clean addresses, the
real _redirects, the real 404.html), in headless Chrome as a phone, and plays it by tapping the screen:

  - /here (the short address on the coaster) and /live answer 301 to /live-here-now (the real
    _redirects lines), and a phone that types /here lands on the game

  - the first question is up with nothing typed: no input anywhere, four buttons a thumb can hit,
    no sideways scroll, and the same at 320 px
  - a right tap paints the button PINK and says so; a wrong tap paints it YELLOW and shows the
    right one in pink; a second tap on an answered question changes nothing
  - five questions, then "3/5. Beat the table?", how long it took, Play again, "Game on the TV?
    Join it", and the soft call to action: "Want this on the big screen? ... Ask the bar." with a
    light "Run a venue?" link to the homepage. No price, no offer, no phone number, no form
  - at 320, 375, 390 and 430 wide: no sideways scroll, every button and line inside the screen and
    nothing cut off inside its own box, on the question and on the score
  - Play again: five more, none of them seen. A fresh scan (reload) in the same hour: five more again
  - two phones in the same hour get the same five (a fair "Beat the table?"); the next hour, a
    different five. The clock is pinned inside the page, never read from this machine
  - storage blocked (private mode): still plays, and Play again is still fresh
  - ?v=<slug> sends "Game on the TV? Join it" to that venue's page, /play?venue=<slug>; none, to
    /play (type the code from the TV)
  - the question file is the build script's output exactly, every question traces to an easy
    "VenuePlay Original" in the trivia bank, and it is small enough for pub wifi

Nothing leaves this machine: fonts and analytics are blocked in the browser. The page loads the
site's analytics (vp-analytics.js) and nothing else that counts people: no Meta pixel, no form.
Chrome runs under /tmp/vp-heavy.lock (VP_WAIT_LOCK=<seconds> to wait for it).

    python3 tools/live-here-now-in-chrome.test.py [--shots DIR]
"""
import argparse, base64, http.client, importlib.util, io, json, os, re, sys, time

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
PINK, GOLD = 'rgb(255, 31, 142)', 'rgb(255, 194, 75)'
HOUR = 491234          # a fixed hour (Sep 2026), never this machine's clock
T0 = HOUR * 3600000 + 20 * 60000


def serve(folder):
    return pagesim.serve(folder)


def no_follow(base, path):
    """(status, Location) for one GET, redirects NOT followed."""
    host = base.split('//', 1)[1]
    c = http.client.HTTPConnection(host, timeout=10)
    c.request('GET', path)
    r = c.getresponse()
    r.read()
    c.close()
    return r.status, r.getheader('Location')


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
    count:document.getElementById("count").textContent.replace(/\s+/g," ").trim(), verdict:document.getElementById("verdict").textContent,
    verdictColor:getComputedStyle(document.getElementById("verdict")).color,
    score:sc.hidden?"":document.getElementById("scoreLine").textContent.replace(/\s+/g," ").trim(),
    scoreShown:!sc.hidden && sc.getBoundingClientRect().height>0,
    again:(function(){var a=document.getElementById("again"),r=a.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,shown:!sc.hidden};})(),
    next:document.getElementById("joinGame").getAttribute("href"), nextText:document.getElementById("joinGame").textContent,
    sub:document.getElementById("scoreSub").textContent, clock:document.getElementById("clock").textContent,
    failed:!document.getElementById("failed").hidden,
    inputs:document.querySelectorAll("input,textarea,select").length,
    vw:innerWidth, sw:document.documentElement.scrollWidth, errs:window.__errs||[]});
})()'''


FIT = r'''(function(){
  var vw=innerWidth, out=[], clipped=[];
  Array.prototype.forEach.call(document.querySelectorAll("header *, main *, footer *"),function(e){
    var r=e.getBoundingClientRect(); if(!r.width||!r.height) return;
    var cs=getComputedStyle(e); if(cs.visibility==="hidden") return;
    if(r.left<-0.5||r.right>vw+0.5) out.push((e.id||e.className||e.tagName)+" "+Math.round(r.left)+".."+Math.round(r.right));
    if(/^(BUTTON|A|H1|H2|P|SPAN)$/.test(e.tagName) && e.scrollWidth>e.clientWidth+1 && cs.overflow!=="visible")
      clipped.push((e.id||e.className||e.tagName)+" "+e.scrollWidth+">"+e.clientWidth);
    if(/^(BUTTON|A)$/.test(e.tagName) && e.scrollWidth>e.clientWidth+1) clipped.push((e.id||e.className||e.tagName)+" text wider than its button");
  });
  var big=document.querySelector(".bigscreen"), bb=big?big.getBoundingClientRect():null;
  return JSON.stringify({sw:document.documentElement.scrollWidth, out:out.slice(0,6), clipped:clipped.slice(0,6),
    bigBottom: bb && bb.height ? bb.bottom : -1});
})()'''


def state(t):
    v = t.js(STATE)
    return json.loads(v) if isinstance(v, str) else {'__bad': v}


def clear_storage(b, base, seen=None):
    """Forget what this phone has seen, from a page of the same site (Storage.clearDataForOrigin
       answered "Internal error" on this Chrome, 1 Nov 2026, and so cleared nothing)."""
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
                time.sleep(0.3)          # the colour fades in over 0.12 s: read it once it has landed
                after = state(t)
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
          and not re.search(r'\b0\d(?:[ -]?\d){8}\b|tel:', text + HTML), re.findall(r'.{20}(?:—|\$\d|offer|0\d \d{4}).{20}', HTML)[:3])
    check('the soft call to action is on the page, for the room and then for an owner: "Want this on the big screen?", '
          '"Ask the bar.", "Run a venue? See how it works" to the homepage',
          'Want this on the big screen?' in text and 'Ask the bar.' in text
          and re.search(r'<a class="owner" id="ownerLink" href="/">Run a venue\? See how it works</a>', HTML) is not None)
    check('nothing on the page collects anything: no form, no input, no Meta pixel; analytics is the site\'s own vp-analytics.js',
          not re.search(r'<(form|input|textarea|select)\b', HTML) and 'vp-pixel' not in HTML and 'fbq(' not in HTML
          and '<script src="/app/vp-analytics.js" defer></script>' in HTML)
    check('the name is written "venueplay" in what a punter reads, the copyright line too ("trading as venueplay", Dean, 4 Nov 2026)',
          'VenuePlay' not in text and 'venueplay' in text and 'trading as venueplay' in text)
    check('the header carries the new wordmark, drawn by tools/sync-brand-mark.py (data-vp-mark="wordmark")',
          'data-vp-mark="wordmark"' in HTML and 'href="/" aria-label="venueplay home"' in HTML)
    red = [l.split() for l in io.open(os.path.join(ROOT, 'venueplay', '_redirects'), encoding='utf-8').read().splitlines()
           if l.strip() and not l.lstrip().startswith('#')]
    check('_redirects sends /here (and /here.html), the address printed on the coaster, to /live-here-now with a 301',
          ['/here', '/live-here-now', '301'] in red and ['/here.html', '/live-here-now', '301'] in red, [r for r in red if 'here' in ' '.join(r)])
    check('and /live (and /live.html), the other spelling people try, with a 301 too',
          ['/live', '/live-here-now', '301'] in red and ['/live.html', '/live-here-now', '301'] in red, [r for r in red if 'live' in ' '.join(r)])
    sm = io.open(os.path.join(ROOT, 'venueplay', 'sitemap.xml'), encoding='utf-8').read()
    check('the sitemap lists https://venueplay.com.au/live-here-now', '<loc>https://venueplay.com.au/live-here-now</loc>' in sm)

    srv, base = serve(os.path.join(ROOT, 'venueplay'))
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
        tl = Tab(b, base, w=390, h=844)
        tl.go('/here')
        landed = tl.until('document.getElementById("q").getAttribute("data-id") && location.pathname', 15)
        check('a phone that types venueplay.com.au/here lands on /live-here-now with a question up', landed == '/live-here-now', landed)
        tl.close()

        print('\nA PHONE SCANS THE COASTER (375 x 740)')
        t = Tab(b, base)
        clear_storage(b, base)
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
        check('"Game on the TV? Join it" goes to /play (type the code from the TV) when the coaster names no venue',
              s.get('next') == '/play' and s.get('nextText') == 'Game on the TV? Join it', s.get('next'))
        check('the score says how long the round took: "Done in N seconds." (the clock counts up, never down)',
              re.match(r'^Done in \d+ seconds?\. ', s.get('sub') or '') is not None, s.get('sub'))
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
            clear_storage(b, base)
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

        print('\n"GAME ON THE TV? JOIN IT" FOR A VENUE')
        for q, want in (('?v=tugun-bowls-club', '/play?venue=tugun-bowls-club'),
                        ('?v=Tugun%20Bowls%20Club', '/play?venue=tugun-bowls-club'),
                        ('?v=', '/play')):
            tv = Tab(b, base)
            tv.go('/live-here-now' + q)
            tv.until('!!document.getElementById("q").getAttribute("data-id")', 15)
            got = tv.js('document.getElementById("joinGame").getAttribute("href")')
            check('%s links "Game on the TV? Join it" to %s' % (q, want), got == want, got)
            tv.close()
        check('/play?venue=<slug> is a page in this site (play.html reads the venue through vp-venueurl.js)',
              os.path.isfile(os.path.join(ROOT, 'venueplay', 'play.html'))
              and 'VPVenueURL.slug' in io.open(os.path.join(ROOT, 'venueplay', 'play.html'), encoding='utf-8').read())

        print('\nFOUR PHONES: 320, 375, 390 AND 430 WIDE')
        # The question with the LONGEST answer in the file comes up first at every width: the phone is
        # told it has seen every other one, so the hour's order has to start with it. A short random
        # set would let a layout that only fails on long answers through.
        LONG = max(BANK['q'], key=lambda q: max(len(o) for o in q[2]))
        others = [q[0] for q in BANK['q'] if q[0] != LONG[0]]
        for w, h in ((320, 568), (375, 667), (390, 844), (430, 932)):
            clear_storage(b, base, seen=others)
            tf = Tab(b, base, w=w, h=h)
            tf.go('/live-here-now')
            s = wait_question(tf)
            btns = s.get('btns', [])
            check('%d px: the first question is the one with the longest answer ("%s")' % (w, max(LONG[2], key=len)),
                  s.get('id') == LONG[0], s.get('id'))
            f = waits.as_json(tf.js(FIT), {}, 'FIT')
            check('%d px, a question: nothing scrolls sideways, nothing sits off the screen or is cut off in its box' % w,
                  f['sw'] <= w and not f['out'] and not f['clipped'], f)
            check('%d px: four answer buttons a thumb can hit (56 px tall or more, the full width less the margins)' % w,
                  len(btns) == 4 and all(x['h'] >= 56 and x['w'] >= w - 40 and x['left'] >= 0 and x['right'] <= w for x in btns),
                  [(round(x['left']), round(x['right']), round(x['h'])) for x in btns])
            if h >= 667:
                check('%d px: the question and all four answers are on the first screen, no scrolling to answer' % w,
                      all(x['bottom'] <= h for x in btns), [round(x['bottom']) for x in btns])
            _, s, _ = play_round(tf, [True, False, True, True, False], 'fit %d' % w)
            f = waits.as_json(tf.js(FIT), {}, 'FIT')
            check('%d px, the score: "3/5. Beat the table?", nothing sideways, nothing off the screen or cut off' % w,
                  s.get('score') == '3/5. Beat the table?' and f['sw'] <= w and not f['out'] and not f['clipped'], (s.get('score'), f))
            if h >= 844:
                check('%d px: Play again and "Want this on the big screen?" are both on the first screen of the score' % w,
                      0 < s['again']['y'] < h and f['bigBottom'] <= h, (s['again'], f['bigBottom']))
            if A.shots and w in (320, 430):
                time.sleep(0.5)      # the score fades in over 0.35 s
                tf.shot(os.path.join(A.shots, 'live-here-now-score-%d.png' % w))
            tf.close()

        if A.shots:
            # The picture for a person to look at: a wrong answer, so both colours are on screen.
            clear_storage(b, base)
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
