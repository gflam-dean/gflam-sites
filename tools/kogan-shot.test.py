#!/usr/bin/env python3
"""KOGAN-SHOT, WHOLE PATH OFFLINE (INBOX 364 blocker 3, 13 Nov 2026). The TV is never touched.

A fake `sdb` script stands in for the Tizen bridge (connect, devices, shell 0 applist / 0 debug, forward) and a fake
DevTools server (a small stdlib websocket server) answers /json and Page.captureScreenshot with a canned PNG. The
tool runs as a real subprocess, so exit codes and messages are what main would see.

Run: python3 tools/kogan-shot.py is exercised by:  python3 tools/kogan-shot.test.py      Ends on "ALL N CHECKS PASSED".
"""
import base64, hashlib, json, os, socket, stat, struct, subprocess, sys, tempfile, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, 'tools', 'kogan-shot.py')
RAN, BAD = [0], [0]
TMP = tempfile.mkdtemp(prefix='kogan-shot-test-')


def show(name, cond, saw=None):
    RAN[0] += 1
    if cond:
        print('  ok   ' + name)
    else:
        BAD[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: %s' % (str(saw)[:400],)))


# a real, tiny PNG padded past 64 KB (so the 8-byte websocket length path is used)
PNG = b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + struct.pack('>II', 1920, 1080) + os.urandom(70000)

FAKE_SDB = r'''#!/usr/bin/env python3
import os, sys
a = sys.argv[1:]
open(os.environ['KS_LOG'], 'a').write(' '.join(a) + '\n')
sc = os.environ.get('KS_SCEN', 'ok')
if len(a) > 2 and a[0] == '-s':
    a = a[2:]
if a[0] == 'connect':
    print('failed to connect to ' + a[1] if sc == 'noconnect' else 'connected to ' + a[1]); sys.exit(0)
if a[0] == 'devices':
    st = 'offline' if sc == 'offline' else 'device'
    print('List of devices attached\n127.0.0.1:26101\t%s\tKogan' % st if sc != 'nodevice' else 'List of devices attached'); sys.exit(0)
if a[:3] == ['shell', '0', 'applist']:
    if sc == 'nolist':
        print('closed'); sys.exit(1)
    apps = 'ApplicationID Name\nabc.Settings Settings\nxyz.Netflix Netflix\n'
    if sc != 'notinstalled':
        apps += 'VenuePlyTV.venueplayTV venueplay\n'
    print(apps); sys.exit(0)
if a[:3] == ['shell', '0', 'debug']:
    if sc == 'noport':
        print('launch app failed'); sys.exit(0)
    if sc == 'nolist-notinstalled':
        print('Error: app is not installed'); sys.exit(0)
    print('... successfully launched pid = 12915 with debug 1 port: ' + os.environ['KS_PORT']); sys.exit(0)
if a[0] == 'forward':
    if sc == 'noforward' and a[1] != '--remove':
        print('error: cannot bind'); sys.exit(1)
    sys.exit(0)
sys.exit(1)
'''

FAKE_CHROME = r'''#!/usr/bin/env python3
import os, sys
a = sys.argv[1:]
open(os.environ['KS_LOG'], 'a').write('CHROME ' + ' '.join(a) + '\n')
for x in a:
    if x.startswith('--screenshot='):
        open(x.split('=', 1)[1], 'wb').write(b'\x89PNG\r\n\x1a\nfake')
'''


def write_exe(name, body):
    p = os.path.join(TMP, name)
    open(p, 'w').write(body)
    os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
    return p


SDB = write_exe('sdb', FAKE_SDB)
CHROME = write_exe('chrome', FAKE_CHROME)
LOG = os.path.join(TMP, 'log.txt')


# ---------------------------------------------------------------- fake DevTools
class Fake:
    def __init__(self, mode='ok', port=0):
        self.mode = mode
        self.srv = socket.socket(); self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); self.srv.bind(('127.0.0.1', port)); self.srv.listen(5)
        self.port = self.srv.getsockname()[1]
        self.calls = []
        threading.Thread(target=self.loop, daemon=True).start()

    def close(self):
        self.srv.close()

    def loop(self):
        while True:
            try:
                c, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self.serve, args=(c,), daemon=True).start()

    def serve(self, c):
        buf = b''
        while b'\r\n\r\n' not in buf:
            d = c.recv(4096)
            if not d:
                return
            buf += d
        head = buf.decode('latin1')
        line = head.split('\r\n')[0]
        if line.startswith('GET /json'):
            pages = [] if self.mode == 'nopages' else [{'type': 'page', 'title': 'venueplay tv', 'url': 'https://venueplay.com.au/tv',
                     'webSocketDebuggerUrl': 'ws://10.9.9.9:%d/devtools/page/1' % self.port}]
            body = json.dumps(pages).encode()
            c.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n' % len(body) + body)
            c.close(); return
        key = [l.split(': ', 1)[1] for l in head.split('\r\n') if l.lower().startswith('sec-websocket-key')][0]
        acc = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        c.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n' % acc).encode())
        rest = buf.split(b'\r\n\r\n', 1)[1]
        try:
            while True:
                def need(n):
                    nonlocal rest
                    while len(rest) < n:
                        d = c.recv(65536)
                        if not d:
                            raise EOFError
                        rest += d
                    o, rest = rest[:n], rest[n:]
                    return o
                b1, b2 = need(2)
                n = b2 & 0x7f
                if n == 126: n = struct.unpack('>H', need(2))[0]
                elif n == 127: n = struct.unpack('>Q', need(8))[0]
                mask = need(4)
                msg = json.loads(bytes(x ^ mask[i % 4] for i, x in enumerate(need(n))))
                self.calls.append(msg['method'])
                if msg['method'] == 'Page.captureScreenshot':
                    data = base64.b64encode(PNG if self.mode != 'badpng' else b'not a png at all').decode()
                    res = {'data': data}
                elif msg['method'] == 'Runtime.evaluate':
                    res = {'result': {'type': 'string', 'value': 'ANSWER:' + msg['params']['expression']}}
                else:
                    res = {}
                out = json.dumps({'id': msg['id'], 'result': res}).encode()
                ln = len(out)
                hdr = b'\x81' + (bytes([ln]) if ln < 126 else b'\x7e' + struct.pack('>H', ln) if ln < 65536 else b'\x7f' + struct.pack('>Q', ln))
                c.sendall(hdr + out)
        except Exception:
            c.close()


def run(args, scen='ok', fake=None, extra_env=None):
    open(LOG, 'w').close()
    env = dict(os.environ, KS_LOG=LOG, KS_SCEN=scen, KS_PORT=str(fake.port if fake else 1), KOGAN_SDB=SDB, KOGAN_CHROME=CHROME)
    env.pop('KOGAN_TV', None)
    env.update(extra_env or {})
    r = subprocess.run([sys.executable, TOOL, '--tv', '127.0.0.1:26101'] + args, capture_output=True, text=True, env=env, timeout=120)
    return r.returncode, r.stdout, r.stderr, open(LOG).read()


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


LP = free_port()   # the fake sdb forward does nothing, so the fake DevTools sits on the forwarded port itself
OUT = os.path.join(TMP, 'shot.png')

# 1 probe ok, launches nothing
f = Fake(port=LP)
rc, so, se, lg = run(['--probe', '--local-port', str(LP)], fake=f)
show('probe: exit 0 and says nothing was launched', rc == 0 and 'nothing was launched' in so, (rc, so, se))
show('probe: never calls debug or forward', 'debug' not in lg.replace('devices', '') and 'forward' not in lg and 'shell 0 debug' not in lg, lg)
show('probe: prints each step (connect, devices, app list)', '[1] sdb connect' in so and '[2] sdb devices' in so and '[3] app list' in so, so)

# 2 probe with the TV unreachable
rc, so, se, lg = run(['--probe'], scen='noconnect')
show('cannot connect: exit 3', rc == 3, (rc, se))
show('cannot connect: hint names Host PC IP, 12345 and Developer mode', 'Host PC IP' in se and '12345' in se and 'Developer mode' in se, se)
rc, so, se, lg = run(['--probe'], scen='offline')
show('device listed offline: exit 3', rc == 3, (rc, se))
rc, so, se, lg = run(['--probe'], scen='nodevice')
show('device not listed at all: exit 3', rc == 3, (rc, se))
rc, so, se, lg = run(['--probe', '--sdb', os.path.join(TMP, 'nope')])
show('sdb binary missing: exit 3 and says where it looked', rc == 3 and 'nope' in se, (rc, se))

# 3 the full path
rc, so, se, lg = run(['--out', OUT, '--local-port', str(LP), '--eval', 'document.title'], fake=f)
show('full run: exit 0', rc == 0, (rc, so, se))
show('full run: the PNG written is byte-for-byte what the inspector sent', os.path.exists(OUT) and open(OUT, 'rb').read() == PNG)
show('full run: page ws address on the TV\'s own IP is rewritten to the forward', 'Page.captureScreenshot' in f.calls)
show('full run: forward made to the debug port then removed afterwards',
     ('forward tcp:%d tcp:%d' % (LP, f.port)) in lg and lg.strip().splitlines()[-1].endswith('forward --remove tcp:%d' % LP), lg)
show('full run: says it is the REAL Kogan', 'REAL Kogan' in so, so)
show('full run: --eval answer printed', 'ANSWER:document.title' in so and 'Runtime.evaluate' in f.calls, so)

# 4 method 2
rc, so, se, lg = run(['--out', OUT, '--direct'], fake=f)
show('--direct: exit 0 with no sdb forward at all', rc == 0 and 'forward' not in lg, (rc, se, lg))

# 5 failures
rc, so, se, lg = run(['--out', OUT, '--local-port', str(LP)], scen='noport', fake=f)
show('no debug port from the TV: exit 4', rc == 4 and 'debug port not available' in se, (rc, se))
rc, so, se, lg = run(['--out', OUT, '--local-port', str(LP)], scen='noforward', fake=f)
show('forward refused: exit 4', rc == 4, (rc, se))
rc, so, se, lg = run(['--out', OUT, '--local-port', str(LP)], scen='notinstalled', fake=f)
show('app not in the app list: exit 5 and nothing launched', rc == 5 and 'shell 0 debug' not in lg, (rc, se, lg))
rc, so, se, lg = run(['--out', OUT, '--local-port', str(LP)], scen='nolist-notinstalled', fake=f)
show('no app list, debug says not installed: exit 5', rc == 5, (rc, se))
f.close(); fn = Fake('nopages', LP)
rc, so, se, lg = run(['--out', OUT, '--local-port', str(LP)], fake=fn)
show('inspector lists no page: exit 4', rc == 4, (rc, se))
fn.close(); fb = Fake('badpng', LP)
os.path.exists(OUT) and os.remove(OUT)
rc, so, se, lg = run(['--out', OUT, '--local-port', str(LP)], fake=fb)
show('inspector answers with junk: exit 6, no file, forward still removed',
     rc == 6 and not os.path.exists(OUT) and lg.strip().splitlines()[-1].endswith('forward --remove tcp:%d' % LP), (rc, se, lg))
rc, so, se, lg = run([])
show('no --out and no --probe: exit 2', rc == 2, (rc, se))

# 6 Chrome fallback
fo = os.path.join(TMP, 'fb.png')
rc, so, se, lg = run(['--fallback-chrome', '--out', fo, '--fallback-url', 'http://127.0.0.1:1/tv'])
show('fallback: exit 0, PNG written', rc == 0 and open(fo, 'rb').read(4) == b'\x89PNG', (rc, se))
show('fallback: says clearly it is NOT the Kogan, no sdb used', 'It is NOT the Kogan TV' in so and 'FALLBACK' in so and 'connect' not in lg, (so, lg))
show('fallback: renders at 1920x1080', '--window-size=1920,1080' in lg and 'http://127.0.0.1:1/tv' in lg, lg)
rc, so, se, lg = run(['--fallback-chrome', '--out', fo, '--chrome', os.path.join(TMP, 'none')], extra_env={'KOGAN_CHROME': '', 'PATH': '/nonexistent', 'KOGAN_NO_DEFAULT_CHROME': '1'})
show('fallback with no Chrome: exit 7', rc == 7, (rc, se))

# 7 the real Chrome fallback, where there is a Chrome (the test server)
real = next((p for p in ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] if os.path.exists(p)), None)
if real and os.environ.get('KOGAN_REAL_CHROME', '1' if sys.platform != 'darwin' else '0') == '1':
    import http.server
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            b = b'<html><body style="background:#123456"><h1>tv</h1></body></html>'
            self.send_response(200); self.send_header('Content-Type', 'text/html'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
        def log_message(self, *a): pass
    hs = http.server.HTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=hs.serve_forever, daemon=True).start()
    ro = os.path.join(TMP, 'real.png')
    rc, so, se, lg = run(['--fallback-chrome', '--out', ro, '--chrome', real, '--fallback-url', 'http://127.0.0.1:%d/tv' % hs.server_port, '--wait', '2'])
    d = open(ro, 'rb').read() if os.path.exists(ro) else b''
    show('real Chrome fallback: a PNG of 1920 wide', rc == 0 and d[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>I', d[16:20])[0] == 1920, (rc, se, d[:30]))
else:
    show('real Chrome fallback: skipped, no Chrome used on this machine (runs on the test server)', True)

print()
print('ALL %d CHECKS PASSED' % RAN[0] if not BAD[0] else '%d of %d CHECKS FAILED' % (BAD[0], RAN[0]))
sys.exit(1 if BAD[0] else 0)
