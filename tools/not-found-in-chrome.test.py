#!/usr/bin/env python3
"""THE NOT-FOUND PAGE, OPENED IN A REAL BROWSER AT PHONE WIDTH (venueplay/404.html, 1 Nov 2026).

Dean's phone, 1 Nov 2026: the old page was a small dark card floating in an empty screen, and it
"needs redoing to make it prettier on mobile". Who lands on it: mostly a phone that scanned an old or
wrong QR code, or typed an address off a sign or a coaster. So this opens the REAL 404.html where Pages
serves it, at a missing address (tools/pagesim.py: the real _redirects and a real HTTP 404, at any
depth), in headless Chrome at 320, 375, 390 and 430 wide, and checks what it does:

  - a missing address answers HTTP 404 with this page, one folder deep and four folders deep (the
    soft-200 trap: Pages without a 404.html answers 200 with the homepage), and an address that IS a
    page still answers 200 (the control)
  - at every width: no sideways scroll, nothing off the screen or cut off in its box; the page fills
    the screen (not a card in the middle of nothing); the way into a game, the code box and its Join
    button, is on the first screen
  - the code box: what is typed is cleaned to the game-code alphabet in capitals (play.html's
    CODE_RE), Join goes to /play?code=<CODE> and play.html opens; an empty Join goes nowhere
  - an address that ends in a game code (/HK4P7C, /play/hk4p7c) fills the code in and says so; a word
    that happens to be code-shaped (/venues) does not (the control)
  - the other ways back go where they say, from four folders deep (every link absolute): the
    60-second trivia, the homepage, See a night; the support email; no phone number, no em dash,
    noindex, the new wordmark

    python3 tools/not-found-in-chrome.test.py [--shots DIR]

Nothing leaves this machine: fonts and anything off this machine are blocked in the browser. Chrome
runs under /tmp/vp-heavy.lock (VP_WAIT_LOCK=<seconds> to wait for it).
"""
import argparse, base64, http.client, importlib.util, io, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib, pagesim

ap = argparse.ArgumentParser()
ap.add_argument('--shots', default=os.environ.get('NOT_FOUND_SCREENS', ''))
A = ap.parse_args()

spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
vl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vl)

SITE = os.path.join(ROOT, 'venueplay')
HTML = io.open(os.path.join(SITE, '404.html'), encoding='utf-8').read()
fails = ran = 0


def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    if ok:
        print('  ok   ' + name)
    else:
        fails += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: ' + json.dumps(saw, default=str)[:500]))


def fetch(base, path):
    c = http.client.HTTPConnection(base.split('//', 1)[1], timeout=10)
    c.request('GET', path)
    r = c.getresponse()
    body = r.read().decode('utf-8', 'replace')
    c.close()
    return r.status, body


class Tab(object):
    def __init__(self, b, w, h):
        self.b = b
        self.tid = b.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        self.sid = b.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        b.call('Page.enable', session=self.sid)
        b.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=self.sid)
        b.call('Emulation.setTouchEmulationEnabled', {'enabled': True}, session=self.sid)
        b.call('Network.enable', session=self.sid)
        b.call('Network.setBlockedURLs', {'urls': ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*googletagmanager*',
                                                   '*google-analytics*', '*facebook*', '*workers.dev*', '*venueplay.com.au*']}, session=self.sid)

    def go(self, url):
        self.b.call('Page.navigate', {'url': url}, session=self.sid)
        time.sleep(0.3)

    def js(self, expr):
        r = self.b.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True}, session=self.sid)
        if r.get('exceptionDetails'):
            return None
        return r.get('result', {}).get('value')

    def until(self, expr, secs=15):
        end = time.time() + secs
        while time.time() < end:
            v = self.js(expr)
            if v:
                return v
            time.sleep(0.1)
        return None

    def tap(self, x, y):
        for t in ('touchStart', 'touchEnd'):
            self.b.call('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y}] if t == 'touchStart' else []}, session=self.sid)

    def key(self, text):
        self.b.call('Input.insertText', {'text': text}, session=self.sid)

    def shot(self, path):
        d = self.b.call('Page.captureScreenshot', {'format': 'png'}, session=self.sid)['data']
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(d))

    def close(self):
        self.b.close_tab(self.tid)


LOOK = r'''(function(){
  var vw=innerWidth, vh=innerHeight, out=[], clipped=[];
  Array.prototype.forEach.call(document.querySelectorAll("body *"),function(e){
    if(/^(SCRIPT|STYLE)$/.test(e.tagName)) return;
    var r=e.getBoundingClientRect(); if(!r.width||!r.height) return;
    if(r.left<-0.5||r.right>vw+0.5) out.push((e.id||e.className.baseVal||e.className||e.tagName)+" "+Math.round(r.left)+".."+Math.round(r.right));
    if(/^(BUTTON|A|H1|H2|P|INPUT|LABEL)$/.test(e.tagName) && e.scrollWidth>e.clientWidth+1) clipped.push((e.id||e.className||e.tagName)+" "+e.scrollWidth+">"+e.clientWidth);
  });
  function box(sel){ var e=document.querySelector(sel); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,top:r.top,bottom:r.bottom,left:r.left,right:r.right,w:r.width,h:r.height}; }
  var ways=Array.prototype.map.call(document.querySelectorAll(".ways a"),function(a){var r=a.getBoundingClientRect();return {href:a.getAttribute("href"),text:a.querySelector("b").textContent,x:r.left+r.width/2,y:r.top+r.height/2,h:r.height,bottom:r.bottom};});
  var found=document.getElementById("found");
  return JSON.stringify({vw:vw, vh:vh, sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight, out:out.slice(0,6), clipped:clipped.slice(0,6),
    h1:box("h1"), code:box("#code"), go:box("#go"), ways:ways, foot:box("footer"), mainTop:box(".hero"), lastWay:box(".ways a:last-child"),
    value:document.getElementById("code").value, found:found.hidden?"":found.textContent, title:document.title,
    h1text:document.querySelector("h1").textContent});
})()'''


def look(t):
    v = t.js(LOOK)
    return json.loads(v) if isinstance(v, str) else {}


def main():
    print('THE WORDS AND LINKS ON THE PAGE')
    text = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<!--[\s\S]*?-->', ' ', HTML)
    text = re.sub(r'<[^>]+>', ' ', text)
    check('noindex, so a missing address is never indexed', '<meta name="robots" content="noindex,nofollow">' in HTML)
    check('no em dash, no "roster", no price or offer, no phone number, no workers.dev link',
          u'—' not in HTML and 'roster' not in HTML.lower() and not re.search(r'\$\s?\d|\boffer\b|\bprice', text, re.I)
          and not re.search(r'\b0\d[\s\d]{8,}|\b1[38]00\b|tel:', HTML) and '.dev' not in HTML)
    check('the name is written "venueplay" in what a person reads', 'VenuePlay' not in text and 'venueplay' in text)
    check('the header carries the new wordmark, drawn by tools/sync-brand-mark.py (data-vp-mark="wordmark")',
          'data-vp-mark="wordmark"' in HTML)
    rel = [u for u in re.findall(r'(?:href|src|action)="([^"]+)"', HTML)
           if not u.startswith(('/', 'https://', 'mailto:'))]
    check('every link, script and form address is absolute, because this page is served AT the missing address, at any depth',
          not rel, rel)
    check('the support email is there: "Stuck? Email support@venueplay.com.au"',
          '<a href="mailto:support@venueplay.com.au">support@venueplay.com.au</a>' in HTML and 'Stuck? Email' in text)

    srv, base = pagesim.serve(SITE)
    print('\nWHAT THE HOST ANSWERS')
    for path in ('/qr/old-table-link', '/a/b/c/d', '/HK4P7C'):
        st, body = fetch(base, path)
        check('%s answers a real HTTP 404, with this page and not the homepage' % path,
              st == 404 and body == HTML, (st, body[:80]))
    st, body = fetch(base, '/see-a-night')
    check('control: /see-a-night, a real page, answers 200 with itself', st == 200 and 'not on tonight' not in body, st)

    if not gatelib.hold_lock_or_refuse('not-found-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        check('the heavy lock is free for Chrome', False)
        return
    b = vl.Browser()
    try:
        print('\nFOUR PHONES AT A MISSING ADDRESS')
        for w, h in ((320, 568), (375, 667), (390, 844), (430, 932)):
            t = Tab(b, w, h)
            t.go(base + '/qr/old-table-link')
            t.until('document.readyState==="complete"')
            time.sleep(0.3)
            s = look(t)
            check('%d px: nothing scrolls sideways, nothing sits off the screen or is cut off in its box' % w,
                  s.get('sw', 999) <= w and not s.get('out') and not s.get('clipped'), {k: s.get(k) for k in ('sw', 'out', 'clipped')})
            check('%d px: the code box and Join sit side by side, on the first screen, big enough for a thumb' % w,
                  s.get('code') and s.get('go') and s['code']['bottom'] <= h and s['go']['bottom'] <= h
                  and s['code']['h'] >= 52 and s['go']['h'] >= 52 and s['go']['left'] >= s['code']['right'] and s['go']['right'] <= w,
                  (s.get('code'), s.get('go')))
            check('%d px: the three other ways back, each a full-width row at least 56 px tall' % w,
                  [x['href'] for x in s.get('ways', [])] == ['/live-here-now', '/', '/see-a-night']
                  and all(x['h'] >= 56 for x in s['ways']), [(x['href'], x['h']) for x in s.get('ways', [])])
            if h >= 844:
                # Not a small card in the middle of nothing: the content runs from near the top of the
                # screen to near the bottom, all of it on the first screen.
                check('%d px: the page fills the screen (the content spans at least 80%% of it) and every way back is on it' % w,
                      s['lastWay']['bottom'] <= h and (s['lastWay']['bottom'] - s['mainTop']['top']) >= 0.8 * h - 64,
                      (s['mainTop']['top'], s['lastWay']['bottom'], h))
            check('%d px: the headline is big: "That page is not on tonight."' % w,
                  s.get('h1text') == 'That page is not on tonight.' and s['h1']['h'] >= 90, (s.get('h1text'), s.get('h1')))
            if A.shots:
                t.shot(os.path.join(A.shots, 'not-found-%d.png' % w))
            t.close()

        print('\nJOINING A GAME FROM HERE')
        t = Tab(b, 390, 844)
        t.go(base + '/qr/old-table-link')
        t.until('document.readyState==="complete"')
        s = look(t)
        check('a missing address that is not a code leaves the code box empty and says nothing about a code',
              s.get('value') == '' and s.get('found') == '', (s.get('value'), s.get('found')))
        t.tap(s['go']['x'], s['go']['y'])
        time.sleep(0.6)
        check('Join with nothing typed goes nowhere (still this page)', t.js('location.pathname') == '/qr/old-table-link', t.js('location.href'))
        t.tap(s['code']['x'], s['code']['y'])
        t.key('hk-4p7c!x9')
        v = t.js('document.getElementById("code").value')
        check('typing "hk-4p7c!x9" leaves "HK4P7C": capitals, the game-code alphabet, six at most', v == 'HK4P7C', v)
        t.tap(s['go']['x'], s['go']['y'])
        landed = t.until('location.pathname==="/play" && location.search', 15)
        check('Join goes to /play?code=HK4P7C, and play.html opens there', landed == '?code=HK4P7C'
              and t.until('!!document.getElementById("roomIn")', 15), landed)
        if A.shots:
            t.go(base + '/qr/old-table-link')
            t.until('document.readyState==="complete"')
            time.sleep(0.4)
            t.tap(s['code']['x'], s['code']['y'])
            t.key('HK4P')
            time.sleep(0.3)
            t.shot(os.path.join(A.shots, 'not-found-typing-390.png'))
        t.close()

        print('\nAN ADDRESS THAT ENDS IN A GAME CODE')
        for path, want in (('/HK4P7C', 'HK4P7C'), ('/play/hk4p7c', 'HK4P7C'), ('/venues', ''), ('/hello', '')):
            t = Tab(b, 390, 844)
            t.go(base + path)
            t.until('document.readyState==="complete"')
            s = look(t)
            if want:
                check('%s fills in %s and says "That address looks like a game code: %s. Tap Join."' % (path, want, want),
                      s.get('value') == want and s.get('found') == 'That address looks like a game code: %s. Tap Join.' % want,
                      (s.get('value'), s.get('found')))
                if A.shots and path == '/HK4P7C':
                    t.shot(os.path.join(A.shots, 'not-found-code-390.png'))
            else:
                check('control: %s (a word, not a code) fills nothing in' % path, s.get('value') == '' and s.get('found') == '',
                      (s.get('value'), s.get('found')))
            t.close()

        print('\nTHE WAYS BACK WORK FROM FOUR FOLDERS DEEP')
        for i, (want, mark) in enumerate((('/live-here-now', 'document.getElementById("q")'),
                                          ('/', 'document.querySelector("header .logo")'),
                                          ('/see-a-night', 'document.querySelector("h1")'))):
            t = Tab(b, 390, 844)
            t.go(base + '/a/b/c/d')
            t.until('document.readyState==="complete"')
            s = look(t)
            way = s['ways'][i]
            t.tap(way['x'], way['y'])
            got = t.until('location.pathname===%s && !!(%s) && location.pathname' % (json.dumps(want), mark), 15)
            check('"%s" opens %s' % (way['text'], want), got == want, t.js('location.href'))
            t.close()
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
