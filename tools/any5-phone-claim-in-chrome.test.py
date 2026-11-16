#!/usr/bin/env python3
"""THE PHONE NIGHT FOR A VENUE'S OWN PATTERN, "ANY 5 NUMBERS", PLAYED IN A REAL BROWSER (job list row 167,
"Phone-night pattern claim test"; the same night Dean would play on Test Bravo, proved on the rig instead).

tools/caller-winner-in-chrome.test.py GAME 4 makes and saves "Any 5 numbers" and plays it in CALLER mode (real balls,
no phones). Nothing played it with PHONES, where the phone itself decides whether to claim, the Worker checks the
ticket against the custom rule, and the claim is written with the rule kept. This does:

  Scene 1, ONE TV window and TWO phones (own storage each), on the rig in tools/browser-rig/rig.py:
    the console makes and picks "Any 5 numbers", opens a phone lobby (1 ticket each), the phones join, the night starts;
    the phones are dealt SERVER tickets; the phone names the pattern (header pill and claim button);
    the balls are called on the console until Ann's ticket has exactly 5 called numbers (the draw's order is set by
    this test beforehand, the rig has no other way to choose the balls; the Worker's rule and the pages are the real
    ones); before that an early tap is not a claim; at 5 Ann taps the claim button; the console shows the claim,
    checked by the server; the host confirms; Ann's phone says YOU WON and sends her to the HOST; Bob's phone says who
    won; the TV names "Any 5 numbers"; the server's claim row is pattern 'custom', rule kept, status confirmed.
    Every phone screen: no sideways drift, no scroll (390x844, and 375x667 for the win), no spaced capitals; nothing threw.
  Scene 2, host only: no phones, the console on Any 5, a few balls; the console and the TV are fine with 0 phones.

    python3 tools/any5-phone-claim-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import json, os, re, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
PRIZE = 'Bottle of bubbles'
PATNAME = 'Any 5 numbers'
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    sys.stdout.flush()
    if not cond: bad += 1


R = None
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def shot(sid, name):
    if SHOTS: time.sleep(0.6); R.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def tap(sid, i): js(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(i)); time.sleep(0.8)
def text(sid, i): return js(sid, '((document.getElementById(%s)||{}).textContent||"").replace(/\\s+/g," ").trim()' % json.dumps(i))
def body(sid): return js(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,300)')

VISIBLE = ('(function(id){var e=document.getElementById(id);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&!e.hidden&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')
def vis(i): return VISIBLE + '(%s)' % json.dumps(i)

def resize(sid, w, h):
    R.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': w < 600}, session=sid)
    time.sleep(1.0)

def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']

# a phone page wider or taller than the phone; spaced mono capitals (the banned look): as the real-night dry run asks
FITS = ('(function(){var d=document.documentElement,b=document.body; return JSON.stringify({sw:Math.max(d.scrollWidth,b.scrollWidth),cw:d.clientWidth,'
        'sh:Math.max(d.scrollHeight,b.scrollHeight),ch:d.clientHeight,x:window.scrollX|0});})()')
SPACED = ('(function(){var bad=[],all=document.querySelectorAll("body *");for(var i=0;i<all.length;i++){var e=all[i],r=e.getBoundingClientRect();'
          'if(!r.width||!r.height||!e.childNodes.length)continue;var own="";for(var j=0;j<e.childNodes.length;j++)if(e.childNodes[j].nodeType===3)own+=e.childNodes[j].nodeValue;'
          'own=own.trim();if(own.length<3)continue;var cs=getComputedStyle(e),ls=parseFloat(cs.letterSpacing)||0,fs=parseFloat(cs.fontSize)||16;'
          'var up=cs.textTransform==="uppercase"||own===own.toUpperCase();if(up&&ls>0.2*fs&&/[A-Za-z]{3}/.test(own))bad.push(own.slice(0,30)+" "+(ls/fs).toFixed(2)+"em");}'
          'return JSON.stringify(bad.slice(0,6));})()')

def fits(label, sid, w, h):
    f = json.loads(js(sid, FITS) or '{}')
    ok('%s: no sideways drift at %dx%d (page %s wide, phone %s, scrolled %s)' % (label, w, h, f.get('sw'), f.get('cw'), f.get('x')), f.get('sw', 0) <= f.get('cw', 0) and f.get('x', 0) == 0, f)
    ok('%s: fits one screen, no vertical scroll at %dx%d (%s of %s)' % (label, w, h, f.get('sh'), f.get('ch')), f.get('sh', 0) <= f.get('ch', 0) + 1, f)
    sp = json.loads(js(sid, SPACED) or '[]')
    ok('%s: no spaced-capitals lettering' % label, sp == [], sp)

TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
def answer_dialogs(sid, rounds=3):
    for _ in range(rounds):
        time.sleep(0.8)
        if not (js(sid, TAKEOVER) or js(sid, ASKGO) or js(sid, ACCEPT)): break

JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null;})()'
CARD_NUMS = 'JSON.stringify([].map.call(document.querySelectorAll("#cardStack .cc[data-n]"), function(c){ return +c.getAttribute("data-n"); }))'


def start_rig():
    global R
    R = RIG.Rig()
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
    for fmt in ('bingo',):
        W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': fmt, 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    return W


def open_tv():
    _, tv = R.open('/tv?venue=' + R.W.info['slug'], width=1280, height=720)
    ok('the TV loads', R.until(tv, 'document.readyState==="complete"', 40) is True)
    time.sleep(1.5)
    return tv


def open_console():
    _, host = R.open('/app/', width=1280, height=900)
    ok('the console loads, signed in, on the games menu', R.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 40) is True, body(host))
    js(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    R.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20)
    R.until(host, '!(window.VP_ONETAB && VP_ONETAB.state && VP_ONETAB.state()==="asking")', 15)
    time.sleep(2)
    return host


def make_pattern(host):
    """The venue's own pattern, made in the console's editor exactly as the caller-winner suite does, then chosen."""
    R.until(host, 'document.querySelector(\'#patternSel option[value="__newpat"]\')!==null', 15)
    js(host, 'var s=document.getElementById("patternSel"); s.value="__newpat"; s.dispatchEvent(new Event("change")); true'); time.sleep(0.6)
    ok('the pattern editor opens from "Custom pattern..."', js(host, vis('cpModal')) is True)
    js(host, 'document.getElementById("cpAny").click(); document.getElementById("cpN").value="5"; document.getElementById("cpName").value=%s; true' % json.dumps(PATNAME))
    tap(host, 'cpSave'); time.sleep(1)
    saved = [x for x in table('vp_bingo_patterns') if not x.get('deleted_at')]
    ok('the venue has "Any 5 numbers" saved on the server: any 5', len(saved) == 1 and saved[0].get('name') == PATNAME and saved[0].get('rule') == {'type': 'any', 'n': 5}, saved)
    key = js(host, 'document.getElementById("patternSel").value')
    ok('it is the chosen pattern, a venue pattern key (c:...)', bool(re.match(r'^c:', key or '')), key)
    return key, (saved[0] if saved else {})


def lobby(host, key):
    """A PHONE night: caller mode OFF, 1 ticket each, the saved pattern, a prize. The first Start opens the lobby."""
    js(host, ('var $=function(i){return document.getElementById(i)}; if($("callerChk").checked){ $("callerChk").checked=false; $("callerChk").dispatchEvent(new Event("change")); }'
              '$("patternSel").value=%s; $("patternSel").dispatchEvent(new Event("change")); $("prizeInput").value=%s;'
              '$("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change")); $("cardsSel").value="1"; $("cardsSel").dispatchEvent(new Event("change")); true') % (json.dumps(key), json.dumps(PRIZE)))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('the phone lobby is open (the button now says Start calling numbers)', R.until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 25) is True, text(host, 'startBtn'))


def early_tap(ph):
    """Tap the claim button and read the line above it in the same breath: the phone repaints that line with its usual
    hint a moment later, so a read a second on is a race, not a verdict."""
    return js(ph, '(function(){ document.getElementById("bingoBtn").click(); return document.getElementById("pMsg").textContent.replace(/\\s+/g," ").trim(); })()')


def call_ball(host, k):
    R.until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 20)
    time.sleep(1.0); tap(host, 'nextBtn')
    return R.until(host, '/^%d of 90/.test(document.getElementById("liveCount").textContent)' % k, 15) is True


# ======================================================================================== SCENE 1
def phones_night():
    print('\nSCENE 1: a phone night for "Any 5 numbers": two phones, one TV, the console')
    W = start_rig()
    code = W.info['code']
    tv = open_tv()
    host = open_console()
    key, pat_row = make_pattern(host)
    lobby(host, key)
    phones = []
    for tag, name in (('A', 'Ann'), ('B', 'Bob')):
        _, ph = R.open('/play?room=' + code, before=RIG.own_storage(tag), width=390, height=844)
        phones.append((tag, ph))
        ok('phone %s reaches the join form' % tag, R.until(ph, JOIN_FORM + ' && !document.getElementById("joinBtn").disabled', 90) is True, body(ph))
        time.sleep(1)
        js(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
        R.until(ph, '!' + JOIN_FORM, 20)
    pa, pb = phones[0][1], phones[1][1]
    ok('the console counts 2 players', R.until(host, 'document.getElementById("playerCount").textContent==="2"', 25) is True, text(host, 'playerCount'))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('the night is running: the console is calling', R.until(host, 'document.getElementById("nextBtn") && document.getElementById("nextBtn").offsetParent!==null', 25) is True, text(host, 'startBtn'))
    # ---- the tickets: server tickets, one each
    for tag, ph in phones:
        ok('phone %s is dealt its ticket (27 squares, 15 numbers)' % tag, R.until(ph, 'document.querySelectorAll("#cardStack .cc[data-n]").length===15', 45) is True, body(ph))
    nums = {}
    for tag, ph in phones: nums[tag] = sorted(json.loads(js(ph, CARD_NUMS) or '[]'))
    rows = [t for t in table('vp_bingo_tickets') if t.get('dealt_at') and not t.get('voided_at')]
    def flat(cells): return [v for r in cells for v in r] if cells and isinstance(cells[0], list) else list(cells)
    by = {}
    for t in rows:
        s = sorted(v for v in flat(t['cells']) if v)
        for tag in nums:
            if s == nums[tag]: by[tag] = t
    ok('each phone holds a SERVER ticket: its 15 numbers are a dealt row of vp_bingo_tickets, source server, one ticket each', len(rows) == 2 and len(by) == 2 and all(t.get('source') == 'server' for t in by.values()), [len(rows), nums])
    A = nums['A']; B = set(nums['B'])
    ok('CONTROL: the two phones hold different tickets', set(A) != B, [A, sorted(B)])
    ok('the phone names the pattern: the header pill and the ticket name say "Any 5 numbers"', js(pa, vis('hdr2')) is True and text(pa, 'hdrPat') == PATNAME and text(pa, 'cardPat') == PATNAME, [text(pa, 'hdrPat'), text(pa, 'cardPat'), js(pa, vis('hdr2'))])
    ok('the phone shows the prize', text(pa, 'hdrPrize') == PRIZE, text(pa, 'hdrPrize'))
    btn = js(pa, 'document.getElementById("bingoBtn").textContent.trim()')
    ok('the claim button names it: "I’ve got Any 5 numbers"', btn == 'I’ve got Any 5 numbers', btn)
    shot(pa, '01-phone-A-ticket-390'); shot(pb, '01-phone-B-ticket-390')
    fits('phone A ticket', pa, 390, 844); fits('phone B ticket', pb, 390, 844)

    # ---- the balls: the test sets the draw's ORDER so Ann's fifth number is the sixth ball
    draws = table('vp_bingo_draws')
    drow = [d for d in draws if d.get('id') == (rows[0].get('draw_id') if rows else None)]
    ok('the night has one draw row on the server, nothing called yet', len(drow) == 1 and not (drow[0].get('draw_index') or 0), draws)
    ann_only = [n for n in A if n not in B]
    fill = [n for n in range(1, 91) if n not in A and n not in B][:2]
    a5 = ann_only[:5]
    order = a5[:4] + [fill[0]] + [a5[4]] + [fill[1]]
    order += [n for n in range(1, 91) if n not in order]
    ok('CONTROL: the draw order is a full shuffle of 1 to 90', sorted(order) == list(range(1, 91)) and len(ann_only) >= 5, [len(order), len(ann_only)])
    drow[0]['draw_order'] = order
    W.seed('vp_bingo_draws', [drow[0] if d.get('id') == drow[0].get('id') else d for d in draws], replace=True)

    def hits(who, k):
        called = set(order[:k])
        return len([n for n in (A if who == 'A' else sorted(B)) if n in called])

    claims0 = len(table('vp_bingo_claims'))
    for k in range(1, 5):
        ok('ball %d is called; Ann has %d called numbers, Bob 0' % (k, k), call_ball(host, k) is True and hits('A', k) == k and hits('B', k) == 0, [text(host, 'liveCount')])
    ok('phone A and phone B show the same "4 of 90"', R.until(pa, '/4 of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")', 8) is True and
       R.until(pb, '/4 of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")', 8) is True, [text(pa, 'hdrBallCount'), text(pb, 'hdrBallCount')])
    ok('the TV board names the pattern: Any 5 numbers, and the prize', R.until(tv, vis('tvRun'), 20) is True and R.until(tv, 'document.getElementById("tvPattern").textContent.trim()===%s && document.getElementById("tvPrize").textContent.trim()===%s' % (json.dumps(PATNAME), json.dumps(PRIZE)), 15) is True,
       [text(tv, 'tvPattern'), text(tv, 'tvPrize'), body(tv)])
    tv_shot_both(tv, '02-tv-board')
    # ---- BEFORE five: an early tap is not a claim
    msg = early_tap(pa)
    ok('EARLY: Ann (4 of 5) taps the claim button: the phone says not yet, nothing is sent', re.search(r'Not yet', msg or '') and 'BINGO sent' not in msg, msg)
    ok('EARLY: no claim row on the server, and none on the console', len(table('vp_bingo_claims')) == claims0 and 'No claims yet' in text(host, 'claimQueue'), [len(table('vp_bingo_claims')), text(host, 'claimQueue')])
    ok('EARLY: the claim button is still there to tap later (not stuck on "sent")', js(pa, 'document.getElementById("bingoBtn").disabled') is False)
    msgb = early_tap(pb); time.sleep(1)
    ok('EARLY: Bob (0 of 5) taps it: not yet either, and still no claim', re.search(r'Not yet', msgb or '') and len(table('vp_bingo_claims')) == claims0, [msgb, len(table('vp_bingo_claims'))])
    shot(pa, '03-phone-A-early-tap-390')
    ok('ball 5 (not Ann\'s) is called; she is still on 4', call_ball(host, 5) is True and hits('A', 5) == 4)
    ok('ball 6 is Ann\'s fifth number: exactly 5 of her numbers are called now', call_ball(host, 6) is True and hits('A', 6) == 5 and hits('B', 6) == 0 and order[5] == a5[4], [hits('A', 6), hits('B', 6)])
    balls = [b for b in table('vp_bingo_draw_balls') if not b.get('withdrawn_at')]
    called = sorted(b['number'] for b in balls)
    ok('the server\'s record of the called balls agrees: Ann\'s ticket has exactly 5 of them', len(balls) == 6 and len([n for n in A if n in called]) == 5, [called, A])
    ok('both phones show 6 of 90 before anyone claims', R.until(pa, '/6 of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")', 8) is True and
       R.until(pb, '/6 of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")', 8) is True, [text(pa, 'hdrBallCount'), text(pb, 'hdrBallCount')])
    time.sleep(1.5)

    # ---- Ann claims
    tap(pa, 'bingoBtn'); time.sleep(1.2)
    ok('Ann taps the claim button: her phone says BINGO sent, the host is checking', 'BINGO sent' in (text(pa, 'pMsg') or '') and js(pa, 'document.getElementById("bingoBtn").disabled') is True, text(pa, 'pMsg'))
    ok('the console shows the claim in its queue: Ann, with a Confirm winner button', R.until(host, '!!document.querySelector("#claimQueue button[data-act=confirm]")', 20) is True, text(host, 'claimQueue'))
    ok('the server has checked it against the custom rule: the card says Valid, naming Any 5 numbers and 6 called numbers',
       R.until(host, '(function(b){ return !!b && !b.disabled && /Confirm winner/.test(b.textContent) && /Valid/.test(document.getElementById("claimQueue").textContent); })(document.querySelector("#claimQueue button[data-act=confirm]"))', 20) is True, text(host, 'claimQueue'))
    q = text(host, 'claimQueue')
    ok('the claim card reads: Ann, Any 5 numbers, checked by the server against 6 called numbers', 'Ann' in q and PATNAME in q and 'checked by the server against 6 called numbers' in q, q)
    ok('the TV says BINGO? with the claimant\'s name while the host checks (a phone night names the player, not the pattern), no celebration yet', R.until(tv, vis('tvClaim'), 15) is True and text(tv, 'claimName') == 'Ann' and js(tv, vis('tvWin')) is False, [text(tv, 'claimName'), body(tv)])
    tv_shot_both(tv, '05-tv-claim-check')
    # the console at phone widths, with the claim in the queue
    resize(host, 390, 844); js(host, 'var q=document.getElementById("claimQueue"); q.scrollIntoView(); true'); shot(host, '06-console-claim-queue-390')
    resize(host, 375, 667); js(host, 'document.getElementById("claimQueue").scrollIntoView(); true'); shot(host, '06-console-claim-queue-375')
    cf = json.loads(js(host, FITS) or '{}')
    ok('the console at 375 wide with a claim in it has no sideways drift (page %s, phone %s)' % (cf.get('sw'), cf.get('cw')), cf.get('sw', 0) <= cf.get('cw', 0), cf)
    ok('the claim is on the server as pending: pattern custom, rule kept', (lambda c: len(c) == 1 and c[0].get('pattern') == 'custom' and c[0].get('status') == 'pending' and c[0].get('verdict') == 'win')(table('vp_bingo_claims')[claims0:]), table('vp_bingo_claims'))

    # ---- the host confirms
    js(host, 'document.querySelector("#claimQueue button[data-act=confirm]").click(); true'); time.sleep(1.5)
    ok('Ann\'s phone shows YOU WON, with the prize', R.until(pa, vis('vWon'), 15) is True and text(pa, 'wonPrize') == PRIZE, [body(pa)])
    won = text(pa, 'vWon')
    ok('her phone sends her to the HOST, never the bar: "Show this screen to the host to claim"', 'Show this screen to the host to claim' in won and not re.search(r'\bbar\b', won, re.I), won)
    ok('her phone shows the card number the host checks', re.search(r'Card\s*#\d+', won) is not None, won)
    ok('Bob\'s phone says who won: "Ann won Any 5 numbers"', R.until(pb, vis('vLost'), 15) is True and 'Ann won ' + PATNAME in text(pb, 'lostSub'), [text(pb, 'lostSub'), body(pb)])
    ok('the TV celebrates BINGO! naming Any 5 numbers, Ann and the prize', R.until(tv, vis('tvWin'), 15) is True and text(tv, 'winName') == 'Ann' and text(tv, 'winPrizeVal') == PRIZE and PATNAME in body(tv),
       [text(tv, 'winName'), text(tv, 'winPrizeVal'), body(tv)])
    tv_shot_both(tv, '07-tv-winner')
    shot(pa, '08-phone-A-win-390'); shot(pb, '08-phone-B-lost-390')
    fits('phone A win', pa, 390, 844); fits('phone B lost', pb, 390, 844)
    resize(pa, 375, 667); shot(pa, '08-phone-A-win-375x667'); fits('phone A win', pa, 375, 667)
    resize(pb, 375, 667); fits('phone B lost', pb, 375, 667)
    resize(host, 390, 844); js(host, 'document.getElementById("claimQueue").scrollIntoView(); true'); shot(host, '09-console-winner-390')
    resize(host, 375, 667); js(host, 'document.getElementById("claimQueue").scrollIntoView(); true'); shot(host, '09-console-winner-375')
    cq = text(host, 'claimQueue')
    ok('the console names the winner: "Ann won Any 5 numbers"', 'Ann won ' + PATNAME in cq, cq)

    # ---- the record
    cl = table('vp_bingo_claims')[claims0:]
    c = cl[0] if cl else {}
    ok('the server\'s claim row: ONE row, pattern custom, status confirmed, verdict win, on Ann\'s ticket', len(cl) == 1 and c.get('pattern') == 'custom' and c.get('status') == 'confirmed' and c.get('verdict') == 'win' and
       c.get('ticket_id') == (by.get('A') or {}).get('id'), cl)
    ok('the custom rule is kept on the claim: {type any, n 5} and the name Any 5 numbers, and the pattern\'s id', (c.get('custom_pattern') or {}).get('rule') == {'type': 'any', 'n': 5} and
       (c.get('custom_pattern') or {}).get('name') == PATNAME and c.get('custom_pattern_id') == pat_row.get('id'), c)
    ok('the claim was made on the sixth ball, Ann\'s fifth number, with 5 winning squares', c.get('balls') == 6 and c.get('last_ball') == a5[4] and len(c.get('winning_cells') or []) == 5, [c.get('balls'), c.get('last_ball'), c.get('winning_cells')])
    ok('Bob has no claim', len(cl) == 1)
    ok('no page threw: the TV, the console, both phones', all(js(s, 'JSON.stringify(window.__errs||[])') == '[]' for s in (tv, host, pa, pb)), [js(s, 'JSON.stringify(window.__errs||[])') for s in (tv, host, pa, pb)])
    R.close(); R_clear()


def R_clear():
    global R
    R = None


def tv_shot_both(tv, name):
    """The TV at 1280x720 and at 1920x1080, the same screen: one TV window, resized."""
    resize(tv, 1280, 720); shot(tv, name + '-1280x720')
    resize(tv, 1920, 1080); shot(tv, name + '-1920x1080')
    resize(tv, 1280, 720)


# ======================================================================================== SCENE 2
def host_only():
    print('\nSCENE 2: host only, no phones: the console on Any 5 numbers, a few balls')
    W = start_rig()
    tv = open_tv()
    host = open_console()
    key, _ = make_pattern(host)
    lobby(host, key)
    ok('with 0 phones the console counts 0 players, no over-plan warning', text(host, 'playerCount') == '0' and not re.search(r'over the|will be charged', body(host), re.I), [text(host, 'playerCount'), body(host)])
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('the night starts with no phones: the console is calling', R.until(host, 'document.getElementById("nextBtn") && document.getElementById("nextBtn").offsetParent!==null', 25) is True, [text(host, 'startBtn'), body(host)])
    for k in range(1, 5):
        ok('ball %d called on the console with no phones' % k, call_ball(host, k) is True, text(host, 'liveCount'))
    ok('the TV shows the board for Any 5 numbers and the prize, with 0 phones', R.until(tv, vis('tvRun'), 20) is True and R.until(tv, 'document.getElementById("tvPattern").textContent.trim()===%s && document.getElementById("tvPrize").textContent.trim()===%s' % (json.dumps(PATNAME), json.dumps(PRIZE)), 15) is True,
       [text(tv, 'tvPattern'), text(tv, 'tvPrize'), body(tv)])
    ok('the TV shows the same 4 called, not behind', R.until(tv, '/\\b4\\s*of\\s*90/i.test(document.body.innerText)', 10) is True, body(tv))
    called = sorted(b['number'] for b in table('vp_bingo_draw_balls') if not b.get('withdrawn_at'))
    ok('the console\'s four balls are on the server\'s record', len(called) == 4, called)
    ok('the claim queue is empty and says so', 'No claims yet' in text(host, 'claimQueue'), text(host, 'claimQueue'))
    shot(tv, '10-tv-host-only-1280x720'); resize(tv, 1920, 1080); shot(tv, '10-tv-host-only-1920x1080')
    ok('no page threw (console, TV) with 0 phones', all(js(s, 'JSON.stringify(window.__errs||[])') == '[]' for s in (tv, host)), [js(s, 'JSON.stringify(window.__errs||[])') for s in (tv, host)])
    R.close(); R_clear()


for scene in (phones_night, host_only):
    try:
        scene()
    except Exception as e:
        import traceback; traceback.print_exc()
        ok('%s ran to the end' % scene.__name__, False, repr(e))
    finally:
        if R: R.close(); R_clear()

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
