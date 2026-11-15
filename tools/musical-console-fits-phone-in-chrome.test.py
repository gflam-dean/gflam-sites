#!/usr/bin/env python3
"""THE MUSICAL BINGO HOST CONSOLE FITS ONE PHONE SCREEN DURING A GAME (Dean, live, 15 Nov 2026).

Dean: "my one rule is to make everything easier". During a game the "TV reveals" select, the room volume slider,
the sound monitor, "This song did not work", the Spotify links and note, and the three stat boxes sat between
Play song and the Claims, so on a phone the Claims were below the fold.

This opens a REAL room on the browser rig (a signed-in musical host, the real game Worker in jsc), opens the lobby,
starts the game on a phone-sized console, and at 375x667 and 390x844 checks, before the first song, after a
song is played, and with a phone's claim in:

  - the page is not scrolled and has no sideways scroll
  - Play song (#playNextBtn) is wholly inside the screen
  - the Claims heading and the claim queue's first box (the empty note, or the claim's name line) are inside it
  - the settings are behind one closed "Settings" control (#hostSettings) and that control sits BELOW the claim
    queue, never above it (put the rows back on top of the Claims and this goes red)

and that the settings still work from there: opened, the "TV reveals" select is on screen and a change saves it
for the next game (vpMusicReveal), and the volume slider still saves (vpMusicVolume).

PNG screenshots of each state at each size go to $VP_SHOTS when it is set.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/musical-console-fits-phone-in-chrome.test.py
"""
import base64, json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
SIZES = ((375, 667), (390, 844))


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


# Record every realtime channel the page opens, so the test can speak on the console's own channel as a phone does
# (the same trick as tools/musical-host-titles-in-chrome.test.py).
BEFORE = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
          'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();')
CELLS = [0 if i == 12 else {'song_id': 'song-%02d' % i, 'title': 'Song %d' % i} for i in range(25)]
CLAIM = r'''(function(cells){
  var names=(window.__bcNames||[]).filter(function(n){return /^fake-rt:vp-/.test(n);}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    b.postMessage({event:"msg", payload:{t:"claim", claim_id:"claim-fit", pid:"p-fit", name:"Ann", cardNo:"042", cells:cells, claimed_at:new Date().toISOString()}});
    setTimeout(function(){ try{ b.close(); }catch(e){} }, 500); });
  return Object.keys(seen).length;
})'''

MEASURE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); if(!(b.width>0 && b.height>0)) return null; return {top:Math.round(b.top), bottom:Math.round(b.bottom)}; }
  /* a row inside a CLOSED <details> keeps a box in Chrome, so "painted" is checkVisibility(), not the box */
  function V(e){ return (e && e.checkVisibility && !e.checkVisibility()) ? null : R(e); }
  var q=document.getElementById("claimQueue"), first=q && q.firstElementChild;
  if(first && first.classList.contains("claimnote")) first=first.nextElementSibling;
  var top=first && (first.querySelector(".top")||first);
  var hs=document.getElementById("hostSettings"), sum=hs && hs.querySelector("summary");
  return JSON.stringify({ h:innerHeight, w:innerWidth, sy:Math.round(scrollY||0), sw:document.documentElement.scrollWidth,
    play:R(document.getElementById("playNextBtn")), playText:(document.getElementById("playNextBtn")||{}).textContent,
    head:R(document.getElementById("claimHead")), first:R(top), firstText: first ? first.textContent.replace(/\s+/g," ").trim().slice(0,60) : null,
    queue:R(q), settings:R(hs), summary:R(sum), summaryText: sum ? sum.textContent.replace(/\s+/g," ").trim() : null, open: hs ? !!hs.open : null,
    reveal:V(document.getElementById("revealSelLive")), vol:V(document.getElementById("volRange")), monitor:V(document.getElementById("monitorBtn")),
    flag:V(document.getElementById("flagSongBtn")), spotify:V(document.getElementById("spotifyBtn")) });
})()'''

ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")+" | "+JSON.stringify(window.__errs)'
RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'


def size(r, sid, w, h):
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    time.sleep(0.6)
    r.ask(sid, 'window.scrollTo(0,0); true')
    time.sleep(0.3)


def png(r, sid, name):
    if not SHOTS: return
    try:
        d = r.B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        with open(os.path.join(SHOTS, name), 'wb') as f: f.write(base64.b64decode(d['data']))
    except Exception as e:
        print('  (screenshot %s not saved: %s)' % (name, e))


def fits(r, sid, state, first_has):
    for (w, h) in SIZES:
        size(r, sid, w, h)
        # the rig's headless TV has no sound, so the console's red bar says so over the top: the host taps Dismiss
        r.ask(sid, '(function(){ var x=document.getElementById("hostErrX"), b=document.getElementById("hostErrBar"); if(x && b && b.classList.contains("show")) x.click(); return true; })()')
        time.sleep(0.3)
        m = r.json(sid, MEASURE)
        tag = '%s at %dx%d' % (state, w, h)
        png(r, sid, 'musical-host-%s-%dx%d.png' % (state, w, h))
        p, hd, f, s = m.get('play'), m.get('head'), m.get('first'), m.get('settings')
        ok(tag + ': the page is not scrolled and nothing runs off the side', m['sy'] == 0 and m['sw'] <= m['w'], m)
        ok(tag + ': Play song is wholly on screen', bool(p) and p['top'] >= 0 and p['bottom'] <= m['h'], m)
        ok(tag + ': the Claims heading and the first claim line (%s) are on screen' % first_has,
           bool(hd) and bool(f) and hd['top'] >= 0 and f['bottom'] <= m['h'] and first_has in (m.get('firstText') or ''), m)
        ok(tag + ': the settings are closed, behind one "Settings" control', m['open'] is False and bool(m['summary'])
           and (m['summaryText'] or '').startswith('Settings') and not any(m[k] for k in ('reveal', 'vol', 'monitor', 'flag', 'spotify')), m)
        ok(tag + ': and that control sits below the claim queue, never above the Claims',
           bool(s) and bool(m.get('queue')) and bool(hd) and s['top'] >= m['queue']['bottom'] and s['top'] > hd['bottom'] and bool(p) and s['top'] > p['bottom'], m)


def play():
    print('\nTHE MUSICAL BINGO HOST CONSOLE ON A PHONE (a real room)')
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import rig as RIG
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        t1, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1920, height=1080)   # a screen on, as in a venue (no "No screen is connected" bar)
        r.until(tv, '!!document.getElementById("adsRoot")', 20)
        tid, h = r.open('/app/musical/host.html', before=BEFORE, width=390, height=844)
        ok('CONTROL: the musical console loads, signed in', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(3)
        r.ask(h, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        r.until(h, LOBBY, 15)
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        ok('CONTROL: a game is running (lobby opened, then Start game)', r.until(h, RUNNING, 20) is True, r.ask(h, ERRT))
        time.sleep(1)
        fits(r, h, 'start', 'No claims yet')

        r.ask(h, 'document.getElementById("playNextBtn").click(); true')
        ok('CONTROL: a song is played (Played so far shows it)', r.until(h, 'document.querySelectorAll("#playedStrip .pn").length>=1', 15) is True,
           r.ask(h, 'document.getElementById("playedStrip").innerText'))
        time.sleep(0.5)
        fits(r, h, 'song', 'No claims yet')

        # THE SETTINGS STILL WORK FROM THERE
        size(r, h, 390, 844)
        r.ask(h, '(function(){ var s=document.querySelector("#hostSettings summary"); if(s) s.click(); return true; })()'); time.sleep(0.5)
        r.ask(h, '(function(){ var e=document.getElementById("hostSettings"); if(e) e.scrollIntoView({block:"start"}); return true; })()'); time.sleep(0.4)
        s = r.json(h, '(function(){ var e=document.getElementById("revealSelLive"), b=e.getBoundingClientRect(), hs=document.getElementById("hostSettings");'
                      'return JSON.stringify({open:!!hs && hs.open, on:b.height>0 && b.top>=0 && b.bottom<=innerHeight, vis:!!e.checkVisibility()}); })()')
        ok('opened, the Settings show the "TV reveals" select on screen', s.get('open') is True and s.get('on') is True and s.get('vis') is True, s)
        r.ask(h, '(function(){ var x=document.getElementById("hostErrX"), b=document.getElementById("hostErrBar"); if(x && b && b.classList.contains("show")) x.click(); return true; })()'); time.sleep(0.3)
        png(r, h, 'musical-host-settings-open-390x844.png')
        r.ask(h, 'var e=document.getElementById("revealSelLive"); e.value="never"; e.dispatchEvent(new Event("change")); true'); time.sleep(0.3)
        r.ask(h, 'var v=document.getElementById("volRange"); v.value="300"; v.dispatchEvent(new Event("input")); v.dispatchEvent(new Event("change")); true'); time.sleep(0.3)
        sv = r.json(h, 'JSON.stringify({reveal:localStorage.getItem("vpMusicReveal"), vol:localStorage.getItem("vpMusicVolume"), volText:document.getElementById("volVal").textContent})')
        ok('a change of "TV reveals" there saves it for the venue, as before', sv.get('reveal') == 'never', sv)
        ok('and the room volume slider still saves', sv.get('vol') == '300' and '300' in (sv.get('volText') or ''), sv)
        r.ask(h, 'var e=document.getElementById("revealSelLive"); e.value="end"; e.dispatchEvent(new Event("change")); var hs=document.getElementById("hostSettings"); if(hs) hs.open=false; window.scrollTo(0,0); true')
        time.sleep(0.4)

        for _ in range(3):
            r.ask(h, CLAIM + '(%s)' % json.dumps(CELLS))
            if r.until(h, 'document.querySelectorAll("#claimQueue .claimcard").length>=1', 6) is True: break
        ok('CONTROL: a phone\'s claim reaches the console', r.ask(h, 'document.querySelectorAll("#claimQueue .claimcard").length') >= 1,
           r.ask(h, 'document.getElementById("claimQueue").innerText.slice(0,200)'))
        time.sleep(1.2)
        fits(r, h, 'claim', 'Ann')
        ok('no script errors on the console', r.ask(h, 'window.__errs.length') == 0, r.ask(h, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid); r.close_tab(t1)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('musical-console-fits-phone-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    try:
        play()
    except Exception:
        import traceback; traceback.print_exc()
        global bad; bad += 1
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
