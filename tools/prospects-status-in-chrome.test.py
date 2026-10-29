#!/usr/bin/env python3
"""HQ > PROSPECTS: WHERE EACH PROSPECT IS, IN THE REAL PAGE, AGAINST THE REAL BILLING WORKER.

Dean, 29 Oct 2026 (migration 127: a prospect's free month starts at their first sign-in, reminders go
while there is no card, the account pauses when it runs out, and "Cancel, it's not for us"). HQ's
Prospects tab now shows, per prospect: a status chip (Not signed in yet / Free month (X days left) /
Card added / Paused / Cancelled), the first sign-in, the free month's end, a highlight on the last
three days, the 3-day "Call them" flag as it was, and a filter and a sort by status.

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py: its own --user-data-dir,
removed on close) signed in as an owner admin. /admin/prospects is answered by the REAL billing Worker
(venueplay-api-FULL.js in jsc) from fixture rows covering every status, so the chip is what
vpaProspectStatus decided, not what this test hoped.

Free month ends are set on Brisbane calendar days counted from today, so "days left" does not move
with the clock (the Worker counts Brisbane days, the last day being 1).

Touches no git and no remote. Screenshots (desktop and phone width) with --shots DIR.

    python3 tools/prospects-status-in-chrome.test.py [--shots DIR]
"""
import argparse, datetime, os, subprocess, sys, time

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


NOSIGN, ASKED, FRESH, LAST3, FINAL, CARD, PAUSED, CANCEL = 1, 2, 3, 4, 5, 6, 7, 8
NAMES = {NOSIGN: 'Never Signed Arms', ASKED: "O'Brien's <b>Tavern</b>", FRESH: 'Fresh Start Hotel', LAST3: 'Three Days Hotel',
         FINAL: 'Final Day Inn', CARD: 'Card Club Hotel', PAUSED: 'Paused Pub', CANCEL: 'Cancelled Bowls Club'}
VENUES = [venue(n, NAMES[n]) for n in NAMES]
for v in VENUES:
    if v['id'] == vid(PAUSED):
        v.update(status='suspended', suspended_reason='free_month_ended')
    if v['id'] == vid(CANCEL):
        v.update(status='suspended', suspended_reason='cancelled')
FOUNDING = [{'id': 'pf%d' % n, 'status': 'pending', 'stripe_subscription_id': None, 'bill_by_invoice': False,
             'contact_email': 'p%d@pub.test' % n, 'venue_name': NAMES[n]} for n in NAMES]
FOUNDING[CARD - 1].update(status='card_on_file', stripe_subscription_id='sub_card')
PROSPECTS = [
    prospect(NOSIGN, ago(5)),                                                        # 5 days, nobody signed in: Call them
    prospect(ASKED, ago(1), call_requested=True),                                    # asked for a call
    prospect(FRESH, ago(17), first_signin_at=ago(16), free_month_ends_at=bne_end(13)),  # 14 days left
    prospect(LAST3, ago(29), first_signin_at=ago(27, 2), free_month_ends_at=bne_end(2)),  # 3 days left
    prospect(FINAL, ago(31), first_signin_at=ago(29, 2), free_month_ends_at=bne_end(0)),  # last day
    prospect(CARD, ago(12), first_signin_at=ago(11), free_month_ends_at=bne_end(19), card_choice='now'),
    prospect(PAUSED, ago(40), first_signin_at=ago(38), free_month_ends_at=bne_end(-8), paused_at=ago(7),
             reminders_sent=[3, 10, 17, 24, 28, 29, 30]),
    # Paused first, then pressed Cancel: Cancelled wins (they said no; a pause alone might still come back).
    prospect(CANCEL, ago(42), first_signin_at=ago(40), free_month_ends_at=bne_end(-10), paused_at=ago(9), cancelled_at=ago(2)),
]
SIGNED_IN = {FRESH: ago(1), LAST3: ago(0, 5), FINAL: ago(3), CARD: ago(2), PAUSED: ago(9), CANCEL: ago(2)}
AUTH = [{'id': uid(n), 'email': 'p%d@pub.test' % n, 'phone': '', 'last_sign_in_at': SIGNED_IN.get(n)} for n in NAMES]

S = admin_site.Site(fonts=bool(A.shots), live_tables=['vp_venues', 'vp_admin_audit'])
UID = S.W.info['uid']
PROFILE, CHROME_PID = S.B.profile, S.B.proc.pid
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_venues', VENUES)
S.W.seed('venueplay_founding', FOUNDING)
S.W.seed('vp_prospects', PROSPECTS)
S.W.seed('vp_venue_staff', [{'venue_id': vid(n), 'auth_user_id': uid(n), 'role': 'owner'} for n in NAMES])
S.W.seed('auth', AUTH)
S.W.seed('vp_prospect_welcomes', [])
S.W.seed('vp_sessions', [])
S.W.seed('vp_game_reports', [])
S.W.seed('vp_admin_audit', [])

SHOTS = A.shots


def shot(sid, name, full=True):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        S.shot(sid, os.path.join(SHOTS, name + '.png'), full=full)


CARD_JS = '''(function(id){var c=document.querySelector('#paneProspects .prcard[data-pr-id="'+id+'"]');if(!c)return null;
  var b=c.querySelector("[data-pr-status]"),r=b?b.getBoundingClientRect():null;
  return {st:b&&b.getAttribute("data-pr-status"),chip:b?b.textContent:"",shown:!!(r&&r.width>0&&getComputedStyle(b).display!=="none"),
    first:(c.querySelector("[data-pr-first]")||{}).textContent||"",ends:(c.querySelector("[data-pr-ends]")||{}).textContent||"",
    last3:c.classList.contains("last3"),lastline:(c.querySelector("[data-pr-last]")||{}).textContent||"",
    flag:(c.querySelector(".prflag")||{}).textContent||"",called:!!c.querySelector("[data-pr-called]"),resend:!!c.querySelector("[data-pr-signin]"),text:c.innerText.replace(/\\s+/g," ")};})("%s")'''


def card(sid, n):
    return S.js(sid, CARD_JS % vid(n)) or {}


def shown_ids(sid):
    return S.js(sid, '[].map.call(document.querySelectorAll("#paneProspects .prcard"),function(c){return c.getAttribute("data-pr-id");})') or []


def choose(sid, sel, value):
    S.js(sid, 'var s=document.getElementById("%s");s.value="%s";s.dispatchEvent(new Event("change",{bubbles:true}));true' % (sel, value))
    time.sleep(0.2)


def open_hq(width, height, mobile=False):
    """admin_site.Site.open, plus one line before any script runs: the rig rewrites the Worker address in
    HTML only, and vp-prospects-hq.js names it in JavaScript, honouring window.VP_PROSPECTS_API."""
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
    S.until(sid, 'document.querySelectorAll("#paneProspects .prcard").length >= 8', 20)
    time.sleep(0.5)
    return tid, sid


try:
    tid, sid = open_tab(1280, 1000)

    print('\nevery status, as the Worker decided it')
    c = card(sid, NOSIGN)
    ok('Never Signed Arms: Not signed in yet, first sign-in "Not yet", free month starts at their first sign-in',
       c.get('st') == 'not_signed_in' and c.get('chip') == 'Not signed in yet' and c.get('shown') and c.get('first') == 'Not yet'
       and c.get('ends') == 'Starts at their first sign-in', c)
    ok('...and the 3-day "Call them" flag is kept as it was', c.get('flag') == 'Call them' and 'Nobody has signed in since they were set up 5 days ago' in c.get('text', ''), c)
    c = card(sid, ASKED)
    ok("O'Brien's Tavern: Not signed in yet, Call requested, its name escaped (no bold tag run)",
       c.get('st') == 'not_signed_in' and c.get('flag') == 'Call requested' and "O'Brien's <b>Tavern</b>" in c.get('text', ''), c)
    c = card(sid, FRESH)
    ok('Fresh Start Hotel: Free month (14 days left), no highlight, no call flag',
       c.get('st') == 'free_month' and c.get('chip') == 'Free month (14 days left)' and not c.get('last3') and c.get('flag') == '', c)
    end13 = TODAY_BNE + datetime.timedelta(days=13)
    ok('...first sign-in and the free month end date shown, in Brisbane days',
       c.get('first', '').count(',') == 1 and c.get('ends', '').startswith('%s %d %s' % (end13.strftime('%a'), end13.day, end13.strftime('%b'))), c)
    c = card(sid, LAST3)
    ok('Three Days Hotel: Free month (3 days left), highlighted, with the line saying so',
       c.get('chip') == 'Free month (3 days left)' and c.get('last3') and c.get('lastline') == '3 days left in their free month, and no card yet.', c)
    c = card(sid, FINAL)
    ok('Final Day Inn: Free month (last day), highlighted', c.get('chip') == 'Free month (last day)' and c.get('last3')
       and c.get('lastline') == 'Last day of their free month, and no card yet.', c)
    c = card(sid, CARD)
    ok('Card Club Hotel: Card added, its free month end shown, no Called button',
       c.get('st') == 'card_added' and c.get('chip') == 'Card added' and not c.get('called') and c.get('ends') and not c.get('last3'), c)
    ok('...and it is a customer: isProspect() does not name it, so Venues keeps it',
       S.js(sid, 'window.VPProspects.isProspect("%s")' % vid(CARD)) is False and S.js(sid, 'window.VPProspects.isProspect("%s")' % vid(NOSIGN)) is True)
    c = card(sid, PAUSED)
    ok('Paused Pub: Paused, the free month "Ended ..., paused ..."', c.get('st') == 'paused' and c.get('chip') == 'Paused'
       and c.get('ends', '').startswith('Ended ') and ', paused ' in c.get('ends', ''), c)
    c = card(sid, CANCEL)
    ok('Cancelled Bowls Club (paused, then cancelled): Cancelled, not Paused, and no Called button (they said no)', c.get('st') == 'cancelled' and c.get('chip') == 'Cancelled' and not c.get('called'), c)
    ok('...and no Resend sign-in link either: they asked us to stop', not c.get('resend'), c)
    ok('every prospect still in play (not signed in, free month, paused, card added) keeps Resend sign-in link (phone sign-in, 29 Oct)',
       all(card(sid, n).get('resend') for n in (NOSIGN, ASKED, FRESH, LAST3, FINAL, PAUSED, CARD)),
       [NAMES[n] for n in (NOSIGN, ASKED, FRESH, LAST3, FINAL, PAUSED, CARD) if not card(sid, n).get('resend')])
    ok('the tab count is still who to call (2), not every prospect',
       S.js(sid, '(document.querySelector("#prTab .tabcount")||{}).textContent') == '2')
    shot(sid, 'desktop-all')

    print('\nfilter by status')
    want = {'not_signed_in': {NOSIGN, ASKED}, 'free_month': {FRESH, LAST3, FINAL}, 'last_days': {LAST3, FINAL},
            'card_added': {CARD}, 'paused': {PAUSED}, 'cancelled': {CANCEL}}
    for f, ns in sorted(want.items()):
        choose(sid, 'prFilter', f)
        got = set(shown_ids(sid))
        ok('Show %s: exactly %s' % (f, ', '.join(sorted(NAMES[n] for n in ns))), got == {vid(n) for n in ns}, sorted(got))
        if f == 'last_days':
            shot(sid, 'desktop-filter-last-days')
    label = S.js(sid, 'document.querySelector("#prFilter option[value=last_days]").textContent')
    ok('the filter says how many of each: "Last 3 days of free month (2)"', label == 'Last 3 days of free month (2)', label)
    choose(sid, 'prFilter', 'all')
    ok('Show all: all eight', len(shown_ids(sid)) == 8, shown_ids(sid))

    print('\nsort')
    order = shown_ids(sid)
    ok('default (who to call first): Call requested, then Call them, first', order[:2] == [vid(ASKED), vid(NOSIGN)], order)
    choose(sid, 'prSort', 'days_left')
    order = shown_ids(sid)
    ok('Fewest days left: Final Day Inn, Three Days Hotel, Fresh Start Hotel', order[:3] == [vid(FINAL), vid(LAST3), vid(FRESH)], order)
    choose(sid, 'prSort', 'status')
    sts = S.js(sid, '[].map.call(document.querySelectorAll("#paneProspects .prcard [data-pr-status]"),function(b){return b.getAttribute("data-pr-status");})')
    ok('Status: not signed in, free month, paused, card added, cancelled, grouped in that order',
       sts == ['not_signed_in'] * 2 + ['free_month'] * 3 + ['paused', 'card_added', 'cancelled'], sts)
    choose(sid, 'prFilter', 'free_month')
    ok('a filter and a sort together: free month by status = fewest days first',
       shown_ids(sid) == [vid(FINAL), vid(LAST3), vid(FRESH)], shown_ids(sid))
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the page', errs == '[]', errs)
    S.close_tab(tid)

    print('\nphone width')
    tid, sid = open_tab(390, 844, mobile=True)
    wide = S.js(sid, 'document.scrollingElement.scrollWidth - window.innerWidth')
    ok('no sideways scroll at 390px', isinstance(wide, (int, float)) and wide <= 1, wide)
    c = card(sid, LAST3)
    ok('the chip and the 3-day highlight are drawn on a phone', c.get('shown') and c.get('last3') and c.get('lastline'), c)
    fits = S.js(sid, '(function(){var w=window.innerWidth,bad=[];document.querySelectorAll("#paneProspects .prbar select,#paneProspects [data-pr-status]").forEach(function(e){var r=e.getBoundingClientRect();if(r.right>w+1||r.width<=0)bad.push(e.id||e.textContent);});return bad;})()')
    ok('the filter, the sort and every chip fit inside the screen', fits == [], fits)
    squeeze = S.js(sid, '(function(){var bad=[];document.querySelectorAll("#paneProspects .prcard").forEach(function(c){var n=c.querySelector(".prname"),t=c.querySelector(".prtop");if(n.getBoundingClientRect().width<t.getBoundingClientRect().width*0.9)bad.push(n.textContent);});return bad;})()')
    ok('on a phone the venue name gets the whole line, the chips go under it (not squeezed letter by letter)', squeeze == [], squeeze)
    S.js(sid, 'window.scrollTo(0, document.getElementById("paneProspects").getBoundingClientRect().top + scrollY - 200); true')
    time.sleep(0.3)
    shot(sid, 'phone-top', full=False)
    S.js(sid, 'document.querySelector("#paneProspects .prcard[data-pr-id=\\"%s\\"]").scrollIntoView(); true' % vid(LAST3))
    time.sleep(0.3)
    shot(sid, 'phone-three-days', full=False)
    S.close_tab(tid)

    print('\nHQ only: a staff admin (not owner or accounts) never sees the tab')
    S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'staff', 'label': 'Helper'}])
    tid, sid = open_hq(1280, 900)
    S.until(sid, 'document.readyState==="complete"', 20)
    time.sleep(4)
    seen = S.js(sid, '({hidden:document.getElementById("prTab").hidden,cards:document.querySelectorAll("#paneProspects .prcard").length})')
    ok('the Prospects tab stays hidden and no prospect is drawn', isinstance(seen, dict) and seen.get('hidden') is True and seen.get('cards') == 0, seen)
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
EXPECTED = 34
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
