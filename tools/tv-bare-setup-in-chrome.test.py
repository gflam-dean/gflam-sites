#!/usr/bin/env python3
"""BARE /tv IS THE SETUP SCREEN, IN ANY BROWSER (live fault, Dean, 1 Nov 2026, about 9pm).

Our emails send a new venue to venueplay.com.au/tv. On the live site, in Dean's Chrome, bare /tv put a
sample pub's advertising wall up full screen ("Indypendent Hotel / Tuesday Parmy Night", a prospect's
slides) with no setup panel at all: the page remembered the last venue that browser had opened
(localStorage vpTvVenue) and showed it as though this screen were that pub's.

This opens the REAL tv.html in headless Chrome (tools/browser-rig/rig.py: the repo's pages, the real game
Worker in jsc, supabase-js stood in) and checks, at 1920x1080 and 1280x720:
  CLEAN    a browser that has never opened a venue: the setup panel, the lowercase venueplay wordmark,
           no advertising painted, no scrollbar.
  MEMORY   the same browser after it HAS shown a venue's screen (with slides): bare /tv is still the
           setup panel and paints none of that venue's slides, and it does NOT offer that venue (no "last used
           for", no "Show it again": Dean, 2 Nov 2026, a venue puts its screen code in again).
  HOST     with a host console signed in, in another window of the same browser: the same.
  CONTROL  /tv?venue=<slug> still shows the venue's advertising and no panel.

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/tv-bare-setup-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

def take_lock(tool='tv-bare-setup-in-chrome'):
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

SAMPLE = 'Tuesday Parmy Night'
WALL = ('(function(){var p=document.getElementById("pairPanel"),b=p.getBoundingClientRect(),cs=getComputedStyle(p);'
        'var m=p.querySelector(".bvmark svg[data-vp-mark=wordmark]"),mb=m?m.getBoundingClientRect():null;'
        'var ads=document.getElementById("adsRoot"),as=getComputedStyle(ads),ab=ads.getBoundingClientRect();'
        'var painted=[].filter.call(document.querySelectorAll("#adsRoot *"),function(e){var r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=="hidden"&&+s.opacity>0&&e.children.length===0&&(e.textContent||"").trim();}).map(function(e){return e.textContent.trim().slice(0,30);});'
        'var pt=p.innerText||"",offer=/last used for|show it again/i.test(pt)||[].some.call(p.querySelectorAll("a[href]"),function(a){return /[?&]venue=/.test(a.getAttribute("href"));});'
        'return {panel:!p.classList.contains("hidden")&&cs.display!=="none"&&b.width>0&&b.height>0,'
        'inside:b.top>=0&&b.left>=0&&b.bottom<=innerHeight&&b.right<=innerWidth,scroll:p.scrollHeight-p.clientHeight,'
        'wordmark:!!mb&&mb.width>60,oldWord:/VENUEPLAY/.test(p.innerText),title:(p.querySelector(".su-title")||{}).textContent,'
        'adsShown:as.display!=="none"&&ab.width>0&&ab.height>0,painted:painted,sample:document.body.innerText.toUpperCase().indexOf(%s.toUpperCase())>=0,'
        'offer:offer,named:%s.some(function(n){return pt.toLowerCase().indexOf(n.toLowerCase())>=0;}),'
        'code:(function(){var c=document.getElementById("tvSetupCode");if(!c)return false;var q=c.getBoundingClientRect();return q.width>0&&q.height>0&&/Put in the screen code/.test(c.textContent);})()};})()' % (json.dumps(SAMPLE), '__NAMES__'))

def look(r, sid, w, h, label, names=()):
    ok('%s (%dx%d): the setup panel is on the wall' % (label, w, h),
       r.until(sid, '(function(){var p=document.getElementById("pairPanel");return !!p&&!p.classList.contains("hidden")&&p.getBoundingClientRect().height>0;})()', 20) is True,
       r.ask(sid, 'document.getElementById("pairPanel").className'))
    time.sleep(3)   # past the moment the remembered venue's slides used to arrive
    v = r.ask(sid, WALL.replace('__NAMES__', json.dumps(list(names) or ['\u0000']))) or {}
    ok('%s (%dx%d): still there after 3 s, inside the screen, no scrollbar' % (label, w, h), v.get('panel') and v.get('inside') and v.get('scroll', 9) <= 0, v)
    ok('%s (%dx%d): headed by the lowercase venueplay wordmark, never an uppercase VENUEPLAY' % (label, w, h), v.get('wordmark') and not v.get('oldWord'), v)
    ok('%s (%dx%d): no advertising painted behind it, and no sample pub anywhere' % (label, w, h),
       not v.get('adsShown') and not v.get('painted') and not v.get('sample'), [v.get('adsShown'), v.get('painted'), v.get('sample')])
    ok('%s (%dx%d): it offers no remembered venue: no "last used for", no "Show it again", no link to a venue\'s screen' % (label, w, h),
       not v.get('offer') and not v.get('named'), [v.get('offer'), v.get('named')])
    ok('%s (%dx%d): "Put in the screen code" is on the card, so the venue keys its code in again' % (label, w, h), v.get('code') is True, v.get('code'))
    if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-bare-%s-%d.jpg' % (label.split()[0].lower(), w)))
    return v

def main():
    if not take_lock():
        return 2
    import rig as RIG
    r = RIG.Rig()
    try:
        slug = r.W.info['slug']
        print('\nCLEAN: a browser that has never opened a venue')
        for w, h in ((1920, 1080), (1280, 720)):
            tid, sid = r.open('/tv', width=w, height=h)
            look(r, sid, w, h, 'CLEAN')
            r.close_tab(tid)

        print('\nMEMORY: the same browser after it has shown a venue with slides')
        r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': slug, 'logo_url': None, 'raffle': None,
                                     'slides': [{'head': SAMPLE, 'sub': 'Every Tuesday from 5pm', 'accent': 'gold'}]}])
        tid, sid = r.open('/tv?venue=' + slug, width=1920, height=1080)
        ok('CONTROL: /tv?venue=<slug> shows the venue\'s own advertising, with no setup panel',
           r.until(sid, '(function(){var p=document.getElementById("pairPanel"),a=document.getElementById("adsRoot");return a.textContent.indexOf(%s)>=0&&getComputedStyle(a).display!=="none"&&p.classList.contains("hidden");})()' % json.dumps(SAMPLE), 25) is True,
           r.ask(sid, '[document.getElementById("pairPanel").className, document.body.innerText.slice(0,200)]'))
        ok('CONTROL: and the browser now remembers that venue', r.ask(sid, 'localStorage.getItem("vpTvVenue")') == slug)
        if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-bare-control-venue-1920.jpg'))
        r.close_tab(tid)
        for w, h in ((1920, 1080), (1280, 720)):
            tid, sid = r.open('/tv', width=w, height=h)
            look(r, sid, w, h, 'MEMORY', names=(slug, SAMPLE))
            r.close_tab(tid)

        print('\nHOST: a host console signed in, in another window of the same browser')
        htid, host = r.open('/app/', width=1280, height=800)
        r.until(host, 'document.readyState==="complete"', 30)
        time.sleep(3)
        tid, sid = r.open('/tv', width=1920, height=1080)
        look(r, sid, 1920, 1080, 'HOST', names=(slug, SAMPLE))
        r.close_tab(tid); r.close_tab(htid)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
