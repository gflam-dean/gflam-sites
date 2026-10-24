#!/usr/bin/env python3
"""THE ACCOUNT PAGES AS DEAN REVIEWED THEM (24 Oct 2026), IN HEADLESS CHROME AGAINST THE REAL BILLING WORKER.

Dean went through Deepwater Hotel's account pages and asked for four things:
  1. the Permits block on Game settings looked nothing like the other cards (inline 14px headings, two
     holder buttons of different sizes because one label was long): it is now one .card per permit kind
     in the page's own .lbl / .sublbl style, with two EQUAL holder options
  2. musical bingo is NOT bingo (a free game, no permit): the bingo permit kind is simply "Bingo"
  3. the raffle and members-draw permits belong under Your account > Draws; the bingo permit stays on
     Game settings; ONE copy of the code paints and saves all three (/app/vp-permits.js)
  4. a Marketing tab on Your account: the venue link the table-sign QR encodes (read-only, with Open it),
     the Table signs card (from Screen), the opt-in CSV export (from Game settings), and a line pointing
     at Game settings for the opt-in tick

This opens the REAL settings.html and billing.html (tools/browser-rig/admin_site.py), as the owner of
two venues, with the REAL billing Worker in jsc behind them, so every permit saved is judged by the real
/account/permits and read back from the rig's database.

    python3 tools/account-structure-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402
import rig as RIG  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond:
        bad += 1


def shot(sid, name, full=True):
    if A.shots:
        S.shot(sid, os.path.join(A.shots, name + '.png'), full)


# The venue rows are read LIVE from the Worker rig's database (live_tables), so a permit the real Worker
# wrote is what the page reads back after a reload, as it is in production.
# The members draws are written by the REAL game Worker (rig.py's Worker, in jsc) and read back live from
# its database, so "Remove" and "Save" are judged by the real /host/members/* routes.
GW = RIG.Worker()
S = admin_site.Site(live_tables=['vp_venues', 'vp_member_draws'], game=GW, game_tables=['vp_member_draws'])
V1, V2 = S.W.info['venue'], S.W.info['venue2']
SETTLED = 'document.readyState==="complete" && !document.getElementById("body").classList.contains("hidden")'
BILLING_UP = 'document.getElementById("content").style.display!=="none"'


def permits_in_db(venue_id):
    rows = S.W.table('vp_venues')
    for r in rows:
        if r.get('id') == venue_id:
            return r.get('permits') or {}
    return None


def set_venue(venue_id, **fields):
    """Change one venue row in the Worker rig's database (the pages read vp_venues from it, live)."""
    rows = S.W.table('vp_venues')
    for r in rows:
        if r.get('id') == venue_id: r.update(fields)
    S.W.seed('vp_venues', rows)


def card_kinds(sid, wrap):
    return S.js(sid, '[].map.call(document.querySelectorAll(%s+" .permit"),function(p){return p.getAttribute("data-kind")+(p.getAttribute("data-notneeded")?"!":"");}).join(",")' % json.dumps(wrap))


def fill_permit(sid, wrap, kind, number='', holder='venue', npo='', authorised=''):
    """Type a permit into the card the way a person would, and press its Save."""
    S.js(sid, '''(function(){var c=document.querySelector(%s+' .permit[data-kind="%s"]');
      c.querySelector('.pholder [data-holder="%s"]').click();
      c.querySelector(".pnumber").value=%s; c.querySelector(".pnpo_name").value=%s; c.querySelector(".pauthorised").value=%s;
      c.querySelector(".psave").click(); return true;})()''' % (json.dumps(wrap), kind, holder, json.dumps(number), json.dumps(npo), json.dumps(authorised)))
    return S.until(sid, '/Saved|Cleared|Could not|permission/.test(document.querySelector(%s+\' .permit[data-kind="%s"] .pmsg\').textContent)' % (json.dumps(wrap), kind), 20)


CARD = r'''(function(){
  var w=document.getElementById("permitsWrap"), ref=document.querySelector("#body .card.owneronly"), out={kinds:[], cards:[]};
  var cs=function(e){var s=getComputedStyle(e);return {fs:s.fontSize, ls:s.letterSpacing, ff:s.fontFamily.split(",")[0], tt:s.textTransform, col:s.color, pad:s.padding, br:s.borderRadius, bg:s.backgroundColor};};
  out.ref={lbl:cs(ref.querySelector(".lbl")), sub:cs(ref.querySelector(".sublbl")), card:cs(ref), seg:cs(ref.querySelector(".seg .opt"))};
  w.querySelectorAll(".permit").forEach(function(c){
    out.kinds.push(c.getAttribute("data-kind"));
    var lbl=c.querySelector(".lbl"), sub=c.querySelector(".sublbl"), opts=[].slice.call(c.querySelectorAll(".pholder .opt")), inp=c.querySelector(".pnumber");
    var r=c.getBoundingClientRect();
    out.cards.push({isCard:c.classList.contains("card"), lbl:lbl?cs(lbl):null, lblText:lbl?lbl.firstChild.textContent.trim():"", status:(c.querySelector(".pstatus")||{}).textContent,
      sub:sub?cs(sub):null, card:cs(c), seg:opts.length?cs(opts[0]):null, text:c.innerText,
      opts:opts.map(function(o){var b=o.getBoundingClientRect();return {w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,l:Math.round(b.left),r:Math.round(b.right),on:o.classList.contains("on"),t:o.textContent.trim()};}),
      inpFs:inp?getComputedStyle(inp).fontSize:null, inpW:inp?Math.round(inp.getBoundingClientRect().width):0, inner:Math.round(r.width-parseFloat(getComputedStyle(c).paddingLeft)-parseFloat(getComputedStyle(c).paddingRight)),
      left:Math.round(r.left), right:Math.round(r.right), refLeft:Math.round(ref.getBoundingClientRect().left), refRight:Math.round(ref.getBoundingClientRect().right)});
  });
  return JSON.stringify(out);
})()'''

# Deepwater (V1) starts as a QUEENSLAND venue and The Royal Arms (V2) as a TASMANIAN one, so the one table
# that says which states need a permit (VPPermits.NEEDS) is seen choosing different cards; NSW comes later.
set_venue(V1, au_state='QLD', postcode='4000')
set_venue(V2, au_state='TAS', postcode='7000')
try:
    print('\nGAME SETTINGS at 390 wide: the bingo permit is a card like the others')
    tid, sid = S.open('/app/settings.html?venue=' + V1, 390, 844, True)
    S.until(sid, '!!document.querySelector("#permitsWrap .permit")', 25)
    time.sleep(1.0)
    g = json.loads(S.js(sid, CARD) or '{}')
    cards = g.get('cards') or []
    ok('one permit card on Game settings, and it is the bingo one', g.get('kinds') == ['bingo'], g.get('kinds'))
    c = cards[0] if cards else {}
    ok('its heading is simply "Bingo" (musical bingo is not bingo and is not mentioned)', c.get('lblText') == 'Bingo' and 'musical' not in (c.get('text') or '').lower(), (c.get('lblText'), (c.get('text') or '')[:120]))
    ok('it is a .card with a .lbl heading and a .sublbl intro, the same type as the "Name display on the TV" card',
       c.get('isCard') and c.get('lbl') == g.get('ref', {}).get('lbl') and c.get('sub') == g.get('ref', {}).get('sub'), (c.get('lbl'), g.get('ref', {}).get('lbl'), c.get('sub'), g.get('ref', {}).get('sub')))
    ok('the card itself has the same padding, corners and background as the other cards, and the same edges',
       c.get('card') == g.get('ref', {}).get('card') and c.get('left') == c.get('refLeft') and c.get('right') == c.get('refRight'), (c.get('card'), g.get('ref', {}).get('card'), c.get('left'), c.get('refLeft')))
    o = c.get('opts') or []
    ok('the holder choice is two options of EQUAL width and height', len(o) == 2 and abs(o[0]['w'] - o[1]['w']) <= 1 and abs(o[0]['h'] - o[1]['h']) <= 1, o)
    ok('with short labels: "Our venue holds it" / "A charity holds it, we run it for them"', [x['t'] for x in o] == ['Our venue holds it', 'A charity holds it, we run it for them'], [x['t'] for x in o])
    ok('the options are styled like the name-display segmented control (font, size, corners)', bool(c.get('seg')) and c['seg'].get('fs') == g['ref']['seg'].get('fs') and c['seg'].get('ff') == g['ref']['seg'].get('ff') and c['seg'].get('br') == g['ref']['seg'].get('br'), (c.get('seg'), g.get('ref', {}).get('seg')))
    ok('the options fill the card edge to edge, like the name-display control', len(o) == 2 and abs((o[1]['r'] - o[0]['l']) - c.get('inner', 0)) <= 2, (o, c.get('inner')))
    ok('the inputs are the page\'s 14px, full width of the card', c.get('inpFs') == '14px' and abs(c.get('inpW', 0) - c.get('inner', 0)) <= 2, (c.get('inpFs'), c.get('inpW'), c.get('inner')))
    ok('it reads "Not recorded" before anything is saved', (c.get('status') or '').strip() == 'Not recorded', c.get('status'))
    S.js(sid, 'document.getElementById("permitsWrap").scrollIntoView(); true'); time.sleep(0.3)
    shot(sid, 'settings-permits-390')
    print('\nand saving it goes through the real Worker')
    r = fill_permit(sid, '#permitsWrap', 'bingo', number='NSW-CH-1234')
    time.sleep(0.4)
    st = S.js(sid, 'document.querySelector("#permitsWrap .permit .pstatus").textContent.trim()')
    msg = S.js(sid, 'document.querySelector("#permitsWrap .permit .pmsg").textContent')
    ok('saved: the card says so and reads "Recorded"', r is True and st == 'Recorded' and 'Saved. This counts as recorded.' == msg, (r, st, msg))
    db = permits_in_db(V1)
    ok('the real /account/permits wrote it to the venue row', bool(db) and (db.get('bingo') or {}).get('number') == 'NSW-CH-1234' and (db.get('bingo') or {}).get('holder') == 'venue', db)
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on Game settings', errs == '[]', errs)
    S.close_tab(tid)

    print('\nYOUR ACCOUNT > DRAWS: the raffle and members-draw permits, beside the draws')
    tid, sid = S.open('/app/billing.html#draws', 1100, 1000)
    S.until(sid, BILLING_UP, 25)
    S.until(sid, 'document.querySelectorAll("#drawPermits .permit").length>=1', 25)
    time.sleep(0.8)
    kinds = card_kinds(sid, '#drawPermits')
    ok('a QLD venue: the Draws tab has the raffle permit only (a free members draw is a category 4 game, no licence) and no bingo', kinds == 'raffle', kinds)
    ok('under a "Permits and authorities for draws" heading at the bottom of the tab', S.js(sid, '(function(){var ls=[].slice.call(document.querySelectorAll("#tp-draws .label"));var l=ls[ls.length-1];return l&&l.textContent.trim()==="Permits and authorities for draws"&&document.getElementById("drawPermits").compareDocumentPosition(l)===2;})()') is True)
    ok('Game settings on this page says nothing of "Permits" beyond pointing at its own bingo permit', S.js(sid, '!document.querySelector("#tp-settings .permit") && /bingo permit/.test(document.getElementById("tp-settings").innerText)') is True)
    ok('the card names the state the venue is in (Queensland) and no musical bingo', S.js(sid, '/In Queensland/.test(document.getElementById("drawPermits").innerText) && !/musical/i.test(document.getElementById("drawPermits").innerText)') is True)
    headings = S.js(sid, '[].map.call(document.querySelectorAll("#drawPermits .permit .lbl"),function(l){return l.firstChild.textContent.trim();}).join("|")')
    ok('headed "Raffles"', headings == 'Raffles', headings)
    shot(sid, 'billing-draws-permits')
    r = fill_permit(sid, '#drawPermits', 'raffle', holder='npo', npo='Deepwater Lions Club', authorised='2026-10-01')
    time.sleep(0.4)
    st = S.js(sid, 'document.querySelector(\'#drawPermits .permit[data-kind="raffle"] .pstatus\').textContent.trim()')
    ok('a raffle run for a charity, with the charity and its date, saves and reads "Recorded"', r is True and st == 'Recorded', (r, st))
    db = permits_in_db(V1)
    ok('the real Worker wrote the raffle permit beside the bingo one (two kinds, nothing blanked)',
       bool(db) and (db.get('raffle') or {}).get('npo_name') == 'Deepwater Lions Club' and (db.get('raffle') or {}).get('holder') == 'npo' and (db.get('bingo') or {}).get('number') == 'NSW-CH-1234', db)
    # Another venue on the picker: its own (empty) permits, never the first venue's, and ITS state's kinds.
    S.js(sid, 'var s=document.getElementById("rfVenue"); s.value=%s; s.dispatchEvent(new Event("change")); true' % json.dumps(V2))
    S.until(sid, 'document.querySelectorAll("#drawPermits .permit").length===2 && document.querySelector(\'#drawPermits .permit[data-kind="raffle"] .pstatus\').textContent.trim()==="Not recorded"', 20)
    time.sleep(0.4)
    v2 = S.js(sid, 'document.querySelector(\'#drawPermits .permit[data-kind="raffle"] .pnpo_name\').value + "|" + document.getElementById("pmPickName").textContent')
    ok('switching the raffle picker to The Royal Arms repaints its own permits (empty), and says whose they are', v2 == '|The Royal Arms', v2)
    ok('a TAS venue: raffle AND members-draw cards (each needs a permit above $10,000)', card_kinds(sid, '#drawPermits') == 'raffle,members', card_kinds(sid, '#drawPermits'))
    r = fill_permit(sid, '#drawPermits', 'members', number='TP-0099')
    db = permits_in_db(V2)
    ok('and the TAS members-draw permit saves through the real Worker', r is True and bool(db) and (db.get('members') or {}).get('number') == 'TP-0099', db)
    S.close_tab(tid)

    print('\nA SAVED PERMIT THE STATE DOES NOT NEED is still shown, and can be cleared')
    set_venue(V2, au_state='QLD', postcode='4000')   # The Royal Arms "moves" to Queensland, its TAS members permit still saved
    tid, sid = S.open('/app/billing.html#draws', 1100, 1000)
    S.until(sid, BILLING_UP, 25)
    S.js(sid, 'var s=document.getElementById("rfVenue"); s.value=%s; s.dispatchEvent(new Event("change")); true' % json.dumps(V2))
    S.until(sid, 'document.getElementById("pmPickName").textContent==="The Royal Arms" && document.querySelectorAll("#drawPermits .permit").length===2', 20)
    time.sleep(0.4)
    ok('QLD with a members permit saved: the members card stays, marked not needed', card_kinds(sid, '#drawPermits') == 'raffle,members!', card_kinds(sid, '#drawPermits'))
    note = S.js(sid, '(document.querySelector(\'#drawPermits .permit[data-kind="members"] .pnotneeded\')||{}).textContent')
    ok('with the note "Your state does not need a permit for this. You can clear it."', note == 'Your state does not need a permit for this. You can clear it.', note)
    S.js(sid, 'document.querySelector(\'#drawPermits .permit[data-kind="members"] .pclear\').click(); true')
    S.until(sid, '/Cleared|Could not/.test(document.querySelector(\'#drawPermits .permit[data-kind="members"] .pmsg\').textContent)', 20)
    db = permits_in_db(V2)
    ok('Clear it removes the saved permit through the real Worker', db is not None and 'members' not in db, db)
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the Draws tab', errs == '[]', errs)
    S.close_tab(tid)

    print('\nNEW SOUTH WALES: no bingo permit card, unless one was saved')
    set_venue(V2, au_state='NSW', postcode='2000')
    tid, sid = S.open('/app/settings.html?venue=' + V2, 1100, 1000)
    S.until(sid, SETTLED, 25); time.sleep(1.2)
    ok('an NSW venue with nothing saved: no bingo permit card on Game settings (club bingo and charity housie need no authority)',
       card_kinds(sid, '#permitsWrap') == '' and S.js(sid, 'document.getElementById("permitsIntro").offsetParent===null') is True, card_kinds(sid, '#permitsWrap'))
    S.close_tab(tid)
    set_venue(V1, au_state='NSW', postcode='2371')   # Deepwater back to NSW, with the bingo permit saved above
    tid, sid = S.open('/app/settings.html?venue=' + V1, 1100, 1000)
    S.until(sid, '!!document.querySelector("#permitsWrap .permit")', 25); time.sleep(0.6)
    ok('an NSW venue that saved a bingo permit still sees it, marked not needed, with a Clear button',
       card_kinds(sid, '#permitsWrap') == 'bingo!' and S.js(sid, '!!document.querySelector("#permitsWrap .pclear") && /Your state does not need a permit for this/.test(document.getElementById("permitsWrap").innerText)') is True, card_kinds(sid, '#permitsWrap'))
    S.close_tab(tid)
    tid, sid = S.open('/app/billing.html#draws', 1100, 1000)
    S.until(sid, BILLING_UP, 25)
    S.until(sid, 'document.querySelectorAll("#drawPermits .permit").length===2', 25)
    ok('an NSW venue: raffle (charity authority) and members-draw (authority above $10,000) cards', card_kinds(sid, '#drawPermits') == 'raffle,members', card_kinds(sid, '#drawPermits'))
    S.close_tab(tid)

    print('\nHQ lists only the kinds the state needs')
    S.W.seed('vp_platform_admins', [{'auth_user_id': S.W.info['uid'], 'role': 'owner', 'label': 'Dean'}])
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1100)
    S.until(sid, 'document.querySelectorAll("#venueRows .vn").length > 0', 25)
    def hq_permits(vid):
        S.js(sid, 'var b=document.querySelector(\'button[data-details="%s"]\'); if(b) b.click(); true' % vid)
        S.until(sid, '!!document.querySelector(\'[data-compliance="%s"]\')' % vid, 15)
        return S.js(sid, '(function(b){return b?b.parentNode.textContent.replace(/\\s+/g," ").trim():"";})(document.querySelector(\'[data-compliance="%s"]\'))' % vid) or ''
    t1 = hq_permits(V1)
    ok('HQ, Deepwater (NSW): the saved bingo permit is listed and marked not needed, the raffle listed, nothing else',
       'bingo: number NSW-CH-1234' in t1 and 'not needed in their state' in t1 and 'raffle: under Deepwater Lions Club' in t1 and 'members draw' not in t1, t1)
    t2 = hq_permits(V2)
    ok('HQ, The Royal Arms (NSW, nothing saved): "none recorded" names only the kinds NSW can need',
       'none recorded (their state can need one for raffles, members draws)' in t2, t2)
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error in HQ', errs == '[]', errs)
    S.close_tab(tid)
    S.W.seed('vp_platform_admins', [])

    print('\nDRAWS: every members draw listed with Edit and Remove; the one raffle routine listed with Remove raffle')
    D1, D2 = '44444444-4444-4444-8444-000000000001', '44444444-4444-4444-8444-000000000002'
    GW.seed('vp_member_draws', [
        {'id': D1, 'venue_id': V1, 'name': 'Friday Members Badge Draw', 'draw_day': 'Friday', 'draw_time': '7:00pm', 'date_started': '2026-10-02',
         'starting_amount_cents': 50000, 'increment_cents': 10000, 'current_jackpot_cents': 90000, 'time_to_claim_seconds': 120,
         'created_at': '2026-10-01T00:00:00Z', 'archived_at': None},
        {'id': D2, 'venue_id': V1, 'name': 'Sunday Members Draw (TEST)', 'draw_day': 'Sunday', 'draw_time': '3:00pm', 'date_started': '2026-10-04',
         'starting_amount_cents': 20000, 'increment_cents': 5000, 'current_jackpot_cents': 25000, 'time_to_claim_seconds': 90,
         'created_at': '2026-10-24T00:43:00Z', 'archived_at': None}], replace=True)
    def draws_db(): return dict((d['id'], d) for d in S.game_table('vp_member_draws'))
    LIST = '[].map.call(document.querySelectorAll("#mdList .drow"),function(r){return (r.classList.contains("editing")?"*":"")+r.querySelector(".dn b").textContent+" | "+r.querySelector(".dn small").textContent+" | "+r.querySelector(".tvtag").textContent;}).join("\\n")'
    tid, sid = S.open('/app/billing.html#draws', 1100, 1000)
    S.until(sid, BILLING_UP, 25)
    S.until(sid, 'document.querySelectorAll("#mdList .drow").length===2', 25); time.sleep(0.5)
    lst = (S.js(sid, LIST) or '').split('\n')
    ok('both members draws are listed under the form: name, night, jackpot and whether each is on the TV',
       len(lst) == 2 and lst[0].startswith('*Friday Members Badge Draw | Friday 7:00pm') and '$900' in lst[0] and lst[0].endswith('On the TV')
       and lst[1].startswith('Sunday Members Draw (TEST) | Sunday 3:00pm') and '$250' in lst[1], lst)
    ok('no draw is hidden in a "Which draw" dropdown any more, and there is an "+ Add another draw" button',
       S.js(sid, '!document.getElementById("mdPick") && !/Add another draw/.test([].map.call(document.querySelectorAll("#tp-draws option"),function(o){return o.textContent;}).join("|")) && document.getElementById("mdAddDraw").textContent.trim()==="+ Add another draw"') is True)
    S.js(sid, 'document.querySelectorAll("#mdList .drow")[1].querySelector(".dedit").click(); true'); time.sleep(0.4)
    ok('Edit on the second draw loads it into the form and marks it as the one being edited',
       S.js(sid, 'document.getElementById("md-name").value') == 'Sunday Members Draw (TEST)' and (S.js(sid, LIST) or '').split('\n')[1].startswith('*')
       and S.js(sid, 'document.getElementById("mdEditing").textContent') == 'Editing Sunday Members Draw (TEST).', S.js(sid, LIST))
    S.js(sid, 'document.getElementById("md-time").value="8:00pm"; document.getElementById("mdSave").click(); true')
    S.until(sid, '/Sunday 8:00pm/.test(document.getElementById("mdList").textContent)', 20)
    ok('saving the edit changes THAT draw, in the Worker and in the list, and leaves the first alone',
       draws_db().get(D2, {}).get('draw_time') == '8:00pm' and draws_db().get(D1, {}).get('draw_time') == '7:00pm' and 'Sunday 8:00pm' in (S.js(sid, LIST) or ''), (draws_db().get(D2), S.js(sid, LIST)))
    S.js(sid, 'document.querySelectorAll("#mdList .drow")[1].querySelector(".dremove").click(); true')
    S.until(sid, '!!document.getElementById("vpAskGo")', 8)
    S.js(sid, 'document.getElementById("vpAskGo").click(); true')
    S.until(sid, 'document.querySelectorAll("#mdList .drow").length===1', 20); time.sleep(0.4)
    ok('Remove takes the second draw out of the list (the real draw-remove archives it) and keeps the first',
       (S.js(sid, LIST) or '').count('\n') == 0 and 'Friday Members Badge Draw' in (S.js(sid, LIST) or '') and bool(draws_db().get(D2, {}).get('archived_at')) and not draws_db().get(D1, {}).get('archived_at'),
       (S.js(sid, LIST), draws_db().get(D2)))
    S.js(sid, 'document.getElementById("mdAddDraw").click(); true'); time.sleep(0.3)
    ok('"+ Add another draw" empties the form for a new one', S.js(sid, 'document.getElementById("md-name").value==="" && !document.querySelector("#mdList .drow.editing")') is True)
    S.js(sid, 'document.getElementById("md-name").value="Wednesday Lucky Draw"; document.getElementById("mdSave").click(); true')
    S.until(sid, 'document.querySelectorAll("#mdList .drow").length===2', 20)
    ok('and saving it adds it to the list (two draws again, the new one being edited)', (S.js(sid, LIST) or '').split('\n')[-1].startswith('*Wednesday Lucky Draw'), S.js(sid, LIST))
    RLIST = '[].map.call(document.querySelectorAll("#rfList .drow"),function(r){return r.querySelector(".dn b").textContent+" | "+r.querySelector(".dn small").textContent+" | "+r.querySelector(".tvtag").textContent+" | "+r.querySelector(".rremove").textContent;}).join("\\n")'
    S.js(sid, 'document.getElementById("rf-label").value="Meat Raffle"; document.getElementById("rf-day").value="Friday"; document.getElementById("rf-time").value="6:30pm"; document.getElementById("rfSave").click(); true')
    S.until(sid, 'document.querySelectorAll("#rfList .drow").length===1', 20); time.sleep(0.3)
    rl = S.js(sid, RLIST) or ''
    ok('the raffle routine is listed as ONE row (one routine per venue), on the TV, with Edit and "Remove raffle"',
       rl.startswith('Meat Raffle | drawn Friday 6:30pm') and rl.endswith('On the TV | Remove raffle') and S.js(sid, '!document.querySelector("#rfAddAnother")') is True, rl)
    S.js(sid, 'document.querySelector("#rfList .rremove").click(); true')
    S.until(sid, '!!document.getElementById("vpAsk")', 8)
    askt = S.js(sid, 'document.getElementById("vpAsk").innerText') or ''
    S.js(sid, 'document.getElementById("vpAskGo").click(); true')
    S.until(sid, 'document.querySelectorAll("#rfList .drow").length===0', 20)
    ok('Remove raffle says the prize list is kept, and takes the routine out of the list and off the TV',
       'prize list is kept' in askt and S.js(sid, '/No raffle routine saved/.test(document.getElementById("rfList").textContent) && document.getElementById("rf-label").value===""') is True, askt[:160])
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error working the draws lists', errs == '[]', errs)
    S.close_tab(tid)

    print('\nYOUR ACCOUNT > MARKETING: the venue link, the table signs, the opt-in list')
    tid, sid = S.open('/app/billing.html#marketing', 1100, 1000)
    S.until(sid, BILLING_UP, 25)
    S.until(sid, '/^https:/.test(document.getElementById("venueLinkVal").textContent)', 20)
    time.sleep(0.8)
    tabs = S.js(sid, '[].map.call(document.querySelectorAll(".tabs button"),function(b){return b.getAttribute("data-tab")+(b.classList.contains("on")?"*":"");}).join(",")')
    ok('a Marketing tab sits between Draws and Game settings, and #marketing opens on it', tabs == 'billing,nights,screen,draws,marketing*,settings', tabs)
    link = S.js(sid, 'document.getElementById("venueLinkVal").textContent')
    ok('the venue link is the address the table-sign QR encodes, venueplay.com.au/play?venue=<slug>', link == 'https://venueplay.com.au/play?venue=deepwater-hotel', link)
    ok('shown in large monospace, read-only (no input)', S.js(sid, '(function(e){var s=getComputedStyle(e);return parseFloat(s.fontSize)>=18 && /Mono|mono/.test(s.fontFamily) && e.tagName!=="INPUT";})(document.getElementById("venueLinkVal"))') is True)
    href = S.js(sid, 'document.getElementById("venueLinkOpen").href + " " + document.getElementById("venueLinkOpen").target')
    ok('"Open it" is a link to that address in a new tab', href == link + ' _blank', href)
    sg = S.js(sid, 'document.getElementById("signageLink").href')
    ok('the Table signs card is here, and its link carries the venue', sg.endswith('/signage.html?venue=deepwater-hotel') and S.js(sid, '!!document.querySelector("#tp-marketing #signageLink") && !document.querySelector("#tp-screen #signageLink")') is True, sg)
    ok('the opt-in CSV export is here, not under Game settings', S.js(sid, '!!document.querySelector("#tp-marketing #optinExport") && !document.querySelector("#tp-settings #optinExport")') is True)
    sp = S.js(sid, 'document.getElementById("optinSignpost").innerText.replace(/\\s+/g," ").trim() + " | " + document.getElementById("optinSettingsLink").getAttribute("href")')
    ok('one line says the opt-in tick and what players are asked for are set under Game settings, and links to that venue\'s settings',
       sp == 'The opt-in tick on the join screen, and what players are asked for, are set under Game settings. | settings.html?venue=' + V1, sp)
    shot(sid, 'billing-marketing')
    S.js(sid, 'var s=document.getElementById("mkVenue"); s.value=%s; s.dispatchEvent(new Event("change")); true' % json.dumps(V2))
    time.sleep(0.3)
    l2 = S.js(sid, 'document.getElementById("venueLinkVal").textContent + " " + document.getElementById("signageLink").href.split("?")[1]')
    ok('picking The Royal Arms changes the link and the signs link together', l2 == 'https://venueplay.com.au/play?venue=the-royal-arms venue=the-royal-arms', l2)
    S.js(sid, 'document.querySelector(\'.tabs button[data-tab="settings"]\').click(); true'); time.sleep(0.3)
    ok('Game settings says where the opt-in list went', S.js(sid, '/opt-in list is under the Marketing tab/.test(document.getElementById("tp-settings").innerText)') is True)
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the Marketing tab', errs == '[]', errs)
    S.close_tab(tid)

    print('\nand on a phone')
    tid, sid = S.open('/app/billing.html#marketing', 390, 844, True)
    S.until(sid, BILLING_UP, 25)
    S.until(sid, '/^https:/.test(document.getElementById("venueLinkVal").textContent)', 20)
    time.sleep(0.6)
    fit = S.js(sid, '(function(){var e=document.getElementById("venueLinkVal"),b=e.getBoundingClientRect();return JSON.stringify({r:Math.round(b.right),w:innerWidth,sw:document.documentElement.scrollWidth});})()')
    f = json.loads(fit or '{}')
    ok('at 390 wide the link wraps inside the card and nothing scrolls sideways', f.get('r', 9999) <= f.get('w', 0) and f.get('sw', 9999) <= f.get('w', 0), f)
    shot(sid, 'billing-marketing-390')
    S.close_tab(tid)
finally:
    S.close()
    GW.close()

print('')
print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
