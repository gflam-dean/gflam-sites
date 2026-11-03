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

Touches no git and no remote. Screenshots with --shots DIR (the after pictures for Dean).

    python3 tools/console-hq-5nov-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]


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
    for (w, h, mob) in ((1100, 950, False), (390, 844, True)):
        where = '%d wide' % w
        print('\nYour account, %s' % where)
        tid, sid, up = account(w, h, mob)
        ok('%s: CONTROL: the Billing tab is up, from the real Worker' % where, up is True, S.js(sid, 'document.getElementById("loading").textContent'))
        rows = json.loads(S.js(sid, ROWS) or '[]')
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
        if w == 1100:
            shot(sid, 'account-billing-1100')
        else:
            shot(sid, 'account-billing-390')

        # 5. the add-players question
        S.js(sid, 'var r=document.querySelector("#venues .venue"); r.querySelector(\'.stepper button[data-d="1"]\').click(); r.querySelector(".save").click(); true')
        dlg = S.until(sid, '(function(){var d=document.getElementById("vpAddPlayers");if(!d)return null;return JSON.stringify({t:(document.getElementById("vpAddPlayersT")||{}).textContent,'
                           'd:(document.getElementById("vpAddPlayersD")||{}).textContent,b:[].map.call(d.querySelectorAll("button"),function(b){return b.textContent})});})()', 10)
        dlg = json.loads(dlg) if isinstance(dlg, str) else {}
        ok('%s: 5. the question is short and names the venue: "Add 1 player at Deepwater Hotel?"' % where, dlg.get('t') == 'Add 1 player at Deepwater Hotel?', dlg)
        ok('%s: 5. the money is one plain paragraph under it' % where, dlg.get('d') == 'This adds $2.50 to your next bill. The extra player is available straight away.', dlg)
        ok('%s: 5. the buttons say what they do: "Add 1 player" and "Not now"' % where, 'Add 1 player' in (dlg.get('b') or []) and 'Not now' in (dlg.get('b') or []), dlg)
        shot(sid, 'account-addplayers-dialog-%d' % w, False)
        S.js(sid, 'document.getElementById("vpAddPlayersCancel").click(); true'); time.sleep(0.5)

        # 6. People
        tab(sid, 'people')
        ppl = json.loads(S.js(sid, 'JSON.stringify({on:document.getElementById("tp-people").classList.contains("on"),hosts:!!document.querySelector("#tp-people #hosts"),'
                                    'notInBilling:!document.querySelector("#tp-billing #hosts"),at:document.getElementById("peopleAt").textContent,'
                                    'ticked:[].map.call(document.querySelectorAll("#host-venues .host-v:checked"),function(c){return c.value})})') or '{}')
        cur = S.js(sid, 'document.querySelector("#acctPick select").value')
        ok('%s: 6. a People tab holds the hosts list, and Billing no longer does' % where, ppl.get('on') and ppl.get('hosts') and ppl.get('notInBilling'), ppl)
        ok('%s: 6. it says whose people it is showing: the venue chosen at the top' % where, ('Showing who can sign in at ' in (ppl.get('at') or '')), ppl)
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

        # 10. the open tab survives a reload; slides look finished
        S.js(sid, 'location.reload(); true'); time.sleep(1)
        S.until(sid, UP, 30); time.sleep(1.5)
        ok('%s: 10. after a reload the Draws tab is still the one open' % where,
           S.js(sid, 'document.getElementById("tp-draws").classList.contains("on") && document.querySelector(\'.tabs button[data-tab="draws"]\').classList.contains("on")') is True)
        tab(sid, 'screen')
        S.js(sid, 'document.getElementById("addSlide").click(); document.getElementById("addSlide").click(); true'); time.sleep(0.6)
        geo = json.loads(S.js(sid, '(function(){var r=document.querySelector("#slides .adslide"),t=r.querySelector(".adthumb").getBoundingClientRect(),f=r.querySelector(".adfields").getBoundingClientRect(),rr=r.getBoundingClientRect();'
                                   'return JSON.stringify({ratio:t.width/t.height,tw:t.width,rw:rr.width,fieldsBelow:f.top>=t.bottom-1,label:getComputedStyle(r.querySelector(".adthumb"),"::before").content});})()') or '{}')
        ok('%s: 10. a slide preview is the shape of the TV (16:9) and numbered' % where, 1.7 < geo.get('ratio', 0) < 1.85 and 'Slide' in (geo.get('label') or ''), geo)
        if mob:
            ok('%s: 10. on a phone the preview is full width with the settings under it' % where, geo.get('tw', 0) > geo.get('rw', 1) * 0.85 and geo.get('fieldsBelow'), geo)
        else:
            ok('%s: 10. on a desktop the settings sit beside the preview' % where, not geo.get('fieldsBelow'), geo)
        shot(sid, 'account-screen-%d' % w)
        ok('%s: no script errors on Your account' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)

        # 9. the monthly report, no venue in the address
        tid, sid = S.open('/app/report.html', w, h, mob)
        S.until(sid, '!document.getElementById("emptyState").classList.contains("hidden") || !document.getElementById("body").classList.contains("hidden") || document.getElementById("msg").textContent', 25)
        time.sleep(0.8)
        rep = json.loads(S.js(sid, 'JSON.stringify({msg:document.getElementById("msg").textContent,empty:document.getElementById("emptyState").classList.contains("hidden")?"":document.getElementById("emptyState").innerText,'
                                   'pick:document.querySelectorAll("#venueWrap select").length,title:document.getElementById("title").textContent})') or '{}')
        ok('%s: 9. no venue in the address: never "Pick one of your venues"' % where, 'Pick one' not in (rep.get('msg') or '') and not rep.get('msg'), rep)
        ok('%s: 9. no nights: a finished "No nights yet at ..." page, with what fills it in' % where,
           (rep.get('empty') or '').startswith('No nights yet at ') and 'Once you run your first game here' in (rep.get('empty') or ''), rep)
        ok('%s: 9. it follows the venue chosen elsewhere (The Royal Arms was last chosen, then Deepwater)' % where, 'Deepwater Hotel' in (rep.get('title') or ''), rep)
        ok('%s: 9. the same venue drop-down as every other screen' % where, rep.get('pick') == 1, rep)
        shot(sid, 'report-%d' % w)
        ok('%s: no script errors on the report' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)

        # 13. Game settings
        tid, sid = S.open('/app/settings.html', w, h, mob)
        S.until(sid, '!document.getElementById("body").classList.contains("hidden") && !!document.querySelector("#setPick select")', 25)
        time.sleep(0.8)
        st = json.loads(S.js(sid, 'JSON.stringify({opts:document.querySelectorAll("#setPick option").length,scope:!document.getElementById("scopeCard").classList.contains("hidden"),'
                                  'g:document.getElementById("scopeGroup").textContent,v:document.getElementById("scopeVenue").className})') or '{}')
        ok('%s: 13. Game settings has the same venue drop-down, with both venues' % where, st.get('opts') == 2, st)
        ok('%s: 13. "This venue only" (chosen) or "Whole group (2 venues)"' % where, st.get('scope') and st.get('g') == 'Whole group (2 venues)' and 'on' in (st.get('v') or ''), st)
        shot(sid, 'settings-%d' % w)
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
