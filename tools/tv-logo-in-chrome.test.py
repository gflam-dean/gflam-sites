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
                  while the logo stays put, to the pixel; the floor under the slides is the same logo.
                  The venue's OWN logo is top left (Dean, 3 Nov 2026): it fades in, keeps exactly the box
                  the trivia and musical bingo screens draw theirs in, into a game and back, fades out for a
                  show and back, and fades off when the TV loses the venue
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
    r.until(t, 'document.documentElement.getAttribute("data-tvi")==="done"', 8)   # the first-load intro is over
    time.sleep(0.4)
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

# Every step of the intro, from before the page's own script: [ms, tri, word, line, breath, state].
INTRO_WATCH = r"""window.__vpIntro=[]; (function(){ var h=document.documentElement;
  function rec(){ window.__vpIntro.push([Math.round(performance.now()), h.getAttribute("data-tvi-tri")||"", h.getAttribute("data-tvi-word")||"", h.getAttribute("data-tvi-line")||"", h.getAttribute("data-tvi-breath")||"", h.getAttribute("data-tvi")||""]); }
  new MutationObserver(rec).observe(h,{attributes:true}); })();"""
LUM = {'0': 0.13, 'a': 0.75, 'b': 1.0, 'c': 0.08, 'd': 0.7, '': 1.0}

def intro(r):
    print('\n0. THE INTRO: the triangle switches on, "venueplay" and "tv" together, the line, then the venue\'s logo')
    slug = r.W.info['slug']
    r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': slug, 'slides': [], 'raffle': None,
                                  'logo_url': r.base + '/logos/ad-slides/tugun-tuesday.jpg'}], replace=True)
    tid, t = r.open('/tv?venue=' + slug, before=INTRO_WATCH + LOGO_WATCH, width=W, height=H)
    ok('CONTROL: the intro ran and finished', r.until(t, 'document.documentElement.getAttribute("data-tvi")==="done"', 10) is True, r.ask(t, 'window.__vpIntro'))
    ev = r.ask(t, 'window.__vpIntro') or []
    on = [x for x in ev if x[5] == 'on']
    start = on[0][0] if on else (ev[0][0] if ev else 0)
    tri = []
    for x in ev:
        if not tri or tri[-1][1] != x[1]: tri.append((x[0] - start, x[1]))
    states = [v for _, v in tri]
    ok('the big triangle switches on with two catches: unlit, on, out, on, dim, then lit',
       states[:7] == ['0', 'a', '0', 'b', 'c', 'd', ''] or states[:6] == ['a', '0', 'b', 'c', 'd', ''], tri)
    lum = [(ms, LUM.get(v, 1.0)) for ms, v in tri]
    flashes = []   # the turns in brightness (more than a tenth); two turns are one flash
    for i in range(1, len(lum) - 1):
        if (lum[i][1] - lum[i - 1][1]) * (lum[i + 1][1] - lum[i][1]) < 0 and abs(lum[i][1] - lum[i - 1][1]) > 0.1: flashes.append(lum[i][0])
    worst = max([len([f for f in flashes if a <= f < a + 1000]) / 2.0 for a in flashes] or [0])   # a flash is an up and a down
    ok('never more than 3 flashes in any second (it is %.1f)' % worst, worst <= 3, flashes)
    wd = next((x[0] - start for x in ev if x[2] == '' and x[0] > start), None)
    ln = next((x[0] - start for x in ev if x[3] == '' and x[0] > start), None)
    br = next((x[0] - start for x in ev if x[4] == '' and x[0] > start), None)
    dn = next((x[0] - start for x in ev if x[5] == 'done'), None)
    ok('"venueplay" and "tv" come up at the same moment, one drawing (%s ms)' % wd,
       wd is not None and 650 <= wd <= 900 and r.ask(t, 'document.querySelector("#tvFloor svg.tvl-word").querySelectorAll("path").length') == 3, wd)
    ok('then the line ("Setting up this screen") at about 1.3 s (%s ms)' % ln, ln is not None and 1150 <= ln <= 1500 and (wd or 0) < ln, ln)
    ok('the breath only starts once the tube is lit (%s ms)' % br, br is not None and 900 <= br <= 1200, br)
    ok('all over inside 4 seconds (%s ms)' % dn, dn is not None and dn <= 4000, dn)
    lg = r.ask(t, 'window.__vpLogo') or []
    first = next((x[0] for x in lg if x[1] == 'block'), None)
    ok('a little after the words, the venue\'s own logo arrives top left (%s ms after the intro began)' % (None if first is None else first - start),
       first is not None and first - start >= 2200, [start, lg[:4]])
    ok('the intro is silent: nothing on the page makes a sound', r.ask(t, '!document.querySelector("audio,video")') is True)
    shot(r, t, 'tv-logo-0-intro-end')
    r.ask(t, 'setTimeout(function(){location.reload();},0); true'); time.sleep(1.2)
    r.until(t, 'document.readyState==="complete"', 15)
    ok('once per tab: a reload (the four-hourly one included) does not play it again',
       r.ask(t, 'document.documentElement.getAttribute("data-tvi")') in (None, '', 'done') and not r.ask(t, 'document.documentElement.getAttribute("data-tvi-tri")'), r.ask(t, 'window.__vpIntro'))
    r.close_tab(tid)
    import time as _t
    tid, t = r.open('/tv?venue=%s&vpi=%d' % (slug, int(_t.time() * 1000) - 1000), before=INTRO_WATCH, width=W, height=H)
    r.until(t, 'document.documentElement.getAttribute("data-tvi")==="done"', 10)
    ev = r.ask(t, 'window.__vpIntro') or []
    ok('handed over by the TV app 1 s in (&vpi=): it carries on from there, the tube already lit and the words up, never from the start',
       bool(ev) and not any(x[1] == '0' for x in ev) and not any(x[2] == 'hide' for x in ev[1:]), ev[:4])
    r.close_tab(tid)
    tid, t = r.open('/tv?venue=' + slug, before=INTRO_WATCH, width=W, height=H)
    r.B.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]}, session=t)
    r.ask(t, 'sessionStorage.removeItem("vpTvIntro"); setTimeout(function(){location.reload();},0); true'); time.sleep(1.2)
    r.until(t, 'document.readyState==="complete"', 15)
    ok('reduced motion: no intro at all, the still logo from the first frame',
       r.ask(t, 'document.documentElement.getAttribute("data-tvi")') == 'done' and not r.ask(t, 'document.documentElement.getAttribute("data-tvi-word")'), r.ask(t, 'window.__vpIntro'))
    r.close_tab(tid)

def lobbies(r):
    print('\n6. THE TRIVIA AND MUSICAL BINGO LOBBIES BEFORE THE HOST: the same card, "Waiting for the host"')
    slug = r.W.info['slug']
    tid0, t0 = r.open('/tv?venue=' + slug + '&intro=0', width=W, height=H)
    r.until(t0, '!!document.querySelector("#tvAds .ad.show .tvhold")', 20); time.sleep(0.5)
    ref = look(r, t0); r.close_tab(tid0)
    for g in ('trivia', 'musical'):
        tid, t = r.open('/app/%s/screen?venue=%s' % (g, slug), width=W, height=H)
        ok('%s: the waiting card is up' % g, r.until(t, '(function(c){return !!c&&!c.hidden&&c.getBoundingClientRect().height>0;})(document.getElementById("tvHoldCard"))', 20) is True)
        time.sleep(0.5)
        v = look(r, t, '#tvHoldCard')
        ok('%s: it says "Waiting for the host", never "Waiting for the host to connect..."' % g, v.get('line') == 'Waiting for the host' and 'connect' not in r.ask(t, 'document.body.innerText'), v.get('line'))
        ok('%s: the same venueplay tv logo in the same place as tv.html between games' % g, v.get('logo') and ref.get('logo') and all(abs(a - b) <= 0.5 for a, b in zip(v['logo'], ref['logo'])), [v.get('logo'), ref.get('logo')])
        ok('%s: the venueplay corner mark steps aside while the card is up' % g, r.ask(t, 'getComputedStyle(document.querySelector(".tv-corner")).visibility') == 'hidden')
        shot(r, t, 'tv-logo-6-%s-waiting' % g)
        r.close_tab(tid)

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
    # The venue has a logo of its own: it goes TOP LEFT on the between-games card, as on every game screen (Dean, 3 Nov 2026).
    r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': slug, 'slides': [], 'raffle': None,
                                  'logo_url': r.base + '/logos/ad-slides/tugun-tuesday.jpg'}], replace=True)
    tid, t = r.open('/tv?venue=' + slug, before=WATCH + LOGO_WATCH, width=W, height=H)
    ok('CONTROL: the wall comes up on the holding card', r.until(t, '!!document.querySelector("#tvAds .ad.show .tvhold")', 25) is True)
    got = r.until(t, '(function(){var s=document.querySelector("#tvAds .ad.show .tvline:not(.out)");return s&&s.textContent==="Waiting for the host"&&!document.querySelector(".tvline.out")?s.textContent:"";})()', 30)
    ok('set up, no game on: the line ends on "Waiting for the host" (Dean: "so the venue knows it\'s on them")', got == 'Waiting for the host', r.ask(t, 'document.getElementById("tvAds").innerText'))
    hand = r.ask(t, 'window.__vpHand') or []
    h = [x for x in hand if x.get('was') == 'Setting up this screen' and x.get('now') == 'Waiting for the host']
    ok('it got there by a cross-fade: "Setting up this screen" fading out over the name fading in', len(h) >= 1, hand)
    h = h[0] if h else {}
    ok('both over 0.3 s (vpLineOut, vpLineIn)', h.get('anim') == 'vpLineOut 0.3s' and h.get('animIn') == 'vpLineIn 0.3s', h)
    ok('the new card went up at once, not with the 0.8 s slide fade', h.get('snap') is True, h)
    v = look(r, t)
    ok('the logo did not move by a pixel: the same box while it changed, after it, and as "Setting up" on its own',
       h.get('logo') and v.get('logo') and pending_pos and all(abs(a - b) <= 0.5 for a, b in zip(h['logo'], v['logo']))
       and all(abs(a - b) <= 0.5 for a, b in zip(v['logo'], pending_pos)), [h.get('logo'), v.get('logo'), pending_pos])
    ok('the between-games card breathes too, on near-black, with only "Waiting for the host" under the logo',
       v.get('anim') == 'vpTriBreath' and v.get('bgc') == 'rgb(10, 10, 11)' and v.get('bg') == 'none' and v.get('line') == 'Waiting for the host', v)
    ok('one card, not a loop of two', r.ask(t, 'document.querySelectorAll("#tvAds .ad").length') == 1, r.ask(t, 'document.querySelectorAll("#tvAds .ad").length'))
    ok('the old idle card is gone: no Anton venue name, no "Ask at the bar what\'s on", no "Play on your phone"',
       r.ask(t, '!document.querySelector("#tvAds .vname,#tvAds .adbig,#tvAds .vline") && document.getElementById("tvAds").innerText.indexOf("Ask at the bar")<0 && document.getElementById("tvAds").innerText.indexOf("Play on your phone")<0') is True)
    f = look(r, t, '#tvFloor')
    ok('the floor under the slides is the same logo in the same place, still, with "Waiting for the host" under it',
       f.get('logo') and v.get('logo') and all(abs(a - b) <= 0.5 for a, b in zip(f['logo'], v['logo'])) and f.get('anim') == 'none' and f.get('line') == 'Waiting for the host' and f.get('bgc') == 'rgb(10, 10, 11)', f)
    ok('the venue\'s own logo is never in the centre of the card: the centre is only the venueplay tv logo and its line',
       r.ask(t, '!document.querySelector("#tvAds .tvhold img,#tvFloor .tvhold img")') is True)
    shot(r, t, 'tv-logo-3-venue-name')
    corner(r, t)
    ok('no script errors on the TV', r.ask(t, 'window.__errs.length') == 0, r.ask(t, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)

# Every change to the top-left logo's display and opacity, with the time, from before the page's own script.
LOGO_WATCH = r'''window.__vpLogo=[];
new MutationObserver(function(ms){ ms.forEach(function(m){ [].forEach.call(m.addedNodes||[],function(n){
  if(n.id!=="venueLogo") return;
  var rec=function(){ window.__vpLogo.push([Math.round(performance.now()), n.style.display, n.style.opacity]); };
  rec(); new MutationObserver(rec).observe(n,{attributes:true,attributeFilter:["style"]});
}); }); }).observe(document,{childList:true,subtree:true});'''
LBOX = r'''(function(d){ var e=d&&d.getElementById("venueLogo"); if(!e) return null; var s=(d.defaultView||window).getComputedStyle(e), b=e.getBoundingClientRect();
  return {box:[Math.round(b.left*10)/10,Math.round(b.top*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10], op:s.opacity, disp:s.display, tr:s.transitionDuration+" "+s.transitionProperty};})'''
def lbox(r, sid, frame=False):
    v = r.ask(sid, LBOX + ('(document.getElementById("gameFrame").contentDocument)' if frame else '(document)'))
    return v if isinstance(v, dict) else {}

def corner(r, t):
    print('\n3b. THE VENUE\'S LOGO, TOP LEFT: on the card, into a game and back, the shows, a lost venue')
    ok('CONTROL: the TV has the venue\'s logo', r.until(t, '!!document.getElementById("venueLogo") && getComputedStyle(document.getElementById("venueLogo")).opacity==="1"', 15) is True, lbox(r, t))
    time.sleep(0.6)
    hold = lbox(r, t)
    ok('it is up on the between-games card, top left (14 to 40 px in), fully shown', hold.get('disp') == 'block' and hold.get('op') == '1' and hold.get('box') and 10 <= hold['box'][0] <= 40 and 10 <= hold['box'][1] <= 40, hold)
    seen = r.ask(t, 'window.__vpLogo') or []
    first_on = next((i for i, x in enumerate(seen) if x[1] == 'block'), None)
    ok('it faded IN: laid out at opacity 0 first, then 1, over 0.3 s (the line\'s cross-fade), never popped on',
       first_on is not None and seen[first_on][2] == '0' and any(x[2] == '1' for x in seen[first_on:]) and hold.get('tr') == '0.3s opacity', [seen[:6], hold.get('tr')])
    for game in ('trivia', 'musical'):
        r.ask(t, 'window.postMessage({vp:"show-game",game:%s}, location.origin); true' % json.dumps(game))
        up = r.until(t, '(function(){var f=document.getElementById("gameFrame");try{var e=f.contentDocument.getElementById("venueLogo");return f.style.display==="block"&&!!e&&e.complete&&e.naturalWidth>0&&e.getBoundingClientRect().width>0;}catch(x){return false;}})()', 30)
        ok('%s: the game screen is in the frame with its own corner logo drawn' % game, up is True)
        time.sleep(1.0)
        top, inside = lbox(r, t), lbox(r, t, frame=True)
        ok('%s: the TV\'s top-left logo did not move, resize or blink going into the game (the same box as on the card, still shown)' % game,
           top.get('box') == hold.get('box') and top.get('op') == '1', [hold.get('box'), top])
        ok('%s: and it is exactly the box the game screen draws its own logo in' % game,
           inside.get('box') and top.get('box') and all(abs(a - b) <= 0.5 for a, b in zip(inside['box'], top['box'])), [inside, top])
        r.ask(t, 'window.postMessage({vp:"show-game",game:"bingo"}, location.origin); true')
        ok('%s: back between games, the same box, still shown' % game, r.until(t, '(function(){var f=document.getElementById("gameFrame");return f.style.display==="none";})()', 15) is True and lbox(r, t).get('box') == hold.get('box') and lbox(r, t).get('op') == '1', lbox(r, t))
    r.ask(t, 'window.dispatchEvent(new Event("vp-sting-start")); true'); time.sleep(0.45)
    mid = lbox(r, t)
    ok('a start or end-of-game show: it fades out with the rest, keeping its box', mid.get('op') == '0' and mid.get('disp') == 'block' and mid.get('box') == hold.get('box'), mid)
    r.ask(t, 'window.dispatchEvent(new Event("vp-sting-done")); true'); time.sleep(0.45)
    ok('and back in when the show is over', lbox(r, t).get('op') == '1', lbox(r, t))
    r.ask(t, 'window.postMessage({vp:"sting",on:true}, location.origin); true'); time.sleep(0.45)
    ok('the game in the frame playing its show says so, and it fades out for that too', lbox(r, t).get('op') == '0', lbox(r, t))
    r.ask(t, 'window.postMessage({vp:"sting",on:false}, location.origin); true'); time.sleep(0.45)
    ok('and back in after it', lbox(r, t).get('op') == '1', lbox(r, t))
    shot(r, t, 'tv-logo-3b-corner-logo')
    print('  the venue is taken off the books: the TV loses it (two "no such venue" answers, 30 s apart)')
    r.W.seed('vp_venues', [], replace=True)
    gone = r.until(t, '!document.getElementById("badVenue").classList.contains("hidden") || !document.getElementById("venuePick").classList.contains("hidden")', 90)
    ok('CONTROL: the TV says it is not linked (or asks which venue)', gone is True)
    time.sleep(0.6)
    lost = lbox(r, t)
    ok('the venue\'s logo has faded out and is off the wall', lost.get('op') == '0' and lost.get('disp') == 'none', lost)
    shot(r, t, 'tv-logo-3c-not-linked')

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
        intro(r)
        pos = setting_up(r)
        still(r)
        games(r)
        stores(r)
        lobbies(r)
        handover(r, pos)   # last: it ends by taking the venue off the books
    except Exception:
        import traceback; traceback.print_exc()
        global bad; bad += 1
    finally:
        r.close()
    print('\n%d of %d checks passed' % (ran - bad, ran))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
