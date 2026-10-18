#!/usr/bin/env python3
"""THE SHOW MANAGER, RUN IN A REAL BROWSER AGAINST A FAKE touring-api.

Dean, 19 Oct 2026: "Error saving: save failed: canceling statement due to statement
timeout [57014] when I am trying to add a show". touring/manage.html kept every banner
as a base64 picture inside shows.img_src and re-sent every row, pictures and all, on
every Save. One upsert grew past the database's eight second limit.

This opens the REAL touring/manage.html in headless Chrome. The only change made to it
is the two addresses it talks to, which point at a fake Worker and a fake database
served from here, so every request the page makes is seen and nothing reaches a live
system. It then does what Dean did: adds a show with a 5 MB PNG and saves.

    python3 tools/touring-manage.test.py

Needs Google Chrome (the same one tools/verify-live.py drives).
"""
import importlib.util, io, json, os, struct, sys, tempfile, threading, time, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'touring', 'manage.html')

_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
_vl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_vl)

PASS, FAIL, failures = [0], [0], []


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  PASS  %s%s' % (label, ('  (%s)' % (detail,)) if detail else ''))
    else:
        FAIL[0] += 1
        failures.append(label)
        print('  FAIL  %s%s' % (label, ('  (%s)' % (detail,)) if detail else ''))


# ---- a 5 MB PNG, made here so the test needs nothing installed -------------------
def big_png(path, w=1700, h=1000):
    """A smooth picture (a real banner is smooth, noise is not) stored WITHOUT
    compression, so the file is honestly 5 MB, like a phone screenshot."""
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            rows += bytes(((x * 255) // w, (y * 255) // h, ((x + y) * 255) // (w + h)))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(rows), 0)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def jpeg_size(b):
    """Width and height from a JPEG's frame header, or None if it is not a JPEG."""
    if b[:2] != b'\xff\xd8':
        return None
    i = 2
    while i + 9 < len(b):
        if b[i] != 0xFF:
            i += 1
            continue
        marker = b[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack('>HH', b[i + 5:i + 9])
            return w, h
        seg = struct.unpack('>H', b[i + 2:i + 4])[0]
        i += 2 + seg
    return None


# ---- the fakes ---------------------------------------------------------------------
OLD_PICTURE = 'data:image/png;base64,' + 'iVBORw0KGgo' + 'A' * 200000   # the shape still in the live rows
FIXTURE = {
    'shows': [
        {'id': 'b185da69-3bb3-4fe8-923a-0b2ec184c803', 'show_date': '2026-05-16', 'venue': 'Jacobs Well Hotel',
         'suburb': 'Jacobs Well', 'host': 'Vollie LaVont', 'queens': ['Mandy Moobs', 'Chocolate Boxx'],
         'price': '$30+BF', 'time': '7:00 PM', 'doors': '6:30 PM', 'img_src': OLD_PICTURE, 'show_type': 'drag_bingo'},
        {'id': '6b3b81d0-5b13-46d8-b469-f39cda4e39c4', 'show_date': '2026-10-24', 'venue': 'Tugun Bowls Club',
         'suburb': 'Tugun', 'host': 'Vollie LaVont', 'queens': ['ShuShu Funtanna', 'Scarlett Fever'],
         'price': '$30+BF', 'time': '7:00 PM', 'doors': '6:30 PM', 'img_src': OLD_PICTURE, 'show_type': 'drag_bingo'},
        {'id': '15e48799-3d33-47fa-9491-16c88523cd53', 'show_date': '2027-02-27', 'venue': 'Tugun Bowls Club',
         'suburb': 'Tugun', 'host': 'Vollie LaVont', 'queens': [], 'price': '$30+BF', 'time': '7:00 PM',
         'doors': '6:30 PM', 'img_src': '', 'show_type': 'drag_bingo'},
    ],
    'artists': [{'name': 'Vollie LaVont'}],
    'venues': [{'name': 'Tugun Bowls Club', 'suburb': 'Tugun'}, {'name': 'Logan Bowls Club', 'suburb': 'Logan'}],
    'tour_categories': [{'id': '757c779e-9cdf-4a86-a7a8-3925e52c9744', 'name': 'Drag Bingo at the Bowlo',
                         'tour_key': 'drag_bingo', 'priority': 10, 'categories': ['drag'], 'image_url': None}],
    'experience': [], 'ticket_milestones': [],
}
LOG = []          # every request the page made: (method, path, content-type, body bytes)
UPLOADS = [0]


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

    def _body(self):
        n = int(self.headers.get('content-length') or 0)
        return self.rfile.read(n) if n else b''

    def do_GET(self):
        LOG.append(('GET', self.path, '', b''))
        if self.path.split('?')[0] == '/manage.html':
            return self._send(200, SERVED_PAGE.encode('utf-8'), 'text/html; charset=utf-8')
        if self.path.startswith('/sb/rest/v1/'):
            table = self.path[len('/sb/rest/v1/'):].split('?')[0]
            return self._send(200, FIXTURE.get(table, []))
        return self._send(404, {'error': 'not here'})

    def do_POST(self):
        body = self._body()
        LOG.append(('POST', self.path, self.headers.get('content-type') or '', body))
        p = self.path.split('?')[0]
        if p == '/api/check':
            return self._send(200, {'ok': True})
        if p == '/api/upload':
            UPLOADS[0] += 1
            kind = 'cards' if 'kind=card' in self.path else 'shows'
            return self._send(200, {'ok': True, 'url': 'http://127.0.0.1:%d/public/%s/pic%d.jpg' % (PORT, kind, UPLOADS[0])})
        if p.startswith('/api/'):
            try:
                rows = json.loads(body.decode('utf-8')).get('rows') or []
            except Exception:
                rows = []
            return self._send(200, {'ok': True, 'rows': rows, 'written': len(rows)})
        return self._send(404, {'error': 'not here'})

    do_PATCH = do_POST
    do_PUT = do_POST

    def do_DELETE(self):
        LOG.append(('DELETE', self.path, '', b''))
        return self._send(404, {})


srv = ThreadingHTTPServer(('127.0.0.1', 0), Fake)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

src = io.open(PAGE, encoding='utf-8').read()
A = 'const SUPABASE_URL = "https://ijkzgmdtwtgfkedqspxm.supabase.co";'
B = 'const TOURING_API = "https://touring-api.dean-tindale.workers.dev";'
if A not in src or B not in src:
    print('the page no longer names its two addresses the way this test expects; nothing was run')
    print('0 of 1 checks passed')
    sys.exit(1)
SERVED_PAGE = (src.replace(A, 'const SUPABASE_URL = "http://127.0.0.1:%d/sb";' % PORT)
                  .replace(B, 'const TOURING_API = "http://127.0.0.1:%d/api";' % PORT)
                  # Fonts are not what is under test, and a network wait is not wanted.
                  .replace('https://fonts.googleapis.com', 'http://127.0.0.1:%d/nofonts' % PORT))

tmp = tempfile.mkdtemp(prefix='touring-manage-')
PNG = os.path.join(tmp, 'banner.png')
png_bytes = big_png(PNG)

br = _vl.Browser()


def js(sid, expr, wait=True):
    r = br.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': wait},
                session=sid)
    if r.get('exceptionDetails'):
        raise RuntimeError('page threw: %s' % json.dumps(r['exceptionDetails'])[:400])
    return r.get('result', {}).get('value')


def until(sid, expr, seconds=20):
    end = time.time() + seconds
    while time.time() < end:
        if js(sid, expr):
            return True
        time.sleep(0.2)
    return False


def set_file(sid, selector, path):
    root = br.call('DOM.getDocument', {'depth': 0}, session=sid)['root']['nodeId']
    node = br.call('DOM.querySelector', {'nodeId': root, 'selector': selector}, session=sid)['nodeId']
    if not node:
        raise RuntimeError('no element for ' + selector)
    br.call('DOM.setFileInputFiles', {'files': [path], 'nodeId': node}, session=sid)


def posts(prefix):
    return [e for e in LOG if e[0] in ('POST', 'PATCH', 'PUT', 'DELETE') and e[1].startswith(prefix)]


try:
    tid, sid = br.open_tab('http://127.0.0.1:%d/manage.html' % PORT)
    until(sid, 'document.readyState === "complete"')
    # A dialog would freeze the page under the debugger, so collect them instead.
    js(sid, 'window._alerts = []; window.alert = function (m) { window._alerts.push(String(m)); };'
            'window.confirm = function () { return true; }; true')
    js(sid, 'document.getElementById("pinInput").value = "pw"; submitPin()')
    ok('the manager unlocks and loads the three shows',
       until(sid, 'document.querySelectorAll(".show-item input[type=file]").length === 3'))
    until(sid, 'document.querySelectorAll("#artistList option").length > 0')

    # ---- 1. type-ahead lists ------------------------------------------------------
    people = js(sid, '[].map.call(document.querySelectorAll("#artistList option"), o => o.value)') or []
    places = js(sid, '[].map.call(document.querySelectorAll("#venueList option"), o => o.value)') or []
    ok('the queen list offers names from the artists table and from past shows',
       'Vollie LaVont' in people and 'Mandy Moobs' in people and 'Scarlett Fever' in people, ', '.join(people))
    ok('the venue list offers saved venues and past show venues',
       'Logan Bowls Club' in places and 'Jacobs Well Hotel' in places, ', '.join(places))
    ok('the queen box and venue box use those lists',
       js(sid, 'document.querySelector("[id^=qi-]").getAttribute("list") === "artistList" && '
               'document.querySelector(".suburb-input").closest(".arow").querySelector("[list=venueList]") !== null'))

    # ---- 2. Save with nothing changed sends nothing ----------------------------------
    del LOG[:]
    js(sid, 'saveShows()')
    time.sleep(1.0)
    sent = posts('/api/shows')
    ok('a save with three unchanged shows sends nothing at all', len(sent) == 0,
       '%d request(s), %d bytes' % (len(sent), sum(len(e[3]) for e in sent)))

    # ---- 3. editing one field of a show that still has an old picture ------------------
    del LOG[:]
    js(sid, 'shows[1].price = "$35+BF"; saveShows()')
    time.sleep(1.0)
    sent = posts('/api/shows')
    body = sent[0][3] if sent else b''
    rows = json.loads(body.decode()).get('rows', []) if body else []
    ok('changing one price sends that one row only', len(sent) == 1 and len(rows) == 1 and rows[0].get('price') == '$35+BF',
       '%d row(s)' % len(rows))
    ok('and never re-sends its picture', len(rows) == 1 and 'img_src' not in rows[0] and b'data:' not in body,
       '%d bytes' % len(body))

    # ---- 4. Dean's case: add a show with a 5 MB PNG -----------------------------------
    del LOG[:]
    js(sid, 'addShow(); true')
    js(sid, '(function(){ var it = document.querySelectorAll(".show-item"); var last = it[it.length-1];'
            'var v = last.querySelector("[list=venueList]"); v.value = "Logan Bowls Club";'
            'v.dispatchEvent(new Event("change")); return true; })()')
    ok('picking a saved venue fills its suburb',
       js(sid, 'shows[3].suburb === "Logan" && document.querySelectorAll(".suburb-input")[3].value === "Logan"'),
       js(sid, 'shows[3].suburb'))
    js(sid, 'shows[3].showDate = "2027-03-06"; true')
    set_file(sid, '.show-item:last-child input[type=file]', PNG)
    up_done = until(sid, 'typeof uploadsInFlight !== "undefined" && uploadsInFlight === 0 && '
                         'shows[3].imgSrc && shows[3].imgSrc.indexOf("/public/shows/") > 0', 30)
    ups = posts('/api/upload')
    ok('the picture uploads on its own, through touring-api', up_done and len(ups) == 1, '%d upload(s)' % len(ups))
    pic = ups[0][3] if ups else b''
    dims = jpeg_size(pic) if pic else None
    ok('a 5 MB PNG goes up as a small JPEG', len(pic) > 0 and len(pic) < 600 * 1024 and ups[0][2].startswith('image/jpeg'),
       'png %d bytes -> upload %d bytes, %s' % (png_bytes, len(pic), ups[0][2] if ups else '-'))
    ok('no wider than 1600 pixels', bool(dims) and dims[0] <= 1600, dims)
    js(sid, 'document.getElementById("qi-" + shows[3].id).value = "Brand New Queen"; addQueen(3, shows[3].id); true')
    del LOG[:]
    js(sid, 'saveShows()')
    time.sleep(1.0)
    sent = posts('/api/shows')
    body = sent[0][3] if sent else b''
    rows = json.loads(body.decode()).get('rows', []) if body else []
    url = js(sid, 'shows[3].imgSrc')
    ok('the save carries the new show only', len(sent) == 1 and len(rows) == 1 and rows[0].get('venue') == 'Logan Bowls Club',
       '%d row(s)' % len(rows))
    ok('its row holds the short address, not the picture',
       len(rows) == 1 and rows[0].get('img_src') == url and len(url or '') < 200, url)
    ok('the whole save is small', 0 < len(body) < 8 * 1024 and b'data:' not in body, '%d bytes' % len(body))
    ok('the new queen is on the show', len(rows) == 1 and rows[0].get('queens') == ['Brand New Queen'])
    ok('and the type-ahead offers her at once',
       'Brand New Queen' in (js(sid, '[].map.call(document.querySelectorAll("#artistList option"), o => o.value)') or []))
    ok('nothing went to the database or storage directly', not posts('/sb/'), [e[1] for e in posts('/sb/')][:3])
    ok('no error was shown', not js(sid, 'window._alerts'), js(sid, 'window._alerts'))

    # ---- 5. a second save straight after sends nothing ---------------------------------
    del LOG[:]
    js(sid, 'saveShows()')
    time.sleep(1.0)
    ok('saving again with nothing changed sends nothing', not posts('/api/shows'))

    # ---- 6. tour card pictures ---------------------------------------------------------
    del LOG[:]
    until(sid, 'document.querySelectorAll("#tcItems input[type=file]").length === 1')
    set_file(sid, '#tcItems input[type=file]', PNG)
    until(sid, 'tcs[0].image_url && tcs[0].image_url.indexOf("/public/cards/") > 0', 30)
    cu = posts('/api/upload')
    ok('a tour card picture uploads through touring-api as a card',
       len(cu) == 1 and 'kind=card' in cu[0][1] and len(cu[0][3]) < 600 * 1024,
       cu[0][1] if cu else 'none')
    ok('and never to the bucket with the public key', not posts('/sb/'))
    br.close_tab(tid)
except Exception as e:
    ok('the run finished', False, str(e)[:300])
finally:
    br.close()
    srv.shutdown()

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
EXPECTED = 21
if PASS[0] + FAIL[0] != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, PASS[0] + FAIL[0]))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
