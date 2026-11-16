#!/usr/bin/env python3
"""THE WINNER CHECK PIN, PLAYED IN CHROME, ONE GAME AT A TIME (Dean, 4 Nov 2026; built 5 Nov 2026).

A 4-digit PIN per round. The WINNER'S PHONE says "Show this to the host: PIN 4821, card 332" (trivia: team
name and place), the HOST CONSOLE says "Round PIN 4821", and they are the same four digits. NEVER on a TV:
not on its screen, not in any message it hears.

This RUNS the real pages in headless Chrome (tools/browser-rig/rig.py: the real game Worker in jsc, supabase-js
swapped for the rig's stand-in, realtime carried between windows by BroadcastChannel). The rig Worker signs
the PIN with its own secret (worker-stdio.js), so the expected PIN is worked out here, in Python, from the round
id: the pages are checked against an answer they could not have made up.

Each prize has its own PIN (Dean, 5 Nov 2026), so the expected PIN is for the prize being played: one line
here for bingo and musical, "final" for trivia. Trivia: 1st place only gets it.
For each game, trivia, musical bingo and number bingo:
  - the real console plays (or picks up) the round and shows "Round PIN nnnn", the expected four digits;
  - a real phone joins, the Worker's record makes it the winner, the host's winner message reaches it, and it
    shows the same PIN with its card number (trivia: team name and place), nothing under 15px;
  - the TV, on the same code all the while, hears the game (CONTROL) and never has the PIN: not in its page,
    not in any message it was sent;
  - a phone that did NOT win is told nothing: no PIN on it.
Raffles and members draws have no phone winner screen, so there is nothing to show there.

    python3 tools/winner-pin-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import hashlib, hmac, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
SECRET = b'rig-winner-pin-secret'   # tools/browser-rig/worker-stdio.js
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


def pin_for(kind, round_id, stage):
    d = hmac.new(SECRET, ('vp-winner-pin|%s|%s|%s' % (kind, round_id, stage)).encode(), hashlib.sha256).digest()
    return str(int.from_bytes(d[:4], 'big') % 10000).zfill(4)


# Everything a screen hears on the rig's realtime (BroadcastChannel), kept on the page, frames included.
HEAR = r'''(function(){ window.__heard=[]; var BC=window.BroadcastChannel; if(!BC) return;
  var Wrapped=function(n){ var b=new BC(n); b.addEventListener("message",function(e){ try{ (window.top.__heard||window.__heard).push(JSON.stringify(e.data)); }catch(x){} }); return b; };
  Wrapped.prototype=BC.prototype; window.BroadcastChannel=Wrapped; })();'''
# A console window of the same origin, speaking on the venue channel the way the consoles do.
SAY = r'''(function(code, payload){
  var b=new BroadcastChannel("fake-rt:vp-"+code);
  b.postMessage({event:"msg", payload:payload});
  setTimeout(function(){ try{ b.close(); }catch(e){} }, 500);
  return true;
})'''
# The whole TV, every frame: its markup and its words.
TV_ALL = r'''(function(){ var out=[]; function walk(w){ try{ out.push(w.document.documentElement.outerHTML); out.push(w.document.body ? w.document.body.innerText : "");
  for(var i=0;i<w.frames.length;i++) walk(w.frames[i]); }catch(e){} } walk(window); return out.join("\n"); })()'''
HEARD = 'JSON.stringify(window.__heard||[])'
PINTEXT = lambda el: '((document.getElementById("%s")||{}).textContent||"")' % el
PINSIZE = lambda el: ('(function(e){ if(!e||e.classList.contains("hidden")) return 0; var a=[e].concat([].slice.call(e.querySelectorAll("*")));'
                      'return Math.min.apply(null, a.map(function(x){ return parseFloat(getComputedStyle(x).fontSize)||0; })); })(document.getElementById("%s"))' % el)


def tv_clean(r, tv, pin, label):
    """The TV has the game (CONTROL) and never the PIN, in its page or in anything it heard."""
    page = r.ask(tv, TV_ALL) or ''
    heard = r.ask(tv, HEARD) or '[]'
    ok(label + ': CONTROL the TV heard this game on the channel', len(json.loads(heard)) > 0, heard[:200])
    ok(label + ': the TV page never has the PIN (' + pin + '), "Round PIN" or a winner PIN mark',
       pin not in page and 'Round PIN' not in page and 'data-winpin' not in page and 'PIN ' + pin not in page,
       [page[max(0, page.find(pin) - 80):page.find(pin) + 40]] if pin in page else page[:120])
    ok(label + ': no message the TV heard carries the PIN or a pin field', pin not in heard and '"pin"' not in heard.lower(), heard[:300])


def trivia():
    print('\nTRIVIA: the console, a 1st place phone, a 2nd place phone and the TV')
    S, G, SET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    pin = pin_for('game', G, 'final')
    r = RIG.Rig(host_pages=('/app/trivia/host.html',))
    try:
        code, slug = r.W.info['code'], r.W.info['slug']
        ends = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() + 3600 * 24 * 400))
        r.W.seed('vp_questions', [{'id': 'q-1', 'set_id': SET, 'seq': 1, 'text': 'Which?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2}])
        r.W.seed('vp_sessions', [{'id': S, 'venue_id': r.W.info['venue'], 'status': 'running', 'join_code': code, 'lobby_format': 'trivia', 'created_at': '2026-09-19T09:00:00Z'}])
        r.W.seed('vp_games', [{'id': G, 'session_id': S, 'seq': 1, 'format': 'trivia', 'status': 'running', 'config': {'question_seqs': [1]}}])
        r.W.seed('vp_trivia_games', [{'game_id': G, 'question_set_id': SET, 'current_seq': 1, 'phase': 'asking', 'question_ends_at': ends}])
        ttid, tv = r.open('/tv?venue=' + slug, before=HEAR)
        wtid, win = r.open('/app/trivia/play.html?room=' + code, width=390, height=844)
        ltid, lose = r.open('/app/trivia/play.html?room=' + code, width=390, height=844)
        ctid, con = r.open('/__blank')
        for sid, nm in ((win, 'Quiz Wizards'), (lose, 'Slow Coaches')):
            ok('CONTROL: the phone for ' + nm + ' is ready', r.phone_ready(sid) is True)
            r.ask(sid, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(nm))
        time.sleep(3)
        players = {p.get('display_name'): p.get('id') for p in table(r, 'vp_players') if p.get('session_id') == S}
        ok('CONTROL: both teams are players in tonight\'s quiz', 'Quiz Wizards' in players and 'Slow Coaches' in players, players)
        # The last question is revealed and the board stands: the winner 1st, the other 2nd (Dean, 5 Nov 2026: 1st only).
        r.W.seed('vp_trivia_games', [{'game_id': G, 'question_set_id': SET, 'current_seq': 1, 'phase': 'revealed', 'question_ends_at': ends}], replace=True)
        r.W.seed('v_vp_trivia_leaderboard', [{'game_id': G, 'player_id': players.get('Quiz Wizards'), 'points': 900},
                                             {'game_id': G, 'player_id': players.get('Slow Coaches'), 'points': 800},
                                             {'game_id': G, 'player_id': 'other-2', 'points': 700}], replace=True)
        htid, host = r.open('/app/trivia/host.html')
        got = r.until(host, '(function(t){ return /^Round PIN [0-9]{4}$/.test(t) ? t : ""; })(' + PINTEXT('roundPin') + ')', 40)
        ok('the trivia console shows "Round PIN ' + pin + '"', got == 'Round PIN ' + pin, [got, r.ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)')])
        ok('the console PIN is at least 15px', (r.ask(host, PINSIZE('roundPin')) or 0) >= 15, r.ask(host, PINSIZE('roundPin')))
        rows = [{'name': 'Quiz Wizards', 'points': 900}, {'name': 'Slow Coaches', 'points': 800}]
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'podium', 'fmt': 'trivia', 'top': rows[:1], 'rows': rows})))
        want = 'Show this to the host: PIN ' + pin + ', Quiz Wizards, 1st'
        got = r.until(win, '(function(t){ return /PIN [0-9]{4}/.test(t) ? t : ""; })(' + PINTEXT('finalPin') + ')', 25)
        shot(r, win, 'winner-pin-trivia-phone')
        ok('the 1st place phone says "' + want + '"', got == want, [got, r.ask(win, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)')])
        ok('the phone PIN line is at least 15px, nothing smaller', (r.ask(win, PINSIZE('finalPin')) or 0) >= 15, r.ask(win, PINSIZE('finalPin')))
        r.until(lose, '!document.getElementById("vFinal").classList.contains("hidden")', 15)
        time.sleep(4)   # past the phone's one retry
        ok('the 2nd place phone is on the final screen with NO PIN (1st only)', r.ask(lose, '!document.getElementById("vFinal").classList.contains("hidden") && ' + PINTEXT('finalPin') + '===""') is True,
           r.ask(lose, PINTEXT('finalPin')))
        tv_clean(r, tv, pin, 'trivia')
        for sid, who in ((win, 'winner phone'), (lose, 'other phone'), (host, 'console')):
            ok('no script errors on the trivia ' + who, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    finally:
        r.close()


RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
ONETAB_SETTLED = '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")'


def musical():
    print('\nMUSICAL BINGO: the console runs a game, a winning phone, another phone and the TV')
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        code, slug = r.W.info['code'], r.W.info['slug']
        ttid, tv = r.open('/tv?venue=' + slug, before=HEAR)
        ctid, con = r.open('/__blank')
        htid, host = r.open('/app/musical/host.html')
        ok('CONTROL: the musical console loads', r.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 30) is True)
        r.until(host, ONETAB_SETTLED, 10)
        r.ask(host, 'document.getElementById("prizeInput").value="Bar tab"; setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        r.until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 15)
        wtid, win = r.open('/app/musical/play.html?room=' + code, width=390, height=844)
        ltid, lose = r.open('/app/musical/play.html?room=' + code, width=390, height=844)
        for sid, nm in ((win, 'Ann'), (lose, 'Bo')):
            ok('CONTROL: the musical phone for ' + nm + ' is ready', r.phone_ready(sid) is True)
            r.ask(sid, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(nm))
        time.sleep(3)
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        ok('CONTROL: the game is running on the console', r.until(host, RUNNING, 20) is True, r.ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        games = [g for g in table(r, 'vp_games') if g.get('format') == 'musical_bingo' and g.get('status') == 'running']
        ok('CONTROL: one musical game running in the Worker', len(games) == 1, games)
        G = games[0]['id'] if games else 'none'
        pin = pin_for('game', G, 'one')   # the console's first prize: one line
        got = r.until(host, '(function(t){ return /^Round PIN [0-9]{4}$/.test(t) ? t : ""; })(' + PINTEXT('roundPin') + ')', 20)
        ok('the musical console shows "Round PIN ' + pin + '"', got == 'Round PIN ' + pin, got)
        ok('the console PIN is at least 15px', (r.ask(host, PINSIZE('roundPin')) or 0) >= 15, r.ask(host, PINSIZE('roundPin')))
        ok('CONTROL: both phones are dealt a card', r.until(win, '!document.getElementById("vCard").classList.contains("hidden")', 30) is True
           and r.until(lose, '!document.getElementById("vCard").classList.contains("hidden")', 30) is True, r.ask(win, 'document.body.innerText.slice(0,200)'))
        players = {p.get('display_name'): p for p in table(r, 'vp_players') if p.get('display_name') in ('Ann', 'Bo')}
        cards = {c.get('player_id'): c for c in table(r, 'vp_cards') if c.get('game_id') == G}
        ann = players.get('Ann', {})
        card_no = (cards.get(ann.get('id')) or {}).get('card_no')
        ok('CONTROL: the winner has a card number from the Worker', bool(card_no), cards)
        # The Worker checked Ann's claim as valid (her card against the songs played), and the host confirmed it.
        r.W.seed('vp_claims', [{'id': 'claim-ann', 'game_id': G, 'player_id': ann.get('id'), 'card_id': (cards.get(ann.get('id')) or {}).get('id'),
                                'auto_verdict': 'valid', 'status': 'confirmed', 'claimed_at': '2026-11-08T09:00:00Z',
                                'winning_cells': [10, 11, 12, 13, 14]}])   # one line, as checkMusicPattern records it
        pid = r.ask(win, 'localStorage.getItem("vp-pid-%s")' % code) or ''
        ok('CONTROL: the winning phone has its channel id', bool(pid), pid)
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'winner', 'pid': pid, 'name': 'Ann', 'cardNo': str(card_no), 'pids': [pid], 'names': ['Ann'], 'cardNos': [card_no], 'split': False})))
        want = 'Show this to the host: PIN %s, card %s' % (pin, card_no)
        got = r.until(win, '(function(t){ return /PIN [0-9]{4}/.test(t) ? t : ""; })(' + PINTEXT('wonPin') + ')', 25)
        shot(r, win, 'winner-pin-musical-phone')
        ok('the winning musical phone says "' + want + '"', got == want, [got, r.ask(win, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)')])
        ok('the phone PIN line is at least 15px, nothing smaller', (r.ask(win, PINSIZE('wonPin')) or 0) >= 15, r.ask(win, PINSIZE('wonPin')))
        ok('the musical phone never says "bingo" on the win screen', 'bingo' not in (r.ask(win, 'document.getElementById("vWon").innerText') or 'bingo').lower(),
           r.ask(win, 'document.getElementById("vWon").innerText'))
        time.sleep(4)
        ok('the other phone has NO PIN anywhere', 'PIN' not in (r.ask(lose, 'document.body.innerText') or '') and pin not in (r.ask(lose, 'document.body.innerText') or ''),
           r.ask(lose, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        tv_clean(r, tv, pin, 'musical')
        for sid, who in ((win, 'winner phone'), (host, 'console')):
            ok('no script errors on the musical ' + who, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    finally:
        r.close()


def bingo():
    print('\nNUMBER BINGO: the console opens a game and calls a ball, a winning phone, another phone and the TV')
    r = RIG.Rig()
    try:
        code, slug = r.W.info['code'], r.W.info['slug']
        ttid, tv = r.open('/tv?venue=' + slug, before=HEAR)
        ctid, con = r.open('/__blank')
        wtid, win = r.open('/play?room=' + code, width=390, height=844)
        ltid, lose = r.open('/play?room=' + code, width=390, height=844)
        for sid, nm in ((win, 'Ann'), (lose, 'Bo')):
            ok('CONTROL: the bingo phone for ' + nm + ' is ready', r.phone_ready(sid) is True)
            r.ask(sid, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(nm))
            r.until(sid, '/YOU.RE IN/i.test(document.body.innerText)', 15)
        htid, host = r.open('/app/')
        ok('CONTROL: the console loads on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 30) is True)
        r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 15)
        r.until(host, ONETAB_SETTLED, 10)
        r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                     '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";true'))
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 20)
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        ok('CONTROL: the winning phone is dealt its ticket', r.until(win, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of 1/.test(document.body.innerText)', 45) is True,
           r.ask(win, 'document.body.innerText.slice(0,200)'))
        r.ask(host, 'setTimeout(function(){ document.getElementById("nextBtn").click(); }, 0); true')
        r.until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 15)
        draws = table(r, 'vp_bingo_draws')
        ok('CONTROL: the console opened a draw in the Worker, for tonight\'s session', len(draws) >= 1 and bool(draws[-1].get('session_id')), draws)
        D = draws[-1]['id'] if draws else 'none'
        pin = pin_for('bingo', D, 'one')   # the first prize: one line
        got = r.until(host, '(function(t){ return /^Round PIN [0-9]{4}$/.test(t) ? t : ""; })(' + PINTEXT('roundPin') + ')', 20)
        ok('the bingo console shows "Round PIN ' + pin + '"', got == 'Round PIN ' + pin, got)
        ok('the console PIN is at least 15px', (r.ask(host, PINSIZE('roundPin')) or 0) >= 15, r.ask(host, PINSIZE('roundPin')))
        ann = [p for p in table(r, 'vp_players') if p.get('display_name') == 'Ann']
        dev = ann[0].get('device_id') if ann else None
        tk = [t for t in table(r, 'vp_bingo_tickets') if t.get('draw_id') == D and t.get('device_id') == dev and t.get('card_no')]
        card_no = tk[0]['card_no'] if tk else None
        ok('CONTROL: the winner\'s ticket has a number from the server', bool(card_no and dev), [dev, tk])
        # The host confirmed Ann's BINGO on this draw (the server's record), then announced it.
        r.W.seed('vp_bingo_claims', [{'id': 'claim-ann', 'draw_id': D, 'ref': 'rig-ref-ann', 'pid': 'ann', 'device_id': dev, 'card_no': card_no,
                                      'pattern': 'one', 'balls': 1, 'verdict': 'win', 'status': 'confirmed'}])
        pid = r.ask(win, 'localStorage.getItem("vp-pid-%s")' % code) or ''
        ok('CONTROL: the winning phone has its channel id', bool(pid), pid)
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'winner', 'pid': pid, 'name': 'Ann', 'cardNo': card_no, 'pattern': 'one', 'prize': 'Meat tray',
                                                                          'winners': [{'pid': pid, 'name': 'Ann', 'cardNo': card_no}], 'shared': False, 'cont': False})))
        want = 'Show this to the host: PIN %s, card %s' % (pin, card_no)
        got = r.until(win, '(function(t){ return /PIN [0-9]{4}/.test(t) ? t : ""; })(' + PINTEXT('wonPin') + ')', 25)
        shot(r, win, 'winner-pin-bingo-phone')
        ok('the winning bingo phone says "' + want + '"', got == want, [got, r.ask(win, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)')])
        ok('the phone PIN line is at least 15px, nothing smaller', (r.ask(win, PINSIZE('wonPin')) or 0) >= 15, r.ask(win, PINSIZE('wonPin')))
        ok('it still sends the winner to the host, never the bar', 'bar' not in (r.ask(win, 'document.getElementById("vWon").innerText') or 'bar').lower().split(),
           r.ask(win, 'document.getElementById("vWon").innerText'))
        time.sleep(4)
        ok('the other phone has NO PIN anywhere', 'PIN' not in (r.ask(lose, 'document.body.innerText') or '') and pin not in (r.ask(lose, 'document.body.innerText') or ''),
           r.ask(lose, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        tv_clean(r, tv, pin, 'bingo')
        for sid, who in ((win, 'winner phone'), (host, 'console')):
            ok('no script errors on the bingo ' + who, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    finally:
        r.close()


for scene in (trivia, musical, bingo):
    try:
        scene()
    except Exception as e:
        ok(scene.__name__ + ' scene ran to the end', False, repr(e))
print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
