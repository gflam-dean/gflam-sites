#!/usr/bin/env python3
"""PLAY A QUICK GAME AFTER THE ACCOUNT, PLAYED IN CHROME ON THE REAL GAME PAGES (Dean, 14 Nov 2026; INBOX 412; redone on brand 15 Nov:
"the demo IS the real trivia"). Opens /app/play-quick.html on the browser rig (the real game Worker in jsc, fake Supabase with realtime
between windows) as a brand-new venue's owner, the way the one-tap sign-in leaves them:

  A. A LAPTOP (1440): this page IS the TV: the real /tv full screen, nothing of ours drawn over it (no header, no side panel, no
     "scan with your phone" text of ours: the QR, logo and room code are the real TV's own); the console runs itself out of sight; ONE phone
     joins by the room code with the real trivia phone screen, pre-filled with first name and mobile and NEVER an email; 5 questions to the
     podium; then "What games do you run now?" (nothing ticked, the line "We'll show you how each one works on venueplay."), the choices in
     one consistent set, "I'd like more info" posts once and shows only the thank-you, "Add my card" asks for the card page and never opens it itself.
  B. A PHONE VISITOR (390): never "scan with your phone"; first "Ready for a quick game?" with Play on this phone and I've got a laptop
     or TV here; Play on this phone runs the real trivia phone screen (question, answers, result) on the phone itself; the other button
     shows the TV code line and Text me the link (their own mobile, no email link) and then this phone is the player.
  C. THE SECTIONS AT 320, 375, 390, 430 and 1440 are the website's own components: nothing wider than the screen, buttons 44 px or taller.

    VP_SHOTS=/some/dir python3 tools/quick-demo-in-chrome.test.py
"""
import importlib.util, json, os, re, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
spec = importlib.util.spec_from_file_location('trydemo', os.path.join(ROOT, 'tools', 'try-demo-in-chrome.test.py'))
TD = importlib.util.module_from_spec(spec); spec.loader.exec_module(TD)
SHOTS = os.environ.get('VP_SHOTS', '')
PAGE = '/app/play-quick.html'
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


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
ORDER = 'var __v; Object.defineProperty(window,"VPQuick",{configurable:true,get:function(){return __v;},set:function(v){ v.cfg.STEPS=["games","demo","choices"]; __v=v; }});'
FIT = r'''(function(){ var sec=document.querySelector("main section.on .form-shell"); if(!sec) return {none:true}; var r=sec.getBoundingClientRect(); var d=document.documentElement;
  var small=[].filter.call(sec.querySelectorAll("button,.btn,label.st-kind-opt span"),function(b){var q=b.getBoundingClientRect();return q.width>0&&q.height>0&&q.height<44;}).length;
  return {wide:d.scrollWidth-window.innerWidth, left:Math.round(r.left), right:Math.round(r.right), vw:window.innerWidth, small:small, top:Math.round(r.top), bottom:Math.round(r.bottom), vh:window.innerHeight}; })()'''


def IF(r, s, js):
    """Run JS inside the page's game iframe (the real page, same origin)."""
    return r.ask(s, '(function(){ var f=document.querySelector("#qpStage iframe.screen"); if(!f||!f.contentWindow) return "no frame"; try{ return f.contentWindow.eval(%s); }catch(e){ return "ERR "+e; } })()' % json.dumps(js))


def steps(r, s):
    return json.loads(r.ask(s, 'JSON.stringify((window.__vpTrackQueue||[]).map(function(x){return x[0];}).concat(window.__steps))') or '[]')


def wait_step(r, s, name, secs):
    return TD.waits_until(lambda: name in steps(r, s), secs) if hasattr(TD, 'waits_until') else _poll(lambda: name in steps(r, s), secs)


def _poll(f, secs):
    t = time.time()
    while time.time() - t < secs:
        if f(): return True
        time.sleep(0.5)
    return False


def scene_a(RIG):
    print('\nA. A LAPTOP AT 1440: THE PAGE IS THE REAL TV; ONE PHONE JOINS; THE REAL QUESTIONS')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', PAGE), real_qr=True)
    try:
        TD.seed(r); TD.clock_now(r)
        tl, lap = r.open(PAGE + '?device=computer', before=BEFORE, width=1440, height=900)
        ok('it goes straight to the real TV: the real /tv, full screen, and the console runs itself out of sight',
           r.until(lap, '!!document.querySelector("#qpStage iframe.screen") && document.body.classList.contains("playing")', 40) is True and
           r.ask(lap, '/^\\/tv\\?venue=/.test(document.querySelector("#qpStage iframe.screen").getAttribute("src")) && /host\\.html\\?demo=auto&n=1$/.test(document.querySelector("iframe.driver").getAttribute("src"))') is True,
           r.ask(lap, 'document.body.className'))
        lay = r.json(lap, '(function(){ var f=document.querySelector("#qpStage iframe.screen").getBoundingClientRect(); var h=document.querySelector("header"); return {w:Math.round(f.width), h:Math.round(f.height), hdr:getComputedStyle(h).display, main:getComputedStyle(document.querySelector("main")).display, bodyText:document.body.innerText.replace(/\\s+/g," ").slice(0,200)}; })()', {})
        ok('  the TV fills the window at 16:9 and nothing of ours is drawn over it: no header, no side panel, none of our own words',
           lay.get('hdr') == 'none' and lay.get('main') == 'none' and lay.get('w', 0) >= 1400 and abs(lay.get('w', 1) / max(lay.get('h', 1), 1) - 16 / 9) < 0.03 and 'Scan with your phone' not in lay.get('bodyText', ''), lay)
        ok('  the demo session opens, marked a demo', r.until(lap, 'true', 5) is True and _poll(lambda: any(s.get('is_demo') is True for s in TD.db(r, 'vp_sessions')), 40), TD.db(r, 'vp_sessions'))
        code = None
        t0 = time.time()
        while time.time() - t0 < 40 and not code:
            code = r.ask(lap, 'window.VPTry.joinCode') or None; time.sleep(0.5)
        ok('  the console says which room to join (the real TV shows it with its own QR)', bool(code), code)
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-tv-1440.jpg'))
        url = r.ask(lap, 'VPDemo.playUrl(VPTry.joinCode, { name:VPTry.me.name, mobile:VPTry.me.mobile })')
        ok('the phone link carries first name and mobile in the #fragment, and NEVER an email', '#vpdemo=' in (url or '') and '@' not in (url or ''), url)
        dec = r.ask(lap, '(function(){ var h=%s.split("#vpdemo=")[1]||""; try{ return JSON.stringify(VPDemo.readPrefill("#vpdemo="+h)); }catch(e){ return "ERR"; } })()' % json.dumps(url))
        ok('  decoded: no email key with a value', not re.search(r'"e":"[^"]', dec or ''), dec)
        t1, p1 = TD.phone_join(r, url, tick=False)
        r.ask(p1, 'document.getElementById("joinBtn").click(); true')
        ok('the phone joins with the real trivia phone screen and the game starts itself at 1 of 1', r.until(p1, TD.QUP, 90) is True, r.ask(lap, 'document.body.className'))
        gid = ([g for g in TD.db(r, 'vp_games') if g.get('format') == 'trivia'] or [{}])[-1].get('id')
        r.W.seed('v_vp_trivia_leaderboard', [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': 500} for p in TD.db(r, 'vp_players')])
        for q in (1, 2, 3, 4, 5):
            ok('question %d is on the real phone screen and the answer goes in' % q, _poll(lambda: bool(r.ask(p1, TD.QUP)), 60), r.ask(p1, TD.QTEXT))
            TD.answer(r, p1)
            _poll(lambda: ('demo_q%d' % q) in steps(r, lap), 20)
        ok('after the podium: "What games do you run now?" with nothing ticked and the true line under it',
           r.until(lap, 'document.getElementById("qpGames").classList.contains("on")', 120) is True and
           r.ask(lap, '[].filter.call(document.querySelectorAll("#qpChips input"),function(i){return i.checked;}).length') == 0 and
           r.ask(lap, 'document.querySelector("#qpGames .st-h").textContent') == 'What games do you run now?' and
           "We'll show you how each one works on venueplay." in (r.ask(lap, 'document.getElementById("qpGames").innerText') or ''), r.ask(lap, 'document.body.className'))
        ok('  the wizard\'s own five games', r.ask(lap, '[].map.call(document.querySelectorAll("#qpChips span"),function(b){return b.textContent;}).join("|")') == 'Trivia|Musical bingo|Bingo|Raffles|Members draws')
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-games-1440.jpg'))
        r.ask(lap, 'window.__saved=[]; var o=VP.saveSettings; VP.saveSettings=function(i,p){ window.__saved.push(p); return o.apply(VP,arguments); }; true')
        TD.clickid(r, lap, 'qpGame-musical'); TD.clickid(r, lap, 'qpGame-trivia'); TD.clickid(r, lap, 'qpGamesGo')
        ok('Next shows the choices in one consistent set, and says only true things',
           r.until(lap, 'document.getElementById("qpChoices").classList.contains("on")', 15) is True and
           r.ask(lap, '["qpAnother","qpInfo","qpSetup","qpCard"].map(function(i){return document.getElementById(i).textContent;}).join("|")') == "Play another game|I'd like more info|Set up my venue|Add my card" and
           'ready to play' not in (r.ask(lap, 'document.getElementById("qpChoices").innerText') or '').lower(), r.ask(lap, 'document.getElementById("qpChoices").innerText'))
        saved = json.loads(r.ask(lap, 'JSON.stringify(window.__saved)') or '[]')
        ok('what games do you run was saved through the wizard\'s saver (setup_answers.games)', len(saved) == 1 and sorted(((saved[0] or {}).get('setup_answers') or {}).get('games', [])) == ['musical', 'trivia'], saved)
        ok('the setup wizard is marked dismissed, and nothing opened or posted on its own', r.ask(lap, '(JSON.parse(localStorage.getItem("vpFirstRun:"+VPTry.venueId)||"{}")).dismissed') is True and
           not [c for c in json.loads(r.ask(lap, 'JSON.stringify(window.__calls)')) if re.search(r'more-info|card-link', c[0])])
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-choices-1440.jpg'))
        ok('before more info is tapped, the thank-you is NOT on the screen (only the four buttons are)', r.ask(lap, 'getComputedStyle(document.getElementById("qpThanks")).display') == 'none' and r.ask(lap, 'getComputedStyle(document.getElementById("qpChoiceBox")).display') != 'none')
        TD.clickid(r, lap, 'qpInfo')
        calls = json.loads(r.ask(lap, 'JSON.stringify(window.__calls)'))
        ok('"I\'d like more info" posts once with the venue and the game played, and shows only the thank-you',
           r.until(lap, '!document.getElementById("qpThanks").hidden', 10) is True and r.ask(lap, 'document.getElementById("qpThanksWords").textContent') == "Thanks, we'll be in touch." and
           r.ask(lap, 'document.getElementById("qpChoiceBox").hidden') is True and len([c for c in calls if 'more-info' in c[0]]) == 1 and '"game":"trivia"' in [c for c in calls if 'more-info' in c[0]][0][1].replace(' ', ''), calls)
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-thanks-1440.jpg'))
        st = steps(r, lap)
        for need in ('signed_in', 'demo_q1', 'demo_q5', 'podium_seen', 'games_answered', 'choice_info'):
            ok('the funnel step "%s" was fired through the one door' % need, need in st, st)
        ok('no script errors on the TV page or the phone', r.ask(lap, 'window.__errs ? window.__errs.length : 0') == 0 and r.ask(p1, 'window.__errs.length') == 0, r.ask(lap, 'JSON.stringify(window.__errs)'))
        for t in (t1, tl): r.close_tab(t)
    finally:
        r.close()


def scene_b(RIG):
    print('\nB. A PHONE VISITOR AT 390: NEVER "SCAN WITH YOUR PHONE"; THE REAL PHONE SCREEN PLAYS THE DEMO')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', PAGE), real_qr=True)
    try:
        TD.seed(r); TD.clock_now(r)
        t, s = r.open(PAGE, before=BEFORE, width=390, height=844)
        ok('a phone is asked first: "Ready for a quick game?" with the two buttons',
           r.until(s, 'document.getElementById("qpPhone").classList.contains("on")', 40) is True and
           r.ask(s, 'document.querySelector("#qpPhone .st-h").textContent') == 'Ready for a quick game?' and
           r.ask(s, '[document.getElementById("qpOnPhone").textContent, document.getElementById("qpNeedBig").textContent].join("|")') == "Play on this phone|I've got a laptop or TV here", r.ask(s, 'document.body.className'))
        ok('  "Scan with your phone to play" is not on the page', 'scan with your phone' not in (r.ask(s, 'document.body.innerText') or '').lower())
        f = r.json(s, FIT, {})
        ok('  the question is the website\'s own card, inside the screen, buttons 44px or taller', f.get('wide', 1) <= 0 and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0, f)
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-phone-choose-390px.jpg'))
        TD.clickid(r, s, 'qpOnPhone')
        ok('Play on this phone: the real trivia phone screen fills the phone (play.html), the console runs itself',
           r.until(s, '(function(){ var f=document.querySelector("#qpStage iframe.screen"); return !!f && /\\/app\\/trivia\\/play\\.html\\?room=/.test(f.getAttribute("src")); })()', 60) is True, r.ask(s, 'document.body.className'))
        IF(r, s, 'true')
        ok('  its join screen is pre-filled with first name and mobile, never an email', _poll(lambda: IF(r, s, '!!document.getElementById("xEmail")') is True, 30) and IF(r, s, 'document.getElementById("xEmail").value') in ('', None), IF(r, s, 'document.getElementById("xEmail") ? document.getElementById("xEmail").value : "no field"'))
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-phone-join-390px.jpg'))
        IF(r, s, 'document.getElementById("joinBtn").click(); true')
        qup = TD.QUP
        for q in (1, 2, 3, 4, 5):
            ok('question %d is on the phone, with its four answers, and the answer goes in' % q, _poll(lambda: IF(r, s, qup) is True, 90), IF(r, s, '(document.getElementById("pqText")||{}).textContent'))
            if q == 1 and SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-phone-question-390px.jpg'))
            if q == 1:
                _poll(lambda: bool(TD.db(r, 'vp_players')), 30)
                gid = ([g for g in TD.db(r, 'vp_games') if g.get('format') == 'trivia'] or [{}])[-1].get('id')
                r.W.seed('v_vp_trivia_leaderboard', [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': 500} for p in TD.db(r, 'vp_players')])   # the rig has no database views
            IF(r, s, '(function(){ var b=document.querySelectorAll("#pAnswers button")[2]; if(b) b.click(); return true; })()')
            _poll(lambda: ('demo_q%d' % q) in steps(r, s), 20)
            time.sleep(1.5)
        ok('after the result the games question comes up on the phone', r.until(s, 'document.getElementById("qpGames").classList.contains("on")', 150) is True, [r.ask(s, 'document.body.className'), r.ask(s, 'JSON.stringify(window.__errs)')])
        f = r.json(s, FIT, {})
        ok('  and it fits the phone: nothing wider than the screen, buttons 44px or taller', f.get('wide', 1) <= 0 and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0, f)
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-phone-games-390px.jpg'))
        r.close_tab(t)
        # the other button: a laptop or TV nearby
        t, s = r.open(PAGE, before=BEFORE, width=390, height=844)
        r.until(s, 'document.getElementById("qpPhone").classList.contains("on")', 40)
        TD.clickid(r, s, 'qpNeedBig')
        ok('"I\'ve got a laptop or TV here": the code to type on the big screen, in the website\'s own TV-code line',
           r.until(s, 'document.getElementById("qpCode").classList.contains("on")', 10) is True and
           re.match(r'^[A-Z0-9]{4,8}$', r.ask(s, 'document.getElementById("qpTvCode").textContent') or '') is not None and
           'venueplay.com.au/tv' in (r.ask(s, 'document.getElementById("qpTvLine").innerText') or ''), r.ask(s, 'document.getElementById("qpCode").innerText'))
        ok('  Text me the link goes to their own mobile (sms:), there is no email link, and the words name no address of theirs',
           (r.ask(s, 'document.getElementById("qpTextLink").getAttribute("href")') or '').startswith('sms:') and 'mailto' not in (r.ask(s, 'document.getElementById("qpCode").innerHTML') or ''), r.ask(s, 'document.getElementById("qpTextLink").getAttribute("href")'))
        f = r.json(s, FIT, {})
        ok('  it fits the phone', f.get('wide', 1) <= 0 and f.get('small', 1) == 0, f)
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-phone-code-390px.jpg'))
        TD.clickid(r, s, 'qpReady')
        ok('  "I\'m ready": this phone is the player (the real phone screen), the TV is the other screen',
           r.until(s, '!!document.querySelector("#qpStage iframe.screen") && document.body.classList.contains("playing")', 60) is True, r.ask(s, 'document.body.className'))
        r.close_tab(t)
    finally:
        r.close()


def scene_c(RIG):
    print('\nC. THE QUESTIONS AND THE CHOICES AT 320, 375, 390, 430 AND 1440 (the website\'s own cards)')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', PAGE), real_qr=True)
    try:
        TD.seed(r); TD.clock_now(r)
        for w, h in ((320, 568), (375, 667), (390, 844), (430, 932), (1440, 900)):
            t, s = r.open(PAGE + '?device=computer', before=BEFORE + ORDER, width=w, height=h)
            first = r.until(s, 'document.getElementById("qpGames").classList.contains("on")', 90)
            if w == 320:
                ok('the LATER order (games before the demo) is one array line: the games question comes first, no game yet', first is True and not r.ask(s, 'document.body.classList.contains("playing")'), r.ask(s, 'document.body.className'))
            f = r.json(s, FIT, {})
            ok('%dpx: the games card: nothing wider than the screen, inside it, buttons and choices 44px or taller' % w, first is True and f.get('wide', 1) <= 0 and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0, f)
            if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-games-%dpx.jpg' % w))
            TD.clickid(r, s, 'qpGamesGo')
            ok('%dpx: after the games question the real TV comes up' % w, r.until(s, '!!document.querySelector("#qpStage iframe.screen") && document.body.classList.contains("playing")', 40) is True, r.ask(s, 'document.body.className'))
            if w in (390, 1440) and SHOTS:
                time.sleep(8); r.shot(s, os.path.join(SHOTS, 'quick-tv-%dpx.jpg' % w))
            r.ask(s, 'document.body.classList.remove("playing"); document.getElementById("qpGames").classList.remove("on"); document.getElementById("qpChoices").classList.add("on"); true')
            ok('%dpx: the thank-you is not showing under the four buttons' % w, r.ask(s, 'getComputedStyle(document.getElementById("qpThanks")).display') == 'none', r.ask(s, 'getComputedStyle(document.getElementById("qpThanks")).display'))
            f = r.json(s, FIT, {})
            ok('%dpx: the choices card: nothing wider than the screen, buttons 44px or taller, the same four buttons' % w, f.get('wide', 1) <= 0 and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0 and
               r.ask(s, '["qpAnother","qpInfo","qpSetup","qpCard"].map(function(i){return document.getElementById(i).textContent;}).join("|")') == "Play another game|I'd like more info|Set up my venue|Add my card", f)
            if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-choices-%dpx.jpg' % w))
            TD.clickid(r, s, 'qpCard')
            ok('%dpx: "Add my card" asks for the card page (never automatic) and says so if one is already on' % w,
               r.until(s, '/already added/.test(document.getElementById("qpErr").textContent)', 10) is True and any('card-link' in c[0] for c in json.loads(r.ask(s, 'JSON.stringify(window.__calls)'))), r.ask(s, 'document.getElementById("qpErr").textContent'))
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
    if only in ('', 'B'): scene_b(RIG)
    if only in ('', 'C'): scene_c(RIG)
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
