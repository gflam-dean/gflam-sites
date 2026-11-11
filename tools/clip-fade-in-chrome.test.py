#!/usr/bin/env python3
"""MUSICAL BINGO CLIPS FADE IN AND OUT (INBOX 260, Dean 11 Nov 2026), AS CHROME PLAYS THEM.

Every clip fades IN over its first 1.5 s and OUT over its last 2.5 s; Next or Pause mid-clip fades out in about
half a second instead of cutting; the fade scales the Room volume and never overrides it. This plays REAL clips
(a tone as a data: address, so no network) in the REAL pages and samples, every 25 ms, the level the room gets:
the <audio> element's volume times the Room volume gain node's value (divided by the Room volume).

  THE TV (app/musical/screen.html, the stand-in Worker and fake Realtime of musical-newlook-in-chrome.test.py):
    a clip rises, holds, falls; Next mid-clip fades quickly then the next clip starts from 0; Next during the
    fade-in; Pause fades then pauses, Play comes back up; Pause inside Next's half second; Room volume 200% mid-clip
  A TV THAT BLOCKS SOUND (the click bar, fix/musical-live): one click plays the song and it fades in from 0,
    never stuck at 0, and the next song needs no click
  THE TV APP'S ADDRESS (&app=tizen) with NO Web Audio (an old TV whose graph cannot be built): the same rise and
    fall on the element's own volume
  THE CONSOLE (app/musical/host.html on tools/browser-rig/rig.py, the real game Worker, no TV, so the clip plays
    here): rise and hold, Pause and Play fade, Next mid-clip fades quickly into the next song from 0

    python3 tools/clip-fade-in-chrome.test.py
"""
import base64, http.server, importlib.util, json, math, os, struct, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
_spec = importlib.util.spec_from_file_location('musical_newlook', os.path.join(HERE, 'musical-newlook-in-chrome.test.py'))
NL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(NL)
import rig as RIG

ALLOW = ['--autoplay-policy=no-user-gesture-required']
BLOCKED = ['--autoplay-policy=document-user-activation-required']

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


def tone_uri(secs, rate=8000, hz=440):
    n = int(secs * rate)
    pcm = b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * hz * i / rate))) for i in range(n))
    hdr = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm))
    return 'data:audio/wav;base64,' + base64.b64encode(hdr + pcm).decode('ascii')

# Each song has its own length, so a sample says which clip was on by its duration.
LEN = {'A': 8.0, 'B': 9.0, 'C': 10.0, 'D': 11.0, 'E': 12.0, 'F': 13.0, 'G': 7.0}
CLIPS = {k: tone_uri(v, hz=330 + 40 * i) for i, (k, v) in enumerate(sorted(LEN.items()))}
def which(dur):
    for k, v in LEN.items():
        if dur is not None and abs(dur - v) < 0.05: return k
    return None

# Before the page: catch the Room volume gain node (the first gain made after a media element source).
CATCH = ('(function(){var P=(window.AudioContext||window.webkitAudioContext||function(){}).prototype; if(!P||!P.createGain) return;'
         'var ms=P.createMediaElementSource, cg=P.createGain; window.__gains=[]; window.__srcSeen=false;'
         'if(ms) P.createMediaElementSource=function(){ window.__srcSeen=true; return ms.apply(this,arguments); };'
         'P.createGain=function(){ var g=cg.apply(this,arguments); if(window.__srcSeen) window.__gains.push(g); return g; };})();')
NO_WEBAUDIO = 'try{ window.AudioContext=undefined; window.webkitAudioContext=undefined; }catch(e){}'

def recorder(el_id):
    return ('(function(){ if(window.__rec) return true; window.__rec=[]; var a=document.getElementById("%s");'
            ' setInterval(function(){ var g=(window.__gains&&window.__gains.length)? window.__gains[0].gain.value : null;'
            ' window.__rec.push({ ms:performance.now(), ct:a.currentTime, d:(isFinite(a.duration)?a.duration:null), v:a.volume, g:g, p:a.paused, m:a.muted });'
            ' if(window.__rec.length>6000) window.__rec.shift(); }, 25); return true; })()' % el_id)

def samples(js, since):
    v = js('JSON.stringify((window.__rec||[]).filter(function(r){ return r.ms>=%f; }))' % since)
    try: return json.loads(v) if isinstance(v, str) else []
    except Exception: return []

def eff(r, boost=1.0):
    g = r.get('g')
    return (r.get('v') or 0) * ((g / boost) if g is not None else 1.0)

def at_ct(rs, song, lo, hi):
    return [r for r in rs if which(r.get('d')) == song and lo <= (r.get('ct') or 0) <= hi and not r.get('p')]

def shape_checks(tag, rs, song, boost=1.0):
    """A clip rises over 1.5 s, holds, and falls over its last 2.5 s."""
    d = LEN[song]
    first = at_ct(rs, song, 0.0, 0.12)
    ok(tag + ': at the start the room gets next to nothing (under 10%)', bool(first) and max(eff(r, boost) for r in first) < 0.10, [round(eff(r, boost), 3) for r in first][:6])
    mid_in = at_ct(rs, song, 0.65, 0.85)
    ok(tag + ': 0.75 s in, on the way up (between 10% and 50%)', bool(mid_in) and all(0.10 < eff(r, boost) < 0.50 for r in mid_in), [(round(r['ct'], 2), round(eff(r, boost), 3)) for r in mid_in][:6])
    up = at_ct(rs, song, 0.0, 1.45)
    rises = [eff(r, boost) for r in up]
    ok(tag + ': it rises all the way through the first 1.5 s (never drops back by more than a sample)', len(rises) > 10 and all(rises[i + 1] >= rises[i] - 0.02 for i in range(len(rises) - 1)), [round(x, 2) for x in rises][::4])
    hold = at_ct(rs, song, 1.6, d - 2.6)
    ok(tag + ': full in the middle (1.6 s to end minus 2.6 s)', len(hold) > 10 and all(eff(r, boost) > 0.97 for r in hold), min([round(eff(r, boost), 3) for r in hold] or [None]))
    down = at_ct(rs, song, d - 1.35, d - 1.15)
    ok(tag + ': 1.25 s from the end, half way down (between 10% and 50%)', bool(down) and all(0.10 < eff(r, boost) < 0.50 for r in down), [(round(r['ct'], 2), round(eff(r, boost), 3)) for r in down][:6])
    tail = at_ct(rs, song, d - 2.45, d - 0.05)
    falls = [eff(r, boost) for r in tail]
    ok(tag + ': it falls all the way through the last 2.5 s', len(falls) > 10 and all(falls[i + 1] <= falls[i] + 0.02 for i in range(len(falls) - 1)) and falls[-1] < 0.05, [round(x, 2) for x in falls][::6])


def tv_page(args, path_extra='', pre_extra=''):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), NL.Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    NL.W['logo'] = '/logos/venue-tugun-bowls.png'; NL.W['name'] = 'The Mini Bar'
    slug = 'the-mini-bar'
    chan = 'vp-' + NL.venue_code('musical-' + slug)
    B = NL.VL.Browser(extra_args=args)
    P = NL.Page(B, base, '/app/musical/screen.html?sting=0&venue=' + slug + path_extra, 1920, 1080, False,
                'try{ sessionStorage.setItem("vpTvHop","1"); }catch(e){}' + CATCH + pre_extra)
    P.until('document.getElementById("tvLobby") && window.VPTvGame', 20); time.sleep(1.2)
    P.js(recorder('clipAudio'))
    P.js(NL.say(chan, [{'t': 'host_here'}, {'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': [], 'playerCount': 3}]))
    time.sleep(0.8)
    P.js(NL.say(chan, [{'t': 'volume', 'level': 1.0}, {'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'played': []}]))
    time.sleep(0.6)
    return B, srv, P, chan

def played(chan, song, n):
    return NL.say(chan, [{'t': 'played', 'title': 'Song ' + song, 'artist': 'Artist', 'artworkUrl': '/__fixture/art-a03030.svg', 'previewUrl': CLIPS[song], 'played': ['Song %d' % i for i in range(n)], 'reveal': 'end'}])

def now(P): return P.js('performance.now()') or 0
def state(P): return P.obj('JSON.stringify({ p:document.getElementById("clipAudio").paused, ct:document.getElementById("clipAudio").currentTime, d:document.getElementById("clipAudio").duration })') or {}


def tv_scene():
    print('\nTHE WALL, a TV that allows sound, 1920x1080')
    B, srv, P, chan = tv_page(ALLOW)
    try:
        ok('CONTROL: the TV loads /app/vp-fade.js', P.js('!!window.VPFade') is True)
        t0 = now(P)
        P.js(played(chan, 'A', 1))
        time.sleep(LEN['A'] + 0.8)
        rs = samples(P.js, t0)
        ok('CONTROL: song A really played here (samples with A on and moving)', len(at_ct(rs, 'A', 0, LEN['A'])) > 100, len(rs))
        ok('CONTROL: the Room volume gain node was built and sampled (the boost path)', any(r.get('g') is not None for r in rs), rs[-1:] if rs else None)
        shape_checks('TV song A', rs, 'A')
        ok('the TV never sets the element and the gain both below full at once (the fade is on one or the other)',
           all(not (r['v'] < 0.99 and r.get('g') is not None and r['g'] < 0.99) for r in rs if not r.get('p')), [r for r in rs if r['v'] < 0.99 and r.get('g') is not None and r['g'] < 0.99][:2])

        # Room volume 200% mid-clip: the gain is 200% in the middle, the fade does not hold it down
        P.js(played(chan, 'B', 2)); time.sleep(3.0)
        P.js(NL.say(chan, [{'t': 'volume', 'level': 2.0}])); time.sleep(0.4)
        g = P.js('window.__gains[0].gain.value')
        ok('Room volume to 200%% mid-clip: the gain is 200%% in the middle (scaled, never overridden)', g is not None and abs(g - 2.0) < 0.02, g)
        P.js(NL.say(chan, [{'t': 'volume', 'level': 1.0}])); time.sleep(0.6)

        # Next mid-clip: B is at about 4 s
        tn = now(P)
        P.js(played(chan, 'C', 3))
        time.sleep(0.25)
        s1 = state(P)
        ok('Next mid-clip: a quarter second later the old song is still on (fading, not cut)', which(s1.get('d')) == 'B' and s1.get('p') is False, s1)
        time.sleep(2.6)
        rs = samples(P.js, tn)
        bs = [r for r in rs if which(r.get('d')) == 'B' and not r.get('p')]
        ok('Next mid-clip: the old song fell from full to under 15% before it went', len(bs) >= 5 and eff(bs[0]) > 0.95 and eff(bs[-1]) < 0.15, [round(eff(r), 2) for r in bs])
        span = (bs[-1]['ms'] - bs[0]['ms']) / 1000.0 if bs else -1
        ok('Next mid-clip: the quick fade took about half a second (0.35 to 0.75 s)', 0.35 <= span <= 0.75, span)
        cs = [r for r in rs if which(r.get('d')) == 'C']
        ok('Next mid-clip: the next song starts from 0 (its first sample under 10%)', bool(cs) and eff(cs[0]) < 0.10, [round(eff(r), 2) for r in cs[:4]])
        ok('Next mid-clip: and fades in to full by 1.5 s', bool(cs) and all(eff(r) > 0.97 for r in cs if r['ct'] >= 1.55) and any(r['ct'] >= 1.55 for r in cs), [(round(r['ct'], 2), round(eff(r), 2)) for r in cs][-4:])

        # Pause, then Play (C at about 2.9 s)
        tp = now(P)
        P.js(NL.say(chan, [{'t': 'clipctl', 'action': 'pause'}]))
        time.sleep(0.25)
        ok('Pause: a quarter second later the song is still playing (fading, not cut)', state(P).get('p') is False, state(P))
        time.sleep(0.7)
        s2 = state(P)
        ok('Pause: paused within the second', s2.get('p') is True, s2)
        rs = samples(P.js, tp)
        live = [r for r in rs if not r['p']]
        ok('Pause: the level fell from full to under 15% first', len(live) >= 5 and eff(live[0]) > 0.95 and eff(live[-1]) < 0.15, [round(eff(r), 2) for r in live])
        ct_paused = s2.get('ct')
        time.sleep(1.0)
        tq = now(P)
        P.js(NL.say(chan, [{'t': 'clipctl', 'action': 'play'}]))
        time.sleep(0.25)
        s3 = state(P)
        ok('Play: the song carries on from where it paused', s3.get('p') is False and abs((s3.get('ct') or 0) - ct_paused) < 0.6, [ct_paused, s3])
        time.sleep(0.7)
        rs = [r for r in samples(P.js, tq) if not r['p']]
        ok('Play: back up from low to full inside about half a second', len(rs) >= 5 and eff(rs[0]) < 0.6 and eff(rs[-1]) > 0.97, [round(eff(r), 2) for r in rs])
        ok('Play: and it came up gradually (some sample between 20% and 90%)', any(0.2 < eff(r) < 0.9 for r in rs), [round(eff(r), 2) for r in rs])

        # Next during the fade-in
        P.js(played(chan, 'D', 4)); time.sleep(0.5)
        td = now(P)
        before = eff((samples(P.js, td - 60) or [{}])[-1]) if samples(P.js, td - 60) else 0
        P.js(played(chan, 'E', 5)); time.sleep(1.0)
        rs = samples(P.js, td)
        ds = [r for r in rs if which(r.get('d')) == 'D' and not r['p']]
        ok('Next during the fade-in: the first song never got louder than it was (%.2f)' % before, all(eff(r) <= before + 0.08 for r in ds), [round(eff(r), 2) for r in ds])
        es = [r for r in rs if which(r.get('d')) == 'E']
        ok('Next during the fade-in: the next song lands and starts from 0', bool(es) and eff(es[0]) < 0.10 and not es[-1]['p'], [round(eff(r), 2) for r in es[:4]])
        time.sleep(1.0)

        # Pause inside Next's half second: the next song lands, waiting; Play starts it from 0
        P.js(played(chan, 'F', 6)); time.sleep(0.15)
        P.js(NL.say(chan, [{'t': 'clipctl', 'action': 'pause'}])); time.sleep(1.0)
        s4 = state(P)
        ok('Pause inside Next\'s half second: the next song is loaded and waiting, paused at the start', which(s4.get('d')) == 'F' and s4.get('p') is True and (s4.get('ct') or 0) < 0.2, s4)
        tf = now(P)
        P.js(NL.say(chan, [{'t': 'clipctl', 'action': 'play'}])); time.sleep(2.0)
        fs = [r for r in samples(P.js, tf) if which(r.get('d')) == 'F' and not r['p']]
        ok('then Play: it plays from 0 with its fade-in, up to full', bool(fs) and eff(fs[0]) < 0.15 and eff(fs[-1]) > 0.97, [(round(r['ct'], 2), round(eff(r), 2)) for r in fs][::8])

        # End of the game mid-fade: nothing left waiting, the next game's first clip fades in from 0
        P.js(played(chan, 'G', 7)); time.sleep(3.0)
        P.js(NL.say(chan, [{'t': 'clipctl', 'action': 'pause'}])); time.sleep(0.1)
        P.js(NL.say(chan, [{'t': 'idle'}])); time.sleep(1.0)
        ok('the game ends inside a Pause\'s fade: the clip is gone and nothing is waiting', P.js('!document.getElementById("clipAudio").getAttribute("src")') is True)
        ok('no script errors on the wall', not (P.js('JSON.stringify(window.__errs||[])') or '[]').strip('[]'), P.js('JSON.stringify(window.__errs||[])'))
    finally:
        B.close(); srv.shutdown()


def blocked_scene():
    print('\nTHE WALL, a TV that BLOCKS sound until clicked (the click bar), 1920x1080')
    B, srv, P, chan = tv_page(BLOCKED)
    try:
        P.js(played(chan, 'C', 1))
        ok('CONTROL: song 1 is refused and the click bar is up', P.until('!!document.getElementById("audioWarn")', 6), P.js('!!document.getElementById("audioWarn")'))
        time.sleep(2.0)
        tc = now(P)
        for t in ('mousePressed', 'mouseReleased'):
            B.call('Input.dispatchMouseEvent', {'type': t, 'x': 960, 'y': 500, 'button': 'left', 'clickCount': 1}, session=P.sid)
        P.until('!document.getElementById("audioWarn")', 5)
        time.sleep(2.2)
        rs = [r for r in samples(P.js, tc) if which(r.get('d')) == 'C' and not r['p']]
        ok('one click plays the song, and the bar goes', bool(rs) and P.js('!document.getElementById("audioWarn")') is True, len(rs))
        ok('it fades in from 0 (first sample under 15%), never stuck at 0: full by 2 s', bool(rs) and eff(rs[0]) < 0.15 and eff(rs[-1]) > 0.97, [(round(r['ct'], 2), round(eff(r), 2)) for r in rs][::8])
        tn = now(P)
        P.js(played(chan, 'D', 2)); time.sleep(2.4)
        ds = [r for r in samples(P.js, tn) if which(r.get('d')) == 'D' and not r['p']]
        ok('the next song needs no click: a quick fade, then it plays and fades in to full', bool(ds) and eff(ds[0]) < 0.15 and eff(ds[-1]) > 0.97 and P.js('!document.getElementById("audioWarn")') is True, [(round(r['ct'], 2), round(eff(r), 2)) for r in ds][::8])
        ok('no script errors on the blocked wall', not (P.js('JSON.stringify(window.__errs||[])') or '[]').strip('[]'), P.js('JSON.stringify(window.__errs||[])'))
    finally:
        B.close(); srv.shutdown()


def tvapp_scene():
    print("\nTHE TV APP'S ADDRESS (&app=tizen), on a TV with NO Web Audio (the element's own volume), 1920x1080")
    B, srv, P, chan = tv_page(ALLOW, '&app=tizen', NO_WEBAUDIO)
    try:
        ok('CONTROL: this page has no Web Audio at all', P.js('typeof window.AudioContext==="undefined" && typeof window.webkitAudioContext==="undefined"') is True)
        t0 = now(P)
        P.js(played(chan, 'A', 1))
        time.sleep(LEN['A'] + 0.8)
        rs = samples(P.js, t0)
        ok('CONTROL: song A played, with no gain node anywhere', len(at_ct(rs, 'A', 0, LEN['A'])) > 100 and all(r.get('g') is None for r in rs), len(rs))
        shape_checks('TV app, element volume', rs, 'A')
        P.js(played(chan, 'B', 2)); time.sleep(4.0)
        P.js(NL.say(chan, [{'t': 'volume', 'level': 2.0}])); time.sleep(0.3)
        ok('Room volume moved with no Web Audio: the element stays at full in the middle (no boost to give, nothing pulled down)', abs((P.js('document.getElementById("clipAudio").volume') or 0) - 1.0) < 0.01, P.js('document.getElementById("clipAudio").volume'))
        ok('no script errors in the TV app address', not (P.js('JSON.stringify(window.__errs||[])') or '[]').strip('[]'), P.js('JSON.stringify(window.__errs||[])'))
    finally:
        B.close(); srv.shutdown()


LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
# The console's songs are the library's real preview addresses; on the test machine they become tones, one a song.
SWAP = ('(function(){ var D=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,"src"); var T=%s, n=0, seen={};'
        ' Object.defineProperty(HTMLMediaElement.prototype,"src",{ configurable:true, get:function(){ return D.get.call(this); },'
        '  set:function(v){ v=String(v||""); if(/^https?:/.test(v) && this.id==="clip"){ if(!seen[v]) seen[v]=T[(n++)%%T.length]; v=seen[v]; } D.set.call(this,v); } }); })();')


def console_scene():
    print('\nTHE CONSOLE, 1024x768, signed in, on the real game Worker, no TV: the clip plays here')
    long_a, long_b = tone_uri(30.0, hz=440), tone_uri(29.0, hz=523)
    LEN['H'], LEN['I'] = 30.0, 29.0
    r = RIG.Rig(host_pages=('/app/musical/host.html',), chrome_args=ALLOW)
    try:
        tid, h = r.open('/app/musical/host.html', before=CATCH + (SWAP % json.dumps([long_a, long_b])), width=1024, height=768)
        js = lambda e: r.ask(h, e, 10)
        ok('CONTROL: the console loads, signed in, with /app/vp-fade.js', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!window.VPFade', 40) is True)
        time.sleep(2)
        js('try{ VPPrint.open=function(){return null;}; VPPrint.musical=function(){return true;}; }catch(e){} true')
        js('document.getElementById("prizeInput").value="Bar tab"; true')
        js('document.getElementById("startBtn").click(); true')
        ok('CONTROL: the lobby is open', r.until(h, LOBBY, 20) is True)
        js('document.getElementById("startBtn").click(); true')
        ok('CONTROL: the game is running', r.until(h, RUNNING, 25) is True, js('(document.getElementById("hostErrText")||{}).textContent'))
        js('localStorage.setItem("vpMusicVolume","100"); var vr=document.getElementById("volRange"); vr.value="100"; vr.dispatchEvent(new Event("input")); true')
        js(recorder('clip'))
        t0 = js('performance.now()')
        js('document.getElementById("playNextBtn").click(); true')
        time.sleep(4.0)
        rs = samples(js, t0)
        hs = [x for x in rs if which(x.get('d')) == 'H' and not x['p']]
        ok('CONTROL: song 1 plays here, out loud (not muted: no TV)', len(hs) > 50 and not hs[-1].get('m'), [len(hs), hs[-1] if hs else None])
        first = [x for x in hs if x['ct'] < 0.12]
        ok('console: at the start next to nothing (under 10%)', bool(first) and max(eff(x) for x in first) < 0.10, [round(eff(x), 3) for x in first])
        mid_in = [x for x in hs if 0.65 <= x['ct'] <= 0.85]
        ok('console: 0.75 s in, on the way up (10% to 50%)', bool(mid_in) and all(0.10 < eff(x) < 0.50 for x in mid_in), [round(eff(x), 3) for x in mid_in])
        hold = [x for x in hs if 1.6 <= x['ct']]
        ok('console: full after 1.5 s', len(hold) > 10 and all(eff(x) > 0.97 for x in hold), min([round(eff(x), 3) for x in hold] or [None]))
        tp = js('performance.now()')
        js('document.getElementById("playPauseBtn").click(); true')
        ok('console Pause: the button says Play at once', js('document.getElementById("playPauseBtn").textContent') == 'Play')
        time.sleep(0.25)
        ok('console Pause: a quarter second later still playing (fading, not cut)', js('document.getElementById("clip").paused') is False)
        time.sleep(0.7)
        ok('console Pause: paused within the second', js('document.getElementById("clip").paused') is True)
        live = [x for x in samples(js, tp) if not x['p']]
        ok('console Pause: fell from full to under 15% first', len(live) >= 5 and eff(live[0]) > 0.95 and eff(live[-1]) < 0.15, [round(eff(x), 2) for x in live])
        tq = js('performance.now()')
        js('document.getElementById("playPauseBtn").click(); true')
        time.sleep(1.0)
        live = [x for x in samples(js, tq) if not x['p']]
        ok('console Play: back up from low to full in about half a second', len(live) >= 5 and eff(live[0]) < 0.6 and eff(live[-1]) > 0.97 and any(0.2 < eff(x) < 0.9 for x in live), [round(eff(x), 2) for x in live])
        # Next mid-clip: the 20 second hold first (nobody skips inside 20 s)
        time.sleep(max(0.0, 21.0 - (js('document.getElementById("clip").currentTime') or 0)))
        ok('CONTROL: Next is open again after the 20 s hold', r.until(h, '!document.getElementById("playNextBtn").disabled && /Play next song/.test(document.getElementById("playNextBtn").textContent)', 6) is True, js('document.getElementById("playNextBtn").textContent'))
        tn = js('performance.now()')
        js('document.getElementById("playNextBtn").click(); true')
        time.sleep(0.25)
        ok('console Next mid-clip: a quarter second later the old song is still on (fading, not cut)', which(js('document.getElementById("clip").duration')) == 'H' and js('document.getElementById("clip").paused') is False, js('document.getElementById("clip").duration'))
        time.sleep(2.8)
        rs = samples(js, tn)
        old = [x for x in rs if which(x.get('d')) == 'H' and not x['p']]
        ok('console Next mid-clip: the old song fell from full to under 15% in about half a second', len(old) >= 5 and eff(old[0]) > 0.85 and eff(old[-1]) < 0.15 and 0.35 <= (old[-1]['ms'] - old[0]['ms']) / 1000.0 <= 0.75, [round(eff(x), 2) for x in old])
        new = [x for x in rs if which(x.get('d')) == 'I' and not x['p']]
        ok('console Next mid-clip: the next song starts from 0 and fades in to full', bool(new) and eff(new[0]) < 0.10 and eff(new[-1]) > 0.97, [(round(x['ct'], 2), round(eff(x), 2)) for x in new][::6])
        ok('no script errors on the console', js('window.__errs.length') == 0, js('JSON.stringify(window.__errs)'))
    finally:
        try: r.close()
        except Exception: pass


if __name__ == '__main__':
    tv_scene()
    blocked_scene()
    tvapp_scene()
    console_scene()
    print('\n%d of %d checks passed' % (ran - bad, ran))
    sys.exit(1 if bad else 0)
