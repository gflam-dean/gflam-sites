#!/usr/bin/env python3
"""THE REAL NIGHT, DRY RUN: ALL FIVE GAMES BACK TO BACK, ONE TV WINDOW AND THE SAME TWO PHONES (INBOX 354c, 13 Nov 2026).

Dean, 12 Nov 2026: "Do the test exactly like we did today ... I shouldn't have to notice that stuff." Main plays the real
night on The Mini Bar (reports/real-night/RUN-SHEET.html). This is the same night on the browser rig
(tools/browser-rig/rig.py: the REAL game Worker in jsc with a fake database, the shipped consoles, the venue's own /tv and
two phones), so the run sheet can be rehearsed on the test server before it is played live:

  ONE TV window (/tv?venue=<slug>) that stays up the whole night; TWO phones (own storage each) that stay open the whole
  night; the venue's SAVED SETTINGS as The Mini Bar has them (trivia buzzer on the TV, musical Pub Classics + well-known
  only, raffle Ticket roll, members draw Flip board; the shapes in tools/fixtures/live-prefs-shapes.json), then, in order:
    TRIVIA > MUSICAL BINGO > BINGO > RAFFLE > MEMBERS DRAW
  and after EVERY game it asks the things Dean found on 12 Nov (reports/live-play-12nov/FINDINGS.md):
    - the TV took the game (right screen), and handed back to the ads when the game ended (no stuck winner, R6/B6)
    - the phones followed the room, were not asked their details again, and the console counted 2, not 4 (M1/M2)
    - the TV and the phones agree (bingo: the same ball count; trivia: the same question) (S14)
    - every phone screen fits one screen: no sideways drift (S3) and no scroll; every TV screen fits
    - no spaced-caps lettering on a game screen (S2/S9/S15)
    - the draw look on the TV is the venue's saved one, and the raffle draw really reaches the TV (R3/R7)
    - nothing threw on any page
  A fault is a FAIL line that names the finding it repeats. VP_SHOTS=<dir> keeps a screenshot per game per screen.

    python3 tools/real-night-dryrun-in-chrome.test.py
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = '/home/vp/venue-enrich/reports/real-night-shots'
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
SET = '5e75e75e-0000-4000-8000-000000000003'
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1


def PHONE_STORE(tag):   # two phones in one browser, each its own storage (as tools/one-phone-a-night-in-chrome.test.py)
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
    if SHOTS: time.sleep(0.5); R.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def text(sid): return js(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,260)')
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
JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null;})()'
ASKED = '!!document.querySelector(".vpfb button[data-rate]") && document.querySelector(".vpfb button[data-rate]").getBoundingClientRect().height>0'
RATE = '(function(){var b=[].filter.call(document.querySelectorAll(".vpfb button[data-rate]"),function(x){return x.getBoundingClientRect().height>0;})[0]; if(!b) return null; b.click(); return b.getAttribute("data-rate");})()'
DEVICE = '(function(){ try{ return localStorage.getItem("vpDeviceId")||""; }catch(e){ return ""; } })()'
PHONES = (('A', 'Ann'), ('B', 'Bob'))

# ---- what Dean found on 12 Nov, as questions about a screen
# a phone page that is wider or taller than the phone (S3/S11/S16, "no scrolling", 10 Nov rule)
FITS = ('(function(){var d=document.documentElement,b=document.body; return JSON.stringify({sw:Math.max(d.scrollWidth,b.scrollWidth),cw:d.clientWidth,'
        'sh:Math.max(d.scrollHeight,b.scrollHeight),ch:d.clientHeight,x:window.scrollX|0});})()')
# spaced mono capitals ("B I N G O", "Q U E S T I O N", letter-spacing over .15em on uppercase text), the banned look
SPACED = ('(function(){var bad=[],all=document.querySelectorAll("body *");for(var i=0;i<all.length;i++){var e=all[i],r=e.getBoundingClientRect();'
          'if(!r.width||!r.height||!e.childNodes.length)continue;var own="";for(var j=0;j<e.childNodes.length;j++)if(e.childNodes[j].nodeType===3)own+=e.childNodes[j].nodeValue;'
          'own=own.trim();if(own.length<3)continue;var cs=getComputedStyle(e),ls=parseFloat(cs.letterSpacing)||0,fs=parseFloat(cs.fontSize)||16;'
          'var up=cs.textTransform==="uppercase"||own===own.toUpperCase();if(up&&ls>0.2*fs&&/[A-Za-z]{3}/.test(own))bad.push(own.slice(0,30)+" "+(ls/fs).toFixed(2)+"em");}'
          'return JSON.stringify(bad.slice(0,6));})()')
# the TV's game frame (the venue's /tv holds the game screen in an iframe) and what it shows
TVFRAME = ('(function(){var f=document.getElementById("gameFrame"); return (f && f.style.display!=="none") ? (f.getAttribute("src")||"") : "";})()')
ANSWER = '[].filter.call(document.querySelectorAll("#pAnswers .pans"),function(b){ return /%s/.test(b.textContent); })[0].click(); true'
def tv_src(tv): return js(tv, TVFRAME) or ''
def tv_shows(tv, rx, secs=40): return R.until(tv, '/%s/.test(%s)' % (rx, TVFRAME), secs) is True
def tv_ads(tv, secs=40):
    """The TV is back on the venue's own ads/idle layer: no game frame showing."""
    return R.until(tv, '(function(){var f=document.getElementById("gameFrame"); return !f || f.style.display==="none" || !f.getAttribute("src");})()', secs) is True


def check_screens(game, tv, phones, phones_too=True):
    """The fit, no-drift and spaced-caps checks on every screen up at this moment (the TV and each phone)."""
    for tag, ph in (phones if phones_too else []):
        f = json.loads(js(ph, FITS) or '{}')
        ok('%s: phone %s has no sideways drift (page %s wide, phone %s; scrolled %s) [12 Nov S3/S11]' % (game, tag, f.get('sw'), f.get('cw'), f.get('x')),
           f.get('sw', 0) <= f.get('cw', 0) and f.get('x', 0) == 0, f)
        ok('%s: phone %s fits one screen, no vertical scroll (%s of %s) [Dean 12 Nov]' % (game, tag, f.get('sh'), f.get('ch')), f.get('sh', 0) <= f.get('ch', 0) + 1, f)
        sp = json.loads(js(ph, SPACED) or '[]')
        ok('%s: phone %s has no spaced-capitals lettering [12 Nov S9]' % (game, tag), sp == [], sp)
    # the game's own screen on the TV is a frame: look inside it
    sp = js(tv, '(function(){var f=document.getElementById("gameFrame"); if(!f||f.style.display==="none"||!f.contentWindow) return "[]"; try{ return f.contentWindow.eval(%s); }catch(e){ return "[]"; }})()' % json.dumps(SPACED))
    if not tv_src(tv): sp = js(tv, SPACED)   # bingo draws its board on the TV page itself
    ok('%s: the TV screen has no spaced-capitals lettering [12 Nov S2/S15]' % game, json.loads(sp or '[]') == [], sp)


def errs_clean(game, *sids):
    e = [js(s, 'JSON.stringify(window.__errs||[])') for s in sids]
    ok('%s: no page threw anything (TV, phones, console)' % game, all(x in ('[]', None) for x in e), e)


def rated(fmt, phones, rows_before):
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
    ok('%s: one rating row per phone lands (%d)' % (fmt, len(phones)),
       len(new) == len(phones) and all(x.get('venue_id') == R.W.info['venue'] and x.get('source') == 'player' and x.get('rating') in (1, 2, 3) for x in new), new)
    return len(rows)


def follows(fmt, path_re, phones):
    for tag, ph in phones:
        moved = R.until(ph, '%s.test(location.pathname)' % path_re, 45)
        ok('%s: phone %s follows the room to %s' % (fmt, tag, fmt), moved is True, js(ph, 'location.href'))
        time.sleep(2)
        ok('%s: phone %s is NOT asked its details again [12 Nov M2]' % (fmt, tag), js(ph, JOIN_FORM) is False or R.until(ph, '!' + JOIN_FORM, 8) is True, text(ph))


def count_is(host, n, game):
    ok('%s: the console counts %d players, not more [12 Nov M1, billing]' % (game, n),
       R.until(host, 'document.getElementById("playerCount").textContent==="%d"' % n, 25) is True and
       (time.sleep(3) or js(host, 'document.getElementById("playerCount").textContent') == str(n)), js(host, 'document.getElementById("playerCount").textContent'))
    ok('%s: and no "over the players your plan includes ... will be charged" warning' % game, not R.until(host, '/over the|will be charged/i.test(document.body.innerText)', 3), text(host))


def seed_mini_bar(W):
    """The Mini Bar's saved game settings (live-prefs-shapes.json shapes + FINDINGS 12 Nov), in the venue's own settings."""
    prefs = {
        'trivia': {'buzzer': True, 'buzzer_where': 'tv', 'count': 3, 'time_s': 20, 'speed_bonus': True},
        'musical': {'hits_only': True, 'pattern': 'one', 'playlist': 'pub-classics', 'reveal': 'end', 'prize': 'Bar tab'},
        'bingo': {'allow_early': False, 'cards': 1, 'pattern': 'one', 'prize': 'Meat tray'},
        'raffle': {'draw_style': 'ticket', 'draw_time': 'short'},
        'members': {'draw_style': 'flip', 'draw_time': 'short'},
    }
    W.seed('vp_venue_settings', [{'venue_id': W.info['venue'], 'game_prefs': prefs}], replace=True)
    return prefs


def night():
    global R
    R = rig.Rig(host_pages=('/app/trivia/host.html', '/app/musical/host.html', '/app/index.html', '/app/raffle/host.html', '/app/members/host.html'))
    W = R.W
    code = W.info['code']
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
    seed_mini_bar(W)
    t_tv, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    ok('the TV is on its ads before the night starts', R.until(tv, 'document.readyState==="complete"', 40) is True and tv_ads(tv, 20), tv_src(tv))
    shot(tv, '00-tv-ads')
    phones = []

    # ======================================================================================== 1 TRIVIA
    print('\n1 TRIVIA: both phones join once; the TV follows')
    t_h, host = R.open('/app/trivia/host.html?venue=' + W.info['venue'], width=1280, height=900)
    ok('trivia: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True, text(host))
    time.sleep(2)
    js(host, 'document.getElementById("cfgCount").value="2"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true')
    seg = js(host, '(function(){function on(i){var b=document.querySelector("#"+i+" button.on"); return b? b.getAttribute("data-v") : "";} return on("cfgBuzzer")+"/"+on("cfgBuzzWhere");})()')
    ok('trivia: the console starts on the SAVED setup (buzzer on, plays on the TV) [12 Nov T5/T7]', seg == 'on/tv', seg)
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('trivia: the lobby is open', R.until(host, LOBBY, 20) is True, js(host, ERRT))
    ok('trivia: the TV takes the lobby (a trivia screen up on the TV)', tv_shows(tv, 'trivia'), tv_src(tv))
    shot(tv, '01-trivia-tv-lobby')
    for tag, name in PHONES:
        tid, ph = R.open('/play?room=' + code, before=PHONE_STORE(tag), width=390, height=844)
        phones.append((tag, ph))
        ok('trivia: phone %s reaches the join form' % tag, R.until(ph, JOIN_FORM + ' && !document.getElementById("joinBtn").disabled', 90) is True, [js(ph, 'location.pathname'), text(ph)])
        time.sleep(1)
        shot(ph, '01-trivia-join-phone-%s' % tag)
        js(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
        R.until(ph, '!' + JOIN_FORM, 20)
    devs = [js(ph, DEVICE) for _, ph in phones]
    ok('CONTROL: the two phones have two different device ids (two storages)', all(devs) and devs[0] != devs[1], devs)
    count_is(host, 2, 'trivia')
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('trivia: the quiz starts', R.until(host, has_btn('First question'), 30) is True, js(host, ERRT))
    click_text(host, 'First question')
    for tag, ph in phones:
        ok('trivia: question 1 reaches phone %s' % tag, R.until(ph, 'document.querySelectorAll("#pAnswers .pans").length===4', 30) is True, text(ph))
    ok('trivia: the TV shows the question too (same one, in step) [12 Nov T1]', R.until(tv, F_TEXT('Which (colour|animal)'), 20) is True, js(tv, F_TEXT_GET))
    time.sleep(1.5)
    shot(tv, '01-trivia-tv-question'); shot(phones[0][1], '01-trivia-phone-A-question')
    check_screens('trivia question', tv, phones)
    for i, (tag, ph) in enumerate(phones):
        js(ph, ANSWER % ('Blue|Roo' if i == 0 else 'Red|Cat'))
        ok('trivia: phone %s answers' % tag, R.until(ph, '/Answer in/i.test(document.body.innerText)', 15) is True, text(ph))
    click_text(host, 'Reveal answer')
    ok('trivia: the answer is revealed', R.until(host, has_btn('Reveal leaderboard') + '||' + has_btn('Next question'), 25) is True, js(host, ERRT))
    shot(phones[0][1], '01-trivia-phone-A-reveal'); shot(tv, '01-trivia-tv-reveal')
    check_screens('trivia reveal', tv, phones)
    # question 2, then the finish
    if click_text(host, 'Next question'):
        for tag, ph in phones:
            ok('trivia: question 2 reaches phone %s' % tag, R.until(ph, 'document.querySelectorAll("#pAnswers .pans").length===4 && /Question 2 of 2/i.test(document.body.innerText)', 30) is True, text(ph))
        time.sleep(1.5)
        for i, (tag, ph) in enumerate(phones):
            js(ph, ANSWER % ('Blue|Roo' if i == 0 else 'Red|Cat'))
        time.sleep(1.5)
        click_text(host, 'Reveal answer')
        R.until(host, has_btn('Reveal leaderboard'), 25)
    tg = [g for g in table('vp_games') if g.get('format') == 'trivia']
    gid = tg[-1]['id'] if tg else None
    pts = {}
    for a in table('vp_trivia_answers'):
        if a.get('game_id') == gid: pts[a.get('player_id')] = pts.get(a.get('player_id'), 0) + (a.get('points_awarded') or 0)
    W.seed('v_vp_trivia_leaderboard', [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': pts.get(p.get('id'), 0)}
                                       for p in table('vp_players') if p.get('session_id') == (tg[-1].get('session_id') if tg else None)], replace=True)
    click_text(host, 'Reveal leaderboard')
    for _ in range(4):
        time.sleep(2)
        if not (click_text(host, 'Announce 3rd') or click_text(host, 'Announce 2nd') or click_text(host, 'Announce the winner') or click_text(host, 'Announce 1st')): break
    ok('trivia: phone B is on its final screen [12 Nov T3: place shown]', R.until(phones[1][1], '!document.getElementById("vFinal").classList.contains("hidden")', 25) is True, text(phones[1][1]))
    time.sleep(2)
    shot(tv, '01-trivia-tv-podium'); shot(phones[0][1], '01-trivia-phone-A-final'); shot(phones[1][1], '01-trivia-phone-B-final')
    final = js(phones[1][1], 'document.body.innerText.replace(/\\s+/g," ")') or ''
    ok('trivia: the final screen on the phone names the PLACE (1st/2nd), not only points [12 Nov T3]', re.search(r'\b(1st|2nd|first|second|place)\b', final, re.I) is not None, final[:200])
    check_screens('trivia final', tv, phones)
    js(host, 'setTimeout(function(){ document.getElementById("toAdsBtn").click(); }, 0); true'); answer_dialogs(host)
    fb = rated('trivia', phones, len(table('vp_game_feedback')))
    ok('trivia: ENDED -> the TV goes back to the ads [12 Nov end of game]', tv_ads(tv, 40), tv_src(tv))
    shot(tv, '01-trivia-tv-after')
    errs_clean('trivia', tv, host, *[p for _, p in phones])
    R.close_tab(t_h)

    # ======================================================================================== 2 MUSICAL BINGO
    print('\n2 MUSICAL BINGO: the same two phones follow the room')
    t_h, host = R.open('/app/musical/host.html', width=1024, height=900)
    ok('musical: the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!document.querySelector("#plGrid .plcard.on")', 40) is True, text(host))
    time.sleep(2)
    on = js(host, '(function(){var o=document.querySelector("#plGrid .plcard.on"); return o? o.textContent.replace(/\\s+/g," ").trim().slice(0,60):"";})()')
    ok('musical: the console starts on the SAVED playlist (Pub Classics), as the grid shows [12 Nov M5/M7]', re.search(r'pub classics', on or '', re.I) is not None, on)
    js(host, 'document.getElementById("prizeInput").value="Bar tab"; true')
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('musical: the lobby is open', R.until(host, LOBBY, 20) is True, js(host, ERRT))
    ok('musical: the TV takes musical bingo (the new intro, not the old) [12 Nov M8]', tv_shows(tv, 'musical'), tv_src(tv))
    shot(tv, '02-musical-tv-lobby')
    follows('musical', '/\\/app\\/musical\\/play/', phones)
    count_is(host, 2, 'musical')
    shot(phones[0][1], '02-musical-phone-A-lobby')
    tap(host, 'startBtn'); answer_dialogs(host)
    for tag, ph in phones:
        ok('musical: phone %s is dealt its card' % tag, R.until(ph, 'document.querySelectorAll("#cardGrid .cc").length===25', 30) is True, text(ph))
    time.sleep(2)
    shot(tv, '02-musical-tv-playing'); shot(phones[0][1], '02-musical-phone-A-card'); shot(host, '02-musical-console')
    sq = json.loads(js(phones[0][1], 'JSON.stringify([].map.call(document.querySelectorAll("#cardGrid .cc"),function(c){return c.textContent.replace(/\\s+/g," ").trim().slice(0,40);}))') or '[]')
    ok('musical: the card has 25 squares with song names on them', len(sq) == 25 and all(sq), sq[:5])
    check_screens('musical card', tv, phones)
    ok('musical: the console has NO false "The TV has no sound yet" warning with a TV connected [12 Nov M6]', not re.search(r'TV has no sound', js(host, 'document.body.innerText') or '', re.I), text(host))
    tap(host, 'endGameBtn'); time.sleep(1.3); tap(host, 'endGameBtn'); answer_dialogs(host)
    fb = rated('musical', phones, fb)
    ok('musical: ENDED -> the TV goes back to the ads', tv_ads(tv, 40), tv_src(tv))
    errs_clean('musical', tv, host, *[p for _, p in phones])
    R.close_tab(t_h)

    # ======================================================================================== 3 BINGO
    print('\n3 BINGO: the same two phones, TV and phones in step')
    t_h, host = R.open('/app/', width=1280, height=900)
    ok('bingo: the console loads on the games menu', R.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40) is True, text(host))
    js(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    R.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20)
    R.until(host, '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")', 15); time.sleep(2)
    js(host, ('var $=function(i){return document.getElementById(i)}; $("prizeInput").value="Meat tray"; $("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change"));'
              '$("cardsSel").value="1"; true'))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('bingo: the lobby is open', R.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 20) is True, [js(host, 'document.getElementById("startBtn").textContent'), js(host, ERRT)])
    ok('bingo: the TV takes bingo (its board is on the TV page itself)', R.until(tv, '/BINGO/.test(document.body.innerText) && /Scan to play|Last called/i.test(document.body.innerText)', 30) is True, text(tv))
    follows('bingo', '/^\\/play/', phones)
    count_is(host, 2, 'bingo')
    tap(host, 'startBtn'); answer_dialogs(host)
    for tag, ph in phones:
        ok('bingo: phone %s is dealt its ticket' % tag, R.until(ph, 'document.querySelectorAll(".bcard, .ticket, [data-cardno]").length>0 || /Ticket 1 of 1/.test(document.body.innerText)', 45) is True, text(ph))
    calls = 0
    for _ in range(12):   # thirty calls in the real night; the dry run calls twelve, each in step
        R.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 20)
        time.sleep(1.2); tap(host, 'nextBtn'); calls += 1
        R.until(host, '/%d of 90/.test(document.getElementById("liveCount").textContent)' % calls, 8)
    ok('bingo: %d balls called on the console' % calls, R.until(host, '/%d of 90/.test(document.getElementById("liveCount").textContent)' % calls, 15) is True, js(host, 'document.getElementById("liveCount").textContent'))
    for tag, ph in phones:
        ok('bingo: phone %s shows the same %d of 90 within 5 s [12 Nov S14]' % (tag, calls), R.until(ph, '/%d of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")' % calls, 5) is True,
           js(ph, '(document.getElementById("hdrBallCount")||{}).textContent'))
    ok('bingo: the TV shows the same %d of 90 called within 5 s, not behind [12 Nov S14: TV was 5 calls behind]' % calls,
       R.until(tv, '/\\b%d\\s*of\\s*90/i.test(document.body.innerText)' % calls, 5) is True, text(tv))
    shot(tv, '03-bingo-tv'); shot(phones[0][1], '03-bingo-phone-A'); shot(phones[1][1], '03-bingo-phone-B')
    check_screens('bingo', tv, phones)
    tap(host, 'endGameBtn'); answer_dialogs(host)
    fb = rated('bingo', phones, fb)
    ok('bingo: ENDED -> the TV goes back to the ads, not stuck on bingo [12 Nov B6/R3]', tv_ads(tv, 40), tv_src(tv))
    shot(tv, '03-bingo-tv-after')
    ok('bingo: ENDED -> the phones are released: not still on a bingo winner/ball screen [12 Nov B6]',
       all(R.until(ph, '!/YOU WON|BINGO!|Show this screen to the host/i.test(document.body.innerText)', 10) is True for _, ph in phones), [text(p) for _, p in phones])
    errs_clean('bingo', tv, host, *[p for _, p in phones])
    R.close_tab(t_h)

    # ======================================================================================== 4 RAFFLE
    print('\n4 RAFFLE: ticket roll on the TV')
    R.db['vp_raffle_prizes'] = [{'label': 'Meat tray', 'raffle_id': None, 'venue_id': W.info['venue'], 'id': 'p0', 'created_at': '2026-10-20T00:00:00Z'}]
    W.seed('vp_raffle_prizes', R.db['vp_raffle_prizes'], replace=True)
    t_h, host = R.open('/app/raffle/host.html', width=1000, height=1100)
    ok('raffle: the console loads', R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True, text(host))
    chips = js(host, '[].map.call(document.querySelectorAll("#styleChips button"),function(b){return (b.classList.contains("on")?"*":"")+b.textContent.trim();}).join("|")')
    ok('raffle: the usual look is Ticket roll (the saved one), no "As now" [12 Nov D5]', chips == '*Ticket roll|Race plate', chips)
    js(host, 'document.querySelector("#prizePresets button").click(); true')
    R.until(host, '/Meat tray/.test(document.getElementById("prizeList").textContent)', 10)
    pl = js(host, 'document.getElementById("prizeList").textContent.replace(/\\s+/g," ")')
    ok('raffle: the prize name keeps its capitals ("Meat Tray" not "meat Tray") [12 Nov R1]', not re.search(r'First(?: up)?:\s*the meat', text(host) or ''), [pl, text(host)])
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('raffle: the raffle reaches the TV [12 Nov R3/R7]', tv_shows(tv, 'raffle'), tv_src(tv))
    time.sleep(2)
    shot(tv, '04-raffle-tv-lobby'); shot(host, '04-raffle-console')
    check_screens('raffle lobby', tv, phones)
    ok('raffle: the TV does NOT fall back to the finished bingo screen [12 Nov R3]', (time.sleep(6) or tv_shows(tv, 'raffle', 3)), tv_src(tv))
    js(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
    for _ in range(12):
        if js(host, 'document.getElementById("drawBtn").disabled || document.getElementById("winnerCard").classList.contains("show")') is True: break
        js(host, ACCEPT); time.sleep(1)
    ok('raffle: the TV draws the Ticket roll [12 Nov R4]', R.until(tv, '(function(f){ try{ return !!f.contentDocument.querySelector(".vpds-tk"); }catch(e){ return false; } })(document.getElementById("gameFrame"))', 30) is True,
       [js(tv, TVFRAME), js(host, ERRT)])
    time.sleep(2); shot(tv, '04-raffle-tv-draw')
    ok('raffle: the phones are not stuck on a finished game while it runs [12 Nov B6]',
       all(R.until(ph, '!/YOU WON|Show this screen to the host/i.test(document.body.innerText)', 5) is True for _, ph in phones), [text(p) for _, p in phones])
    check_screens('raffle draw', tv, phones)
    if R.until(host, 'document.getElementById("winnerCard").classList.contains("show")', 30) is True:
        js(host, 'document.getElementById("claimBtn").click(); true'); answer_dialogs(host)
    js(host, 'setTimeout(function(){ document.getElementById("toAdsBtn").click(); }, 0); true'); answer_dialogs(host)
    ok('raffle: ENDED -> the TV goes back to the ads, not the raffle lobby [12 Nov R6]', tv_ads(tv, 40), tv_src(tv))
    shot(tv, '04-raffle-tv-after')
    errs_clean('raffle', tv, host, *[p for _, p in phones])
    R.close_tab(t_h)

    # ======================================================================================== 5 MEMBERS DRAW
    print('\n5 MEMBERS DRAW: flip board on the TV')
    made = W.ask('POST', '/host/members/settings', {'venue_id': W.info['venue'], 'name': 'Thursday draw', 'current_jackpot_cents': 20000}, {})['body']
    did = (made.get('draw') or {}).get('id')
    imp = W.ask('POST', '/host/members/import', {'draw_id': did, 'members': [{'number': 101 + i, 'name': ('Willow,Mitchell' if i == 0 else 'Member %d' % i)} for i in range(12)]}, {})['body']
    ok('members: CONTROL a draw with 12 members through the real Worker', bool(did) and imp.get('added') == 12, (made, imp))
    for t in ('vp_member_draws', 'vp_member_rosters', 'vp_members'): R.db[t] = table(t)
    t_h, host = R.open('/app/members/host.html', width=1000, height=1100)
    ok('members: the console loads', R.until(host, '!!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True, text(host))
    chips = js(host, '[].map.call(document.querySelectorAll("#styleChips button"),function(b){return (b.classList.contains("on")?"*":"")+b.textContent.trim();}).join("|")')
    ok('members: the usual look is Flip board (the saved one), no "As now" [12 Nov D5]', chips == '*Flip board|Race plate', chips)
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('members: the members draw takes the TV from the raffle', tv_shows(tv, 'members'), tv_src(tv))
    time.sleep(2); shot(tv, '05-members-tv-lobby'); shot(host, '05-members-console')
    js(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
    for _ in range(12):
        if js(host, 'document.getElementById("drawBtn").disabled || document.getElementById("winnerCard").classList.contains("show")') is True: break
        js(host, ACCEPT); time.sleep(1)
    ok('members: the TV draws the Flip board', R.until(tv, '(function(f){ try{ return !!f.contentDocument.querySelector(".vpds-board"); }catch(e){ return false; } })(document.getElementById("gameFrame"))', 30) is True,
       [js(tv, TVFRAME), js(host, ERRT)])
    time.sleep(2); shot(tv, '05-members-tv-draw')
    jp = js(tv, '(function(f){ try{ return f.contentDocument.body.innerText.replace(/\\s+/g," "); }catch(e){ return ""; } })(document.getElementById("gameFrame"))') or ''
    ok('members: the TV shows the jackpot the console shows, not $0 [12 Nov D1]', re.search(r'\$\s*200\b', jp) is not None and not re.search(r'\$\s*0\b(?!\.)', jp), jp[:200])
    check_screens('members draw', tv, phones)
    winner_name = js(host, '(document.querySelector("#winnerCard .wname, #winnerCard h2, #winnerCard .name")||{}).textContent') or ''
    if R.until(host, 'document.getElementById("winnerCard").classList.contains("show")', 30) is True:
        wn = js(host, 'document.getElementById("winnerCard").innerText.replace(/\\s+/g," ")') or ''
        ok('members: the winner name has a space after the comma, never "Willow,Mitchell" [12 Nov D4]', not re.search(r'[A-Za-z],[A-Za-z]', wn), wn[:160])
        js(host, 'document.getElementById("claimBtn").click(); true'); answer_dialogs(host)
    js(host, 'setTimeout(function(){ document.getElementById("toAdsBtn").click(); }, 0); true'); answer_dialogs(host)
    ok('members: ENDED -> the TV goes back to the ads', tv_ads(tv, 40), tv_src(tv))
    shot(tv, '05-members-tv-after')
    errs_clean('members', tv, host, *[p for _, p in phones])

    # ======================================================================================== the night in the database
    print('\nthe night in the Worker\'s database')
    ss, ps = table('vp_sessions'), table('vp_players')
    per = {}
    for p in ps: per.setdefault(p.get('session_id'), []).append(p)
    ok('three player sessions tonight (trivia, musical, bingo), each with exactly 2 players', len(per) == 3 and all(len(v) == 2 for v in per.values()),
       {k: [(p.get('display_name'), p.get('device_id')) for p in v] for k, v in per.items()})
    ok('the whole night holds exactly 2 device ids: one phone is one player all night', set(p.get('device_id') for p in ps) == set(devs), [p.get('device_id') for p in ps])


def F_TEXT(word):
    return '(function(f){ try{ return new RegExp(%s,"i").test(f.contentDocument.body.innerText); }catch(e){ return false; } })(document.getElementById("gameFrame"))' % json.dumps(word)
F_TEXT_GET = '(function(f){ try{ return f.contentDocument.body.innerText.replace(/\\s+/g," ").slice(0,200); }catch(e){ return "no frame"; } })(document.getElementById("gameFrame"))'


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('real-night-dryrun-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
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
