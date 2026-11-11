#!/usr/bin/env python3
"""HQ > PROSPECTS, DAY 21: THE GAMES A FREE-MONTH VENUE PICKED AND HAS NOT PLAYED, IN THE REAL PAGE.

Dean, 10 Nov 2026 (INBOX 129): "on day 21 of a free month, HQ Prospects flags any venue that has NOT played
one or more of the games it picked at sign-up ... Flag shows in the Prospects list and on the venue, plus one
line in Dean's HQ alert. Venues with no wizard answers: flag if no game at all by day 21. Nothing is sent to
the venue by this flag."

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py: its own --user-data-dir, removed
on close) signed in as an owner admin. /admin/prospects is answered by the REAL billing Worker in jsc from
fixture rows: test venues whose first sign-in was 21 days ago (day 21) or 20 days ago (day 20), with wizard
answers (vp_venue_settings.setup_answers) and games (vp_sessions + vp_games). Then the REAL day-21 sweep
(vpaProspectDay21Sweep) runs once in the same Worker, and its alert is read in the REAL HQ help desk.

Checks: the red flag beside the status in the list ("Bingo not played", "Picked trivia, bingo; played none",
"No game played yet"); nothing on a day-20 venue or one that played its games; musical bingo is never bingo;
the line on the venue's details; the "Games not played by day 21" filter; at phone width the flag fits; the
help desk has ONE new Sales ticket with one line per flagged venue; no email to anyone.

Touches no git and no remote; local harness only. Screenshots with --shots DIR.

    python3 tools/prospects-day21-in-chrome.test.py [--shots DIR]
"""
import argparse, datetime, json, os, sys, time

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
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:500],)) if detail != '' else ''))


UTC = datetime.timezone.utc
NOW = datetime.datetime.now(UTC)
BNE = datetime.timedelta(hours=10)
TODAY_BNE = (NOW + BNE).date()
# Noon Brisbane today: the sweep only alerts from 9am, so it is run at noon whatever the real hour is.
NOON_MS = int((datetime.datetime(TODAY_BNE.year, TODAY_BNE.month, TODAY_BNE.day, 12, 0, tzinfo=UTC) - BNE).timestamp() * 1000)


def iso(dt):
    return dt.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def ago(days, hours=0):
    return iso(NOW - datetime.timedelta(days=days, hours=hours))


def bne_end(day_offset):
    d = TODAY_BNE + datetime.timedelta(days=day_offset)
    return iso(datetime.datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=UTC) - BNE)


def vid(n):
    return '41000000-0000-4000-8000-%012d' % n


def uid(n):
    return '42000000-0000-4000-8000-%012d' % n


# n: (name, days since first sign-in, wizard games or None, formats played)
FIX = {
    1: ('Test Alpha Day21 Hotel', 21, ['trivia', 'bingo'], ['trivia']),          # bingo not played
    2: ('Test Bravo Day21 Arms', 21, ['trivia', 'bingo'], []),                    # picked trivia, bingo; played none
    3: ('Test Charlie Day21 Tavern', 21, None, []),                               # no answers, nothing: no game played yet
    4: ('Test Musical Day21 Inn', 21, ['bingo'], ['musical_bingo']),              # musical bingo is not bingo
    5: ('Test Played All Day21 Club', 21, ['trivia', 'musical'], ['trivia', 'musical_bingo']),   # no flag
    6: ('Test Day20 Hotel', 20, ['trivia', 'bingo'], []),                         # day 20: no flag yet
}
FLAGGED = {1: 'Bingo not played', 2: 'Picked trivia, bingo; played none', 3: 'No game played yet', 4: 'Bingo not played'}

VENUES, FOUNDING, PROSPECTS, SETTINGS, SESSIONS, GAMES, AUTH = [], [], [], [], [], [], []
for n, (name, days, games, played) in FIX.items():
    VENUES.append({'id': vid(n), 'name': name, 'slug': 'd21-%d' % n, 'status': 'active', 'suspended_reason': None, 'created_at': ago(days + 2),
                   'timezone': 'Australia/Brisbane', 'founding_id': 'df%d' % n, 'group_id': None, 'max_players': 10, 'au_state': 'QLD',
                   'postcode': '4225', 'cancel_at_period_end': False, 'weekly_limit_off': False})
    FOUNDING.append({'id': 'df%d' % n, 'status': 'pending', 'stripe_subscription_id': None, 'bill_by_invoice': False,
                     'contact_email': 'd%d@pub.test' % n, 'venue_name': name})
    PROSPECTS.append({'venue_id': vid(n), 'founding_id': 'df%d' % n, 'auth_user_id': uid(n), 'source': 'hq', 'contact_name': 'Contact %d' % n,
                      'email': 'd%d@pub.test' % n, 'phone': None, 'website': None, 'created_at': ago(days + 2), 'called_at': None,
                      'called_label': None, 'call_note': None, 'call_requested': False, 'first_signin_at': ago(days),
                      'free_month_ends_at': bne_end(30 - days), 'offer_rate': 2.5, 'card_choice': None, 'card_choice_at': None,
                      'reminders_sent': [3], 'paused_at': None, 'cancelled_at': None})
    if games is not None:
        SETTINGS.append({'venue_id': vid(n), 'setup_answers': {'games': games, 'nights': ['fri']}})
    for i, f in enumerate(played):
        sid_ = 'd21s%d%d' % (n, i)
        SESSIONS.append({'id': sid_, 'venue_id': vid(n), 'is_demo': False, 'opened_at': ago(5), 'started_at': ago(5), 'ended_at': ago(5),
                         'created_at': ago(5), 'status': 'ended'})
        GAMES.append({'id': 'd21g%d%d' % (n, i), 'session_id': sid_, 'format': f})
    AUTH.append({'id': uid(n), 'email': 'd%d@pub.test' % n, 'phone': '', 'last_sign_in_at': ago(1)})

S = admin_site.Site(fonts=bool(A.shots), live_tables=['vp_venues', 'vp_admin_audit'])
UID = S.W.info['uid']
PROFILE, CHROME_PID = S.B.profile, S.B.proc.pid
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_venues', VENUES)
S.W.seed('venueplay_founding', FOUNDING)
S.W.seed('vp_prospects', PROSPECTS)
S.W.seed('vp_venue_staff', [{'venue_id': vid(n), 'auth_user_id': uid(n), 'role': 'owner'} for n in FIX])
S.W.seed('auth', AUTH)
S.W.seed('vp_venue_settings', SETTINGS)
S.W.seed('vp_sessions', SESSIONS)
S.W.seed('vp_games', GAMES)
S.W.seed('vp_game_reports', [])
S.W.seed('vp_member_draws', [])
S.W.seed('vp_member_draw_results', [])
S.W.seed('vp_prospect_welcomes', [])
S.W.seed('vp_admin_audit', [])
S.W.seed('vp_help_tickets', [])
S.W.seed('vp_help_ticket_notes', [])
S.W.seed('vp_help_messages', [])


def shot(sid, name, full=True):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'), full=full)


CARD_JS = '''(function(id){var c=document.querySelector('#paneProspects .prcard[data-pr-id="'+id+'"]');if(!c)return null;
  var top=c.querySelector(".prtop"),b=c.querySelector("[data-pr-day21]"),r=b?b.getBoundingClientRect():null,cr=c.getBoundingClientRect();
  var line=c.querySelector("[data-pr-day21line]");
  return {badge:b?b.textContent:"",inTop:!!(b&&top&&top.contains(b)),shown:!!(r&&r.width>0&&r.height>0),
    inside:!!(r&&r.left>=cr.left-1&&r.right<=cr.right+1),red:b?getComputedStyle(b).color:"",
    line:line?line.textContent:"",lineShown:!!(line&&line.getBoundingClientRect().height>0)};})("%s")'''


def card(sid, n):
    return S.js(sid, CARD_JS % vid(n)) or {}


def shown_ids(sid):
    return S.js(sid, '[].map.call(document.querySelectorAll("#paneProspects .prcard"),function(c){return c.getAttribute("data-pr-id");})') or []


def open_tab(width, height, mobile=False):
    tid, sid = S.B.open_tab('about:blank')
    S.B.call('Page.enable', {}, session=sid)
    S.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.VP_PROSPECTS_API="/__api";'}, session=sid)
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
    if mobile:
        S.B.call('Emulation.setUserAgentOverride', {'userAgent': admin_site.IPHONE_UA, 'platform': 'iPhone'}, session=sid)
        S.B.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5}, session=sid)
    S.B.call('Page.navigate', {'url': S.base + '/app/hq.html?as=admin'}, session=sid)
    S.until(sid, '!!document.querySelector("#prTab:not([hidden])")', 25)
    S.js(sid, 'document.getElementById("prTab").click(); true')
    S.until(sid, 'document.querySelectorAll("#paneProspects .prcard").length >= %d' % len(FIX), 20)
    S.settled(sid, 'document.querySelectorAll("#paneProspects [data-pr-day21]").length')
    return tid, sid


try:
    tid, sid = open_tab(1280, 1000)
    print('\nthe flag in the Prospects list (the row, always visible)')
    for n, want in sorted(FLAGGED.items()):
        c = card(sid, n)
        ok('%s: "%s" beside its status, in red' % (FIX[n][0], want), c.get('badge') == want and c.get('inTop') and c.get('shown')
           and c.get('red') == 'rgb(255, 138, 142)', c)
    ok('Test Musical Day21 Inn played musical bingo, picked bingo: "Bingo not played" (MUSICAL BINGO IS NOT BINGO)', card(sid, 4).get('badge') == 'Bingo not played', card(sid, 4))
    ok('a venue that played every game it picked: no flag', card(sid, 5).get('badge') == '' and card(sid, 5) != {}, card(sid, 5))
    ok('a venue on day 20: no flag yet', card(sid, 6).get('badge') == '' and card(sid, 6) != {}, card(sid, 6))
    shot(sid, 'desktop-list')

    print('\non the venue (its details)')
    S.js(sid, 'document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-toggle]\').click(); true' % vid(2))
    S.until(sid, '!!document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-day21line]\') && document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"] [data-pr-day21line]\').getBoundingClientRect().height > 0' % (vid(2), vid(2)), 8)
    c = card(sid, 2)
    ok('opened: "Day 21 of their free month: picked trivia, bingo; played none. Nothing has been sent to them about it."',
       c.get('lineShown') and c.get('line') == 'Day 21 of their free month: picked trivia, bingo; played none. Nothing has been sent to them about it.', c)
    shot(sid, 'desktop-open')

    print('\nthe filter')
    S.js(sid, 'var s=document.getElementById("prFilter");s.value="not_played";s.dispatchEvent(new Event("change",{bubbles:true}));true')
    S.settled(sid, 'document.querySelectorAll("#paneProspects .prcard").length')
    got = set(shown_ids(sid))
    ok('"Games not played by day 21" shows exactly the four flagged venues', got == {vid(n) for n in FLAGGED}, sorted(got))
    label = S.js(sid, 'document.querySelector("#prFilter option[value=not_played]").textContent')
    ok('the filter says how many: "Games not played by day 21 (4)"', label == 'Games not played by day 21 (4)', label)
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the page', errs == '[]', errs)
    S.close_tab(tid)

    print('\nat phone width (375)')
    tid, sid = open_tab(375, 812, mobile=True)
    c = card(sid, 2)
    ok('the longest flag fits inside its row at 375px, no sideways scroll', c.get('shown') and c.get('inside')
       and S.js(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1') is True, c)
    shot(sid, 'phone-list')
    S.close_tab(tid)

    print('\nDean\'s HQ alert: the day-21 sweep, then the help desk')
    r = S.W.day21(NOON_MS)
    body = r.get('body') or {}
    ok('the sweep (run at noon Brisbane today) alerts the four flagged venues', r.get('status') == 200 and body.get('alerted') == 4, r)
    tickets = S.W.table('vp_help_tickets')
    t = tickets[0] if tickets else {}
    ok('ONE new help desk ticket, in Sales', len(tickets) == 1 and t.get('category') == 'sales', tickets)
    lines = [l for l in (t.get('message') or '').split('\n') if ' (day 21): ' in l]
    ok('one line per flagged venue, in its own words', sorted(lines) == sorted([
        'Test Alpha Day21 Hotel (day 21): bingo not played', 'Test Bravo Day21 Arms (day 21): picked trivia, bingo; played none',
        'Test Charlie Day21 Tavern (day 21): no game played yet', 'Test Musical Day21 Inn (day 21): bingo not played']), lines)
    ok('no email went to anyone', S.W.sent() == [], S.W.sent())
    again = S.W.day21(NOON_MS + 3600000)
    ok('the next hour: no second alert', (again.get('body') or {}).get('alerted') == 0 and len(S.W.table('vp_help_tickets')) == 1, again)
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1000)
    S.until(sid, '!!document.getElementById("hdTab")', 25)
    S.js(sid, 'document.getElementById("hdTab").click(); true')
    S.until(sid, 'document.querySelectorAll("#hdRows [data-id]").length > 0', 15)
    row = S.js(sid, '(function(){var r=document.querySelector("#hdRows [data-id]");return r?r.innerText:"";})()') or ''
    ok('the help desk lists it: "Day 21: 4 free-month venues have not played their games"', 'Day 21: 4 free-month venues have not played their games' in row, row)
    S.js(sid, 'document.querySelector("#hdRows [data-id]").click(); true')
    S.until(sid, '!!document.getElementById("hdTicket") && /Test Bravo Day21 Arms \\(day 21\\)/.test(document.getElementById("hdTicket").innerText)', 10)
    txt = S.js(sid, '(document.getElementById("hdTicket")||{}).innerText') or ''
    ok('opened, it shows the one line for each venue', all(l in txt for l in lines) and len(lines) == 4, txt[:600])
    shot(sid, 'helpdesk-alert')
    S.close_tab(tid)
finally:
    S.close()

# The gate reads the LAST line (release-check.suite_passed): "ALL N CHECKS PASSED" or "N of N checks passed".
# "PASS: 19 passed, 0 failed" was neither, so a green run read as red and failed the 12 Nov pre-push gate.
print('\nALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '\nFAIL: %d passed, %d failed' % (PASS[0], FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
