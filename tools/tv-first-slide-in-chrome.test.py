#!/usr/bin/env python3
"""THE FIRST SLIDE IS UP WITHIN FIVE SECONDS, AND STAYS UP (live fault, Dean, 2 Nov 2026, about 3pm).

Dean pressed "Show it again" on a bare /tv and went to /tv?venue=test-charlie. The wall sat on the floor,
GAME ON HERE / Grab your phone, for about a minute before Test Charlie's first advertising slide, and he
thought it had not loaded at all. Measured live: the slides arrived and were lit at 0.8 s, then one slide's
picture failed to load (test-charlie has a deliberately broken one), probeImg rebuilt the slides without
lighting any, and nothing was lit again until the watchdog's second strike at 40 s.

This opens the REAL tv.html in headless Chrome (tools/browser-rig/rig.py: the repo's pages, the real game
Worker in jsc, supabase-js stood in) at 1920x1080 and checks:
  FAST     a venue with a broken picture, a good picture and a text slide: one of its own slides is lit
           within FIRST_LIMIT_MS of the page starting to load, and stays lit for the next 12 seconds
           (sampled every 100 ms inside the page), and the broken one is never the one lit.
  SLOW     the venue's screen takes 6 s to answer: until it does, the wall and the floor under it say
           "Loading", never "Game on here"; then the venue's slide arrives.
  NO LINE  the venue's screen never answers: "Loading" is gone by 23 s (it is time boxed, never stuck),
           and the wall is still a branded holding card, never black.

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
# Runs in the page before any of its own script: every 100 ms, what is LIT on the wall (opacity over a
# half, so a slide fading out does not count), and what the floor under it says.
WATCH = r'''
(function(){ window.__wall=[];
  setInterval(function(){ try{
    var lit=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(a){return +getComputedStyle(a).opacity>0.5;});
    var what=lit.map(function(a){var i=a.querySelector(".adimg");return i?("IMG "+(i.style.backgroundImage||"")):("TEXT "+a.innerText.replace(/\s+/g," ").trim());}).join(" | ");
    var fl=document.getElementById("tvFloor"), fw="";
    if(fl){ fw=[].filter.call(fl.querySelectorAll(".fl-load,.fl-done"),function(e){return getComputedStyle(e).display!=="none";}).map(function(e){return e.innerText.replace(/\s+/g," ").trim();}).join(" | ") || fl.innerText.replace(/\s+/g," ").trim(); }
    window.__wall.push([Math.round(performance.now()), what, fw]);
  }catch(e){} }, 100);
})();'''
CONFIRMED = 'try{localStorage.setItem("vpTvVenue",%s);localStorage.setItem("vpTvConfirmed",%s);}catch(e){}'

def wall(r, sid):
    return json.loads(r.ask(sid, 'JSON.stringify(window.__wall||[])') or '[]')

def own(what):
    return ('tugun-tuesday.jpg' in what) or (('TEXT ' + TEXT_HEAD).upper() in what.upper())

def main():
    if not take_lock():
        return 2
    import rig as RIG
    r = RIG.Rig()
    try:
        slug = r.W.info['slug']
        good = r.base + '/logos/ad-slides/tugun-tuesday.jpg'
        broken = r.base + '/logos/ad-slides/no-such-picture-here.jpg'
        r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': slug, 'logo_url': None, 'raffle': None,
                                     'slides': [{'head': 'Broken', 'accent': 'pink', 'image_url': broken, 'seconds': 4},
                                                {'head': 'Roast night', 'accent': 'gold', 'image_url': good, 'seconds': 4},
                                                {'head': TEXT_HEAD, 'sub': 'From 7pm', 'accent': 'blue', 'seconds': 4}]}])

        print('\nFAST: a venue with one broken picture among its slides')
        tid, sid = r.open('/tv?venue=' + slug, before=WATCH, width=1920, height=1080)
        time.sleep(FIRST_LIMIT_MS / 1000.0 + 12)
        w = wall(r, sid)
        lit_ok = [own(x[1]) for x in w]
        first = None
        for i in range(len(w)):
            if all(lit_ok[i:]):
                first = w[i][0]; break
        gaps = [x for x in w if first is not None and x[0] >= first and not own(x[1])]
        print('  first of the venue\'s own slides lit, and staying lit, at %s ms (limit %d)' % (first, FIRST_LIMIT_MS))
        ok('one of the venue\'s own slides is lit within %d ms of load' % FIRST_LIMIT_MS, first is not None and first <= FIRST_LIMIT_MS,
           [first, [x for x in w if not own(x[1])][-3:]])
        ok('and it stays lit: the wall never drops back to the floor in the next 12 seconds', len(w) > 100 and not gaps and first is not None,
           [len(w), gaps[:3]])
        ok('the broken picture is never the slide lit', not any('no-such-picture-here' in x[1] for x in w),
           [x for x in w if 'no-such-picture-here' in x[1]][:2])
        ok('no script errors on the TV', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-first-slide-fast-1920.jpg'))
        r.close_tab(tid)
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
        ok('while it waits, the wall says "Loading"', len(early) > 10 and all('LOADING' in x[1].upper() for x in early),
           [x[1] for x in early[:1] + early[-1:]] or w[-3:])
        ok('and the floor under it says "Loading" too', len(early) > 10 and all('LOADING' in x[2].upper() for x in early),
           [x[2] for x in early[:1] + early[-1:]] or w[-3:])
        ok('never "Game on here" while it is still loading', not any('GAME ON HERE' in (x[1] + ' ' + x[2]).upper() for x in w if x[0] <= 5000),
           [x for x in w if 'GAME ON HERE' in (x[1] + ' ' + x[2]).upper()][:2])
        got = r.until(sid, '(function(){var s=document.querySelector("#tvAds .ad.show");return !!s&&s.innerText.toUpperCase().indexOf(%s)>=0;})()' % json.dumps(TEXT_HEAD.upper()), 15)
        ok('once it answers, the venue\'s own slide is lit', got is True, r.ask(sid, 'document.querySelector("#tvAds .ad.show")&&document.querySelector("#tvAds .ad.show").innerText'))
        ok('and the floor goes back to its ordinary words', 'GAME ON HERE' in (wall(r, sid)[-1][2] or '').upper(), wall(r, sid)[-1:])
        r.close_tab(tid)
        r.close()

        print('\nNO LINE: the venue\'s screen never answers')
        r = RIG.Rig(hold={'/__worker/screen': 40})
        slug = r.W.info['slug']
        tid, sid = r.open('/tv?venue=' + slug, before=WATCH + CONFIRMED % (json.dumps(slug), json.dumps(slug)), width=1920, height=1080)
        time.sleep(23)
        w = wall(r, sid)
        late = [x for x in w if x[0] >= 21500]
        ok('at first it says "Loading"', any('LOADING' in x[1].upper() for x in w if x[0] < 5000), w[:2])
        ok('by 23 s it no longer says "Loading" anywhere: the wait is time boxed, never stuck', late and not any('LOADING' in (x[1] + ' ' + x[2]).upper() for x in late), late[-2:])
        ok('and the wall is a branded holding card, never black', late and all('GAME ON HERE' in x[1].upper() for x in late), late[-2:])
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-first-slide-noline-1920.jpg'))
        r.close_tab(tid)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
