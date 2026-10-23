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
S = admin_site.Site(live_tables=['vp_venues'])
V1, V2 = S.W.info['venue'], S.W.info['venue2']
SETTLED = 'document.readyState==="complete" && !document.getElementById("body").classList.contains("hidden")'
BILLING_UP = 'document.getElementById("content").style.display!=="none"'


def permits_in_db(venue_id):
    rows = S.W.table('vp_venues')
    for r in rows:
        if r.get('id') == venue_id:
            return r.get('permits') or {}
    return None


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
    S.until(sid, 'document.querySelectorAll("#drawPermits .permit").length===2', 25)
    time.sleep(0.8)
    kinds = S.js(sid, '[].map.call(document.querySelectorAll("#drawPermits .permit"),function(p){return p.getAttribute("data-kind");}).join(",")')
    ok('the Draws tab holds the raffle and members-draw permit cards, and no bingo one', kinds == 'raffle,members', kinds)
    ok('under a "Permits and authorities for draws" heading at the bottom of the tab', S.js(sid, '(function(){var ls=[].slice.call(document.querySelectorAll("#tp-draws .label"));var l=ls[ls.length-1];return l&&l.textContent.trim()==="Permits and authorities for draws"&&document.getElementById("drawPermits").compareDocumentPosition(l)===2;})()') is True)
    ok('Game settings on this page says nothing of "Permits" beyond pointing at its own bingo permit', S.js(sid, '!document.querySelector("#tp-settings .permit") && /bingo permit/.test(document.getElementById("tp-settings").innerText)') is True)
    ok('the cards name the state the venue is in (New South Wales) and no musical bingo', S.js(sid, '/In New South Wales/.test(document.getElementById("drawPermits").innerText) && !/musical/i.test(document.getElementById("drawPermits").innerText)') is True)
    headings = S.js(sid, '[].map.call(document.querySelectorAll("#drawPermits .permit .lbl"),function(l){return l.firstChild.textContent.trim();}).join("|")')
    ok('headed "Raffles" and "Members draws"', headings == 'Raffles|Members draws', headings)
    shot(sid, 'billing-draws-permits')
    r = fill_permit(sid, '#drawPermits', 'raffle', holder='npo', npo='Deepwater Lions Club', authorised='2026-10-01')
    time.sleep(0.4)
    st = S.js(sid, 'document.querySelector(\'#drawPermits .permit[data-kind="raffle"] .pstatus\').textContent.trim()')
    ok('a raffle run for a charity, with the charity and its date, saves and reads "Recorded"', r is True and st == 'Recorded', (r, st))
    db = permits_in_db(V1)
    ok('the real Worker wrote the raffle permit beside the bingo one (two kinds, nothing blanked)',
       bool(db) and (db.get('raffle') or {}).get('npo_name') == 'Deepwater Lions Club' and (db.get('raffle') or {}).get('holder') == 'npo' and (db.get('bingo') or {}).get('number') == 'NSW-CH-1234', db)
    r = fill_permit(sid, '#drawPermits', 'members', number='TP-0099')
    db = permits_in_db(V1)
    ok('and the members-draw permit too', r is True and bool(db) and (db.get('members') or {}).get('number') == 'TP-0099', db)
    # Another venue on the picker: its own (empty) permits, never the first venue's.
    S.js(sid, 'var s=document.getElementById("rfVenue"); s.value=%s; s.dispatchEvent(new Event("change")); true' % json.dumps(V2))
    S.until(sid, 'document.querySelectorAll("#drawPermits .permit").length===2 && document.querySelector(\'#drawPermits .permit[data-kind="raffle"] .pstatus\').textContent.trim()==="Not recorded"', 20)
    time.sleep(0.4)
    v2 = S.js(sid, 'document.querySelector(\'#drawPermits .permit[data-kind="raffle"] .pnpo_name\').value + "|" + document.getElementById("pmPickName").textContent')
    ok('switching the raffle picker to The Royal Arms repaints its own permits (empty), and says whose they are', v2 == '|The Royal Arms', v2)
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the Draws tab', errs == '[]', errs)
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

print('')
print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
