#!/usr/bin/env python3
"""A CLOSE THAT NEVER LANDED LEAVES NO GHOST "OTHER DEVICE", AND A BLOCKED TV IS TOLD TO THE HOST AT ONCE
(Dean's live play at Test Alpha, 6 Nov 2026: findings I, C and C2).

Runs the REAL musical console in headless Chrome (tools/browser-rig/rig.py: the real game Worker in jsc, the
host signed in) in two scenes.

  Scene 1, the ghost. A host opens a musical lobby in one window. Another window of the SAME browser then opens
    a lobby too (a second tab; or the same tablet after a page was closed):
      control   nothing was waiting to close: the second window is asked "already open on another device"
      the case  the first window's Close lobby never reached the server (it is still flagged closing in this
                browser's storage): the waiting close goes to the Worker FIRST, the question is NOT asked, and
                the second window ends up with the one live lobby on the venue's code (the old night finished,
                not reused and then closed under the room)
  Scene 2, the sound. The TV says its sound is blocked (the reply every TV now carries): the console puts the song
    on its own speaker at once and says so in a bar; the TV recovers and the bar and the speaker go. Shot at
    375 wide and at the short iPhone Safari viewport 390 x 664 (VP_SHOTS=<dir>).

    python3 tools/session-lifecycle-in-chrome.test.py
"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
ASKED = '!!document.getElementById("vpTakeover")'
BEFORE = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
          'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();')
TELL = r'''(function(payload){
  var names=(window.__bcNames||[]).filter(function(n){return /^fake-rt:vp-/.test(n);}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    b.postMessage({event:"msg", payload:payload}); setTimeout(function(){ try{ b.close(); }catch(e){} }, 400); });
  return Object.keys(seen).length;
})'''


def live_sessions(r):
    # The Worker's own answer, asked the way a phone asks it: which lobby is on at this venue's code.
    code = r.W.info['code']
    a = r.W.ask('GET', '/play/live?code=%s&fresh=1' % code)
    return a.get('body') or {}


def scene_ghost():
    print('\nScene 1: a close that never landed leaves no ghost "other device"')
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        # ---- a lobby in window A
        ta, a = r.open('/app/musical/host.html', before=BEFORE, width=1024, height=768)
        ok('CONTROL: window A loads the musical console, signed in', r.until(a, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(2)
        r.ask(a, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(a, 'document.getElementById("startBtn").click(); true')
        ok('CONTROL: window A has a musical lobby open', r.until(a, LOBBY, 20) is True)
        ok('CONTROL: the Worker has that lobby live on the venue code', live_sessions(r).get('live') is True, live_sessions(r))
        recs = r.json(a, 'localStorage.getItem("vpOpenSessions")||"[]"', [])
        ok('CONTROL: window A noted its night (stamped, not closing) in this browser', len(recs) == 1 and recs[0].get('closing') is False and isinstance(recs[0].get('seen'), (int, float)), recs)
        s1 = recs[0]['id'] if recs else ''

        # ---- the control: window B is asked, because nothing was waiting
        tb, b = r.open('/app/musical/host.html', before=BEFORE, width=1024, height=768)
        ok('CONTROL: window B loads', r.until(b, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(2)
        r.ask(b, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(b, 'document.getElementById("startBtn").click(); true')
        asked = r.until(b, ASKED, 15)
        ok('CONTROL: a second window is asked "already open on another device" when nothing is waiting to close', asked is True, r.ask(b, '(document.body.innerText||"").slice(0,200)'))
        r.ask(b, 'var x=document.getElementById("vpTakeoverNo"); if(x) x.click(); true')
        time.sleep(1)
        ok('CONTROL: answering Cancel leaves the first lobby alone', live_sessions(r).get('live') is True)
        r.close_tab(tb)

        # ---- the case: window A's Close lobby never reached the server
        r.ask(a, '''(function(){var l=JSON.parse(localStorage.getItem("vpOpenSessions")||"[]"); l.forEach(function(x){x.closing=true;}); localStorage.setItem("vpOpenSessions", JSON.stringify(l)); return l.length;})()''')
        r.close_tab(ta)            # the first tab is CLOSED, as in Dean's case: nothing is running the lobby any more
        time.sleep(8)              # long enough for its one-tab claim to lapse
        r.W.calls[:] = []
        tc, c = r.open('/app/musical/host.html', before=BEFORE, width=1024, height=768)
        ok('window C loads', r.until(c, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(2)
        r.ask(c, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(c, 'document.getElementById("startBtn").click(); true')
        opened = r.until(c, LOBBY + ' || ' + ASKED, 25)
        ok('with a close waiting, the "already open on another device" question is NOT asked', r.ask(c, ASKED) is not True, r.ask(c, '(document.body.innerText||"").slice(0,200)'))
        ok('and window C gets its lobby', r.until(c, LOBBY, 15) is True,
           r.ask(c, '((document.getElementById("hostErrText")||{}).textContent||"")+" | "+(document.getElementById("startBtn")||{}).textContent+" | "+JSON.stringify(window.__errs)+" | "+((document.getElementById("vpTakeover")||{}).innerText||"")') + ' | calls ' + ','.join(r.W.calls))
        calls = [p for p in r.W.calls if p in ('/session/close', '/session', '/play/live')]
        ok('the waiting close went to the Worker BEFORE the question and the new session', '/session/close' in calls and '/session' in calls and calls.index('/session/close') < calls.index('/play/live') < calls.index('/session'), calls)
        lv = live_sessions(r)
        ok('the venue has ONE live lobby afterwards, on the venue code, musical', lv.get('live') is True and lv.get('format') == 'musical_bingo' and lv.get('join_code') == r.W.info['code'], lv)
        recs2 = r.json(c, 'localStorage.getItem("vpOpenSessions")||"[]"', [])
        ok('window C holds the new night; the old one was closed and dropped from the list', any(x['id'] != s1 and not x.get('closing') for x in recs2) and all(x['id'] != s1 for x in recs2), recs2)
        ok('no script errors on window C', r.ask(c, 'window.__errs.length') == 0, r.ask(c, 'JSON.stringify(window.__errs)'))
        r.close_tab(tc)
    finally:
        r.close()


def scene_sound():
    print('\nScene 2: the TV says its sound is blocked, and the console plays it at once')
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        tid, h = r.open('/app/musical/host.html', before=BEFORE, width=1024, height=768)
        ok('CONTROL: the console loads, signed in', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(2)
        r.ask(h, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        r.until(h, LOBBY, 15)
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        ok('CONTROL: a game is running', r.until(h, RUNNING, 20) is True, r.ask(h, '(document.getElementById("hostErrText")||{}).textContent'))
        note_vis = '(function(){var n=document.getElementById("tvAudioNote"); return !!n && !n.classList.contains("hidden") && n.offsetHeight>0;})()'
        ok('CONTROL: no sound warning while the TV has said nothing', r.ask(h, note_vis) is not True)
        r.ask(h, TELL + '(%s)' % json.dumps({'t': 'tv_here', 'audio': 'blocked'}))
        ok('the TV reports blocked sound: the bar shows at once, before any song has played', r.until(h, note_vis, 8) is True, r.ask(h, '(document.getElementById("tvAudioNote")||{}).className'))
        ok('and says which device is playing', 'THIS device' in (r.ask(h, 'document.getElementById("tvAudioNote").textContent') or ''), r.ask(h, 'document.getElementById("tvAudioNote").textContent'))
        ok('the sound button names the device too', 'THIS device only' in (r.ask(h, 'document.getElementById("monitorBtn").textContent') or ''), r.ask(h, 'document.getElementById("monitorBtn").textContent'))
        ok('and this device is not muted', r.ask(h, 'document.querySelector("audio").muted') is False, r.ask(h, 'document.querySelector("audio").muted'))
        for w, hgt, name in ((375, 667, 'lifecycle-musical-host-sound-blocked-375'), (390, 664, 'lifecycle-musical-host-sound-blocked-390x664')):
            r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': hgt, 'deviceScaleFactor': 2, 'mobile': True}, session=h)
            time.sleep(1.0)
            r.ask(h, 'var n=document.getElementById("tvAudioNote"); if(n&&n.scrollIntoView) n.scrollIntoView({block:"center"}); true')
            time.sleep(0.6)
            ok('at %d wide the bar is inside the screen, nothing wider than the page' % w,
               r.ask(h, '(function(){var n=document.getElementById("tvAudioNote").getBoundingClientRect(); return n.left>=0 && n.right<=window.innerWidth+1 && document.documentElement.scrollWidth<=window.innerWidth+1;})()') is True,
               r.ask(h, 'JSON.stringify([document.documentElement.scrollWidth, window.innerWidth])'))
            shot(r, h, name)
        r.ask(h, TELL + '(%s)' % json.dumps({'t': 'tv_here', 'audio': 'ok'}))
        ok('the TV recovers: the bar goes', r.until(h, '!' + note_vis, 8) is True)
        ok('and the console goes quiet again', r.ask(h, 'document.querySelector("audio").muted') is True, r.ask(h, 'document.querySelector("audio").muted'))
        ok('no script errors on the musical console', r.ask(h, 'window.__errs.length') == 0, r.ask(h, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()


for scene in [x for x in (scene_ghost, scene_sound) if os.environ.get('VP_SCENE', x.__name__) == x.__name__]:
    try:
        scene()
    except Exception:
        import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
