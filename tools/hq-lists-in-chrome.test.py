#!/usr/bin/env python3
"""HQ'S VENUE LIST AND ITS TWO CHASE LISTS, IN THE REAL PAGE, AGAINST THE REAL BILLING WORKER.

Dean, 19 Oct 2026:
  1. Count badges on the Quiet and Cancelled tabs, like the Help desk tab: the venues that newly
     appeared on that list and nobody has contacted yet. "Mark contacted" on each row records who
     and when (shown on the row, and in the audit log), and the badge counts the ones not marked.
     The marks are vp_admin_audit rows written by the Worker's /admin/audit, so every HQ admin sees
     the same count. A mark from an EARLIER spell (rung in September, played again, quiet again; or
     an earlier cancellation) does not count for the new one.
  2. The Venues list hides venues that have LEFT (ended, cancelled, archived) unless "Show
     cancelled" is ticked, but the search box still finds them. Unpaid venues stay: they need chasing.

This opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py). The real billing
Worker answers /admin/quiet-venues from its sessions and /admin/audit writes the contact rows, and
the page reads vp_admin_audit back from that same database, so a click is seen the way it is live.

    python3 tools/hq-lists-in-chrome.test.py [--shots DIR]
"""
import argparse, datetime, os, sys, time

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
        print('  ok   %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))


NOW = datetime.datetime.now(datetime.timezone.utc)
def ago(days):
    return (NOW - datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def vid(n):
    return '30000000-0000-4000-8000-%012d' % n


V = {   # name: (n, status, suspended_reason, last night (days ago) or None, cancelling)
    'Active Arms':        (1, 'active', None, 1, False),
    'Quiet Rung Hotel':   (2, 'active', None, 20, False),
    'Quiet Again Tavern': (3, 'active', None, 12, False),
    'Quiet New Inn':      (4, 'active', None, 9, False),
    'Unpaid Club':        (5, 'suspended', 'nonpayment', 3, False),
    'Ended Bowls':        (6, 'suspended', 'ended', 100, False),
    'Archived Hotel':     (7, 'suspended', 'archived', 200, False),
    'Leaving Lounge':     (8, 'active', None, 1, True),
    'Twice Gone Pub':     (9, 'active', None, 1, True),
}
venues, sessions, flags = [], [], []
for name, (n, st, why, last, canc) in V.items():
    venues.append({'id': vid(n), 'name': name, 'slug': name.lower().replace(' ', '-'), 'status': st,
                   'suspended_reason': why, 'created_at': ago(400), 'timezone': 'Australia/Sydney',
                   'founding_id': None, 'group_id': None, 'max_players': 60, 'au_state': 'NSW', 'postcode': '2000'})
    flags.append({'id': vid(n), 'cancel_at_period_end': canc})
    if last is not None:
        sessions.append({'venue_id': vid(n), 'opened_at': ago(last), 'started_at': ago(last), 'ended_at': ago(last)})


def audit(action, n, days, who='Sam'):
    return {'id': 'a-%s-%d-%d' % (action, n, days), 'action': action, 'target': 'venue:' + vid(n), 'created_at': ago(days),
            'actor_label': who, 'detail': {}}


AUDIT = [
    audit('venue_quiet_contacted', 2, 10),          # rung during this quiet spell: done
    audit('venue_quiet_contacted', 3, 30),          # rung BEFORE they played again: this spell is new
    audit('venue_archived', 7, 150),
    audit('venue_cancel_scheduled', 8, 5),
    audit('venue_cancel_contacted', 8, 2),          # rung about this cancellation: done
    audit('venue_cancel_scheduled', 9, 3),
    audit('venue_cancel_contacted', 9, 40),         # rung about an EARLIER cancellation: not this one
    audit('venue_cancel_undone', 9, 35),
    audit('venue_cancel_scheduled', 9, 45),
]
# venues the stand-in supabase-js answers; the cancelling flags ride in on the same table, as live
fake_venues = [dict(v, **{'cancel_at_period_end': f['cancel_at_period_end']}) for v, f in zip(venues, flags)]

S = admin_site.Site(fonts=bool(A.shots), extra_db={'vp_venues': fake_venues}, live_tables=['vp_admin_audit'])
UID = S.W.info['uid']
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_venues', venues)
S.W.seed('vp_sessions', sessions)
S.W.seed('vp_game_reports', [])
S.W.seed('vp_admin_audit', AUDIT)


def names(sid):
    return S.js(sid, '[].map.call(document.querySelectorAll("#venueRows .vn"), function(e){return e.textContent;})') or []


BADGE_JS = ('(function(){var s=document.querySelector(\'#hqNav button[data-pane="%s"] .tabcount\');'
            'return s ? (s.hidden ? "hidden" : s.textContent) : "none";})()')
def badge(sid, pane):
    return S.js(sid, BADGE_JS % pane)


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'))


try:
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1000)
    S.until(sid, 'document.querySelectorAll("#venueRows .vn").length > 0', 20)
    time.sleep(1.5)

    print('\nthe Venues list: venues that have left are hidden, unpaid ones are not, search finds anyone')
    shown = names(sid)
    ok('active, quiet, cancelling-but-still-playing and UNPAID venues are listed',
       all(n in shown for n in ['Active Arms', 'Quiet Rung Hotel', 'Unpaid Club', 'Leaving Lounge']), shown)
    ok('ended and archived venues are not', 'Ended Bowls' not in shown and 'Archived Hotel' not in shown, shown)
    ok('the tick says how many it is hiding', S.js(sid, 'document.getElementById("leftHiddenN").textContent') == '(2 hidden)',
       S.js(sid, 'document.getElementById("leftHiddenN").textContent'))
    shot(sid, 'hq-venues-default')
    S.js(sid, 'var i=document.getElementById("venueSearch"); i.value="ended"; i.dispatchEvent(new Event("input")); true')
    time.sleep(0.3)
    ok('searching "ended" finds Ended Bowls while it is hidden', names(sid) == ['Ended Bowls'], names(sid))
    S.js(sid, 'var i=document.getElementById("venueSearch"); i.value="archived hot"; i.dispatchEvent(new Event("input")); true')
    time.sleep(0.3)
    ok('and an archived venue too', names(sid) == ['Archived Hotel'], names(sid))
    shot(sid, 'hq-venues-search-finds-hidden')
    S.js(sid, 'var i=document.getElementById("venueSearch"); i.value=""; i.dispatchEvent(new Event("input")); true')
    S.js(sid, 'var c=document.getElementById("showLeft"); c.checked=true; c.dispatchEvent(new Event("change")); true')
    time.sleep(0.3)
    shown = names(sid)
    ok('"Show cancelled" brings them back', 'Ended Bowls' in shown and 'Archived Hotel' in shown and len(shown) == 9, shown)
    shot(sid, 'hq-venues-show-cancelled')
    S.js(sid, 'var c=document.getElementById("showLeft"); c.checked=false; c.dispatchEvent(new Event("change")); true')

    print('\nthe tab badges, on page load, before either tab is opened')
    S.until(sid, '(function(){var a=document.querySelector(\'#hqNav button[data-pane="quiet"] .tabcount\'),'
                 'b=document.querySelector(\'#hqNav button[data-pane="cancelled"] .tabcount\'); return a && b;})()', 15)
    ok('Quiet: 2 (a new quiet venue, and one rung about an EARLIER spell); the one rung this spell and the ended one do not count',
       badge(sid, 'quiet') == '2', badge(sid, 'quiet'))
    # 21 Oct 2026: a venue whose subscription ENDED (Ended Bowls) has left too, and was missing from the
    # Cancelled screen for the 30 days before it is archived. It counts now: nobody has rung it.
    ok('Cancelled: 3 (the archived one and the ended one nobody rang, and one rung about an EARLIER cancellation)',
       badge(sid, 'cancelled') == '3', badge(sid, 'cancelled'))
    ok('in the help desk tab\'s red badge style', 'rgb(229, 72, 77)' in (S.js(sid, 'getComputedStyle(document.querySelector(\'#hqNav button[data-pane="quiet"] .tabcount\')).backgroundColor') or ''),
       S.js(sid, 'getComputedStyle(document.querySelector(\'#hqNav button[data-pane="quiet"] .tabcount\')).backgroundColor'))
    shot(sid, 'hq-tab-badges')

    print('\nMark contacted on the Quiet tab, through the real Worker')
    S.js(sid, 'document.querySelector(\'#hqNav button[data-pane="quiet"]\').click(); true')
    S.until(sid, '!!document.querySelector(\'#quietRows button[data-qcontact="%s"]\')' % vid(4), 15)
    rows = S.js(sid, '[].map.call(document.querySelectorAll("#quietRows tr b"), function(e){return e.textContent;})') or []
    ok('the quiet list holds the three quiet customers and not the ended venue', sorted(rows) == ['Quiet Again Tavern', 'Quiet New Inn', 'Quiet Rung Hotel'], rows)
    ok('the one rung this spell shows who and when', 'by sam' in (S.js(sid, 'document.getElementById("quietRows").innerText') or '').lower())
    S.js(sid, 'document.querySelector(\'#quietRows button[data-qcontact="%s"]\').click(); true' % vid(4))
    S.until(sid, '!document.querySelector(\'#quietRows button[data-qcontact="%s"]\')' % vid(4), 15)
    # The button goes at once; the row and the badge are redrawn when the Worker has answered. Wait
    # for that, not half a second: on a busy machine (20 Oct 2026) half a second was not enough.
    S.until(sid, '/by dean/i.test(document.getElementById("quietRows").innerText) && ' + BADGE_JS % 'quiet' + '==="1"', 30)
    mark = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'venue_quiet_contacted' and a.get('target') == 'venue:' + vid(4)]
    ok('the mark is an audit row, by Dean, for that venue', len(mark) == 1 and mark[0].get('actor_label') == 'Dean', mark)
    ok('the row now says Contacted by Dean', 'by dean' in (S.js(sid, 'document.getElementById("quietRows").innerText') or '').lower())
    ok('and the Quiet badge drops to 1', badge(sid, 'quiet') == '1', badge(sid, 'quiet'))
    shot(sid, 'hq-quiet-after-mark')

    print('\nMark contacted on the Cancelled tab')
    """WHILE THE HISTORY IS STILL LOADING (20 Oct 2026). Marking a venue contacted on the Quiet tab throws
    the cancellation history away, so opening this tab reloads it. Changing the filter before the reload
    landed drew the list from NO history: every venue that had left showed "Mark contacted", the one
    already rung included, and the badge counted it. Found because this suite, under load, read the
    list in that gap. Tab, filter and read happen in ONE evaluation here, so the reload cannot land in
    between, whatever the machine is doing: the gap is reproduced every run, not by luck."""
    in_gap = S.js(sid, '(function(){document.querySelector(\'#hqNav button[data-pane="cancelled"]\').click();'
                       'var f=document.getElementById("cxFilter"); f.value="all"; f.dispatchEvent(new Event("change"));'
                       'return {offered:!!document.querySelector(\'button[data-cxcontact="%s"]\'), badge:%s};})()' % (vid(8), BADGE_JS % 'cancelled'))
    ok('while the history is still loading, a venue already rung is not offered Mark contacted and the badge does not count it',
       isinstance(in_gap, dict) and in_gap.get('offered') is False and in_gap.get('badge') == '3', in_gap)
    S.until(sid, '!!document.querySelector(\'button[data-cxcontact="%s"]\')' % vid(9), 15)
    ok('the venue rung about an earlier cancellation is offered Mark contacted again',
       S.js(sid, '!!document.querySelector(\'button[data-cxcontact="%s"]\')' % vid(9)) is True)
    ok('the one rung about this cancellation is not', S.js(sid, '!document.querySelector(\'button[data-cxcontact="%s"]\')' % vid(8)) is True)
    S.js(sid, 'document.querySelector(\'button[data-cxcontact="%s"]\').click(); true' % vid(9))
    S.until(sid, '!document.querySelector(\'button[data-cxcontact="%s"]\')' % vid(9), 15)
    S.until(sid, BADGE_JS % 'cancelled' + '==="2"', 30)
    mark = [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'venue_cancel_contacted' and a.get('target') == 'venue:' + vid(9)]
    ok('written to the audit log by Dean', len(mark) == 2 and any(m.get('actor_label') == 'Dean' for m in mark), mark)
    ok('and the Cancelled badge drops to 2', badge(sid, 'cancelled') == '2', badge(sid, 'cancelled'))
    shot(sid, 'hq-cancelled-after-mark')
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the page', errs == '[]', errs)
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 20
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
