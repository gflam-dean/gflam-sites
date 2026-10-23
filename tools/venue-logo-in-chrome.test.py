#!/usr/bin/env python3
"""A VENUE'S LOGO, SIZED BY ITS SHAPE, MEASURED WHERE IT IS PAINTED (Dean, 21 Oct 2026).

"their logo on their normal games seems to be a bit small so I think we should be able to make it a
bit bigger if it's a square rather than a rectangle". Every screen used to draw the logo in one
120 x 56 box, sized for a wordmark, so a square crest came out 56 x 56 on a 1920 TV. Now
venueplay/app/vp-venuelogo.js gives each logo the same area whatever its shape, inside a height and
width ceiling, and vp-fit.js keeps the wall out from under it. And the phone header was padded 16px
all round with the menu button pinned over its right edge, so at 320 wide "VenuePlay Musical Bingo"
ran under the button ("looks crammed into the corner").

This opens the REAL pages in headless Chrome, served from this checkout, with logo pictures made
here (a 4:1 wordmark, a square crest, a near-round badge, a 1:3 tall one):

  TV     tv.html (the bingo demo), trivia and musical screen.html demos, at 1920x1080 and 1280x720.
         One page per screen: the logo is SWAPPED on the live mark, so the real load-and-resize path
         runs. Each logo must be painted at exactly VPVenueLogo.box() for its shape, a square one
         much bigger than the old 56, all shapes about the same area, and NOTHING the wall paints
         (every child of the layer on air, after vp-fit has moved it) may touch it, nor the
         VenuePlay corner or the JOIN NOW card.
  PHONE  play.html, trivia/play.html and musical/play.html, on a code link with /join/info answering
         a logo: the logo painted at the phone box, clear of the menu button. And the in-game
         headers (?demo=1) at 320 and 390 wide: the VenuePlay brand clear of the menu button and the
         called-ball chip, and inside the screen.

  COLOUR A red crest must come out red, a white one white (no filter, no white version: the only filter
         is a soft drop shadow), and a navy one, which would vanish on the dark wall, gets a pale plate.
  MARK   The VenuePlay mark (Dean, 21 Oct: "dull and behind everything"): full opacity, white, 24px or
         more at 1920, a dark halo, still smaller than the venue logo, and on the bingo TV above the
         dimmer the ball call throws over the room.

    python3 tools/venue-logo-in-chrome.test.py          screenshots go to $VP_SHOTS if set
"""
import base64, http.server, importlib.util, io, json, os, re, sys, tempfile, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SHOTS = os.environ.get('VP_SHOTS', '')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


# ---- logo pictures, made here so the suite needs nothing outside the repo ----
from PIL import Image, ImageDraw  # noqa: E402  (installed on this Mac; logo-tools-in-chrome uses it too)
LOGOS = tempfile.mkdtemp(prefix='venue-logo-')
def make(name, w, h, shape, fill=None):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if shape == 'ellipse': d.ellipse([2, 2, w - 3, h - 3], fill=fill or (255, 255, 255, 255))
    else: d.rectangle([0, 0, w - 1, h - 1], fill=fill or (255, 200, 40, 255))
    im.save(os.path.join(LOGOS, name + '.png'))
SHAPES = {'wide': (1200, 300), 'square': (800, 800), 'round': (1180, 991), 'tall': (300, 900)}
make('wide', 1200, 300, 'rect'); make('square', 800, 800, 'ellipse'); make('round', 1180, 991, 'ellipse'); make('tall', 300, 900, 'rect')
# Colour: a red crest must be painted RED (no filter, no white version), and a navy one, which would
# vanish on the dark wall, gets a pale plate behind it.
make('red', 800, 800, 'ellipse', (230, 20, 30, 255)); make('navy', 800, 800, 'ellipse', (12, 22, 80, 255))
# A THIN white logo (23 Oct 2026): a ring, so under a fifth of its box is inked, like Henley SLSC's script.
im = Image.new('RGBA', (800, 800), (0, 0, 0, 0)); ImageDraw.Draw(im).ellipse([6, 6, 793, 793], outline=(255, 255, 255, 255), width=14); im.save(os.path.join(LOGOS, 'thin.png'))
# Paper (22 Oct 2026): a white logo vanishes on a printed sign, so it gets a dark plate; a dark one does not.
def ratio_logo(name, iw, ih):
    im = Image.new('RGBA', (iw + 400, ih + 300), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([200, 150, 200 + iw - 1, 150 + ih - 1], fill=(250, 200, 40, 255)); im.save(os.path.join(LOGOS, name + '.png'))
ratio_logo('r21', 1050, 500); ratio_logo('r22', 1100, 500); ratio_logo('r23', 1150, 500)
SIGN_LOGOS = {'sign-white': '/__logos/square.png', 'sign-navy': '/__logos/navy.png', 'sign-slow': '/__logos/slow-square.png', 'sign-r21': '/__logos/r21.png', 'sign-r22': '/__logos/r22.png', 'sign-r23': '/__logos/r23.png', 'sign-none': None,
              'sign-gold': '/__logos/wide.png', 'sign-thin': '/__logos/thin.png', 'sign-round': '/__logos/round.png',
              'sign-long': '/__logos/square.png', 'sign-longwords': '/__logos/square.png'}
# THE NAME COMES FROM THE VENUE RECORD (24 Oct 2026), never typed on the page, so the worst names a venue can
# have are venues of their own here. /venue is asked by CODE, so the code is worked out the way the page does.
SIGN_NAMES = {'sign-long': 'The Kingscliff Beach Bowls and Golf Club Inc', 'sign-longwords': 'Supercalifragi Expialidocious Hotelandclubbb'}
def venue_code(slug):
    s = re.sub(r'[^a-z0-9]', '', slug.lower()); h = 2166136261
    for ch in s: h ^= ord(ch); h = (h * 16777619) & 0xffffffff
    A = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'; out = ''; x = h or 1
    for _ in range(6): x = (x * 1103515245 + 12345) & 0xffffffff; out += A[x % len(A)]
    return out
SLUG_BY_CODE = dict((venue_code(k), k) for k in SIGN_LOGOS)


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def worker(self):
        p = urllib.parse.urlparse(self.path).path[len('/__worker'):]
        if p.startswith('/join/info'):   # the phone asks which venue this is: it has a square logo
            return self.send(200, json.dumps({'ok': True, 'logo_url': '/__logos/square.png', 'fields': []}), 'application/json')
        # The printed signs (signage.html) ask whether the venue exists, then for its logo.
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if p.startswith('/venue'):
            slug = SLUG_BY_CODE.get(q.get('code', [''])[0], '')
            return self.send(200, json.dumps({'exists': True, 'name': SIGN_NAMES.get(slug, 'Sign Test Club')}), 'application/json')
        if p.startswith('/screen') and q.get('venue', [''])[0] in SIGN_LOGOS:
            u = SIGN_LOGOS[q['venue'][0]]
            return self.send(200, json.dumps({'exists': True, 'name': SIGN_NAMES.get(q['venue'][0], 'Sign Test Club'), 'logo_url': u}), 'application/json')
        return self.send(404, '{}', 'application/json')
    def do_POST(self):
        if self.path.startswith('/__worker'):
            n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n)
            return self.worker()
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'): return self.worker()
        if u.path.startswith('/__logos/'):
            # A logo still on its way when Print is pressed: the picture takes 1.5 s, and the second, CORS
            # read of it (the one that decides its plate: Chrome marks it Sec-Fetch-Mode: cors; a same-origin
            # page sends no Origin header) 2.5 s, so a Print that waits for the picture but not for its
            # reading opens the dialog with the plate undecided.
            if u.path.startswith('/__logos/slow-'): time.sleep(2.5 if self.headers.get('Sec-Fetch-Mode') == 'cors' else 1.5)
            f = os.path.join(LOGOS, os.path.basename(u.path).replace('slow-', ''))
            return self.send(200, open(f, 'rb').read(), 'image/png') if os.path.isfile(f) else self.send(404, 'no', 'text/plain')
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB={};window.__FAKE_SIGNED_IN=false;window.__FAKE_UID="x";\n'
            return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);},toDataURL:function(t,o,cb){var f=typeof o==="function"?o:cb;if(f)f(null,"data:,");return Promise.resolve("data:,");}};', 'application/javascript')
        p = u.path
        if p == '/play': p = '/play.html'
        elif p == '/tv': p = '/tv.html'
        elif not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(ROOT, 'venueplay', p.lstrip('/')))
        if not f.startswith(os.path.join(ROOT, 'venueplay')) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/__fake/supabase.js')
            t = t.replace('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js', '/__fake/qrcode.js')
            t = t.replace('https://venueplay-game.dean-tindale.workers.dev', '/__worker')
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]
B = VL.Browser()


def ask(sid, expr, wait=10):
    r = B.evaluate(sid, expr, wait)
    return None if r is None else r.get('result', {}).get('value')

def until(sid, expr, secs=20):
    t = time.time() + secs
    while time.time() < t:
        v = ask(sid, expr)
        if v: return v
        time.sleep(0.25)
    return False

def open_page(path, w, h, mobile):
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    B.call('Page.enable', {}, session=sid)
    B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
    B.call('Page.navigate', {'url': BASE + path}, session=sid)
    return tid, sid

def shot(sid, name):
    if not SHOTS: return
    try:
        r = B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        open(os.path.join(SHOTS, name + '.png'), 'wb').write(base64.b64decode(r['data']))
    except Exception: pass

# What the TV paints, measured: the logo, what the rule says it should be, and every child of every
# layer on air (as vp-fit sees them, after its transform), plus the corners that are not the wall.
MEASURE = r'''(function(){
  function R(e){ var b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}; }
  function vis(e){ if(!e) return false; var s=getComputedStyle(e), b=e.getBoundingClientRect();
    return !e.classList.contains("hidden") && !e.hidden && s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0; }
  var lg=document.getElementById("venueLogo");
  if(!lg || !vis(lg) || !lg.complete || !lg.naturalWidth) return JSON.stringify({ready:false});
  var want=VPVenueLogo.box(lg.naturalWidth, lg.naturalHeight, VPVenueLogo.limits("tv", innerWidth, innerHeight));
  var wall=[], layers=document.querySelectorAll(".layer");
  for(var i=0;i<layers.length;i++){ var L=layers[i]; if(!vis(L)) continue;
    for(var k=0;k<L.children.length;k++){ var c=L.children[k]; if(vis(c)) wall.push({id:(L.id||"")+">"+(c.id||c.className||c.tagName), r:R(c)}); } }
  var corners=[];
  ["tvJoinCorner"].forEach(function(id){ var e=document.getElementById(id); if(vis(e)) corners.push({id:id, r:R(e)}); });
  var tc=document.querySelectorAll(".tv-corner, #tvCorner");
  for(var j=0;j<tc.length;j++){ var kids=tc[j].children; for(var q=0;q<kids.length;q++){ if(vis(kids[q])) corners.push({id:"corner>"+(kids[q].className||kids[q].tagName), r:R(kids[q])}); } }
  return JSON.stringify({ready:true, src:lg.getAttribute("src"), nat:[lg.naturalWidth,lg.naturalHeight], logo:R(lg), want:want,
                         inset:VPVenueLogo.limits("tv", innerWidth, innerHeight).inset, wall:wall, corners:corners, W:innerWidth, H:innerHeight});
})()'''

def colour_at(sid, x, y):
    """The colour Chrome actually painted at (x, y), from a screenshot of a 4x4 patch."""
    try:
        r = B.call('Page.captureScreenshot', {'format': 'png', 'clip': {'x': x - 2, 'y': y - 2, 'width': 4, 'height': 4, 'scale': 1}}, session=sid)
        im = Image.open(io.BytesIO(base64.b64decode(r['data']))).convert('RGB')
        return im.getpixel((im.width // 2, im.height // 2))
    except Exception as e:
        return None

def hits(a, b):
    return a['l'] < b['r'] and a['r'] > b['l'] and a['t'] < b['b'] and a['b'] > b['t']

AREAS = {}
def tv(label, path, w, h, settle, shapes):
    print('\n%s at %dx%d' % (label, w, h))
    tid, sid = open_page(path + '&logo=' + urllib.parse.quote('/__logos/%s.png' % shapes[0], safe=''), w, h, False)
    try:
        ok('%s: the page loads the shared sizing rule' % label, until(sid, 'typeof VPVenueLogo==="object" && !!document.getElementById("venueLogo")', 30) is True)
        time.sleep(settle)                  # let the scripted night reach the wall worth looking at
        for shape in shapes:
            if shape != shapes[0]:
                ask(sid, 'document.getElementById("venueLogo").src="/__logos/%s.png"; true' % shape)
            v = until(sid, '(function(){var m=JSON.parse(%s);return m.ready && m.src.indexOf("/%s.png")>=0 ? JSON.stringify(m) : "";})()' % (MEASURE, shape), 15)
            m = json.loads(v) if v else {'ready': False}
            tag = '%s, %s logo' % (label, shape)
            if not m.get('ready'):
                ok(tag + ': the logo is painted', False, m); continue
            time.sleep(1.8)                 # vp-fit's own tick, after it was asked to re-measure on load
            m = json.loads(ask(sid, MEASURE))
            L, want = m['logo'], m['want']
            pad = ask(sid, 'parseFloat(getComputedStyle(document.getElementById("venueLogo")).paddingLeft)||0') or 0
            ok(tag + ': painted at the shared box, %dx%d' % (want['w'], want['h']),
               abs(L['w'] - 2 * pad - want['w']) <= 1 and abs(L['h'] - 2 * pad - want['h']) <= 1, (L, want, pad))
            ok(tag + ': in the top-left corner, %dpx in' % m['inset'], abs(L['l'] - m['inset']) <= 1 and abs(L['t'] - m['inset']) <= 1, L)
            over = [x['id'] for x in m['wall'] if hits(L, x['r'])]
            ok(tag + ': nothing on the wall is under it (%d pieces of the wall checked)' % len(m['wall']), m['wall'] and not over, over or 'no wall measured')
            over = [x['id'] for x in m['corners'] if hits(L, x['r'])]
            ok(tag + ': clear of the VenuePlay corner and the JOIN NOW card', not over, over)
            AREAS[(label, w, shape)] = L['w'] * L['h']
            if shape in ('red', 'navy', 'square'):
                c = colour_at(sid, L['l'] + L['w'] / 2, L['t'] + L['h'] / 2)
                plate = ask(sid, 'document.getElementById("venueLogo").getAttribute("data-backing")')
                filt = ask(sid, 'getComputedStyle(document.getElementById("venueLogo")).filter')
                ok(tag + ': no filter but a soft drop shadow', isinstance(filt, str) and filt.startswith('drop-shadow(') and not any(k in filt for k in ('invert', 'brightness', 'grayscale', 'contrast', 'sepia')), filt)
                if shape == 'red':
                    ok(tag + ': painted in its own colour, red, not white', c and c[0] > 170 and c[1] < 80 and c[2] < 80, c)
                    ok(tag + ': and a bright logo gets no plate', plate == '0', plate)
                if shape == 'square':
                    ok(tag + ': a white logo is painted white, its own colour, with no plate', c and min(c) > 220 and plate == '0', (c, plate))
                if shape == 'navy':
                    ok(tag + ': a navy logo, which would vanish on the wall, gets a pale plate', plate == '1', plate)
                    ok(tag + ': and is still painted navy on it', c and c[2] > c[0] + 30 and max(c) < 140, c)
            shot(sid, 'chrome-%s-%d-%s' % (label.replace(' ', '-'), w, shape))
    finally:
        B.close_tab(tid)


PHONE_BOX = r'''(function(){
  function R(e){ if(!e) return null; var s=getComputedStyle(e); if(e.classList.contains("hidden")||s.display==="none") return null;
    var b=e.getBoundingClientRect(); return b.width>0 ? {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height} : null; }
  var lg=document.getElementById("venueLogo"), word=document.querySelector(".ptop .brand .word"), svg=document.querySelector(".ptop .brand svg");
  var brand=null; if(word&&svg){ var a=svg.getBoundingClientRect(), c=word.getBoundingClientRect();
    brand={l:Math.min(a.left,c.left),t:Math.min(a.top,c.top),r:Math.max(a.right,c.right),b:Math.max(a.bottom,c.bottom)}; }
  var out={logo:R(lg), brand:brand, menu:R(document.getElementById("menuBtn")), ball:R(document.getElementById("hdrBall")), W:innerWidth};
  if(lg && lg.complete && lg.naturalWidth) out.want=VPVenueLogo.box(lg.naturalWidth, lg.naturalHeight, VPVenueLogo.limits("phone", innerWidth, innerHeight));
  return JSON.stringify(out);
})()'''

def phone_logo(label, path, w, h):
    tid, sid = open_page(path, w, h, True)
    try:
        v = until(sid, '(function(){var m=JSON.parse(%s);return m.logo && m.want ? JSON.stringify(m) : "";})()' % PHONE_BOX, 30)
        m = json.loads(v) if v else {}
        tag = '%s at %d wide' % (label, w)
        if not m:
            ok(tag + ': the venue logo is painted in the header', False, ask(sid, PHONE_BOX)); return
        L, want = m['logo'], m['want']
        ok(tag + ': the square logo is painted at the phone box, %dx%d (it was 30x30)' % (want['w'], want['h']),
           abs(L['w'] - want['w']) <= 1 and abs(L['h'] - want['h']) <= 1 and want['w'] >= 48, (L, want))
        ok(tag + ': clear of the menu button', not (m['menu'] and hits(L, m['menu'])), (L, m['menu']))
        ok(tag + ': clear of the VenuePlay brand above it', not (m['brand'] and hits(L, m['brand'])), (L, m['brand']))
        shot(sid, 'chrome-phone-%s-%d' % (label.replace('/', '-'), w))
    finally:
        B.close_tab(tid)

def phone_header(label, path, w, h):
    tid, sid = open_page(path, w, h, True)
    try:
        v = until(sid, '(function(){var m=JSON.parse(%s);return m.brand && m.menu ? JSON.stringify(m) : "";})()' % PHONE_BOX, 30)
        time.sleep(4)                       # the demo's first balls, so the called-ball chip is up on the bingo phone
        m = json.loads(ask(sid, PHONE_BOX) or '{}')
        tag = '%s header at %d wide' % (label, w)
        Bx = m.get('brand')
        if not Bx:
            ok(tag + ': the VenuePlay brand is there', False, m); return
        ok(tag + ': the VenuePlay brand does not run under the menu button', not hits(Bx, m['menu']) and m['menu']['l'] - Bx['r'] >= 8, (Bx, m['menu']))
        if m.get('ball'):
            ok(tag + ': nor under the called-ball chip', not hits(Bx, m['ball']) and Bx['l'] - m['ball']['r'] >= 8, (Bx, m['ball']))
        ok(tag + ': and stays on the screen', Bx['l'] >= 0 and Bx['r'] <= m['W'], Bx)
        shot(sid, 'chrome-header-%s-%d' % (label.replace('/', '-'), w))
    finally:
        B.close_tab(tid)


# The VenuePlay mark: secondary, but crisp and never under the bingo call's dimmer (Dean, 21 Oct 2026:
# "dull and behind everything").
MARK = r'''(function(){
  var vn=document.querySelector(".tv-corner .vn"), cor=vn&&vn.parentNode; if(!vn) return null;
  var s=getComputedStyle(vn), cs=getComputedStyle(cor), br=document.getElementById("ballReveal");
  var op=1, e=vn; while(e && e.nodeType===1){ op*=parseFloat(getComputedStyle(e).opacity); e=e.parentElement; }
  return JSON.stringify({size:parseFloat(s.fontSize), color:s.color, weight:s.fontWeight, opacity:op, shadow:s.textShadow,
    z:parseInt(cs.zIndex,10)||0, dimZ: br ? (parseInt(getComputedStyle(br).zIndex,10)||0) : null,
    svg:cor.querySelector("svg").getBoundingClientRect().width, logo:(document.getElementById("venueLogo")||{}).offsetHeight||0});
})()'''

def mark_check(label, path, w, h, has_dim):
    tid, sid = open_page(path, w, h, False)
    try:
        v = until(sid, MARK, 30)
        m = json.loads(v) if v else {}
        tag = '%s VenuePlay mark at %d' % (label, w)
        if not m:
            ok(tag + ': is on the wall', False); return
        ok(tag + ': full opacity, white, bold (not dull)', m['opacity'] >= 0.99 and m['color'] in ('rgb(255, 255, 255)',) and int(m['weight']) >= 700, m)
        ok(tag + ': a legible size for a TV, 24px or more at 1920', m['size'] >= 24 and m['svg'] >= 20, m)
        ok(tag + ': with a dark halo so it reads on any slide', 'rgba(0, 0, 0' in (m['shadow'] or ''), m['shadow'])
        ok(tag + ': and still secondary: smaller than the venue logo', not m['logo'] or m['size'] * 2 < m['logo'], m)
        if has_dim:
            ok(tag + ': above the bingo call\'s dimmer, not behind it', m['dimZ'] is not None and m['z'] > m['dimZ'], (m['z'], m['dimZ']))
        shot(sid, 'chrome-mark-%s-%d' % (label, w))
    finally:
        B.close_tab(tid)


# The printed signs (23 Oct 2026): four designs, each dark or light, on three sheets. What every visible logo
# looks like against its ground, and whether anything on a sign leaves its sign.
SIGN = r"""(function(){
  function vis(e){ var s=getComputedStyle(e), b=e.getBoundingClientRect(); return !e.hidden && s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0; }
  var arts=[].filter.call(document.querySelectorAll(".sheet:not(.hidden) [data-art]"), vis), out={arts:[], logos:[], spill:[], qr:[]};
  arts.forEach(function(a){
    var ab=a.getBoundingClientRect(); out.arts.push(a.className);
    a.querySelectorAll("*").forEach(function(e){
      if(!vis(e) || e.closest("svg") && e.tagName!=="svg") return;
      var b=e.getBoundingClientRect();
      if(b.left<ab.left-1.5||b.right>ab.right+1.5||b.top<ab.top-1.5||b.bottom>ab.bottom+1.5) out.spill.push((e.className&&e.className.baseVal===undefined?e.className:e.tagName)+" "+Math.round(b.left-ab.left)+","+Math.round(b.top-ab.top)+","+Math.round(b.right-ab.right)+","+Math.round(b.bottom-ab.bottom));
      if(e.tagName==="CANVAS") out.qr.push(b.width/Math.min(ab.width,ab.height));
    });
    a.querySelectorAll("[data-logo]").forEach(function(im){
      if(!vis(im)) return; var cs=getComputedStyle(im);
      out.logos.push({tone:im.getAttribute("data-tone"), cls:im.className, bg:cs.backgroundColor, done:im.complete&&im.naturalWidth>0});
    });
  });
  var h2=document.querySelector(".sheet:not(.hidden) h2[data-head]"); out.wrap=h2?h2.classList.contains("wrap"):null;
  return JSON.stringify(out);
})()"""

def sign_open(slug, sheet, design=None, keep=False):
    q = '/signage?venue=%s&sheet=%s' % (slug, sheet) + (('&design=' + design) if design else '')
    tid, sid = open_page(q, 1100, 1500, False)
    v = until(sid, '(function(){var m=JSON.parse(%s);var st=document.getElementById("status").textContent;return m.arts.length && /Found|No venue|Could not/.test(st) && m.logos.every(function(x){return x.tone && x.done;}) ? JSON.stringify(m) : "";})()' % SIGN, 20)
    time.sleep(0.4)
    m = json.loads(ask(sid, SIGN) or '{}')
    return m, sid, tid

def set_text(sid, fields):
    ask(sid, ';'.join('(function(){var e=document.getElementById(%s);e.value=%s;e.dispatchEvent(new Event("input"));})()' % (json.dumps(k), json.dumps(v)) for k, v in fields.items()) + ';true')
    time.sleep(0.6)

BLACK_PLATE, WHITE_PLATE, CLEAR = 'rgb(17, 17, 17)', 'rgb(255, 255, 255)', ('rgba(0, 0, 0, 0)', 'transparent')
def sign_checks():
    print('\nTHE PRINTED SIGNS: four designs, a plate wherever the ground would swallow the logo')
    # (slug, design-variant, what every visible logo's background must be)
    cases = [('sign-white', 'column-light', [BLACK_PLATE]), ('sign-white', 'column-dark', list(CLEAR)), ('sign-white', 'spot-light', [BLACK_PLATE]),
             ('sign-white', 'ticket-light', [BLACK_PLATE]), ('sign-white', 'band-dark', list(CLEAR)),
             ('sign-navy', 'column-dark', [WHITE_PLATE]), ('sign-navy', 'band-dark', [WHITE_PLATE]), ('sign-navy', 'spot-light', list(CLEAR)),
             ('sign-navy', 'ticket-dark', [WHITE_PLATE]), ('sign-gold', 'column-dark', list(CLEAR)), ('sign-gold', 'spot-light', list(CLEAR))]
    for slug, dv, want in cases:
        m, sid, tid = sign_open(slug, 'poster', dv)
        try:
            tag = '%s on %s' % (slug, dv)
            ok(tag + ': the logo is read and painted (%d)' % len(m.get('logos', [])), bool(m.get('logos')) and all(x['tone'] for x in m['logos']), m.get('logos'))
            ok(tag + ': ' + ('a %s plate' % ('black' if want[0] == BLACK_PLATE else 'white') if want[0] != CLEAR[0] else 'no plate'), all(x['bg'] in want for x in m.get('logos', [])), [x['bg'] for x in m.get('logos', [])])
        finally:
            B.close_tab(tid)

    print('\nTHE SHAPE RULE: BAND_RATIO 2.2, measured on the logo with its see-through margin trimmed')
    for slug, lw in (('sign-r21', False), ('sign-r22', True), ('sign-r23', True)):
        m, sid, tid = sign_open(slug, 'poster', 'column-dark')
        try:
            a = (m.get('arts') or [''])[0]
            ok('%s on Column: %s' % (slug, 'the band across the top' if lw else 'the right-hand column'), ((' lw' in a) == lw) and 'd-column' in a, a)
            g = json.loads(ask(sid, '(function(){var a=document.querySelector(".sheet:not(.hidden) [data-art]"),c=a.querySelector(".chrome").getBoundingClientRect(),b=a.getBoundingClientRect();'
                                    'return JSON.stringify({w:c.width/b.width,h:c.height/b.height,top:c.top-b.top,left:c.left-b.left});})()') or '{}')
            if lw: ok('%s: the band is the full width of the sign, across the top, and short' % slug, g.get('w', 0) > 0.98 and abs(g.get('top', 9)) < 2 and 0.1 < g.get('h', 0) < 0.3, g)
            else:  ok('%s: the column runs the full height down the right' % slug, g.get('h', 0) > 0.98 and 0.2 < g.get('w', 0) < 0.45 and g.get('left', 0) > 0, g)
        finally:
            B.close_tab(tid)
    for slug, want in (('sign-r21', 'd-column'), ('sign-r23', 'd-band'), ('sign-white', 'd-column'), ('sign-none', 'd-spot')):
        m, sid, tid = sign_open(slug, 'poster')
        try:
            a = (m.get('arts') or [''])[0]
            ok('no design chosen yet: %s gets %s' % (slug, want[2:]), want in a, a)
        finally:
            B.close_tab(tid)

    print('\nTHE PICKER: a venue\'s choice is remembered')
    m, sid, tid = sign_open('sign-gold', 'poster')
    try:
        ask(sid, 'document.querySelector(\'#designs [data-design="ticket"]\').click();document.querySelector(\'#tones [data-v="dark"]\').click();true'); time.sleep(0.5)
        B.call('Page.navigate', {'url': BASE + '/signage?venue=sign-gold&sheet=poster'}, session=sid)
        time.sleep(1.5); until(sid, '/Found/.test(document.getElementById("status").textContent)', 15); time.sleep(0.5)
        a = ask(sid, 'document.querySelector(".sheet:not(.hidden) [data-art]").className') or ''
        on = ask(sid, '(document.querySelector("#designs .dpick.on")||{}).textContent') or ''
        ok('after a reload the sign is still Ticket, dark, and the picker says so', 'd-ticket' in a and 'v-dark' in a and 'Ticket' in on, (a, on))
    finally:
        B.close_tab(tid)

    print('\nEVERY DESIGN, EVERY SHEET, THE WORST TEXT A VENUE CAN TYPE: nothing leaves its sign, the QR keeps its size')
    # The venue NAME is the record's (SIGN_NAMES): 'long' opens the venue with the long name, 'longwords' the one made of 14-letter words.
    TEXT = {'long': {'headIn': 'SCAN THIS NOW FOR BINGO NIGHT',
                     'lineIn': 'No app, no account, no sign-up and no fuss: just your phone!!',
                     'whatsIn': 'Bingo Wednesdays, trivia Thursdays from 7pm, musical bingo Fridays and meat raffles Saturday arvo'},
            # the longest words the editor takes (14 letters; a 15th is refused, see below), as many as fit each box
            'longwords': {'headIn': 'SCANTOPLAYBING OTRIVIAMUSICA',
                          'lineIn': 'Noappnoaccount justyourphonea noappnoaccount justyourphonea', 'whatsIn': 'BingoWednesday TriviaThursday MusicalFridays MeatRaffleSats andmoreandmore'}}
    # The QR with the venue's worst text (four lines of it, at every field's maximum) must stay at least 70% of the size it is with the default words:
    # long text wraps, it does not shrink the whole sign. (And never under a fifth of the sign.)
    for d in ('column-dark', 'band-dark', 'ticket-light', 'spot-light'):
        for sheet in ('poster', 'cards', 'tents'):
            for name, fields in TEXT.items():
                m, sid, tid = sign_open('sign-' + name, sheet, d)
                try:
                    q0 = min(m.get('qr') or [0])
                    nm = ask(sid, '(document.querySelector(".sheet:not(.hidden) [data-venue]")||{}).textContent')
                    ok('%s %s: the sign carries the venue record\'s name, "%s"' % (d, sheet, SIGN_NAMES['sign-' + name]), nm == SIGN_NAMES['sign-' + name], nm)
                    set_text(sid, fields); m = json.loads(ask(sid, SIGN) or '{}')
                    tag = '%s %s, %s text' % (d, sheet, name)
                    ok(tag + ': nothing on any sign leaves its sign', not m.get('spill'), (m.get('spill') or [])[:4])
                    q = min(m.get('qr') or [0])
                    ok(tag + ': the QR keeps its size (%.2f of the sign, %.2f with the usual words)' % (q, q0), q0 > 0 and q >= 0.7 * q0 and q >= 0.2, (q, q0))
                    ok(tag + ': the long headline wraps instead of shrinking the sign', m.get('wrap') is True, m.get('wrap'))
                    if name == 'long' and sheet == 'poster': shot(sid, 'chrome-sign-%s-long' % d)
                    set_text(sid, {'headIn': '', 'lineIn': '', 'whatsIn': ''})   # the words are remembered per venue now: leave none behind
                finally:
                    B.close_tab(tid)


    # ---- ROUND TWO (the skills review, 23 Oct 2026) ----
    MMPX = 793.7 / 210.0   # the sheet is 210mm wide on screen as well as on paper, so mm are measured in px
    print('\nPRINTER SAFE: office printer (the default) keeps every bleed inside a 6mm white margin; print shop is full bleed')
    EDGE = r"""(function(){var sh=document.querySelector(".sheet:not(.hidden)"),s=sh.getBoundingClientRect(),m=1e9;
      sh.querySelectorAll("[data-art]").forEach(function(a){var b=a.getBoundingClientRect();m=Math.min(m,b.left-s.left,b.top-s.top,s.right-b.right,s.bottom-b.bottom);});
      var pm=document.body.classList.contains("pm-office")?"office":(document.body.classList.contains("pm-shop")?"shop":"");
      return JSON.stringify({gap:m,pm:pm,on:(document.querySelector("#printer .pick.on")||{}).textContent||"",dark:(document.querySelector('#tones [data-v="dark"]')||{}).textContent||""});})()"""
    def edge(sid): return json.loads(ask(sid, EDGE) or '{}')
    for d in ('ticket-light', 'spot-dark', 'column-dark', 'band-dark'):
        for sheet in ('poster', 'cards', 'tents'):
            m, sid, tid = sign_open('sign-white', sheet, d)
            try:
                g = edge(sid); mm = g.get('gap', 0) / MMPX
                ok('%s %s, office printer by default: every sign sits at least 6mm inside the paper (%.1fmm)' % (d, sheet, mm), g.get('pm') == 'office' and mm >= 5.9 and 'Office printer' in g.get('on', ''), g)
                ok('%s %s: nothing leaves its sign with the margin on' % (d, sheet), not m.get('spill'), (m.get('spill') or [])[:4])
            finally:
                B.close_tab(tid)
    for d, sheet in (('ticket-light', 'poster'), ('spot-dark', 'cards'), ('ticket-dark', 'tents')):
        m, sid, tid = sign_open('sign-white', sheet, d + '&printer=shop')
        try:
            g = edge(sid)
            ok('%s %s, print shop: full bleed, the sign reaches the paper edge' % (d, sheet), g.get('pm') == 'shop' and g.get('gap', 9) < 1, g)
        finally:
            B.close_tab(tid)
    m, sid, tid = sign_open('sign-white', 'poster', 'column-dark')
    try:
        ok('the Column\'s dark tone is just "Dark"', (edge(sid).get('dark') or '').strip() == 'Dark', edge(sid).get('dark'))
    finally:
        B.close_tab(tid)
    m, sid, tid = sign_open('sign-white', 'poster', 'ticket-dark')
    try:
        ok('the picker labels the dark Ticket "print shop"', 'print shop' in edge(sid).get('dark', ''), edge(sid).get('dark'))
        ask(sid, 'document.querySelector(\'#printer [data-pm="shop"]\').click();true'); time.sleep(0.4)
        B.call('Page.navigate', {'url': BASE + '/signage?venue=sign-white&sheet=poster&design=spot-dark'}, session=sid)
        time.sleep(1.5); until(sid, '/Found/.test(document.getElementById("status").textContent)', 15); time.sleep(0.5)
        g = edge(sid)
        ok('print shop is remembered after a reload, and the dark Spotlight is labelled print shop too', g.get('pm') == 'shop' and g.get('gap', 9) < 1 and 'print shop' in g.get('dark', ''), g)
        ask(sid, 'document.querySelector(\'#printer [data-pm="office"]\').click();true'); time.sleep(0.4)   # back to the default for the checks that follow
        ok('and office printer can be chosen back', edge(sid).get('pm') == 'office' and edge(sid).get('gap', 0) / MMPX >= 5.9, edge(sid))
    finally:
        B.close_tab(tid)

    print('\nTYPE ON PAPER: the stub never under 8pt, the band eyebrow pink and never under 10pt, the small line never under 9pt on a card')
    PT = r"""(function(){function pt(sel){var m=1e9,c="",t="";document.querySelectorAll(".sheet:not(.hidden) "+sel).forEach(function(e){var cs=getComputedStyle(e);if(cs.display==="none"||e.hidden)return;var f=parseFloat(cs.fontSize);if(f<m){m=f;c=cs.color;t=e.textContent;}});return {pt:m===1e9?null:m*72/96,color:c,text:t};}
      return JSON.stringify({clbl:pt(".clbl"),curl:pt(".curl"),ckick:pt(".ckick"),no:pt(".no"),kick:pt(".kick")});})()"""
    for sheet in ('cards', 'tents'):
        m, sid, tid = sign_open('sign-white', sheet, 'ticket-light')
        try:
            g = json.loads(ask(sid, PT) or '{}')
            ok('Ticket %s: the stub\'s label and address are 8pt or more (%.1f, %.1f)' % (sheet, g['clbl']['pt'] or 0, g['curl']['pt'] or 0), (g['clbl']['pt'] or 0) >= 7.95 and (g['curl']['pt'] or 0) >= 7.95, g)
            ok('Ticket %s: the stub says "Go to venueplay.com.au/play"' % sheet, g['curl']['text'].strip() == 'Go to venueplay.com.au/play', g['curl']['text'])
        finally:
            B.close_tab(tid)
    for dv, sheet in (('band-dark', 'cards'), ('band-light', 'poster'), ('band-dark', 'tents')):
        m, sid, tid = sign_open('sign-white', sheet, dv)
        try:
            g = json.loads(ask(sid, PT) or '{}')
            ok('Top band %s %s: the eyebrow in the band is pink and 10pt or more (%.1f)' % (dv, sheet, g['ckick']['pt'] or 0), (g['ckick']['pt'] or 0) >= 9.95 and g['ckick']['color'] in ('rgb(255, 31, 142)', 'rgb(199, 15, 105)'), g['ckick'])
        finally:
            B.close_tab(tid)
    for dv in ('column-dark', 'band-dark', 'ticket-light', 'spot-light'):
        m, sid, tid = sign_open('sign-white', 'cards', dv)
        try:
            g = json.loads(ask(sid, PT) or '{}')
            ok('%s cards: the small line is 9pt or more (%.1f)' % (dv, g['no']['pt'] or 0), (g['no']['pt'] or 0) >= 8.95, g['no'])
        finally:
            B.close_tab(tid)

    print('\nTHE BAND, THE COLUMN, THE SPOTLIGHT: 20% band with the badge sized into it, no pink stick, a hard stroke and no halo')
    m, sid, tid = sign_open('sign-round', 'poster', 'band-dark')
    try:
        g = json.loads(ask(sid, '(function(){var a=document.querySelector(".sheet:not(.hidden) [data-art]"),ch=a.querySelector(".chrome"),c=ch.getBoundingClientRect(),b=a.getBoundingClientRect(),'
                                'l=a.querySelector("[data-chrome]").getBoundingClientRect(),k=a.querySelector(".ckick").getBoundingClientRect();'
                                'return JSON.stringify({h:c.height/b.height,logoH:l.height,logoBottom:l.bottom,kickTop:k.top,kickBottom:k.bottom,bandBottom:c.bottom-parseFloat(getComputedStyle(ch).borderBottomWidth)});})()') or '{}')
        ok('Top band: the band is 20%% of the page (%.3f)' % g.get('h', 0), abs(g.get('h', 0) - 0.20) < 0.01, g)
        ok('Top band: a round badge is still at least 38mm tall inside the shorter band (%.0fmm)' % (g.get('logoH', 0) / MMPX), g.get('logoH', 0) / MMPX >= 38, g)
        ok('Top band: the badge sits above the eyebrow and the eyebrow is wholly inside the band', g.get('logoBottom', 9e9) <= g.get('kickTop', 0) + 1 and g.get('kickBottom', 9e9) <= g.get('bandBottom', 0) + 1, g)
    finally:
        B.close_tab(tid)
    m, sid, tid = sign_open('sign-white', 'poster', 'column-dark')
    try:
        g = json.loads(ask(sid, '(function(){var a=document.querySelector(".sheet:not(.hidden) [data-art]"),R=function(e){return e.getBoundingClientRect();},'
                                'acc=R(a.querySelector(".chrome .accent")),lg=R(a.querySelector("[data-chrome]")),col=R(a.querySelector(".chrome")),mk=R(a.querySelector(".mark")),b=R(a),'
                                'sg=a.querySelector(".sign"),u=parseFloat(getComputedStyle(sg).getPropertyValue("--u"))/100*R(sg.parentNode).height;'
                                'return JSON.stringify({accTop:acc.top,accW:acc.width,accH:acc.height,logoBottom:lg.bottom,colW:col.width,markGap:b.bottom-mk.bottom,u:u});})()') or '{}')
        ok('Column: no pink stick at the top; the accent is a short rule under the logo', g.get('accTop', 0) > g.get('logoBottom', 9e9) and g.get('accH', 9) < g.get('accW', 0) and g.get('accW', 9e9) < 0.5 * g.get('colW', 0), g)
        ok('Column: the VenuePlay mark sits a clear step above the foot of the sign (1.7 units, up from 1)', g.get('u', 0) > 0 and g.get('markGap', 0) >= 1.6 * g['u'], g)
    finally:
        B.close_tab(tid)
    for slug, has_logo in (('sign-white', True), ('sign-none', False)):
        m, sid, tid = sign_open(slug, 'poster', 'spot-light')
        try:
            g = json.loads(ask(sid, '(function(){var s=document.querySelector(".sheet:not(.hidden) .sign"),q=getComputedStyle(s.querySelector(".qrbox")),k=s.querySelector(".kick"),kc=getComputedStyle(k);'
                                    'return JSON.stringify({bw:parseFloat(q.borderTopWidth),shadow:q.boxShadow,color:q.borderTopColor,kick:kc.display!=="none"&&k.getBoundingClientRect().height>0});})()') or '{}')
            if has_logo:
                ok('Spotlight: a hard pink stroke about 2mm on the poster (%.1fmm) and no blur halo' % (g.get('bw', 0) / MMPX), 1.6 <= g.get('bw', 0) / MMPX <= 2.4 and g.get('shadow') == 'none' and g.get('color') in ('rgb(199, 15, 105)', 'rgb(255, 31, 142)'), g)
                ok('Spotlight with a logo: the eyebrow goes, so three things sit above the code', g.get('kick') is False, g)
            else:
                ok('Spotlight with no logo: the eyebrow stays', g.get('kick') is True, g)
        finally:
            B.close_tab(tid)

    print('\nTHIN WHITE SCRIPT on the black column: a charcoal card and the width of the column')
    for slug, thin, label in (('sign-thin', True, 'a thin white ring'), ('sign-white', False, 'a solid white crest')):
        m, sid, tid = sign_open(slug, 'poster', 'column-dark')
        try:
            g = json.loads(ask(sid, '(function(){var a=document.querySelector(".sheet:not(.hidden) [data-art]"),i=a.querySelector("[data-chrome]"),c=a.querySelector(".chrome").getBoundingClientRect(),b=i.getBoundingClientRect();'
                                    'return JSON.stringify({thin:i.classList.contains("thin"),bg:getComputedStyle(i).backgroundColor,w:b.width/c.width});})()') or '{}')
            if thin: ok('%s is read as thin, sits on a charcoal card and spans at least 90%% of the column' % label, g.get('thin') is True and g.get('bg') == 'rgb(38, 38, 43)' and g.get('w', 0) >= 0.9, g)
            else:    ok('%s is not thin: no card, its usual width' % label, g.get('thin') is False and g.get('bg') in CLEAR and g.get('w', 1) <= 0.85, g)
        finally:
            B.close_tab(tid)

    print('\nTHE WORDS: the new defaults, the venue\'s own eyebrow, a 15-letter word refused by name, the words remembered')
    WORDS = r"""(function(){var s=document.querySelector(".sheet:not(.hidden) .sign"),n=function(e){return (e?e.innerText:"").replace(/\s+/g," ").trim();},w=function(e){return (e?e.textContent:"").replace(/\s+/g," ").trim();};
      var a=document.querySelector(".sheet:not(.hidden) [data-art]");
      return JSON.stringify({no:n(s.querySelector(".no")),fb:n(s.querySelector(".fallback")),h2:n(s.querySelector("h2")),kick:w(s.querySelector(".kick")),ckick:w(a.querySelector(".ckick")),
        ph:document.getElementById("lineIn").placeholder,status:document.getElementById("status").textContent,
        bad:[].map.call(document.querySelectorAll(".fld input.bad"),function(i){return i.id;}),head:document.getElementById("headIn").value,kmax:document.getElementById("kickIn").maxLength});})()"""
    m, sid, tid = sign_open('sign-white', 'poster', 'spot-light')
    try:
        g = json.loads(ask(sid, WORDS) or '{}')
        ok('Spotlight: the default small line is "Play along on the big screen. Nothing to download."', g.get('no') == 'Play along on the big screen. Nothing to download.', g.get('no'))
    finally:
        B.close_tab(tid)
    m, sid, tid = sign_open('sign-white', 'poster', 'column-dark')
    try:
        g = json.loads(ask(sid, WORDS) or '{}')
        ok('Column: the default small line is "Play along on the big screen. Nothing to download." (its own two-line form)', g.get('no') == 'Play along on the big screen. Nothing to download.' and g.get('ph') == 'Play along on the big screen. Nothing to download.', (g.get('no'), g.get('ph')))
        ok('the default bottom line is "Can’t scan? Go to venueplay.com.au/play and enter code ..."', bool(re.match(r'^Can’t scan\? Go to venueplay\.com\.au/play and enter code [A-Z2-9]{6}$', g.get('fb', ''))), g.get('fb'))
        ok('the headline is still SCAN TO PLAY', g.get('h2', '').upper() == 'SCAN TO PLAY' and g.get('kick') == 'Live games here', (g.get('h2'), g.get('kick')))
        set_text(sid, {'kickIn': 'Trivia Thu 7pm. Bingo Sat 2pm'}); g = json.loads(ask(sid, WORDS) or '{}')
        ok('the eyebrow is the venue\'s: "Trivia Thu 7pm. Bingo Sat 2pm" on the Column sign (the box takes it)', g.get('kick') == 'Trivia Thu 7pm. Bingo Sat 2pm' and g.get('kmax', 0) >= 29, (g.get('kick'), g.get('kmax')))
        ask(sid, 'document.querySelector(\'#designs [data-design="band"]\').click();true'); time.sleep(0.5); g = json.loads(ask(sid, WORDS) or '{}')
        ok('and in the Top band it is the pink line in the band', g.get('ckick') == 'Trivia Thu 7pm. Bingo Sat 2pm', g.get('ckick'))
        ask(sid, 'document.querySelector(\'#designs [data-design="column"]\').click();true'); time.sleep(0.4)
        for field in ('headIn', 'lineIn', 'whatsIn', 'kickIn'):
            set_text(sid, {field: 'Scan Supercalifragilistic now'}); g = json.loads(ask(sid, WORDS) or '{}')
            ok('%s: a 15-letter word is refused, the box is marked and the word is named' % field, g.get('bad') == [field] and 'Supercalifragilistic' in g.get('status', '') and g.get('h2', '').upper() == 'SCAN TO PLAY' and g.get('no') == 'Play along on the big screen. Nothing to download.', (g.get('bad'), g.get('status')[:80], g.get('h2'), g.get('no')))
            set_text(sid, {field: ''})
        set_text(sid, {'headIn': 'Play Supercalifragi'}); g = json.loads(ask(sid, WORDS) or '{}')
        ok('a 14-letter word is taken, and the warning goes', g.get('h2', '').upper() == 'PLAY SUPERCALIFRAGI' and g.get('bad') == [] and 'too long' not in g.get('status', ''), (g.get('h2'), g.get('bad'), g.get('status')[:60]))
        set_text(sid, {'headIn': 'Join the quiz', 'lineIn': 'Grab a drink and play along', 'kickIn': 'Trivia Thu 7pm. Bingo Sat 2pm'})
        B.call('Page.navigate', {'url': BASE + '/signage?venue=sign-white&sheet=poster'}, session=sid)
        time.sleep(1.5); until(sid, '/Found/.test(document.getElementById("status").textContent)', 15); time.sleep(0.5)
        g = json.loads(ask(sid, WORDS) or '{}')
        ok('a venue\'s words are remembered after a reload: headline, small line and eyebrow', g.get('h2', '').upper() == 'JOIN THE QUIZ' and g.get('no') == 'Grab a drink and play along' and g.get('head') == 'Join the quiz' and g.get('kick') == 'Trivia Thu 7pm. Bingo Sat 2pm', (g.get('h2'), g.get('no'), g.get('head'), g.get('kick')))
        set_text(sid, {'headIn': '', 'lineIn': '', 'kickIn': ''})   # leave the browser as it was found
    finally:
        B.close_tab(tid)

    print('\nTHE VENUE IS SHOWN, NOT TYPED (Dean, 24 Oct 2026): the name from the record, the link the QR encodes, one sentence without a venue')
    RO = r"""(function(){var q=function(s){return document.querySelector(s);};var sb=q("#setupForm"),st=q(".stage"),nv=q("#noVenue");
      var picks=[].map.call(document.querySelectorAll("#picks .dpick"),function(b){var r=b.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top),on:b.classList.contains("on"),th:!!b.querySelector(".th"),kind:b.getAttribute("data-kind")};});
      var dp=q("#designs .dpick"),dr=dp?dp.getBoundingClientRect():{height:0};
      return JSON.stringify({noVenue:(nv&&!nv.classList.contains("hidden"))?nv.textContent.replace(/\s+/g," ").trim():"", form:!!(sb&&!sb.classList.contains("hidden")), stage:!!(st&&!st.classList.contains("hidden")),
        inputs:!!(q("#slugIn")||q("#nameIn")||q("#checkBtn")), name:(q("#venueName")||{}).textContent, link:(q("#venueLink")||{}).textContent, open:(q("#openLink")||{}).href, openTag:(q("#openLink")||{}).tagName,
        openNew:(q("#openLink")||{}).target, signName:(q(".sheet:not(.hidden) [data-venue]")||{}).textContent, picks:picks, dpickH:Math.round(dr.height), oldPicks:document.querySelectorAll("#picks .pick").length});})()"""
    tid, sid = open_page('/signage', 1100, 900, False)
    try:
        time.sleep(1.2); g = json.loads(ask(sid, RO) or '{}')
        ok('no ?venue=: one sentence, "Open this from Your account > Marketing > Print table signs", and no form, no sheets',
           g.get('noVenue') == 'Open this from Your account > Marketing > Print table signs.' and g.get('form') is False and g.get('stage') is False, g)
    finally:
        B.close_tab(tid)
    m, sid, tid = sign_open('sign-white', 'poster', 'ticket-light')
    try:
        g = json.loads(ask(sid, RO) or '{}')
        ok('with a venue: the form and the sheet, and no box to type a venue link or a venue name into', g.get('form') is True and g.get('stage') is True and g.get('inputs') is False and g.get('noVenue') == '', g)
        ok('the venue name is read from the record and shown as plain text, and it is the name on the sign', g.get('name') == 'Sign Test Club' and g.get('signName') == 'Sign Test Club', (g.get('name'), g.get('signName')))
        ok('the venue link is shown read-only, exactly the address the QR encodes', g.get('link') == 'https://venueplay.com.au/play?venue=sign-white', g.get('link'))
        qr = ask(sid, '(function(){var d=VPQR.draw;VPQR.draw=function(el,url){window.__qr=url;return d.apply(this,arguments);};document.querySelector("#picks [data-kind=poster]").click();return window.__qr;})()')
        ok('CONTROL: that IS the address drawn into the QR', qr == g.get('link'), qr)
        ok('"Open my venue link" is a link to that address, in a new tab (not a Check button)', g.get('openTag') == 'A' and g.get('open') == g.get('link') and g.get('openNew') == '_blank', (g.get('openTag'), g.get('open')))
        pk = g.get('picks') or []
        ok('What to print is one row of three tiles in the Design picker\'s style: a picture each, equal width and height, one on',
           len(pk) == 3 and g.get('oldPicks') == 0 and all(p['th'] for p in pk) and max(p['w'] for p in pk) - min(p['w'] for p in pk) <= 1 and max(p['h'] for p in pk) - min(p['h'] for p in pk) <= 1
           and max(p['t'] for p in pk) - min(p['t'] for p in pk) <= 1 and [p['on'] for p in pk].count(True) == 1 and [p['kind'] for p in pk] == ['poster', 'cards', 'tents'], pk)
        ok('and the tiles are the height of a Design tile or more', bool(pk) and pk[0]['h'] >= g.get('dpickH', 999), (pk and pk[0]['h'], g.get('dpickH')))
    finally:
        B.close_tab(tid)
    tid, sid = open_page('/signage?venue=sign-white&sheet=poster', 390, 844, True)
    try:
        time.sleep(1.5); until(sid, '/Found/.test(document.getElementById("status").textContent)', 15); time.sleep(0.4)
        g = json.loads(ask(sid, RO) or '{}'); pk = g.get('picks') or []
        ok('at 390 wide the three tiles still share one row', len(pk) == 3 and max(p['t'] for p in pk) - min(p['t'] for p in pk) <= 1 and max(p['w'] for p in pk) - min(p['w'] for p in pk) <= 1, pk)
    finally:
        B.close_tab(tid)

    print('\nTHE TICKET STUB IS ONE BLOCK (Dean, 24 Oct 2026): logo, name and code centred as a group, on every sheet, with or without a logo')
    STUB = r"""(function(){var out=[];document.querySelectorAll(".sheet:not(.hidden) [data-art]").forEach(function(a){
      if(a.getBoundingClientRect().width===0) return;
      var ch=a.querySelector(".chrome"),c=ch.getBoundingClientRect(),R=function(e){var b=e.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom};};
      var lg=a.querySelector("[data-chrome]"),logo=(lg&&!lg.hidden&&lg.getBoundingClientRect().width>0)?R(lg):null;
      var name=R(a.querySelector(".cname")),stub=R(a.querySelector(".cstub")),parts=[name,stub].concat(logo?[logo]:[]);
      var g={l:Math.min.apply(null,parts.map(function(p){return p.l;})),r:Math.max.apply(null,parts.map(function(p){return p.r;})),t:Math.min.apply(null,parts.map(function(p){return p.t;})),b:Math.max.apply(null,parts.map(function(p){return p.b;}))};
      out.push({wide:a.classList.contains("wide"),c:{l:c.left,r:c.right,t:c.top,b:c.bottom,w:c.width,h:c.height},g:g,logo:logo,name:name,stub:stub});
    });return JSON.stringify(out);})()"""
    def cx(r): return (r['l'] + r['r']) / 2.0
    def cy(r): return (r['t'] + r['b']) / 2.0
    for slug, what in (('sign-white', 'a square logo'), ('sign-gold', 'a wide wordmark'), ('sign-none', 'no logo')):
        for sheet in ('poster', 'cards', 'tents'):
            m, sid, tid = sign_open(slug, sheet, 'ticket-light')
            try:
                arts = json.loads(ask(sid, STUB) or '[]')
                tag = 'Ticket %s, %s' % (sheet, what)
                if not arts:
                    ok(tag + ': the stub is measured', False); continue
                off = [abs(cx(a['g']) - cx(a['c'])) / a['c']['w'] for a in arts]
                ok(tag + ': the group (logo, name, code) is centred in the stub on every sign (%d signs, worst %.1f%% off)' % (len(arts), max(off) * 100), max(off) <= 0.01, off)
                if slug != 'sign-none':
                    ok(tag + ': every sign shows the logo in the stub', all(a['logo'] for a in arts), [bool(a['logo']) for a in arts])
                    if sheet == 'tents':
                        d = [abs(cx(a['logo']) - cx({'l': min(a['name']['l'], a['stub']['l']), 'r': max(a['name']['r'], a['stub']['r'])})) / a['c']['w'] for a in arts if a['logo']]
                        ok(tag + ': the logo and the words share one centre line (stacked)', d and max(d) <= 0.01, d)
                    else:
                        d = [abs(cy(a['logo']) - cy({'t': a['name']['t'], 'b': a['stub']['b']})) / a['c']['h'] for a in arts if a['logo']]
                        ok(tag + ': the logo sits level with the words beside it, as one row', d and max(d) <= 0.06, d)
                        e = [abs(a['name']['l'] - a['stub']['l']) for a in arts]
                        ok(tag + ': the name and the code share one left edge', max(e) <= 1.5, e)
            finally:
                B.close_tab(tid)

    # Print pressed while the logo is still downloading: the dialog waits for the picture AND its reading.
    tid, sid = open_page('/signage?venue=sign-slow&sheet=poster&design=column-light', 1100, 1500, False)
    try:
        until(sid, 'document.querySelector(".sheet:not(.hidden) [data-chrome]") && !!document.querySelector(".sheet:not(.hidden) [data-chrome]").getAttribute("src")', 15)
        ask(sid, 'window.__atPrint=null; window.print=function(){ var i=document.querySelector(".sheet:not(.hidden) [data-chrome]"); '
                 'window.__atPrint=JSON.stringify({done:i.complete&&i.naturalWidth>0, tone:i.getAttribute("data-tone"), bg:getComputedStyle(i).backgroundColor}); }; '
                 'document.getElementById("printBtn").click(); true')
        v = until(sid, 'window.__atPrint', 10)
        at = json.loads(v) if v else {}
        ok('Print pressed while a white logo is still downloading: the dialog opens only once it has arrived and sits on its plate',
           at.get('done') and at.get('tone') == 'light' and at.get('bg') == BLACK_PLATE, at or 'print never called')
    finally:
        B.close_tab(tid)


try:
    sign_checks()
    if os.environ.get('VP_SIGNS_ONLY'): raise SystemExit(print('\n' + (('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED (signs only)' % ran))) or (1 if bad else 0))
    print('\nTHE TV: every logo shape, swapped on the live mark')
    tv('bingo', '/tv?demo=1', 1920, 1080, 8, ['square', 'wide', 'round', 'tall', 'red', 'navy'])
    mark_check('bingo', '/tv?demo=1', 1920, 1080, True)
    mark_check('trivia', '/app/trivia/screen.html?demo=1', 1920, 1080, False)
    tv('trivia', '/app/trivia/screen.html?demo=1', 1920, 1080, 5, ['square', 'wide', 'tall'])
    tv('musical', '/app/musical/screen.html?demo=1', 1920, 1080, 5, ['square', 'wide', 'tall'])
    tv('bingo', '/tv?demo=1', 1280, 720, 8, ['square', 'wide'])
    tv('trivia', '/app/trivia/screen.html?demo=1', 1280, 720, 5, ['square', 'wide'])

    print('\nthe same ink, whatever the shape')
    sq, wd = AREAS.get(('bingo', 1920, 'square')), AREAS.get(('bingo', 1920, 'wide'))
    rd = AREAS.get(('bingo', 1920, 'round'))
    ok('1920 bingo: the square logo is more than twice the old 56px box on each side', bool(sq) and sq >= 112 * 112, sq)
    ok('1920 bingo: square, wide and round painted areas within 15% of each other',
       bool(sq and wd and rd) and max(sq, wd, rd) <= 1.15 * min(sq, wd, rd), (sq, wd, rd))

    print('\nTHE PHONE: the logo in the header, and room either side of the brand')
    phone_logo('play', '/play?room=TUGUN2', 390, 844)
    phone_logo('play', '/play?room=TUGUN2', 320, 640)
    phone_logo('trivia/play', '/app/trivia/play.html?room=TUGUN2', 390, 844)
    phone_logo('musical/play', '/app/musical/play.html?room=TUGUN2', 320, 640)
    phone_header('play', '/play?demo=1', 320, 640)
    phone_header('play', '/play?demo=1', 390, 844)
    phone_header('trivia/play', '/app/trivia/play.html?demo=1', 320, 640)
    phone_header('musical/play', '/app/musical/play.html?demo=1', 320, 640)
    phone_header('musical/play', '/app/musical/play.html?demo=1', 390, 844)
finally:
    B.close()
    srv.shutdown()

print('')
print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
