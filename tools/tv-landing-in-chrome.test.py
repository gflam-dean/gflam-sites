#!/usr/bin/env python3
"""VENUEPLAY.COM.AU/TV BEFORE A VENUE IS CHOSEN, AND THE "SAVE THIS PAGE" NOTE, IN A REAL BROWSER
(Dean, 31 Oct 2026).

"maybe we should do venueplay.com.au/tv as it has a link to the app download for Google play and
also has a option to enter your code and then when it goes to the TV channel itself if they enter
their code it says save this link so you don't have to enter the code every time".

LOOKED AT, not read. Each scene opens the real venueplay/tv.html in headless Chrome at a TV's size
(1280 x 720), on the repo's own pages with the REAL game Worker in jsc behind them
(tools/browser-rig/rig.py), and judges what is painted:

  1. /tv with no venue: the "Set up this screen" card is on the wall; "Got a TV with Google Play?
     Get the VenuePlay TV app" at TV size; the Get it on Google Play badge is a real link to the
     app's store page, on screen and not covered, drawn in CSS (no image); "Put in the screen code"
     opens the same keypad as ever (29 keys, Delete, Go back) and Go back closes it
  2. the code typed on that keypad: the screen is set, Start now, and the venue screen shows "Save
     this page as a bookmark or favourite so this TV opens straight to Test Alpha next time:
     venueplay.com.au/tv?<slug>", at the top over the venue's own ads; any key closes it; a reload
     does not bring it back
  3. it goes by itself after twenty seconds
  4. it goes the moment a game takes the wall (it never sits over game content)
  5. a TV opened straight at /tv?venue=<slug> never shows it, nor does one carrying a code for a
     different venue
  6. inside the VenuePlay TV app (its WebView adds "VenuePlayTV/" to the user agent): no note, and
     the no-venue card drops the "get the app" half but keeps the code

    python3 tools/tv-landing-in-chrome.test.py            screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
PLAY = 'https://play.google.com/store/apps/details?id=au.com.venueplay.tv'
W, H = 1280, 720
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:300]))
    if not cond:
        bad += 1


def shot(r, sid, name):
    if SHOTS:
        r.shot(sid, os.path.join(SHOTS, name + '.jpg'))


VISIBLE = ('(function(id){var e=document.getElementById(id);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')


def vis(i):
    return VISIBLE + '(%s)' % json.dumps(i)


# Is the element on the wall, inside the screen, and is it what a press at its middle lands on?
ON_TOP = ('(function(id){var e=document.getElementById(id);if(!e)return "missing";var b=e.getBoundingClientRect();'
          'if(!(b.width>0&&b.height>0))return "no size";'
          'if(b.left<0||b.top<0||b.right>innerWidth||b.bottom>innerHeight)return "off screen "+JSON.stringify([b.left,b.top,b.right,b.bottom]);'
          'var t=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return (t===e||e.contains(t))?true:("covered by "+(t&&(t.id||t.className||t.tagName)));})')


def on_top(i):
    return ON_TOP + '(%s)' % json.dumps(i)


def words(r, sid, id_):
    return r.ask(sid, '(function(){var e=document.getElementById(%s);return e?e.innerText.replace(/\\s+/g," ").trim():null;})()' % json.dumps(id_))


# The realtime stand-in's channels are recorded so the test can speak as the host (as tv-and-phone does).
SAY = r'''(function(){
  window.__bc=[]; var BC=window.BroadcastChannel;
  window.BroadcastChannel=function(n){ if(window.__bc.indexOf(n)<0) window.__bc.push(n); return new BC(n); };
  window.__say=function(m){ window.__bc.forEach(function(n){ if(n.indexOf("fake-rt:")===0){ var c=new BC(n); c.postMessage({event:"msg", payload:m}); c.close(); } }); return true; };
})();'''
IN_APP = ("(function(){var ua=navigator.userAgent+' VenuePlayTV/1.0';"
          "Object.defineProperty(Navigator.prototype,'userAgent',{get:function(){return ua;},configurable:true});})();")


def flag(r, sid, slug, name='Test Alpha'):
    """What a code accepted on the keypad leaves for the venue screen (tv.html cameByCode), set by hand."""
    return r.ask(sid, 'sessionStorage.setItem("vpTvByCode", JSON.stringify({slug:%s,name:%s,at:Date.now()})); true' % (json.dumps(slug), json.dumps(name)))


def reload_and_wait(r, sid):
    r.ask(sid, 'setTimeout(function(){location.reload();},0); true')
    time.sleep(1.0)
    return r.until(sid, 'document.readyState==="complete" && !!document.getElementById("tvAds") && !!document.querySelector("#tvAds .ad.show")', 20)


# ======================================================================================
def no_venue():
    print('\n1. venueplay.com.au/tv with no venue: the Google Play app and the screen code, at TV size')
    r = RIG.Rig()
    try:
        tid, tv = r.open('/tv', width=W, height=H)
        ok('the no-venue screen loads with the "Set up this screen" card on the wall', r.until(tv, vis('pairPanel'), 20) is True,
           r.ask(tv, 'document.body.innerText.replace(/\\s+/g," ").slice(0,200)'))
        time.sleep(1.0)
        shot(r, tv, 'tv-landing-1-no-venue')
        card = words(r, tv, 'pairPanel') or ''
        ok('it says "Got a TV with Google Play? Get the VenuePlay TV app"', 'Got a TV with Google Play? Get the VenuePlay TV app' in card, card[:240])
        head = r.ask(tv, '(function(){var e=document.querySelector("#suApp .su-head");return e?parseFloat(getComputedStyle(e).fontSize):0;})()') or 0
        ok('at a size read from across a room (the line is at least 24px on a 1280 wall)', head >= 24, head)
        link = r.ask(tv, '(function(){var a=document.getElementById("tvPlayLink");return a?{tag:a.tagName,href:a.getAttribute("href"),text:a.textContent.replace(/\\s+/g," ").trim(),imgs:a.querySelectorAll("img,svg,picture").length,'
                         'bg:getComputedStyle(a).backgroundImage}:null;})()') or {}
        ok('the "Get it on Google Play" badge is a real link to the VenuePlay TV app\'s store page',
           link.get('tag') == 'A' and link.get('href') == PLAY and link.get('text') == 'Get it on Google Play', link)
        badge = r.ask(tv, '(function(){var i=document.querySelector("#tvPlayLink img.gp-badge");return i?{src:i.getAttribute("src"),alt:i.alt,loaded:i.complete&&i.naturalWidth>0,'
                          'shown:getComputedStyle(i).display!=="none",fallback:getComputedStyle(document.querySelector("#tvPlayLink .gp-text")).display}:null;})()') or {}
        ok('the badge is Google\'s own "Get it on Google Play" badge, unchanged, from Google\'s address (Dean, 31 Oct 2026: the logo did not show properly)',
           badge.get('src') == 'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png' and badge.get('alt') == 'Get it on Google Play'
           and badge.get('shown') and badge.get('fallback') == 'none', badge)
        fb = r.ask(tv, '(function(){var a=document.getElementById("tvPlayLink"),i=a.querySelector("img");var h=i.getAttribute("onerror");'
                       'new Function(h).call(i);var t=a.querySelector(".gp-text");var out={img:getComputedStyle(i).display,text:getComputedStyle(t).display,words:t.textContent.replace(/\\s+/g," ").trim()};'
                       'a.classList.add("has-badge");return out;})()') or {}
        ok('if Google\'s badge cannot load, the words version stands in (no broken image on a venue\'s TV)',
           fb.get('img') == 'none' and fb.get('text') != 'none' and fb.get('words') == 'Get it on Google Play', fb)
        geo = r.ask(tv, '(function(){function b(id){var e=document.getElementById(id).getBoundingClientRect();return {l:e.left,t:e.top,w:e.width,h:e.height};}'
                        'function c(id){var e=document.getElementById(id).getBoundingClientRect();return {l:e.left,w:e.width,t:e.top,h:e.height};}'
                        'return {a:b("tvPlayLink"),c:b("tvSetupCode"),ca:c("suApp"),cc:c("suCode")};})()') or {}
        a_, c_, ca_, cc_ = geo.get('a') or {}, geo.get('c') or {}, geo.get('ca') or {}, geo.get('cc') or {}
        ok('the two buttons match: the same size, at the same height on the screen (Dean, 31 Oct 2026: "similar size and position")',
           a_ and c_ and abs(a_['w'] - c_['w']) <= 2 and abs(a_['h'] - c_['h']) <= 2 and abs(a_['t'] - c_['t']) <= 2, geo)
        ok('each button is centred in its own card, and the two cards are the same size', a_ and c_ and ca_ and cc_ and
           abs((a_['l'] + a_['w'] / 2) - (ca_['l'] + ca_['w'] / 2)) <= 3 and abs((c_['l'] + c_['w'] / 2) - (cc_['l'] + cc_['w'] / 2)) <= 3 and
           abs(ca_['w'] - cc_['w']) <= 3 and abs(ca_['h'] - cc_['h']) <= 3, geo)
        ok('the badge is on screen, inside the wall, and nothing covers it', r.ask(tv, on_top('tvPlayLink')) is True, r.ask(tv, on_top('tvPlayLink')))
        ok('"Put in the screen code" is there too, on screen and not covered', r.ask(tv, on_top('tvSetupCode')) is True and 'Put in the screen code' in card,
           r.ask(tv, on_top('tvSetupCode')))
        ok('and the old way still reads: open venueplay.com.au/tv?your-venue once', 'venueplay.com.au/tv?your-venue' in card, card[-160:])
        ok('the whole card fits on a 1280 x 720 wall (nothing cut off, nothing to scroll)',
           r.ask(tv, '(function(){var e=document.getElementById("pairPanel"),b=e.getBoundingClientRect();return b.top>=0&&b.left>=0&&b.bottom<=innerHeight&&b.right<=innerWidth&&e.scrollHeight<=e.clientHeight+1;})()') is True,
           r.ask(tv, 'JSON.stringify(document.getElementById("pairPanel").getBoundingClientRect())'))
        # the code keypad, exactly as before
        r.ask(tv, 'document.getElementById("tvSetupCode").click(); true')
        ok('"Put in the screen code" opens the keypad', r.until(tv, vis('venuePick'), 5) is True)
        ok('the same keypad as ever: "Put in the screen code", 29 keys, Delete and Go back',
           r.ask(tv, 'document.getElementById("vpTitle").textContent') == 'Put in the screen code'
           and r.ask(tv, 'document.querySelectorAll("#vpList .keys a[data-ck]").length') == 29
           and r.ask(tv, '[].map.call(document.querySelectorAll("#vpList .keyacts a"),function(a){return a.textContent}).join("|")') == 'Delete|Go back',
           [r.ask(tv, 'document.getElementById("vpTitle").textContent'), r.ask(tv, 'document.querySelectorAll("#vpList .keys a[data-ck]").length')])
        shot(r, tv, 'tv-landing-2-keypad')
        r.ask(tv, 'document.querySelector(\'#vpList [data-ck="back"]\').click(); true'); time.sleep(0.4)
        ok('Go back closes the keypad and the set up card is still there', r.ask(tv, vis('venuePick')) is False and r.ask(tv, vis('pairPanel')) is True)
        ok('no save-this-page note on a screen with no venue', r.ask(tv, vis('tvSaveNote')) is False)
        ok('no script errors on the TV', r.ask(tv, 'window.__errs.length') == 0, r.ask(tv, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

        print('\n6a. inside the VenuePlay TV app, with no venue: the "get the app" half comes off, the code stays')
        tid, app = r.open('/tv', before=IN_APP, width=W, height=H)
        ok('CONTROL: the page reads the app\'s user agent', r.until(app, '/VenuePlayTV\\//.test(navigator.userAgent)', 15) is True)
        ok('the set up card is up', r.until(app, vis('pairPanel'), 20) is True)
        ok('without the Google Play half (it is already the app)', r.ask(app, vis('suApp')) is False)
        ok('and with "Put in the screen code"', r.ask(app, on_top('tvSetupCode')) is True, r.ask(app, on_top('tvSetupCode')))
        r.close_tab(tid)
    finally:
        r.close()


# ======================================================================================
def by_code():
    print('\n2. the code typed on /tv: the venue screen says save this page, with its own link')
    r = RIG.Rig()
    try:
        slug, code = r.W.info['slug'], r.W.info['code']
        want_link = 'venueplay.com.au/tv?' + slug
        want = 'Save this page as a bookmark or favourite so this TV opens straight to Test Alpha next time: ' + want_link
        tid, tv = r.open('/tv', before=SAY, width=W, height=H)
        r.until(tv, vis('pairPanel'), 20)
        r.ask(tv, 'document.getElementById("tvSetupCode").click(); true')
        r.until(tv, vis('venuePick'), 5)
        for ch in code:
            r.ask(tv, 'document.querySelector(\'#vpList [data-ck="%s"]\').click(); true' % ch)
            time.sleep(0.15)
        ok('the code is accepted: "This screen is set", with its link to write down',
           r.until(tv, 'document.getElementById("vpTitle").textContent==="This screen is set"', 10) is True,
           r.ask(tv, 'document.getElementById("vpTitle").textContent'))
        r.ask(tv, '(function(){var a=[].filter.call(document.querySelectorAll("#vpList .keyacts a"),function(x){return x.textContent==="Start now"})[0];a.click();return true;})()')
        ok('Start now: the TV is on its venue\'s screen', r.until(tv, 'location.search.indexOf(%s)>=0 && !!document.querySelector("#tvAds .ad.show")' % json.dumps('venue=' + slug), 20) is True,
           r.ask(tv, 'location.href'))
        ok('THE NOTE IS UP', r.until(tv, vis('tvSaveNote'), 5) is True)
        time.sleep(0.5)
        shot(r, tv, 'tv-landing-3-save-note')
        got = (words(r, tv, 'tvSaveNote') or '').replace(' Press any key to close this', '')
        ok('it reads "Save this page as a bookmark or favourite so this TV opens straight to Test Alpha next time: venueplay.com.au/tv?<slug>"', got == want, got)
        ok('the link it gives is this venue\'s own, in full', r.ask(tv, 'document.getElementById("snLink").textContent') == want_link, r.ask(tv, 'document.getElementById("snLink").textContent'))
        ok('at TV size (the link at least 24px on a 1280 wall)', (r.ask(tv, 'parseFloat(getComputedStyle(document.getElementById("snLink")).fontSize)') or 0) >= 24,
           r.ask(tv, 'parseFloat(getComputedStyle(document.getElementById("snLink")).fontSize)'))
        ok('at the top of the wall, inside it, clear of the connection pill above it',
           r.ask(tv, '(function(){var b=document.getElementById("tvSaveNote").getBoundingClientRect(),s=document.getElementById("tvStatus").getBoundingClientRect();'
                     'return b.top>=0&&b.bottom<innerHeight*0.45&&b.left>=0&&b.right<=innerWidth&&(s.height===0||b.top>=s.bottom);})()') is True,
           r.ask(tv, 'JSON.stringify(document.getElementById("tvSaveNote").getBoundingClientRect())'))
        ok('a press can never land on it (it lets every click through)', r.ask(tv, 'getComputedStyle(document.getElementById("tvSaveNote")).pointerEvents') == 'none')
        ok('the set up card is gone now the screen has a venue', r.ask(tv, vis('pairPanel')) is False)
        ok('the note is told once: the tab no longer carries the code', r.ask(tv, 'sessionStorage.getItem("vpTvByCode")') is None)
        r.ask(tv, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"})); true'); time.sleep(0.4)
        ok('any key closes it', r.ask(tv, vis('tvSaveNote')) is False)
        ok('reloaded, the TV opens straight to its venue and the note does not come back',
           reload_and_wait(r, tv) is True and r.ask(tv, 'location.search.indexOf(%s)>=0' % json.dumps('venue=' + slug)) is True and r.ask(tv, vis('tvSaveNote')) is False)

        print('\n3. it goes by itself after about twenty seconds')
        flag(r, tv, slug)
        reload_and_wait(r, tv)
        ok('CONTROL: up again for a screen that has just come from the keypad', r.until(tv, vis('tvSaveNote'), 5) is True)
        time.sleep(15)
        ok('still up at fifteen seconds', r.ask(tv, vis('tvSaveNote')) is True)
        time.sleep(6.5)
        ok('gone by twenty one seconds, nobody touched anything', r.ask(tv, vis('tvSaveNote')) is False)

        print('\n4. a game taking the wall takes the note with it')
        flag(r, tv, slug)
        reload_and_wait(r, tv)
        ok('CONTROL: the note is up over the ads', r.until(tv, vis('tvSaveNote'), 5) is True)
        r.ask(tv, 'window.__say({t:"mode", mode:"bingo", caller:false}); true')
        ok('the bingo lobby comes up', r.until(tv, vis('tvLobby'), 8) is True, r.ask(tv, 'document.body.innerText.replace(/\\s+/g," ").slice(0,160)'))
        time.sleep(0.6)
        ok('and the note is gone from over the game', r.ask(tv, vis('tvSaveNote')) is False)
        ok('no script errors on the TV', r.ask(tv, 'window.__errs.length') == 0, r.ask(tv, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)

        print('\n5. a TV opened at its own /tv?venue=<slug> link never shows it')
        tid, own = r.open('/tv?venue=' + slug, width=W, height=H)
        ok('CONTROL: the venue screen is up', r.until(own, '!!document.querySelector("#tvAds .ad.show")', 20) is True)
        r.ask(own, 'window.__noteSeen=0; setInterval(function(){ if(%s) window.__noteSeen++; }, 50); true' % vis('tvSaveNote'))
        time.sleep(3)
        ok('no note, not even for a moment', r.ask(own, 'window.__noteSeen') == 0, r.ask(own, 'window.__noteSeen'))
        flag(r, own, 'some-other-venue-4000', 'Some Other Venue')
        reload_and_wait(r, own)
        time.sleep(1)
        ok('nor for a code that named a different venue', r.ask(own, vis('tvSaveNote')) is False)
        r.close_tab(tid)

        print('\n6b. inside the VenuePlay TV app: never the note')
        tid, app = r.open('/tv?venue=' + slug, before=IN_APP, width=W, height=H)
        r.until(app, '!!document.querySelector("#tvAds .ad.show")', 20)
        flag(r, app, slug)
        reload_and_wait(r, app)
        ok('CONTROL: the page reads the app\'s user agent', r.ask(app, '/VenuePlayTV\\//.test(navigator.userAgent)') is True)
        time.sleep(1)
        ok('a screen in the app that came from a code still shows no note', r.ask(app, vis('tvSaveNote')) is False)
        r.close_tab(tid)
    finally:
        r.close()


no_venue()
by_code()
print('')
print(('%d of %d checks passed' % (ran - bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
