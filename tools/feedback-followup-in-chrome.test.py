#!/usr/bin/env python3
"""THE PLAYER'S FEEDBACK FOLLOW-UP, AS CHROME PAINTS IT ON EVERY PLAYER PHONE (Dean, 1 and 2 Nov 2026; 6 Nov 2026).

Opens the REAL bingo /play, musical bingo /app/musical/play and trivia /app/trivia/play pages, served from this
checkout, at 390x664 and 375x667, puts each on its own end-of-game screen (bingo and musical "vLost", trivia "vFinal")
and asks "How was that?" the way the page's own askHowItWent() does (VPFeedback.ask with the page's mount and format).
A stand-in game Worker answers POST /feedback with the rating's id, as the real one does on this branch, and a
stand-in billing Worker keeps what POST /help/feedback is sent.

For each phone and width, for Good (Dean, 6 Nov 2026: he tapped the middle rating and got no follow-up) and for Not
for me and Loved it on the 390 phone:
  - tapping the rating opens the follow-up: the question, the chips, the optional line, "Only the venueplay team
    reads this.", No thanks and Send
  - Good and Not for me carry the ONE tick, "venueplay can email me about this feedback (only about this)",
    unticked, the email box hidden until it is ticked; Loved it has no tick at all
  - nothing is wider than the phone (no sideways scroll), every chip and button is inside the screen and at
    least 36px tall, the line is readable (14px)
  - Send posts once to /help/feedback with the rating's id, the chip, the line, and the email only when ticked
The mock-ups: ~/venue-enrich/reports/player-screens-2nov/bingo-feedback-*.png.

How the screen is reached: the end view is shown by its class (the game itself is not played) and the ask is the
page's own one-line call; tools/test-feedback-form.js holds that each page loads vp-feedback.js and makes it.

VP_ROOT=<another checkout> serves that one instead (the "before" frames); VP_SHOTS=<dir> writes every frame;
VP_SHOTS_ONLY=1 takes the frames with no checks. Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait).

    python3 tools/feedback-followup-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.environ.get('VP_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(HERE, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS', '')
CHECKS = not os.environ.get('VP_SHOTS_ONLY')
HELP_POSTS = []

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    if not CHECKS: return
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def j(self, obj, code=200): return self.send(code, json.dumps(obj), 'application/json')
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); raw = self.rfile.read(n)
        u = urllib.parse.urlparse(self.path)
        try: body = json.loads(raw or b'{}')
        except Exception: body = {}
        if u.path == '/__worker/feedback':
            return self.j({'ok': True, 'id': 'f0000000-0000-4000-8000-0000000000%02d' % (int(body.get('rating') or 0))})
        if u.path == '/__help/help/feedback':
            HELP_POSTS.append(body); return self.j({'ok': True})
        if u.path.startswith('/__worker') or u.path.startswith('/__help'): return self.j({})
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker') or u.path.startswith('/__help'): return self.j({})
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB={};window.__FAKE_SIGNED_IN=false;window.__FAKE_UID="x";\n'
            return self.send(200, pre + io.open(os.path.join(HERE, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        p = u.path
        if p.endswith('/'): p += 'index'
        if not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js')
            t = t.replace('https://game.venueplay.com.au', '/__worker')
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


class Page(object):
    def __init__(self, B, url, w, h):
        self.B = B
        self.tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        self.sid = B.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        B.call('Page.enable', {}, session=self.sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2 if SHOTS else 1, 'mobile': True}, session=self.sid)
        B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.VP_HELP_API="/__help";try{localStorage.clear()}catch(e){}'}, session=self.sid)
        B.call('Page.navigate', {'url': url}, session=self.sid)
    def js(self, expr, wait=20):
        r = self.B.evaluate(self.sid, expr, wait)
        return r and r.get('result', {}).get('value')
    def obj(self, expr):
        v = self.js(expr)
        try: return json.loads(v) if isinstance(v, str) else v
        except Exception: return None
    def until(self, expr, secs=20):
        end = time.time() + secs
        while time.time() < end:
            if self.js('!!(' + expr + ')'): return True
            time.sleep(0.25)
        return False
    def shot(self, name):
        if not SHOTS: return
        time.sleep(0.4)
        png = base64.b64decode(self.B.call('Page.captureScreenshot', {'format': 'png'}, session=self.sid)['data'])
        open(os.path.join(SHOTS, name + '.png'), 'wb').write(png)
    def close(self): self.B.close_tab(self.tid)


PHONES = [  # (name, path, end view, format, the page's own ask arguments)
    ('bingo', '/play?code=ACDEFG', 'vLost', 'bingo', '{ api:"/__worker", code:"ACDEFG", mount:"vLost", key:"ACDEFG:2026-11-06", format:"bingo" }'),
    ('musical', '/app/musical/play?code=QWERTY', 'vLost', 'musical', '{ api:"/__worker", code:"QWERTY", mount:"vLost", gameId:"g-mus", format:"musical" }'),
    ('trivia', '/app/trivia/play?code=ZXCVBN', 'vFinal', 'trivia', '{ api:"/__worker", code:"ZXCVBN", mount:"vFinal", gameId:"g-triv", format:"trivia" }'),
]
WORD = {3: 'Loved it', 2: 'Good', 1: 'Not for me'}
ASK = {3: 'What did you love?', 2: 'What would make it better?', 1: 'Sorry to hear that. What went wrong?'}

MEASURE = r'''(function(){
  var fb=document.querySelector(".vpfb"), more=fb&&fb.querySelector(".more"); if(!more) return JSON.stringify({ more:false, text: fb?fb.textContent:"" });
  var W=window.innerWidth, out=[], de=document.documentElement;
  [].forEach.call(more.querySelectorAll("button,textarea,label.tick"), function(e){ var r=e.getBoundingClientRect(); if(r.width) out.push({ t:(e.textContent||e.tagName).trim().slice(0,40), l:Math.round(r.left), r:Math.round(r.right), h:Math.round(r.height) }); });
  var q=more.querySelector(".q"), who=more.querySelector(".who"), ticks=more.querySelectorAll("input[type=checkbox]"), em=more.querySelector("input[type=email]"), ta=more.querySelector("textarea");
  return JSON.stringify({ more:true, W:W, sw:Math.max(de.scrollWidth, document.body.scrollWidth), q:q&&q.textContent, who:who&&who.textContent,
    chips:[].map.call(more.querySelectorAll(".chips button"), function(b){ return b.textContent; }),
    ticks:ticks.length, ticked: ticks.length?ticks[0].checked:null, tickWords: (more.querySelector("label.tick")||{}).textContent||"",
    emailShown: !!(em && em.getBoundingClientRect().height>0), taFont: ta?parseFloat(getComputedStyle(ta).fontSize):0,
    hasNoThanks: /No thanks/.test(more.textContent), hasSend: /Send/.test(more.textContent), els: out });
})()'''


def run_phone(B, base, name, path, view, fmt, args, w, h, rating, tag):
    P = Page(B, base + path, w, h)
    try:
        if not P.until('window.VPFeedback && document.getElementById("%s")' % view, 40):
            ok('%s %dx%d: the page loads with the feedback form script' % (name, w, h), False, P.js('location.href'))
            return
        P.js('(function(){ [].forEach.call(document.querySelectorAll(".view"), function(v){ v.classList.add("hidden"); });'
             ' var v=document.getElementById("%s"); v.classList.remove("hidden"); v.style.display=""; window.scrollTo(0,0);'
             ' VPFeedback.ask(%s); return 1; })()' % (view, args))
        P.until('document.querySelector(".vpfb button[data-rate]") || document.querySelector(".vpfb button")', 10)
        P.js('(function(){ var f=document.querySelector(".vpfb"); if(f) f.scrollIntoView({block:"center"}); })()')
        P.shot('%s-%s-%d-1-asked' % (tag, name, w))
        P.js('(function(){ var b=[].filter.call(document.querySelectorAll(".vpfb button"), function(x){ return x.getAttribute("aria-label")==="%s"; })[0]; if(b) b.click(); })()' % WORD[rating])
        opened = P.until('document.querySelector(".vpfb .more")', 10)
        P.js('(function(){ var f=document.querySelector(".vpfb"); if(f) f.scrollIntoView({block:"start"}); window.scrollBy(0,-90); })()')
        P.shot('%s-%s-%d-2-%s' % (tag, name, w, WORD[rating].lower().replace(' ', '')))
        if not CHECKS: return
        lab = '%s %dx%d, %s:' % (name, w, h, WORD[rating])
        ok(lab + ' tapping it opens the follow-up', opened, P.js('document.querySelector(".vpfb") && document.querySelector(".vpfb").textContent'))
        if not opened: return
        m = P.obj(MEASURE) or {}
        ok(lab + ' it asks "%s"' % ASK[rating], m.get('q') == ASK[rating], m.get('q'))
        ok(lab + ' its chips, an optional line, No thanks and Send', len(m.get('chips') or []) >= 5 and m.get('hasNoThanks') and m.get('hasSend'), m)
        ok(lab + ' "Only the venueplay team reads this."', m.get('who') == 'Only the venueplay team reads this.', m.get('who'))
        if rating == 3:
            ok(lab + ' no tick at all', m.get('ticks') == 0, m.get('ticks'))
        else:
            ok(lab + ' one tick, unticked: "venueplay can email me about this feedback (only about this)", its email box hidden',
               m.get('ticks') == 1 and m.get('ticked') is False and m.get('tickWords') == 'venueplay can email me about this feedback (only about this)' and not m.get('emailShown'), m)
        ok(lab + ' nothing wider than the phone (no sideways scroll)', m.get('sw', 9999) <= m.get('W', 0), [m.get('sw'), m.get('W')])
        outside = [e for e in m.get('els', []) if e['l'] < 0 or e['r'] > m.get('W', 0)]
        ok(lab + ' every chip, button and box sits inside the screen', not outside, outside)
        short = [e for e in m.get('els', []) if e['t'] and e['h'] < 36 and e['t'] != 'TEXTAREA']
        ok(lab + ' every chip and button is at least 36px tall', not short, short)
        ok(lab + ' the line is 14px', m.get('taFont') == 14, m.get('taFont'))
        # fill it in and send
        del HELP_POSTS[:]
        P.js('(function(){ var more=document.querySelector(".vpfb .more"); more.querySelectorAll(".chips button")[0].click();'
             ' var ta=more.querySelector("textarea"); ta.value="Loud speakers"; ta.dispatchEvent(new Event("input"));'
             ' var t=more.querySelector("input[type=checkbox]"); if(t){ t.click(); var e=more.querySelector("input[type=email]"); e.value="sam@example.com"; }'
             ' return 1; })()')
        if rating != 3:
            em = P.obj('JSON.stringify({ shown: document.querySelector(".vpfb input[type=email]").getBoundingClientRect().height>0 })') or {}
            ok(lab + ' ticked, the email box shows', em.get('shown') is True, em)
            P.shot('%s-%s-%d-3-%s-ticked' % (tag, name, w, WORD[rating].lower().replace(' ', '')))
        P.js('(function(){ var b=[].filter.call(document.querySelectorAll(".vpfb .acts button"), function(x){ return x.textContent==="Send"; })[0]; b.click(); })()')
        end = time.time() + 10
        while time.time() < end and not HELP_POSTS: time.sleep(0.2)
        b = HELP_POSTS[0] if HELP_POSTS else {}
        ok(lab + ' Send posts once to /help/feedback, against the rating, with the chip and the line',
           len(HELP_POSTS) == 1 and b.get('feedback_id', '').endswith('%02d' % rating) and len(b.get('tags') or []) == 1 and b.get('note') == 'Loud speakers', HELP_POSTS)
        if rating == 3: ok(lab + ' no email travels', 'email' not in b and b.get('consent') is False, b)
        else: ok(lab + ' the email travels because it was ticked', b.get('email') == 'sam@example.com' and b.get('consent') is True, b)
        ok(lab + ' then a thank you', P.until('document.querySelector(".vpfb .thanks")', 5), P.js('document.querySelector(".vpfb").textContent'))
    finally:
        P.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('feedback-followup-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    tag = os.environ.get('VP_SHOT_TAG', 'after')
    B = VL.Browser()
    try:
        for (name, path, view, fmt, args) in PHONES:
            for (w, h) in ((390, 664), (375, 667)):
                run_phone(B, base, name, path, view, fmt, args, w, h, 2, tag)
            run_phone(B, base, name, path, view, fmt, args, 390, 664, 1, tag)
            run_phone(B, base, name, path, view, fmt, args, 390, 664, 3, tag)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
