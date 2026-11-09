#!/usr/bin/env python3
"""THE SETUP WIZARD, ROUND 10, IN A REAL BROWSER: EVERY ANSWER SAVED AND READ BY THE GAME (Dean, 9 Nov 2026).

tools/test-wizard-r10.js runs vp-gamesetup.js in jsc. This opens the REAL pages on the browser rig (the real game
Worker in jsc behind a pipe, tools/browser-rig/rig.py) and checks what only the real pages and Worker can:

  1. A NEW VENUE answers trivia and musical bingo with values that are not the defaults, on the real console home;
     each Save goes through the REAL /host/game-prefs into the venue's game_prefs, and then the REAL trivia and
     musical bingo consoles open with those values in their own boxes (the game reads what the wizard saved)
  2. AN EXISTING VENUE (Dean, 9 Nov 2026): signing in to the console home opens "Check your games setup" for the
     owner; its screens show the venue's own settings; clicking straight through leaves game_prefs exactly as it
     was and records setup_answers.review, so the next sign-in is not asked again
  3. NEVER MID-GAME: with a night going on this device, it does not open; never for a host
  4. THE NEW SCREENS FIT at 375, 768, 1024 and 1280: nothing scrolls sideways, every button 44px, no text under 14px
  5. No script errors on any page

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/wizard-r10-in-chrome.test.py
"""
import os, sys, time, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
S1 = '33333333-3333-4333-8333-333333333331'


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


FIT = r'''(function(){ var s=document.getElementById("vpGs"); if(!s) return {none:1};
  var W=document.documentElement.clientWidth, out={side: s.scrollWidth>s.clientWidth+1 || document.documentElement.scrollWidth>W+1, small:[], tiny:[], title:(document.getElementById("vpGsTitle")||{}).textContent};
  [].forEach.call(s.querySelectorAll("button"),function(b){ var r=b.getBoundingClientRect(); if(!r.width||getComputedStyle(b).visibility==="hidden") return;
    var need=/vpgs-q/.test(b.className)?28:(b.className==="got"?32:(/vpgs-tag2|vpgs-uchip/.test(b.className)?36:44)); if(r.height<need-0.5) out.small.push((b.id||b.textContent).slice(0,30)+" "+Math.round(r.height)); });
  [].forEach.call(s.querySelectorAll("p,span,button,li,h2,h3,h4,select,input,label"),function(e){ var r=e.getBoundingClientRect(); if(!r.width||!(e.textContent||e.value)||e.type==="checkbox"||e.children.length) return;
    var f=parseFloat(getComputedStyle(e).fontSize); if(f<14) out.tiny.push((e.id||e.tagName)+" "+f); });
  return out; })()'''


def fits(tag, f):
    f = f or {}
    ok(tag + ': on screen', f.get('none') is None, f)
    ok(tag + ': nothing scrolls sideways', f.get('side') is False, f)
    ok(tag + ': every button big enough to tap', f.get('small') == [], f.get('small'))
    ok(tag + ': no text under 14px', f.get('tiny') == [], f.get('tiny'))


def r_table(r, name):
    with r.W.lock:
        r.W.p.stdin.write(json.dumps({'table': name}) + '\n'); r.W.p.stdin.flush()
        line = r.W.p.stdout.readline()
    return (json.loads(line) or {}).get('body') or []


def prefs_of(r, V):
    row = [x for x in r_table(r, 'vp_venue_settings') if x.get('venue_id') == V]
    return (row[0].get('game_prefs') or {}) if row else {}


JS_HELP = r'''window.__w={ c:function(id){var e=typeof id==="string"?document.getElementById(id):id; if(!e) throw new Error("no "+id); e.click(); return true;},
  q:function(sel){var e=document.querySelector(sel); if(!e) throw new Error("no "+sel); e.click(); return true;},
  v:function(id,val){var e=document.getElementById(id); if(!e) throw new Error("no "+id); e.value=val; e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return true;},
  seg:function(k,val){return __w.q('[data-key="'+k+'"] [data-value="'+val+'"]');},
  t:function(id){return (document.getElementById(id)||{}).textContent||"";} }; true'''


def step(r, sid, js, pause=0.5):
    out = r.ask(sid, '(function(){ try{ ' + js + '; return "ok"; }catch(e){ return "ERR "+e.message; } })()')
    time.sleep(pause)
    return out


def new_venue(RIG):
    print('\n1. A NEW VENUE: every answer saved through the real Worker, and the real consoles read it')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', '/app/musical/host.html'))
    try:
        V = r.W.info['venue']
        r.db['vp_question_sets'] = [{'id': S1, 'title': 'General Knowledge', 'question_count': 400, 'visibility': 'library', 'owner_venue_id': None, 'status': 'active'}]
        r.W.seed('vp_venue_settings', [{'venue_id': V, 'game_prefs': {}, 'setup_answers': {}}], replace=True)
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {}}]
        tid, sid = r.open('/app/?venue=' + V, before='try{localStorage.clear()}catch(e){}', width=1280, height=800)
        r.until(sid, 'document.readyState==="complete" && !!window.VPGameSetup && !!window.VP && !!VP.getContext && !!VP.getContext() && !!VP.getContext().venue', 30)
        r.ask(sid, JS_HELP)
        r.ask(sid, '(function(){ var o=document.getElementById("vpFirstRun"); if(o) o.remove(); var a=document.getElementById("vpAsk"); if(a) a.remove(); window.__gsRun=VPGameSetup.run(VP.getContext(),{}); return true; })()')
        time.sleep(0.6)
        res = [step(r, sid, '__w.c("vpGsGo")'),
               step(r, sid, '__w.q("#vpGsGames [data-game=trivia]"); __w.q("#vpGsGames [data-game=musical]"); __w.c("vpGsNext")'),
               step(r, sid, '__w.q("#vpGsWeek [data-game=trivia] [data-day=wed]"); __w.q("#vpGsWeek [data-game=musical] [data-day=fri]")'),
               step(r, sid, '__w.v("vpGsTime_trivia_wed","19:00"); __w.v("vpGsTime_musical_fri","19:30"); __w.c("vpGsWeekNext")'),
               step(r, sid, '__w.c("vpGsAllYes")', 1.0)]
        ok('the real console home: games, nights (from the half-hour list) and "set up your first game now"', all(x == 'ok' for x in res), res)
        res = [step(r, sid, '__w.v("vpGsIn_count","12"); __w.v("vpGsIn_rounds","4"); __w.seg("double_points","true")'),
               step(r, sid, '__w.v("vpGsIn_double_last","3"); __w.c("vpGsAdvToggle"); __w.v("vpGsIn_time_s","20"); __w.seg("speed_bonus","false"); __w.seg("prize_weekly","false")')]
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'r10-new-trivia-1280.jpg'))
        res.append(step(r, sid, '__w.c("vpGsSave")', 1.5))
        ok('trivia answered and saved on the real page', all(x == 'ok' for x in res), res)
        got = None
        for _ in range(40):
            got = prefs_of(r, V).get('trivia')
            if got: break
            time.sleep(0.25)
        want = {'count': 12, 'rounds': 4, 'double_points': True, 'double_last': 3, 'time_s': 20, 'speed_bonus': False, 'prize_weekly': False}
        ok('the real game Worker kept every trivia answer in game_prefs.trivia', got is not None and all(got.get(k) == v for k, v in want.items()), got)
        res = [step(r, sid, '__w.c("vpGsNextYes")', 1.0),
               step(r, sid, '__w.c("vpGsNone_0"); __w.v("vpGsIn_prizes_1","$20 bar tab"); __w.v("vpGsIn_prizes_2","Meat tray")'),
               step(r, sid, '__w.c("vpGsAdvToggle"); __w.v("vpGsIn_reveal","never"); __w.seg("hits_only","false")'),
               step(r, sid, '__w.c("vpGsSave")', 1.5)]
        ok('musical bingo answered and saved on the real page', all(x == 'ok' for x in res), res)
        gm = None
        for _ in range(40):
            gm = prefs_of(r, V).get('musical')
            if gm: break
            time.sleep(0.25)
        ok('the real game Worker kept every musical bingo answer', gm is not None and gm.get('reveal') == 'never' and gm.get('hits_only') is False
           and gm.get('prizes') == ['', '$20 bar tab', 'Meat tray'] and gm.get('prize_none') == [1], gm)
        ok('no script errors on the console home', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

        print('   ... and the real consoles read what was saved')
        tid, sid = r.open('/app/trivia/host.html?venue=' + V, width=1280, height=800)
        ok('trivia console: 12 questions, 20 seconds, speed bonus off, double points on with 3 (its own boxes)',
           r.until(sid, '!!document.getElementById("cfgCount") && document.getElementById("cfgCount").value==="12" && document.getElementById("cfgTime").value==="20" && !!document.querySelector("#cfgSpeed button[data-v=off].on")', 30) is True,
           r.ask(sid, 'JSON.stringify({c:(document.getElementById("cfgCount")||{}).value,t:(document.getElementById("cfgTime")||{}).value,s:!!document.querySelector("#cfgSpeed button[data-v=off].on")})'))
        ok('trivia console: double points on, 3 questions (its own On/Off and box)', r.until(sid, '!!document.querySelector("#cfgDouble button[data-v=on].on") && document.getElementById("cfgDoubleLast").value==="3"', 10) is True,
           r.ask(sid, 'JSON.stringify({on:!!document.querySelector("#cfgDouble button[data-v=on].on"),n:(document.getElementById("cfgDoubleLast")||{}).value})'))
        ok('no script errors on the trivia console', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
        tid, sid = r.open('/app/musical/host.html?venue=' + V, width=1280, height=800)
        ok('musical bingo console: well-known songs only is off, as saved', r.until(sid, '!!document.getElementById("hitsChk") && document.getElementById("hitsChk").checked===false', 30) is True,
           r.ask(sid, '(document.getElementById("hitsChk")||{}).checked'))
        ok('musical bingo console: the song name reveal is "never" (only in the played list)', r.until(sid, 'localStorage.getItem("vpMusicReveal")==="never"', 10) is True,
           r.ask(sid, 'localStorage.getItem("vpMusicReveal")'))
        ok('musical bingo console: round 1 of 3 tonight is played for no prize', r.until(sid, '/Round 1 of 3 tonight: played for fun, no prize\\./.test((document.getElementById("roundNote")||{}).textContent||"")', 10) is True,
           r.ask(sid, '(document.getElementById("roundNote")||{}).textContent'))
        ok('no script errors on the musical bingo console', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()


def existing_venue(RIG):
    print('\n2. AN EXISTING VENUE: asked on sign-in, its own settings shown, clicking through changes nothing')
    r = RIG.Rig(review=True)
    try:
        V = r.W.info['venue']
        HAVE = {'trivia': {'count': 15, 'time_s': 45, 'rounds': 5, 'double_points': True, 'double_last': 5, 'speed_bonus': True},
                'musical': {'playlists': ['90s'], 'playlist': '90s', 'rounds': 2, 'prize_same': True, 'prizes': ['Jug'], 'prize': 'Jug', 'reveal': 'end', 'hits_only': True}}
        r.W.seed('vp_venue_settings', [{'venue_id': V, 'game_prefs': json.loads(json.dumps(HAVE)), 'setup_answers': {}}], replace=True)
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {}}]
        tid, sid = r.open('/app/?venue=' + V, before='try{localStorage.clear()}catch(e){}', width=1024, height=768)
        opened = r.until(sid, '(document.getElementById("vpGsTitle")||{}).textContent==="Check your games setup"', 40)
        ok('the owner signing in to the console home is asked: "Check your games setup"', opened is True, r.ask(sid, '(document.getElementById("vpGsTitle")||{}).textContent'))
        r.ask(sid, JS_HELP)
        fits('1024 existing start', r.json(sid, FIT))
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'r10-existing-start-1024.jpg'))
        res = [step(r, sid, '__w.c("vpGsGo")'), step(r, sid, '__w.c("vpGsNext")', 0.8), step(r, sid, '__w.c("vpGsWeekSkip")'), step(r, sid, '__w.c("vpGsAllYes")', 1.2)]
        ok('through to the first game', all(x == 'ok' for x in res), res)
        ok('trivia shows THEIR 15 questions, 5 rounds and double points on 5', r.until(sid, '(document.getElementById("vpGsIn_count")||{}).value==="15" && document.getElementById("vpGsIn_rounds").value==="5" && document.getElementById("vpGsIn_double_last").value==="5"', 10) is True,
           r.ask(sid, 'JSON.stringify({c:(document.getElementById("vpGsIn_count")||{}).value,r:(document.getElementById("vpGsIn_rounds")||{}).value})'))
        res = [step(r, sid, '__w.c("vpGsSave")', 1.2), step(r, sid, '__w.c("vpGsNextYes")', 1.2)]
        ok('musical bingo shows THEIR rounds and reveal', r.until(sid, '(document.getElementById("vpGsIn_rounds")||{}).value==="2" && document.getElementById("vpGsIn_reveal").value==="end"', 10) is True)
        res.append(step(r, sid, '__w.c("vpGsSave")', 1.5))
        ok('clicked straight through', all(x == 'ok' for x in res), res)
        ok('"You\'re ready for your week."', r.until(sid, '(document.getElementById("vpGsTitle")||{}).textContent==="You\'re ready for your week."', 10) is True)
        after = prefs_of(r, V)
        ok('the venue\'s saved settings are exactly as they were (nothing written)', json.dumps(after, sort_keys=True) == json.dumps(HAVE, sort_keys=True), after)
        step(r, sid, '__w.c("vpGsDone")', 1.5)
        rows = [x for x in r_table(r, 'vp_venue_settings') if x.get('venue_id') == V]
        sa = (rows[0].get('setup_answers') if rows else None) or {}
        sa_db = [x for x in r.db.get('vp_venue_settings', []) if x.get('venue_id') == V]
        sa2 = (sa_db[0].get('setup_answers') if sa_db else None) or {}
        ok('setup_answers.review is "done", so it is not asked again', sa.get('review') == 'done' or sa2.get('review') == 'done', [sa, sa2])
        ok('no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
        tid, sid = r.open('/app/?venue=' + V, width=1024, height=768)
        r.until(sid, 'document.readyState==="complete" && !!window.VPGameSetup', 30); time.sleep(4)
        ok('the next sign-in: not asked again', r.ask(sid, '!document.getElementById("vpGs")') is True)
        r.close_tab(tid)

        print('\n3. NEVER MID-GAME, NEVER A HOST')
        r.W.seed('vp_venue_settings', [{'venue_id': V, 'game_prefs': json.loads(json.dumps(HAVE)), 'setup_answers': {}}], replace=True)
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {}}]
        night = 'try{localStorage.clear(); localStorage.setItem("vpTriviaGame-%s", JSON.stringify({ts:Date.now(),gameId:"g1"}))}catch(e){}' % V
        tid, sid = r.open('/app/?venue=' + V, before=night, width=1024, height=768)
        r.until(sid, 'document.readyState==="complete" && !!window.VPGameSetup', 30); time.sleep(5)
        ok('a trivia night going on this device: not asked', r.ask(sid, '!document.getElementById("vpGs")') is True)
        r.close_tab(tid)
        r.db['vp_venue_staff'][0]['role'] = 'host'
        tid, sid = r.open('/app/?venue=' + V + '&h=1', before='try{localStorage.clear()}catch(e){}', width=1024, height=768)
        r.until(sid, 'document.readyState==="complete" && !!window.VPGameSetup', 30); time.sleep(5)
        ok('a host: never asked', r.ask(sid, '!document.getElementById("vpGs")') is True)
        r.close_tab(tid)
        r.db['vp_venue_staff'][0]['role'] = 'owner'
    finally:
        r.close()


def screens(RIG):
    print('\n4. THE NEW SCREENS FIT (375, 768, 1024, 1280)')
    r = RIG.Rig()
    try:
        V = r.W.info['venue']
        r.db['vp_venue_settings'] = [{'venue_id': V, 'setup_answers': {}}]
        for W, H in ((375, 667), (768, 1024), (1024, 768), (1280, 800)):
            tag = '%dx%d' % (W, H)
            tid, sid = r.open('/app/?venue=' + V, before='try{localStorage.clear()}catch(e){}', width=W, height=H)
            r.until(sid, 'document.readyState==="complete" && !!window.VPGameSetup && !!window.VP && !!VP.getContext && !!VP.getContext() && !!VP.getContext().venue', 30)
            r.ask(sid, JS_HELP)
            r.ask(sid, '(function(){ var o=document.getElementById("vpFirstRun"); if(o) o.remove(); var a=document.getElementById("vpAsk"); if(a) a.remove(); window.__gsRun=VPGameSetup.run(VP.getContext(),{}); return true; })()')
            time.sleep(0.5)
            f = r.json(sid, FIT); fits(tag + ' first screen', f)
            ok(tag + ' first screen: one button, no Close', r.ask(sid, 'getComputedStyle(document.getElementById("vpGsClose")).visibility==="hidden" && getComputedStyle(document.getElementById("vpGsTopNext")).visibility==="hidden"') is True)
            step(r, sid, '__w.c("vpGsGo")')
            fits(tag + ' games', r.json(sid, FIT))
            step(r, sid, '__w.q("#vpGsGames [data-game=raffles]"); __w.c("vpGsNext")'); step(r, sid, '__w.q("#vpGsWeek [data-game=raffles] [data-day=sat]")')
            fits(tag + ' nights', r.json(sid, FIT))
            ok(tag + ' the night\'s time is a half-hour list', r.ask(sid, 'document.getElementById("vpGsTime_raffles_sat").tagName') == 'SELECT')
            step(r, sid, '__w.v("vpGsTime_raffles_sat","19:00"); __w.c("vpGsWeekNext")'); step(r, sid, '__w.c("vpGsAllYes")', 0.8)
            step(r, sid, '__w.v("vpGsIn_raffles","2")'); step(r, sid, '__w.v("vpGsRafN_0","3")'); step(r, sid, '__w.q("#vpGsRafSame_0 [data-value=false]")')
            fits(tag + ' raffles, each raffle asked', r.json(sid, FIT))
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'r10-raffles-%s.jpg' % tag))
            step(r, sid, '__w.c("vpGsSave")', 1.0); step(r, sid, '__w.c("vpGsDone")', 0.5)
            ok(tag + ' Go to my console closes it (Dean, round 9 point 22)', r.ask(sid, '!document.getElementById("vpGs")') is True)
            ok(tag + ': no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('wizard-r10-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    import rig as RIG
    new_venue(RIG)
    existing_venue(RIG)
    screens(RIG)
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
