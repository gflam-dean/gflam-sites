#!/usr/bin/env python3
"""THE 200 PLAYER LIMIT FOR ONE VENUE BY ITSELF, AS A PERSON SEES IT (Dean, 14 Nov 2026, INBOX 418).

Sign-up (venueplay/index.html and the offer page venueplay/nsw.html, public pages): one venue with 201 players is told
"For more than 200 players, email sales@venueplay.com.au and we will set it up with you." in sight, nothing is sent to
/checkout, and no phone number shows (the phone lives behind sign-in). 200 players goes ahead. Two venues, one of 500,
go ahead (a group has no per-venue limit).

Add a venue (signed in, venueplay/app/billing.html): an owner with ONE venue who adds one with 201 players sees
"For more than 200 players, call us on 07 5228 3667", and nothing is made. An owner with two venues (a group) is not
held to it (the add goes past the limit to the next rule).

Real pages in headless Chrome, the REAL billing Worker behind them in jsc (tools/browser-rig/admin_site.py).
    python3 tools/signup-player-limits-in-chrome.test.py        VP_SHOTS=<dir> keeps a frame per step (375x667, 390x844)
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = '/home/vp/venue-enrich/reports/signup-limits-shots'
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1; print('  ok   %s' % label)
    else:
        FAIL[0] += 1; print('  FAIL %s%s' % (label, ('  (%s)' % str(detail)[:400]) if detail != '' else ''))


def shot(S, sid, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        S.shot(sid, os.path.join(SHOTS, name + '.png'))


KEEP = ('(function(){ window.__checkout=[]; var real=window.fetch; window.fetch=function(u,o){'
        ' if(!/\\/checkout$/.test(String(u))) return real.apply(this, arguments);'
        ' var sent=null; try{ sent=JSON.parse(o.body); }catch(e){}'
        ' return real.apply(this, arguments).then(function(r){ return r.json().then(function(j){'
        '   window.__checkout.push({ sent:sent, status:r.status, body:JSON.parse(JSON.stringify(j)) });'
        '   if(j && j.url) j.url="#went-to-stripe"; if(j) delete j.client_secret;'
        '   return new Response(JSON.stringify(j), { status:r.status, headers:{ "Content-Type":"application/json" } }); }); }); };'
        ' return true; })()')

FILL = ('(function(o){var $=function(i){return document.getElementById(i)};'
        'while(document.querySelectorAll("#vp-venue-list .venue-row").length<o.rows.length){var a=document.getElementById("vp-add-venue")||document.querySelector("[data-add-venue],#addVenueRow,.add-venue");if(!a)break;a.click();}'
        'var rs=document.querySelectorAll("#vp-venue-list .venue-row");'
        'o.rows.forEach(function(v,i){var r=rs[i];if(!r)return;r.querySelector(".v-name").value=v[0];r.querySelector(".v-seats").value=String(v[1]);'
        'var p=r.querySelector(".v-postcode");p.value=v[2];p.dispatchEvent(new Event("input",{bubbles:true}));r.querySelector(".v-seats").dispatchEvent(new Event("input",{bubbles:true}));});'
        'if(o.offer){var e=$("vp-entity");e.value="for_profit";e.dispatchEvent(new Event("change",{bubbles:true}));}'
        'else {var b=document.querySelector(\'#vp-entity-seg [data-entity="for_profit"]\'); if(b) b.click();}'
        '$("vp-name").value="Sam Signup";$("vp-email").value=o.email;$("vp-mobile").value="0412 345 678";$("vp-consent").checked=true;'
        'return document.querySelectorAll("#vp-venue-list .venue-row").length;})(%s)')

ERR_IN_SIGHT = ('JSON.stringify((function(){var e=document.getElementById("vp-err");var b=e.getBoundingClientRect();'
                'return {txt:e.offsetParent!==null?e.textContent:"",top:b.top,bottom:b.bottom,vh:innerHeight,sw:document.documentElement.scrollWidth,vw:innerWidth};})())')

S = admin_site.Site(fonts=bool(SHOTS))
try:
    n = 0
    for page, offer in (('/index.html', False), ('/nsw.html', True)):
        label = 'the offer page' if offer else 'the sign-up page'
        for (w, h) in ((375, 667), (390, 844)):
            n += 1
            tid, sid = S.open(page, w, h, mobile=True)
            S.until(sid, '!!document.querySelector("#vp-venue-list .v-postcode") && !!document.getElementById("vp-consent")', 25)
            time.sleep(0.8)
            S.js(sid, KEEP)
            leads0 = len(S.W.table('venueplay_founding'))
            S.js(sid, FILL % json.dumps({'offer': offer, 'email': 'big%d@bigbarn.com.au' % n, 'rows': [['Big Barn Hotel', 201, '4225']]}))
            time.sleep(0.3)
            S.js(sid, 'document.getElementById("vp-submit").click(); true')
            S.until(sid, 'document.getElementById("vp-err").classList.contains("show")', 6)
            S.js(sid, 'document.getElementById("vp-err").scrollIntoView({block:"center",behavior:"instant"}); true')
            time.sleep(0.4)
            E = S.json(sid, ERR_IN_SIGHT) or {}
            ok('%s %dx%d: one venue at 201 players is told to email sales@, in sight' % (label, w, h),
               'For more than 200 players, email sales@venueplay.com.au and we will set it up with you.' in E.get('txt', '')
               and E.get('top', -1) >= 0 and E.get('bottom', 1e9) <= E.get('vh', 0), E)
            ok('%s %dx%d: ...no phone number on the public page, nothing sent, no lead saved, no sideways scroll' % (label, w, h),
               '5228' not in E.get('txt', '') and S.js(sid, 'window.__checkout.length') == 0
               and len(S.W.table('venueplay_founding')) == leads0 and E.get('sw', 0) <= E.get('vw', 0), (E, S.js(sid, 'window.__checkout.length')))
            shot(S, sid, 'signup-201-%s-%dx%d' % ('offer' if offer else 'home', w, h))
            if (w, h) == (375, 667):
                # 200 is still self-serve
                S.js(sid, 'window.__checkout=[]; document.querySelector("#vp-venue-list .v-seats").value="200"; document.getElementById("vp-email").value="ok%d@twohundred.com.au"; document.getElementById("vp-submit").click(); true' % n)
                S.until(sid, 'window.__checkout.length===1', 15)
                c = S.json(sid, 'JSON.stringify(window.__checkout[0]||null)')
                ok('%s: one venue at 200 players goes ahead to the card' % label, bool(c) and c.get('status') == 200, c)
            ok('%s %dx%d: no script error' % (label, w, h), S.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', S.js(sid, 'JSON.stringify(window.__errs||[])'))
            S.close_tab(tid)

    print('\na group signing up has no per-venue limit')
    tid, sid = S.open('/index.html', 390, 844, mobile=True)
    S.until(sid, '!!document.querySelector("#vp-venue-list .v-postcode") && !!document.getElementById("vp-consent")', 25)
    time.sleep(0.8)
    S.js(sid, KEEP)
    rows = S.js(sid, FILL % json.dumps({'offer': False, 'email': 'kim@pubgroup.com.au', 'rows': [['The Crown', 500, '2000'], ['The Rose', 40, '2010']]}))
    S.js(sid, 'document.getElementById("vp-submit").click(); true')
    S.until(sid, 'window.__checkout.length===1', 15)
    c = S.json(sid, 'JSON.stringify(window.__checkout[0]||null)')
    ok('two venues, one of 500 players: goes ahead to the card', rows == 2 and bool(c) and c.get('status') == 200 and len((c.get('sent') or {}).get('venues') or []) == 2, (rows, c))
    S.close_tab(tid)

    print('\nAdd a venue (signed in)')
    for (w, h) in ((375, 667), (390, 844)):
        # ONE venue on the account: the Worker and the page both see only Deepwater
        S.W.seed('vp_venues', [v for v in S.W.table('vp_venues') if v.get('name') == 'Deepwater Hotel'])
        S.W.seed('vp_venue_staff', [s for s in S.W.table('vp_venue_staff') if s.get('venue_id') == S.W.info['venue']])
        S.page_db['vp_venues'] = [v for v in admin_site.fake_db(S.W.info, False)['vp_venues'] if v['name'] == 'Deepwater Hotel']
        S.page_db['vp_venue_staff'] = [s for s in admin_site.fake_db(S.W.info, False)['vp_venue_staff'] if s['venue_id'] == S.W.info['venue']]
        before = len(S.W.table('vp_venues'))
        tid, sid = S.open('/app/billing?as=owner', w, h, mobile=True)
        S.until(sid, '!!document.getElementById("add-go") && document.querySelectorAll(".stepper input").length>=1', 25)
        time.sleep(1.0)
        S.js(sid, 'document.getElementById("addForm").classList.add("show"); document.getElementById("add-name").value="Big Barn Hotel";'
                  'document.getElementById("add-postcode").value="2371"; document.getElementById("add-seats").value="201"; document.getElementById("add-go").click(); true')
        S.until(sid, '/200 players/.test(document.getElementById("msg").textContent)', 10)
        S.js(sid, 'document.getElementById("msg").scrollIntoView({block:"center",behavior:"instant"}); true')
        time.sleep(0.4)
        M = S.json(sid, 'JSON.stringify((function(){var m=document.getElementById("msg"),b=m.getBoundingClientRect();return {txt:m.textContent,top:b.top,bottom:b.bottom,vh:innerHeight,sw:document.documentElement.scrollWidth,vw:innerWidth};})())') or {}
        ok('add a venue %dx%d, one venue on the account, 201 players: "call us on 07 5228 3667", in sight' % (w, h),
           (M.get('txt') or '').replace('\u00a0', ' ') == 'For more than 200 players, call us on 07 5228 3667' and '07\u00a05228\u00a03667' in (M.get('txt') or '') and M.get('top', -1) >= 0 and M.get('bottom', 1e9) <= M.get('vh', 0) and M.get('sw', 0) <= M.get('vw', 0), M)
        ok('add a venue %dx%d: nothing made' % (w, h), len(S.W.table('vp_venues')) == before, len(S.W.table('vp_venues')))
        shot(S, sid, 'add-venue-201-%dx%d' % (w, h))
        S.close_tab(tid)
    # A GROUP (two venues): 500 players is not refused by the 200 rule
    S.W.seed('vp_venues', admin_site.fake_db(S.W.info, False)['vp_venues'])
    S.W.seed('vp_venue_staff', [dict(s, id='s%d' % i) for i, s in enumerate(admin_site.fake_db(S.W.info, False)['vp_venue_staff'])])
    S.page_db.pop('vp_venues', None); S.page_db.pop('vp_venue_staff', None)
    tid, sid = S.open('/app/billing?as=owner', 390, 844, mobile=True)
    S.until(sid, '!!document.getElementById("add-go") && document.querySelectorAll(".stepper input").length>=2', 25)
    time.sleep(1.0)
    S.js(sid, 'document.getElementById("addForm").classList.add("show"); document.getElementById("add-name").value="Big Group Barn";'
              'document.getElementById("add-postcode").value="2000"; document.getElementById("add-seats").value="500"; document.getElementById("add-go").click(); true')
    S.until(sid, 'document.getElementById("msg").textContent.length>0 && document.getElementById("add-go").textContent==="Add venue"', 10)
    t = S.js(sid, 'document.getElementById("msg").textContent') or ''
    ok('add a venue to a group of two at 500 players: not held to the 200 limit', bool(t) and '200 players' not in t, t)
    ok('add a venue: no script error', S.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', S.js(sid, 'JSON.stringify(window.__errs||[])'))
    shot(S, sid, 'add-venue-group-500-390x844')
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 21
if FAIL[0] == 0 and total == EXPECTED:
    print('ALL %d CHECKS PASSED' % total)
    sys.exit(0)
print('%d OF %d CHECKS FAILED%s' % (FAIL[0], total, '' if total == EXPECTED else ' (EXPECTED %d checks)' % EXPECTED))
sys.exit(1)
