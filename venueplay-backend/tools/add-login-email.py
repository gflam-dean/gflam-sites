#!/usr/bin/env python3
"""Put an email address on a host's EXISTING login, so they can get their sign-in code by email.

    python3 venueplay-backend/tools/add-login-email.py --list
    python3 venueplay-backend/tools/add-login-email.py --mobile 0412345678 --email sam@theroyal.com.au
    python3 venueplay-backend/tools/add-login-email.py --mobile 0412345678 --email sam@theroyal.com.au --apply

WHY. 21 Oct 2026: Mobile Message went down, and a text code was the only way into a host
console. The sign-in screen now offers "Get it by email instead", but that only works for a
login that HAS an email, and on that night 15 of the 16 staff logins had none (every login is
made from a mobile number). The one that did was a test account.

WHAT IT DOES. Adds the email to the SAME login the mobile already signs in to, through the
Supabase admin API, marked confirmed. The login keeps its mobile, its venue staff rows, its
role and its id, so the staff check, the 4 hour shift and the audit trail are exactly what
phone sign-in gives. It never makes a new login: a new login would have no venue.

SAFE BY DEFAULT. Without --apply it only says what it would do. It refuses an email that is
already on a different login, and a mobile that matches no login or more than one. After
--apply it reads the login back and checks the email is there AND the mobile is unchanged.
It never prints a full mobile number (only the last three digits) or the service key.

Put your OWN login's email on first and sign in with it, to prove the email code reaches you,
before doing a venue's host.
"""
import argparse, json, re, sys, urllib.request, urllib.error

EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


def digits(x):
    return re.sub(r'\D', '', str(x or ''))


def e164(raw):
    """The same rule the sign-in screen uses (toE164 in app/index.html)."""
    s = str(raw or '').strip()
    if s.startswith('+'):
        return '+' + digits(s)
    d = digits(s)
    if not d: return ''
    if d.startswith('0'): return '+61' + d[1:]
    if d.startswith('61'): return '+' + d
    return '+61' + d


def ending(phone):
    d = digits(phone)
    return ('ending ' + d[-3:]) if len(d) >= 3 else 'no mobile'


def all_users(call):
    """Every auth login, paged until an EMPTY page (a short page is not the end)."""
    out, page = [], 1
    while page <= 100:
        st, d = call('GET', '/auth/v1/admin/users?per_page=200&page=%d' % page, None)
        if st != 200: raise RuntimeError('could not list logins (%s)' % st)
        users = (d or {}).get('users') or []
        if not users: break
        out.extend(users); page += 1
    return out


def staff_rows(call):
    st, d = call('GET', '/rest/v1/vp_venue_staff?select=auth_user_id,role,display_name,venue_id,vp_venues(name)&order=venue_id', None)
    if st != 200: raise RuntimeError('could not read venue staff (%s)' % st)
    return d or []


def plan(users, staff, mobile, email):
    """Decide, without writing anything. Returns (ok, message, user)."""
    want = digits(e164(mobile))
    email = (email or '').strip().lower()
    if not want: return False, 'that mobile number is empty', None
    if not EMAIL_RE.match(email): return False, 'that email address does not look right', None
    by_phone = [u for u in users if digits(u.get('phone')) == want]
    if not by_phone: return False, 'no login uses that mobile', None
    if len(by_phone) > 1: return False, 'more than one login uses that mobile; fix that first', None
    u = by_phone[0]
    others = [x for x in users if (x.get('email') or '').lower() == email and x.get('id') != u.get('id')]
    if others: return False, 'that email is already on a DIFFERENT login, so it cannot go on this one', None
    rows = [s for s in staff if s.get('auth_user_id') == u.get('id')]
    if not rows: return False, 'that login is not staff at any venue, so an email code would sign in to nothing', None
    if (u.get('email') or '').lower() == email: return False, 'that login already has that email; nothing to do', u
    where = ', '.join('%s (%s)' % (((r.get('vp_venues') or {}).get('name') or '?'), r.get('role')) for r in rows)
    was = (' replacing ' + u['email']) if u.get('email') else ''
    return True, 'login %s, %s, staff at %s: add %s%s' % (u.get('id', '')[:8], ending(u.get('phone')), where, email, was), u


def apply(call, user, email):
    """Write, then read back. Returns (ok, message)."""
    email = email.strip().lower()
    st, d = call('PUT', '/auth/v1/admin/users/' + user['id'], {'email': email, 'email_confirm': True})
    if st != 200:
        return False, 'Supabase refused the change (%s): %s' % (st, (d or {}).get('msg') or (d or {}).get('message') or '')
    st, back = call('GET', '/auth/v1/admin/users/' + user['id'], None)
    if st != 200: return False, 'changed, but could not read the login back to check (%s)' % st
    if (back.get('email') or '').lower() != email: return False, 'read back and the email is NOT on the login'
    if digits(back.get('phone')) != digits(user.get('phone')): return False, 'read back and the MOBILE CHANGED; check this login now'
    if not back.get('email_confirmed_at'): return False, 'the email is on the login but not confirmed, so the code will not send'
    return True, 'done: %s can now get a code by email at %s, and still by text' % (ending(back.get('phone')), email)


def listing(users, staff):
    by_id = {u.get('id'): u for u in users}
    lines, seen = [], set()
    for s in staff:
        uid = s.get('auth_user_id')
        u = by_id.get(uid) or {}
        venue = (s.get('vp_venues') or {}).get('name') or '?'
        lines.append('  %-28s %-9s %-24s %-12s %s' % (venue[:28], s.get('role') or '', (s.get('display_name') or '')[:24],
                                                     ending(u.get('phone')), 'email set' if u.get('email') else 'NO EMAIL'))
        seen.add(uid)
    missing = len([1 for uid in seen if not (by_id.get(uid) or {}).get('email')])
    lines.append('')
    lines.append('  %d staff logins, %d with no email' % (len(seen), missing))
    return lines


def http_call(rest_url, key):
    def call(method, path, body):
        req = urllib.request.Request(rest_url + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                     headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        try:
            r = urllib.request.urlopen(req, timeout=30); return r.status, json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as x:
            try: return x.code, json.loads(x.read() or b'{}')
            except Exception: return x.code, {}
    return call


def main(argv=None, call=None):
    ap = argparse.ArgumentParser(description='Add an email to a host login, so the sign-in code can go by email.')
    ap.add_argument('--list', action='store_true', help='show every staff login and whether it has an email')
    ap.add_argument('--mobile'); ap.add_argument('--email')
    ap.add_argument('--apply', action='store_true', help='actually make the change (otherwise it only says what it would do)')
    a = ap.parse_args(argv)
    if call is None:
        sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
        from vp_live import live   # which database is LIVE; never guess from a variable name
        L = live(); print(L.banner())
        if not L.service_key or not L.rest_url: print('STOP: no service key or URL for the live database'); return 1
        call = http_call(L.rest_url, L.service_key)
    users, staff = all_users(call), staff_rows(call)
    if a.list:
        print('\n'.join(listing(users, staff))); return 0
    if not (a.mobile and a.email):
        print('Give --mobile and --email, or --list.'); return 1
    ok, msg, user = plan(users, staff, a.mobile, a.email)
    if not ok:
        print('STOP: ' + msg); return 1
    if not a.apply:
        print('WOULD: ' + msg); print('Nothing changed. Run again with --apply to do it.'); return 0
    print('DOING: ' + msg)
    ok, msg = apply(call, user, a.email)
    print(('OK: ' if ok else 'STOP: ') + msg)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
