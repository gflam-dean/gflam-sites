#!/usr/bin/env python3
"""THE FREE-MONTH CANCEL PAGE, IN A REAL BROWSER (Dean, 11 Nov 2026, INBOX 191).

The page a prospect's "Cancel, it's not for us" link opens (venueplay/prospect/cancel/), served by
tools/browser-rig/admin_site.py with the REAL billing Worker behind it in jsc. Test Bravo, seeded into
the rig's fake database only; nothing is sent anywhere.

  1. Inside its free month: the page says Dean's words, word for word, with the end date in his plain
     style ("20 November"), and no 90-day line (that is for paid venues).
  2. The button cancels and the page says it stays on until 20 November, with "Keep my free month going";
     that button carries the same month on.
  3. Never signed in: Dean's words with no date ("We'll switch it off and stop the reminders.").
Read as a venue reads it (innerText), at desktop and phone width; no script errors.
  4. (INBOX 235, a live fault: Bodalla Pub's cancel reached nobody) every cancel and every "Keep my free month going"
     through the page tells us: the Worker hands the fake Resend one "CANCELLED VENUE: <name> (free month)" or
     "CANCEL UNDONE: <name> (free month)" email for EACH address on VPA_CANCEL_ALERTS and writes a venue_cancel_alert
     audit row. Recipients are compared with the Worker's own list, never printed.

The end dates are FIXED (2099), never worked out from today's clock.

    python3 tools/trial-cancel-page-in-chrome.test.py          screenshots go to $VP_SHOTS if set
"""
import hashlib, hmac, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

SECRET = 'trial-cancel-rig-secret'
BRAVO = '33333333-3333-4333-8333-333333333333'
FRESH = '33333333-3333-4333-8333-333333333334'
DEAN = ('No problem at all, and thanks for having a look. There’s no card on your account, so nothing has been '
        'charged and nothing will be. You can keep using venueplay until 20 November, then we’ll switch it off and '
        'stop the reminders.')
DEAN_NOW = ('No problem at all, and thanks for having a look. There’s no card on your account, so nothing has been '
            'charged and nothing will be. We’ll switch it off and stop the reminders.')


def token(fid):
    """The Worker's cancel token: HMAC-SHA256 of 'vp-prospect-cancel:<id>' with the card-link secret, first 32 hex."""
    return hmac.new(SECRET.encode(), ('vp-prospect-cancel:' + fid).encode(), hashlib.sha256).hexdigest()[:32]


def seed(S):
    S.W.env(CARD_LINK_SECRET=SECRET)
    S.W.seed('venueplay_founding', [
        {'id': 'fb', 'venue_name': 'Test Bravo', 'contact_email': 'bravo@test.local', 'plan': 'monthly', 'status': 'pending', 'max_seats': 10},
        {'id': 'fc', 'venue_name': 'Test Bravo Two', 'contact_email': 'bravo2@test.local', 'plan': 'monthly', 'status': 'pending', 'max_seats': 10}])
    S.W.seed('vp_venues', [
        {'id': BRAVO, 'name': 'Test Bravo', 'slug': 'test-bravo', 'founding_id': 'fb', 'status': 'active', 'suspended_reason': None,
         'max_players': 10, 'au_state': 'QLD', 'postcode': '4000', 'created_at': '2099-10-01T00:00:00Z'},
        {'id': FRESH, 'name': 'Test Bravo Two', 'slug': 'test-bravo-two', 'founding_id': 'fc', 'status': 'active', 'suspended_reason': None,
         'max_players': 10, 'au_state': 'QLD', 'postcode': '4000', 'created_at': '2099-10-01T00:00:00Z'}])
    S.W.seed('vp_prospects', [
        # Its free month: first sign-in 21 Oct 2099, last day Fri 20 Nov 2099 (11:59:59pm Brisbane).
        {'venue_id': BRAVO, 'founding_id': 'fb', 'first_signin_at': '2099-10-21T00:00:00.000Z', 'free_month_ends_at': '2099-11-20T13:59:59.000Z',
         'paused_at': None, 'cancelled_at': None, 'offer_rate': 2.5, 'reminders_sent': [], 'card_choice': None},
        # Nobody has signed in yet.
        {'venue_id': FRESH, 'founding_id': 'fc', 'first_signin_at': None, 'free_month_ends_at': None,
         'paused_at': None, 'cancelled_at': None, 'offer_rate': None, 'reminders_sent': [], 'card_choice': None}])


READ = ('JSON.stringify({head:document.getElementById("head").textContent, lede:document.getElementById("lede").textContent,'
        'all:document.querySelector("main").innerText, ask:document.getElementById("ask").className,'
        'go:(function(b){return b&&b.offsetParent!==null?b.textContent:""})(document.getElementById("go")),'
        'resume:(function(b){return b&&b.offsetParent!==null?b.textContent:""})(document.getElementById("resume")),'
        'errs:(window.__errs||[]).length, wide:document.documentElement.scrollWidth>window.innerWidth})')


def alert_list():
    """VPA_CANCEL_ALERTS as the Worker has it, read off the source (compared, never printed)."""
    src = open(os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js'), encoding='utf-8').read()
    return sorted(re.findall(r"'([^']+)'", re.search(r'const VPA_CANCEL_ALERTS = \[([^\]]*)\];', src).group(1)))


def alerts_since(S, n0, kind, name):
    """The fake Resend's emails after the first n0 whose subject is '<kind>: <name> (free month)'; -> (count, to both?)."""
    ms = [m for m in (S.W.sent() or [])[n0:] if str(m.get('subject', '')).endswith(kind + ': ' + name + ' (free month)')]
    to = sorted((m.get('to') or [''])[0] for m in ms)
    return len(ms), to == alert_list()


def audit_alerts(S, vid):
    return [a for a in S.W.table('vp_admin_audit') if a.get('action') == 'venue_cancel_alert' and a.get('target') == 'venue:' + vid]


def page(fid):
    return '/prospect/cancel/index.html?f=%s&t=%s' % (fid, token(fid))


def main():
    S = admin_site.Site()
    try:
        seed(S)
        # 1. Inside the free month: Dean's words with the date, at both widths. Opening it never cancels.
        for (w, h, mob) in ((1100, 900, False), (390, 844, True)):
            where = '%d wide' % w
            tid, sid = S.open(page('fb'), w, h, mob)
            up = S.until(sid, 'document.getElementById("head").textContent.indexOf("Test Bravo")!==-1', 20)
            d = S.json(sid, READ, {})
            ok('%s: CONTROL: the Worker answered (the venue\'s own name in the heading)' % where, up is True and d.get('head') == 'Cancel venueplay for Test Bravo?', d.get('head'))
            ok('%s: Dean\'s words, word for word, with the end date "20 November"' % where, d.get('lede') == DEAN, d.get('lede'))
            ok('%s: no 90-day line on a free month (paid venues only)' % where, '90 days' not in d.get('all', ''), re.findall(r'.{0,40}90 days.{0,40}', d.get('all', '')))
            ok('%s: no em dash, lowercase venueplay' % where, not re.search('[—–]', d.get('all', '')) and 'VenuePlay' not in d.get('all', ''))
            ok('%s: the button is there and nothing else offers to carry on yet' % where, d.get('go') == 'Yes, cancel it' and d.get('resume') == '', [d.get('go'), d.get('resume')])
            ok('%s: fits the screen, no script errors' % where, not d.get('wide') and d.get('errs') == 0, [d.get('wide'), S.js(sid, 'JSON.stringify(window.__errs||[])')])
            if SHOTS: S.shot(sid, os.path.join(SHOTS, 'trial-cancel-ask-%d.png' % w), True)
            S.close_tab(tid)
        pr = [p for p in S.W.table('vp_prospects') if p['venue_id'] == BRAVO][0]
        ok('opening the page twice cancelled nothing', not pr.get('cancelled_at'), pr.get('cancelled_at'))

        # 2. The button: cancelled, still on until 20 November, and "Keep my free month going" carries it on.
        tid, sid = S.open(page('fb'), 390, 844, True)
        S.until(sid, 'document.getElementById("head").textContent.indexOf("Test Bravo")!==-1', 20)
        n0 = len(S.W.sent() or [])
        ok('CONTROL: VPA_CANCEL_ALERTS names two addresses and opening the page sent us nothing', len(alert_list()) == 2 and not audit_alerts(S, BRAVO), len(alert_list()))
        S.js(sid, 'document.getElementById("go").click()')
        done = S.until(sid, 'document.getElementById("head").textContent==="All done"', 20)
        d = S.json(sid, READ, {})
        ok('the button: "All done", it stays on until 20 November, no more reminders', done is True and
           d.get('lede') == 'venueplay for Test Bravo is cancelled and nothing was ever charged. You can keep using it until 20 November, then we’ll switch it off. You won’t get any more reminders.', d.get('lede'))
        ok('"Keep my free month going" is offered, and the cancel question has gone', d.get('resume') == 'Keep my free month going' and d.get('ask') == 'hidden', [d.get('resume'), d.get('ask')])
        pr = [p for p in S.W.table('vp_prospects') if p['venue_id'] == BRAVO][0]
        vb = [v for v in S.W.table('vp_venues') if v['id'] == BRAVO][0]
        ok('the Worker recorded the cancel and kept the venue ON', bool(pr.get('cancelled_at')) and vb.get('status') == 'active', [pr.get('cancelled_at'), vb.get('status')])
        c, both = alerts_since(S, n0, 'CANCELLED VENUE', 'Test Bravo')
        ok('INBOX 235: the cancel told us: "CANCELLED VENUE: Test Bravo (free month)" to both addresses, nothing to anyone else', c == 2 and both and len((S.W.sent() or [])[n0:]) == 2, [c, both])
        aa = audit_alerts(S, BRAVO)
        ok('INBOX 235: and a venue_cancel_alert audit row, sent', len(aa) == 1 and (aa[0].get('detail') or {}).get('outcome') == 'sent', [len(aa)])
        if SHOTS: S.shot(sid, os.path.join(SHOTS, 'trial-cancel-done-390.png'), True)
        n1 = len(S.W.sent() or [])
        S.js(sid, 'document.getElementById("resume").click()')
        back = S.until(sid, 'document.getElementById("head").textContent==="Welcome back"', 20)
        d = S.json(sid, READ, {})
        ok('"Keep my free month going": the same month carries on until 20 November', back is True and
           d.get('lede') == 'Your free month at Test Bravo carries on until 20 November. We’ll remind you before it ends.' and d.get('resume') == '', d.get('lede'))
        pr = [p for p in S.W.table('vp_prospects') if p['venue_id'] == BRAVO][0]
        ok('the cancel is undone in the Worker, the end date unchanged', not pr.get('cancelled_at') and pr.get('free_month_ends_at') == '2099-11-20T13:59:59.000Z', pr)
        c, both = alerts_since(S, n1, 'CANCEL UNDONE', 'Test Bravo')
        ok('INBOX 235: "Keep my free month going" told us too: "CANCEL UNDONE: Test Bravo (free month)" to both', c == 2 and both and len(audit_alerts(S, BRAVO)) == 2, [c, both])
        ok('no script errors', S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)

        # 3. Never signed in: no month to keep, so no date.
        tid, sid = S.open(page('fc'), 1100, 900, False)
        S.until(sid, 'document.getElementById("head").textContent.indexOf("Test Bravo Two")!==-1', 20)
        d = S.json(sid, READ, {})
        ok('never signed in: Dean\'s words with no date', d.get('lede') == DEAN_NOW, d.get('lede'))
        ok('never signed in: no 90-day line either', '90 days' not in d.get('all', ''))
        # 4. The Bodalla case through the page: never signed in, the button, and we hear about it.
        n2 = len(S.W.sent() or [])
        S.js(sid, 'document.getElementById("go").click()')
        S.until(sid, 'document.getElementById("head").textContent==="All done"', 20)
        c, both = alerts_since(S, n2, 'CANCELLED VENUE', 'Test Bravo Two')
        vf = [v for v in S.W.table('vp_venues') if v['id'] == FRESH][0]
        ok('INBOX 235, the Bodalla case: never signed in, cancelled on the page, switched off, and both addresses told', c == 2 and both and vf.get('status') == 'suspended'
           and len(audit_alerts(S, FRESH)) == 1, [c, both, vf.get('status')])
        S.close_tab(tid)
    finally:
        S.close()


try:
    main()
except Exception:
    import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
