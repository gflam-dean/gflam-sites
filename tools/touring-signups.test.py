#!/usr/bin/env python3
"""DO THE "JOIN THE GFLAM FAMILY" FORMS ACTUALLY STORE A SIGNUP, AND SAY SO HONESTLY?

19 Oct 2026: every signup form posts to public.signups with the public key, and the
public role had no INSERT on that table. The live endpoint answered the forms' own
request with "42501 permission denied for table signups". Three of the five forms said
"thanks" anyway, so nobody knew.

This runs the REAL pages in headless Chrome against a fake PostgREST that enforces the
rules twice over:
  BEFORE  as live is today: no INSERT for the public key, so every insert is refused.
          Every form must show an error, and none may say thanks.
  AFTER   the rules in touring-backend/supabase/signups-forms-insert.sql (Dean runs it as
          ~/RUN-ME-GFLAM-SIGNUPS.sql), READ FROM THAT FILE: only the granted columns,
          the policy's sources and lengths, and no reading back (so a form that asks
          for return=representation is refused, as PostgREST would refuse it).
          Every form must store exactly one row and say thanks.

    python3 tools/touring-signups.test.py
"""
import importlib.util, io, json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQL_PATH = os.path.join(ROOT, 'touring-backend', 'supabase', 'signups-forms-insert.sql')
LOCK_PATH = os.path.join(ROOT, 'touring-backend', 'supabase', 'lock-touring-writes.sql')
LIVE = 'https://ijkzgmdtwtgfkedqspxm.supabase.co'

_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
_vl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_vl)

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
    else:
        FAIL[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


# ---- the rules, read from the SQL Dean will run ----------------------------------
sql = io.open(SQL_PATH, encoding='utf-8').read()
body = re.sub(r'--[^\n]*', '', sql)
m = re.search(r'grant insert \(([^)]*)\) on public\.signups to anon;', body, re.I)
GRANTED = [c.strip() for c in m.group(1).split(',')] if m else []
pol = re.search(r'create policy "[^"]+" on public\.signups\s+for insert to anon\s+with check \((.*?)\);', body, re.S | re.I)
POLICY = pol.group(1) if pol else ''
SOURCES = re.findall(r"'([a-z_]+)'", re.search(r'source in \(([^)]*)\)', POLICY).group(1)) if 'source in (' in POLICY else []
LIMITS = {c: int(n) for c, n in re.findall(r'coalesce\(length\((\w+)\), 0\) <= (\d+)', POLICY)}
EMAIL = re.search(r'length\(email\) between (\d+) and (\d+)', POLICY)


def policy_allows(row):
    e = row.get('email')
    if not e or not EMAIL or not (int(EMAIL.group(1)) <= len(e) <= int(EMAIL.group(2))) or not re.match(r'.+@.+\..+', e):
        return False
    for c, n in LIMITS.items():
        if len(row.get(c) or '') > n:
            return False
    if row.get('source') not in SOURCES:
        return False
    if (row.get('signup_type') or 'signup') != 'signup':
        return False
    return True


STATE = {'mode': 'before', 'rows': [], 'refusals': []}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, payload, ctype='application/json'):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('content-type', ctype)
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path.split('?')[0]
        if p in PAGES_SERVED:
            return self._send(200, PAGES_SERVED[p].encode('utf-8'), 'text/html; charset=utf-8')
        if p.startswith('/sb/rest/v1/'):
            return self._send(200, [])
        return self._send(404, b'', 'text/plain')

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        raw = self.rfile.read(n)
        p = self.path.split('?')[0]
        if p != '/sb/rest/v1/signups':
            return self._send(201, b'', 'text/plain')
        denied = {'code': '42501', 'message': 'permission denied for table signups'}
        if STATE['mode'] == 'before':
            STATE['refusals'].append('no grant')
            return self._send(401, denied)
        row = json.loads(raw.decode('utf-8'))
        extra = [k for k in row if k not in GRANTED]
        if extra:
            STATE['refusals'].append('columns ' + ','.join(extra))
            return self._send(401, denied)
        if 'return=representation' in (self.headers.get('Prefer') or ''):
            STATE['refusals'].append('asked to read the row back')
            return self._send(401, {'code': '42501', 'message': 'new row violates row-level security policy for table "signups"'})
        if not policy_allows(row):
            STATE['refusals'].append('policy')
            return self._send(401, {'code': '42501', 'message': 'new row violates row-level security policy for table "signups"'})
        STATE['rows'].append(row)
        return self._send(201, b'', 'text/plain')


srv = ThreadingHTTPServer(('127.0.0.1', 0), Fake)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % PORT

FORMS = [
    # page, how to fill and send, how success shows, the source it must store
    ('touring/index.html',
     "document.getElementById('tsfa').value='Kiki';document.getElementById('tsfb').value='0400000000';"
     "document.getElementById('tsfc').value='kiki@example.com';document.getElementById('tsfd').value='4224';doSU_tsf();",
     "document.getElementById('tsfz').classList.contains('show')", 'gflam_touring'),
    ('touring/drag-bingo-at-the-bowlo.html',
     "document.getElementById('dbsfa').value='Kiki';document.getElementById('dbsfb').value='0400000000';"
     "document.getElementById('dbsfc').value='kiki@example.com';document.getElementById('dbsfd').value='4224';doDBSU();",
     "document.getElementById('dbsfz').classList.contains('show')", 'drag_bingo'),
    ('drag-bingo/drag-bingo-at-the-bowlo.html',
     "document.getElementById('dbsfa').value='Kiki';document.getElementById('dbsfb').value='0400000000';"
     "document.getElementById('dbsfc').value='kiki@example.com';document.getElementById('dbsfd').value='4224';doDBSU();",
     "document.getElementById('dbsfz').classList.contains('show')", 'drag_bingo'),
    ('group/index.html',
     "document.getElementById('gsfa').value='Kiki';document.getElementById('gsfb').value='0400000000';"
     "document.getElementById('gsfc').value='kiki@example.com';document.getElementById('gsfd').value='4224';doGSU();",
     "document.getElementById('gsfz').classList.contains('show')", 'gflam_group'),
    ('touring/nextevent/index.html',
     "openSignup('single');document.getElementById('su-name').value='Kiki';"
     "document.getElementById('su-email').value='kiki@example.com';submitSignup();",
     "document.getElementById('signup-success').style.display==='block'", 'nextevent_discount'),
]
PAGES_SERVED = {}
for page, _, _, _ in FORMS:
    src = io.open(os.path.join(ROOT, page), encoding='utf-8').read()
    if LIVE not in src:
        print('%s no longer names the database this test expects; nothing was run' % page)
        print('0 of 1 checks passed')
        sys.exit(1)
    src = src.replace(LIVE, BASE + '/sb')
    for host in ('https://www.googletagmanager.com', 'https://fonts.googleapis.com', 'https://connect.facebook.net'):
        src = src.replace(host, BASE + '/offline')
    PAGES_SERVED['/' + page] = src

# ---- the SQL itself ----------------------------------------------------------------
ok('the SQL gives the public key INSERT on the form columns only',
   set(GRANTED) == {'first_name', 'mobile', 'email', 'postcode', 'state', 'source', 'signup_type'}, GRANTED)
ok('the SQL takes away reading, changing and deleting signups',
   re.search(r'revoke all on public\.signups from anon;', body) is not None
   and not re.search(r'grant (select|update|delete|all)[^;]*signups[^;]*to anon', body, re.I))
ok('the SQL names Sydney and checks its own work',
   'ijkzgmdtwtgfkedqspxm' in sql and body.count('raise exception') >= 3 and 'begin;' in body and 'commit;' in body)
ok('the tour lock does not touch signups, so the two cannot undo each other',
   'signups' not in re.sub(r'--[^\n]*', '', io.open(LOCK_PATH, encoding='utf-8').read()))

br = _vl.Browser()
try:
    for mode in ('before', 'after'):
        STATE['mode'] = mode
        for page, fill, success, source in FORMS:
            del STATE['rows'][:]
            del STATE['refusals'][:]
            tid, sid = br.open_tab(BASE + '/' + page)
            # Two minutes, and a page that never loads is said out loud rather than filled in half
            # loaded (this was 15 seconds and the answer was ignored; 20 Oct 2026, under load).
            end = time.time() + 120
            while time.time() < end and br.eval(sid, 'document.readyState') != 'complete':
                time.sleep(0.2)
            if br.eval(sid, 'document.readyState') != 'complete':
                raise RuntimeError('%s had not finished loading after two minutes' % page)
            br.eval(sid, "window._alerts=[];window.alert=function(m){window._alerts.push(String(m));};true")
            br.eval(sid, '(function(){' + fill + 'return true;})()')
            thanked, alerts = False, []
            end = time.time() + 30          # returns the moment the page answers; 8 s was too short on a busy machine
            while time.time() < end:
                thanked = bool(br.eval(sid, '(function(){try{return ' + success + ';}catch(e){return false;}})()'))
                alerts = br.eval(sid, 'window._alerts') or []
                if thanked or alerts:
                    break
                time.sleep(0.2)
            time.sleep(0.3)
            thanked = bool(br.eval(sid, '(function(){try{return ' + success + ';}catch(e){return false;}})()'))
            if mode == 'before':
                ok('%s: while the database refuses, it never says thanks' % page, not thanked)
                ok('%s: and it says the signup did not go through' % page,
                   any("didn't go through" in a for a in alerts), alerts[:1])
            else:
                ok('%s: with the new rules it stores the signup and says thanks' % page,
                   thanked and len(STATE['rows']) == 1 and not alerts, (len(STATE['rows']), STATE['refusals'][:1], alerts[:1]))
                ok('%s: as source %s' % (page, source),
                   len(STATE['rows']) == 1 and STATE['rows'][0].get('source') == source,
                   STATE['rows'][0] if STATE['rows'] else None)
            br.close_tab(tid)
except Exception as e:
    ok('the run finished', False, str(e)[:300])
finally:
    br.close()
    srv.shutdown()

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
EXPECTED = 4 + 2 * 5 * 2
if PASS[0] + FAIL[0] != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, PASS[0] + FAIL[0]))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
