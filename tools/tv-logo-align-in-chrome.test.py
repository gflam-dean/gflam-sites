#!/usr/bin/env python3
"""THE VENUE'S LOGO LINES UP WITH THE VENUEPLAY MARK, WHATEVER ITS SHAPE (Dean, 11 Nov 2026, INBOX 200).

Looking at Caz Reitop's Dirty Secrets, a 7.7:1 wordmark: "the venue's logo (top left) must line up with the
venueplay logo (top right): same vertical centre line and the same distance in from the edge, whatever the
logo's shape". Before this, the venue logo sat 23px in from the left (1.2% of the width) while the venueplay
mark sat 2.4cqw (46px) in from the right; a venue with no logo had its name 14px in and 14px down, its middle
about 20px above the mark's; and a wordmark shorter than the mark could not have the mark lifted to its middle.
Now the mark comes out to 1.2cqw, where the venue logo always was (moving the logo in to 2.4cqw instead put a
square crest over the trivia question's column and vp-fit dropped the answers 2px on a long question).

This opens the REAL tv.html in headless Chrome (tools/browser-rig/rig.py: the repo's pages, the real game
Worker in jsc, supabase-js stood in), with the venue's own screen record, puts a bingo lobby on the wall (the
host's "mode" message on the TV's channel), and at 1920x1080 and 1280x720 measures four cases as drawn:
  NONE     no logo: the venue's name, top left (#venueNameTag)
  WIDE     a 7.7:1 wordmark (tools/fixtures/logo-align/wordmark-7.7-to-1.png)
  SQUARE   a round white badge, Bodalla Pub's from its own site, trimmed to its ink (square-badge-bodalla.png)
  TALL     a 1:3 logo (tall-1-to-3.png)
  BANNER   a 14:1 banner, shorter than the venueplay mark itself (banner-14-to-1.png)
For each: the left item's vertical middle is the venueplay mark's middle (within 1px), and its distance in from
the left edge is the mark's distance in from the right edge (within 1px). Then the same three logos on the
trivia game screen (the screen tv.html shows in its frame during trivia), in its own demo with the show off.
The logos are swapped onto the live #venueLogo, the real load-and-size path (/app/vp-venuelogo.js).

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/tv-logo-align-in-chrome.test.py
"""
import base64, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
TOL = 1.0
FIX = os.path.join(HERE, 'fixtures', 'logo-align')
LOGOS = (('WIDE 7.7:1', 'wordmark-7.7-to-1.png', (1540, 200)),
         ('SQUARE badge', 'square-badge-bodalla.png', (480, 480)),
         ('TALL 1:3', 'tall-1-to-3.png', (200, 600)),
         ('BANNER 14:1', 'banner-14-to-1.png', (1400, 100)))   # shorter than the mark itself: the mark still centres on it
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

def take_lock(tool='tv-logo-align-in-chrome'):
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

# The host's voice on the TV's channel (as reconnect-layout-in-chrome does): the fake realtime carries
# messages by BroadcastChannel, so the page's channel names are recorded and a message posted into them.
SAY = r'''(function(){ window.__bc=[]; var BC=window.BroadcastChannel;
  window.BroadcastChannel=function(n){ if(window.__bc.indexOf(n)<0) window.__bc.push(n); return new BC(n); };
  window.__say=function(m){ window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new BC(n); c.postMessage({event:"msg", payload:m}); c.close(); } }); return true; };
})();'''

# What is drawn: the left item (the venue's logo, or its name when it has none), the venueplay mark that is
# showing in the corner (its first svg with a size), and the screen.
MEASURE = r'''(function(){
  function R(e){ if(!e) return null; var s=getComputedStyle(e); if(s.display==="none"||s.visibility==="hidden"||+s.opacity===0) return null;
    var q=e.getBoundingClientRect(); return q.height ? {t:q.top,b:q.bottom,l:q.left,r:q.right,w:q.width,h:q.height,cy:q.top+q.height/2} : null; }
  var c=document.getElementById("tvCorner")||document.querySelector(".tv-corner"), lg=document.getElementById("venueLogo"), nm=document.getElementById("venueNameTag"), mk=null;
  if(c && getComputedStyle(c).display!=="none"){ var s=c.querySelectorAll("svg"); for(var i=0;i<s.length && !mk;i++){ var q=s[i].getBoundingClientRect(); if(q.height) mk={t:q.top,b:q.bottom,l:q.left,r:q.right,w:q.width,h:q.height,cy:q.top+q.height/2}; } }
  return { logo:(lg && lg.complete && lg.naturalWidth) ? R(lg) : null, nat:lg ? [lg.naturalWidth, lg.naturalHeight] : null,
           name:R(nm), nameText:nm ? nm.textContent : null, mark:mk, W:innerWidth, H:innerHeight };
})()'''

def data_url(fn):
    with open(os.path.join(FIX, fn), 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode('ascii')

def settled(r, sid, key, secs=12):
    """The reading once the left item and the mark have stopped moving (two readings 0.4 s apart agree)."""
    end, last = time.time() + secs, None
    while time.time() < end:
        m = r.ask(sid, MEASURE) or {}
        cur = (m.get(key) or {}, m.get('mark') or {})
        if m.get(key) and m.get('mark') and last is not None and all(abs(cur[i].get(k, 0) - last[i].get(k, 0)) < 0.05 for i in (0, 1) for k in ('t', 'l', 'r', 'b')):
            return m
        last = cur; time.sleep(0.4)
    return r.ask(sid, MEASURE) or {}

def lined_up(tag, m, key):
    """The two checks Dean asked for, on what is drawn."""
    it, mk, W = m.get(key), m.get('mark'), m.get('W') or 0
    ok(tag + ': the %s and the venueplay mark are both on screen' % ('logo' if key == 'logo' else 'venue name'), bool(it) and bool(mk), m)
    if not (it and mk): return
    lin, rin = it['l'], W - mk['r']
    print('  %s: %s %.1fx%.1f middle %.2f, in %.2f | mark %.1fx%.1f middle %.2f, in %.2f' % (tag, key, it['w'], it['h'], it['cy'], lin, mk['w'], mk['h'], mk['cy'], rin))
    ok(tag + ': on the venueplay mark\'s vertical centre line (within %dpx)' % TOL, abs(it['cy'] - mk['cy']) <= TOL, [it, mk])
    ok(tag + ': the same distance in from the left edge as the mark is from the right (within %dpx)' % TOL, abs(lin - rin) <= TOL, [lin, rin])
    ok(tag + ': and both wholly on the screen', it['t'] >= 0 and mk['t'] >= 0 and it['l'] >= 0 and mk['r'] <= W, [it, mk])

def swap(r, sid, fn, nat):
    r.ask(sid, 'document.getElementById("venueLogo").src=%s; true' % json.dumps(data_url(fn)))
    return r.until(sid, '(function(l){return !!l && l.complete && l.naturalWidth===%d && l.naturalHeight===%d;})(document.getElementById("venueLogo"))' % nat, 10) is True

def tv(r):
    slug, vid = r.W.info['slug'], r.W.info['venue']
    def screen(logo):
        r.W.seed('vp_venue_screen', [{'venue_id': vid, 'slug': slug, 'logo_url': logo, 'raffle': None,
                                      'slides': [{'head': 'Trivia every Wednesday', 'sub': 'From 7pm', 'accent': 'blue'}]}], replace=True)
    def on_air(tid, sid, w, h):
        r.until(sid, '(function(v){return !v||v==="done";})(document.documentElement.getAttribute("data-tvi"))', 8)
        # said again until it is heard: the first tab of a fresh Chrome can open its channel a beat late
        UP = '(function(){var c=document.getElementById("tvCorner");return !!c && c.style.display!=="none" && document.getElementById("adsRoot").classList.contains("hidden") && !!c.querySelector("svg") && c.querySelector("svg").getBoundingClientRect().height>0;})()'
        for _ in range(10):
            r.ask(sid, 'window.__say && window.__say({t:"mode", mode:"bingo"}); true')
            if r.until(sid, UP, 3) is True: return True
        return False
    for (w, h) in ((1920, 1080), (1280, 720)):
        print('\nTV (tv.html), a bingo lobby on the wall, %dx%d' % (w, h))
        screen(None)
        tid, sid = r.open('/tv?venue=' + slug, before=SAY, width=w, height=h)
        ok('%d NONE: a bingo lobby is on the wall' % w, on_air(tid, sid, w, h), r.ask(sid, MEASURE))
        ok('%d NONE: the venue\'s name is shown top left' % w, r.until(sid, '(function(e){return !!e && e.style.display!=="none" && e.textContent.length>0 && e.getBoundingClientRect().height>0;})(document.getElementById("venueNameTag"))', 15) is True, r.ask(sid, MEASURE))
        m = settled(r, sid, 'name')
        ok('%d NONE: no logo is drawn' % w, m.get('logo') is None, m)
        lined_up('%d NONE (name "%s")' % (w, m.get('nameText')), m, 'name')
        shot(r, sid, 'tv-%d-none' % w)
        ok('%d NONE: no script errors on the TV' % w, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

        screen(r.base + '/logos/venue-tugun-bowls.png')
        tid, sid = r.open('/tv?venue=' + slug, before=SAY, width=w, height=h)
        ok('%d LOGO: a bingo lobby is on the wall' % w, on_air(tid, sid, w, h), r.ask(sid, MEASURE))
        r.until(sid, '(function(l){return !!l && l.complete && l.naturalWidth>0 && getComputedStyle(l).opacity==="1";})(document.getElementById("venueLogo"))', 15)
        for tag, fn, nat in LOGOS:
            t = '%d %s' % (w, tag)
            ok(t + ': the logo arrives on the live page', swap(r, sid, fn, nat), r.ask(sid, MEASURE))
            m = settled(r, sid, 'logo')
            lg = m.get('logo') or {}
            ok(t + ': drawn in its own shape', bool(lg) and abs(lg['w'] / max(lg['h'], 1) - nat[0] / float(nat[1])) <= 0.06 * nat[0] / float(nat[1]), [lg, nat])
            ok(t + ': the name is not drawn beside it (the logo wins)', m.get('name') is None, m.get('name'))
            lined_up(t, m, 'logo')
            shot(r, sid, 'tv-%d-%s' % (w, tag.split()[0].lower()))
        ok('%d LOGO: no script errors on the TV' % w, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

def trivia(r):
    for (w, h) in ((1920, 1080), (1280, 720)):
        print('\nTRIVIA SCREEN (what tv.html shows in its frame during trivia), its own demo, show off, %dx%d' % (w, h))
        tid, sid = r.open('/app/trivia/screen?demo=1&sting=0', width=w, height=h)
        ok('%d TRIVIA: the demo\'s logo has loaded' % w, r.until(sid, '(function(l){return !!l && l.complete && l.naturalWidth>0;})(document.getElementById("venueLogo"))', 15) is True, r.ask(sid, MEASURE))
        for tag, fn, nat in LOGOS:
            t = '%d TRIVIA %s' % (w, tag)
            ok(t + ': the logo arrives on the live page', swap(r, sid, fn, nat), r.ask(sid, MEASURE))
            lined_up(t, settled(r, sid, 'logo'), 'logo')
            shot(r, sid, 'trivia-%d-%s' % (w, tag.split()[0].lower()))
        ok('%d TRIVIA: no script errors on the screen' % w, r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

def main():
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    if not take_lock():
        return 2
    import rig as RIG
    r = RIG.Rig()
    try:
        tv(r)
        trivia(r)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
