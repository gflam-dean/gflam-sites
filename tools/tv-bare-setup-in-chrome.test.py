#!/usr/bin/env python3
"""BARE /tv IS THE SETUP SCREEN, IN ANY BROWSER (live fault, Dean, 1 Nov 2026, about 9pm).

Our emails send a new venue to venueplay.com.au/tv. On the live site, in Dean's Chrome, bare /tv put a
sample pub's advertising wall up full screen ("Indypendent Hotel / Tuesday Parmy Night", a prospect's
slides) with no setup panel at all: the page remembered the last venue that browser had opened
(localStorage vpTvVenue) and showed it as though this screen were that pub's.

This opens the REAL tv.html in headless Chrome (tools/browser-rig/rig.py: the repo's pages, the real game
Worker in jsc, supabase-js stood in) and checks, at 1920x1080 and 1280x720:
  CLEAN    a browser that has never opened a venue: the setup panel, the lowercase venueplay tv lockup,
           no advertising painted, no scrollbar.
  MEMORY   the same browser after it HAS shown a venue's screen (with slides): bare /tv is still the
           setup panel and paints none of that venue's slides, and it does NOT offer that venue (no "last used
           for", no "Show it again": Dean, 2 Nov 2026, a venue puts its screen code in again).
  HOST     with a host console signed in, in another window of the same browser: the same.
  CONTROL  /tv?venue=<slug> still shows the venue's advertising and no panel.
  PAIRED   (5 Nov 2026, Dean: "I don't want them to ask for the code again on the TV, no way") the venue
           this screen was set up for BY ITS OWN SCREEN CODE (localStorage vpTvPaired, /app/vp-tvpaired.js):
           (a) code typed on the setup card, then bare /tv opens that venue, no code asked;
           (b) /tv?venue=<another> in the same browser never becomes what bare /tv shows;
           (c) Change venue (hold OK for 5 s) forgets it and bare /tv is the setup card again;
           (d) ?demo=1 is untouched by it; (e) a paired venue that no longer exists is forgotten
           after the Worker's two strikes.
  GET APP  (Dean, 5 Nov 2026) bare /tv opening the paired venue on a Google TV browser puts up the "get
           the venueplay TV app" corner card for about 25 s of advertising, clear of the join code, the
           logo and the corner; never on a PC, inside the app, in a demo, or over a game.

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
        'var m=p.querySelector(".bvmark svg[data-vp-mark=tv-word]"),mb=m?m.getBoundingClientRect():null;'
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
    ok('%s (%dx%d): headed by the lowercase "venueplay tv" lockup (3 Nov 2026), never an uppercase VENUEPLAY' % (label, w, h), v.get('wordmark') and not v.get('oldWord'), v)
    ok('%s (%dx%d): no advertising painted behind it, and no sample pub anywhere' % (label, w, h),
       not v.get('adsShown') and not v.get('painted') and not v.get('sample'), [v.get('adsShown'), v.get('painted'), v.get('sample')])
    ok('%s (%dx%d): it offers no remembered venue: no "last used for", no "Show it again", no link to a venue\'s screen' % (label, w, h),
       not v.get('offer') and not v.get('named'), [v.get('offer'), v.get('named')])
    ok('%s (%dx%d): "Put in the screen code" is on the card, so the venue keys its code in again' % (label, w, h), v.get('code') is True, v.get('code'))
    if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-bare-%s-%d.jpg' % (label.split()[0].lower(), w)))
    return v

PAIRED_SAY = (r"""(function(){var BC=window.BroadcastChannel;if(!BC)return;window.__bc=[];"""
              r"""window.BroadcastChannel=function(n){if(window.__bc.indexOf(n)<0)window.__bc.push(n);return new BC(n);};"""
              r"""window.__say=function(m){window.__bc.forEach(function(n){if(n.indexOf("fake-rt:")===0){var c=new BC(n);c.postMessage({event:"msg",payload:m});c.close();}});return true;};})();""")
GOOGLE_TV = 'Mozilla/5.0 (Linux; Android 12; Chromecast HD Build/STTE.230319.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 Android TV'
def ua_before(ua):
    return "(function(){var ua=%s;Object.defineProperty(Navigator.prototype,'userAgent',{get:function(){return ua;},configurable:true});})();" % json.dumps(ua)
PAIRED_KEY = 'localStorage.getItem("vpTvPaired")'
def paired_slug(r, sid):
    v = r.ask(sid, '(function(){try{return JSON.parse(localStorage.getItem("vpTvPaired")||"null");}catch(e){return "BAD";}})()')
    return v.get('slug') if isinstance(v, dict) else v
SHOWING = ('(function(){var p=document.getElementById("pairPanel"),a=document.getElementById("adsRoot"),k=document.getElementById("venuePick");'
           'return {search:location.search,panel:!!p&&!p.classList.contains("hidden")&&getComputedStyle(p).display!=="none",'
           'sample:a.textContent.indexOf(%s)>=0&&getComputedStyle(a).display!=="none",picker:!!k&&!k.classList.contains("hidden"),demo:document.documentElement.getAttribute("data-vp-demo")};})()' % json.dumps(SAMPLE))
APPCARD = ('(function(){function r(id){var e=document.getElementById(id);if(!e)return null;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return (s.display==="none"||s.visibility==="hidden"||b.width<=0||e.classList.contains("hidden"))?null:{l:b.left,t:b.top,r:b.right,b:b.bottom};}'
           'function hit(a,b){return !!a&&!!b&&!(a.r<=b.l||a.l>=b.r||a.b<=b.t||a.t>=b.b);}'
           'var c=r("vpGetApp"),e=document.getElementById("vpGetApp");'
           'return {shown:!!c,store:e?e.getAttribute("data-store"):null,text:e?e.innerText:"",rect:c,'
           'row:(function(){if(!e)return false;var q=e.querySelector("canvas"),t=e.lastElementChild;if(!q||!t)return false;var qb=q.getBoundingClientRect(),tb=t.getBoundingClientRect();return qb.right<=tb.left&&qb.width>40&&qb.width<innerWidth*0.15;})(),'
           'right:!!c&&c.r>innerWidth*0.6&&c.b>innerHeight*0.6&&c.r<=innerWidth&&c.b<=innerHeight,'
           'hits:["tvJoinCorner","venueLogo","tvCorner","venueNameTag","qrMini"].filter(function(id){return hit(c,r(id));})};})()')

def type_code(r, sid, code):
    """The setup card's own keypad, a key at a time, as a remote presses it."""
    r.ask(sid, 'document.getElementById("tvSetupCode").click(); true')
    if r.until(sid, '!!document.querySelector("#vpList a[data-ck]")', 10) is not True:
        return False
    for ch in code:
        r.ask(sid, '(function(){var a=document.querySelector(%s);if(a)a.click();return !!a;})()' % json.dumps('#vpList a[data-ck="%s"]' % ch))
        time.sleep(0.25)
    return True

def hold_ok(r, sid, secs=5.6):
    """OK on a remote is Enter. Held: the TV's own key repeat, as Chrome sends it."""
    base = {'key': 'Enter', 'code': 'Enter', 'windowsVirtualKeyCode': 13, 'nativeVirtualKeyCode': 13}
    r.B.call('Input.dispatchKeyEvent', dict(base, type='rawKeyDown'), session=sid)
    t = time.time() + secs
    while time.time() < t:
        time.sleep(0.4)
        r.B.call('Input.dispatchKeyEvent', dict(base, type='rawKeyDown', autoRepeat=True), session=sid)
    r.B.call('Input.dispatchKeyEvent', dict(base, type='keyUp'), session=sid)

def paired_scenes(r, slug, code):
    print('\nPAIRED (a): the screen code typed on this screen\'s setup card, then bare /tv again')
    tid, sid = r.open('/tv', width=1920, height=1080)
    r.until(sid, '(function(){var p=document.getElementById("pairPanel");return !!p&&!p.classList.contains("hidden");})()', 20)
    ok('PAIRED (a) CONTROL: before any code, this browser holds no pairing (an earlier /tv?venue= visit wrote none)', r.ask(sid, PAIRED_KEY) is None, r.ask(sid, PAIRED_KEY))
    ok('PAIRED (a) CONTROL: the keypad takes the code', type_code(r, sid, code))
    ok('PAIRED (a): the Worker confirms the code and this screen remembers it as paired (vpTvPaired = that venue)',
       r.until(sid, '(function(){try{return JSON.parse(localStorage.getItem("vpTvPaired")).slug===%s;}catch(e){return false;}})()' % json.dumps(slug), 15) is True,
       [r.ask(sid, PAIRED_KEY), r.ask(sid, 'document.getElementById("vpList").innerText.slice(0,160)')])
    set_card = r.until(sid, '(function(){var t=document.getElementById("vpTitle");return t&&t.textContent==="This screen is set"&&document.getElementById("venuePick").innerText;})()', 10)
    ok('PAIRED (a): "This screen is set" gives plain venueplay.com.au/tv and the screen code for other screens, never the ?venue=<slug> form (Dean, 5 Nov 2026)',
       isinstance(set_card, str) and 'venueplay.com.au/tv' in set_card and 'screen code' in set_card and '/tv?' not in set_card and slug not in set_card.lower(), set_card)
    r.close_tab(tid)
    tid, sid = r.open('/tv', width=1920, height=1080)
    ok('PAIRED (a): bare /tv now opens that venue\'s screen straight away: its advertising, no setup panel, no keypad',
       r.until(sid, '(function(v){return v.sample&&!v.panel&&!v.picker;})(%s)' % SHOWING, 25) is True, r.ask(sid, SHOWING))
    v = r.ask(sid, SHOWING) or {}
    ok('PAIRED (a): on the ordinary venue address, so the screen is the /tv?venue= one', isinstance(v, dict) and ('venue=' + slug) in (v.get('search') or ''), v)
    if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-bare-paired-a-1920.jpg'))
    r.close_tab(tid)

    print('\nPAIRED (b): another venue\'s screen opened in the same browser (a prospect\'s slides, View as)')
    tid, sid = r.open('/tv?venue=other-venue', width=1280, height=720)
    r.until(sid, 'document.readyState==="complete"', 15); time.sleep(2)
    ok('PAIRED (b) CONTROL: that visit is remembered as the last venue opened (vpTvVenue), as before', r.ask(sid, 'localStorage.getItem("vpTvVenue")') == 'other-venue', r.ask(sid, 'localStorage.getItem("vpTvVenue")'))
    ok('PAIRED (b): and it does not touch the pairing', paired_slug(r, sid) == slug, r.ask(sid, PAIRED_KEY))
    r.close_tab(tid)
    tid, sid = r.open('/tv', width=1920, height=1080)
    ok('PAIRED (b): bare /tv still opens the PAIRED venue, never other-venue',
       r.until(sid, '(function(v){return v.sample&&!v.panel&&v.search.indexOf("venue="+%s)>=0;})(%s)' % (json.dumps(slug), SHOWING), 25) is True
       and 'other-venue' not in (r.ask(sid, 'location.search') or ''), r.ask(sid, SHOWING))
    r.close_tab(tid)

    print('\nPAIRED (d): ?demo=1 in a browser that is paired')
    tid, sid = r.open('/tv?demo=1', width=1280, height=720)
    r.until(sid, 'document.readyState==="complete"', 15); time.sleep(3)
    v = r.ask(sid, SHOWING) or {}
    ok('PAIRED (d): the demo stays the demo: its own address, data-vp-demo, none of the paired venue\'s slides',
       isinstance(v, dict) and v.get('search') == '?demo=1' and v.get('demo') == '1' and not v.get('sample'), v)
    ok('PAIRED (d): and the pairing is untouched', paired_slug(r, sid) == slug, r.ask(sid, PAIRED_KEY))
    r.close_tab(tid)

    print('\nGET APP: bare /tv opening the paired venue, by kind of screen')
    tid, sid = r.open('/tv', before=PAIRED_SAY, width=1920, height=1080)
    r.until(sid, '(function(v){return v.sample;})(%s)' % SHOWING, 25); time.sleep(4)
    ok('GET APP: a laptop or PC browser is not offered the app', (r.ask(sid, APPCARD) or {}).get('shown') is False, r.ask(sid, APPCARD))
    r.close_tab(tid)
    tid, sid = r.open('/tv', before=ua_before(GOOGLE_TV.replace('Android TV', 'Android TV VenuePlayTV/1.4')), width=1920, height=1080)
    r.until(sid, '(function(v){return v.sample;})(%s)' % SHOWING, 25); time.sleep(4)
    ok('GET APP: inside the venueplay TV app it never shows', (r.ask(sid, APPCARD) or {}).get('shown') is False, r.ask(sid, APPCARD))
    r.close_tab(tid)
    # The LG and Samsung apps say so in the address (&app=webos|tizen, /app/vp-tvapp.js), and their TV is one whose own
    # store will carry the app: the day LG's address is in VPTvType.STORES, an LG TV in the LG app is exactly this case.
    # A Google TV browser's kind (store live today) inside an app: only the in-app rule keeps the card off.
    tid, sid = r.open('/tv?app=webos&appv=1.0.0', before=ua_before(GOOGLE_TV), width=1920, height=1080)
    ok('GET APP CONTROL: a TV app opening bare /tv still lands on its paired venue, and the page knows it is in the app',
       r.until(sid, '(function(v){return v.sample&&!!window.VP_TV_APP;})(%s)' % SHOWING, 25) is True, r.ask(sid, SHOWING))
    time.sleep(4)
    ok('GET APP: a TV whose store has the app, inside the app (LG or Samsung address), is never told to get it',
       (r.ask(sid, APPCARD) or {}).get('shown') is False, r.ask(sid, APPCARD))
    r.close_tab(tid)
    tid, sid = r.open('/tv?demo=1', before=ua_before(GOOGLE_TV), width=1920, height=1080)
    r.until(sid, 'document.readyState==="complete"', 15); time.sleep(4)
    ok('GET APP: a demo on a Google TV is not offered it', (r.ask(sid, APPCARD) or {}).get('shown') is False and r.ask(sid, 'location.search') == '?demo=1', r.ask(sid, APPCARD))
    r.close_tab(tid)
    tid, sid = r.open('/tv', before=ua_before(GOOGLE_TV) + PAIRED_SAY, width=1920, height=1080)
    ok('GET APP: a Google TV browser gets the "get the venueplay TV app" card over the paired venue\'s advertising',
       r.until(sid, '(function(v){return v.shown;})(%s)' % APPCARD, 25) is True, r.ask(sid, APPCARD))
    t0 = time.time()
    c = r.ask(sid, APPCARD) or {}
    ok('GET APP: it names Google Play, the one store with a live address, and says what it does',
       c.get('store') == 'play' and 'Get the venueplay TV app on Google Play' in (c.get('text') or '') and 'opens your venue on its own' in (c.get('text') or ''), c)
    ok('GET APP: bottom right, inside the wall, clear of the join code and QR, the venue logo and the corner', c.get('right') is True and not c.get('hits'), c)
    ok('GET APP: laid out as one card: the scan code beside the words, a scannable size, not stretched across it', c.get('row') is True, c)
    if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-bare-getapp-googletv-1920.jpg'))
    time.sleep(max(0, 18 - (time.time() - t0)))
    ok('GET APP: still up after about 18 s', (r.ask(sid, APPCARD) or {}).get('shown') is True, r.ask(sid, APPCARD))
    ok('GET APP: gone by about 30 s, by itself', r.until(sid, '(function(v){return !v.shown;})(%s)' % APPCARD, max(1, 33 - (time.time() - t0))) is True, r.ask(sid, APPCARD))
    gone_at = time.time() - t0
    ok('GET APP: on the wall for about 25 s, not 3 and not 60', 20 <= gone_at + 1 <= 33, '%.1f s' % gone_at)
    r.close_tab(tid)
    tid, sid = r.open('/tv', before=ua_before(GOOGLE_TV) + PAIRED_SAY, width=1920, height=1080)
    r.until(sid, '(function(v){return v.sample;})(%s)' % SHOWING, 25)
    r.ask(sid, 'window.__say({t:"mode",mode:"bingo",caller:false})')
    time.sleep(0.4)
    r.ask(sid, 'window.__say({t:"state",pattern:"one",prize:"Bar tab",called:[],active:false,caller:false,join_code:%s})' % json.dumps(code))
    lob = r.until(sid, '(function(){var l=document.getElementById("tvLobby");return !!l&&getComputedStyle(l).display!=="none"&&l.getBoundingClientRect().width>0&&!l.classList.contains("hidden");})()', 8)
    ok('GET APP CONTROL: the host has taken the wall for a game (the lobby is up)', lob is True, r.ask(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
    time.sleep(3)
    ok('GET APP: never over a game: no card while the lobby is up', (r.ask(sid, APPCARD) or {}).get('shown') is False, r.ask(sid, APPCARD))
    r.ask(sid, 'window.__say({t:"to_ads"})')
    ok('GET APP: and it comes up once the advertising is back',
       r.until(sid, '(function(v){return v.shown;})(%s)' % APPCARD, 12) is True, r.ask(sid, APPCARD))
    r.close_tab(tid)

    print('\nPAIRED (c): staff hold OK for five seconds and press Change venue')
    tid, sid = r.open('/tv', width=1920, height=1080)
    r.until(sid, '(function(v){return v.sample;})(%s)' % SHOWING, 25); time.sleep(1)
    hold_ok(r, sid)
    st = r.until(sid, '(function(){var p=document.getElementById("vpStaffSettings");return !!p&&p.innerText;})()', 4)
    ok('PAIRED (c): holding OK opens Screen settings, naming the venue, with Change venue on it',
       isinstance(st, str) and 'Screen settings' in st and 'Change venue' in st and 'Test Alpha' in st, st)
    if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-bare-paired-c-settings-1920.jpg'))
    r.ask(sid, 'document.getElementById("vpStaffChange").click(); true')
    ok('PAIRED (c): Change venue opens the setup card on bare /tv',
       r.until(sid, '(function(v){return v.panel&&!v.sample&&v.search==="";})(%s)' % SHOWING, 15) is True, r.ask(sid, SHOWING))
    ok('PAIRED (c): and the pairing is forgotten', r.ask(sid, PAIRED_KEY) is None, r.ask(sid, PAIRED_KEY))
    r.close_tab(tid)
    tid, sid = r.open('/tv', width=1280, height=720)
    look(r, sid, 1280, 720, 'UNPAIRED', names=(slug, SAMPLE))
    r.close_tab(tid)

    print('\nPAIRED (e): the paired venue no longer exists (closed, or its address changed)')
    tid, sid = r.open('/__blank')
    r.until(sid, 'document.readyState==="complete"', 10)
    r.ask(sid, 'localStorage.setItem("vpTvPaired", JSON.stringify({slug:"gone-venue-test-0511",at:Date.now()})); true')
    r.close_tab(tid)
    tid, sid = r.open('/tv', width=1280, height=720)
    ok('PAIRED (e) CONTROL: bare /tv first tries the venue it was paired to',
       r.until(sid, 'location.search.indexOf("venue=gone-venue-test-0511")>=0', 15) is True, r.ask(sid, 'location.search'))
    r.until(sid, '!!document.querySelector("#tvAds .ad.show")', 15); time.sleep(1.5)
    wall = r.ask(sid, 'document.body.innerText') or ''
    foot = r.ask(sid, '[].map.call(document.querySelectorAll("#tvAds .ad.show .adhelp:not(.sup)"),function(e){return e.textContent;})') or []
    # the rig serves the site from 127.0.0.1:<port>, so the foot reads "<host>/tv" here and venueplay.com.au/tv live
    ok('PAIRED (e): while it checks, the wall never prints the venue\'s ?<slug> address, only <site>/tv at the foot (Dean, 5 Nov 2026)',
       isinstance(wall, str) and 'gone-venue-test-0511' not in wall and '/tv?' not in wall
       and isinstance(foot, list) and len(foot) >= 1 and all(f.endswith('/tv') for f in foot), [foot, wall[-200:]])
    ok('PAIRED (e): after the Worker says twice that it does not exist, the pairing is forgotten',
       r.until(sid, 'localStorage.getItem("vpTvPaired")===null', 80) is True, r.ask(sid, PAIRED_KEY))
    bad = r.until(sid, '(function(){var b=document.getElementById("badVenue");return !!b&&!b.classList.contains("hidden")&&b.innerText;})()', 5)
    ok('PAIRED (e): the "Not linked to an account" card says open venueplay.com.au/tv and type the screen code, with no ?<slug> address on it',
       isinstance(bad, str) and 'not linked to an account' in bad.lower() and 'venueplay.com.au/tv' in bad and 'type the screen code' in bad
       and '/tv?' not in bad and 'gone-venue-test-0511' not in bad and 'setup email' not in bad, bad)
    if SHOTS: r.shot(sid, os.path.join(SHOTS, 'tv-bare-paired-e-notlinked-1280.jpg'))
    r.close_tab(tid)
    tid, sid = r.open('/tv', width=1280, height=720)
    ok('PAIRED (e): so bare /tv is the setup card again, not the dead venue',
       r.until(sid, '(function(v){return v.panel&&v.search==="";})(%s)' % SHOWING, 20) is True, r.ask(sid, SHOWING))
    r.close_tab(tid)

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
        ok('a /tv?venue= visit is NOT a pairing: vpTvPaired stays unwritten (5 Nov 2026)', r.ask(sid, 'localStorage.getItem("vpTvPaired")') is None,
           r.ask(sid, 'localStorage.getItem("vpTvPaired")'))
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

        paired_scenes(r, slug, r.W.info['code'])
    finally:
        r.close()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
