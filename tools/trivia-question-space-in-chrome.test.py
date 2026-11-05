#!/usr/bin/env python3
"""THE FINAL TRIVIA WALL, AS CHROME PAINTS IT: THE QUESTION ON THE RING'S CENTRE LINE (Dean, 5 Nov 2026).

Dean's final layout (reports/fb-cover-6nov/layout/LAYOUT-FINAL.css and FINAL-LAYOUT-*.png, INBOX items 22, 23):
the timer ring full size and moved up so the gap from the venueplay logo to the ring equals the gap from the
ring to the answers; the question, one, two or more lines, centred on the ring's centre line; the answers at
a fixed spot a normal gap under the ring; "Question N of 20" under the answers on the right; the countdown and
the reveal in identical positions.

This opens the REAL app/trivia/screen.html in its own sales-page demo (?demo=1&sting=0), served from this
checkout, on Chrome's virtual clock, at 1920x1080 and 1280x720, three times:

  ONE LINE    the demo's first question swapped for a short one by this test's server (?q1=short)
  TWO LINES   the demo as shipped (its first question runs to two lines on the wall)
  LONG        the library's longest question (188 characters, ?q1=long): three or more lines

and measures the painted text (a Range over the question's text node), the visible ring (the circle plus
half its stroke), the venueplay corner logo, the four answer cards and "Question N of 20", on the countdown
and on the reveal.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/trivia-question-space-in-chrome.test.py      screenshots go to $VP_SHOTS if set
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS', '')

# The demo's first question, and the short one this test swaps in for it. The swap must find its line:
# a test whose fixture silently fails to apply would measure the two-line question twice and pass.
DEMO_Q1 = '{ text:"Which Australian city hosted the 2000 Summer Olympics?",'
SHORT_Q1 = '{ text:"Who wrote Hamlet?",'
LONG_Q1 = ('{ text:"In Irish legend, the giant Finn McCool is said to have created Lough Neagh, the largest lake in the '
           'British Isles, by scooping up earth to hurl at a rival. In which country is Lough Neagh?",')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n)
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'):
            return self.send(404, '{}', 'application/json')
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB={};window.__FAKE_SIGNED_IN=false;window.__FAKE_UID="x";\n'
            return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);}};', 'application/javascript')
        p = u.path
        if not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js')
            t = t.replace('/app/vendor/qrcode-1.4.4.min.js', '/__fake/qrcode.js')
            t = t.replace('https://game.venueplay.com.au', '/__worker')
            q1 = urllib.parse.parse_qs(u.query or '').get('q1', [''])[0]
            if ext == '.html' and q1 in ('short', 'long'):
                SWAPPED[0] += t.count(DEMO_Q1)
                t = t.replace(DEMO_Q1, SHORT_Q1 if q1 == 'short' else LONG_Q1)
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)

SWAPPED = [0]
T0 = 1793500000000          # a fixed instant, never the real clock
FREEZE = r'''(function(){ var a=document.getAnimations?document.getAnimations():[];
  a.forEach(function(x){ try{ var t=x.effect&&x.effect.getComputedTiming(); if(t&&isFinite(t.endTime)) x.finish(); else { x.pause(); x.currentTime=0; } }catch(e){} });
  var s=document.createElement("style"); s.textContent="*,*::before,*::after{transition:none!important}"; document.head.appendChild(s); return a.length; })()'''

PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [b.left,b.top,b.right,b.bottom]; }
  function on(id){ var l=document.getElementById(id); return l && !l.classList.contains("hidden") && getComputedStyle(l).display!=="none"; }
  var lay=[].filter.call(document.querySelectorAll(".layer"),function(l){ return on(l.id); })[0];
  var out={ layer: lay ? lay.id : null };
  if(!lay) return JSON.stringify(out);
  var q=lay.querySelector(".qtext"); out.box=R(q); out.text=q ? q.textContent : "";
  if(q){ var cs=getComputedStyle(q); out.fs=parseFloat(cs.fontSize); out.lh=parseFloat(cs.lineHeight); out.cls=q.className;
    /* The painted text: one rect per line box. Lines are told apart by their top edge. */
    var tops=[], ink=null;
    for(var n=q.firstChild;n;n=n.nextSibling){ if(n.nodeType!==3) continue;
      var r=document.createRange(); r.selectNodeContents(n);
      [].forEach.call(r.getClientRects(),function(c){ if(c.width<1) return;
        if(!tops.some(function(t){ return Math.abs(t-c.top)<2; })) tops.push(c.top);
        ink = ink ? [Math.min(ink[0],c.left),Math.min(ink[1],c.top),Math.max(ink[2],c.right),Math.max(ink[3],c.bottom)] : [c.left,c.top,c.right,c.bottom]; }); }
    out.lines=tops.length; out.ink=ink; }
  out.ring=R(lay.querySelector(".ringwrap svg"));
  /* The VISIBLE ring: the circle's geometry plus half its stroke, in screen pixels. */
  var c=lay.querySelector(".ringwrap .rbg"), sv=lay.querySelector(".ringwrap svg");
  if(c && sv && sv.getBoundingClientRect().width>0){ var cb=c.getBoundingClientRect(), k=sv.getBoundingClientRect().width/100, hs=parseFloat(getComputedStyle(c).strokeWidth)/2*k;
    out.ringVis=[cb.left-hs,cb.top-hs,cb.right+hs,cb.bottom+hs]; }
  var mk=document.querySelector(".tv-corner .vn svg, .tv-corner svg"); out.mark=mk ? R(mk) : null;
  var tl=lay.querySelector(".toplbl .tl-night"); out.head=R(tl);
  out.qround=R(lay.querySelector(".qround")); out.qroundText=(lay.querySelector(".qround")||{}).textContent||"";
  out.cards=[].map.call(lay.querySelectorAll(".answers .ans"),function(c){ return { r:R(c), cls:c.className }; });
  return JSON.stringify(out);
})()'''


def load(B, base, path, w, h, states, tag):
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    out = {}
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
        B.call('Emulation.setVirtualTimePolicy', {'policy': 'pause', 'initialVirtualTime': T0 / 1000.0}, session=sid)
        B.call('Page.navigate', {'url': base + path}, session=sid)
        at = 0
        for name, ms in states:
            B.call('Emulation.setVirtualTimePolicy', {'policy': 'pauseIfNetworkFetchesPending', 'budget': ms - at}, session=sid)
            end = time.time() + 120
            while time.time() < end:
                r = B.evaluate(sid, 'Date.now()', 10)
                v = r and r.get('result', {}).get('value')
                if v and v >= T0 + ms - 5: break
                time.sleep(0.2)
            at = ms
            B.evaluate(sid, FREEZE, 20); time.sleep(0.5)
            r = B.evaluate(sid, PROBE, 30)
            out[name] = json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else {}
            if SHOTS:
                png = base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data'])
                open(os.path.join(SHOTS, 'question-space-%s-%dx%d-%s.png' % (tag, w, h, name)), 'wb').write(png)
    finally:
        B.close_tab(tid)
    return out


def same(a, b, tol=1.0):
    return bool(a and b) and all(abs(a[i] - b[i]) <= tol for i in range(4))


def wall(B, base, w, h):
    print('\nTHE TRIVIA QUESTION at %dx%d' % (w, h))
    tag = '%dx%d' % (w, h)
    states = [('question', 4000), ('reveal', 9000)]
    n0 = SWAPPED[0]
    one = load(B, base, '/app/trivia/screen.html?demo=1&sting=0&q1=short', w, h, states, 'one-line')
    lng = load(B, base, '/app/trivia/screen.html?demo=1&sting=0&q1=long', w, h, states, 'long')
    ok(tag + ': the short and the long question were swapped into the demo (the fixtures applied)', SWAPPED[0] >= n0 + 2, SWAPPED[0] - n0)
    two = load(B, base, '/app/trivia/screen.html?demo=1&sting=0', w, h, states, 'two-line')
    runs = (('one line', one), ('two lines', two), ('long', lng))
    ok(tag + ': every demo is on the question, then the reveal',
       all((r.get('question', {}).get('layer'), r.get('reveal', {}).get('layer')) == ('tvQ', 'tvReveal') for _, r in runs),
       [(n, r.get('question', {}).get('layer'), r.get('reveal', {}).get('layer')) for n, r in runs])
    oq, tq, lq = one.get('question', {}), two.get('question', {}), lng.get('question', {})
    ok(tag + ': the short question paints on ONE line', oq.get('lines') == 1 and oq.get('text') == 'Who wrote Hamlet?', [oq.get('lines'), oq.get('text')])
    ok(tag + ': the demo question paints on TWO lines', tq.get('lines') == 2, tq.get('lines'))
    ok(tag + ': the library\'s longest question paints on THREE or more lines', (lq.get('lines') or 0) >= 3, lq.get('lines'))
    ok(tag + ': the short questions are at the short-question size (3.96% of the width)', abs((tq.get('fs') or 0) - 0.0396 * w) <= 0.6 and oq.get('fs') == tq.get('fs'), [oq.get('fs'), tq.get('fs')])

    RV, MK, HD = tq.get('ringVis'), tq.get('mark'), tq.get('head')
    cards = tq.get('cards') or []
    ok(tag + ': the ring is full size (14.58% of the width)', bool(tq.get('ring')) and abs((tq['ring'][2] - tq['ring'][0]) - 0.1458 * w) <= 1.5, tq.get('ring'))
    top_gap = (RV[1] - MK[3]) if (RV and MK) else None
    low_gap = (min(c['r'][1] for c in cards) - RV[3]) if (RV and cards) else None
    ok(tag + ': the gap from the venueplay logo to the ring equals the gap from the ring to the answers (within 3px)',
       top_gap is not None and low_gap is not None and abs(top_gap - low_gap) <= 3 and top_gap > 0, [top_gap, low_gap, MK, RV])
    ring_mid = ((RV[1] + RV[3]) / 2) if RV else None
    for lbl, q in (('one line', oq), ('two lines', tq), ('long', lq)):
        I = q.get('ink')
        ok('%s, %s: the question is centred on the ring\'s centre line (within 2px)' % (tag, lbl),
           bool(I) and ring_mid is not None and abs((I[1] + I[3]) / 2 - ring_mid) <= 2, [I, ring_mid])
        ok('%s, %s: and clear of the TRIVIA line above and the answers below' % (tag, lbl),
           bool(I and HD and q.get('cards')) and I[1] > HD[3] and I[3] < min(c['r'][1] for c in q['cards']), [I, HD, (q.get('cards') or [{}])[0].get('r')])
    for lbl, r in runs:
        q, rv = r.get('question', {}), r.get('reveal', {})
        ok('%s, %s: the question box is in the same place on the countdown and the reveal' % (tag, lbl), same(q.get('box'), rv.get('box')), [q.get('box'), rv.get('box')])
        ok('%s, %s: and so is the painted text, the same size (no flick)' % (tag, lbl),
           same(q.get('ink'), rv.get('ink')) and q.get('fs') == rv.get('fs') and q.get('lines') == rv.get('lines'), [q.get('ink'), rv.get('ink'), q.get('fs'), rv.get('fs')])
        qc, rc = q.get('cards') or [], rv.get('cards') or []
        still = len(qc) == 4 and len(rc) == 4
        for i in range(min(len(qc), len(rc))):
            a, b = qc[i]['r'], rc[i]['r']
            if 'correct' in rc[i]['cls']:   # the right card lifts about its own middle
                still = still and abs((a[0] + a[2]) - (b[0] + b[2])) <= 2 and abs((a[1] + a[3]) - (b[1] + b[3])) <= 2
            else:
                still = still and same(a, b)
        ok('%s, %s: the answers do not move between the countdown and the reveal' % (tag, lbl), still, [[c['r'] for c in qc], [c['r'] for c in rc]])
        QR, RQ = q.get('qround'), rv.get('qround')
        ok('%s, %s: "Question N of 20" is under the answers, on the right, the same on the reveal' % (tag, lbl),
           bool(QR and qc) and QR[1] >= max(c['r'][3] for c in qc) and abs(QR[2] - max(c['r'][2] for c in qc)) <= 2 and QR[3] <= h and same(QR, RQ)
           and 'Question 3 of 20' in (q.get('qroundText') or ''), [QR, RQ, q.get('qroundText')])
    oc, tc, lc = oq.get('cards') or [], tq.get('cards') or [], lq.get('cards') or []
    ok(tag + ': the answers sit at the same fixed spot for every question length',
       len(oc) == len(tc) == len(lc) == 4 and all(same(oc[i]['r'], tc[i]['r']) and same(lc[i]['r'], tc[i]['r']) for i in range(4)),
       [[c['r'] for c in oc], [c['r'] for c in tc], [c['r'] for c in lc]])
    ok(tag + ': the answers start at 24.11% of the width (463px at 1920)', bool(tc) and abs(min(c['r'][1] for c in tc) - 0.2411 * w) <= 1.5, tc and tc[0]['r'])


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-question-space-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    run()


def run():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)   # a page asks for a dozen files at once; the default backlog of 5 drops some
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        wall(B, base, 1920, 1080)
        wall(B, base, 1280, 720)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
