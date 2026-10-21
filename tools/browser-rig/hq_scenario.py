"""A WHOLE BUSINESS FOR HQ TO LOOK AT. Not a test.

Shared by tools/hq-tabs-in-chrome.test.py and the before/after screenshots of every HQ tab. It seeds
tools/browser-rig/admin_site.py (the REAL hq.html against the REAL billing Worker) with enough of a
business that every tab has something on it, shaped like the live one:

  groups        two operator groups with venues, one inactive group, and a two-venue self-serve account
  venues        independents on cards, a comp venue, one still inside its paid period after cancelling,
                one whose subscription ended, an archived one, an unpaid one, quiet ones, a test venue,
                and one with a long screen address
  money         declined cards for the same venue more than once (a subscription and an extras
                invoice), receipts, a charged extra, a discount
  audit         well over one page of entries across every kind of change and every kind of person,
                spread over 40 days, so search, filters and paging have something to do
  screens       a venue whose screen settings were deleted straight from the database

Times are relative to now, so "last 7 days" always has something in it and something outside it.
"""
import datetime

NOW = datetime.datetime.now(datetime.timezone.utc)


def ago(days=0, hours=0, minutes=0):
    return (NOW - datetime.timedelta(days=days, hours=hours, minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def vid(n):
    return '40000000-0000-4000-8000-%012d' % n


def gid(n):
    return '41000000-0000-4000-8000-%012d' % n


ADMIN_LABEL = 'Dean'
COAST, SUNNY, OLDG = gid(1), gid(2), gid(3)

# n: (name, slug, founding, group, status, suspended_reason, cancelling, last night days ago or None)
VENUES = {
    1:  ('Deepwater Hotel', 'deepwater-hotel', 'f1', None, 'active', None, False, 2),
    2:  ('The Royal Arms', 'the-royal-arms', 'f1', None, 'active', None, False, 4),
    3:  ('Tugun Bowls Club', 'tugun-bowls', 'f2', None, 'active', None, False, 3),
    4:  ('Connies Country Club', 'connies-country-club-and-function-centre', 'f3', None, 'active', None, False, 1),
    5:  ('Leaving Lounge', 'leaving-lounge', 'f4', None, 'active', None, True, 6),
    6:  ('Ended Bowls', 'ended-bowls', 'f5', None, 'suspended', 'ended', False, 80),
    7:  ('Archived Hotel', 'archived-hotel', 'f6', None, 'suspended', 'archived', False, 200),
    8:  ('Unpaid Club', 'unpaid-club', 'f7', None, 'suspended', 'nonpayment', False, 9),
    9:  ('Quiet Inn', 'quiet-inn', 'f8', None, 'active', None, False, 19),
    10: ('Coastline Kirra', 'coastline-kirra', None, COAST, 'active', None, False, 2),
    11: ('Coastline Burleigh', 'coastline-burleigh', None, COAST, 'active', None, False, 12),
    12: ('Coastline Palm Beach', 'coastline-palm-beach', None, COAST, 'suspended', 'manual', False, 40),
    13: ('Sunshine Leagues', 'sunshine-leagues', None, SUNNY, 'active', None, False, 1),
    14: ('Sunshine RSL', 'sunshine-rsl', None, SUNNY, 'active', None, False, 5),
    15: ('Test Alpha', 'test-alpha', 'f9', None, 'active', None, False, 1),
    16: ('Mini Bar Demo', 'the-mini-bar', 'f10', None, 'active', None, False, 3),
}
TUGUN, LEAVING, ENDED, UNPAID, QUIET, CONNIE, DEEP, ROYAL = vid(3), vid(5), vid(6), vid(8), vid(9), vid(4), vid(1), vid(2)

ACCOUNTS = [
    # id, venue_name, email, status, stripe customer, subscription
    ('f1', 'Deepwater Hotel', 'deep@example.com', 'card_on_file', 'cus_F1', 'sub_F1'),
    ('f2', 'Tugun Bowls Club', 'tugun@example.com', 'card_on_file', 'cus_F2', 'sub_F2'),
    ('f3', 'Connies Country Club', 'connie@example.com', 'pending', None, None),
    ('f4', 'Leaving Lounge', 'leaving@example.com', 'card_on_file', 'cus_F4', 'sub_F4'),
    ('f5', 'Ended Bowls', 'ended@example.com', 'cancelled', 'cus_F5', None),
    ('f6', 'Archived Hotel', 'archived@example.com', 'cancelled', 'cus_F6', None),
    ('f7', 'Unpaid Club', 'unpaid@example.com', 'past_due', 'cus_F7', 'sub_F7'),
    ('f8', 'Quiet Inn', 'quiet@example.com', 'card_on_file', 'cus_F8', 'sub_F8'),
    ('f9', 'Test Alpha', 'alpha@example.com', 'comp', None, None),
    ('f10', 'Mini Bar Demo', 'minibar@example.com', 'comp', None, None),
]


def venue_rows():
    out = []
    for n, (name, slug, f, g, st, why, canc, last) in VENUES.items():
        out.append({'id': vid(n), 'name': name, 'slug': slug, 'status': st, 'suspended_reason': why,
                    'created_at': ago(300 - n), 'timezone': 'Australia/Brisbane', 'founding_id': f, 'group_id': g,
                    'max_players': 60 + n, 'included_players': 100 if g else None, 'au_state': 'QLD', 'postcode': '4224',
                    'cancel_at_period_end': canc, 'weekly_limit_off': False, 'entity_type': None, 'paid_entry_enabled': False,
                    'hide_from_trusted': False, 'join_code': 'J%04d' % n})
    return out


def groups():
    return [{'id': COAST, 'name': 'Coastline Hotels', 'billing_email': 'accounts@coastline.example', 'negotiated_rate_cents': 220,
             'rack_rate_cents': 300, 'status': 'active', 'created_at': ago(200)},
            {'id': SUNNY, 'name': 'Sunshine Clubs', 'billing_email': 'pay@sunshine.example', 'negotiated_rate_cents': 250,
             'rack_rate_cents': 300, 'status': 'active', 'created_at': ago(150)},
            {'id': OLDG, 'name': 'Old Group', 'billing_email': 'old@example.com', 'negotiated_rate_cents': 200,
             'rack_rate_cents': 300, 'status': 'suspended', 'created_at': ago(250)}]


def founding_rows():
    # Connie waits for a decision (null) and Ended Bowls was told no (false): both shapes HQ must draw.
    optin = {'f3': None, 'f5': False}
    return [{'id': a, 'venue_name': n, 'contact_email': e, 'contact_name': n + ' owner', 'status': st, 'stripe_customer_id': c,
             'stripe_subscription_id': s, 'plan': 'monthly', 'optin_release_approved': optin.get(a, True), 'created_at': ago(300)}
            for a, n, e, st, c, s in ACCOUNTS]


def sessions():
    out = []
    for n, v in VENUES.items():
        if v[7] is not None:
            out.append({'id': 'sess-%d' % n, 'venue_id': vid(n), 'status': 'ended', 'opened_at': ago(v[7]),
                        'started_at': ago(v[7]), 'ended_at': ago(v[7]), 'created_at': ago(v[7])})
    return out


_aid = [0]


def A(action, days, target=None, who='system', admin=None, detail=None, hours=0):
    _aid[0] += 1
    return {'id': 'a%05d' % _aid[0], 'created_at': ago(days, hours, _aid[0] % 50), 'actor_admin': admin, 'actor_label': who,
            'action': action, 'target': target, 'detail': detail or {}}


def audit_rows(uid):
    _aid[0] = 0
    D = dict(who=ADMIN_LABEL, admin=uid)
    rows = [
        # money: the same venue declined three times, one extras invoice, a receipt that did not send
        A('payment_failed_email', 1, 'customer:cus_F2', 'stripe', None, {'to': 'tugun@example.com', 'amount': '$264.00', 'what': 'your VenuePlay subscription',
          'reason_line': 'The bank declined it without giving a reason.', 'outcome': 'subscription', 'sent': True}),
        A('payment_failed_email', 4, 'customer:cus_F2', 'stripe', None, {'to': 'tugun@example.com', 'amount': '$264.00', 'what': 'your VenuePlay subscription',
          'reason_line': 'The bank declined it without giving a reason.', 'outcome': 'subscription', 'sent': True}),
        A('payment_failed_email', 8, 'customer:cus_F2', 'stripe', None, {'to': 'tugun@example.com', 'amount': '$264.00', 'what': 'your VenuePlay subscription',
          'reason_line': 'The card has insufficient funds.', 'outcome': 'subscription', 'sent': True}),
        A('payment_failed_email', 2, 'customer:cus_F7', 'stripe', None, {'to': 'unpaid@example.com', 'amount': '$4.00',
          'what': 'Unpaid Club - Extra Player - 12/10/2026', 'reason_line': 'The card has expired.', 'outcome': 'stays open', 'sent': True}),
        A('overage_invoice_unpaid', 3, 'venue:' + UNPAID, 'system', None, {'amount_cents': 400}),
        A('invoice_receipt_email', 5, 'customer:cus_F1', 'stripe', None, {'outcome': 'sent', 'invoice': 'in_1'}),
        A('invoice_receipt_email', 6, 'customer:cus_F8', 'stripe', None, {'outcome': 'not sent: the customer has no email address', 'invoice': 'in_2'}),
        A('overage_charged', 7, 'venue:' + DEEP, 'system', None, {'amount_cents': 1200, 'players': 6}),
        A('discount_applied', 9, 'venue:' + ROYAL, detail={'kind': 'percent', 'value': 20, 'months': 3, 'name': 'The Royal Arms'}, **D),
        # screens
        A('logo_set', 2, 'venue:' + TUGUN, 'owner', None, {'via': 'venue', 'before': {'logo_url': None, 'slides': 2}, 'after': {'logo_url': 'https://db/x.png', 'slides': 2}}),
        A('screen_updated', 2, 'venue:' + TUGUN, 'owner', None, {'via': 'venue', 'before': {'slides': 2}, 'after': {'slides': 3}, 'changed': ['slides']}),
        A('slide_uploaded', 2, 'venue:' + TUGUN, 'owner', None, {'via': 'venue', 'url': 'https://db/storage/v1/object/public/venue-ads/x/1.png', 'bytes': 12000}),
        A('screen_restored', 1, 'venue:' + TUGUN, detail={'history_id': 3, 'name': 'Tugun Bowls Club', 'after': {'slides': 3}}, **D),
        # venues coming and going
        A('venue_onboarded', 30, 'venue:' + CONNIE, detail={'name': 'Connies Country Club'}, **D),
        A('venue_cancel_scheduled', 10, 'venue:' + LEAVING, 'owner', None, {'reason': 'price', 'reason_label': 'It costs too much',
          'reason_detail': 'Love it but the numbers do not work this winter.', 'ends': '30 Oct 2026'}),
        A('venue_cancel_contacted', 8, 'venue:' + LEAVING, **D),
        A('venue_cancel_scheduled', 60, 'venue:' + ENDED, 'owner', None, {'reason': 'closing', 'reason_label': 'We are closing or selling', 'ends': '1 Sep 2026'}),
        A('venue_subscription_ended', 50, 'venue:' + ENDED, 'stripe', None, {}),
        A('venue_quiet_contacted', 3, 'venue:' + QUIET, **D),
        A('auto_archive_run', 12, None, 'automatic (30-day archive)', None, {'archived': 1, 'checked': 14}),
        A('venue_marked_test', 100, 'venue:' + vid(15), detail={'name': 'Test Alpha'}, **D),
        # gaming, players, logins, signups
        A('venue_gaming_updated', 11, 'venue:' + CONNIE, detail={'entity_type': 'non_profit'}, **D),
        A('venue_night_pass_granted', 5, 'venue:' + DEEP, detail={'name': 'Deepwater Hotel', 'format': 'trivia', 'hours': 24}, **D),
        A('players_increased', 15, 'account:f1', 'owner', None, {'from': 80, 'to': 100}),
        A('optin_exported', 16, 'venue:' + DEEP, 'owner', None, {'rows': 212}),
        A('staff_added', 20, None, detail={'name': 'Sam', 'role': 'accounts'}, **D),
        A('manager_added', 18, 'venue:' + TUGUN, 'owner', None, {'name': 'Kim'}),
        A('signup_flagged', 25, 'account:f3', 'system', None, {'email': 'connie@gmail.example'}),
        A('paper_suspect_trivia', 13, 'venue:' + vid(13), None, None, {'questions': 20, 'answered': 1}),
        A('email_bounced', 14, 'account:f5', 'system', None, {'to': 'ended@example.com'}),
    ]
    # Bulk: well over a page, across 40 days, so the default week is a subset and paging has work.
    kinds = [('screen_updated', 'owner', None), ('players_increased', 'owner', None), ('venue_code_refreshed', 'system', None),
             ('invoice_receipt_email', 'stripe', None), ('venue_gaming_updated', ADMIN_LABEL, uid)]
    for i in range(120):
        act, who, adm = kinds[i % len(kinds)]
        n = 1 + (i % 9)
        tgt = ('customer:cus_F1' if act == 'invoice_receipt_email' else 'venue:' + vid(n))
        det = {'outcome': 'sent'} if act == 'invoice_receipt_email' else ({'from': 60, 'to': 70} if act == 'players_increased' else {})
        rows.append(A(act, (i * 40.0) / 120.0, tgt, who, adm, det))
    return rows


def screen_history():
    tug = {'venue_id': TUGUN, 'slug': 'tugun-bowls', 'slides': [{'image_url': 'https://db/storage/v1/object/public/venue-ads/t/1.png', 'seconds': 7}],
           'draws': [], 'raffle': None, 'logo_url': 'https://db/storage/v1/object/public/venue-logos/t/a.png'}
    return [
        {'id': 1, 'venue_id': TUGUN, 'slug': 'tugun-bowls', 'op': 'baseline', 'old_row': None, 'new_row': tug, 'changed_at': ago(20),
         'actor': {'label': 'migration 114'}, 'via': 'migration'},
        {'id': 2, 'venue_id': TUGUN, 'slug': 'tugun-bowls', 'op': 'delete', 'old_row': tug, 'new_row': None, 'changed_at': ago(2, 5),
         'actor': None, 'via': 'direct', 'db_session_user': 'postgres', 'db_role': None, 'jwt_role': None},
    ]


def seed(S):
    """Fill an admin_site.Site's Worker database. Returns the fake supabase-js extras for Site(extra_db=...)."""
    uid = S.W.info['uid']
    S.W.seed('vp_platform_admins', [{'auth_user_id': uid, 'role': 'owner', 'label': ADMIN_LABEL}])
    S.W.seed('vp_venues', venue_rows())
    S.W.seed('vp_venue_groups', groups())
    S.W.seed('venueplay_founding', founding_rows())
    S.W.seed('vp_sessions', sessions())
    S.W.seed('vp_game_reports', [])
    S.W.seed('vp_venue_staff', [])
    S.W.seed('vp_admin_audit', audit_rows(uid))
    S.W.seed('vp_venue_screen_history', screen_history())
    S.W.seed('vp_venue_screen', [])


def extra_db():
    return {'vp_venues': venue_rows(), 'vp_venue_groups': groups(), 'venueplay_founding': founding_rows()}
