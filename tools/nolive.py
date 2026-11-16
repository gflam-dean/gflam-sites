"""A TEST BROWSER NEVER REACHES PRODUCTION (16 Nov 2026).

On 16 Nov 2026 Cloudflare showed bursts of 20 to 50 requests per 5 minutes on the LIVE game Worker
(venueplay-game) coming from the test server while Chrome suites ran there, and from Brisbane when one
ran on the Mac. A connection logger on vp-tests-1 caught the suites: console-paid-and-draw-max (20
connections), logo-tools (2), room-dropout (1), demo-pairs (1). The rigs (browser-rig/rig.py,
admin_site.py) rewrite 'https://game.venueplay.com.au' to their own worker, but only in some served text
files; a script they did not rewrite, a wss:// address, or a host table built another way still called
live. Every suite was green, because live answered.

So the block is here, in the ONE place every suite's Chrome is started (verify-live.py Browser), and it
does not depend on any page being rewritten:

  1. Chrome starts with --host-resolver-rules mapping every production host (below) to a trap on
     127.0.0.1 that this process owns. Every request, from any tab, frame, worker or service worker,
     http, https or wss, connects to the trap instead. The trap reads the first bytes (the TLS hello
     names the host it wanted; plain http names it in Host:) and hangs up. Nothing leaves the machine.
  2. Every attached tab also has Network events on, so the full URL is known (verify-live.WS.recv
     hands each Network event to note_event).
  3. When the process ends, every production host that reached the trap is printed as
        FAIL the test browser tried to reach production: <url> (<suite>)
     and the exit code is 1, unless the suite allowed that URL with a reason (allow(); an allowed attempt
     prints nothing, so the suite's own last line stays last). A request a
     suite blocks itself (Network.setBlockedURLs) never connects, so it is not an attempt.

The deliberately live tools (verify-live.py's own run, live-join-own-domain.py, measure-reconnect-in-
chrome.py) start their Browser with live=True and get none of this. Nothing else should.

No Chrome here: tools/nolive.test.py proves all of it in plain Python, tools/no-live-in-chrome.test.py
proves it in a real Chrome.
"""
import atexit
import os
import socket
import sys
import threading

# Apex and every subdomain of each. 'dean-tindale.workers.dev' is the account's workers.dev subdomain
# (venueplay-game., venueplay-api., partyplay-api., touring-api.); staging hosts on venueplay.com.au
# are blocked too: a rig suite has its own local worker and api and needs neither.
PRODUCTION_HOSTS = (
    'venueplay.com.au',
    'partyplay.com.au',
    'getvenueplay.com.au',
    'getpartyplay.com.au',
    'dean-tindale.workers.dev',
    'ijkzgmdtwtgfkedqspxm.supabase.co',
)

_LOCK = threading.Lock()
_HITS = {}       # host -> how many connections reached the trap
_URLS = {}       # host -> [url, ...] seen in Network events (first 20 each)
_ALLOW = {}      # url prefix -> reason
_TRAP = [None]   # (socket, port)
_SUITE = [None]
_CLOSERS = []    # verify-live's close_all_browsers, one per loaded copy of it


def on_exit_close(fn):
    """verify-live hands over its close-every-Chrome, so the verdict comes after Chrome is down."""
    if fn not in _CLOSERS:
        _CLOSERS.append(fn)


def is_production(host):
    host = (host or '').lower().rstrip('.')
    return any(host == h or host.endswith('.' + h) for h in PRODUCTION_HOSTS)


def host_of(url):
    rest = url.split('://', 1)[1] if '://' in url else url
    hp = rest.split('/', 1)[0].split('?', 1)[0].split('#', 1)[0]
    hp = hp.rsplit('@', 1)[-1]
    return hp.split(':', 1)[0].lower()


def suite_name():
    if _SUITE[0]:
        return _SUITE[0]
    a = os.path.abspath(sys.argv[0]) if sys.argv and sys.argv[0] else ''
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.relpath(a, root) if a.startswith(root + os.sep) else (os.path.basename(a) or 'this process')


def allow(url_prefix, reason):
    """This suite may TRY to reach url_prefix (it is still stopped at the trap) without failing.
    The reason is printed with every allowed attempt, so it has to say why."""
    if not url_prefix or '://' not in url_prefix or not (reason or '').strip():
        raise ValueError('nolive.allow needs a full URL prefix and a reason, got %r, %r' % (url_prefix, reason))
    _ALLOW[url_prefix] = reason.strip()


def sni(data):
    """The server name in a TLS ClientHello, or the Host header of a plain HTTP request, or None."""
    try:
        if data[:1] == b'\x16':
            p = 5 + 4 + 2 + 32                       # record header, handshake header, version, random
            p += 1 + data[p]                          # session id
            p += 2 + int.from_bytes(data[p:p + 2], 'big')   # cipher suites
            p += 1 + data[p]                          # compression methods
            end = p + 2 + int.from_bytes(data[p:p + 2], 'big')
            p += 2
            while p + 4 <= end:
                typ, ln = int.from_bytes(data[p:p + 2], 'big'), int.from_bytes(data[p + 2:p + 4], 'big')
                if typ == 0:                          # server_name: list len(2), type(1), name len(2), name
                    n = int.from_bytes(data[p + 7:p + 9], 'big')
                    return data[p + 9:p + 9 + n].decode('ascii', 'replace').lower()
                p += 4 + ln
            return None
        for line in data.split(b'\r\n')[1:]:
            if line.lower().startswith(b'host:'):
                return line.split(b':', 1)[1].strip().decode('ascii', 'replace').split(':')[0].lower()
    except Exception:
        return None
    return None


def _serve(s):
    while True:
        try:
            c, _ = s.accept()
        except Exception:
            return
        threading.Thread(target=_one, args=(c,), daemon=True).start()


def _one(c):
    data = b''
    try:
        c.settimeout(3)
        while len(data) < 16384:
            d = c.recv(16384)
            if not d:
                break
            data += d
            if sni(data) is not None or (data[:1] == b'\x16' and len(data) >= 5
                                          and len(data) >= 5 + int.from_bytes(data[3:5], 'big')):
                break
            if data[:1] != b'\x16' and b'\r\n\r\n' in data:
                break
    except Exception:
        pass
    finally:
        try:
            c.close()
        except Exception:
            pass
    host = sni(data) or '(a production host, name not sent)'
    with _LOCK:
        _HITS[host] = _HITS.get(host, 0) + 1


def trap_port():
    """Start the trap once per process; every Browser in the process shares it."""
    with _LOCK:
        if _TRAP[0] is None:
            s = socket.socket()
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(('127.0.0.1', 0))
            s.listen(128)
            threading.Thread(target=_serve, args=(s,), daemon=True).start()
            _TRAP[0] = (s, s.getsockname()[1])
            atexit.register(_at_exit)
        return _TRAP[0][1]


def chrome_args():
    """The Chrome switch that sends every production host to the trap."""
    port = trap_port()
    rules = []
    for h in PRODUCTION_HOSTS:
        rules += ['MAP %s 127.0.0.1:%d' % (h, port), 'MAP *.%s 127.0.0.1:%d' % (h, port)]
    return ['--host-resolver-rules=' + ', '.join(rules)]


def refuse_bypass(extra_args):
    """A suite's own resolver rules would replace ours (Chrome keeps the last), and a proxy resolves
    hosts itself, so neither may be passed to a test browser."""
    for a in extra_args or ():
        if str(a).startswith(('--host-resolver-rules', '--proxy-server', '--proxy-pac-url', '--host-rules')):
            raise SystemExit('FAIL a test browser may not be started with %s: it would let it reach '
                             'production. A deliberately live tool starts Browser(live=True).' % str(a).split('=')[0])


def note_event(m):
    """Called with every debug-protocol event; keeps the URL of any request to production."""
    meth = m.get('method')
    if meth == 'Network.requestWillBeSent':
        url = ((m.get('params') or {}).get('request') or {}).get('url') or ''
    elif meth == 'Network.webSocketCreated':
        url = (m.get('params') or {}).get('url') or ''
    else:
        return
    if not url.startswith(('http', 'ws')):
        return
    h = host_of(url)
    if is_production(h):
        with _LOCK:
            seen = _URLS.setdefault(h, [])
            if url not in seen and len(seen) < 20:
                seen.append(url)


def attempts():
    """[(url, allowed reason or None)] for every production host that reached the trap."""
    out = []
    with _LOCK:
        hits, urls = dict(_HITS), {k: list(v) for k, v in _URLS.items()}
    for host in sorted(hits):
        for url in (urls.get(host) or ['https://%s/ (%d connection(s); the address was not seen)' % (host, hits[host])]):
            why = next((r for p, r in _ALLOW.items() if url.startswith(p)), None)
            if why is None and url not in urls.get(host, []):
                why = next((r for p, r in _ALLOW.items() if host_of(p) == host), None)
            out.append((url, why))
    return out


def verdict(out=None):
    """Print one FAIL line per attempt nobody allowed; True when there were none."""
    out = out or sys.stdout
    ok = True
    for url, why in attempts():
        # An allowed attempt prints nothing: this runs after the suite's own last line, and the gate
        # judges a suite by that line. The allow (with its reason) is in the suite's source for anyone to read.
        if not why:
            ok = False
            out.write('FAIL the test browser tried to reach production: %s (%s)\n' % (url, suite_name()))
    out.flush()
    return ok


def _at_exit():
    try:
        import time
        # Chrome may still be closing; let the trap take what is already in flight.
        for fn in list(_CLOSERS):
            try:
                fn()
            except Exception:
                pass
        time.sleep(0.3)
        ok = verdict()
    except Exception as e:
        sys.stdout.write('FAIL the production block could not report: %r\n' % (e,))
        ok = False
    if not ok:
        try:
            sys.stdout.flush(); sys.stderr.flush()
        finally:
            os._exit(1)
