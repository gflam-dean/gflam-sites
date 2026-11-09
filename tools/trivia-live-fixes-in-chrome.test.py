#!/usr/bin/env python3
"""THE TRIVIA PHONE FITS AN IPHONE, AS CHROME PAINTS IT (Dean, 6 Nov 2026, live at Test Alpha).

Dean: "the screen on the trivia isn't fitted for an iPhone. I expected it a little bit further up so you could see the
logo like the mock ups". Safari's visible area on an iPhone is about 664px tall with its bars up. This opens the REAL
app/trivia/play.html in its own sales-page demo (?demo=1&sting=0), served from this checkout, on Chrome's virtual clock,
at 390x664 and 375x664 (the short iPhone Safari area) and at 375x812, and on the question, locked in, the result, a long
question and the final screen measures that:

  - the page does not scroll (the document's scrollHeight is no taller than the window)
  - the ring is on screen, under the header (not scrolled beneath it)
  - all four answers are on screen, in order, the last one's bottom no lower than the window's
  - our venueplay logo is on screen at the foot

Reuses the harness of trivia-newlook-in-chrome.test.py (the same fake Supabase, clock and screenshots). Takes
/tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/trivia-live-fixes-in-chrome.test.py      screenshots go to $VP_SHOTS if set
"""
import http.server, importlib.util, json, os, sys, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('newlook', os.path.join(ROOT, 'tools', 'trivia-newlook-in-chrome.test.py'))
NL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(NL)

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]; }
  var v=[].filter.call(document.querySelectorAll(".view"),function(x){ return !x.classList.contains("hidden"); })[0];
  var bt=v ? [].slice.call(v.querySelectorAll(".pans")) : [];
  return JSON.stringify({ view:v&&v.id, sh:document.documentElement.scrollHeight, bsh:document.body.scrollHeight, ih:innerHeight,
    foot:R(document.querySelector(".pfoot svg")), btns:bt.map(R), head:R(document.querySelector(".ptop")), ring:R(v&&v.querySelector(".pq-ring")),
    note:R(v&&v.querySelector(".pnote")), score:R(document.getElementById("finalScore")) });
})()'''

STATES = [('question', 3000), ('locked', 6500), ('right', 9500), ('long', 15500), ('podium', 44000)]

def run(B, base, w, h):
    print('\nTHE TRIVIA PHONE at %dx%d' % (w, h))
    m = NL.load(B, base, '/app/trivia/play.html?demo=1&sting=0', w, h, True, STATES, PROBE)
    for name, _ in STATES:
        x = m.get(name) or {}
        tag = '%dx%d %s' % (w, h, name)
        ok(tag + ': the screen is the one expected', x.get('view') == {'question': 'vQ', 'locked': 'vQ', 'right': 'vRes', 'long': 'vQ', 'podium': 'vFinal'}[name], x.get('view'))
        ok(tag + ': the page does not scroll', (x.get('sh') or 9999) <= h + 1, [x.get('sh'), h])
        F = x.get('foot')
        ok(tag + ': our venueplay logo is on screen at the foot', bool(F) and F[3] <= h and F[1] >= 0, F)
        if name != 'podium':
            b = x.get('btns') or []
            ok(tag + ': all four answers are on screen, in order', len(b) == 4 and all(b[i][3] <= b[i + 1][1] for i in range(3)) and b[3][3] <= h, b)
            ok(tag + ': the ring is on screen, below the header', bool(x.get('ring') and x.get('head')) and x['ring'][1] >= x['head'][3] - 1 and x['ring'][3] <= h, [x.get('ring'), x.get('head')])
            ok(tag + ': the answers clear the logo', bool(F and b) and b[3][3] <= F[1], [b[3:], F])
        else:
            ok(tag + ': the score is on screen', bool(x.get('score')) and x['score'][3] <= h, x.get('score'))

def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-live-fixes-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), NL.Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = NL.VL.Browser()
    try:
        run(B, base, 390, 664)
        run(B, base, 375, 664)
        run(B, base, 375, 812)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
