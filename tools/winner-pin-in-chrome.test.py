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


# 16 Nov 2026 (onto release/tue-17nov-c): the pages moved on since 5 Nov. Two phones in ONE browser share storage, so
# they are one device and one player (One phone, one player per night); each phone now gets its own storage, as
# real-night-dryrun does. Consoles ask dialogs (pick the quiz up, the state's rules) that a host answers.
def PHONE_STORE(tag):
    return r'''(function(){ var P=%s, S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem;
  function mine(st){ try{ return st===window.localStorage; }catch(e){ return false; } }
  S.getItem=function(x){ return mine(this) ? g.call(this, P+x) : g.call(this, x); };
  S.setItem=function(x,v){ return mine(this) ? s.call(this, P+x, v) : s.call(this, x, v); };
  S.removeItem=function(x){ return mine(this) ? r.call(this, P+x) : r.call(this, x); };
})();''' % json.dumps('phone-' + tag + ':')
DIALOGS = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
           '/^(Pick it up here|I understand|Accept|Start as a free.*|Yes.*)$/i.test(x.textContent.trim()); })[0]; if(b) b.click(); return !!b;})()')
def answer_dialogs(r, sid, rounds=4):
    for _ in range(rounds):
        time.sleep(0.8)
        if not r.ask(sid, DIALOGS): break
JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null && !b.disabled;})()'
def join_phone(r, code, tag, name, path):
    _, sid = r.open(path + '?room=' + code, before=PHONE_STORE(tag), width=390, height=844)
    ok('CONTROL: the phone for ' + name + ' reaches the join form', r.until(sid, JOIN_FORM, 90) is True, r.ask(sid, 'document.body.innerText.slice(0,200)'))
    time.sleep(0.8)
    r.ask(sid, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
    r.until(sid, '!' + JOIN_FORM, 20)
    return sid
def declare(r, fmt):
    r.W.ask('POST', '/host/gaming/declare', {'venue_id': r.W.info['venue'], 'format': fmt, 'state': 'QLD', 'category_claimed': 'test rig'}, {})


def frames(r, name, tv=None, host=None, phones=()):
    """VP_SHOTS only: the TV at 1280x720 and 1920x1080, the console at 375x667 and 390x844, each phone at 390x844."""
    if not SHOTS: return
    def size(sid, w, h): r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': w < 600}, session=sid)
    if tv:
        for w, h in ((1280, 720), (1920, 1080)): size(tv, w, h); time.sleep(0.9); shot(r, tv, '%s-tv-%d' % (name, w))
    if host:
        for w, h in ((375, 667), (390, 844)): size(host, w, h); time.sleep(0.7); shot(r, host, '%s-console-%d' % (name, w))
    for tag, ph in phones: shot(r, ph, '%s-phone-%s' % (name, tag))


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
# Just the words on the TV, every frame: the PIN's digits are looked for here (markup is full of numbers: styles, ids, paths).
TV_TEXT = r'''(function(){ var out=[]; function walk(w){ try{ out.push(w.document.body ? w.document.body.innerText : "");
  for(var i=0;i<w.frames.length;i++) walk(w.frames[i]); }catch(e){} } walk(window); return out.join("\n"); })()'''
TV_ALL = r'''(function(){ var out=[]; function walk(w){ try{ out.push(w.document.documentElement.outerHTML); out.push(w.document.body ? w.document.body.innerText : "");
  for(var i=0;i<w.frames.length;i++) walk(w.frames[i]); }catch(e){} } walk(window); return out.join("\n"); })()'''
HEARD = 'JSON.stringify(window.__heard||[])'
PINTEXT = lambda el: '((document.getElementById("%s")||{}).textContent||"")' % el
PINSIZE = lambda el: ('(function(e){ if(!e||e.classList.contains("hidden")) return 0; var a=[e].concat([].slice.call(e.querySelectorAll("*")));'
                      'return Math.min.apply(null, a.map(function(x){ return parseFloat(getComputedStyle(x).fontSize)||0; })); })(document.getElementById("%s"))' % el)


def _plain(o):
    """A heard message without its envelope's own fields (_sig, _n, _ts, _sid...): signatures and nonces are random
    letters and digits, and a 4-digit PIN turned up inside one by chance (16 Nov 2026, 1 run in 5). The PIN is a VALUE."""
    if isinstance(o, dict): return {k: _plain(v) for k, v in o.items() if not str(k).startswith('_')}
    if isinstance(o, list): return [_plain(v) for v in o]
    return o


def tv_clean(r, tv, pin, label):
    """The TV has the game (CONTROL) and never the PIN, in its page or in anything it heard."""
    import re
    page = r.ask(tv, TV_ALL) or ''
    heard = r.json(tv, HEARD, []) or []
    ok(label + ': CONTROL the TV heard this game on the channel', len(heard) > 0, str(heard)[:200])
    rx = re.compile(r'(?<![0-9A-Za-z])' + pin + r'(?![0-9A-Za-z])')
    ok(label + ': the TV page never has the PIN (' + pin + '), "Round PIN" or a winner PIN mark',
       not rx.search(r.ask(tv, TV_TEXT) or '') and 'Round PIN' not in page and 'data-winpin' not in page and 'PIN ' + pin not in page,
       [page[max(0, page.find(pin) - 80):page.find(pin) + 40]] if pin in page else page[:120])
    msgs = []
    for h in heard:
        try: msgs.append(json.dumps(_plain(json.loads(h))))
        except Exception: msgs.append(str(h))
    bad = [m for m in msgs if rx.search(m) or '"pin"' in m.lower()]
    ok(label + ': no message the TV heard carries the PIN or a pin field (%d messages)' % len(msgs), not bad, bad[:2])


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
        win = join_phone(r, code, 'A', 'Quiz Wizards', '/app/trivia/play.html')
        lose = join_phone(r, code, 'B', 'Slow Coaches', '/app/trivia/play.html')
        ctid, con = r.open('/__blank')
        time.sleep(3)
        players = {p.get('display_name'): p.get('id') for p in table(r, 'vp_players') if p.get('session_id') == S}
        ok('CONTROL: both teams are players in tonight\'s quiz', 'Quiz Wizards' in players and 'Slow Coaches' in players, players)
        # The last question is revealed and the board stands: the winner 1st, the other 2nd (Dean, 5 Nov 2026: 1st only).
        r.W.seed('vp_trivia_games', [{'game_id': G, 'question_set_id': SET, 'current_seq': 1, 'phase': 'revealed', 'question_ends_at': ends}], replace=True)
        r.W.seed('v_vp_trivia_leaderboard', [{'game_id': G, 'player_id': players.get('Quiz Wizards'), 'points': 900},
                                             {'game_id': G, 'player_id': players.get('Slow Coaches'), 'points': 800},
                                             {'game_id': G, 'player_id': 'other-2', 'points': 700}], replace=True)
        htid, host = r.open('/app/trivia/host.html', width=390, height=844)
        r.until(host, 'document.readyState==="complete"', 30); answer_dialogs(r, host)   # "A quiz is running at this venue. Pick it up?"
        got = r.until(host, '(function(t){ return /^Round PIN [0-9]{4}$/.test(t) ? t : ""; })(' + PINTEXT('roundPin') + ')', 40)
        ok('the trivia console shows "Round PIN ' + pin + '"', got == 'Round PIN ' + pin, [got, r.ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)')])
        ok('the console PIN is at least 15px', (r.ask(host, PINSIZE('roundPin')) or 0) >= 15, r.ask(host, PINSIZE('roundPin')))
        rows = [{'name': 'Quiz Wizards', 'points': 900}, {'name': 'Slow Coaches', 'points': 800}]
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'podium', 'fmt': 'trivia', 'top': rows[:1], 'rows': rows})))
        want = 'Show this to the host: PIN ' + pin + ', Quiz Wizards, 1st'
        got = r.until(win, '(function(t){ return /PIN [0-9]{4}/.test(t) ? t : ""; })(' + PINTEXT('finalPin') + ')', 25)
        shot(r, win, 'winner-pin-trivia-phone')
        time.sleep(4); frames(r, 'trivia', tv, host, (('1st', win), ('2nd', lose)))
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
        declare(r, 'musical')
        ttid, tv = r.open('/tv?venue=' + slug, before=HEAR)
        ctid, con = r.open('/__blank')
        htid, host = r.open('/app/musical/host.html', width=390, height=844)
        ok('CONTROL: the musical console loads', r.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 30) is True)
        r.until(host, ONETAB_SETTLED, 10)
        r.ask(host, 'document.getElementById("prizeInput").value="Bar tab"; setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        answer_dialogs(r, host)
        r.until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 15)
        win = join_phone(r, code, 'A', 'Ann', '/app/musical/play.html')
        lose = join_phone(r, code, 'B', 'Bo', '/app/musical/play.html')
        time.sleep(3)
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        answer_dialogs(r, host)
        ok('CONTROL: the game is running on the console', r.until(host, RUNNING, 20) is True, r.ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        games = [g for g in table(r, 'vp_games') if g.get('format') == 'musical_bingo' and g.get('status') == 'running']
        ok('CONTROL: one musical game running in the Worker', len(games) == 1, games)
        G = games[0]['id'] if games else 'none'
        # The prize being played, as the console told the room ("started"): "any" (Any line) for a venue on the default
        # since 11 Nov 2026, "one" for the older one-line venues. The PIN is that prize's.
        st = ''
        import re
        for h in (r.json(tv, HEARD, []) or []):
            for mm in re.finditer(r'\\?"t\\?":\\?"started\\?"[^}]*?\\?"pattern\\?":\\?"([a-z_]+)', h): st = mm.group(1)
        ok('CONTROL: the console told the room which prize is played (' + st + ')', st in ('any', 'one', 'two', 'corners', 'full'), st)
        pin = pin_for('game', G, st or 'one')
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
        pid = r.ask(win, 'localStorage.getItem("vp-mpid-%s")' % code) or ''
        ok('CONTROL: the winning phone has its channel id', bool(pid), pid)
        r.ask(con, SAY + '(%s,%s)' % (json.dumps(code), json.dumps({'t': 'winner', 'pid': pid, 'name': 'Ann', 'cardNo': str(card_no), 'pids': [pid], 'names': ['Ann'], 'cardNos': [card_no], 'split': False})))
        want = 'Show this to the host: PIN %s, card %s' % (pin, card_no)
        got = r.until(win, '(function(t){ return /PIN [0-9]{4}/.test(t) ? t : ""; })(' + PINTEXT('wonPin') + ')', 25)
        shot(r, win, 'winner-pin-musical-phone')
        frames(r, 'musical', tv, host, (('winner', win), ('other', lose)))
        ok('the winning musical phone says "' + want + '"', got == want, [got, r.ask(win, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)')])
        ok('the phone PIN line is at least 15px, nothing smaller', (r.ask(win, PINSIZE('wonPin')) or 0) >= 15, r.ask(win, PINSIZE('wonPin')))
        # The game's own name ("Musical bingo") heads the new-look screen; what the winner READS to the host must never say bingo.
        ok('the musical win line and PIN line never say "bingo"', 'bingo' not in ((r.ask(win, 'document.getElementById("wonPin").innerText+" "+document.getElementById("wonSub").innerText') or 'bingo').lower()),
           r.ask(win, 'document.getElementById("wonPin").innerText+" | "+document.getElementById("wonSub").innerText'))
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
    r = RIG.Rig(host_pages=('/app/index.html',))
    try:
        code, slug = r.W.info['code'], r.W.info['slug']
        declare(r, 'bingo')
        ttid, tv = r.open('/tv?venue=' + slug, before=HEAR)
        ctid, con = r.open('/__blank')
        htid, host = r.open('/app/', width=390, height=844)
        ok('CONTROL: the console loads on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 30) is True)
        r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 15)
        r.until(host, ONETAB_SETTLED, 10)
        r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                     '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";true'))
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        answer_dialogs(r, host)
        ok('CONTROL: the bingo lobby is open', r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 20) is True, r.ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        win = join_phone(r, code, 'A', 'Ann', '/play')
        lose = join_phone(r, code, 'B', 'Bo', '/play')
        time.sleep(2)
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true')
        answer_dialogs(r, host)
        ok('CONTROL: the winning phone is dealt its ticket', r.until(win, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of 1/.test(document.body.innerText)', 45) is True,
           r.ask(win, 'document.body.innerText.slice(0,200)'))
        r.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 20)
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
        frames(r, 'bingo', tv, host, (('winner', win), ('other', lose)))
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


def bingo_host_only():
    print('\nNUMBER BINGO, HOST ONLY: nobody joined, the console still has its Round PIN and the TV still never does')
    r = RIG.Rig(host_pages=('/app/index.html',))
    try:
        code, slug = r.W.info['code'], r.W.info['slug']
        declare(r, 'bingo')
        ttid, tv = r.open('/tv?venue=' + slug, before=HEAR)
        htid, host = r.open('/app/', width=390, height=844)
        ok('CONTROL: the console loads on the games menu', r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 30) is True)
        r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
        r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 15)
        r.until(host, ONETAB_SETTLED, 10)
        r.ask(host, ('var $=function(i){return document.getElementById(i)};$("prizeInput").value="Meat tray";'
                     '$("paidSel").value="";$("paidSel").dispatchEvent(new Event("change"));$("cardsSel").value="1";true'))
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); answer_dialogs(r, host)
        ok('CONTROL: the host-only lobby is open', r.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 20) is True)
        time.sleep(3)   # as long as a host would look at the lobby; the phone scene has its joins here
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); answer_dialogs(r, host)
        ok('CONTROL: the host-only game is calling', r.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 25) is True,
           r.ask(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,240)'))
        r.ask(host, 'setTimeout(function(){ document.getElementById("nextBtn").click(); }, 0); true')
        r.until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 15)
        draws = table(r, 'vp_bingo_draws')
        D = draws[-1]['id'] if draws else 'none'
        pin = pin_for('bingo', D, 'one')
        got = r.until(host, '(function(t){ return /^Round PIN [0-9]{4}$/.test(t) ? t : ""; })(' + PINTEXT('roundPin') + ')', 20)
        ok('with no phones in, the bingo console still shows "Round PIN ' + pin + '"', got == 'Round PIN ' + pin, got)
        fit = r.ask(host, '(function(e){ if(!e) return false; var b=e.getBoundingClientRect(); return b.right<=window.innerWidth && b.left>=0; })(document.getElementById("roundPin"))')
        ok('the Round PIN sits inside a 390 wide console, not off its side', fit is True, fit)
        tv_clean(r, tv, pin, 'bingo host only')
        frames(r, 'bingo-host-only', tv, host)
        ok('no script errors on the host-only console', r.ask(host, 'window.__errs.length') == 0, r.ask(host, 'JSON.stringify(window.__errs)'))
    finally:
        r.close()


for scene in (trivia, musical, bingo, bingo_host_only):
    try:
        scene()
    except Exception as e:
        ok(scene.__name__ + ' scene ran to the end', False, repr(e))
print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
