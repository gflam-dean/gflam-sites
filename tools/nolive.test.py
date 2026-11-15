#!/usr/bin/env python3
"""A TEST BROWSER NEVER REACHES PRODUCTION: the block in tools/nolive.py, without a Chrome (16 Nov 2026).

  every production host and subdomain (venueplay, partyplay, the workers.dev account, the live database)
  is sent to the trap by the Chrome switch, and nothing else is (localhost, fonts, look-alike domains)
  the trap learns the host from a real TLS hello and from a plain http Host line
  a process whose browser reached the trap ends with "FAIL the test browser tried to reach production:
  <url> (<suite>)" and exit 1, even when the suite itself exited 0
  an allowed URL (with a reason) is a note, not a FAIL; an allow with no reason is refused
  a URL that never connected (a suite answered it itself) is not an attempt
  verify-live's Browser starts every test Chrome with the switch, a live=True one without it, and refuses
  a switch that would get round it (its own resolver rules, a proxy); its debug socket hands every
  Network event to the block, and every tab it attaches gets Network events on
  the deliberately live tools (live-join-own-domain.py, measure-reconnect-in-chrome.py) are the only
  live=True Browsers

    python3 tools/nolive.test.py

GATELIB_NO_CHROME: it loads verify-live.py with Chrome replaced by a stub; no browser is started.
"""
import fnmatch, importlib.util, io, json, os, re, socket, ssl, struct, subprocess, sys, textwrap, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import nolive  # noqa: E402

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond:
        bad += 1


def mapped(host, rules):
    """Where Chrome's --host-resolver-rules would send `host` (first MAP that matches), or None."""
    for r in rules.split('=', 1)[1].split(','):
        parts = r.split()
        if len(parts) == 3 and parts[0] == 'MAP' and fnmatch.fnmatchcase(host, parts[1]):
            return parts[2]
    return None


print('the hosts')
rules = nolive.chrome_args()[0]
port = nolive.trap_port()
trap = '127.0.0.1:%d' % port
LIVE = ['venueplay.com.au', 'www.venueplay.com.au', 'game.venueplay.com.au', 'api.venueplay.com.au', 'send.venueplay.com.au',
        'help.venueplay.com.au', 'game-staging.venueplay.com.au', 'partyplay.com.au', 'api.partyplay.com.au', 'www.partyplay.com.au',
        'getvenueplay.com.au', 'getpartyplay.com.au', 'venueplay-game.dean-tindale.workers.dev',
        'venueplay-api.dean-tindale.workers.dev', 'partyplay-api.dean-tindale.workers.dev', 'ijkzgmdtwtgfkedqspxm.supabase.co']
miss = [h for h in LIVE if mapped(h, rules) != trap or not nolive.is_production(h)]
ok('every production host and subdomain (%d of them, the live database too) goes to the trap' % len(LIVE), not miss, miss)
NOT = ['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'cdn.jsdelivr.net', 'xvenueplay.com.au',
       'venueplay.com.au.example.org', 'gstatic.com', 'example.supabase.co']
wrong = [h for h in NOT if mapped(h, rules) or nolive.is_production(h)]
ok('nothing else does: localhost, fonts, a CDN, look-alike domains, another database', not wrong, wrong)
ok('a URL\'s host is read past user, port, path and query',
   [nolive.host_of(u) for u in ('wss://game.venueplay.com.au/room/ws?x=1', 'https://a@API.venueplay.com.au:443/x', 'http://127.0.0.1:5/p')]
   == ['game.venueplay.com.au', 'api.venueplay.com.au', '127.0.0.1'])


print('the trap')
def hello(host):
    c = socket.create_connection(('127.0.0.1', port), timeout=5)
    try:
        ssl.create_default_context().wrap_socket(c, server_hostname=host)
    except Exception:
        pass
    finally:
        c.close()

def wait_hit(host, secs=5):
    end = time.time() + secs
    while time.time() < end:
        if nolive._HITS.get(host):
            return True
        time.sleep(0.05)
    return False

hello('game.venueplay.com.au')
ok('a real TLS hello for game.venueplay.com.au is caught by name and hung up on', wait_hit('game.venueplay.com.au'), nolive._HITS)
c = socket.create_connection(('127.0.0.1', port), timeout=5)
c.sendall(b'GET /health HTTP/1.1\r\nHost: api.partyplay.com.au\r\n\r\n')
closed = c.recv(10) == b''
c.close()
ok('a plain http request for api.partyplay.com.au is caught by its Host line and gets no answer',
   wait_hit('api.partyplay.com.au') and closed, (nolive._HITS, closed))
ok('the hello reader finds no name in rubbish', nolive.sni(b'\x16\x03\x01\x00') is None and nolive.sni(b'') is None)


print('the verdict')
CHILD = textwrap.dedent('''
    import socket, ssl, sys, time
    sys.path.insert(0, %r)
    import nolive
    nolive._SUITE[0] = 'tools/child.test.py'
    port = nolive.trap_port()
    mode = sys.argv[1]
    if mode == 'allow':
        nolive.allow('wss://game.venueplay.com.au/room/', 'this child tries on purpose')
    if mode == 'noreason':
        try:
            nolive.allow('wss://game.venueplay.com.au/room/', '  ')
            print('ALLOWED WITHOUT A REASON')
        except ValueError:
            print('refused')
    if mode == 'answered':
        nolive.note_event({'method': 'Network.requestWillBeSent', 'params': {'request': {'url': 'https://venueplay.com.au/app/x.js'}}})
        sys.exit(0)
    if mode != 'none':
        nolive.note_event({'method': 'Network.webSocketCreated', 'params': {'url': 'wss://game.venueplay.com.au/room/ws?room=AB'}})
        nolive.note_event({'method': 'Network.requestWillBeSent', 'params': {'request': {'url': 'http://127.0.0.1:9/ok'}}})
        c = socket.create_connection(('127.0.0.1', port))
        try:
            ssl.create_default_context().wrap_socket(c, server_hostname='game.venueplay.com.au')
        except Exception:
            pass
        if mode == 'hostonly':
            c2 = socket.create_connection(('127.0.0.1', port))
            try:
                ssl.create_default_context().wrap_socket(c2, server_hostname='ijkzgmdtwtgfkedqspxm.supabase.co')
            except Exception:
                pass
        time.sleep(0.5)
    print('ALL 1 CHECKS PASSED')
    sys.exit(0)
''') % os.path.join(ROOT, 'tools')

def child(mode):
    p = subprocess.run([sys.executable, '-c', CHILD, mode], capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout.strip().splitlines()

rc, out = child('fail')
want = 'FAIL the test browser tried to reach production: wss://game.venueplay.com.au/room/ws?room=AB (tools/child.test.py)'
ok('a suite whose browser reached production exits 1 (it exited 0 itself) and its LAST line names the URL and the suite',
   rc == 1 and out and out[-1] == want, (rc, out))
ok('a local request beside it is not named', not any('127.0.0.1' in l for l in out), out)
rc, out = child('hostonly')
ok('a host reached with no URL seen (a worker, a preconnect) is still a FAIL, by host',
   rc == 1 and any(l.startswith('FAIL the test browser tried to reach production: https://ijkzgmdtwtgfkedqspxm.supabase.co/') for l in out), (rc, out))
rc, out = child('allow')
ok('an allowed URL prefix with a reason is not a FAIL, and the suite keeps its exit 0 and its own last line',
   rc == 0 and out == ['ALL 1 CHECKS PASSED'], (rc, out))
rc, out = child('noreason')
ok('an allow with no reason is refused', 'refused' in out, out)
rc, out = child('none')
ok('a suite that never tried exits as it would have, with no extra line', rc == 0 and out == ['ALL 1 CHECKS PASSED'], (rc, out))
rc, out = child('answered')
ok('a production URL that never connected (the suite answered it itself) is not an attempt', rc == 0 and not any('FAIL' in l for l in out), (rc, out))


print('verify-live\'s Browser')
spec = importlib.util.spec_from_file_location('vl_under_test', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(spec)
spec.loader.exec_module(VL)

class Started(Exception):
    pass
seen = []
def fake_popen(args, **kw):
    seen.append(list(args))
    raise Started()
VL.CHROME = sys.executable
VL.subprocess.Popen = fake_popen

def started(**kw):
    del seen[:]
    try:
        VL.Browser(**kw)
    except Started:
        pass
    except SystemExit as e:
        return 'refused: %s' % e
    return seen[0] if seen else None

a = started()
guard = [x for x in (a or []) if x.startswith('--host-resolver-rules=')]
ok('a test Browser starts Chrome with the switch that sends production to this process\'s trap',
   len(guard) == 1 and mapped('game.venueplay.com.au', guard[0]) == '127.0.0.1:%d' % port, a)
a = started(extra_args=['--autoplay-policy=no-user-gesture-required'])
ok('a suite\'s own extra switches keep it', a and any(x.startswith('--host-resolver-rules=') for x in a), a)
a = started(live=True)
ok('a live=True Browser starts Chrome without it', a and not any(x.startswith('--host-resolver-rules') for x in a), a)
for sw in ('--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:1'):
    r = started(extra_args=[sw])
    ok('a test Browser refuses %s (it would get round the block)' % sw.split('=')[0], isinstance(r, str) and r.startswith('refused: FAIL'), r)

def frame(obj):
    p = json.dumps(obj).encode()
    return bytes([0x81, 126]) + struct.pack('>H', len(p)) + p if len(p) >= 126 else bytes([0x81, len(p)]) + p

nolive._URLS.clear()
ws = VL.WS.__new__(VL.WS)
ws.s = None
ws.buf = frame({'method': 'Network.requestWillBeSent', 'sessionId': 's', 'params': {'request': {'url': 'https://api.venueplay.com.au/billing/me'}}})
m = ws.recv()
ok('the debug socket hands every Network event to the block, and still returns it',
   m.get('method') == 'Network.requestWillBeSent' and nolive._URLS.get('api.venueplay.com.au') == ['https://api.venueplay.com.au/billing/me'], (m, nolive._URLS))

class FakeWS(object):
    def __init__(self):
        self.sent, self.q = [], []
    def send(self, msg):
        self.sent.append(msg)
        if msg['method'] == 'Target.attachToTarget':
            self.q.append({'id': msg['id'], 'result': {'sessionId': 'S1'}})
        else:
            self.q.append({'id': msg['id'], 'result': {}})
    def recv(self):
        return self.q.pop(0)

for live in (False, True):
    b = VL.Browser.__new__(VL.Browser)
    b.live, b.n, b.ws = live, 0, FakeWS()
    sid = b.call('Target.attachToTarget', {'targetId': 'T', 'flatten': True})['sessionId']
    net = [x for x in b.ws.sent if x['method'] == 'Network.enable' and x.get('sessionId') == 'S1']
    if not live:
        ok('every tab a test Browser attaches gets Network events on, so the block knows the full URL', sid == 'S1' and len(net) == 1, b.ws.sent)
    else:
        ok('a live Browser\'s tabs are left as they were', sid == 'S1' and not net, b.ws.sent)


print('the live tools')
src = {f: io.open(os.path.join(ROOT, 'tools', f), encoding='utf-8').read() for f in os.listdir(os.path.join(ROOT, 'tools')) if f.endswith('.py')}
src.update({'browser-rig/' + f: io.open(os.path.join(ROOT, 'tools', 'browser-rig', f), encoding='utf-8').read()
            for f in os.listdir(os.path.join(ROOT, 'tools', 'browser-rig')) if f.endswith('.py')})
LIVE_RE = re.compile(r'Browser\(\s*live\s*=\s*True|^\s*LIVE\s*=\s*True', re.M)
live_users = sorted(f for f, s in src.items() if LIVE_RE.search(s) and f not in ('nolive.test.py', 'nolive.py'))
ok('the only live Browsers are verify-live\'s own run, live-join-own-domain.py and measure-reconnect-in-chrome.py',
   live_users == ['live-join-own-domain.py', 'measure-reconnect-in-chrome.py', 'verify-live.py'], live_users)

with nolive._LOCK:
    nolive._HITS.clear()     # this process knocked on the trap on purpose, above
print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
