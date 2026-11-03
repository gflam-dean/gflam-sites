#!/usr/bin/env python3
"""THE TRIVIA LOBBY IS THE NEW JOIN WHEREVER IT IS PAINTED (4 Nov 2026).

Dean approved the new trivia join on 3 Nov (the QR big on the left, SCAN TO PLAY, "or go to
venueplay.com.au/play", the code in a pink-edged box, TRIVIA on the logos' line, no player count). The
start-show frames he was sent at 1:46am on 4 Nov still showed the OLD lobby ("JOIN THE TRIVIA" over the QR,
"TRIVIA NIGHT", a yellow code box, the tiny "Grab your phone" line), because they were taken on a tree
that did not have the new look yet. trivia-newlook-in-chrome.test.py measures the new join on the demo
with the show off. This opens every way the trivia lobby reaches a screen, and fails on the old one:

  - the demo (/app/trivia/screen?demo=1) with the start show ON, on the show's last frame and after it
  - the home page's demo TV and /see-a-night's room scene, which iframe the real demo wall
  - a REAL room: a signed-in trivia host opens the lobby on the browser rig (the real game Worker in jsc),
    and tv.html on the venue's link shows it in its game frame

Musical bingo and bingo keep their own lobbies for now (their new look is the next build).

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/trivia-join-in-chrome.test.py
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


# What the lobby paints, read from the page's own document (the sales pages': their iframe's).
# (4 Nov 2026) The start-show frames Dean was sent at 1:46am
# showed the OLD trivia lobby ("JOIN THE TRIVIA" over the QR, "TRIVIA NIGHT", a yellow code box, the tiny "Grab
# your phone" line): they were taken on a tree that did not have the new look yet. The checks above open the demo
# with the show off; these open every way the trivia lobby reaches a screen and fail on the old one:
#   - the demo with the start show ON, on the show's last frame and after it (the frame Dean was sent)
#   - the home page's demo TV and /see-a-night's, which iframe the real demo wall
#   - a REAL room: a signed-in trivia host opens the lobby and tv.html shows it in its game frame
JOIN_PROBE = r'''(function(d){ if(!d) return null; var L=d.getElementById("tvLobby"); if(!L) return {none:1};
  var gs=function(e){ return d.defaultView.getComputedStyle(e); };
  function vis(e){ if(!e) return false; var s=gs(e), b=e.getBoundingClientRect(); return s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0; }
  var cb=L.querySelector(".codebox"), cv=d.getElementById("lobbyCode"), sc=L.querySelector(".scanplay"), sub=d.getElementById("lobbySub"), jr=L.querySelector(".jor");
  var olds=[].filter.call(L.querySelectorAll("*"),function(e){ return !e.children.length && vis(e) && /join the trivia|trivia night|grab your phone/i.test(e.textContent||""); }).map(function(e){ return (e.className||e.tagName)+": "+e.textContent.trim().slice(0,40); });
  return { shown: vis(L), scan: !!sc && vis(sc) && /^scan to play$/i.test(sc.textContent.trim()), border: cb ? gs(cb).borderTopColor : "", codeCol: cv ? gs(cv).color : "",
    code: cv ? cv.textContent : "", title: vis(L.querySelector(".tl-night")) ? L.querySelector(".tl-night").textContent.trim() : "",
    orgo: (jr && vis(jr) ? jr.textContent : "") + (d.getElementById("lobbyJoinUrl")||{}).textContent, sub: vis(sub), olds: olds, joined: /joined/i.test(L.innerText||"") };
})'''

def join_checks(tag, j, code=None):
    j = j or {}
    ok(tag + ': the trivia lobby is on screen', j.get('shown') is True, j)
    ok(tag + ': SCAN TO PLAY, the new join', j.get('scan') is True, j)
    ok(tag + ': none of the OLD lobby is painted ("JOIN THE TRIVIA", "TRIVIA NIGHT", "Grab your phone")', j.get('olds') == [] and j.get('sub') is False, [j.get('olds'), j.get('sub')])
    ok(tag + ': the code in the pink-edged box, in white (the old one was yellow)', j.get('border') == 'rgb(255, 31, 142)' and j.get('codeCol') == 'rgb(255, 255, 255)'
       and (code is None or j.get('code') == code), [j.get('border'), j.get('codeCol'), j.get('code')])
    ok(tag + ': "or go to venueplay.com.au/play", and TRIVIA on the logos\' line', (j.get('orgo') or '').replace('\xa0', ' ').strip() == 'or go to venueplay.com.au/play'
       and j.get('title') == 'Trivia', [j.get('orgo'), j.get('title')])
    ok(tag + ': no player count on the lobby', j.get('joined') is False, j.get('joined'))


def join_everywhere():
    print('\nTHE NEW JOIN EVERYWHERE THE TRIVIA LOBBY IS PAINTED')
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import rig as RIG
    r = RIG.Rig(host_pages=('/app/trivia/host.html',))
    try:
        # the demo with the start show ON (the default), driven by hand to its last frame (3.6 s), then over
        tid, sid = r.open('/app/trivia/screen?demo=1', before='window.__vpStingManual=true;', width=1920, height=1080)
        ok('demo, show on: "started" plays the start show', r.until(sid, 'window.VPSting && VPSting.playing()', 15) is True, r.ask(sid, '(window.VPSting?VPSting.stats():null)'))
        r.ask(sid, 'VPSting.frame(3.6); true'); time.sleep(0.4)
        join_checks('demo, the show\'s last frame (3.6 s)', r.ask(sid, JOIN_PROBE + '(document)'), 'VENUE2')
        r.ask(sid, 'VPSting.frame(9); true'); time.sleep(0.4)
        join_checks('demo, after the show', r.ask(sid, JOIN_PROBE + '(document)'), 'VENUE2')
        r.close_tab(tid)

        # the sales pages: the real demo wall in their own frame
        FR = '(function(f){return f && /trivia\\/screen/.test(f.src) && f.contentDocument && f.contentDocument.getElementById("lobbyCode") && f.contentDocument.getElementById("lobbyCode").textContent==="VENUE2" ? f.contentDocument : null;})'
        tid, sid = r.open('/', width=1440, height=900)
        r.until(sid, 'document.readyState==="complete" && !!document.querySelector(\'#h2Modes [data-mode="trivia"]\')', 20)
        r.ask(sid, 'document.querySelector(\'#h2Modes [data-mode="trivia"]\').click(); true')
        HOME = FR + '(document.getElementById("h2Tv"))'
        ok('home page: the Trivia chip puts the real trivia demo wall in the TV', r.until(sid, '!!' + HOME, 20) is True, r.ask(sid, '(document.getElementById("h2Tv")||{}).src'))
        join_checks('home page demo', r.ask(sid, JOIN_PROBE + '(' + HOME + ')'), 'VENUE2')
        r.close_tab(tid)
        tid, sid = r.open('/see-a-night', width=1440, height=900)
        SAN = FR + '([].filter.call(document.querySelectorAll("iframe"),function(f){return /trivia\\/screen/.test(f.src);})[0])'
        ok('/see-a-night: the real trivia demo wall is in the room scene', r.until(sid, '!!' + SAN, 25) is True,
           r.ask(sid, 'JSON.stringify([].map.call(document.querySelectorAll("iframe"),function(f){return f.src;}))'))
        join_checks('/see-a-night demo', r.ask(sid, JOIN_PROBE + '(' + SAN + ')'), 'VENUE2')
        r.close_tab(tid)

        # a real room: the TV on the venue's link, a signed-in trivia host opens the lobby
        r.db['vp_question_sets'] = [{'id': '33333333-3333-4333-8333-333333333333', 'title': 'Pub Classics', 'question_count': 10,
                                     'visibility': 'public', 'owner_venue_id': None, 'status': 'active'}]
        t1, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1920, height=1080)
        r.until(tv, '!!document.getElementById("adsRoot")', 15)
        t2, host = r.open('/app/trivia/host.html?venue=' + r.W.info['venue'], width=1280, height=900)
        r.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 25); time.sleep(2)
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(2)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(2)
        ok('real room: the host opens the trivia lobby', r.until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 15) is True,
           r.ask(host, 'document.getElementById("startBtn").textContent+" | "+((document.getElementById("hostErrText")||{}).textContent||"")'))
        GF = '(function(f){return f && f.style.display!=="none" && /trivia\\/screen/.test(f.src) && f.contentDocument && f.contentDocument.getElementById("lobbyCode") && /^[A-Z0-9]{6}$/.test(f.contentDocument.getElementById("lobbyCode").textContent) ? f.contentDocument : null;})(document.getElementById("gameFrame"))'
        ok('real room: tv.html puts the trivia wall in its game frame, with the room\'s code', r.until(tv, '!!' + GF, 30) is True, r.ask(tv, '(document.getElementById("gameFrame")||{}).src'))
        time.sleep(1.5)
        join_checks('real room, tv.html', r.ask(tv, JOIN_PROBE + '(' + GF + ')'))
        if SHOTS: r.shot(tv, os.path.join(SHOTS, 'newlook-real-room-lobby-1920.jpg'))
        ok('real room: no script errors on the TV', r.ask(tv, 'window.__errs.length') == 0, r.ask(tv, 'JSON.stringify(window.__errs)'))
        r.close_tab(t2); r.close_tab(t1)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-join-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    join_everywhere()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
