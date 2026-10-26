#!/usr/bin/env python3
"""DOES EVERY GFLAM MARKETING EMAIL CARRY A WORKING ONE-CLICK UNSUBSCRIBE, AND IS ANYBODY
WHO USED IT SKIPPED?

Runs the real helper (touring-backend/lib/gflam_unsub.py) and the real mail-out
(touring-backend/mailout/send-mailout.py) with the database and Resend replaced by fakes.
Nothing here touches the network.

    python3 tools/gflam-unsub.test.py
"""
import contextlib, csv, importlib.util, io, os, sys, tempfile, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'touring-backend', 'lib'))
os.environ['GFLAM_UNSUB_SECRET'] = ''          # never the real one, whatever the shell has
import gflam_unsub as U

spec = importlib.util.spec_from_file_location('mailout', os.path.join(ROOT, 'touring-backend', 'mailout', 'send-mailout.py'))
M = importlib.util.module_from_spec(spec); spec.loader.exec_module(M)
assert M.gflam_unsub is U, 'the mail-out must use the shared helper, not its own copy'

passed = failed = 0
def ok(label, good, detail=''):
    global passed, failed
    if good: passed += 1; print('  PASS  ' + label + ('  (%s)' % detail if detail else ''))
    else: failed += 1; print('  FAIL  ' + label + ('  (%s)' % detail if detail else ''))

KEY = 'vector-secret-26oct'
VECTOR = 'bca393cbe4284029351e1e4c98244abc'   # the same vector touring-unsubscribe.test.js checks

# 1. The token the email carries is the one the Worker checks.
ok('token matches the Worker vector (case and spaces ignored)', U.token('  Queen@Example.com ', KEY) == VECTOR, U.token('queen@example.com', KEY))
try:
    U.token('a@b.co', ''); ok('no secret: refuses to make a link', False)
except RuntimeError:
    ok('no secret: refuses to make a link', True)

# 2. Headers: https first, mailto second, and the RFC 8058 POST header exactly.
h = U.headers('Queen@Example.com', 'dragbingo-jan27', KEY)
lu = h.get('List-Unsubscribe', '')
ok('List-Unsubscribe carries the https link first', lu.startswith('<https://touring-api.dean-tindale.workers.dev/unsubscribe?e=queen%40example.com&t=' + VECTOR + '&c=dragbingo-jan27>'), lu)
ok('List-Unsubscribe keeps the mailto as a second option', lu.endswith(', <mailto:hello@gflamtouring.com.au?subject=unsubscribe>'))
ok('List-Unsubscribe-Post is the one-click value', h.get('List-Unsubscribe-Post') == 'List-Unsubscribe=One-Click')
ok('a campaign tag cannot inject into the link', '&c=abc-def' in U.link('a@b.co', 'ABC-def&t=x"<', KEY))

# 3. The unsubscribed list pages to an EMPTY page and fails CLOSED.
DB = ['p%04d@example.com' % i for i in range(2300)]
seen = []
def fake_get(path):
    seen.append(path)
    if not path.startswith('gflam_customers'): return []
    off = int(path.split('offset=')[1]); lim = int(path.split('limit=')[1].split('&')[0])
    if 'unsubscribed_at=not.is.null' not in path: return [{'email': 'subscribed@example.com'}]
    return [{'email': e.upper()} for e in DB[off:off + min(lim, 700)]]   # max-rows below the page size: every page is short
got = U.unsubscribed_emails(get=fake_get)
ok('reads every unsubscribed address past 1000, even when every page is short', len(got) == 2300 and 'p2299@example.com' in got, len(got))
ok('asks only for rows with unsubscribed_at set', all('unsubscribed_at=not.is.null' in p for p in seen))
def broken_get(path): raise urllib.error.HTTPError('u', 500, 'down', {}, None)
try:
    U.unsubscribed_emails(get=broken_get); ok('a failed read raises (never an empty list)', False)
except urllib.error.HTTPError:
    ok('a failed read raises (never an empty list)', True)

# 4. Preflight: the live Worker must hold the secret and accept our token.
class R:
    def __init__(s, body=b'{}', status=200): s.body, s.status = body, status
    def read(s): return s.body
    def __enter__(s): return s
    def __exit__(s, *a): return False
def opener_for(health, unsub_code):
    def o(u):
        if u.endswith('/health'): return R(health)
        if unsub_code != 200: raise urllib.error.HTTPError(u, unsub_code, 'no', {}, None)
        return R()
    return o
ok('preflight passes when the Worker accepts our link', U.preflight(KEY, opener=opener_for(b'{"ok":true,"missing":[]}', 200))[0])
ok('preflight fails when the Worker has no secret', not U.preflight(KEY, opener=opener_for(b'{"ok":false,"missing":["GFLAM_UNSUB_SECRET"]}', 200))[0])
ok('preflight fails when the Worker refuses our token', not U.preflight(KEY, opener=opener_for(b'{"ok":true,"missing":[]}', 403))[0])

# 5. The mail-out, dry run: shows the headers and skips the unsubscribed.
tmp = tempfile.mkdtemp()
src = os.path.join(tmp, 'tickets.csv')
with open(src, 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['First Name', 'Email', 'Subscribed To Client'])
    w.writerow(['Ann', 'ann@example.com', 'Yes'])
    w.writerow(['Bea', 'BEA@example.com', 'Yes'])        # unsubscribed via the link
    w.writerow(['Cat', 'cat@example.com', 'Yes'])        # in suppress.txt
    w.writerow(['Dee', 'dee@example.com', 'Yes'])        # already in sent.csv
open(os.path.join(tmp, 'suppress.txt'), 'w').write('cat@example.com\n')
open(os.path.join(tmp, 'sent.csv'), 'w').write('email,id,at\ndee@example.com,abc,2026-10-15T11:40:00\n')

SENT = []
M.send_batch = lambda key, msgs: (SENT.extend(msgs), {'data': [{'id': 'x'}] * len(msgs)})[1]
M.resend_key = lambda: 'resend-fake'
M.time.sleep = lambda s: None
def run(argv, unsub=frozenset({'bea@example.com'}), secret='', preflight=(True, 'ok')):
    os.environ['GFLAM_UNSUB_SECRET'] = secret
    U.unsubscribed_emails = (lambda **k: set(unsub)) if not isinstance(unsub, Exception) else (lambda **k: (_ for _ in ()).throw(unsub))
    U.preflight = lambda *a, **k: preflight
    out = io.StringIO(); code = 0
    with contextlib.redirect_stdout(out):
        try: M.main(argv + ['--dir', tmp])
        except SystemExit as e: code = e.code; print(e.code)
    return out.getvalue(), code

out, _ = run([src])
ok('dry run: the unsubscribed address is skipped and named', 'skipped, unsubscribed: bea@example.com' in out and '1 to send' in out, out.splitlines()[0])
ok('dry run: suppress.txt and sent.csv still skip (first field of sent.csv)', '2 in suppress.txt or already sent' in out)
ok('dry run: prints the List-Unsubscribe header with https and mailto',
   'List-Unsubscribe: <https://touring-api.dean-tindale.workers.dev/unsubscribe?e=ann%40example.com&t=' in out and '<mailto:hello@gflamtouring.com.au?subject=unsubscribe>' in out)
ok('dry run: prints List-Unsubscribe-Post', 'List-Unsubscribe-Post: List-Unsubscribe=One-Click' in out)
ok('dry run sends nothing', not SENT)

# 6. A real send: refused without the secret, refused on a failed preflight, refused when
#    the list cannot be read; and when it does send, every email carries the link and headers.
out, code = run([src, '--go'], secret='')
ok('--go with no secret sends nothing', not SENT and 'GFLAM_UNSUB_SECRET' in str(code))
out, code = run([src, '--go'], secret=KEY, preflight=(False, 'touring-api refused'))
ok('--go with a failed preflight sends nothing', not SENT and 'preflight failed' in str(code))
out, code = run([src, '--go'], secret=KEY, unsub=RuntimeError('db down'))
ok('--go when the unsubscribed list cannot be read sends nothing', not SENT and 'Could not read' in str(code))
out, code = run([src, '--go'], secret=KEY)
to = [m['to'][0] for m in SENT]
ok('--go sends only to the one address left', to == ['ann@example.com'], to)
m = SENT[0] if SENT else {'headers': {}, 'html': '', 'text': ''}
link = U.link('ann@example.com', M.CAMPAIGN, KEY)
ok('the sent email carries both headers', m['headers'].get('List-Unsubscribe', '').startswith('<' + link + '>') and m['headers'].get('List-Unsubscribe-Post') == 'List-Unsubscribe=One-Click')
ok('the HTML footer links to the one-click page', link.replace('&', '&amp;') in m['html'] and 'Unsubscribe in one click' in m['html'])
ok('the text footer carries the link', link in m['text'])
ok('no em dash in the email', '—' not in m['html'] + m['text'])

print('%s%d of %d checks passed' % ('FAILED: ' if failed else '', passed, passed + failed))
sys.exit(1 if failed else 0)
