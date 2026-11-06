#!/usr/bin/env python3
"""THE CONSOLES USE THE SETUP WIZARD'S ANSWERS, IN A REAL BROWSER (Dean, 6 Nov 2026, INBOX 104 follow-up, Tue 10 Nov).

The real consoles on the browser rig (tools/browser-rig/rig.py: the real game Worker in jsc behind a pipe), with the
venue's game_prefs seeded the way the setup wizard saves them, read back through the real /host/game-prefs:

  1. BINGO: the usual prizes are tap-and-go buttons under the prize box; a tap puts that prize in the box
  2. MUSICAL BINGO: three prize rounds, round 1 for no prize: the prize box says "No prize this round", the line under
     it says "Round 1 of 3 tonight: played for fun, no prize.", and the usual prizes are buttons under it
  3. TRIVIA: their categories in a "Your categories" group at the top, this week's one picked; their theme nights
     link to the question builder on that topic; "Tonight's prize" with the usual prizes as buttons
  4. No script errors on any console

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
"""
import os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
S1, S2 = '33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333332'


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('setup-use-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    import rig as RIG
    r = RIG.Rig(host_pages=('/app/trivia/host.html', '/app/musical/host.html'))
    try:
        V = r.W.info['venue']
        prefs = {
            'bingo': {'prize_list': ['Meat tray', '$50 bar tab'], 'cards': 6},
            'musical': {'rounds': 3, 'prize_same': False, 'prizes': ['', '$20 bar tab', 'Meat tray'], 'prize_none': [1], 'prize': '$20 bar tab', 'prize_weekly': True},
            'trivia': {'set_mode': 'pick', 'set_ids': [S1, S2], 'theme_nights': ['Home and Away night'], 'prize_list': ['Jug of beer', '$30 voucher']},
        }
        r.W.seed('vp_venue_settings', [{'venue_id': V, 'game_prefs': prefs}], replace=True)
        r.db['vp_question_sets'] = [
            {'id': S1, 'title': 'Sport', 'question_count': 40, 'visibility': 'library', 'owner_venue_id': None, 'status': 'active'},
            {'id': S2, 'title': 'Music', 'question_count': 40, 'visibility': 'library', 'owner_venue_id': None, 'status': 'active'},
            {'id': '33333333-3333-4333-8333-333333333333', 'title': 'General Knowledge', 'question_count': 60, 'visibility': 'library', 'owner_venue_id': None, 'status': 'active'}]

        print('\n1. BINGO: the usual prizes as buttons')
        tid, sid = r.open('/app/?venue=' + V, width=1024, height=768)
        r.until(sid, '!!document.querySelector(\'#gamePicker .pk[data-game="bingo"]\')', 30)
        r.ask(sid, 'document.querySelector(\'#gamePicker .pk[data-game="bingo"]\').click(); true')
        got = r.until(sid, '(function(){var b=document.getElementById("bingoPrizeBtns");return b?[].map.call(b.children,function(x){return x.textContent}).join("|"):null})()', 20)
        ok('under the prize box: Meat tray, $50 bar tab', got == 'Meat tray|$50 bar tab', got)
        r.ask(sid, 'document.querySelector("#bingoPrizeBtns [data-prize=\\"$50 bar tab\\"]").click(); true')
        ok('a tap puts it in the box', r.ask(sid, 'document.getElementById("prizeInput").value') == '$50 bar tab', r.ask(sid, 'document.getElementById("prizeInput").value'))
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'bingo-prize-buttons.jpg'))
        ok('bingo: no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

        print('\n2. MUSICAL BINGO: the night\'s prize rounds')
        tid, sid = r.open('/app/musical/host.html?venue=' + V, width=1024, height=768)
        rn = r.until(sid, '(function(){var n=document.getElementById("roundNote");return n&&n.textContent?n.textContent:null})()', 40)
        ok('"Round 1 of 3 tonight: played for fun, no prize."', rn == 'Round 1 of 3 tonight: played for fun, no prize.', rn)
        ok('the prize box says "No prize this round"', r.ask(sid, 'document.getElementById("prizeInput").value') == 'No prize this round', r.ask(sid, 'document.getElementById("prizeInput").value'))
        mb = r.ask(sid, '(function(){var b=document.getElementById("musicalPrizeBtns");return b?[].map.call(b.children,function(x){return x.textContent}).join("|"):null})()')
        ok('the usual prizes as buttons, each once', mb == '$20 bar tab|Meat tray', mb)
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'musical-round-prize.jpg'))
        # one prize won tonight on this device: the page opened again is on round 2
        r.ask(sid, 'localStorage.setItem("vpRound:%s:musical:"+VPSetupUse.nightOf(), "1"); location.reload(); true' % V)
        time.sleep(1.5)
        rn2 = r.until(sid, '(function(){var n=document.getElementById("roundNote");return n&&/Round 2/.test(n.textContent)?n.textContent:null})()', 40)
        ok('one prize won: round 2 is the $20 bar tab', rn2 == 'Round 2 of 3 tonight.' and r.ask(sid, 'document.getElementById("prizeInput").value') == '$20 bar tab',
           [rn2, r.ask(sid, 'document.getElementById("prizeInput").value')])
        ok('musical bingo: no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

        print('\n3. TRIVIA: their categories, theme nights, prizes')
        tid, sid = r.open('/app/trivia/host.html?venue=' + V, width=1024, height=768)
        grp = r.until(sid, '(function(){var g=document.getElementById("yourCats");return g?[].map.call(g.children,function(o){return o.textContent}).join("|"):null})()', 30)
        ok('"Your categories" at the top: Sport, Music', grp is not None and grp.startswith('Sport') and 'Music' in grp, grp)
        val = r.ask(sid, 'document.getElementById("setSel").value')
        ok('this week\'s one of them is picked', val in (S1, S2), val)
        ok('"One of your categories, a different one each week."', r.ask(sid, 'getComputedStyle(document.getElementById("setWeekNote")).display') != 'none')
        link = r.ask(sid, '(function(){var a=document.querySelector("#themeNights a");return a?a.getAttribute("href")+" | "+a.textContent:null})()')
        ok('theme night links to the builder on that topic', link == '/app/trivia/builder.html?topic=Home%20and%20Away%20night | Home and Away night', link)
        tb = r.ask(sid, '(function(){var b=document.getElementById("triviaPrizeBtns");return b?[].map.call(b.children,function(x){return x.textContent}).join("|"):null})()')
        ok('"Tonight\'s prize" with the usual prizes as buttons', tb == 'Jug of beer|$30 voucher' and r.ask(sid, 'getComputedStyle(document.getElementById("triviaPrizeField")).display') != 'none', tb)
        r.ask(sid, 'document.querySelector("#triviaPrizeBtns button").click(); true')
        ok('a tap puts it in the box', r.ask(sid, 'document.getElementById("triviaPrize").value') == 'Jug of beer')
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'trivia-setup-use.jpg'))
        ok('trivia: no script errors', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
