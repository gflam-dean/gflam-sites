#!/usr/bin/env python3
"""THE FLOATING "START YOUR FREE MONTH" BUTTON NEVER COVERS THE FORM OR THE TV CODE, AT 375px (6 Nov 2026).

On a phone the pink floating button sat over the done screen and hid the TV code. It now goes for good once someone has
started: a box touched, a later step showing, or the account made (app/vp-start.js fires vp-start-done on document).

Opens the REAL nsw.html at /offer-nov with the REAL billing Worker behind it (tools/browser-rig/admin_site.py, jsc;
the SMS hook, Stripe and the database are the rig's fakes), at 375 x 667, and plays a brand-new venue through the start.

    python3 tools/offer-float-done-in-chrome.test.py [--root CHECKOUT]
"""
import argparse, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=ROOT)
A = ap.parse_args()

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:700],)) if detail != '' else ''))


FLOAT = ('(function(){var f=document.getElementById("vpFloatCta");var r=f.getBoundingClientRect();var cs=getComputedStyle(f);'
         'return {shown:f.classList.contains("show")&&cs.opacity!=="0"&&cs.pointerEvents!=="none",cls:f.className,top:Math.round(r.top),bottom:Math.round(r.bottom),vh:innerHeight};})()')
CODE = ('(function(){var c=document.getElementById("st-tvcode");c.scrollIntoView({block:"center"});var r=c.getBoundingClientRect();'
        'var f=document.getElementById("vpFloatCta").getBoundingClientRect();'
        'var pts=[[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],[r.right-2,r.bottom-2],[(r.left+r.right)/2,(r.top+r.bottom)/2]];'
        'var top=pts.every(function(p){var e=document.elementFromPoint(p[0],p[1]);return e&&(e===c||c.contains(e)||e.id==="st-tvline"||(e.closest&&e.closest("#st-done")));});'
        'var overlap=!(f.right<=r.left||f.left>=r.right||f.bottom<=r.top||f.top>=r.bottom);'
        'return {text:c.textContent.trim(),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,onTop:top,overlap:overlap,w:Math.round(r.width),vw:innerWidth};})()')


def fill(sid, venue, postcode, name, mobile, email, kind='pub'):
    S.js(sid, '(function(){function v(i,x){var e=document.getElementById(i);e.value=x;e.dispatchEvent(new Event("input",{bubbles:true}));}'
              'v("st-venue",%r);v("st-postcode",%r);v("st-name",%r);v("st-mobile",%r);v("st-email",%r);'
              'document.getElementById("st-kind-%s").click();document.getElementById("st-go").click();return true;})()' % (venue, postcode, name, mobile, email, kind))


S = admin_site.Site(root=A.root)
try:
    S.W.env(SEND_SMS_HOOK_URL='https://sms-hook.rig/', SEND_SMS_HOOK_SECRET='dGVzdC1zZWNyZXQtb25seQ==')
    S.W.seed('vp_licensed_venues', [
        {'id': 1, 'name': 'Kirra Beach Hotel', 'name_key': 'kirra-beach-hotel', 'postcode': '4225', 'suburb': 'Kirra', 'au_state': 'QLD', 'source': 'venue master list'}])
    for t in ('vp_signup_starts', 'vp_prospects', 'vp_help_tickets', 'vp_sessions', 'vp_prospect_welcomes', 'auth'):
        S.W.seed(t, [])
    S.W.seed('vp_platform_admins', [{'auth_user_id': S.W.info['uid'], 'role': 'owner', 'label': 'Dean'}])

    print('AT 375 x 667, BEFORE ANYONE STARTS')
    tid, sid = S.open('/offer-nov', 375, 667, mobile=True)
    S.until(sid, '!!window.VPStart && !!document.getElementById("st-go")', 20)
    S.js(sid, 'document.getElementById("offer").scrollIntoView(); window.scrollBy(0, 900); true')
    time.sleep(0.6)
    f = S.json(sid, FLOAT, {})
    ok('control: down the page, away from the start boxes, the floating button shows', f.get('shown') is True, f)
    S.js(sid, 'document.getElementById("start").scrollIntoView(); true')
    time.sleep(0.6)
    f = S.json(sid, FLOAT, {})
    ok('with the start boxes on screen the button is away', f.get('shown') is False, f)

    print('\nTOUCHING A BOX')
    S.js(sid, 'document.getElementById("st-venue").focus(); true')
    S.js(sid, 'window.scrollBy(0, 1800); true')
    time.sleep(0.6)
    f = S.json(sid, FLOAT, {})
    ok('once a box has been touched the button stays away, even scrolled down the page', f.get('shown') is False, f)

    print('\nTHE DONE SCREEN')
    fill(sid, 'Kirra Beach Hotel', '4225', 'Kim Offer', '0412 555 001', 'kim1@venue1.com.au')
    S.until(sid, '!document.getElementById("st-code").hidden', 15)
    t = [x for x in S.W._send({'ask': 'texts'})['body'] if (x.get('user') or {}).get('phone') == '+61412555001']
    code = t[-1]['sms']['otp'] if t else ''
    for i, d in enumerate(code):
        S.js(sid, '(function(){var e=document.activeElement&&document.activeElement.id&&document.activeElement.id.indexOf("st-c")===0?document.activeElement:document.getElementById("st-c%d");'
                  'e.value=%r;e.dispatchEvent(new Event("input",{bubbles:true}));return true;})()' % (i + 1, d))
        time.sleep(0.05)
    S.until(sid, '!document.getElementById("st-done").hidden', 20)
    time.sleep(0.6)
    f = S.json(sid, FLOAT, {})
    ok('on the done screen the floating button is gone', f.get('shown') is False, f)
    c = S.json(sid, CODE, {})
    time.sleep(0.5)
    f = S.json(sid, FLOAT, {})
    ok('the TV code is on screen, whole, inside the 375px width and height', bool(c.get('text')) and c.get('inside') is True, c)
    ok('and nothing covers it: every corner and the middle of the code is the code, and the button does not overlap it', c.get('onTop') is True and c.get('overlap') is False and f.get('shown') is False, [c, f])
    S.js(sid, 'window.scrollTo(0, 0); window.scrollBy(0, 2500); true')
    time.sleep(0.6)
    f = S.json(sid, FLOAT, {})
    ok('scrolling up and down the page afterwards does not bring the button back', f.get('shown') is False, f)
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 7
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
