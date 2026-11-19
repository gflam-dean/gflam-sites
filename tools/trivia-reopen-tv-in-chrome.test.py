#!/usr/bin/env python3
"""OPENING THE TRIVIA CONSOLE DOES NOT PUT SCAN TO PLAY ON THE TV (INBOX 426 item 3, 16 Nov 2026).

Found on the real-night run of 16 Nov (reports/tue17-real-night, frame trivia3 01-setup): after one trivia round, opening the trivia
console again put TRIVIA, SCAN TO PLAY and the join code on the TV while the console still said Open lobby. A console tells the TV its
saved sound and buzzer switches the moment it opens; /tv counted those as a game on air and took the wall, and the trivia screen
shows its lobby until told otherwise. The first night nothing was saved yet, so nothing was sent, which is why it only showed the
second time. Real pages on the browser rig: a real /tv on the ads, the real trivia console.

  1. the TV is on the ads; the console opens for the FIRST time: the TV stays on the ads
  2. the host turns Game sounds On (it saves, and tells the TV): the TV stays on the ads
  3. the console is closed and OPENED AGAIN (it now has the venue's saved Game sounds to tell the TV): the TV stays on the ads, and
     the console still says Open lobby
  4. CONTROL: the host taps Open lobby: the TV takes the trivia screen (its lobby, SCAN TO PLAY)
  at the TV sizes 1920x1080 and 1280x720; VP_SHOTS=<dir> keeps a picture of each step.

    python3 tools/trivia-reopen-tv-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = '/home/vp/venue-enrich/reports/trivia-reopen-shots'
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
SET = '5e75e75e-0000-4000-8000-000000000003'
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    sys.stdout.flush()
    if not cond: bad += 1


ON_AIR = '(function(){var f=document.getElementById("gameFrame"); return (f && f.getAttribute("src")) || "";})()'
READY = 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled'
STARTTXT = '(document.getElementById("startBtn")||{}).textContent||""'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')


def seed(R, W):
    with W.lock:
        W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
    R.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': 2, 'visibility': 'public', 'owner_venue_id': W.info['venue'], 'status': 'active'}]
    W.seed('vp_question_sets', R.db['vp_question_sets'])
    W.seed('vp_questions', [
        {'id': 'q-1', 'set_id': SET, 'seq': 1, 'question': 'Which colour?', 'text': 'Which colour?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2},
        {'id': 'q-2', 'set_id': SET, 'seq': 2, 'question': 'Which animal?', 'text': 'Which animal?', 'options': ['Cat', 'Dog', 'Emu', 'Roo'], 'correct_index': 3}])
    for fmt in ('bingo', 'trivia', 'musical', 'members', 'raffle'):
        W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': fmt, 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)


def play(tvw, tvh, tag):
    print('\nTV %dx%d' % (tvw, tvh))
    R = rig.Rig(host_pages=('/app/trivia/host.html',))
    R.srv.handle_error = lambda request, client_address: None
    def shot(sid, name):
        if SHOTS: time.sleep(0.6); R.shot(sid, os.path.join(SHOTS, '%s-%s.jpg' % (tag, name)))
    def console(width=390, height=844):
        t, h = R.open('/app/trivia/host.html?venue=' + R.W.info['venue'], width=width, height=height)
        R.until(h, READY, 40); time.sleep(2.5)
        R.ask(h, 'var c=document.getElementById("cfgCount"); c.value="2"; c.dispatchEvent(new Event("input")); c.dispatchEvent(new Event("change")); true')
        return t, h
    try:
        W = R.W
        seed(R, W)
        t_tv, tv = R.open('/tv?venue=' + W.info['slug'], width=tvw, height=tvh)
        R.until(tv, 'document.readyState==="complete"', 30); time.sleep(4)
        ok('the TV starts on the ads (no game on air)', R.ask(tv, ON_AIR) == '', R.ask(tv, ON_AIR))
        shot(tv, '1-tv-ads')
        t_h, host = console()
        ok('1. the console opens (it says Open lobby)', 'lobby' in (R.ask(host, STARTTXT) or '').lower(), R.ask(host, STARTTXT))
        time.sleep(4)
        ok('1. first open: the TV stays on the ads', R.ask(tv, ON_AIR) == '', R.ask(tv, ON_AIR))
        shot(tv, '2-tv-first-open'); shot(host, '2-console-first-open')
        R.ask(host, 'document.querySelector(\'#cfgSounds [data-v="on"]\').click(); true')
        time.sleep(4)
        ok('2. Game sounds turned On (saved and told to the TV): the TV stays on the ads', R.ask(tv, ON_AIR) == '', R.ask(tv, ON_AIR))
        R.close_tab(t_h); time.sleep(1)
        t_h, host = console()
        ok('3. opened AGAIN: the console shows Game sounds On (the venue\'s saved switch)', R.ask(host, 'document.querySelector("#cfgSounds .on")&&document.querySelector("#cfgSounds .on").textContent')=='On', R.ask(host, 'document.querySelector("#cfgSounds .on")&&document.querySelector("#cfgSounds .on").textContent'))
        time.sleep(5)
        ok('3. opened again: the TV is still on the ads, not on trivia', R.ask(tv, ON_AIR) == '', R.ask(tv, ON_AIR))
        ok('3. and the console still says Open lobby', 'open lobby' in (R.ask(host, STARTTXT) or '').lower(), R.ask(host, STARTTXT))
        shot(tv, '3-tv-reopened'); shot(host, '3-console-reopened')
        R.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        for _ in range(4):
            time.sleep(0.8)
            if not R.ask(host, ACCEPT): break
        ok('4. CONTROL: Open lobby puts the trivia screen on the TV', R.until(tv, '/trivia/.test((document.getElementById("gameFrame")||{getAttribute:function(){return ""}}).getAttribute("src")||"")', 40) is True, R.ask(tv, ON_AIR))
        time.sleep(4)
        shot(tv, '4-tv-lobby'); shot(host, '4-console-lobby')
        ok('no script errors on the console', (R.ask(host, 'window.__errs.length') or 0) == 0, R.ask(host, 'JSON.stringify(window.__errs)'))
    finally:
        R.close()


if __name__ == '__main__':
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-reopen-tv-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    play(1920, 1080, 'tv1080')
    play(1280, 720, 'tv720')
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
