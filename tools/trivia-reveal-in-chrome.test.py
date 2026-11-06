#!/usr/bin/env python3
"""THE TRIVIA REVEAL MOMENT, AS CHROME PAINTS IT (Dean, 5 Nov 2026, INBOX items 26 to 28).

On the TV reveal the timer's spot becomes a solid green disc with the right answer's letter and a tick; the right
card glows and pulses 3 times, then stays lit; the wrong cards KEEP THEIR OWN COLOURS, softened to about 40 to 45%
and still readable, never grey; nothing moves; picture questions get the same disc; motion under 3 flashes a second,
and none at all under prefers-reduced-motion.

This opens the REAL app/trivia/screen.html in its own sales-page demo (?demo=1&sting=0; its first question's right
answer is B, Sydney), served from this checkout, on Chrome's virtual clock, at 1920x1080 and 1280x720:

  TEXT        the demo as shipped: countdown, then the reveal
  PICTURE     the same demo with a picture on every question (?pic=1, a picture served by this test)
  CALM        the reveal again with prefers-reduced-motion: reduce

and measures the disc (where, what colour, which letter, how big), the cards (opacity, filter, their letter chips'
colours against the countdown's) and the running animations, read BEFORE they are finished for the capture.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/trivia-reveal-in-chrome.test.py      screenshots go to $VP_SHOTS if set
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS', '')

# The demo's question message, and the same with a picture. The swap must find its line, or the picture checks
# would measure the text layout twice and pass.
DEMO_MSG = 'options:q.options, secs:SECS,'
PIC_MSG = 'options:q.options, imageUrl:location.origin+"/__fixture/pic.svg", secs:SECS,'
PIC = ('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">'
       '<rect width="800" height="450" fill="#335577"/><circle cx="400" cy="225" r="150" fill="#FFD93D"/></svg>')
SWAPPED = [0]

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
        if u.path == '/__fixture/pic.svg':
            return self.send(200, PIC, 'image/svg+xml')
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
            if ext == '.html' and 'pic=1' in (u.query or ''):
                SWAPPED[0] += t.count(DEMO_MSG)
                t = t.replace(DEMO_MSG, PIC_MSG)
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


T0 = 1793500000000          # a fixed instant, never the real clock
FREEZE = r'''(function(){ var a=document.getAnimations?document.getAnimations():[];
  a.forEach(function(x){ try{ var t=x.effect&&x.effect.getComputedTiming(); if(t&&isFinite(t.endTime)) x.finish(); else { x.pause(); x.currentTime=0; } }catch(e){} });
  var s=document.createElement("style"); s.textContent="*,*::before,*::after{transition:none!important}"; document.head.appendChild(s); return a.length; })()'''

# The motion on the reveal, as Chrome applies it. Headless Chrome runs CSS animations on real time while the page's
# clock is paused, so a 1.8 s glow can be over before anything can look at it (seen 5 Nov 2026: the disc's grow-in
# read "finished" 100 ms after the reveal). So this reads what Chrome computes for each element (name, duration,
# count) and finds each @keyframes in Chrome's own parsed stylesheet, which is what decides whether it can run.
ANIMS = r'''(function(){
  function kf(name){ var hit=null; [].forEach.call(document.styleSheets,function(s){ var rr; try{ rr=s.cssRules; }catch(e){ return; }
    [].forEach.call(rr||[],function(r){ if(r.type===7 && r.name===name) hit={ frames:r.cssRules.length, text:r.cssText }; }); }); return hit; }
  function on(e){ if(!e) return null; var cs=getComputedStyle(e); return { name:cs.animationName, dur:cs.animationDuration, iters:cs.animationIterationCount }; }
  var c=document.querySelector("#tvRevAnswers .ans.correct"), mk=document.getElementById("tvRevMark"), tk=mk?mk.querySelector(".vp-revtick"):null;
  return JSON.stringify({ card:on(c), mark:on(mk), tick:on(tk), glowKf:kf("vpGlow"), inKf:kf("vpRevIn"), tickKf:kf("vpTickIn") }); })()'''

PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [b.left,b.top,b.right,b.bottom]; }
  function on(id){ var l=document.getElementById(id); return l && !l.classList.contains("hidden") && getComputedStyle(l).display!=="none"; }
  var lay=[].filter.call(document.querySelectorAll(".layer"),function(l){ return on(l.id); })[0];
  var out={ layer: lay ? lay.id : null, pic: !!(lay && lay.classList.contains("pic")) };
  if(!lay) return JSON.stringify(out);
  out.ring=R(lay.querySelector(".ringwrap"));
  var mk=document.getElementById("tvRevMark"), lt=document.getElementById("tvRevLetter");
  if(mk && lay.id==="tvReveal"){ var ms=getComputedStyle(mk); out.mark={ r:R(mk), shown: ms.display!=="none" && mk.getBoundingClientRect().width>0, bg: ms.backgroundColor,
      op: parseFloat(ms.opacity), tf: ms.transform, letter: lt ? lt.textContent : "", lfs: lt ? parseFloat(getComputedStyle(lt).fontSize) : 0,
      lff: lt ? getComputedStyle(lt).fontFamily : "", tick: R(mk.querySelector(".vp-revtick")) }; }
  out.q=R(lay.querySelector(".qtext"));
  out.qround=R(lay.querySelector(".qround")); var im=lay.querySelector(".qimg"); out.img=(im && !im.classList.contains("hidden")) ? R(im) : null;
  out.cards=[].map.call(lay.querySelectorAll(".answers .ans"),function(c){ var cs=getComputedStyle(c), al=c.querySelector(".al");
    return { r:R(c), cls:c.className, op:parseFloat(cs.opacity), filter:cs.filter, c:cs.getPropertyValue("--c").trim(),
             alBg: al ? getComputedStyle(al).backgroundColor : "", letter: al ? al.textContent : "", bg: cs.backgroundColor }; });
  return JSON.stringify(out);
})()'''


def load(B, base, path, w, h, states, tag, calm=False):
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    out = {}
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
        if calm:
            B.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]}, session=sid)
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
            r = B.evaluate(sid, ANIMS, 20)
            anims = json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else {}
            B.evaluate(sid, FREEZE, 20); time.sleep(0.5)
            r = B.evaluate(sid, PROBE, 30)
            out[name] = json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else {}
            out[name]['anims'] = anims
            if SHOTS:
                png = base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data'])
                open(os.path.join(SHOTS, 'reveal-%s-%dx%d-%s.png' % (tag, w, h, name)), 'wb').write(png)
    finally:
        B.close_tab(tid)
    return out


def same(a, b, tol=1.0):
    return bool(a and b) and all(abs(a[i] - b[i]) <= tol for i in range(4))

GREEN = 'rgb(47, 208, 138)'


def wall(B, base, w, h):
    print('\nTHE TRIVIA REVEAL at %dx%d' % (w, h))
    tag = '%dx%d' % (w, h)
    # The reveal is read just after it lands (7300 ms: the demo reveals its first question at 7.1 s), while the
    # disc and the glow are still running, and again at 9000 ms, settled.
    states = [('question', 4000), ('landing', 7300), ('reveal', 9000)]   # landing: the disc just in
    txt = load(B, base, '/app/trivia/screen.html?demo=1&sting=0', w, h, states, 'text')
    q, ld, rv = txt.get('question', {}), txt.get('landing', {}), txt.get('reveal', {})
    ok(tag + ': the demo is on its question, then its reveal', (q.get('layer'), ld.get('layer'), rv.get('layer')) == ('tvQ', 'tvReveal', 'tvReveal'),
       [q.get('layer'), ld.get('layer'), rv.get('layer')])
    M, cards, qc = rv.get('mark') or {}, rv.get('cards') or [], q.get('cards') or []
    right = [c for c in cards if 'correct' in c['cls']]
    ok(tag + ': the green disc is on the wall, a solid right-answer green', M.get('shown') is True and M.get('bg') == GREEN and M.get('op') == 1, M)
    ok(tag + ': it shows the right answer\'s letter, B, the same letter as the green card', M.get('letter') == 'B' and len(right) == 1 and right[0]['letter'] == 'B',
       [M.get('letter'), [c['letter'] for c in right]])
    ok(tag + ': in the timer ring\'s exact spot (within 1px)', same(M.get('r'), q.get('ring')), [M.get('r'), q.get('ring')])
    ok(tag + ': the letter is big and bold, Anton at 9.5% of the width (idea 3\'s B)', 'Anton' in (M.get('lff') or '') and (M.get('lfs') or 0) >= 0.095 * w - 1, [M.get('lff'), M.get('lfs')])
    T = M.get('tick')
    ok(tag + ': the tick badge sits on the disc\'s top right', bool(T and M.get('r')) and T[2] <= M['r'][2] + 1 and T[1] >= M['r'][1] - 1 and (T[0] + T[2]) / 2 > (M['r'][0] + M['r'][2]) / 2, [T, M.get('r')])
    wrong = [c for c in cards if 'dim' in c['cls']]
    ok(tag + ': three wrong cards, softened to between 40% and 45% (readable from across the room)', len(wrong) == 3 and all(0.40 <= c['op'] <= 0.45 for c in wrong), [c['op'] for c in wrong])
    ok(tag + ': never grey: no filter on them', all(c['filter'] == 'none' for c in wrong), [c['filter'] for c in wrong])
    same_col = len(qc) == 4 and len(cards) == 4 and all(cards[i]['alBg'] == qc[i]['alBg'] and cards[i]['c'] == qc[i]['c'] for i in range(4) if 'dim' in cards[i]['cls'])
    ok(tag + ': and each keeps its own colour from the countdown (coral A, amber C, violet D)', same_col, [(c['letter'], c['alBg']) for c in cards])
    ok(tag + ': the right card is green', len(right) == 1 and right[0]['bg'] == GREEN, [c['bg'] for c in right])
    ok(tag + ': nothing moves: the question is where it was on the countdown', same(q.get('q'), rv.get('q')), [q.get('q'), rv.get('q')])
    still = len(qc) == 4 and len(cards) == 4
    for i in range(4 if still else 0):
        a, b = qc[i]['r'], cards[i]['r']
        if 'correct' in cards[i]['cls']:
            still = still and abs((a[0] + a[2]) - (b[0] + b[2])) <= 2 and abs((a[1] + a[3]) - (b[1] + b[3])) <= 2
        else:
            still = still and same(a, b)
    ok(tag + ': and so is every answer card', still, [[c['r'] for c in qc], [c['r'] for c in cards]])
    A = rv.get('anims') or {}
    CA, GK = A.get('card') or {}, A.get('glowKf') or {}
    ok(tag + ': the right card glows: Chrome runs vpGlow on it, and its keyframes parse (3 steps, the green glow)',
       CA.get('name') == 'vpGlow' and GK.get('frames') == 3 and 'box-shadow' in (GK.get('text') or ''), [CA, GK.get('frames')])
    ok(tag + ': it pulses 3 times, then holds lit (not for ever)', CA.get('iters') == '3', CA)
    d = float((CA.get('dur') or '0s').rstrip('s') or 0)
    ok(tag + ': under 3 flashes a second', d > 0 and 1.0 / d < 3, CA.get('dur'))
    MA, TA = A.get('mark') or {}, A.get('tick') or {}
    ok(tag + ': the disc grows in once and the tick pops in once (both keyframes parse)',
       MA.get('name') == 'vpRevIn' and MA.get('iters') == '1' and TA.get('name') == 'vpTickIn' and TA.get('iters') == '1'
       and (A.get('inKf') or {}).get('frames') == 2 and (A.get('tickKf') or {}).get('frames') == 2, [MA, TA])

    pic = load(B, base, '/app/trivia/screen.html?demo=1&sting=0&pic=1', w, h, [('question', 4000), ('reveal', 9000)], 'picture')
    pq, pr = pic.get('question', {}), pic.get('reveal', {})
    PM = pr.get('mark') or {}
    ok(tag + ': a picture question: the demo carried a picture (the fixture applied), on the countdown and the reveal', SWAPPED[0] > 0 and pq.get('pic') is True and pr.get('pic') is True,
       [SWAPPED[0], pq.get('pic'), pr.get('pic')])
    ok(tag + ': a picture question gets the same green disc with the right letter', PM.get('shown') is True and PM.get('bg') == GREEN and PM.get('letter') == 'B', PM)
    ok(tag + ': in the picture round\'s smaller ring spot (within 1px)', same(PM.get('r'), pq.get('ring')), [PM.get('r'), pq.get('ring')])

    QR, RG, IM = pq.get('qround'), pq.get('ring'), pq.get('img')
    ok(tag + ': a picture question: "Question 3 of 20" sits under its ring, not behind it, and clear of the picture',
       bool(QR and RG and IM) and QR[1] >= RG[3] and (QR[0] >= IM[2] or QR[3] <= IM[1]), [QR, RG, IM])
    for nm_, x_ in (('countdown', pq), ('reveal', pr)):
        # on the reveal the ring gives way to the green disc in the same spot (checked above), so the disc is the line
        Q_, R_, I_ = x_.get('q'), (x_.get('ring') if nm_ == 'countdown' else (x_.get('mark') or {}).get('r')), x_.get('img')
        ok(tag + ': a picture question: the question sits on the ring\'s centre line on the %s (within 2px; Dean, 6 Nov 2026)' % nm_,
           bool(Q_ and R_) and abs((Q_[1] + Q_[3]) / 2 - (R_[1] + R_[3]) / 2) <= 2, [Q_, R_])
        ok(tag + ': and clear of the picture under it on the %s' % nm_, bool(Q_ and I_) and Q_[3] <= I_[1] + 1, [Q_, I_])
    ok(tag + ': and the reveal\'s disc leaves it clear too', bool(PM.get('r') and pr.get('qround')) and pr['qround'][1] >= PM['r'][3], [PM.get('r'), pr.get('qround')])

    calm = load(B, base, '/app/trivia/screen.html?demo=1&sting=0', w, h, [('landing', 7300), ('reveal', 9000)], 'calm', calm=True)
    cl, cr = calm.get('landing', {}), calm.get('reveal', {})
    CM = cr.get('anims') or {}
    ok(tag + ': prefers-reduced-motion: no glow, no grow-in, no tick animation at all',
       cr.get('layer') == 'tvReveal' and all((CM.get(k) or {}).get('name') == 'none' for k in ('card', 'mark', 'tick')), CM)
    ok(tag + ': and the disc and the letter are there at once, full size', ((cl.get('mark') or {}).get('shown') is True and (cl.get('mark') or {}).get('letter') == 'B'
       and (cl.get('mark') or {}).get('op') == 1 and (cl.get('mark') or {}).get('tf') in ('none', 'matrix(1, 0, 0, 1, 0, 0)')), cl.get('mark'))


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-reveal-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
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
