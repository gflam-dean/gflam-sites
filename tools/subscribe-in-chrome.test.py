#!/usr/bin/env python3
"""THE MONTHLY EMAIL SIGN-UP, IN CHROME, ON EVERY PAGE THAT HAS IT, AGAINST THE REAL BILLING WORKER (31 Oct 2026).

For the venue owner who is "too scared to call us": one small form on the home page, the offer page
(/nsw, /offer-<month>) and See a night. Opens the REAL pages in headless Chrome
(tools/browser-rig/admin_site.py: its own --user-data-dir, removed on close) with POST /subscribe and
HQ's /admin/subscribers answered by the REAL venueplay-api-FULL.js in jsc, and:

  1. LOOKS: at 390 px (phone) and 1280 px, on each page: the form is there once, inside the page with a
     16 px gutter, fields and button at least 44 px tall, nothing overlapping, no sideways scroll, the
     honeypot off the screen, nothing covering the button, no offer price in the block, no script error
  2. THE WORDS: the consent line on each page is the Worker's VPS_CONSENT_TEXT, word for word, with the
     Privacy Policy linked; never "we'll call you"
  3. SIGN UP from the home page with utm tags: the success message (next month named), the row the
     Worker kept (source, utm, the consent words), and with the switch off NO email
  4. the same address again: success again, one row; a bad address: the error, no row; the honeypot:
     "success", no row; an address that unsubscribed before: the same success, kept HELD, no email
     even with the switch on; the same address over and over: the limit says so
  5. switch ON: one email from See a night's form, rendered in Chrome and looked at (screenshot)
  6. before migration 134: the form tells the person to email hello@, never a dead button
  7. HQ > Subscribers as an owner admin: the rows, held shown as held, a match, counts, Export CSV

Touches no git and no remote. Screenshots with --shots DIR (default names vp-subscribers-31oct-*.png).

    python3 tools/subscribe-in-chrome.test.py [--shots DIR]
"""
import argparse, base64, json, os, re, sys, time

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
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:600],)) if detail != '' else ''))


SRC = open(os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js'), encoding='utf-8').read()
CONSENT = re.search(r"^const VPS_CONSENT_TEXT = '([^']+)';", SRC, re.M).group(1)
PAGES = (('/index.html', 'home'), ('/nsw.html', 'offer'), ('/see-a-night.html', 'see-a-night'))


def shot(S, sid, name, full=False):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, 'vp-subscribers-31oct-' + name + '.png'), full=full)


def j(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v if isinstance(v, dict) else {}


# Where the form and its parts sit, after it has been scrolled to the middle of the screen.
LAYOUT = r'''(function(){
  var fs = document.querySelectorAll("form[data-vps]"); if (fs.length !== 1) return JSON.stringify({forms: fs.length});
  var f = fs[0]; f.scrollIntoView({block: "center", behavior: "instant"});
  var box = f.closest(".vps-card") || f.closest(".vp-mail") || f;
  function R(el){ if(!el) return null; var r = el.getBoundingClientRect(); return {l:r.left, r:r.right, t:r.top, b:r.bottom, w:r.width, h:r.height}; }
  var em = f.querySelector('input[name="email"]'), ve = f.querySelector('input[name="venue"]'), bt = f.querySelector('button[type="submit"]'), hp = f.querySelector('input[name="website"]');
  var rb = R(bt), hit = rb ? document.elementFromPoint(rb.l + rb.w / 2, rb.t + rb.h / 2) : null;
  var cons = f.querySelector("[data-vps-consent-text]"), priv = f.querySelector('a[href="/privacy"]');
  return JSON.stringify({ forms: 1, vw: innerWidth, sw: document.documentElement.scrollWidth, box: R(box), em: R(em), ve: R(ve), bt: R(bt), hp: R(hp),
    hpTab: hp ? hp.tabIndex : null, covered: !!(hit && hit !== bt && !bt.contains(hit)), coveredBy: hit ? (hit.className || hit.tagName) : "",
    consent: cons ? cons.textContent : null, privacy: !!priv, text: box.innerText, source: f.getAttribute("data-source"),
    errs: window.__errs || [] });
})()'''


def wait_vps(S, sid):
    return S.until(sid, '!!document.querySelector("form[data-vps][data-vps-wired]")', 20)


def fill_and_send(S, sid, email, venue='', website=''):
    S.js(sid, ('(function(){var f=document.querySelector("form[data-vps]");f.querySelector(\'input[name="email"]\').value=%s;'
               'f.querySelector(\'input[name="venue"]\').value=%s;f.querySelector(\'input[name="website"]\').value=%s;'
               'f.querySelector(\'button[type="submit"]\').click();return true;})()') % (json.dumps(email), json.dumps(venue), json.dumps(website)))


STATE = r'''(function(){ var f=document.querySelector("form[data-vps]"), d=f.parentNode.querySelector("[data-vps-done]"), e=f.querySelector("[data-vps-err]");
  return JSON.stringify({ formShown: !f.hidden && f.getBoundingClientRect().height > 0, done: !!d && !d.hidden && d.getBoundingClientRect().height > 0,
    doneText: d ? d.innerText : "", err: e && e.classList.contains("show") ? e.innerText : "", errLink: e && e.querySelector("a") ? e.querySelector("a").getAttribute("href") : "",
    busy: f.querySelector('button[type="submit"]').disabled }); })()'''


def state(S, sid):
    return j(S.js(sid, STATE))


def settle(S, sid, secs=8):
    S.until(sid, '(function(){var f=document.querySelector("form[data-vps]");return !f.querySelector(\'button[type="submit"]\').disabled;})()', secs)
    time.sleep(0.3)
    return state(S, sid)


def subs(S):
    return S.W.table('vp_subscribers') or []


MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
S = admin_site.Site(fonts=bool(A.shots), live_tables=['vp_venues'])
try:
    UID = S.W.info['uid']
    S.W.seed('vp_subscribers', [])
    S.W.seed('vp_unsubscribes', [])
    S.W.seed('vp_admin_audit', [])

    print('1 and 2. HOW IT LOOKS AND WHAT IT SAYS, ON EACH PAGE, AT PHONE AND DESKTOP WIDTH')
    for page, src in PAGES:
        for w, h, mob in ((390, 844, True), (1280, 900, False)):
            tid, sid = S.open(page, w, h, mobile=mob)
            wait_vps(S, sid)
            time.sleep(0.8)
            L = j(S.js(sid, LAYOUT))
            time.sleep(0.4)
            L = j(S.js(sid, LAYOUT))   # again, once anything lazy has settled where it lands
            tag = '%s at %d px' % (src, w)
            box, em, ve, bt, hp = L.get('box') or {}, L.get('em') or {}, L.get('ve') or {}, L.get('bt') or {}, L.get('hp') or {}
            ok('%s: one form, from this page (data-source=%s)' % (tag, src), L.get('forms') == 1 and L.get('source') == src, L)
            ok('%s: inside the page with at least a 16 px gutter, and nothing scrolls sideways' % tag,
               box and box['l'] >= 16 - 0.5 and box['r'] <= L['vw'] - 16 + 0.5 and L['sw'] <= L['vw'], [box, L.get('vw'), L.get('sw')])
            ok('%s: the email, venue and button are at least 44 px tall and do not overlap' % tag,
               em.get('h', 0) >= 44 and ve.get('h', 0) >= 44 and bt.get('h', 0) >= 44
               and (ve['t'] >= em['b'] - 0.5 or ve['l'] >= em['r'] - 0.5) and bt['t'] >= max(em['b'], ve['b']) - 0.5, [em, ve, bt])
            ok('%s: nothing sits over the button (no sticky bar, no strip)' % tag, not L.get('covered'), L.get('coveredBy'))
            ok('%s: the honeypot is off the screen and out of the tab order' % tag, hp and hp['r'] <= 0 and L.get('hpTab') == -1, [hp, L.get('hpTab')])
            ok('%s: the consent line is the Worker\'s words exactly, with the Privacy Policy linked' % tag, L.get('consent') == CONSENT and L.get('privacy'), L.get('consent'))
            text = L.get('text') or ''
            ok('%s: no price or offer in the block, no "call you", no em dash' % tag,
               not re.search(r'\$\d', text) and not re.search(r'call you|we.ll call', text, re.I) and '\u2014' not in text and 'Nobody will ring you' in text, text[:300])
            ok('%s: no script error' % tag, not L.get('errs'), L.get('errs'))
            shot(S, sid, '%s-%s' % (src, 'phone' if mob else 'desktop'))
            S.close_tab(tid)

    print('\n3. SIGN UP FROM THE HOME PAGE, WITH UTM TAGS, THE SWITCH OFF')
    tid, sid = S.open('/index.html?utm_source=instantly&utm_medium=email&utm_campaign=nov-offer', 390, 844, mobile=True)
    wait_vps(S, sid)
    fill_and_send(S, sid, '', '')
    st = state(S, sid)
    ok('empty: "Put in your email first.", and the Worker is not asked', 'Put in your email first' in st.get('err', '') and not subs(S), st)
    fill_and_send(S, sid, 'kim@', '')
    st = state(S, sid)
    ok('a bad address: "does not look right", nothing kept', 'does not look right' in st.get('err', '') and not subs(S), st)
    S.js(sid, 'document.querySelector("form[data-vps]").scrollIntoView({block:"center",behavior:"instant"});true')
    shot(S, sid, 'home-error-phone')
    fill_and_send(S, sid, 'Kim@KirraBeachHotel.com.au', 'Kirra Beach Hotel')
    st = settle(S, sid)
    ok('a good one: the form gives way to "You\'re on the list"', st.get('done') and not st.get('formShown') and "You're on the list" in st.get('doneText', ''), st)
    ok('the success names the month the first email lands in, and says nobody will ring', re.search(r'lands early (%s)\.' % '|'.join(MONTHS), st.get('doneText', '')) and 'Nobody will ring you' in st.get('doneText', ''), st.get('doneText'))
    rows = subs(S)
    r0 = rows[0] if rows else {}
    ok('the Worker kept one row: the address lower-cased, the venue, source "home"', len(rows) == 1 and r0.get('email') == 'kim@kirrabeachhotel.com.au'
       and r0.get('venue_name') == 'Kirra Beach Hotel' and r0.get('source') == 'home', rows)
    ok('with the utm tags the visit came in on, and the consent words shown', r0.get('utm') == {'utm_source': 'instantly', 'utm_medium': 'email', 'utm_campaign': 'nov-offer'}
       and r0.get('consent_text') == CONSENT, r0)
    ok('the switch is off: no email was sent', not S.W.sent(), S.W.sent())
    S.js(sid, 'document.querySelector("[data-vps-done]").scrollIntoView({block:"center",behavior:"instant"});true')
    time.sleep(0.3)
    shot(S, sid, 'home-success-phone')
    S.close_tab(tid)

    print('\n4. AGAIN, BAD, BOT, UNSUBSCRIBED, AND THE LIMIT')
    tid, sid = S.open('/nsw.html', 390, 844, mobile=True)
    wait_vps(S, sid)
    fill_and_send(S, sid, 'KIM@kirrabeachhotel.com.au', '')
    st = settle(S, sid)
    ok('the same address again (offer page, other case): the same success, still one row', st.get('done') and len(subs(S)) == 1 and subs(S)[0].get('source') == 'home', [st, len(subs(S))])
    S.close_tab(tid)
    tid, sid = S.open('/index.html', 1280, 900)
    wait_vps(S, sid)
    fill_and_send(S, sid, 'bot@spam.example', '', 'http://spam.example')
    st = settle(S, sid)
    ok('a filled honeypot: shown success (the bot learns nothing), nothing kept', st.get('done') and not [x for x in subs(S) if x.get('email') == 'bot@spam.example'], st)
    S.close_tab(tid)
    S.W.env(SUBSCRIBE_EMAILS='on')
    S.W.seed('vp_unsubscribes', [{'id': 'u1', 'email': 'Stopped@ThePub.com.au', 'source': 'link'}])
    tid, sid = S.open('/see-a-night.html', 390, 844, mobile=True)
    wait_vps(S, sid)
    fill_and_send(S, sid, 'stopped@thepub.com.au', 'The Pub')
    st = settle(S, sid)
    held = [x for x in subs(S) if x.get('email') == 'stopped@thepub.com.au']
    ok('an address that unsubscribed before: the same success on screen', st.get('done') and "You're on the list" in st.get('doneText', ''), st)
    ok('kept HELD, and sent nothing even with the switch on', held and held[0].get('status') == 'held' and not S.W.sent(), [held, len(S.W.sent())])
    S.close_tab(tid)
    S.W.env(SUBSCRIBE_EMAILS='off')
    last = {}
    for n in range(5):
        tid, sid = S.open('/index.html', 1280, 900)
        wait_vps(S, sid)
        fill_and_send(S, sid, 'again@and-again.com.au', '')
        last = settle(S, sid)
        S.close_tab(tid) if n < 4 else None
    ok('the same address a fifth time in an hour: the page says it has been tried a few times', 'tried a few times' in last.get('err', '') and last.get('formShown'), last)
    S.close_tab(tid)

    print('\n5. THE SWITCH ON: ONE EMAIL, LOOKED AT')
    S.W.env(SUBSCRIBE_EMAILS='on')
    tid, sid = S.open('/see-a-night.html', 1280, 900)
    wait_vps(S, sid)
    fill_and_send(S, sid, 'jo@thebowlo.com.au', "Jo's Bowlo")
    st = settle(S, sid)
    sent = S.W.sent()
    ok('See a night: success, and exactly one email, to jo@thebowlo.com.au', st.get('done') and len(sent) == 1 and sent[0].get('to') == ['jo@thebowlo.com.au'], [st, [x.get('to') for x in sent]])
    S.close_tab(tid)
    S.W.env(SUBSCRIBE_EMAILS='off')
    if sent:
        mail = sent[0]
        html = mail.get('html', '').replace('https://venueplay.com.au/logos/', S.base + '/logos/')
        for w, name in ((390, 'email-phone'), (720, 'email-desktop')):
            etid, esid = S.B.open_tab('about:blank')
            S.B.call('Page.enable', {}, session=esid)
            S.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': 900, 'deviceScaleFactor': 2 if w < 500 else 1, 'mobile': w < 500}, session=esid)
            S.B.call('Page.navigate', {'url': 'data:text/html;base64,' + base64.b64encode(html.encode('utf-8')).decode('ascii')}, session=esid)
            S.until(esid, 'document.readyState==="complete" && [].every.call(document.images,function(i){return i.complete;})', 10)
            time.sleep(0.4)
            E = j(S.js(esid, 'JSON.stringify({vw:innerWidth,sw:document.documentElement.scrollWidth,text:document.body.innerText,logo:[].every.call(document.images,function(i){return i.naturalWidth>0;}),'
                             'links:[].map.call(document.links,function(a){return a.href;})})'))
            ok('the email at %d px: nothing scrolls sideways, the logo shows' % w, E.get('sw', 9999) <= E.get('vw', 0) and E.get('logo'), [E.get('sw'), E.get('vw'), E.get('logo')])
            if w == 390:
                t = E.get('text', '')
                ok('it reads: on the list, for Jo\'s Bowlo, one email a month, nobody will ring, ABN, unsubscribe',
                   "You're on the list" in t and "Jo's Bowlo" in t and 'Once a month' in t and 'nobody will ring you' in t and 'VenuePlay, ABN 35 679 383 049' in t and 'Unsubscribe' in t, t[:800])
                links = E.get('links') or []
                ok('every link in it is on venueplay.com.au (no .dev), and one is the unsubscribe page', links and all(re.match(r'^https://(www\.)?venueplay\.com\.au/', l) for l in links)
                   and any('/unsubscribe?e=jo%40thebowlo.com.au' in l for l in links), links)
            S.B.call('Page.captureScreenshot', {'format': 'png'}, session=esid)
            if A.shots:
                os.makedirs(A.shots, exist_ok=True)
                r = S.B.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True}, session=esid)
                open(os.path.join(A.shots, 'vp-subscribers-31oct-' + name + '.png'), 'wb').write(base64.b64decode(r['data']))
            S.close_tab(etid)

    print('\n6. BEFORE MIGRATION 134')
    S.W.missing('vp_subscribers', True)
    tid, sid = S.open('/index.html', 390, 844, mobile=True)
    wait_vps(S, sid)
    fill_and_send(S, sid, 'early@pub.com.au', '')
    st = settle(S, sid)
    ok('the form says email hello@ and we will add you by hand, with a mailto link, and stays on screen',
       'hello@venueplay.com.au' in st.get('err', '') and 'by hand' in st.get('err', '') and st.get('errLink', '').startswith('mailto:hello@venueplay.com.au') and st.get('formShown') and not st.get('done'), st)
    S.js(sid, 'document.querySelector("form[data-vps]").scrollIntoView({block:"center",behavior:"instant"});true')
    shot(S, sid, 'home-not-ready-phone')
    S.close_tab(tid)
    S.W.missing('vp_subscribers', False)

    print('\n7. HQ > SUBSCRIBERS')
    S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
    tid, sid = S.B.open_tab('about:blank')
    S.B.call('Page.enable', {}, session=sid)
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
    S.B.call('Page.navigate', {'url': S.base + '/app/hq.html?as=admin'}, session=sid)
    tab = S.until(sid, '(function(){var b=document.getElementById("vpsTab");return !!b && !b.hidden;})()', 25)
    ok('the Subscribers tab shows for an owner admin', tab is True, tab)
    S.js(sid, 'document.getElementById("vpsTab").click();true')
    S.until(sid, '!!document.getElementById("vpsRows")', 15)
    time.sleep(0.4)
    H = j(S.js(sid, 'JSON.stringify({rows:[].map.call(document.querySelectorAll("#vpsRows tr"),function(r){return r.getAttribute("data-vps-row")+"|"+((r.querySelector("[data-vps-state]")||{}).getAttribute?r.querySelector("[data-vps-state]").getAttribute("data-vps-state"):"")+"|"+r.querySelector("[data-vps-match]").innerText.replace(/\\s+/g," ");}),'
                     'active:(document.getElementById("vpsActive")||{}).textContent,held:(document.getElementById("vpsHeld")||{}).textContent,'
                     'week:(document.querySelector(".vpsweeks tbody tr")||{}).innerText,shown:!document.getElementById("paneSubscribers").classList.contains("hidden"),'
                     'text:document.getElementById("paneSubscribers").innerText,errs:window.__errs||[]})'))
    rows = H.get('rows') or []
    ok('the pane is open and lists every sign-up kept (4: not the bot, not the one before migration 134)', H.get('shown') and len(rows) == 4, rows)
    ok('the held address shows as held', any(r.startswith('stopped@thepub.com.au|held|') for r in rows), rows)
    ok('counts: 3 on the list, 1 held, and this week counted by page', H.get('active') == '3' and H.get('held') == '1' and re.search(r'\b4\b', H.get('week') or ''), [H.get('active'), H.get('held'), H.get('week')])
    ok('it says plainly they are not cold leads and never go into Instantly', 'Not cold leads' in (H.get('text') or '') and 'Instantly' in (H.get('text') or ''))
    ok('no script error in HQ', not H.get('errs'), H.get('errs'))
    S.js(sid, 'document.getElementById("vpsExport").click();true')
    csv = S.until(sid, '(window.VPSubscribers && VPSubscribers._t.S.lastCsv) || ""', 10)
    lines = (csv or '').strip().split('\n') if isinstance(csv, str) else []
    ok('Export CSV hands over a header and the 4 rows, audited', len(lines) == 5 and lines[0].startswith('Email,Venue (as typed),State')
       and any(a.get('action') == 'subscribers_exported' for a in (S.W.table('vp_admin_audit') or [])), lines[:2])
    shot(S, sid, 'hq-desktop', full=True)
    S.close_tab(tid)
    tid, sid = S.B.open_tab('about:blank')
    S.B.call('Page.enable', {}, session=sid)
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
    S.B.call('Page.navigate', {'url': S.base + '/app/hq.html?as=admin'}, session=sid)
    S.until(sid, '(function(){var b=document.getElementById("vpsTab");return !!b && !b.hidden;})()', 25)
    S.js(sid, 'document.getElementById("vpsTab").click();true')
    S.until(sid, '!!document.getElementById("vpsRows")', 15)
    time.sleep(0.4)
    P = j(S.js(sid, 'JSON.stringify({vw:innerWidth,sw:document.documentElement.scrollWidth})'))
    ok('HQ > Subscribers at phone width: nothing scrolls the page sideways (the table scrolls in its own box)', P.get('sw', 9999) <= P.get('vw', 0), P)
    S.js(sid, 'document.getElementById("paneSubscribers").scrollIntoView({block:"start",behavior:"instant"});true')
    shot(S, sid, 'hq-phone')
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 80
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
