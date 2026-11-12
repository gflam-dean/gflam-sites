#!/usr/bin/env python3
"""ONE PHONE IS ONE PLAYER ALL NIGHT, AND EVERY GAME'S END ASKS "HOW WAS THAT?" AND KEEPS THE ANSWER (INBOX 295.2c/e).

Dean's real night on The Mini Bar, 12 Nov 2026: two phones played trivia, then musical bingo. The musical console said
Players (4) "Claude Test, Dean, Claude Test, Dean", "2 over the 2 your plan includes. The extra will be charged", and
each phone was asked "Your details" again (282.1/282.4, fixed in the game Worker and the play pages, proven in jsc by
worker/one-phone-a-night.test.js and app/one-phone-one-name.test.js). No suite ever played the whole night in a
browser with the SAME two phones. This one does, on the browser rig (tools/browser-rig/rig.py: the REAL game Worker
in jsc with a fake database, the shipped consoles and phone pages, realtime carried between the windows):

  TWO PHONES, each with its own storage (its own device id, name and tokens, as two real phones have; see PHONE_STORE),
  stay open the whole night on the room's link, and play, back to back:
    TRIVIA         the console opens the lobby; each phone joins once (Ann, Bob); the console counts 2; one question,
                   both answer, the leaderboard, End game
    MUSICAL BINGO  the console opens its lobby: both phones follow the room, are NOT asked their details again, and the
                   console counts 2 players, not 4 (282.1); the game starts and each is dealt a card; End game
    BINGO          the same: both phones follow, no details asked, the console counts 2; tickets dealt, a ball; End game
  and in the Worker's database: every session holds exactly 2 players, and the night holds exactly 2 device ids.
  AFTER EVERY GAME, on each phone: "How was that?" is asked, a rating is tapped, and the Worker keeps that row
  (vp_game_feedback: the venue, the game's format, the rating), one per phone per game (295.2e).

VP_SHOTS=<dir> keeps screenshots. Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait).

    python3 tools/one-phone-a-night-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
SET = '5e75e75e-0000-4000-8000-000000000002'
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1

# TWO PHONES IN ONE BROWSER, EACH WITH ITS OWN STORAGE. The rig carries realtime between windows on BroadcastChannel,
# which only reaches windows of the same origin and the same browser profile, so the phones cannot be two browsers.
# Same origin means one localStorage, and the play pages keep the device id, the name and the tokens there: the two
# phones would be ONE phone. So each phone's window keeps its localStorage under its own prefix (set before any page
# script runs, on every page it moves to), which is what two real phones have: two storages, one room.
def PHONE_STORE(tag):
    return r'''(function(){ var P=%s, S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem, k=S.key, c=S.clear;
  function mine(st){ try{ return st===window.localStorage; }catch(e){ return false; } }
  S.getItem=function(x){ return mine(this) ? g.call(this, P+x) : g.call(this, x); };
  S.setItem=function(x,v){ return mine(this) ? s.call(this, P+x, v) : s.call(this, x, v); };
  S.removeItem=function(x){ return mine(this) ? r.call(this, P+x) : r.call(this, x); };
  S.clear=function(){ if(!mine(this)) return c.call(this); var ks=[]; for(var i=0;i<this.length;i++){ var q=k.call(this,i); if(q && q.indexOf(P)===0) ks.push(q); } ks.forEach(function(q){ r.call(window.localStorage,q); }); };
})();''' % json.dumps('phone-' + tag + ':')

R = None
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def shot(sid, name):
    if SHOTS: time.sleep(0.4); R.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def text(sid): return js(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,240)')
def tap(sid, el_id): js(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(el_id))
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
# The phone's join form is up (any game's page): the name box and Join showing.
JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null;})()'
ASKED = '!!document.querySelector(".vpfb button[data-rate]") && document.querySelector(".vpfb button[data-rate]").getBoundingClientRect().height>0'
RATE = '(function(){var b=[].filter.call(document.querySelectorAll(".vpfb button[data-rate]"),function(x){return x.getBoundingClientRect().height>0;})[0]; if(!b) return null; b.click(); return b.getAttribute("data-rate");})()'
DEVICE = '(function(){ try{ return localStorage.getItem("vpDeviceId")||""; }catch(e){ return ""; } })()'
PHONES = (('A', 'Ann'), ('B', 'Bob'))


def rated(fmt, phones, rows_before):
    """Each phone is asked "How was that?" at the end, taps a rating, and the Worker keeps one row per phone."""
    for tag, ph in phones:
        ok('%s: phone %s is asked "How was that?" at the end' % (fmt, tag), R.until(ph, ASKED, 25) is True, text(ph))
        shot(ph, '%s-end-phone-%s' % (fmt, tag))
        ok('%s: phone %s taps a rating' % (fmt, tag), js(ph, RATE) is not None, text(ph))
    want = rows_before + len(phones)
    t = time.time() + 15
    rows = []
    while time.time() < t:
        rows = table('vp_game_feedback')
        if len(rows) >= want: break
        time.sleep(0.5)
    new = rows[rows_before:]
    ok('%s: the Worker keeps one rating row per phone (%d), for this venue, this game, as a player' % (fmt, len(phones)),
       len(new) == len(phones) and all(x.get('venue_id') == R.W.info['venue'] and str(x.get('format') or '').startswith(fmt[:5]) and x.get('source') == 'player'
                                      and x.get('rating') in (1, 2, 3) for x in new), new)
    return len(rows)


def follows(fmt, path_re, phones):
    for tag, ph in phones:
        moved = R.until(ph, '%s.test(location.pathname)' % path_re, 45)
        ok('%s: phone %s follows the room to %s' % (fmt, tag, fmt), moved is True, js(ph, 'location.href'))
        time.sleep(2)
        ok('%s: phone %s is NOT asked its details again (282.4)' % (fmt, tag), js(ph, JOIN_FORM) is False or
           R.until(ph, '!' + JOIN_FORM, 8) is True, text(ph))


def players(session_fmt):
    ss = [s for s in table('vp_sessions')]
    return ss, table('vp_players')


def night():
    global R
    R = rig.Rig(host_pages=('/app/trivia/host.html', '/app/musical/host.html', '/app/index.html'))
    W = R.W
    code = W.info['code']
    # The rig's Worker clock starts on a fixed day; a quiz question's end time comes from it, and the phones count down
    # against their own clock, so on the fixed day every question is over before it is shown. Tonight is tonight.
    with W.lock:
        W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
    R.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': 1, 'visibility': 'public', 'owner_venue_id': W.info['venue'], 'status': 'active'}]
    W.seed('vp_question_sets', R.db['vp_question_sets'])
    W.seed('vp_questions', [{'id': 'q-1', 'set_id': SET, 'seq': 1, 'question': 'Which colour?', 'text': 'Which colour?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2}])
    W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': 'bingo', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    t_tv, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)

    print('\nTRIVIA: the lobby opens, both phones join once')
    t_h, host = R.open('/app/trivia/host.html?venue=' + W.info['venue'], width=1280, height=900)
    ok('trivia: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True, text(host))
    time.sleep(2)
    js(host, 'document.getElementById("cfgCount").value="1"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true')
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('trivia: the lobby is open', R.until(host, LOBBY, 20) is True, js(host, ERRT))
    phones = []
    for tag, name in PHONES:
        tid, ph = R.open('/play?room=' + code, before=PHONE_STORE(tag), width=390, height=844)
        phones.append((tag, ph))
        ok('trivia: phone %s reaches the join form' % tag, R.until(ph, JOIN_FORM + ' && !document.getElementById("joinBtn").disabled', 90) is True, [js(ph, 'location.pathname'), text(ph)])
        time.sleep(1)
        js(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
        R.until(ph, '!' + JOIN_FORM, 20)
    devs = [js(ph, DEVICE) for _, ph in phones]
    ok('CONTROL: the two phones have two different device ids (two storages)', all(devs) and devs[0] != devs[1], devs)
    ok('trivia: the console counts 2 players', R.until(host, 'document.getElementById("playerCount").textContent==="2"', 25) is True, js(host, 'document.getElementById("playerCount").textContent'))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('trivia: the quiz starts', R.until(host, has_btn('First question'), 30) is True, js(host, ERRT))
    click_text(host, 'First question')
    for i, (tag, ph) in enumerate(phones):
        ok('trivia: the question reaches phone %s' % tag, R.until(ph, 'document.querySelectorAll("#pAnswers .pans").length===4', 30) is True, text(ph))
    time.sleep(1.5)
    for i, (tag, ph) in enumerate(phones):
        js(ph, '[].filter.call(document.querySelectorAll("#pAnswers .pans"),function(b){ return %s.test(b.textContent); })[0].click(); true' % ('/Blue/' if i == 0 else '/Red/'))
        ok('trivia: phone %s answers' % tag, R.until(ph, '/Answer in/i.test(document.body.innerText)', 15) is True, text(ph))
    click_text(host, 'Reveal answer')
    ok('trivia: the answer is revealed', R.until(host, has_btn('Reveal leaderboard'), 25) is True, js(host, ERRT))
    # v_vp_trivia_leaderboard is a database VIEW (players and their points); the rig's fake database has tables only, so
    # the view is written here from the Worker's own rows, as the live database would compute it.
    tg = [g for g in table('vp_games') if g.get('format') == 'trivia']
    gid = tg[-1]['id'] if tg else None
    pts = {}
    for a in table('vp_trivia_answers'):
        if a.get('game_id') == gid: pts[a.get('player_id')] = pts.get(a.get('player_id'), 0) + (a.get('points_awarded') or 0)
    W.seed('v_vp_trivia_leaderboard', [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': pts.get(p.get('id'), 0)}
                                       for p in table('vp_players') if p.get('session_id') == (tg[-1].get('session_id') if tg else None)], replace=True)
    click_text(host, 'Reveal leaderboard')
    ok('trivia: the leaderboard goes up (Reveal leaderboard is done)', R.until(host, '!(' + has_btn('Reveal leaderboard') + ')', 20) is True, js(host, ERRT))
    for _ in range(4):   # the podium, announced place by place, whatever the console offers next
        time.sleep(2)
        if not (click_text(host, 'Announce 3rd') or click_text(host, 'Announce 2nd') or click_text(host, 'Announce the winner') or click_text(host, 'Announce 1st')): break
    ok('trivia: phone B (2nd) is on its final screen', R.until(phones[1][1], '!document.getElementById("vFinal").classList.contains("hidden")', 25) is True, text(phones[1][1]))
    time.sleep(2)
    js(host, 'setTimeout(function(){ document.getElementById("toAdsBtn").click(); }, 0); true'); answer_dialogs(host)
    fb = rated('trivia', phones, len(table('vp_game_feedback')))
    js(host, 'true'); R.close_tab(t_h)

    print('\nMUSICAL BINGO: the same two phones follow the room')
    t_h, host = R.open('/app/musical/host.html', width=1024, height=900)
    ok('musical: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!document.querySelector("#plGrid .plcard.on")', 40) is True, text(host))
    time.sleep(2)
    js(host, 'document.getElementById("prizeInput").value="Bar tab"; true')
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('musical: the lobby is open', R.until(host, LOBBY, 20) is True, js(host, ERRT))
    follows('musical', '/\\/app\\/musical\\/play/', phones)
    ok('musical: the console counts 2 players, not 4 (282.1: the same phones, not new ones)', R.until(host, 'document.getElementById("playerCount").textContent==="2"', 25) is True and
       (time.sleep(3) or js(host, 'document.getElementById("playerCount").textContent') == '2'), js(host, 'document.getElementById("playerCount").textContent'))
    ok('musical: and no "over the players your plan includes" warning', not R.until(host, '/over the|will be charged/i.test(document.body.innerText)', 3), text(host))
    tap(host, 'startBtn'); answer_dialogs(host)
    for tag, ph in phones:
        ok('musical: phone %s is dealt its card' % tag, R.until(ph, 'document.querySelectorAll("#cardGrid .cc").length===25', 30) is True, text(ph))
    shot(host, 'musical-console')
    tap(host, 'endGameBtn'); time.sleep(1.3); tap(host, 'endGameBtn'); answer_dialogs(host)
    fb = rated('musical', phones, fb)
    R.close_tab(t_h)

    print('\nBINGO: the same two phones follow the room again')
    t_h, host = R.open('/app/', width=1280, height=900)
    ok('bingo: the console loads on the games menu', R.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40) is True, text(host))
    js(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    R.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20)
    R.until(host, '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")', 15); time.sleep(2)
    js(host, ('var $=function(i){return document.getElementById(i)}; $("prizeInput").value="Meat tray"; $("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change"));'
              '$("cardsSel").value="1"; true'))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('bingo: the lobby is open', R.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 20) is True, [js(host, 'document.getElementById("startBtn").textContent'), js(host, ERRT)])
    follows('bingo', '/^\\/play/', phones)
    ok('bingo: the console counts 2 players, not 4 or 6', R.until(host, 'document.getElementById("playerCount").textContent==="2"', 25) is True and
       (time.sleep(3) or js(host, 'document.getElementById("playerCount").textContent') == '2'), js(host, 'document.getElementById("playerCount").textContent'))
    tap(host, 'startBtn'); answer_dialogs(host)
    for tag, ph in phones:
        ok('bingo: phone %s is dealt its ticket' % tag, R.until(ph, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of 1/.test(document.body.innerText)', 45) is True, text(ph))
    for _ in range(3):
        R.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 20)
        time.sleep(2); tap(host, 'nextBtn')
        if R.until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 8) is True: break
    ok('bingo: a ball is called', R.until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 15) is True, js(host, 'document.getElementById("liveCount").textContent'))
    tap(host, 'endGameBtn'); answer_dialogs(host)
    fb = rated('bingo', phones, fb)

    print('\nthe night in the Worker\'s database')
    ss, ps = table('vp_sessions'), table('vp_players')
    per = {}
    for p in ps:
        per.setdefault(p.get('session_id'), []).append(p)
    ok('three sessions tonight (trivia, musical bingo, bingo), each with exactly 2 players', len(per) == 3 and all(len(v) == 2 for v in per.values()),
       {k: [(p.get('display_name'), p.get('device_id')) for p in v] for k, v in per.items()})
    ok('the whole night holds exactly 2 device ids: one phone is one player all night', len(set(p.get('device_id') for p in ps)) == 2 and set(p.get('device_id') for p in ps) == set(devs),
       [p.get('device_id') for p in ps])
    ok('and each phone kept its name (Ann, Bob) in every game', all(sorted(p.get('display_name') for p in v) == ['Ann', 'Bob'] for v in per.values()),
       {k: [p.get('display_name') for p in v] for k, v in per.items()})
    errs = [js(s, 'JSON.stringify(window.__errs||[])') for _, s in phones] + [js(host, 'JSON.stringify(window.__errs||[])')]
    ok('no page threw anything (both phones, the last console)', all(e in ('[]', None) for e in errs), errs)


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('one-phone-a-night-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    try:
        night()
    except Exception as e:
        import traceback; traceback.print_exc()
        ok('the night ran to the end', False, repr(e))
    finally:
        if R: R.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
