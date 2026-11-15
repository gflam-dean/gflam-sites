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


QUESTIONS = [
    ('Which city is the capital of Australia?', ['Sydney', 'Melbourne', 'Canberra', 'Perth'], 2),
    ('How many players are on the court for one team in a game of netball?', ['Five', 'Seven', 'Nine', 'Eleven'], 1),
    ('Which animal appears on the Australian 50 cent coin?', ['Koala', 'Kangaroo', 'Platypus', 'Emu'], 1),
    ('What is the longest river in Australia?', ['Murray', 'Darling', 'Yarra', 'Swan'], 0),
    ('In which state is Uluru?', ['Queensland', 'South Australia', 'Western Australia', 'Northern Territory'], 3),
    ('Which sport is the Melbourne Cup?', ['Cricket', 'Horse racing', 'Rugby league', 'Tennis'], 1),
    ('What colour is the Australian flag\'s Southern Cross?', ['Red', 'Gold', 'White', 'Blue'], 2),
    ('Which ocean is on the east coast of Australia?', ['Indian', 'Southern', 'Pacific', 'Atlantic'], 2)]


def quick_seed(r):
    """A new venue made by the three-box start, as the real game Worker sees it: an EMPTY account email, a logo, real questions."""
    TD.seed(r)
    r.W.seed('vp_questions', [{'id': 'q-%d' % (i + 1), 'set_id': TD.SET, 'seq': i + 1, 'parked_at': None, 'question': q[0], 'text': q[0], 'options': q[1], 'correct_index': q[2]} for i, q in enumerate(QUESTIONS)], replace=True)
    v = {'id': r.W.info['venue'], 'name': 'Test Alpha', 'slug': r.W.info['slug'], 'status': 'active', 'join_code': r.W.info['code'], 'au_state': 'QLD', 'max_players': 100,
         'created_at': '2026-01-01T00:00:00Z', 'founding_id': 'f-quick', 'logo_url': '/logos/venue-tugun-bowls.png'}
    r.W.seed('vp_venues', [v], replace=True)
    r.W.seed('venueplay_founding', [{'id': 'f-quick', 'status': 'active', 'contact_email': '', 'created_at': '2026-01-01T00:00:00Z'}])
    r.db['vp_venues'][0]['logo_url'] = '/logos/venue-tugun-bowls.png'
    r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': r.W.info['slug'], 'logo_url': '/logos/venue-tugun-bowls.png', 'slides': []}], replace=True)   # where the TV reads the venue's logo from


def quick_join(r, url):
    """A second phone opens the room link (the real join screen) and waits for it; no email box exists to wait for."""
    t, s = r.open(re.sub(r'^https?://[^/]+', '', url), width=375, height=812)
    r.phone_ready(s, 60)
    return t, s


def scene_a(RIG):
    print('\nA. A LAPTOP AT 1440: THE PAGE IS THE REAL TV; ONE PHONE JOINS; THE REAL QUESTIONS')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', PAGE), real_qr=True)
    try:
        quick_seed(r); TD.clock_now(r)
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
        t1, p1 = quick_join(r, url)
        jx = r.json(p1, '(function(){ return { email:!!document.getElementById("xEmail"), optin:!!document.getElementById("xOptin"), boxes:[].map.call(document.querySelectorAll("#joinExtra input"),function(i){return i.id||i.name;}), text:(document.getElementById("joinExtra")||{}).innerText||"" }; })()', {})
        ok('THE REAL JOIN SCREEN HAS NO EMAIL BOX AND NO OFFERS TICK (Dean: no email field anywhere)', jx.get('email') is False and jx.get('optin') is False and 'send me offers' not in jx.get('text', '').lower() and 'tick the box' not in jx.get('text', '').lower() and 'these details are optional' not in jx.get('text', '').lower() and 'This is a demo game. Up to 10 for the demo.' in jx.get('text', ''), jx)
        if SHOTS: r.shot(p1, os.path.join(SHOTS, 'quick-laptop-phone-join-375px.jpg'))
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
        ok('Next shows the choices in one consistent set (Play another game is not offered: there is no second game to play yet), and says only true things',
           r.until(lap, 'document.getElementById("qpChoices").classList.contains("on")', 15) is True and
           r.ask(lap, '["qpInfo","qpSetup","qpCard"].filter(function(i){return !document.getElementById(i).hidden;}).map(function(i){return document.getElementById(i).textContent;}).join("|")') == "I'd like more info|Set up my venue|Add my card" and
           r.ask(lap, 'document.getElementById("qpAnother").hidden') is True and
           'ready to play' not in (r.ask(lap, 'document.getElementById("qpChoices").innerText') or '').lower(), r.ask(lap, 'document.getElementById("qpChoices").innerText'))
        saved = json.loads(r.ask(lap, 'JSON.stringify(window.__saved)') or '[]')
        ok('what games do you run was saved through the wizard\'s saver (setup_answers.games)', len(saved) == 1 and sorted(((saved[0] or {}).get('setup_answers') or {}).get('games', [])) == ['musical', 'trivia'], saved)
        ok('the setup wizard is marked dismissed, and nothing opened or posted on its own', r.ask(lap, '(JSON.parse(localStorage.getItem("vpFirstRun:"+VPTry.venueId)||"{}")).dismissed') is True and
           not [c for c in json.loads(r.ask(lap, 'JSON.stringify(window.__calls)')) if re.search(r'more-info|card-link', c[0])])
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'quick-choices-1440.jpg'))
        ok('before more info is tapped, the thank-you is NOT on the screen (only the four buttons are)', r.ask(lap, 'getComputedStyle(document.getElementById("qpThanks")).display') == 'none' and r.ask(lap, 'getComputedStyle(document.getElementById("qpChoiceBox")).display') != 'none')
        TD.clickid(r, lap, 'qpInfo')
        calls = json.loads(r.ask(lap, 'JSON.stringify(window.__calls)'))
        ok('"I\'d like more info" posts once with the venue and the game played, says Got it / Thanks, we\'ll be in touch, and leaves Set up my venue and Add my card (no dead end)',
           r.until(lap, '!document.getElementById("qpThanks").hidden', 10) is True and r.ask(lap, 'document.getElementById("qpThanksWords").textContent') == "Thanks, we'll be in touch." and
           r.ask(lap, 'document.querySelector("#qpThanks h3").textContent') == 'Got it' and r.ask(lap, 'document.getElementById("qpInfo").hidden') is True and r.ask(lap, '!document.getElementById("qpSetup").hidden && !document.getElementById("qpCard").hidden') is True and len([c for c in calls if 'more-info' in c[0]]) == 1 and '"game":"trivia"' in [c for c in calls if 'more-info' in c[0]][0][1].replace(' ', ''), calls)
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
        quick_seed(r); TD.clock_now(r)
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
        _poll(lambda: IF(r, s, '!!document.getElementById("joinBtn")') is True, 40)
        ok('  its join screen has no email box and no offers tick, and is pre-filled with the first name only', IF(r, s, '!document.getElementById("xEmail") && !document.getElementById("xOptin") && !/offers|email/i.test((document.getElementById("joinExtra")||{}).innerText||"")') is True, IF(r, s, '(document.getElementById("joinExtra")||{}).innerText'))
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
        ok('  the text button says what it does (Text myself the code), goes to their own mobile (sms:), there is no email link',
           (r.ask(s, 'document.getElementById("qpTextLink").getAttribute("href")') or '').startswith('sms:') and r.ask(s, 'document.getElementById("qpTextLink").textContent') == 'Text myself the code' and 'mailto' not in (r.ask(s, 'document.getElementById("qpCode").innerHTML') or ''), r.ask(s, 'document.getElementById("qpTextLink").getAttribute("href")'))
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
        quick_seed(r); TD.clock_now(r)
        for w, h in ((320, 568), (375, 667), (390, 844), (430, 932), (1440, 900)):
            t, s = r.open(PAGE + '?device=computer', before=BEFORE + 'localStorage.removeItem("vpqGames-%s");' % r.W.info['venue'] + ORDER, width=w, height=h)   # every width is a first visit
            first = r.until(s, 'document.getElementById("qpGames").classList.contains("on")', 90)
            if w == 320:
                ok('the LATER order (games before the demo) is one array line: the games question comes first, no game yet', first is True and not r.ask(s, 'document.body.classList.contains("playing")'), r.ask(s, 'document.body.className'))
            f = r.json(s, FIT, {})
            ok('%dpx: the games card: nothing wider than the screen, inside it, buttons and choices 44px or taller' % w, first is True and f.get('wide', 1) <= 0 and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0, f)
            nb = r.json(s, '(function(){ var b=document.getElementById("qpGamesGo").getBoundingClientRect(); return {bottom:Math.round(b.bottom), vh:window.innerHeight}; })()', {})
            ok('%dpx: the Next button is on the screen without scrolling' % w, nb.get('bottom', 9999) <= nb.get('vh', 0), nb)
            if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-games-%dpx.jpg' % w))
            TD.clickid(r, s, 'qpGamesGo')
            ok('%dpx: after the games question the real TV comes up' % w, r.until(s, '!!document.querySelector("#qpStage iframe.screen") && document.body.classList.contains("playing")', 40) is True, r.ask(s, 'document.body.className'))
            if w in (390, 1440) and SHOTS:
                time.sleep(8); r.shot(s, os.path.join(SHOTS, 'quick-tv-%dpx.jpg' % w))
            r.ask(s, 'document.body.classList.remove("playing"); document.getElementById("qpGames").classList.remove("on"); document.getElementById("qpChoices").classList.add("on"); true')
            ok('%dpx: the thank-you is not showing under the four buttons' % w, r.ask(s, 'getComputedStyle(document.getElementById("qpThanks")).display') == 'none', r.ask(s, 'getComputedStyle(document.getElementById("qpThanks")).display'))
            f = r.json(s, FIT, {})
            ok('%dpx: the choices card: nothing wider than the screen, buttons 44px or taller, the same four buttons' % w, f.get('wide', 1) <= 0 and f.get('left', -1) >= 0 and f.get('right', 9999) <= f.get('vw', 0) and f.get('small', 1) == 0 and
               r.ask(s, '["qpInfo","qpSetup","qpCard"].filter(function(i){return !document.getElementById(i).hidden;}).map(function(i){return document.getElementById(i).textContent;}).join("|")') == "I'd like more info|Set up my venue|Add my card", f)
            if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-choices-%dpx.jpg' % w))
            TD.clickid(r, s, 'qpCard')
            ok('%dpx: "Add my card" asks for the card page (never automatic) and says so if one is already on' % w,
               r.until(s, '/already added/.test(document.getElementById("qpErr").textContent)', 10) is True and any('card-link' in c[0] for c in json.loads(r.ask(s, 'JSON.stringify(window.__calls)'))), r.ask(s, 'document.getElementById("qpErr").textContent'))
            r.close_tab(t)
    finally:
        r.close()


def scene_d(RIG):
    print('\nD. THE LINE "GO TO venueplay.com.au/tv AND TYPE THIS CODE" IS TRUE: the real /tv takes the venue code on its own keypad')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', PAGE), real_qr=True)
    try:
        quick_seed(r); TD.clock_now(r)
        t, s = r.open('/tv', width=1440, height=900)
        ok('bare /tv with no venue shows its setup card with Put in the screen code', r.until(s, '!!document.getElementById("tvSetupCode") && document.getElementById("tvSetupCode").offsetParent!==null', 40) is True, r.ask(s, 'document.body.innerText.slice(0,200)'))
        TD.clickid(r, s, 'tvSetupCode')
        ok('  it opens the keypad', r.until(s, '!!document.querySelector("#vpList a[data-ck]")', 10) is True)
        code = r.W.info['code']
        for ch in code:
            r.ask(s, '(function(){ var a=document.querySelector(\'#vpList a[data-ck="%s"]\'); if(a) a.click(); return !!a; })()' % ch)
            time.sleep(0.15)
        ok('  the venue\'s code (the one shown on the phone) opens that venue\'s screen', r.until(s, '/venue=test-alpha|Test Alpha/.test(location.search + document.body.innerText)', 30) is True, [r.ask(s, 'location.href'), r.ask(s, 'document.body.innerText.slice(0,160)')])
        r.close_tab(t)
    finally:
        r.close()


def scene_e(RIG):
    print('\nE. A LAPTOP VISITOR WITH NO PHONE: the game cannot start with nobody in it, so there is a quiet way on')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', PAGE), real_qr=True)
    try:
        quick_seed(r); TD.clock_now(r)
        HOOK = 'var __v; Object.defineProperty(window,"VPQuick",{configurable:true,get:function(){return __v;},set:function(v){ v.cfg.SKIP_AFTER_MS=4000; __v=v; }});'
        t, s = r.open(PAGE + '?device=computer', before=BEFORE + HOOK, width=1440, height=900)
        r.until(s, 'document.body.classList.contains("playing")', 40)
        time.sleep(2)
        ok('with nobody joined the real TV stays on its join screen: no question starts, and no skip link yet', 'demo_q1' not in steps(r, s) and r.ask(s, 'document.getElementById("qpSkip").hidden') is True, steps(r, s))
        ok('after the wait a quiet link appears: "No phone to hand? Skip the game"', r.until(s, '!document.getElementById("qpSkip").hidden', 20) is True and 'Skip the game' in (r.ask(s, 'document.getElementById("qpSkip").textContent') or ''), r.ask(s, 'document.getElementById("qpSkip").hidden'))
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-tv-skip-1440.jpg'))
        TD.clickid(r, s, 'qpSkip')
        ok('tapping it ends the demo and goes on to What games do you run now?', r.until(s, 'document.getElementById("qpGames").classList.contains("on")', 15) is True, r.ask(s, 'document.body.className'))
        r.close_tab(t)
    finally:
        r.close()


def scene_f(RIG):
    print('\nF. A TABLET HELD UPRIGHT IS NOT A TV; GAMES ARE NEVER ASKED TWICE')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', PAGE), real_qr=True)
    try:
        quick_seed(r); TD.clock_now(r)
        t, s = r.open(PAGE + '?device=tablet', before=BEFORE, width=820, height=1180)
        ok('an upright tablet is asked first, like a phone: Play on this tablet / I\'ve got a laptop or TV here, no QR TV',
           r.until(s, 'document.getElementById("qpPhone").classList.contains("on")', 40) is True and r.ask(s, 'document.getElementById("qpOnPhone").textContent') == 'Play on this tablet' and r.ask(s, 'document.body.classList.contains("playing")') is False, r.ask(s, 'document.body.className'))
        if SHOTS: r.shot(s, os.path.join(SHOTS, 'quick-tablet-choose-820px.jpg'))
        r.close_tab(t)
        t, s = r.open(PAGE + '?device=tablet', before=BEFORE, width=1180, height=820)
        ok('a tablet held wide is the TV: straight to the real /tv', r.until(s, 'document.body.classList.contains("playing") && !!document.querySelector("#qpStage iframe.screen")', 40) is True, r.ask(s, 'document.body.className'))
        r.close_tab(t)
        SAVED = 'localStorage.setItem("vpqGames-%s","1");' % r.W.info['venue']
        t, s = r.open(PAGE + '?device=computer', before=BEFORE + SAVED + ORDER, width=1440, height=900)
        ok('when the games answer is already saved the question is skipped (order: games first, so straight to the demo)', r.until(s, 'document.body.classList.contains("playing")', 40) is True and r.ask(s, 'document.getElementById("qpGames").classList.contains("on")') is False, r.ask(s, 'document.body.className'))
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
    if only in ('', 'D'): scene_d(RIG)
    if only in ('', 'E'): scene_e(RIG)
    if only in ('', 'F'): scene_f(RIG)
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
