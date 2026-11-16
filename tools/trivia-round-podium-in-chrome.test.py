#!/usr/bin/env python3
"""TRIVIA: THE PODIUM AND THE LEADERBOARD AT THE END OF EVERY ROUND, PLAYED ON A REAL ROOM (jobs "Trivia round podium"
and "Real-game podium test", Sun 22 Nov 2026).

Dean, 7 Nov 2026: "The leaderboard should show every round only" and "They should do a podium every round". A phone
night has a round every 10 questions. This opens a REAL room on the browser rig (tools/browser-rig/rig.py: the real game
Worker in jsc with a fake database, the shipped console, the venue's own /tv) with TWO TVs at once (1280x720 and
1920x1080) and plays a 12-question night twice, the way a person sees it:

  A. host only, NO phones (the first thing every new venue does; Dean, 15 Nov 2026), console at 375x667:
     - after an ordinary answer and at the end of round 1 the TV shows the join screen with "Next question coming up"
       (the line ON SCREEN: on Tuesday's release the ready join screen hid it),
       never a podium, an empty LEADERBOARD title or "Thanks for playing"
     - the end of the night is the calm "Thanks for playing", no podium
  B. TWO phones, console at 390x844:
     - after an ordinary answer (question 3) the answer stays up: no leaderboard 8 s later
     - at question 10 (the end of round 1, not the last): the podium, headed "Top three after round 1", then
       "Leaderboard after round 1" with both teams about 10 s later; the phones are never sent to their end-of-night
       screen; a TV that reloads on the round's board is handed that board again
     - Next question takes the board down for question 11; the last answer (12) leads to the night's podium,
       "Winners tonight"
  On every frame: the TV fits its screen, nothing threw, and the console's main button is on screen with no scroll.

Frames (PNG) go to $VP_SHOTS, or on the test server to /home/vp/venue-enrich/reports/round-podium-shots/<tree>.

    VP_SHOTS=/some/dir python3 tools/trivia-round-podium-in-chrome.test.py
"""
import base64, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
SHOTS = os.environ.get('VP_SHOTS', '')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = os.path.join('/home/vp/venue-enrich/reports/round-podium-shots', os.path.basename(ROOT))
if SHOTS:
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith('.png'): os.remove(os.path.join(SHOTS, f))
SET = '44444444-4444-4444-8444-444444444444'
N = 12
ran = bad = 0
R = None


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1


def PHONE_STORE(tag):   # two phones in one browser, each its own storage (as tools/real-night-dryrun-in-chrome.test.py)
    return r'''(function(){ var P=%s, S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem;
  function mine(st){ try{ return st===window.localStorage; }catch(e){ return false; } }
  S.getItem=function(x){ return mine(this) ? g.call(this, P+x) : g.call(this, x); };
  S.setItem=function(x,v){ return mine(this) ? s.call(this, P+x, v) : s.call(this, x, v); };
  S.removeItem=function(x){ return mine(this) ? r.call(this, P+x) : r.call(this, x); };
})();''' % json.dumps('phone-' + tag + ':')


def js(sid, expr, wait=8): return R.ask(sid, expr, wait)


def shot(sid, name):
    if not SHOTS: return
    time.sleep(0.4)
    try:
        d = R.B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        with open(os.path.join(SHOTS, name + '.png'), 'wb') as f: f.write(base64.b64decode(d['data']))
    except Exception as e:
        print('  (shot %s not taken: %s)' % (name, e))


def has_btn(t):
    return '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(t)


def click_text(sid, t):
    return js(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; setTimeout(function(){ b.click(); },0); return true; })()' % json.dumps(t))


ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
DIALOGS = ('(function(){var b=document.getElementById("vpTakeoverGo")||document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()')
JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null;})()'
# What the wall paints, read from the venue's /tv game frame.
TVJ = r'''(function(){ var f=document.getElementById("gameFrame"), d=f && f.contentDocument; if(!d) return JSON.stringify({none:1});
  function shown(e){ if(!e) return false; var s=d.defaultView.getComputedStyle(e), b=e.getBoundingClientRect(); return !e.classList.contains("hidden") && s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0; }
  var lay=[].filter.call(d.querySelectorAll(".layer"),function(l){ return shown(l); })[0], de=d.documentElement;
  return JSON.stringify({ layer: lay ? lay.id : null, board: ((d.getElementById("tvBoardTitle")||{}).textContent||"").trim(), pod: ((d.getElementById("tvPodTitle")||{}).textContent||"").trim(),
    rows: d.querySelectorAll("#tvBoardRows .brow").length, steps: d.querySelectorAll("#tvPodiumCols .pcol").length, sub: ((d.getElementById("lobbySub")||{}).textContent||"").trim(), subShown: shown(d.getElementById("lobbySub")),
    text: lay ? lay.innerText.replace(/\s+/g," ").slice(0,200) : "", scroll: de.scrollHeight>de.clientHeight+1 || de.scrollWidth>de.clientWidth+1,
    errs: (f.contentWindow.__errs||[]).length + (window.__errs||[]).length }); })()'''
# The console's main button: on screen, with no scroll.
MAINBTN = r'''(function(){ var body=document.getElementById("runBody");
  var b=[].filter.call(body ? body.querySelectorAll(".btn.big") : [], function(x){ return !x.classList.contains("ghost") && x.getBoundingClientRect().height>0; })[0];
  if(!b) return JSON.stringify({none:1}); var r=b.getBoundingClientRect();
  return JSON.stringify({ text:b.textContent.trim(), top:Math.round(r.top), bottom:Math.round(r.bottom), h:window.innerHeight, sy:Math.round(window.scrollY||0), sw:document.documentElement.scrollWidth, w:window.innerWidth }); })()'''


def tv(sid): return R.json(sid, TVJ, {})


# What the console sends (every BroadcastChannel post, by type), to say WHY a TV frame is missing when one is.
SPY = r'''(function(){ window.__sent=[]; var P=BroadcastChannel.prototype.postMessage;
  BroadcastChannel.prototype.postMessage=function(m){ try{ var p=m && (m.payload||m), t=p && (p.t || (p.payload && p.payload.t)); if(t) window.__sent.push(String(t)+(p.round?":"+p.round:"")+(p.title?":"+p.title:"")); }catch(e){} return P.apply(this, arguments); };
})();'''
SENT = '(window.__sent||[]).slice(-14).join(",")'


def tv_until(sid, cond_js, secs):
    """cond_js is JS over w (the TVJ object)."""
    return R.until(sid, '(function(){ var w=JSON.parse(%s); return %s; })()' % (TVJ, cond_js), secs) is True


def console_fits(host, tag):
    m = R.json(host, MAINBTN, {})
    ok('%s: the console\'s main button "%s" is on screen with no scroll (%sx%s)' % (tag, m.get('text'), m.get('w'), m.get('h')),
       not m.get('none') and m.get('bottom', 9999) <= m.get('h', 0) and m.get('top', -1) >= 0 and m.get('sy') == 0 and m.get('sw', 9999) <= m.get('w', 0), m)


def tvs_fit(tvs, tag):
    for name, sid in tvs:
        w = tv(sid)
        ok('%s: the %s TV fits its screen and nothing threw' % (tag, name), w.get('scroll') is False and w.get('errs') == 0, w)


def frames(tvs, host, tag):
    for name, sid in tvs: shot(sid, '%s-tv-%s' % (tag, name))
    shot(host, '%s-console' % tag)


def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']


def seed_board():
    """v_vp_trivia_leaderboard is a database VIEW (players and their points); the rig's fake database has tables only, so
    it is written here from the Worker's own rows before each reveal, as the live database would compute it (as
    tools/one-phone-a-night-in-chrome.test.py and real-night-dryrun do)."""
    tg = [g for g in table('vp_games') if g.get('format') == 'trivia']
    if not tg: return
    gid, sess = tg[-1]['id'], tg[-1].get('session_id')
    pts = {}
    for a in table('vp_trivia_answers'):
        if a.get('game_id') == gid: pts[a.get('player_id')] = pts.get(a.get('player_id'), 0) + (a.get('points_awarded') or 0)
    rows = [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': pts.get(p.get('id'), 0)}
            for p in table('vp_players') if p.get('session_id') == sess]
    rows.sort(key=lambda r: -r['points'])
    R.W.seed('v_vp_trivia_leaderboard', rows, replace=True)


def ask_question(host, tvs, phones, qn):
    """Next/First question, phones answer, the host reveals; back when the console offers the next step."""
    ok('Q%d: the console offers the question' % qn, R.until(host, has_btn('First question') + '||' + has_btn('Next question'), 30) is True, js(host, ERRT))
    click_text(host, 'First question') or click_text(host, 'Next question')
    ok('Q%d: the question is up on the console' % qn, R.until(host, has_btn('Reveal answer'), 40) is True, js(host, ERRT))
    tv_until(tvs[0][1], 'w.layer==="tvQ"', 20)
    for i, (tag, ph) in enumerate(phones):
        R.until(ph, 'document.querySelectorAll("#pAnswers .pans").length===4 && /Question %d of/.test(document.body.innerText)' % qn, 20)
    if phones: time.sleep(1.5)   # the phone takes taps once the question has settled (as tools/real-night-dryrun-in-chrome.test.py)
    for i, (tag, ph) in enumerate(phones):
        js(ph, '(function(){ var b=document.querySelectorAll("#pAnswers .pans")[%d]; if(b) b.click(); return !!b; })()' % i)
        ok('Q%d: phone %s answers' % (qn, tag), R.until(ph, '!!document.querySelector("#pAnswers .pans.picked")', 6) is True, (js(ph, 'document.body.innerText.replace(/\\s+/g," ")') or '')[:200])
    time.sleep(0.8)
    if phones: seed_board()
    done = has_btn('Next question') + '||' + has_btn('Reveal leaderboard')
    for _ in range(3):   # with auto reveal on, a tap while the clock runs asks for a second tap
        if R.until(host, done, 1) is True: break
        click_text(host, 'Reveal answer')
        if R.until(host, done, 4) is True: break
    ok('Q%d: the answer is revealed' % qn, R.until(host, done, 30) is True, js(host, ERRT))
    ok('Q%d: the TV shows the answer' % qn, tv_until(tvs[0][1], 'w.layer==="tvReveal"', 15), tv(tvs[0][1]))


def night(with_phones, host_w, host_h, tag):
    global R
    import rig
    print('\n%s: a %d-question night, %s, console at %dx%d' % (tag, N, 'two phones' if with_phones else 'host only, no phones', host_w, host_h))
    R = rig.Rig(host_pages=('/app/trivia/host.html',))
    try:
        W = R.W
        with W.lock:   # the Worker's clock on real time, so a question's deadline is in the phones' future (as real-night-dryrun)
            W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
        R.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': N, 'visibility': 'public', 'owner_venue_id': W.info['venue'], 'status': 'active'}]
        W.seed('vp_question_sets', R.db['vp_question_sets'])
        W.seed('vp_questions', [{'id': 'q-%d' % i, 'set_id': SET, 'seq': i, 'question': 'Question %d: which colour?' % i, 'text': 'Question %d: which colour?' % i,
                                 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 0} for i in range(1, N + 1)])
        tvs = []
        for name, (w, h) in (('1280', (1280, 720)), ('1920', (1920, 1080))):
            _, sid = R.open('/tv?venue=' + W.info['slug'], width=w, height=h)
            R.until(sid, '!!document.getElementById("adsRoot")', 20)
            tvs.append((name, sid))
        _, host = R.open('/app/trivia/host.html?venue=' + W.info['venue'], width=host_w, height=host_h, before=SPY)
        ok('the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True, js(host, ERRT))
        time.sleep(2)
        js(host, 'document.getElementById("cfgCount").value="%d"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true' % N)
        js(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        for _ in range(3):
            time.sleep(1)
            if not js(host, DIALOGS): break
        ok('the lobby is open', R.until(host, LOBBY, 20) is True, js(host, ERRT))
        tv_until(tvs[0][1], 'w.layer==="tvLobby"', 30)
        phones = []
        if with_phones:
            for ptag, name in (('A', 'Quiz Kids'), ('B', 'Brainiacs')):
                _, ph = R.open('/play?room=' + W.info['code'], before=PHONE_STORE(ptag), width=390, height=844)
                ok('phone %s reaches the join form' % ptag, R.until(ph, JOIN_FORM + ' && !document.getElementById("joinBtn").disabled', 90) is True, js(ph, 'location.pathname'))
                time.sleep(1)
                js(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
                R.until(ph, '!' + JOIN_FORM, 20)
                phones.append((ptag, ph))
            ok('the console counts 2 players', R.until(host, 'document.getElementById("playerCount").textContent==="2"', 25) is True, js(host, 'document.getElementById("playerCount").textContent'))
        frames(tvs, host, '%s-01-lobby' % tag)
        js(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        for _ in range(3):
            time.sleep(1)
            if not js(host, DIALOGS): break
        for qn in range(1, N + 1):
            ask_question(host, tvs, phones, qn)
            if qn == 1:
                frames(tvs, host, '%s-02-q1-answer' % tag)
            if qn == 3:
                time.sleep(8)   # past the 5.2 s follow-up
                w = tv(tvs[0][1])
                if with_phones:
                    ok('Q3 (mid-round), 8 s after the answer: the answer is still up, no leaderboard (Dean, 7 Nov 2026)', w.get('layer') == 'tvReveal', w)
                else:
                    ok('Q3, nobody joined: the join screen, "Next question coming up", never "Thanks for playing"', w.get('layer') == 'tvLobby' and 'Next question coming up' in w.get('sub', '') and w.get('subShown') is True
                       and 'thanks for playing' not in w.get('text', '').lower(), w)
                tvs_fit(tvs, 'Q3')
                frames(tvs, host, '%s-03-q3-after-8s' % tag)
                console_fits(host, 'Q3')
            if qn == 10:
                if with_phones:
                    ok('Q10, the end of round 1: the podium, "Top three after round 1"', tv_until(tvs[0][1], 'w.layer==="tvPodium" && /Top three after round 1/.test(w.pod)', 15), [tv(tvs[0][1]), js(host, SENT)])
                    ok('  on the 1920 TV too', tv_until(tvs[1][1], 'w.layer==="tvPodium" && /Top three after round 1/.test(w.pod)', 5), tv(tvs[1][1]))
                    ok('  both teams on the steps', tv(tvs[0][1]).get('steps') == 2, tv(tvs[0][1]))
                    time.sleep(2.5)
                    tvs_fit(tvs, 'round 1 podium')
                    frames(tvs, host, '%s-04-round1-podium' % tag)
                    console_fits(host, 'round 1 podium')
                    for ptag, ph in phones:
                        t = js(ph, 'document.body.innerText.replace(/\\s+/g," ")') or ''
                        ok('  phone %s is NOT on its end-of-night screen ("place!", "How was that?")' % ptag, 'place!' not in t and 'How was that' not in t, t[:200])
                    shot(phones[0][1], '%s-04-round1-phone-A' % tag)
                    ok('then "Leaderboard after round 1", both teams', tv_until(tvs[0][1], 'w.layer==="tvBoard" && w.board==="Leaderboard after round 1" && w.rows===2', 16), tv(tvs[0][1]))
                    time.sleep(1)
                    tvs_fit(tvs, 'round 1 board')
                    frames(tvs, host, '%s-05-round1-board' % tag)
                    console_fits(host, 'round 1 board')
                    js(tvs[0][1], 'location.reload(); true')
                    ok('a TV that reloads on the round\'s board is handed the board again', tv_until(tvs[0][1], 'w.layer==="tvBoard" && w.board==="Leaderboard after round 1"', 40), tv(tvs[0][1]))
                else:
                    time.sleep(7)
                    w = tv(tvs[0][1])
                    ok('Q10, the end of round 1, nobody joined: the join screen, never an empty podium or board', w.get('layer') == 'tvLobby' and 'Next question coming up' in w.get('sub', '') and w.get('subShown') is True, w)
                    time.sleep(10)
                    w = tv(tvs[0][1])
                    ok('  and still the join screen 10 s later (no board follows)', w.get('layer') == 'tvLobby', w)
                    tvs_fit(tvs, 'round 1, nobody')
                    frames(tvs, host, '%s-04-round1-nobody' % tag)
                    console_fits(host, 'round 1, nobody')
            if qn == 11:
                ok('Q11: Next question took the board down: the TV is on question 11\'s answer', tv(tvs[0][1]).get('layer') == 'tvReveal', tv(tvs[0][1]))
        # the last answer: the end of the night
        frames(tvs, host, '%s-06-last-answer' % tag)
        console_fits(host, 'the last answer')
        click_text(host, 'Reveal leaderboard')
        if with_phones:
            ok('the night\'s podium says "Winners tonight"', tv_until(tvs[0][1], 'w.layer==="tvPodium"', 90) and tv_until(tvs[0][1], '/Winners tonight|winner/i.test(w.pod)', 60), [tv(tvs[0][1]), js(host, SENT)])
            time.sleep(1)
            frames(tvs, host, '%s-07-night-podium' % tag)
        else:
            ok('the end with nobody joined: "Thanks for playing", no podium', tv_until(tvs[0][1], 'w.layer==="tvBoard" && /Thanks for playing/.test(w.board)', 20), tv(tvs[0][1]))
            frames(tvs, host, '%s-07-night-end' % tag)
        tvs_fit(tvs, 'the end')
        e = [js(s, 'JSON.stringify(window.__errs||[])') for s in [host] + [p for _, p in phones]]
        ok('nothing threw on the console or the phones', all(x in ('[]', None) for x in e), e)
    finally:
        R.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-round-podium-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    night(False, 375, 667, 'A-nophones')
    night(True, 390, 844, 'B-twophones')
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
