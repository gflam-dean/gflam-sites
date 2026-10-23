#!/usr/bin/env python3
"""THE PURCHASE RAFFLE, PLAYED IN REAL BROWSERS AS A VENUE WOULD (migration 115, 22 Oct 2026).

The shipped pages (venueplay/app/purchase-raffle/ and the members screen the venue's TV follows) in
headless Chrome, against the REAL game Worker in jsc (tools/browser-rig/), with a fake database. Played
end to end the way Deepwater Hotel will use it:

  set up     the owner names it, adds the prize, sets the dates, saves; the terms come back written
             from those settings and are on the page
  the bar    a mobile typed on the big keypad, Add entry; a new customer is asked for their details
             (18+ must be ticked; the marketing tick starts unticked); "Thanks Bob, you're in. 1 entry
             so far. Good luck!"; the same mobile again inside a minute is asked ON THE PAGE (never a
             native dialog) whether it is a new purchase, "No" adds nothing, "Yes" adds exactly one;
             a phone-width window shows the same screen with nothing cut off
  entries    the list shows every person, masked mobiles only, counts right
  the draw   close entries, Draw, the winner card shows who to ring; the TV, on its own window,
             switches to the reveal: first name and last initial, the last three digits, never the
             whole mobile
  no errors  no page threw anything along the way

Set VP_SHOTS=<folder> to keep screenshots of every scene.

    python3 tools/purchase-raffle-in-chrome.test.py
"""
import json, os, sys, time

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

R = rig.Rig()
W = R.W
def line(obj):
    with W.lock:
        W.p.stdin.write(json.dumps(obj) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())
VENUE = W.info['venue']
# The Worker's clock is the browser's clock, so "entries close now" means the same moment on both sides.
def now_ms(): return int(time.time() * 1000)
line({'now': now_ms()})
import datetime, zoneinfo
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Australia/Sydney')).strftime('%Y-%m-%d')
line({'seed': 'vp_venues', 'replace': True, 'rows': [{'id': VENUE, 'name': 'Deepwater Hotel', 'slug': W.info['slug'], 'status': 'active',
      'join_code': W.info['code'], 'au_state': 'NSW', 'timezone': 'Australia/Sydney', 'purchase_raffle_on': True, 'max_players': 100}]})
line({'seed': 'vp_venue_staff', 'rows': [{'id': 'staff-1', 'display_name': 'Sarah'}]})
for t in ('vp_purchase_raffles', 'vp_purchase_raffle_entrants', 'vp_purchase_raffle_entries', 'vp_purchase_raffle_draws', 'vp_admin_audit'):
    line({'seed': t, 'rows': [], 'replace': True})
R.db['vp_venues'][0].update({'name': 'Deepwater Hotel', 'timezone': 'Australia/Sydney', 'au_state': 'NSW'})

def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def click(sid, sel): return js(sid, '(function(){var e=document.querySelector(%s); if(!e) return "missing"; e.click(); return true;})()' % json.dumps(sel))
def setv(sid, sel, v): return js(sid, '(function(){var e=document.querySelector(%s); if(!e) return "missing"; e.value=%s; e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return true;})()' % (json.dumps(sel), json.dumps(v)))
def visible(sel): return '(function(){var e=document.querySelector(%s); return !!e && e.getBoundingClientRect().width>0 && getComputedStyle(e).display!=="none";})()' % json.dumps(sel)
def text(sid, sel): return js(sid, '(function(){var e=document.querySelector(%s); return e?e.textContent.trim():null;})()' % json.dumps(sel))
def shot(sid, name):
    if SHOTS: time.sleep(0.4); R.shot(sid, os.path.join(SHOTS, name))
def keypad(sid, digits):
    for d in digits: click(sid, '.key[data-k="%s"]' % d)
def errs(sid): return js(sid, 'JSON.stringify(window.__errs||[])')

try:
    print('set up: the owner starts the raffle and the terms come back from the settings')
    tid, sid = R.open('/app/purchase-raffle/', width=1180, height=860)
    ok('the page loads with the switch on and no raffle yet', R.until(sid, visible('#noRaffle'), 60) is True, text(sid, 'body'))
    click(sid, '#tabs button[data-tab="setup"]')
    ok('the Set up tab is there for the owner', R.until(sid, visible('#tab-setup'), 10) is True)
    ok('the end date defaults to six months after the start', js(sid, '(function(){var a=document.getElementById("sStart").value,b=document.getElementById("sEnd").value; var x=new Date(a),y=new Date(b); return (y.getFullYear()*12+y.getMonth())-(x.getFullYear()*12+x.getMonth())===6;})()') is True)
    setv(sid, '#sName', 'Summer Purchase Raffle')
    setv(sid, '#sStart', TODAY); setv(sid, '#sEnd', '2027-04-23'); setv(sid, '#sDrawOn', '2027-04-24'); setv(sid, '#sDrawTime', '19:30')
    setv(sid, '#prizes .pt', 'Trip for two to Fiji'); setv(sid, '#prizes .pv', '5000')
    click(sid, '#addPrize'); setv(sid, '#prizes .prize:nth-child(2) .pt', '$500 bar tab'); setv(sid, '#prizes .prize:nth-child(2) .pv', '500')
    setv(sid, '#sPlace', 'the main bar at Deepwater Hotel')
    click(sid, '#saveBtn')
    ok('saving writes the terms onto the page', R.until(sid, '/one entry/.test(document.getElementById("termsBox").textContent)', 20) is True, text(sid, '#setupMsg'))
    terms = text(sid, '#termsBox') or ''
    ok('the terms say one entry per purchase, 18 or over, the draw place and time, and both prizes',
       'Each purchase transaction' in terms and '18 or over' in terms and 'main bar at Deepwater Hotel' in terms and '7:30' in terms
       and 'Fiji' in terms and 'bar tab' in terms, terms[:500])
    shot(sid, '03-setup-tablet.jpg')

    print('the bar: a new customer, then one tap a purchase')
    click(sid, '#tabs button[data-tab="bar"]')
    ok('the bar screen shows the raffle and the keypad', R.until(sid, visible('#keypad') + ' && ' + visible('#barReady'), 15) is True)
    keypad(sid, '0412345678')
    ok('the mobile is laid out as a mobile', js(sid, 'document.getElementById("phoneIn").value') == '0412 345 678', js(sid, 'document.getElementById("phoneIn").value'))
    ok('Add entry is ready once the number is whole', js(sid, '!document.getElementById("addBtn").disabled') is True)
    shot(sid, '01-bar-tablet-typing.jpg')
    click(sid, '#addBtn')
    ok('a new mobile opens the details form', R.until(sid, visible('#stepNew'), 15) is True, text(sid, '#barMsg'))
    ok('the marketing tick starts UNticked', js(sid, 'document.getElementById("nOpt").checked') is False)
    setv(sid, '#nFirst', 'Bob'); setv(sid, '#nLast', 'Smith'); setv(sid, '#nEmail', 'bob@example.com')
    click(sid, '#newSave')
    ok('without the 18+ tick nothing is added and it says why', R.until(sid, '/18 or over/.test(document.getElementById("newMsg").textContent)', 5) is True and not line({'table': 'vp_purchase_raffle_entries'})['body'])
    click(sid, '#nAge')
    shot(sid, '02-bar-new-customer-tablet.jpg')
    click(sid, '#newSave')
    ok('the confirm reads "Thanks Bob, you\'re in" with the count',
       R.until(sid, visible('#stepDone'), 15) is True and text(sid, '#doneBig') == "Thanks Bob, you're in" and text(sid, '#doneSmall') == '1 entry so far. Good luck!', [text(sid, '#doneBig'), text(sid, '#doneSmall')])
    ents = line({'table': 'vp_purchase_raffle_entrants'})['body']
    ok('stored once, as +61412345678, marketing false because nobody ticked it', len(ents) == 1 and ents[0]['phone'] == '+61412345678' and ents[0]['marketing_opt_in'] is False, ents)
    shot(sid, '04-bar-thanks-tablet.jpg')
    click(sid, '#doneNext')
    keypad(sid, '0412345678'); click(sid, '#addBtn')
    ok('the same mobile inside a minute is asked on the page, not with a native dialog', R.until(sid, visible('#vpAsk'), 10) is True, errs(sid))
    shot(sid, '05-bar-add-another-tablet.jpg')
    click(sid, '#vpAskCancel')
    time.sleep(0.6)
    ok('"No" adds nothing', len(line({'table': 'vp_purchase_raffle_entries'})['body']) == 1)
    click(sid, '#addBtn'); R.until(sid, visible('#vpAsk'), 10); click(sid, '#vpAskGo')
    ok('"Yes, a new purchase" adds exactly one', R.until(sid, visible('#stepDone'), 15) is True and text(sid, '#doneSmall') == '2 entries so far. Good luck!' and len(line({'table': 'vp_purchase_raffle_entries'})['body']) == 2, text(sid, '#doneSmall'))
    entries = line({'table': 'vp_purchase_raffle_entries'})['body']
    ok('every entry names the staff login that added it', all(e.get('created_by') == 'host:staff-1' and e.get('created_by_name') == 'Sarah' for e in entries), entries)

    # A room's worth of customers, through the real route, so the list and the draw have something in them.
    people = [('0400111222', 'Ann', 'Lee', True, 4), ('0400333444', 'Chris', 'Nguyen', False, 7), ('0400555666', 'Dana', 'Kelly', True, 2),
              ('0400777888', 'Eli', 'Brown', False, 1), ('0400999000', 'Fran', 'Walsh', True, 3)]
    for ph, f, l, opt, k in people:
        for i in range(k):
            body = {'venue_id': VENUE, 'raffle_id': ents[0]['raffle_id'], 'phone': ph, 'again': True}
            if i == 0: body['person'] = {'first_name': f, 'last_name': l, 'email': f.lower() + '@example.com', 'marketing_opt_in': opt, 'age_confirmed': True}
            W.ask('POST', '/host/praffle/enter', body)
    click(sid, '#doneNext')
    js(sid, 'void 0')

    print('a phone at the bar: the same screen, nothing cut off')
    tid2, sid2 = R.open('/app/purchase-raffle/', width=390, height=844)
    ok('the bar screen loads on a phone', R.until(sid2, visible('#keypad'), 60) is True)
    keypad(sid2, '04003334')
    ok('nothing is wider than the phone', js(sid2, 'document.documentElement.scrollWidth<=window.innerWidth+1') is True, js(sid2, 'document.documentElement.scrollWidth'))
    ok('the keypad keys are big enough for a thumb', js(sid2, 'document.querySelector(".key").getBoundingClientRect().height>=56') is True)
    shot(sid2, '06-bar-phone.jpg')
    line({'now': now_ms() + 120000})   # two minutes after the seeded entries, so this is a new purchase, not a double tap
    keypad(sid2, '44'); click(sid2, '#addBtn')
    ok('a known customer is one tap: "Thanks Chris, you\'re in. 8 entries"', R.until(sid2, visible('#stepDone'), 15) is True and text(sid2, '#doneSmall') == '8 entries so far. Good luck!', [text(sid2, '#doneBig'), text(sid2, '#doneSmall'), text(sid2, '#barMsg')])
    shot(sid2, '07-bar-phone-thanks.jpg')
    ok('no errors on the phone', errs(sid2) == '[]', errs(sid2))
    line({'now': now_ms()})
    R.close_tab(tid2)

    print('the entries list: masked mobiles, the right counts')
    js(sid, 'location.reload()'); time.sleep(1)
    R.until(sid, visible('#barReady'), 60)
    click(sid, '#tabs button[data-tab="list"]')
    ok('six people listed', R.until(sid, 'document.querySelectorAll("#listRows tr").length===6', 15) is True, text(sid, '#listRows'))
    rows = text(sid, '#listRows') or ''
    ok('no whole mobile on the page', '0412345678' not in rows and '0412 345 678' not in rows and '04xx xxx 678' in rows, rows[:300])
    counts = js(sid, 'JSON.stringify([].map.call(document.querySelectorAll("#listRows tr"),function(t){return [t.cells[0].textContent,t.cells[2].textContent];}))')
    ok('Chris has 8 entries, Bob 2', '["Chris Nguyen","8"]' in (counts or '') and '["Bob Smith","2"]' in (counts or ''), counts)
    ok('the totals are 6 people and 20 entries', text(sid, '#lsPeople') == '6' and text(sid, '#lsEntries') == '20', [text(sid, '#lsPeople'), text(sid, '#lsEntries')])
    shot(sid, '08-entries-list-tablet.jpg')

    print('the draw: close entries, draw on the server, the TV shows the reveal')
    # The venue's ONE TV link, sitting on the ads, as it is on the wall.
    ttid, tsid = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    R.until(tsid, 'document.readyState==="complete"', 30); time.sleep(2)
    click(sid, '#tabs button[data-tab="setup"]'); R.until(sid, visible('#closeBtn'), 10)
    click(sid, '#closeBtn'); R.until(sid, visible('#vpAsk'), 10); click(sid, '#vpAskGo')
    time.sleep(1)
    click(sid, '#tabs button[data-tab="draw"]')
    ok('Draw is ready once entries are closed', R.until(sid, '!document.getElementById("drawBtn").disabled', 15) is True, text(sid, '#drawWarn'))
    ok('the button names the first prize', 'Trip for two to Fiji' in (text(sid, '#drawBtn') or ''), text(sid, '#drawBtn'))
    time.sleep(1.5)
    click(sid, '#drawBtn'); R.until(sid, visible('#vpAsk'), 10); click(sid, '#vpAskGo')
    # /tv keeps itself on the wall and shows a game screen in its own frame (#gameFrame), so fullscreen
    # holds. Everything the room sees during the draw is inside that frame.
    FRAME = ('(function(){var f=document.getElementById("gameFrame"); if(!f||f.style.display==="none"||!/\\/app\\/members\\/screen/.test(f.src||"")) return null;'
             ' var d=f.contentDocument; if(!d||!d.body) return null; var w=f.contentWindow;'
             ' function vis(id){var e=d.getElementById(id); return !!e && e.getBoundingClientRect().width>0 && w.getComputedStyle(e).display!=="none";}'
             ' function txt(id){var e=d.getElementById(id); return e?e.textContent.trim():"";}'
             ' return (%s);})()')
    def tv(expr): return FRAME % expr
    ok('the TV on /tv brings the draw up by itself: masked mobile endings spinning, or the reveal already up',
       R.until(tsid, tv('(vis("tvDraw") && /^04xx xxx \\d{3}$/.test(txt("tvSpin"))) || d.getElementById("tvWinNum").classList.contains("isname")'), 40) is True,
       js(tsid, '(function(){var f=document.getElementById("gameFrame"); return f?[f.style.display,f.src].join(" "):"no frame";})()'))
    if js(tsid, tv('vis("tvDraw")')) is True: shot(tsid, '09-tv-drawing.jpg')
    # And while it spins, every frame is a masked ending: sampled across the spin, never a whole number.
    spins = []
    for _ in range(8):
        v = js(tsid, tv('vis("tvDraw") ? txt("tvSpin") : ""'))
        if v: spins.append(v)
        time.sleep(0.35)
    ok('the spin on the wall only ever shows 04xx xxx and three digits', len(spins) >= 2 and all(__import__('re').match(r'^04xx xxx \d{3}$', x) for x in spins), spins)
    ok('the winner card comes up on the venue page', R.until(sid, visible('#winnerCard'), 25) is True, text(sid, '#drawMsg'))
    wname = text(sid, '#wName')
    draws = line({'table': 'vp_purchase_raffle_draws'})['body'] or [{}]
    ok('one draw recorded on the server, for prize 1', len(draws) == 1 and draws[0]['prize_index'] == 0 and draws[0]['entries_total'] == 20, draws)
    ok('the page names the recorded winner, with a phone number and email to ring', wname == draws[0]['winner_name'] and '@example.com' in (text(sid, '#wContact') or ''), [wname, text(sid, '#wContact')])
    shot(sid, '10-draw-winner-tablet.jpg')
    ok('the TV shows the same winner', R.until(tsid, tv('vis("tvWin") && txt("tvWinNum")===%s' % json.dumps(wname)), 30) is True, js(tsid, tv('txt("tvWin")')))
    R.until(tsid, tv('vis("tvWinName")'), 8); time.sleep(0.8)
    tvtext = js(tsid, tv('txt("tvWin")')) or ''
    ok('the TV gives the last three digits, the entries and the prize', ('Mobile ending ' + str(draws[0].get('phone_last3'))) in tvtext and 'entr' in tvtext and 'Fiji' in tvtext, tvtext)
    ok('the TV never shows a whole mobile', not any(p[0][1:] in tvtext.replace(' ', '') for p in people) and '412345678' not in tvtext.replace(' ', ''), tvtext)
    shot(tsid, '11-tv-winner.jpg')
    ok('no errors on the venue page', errs(sid) == '[]', errs(sid))
    ok('no errors on the TV', errs(tsid) == '[]', errs(tsid))
finally:
    R.close()

print('')
print('%d of %d checks passed' % (ran - bad, ran))   # the shape release-check.py reads
sys.exit(1 if bad else 0)
