#!/usr/bin/env python3
"""HQ > JOURNEY, IN THE REAL PAGE, AGAINST THE REAL BILLING WORKER (INBOX 413, 15 Nov 2026).

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py) with the REAL Worker behind it (its /admin/journey-funnel,
/admin/journey-campaigns and /admin/journey-venue routes run on a fake database seeded with a week of journey events: a quick-game funnel,
a form with a missing-venue search, a scanner, and a cold-email campaign with one lead that went all the way to a card), signed in as an owner
admin. Checks the Journey tab draws the funnel table (reached, % lost, a reason and a fix beside each step), the form detail, where visitors
come from, the per-campaign table, and one venue's journey in order inside its HQ row, at 375 and 1440 wide, with no sideways scroll, no script
error, and a search someone typed shown as text, never as markup.

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait). Shots: --shots DIR.     python3 tools/hq-journey-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import gatelib  # noqa: E402
import admin_site, hq_scenario  # noqa: E402
from hq_scenario import TUGUN  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]
if not gatelib.hold_lock_or_refuse('hq-journey-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    print('REFUSED: another live Chrome run holds /tmp/vp-heavy.lock')
    sys.exit(3)


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


NOW = datetime.datetime.utcnow()
def ago(mins):
    return (NOW - datetime.timedelta(minutes=mins)).strftime('%Y-%m-%dT%H:%M:%S.000Z')

S = admin_site.Site(fonts=bool(A.shots), extra_db=hq_scenario.extra_db(), live_tables=['vp_admin_audit'])
hq_scenario.seed(S)

# ---- a week of journeys ----
EV, N = [], [0]
def ev(sid, event, mins, src='website', props=None, link=None, venue=None, scanner=False, path='/quick'):
    N[0] += 1
    EV.append({'id': N[0], 'sid': sid, 'link_id': link, 'event': event, 'props': props or {}, 'src': src, 'path': path, 'ref_source': 'google',
               'region': 'QLD', 'device': 'mobile', 'scanner': scanner, 'venue_id': venue, 'at': ago(mins)})
def sidn(n):
    return ('%024x' % (0xabc000000000 + n))
STEPS = ['page_opened', 'button_tapped', 'form_started', 'form_sent', 'account_made', 'signed_in']
for n in range(1, 13):            # 12 sessions: how far each got
    reach = 6 if n <= 2 else 5 if n <= 4 else 4 if n <= 6 else 3 if n <= 9 else 2
    for i, st in enumerate(STEPS[:reach]):
        ev(sidn(n), st, 600 - n * 5 + i, src='cold_email' if n in (1, 2) else 'website')
    if n in (7, 8, 9):
        ev(sidn(n), 'form_abandon', 590 - n, props={'field': 'contact', 'ms': 9000})
    if n in (10, 11):
        for q in ('wobbly goat', 'wobbly goat'):
            ev(sidn(n), 'venue_search_none', 580 - n, props={'q': q})
        ev(sidn(n), 'venue_search_none', 579 - n, props={'q': '<b>x</b> inn'})
        ev(sidn(n), 'form_abandon', 570 - n, props={'field': 'venue', 'ms': 20000})
    if n <= 6:
        ev(sidn(n), 'contact_kind', 595 - n, props={'kind': 'mobile' if n % 2 else 'email'})
ev(sidn(1), 'venue_picked', 590)
ev(sidn(12), 'venue_not_found', 590)
ev(sidn(1), 'highlight_result', 300, props={'matched': True})
ev(sidn(2), 'highlight_result', 300, props={'matched': False})
# a scanner that opened an email link, and a lead that went all the way
LINKS = [
    {'id': 1, 'code_hash': 'a' * 64, 'lead_ref': 'L1', 'venue_name': 'Tugun Bowls Club', 'first_name': 'Sam', 'state': 'QLD', 'likely_games': ['trivia'],
     'campaign': 'offer-nov', 'email_step': 2, 'link_label': 'play-button', 'page': 'offer-nov', 'sent_at': ago(2000), 'expires_at': '2027-06-01T00:00:00.000Z', 'revoked_at': None, 'venue_id': TUGUN},
    {'id': 2, 'code_hash': 'b' * 64, 'lead_ref': 'L2', 'venue_name': 'Other Pub', 'first_name': 'Kim', 'state': 'NSW', 'likely_games': [],
     'campaign': 'offer-nov', 'email_step': 2, 'link_label': 'play-button', 'page': 'offer-nov', 'sent_at': ago(2000), 'expires_at': '2027-06-01T00:00:00.000Z', 'revoked_at': None, 'venue_id': None},
    {'id': 3, 'code_hash': 'c' * 64, 'lead_ref': 'L3', 'venue_name': 'Third Pub', 'first_name': '', 'state': 'VIC', 'likely_games': [],
     'campaign': 'offer-nov', 'email_step': 1, 'link_label': 'pricing', 'page': 'offer-nov', 'sent_at': ago(3000), 'expires_at': '2027-06-01T00:00:00.000Z', 'revoked_at': None, 'venue_id': None},
]
ev(sidn(30), 'scanner_hit', 1990, src='cold_email', link=2, scanner=True, props={'why': 'ua', 'hard': True}, path='/offer-nov/:code')
ev(sidn(31), 'link_hit', 1500, src='cold_email', link=1, venue=TUGUN, path='/offer-nov/:code')
ev(sidn(31), 'page_view', 1499, src='cold_email', link=1, venue=TUGUN, path='/nsw')
ev(sidn(31), 'form_sent', 1490, src='cold_email', link=1, venue=TUGUN)
ev(sidn(31), 'account_made', 1485, src='cold_email', link=1, venue=TUGUN)
ev(sidn(31), 'signed_in', 1480, src='cold_email', link=1, venue=TUGUN)
ev(sidn(31), 'card_added', 1470, src='cold_email', link=1, venue=TUGUN)
S.W.seed('vp_track_links', LINKS)
S.W.seed('vp_journey_events', EV)


def js(sid, e):
    return S.js(sid, e)


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'), full=True)


def go_journey(sid):
    js(sid, '(function(){var b=document.querySelector(\'#hqNav button[data-pane="journey"]\'); if(b) b.click(); return !!b;})()')
    S.until(sid, 'document.querySelectorAll("#jyFunnel tbody tr").length > 0 && document.querySelectorAll("#jyCamp tbody tr").length > 0', 25)
    time.sleep(0.5)


try:
    tid, sid = S.open('/app/hq.html?as=admin', 1440, 1000, False, 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message))});')
    S.until(sid, 'document.querySelectorAll("#venueRows tr").length > 0', 25)
    print('\nThe tab')
    ok('HQ has a Journey tab', js(sid, '!!document.querySelector(\'#hqNav button[data-pane="journey"]\')') is True)
    go_journey(sid)
    ok('opening it shows the Journey pane and hides Venues', js(sid, '!document.getElementById("paneJourney").classList.contains("hidden") && document.getElementById("paneVenues").classList.contains("hidden")') is True)

    print('\nThe funnel (1440)')
    rows = js(sid, '[].map.call(document.querySelectorAll("#jyFunnel tbody tr"), function(r){return [].map.call(r.children, function(c){return c.innerText.trim();});})') or []
    by = dict((r[0], r) for r in rows)
    ok('every funnel step is a row, in order, starting with Opened the page', rows and rows[0][0] == 'Opened the page' and len(rows) == 15, [r[0] for r in rows])
    ok('Opened the page: 12 reached (2 of them from a cold email link, 10 website)', by['Opened the page'][1] == '12' and by['Opened the page'][3] == '2' and by['Opened the page'][2] == '10', by.get('Opened the page'))
    ok('Tapped the button: 12; Started the form: 9; Sent the form: 6', by['Tapped "Play a quick game"'][1] == '12' and by['Started the form'][1] == '9' and by['Sent the form'][1] == '6',
       [(r[0], r[1]) for r in rows[:5]])
    ok('the percent lost is against the step before (Started the form 25%, Sent the form 33%)', by['Started the form'][5] == '25%' and by['Sent the form'][5] == '33%', [(r[0], r[5]) for r in rows[:5]])
    ok('a median time to the next step is shown where there is one', any(r[6] and r[6] != '\xa0' for r in rows[:5]), [r[6] for r in rows[:5]])
    ok('a likely reason and a fix sit beside every step that lost people', 'Fix:' in by['Sent the form'][7] and len(by['Sent the form'][7]) > 40, by['Sent the form'][7])
    ok('the reason names the missing venue when searches found nothing', 'missing from our list' in by['Sent the form'][7], by['Sent the form'][7])
    txt = js(sid, 'document.getElementById("jyFunnel").innerText')
    ok('the mail scanner is left out and counted apart', '1 mail-scanner hits were left out' in txt, txt[-200:])

    print('\nThe form detail and where visitors come from (1440)')
    ft = js(sid, 'document.getElementById("jyForm").innerText')
    ok('mobile vs email, picked vs cannot find, and the box people stop at are there', 'mobile 3, email 3' in ft and 'contact 3' in ft and 'venue 2' in ft, ft)
    ok('searches that found nothing are listed so missing venues get added', 'wobbly goat x4' in ft, ft)
    ok('what someone typed is shown as text, not markup', js(sid, '!document.querySelector("#jyForm b")') is True and '<b>x</b>' in ft.replace('\xa0', ' ') or 'x inn' in ft, ft)
    ok('the lead data hit rate is shown (1 of 2)', '1 of 2' in ft, ft)
    wt = js(sid, 'document.getElementById("jyWhere").innerText')
    ok('where from, state and device are counts, with no one named', 'Google' in wt and 'QLD' in wt and 'mobile' in wt.lower(), wt)

    print('\nThe campaigns (1440)')
    camp = js(sid, '[].map.call(document.querySelectorAll("#jyCamp tbody tr"), function(r){return [].map.call(r.children, function(c){return c.innerText.trim();});})') or []
    e2 = [r for r in camp if 'email 2' in r[0]]
    e1 = [r for r in camp if 'email 1' in r[0]]
    ok('email 2 of offer-nov: sent 2, clicked 1 (the scanner is not a click), signed up 1, signed in 1, card 1', e2 and e2[0][1:3] == ['2', '1'] and e2[0][5:8] == ['1', '1', '1'], camp)
    ok('the scanner-only lead is counted apart', e2 and e2[0][8] == '1', camp)
    ok('which link was clicked is named', e2 and 'play-button' in e2[0][9], camp)
    ok('email 1: sent 1, nothing clicked', e1 and e1[0][1] == '1' and e1[0][2] == '0', camp)
    shot(sid, 'journey-1440')
    ok('nothing scrolls sideways at 1440', js(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1') is True)

    print('\nOne venue\'s journey (1440)')
    js(sid, '(function(){var b=document.querySelector(\'#hqNav button[data-pane="venues"]\'); b.click(); return true;})()')
    time.sleep(0.5)
    js(sid, '(function(){var b=document.querySelector(\'[data-details="%s"]\'); if(b) b.click(); return !!b;})()' % TUGUN)
    S.until(sid, 'document.querySelector(\'[data-vpjourney="%s"] li\')' % TUGUN, 20)
    vj = js(sid, '[].map.call(document.querySelectorAll(\'[data-vpjourney="%s"] li\'), function(l){return l.innerText;})' % TUGUN) or []
    ok('Tugun\'s row shows Email 2 first, then the click on the play-button link, the page, the form, account, sign-in and card, in order',
       len(vj) == 7 and 'Email 2 of offer-nov sent' in vj[0] and 'play-button link in email 2 of offer-nov' in vj[1] and 'Looked at /nsw' in vj[2] and vj[-1].find('Added a card') >= 0, vj)
    shot(sid, 'journey-venue-1440')
    ok('no script error at 1440', js(sid, 'JSON.stringify(window.__errs||[])') == '[]', js(sid, 'JSON.stringify(window.__errs||[])'))
    S.close_tab(tid)

    print('\nOn a phone (375)')
    tid, sid = S.open('/app/hq.html?as=admin', 375, 812, True, 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message))});')
    S.until(sid, 'document.querySelectorAll("#venueRows tr").length > 0', 25)
    go_journey(sid)
    ok('the funnel is the same numbers on a phone', js(sid, 'document.querySelectorAll("#jyFunnel tbody tr").length') == 15)
    ok('the page does not scroll sideways at 375 (the tables scroll inside their boxes)', js(sid, 'document.documentElement.scrollWidth <= window.innerWidth + 1') is True,
       js(sid, '[document.documentElement.scrollWidth, window.innerWidth]'))
    ok('the reason text is readable: wide enough and wrapping', js(sid, '(function(){var c=document.querySelector("#jyFunnel tbody tr:nth-child(4) td:last-child"); return c.getBoundingClientRect().width >= 200 && getComputedStyle(c).whiteSpace !== "nowrap";})()') is True)
    ok('the controls sit on the screen: the period picker and Refresh', js(sid, '(function(){var a=document.getElementById("jyDays").getBoundingClientRect(), b=document.getElementById("jyRefresh").getBoundingClientRect(); return a.right <= window.innerWidth && b.right <= window.innerWidth && a.left >= 0;})()') is True)
    shot(sid, 'journey-375')
    ok('no script error at 375', js(sid, 'JSON.stringify(window.__errs||[])') == '[]', js(sid, 'JSON.stringify(window.__errs||[])'))
    S.close_tab(tid)

    print('\nA role that may not see it, and a database without migration 196')
    S.W.missing('vp_journey_events', True)
    tid, sid = S.open('/app/hq.html?as=admin', 1100, 900, False)
    S.until(sid, 'document.querySelectorAll("#venueRows tr").length > 0', 25)
    js(sid, '(function(){document.querySelector(\'#hqNav button[data-pane="journey"]\').click(); return true;})()')
    S.until(sid, '/migration 196/.test(document.getElementById("jyFunnel").innerText)', 20)
    ok('without migration 196 the tab says so in words instead of an empty table', 'migration 196' in js(sid, 'document.getElementById("jyFunnel").innerText'), js(sid, 'document.getElementById("jyFunnel").innerText'))
    S.close_tab(tid)
    S.W.missing('vp_journey_events', False)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 28
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print('ALL %d CHECKS PASSED' % total) if not FAIL[0] else None
sys.exit(1 if FAIL[0] else 0)
