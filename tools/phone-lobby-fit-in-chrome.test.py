#!/usr/bin/env python3
"""EVERY LOBBY, AND THE NO-GAME SCREEN, FIT AN IPHONE WITH THE VENUE'S AD AND OUR LOGO (Dean, 6 Nov 2026, round 7).

Dean: "ALL lobbies (trivia, musical, bingo) use the SAME layout and ALL show the venue's advertising AND our logo; squeeze
the other parts down so ads + logo always fit at 390x664 and 375x667". This opens the REAL phones served from this
checkout, in Chrome, at both sizes, with a venue that has slides, a game week (two games tonight) and collects the offers
tick:
  - app/trivia/play.html: a fresh join into a lobby, and a returning phone whose night is over (the no-game screen)
  - app/musical/play.html: a fresh join into a lobby
  - play.html (bingo): a phone that is in, on the lobby
and checks, on each:
  - the shared waiting screen is drawn (/app/vp-tonight.js), and the venue's ad is up
  - the ad's bottom is on screen, and our venueplay logo (the trivia and musical foot; bingo's is in its header) too
  - nothing on the page scrolls sideways
  - the trivia and musical menus offer "Join Tugun Bowls Club's list" (the venue collects the tick)

The slides are https addresses this test never fetches for real (the ad's box is sized by its own ratio, not the picture),
so nothing here needs the network. The fake Worker answers /join/info, /join (a lobby) and nothing else.
Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/phone-lobby-fit-in-chrome.test.py      screenshots go to $VP_SHOTS if set
"""
import base64, http.server, importlib.util, json, os, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('newlook', os.path.join(ROOT, 'tools', 'trivia-newlook-in-chrome.test.py'))
NL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(NL)
SHOTS = os.environ.get('VP_SHOTS', '')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

INFO = {'venue_name': 'Tugun Bowls Club', 'collect': {'first_name': True, 'email': True, 'marketing_optin': True},
        'week': [{'day': d, 'games': [{'game': 'trivia', 'start': '19:00'}, {'game': 'musical', 'start': '21:00'}]} for d in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')],
        'slides': [{'image_url': 'https://example.invalid/slide-%d.jpg' % n} for n in (1, 2, 3)]}
MODE = {'m': 'lobby', 'fmt': 'trivia'}

class Site(NL.Site):
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n)
        p = self.path.split('?')[0]
        if p == '/__worker/join/info':
            return self.send(200, json.dumps(dict(INFO, format=MODE['fmt'])), 'application/json')
        if p == '/__worker/join' and MODE['m'] == 'lobby':
            return self.send(200, json.dumps({'token': 'tok1', 'snapshot': {'session_id': '11111111-1111-4111-8111-111111111111', 'status': 'lobby', 'game': None}}), 'application/json')
        return self.send(404, '{"error":"No active game with that code"}', 'application/json')

PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]; }
  var t=document.getElementById("vpTonight"), a=document.getElementById("vpAd"), f=document.querySelector(".pfoot svg"), w=document.querySelector(".ptop .vp-wm");
  return JSON.stringify({ tonight: !!t && !t.classList.contains("hidden") && t.offsetHeight>0, text:(t&&t.innerText||"").slice(0,80),
    ad: !!a && !a.hidden && a.offsetHeight>0, adR: R(a), foot: R(f), headLogo: R(w), ih: innerHeight, iw: innerWidth, sw: document.documentElement.scrollWidth,
    list: (function(){ var r=document.querySelector("#vpListItem .vpt-listrow"); return r ? r.textContent : ""; })() });
})()'''

JOIN = 'document.getElementById("nameIn").value="Sam"; var b=document.getElementById("joinBtn"); (b.form && b.form.requestSubmit) ? b.form.requestSubmit(b) : b.click(); true'
TRIVIA_BACK = ("localStorage.setItem('vp-ttoken-ACDE23','tok');localStorage.setItem('vp-tname-ACDE23','Sam');localStorage.setItem('vp-tpid-ACDE23','pid1');"
               "localStorage.setItem('vp-tsess-ACDE23','22222222-2222-4222-8222-222222222222');")
BINGO_IN = "localStorage.setItem('vp-name-ACDE23','Ann');localStorage.setItem('vp-pid-ACDE23','pidbingo1');"

def look(B, base, path, w, h, ls, acts, name):
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
        B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'try{localStorage.clear();' + ls + '}catch(e){}'}, session=sid)
        B.call('Page.navigate', {'url': base + path}, session=sid)
        time.sleep(6)
        for a in acts: B.evaluate(sid, a, 10); time.sleep(3)
        B.evaluate(sid, 'document.querySelectorAll(".vp-feedback,[data-vp-feedback]").forEach(function(e){e.remove()});true', 5)
        r = B.evaluate(sid, PROBE, 10)
        if SHOTS:
            open(os.path.join(SHOTS, 'lobby-fit-%s-%dx%d.png' % (name, w, h)), 'wb').write(base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data']))
        return json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else {}
    finally:
        B.close_tab(tid)

def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('phone-lobby-fit-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site); srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = NL.VL.Browser()
    try:
        for (w, h) in ((390, 664), (375, 667)):
            for name, path, ls, acts, mode, fmt, foot in (
                    ('trivia', '/app/trivia/play.html?room=ACDE23&sting=0', '', [JOIN], 'lobby', 'trivia', True),
                    ('trivia-nogame', '/app/trivia/play.html?room=ACDE23&sting=0', TRIVIA_BACK, [], 'nogame', 'trivia', True),
                    ('musical', '/app/musical/play.html?room=ACDE23&sting=0', '', [JOIN], 'lobby', 'musical_bingo', True),
                    ('bingo', '/play.html?room=ACDE23&sting=0', BINGO_IN, [], 'lobby', 'bingo90', False)):
                MODE.update(m=mode, fmt=fmt)
                x = look(B, base, path, w, h, ls, acts, name)
                tag = '%s %dx%d' % (name, w, h)
                ok(tag + ': the shared waiting screen is drawn', x.get('tonight') is True, x.get('text'))
                ok(tag + ': the venue\'s ad is up', x.get('ad') is True, x.get('adR'))
                ok(tag + ': and its bottom is on screen', bool(x.get('adR')) and x['adR'][3] <= h, [x.get('adR'), h])
                if foot:
                    ok(tag + ': our venueplay logo is on screen at the foot', bool(x.get('foot')) and x['foot'][3] <= h and x['foot'][1] >= (x.get('adR') or [0, 0, 0, 0])[3] - 1, [x.get('foot'), x.get('adR'), h])
                else:
                    ok(tag + ': our venueplay logo is on screen (bingo\'s is in its header)', bool(x.get('headLogo')) and x['headLogo'][1] >= 0 and x['headLogo'][3] <= h, x.get('headLogo'))
                ok(tag + ': nothing scrolls sideways', (x.get('sw') or 9999) <= w + 1, [x.get('sw'), w])
                if name in ('trivia', 'musical'):
                    ok(tag + ': the menu offers "Join Tugun Bowls Club\'s list"', x.get('list') == 'Join Tugun Bowls Club’s list', x.get('list'))
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
