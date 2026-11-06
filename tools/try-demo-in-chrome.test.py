#!/usr/bin/env python3
"""THE TRY-IT DEMO, PLAYED (Dean, 5 Nov 2026; INBOX 82, 84b, 92c, 93, 96).

Opens the REAL pages on the browser rig (tools/browser-rig/rig.py: the real game Worker in jsc, fake Supabase
with realtime between windows), signed in as a brand-new venue's owner, and plays the demo the way a person
would:

  A. ON A LAPTOP (1366 x 768), "As a player", 50 typed for "How many players will join?" (10, "Up to 10 for
     the demo"), then 2, "another device": this screen is the TV (/tv?venue=) with the QR for their phone, and
     the console runs itself out of sight. Two phones (375 x 812) join from the QR: the first is pre-filled with
     the owner's own name, email and mobile from sign-up and ticks the offers box, the second types a team name.
     Question 1: both answer and the answer goes up straight away (all answered), long before 30 s. Question 2:
     only one answers and the answer goes up when the 30 s run out. Five questions, then the podium and
     "That's the game", then "Set up my games" goes to the console. The Worker's database afterwards: the
     session is a demo; the ticked player is on THIS venue's list with email, mobile and consent time; the
     unticked one has no contact kept; no question burned, no weekly stamp, no saved prefs, nothing charged.
  B. NO OTHER DEVICE, on a phone or a laptop: no demo, straight into their account (Dean, 6 Nov 2026). The
     phone-only mini demo is switched off (VPDemo.PHONE_ONLY).
  C. ON A PHONE with another device: "This phone is your player. For the TV part, open venueplay.com.au/tv
     on a laptop or TV and type this code", the venue's screen code, and Text me / Email me to their OWN
     mobile and email only.
  D. "As the host too" on a laptop: the TV, the player QR and the host console QR, and nothing runs itself.
  E. Every step laid out for 375 px, a tablet (820 x 1180) and 1366 px: nothing wider than the screen, every
     button at least 44 px tall; the players box is a real form with name= and autocomplete=.
  F. The no-card start's done screen asks the first question in #st-try-slot, and the choice is what the
     one-tap sign-in opens.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/try-demo-in-chrome.test.py
"""
import json, os, re, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
SET = '33333333-3333-4333-8333-333333333333'


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


def clickid(r, sid, i):
    return r.ask(sid, '(function(){ var b=document.getElementById(%s); if(!b) return false; b.click(); return true; })()' % json.dumps(i))


FIT = r'''(function(){ var bad=[].filter.call(document.querySelectorAll("button,.btn,a.btn"),function(b){ var r=b.getBoundingClientRect(); return r.width>0 && r.height>0 && r.height<44; }).map(function(b){ return b.id||b.textContent.trim().slice(0,30); });
  return JSON.stringify({ wide: document.documentElement.scrollWidth - window.innerWidth, small: bad }); })()'''
STEP = '(function(){ var s=document.querySelector(".step.on"); return s ? s.id : (document.getElementById("play").classList.contains("on") ? "play" : ""); })()'


def seed(r):
    sets = [{'id': SET, 'title': 'General Knowledge', 'question_count': 8, 'visibility': 'library', 'owner_venue_id': None, 'status': 'active'}]
    r.db['vp_question_sets'] = sets
    r.W.seed('vp_question_sets', sets)
    r.W.seed('vp_questions', [{'id': 'q-%d' % i, 'set_id': SET, 'seq': i, 'parked_at': None, 'question': 'Question %d?' % i, 'text': 'Question %d?' % i,
                               'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2} for i in range(1, 9)])
    # a brand-new venue: a prospect, nothing played, on its first month
    r.db['vp_venue_staff'][0]['display_name'] = 'Dean Tindale'


def db(r, t):
    with r.W.lock:
        r.W.p.stdin.write(json.dumps({'table': t}) + '\n'); r.W.p.stdin.flush()
        line = r.W.p.stdout.readline()
    return (json.loads(line) or {}).get('body') or []


def to_play(r, sid, mode, n, other):
    clickid(r, sid, 'modePlayer' if mode == 'player' else 'modeHost')
    r.until(sid, STEP + '==="stepCount"', 10)
    r.ask(sid, 'var c=document.getElementById("countIn"); c.value=%s; c.dispatchEvent(new Event("change")); true' % json.dumps(str(n)))
    r.ask(sid, 'document.getElementById("countGo").click(); true')
    r.until(sid, STEP + '==="stepDevice"', 10)
    clickid(r, sid, 'devYes' if other else 'devNo')


# Every window in the rig is one browser profile, so a second "phone" would find the first one's player id and be
# the same player (play.html keeps it in localStorage, as a real phone does). A real second phone has its own.
OWN_PHONE = 'try{ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(/^vp-t(pid|name|token|sess)-/.test(k)) localStorage.removeItem(k); } }catch(e){}'


def phone_join(r, url, team=None, tick=False, own=False):
    t, s = r.open(re.sub(r'^https?://[^/]+', '', url), width=375, height=812, before=(OWN_PHONE if own else None))
    r.phone_ready(s, 60)
    r.until(s, '!!document.getElementById("xEmail")', 15)
    if team: r.ask(s, 'var n=document.getElementById("nameIn"); n.value=%s; true' % json.dumps(team))
    if tick: r.ask(s, 'document.getElementById("xOptin").click(); true')
    return t, s


def answer(r, s, i=2):
    return r.ask(s, '(function(){ var b=document.querySelectorAll("#pAnswers button")[%d]; if(!b) return false; b.click(); return true; })()' % i)


# What the console running the demo is showing (it is out of sight, in iframe.driver), for a failure message.
DRV = '(function(){ var f=document.querySelector("iframe.driver"), d=f&&f.contentDocument; if(!d) return "no driver"; return JSON.stringify({ err:(d.getElementById("hostErrText")||{}).textContent, note:(d.getElementById("noPlayersNote")||{}).textContent, btns:[].map.call(d.querySelectorAll("button"),function(b){ return b.getBoundingClientRect().height>0 ? b.textContent.trim() : ""; }).filter(Boolean).join("|"), errs:(f.contentWindow.__errs||[]) }); })()'
QUP = '(function(){ var v=document.getElementById("vQ"); return !!v && !v.classList.contains("hidden") && document.querySelectorAll("#pAnswers button").length===4; })()'
QTEXT = '(document.getElementById("pqText")||{}).textContent'


def scene_a(RIG):
    print('\nA. ON A LAPTOP, AS A PLAYER, TWO PHONES')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', '/app/try.html'))
    try:
        seed(r)
        tl, lap = r.open('/app/try.html?device=computer', width=1366, height=768)
        ok('the first question: "It\'s your first time here. How would you like to try it?"',
           r.until(lap, '/It.s your first time here\\. How would you like to try it\\?/.test(document.body.innerText) && ' + STEP + '==="stepMode"', 20) is True, r.ask(lap, STEP))
        ok('  two choices: "As a player" and "As the host too"', r.ask(lap, 'document.getElementById("modePlayer").innerText.indexOf("As a player")===0 && document.getElementById("modeHost").innerText.indexOf("As the host too")===0') is True)
        clickid(r, lap, 'modePlayer'); r.until(lap, STEP + '==="stepCount"', 10)
        ok('"How many players will join?" starts at 1', r.ask(lap, 'document.getElementById("countIn").value') == '1')
        r.ask(lap, 'var c=document.getElementById("countIn"); c.value="50"; c.dispatchEvent(new Event("change")); true')
        ok('50 typed is 10, "Up to 10 for the demo"', r.ask(lap, 'document.getElementById("countIn").value') == '10' and
           'Up to 10 for the demo' in (r.ask(lap, 'document.getElementById("countNote").textContent') or ''), r.ask(lap, 'document.getElementById("countNote").textContent'))
        r.ask(lap, 'var c=document.getElementById("countIn"); c.value="2"; c.dispatchEvent(new Event("change")); true')
        ok('the players box is a real form with a name and autocomplete', r.ask(lap, '(function(){ var f=document.getElementById("stepCount"), i=document.getElementById("countIn"); return f.tagName==="FORM" && i.form===f && i.name==="players" && i.getAttribute("autocomplete")==="off" && i.getAttribute("inputmode")==="numeric"; })()') is True)
        r.ask(lap, 'document.getElementById("countGo").click(); true')
        ok('then it ASKS: "Have you got another device handy (a phone, or a laptop or TV)?"',
           r.until(lap, STEP + '==="stepDevice" && /Have you got another device handy \\(a phone, or a laptop or TV\\)\\?/.test(document.body.innerText)', 10) is True)
        clickid(r, lap, 'devYes')
        ok('Yes: this screen is the TV, the venue\'s own screen', r.until(lap, '!!document.querySelector("#tvBox iframe") && document.querySelector("#tvBox iframe").getAttribute("src").indexOf("/tv?venue=' + r.W.info['slug'] + '")===0', 10) is True)
        ok('  and the game runs itself out of sight (the console, ?demo=auto, 2 players)',
           r.ask(lap, '(function(){ var d=document.querySelector("iframe.driver"); return !!d && /\\/app\\/trivia\\/host\\.html\\?demo=auto&n=2$/.test(d.getAttribute("src")) && d.getAttribute("aria-hidden")==="true"; })()') is True)
        ok('the demo session is opened, marked a demo', r.until(lap, '/joined/.test(document.getElementById("playStatus").textContent)', 40) is True and
           any(s.get('is_demo') is True for s in db(r, 'vp_sessions')), [db(r, 'vp_sessions'), r.ask(lap, 'document.getElementById("playStatus").textContent'), r.ask(lap, 'document.getElementById("playErr").textContent')])
        ok('  with the QR for their phone beside it, once the lobby is open', r.until(lap, '!document.getElementById("side").hidden && /Scan with your phone to play/.test(document.getElementById("side").innerText)', 10) is True)
        f = r.layout = r.json(lap, FIT)
        ok('laid out for 1366: nothing wider than the screen', f.get('wide', 1) <= 0, f)
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'try-lobby-1366.jpg'))
        url = r.ask(lap, 'VPDemo.playUrl(VPTry.joinCode || VPTry.code, { name:VPTry.me.name, email:VPTry.me.email, mobile:VPTry.me.mobile })')
        ok('the QR is for the player page with the room code and their details in the #fragment only', '/app/trivia/play.html?room=' in (url or '') and '#vpdemo=' in url and '@' not in url, url)
        t1, p1 = phone_join(r, url, tick=False)
        pre = r.json(p1, 'JSON.stringify({ n:document.getElementById("nameIn").value, e:(document.getElementById("xEmail")||{}).value, m:(document.getElementById("xMobile")||{}).value, t:(document.getElementById("xOptin")||{}).checked, h:location.hash, demo:!!document.getElementById("demoNote") })')
        ok('the first phone is pre-filled from sign-up: name, email and mobile', pre.get('n') == 'Dean' and pre.get('e') == 'host@test.local' and pre.get('m') == '0400 000 001', pre)
        ok('  the offers tick is NOT ticked for them', pre.get('t') is False, pre)
        ok('  their details are gone from the address', pre.get('h') == '', pre)
        ok('  the phone says it is a demo, "Up to 10 for the demo"', pre.get('demo') is True and 'Up to 10 for the demo' in (r.ask(p1, 'document.getElementById("demoNote").textContent') or ''))
        ok('  the tick names their own venue', 'Send me offers from Test Alpha. I\'m 18 or over.' in (r.ask(p1, 'document.getElementById("xOptin").parentNode.textContent') or ''),
           r.ask(p1, 'document.getElementById("xOptin").parentNode.textContent'))
        r.ask(p1, 'document.getElementById("xOptin").click(); true')
        r.ask(p1, 'document.getElementById("joinBtn").click(); true')
        t2, p2 = phone_join(r, url.split('#')[0], team='Table Two', own=True)
        ok('a phone without the details is not pre-filled (the TV\'s own QR carries nobody\'s)', r.ask(p2, '(document.getElementById("xEmail")||{}).value') == '')
        r.ask(p2, 'document.getElementById("joinBtn").click(); true')
        ok('both join: the game starts itself at 2 of 2', r.until(p1, QUP, 60) is True and r.until(p2, QUP, 10) is True, [r.ask(lap, 'document.getElementById("playStatus").textContent'), r.ask(p1, 'document.body.innerText.slice(0,200)')])
        ok('  the question is on the phone', 'Question' in (r.ask(p1, QTEXT) or ''), r.ask(p1, QTEXT))
        # The console's own state, as the laptop shows it (host.html?demo=auto tells the page): "Question N of 5." while
        # it is open, "Question N of 5: the answer" once revealed.
        def asked(n): return r.until(lap, '/^Question %d of 5\\. /.test(document.getElementById("playStatus").textContent)' % n, 40)
        def revealed(n, secs): return r.until(lap, '/^Question %d of 5: the answer/.test(document.getElementById("playStatus").textContent)' % n, secs)
        # Q1: both answer -> straight away
        asked(1); time.sleep(1); t0 = time.time(); answer(r, p1); answer(r, p2)
        up = revealed(1, 25)
        ok('Q1, both answered: the answer goes up straight away, long before 30 s', up is True and time.time() - t0 < 8, round(time.time() - t0, 1))
        # Q2: one answers -> 30 s
        ok('the next question comes by itself after the leaderboard', asked(2) is True, r.ask(lap, 'document.getElementById("playStatus").textContent'))
        t0 = time.time(); r.until(p1, QUP, 10); answer(r, p1)
        early = revealed(2, 18)
        ok('Q2, one of two answered: no answer yet at 18 s', early is not True, round(time.time() - t0, 1))
        up = revealed(2, 25)
        ok('  and it goes up when the 30 s run out', up is True and 22 <= time.time() - t0 <= 40, round(time.time() - t0, 1))
        for q in (3, 4, 5):
            asked(q); r.until(p1, QUP, 10); answer(r, p1); answer(r, p2)
            revealed(q, 25)
        ok('after 5 questions: "That\'s the game" on the laptop', r.until(lap, 'document.getElementById("done").classList.contains("on")', 60) is True,
           [r.ask(lap, 'document.getElementById("playStatus").textContent'), r.ask(lap, DRV), len(db(r, 'vp_trivia_answers')), db(r, 'vp_trivia_answers')[:2],
            r.W.ask('POST', '/host/reveal', {'game_id': (db(r, 'vp_games') or [{}])[-1].get('id')}, {'Authorization': 'Bearer x'})])
        ok('  with the leaderboard, Dean first (he ticked nothing wrong)', 'points' in (r.ask(lap, 'document.getElementById("doneBoard").innerText') or ''), r.ask(lap, 'document.getElementById("doneBoard").innerText'))
        ok('  and one button on: "Set up my games", to the console', r.ask(lap, 'document.getElementById("toConsole").getAttribute("href")') == '/app/' and
           r.ask(lap, 'document.getElementById("toConsole").textContent') == 'Set up my games')
        ok('  the wizard will know a demo was played on this screen', r.ask(lap, 'localStorage.getItem("vpDemoPlayed-"+VPTry.venueId)') == '1')
        if SHOTS: r.shot(lap, os.path.join(SHOTS, 'try-done-1366.jpg')); r.shot(p1, os.path.join(SHOTS, 'try-phone-375.jpg'))
        sess = [s for s in db(r, 'vp_sessions') if s.get('is_demo') is True]
        sid_ = sess[0]['id'] if sess else ''
        pl = [p for p in db(r, 'vp_players') if p.get('session_id') == sid_]
        dean = [p for p in pl if p.get('email')]
        two = [p for p in pl if p.get('display_name') == 'Table Two']
        ok('the ticked player is on THIS venue\'s list: email, mobile, opt-in and its time', len(dean) == 1 and dean[0].get('marketing_optin') is True and dean[0].get('mobile') and dean[0].get('marketing_optin_at'), pl)
        ok('the unticked player has no email or mobile kept', len(two) == 1 and not two[0].get('email') and not two[0].get('mobile') and not two[0].get('marketing_optin'), two)
        ok('nothing remembered: no question burned, no weekly stamp, no saved trivia settings',
           not db(r, 'vp_asked_questions') and not (db(r, 'vp_venues')[0].get('last_trivia_session_id')) and not [x for x in db(r, 'vp_venue_settings') if x.get('trivia_time_limit_s')],
           [db(r, 'vp_asked_questions')[:2], db(r, 'vp_venues')[0].get('last_trivia_session_id'), db(r, 'vp_venue_settings')])
        g = [x for x in db(r, 'vp_games') if x.get('session_id') == sid_]
        ok('one round of 5 questions of 30 s', len(g) == 1 and (g[0].get('config') or {}).get('question_count') == 5 and (g[0].get('config') or {}).get('time_limit_s') == 30, g)
        ok('no script errors on the laptop or the phones', r.ask(lap, 'window.__errs.length') == 0 and r.ask(p1, 'window.__errs.length') == 0,
           [r.ask(lap, 'JSON.stringify(window.__errs)'), r.ask(p1, 'JSON.stringify(window.__errs)')])
        for t in (t2, t1, tl): r.close_tab(t)
    finally:
        r.close()


def scene_bcd(RIG):
    print('\nB. NO OTHER DEVICE: NO DEMO, STRAIGHT INTO THEIR ACCOUNT (Dean, 6 Nov 2026)')
    r = RIG.Rig(host_pages=('/app/trivia/host.html', '/app/try.html'))
    try:
        seed(r)
        for dev, w, h in (('phone', 375, 812), ('computer', 1366, 768)):
            tb, ph = r.open('/app/try.html?device=%s' % dev, width=w, height=h)
            r.until(ph, STEP + '==="stepMode"', 20)
            if dev == 'phone':
                f = r.json(ph, FIT); ok('laid out for 375 (the first question)', f.get('wide', 1) <= 0 and not f.get('small'), f)
            to_play(r, ph, 'player', 1, False)
            ok('on a %s, "No": straight into their account (the console home), no demo' % dev, r.until(ph, 'location.pathname==="/app/" || location.pathname==="/app/index.html"', 15) is True, r.ask(ph, 'location.href'))
            ok('  and no demo session was opened', not any(x.get('is_demo') for x in db(r, 'vp_sessions')), db(r, 'vp_sessions'))
            r.close_tab(tb)
        ok('the phone-only mini demo is switched off (VPDemo.PHONE_ONLY)', 'var PHONE_ONLY = false;' in open(os.path.join(ROOT, 'venueplay/app/vp-demo.js')).read())

        print('\nC. ON A PHONE WITH A LAPTOP OR TV HANDY')
        tc, pc = r.open('/app/try.html?device=phone', width=375, height=812)
        r.until(pc, STEP + '==="stepMode"', 20)
        to_play(r, pc, 'player', 1, True)
        ok('"This phone is your player. For the TV part, open venueplay.com.au/tv on a laptop or TV and type this code"',
           r.until(pc, STEP + '==="stepPhoneTv" && /This phone is your player\\./.test(document.body.innerText) && /For the TV part, open venueplay\\.com\\.au\\/tv on a laptop or TV and type this code:/.test(document.body.innerText)', 10) is True)
        ok('  the code is the venue\'s screen code', r.ask(pc, 'document.getElementById("phoneTvCode").textContent') == r.W.info['code'])
        links = r.json(pc, 'JSON.stringify({ t:document.getElementById("textLink").getAttribute("href"), e:document.getElementById("emailLink").getAttribute("href") })')
        ok('  "Text me the link" goes to their own mobile only', (links.get('t') or '').startswith('sms:0400000001?'), links)
        ok('  "Email me the link" goes to their own email only', (links.get('e') or '').startswith('mailto:host%40test.local?'), links)
        f = r.json(pc, FIT); ok('  laid out for 375', f.get('wide', 1) <= 0 and not f.get('small'), f)
        if SHOTS: r.shot(pc, os.path.join(SHOTS, 'try-phone-tvcode-375.jpg'))
        r.close_tab(tc)

        print('\nD. AS THE HOST TOO, ON A LAPTOP')
        td, ld = r.open('/app/try.html?device=computer', width=1366, height=768)
        r.until(ld, STEP + '==="stepMode"', 20)
        to_play(r, ld, 'host', 3, True)
        ok('the TV and the player QR, plus the host console QR', r.until(ld, '!document.getElementById("hostPart").hidden && !!document.querySelector("#tvBox iframe")', 10) is True)
        ok('  and nothing runs itself here (the host runs the 5 questions)', r.ask(ld, '!document.querySelector("iframe.driver")') is True)
        ok('  the host link is the demo console', r.ask(ld, 'VPDemo.hostUrl(VPTry.n)').endswith('/app/trivia/host.html?demo=host&n=3'))
        r.close_tab(td)

        print('\nE. EVERY STEP AT 375, A TABLET AND 1366')
        for (w, h) in ((375, 812), (820, 1180), (1366, 768)):
            te, pe = r.open('/app/try.html?device=%s' % ('phone' if w < 600 else ('tablet' if w < 1000 else 'computer')), width=w, height=h)
            r.until(pe, STEP + '==="stepMode"', 20)
            seen = []
            for step, act in (('stepMode', 'modePlayer'), ('stepCount', 'countGo'), ('stepDevice', None)):
                r.until(pe, STEP + '===%s' % json.dumps(step), 10)
                f = r.json(pe, FIT); seen.append((step, f))
                if act: clickid(r, pe, act)
            ok('at %d x %d: no step is wider than the screen, every button at least 44 px' % (w, h), all(x[1].get('wide', 1) <= 0 and not x[1].get('small') for x in seen), seen)
            if SHOTS: r.shot(pe, os.path.join(SHOTS, 'try-device-%d.jpg' % w))
            r.close_tab(te)

        print('\nF. THE DONE SCREEN ASKS FIRST, AND THE SIGN-IN OPENS THE DEMO')
        tf, pf = r.open('/nsw.html', width=375, height=812)
        r.until(pf, '!!document.getElementById("st-try-slot") && !!window.VPTrySlot', 20)
        r.ask(pf, 'document.dispatchEvent(new CustomEvent("vp-start-done", { detail: { venue:"Test Alpha", tv_code:"ABCDEF", go_url:"/__blank", slug:"test-alpha", players:10 } })); true')
        ok('the slot asks "It\'s your first time here. How would you like to try it?"', r.until(pf, '!document.getElementById("st-try-slot").hidden && /How would you like to try it\\?/.test(document.getElementById("st-try-slot").innerText)', 10) is True)
        r.ask(pf, 'document.getElementById("st-try-player").click(); true')
        ok('  "As a player" is remembered for the sign-in, and the one-tap sign-in opens', r.until(pf, 'location.pathname==="/__blank"', 10) is True and
           '/app/try.html?mode=player' in (r.ask(pf, 'localStorage.getItem("vpTryNext")') or ''), r.ask(pf, 'location.href'))
        r.close_tab(tf)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('try-demo-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import rig as RIG
    only = os.environ.get('VP_SCENE', '')
    if only in ('', 'A'): scene_a(RIG)
    if only in ('', 'B'): scene_bcd(RIG)
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
