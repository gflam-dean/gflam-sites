#!/usr/bin/env python3
"""THE VENUE SCREENS ON AN OLDER TELEVISION, IN A REAL CHROME (1 Nov 2026).

Every size on the walls is in container units (cqw), which Chromium only learned in version 105.
Samsung sets before 2024 (Tizen 5.5 is Chromium 69, Tizen 6.5 is 85) and LG sets before webOS 24
(webOS 5 is 68, webOS 6 is 79) drop every one of those declarations. venueplay/app/vp-oldtv.js
rewrites the CSS for such an engine. This opens EVERY screen, in every state its own demo plays
(the bingo TV with no venue, its lobby, game, claim and win; trivia's lobby, question, reveal,
board and podium; musical bingo; the raffle; the members draw; the Punters Reckon board), at
1920x1080 and 1280x720, served from this checkout, four ways:

  BEFORE   the page with the vp-oldtv.js tag taken out: today's page
  MODERN   the page as shipped, on this Chrome (which has container units)
  UNITS    ?oldtv=units: the unit maths forced on, nothing else
  OLD      ?oldtv=68: every fallback forced on AND everything Chromium 68 would ignore stripped
           (container units, clamp/min/max, inset, aspect-ratio, flex gap, backdrop-filter...),
           which is as near to an old television as a modern Chrome can be made

and checks:
  - MODERN is PIXEL FOR PIXEL the BEFORE page, and the fallback says it did nothing. A new
    television must not change at all.
  - UNITS lands every box on the screen within a pixel of where this Chrome's own container units
    put it: the arithmetic is the engine's arithmetic.
  - OLD: nothing an old engine would throw away is left, every gap rule on a box on screen was
    turned into margins, every piece of text is the size it is on a new set, nothing on the wall
    moved more than a small distance (the gap margins are the only approximation), and the same
    wall is on air.

Every capture runs under Chrome's VIRTUAL clock from a fixed instant, with Math.random seeded,
so two loads of one page paint the same frame and a pixel diff means something.

    python3 tools/old-tv-in-chrome.test.py        screenshots of every OLD wall go to $VP_SHOTS
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
from PIL import Image, ImageChops  # noqa: E402  (on this Mac; venue-logo-in-chrome uses it too)
SHOTS = os.environ.get('VP_SHOTS', '')
SITE = os.path.join(ROOT, 'venueplay')
TAG = '<script src="/app/vp-oldtv.js"></script>\n'

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
        if u.path == '/__fixture/wrap.html':
            return self.send(200, WRAP_FIXTURE, 'text/html; charset=utf-8')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);},toDataURL:function(t,o,cb){var f=typeof o==="function"?o:cb;if(f)f(null,"data:,");return Promise.resolve("data:,");}};', 'application/javascript')
        p = u.path
        if p == '/tv': p = '/tv.html'
        elif not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js')
            t = t.replace('/app/vendor/qrcode-1.4.4.min.js', '/__fake/qrcode.js')
            t = t.replace('https://game.venueplay.com.au', '/__worker')
            if ext == '.html' and 'before=1' in (u.query or ''):
                t = t.replace(TAG, '')
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


# Each screen, and the moments of its own demo worth a look: (state, virtual ms after load, the layer on air)
# The start-of-game show is off by default (2 Nov 2026 hotfix), so the demos run on their own clocks again;
# tv-sting-in-chrome covers the show and the demos' later timings under ?sting=1.
SCREENS = [
    ('bingo TV, no venue (set up this screen)', '/tv', [('setup', 4000, None)]),
    ('bingo TV', '/tv?demo=1', [('lobby', 1500, 'tvLobby'), ('game', 15000, 'tvRun'), ('claim', 29500, 'tvClaim'), ('win', 33000, 'tvWin')]),
    ('trivia', '/app/trivia/screen.html?demo=1', [('lobby', 900, 'tvLobby'), ('question', 4000, 'tvQ'), ('reveal', 9000, 'tvReveal'),
                                                  ('board', 12500, 'tvBoard'), ('podium', 44000, 'tvPodium')]),
    ('musical bingo', '/app/musical/screen.html?demo=1', [('game', 15000, 'tvRun'), ('claim', 28800, 'tvClaim'), ('win', 33000, 'tvWin'), ('lobby', 39000, 'tvLobby')]),
    ('raffle', '/app/raffle/screen.html?demo=1', [('draw', 4700, 'tvDraw'), ('win', 8000, 'tvWin'), ('result', 13000, 'tvResult')]),
    ('members draw', '/app/members/screen.html?demo=1', [('draw', 6000, 'tvDraw'), ('win', 10000, 'tvWin'), ('result', 17000, 'tvResult')]),
    ('Punters Reckon board', '/app/topanswers/screen.html?demo=1', [('guessing', 8000, None), ('all shown', 16000, None)]),
]
SIZES = [(1920, 1080), (1280, 720)]

# A WRAPPING ROW, ON PURPOSE (3 Nov 2026). No wall wraps a flex row onto a second line at the sizes above
# (checked at 1920, 1280 and 1024), so the fallback's line-break finder (fixWraps) had nothing to be judged
# on: its mutation only ever went red because the Punters Reckon board's paint flickered. This is the
# smallest wall that needs it: seven chips in a wrapping row with a row gap and a column gap, sized in cqw.
WRAP_FIXTURE = '''<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#000}
.wall{container-type:inline-size;width:100vw;height:100vh}
.row{display:flex;flex-wrap:wrap;gap:2cqw 3cqw;width:46cqw;padding:2cqw}
.chip{width:11cqw;height:5cqw;background:#FF1F8E}
</style>
<script src="/app/vp-oldtv.js"></script>
</head><body><div class="wall"><div class="row" id="wrapRow">''' + ''.join('<div class="chip" id="chip%d"></div>' % i for i in range(7)) + '''</div></div></body></html>'''
T0 = 1793500000000          # a fixed instant (Tue 3 Nov 2026), never the real clock

# Math.random and crypto.getRandomValues seeded, the same in every load: the confetti, the raffle's
# rolling numbers and the demo boards are drawn with them, and two loads must paint the same frame.
SEED = r'''(function(){ var s=20261101; function n(){ s=(s*1103515245+12345)%2147483648; return s; }
  Math.random=function(){ return n()/2147483648; };
  /* A frame callback runs on the virtual clock too: the raffle's rolling digits are drawn on frames. */
  var raf=0; window.requestAnimationFrame=function(cb){ raf++; return setTimeout(function(){ cb(performance.now()); }, 16); };
  window.cancelAnimationFrame=function(id){ clearTimeout(id); };
  try{ var C=window.crypto; C.getRandomValues=function(a){ for(var i=0;i<a.length;i++) a[i]=(n()*2+(n()&1))%Math.pow(2,8*a.BYTES_PER_ELEMENT); return a; }; }catch(e){}
  /* NO CSS TRANSITIONS, IN EVERY LOAD ALIKE (3 Nov 2026). A transition runs on the compositor's real
     clock, not the virtual one, and where it ends on a 3D layer is rasterised one of two ways at random:
     the Punters Reckon board's flipped card backs (preserve-3d rotateX) painted their text a sub-pixel
     apart from load to load, before and modern alike, with a warm reference and with a 3 s settle
     (flake log 1 to 2 Nov, on main too; 8 loads in a row came out in two variants). Every state here is
     read after the transition would have ended (FREEZE finishes them anyway), so the frames are the same
     frames, and before, modern, units and old all get this, so the comparison stays to the pixel. No wall
     waits on transitionend (checked 3 Nov). */
  document.addEventListener("DOMContentLoaded", function(){ var s=document.createElement("style");
    s.textContent="*,*::before,*::after{transition:none!important}"; document.head.appendChild(s); });
})();'''

FREEZE = r'''(function(){ var a=document.getAnimations?document.getAnimations():[];
  a.forEach(function(x){ try{ var t=x.effect&&x.effect.getComputedTiming(); if(t&&isFinite(t.endTime)) x.finish(); else { x.pause(); x.currentTime=0; } }catch(e){} });
  return a.length; })()'''

MEASURE = r'''(function(){
  var out=[], all=document.body?document.body.getElementsByTagName("*"):[];
  for(var i=0;i<all.length;i++){ var e=all[i], t=e.tagName;
    if(t==="SCRIPT"||t==="STYLE") { out.push(null); continue; }
    var r=e.getBoundingClientRect(), cs=getComputedStyle(e);
    if(!(r.width>0&&r.height>0) || cs.visibility==="hidden" || cs.display==="none"){ out.push(null); continue; }
    var own=""; for(var c=e.firstChild;c;c=c.nextSibling) if(c.nodeType===3) own+=c.nodeValue;
    out.push([Math.round(r.left*100)/100,Math.round(r.top*100)/100,Math.round(r.right*100)/100,Math.round(r.bottom*100)/100,
              parseFloat(cs.fontSize), own.replace(/\s+/g,"").length>0?1:0, (e.id?"#"+e.id:"")+(typeof e.className==="string"&&e.className?"."+e.className.trim().split(/\s+/).join("."):"")||t.toLowerCase()]);
  }
  var lay=[].filter.call(document.querySelectorAll(".layer"),function(l){var s=getComputedStyle(l);return !l.classList.contains("hidden")&&s.display!=="none";}).map(function(l){return l.id;});
  var O=window.VPOldTV||null, pend=[];
  if(O&&O.active){ O.pendingGaps().forEach(function(sel){ try{ [].forEach.call(document.querySelectorAll(sel),function(e){ if(getComputedStyle(e).display!=="none"&&e.getBoundingClientRect().width>0) pend.push(sel); }); }catch(x){} }); }
  return JSON.stringify({els:out, layers:lay, W:innerWidth, H:innerHeight,
    old: O ? {active:!!O.active, force:O.force||"", left:O.active?O.leftovers():[], pend:pend} : null});
})()'''


def load(B, base, path, w, h, states, probe=None):
    """One tab under the virtual clock: advance to each state's moment, paint it, measure it."""
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    out = {}
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
        B.call('Page.addScriptToEvaluateOnNewDocument', {'source': SEED}, session=sid)
        B.call('Emulation.setVirtualTimePolicy', {'policy': 'pause', 'initialVirtualTime': T0 / 1000.0}, session=sid)
        B.call('Page.navigate', {'url': base + path}, session=sid)
        at = 0
        for name, ms, _layer in states:
            B.call('Emulation.setVirtualTimePolicy', {'policy': 'pauseIfNetworkFetchesPending', 'budget': ms - at}, session=sid)
            end = time.time() + 120
            while time.time() < end:
                r = B.evaluate(sid, 'Date.now()', 10)
                v = r and r.get('result', {}).get('value')
                if v and v >= T0 + ms - 5: break
                time.sleep(0.2)
            at = ms
            # CSS animations run on the compositor's own clock, not the virtual one, so each is set to a
            # fixed frame first: a finite one to its end, a looping one to its start. Same in every load.
            B.evaluate(sid, FREEZE, 20)
            time.sleep(0.5)        # a layer that has just stopped animating is painted again, sharp
            png = base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data'])
            r = B.evaluate(sid, MEASURE, 30)
            m = json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else {}
            if probe:
                r = B.evaluate(sid, probe, 30)
                m['probe'] = json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else None
            out[name] = (png, m)
    finally:
        B.close_tab(tid)
    return out


# THE TRIVIA COUNTDOWN SAYS "SECS" (Dean, 2 Nov 2026). A bare "13" in a ring did not read as a timer,
# so the ring now holds the number with "SECS" under it. Both must sit inside the ring's inner circle
# (the circle is r=44 of a 100 viewBox with an 8 stroke, so its inner edge is 40% of the ring's width
# from the centre) on every wall a venue has: 1920x1080, 1280x720 and an old 1024x768 set, on a new
# engine and through the old-engine fallback, in the normal layout and the picture round's smaller ring.
RING_SIZES = [(1920, 1080), (1280, 720), (1024, 768)]
RING_PROBE = r'''(function(){
  var q=document.getElementById("tvQ"), out={}, had=q.classList.contains("pic");
  function box(e){ var r=e.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]; }
  function m(){ var s=document.querySelector("#tvQ .ringwrap svg"), n=document.getElementById("tvCdNum"), l=document.getElementById("tvCdLbl"), c=document.querySelector("#tvQ .rcount");
    if(!s||!n||!l) return null; var cs=getComputedStyle(l);
    return {ring:box(s), num:box(n), lbl:box(l), text:(l.textContent||"").trim(), tt:cs.textTransform, ff:cs.fontFamily,
            shown:cs.display!=="none"&&cs.visibility!=="hidden"&&parseFloat(cs.opacity)>0, numtext:n.textContent, count:(c&&c.getBoundingClientRect().height>0)?box(c):null}; }
  q.classList.remove("pic"); out.plain=m();
  q.classList.add("pic"); out.pic=m();
  if(!had) q.classList.remove("pic");
  return JSON.stringify(out);
})()'''


def ring_checks(tag, p):
    """The SECS label and the number, against the ring's inner circle, for one measured wall."""
    for lay in ('plain', 'pic'):
        g = (p or {}).get(lay)
        t = '%s, %s layout' % (tag, 'picture round' if lay == 'pic' else 'question')
        ok(t + ': the ring has its number and a SECS label', bool(g) and g['text'].lower() == 'secs' and g['tt'] == 'uppercase'
           and 'Hanken' in g['ff'] and g['shown'], g)
        if not g: continue
        L, T, R, Bm = g['ring']; cx, cy = (L + R) / 2, (T + Bm) / 2; inner = 0.40 * (R - L)
        def corners_in(b):
            return max(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 for x in (b[0], b[2]) for y in (b[1], b[3]))
        for what, b in (('the SECS label', g['lbl']), ('the number', g['num'])) + ((('the answered count', g['count']),) if g.get('count') else ()):
            far = corners_in(b)
            ok(t + ": %s sits wholly inside the ring's inner circle (corner %.1fpx from centre, inner edge %.1fpx)" % (what, far, inner),
               b[2] > b[0] and b[3] > b[1] and far <= inner - 1, b)
        n, lb = g['num'], g['lbl']
        ok(t + ': SECS sits under the number, not over it', lb[1] >= n[3] - 0.5, 'number %s, label %s' % (n, lb))
        tol = max(1.5, 0.02 * (R - L))
        ok(t + ': the number and SECS are centred across the ring', abs((n[0] + n[2]) / 2 - cx) <= tol and abs((lb[0] + lb[2]) / 2 - cx) <= tol,
           'centre %.1f, number %.1f, label %.1f' % (cx, (n[0] + n[2]) / 2, (lb[0] + lb[2]) / 2))
        # Dean, 3 Nov: the number, SECS and the "41/43" count are ONE block, evenly spaced, centred in the ring
        bot = (g.get('count') or lb)[3]
        ok(t + ': and the number, SECS and the count centred as one block top to bottom', abs((n[1] + bot) / 2 - cy) <= tol,
           'block middle %.1f, ring centre %.1f' % ((n[1] + bot) / 2, cy))
        if g.get('count'):
            c_ = g['count']
            ok(t + ': the count sits under SECS, centred across the ring', c_[1] >= lb[3] - 0.5 and abs((c_[0] + c_[2]) / 2 - cx) <= tol, 'label %s, count %s' % (lb, c_))


def pixels_differ(a, b):
    ia, ib = Image.open(io.BytesIO(a)).convert('RGB'), Image.open(io.BytesIO(b)).convert('RGB')
    if ia.size != ib.size: return -1, None
    d = ImageChops.difference(ia, ib); bb = d.getbbox()
    if not bb: return 0, None
    return sum(1 for px in d.crop(bb).getdata() if px != (0, 0, 0)), bb


def compare(native, other):
    """[(index, label, max corner move px, font native, font other, has own text)] for boxes on screen in both."""
    rows = []
    A, Bx = native.get('els', []), other.get('els', [])
    for i in range(min(len(A), len(Bx))):
        a, b = A[i], Bx[i]
        if not a or not b: continue
        mv = max(abs(a[k] - b[k]) for k in range(4))
        rows.append((i, a[6], mv, a[4], b[4], a[5]))
    return rows


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('old-tv-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        for (w, h) in RING_SIZES:
            for mode, q in (('a new set', ''), ('an old set (?oldtv=68)', '&oldtv=68')):
                print('\nTRIVIA COUNTDOWN RING at %dx%d, %s' % (w, h, mode))
                # 3.5 s (3 Nov 2026): with ?sting=0 the demo's first question is up 0.9 s to 6.1 s and the reveal
                # lands at 7.1 s, so the old 7.3 s photographed the reveal once the show went off by default.
                got = load(B, base, '/app/trivia/screen.html?demo=1&sting=0' + q, w, h, [('question', 3500, 'tvQ')], probe=RING_PROBE)
                m = got.get('question', (b'', {}))[1]
                tag = 'trivia countdown, %dx%d, %s' % (w, h, mode)
                ok(tag + ': the question wall is on air', 'tvQ' in (m.get('layers') or []), m.get('layers'))
                ring_checks(tag, m.get('probe'))
        for label, path, states in SCREENS:
            for (w, h) in SIZES:
                print('\n%s at %dx%d' % (label.upper(), w, h))
                sep = '&' if '?' in path else '?'
                before = load(B, base, path + sep + 'before=1', w, h, states)
                cache = {}
                def before2(name, path=path, sep=sep, w=w, h=h, states=states, cache=cache):
                    if 'v' not in cache: cache['v'] = load(B, base, path + sep + 'before=1', w, h, states)
                    return cache['v'].get(name, (b'', {}))[0]
                modern = load(B, base, path, w, h, states)
                units = load(B, base, path + sep + 'oldtv=units', w, h, states)
                old = load(B, base, path + sep + 'oldtv=68', w, h, states)
                for name, _ms, layer in states:
                    tag = '%s, %s, %dx%d' % (label, name, w, h)
                    pb, mb = before.get(name, (b'', {}))
                    pm, mm = modern.get(name, (b'', {}))
                    pu, mu = units.get(name, (b'', {}))
                    po, mo = old.get(name, (b'', {}))
                    if layer:
                        ok(tag + ': the demo has reached its %s wall' % layer, layer in (mm.get('layers') or []), mm.get('layers'))
                    # MODERN = BEFORE, to the pixel
                    n, bb = pixels_differ(pb, pm) if pb and pm else (-1, None)
                    if n:
                        # A page that does not paint the same frame twice by itself (a draw's rolling
                        # digits) is loaded once more: a fault is a difference the page does not make
                        # between two loads of ITSELF. A difference it does make anyway is not ours.
                        again = before2(name)
                        n2, bb2 = pixels_differ(pb, again) if again else (-1, None)
                        # Modern equal TO THE PIXEL to a second load of the old page: the first reference
                        # was the odd paint, not modern (3 Nov 2026). Still pixel-exact, against a real load.
                        n3, _bb3 = pixels_differ(again, pm) if again else (-1, None)
                        inside = bool(bb and bb2 and bb[0] >= bb2[0] and bb[1] >= bb2[1] and bb[2] <= bb2[2] and bb[3] <= bb2[3])
                        ok(tag + ': a modern Chrome paints the page it painted before (it differs from itself only at %s)' % (bb2,),
                           n3 == 0 or (n2 > 0 and inside),
                           '%s pixels differ in %s; two loads of the old page differ by %s in %s; modern vs the second load differ by %s'
                           % (n, bb, n2, bb2, n3))
                    else:
                        ok(tag + ': a modern Chrome paints exactly the page it painted before (pixel diff 0)', True)
                    ok(tag + ': and the fallback did nothing there', (mm.get('old') or {}).get('active') is False, mm.get('old'))
                    # UNITS: the arithmetic is the engine's
                    rows = compare(mm, mu)
                    worst = max(rows, key=lambda r: r[2]) if rows else None
                    ok(tag + ': ?oldtv=units ran', (mu.get('old') or {}).get('force') == 'units', mu.get('old'))
                    ok(tag + ': ?oldtv=units puts every one of %d boxes within 1px of where container units put it' % len(rows),
                       rows and worst[2] <= 1.0, worst and '%s moved %.2fpx' % (worst[1], worst[2]))
                    # OLD: an old engine's view
                    o = mo.get('old') or {}
                    ok(tag + ': ?oldtv=68 ran', o.get('force') == '68', o)
                    ok(tag + ': nothing an old engine would throw away is left', not o.get('left'), (o.get('left') or [])[:4])
                    ok(tag + ': every gap on a box on screen became margins', not o.get('pend'), (o.get('pend') or [])[:4])
                    rows = compare(mm, mo)
                    text = [r for r in rows if r[5]]
                    fonts = [r for r in text if abs(r[3] - r[4]) > 0.05]
                    ok(tag + ': every one of %d pieces of text is the size it is on a new set' % len(text),
                       text and not fonts, ['%s %.1f->%.1f' % (r[1], r[3], r[4]) for r in fonts[:4]])
                    lim = max(12.0, w * 0.012)
                    far = sorted([r for r in rows if r[2] > lim], key=lambda r: -r[2])
                    ok(tag + ': nothing on the wall moves more than %.0fpx from where a new set puts it' % lim,
                       rows and not far, ['%s %.0fpx' % (r[1], r[2]) for r in far[:4]])
                    if layer:
                        ok(tag + ': the same wall is on air', layer in (mo.get('layers') or []), mo.get('layers'))
                    if SHOTS and po:
                        open(os.path.join(SHOTS, 'oldtv-%s-%s-%d.png' % (label.split(',')[0].replace(' ', '-'), name.replace(' ', '-'), w)), 'wb').write(po)
                        open(os.path.join(SHOTS, 'modern-%s-%s-%d.png' % (label.split(',')[0].replace(' ', '-'), name.replace(' ', '-'), w)), 'wb').write(pm)
        # THE WRAPPING ROW: an old set's margins must put every chip where the gaps put it on a new set.
        for (w, h) in SIZES:
            tag = 'a wrapping row of chips, %dx%d' % (w, h)
            st = [('wrap', 500, None)]
            pm, mm = load(B, base, '/__fixture/wrap.html', w, h, st)['wrap']
            po, mo = load(B, base, '/__fixture/wrap.html?oldtv=68', w, h, st)['wrap']
            chips = [e for e in (mm.get('els') or []) if e and str(e[6]).startswith('#chip')]
            ok(tag + ': the row really wraps on a new set (three lines)', len(set(e[1] for e in chips)) == 3, sorted(set(e[1] for e in chips)))
            ok(tag + ': ?oldtv=68 ran', (mo.get('old') or {}).get('force') == '68', mo.get('old'))
            rows = [r for r in compare(mm, mo) if str(r[1]).startswith('#chip')]
            far = [r for r in rows if r[2] > 1.0]
            ok(tag + ': every chip of the second and third lines sits within 1px of where the gap puts it',
               len(rows) == 7 and not far, ['%s %.1fpx' % (r[1], r[2]) for r in far[:4]] or len(rows))
    finally:
        try: B.close()
        except Exception: pass
        srv.shutdown()
    print('\n%d of %d checks passed' % (ran - bad, ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
