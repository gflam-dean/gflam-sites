#!/usr/bin/env python3
"""SIGN IN WITH THE MOBILE, IN THE REAL PAGES, AT PHONE WIDTH (Dean, 29 Oct 2026).

"When you go to venueplay.com.au/app it says email address for your VenuePlay login... we don't actually
get the email addresses of the host so it's got to be phone number... a one off link that gets them to ask
the first question name and phone number... Automatic sign in they click it once that's it otherwise we can
resend it or maybe they could resend it."

Real pages in headless Chrome (tools/browser-rig/admin_site.py: the shipped venueplay/ files, the REAL
billing Worker in jsc behind a pipe, supabase-js swapped for tools/browser-rig/fake-supabase.js), each
screen at 390 pixels wide:

  /app           a device that last used email, on an old ?signin=email link: the MOBILE step, the email box
                 hidden, the old key cleared; a sent text shows "Code not arriving?" and that still opens
                 the email code (the 21 Oct outage path)
  /app/go        a link HQ sent through the real Worker: Welcome, one tap, signed in, on to /app/
  /app (first)   "You're in": name and mobile; Text me a code; the code; "All set"; the mobile went on through
                 Auth's phone change and the name reached the Worker's staff rows; then the console
  /app/go again  the spent link: "Let's get you back in", Send me a new link (a new email from the Worker to
                 the login's own address), Sign in with my mobile instead
  HQ             Resend sign-in link on the venue: asks, sends through the real Worker, says where it went

Every Chrome here has its own --user-data-dir (verify-live's Browser) and is closed at the end, whatever
happens. No git, no network beyond 127.0.0.1.

    python3 tools/phone-signin-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, re, sys, time

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
# TEST VENUE NAMES ONLY in fixtures and screenshots (Dean, 29 Oct 2026): the shared rig's two venues are
# renamed Test Alpha and Test Bravo here, on both sides (the page's supabase-js and the billing Worker).
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
S.W.seed('venueplay_founding', _renamed(S.W.table('venueplay_founding')))
S.extra_db['vp_venues'] = _renamed(admin_site.fake_db(S.W.info, False)['vp_venues'])
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('auth', [{'id': UID, 'email': 'owner@test.local', 'phone': '', 'user_metadata': {'full_name': 'Olive Owner'}}])
S.W.seed('vp_prospects', [{'venue_id': VENUE, 'auth_user_id': UID, 'email': 'owner@test.local'}])
S.W.seed('vp_signin_links', [])


def tab(path, test, width=390, height=844, store=None):
    """A window of its own at phone width, with fake-supabase's per-tab settings (and any localStorage)
    in place before the page's own scripts run."""
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


def click(sid, ident):
    return js(sid, '(function(){var e=document.getElementById(%s); if(!e) return false; e.click(); return true;})()' % json.dumps(ident))


def type_in(sid, ident, value):
    return js(sid, '(function(){var e=document.getElementById(%s); if(!e) return false; e.focus(); e.value=%s; e.dispatchEvent(new Event("input",{bubbles:true})); return true;})()' % (json.dumps(ident), json.dumps(value)))


def no_sideways(sid):
    return js(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1')


def fits_dark(sid, ident, detail=False):
    v = js(sid, '(function(){var e=document.getElementById(%s), c=e&&e.closest(".authcard"); if(!e||!c) return null; var r=e.getBoundingClientRect(), k=c.getBoundingClientRect();'
                'var bg=getComputedStyle(e).backgroundColor; var m=/rgba?\\((\\d+), (\\d+), (\\d+)/.exec(bg); return {inside: r.left>=k.left-0.5 && r.right<=k.right+0.5, bg: bg, dark: !!m && (+m[1]+(+m[2])+(+m[3]))<200};})()' % json.dumps(ident))
    if detail:
        return v
    return bool(v and v.get('inside') and v.get('dark'))


def errs(sid):
    return [e for e in (js(sid, 'window.__errs||[]') or []) if 'Failed to load resource' not in e]


def auth_calls(sid):
    return js(sid, 'window.__FAKE_AUTH_CALLS||[]') or []


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        time.sleep(0.4)
        S.shot(sid, os.path.join(A.shots, name + '.png'))


try:
    # ------------------------------------------------------------------ 1. /app is the mobile, always
    print('\n1. /app opens on the mobile number and a text code, whatever the link or the device remembers')
    tid, sid = tab('/app/?signin=email&gone=1', {'signedIn': False}, store={'vpSignInWith': 'email'})
    S.until(sid, 'document.getElementById("vSignIn") && !document.getElementById("vSignIn").classList.contains("hidden")', 20)
    ok('an old ?signin=email link on a device that last used email: the MOBILE step is showing', visible(sid, 'stepMobile') and visible(sid, 'mobileIn'))
    ok('the email box is not on the screen', not visible(sid, 'stepEmail') and not visible(sid, 'emailIn'))
    ok('it says "Sign in with a text code to your mobile."', text(sid, 'authSub').strip() == 'Sign in with a text code to your mobile.', text(sid, 'authSub'))
    ok('no "Email address on your VenuePlay login" anywhere you can see', 'Email address' not in (js(sid, 'document.body.innerText') or ''))
    ok('the old device key that opened the email step is gone', js(sid, 'localStorage.getItem("vpSignInWith")') is None)
    ok('it fits a phone with no sideways scroll, and no script errors', no_sideways(sid) and not errs(sid), errs(sid))
    shot(sid, '1-signin-mobile-first')
    type_in(sid, 'mobileIn', '0452 510 904')
    click(sid, 'sendCodeBtn')
    S.until(sid, '!document.getElementById("stepCode").classList.contains("hidden")', 10)
    sent_otp = [c for c in auth_calls(sid) if c.get('fn') == 'signInWithOtp']
    ok('Send code asks for a TEXT to +61452510904', len(sent_otp) == 1 and sent_otp[0]['args'].get('phone') == '+61452510904', sent_otp)
    ok('the code box shows, and "Code not arriving? Get it by email instead" is there, small, below it', visible(sid, 'otpIn') and visible(sid, 'emailAltBtn') and
       'Code not arriving' in text(sid, 'emailAltBtn'))
    ok('the code box sits inside the card and is the dark on-brand box, not a white browser box', fits_dark(sid, 'otpIn'), fits_dark(sid, 'otpIn', True))
    shot(sid, '2-signin-code-sent')
    click(sid, 'emailAltBtn')
    S.until(sid, '!document.getElementById("stepEmail").classList.contains("hidden")', 5)
    ok('the email code still works as the outage fallback: tapping it opens the email box', visible(sid, 'emailIn') and not visible(sid, 'stepMobile'))
    ok('and that email box is the dark on-brand box inside the card too', fits_dark(sid, 'emailIn'), fits_dark(sid, 'emailIn', True))
    shot(sid, '2b-signin-email-fallback')
    # The same box at desktop width (Dean, 29 Oct 2026: "the box for the email isn't the one we usually have").
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
    time.sleep(0.3)
    js(sid, 'document.getElementById("emailIn").blur()')
    time.sleep(0.5)   # the field's border eases back over .15s once it loses focus
    diff = js(sid, '(function(){var a=document.getElementById("emailIn"), b=document.getElementById("mobileIn"); var sa=getComputedStyle(a), sb=getComputedStyle(b);'
                   'return ["backgroundColor","borderTopColor","borderTopWidth","borderRadius","paddingTop","paddingLeft","fontSize","fontFamily","color"].filter(function(k){return sa[k]!==sb[k];})'
                   '.map(function(k){return k+": "+sa[k]+" vs "+sb[k];});})()')
    wide = js(sid, 'document.getElementById("emailIn").getBoundingClientRect().width > 300')
    ok('at desktop width the email box is the dark full-width field, styled exactly as the mobile field', fits_dark(sid, 'emailIn') and wide and diff == [], diff)
    shot(sid, '2c-signin-email-fallback-desktop')
    S.close_tab(tid)

    # ------------------------------------------------------------------ 2. the one-off link
    print('\n2. The one-off link: one tap, signed in, then name and mobile')
    r = S.W.ask('POST', '/admin/signin-link', {'venue_id': VENUE}, {'Authorization': 'Bearer fake-token'})
    ok('HQ\'s Resend sign-in link (the real Worker) sends one to the login\'s own address', r.get('status') == 200 and (r.get('body') or {}).get('to') == 'owner@test.local', r)
    mails = S.W.sent()
    html = (mails[-1] if mails else {}).get('html', '')
    m = re.search(r'href="([^"]*/app/go#t=[A-Za-z0-9_-]{43}[^"]*)"', html)
    link = m.group(1).replace('&amp;', '&') if m else ''
    ok('its button is a one-off /app/go#t=... link with their address, and no ?signin=email anywhere', bool(link) and 'signin=email' not in html, link)
    frag = link.split('/app/go', 1)[1] if link else ''
    tid, sid = tab('/app/go' + frag, {'phone': '', 'persist': True})
    S.until(sid, 'document.getElementById("goBtn") && document.readyState==="complete"', 15)
    ok('Welcome: one button, "Open my VenuePlay"', visible(sid, 'goBtn') and text(sid, 'goBtn').strip().lower() == 'open my venueplay' and not visible(sid, 'goGone'))
    ok('the token left the address bar before anything else', js(sid, 'location.href').endswith('/app/go'), js(sid, 'location.href'))
    ok('nothing was sent to the Worker on load (a mail scanner opening it cannot use it)', not any(c[0] == '/auth/one-click' for c in S.W.calls))
    ok('fits a phone, no script errors', no_sideways(sid) and not errs(sid), errs(sid))
    shot(sid, '3-go-welcome')
    click(sid, 'goBtn')
    S.until(sid, 'location.pathname === "/app/" || location.pathname === "/app/index.html"', 15)
    S.until(sid, '!!document.getElementById("vpAyName")', 20)
    ok('one tap: signed in and on /app/, and the first screen is "You\'re in" asking name and mobile', visible(sid, 'vpAyName') and visible(sid, 'vpAyMobile') and
       text(sid, 'vpAyTitle').strip().lower() == "you're in", text(sid, 'vpAyTitle'))
    ok('a fresh 4 hour shift started (vpShiftStart)', bool(js(sid, 'localStorage.getItem("vpShiftStart")')))
    ok('their name is filled in from their login (its user_metadata)', js(sid, 'document.getElementById("vpAyName").value') == 'Test Host', js(sid, 'document.getElementById("vpAyName").value'))
    ok('it covers the console (nothing behind it to tap) and fits a phone', js(sid, '(function(){var e=document.getElementById("vpAboutYou");var r=e.getBoundingClientRect();return r.width>=innerWidth-1&&r.height>=innerHeight-1;})()') and no_sideways(sid))
    shot(sid, '4-about-you')
    type_in(sid, 'vpAyMobile', '0452 510 904')
    click(sid, 'vpAySend')
    S.until(sid, '(function(){var e=document.getElementById("vpAyCode");return !!e && e.getBoundingClientRect().height>0;})()', 10)
    up = [c for c in auth_calls(sid) if c.get('fn') == 'updateUser']
    ok('Text me a code: Auth is asked for a PHONE CHANGE to +61452510904 (pending until the code), with their name', len(up) == 1 and up[0]['args'].get('phone') == '+61452510904' and
       (up[0]['args'].get('data') or {}).get('full_name') == 'Test Host', up)
    ok('the code box shows where it went, with "Code not arriving? Carry on for now"', '0452 510 904' in text(sid, 'vpAySentTo') and visible(sid, 'vpAyLater'))
    shot(sid, '5-about-you-code')
    type_in(sid, 'vpAyCode', '123456')
    click(sid, 'vpAyVerify')
    S.until(sid, '!!document.getElementById("vpAyGo")', 10)
    vo = [c for c in auth_calls(sid) if c.get('fn') == 'verifyOtp' and (c.get('args') or {}).get('type') == 'phone_change']
    ok('the code is verified as that phone change (only now is the mobile on the login)', len(vo) == 1 and vo[0]['args'].get('phone') == '+61452510904', vo)
    ok('"All set": from now on, sign in with 0452 510 904 by text code', 'all set, test' == text(sid, 'vpAyTitle').strip().lower() and '0452 510 904' in text(sid, 'vpAySub'), text(sid, 'vpAySub'))
    staff = [s for s in S.W.table('vp_venue_staff') if s.get('auth_user_id') == UID]
    ok('their name reached the REAL Worker and is on their venue staff rows (Olive Owner before)', staff and all(s.get('display_name') == 'Test Host' for s in staff) and
       any(c[0] == '/account/my-name' for c in S.W.calls), staff)
    shot(sid, '6-about-you-done')
    click(sid, 'vpAyGo')
    S.until(sid, '!document.getElementById("vpAboutYou")', 10)
    ok('Let\'s go: the screen goes and the console carries on (choose a venue, for this two-venue login)', not js(sid, '!!document.getElementById("vpAboutYou")') and
       js(sid, '!document.getElementById("vVenuePick").classList.contains("hidden")'))
    ok('no script errors on the way', not errs(sid), errs(sid))
    S.close_tab(tid)

    # ------------------------------------------------------------------ 3. the spent link
    print('\n3. The same link again: used, and a new one is a tap away (never an email form)')
    tid, sid = tab('/app/go' + frag, {'phone': '61452510904'})
    S.until(sid, 'document.getElementById("goBtn") && document.readyState==="complete"', 15)
    click(sid, 'goBtn')
    S.until(sid, '!document.getElementById("goGone").hidden', 10)
    ok('"Let\'s get you back in": that link has been used or has expired', visible(sid, 'goGone') and not visible(sid, 'goReady') and
       'used or has expired' in text(sid, 'goneSub'), text(sid, 'goneSub'))
    ok('it offers "Send me a new link" and "Sign in with my mobile instead", and no email box', visible(sid, 'resendBtn') and visible(sid, 'mobileLink') and
       js(sid, '!document.querySelector("input[type=email]")'))
    ok('it stayed on this page (no trip to an email sign-in)', js(sid, 'location.pathname') == '/app/go')
    ok('fits a phone, no script errors', no_sideways(sid) and not errs(sid), errs(sid))
    shot(sid, '7-go-used')
    before = len(S.W.sent())
    click(sid, 'resendBtn')
    S.until(sid, '/on its way/.test(document.getElementById("resendMsg").innerText)', 10)
    after = S.W.sent()
    ok('Send me a new link: it says one is on its way if that address has a login, and the button goes', 'on its way' in text(sid, 'resendMsg') and not visible(sid, 'resendBtn'), text(sid, 'resendMsg'))
    ok('and the REAL Worker sent a new link to the login\'s own address', len(after) == before + 1 and after[-1].get('to') == ['owner@test.local'] and
       after[-1].get('subject') == 'Your VenuePlay sign-in link' and '/app/go#t=' in after[-1].get('html', ''), after[-1:] and after[-1].get('to'))
    shot(sid, '8-go-new-link-sent')
    mob = js(sid, 'document.getElementById("mobileLink").getAttribute("href")')
    ok('"Sign in with my mobile instead" goes to /app/ (the mobile sign-in)', mob == '/app/', mob)
    S.close_tab(tid)

    # ------------------------------------------------------------------ 4. HQ
    print('\n4. HQ: Resend sign-in link on the venue')
    tid, sid = tab('/app/hq.html?as=admin', {}, width=1280, height=900)
    S.until(sid, 'document.querySelectorAll("#venueRows tr").length > 0', 25)
    js(sid, '(function(){var b=document.querySelector("#venueRows button[data-details]"); if(b) b.click();})()')
    S.until(sid, '!!document.querySelector("#venueRows button[data-signinlink]")', 10)
    ok('the venue\'s Details has "Resend sign-in link" beside Resend welcome', js(sid, '(function(){var b=document.querySelector("#venueRows button[data-signinlink]");return !!b && b.textContent==="Resend sign-in link" && b.getBoundingClientRect().width>0;})()'))
    n_before = len(S.W.sent())
    js(sid, 'document.querySelector("#venueRows button[data-signinlink]").click()')
    S.until(sid, '!!document.getElementById("vpAskGo")', 5)
    ok('it asks first, saying what the link does (on a test venue: no real venue name in any fixture)', 'works once, for 14 days' in (js(sid, 'document.body.innerText') or '') and
       'Email Test Alpha a new sign-in link' in (js(sid, 'document.body.innerText') or '') and 'Deepwater' not in (js(sid, 'document.body.innerText') or ''))
    shot(sid, '9-hq-resend-ask')
    click(sid, 'vpAskGo')
    S.until(sid, '/Sent to owner@test\\.local/.test(document.body.innerText)', 10)
    ok('then it sends through the real Worker and says where it went', 'Sent to owner@test.local' in (js(sid, 'document.body.innerText') or '') and len(S.W.sent()) == n_before + 1)
    shot(sid, '10-hq-resend-sent')
    ok('no script errors in HQ', not errs(sid), errs(sid))
    S.close_tab(tid)

    # ------------------------------------------------------------------ 5. the emails, as a phone shows them
    print('\n5. The emails: the welcome signed by the sender the venue wrote to, from and to hello@; the new-link email')
    S.W.seed('vp_venues', S.W.table('vp_venues'))
    r = S.W.ask('POST', '/admin/prospect', {'name': 'The Harbour Tavern', 'first_name': 'Sam', 'email': 'sam@harbour.example', 'postcode': '4217',
                                            'entity_type': 'for_profit', 'send_in_minutes': 0, 'sender_name': 'Harry', 'sender_email': 'harry@venueplay.online'},
                {'Authorization': 'Bearer fake-token'})
    mails = S.W.sent()
    welcome = [m for m in mails if m.get('to') == ['sam@harbour.example']]
    ok('HQ / the autopilot sets up a prospect with sender Harry: one welcome', r.get('status') == 200 and len(welcome) == 1, r)
    w = welcome[-1] if welcome else {}
    ok('from VenuePlay hello@, replies to hello@venueplay.com.au', w.get('from') == 'VenuePlay <hello@send.venueplay.com.au>' and w.get('reply_to') == 'hello@venueplay.com.au', [w.get('from'), w.get('reply_to')])
    import tempfile
    tmp = tempfile.mkdtemp(prefix='vp-phone-signin-mail-')
    try:
        for name, m in (('11-email-welcome-from-harry', w), ('12-email-new-sign-in-link', mails[-2] if len(mails) > 1 else {})):
            path = os.path.join(tmp, name + '.html')
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(m.get('html', ''))
            tid, sid = S.B.open_tab('about:blank')
            S.B.call('Page.enable', {}, session=sid)
            S.B.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 1400, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
            S.B.call('Page.navigate', {'url': 'file://' + path}, session=sid)
            S.until(sid, 'document.readyState==="complete"', 10)
            body = js(sid, 'document.body.innerText') or ''
            if name.startswith('11'):
                ok('the welcome ends "Cheers, Harry", VenuePlay, venueplay.com.au, with no Dean in the sign-off', re.search(r'Cheers,\s*Harry\s*VenuePlay\s*venueplay\.com\.au', body) is not None, body[-400:])
            else:
                ok('the new-link email is signed by the VenuePlay team, with one button', 'The VenuePlay team' in body and 'Open your VenuePlay' in body, body[:200])
            ok('%s fits a phone with no sideways scroll' % name, no_sideways(sid))
            shot(sid, name)
            S.close_tab(tid)
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
finally:
    S.close()

print('')
print('PASS %d checks' % PASS[0] if not FAIL[0] else '%d OF %d FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
