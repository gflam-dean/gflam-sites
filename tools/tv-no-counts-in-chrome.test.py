#!/usr/bin/env python3
"""NO PLAYER OR ANSWERED COUNTS ON ANY TV GAME SCREEN, AS CHROME PAINTS THEM (Dean, 4 Nov 2026).

Dean: "I don't want people being like oh how did they know that we only had 12 people rock up today?"
How many joined, how many answered, how many entries are in a draw: those stay on the HOST CONSOLE.
The wall shows none of them.

This opens every REAL TV game screen in its own sales-page demo (?demo=1), served from this checkout, on
Chrome's virtual clock, and at set moments hands the screen the messages a real host sends, each carrying
a SENTINEL count nobody would otherwise paint (4137 players, 2913 answered, 8642 entries). Then it reads
everything visible on the wall:

  - the sentinel number is nowhere on the wall
  - no "N players", "N answered", "N joined", "N entries", "N/N" or "3rd of N" shape anywhere
  - trivia: the countdown ring holds the seconds and SECS only (no "32/43"), on the question and the
    picture round
  - musical bingo, bingo (tv.html), the raffle, the members draw (and its purchase-raffle draw, which said
    "From 214 entries"), Top Answers: the same, over their lobbies, draws, winner and board screens

Bingo's "0 of 90 called" is the balls, not the room, and is allowed. Leaderboard points are allowed.

The pages are served with one line added beside each screen's own onMsg (window.__tvMsg), so the suite can
hand a screen a message the way the host's channel does; nothing else in the page is changed.

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
VP_SHOTS=<dir> saves a screenshot of every moment read. VP_SITE_ROOT=<dir> serves another checkout's
venueplay folder (the before pictures were taken that way, from origin/main).

    python3 tools/tv-no-counts-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, re, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
_spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
SITE = os.path.abspath(os.environ.get('VP_SITE_ROOT') or os.path.join(ROOT, 'venueplay'))
SHOTS = os.environ.get('VP_SHOTS', '')

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


HOOK_AT = '  function onMsg(m){'
HOOK = '  window.__tvMsg=function(o){ return onMsg(o); };\n'


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
        if u.path == '/__fake/qrcode.js':
            return self.send(200, 'window.QRCode={toCanvas:function(c,t,o,cb){if(typeof o==="function")o(null);else if(cb)cb(null);}};', 'application/javascript')
        p = u.path
        if p == '/tv': p = '/tv.html'
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
            if ext == '.html' and t.count(HOOK_AT) == 1:
                t = t.replace(HOOK_AT, HOOK + HOOK_AT)
            return self.send(200, t, {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json'}[ext] + '; charset=utf-8')
        ct = {'.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ct)


T0 = 1793500000000          # a fixed instant, never the real clock
FREEZE = r'''(function(){ var a=document.getAnimations?document.getAnimations():[];
  a.forEach(function(x){ try{ var t=x.effect&&x.effect.getComputedTiming(); if(t&&isFinite(t.endTime)) x.finish(); else { x.pause(); x.currentTime=0; } }catch(e){} });
  return a.length; })()'''

# Everything the room can SEE: visible text, top to bottom, plus what each screen keeps in its count slots.
PROBE = r'''(function(){
  function vis(e){ for(var x=e;x&&x.nodeType===1;x=x.parentElement){ var s=getComputedStyle(x); if(s.display==="none"||s.visibility==="hidden"||parseFloat(s.opacity)===0) return false; } var b=e.getBoundingClientRect(); return b.width>0&&b.height>0; }
  var parts=[], w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  for(var n=w.nextNode(); n; n=w.nextNode()){ var t=(n.nodeValue||"").replace(/\s+/g," ").trim(); if(!t) continue;
    var p=n.parentElement; if(!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || !vis(p)) continue; parts.push(t); }
  var out={ text: parts.join(" "), hook: typeof window.__tvMsg==="function" };
  var lay=[].filter.call(document.querySelectorAll(".layer"),function(l){ return !l.classList.contains("hidden") && getComputedStyle(l).display!=="none"; })[0];
  out.layer = lay ? lay.id : null;
  var rn=document.querySelector("#tvQ .ringwrap .rnum");
  if(rn){ out.ring=(rn.textContent||"").replace(/\s+/g,""); out.ringKids=rn.children.length; out.rcount=!!document.querySelector(".rcount,#tvAnsCount,#tvAnsOf"); }
  return JSON.stringify(out);
})()'''

COUNT_SHAPES = [
    (r'\b\d+\s*/\s*\d+\b', 'an "N/N" count'),
    (r'\b\d[\d,]*\s+(players?|teams?|people|entries|entrants|answered|joined|playing|in the room|here tonight|got it right)\b', 'an "N players/answered/entries" count'),
    (r'\b(players?|teams?|answered|joined|entries|entrants)\s*[:·]?\s*\d', 'a "players: N" count'),
    (r'\bof\s+\d+\s+(players?|teams?|people)\b', 'an "of N players" count'),
    (r'\b\d+(st|nd|rd|th)\s+of\s+\d+\b', 'a "3rd of N" place'),
    (r'\bfrom\s+\d[\d,]*\b', 'a "from N" count'),
]
SENTINELS = ('4137', '4,137', '2913', '2,913', '8642', '8,642')


def text_checks(tag, x):
    t = (x or {}).get('text') or ''
    hit = [w for w in SENTINELS if re.search(r'(?<![\d,])' + re.escape(w) + r'(?![\d,])', t)]
    ok(tag + ': the count the host sent (4137 players, 2913 answered, 8642 entries) is nowhere on the wall', bool(t) and not hit, (hit, t[-300:]))
    shapes = [label + ' "' + m.group(0) + '"' for rx, label in COUNT_SHAPES for m in [re.search(rx, t, re.I)] if m]
    ok(tag + ': no player, answered or entries count of any shape on the wall', bool(t) and not shapes, (shapes, t[-300:]))


def load(B, base, path, w, h, states, key):
    """states: [(name, at_ms, js_to_run_first or None)]. Advances the virtual clock to each, runs the js (a host's
    messages), lets 400ms pass, freezes the animations and reads PROBE."""
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    out = {}
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
        B.call('Emulation.setVirtualTimePolicy', {'policy': 'pause', 'initialVirtualTime': T0 / 1000.0}, session=sid)
        B.call('Page.navigate', {'url': base + path}, session=sid)
        at = 0
        def advance(to):
            nonlocal at
            if to <= at: return
            B.call('Emulation.setVirtualTimePolicy', {'policy': 'pauseIfNetworkFetchesPending', 'budget': to - at}, session=sid)
            end = time.time() + 120
            while time.time() < end:
                r = B.evaluate(sid, 'Date.now()', 10)
                v = r and r.get('result', {}).get('value')
                if v and v >= T0 + to - 5: break
                time.sleep(0.2)
            at = to
        for name, ms, js in states:
            advance(ms)
            if js:
                B.evaluate(sid, '(function(){ var S=window.__tvMsg; if(!S) return false; ' + js + '; return true; })()', 20)
                advance(ms + 400)
            B.evaluate(sid, FREEZE, 20); time.sleep(0.3)
            r = B.evaluate(sid, PROBE, 30)
            out[name] = json.loads(r['result']['value']) if r and r.get('result', {}).get('value') else {}
            if SHOTS:
                png = base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data'])
                open(os.path.join(SHOTS, '%s-%s.png' % (key, name)), 'wb').write(png)
    finally:
        B.close_tab(tid)
    return out


PLAYERS = 'S({t:"players",count:4137})'
TRIVIA_Q = ('S({t:"players",count:4137}); S({t:"question",qseq:91,qi:4,qtotal:20,text:"Which planet is known as the Red Planet?",'
            'options:["Venus","Mars","Jupiter","Saturn"],secs:20,endsAt:Date.now()+15000}); '
            'S({t:"answer",qseq:91,pid:"p1"}); S({t:"answered",count:2913})')

SCREENS = [
    # (key, title, path, [(moment, ms, js)])
    ('trivia', 'TRIVIA', '/app/trivia/screen.html?demo=1&sting=0',
     [('lobby', 100, PLAYERS), ('question', 4600, 'S({t:"answered",count:2913})'), ('reveal', 9000, None),
      ('board', 12500, None), ('question-sentinel', 14000, TRIVIA_Q), ('podium', 44000, PLAYERS)]),
    ('musical', 'MUSICAL BINGO', '/app/musical/screen.html?demo=1&sting=0',
     [('lobby', 800, PLAYERS + '; S({t:"state",phase:"lobby",playerCount:4137})'), ('playing', 6000, PLAYERS), ('later', 16000, PLAYERS),
      ('claim', 30000, None), ('end', 60000, PLAYERS)]),
    ('bingo', 'BINGO (tv.html)', '/tv.html?demo=1&sting=0',
     [('start', 800, PLAYERS), ('playing', 8000, PLAYERS), ('later', 20000, PLAYERS), ('end', 50000, PLAYERS)]),
    ('raffle', 'THE RAFFLE', '/app/raffle/screen.html?demo=1&sting=0',
     [('start', 800, None), ('drawing', 5000, None), ('winner', 12000, None), ('later', 30000, None)]),
    ('members', 'THE MEMBERS DRAW', '/app/members/screen.html?demo=1&sting=0',
     [('drawing', 1500, None), ('winner', 8000, None), ('rollover', 15000, None),
      ('purchase-raffle-draw', 21000, 'S({t:"drawing",kind:"entries",entriesTotal:8642,drawName:"Christmas raffle",amountCents:0,spinSecs:5})')]),
    ('topanswers', 'TOP ANSWERS', '/app/topanswers/screen.html?demo=1&sting=0',
     [('start', 1500, None), ('round', 10000, None), ('later', 25000, None)]),
]


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('tv-no-counts-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = VL.Browser()
    try:
        for key, title, path, states in SCREENS:
            print('\n%s at 1920x1080 (%s)' % (title, path))
            m = load(B, base, path, 1920, 1080, states, key)
            needs_hook = any(js for _, _, js in states)
            if needs_hook:
                ok('%s: the screen took the host\'s messages (the suite reached its onMsg)' % title, all((m.get(n) or {}).get('hook') for n, _, js in states if js),
                   [(n, (m.get(n) or {}).get('hook')) for n, _, _ in states])
            for name, _, _ in states:
                text_checks('%s, %s' % (title, name), m.get(name))
            if key == 'trivia':
                for name in ('question', 'question-sentinel'):
                    x = m.get(name) or {}
                    ok('TRIVIA, %s: on the countdown' % name, x.get('layer') == 'tvQ', x.get('layer'))
                    ok('TRIVIA, %s: the ring holds the seconds and SECS only (no "32/43")' % name,
                       bool(re.match(r'^\d+secs$', (x.get('ring') or '').lower())) and x.get('ringKids') == 2 and x.get('rcount') is False,
                       [x.get('ring'), x.get('ringKids'), x.get('rcount')])
            if key == 'members':
                x = m.get('purchase-raffle-draw') or {}
                ok('THE MEMBERS DRAW, purchase raffle: no "entries" count of any kind', 'entries' not in (x.get('text') or '').lower(), (x.get('text') or '')[-200:])
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
