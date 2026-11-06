#!/usr/bin/env python3
"""DEAN'S NOTES ON THE HOST CONSOLE AND YOUR ACCOUNT, 3 NOV 2026, IN A REAL BROWSER.

~/venue-enrich/reports/console-hq-fixes-5nov/DEAN-NOTES.md. Opens the shipped pages in headless Chrome
(tools/browser-rig/admin_site.py: the REAL billing Worker in jsc behind them, a stand-in supabase-js), signed in as
the owner of two venues (Deepwater Hotel and The Royal Arms), at desktop and at phone width, and reads what the
browser painted:

  3   HQ's header says "admin" beside the logo, not "venueplay Admin"
  4   the billing card: "This month  N players", "Next month  N players", "Next payment  $X per month", each number
      beside its own label in one row
  5   adding players asks "Add 1 player at <venue>?" with the money under it and buttons that say what they do
  6   a People tab holds the hosts, managers and marketing login; with two venues it shows who can get into the
      venue chosen at the top
  7   no "lock out old devices" card anywhere on the page, HQ viewing included
  8, 12  ONE venue drop-down above the tabs; picking The Royal Arms moves Raffles AND Members AND Nights to it, and
      the console's pick (Switch venue) is the venue Your account opens on
  9   the monthly report with no venue in the address and no nights: a finished "No nights yet" page, never
      "Pick one of your venues"
  10  the open tab is remembered across a reload; a slide's preview is TV shaped and on a phone goes full width
  11  the prizes card says cash and other prizes apart and never one dollar total
  13  Game settings: the same drop-down, and "This venue only / Whole group", which saves to both venues

ROUND 2 (Dean, 3 Nov 2026 ~10pm, after the after/ pictures), at 1100, 820 (iPad) and 390 wide:
  A   the Add players question says the true thing (a full month on the next bill, ready tonight, a decrease from the
      next bill) and the one-hour undo line ONLY when the Worker's switch is on
  B   Back sits on the same line as Help and Sign out, in that order
  C,E the venue rows: the players block on the same line as the name at every width, Save under it, Cancel under both
  D   the add-a-venue words are the Worker's rule: free until the next bill date (switch off); a 30-day free month
      and the days after it on the next bill (switch on)
  F   Draws is three folds: one open, remembered, each heading summarising what is set
  G   People: one sign-in sentence, each role in one line, "change the venue at the top" only with a drop-down there
  K   the monthly report title is the month, with the venue under it, never a pub's name split across lines
  L   Game settings: Whole group / This venue at the top, Whole group the default with no drop-down, This venue shows it

Touches no git and no remote. Screenshots with --shots DIR (the after pictures for Dean).

    python3 tools/console-hq-5nov-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import gatelib  # noqa: E402
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]
# One Chrome run at a time on this Mac (tools/gatelib.py): wait VP_WAIT_LOCK seconds for the heavy lock, never clear another's.
if not gatelib.hold_lock_or_refuse('console-hq-5nov-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    sys.exit(2)


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


S = admin_site.Site(fonts=bool(A.shots))
V1, V2 = S.W.info['venue'], S.W.info['venue2']
# The prizes card reads v_vp_prizes_given through supabase-js: $800 cash across 3, and 2 more worth $150 between them.
# A host who runs The Royal Arms only, so the People tab has someone to show at one venue and not the other.
S.W.seed('vp_venue_staff', (S.W.table('vp_venue_staff') or []) + [{'auth_user_id': '33333333-3333-4333-8333-333333333333', 'venue_id': V2,
         'role': 'host', 'display_name': 'Harry Host', 'permissions': None}])
S.extra_db['v_vp_prizes_given'] = [{'venue_id': V1, 'prizes_given_count': 5, 'prizes_given_value_cents': 95000,
                                    'cash_given_count': 3, 'cash_given_value_cents': 80000}]


def shot(sid, name, full=True):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, 'after-' + name + '.png'), full=full)


# The add-players quote, laid over the Worker's answer (the rig has no Stripe price to quote from).
QUOTE = r'''(function(){var F=window.fetch;window.fetch=function(u,o){
  if(String(u).indexOf("/account/players")>=0 && o && String(o.body||"").indexOf('"preview":true')>=0){
    return Promise.resolve(new Response(JSON.stringify({ok:true,preview:true,charge_cents:250,plan:"monthly"}),{status:200,headers:{"Content-Type":"application/json"}}));}
  return F.apply(this,arguments);};})();'''
UP = ('document.getElementById("content") && document.getElementById("content").style.display!=="none" && '
      'document.getElementById("s-plan").textContent!=="\u2013"')


def tab(sid, name):
    S.js(sid, 'document.querySelector(\'.tabs button[data-tab="%s"]\').click(); true' % name)
    time.sleep(1.2)


def account(w, h, mob, pre=QUOTE, path='/app/billing.html'):
    tid, sid = S.open(path, w, h, mob, pre=pre)
    up = S.until(sid, UP, 30)
    S.until(sid, '!!document.querySelector("#acctPick select")', 10)
    time.sleep(1.2)
    return tid, sid, up


ROWS = '''JSON.stringify([].map.call(document.querySelectorAll(".sumrow"),function(r){var k=r.querySelector(".k"),v=r.querySelector(".v"),s=r.querySelector(".sub");
  var kr=k.getBoundingClientRect(),vr=v.getBoundingClientRect();return {k:k.textContent,v:v.textContent,sub:s?s.textContent:"",
  side:Math.abs(kr.top-vr.top)<14 || (vr.top>kr.top && vr.top-kr.bottom<10),shown:r.offsetParent!==null};}))'''

try:
    for (w, h, mob) in ((1100, 950, False), (820, 1180, True), (390, 844, True)):
        where = '%d wide' % w
        print('\nYour account, %s' % where)
        tid, sid, up = account(w, h, mob)
        ok('%s: CONTROL: the Billing tab is up, from the real Worker' % where, up is True, S.js(sid, 'document.getElementById("loading").textContent'))
        rows = S.json(sid, ROWS, [])
        by = dict((r['k'], r) for r in rows if r['shown'])
        ok('%s: 4. "This month" then "Next month" then "Next payment", in that order' % where,
           [r['k'] for r in rows if r['shown']][:4] == ['Your plan', 'This month', 'Next month', 'Next payment'], rows)
        tm, nm, np = by.get('This month', {}), by.get('Next month', {}), by.get('Next payment', {})
        ok('%s: 4. the player numbers say "players" and sit beside their labels' % where,
           tm.get('v', '').endswith(('players', 'player')) and nm.get('v', '').endswith(('players', 'player')) and tm.get('side') and nm.get('side'), [tm, nm])
        ok('%s: 4. "Next payment: $X per month", the amount beside its label' % where,
           np.get('v', '').startswith('$') and np.get('v', '').endswith('per month') and np.get('side'), np)
        ok('%s: 7. no lock-out card anywhere on the page' % where,
           S.js(sid, '!document.getElementById("resecureCard") && !/lock (old )?devices|lock out/i.test(document.body.innerText)') is True)
        pick = S.js(sid, 'JSON.stringify({n:document.querySelectorAll("#acctPick select").length,opts:[].map.call(document.querySelectorAll("#acctPick option"),function(o){return o.textContent}),'
                         'shown:(function(){var s=document.querySelector("#acctPick select");return !!(s&&s.offsetParent)})(),'
                         'panels:[].filter.call(document.querySelectorAll(".screenpick"),function(e){return e.offsetParent!==null}).length,'
                         'aboveTabs:(function(){var a=document.getElementById("acctPick"),t=document.querySelector(".tabs");return !!(a&&t&&(a.compareDocumentPosition(t)&4))})()})')
        pick = json.loads(pick or '{}')
        ok('%s: 8/12. ONE venue drop-down, above the tabs, listing both venues' % where,
           pick.get('n') == 1 and pick.get('shown') and pick.get('aboveTabs') and sorted(pick.get('opts') or []) == ['Deepwater Hotel', 'The Royal Arms'], pick)
        ok('%s: 8/12. and no panel shows a drop-down of its own' % where, pick.get('panels') == 0, pick)
        shot(sid, 'account-billing-%d' % w)

        # B. Back, Help, Sign out on one line, in that order
        hdr = S.json(sid, '(function(){var a=document.querySelector("header .hactions");if(!a)return "{}";var b=[].map.call(a.children,function(e){return {id:e.id,t:e.textContent.trim(),top:Math.round(e.getBoundingClientRect().top),h:Math.round(e.getBoundingClientRect().height)}});'
                                   'return JSON.stringify({ids:b.map(function(x){return x.id}),tops:b.map(function(x){return x.top}),hs:b.map(function(x){return x.h}),inActs:!!a.querySelector("#backLink")});})()', {})
        ok('%s: B. the Back link is in the header actions, before Help and Sign out' % where, hdr.get('inActs') and hdr.get('ids') == ['backLink', 'vphLink', 'signout'], hdr)
        ok('%s: B. the three sit on ONE line, the same height' % where, len(set(hdr.get('tops') or [0, 1])) == 1 and len(set(hdr.get('hs') or [0, 1])) == 1, hdr)

        # C, E. the venue rows line up at every width
        rows_geo = S.json(sid, """JSON.stringify([].map.call(document.querySelectorAll("#venues .venue"),function(r){var g=function(q){var e=r.querySelector(q);if(!e)return null;var b=e.getBoundingClientRect();return {t:Math.round(b.top),b:Math.round(b.bottom),l:Math.round(b.left),r:Math.round(b.right)}};
            var rb=r.getBoundingClientRect();return {row:{t:Math.round(rb.top),b:Math.round(rb.bottom),r:Math.round(rb.right)},nm:g(".nm b"),step:g(".stepper"),canx:g(".canx"),pad:parseInt(getComputedStyle(r).paddingRight,10)};}))""", [])
        ok('%s: C/E. CONTROL: two venue rows' % where, len(rows_geo) == 2, rows_geo)
        ok('%s: C/E. the players stepper sits on the SAME line as the venue name (tops within 14px), right-aligned in the card' % where,
           all(abs(r['step']['t'] - r['nm']['t']) <= 14 and abs((r['row']['r'] - r['pad']) - r['step']['r']) <= 2 for r in rows_geo), rows_geo)
        ok('%s: C/E. "Cancel this venue" sits under the stepper, never beside it' % where,
           all(r['canx']['t'] >= r['step']['b'] - 1 for r in rows_geo), rows_geo)
        ok('%s: C/E. the two rows are the same shape and evenly spaced' % where,
           len(rows_geo) == 2 and abs((rows_geo[0]['row']['b'] - rows_geo[0]['row']['t']) - (rows_geo[1]['row']['b'] - rows_geo[1]['row']['t'])) <= 2
           and 6 <= rows_geo[1]['row']['t'] - rows_geo[0]['row']['b'] <= 12, rows_geo)
        shot(sid, 'venues-%d' % w, False)

        # D. the add-a-venue words, with the switch OFF (the rig's Worker has no VPB_BILLING_RULES_3NOV)
        note = S.js(sid, 'document.getElementById("addVenueNote").textContent') or ''
        ok('%s: D. the add-a-venue note is the truth today: "free until your next bill date, then ... a full month"' % where,
           note.startswith('Adding a venue puts it on this same account and bill, at your current rate, the same as your first venue. It is free until your next bill date, then it is charged a full month like your other venues.'), note)
        ok('%s: D. and no longer promises "first month is free" or "the credit comes off your next invoice"' % where,
           'first month is free' not in note and 'credit comes off' not in note, note)

        # 5. the add-players question
        S.js(sid, 'var r=document.querySelector("#venues .venue"); r.querySelector(\'.stepper button[data-d="1"]\').click(); r.querySelector(".save").click(); true')
        dlg = S.until(sid, '(function(){var d=document.getElementById("vpAddPlayers");if(!d)return null;return JSON.stringify({t:(document.getElementById("vpAddPlayersT")||{}).textContent,'
                           'd:(document.getElementById("vpAddPlayersD")||{}).textContent,b:[].map.call(d.querySelectorAll("button"),function(b){return b.textContent})});})()', 10)
        dlg = json.loads(dlg) if isinstance(dlg, str) else {}
        ok('%s: 5. the question is short and names the venue: "Add 1 player at Deepwater Hotel?"' % where, dlg.get('t') == 'Add 1 player at Deepwater Hotel?', dlg)
        ok('%s: 5/A. the money is one plain paragraph under it, and it is the TRUTH: a full month on the next bill, ready tonight, a decrease from the next bill' % where,
           dlg.get('d') == '$2.50 goes on your next bill: a full month for the extra player, whatever day you add them. The extra player is ready to use tonight. If you lower the number later, that takes effect from your next bill.', dlg)
        ok('%s: A. with the switch OFF there is no undo promise' % where, 'undo' not in (dlg.get('d') or ''), dlg)
        ok('%s: 5. the buttons say what they do: "Add 1 player" and "Not now", and nothing else' % where, sorted(dlg.get('b') or []) == ['Add 1 player', 'Not now'], dlg)
        shot(sid, 'account-addplayers-dialog-%d' % w, False)
        S.js(sid, 'document.getElementById("vpAddPlayersCancel").click(); true'); time.sleep(0.5)

        # 6. People
        tab(sid, 'people')
        ppl = S.json(sid, 'JSON.stringify({on:document.getElementById("tp-people").classList.contains("on"),hosts:!!document.querySelector("#tp-people #hosts"),'
                                    'notInBilling:!document.querySelector("#tp-billing #hosts"),at:document.getElementById("peopleAt").textContent,'
                                    'ticked:[].map.call(document.querySelectorAll("#host-venues .host-v:checked"),function(c){return c.value})})', {})
        cur = S.js(sid, 'document.querySelector("#acctPick select").value')
        ok('%s: 6. a People tab holds the hosts list, and Billing no longer does' % where, ppl.get('on') and ppl.get('hosts') and ppl.get('notInBilling'), ppl)
        ok('%s: 6. it says whose people it is showing: the venue chosen at the top' % where, ('Showing who can sign in at ' in (ppl.get('at') or '')), ppl)
        ok('%s: G. "Change the venue at the top" is said, because there IS a drop-down at the top (two venues)' % where, 'Change the venue at the top of the page' in (ppl.get('at') or ''), ppl)
        g = S.json(sid, """(function(){var t=document.getElementById("tp-people").innerText;var notes=[].map.call(document.querySelectorAll("#tp-people .label:not(#peopleHead) + .note"),function(n){return {b:(n.querySelector("b")||{}).textContent||"",len:n.textContent.length}});
            return JSON.stringify({signins:(t.match(/with a text code/g)||[]).length,theySign:/They sign in at/.test(t),notes:notes});})()""", {})
        ok('%s: G. ONE sign-in sentence for everyone, not one per role' % where, g.get('signins') == 1 and not g.get('theySign'), g)
        ok('%s: G. each role says what it can do in one line, the doing first in bold: Host, Manager, Marketing' % where,
           [n['b'] for n in (g.get('notes') or [])][:3] == ['Run the games on the night.', 'Run and set up the venues you give them.', 'See your numbers, the brand kit, your signs and your TV slides'] and all(n['len'] < 240 for n in (g.get('notes') or [])), g)
        ok('%s: 6. adding a person starts with that venue ticked' % where, ppl.get('ticked') == [cur], [ppl.get('ticked'), cur])
        S.js(sid, 'var s=document.querySelector("#acctPick select"); s.value="%s"; s.dispatchEvent(new Event("change",{bubbles:true})); true' % V1); time.sleep(0.8)
        at1 = S.js(sid, 'document.getElementById("hosts").innerText')
        S.js(sid, 'var s=document.querySelector("#acctPick select"); s.value="%s"; s.dispatchEvent(new Event("change",{bubbles:true})); true' % V2); time.sleep(0.8)
        at2 = S.js(sid, 'document.getElementById("hosts").innerText')
        ok('%s: 6. per venue: Harry Host (The Royal Arms only) is listed at The Royal Arms and not at Deepwater Hotel' % where,
           'Harry Host' in (at2 or '') and 'Harry Host' not in (at1 or ''), [at1, at2])
        shot(sid, 'account-people-%d' % w)

        # 8/12. one choice moves every tab
        tab(sid, 'draws')
        S.until(sid, 'document.getElementById("rfVenue").options.length>1 && document.getElementById("mdVenue").options.length>1', 15)
        S.js(sid, 'var s=document.querySelector("#acctPick select"); s.value="%s"; s.dispatchEvent(new Event("change",{bubbles:true})); true' % V2)
        moved = S.until(sid, 'document.getElementById("rfVenue").value==="%s" && document.getElementById("mdVenue").value==="%s" && document.getElementById("ntVenue").value==="%s"' % (V2, V2, V2), 15)
        ok('%s: 8/12. choosing The Royal Arms at the top moves Raffles, Members AND Nights to it' % where, moved is True,
           S.js(sid, 'JSON.stringify([document.getElementById("rfVenue").value,document.getElementById("mdVenue").value,document.getElementById("ntVenue").value])'))
        ok('%s: 8/12. no drop-down of its own on the Draws tab either' % where,
           S.js(sid, '[].filter.call(document.querySelectorAll("#tp-draws .screenpick"),function(e){return e.offsetParent!==null}).length') == 0)
        ok('%s: 8/12. and it is remembered for every other screen (vpCurrentVenue)' % where, S.js(sid, 'localStorage.getItem("vpCurrentVenue")') == V2)
        # 11. prizes, at Deepwater (the one with prizes)
        S.js(sid, 'var s=document.querySelector("#acctPick select"); s.value="%s"; s.dispatchEvent(new Event("change",{bubbles:true})); true' % V1)
        tally = S.until(sid, '(function(){var t=document.getElementById("rfTally").innerText;return /Cash:/.test(t)?t:null;})()', 15) or ''
        ok('%s: 11. prizes: cash on its own, "$800.00 across 3 prizes"' % where, 'Cash: $800.00 across 3 prizes' in tally, tally)
        ok('%s: 11. other prizes apart, "2 prizes, worth $150.00", and no one dollar total' % where,
           'Other prizes with a value entered: 2 prizes, worth $150.00' in tally and '950' not in tally and 'given away in prizes' not in tally, tally)
        shot(sid, 'account-draws-%d' % w)

        # F. Draws is three folds
        FOLDS = """JSON.stringify({heads:[].map.call(document.querySelectorAll("#tp-draws .acchead"),function(h){return {acc:h.getAttribute("data-acc"),open:h.classList.contains("open"),sum:(h.querySelector(".accsum")||{}).textContent||"",shown:h.offsetParent!==null}}),
            bodies:[].map.call(document.querySelectorAll("#tp-draws .accbody"),function(b){return {id:b.id,shown:b.offsetParent!==null}}),remembered:localStorage.getItem("vpDrawsFold"),
            h:document.getElementById("tp-draws").getBoundingClientRect().height})"""
        f = S.json(sid, FOLDS, {})
        ok('%s: F. three folds: Raffles, Members draws, Permits' % where, [x['acc'] for x in f.get('heads', [])] == ['raffles', 'members', 'permits'] and all(x['shown'] for x in f.get('heads', [])), f)
        ok('%s: F. only Raffles is open to start; the other two bodies are folded away' % where,
           [x['open'] for x in f.get('heads', [])] == [True, False, False] and [b['shown'] for b in f.get('bodies', [])] == [True, False, False], f)
        ok('%s: F. the headings say what is set: "Not on the TV yet" and "No draw yet" at this venue' % where,
           [x['sum'] for x in f.get('heads', [])][:2] == ['Not on the TV yet', 'No draw yet'], f)
        tall = f.get('h', 0)
        S.js(sid, 'document.querySelector(\'#tp-draws .acchead[data-acc="members"]\').click(); true'); time.sleep(0.4)
        f2 = S.json(sid, FOLDS, {})
        ok('%s: F. opening Members draws closes Raffles: one fold open at a time' % where,
           [x['open'] for x in f2.get('heads', [])] == [False, True, False] and [b['shown'] for b in f2.get('bodies', [])] == [False, True, False], f2)
        ok('%s: F. the open fold is remembered' % where, f2.get('remembered') == 'members', f2)
        ok('%s: F. the Draws tab is a fraction of its old height with the rest folded (under 2,600px here, was over 11,000 on a phone)' % where, 0 < tall < 2600 and 0 < f2.get('h', 0) < 3200, [tall, f2.get('h')])
        shot(sid, 'draws-folded-%d' % w)

        # 10. the open tab survives a reload; slides look finished
        S.js(sid, 'location.reload(); true'); time.sleep(1)
        S.until(sid, UP, 30); time.sleep(1.5)
        ok('%s: 10. after a reload the Draws tab is still the one open' % where,
           S.js(sid, 'document.getElementById("tp-draws").classList.contains("on") && document.querySelector(\'.tabs button[data-tab="draws"]\').classList.contains("on")') is True)
        f3 = S.json(sid, FOLDS, {})
        ok('%s: F. and after the reload Members draws is still the open fold' % where, [x['open'] for x in f3.get('heads', [])] == [False, True, False], f3)
        S.js(sid, 'localStorage.removeItem("vpDrawsFold"); true')
        tab(sid, 'screen')
        S.js(sid, 'document.getElementById("addSlide").click(); document.getElementById("addSlide").click(); true'); time.sleep(0.6)
        geo = S.json(sid, '(function(){var r=document.querySelector("#slides .adslide"),t=r.querySelector(".adthumb").getBoundingClientRect(),f=r.querySelector(".adfields").getBoundingClientRect(),rr=r.getBoundingClientRect();'
                                   'return JSON.stringify({ratio:t.width/t.height,tw:t.width,rw:rr.width,fieldsBelow:f.top>=t.bottom-1,label:getComputedStyle(r.querySelector(".adthumb"),"::before").content});})()', {})
        ok('%s: 10. a slide preview is the shape of the TV (16:9) and numbered' % where, 1.7 < geo.get('ratio', 0) < 1.85 and 'Slide' in (geo.get('label') or ''), geo)
        if w <= 560:   # the phone layout (billing.html's 560px break); an iPad gets the desktop one
            ok('%s: 10. on a phone the preview is full width with the settings under it' % where, geo.get('tw', 0) > geo.get('rw', 1) * 0.85 and geo.get('fieldsBelow'), geo)
        else:
            ok('%s: 10. on a desktop or iPad the settings sit beside the preview' % where, not geo.get('fieldsBelow'), geo)
        shot(sid, 'account-screen-%d' % w)
        ok('%s: no script errors on Your account' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)

        # 9. the monthly report, no venue in the address
        tid, sid = S.open('/app/report.html', w, h, mob)
        S.until(sid, '!document.getElementById("emptyState").classList.contains("hidden") || !document.getElementById("body").classList.contains("hidden") || document.getElementById("msg").textContent', 25)
        time.sleep(0.8)
        rep = S.json(sid, 'JSON.stringify({msg:document.getElementById("msg").textContent,empty:document.getElementById("emptyState").classList.contains("hidden")?"":document.getElementById("emptyState").innerText,'
                                   'pick:document.querySelectorAll("#venueWrap select").length,title:document.getElementById("title").textContent})', {})
        ok('%s: 9. no venue in the address: never "Pick one of your venues"' % where, 'Pick one' not in (rep.get('msg') or '') and not rep.get('msg'), rep)
        ok('%s: 9. no nights: a finished "No nights yet at ..." page, with what fills it in' % where,
           (rep.get('empty') or '').startswith('No nights yet at ') and 'Once you run your first game here' in (rep.get('empty') or ''), rep)
        ok('%s: 9. it follows the venue chosen elsewhere (The Royal Arms was last chosen, then Deepwater)' % where, 'Deepwater Hotel' in (rep.get('title') or ''), rep)
        ok('%s: 9. the same venue drop-down as every other screen' % where, rep.get('pick') == 1, rep)
        kt = S.json(sid, """(function(){var h=document.getElementById("title"),a=h.querySelector(".at");if(!a)return "{}";var r=document.createRange();r.setStart(h,0);r.setEnd(a,0);var m=r.getBoundingClientRect(),b=a.getBoundingClientRect();
            return JSON.stringify({month:h.firstChild.textContent,at:a.textContent,below:b.top>=m.bottom-2,lines:Math.round(m.height/parseFloat(getComputedStyle(h).lineHeight))});})()""", {})
        ok('%s: K. the title is the month on one line with "at Deepwater Hotel" under it, so the pub\'s name is never split' % where,
           kt.get('month') == 'October' and kt.get('at') == 'at Deepwater Hotel' and kt.get('below') and kt.get('lines') == 1, kt)
        shot(sid, 'report-%d' % w)
        ok('%s: no script errors on the report' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)

        # 13. Game settings
        tid, sid = S.open('/app/settings.html', w, h, mob)
        S.until(sid, '!document.getElementById("body").classList.contains("hidden") && !!document.querySelector("#setPick select")', 25)
        time.sleep(0.8)
        ST = ('JSON.stringify({opts:document.querySelectorAll("#setPick option").length,scope:!document.getElementById("scopeCard").classList.contains("hidden"),'
              'g:document.getElementById("scopeGroup").textContent,gon:document.getElementById("scopeGroup").classList.contains("on"),von:document.getElementById("scopeVenue").classList.contains("on"),'
              'v:document.getElementById("scopeVenue").textContent,pickShown:(function(){var p=document.getElementById("setPick");return !!(p&&!p.hidden&&p.offsetParent)})(),'
              'atTop:(function(){var c=document.getElementById("scopeCard"),p=document.getElementById("setPick"),v=document.getElementById("secVenue");return !!(c&&p&&v&&(c.compareDocumentPosition(p)&4)&&(c.compareDocumentPosition(v)&4))})(),'
              'note:document.getElementById("scopeNote").textContent})')
        st = S.json(sid, ST, {})
        ok('%s: 13. Game settings has the same venue drop-down, with both venues' % where, st.get('opts') == 2, st)
        shdr = S.json(sid, '(function(){var a=document.querySelector("header .hactions");var b=[].map.call(a.children,function(e){return {id:e.id,top:Math.round(e.getBoundingClientRect().top)}});return JSON.stringify({ids:b.map(function(x){return x.id}),tops:b.map(function(x){return x.top})});})()', {})
        ok('%s: B. Game settings too: Back, Help, Sign out on one line' % where, shdr.get('ids') == ['backLink', 'vphLink', 'signOut'] and len(set(shdr.get('tops') or [0, 1])) == 1, shdr)
        ok('%s: L. "Whole group (2 venues)" / "This venue" sits at the TOP of the page, above the drop-down and the venue code' % where,
           st.get('scope') and st.get('atTop') and st.get('g') == 'Whole group (2 venues)' and st.get('v') == 'This venue', st)
        ok('%s: L. Whole group is the default, and with it there is NO venue drop-down' % where, st.get('gon') and not st.get('von') and not st.get('pickShown'), st)
        ok('%s: L. the note says the settings save to both venues and the bingo permit stays here' % where,
           'save to all 2: ' in (st.get('note') or '') and 'Deepwater Hotel' in (st.get('note') or '') and 'The Royal Arms' in (st.get('note') or '') and 'bingo permit' in (st.get('note') or ''), st)
        shot(sid, 'settings-%d' % w)
        S.js(sid, 'document.getElementById("scopeVenue").click(); true'); time.sleep(0.3)
        st2 = S.json(sid, ST, {})
        ok('%s: L. This venue shows the drop-down, with both venues on it' % where, st2.get('von') and st2.get('pickShown') and st2.get('opts') == 2, st2)
        shot(sid, 'settings-thisvenue-%d' % w, False)
        S.js(sid, 'window.__saves=[];var f=VP.saveSettings;VP.saveSettings=function(id,p){window.__saves.push(id);return f.apply(this,arguments)};'
                  'document.getElementById("scopeGroup").click(); document.getElementById("saveBtn").click(); true')
        saved = S.until(sid, '/Saved/.test(document.getElementById("msg").textContent) ? JSON.stringify({s:window.__saves,m:document.getElementById("msg").textContent}) : null', 15)
        saved = json.loads(saved) if isinstance(saved, str) else {}
        ok('%s: 13. Whole group saves to BOTH venues, and says so' % where, sorted(saved.get('s') or []) == sorted([V1, V2]) and 'Also saved for 1 other venue in your group.' in (saved.get('m') or ''), saved)
        S.js(sid, 'document.getElementById("scopeVenue").click(); window.__saves=[]; document.getElementById("saveBtn").click(); true')
        one = S.until(sid, '(window.__saves||[]).length ? JSON.stringify(window.__saves) : null', 10)
        time.sleep(0.6)
        ok('%s: 13. This venue only saves to this venue only' % where, json.loads(one or '[]') == [S.js(sid, 'localStorage.getItem("vpCurrentVenue")')] and len(json.loads(one or '[]')) == 1, one)
        ok('%s: no script errors on Game settings' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)

    # A, D with Dean's switch ON (VPB_BILLING_RULES_3NOV=1 on the rig's Worker): the words follow the Worker
    print('\nYour account with the billing switch ON')
    S.W.env(VPB_BILLING_RULES_3NOV='1')
    try:
        tid, sid, up = account(1100, 950, False)
        note = S.js(sid, 'document.getElementById("addVenueNote").textContent') or ''
        ok('switch ON: D. the add-a-venue note is Dean\'s rule 3: a free month, then only the days after it on the next bill',
           'Its first month is free. After that it joins your billing cycle: your next bill charges only the days after its free month, then a full month like your other venues.' in note and 'free until your next bill date' not in note, note)
        S.js(sid, 'var r=document.querySelector("#venues .venue"); r.querySelector(\'.stepper button[data-d="1"]\').click(); r.querySelector(".save").click(); true')
        dlg = S.until(sid, '(function(){var d=document.getElementById("vpAddPlayers");if(!d)return null;return (document.getElementById("vpAddPlayersD")||{}).textContent;})()', 10) or ''
        ok('switch ON: A. the question adds Dean\'s undo line, word for word',
           dlg.endswith('Changed your mind? You can undo this within an hour, as long as no game has started.') and dlg.startswith('$2.50 goes on your next bill: a full month for the extra player'), dlg)
        S.js(sid, 'document.getElementById("vpAddPlayersCancel").click(); true')
        S.close_tab(tid)
    finally:
        S.W.env(VPB_BILLING_RULES_3NOV='')

    # 8. the console's pick is the venue Your account opens on
    print('\nthe console\'s Switch venue carries across')
    # A new shift: the console asks which venue (a pick older than 4 hours, or none, is asked again).
    tid, sid = S.open('/app/', 1100, 900, False, pre='try{localStorage.removeItem("vpVenuePick")}catch(e){}')
    S.until(sid, 'document.querySelectorAll("#venuePickList button").length > 1', 25)
    S.js(sid, '[].filter.call(document.querySelectorAll("#venuePickList button"),function(b){return b.textContent==="The Royal Arms"})[0].click(); true')
    ok('8. CONTROL: the console asked which venue, and The Royal Arms was picked there',
       S.until(sid, 'localStorage.getItem("vpCurrentVenue")==="%s"' % V2, 10) is True, S.js(sid, 'localStorage.getItem("vpCurrentVenue")'))
    S.close_tab(tid)
    tid, sid, up = account(1100, 900, False, pre=None)
    ok('8. picked The Royal Arms in the console: Your account opens on The Royal Arms', S.js(sid, 'document.querySelector("#acctPick select").value') == V2,
       S.js(sid, 'document.querySelector("#acctPick select") && document.querySelector("#acctPick select").value'))
    S.close_tab(tid)

    # 3. HQ's header
    print('\nHQ')
    for (w, h, mob) in ((1100, 900, False), (390, 844, True)):
        tid, sid = S.open('/app/hq.html?as=admin', w, h, mob)
        S.until(sid, '!!document.getElementById("hqTag")', 15); time.sleep(1.5)
        ok('%d wide: 3. the header says "admin" beside the logo, not "venueplay Admin"' % w,
           S.js(sid, 'document.getElementById("hqTag").innerText.trim().toLowerCase()==="admin" && !/venueplay admin/i.test(document.getElementById("hqTag").parentNode.innerText)') is True,
           S.js(sid, 'document.getElementById("hqTag").parentNode.innerText'))
        shot(sid, 'hq-header-%d' % w, False)
        S.close_tab(tid)
finally:
    S.close()

print('\n%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
