#!/usr/bin/env python3
"""tools/move-show-images-to-storage.py, RUN against a fake PostgREST and Storage.

The script is a one-off Dean runs once against the live database, which is exactly the
kind of tool nobody gets to try twice. This runs the real script, as a separate process,
against a fake served from here: look-only must write nothing, --write must leave each
row holding a short address to a file that really is there, keep a copy of the original,
and a second run must find nothing left to do.

    python3 tools/move-show-images.test.py
"""
import base64, json, os, shutil, struct, subprocess, sys, tempfile, threading, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'tools', 'move-show-images-to-storage.py')
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
    else:
        FAIL[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


def png(w, h):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            rows += bytes(((x * 255) // w, (y * 255) // h, 90))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(rows), 0)) + chunk(b'IEND', b''))


BIG = 'data:image/png;base64,' + base64.b64encode(png(1800, 700)).decode()
SMALL = 'data:image/png;base64,' + base64.b64encode(png(300, 150)).decode()
DB = {
    'shows': [
        {'id': 'b185da69-3bb3-4fe8-923a-0b2ec184c803', 'venue': 'Jacobs Well Hotel', 'show_date': '2026-05-16', 'img_src': SMALL},
        {'id': '6b3b81d0-5b13-46d8-b469-f39cda4e39c4', 'venue': 'Tugun Bowls Club', 'show_date': '2026-10-24', 'img_src': BIG},
        {'id': '15e48799-3d33-47fa-9491-16c88523cd53', 'venue': 'Tugun Bowls Club', 'show_date': '2027-02-27', 'img_src': ''},
    ],
    'tour_categories': [{'id': '757c779e-9cdf-4a86-a7a8-3925e52c9744', 'name': 'Drag Bingo', 'image_url': None}],
}
FILES = {}
WRITES = []
KEY = 'test-service-key'


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('content-type', ctype)
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authed(self):
        return self.headers.get('apikey') == KEY

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith('/storage/v1/object/public/tour-images/'):
            p = u.path[len('/storage/v1/object/public/tour-images/'):]
            return self._send(200, FILES[p], 'image/jpeg') if p in FILES else self._send(404, {})
        if not self._authed():
            return self._send(401, {})
        table = u.path[len('/rest/v1/'):]
        q = parse_qs(u.query)
        rows = DB.get(table, [])
        for k, v in q.items():
            if k in ('select', 'order'):
                continue
            v = v[0]
            if v.startswith('like.'):
                pre = v[5:].rstrip('*')
                rows = [r for r in rows if isinstance(r.get(k), str) and r[k].startswith(pre)]
            elif v.startswith('eq.'):
                rows = [r for r in rows if r.get(k) == v[3:]]
        cols = q.get('select', ['*'])[0].split(',')
        if cols != ['*']:
            rows = [{c: r.get(c) for c in cols} for r in rows]
        return self._send(200, rows)

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n)
        u = urlparse(self.path)
        if not self._authed():
            return self._send(401, {})
        if u.path.startswith('/storage/v1/object/tour-images/'):
            p = unquote(u.path[len('/storage/v1/object/tour-images/'):])
            FILES[p] = body
            WRITES.append(('storage', p, len(body), self.headers.get('Content-Type')))
            return self._send(200, {'Key': p})
        return self._send(404, {})

    def do_PATCH(self):
        n = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(n))
        u = urlparse(self.path)
        if not self._authed():
            return self._send(401, {})
        table = u.path[len('/rest/v1/'):]
        rid = parse_qs(u.query)['id'][0][3:]
        out = []
        for r in DB.get(table, []):
            if r['id'] == rid:
                r.update(body)
                out.append(dict(r))
        WRITES.append(('row', table, rid, body))
        return self._send(200, out)


srv = ThreadingHTTPServer(('127.0.0.1', 0), Fake)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
tmp = tempfile.mkdtemp(prefix='move-imgs-')
envf = os.path.join(tmp, 'env')
with open(envf, 'w') as f:
    f.write('NEW_SUPABASE_URL=http://127.0.0.1:%d\nNEW_SERVICE_KEY=%s\n' % (port, KEY))
bdir = os.path.join(tmp, 'backups')


def run(*args):
    r = subprocess.run([sys.executable, SCRIPT, '--env-file=' + envf, '--backup-dir=' + bdir] + list(args),
                       capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout + r.stderr


try:
    code, out = run()
    ok('look-only names the project before anything else', out.splitlines()[0].startswith('Project: 127.0.0.1'), out.splitlines()[0])
    ok('look-only finds the two pictures inside rows', code == 0 and '2 picture(s) would move' in out, out.strip().splitlines()[-1])
    ok('look-only writes nothing', not WRITES and not os.path.exists(bdir), WRITES[:2])
    ok('look-only never prints the key', KEY not in out)

    code, out = run('--write')
    rows = {r['id']: r for r in DB['shows']}
    tugun = rows['6b3b81d0-5b13-46d8-b469-f39cda4e39c4']['img_src']
    jw = rows['b185da69-3bb3-4fe8-923a-0b2ec184c803']['img_src']
    ok('--write moves both', code == 0 and 'Moved 2 of 2' in out, out.strip().splitlines()[-1])
    pre = 'http://127.0.0.1:%d/storage/v1/object/public/tour-images/shows/' % port
    ok('each row now holds a short address', tugun.startswith(pre) and jw.startswith(pre) and len(tugun) < 200, tugun)
    p = tugun[len('http://127.0.0.1:%d/storage/v1/object/public/tour-images/' % port):]
    ok('the file at that address is really there', p in FILES and len(FILES[p]) > 0, p)
    if shutil.which('sips'):
        ok('the big PNG was stored as a much smaller JPEG', FILES.get(p, b'')[:3] == b'\xff\xd8\xff'
           and len(FILES[p]) < len(base64.b64decode(BIG.split(',', 1)[1])) // 4, '%d bytes' % len(FILES.get(p, b'')))
    else:
        ok('without sips the picture is stored unchanged', FILES.get(p) == base64.b64decode(BIG.split(',', 1)[1]))
    ok('the original picture was kept', open(os.path.join(bdir, 'shows-6b3b81d0-5b13-46d8-b469-f39cda4e39c4.txt')).read() == BIG)
    ok('the show with no picture was not touched', rows['15e48799-3d33-47fa-9491-16c88523cd53']['img_src'] == '')
    ok('only img_src was written to a row', all(set(w[3]) == {'img_src'} for w in WRITES if w[0] == 'row'))

    before = len(WRITES)
    code, out = run('--write')
    ok('a second run finds nothing to do', code == 0 and 'Nothing to move' in out and len(WRITES) == before, out.strip().splitlines()[-1])

    bad = os.path.join(tmp, 'env2')
    with open(bad, 'w') as f:
        f.write('NEW_SUPABASE_URL=https://someotherproject.supabase.co\nNEW_SERVICE_KEY=x\n')
    r = subprocess.run([sys.executable, SCRIPT, '--env-file=' + bad, '--write'], capture_output=True, text=True, timeout=60)
    ok('it refuses any project but Sydney', r.returncode == 2 and 'not the live Sydney project' in r.stdout)
finally:
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
EXPECTED = 13
if PASS[0] + FAIL[0] != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, PASS[0] + FAIL[0]))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
