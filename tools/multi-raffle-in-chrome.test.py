#!/usr/bin/env python3
"""TWO RAFFLES IN ONE NIGHT, PLAYED IN REAL BROWSERS (Dean, 24 Oct 2026; migration 117).

The shipped raffle console (venueplay/app/raffle/host.html) and the raffle TV (raffle/screen.html), each
in its own headless Chrome window, against the REAL game Worker in jsc (tools/browser-rig/), with a fake
database. Your account > Draws (making the raffles and filing their prizes) is played in
tools/account-structure-in-chrome.test.py; this is the night itself:

  two raffles   the console asks which raffle, picks tonight's (the one drawn today) by itself, and shows
                only that raffle's saved prizes; the TV names it ("Chook Raffle tonight"); a prize drawn
                and claimed; changing to the other raffle part way asks on the page, starts it fresh,
                shows ITS prizes (the first raffle also has the prizes saved before raffles had a list),
                a new prize typed there is filed under it; drawn and claimed; End game asks, closes the
                night (the venue is not live) and the TV goes back to the venue's ads
  one raffle    no question about which raffle, every saved prize, the TV card names no raffle (the new look,
                6 Nov 2026: RAFFLE is in the title line; GET YOUR TICKETS and the prizes, nothing over them)
                exactly as before, and a new prize is filed with no raffle
  no errors     no page threw anything along the way

Set VP_SHOTS=<folder> to keep screenshots.

    python3 tools/multi-raffle-in-chrome.test.py
"""
import datetime, json, os, sys, time, zoneinfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)

# The console picks the raffle drawn TODAY by itself; the browser's today, in its own words.
WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
TODAY = WEEKDAYS[datetime.datetime.now(zoneinfo.ZoneInfo('Australia/Brisbane')).weekday()]
OTHER = WEEKDAYS[(WEEKDAYS.index(TODAY) + 3) % 7]
R = None


def stand_up(raffles, prizes):
    """A fresh rig (new Worker, new database, new Chrome) with the venue's raffle list and saved prizes."""
    global R
    if R: R.close()
    R = rig.Rig(host_pages=('/app/raffle/host.html',))
    W = R.W
    W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': 'raffle', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None,
                                'raffle': ({k: raffles[0][k] for k in ('label', 'day', 'time')} if raffles else None),
                                'raffles': raffles}], replace=True)
    R.db['vp_raffle_prizes'] = [dict(p, venue_id=W.info['venue'], id='p%d' % i, created_at='2026-10-%02dT00:00:00Z' % (20 - i)) for i, p in enumerate(prizes)]
    W.seed('vp_raffle_prizes', R.db['vp_raffle_prizes'], replace=True)
    return W


def table(W, name):
    """The Worker's fake database, read back (worker-stdio.js answers {table})."""
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def shot(sid, name):
    if SHOTS: time.sleep(0.5); R.shot(sid, os.path.join(SHOTS, name))
def errs(sid): return js(sid, 'JSON.stringify(window.__errs||[])')
def live(W): return W.ask('GET', '/play/live?code=' + W.info['code'], {}, {})['body'].get('live') is True
def until_live(W, want, secs=10):
    t = time.time() + secs
    while time.time() < t:
        if live(W) == want: return True
        time.sleep(0.3)
    return False
PRESETS = '[].map.call(document.querySelectorAll("#prizePresets button"),function(b){return b.textContent;}).join("|")'
PICKS = '[].map.call(document.querySelectorAll("#rafflePick button"),function(b){return (b.classList.contains("on")?"*":"")+b.textContent;}).join("|")'
# The TV is the venue's own /tv, which puts the raffle screen up in its game frame when the raffle goes
# on air; what the room sees is read inside that frame.
def F(expr):
    return ('(function(){var f=document.getElementById("gameFrame"); var d=f && f.style.display!=="none" && f.contentDocument;'
            ' if(!d || !d.body) return ""; return (%s);})()' % expr)
EYE = F('(d.getElementById("idleEye")||{}).textContent||""')
TVTEXT = F('d.body.innerText')
TVPRIZES = F('(d.getElementById("idlePrizes")||{}).textContent||""')
# A /tv INSIDE THE TV'S OWN GAME FRAME (12 Nov 2026). End game sends the raffle screen's frame to /tv?venue=, and the
# /tv around it takes the frame down on its load. Before that, the /tv in the frame drew a whole second venue screen,
# joined the game channels and said hello, and the still-open console answered with mode:"raffle": the wall went
# straight back to the raffle (this suite's "back to the ads" check, red 2 of 3 on origin/main 606b3959). Recorded
# from inside that frame by a script Chrome runs before the page's own, so it does not race the teardown.
NEST = r"""(function(){ try{
  if(window===window.top) return; var fe=window.frameElement, top=window.top;
  if(!fe || fe.id!=="gameFrame" || !/^\/tv(\.html)?$/.test(location.pathname)) return;
  top.__nestTv=(top.__nestTv||0)+1;
  var po=BroadcastChannel.prototype.postMessage;
  BroadcastChannel.prototype.postMessage=function(d){ var p=d&&d.payload; if(p&&p.t==="tv_here") top.__nestHello=(top.__nestHello||0)+1; return po.apply(this,arguments); };
  function look(){ if(document.getElementById("tvFsBtn")) top.__nestDrawn=1; }
  document.addEventListener("DOMContentLoaded", look); window.addEventListener("pagehide", look);
}catch(e){} })();"""


def draw_and_claim(host, tv, prize):
    """Draw, accept the night's rules if they are asked (the rig's venue is in Queensland), claim."""
    js(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
    for _ in range(20):
        if js(host, 'document.getElementById("winnerCard").classList.contains("show")') is True: break
        js(host, 'var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && /I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); true')
        time.sleep(1)
    ok('the draw for %s puts a winner up on the console' % prize,
       R.until(host, 'document.getElementById("winnerCard").classList.contains("show") && document.getElementById("wcPrize").textContent===%s' % json.dumps(prize), 30) is True,
       js(host, '((document.getElementById("hostErrText")||{}).textContent||"")+" | "+document.getElementById("wcPrize").textContent'))
    ok('and the TV shows the draw for %s' % prize,
       R.until(tv, '/%s/i.test(%s)' % (prize, TVTEXT), 30) is True, js(tv, TVTEXT))
    R.until(host, '!document.getElementById("claimBtn").disabled && document.getElementById("claimBtn").offsetParent!==null', 20)
    js(host, 'document.getElementById("claimBtn").click(); true')
    ok('claimed: the results list has %s' % prize,
       R.until(host, '/%s/.test(document.getElementById("winnersBody").textContent) && /Collected/.test(document.getElementById("winnersBody").textContent)' % prize, 20) is True,
       js(host, 'document.getElementById("winnersBody").textContent'))


try:
    print('TWO RAFFLES: tonight\'s is picked, each shows its own prizes, both drawn, End game closes the night')
    W = stand_up([{'id': 'raf-meat01', 'label': 'Meat Raffle', 'day': OTHER, 'time': '6:30pm'},
                  {'id': 'raf-chook1', 'label': 'Chook Raffle', 'day': TODAY, 'time': '3pm'}],
                 [{'label': 'Meat tray', 'raffle_id': 'raf-meat01'}, {'label': 'Old prize', 'raffle_id': None},
                  {'label': 'Two chooks', 'raffle_id': 'raf-chook1'}])
    ttid, tv = R.open('/tv?venue=' + W.info['slug'], before=NEST, width=1280, height=720)
    htid, host = R.open('/app/raffle/host.html', width=1000, height=1100)
    ok('the console loads, signed in, on the raffle setup', R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True,
       js(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    # 12 Nov 2026 (INBOX 286): opening the console no longer takes the TV; the host puts the raffle on it
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('"Which raffle are you drawing?" shows both raffles, and tonight\'s (drawn %s) is picked by itself' % TODAY,
       R.until(host, '!document.getElementById("raffleField").classList.contains("hidden") && document.querySelectorAll("#rafflePick button").length===2', 20) is True
       and js(host, PICKS) == 'Meat Raffle · %s|*Chook Raffle · %s' % (OTHER, TODAY), js(host, PICKS))
    ok('the saved prizes are Chook Raffle\'s only', R.until(host, PRESETS + '==="Two chooks"', 10) is True, js(host, PRESETS))
    ok('the TV names the raffle on its card: "Chook Raffle tonight"', R.until(tv, EYE + '==="Chook Raffle tonight"', 30) is True, js(tv, EYE))
    shot(host, 'host-two-raffles.jpg'); shot(tv, 'tv-chook.jpg')
    js(host, 'document.querySelector("#prizePresets button").click(); true')
    ok('tapping the saved prize puts it on tonight\'s list', R.until(host, '/Two chooks/.test(document.getElementById("prizeList").textContent)', 10) is True)
    ok('and the TV lists it as tonight\'s prize under the raffle\'s name',
       R.until(tv, '/Two chooks/.test(' + TVPRIZES + ') && ' + EYE + '==="Chook Raffle tonight"', 20) is True, js(tv, EYE))
    draw_and_claim(host, tv, 'Two chooks')

    js(host, 'document.querySelector(\'#rafflePick button[data-raffle="raf-meat01"]\').click(); true')
    ok('changing to Meat Raffle with a ticket drawn asks on the page first',
       R.until(host, '!!document.getElementById("vpAsk") && /Change to Meat Raffle/.test(document.getElementById("vpAsk").textContent)', 10) is True,
       js(host, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
    js(host, 'document.getElementById("vpAskCancel").click(); true')
    ok('Cancel keeps Chook Raffle and its prize list', R.until(host, '!document.getElementById("vpAsk")', 5) is True and js(host, PICKS).endswith('*Chook Raffle · ' + TODAY)
       and js(host, '/Two chooks/.test(document.getElementById("prizeList").textContent)') is True, js(host, PICKS))
    js(host, 'document.querySelector(\'#rafflePick button[data-raffle="raf-meat01"]\').click(); true')
    R.until(host, '!!document.getElementById("vpAsk")', 10); js(host, 'document.getElementById("vpAskGo").click(); true')
    ok('Yes: Meat Raffle is picked, a fresh raffle (no prizes on tonight\'s list)',
       R.until(host, '!document.getElementById("vpAsk") && /^\\*Meat Raffle/.test(' + PICKS + ') && document.getElementById("prizeList").children.length===0', 10) is True, js(host, PICKS))
    ok('the saved prizes are Meat Raffle\'s, with the prize saved before raffles had a list (it is the first raffle)',
       R.until(host, PRESETS + '==="Meat tray|Old prize"', 10) is True, js(host, PRESETS))
    js(host, 'document.getElementById("rfPrize").value="Seafood platter"; document.getElementById("addPrizeBtn").click(); true')
    R.until(host, '/Seafood platter/.test(document.getElementById("prizeList").textContent)', 10)
    t = time.time() + 15; filed = []
    while time.time() < t:
        filed = [p for p in table(W, 'vp_raffle_prizes') if p.get('label') == 'Seafood platter']
        if filed: break
        time.sleep(0.4)
    ok('a prize typed on Meat Raffle is saved for next week, filed under Meat Raffle', len(filed) == 1 and filed[0].get('raffle_id') == 'raf-meat01', filed)
    ok('the TV now names Meat Raffle (after the last winner\'s celebration)', R.until(tv, EYE + '==="Meat Raffle tonight"', 60) is True, js(tv, EYE))
    shot(host, 'host-meat.jpg'); shot(tv, 'tv-meat.jpg')
    draw_and_claim(host, tv, 'Seafood platter')
    ok('CONTROL: the raffle is up on the TV before End game', js(tv, 'document.getElementById("gameFrame").style.display!=="none"') is True)
    ok('CONTROL: the night is live before End game', live(W))
    js(host, 'document.getElementById("toAdsBtn").click(); true')
    ok('End game asks on the page', R.until(host, '!!document.getElementById("vpAsk") && /End this raffle/.test(document.getElementById("vpAsk").textContent)', 10) is True)
    js(host, 'document.getElementById("vpAskGo").click(); true')
    ok('End game closes the night: the venue is not live', until_live(W, False, 20), 'still live')
    ok('and the TV goes back to the venue\'s ads (the game frame comes down)', R.until(tv, 'document.getElementById("gameFrame").style.display==="none"', 30) is True,
       js(tv, 'document.getElementById("gameFrame").style.display+" "+document.getElementById("gameFrame").src'))
    time.sleep(1.0)
    ok('the /tv the raffle screen sends its frame to stops at once: no second venue screen drawn, no hello on any game channel',
       R.until(tv, '(window.__nestTv||0)>=1', 10) is True and js(tv, '!window.__nestDrawn && !window.__nestHello') is True,
       js(tv, 'JSON.stringify([window.__nestTv||0, window.__nestDrawn||0, window.__nestHello||0])'))
    ok('no script error on the console or the TV', errs(host) == '[]' and errs(tv) in ('[]', 'HUNG', None), [errs(host), errs(tv)])
    R.close_tab(htid); R.close_tab(ttid)

    print('\nONE RAFFLE: the console and the TV exactly as before')
    W = stand_up([{'id': 'raf-only01', 'label': 'Meat Raffle', 'day': 'Friday', 'time': '6:30pm'}],
                 [{'label': 'Meat tray', 'raffle_id': 'raf-only01'}, {'label': 'Old prize', 'raffle_id': None}])
    ttid, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    htid, host = R.open('/app/raffle/host.html', width=1000, height=1100)
    R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60)
    # 12 Nov 2026 (INBOX 286): opening the console no longer takes the TV; the host puts the raffle on it
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    ok('every saved prize shows', R.until(host, PRESETS + '==="Meat tray|Old prize"', 20) is True, js(host, PRESETS))
    time.sleep(1.5)   # /screen has answered by now (the presets wait on the same boot)
    ok('no "Which raffle" question', js(host, 'document.getElementById("raffleField").classList.contains("hidden") && document.querySelectorAll("#rafflePick button").length===0') is True,
       js(host, PICKS))
    js(host, 'document.querySelector("#prizePresets button").click(); true')
    ok('the TV card names no raffle over GET YOUR TICKETS (RAFFLE is in the title line)', R.until(tv, '/Meat tray/.test(' + TVPRIZES + ')', 30) is True and js(tv, EYE) == '', js(tv, EYE))
    shot(host, 'host-one-raffle.jpg'); shot(tv, 'tv-one-raffle.jpg')
    js(host, 'document.getElementById("rfPrize").value="Bar tab"; document.getElementById("addPrizeBtn").click(); true')
    t = time.time() + 15; filed = []
    while time.time() < t:
        filed = [p for p in table(W, 'vp_raffle_prizes') if p.get('label') == 'Bar tab']
        if filed: break
        time.sleep(0.4)
    ok('a new prize is saved with no raffle, as before', len(filed) == 1 and not filed[0].get('raffle_id'), filed)
    draw_and_claim(host, tv, 'Meat tray')
    ok('no script error on the console or the TV', errs(host) == '[]' and errs(tv) in ('[]', 'HUNG', None), [errs(host), errs(tv)])
    R.close_tab(htid); R.close_tab(ttid)
finally:
    if R: R.close()

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
