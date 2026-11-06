#!/usr/bin/env python3
"""THE SETUP WIZARD'S ONE QUESTION, AND "REMIND ME NEXT TIME" (Dean, 5 Nov 2026; INBOX 87, 88a).

After the try-it demo a new venue lands on its console home, where the wizard opens with ONE question. Opens the REAL
console (/app/) on the browser rig (tools/browser-rig/rig.py), signed in as the owner of a venue made today, on a laptop
that has just played the demo (localStorage vpDemoPlayed-<venue> = "1", as /app/try.html leaves it), and checks:

  - the wizard opens on "What games do you want to set up today?" with five ticks in this order: Trivia, Musical
    bingo, Bingo, Raffles, Members draws (jag the joker is not offered: not live)
  - tick trivia and raffles: "Put it on your TV" comes next, as part of setting up trivia (the first game), and asks
    "Is this the same TV you played the demo on?"; Yes keeps the pairing with no code (vpTvPaired is this venue's)
  - "Who's hosting?" next, then trivia's own step, then raffles' step with "Not ready yet? Remind me next time I sign
    in"; tapping it takes raffles out of tonight's run
  - the NEXT sign-in (a new window: its own session) asks ONE question first: "Ready to set up raffles now?"
  - a venue that has only played the demo is not "a venue that has played": the wizard still opens
  - laid out at 375 and 1366: nothing wider than the screen

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/wizard-v2-in-chrome.test.py
"""
import datetime, json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


TITLE = '((document.getElementById("vpFrTitle")||{}).textContent||"").trim()'
WIDE = 'document.documentElement.scrollWidth - window.innerWidth'


def click(r, sid, i):
    return r.ask(sid, '(function(){ var b=document.getElementById(%s); if(!b) return false; b.click(); return true; })()' % json.dumps(i))


def play(RIG, width, height, label):
    print('\nTHE WIZARD AT %d x %d (%s)' % (width, height, label))
    r = RIG.Rig()
    try:
        v = r.db['vp_venues'][0]
        v['created_at'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')   # a venue made today
        v['terms_required'] = False; v['compliance_accepted_at'] = v['created_at']
        # it has played ONLY the try-it demo (migration 172): that is not a first game
        r.db['vp_sessions'] = [{'id': 'demo-1', 'venue_id': v['id'], 'is_demo': True, 'status': 'finished'}]
        before = 'try{ localStorage.setItem("vpDemoPlayed-%s","1"); localStorage.setItem("vpTvVenue",%s); }catch(e){}' % (v['id'], json.dumps(v['slug']))
        t1, c = r.open('/app/', width=width, height=height, before=before)
        ok('the wizard opens, after the demo, on "What games do you want to set up today?"',
           r.until(c, TITLE + '==="What games do you want to set up today?"', 30) is True, r.ask(c, TITLE))
        chips = r.json(c, 'JSON.stringify([].map.call(document.querySelectorAll("#vpFrChips-games button"),function(b){ return b.textContent.trim(); }))')
        ok('  five ticks, in order: trivia, musical bingo, bingo, raffles, members draws', chips == ['Trivia', 'Musical bingo', 'Bingo', 'Raffles', 'Members draws'], chips)
        ok('  laid out: nothing wider than the screen', (r.ask(c, WIDE) or 0) <= 0, r.ask(c, WIDE))
        if SHOTS: r.shot(c, os.path.join(SHOTS, 'wizard-pick-%d.jpg' % width))
        click(r, c, 'vpFrChip-games-trivia'); click(r, c, 'vpFrChip-games-raffles')
        click(r, c, 'vpFrNext')
        ok('trivia and raffles ticked: next is "Put it on your TV"', r.until(c, TITLE + '==="Put it on your TV"', 10) is True, r.ask(c, TITLE))
        ok('  as part of setting up trivia, the first game', 'setting up trivia, your first game' in (r.ask(c, 'document.getElementById("vpFrBody").innerText') or ''))
        ok('  it asks "Is this the same TV you played the demo on?"', r.ask(c, '!!document.getElementById("vpFrSameTv") && /Is this the same TV you played the demo on\\?/.test(document.getElementById("vpFrSameTv").innerText)') is True)
        click(r, c, 'vpFrSameYes')
        paired = r.ask(c, 'localStorage.getItem("vpTvPaired")') or ''
        ok('  Yes keeps the pairing: this browser\'s /tv opens the venue with no code', v['slug'] in paired and r.ask(c, 'getComputedStyle(document.getElementById("vpFrTvBox")).display') == 'none', paired)
        if SHOTS: r.shot(c, os.path.join(SHOTS, 'wizard-sametv-%d.jpg' % width))
        click(r, c, 'vpFrNext')
        ok('then "Who\'s hosting?"', r.until(c, TITLE + '==="Who\'s hosting?"', 10) is True, r.ask(c, TITLE))
        click(r, c, 'vpFrNext')
        ok('then trivia\'s own setup', r.until(c, TITLE + '==="Set up trivia"', 10) is True, r.ask(c, TITLE))
        ok('  with "Not ready yet? Remind me next time I sign in"', r.ask(c, '(document.getElementById("vpFrRemind")||{}).textContent') == 'Not ready yet? Remind me next time I sign in')
        click(r, c, 'vpFrNext')
        ok('then raffles\' setup (bingo, musical bingo and members draws were not ticked, so they get no step)', r.until(c, TITLE + '==="Set up raffles"', 10) is True, r.ask(c, TITLE))
        click(r, c, 'vpFrRemind')
        ok('"Remind me next time": raffles leaves tonight\'s run', r.until(c, TITLE + '!=="Set up raffles"', 10) is True, r.ask(c, TITLE))
        ok('  and is kept to ask about next time', 'raffles' in (r.ask(c, '(function(){ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k.indexOf("vpFirstRun:")===0) return localStorage.getItem(k); } return ""; })()') or ''))
        click(r, c, 'vpFrClose')
        r.close_tab(t1)
        t2, c2 = r.open('/app/', width=width, height=height)
        ok('the NEXT sign-in asks ONE question first: "Ready to set up raffles now?"',
           r.until(c2, '!!document.getElementById("vpAsk") && /Ready to set up raffles now\\?/.test(document.getElementById("vpAsk").innerText)', 30) is True,
           r.ask(c2, '(document.getElementById("vpAsk")||{}).innerText || ' + TITLE))
        if SHOTS: r.shot(c2, os.path.join(SHOTS, 'wizard-remind-%d.jpg' % width))
        ok('no script errors', r.ask(c2, 'window.__errs.length') == 0, r.ask(c2, 'JSON.stringify(window.__errs)'))
        r.close_tab(t2)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('wizard-v2-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import rig as RIG
    play(RIG, 1366, 768, 'a laptop')
    play(RIG, 375, 812, 'a phone')
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
