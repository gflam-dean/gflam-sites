#!/usr/bin/env python3
"""TWO LIVE GAME FAULTS FROM DEAN'S JOB LIST, PLAYED IN CHROME (3 Nov 2026).

This RUNS the real pages in headless Chrome (tools/browser-rig/rig.py: the real game Worker in jsc,
supabase-js swapped for the rig's stand-in, realtime carried between windows by BroadcastChannel).

Row 39. "Trivia: a phone left on a finished quiz answers the next session." A punter joins tonight's
quiz on the real trivia phone page and plays it. The night ends (session finished). Without reloading,
the phone hears the NEXT night's quiz on the same code from a console that does not say which night it
is (a host tablet still on a page from before 27 Oct, or a "started" the phone missed), and the punter
taps an answer. Before the fix the Worker refused the closed night's token and the phone said "Player is
not in this game" for the rest of the quiz, with nothing recorded. Now it must re-join tonight's session
(same device, one player row), send the same tap again, say "Answer in!", and the answer must be in the
database against tonight's player.

Row 40. "Musical bingo: double tap on End game queues a second End." On the real musical console: the
carry-on modal's End game tapped twice must send ONE End; the End game button, armed and then tapped
twice, must send ONE End and go dead; and the next game must still start and be endable.

    python3 tools/stale-phone-and-end-once-in-chrome.test.py      screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def table(r, name):
    with r.W.lock:
        r.W.p.stdin.write(json.dumps({'table': name}) + '\n'); r.W.p.stdin.flush()
        line = r.W.p.stdout.readline()
    try: return json.loads(line).get('body') or []
    except Exception: return []

S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
G1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
SET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

# A console window of the same origin, speaking on the phones' channel the way the trivia console's
# gsend does (the rig's realtime stand-in carries channel "vp-<code>" on BroadcastChannel "fake-rt:vp-<code>").
SAY = r'''(function(code, payload){
  var b=new BroadcastChannel("fake-rt:vp-"+code);
  b.postMessage({event:"msg", payload:payload});
  setTimeout(function(){ try{ b.close(); }catch(e){} }, 500);
  return true;
})'''
VIEW = '(function(){var v=["vNoRoom","vJoin","vWait","vQ","vRes","vFinal"];for(var i=0;i<v.length;i++){var e=document.getElementById(v[i]);if(e&&!e.classList.contains("hidden"))return v[i];}return "";})()'
STATUS = '(document.getElementById("pStatus")||{}).textContent||""'


def night(r, sid, gid, status_s, status_g, question=True):
    """Tonight's (or last night's) session, its trivia game and the question on the wall, in the Worker's database."""
    ends = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() + 3600 * 24 * 400))   # open: the rig's clock is its own
    r.W.seed('vp_sessions', [{'id': sid, 'venue_id': r.W.info['venue'], 'status': status_s, 'join_code': r.W.info['code'],
                              'lobby_format': 'trivia', 'created_at': '2026-09-19T09:00:00Z'}])
    r.W.seed('vp_games', [{'id': gid, 'session_id': sid, 'seq': 1, 'format': 'trivia', 'status': status_g, 'config': {'question_seqs': [1]}}])
    if question:
        r.W.seed('vp_trivia_games', [{'game_id': gid, 'question_set_id': SET, 'current_seq': 1, 'phase': 'asking', 'question_ends_at': ends}])


def finish(r, sid, gid):
    for t, key, val in (('vp_sessions', 'id', sid), ('vp_games', 'id', gid)):
        rows = table(r, t)
        for x in rows:
            if x.get(key) == val: x['status'] = 'finished'
        r.W.seed(t, rows, replace=True)


def stale_phone():
    print('\nRow 39: a phone left on a finished quiz answers the next night\'s quiz, and it COUNTS')
    r = RIG.Rig()
    try:
        code = r.W.info['code']
        r.W.seed('vp_questions', [{'id': 'q-1', 'set_id': SET, 'seq': 1, 'text': 'Which?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2}])
        night(r, S1, G1, 'running', 'running')
        ptid, ph = r.open('/app/trivia/play.html?room=' + code, width=390, height=844)
        ctid, con = r.open('/__blank')
        ok('CONTROL: the trivia phone is ready for a team name', r.phone_ready(ph) is True, r.ask(ph, VIEW))
        r.ask(ph, 'document.getElementById("nameIn").value="Quiz Kids"; document.getElementById("joinBtn").click(); true')
        ok('CONTROL: it joins tonight\'s quiz (waiting, or straight into the question already on the wall)', r.until(ph, '(function(v){return v==="vWait"||v==="vQ";})(' + VIEW + ')', 20) is True, [r.ask(ph, VIEW), r.ask(ph, '(document.getElementById("joinErr")||{}).textContent')])
        first = [p for p in table(r, 'vp_players') if p.get('session_id') == S1]
        ok('CONTROL: one player row in the first night', len(first) == 1, first)
        dev = first[0].get('device_id') if first else None
        ok('CONTROL: the phone holds the first night\'s session', r.ask(ph, 'localStorage.getItem("vp-tsess-' + code + '")') == S1, r.ask(ph, 'localStorage.getItem("vp-tsess-' + code + '")'))

        # The first quiz: a question, a tap, the podium. The night ends.
        t_end = int(time.time() * 1000) + 60000
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'question', 'fmt': 'trivia', 'game_id': G1, 'session_id': S1, 'qseq': 1, 'qi': 1, 'qtotal': 1,
                                                                    'text': 'Which?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'endsAt': t_end, 'secs': 60})))
        ok('CONTROL: the first night\'s question is on the phone', r.until(ph, VIEW + '==="vQ" && document.querySelectorAll("#pAnswers .pans").length===4', 15) is True, r.ask(ph, VIEW))
        r.ask(ph, 'document.querySelectorAll("#pAnswers .pans")[2].click(); true')
        ok('CONTROL: its answer goes in', r.until(ph, STATUS + '==="Answer in! Good luck."', 15) is True, r.ask(ph, STATUS))
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'podium', 'fmt': 'trivia', 'top': [{'name': 'Quiz Kids', 'points': 140}], 'rows': [{'name': 'Quiz Kids', 'points': 140}]})))
        ok('CONTROL: the phone sits on the final screen', r.until(ph, VIEW + '==="vFinal"', 15) is True, r.ask(ph, VIEW))
        finish(r, S1, G1)
        shot(r, ph, 'stale-phone-1-final')

        # The NEXT night on the same code, from a console that does not say which night it is.
        night(r, S2, G2, 'running', 'running')
        t_end = int(time.time() * 1000) + 60000
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'started', 'fmt': 'trivia', 'game_id': G2, 'question_count': 1, 'colour': True})))
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'question', 'fmt': 'trivia', 'game_id': G2, 'qseq': 1, 'qi': 1, 'qtotal': 1,
                                                                    'text': 'Which now?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'endsAt': t_end, 'secs': 60})))
        ok('CONTROL: the next night\'s question is on the phone that was left open', r.until(ph, VIEW + '==="vQ" && (document.getElementById("pqText")||{}).textContent==="Which now?"', 15) is True,
           [r.ask(ph, VIEW), r.ask(ph, '(document.getElementById("pqText")||{}).textContent')])
        r.ask(ph, 'document.querySelectorAll("#pAnswers .pans")[1].click(); true')
        said = r.until(ph, '(function(s){return s==="Answer in! Good luck." || /not in this game|lost its place/i.test(s) ? s : "";})(' + STATUS + ')', 20)
        shot(r, ph, 'stale-phone-2-answered')
        ok('a. the punter is told "Answer in!", not "Player is not in this game"', said == 'Answer in! Good luck.', [said, r.ask(ph, STATUS)])
        ans = [a for a in table(r, 'vp_trivia_answers') if a.get('game_id') == G2]
        tonight = [p for p in table(r, 'vp_players') if p.get('session_id') == S2]
        ok('b. the answer is in the database for tonight\'s game, against tonight\'s player, the option tapped',
           len(ans) == 1 and len(tonight) >= 1 and ans[0].get('player_id') == tonight[0].get('id') and ans[0].get('answer_index') == 1, [ans, tonight])
        ok('c. the returning punter is ONE player tonight: one row, same device, same team name',
           len(tonight) == 1 and tonight[0].get('device_id') == dev and tonight[0].get('display_name') == 'Quiz Kids', tonight)
        ok('d. the phone now holds tonight\'s session, not the closed one', r.ask(ph, 'localStorage.getItem("vp-tsess-' + code + '")') == S2,
           r.ask(ph, 'localStorage.getItem("vp-tsess-' + code + '")'))
        ok('no script errors on the phone', r.ask(ph, 'window.__errs.length') == 0, r.ask(ph, 'JSON.stringify(window.__errs)'))
        r.close_tab(ptid); r.close_tab(ctid)
    finally:
        r.close()


RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
SETUP = 'document.getElementById("liveBlock").classList.contains("hidden")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
ENDS = lambda r: [c for c in r.W.calls if c == '/host/game/end']


def start_game(r, h, label):
    r.ask(h, 'document.getElementById("prizeInput").value="Bar tab"; true')
    r.ask(h, 'document.getElementById("startBtn").click(); true')
    r.until(h, LOBBY, 15)
    r.ask(h, 'document.getElementById("startBtn").click(); true')
    ok('CONTROL: %s is running (lobby opened, then Start game)' % label, r.until(h, RUNNING, 25) is True,
       r.ask(h, '((document.getElementById("hostErrText")||{}).textContent||"")+" | "+JSON.stringify(window.__errs)'))


def end_once():
    print('\nRow 40: one End per musical bingo game, however many taps')
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        tid, h = r.open('/app/musical/host.html', width=1024, height=768)
        ok('CONTROL: the musical console loads, signed in', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(3)
        start_game(r, h, 'game 1')
        # The carry-on modal (what a win puts up), its End game tapped twice by one finger.
        r.ask(h, 'document.getElementById("carryModal").classList.remove("hidden"); true')
        n0 = len(ENDS(r))
        r.ask(h, 'var b=document.getElementById("carryEnd"); b.click(); setTimeout(function(){ b.click(); }, 80); true')
        time.sleep(2.5)
        ok('a. the carry-on modal\'s End game tapped twice sends ONE End to the Worker', len(ENDS(r)) - n0 == 1, len(ENDS(r)) - n0)
        ok('b. the console is back to setting up the next game', r.until(h, SETUP, 10) is True)
        ok('c. and the End game button is dead until the next game', r.ask(h, 'document.getElementById("endGameBtn").disabled') is True, r.ask(h, 'document.getElementById("endGameBtn").disabled'))
        shot(r, h, 'end-once-1-after-carry-end')

        start_game(r, h, 'game 2 (the next game still starts)')
        ok('d. the next game gets its End game button back', r.ask(h, 'document.getElementById("endGameBtn").disabled') is False, r.ask(h, 'document.getElementById("endGameBtn").disabled'))
        n1 = len(ENDS(r))
        r.ask(h, 'document.getElementById("endGameBtn").click(); true')                      # arms it
        ok('CONTROL: the first tap only arms End game', r.until(h, '/Tap again/.test(document.getElementById("endGameBtn").textContent)', 5) is True and len(ENDS(r)) == n1,
           r.ask(h, 'document.getElementById("endGameBtn").textContent'))
        time.sleep(1.2)
        r.ask(h, 'var b=document.getElementById("endGameBtn"); b.click(); setTimeout(function(){ b.click(); }, 80); true')   # the deciding tap, doubled
        time.sleep(2.5)
        ok('e. the deciding tap, doubled, sends ONE End to the Worker', len(ENDS(r)) - n1 == 1, len(ENDS(r)) - n1)
        ok('f. the console is back to setting up the next game, End game dead', r.until(h, SETUP, 10) is True and r.ask(h, 'document.getElementById("endGameBtn").disabled') is True)
        games = [g for g in table(r, 'vp_games') if g.get('format') == 'musical_bingo']
        ok('g. both games are finished in the Worker\'s database', len(games) == 2 and all(g.get('status') == 'finished' for g in games), [(g.get('id'), g.get('status')) for g in games])
        ev = [e for e in table(r, '__events') if e.get('type') == 'game.ended']
        ok('h. and the night\'s log holds one game.ended per game, not one per tap', len(ev) == 2 and len(set(e.get('payload', {}).get('game_id') for e in ev)) == 2, ev)

        start_game(r, h, 'game 3 (and the one after)')
        ok('no script errors on the musical console', r.ask(h, 'window.__errs.length') == 0, r.ask(h, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()


for scene in (stale_phone, end_once):
    try:
        scene()
    except Exception:
        import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
