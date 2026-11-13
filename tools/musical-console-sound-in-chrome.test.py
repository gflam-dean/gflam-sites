#!/usr/bin/env python3
"""THE HOST CONSOLE STOPS MAKING SOUND WHEN THE HOST SAYS "ON THE TV" (INBOX 366, Dean's live play on The Mini Bar,
13 Nov 2026, join code UZRHJU): "the sound keeps playing on the device too after you say stop". The console showed
"Sound is on the TV, tap to also hear it here" and the clip still came out of the phone.

WHY. The console runs its clip through a Web Audio graph for the Room volume (up to 240%). Once an <audio> element is
the source of a graph, some browsers (iPhone Safari) ignore the element's own .muted: the clip keeps coming out of the
graph's gain node. The console only ever set .muted, so a muted element still played. The fix keeps the gain at 0 too.

WHAT THIS DOES. The REAL console (app/musical/host.html on tools/browser-rig/rig.py, the real game Worker, signed in)
and the REAL TV (app/musical/screen.html) in a second window on the same fake Realtime. It watches EVERY output path
on the console page (every <audio>/<video>, every Audio() the page made, every AudioContext and gain node) and judges
"would a person standing at the phone hear it" the strict way: an element that feeds a graph is judged by its gain and
its context, never by .muted (the phone ignores .muted there); one that does not is judged by .muted and .volume.

  CONTROL: with "also hear it here" ON the console IS audible (so the check can see sound), and the TV plays
  ON THE TV ONLY: nothing on the console is audible, and the TV keeps playing, through
    the toggle itself, a slow Room volume change (240% down and up), Pause then Resume, Next song (a new clip,
    a new prefetch element), a refresh of the console mid-game, and the Room volume while quiet

    python3 tools/musical-console-sound-in-chrome.test.py
"""
import base64, importlib.util, json, math, os, struct, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
import rig as RIG

ALLOW = ['--autoplay-policy=no-user-gesture-required']
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600]))
    if not cond: bad += 1

def tone_uri(secs, rate=8000, hz=440):
    n = int(secs * rate)
    pcm = b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * hz * i / rate))) for i in range(n))
    hdr = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm))
    return 'data:audio/wav;base64,' + base64.b64encode(hdr + pcm).decode('ascii')

# Before any page script: record every media element that plays or is made, every AudioContext, every gain node,
# and which element feeds a graph. Real clip addresses become tones (no network on the test machine).
WATCH = r'''(function(){
  window.__media=[]; window.__ctx=[]; window.__gain=[]; window.__fed=[];
  var T=%s, n=0, seen={};
  var D=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,"src");
  Object.defineProperty(HTMLMediaElement.prototype,"src",{configurable:true,get:function(){return D.get.call(this);},
    set:function(v){ v=String(v||""); if(/^https?:/.test(v)){ if(!seen[v]) seen[v]=T[(n++)%%T.length]; v=seen[v]; } if(window.__media.indexOf(this)<0) window.__media.push(this); D.set.call(this,v); }});
  var P=(window.AudioContext||window.webkitAudioContext||function(){}).prototype;
  if(P && P.createGain){
    var cg=P.createGain, ms=P.createMediaElementSource;
    P.createGain=function(){ var g=cg.apply(this,arguments); window.__gain.push({g:g,c:this}); if(window.__ctx.indexOf(this)<0) window.__ctx.push(this); return g; };
    P.createMediaElementSource=function(el){ window.__fed.push(el); if(window.__ctx.indexOf(this)<0) window.__ctx.push(this); return ms.apply(this,arguments); };
  }
})();'''

# One answer: every output path on the page, and whether a listener at this device would hear any of it.
AUDIT = r'''(function(){
  var els=[].slice.call(document.querySelectorAll("audio,video")); (window.__media||[]).forEach(function(m){ if(els.indexOf(m)<0) els.push(m); });
  var out={ els:[], ctx:(window.__ctx||[]).map(function(c){ return c.state; }), gains:(window.__gain||[]).map(function(x){ return x.g.gain.value; }), audible:[] };
  els.forEach(function(e){
    var fed=(window.__fed||[]).indexOf(e)>=0, gs=(window.__gain||[]).filter(function(x){ return true; });
    var playing=!e.paused && !e.ended && !!e.src;
    var heard;
    if(fed){ var running=(window.__ctx||[]).some(function(c){ return c.state==="running"; });
             var loud=(window.__gain||[]).some(function(x){ return x.g.gain.value>0.001; });
             heard=playing && running && loud; }          // an element in a graph: .muted is not trusted
    else heard=playing && !e.muted && e.volume>0.001;
    out.els.push({ id:e.id||"(none)", paused:e.paused, muted:e.muted, vol:e.volume, fed:fed, playing:playing, heard:heard });
    if(heard) out.audible.push(e.id||"(none)");
  });
  return JSON.stringify(out);
})()'''

TELL = r'''(function(payload){
  var names=(window.__bcNames||[]).filter(function(n){return /^fake-rt:vp-/.test(n);}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    b.postMessage({event:"msg", payload:payload}); setTimeout(function(){ try{ b.close(); }catch(e){} }, 400); });
  return Object.keys(seen).length;
})'''
BCN = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
       'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();')
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
MON = 'document.getElementById("monitorBtn").textContent'


def main():
    long_a, long_b, long_c = tone_uri(30.0, hz=440), tone_uri(29.0, hz=523), tone_uri(28.0, hz=330)
    watch = BCN + (WATCH % json.dumps([long_a, long_b, long_c]))
    r = RIG.Rig(host_pages=('/app/musical/host.html',), chrome_args=ALLOW)
    try:
        tid, h = r.open('/app/musical/host.html', before=watch, width=390, height=844)
        js = lambda e: r.ask(h, e, 10)
        audit = lambda: json.loads(js(AUDIT))
        ok('CONTROL: the console loads, signed in', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!window.VPFade', 40) is True)
        time.sleep(2)
        js('try{ VPPrint.open=function(){return null;}; VPPrint.musical=function(){return true;}; }catch(e){} true')
        js('document.getElementById("prizeInput").value="Bar tab"; true')
        js('document.getElementById("startBtn").click(); true')
        ok('CONTROL: the lobby is open', r.until(h, LOBBY, 20) is True)
        slug = r.W.info['slug']
        # the venue screen, in its own window, on the same fake Realtime
        tvid, tv = r.open('/app/musical/screen.html?sting=0&venue=' + slug, before='try{ sessionStorage.setItem("vpTvHop","1"); }catch(e){}' + BCN + (WATCH % json.dumps([long_a, long_b, long_c])), width=1280, height=720)
        tvjs = lambda e: r.ask(tv, e, 10)
        ok('CONTROL: the TV page loads', r.until(tv, 'document.readyState==="complete" && !!document.getElementById("clipAudio") && !!window.VPTvGame', 40) is True,
           [slug, tvjs('document.readyState'), tvjs('(document.body||{}).innerText'), tvjs('JSON.stringify(window.__errs)')])
        time.sleep(2)
        js('document.getElementById("startBtn").click(); true')
        ok('CONTROL: the game is running', r.until(h, RUNNING, 25) is True, js('(document.getElementById("hostErrText")||{}).textContent'))
        r.ask(h, TELL + '(%s)' % json.dumps({'t': 'tv_here', 'audio': 'ok'}))
        time.sleep(1)
        ok('CONTROL: the console is on its default, sound on the TV', 'Sound is on the TV' in (js(MON) or ''), js(MON))
        js('localStorage.setItem("vpMusicVolume","240"); var vr=document.getElementById("volRange"); vr.value="240"; vr.dispatchEvent(new Event("input")); true')

        def silent(tag):
            a = audit()
            ok('%s: NOTHING on the console is audible (every element, graph and gain judged)' % tag, not a['audible'], a)
        def tv_playing(tag):
            time.sleep(0.6)
            s = json.loads(tvjs('JSON.stringify({p:document.getElementById("clipAudio").paused, ct:document.getElementById("clipAudio").currentTime, m:document.getElementById("clipAudio").muted})'))
            t0 = s['ct']; time.sleep(0.8)
            s2 = json.loads(tvjs('JSON.stringify({p:document.getElementById("clipAudio").paused, ct:document.getElementById("clipAudio").currentTime})'))
            ok('%s: the TV is still playing (its clock moves, not paused, not muted)' % tag, not s2['p'] and not s['m'] and s2['ct'] > t0, [s, s2])

        # song 1, console on TV-only (the default)
        js('document.getElementById("playNextBtn").click(); true')
        time.sleep(3.0)
        ok('CONTROL: song 1 is playing on the console element (the clip runs, only the output is held)', js('!document.getElementById("clip").paused') is True)
        ok('CONTROL: the Room volume graph was built (a gain node exists)', len(audit()['gains']) >= 1, audit())
        silent('song 1, default')
        tv_playing('song 1, default')

        # also hear it here ON: CONTROL that the audit can hear
        js('document.getElementById("monitorBtn").click(); true'); time.sleep(1.5)
        ok('CONTROL: the button now says also playing here', 'Also playing here' in (js(MON) or ''), js(MON))
        a = audit()
        ok('CONTROL: with "also hear it here" ON the console IS audible (the check can see sound)', 'clip' in a['audible'], a)
        # ... and OFF again: the fault
        js('document.getElementById("monitorBtn").click(); true'); time.sleep(0.15)
        silent('toggled to TV-only, 0.15 s after the tap')
        time.sleep(1.4)
        ok('the button says Sound is on the TV again', 'Sound is on the TV' in (js(MON) or ''), js(MON))
        silent('toggled ON then to TV-only')
        tv_playing('toggled to TV-only')

        # Room volume while quiet
        for pct in ('100', '400', '240'):
            js('var vr=document.getElementById("volRange"); vr.value="%s"; vr.dispatchEvent(new Event("input")); true' % pct); time.sleep(0.4)
            silent('Room volume %s%% while TV-only' % pct)

        # Pause / Resume
        js('document.getElementById("playPauseBtn").click(); true'); time.sleep(1.2)
        silent('Pause')
        js('document.getElementById("playPauseBtn").click(); true'); time.sleep(2.0)
        ok('CONTROL: Resume plays the clip on the console element', js('!document.getElementById("clip").paused') is True)
        silent('Resume')

        # Next song (after the 20 s hold): a new clip and a new prefetch element
        ok('CONTROL: Next is open again after the hold', r.until(h, '!document.getElementById("playNextBtn").disabled && /Play next song/.test(document.getElementById("playNextBtn").textContent)', 30) is True, js('document.getElementById("playNextBtn").textContent'))
        js('document.getElementById("playNextBtn").click(); true'); time.sleep(3.0)
        ok('CONTROL: song 2 is on the console element', js('!document.getElementById("clip").paused') is True)
        silent('Next song')
        tv_playing('Next song')

        # a refresh of the console mid-game with the TV window gone (a TV that has not spoken yet): the host said TV only
        # and that holds, though nothing has been heard from a screen
        r.close_tab(tvid)
        js('location.reload(); true')
        ok('CONTROL: the console comes back after a refresh', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!window.VPFade', 40) is True)
        time.sleep(3)
        js('try{ VPPrint.open=function(){return null;}; VPPrint.musical=function(){return true;}; }catch(e){} true')
        got = r.until(h, RUNNING, 25)
        if got is True:
            r.until(h, '!document.getElementById("playNextBtn").disabled', 25)
            js('document.getElementById("playNextBtn").click(); true'); time.sleep(3.0)
            ok('CONTROL: after the refresh a new song plays on the console element', js('!document.getElementById("clip").paused') is True)
            silent('after a refresh, a new song, no screen heard yet (the host had said TV only)')
            r.ask(h, TELL + '(%s)' % json.dumps({'t': 'tv_here', 'audio': 'ok'})); time.sleep(1)
            silent('and once a screen is heard again')
            ok('after the refresh the console says Sound is on the TV', 'Sound is on the TV' in (js(MON) or ''), js(MON))
        else:
            ok('CONTROL: the running game came back after the refresh', False, js('document.body.innerText.slice(0,200)'))
        ok('no script errors on the console', js('(window.__errs||[]).length') == 0, js('JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()


if __name__ == '__main__':
    import gatelib
    if not gatelib.hold_lock_or_refuse('musical-console-sound-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    try:
        main()
    except Exception as e:
        ok('the suite ran to the end', False, repr(e))
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)
