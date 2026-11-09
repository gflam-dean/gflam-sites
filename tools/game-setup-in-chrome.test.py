#!/usr/bin/env python3
"""THE SETUP WIZARD'S GAMES, IN A REAL BROWSER (Dean, 6 Nov 2026, INBOX 104 and his four clarifications).

tools/test-game-setup.js runs vp-gamesetup.js in jsc. This opens the REAL pages on the browser rig (the real game
Worker in jsc behind a pipe, tools/browser-rig/rig.py) and checks what only a browser can:

  1. THE FIRST TIME A SKIPPED GAME IS OPENED: the trivia console of a venue that left trivia "later" opens trivia's
     own setup over it; a "?" opens its plain words on screen; Save goes through the REAL /host/game-prefs into
     the venue's game_prefs; the console reloads and its own boxes show what was saved (15 questions); it never
     opens again; a HOST opening the same console is never stopped by it
  2. EVERY SCREEN FITS at a phone (390), an iPad portrait (820), an iPad landscape (1024) and a laptop (1280): the
     heads-up, the games question, "set them all up today?", a game, "Do you want to set up your next game?" and
     "No worries.", run on the real console (index.html) with VPGameSetup.run: nothing scrolls sideways, every
     button at least 44px tall (the "?" at least 28px), no text under 14px, an open "?" fully on screen
  3. No script errors on any page

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/game-setup-in-chrome.test.py
"""
import os, sys, time
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


# How the setup sits on the screen: sideways scroll, small buttons, small text, an open "?" off screen.
FIT = r'''(function(){ var s=document.getElementById("vpGs"); if(!s) return {none:1};
  var W=document.documentElement.clientWidth, out={side: s.scrollWidth>s.clientWidth+1 || document.documentElement.scrollWidth>W+1, small:[], tiny:[], pop:null, title:(document.getElementById("vpGsTitle")||{}).textContent};
  [].forEach.call(s.querySelectorAll("button"),function(b){ var r=b.getBoundingClientRect(); if(!r.width) return;
    var need=/vpgs-q/.test(b.className)?28:(b.className==="got"?32:44); if(r.height<need-0.5) out.small.push((b.id||b.textContent).slice(0,30)+" "+Math.round(r.height)); });
  [].forEach.call(s.querySelectorAll("p,span,button,li,h2,h3,select,input"),function(e){ var r=e.getBoundingClientRect(); if(!r.width||!(e.textContent||e.value)||e.type==="checkbox") return;
    var f=parseFloat(getComputedStyle(e).fontSize); if(f<14) out.tiny.push((e.id||e.tagName)+" "+f); });
  var p=[].filter.call(s.querySelectorAll(".vpgs-pop"),function(e){return e.style.display==="block";})[0];
  if(p){ var r=p.getBoundingClientRect(); out.pop={left:r.left,right:r.right,W:W,text:p.textContent,pos:getComputedStyle(p).position}; }
  return out; })()'''


def fits(tag, f):
    f = f or {}
    ok(tag + ': on screen', f.get('none') is None, f)
    ok(tag + ': nothing scrolls sideways', f.get('side') is False, f)
    ok(tag + ': every button big enough to tap (44px, the "?" 28px, Got it 32px)', f.get('small') == [], f.get('small'))
    ok(tag + ': no text under 14px', f.get('tiny') == [], f.get('tiny'))
    if f.get('pop'):
        p = f['pop']
        ok(tag + ': the open "?" is fully on screen', p['left'] >= 0 and p['right'] <= p['W'] + 0.5, p)
        ok(tag + ': the "?" opens underneath its setting at every size, pushing what follows down (Dean, round 7b point 9; round 2 had a bubble on bigger screens)',
           p['pos'] == 'static', p)


def first_open(RIG):
    print('\n1. THE FIRST TIME A SKIPPED GAME IS OPENED (trivia)')
    r = RIG.Rig(host_pages=('/app/trivia/host.html',))
    try:
        V = r.W.info['venue']
        r.db['vp_question_sets'] = [{'id': '33333333-3333-4333-8333-333333333333', 'title': 'General Knowledge', 'question_count': 400,
                                     'visibility': 'public', 'owner_venue_id': None, 'status': 'active'}]
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {'games': ['trivia'], 'games_at': '2026-11-06', 'setup': {'trivia': 'later'}}}]
        tid, sid = r.open('/app/trivia/host.html?venue=' + V, width=820, height=1180)
        ok('trivia\'s own setup opens over its console', r.until(sid, '(document.getElementById("vpGsTitle")||{}).textContent==="Set up trivia"', 25) is True,
           r.ask(sid, '(document.getElementById("vpGsTitle")||{}).textContent'))
        ok('it opens with no pink "First time in" line, and the console is behind it', r.ask(sid, '!document.getElementById("vpGsFirstTag")') is True
           and r.ask(sid, '!!document.getElementById("cfgCount")') is True)
        # speed bonus sits in More settings, folded on every size since round 8 (Dean, round 7b point 8): open it first
        r.ask(sid, 'document.getElementById("vpGsAdvToggle").click(); document.getElementById("vpGsQ_speed_bonus").click(); true'); time.sleep(0.3)
        f = r.json(sid, FIT)
        ok('"?" beside Speed bonus opens its plain words', 'scores up to half as much again' in ((f.get('pop') or {}).get('text') or '') and (f.get('pop') or {}).get('right', 0) > 0, f.get('pop'))
        fits('first open at 820', f)
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'first-open-trivia-820.jpg'))
        r.ask(sid, 'document.getElementById("vpGsIn_count").value="15"; document.getElementById("vpGsSave").click(); true')
        saved = None
        for _ in range(60):
            tbl = r_table(r, 'vp_venue_settings')
            row = [x for x in tbl if x.get('venue_id') == V]
            if row and (row[0].get('game_prefs') or {}).get('trivia'):
                saved = row[0]['game_prefs']['trivia']; break
            time.sleep(0.25)
        ok('Save went through the real /host/game-prefs: 15 questions, the rest today\'s defaults', saved is not None and saved.get('count') == 15
           and saved.get('time_s') == 30 and saved.get('speed_bonus') is True, saved)
        ok('the console reloads with the setup closed, and never opens it again',
           r.until(sid, 'document.readyState==="complete" && !!document.getElementById("cfgCount") && !document.getElementById("vpGs")', 25) is True
           and (time.sleep(3) or r.ask(sid, '!document.getElementById("vpGs")')) is True, r.ask(sid, '(document.getElementById("vpGsTitle")||{}).textContent'))
        ok('the console\'s own box shows what was saved', r.until(sid, 'document.getElementById("cfgCount").value==="15"', 15) is True, r.ask(sid, 'document.getElementById("cfgCount").value'))
        ok('no script errors on the console', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
        r.db['vp_venue_staff'][0]['role'] = 'host'
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {'games': ['trivia'], 'setup': {'trivia': 'later'}}}]
        tid, sid = r.open('/app/trivia/host.html?venue=' + V + '&h=1', width=1280, height=800)
        r.until(sid, 'document.readyState==="complete" && !!document.getElementById("cfgCount")', 25); time.sleep(4)
        ok('a host opening the console on a busy night is never stopped by it', r.ask(sid, '!document.getElementById("vpGs")') is True)
        r.close_tab(tid)
    finally:
        r.close()


def r_table(r, name):
    """The Worker's fake database, read back (worker-stdio.js answers {table})."""
    import json
    with r.W.lock:
        r.W.p.stdin.write(json.dumps({'table': name}) + '\n'); r.W.p.stdin.flush()
        line = r.W.p.stdout.readline()
    return (json.loads(line) or {}).get('body') or []


def every_screen(RIG):
    print('\n2. EVERY SCREEN FITS (phone, iPad portrait, iPad landscape, laptop)')
    r = RIG.Rig()
    try:
        V = r.W.info['venue']
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {}}]
        for W, H in ((390, 664), (820, 1180), (1024, 768), (1280, 800)):
            tid, sid = r.open('/app/?venue=' + V, before='try{localStorage.clear()}catch(e){}', width=W, height=H)
            r.until(sid, 'document.readyState==="complete" && !!window.VPGameSetup && !!window.VP && !!VP.getContext && !!VP.getContext() && !!VP.getContext().venue', 25)
            r.ask(sid, '(function(){ var o=document.getElementById("vpFirstRun"); if(o) o.remove(); window.__gsRun=VPGameSetup.run(VP.getContext(),{}); return true; })()')
            tag = '%dx%d' % (W, H)
            steps = [('heads-up', None), ('games', 'vpGsGo'), ('all today', None), ('a game (trivia)', 'vpGsAllYes'), ('"?" open', 'vpGsQ_double_points'),
                     ('next game', 'vpGsSave'), ('No worries', 'vpGsNextNo')]
            for name, click in steps:
                if name == 'all today':
                    r.ask(sid, 'document.querySelector("#vpGsGames [data-game=trivia]").click(); document.querySelector("#vpGsGames [data-game=musical]").click(); document.getElementById("vpGsNext").click(); true')
                    time.sleep(0.5)
                    r.ask(sid, 'document.querySelector("#vpGsWeek [data-game=trivia] [data-day=wed]").click(); true'); time.sleep(0.3)
                    fits(tag + ' which nights', r.json(sid, FIT))
                    if SHOTS: r.shot(sid, os.path.join(SHOTS, 'screen-%s-week.jpg' % tag))
                    r.ask(sid, 'document.getElementById("vpGsWeekSkip").click(); true')
                elif click:
                    r.ask(sid, 'document.getElementById("%s").click(); true' % click)
                time.sleep(0.6)
                if name == '"?" open':
                    r.ask(sid, 'document.getElementById("vpGsQ_double_points").scrollIntoView({block:"center"}); true'); time.sleep(0.2)
                if name in ('next game',):
                    r.until(sid, '(document.getElementById("vpGsTitle")||{}).textContent==="Do you want to set up your next game?"', 10)
                fits(tag + ' ' + name, r.json(sid, FIT))
                if SHOTS: r.shot(sid, os.path.join(SHOTS, 'screen-%s-%s.jpg' % (tag, name.replace(' ', '-').replace('"', '').replace('?', 'q'))))
            ok(tag + ': "No worries." in Dean\'s words', r.ask(sid, '(document.getElementById("vpGsNoWorries")||{}).textContent') ==
               "We'll remind you when you open each of those games. Your default settings have been saved for musical bingo.",
               r.ask(sid, '(document.getElementById("vpGsNoWorries")||{}).textContent'))
            ok(tag + ': no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('game-setup-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    import rig as RIG
    first_open(RIG)
    every_screen(RIG)
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
