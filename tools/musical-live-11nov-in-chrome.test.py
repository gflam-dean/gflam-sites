#!/usr/bin/env python3
"""MUSICAL BINGO, DEAN'S LIVE PLAY ON THE MINI BAR, 11 NOV 2026 (INBOX 252), AS CHROME PAINTS IT.

  THE TV (the REAL app/musical/screen.html, served with the stand-in Worker and fake Realtime of
  tools/musical-newlook-in-chrome.test.py), in a Chrome that BLOCKS SOUND until the page is clicked
  (--autoplay-policy=document-user-activation-required, a laptop or a Chrome tab on a pub TV):
    8  song 1 is refused: the TV says "Click anywhere on this screen to turn the sound on" along the bottom
       edge, big enough to read, and keeps saying it; one real click plays the song and the bar goes
    4  on LISTEN the song is said once: no dashed slot on the strip, no count before a song has played
    5  NOW PLAYING is a plain label: the body font, sentence case, no letter-spacing, no mono
    3  CONTROL: the same wall in a Chrome that allows sound never shows the bar
  THE CONSOLE (the REAL app/musical/host.html on tools/browser-rig/rig.py: the real game Worker in jsc, signed in):
    1  paper cards: print 4, Change to 3, Start game: no "Paper cards" pop-up, the game starts with 3
    2  Start game tapped from the bottom of the page: the console lands at the top, Now playing in view
    8  the TV says it is blocked: the banner and the note say "Click once on the TV screen to turn its sound on",
       never "autoplay"

VP_SHOTS=<dir> writes the frames. Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait).

    python3 tools/musical-live-11nov-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, math, os, struct, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
_spec = importlib.util.spec_from_file_location('musical_newlook', os.path.join(HERE, 'musical-newlook-in-chrome.test.py'))
NL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(NL)
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
BLOCKED = ['--autoplay-policy=document-user-activation-required']
BAR_TEXT = 'Click anywhere on this screen to turn the sound on'

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


def tone_uri(secs=6, rate=8000):
    """A plain 440 Hz clip as a data: address, so the TV has a real clip to play with no network."""
    n = secs * rate
    pcm = b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(n))
    hdr = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm))
    return 'data:audio/wav;base64,' + base64.b64encode(hdr + pcm).decode('ascii')
CLIP = tone_uri()

BAR = r'''(function(){ var w=document.getElementById("audioWarn"); if(!w) return null; var b=w.getBoundingClientRect(), s=getComputedStyle(w);
  return JSON.stringify({ text:w.textContent, top:b.top, bottom:b.bottom, h:b.height, left:b.left, right:b.right, fs:parseFloat(s.fontSize), ff:s.fontFamily }); })()'''
CLIPSTATE = '(function(){ var a=document.getElementById("clipAudio"); return JSON.stringify({ paused:a.paused, t:a.currentTime, src:!!a.getAttribute("src") }); })()'
EYE = r'''(function(){ var e=document.getElementById("tvNowEye"); if(!e) return null; var s=getComputedStyle(e), b=e.getBoundingClientRect();
  return JSON.stringify({ text:e.textContent, shown:s.display!=="none" && b.height>0, ff:s.fontFamily, ls:s.letterSpacing, tt:s.textTransform, fs:parseFloat(s.fontSize), col:s.color }); })()'''


def click(B, sid, x, y):
    for t in ('mousePressed', 'mouseReleased'):
        B.call('Input.dispatchMouseEvent', {'type': t, 'x': x, 'y': y, 'button': 'left', 'clickCount': 1}, session=sid)


def tv_scene(blocked):
    tag = 'blocked TV' if blocked else 'CONTROL, a TV that allows sound'
    print('\nTHE WALL, %s, 1920x1080' % tag)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), NL.Site)
    srv.socket.listen(128)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    NL.W['logo'] = '/logos/venue-tugun-bowls.png'; NL.W['name'] = 'The Mini Bar'
    slug = 'the-mini-bar'
    chan = 'vp-' + NL.venue_code('musical-' + slug)
    B = NL.VL.Browser(extra_args=BLOCKED if blocked else ['--autoplay-policy=no-user-gesture-required'])   # headless Chrome blocks by default
    try:
        P = NL.Page(B, base, '/app/musical/screen.html?sting=0&venue=' + slug, 1920, 1080, False, 'try{ sessionStorage.setItem("vpTvHop","1"); }catch(e){}')
        P.until('document.getElementById("tvLobby") && window.VPTvGame', 20); time.sleep(1.5)
        pol = P.js('(navigator.getAutoplayPolicy ? navigator.getAutoplayPolicy("mediaelement") : "no getAutoplayPolicy")')
        print('  (this Chrome says autoplay is: %s)' % pol)
        P.js(NL.say(chan, [{'t': 'host_here'}, {'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': [], 'playerCount': 3}]))
        time.sleep(1.2)
        if pol == 'disallowed':
            ok(tag + ' lobby: the browser says before song 1 it will refuse sound, so the click line is up already', (json.loads(P.js(BAR) or 'null') or {}).get('text') == BAR_TEXT, P.js(BAR))
        P.js(NL.say(chan, [{'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'played': []}]))
        time.sleep(0.6)
        P.js(NL.say(chan, [{'t': 'played', 'title': 'Uptown Funk', 'artist': 'Mark Ronson', 'artworkUrl': '/__fixture/art-a03030.svg', 'previewUrl': CLIP, 'played': ['Uptown Funk'], 'reveal': 'never'}]))
        if not blocked:
            time.sleep(4.0)
            c = json.loads(P.js(CLIPSTATE) or '{}')
            ok(tag + ': song 1 plays on its own', c.get('paused') is False and c.get('t', 0) > 0.5, c)
            ok(tag + ': and the click line never shows (it is only for a TV that really is blocked)', P.js(BAR) is None, P.js(BAR))
            return
        got = P.until('!!document.getElementById("audioWarn")', 6)
        ok(tag + ': song 1 refused: the TV shows the click line', got)
        b = json.loads(P.js(BAR) or 'null') or {}
        ok(tag + ': it says "%s"' % BAR_TEXT, b.get('text') == BAR_TEXT, b)
        ok(tag + ': along the bottom edge, full width, no taller than the 4.95% gap under the played strip', abs(b.get('bottom', 0) - 1080) < 1 and b.get('left', 1) <= 0.5 and b.get('right', 0) >= 1919.5 and b.get('h', 999) <= 0.0495 * 1920, b)
        ok(tag + ': big enough to read across a bar: 38px text at 1920, the body font', abs(b.get('fs', 0) - 38.4) < 1 and 'Hanken' in b.get('ff', ''), b)
        L = json.loads(P.js(NL.TV_PROBE) or '{}')
        if SHOTS: P.shot('item8-tv-click-to-turn-sound-on-1920')
        ok('item 4, LISTEN on song 1: no dashed slot on the strip', L.get('next') is None, L.get('next'))
        ok('item 4, LISTEN on song 1: no song count either, so nothing says the song twice', L.get('songno') is None, L.get('songno'))
        ok('item 4, LISTEN on song 1: LISTEN is up and the song is not named', (L.get('listen') or {}).get('text', '').lower().startswith('listen') and 'uptown funk' not in L.get('wallText', '').lower(), [L.get('listen'), L.get('wallText', '')[-120:]])
        time.sleep(9.0)
        ok(tag + ': still up nine seconds later (it stays until the sound is on)', P.js(BAR) is not None)
        ok(tag + ': CONTROL: the clip is not playing yet', (json.loads(P.js(CLIPSTATE) or '{}') or {}).get('paused') is True, P.js(CLIPSTATE))
        click(B, P.sid, 960, 500)
        P.until('!document.getElementById("audioWarn")', 5)
        time.sleep(1.5)
        c = json.loads(P.js(CLIPSTATE) or '{}')
        ok(tag + ': ONE real click anywhere: the song plays', c.get('paused') is False and c.get('t', 0) > 0.3, c)
        ok(tag + ': and the line goes', P.js(BAR) is None, P.js(BAR))
        # the next songs need no click
        P.js(NL.say(chan, [{'t': 'played', 'title': 'Sweet Caroline', 'artist': 'Neil Diamond', 'artworkUrl': '/__fixture/art-3060a0.svg', 'previewUrl': CLIP, 'played': ['Uptown Funk', 'Sweet Caroline'], 'reveal': 'never'}]))
        time.sleep(4.0)
        c = json.loads(P.js(CLIPSTATE) or '{}')
        ok(tag + ': song 2 plays with no click and no line', c.get('paused') is False and c.get('t', 0) > 0.3 and P.js(BAR) is None, [c, P.js(BAR)])
        L2 = json.loads(P.js(NL.TV_PROBE) or '{}')
        if SHOTS: P.shot('item4-tv-listen-song-2-1920')
        ok('item 4, LISTEN on song 2: "1 song played" bottom left, the one played song on the strip, no dashed slot',
           (L2.get('songno') or {}).get('text') == '1 song played' and len(L2.get('tiles') or []) == 1 and L2.get('next') is None, [L2.get('songno'), len(L2.get('tiles') or []), L2.get('next')])
        P.js(NL.say(chan, [{'t': 'reveal', 'title': 'Sweet Caroline', 'artist': 'Neil Diamond', 'artworkUrl': '/__fixture/art-3060a0.svg'}]))
        P.until('document.getElementById("tvNowTitle").textContent==="Sweet Caroline"', 5); time.sleep(1.0)
        e = json.loads(P.js(EYE) or 'null') or {}
        if SHOTS: P.shot('item5-tv-now-playing-1920')
        ok('item 5, NOW PLAYING: shown, sentence case "Now playing", no capitals by CSS', e.get('shown') and e.get('text') == 'Now playing' and e.get('tt') == 'none', e)
        ok('item 5, NOW PLAYING: the body font (Hanken Grotesk), no mono, no letter-spacing', 'Hanken' in e.get('ff', '') and 'Mono' not in e.get('ff', '') and e.get('ls') in ('normal', '0px'), e)
        ok('no script errors on the wall', not (P.js('JSON.stringify(window.__errs||[])') or '[]').strip('[]'), P.js('JSON.stringify(window.__errs||[])'))
    finally:
        B.close(); srv.shutdown()


LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
MODAL_UP = '!document.getElementById("paperModal").classList.contains("hidden")'
BEFORE = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
          'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();'
          '(function(){window.__games=[];var f=window.fetch;window.fetch=function(u,o){try{if(/\\/host\\/game$/.test(String(u)))window.__games.push(JSON.parse(o&&o.body||"{}"));}catch(e){}return f.apply(this,arguments);};})();')
TELL = r'''(function(payload){
  var names=(window.__bcNames||[]).filter(function(n){return /^fake-rt:vp-/.test(n);}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    b.postMessage({event:"msg", payload:payload}); setTimeout(function(){ try{ b.close(); }catch(e){} }, 400); });
  return Object.keys(seen).length;
})'''


def console_scene():
    print('\nTHE CONSOLE, 1024x768 (a tablet), signed in, on the real game Worker')
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        tid, h = r.open('/app/musical/host.html', before=BEFORE, width=1024, height=768)
        ok('CONTROL: the console loads, signed in', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!window.VPPrint', 40) is True)
        time.sleep(2)
        r.ask(h, 'VPPrint.open=function(){return null;}; VPPrint.musical=function(){return true;}; true')   # no print window in a test
        r.ask(h, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        ok('CONTROL: the lobby is open', r.until(h, LOBBY, 20) is True)
        r.ask(h, 'document.getElementById("paperPrintBtn").click(); true')
        ok('CONTROL: Print paper cards asks how many to print', r.until(h, MODAL_UP, 8) is True)
        r.ask(h, 'document.getElementById("paperCount").value="4"; document.getElementById("paperGo").click(); true')
        got = r.until(h, '!document.getElementById("paperPlayRow").classList.contains("hidden")', 15)
        ok('item 1: printed 4: "Playing this game: 4 paper cards" with Change, under Print paper cards', got is True and r.ask(h, 'document.getElementById("paperPlayN").textContent') == '4 paper cards',
           [r.ask(h, 'document.getElementById("paperPlayN").textContent'), r.ask(h, '(document.getElementById("hostErrText")||{}).textContent')])
        r.ask(h, 'document.getElementById("paperPlayChange").click(); true')
        ok('item 1: Change asks again only because the host asked to', r.until(h, MODAL_UP, 5) is True and r.ask(h, 'document.getElementById("paperTitle").textContent') == 'Paper cards this game', r.ask(h, 'document.getElementById("paperTitle").textContent'))
        r.ask(h, 'document.getElementById("paperCount").value="3"; document.getElementById("paperGo").click(); true')
        r.until(h, '!(' + MODAL_UP + ')', 5)
        ok('item 1: changed to 3: the line says 3', r.ask(h, 'document.getElementById("paperPlayN").textContent') == '3 paper cards', r.ask(h, 'document.getElementById("paperPlayN").textContent'))
        if SHOTS: r.shot(h, os.path.join(SHOTS, 'item1-console-paper-playing-1024.jpg'))
        # tapped from the bottom of the page, as on the night
        r.ask(h, 'window.__asked=0; new MutationObserver(function(){ if(!document.getElementById("paperModal").classList.contains("hidden")) window.__asked++; }).observe(document.getElementById("paperModal"),{attributes:true}); true')
        r.ask(h, 'document.getElementById("startBtn").scrollIntoView({block:"end"}); true'); time.sleep(0.4)
        ok('CONTROL: Start game is tapped from well down the page', (r.ask(h, 'window.scrollY') or 0) > 200, r.ask(h, 'window.scrollY'))
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        ok('CONTROL: the game is running', r.until(h, RUNNING, 25) is True, r.ask(h, '(document.getElementById("hostErrText")||{}).textContent'))
        time.sleep(0.8)
        ok('item 1: Start game did NOT ask about paper cards again', r.ask(h, 'window.__asked') == 0 and r.ask(h, MODAL_UP) is False, r.ask(h, 'window.__asked'))
        games = r.json(h, 'JSON.stringify(window.__games)', [])
        ok('item 1: the game started with the 3 paper cards the host set', bool(games) and games[-1].get('paper_count') == 3, games)
        top = r.json(h, 'JSON.stringify({ y: window.scrollY, now: document.querySelector("#liveBlock .nowbar").getBoundingClientRect().top, nb: document.querySelector("#liveBlock .nowbar").getBoundingClientRect().bottom, H: innerHeight })', {})
        ok('item 2: the console lands at the very top after Start', top.get('y') == 0, top)
        ok('item 2: with Now playing (what the TV is doing) on screen', 0 <= top.get('now', -1) < top.get('H', 0), top)
        if SHOTS: r.shot(h, os.path.join(SHOTS, 'item2-console-after-start-1024.jpg'))
        # the TV says its sound is blocked
        r.ask(h, TELL + '(%s)' % json.dumps({'t': 'tv_here', 'audio': 'blocked'}))
        r.ask(h, TELL + '(%s)' % json.dumps({'t': 'tv_audio_blocked'}))
        r.until(h, '(document.getElementById("hostErrText")||{}).textContent.indexOf("Click once")>=0', 8)
        said = r.ask(h, 'document.getElementById("hostErrText").textContent') or ''
        note = r.ask(h, 'document.getElementById("tvAudioNote").textContent') or ''
        mon = r.ask(h, 'document.getElementById("monitorBtn").textContent') or ''
        ok('item 8: the banner says "The TV has no sound yet. Click once on the TV screen to turn its sound on, or tap Yes under Now playing ..."',
           said == 'The TV has no sound yet. Click once on the TV screen to turn its sound on, or tap Yes under Now playing to play the songs from this device.', said)
        ok('item 8: under Now playing the same instruction, with the Yes it names, on screen', 'Click once on the TV screen to turn its sound on' in note and r.ask(h, '(function(){var y=document.getElementById("tvSoundYes"); if(!y) return false; var b=y.getBoundingClientRect(); return b.height>0 && y.textContent==="Yes";})()') is True, note)
        ok('item 8: no "autoplay" and no "monitor switch" anywhere the host reads', not any(w in (said + note + mon).lower() for w in ('autoplay', 'monitor switch')), [said, note, mon])
        ok('item 8: the sound button no longer says "Sound is on the TV"', 'Sound is on the TV' not in mon and 'no sound yet' in mon, mon)
        r.ask(h, 'document.getElementById("tvAudioNote").scrollIntoView({block:"center"}); true'); time.sleep(0.5)
        if SHOTS: r.shot(h, os.path.join(SHOTS, 'item8-console-tv-has-no-sound-1024.jpg'))
        r.ask(h, TELL + '(%s)' % json.dumps({'t': 'tv_here', 'audio': 'ok'}))
        ok('item 8: the TV is clicked and its sound comes on: the banner and the note go', r.until(h, '!document.getElementById("hostErrBar").classList.contains("show") && document.getElementById("tvAudioNote").classList.contains("hidden")', 8) is True,
           r.ask(h, 'document.getElementById("hostErrBar").className'))
        ok('no script errors on the console', r.ask(h, 'window.__errs.length') == 0, r.ask(h, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('musical-live-11nov-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    for scene in (lambda: tv_scene(True), lambda: tv_scene(False), console_scene):
        try:
            scene()
        except Exception as e:
            ok('the scene ran to the end', False, repr(e))
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
