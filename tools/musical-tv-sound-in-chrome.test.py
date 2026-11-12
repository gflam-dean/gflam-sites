#!/usr/bin/env python3
"""THE TV THAT PLAYS IS NEVER CALLED BLOCKED, AND THE TV APP NEVER ASKS FOR A CLICK (Dean, live play on The Mini Bar with
the Kogan Tizen app, 12 Nov 2026, INBOX 282 items 2 and 7).

What Dean saw: the console said "The TV has no sound yet. Click once on the TV screen" while the Kogan played Meat Loaf;
the remote's OK does nothing in the app, so there was no way past it; song 2 of game 1 played nothing; no fade was heard
(a whole 30 s clip at full). This plays REAL clips (tones served by this test, some of them slowly, the way an Apple
preview arrives over pub wifi) in the REAL TV page, app/musical/screen.html, and listens to what the TV tells the console
on the fake Realtime channel.

  A SLOW CLIP on a TV that allows sound: never "blocked", no click bar, and it plays when it arrives
  NEXT WHILE SONG 1 IS STILL LOADING: song 1's play() is cut short (AbortError); that is not a refusal; song 2 plays
  A NIGHT OF SONGS: song 1 to its end, song 2, Next mid-clip, song 3: every one plays, none is called blocked
  THE FADE ON A TV WITH THE ROOM VOLUME GRAPH: the element carries the fade (0 at the start, full in the middle, never
    above 1) and the gain carries only the Room volume, so a TV whose player bypasses Web Audio still fades
  AN AUDIO CONTEXT THE BROWSER HOLDS SUSPENDED: the clip is never handed to a silent graph; it plays straight out
  THE TV APP (&app=tizen) ON A TV THAT REFUSES: no click bar on the screen; the console is told it is the app

    python3 tools/musical-tv-sound-in-chrome.test.py
"""
import importlib.util, json, os, sys, threading, time, http.server, urllib.parse, base64

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
_spec = importlib.util.spec_from_file_location('clip_fade', os.path.join(HERE, 'clip-fade-in-chrome.test.py'))
CF = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(CF)
NL = CF.NL

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1

# Tones as files this test serves: /__clip/<song>.wav?d=<seconds to wait before answering>
WAV = {k: base64.b64decode(v.split(',', 1)[1]) for k, v in CF.CLIPS.items()}

class Slow(NL.Site):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/__clip/'):
            song = u.path[len('/__clip/'):].split('.')[0]
            d = float((urllib.parse.parse_qs(u.query).get('d') or ['0'])[0])
            if d > 0: time.sleep(d)
            b = WAV[song]
            try:
                self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(b)))
                self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
            except Exception: pass
            return
        return NL.Site.do_GET(self)

# What the TV says to the console, heard on the same fake Realtime channel.
LISTEN = ('(function(ch){ if(window.__tvSaid) return true; window.__tvSaid=[]; var b=new BroadcastChannel("fake-rt:"+ch);'
          ' b.onmessage=function(e){ if(e.data && e.data.payload) window.__tvSaid.push(e.data.payload); }; return true; })(%s)')
SUSPENDED = ('(function(){ var R=window.AudioContext||window.webkitAudioContext; if(!R) return; window.__srcWhileSuspended=0;'
             ' var ms=R.prototype.createMediaElementSource; R.prototype.createMediaElementSource=function(){ if(this.state!=="running") window.__srcWhileSuspended++; return ms.apply(this,arguments); };'
             ' function S(){ var c=new R(); try{ c.suspend(); }catch(e){} Object.defineProperty(c,"state",{ get:function(){ return "suspended"; } });'
             ' c.resume=function(){ return Promise.resolve(); }; return c; } S.prototype=R.prototype; window.AudioContext=S; window.webkitAudioContext=S; })();')

def page(args, extra='', pre=''):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Slow)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    NL.W['logo'] = '/logos/venue-tugun-bowls.png'; NL.W['name'] = 'The Mini Bar'
    slug = 'the-mini-bar'
    chan = 'vp-' + NL.venue_code('musical-' + slug)
    B = NL.VL.Browser(extra_args=args)
    P = NL.Page(B, base, '/app/musical/screen.html?sting=0&venue=' + slug + extra, 1920, 1080, False,
                'try{ sessionStorage.setItem("vpTvHop","1"); }catch(e){}' + CF.CATCH + pre)
    P.until('document.getElementById("tvLobby") && window.VPTvGame', 20); time.sleep(1.2)
    P.js(CF.recorder('clipAudio'))
    P.js(LISTEN % json.dumps(chan))
    P.js(NL.say(chan, [{'t': 'host_here'}, {'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': [], 'playerCount': 3}]))
    time.sleep(0.8)
    P.js(NL.say(chan, [{'t': 'volume', 'level': 2.0}, {'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'played': []}]))
    time.sleep(0.6)
    return B, srv, P, chan

def played(chan, song, n, delay=0):
    return NL.say(chan, [{'t': 'played', 'title': 'Song ' + song, 'artist': 'Artist', 'artworkUrl': '/__fixture/art-a03030.svg',
                          'previewUrl': '/__clip/%s.wav?d=%s' % (song, delay), 'played': ['Song %d' % i for i in range(n)], 'reveal': 'end'}])

def said(P): return P.obj('JSON.stringify(window.__tvSaid||[])') or []
def blocked_said(P): return [m for m in said(P) if m.get('t') == 'tv_audio_blocked' or (m.get('t') == 'tv_here' and m.get('audio') == 'blocked')]
def bar(P): return P.js('!!document.getElementById("audioWarn")') is True
def moving(P, song):
    rs = CF.samples(P.js, 0)
    return [r for r in rs if CF.which(r.get('d')) == song and not r.get('p') and (r.get('ct') or 0) > 0.3]
def errs(P): return (P.js('JSON.stringify(window.__errs||[])') or '[]')


def slow_scene():
    print('\nA SLOW CLIP (4.5 s to arrive) on a TV that allows sound, then Next while a clip is still loading')
    B, srv, P, chan = page(CF.ALLOW)
    try:
        P.js(played(chan, 'A', 1, 4.5))
        time.sleep(3.8)
        ok('3.8 s in, the clip still loading: no click bar on the TV', not bar(P), P.js('document.getElementById("audioWarn") && document.getElementById("audioWarn").textContent'))
        ok('and the console has NOT been told the TV is blocked', not blocked_said(P), blocked_said(P))
        time.sleep(3.5)
        ok('CONTROL: the slow clip then really plays (its clock moves)', len(moving(P, 'A')) > 10, len(moving(P, 'A')))
        ok('still no bar and nothing "blocked" said, all the way through', not bar(P) and not blocked_said(P), blocked_said(P))
        # Next while song B is still loading: B's play() is cut short by C's load
        P.js(played(chan, 'B', 2, 4.0)); time.sleep(0.6)
        P.js(played(chan, 'C', 3, 0)); time.sleep(4.0)
        ok('Next while song B was loading: song C plays', len(moving(P, 'C')) > 10, len(moving(P, 'C')))
        ok('and the cut-short play() of song B is not reported as a refusal: no bar, no "blocked"', not bar(P) and not blocked_said(P), blocked_said(P))
        ok('no script errors on the wall', not errs(P).strip('[]'), errs(P))
    finally:
        B.close(); srv.shutdown()


def night_scene():
    print('\nA NIGHT OF SONGS, Room volume 200%: song 1 to its end, song 2, Next mid-clip, song 3')
    B, srv, P, chan = page(CF.ALLOW)
    try:
        P.js(played(chan, 'G', 1)); time.sleep(CF.LEN['G'] + 1.0)
        ok('song 1 played to its end', len(moving(P, 'G')) > 50 and P.js('document.getElementById("clipAudio").ended') is True, len(moving(P, 'G')))
        P.js(played(chan, 'A', 2)); time.sleep(4.0)
        a = moving(P, 'A')
        ok('song 2 plays after song 1 ended (nothing left at 0, nothing left paused)', len(a) > 20 and max(r['v'] for r in a) > 0.97, [round(r['v'], 2) for r in a][::10])
        P.js(played(chan, 'B', 3)); time.sleep(4.0)
        b = moving(P, 'B')
        ok('song 3 after Next mid-clip plays and comes up to full', len(b) > 20 and max(r['v'] for r in b) > 0.97, [round(r['v'], 2) for r in b][::10])
        rs = [r for r in CF.samples(P.js, 0) if not r.get('p') and r.get('g') is not None]
        ok('CONTROL: the Room volume graph was built (a gain node is sampled)', len(rs) > 20, len(rs))
        ok('THE FADE IS ON THE ELEMENT: at a clip\'s start the element is under 15%', any(r['v'] < 0.15 and (r.get('ct') or 0) < 0.2 for r in rs), [(round(r['ct'], 2), round(r['v'], 2)) for r in rs][:6])
        ok('the element is never above 1', all(r['v'] <= 1.0 for r in rs))
        ok('THE GAIN IS THE ROOM VOLUME ONLY: 200% the whole time, the fade never moves it', all(abs(r['g'] - 2.0) < 0.01 for r in rs if (r.get('ct') or 0) > 0.05), sorted(set(round(r['g'], 2) for r in rs))[:6])
        ok('no song was ever called blocked', not bar(P) and not blocked_said(P), blocked_said(P))
        ok('no script errors on the wall', not errs(P).strip('[]'), errs(P))
    finally:
        B.close(); srv.shutdown()


def suspended_scene():
    print('\nAN AUDIO CONTEXT THE BROWSER HOLDS SUSPENDED (a TV app or kiosk before any gesture)')
    B, srv, P, chan = page(CF.ALLOW, '', SUSPENDED)
    try:
        P.js(played(chan, 'A', 1)); time.sleep(3.5)
        ok('CONTROL: the clip plays (its clock moves)', len(moving(P, 'A')) > 20, len(moving(P, 'A')))
        ok('the clip is never handed to a graph that is not running (it would play into silence for the rest of the night)', P.js('window.__srcWhileSuspended') == 0, P.js('window.__srcWhileSuspended'))
        P.js(played(chan, 'B', 2)); time.sleep(3.0)
        ok('song 2 plays too', len(moving(P, 'B')) > 20, len(moving(P, 'B')))
        ok('still nothing handed to the suspended graph', P.js('window.__srcWhileSuspended') == 0, P.js('window.__srcWhileSuspended'))
    finally:
        B.close(); srv.shutdown()


def app_scene():
    print("\nTHE TV APP'S ADDRESS (&app=tizen) on a TV that REFUSES sound: no click is ever asked for")
    B, srv, P, chan = page(CF.BLOCKED, '&app=tizen')
    try:
        P.js(played(chan, 'A', 1)); time.sleep(4.0)
        bl = blocked_said(P)
        ok('CONTROL: the refusal is real (the console is told)', any(m.get('t') == 'tv_audio_blocked' for m in bl), said(P)[-4:])
        ok('the console is told it is the venueplay TV app (app:"tizen"), so it never says "click"', any(m.get('t') == 'tv_audio_blocked' and m.get('app') == 'tizen' for m in bl), bl)
        ok('no click bar on the TV app\'s screen', not bar(P), P.js('document.body.innerText.slice(-200)'))
    finally:
        B.close(); srv.shutdown()
    print('\nCONTROL: the same refusal in a BROWSER TV still shows the click bar')
    B, srv, P, chan = page(CF.BLOCKED)
    try:
        P.js(played(chan, 'A', 1)); time.sleep(4.0)
        ok('CONTROL: a browser TV that refuses still gets "Click anywhere on this screen to turn the sound on"', bar(P), said(P)[-3:])
    finally:
        B.close(); srv.shutdown()


if __name__ == '__main__':
    slow_scene()
    night_scene()
    suspended_scene()
    app_scene()
    print('\n%d of %d checks passed' % (ran - bad, ran))
    sys.exit(1 if bad else 0)
