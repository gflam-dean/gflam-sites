#!/usr/bin/env python3
"""THE PHONE'S STATUS DOT AND RECONNECTING BAR, AND THE TV'S VENUE NAME TOP LEFT, WHERE THEY ARE PAINTED
(Dean's design asks, live test night 1 Nov 2026).

  PHONE  "the Connected line under the logo pushes the game down". play.html, trivia/play.html and
         musical/play.html, at 320, 375 and 390 wide: the status is a small dot beside the venueplay mark,
         inside the header's first row, with no line of its own; while the page says Reconnecting a slim
         bar hangs under the header OVER the page (nothing below it moves), and it goes when the page is
         back. Run by the pages' own code paths (#statusText is what every page writes), with
         /app/vp-connbar.js doing the rest.
  TV     "when the venue has no logo show the name in plain text in the top left". tv.html on a bingo
         lobby at 1920x1080 and 1280x720, the advertising, a venue WITH a logo, and the trivia game screen:
         the name is top left, inside the screen, clear of the venueplay corner and of everything the
         wall paints; never on the ads; never beside a logo.

Same rig as the other in-chrome suites (tools/browser-rig/rig.py): the repo's own pages, the REAL game
Worker in jsc, supabase-js replaced by a stand-in, headless Chrome. Takes the repo's heavy lock first
(VP_WAIT_LOCK seconds to wait for it) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/reconnect-layout-in-chrome.test.py
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

def take_lock(tool='reconnect-layout-in-chrome'):
    """The repo's heavy lock, waited for (VP_WAIT_LOCK seconds) but never cleared: a stale lock is
    somebody else's to explain, so this refuses rather than removing it."""
    deadline = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    said = False
    while True:
        state, pid, text = gatelib.lock_state()
        if state == 'stale':
            print('  heavy lock is STALE (pid %s, "%s"). Not clearing somebody else\'s lock: refusing.' % (pid, text[:80]))
            return False
        if state in ('free', 'mine'):
            if gatelib.hold_lock_or_refuse(tool, wait_s=0):
                return True
        if time.time() > deadline:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80]))
            return False
        if not said:
            print('  heavy lock held by pid %s ("%s"), waiting' % (pid, text[:80])); said = True
        time.sleep(0.5)

RECT = '(function(e){if(!e)return null;var b=e.getBoundingClientRect(),s=getComputedStyle(e);return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height),vis:s.display!=="none"&&s.visibility!=="hidden"&&!e.hidden&&b.width>0&&b.height>0};})'
def rect(r, sid, sel):
    return r.ask(sid, RECT + '(document.querySelector(%s))' % json.dumps(sel))
def overlap(a, b):
    return bool(a and b and a['l'] < b['r'] and a['r'] > b['l'] and a['t'] < b['b'] and a['b'] > b['t'])
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

def phone_scene(r, path, label):
    for w, h in ((320, 640), (375, 812), (390, 844)):
        tid, sid = r.open(path, width=w, height=h)
        ok('%s at %d: the page is up' % (label, w), r.until(sid, 'document.readyState!=="loading" && !!document.getElementById("statusDot") && !!window.VPConnBar', 40) is True)
        r.until(sid, '!!document.getElementById("vpConnBar")', 10)
        # The page's own words for "connected" (what each page writes once the host answers).
        r.ask(sid, 'document.getElementById("statusDot").classList.add("on"); var s=document.getElementById("statusLine")||document.getElementById("statusDot").parentNode; s.classList.remove("nostatus"); document.getElementById("statusText").textContent="Connected"; true')
        time.sleep(0.3)
        brand, dot, top, bar, word = (rect(r, sid, '.ptop .brand'), rect(r, sid, '#statusDot'), rect(r, sid, '.ptop'),
                                      rect(r, sid, '#vpConnBar'), rect(r, sid, '.ptop .brand .word'))
        line = r.ask(sid, '(function(){var t=document.getElementById("statusText"),b=t.getBoundingClientRect();return {w:b.width,h:b.height,txt:t.textContent};})()') or {}
        menu = rect(r, sid, '#menuBtn')
        if 'trivia' in label:
            # The trivia phone (Dean, 3 Nov 2026): the green dot sits next to the menu button, top right, level with it.
            mb = rect(r, sid, '#menuBtn')
            ok('%s at %d: a green dot next to the menu button, level with it' % (label, w),
               dot and dot['vis'] and mb and dot['r'] <= mb['l'] and mb['l'] - dot['r'] <= 16 and abs((dot['t'] + dot['b']) / 2 - (mb['t'] + mb['b']) / 2) <= 3,
               [dot, mb])
        else:
            ok('%s at %d: a green dot beside the venueplay mark, in the header\'s first row' % (label, w),
               dot and dot['vis'] and word and dot['l'] >= word['r'] and dot['l'] - word['r'] <= 24 and dot['t'] >= brand['t'] - 2 and dot['b'] <= brand['b'] + 2,
               [dot, word, brand])
        ok('%s at %d: the dot is green (Connected) and says so to a screen reader' % (label, w),
           r.ask(sid, 'document.getElementById("statusDot").classList.contains("on") && document.getElementById("statusDot").getAttribute("aria-label")==="Connected"') is True)
        ok('%s at %d: no "Connected" line of its own: the words take no space' % (label, w), line.get('w', 9) <= 1 and line.get('h', 9) <= 1, line)
        ok('%s at %d: the dot is clear of the menu button and inside the screen' % (label, w), dot and not overlap(dot, menu) and dot['r'] <= w, [dot, menu])
        ok('%s at %d: no Reconnecting bar while connected' % (label, w), bar is not None and not bar['vis'], bar)
        shot(r, sid, 'phone-%s-%d-connected' % (label.split()[0], w))
        below = r.ask(sid, '(function(){var v=[].filter.call(document.querySelectorAll(".view"),function(x){return !x.classList.contains("hidden")&&x.getBoundingClientRect().height>0;})[0];return v?Math.round(v.getBoundingClientRect().top):null;})()')
        r.ask(sid, 'document.getElementById("statusDot").classList.remove("on"); document.getElementById("statusText").textContent="Reconnecting"; true')
        time.sleep(0.3)
        bar2, top2 = rect(r, sid, '#vpConnBar'), rect(r, sid, '.ptop')
        below2 = r.ask(sid, '(function(){var v=[].filter.call(document.querySelectorAll(".view"),function(x){return !x.classList.contains("hidden")&&x.getBoundingClientRect().height>0;})[0];return v?Math.round(v.getBoundingClientRect().top):null;})()')
        txt = r.ask(sid, '(document.getElementById("vpConnBar")||{}).textContent')
        ok('%s at %d: Reconnecting: a slim bar right under the header, full width' % (label, w),
           bar2 and bar2['vis'] and abs(bar2['t'] - top2['b']) <= 2 and bar2['h'] <= 30 and bar2['w'] >= w - 2 and txt == 'Reconnecting…', [bar2, top2, txt])
        ok('%s at %d: and NOTHING moves: the header and the game below it stay where they were' % (label, w),
           top2['h'] == top['h'] and below == below2, [top['h'], top2['h'], below, below2])
        shot(r, sid, 'phone-%s-%d-reconnecting' % (label.split()[0], w))
        r.ask(sid, 'document.getElementById("statusDot").classList.add("on"); document.getElementById("statusText").textContent="Connected"; true')
        time.sleep(0.3)
        ok('%s at %d: back: the bar goes' % (label, w), not (rect(r, sid, '#vpConnBar') or {}).get('vis'))
        r.close_tab(tid)

# The host's voice on the TV's channel: the fake realtime carries messages by BroadcastChannel, so the
# test records the channel names the page opens and posts a message into them (as tv-and-phone does).
SAY = r'''(function(){ window.__bc=[]; var BC=window.BroadcastChannel;
  window.BroadcastChannel=function(n){ if(window.__bc.indexOf(n)<0) window.__bc.push(n); return new BC(n); };
  window.__say=function(m){ window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new BC(n); c.postMessage({event:"msg", payload:m}); c.close(); } }); return true; };
})();'''

def tv_name(r, sid):
    return r.ask(sid, RECT + '(document.getElementById("venueNameTag"))')

def main():
    if not take_lock():
        return 2
    import rig as RIG
    r = RIG.Rig()
    try:
        print('\nPHONES')
        phone_scene(r, '/play?room=' + r.W.info['code'], 'bingo play.html')
        phone_scene(r, '/app/trivia/play?room=' + r.W.info['code'], 'trivia play.html')
        phone_scene(r, '/app/musical/play?room=' + r.W.info['code'], 'musical play.html')

        print('\nTV, A VENUE WITH NO LOGO')
        venue_name = None
        for w, h in ((1920, 1080), (1280, 720)):
            tid, tv = r.open('/tv?venue=' + r.W.info['slug'], before=SAY, width=w, height=h)
            ok('the TV loads on the ads (%dx%d)' % (w, h), r.until(tv, '!!document.getElementById("venueNameTag") && document.getElementById("venueNameTag").textContent.length>0', 30) is True)
            venue_name = r.ask(tv, 'document.getElementById("venueNameTag").textContent')
            n = tv_name(r, tv)
            # A venue with no slides of its own is on the venueplay tv between-games card, and that card names the venue
            # top left like every other TV screen (Dean, 3 Nov 2026). Over the venue's own adverts it is still not painted.
            hold = r.ask(tv, '!!document.querySelector("#tvAds .ad.show .tvhold")') is True
            ok('on the venue\'s own advertising the name is NOT painted; on the between-games card it is, top left (%dx%d)' % (w, h),
               n is not None and (n['vis'] and n['l'] <= 40 and n['t'] <= 40 if hold else not n['vis']), [hold, n])
            shot(r, tv, 'tv-nologo-ads-%d' % w)
            r.ask(tv, 'window.__say && window.__say({t:"mode", mode:"bingo"}); true')
            ok('a bingo lobby goes on air (%dx%d)' % (w, h), r.until(tv, '(function(){var c=document.getElementById("tvCorner");return !!c && c.style.display!=="none" && document.getElementById("adsRoot").classList.contains("hidden");})()', 20) is True,
               r.ask(tv, 'document.getElementById("adsRoot").className'))
            time.sleep(1.8)   # vp-fit's safety tick
            n, corner = tv_name(r, tv), r.ask(tv, RECT + '(document.getElementById("tvCorner"))')
            ok('the venue name is painted, in plain text, top LEFT (%dx%d)' % (w, h),
               n and n['vis'] and n['l'] <= w * 0.05 and n['t'] <= h * 0.06 and n['r'] <= w * 0.45, n)
            ok('it is no longer in the venueplay corner on the right, and does not touch it (%dx%d)' % (w, h),
               r.ask(tv, '!document.querySelector("#tvCorner #venueNameTag")') is True and not overlap(n, corner), [n, corner])
            hits = r.ask(tv, '(function(){var n=document.getElementById("venueNameTag").getBoundingClientRect(),out=[];'
                             '[].forEach.call(document.querySelectorAll("#tv *"),function(e){if(e.id==="venueNameTag"||e.closest("#tvCorner")||e.closest("#adsRoot"))return;var s=getComputedStyle(e);if(s.display==="none"||s.visibility==="hidden"||+s.opacity===0)return;'
                             'if(e.children.length||!(e.textContent||"").trim())return;var q=e.getBoundingClientRect();if(q.width&&q.height&&q.left<n.right&&q.right>n.left&&q.top<n.bottom&&q.bottom>n.top)out.push((e.id||e.className||e.tagName)+":"+(e.textContent||"").trim().slice(0,24));});return out;})()')
            ok('nothing the wall paints sits under it (%dx%d)' % (w, h), hits == [], hits)
            shot(r, tv, 'tv-nologo-bingo-%d' % w)
            r.close_tab(tid)

        print('\nTRIVIA GAME SCREEN, NO LOGO (the screen the TV embeds)')
        # A game screen opened on its own bounces to /tv; the TV embeds it with this hop mark set.
        tid, sc = r.open('/app/trivia/screen?venue=' + r.W.info['slug'], before='sessionStorage.setItem("vpTvHop", %s);' % json.dumps(r.W.info['slug']), width=1920, height=1080)
        ok('the trivia screen names the venue top left', r.until(sc, '(function(){var e=document.getElementById("venueNameTag");return !!e&&!e.hidden&&e.textContent.length>0;})()', 30) is True)
        n = tv_name(r, sc)
        ok('top left, inside the screen, the same place tv.html paints it', n and n['vis'] and n['l'] <= 96 and n['t'] <= 65, n)
        ok('and not inside the corner any more', r.ask(sc, '!document.querySelector(".tv-corner #venueNameTag")') is True)
        shot(r, sc, 'trivia-screen-nologo-1920')
        r.close_tab(tid)

        print('\nTV, A VENUE WITH A LOGO')
        r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': r.W.info['slug'], 'logo_url': r.base + '/logos/venue-tugun-bowls.png', 'slides': [], 'raffle': None, 'name': venue_name}])
        tid, tv = r.open('/tv?venue=' + r.W.info['slug'], before=SAY, width=1920, height=1080)
        r.until(tv, '!!document.getElementById("venueLogo")', 30)
        r.until(tv, '(function(v){return !v||v==="done";})(document.documentElement.getAttribute("data-tvi"))', 8)   # the intro brings the logo in at 2.3 s
        r.ask(tv, 'window.__say && window.__say({t:"mode", mode:"bingo"}); true')
        r.until(tv, 'document.getElementById("adsRoot").classList.contains("hidden")', 20)
        time.sleep(1.8)
        logo, n = r.ask(tv, RECT + '(document.getElementById("venueLogo"))'), tv_name(r, tv)
        ok('the logo is top left in a game', logo and logo['vis'] and logo['l'] <= 40 and logo['t'] <= 40, logo)
        ok('and the name is NOT painted beside it: one or the other, never both', not (n or {}).get('vis'), n)
        shot(r, tv, 'tv-logo-bingo-1920')
        r.close_tab(tid)

        print('\nTV WITH NO VENUE: "Set up this screen" (live screenshot run, 1 Nov 2026)')
        for w, h in ((1920, 1080), (1280, 720)):
            tid, tv = r.open('/tv', width=w, height=h)
            ok('the setup panel is up (%dx%d)' % (w, h), r.until(tv, '(function(){var p=document.getElementById("pairPanel");return !!p&&!p.classList.contains("hidden")&&p.getBoundingClientRect().height>0;})()', 30) is True)
            time.sleep(1.5)
            info = r.ask(tv, '(function(){var p=document.getElementById("pairPanel"),m=p.querySelector(".bvmark"),svg=m&&m.querySelector("svg[data-vp-mark=tv-word]"),b=p.getBoundingClientRect(),sb=svg?svg.getBoundingClientRect():null,'
                             'bg=getComputedStyle(p).backgroundColor;return {wm:!!svg&&sb.width>60&&sb.height>10,oldWord:/VENUEPLAY/.test(m?m.innerText:""),oldTri:!!(m&&m.querySelector("path[stroke]")),'
                             'spanText:m?[].map.call(m.querySelectorAll("span"),function(x){return x.textContent;}).join("|"):"",scroll:p.scrollHeight-p.clientHeight,hscroll:p.scrollWidth-p.clientWidth,'
                             'inside:b.top>=0&&b.left>=0&&b.bottom<=innerHeight&&b.right<=innerWidth,bg:bg,box:[Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]};})()') or {}
            ok('the venueplay tv lockup (3 Nov 2026) heads the panel, not the triangle over a spaced uppercase VENUEPLAY (%dx%d)' % (w, h),
               info.get('wm') and not info.get('oldWord') and not info.get('oldTri') and info.get('spanText') == '', info)
            ok('no scrollbar: everything fits inside the panel (%dx%d)' % (w, h), info.get('scroll', 9) <= 0 and info.get('hscroll', 9) <= 0, info)
            ok('and the panel is inside the screen (%dx%d)' % (w, h), info.get('inside') is True, info)
            ok('nothing shows through it: the panel is solid (%dx%d)' % (w, h), info.get('bg') in ('rgb(10, 10, 11)',), info.get('bg'))
            gp = r.ask(tv, '(function(){var a=document.getElementById("tvPlayLink"),w=document.getElementById("suApp"),b=a.getBoundingClientRect(),c=w.getBoundingClientRect(),i=a.querySelector("img");var ib=i?i.getBoundingClientRect():b;'
                           'return {inCard:ib.left>=c.left-1&&ib.right<=c.right+1&&ib.top>=c.top-1&&ib.bottom<=c.bottom+1,img:[Math.round(ib.left),Math.round(ib.top),Math.round(ib.right),Math.round(ib.bottom)],card:[Math.round(c.left),Math.round(c.top),Math.round(c.right),Math.round(c.bottom)]};})()') or {}
            ok('the Google Play badge sits inside its own card (%dx%d)' % (w, h), gp.get('inCard') is True, gp)
            shot(r, tv, 'tv-setup-panel-%d' % w)
            r.close_tab(tid)

        print('\nTHE BINGO TV DEMO (/tv?demo=1)')
        QR = r'''(function(){ window.__qr=[]; var v; Object.defineProperty(window,"VPQR",{configurable:true,get:function(){return v;},set:function(x){ v=x; if(x&&x.draw){ var d=x.draw; x.draw=function(el,url){ if(el && (el.id==="qrBig"||el.id==="qrMini")) window.__qr.push(String(url)); return d.apply(this,arguments); }; } }}); })();'''
        tid, tv = r.open('/tv?demo=1', before=QR, width=1280, height=720)
        ok('the demo lobby is up', r.until(tv, '(function(){var c=document.getElementById("lobbyCode");return !!c&&c.textContent.length===6;})()', 20) is True)
        code = r.ask(tv, 'document.getElementById("lobbyCode").textContent')
        ok('the lobby shows the demo\'s own code, one the code alphabet allows (not a code this browser invented)', code == 'VENUE2', code)
        qrs = r.ask(tv, 'window.__qr') or []
        ok('every QR on the wall (lobby and join corner) opens the demo phone, never a room', len(qrs) > 0 and all(q.endswith('/play?demo=1') for q in qrs), qrs)
        shot(r, tv, 'tv-demo-lobby-1280')
        ok('the demo plays to a winner', r.until(tv, '(function(){var w=document.getElementById("tvWin");return !!w&&!w.classList.contains("hidden")&&w.getBoundingClientRect().height>0;})()', 60) is True)
        time.sleep(0.6)
        sub = r.ask(tv, 'document.getElementById("winSubPhone").innerText')
        ok('the winner screen names a believable card, never "#000"', sub and '#000' not in sub and 'Card #47' in sub, sub)
        shot(r, tv, 'tv-demo-winner-1280')
        r.close_tab(tid)
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
