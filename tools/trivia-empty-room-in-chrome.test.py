#!/usr/bin/env python3
"""TRIVIA WITH NOBODY JOINED, AS A HOST AND A TV SEE IT (live fault, Fri 6 Nov 2026, The Mini Bar).

Dean ran trivia on The Mini Bar with no phones joined and tapped Reveal leaderboard. The console said
"Scores could not be loaded, so the podium was not put on the screen. Check your connection ...", which was
wrong: the connection was fine and there were simply no players. This opens a REAL room on the browser rig
(a signed-in trivia host and tv.html on the venue's link, the real game Worker in jsc), plays a two-question
quiz with no phones, and checks what the host reads and what the wall paints:

  - the between-question auto leaderboard, with nobody joined: the TV shows "Thanks for playing" and the
    join code for next time, never an empty Leaderboard
  - Reveal leaderboard with nobody joined: the console says, plainly, "Nobody has joined this game yet, so
    there are no scores to show. Players join with the code on the TV.", the red error bar stays down, and
    the TV shows the same calm end state with no error word on it
  - the REAL "could not be loaded" message is kept for a real fetch failure with players present

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/trivia-empty-room-in-chrome.test.py
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
SET = '33333333-3333-4333-8333-333333333333'
NOBODY = 'Nobody has joined this game yet, so there are no scores to show. Players join with the code on the TV.'


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


# A console window of the same origin, speaking on the phones' channel (the rig's realtime stand-in carries channel
# "vp-<code>" on BroadcastChannel "fake-rt:vp-<code>"), the way a trivia phone's join does.
SAY = r'''(function(code, payload){
  var b=new BroadcastChannel("fake-rt:vp-"+code);
  b.postMessage({event:"msg", payload:payload});
  setTimeout(function(){ try{ b.close(); }catch(e){} }, 500);
  return true;
})'''

# What the TV's trivia wall paints, read from tv.html's game frame.
TV = r'''(function(){ var f=document.getElementById("gameFrame"), d=f && f.contentDocument; if(!d) return JSON.stringify({none:1});
  function shown(e){ if(!e) return false; var s=d.defaultView.getComputedStyle(e), b=e.getBoundingClientRect(); return !e.classList.contains("hidden") && s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0; }
  var lay=[].filter.call(d.querySelectorAll(".layer"),function(l){ return shown(l); })[0];
  var j=d.getElementById("tvJoinCorner"), code=d.getElementById("tvJoinCode");
  return JSON.stringify({ layer: lay ? lay.id : null, title: (d.getElementById("tvBoardTitle")||{}).textContent||"", rows: d.querySelectorAll("#tvBoardRows .brow").length,
    text: lay ? lay.innerText : "", join: shown(j), joinCode: code ? code.textContent : "", errs: (f.contentWindow.__errs||[]).length }); })()'''
HOSTP = r'''(function(){ var n=document.getElementById("noPlayersNote"), b=document.getElementById("hostErrBar"), t=document.getElementById("hostErrText");
  var btns=[].map.call(document.querySelectorAll("#runBody .btn, .btn.big"),function(x){ return x.textContent.trim(); });
  return JSON.stringify({ note: n ? n.textContent : null, noteShown: !!n && n.getBoundingClientRect().height>0, errUp: !!b && b.classList.contains("show"), errText: t ? t.textContent : "",
    status: (document.getElementById('startBtn')||{}).textContent, btns: btns }); })()'''


ERRT = 'JSON.stringify([(document.getElementById("hostErrText")||{}).textContent, [].map.call(document.querySelectorAll("button"),function(x){return x.textContent.trim();}).join("|")])'


def click_btn(r, sid, text):
    return r.ask(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(text))


def wait_btn(r, sid, text, secs=25):
    return r.until(sid, '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(text), secs)


def play():
    print('\nTRIVIA WITH NOBODY JOINED (a real room, no phones)')
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import rig as RIG
    r = RIG.Rig(host_pages=('/app/trivia/host.html',))
    try:
        r.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': 2, 'visibility': 'public', 'owner_venue_id': r.W.info['venue'], 'status': 'active'}]
        r.W.seed('vp_question_sets', [{'id': SET, 'title': 'Pub Classics', 'question_count': 2, 'visibility': 'public', 'owner_venue_id': r.W.info['venue'], 'status': 'active'}])
        r.W.seed('vp_questions', [{'id': 'q-%d' % i, 'set_id': SET, 'seq': i, 'question': 'Question %d?' % i, 'text': 'Question %d?' % i,
                                   'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2} for i in (1, 2)])
        t1, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1920, height=1080)
        r.until(tv, '!!document.getElementById("adsRoot")', 15)
        t2, host = r.open('/app/trivia/host.html?venue=' + r.W.info['venue'], width=1280, height=900)
        r.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 25); time.sleep(2)
        r.ask(host, 'document.getElementById("cfgCount").value="2"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true')
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(2)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(2)
        ok('the host opens the lobby', r.until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 15) is True,
           r.ask(host, '((document.getElementById("hostErrText")||{}).textContent||"")'))
        ok('and nobody joins: the console counts 0 players', r.ask(host, 'document.getElementById("playerCount").textContent') == '0')
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(1)
        for _ in range(3):
            if r.ask(host, '!!document.getElementById("vpAskGo") || !!document.querySelector(".vp-ask button")') is True:
                r.ask(host, '(function(){ var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); b.click(); return true; })()'); time.sleep(1)
        ok('the round starts: the console offers the first question', wait_btn(r, host, 'First question', 30) is True, r.ask(host, ERRT))
        click_btn(r, host, 'First question')
        ok('the first question is up', wait_btn(r, host, 'Reveal answer', 30) is True, r.ask(host, ERRT))
        click_btn(r, host, 'Reveal answer')
        ok('and revealed', wait_btn(r, host, 'Next question', 20) is True, r.ask(host, ERRT))

        # 1. THE BETWEEN-QUESTION AUTO LEADERBOARD, with nobody joined
        print('the between-question leaderboard, nobody joined')
        ok('the TV shows "Thanks for playing" after the 5 second wait, not an empty Leaderboard',
           r.until(tv, '(function(){var f=document.getElementById("gameFrame"), d=f&&f.contentDocument; var t=d&&d.getElementById("tvBoardTitle"); return !!t && /Thanks for playing/.test(t.textContent) && !d.getElementById("tvBoard").classList.contains("hidden");})()', 25) is True,
           r.ask(tv, TV))
        w = json.loads(r.ask(tv, TV))
        ok('  on the board layer, no score rows, the join code for next time in the corner', w.get('layer') == 'tvBoard' and w.get('rows') == 0 and w.get('join') is True
           and len(w.get('joinCode') or '') == 6, w)
        ok('  no error words on the wall', not any(x in (w.get('text') or '').lower() for x in ('could not', 'error', 'failed', 'check your connection')), w.get('text'))
        if SHOTS: r.shot(tv, os.path.join(SHOTS, 'no-players-auto-board-1920.jpg'))

        # 2. REVEAL LEADERBOARD, nobody joined
        print('Reveal leaderboard, nobody joined')
        click_btn(r, host, 'Next question')
        ok('question two is up', wait_btn(r, host, 'Reveal answer', 30) is True, r.ask(host, ERRT))
        click_btn(r, host, 'Reveal answer')
        ok('and revealed: the button now reads Reveal leaderboard', wait_btn(r, host, 'Reveal leaderboard', 20) is True, r.ask(host, ERRT))
        click_btn(r, host, 'Reveal leaderboard')
        r.until(host, '!!document.getElementById("noPlayersNote") || document.getElementById("hostErrBar").classList.contains("show")', 15)
        h = json.loads(r.ask(host, HOSTP))
        ok('the host console says it plainly, word for word', h.get('note') == NOBODY, h)
        ok('the line is on screen', h.get('noteShown') is True, h)
        ok('there is NO error: the red bar is down and nothing says "could not be loaded"', h.get('errUp') is False and 'could not be loaded' not in (h.get('errText') or ''), h)
        ok('the host still has Reveal leaderboard to tap (nothing is ended)', 'Reveal leaderboard' in (h.get('btns') or []), h)
        r.until(tv, '(function(){var f=document.getElementById("gameFrame"), d=f&&f.contentDocument; var t=d&&d.getElementById("tvBoardTitle"); return !!t && /Thanks for playing/.test(t.textContent);})()', 15)
        w = json.loads(r.ask(tv, TV))
        ok('the TV shows "Thanks for playing" with the join code for next time', w.get('layer') == 'tvBoard' and 'Thanks for playing' in (w.get('title') or '') and w.get('join') is True
           and len(w.get('joinCode') or '') == 6, w)
        ok('the TV has no podium and no score rows', w.get('rows') == 0 and w.get('layer') != 'tvPodium', w)
        ok('the TV paints no error word', not any(x in (w.get('text') or '').lower() for x in ('could not', 'error', 'failed', 'check your connection')), w.get('text'))
        ok('no script errors on the TV or the console', r.ask(tv, 'window.__errs.length') == 0 and r.ask(host, 'window.__errs.length') == 0,
           [r.ask(tv, 'JSON.stringify(window.__errs)'), r.ask(host, 'JSON.stringify(window.__errs)')])
        if SHOTS:
            r.shot(tv, os.path.join(SHOTS, 'no-players-end-tv-1920.jpg')); r.shot(host, os.path.join(SHOTS, 'no-players-end-host-1280.jpg'))

        # 3. A REAL FETCH FAILURE, with players present: the real message is kept
        print('a real fetch failure with players present')
        code = r.W.info['code']
        r.ask(host, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'join', 'fmt': 'trivia', 'pid': 'dddddddd-dddd-4ddd-8ddd-000000000001', 'name': 'Quiz Kids'})))
        ok('a team joins on the phones\' channel: the console counts 1 player', r.until(host, 'document.getElementById("playerCount").textContent==="1"', 10) is True,
           r.ask(host, 'document.getElementById("playerCount").textContent'))
        r.ask(host, 'window.__realFetch=window.fetch; window.fetch=function(u,o){ return /host\\/reveal/.test(String(u)) ? Promise.reject(new TypeError("Failed to fetch")) : window.__realFetch.apply(window,arguments); }; true')
        click_btn(r, host, 'Reveal leaderboard')
        r.until(host, 'document.getElementById("hostErrBar").classList.contains("show")', 15)
        h = json.loads(r.ask(host, HOSTP))
        ok('with a player in and the fetch failing, the real "could not be loaded" message is kept',
           h.get('errUp') is True and h.get('errText', '').startswith('Scores could not be loaded, so the podium was not put on the screen.'), h)
        ok('and the "nobody has joined" line is gone', h.get('note') is None, h)
        ok('the night is not ended: Reveal leaderboard is still there', 'Reveal leaderboard' in (h.get('btns') or []), h)
        r.ask(host, 'window.fetch=window.__realFetch; true')
        r.close_tab(t2); r.close_tab(t1)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-empty-room-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    play()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
