#!/usr/bin/env python3
"""THE ACCOUNT PAGE CLICK-THROUGH DEMO, ON THIS MAC ONLY (Dean, 5 Nov 2026, INBOX items 36, 37, 39 and 40).

    python3 tools/browser-rig/account_demo.py            then open http://localhost:8701/app/billing.html

Serves this checkout's venueplay/ folder on localhost with the REAL billing Worker behind it (in jsc, through
tools/browser-rig/admin_site.py), one port per TEST account, so each state has its own sign-in and its own browser
storage. Nothing here talks to the live site, the live Worker, Stripe, Supabase or any customer: the database is a
fake held in memory, every venue and person in it is made up, and it all goes when you stop it (Ctrl+C).

    8701  Test Alpha     active, one venue (the normal view)
    8702  Test Bravo     paused prospect (free month ended, no card)
    8703  Test Charlie   cancelled, and past the end date
    8704  Test Delta     closed by us
    8705  Test Echo      cancelled, still inside the paid period (still active)
    8706  Test Foxtrot   active, two venues (the venue drop-down, "All venues")
    8710  HQ             signed in as an HQ admin; View as opens any of the test accounts above

Also used by the headless audit (reports/account-review-8nov): build(key, browser=True) gives a Site with its own
headless Chrome, port 0.
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import admin_site  # noqa: E402

UID = '11111111-1111-4111-8111-111111111111'          # the rig's one signed-in login (tools/browser-rig/billing-stdio.js)
V1 = '22222222-2222-4222-8222-222222222222'
V2 = '22222222-2222-4222-8222-222222222223'
HOSTS = [('33333333-3333-4333-8333-000000000001', 'Sam Taylor', '61400111222'),
         ('33333333-3333-4333-8333-000000000002', 'Jess Nguyen', '61400333444')]

# key: (port, venue name, slug, join code, state, founding id)
ACCOUNTS = [
    ('alpha',   8701, 'Test Alpha',   'test-alpha',   'TALPHA', 'active'),
    ('bravo',   8702, 'Test Bravo',   'test-bravo',   'TBRAVO', 'paused_prospect'),
    ('charlie', 8703, 'Test Charlie', 'test-charlie', 'TCHARL', 'cancelled'),
    ('delta',   8704, 'Test Delta',   'test-delta',   'TDELTA', 'closed'),
    ('echo',    8705, 'Test Echo',    'test-echo',    'TECHO1', 'ending'),
    ('foxtrot', 8706, 'Test Foxtrot', 'test-foxtrot', 'TFOXTR', 'active2'),
]
HQ_PORT = 8710
LABEL = {'active': 'active, one venue', 'paused_prospect': 'paused prospect (free month ended, no card)',
         'cancelled': 'cancelled, past the end date', 'closed': 'closed by us',
         'ending': 'cancelled, still inside the paid period (still active)', 'active2': 'active, two venues'}


def _venue(vid, name, slug, code, state, fid, n):
    v = {'id': vid, 'name': name, 'slug': slug, 'founding_id': fid, 'status': 'active', 'suspended_reason': None,
         'max_players': 40, 'pending_players': None, 'au_state': 'QLD', 'postcode': '4000', 'join_code': code,
         'created_at': '2026-09-0%dT00:00:00Z' % n, 'timezone': 'Australia/Brisbane', 'cancel_at_period_end': False,
         'closed_at': None, 'show_logo_on_site': False, 'included_players': None, 'entity_type': None,
         'paid_entry_enabled': False, 'weekly_limit_off': False}
    if state == 'paused_prospect':
        v.update(status='suspended', suspended_reason='free_month_ended', closed_at='2026-11-03T14:00:00Z')
    elif state == 'cancelled':
        v.update(status='suspended', suspended_reason='cancelled', closed_at='2026-11-01T14:00:00Z')
    elif state == 'closed':
        v.update(status='suspended', suspended_reason='archived', closed_at='2026-10-20T14:00:00Z')
    elif state == 'ending':
        v.update(cancel_at_period_end=True)
    return v


def account_rows(key):
    """Every row one test account needs, for the Worker's database and the page's stand-in supabase-js."""
    k, port, name, slug, code, state = [a for a in ACCOUNTS if a[0] == key][0]
    fid = 'f-' + key
    venues = [_venue(V1, name, slug, code, state, fid, 1)]
    if state == 'active2':
        venues.append(_venue(V2, name + ' Bowls Club', slug + '-bowls', code[:5] + '2', 'active', fid, 2))
    founding = {'id': fid, 'contact_email': 'owner@%s.test' % key, 'contact_name': 'Olive Owner', 'venue_name': name,
                'plan': 'monthly', 'status': 'card_on_file', 'max_seats': 40, 'stripe_customer_id': 'cus_' + key,
                'stripe_subscription_id': 'sub_' + key, 'created_at': '2026-09-01T00:00:00Z', 'optin_release_approved': True,
                'payment_reminders': True}
    if state == 'paused_prospect':
        founding.update(status='prospect', stripe_customer_id=None, stripe_subscription_id=None)
    staff = [{'id': 'own-%d' % i, 'auth_user_id': UID, 'venue_id': v['id'], 'role': 'owner', 'permissions': None,
              'display_name': 'Olive Owner'} for i, v in enumerate(venues)]
    for i, (hid, hname, _) in enumerate(HOSTS):
        staff.append({'id': 'h-%d' % i, 'auth_user_id': hid, 'venue_id': V1, 'role': 'host', 'permissions': None, 'display_name': hname})
    draws = [{'id': 'md-' + key, 'venue_id': V1, 'name': 'Friday Members Draw', 'current_jackpot_cents': 45000,
              'starting_amount_cents': 25000, 'increment_cents': 5000, 'last_drawn_at': '2026-10-30T09:30:00Z',
              'draw_day': 'Friday', 'draw_time': '7:30pm', 'date_started': '2026-09-04', 'time_to_claim_seconds': 120,
              'created_at': '2026-09-01T00:00:00Z', 'archived_at': None}]
    rosters = [{'id': 'r-' + key, 'venue_id': V1}]
    members = [{'id': 'm%d-%s' % (n, key), 'roster_id': 'r-' + key, 'number': str(100 + n),
                'first_name': f, 'last_name': l} for n, (f, l) in enumerate(
                    [('Ava', 'Brown'), ('Liam', 'Smith'), ('Mia', 'Jones'), ('Noah', 'Wilson'), ('Zoe', 'Taylor')])]
    results = [{'id': 'res1-' + key, 'draw_id': 'md-' + key, 'outcome': 'jackpot_rolled', 'amount_cents': 40000,
                'member_number': '103', 'winner_name': 'Noah W', 'drawn_at': '2026-10-30T09:31:00Z'},
               {'id': 'res2-' + key, 'draw_id': 'md-' + key, 'outcome': 'claimed', 'amount_cents': 35000,
                'member_number': '101', 'winner_name': 'Liam S', 'drawn_at': '2026-10-23T09:32:00Z'}]
    sessions = [{'id': 's%d-%s' % (n, key), 'venue_id': V1, 'status': 'ended', 'join_code': code,
                 'opened_at': d + 'T09:00:00Z', 'started_at': d + 'T09:05:00Z', 'ended_at': d + 'T11:30:00Z',
                 'created_at': d + 'T09:00:00Z'} for n, d in enumerate(['2026-10-29', '2026-10-22', '2026-10-15'])]
    games = [{'id': 'g%d-%s' % (n, key), 'session_id': s['id'], 'venue_id': V1, 'format': f, 'started_at': s['started_at'],
              'created_at': s['started_at']} for n, (s, f) in enumerate(zip(sessions, ['trivia', 'musical', 'trivia']))]
    players = []
    for s in sessions:
        for n in range(14):
            players.append({'id': 'p%d-%s' % (n, s['id']), 'session_id': s['id'], 'device_id': 'dev%d' % (n % 10),
                            'display_name': 'Player %d' % n, 'joined_at': s['started_at']})
    prospects = [{'venue_id': V1, 'founding_id': fid, 'email': founding['contact_email'], 'contact_name': 'Olive',
                  'first_signin_at': '2026-10-03T00:00:00Z', 'free_month_ends_at': '2026-11-03T13:59:59Z',
                  'paused_at': '2026-11-03T14:00:00Z', 'cancelled_at': None, 'offer_rate': 2.5, 'reminders_sent': [3, 23, 29],
                  'card_choice': None}] if state == 'paused_prospect' else []
    worker = {'venueplay_founding': [founding], 'vp_venues': venues, 'vp_venue_staff': staff,
              'vp_member_draws': draws, 'vp_member_draw_results': results, 'vp_sessions': sessions, 'vp_games': games,
              'vp_players': players, 'vp_prospects': prospects,
              'auth': [{'id': hid, 'phone': ph} for hid, _, ph in HOSTS] + [{'id': UID, 'phone': '61400999888'}]}
    page = {'vp_venues': venues, 'vp_venue_staff': [s for s in staff if s['auth_user_id'] == UID],
            'vp_venue_settings': [{'venue_id': v['id'], 'name_display': 'abbrev_last', 'collect_first_name': True,
                                   'collect_last_name': True, 'collect_postcode': False, 'collect_email': True,
                                   'collect_mobile': False, 'collect_marketing_optin': True} for v in venues],
            'venueplay_founding': [founding], 'vp_member_draws': draws, 'vp_member_rosters': rosters, 'vp_members': members,
            'vp_raffle_prizes': [{'id': 'rp-' + key, 'venue_id': V1, 'label': 'Meat tray', 'created_at': '2026-09-01T00:00:00Z'}]}
    return worker, page


HOST_EMAIL_PAGE = """<!DOCTYPE html><html lang="en-AU"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>venueplay demo: the host email card</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@700;800&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#0A0A0B;color:#E7E7EC;font-family:Manrope,system-ui,sans-serif}p{max-width:520px;margin:40px auto;padding:0 16px;line-height:1.55;color:#A6A6B0}</style>
</head><body><p>DEMO ONLY. This is the card a host sees at the bottom of their console after signing in (item 21a). In this demo the
Save and Not now buttons go to the local test Worker; nothing is sent and nothing is stored outside this Mac.</p>
<script src="/app/vendor/supabase-js-2.118.0.min.js"></script>
<script src="/app/vp-updates-optin.js"></script>
<script>VPUpdatesOptin.open({ role: "host", venue: { name: "Test Alpha" } }, { client: window.supabase.createClient("x", "y") });</script>
</body></html>"""


def build(key, root=None, browser=False, port=0, fonts=True):
    """One test account on its own server. key 'hq' is HQ, holding every test account."""
    root = root or os.path.dirname(os.path.dirname(HERE))
    if key == 'hq':
        wk = {}
        pg_venues = []
        for i, a in enumerate(ACCOUNTS):
            w, p = account_rows(a[0])
            # every account's venue gets its own id in HQ, so View as can tell them apart
            vid = '22222222-2222-4222-8222-2222222220%02d' % (i + 10)
            for t, rows in w.items():
                for r in rows:
                    r = dict(r)
                    for c in ('venue_id', 'id'):
                        if r.get(c) == V1:
                            r[c] = vid
                    if t == 'vp_venues' and r['id'] == V2:
                        r['id'] = vid[:-2] + '%02d' % (i + 40)
                    wk.setdefault(t, []).append(r)
            pg_venues += [v for v in wk['vp_venues'] if v['founding_id'] == 'f-' + a[0]]
        wk['vp_platform_admins'] = [{'auth_user_id': UID, 'role': 'owner', 'label': 'HQ demo'}]
        S = admin_site.Site(root=root, fonts=fonts, browser=browser, port=port,
                            page_db={'vp_venues': pg_venues, 'vp_venue_staff': [],
                                     'vp_platform_admins': [{'auth_user_id': UID, 'role': 'owner', 'label': 'HQ demo'}]})
        for t, rows in wk.items():
            S.W.seed(t, rows)
        S.W.seed('vp_venue_staff', [r for r in wk['vp_venue_staff'] if r['auth_user_id'] != UID])
        return S
    worker, page = account_rows(key)
    S = admin_site.Site(root=root, fonts=fonts, browser=browser, port=port, page_db=page,
                        extra_pages={'/demo/host-email': HOST_EMAIL_PAGE})
    S.W.seed('vp_platform_admins', [])
    S.W.missing('vp_host_updates_optin', False)   # the demo shows the card working, as after migration 161
    for t, rows in worker.items():
        S.W.seed(t, rows)
    return S


def main():
    root = os.path.dirname(os.path.dirname(HERE))
    sites = []
    try:
        for a in ACCOUNTS:
            sites.append((a, build(a[0], root=root, port=a[1])))
        sites.append((('hq', HQ_PORT, 'HQ', '', '', 'hq'), build('hq', root=root, port=HQ_PORT)))
    except OSError as e:
        print('Could not start: %s. Is the demo already running? Stop it with Ctrl+C in its window.' % e)
        for _, s in sites:
            s.close()
        return 1
    print('\nvenueplay Account page demo, on this Mac only (test accounts, made-up data). Ctrl+C stops it.\n')
    for a, s in sites:
        if a[0] == 'hq':
            print('  HQ (admin)                        http://localhost:%d/app/hq.html?as=admin' % a[1])
        else:
            print('  %-13s %-40s http://localhost:%d/app/billing.html' % (a[2], LABEL[a[5]], a[1]))
    print('')
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        for _, s in sites:
            s.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
