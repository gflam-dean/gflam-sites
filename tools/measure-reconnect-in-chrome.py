#!/usr/bin/env python3
"""HOW LONG A PHONE TAKES TO HEAR THE GAME AGAIN AFTER FLIGHT MODE, ON BOTH ROADS, IN A REAL BROWSER
(live flight-mode test, Dean's iPhone, 1 Nov 2026: the room 4 s after a 25 s drop and FORTY after a
minute; Supabase 10 to 30 s).

Nothing here is a stand-in for the thing being measured:
  - the REAL supabase-js 2.118 (venueplay/app/vendor) against the REAL Supabase realtime of the live
    project, and the REAL room server on the live game Worker, each on a throwaway channel/room name
    no venue uses ("vp-ZZRC..."), so no venue hears a thing;
  - the REAL venueplay/app/vp-room.js and venueplay/app/vp-channel.js, AFTER (this checkout) and
    BEFORE (the same files at VP_BEFORE_REF, default origin/main), side by side in four windows;
  - a host that calls a ball every 0.5 s from this script, straight to the room / Supabase, never
    through the phone's network.
The phone's network is a local CONNECT proxy that Chrome sends everything through. Flight mode is
the proxy refusing every new connection and silently swallowing every byte on the old ones, AND
DevTools offline emulation (Network.emulateNetworkConditions), which is what makes the browser say
"offline" and then "online". When the signal returns, an old connection stays dead: the first thing
the phone sends down it is answered with a reset, as a real mobile network does after flight mode.
Played: 25 s and 60 s drops with the offline/online events, and a 25 s drop with NO events (iOS does
not always send them).

The number is the time from the signal coming back to the first ball heard after it. The target is
under 3 s; AFTER must be inside 3.5 s on every drop (a real network, a real server, a busy Mac).
BEFORE is printed, not judged.

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
Needs the network.

    VP_WAIT_LOCK=1800 python3 tools/measure-reconnect-in-chrome.py

A MEASUREMENT TOOL, NOT A GATE SUITE, on purpose: it needs the network and the live room and
realtime, and takes about five minutes. The gate runs tools/test-reconnect-fast.js (the same
drops on a virtual clock) and tools/reconnect-layout-in-chrome.test.py instead.
"""
import io, json, os, random, select, socket, string, subprocess, sys, threading, time, urllib.request, http.server, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import gatelib
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(HERE, 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)

SUPA_URL = 'https://ijkzgmdtwtgfkedqspxm.supabase.co'
SUPA_ANON = 'sb_publishable_9v83FWCSt7Di-jkgTvsMJQ_f6lJPovb'      # the public key every phone page carries
GAME = 'https://game.venueplay.com.au'
BEFORE_REF = os.environ.get('VP_BEFORE_REF', 'origin/main')
TARGET_S, PASS_S = 3.0, 3.5

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    if not cond: bad += 1

def take_lock(tool='reconnect-in-chrome'):
    deadline = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    said = False
    while True:
        state, pid, text = gatelib.lock_state()
        if state == 'stale':
            print('  heavy lock is STALE (pid %s, "%s"). Not clearing somebody else\'s lock: refusing.' % (pid, text[:80]))
            return False
        if state in ('free', 'mine') and gatelib.hold_lock_or_refuse(tool, wait_s=0):
            return True
        if time.time() > deadline:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return False
        if not said:
            print('  heavy lock held by pid %s ("%s"), waiting' % (pid, text[:80])); said = True
        time.sleep(5)

# ------------------------------------------------------------------ the phone's network
class Net(object):
    """A CONNECT proxy. up=False: new tunnels refused at once, bytes on existing ones swallowed.
    A tunnel opened before a drop is dead for good: swallowed, and reset the first time the phone
    sends on it after the signal returns."""
    def __init__(self):
        self.up = True
        self.epoch = 0
        self.lock = threading.Lock()
        self.srv = socket.socket(); self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(('127.0.0.1', 0)); self.srv.listen(256)
        self.port = self.srv.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()
    def drop(self):
        with self.lock: self.up = False; self.epoch += 1
    def restore(self):
        with self.lock: self.up = True
    def _accept(self):
        while True:
            try: c, _ = self.srv.accept()
            except Exception: return
            threading.Thread(target=self._tunnel, args=(c,), daemon=True).start()
    def _tunnel(self, c):
        try:
            head = b''
            while b'\r\n\r\n' not in head:
                d = c.recv(4096)
                if not d: c.close(); return
                head += d
            line = head.split(b'\r\n', 1)[0].decode('latin-1').split()
            if len(line) < 2 or line[0] != 'CONNECT' or not self.up:
                c.close(); return
            host, port = line[1].rsplit(':', 1)
            s = socket.create_connection((host, int(port)), timeout=10)
            s.settimeout(None)
            c.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            born = self.epoch
            while True:
                r, _, _ = select.select([c, s], [], [], 1.0)
                dead = born != self.epoch          # a drop happened since this tunnel opened
                for x in r:
                    d = x.recv(65536)
                    if not d: raise EOFError()
                    if dead or not self.up:
                        if x is c and self.up:     # the phone speaks on a dead connection: reset
                            raise EOFError()
                        continue                   # swallowed
                    (s if x is c else c).sendall(d)
        except Exception:
            pass
        for x in (c,):
            try: x.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b'\x01\x00\x00\x00\x00\x00\x00\x00')
            except Exception: pass
            try: x.close()
            except Exception: pass

# ------------------------------------------------------------------ the pages
def before_file(name):
    try:
        return subprocess.run(['git', 'show', '%s:venueplay/app/%s' % (BEFORE_REF, name)], cwd=ROOT,
                              capture_output=True, check=True).stdout.decode('utf-8')
    except Exception:
        return None

HARNESS = r'''<!doctype html><html><head><meta charset="utf-8"><title>reconnect</title></head><body>
<script src="/app/vendor/supabase-js-2.118.0.min.js"></script>
<script src="/%(ver)s/vp-channel.js"></script>
<script src="/%(ver)s/vp-room.js"></script>
<script>
window.__balls=[]; window.__state=""; window.__gone="";
var Q=new URLSearchParams(location.search), ROAD=Q.get("road"), NAME=Q.get("name"), VER="%(ver)s";
function heard(m){ if(m && m.t==="ball") window.__balls.push([Date.now(), m.n]); }
if(ROAD==="room"){
  try{ sessionStorage.setItem("vpRoomServer","1"); }catch(e){}
  VPRoom.wanted();
  window.__r=VPRoom.connect("%(game)s", NAME, "phone", heard,
    { onState:function(s){ window.__state=s; }, onUnavailable:function(w){ window.__gone=w||"?"; } });
} else {
  /* exactly what the phone pages hand createClient: nothing before, phoneOptions() after */
  var opts = (VER==="after" && VPChannel.phoneOptions) ? VPChannel.phoneOptions() : undefined;
  var client=supabase.createClient("%(supa)s", "%(anon)s", opts);
  var ch=VPChannel.keep(client, NAME, { config:{ broadcast:{ self:false } } });
  ch.on("broadcast", { event:"msg" }, function(e){ heard(e.payload); });
  ch.subscribe(function(s){ window.__state=s; });
}
</script></body></html>'''

def serve(files):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            p = self.path.split('?')[0]
            body = None; ctype = 'application/javascript'
            if p.startswith('/h/'):
                body = HARNESS % {'ver': p[3:], 'game': GAME, 'supa': SUPA_URL, 'anon': SUPA_ANON}; ctype = 'text/html'
            elif p in files:
                body = files[p]
            if body is None:
                self.send_response(404); self.end_headers(); return
            b = body.encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', ctype + '; charset=utf-8')
            self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.end_headers()
            self.wfile.write(b)
    class S(http.server.ThreadingHTTPServer):
        request_queue_size = 64; daemon_threads = True
    srv = S(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# ------------------------------------------------------------------ the host
class Host(object):
    """A ball every 0.5 s into every room and every channel, straight from here (never through the
    phone's network)."""
    def __init__(self, rooms, chans):
        self.rooms, self.chans, self.n, self.stop = rooms, chans, 0, False
        from websockets.sync.client import connect
        self.ws = {}
        for name in rooms:
            self.ws[name] = connect('wss://game.venueplay.com.au/room/ws?room=%s&role=host' % name, open_timeout=15)
        threading.Thread(target=self._run, daemon=True).start()
    def _run(self):
        while not self.stop:
            self.n += 1
            for name, w in list(self.ws.items()):
                try: w.send(json.dumps({'t': 'ball', 'n': self.n}))
                except Exception:
                    try:
                        from websockets.sync.client import connect
                        self.ws[name] = connect('wss://game.venueplay.com.au/room/ws?room=%s&role=host' % name, open_timeout=15)
                    except Exception: pass
            if self.chans:
                body = json.dumps({'messages': [{'topic': c, 'event': 'msg', 'payload': {'t': 'ball', 'n': self.n}} for c in self.chans]}).encode()
                try:
                    urllib.request.urlopen(urllib.request.Request(SUPA_URL + '/realtime/v1/api/broadcast', data=body, method='POST',
                        headers={'apikey': SUPA_ANON, 'Content-Type': 'application/json'}), timeout=5).read()
                except Exception: pass
            time.sleep(0.5)
    def close(self):
        self.stop = True
        for w in self.ws.values():
            try: w.close()
            except Exception: pass

# ------------------------------------------------------------------ the browser
def browser_via(proxy_port):
    orig = VL.subprocess.Popen
    def P(args, **kw):
        if args and args[0] == VL.CHROME:
            # Loopback (this script's own page server) is never proxied: Chrome's implicit bypass.
            args = args[:-1] + ['--proxy-server=http://127.0.0.1:%d' % proxy_port] + args[-1:]
        return orig(args, **kw)
    VL.subprocess.Popen = P
    try:
        return VL.Browser()
    finally:
        VL.subprocess.Popen = orig
SITE_PORT = [0]

def ev(B, sid, expr):
    r = B.evaluate(sid, expr, 8)
    return None if r is None else r.get('result', {}).get('value')

def main():
    try:
        import websockets  # noqa
    except Exception:
        print('needs the python websockets package'); return 2
    if not take_lock():
        return 2
    files = {}
    for name in ('vp-room.js', 'vp-channel.js'):
        files['/after/' + name] = io.open(os.path.join(ROOT, 'venueplay', 'app', name), encoding='utf-8').read()
        b = before_file(name)
        files['/before/' + name] = b if b is not None else files['/after/' + name]
    have_before = files['/before/vp-room.js'] != files['/after/vp-room.js'] or files['/before/vp-channel.js'] != files['/after/vp-channel.js']
    files['/app/vendor/supabase-js-2.118.0.min.js'] = io.open(os.path.join(ROOT, 'venueplay/app/vendor/supabase-js-2.118.0.min.js'), encoding='utf-8').read()
    site = serve(files); SITE_PORT[0] = site.server_address[1]
    base = 'http://127.0.0.1:%d' % SITE_PORT[0]
    net = Net()
    B = browser_via(net.port)
    tag = ''.join(random.choice('ACDEFGHJKMNPQRSTUVWXYZ2345679') for _ in range(5))
    vers = ['after', 'before'] if have_before else ['after']
    if not have_before: print('  (no BEFORE: %s has the same files; measuring this checkout only)' % BEFORE_REF)
    results = {}
    try:
        for scene, drop_s, events in (('25 s drop, offline/online events', 25, True),
                                      ('60 s drop, offline/online events', 60, True),
                                      ('25 s drop, no events (iOS)', 25, False)):
            print('\n%s' % scene.upper())
            pages, rooms, chans = {}, [], []
            for road in ('room', 'supabase'):
                for ver in vers:
                    name = 'vp-ZZRC%s%s%s%d' % (tag, road[0].upper(), ver[0].upper(), int(drop_s) + (0 if events else 1))
                    (rooms if road == 'room' else chans).append(name)
                    tid, sid = B.open_tab('%s/h/%s?road=%s&name=%s' % (base, ver, road, name))
                    B.call('Network.enable', {}, session=sid)
                    pages[(road, ver)] = (tid, sid)
            host = Host(rooms, chans)
            try:
                t0 = time.time()
                while time.time() - t0 < 40:
                    if all(ev(B, s, 'window.__balls.length>2') for _, s in pages.values()): break
                    time.sleep(0.5)
                for k, (_, s) in pages.items():
                    ok('%s/%s: hearing the host before the drop' % k, ev(B, s, 'window.__balls.length>2') is True, ev(B, s, '[window.__state, window.__gone, window.__balls.length]'))
                time.sleep(3)
                net.drop()
                if events:
                    for _, s in pages.values():
                        B.call('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}, session=s)
                time.sleep(drop_s)
                for _, s in pages.values(): ev(B, s, 'window.__back=Date.now(); true')
                net.restore()
                if events:
                    for _, s in pages.values():
                        B.call('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}, session=s)
                t1 = time.time()
                got = {}
                while time.time() - t1 < 90 and len(got) < len(pages):
                    for k, (_, s) in pages.items():
                        if k in got: continue
                        v = ev(B, s, '(function(){var b=window.__balls.filter(function(x){return x[0]>window.__back;})[0];return b?b[0]-window.__back:null;})()')
                        if isinstance(v, (int, float)): got[k] = v / 1000.0
                    time.sleep(0.25)
                for k in sorted(pages):
                    s = pages[k][1]
                    v = got.get(k)
                    gone = ev(B, s, 'window.__gone')
                    results[(scene,) + k] = v
                    print('  time %-9s %-6s back in %s%s' % (k[0], k[1], ('%.2f s' % v) if v is not None else 'NOT within 90 s', ('  (left the room: %s)' % gone) if gone else ''))
                for road in ('room', 'supabase'):
                    v = got.get((road, 'after'))
                    ok('%s, %s: this checkout hears the game again within %.1f s of the signal (target %.0f s)' % (road, scene, PASS_S, TARGET_S),
                       v is not None and v <= PASS_S and not ev(B, pages[(road, 'after')][1], 'window.__gone'), v)
            finally:
                host.close()
                for tid, _ in pages.values():
                    try: B.close_tab(tid)
                    except Exception: pass
    finally:
        try: B.close()
        except Exception: pass
        site.shutdown()
    print('\nSUMMARY (seconds from the signal returning to the first ball heard)')
    for k in sorted(results):
        print('  %-36s %-9s %-6s %s' % (k[0], k[1], k[2], ('%.2f' % results[k]) if results[k] is not None else '>90'))
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
