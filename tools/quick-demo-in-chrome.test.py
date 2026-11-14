#!/usr/bin/env python3
"""PLAY A QUICK GAME, AFTER THE ACCOUNT: THE DEMO, WHAT GAMES DO YOU RUN, THE THREE CHOICES (Dean, 14 Nov 2026; INBOX 412).

Opens the REAL /app/try.html?quick=1 on the browser rig (the real game Worker in jsc, fake Supabase with realtime between windows), signed in
as a brand-new venue's owner, the way the one-tap sign-in leaves them:

  A. AT 1440: no questions about mode, players or devices: this screen is the TV with the QR for their phone, the game runs itself; ONE phone
     joins from the QR and answers 5 questions; the podium; then (the one setting, VPQuick.cfg.STEPS) "What games do you run?" with trivia
     ticked, the choice saved through the wizard's own saver (setup_answers.games); then the three choices and "Add your card".
     The setup wizard is marked dismissed on first entry and "Set up my venue" is what brings it back.
     "I'd like more info" posts once to /quick/more-info with the venue and the game played, and shows only "Thanks, we'll be in touch."
     "Add your card" asks /account/card-link (never automatic); the funnel steps fired are the ones Dean listed.
  B. THE LATER ORDER is one array line: games before the demo, checked with the games card shown first.
  C. THE CARDS AT 320, 375, 390, 430 and 1440: one screen, no scroll, every button 44 px or taller.

    VP_SHOTS=/some/dir python3 tools/quick-demo-in-chrome.test.py
"""
import importlib.util, json, os, re, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
spec = importlib.util.spec_from_file_location('trydemo', os.path.join(ROOT, 'tools', 'try-demo-in-chrome.test.py'))
TD = importlib.util.module_from_spec(spec); spec.loader.exec_module(TD)
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


# Stubs for the three calls to the billing Worker (the rig has none), and a list of what the page sent.
BEFORE = r'''
window.__calls=[]; window.__steps=[];
var __of=window.fetch;
window.fetch=function(u,o){ var s=String(u);
  if(/\/quick\/(more-info|event)|\/account\/card-link/.test(s)){ window.__calls.push([s,(o&&o.body)||""]);
    var j=/card-link/.test(s)?{ok:true,has_card:true}:{ok:true,words:"Thanks, we'll be in touch."};
    return Promise.resolve(new Response(JSON.stringify(j),{status:200,headers:{"Content-Type":"application/json"}})); }
  return __of.apply(this,arguments); };
window.vpTrackStepImpl=function(s,p){ window.__steps.push(s); };
'''
FITCARD = r'''(function(){ var c=document.querySelector(".done.on .card"); if(!c) return {none:true}; var r=c.getBoundingClientRect();
  var small=[].filter.call(c.querySelectorAll("button,.btn"),function(b){var q=b.getBoundingClientRect();return q.width>0&&q.height>0&&q.height<44;}).length;
  return {top:Math.round(r.top),bottom:Math.round(r.bottom),vh:window.innerHeight,left:Math.round(r.left),right:Math.round(r.right),vw:window.innerWidth,small:small,wide:document.documentElement.scrollWidth-window.innerWidth}; })()'''


def scene_a(RIG):
    print('\nA. AT 1440, AS A NEW VENUE: THE DEMO, THE GAMES QUESTION, THE THREE CHOICES')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', '/app/try.html'), real_qr=True)
    try:
        TD.seed(r); TD.clock_now(r)
        tl, lap = r.open('/app/try.html?quick=1&device=computer', before=BEFORE, width=1440, height=900)
        ok('no questions about how, how many or another device: it goes straight to the TV',
           r.until(lap, '!!document.querySelector("#tvBox iframe") && document.getElementById("play").classList.contains("on")', 30) is True, r.ask(lap, 'JSON.stringify({e:window.__errs,s:(window.VPQuick||{}).cfg&&VPQuick.cfg.STEPS,q:location.search})'))
        ok('  the TV is the venue\'s own screen, with the QR for their phone, and the game runs itself out of sight',
           r.ask(lap, '(function(){ var d=document.querySelector("iframe.driver"); return !!d && /host\\.html\\?demo=auto&n=1$/.test(d.getAttribute("src")); })()') is True)
        ok('  the demo session opens, marked a demo', r.until(lap, '/joined/.test(document.getElementById("playStatus").textContent)', 40) is True and
           any(s.get('is_demo') is True for s in TD.db(r, 'vp_sessions')), r.ask(lap, 'document.getElementById("playStatus").textContent'))
        ok('  the player QR is really drawn', r.until(lap, TD.qr_drawn('playQr'), 10) is True)
        ok('the setup wizard is marked dismissed on first entry', r.ask(lap, '(JSON.parse(localStorage.getItem("vpFirstRun:"+VPTry.venueId)||"{}")).dismissed') is True)
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-demo-tv-1440.jpg'))
        url = r.ask(lap, 'VPDemo.playUrl(VPTry.joinCode || VPTry.code, { name:VPTry.me.name, email:VPTry.me.email, mobile:VPTry.me.mobile })')
        t1, p1 = TD.phone_join(r, url, tick=False)
        r.ask(p1, 'document.getElementById("joinBtn").click(); true')
        ok('one phone joins from the QR and the game starts itself at 1 of 1', r.until(p1, TD.QUP, 60) is True, r.ask(lap, 'document.getElementById("playStatus").textContent'))
        gid = ([g for g in TD.db(r, 'vp_games') if g.get('format') == 'trivia'] or [{}])[-1].get('id')
        pls = [p for p in TD.db(r, 'vp_players')]
        r.W.seed('v_vp_trivia_leaderboard', [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': 500} for p in pls])
        def asked(n): return r.until(lap, '/^Question %d of 5\\. /.test(document.getElementById("playStatus").textContent)' % n, 40)
        for q in (1, 2, 3, 4, 5):
            asked(q); r.until(p1, TD.QUP, 15); TD.answer(r, p1)
            r.until(lap, '/^Question %d of 5: the answer/.test(document.getElementById("playStatus").textContent)' % q, 40)
        ok('after 5 questions and the podium: "What games do you run?" with trivia ticked',
           r.until(lap, 'document.getElementById("qGames").classList.contains("on")', 90) is True and
           r.ask(lap, 'document.getElementById("qChip-trivia").getAttribute("aria-pressed")') == 'true', [r.ask(lap, 'document.getElementById("playStatus").textContent'), r.ask(lap, TD.DRV)])
        ok('  the wizard\'s own five games are the choices', r.ask(lap, '[].map.call(document.querySelectorAll("#qChips .chip"),function(b){return b.textContent;}).join("|")') == 'Trivia|Musical bingo|Bingo|Raffles|Members draws')
        ok('  the old "That\'s the game" dialog is not shown in the quick flow', r.ask(lap, 'document.getElementById("done").classList.contains("on")') is False)
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-games-1440.jpg'))
        r.ask(lap, 'window.__saved=[]; var o=VP.saveSettings; VP.saveSettings=function(i,p){ window.__saved.push(p); return o.apply(VP,arguments); }; true')
        TD.clickid(r, lap, 'qChip-musical')
        TD.clickid(r, lap, 'qGamesGo')
        ok('Next shows the three choices and a card button', r.until(lap, 'document.getElementById("qChoices").classList.contains("on")', 15) is True and
           r.ask(lap, '["qAnother","qInfo","qSetup","qCard"].map(function(i){return document.getElementById(i).textContent;}).join("|")') == "Play another game|I'd like more info|Set up my venue|Add your card")
        saved = json.loads(r.ask(lap, 'JSON.stringify(window.__saved)') or '[]')
        ok('what games do you run was saved to the venue through the wizard\'s saver (setup_answers.games): trivia and musical bingo',
           len(saved) == 1 and sorted(((saved[0] or {}).get('setup_answers') or {}).get('games', [])) == ['musical', 'trivia'], saved)
        ok('nothing opened or posted on its own: no more-info, no card page yet', not [c for c in json.loads(r.ask(lap, 'JSON.stringify(window.__calls)')) if re.search(r'more-info|card-link', c[0])])
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-choices-1440.jpg'))
        TD.clickid(r, lap, 'qInfo')
        ok('"I\'d like more info": posts once with the venue and the game played, and shows only the thank-you',
           r.until(lap, '!document.getElementById("qThanks").hidden', 10) is True and r.ask(lap, 'document.getElementById("qThanks").textContent') == "Thanks, we'll be in touch." and
           r.ask(lap, 'document.getElementById("qChoiceBtns").hidden') is True and
           len([c for c in json.loads(r.ask(lap, 'JSON.stringify(window.__calls)')) if 'more-info' in c[0]]) == 1 and
           '"game":"trivia"' in [c for c in json.loads(r.ask(lap, 'JSON.stringify(window.__calls)')) if 'more-info' in c[0]][0][1].replace(' ', ''), r.ask(lap, 'JSON.stringify(window.__calls)'))
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-thanks-1440.jpg'))
        steps = json.loads(r.ask(lap, 'JSON.stringify((window.__vpTrackQueue||[]).map(function(x){return x[0];}).concat(window.__steps))'))
        for need in ('signed_in', 'demo_q1', 'demo_q5', 'podium_seen', 'games_answered', 'choice_info'):
            ok('the funnel step "%s" was fired through the one door' % need, need in steps, steps)
        ok('no name, mobile or venue went to the funnel', not re.search(r'Dean|0400|Test Alpha', r.ask(lap, 'JSON.stringify(window.__calls.filter(function(c){return /quick\\/event/.test(c[0]);}))') or ''))
        ok('no script errors on the TV or the phone', r.ask(lap, 'window.__errs.length') == 0 and r.ask(p1, 'window.__errs.length') == 0, [r.ask(lap, 'JSON.stringify(window.__errs)')])
        for t in (t1, tl): r.close_tab(t)
    finally:
        r.close()


def scene_bc(RIG):
    print('\nB AND C. THE LATER ORDER IS ONE ARRAY LINE; THE CARDS AT FIVE WIDTHS')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', '/app/try.html'), real_qr=True)
    try:
        TD.seed(r); TD.clock_now(r)
        ORDER = 'var __v; Object.defineProperty(window,"VPQuick",{configurable:true,get:function(){return __v;},set:function(v){ v.cfg.STEPS=["games","demo","choices"]; __v=v; }});'
        for w, h in ((320, 568), (375, 667), (390, 844), (430, 932), (1440, 900)):
            t, s = r.open('/app/try.html?quick=1&device=computer', before=BEFORE + ORDER, width=w, height=h)
            first = r.until(s, 'document.getElementById("qGames").classList.contains("on")', 90)
            if w == 320:
                ok('the LATER order (games before the demo) is one array line: the games question comes first, no demo yet', first is True and not r.ask(s, 'document.getElementById("play").classList.contains("on")'), r.ask(s, 'JSON.stringify({e:window.__errs,s:(window.VPQuick||{}).cfg&&VPQuick.cfg.STEPS,m:document.getElementById("signinMsg").textContent})'))
            f = r.json(s, FITCARD, {})
            ok('%dpx: the games card is inside the screen, no scroll, buttons 44px or taller' % w, first is True and f.get('top', -1) >= 0 and f.get('bottom', 9999) <= f.get('vh', 0) and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0 and f.get('wide', 1) <= 0, f)
            if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-games-%dpx.jpg' % w))
            TD.clickid(r, s, 'qGamesGo')
            ok('%dpx: after the games question the demo starts (TV and QR)' % w, r.until(s, '!!document.querySelector("#tvBox iframe")', 30) is True, r.ask(s, TD.STEP))
            r.ask(s, 'document.getElementById("play").classList.remove("on"); document.getElementById("qChoices").classList.add("on"); true')
            f = r.json(s, FITCARD, {})
            ok('%dpx: the choices card is inside the screen, no scroll, buttons 44px or taller' % w, f.get('top', -1) >= 0 and f.get('bottom', 9999) <= f.get('vh', 0) and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0 and f.get('wide', 1) <= 0, f)
            if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-choices-%dpx.jpg' % w))
            TD.clickid(r, s, 'qCard')
            ok('%dpx: "Add your card" asks for the card page (never automatic) and says so if one is already on' % w,
               r.until(s, '/already added/.test(document.getElementById("qErr").textContent)', 10) is True and any('card-link' in c[0] for c in json.loads(r.ask(s, 'JSON.stringify(window.__calls)'))), r.ask(s, 'document.getElementById("qErr").textContent'))
            r.close_tab(t)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('quick-demo-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    import rig as RIG
    only = os.environ.get('VP_SCENE', '')
    if only in ('', 'A'): scene_a(RIG)
    if only in ('', 'B'): scene_bc(RIG)
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
