#!/usr/bin/env python3
"""EVERY GAME PLAYED WITH THE SETTINGS VENUES REALLY SAVED, NOT FRESH DEFAULTS (Dean, 12 Nov 2026, INBOX 295.3).

On 12 Nov the full gate was green and Dean's real night on The Mini Bar still played the OLD draw looks and the wrong
musical songs, because of what the venue had SAVED (vp_venue_settings.game_prefs: the draw look '', a playlist, the
reveal, the pattern). Every suite started from a fresh venue with nothing saved. This one plays each game once for
every distinct saved shape in tools/fixtures/live-prefs-shapes.json (made by tools/prefs-shapes.py from main's
read-only export; never a live read here), on the browser rig (tools/browser-rig/rig.py: the REAL game Worker in jsc
with a fake database, the shipped consoles, phones and the venue's own /tv in headless Chrome). The shape is put in
the Worker's database as the venue's saved setup before the console opens, so the console loads it exactly as live.

  TRIVIA   the console starts on the saved questions, seconds a question and speed bonus; the quiz starts with them
           (the Worker's game holds that count and time), a phone joins and the first question reaches it
  MUSICAL  the console starts on the saved theme (this week's pick of several; a theme no longer in the library falls
           back to the console's first), well-known only, pattern and reveal; a phone joins, the game starts with
           the pattern and the theme the console SHOWS, and every song the Worker dealt, and every square on the
           phone's card, is inside that theme (295.2d: Dean's night dealt songs from no playlist at all)
  BINGO    the console starts on the saved pattern (a deleted pattern of their own: One line), tickets each player,
           allow early; a phone joins and is dealt exactly that many tickets; a ball is called and reaches the phone
  RAFFLE   the console's usual draw look is the saved one (''/ticket/nothing: Ticket roll; race: Race plate), never
           "As now"; a draw puts that look on the TV
  MEMBERS  the same, Flip board or Race plate
  and no page threw anything, in every scene.

VP_ONLY=trivia,musical,... runs some games; VP_SHOTS=<dir> keeps screenshots; VP_SHAPES=<file> reads another
fixture (the suite's own fail-first uses that). Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait).

    python3 tools/real-settings-in-chrome.test.py
"""
import io, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

SHAPES = os.environ.get('VP_SHAPES') or os.path.join(ROOT, 'tools', 'fixtures', 'live-prefs-shapes.json')
ONLY = [x for x in os.environ.get('VP_ONLY', '').split(',') if x]
SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
SET = '5e75e75e-0000-4000-8000-000000000001'

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1

R = None


def stand_up(game, shape, host_page, declare=True):
    """A fresh rig whose venue has this game's saved setup as the shape says (None = nothing saved)."""
    global R
    if R: R.close()
    R = rig.Rig(host_pages=(host_page,))
    W = R.W
    if declare:
        W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': game, 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    if shape is not None:
        W.seed('vp_venue_settings', [{'venue_id': W.info['venue'], 'game_prefs': {game: shape}}], replace=True)
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    return W


def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def shot(sid, name):
    if SHOTS: time.sleep(0.4); R.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def errs(sid): return js(sid, 'JSON.stringify(window.__errs||[])')
def clean(*sids):
    e = [errs(s) for s in sids]
    return all(x in ('[]', None) for x in e), e
def label(shape):
    return 'nothing saved' if shape is None else json.dumps(shape, sort_keys=True)[:110]
def gettext(sid): return js(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,240)')
ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
# Every /host/game the console sends, with what the Worker answered (the songs it dealt), kept on the page.
CAPTURE = ('(function(){window.__games=[];var f=window.fetch;window.fetch=function(u,o){var p=f.apply(this,arguments);'
           'try{if(/\\/host\\/game$/.test(String(u))){var rec={body:JSON.parse(o&&o.body||"{}"),resp:null};window.__games.push(rec);'
           'p.then(function(r){return r.clone().json();}).then(function(j){rec.resp=j;},function(){});}}catch(e){}return p;};})();')
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()'
# The phone's join form is up and wired (its scripts have run): the name box and an enabled Join, whatever the page calls it.
JOIN_READY = ('document.readyState!=="loading" && (function(n,b){ return !!n && !!b && !b.disabled && n.offsetParent!==null && b.offsetParent!==null'
              ' && /^Join/.test(b.textContent.trim()); })(document.getElementById("nameIn"), document.getElementById("joinBtn"))')
def click_text(sid, text):
    return js(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(text))
def tap(sid, el_id):
    js(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(el_id))
def answer_dialogs(sid, rounds=3):
    for _ in range(rounds):
        time.sleep(0.8)
        if not (js(sid, TAKEOVER) or js(sid, ASKGO) or js(sid, ACCEPT)): break


# ---------------------------------------------------------------- TRIVIA
def trivia(shape, n):
    print('\nTRIVIA, %s (%s venue%s)' % (label(shape), n, '' if n == 1 else 's'))
    W = stand_up('trivia', shape, '/app/trivia/host.html', declare=False)
    nq = 40
    R.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': nq, 'visibility': 'public', 'owner_venue_id': W.info['venue'], 'status': 'active'}]
    W.seed('vp_question_sets', R.db['vp_question_sets'])
    W.seed('vp_questions', [{'id': 'q-%d' % i, 'set_id': SET, 'seq': i, 'question': 'Question %d?' % i, 'text': 'Question %d?' % i,
                             'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2} for i in range(1, nq + 1)])
    t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    t2, host = R.open('/app/trivia/host.html?venue=' + W.info['venue'], before=CAPTURE, width=1280, height=900)
    ok('trivia: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True, gettext(host))
    time.sleep(3)   # the venue's saved setup is read once the question sets are in the list
    s = shape or {}
    want_count = min(100, s['count']) if isinstance(s.get('count'), int) else None
    want_time = s.get('time_s') if isinstance(s.get('time_s'), int) else None
    cfg = R.json(host, 'JSON.stringify({count:+document.getElementById("cfgCount").value, time:+document.getElementById("cfgTime").value,'
                       ' speed:(function(){var o=document.querySelector("#cfgSpeed .on"); return o?o.getAttribute("data-v"):"";})()})', {})
    if want_count is not None:
        ok('trivia: the console starts on the saved %d questions' % want_count, cfg.get('count') == want_count, cfg)
    if want_time is not None:
        ok('trivia: and the saved %d seconds a question' % want_time, cfg.get('time') == want_time, cfg)
    if isinstance(s.get('speed_bonus'), bool):
        ok('trivia: and speed bonus %s, as saved' % ('on' if s['speed_bonus'] else 'off'), cfg.get('speed') == ('on' if s['speed_bonus'] else 'off'), cfg)
    if want_count is None and want_time is None:
        ok('trivia: CONTROL nothing saved: the console is on its own defaults (a count and a time)', (cfg.get('count') or 0) >= 1 and (cfg.get('time') or 0) >= 5, cfg)
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('trivia: the lobby opens', R.until(host, LOBBY, 20) is True, js(host, ERRT))
    p_tid, ph = R.open('/app/trivia/play.html?room=' + W.info['code'], width=390, height=844)
    ok('trivia: a phone is ready for a team name', R.until(ph, JOIN_READY, 90) is True, gettext(ph))
    js(ph, 'document.getElementById("nameIn").value="Quiz Kids"; document.getElementById("joinBtn").click(); true')
    ok('trivia: the phone joins', R.until(host, 'document.getElementById("playerCount").textContent==="1"', 20) is True, js(host, 'document.getElementById("playerCount").textContent'))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('trivia: the quiz starts (First question offered)', R.until(host, '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()==="First question" && x.getBoundingClientRect().height>0; })[0]', 30) is True, js(host, ERRT))
    games = [g for g in table('vp_games') if g.get('format') == 'trivia']
    cfgw = (games[-1].get('config') or {}) if games else {}
    seqs = cfgw.get('question_seqs') or []
    if want_count is not None:
        ok('trivia: the Worker\'s quiz holds the saved %d questions' % min(want_count, nq), len(seqs) == min(want_count, nq), [len(seqs), cfgw])
    tg = [t for t in table('vp_trivia_games')]
    if want_time is not None:
        tl = [t.get('time_limit_s') for t in tg] + [cfgw.get('time_limit_s'), cfgw.get('time_s')]
        ok('trivia: and its %d seconds a question' % want_time, want_time in tl, [tl, cfgw])
    click_text(host, 'First question')
    ok('trivia: the first question reaches the phone', R.until(ph, 'document.querySelectorAll("#pAnswers .pans").length===4', 30) is True, gettext(ph))
    shot(ph, 'trivia-%s-phone' % n); shot(tv, 'trivia-%s-tv' % n)
    good, e = clean(host, ph)
    ok('trivia: no page threw anything', good, e)


# ---------------------------------------------------------------- MUSICAL
LIB = json.load(io.open(os.path.join(ROOT, 'venueplay', 'data', 'musical-library.json'), encoding='utf-8'))
LIB_IDS = [p['id'] for p in LIB['playlists']]
SONG = {s['id']: s for s in LIB['songs']}
def theme_titles(pid):
    if pid in ('all', 'surprise'):
        return set(s['title'] for s in LIB['songs'])
    p = [x for x in LIB['playlists'] if x['id'] == pid]
    return set(SONG[i]['title'] for i in (p[0]['songIds'] if p else []) if i in SONG)
def theme_name(pid):
    return {'all': 'All songs', 'surprise': 'Surprise Mix'}.get(pid) or ([p['name'] for p in LIB['playlists'] if p['id'] == pid] or ['Playlist'])[0]

RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
PATTERN_WIRE = {'one': 'one_line', 'two': 'two_lines', 'full': 'full_house', 'corners': 'four_corners', 'any': 'any_line'}   # the console's pattern, as /host/game takes it


def musical(shape, n):
    print('\nMUSICAL BINGO, %s (%s venue%s)' % (label(shape), n, '' if n == 1 else 's'))
    W = stand_up('musical', shape, '/app/musical/host.html', declare=False)
    t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    t2, host = R.open('/app/musical/host.html', before=CAPTURE, width=1024, height=900)
    ok('musical: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!document.querySelector("#plGrid .plcard.on")', 40) is True, gettext(host))
    time.sleep(3)   # the venue's saved setup is read and applied once the library is in
    s = shape or {}
    opts = LIB_IDS + ['surprise', 'all']
    if isinstance(s.get('playlists'), list) and len(s['playlists']) > 1:
        want = js(host, 'VPSetupUse.weekPick(%s)' % json.dumps(s['playlists']))
        want = want if want in opts else LIB_IDS[0]
        why = 'this week\'s pick of the saved %d themes' % len(s['playlists'])
    elif s.get('playlist') in opts:
        want, why = s['playlist'], 'the saved theme'
    else:
        want, why = LIB_IDS[0], ('nothing saved: the console\'s first theme' if 'playlist' not in s else 'a theme no longer in the library: the console\'s first')
    on = js(host, '(document.querySelector("#plGrid .plcard.on")||{getAttribute:function(){return "";}}).getAttribute("data-id")')
    ok('musical: the console shows %s (%s), and only that one' % (theme_name(want), why),
       on == want and js(host, 'document.querySelectorAll("#plGrid .plcard.on").length') == 1 and js(host, 'document.getElementById("playlistSel").value') == want,
       [on, js(host, 'document.getElementById("playlistSel").value')])
    if isinstance(s.get('hits_only'), bool):
        ok('musical: well-known songs only is %s, as saved' % ('on' if s['hits_only'] else 'off'), js(host, 'document.getElementById("hitsChk").checked') is s['hits_only'])
    if s.get('pattern'):
        ok('musical: the pattern is the saved %s' % s['pattern'], js(host, 'document.getElementById("patternSel").value') == s['pattern'], js(host, 'document.getElementById("patternSel").value'))
    if s.get('reveal'):
        ok('musical: the reveal is the saved %s' % s['reveal'], js(host, 'document.getElementById("revealSel").value') == s['reveal'], js(host, 'document.getElementById("revealSel").value'))
    if not js(host, 'document.getElementById("prizeInput").value.trim()'):
        js(host, 'document.getElementById("prizeInput").value="Bar tab"; true')
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('musical: the lobby opens', R.until(host, LOBBY, 20) is True, js(host, ERRT))
    p_tid, ph = R.open('/app/musical/play?room=' + W.info['code'], width=390, height=844)
    ok('musical: a phone is ready for a name', R.until(ph, JOIN_READY, 90) is True, gettext(ph))
    js(ph, 'document.getElementById("nameIn").value="Dean"; document.getElementById("joinBtn").click(); true')
    ok('musical: the phone joins', R.until(host, 'document.getElementById("playerCount").textContent==="1"', 20) is True, js(host, 'document.getElementById("playerCount").textContent'))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('musical: the game is running', R.until(host, RUNNING, 30) is True, js(host, ERRT))
    R.until(host, 'window.__games.length && window.__games[window.__games.length-1].resp', 10)
    g = (R.json(host, 'JSON.stringify(window.__games[window.__games.length-1]||{})', {}) or {})
    body, resp = g.get('body') or {}, g.get('resp') or {}
    if s.get('pattern'):
        ok('musical: the game started with the saved pattern %s' % s['pattern'], body.get('pattern') in (s['pattern'], PATTERN_WIRE.get(s['pattern'])), body.get('pattern'))
    ok('musical: the game started with the theme the console SHOWS (%s)' % theme_name(want), (body.get('playlist') or {}).get('name') == theme_name(want), (body.get('playlist') or {}).get('name'))
    tt = theme_titles(want)
    dealt = [x.get('title') for x in (resp.get('songs') or [])]
    stray = [t for t in dealt if t not in tt]
    ok('musical: the Worker dealt %d songs, every one of them inside %s (295.2d)' % (len(dealt), theme_name(want)), len(dealt) >= 24 and not stray, [len(dealt), stray[:4]])
    ok('musical: the phone is dealt its card', R.until(ph, 'document.querySelectorAll("#cardGrid .cc").length===25', 30) is True, gettext(ph))
    # The Worker's own deal for this phone (vp_cards), every square inside the theme the console showed; and the card the
    # phone paints is that deal (a long title is shortened on the card, so each square is the start of a dealt title).
    cards = table('vp_cards')
    sq = [c.get('title') for card in cards for c in (card.get('cells') or []) if isinstance(c, dict) and c.get('title')]
    off = [t for t in sq if t not in tt]
    ok('musical: every square the Worker dealt the phone (%d) is inside %s (295.2d)' % (len(sq), theme_name(want)), len(cards) == 1 and len(sq) == 24 and not off, [len(cards), len(sq), off[:4]])
    shown = js(ph, 'JSON.stringify([].map.call(document.querySelectorAll("#cardGrid .cc"),function(c){return (c.textContent||"").replace(/\\s+/g," ").trim();}))')
    shown = [c for c in (json.loads(shown) if isinstance(shown, str) else []) if c and c.lower() != 'free']
    def norm(t): return ''.join(ch for ch in t.lower() if ch.isalnum())
    bad_sq = [c for c in shown if not any(norm(t).startswith(norm(c).rstrip('.')[:12]) for t in sq)]
    ok('musical: and the phone\'s card shows those squares, no other song', len(shown) == 24 and not bad_sq, [len(shown), bad_sq[:4]])
    shot(ph, 'musical-%s-phone' % n); shot(host, 'musical-%s-console' % n)
    good, e = clean(host, ph)
    ok('musical: no page threw anything', good, e)


# ---------------------------------------------------------------- BINGO
ONETAB_SETTLED = '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")'


def bingo(shape, n):
    print('\nBINGO, %s (%s venue%s)' % (label(shape), n, '' if n == 1 else 's'))
    W = stand_up('bingo', shape, '/app/index.html')
    s = shape or {}
    t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    p_tid, ph = R.open('/play?room=' + W.info['code'], width=390, height=844)
    ok('bingo: a phone is ready for a name', R.until(ph, JOIN_READY, 90) is True, gettext(ph))
    js(ph, 'document.getElementById("nameIn").value="Ann"; document.getElementById("joinBtn").click(); true')
    R.until(ph, '/YOU.RE IN/i.test(document.body.innerText)', 15)
    t2, host = R.open('/app/', width=1280, height=900)
    ok('bingo: the console loads on the games menu', R.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40) is True, gettext(host))
    js(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    R.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20); R.until(host, ONETAB_SETTLED)
    time.sleep(3)   # the venue's saved setup is read once the venue's own patterns are in the list
    c = R.json(host, 'JSON.stringify({pattern:document.getElementById("patternSel").value, cards:+document.getElementById("cardsSel").value,'
                     ' caller:document.getElementById("callerChk").checked, early:document.getElementById("allowEarlyChk").checked,'
                     ' prize:document.getElementById("prizeInput").value})', {})
    pat = s.get('pattern')
    if pat == 'c:custom':
        ok('bingo: a pattern of their own that is no longer there falls back to One line', c.get('pattern') == 'one', c)
    elif pat:
        ok('bingo: the console starts on the saved pattern %s' % pat, c.get('pattern') == pat, c)
    if isinstance(s.get('cards'), int):
        ok('bingo: and %d ticket%s each player, as saved' % (s['cards'], '' if s['cards'] == 1 else 's'), c.get('cards') == s['cards'], c)
    if isinstance(s.get('caller'), bool):
        ok('bingo: real balls is %s, as saved' % ('on' if s['caller'] else 'off'), c.get('caller') is s['caller'], c)
    if isinstance(s.get('allow_early'), bool):
        ok('bingo: allow early BINGO is %s, as saved' % ('on' if s['allow_early'] else 'off'), c.get('early') is s['allow_early'], c)
    if s.get('prize'):
        ok('bingo: the saved prize is in the box', bool((c.get('prize') or '').strip()), c)
    js(host, ('var $=function(i){return document.getElementById(i)}; if(!$("prizeInput").value.trim()) $("prizeInput").value="Meat tray";'
              '$("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change")); true'))
    tap(host, 'startBtn'); answer_dialogs(host)
    want_btn = 'Start calling numbers'
    ok('bingo: the lobby opens', R.until(host, 'document.getElementById("startBtn").textContent===%s || %s' % (json.dumps(want_btn), LOBBY), 20) is True,
       [js(host, 'document.getElementById("startBtn").textContent'), js(host, ERRT)])
    ok('bingo: the phone is in, waiting for the game', R.until(ph, '!document.getElementById("vWait").classList.contains("hidden")', 25) is True, gettext(ph))
    time.sleep(2)
    tap(host, 'startBtn'); answer_dialogs(host)
    want_cards = c.get('cards') or 1
    got = R.until(ph, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of/.test(document.body.innerText)', 45)
    ok('bingo: the phone is dealt its tickets', got is True, gettext(ph))
    tk = [t for t in table('vp_bingo_tickets') if t.get('dealt_at') and not t.get('voided_at')]
    ok('bingo: the Worker dealt the phone %d ticket%s, the number the console started on' % (want_cards, '' if want_cards == 1 else 's'), len(tk) == want_cards, [len(tk), want_cards])
    if not c.get('caller'):
        for _ in range(3):
            R.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 20)
            time.sleep(2); tap(host, 'nextBtn')
            if R.until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 8) is True: break
        ok('bingo: a ball is called', R.until(host, '/1 of 90/.test(document.getElementById("liveCount").textContent)', 15) is True, js(host, 'document.getElementById("liveCount").textContent'))
        ok('bingo: and reaches the phone', R.until(ph, '/1 of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")', 15) is True,
           js(ph, '(document.getElementById("hdrBallCount")||{}).textContent'))
    shot(ph, 'bingo-%s-phone' % n); shot(tv, 'bingo-%s-tv' % n)
    good, e = clean(host, ph)
    ok('bingo: no page threw anything', good, e)


# ---------------------------------------------------------------- RAFFLE / MEMBERS (the TV's draw look)
def F(expr):
    return ('(function(){var f=document.getElementById("gameFrame"); var d=f && f.style.display!=="none" && f.contentDocument;'
            ' if(!d || !d.body) return ""; return (%s);})()' % expr)
STAGE = F('(function(){var s=d.querySelector(".vpds-stage"); if(!s) return "none";'
          ' return d.querySelector(".vpds-tk") ? "ticket" : d.querySelector(".vpds-board") ? "flip" : d.querySelector(".vpds-plate") ? "race" : "stage";})()')
CHIPS = ('(function(sel){return [].map.call(document.querySelectorAll(sel+" button"),function(b){return (b.classList.contains("on")?"*":"")+b.textContent.trim();}).join("|");})')
NAMES = {'ticket': 'Ticket roll', 'race': 'Race plate', 'flip': 'Flip board'}


def tv_on(tv, screen):
    got = R.until(tv, '(function(){var f=document.getElementById("gameFrame"); return !!f && f.style.display!=="none" && /%s/.test(f.src)'
                      ' && !!f.contentDocument && f.contentDocument.readyState==="complete" && !!f.contentWindow.VPDrawStyle;})()' % screen, 40) is True
    time.sleep(1.5)
    return got


def draw(host):
    js(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
    for _ in range(12):
        if js(host, 'document.getElementById("drawBtn").disabled || (document.getElementById("winnerCard")||{classList:{contains:function(){return false;}}}).classList.contains("show")') is True: break
        js(host, ACCEPT); time.sleep(1)


def raffle(shape, n):
    print('\nRAFFLE, %s (%s venue%s)' % (label(shape), n, '' if n == 1 else 's'))
    W = stand_up('raffle', shape, '/app/raffle/host.html')
    want = 'race' if (shape or {}).get('draw_style') == 'race' else 'ticket'
    R.db['vp_raffle_prizes'] = [{'label': 'Meat tray', 'raffle_id': None, 'venue_id': W.info['venue'], 'id': 'p0', 'created_at': '2026-10-20T00:00:00Z'}]
    W.seed('vp_raffle_prizes', R.db['vp_raffle_prizes'], replace=True)
    t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    t2, host = R.open('/app/raffle/host.html', width=1000, height=1100)
    ok('raffle: the console loads', R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True, gettext(host))
    chips = 'Ticket roll|Race plate'.replace(NAMES[want], '*' + NAMES[want])
    ok('raffle: the usual look is %s (from what was saved), and there is no "As now"' % NAMES[want], R.until(host, CHIPS + '("#styleChips")===%s' % json.dumps(chips), 15) is True,
       js(host, CHIPS + '("#styleChips")'))
    js(host, 'document.querySelector("#prizePresets button").click(); true')
    R.until(host, '/Meat tray/.test(document.getElementById("prizeList").textContent)', 10)
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('raffle: the TV has the raffle screen up before the draw', tv_on(tv, 'raffle\\/screen'), js(tv, 'document.getElementById("gameFrame").src'))
    draw(host)
    ok('raffle: the TV draws the %s' % NAMES[want], R.until(tv, STAGE + '===%s' % json.dumps(want), 30) is True, [js(tv, STAGE), js(host, ERRT)])
    shot(tv, 'raffle-%s-tv' % n)
    good, e = clean(host, tv)
    ok('raffle: no page threw anything', good, e)


def members(shape, n):
    print('\nMEMBERS DRAW, %s (%s venue%s)' % (label(shape), n, '' if n == 1 else 's'))
    W = stand_up('members', shape, '/app/members/host.html')
    want = 'race' if (shape or {}).get('draw_style') == 'race' else 'flip'
    made = W.ask('POST', '/host/members/settings', {'venue_id': W.info['venue'], 'name': 'Thursday draw', 'current_jackpot_cents': 10000}, {})['body']
    did = (made.get('draw') or {}).get('id')
    imp = W.ask('POST', '/host/members/import', {'draw_id': did, 'members': [{'number': 101 + i, 'name': 'Member %d' % i} for i in range(12)]}, {})['body']
    ok('members: CONTROL a draw with 12 members, through the real Worker', bool(did) and imp.get('added') == 12, (made, imp))
    for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members'):
        R.db[t] = table(t)
    t1, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    t2, host = R.open('/app/members/host.html', width=1000, height=1100)
    ok('members: the console loads', R.until(host, '!!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True, gettext(host))
    chips = 'Flip board|Race plate'.replace(NAMES[want], '*' + NAMES[want])
    ok('members: the usual look is %s (from what was saved), and there is no "As now"' % NAMES[want], R.until(host, CHIPS + '("#styleChips")===%s' % json.dumps(chips), 15) is True,
       js(host, CHIPS + '("#styleChips")'))
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('members: the TV has the members screen up before the draw', tv_on(tv, 'members\\/screen'), js(tv, 'document.getElementById("gameFrame").src'))
    draw(host)
    ok('members: the TV draws the %s' % NAMES[want], R.until(tv, STAGE + '===%s' % json.dumps(want), 30) is True, [js(tv, STAGE), js(host, ERRT)])
    shot(tv, 'members-%s-tv' % n)
    good, e = clean(host, tv)
    ok('members: no page threw anything', good, e)


SCENES = (('trivia', trivia), ('musical', musical), ('bingo', bingo), ('raffle', raffle), ('members', members))


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('real-settings-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    fx = json.load(io.open(SHAPES, encoding='utf-8'))
    games = fx.get('games') or {}
    print('shapes: %s (%s)' % (os.path.relpath(SHAPES, ROOT) if SHAPES.startswith(ROOT) else SHAPES, fx.get('source', '?')))
    for g, _ in SCENES:
        ok('the fixture has %s shapes, "nothing saved" among them' % g, bool(games.get(g)) and any(x.get('shape') is None for x in games.get(g, [])), games.get(g))
    try:
        for g, fn in SCENES:
            if ONLY and g not in ONLY: continue
            for i, x in enumerate(games.get(g) or []):
                try:
                    fn(x.get('shape'), x.get('venues', 0))
                except Exception as e:
                    import traceback; traceback.print_exc()
                    ok('%s scene %d ran to the end' % (g, i + 1), False, repr(e))
    finally:
        if R: R.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
