#!/usr/bin/env python3
"""THE EMAILED ACCOUNT LINK, NAME + MOBILE, THEN THE NORMAL SIGN-IN, IN THE REAL PAGES (Dean, 11 Nov 2026, INBOX 243/248).

"The emailed account link keeps working UNTIL the person signs in AND puts in their details (name + mobile). Once both
are saved, that link stops and it's the normal sign-in from then on (text code to their mobile). So a click that doesn't
finish the details doesn't burn the link (still within its 90 days). Welcome screen: Name (pre-filled from what we have,
e.g. "Paul") + Mobile, then signed in."

Real pages in headless Chrome (tools/browser-rig/admin_site.py: the shipped venueplay/ files, the REAL billing Worker in
jsc behind a pipe, supabase-js swapped for tools/browser-rig/fake-supabase.js), the rig's login set up as a NEW prospect
login (vp_details_due, no mobile) on Test Bravo, at 375 (phone) and 1440 (laptop) wide:

  1  the link HQ sends (the real Worker) > Welcome > one tap > "You're in": name pre-filled "Paul" + mobile
  2  closed without finishing: the same link still signs in (not burned), the Worker's link row still unused
  3  name + mobile, the text code, "All set": the Worker saved the name and the account holder record, the link retired
  4  the same link again: "Let's get you back in", Sign in with my mobile > the normal sign-in > a text code > signed in
  5  a link past its 90 days: the same normal sign-in page
  6  a mobile already on the login: only the name is asked (pre-filled), the mobile shown, "That's me", "All set"

No real email or text: the Worker's Resend is a fake, Auth is fake-supabase. Every Chrome has its own --user-data-dir and
is closed at the end. No git, no network beyond 127.0.0.1.

    python3 tools/welcome-name-in-chrome.test.py [--shots DIR]
"""
import argparse, datetime, json, os, re, sys, time

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
UID, VENUE = S.W.info['uid'], S.W.info['venue']
# TEST VENUE NAMES ONLY (Dean, 29 Oct 2026): the rig's two venues are Test Alpha and Test Bravo here, both sides.
_TEST_NAMES = {'Deepwater Hotel': ('Test Alpha', 'test-alpha'), 'The Royal Arms': ('Test Bravo', 'test-bravo')}


def _renamed(rows):
    out = []
    for r in rows:
        r = dict(r)
        if r.get('name') in _TEST_NAMES:
            r['name'], r['slug'] = _TEST_NAMES[r['name']]
        if r.get('venue_name') in _TEST_NAMES:
            r['venue_name'] = _TEST_NAMES[r['venue_name']][0]
        out.append(r)
    return out


S.W.seed('vp_venues', _renamed(S.W.table('vp_venues')))
S.W.seed('venueplay_founding', [dict(r, contact_name=None, mobile=None) for r in _renamed(S.W.table('venueplay_founding'))])
S.extra_db['vp_venues'] = _renamed(admin_site.fake_db(S.W.info, False)['vp_venues'])
S.extra_db['vp_venue_staff'] = [dict(r, display_name='Paul') for r in admin_site.fake_db(S.W.info, False)['vp_venue_staff']]
S.W.seed('vp_venue_staff', [dict(r, display_name='Paul') for r in S.W.table('vp_venue_staff')])
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
NEW_META = {'venue': 'Test Bravo', 'vp_details_due': True}
S.W.seed('auth', [{'id': UID, 'email': 'owner@test.local', 'phone': '', 'user_metadata': NEW_META}])
S.W.seed('vp_prospects', [{'venue_id': VENUE, 'auth_user_id': UID, 'email': 'owner@test.local'}])
S.W.seed('vp_signin_links', [])


def tab(path, test, width=375, height=812, store=None):
    tid, sid = S.B.open_tab('about:blank')
    S.B.call('Page.enable', {}, session=sid)
    mobile = width < 600
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
    if mobile:
        S.B.call('Emulation.setUserAgentOverride', {'userAgent': admin_site.IPHONE_UA, 'platform': 'iPhone'}, session=sid)
    pre = 'window.__FAKE_TEST=%s;' % json.dumps(test)
    for k, v in (store or {}).items():
        pre += 'try{localStorage.setItem(%s,%s)}catch(e){};' % (json.dumps(k), json.dumps(v))
    S.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': pre}, session=sid)
    S.B.call('Page.navigate', {'url': S.base + path}, session=sid)
    return tid, sid


def js(sid, e):
    return S.js(sid, e)


def visible(sid, ident):
    return js(sid, '(function(){var e=document.getElementById(%s); if(!e) return false; var r=e.getBoundingClientRect(); '
                   'var s=getComputedStyle(e); return r.width>0 && r.height>0 && s.display!=="none" && s.visibility!=="hidden" && !e.closest("[hidden],.hidden");})()' % json.dumps(ident))


def text(sid, ident):
    return js(sid, '(function(){var e=document.getElementById(%s); return e ? e.innerText : null;})()' % json.dumps(ident)) or ''


def value(sid, ident):
    return js(sid, '(function(){var e=document.getElementById(%s); return e ? e.value : null;})()' % json.dumps(ident))


def click(sid, ident):
    return js(sid, '(function(){var e=document.getElementById(%s); if(!e) return false; e.click(); return true;})()' % json.dumps(ident))


def type_in(sid, ident, v):
    return js(sid, '(function(){var e=document.getElementById(%s); if(!e) return false; e.focus(); e.value=%s; e.dispatchEvent(new Event("input",{bubbles:true})); return true;})()' % (json.dumps(ident), json.dumps(v)))


def no_sideways(sid):
    return js(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1')


def errs(sid):
    return [e for e in (js(sid, 'window.__errs||[]') or []) if 'Failed to load resource' not in e]


def auth_calls(sid):
    return js(sid, 'window.__FAKE_AUTH_CALLS||[]') or []


# The welcome card: every field and button inside the card, the card inside the screen, 16px or more from each side.
CARD = r'''(function(){ var s=document.getElementById("vpAboutYou"); if(!s) return null; var box=s.firstElementChild.getBoundingClientRect();
  var card=document.getElementById("vpAyForm").parentElement.getBoundingClientRect(), ids=%s, out={card:[card.left,card.right], vw:innerWidth, inside:true, gutter:Math.min(card.left, innerWidth-card.right)};
  ids.forEach(function(i){ var e=document.getElementById(i); if(!e) return; var r=e.getBoundingClientRect(); if(r.width<1) return;
    out[i]=[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]; if(r.left<card.left-0.5||r.right>card.right+0.5) out.inside=false; });
  return out; })()'''


def card_ok(sid, ids):
    L = js(sid, CARD % json.dumps(ids)) or {}
    return L, bool(L.get('inside')) and L.get('gutter', 0) >= 15.5 and no_sideways(sid)


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        time.sleep(0.4)
        S.shot(sid, os.path.join(A.shots, name + '.png'))


def mint():
    r = S.W.ask('POST', '/admin/signin-link', {'venue_id': VENUE}, {'Authorization': 'Bearer fake-token'})
    mails = S.W.sent()
    html = (mails[-1] if mails else {}).get('html', '')
    m = re.search(r'href="([^"]*/app/go#t=[A-Za-z0-9_-]{43}[^"]*)"', html)
    link = m.group(1).replace('&amp;', '&') if m else ''
    return r, (link.split('/app/go', 1)[1] if link else '')


def live_links():
    return [l for l in S.W.table('vp_signin_links') if l.get('auth_user_id') == UID and not l.get('used_at')]


def open_link(frag, test, width):
    tid, sid = tab('/app/go' + frag, test, width=width, height=812 if width < 600 else 900)
    S.until(sid, 'document.getElementById("goBtn") && document.readyState==="complete"', 15)
    click(sid, 'goBtn')
    return tid, sid


try:
    # ------------------------------------------------------------------ 1 + 2. the link, a click that does not finish
    print('\n1. A NEW prospect login: the emailed link > one tap > name (pre-filled) + mobile')
    r, frag = mint()
    ok('HQ\'s send (the real Worker) emails the login\'s own address a one-tap /app/go link', r.get('status') == 200 and bool(frag), r)
    NEW = {'phone': '', 'persist': True, 'meta': {'name': 'Paul', 'vp_details_due': True}, 'metaAfterRefresh': {'vp_details_at': '2026-11-11T08:00:00.000Z'}}
    tid, sid = open_link(frag, NEW, 375)
    S.until(sid, '!!document.getElementById("vpAyName")', 20)
    ok('375: one tap, signed in, "You\'re in": name AND mobile', visible(sid, 'vpAyName') and visible(sid, 'vpAyMobile') and text(sid, 'vpAyTitle').strip().lower() == "you're in",
       text(sid, 'vpAyTitle'))
    ok('375: the name is PRE-FILLED with what we have ("Paul"), so they just confirm it', value(sid, 'vpAyName') == 'Paul', value(sid, 'vpAyName'))
    L, good = card_ok(sid, ['vpAyName', 'vpAyMobile', 'vpAySend'])
    ok('375: the name, the mobile and Text me a code sit inside the card, 16px gutter, no sideways scroll, no script errors', good and not errs(sid), [L, errs(sid)])
    shot(sid, '1-375-welcome-name-mobile')
    S.close_tab(tid)
    ok('2. CLOSED WITHOUT FINISHING: the Worker\'s link is still unused (a click does not burn it)', len(live_links()) == 1, live_links())
    tid, sid = open_link(frag, NEW, 1440)
    S.until(sid, '!!document.getElementById("vpAyName")', 20)
    ok('1440: the SAME link signs in again and shows the same welcome screen', visible(sid, 'vpAyName') and visible(sid, 'vpAyMobile') and value(sid, 'vpAyName') == 'Paul')
    L, good = card_ok(sid, ['vpAyName', 'vpAyMobile', 'vpAySend'])
    ok('1440: inside the card, centred (a 420px column), no sideways scroll, no script errors', good and (L.get('card', [0, 0])[1] - L.get('card', [0, 0])[0]) <= 422 and not errs(sid), [L, errs(sid)])
    shot(sid, '2-1440-welcome-again')

    # ------------------------------------------------------------------ 3. name + mobile, the code, all set
    print('\n3. Name + mobile, the text code, signed in; saved to the login AND the account holder record; the link stops')
    type_in(sid, 'vpAyName', 'Paul Hayes')
    type_in(sid, 'vpAyMobile', '0400 123 454')
    click(sid, 'vpAySend')
    S.until(sid, '(function(){var e=document.getElementById("vpAyCode");return !!e && e.getBoundingClientRect().height>0;})()', 10)
    up = [c for c in auth_calls(sid) if c.get('fn') == 'updateUser']
    ok('Text me a code: Auth\'s phone change to +61400123454, with the name', len(up) == 1 and up[0]['args'].get('phone') == '+61400123454' and (up[0]['args'].get('data') or {}).get('full_name') == 'Paul Hayes', up)
    shot(sid, '3-1440-code')
    # Auth puts the verified number on the login (Supabase's own phone change); the Worker's Auth reads it from then.
    S.W.seed('auth', [{'id': UID, 'email': 'owner@test.local', 'phone': '61400123454', 'user_metadata': NEW_META}])
    type_in(sid, 'vpAyCode', '123456')
    click(sid, 'vpAyVerify')
    S.until(sid, '!!document.getElementById("vpAyGo")', 10)
    ok('"All set, Paul": from now on, sign in with 0400 123 454 by text code', text(sid, 'vpAyTitle').strip().lower() == 'all set, paul' and '0400 123 454' in text(sid, 'vpAySub'), text(sid, 'vpAySub'))
    staff = [s for s in S.W.table('vp_venue_staff') if s.get('auth_user_id') == UID]
    ok('the name is on the login\'s staff rows (the real Worker)', staff and all(s.get('display_name') == 'Paul Hayes' for s in staff), staff)
    f1 = [f for f in S.W.table('venueplay_founding') if f.get('id') == 'f1']
    ok('AND on the account holder record: contact_name Paul Hayes, mobile 0400123454', f1 and f1[0].get('contact_name') == 'Paul Hayes' and f1[0].get('mobile') == '0400123454', f1)
    ok('THE LINK STOPS: no unused sign-in link left for that login', live_links() == [], live_links())
    ok('a fresh session was asked for (so a reload does not show the welcome again)', any(c.get('fn') == 'refreshSession' for c in auth_calls(sid)))
    shot(sid, '3-1440-all-set')
    click(sid, 'vpAyGo')
    S.until(sid, '!document.getElementById("vpAboutYou")', 10)
    ok('Let\'s go: into the console, no script errors', not js(sid, '!!document.getElementById("vpAboutYou")') and not errs(sid), errs(sid))
    S.close_tab(tid)

    # ------------------------------------------------------------------ 4. the link again: normal sign-in, text code works
    print('\n4. The same link again: the normal sign-in (text code to the mobile), and it works')
    for w in (375, 1440):
        tid, sid = open_link(frag, {'signedIn': False, 'phone': '61400123454', 'smsSignIn': True, 'persist': True}, w)
        S.until(sid, '!document.getElementById("goGone").hidden', 10)
        ok('%d: "Let\'s get you back in", Sign in with my mobile (pink, first), no email box' % w, visible(sid, 'goGone') and visible(sid, 'mobileLink') and
           'Sign in with a text code to your mobile.' in text(sid, 'goneSub') and js(sid, '!document.querySelector("input[type=email]")'), text(sid, 'goneSub'))
        ok('%d: fits, no sideways scroll, no script errors' % w, no_sideways(sid) and not errs(sid), errs(sid))
        shot(sid, '4-%d-link-again' % w)
        if w == 375:
            click(sid, 'mobileLink')
            S.until(sid, 'document.getElementById("vSignIn") && !document.getElementById("vSignIn").classList.contains("hidden") && document.readyState==="complete"', 20)
            ok('375: Sign in with my mobile opens the normal sign-in, the mobile step', visible(sid, 'mobileIn') and not visible(sid, 'stepEmail'))
            type_in(sid, 'mobileIn', '0400 123 454')
            click(sid, 'sendCodeBtn')
            S.until(sid, '!document.getElementById("stepCode").classList.contains("hidden")', 10)
            otp = [c for c in auth_calls(sid) if c.get('fn') == 'signInWithOtp']
            ok('375: Send code texts +61400123454', len(otp) == 1 and otp[0]['args'].get('phone') == '+61400123454', otp)
            shot(sid, '4-375-text-code')
            type_in(sid, 'otpIn', '123456')
            click(sid, 'verifyBtn')
            S.until(sid, 'document.getElementById("vSignIn").classList.contains("hidden")', 15)
            vo = [c for c in auth_calls(sid) if c.get('fn') == 'verifyOtp' and (c.get('args') or {}).get('type') == 'sms']
            ok('375: the text code signs them in (verifyOtp sms), a fresh shift, off the sign-in page, no welcome screen again',
               len(vo) == 1 and bool(js(sid, 'localStorage.getItem("vpShiftStart")')) and not js(sid, '!!document.getElementById("vpAboutYou")') and not errs(sid), [vo, errs(sid)])
            shot(sid, '4-375-signed-in')
        S.close_tab(tid)

    # ------------------------------------------------------------------ 5. after 90 days
    print('\n5. A link past its 90 days: the normal sign-in page')
    S.W.seed('auth', [{'id': UID, 'email': 'owner@test.local', 'phone': '', 'user_metadata': NEW_META}])
    r, frag90 = mint()
    rows = S.W.table('vp_signin_links')
    past = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    made = (datetime.datetime.utcnow() - datetime.timedelta(days=91)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    for l in rows:
        if not l.get('used_at'):
            l['expires_at'], l['created_at'] = past, made
    S.W.seed('vp_signin_links', rows)
    tid, sid = open_link(frag90, {'signedIn': False, 'phone': ''}, 375)
    S.until(sid, '!document.getElementById("goGone").hidden', 10)
    ok('375: the 91-day-old link (details never done) opens "Let\'s get you back in", Sign in with my mobile', visible(sid, 'goGone') and visible(sid, 'mobileLink') and not errs(sid), text(sid, 'goneSub'))
    shot(sid, '5-375-after-90-days')
    S.close_tab(tid)

    # ------------------------------------------------------------------ 6. mobile already on the login: name only
    print('\n6. A mobile already on the login: only the name is asked, pre-filled, and the mobile is shown')
    S.W.seed('auth', [{'id': UID, 'email': 'owner@test.local', 'phone': '61400777454', 'user_metadata': NEW_META}])
    S.W.seed('venueplay_founding', [dict(f, contact_name=None, mobile=None) for f in S.W.table('venueplay_founding')])
    for w in (375, 1440):
        tid, sid = tab('/app/', {'signedIn': True, 'phone': '61400777454', 'meta': {'full_name': 'Sam', 'vp_details_due': True}}, width=w, height=812 if w < 600 else 900)
        S.until(sid, '!!document.getElementById("vpAyName")', 20)
        ok('%d: "You\'re in": the name (pre-filled "Sam"), NO mobile box, "You\'ll sign in with 0400 777 454"' % w,
           value(sid, 'vpAyName') == 'Sam' and not visible(sid, 'vpAyMobile') and visible(sid, 'vpAyMobileNote') and '0400 777 454' in text(sid, 'vpAyMobileNote') and
           'Just check your name' in text(sid, 'vpAySub'), [value(sid, 'vpAyName'), text(sid, 'vpAyMobileNote'), text(sid, 'vpAySub')])
        L, good = card_ok(sid, ['vpAyName', 'vpAyMobileNote', 'vpAyName1'])
        ok('%d: the name, the mobile line and "That\'s me" in order inside the card, no sideways scroll, no script errors' % w,
           good and L.get('vpAyName', [0, 0, 0, 0])[3] <= L.get('vpAyMobileNote', [0, 9e9])[1] and L.get('vpAyMobileNote', [0, 0, 0, 0])[3] <= L.get('vpAyName1', [0, 9e9])[1] and
           text(sid, 'vpAyName1').strip() == "That's me" and not errs(sid), [L, errs(sid)])
        shot(sid, '6-%d-name-only' % w)
        if w == 1440:
            click(sid, 'vpAyName1')
            S.until(sid, '!!document.getElementById("vpAyGo")', 10)
            ok('1440: "That\'s me": "All set, Sam", from now on sign in with 0400 777 454; no text code asked (the mobile is already theirs)',
               text(sid, 'vpAyTitle').strip().lower() == 'all set, sam' and '0400 777 454' in text(sid, 'vpAySub') and
               not [c for c in auth_calls(sid) if c.get('fn') in ('updateUser', 'signInWithOtp')], [text(sid, 'vpAyTitle'), auth_calls(sid)])
            f1 = [f for f in S.W.table('venueplay_founding') if f.get('id') == 'f1']
            ok('1440: the name and that mobile are on the account holder record', f1 and f1[0].get('contact_name') == 'Sam' and f1[0].get('mobile') == '0400777454', f1)
            shot(sid, '6-1440-name-only-done')
        S.close_tab(tid)
    tid, sid = tab('/app/', {'signedIn': True, 'phone': '61400777454', 'meta': {'full_name': 'Olive Owner'}}, width=375)
    S.until(sid, 'document.readyState==="complete" && !!window.__ctxSettled || document.getElementById("vVenuePick") && !document.getElementById("vVenuePick").classList.contains("hidden")', 20)
    time.sleep(0.5)
    ok('an EXISTING login (no vp_details_due) with a mobile: no welcome screen, nothing changed', not js(sid, '!!document.getElementById("vpAboutYou")'))
    S.close_tab(tid)
finally:
    S.close()

print('')
print('ALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '%d OF %d FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
