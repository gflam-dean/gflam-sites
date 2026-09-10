#!/usr/bin/env python3
"""Create the TEST HOST account, so tests can sign in without anybody's phone.

    python3 venueplay-backend/tools/make-test-host.py

WHY. Every host signs in by SMS, which a test cannot do, and Dean's own account is the
wrong thing to use: everything it did would appear in the audit trail as him, and a test
that misfired near a real venue would look exactly like the owner doing it deliberately.

So one account, email login, staff at TEST VENUES ONLY. This is the same shape the load
test already uses (load-host-00001@load.invalid, password in ~/.gflam-migrate/load-host.pass),
created the same way: through the Supabase admin API, not through any sign-up form.

IT DOES NOT PUT AN EMAIL LOGIN ON THE SITE. Hosts still sign in by SMS and nothing about
that changes. The address ends .invalid, which by definition cannot receive mail, so there
is no password reset path to attack either.

The password is generated here, written to ~/.gflam-migrate/test-host.pass with mode 600,
and never printed, logged or returned. Neither Dean nor I ever see it.

Run it twice and it resets the password rather than making a second account.
"""
import json, os, secrets, string, sys, urllib.request, urllib.error
from pathlib import Path

ENV  = Path.home() / '.gflam-migrate.env'
WORK = Path.home() / '.gflam-migrate'
PASS_FILE = WORK / 'test-host.pass'
EMAIL = 'test-host@venueplay.invalid'
LIVE  = 'https://gpoolavkghnxedzrmtmc.supabase.co'

def die(m): print('STOP: ' + m); sys.exit(1)

def env():
    if not ENV.exists(): die(f'{ENV} is missing')
    e = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    if not e.get('OLD_SERVICE_KEY'): die('OLD_SERVICE_KEY is not in the env file')
    return e

def admin(e, method, path, body=None):
    req = urllib.request.Request(LIVE + '/auth/v1' + path,
        data=json.dumps(body).encode() if body else None, method=method,
        headers={'apikey': e['OLD_SERVICE_KEY'], 'Authorization': 'Bearer ' + e['OLD_SERVICE_KEY'],
                 'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=30); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read() or b'{}')
        except Exception: return x.code, {}

def main():
    e = env()
    WORK.mkdir(mode=0o700, exist_ok=True)
    alphabet = string.ascii_letters + string.digits
    password = ''.join(secrets.choice(alphabet) for _ in range(40))

    st, d = admin(e, 'GET', '/admin/users?per_page=200')
    users = (d or {}).get('users') or []
    existing = next((u for u in users if (u.get('email') or '').lower() == EMAIL), None)

    if existing:
        st, d = admin(e, 'PUT', '/admin/users/' + existing['id'],
                      {'password': password, 'email_confirm': True})
        if st != 200: die('could not reset the test host password (%s): %s' % (st, d.get('msg') or d))
        uid = existing['id']; what = 'password reset on the existing account'
    else:
        st, d = admin(e, 'POST', '/admin/users',
                      {'email': EMAIL, 'password': password, 'email_confirm': True,
                       'user_metadata': {'label': 'VenuePlay test host', 'created_by': 'make-test-host.py'}})
        if st not in (200, 201): die('could not create the test host (%s): %s' % (st, d.get('msg') or d))
        uid = d.get('id'); what = 'account created'

    PASS_FILE.write_text(password + '\n')
    os.chmod(PASS_FILE, 0o600)
    print('  %s' % what)
    print('  email     %s' % EMAIL)
    print('  auth id   %s' % uid)
    print('  password  written to %s, mode 600, never printed' % PASS_FILE)
    print('\n  It is staff at NOTHING yet. The next step makes the test venues and')
    print('  adds it to those, and only those.')

if __name__ == '__main__':
    main()
