#!/usr/bin/env python3
"""THE WEBSITE DEMOS, TV AND PHONE IN STEP, AS A VISITOR SEES THEM (Dean, 12 Nov 2026, INBOX 281).

Dean, on the live site after the release: the musical bingo demo phone "lags behind the demo TV", the bingo demo TV
"calls different numbers from what the demo phone shows", and the raffle and members draw demos are "not the new
look". Every demo now runs on one timeline (/app/vp-demo-clock.js); tools/test-demo-pairs.js proves the scripts on a
fake clock. THIS opens the real pages in Chrome and reads what each frame PAINTS, the TV and the phone in ONE
evaluate (the same instant), every 0.4 s for a whole lap of each game:

  home page (index.html), the hero's TV and phone, at 1440x900:
    trivia         the question on the TV is the question on the phone
    musical bingo  the songs the TV has named ("N songs played") are exactly the songs the phone has marked, and the
                   song the TV shows is marked on the phone
    bingo          the ball the TV shows is the ball on the phone's header
    raffle         the TV plays the TICKET ROLL (the live screen's .vpds-ticket stage) and a winning ticket
    members draw   the TV plays the FLIP BOARD (.vpds-flip) and a member's number
  /see-a-night at 375x812: the room TV and the player phone (trivia, musical bingo, bingo), and for the draws the
                   room TV and "The big screen" over it, on the same layer at every sample

A pair may differ for at most one sample in a row (a step landing between the two reads of one evaluate is
impossible, but a step landing during the 0.4 s a frame takes to paint is a transition, not a lag). Two in a row is
a lag, and a red line. VP_SHOTS=<dir> writes a TV|phone pair picture at four moments a lap; VP_DEMO_LAPS=2 plays
each game through twice (the report run); VP_DEMO_WIDTHS=1440,375 picks the widths.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/demo-pairs-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('nl', os.path.join(ROOT, 'tools', 'trivia-newlook-in-chrome.test.py'))
NL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(NL)   # its Site (this checkout, no network) and Chrome driver
# This suite drives a real Chrome through that driver (tools/browser-rig underneath), so gatelib.uses_chrome counts it:
# --skip-chrome skips it and a Chrome run takes the heavy lock.
VL = NL.VL
SHOTS = os.environ.get('VP_SHOTS', '')
LAPS = float(os.environ.get('VP_DEMO_LAPS', '1') or 1)

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1

# What one frame paints, read inside it. kind: the wall or the phone of a game.
READ = r'''function(d, kind){
  if(!d || !d.body) return null;
  function on(id){ var e=d.getElementById(id); if(!e || e.classList.contains("hidden")) return false; var cs=d.defaultView.getComputedStyle(e); return cs.display!=="none" && cs.visibility!=="hidden"; }
  function tx(id){ var e=d.getElementById(id); return e ? (e.textContent||"").replace(/\s+/g," ").trim() : ""; }
  /* The members wall's advertising board is a layer that is never marked hidden (it sits under the draw), so a
     visible layer that is not an ad wins: otherwise every members sample read "adBoard" and could not differ. */
  var lays=[].filter.call(d.querySelectorAll(".layer"), function(l){ return on(l.id); });
  var layer=((lays.filter(function(l){ return !l.classList.contains("ad"); })[0]) || lays[0] || {}).id || "";
  var o={ layer:layer };
  if(kind==="trivia-tv"){ o.q = on("tvQ") ? tx("tvQText") : on("tvReveal") ? tx("tvRevQText") : ""; }
  if(kind==="trivia-phone"){ o.q = on("vQ") || on("vRes") || on("vReveal") ? tx("pqText") : ""; o.view=([].filter.call(d.querySelectorAll(".view"), function(v){ return !v.classList.contains("hidden"); })[0]||{}).id||""; }
  if(kind==="bingo-tv"){ var br=d.getElementById("ballReveal"), rest=d.querySelector("#tvRun .cbnum"); o.ball = (br && !br.classList.contains("hidden")) ? tx("brBall") : (rest && on("tvRun") ? (rest.textContent||"").trim() : ""); o.claim = (d.body.innerText||"").indexOf("Ann")>=0 && /checking|claim|BINGO/i.test(d.body.innerText||""); }
  if(kind==="bingo-phone"){ var lc=d.querySelector(".lcring .lcnum"); o.ball = lc && lc.offsetParent!==null ? (lc.textContent||"").trim() : (on("hdrBall") ? tx("hdrBallNum") : ""); o.view=([].filter.call(d.querySelectorAll(".view"), function(v){ return !v.classList.contains("hidden"); })[0]||{}).id||""; }
  if(kind==="musical-tv"){ var it=d.body.innerText||"", m=/(\d+) songs? played/i.exec(it); o.played = m ? +m[1] : 0; o.run = on("tvRun") && !/First song coming up/i.test(it);
    o.now = o.run && o.played>0 && on("tvNow") && !on("tvListen") ? tx("tvNowTitle") : ""; }
  if(kind==="musical-phone"){ var SONGS=["Never Gonna Give You Up","Dancing Queen","Khe Sanh","Mr. Brightside","The Horses"];
    o.marked=[].filter.call(d.querySelectorAll(".cc.daub"), function(c){ return SONGS.indexOf((c.textContent||"").replace(/\s+/g," ").trim())>=0; }).map(function(c){ return (c.textContent||"").replace(/\s+/g," ").trim(); }); }
  /* The live new-look stages (vp-drawstyle.js): the ticket roll is a .vpds-raffle stage of .vpds-tk tickets, the flip
     board a .vpds-members stage with its .vpds-board. The old look is the raffle's spinning-tile layer (tvDraw) or the
     members wall's old drawing layer. */
  if(kind==="draw-tv"){ var st=on("tvStyle"); o.ticket=st && !!d.querySelector("#tvStyle .vpds-raffle .vpds-tk"); o.flip=st && !!d.querySelector("#tvStyle .vpds-members .vpds-board"); o.stage=st && !!d.querySelector("#tvStyle .vpds-stage");
    o.old = on("tvDraw") || on("tvDrawing"); }
  return o; }'''

HOME = {'tv': 'document.getElementById("h2Tv")', 'phone': 'document.getElementById("h2Phone")'}
SAN = {'tv': 'document.querySelector("#vpSceneTv iframe")', 'phone': 'document.querySelector(".vp-modal .vp-live-phone iframe, .vp-modal .vp-live-tv iframe")'}


def sample(B, sid, where, tvkind, phkind):
    js = '(function(){ var R=%s; function doc(f){ try{ return f && f.contentDocument; }catch(e){ return null; } } return JSON.stringify({ tv:R(doc(%s), "%s"), ph:R(doc(%s), "%s"), t:Date.now() }); })()' % (READ, where['tv'], tvkind, where['phone'], phkind)
    r = B.evaluate(sid, js, 20)
    try: return json.loads(r['result']['value'])
    except Exception: return {}


def lap_ms(B, sid, where, key):
    r = B.evaluate(sid, '(function(){ try{ var w=%s.contentWindow; return w.VPDemoClock.%s.lap(); }catch(e){ return 0; } })()' % (where['tv'], key), 10)
    try: return int(r['result']['value'] or 0)
    except Exception: return 0


def rect(B, sid, js):
    r = B.evaluate(sid, 'JSON.stringify((function(){ var e=%s; if(!e) return null; var b=e.getBoundingClientRect(); return [b.left,b.top,b.right,b.bottom]; })())' % js, 10)
    try: return json.loads(r['result']['value'])
    except Exception: return None


def shot(B, sid):
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data']))).convert('RGB')


def pair_picture(B, sid, where_box, name, dpr, hide_modal=False):
    """TV left, phone right, from one screenshot (home) or two taken back to back (see-a-night: the dialog covers the room TV)."""
    from PIL import Image
    if not SHOTS: return
    tvr, phr = rect(B, sid, where_box['tv']), rect(B, sid, where_box['phone'])
    if hide_modal:
        B.evaluate(sid, 'document.querySelector(".vp-backdrop").style.visibility="hidden"', 5)
        a = shot(B, sid)
        B.evaluate(sid, 'document.querySelector(".vp-backdrop").style.visibility=""', 5)
        b = shot(B, sid)
    else:
        a = b = shot(B, sid)
    if not tvr or not phr: return
    ta = a.crop(tuple(int(v * dpr) for v in tvr)); pb = b.crop(tuple(int(v * dpr) for v in phr))
    H = 720
    ta = ta.resize((max(1, int(ta.width * H / max(1, ta.height))), H)); pb = pb.resize((max(1, int(pb.width * H / max(1, pb.height))), H))
    out = Image.new('RGB', (ta.width + pb.width + 24, H), (20, 20, 24))
    out.paste(ta, (0, 0)); out.paste(pb, (ta.width + 24, 0))
    out.save(os.path.join(SHOTS, name + '.png'))


def run_pair(B, sid, where, mode, tvkind, phkind, clockkey, tag, dpr, box=None, hide_modal=False):
    lap = lap_ms(B, sid, where, clockkey) or 50000
    span = lap * LAPS / 1000.0 + 1.0
    S, t0 = [], time.time()
    marks = [lap * f / 1000.0 for k in range(int(LAPS + 0.999)) for f in (k + 0.18, k + 0.4, k + 0.62, k + 0.86)]
    while time.time() - t0 < span:
        s = sample(B, sid, where, tvkind, phkind)
        if s.get('tv') and s.get('ph'): S.append(s)
        el = time.time() - t0
        if SHOTS and marks and el >= marks[0]:
            pair_picture(B, sid, box or where, '%s-%s-%02d' % (tag, mode, int(marks[0] * 10 / max(1, lap / 1000.0) * 10) // 10), dpr, hide_modal)
            marks.pop(0)
        time.sleep(0.4)
    return S


def runs_of_two(bad_flags):
    """True when two samples in a row are out of step."""
    return any(a and b for a, b in zip(bad_flags, bad_flags[1:]))


def judge(tag, mode, S):
    if mode == 'trivia':
        both = [s for s in S if s['tv'].get('q') and s['ph'].get('q')]
        flags = [s['tv']['q'] != s['ph']['q'] for s in both]
        ok('%s trivia: the TV and the phone on the same question at every sample (%d with a question on both)' % (tag, len(both)), len(both) >= 20 and not runs_of_two(flags),
           [(s['tv']['q'][:30], s['ph']['q'][:30]) for s, f in zip(both, flags) if f][:4])
    elif mode == 'bingo':
        both = [s for s in S if s['tv'].get('ball')]
        flags = [s['tv']['ball'] != s['ph'].get('ball') for s in both]
        ok('%s bingo: the ball on the TV is the ball on the phone at every sample (%d with a ball up)' % (tag, len(both)), len(both) >= 20 and not runs_of_two(flags),
           [(s['tv']['ball'], s['ph'].get('ball')) for s, f in zip(both, flags) if f][:6])
        balls = sorted(set(s['tv']['ball'] for s in both), key=lambda x: int(x or 0))
        ok('%s bingo: and the lap calls the twelve balls of the shared script' % tag, set(balls) >= set(['7', '42', '13', '88', '53']), balls)
        ok('%s bingo: the phone reaches its own win (the TV gives the game to the phone beside it)' % tag, any(s['ph'].get('view') in ('vWon', 'vWin') or s['ph'].get('view', '').lower().find('won') >= 0 for s in S),
           sorted(set(s['ph'].get('view') for s in S)))
    elif mode == 'musical':
        S = [s for s in S if s['tv'].get('run')]   # while the TV is on the songs (not its lobby, the claim or the win)
        flags = [s['tv'].get('played', 0) != len(s['ph'].get('marked') or []) for s in S]
        ok('%s musical bingo: the songs the TV has named are the songs the phone has marked, at every sample (%d)' % (tag, len(S)), len(S) >= 20 and not runs_of_two(flags),
           [(s['tv'].get('played'), s['tv'].get('now'), s['ph'].get('marked')) for s, f in zip(S, flags) if f][:4])
        shown = [s for s in S if s['tv'].get('now')]
        flags2 = [s['tv']['now'] not in (s['ph'].get('marked') or []) for s in shown]
        ok('%s musical bingo: the song the TV shows is already marked on the phone (%d samples with a title up)' % (tag, len(shown)), len(shown) >= 10 and not runs_of_two(flags2),
           [(s['tv']['now'], s['ph'].get('marked')) for s, f in zip(shown, flags2) if f][:4])
    else:
        look = 'ticket' if mode == 'raffle' else 'flip'
        ok('%s %s: the TV plays the new look (the live screen\'s .vpds-%s stage), never the old spinning tiles' % (tag, mode, look),
           any(s['tv'].get(look) and s['tv'].get('stage') for s in S) and not any(s['tv'].get('old') for s in S),
           [(s['tv'].get('layer'), s['tv'].get(look), s['tv'].get('old')) for s in S][:6])


def home(B, base, w, h):
    tag = 'home %dx%d' % (w, h)
    print('\nHOME PAGE HERO at %dx%d' % (w, h))
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    dpr = 2 if w < 500 else 1
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': dpr, 'mobile': w < 500}, session=sid)
        B.call('Page.navigate', {'url': base + '/index.html'}, session=sid); time.sleep(2.5)
        B.evaluate(sid, 'document.getElementById("h2Tv").scrollIntoView({block:"center"})', 10)
        box = {'tv': 'document.getElementById("h2Tv").parentNode', 'phone': 'document.getElementById("h2Phone").parentNode'}
        for mode, tvk, phk, key in (('trivia', 'trivia-tv', 'trivia-phone', 'TRIVIA'), ('musical', 'musical-tv', 'musical-phone', 'MUSICAL'), ('bingo', 'bingo-tv', 'bingo-phone', 'BINGO'),
                                    ('raffle', 'draw-tv', 'draw-tv', 'RAFFLE'), ('members', 'draw-tv', 'draw-tv', 'MEMBERS')):
            B.evaluate(sid, 'document.querySelector(\'#h2Modes [data-mode="%s"]\').click()' % mode, 10)
            time.sleep(0.3)
            draw = mode in ('raffle', 'members')   # a draw has no phone: the TV alone (its phone box steps aside)
            S = run_pair(B, sid, {'tv': HOME['tv'], 'phone': HOME['tv']} if draw else HOME, mode, tvk, phk, key, 'home-%d' % w, dpr,
                         {'tv': box['tv'], 'phone': box['tv']} if draw else box)
            judge(tag, mode, S)
    finally:
        B.close_tab(tid)


def see_a_night(B, base, w, h):
    tag = 'see-a-night %dx%d' % (w, h)
    print('\nSEE A NIGHT at %dx%d' % (w, h))
    dpr = 2 if w < 500 else 1
    for mode, view, tvk, phk, key in (('trivia', 'player', 'trivia-tv', 'trivia-phone', 'TRIVIA'), ('musical', 'player', 'musical-tv', 'musical-phone', 'MUSICAL'),
                                      ('bingo', 'player', 'bingo-tv', 'bingo-phone', 'BINGO'), ('raffle', 'tv', 'draw-tv', 'draw-tv', 'RAFFLE'), ('members', 'tv', 'draw-tv', 'draw-tv', 'MEMBERS')):
        tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        try:
            B.call('Page.enable', {}, session=sid)
            B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': dpr, 'mobile': w < 500}, session=sid)
            B.call('Page.navigate', {'url': base + '/see-a-night.html?mode=' + mode}, session=sid); time.sleep(2.5)
            B.evaluate(sid, 'document.getElementById("vpScene").scrollIntoView({block:"center"})', 10)
            B.evaluate(sid, 'document.querySelector(\'.vp-hotspot[data-view="%s"]\').click()' % view, 10)
            time.sleep(1.2)
            box = {'tv': 'document.getElementById("vpSceneTv")', 'phone': 'document.querySelector(".vp-modal .vp-live-phone, .vp-modal .vp-live-tv")'}
            S = run_pair(B, sid, SAN, mode, tvk, phk, key, 'san-%d' % w, dpr, box, hide_modal=True)
            judge(tag, mode, S)
            if mode in ('raffle', 'members'):
                flags = [(s['tv'] or {}).get('layer') != (s['ph'] or {}).get('layer') for s in S]
                ok('%s %s: the room TV and "The big screen" on the same screen at every sample (%d)' % (tag, mode, len(S)), len(S) >= 20 and not runs_of_two(flags),
                   [((s['tv'] or {}).get('layer'), (s['ph'] or {}).get('layer')) for s, f in zip(S, flags) if f][:4])
        finally:
            B.close_tab(tid)


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('demo-pairs-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), NL.Site); srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    widths = [int(x) for x in (os.environ.get('VP_DEMO_WIDTHS') or '').split(',') if x.strip()]
    B = VL.Browser()
    try:
        pages = (os.environ.get('VP_DEMO_PAGES') or 'home,san').split(',')   # the report run splits the pages over parallel runs
        if 'home' in pages:
            for w in (widths or [1440]):
                home(B, base, w, 900 if w > 500 else 812)
        if 'san' in pages:
            for w in (widths or [375]):
                see_a_night(B, base, w, 900 if w > 500 else 812)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
