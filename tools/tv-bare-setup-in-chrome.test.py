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
           setup panel and paints none of that venue's slides; it offers "Show it again" for that venue,
           and that button opens the venue's own screen.
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
        time.sleep(2)

SAMPLE = 'Tuesday Parmy Night'
WALL = ('(function(){var p=document.getElementById("pairPanel"),b=p.getBoundingClientRect(),cs=getComputedStyle(p);'
        'var m=p.querySelector(".bvmark svg[data-vp-mark=wordmark]"),mb=m?m.getBoundingClientRect():null;'
        'var ads=document.getElementById("adsRoot"),as=getComputedStyle(ads),ab=ads.getBoundingClientRect();'
        'var painted=[].filter.call(document.querySelectorAll("#adsRoot *"),function(e){var r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=="hidden"&&+s.opacity>0&&e.children.length===0&&(e.textContent||"").trim();}).map(function(e){return e.textContent.trim().slice(0,30);});'
        'var last=document.getElementById("suLast");'
        'return {panel:!p.classList.contains("hidden")&&cs.display!=="none"&&b.width>0&&b.height>0,'
        'inside:b.top>=0&&b.left>=0&&b.bottom<=innerHeight&&b.right<=innerWidth,scroll:p.scrollHeight-p.clientHeight,'
        'wordmark:!!mb&&mb.width>60,oldWord:/VENUEPLAY/.test(p.innerText),title:(p.querySelector(".su-title")||{}).textContent,'
        'adsShown:as.display!=="none"&&ab.width>0&&ab.height>0,painted:painted,sample:document.body.innerText.toUpperCase().indexOf(%s.toUpperCase())>=0,'
        'last:last&&!last.hidden?last.innerText:"",lastHref:(document.getElementById("suLastGo")||{}).getAttribute?document.getElementById("suLastGo").getAttribute("href"):""};})()' % json.dumps(SAMPLE))

def look(r, sid, w, h, label, expect_last=None):
    ok('%s (%dx%d): the setup panel is on the wall' % (label, w, h),
       r.until(sid, '(function(){var p=document.getElementById("pairPanel");return !!p&&!p.classList.contains("hidden")&&p.getBoundingClientRect().height>0;})()', 20) is True,
       r.ask(sid, 'document.getElementById("pairPanel").className'))
    time.sleep(3)   # past the moment the remembered venue's slides used to arrive
    v = r.ask(sid, WALL) or {}
    ok('%s (%dx%d): still there after 3 s, inside the screen, no scrollbar' % (label, w, h), v.get('panel') and v.get('inside') and v.get('scroll', 9) <= 0, v)
    ok('%s (%dx%d): headed by the lowercase venueplay wordmark, never an uppercase VENUEPLAY' % (label, w, h), v.get('wordmark') and not v.get('oldWord'), v)
    ok('%s (%dx%d): no advertising painted behind it, and no sample pub anywhere' % (label, w, h),
       not v.get('adsShown') and not v.get('painted') and not v.get('sample'), [v.get('adsShown'), v.get('painted'), v.get('sample')])
    if expect_last:
        ok('%s (%dx%d): it offers the venue it remembers, by name, as one button to its own screen' % (label, w, h),
           expect_last in (v.get('last') or '') and 'Show it again' in (v.get('last') or '') and v.get('lastHref', '').startswith('/tv?venue='), [v.get('last'), v.get('lastHref')])
    else:
        ok('%s (%dx%d): and offers no venue (this browser has none)' % (label, w, h), not v.get('last'), v.get('last'))
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
        name = None
        for w, h in ((1920, 1080), (1280, 720)):
            tid, sid = r.open('/tv', width=w, height=h)
            v = look(r, sid, w, h, 'MEMORY', expect_last='Show it again')
            name = v.get('last')
            if w == 1280:
                href = v.get('lastHref') or ''
                ok('MEMORY: "Show it again" goes to that venue\'s own address', href == '/tv?venue=' + slug, href)
                r.ask(sid, 'document.getElementById("suLastGo").click(); true')
                ok('MEMORY: pressing it puts the venue\'s own screen back, advertising and all',
                   r.until(sid, '(function(){var a=document.getElementById("adsRoot");return /[?&]venue=/.test(location.search)&&a.textContent.indexOf(%s)>=0&&getComputedStyle(a).display!=="none";})()' % json.dumps(SAMPLE), 25) is True,
                   r.ask(sid, '[location.href, document.body.innerText.slice(0,160)]'))
            r.close_tab(tid)

        print('\nHOST: a host console signed in, in another window of the same browser')
        htid, host = r.open('/app/', width=1280, height=800)
        r.until(host, 'document.readyState==="complete"', 30)
        time.sleep(3)
        tid, sid = r.open('/tv', width=1920, height=1080)
        look(r, sid, 1920, 1080, 'HOST', expect_last='Show it again')
        r.close_tab(tid); r.close_tab(htid)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
