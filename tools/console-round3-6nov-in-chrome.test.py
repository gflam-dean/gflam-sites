#!/usr/bin/env python3
"""DEAN'S ROUND 3 NOTES ON THE HOST CONSOLE (4 Nov 2026, ~10:30am, for the Friday 6 Nov release), IN A REAL BROWSER.

~/venue-enrich/reports/console-hq-fixes-5nov/DEAN-NOTES.md, M to T. The shipped pages in headless Chrome against
the repo's rigs (tools/browser-rig/admin_site.py: the REAL billing Worker in jsc; tools/browser-rig/rig.py: the REAL
game Worker in jsc for the members console), at 1100, 820 (iPad) and 390 (phone) wide:

  M  "Switch venue" shows only for a host with more than one DISTINCT venue (an owner who is also the host at the
     same pub has two staff rows and one venue: no switch, no "Which venue are you at?")
  N  the Play screen carries no venue line for a one-venue host; a two-venue host sees "Tonight's games go to
     <venue>" with Switch venue beside it; the screen is named Play (its title and the header tag)
  O  every way back to the main screen says "Play": the console's own button, Your account, Game settings, and the
     trivia, musical bingo, raffle, members and purchase raffle consoles
  R  the one venue drop-down is the first thing under the title of Your account, above the tabs
  S  members draw setup: Start date, then Draw day, which fills itself from the date and can be typed over (Your
     account > Draws and the members console)
  T  the current jackpot reads; "Correct it" opens it for one save and only then is it sent (both places)
  Q  the raffle permit card hides while the venue's recorded prizes are under its state's line (VPPermits.RAFFLE,
     from the regulators' pages, 4 Nov 2026), with the sentence that says why and "Record a permit anyway"

Touches no git and no remote. One headless Chrome at a time (the heavy lock; VP_WAIT_LOCK seconds to wait).

    python3 tools/console-round3-6nov-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import gatelib  # noqa: E402
import admin_site  # noqa: E402

PASS, FAIL = [0], [0]
if not gatelib.hold_lock_or_refuse('console-round3-6nov-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    sys.exit(2)


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


WIDTHS = ((1100, 950, False), (820, 1180, True), (390, 844, True))
UP = ('document.getElementById("content") && document.getElementById("content").style.display!=="none" && '
      'document.getElementById("s-plan").textContent!=="–"')
# A spy on what Your account sends the game Worker (the rig has none: the page gets a 404 and says so).
SPY = ('(function(){window.__sent=[];var F=window.fetch;window.fetch=function(u,o){'
       'if(/\\/host\\/members\\/settings/.test(String(u))&&o&&o.body){try{window.__sent.push(JSON.parse(o.body))}catch(e){}}'
       'return F.apply(this,arguments);};})();')
REAL_FAKE_DB = admin_site.fake_db


def staff_db(kind):
    """The stand-in supabase-js's rows for one kind of login. one: owner of ONE venue; two-rows: owner AND host at
    that one venue (two staff rows, one venue); group: owner of two venues (the rig's default)."""
    def f(info, admin):
        db = REAL_FAKE_DB(info, admin)
        if kind in ('one', 'two-rows'):
            db['vp_venues'] = [db['vp_venues'][0]]
            db['vp_venue_staff'] = [s for s in db['vp_venue_staff'] if s['venue_id'] == info['venue']]
            if kind == 'two-rows':
                db['vp_venue_staff'].append({'auth_user_id': info['uid'], 'venue_id': info['venue'], 'role': 'host', 'display_name': 'Olive Owner'})
        return db
    return f


def tab(S, sid, name):
    S.js(sid, 'document.querySelector(\'.tabs button[data-tab="%s"]\').click(); true' % name)
    time.sleep(1.2)


def fold(S, sid, name):
    S.js(sid, 'var h=document.querySelector(\'#tp-draws .acchead[data-acc="%s"]\'); if(h && !h.classList.contains("open")) h.click(); true' % name)
    time.sleep(0.8)


FRESH = 'try{localStorage.removeItem("vpVenuePick");localStorage.removeItem("vpCurrentVenue");localStorage.removeItem("vpAcctTab");localStorage.removeItem("vpDrawsFold")}catch(e){}'
CONSOLE_UP = '!document.getElementById("vConsole").classList.contains("hidden") && !document.getElementById("gameSelect").classList.contains("hidden")'
PLAY = ('JSON.stringify({sw:(function(e){return !!(e&&e.offsetParent)})(document.getElementById("switchVenue")),'
        'banner:(function(e){return !!(e&&e.offsetParent)})(document.getElementById("venueBanner")),'
        'bname:(document.getElementById("venueBannerName")||{}).textContent,'
        'bbtn:(document.getElementById("venueSwitchInline")||{}).textContent,'
        'title:(document.querySelector("#gameSelect .playtitle")||{}).textContent,tag:document.getElementById("headerTag").textContent,'
        'pick:!document.getElementById("vVenuePick").classList.contains("hidden"),'
        'back:document.getElementById("gamesBack").textContent.trim(),backShown:document.getElementById("gamesBack").style.display!=="none"})')


def console_section(kind, label):
    print('\nTHE CONSOLE as %s' % label)
    admin_site.fake_db = staff_db(kind)
    S = admin_site.Site()
    try:
        for (w, h, mob) in WIDTHS:
            where = '%d wide' % w
            tid, sid = S.open('/app/', w, h, mob, pre=FRESH)
            if kind == 'group':
                asked = S.until(sid, 'document.querySelectorAll("#venuePickList button").length > 1', 25)
                ok('%s: M. a two-venue host is asked "Which venue are you at?" on a fresh shift' % where, asked is True)
                S.js(sid, '[].filter.call(document.querySelectorAll("#venuePickList button"),function(b){return b.textContent==="Deepwater Hotel"})[0].click(); true')
            up = S.until(sid, CONSOLE_UP, 30)
            time.sleep(1.0)
            p = json.loads(S.js(sid, PLAY) or '{}')
            ok('%s: CONTROL: the console landed on the Play screen' % where, up is True and p.get('title') == 'Play', p)
            if kind != 'group':
                ok('%s: M. %s: no "Which venue are you at?" question' % (where, label), p.get('pick') is False, p)
                ok('%s: M. %s: no Switch venue button in the header' % (where, label), p.get('sw') is False, p)
                ok('%s: N. %s: no venue line on the Play screen (they have no choice to make)' % (where, label), p.get('banner') is False, p)
            else:
                ok('%s: M. a two-venue host has Switch venue in the header' % where, p.get('sw') is True, p)
                ok('%s: N. and the Play screen says where tonight\'s games go: Deepwater Hotel, with Switch venue beside it' % where,
                   p.get('banner') is True and p.get('bname') == 'Deepwater Hotel' and p.get('bbtn') == 'Switch venue', p)
                ok('%s: N. the old "You are running games at ... Not this one?" words are gone' % where,
                   S.js(sid, '!/running games at|Not this one/.test(document.getElementById("gameSelect").innerText)') is True)
            ok('%s: N. the screen is named for what it is: the title and the header tag both say Play, and no back button on it' % where,
               p.get('title') == 'Play' and p.get('tag') == 'Play' and p.get('backShown') is False, p)
            # O: pick bingo, the way back says Play
            S.js(sid, 'document.querySelector(\'#gamePicker .pk[data-game="bingo"]\').click(); true')
            S.until(sid, '!document.getElementById("bingoView").classList.contains("hidden")', 15); time.sleep(0.5)
            p2 = json.loads(S.js(sid, PLAY) or '{}')
            ok('%s: O. in bingo setup the way back says "Play", not "Games"' % where, p2.get('backShown') is True and p2.get('back').endswith('Play') and 'Games' not in p2.get('back', ''), p2)
            S.js(sid, 'document.getElementById("gamesBack").click(); true'); time.sleep(0.4)
            ok('%s: O. and it goes back to Play' % where, S.js(sid, CONSOLE_UP) is True and json.loads(S.js(sid, PLAY) or '{}').get('tag') == 'Play')
            ok('%s: no script errors on the console' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
            S.close_tab(tid)
    finally:
        S.close()
        admin_site.fake_db = REAL_FAKE_DB


try:
    console_section('one', 'the owner of ONE venue')
    console_section('two-rows', 'a login with TWO staff rows at ONE venue (owner and host at the same pub)')
    console_section('group', 'the owner of TWO venues')

    print('\nO. every console\'s way back says Play (the shipped markup, as served)')
    S = admin_site.Site()
    try:
        tid, sid = S.open('/app/billing.html', 1100, 950, False)
        S.until(sid, UP, 30)
        for page, sel in (('/app/trivia/host.html', '.vp-navlink'), ('/app/musical/host.html', '.vp-navlink'), ('/app/raffle/host.html', '.vp-navlink'),
                          ('/app/members/host.html', '.vp-navlink'), ('/app/purchase-raffle/index.html', '.navlink'), ('/app/trivia/builder.html', 'a.back'),
                          ('/app/marketing.html', '#toConsole')):
            txt = S.js(sid, 'fetch(%s).then(function(r){return r.text()}).then(function(t){var d=new DOMParser().parseFromString(t,"text/html");var a=d.querySelector(%s);return a?a.textContent.trim():"(none)"})' % (json.dumps(page), json.dumps(sel)), wait=True, secs=15)
            ok('O. %s: the way back says "Play"' % page, isinstance(txt, str) and txt.endswith('Play') and 'Games' not in txt and 'All games' not in txt, txt)
        S.close_tab(tid)

        V1, V2 = S.W.info['venue'], S.W.info['venue2']
        # Q: Deepwater has $950 of valued prizes recorded (3 cash, 2 others); The Royal Arms none.
        S.extra_db['v_vp_prizes_given'] = [{'venue_id': V1, 'prizes_given_count': 5, 'prizes_given_value_cents': 95000,
                                            'cash_given_count': 3, 'cash_given_value_cents': 80000}]
        for (w, h, mob) in WIDTHS:
            where = '%d wide' % w
            print('\nYour account, %s' % where)
            tid, sid = S.open('/app/billing.html', w, h, mob, pre=FRESH + SPY)
            up = S.until(sid, UP, 30)
            S.until(sid, '!!document.querySelector("#acctPick select")', 10); time.sleep(0.8)
            ok('%s: CONTROL: Your account is up, from the real Worker' % where, up is True)
            # R
            r = json.loads(S.js(sid, '(function(){var a=document.getElementById("acctPick"),t=document.querySelector(".tabs"),h=document.querySelector("h1");'
                                     'var between=[];var n=h?h.nextElementSibling:null;while(n&&n!==a&&n.id!=="content"){if(n.offsetParent)between.push(n.tagName+"#"+n.id);n=n.nextElementSibling;}'
                                     'return JSON.stringify({above:!!(a&&t&&(a.compareDocumentPosition(t)&4)),shown:!!(a&&a.offsetParent),label:(a.querySelector(".vp-pick-label,label")||{}).textContent,'
                                     'between:between,aTop:a?Math.round(a.getBoundingClientRect().top):0,tTop:t?Math.round(t.getBoundingClientRect().top):0});})()') or '{}')
            ok('%s: R. the venue drop-down sits at the TOP of Your account: above the tabs, with only the title and its one line before it' % where,
               r.get('above') and r.get('shown') and r.get('aTop', 1) < r.get('tTop', 0) and all(b.startswith('P#') for b in r.get('between', [])), r)
            ok('%s: O. Your account\'s way back says "Play"' % where, (S.js(sid, 'document.getElementById("backLink").textContent.trim()') or '').endswith('Play'))

            # S and T, Your account > Draws > Members draws
            tab(S, sid, 'draws'); fold(S, sid, 'members')
            S.until(sid, 'document.getElementById("mdList").textContent.length > 0', 15); time.sleep(0.5)
            md = json.loads(S.js(sid, '(function(){var d=document.getElementById("md-day"),s=document.getElementById("md-start"),c=document.getElementById("md-curjp");'
                                      'var ids=[].map.call(document.querySelectorAll(".mdgrid .mdf label"),function(l){return l.getAttribute("for")});'
                                      'return JSON.stringify({dayTag:d.tagName,dayRO:d.readOnly,order:ids,curRO:c.readOnly,fix:(document.getElementById("mdCurFix")||{}).textContent,'
                                      'startBeforeDay:ids.indexOf("md-start")>=0&&ids.indexOf("md-start")<ids.indexOf("md-day")});})()') or '{}')
            ok('%s: S. Start date comes before Draw day, and Draw day is a typeable box, not a drop-down' % where,
               md.get('startBeforeDay') and md.get('dayTag') == 'INPUT' and md.get('dayRO') is False, md)
            S.js(sid, 'var s=document.getElementById("md-start"); s.value="2026-11-06"; s.dispatchEvent(new Event("input",{bubbles:true})); s.dispatchEvent(new Event("change",{bubbles:true})); true')
            ok('%s: S. picking Friday 6 Nov 2026 as the start date fills Draw day with "Friday"' % where, S.js(sid, 'document.getElementById("md-day").value') == 'Friday')
            S.js(sid, 'var d=document.getElementById("md-day"); d.value="Saturday"; d.dispatchEvent(new Event("input",{bubbles:true})); true')
            ok('%s: S. and the host can type over it (Saturday)' % where, S.js(sid, 'document.getElementById("md-day").value') == 'Saturday')
            ok('%s: T. the current jackpot reads only, with a "Correct it" action beside it' % where, md.get('curRO') is True and md.get('fix') == 'Correct it', md)
            # a save that never touched the jackpot does not send it
            S.js(sid, 'document.getElementById("md-name").value="Friday Members Draw"; window.__sent=[]; document.getElementById("mdSave").click(); true')
            sent = S.until(sid, '(window.__sent||[]).length ? JSON.stringify(window.__sent) : null', 10)
            sent = json.loads(sent) if isinstance(sent, str) else []
            ok('%s: T. Save draw with the jackpot untouched sends no current_jackpot_cents' % where, len(sent) == 1 and 'current_jackpot_cents' not in sent[0] and sent[0].get('name') == 'Friday Members Draw', sent)
            time.sleep(1.0)
            S.js(sid, 'document.getElementById("mdCurFix").click(); true'); time.sleep(0.2)
            t2 = json.loads(S.js(sid, 'JSON.stringify({ro:document.getElementById("md-curjp").readOnly,fix:document.getElementById("mdCurFix").textContent,note:document.getElementById("mdCurNote").textContent})') or '{}')
            ok('%s: T. "Correct it" opens the box for this one save and says what happens: the amount goes on the TV with the save' % where,
               t2.get('ro') is False and t2.get('fix') == 'Keep what it was' and 'Save draw' in (t2.get('note') or ''), t2)
            S.js(sid, 'var c=document.getElementById("md-curjp"); c.value="275"; c.dispatchEvent(new Event("input",{bubbles:true})); window.__sent=[]; document.getElementById("mdSave").click(); true')
            sent = S.until(sid, '(window.__sent||[]).length ? JSON.stringify(window.__sent) : null', 10)
            sent = json.loads(sent) if isinstance(sent, str) else []
            ok('%s: T. after a correction, Save draw sends the corrected jackpot ($275)' % where, len(sent) == 1 and sent[0].get('current_jackpot_cents') == 27500, sent)

            # Q, the Permits fold
            fold(S, sid, 'permits')
            below = S.until(sid, '(function(){var b=document.querySelector("#drawPermits .vpp-below");return b?b.textContent:null;})()', 15) or ''
            kinds = S.js(sid, '[].map.call(document.querySelectorAll("#drawPermits .permit"),function(p){return p.getAttribute("data-kind")}).join(",")')
            ok('%s: Q. Deepwater (NSW, $950 given away): the raffle permit card is hidden; only the members-draw card shows' % where, kinds == 'members', kinds)
            ok('%s: Q. the line says why, with the state\'s own figure: an authority over $30,000 in total prizes, and the $950 recorded here' % where,
               'Raffle permit: not needed yet.' in below and 'over $30,000 in total prizes' in below and 'add up to $950' in below, below)
            ok('%s: Q. the fold\'s heading says so too: "Members draw, raffle not needed yet"' % where,
               S.js(sid, 'document.getElementById("pmSum").textContent') == 'Members draw, raffle not needed yet', S.js(sid, 'document.getElementById("pmSum").textContent'))
            S.js(sid, 'document.querySelector("#drawPermits .pshowraffle").click(); true'); time.sleep(0.4)
            kinds = S.js(sid, '[].map.call(document.querySelectorAll("#drawPermits .permit"),function(p){return p.getAttribute("data-kind")}).join(",")')
            ok('%s: Q. "Record a permit anyway" brings the raffle card up (a charity\'s big raffle, say), and nothing is lost' % where, kinds == 'raffle,members', kinds)
            # the table itself, the figures from the regulators' pages
            T = json.loads(S.js(sid, 'JSON.stringify(VPPermits.RAFFLE)') or '{}')
            want = {'NSW': (3000000, 'prizes'), 'QLD': (5000000, 'sales'), 'VIC': (2306000, 'prizes'), 'SA': (500000, 'prizes'),
                    'WA': (200000, 'prizes'), 'TAS': (1000000, 'prizes'), 'ACT': (250000, 'prizes'), 'NT': (500000, 'sales')}
            ok('%s: Q. the table has every state and territory with the researched line: NSW $30,000, QLD $50,000 sales, VIC $23,060, SA $5,000, WA $2,000, TAS $10,000, ACT $2,500, NT $5,000 sales' % where,
               all((T.get(k) or {}).get('cents') == v[0] and (T.get(k) or {}).get('measure') == v[1] for k, v in want.items()) and len(T) == 8, T)
            ok('%s: Q. nothing on the Permits fold names musical bingo' % where, S.js(sid, '!/musical/i.test(document.getElementById("acc-permits").innerText)') is True)
            # The Royal Arms: nothing given away, so $0 and hidden too
            S.js(sid, 'var s=document.querySelector("#acctPick select"); s.value="%s"; s.dispatchEvent(new Event("change",{bubbles:true})); true' % V2)
            b2 = S.until(sid, '(function(){var b=document.querySelector("#drawPermits .vpp-below");return (b&&document.getElementById("pmPickName").textContent==="The Royal Arms")?b.textContent:null;})()', 15) or ''
            ok('%s: Q. The Royal Arms, nothing recorded: hidden too, "$0"' % where, 'add up to $0,' in b2 or 'add up to $0 ' in b2 or b2.rstrip().endswith('$0, so there is nothing to record yet.'), b2)
            ok('%s: no script errors on Your account' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
            S.close_tab(tid)

            # Game settings: O
            tid, sid = S.open('/app/settings.html', w, h, mob)
            S.until(sid, '!document.getElementById("body").classList.contains("hidden")', 25); time.sleep(0.5)
            ok('%s: O. Game settings\' way back says "Play"' % where, (S.js(sid, 'document.getElementById("backLink").textContent.trim()') or '').endswith('Play'))
            S.close_tab(tid)

        # Q: over the line, the card shows on its own
        print('\nQ. over the line')
        S.extra_db['v_vp_prizes_given'] = [{'venue_id': V1, 'prizes_given_count': 40, 'prizes_given_value_cents': 3100000,
                                            'cash_given_count': 30, 'cash_given_value_cents': 2500000}]
        tid, sid = S.open('/app/billing.html', 1100, 950, False, pre=FRESH)
        S.until(sid, UP, 30); S.until(sid, '!!document.querySelector("#acctPick select")', 10)
        S.js(sid, 'var s=document.querySelector("#acctPick select"); s.value="%s"; s.dispatchEvent(new Event("change",{bubbles:true})); true' % V1)
        tab(S, sid, 'draws'); fold(S, sid, 'permits')
        shown = S.until(sid, 'document.querySelectorAll("#drawPermits .permit").length===2 ? [].map.call(document.querySelectorAll("#drawPermits .permit"),function(p){return p.getAttribute("data-kind")}).join(",") : null', 15)
        ok('Q. Deepwater with $31,000 given away (over NSW\'s $30,000): the raffle card shows on its own, no line, no link', shown == 'raffle,members' and S.js(sid, '!document.querySelector("#drawPermits .vpp-below")') is True, shown)
        S.close_tab(tid)
    finally:
        S.close()

    # The members console: S and T against the REAL game Worker
    print('\nTHE MEMBERS CONSOLE (the real game Worker)')
    import rig as RIG
    r = RIG.Rig(host_pages=('/app/members/host.html',))
    try:
        tid, sid = r.open('/app/members/host.html', width=1024, height=900)
        r.until(sid, 'document.getElementById("saveSettingsBtn") && /Create draw|Save settings/.test(document.getElementById("saveSettingsBtn").textContent)', 30)
        time.sleep(0.8)
        ok('O. the members console\'s way back says "Play"', (r.ask(sid, 'document.querySelector(".vp-navlink").textContent.trim()') or '').endswith('Play'))
        r.ask(sid, 'document.getElementById("membersAdv").open=true; true')
        m = json.loads(r.ask(sid, '(function(){var ids=[].map.call(document.querySelectorAll("#membersAdv .field label"),function(l){return l.textContent.trim()});'
                                  'return JSON.stringify({order:ids,dayTag:document.getElementById("setDay").tagName,dayRO:document.getElementById("setDay").readOnly,'
                                  'curRO:document.getElementById("setCur").readOnly,fix:document.getElementById("setCurFix").textContent});})()') or '{}')
        order = m.get('order') or []
        ok('S. Advanced settings: Start date, then Draw day, as on Your account; Draw day a typeable box', order[:3] == ['Draw name', 'Start date', 'Draw day'] and m.get('dayTag') == 'INPUT' and m.get('dayRO') is False, m)
        r.ask(sid, 'var s=document.getElementById("setSince"); s.value="2026-11-06"; s.dispatchEvent(new Event("change",{bubbles:true})); true')
        ok('S. the start date fills Draw day: Friday', r.ask(sid, 'document.getElementById("setDay").value') == 'Friday')
        ok('T. the current jackpot reads only, with "Correct it" beside it', m.get('curRO') is True and m.get('fix') == 'Correct it', m)
        # create the draw with a $100 start, then correct the jackpot to $123 and save: only the corrected save carries it
        r.ask(sid, 'document.getElementById("setName").value="Friday Members Draw"; document.getElementById("setStart").value="100"; document.getElementById("setInc").value="50"; document.getElementById("setTime").value="7:30pm"; document.getElementById("saveSettingsBtn").click(); true')
        made = r.until(sid, '/Draw created|Saved/.test(document.getElementById("settingsMsg").textContent) || document.getElementById("saveSettingsBtn").textContent==="Save settings"', 20)
        ok('CONTROL: the draw was created through the real Worker', made is not False, r.ask(sid, 'document.getElementById("settingsMsg").textContent'))

        def draws():
            with r.W.lock:
                r.W.p.stdin.write(json.dumps({'table': 'vp_member_draws'}) + '\n'); r.W.p.stdin.flush()
                line = r.W.p.stdout.readline()
            return (json.loads(line) or {}).get('body') if line else []
        d0 = [d for d in (draws() or []) if d.get('name') == 'Friday Members Draw']
        ok('CONTROL: the Worker holds it, jackpot at the $100 start', len(d0) == 1 and d0[0].get('current_jackpot_cents') == 10000, d0)
        r.ask(sid, 'document.getElementById("setInc").value="60"; document.getElementById("saveSettingsBtn").click(); true'); time.sleep(1.5)
        d1 = [d for d in (draws() or []) if d.get('name') == 'Friday Members Draw']
        ok('T. a save of the weekly increment alone leaves the jackpot where the draw had it', len(d1) == 1 and d1[0].get('current_jackpot_cents') == 10000 and d1[0].get('increment_cents') == 6000, d1)
        r.ask(sid, 'document.getElementById("setCurFix").click(); true'); time.sleep(0.2)
        ok('T. "Correct it" opens the box and names the way out: Save settings', r.ask(sid, 'document.getElementById("setCur").readOnly===false && /Save settings/.test(document.getElementById("setCurNote").textContent) && document.getElementById("setCurFix").textContent==="Keep what it was"') is True)
        r.ask(sid, 'document.getElementById("setCur").value="123"; document.getElementById("saveSettingsBtn").click(); true'); time.sleep(1.5)
        d2 = [d for d in (draws() or []) if d.get('name') == 'Friday Members Draw']
        ok('T. after the correction, Save settings sends it: the Worker holds $123', len(d2) == 1 and d2[0].get('current_jackpot_cents') == 12300, d2)
        ok('T. and the box is read-only again after the save', r.ask(sid, 'document.getElementById("setCur").readOnly') is True)
        ok('no script errors on the members console', r.ask(sid, '(window.__errs||[]).length') == 0, r.ask(sid, 'JSON.stringify(window.__errs||[])'))
        r.close_tab(tid)
    finally:
        r.close()
finally:
    admin_site.fake_db = REAL_FAKE_DB

print('\n%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
