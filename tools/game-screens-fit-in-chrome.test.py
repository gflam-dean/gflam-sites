#!/usr/bin/env python3
"""EVERY GAME SCREEN FITS ONE PHONE SCREEN, NO SCROLLING (Dean's standing rule, 12 Nov 2026, INBOX 289.4).

Dean, after playing every game live on The Mini Bar: "Everything on a game screen needs to be on one screen. You
shouldn't be scrolling." His phone drifted sideways on the bingo card and on the trivia final screen (INBOX 287.3,
288.3) and the win screen pushed the rest off the bottom.

This opens the REAL player phones served from this checkout, in Chrome, at 375x667 (the smallest iPhone we support)
and 390x844, joins each the way a returning phone is joined (its own saved token), and drives it with the host's own
messages on the fake Realtime channel (tools/browser-rig/fake-supabase.js), so every screen is painted by the page's
own code. A stand-in game Worker answers the routes the phones ask (join info, the musical card, the score, the
rating's id). On every screen below it checks:
  - the page does not scroll down (the document is no taller than the screen) and nothing inside it scrolls either
  - the page does not scroll sideways (scrollWidth == clientWidth, and no element sticks out past the right edge)
  - the screen's own button / answers / feedback ask are on screen

  TRIVIA   a long question with four long answers (counting down), locked in, the result (right and wrong),
           YOU WON (asked only once the host ends the game), and the follow-up open with the line focused; a phone
           that joins late (INBOX 293): "You've joined at question 4. Jump in, this one's yours." on a live question,
           "...the next one's yours." between questions, and the finished question never replayed to it
  BINGO    three tickets with balls called and "One to go" (folded to one open ticket on a short phone), YOU WON
           (not asked during the claim; asked once the host ends the game, INBOX 287.5), the follow-up open, and the
           confetti between the header and our logo, never past the edge
  MUSICAL  the 5x5 card with the claim button (all five columns on screen, no sideways swipe), YOU WON, asked after
           the claim, the follow-up open, and End game with no winner (it says so and asks "How was that?", INBOX 289.1)

Plus, on every screen: no spaced-out capitals (letter-spacing of 0.1em or more on uppercase text: the banned AI
look, INBOX 288.1 / 291), and nothing on the trivia countdown spills out of its ring.

VP_ROOT=<another checkout> serves that one (the "before" frames); VP_SHOTS=<dir> writes every frame;
VP_SHOTS_ONLY=1 takes the frames with no checks. Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait).

    python3 tools/game-screens-fit-in-chrome.test.py
"""
import re, base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.environ.get('VP_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(HERE, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS', '')
CHECKS = not os.environ.get('VP_SHOTS_ONLY')
ONLY = [x for x in os.environ.get('VP_ONLY', '').split(',') if x]

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    if not CHECKS: return
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600]))
    if not cond: bad += 1

ROOM = 'ACDE23'
SESS = '11111111-1111-4111-8111-111111111111'
CELLS = ["Wonderwall", "Sweet Caroline", "Never Gonna Give You Up", "Don't Stop Believin'", "Beds Are Burning",
         "You're the Voice", "Never Tear Us Apart", "Livin' on a Prayer", "Dancing Queen", "Bohemian Rhapsody",
         "Khe Sanh", "Hey Ya!", "FREE", "Take On Me", "Hotel California",
         "Africa", "Mr. Brightside", "Mr. Blue Sky", "Come On Eileen", "Don't Dream It's Over",
         "Blinding Lights", "Uptown Funk", "The Horses", "September", "Eagle Rock"]
def sid(t): return t.lower().replace(' ', '-').replace("'", '').replace('.', '').replace('!', '')
GAME = {'fmt': 'bingo'}


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def j(self, obj, code=200): return self.send(code, json.dumps(obj), 'application/json')
    def worker(self, p, body):
        fmt = GAME['fmt']
        if p == '/join/info':
            return self.j({'format': {'bingo': 'bingo90', 'musical': 'musical_bingo', 'trivia': 'trivia'}[fmt], 'room_code': ROOM,
                           'venue_name': 'The Mini Bar', 'logo_url': '/logos/venue-tugun-bowls.png', 'paper_bingo': False, 'age_gate': False,
                           'collect': {'first_name': True}})
        if p == '/join': return self.j({'token': 'tok-1', 'player_id': 'p1', 'snapshot': {'session_id': SESS, 'status': 'running', 'game': None}})
        if p.startswith('/snapshot'): return self.j({'status': 'running', 'session_id': SESS, 'game': None})
        if p == '/player/card':
            cells = [c if c == 'FREE' else {'title': c, 'song_id': sid(c)} for c in CELLS]
            return self.j({'game_id': 'g-mus', 'card_no': 17, 'pattern': 'one', 'cells': cells, 'played_songs': []})
        if p == '/player/claim': return self.j({'auto_verdict': 'valid', 'claim_id': 'c1', 'card_no': 17})
        if p.startswith('/player/score'): return self.j({'total': 148, 'rank': 1, 'players_count': 2, 'last': {'answered': True, 'is_correct': True, 'points_awarded': 96, 'qseq': 4, 'answer_index': 1}})
        if p == '/feedback': return self.j({'ok': True, 'id': 'f0000000-0000-4000-8000-000000000001'})
        return self.j({'ok': True})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); raw = self.rfile.read(n)
        u = urllib.parse.urlparse(self.path)
        try: body = json.loads(raw or b'{}')
        except Exception: body = {}
        if u.path.startswith('/__worker'): return self.worker(u.path[len('/__worker'):], body)
        if u.path.startswith('/__help'): return self.j({'ok': True})
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'): return self.worker(u.path[len('/__worker'):], {})
        if u.path.startswith('/__help'): return self.j({})
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB={};window.__FAKE_SIGNED_IN=false;window.__FAKE_UID="x";\n'
            return self.send(200, pre + io.open(os.path.join(HERE, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);}};', 'application/javascript')
        p = u.path
        if p.endswith('/'): p += 'index'
        if not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js')
            t = t.replace('/app/vendor/qrcode-1.4.4.min.js', '/__fake/qrcode.js')
            t = t.replace('https://game.venueplay.com.au', '/__worker')
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


# The page's clock is left alone. Every fake Realtime channel the page opens is remembered, so the test can speak
# on it as the host does (window.__say), and the page's errors are kept.
BEFORE = r'''window.VP_HELP_API="/__help"; window.__errs=[];
window.addEventListener("error", function(e){ window.__errs.push(String(e.message||e)); });
(function(){ window.__bc=[]; var BC=window.BroadcastChannel;
  window.__pid=null;
  window.BroadcastChannel=function(n){ if(window.__bc.indexOf(n)<0){ window.__bc.push(n); try{ var l=new BC(n); l.onmessage=function(e){ var m=e.data&&e.data.payload; if(m&&m.t==="join"&&m.pid) window.__pid=m.pid; }; }catch(e){} } return new BC(n); };
  window.__say=function(m){ window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new BC(n); c.postMessage({event:"msg", payload:m}); c.close(); } }); return window.__bc.length; };
})();'''

# What fits and what does not. A screen "scrolls" when the document is taller or wider than the window, or when a
# visible box inside it holds more than it shows and lets you scroll it (overflow auto/scroll). Things that stick
# out past the right edge are named, so a red line says which element to fix.
MEASURE = r'''(function(){
  var de=document.documentElement, b=document.body, W=de.clientWidth, H=window.innerHeight;
  function vis(e){ var s=getComputedStyle(e), r=e.getBoundingClientRect(); return s.display!=="none" && s.visibility!=="hidden" && r.width>0 && r.height>0; }
  function name(e){ return e.tagName.toLowerCase()+(e.id?"#"+e.id:"")+(e.className&&typeof e.className==="string"?"."+e.className.trim().split(/\s+/).slice(0,2).join("."):""); }
  var v=[].filter.call(document.querySelectorAll(".view"), function(x){ return !x.classList.contains("hidden") && vis(x); })[0];
  var wide=[], inner=[], caps=[];
  [].forEach.call(document.querySelectorAll("body *"), function(e){
    if(e.closest && (e.closest(".hidden") || e.closest("[hidden]"))) return;
    if(e.classList && (e.classList.contains("cfetti"))) return;
    if(!vis(e)) return;
    var r=e.getBoundingClientRect(), s=getComputedStyle(e);
    if(s.position==="fixed" && (e.id==="vpHelpBtn" || e.closest("#vpHelp"))) return;
    if(r.right>W+1 || r.left<-1){
      // inside a box that clips it, it cannot make the page wider
      var p=e.parentElement, clipped=false;
      while(p && p!==b){ var ps=getComputedStyle(p); if(/hidden|clip/.test(ps.overflowX)){ var pr=p.getBoundingClientRect(); if(pr.right<=W+1 && pr.left>=-1){ clipped=true; break; } } p=p.parentElement; }
      if(!clipped) wide.push(name(e)+" ["+Math.round(r.left)+","+Math.round(r.right)+"]");
    }
    if(/auto|scroll/.test(s.overflowY) && e.scrollHeight>e.clientHeight+2 && e!==de && e!==b) inner.push(name(e)+" "+e.clientHeight+"/"+e.scrollHeight);
    if(/auto|scroll/.test(s.overflowX) && e.scrollWidth>e.clientWidth+2 && e!==de && e!==b) inner.push(name(e)+" sideways "+e.clientWidth+"/"+e.scrollWidth);
    var ls=parseFloat(s.letterSpacing)||0, fs=parseFloat(s.fontSize)||16, own=[].some.call(e.childNodes,function(n){ return n.nodeType===3 && /[A-Za-z]{2}/.test(n.nodeValue); });
    ["::before","::after"].forEach(function(pe){ var q=getComputedStyle(e,pe), c=q.content;
      if(c && c!=="none" && c!=="normal" && /[A-Za-z]{2}/.test(c) && (parseFloat(q.letterSpacing)||0)>=0.1*(parseFloat(q.fontSize)||16) && (q.textTransform==="uppercase" || /^"[^a-z]*"$/.test(c))) caps.push(name(e)+pe+" "+c+" "+q.letterSpacing); });
    if(own && ls>=0.1*fs && (s.textTransform==="uppercase" || /^[^a-z]*[A-Z]{2}[^a-z]*$/.test(e.textContent.trim()))) caps.push(name(e)+" '"+e.textContent.trim().slice(0,30)+"' "+s.letterSpacing);
  });
  return JSON.stringify({ view: v?v.id:"", W:W, H:H, sh:Math.max(de.scrollHeight,b.scrollHeight), sw:Math.max(de.scrollWidth,b.scrollWidth), sy:window.scrollY, sx:window.scrollX,
    wide:wide.slice(0,8), inner:inner.slice(0,6), caps:caps.slice(0,8), errs:(window.__errs||[]).slice(0,3),
    text:(v?v.innerText:"").replace(/\s+/g," ").slice(0,220) });
})()'''

def rect(sel): return '(function(){ var e=document.querySelector(%s); if(!e) return null; var r=e.getBoundingClientRect(); if(!(r.width>0&&r.height>0)) return null; return [Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]; })()' % json.dumps(sel)


class Page(object):
    def __init__(self, B, url, w, h, ls):
        self.B = B
        self.w, self.h = w, h
        self.tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        self.sid = B.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        B.call('Page.enable', {}, session=self.sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2 if SHOTS else 1, 'mobile': True}, session=self.sid)
        B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'try{ if(!sessionStorage.getItem("__t")){ localStorage.clear(); ' + ls + ' sessionStorage.setItem("__t","1"); } }catch(e){}' + BEFORE}, session=self.sid)
        B.call('Page.navigate', {'url': url}, session=self.sid)
    def js(self, expr, wait=20):
        r = self.B.evaluate(self.sid, expr, wait)
        return r and r.get('result', {}).get('value')
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
    def say(self, *msgs):
        for m in msgs:
            self.js('window.__say(%s)' % json.dumps(m)); time.sleep(0.25)
    def shot(self, name):
        if not SHOTS: return
        time.sleep(0.3)
        png = base64.b64decode(self.B.call('Page.captureScreenshot', {'format': 'png'}, session=self.sid)['data'])
        open(os.path.join(SHOTS, name + '.png'), 'wb').write(png)
    def close(self): self.B.close_tab(self.tid)


CONFETTI = r'''(function(){ var c=document.querySelectorAll(".cfetti"), L=document.getElementById("vpCfLayer"), h=document.querySelector(".ptop"), f=document.querySelector(".pfoot");
  var out=[].filter.call(c, function(x){ return !L || !L.contains(x); }).length, lr=L?L.getBoundingClientRect():null;
  return JSON.stringify({ n:c.length, outside:out, layer: lr?[Math.round(lr.top),Math.round(lr.bottom)]:null, head: h?Math.round(h.getBoundingClientRect().bottom):0,
    foot: f?Math.round(f.getBoundingClientRect().top):0, clip: L?getComputedStyle(L).overflow:"", sw: document.documentElement.scrollWidth, W: document.documentElement.clientWidth }); })()'''

def confetti_ok(P, tag):
    """The win's confetti falls between the header and our logo, clipped, and never makes the page wider (INBOX 287.5 / 287.3)."""
    m = P.obj(CONFETTI) or {}
    ok('%s: the confetti is up (%s pieces), every piece inside its clipped layer' % (tag, m.get('n')), (m.get('n') or 0) > 0 and m.get('outside') == 0 and m.get('clip') == 'hidden', m)
    ok('%s: the layer runs from under the header to above our logo (the logos stay clear)' % tag, bool(m.get('layer')) and m['layer'][0] >= m.get('head', 0) - 1 and m['layer'][1] <= (m.get('foot') or 9999) + 1, m)
    ok('%s: and the page is no wider while it falls' % tag, m.get('sw') == m.get('W'), m)


LOGO_FILE = '/logos/venue-tugun-bowls.png'   # the "uploaded" logo /join/info hands every phone here, for "The Mini Bar"


def venue_logo_ok(P, tag):
    """INBOX 320.2 (Dean, 12 Nov 2026): a venue with an uploaded logo shows THAT FILE in the phone header, never its name
    typed out as a wordmark ("the mini bar." with a pink dot). The file is drawn, has loaded, and no visible header text
    says the venue's name."""
    m = P.obj('(function(){ var i=document.getElementById("venueLogo"), n=document.getElementById("hdrVenueName"), r=i?i.getBoundingClientRect():null;'
              ' var hdr=i?i.closest(".ptop")||i.parentNode.parentNode:null, typed=[];'
              ' if(hdr) [].forEach.call(hdr.querySelectorAll("*"), function(e){ if(e.children.length) return; var t=(e.textContent||"").replace(/[.\s]+/g," ").trim().toLowerCase(); var b=e.getBoundingClientRect();'
              '   if(t==="the mini bar" && b.width>0 && b.height>0 && getComputedStyle(e).visibility!=="hidden") typed.push(e.id||e.className); });'
              ' return JSON.stringify({ src:i?i.getAttribute("src"):null, shown:!!(i && !i.classList.contains("hidden") && r.width>0 && r.height>0), loaded:!!(i && i.complete && i.naturalWidth>0),'
              '   nameShown:!!(n && !n.classList.contains("hidden") && n.getBoundingClientRect().width>0 && n.textContent.trim()), typed:typed }); })()') or {}
    ok('%s: the venue\'s uploaded logo FILE is in the header (%s), loaded, and its name is never typed out instead' % (tag, m.get('src')),
       (m.get('src') or '').endswith(LOGO_FILE) and m.get('shown') is True and m.get('loaded') is True and not m.get('nameShown') and not m.get('typed'), m)


def fits(P, tag, need=()):
    """The screen fits: no scrolling down or sideways, nothing inside it scrolls, no spaced caps; `need` are
    selectors that must be fully on screen."""
    time.sleep(0.6)
    m = P.obj(MEASURE) or {}
    P.shot(tag.replace(' ', '-').replace(':', '').replace('/', '-').lower())
    ok('%s: the page does not scroll down (%s tall on a %s screen)' % (tag, m.get('sh'), m.get('H')), (m.get('sh') or 9999) <= (m.get('H') or 0) + 1, [m.get('view'), m.get('text')])
    ok('%s: the page does not scroll sideways (scrollWidth %s, clientWidth %s)' % (tag, m.get('sw'), m.get('W')),
       m.get('sw') == m.get('W') and not m.get('wide'), m.get('wide'))
    ok('%s: nothing inside the screen scrolls' % tag, not m.get('inner'), m.get('inner'))
    ok('%s: no spaced-out capitals (the banned AI look)' % tag, not m.get('caps'), m.get('caps'))
    for sel in need:
        r = P.js(rect(sel))
        ok('%s: %s is on screen' % (tag, sel), bool(r) and r[1] >= 0 and r[3] <= P.h + 1 and r[0] >= -1 and r[2] <= P.w + 1, r)
    return m


def feedback_steps(P, tag, view, rating_word='Not for me'):
    ok('%s: "How was that?" is asked' % tag, P.until('document.querySelector("#%s .vpfb button[data-rate]")' % view, 10),
       P.js('document.getElementById("%s").innerText.slice(0,200)' % view))
    fits(P, tag + ' asked', ['#%s .vpfb .row' % view])
    P.js('(function(){ var b=[].filter.call(document.querySelectorAll("#%s .vpfb button"), function(x){ return x.getAttribute("aria-label")===%s; })[0]; if(b) b.click(); return !!b; })()' % (view, json.dumps(rating_word)))
    ok('%s: the follow-up opens' % tag, P.until('document.querySelector("#%s .vpfb .more")' % view, 10))
    fits(P, tag + ' follow-up', ['#%s .vpfb .more .acts' % view, '#%s .vpfb textarea' % view])
    # typing: the line takes the focus the way a tap gives it; the page must not move
    P.js('(function(){ var t=document.querySelector("#%s .vpfb textarea"); t.focus(); t.value="It was boring"; t.dispatchEvent(new Event("input")); return 1; })()' % view)
    time.sleep(0.5)
    m = P.obj(MEASURE) or {}
    ok('%s: typing in the line does not scroll the page' % tag, (m.get('sy') or 0) == 0 and (m.get('sx') or 0) == 0 and (m.get('sh') or 9999) <= (m.get('H') or 0) + 1, [m.get('sy'), m.get('sh'), m.get('H')])


def trivia(B, base, w, h):
    GAME['fmt'] = 'trivia'
    ls = ("localStorage.setItem('vp-ttoken-%s','tok');localStorage.setItem('vp-tname-%s','Dean');localStorage.setItem('vp-tpid-%s','pid1');"
          "localStorage.setItem('vp-tsess-%s','%s');") % (ROOM, ROOM, ROOM, ROOM, SESS)
    P = Page(B, base + '/app/trivia/play.html?room=%s&sting=0&roomserver=0' % ROOM, w, h, ls)
    t = 'trivia %dx%d' % (w, h)
    try:
        P.until('window.__bc && window.__bc.length && document.querySelector(".view:not(.hidden)")', 20); time.sleep(1.5)
        P.say({'t': 'started', 'fmt': 'trivia', 'game_id': 'g-triv', 'session_id': SESS, 'question_count': 11})
        q = {'t': 'question', 'fmt': 'trivia', 'game_id': 'g-triv', 'qseq': 4, 'qi': 4, 'qtotal': 11, 'secs': 30, 'endsAt': int(time.time() * 1000) + 600000,
             'text': 'Which Australian band released the 1987 album "Diesel and Dust", with the song "Beds Are Burning"?',
             'options': ['Midnight Oil and the Ghostwriters', 'Cold Chisel with Jimmy Barnes', 'Hunters and Collectors', 'The Church of the Holy Rollers']}
        P.say(q)
        ok(t + ': CONTROL the question is up', P.until('!document.getElementById("vQ").classList.contains("hidden") && document.querySelectorAll("#pAnswers .pans").length===4', 10), P.js('document.body.innerText.slice(0,200)'))
        fits(P, t + ' question', ['#pAnswers .pans.c3', '#pqCd', '.pfoot svg'])
        venue_logo_ok(P, t + ' question')
        # INBOX 320.3 (Dean, 12 Nov 2026): a long clock reads m:ss (9:58), never "598 secs", and it sits up under the header
        cd = P.obj('(function(){ var n=document.getElementById("pqCdNum"), l=n.nextElementSibling, r=n.closest(".pq-ring").getBoundingClientRect(), h=document.querySelector(".ptop").getBoundingClientRect();'
                   ' return JSON.stringify({ num:n.textContent, label:l && getComputedStyle(l).display!=="none" ? l.textContent : "", sr:document.getElementById("pqCd").textContent, gap:Math.round(r.top-h.bottom) }); })()') or {}
        ok(t + ': a ten-minute clock reads minutes and seconds ("%s"), no "secs" under it, the screen reader the same ("%s")' % (cd.get('num'), cd.get('sr')),
           re.match(r'^(10:00|9:[0-5]\d)$', cd.get('num') or '') is not None and cd.get('label') == '' and re.match(r'^Answer in (10:00|9:[0-5]\d)$', cd.get('sr') or '') is not None, cd)
        ok(t + ': the countdown sits right under the header (%spx below it), not far down the screen' % cd.get('gap'), cd.get('gap') is not None and -1 <= cd['gap'] <= 12, cd)
        ring = P.obj('(function(){ var r=document.querySelector("#vQ .pring, #vQ .ring, #pqRing"); if(!r) return null; var b=r.getBoundingClientRect(), out=[];'
                     ' [].forEach.call(r.querySelectorAll("*"), function(e){ var c=e.getBoundingClientRect(); if(c.width>0 && (c.left<b.left-1||c.right>b.right+1||c.top<b.top-1||c.bottom>b.bottom+1)) out.push((e.id||e.className)+" "+e.textContent.trim()); });'
                     ' return JSON.stringify(out); })()')
        ok(t + ': nothing spills out of the countdown ring (SECS inside it)', ring == [] or ring is None, ring)
        P.js('document.querySelectorAll("#pAnswers .pans")[1].click()'); time.sleep(0.6)
        fits(P, t + ' locked in', ['#pAnswers .pans.c3'])
        P.say({'t': 'reveal', 'fmt': 'trivia', 'qseq': 4, 'correctIndex': 0, 'options': q['options'], 'game_id': 'g-triv'})
        P.until('!document.getElementById("vRes").classList.contains("hidden")', 10)
        fits(P, t + ' result, wrong', ['#pResAnswers .pans.c3'])
        P.say(dict(q, qseq=5, qi=5, endsAt=int(time.time() * 1000) + 25000))
        P.until('!document.getElementById("vQ").classList.contains("hidden")', 10); time.sleep(1.2)
        cd = P.obj('(function(){ var n=document.getElementById("pqCdNum"), l=n.nextElementSibling; return JSON.stringify({ num:n.textContent, label:l && getComputedStyle(l).display!=="none" ? l.textContent : "" }); })()') or {}
        ok(t + ': under a minute it is the plain seconds with "secs" ("%s %s")' % (cd.get('num'), cd.get('label')), re.match(r'^\d{1,2}$', cd.get('num') or '') is not None and cd.get('label') == 'secs', cd)
        P.js('document.querySelectorAll("#pAnswers .pans")[0].click()'); time.sleep(0.4)
        P.say({'t': 'reveal', 'fmt': 'trivia', 'qseq': 5, 'correctIndex': 0, 'options': q['options'], 'game_id': 'g-triv'})
        P.until('!document.getElementById("vRes").classList.contains("hidden")', 10); time.sleep(1.5)
        fits(P, t + ' result, right', ['#pResAnswers .pans.c3'])
        P.say({'t': 'podium', 'fmt': 'trivia', 'reveal': 1, 'game_id': 'g-triv'})
        ok(t + ': CONTROL the final screen', P.until('!document.getElementById("vFinal").classList.contains("hidden")', 10))
        time.sleep(4.5)   # the confetti has fallen
        fits(P, t + ' you won')
        time.sleep(2)
        ok(t + ': "How was that?" is NOT asked while the winner shows the screen to the host (INBOX 287.5)', not P.js('!!document.querySelector("#vFinal .vpfb")'), P.js('document.body.innerText.slice(0,300)'))
        P.say({'t': 'idle', 'fmt': 'trivia'})
        time.sleep(1)
        feedback_steps(P, t + ' you won, the host ended the game', 'vFinal')
        ok(t + ': no script errors', not P.js('window.__errs.length'), P.js('JSON.stringify(window.__errs)'))
    finally:
        P.close()


def trivia_late(B, base, w, h):
    """INBOX 293 (Dean, 12 Nov 2026): a phone that joins after the round has started."""
    GAME['fmt'] = 'trivia'
    ls = ("localStorage.setItem('vp-ttoken-%s','tok');localStorage.setItem('vp-tname-%s','Dean');localStorage.setItem('vp-tpid-%s','pid1');"
          "localStorage.setItem('vp-tsess-%s','%s');") % (ROOM, ROOM, ROOM, ROOM, SESS)
    opts = ['Canberra', 'Sydney', 'Melbourne', 'Perth']
    t = 'trivia late join %dx%d' % (w, h)
    for live in (True, False):
        P = Page(B, base + '/app/trivia/play.html?room=%s&sting=0&roomserver=0' % ROOM, w, h, ls)
        try:
            P.until('window.__bc && window.__bc.length && document.querySelector(".view:not(.hidden)")', 20); time.sleep(1.5)
            if live:
                P.say({'t': 'question', 'fmt': 'trivia', 'game_id': 'g-late', 'qseq': 4, 'qi': 4, 'qtotal': 11, 'secs': 30, 'to': 'pid1',
                       'endsAt': int(time.time() * 1000) + 600000, 'text': 'What is the capital of Australia?', 'options': opts})
                ok(t + ': a question is live: it is up, with "You\u2019ve joined at question 4. Jump in, this one\u2019s yours."',
                   P.until('document.getElementById("pStatus").textContent==="You\u2019ve joined at question 4. Jump in, this one\u2019s yours."', 8),
                   P.js('document.getElementById("pStatus").textContent'))
                fits(P, t + ' question live', ['#pAnswers .pans.c3', '#pStatus'])
                P.say({'t': 'question', 'fmt': 'trivia', 'game_id': 'g-late', 'qseq': 5, 'qi': 5, 'qtotal': 11, 'secs': 30,
                       'endsAt': int(time.time() * 1000) + 600000, 'text': 'What is the capital of New Zealand?', 'options': opts})
                ok(t + ': the next question says nothing about joining', P.until('document.getElementById("pStatus").textContent==="Tap your answer"', 8),
                   P.js('document.getElementById("pStatus").textContent'))
            else:
                P.say({'t': 'reveal', 'fmt': 'trivia', 'game_id': 'g-late', 'qseq': 4, 'qi': 4, 'correctIndex': 0, 'options': opts, 'to': 'pid1'})
                time.sleep(1)
                txt = P.js('document.body.innerText.replace(/\\s+/g," ")') or ''
                ok(t + ': between questions: "You\u2019ve joined at question 4. Jump in, the next one\u2019s yours.", and the finished question is not replayed',
                   'You\u2019ve joined at question 4. Jump in, the next one\u2019s yours.' in txt and P.js('document.getElementById("vRes").classList.contains("hidden")') is True
                   and 'No answer' not in txt, txt[:300])
                fits(P, t + ' between questions')
        finally:
            P.close()


def bingo(B, base, w, h):
    GAME['fmt'] = 'bingo'
    ls = "localStorage.setItem('vp-name-%s','Dean');localStorage.setItem('vp-pid-%s','pidbingo1');" % (ROOM, ROOM)
    P = Page(B, base + '/play.html?room=%s&sting=0&roomserver=0' % ROOM, w, h, ls)
    t = 'bingo %dx%d' % (w, h)
    try:
        P.until('window.__bc && window.__bc.length && document.querySelector(".view:not(.hidden)")', 20); time.sleep(1.5)
        P.say({'t': 'rollcall'})
        P.until('window.__pid', 8)
        pid = P.js('window.__pid') or 'pidbingo1'
        cards = [{'cardNo': 318 + k, 'cells': c} for k, c in enumerate([
            [[5, None, 23, None, 42, None, 64, None, 88], [None, 13, None, 31, None, 53, None, 71, 90], [7, None, 26, None, 45, None, 69, 77, None]],
            [[1, None, 21, None, 41, None, 61, None, 81], [None, 12, None, 32, None, 52, None, 72, 89], [8, None, 28, None, 48, None, 68, 78, None]],
            [[3, None, 24, None, 43, None, 63, None, 83], [None, 14, None, 34, None, 54, None, 74, 84], [9, None, 29, None, 49, None, 67, 79, None]]])]
        P.say({'t': 'state', 'pattern': 'one', 'prize': 'Meat tray', 'called': [], 'active': True, 'session_id': SESS, 'join_code': ROOM},
              {'t': 'cards', 'pid': pid, 'cards': cards, 'pattern': 'one', 'prize': 'Meat tray'})
        called = []
        for n in [5, 23, 42, 64, 13, 31, 2, 50, 11, 39, 62]:
            called.append(n); P.say({'t': 'ball', 'number': n, 'called': called[:], 'active': True})
        ok(t + ': CONTROL three tickets are up', P.until('!document.getElementById("vCard").classList.contains("hidden")', 10), P.js('document.body.innerText.slice(0,200)'))
        fits(P, t + ' three tickets', ['#bingoBtn', '#cardStack .ticket:last-child', '.pfoot svg', '#vphLink'])
        venue_logo_ok(P, t + ' three tickets')
        cut = P.obj('(function(){ var W=document.documentElement.clientWidth, out=[]; [].forEach.call(document.querySelectorAll("#cardStack .ticket:not(.shut) .cc"), function(e){ var r=e.getBoundingClientRect(), g=e.parentNode.getBoundingClientRect(); if(r.width>0 && (r.right>W+0.5 || r.right>g.right+0.5 || r.left<g.left-0.5)) out.push((e.getAttribute("data-n")||"blank")+" ["+Math.round(r.left)+","+Math.round(r.right)+"]"); }); return JSON.stringify(out.slice(0,9)); })()')
        ok(t + ' three tickets: all nine columns of every open ticket inside the ticket and the screen (none cut off on the right)', cut == [], cut)
        P.say({'t': 'winner', 'pid': pid, 'name': 'Dean', 'cardNo': 320, 'pattern': 'one', 'prize': 'Meat tray', 'winners': [{'pid': pid, 'name': 'Dean', 'cardNo': 320}], 'cont': False})
        ok(t + ': CONTROL YOU WON', P.until('!document.getElementById("vWon").classList.contains("hidden")', 10))
        time.sleep(0.6); confetti_ok(P, t + ' you won')
        time.sleep(4.5)
        fits(P, t + ' you won')
        time.sleep(2)
        ok(t + ': "How was that?" is NOT asked while the winner shows the screen to the host (INBOX 287.5)', not P.js('!!document.querySelector("#vWon .vpfb")'), P.js('document.body.innerText.slice(0,300)'))
        P.say({'t': 'idle'})
        time.sleep(1)
        feedback_steps(P, t + ' you won, the host ended the game', 'vWon')
        ok(t + ': no script errors', not P.js('window.__errs.length'), P.js('JSON.stringify(window.__errs)'))
    finally:
        P.close()


def bingo_late(B, base, w, h):
    """INBOX 291 PROVE (Dean, 12 Nov 2026): a brand-new phone that joins bingo late, from the TV's QR, has every number
    already called judged on its tickets and the right "One to go". Twice: with "Mark numbers for me" on (as Dean's
    phone had it), every called number is marked; with it off (a new phone's default: marking is the game), the ticket
    closest to winning outlines the called numbers still to mark, and "One to go" is right either way."""
    GAME['fmt'] = 'bingo'
    called = [5, 23, 42, 64, 13, 31, 2, 50, 11, 39, 62, 77, 8, 81, 19, 33, 47, 58, 66, 90]
    for assist in (True, False):
        P = Page(B, base + '/play.html?room=%s&sting=0&roomserver=0' % ROOM, w, h, "localStorage.setItem('vp-assist','1');" if assist else '')
        t = 'bingo late join %s %dx%d' % ('mark-for-me on' if assist else 'mark-for-me off', w, h)
        try:
            ok(t + ': CONTROL a new phone from the QR is asked its name', P.until('!document.getElementById("vJoin").classList.contains("hidden") && document.getElementById("joinBtn") && !document.getElementById("joinBtn").disabled', 25),
               P.js('document.body.innerText.slice(0,200)'))
            P.js('document.getElementById("nameIn").value="Late Larry"; document.getElementById("joinBtn").click(); true')
            P.until('window.__pid', 10)
            if not P.js('window.__pid'):
                P.say({'t': 'rollcall'}); P.until('window.__pid', 8)
            pid = P.js('window.__pid')
            ok(t + ': CONTROL it joined and said so on the channel', bool(pid), P.js('document.body.innerText.slice(0,200)'))
            # the game is 20 balls in when this phone arrives: the state first, then its tickets
            P.say({'t': 'state', 'pattern': 'one', 'prize': 'Meat tray', 'called': called, 'active': True, 'session_id': SESS, 'join_code': ROOM},
                  {'t': 'cards', 'pid': pid, 'pattern': 'one', 'prize': 'Meat tray', 'cards': [
                      {'cardNo': 401, 'cells': [[5, None, 23, None, 42, None, 64, None, 88], [None, 13, None, 31, None, 53, None, 71, 90], [7, None, 26, None, 45, None, 69, 77, None]]},
                      {'cardNo': 402, 'cells': [[1, None, 21, None, 41, None, 61, None, 81], [None, 12, None, 32, None, 52, None, 72, 89], [8, None, 28, None, 48, None, 68, 78, None]]}]})
            ok(t + ': CONTROL its tickets are up', P.until('!document.getElementById("vCard").classList.contains("hidden") && document.querySelectorAll("#cardStack .cc[data-n]").length===30', 10),
               P.js('document.body.innerText.slice(0,200)'))
            time.sleep(0.8)
            r = P.obj('(function(){ var c=%s, un=[], miss=[]; [].forEach.call(document.querySelectorAll("#cardStack .cc[data-n]"), function(e){ var n=+e.getAttribute("data-n"); if(c.indexOf(n)<0) return;'
                      ' if(!/\\bdaub\\b/.test(e.className)) un.push(n); if(+e.getAttribute("data-card")===0 && /\\bmissed\\b/.test(e.className)) miss.push(n); });'
                      ' return JSON.stringify({ unmarked: un, missed: miss.sort(function(a,b){return a-b;}), tension: (document.getElementById("tension")||{}).innerText||"" }); })()' % json.dumps(called)) or {}
            if assist:
                ok(t + ': every number called before it joined is marked on its tickets', r.get('unmarked') == [], r)
            else:
                ok(t + ': the ticket closest to winning outlines every called number on it still to mark (5 13 23 31 42 64 77 90)', r.get('missed') == [5, 13, 23, 31, 42, 64, 77, 90], r)
            ok(t + ': and it says "One to go!" (ticket #401 has 5, 23, 42 and 64 of its top row)', 'One to go!' in (r.get('tension') or ''), r.get('tension'))
            fits(P, t + ' tickets', ['#bingoBtn'])
        finally:
            P.close()


def musical(B, base, w, h):
    GAME['fmt'] = 'musical'
    ls = ("localStorage.setItem('vp-mtoken-%s','tok');localStorage.setItem('vp-mname-%s','Dean');localStorage.setItem('vp-mpid-%s','pidmus1');"
          "localStorage.setItem('vp-msess-%s','%s');") % (ROOM, ROOM, ROOM, ROOM, SESS)
    P = Page(B, base + '/app/musical/play.html?room=%s&sting=0&roomserver=0' % ROOM, w, h, ls)
    t = 'musical %dx%d' % (w, h)
    try:
        P.until('window.__bc && window.__bc.length && document.querySelector(".view:not(.hidden)")', 20); time.sleep(1.5)
        P.say({'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'game_id': 'g-mus'})
        ok(t + ': CONTROL the card is dealt', P.until('!document.getElementById("vCard").classList.contains("hidden") && document.querySelectorAll("#cardGrid .cc").length===25', 15), P.js('document.body.innerText.slice(0,200)'))
        pl = ['Dancing Queen', 'Khe Sanh', 'Africa']
        P.say({'t': 'played', 'played': pl, 'played_ids': [sid(x) for x in pl]}); time.sleep(1.5)
        fits(P, t + ' card', ['#bingoBtn', '#cardGrid .cc:nth-child(5)', '#cardGrid .cc:nth-child(25)', '.pfoot svg'])
        venue_logo_ok(P, t + ' card')
        P.say({'t': 'winner', 'pid': 'pidmus1', 'name': 'Dean', 'cardNo': 17})
        ok(t + ': CONTROL YOU WON', P.until('!document.getElementById("vWon").classList.contains("hidden")', 10))
        time.sleep(0.6); confetti_ok(P, t + ' you won')
        time.sleep(4.5)
        fits(P, t + ' you won')
        time.sleep(2)
        ok(t + ': "How was that?" is NOT asked while the winner shows the screen to the host (INBOX 287.5)', not P.js('!!document.querySelector("#vWon .vpfb")'), P.js('document.body.innerText.slice(0,300)'))
        P.say({'t': 'idle'})
        time.sleep(1)
        feedback_steps(P, t + ' you won, the host ended the game', 'vWon')
        # the next game, ended from the console with nobody calling: it says so and asks too (INBOX 289.1)
        P.js('localStorage.clear(); sessionStorage.clear(); true')
        P.say({'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'game_id': 'g-mus-2'})
        ok(t + ': CONTROL the next card is dealt', P.until('!document.getElementById("vCard").classList.contains("hidden")', 15), P.js('document.body.innerText.slice(0,200)'))
        P.say({'t': 'idle'})
        ok(t + ': End game with no winner: "That game is over. Nobody called a winning card this time."', P.until('!document.getElementById("vLost").classList.contains("hidden")', 8)
           and 'Nobody called a winning card this time.' in (P.js('document.getElementById("vLost").innerText') or ''), P.js('document.body.innerText.slice(0,300)'))
        feedback_steps(P, t + ' ended with no winner', 'vLost', 'Good')
        ok(t + ': no script errors', not P.js('window.__errs.length'), P.js('JSON.stringify(window.__errs)'))
    finally:
        P.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('game-screens-fit-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site); srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        for (w, h) in ((375, 667), (390, 844)):
            for name, fn in (('trivia', trivia), ('trivia-late', trivia_late), ('bingo', bingo), ('bingo-late', bingo_late), ('musical', musical)):
                if ONLY and name not in ONLY: continue
                print('\n%s at %dx%d' % (name.upper(), w, h))
                try: fn(B, base, w, h)
                except Exception as e:
                    import traceback; traceback.print_exc(); ok('%s %dx%d ran to the end' % (name, w, h), False, e)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
