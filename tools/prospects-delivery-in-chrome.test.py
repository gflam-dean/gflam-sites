#!/usr/bin/env python3
"""HQ > PROSPECTS: A CHIP PER EMAIL SENT, AND THE RESEND DRAFT, IN THE REAL PAGE (Dean, 16 Nov 2026, Jobs row 226).

Opens the REAL hq.html in headless Chrome signed in as an owner admin, against the REAL billing Worker. Three prospects:
a welcome that BOUNCED (a draft, Yes held back until the address is changed), a welcome that went 4 days ago and was
never opened (a draft, with a follow-up that bounced shown in red), and one that signed in (chips, no draft).
Proves the chips, the DRAFT FOR DEAN block with Yes / Edit / No, Edit opening the words, No hiding the draft, and that
nothing is sent by showing the page. Screenshots at phone, iPad and laptop width with --shots DIR.

    python3 tools/prospects-delivery-in-chrome.test.py [--shots DIR]
"""
import argparse, datetime, os, re, subprocess, sys, time

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
        print('  FAIL %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))


UTC = datetime.timezone.utc
NOW = datetime.datetime.now(UTC)
BNE = datetime.timedelta(hours=10)
TODAY_BNE = (NOW + BNE).date()


def iso(dt):
    return dt.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def ago(days, hours=0):
    return iso(NOW - datetime.timedelta(days=days, hours=hours))


def bne_end(day_offset):
    """11:59:59pm Brisbane on today + day_offset, as the Worker writes free_month_ends_at."""
    d = TODAY_BNE + datetime.timedelta(days=day_offset)
    return iso(datetime.datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=UTC) - BNE)


def vid(n):
    return '31000000-0000-4000-8000-%012d' % n


def uid(n):
    return '32000000-0000-4000-8000-%012d' % n


def venue(n, name, **kw):
    v = {'id': vid(n), 'name': name, 'slug': 'pr-%d' % n, 'status': 'active', 'suspended_reason': None,
         'created_at': ago(20), 'timezone': 'Australia/Brisbane', 'founding_id': 'pf%d' % n, 'group_id': None,
         'max_players': 10, 'au_state': 'QLD', 'postcode': '4225', 'cancel_at_period_end': False, 'weekly_limit_off': False}
    v.update(kw)
    return v


def prospect(n, created, **kw):
    r = {'venue_id': vid(n), 'founding_id': 'pf%d' % n, 'auth_user_id': uid(n), 'source': 'hq', 'contact_name': 'Contact %d' % n,
         'email': 'p%d@pub.test' % n, 'phone': '0412 345 6%02d' % n, 'website': None, 'created_at': created,
         'called_at': None, 'called_label': None, 'call_note': None, 'call_requested': False,
         'first_signin_at': None, 'free_month_ends_at': None, 'offer_rate': 2.5, 'card_choice': None, 'card_choice_at': None,
         'reminders_sent': [], 'paused_at': None, 'cancelled_at': None}
    r.update(kw)
    return r



B_BOUNCE, B_QUIET, B_IN = 1, 2, 3
NAMES = {B_BOUNCE: 'Bounced Welcome Hotel', B_QUIET: 'Never Opened Arms', B_IN: 'Signed In Tavern'}
VENUES = [venue(n, NAMES[n]) for n in NAMES]
FOUNDING = [{'id': 'pf%d' % n, 'status': 'pending', 'stripe_subscription_id': None, 'bill_by_invoice': False,
             'contact_email': 'p%d@pub.test' % n, 'venue_name': NAMES[n]} for n in NAMES]
PROSPECTS = [prospect(B_BOUNCE, ago(5)), prospect(B_QUIET, ago(6)), prospect(B_IN, ago(6), first_signin_at=ago(1), free_month_ends_at=bne_end(20))]
AUTH = [{'id': uid(n), 'email': 'p%d@pub.test' % n, 'phone': '', 'last_sign_in_at': ago(1) if n == B_IN else None} for n in NAMES]
WELCOMES = [{'id': '33000000-0000-4000-8000-%012d' % n, 'venue_id': vid(n), 'email': 'p%d@pub.test' % n, 'send_at': ago(4 if n != B_IN else 6),
             'status': 'scheduled', 'resend_id': 're_%d' % n, 'detail': {}} for n in NAMES]
AUDIT = [
    {'id': '34000000-0000-4000-8000-000000000001', 'action': 'email_bounced', 'target': 'venue:' + vid(B_BOUNCE), 'created_at': ago(4),
     'detail': {'address': 'p1@pub.test', 'reason': '550 mailbox unavailable'}, 'actor_label': 'system'},
    {'id': '34000000-0000-4000-8000-000000000002', 'action': 'prospect_nudge_sent', 'target': 'venue:' + vid(B_QUIET), 'created_at': ago(3, 2),
     'detail': {'to': 'p2@pub.test'}, 'actor_label': 'autopilot'},
    {'id': '34000000-0000-4000-8000-000000000003', 'action': 'email_bounced', 'target': 'venue:' + vid(B_QUIET), 'created_at': ago(3, 1),
     'detail': {'address': 'p2@pub.test', 'reason': '452 mailbox full'}, 'actor_label': 'system'},
]

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
S.W.seed('vp_sessions', [])
S.W.seed('vp_game_reports', [])
S.W.seed('vp_admin_audit', AUDIT)
SHOTS = A.shots


def shot(sid, name, full=True):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        S.shot(sid, os.path.join(SHOTS, name + '.png'), full=full)


def open_hq(width, height, mobile=False):
    tid, sid = S.B.open_tab('about:blank')
    S.B.call('Page.enable', {}, session=sid)
    S.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.VP_PROSPECTS_API="/__api";'}, session=sid)
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
    if mobile:
        S.B.call('Emulation.setUserAgentOverride', {'userAgent': admin_site.IPHONE_UA, 'platform': 'iPhone'}, session=sid)
        S.B.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5}, session=sid)
    S.B.call('Page.navigate', {'url': S.base + '/app/hq.html?as=admin'}, session=sid)
    return tid, sid


def open_tab(width, height, mobile=False):
    tid, sid = open_hq(width, height, mobile=mobile)
    S.until(sid, 'document.querySelectorAll("#venueRows .vn").length > 0 || !!document.querySelector("#prTab:not([hidden])")', 25)
    S.until(sid, '!!document.querySelector("#prTab:not([hidden])")', 20)
    S.js(sid, 'document.getElementById("prTab").click(); true')
    S.until(sid, 'document.querySelectorAll("#paneProspects .prcard").length >= 3', 20)
    for n in NAMES:   # open every card's details
        S.js(sid, '(function(){var c=document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-toggle]\');if(c)c.click();return true;})()' % vid(n))
    time.sleep(0.5)
    return tid, sid


CARD = '''(function(id){var c=document.querySelector('#paneProspects .prcard[data-pr-id="'+id+'"]');if(!c)return null;
  var d=c.querySelector("[data-pr-draft]"),y=c.querySelector("[data-pr-draft-yes]");
  return {chips:[].map.call(c.querySelectorAll("[data-pr-mail]"),function(m){return m.getAttribute("data-pr-mail")+"|"+m.textContent.replace(/\\s+/g," ");}),
    draft:d?d.getAttribute("data-pr-draft"):null,draftText:d?d.textContent.replace(/\\s+/g," "):"",yes:!!y,yesDisabled:!!(y&&y.disabled),
    edit:!!c.querySelector("[data-pr-draft-edit]"),no:!!c.querySelector("[data-pr-draft-no]"),badge:/Draft waiting/.test(c.textContent),
    box:!!c.querySelector("textarea.prdrafttext"),w:c.getBoundingClientRect().width,sw:document.documentElement.scrollWidth,vw:window.innerWidth};})("%s")'''


def card(sid, n):
    return S.js(sid, CARD % vid(n)) or {}


try:
    tid, sid = open_tab(1280, 1000)
    print('\nthe bounced welcome')
    c = card(sid, B_BOUNCE)
    ok('one red chip: the welcome bounced, in the Worker\'s words', len(c.get('chips', [])) == 1 and c['chips'][0].startswith('bounced|') and 'Bounced at pub.test' in c['chips'][0], c)
    ok('a DRAFT FOR DEAN with Draft waiting, Edit and No, and Yes held back (the address bounced)', c.get('draft') == 'bounced' and 'DRAFT FOR DEAN' in c.get('draftText', '')
       and c.get('badge') and c.get('edit') and c.get('no') and c.get('yes') and c.get('yesDisabled'), c)
    print('\nthe welcome nobody opened, with a follow-up that bounced')
    c = card(sid, B_QUIET)
    ok('two chips, newest first: the follow-up bounced (red), the welcome unconfirmed', len(c.get('chips', [])) == 2 and c['chips'][0].startswith('bounced|') and 'Follow-up email' in c['chips'][0]
       and 'Welcome email' in c['chips'][1], c)
    ok('a bounce on the follow-up makes the draft a bounced one: Yes held back until the address changes', c.get('draft') == 'bounced' and c.get('yesDisabled'), c)
    print('\nthe prospect who signed in')
    c = card(sid, B_IN)
    ok('a Signed in chip and no draft, no badge', any(m.startswith('signed_in|') for m in c.get('chips', [])) and c.get('draft') is None and not c.get('badge'), c)
    print('\nEdit opens the words; nothing is sent by opening or editing')
    n0 = len(S.W.sent() or [])
    S.js(sid, 'document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-draft-edit]\').click(); true' % vid(B_BOUNCE))
    time.sleep(0.6)
    S.js(sid, '(function(){var c=document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-toggle]\');if(c&&!document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-draft]\'))c.click();return true;})()' % (vid(B_BOUNCE), vid(B_BOUNCE)))
    c = card(sid, B_BOUNCE)
    ok('Edit puts the draft words in a box Dean can change', c.get('box') is True, c)
    shot(sid, 'laptop-1280')
    S.js(sid, 'document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-draft-no]\').click(); true' % vid(B_QUIET))
    S.until(sid, '!document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-draft]\')' % vid(B_QUIET), 15)
    c = card(sid, B_QUIET)
    ok('No hides that draft (and the badge), the chips stay', c.get('draft') is None and not c.get('badge') and len(c.get('chips', [])) == 2, c)
    ok('...and nothing was emailed by showing, editing or dismissing a draft, and no resend was audited', len(S.W.sent() or []) == n0
       and not any(a.get('action') == 'prospect_resend_draft_sent' for a in (S.W.table('vp_admin_audit') or [])), len(S.W.sent() or []))
    S.close_tab(tid)

    for label, w, h, mob in (('phone-390', 390, 844, True), ('ipad-820', 820, 1180, False)):
        print('\n' + label)
        tid, sid = open_tab(w, h, mobile=mob)
        c = card(sid, B_BOUNCE)
        ok('%s: the card fits the screen, nothing scrolls sideways' % label, c.get('sw', 0) <= c.get('vw', 0) + 1, c)
        ok('%s: chips and draft are drawn' % label, c.get('draft') == 'bounced' and len(c.get('chips', [])) == 1, c)
        shot(sid, label)
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
EXPECTED = 14
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
