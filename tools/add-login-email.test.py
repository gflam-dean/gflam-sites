#!/usr/bin/env python3
"""add-login-email.py puts an email on a host's EXISTING login, and nothing else.

Runs the real tool (its main(), argument parsing and all) against a fake Supabase that keeps
its own logins and staff rows, so every write it makes can be seen. Nothing here touches a
real database.

    python3 tools/add-login-email.test.py   (it sits here because the gate runs .test.py under tools/)
"""
import contextlib, copy, importlib.util, io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('ale', os.path.join(ROOT, 'venueplay-backend', 'tools', 'add-login-email.py'))
ale = importlib.util.module_from_spec(spec); spec.loader.exec_module(ale)

bad = ran = 0
def check(name, cond, extra=''):
    global bad, ran
    ran += 1
    if not cond: bad += 1
    print(('  ok   ' if cond else '  FAIL ') + name + (('   ' + str(extra).replace('\n', ' / ')) if extra else ''))

USERS0 = [
    {'id': 'u-sam-0001', 'phone': '61412345678', 'email': ''},
    {'id': 'u-jo-00002', 'phone': '61498765432', 'email': 'jo@thebowlo.com.au', 'email_confirmed_at': '2026-10-01'},
    {'id': 'u-stray-03', 'phone': '61400000001', 'email': ''},           # a login with no venue
] + [{'id': 'u-fill-%04d' % i, 'phone': '6140100%04d' % i, 'email': ''} for i in range(250)]   # past one page
STAFF0 = [
    {'auth_user_id': 'u-sam-0001', 'role': 'host', 'display_name': 'Sam', 'venue_id': 'v1', 'vp_venues': {'name': 'The Royal'}},
    {'auth_user_id': 'u-jo-00002', 'role': 'manager', 'display_name': 'Jo', 'venue_id': 'v2', 'vp_venues': {'name': 'The Bowlo'}},
]

class Fake:
    def __init__(self, refuse_put=False, mangle_phone=False):
        self.users = copy.deepcopy(USERS0); self.staff = copy.deepcopy(STAFF0)
        self.writes = []; self.refuse_put = refuse_put; self.mangle_phone = mangle_phone
    def __call__(self, method, path, body):
        if method == 'GET' and path.startswith('/auth/v1/admin/users?'):
            page = int(path.split('page=')[-1]); per = 200
            return 200, {'users': copy.deepcopy(self.users[(page - 1) * per: page * per])}
        if method == 'GET' and path.startswith('/rest/v1/vp_venue_staff'):
            return 200, copy.deepcopy(self.staff)
        if path.startswith('/auth/v1/admin/users/'):
            uid = path.rsplit('/', 1)[-1]
            u = next((x for x in self.users if x['id'] == uid), None)
            if method == 'GET': return (200, copy.deepcopy(u)) if u else (404, {})
            if method == 'PUT':
                self.writes.append((uid, body))
                if self.refuse_put: return 422, {'msg': 'Email address already registered'}
                u.update({'email': body['email']})
                if body.get('email_confirm'): u['email_confirmed_at'] = '2026-10-21'
                if self.mangle_phone: u['phone'] = ''
                return 200, copy.deepcopy(u)
        return 404, {}

def run(args, fake):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rc = ale.main(args, call=fake)
    return rc, out.getvalue()

# ---- a dry run changes nothing ----
f = Fake(); rc, out = run(['--mobile', '0412 345 678', '--email', 'Sam@TheRoyal.com.au'], f)
check('without --apply it only says what it would do', rc == 0 and 'WOULD' in out and not f.writes, out.strip())
check('and names the venue and role it will reach', 'The Royal (host)' in out, out.strip())
check('and never prints the full mobile', '412345678' not in out and 'ending 678' in out, out.strip())

# ---- --apply writes the email onto the SAME login, confirmed, and nothing else ----
f = Fake(); rc, out = run(['--mobile', '0412 345 678', '--email', 'Sam@TheRoyal.com.au', '--apply'], f)
check('--apply makes exactly one write', len(f.writes) == 1, f.writes)
uid, body = f.writes[0] if f.writes else ('', {})
check('to the login that mobile already signs in to', uid == 'u-sam-0001', uid)
check('setting only the email, lowercased and confirmed', body == {'email': 'sam@theroyal.com.au', 'email_confirm': True}, body)
check('and it reads the login back and says done', rc == 0 and 'OK: done' in out, out.strip())
sam = next(u for u in f.users if u['id'] == 'u-sam-0001')
check('the mobile is still on the login, so texts still work', sam['phone'] == '61412345678')

# ---- the refusals ----
f = Fake(); rc, out = run(['--mobile', '0412345678', '--email', 'jo@thebowlo.com.au', '--apply'], f)
check('an email already on a DIFFERENT login is refused', rc == 1 and 'DIFFERENT login' in out and not f.writes, out.strip())
f = Fake(); rc, out = run(['--mobile', '0400000001', '--email', 'stray@x.com.au', '--apply'], f)
check('a login that is staff nowhere is refused (it would sign in to nothing)', rc == 1 and 'not staff' in out and not f.writes, out.strip())
f = Fake(); rc, out = run(['--mobile', '0499999999', '--email', 'a@b.com.au', '--apply'], f)
check('a mobile no login uses is refused', rc == 1 and 'no login uses' in out and not f.writes, out.strip())
f = Fake(); rc, out = run(['--mobile', '0412345678', '--email', 'not-an-email', '--apply'], f)
check('a bad email is refused before anything is read into a write', rc == 1 and not f.writes, out.strip())
f = Fake(); f.users.append({'id': 'u-dupe-0009', 'phone': '61412345678', 'email': ''})
rc, out = run(['--mobile', '0412345678', '--email', 'sam@theroyal.com.au', '--apply'], f)
check('a mobile on two logins is refused, not guessed', rc == 1 and 'more than one' in out and not f.writes, out.strip())
f = Fake(); f.users.append({'id': 'u-late-0999', 'phone': '61411111999', 'email': 'late@x.com.au'})
f.staff.append({'auth_user_id': 'u-sam-0001', 'role': 'host', 'display_name': 'Sam', 'venue_id': 'v3', 'vp_venues': {'name': 'Late'}})
rc, out = run(['--mobile', '0412345678', '--email', 'late@x.com.au'], f)
check('it pages past the first 200 logins to find a clash', rc == 1 and 'DIFFERENT login' in out, out.strip())

# ---- a write that does not land is reported, not called done ----
f = Fake(refuse_put=True); rc, out = run(['--mobile', '0412345678', '--email', 'sam@theroyal.com.au', '--apply'], f)
check('Supabase refusing the change is a STOP', rc == 1 and 'refused' in out, out.strip())
f = Fake(mangle_phone=True); rc, out = run(['--mobile', '0412345678', '--email', 'sam@theroyal.com.au', '--apply'], f)
check('a read-back with the mobile gone is a loud STOP', rc == 1 and 'MOBILE CHANGED' in out, out.strip())

# ---- the list ----
f = Fake(); rc, out = run(['--list'], f)
check('--list counts the staff logins with no email', rc == 0 and '2 staff logins, 1 with no email' in out, out.strip().splitlines()[-1])
check('and shows no full mobile', '412345678' not in out and '498765432' not in out)
check('and writes nothing', not f.writes)

print('')
print(('%d OF %d FAILED' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
raise SystemExit(1 if bad else 0)
