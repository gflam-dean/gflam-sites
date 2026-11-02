#!/usr/bin/env python3
"""THE FIRST SLIDE IS UP WITHIN FIVE SECONDS, AND STAYS UP (live fault, Dean, 2 Nov 2026, about 3pm).

Dean pressed "Show it again" on a bare /tv and went to /tv?venue=test-charlie. The wall sat on the floor,
GAME ON HERE / Grab your phone, for about a minute before Test Charlie's first advertising slide, and he
thought it had not loaded at all. Measured live: the slides arrived and were lit at 0.8 s, then one slide's
picture failed to load (test-charlie has a deliberately broken one), probeImg rebuilt the slides without
lighting any, and nothing was lit again until the watchdog's second strike at 40 s.

This opens the REAL tv.html in headless Chrome (tools/browser-rig/rig.py: the repo's pages, the real game
Worker in jsc, supabase-js stood in) at 1920x1080 and checks:
  ONE      Test Charlie's own shape: one good picture and one broken one. A slide of its own is lit within
           FIRST_LIMIT_MS of the page starting to load and stays lit, the floor never showing again
           (sampled every 100 ms inside the page), through the broken picture's ten minute retry and the
           ten minute screen refresh, both run every few seconds here (Dean, 4:20pm 2 Nov 2026: the floor
           came back mid-rotation, an hour into a wall that had been fine).
  ROTATION a broken picture, a good picture and a text slide, 3 s each: the same, over several laps, both
           good slides take their turn, the broken one is never lit and never rejoins the loop, and halfway
           through the venue edits a slide: the swap to the new set must not show the floor either.
  REBUILD  a good picture and a text slide, 3 s each, and the wall rebuilt (buildAds + startAds, as the
           screen refresh, the poll and the tab coming forward do) 60 ms into every hand-over, while the new
           slide is still fading in: the floor must never show through (it did, on the ROTATION run, 2 Nov).
  SLOW     the venue's screen takes 6 s to answer: until it does, the wall and the floor under it say
           "Setting up this screen" under the venueplay tv logo (Dean, 3 Nov 2026), not "Waiting for the host";
           then the venue's slide arrives and the floor under it says "Waiting for the host".
  NO LINE  the venue's screen never answers: "Setting up this screen" is gone by 23 s (time boxed, never
           stuck), and the wall is still the venueplay tv holding card, never black.

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/tv-first-slide-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

FIRST_LIMIT_MS = 5000
SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1

def take_lock(tool='tv-first-slide-in-chrome'):
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

TEXT_HEAD = 'Trivia every Wednesday'
READY = 'SETTING UP THIS SCREEN'
DONE = 'WAITING FOR THE HOST'   # the finished floor's line once set up (Dean, 3 Nov 2026)
# Runs in the page before any of its own script: every 100 ms, what is LIT on the wall (opacity over a
# half, so a slide fading out does not count), and what the floor under it says.
WATCH = r'''
(function(){ window.__wall=[]; window.__badIn=[];
  document.addEventListener("DOMContentLoaded", function(){ try{
    new MutationObserver(function(ms){ ms.forEach(function(m){ [].forEach.call(m.addedNodes, function(n){
      if(n.nodeType===1 && /no-such-picture-here/.test(n.innerHTML||"")) window.__badIn.push(Math.round(performance.now())); }); }); })
      .observe(document.getElementById("tvAds"), { childList:true });
  }catch(e){} });
  setInterval(function(){ try{
    var lit=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(a){return +getComputedStyle(a).opacity>0.5;});
    var what=lit.map(function(a){var i=a.querySelector(".adimg");return i?("IMG "+(i.style.backgroundImage||"")):("TEXT "+a.innerText.replace(/\s+/g," ").trim());}).join(" | ");
    var fl=document.getElementById("tvFloor"), fw="";
    if(fl){ fw=[].filter.call(fl.querySelectorAll(".fl-load,.fl-done"),function(e){return getComputedStyle(e).display!=="none";}).map(function(e){return e.innerText.replace(/\s+/g," ").trim();}).join(" | ") || fl.innerText.replace(/\s+/g," ").trim(); }
    var see=1; [].forEach.call(document.querySelectorAll("#tvAds .ad"),function(a){ see*=1-(+getComputedStyle(a).opacity||0); });
    window.__wall.push([Math.round(performance.now()), what, fw, Math.round((1-see)*100)/100]);   // [3]: how much of the wall the slides cover
  }catch(e){} }, 100);
})();'''
# The two ten minute timers behind the 4:20pm floor, run every few seconds: the broken picture's retry
# (setTimeout, named retryBadImg) and the screen refresh (setInterval calling loadScreen). Nothing else moves.
FAST_TIMERS = r'''
(function(){ var st=window.setTimeout, si=window.setInterval;
  window.setTimeout=function(f,ms){ try{ if(ms===600000 && typeof f==="function" && /retryBadImg|BAD_IMG/.test(String(f)+(f.name||""))) ms=2500; }catch(e){} return st.apply(this,[f,ms].concat([].slice.call(arguments,2))); };
  window.setInterval=function(f,ms){ try{ if(ms===600000 && typeof f==="function" && /loadScreen\(/.test(String(f))) ms=3500; }catch(e){} return si.apply(this,[f,ms].concat([].slice.call(arguments,2))); };
})();'''
# 60 ms into every hand-over (a slide given "show" while it is still see-through), the wall is rebuilt the
# way the tab coming forward rebuilds it: tv.html's visibilitychange runs buildAds() and startAds().
MID_FADE = r'''
(function(){ window.__midFade=0;
  document.addEventListener("DOMContentLoaded", function(){ try{
    new MutationObserver(function(ms){ ms.forEach(function(m){ var a=m.target;
      if(!a.classList || !a.classList.contains("ad") || !a.classList.contains("show") || /show/.test(m.oldValue||"")) return;
      if(+getComputedStyle(a).opacity > 0.3) return;
      setTimeout(function(){ if(+getComputedStyle(a).opacity < 0.9){ window.__midFade++; document.dispatchEvent(new Event("visibilitychange")); } }, 60);
    }); }).observe(document.getElementById("tvAds"), { subtree:true, attributes:true, attributeFilter:["class"], attributeOldValue:true });
  }catch(e){} });
})();'''
CONFIRMED = 'try{localStorage.setItem("vpTvVenue",%s);localStorage.setItem("vpTvConfirmed",%s);}catch(e){}'

def wall(r, sid):
    return json.loads(r.ask(sid, 'JSON.stringify(window.__wall||[])') or '[]')

def own(what):
    return ('tugun-tuesday.jpg' in what) or ('TEXT TRIVIA EVERY ' in what.upper())

def main():
    if not take_lock():
        return 2
    import rig as RIG
    r = RIG.Rig()
    try:
        slug = r.W.info['slug']
        good = r.base + '/logos/ad-slides/tugun-tuesday.jpg'
        broken = r.base + '/logos/ad-slides/no-such-picture-here.jpg'

        def watch_scene(name, slides, secs, want_both=False, change=None, extra='', broken=True):
            row = lambda sl: [{'venue_id': r.W.info['venue'], 'slug': slug, 'logo_url': None, 'raffle': None, 'slides': sl}]
            r.W.seed('vp_venue_screen', row(slides), replace=True)
            tid, sid = r.open('/tv?venue=' + slug, before=FAST_TIMERS + WATCH + extra, width=1920, height=1080)
            if change:   # the venue edits its slides mid-rotation: the next screen refresh swaps the new set in
                time.sleep(secs / 2.0); r.W.seed('vp_venue_screen', row(change), replace=True); time.sleep(secs / 2.0)
            else:
                time.sleep(secs)
            w = wall(r, sid)
            first = next((x[0] for x in w if own(x[1])), None)
            gaps = [x for x in w if first is not None and x[0] >= first and (not own(x[1]) or x[3] < 0.9)]   # a slide lit, and the floor not showing through
            print('  %s: first of the venue\'s own slides lit at %s ms (limit %d), %d samples over %.0f s' % (name, first, FIRST_LIMIT_MS, len(w), secs))
            ok('%s: one of the venue\'s own slides is lit within %d ms of load' % (name, FIRST_LIMIT_MS), first is not None and first <= FIRST_LIMIT_MS, [first, w[:2]])
            ok('%s: once a slide has painted, the floor never shows again, not even through a fade (and nothing else stands in)' % name,
               len(w) > secs * 7 and first is not None and not gaps, [len(w), gaps[:3]])
            ok('%s: the broken picture is never the slide lit' % name, not any('no-such-picture-here' in x[1] for x in w),
               [x for x in w if 'no-such-picture-here' in x[1]][:2])
            if want_both:
                ok('%s: and the loop really turns: both good slides take their turn' % name,
                   any('tugun-tuesday.jpg' in x[1] for x in w) and any(TEXT_HEAD.upper() in x[1].upper() for x in w), sorted(set(x[1][:60] for x in w)))
            bad_in = json.loads(r.ask(sid, 'JSON.stringify(window.__badIn||[])') or '[]')
            ok('%s: after the first slide has painted, the broken picture never comes back into the loop' % name,
               first is not None and not [t for t in bad_in if t > first], [first, bad_in])
            if change:
                ok('%s: the edited slides went up (the refresh swapped them in)' % name, any('THURSDAY' in x[1].upper() for x in w), sorted(set(x[1][:50] for x in w)))
            if extra:
                n = r.ask(sid, 'window.__midFade||0')
                ok('%s: the wall really was rebuilt mid hand-over, again and again' % name, isinstance(n, int) and n >= 3, n)
            if broken:
              retried = r.ask(sid, 'performance.getEntriesByType("resource").filter(function(e){return /no-such-picture-here/.test(e.name);}).length')
              ok('%s: the broken picture was tried again in that time (the retry ran)' % name, isinstance(retried, int) and retried >= 2, retried)
            ok('%s: no script errors on the TV' % name, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-first-slide-%s-1920.jpg' % name.lower()))
            r.close_tab(tid)

        print('\nONE: one good picture and one broken one (Test Charlie)')
        watch_scene('ONE', [{'head': 'Roast night', 'accent': 'gold', 'image_url': good, 'seconds': 4},
                            {'head': 'Broken', 'accent': 'pink', 'image_url': broken, 'seconds': 4}], 20)
        print('\nROTATION: a broken picture, a good picture and a text slide, 3 s each')
        watch_scene('ROTATION', [{'head': 'Broken', 'accent': 'pink', 'image_url': broken, 'seconds': 3},
                                 {'head': 'Roast night', 'accent': 'gold', 'image_url': good, 'seconds': 3},
                                 {'head': TEXT_HEAD, 'sub': 'From 7pm', 'accent': 'blue', 'seconds': 3}], 24, want_both=True,
                    change=[{'head': 'Broken', 'accent': 'pink', 'image_url': broken, 'seconds': 3},
                            {'head': 'Roast night', 'accent': 'gold', 'image_url': good, 'seconds': 3},
                            {'head': 'Trivia every Thursday', 'sub': 'From 7pm', 'accent': 'blue', 'seconds': 3}])
        print('\nREBUILD: the wall rebuilt 60 ms into every hand-over, while the new slide is still fading in')
        watch_scene('REBUILD', [{'head': 'Roast night', 'accent': 'gold', 'image_url': good, 'seconds': 3},
                                {'head': TEXT_HEAD, 'sub': 'From 7pm', 'accent': 'blue', 'seconds': 3}], 16, want_both=True, extra=MID_FADE, broken=False)
        r.close()

        print('\nSLOW: the venue\'s screen takes 6 seconds to answer')
        r = RIG.Rig(hold={'/__worker/screen': 6})
        slug = r.W.info['slug']
        r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': slug, 'logo_url': None, 'raffle': None,
                                     'slides': [{'head': TEXT_HEAD, 'sub': 'From 7pm', 'accent': 'blue'}]}])
        tid, sid = r.open('/tv?venue=' + slug, before=WATCH + CONFIRMED % (json.dumps(slug), json.dumps(slug)), width=1920, height=1080)
        time.sleep(4.5)
        w = wall(r, sid)
        early = [x for x in w if 1000 <= x[0] <= 4000]
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-first-slide-loading-1920.jpg'))
        ok('while it waits, the wall says "Setting up this screen"', len(early) > 10 and all(READY in x[1].upper() for x in early),
           [x[1] for x in early[:1] + early[-1:]] or w[-3:])
        ok('and the floor under it says so too', len(early) > 10 and all(READY in x[2].upper() for x in early),
           [x[2] for x in early[:1] + early[-1:]] or w[-3:])
        ok('never the finished screen\'s line ("Waiting for the host") while it is still loading', not any(DONE in (x[1] + ' ' + x[2]).upper() for x in w if x[0] <= 5000),
           [x for x in w if DONE in (x[1] + ' ' + x[2]).upper()][:2])
        got = r.until(sid, '(function(){var s=document.querySelector("#tvAds .ad.show");return !!s&&s.innerText.toUpperCase().indexOf(%s)>=0;})()' % json.dumps(TEXT_HEAD.upper()), 15)
        ok('once it answers, the venue\'s own slide is lit', got is True, r.ask(sid, 'document.querySelector("#tvAds .ad.show")&&document.querySelector("#tvAds .ad.show").innerText'))
        fname = r.ask(sid, '(function(){var n=document.querySelector("#tvFloor .fl-done");return n?n.textContent:"";})()')
        ok('and the floor under it now says "Waiting for the host" under the logo', fname == 'Waiting for the host', fname)
        ok('and the floor goes on to its finished line', DONE in (wall(r, sid)[-1][2] or '').upper() and READY not in (wall(r, sid)[-1][2] or '').upper(), wall(r, sid)[-1:])
        r.close_tab(tid)
        r.close()

        print('\nNO LINE: the venue\'s screen never answers')
        r = RIG.Rig(hold={'/__worker/screen': 40})
        slug = r.W.info['slug']
        tid, sid = r.open('/tv?venue=' + slug, before=WATCH + CONFIRMED % (json.dumps(slug), json.dumps(slug)), width=1920, height=1080)
        time.sleep(23)
        w = wall(r, sid)
        late = [x for x in w if x[0] >= 21500]
        ok('at first it says "Setting up this screen"', any(READY in x[1].upper() for x in w if x[0] < 5000), w[:2])
        ok('by 23 s it says that nowhere: the wait is time boxed, never stuck', late and not any(READY in (x[1] + ' ' + x[2]).upper() for x in late), late[-2:])
        BRAND = ('(function(){var c=document.querySelector("#tvAds .ad.show");if(!c)return null;var t=c.querySelector(".tvlogo .tvl-tri"),m=c.querySelector(".tvlogo svg.tvl-word[data-vp-mark=tv-word]");'
                 'return {anim:t?getComputedStyle(t).animationName:"",f:t?getComputedStyle(t).filter:"",tri:t?t.getBoundingClientRect().width:0,mark:m?m.getBoundingClientRect().width:0,op:+getComputedStyle(c).opacity};})()')
        b1 = r.ask(sid, BRAND) or {}
        ok('and the wall is the venueplay tv holding card, lit, never black', late and all(x[3] >= 0.9 for x in late) and b1.get('mark', 0) >= 150 and b1.get('op', 0) >= 0.99, [late[-2:], b1])
        fs = set()
        for _ in range(6):
            fs.add((r.ask(sid, BRAND) or {}).get('f')); time.sleep(0.4)
        ok('it is the venueplay tv logo: the big triangle and the wordmark with tv, at size', b1.get('tri', 0) >= 150 and b1.get('mark', 0) >= 150, b1)
        ok('and the triangle breathes (its glow is moving), so the screen never looks frozen', b1.get('anim') == 'vpTriBreath' and len(fs) >= 2, [b1.get('anim'), len(fs)])
        old = r.ask(sid, '/game on here|grab your phone/i.test(document.body.innerText + " " + document.getElementById("tvFloor").innerHTML)')
        ok('"Game on here" is gone from the wall and from the floor under it', old is False, old)
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-first-slide-noline-1920.jpg'))
        r.close_tab(tid)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
