#!/usr/bin/env python3
"""TRIVIA, THE NEW LOOK, AS CHROME PAINTS IT (Dean, 3 Nov 2026).

The new trivia wall and phone were mocked up and approved on 3 Nov (venue-enrich/reports/new-look-games-3nov).
This opens the REAL app/trivia/screen.html and app/trivia/play.html in their own sales-page demos (?demo=1,
Tugun Bowls Club's crest), served from this checkout, on Chrome's virtual clock, and measures what is painted:

  TV (1920x1080 and 1280x720)
    - ONE GRID: the label line, the question text and every answer card are in the same place on the
      countdown and on the reveal (within 1px; the right card only lifts about its own middle), and the
      reveal's "got it right" sits in the clock's box. No wall is moved or shrunk by vp-fit.
    - the four answer colours are coral, blue, amber and violet, and the right answer turns green
    - the answer cards and the leaderboard stay clear of where the JOIN NOW card sits on a real night,
      and the question starts below the venue's logo
    - no empty-state words ("No scores yet") on any wall, and the demo never makes a sound card
    - THE GAME'S NAME IS CLEAR (Dean, 3 Nov 2026): "TRIVIA" in Anton, white, at least 2.4% of the screen's
      width tall, on the question, reveal, scores and podium, and the top line never crowds the venue's
      logo or ours, with Tugun's round crest and with a wide 6.6:1 wordmark (a Pause Bar shape)
  PHONE (375x812)
    - the venue's logo top left, no player name in the header, our venueplay logo at the bottom
    - nothing in the header, the question or the result is under 15px
    - the four answer buttons FULL colour fills (the TV's colours) with AA-contrast words; locked in: the pick
      stays full colour, the rest dim, "Watch the TV for the answer"
    - the result: the right answer green, a wrong pick tagged YOURS
  HOST CONSOLE (signed in, on the browser rig)
    - a compact "Time's-up buzzer" row at the top of the console: OFF by default, plays on "TV" or "This device";
      the choice sticks after a reload

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/trivia-newlook-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.join(ROOT, 'venueplay')
SHOTS = os.environ.get('VP_SHOTS', '')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n)
        self.send(404, '{}', 'application/json')
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__worker'):
            return self.send(404, '{}', 'application/json')
        if u.path == '/__fake/supabase.js':
            pre = 'window.__FAKE_DB={};window.__FAKE_SIGNED_IN=false;window.__FAKE_UID="x";\n'
            return self.send(200, pre + io.open(os.path.join(ROOT, 'tools/browser-rig/fake-supabase.js'), encoding='utf-8').read(), 'application/javascript')
        if u.path == '/__fixture/wide-logo.svg':   # a wide white wordmark, 6.6:1, the shape of The Pause Bar's
            return self.send(200, WIDE_LOGO, 'image/svg+xml')
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);}};', 'application/javascript')
        p = u.path
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


WIDE_LOGO = ('<svg xmlns="http://www.w3.org/2000/svg" width="660" height="100" viewBox="0 0 660 100">'
             '<rect x="0" y="0" width="660" height="100" fill="none"/><text x="330" y="78" font-family="Arial Black,Arial" font-size="86" '
             'font-weight="900" fill="#fff" text-anchor="middle">PAUSE BAR</text></svg>')
T0 = 1793500000000          # a fixed instant, never the real clock
# Counts every sound card the page makes: the sales-page demo must never make one.
HOOK = r'''(function(){ window.__acMade=0; var A=window.AudioContext||window.webkitAudioContext; if(!A) return;
  function W(){ window.__acMade++; return new A(); } window.AudioContext=W; window.webkitAudioContext=W; })();'''
FREEZE = r'''(function(){ var a=document.getAnimations?document.getAnimations():[];
  a.forEach(function(x){ try{ var t=x.effect&&x.effect.getComputedTiming(); if(t&&isFinite(t.endTime)) x.finish(); else { x.pause(); x.currentTime=0; } }catch(e){} });
  var s=document.createElement("style"); s.textContent="*,*::before,*::after{transition:none!important}"; document.head.appendChild(s); return a.length; })()'''

TV_PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [b.left,b.top,b.right,b.bottom]; }
  function on(id){ var l=document.getElementById(id); return l && !l.classList.contains("hidden") && getComputedStyle(l).display!=="none"; }
  var lay=[].filter.call(document.querySelectorAll(".layer"),function(l){ return on(l.id); })[0];
  var out={ layer: lay ? lay.id : null, tf: lay ? (lay.style.transform||"") : null, W: innerWidth, H: innerHeight,
            text: lay ? lay.innerText : "", ac: window.__acMade||0 };
  if(lay){
    out.lbl=R(lay.querySelector(".toplbl"));
    out.q=R(lay.querySelector(".qtext"));
    out.cards=[].map.call(lay.querySelectorAll(".answers .ans"),function(c){ var cs=getComputedStyle(c);
      var al=c.querySelector(".al"), as=al?getComputedStyle(al):null, at=c.querySelector(".at"); return { ovf: at ? (function(){ var ab=at.getBoundingClientRect(), cb=c.getBoundingClientRect(); return ab.top < cb.top - 1 || ab.bottom > cb.bottom + 1 || ab.right > cb.right + 1 || at.scrollWidth > at.clientWidth + 2; })() : false, sc:(c.querySelector(".sc")||{}).textContent||"", r:R(c), cls:c.className, c:cs.getPropertyValue("--c").trim(), bg:cs.backgroundColor, tf:cs.transform, lfs: as?parseFloat(as.fontSize):0,
        lfg: as?as.color:"", lbg: as?as.backgroundColor:"", lts: as?as.textShadow:"" }; });
    var gn=lay.querySelector(".toplbl .tl-night"); if(gn){ var gs=getComputedStyle(gn); out.game={ r:R(gn), text:gn.textContent, ff:gs.fontFamily, fs:parseFloat(gs.fontSize), col:gs.color }; }
    var kids=[].map.call(lay.querySelectorAll(".toplbl > *"),R); out.lblInk=kids.length ? [Math.min.apply(null,kids.map(function(k){return k[0];})), Math.min.apply(null,kids.map(function(k){return k[1];})),
      Math.max.apply(null,kids.map(function(k){return k[2];})), Math.max.apply(null,kids.map(function(k){return k[3];}))] : null;
    var cn=document.querySelector(".tv-corner .vn svg, .tv-corner svg"); out.mark=cn ? R(cn) : null;
    /* the corner furniture (the answered count, the joined count) sits in the corner on purpose: not the wall's bottom */
    out.bottom=Math.max.apply(null,[].map.call(lay.querySelectorAll("*"),function(e){ if(e.closest(".answered,.joined")) return 0; var b=e.getBoundingClientRect(); return (b.width>2&&b.height>2&&getComputedStyle(e).visibility!=="hidden")?b.bottom:0; }).concat([0]));
    out.ans=R(lay.querySelector(".rcount")); out.ansText=(lay.querySelector(".rcount")||{}).textContent||"";
    out.ring=R(lay.querySelector(".ringwrap svg")); out.secs=R(lay.querySelector(".rlbl")); out.num=R(lay.querySelector("#tvCdNum"));
    out.joined=/joined/i.test(lay.textContent||"");
    out.scan=R(lay.querySelector(".scanplay")); out.qr=R(lay.querySelector(".qrbig"));
    var cb=lay.querySelector(".codebox"); out.codeBorder=cb?getComputedStyle(cb).borderTopColor:""; out.cbox=R(cb); out.urlR=R(lay.querySelector(".joinurl")); out.codeText=(lay.querySelector(".codeval")||{}).textContent||"";
    out.orgo=(lay.querySelector(".joinurl")||{}).textContent||"";
    out.subShown=(function(e){ return !!e && getComputedStyle(e).display!=="none" && e.getBoundingClientRect().height>0; })(lay.querySelector(".jsub"));
    /* The fullest board a night shows: a later page, the leader pinned at the top, nine more rows
       (no page words: the pages just flip every 10 seconds). Built here from its own rows, measured, and left: the next state repaints it. */
    if(lay.id==="tvBoard"){ var box=document.getElementById("tvBoardRows"), rr=box.querySelectorAll(".brow");
      out.rowsShown=rr.length;
      if(rr.length){ while(box.querySelectorAll(".brow").length<10) box.appendChild(rr[rr.length-1].cloneNode(true)); box.querySelector(".brow").classList.add("pinned"); }
      out.rows6=[].map.call(box.querySelectorAll(".brow"),R);
      out.bottom6=Math.max.apply(null,[].map.call(lay.querySelectorAll("*"),function(e){ var b=e.getBoundingClientRect(); return (b.width>2&&b.height>2)?b.bottom:0; }).concat([0])); }
    out.clock=R(lay.querySelector(".qfoot")); out.got=R(lay.querySelector(".gotbox"));
    out.qround=R(lay.querySelector(".qround")); out.qroundText=(lay.querySelector(".qround")||{}).textContent||"";
    var bt=lay.querySelector(".boardtitle"); out.btitle=bt?bt.textContent.trim():""; out.lblText=(lay.querySelector(".toplbl")||{}).textContent||"";
    var ws=lay.querySelector(".wintitle span"); out.wcol=ws?getComputedStyle(ws).color:"";
    out.rows=[].map.call(lay.querySelectorAll(".brow"),R);
    out.steps=[].map.call(lay.querySelectorAll(".pcol"),R);
  }
  var lg=document.getElementById("venueLogo"); out.logo=(lg && lg.style.display!=="none") ? R(lg) : null;
  /* Where the JOIN NOW card sits on a real night (the demo hides it): a visible copy, measured, removed. */
  var j=document.getElementById("tvJoinCorner");
  if(j){ var k=j.cloneNode(true); k.removeAttribute("id"); k.classList.remove("hidden"); k.style.visibility="hidden"; j.parentNode.appendChild(k); out.join=R(k); k.parentNode.removeChild(k); }
  return JSON.stringify(out);
})()'''

PHONE_PROBE = r'''(function(){
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [b.left,b.top,b.right,b.bottom]; }
  function vis(e){ var s=getComputedStyle(e), b=e.getBoundingClientRect(); return s.display!=="none" && s.visibility!=="hidden" && b.width>2 && b.height>2; }
  var view=[].filter.call(document.querySelectorAll(".view"),function(v){ return !v.classList.contains("hidden"); })[0];
  var small=[];
  [document.querySelector(".ptop"), view].forEach(function(root){ if(!root) return;
    [].forEach.call(root.querySelectorAll("*"),function(e){
      var own=""; for(var c=e.firstChild;c;c=c.nextSibling) if(c.nodeType===3) own+=c.nodeValue;
      if(!own.trim() || !vis(e)) return;
      if(e.closest && e.closest(".vp-feedback,[data-vp-feedback],#vpConnBar")) return;
      var fs=parseFloat(getComputedStyle(e).fontSize); if(fs<15) small.push((e.id||e.className||e.tagName)+" "+fs+"px \""+own.trim().slice(0,20)+"\""); });
  });
  var lg=document.getElementById("venueLogo"), foot=document.querySelector(".pfoot svg"), menu=document.getElementById("menuBtn");
  var out={ view: view ? view.id : null, small: small, head: (document.querySelector(".ptop")||{}).innerText||"",
    logo: (lg && !lg.classList.contains("hidden")) ? R(lg) : null, foot: foot ? R(foot) : null, viewR: view ? R(view) : null, menu: R(menu),
    btns: [].map.call(document.querySelectorAll("#"+(view?view.id:"x")+" .pans"),function(b){ var cs=getComputedStyle(b);
      var t=b.querySelector(".pt"), l=b.querySelector(".pl"), ls=l?getComputedStyle(l):null; return { lfs: ls?parseFloat(ls.fontSize):0, lff: ls?ls.fontFamily:"", lfg: ls?ls.color:"", lts: ls?ls.textShadow:"", cls:b.className, c:cs.getPropertyValue("--c").trim(), bg:cs.backgroundColor, sh:cs.boxShadow, op:parseFloat(cs.opacity),
        fg: t ? getComputedStyle(t).color : cs.color, tag:(b.querySelector(".tg")||{}).textContent||"" }; }),
    lock: "", all: view ? view.innerText : "",
    ringR: (function(){ var r=view && view.querySelector(".pq-ring"); return r ? R(r) : null; })(),
    qR: (function(){ var r=view && view.querySelector(".pq-text"); return r ? R(r) : null; })(),
    stw: (function(){ var t=document.getElementById("statusText"); return t ? t.getBoundingClientRect().width : -1; })(),
    dotR: (function(){ var d=document.getElementById("statusDot"); return d ? R(d) : null; })(), lbl: (function(){ var l=view && view.querySelector(".pq-count"); return l ? l.textContent : ""; })(),
    lblR: (function(){ var l=view && view.querySelector(".pq-count"); return l ? R(l) : null; })(),
    ptsR: (function(){ var e=document.getElementById("pResPts"); return e && view && view.id==="vRes" ? R(e) : null; })(), ptsT: (document.getElementById("pResPts")||{}).textContent||"",
    totR: (function(){ var e=document.querySelector(".ptotal"); return e && view && view.id==="vRes" ? R(e) : null; })(), totT: (document.querySelector(".ptotal")||{}).textContent||"",
    dot: (function(){ var d=document.getElementById("statusDot"); return d ? d.getBoundingClientRect().width : 0; })(),
    pq: (document.getElementById("pqText")||{}).textContent||"", rq: (document.getElementById("pResQ")||{}).textContent||"", W: innerWidth };
  return JSON.stringify(out);
})()'''


def load(B, base, path, w, h, mobile, states, probe):
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    out = {}
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': mobile}, session=sid)
        B.call('Page.addScriptToEvaluateOnNewDocument', {'source': HOOK}, session=sid)
        B.call('Emulation.setVirtualTimePolicy', {'policy': 'pause', 'initialVirtualTime': T0 / 1000.0}, session=sid)
        B.call('Page.navigate', {'url': base + path}, session=sid)
        at = 0
        for name, ms in states:
            B.call('Emulation.setVirtualTimePolicy', {'policy': 'pauseIfNetworkFetchesPending', 'budget': ms - at}, session=sid)
            end = time.time() + 120
            while time.time() < end:
                r = B.evaluate(sid, 'Date.now()', 10)
                v = r and r.get('result', {}).get('value')
                if v and v >= T0 + ms - 5: break
                time.sleep(0.2)
            at = ms
            B.evaluate(sid, FREEZE, 20); time.sleep(0.5)
            r = B.evaluate(sid, probe, 30)
            out[name] = json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else {}
            if SHOTS:
                png = base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data'])
                open(os.path.join(SHOTS, 'newlook-%s-%dx%d-%s.png' % ('phone' if mobile else 'tv', w, h, name)), 'wb').write(png)
    finally:
        B.close_tab(tid)
    return out


def rgb(hexs):
    hexs = hexs.lstrip('#'); return 'rgb(%d, %d, %d)' % tuple(int(hexs[i:i + 2], 16) for i in (0, 2, 4))

def contrast(c1, c2):
    import re as _re
    def lum(c):
        v = [int(x) / 255.0 for x in _re.findall(r'\d+', c)[:3]]
        v = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in v]
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    a, b = sorted((lum(c1), lum(c2)), reverse=True)
    return (a + 0.05) / (b + 0.05)

def same(a, b, tol=1.0):
    return bool(a and b) and all(abs(a[i] - b[i]) <= tol for i in range(4))

COLOURS = ['#FF5A4E', '#4D8DFF', '#FFA53D', '#A57BFF']
GREEN = 'rgb(47, 208, 138)'


def title_checks(tag, frames, w):
    """The game's name on each wall: big, Anton, white, and the top line clear of both logos."""
    gap = round(w * 0.006)
    for name, x in frames:
        g = x.get('game') or {}
        ok('%s, %s: the game\'s name says TRIVIA, in Anton, white' % (tag, name),
           g.get('text', '').strip().lower() == 'trivia' and 'Anton' in g.get('ff', '') and g.get('col') in ('rgb(255, 255, 255)',), g)
        ok('%s, %s: and big enough to read from the back of the room (at least 2.4%% of the width)' % (tag, name), g.get('fs', 0) >= 0.024 * w, g.get('fs'))
        L, M, I = x.get('logo'), x.get('mark'), x.get('lblInk')
        G = (x.get('game') or {}).get('r')
        ok('%s, %s: TRIVIA is on the same centre line as the corner logos (within 2px of ours)' % (tag, name),
           bool(G and M) and abs((G[1] + G[3]) / 2 - (M[1] + M[3]) / 2) <= 2, [G, M])
        ok('%s, %s: the top line is clear of the venue\'s logo and of ours' % (tag, name),
           bool(L and M and I) and I[0] >= L[2] + gap and I[2] + gap <= M[0], [L, I, M])


def tv(B, base, w, h, logo=''):
    print('\nTHE TRIVIA WALL at %dx%d%s' % (w, h, ' with a wide logo' if logo else ''))
    if logo:
        m = load(B, base, '/app/trivia/screen.html?demo=1&sting=0&logo=' + logo, w, h, False,
                 [('question', 4000), ('reveal', 9000), ('board', 12500), ('podium', 44000)], TV_PROBE)
        L = (m.get('question') or {}).get('logo')
        ok('%dx%d wide logo: the wide wordmark is up, sized as a wordmark (much wider than tall)' % (w, h), bool(L) and (L[2] - L[0]) > 4 * (L[3] - L[1]), L)
        title_checks('%dx%d wide logo' % (w, h), [(k, m.get(k) or {}) for k in ('question', 'reveal', 'board', 'podium')], w)
        return
    m = load(B, base, '/app/trivia/screen.html?demo=1&sting=0', w, h, False,
             [('lobby', 500), ('question', 4000), ('reveal', 9000), ('board', 12500), ('long', 15500), ('podium', 44000)], TV_PROBE)
    lb, q, rv, bd, pd, lq = m.get('lobby', {}), m.get('question', {}), m.get('reveal', {}), m.get('board', {}), m.get('podium', {}), m.get('long', {})
    fn = dict(bd, rows=bd.get('rows6') or [], bottom=bd.get('bottom6'))   # the fullest board: the leader and nine more
    tag = '%dx%d' % (w, h)
    ok(tag + ': the demo is on its question, then its reveal, board and podium',
       (q.get('layer'), rv.get('layer'), bd.get('layer'), pd.get('layer')) == ('tvQ', 'tvReveal', 'tvBoard', 'tvPodium'),
       [q.get('layer'), rv.get('layer'), bd.get('layer'), pd.get('layer')])
    ok(tag + ': no wall is moved or shrunk to fit (vp-fit left them alone)',
       all((x.get('tf') or '') == '' for x in (q, rv, bd, pd)), [x.get('tf') for x in (q, rv, bd, pd)])
    ok(tag + ': ONE GRID: the label line is in the same place on the question and the reveal', same(q.get('lbl'), rv.get('lbl')), [q.get('lbl'), rv.get('lbl')])
    ok(tag + ': and so is the question text (no flick)', same(q.get('q'), rv.get('q')), [q.get('q'), rv.get('q')])
    qc, rc = q.get('cards') or [], rv.get('cards') or []
    still = len(qc) == 4 and len(rc) == 4
    for i in range(min(len(qc), len(rc))):
        a, b = qc[i]['r'], rc[i]['r']
        if 'correct' in rc[i]['cls']:
            ca, cb = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2), ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
            still = still and abs(ca[0] - cb[0]) <= 1 and abs(ca[1] - cb[1]) <= 1
        else:
            still = still and same(a, b)
    ok(tag + ': and so is every answer card (the right one only lifts about its own middle)', still, [qc and [c['r'] for c in qc], rc and [c['r'] for c in rc]])
    ok(tag + ': the reveal has no "got it right" box in the clock\'s place', rv.get('got') is None, rv.get('got'))
    A, RG, SC = q.get('ans'), q.get('ring'), q.get('secs')
    import re as _re
    ok(tag + ': "32/43" (answered out of the players in) sits small inside the ring, under SECS',
       bool(A and RG and SC) and A[1] >= SC[3] - 0.5 and A[0] >= RG[0] and A[2] <= RG[2] and A[3] <= RG[3] - (RG[3] - RG[1]) * 0.08 and bool(_re.match(r'^\d+/\d+$', q.get('ansText', ''))),
       [A, SC, RG, q.get('ansText')])
    N_ = q.get('num')
    ok(tag + ': the number, SECS and the count are one block, centred in the ring top to bottom',
       bool(N_ and A and RG) and abs((N_[1] + A[3]) / 2 - (RG[1] + RG[3]) / 2) <= 0.02 * (RG[2] - RG[0]), [N_, A, RG])
    RV_ = rv.get('ring')
    ok(tag + ': the reveal has no countdown ring', RV_ is None or (RV_[2] - RV_[0]) < 1, RV_)
    ok(tag + ': the scores carry no page words', not any(x in (bd.get('text') or '') for x in ('Page ', 'Teams ')), (bd.get('text') or '')[-80:])
    ok(tag + ': no other "answered" words on the question wall', 'answered' not in (q.get('text') or '').lower(), q.get('text', '')[-80:])
    ok(tag + ': no counts on the reveal at all, the right answer included', all(c['sc'] == '' for c in rv.get('cards') or []) and len(rv.get('cards') or []) == 4,
       [(c['cls'], c['sc']) for c in rv.get('cards') or []])
    S_, Q_ = lb.get('scan'), lb.get('qr')
    ok(tag + ': the join: the QR big on the left (as approved: x 10.6%, 31% of the width)', lb.get('layer') == 'tvLobby' and bool(Q_) and abs(Q_[0] - 0.106 * w) <= 0.01 * w and abs((Q_[2] - Q_[0]) - 0.3125 * w) <= 0.01 * w,
       [lb.get('layer'), Q_])
    ok(tag + ': SCAN TO PLAY huge on the right of it', bool(S_ and Q_) and S_[0] >= Q_[2] and (S_[3] - S_[1]) >= 0.06 * w, [S_, Q_])
    CB_, UR_ = lb.get('cbox'), lb.get('urlR')
    ok(tag + ': SCAN TO PLAY and the address on the code box\'s centre line',
       bool(S_ and CB_ and UR_) and abs((S_[0] + S_[2]) / 2 - (CB_[0] + CB_[2]) / 2) <= 3 and abs((UR_[0] + UR_[2]) / 2 - (CB_[0] + CB_[2]) / 2) <= 3,
       [S_, UR_, CB_])
    ok(tag + ': "or go to venueplay.com.au/play" under it', lb.get('orgo', '').replace('\xa0', ' ').strip() == 'or go to venueplay.com.au/play', lb.get('orgo'))
    ok(tag + ': the code in a PINK-edged box (yellow is for winning moments)', lb.get('codeBorder') == 'rgb(255, 31, 142)' and lb.get('codeText') == 'VENUE2', [lb.get('codeBorder'), lb.get('codeText')])
    ok(tag + ': no tiny status line under the join on a set-up TV', lb.get('subShown') is False, lb.get('subShown'))
    ok(tag + ': and the lobby never says how many have joined (that is the host console\'s)', lb.get('joined') is False, lb.get('joined'))
    rc_ = rv.get('cards') or []
    lowest = max([c['r'][3] for c in (q.get('cards') or [])] or [0])
    QR_, RG_ = q.get('qround'), q.get('ring')
    ok(tag + ': "Question 3 of 20" sits under the ring and above the answers, the same on the countdown and the reveal',
       bool(QR_ and RG_ and rv.get('qround')) and QR_[1] >= RG_[3] - 0.5 and QR_[3] <= min(c['r'][1] for c in q.get('cards') or [[0, 9e9]]) and same(QR_, rv['qround']) and 'Question 3 of 20' in q.get('qroundText', ''),
       [QR_, RG_, q.get('qroundText')])
    qc_ = q.get('cards') or []
    ok(tag + ': the question\'s top is lined up with the ring\'s top (as approved)', bool(q.get('q') and RG_) and abs(q['q'][1] - RG_[1]) <= 0.004 * w, [q.get('q'), RG_])
    ok(tag + ': the four answer boxes are big (about 228px tall at 1920) and fill the lower half (to about 1014px at 1080)',
       len(qc_) == 4 and all(abs((c['r'][3] - c['r'][1]) - 0.11875 * w) <= 0.003 * w for c in qc_) and max(c['r'][3] for c in qc_) >= 0.52 * w and max(c['r'][3] for c in qc_) <= h - 0.02 * w,
       [c['r'] for c in qc_])
    ok(tag + ': a long two-line question and long answers fit: the question clear of the boxes, every answer inside its box',
       lq.get('layer') == 'tvQ' and bool(lq.get('q')) and lq['q'][3] <= min(c['r'][1] for c in lq.get('cards') or [[0, 0]]) - 0.005 * w and not any(c['ovf'] for c in lq.get('cards') or []) and len(lq.get('cards') or []) == 4,
       [lq.get('q'), [(c['r'], c['ovf']) for c in lq.get('cards') or []]])
    ok(tag + ': the scores: the heading is just "After question 3", and no small "Scores" word', bd.get('btitle', '').lower() == 'after question 3' and 'scores' not in bd.get('lblText', '').lower(),
       [bd.get('btitle'), bd.get('lblText')])
    ok(tag + ': the podium: "Winners tonight", with the winning yellow on it', pd.get('btitle', '').lower() == 'winners tonight' and pd.get('wcol') == 'rgb(255, 217, 61)', [pd.get('btitle'), pd.get('wcol')])
    ok(tag + ': the answer letters are big again (at least the old wall\'s 4.5% of the width)', len(qc) == 4 and all(c['lfs'] >= 0.045 * w for c in qc), [c['lfs'] for c in qc])
    ok(tag + ': the letters are WHITE on their colour chips, at least 3:1 (large text), and amber\'s, which cannot be, has a firm dark shadow',
       len(qc) == 4 and all(c['lfg'] == 'rgb(255, 255, 255)' and (contrast(c['lbg'], c['lfg']) >= 3.0 or (i == 2 and 'rgba(0, 0, 0, 0.45)' in c['lts'])) for i, c in enumerate(qc)),
       [(c['lbg'], c['lfg'], round(contrast(c['lbg'], c['lfg']), 2) if c['lbg'] else None, c['lts'][:40]) for c in qc])
    ok(tag + ': the answer colours are coral, blue, amber and violet', [c['c'].upper() for c in qc] == COLOURS, [c['c'] for c in qc])
    right = [c for c in rc if 'correct' in c['cls']]
    ok(tag + ': on the reveal the right answer is green and the others dim', len(right) == 1 and right[0]['bg'] == GREEN and sum(1 for c in rc if 'dim' in c['cls']) == 3,
       [(c['cls'], c['bg']) for c in rc])
    J = q.get('join')
    gap = round(w * 0.006)
    def clear(rects):
        return bool(J) and all(r[3] + gap <= J[1] or r[0] >= J[2] + gap for r in rects)
    ok(tag + ': and the leaderboard rows too', clear(bd.get('rows') or []) and len(bd.get('rows') or []) >= 5, [J, (bd.get('rows') or [])[:1]])
    ok(tag + ': and the podium steps', clear(pd.get('steps') or []) and len(pd.get('steps') or []) == 3, [J, pd.get('steps')])
    ok(tag + ': sixteen teams: the wall shows the top ten', bd.get('rowsShown') == 10, bd.get('rowsShown'))
    ok(tag + ': the fullest board (the leader pinned and nine more) was measured', fn.get('layer') == 'tvBoard' and len(fn.get('rows') or []) == 10, [fn.get('layer'), len(fn.get('rows') or [])])
    ok(tag + ': and clear of the JOIN NOW card', clear(fn.get('rows') or []), [J, (fn.get('rows') or [])[-1:]])
    for name, x in (('question', q), ('reveal', rv), ('scores', bd), ('podium', pd), ('the fullest board', fn)):
        top = (x.get('lblInk') or [0, 0])[1]
        ok(tag + ': %s: a proper bottom margin (nothing hard against the bottom edge)' % name,
           bool(x.get('bottom')) and h - x['bottom'] >= 0.02 * w and top > 0, [round(h - (x.get('bottom') or h)), round(top)])
    L = q.get('logo')
    ok(tag + ': the question is clear of the venue\'s logo (right of it, or below it)', bool(L and q.get('q')) and (q['q'][1] >= L[3] + gap or q['q'][0] >= L[2] + gap), [L, q.get('q')])
    ok(tag + ': no empty-state words on any wall', not any('no scores yet' in (x.get('text') or '').lower() for x in (q, rv, bd, pd)))
    ok(tag + ': the sales-page demo never makes a sound card (no buzzer, no fanfare)', pd.get('ac') == 0, pd.get('ac'))
    title_checks(tag + ' round crest', [('join', lb), ('question', q), ('reveal', rv), ('scores', bd), ('podium', pd)], w)
    G_ = [(x.get('game') or {}) for x in (lb, q, rv, bd, pd)]
    ok(tag + ': TRIVIA is the same size, font and place on every wall (join, question, reveal, scores, podium)',
       all(g.get('fs') for g in G_) and len(set(round(g['fs'], 1) for g in G_)) == 1 and len(set(g.get('ff') for g in G_)) == 1 and max(g['r'][1] for g in G_) - min(g['r'][1] for g in G_) <= 1,
       [(g.get('fs'), (g.get('r') or [0, 0])[1]) for g in G_])


def phone_stable(B, base, logo, tag):
    """The buttons do not move between the question, locked in and the result, whatever shape the logo."""
    m = load(B, base, '/app/trivia/play.html?demo=1&sting=0' + ('&logo=' + logo if logo else ''), 375, 812, True,
             [('question', 3000), ('locked', 6500), ('right', 9500)], PHONE_POS)
    ps = [m.get(k) or {} for k in ('question', 'locked', 'right')]
    ok('%s: the four answers are in the same place on the question, locked in and the result' % tag,
       all(len(p.get('b') or []) == 4 for p in ps) and all(all(same(ps[0]['b'][i], p['b'][i], 1.5) for i in range(4)) for p in ps[1:]),
       [p.get('b') for p in ps])
    return ps[0].get('head')

PHONE_POS = r'''(function(){ var v=[].filter.call(document.querySelectorAll(".view"),function(x){return !x.classList.contains("hidden");})[0]; if(!v) return "{}";
  var b=[].map.call(v.querySelectorAll(".pans"),function(e){ var r=e.getBoundingClientRect(); var s=getComputedStyle(e).transform; return [r.left,r.top,r.right,r.bottom]; });
  var h=document.querySelector(".ptop").getBoundingClientRect(); return JSON.stringify({ b:b, head:h.height }); })()'''

def phone(B, base):
    print('\nTHE TRIVIA PHONE at 375x812')
    m = load(B, base, '/app/trivia/play.html?demo=1&sting=0', 375, 812, True,
             [('question', 3000), ('locked', 6500), ('right', 9500), ('wrong', 22500)], PHONE_PROBE)
    q, lk, rt, wr = (m.get(k, {}) for k in ('question', 'locked', 'right', 'wrong'))
    ok('the demo is on its question, locked in, then its results', (q.get('view'), lk.get('view'), rt.get('view'), wr.get('view')) == ('vQ', 'vQ', 'vRes', 'vRes'),
       [q.get('view'), lk.get('view'), rt.get('view'), wr.get('view')])
    L = q.get('logo')
    ok('the venue\'s logo is top left', bool(L) and L[0] <= 20 and L[1] <= 30, L)
    ok('and clear of the menu button', bool(L and q.get('menu')) and L[2] + 8 <= q['menu'][0], [L, q.get('menu')])
    ok('no player name in the header', 'Dre' not in (q.get('head') or ''), q.get('head'))
    ok('the label is just "QUESTION 3 OF 20" (no "TRIVIA")', (q.get('lbl') or '').strip().lower() == 'question 3 of 20', q.get('lbl'))
    D_, MB_ = q.get('dotR'), q.get('menu')
    ok('the green dot sits next to the menu button, top right, level with it', bool(D_ and MB_) and D_[2] <= MB_[0] and MB_[0] - D_[2] <= 16 and abs((D_[1] + D_[3]) / 2 - (MB_[1] + MB_[3]) / 2) <= 3, [D_, MB_])
    ok('the green connection dot is there, with no "Connected" words beside it', q.get('dot', 0) >= 6 and 0 <= q.get('stw', 9) <= 1, [q.get('dot'), q.get('stw')])
    F, V = q.get('foot'), q.get('viewR')
    ok('our venueplay logo is at the bottom, under the game', bool(F and V) and F[1] >= V[3] - 1 and F[2] - F[0] >= 120, [F, V])
    for name, x in (('question', q), ('locked in', lk), ('right', rt), ('wrong', wr)):
        ok('nothing under 15px on the %s screen' % name, x.get('small') == [], x.get('small'))
    ok('the buttons carry the TV\'s four colours', [b['c'].upper() for b in q.get('btns') or []] == COLOURS, [b['c'] for b in q.get('btns') or []])
    qb = q.get('btns') or []
    ok('FULL COLOUR: each answer button is filled with its own colour, so a player can pick by colour at a glance',
       len(qb) == 4 and [b['bg'] for b in qb] == [rgb(c) for c in COLOURS], [b['bg'] for b in qb])
    ok('the letters are BIG and bold, in Anton (at least 36px, the old phone was 26px)', len(qb) == 4 and all(b['lfs'] >= 36 and 'Anton' in b['lff'] for b in qb), [(b['lfs'], b['lff'][:12]) for b in qb])
    ok('the letters are WHITE, at least 3:1 on their colour (44px Anton is large text), and amber\'s, which cannot be, has a firm dark shadow',
       len(qb) == 4 and all(b['lfg'] == 'rgb(255, 255, 255)' and (contrast(b['bg'], b['lfg']) >= 3.0 or (i == 2 and 'rgba(0, 0, 0, 0.45)' in b['lts'])) for i, b in enumerate(qb)),
       [(b['bg'], b['lfg'], round(contrast(b['bg'], b['lfg']), 2), b['lts'][:40]) for b in qb])
    ok('and the words on every colour pass AA contrast (4.5:1)', len(qb) == 4 and all(contrast(b['bg'], b['fg']) >= 4.5 for b in qb),
       [(b['bg'], b['fg'], round(contrast(b['bg'], b['fg']), 2)) for b in qb])
    pk = [b for b in lk.get('btns') or [] if 'picked' in b['cls']]
    ok('locked in: the pick stays full colour, ringed in its colour', len(pk) == 1 and pk[0]['op'] == 1 and pk[0]['bg'] == rgb(COLOURS[1]) and pk[0]['c'].lower() in pk[0]['sh'].lower() or
       (len(pk) == 1 and pk[0]['op'] == 1 and pk[0]['bg'] == rgb(COLOURS[1]) and rgb(COLOURS[1]) in pk[0]['sh']), [(b['cls'], b['bg'], b['sh'], b['op']) for b in lk.get('btns') or []])
    ok('and the other three dim', sum(1 for b in lk.get('btns') or [] if 'picked' not in b['cls'] and b['op'] < 0.6) == 3, [(b['cls'], b['op']) for b in lk.get('btns') or []])
    ok('locked in: no "Watch the TV for the answer" on the phone', 'watch the tv' not in (lk.get('all') or '').lower(), (lk.get('all') or '')[-120:])
    for nm_, x_ in (('question', q), ('result', rt)):
        ok('"Question 3 of 20" sits centred under the ring and above the question on the %s' % nm_,
           bool(x_.get('lblR') and x_.get('ringR') and x_.get('qR')) and x_['lblR'][1] >= x_['ringR'][3] - 0.5 and x_['lblR'][3] <= x_['qR'][1] + 0.5 and abs((x_['lblR'][0] + x_['lblR'][2]) / 2 - (x_['ringR'][0] + x_['ringR'][2]) / 2) <= 2,
           [x_.get('ringR'), x_.get('lblR'), x_.get('qR')])
    P_, RR_ = rt.get('ptsR'), rt.get('ringR')
    ok('the result: the points just won sit in the ring\'s place', bool(P_ and RR_) and P_[0] >= RR_[0] and P_[2] <= RR_[2] and P_[1] >= RR_[1] and P_[3] <= RR_[3] and (rt.get('ptsT') or '').startswith('+'), [P_, RR_, rt.get('ptsT')])
    T_ = rt.get('totR')
    ok('and the running total sits small in the bottom-right corner', bool(T_) and T_[0] >= 375 / 2 and T_[2] >= 375 - 24 and T_[3] >= 812 * 0.8 and (T_[3] - T_[1]) <= 24, [T_, rt.get('totT')])
    for nm_, x_ in (('question', q), ('result', rt)):
        ok('the countdown sits ABOVE the question on the %s' % nm_, bool(x_.get('ringR') and x_.get('qR')) and x_['ringR'][3] <= x_['qR'][1] + 0.5, [x_.get('ringR'), x_.get('qR')])
    gr = [b for b in rt.get('btns') or [] if 'right' in b['cls']]
    ok('a right answer: green, "RIGHT · YOURS"', len(gr) == 1 and gr[0]['bg'] == GREEN and 'yours' in gr[0]['tag'].lower(), [(b['cls'], b['bg'], b['tag']) for b in rt.get('btns') or []])
    ok('the result shows the question the room saw', rt.get('rq') and rt.get('rq') == 'Which Australian city hosted the 2000 Summer Olympics?', rt.get('rq'))
    h1 = phone_stable(B, base, '', 'phone, Tugun\'s round logo')
    h2 = phone_stable(B, base, '/__fixture/wide-logo.svg', 'phone, a wide wordmark')
    ok('the header is the same height with a round logo and a wide one', h1 is not None and h2 is not None and abs(h1 - h2) <= 1, [h1, h2])
    mine = [b for b in wr.get('btns') or [] if 'mine' in b['cls']]
    ok('a wrong answer: the pick is outlined in its colour and tagged YOURS, the right one green',
       len(mine) == 1 and mine[0]['tag'].lower() == 'yours' and 'inset' in mine[0]['sh'] and any(b['bg'] == GREEN for b in wr.get('btns') or []),
       [(b['cls'], b['tag']) for b in wr.get('btns') or []])


def host():
    print('\nTHE HOST CONSOLE: the Time\'s-up buzzer switch')
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
    import admin_site
    S = admin_site.Site(root=ROOT)
    try:
        V1 = S.W.info['venue']
        tid, sid = S.open('/app/trivia/host.html?venue=' + V1, 1280, 900, False)
        S.until(sid, 'document.getElementById("statusText").textContent==="Signed in"', 25)
        SEG = '(function(){var r=document.getElementById("buzzerRow"), g=document.getElementById("cfgBuzzer"); if(!r||!g) return null; var b=r.getBoundingClientRect();' \
              'return {label:r.innerText, h:b.height, on:[].filter.call(r.querySelectorAll(".seg button"),function(x){return x.classList.contains("on");}).map(function(x){return x.textContent;}).join(),' \
              'vis:b.width>0&&b.height>0&&getComputedStyle(r).display!=="none", top:b.top};})()'
        S.until(sid, '(function(){var r=document.getElementById("buzzerRow"); return !!r && r.getBoundingClientRect().height>0;})()', 20)
        a = S.js(sid, SEG)
        a = json.loads(a) if isinstance(a, str) else a
        ok('the console has a "Time\'s-up buzzer" switch, on screen at the top', bool(a) and a['vis'] and "Time's-up buzzer" in a['label'] and a['top'] < 200, a)
        ok('a compact row, not a hero panel (no taller than 44px)', bool(a) and a['h'] <= 44, a)
        ok('it is OFF by default, playing on the TV', bool(a) and a['on'] == 'Off,TV', a)
        ok('with the choice of where it plays: "TV" or "This device"', bool(a) and 'TV' in a['label'] and 'This device' in a['label'], a)
        H = S.js(sid, '(function(){function R(e){if(!e)return null;var b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom];}'
                      'var row=document.getElementById("buzzerRow"), lab=row.querySelector("label"), ctl=row.lastElementChild, f=document.querySelector("#setupBlock .field");'
                      'var fl=f.querySelector("label"), sel=document.getElementById("setSel");'
                      'return {lab:R(lab), ctl:R(ctl), fieldLab:R(fl), sel:R(sel), catText:fl.textContent.trim(), nav:(document.querySelector(".vp-navlink")||{}).textContent,'
                      'status:document.getElementById("statusText").textContent, hint:!document.getElementById("tvHint").classList.contains("hidden")};})()')
        ok('the buzzer row lines up with the other setting rows: its label where theirs are, its switch at the right edge',
           bool(H) and abs(H['lab'][0] - H['fieldLab'][0]) <= 1 and abs(H['ctl'][2] - H['sel'][2]) <= 2, H)
        ok('the picker is a CATEGORY drop-down', bool(H) and H['catText'].startswith('Category'), H and H['catText'])
        ok('the way back is clearly labelled "All games"', bool(H) and 'All games' in (H['nav'] or ''), H and H['nav'])
        ok('no TV yet: the console says so in plain words, and how to fix it',
           bool(H) and (H['status'] != 'TV not connected yet' or H['hint'] is True) and 'Waiting for screen' not in H['status'], H)
        S.js(sid, 'document.querySelector(\'#cfgBuzzer [data-v="on"]\').click(); document.querySelector(\'#cfgBuzzWhere [data-v="device"]\').click(); true')
        time.sleep(0.5)
        S.close_tab(tid)
        tid, sid = S.open('/app/trivia/host.html?venue=' + V1, 1280, 900, False)
        S.until(sid, 'document.getElementById("statusText").textContent==="Signed in"', 25)
        time.sleep(1.5)
        b = S.js(sid, SEG)
        b = json.loads(b) if isinstance(b, str) else b
        ok('switched On, on this device: still so when the console is opened again', bool(b) and b['on'] == 'On,This device', b)
        S.close_tab(tid)
        tid, sid = S.open('/app/trivia/host.html?venue=' + V1, 390, 844, True)
        S.until(sid, 'document.getElementById("statusText").textContent==="Signed in" || /TV/.test(document.getElementById("statusText").textContent)', 25)
        time.sleep(1)
        P = S.js(sid, '(function(){function R(s){var e=document.querySelector(s);if(!e)return null;var b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom];}'
                      'return {brand:R(".bar>.brand"), who:R(".bar>.who"), nav:R(".bar>.vp-navlink"), end:R("#toAdsBtn"), W:innerWidth};})()')
        ok('phone width: the venueplay logo, TRIVIA and the TV status on the first row, "All games" and End game under them',
           bool(P and P['brand'] and P['nav'] and P['end']) and P['nav'][1] >= P['brand'][3] - 1 and P['end'][1] >= P['brand'][3] - 1 and P['brand'][0] <= 30 and P['end'][2] <= P['W'], P)
        S.close_tab(tid)
    finally:
        S.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-newlook-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)   # a page asks for a dozen files at once; the default backlog of 5 drops some, and a script silently never loads
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        tv(B, base, 1920, 1080)
        tv(B, base, 1280, 720)
        tv(B, base, 1920, 1080, '/__fixture/wide-logo.svg')
        tv(B, base, 1280, 720, '/__fixture/wide-logo.svg')
        phone(B, base)
    finally:
        B.close(); srv.shutdown()
    host()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
