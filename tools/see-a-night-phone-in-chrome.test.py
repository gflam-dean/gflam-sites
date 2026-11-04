#!/usr/bin/env python3
"""THE SEE-A-NIGHT PLAYER PHONE, AS A REAL PHONE PAINTS IT (Dean, 4 Nov 2026).

Dean, on his mobile: "the venueplay logo drops off when the trivia question is asked" and "the screen sticks out
of the top of the phone". Opens the REAL /see-a-night page in Chrome at 375x812, 390x844 and 430x932 (and a
1280x800 desktop), opens the player phone, and watches the live trivia screen inside it (the real
app/trivia/play.html?demo=1) through the countdown, the question, the reveal and the score:

  - our venueplay logo is in ONE fixed place on every step, and inside the phone's screen (not pushed off the bottom)
  - nothing on any step is taller than the phone's screen
  - the menu button and the venue's logo are in one place on every step, and the menu button is exactly where
    the real player phone (/app/trivia/play) puts it at 390 wide
  - the screen is clipped to the frame's rounded corners, so nothing sticks out of the top of the phone
  - the demo player has the drink-pun name "Pint Sized"

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/see-a-night-phone-in-chrome.test.py
"""
import base64, http.server, importlib.util, json, os, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('nl', os.path.join(ROOT, 'tools', 'trivia-newlook-in-chrome.test.py'))
NL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(NL)   # its Site (this checkout, no network) and Chrome driver
VL = NL.VL
SHOTS = os.environ.get('VP_SHOTS', '')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1

INNER = r'''(function(d){ function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]; }
  var z=function(s){ return R(d.querySelector(s)); }, v=d.querySelector(".view:not(.hidden)");
  return { vid: v&&v.id, logo:z("#venueLogo"), menu:z("#menuBtn"), foot:z(".pfoot svg"), view:R(v), H:d.documentElement.clientHeight, doc:d.documentElement.scrollHeight, body:d.body.scrollHeight }; })'''
FRAME = r'''(function(){ var fr=document.querySelector(".vp-live-phone"), bx=fr&&fr.querySelector(".vp-livebox"), f=bx&&bx.querySelector("iframe"); if(!f) return "{}";
  var a=bx.getBoundingClientRect(), b=f.getBoundingClientRect(), hit=document.elementFromPoint(a.left+2, a.top+2);
  return JSON.stringify({ box:[a.left,a.top,a.right,a.bottom], ifr:[b.left,b.top,b.right,b.bottom], clip:getComputedStyle(bx).clipPath, hitIframe: hit===f, fw: fr.getBoundingClientRect().width }); })()'''


def watch(B, base, url, w, h, wrap, n):
    """Samples the phone screen every 2.7s for n samples. Returns (samples, frame info)."""
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    out, fr = [], {}
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2 if w < 500 else 1, 'mobile': w < 500}, session=sid)
        B.call('Page.navigate', {'url': base + url}, session=sid); time.sleep(2.5)
        if wrap:
            B.evaluate(sid, 'document.querySelector(\'.vp-hotspot[data-view="player"]\').click()', 10)
            B.evaluate(sid, 'document.querySelector(".vp-live-phone").scrollIntoView({block:"center"})', 10)
        for i in range(n):
            js = '(%s)(%s)' % (INNER, 'document.querySelector(".vp-live-phone iframe").contentDocument' if wrap else 'document')
            r = B.evaluate(sid, 'JSON.stringify(%s)' % js, 30)
            try: s = json.loads(r['result']['value'])
            except Exception: s = {}
            out.append(s)
            if wrap and i == 0:
                r = B.evaluate(sid, FRAME, 30)
                try: fr = json.loads(r['result']['value'])
                except Exception: fr = {}
            if SHOTS:
                open(os.path.join(SHOTS, 'night-%dx%d-%02d.png' % (w, h, i)), 'wb').write(base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data']))
            time.sleep(2.7)
    finally:
        B.close_tab(tid)
    return out, fr


def check(tag, S, fr, real_menu):
    S = [s for s in S if s.get('vid')]
    seen = sorted(set(s['vid'] for s in S))
    ok('%s: the live phone ran through the question and the result' % tag, 'vQ' in seen and 'vRes' in seen, seen)
    feet = [s['foot'] for s in S if s.get('foot')]
    ok('%s: our venueplay logo is in ONE fixed place on every step' % tag, len(feet) == len(S) and all(abs(f[1] - feet[0][1]) <= 1 and abs(f[0] - feet[0][0]) <= 1 for f in feet), sorted(set((s['vid'], tuple(s['foot'] or [])) for s in S)))
    ok('%s: and it is inside the phone\'s screen, not pushed off the bottom' % tag, bool(feet) and all(s['foot'][3] <= s['H'] for s in S), [(s['vid'], s['foot'], s['H']) for s in S if s['foot'][3] > s['H']])
    ok('%s: no step is taller than the phone\'s screen' % tag, all(s['doc'] <= s['H'] and s['body'] <= s['H'] for s in S), [(s['vid'], s['doc'], s['body'], s['H']) for s in S if s['doc'] > s['H'] or s['body'] > s['H']])
    for k, nm in (('menu', 'menu button'), ('logo', 'venue\'s logo')):
        ps = [s[k] for s in S if s.get(k)]
        ok('%s: the %s is in one place on every step' % (tag, nm), len(ps) == len(S) and all(p == ps[0] for p in ps), sorted(set(tuple(p) for p in ps)))
    if real_menu is not None:
        ok('%s: the menu button is exactly where the real player phone puts it' % tag, bool(S) and all(s.get('menu') == real_menu for s in S), [S[0].get('menu') if S else None, real_menu])
    ok('%s: the screen is clipped to the frame\'s rounded corners, so nothing sticks out of the top' % tag,
       bool(fr) and 'round' in (fr.get('clip') or '') and not fr.get('hitIframe'), fr)
    b, i = fr.get('box') or [0] * 4, fr.get('ifr') or [0] * 4
    ok('%s: the screen sits inside the frame' % tag, bool(fr) and i[0] >= b[0] - 1 and i[1] >= b[1] - 1 and i[2] <= b[2] + 1 and i[3] <= b[3] + 1, [b, i])


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('see-a-night-phone-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), NL.Site); srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        real, _ = watch(B, base, '/app/trivia/play.html?demo=1', 390, 844, False, 3)
        rm = next((s['menu'] for s in real if s.get('menu')), None)
        for (w, h) in ((375, 812), (390, 844), (430, 932), (1280, 800)):
            print('\nSEE A NIGHT, THE PLAYER PHONE at %dx%d' % (w, h))
            S, fr = watch(B, base, '/see-a-night.html', w, h, True, 11)
            check('%dx%d' % (w, h), S, fr, rm)
        src = open(os.path.join(ROOT, 'venueplay', 'app', 'trivia', 'play.html'), encoding='utf-8').read()
        ok('the demo player has the drink-pun name "Pint Sized"', 'P.name="Pint Sized"' in src)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
