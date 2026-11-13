#!/usr/bin/env python3
"""THE PURCHASE RAFFLE, WALKED END TO END AS DEEPWATER'S STAFF WILL USE IT (13 Nov 2026, INBOX 354b).

Real Chrome, the shipped pages (venueplay/app/purchase-raffle/ and the TV at /tv), the REAL game Worker in jsc
(tools/browser-rig/), a fake database. Two bar phones (390x844 and 375x812), a tablet for the owner, two TVs
(1280x720 and 1920x1080) watching the wall.

  set up       cap of 2 entries a day, two prizes; the terms come back and say nothing per drink / per amount
  look up      a mobile nobody has used: "not in the raffle yet"; Bob after his first purchase: "Bob S. has 1 entry
               so far. Nothing was added." (Stewart: "thanks Bob, good luck", the staff look tickets up by mobile)
  purchases    Bob on phone 1, Ann on phone 2; a second purchase for Bob (cumulative, 2); a third the same day is
               refused by the daily cap with a plain message and nothing is added
  undo         Ann's entry taken back from the thanks screen; it stops counting, frees her day, she can be added again
  the list     masked mobiles, search by last digits, nothing wider than a phone
  opt-in file  the download button hands the browser a CSV and says how many
  the draw     close entries, draw prize 1 (weighted, server side), winner card, both TVs show the reveal with
               first name + last initial and never a whole mobile; the winner is redrawn with a reason (the claim
               route when nobody answers); prize 2 is drawn to a DIFFERENT person
  wording      no page says entries are earned per drink or by what is spent (NSW)

Screenshots: VP_SHOTS=<folder>, or on the test server /home/vp/venue-enrich/reports/purchase-raffle-walk.

    python3 tools/purchase-raffle-walk-in-chrome.test.py
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

SHOTS = os.environ.get('VP_SHOTS', '') or ('/home/vp/venue-enrich/reports/purchase-raffle-walk' if os.path.isdir('/home/vp/venue-enrich/reports') else '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)

R = rig.Rig()
W = R.W
def line(obj):
    with W.lock:
        W.p.stdin.write(json.dumps(obj) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())
VENUE = W.info['venue']
OFFSET = [0]
def set_clock(extra_ms=0):
    OFFSET[0] = extra_ms
    line({'now': int(time.time() * 1000) + extra_ms})
set_clock(0)
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
    if SHOTS: time.sleep(0.5); R.shot(sid, os.path.join(SHOTS, name))
def keypad(sid, digits):
    for d in digits: click(sid, '.key[data-k="%s"]' % d)
def errs(sid): return js(sid, 'JSON.stringify(window.__errs||[])')
def table(t): return line({'table': t})['body'] or []
def fits(sid): return js(sid, 'document.documentElement.scrollWidth<=window.innerWidth+1') is True
def ask_yes(sid):
    R.until(sid, visible('#vpAsk'), 10); click(sid, '#vpAskGo')
def type_mobile(sid, m):
    click(sid, '.key[data-k="clear"]'); keypad(sid, m)

BOB, ANN = '0412345678', '0412000111'
try:
    # ---------------- set up (the owner, on a tablet) ----------------
    print('set up: cap of 2 a day, two prizes, the terms')
    tid, sid = R.open('/app/purchase-raffle/', width=1180, height=860)
    ok('the page loads with the switch on and no raffle yet', R.until(sid, visible('#noRaffle'), 60) is True, text(sid, 'body'))
    click(sid, '#tabs button[data-tab="setup"]')
    R.until(sid, visible('#tab-setup'), 10)
    setv(sid, '#sName', 'Summer Purchase Raffle')
    setv(sid, '#sStart', TODAY); setv(sid, '#sEnd', '2027-04-23'); setv(sid, '#sDrawOn', '2027-04-24'); setv(sid, '#sDrawTime', '19:30')
    setv(sid, '#prizes .pt', 'Trip for two to Fiji'); setv(sid, '#prizes .pv', '5000')
    click(sid, '#addPrize'); setv(sid, '#prizes .prize:nth-child(2) .pt', '$500 bar tab'); setv(sid, '#prizes .prize:nth-child(2) .pv', '500')
    setv(sid, '#sCap', '2'); setv(sid, '#sPlace', 'the main bar at Deepwater Hotel')
    click(sid, '#saveBtn')
    ok('saving writes the terms', R.until(sid, '/one entry/.test(document.getElementById("termsBox").textContent)', 20) is True, text(sid, '#setupMsg'))
    terms = text(sid, '#termsBox') or ''
    ok('the terms carry the cap: no more than 2 entries a day', 'no more than 2 entries a day' in terms, terms[:600])
    ok('NSW: the terms say a purchase is one entry, not per drink or by the amount, and no alcohol is needed',
       'Each purchase transaction' in terms and 'not earned per drink' in terms and 'no purchase of alcohol is needed' in terms, terms[:700])
    stripped = re.sub(r'Entries are not earned per drink or by the amount of alcohol bought, and no purchase of alcohol is needed to enter\.', '', terms)
    ok('NSW: nothing else in the terms ties an entry to a drink, a dollar or an amount of alcohol',
       not re.search(r'per drink|per \$|for every \$|each drink|per glass|per schooner|per standard|for each \$|amount of alcohol|every \$', stripped, re.I), stripped[:500])
    ok('the terms never say "free"', not re.search(r'\bfree\b', terms, re.I), terms[:300])
    shot(sid, '01-setup-tablet-1180.jpg')

    # ---------------- two bar phones ----------------
    print('two bar phones: look up, new customers, a second purchase, the daily cap')
    t1, p1 = R.open('/app/purchase-raffle/', width=390, height=844)
    t2, p2 = R.open('/app/purchase-raffle/', width=375, height=812)
    for s in (p1, p2): R.until(s, visible('#keypad') + ' && ' + visible('#barReady'), 60)
    for nm, s in (('phone 1 (390)', p1), ('phone 2 (375)', p2)):
        ok(nm + ': the bar screen fits the phone', fits(s), js(s, 'document.documentElement.scrollWidth'))
        ok(nm + ': there is a Look up button for staff', js(s, visible('#lookBtn')) is True)
    # NOTHING THE STAFF NEED SITS BELOW THE FOLD (13 Nov 2026): Add entry was cut off at the bottom of a 375x812 screen
    # and the message about a refused entry sat under it, out of sight.
    for nm, s2 in (('phone 1 (390x844)', p1), ('phone 2 (375x812)', p2)):
        type_mobile(s2, '0499999999')
        g = js(s2, '(function(){function b(i){return document.getElementById(i).getBoundingClientRect().bottom;} return {add:b("addBtn"),look:b("lookBtn"),key:b("keypad"),h:innerHeight,sy:scrollY};})()') or {}
        ok(nm + ': keypad, Look up and Add entry are all on the first screen, no scrolling', g.get('add', 9999) <= g.get('h', 0) and g.get('look', 9999) <= g.get('h', 0), g)
        ok(nm + ': the Clear key keeps its small label, not the 24px digit size', js(s2, 'parseFloat(getComputedStyle(document.querySelector(".key.fn")).fontSize)<=18') is True, js(s2, 'getComputedStyle(document.querySelector(".key.fn")).fontSize'))
        click(s2, '.key[data-k="clear"]')
    t4, p4 = R.open('/app/purchase-raffle/', width=360, height=740)
    R.until(p4, visible('#keypad') + ' && ' + visible('#barReady'), 60); type_mobile(p4, '0499999999')
    g = js(p4, '(function(){function b(i){return document.getElementById(i).getBoundingClientRect().bottom;} return {add:b("addBtn"),h:innerHeight};})()') or {}
    ok('a small Android (360x740): Add entry is on the first screen', g.get('add', 9999) <= g.get('h', 0), g)
    shot(p4, '02-bar-phone-360-start.jpg'); R.close_tab(t4)
    shot(p1, '02-bar-phone-390-start.jpg'); shot(p2, '02-bar-phone-375-start.jpg')

    type_mobile(p1, BOB)
    click(p1, '#lookBtn')
    ok('look-up of a mobile nobody has used says so, and adds nothing',
       R.until(p1, '/not in the raffle yet/i.test(document.getElementById("barMsg").textContent)', 10) is True and not table('vp_purchase_raffle_entries'), text(p1, '#barMsg'))
    click(p1, '#addBtn')
    R.until(p1, visible('#stepNew'), 15)
    setv(p1, '#nFirst', 'Bob'); setv(p1, '#nLast', 'Smith'); setv(p1, '#nEmail', 'bob@example.com'); click(p1, '#nAge')
    ok('phone 1: the new-customer form fits the phone', fits(p1))
    shot(p1, '03-new-customer-phone-390.jpg')
    click(p1, '#newSave')
    ok('Bob: "Thanks Bob, you\'re in" and 1 entry', R.until(p1, visible('#stepDone'), 15) is True and text(p1, '#doneBig') == "Thanks Bob, you're in" and text(p1, '#doneSmall') == '1 entry so far. Good luck!', [text(p1, '#doneBig'), text(p1, '#doneSmall')])
    shot(p1, '04-thanks-phone-390.jpg')
    click(p1, '#doneNext')
    type_mobile(p1, BOB); click(p1, '#lookBtn')
    ok('look-up by mobile: "Bob S. has 1 entry so far. Nothing was added."',
       R.until(p1, '/Bob S\\.? has 1 entry/.test(document.getElementById("barMsg").textContent)', 10) is True and len(table('vp_purchase_raffle_entries')) == 1, text(p1, '#barMsg'))
    shot(p1, '05-lookup-phone-390.jpg')

    set_clock(120000)    # two minutes on: a new purchase, not a double tap
    keypad(p2, ANN[:0])
    type_mobile(p2, ANN); click(p2, '#addBtn'); R.until(p2, visible('#stepNew'), 15)
    setv(p2, '#nFirst', 'Ann'); setv(p2, '#nLast', 'Lee'); setv(p2, '#nEmail', 'ann@example.com'); click(p2, '#nAge'); click(p2, '#nOpt')
    click(p2, '#newSave')
    ok('Ann on the second phone: in, 1 entry', R.until(p2, visible('#stepDone'), 15) is True and text(p2, '#doneSmall') == '1 entry so far. Good luck!', text(p2, '#doneSmall'))
    shot(p2, '04-thanks-phone-375.jpg')
    ann_entry = [e for e in table('vp_purchase_raffle_entries')][-1]['id']

    click(p2, '#doneNext'); type_mobile(p2, BOB); click(p2, '#addBtn')
    ok('Bob\'s second purchase, on the OTHER phone, is cumulative: 2 entries (one entrant)',
       R.until(p2, visible('#stepDone'), 15) is True and text(p2, '#doneBig') == "Thanks Bob, you're in" and text(p2, '#doneSmall') == '2 entries so far. Good luck!' and len(table('vp_purchase_raffle_entrants')) == 2,
       [text(p2, '#doneSmall'), text(p2, '#barMsg')])
    click(p2, '#doneNext')
    set_clock(240000)
    type_mobile(p2, BOB); click(p2, '#addBtn')
    ok('a third purchase the same day is refused by the cap: says why, nothing added',
       R.until(p2, '/already has 2 entries today/.test(document.getElementById("barMsg").textContent)', 15) is True
       and len([e for e in table('vp_purchase_raffle_entries') if not e.get('voided_at')]) == 3, [text(p2, '#barMsg'), len(table('vp_purchase_raffle_entries'))])
    mb = js(p2, '(function(){var r=document.getElementById("barMsg").getBoundingClientRect(); return {b:r.bottom,t:r.top,h:innerHeight,txt:document.getElementById("barMsg").textContent.length};})()') or {}
    ok('the refusal message is on screen, where staff will see it, not under the fold', 0 <= mb.get('t', -1) and mb.get('b', 9999) <= mb.get('h', 0) and mb.get('txt', 0) > 10, mb)
    shot(p2, '06-cap-phone-375.jpg')
    ok('the cap message fits the phone and the keypad is still usable', fits(p2) and js(p2, '!document.getElementById("phoneIn").disabled') is True)
    click(p1, '#tabs button[data-tab="bar"]')

    # ---------------- undo ----------------
    print('undo: taken back, stops counting, frees the day')
    set_clock(250000)
    type_mobile(p2, ANN); click(p2, '#addBtn')
    R.until(p2, visible('#stepDone'), 15)
    ok('Ann\'s second purchase: 2 entries', text(p2, '#doneSmall') == '2 entries so far. Good luck!', text(p2, '#doneSmall'))
    click(p2, '#doneUndo'); ask_yes(p2)
    ok('Undo on the thanks screen says "Taken back"', R.until(p2, '/Taken back/.test(document.getElementById("doneBig").textContent)', 10) is True, text(p2, '#doneBig'))
    ann_live = [e for e in table('vp_purchase_raffle_entries') if not e.get('voided_at') and e['entrant_id'] == table('vp_purchase_raffle_entrants')[1]['id']]
    ok('the entry is kept on the record as voided, and Ann is back to 1', len(ann_live) == 1 and any(e.get('voided_at') for e in table('vp_purchase_raffle_entries')), [len(ann_live)])
    click(p2, '#doneNext')
    type_mobile(p2, ANN); click(p2, '#lookBtn')
    ok('look-up after undo: "Ann L. has 1 entry"', R.until(p2, '/Ann L\\.? has 1 entry/.test(document.getElementById("barMsg").textContent)', 10) is True, text(p2, '#barMsg'))
    type_mobile(p2, ANN); click(p2, '#addBtn')
    ok('after an undo the day is free again: Ann can be added (2 entries)', R.until(p2, visible('#stepDone'), 15) is True and text(p2, '#doneSmall') == '2 entries so far. Good luck!', [text(p2, '#doneSmall'), text(p2, '#barMsg')])
    click(p2, '#doneNext')
    ok('the recent list shows who added each entry, with an Undo for ones just added', js(p2, 'document.querySelectorAll("#recent li").length>=4 && !!document.querySelector("#recent [data-undo]")') is True, text(p2, '#recent'))
    ok('the recent list shows masked mobiles only', '0412 345 678' not in (text(p2, '#recent') or '') and '0412345678' not in (text(p2, '#recent') or ''), text(p2, '#recent'))
    shot(p2, '07-recent-phone-375.jpg')
    ok('no errors on either phone', errs(p1) == '[]' and errs(p2) == '[]', [errs(p1), errs(p2)])

    # a room's worth of customers so the list and the weighted draw have something in them
    set_clock(300000)
    raffle_id = table('vp_purchase_raffle_entries')[0]['raffle_id']
    for ph, f, l, k in [('0400111222', 'Chris', 'Nguyen', 7), ('0400555666', 'Dana', 'Kelly', 2), ('0400777888', 'Eli', 'Brown', 1)]:
        for i in range(k):
            body = {'venue_id': VENUE, 'raffle_id': raffle_id, 'phone': ph, 'again': True}
            if i == 0: body['person'] = {'first_name': f, 'last_name': l, 'email': f.lower() + '@example.com', 'marketing_opt_in': f != 'Eli', 'age_confirmed': True}
            W.ask('POST', '/host/praffle/enter', body)
    # (the cap of 2 a day stops the bulk adds above past 2 each: the list below counts what the Worker really kept)
    live = [e for e in table('vp_purchase_raffle_entries') if not e.get('voided_at')]
    ok('the cap holds through the route too: nobody has more than 2 entries today', max([len([x for x in live if x['entrant_id'] == p['id']]) for p in table('vp_purchase_raffle_entrants')]) <= 2)

    # ---------------- the list (owner, tablet and phone) ----------------
    print('the entries list')
    js(sid, 'location.reload()'); time.sleep(1); R.until(sid, visible('#barReady'), 60)
    click(sid, '#tabs button[data-tab="list"]')
    ok('five people listed', R.until(sid, 'document.querySelectorAll("#listRows tr").length===5', 15) is True, text(sid, '#listRows'))
    rows = text(sid, '#listRows') or ''
    ok('no whole mobile on the list', BOB not in rows and '0412 345 678' not in rows and '04xx xxx 678' in rows, rows[:300])
    setv(sid, '#searchIn', '111')
    ok('search by the last digits finds Ann', R.until(sid, 'document.querySelectorAll("#listRows tr").length===1 && /Ann Lee/.test(document.getElementById("listRows").textContent)', 10) is True, text(sid, '#listRows'))
    setv(sid, '#searchIn', '')
    shot(sid, '08-list-tablet-1180.jpg')
    t3, p3 = R.open('/app/purchase-raffle/', width=375, height=812)
    R.until(p3, visible('#barReady'), 60); click(p3, '#tabs button[data-tab="list"]')
    R.until(p3, 'document.querySelectorAll("#listRows tr").length>=3', 15)
    ok('the search box tells a phone user what to type without being cut off', js(p3, '(function(){var i=document.getElementById("searchIn"); var c=document.createElement("canvas").getContext("2d"); c.font=getComputedStyle(i).font; return c.measureText(i.placeholder).width < i.clientWidth-24;})()') is True, js(p3, 'document.getElementById("searchIn").placeholder'))
    ok('the list fits a 375 phone', fits(p3), js(p3, 'document.documentElement.scrollWidth'))
    shot(p3, '09-list-phone-375.jpg')
    click(p3, '#tabs button[data-tab="setup"]'); R.until(p3, visible('#tab-setup'), 10)
    ok('the prize name has the whole row on a phone (not a 90px box)', js(p3, 'document.querySelector("#prizes .pt").getBoundingClientRect().width>=250') is True, js(p3, 'document.querySelector("#prizes .pt").getBoundingClientRect().width'))
    ok('the set up tab fits a 375 phone', fits(p3), js(p3, 'document.documentElement.scrollWidth'))
    shot(p3, '10-setup-phone-375.jpg')
    R.close_tab(t3)

    # ---------------- opt-in export ----------------
    print('the opt-in file')
    click(sid, '#tabs button[data-tab="list"]')
    js(sid, '''window.__realFetch=window.fetch; window.fetch=function(u,o){ return Promise.resolve({ json:function(){ return Promise.resolve({ ok:true, count:2, csv:"Venue,Raffle\\nDeepwater Hotel,Summer" }); } }); };
               window.__dl=[]; var oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ window.__dl.push(this.download); };''')
    click(sid, '#exportBtn')
    ok('the download hands the browser a dated CSV and says how many opted in',
       R.until(sid, '/Downloaded 2 people who opted in/.test(document.getElementById("exportMsg").textContent) && window.__dl.length===1 && /^purchase-raffle-opted-in-\\d{4}-\\d\\d-\\d\\d\\.csv$/.test(window.__dl[0])', 10) is True,
       [text(sid, '#exportMsg'), js(sid, 'JSON.stringify(window.__dl)')])

    js(sid, 'window.fetch=window.__realFetch; void 0')

    # ---------------- wording: every tab, NSW ----------------
    print('NSW wording on every screen')
    pages = []
    for tab in ('bar', 'list', 'setup', 'draw'):
        click(sid, '#tabs button[data-tab="%s"]' % tab); time.sleep(0.3)
        pages.append(js(sid, 'document.getElementById("tab-%s").innerText' % tab) or '')
    pages.append(js(sid, 'document.querySelector("header").innerText') or '')
    body = re.sub(r'Entries are not earned per drink[^.]*\.[^.]*\.', '', ' '.join(pages))
    body = body.replace('Never one per drink.', '')
    body = body.replace(terms.replace('\n', ' '), '')
    ok('no screen says an entry is earned per drink, per dollar or by amount of alcohol',
       not re.search(r'per drink|per \$|for every \$|each drink|per glass|amount of alcohol|per schooner', body, re.I), [m.group(0) for m in re.finditer(r'.{30}(per drink|per \$|for every \$|each drink|amount of alcohol).{30}', body, re.I)][:3])
    ok('no screen says "free"', not re.search(r'\bfree\b', body, re.I), [m.group(0) for m in re.finditer(r'.{25}\bfree\b.{25}', body, re.I)][:3])

    # ---------------- the draw ----------------
    print('the draw: both TVs, winner, claim (redraw), prize 2')
    tv1, tvs1 = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    tv2, tvs2 = R.open('/tv?venue=' + W.info['slug'], width=1920, height=1080)
    for s in (tvs1, tvs2): R.until(s, 'document.readyState==="complete"', 30)
    time.sleep(2)
    click(sid, '#tabs button[data-tab="setup"]'); R.until(sid, visible('#closeBtn'), 10)
    set_clock(0)
    click(sid, '#closeBtn'); ask_yes(sid); time.sleep(1)
    set_clock(20000)
    click(sid, '#tabs button[data-tab="draw"]')
    ok('Draw is ready once entries are closed', R.until(sid, '!document.getElementById("drawBtn").disabled', 15) is True, text(sid, '#drawWarn'))
    ok('the button names prize 1', 'Trip for two to Fiji' in (text(sid, '#drawBtn') or ''), text(sid, '#drawBtn'))
    time.sleep(1.5)
    click(sid, '#drawBtn'); ask_yes(sid)
    FRAME = ('(function(){var f=document.getElementById("gameFrame"); if(!f||f.style.display==="none"||!/\\/app\\/members\\/screen/.test(f.src||"")) return null;'
             ' var d=f.contentDocument; if(!d||!d.body) return null; var w=f.contentWindow;'
             ' function vis(id){var e=d.getElementById(id); return !!e && e.getBoundingClientRect().width>0 && w.getComputedStyle(e).display!=="none";}'
             ' function txt(id){var e=d.getElementById(id); return e?e.textContent.trim():"";}'
             ' return (%s);})()')
    def tv(expr): return FRAME % expr
    for nm, s in (('TV 1280x720', tvs1), ('TV 1920x1080', tvs2)):
        if s is tvs1:
            ok(nm + ': the draw is on the wall, initials spinning', R.until(s, tv('vis("tvDraw") && /^[A-Z]\\. [A-Z]\\.$/.test(txt("tvSpin"))'), 40) is True, js(s, '(function(){var f=document.getElementById("gameFrame"); return f?[f.style.display,f.src].join(" "):"no frame";})()'))
            break
    for nm, s in (('TV 1280x720', tvs1), ('TV 1920x1080', tvs2)):
        ok(nm + ': brings the draw up by itself (initials spinning or the reveal)',
           R.until(s, tv('(vis("tvDraw") && /^[A-Z]\\. [A-Z]\\.$/.test(txt("tvSpin"))) || d.getElementById("tvWinNum").classList.contains("isname")'), 40) is True,
           js(s, '(function(){var f=document.getElementById("gameFrame"); return f?[f.style.display,f.src].join(" "):"no frame";})()'))
    top = js(tvs1, tv('vis("tvDraw") ? d.getElementById("drawTop").textContent : null'))
    ok('the wall says "purchase raffle" while it draws, never "members draw" (read WHILE the draw is on the screen)', isinstance(top, str) and re.search(r'purchase raffle', top, re.I) and not re.search(r'members', top, re.I), top)
    if js(tvs1, tv('vis("tvDraw")')) is True: shot(tvs1, '11-tv-drawing-1280x720.jpg')
    if js(tvs2, tv('vis("tvDraw")')) is True: shot(tvs2, '11-tv-drawing-1920x1080.jpg')
    ok('the winner card comes up on the venue page', R.until(sid, visible('#winnerCard'), 25) is True, text(sid, '#drawMsg'))
    w1 = text(sid, '#wName')
    draws = [d for d in table('vp_purchase_raffle_draws')]
    ok('one draw recorded, for prize 1, from the live entries', len(draws) == 1 and draws[0]['prize_index'] == 0 and draws[0]['entries_total'] == len([e for e in table('vp_purchase_raffle_entries') if not e.get('voided_at')]), draws)
    ok('the winner card names the winner, the odds, and who to ring (name, mobile, email)', w1 == draws[0]['winner_name'] and '@example.com' in (text(sid, '#wContact') or '') and re.search(r'\d+ of \d+ entries', text(sid, '#wOdds') or ''), [w1, text(sid, '#wContact'), text(sid, '#wOdds')])
    ok('the winner card fits the tablet', fits(sid))
    shot(sid, '12-winner-tablet-1180.jpg')
    for nm, s in (('TV 1280x720', tvs1), ('TV 1920x1080', tvs2)):
        ok(nm + ': shows the same winner', R.until(s, tv('vis("tvWin") && txt("tvWinNum")===%s' % json.dumps(w1)), 30) is True, js(s, tv('txt("tvWin")')))
        R.until(s, tv('/Wins /.test(txt("tvPresent"))'), 10); time.sleep(0.3)
        t = js(s, tv('txt("tvWin")')) or ''
        nod = re.sub(r'\$[\d,]+', '', t)
        ok(nm + ': names the prize; never a whole mobile, a phone ending or a count', 'Fiji' in t and 'ending' not in t and str(draws[0].get('phone_last3')) not in nod and 'entr' not in t and not re.search(r'04\d{2}\s?\d{3}\s?\d{3}', t), t)
        ok(nm + ': no page errors', errs(s) == '[]', errs(s))
    shot(tvs1, '13-tv-winner-1280x720.jpg'); shot(tvs2, '13-tv-winner-1920x1080.jpg')

    # CLAIM: the winner cannot be reached, so the prize is redrawn with a reason (term 9 of the terms), then prize 2 is drawn.
    set_clock(420000)
    ok('the draw history lists the winner with a Redraw button', js(sid, '!!document.querySelector("#drawHist [data-redraw]")') is True)
    click(sid, '#drawHist [data-redraw]')
    R.until(sid, visible('#vpAsk') + ' || ' + visible('#vpAskGo'), 10)
    js(sid, '(function(){var i=document.querySelector("#vpAsk textarea, #vpAsk input[type=text], #vpAsk input"); if(i){i.value="no answer after three calls"; i.dispatchEvent(new Event("input",{bubbles:true}));}})()')
    click(sid, '#vpAskGo')
    ok('Redraw records why and the prize goes back in', R.until(sid, '/Recorded\\. Draw again/.test(document.getElementById("drawMsg").textContent)', 15) is True and table('vp_purchase_raffle_draws')[0]['outcome'] == 'redrawn' and table('vp_purchase_raffle_draws')[0]['redraw_reason'] == 'no answer after three calls', [text(sid, '#drawMsg'), table('vp_purchase_raffle_draws')])
    set_clock(440000); time.sleep(10.5)    # the draw hold: a double tap does not draw twice
    set_clock(470000)
    ok('Draw is ready again for prize 1', R.until(sid, '!document.getElementById("drawBtn").disabled && /Fiji/.test(document.getElementById("drawBtn").textContent)', 15) is True, text(sid, '#drawBtn'))
    click(sid, '#drawBtn'); ask_yes(sid)
    ok('a fresh winner card for prize 1 (the redrawn person cannot win again)', R.until(sid, visible('#winnerCard') + ' && document.getElementById("wName").textContent!==' + json.dumps(w1), 30) is True, [text(sid, '#wName'), w1])
    set_clock(500000); time.sleep(10.5); set_clock(530000)
    click(sid, '#drawBtn'); ask_yes(sid)
    ok('prize 2 is drawn, to a different person from prize 1', R.until(sid, '/Prize 2 winner/.test(document.getElementById("wEye").textContent)', 30) is True, text(sid, '#wEye'))
    ds = [d for d in table('vp_purchase_raffle_draws') if d['outcome'] == 'drawn']
    ok('two live winners, two different people, every prize drawn', len(ds) == 2 and ds[0]['entrant_id'] != ds[1]['entrant_id'] and 'All prizes drawn' in (text(sid, '#drawBtn') or ''), [(d['winner_name'], d['prize_index']) for d in ds])
    ok('the draw record download is there', js(sid, visible('#downloadRecordBtn')) is True)
    shot(sid, '14-prize2-tablet-1180.jpg')
    ok('no errors on the venue page', errs(sid) == '[]', errs(sid))
finally:
    R.close()

print('')
print('%d of %d checks passed' % (ran - bad, ran))   # the shape release-check.py reads
sys.exit(1 if bad else 0)
