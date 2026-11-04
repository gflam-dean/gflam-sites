#!/usr/bin/env python3
"""HQ > PROSPECTS, 6 NOV RELEASE, IN THE REAL PAGE AGAINST THE REAL BILLING WORKER.

Dean, 4 Nov 2026: compact rows with a status chip that opens the details and actions; "Edit details"
for a prospect's name, email, mobile and phone; and ONE send button, "Send them a new sign-in link",
that goes by email and, with a mobile, by text ("email only, add a mobile to text it too" without one).
Dean adds mobiles for small venues on Friday so the follow-ups run over the weekend, so a mobile saved
here must put them on the call list at once.

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py, its own --user-data-dir,
removed on close) signed in as an owner admin. Every /admin/ call is answered by the REAL billing Worker
(venueplay-api-FULL.js in jsc). Texts stay switched off here, exactly as they will be on Friday (no SMS
provider yet), so the send button's answer must say so. Touches no git and no remote.

    python3 tools/prospects-edit-in-chrome.test.py [--shots DIR]
"""
import argparse, datetime, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import admin_site  # noqa: E402
import gatelib  # noqa: E402

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
        print('  FAIL %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))


UTC = datetime.timezone.utc
NOW = datetime.datetime.now(UTC)


def iso(dt):
    return dt.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def ago(days, hours=0):
    return iso(NOW - datetime.timedelta(days=days, hours=hours))


def vid(n):
    return '41000000-0000-4000-8000-%012d' % n


def uid(n):
    return '42000000-0000-4000-8000-%012d' % n


QUIET, TEXTME, BOOKED, FREE = 1, 2, 3, 4
NAMES = {QUIET: 'Quiet Corner Bowls', TEXTME: 'Text Me Tavern', BOOKED: 'Booked Welcome Hotel', FREE: 'Free Month Arms'}
VENUES = [{'id': vid(n), 'name': NAMES[n], 'slug': 'pe-%d' % n, 'status': 'active', 'suspended_reason': None, 'created_at': ago(20),
           'timezone': 'Australia/Brisbane', 'founding_id': 'pe%d' % n, 'group_id': None, 'max_players': 10, 'au_state': 'QLD',
           'postcode': '4225', 'cancel_at_period_end': False, 'weekly_limit_off': False} for n in NAMES]
FOUNDING = [{'id': 'pe%d' % n, 'status': 'active', 'stripe_subscription_id': None, 'bill_by_invoice': False,
             'contact_email': 'p%d@pub.test' % n, 'venue_name': NAMES[n], 'mobile': '0412 345 678' if n == TEXTME else None} for n in NAMES]


def prospect(n, created, **kw):
    r = {'venue_id': vid(n), 'founding_id': 'pe%d' % n, 'auth_user_id': uid(n), 'source': 'hq', 'contact_name': 'Contact %d' % n,
         'email': 'p%d@pub.test' % n, 'phone': None, 'website': None, 'created_at': created, 'called_at': None, 'called_label': None,
         'call_note': None, 'call_requested': False, 'first_signin_at': None, 'free_month_ends_at': None, 'offer_rate': 2.5,
         'card_choice': None, 'reminders_sent': [], 'paused_at': None, 'cancelled_at': None}
    r.update(kw)
    return r


PROSPECTS = [prospect(QUIET, ago(5)), prospect(TEXTME, ago(4), phone='0412 345 678'), prospect(BOOKED, ago(0, 1)),
             prospect(FREE, ago(10), first_signin_at=ago(9))]
AUTH = [{'id': uid(n), 'email': 'p%d@pub.test' % n, 'phone': '', 'last_sign_in_at': ago(1) if n == FREE else None} for n in NAMES]
WELCOMES = [{'id': '43000000-0000-4000-8000-000000000001', 'venue_id': vid(BOOKED), 'email': 'p3@pub.test', 'resend_id': None,
             'send_at': iso(NOW + datetime.timedelta(hours=1)), 'status': 'scheduled', 'signin_token_hash': None, 'detail': {}}]

# ONE HEAVY CHROME RUN AT A TIME ON THIS MAC (/tmp/vp-heavy.lock); VP_WAIT_LOCK=<seconds> to wait for it.
if not gatelib.hold_lock_or_refuse('prospects-edit-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    sys.exit(2)
S = admin_site.Site(fonts=bool(A.shots), live_tables=['vp_venues', 'vp_admin_audit'])
UID = S.W.info['uid']
PROFILE, CHROME_PID = S.B.profile, S.B.proc.pid
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_venues', VENUES)
S.W.seed('venueplay_founding', FOUNDING)
S.W.seed('vp_prospects', PROSPECTS)
S.W.seed('vp_venue_staff', [{'venue_id': vid(n), 'auth_user_id': uid(n), 'role': 'owner'} for n in NAMES])
S.W.seed('auth', AUTH)
S.W.seed('vp_prospect_welcomes', WELCOMES)
S.W.seed('vp_signin_links', [])
S.W.seed('vp_sessions', [])
S.W.seed('vp_game_reports', [])
S.W.seed('vp_admin_audit', [])
SHOTS = A.shots


def shot(sid, name, full=True):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        S.shot(sid, os.path.join(SHOTS, name + '.png'), full=full)


ROW_JS = '''(function(id){var c=document.querySelector('#paneProspects .prcard[data-pr-id="'+id+'"]');if(!c)return null;
  var b=c.querySelector("[data-pr-toggle]"),m=c.querySelector(".prmore"),s=c.querySelector("[data-pr-signin]"),r=c.getBoundingClientRect();
  var vis=function(e){if(!e)return false;var q=e.getBoundingClientRect();return q.width>0&&q.height>0;};
  return {chip:b?b.textContent:"",expanded:b?b.getAttribute("aria-expanded"):"",open:vis(m),h:Math.round(r.height),
    send:s?s.textContent:"",sendShown:vis(s),sub:(c.querySelector(".prsub")||{}).textContent||"",flag:(c.querySelector(".prflag")||{}).textContent||"",
    call:(c.querySelector(".prcall")||{}).textContent||"",edit:vis(c.querySelector("[data-pr-edit]")),form:vis(c.querySelector(".predit")),
    welcome:!!c.querySelector("[data-pr-welcome]")};})("%s")'''


def row(sid, n):
    return S.js(sid, ROW_JS % vid(n)) or {}


def press(sid, n, sel):
    return S.js(sid, '(function(){var b=document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] %s\');if(!b)return false;b.click();return true;})()' % (vid(n), sel))


def page_text(sid):
    return S.js(sid, 'document.body.innerText') or ''


def errs(sid):
    return S.js(sid, 'JSON.stringify(window.__errs||[])')


def open_hq(width, height, mobile=False):
    tid, sid = S.B.open_tab('about:blank')
    S.B.call('Page.enable', {}, session=sid)
    S.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.VP_PROSPECTS_API="/__api";window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message))});'}, session=sid)
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
    if mobile:
        S.B.call('Emulation.setUserAgentOverride', {'userAgent': admin_site.IPHONE_UA, 'platform': 'iPhone'}, session=sid)
        S.B.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5}, session=sid)
    S.B.call('Page.navigate', {'url': S.base + '/app/hq.html?as=admin'}, session=sid)
    S.until(sid, '!!document.querySelector("#prTab:not([hidden])")', 25)
    S.js(sid, 'document.getElementById("prTab").click(); true')
    S.until(sid, 'document.querySelectorAll("#paneProspects .prcard").length >= 4', 20)
    time.sleep(0.5)
    return tid, sid


try:
    tid, sid = open_hq(1440, 1000)
    print('\ncompact rows')
    rs = [row(sid, n) for n in NAMES]
    ok('every row starts compact: the details hidden, the chip not expanded', all(r.get('open') is False and r.get('expanded') == 'false' for r in rs), rs)
    ok('...and short: each row under 80px tall at 1440 wide', all(0 < r.get('h', 0) < 80 for r in rs), [r.get('h') for r in rs])
    q = row(sid, QUIET)
    ok('the chip says where they are and for how long: "Not signed in · 5 days"', q.get('chip') == 'Not signed in · 5 days', q.get('chip'))
    ok('a free month reads "Free month · N days left"', row(sid, FREE).get('chip', '').startswith('Free month · ') and row(sid, FREE).get('chip', '').endswith('days left'), row(sid, FREE).get('chip'))
    ok('the row with a mobile shows it under the name', row(sid, TEXTME).get('sub') == 'Contact 2 · 0412 345 678', row(sid, TEXTME).get('sub'))
    shot(sid, 'after-1440-compact', full=False)

    print('\nthe chip opens and closes a row')
    press(sid, QUIET, '[data-pr-toggle]')
    time.sleep(0.2)
    q = row(sid, QUIET)
    ok('pressing the chip opens the details and actions (aria-expanded true)', q.get('open') is True and q.get('expanded') == 'true' and q.get('edit') is True, q)
    ok('ONE send button, and with no mobile it says so: "email only, add a mobile to text it too"',
       q.get('send') == 'Send them a new sign-in linkemail only, add a mobile to text it too' and q.get('sendShown') is True and not q.get('welcome'), q)
    ok('no "Resend their account email" or "Resend sign-in link" anywhere on the tab',
       not S.js(sid, '/Resend their account email|Resend sign-in link/.test(document.getElementById("paneProspects").innerText)'))
    shot(sid, 'after-1440-open', full=False)
    press(sid, QUIET, '[data-pr-toggle]')
    time.sleep(0.2)
    ok('pressing it again closes it', row(sid, QUIET).get('open') is False and row(sid, QUIET).get('expanded') == 'false')

    print('\nEdit details: a mobile for a small venue on a Friday')
    count0 = S.js(sid, '(document.querySelector("#prTab .tabcount")||{}).textContent||"0"')
    press(sid, QUIET, '[data-pr-toggle]')
    press(sid, QUIET, '[data-pr-edit]')
    S.until(sid, '!!document.getElementById("prEdMobile")', 5)
    ok('Edit details opens the form with their name and email filled in', S.js(sid, 'document.getElementById("prEdName").value') == 'Contact 1'
       and S.js(sid, 'document.getElementById("prEdEmail").value') == 'p1@pub.test' and row(sid, QUIET).get('form') is True)
    shot(sid, 'after-1440-edit', full=False)
    S.js(sid, 'document.getElementById("prEdMobile").value="02 9876 5432"; true')
    press(sid, QUIET, '[data-pr-edit-save]')
    S.until(sid, '!document.getElementById("prEdErr").hidden', 8)
    msg = S.js(sid, 'document.getElementById("prEdErr").textContent') or ''
    ok('a landline as the mobile is refused on the form with the Worker\'s reason, and nothing is saved',
       'not an Australian mobile' in msg and not [f for f in S.W.table('venueplay_founding') if f['id'] == 'pe1' and f.get('mobile')], msg)
    S.js(sid, 'document.getElementById("prEdMobile").value="0412 999 888"; true')
    press(sid, QUIET, '[data-pr-edit-save]')
    S.until(sid, '!document.getElementById("prEdMobile") && /0412 999 888/.test((document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] .prsub\')||{}).textContent||"")' % vid(QUIET), 10)
    q = row(sid, QUIET)
    acct = [f for f in S.W.table('venueplay_founding') if f['id'] == 'pe1'][0]
    ok('saved: on the account, spaced, and as the number to ring', acct.get('mobile') == '0412 999 888'
       and [p for p in S.W.table('vp_prospects') if p['venue_id'] == vid(QUIET)][0].get('phone') == '0412 999 888', acct)
    ok('...and straight onto the call list: "Call them", a Call button that rings it, the tab count up by one',
       q.get('flag') == 'Call them' and q.get('call') == 'Call 0412 999 888' and
       int(S.js(sid, '(document.querySelector("#prTab .tabcount")||{}).textContent||"0"') or 0) == int(count0 or 0) + 1, [q, count0])
    ok('...the send button now says "by email and text"', q.get('send') == 'Send them a new sign-in linkby email and text', q.get('send'))
    aud = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'prospect_details_changed']
    ok('...and one audit row says who changed what, from and to', len(aud) == 1 and aud[0].get('actor_label') == 'Dean'
       and aud[0]['detail']['changes']['mobile']['to'] == '0412 999 888', aud)
    shot(sid, 'after-1440-saved', full=False)

    print('\nthe one send button')
    n_sent = len(S.W.sent())
    press(sid, QUIET, '[data-pr-signin]')
    S.until(sid, '!!document.getElementById("vpAskGo")', 5)
    t = page_text(sid)
    ok('it asks first: by email to them AND by text to the mobile, a fresh 30 days', 'It goes by email to p1@pub.test and by text to 0412 999 888' in t and 'fresh 30 days' in t, t[-400:])
    shot(sid, 'after-1440-send-ask', full=False)
    S.js(sid, 'document.getElementById("vpAskGo").click(); true')
    S.until(sid, '/The email went to p1@pub\\.test/.test(document.body.innerText)', 10)
    t = page_text(sid)
    ok('it sends the email through the real Worker and says how it went, and that texts are off (no SMS provider yet)',
       len(S.W.sent()) == n_sent + 1 and 'Sent by email, link works until' in t and 'texts are switched off' in t and 'The email went to p1@pub.test' in t, t[-400:])
    shot(sid, 'after-1440-send-done', full=False)
    S.js(sid, 'var g=document.getElementById("vpAskGo"); if(g) g.click(); true')
    press(sid, BOOKED, '[data-pr-toggle]')
    press(sid, BOOKED, '[data-pr-signin]')
    S.until(sid, '!!document.getElementById("vpAskGo")', 5)
    t = page_text(sid)
    ok('a welcome still booked: it offers to send that now (it carries their link), not a second link',
       'is booked for' in t and 'already carries their sign-in link' in t and 'Send it now instead?' in t, t[-400:])
    S.js(sid, 'document.getElementById("vpAskCancel").click(); true')
    time.sleep(0.3)
    ok('Cancel sends nothing', len(S.W.sent()) == n_sent + 1)
    ok('no script error on the page', errs(sid) == '[]', errs(sid))
    S.close_tab(tid)

    print('\nphone width')
    tid, sid = open_hq(390, 844, mobile=True)
    wide = S.js(sid, 'document.scrollingElement.scrollWidth - window.innerWidth')
    ok('no sideways scroll at 390px', isinstance(wide, (int, float)) and wide <= 1, wide)
    ok('rows are compact on a phone too (under 110px)', all(0 < row(sid, n).get('h', 0) < 110 for n in NAMES), [row(sid, n).get('h') for n in NAMES])
    S.js(sid, 'window.scrollTo(0, document.getElementById("paneProspects").getBoundingClientRect().top + scrollY - 20); true')
    time.sleep(0.3)
    shot(sid, 'after-390-compact', full=False)
    press(sid, TEXTME, '[data-pr-toggle]')
    time.sleep(0.3)
    fits = S.js(sid, '(function(){var w=window.innerWidth,bad=[];document.querySelectorAll("#paneProspects .prcard.open button,#paneProspects .prcard.open a.mini").forEach(function(e){var r=e.getBoundingClientRect();if(r.width>0&&r.right>w+1)bad.push(e.textContent);});return bad;})()')
    ok('an opened row\'s buttons all fit inside the screen', fits == [], fits)
    S.js(sid, 'document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"]\').scrollIntoView(); true' % vid(TEXTME))
    time.sleep(0.3)
    shot(sid, 'after-390-open', full=False)
    ok('no script error on the phone', errs(sid) == '[]', errs(sid))
    S.close_tab(tid)
finally:
    S.close()

print('\nChrome is cleaned up')
alive = subprocess.run(['ps', '-p', str(CHROME_PID)], capture_output=True).returncode == 0
left = subprocess.run(['pgrep', '-f', PROFILE], capture_output=True, text=True).stdout.strip()
ok('this suite\'s Chrome has exited and nothing runs on its profile', not alive and not left, left)
ok('its --user-data-dir is removed', not os.path.exists(PROFILE), PROFILE)

total = PASS[0] + FAIL[0]
print('\n%d of %d checks passed' % (PASS[0], total))
EXPECTED = 26
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
