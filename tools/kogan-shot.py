#!/usr/bin/env python3
"""KOGAN TV SCREENSHOT THROUGH THE TIZEN WEB INSPECTOR (INBOX 364 blocker 3, 13 Nov 2026).

    python3 tools/kogan-shot.py --probe                       connectivity only; launches NOTHING on the TV
    python3 tools/kogan-shot.py --out shot.png                start the app in debug mode, screenshot what the TV shows
    python3 tools/kogan-shot.py --out shot.png --eval "document.title"      also print a DOM value
    python3 tools/kogan-shot.py --out shot.png --direct       method 2: no sdb forward, talk to TV_IP:<debug port>
    python3 tools/kogan-shot.py --out shot.png --fallback-chrome            NOT the Kogan: headless Chrome /tv at 1920x1080

Method 1 (default): sdb connect -> sdb shell 0 debug <appid> (the TV answers with a debug port; this is the
"0" launcher command, it still works on retail TVs whose normal `sdb shell` is closed) -> sdb forward
tcp:9230 tcp:<port> -> GET http://localhost:9230/json -> Chrome DevTools Protocol Page.captureScreenshot over the
page's webSocketDebuggerUrl -> remove the forward.
Method 2 (--direct): same, but the TV's debug port is opened straight at http://<TV ip>:<port> with no sdb forward
(some firmware exposes it on the LAN, and it is the one that survives a broken forward).

Exit codes: 0 ok | 2 bad usage | 3 sdb cannot connect | 4 debug port not available | 5 app not installed |
6 the inspector answered but the screenshot failed | 7 the Chrome fallback failed.
Nothing here installs, uninstalls or changes anything on the TV. --probe starts nothing.
"""
import argparse, base64, json, os, re, socket, struct, subprocess, sys, time, urllib.request

DEFAULT_TV = '192.168.68.58:26101'
DEFAULT_APP = 'VenuePlyTV.venueplayTV'
DEFAULT_SDB = os.path.expanduser('~/tizen-studio/tools/sdb')
DEFAULT_FALLBACK_URL = 'https://venueplay.com.au/tv'
PNG = b'\x89PNG\r\n\x1a\n'


class Fail(Exception):
    def __init__(self, code, msg):
        Exception.__init__(self, msg)
        self.code, self.msg = code, msg


def say(msg):
    print(msg, flush=True)


def mac_ip():
    """The address the Mac uses on the LAN (a UDP connect sends nothing)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.168.68.58', 9))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return 'unknown'


# ---------------------------------------------------------------- sdb
def sdb(a, *args, timeout=20):
    cmd = [a.sdb] + list(args)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise Fail(3, 'sdb not found at %s (set --sdb or KOGAN_SDB). Tizen Studio installs it at ~/tizen-studio/tools/sdb.' % a.sdb)
    except subprocess.TimeoutExpired:
        return 124, 'timed out after %ss' % timeout
    return r.returncode, ((r.stdout or '') + (r.stderr or '')).strip()


def connect_hint(a):
    return ('sdb cannot connect to %s. One-time fix on the TV: Apps screen, type 12345, Developer mode ON, '
            'Host PC IP = this Mac\'s address (now %s; the TV may still hold the old 192.168.68.57), then restart the TV. '
            'Also check the TV is on and its address is still %s.' % (a.tv, mac_ip(), a.tv.split(':')[0]))


def step_connect(a):
    rc, out = sdb(a, 'connect', a.tv)
    say('[1] sdb connect %s -> %s' % (a.tv, out or '(no output)'))
    if re.search(r'fail|cannot|unable|refused|timed out|error', out, re.I) or (rc not in (0,) and 'connected' not in out):
        raise Fail(3, connect_hint(a))
    rc, out = sdb(a, 'devices')
    say('[2] sdb devices -> ' + out.replace('\n', ' | '))
    line = [l for l in out.splitlines() if a.tv.split(':')[0] in l]
    if not line:
        raise Fail(3, connect_hint(a))
    if re.search(r'offline|unauthorized', line[0], re.I):
        raise Fail(3, 'the TV is listed but %s. %s' % (line[0].split()[-1] if line[0].split() else 'not usable', connect_hint(a)))


def step_installed(a, strict):
    rc, out = sdb(a, '-s', a.tv, 'shell', '0', 'applist')
    short = out.replace('\n', ' | ')[:300]
    if a.app_id in out:
        say('[3] app list -> %s is installed' % a.app_id)
        return True
    if rc == 0 and re.search(r'\bapp\b|\bid\b|\.', out) and len(out.splitlines()) > 2:
        say('[3] app list -> %s is NOT in the %d apps listed' % (a.app_id, len(out.splitlines())))
        if strict:
            raise Fail(5, 'app %s is not installed on the TV. Install it (main does this): tizen install -n ~/venueplay-tv-apps/dist/venueplayTV-1.0.3.wgt -s %s' % (a.app_id, a.tv))
        return False
    say('[3] app list -> not available on this TV (%s); the debug launch below will say if the app is missing' % (short or 'no answer'))
    return None


def parse_port(out):
    m = re.search(r'port\s*[:=]?\s*(\d{4,5})', out, re.I)
    if m:
        return int(m.group(1))
    m = re.findall(r'\b(\d{4,5})\b', out)
    return int(m[-1]) if m else None


def step_debug(a):
    rc, out = sdb(a, '-s', a.tv, 'shell', '0', 'debug', a.app_id, timeout=40)
    say('[4] sdb shell 0 debug %s -> %s' % (a.app_id, out.replace('\n', ' | ')[:300] or '(no output)'))
    if re.search(r'not (installed|found|exist)|no such (app|package)|invalid (app|package)|unknown app|could not find', out, re.I):
        raise Fail(5, 'app %s is not installed on the TV (%s)' % (a.app_id, out[:120]))
    port = parse_port(out)
    if not port:
        raise Fail(4, 'debug port not available: the TV did not return one (%s). Try --direct, or relaunch the TV in Developer mode; '
                      'method 2 in the README: Tizen Studio, Run as, Debug.' % (out[:120] or 'no output'))
    say('    debug port on the TV: %d' % port)
    return port


def forward_add(a, port):
    sdb(a, '-s', a.tv, 'forward', '--remove', 'tcp:%d' % a.local_port)   # a stale one from an earlier run
    rc, out = sdb(a, '-s', a.tv, 'forward', 'tcp:%d' % a.local_port, 'tcp:%d' % port)
    say('[5] sdb forward tcp:%d tcp:%d -> %s' % (a.local_port, port, out or 'ok'))
    if rc != 0 or re.search(r'fail|error|cannot', out, re.I):
        raise Fail(4, 'debug port not available: sdb forward refused (%s). Try --direct.' % out[:120])


def forward_remove(a):
    sdb(a, '-s', a.tv, 'forward', '--remove', 'tcp:%d' % a.local_port)
    say('[cleanup] removed forward tcp:%d' % a.local_port)


# ---------------------------------------------------------------- DevTools
def get_json(base, tries=8):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(base + '/json', timeout=5) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except Exception as e:
            last = e
            time.sleep(0.5)
    raise Fail(4, 'debug port not available: %s/json did not answer (%s)' % (base, last))


def pick_page(pages, hostport):
    pages = [p for p in pages if p.get('webSocketDebuggerUrl')]
    if not pages:
        raise Fail(4, 'debug port not available: /json lists no page with a webSocketDebuggerUrl')
    pages.sort(key=lambda p: (p.get('type') != 'page', 'venueplay' not in (p.get('url', '') + p.get('title', '')).lower()))
    p = pages[0]
    ws = re.sub(r'^(wss?://)[^/]+', r'\g<1>' + hostport, p['webSocketDebuggerUrl'])   # the page may name the TV's own address
    return ws, p


class WS:
    """The little of RFC 6455 a DevTools client needs."""
    def __init__(self, url, timeout=30):
        m = re.match(r'ws://([^/:]+)(?::(\d+))?(/.*)?$', url)
        if not m:
            raise Fail(6, 'bad websocket url %s' % url)
        host, port, path = m.group(1), int(m.group(2) or 80), m.group(3) or '/'
        self.s = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, host, port, key)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = self.s.recv(4096)
            if not c:
                raise Fail(6, 'inspector closed the connection during the websocket handshake')
            buf += c
        head, self.buf = buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0] + b' ':
            raise Fail(6, 'inspector refused the websocket: %s' % head.split(b'\r\n')[0].decode('latin1'))
        self.id = 0

    def _need(self, n):
        while len(self.buf) < n:
            c = self.s.recv(65536)
            if not c:
                raise Fail(6, 'inspector closed the connection mid-answer')
            self.buf += c
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        hdr = b'\x81' + (bytes([0x80 | n]) if n < 126 else b'\xfe' + struct.pack('>H', n) if n < 65536 else b'\xff' + struct.pack('>Q', n))
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b''
        while True:
            b1, b2 = self._need(2)
            n = b2 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._need(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._need(8))[0]
            if b2 & 0x80:
                self._need(4)
            payload = self._need(n)
            op = b1 & 0x0f
            if op == 8:
                raise Fail(6, 'inspector closed the websocket')
            if op in (9, 10):
                continue
            msg += payload
            if b1 & 0x80:
                return msg.decode('utf-8', 'replace')

    def call(self, method, params=None):
        self.id += 1
        self.send(json.dumps({'id': self.id, 'method': method, 'params': params or {}}))
        while True:
            r = json.loads(self.recv())
            if r.get('id') == self.id:
                if 'error' in r:
                    raise Fail(6, 'inspector error on %s: %s' % (method, r['error']))
                return r.get('result', {})

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass


def capture(a, base, hostport):
    pages = get_json(base)
    ws_url, page = pick_page(pages, hostport)
    say('[6] page: %s  %s' % (page.get('title', ''), page.get('url', '')))
    ws = WS(ws_url, timeout=a.timeout)
    try:
        r = ws.call('Page.captureScreenshot', {'format': 'png'})
        data = base64.b64decode(r.get('data', ''))
        if not data.startswith(PNG):
            raise Fail(6, 'the inspector returned something that is not a PNG (%d bytes)' % len(data))
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, 'wb') as f:
            f.write(data)
        say('[7] screenshot saved: %s (%d bytes) -- this is the REAL Kogan TV app' % (a.out, len(data)))
        for expr in a.eval or []:
            v = ws.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True})
            val = v.get('result', {}).get('value', v.get('result', {}).get('description'))
            say('[eval] %s -> %s' % (expr, json.dumps(val)))
    finally:
        ws.close()


# ---------------------------------------------------------------- Chrome fallback
def find_chrome(a):
    cands = [a.chrome, os.environ.get('KOGAN_CHROME')]
    if not os.environ.get('KOGAN_NO_DEFAULT_CHROME'):
        cands += ['google-chrome', 'chromium', 'chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    for c in cands:
        if not c:
            continue
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
        for d in os.environ.get('PATH', '').split(os.pathsep):
            p = os.path.join(d, c)
            if os.path.isfile(p) and os.access(p, os.X_OK):
                return p
    return None


def fallback(a):
    say('FALLBACK: this is headless Chrome rendering %s at 1920x1080. It is NOT the Kogan TV and says nothing about the Tizen app shell.' % a.fallback_url)
    chrome = find_chrome(a)
    if not chrome:
        raise Fail(7, 'no Chrome found for the fallback (set --chrome or KOGAN_CHROME). Run it on the test server.')
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    cmd = [chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080',
           '--virtual-time-budget=%d' % (a.wait * 1000), '--screenshot=' + os.path.abspath(a.out), a.fallback_url]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except Exception as e:
        raise Fail(7, 'Chrome fallback failed: %s' % e)
    if not os.path.isfile(a.out) or not open(a.out, 'rb').read(8).startswith(PNG):
        raise Fail(7, 'Chrome fallback made no PNG')
    say('FALLBACK screenshot saved: %s (NOT the Kogan)' % a.out)


# ---------------------------------------------------------------- main
def run(a):
    if a.fallback_chrome:
        if not a.out:
            raise Fail(2, '--out is required')
        return fallback(a)
    if not a.probe and not a.out:
        raise Fail(2, '--out <png> is required (or use --probe)')
    step_connect(a)
    if a.probe:
        step_installed(a, strict=False)
        say('[probe] connectivity looks fine; nothing was launched. Next: run without --probe to take the shot.')
        return
    step_installed(a, strict=True)
    port = step_debug(a)
    if a.direct:
        host = a.tv.split(':')[0]
        capture(a, 'http://%s:%d' % (host, port), '%s:%d' % (host, port))
        return
    forward_add(a, port)
    try:
        capture(a, 'http://localhost:%d' % a.local_port, 'localhost:%d' % a.local_port)
    finally:
        forward_remove(a)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[1], add_help=True)
    p.add_argument('--out', help='PNG to write')
    p.add_argument('--app-id', default=DEFAULT_APP)
    p.add_argument('--tv', default=os.environ.get('KOGAN_TV', DEFAULT_TV), help='TV ip:26101')
    p.add_argument('--sdb', default=os.environ.get('KOGAN_SDB', DEFAULT_SDB))
    p.add_argument('--local-port', type=int, default=9230)
    p.add_argument('--probe', action='store_true', help='connectivity only; launches nothing')
    p.add_argument('--direct', action='store_true', help='method 2: no sdb forward, use TV_IP:<debug port>')
    p.add_argument('--eval', action='append', help='JS to evaluate on the page after the shot (repeatable)')
    p.add_argument('--timeout', type=int, default=30)
    p.add_argument('--fallback-chrome', action='store_true')
    p.add_argument('--fallback-url', default=DEFAULT_FALLBACK_URL)
    p.add_argument('--chrome', help='Chrome binary for the fallback')
    p.add_argument('--wait', type=int, default=5, help='fallback: seconds of page time before the shot')
    a = p.parse_args(argv)
    try:
        run(a)
    except Fail as e:
        print('ERROR (exit %d): %s' % (e.code, e.msg), file=sys.stderr, flush=True)
        return e.code
    return 0


if __name__ == '__main__':
    sys.exit(main())
