#!/usr/bin/env python3
"""THE HOME PAGE DEMO'S ADS LOOP PLAYS ONE VENUE'S LIVE SLIDES (Dean, 13 Nov 2026, INBOX 356).

/tv?demo=1&ads=1 is the home page's Advertising view. It used to be typed slides in the old rounded type, a members draws
board in the old branding, a typed raffle and four photos of Tugun's old artwork. Now it reads the chosen venue's own live
slides (the public /screen read, /demo-venue.json picks the venue) and falls back to What's on at Tugun in the current TV style.

This opens the REAL tv.html against the REAL game Worker (tools/browser-rig/rig.py) at 1920x1080 and 1280x720:
  - the shipped /demo-venue.json is read as it is (Tugun, which the rig's Worker does not know: the fallback plays)
  - a one-line change to that file's answer (the rig venue's slug) switches the venue: its slides, name and logo play, and
    the old draws board, raffle and typed slides never do, whatever the account holds
  - an account with an EMPTY slides list plays the fallback; a read that fails plays the fallback
  - every slide of every loop fits one screen: words and boards inside the 5% safe box, nothing cut, a photo full-bleed
  - the wall makes only GETs of /demo-venue.json and /screen (no /venue poll, no realtime heartbeat), and no script errors

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
VP_SHOTS=<dir> also saves every slide as a frame.

    python3 tools/demo-ads-in-chrome.test.py
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
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600]))
    if not cond: bad += 1

# What the page asks for, kept in window.__asked; the config answer can be swapped for the venue under test; the read can be made to fail.
def before(cfg=None, fail=False):
    js = ('window.__asked=[];(function(){var f=window.fetch;window.fetch=function(u,o){var s=String(u);window.__asked.push(s);'
          'if(s.indexOf("/demo-venue.json")>=0){var c=%s;if(c) return Promise.resolve(new Response(JSON.stringify(c),{status:200,headers:{"Content-Type":"application/json"}}));}'
          'if(%s && s.indexOf("/screen?venue=")>=0) return Promise.reject(new TypeError("offline"));'
          'return f.apply(this,arguments);};})();') % (json.dumps(cfg) if cfg else 'null', 'true' if fail else 'false')
    return js

# Every slide in turn, made the lit one by hand (the loop would take 12 s a slide), measured and optionally framed.
ALL = ('JSON.stringify((function(){var host=document.getElementById("tvAds"),ads=[].slice.call(host.querySelectorAll(".ad")),out=[],W=innerWidth,H=innerHeight;'
       'ads.forEach(function(a,i){ads.forEach(function(x){x.classList.remove("show");x.style.opacity="";});a.classList.add("show");a.style.opacity="1";a.style.zIndex="2";'
       'try{VPWhatsOn.fit(host);}catch(e){}'
       'var o={i:i,cls:a.className,wo:!!a.querySelector(".wo-wall"),adimg:!!a.querySelector(".adimg"),adbig:!!a.querySelector(".adbig"),week:!!a.querySelector(".adweek"),text:(a.innerText||"").replace(/\\s+/g," ").trim().slice(0,400)};'
       'var im=a.querySelector(".adimg");if(im){var b=im.getBoundingClientRect();o.pic=[Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)];o.bg=im.style.backgroundImage;}'
       'var wall=a.querySelector(".wo-wall");if(wall){var wb=wall.getBoundingClientRect();o.wall=[Math.round(wb.left),Math.round(wb.top),Math.round(wb.right),Math.round(wb.bottom)];'
       'var ins=[].map.call(a.querySelectorAll(".wo-row,.wo-head,.wo-logo,.wo-kick"),function(e){var r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)];});'
       'o.inside=ins.every(function(r){return r[0]>=W*0.05-1&&r[2]<=W*0.95+1&&r[1]>=H*0.05-1&&r[3]<=H*0.95+1;});o.parts=ins.length;o.worst=ins.filter(function(r){return !(r[0]>=W*0.05-1&&r[2]<=W*0.95+1&&r[1]>=H*0.05-1&&r[3]<=H*0.95+1);});'
       'o.cut=[].some.call(a.querySelectorAll(".wo-what b,.wo-time"),function(t){return t.scrollWidth>t.clientWidth+1;});'
       'o.rows=a.querySelectorAll(".wo-row").length;var wp=a.querySelector(".wb-pic");o.wbpic=wp?wp.style.backgroundImage:"";var wl=a.querySelector(".wo-logo");o.wologo=wl?wl.src:"";'
       'var lowest=Math.max.apply(null,ins.map(function(r){return r[3];}).concat([0]));o.lowest=lowest;}'
       'o.scrollOver=document.documentElement.scrollHeight>H+1||document.documentElement.scrollWidth>W+1;'
       'out.push(o);window.__frames=window.__frames||[];});'
       'ads.forEach(function(x,j){x.classList.toggle("show",j===0);});return {w:W,h:H,n:ads.length,slides:out};})())')

def frame(r, sid, name, W, idx):
    # Show slide idx alone and save it
    r.ask(sid, '(function(){var ads=[].slice.call(document.querySelectorAll("#tvAds .ad"));ads.forEach(function(x,j){x.classList.toggle("show",j===%d);x.style.opacity=j===%d?"1":"0";x.style.zIndex=j===%d?"2":"1";});try{VPWhatsOn.fit(document.getElementById("tvAds"));}catch(e){}return true;})()' % (idx, idx, idx))
    time.sleep(0.7)
    r.shot(sid, os.path.join(SHOTS, '%s-%d-%d.jpg' % (name, W, idx)))

def scene(r, label, W, H, cfg=None, fail=False, wait='', shots=True):
    tid, sid = r.open('/tv?demo=1&ads=1', before=before(cfg, fail), width=W, height=H)
    r.until(sid, 'document.querySelectorAll("#tvAds .ad").length>0', 40)
    if wait: r.until(sid, wait, 40)
    time.sleep(2.5)   # the read lands, the loop is rebuilt, fonts and fit settle
    m = r.json(sid, ALL, {})
    asked = r.json(sid, 'JSON.stringify(window.__asked)', [])
    errs = r.ask(sid, 'window.__errs.length')
    name = r.ask(sid, '(document.getElementById("venueNameTag")||{}).textContent||""')
    logo = r.ask(sid, '(document.getElementById("venueLogo")||{}).src||""')
    if SHOTS and shots:
        for i in range(m.get('n', 0)): frame(r, sid, label, W, i)
    r.close_tab(tid)
    return m, asked, errs, name, logo

def run():
    import rig as RIG
    r = RIG.Rig()
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        P = lambda n: r.base + '/logos/ad-slides/' + n
        OLD = ('Bingo from 7pm', 'Parma and a pot', 'Join the club', 'Live music', '1,400', '3,200', 'members draw', 'Meat raffle', 'Roast night, $14.90', '$14.90')
        # The rig venue stands in for the live account. Its draws and raffle are set on purpose: the demo must never play them.
        full = [{'image_url': P('tugun-tuesday.jpg'), 'seconds': 6}, {'image_url': P('tugun-friday.jpg'), 'seconds': 6}, {'image_url': P('tugun-saturday.jpg'), 'seconds': 6}]
        def seed(slides, events=None, logo=None, as_slug=None):
            sg = as_slug or slug
            row = dict(r.db['vp_venues'][0]); row['slug'] = sg
            r.W.seed('vp_venues', [row], replace=True)
            r.W.seed('vp_venue_screen', [{'venue_id': venue, 'slug': sg, 'logo_url': logo, 'raffle': {'label': 'Meat raffle', 'day': 'Friday', 'time': '6:30pm'}, 'slides': slides, 'events': events or []}], replace=True)
        for (W, H) in ((1920, 1080), (1280, 720)):
            tag = '%dx%d' % (W, H)
            # 1. the shipped file as it is: Tugun, unknown to the rig's Worker, so the fallback plays
            seed(full)
            m, asked, errs, name, logo = scene(r, 'fallback-default', W, H)
            sl = m.get('slides') or []
            txt = ' '.join(s['text'] for s in sl)
            ok('%s default: the shipped /demo-venue.json is read, then /screen for Tugun\'s slug' % tag, any('/demo-venue.json' in a for a in asked) and any('/screen?venue=tugun-bowls' in a for a in asked), asked)
            ok('%s default: no account answered, so What\'s on at Tugun plays: current style (.wo-wall), not typed cards, a draws board or photos' % tag,
               len(sl) >= 2 and all(s['wo'] and not s['adbig'] and not s['week'] for s in sl), [(s['cls'], s['adbig'], s['week']) for s in sl])
            ok('%s default: the nights are there (Roast Night $10, Trivia & Cocktails, 50%% off menu, Surf + Turf $24.90, Parmi + Pint $19.90, barefoot bowls 2pm, DJ + food trucks)' % tag,
               all(x in txt for x in ('Roast Night', '$10', 'Trivia & Cocktails', '50% off menu', 'Surf + Turf', '$24.90', 'Parmi + Pint', '$19.90', 'Barefoot bowls', '2pm', 'DJ + food trucks')), txt)
            ok('%s default: none of the old slides, numbers or words, no bistro hours, no em dash' % tag, not any(o.lower() in txt.lower() for o in OLD) and '—' not in txt and '5pm' not in txt and '8pm' not in txt, txt)
            ok('%s default: Tugun\'s own logo file is the one on the wall (offline value from the file, the live read had none)' % tag, 'venue-tugun-bowls.png' in (logo or ''), [name, logo])
            ok('%s default: every slide fits one screen: words inside the 5%% safe box, nothing cut, no scroll, the wall is the safe box' % tag,
               all(s['inside'] and not s['cut'] and not s['scrollOver'] and abs(s['wall'][0] - 0.05 * W) <= 2 and abs(s['wall'][2] - 0.95 * W) <= 2 and abs(s['wall'][1] - 0.05 * H) <= 2 and abs(s['wall'][3] - 0.95 * H) <= 2 for s in sl), [(s['inside'], s['cut'], s['wall'], s['worst']) for s in sl])
            ok('%s default: no photo poster (a landscape photo in the poster panel left blurred bands): every slide is the list of tiles, each filling its frame, no Facebook artwork' % tag, not any(s.get('wbpic') for s in sl) and all(s['rows'] >= 3 for s in sl) and not any('greek-night' in str(s) or 'fbcdn' in str(s) for s in sl), [(s.get('wbpic'), s['rows']) for s in sl])
            odd = [a_ for a_ in asked if not (a_ == '/demo-venue.json' or '/screen?venue=' in a_ or '/tv?v=' in a_)]
            ok('%s default: the wall asked for /demo-venue.json and /screen only (no /venue poll, no realtime, no heartbeat; /tv?v= is the page\'s own version check)' % tag, not odd and any('/screen?venue=' in a_ for a_ in asked), asked)
            ok('%s default: no script errors' % tag, errs == 0, errs)

            # 2. the switch: the file's answer names the rig venue; its three slides play, nothing else
            seed(full, logo=r.base + '/logos/venue-tugun-bowls.png')
            m, asked, errs, name, logo = scene(r, 'live', W, H, cfg={'slug': slug, 'name': 'Offline Name', 'logo': '/logos/venue-tugun-bowls.png'})
            sl = m.get('slides') or []
            txt = ' '.join(s['text'] for s in sl)
            ok('%s switch: the venue named in the file is the one read (/screen?venue=%s), nothing hard-coded' % (tag, slug), any('/screen?venue=' + slug in a for a in asked) and not any('tugun-bowls' in a and '/screen' in a for a in asked), asked)
            ok('%s switch: its three live slides play, in its order, and only those' % tag, m.get('n') == 3 and all(s['adimg'] for s in sl) and 'tugun-tuesday' in sl[0].get('bg', '') and 'tugun-friday' in sl[1].get('bg', '') and 'tugun-saturday' in sl[2].get('bg', ''), [(s.get('bg')) for s in sl])
            ok('%s switch: the old draws board and the raffle card the account holds never play, and no What\'s on fallback beside live slides' % tag, not any(s['week'] or s['adbig'] or s['wo'] for s in sl) and not any(o in txt for o in OLD), [(s['week'], s['adbig'], s['wo']) for s in sl])
            ok('%s switch: a photo slide is full-bleed (window edge to edge)' % tag, all(s['pic'] == [0, 0, W, H] for s in sl), [s.get('pic') for s in sl])
            ok('%s switch: the venue\'s name is the live one, not the offline value' % tag, (name or '') == 'Test Alpha', name)
            ok('%s switch: no script errors' % tag, errs == 0, errs)

            # 3. Tugun's own account, through the shipped file (no mock): full slides play, an empty list plays the fallback
            seed(full, as_slug='tugun-bowls')
            m, asked, errs, name, logo = scene(r, 'tugun-live', W, H)
            sl = m.get('slides') or []
            ok('%s Tugun live: the shipped file + the account\'s three slides = those three slides play, nothing else' % tag, m.get('n') == 3 and all(s['adimg'] for s in sl) and not any(s['wo'] or s['week'] or s['adbig'] for s in sl), [(s['cls'], s.get('bg')) for s in sl])
            seed([], as_slug='tugun-bowls')
            m, asked, errs, name, logo = scene(r, 'empty', W, H)
            sl = m.get('slides') or []
            ok('%s empty: Tugun\'s account with NO slides plays the What\'s on fallback, not the broken-screen holding card' % tag, len(sl) >= 2 and all(s['wo'] for s in sl) and 'Screen not showing' not in ' '.join(s['text'] for s in sl), [s['text'][:60] for s in sl])
            ok('%s empty: and its own raffle card is not played' % tag, not any('Meat raffle' in s['text'] for s in sl))
            ok('%s empty: no script errors' % tag, errs == 0, errs)

            # 4. the read fails (Worker unreachable): the fallback plays and the page does not break
            seed(full, as_slug='tugun-bowls')
            m, asked, errs, name, logo = scene(r, 'failed', W, H, fail=True)
            sl = m.get('slides') or []
            ok('%s failed read: the Worker cannot be reached: the What\'s on fallback plays, with Tugun\'s logo file' % tag, len(sl) >= 2 and all(s['wo'] for s in sl) and 'venue-tugun-bowls.png' in (logo or ''), [[s['text'][:50] for s in sl], logo])
            ok('%s failed read: no script errors' % tag, errs == 0, errs)

            # 5. a switched venue (the Mini Bar's shape): its own nights from the file when it has none live; nothing of Tugun's, ever
            seed([])
            mini = {'slug': slug, 'name': 'The Mini Bar', 'events': [{'id': 'mb1', 'title': 'Quiz night', 'day': 'wed', 'start': '19:00'}, {'id': 'mb2', 'title': 'Karaoke', 'day': 'fri', 'start': '20:00'}]}
            m, asked, errs, name, logo = scene(r, 'mini-nights', W, H, cfg=mini)
            sl = m.get('slides') or []
            txt = ' '.join(s['text'] for s in sl)
            ok('%s switched, nothing live: the nights listed in the file play (and none of Tugun\'s)' % tag, len(sl) >= 1 and 'Quiz night' in txt and 'Karaoke' in txt and 'Roast Night' not in txt and 'Tugun' not in txt, txt)
            m, asked, errs, name, logo = scene(r, 'mini-down', W, H, cfg={'slug': slug, 'name': 'The Mini Bar'}, fail=True)
            sl = m.get('slides') or []
            txt = ' '.join(s['text'] for s in sl)
            ok('%s switched, read failed, no nights in the file: nothing of Tugun\'s plays (the venue\'s holding card does)' % tag, 'Roast Night' not in txt and 'Tugun' not in txt and 'Parmi' not in txt, txt)
    finally:
        r.close()

def main():
    end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    while True:
        st, pid, text = gatelib.lock_state()
        if st in ('free', 'mine') and gatelib.hold_lock_or_refuse('demo-ads-in-chrome', wait_s=0):
            break
        if time.time() > end:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return 2
        time.sleep(0.5)
    print('\nTV demo ads loop: the chosen venue\'s live slides, else What\'s on at Tugun, in the current style')
    run()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
