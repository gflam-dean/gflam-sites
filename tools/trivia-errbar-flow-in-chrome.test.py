#!/usr/bin/env python3
"""THE TRIVIA CONSOLE'S RED ERROR BAR SITS IN THE PAGE, NOT OVER IT (job "Trivia console: error bar at 375px", 9 Nov 2026).

At 375 px the red error bar was fixed over the page under the header and covered two labels until Dismiss. It now sits
in the page flow straight under the header and pushes the page down. This opens a REAL room on the browser rig (a
signed-in trivia host, tv.html on the venue's link, the real game Worker in jsc), puts question 1 up, makes the Reveal
call fail (the real hostError path), and at 375x667 and 390x844 checks:

  - the bar is up, in the page flow (not position:fixed), directly under the header
  - nothing is covered: the "Question 1 of 2" line, the question card and the main button are each the top element
    at their own centre (elementFromPoint), and each sits below the bar
  - the main button is still wholly on screen, with no scroll and no sideways scroll
  - Dismiss takes the bar down and the card goes back where it was
  - with a modal open (the paper or overage box) the bar is lifted above the scrim (fixed, z-index 90) so the host
    still reads it, as before

PNG screenshots of each state go to $VP_SHOTS when it is set.
Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/trivia-errbar-flow-in-chrome.test.py
"""
import base64, json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = os.path.join('/home/vp/venue-enrich/reports/errbar-shots', os.path.basename(ROOT))
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



BAR = r"""(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); if(!(b.width>0 && b.height>0)) return null; return {top:Math.round(b.top), bottom:Math.round(b.bottom), left:Math.round(b.left), right:Math.round(b.right)}; }
  function free(e){ if(!e) return false; var b=e.getBoundingClientRect(); var x=Math.round(b.left+Math.min(b.width/2, 40)), y=Math.round(b.top+b.height/2); var t=document.elementFromPoint(x,y); return !!t && (t===e || e.contains(t)); }
  var bar=document.getElementById("hostErrBar"), hd=document.querySelector("header"), body=document.getElementById("runBody");
  var meta=body && body.querySelector(".qmeta"), card=body && body.querySelector(".qwrap");
  var main=[].filter.call(body ? body.querySelectorAll(".btn.big") : [], function(b){ return !b.classList.contains("ghost") && b.getBoundingClientRect().height>0; })[0];
  return JSON.stringify({ h:innerHeight, w:innerWidth, sy:Math.round(scrollY||0), sw:document.documentElement.scrollWidth,
    up: !!bar && bar.classList.contains("show"), pos: bar ? getComputedStyle(bar).position : null, z: bar ? getComputedStyle(bar).zIndex : null,
    bar:R(bar), header:R(hd), meta:R(meta), card:R(card), main:R(main), mainText: main ? main.textContent.trim() : null,
    metaFree:free(meta), cardFree:free(card), mainFree:free(main), barFree: bar && bar.classList.contains("show") ? free(document.getElementById("hostErrText")) : null,
    text: ((document.getElementById("hostErrText")||{}).textContent||"") });
})()"""
FAILREVEAL = 'window.__realFetch=window.__realFetch||window.fetch; window.fetch=function(u,o){ return /host\\/reveal/.test(String(u)) ? Promise.reject(new TypeError("Failed to fetch")) : window.__realFetch.apply(window,arguments); }; true'


def play():
    print('\nTHE TRIVIA CONSOLE ERROR BAR AT PHONE WIDTH (a real room)')
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
        t2, host = r.open('/app/trivia/host.html?venue=' + V, width=375, height=667)
        r.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 25); time.sleep(2)
        r.ask(host, 'document.getElementById("cfgCount").value="%d"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true' % len(QS))
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(2)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(2)
        ok('the host opens the lobby', r.until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 15) is True, r.ask(host, ERRT))
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(1)
        for _ in range(3):
            if r.ask(host, '!!document.getElementById("vpAskGo") || !!document.querySelector(".vp-ask button")') is True:
                r.ask(host, '(function(){ var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); b.click(); return true; })()'); time.sleep(1)
        ok('the round starts', wait_btn(r, host, 'First question', 30) is True, r.ask(host, ERRT))
        click_btn(r, host, 'First question')
        ok('question 1 is up', wait_btn(r, host, 'Reveal answer', 30) is True, r.ask(host, ERRT))
        for (w, h) in SIZES:
            size(r, host, w, h)
            tag = '%dx%d' % (w, h)
            before = r.json(host, BAR)
            r.ask(host, FAILREVEAL)
            for _ in range(3):   # with auto reveal on, the first tap during the clock asks for a second
                click_btn(r, host, 'Reveal answer')
                if r.until(host, 'document.getElementById("hostErrBar").classList.contains("show")', 4) is True: break
            time.sleep(0.8)
            r.ask(host, 'window.scrollTo(0,0); true'); time.sleep(0.3)
            m = r.json(host, BAR)
            png(r, host, 'errbar-up-%s.png' % tag)
            ok(tag + ': the Reveal call fails and the red bar says so', m['up'] is True and len(m['text']) > 10, m)
            ok(tag + ': the bar is in the page flow, not fixed over the page', m['pos'] in ('relative', 'static'), m)
            ok(tag + ': straight under the header', bool(m['bar']) and bool(m['header']) and abs(m['bar']['top'] - m['header']['bottom']) <= 1, m)
            ok(tag + ': the "Question 1 of 2" line is below the bar and not covered', bool(m['meta']) and m['meta']['top'] >= m['bar']['bottom'] and m['metaFree'] is True, m)
            ok(tag + ': the question card is below the bar and not covered', bool(m['card']) and m['card']['top'] >= m['bar']['bottom'] and m['cardFree'] is True, m)
            ok(tag + ': the main button "%s" is not covered and wholly on screen, no scroll' % m.get('mainText'), bool(m['main']) and m['mainFree'] is True and m['main']['bottom'] <= m['h']
               and m['main']['top'] >= 0 and m['sy'] == 0 and m['sw'] <= m['w'], m)
            ok(tag + ': the bar\'s own words are readable (not under anything)', m['barFree'] is True, m)
            r.ask(host, 'document.getElementById("hostErrX").click(); true'); time.sleep(0.5)
            d = r.json(host, BAR)
            ok(tag + ': Dismiss takes it down and the card goes back where it was', d['up'] is False and bool(d['card']) and bool(before.get('card')) and d['card']['top'] == before['card']['top'], [before.get('card'), d.get('card')])
        # with a modal open, the bar is lifted above the scrim
        size(r, host, 375, 667)
        r.ask(host, 'document.getElementById("ovgModal").classList.remove("hidden"); true'); time.sleep(0.3)
        click_btn(r, host, 'Reveal answer') or r.ask(host, '(function(){ var b=[].filter.call(document.querySelectorAll("#runBody button"),function(x){ return x.textContent.trim()==="Reveal answer"; })[0]; if(b) b.click(); return !!b; })()')
        r.until(host, 'document.getElementById("hostErrBar").classList.contains("show")', 15); time.sleep(0.5)
        m = r.json(host, BAR)
        png(r, host, 'errbar-over-modal-375x667.png')
        ok('a modal open: the bar is lifted above it (fixed, z-index 90) and its words are not under the scrim', m['up'] is True and m['pos'] == 'fixed' and m['z'] == '90' and m['barFree'] is True, m)
        r.ask(host, 'document.getElementById("ovgModal").classList.add("hidden"); document.getElementById("hostErrX").click(); window.fetch=window.__realFetch; true')
        ok('no script errors on the console', r.ask(host, 'window.__errs.length') == 0, r.ask(host, 'JSON.stringify(window.__errs)'))
        r.close_tab(t2); r.close_tab(t1)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-errbar-flow-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    play()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
