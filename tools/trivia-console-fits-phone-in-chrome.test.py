#!/usr/bin/env python3
"""THE TRIVIA HOST CONSOLE FITS ONE PHONE SCREEN DURING A GAME (Dean, live, 15 Nov 2026).

Dean on live: "the gaming console looks awful and you have to scroll down to do anything. My one rule is to
make everything easier." On his phone the Time's-up buzzer, Game sounds and "Reveal the answer automatically"
rows sat above the question card, and the green Reveal button was below the fold.

This opens a REAL room on the browser rig (a signed-in trivia host, tv.html on the venue's link, the real game
Worker in jsc), plays a two-question quiz (one of them a six-line question) on a phone-sized console, and at 375x667 and 390x844 checks, at
"First question", on both questions and on the reveal:

  - the page is not scrolled and has no sideways scroll
  - the question card (#runBody .qwrap) is wholly inside the screen
  - the main action button (First question / Reveal answer / Next question) is wholly inside the screen
  - the settings are behind one closed "Settings" control (#hostSettings), and that control sits BELOW the
    action button, never above the question card (put the rows back on top and this goes red)

and that the settings still work from there: opened, the buzzer's On switch is on screen, a tap turns it on
and saves it for the venue (vpTriviaBuzzer:<venue>), and the auto reveal seconds box is still there. Before the
game (the lobby) the rows show in full, as they always have, with no extra control.

PNG screenshots of each state at each size go to $VP_SHOTS when it is set.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/trivia-console-fits-phone-in-chrome.test.py
"""
import base64, json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
SET = '33333333-3333-4333-8333-333333333333'
SIZES = ((375, 667), (390, 844))
QS = [
    ('Which Australian city hosted the 2000 Summer Olympics?', ['Melbourne', 'Sydney', 'Brisbane', 'Perth'], 1),
    ('In Irish legend, the giant Finn McCool is said to have created Lough Neagh, the largest lake in the British Isles. '
     'In which country is Lough Neagh?', ['Northern Ireland', 'Scotland', 'Wales', 'Republic of Ireland'], 0),
]   # two questions, so both are asked whatever order the Worker draws them in: the long one is always measured


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


# Where the card, the main button and the settings are, in the host's viewport.
MEASURE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); if(!(b.width>0 && b.height>0)) return null; return {top:Math.round(b.top), bottom:Math.round(b.bottom), left:Math.round(b.left), right:Math.round(b.right)}; }
  /* A row inside a CLOSED <details> keeps a box in Chrome (its slot is content-visibility:hidden), so "painted" is
     checkVisibility(), not the box. */
  function V(e){ return (e && e.checkVisibility && !e.checkVisibility()) ? null : R(e); }
  var body=document.getElementById("runBody");
  var card=body && body.querySelector(".qwrap");
  var main=[].filter.call(body ? body.querySelectorAll(".btn.big") : [], function(b){ return !b.classList.contains("ghost") && b.getBoundingClientRect().height>0; })[0];
  var hs=document.getElementById("hostSettings"), sum=hs && hs.querySelector("summary");
  return JSON.stringify({ h:window.innerHeight, w:window.innerWidth, sy:Math.round(window.scrollY||0), sw:document.documentElement.scrollWidth,
    card:R(card), main:R(main), mainText: main ? main.textContent.trim() : null,
    settings:R(hs), summary:R(sum), summaryText: sum ? sum.textContent.replace(/\s+/g," ").trim() : null, open: hs ? !!hs.open : null,
    buzzer:V(document.getElementById("buzzerRow")), auto:V(document.getElementById("autoRevealRow")), sounds:V(document.getElementById("soundsRow")) });
})()'''

ERRT = 'JSON.stringify([(document.getElementById("hostErrText")||{}).textContent, [].map.call(document.querySelectorAll("button"),function(x){return x.textContent.trim();}).join("|")])'


def click_btn(r, sid, text):
    return r.ask(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(text))


def wait_btn(r, sid, text, secs=25):
    return r.until(sid, '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(text), secs)


def size(r, sid, w, h):
    r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    r.ask(sid, 'window.scrollTo(0,0); true')
    time.sleep(0.6)


def png(r, sid, name):
    if not SHOTS: return
    try:
        d = r.B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        with open(os.path.join(SHOTS, name), 'wb') as f: f.write(base64.b64decode(d['data']))
    except Exception as e:
        print('  (screenshot %s not saved: %s)' % (name, e))


def fits(r, sid, state, want):
    """The one-screen checks, at both phone sizes, for this state."""
    for (w, h) in SIZES:
        size(r, sid, w, h)
        m = r.json(sid, MEASURE)
        tag = '%s at %dx%d' % (state, w, h)
        png(r, sid, 'host-%s-%dx%d.png' % (state, w, h))
        c, b = m.get('card'), m.get('main')
        ok(tag + ': the page is not scrolled and nothing runs off the side', m['sy'] == 0 and m['sw'] <= m['w'], m)
        ok(tag + ': the question card is wholly on screen', bool(c) and c['top'] >= 0 and c['bottom'] <= m['h'], m)
        ok(tag + ': the main button "%s" is wholly on screen' % want, bool(b) and m['mainText'] == want and b['top'] >= 0 and b['bottom'] <= m['h'], m)
        ok(tag + ': the settings are closed, behind one "Settings" control', m['open'] is False and bool(m['summary']) and (m['summaryText'] or '').startswith('Settings')
           and m['buzzer'] is None and m['auto'] is None and m['sounds'] is None, m)
        ok(tag + ': and that control sits below the main button, never above the question card',
           bool(b) and bool(c) and bool(m['settings']) and m['settings']['top'] >= b['bottom'] and m['settings']['top'] > c['bottom'], m)


def play():
    print('\nTHE TRIVIA HOST CONSOLE ON A PHONE (a real room)')
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import rig as RIG
    r = RIG.Rig(host_pages=('/app/trivia/host.html',))
    try:
        V = r.W.info['venue']
        row = {'id': SET, 'title': 'Pub Classics', 'question_count': len(QS), 'visibility': 'public', 'owner_venue_id': V, 'status': 'active'}
        r.db['vp_question_sets'] = [dict(row)]
        r.W.seed('vp_question_sets', [dict(row)])
        r.W.seed('vp_questions', [{'id': 'q-%d' % (i + 1), 'set_id': SET, 'seq': i + 1, 'question': q[0], 'text': q[0], 'options': q[1], 'correct_index': q[2]}
                                  for i, q in enumerate(QS)])
        t1, tv = r.open('/tv?venue=' + r.W.info['slug'], width=1920, height=1080)
        r.until(tv, '!!document.getElementById("adsRoot")', 15)
        t2, host = r.open('/app/trivia/host.html?venue=' + V, width=390, height=844)
        r.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 25); time.sleep(2)
        r.ask(host, 'document.getElementById("cfgCount").value="%d"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true' % len(QS))

        # BEFORE THE GAME: the rows in full, as always
        m = r.json(host, MEASURE)
        ok('before the game the three rows show in full, with no extra Settings control in the way',
           bool(m['buzzer']) and bool(m['auto']) and bool(m['sounds']) and m['summary'] is None, m)

        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(2)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(2)
        ok('the host opens the lobby', r.until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 15) is True,
           r.ask(host, ERRT))
        m = r.json(host, MEASURE)
        ok('in the lobby the rows still show in full', bool(m['buzzer']) and bool(m['auto']) and bool(m['sounds']) and m['summary'] is None, m)
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(1)
        for _ in range(3):
            if r.ask(host, '!!document.getElementById("vpAskGo") || !!document.querySelector(".vp-ask button")') is True:
                r.ask(host, '(function(){ var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); b.click(); return true; })()'); time.sleep(1)
        ok('the round starts: the console offers the first question', wait_btn(r, host, 'First question', 30) is True, r.ask(host, ERRT))
        fits(r, host, 'ready', 'First question')

        click_btn(r, host, 'First question')
        ok('question 1 is up', wait_btn(r, host, 'Reveal answer', 30) is True, r.ask(host, ERRT))
        fits(r, host, 'question-1', 'Reveal answer')

        # THE SETTINGS STILL WORK FROM THERE
        size(r, host, 390, 844)
        r.ask(host, '(function(){ var s=document.querySelector("#hostSettings summary"); if(s) s.click(); return true; })()'); time.sleep(0.5)
        r.ask(host, '(function(){ var h=document.getElementById("hostSettings"); if(h) h.scrollIntoView({block:"start"}); return true; })()'); time.sleep(0.4)
        s = r.json(host, '(function(){ var b=document.querySelector(\'#cfgBuzzer [data-v="on"]\'), r=b.getBoundingClientRect(), a=document.getElementById("cfgAutoSecs"), h=document.getElementById("hostSettings");'
                         'return JSON.stringify({open:!!h && h.open, on:r.height>0 && r.top>=0 && r.bottom<=innerHeight, secs:a ? a.value : null,'
                         'auto:!!document.querySelector("#cfgAutoReveal button.on")}); })()')
        ok('opened, the Settings show the buzzer switch on screen and the auto reveal seconds', s.get('open') is True and s.get('on') is True and s.get('secs') == '10' and s.get('auto') is True, s)
        png(r, host, 'host-question-settings-open-390x844.png')
        r.ask(host, 'document.querySelector(\'#cfgBuzzer [data-v="on"]\').click(); true'); time.sleep(0.4)
        b = r.json(host, 'JSON.stringify({on:(document.querySelector("#cfgBuzzer button.on")||{}).textContent, saved:localStorage.getItem("vpTriviaBuzzer:%s")})' % V)
        ok('a tap on On turns the buzzer on and saves it for the venue, as before', b.get('on') == 'On' and b.get('saved') == '1', b)
        r.ask(host, 'document.querySelector(\'#cfgBuzzer [data-v="off"]\').click(); var h=document.getElementById("hostSettings"); if(h) h.open=false; window.scrollTo(0,0); true'); time.sleep(0.4)

        click_btn(r, host, 'Reveal answer')
        if wait_btn(r, host, 'Next question', 8) is not True:
            click_btn(r, host, 'Reveal answer')    # with auto reveal on, the first tap during the clock asks for a second
        ok('question 1 revealed', wait_btn(r, host, 'Next question', 25) is True, r.ask(host, ERRT))
        fits(r, host, 'reveal', 'Next question')

        click_btn(r, host, 'Next question')
        ok('question 2 is up', wait_btn(r, host, 'Reveal answer', 30) is True, r.ask(host, ERRT))
        fits(r, host, 'question-2', 'Reveal answer')
        ok('no script errors on the console', r.ask(host, 'window.__errs.length') == 0, r.ask(host, 'JSON.stringify(window.__errs)'))
        r.close_tab(t2); r.close_tab(t1)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-console-fits-phone-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    play()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
