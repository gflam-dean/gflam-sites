#!/usr/bin/env python3
"""MUSICAL BINGO, THE NEW LOOK, AS CHROME PAINTS IT (Dean, 3 Nov 2026; built 4 Nov for the 5 Nov gate).

The new musical bingo wall and phone were mocked up and approved on 3 Nov (venue-enrich/reports/new-look-games-3nov,
v5/tv/05, 06, 13 and v5/phone/m1, m2, m3, j2, j3, f2, j5, a1), with Dean's late notes the same night. This opens the
REAL app/musical/screen.html and app/musical/play.html, served from this checkout, as a venue-linked TV and a phone
that joins by code, with a stand-in game Worker that answers the few routes they ask and the shared fake Realtime
(tools/browser-rig/fake-supabase.js) carrying the host's messages. Real QR codes (the vendored library), Tugun Bowls
Club's round crest and The Pause Bar's 6.6:1 wordmark, at 1920x1080 and 1280x720, and the phone at 375x812.

  TV
    - the join screen is trivia's (the shared /app/vp-tvgame.js): MUSICAL BINGO in Anton on the logos' centre line,
      a real QR for venueplay.com.au/play?venue=..., SCAN TO PLAY, the address, the venue code in a pink-edged box;
      NO player count and no prize on it (Dean, 3 Nov late)
    - now playing: the artwork big on the left, NOW PLAYING in pink, the title in Anton, the artist, ONE sentence for
      the pattern and the prize ("One line wins a meat tray"), "Song 14" bottom left over the last five with artwork,
      the current one outlined in pink and "+9" for the rest, "32 playing" small bottom right; a two-line title fits
      above the artist; nothing under either logo, vp-fit leaves the wall alone, no JOIN NOW card
    - listen: the neon triangle breathing (2.6 s) where the art goes, LISTEN, "Know it? Mark it on your card.", NO
      "Song 15" label under the title (Dean, 3 Nov late), a dashed "Song 15" slot on the strip, the song not named
    - the winner moment is today's (its redesign is a separate job)
  PHONE
    - the code: six boxes, Continue grey until all six are in; the name: option 5 header, YOUR NAME; the details:
      YOUR DETAILS naming the venue with Privacy inline, and the two separate ticks (vp-consent.js, rules unchanged)
    - you're in: the green tick, YOU'RE IN, the name, Up first / Playing, "The game will start here when the host is
      ready."; the venue's ad ("What's on at ...") in ONE place, the same on the lobby and after the game
    - the card (B soft tiles): 25 tiles, 8px gaps, 16px sides, never under 64px, fitting the screen with the claim
      button and our logo; a marked song pink-edged with its tick in its own corner; a long word breaks once with a
      hyphen (Wonder-wall), never mid-word without one; the claim says the pattern, faint until the marks make it
    - the menu: one sheet: Help first, Songs played, Text size, Highlight my lines (off; on draws the finished line
      in the gutter), Mark songs for me, Full screen, Light screen, Leave game
    - the claim: "Sent. The host is checking your card"; after: YOU WON with the prize and the card number, or NOT
      THIS TIME with who won the prize
  HOST CONSOLE (signed in, on the browser rig)
    - the player count is on the console (the TV's join screen no longer shows one)

VP_SHOTS=<dir> also writes every frame measured (the before/after review set). Takes /tmp/vp-heavy.lock first
(VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/musical-newlook-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.environ.get('VP_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # VP_ROOT: another checkout, for "before" frames
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(HERE, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS', '')
FIX = os.environ.get('VP_FIXTURES', '')      # a folder with pause-logo.png and slide-1.png... (the review set only)
CHECKS = not os.environ.get('VP_SHOTS_ONLY')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    if not CHECKS: return
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


def venue_code(slug):
    """The TV's own venueCode(): FNV-1a of the slug, six letters from the join alphabet."""
    s = ''.join(c for c in slug.lower() if c.isalnum()); h = 2166136261
    for ch in s:
        h ^= ord(ch); h = (h * 16777619) & 0xffffffff
    A = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'; x = h or 1; out = ''
    for _ in range(6):
        x = (x * 1103515245 + 12345) & 0xffffffff; out += A[x % len(A)]
    return out


WIDE_LOGO = ('<svg xmlns="http://www.w3.org/2000/svg" width="660" height="100" viewBox="0 0 660 100">'
             '<text x="330" y="78" font-family="Arial Black,Arial" font-size="86" font-weight="900" fill="#fff" text-anchor="middle">PAUSE BAR</text></svg>')
SLIDE = ('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#20335a"/>'
         '<text x="800" y="500" font-family="Arial" font-size="120" fill="#fff" text-anchor="middle">SLIDE %d</text></svg>')
ART = ('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="%s"/></svg>')
ROOM = 'K7MQ2P'
SONGS = ["Bohemian Rhapsody", "Livin' on a Prayer", "Africa", "Mr. Brightside", "The Horses", "Dancing Queen", "Khe Sanh",
         "Hey Ya!", "Never Gonna Give You Up", "Sweet Caroline", "Beds Are Burning", "Eagle Rock", "September", "Take On Me", "Wonderwall"]
CELLS = ["Wonderwall", "Sweet Caroline", "Never Gonna Give You Up", "Don't Stop Believin'", "Beds Are Burning",
         "You're the Voice", "Never Tear Us Apart", "Livin' on a Prayer", "Hey Ya!", "Bohemian Rhapsody",
         "Dancing Queen", "Khe Sanh", "FREE", "Mr. Brightside", "The Horses",
         "Africa", "Take On Me", "Mr. Blue Sky", "Come On Eileen", "Don't Dream It's Over",
         "Blinding Lights", "Uptown Funk", "Hotel California", "September", "Eagle Rock"]
def sid(t): return ''.join(c for c in t.lower() if c.isalnum())

# What the stand-in Worker says, per scene (one page at a time, so one global is enough).
W = {'logo': '/logos/venue-tugun-bowls.png', 'name': 'Tugun Bowls Club', 'collect': {'first_name': True}, 'slides': [], 'winner_pid': None}


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def j(self, obj, code=200): return self.send(code, json.dumps(obj), 'application/json')
    def worker(self, path, body):
        if path == '/screen': return self.j({'exists': True, 'name': W['name'], 'logo_url': W['logo'], 'slides': []})
        if path == '/join/info':
            c = dict({'first_name': True, 'last_name': False, 'postcode': False, 'email': False, 'mobile': False, 'marketing_optin': False}, **W['collect'])
            out = {'format': 'musical_bingo', 'room_code': ROOM, 'channel': '', 'venue_name': W['name'], 'logo_url': W['logo'],
                   'paper_bingo': False, 'age_gate': False, 'collect': c}
            if body.get('ad'): out['slides'] = W['slides']
            return self.j(out)
        if path == '/join': return self.j({'token': 'tok-sam', 'player_id': 'p1', 'snapshot': {'session_id': 'sess-1', 'status': 'lobby', 'game': None}})
        if path == '/player/card':
            cells = [c if c == 'FREE' else {'title': c, 'song_id': sid(c)} for c in CELLS]
            return self.j({'game_id': 'g1', 'card_no': 17, 'pattern': W.get('pattern', 'one_line'), 'cells': cells, 'played_songs': []})
        if path == '/player/claim': return self.j({'auto_verdict': 'valid', 'claim_id': 'c1', 'card_no': 17})
        if path == '/snapshot': return self.j({'status': 'running', 'game': {'format': 'musical_bingo', 'game_id': 'g1'}})
        if path == '/play/live': return self.j({'live': True, 'format': 'musical_bingo', 'join_code': ROOM})
        if path in ('/player/alive', '/feedback'): return self.j({'ok': True})
        return self.j({}, 404)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); raw = self.rfile.read(n)
        u = urllib.parse.urlparse(self.path)
        try: body = json.loads(raw or b'{}')
        except Exception: body = {}
        if u.path.startswith('/__worker'): return self.worker(u.path[len('/__worker'):], body)
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'): return self.worker(u.path[len('/__worker'):], {})
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB={};window.__FAKE_SIGNED_IN=false;window.__FAKE_UID="x";\n'
            return self.send(200, pre + io.open(os.path.join(HERE, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fixture/wide-logo.svg': return self.send(200, WIDE_LOGO, 'image/svg+xml')
        if u.path.startswith('/__fixture/art-'):
            col = '#' + u.path.split('-')[-1].split('.')[0]
            return self.send(200, ART % col, 'image/svg+xml')
        if u.path.startswith('/__fixture/'):
            name = u.path[len('/__fixture/'):]
            if FIX and os.path.isfile(os.path.join(FIX, name)):
                return self.send(200, open(os.path.join(FIX, name), 'rb').read(), 'image/png' if name.endswith('.png') else 'image/jpeg')
            if name.startswith('slide-') or name.startswith('pslide-'):
                return self.send(200, SLIDE % int(''.join(c for c in name if c.isdigit()) or 1), 'image/svg+xml')
            return self.send(404, 'no', 'text/plain')
        p = u.path
        if not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js')
            t = t.replace('https://game.venueplay.com.au', '/__worker')
            # the TV's join QR names the real address, as on a live wall
            t = t.replace('return window.location.origin + "/play";', 'return "https://venueplay.com.au/play";')
            # the stand-in slides are served from here (http), not a venue's https storage
            t = t.replace('var URL_OK = /^https:\\/\\//', 'var URL_OK = /^https?:\\/\\//').replace('var URL_OK = /^https:\\/\\/', 'var URL_OK = /^https?:\\/\\/')
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


FREEZE = r'''(function(){ var a=document.getAnimations?document.getAnimations():[];
  a.forEach(function(x){ try{ var t=x.effect&&x.effect.getComputedTiming(); if(t&&isFinite(t.endTime)) x.finish(); }catch(e){} });
  return a.length; })()'''


class Page(object):
    def __init__(self, B, base, path, w, h, mobile, pre=''):
        self.B = B
        self.tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        self.sid = B.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        B.call('Page.enable', {}, session=self.sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2 if (mobile and SHOTS) else 1, 'mobile': mobile}, session=self.sid)
        if pre: B.call('Page.addScriptToEvaluateOnNewDocument', {'source': pre}, session=self.sid)
        B.call('Page.navigate', {'url': base + path}, session=self.sid)
        self.w, self.h, self.mobile = w, h, mobile
    def js(self, expr, wait=20):
        r = self.B.evaluate(self.sid, expr, wait)
        v = r and r.get('result', {}).get('value')
        return v
    def obj(self, expr):
        v = self.js(expr)
        try: return json.loads(v) if isinstance(v, str) else v
        except Exception: return None
    def until(self, expr, secs=20):
        end = time.time() + secs
        while time.time() < end:
            if self.js('!!(' + expr + ')'): return True
            time.sleep(0.25)
        return False
    def shot(self, name):
        if not SHOTS: return
        self.js(FREEZE); time.sleep(0.3)
        png = base64.b64decode(self.B.call('Page.captureScreenshot', {'format': 'png'}, session=self.sid)['data'])
        open(os.path.join(SHOTS, name + '.png'), 'wb').write(png)
    def close(self): self.B.close_tab(self.tid)


def say(chan, msgs):
    """The host's messages, on the fake Realtime channel the page listens to."""
    return '(function(){ var b=new BroadcastChannel("fake-rt:%s"); %s; b.close(); return true; })()' % (
        chan, ';'.join('b.postMessage({event:"msg",payload:%s})' % json.dumps(m) for m in msgs))


TV_PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); if(!(b.width>0&&b.height>0)) return null; return [b.left,b.top,b.right,b.bottom]; }
  function vis(e){ if(!e) return false; var s=getComputedStyle(e), b=e.getBoundingClientRect(); return s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0; }
  var lay=[].filter.call(document.querySelectorAll(".layer"),function(l){ return !l.classList.contains("hidden") && getComputedStyle(l).display!=="none"; })[0];
  var o={ layer: lay?lay.id:null, tf: lay?(lay.style.transform||""):null, text: lay?lay.innerText:"", W: innerWidth, H: innerHeight };
  var mk=document.querySelector(".tv-corner svg"); o.mark=R(mk);
  var lg=document.getElementById("venueLogo"); o.logo=(lg && lg.style.display!=="none") ? R(lg) : null;
  if(lay){
    var t=lay.querySelector(".toplbl .tl-night"); if(t){ var ts=getComputedStyle(t); o.title={ r:R(t), text:t.textContent, ff:ts.fontFamily, fs:parseFloat(ts.fontSize), col:ts.color, tt:ts.textTransform }; }
    o.qr=R(lay.querySelector(".qrbig")); o.scan=R(lay.querySelector(".scanplay")); o.url=(lay.querySelector(".joinurl")||{}).textContent||"";
    var cb=lay.querySelector(".codebox"); o.cbox=R(cb); o.cboxCol=cb?getComputedStyle(cb).borderTopColor:""; o.code=(lay.querySelector(".codeval")||{}).textContent||"";
    var cv=document.getElementById("qrBig"); o.qrInk=(function(){ try{ var c=cv.getContext("2d"), d=c.getImageData(0,0,cv.width,cv.height).data, k=0; for(var i=0;i<d.length;i+=4) if(d[i]<60) k++; return k/(d.length/4); }catch(e){ return -1; } })();
    o.art=R(document.getElementById("tvArtBox")); o.artImg=vis(document.getElementById("tvNowArt"));
    var eye=document.getElementById("tvNowEye"); o.eye=vis(eye)?{ r:R(eye), text:eye.textContent, col:getComputedStyle(eye).color }:null;
    var nt=document.getElementById("tvNowTitle"); o.ttl=vis(nt)?{ r:R(nt), text:nt.textContent, ff:getComputedStyle(nt).fontFamily, fs:parseFloat(getComputedStyle(nt).fontSize), sh:nt.scrollHeight, ch:nt.clientHeight, mh:parseFloat(getComputedStyle(nt).maxHeight) }:null;
    o.artist=vis(document.getElementById("tvNowArtist"))?R(document.getElementById("tvNowArtist")):null;
    var wn=document.getElementById("tvWins"); o.wins=vis(wn)?{ r:R(wn), text:wn.textContent }:null;
    var sn=document.getElementById("tvSongNo"); o.songno=vis(sn)?{ r:R(sn), text:sn.textContent }:null;
    o.tiles=[].map.call(document.querySelectorAll("#tvBoard .ptok"),function(x){ var s=getComputedStyle(x); return { r:R(x), text:x.textContent, cur:x.classList.contains("new"), bc:s.borderTopColor, img:!!x.querySelector("img"), fit:x.scrollHeight<=x.clientHeight+1 && x.scrollWidth<=x.clientWidth+1 }; });
    var mm=document.getElementById("tvBoardMore"); o.more=vis(mm)?{ r:R(mm), text:mm.textContent }:null;
    var nx=document.getElementById("tvBoardNext"); o.next=vis(nx)?{ r:R(nx), text:nx.textContent, bs:getComputedStyle(nx).borderTopStyle }:null;
    var pl=document.getElementById("tvPlaying"); o.playing=vis(pl)?{ r:R(pl), text:pl.textContent }:null;
    var tri=document.querySelector("#tvArtBox .mtri"); o.tri=vis(tri)?{ r:R(tri), anim:getComputedStyle(tri).animationName, dur:getComputedStyle(tri).animationDuration }:null;
    var ls=document.getElementById("tvListen"); o.listen=vis(ls)?{ text:ls.innerText }:null;
    o.bottom=Math.max.apply(null,[].map.call(lay.querySelectorAll("*"),function(e){ if(e.closest(".mplaying")) return 0; var b=e.getBoundingClientRect(); return (b.width>2&&b.height>2&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none")?b.bottom:0; }).concat([0]));
  }
  o.joinCorner=vis(document.getElementById("tvJoinCorner"));
  return JSON.stringify(o);
})()'''


def inside(a, b, tol=0.5):
    return bool(a and b) and a[0] >= b[0] - tol and a[1] >= b[1] - tol and a[2] <= b[2] + tol and a[3] <= b[3] + tol

def apart(a, b, gap=0):
    return bool(a and b) and (a[2] + gap <= b[0] or b[2] + gap <= a[0] or a[3] + gap <= b[1] or b[3] + gap <= a[1])


def title_checks(tag, x, w):
    t = x.get('title') or {}
    ok('%s: the game\'s name says MUSICAL BINGO, in Anton, white, capitals' % tag,
       t.get('text', '').strip().lower() == 'musical bingo' and 'Anton' in t.get('ff', '') and t.get('col') == 'rgb(255, 255, 255)' and t.get('tt') == 'uppercase', t)
    ok('%s: the one title size trivia uses (2.6%% of the width), big enough for the back of the room' % tag, abs(t.get('fs', 0) - 0.026 * w) <= 0.6, t.get('fs'))
    G, M, L = t.get('r'), x.get('mark'), x.get('logo')
    ok('%s: on the same centre line as the corner logos (within 2px of ours)' % tag, bool(G and M) and abs((G[1] + G[3]) / 2 - (M[1] + M[3]) / 2) <= 2, [G, M])
    ok('%s: clear of the venue\'s logo and of ours' % tag, bool(G and M and L) and G[0] >= L[2] + 8 and G[2] + 8 <= M[0], [L, G, M])


def tv(B, base, w, h, logo, tag, shots):
    W['logo'] = logo; W['name'] = 'Tugun Bowls Club'
    slug = 'tugun-bowls-club'
    chan = 'vp-' + venue_code('musical-' + slug)
    pre = 'try{ sessionStorage.setItem("vpTvHop","1"); }catch(e){}'
    P = Page(B, base, '/app/musical/screen.html?venue=' + slug, w, h, False, pre)
    tagn = '%s %dx%d' % (tag, w, h)
    try:
        P.until('document.getElementById("tvLobby") && window.VPTvGame', 20); time.sleep(1.5)
        P.js(say(chan, [{'t': 'host_here'}, {'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': [], 'playerCount': 32},
                        {'t': 'players', 'count': 32}]))
        P.until('document.getElementById("tvLobby") && !document.querySelector(".tvhold")', 10); time.sleep(1.2)
        j = P.obj(TV_PROBE) or {}
        P.shot(shots + '-tv-join')
        print('\nTHE MUSICAL BINGO WALL, %s' % tagn)
        ok(tagn + ': a host in the lobby: the join screen is up (not the waiting card)', j.get('layer') == 'tvLobby', j.get('layer'))
        title_checks(tagn + ' join', j, w)
        ok(tagn + ' join: a real QR, drawn (dark modules on the white tile)', 0.25 < (j.get('qrInk') or 0) < 0.75, j.get('qrInk'))
        ok(tagn + ' join: the QR is trivia\'s: 31.25% of the width, square, at 10.6% from the left', bool(j.get('qr')) and abs((j['qr'][2] - j['qr'][0]) - 0.3125 * w) <= 2 and abs(j['qr'][0] - 0.106 * w) <= 2, j.get('qr'))
        ok(tagn + ' join: SCAN TO PLAY, "or go to venueplay.com.au/play", and the venue code in a pink-edged box',
           bool(j.get('scan')) and j.get('url', '').strip() == 'or go to venueplay.com.au/play' and j.get('code') == venue_code(slug) and j.get('cboxCol') == 'rgb(255, 31, 142)', [j.get('url'), j.get('code'), j.get('cboxCol')])
        ok(tagn + ' join: SCAN TO PLAY, the address and the code box on one centre line', bool(j.get('scan') and j.get('cbox')) and abs((j['scan'][0] + j['scan'][2]) / 2 - (j['cbox'][0] + j['cbox'][2]) / 2) <= 2, [j.get('scan'), j.get('cbox')])
        ok(tagn + ' join: NO player count on the TV, though 32 are in (Dean, 3 Nov late), and no prize', 'playing' not in j.get('text', '').lower() and '32' not in j.get('text', '') and 'meat tray' not in j.get('text', '').lower(), j.get('text'))
        ok(tagn + ' join: vp-fit leaves the wall alone', (j.get('tf') or '') == '', j.get('tf'))
        # 14 songs played; the 14th on the wall
        played = SONGS[:14]
        P.js(say(chan, [{'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'played': []}]))
        time.sleep(0.6)
        for i, s in enumerate(played):
            P.js(say(chan, [{'t': 'played', 'title': s, 'artist': 'Daryl Braithwaite' if s == 'Mr. Brightside' else 'The Band', 'artworkUrl': '/__fixture/art-%02x%02x%02x.svg' % (40 + i * 12, 60, 120 - i * 5), 'played': played[:i + 1], 'reveal': 'instant', 'replay': True}]))
            time.sleep(0.08)
        P.js(say(chan, [{'t': 'players', 'count': 32}]))
        time.sleep(1.5)
        n = P.obj(TV_PROBE) or {}
        P.shot(shots + '-tv-now-playing')
        ok(tagn + ' now playing: the playing wall is up', n.get('layer') == 'tvRun', n.get('layer'))
        title_checks(tagn + ' now playing', n, w)
        A = n.get('art')
        ok(tagn + ' now playing: the artwork big on the left, 33.3% of the width square, at 6.25% in and 9.2% down, the picture in it',
           bool(A) and abs((A[2] - A[0]) - w / 3.0) <= 2 and abs((A[3] - A[1]) - w / 3.0) <= 2 and abs(A[0] - 0.0625 * w) <= 2 and abs(A[1] - 0.0917 * w) <= 2 and n.get('artImg'), A)
        e = n.get('eye') or {}
        ok(tagn + ' now playing: NOW PLAYING in pink, right of the art', e.get('text', '').strip().lower() == 'now playing' and e.get('col') == 'rgb(255, 31, 142)' and bool(A and e.get('r')) and e['r'][0] >= A[2] + 0.03 * w, e)
        tl = n.get('ttl') or {}
        ok(tagn + ' now playing: the title in Anton, the song that is playing', tl.get('text') == played[-1] and 'Anton' in tl.get('ff', ''), tl)
        ok(tagn + ' now playing: one sentence for the pattern and the prize: "One line wins a Meat tray"', (n.get('wins') or {}).get('text') == 'One line wins a Meat tray', n.get('wins'))
        R = [tl.get('r'), n.get('artist'), (n.get('wins') or {}).get('r')]
        ok(tagn + ' now playing: title, artist and sentence in that order, none touching the next', all(R) and R[0][3] <= R[1][1] + 1 and R[1][3] <= R[2][1] + 1, R)
        sn = n.get('songno') or {}
        ok(tagn + ' now playing: "Song 14" bottom left, over the strip', sn.get('text') == 'Song 14' and bool(sn.get('r') and A) and abs(sn['r'][0] - A[0]) <= 1 and sn['r'][1] > A[3], sn)
        T = n.get('tiles') or []
        ok(tagn + ' now playing: the strip is the last five, with their artwork, the current one outlined in pink',
           [t['text'] for t in T] == played[-5:] and all(t['img'] for t in T) and [t['cur'] for t in T] == [False] * 4 + [True] and T[-1]['bc'] == 'rgb(255, 31, 142)', [(t['text'], t['cur'], t['bc'], t['img']) for t in T])
        ok(tagn + ' now playing: "+9" for the nine before them, first on the strip', (n.get('more') or {}).get('text') == '+9' and bool(T and n['more']['r'][2] <= T[0]['r'][0]), n.get('more'))
        ok(tagn + ' now playing: every tile on the screen, in one row, under "Song 14", the strip within the art\'s margins', bool(T) and all(t['r'] and t['r'][2] <= w - 0.0625 * w + 1 and abs(t['r'][1] - T[0]['r'][1]) <= 1 for t in T) and T[0]['r'][1] >= sn['r'][3], [t['r'] for t in T] + [sn.get('r')])
        ok(tagn + ' now playing: every title whole inside its tile (a long one steps down, never cut)', all(t.get('fit') for t in T), [(t['text'], t.get('fit')) for t in T])
        pl = n.get('playing') or {}
        ok(tagn + ' now playing: "32 playing" small in the bottom-right corner', pl.get('text', '').strip() == '32 playing' and bool(pl.get('r')) and pl['r'][2] <= w and pl['r'][2] >= w - 0.04 * w and pl['r'][3] <= h and pl['r'][1] >= T[0]['r'][3] - 1, pl)
        ok(tagn + ' now playing: nothing runs under the venue\'s logo or ours', all(apart(r, n.get('logo')) and apart(r, n.get('mark')) for r in [A, tl.get('r'), e.get('r'), sn.get('r')] + [t['r'] for t in T]), [n.get('logo'), n.get('mark')])
        ok(tagn + ' now playing: the wall ends inside the screen and vp-fit leaves it alone', (n.get('bottom') or 0) <= h and (n.get('tf') or '') == '', [n.get('bottom'), n.get('tf')])
        ok(tagn + ' now playing: no JOIN NOW card over the strip (the approved wall)', not n.get('joinCorner'))
        # a long title: two lines, still above the artist
        P.js(say(chan, [{'t': 'played', 'title': 'Never Gonna Give You Up', 'artist': 'Rick Astley', 'artworkUrl': '/__fixture/art-603070.svg', 'played': played + ['Never Gonna Give You Up'], 'reveal': 'instant', 'replay': True}]))
        time.sleep(1.2)
        l2 = P.obj(TV_PROBE) or {}
        P.shot(shots + '-tv-now-playing-two-lines')
        t2 = l2.get('ttl') or {}
        ok(tagn + ' two lines: a long title wraps whole words onto two lines and fits its box (nothing cut off)',
           bool(t2.get('r')) and (t2['r'][3] - t2['r'][1]) > 1.5 * t2.get('fs', 999) * 0.9 and t2.get('sh', 0) <= t2.get('mh', 0) + 1 and t2.get('fs', 0) >= 0.06 * w, t2)
        ok(tagn + ' two lines: and still sits above the artist and the sentence', bool(t2.get('r') and l2.get('artist')) and t2['r'][3] <= l2['artist'][1] + 1 and (l2.get('wins') or {}).get('r') and l2['wins']['r'][3] <= (l2.get('songno') or {'r': [0, h, 0, h]})['r'][1], [t2.get('r'), l2.get('artist'), (l2.get('wins') or {}).get('r')])
        # listen: song 16 held back
        allp = played + ['Never Gonna Give You Up', 'Khe Sanh']
        P.js(say(chan, [{'t': 'played', 'title': 'Khe Sanh', 'artist': 'Cold Chisel', 'artworkUrl': '/__fixture/art-a03030.svg', 'played': allp, 'reveal': 'never', 'replay': True}]))
        time.sleep(1.2)
        L = P.obj(TV_PROBE) or {}
        P.shot(shots + '-tv-listen')
        tri = L.get('tri') or {}
        ok(tagn + ' listen: the neon triangle where the art goes, breathing on its 2.6 s glow', bool(tri.get('r')) and inside(tri['r'], L.get('art'), 2) and tri.get('anim') == 'mTriBreath' and tri.get('dur') == '2.6s', tri)
        ok(tagn + ' listen: LISTEN, then "Name that tune." for a host who reveals by hand', (L.get('listen') or {}).get('text', '').replace('\n', ' ').strip().lower().startswith('listen'), L.get('listen'))
        ok(tagn + ' listen: no "Song 16" (or NOW PLAYING) label under the game\'s name (Dean, 3 Nov late)', L.get('eye') is None, L.get('eye'))
        ok(tagn + ' listen: the song is not named anywhere on the wall', 'khe sanh' not in L.get('text', '').lower(), L.get('text', '')[-200:])
        ok(tagn + ' listen: the strip keeps a dashed "Song 16" for it after the four before', (L.get('next') or {}).get('text') == 'Song 16' and (L.get('next') or {}).get('bs') == 'dashed' and len(L.get('tiles') or []) == 4, [L.get('next'), len(L.get('tiles') or [])])
        ok(tagn + ' listen: "Song 16" bottom left, the count still there', (L.get('songno') or {}).get('text') == 'Song 16' and (L.get('playing') or {}).get('text', '').strip() == '32 playing', [L.get('songno'), L.get('playing')])
        # the listen line as most hosts run it
        P.js(say(chan, [{'t': 'played', 'title': 'Sweet Caroline', 'artist': 'Neil Diamond', 'artworkUrl': '/__fixture/art-305080.svg', 'played': allp + ['Sweet Caroline'], 'reveal': 'end', 'replay': True}]))
        time.sleep(1)
        L2 = P.obj(TV_PROBE) or {}
        P.shot(shots + '-tv-listen-know-it')
        ok(tagn + ' listen: "Know it? Mark it on your card." and the sentence', 'know it?' in (L2.get('listen') or {}).get('text', '').lower() and 'mark it on your card.' in (L2.get('listen') or {}).get('text', '').lower() and (L2.get('wins') or {}).get('text') == 'One line wins a Meat tray', [L2.get('listen'), L2.get('wins')])
        P.js(say(chan, [{'t': 'reveal', 'title': 'Sweet Caroline', 'artist': 'Neil Diamond', 'artworkUrl': '/__fixture/art-305080.svg'}]))
        time.sleep(1)
        rv = P.obj(TV_PROBE) or {}
        ok(tagn + ' reveal: the host reveals it: its title, its art, and it joins the strip outlined', (rv.get('ttl') or {}).get('text') == 'Sweet Caroline' and rv.get('artImg') and (rv.get('tiles') or [{}])[-1].get('text') == 'Sweet Caroline' and rv['tiles'][-1]['cur'], [(rv.get('ttl') or {}).get('text'), rv.get('artImg')])
        # the winner, as today
        P.js(say(chan, [{'t': 'claim_pending', 'name': 'Sam', 'count': 1}]))
        time.sleep(0.8)
        P.shot(shots + '-tv-claim')
        P.js(say(chan, [{'t': 'winner', 'name': 'Sam', 'cardNos': [17]}]))
        time.sleep(2.5)
        wn = P.obj(TV_PROBE) or {}
        P.shot(shots + '-tv-winner-as-today')
        ok(tagn + ' winner: today\'s winner moment, with the name and the prize (its redesign is a separate job)', wn.get('layer') == 'tvWin' and 'sam' in wn.get('text', '').lower() and 'meat tray' in wn.get('text', '').lower(), wn.get('text'))
    finally:
        P.close()


PHONE_PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); if(!(b.width>0&&b.height>0)) return null; return [b.left,b.top,b.right,b.bottom]; }
  function vis(e){ if(!e) return false; var s=getComputedStyle(e), b=e.getBoundingClientRect(); return s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0; }
  var view=[].filter.call(document.querySelectorAll(".view"),function(v){ return !v.classList.contains("hidden"); })[0];
  var small=[];
  [document.querySelector(".ptop"), document.getElementById("hdr2"), view, document.getElementById("vpAd")].forEach(function(root){ if(!root) return;
    [].forEach.call(root.querySelectorAll("*"),function(e){
      var own=""; for(var c=e.firstChild;c;c=c.nextSibling) if(c.nodeType===3) own+=c.nodeValue;
      var bb=e.getBoundingClientRect(); if(!own.trim() || !vis(e) || bb.width<=2 || bb.height<=2) return;   /* words kept for a screen reader are 1px */
      if(e.closest && e.closest(".cc,.vp-feedback,[data-vp-feedback],.vpfb,#vpConnBar,.bingonote")) return;
      var fs=parseFloat(getComputedStyle(e).fontSize); if(fs<15) small.push((e.id||e.className||e.tagName)+" "+fs+"px \""+own.trim().slice(0,20)+"\""); });
  });
  var o={ view:view?view.id:null, small:small, all:view?view.innerText:"", head:(document.querySelector(".ptop")||{}).innerText||"", W:innerWidth, H:innerHeight,
    logo:(function(){ var l=document.getElementById("venueLogo"); return l && !l.classList.contains("hidden") ? R(l) : null; })(),
    menu:R(document.getElementById("menuBtn")), dot:R(document.getElementById("statusDot")), foot:R(document.querySelector(".pfoot svg")),
    row2:vis(document.getElementById("hdr2")) ? { r:R(document.getElementById("hdr2")), pat:document.getElementById("hdrPat").textContent, prize:document.getElementById("hdrPrize").textContent, pr:R(document.getElementById("hdrPat")) } : null,
    ad:vis(document.getElementById("vpAd")) ? { r:R(document.getElementById("vpAd")), k:(document.querySelector("#vpAd .k")||{}).textContent||"", n:document.querySelectorAll("#vpAd .slide").length } : null,
    scrollH:document.documentElement.scrollHeight };
  if(view && view.id==="vNoRoom"){ o.boxes=[].map.call(document.querySelectorAll("#codeBoxes .box"),function(b){ return { r:R(b), t:b.textContent }; }); o.cont=document.getElementById("roomBtn").disabled; o.contBg=getComputedStyle(document.getElementById("roomBtn")).backgroundColor; }
  if(view && view.id==="vJoin"){ o.headWords=document.getElementById("joinHead").textContent; o.notice=vis(document.getElementById("joinNotice"))?document.getElementById("joinNotice").innerText:""; o.privacy=!!document.querySelector("#joinNotice a[href='/privacy']");
    o.ticks=[].map.call(document.querySelectorAll("#joinExtra .optin"),function(l){ return l.innerText.trim(); }); o.join=document.getElementById("joinBtn").textContent; o.joinBg=getComputedStyle(document.getElementById("joinBtn")).backgroundColor; }
  if(view && view.id==="vCard"){
    var cs=[].slice.call(document.querySelectorAll("#cardGrid .cc"));
    o.cells=cs.map(function(c){ var t=c.querySelector(".ct")||c, tb=t.getBoundingClientRect(), cb=c.getBoundingClientRect(), s=getComputedStyle(c), a=getComputedStyle(c,"::after");
      return { r:[cb.left,cb.top,cb.right,cb.bottom], t:[tb.left,tb.top,tb.right,tb.bottom], txt:t.textContent, fs:parseFloat(s.fontSize), daub:c.classList.contains("daub"), free:c.classList.contains("free"), bc:s.borderTopColor, tick:a.content!=="none"&&a.content!=="" ? [cb.right-5-parseFloat(a.width), cb.top+5, cb.right-5, cb.top+5+parseFloat(a.height)] : null, sw:t.scrollWidth, cw:t.clientWidth, lines:Math.round(tb.height/(parseFloat(s.fontSize)*1.08)) }; });
    var b=document.getElementById("bingoBtn"); o.btn={ r:R(b), text:b.textContent, faint:b.classList.contains("faint"), dis:b.disabled, bg:getComputedStyle(b).backgroundColor, rad:getComputedStyle(b).borderTopLeftRadius };
    o.note=vis(document.getElementById("bingoNote"))?document.getElementById("bingoNote").textContent:"";
    o.hl=[].map.call(document.querySelectorAll("#cardWrap .hl"),function(e){ return { r:R(e), need:e.classList.contains("need"), bs:getComputedStyle(e).borderTopStyle }; });
  }
  var mp=document.getElementById("menuPanel");
  if(mp && !mp.classList.contains("hidden")){ o.menu2={ sheet:R(mp.querySelector(".vp-sheet")), rows:[].filter.call(mp.querySelectorAll("#menuList > .menuitem"),vis).map(function(x){ return x.innerText.replace(/\s+/g," ").trim(); }),
     hl:document.getElementById("hlChk").checked, assist:document.getElementById("assistChk").checked }; }
  return JSON.stringify(o);
})()'''


def phone_frame_checks(tag, x, logo_kind):
    ok('%s: nothing in the header, the screen or the ad is under 15px' % tag, not x.get('small'), x.get('small'))
    L, M, D = x.get('logo'), x.get('menu'), x.get('dot')
    if logo_kind:
        ok('%s: the venue\'s logo top left, the menu top right, the green dot beside it' % tag,
           bool(L and M and D) and L[0] <= 22 and M[2] >= x['W'] - 20 and D[2] <= M[0] and abs((D[1] + D[3]) / 2 - (M[1] + M[3]) / 2) <= 2 and apart(L, D, 6), [L, D, M])
    ok('%s: no player name in the header' % tag, 'sam' not in (x.get('head') or '').lower(), x.get('head'))
    F = x.get('foot')
    ok('%s: our venueplay logo small at the foot, inside the screen' % tag, bool(F) and F[3] <= x['H'] + 0.5 and F[1] > x['H'] * 0.75 and (F[2] - F[0]) <= 140, F)


def phone(B, base, logo, tag, shots, full, name='Tugun Bowls Club', sp='slide'):
    W['logo'] = logo; W['name'] = name
    W['collect'] = {'first_name': True}
    W['slides'] = [{'image_url': base + '/__fixture/%s-%d.png' % (sp, i)} for i in (1, 2, 3, 4, 5)]
    pre = 'try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}'
    print('\nTHE MUSICAL BINGO PHONE, %s, 375x812' % tag)
    if full:
        P = Page(B, base, '/app/musical/play.html', 375, 812, True, pre)
        try:
            P.until('document.getElementById("vNoRoom") && !document.getElementById("vNoRoom").classList.contains("hidden")', 20); time.sleep(0.8)
            P.js('(function(){ var i=document.getElementById("roomIn"); i.focus(); i.value="K7M"; i.dispatchEvent(new Event("input")); return 1; })()'); time.sleep(0.3)
            c1 = P.obj(PHONE_PROBE) or {}
            P.shot(shots + '-phone-1-code-part')
            P.js('(function(){ var i=document.getElementById("roomIn"); i.value="K7MQ2P"; i.dispatchEvent(new Event("input")); return 1; })()'); time.sleep(0.3)
            c2 = P.obj(PHONE_PROBE) or {}
            P.shot(shots + '-phone-2-code-full')
            ok('code: six boxes in one row, the letters typed so far in them', len(c1.get('boxes') or []) == 6 and ''.join(b['t'] for b in c1['boxes']) == 'K7M' and len(set(round(b['r'][1]) for b in c1['boxes'])) == 1, c1.get('boxes'))
            ok('code: Continue is grey until all six are in, then pink', c1.get('cont') is True and c2.get('cont') is False and c2.get('contBg') == 'rgb(255, 31, 142)' and c1.get('contBg') != c2.get('contBg'), [c1.get('cont'), c1.get('contBg'), c2.get('cont'), c2.get('contBg')])
            ok('code: no venue logo yet (the venue is not known until the code is), no pattern row', c2.get('logo') is None and c2.get('row2') is None, [c2.get('logo'), c2.get('row2')])
            ok('code: nothing under 15px', not c2.get('small'), c2.get('small'))
        finally:
            P.close()
    # by the QR: straight to the name step
    W['collect'] = {'first_name': True}
    P = Page(B, base, '/app/musical/play.html?room=' + ROOM, 375, 812, True, pre)
    try:
        P.until('document.getElementById("vJoin") && !document.getElementById("vJoin").classList.contains("hidden") && !document.getElementById("venueLogo").classList.contains("hidden")', 20); time.sleep(1)
        P.js(say('vp-' + ROOM, [{'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': []}])); time.sleep(0.4)
        P.js('(function(){ var i=document.getElementById("nameIn"); i.value="Sam"; i.focus(); return 1; })()'); time.sleep(0.3)
        nm = P.obj(PHONE_PROBE) or {}
        P.shot(shots + '-phone-3-name')
        ok('%s name: by the QR the phone goes straight to YOUR NAME (no code step)' % tag, nm.get('view') == 'vJoin' and nm.get('headWords') == 'Your name', [nm.get('view'), nm.get('headWords')])
        phone_frame_checks(tag + ' name', nm, True)
        ok('%s name: row two: the pattern pill and the prize' % tag, (nm.get('row2') or {}).get('pat') == 'One line across' and (nm.get('row2') or {}).get('prize') == 'Meat tray', nm.get('row2'))
        ok('%s name: "Join the game", a pink pill' % tag, nm.get('join') == 'Join the game' and nm.get('joinBg') == 'rgb(255, 31, 142)', [nm.get('join'), nm.get('joinBg')])
        ok('%s name: no ad on the name step' % tag, nm.get('ad') is None, nm.get('ad'))
        P.js('document.getElementById("joinBtn").click()')
        P.until('!document.getElementById("vWait").classList.contains("hidden")', 15); time.sleep(0.3)
        P.js(say('vp-' + ROOM, [{'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': []}, {'t': 'players', 'count': 32}])); time.sleep(1.5)
        wt = P.obj(PHONE_PROBE) or {}
        P.shot(shots + '-phone-4-youre-in')
        ok('%s lobby: YOU\'RE IN, the name, Up first: Musical bingo, Playing: 32' % tag, wt.get('view') == 'vWait' and "you're in" in wt.get('all', '').lower() and 'Sam' in wt.get('all', '') and 'musical bingo' in wt.get('all', '').lower() and '32' in wt.get('all', ''), wt.get('all'))
        ok('%s lobby: the one lobby line every game uses: "The game will start here when the host is ready."' % tag, 'The game will start here when the host is ready.' in wt.get('all', '') and 'your card appears' not in wt.get('all', '').lower(), wt.get('all'))
        ok('%s lobby: row two keeps the pattern and the prize' % tag, (wt.get('row2') or {}).get('prize') == 'Meat tray', wt.get('row2'))
        ok('%s lobby: the venue\'s ad: "What\'s on at <venue>" and its five slides, above our logo' % tag,
           bool(wt.get('ad')) and wt['ad']['k'] == "What's on at " + name and wt['ad']['n'] == 5 and wt['ad']['r'][3] <= (wt.get('foot') or [0, 0, 0, 9999])[1], wt.get('ad'))
        phone_frame_checks(tag + ' lobby', wt, True)
        ok('%s lobby: the whole screen fits without scrolling' % tag, (wt.get('scrollH') or 9999) <= 812 + 1, wt.get('scrollH'))
        # the card
        P.js(say('vp-' + ROOM, [{'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'game_id': 'g1'}]))
        P.until('!document.getElementById("vCard").classList.contains("hidden") && document.querySelectorAll("#cardGrid .cc").length===25', 15); time.sleep(1.5)
        cd = P.obj(PHONE_PROBE) or {}
        C = cd.get('cells') or []
        ok('%s card: 25 tiles, five across' % tag, len(C) == 25 and len(set(round(c['r'][1]) for c in C[:5])) == 1, len(C))
        if len(C) == 25:
            gx = [C[i + 1]['r'][0] - C[i]['r'][2] for i in range(4)]; gy = [C[(i + 1) * 5]['r'][1] - C[i * 5]['r'][3] for i in range(4)]
            ok('%s card: even 8px gaps across and down' % tag, all(abs(g - 8) <= 1 for g in gx + gy), [gx, gy])
            ok('%s card: 16px sides' % tag, abs(C[0]['r'][0] - 16) <= 1 and abs(375 - C[4]['r'][2] - 16) <= 1, [C[0]['r'][0], C[4]['r'][2]])
            hs = [c['r'][3] - c['r'][1] for c in C]
            ok('%s card: every tile at least 64px tall, all the same' % tag, min(hs) >= 64 and max(hs) - min(hs) <= 1, [min(hs), max(hs)])
            ok('%s card: every title inside its tile, never cut' % tag, all(c['free'] or (inside(c['t'], c['r'], 1) and c['sw'] <= c['cw'] + 1) for c in C), [c['txt'] for c in C if not c['free'] and not (inside(c['t'], c['r'], 1) and c['sw'] <= c['cw'] + 1)])
            ww = [c for c in C if c['txt'].replace('­', '') == 'Wonderwall'][0]
            ok('%s card: a long word breaks once, with a hyphen, where it cannot fit whole (Wonder-wall)' % tag, ww['txt'].count('­') == 1 and ww['txt'].index('­') == 6, repr(ww['txt']))
            ok('%s card: titles from 20px down, and no song under 11px' % tag, max(c['fs'] for c in C if not c['free']) <= 20 and min(c['fs'] for c in C if not c['free']) >= 11, sorted(c['fs'] for c in C if not c['free'])[:4])
            ok('%s card: Free in the middle, in pink' % tag, C[12]['free'] and C[12]['txt'].strip() == 'Free', C[12]['txt'])
        bt = cd.get('btn') or {}
        ok('%s card: the claim is a pink pill saying the pattern, "I\'ve got a line", faint before the marks make a line' % tag, bt.get('text') == "I've got a line" and bt.get('faint') is True and float((bt.get('rad') or '0px').replace('px', '')) >= 28, bt)
        ok('%s card: card, button and our logo all fit the screen, no scrolling' % tag, (cd.get('scrollH') or 9999) <= 812 + 1 and bool(bt.get('r') and cd.get('foot')) and bt['r'][3] <= cd['foot'][1], [cd.get('scrollH'), bt.get('r'), cd.get('foot')])
        phone_frame_checks(tag + ' card', cd, True)
        ok('%s card: row two: "One line across" and "Meat tray"' % tag, (cd.get('row2') or {}).get('pat') == 'One line across' and (cd.get('row2') or {}).get('prize') == 'Meat tray', cd.get('row2'))
        ok('%s card: no ad over the card' % tag, cd.get('ad') is None)
        P.shot(shots + '-phone-5-card-new')
        # play the middle row and a few more; mark them by tapping
        middle = ["Dancing Queen", "Khe Sanh", "Mr. Brightside", "The Horses"]
        more = ["Never Gonna Give You Up", "Livin' on a Prayer", "Hey Ya!", "Bohemian Rhapsody", "Africa"]
        pl = []
        for s in more + middle:
            pl.append(s)
            P.js(say('vp-' + ROOM, [{'t': 'played', 'played': pl[:], 'played_ids': [sid(x) for x in pl]}])); time.sleep(0.15)
        for s in more + middle[:3]:
            P.js('(function(){ var c=[].filter.call(document.querySelectorAll("#cardGrid .cc"),function(x){ return (x.textContent||"").replace(/\\u00AD/g,"")===%s; })[0]; if(c) c.click(); return !!c; })()' % json.dumps(s))
            time.sleep(0.05)
        time.sleep(0.6)
        k = P.obj(PHONE_PROBE) or {}
        C = k.get('cells') or []
        mk = [c for c in C if c['daub'] and not c['free']]
        ok('%s card: a marked song: pink edge, a tick in its own corner, the title clear of the tick' % tag,
           len(mk) == 8 and all(c['bc'] == 'rgb(255, 31, 142)' and c['tick'] and apart(c['t'], c['tick']) for c in mk), [(c['txt'], c['bc'], c['tick'], c['t']) for c in mk if not (c['bc'] == 'rgb(255, 31, 142)' and c['tick'] and apart(c['t'], c['tick']))])
        ok('%s card: still faint with the middle row one short' % tag, (k.get('btn') or {}).get('faint') is True, k.get('btn'))
        P.js('(function(){ var c=[].filter.call(document.querySelectorAll("#cardGrid .cc"),function(x){ return (x.textContent||"").replace(/\\u00AD/g,"")==="The Horses"; })[0]; c.click(); return 1; })()'); time.sleep(0.4)
        k2 = P.obj(PHONE_PROBE) or {}
        ok('%s card: the middle row marked: the claim is full pink' % tag, (k2.get('btn') or {}).get('faint') is False and (k2.get('btn') or {}).get('bg') == 'rgb(255, 31, 142)', k2.get('btn'))
        ok('%s card: "Highlight my lines" is off by default: no outlines' % tag, k2.get('hl') == [], k2.get('hl'))
        P.shot(shots + '-phone-6-card-marked')
        # the menu
        P.js('document.getElementById("menuBtn").click()'); time.sleep(0.5)
        mn = P.obj(PHONE_PROBE) or {}
        P.shot(shots + '-phone-7-menu')
        m2 = mn.get('menu2') or {}
        ok('%s menu: one sheet from the bottom of the screen' % tag, bool(m2.get('sheet')) and abs(m2['sheet'][3] - 812) <= 1 and m2['sheet'][0] <= 1, m2.get('sheet'))
        rows = [r.split(' ')[0] for r in m2.get('rows') or []]
        ok('%s menu: Help first, then Songs played, Text size, Highlight my lines, Mark songs for me, Full screen, Light screen, Leave game' % tag,
           [r for r in m2.get('rows') or []][:1] and (m2['rows'][0].startswith('Help') and m2['rows'][1].startswith('Songs played') and m2['rows'][2].startswith('Text size') and m2['rows'][3].startswith('Highlight my lines')
            and m2['rows'][4].startswith('Mark songs for me') and m2['rows'][5].startswith('Full screen') and m2['rows'][6].startswith('Light screen') and m2['rows'][7].startswith('Leave game')), m2.get('rows'))
        ok('%s menu: Songs played says how many so far' % tag, 'Songs played 9 played' in ' '.join(m2.get('rows') or []), m2.get('rows'))
        ok('%s menu: Highlight my lines and Mark songs for me start off' % tag, m2.get('hl') is False and m2.get('assist') is False, m2)
        P.js('(function(){ var c=document.getElementById("hlChk"); c.click(); return c.checked; })()'); time.sleep(0.2)
        P.js('(function(){ var m=document.getElementById("menuPanel"); m.dispatchEvent(new MouseEvent("click",{bubbles:true})); return m.classList.contains("hidden"); })()'); time.sleep(0.4)
        hl = P.obj(PHONE_PROBE) or {}
        H = hl.get('hl') or []; C = hl.get('cells') or []
        row = [C[i]['r'] for i in range(10, 15)] if len(C) == 25 else []
        ok('%s highlight: a tap on the dark closes the sheet; the finished middle row gets ONE solid outline, in the gutter round its tiles' % tag,
           hl.get('menu2') is None and len(H) == 1 and H[0]['bs'] == 'solid' and bool(row) and abs(H[0]['r'][0] - (row[0][0] - 4)) <= 1.5 and abs(H[0]['r'][2] - (row[4][2] + 4)) <= 1.5 and abs(H[0]['r'][1] - (row[0][1] - 4)) <= 1.5 and abs(H[0]['r'][3] - (row[0][3] + 4)) <= 1.5, [H, row[:1], row[4:]])
        P.shot(shots + '-phone-8-card-highlight-on')
        P.js('(function(){ localStorage.setItem("vp-mhl","0"); document.getElementById("hlChk").click(); return 1; })()')
        # the claim
        P.js('document.getElementById("bingoBtn").click()'); time.sleep(1)
        cl = P.obj(PHONE_PROBE) or {}
        P.shot(shots + '-phone-9-claim-sent')
        ok('%s claim: "Sent. The host is checking your card" on the button, which waits' % tag, 'The host is checking your card' in (cl.get('note') or '') and (cl.get('btn') or {}).get('dis') is True, [cl.get('note'), cl.get('btn')])
        # after: someone else wins
        P.js(say('vp-' + ROOM, [{'t': 'winner', 'pid': 'someone-else', 'pids': ['someone-else'], 'name': 'Ann'}])); time.sleep(1.5)
        ls = P.obj(PHONE_PROBE) or {}
        P.shot(shots + '-phone-10-not-this-time')
        ok('%s after: NOT THIS TIME, "Ann won the meat tray."' % tag, ls.get('view') == 'vLost' and 'not this time' in ls.get('all', '').lower() and 'Ann won the meat tray.' in ls.get('all', ''), ls.get('all'))
        ok('%s after: no pattern or prize row once the game is over' % tag, ls.get('row2') is None, ls.get('row2'))
        ok('%s after: the venue\'s ad in the SAME place as on the lobby (one fixed spot)' % tag, bool(ls.get('ad') and wt.get('ad')) and abs(ls['ad']['r'][1] - wt['ad']['r'][1]) <= 1 and abs(ls['ad']['r'][3] - wt['ad']['r'][3]) <= 1, [ls.get('ad'), wt.get('ad')])
        phone_frame_checks(tag + ' after', ls, True)
    finally:
        P.close()
    # a winner's phone
    P = Page(B, base, '/app/musical/play.html?room=' + ROOM, 375, 812, True, pre)
    try:
        P.until('!document.getElementById("vJoin").classList.contains("hidden")', 20); time.sleep(0.6)
        P.js('(function(){ document.getElementById("nameIn").value="Sam"; document.getElementById("joinBtn").click(); return 1; })()')
        P.until('!document.getElementById("vWait").classList.contains("hidden")', 15)
        P.js(say('vp-' + ROOM, [{'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'game_id': 'g1'}]))
        P.until('document.querySelectorAll("#cardGrid .cc").length===25', 15); time.sleep(0.5)
        pid = P.js('(function(){ return localStorage.getItem("vp-mpid-%s"); })()' % ROOM)
        P.js(say('vp-' + ROOM, [{'t': 'winner', 'pid': pid, 'pids': [pid], 'name': 'Sam'}])); time.sleep(2.5)
        wn = P.obj(PHONE_PROBE) or {}
        P.shot(shots + '-phone-11-you-won')
        ok('%s won: YOU WON, the prize, "Show your card to the host", and the card number for the host to check' % tag,
           wn.get('view') == 'vWon' and 'you won' in wn.get('all', '').lower() and 'Meat tray' in wn.get('all', '') and 'host' in wn.get('all', '').lower() and '#17' in wn.get('all', ''), wn.get('all'))
        ok('%s won: the ad in the same one place' % tag, bool(wn.get('ad')), wn.get('ad'))
    finally:
        P.close()
    if full:
        # the venue that collects more: YOUR DETAILS and the two ticks
        W['collect'] = {'first_name': True, 'last_name': True, 'postcode': True, 'email': True, 'marketing_optin': True}
        P = Page(B, base, '/app/musical/play.html?room=' + ROOM, 375, 812, True, pre)
        try:
            P.until('document.getElementById("joinHead").textContent==="Your details"', 20); time.sleep(0.8)
            P.js('(function(){ document.getElementById("nameIn").value="Sam"; return 1; })()')
            dt = P.obj(PHONE_PROBE) or {}
            P.shot(shots + '-phone-3b-details')
            ok('details: YOUR DETAILS, naming the venue, with Privacy inline', dt.get('headWords') == 'Your details' and dt.get('notice', '').startswith('Tugun Bowls Club would like your details. They go to the venue') and dt.get('privacy'), [dt.get('headWords'), dt.get('notice')])
            ok('details: "I\'m 18 or over" and "Keep me posted" as two separate ticks (vp-consent.js)', dt.get('ticks') == ["I'm 18 or over", "Keep me posted on what's on at the venue"], dt.get('ticks'))
            ok('details: nothing under 15px', not dt.get('small'), dt.get('small'))
        finally:
            P.close()
        W['collect'] = {'first_name': True}


def demo(B, base):
    """The sales-page demos still play (see-a-night and the state pages show them)."""
    print('\nTHE SALES-PAGE DEMOS')
    P = Page(B, base, '/app/musical/screen.html?demo=1', 1920, 1080, False)
    try:
        P.until('!document.getElementById("tvRun").classList.contains("hidden")', 20); time.sleep(4)
        d = P.obj(TV_PROBE) or {}
        ok('the wall demo plays its night on the new wall, Tugun\'s crest top left', d.get('layer') == 'tvRun' and bool(d.get('logo')) and (d.get('wins') or {}).get('text') == 'One line wins a Meat tray', [d.get('layer'), d.get('wins')])
        import re as _re
        ok('and never names a table: the claim and the winner are a player\'s name', not _re.search(r'name:"Table', io.open(os.path.join(SITE, 'app/musical/screen.html'), encoding='utf-8').read().split('function demoNight')[1].split('hideChrome')[0]))
    finally:
        P.close()
    P = Page(B, base, '/app/musical/play.html?demo=1', 375, 812, True)
    try:
        P.until('document.querySelectorAll("#cardGrid .cc").length===25', 20); time.sleep(3)
        d = P.obj(PHONE_PROBE) or {}
        ok('the phone demo is on its card, with Tugun\'s crest top left and the prize in row two', d.get('view') == 'vCard' and bool(d.get('logo')) and (d.get('row2') or {}).get('prize') == 'Meat tray', [d.get('view'), d.get('row2')])
    finally:
        P.close()


def host():
    print('\nTHE HOST CONSOLE: the player count is the console\'s')
    sys.path.insert(0, os.path.join(HERE, 'tools', 'browser-rig'))
    import admin_site
    S = admin_site.Site(root=ROOT)
    try:
        V1 = S.W.info['venue']
        tid, sid_ = S.open('/app/musical/host.html?venue=' + V1, 1280, 900, False)
        S.until(sid_, 'document.getElementById("statusText") && /Signed in|TV|screen/.test(document.getElementById("statusText").textContent)', 25)
        time.sleep(1.5)
        a = S.js(sid_, '(function(){ var p=document.getElementById("playerCount"), l=document.getElementById("livePlayers"); return JSON.stringify({ p: !!p, l: !!l, words: (p&&p.closest(".lbl"))?p.closest(".lbl").textContent.replace(/\\s+/g," ").trim():"", status: document.getElementById("statusText").textContent }); })()')
        a = json.loads(a) if isinstance(a, str) else (a or {})
        ok('the console opens signed in, waiting for its TV', bool(a) and any(k in a.get('status', '') for k in ('Signed in', 'TV', 'Waiting for screen')), a)
        ok('the console carries the room\'s player count ("Players (0)") and the live "Playing" box', bool(a) and a.get('p') and a.get('l') and a.get('words', '').startswith('Players'), a)
        S.close_tab(tid)
    finally:
        S.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('musical-newlook-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    pause = '/__fixture/pause-logo.png' if (FIX and os.path.isfile(os.path.join(FIX, 'pause-logo.png'))) else '/__fixture/wide-logo.svg'
    B = VL.Browser()
    try:
        tv(B, base, 1920, 1080, '/logos/venue-tugun-bowls.png', 'Tugun', 'tugun-1920')
        tv(B, base, 1280, 720, '/logos/venue-tugun-bowls.png', 'Tugun', 'tugun-1280')
        tv(B, base, 1920, 1080, pause, 'Pause Bar', 'pause-1920')
        phone(B, base, '/logos/venue-tugun-bowls.png', 'Tugun', 'tugun', True)
        phone(B, base, pause, 'Pause Bar', 'pause', False, 'The Pause Bar', 'pslide')
        demo(B, base)
    finally:
        B.close(); srv.shutdown()
    if CHECKS and not os.environ.get('VP_NO_HOST'):
        host()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
