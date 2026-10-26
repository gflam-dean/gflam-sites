#!/usr/bin/env python3
"""THE HOMEPAGE TOUR CARDS, RUN IN A REAL BROWSER.

Dean, 19 Oct 2026, about the "Current tours" cards on gflamtouring.com.au: the picture
was cropped top and bottom (the marquee sign and Vollie's boots cut off), there was a big
empty space under the button, the writing sat at the top of its half, and "it's a tour
card so it'll be multiple shows".

This opens the REAL touring/index.html in headless Chrome against a fake database served
from here, at desktop and phone widths, with 0, 1, 3 and 6 upcoming shows, plus in every
case one show that is already over and one whose go-live time has not come. It measures
what the browser actually painted, and saves a screenshot of each card to
~/venue-enrich/touring-card-shots/ (or $TOURING_CARD_SHOTS) for a person to look at.

    python3 tools/touring-cards.test.py

The dates are days counted from today in Queensland, so "already over" is always
yesterday and "not live yet" always goes live tomorrow, whatever hour this runs.
"""
import base64, datetime, importlib.util, io, json, os, re, struct, sys, threading, time, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'touring', 'index.html')
SHOTS = os.environ.get('TOURING_CARD_SHOTS') or os.path.expanduser('~/venue-enrich/touring-card-shots')

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


def poster(w=1200, h=1000):
    """A 6:5 picture like the real card (1200 x 1000), with a pink band along the very top
    and a yellow band along the very bottom: the parts that were being cropped off."""
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        if y < 60:
            px = bytes((254, 101, 195))
        elif y >= h - 60:
            px = bytes((250, 210, 60))
        else:
            px = bytes((30 + y * 60 // h, 10, 40 + y * 80 // h))
        rows += px * w
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(rows), 6)) + chunk(b'IEND', b''))


POSTER = poster()
QLD_TODAY = (datetime.datetime.utcnow() + datetime.timedelta(hours=10)).date()


def day(n):
    return (QLD_TODAY + datetime.timedelta(days=n)).isoformat()


TICKET_STYLES = [
    'https://moshtix.com.au/v2/event/drag-bingo-at-the-bowlo-tugun/192697',          # gets ref=gflamweb
    'https://moshtix.com.au/v2/event/x/1?ref=gflamemail',                              # keeps its own ref
    '',                                                                                # sold out
    'tickets.oztix.com.au/outlet/event/abc?utm_source=Gflam&utm_medium=Website',      # no scheme
    'https://moshtix.com.au/v2/event/y/2?ref=gflamweb',
    'https://moshtix.com.au/v2/event/z/3',
]


def shows_for(n):
    rows = [
        {'show_type': 'drag-bingo-at-the-bowlo', 'show_date': day(-1), 'venue': 'Past Venue', 'suburb': 'Gone',
         'time': '7:00 PM', 'ticket_url': 'https://example.com/past', 'go_live_date': None, 'go_live_time': None},
        {'show_type': 'drag-bingo-at-the-bowlo', 'show_date': day(40), 'venue': 'Not Yet Venue', 'suburb': 'Soon',
         'time': '7:00 PM', 'ticket_url': 'https://example.com/soon', 'go_live_date': day(1), 'go_live_time': '09:00:00'},
        # another tour's show must never appear on this card
        {'show_type': 'drag-brunch', 'show_date': day(3), 'venue': 'Other Tour Venue', 'suburb': 'Elsewhere',
         'time': '11:00 AM', 'ticket_url': 'https://example.com/o', 'go_live_date': None, 'go_live_time': None},
    ]
    names = ['Tugun Bowls Club', 'Jacobs Well Hotel', 'Logan Bowls Club', 'Coolangatta Hotel', 'Burleigh Bowls', 'Southport Sharks']
    times = ['7:00 PM', '7:30 PM', '6:00 PM', '7:00 PM', '8:15 PM', '7:00 PM']
    for i in range(n):
        rows.append({'show_type': 'drag-bingo-at-the-bowlo', 'show_date': day(7 * (i + 1) + (0 if i else 0)),
                     'venue': names[i], 'suburb': names[i].split()[0], 'time': times[i],
                     'ticket_url': TICKET_STYLES[i], 'go_live_date': day(-3) if i == 0 else None,
                     'go_live_time': '10:00:00' if i == 0 else None})
    rows.sort(key=lambda r: r['show_date'])
    return rows


CARD = {'name': 'Drag Bingo at the Bowlo', 'eyebrow': 'Touring Now', 'tour_key': 'drag-bingo-at-the-bowlo',
        'description': 'Bingo, but make it fabulous. A night of games, prizes and queens at a bowlo near you.',
        'button_label': 'View Shows & Tickets', 'button_link': '/drag-bingo-at-the-bowlo',
        'auto_hide': True, 'categories': ['drag'], 'priority': 10}
STATE = {'shows': []}


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

    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/index.html':
            return self._send(200, SERVED.encode('utf-8'), 'text/html; charset=utf-8')
        if p == '/poster.png':
            return self._send(200, POSTER, 'image/png')
        if p == '/sb/rest/v1/tour_categories':
            card = dict(CARD, image_url='http://127.0.0.1:%d/poster.png' % PORT)
            return self._send(200, [card])
        if p == '/sb/rest/v1/shows':
            q = self.path.split('?', 1)[1] if '?' in self.path else ''
            m = re.search(r'show_date=gte\.(\d{4}-\d\d-\d\d)', q)
            rows = [r for r in STATE['shows'] if not m or r['show_date'] >= m.group(1)]
            if 'select=' in q:
                cols = re.search(r'select=([^&]+)', q).group(1).split(',')
                rows = [{c: r.get(c) for c in cols} for r in rows]
            return self._send(200, rows)
        if p.startswith('/sb/rest/v1/'):
            return self._send(200, [])
        return self._send(404, b'', 'text/plain')

    def do_POST(self):
        return self._send(201, [])


srv = ThreadingHTTPServer(('127.0.0.1', 0), Fake)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
src = io.open(PAGE, encoding='utf-8').read()
A = 'const SBU="https://ijkzgmdtwtgfkedqspxm.supabase.co"'
if A not in src:
    print('the homepage no longer names its database the way this test expects; nothing was run')
    print('0 of 1 checks passed')
    sys.exit(1)
SERVED = src.replace(A, 'const SBU="http://127.0.0.1:%d/sb"' % PORT)
for host in ('https://www.googletagmanager.com', 'https://fonts.googleapis.com', 'https://connect.facebook.net'):
    SERVED = SERVED.replace(host, 'http://127.0.0.1:%d/offline' % PORT)

os.makedirs(SHOTS, exist_ok=True)
br = _vl.Browser()

MEASURE = r"""
(function () {
  var card = document.querySelector('#tourCards .tc-card');
  if (!card) return JSON.stringify({ card: false, text: document.getElementById('tourCards').innerText.slice(0, 200) });
  var img = card.querySelector('.tc-img img'), box = card.querySelector('.tc-img'), left = card.querySelector('.tc-left');
  var kids = [].slice.call(left.children).filter(function (k) { return k.getBoundingClientRect().height > 0; });
  var r = function (e) { var b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height }; };
  var cs = getComputedStyle(left);
  return JSON.stringify({
    card: true,
    lines: [].map.call(card.querySelectorAll('.tc-show'), function (li) {
      var a = li.querySelector('a'); return { text: li.firstElementChild.textContent, href: a ? a.href : null, label: (a || li.lastElementChild).textContent };
    }),
    more: card.querySelector('.tc-more') ? { text: card.querySelector('.tc-more').textContent, href: card.querySelector('.tc-more').getAttribute('href') } : null,
    img: img ? r(img) : null, natural: img ? [img.naturalWidth, img.naturalHeight] : null, box: r(box),
    left: r(left), padT: parseFloat(cs.paddingTop), padB: parseFloat(cs.paddingBottom), padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight),
    first: kids.length ? r(kids[0]) : null, last: kids.length ? r(kids[kids.length - 1]) : null,
    cardRect: r(card), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    allText: card.innerText
  });
})()
"""

DAYS = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat)'
MONTHS = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
LINE = re.compile(r'^%s \d{1,2} %s · [^·]+, [^·]+ · \d{1,2}(:\d\d)?(am|pm)$' % (DAYS, MONTHS))

try:
    for width, mobile, label in ((1280, False, 'desktop'), (390, True, 'phone')):
        for n in (0, 1, 3, 6):
            STATE['shows'] = shows_for(n)
            tid, sid = br.open_tab('about:blank')
            br.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': mobile}, session=sid)
            br.call('Page.enable', {}, session=sid)
            br.call('Page.navigate', {'url': 'http://127.0.0.1:%d/index.html' % PORT}, session=sid)
            # THE PAGE SAYS WHEN IT HAS RENDERED; the clock does not. This was a flat 20 s wall-clock
            # wait, and on 27 Oct 2026 with the Mac at a load of 15 (another agent's gate beside this
            # one) the phone/3-shows page had not finished its two fetches and the poster decode inside
            # 20 s, so "the tour card is on the page" went red and refused a live Worker deploy. The
            # shows are this test's own fake rows, so nothing about "3" drifts with live data; what
            # drifted was how long a starved Chrome takes. So: wait until the document is complete, the
            # fonts are in, the cards container has been written and the poster has decoded, and only
            # then measure. The 120 s cap is for a page that is actually stuck, and on that path the
            # failure names what the page was showing and the load at the time.
            RENDERED = ("document.readyState==='complete' && document.fonts.status==='loaded' && "
                        "(function(w){return !!w && w.children.length>0;})(document.getElementById('tourCards'))")
            m = None
            end = time.time() + 120
            while time.time() < end:
                try:
                    if br.eval(sid, RENDERED):
                        raw = br.eval(sid, MEASURE)
                        m = json.loads(raw) if raw else None
                        if m and m.get('card') and m['img'] and m['natural'][0] > 0:
                            break
                except Exception:
                    pass
                time.sleep(0.3)
            tag = '%s, %d show%s' % (label, n, '' if n == 1 else 's')
            if not (m and m.get('card')):
                try:
                    load = os.getloadavg()[0]
                except Exception:
                    load = 0
                ok('%s: the tour card is on the page' % tag, False,
                   'after 120 s the page showed: %s (load %.1f)' % ((m or {}).get('text', m), load))
                br.close_tab(tid)
                continue
            # screenshot of the card, for a person to look at
            br.eval(sid, "document.querySelector('#tourCards').scrollIntoView(); true")
            time.sleep(0.3)
            m = json.loads(br.eval(sid, MEASURE))
            c = m['cardRect']
            shot = br.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True,
                                                      'clip': {'x': max(0, c['l'] - 10), 'y': max(0, c['t'] - 10) + br.eval(sid, 'window.scrollY'),
                                                               'width': c['w'] + 20, 'height': c['h'] + 20, 'scale': 1}}, session=sid)
            with open(os.path.join(SHOTS, '%s-%d-shows.png' % (label, n)), 'wb') as f:
                f.write(base64.b64decode(shot['data']))

            lines = m['lines']
            ok('%s: lists %d upcoming show(s)' % (tag, min(n, 4)), len(lines) == min(n, 4), len(lines))
            want_more = ('+%d more shows' % (n - 4)) if n > 4 else None
            ok('%s: "+N more shows" only past four, linking to the tour page' % tag,
               (m['more'] is None) if not want_more else (m['more'] and m['more']['text'] == want_more and m['more']['href'] == '/drag-bingo-at-the-bowlo'),
               m['more'])
            text = m['allText']
            ok('%s: a show that is over, one not live yet, and another tour\'s are all hidden' % tag,
               'Past Venue' not in text and 'Not Yet Venue' not in text and 'Other Tour Venue' not in text)
            bad = [l['text'] for l in lines if not LINE.match(l['text'])]
            ok('%s: each line reads like "Sat 24 Oct · Venue, Suburb · 7pm"' % tag, not bad, bad[:1] or (lines[0]['text'] if lines else ''))
            ok('%s: no em or en dash anywhere on the card' % tag, '—' not in text and '–' not in text)
            nat = m['natural']
            img, box = m['img'], m['box']
            whole = (abs(img['h'] / img['w'] - nat[1] / float(nat[0])) < 0.01 and img['t'] >= box['t'] - 0.5
                     and img['b'] <= box['b'] + 0.5 and img['l'] >= box['l'] - 0.5 and img['r'] <= box['r'] + 0.5)
            ok('%s: the whole picture shows, top and bottom, nothing cropped' % tag, whole,
               'drawn %dx%d of %dx%d' % (img['w'], img['h'], nat[0], nat[1]))
            if not mobile:
                top_gap = m['first']['t'] - m['left']['t']
                bot_gap = m['left']['b'] - m['last']['b']
                ok('%s: the writing sits in the middle of its half' % tag, abs(top_gap - bot_gap) <= 2,
                   'space above %d, below %d' % (top_gap, bot_gap))
                ok('%s: even padding left and right' % tag, abs(m['padL'] - m['padR']) < 0.5, (m['padL'], m['padR']))
            else:
                ok('%s: the picture sits above the writing' % tag, img['b'] <= m['left']['t'] + 1)
                ok('%s: nothing spills sideways off the phone' % tag, m['scrollW'] <= m['innerW'], (m['scrollW'], m['innerW']))
            if n >= 3 and not mobile:
                hrefs = [l['href'] for l in lines]
                ok('ticket links: ref=gflamweb added where there was none',
                   hrefs[0] is not None and 'ref=gflamweb' in hrefs[0], hrefs[0])
                ok('ticket links: an existing ref is never replaced',
                   hrefs[1] is not None and 'ref=gflamemail' in hrefs[1] and 'gflamweb' not in hrefs[1], hrefs[1])
                ok('ticket links: a show with no ticket link says sold out', hrefs[2] is None and lines[2]['label'].strip().lower() == 'sold out',
                   lines[2]['label'])
            br.close_tab(tid)
except Exception as e:
    ok('the run finished', False, str(e)[:300])
finally:
    br.close()
    srv.shutdown()

print('Screenshots: %s' % SHOTS)
print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
EXPECTED = 2 * 4 * 8 + 2 * 3
if PASS[0] + FAIL[0] != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, PASS[0] + FAIL[0]))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
