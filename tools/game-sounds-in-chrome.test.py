#!/usr/bin/env python3
"""GAME SOUNDS, PER GAME, ON THE REAL PAGES (Dean, 12 Nov 2026, INBOX 316; built 13 Nov 2026).

tools/test-game-sounds.js runs the sound player, the Worker's key list and the settings list. This opens the REAL
pages on the browser rig (the real game Worker in jsc behind a pipe) and checks what only a browser can:

  1. THE TRIVIA CONSOLE has a "Game sounds" row beside the time's-up buzzer: OFF to start, a compact row at a
     laptop (1280), an iPad landscape (1024) and portrait (820), a phone (390) and a short phone (375x667),
     nothing scrolls sideways, the switch is a tap target; pressing On saves game_prefs.trivia.sounds = true
     through the REAL /host/game-prefs, the console opened again shows On, and Off saves false
  2. THE SETTINGS PANEL (the shared setup, run from the console) lists "Game sounds" for
     trivia and musical bingo (More settings) and bingo, Off to start, in the same look as its neighbours
     (same height as the buzzer row's neighbours, fits at 390 and 1280); pressing On and Save keeps true
  3. A venue that never touched the setting stays Off (nothing saved says sounds)
  4. No script errors on any page

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/game-sounds-in-chrome.test.py
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


ROW = r'''(function(){ var r=document.getElementById("soundsRow"), g=document.getElementById("cfgSounds"), b=document.getElementById("buzzerRow");
  if(!r||!g) return {none:1};
  var q=r.getBoundingClientRect(), W=document.documentElement.clientWidth, bb=b.getBoundingClientRect(), btns=[].slice.call(g.querySelectorAll("button"));
  return {label:(r.querySelector("label")||{}).textContent, vis:q.width>0&&q.height>0, h:Math.round(q.height), left:Math.round(q.left), right:Math.round(q.right), W:W,
    side:document.documentElement.scrollWidth>W+1, on:btns.filter(function(x){return x.classList.contains("on");}).map(function(x){return x.textContent;}).join(),
    minH:Math.min.apply(null,btns.map(function(x){return x.getBoundingClientRect().height;})), buzzLeft:Math.round(bb.left), buzzRight:Math.round(bb.right),
    ctlRight:Math.round(g.getBoundingClientRect().right), below:q.top>=bb.bottom-1}; })()'''


def table(r, name):
    with r.W.lock:
        r.W.p.stdin.write(json.dumps({'table': name}) + '\n'); r.W.p.stdin.flush()
        line = r.W.p.stdout.readline()
    return (json.loads(line) or {}).get('body') or []


def saved(r, game, V):
    for x in table(r, 'vp_venue_settings'):
        if x.get('venue_id') == V:
            return (x.get('game_prefs') or {}).get(game) or {}
    return {}


def console(RIG):
    print('\n1. THE TRIVIA CONSOLE: the Game sounds row')
    r = RIG.Rig(host_pages=('/app/trivia/host.html',))
    try:
        V = r.W.info['venue']
        for (w, h, mobile) in ((1280, 900, False), (1024, 768, False), (820, 1180, False), (390, 844, True), (375, 667, True)):
            tid, sid = r.open('/app/trivia/host.html?venue=' + V, width=w, height=h)
            r.until(sid, '(function(){var e=document.getElementById("soundsRow"); return !!e && e.getBoundingClientRect().height>0;})()', 25)
            time.sleep(0.8)
            a = r.json(sid, ROW) or {}
            t = '%dx%d' % (w, h)
            ok(t + ': the console has a "Game sounds" row', a.get('vis') is True and a.get('label') == 'Game sounds', a)
            ok(t + ': Off to start (no venue changes by itself)', a.get('on') == 'Off', a)
            ok(t + ': nothing scrolls sideways and the row is on screen', a.get('side') is False and a.get('left', -1) >= 0 and a.get('right', 9999) <= a.get('W', 0) + 1, a)
            ok(t + ': the switch is a real tap target (at least 28px tall, the same buttons as the buzzer)', (a.get('minH') or 0) >= 28, a)
            ok(t + ': it sits under the buzzer row, same left edge, its switch at the right edge of the row like the buzzer\'s',
               a.get('below') is True and a.get('left') == a.get('buzzLeft') and abs(a.get('ctlRight', 0) - a.get('right', 99999)) <= 2, a)
            if w >= 820: ok(t + ': a compact row (no taller than 44px)', a.get('h', 999) <= 44, a)
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'console-%dx%d.jpg' % (w, h)))
            if w == 1280:
                ok('nothing is saved while the venue has not touched it', 'sounds' not in saved(r, 'trivia', V), saved(r, 'trivia', V))
                r.ask(sid, 'document.querySelector(\'#cfgSounds [data-v="on"]\').click(); true')
                for _ in range(40):
                    if saved(r, 'trivia', V).get('sounds') is True: break
                    time.sleep(0.25)
                ok('On saves game_prefs.trivia.sounds = true through the real /host/game-prefs', saved(r, 'trivia', V).get('sounds') is True, saved(r, 'trivia', V))
                ok('and the switch shows On', (r.json(sid, ROW) or {}).get('on') == 'On', r.json(sid, ROW))
                ok('no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
                r.close_tab(tid)
                tid, sid = r.open('/app/trivia/host.html?venue=' + V, width=1280, height=900)
                r.until(sid, '!!document.getElementById("statusText").getAttribute("data-conn")', 25); time.sleep(1.5)
                ok('opened again, the console shows On (it is the venue\'s, not this tab\'s)', r.until(sid, 'document.querySelector("#cfgSounds .on")&&document.querySelector("#cfgSounds .on").textContent==="On"', 15) is True, r.json(sid, ROW))
                if SHOTS: r.shot(sid, os.path.join(SHOTS, 'console-on-1280x900.jpg'))
                r.ask(sid, 'document.querySelector(\'#cfgSounds [data-v="off"]\').click(); true')
                for _ in range(40):
                    if saved(r, 'trivia', V).get('sounds') is False: break
                    time.sleep(0.25)
                ok('Off saves false', saved(r, 'trivia', V).get('sounds') is False, saved(r, 'trivia', V))
            r.close_tab(tid)
    finally:
        r.close()


PANEL = r'''(function(){ var s=document.getElementById("vpGs"); if(!s) return {none:1};
  var W=document.documentElement.clientWidth, g=s.querySelector('[aria-label="Game sounds"]'); if(!g) return {nosounds:1, side:s.scrollWidth>s.clientWidth+1};
  var b=[].slice.call(g.querySelectorAll("button")), r=g.getBoundingClientRect();
  return {pressed:b.map(function(x){return x.getAttribute("data-value")+"="+x.getAttribute("aria-pressed");}).join(), minH:Math.min.apply(null,b.map(function(x){return x.getBoundingClientRect().height;})),
    inView:r.left>=0&&r.right<=W+1, side:s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>W+1}; })()'''


def panel(RIG):
    print('\n2. THE SETTINGS PANEL: Game sounds beside the other settings')
    r = RIG.Rig()
    try:
        V = r.W.info['venue']
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {}}]
        for key in ('trivia', 'musical', 'bingo'):
            for (w, h) in ((1280, 800), (390, 844)):
                t = '%s panel at %dx%d' % (key, w, h)
                tid, sid = r.open('/app/?venue=' + V, before='try{localStorage.clear()}catch(e){}', width=w, height=h)
                r.until(sid, 'document.readyState==="complete" && !!window.VPGameSetup && !!window.VP && !!VP.getContext && !!VP.getContext() && !!VP.getContext().venue', 25)
                r.ask(sid, '(function(){ var o=document.getElementById("vpFirstRun"); if(o) o.remove(); window.__gsRun=VPGameSetup.run(VP.getContext(),{}); return true; })()')
                time.sleep(0.6)
                r.ask(sid, 'document.getElementById("vpGsGo").click(); true'); time.sleep(0.5)
                r.ask(sid, 'document.querySelector("#vpGsGames [data-game=%s]").click(); document.getElementById("vpGsNext").click(); true' % key); time.sleep(0.6)
                r.ask(sid, '(document.getElementById("vpGsWeekSkip")||{click:function(){}}).click(); true'); time.sleep(0.5)
                r.ask(sid, 'document.getElementById("vpGsAllYes").click(); true'); time.sleep(0.8)
                if key != 'bingo':
                    r.ask(sid, 'document.getElementById("vpGsAdvToggle").click(); true'); time.sleep(0.4)
                r.ask(sid, '(function(){var g=document.querySelector(\'#vpGs [aria-label="Game sounds"]\'); if(g) g.scrollIntoView({block:"center"}); return true;})()'); time.sleep(0.3)
                p = r.json(sid, PANEL) or {}
                ok(t + ': lists "Game sounds", Off to start', p.get('pressed') == 'true=false,false=true', p)
                ok(t + ': fits (on screen, nothing scrolls sideways, buttons at least 44px tall)', p.get('inView') is True and p.get('side') is False and (p.get('minH') or 0) >= 43.5, p)
                if SHOTS: r.shot(sid, os.path.join(SHOTS, '%s-panel-%dx%d.jpg' % (key, w, h)))
                if w == 1280:
                    r.ask(sid, 'document.querySelector(\'#vpGs [aria-label="Game sounds"] [data-value="true"]\').click(); true'); time.sleep(0.3)
                    r.ask(sid, 'document.getElementById("vpGsSave").click(); true')
                    for _ in range(60):
                        if saved(r, key, V).get('sounds') is True: break
                        time.sleep(0.25)
                    ok(t + ': On and Save keeps sounds = true through the real Worker', saved(r, key, V).get('sounds') is True, saved(r, key, V))
                ok(t + ': no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
                r.close_tab(tid)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('game-sounds-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    import rig as RIG
    console(RIG)
    panel(RIG)
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
