#!/usr/bin/env python3
"""THE "venueplay tv" SET-UP LOGO, IN A REAL BROWSER (Dean, 3 Nov 2026).

Dean chose a lockup for every TV set-up screen: the big neon play triangle on top, the solid wordmark and a
solid pink "tv" under it, one muted line under that. The old "Setting up" card (a glow round the whole word)
and the venue idle card (the name in Anton over a gold glow, "Ask at the bar what's on") both went. Rules:
the triangle BREATHES, glow only (2.6 s ease-in-out, never fading the shape; still for reduced motion); no
glow round the whole logo and no gold glow; the logo stays in EXACTLY the same place from one set-up state
to the next and only the line under it changes, cross-fading (about 300 ms); the /tv card shows the store
that fits this TV (Google Play, Samsung Apps or the LG Content Store, "coming soon" for the two not live);
live games keep the plain venueplay corner logo.

Opens the REAL tv.html in headless Chrome (tools/browser-rig/rig.py: the repo's pages, the real game Worker
in jsc, supabase-js stood in) at 1920 x 1080 and looks at what is painted:
  1. SETTING UP   an address nobody has confirmed: the logo, "Setting up this screen", the breath
  2. STILL        the same with prefers-reduced-motion: no animation, the kit's own glow
  3. HANDOVER     a real venue's first load: "Setting up this screen" cross-fades to the venue's name
                  while the logo stays put, to the pixel; the floor under the slides is the same logo
  4. STORES       bare /tv as a Samsung, an LG, a Google TV and a TV it cannot tell
  5. GAMES        the live game corner is still the plain venueplay wordmark

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/tv-logo-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
W, H = 1920, 1080
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

def take_lock(tool='tv-logo-in-chrome'):
    deadline = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    said = False
    while True:
        state, pid, text = gatelib.lock_state()
        if state == 'stale':
            print('  heavy lock is STALE (pid %s, "%s"). Not clearing somebody else\'s lock: refusing.' % (pid, text[:80]))
            return False
        if state in ('free', 'mine') and gatelib.hold_lock_or_refuse(tool, wait_s=0):
            return True
        if time.time() > deadline:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return False
        if not said:
            print('  heavy lock held by pid %s ("%s"), waiting' % (pid, text[:80])); said = True
        time.sleep(0.5)

# What is on the wall: the lit slide's logo, its line, the triangle's animation and glow, the background.
LOOK = r'''(function(sel){
  var root=document.querySelector(sel); if(!root) return {none:true};
  var lg=root.querySelector(".tvlogo"), tri=lg&&lg.querySelector("svg.tvl-tri"), wd=lg&&lg.querySelector("svg.tvl-word"), ln=root.querySelector(".tvline:not(.out)");
  function rect(e){ if(!e) return null; var b=e.getBoundingClientRect(); return [Math.round(b.left*10)/10,Math.round(b.top*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10]; }
  var tc=tri?getComputedStyle(tri):null, wc=wd?getComputedStyle(wd):null, lc=ln?getComputedStyle(ln):null, ad=root.closest?root.closest(".ad")||root:root, ac=getComputedStyle(ad);
  return {logo:rect(lg), tri:rect(tri), word:rect(wd), line:ln?ln.textContent:null, lineFont:lc?lc.fontFamily:"", lineColour:lc?lc.color:"", lineSize:lc?parseFloat(lc.fontSize):0,
    lineTop:ln?ln.getBoundingClientRect().top:0, logoBottom:lg?lg.getBoundingClientRect().bottom:0,
    anim:tc?tc.animationName:"", dur:tc?tc.animationDuration:"", ease:tc?tc.animationTimingFunction:"", triFilter:tc?tc.filter:"", triOpacity:tc?tc.opacity:"",
    wordAnim:wc?wc.animationName:"", wordFilter:wc?wc.filter:"", logoFilter:lg?getComputedStyle(lg).filter:"", logoAnim:lg?getComputedStyle(lg).animationName:"",
    tvMark:!!(wd&&wd.getAttribute("data-vp-mark")==="tv-word"&&wd.querySelectorAll("path").length>=3), triMark:!!(tri&&tri.getAttribute("data-vp-mark")==="tv-tri"&&tri.querySelectorAll("path").length===2),
    label:wd?wd.getAttribute("aria-label"):"", bg:ac.backgroundImage, bgc:ac.backgroundColor, text:(ad.textContent||"").replace(/\s+/g," ").trim()};
})'''
def look(r, sid, sel='#tvAds .ad.show'):
    v = r.ask(sid, LOOK + '(%s)' % json.dumps(sel))
    return v if isinstance(v, dict) else {}

# Every running animation inside a .tvlogo: what it is on and which properties its keyframes move.
ANIMS = r'''(function(){
  var out=[]; (document.getAnimations?document.getAnimations():[]).forEach(function(a){
    var t=a.effect&&a.effect.target; if(!t||!t.closest||!t.closest(".tvlogo")) return;
    var props={}; (a.effect.getKeyframes()||[]).forEach(function(k){ for(var p in k){ if(["offset","computedOffset","easing","composite"].indexOf(p)<0) props[p]=1; } });
    out.push({on:t.getAttribute("class")||t.tagName, name:a.animationName||"", props:Object.keys(props).sort()});
  }); return out; })()'''

def setting_up(r):
    print('\n1. SETTING UP: an address nobody has confirmed yet')
    tid, t = r.open('/tv?venue=no-such-venue-here', before='try{localStorage.removeItem("vpTvConfirmed")}catch(e){}', width=W, height=H)
    ok('CONTROL: the TV is on its holding card', r.until(t, '!!document.querySelector("#tvAds .ad.show .tvhold")', 25) is True,
       r.ask(t, '(document.getElementById("tvAds")||{}).innerHTML.slice(0,300)'))
    time.sleep(0.8)
    v = look(r, t)
    ok('the venueplay tv logo is on it: the big triangle and the wordmark with "tv", drawn from the brand file',
       v.get('triMark') and v.get('tvMark') and v.get('label') == 'venueplay tv', v)
    ok('at the approved size and place: 66.65% of the wall wide (1279.7 px at 1920), centred across, 49.8% down',
       v.get('logo') and abs(v['logo'][2] - 1279.7) <= 1.5 and abs(v['logo'][0] + v['logo'][2] / 2 - 960) <= 1 and abs(v['logo'][1] + v['logo'][3] / 2 - 537.8) <= 1.5, v.get('logo'))
    ok('the line under it says "Setting up this screen"', v.get('line') == 'Setting up this screen', v.get('line'))
    ok('in the TV body face, muted #8A8A95, readable across a room, and below the logo (never over it)',
       'Hanken Grotesk' in (v.get('lineFont') or '') and v.get('lineColour') == 'rgb(138, 138, 149)' and v.get('lineSize', 0) >= 32
       and v.get('lineTop', 0) >= v.get('logoBottom', 9999) - 1, [v.get('lineFont'), v.get('lineColour'), v.get('lineSize'), v.get('lineTop'), v.get('logoBottom')])
    ok('the triangle breathes: vpTriBreath, 2.6 s, ease-in-out, for ever',
       v.get('anim') == 'vpTriBreath' and v.get('dur') == '2.6s' and v.get('ease') == 'ease-in-out', [v.get('anim'), v.get('dur'), v.get('ease')])
    a = r.ask(t, ANIMS) or []
    ok('the glow and nothing else moves: the only animation in the logo is on the triangle, and it moves filter only',
       isinstance(a, list) and len(a) >= 1 and all(x.get('on') == 'tvl-tri' and x.get('props') == ['filter'] for x in a), a)
    samples = []
    for _ in range(8):
        s = look(r, t); samples.append((s.get('triFilter'), s.get('tri'), s.get('triOpacity'))); time.sleep(0.33)
    ok('it really does pulse (the glow is not the same across a breath)', len(set(x[0] for x in samples)) >= 3, [x[0][-60:] for x in samples[:3]])
    ok('and the shape never fades or moves: the triangle\'s box and full opacity hold through it',
       len(set(json.dumps(x[1]) for x in samples)) == 1 and all(x[2] == '1' for x in samples), [x[1:] for x in samples[:3]])
    ok('no glow round the whole logo: the wordmark and "tv" are solid and still',
       v.get('wordFilter') == 'none' and v.get('wordAnim') == 'none' and v.get('logoFilter') == 'none' and v.get('logoAnim') == 'none', v)
    ok('no gold glow: the card is plain near-black', v.get('bg') == 'none' and v.get('bgc') == 'rgb(10, 10, 11)', [v.get('bg'), v.get('bgc')])
    ok('the old cards are gone: no "Setting up" headline, no "Ask at the bar", no "Game on here"',
       not any(w in r.ask(t, 'document.getElementById("tvAds").innerText') for w in ('SETTING UP\n', 'Ask at the bar', 'GAME ON HERE', 'Checking this screen')),
       r.ask(t, 'document.getElementById("tvAds").innerText'))
    ok('no script errors on the TV', r.ask(t, 'window.__errs.length') == 0, r.ask(t, 'JSON.stringify(window.__errs)'))
    shot(r, t, 'tv-logo-1-setting-up')
    pos = v.get('logo')
    r.close_tab(tid)
    return pos

def still(r):
    print('\n2. STILL: the same screen with reduced motion asked for')
    tid, t = r.open('/tv?venue=no-such-venue-here', before='try{localStorage.removeItem("vpTvConfirmed")}catch(e){}', width=W, height=H)
    r.B.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]}, session=t)
    ok('CONTROL: the TV is on its holding card', r.until(t, '!!document.querySelector("#tvAds .ad.show .tvhold")', 25) is True)
    ok('CONTROL: the page sees reduced motion', r.ask(t, 'matchMedia("(prefers-reduced-motion: reduce)").matches') is True)
    time.sleep(0.5)
    v = look(r, t)
    ok('the triangle is still', v.get('anim') == 'none' and not (r.ask(t, ANIMS) or []), [v.get('anim'), r.ask(t, ANIMS)])
    ok('and still glows with the kit\'s own glow (two pink drop shadows)', (v.get('triFilter') or '').count('drop-shadow') == 2 and '255, 31, 142' in (v.get('triFilter') or ''), v.get('triFilter'))
    r.close_tab(tid)

# Watches the wall from before the page's own scripts: every line that fades out, and the logo at that moment.
WATCH = r'''try{localStorage.removeItem("vpTvConfirmed")}catch(e){}
window.__vpHand=[]; window.__vpLogos=[];
new MutationObserver(function(ms){ ms.forEach(function(m){ [].forEach.call(m.addedNodes||[],function(n){
  if(!n.querySelector) return;
  var g=(n.classList&&n.classList.contains("out")&&n.classList.contains("tvline"))?n:n.querySelector(".tvline.out"); if(!g) return;
  var hold=g.parentNode, now=hold&&hold.querySelector(".tvline.in"), lg=hold&&hold.querySelector(".tvlogo"), ad=hold&&hold.closest(".ad"), b=lg&&lg.getBoundingClientRect();
  window.__vpHand.push({was:g.textContent, now:now?now.textContent:null, anim:getComputedStyle(g).animationName+" "+getComputedStyle(g).animationDuration,
    animIn:now?getComputedStyle(now).animationName+" "+getComputedStyle(now).animationDuration:"", snap:!!(ad&&ad.classList.contains("snap")&&ad.classList.contains("show")),
    logo:b?[b.left,b.top,b.width,b.height]:null});
}); }); }).observe(document,{childList:true,subtree:true});'''

def handover(r, pending_pos):
    print('\n3. HANDOVER: a real venue\'s first load, "Setting up this screen" to the venue\'s name')
    slug = r.W.info['slug']
    tid, t = r.open('/tv?venue=' + slug, before=WATCH, width=W, height=H)
    ok('CONTROL: the wall comes up on the holding card', r.until(t, '!!document.querySelector("#tvAds .ad.show .tvhold")', 25) is True)
    got = r.until(t, '(function(){var s=document.querySelector("#tvAds .ad.show .tvline:not(.out)");return s&&s.textContent==="Test Alpha"&&!document.querySelector(".tvline.out")?s.textContent:"";})()', 30)
    ok('the line ends on the venue\'s own name, "Test Alpha"', got == 'Test Alpha', r.ask(t, 'document.getElementById("tvAds").innerText'))
    hand = r.ask(t, 'window.__vpHand') or []
    h = [x for x in hand if x.get('was') == 'Setting up this screen' and x.get('now') == 'Test Alpha']
    ok('it got there by a cross-fade: "Setting up this screen" fading out over the name fading in', len(h) >= 1, hand)
    h = h[0] if h else {}
    ok('both over 0.3 s (vpLineOut, vpLineIn)', h.get('anim') == 'vpLineOut 0.3s' and h.get('animIn') == 'vpLineIn 0.3s', h)
    ok('the new card went up at once, not with the 0.8 s slide fade', h.get('snap') is True, h)
    v = look(r, t)
    ok('the logo did not move by a pixel: the same box while it changed, after it, and as "Setting up" on its own',
       h.get('logo') and v.get('logo') and pending_pos and all(abs(a - b) <= 0.5 for a, b in zip(h['logo'], v['logo']))
       and all(abs(a - b) <= 0.5 for a, b in zip(v['logo'], pending_pos)), [h.get('logo'), v.get('logo'), pending_pos])
    ok('the venue\'s own screen breathes too, on near-black, with only its name under the logo',
       v.get('anim') == 'vpTriBreath' and v.get('bgc') == 'rgb(10, 10, 11)' and v.get('bg') == 'none' and v.get('line') == 'Test Alpha', v)
    ok('one card, not a loop of two', r.ask(t, 'document.querySelectorAll("#tvAds .ad").length') == 1, r.ask(t, 'document.querySelectorAll("#tvAds .ad").length'))
    ok('the old idle card is gone: no Anton venue name, no "Ask at the bar what\'s on", no "Play on your phone"',
       r.ask(t, '!document.querySelector("#tvAds .vname,#tvAds .adbig,#tvAds .vline") && document.getElementById("tvAds").innerText.indexOf("Ask at the bar")<0 && document.getElementById("tvAds").innerText.indexOf("Play on your phone")<0') is True)
    f = look(r, t, '#tvFloor')
    ok('the floor under the slides is the same logo in the same place, still, with nothing under it',
       f.get('logo') and v.get('logo') and all(abs(a - b) <= 0.5 for a, b in zip(f['logo'], v['logo'])) and f.get('anim') == 'none' and f.get('line') == '' and f.get('bgc') == 'rgb(10, 10, 11)', f)
    shot(r, t, 'tv-logo-3-venue-name')
    ok('no script errors on the TV', r.ask(t, 'window.__errs.length') == 0, r.ask(t, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)

UA = {
    'samsung': 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36',
    'lg': 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager',
    'googletv': 'Mozilla/5.0 (Linux; Android 12; Chromecast HD Build/STTE.230319.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 Android TV',
}
def fake_ua(ua):
    return ("(function(){var ua=%s;Object.defineProperty(Navigator.prototype,'userAgent',{get:function(){return ua;},configurable:true});})();" % json.dumps(ua))
CARD = r'''(function(){
  function shown(e){ if(!e) return false; var s=getComputedStyle(e),b=e.getBoundingClientRect(); return !e.hidden&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0; }
  var p=document.getElementById("pairPanel"), play=document.getElementById("tvPlayLink"), box=document.getElementById("suStore"), soon=document.getElementById("suSoon"), app=document.getElementById("suApp");
  var m=p.querySelector(".bvmark svg[data-vp-mark=tv-word]"), mb=m?m.getBoundingClientRect():null;
  var links=[].map.call(app.querySelectorAll("a"),function(a){return shown(a)?a.getAttribute("href"):null}).filter(Boolean);
  return {panel:shown(p), kind:p.getAttribute("data-tv-kind"), app:shown(app), head:(app.querySelector(".su-head")||{}).textContent,
    play:shown(play), store:shown(box)?box.innerText.replace(/\s+/g," ").trim():"", soon:shown(soon)?soon.textContent:"", links:links,
    logo:!!mb&&mb.width>150, logoGlow:m?getComputedStyle(m).filter:"", oldMark:!!p.querySelector("svg[data-vp-mark=wordmark]"),
    fits:p.getBoundingClientRect().bottom<=innerHeight&&p.scrollHeight<=p.clientHeight+1};
})()'''

def stores(r):
    print('\n4. STORES: bare /tv picks the store that fits this TV')
    PLAY = 'https://play.google.com/store/apps/details?id=au.com.venueplay.tv'
    for kind, w, h in (('samsung', 1920, 1080), ('lg', 1920, 1080), ('googletv', 1920, 1080), ('pc', 1920, 1080), ('pc', 1280, 720)):
        tid, t = r.open('/tv', before=fake_ua(UA[kind]) if kind in UA else None, width=w, height=h)
        ok('%s %d: CONTROL: the set-up card is up and read the TV as "%s"' % (kind, w, kind),
           r.until(t, '(function(){var p=document.getElementById("pairPanel");return !!p&&!p.classList.contains("hidden")&&p.getAttribute("data-tv-kind")===%s;})()' % json.dumps(kind), 20) is True,
           r.ask(t, 'document.getElementById("pairPanel").getAttribute("data-tv-kind")'))
        time.sleep(0.6)
        c = r.ask(t, CARD) or {}
        ok('%s %d: headed by the venueplay tv lockup, with no glow round it and no plain wordmark' % (kind, w),
           c.get('logo') and c.get('logoGlow') == 'none' and not c.get('oldMark'), c)
        if kind == 'samsung':
            ok('a Samsung: Samsung Apps, "coming soon", and no Google Play badge', c.get('app') and not c.get('play') and c.get('store') == 'Samsung Apps coming soon' and 'Samsung' in (c.get('head') or ''), c)
            ok('a Samsung: nothing in that half is a link (no dead link to a store the app is not in yet)', c.get('links') == [], c.get('links'))
        elif kind == 'lg':
            ok('an LG: the LG Content Store, "coming soon", and no Google Play badge', c.get('app') and not c.get('play') and c.get('store') == 'LG Content Store coming soon' and 'LG' in (c.get('head') or ''), c)
            ok('an LG: nothing in that half is a link', c.get('links') == [], c.get('links'))
        elif kind == 'googletv':
            ok('a Google TV: the Google Play badge, and nothing about the other two stores', c.get('play') and not c.get('store') and not c.get('soon') and c.get('links') == [PLAY], c)
        else:
            ok('a TV it cannot tell (%d): all three, Google Play first (its badge, the one link) then Samsung Apps and the LG Content Store, "coming soon"' % w,
               c.get('play') and c.get('links') == [PLAY] and c.get('soon') == 'Samsung Apps and LG Content Store: coming soon' and not c.get('store'), c)
        ok('%s %d: the whole card fits the wall, nothing to scroll' % (kind, w), c.get('fits') is True, c)
        shot(r, t, 'tv-logo-4-store-%s-%d' % (kind, w))
        ok('%s %d: no script errors' % (kind, w), r.ask(t, 'window.__errs.length') == 0, r.ask(t, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

def games(r):
    print('\n5. GAMES keep the plain venueplay corner logo')
    tid, t = r.open('/tv?venue=' + r.W.info['slug'], width=W, height=H)
    r.until(t, '!!document.getElementById("tvCorner")', 20)
    c = r.ask(t, '(function(){var c=document.getElementById("tvCorner");return {plain:!!c.querySelector("svg[data-vp-mark=wordmark]"),tv:!!c.querySelector("[data-vp-mark^=tv-]"),words:/\\btv\\b/i.test(c.querySelector("svg").getAttribute("aria-label")||"")};})()') or {}
    ok('the corner logo over a live game is the plain venueplay wordmark, never "venueplay tv"', c.get('plain') and not c.get('tv') and not c.get('words'), c)
    r.close_tab(tid)

def main():
    if not take_lock():
        return 2
    import rig as RIG
    r = RIG.Rig()
    try:
        pos = setting_up(r)
        still(r)
        handover(r, pos)
        stores(r)
        games(r)
    except Exception:
        import traceback; traceback.print_exc()
        global bad; bad += 1
    finally:
        r.close()
    print('\n%d of %d checks passed' % (ran - bad, ran))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
