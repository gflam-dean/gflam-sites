#!/usr/bin/env python3
"""ONE VENUE LOGO TOP LEFT, NEVER TWO (Dean, 15 Nov 2026, The Mini Bar: "the mini bar." twice top left of the TV
during trivia, the second a little lower).

/tv draws its own copy of the venue's logo, top left, exactly over the one the game screen in its frame draws, so
going into a game and back the logo never moves or blinks (tools/tv-logo-in-chrome.test.py 3b). A "Hosted by" card
(/app/vp-hostedby.js) drops the game screen's header, its logo with it, and /tv's copy stayed where it was: two
copies a few pixels apart. And a card in the venue's OWN name put "hosted by The Mini Bar" (and the card's logo)
beside the venue's own logo.

On the browser rig (the repo's pages, the real game Worker in jsc, headless Chrome), a venue with a wide wordmark
logo, /tv on its link, trivia put on air in /tv's frame, at 1920x1080 and 1536x864 (a 1920 TV at 125% zoom):
  1. no card: the two copies are one box (CONTROL)
  2. a card in another name, with a logo: the frame's logo drops, and /tv's copy drops with it to the pixel
  3. the card taken off: both back up, still one box
  4. a card in the venue's own name: no "hosted by" line, no card logo, no drop; one box
  5. the same card when the game screen's own /screen answer (the venue's name) comes after it: it comes off then

    python3 tools/tv-one-venue-logo-in-chrome.test.py
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


BOX = r'''(function(d){ var o={}; ["venueLogo","hostedBy","hostedByLine","venueNameTag"].forEach(function(id){ var e=d&&d.getElementById(id); if(!e){ o[id]=null; return; }
  var s=d.defaultView.getComputedStyle(e), b=e.getBoundingClientRect();
  o[id]={ box:[Math.round(b.left*10)/10,Math.round(b.top*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10], on: !e.hidden && s.display!=="none" && s.visibility!=="hidden" && s.opacity!=="0" && b.width>0, txt:(e.textContent||"").trim() }; });
  return JSON.stringify(o); })'''
FRAME = '(document.getElementById("gameFrame").contentDocument)'
PAINT = 'document.getElementById("gameFrame").contentWindow.VPHostedBy.paint(%s); true'


def same(a, b, tol=0.6):
    return bool(a and b) and all(abs(x - y) <= tol for x, y in zip(a, b))


def play():
    import rig as RIG
    r = RIG.Rig()
    try:
        slug = r.W.info['slug']
        r.W.seed('vp_venue_screen', [{'venue_id': r.W.info['venue'], 'slug': slug, 'slides': [], 'raffle': None,
                                      'logo_url': r.base + '/logos/venueplay_primary_dark.png'}], replace=True)
        for (w, h) in ((1920, 1080), (1536, 864)):
            tag = '%dx%d' % (w, h)
            print('\n%s' % tag)
            tid, t = r.open('/tv?venue=' + slug, width=w, height=h)
            r.until(t, '!!document.getElementById("venueLogo")', 30)
            time.sleep(1.5)
            r.ask(t, 'window.postMessage({vp:"show-game",game:"trivia"}, location.origin); true')
            up = r.until(t, '(function(){var f=document.getElementById("gameFrame");try{var e=f.contentDocument.getElementById("venueLogo");return f.style.display==="block"&&!!e&&e.complete&&e.naturalWidth>0&&!!f.contentWindow.VPHostedBy;}catch(x){return false;}})()', 30)
            ok('%s: trivia is on air in the frame with its own venue logo' % tag, up is True)
            time.sleep(1.5)
            venue = (r.json(t, BOX + FRAME) or {}).get('venueNameTag', {}).get('txt', '')
            ok('%s: the game screen holds the venue\'s name (hidden behind its logo)' % tag, len(venue) > 2, venue)

            top, fr = r.json(t, BOX + '(document)'), r.json(t, BOX + FRAME)
            ok('%s 1. no card (CONTROL): /tv\'s copy and the frame\'s logo are one box' % tag,
               top['venueLogo']['on'] and fr['venueLogo']['on'] and same(top['venueLogo']['box'], fr['venueLogo']['box']), [top['venueLogo'], fr['venueLogo']])
            base = fr['venueLogo']['box']

            r.ask(t, PAINT % json.dumps({'name': 'Quizmaster Sam', 'logo': '/logos/gflam-mark-white.png'}))
            time.sleep(2.5)
            top, fr = r.json(t, BOX + '(document)'), r.json(t, BOX + FRAME)
            ok('%s 2. a card in another name: "hosted by Quizmaster Sam" is up and the frame\'s logo dropped' % tag,
               (fr.get('hostedByLine') or {}).get('on') and 'Quizmaster Sam' in fr['hostedByLine']['txt'] and fr['venueLogo']['box'][1] > base[1] + 0.5, fr)
            ok('%s 2. and /tv\'s copy dropped with it: still ONE box, never two a few pixels apart' % tag,
               same(top['venueLogo']['box'], fr['venueLogo']['box']), [top['venueLogo']['box'], fr['venueLogo']['box']])

            r.ask(t, PAINT % 'null'); time.sleep(1.5)
            top, fr = r.json(t, BOX + '(document)'), r.json(t, BOX + FRAME)
            ok('%s 3. the card taken off: both back where they were, one box' % tag,
               same(fr['venueLogo']['box'], base) and same(top['venueLogo']['box'], base), [top['venueLogo']['box'], fr['venueLogo']['box'], base])

            r.ask(t, PAINT % json.dumps({'name': venue.upper(), 'logo': '/logos/venueplay_primary_dark.png'}))
            time.sleep(2.5)
            top, fr = r.json(t, BOX + '(document)'), r.json(t, BOX + FRAME)
            ok('%s 4. a card in the venue\'s OWN name: no "hosted by" line and no second logo beside the venue\'s' % tag,
               not (fr.get('hostedByLine') or {}).get('on') and not (fr.get('hostedBy') or {}).get('on'), fr)
            ok('%s 4. and nothing dropped: one box, where it was' % tag,
               same(fr['venueLogo']['box'], base) and same(top['venueLogo']['box'], base), [top['venueLogo']['box'], fr['venueLogo']['box'], base])
            imgs = r.ask(t, '(function(){var d=document.getElementById("gameFrame").contentDocument; return [].filter.call(d.querySelectorAll("img"),function(i){var b=i.getBoundingClientRect(),s=getComputedStyle(i);return /venueplay_primary_dark/.test(i.src)&&b.width>0&&s.display!=="none"&&!i.hidden&&b.top<innerHeight*0.25;}).length;})()')
            ok('%s 4. the game screen paints the venue\'s logo once in its top quarter' % tag, imgs == 1, imgs)

            ok('%s: no script errors on /tv or the game screen' % tag,
               r.ask(t, 'window.__errs.length') == 0 and r.ask(t, 'document.getElementById("gameFrame").contentWindow.__errs.length') == 0,
               [r.ask(t, 'JSON.stringify(window.__errs)'), r.ask(t, 'JSON.stringify(document.getElementById("gameFrame").contentWindow.__errs)')])
            r.close_tab(tid)
        late_name(r, venue)
    finally:
        r.close()


# The game screen's own /screen answer held back 6 s, so the card arrives before the venue's name does (a console's
# "mode" can land first on a slow pub connection). Runs in every frame of the tab, so in /tv's game frame too.
SLOW_SCREEN = r'''(function(){ if(!/\/app\/trivia\/screen/.test(location.pathname)) return; var f=window.fetch; window.fetch=function(u){ var a=arguments, me=this;
  if(/\/screen\?venue=/.test(String(u))) return new Promise(function(res,rej){ setTimeout(function(){ f.apply(me,a).then(res,rej); }, 6000); });
  return f.apply(me,a); }; })();'''


def late_name(r, venue):
    print('\n5. the card arrives before the venue\'s name (1920x1080)')
    slug = r.W.info['slug']
    tid, t = r.open('/tv?venue=' + slug, before=SLOW_SCREEN, width=1920, height=1080)
    r.until(t, '!!document.getElementById("venueLogo")', 30)
    time.sleep(1.0)
    r.ask(t, 'window.postMessage({vp:"show-game",game:"trivia"}, location.origin); true')
    r.until(t, '(function(){var f=document.getElementById("gameFrame");try{return !!f.contentWindow.VPHostedBy && f.contentDocument.readyState==="complete";}catch(x){return false;}})()', 30)
    r.ask(t, PAINT % json.dumps({'name': 'the ' + venue, 'logo': ''}))
    time.sleep(1.0)
    early = r.json(t, BOX + FRAME)
    ok('5. CONTROL: before the game screen knows the venue\'s name, the card shows', (early.get('hostedByLine') or {}).get('on') is True and not (early.get('venueNameTag') or {}).get('txt'), early)
    gone = r.until(t, '(function(){var d=document.getElementById("gameFrame").contentDocument, n=d.getElementById("venueNameTag"), l=d.getElementById("hostedByLine"); return !!n && !!n.textContent && (!l || l.hidden);})()', 20)
    late = r.json(t, BOX + FRAME)
    ok('5. once the screen\'s own /screen answer brings the name, the card in the venue\'s own name comes off by itself', gone is True, late)
    r.close_tab(tid)


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('tv-one-venue-logo-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    try:
        play()
    except Exception:
        import traceback; traceback.print_exc()
        global bad; bad += 1
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
