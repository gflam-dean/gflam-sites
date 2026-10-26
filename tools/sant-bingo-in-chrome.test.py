#!/usr/bin/env python3
"""NUMBER BINGO FOR SA AND NT PUBS, IN THE REAL PAGES, IN HEADLESS CHROME.

Dean, 22 Oct 2026: in South Australia only a not-for-profit may run bingo, in the Northern Territory
only an approved association, so an SA or NT pub never sees number bingo (not a greyed tile: staff
would think it was broken), and HQ can switch it on for a venue whose bingo a not-for-profit runs
(migration 116). "Better to be honest from the beginning": the signup says so, HQ says so. Musical
bingo is not bingo and is never touched. tools/test-sant-bingo.js and tools/test-sant-bingo-game.js
run the rule and the Workers; this runs the PAGES a person sees.

Part 1, the console and the signup page (tools/browser-rig/rig.py: the repo's pages, the real game
Worker in jsc, supabase-js faked):
  - an SA pub's games menu has no Bingo tile, and Musical Bingo, Trivia, Raffle and Members Draw are all
    there; a click that reaches the hidden tile (a stale page, a script) does not open bingo
  - an NT pub the same; an SA club, a Queensland pub and an NT pub HQ has switched on all have Bingo
  - the signup page: a pub with an SA postcode is told, in the page, before paying, and offered the
    "our bingo is run by a not-for-profit" tick; an NT postcode names the Northern Territory; a club or a
    Queensland pub sees nothing; the tick reaches /checkout as bingo_review on that venue
Part 2, HQ and the account pages (tools/browser-rig/admin_site.py: the REAL billing Worker in jsc):
  - HQ's venue card says number bingo is hidden for the SA pub and the NT venue not yet recorded as a
    club, says nothing for the SA club or the Queensland pub, and the switch writes number_bingo_on with
    an audit row and reads back after a reload
  - HQ's Add venue form and the full onboarding page say it the moment an SA or NT postcode goes in for a pub
  - the account page asks an SA pub for no bingo permit; an SA club still has the bingo card
  - the members draw console at an SA pub has no "Not here: jackpot to next week" button

    python3 tools/sant-bingo-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig as RIG  # noqa: E402
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    if not cond:
        bad += 1


TILE = ('(function(g){var e=document.querySelector(\'#gamePicker [data-game="\'+g+\'"]\');if(!e)return false;'
        'var s=getComputedStyle(e),b=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')
def tile(r, sid, g): return r.ask(sid, TILE + '(%s)' % json.dumps(g))
def tiles(r, sid): return r.ask(sid, '[].filter.call(document.querySelectorAll("#gamePicker .pk"),function(e){return e.getBoundingClientRect().width>0;}).map(function(e){return e.getAttribute("data-game");}).join(",")')


# ------------------------------------------------------------------ part 1
print('part 1: the console and the signup page')
r = RIG.Rig()


def shot1(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        r.shot(sid, os.path.join(A.shots, name + '.jpg'))


def as_venue(**kw):
    v = r.db['vp_venues'][0]
    for k in ('au_state', 'postcode', 'entity_type', 'number_bingo_on', 'name'):
        v.pop(k, None)
    v.update(kw)


def console(label, width=1024, height=900):
    tid, sid = r.open('/app/', width=width, height=height)
    up = r.until(sid, '!!document.querySelector(\'#gamePicker [data-game="trivia"]\') && document.querySelector(\'#gamePicker [data-game="trivia"]\').offsetParent!==null', 30)
    time.sleep(1.2)
    return tid, sid, up


try:
    as_venue(name='Royal Hotel', au_state='QLD', postcode='4000', entity_type='for_profit')
    tid, sid, up = console('qld pub')
    ok('CONTROL: a Queensland pub\'s games menu has Bingo and all five games', up is True and tiles(r, sid) == 'bingo,trivia,musical-bingo,raffle,members-draw', tiles(r, sid))
    shot1(sid, 'console-qld-pub')
    r.close_tab(tid)

    as_venue(name='Glenelg Tavern', au_state='SA', postcode='5045', entity_type='for_profit', number_bingo_on=False)
    tid, sid, up = console('sa pub')
    ok('an SA pub: NO Bingo tile', up is True and tile(r, sid, 'bingo') is False, tiles(r, sid))
    ok('...and Trivia, Musical Bingo, Raffle and Members Draw are all there (musical bingo is not bingo)', tiles(r, sid) == 'trivia,musical-bingo,raffle,members-draw', tiles(r, sid))
    ok('...and no HQ note for the venue\'s own staff', r.ask(sid, 'document.getElementById("noBingoHq").classList.contains("hidden")') is True)
    shot1(sid, 'console-sa-pub')
    r.ask(sid, 'document.querySelector(\'#gamePicker [data-game="bingo"]\').click(); true')
    time.sleep(0.8)
    ok('a click that reaches the hidden tile does not open bingo: still on the games menu',
       r.ask(sid, 'document.getElementById("bingoView").classList.contains("hidden") && !document.getElementById("gameSelect").classList.contains("hidden")') is True)
    errs = r.ask(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the SA pub console', errs == '[]', errs)
    r.close_tab(tid)

    tid, sid, up = console('sa pub phone', width=390, height=844)
    ok('an SA pub at phone width: four tiles, no Bingo', up is True and tiles(r, sid) == 'trivia,musical-bingo,raffle,members-draw', tiles(r, sid))
    shot1(sid, 'console-sa-pub-phone')
    r.close_tab(tid)

    as_venue(name='Henley Surf Club', au_state='SA', postcode='5022', entity_type='non_profit', number_bingo_on=False)
    tid, sid, up = console('sa club')
    ok('an SA club: Bingo is there', up is True and tile(r, sid, 'bingo') is True, tiles(r, sid))
    shot1(sid, 'console-sa-club')
    r.close_tab(tid)

    as_venue(name='Nightcliff Hotel', au_state='NT', postcode='0810', entity_type=None, number_bingo_on=False)
    tid, sid, up = console('nt pub')
    ok('an NT venue not recorded as a club: no Bingo tile', up is True and tile(r, sid, 'bingo') is False, tiles(r, sid))
    r.close_tab(tid)

    as_venue(name='Darwin Tavern', au_state='NT', postcode='0800', entity_type='for_profit', number_bingo_on=True)
    tid, sid, up = console('nt pub switched on')
    ok('an NT pub HQ has switched on: Bingo is there', up is True and tile(r, sid, 'bingo') is True, tiles(r, sid))
    r.close_tab(tid)

    print('the signup page')
    CAPTURE = ('window.__posted=null;var _f=window.fetch;window.fetch=function(u,o){if(/checkout/.test(String(u))){window.__posted=JSON.parse(o.body);'
               'return Promise.resolve({ok:false,status:418,json:function(){return Promise.resolve({error:"captured by the test"});}});}return _f.apply(this,arguments);};')
    tid, sid = r.open('/index.html', width=1280, height=1000, before=CAPTURE)
    r.until(sid, '!!document.querySelector("#vp-venue-list .v-postcode")', 20)
    time.sleep(0.8)

    def fill(sid, entity, rows, entity_first=False):
        """Type the venue rows and pick club or pub, in either order: a person does both, so the note
        must follow whichever comes last (the postcode's own input event, or the club/pub buttons)."""
        r.ask(sid, ('(function(rows,ent,first){var pick=function(){if(ent) document.querySelector(\'#vp-entity-seg [data-entity="\'+ent+\'"]\').click();};'
                    'if(first) pick(); var add=document.getElementById("vp-add-venue");'
                    'while(document.querySelectorAll("#vp-venue-list .venue-row").length<rows.length) add.click();'
                    'var rs=document.querySelectorAll("#vp-venue-list .venue-row");'
                    'rows.forEach(function(v,i){var r=rs[i];r.querySelector(".v-name").value=v[0];r.querySelector(".v-seats").value=v[2];'
                    'var p=r.querySelector(".v-postcode");p.value=v[1];p.dispatchEvent(new Event("input",{bubbles:true}));});'
                    'if(!first) pick(); return true;})(%s,%s,%s)') % (json.dumps(rows), json.dumps(entity), json.dumps(bool(entity_first))))
        time.sleep(0.4)

    def note(sid):
        return r.ask(sid, '(function(b){return b && !b.hidden && b.offsetParent!==null ? b.innerText.replace(/\\s+/g," ") : "";})(document.getElementById("vp-nobingo"))') or ''

    fill(sid, 'for_profit', [['Glenelg Tavern', '5045', '80']])
    n = note(sid)
    ok('a pub with an SA postcode is told, in the page, before paying', 'Number bingo is not available for pubs in South Australia' in n and 'only a not-for-profit organisation may run bingo' in n and 'Musical bingo, trivia and members draws are all yours' in n, n)
    ok('...with the "our bingo is run by a not-for-profit" tick, unticked', r.ask(sid, '(function(c){return !!c && c.checked===false && c.offsetParent!==null;})(document.getElementById("vp-nobingo-ask"))') is True)
    r.ask(sid, 'document.getElementById("vp-nobingo").scrollIntoView({block:"center",behavior:"instant"}); true')
    time.sleep(0.4)
    shot1(sid, 'signup-sa-pub-note')
    fill(sid, 'non_profit', [['Glenelg Tavern', '5045', '80']])
    ok('switch to Club: the note goes', note(sid) == '', note(sid))
    fill(sid, 'for_profit', [['Royal Hotel', '4000', '80']])
    ok('a Queensland pub: no note', note(sid) == '', note(sid))
    fill(sid, 'for_profit', [['Nightcliff Hotel', '0810', '80']], entity_first=True)   # pub first, then the postcode
    ok('an NT postcode names the Northern Territory', 'not available for pubs in the Northern Territory' in note(sid), note(sid))
    fill(sid, 'for_profit', [['Glenelg Tavern', '5045', '80'], ['Nightcliff Hotel', '0810', '60']])
    ok('a group with both: one note naming both', 'pubs in South Australia and the Northern Territory' in note(sid), note(sid))
    r.ask(sid, '(function(){var $=function(i){return document.getElementById(i)};$("vp-name").value="Pat Publican";$("vp-email").value="pat@glenelgtavern.com.au";'
               '$("vp-mobile").value="0412 345 678";$("vp-consent").checked=true;$("vp-nobingo-ask").checked=true;$("vp-submit").click();return true;})()')
    r.until(sid, '!!window.__posted', 10)
    posted = r.ask(sid, 'JSON.stringify(window.__posted)')
    try:
        pv = json.loads(posted or 'null') or {}
    except Exception:
        pv = {}
    vs = pv.get('venues') or []
    ok('ticked, the ask reaches /checkout on each SA or NT pub as bingo_review', len(vs) == 2 and all(v.get('bingo_review') is True for v in vs) and vs[0].get('entity_type') == 'for_profit', posted)
    errs = r.ask(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the signup page', errs == '[]', errs)
    r.close_tab(tid)

    print('the offer page (nsw.html: /offer-nov, where the SA and NT cold emails land)')
    tid, sid = r.open('/nsw', width=1280, height=1000, before=CAPTURE)
    r.until(sid, '!!document.querySelector("#vp-venue-list .v-postcode")', 20)
    time.sleep(0.8)
    r.ask(sid, '(function(){var r=document.querySelector("#vp-venue-list .venue-row");r.querySelector(".v-name").value="Glenelg Tavern";r.querySelector(".v-seats").value="80";'
               'var p=r.querySelector(".v-postcode");p.value="5045";p.dispatchEvent(new Event("input",{bubbles:true}));'
               'var e=document.getElementById("vp-entity");e.value="for_profit";e.dispatchEvent(new Event("change",{bubbles:true}));return true;})()')
    time.sleep(0.4)
    n = note(sid)
    ok('the offer page: postcode first, then Pub from the dropdown, and the SA note shows', 'Number bingo is not available for pubs in South Australia' in n, n)
    r.ask(sid, 'document.getElementById("vp-nobingo").scrollIntoView({block:"center",behavior:"instant"}); true')
    time.sleep(0.3)
    shot1(sid, 'offer-page-sa-pub-note')
    r.ask(sid, '(function(){var $=function(i){return document.getElementById(i)};$("vp-name").value="Pat Publican";$("vp-email").value="pat@glenelgtavern.com.au";'
               '$("vp-mobile").value="0412 345 678";$("vp-consent").checked=true;$("vp-nobingo-ask").checked=true;$("vp-submit").click();return true;})()')
    r.until(sid, '!!window.__posted', 10)
    posted = r.ask(sid, 'JSON.stringify(window.__posted)')
    try:
        pv = json.loads(posted or 'null') or {}
    except Exception:
        pv = {}
    ok('...and the tick reaches /checkout from the offer page too', ((pv.get('venues') or [{}])[0]).get('bingo_review') is True, posted)
    r.close_tab(tid)

    tid, sid = r.open('/index.html', width=390, height=844, before=CAPTURE)
    r.until(sid, '!!document.querySelector("#vp-venue-list .v-postcode")', 20)
    time.sleep(0.8)
    fill(sid, 'for_profit', [['Glenelg Tavern', '5045', '80']])
    r.ask(sid, 'document.getElementById("vp-nobingo").scrollIntoView({block:"center",behavior:"instant"}); true')
    time.sleep(0.4)
    w = r.ask(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1')
    ok('at phone width the note fits the page (no sideways scroll)', 'South Australia' in note(sid) and w is True, [note(sid)[:60], w])
    shot1(sid, 'signup-sa-pub-note-phone')
    r.close_tab(tid)
finally:
    r.close()

# ------------------------------------------------------------------ part 2
print('part 2: HQ and the account pages')


def vid(n): return '30000000-0000-4000-8000-%012d' % n


def venue(n, name, st, pc, ent, **kw):
    v = {'id': vid(n), 'name': name, 'slug': name.lower().replace(' ', '-'), 'status': 'active', 'suspended_reason': None,
         'created_at': '2026-09-01T00:00:00Z', 'timezone': 'Australia/Adelaide', 'founding_id': None, 'group_id': None,
         'max_players': 60, 'au_state': st, 'postcode': pc, 'entity_type': ent, 'paid_entry_enabled': False,
         'cancel_at_period_end': False, 'weekly_limit_off': False, 'number_bingo_on': False, 'join_code': 'J%05d' % n}
    v.update(kw)
    return v


SAP, SAC, NTU, QLD = 1, 2, 3, 4
VENUES = [venue(SAP, 'Glenelg Tavern', 'SA', '5045', 'for_profit'), venue(SAC, 'Henley Surf Club', 'SA', '5022', 'non_profit'),
          venue(NTU, 'Nightcliff Hotel', 'NT', '0810', None), venue(QLD, 'Royal Hotel', 'QLD', '4000', 'for_profit', timezone='Australia/Brisbane')]
S = admin_site.Site(fonts=bool(A.shots), live_tables=['vp_venues', 'vp_admin_audit'], extra_db={'vp_venues': VENUES})
UID = S.W.info['uid']
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_venues', VENUES)
S.W.seed('vp_sessions', [])
S.W.seed('vp_game_reports', [])
S.W.seed('vp_admin_audit', [])


def shot2(sid, name, full=False):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'), full)


def details(sid, n):
    S.js(sid, 'document.querySelector(\'button[data-details="%s"]\').click(); true' % vid(n))
    return S.until(sid, '!!document.querySelector(\'.gament[data-vid="%s"]\')' % vid(n), 10)


def card(sid, n):
    return S.js(sid, '(function(){var c=document.querySelector(\'.numbingo[data-vid="%s"]\');var box=c?c.closest(".nobingo"):null;'
                     'if(!box){var g=document.querySelector(\'.gament[data-vid="%s"]\');var td=g?g.closest("td"):null;box=td?td.querySelector(".nobingo"):null;}'
                     'return box?box.innerText.replace(/\\s+/g," "):"";})()' % (vid(n), vid(n))) or ''


def row(n): return [v for v in S.W.table('vp_venues') if v['id'] == vid(n)][0]
def audits(action): return [a for a in S.W.table('vp_admin_audit') if a.get('action') == action]


try:
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1100)
    S.until(sid, 'document.querySelectorAll("#venueRows .vn").length > 0', 20)
    time.sleep(1)
    ok('HQ, the SA pub\'s card: number bingo hidden, and why', details(sid, SAP) and 'hidden' in card(sid, SAP) and 'only a not-for-profit may run bingo there' in card(sid, SAP)
       and 'Musical bingo, trivia and members draws are unaffected' in card(sid, SAP), card(sid, SAP))
    ok('...with the switch, off', S.js(sid, '(function(c){return !!c && !c.checked && !c.disabled;})(document.querySelector(\'.numbingo[data-vid="%s"]\'))' % vid(SAP)) is True)
    S.js(sid, 'document.querySelector(\'.numbingo[data-vid="%s"]\').scrollIntoView({block:"center",behavior:"instant"}); true' % vid(SAP))
    time.sleep(0.3)
    shot2(sid, 'hq-sa-pub-card')
    ok('the NT venue not recorded as a club: hidden, and HQ is told setting Club brings it back', details(sid, NTU) and 'Not recorded as a club yet' in card(sid, NTU) and 'set Club above' in card(sid, NTU), card(sid, NTU))
    ok('the SA club and the Queensland pub: nothing said', details(sid, SAC) and card(sid, SAC) == '' and details(sid, QLD) and card(sid, QLD) == '', [card(sid, SAC), card(sid, QLD)])

    S.js(sid, 'var c=document.querySelector(\'.numbingo[data-vid="%s"]\'); c.checked=true; c.dispatchEvent(new Event("change",{bubbles:true})); true' % vid(SAP))
    S.until(sid, '(function(c){return !!c && c.checked && !c.disabled;})(document.querySelector(\'.numbingo[data-vid="%s"]\'))' % vid(SAP), 10)
    time.sleep(0.8)
    ok('switching it on writes number_bingo_on through the real Worker', row(SAP).get('number_bingo_on') is True, row(SAP))
    a = audits('venue_number_bingo_on')
    ok('...with an audit row by Dean for this venue', len(a) == 1 and a[0].get('actor_label') == 'Dean' and a[0].get('target') == 'venue:' + vid(SAP), a)
    if not S.js(sid, '!!document.querySelector(\'.numbingo[data-vid="%s"]\')' % vid(SAP)):
        details(sid, SAP)
    ok('...and the card says switched ON by HQ', 'switched ON by HQ' in card(sid, SAP), card(sid, SAP))
    shot2(sid, 'hq-sa-pub-switched-on')
    S.close_tab(tid)
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1100)
    S.until(sid, 'document.querySelectorAll("#venueRows .vn").length > 0', 20)
    time.sleep(1)
    ok('after a reload it reads back from the database: still on', details(sid, SAP) and 'switched ON by HQ' in card(sid, SAP)
       and S.js(sid, '(function(c){return !!c && c.checked;})(document.querySelector(\'.numbingo[data-vid="%s"]\'))' % vid(SAP)) is True, card(sid, SAP))

    print('HQ\'s Add venue form')
    S.js(sid, 'document.getElementById("addVenueToggle").click(); true')
    S.until(sid, '!document.getElementById("addVenuePanel").classList.contains("hidden")', 5)
    def add_note(pc, kind):
        S.js(sid, '(function(){var p=document.getElementById("nvPostcode");p.value=%s;p.dispatchEvent(new Event("input",{bubbles:true}));'
                  'var k=document.getElementById("nvKind");k.value=%s;k.dispatchEvent(new Event("change",{bubbles:true}));return true;})()' % (json.dumps(pc), json.dumps(kind)))
        time.sleep(0.3)
        return S.js(sid, '(function(e){return e && !e.classList.contains("hidden") ? e.textContent : "";})(document.getElementById("nvNoBingo"))') or ''
    n1 = add_note('5000', 'for_profit')   # club or pub, the signup question (C4, 20 Oct 2026)
    ok('an SA postcode for a pub: the note, there and then', 'Number bingo will be hidden for this venue: in South Australia' in n1, n1)
    S.js(sid, 'document.getElementById("nvNoBingo").scrollIntoView({block:"center",behavior:"instant"}); true')
    time.sleep(0.3)
    shot2(sid, 'hq-add-venue-sa-pub')
    ok('an NT postcode for a pub names the Northern Territory', 'in the Northern Territory' in add_note('0820', 'for_profit'))
    ok('a club in SA, and a pub in Queensland: no note', add_note('5000', 'non_profit') == '' and add_note('4000', 'for_profit') == '')
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error in HQ', errs == '[]', errs)
    S.close_tab(tid)

    tid, sid = S.open('/app/onboard.html?as=admin', 1100, 1100)
    S.until(sid, '!!document.getElementById("vpostcode")', 15)
    time.sleep(0.8)
    S.js(sid, '(function(){var p=document.getElementById("vpostcode");p.value="0810";p.dispatchEvent(new Event("input",{bubbles:true}));'
              'var k=document.getElementById("vkind");k.value="for_profit";k.dispatchEvent(new Event("change",{bubbles:true}));return true;})()')
    time.sleep(0.3)
    on1 = S.js(sid, '(function(e){return e && !e.classList.contains("hidden") ? e.textContent : "";})(document.getElementById("vNoBingo"))') or ''
    ok('the full onboarding page says the same for an NT pub', 'in the Northern Territory only a not-for-profit may run bingo' in on1, on1)
    S.close_tab(tid)

    print('the account page and the members draw console')
    # Since 24 Oct 2026 the Game settings page holds only the BINGO permit (raffles and members draws are
    # under Your account > Draws), so an SA pub with number bingo hidden has no permit card at all there.
    SETTLED = 'document.readyState==="complete" && !document.getElementById("body").classList.contains("hidden")'
    tid, sid = S.open('/app/settings.html?as=admin&venue=' + vid(SAP), 1100, 1300)
    S.until(sid, '!!document.querySelector("#permitsWrap .permit")', 20)
    time.sleep(0.6)
    kinds = S.js(sid, '[].map.call(document.querySelectorAll("#permitsWrap .permit"),function(p){return p.getAttribute("data-kind");}).join(",")')
    ok('settings, the SA pub HQ has switched ON: the bingo permit card is back', kinds == 'bingo', kinds)
    S.close_tab(tid)
    S.W.seed('vp_venues', [])   # replace: the switch back off for the next look
    VENUES[0]['number_bingo_on'] = False
    S.W.seed('vp_venues', VENUES)
    tid, sid = S.open('/app/settings.html?as=admin&venue=' + vid(SAP), 1100, 1300)
    S.until(sid, SETTLED, 20)
    time.sleep(1.2)
    kinds = S.js(sid, '[].map.call(document.querySelectorAll("#permitsWrap .permit"),function(p){return p.getAttribute("data-kind");}).join(",")')
    intro = S.js(sid, '(function(e){return !!e && e.offsetParent!==null;})(document.getElementById("permitsIntro"))')
    ok('settings, an SA pub: no bingo permit card, and no permits intro left hanging', kinds == '' and intro is False, (kinds, intro))
    shot2(sid, 'settings-sa-pub-permits', True)
    S.close_tab(tid)
    tid, sid = S.open('/app/settings.html?as=admin&venue=' + vid(SAC), 1100, 1300)
    S.until(sid, '!!document.querySelector("#permitsWrap .permit")', 20)
    time.sleep(0.6)
    kinds = S.js(sid, '[].map.call(document.querySelectorAll("#permitsWrap .permit"),function(p){return p.getAttribute("data-kind");}).join(",")')
    ok('settings, an SA club: the bingo permit card is there', kinds == 'bingo', kinds)
    S.close_tab(tid)

    tid, sid = S.open('/app/members/host.html?as=admin&venue=glenelg-tavern', 1100, 1000)
    S.until(sid, 'document.getElementById("claimBtn") && document.getElementById("claimBtn").textContent==="Record the win"', 20)
    m = S.js(sid, 'JSON.stringify({roll:document.getElementById("rollBtn").classList.contains("hidden"),claim:document.getElementById("claimBtn").textContent,hint:document.getElementById("setClaimHint").textContent})')
    try:
        mv = json.loads(m or '{}')
    except Exception:
        mv = {}
    ok('members draw console, SA pub: no "not here" button, the one button says Record the win, and no claim clock',
       mv.get('roll') is True and mv.get('claim') == 'Record the win' and 'no claim clock' in (mv.get('hint') or ''), m)
    S.close_tab(tid)
finally:
    S.close()

print('\n%d of %d checks passed' % (ran - bad, ran))
EXPECTED = 38
if ran != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, ran))
    sys.exit(1)
sys.exit(1 if bad else 0)
