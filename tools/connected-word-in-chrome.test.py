#!/usr/bin/env python3
"""NO "CONNECTED" WORD ON A PLAYER'S PHONE (Dean, 6 Nov 2026: "why do we have the connected word again? I thought we got
rid of that").

The real phones have shown the connection as a dot alone since 1 Nov 2026 (/app/vp-connbar.js: the words stay for
screen readers, a slim "Reconnecting" bar shows only when the phone has lost the game). Dean saw "Connected" again on
6 Nov in a What's on mock-up whose stand-in page did not load vp-connbar.js, so this guards the real thing: it opens the
REAL trivia, musical bingo and bingo phone pages in headless Chrome (tools/browser-rig/rig.py) at 390x664 and, the way
each page does, writes "Connected" beside a green dot (the word must not be seen), then "Reconnecting" (the bar must
show).

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/connected-word-in-chrome.test.py
"""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    if not cond: bad += 1

PROBE_ON = ('JSON.stringify((function(){var d=document.getElementById("statusDot"),t=document.getElementById("statusText"),l=d.parentNode;'
            'l.classList.remove("nostatus"); d.classList.add("on"); t.textContent="Connected";'
            'return {dot:Math.round(d.getBoundingClientRect().width),w:Math.round(t.getBoundingClientRect().width),said:t.textContent};})())')
PROBE_BAR = ('JSON.stringify((function(){var b=document.getElementById("vpConnBar"); return {bar:!!b && !b.hidden && b.getBoundingClientRect().height>10, t:b?b.textContent:""};})())')

def main():
    end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    while True:
        st, pid, text = gatelib.lock_state()
        if st in ('free', 'mine') and gatelib.hold_lock_or_refuse('connected-word-in-chrome', wait_s=0):
            break
        if time.time() > end:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return 2
        time.sleep(0.5)
    import rig as RIG
    r = RIG.Rig()
    try:
        for page in ('/app/trivia/play.html', '/app/musical/play.html', '/play.html'):
            tid, sid = r.open(page, width=390, height=664)
            r.until(sid, '!!document.getElementById("statusText") && !!document.getElementById("statusDot")', 20)
            time.sleep(1.0)
            m = r.json(sid, PROBE_ON, {})
            ok('%s: connected shows nothing: no dot, and the word "Connected" is not seen (Dean, 7 Nov 2026)' % page,
               m.get('dot', 9) < 1 and m.get('w', 9) <= 1 and m.get('said') == 'Connected', m)
            r.ask(sid, '(function(){var d=document.getElementById("statusDot"); d.classList.remove("on"); document.getElementById("statusText").textContent="Reconnecting"; return true;})()')
            time.sleep(0.4)   # vp-connbar.js follows the words through a MutationObserver
            b = r.json(sid, PROBE_BAR, {})
            ok('%s: "Reconnecting" still shows, as the bar under the header' % page, b.get('bar') is True and 'Reconnecting' in (b.get('t') or ''), b)
            ok('%s: no script errors' % page, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
