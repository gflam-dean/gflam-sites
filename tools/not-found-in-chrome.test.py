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


NO_SOCKETS_OUT = r'''(function () {
  var W = window.WebSocket; if (!W) return;
  function S(u, p) {
    if (!/^wss?:\/\/(127\.0\.0\.1|localhost)[:\/]/.test(String(u))) u = 'ws://127.0.0.1:9/off-this-machine';
    return p === undefined ? new W(u) : new W(u, p);
  }
  S.prototype = W.prototype; S.CONNECTING = 0; S.OPEN = 1; S.CLOSING = 2; S.CLOSED = 3;
  window.WebSocket = S;
})();'''


class Tab(object):
    def __init__(self, b, w, h, mobile=True):
        self.b = b
        self.tid = b.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        self.sid = b.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        b.call('Page.enable', session=self.sid)
        b.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': mobile}, session=self.sid)
        b.call('Emulation.setTouchEmulationEnabled', {'enabled': mobile}, session=self.sid)
        b.call('Network.enable', session=self.sid)
        b.call('Network.setBlockedURLs', {'urls': ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*googletagmanager*',
                                                   '*google-analytics*', '*facebook*', '*workers.dev*', '*venueplay.com.au*',
                                                   '*supabase.co*']}, session=self.sid)
        # A blocked URL list does not stop a WebSocket: play.html (where Join lands) opened the LIVE database's realtime
        # socket (tools/nolive.py, 16 Nov 2026). Any socket to an address off this machine goes to a closed local port
        # instead, so the page sees what an offline phone sees and nothing leaves.
        b.call('Page.addScriptToEvaluateOnNewDocument', {'source': NO_SOCKETS_OUT}, session=self.sid)

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
  var ways=Array.prototype.map.call(document.querySelectorAll(".ways a"),function(a){var r=a.getBoundingClientRect();return {href:a.getAttribute("href"),text:a.querySelector("b").textContent,x:r.left+r.width/2,y:r.top+r.height/2,h:r.height,top:r.top,bottom:r.bottom};});
  var lg=document.querySelector("header img"), lr=lg&&lg.getBoundingClientRect(), lede=document.querySelector(".lede"), lcs=lede&&getComputedStyle(lede).display!=="none";
  var found=document.getElementById("found");
  return JSON.stringify({vw:vw, vh:vh, sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight, out:out.slice(0,6), clipped:clipped.slice(0,6),
    h1:box("h1"), code:box("#code"), go:box("#go"), ways:ways, foot:box("footer"), join:box("#join"), lede:lcs?box(".lede"):null, logo:lg?{nat:lg.naturalWidth,h:lr.height,w:lr.width,left:lr.left}:null, mainTop:box(".hero"), lastWay:box(".ways a:last-child"),
    value:document.getElementById("code").value, found:found.hidden?"":found.textContent, title:document.title,
    h1text:document.querySelector("h1").textContent,h1fs:parseFloat(getComputedStyle(document.querySelector("h1")).fontSize)});
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
    # BRAND v3.2 / THE NEW LOOK (13 Nov 2026, INBOX 341): the real logo FILE, no spaced mono eyebrow, no v2 neon triangle.
    logo = re.search(r'<header>[\s\S]*?<img src="(/logos/[^"]+\.svg)"[^>]*alt="venueplay"', HTML)
    check('the header carries the supplied logo FILE (an img of /logos/venueplay-primary.svg), not a retyped or hand-drawn wordmark',
          bool(logo) and logo.group(1) == '/logos/venueplay-primary.svg' and os.path.exists(SITE + logo.group(1)) and 'data-vp-mark' not in HTML, logo and logo.group(1))
    kit = os.path.expanduser('~/venue-enrich/logo-kit-1nov/vector/venueplay-horizontal-on-dark.svg')
    if os.path.exists(kit):
        kd = re.findall(r' d="([^"]+)"', io.open(kit, encoding='utf-8').read())
        sd = re.findall(r' d="([^"]+)"', io.open(SITE + '/logos/venueplay-primary.svg', encoding='utf-8').read())
        check('that file IS the logo kit horizontal-on-dark artwork (same letters, same pink triangle)', kd == sd and len(kd) >= 2, (len(kd), len(sd)))
    body_text = re.sub(r'<[^>]+>', ' ', re.sub(r'<head>[\s\S]*?</head>|<script[\s\S]*?</script>|<style[\s\S]*?</style>|<!--[\s\S]*?-->', ' ', HTML))
    check('no "404 · Page not found" eyebrow: no eyebrow class, no mono caps line, no "404" or "Page not found" in what a person reads',
          'eyebrow' not in HTML and not re.search(r'\b404\b|page not found', body_text, re.I), body_text[:200])
    check('no v2 neon triangle (no .neon svg, no flicker animation) and no gradient on the page',
          'class="neon"' not in HTML and 'flicker' not in HTML and 'gradient' not in re.sub(r'/\*[\s\S]*?\*/', '', HTML), None)
    check('new-look type only: Anton headline, Manrope body, JetBrains Mono for the code box, no Hanken (that is TV body)',
          'Anton' in HTML and 'Manrope' in HTML and 'Hanken' not in HTML, None)
    lhn = io.open(os.path.join(SITE, 'live-here-now.html'), encoding='utf-8').read()
    check('wording matches the coaster page (INBOX 396: its name is Coaster Trivia, 5 questions, never "60 seconds")',
          'Play Coaster Trivia' in HTML and 'Five quick questions' in HTML and '60 seconds' not in HTML and 'Coaster Trivia' in lhn, None)
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
                  and s['code']['h'] >= 48 and s['go']['h'] >= 48 and s['go']['left'] >= s['code']['right'] and s['go']['right'] <= w,
                  (s.get('code'), s.get('go')))
            check('%d px: the two other ways back, each a full-width row at least 50 px tall' % w,
                  [x['href'] for x in s.get('ways', [])] == ['/live-here-now', '/']
                  and all(x['h'] >= 50 for x in s['ways']), [(x['href'], x['h']) for x in s.get('ways', [])])
            check('%dx%d: ONE SCREEN, no scroll: the whole page (support line too) fits, the document is no taller than the screen' % (w, h),
                  s.get('sh', 9999) <= h and s['foot']['bottom'] <= h + 0.5 and s['lastWay']['bottom'] <= h, (s.get('sh'), s['foot'], s['lastWay']['bottom']))
            check('%dx%d: spacing: the gaps between headline, code box and the rows are 6 to 40 px, the support line sits under the last row' % (w, h),
                  all(6 <= g <= 40 for g in (s['join']['top'] - (s['lede']['bottom'] if s.get('lede') else s['h1']['bottom']),
                                             s['ways'][0]['top'] - s['join']['bottom'], s['ways'][1]['top'] - s['ways'][0]['bottom'])) and s['foot']['top'] >= s['lastWay']['bottom'],
                  (s['h1'], s.get('lede'), s['join'], [(x['top'], x['bottom']) for x in s['ways']], s['foot']))
            check('%dx%d: the real logo file is painted at a readable size (at least 20 px tall, 90 px wide), top left' % (w, h),
                  s['logo'] and s['logo']['nat'] > 0 and s['logo']['h'] >= 20 and s['logo']['w'] >= 90 and s['logo']['left'] <= 24, s.get('logo'))
            # 16 Nov 2026: judged by the type size (34 px floor, the page's clamp), not the box height: with the real Anton
            # (or Impact) it is two lines, 65 px; only a box with no Anton/Impact falls back wider, wraps to three and passed 70.
            check('%d px: the headline is big: "That page is not on tonight." (type at least 34 px)' % w,
                  s.get('h1text') == 'That page is not on tonight.' and (s.get('h1fs') or 0) >= 34, (s.get('h1text'), s.get('h1fs'), s.get('h1')))
            if A.shots:
                t.shot(os.path.join(A.shots, 'not-found-%d.png' % w))
            t.close()

        print('\nIPAD AND LAPTOP: still one screen, still filled and centred')
        for w, h, mob in ((768, 1024, True), (1024, 768, True), (1366, 768, False), (1920, 1080, False)):
            t = Tab(b, w, h, mob)
            t.go(base + '/qr/old-table-link')
            t.until('document.readyState==="complete"')
            time.sleep(0.3)
            s = look(t)
            check('%dx%d: ONE SCREEN, no scroll, nothing sideways or cut off, the logo and the support line both on it' % (w, h),
                  s.get('sh', 9999) <= h and s.get('sw', 9999) <= w and not s.get('out') and not s.get('clipped') and s['foot']['bottom'] <= h + 0.5
                  and s['logo']['nat'] > 0, {k: s.get(k) for k in ('sh', 'sw', 'out', 'clipped')})
            check('%dx%d: the content is a column in the middle, not stretched across the screen (under 600 px wide, centred)' % (w, h),
                  s['join']['w'] <= 600 and abs((s['join']['left'] + s['join']['right']) / 2 - w / 2) <= 2, s['join'])
            if A.shots:
                t.shot(os.path.join(A.shots, 'not-found-%dx%d.png' % (w, h)))
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
        for i, (want, mark) in enumerate((('/live-here-now', 'document.getElementById("vWhere") && !document.getElementById("vWhere").hidden && document.getElementById("vName").hidden && document.getElementById("whereIn")'),
                                          ('/', 'document.querySelector("header .logo")'))):
            t = Tab(b, 390, 844)
            t.go(base + '/a/b/c/d')
            t.until('document.readyState==="complete"')
            s = look(t)
            way = s['ways'][i]
            t.tap(way['x'], way['y'])
            got = t.until('location.pathname===%s && !!(%s) && location.pathname' % (json.dumps(want), mark), 15)
            check('"%s" opens %s' % (way['text'], want), got == want, t.js('location.href'))
            if want == '/live-here-now':
                # INBOX 344 / 309.1a: the 404's trivia link lands on the VENUE step ("What venue are you at?", the type-ahead), never a name-first screen
                time.sleep(1.0)
                st = t.js('JSON.stringify({where:!document.getElementById("vWhere").hidden, name:!document.getElementById("vName").hidden, play:!document.getElementById("vPlay").hidden, input:!!document.getElementById("whereIn").offsetParent, nameInput:!!document.getElementById("nameIn").offsetParent, h1:(document.getElementById("whereHead")||{}).textContent})')
                st = json.loads(st) if st else {}
                check('the 404 trivia link lands on the VENUE step first (type-ahead shown), and never on a name-first screen',
                      st.get('where') and st.get('input') and not st.get('name') and not st.get('nameInput') and not st.get('play'), st)
                check('...and that step asks "What venue are you at?" (INBOX 344/309.1a)', st.get('h1') == 'What venue are you at?', st.get('h1'))
                if A.shots:
                    t.shot(os.path.join(A.shots, 'not-found-lands-on-venue-step-390.png'))
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
