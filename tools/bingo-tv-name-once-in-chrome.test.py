#!/usr/bin/env python3
"""THE BINGO TV LOBBY NAMES THE VENUE ONCE (Dean via main INBOX 425, 16 Nov 2026: 'Test Alpha' top left AND 'at Test Alpha'
under the join code).

Rule (memory tv-top-row-branding-ok): a venue with NO logo has its name top left, once per screen, never twice. A venue
WITH a logo has the logo top left (no name caption there) and keeps its "at <venue>" line under the code, so the venue is
still named in words. Trivia and musical bingo have no "at" line, so this is bingo's /tv only.

On the browser rig (the repo's pages, the real game Worker in jsc, headless Chrome), a normal bingo lobby put on air by
the real console, /tv at 1280x720 and 1920x1080, a venue with no logo, then one with a logo:
  no logo: the name is on the wall exactly once (top left); the "at" line is not shown
  logo:    the logo is top left, no name caption, and "at <venue>" reads under the code
VP_SHOTS=<dir> saves a frame of each.

    python3 tools/bingo-tv-name-once-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


# Everything a person can see on the wall: name tag, "at" lines, the logo, and every visible text node that holds the name.
PROBE = r'''(function(name){
  function vis(e){ var s=getComputedStyle(e), b=e.getBoundingClientRect(); var p=e; while(p&&p!==document.body){ var ps=getComputedStyle(p); if(ps.display==="none"||ps.visibility==="hidden"||p.hidden||p.classList.contains("hidden")) return false; p=p.parentElement; } return s.display!=="none"&&s.visibility!=="hidden"&&s.opacity!=="0"&&b.width>0&&b.height>0; }
  var lobby=document.getElementById("tvLobby"), lobbyOn=!!lobby&&vis(lobby);
  var tag=document.getElementById("venueNameTag"), at=document.getElementById("lobbyAt"), lg=document.getElementById("venueLogo");
  var hits=[], w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(w.nextNode()){ var n=w.currentNode; if(n.nodeValue.toLowerCase().indexOf(name.toLowerCase())>=0 && n.parentElement && vis(n.parentElement) && !/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) hits.push(n.parentElement.id||n.parentElement.className||n.parentElement.tagName); }
  return JSON.stringify({lobbyOn:lobbyOn, tag:tag&&vis(tag)?tag.textContent:null, tagBox:tag&&vis(tag)?[tag.getBoundingClientRect().left,tag.getBoundingClientRect().top]:null,
    at:at&&vis(at)?at.textContent:null, logo:lg&&vis(lg)&&lg.naturalWidth>0, hits:hits});
})'''


def start_lobby(r, host):
    r.ask(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    r.until(host, '!document.getElementById("setupBlock").classList.contains("hidden")')
    time.sleep(1.5)
    r.ask(host, 'document.getElementById("prizeInput").value="Meat tray"; document.getElementById("prizeInput").dispatchEvent(new Event("input")); true')
    for _ in range(2):
        r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(1.2)
        if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
            r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(1.5)


def scene(r, logo, w, h):
    tag = '%s %dx%d' % ('logo' if logo else 'no logo', w, h)
    slug = r.W.info['slug']
    r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': slug, 'slides': [], 'raffle': None,
                                  'logo_url': (r.base + '/logos/venueplay_primary_dark.png') if logo else ''}], replace=True)
    _, tv = r.open('/tv?venue=' + slug, width=w, height=h)   # the TV is on first, as in a pub: it hears the lobby open
    r.until(tv, '!!document.getElementById("adsRoot")', 20)
    time.sleep(1.5)
    _, host = r.open('/app/', width=1280, height=900)
    ok('%s: the console loads on the games menu' % tag, r.until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 25) is True)
    start_lobby(r, host)
    up = r.until(tv, '(function(){var e=document.getElementById("tvLobby");return !!e&&!e.classList.contains("hidden")&&getComputedStyle(e).display!=="none"&&!!document.getElementById("lobbyAtName").textContent;})()', 40)
    dbg = ''
    if up is not True:
        dbg = [r.ask(tv, '[].map.call(document.querySelectorAll(".layer,#adsRoot"),function(e){return e.id+":"+(e.classList.contains("hidden")?"h":"v")+getComputedStyle(e).display}).join()'), r.ask(tv, 'document.getElementById("lobbyAtName").textContent'),
               r.ask(host, 'document.getElementById("startBtn").textContent+"|"+(document.body.innerText||"").slice(0,300)')]
        if SHOTS: r.shot(host, os.path.join(SHOTS, 'dbg-host.jpg'))
    ok('%s: the bingo lobby is on the TV' % tag, up is True, dbg or up)
    time.sleep(9)   # the start show (a blurred splash) is over before the wall is judged or framed
    name = r.ask(tv, 'document.getElementById("lobbyAtName").textContent') or ''
    ok('%s: the venue has a name to show' % tag, len(name) > 2, name)
    s = (r.json(tv, PROBE + '(%s)' % json.dumps(name), {}) or {})
    for _ in range(20):   # the logo fades in after the start show
        if not logo or s.get('logo'): break
        time.sleep(1); s = (r.json(tv, PROBE + '(%s)' % json.dumps(name), {}) or {})
    if SHOTS: r.shot(tv, os.path.join(SHOTS, 'bingo-lobby-%s-%dx%d.jpg' % ('logo' if logo else 'nologo', w, h)))
    if not logo:
        ok('%s: the name is on the wall exactly once' % tag, len(s.get('hits', [])) == 1, s)
        ok('%s: and it is top left, the name tag' % tag, s.get('tag') == name and s.get('tagBox') and s['tagBox'][1] < h * 0.2 and s['tagBox'][0] < w * 0.2, s)
        ok('%s: no "at <venue>" line under the code' % tag, s.get('at') is None, s)
    else:
        ok('%s: the logo is up top left' % tag, s.get('logo') is True, s)
        ok('%s: no name caption beside the logo' % tag, s.get('tag') is None, s)
        ok('%s: "at <venue>" reads under the code' % tag, (s.get('at') or '').replace(' ', ' ').strip() == 'at ' + name, s)
    ok('%s: no script errors on /tv' % tag, r.ask(tv, 'window.__errs.length') == 0, r.ask(tv, 'JSON.stringify(window.__errs)'))


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('bingo-tv-name-once-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    global bad
    try:
        for logo in (False, True):
            for (w, h) in ((1280, 720), (1920, 1080)):
                r = RIG.Rig()
                try:
                    print('\n%s %dx%d' % ('logo' if logo else 'no logo', w, h))
                    scene(r, logo, w, h)
                finally:
                    r.close()
    except Exception:
        import traceback; traceback.print_exc(); bad += 1
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
