#!/usr/bin/env python3
"""THE JOIN SQUARE ON THE WALL: OUR OWN QR LIBRARY, A LATE ONE, AND NONE AT ALL (1 Nov 2026).

The QR on every venue screen is drawn on the TV, into a canvas, by qrcode 1.4.4. It came from
cdn.jsdelivr.net, so a venue network that blocks or cannot reach a public CDN got a blank white
square, lit up on the pub wall, and vp-qr.js returned without a word. Now the library is ours
(/app/vendor/qrcode-1.4.4.min.js), and vp-qr.js draws again the moment a late library arrives and,
until it does, puts the words in the square instead.

This opens the REAL screens, served from this checkout in headless Chrome, three ways:
  OURS     the vendored library: the code is drawn (dark modules in the canvas), no fallback
  NONE     the library answers 404: the square says "Scan not available", the address, and the
           code big; the white panel is gone; nothing throws
  LATE     the library fails, then arrives 2 seconds later: the words first, then the code drawn by
           vp-qr.js itself (the page draws nothing again) and the words gone
on the bingo TV's join lobby (?demo=1) and the trivia screen's pairing lobby, at 1920x1080 and
1280x720. Screenshots to $VP_SHOTS.

    python3 tools/qr-fallback-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SHOTS = os.environ.get('VP_SHOTS', '')
SITE = os.path.join(ROOT, 'venueplay')
QR = '/app/vendor/qrcode-1.4.4.min.js'

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

MODE = {'qr': 'ours'}

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
        if u.path == QR:
            mode = 'none' if ('qr=none' in (self.headers.get('Referer') or '') and 'late=1' not in (u.query or '')) else MODE['qr']
            if mode == 'none':
                return self.send(404, 'no', 'text/plain')
            if mode == 'late':
                time.sleep(4)
        p = u.path
        if p == '/tv': p = '/tv.html'
        elif not os.path.splitext(p)[1]: p = p + '.html'
        f = os.path.normpath(os.path.join(SITE, p.lstrip('/')))
        if not f.startswith(SITE) or not os.path.isfile(f):
            return self.send(404, 'no', 'text/plain')
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.html', '.js', '.css', '.json'):
            t = io.open(f, encoding='utf-8').read()
            t = t.replace('/app/vendor/supabase-js-2.118.0.min.js', '/__fake/supabase.js')
            t = t.replace('https://game.venueplay.com.au', '/__worker')
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)

# What the big square paints: dark modules in the canvas, the fallback's words, the code and its size.
LOOK = r'''(function(){
  var c=document.getElementById("qrBig"); if(!c) return JSON.stringify({none:true});
  var box=c.parentNode, fb=box.querySelector(".vpqr-fb"), dark=0;
  try{ var x=c.getContext("2d").getImageData(0,0,c.width,c.height).data; for(var i=0;i<x.length;i+=4) if(x[i+3]>200&&x[i]<100) dark++; }catch(e){ dark=-1; }
  var code=null, codePx=0;
  if(fb){ var d=fb.querySelectorAll("div"); for(var k=0;k<d.length;k++){ var t=(d[k].textContent||"").trim(); if(/^[A-Z0-9]{6}$/.test(t)){ code=t; codePx=parseFloat(getComputedStyle(d[k]).fontSize); } } }
  var r=box.getBoundingClientRect(), fr=fb?fb.getBoundingClientRect():null;
  var vis=function(e){ if(!e) return false; var s=getComputedStyle(e), b=e.getBoundingClientRect(); return s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0; };
  return JSON.stringify({dark:dark, fb:!!fb && vis(fb), canvasShown:vis(c), text:fb?fb.textContent:"", code:code, codePx:codePx,
    bg:getComputedStyle(box).backgroundColor, inside: fr ? (fr.left>=r.left-1&&fr.right<=r.right+1&&fr.top>=r.top-1&&fr.bottom<=r.bottom+1) : null,
    lib: typeof window.QRCode, errs:(window.__errs||[]).slice(0,3), boxW:r.width});
})()'''
ERRS = 'window.__errs=[];window.addEventListener("error",function(e){__errs.push(String(e.message))});'


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('qr-fallback-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()

    def page(path, w, h):
        tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
        B.call('Page.addScriptToEvaluateOnNewDocument', {'source': ERRS}, session=sid)
        B.call('Page.navigate', {'url': base + path}, session=sid)
        return tid, sid

    def look(sid):
        r = B.evaluate(sid, LOOK, 15)
        v = r and r.get('result', {}).get('value')
        return json.loads(v) if v else {}

    def until(sid, test, secs):
        end = time.time() + secs; m = {}
        while time.time() < end:
            m = look(sid)
            if test(m): return m
            time.sleep(0.25)
        return m

    def shot(sid, name):
        if SHOTS:
            open(os.path.join(SHOTS, name + '.png'), 'wb').write(base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data']))

    # (label, path, the code the square must show, join or pairing words)
    PAGES = [('the bingo TV join lobby', '/tv?demo=1', None, 'Go to venueplay.com.au/play and type the code'),
             ('the trivia pairing lobby', '/app/trivia/screen.html', None, "On the host console, put in this screen's code")]
    try:
        for (w, h) in ((1920, 1080), (1280, 720)):
            for label, path, _code, words in PAGES:
                tag = '%s at %dx%d' % (label, w, h)
                print('\n' + tag.upper())
                # OURS
                MODE['qr'] = 'ours'
                tid, sid = page(path, w, h)
                m = until(sid, lambda m: m.get('dark', 0) > 500 and m.get('boxW', 0) > 0, 20)
                ok(tag + ': our own qrcode 1.4.4 loads and draws the code', m.get('lib') == 'object' and m.get('dark', 0) > 500, m)
                ok(tag + ': and no fallback is in the square', not m.get('fb') and m.get('canvasShown'), m)
                shot(sid, 'qr-ours-%s-%d' % (path.strip('/').split('/')[-1].split('.')[0].split('?')[0] or 'tv', w))
                B.close_tab(tid)
                # NONE
                tid, sid = page(path + ('&' if '?' in path else '?') + 'qr=none', w, h)
                m = until(sid, lambda m: m.get('fb') and m.get('boxW', 0) > 0, 15)
                ok(tag + ': with no library the square says "Scan not available."', m.get('fb') and 'Scan not available.' in m.get('text', ''), m)
                ok(tag + ': and what to do: "%s"' % words, words in (m.get('text') or ''), m.get('text'))
                ok(tag + ': with the code big (%dpx or more)' % (36 if w >= 1920 else 24), m.get('code') and m.get('codePx', 0) >= (36 if w >= 1920 else 24), (m.get('code'), m.get('codePx')))
                code_on_wall = B.evaluate(sid, '(function(){var e=document.querySelector(".codeval");return e?e.textContent.replace(/\\s+/g,""):"";})()', 10)
                cw = (code_on_wall or {}).get('result', {}).get('value', '')
                ok(tag + ': the code in the square is the code the wall shows beside it', not cw or cw == '------' or cw == m.get('code'), (cw, m.get('code')))
                ok(tag + ': the white panel is gone and the empty canvas hidden', m.get('bg') == 'rgb(18, 18, 20)' and not m.get('canvasShown'), (m.get('bg'), m.get('canvasShown')))
                ok(tag + ': the words stay inside the square', m.get('inside') is True, m)
                ok(tag + ': and nothing threw', not m.get('errs'), m.get('errs'))
                shot(sid, 'qr-none-%s-%d' % (path.strip('/').split('/')[-1].split('.')[0].split('?')[0] or 'tv', w))
                B.close_tab(tid)
            # LATE, once per size, on the pairing lobby (it holds still). A <script> tag in the page
            # blocks the page until it arrives, so "late" is the library failing at first and then
            # arriving afterwards (a retry, a cache that wakes up): the page adds it 2 seconds on.
            tag = 'a library that arrives late at %dx%d' % (w, h)
            print('\n' + tag.upper())
            tid, sid = page('/app/trivia/screen.html?qr=none', w, h)
            m = until(sid, lambda m: m.get('fb') and m.get('boxW', 0) > 0, 15)
            ok(tag + ': before it comes, the square says what to do', m.get('fb') and m.get('lib') != 'object', m)
            B.evaluate(sid, 'setTimeout(function(){var s=document.createElement("script");s.src="%s?late=1";document.head.appendChild(s);},2000);true' % QR, 10)
            m = until(sid, lambda m: m.get('dark', 0) > 500 and not m.get('fb'), 15)
            ok(tag + ': when it lands, the code is drawn and the words go, with nothing redrawn by the page', m.get('dark', 0) > 500 and not m.get('fb') and m.get('canvasShown'), m)
            ok(tag + ': and the white panel is back', m.get('bg') == 'rgb(255, 255, 255)', m.get('bg'))
            shot(sid, 'qr-late-trivia-%d' % w)
            B.close_tab(tid)
    finally:
        try: B.close()
        except Exception: pass
        srv.shutdown()
    print('\n%d of %d checks passed' % (ran - bad, ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
