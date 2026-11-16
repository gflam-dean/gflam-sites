#!/usr/bin/env python3
"""THE END OF A TRIVIA NIGHT, PLAYED IN CHROME (Dean, 5 Nov 2026, INBOX 50-53 and 77-79; job "Winner reveal in Game settings").

The logic is held by tools/test-trivia-endnight.js (jsc). This suite PLAYS it: the real trivia console, the venue's own
/tv (the trivia screen in its frame) and real phones, on the browser rig (tools/browser-rig/rig.py: the real game Worker in
jsc, a stand-in database, realtime between windows). What Dean asked for, each as a question about a screen:

  SCENE 1, the Game settings as a venue that never touched them has them (both ON, INBOX 78), three teams:
    - between questions the WHOLE leaderboard comes up on the TV ("Show the leaderboard after each round", default ON)
    - the LAST answer stays up: no leaderboard over it, and the console says "Final scores come up in 0:2x"
    - nobody taps: about 30 s after the last answer the TV covers the podium by itself ("And the winners are"), the
      console's Reveal leaderboard pulses and says "TV reveals by itself in 1:2x if you don't tap"
    - ONE tap and the TV runs it by itself: "In third place", "In second place", "And the winner is", then the winner
    - the phones are told their place only when the TV gets to the winner (no spoiler), then 1st/2nd/3rd
    - "Show the whole leaderboard now" (small, secondary) brings the whole leaderboard up, every team on it
  SCENE 2, both switched OFF in Game settings, two teams:
    - no leaderboard between questions
    - nobody taps: the last answer holds about 30 s, then the WHOLE leaderboard comes up by itself, no 3-2-1 suspense
  SCENE 3, HOST ONLY (no phones joined): the last answer, then Reveal leaderboard is calm (no podium of nobody, no
    "Scores could not be loaded"), and nothing throws.
Every scene: no page threw; the TV never shows the reveal steps out of order; the console fits a phone sideways.

VP_SHOTS=<dir>: each moment as the TV at 1280x720 AND 1920x1080, the console at 375x667 and 390x844, and the phones.

    python3 tools/trivia-finale-in-chrome.test.py
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
SET = '5e75e75e-0000-4000-8000-0000000000f1'
ran = bad = 0
R = None


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1


def PHONE_STORE(tag):   # several phones in one browser, each its own storage (as real-night-dryrun)
    return r'''(function(){ var P=%s, S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem, k=S.key, c=S.clear;
  function mine(st){ try{ return st===window.localStorage; }catch(e){ return false; } }
  S.getItem=function(x){ return mine(this) ? g.call(this, P+x) : g.call(this, x); };
  S.setItem=function(x,v){ return mine(this) ? s.call(this, P+x, v) : s.call(this, x, v); };
  S.removeItem=function(x){ return mine(this) ? r.call(this, P+x) : r.call(this, x); };
  S.clear=function(){ if(!mine(this)) return c.call(this); var ks=[]; for(var i=0;i<this.length;i++){ var q=k.call(this,i); if(q && q.indexOf(P)===0) ks.push(q); } ks.forEach(function(q){ r.call(window.localStorage,q); }); };
})();''' % json.dumps('phone-' + tag + ':')


def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def text(sid): return js(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,300)')
def tap(sid, el_id): js(sid, 'setTimeout(function(){ var b=document.getElementById(%s); if(b) b.click(); }, 0); true' % json.dumps(el_id))
def click_text(sid, t):
    return js(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(t))
def has_btn(t):
    return '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(t)
ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
def answer_dialogs(sid, rounds=3):
    for _ in range(rounds):
        time.sleep(0.8)
        if not (js(sid, TAKEOVER) or js(sid, ASKGO) or js(sid, ACCEPT)): break
JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null;})()'
FRAME = 'document.getElementById("gameFrame")'
def F_HAS(word):
    return '(function(f){ try{ return new RegExp(%s,"i").test(f.contentDocument.body.innerText.replace(/\\s+/g," ")); }catch(e){ return false; } })(%s)' % (json.dumps(word), FRAME)
F_TEXT = '(function(f){ try{ return f.contentDocument.body.innerText.replace(/\\s+/g," ").slice(0,300); }catch(e){ return "no frame"; } })(%s)' % FRAME
F_ERRS = '(function(f){ try{ return JSON.stringify((f.contentWindow.__errs)||[]); }catch(e){ return "[]"; } })(%s)' % FRAME
# the console page against its window: no sideways drift; the height is reported (the trivia console's own fit job is separate)
FITS = ('(function(){var d=document.documentElement,b=document.body; return JSON.stringify({sw:Math.max(d.scrollWidth,b.scrollWidth),cw:d.clientWidth,'
        'sh:Math.max(d.scrollHeight,b.scrollHeight),ch:d.clientHeight,x:window.scrollX|0});})()')
FIN_LINE = '((document.getElementById("finLine")||{}).textContent||"")'


def size(sid, w, h):
    R.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': w < 600}, session=sid)


def shot(sid, name):
    if SHOTS: time.sleep(0.4); R.shot(sid, os.path.join(SHOTS, name + '.jpg'))


def tv_shots(tv, name):
    """The TV at both sizes Dean asked for; the screen is laid out in container units, so it re-lays at once."""
    if not SHOTS: return
    for w, h in ((1280, 720), (1920, 1080)):
        size(tv, w, h); time.sleep(0.9); shot(tv, '%s-tv-%d' % (name, w))
    size(tv, 1280, 720)


def console_shots(host, name):
    """The console as a host holds it: 375x667 and 390x844, with what the page measures at each."""
    out = {}
    for w, h in ((375, 667), (390, 844)):
        size(host, w, h); time.sleep(0.7)
        f = json.loads(js(host, FITS) or '{}'); out[w] = f
        shot(host, '%s-console-%d' % (name, w))
    size(host, 390, 844)
    return out


def setup(prefs_trivia, n_questions=2):
    """A fresh rig with the venue's Game settings for trivia as given, a two-question set, and a TV on the venue's /tv."""
    global R
    R = rig.Rig(host_pages=('/app/trivia/host.html',))
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
    R.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': n_questions, 'visibility': 'public', 'owner_venue_id': W.info['venue'], 'status': 'active'}]
    W.seed('vp_question_sets', R.db['vp_question_sets'])
    W.seed('vp_questions', [
        {'id': 'q-1', 'set_id': SET, 'seq': 1, 'question': 'Which colour?', 'text': 'Which colour?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2},
        {'id': 'q-2', 'set_id': SET, 'seq': 2, 'question': 'Which animal?', 'text': 'Which animal?', 'options': ['Cat', 'Dog', 'Emu', 'Roo'], 'correct_index': 3}][:n_questions])
    W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': 'trivia', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    t = {'buzzer': False, 'count': n_questions, 'time_s': 20, 'speed_bonus': True}
    t.update(prefs_trivia)
    W.seed('vp_venue_settings', [{'venue_id': W.info['venue'], 'game_prefs': {'trivia': t}}], replace=True)
    _, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    ok('CONTROL: the TV loads', R.until(tv, 'document.readyState==="complete"', 40) is True)
    _, host = R.open('/app/trivia/host.html?venue=' + W.info['venue'], width=390, height=844)
    ok('CONTROL: the trivia console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True, text(host))
    time.sleep(2)
    js(host, 'document.getElementById("cfgCount").value="%d"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true' % n_questions)
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('CONTROL: the lobby is open', R.until(host, LOBBY, 20) is True, js(host, ERRT))
    ok('CONTROL: the TV takes the trivia lobby', R.until(tv, '/trivia/.test((%s||{}).getAttribute ? %s.getAttribute("src")||"" : "")' % (FRAME, FRAME), 40) is True)
    return W, tv, host


def join(names):
    code = R.W.info['code']
    phones = []
    for tag, name in names:
        _, ph = R.open('/play?room=' + code, before=PHONE_STORE(tag), width=390, height=844)
        ok('CONTROL: phone %s reaches the join form' % name, R.until(ph, JOIN_FORM + ' && !document.getElementById("joinBtn").disabled', 90) is True, text(ph))
        time.sleep(0.8)
        js(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
        R.until(ph, '!' + JOIN_FORM, 20)
        phones.append((name, ph))
    return phones


def seed_board(points):
    """The scores as the Worker's leaderboard view gives them (the answers themselves are trivia-score's business)."""
    gs = [g for g in table('vp_games') if g.get('format') == 'trivia']
    gid = gs[-1]['id'] if gs else None
    sid = gs[-1].get('session_id') if gs else None
    rows = [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': points.get(p.get('display_name'), 0)}
            for p in table('vp_players') if p.get('session_id') == sid]
    R.W.seed('v_vp_trivia_leaderboard', rows, replace=True)
    return rows


def ask_question(host, phones, n, total, points=None):
    if n == 1:
        tap(host, 'startBtn'); answer_dialogs(host)
        ok('CONTROL: the quiz starts', R.until(host, has_btn('First question'), 30) is True, js(host, ERRT))
        click_text(host, 'First question')
        if points is not None:   # the game row exists once the quiz has started; the scores are its
            time.sleep(1.5)
            rows = seed_board(points)
            ok('CONTROL: the scores are on tonight\'s game (%d teams)' % len(rows), len(rows) == len(phones) and all(r.get('game_id') for r in rows), rows)
    else:
        click_text(host, 'Next question')
    for name, ph in phones:
        ok('CONTROL: question %d reaches %s' % (n, name), R.until(ph, 'document.querySelectorAll("#pAnswers .pans").length===4', 30) is True, text(ph))
    time.sleep(1.2)
    for i, (name, ph) in enumerate(phones):
        js(ph, '[].slice.call(document.querySelectorAll("#pAnswers .pans"))[%d].click(); true' % (i % 4))
    time.sleep(1.2)
    click_text(host, 'Reveal answer')
    last = n == total
    ok('CONTROL: question %d is revealed' % n, R.until(host, has_btn('Reveal leaderboard') if last else has_btn('Next question'), 25) is True, [text(host), js(host, ERRT)])


def errs_clean(label, tv, host, phones):
    e = [js(host, 'JSON.stringify(window.__errs||[])'), js(tv, 'JSON.stringify(window.__errs||[])'), js(tv, F_ERRS)] + [js(p, 'JSON.stringify(window.__errs||[])') for _, p in phones]
    ok('%s: no page threw anything (console, TV, TV frame, phones)' % label, all(x in ('[]', None) for x in e), e)


def phone_final(ph):
    return js(ph, '(function(){var v=document.getElementById("vFinal"); return (v && !v.classList.contains("hidden")) ? v.innerText.replace(/\\s+/g," ") : "";})()') or ''


def scene_defaults():
    print('\nSCENE 1: Game settings untouched (suspense reveal ON, leaderboard after each round ON), three teams')
    W, tv, host = setup({})
    phones = join((('A', 'Quiz Wizards'), ('B', 'Slow Coaches'), ('C', 'Late Starters')))
    ask_question(host, phones, 1, 2, {'Quiz Wizards': 900, 'Slow Coaches': 600, 'Late Starters': 300})
    ok('between questions the WHOLE leaderboard comes up on the TV, all three teams (round board ON by default)',
       R.until(tv, F_HAS('Leaderboard') + ' && ' + F_HAS('Quiz Wizards') + ' && ' + F_HAS('Late Starters'), 15) is True, js(tv, F_TEXT))
    tv_shots(tv, 's1-01-round-board')
    ask_question(host, phones, 2, 2)
    t_last = time.time()
    line = R.until(host, '(function(t){ return /^Final scores come up in 0:[0-3][0-9]$/.test(t) ? t : ""; })(%s)' % FIN_LINE, 8)
    ok('the console says "Final scores come up in 0:2x" under Reveal leaderboard', bool(line) and line is not True and str(line).startswith('Final scores come up in 0:'), [line, text(host)])
    time.sleep(max(0, t_last + 9 - time.time()))
    ok('9 s after the last answer it is STILL the last answer on the TV: no leaderboard, no podium over it',
       js(tv, F_HAS('Leaderboard|In third place|And the winners are|Winners')) is False and js(tv, F_HAS('Question 2 of 2')) is True and js(tv, F_HAS('Correct answer')) is True, js(tv, F_TEXT))
    tv_shots(tv, 's1-02-last-answer-holds'); c = console_shots(host, 's1-02-last-answer')
    for w, f in c.items():
        ok('console at %d wide: no sideways drift (page %s, window %s)' % (w, f.get('sw'), f.get('cw')), f.get('sw', 0) <= f.get('cw', 0) and f.get('x', 0) == 0, f)
    # nobody taps: the suspense screen comes up by itself at 30 s
    cov = R.until(tv, F_HAS('And the winners are'), 32 - (time.time() - t_last) + 6)
    took = time.time() - t_last
    ok('nobody taps: the TV covers the podium by itself, "And the winners are", about 30 s after the last answer (took %.0f s)' % took,
       cov is True and 27 <= took <= 38, [took, js(tv, F_TEXT)])
    ok('and the phones are not told their place yet (no spoiler while the podium is covered)',
       all(not re.search(r'YOU WON|1st place|2nd place|3rd place', phone_final(p)) for _, p in phones), [phone_final(p) for _, p in phones])
    pl = R.until(host, '(function(t){ return /^TV reveals by itself in [01]:[0-5][0-9] if you don.t tap$/.test(t) ? t : ""; })(%s)' % FIN_LINE, 6)
    ok('the console says "TV reveals by itself in 1:2x if you don\'t tap"', bool(pl) and pl is not True, [pl, js(host, FIN_LINE)])
    ok('the console\'s Reveal leaderboard pulses while the TV waits for the tap',
       js(host, '(function(b){ return !!b && b.classList.contains("finpulse") && b.getBoundingClientRect().height>0; })(document.getElementById("finGo"))') is True, text(host))
    tv_shots(tv, 's1-03-cover'); console_shots(host, 's1-03-cover')
    # ONE tap: the TV runs the rest by itself
    tap(host, 'finGo')
    t_tap = time.time()
    seen = []
    for word, secs in (('In third place', 6), ('In second place', 10), ('And the winner is', 10), ('Winners', 10)):
        got = R.until(tv, F_HAS(word), secs)
        seen.append((word, round(time.time() - t_tap, 1), got is True))
        if got is True:
            tv_shots(tv, 's1-04-' + word.lower().replace(' ', '-'))
            if word == 'In second place':
                ok('while 2nd is up, the 1st place phone still has not been told it won',
                   not re.search(r'YOU WON|1st place', phone_final(phones[0][1])), phone_final(phones[0][1]))
                console_shots(host, 's1-04-second')
    ok('one tap and the TV runs the reveal by itself, in order: 3rd, 2nd, "And the winner is", the winner (%s)' % seen, all(s[2] for s in seen), seen)
    ok('no more host taps were needed: the console has no "Announce" or "Reveal 2nd" buttons',
       js(host, '[].some.call(document.querySelectorAll("button"),function(b){ return b.getBoundingClientRect().height>0 && /Announce|Reveal 2nd|Reveal the winner|drumroll/i.test(b.textContent); })') is False, text(host))
    ok('the winner screen names the winning team', js(tv, F_HAS('Quiz Wizards')) is True, js(tv, F_TEXT))
    for (name, ph), want in zip(phones, ('YOU WON', '2nd place', '3rd place')):
        got = R.until(ph, '(function(){var v=document.getElementById("vFinal"); return !!v && !v.classList.contains("hidden") && %s.test(v.innerText);})()' % ('/' + want + '/i'), 15)
        ok('at the winner, %s\'s phone says "%s"' % (name, want), got is True, phone_final(ph))
        shot(ph, 's1-05-phone-' + name.split()[0].lower())
    console_shots(host, 's1-05-winner')
    sk = js(host, '(function(b){ if(!b||!b.getBoundingClientRect().height) return ""; var a=getComputedStyle(b), p=getComputedStyle(document.getElementById("finGo")||b); return b.className+"|"+a.fontSize+"|"+(document.getElementById("finGo")? p.fontSize : "gone"); })(document.getElementById("finSkip"))')
    ok('"Show the whole leaderboard now" is there, small and quiet (secondary style)', bool(sk) and 'ghost' in str(sk), sk)
    tap(host, 'finSkip')
    ok('"Show the whole leaderboard now": every team is on the TV', R.until(tv, F_HAS('Quiz Wizards') + ' && ' + F_HAS('Slow Coaches') + ' && ' + F_HAS('Late Starters') + ' && !' + F_HAS('And the winner is'), 12) is True, js(tv, F_TEXT))
    tv_shots(tv, 's1-06-whole-board'); console_shots(host, 's1-06-whole-board')
    bl = js(host, FIN_LINE) or ''
    ok('and the console counts down to the slides ("Back to your slides in 1:5x"), 2 minutes', re.match(r'^Back to your slides in [12]:[0-5][0-9]$', bl) is not None, bl)
    errs_clean('scene 1', tv, host, phones)


def scene_off():
    print('\nSCENE 2: both switched OFF in Game settings, two teams, nobody taps at the end')
    W, tv, host = setup({'end_suspense': False, 'round_board': False})
    phones = join((('A', 'Quiz Wizards'), ('B', 'Slow Coaches')))
    ask_question(host, phones, 1, 2, {'Quiz Wizards': 800, 'Slow Coaches': 500})
    time.sleep(8)
    ok('round board OFF: no leaderboard on the TV between questions (8 s after the answer)', js(tv, F_HAS('Leaderboard')) is False, js(tv, F_TEXT))
    ask_question(host, phones, 2, 2)
    t_last = time.time()
    tv_shots(tv, 's2-01-last-answer'); console_shots(host, 's2-01-last-answer')
    time.sleep(10)
    ok('10 s after the last answer the TV is still on it', js(tv, F_HAS('Leaderboard|Winners|And the winners are')) is False, js(tv, F_TEXT))
    got = R.until(tv, F_HAS('Quiz Wizards') + ' && ' + F_HAS('Slow Coaches'), 32 - (time.time() - t_last) + 6)
    took = time.time() - t_last
    ok('suspense OFF, nobody taps: the WHOLE leaderboard comes up by itself about 30 s after the last answer (took %.0f s)' % took, got is True and 27 <= took <= 38, [took, js(tv, F_TEXT)])
    ok('and no 3-2-1 suspense was shown', js(tv, F_HAS('In third place|In second place|And the winner is|And the winners are')) is False, js(tv, F_TEXT))
    tv_shots(tv, 's2-02-whole-board'); console_shots(host, 's2-02-whole-board')
    for (name, ph), want in zip(phones, ('YOU WON', '2nd place')):
        got = R.until(ph, '(function(){var v=document.getElementById("vFinal"); return !!v && !v.classList.contains("hidden") && %s.test(v.innerText);})()' % ('/' + want + '/i'), 15)
        ok('%s\'s phone says "%s" once the board is up' % (name, want), got is True, phone_final(ph))
        shot(ph, 's2-03-phone-' + name.split()[0].lower())
    errs_clean('scene 2', tv, host, phones)


def scene_host_only():
    print('\nSCENE 3: HOST ONLY, nobody joined, settings untouched')
    W, tv, host = setup({})
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('CONTROL: the quiz starts with nobody in', R.until(host, has_btn('First question'), 30) is True, [text(host), js(host, ERRT)])
    click_text(host, 'First question'); time.sleep(2)
    R.until(host, '!!document.getElementById("revealBtn")', 15); js(host, 'document.getElementById("revealBtn").click(); true'); time.sleep(0.8); js(host, '(function(b){ if(b) b.click(); return true; })(document.getElementById("revealBtn"))')   # "Tap Reveal twice to show it sooner"
    ok('CONTROL: question 1 revealed', R.until(host, has_btn('Next question'), 25) is True, [text(host), js(host, ERRT)])
    time.sleep(7)
    ok('between questions with nobody in: no empty leaderboard on the TV', js(tv, F_HAS('Leaderboard')) is False, js(tv, F_TEXT))
    tv_shots(tv, 's3-01-between')
    click_text(host, 'Next question'); time.sleep(2)
    R.until(host, '!!document.getElementById("revealBtn")', 15); js(host, 'document.getElementById("revealBtn").click(); true'); time.sleep(0.8); js(host, '(function(b){ if(b) b.click(); return true; })(document.getElementById("revealBtn"))')
    ok('CONTROL: the last question revealed', R.until(host, has_btn('Reveal leaderboard'), 25) is True, [text(host), js(host, ERRT)])
    tv_shots(tv, 's3-02-last-answer'); console_shots(host, 's3-02-last-answer')
    click_text(host, 'Reveal leaderboard')
    time.sleep(6)
    e = js(host, ERRT) or ''
    ok('Reveal leaderboard with nobody in: no "Scores could not be loaded" error', 'could not be loaded' not in e and 'could not be loaded' not in (text(host) or ''), [e, text(host)])
    ok('and the TV puts up no podium of nobody', js(tv, F_HAS('In third place|In second place|And the winner is')) is False, js(tv, F_TEXT))
    tv_shots(tv, 's3-03-after-tap'); console_shots(host, 's3-03-after-tap')
    errs_clean('scene 3', tv, host, [])


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-finale-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    for scene in (scene_defaults, scene_off, scene_host_only):
        try:
            scene()
        except Exception as e:
            import traceback; traceback.print_exc()
            ok(scene.__name__ + ' ran to the end', False, repr(e))
        finally:
            if R: R.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
