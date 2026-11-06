#!/usr/bin/env python3
"""WHAT'S ON, AS CHROME PAINTS IT (INBOX 110, Dean 6 Nov 2026; promised to Revolver Upstairs for the Thu 12 Nov release).

A venue adds its own nights (DJs, gigs, club nights, specials) on Your account > Screen > What's on, and they show on
its TV between games and in the players' week strip. This opens the REAL pages in headless Chrome:

  ACCOUNT  the real billing.html against the REAL billing Worker (tools/browser-rig/admin_site.py), at 1280, 820 and
           390 wide: the What's on card under Screen; + Add an event opens the form; Save with no title says so and
           stores nothing; a one-off and a weekly night saved through the page land in vp_venue_screen.events with
           only their fields; a picture chosen in the form goes up through /account/screen-upload and is kept on the
           event; Edit keeps the id; Remove takes it off; nothing on the card is wider than the screen at 390
  TV       the real tv.html against the REAL game Worker (tools/browser-rig/rig.py) with a venue whose screen row
           holds a slide and three nights: the "What's on" list slide and the poster slide take their turn in the
           loop; Tonight is gold; every row fits on the wall at 1920x1080 and 1280x720; a past night never shows
  PHONE    the real trivia phone page at 390x664 and 375x667: /join/info with ad:1 hands over the nights with only
           their public fields; the lobby drawn by the page's own vp-tonight.js shows tonight's night under our game,
           a gold dot on the days that have one, tapping a day lists them; the venue's ad and our logo still fit

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
VP_SHOTS=<dir> also saves the frames.

    python3 tools/whats-on-in-chrome.test.py
"""
import datetime, json, os, struct, sys, tempfile, time, zlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1

def png(path, w, h, pixel):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            rows += bytes(pixel(x, y))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(rows), 6)) + chunk(b'IEND', b''))

# Today and the days after it, in Brisbane (the TV's default zone and the test venue's state): the pages judge
# "Tonight" on their own clock, so the nights are laid out from it. Weekdays, never a fixed date that could pass.
BNE = datetime.timezone(datetime.timedelta(hours=10))
TODAY = datetime.datetime.now(BNE).date()
DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
def dkey(d): return DAYS[d.weekday()]
def iso(d): return d.isoformat()

def account():
    import admin_site
    print('\nACCOUNT: Your account > Screen > What\'s on, against the real billing Worker')
    tmp = tempfile.mkdtemp(prefix='whats-on-')
    POSTER = os.path.join(tmp, 'poster.png')
    png(POSTER, 160, 200, lambda x, y: (200, (x * 2) % 256, (y * 3) % 256))
    S = admin_site.Site()
    V1 = S.W.info['venue']
    def events():
        rows = [r for r in S.W.table('vp_venue_screen') if r.get('venue_id') == V1]
        return (rows[-1].get('events') if rows else None) or []
    def form_set(sid, idx, val):
        S.js(sid, '(function(){var i=document.querySelectorAll(".woe-form input")[%d]; i.value=%s; i.dispatchEvent(new Event("input",{bubbles:true})); return true;})()' % (idx, json.dumps(val)))
    def click(sid, sel, text=None):
        if text is None:
            return S.js(sid, '(function(){var b=document.querySelector(%s); if(!b) return false; b.click(); return true;})()' % json.dumps(sel))
        return S.js(sid, '(function(){var b=[].filter.call(document.querySelectorAll(%s),function(x){return x.textContent.trim()===%s;})[0]; if(!b) return false; b.click(); return true;})()' % (json.dumps(sel), json.dumps(text)))
    try:
        tid, sid = S.open('/app/billing.html')
        S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 20)
        S.js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); true')
        S.until(sid, '!!document.querySelector("#woBox .woe-add")', 15)
        card = S.json(sid, 'JSON.stringify({head:document.querySelector("#woCard .scardhead").textContent, inScreen:!!document.querySelector("#tp-screen #woCard"), after:(function(){var s=document.getElementById("slides"),w=document.getElementById("woCard");return !!(s.compareDocumentPosition(w)&Node.DOCUMENT_POSITION_FOLLOWING);})(), empty:(document.querySelector("#woBox .woe-empty")||{}).textContent||""})', {})
        ok('the What\'s on card is on the Screen tab, after Slides, and says what to add', card.get('inScreen') and card.get('after') and card.get('head', '').startswith("What's on") and 'Nothing on yet' in card.get('empty', ''), card)
        click(sid, '#woBox .woe-add')
        S.until(sid, '!document.querySelector(".woe-form").hidden', 5)
        click(sid, '.woe-form button', 'Save event')
        time.sleep(0.4)
        err = S.js(sid, 'document.querySelector(".woe-err").textContent')
        ok('Save with no title says "Give it a title." and stores nothing', err == 'Give it a title.' and events() == [], [err, events()])
        when = TODAY + datetime.timedelta(days=3)
        form_set(sid, 0, 'Mount Kujo album launch'); form_set(sid, 2, iso(when)); form_set(sid, 1, '20:00'); form_set(sid, 4, 'With Circuit Breaker')   # inputs: title, starts, date, last date, line
        S.set_file(sid, '.woe-form input[type=file]', POSTER)
        S.until(sid, '/venue-ads/.test(document.querySelector(".woe-form .woe-thumb").style.backgroundImage)', 25)
        click(sid, '.woe-form button', 'Save event')
        S.until(sid, 'document.querySelector(".woe-form").hidden && document.querySelectorAll(".woe").length===1', 15)
        ev = events()
        ok('a one-off with a picture is stored with only its fields, the picture from the venue\'s own folder',
           len(ev) == 1 and ev[0].get('title') == 'Mount Kujo album launch' and ev[0].get('date') == iso(when) and ev[0].get('start') == '20:00'
           and ev[0].get('line') == 'With Circuit Breaker' and '/venue-ads/' + V1 + '/' in (ev[0].get('image_url') or '') and ev[0].get('id')
           and sorted(ev[0].keys()) == ['date', 'id', 'image_url', 'line', 'start', 'title'], ev)
        click(sid, '#woBox .woe-add')
        form_set(sid, 0, 'Revolver Fridays')
        S.js(sid, '(function(){var w=document.querySelector(".woe-form select"); w.value=%s; w.dispatchEvent(new Event("change",{bubbles:true})); return true;})()' % json.dumps(dkey(TODAY)))
        form_set(sid, 1, '22:00')
        click(sid, '.woe-form button', 'Save event')
        S.until(sid, 'document.querySelectorAll(".woe").length===2', 15)
        ev = events()
        wk = [e for e in ev if e.get('title') == 'Revolver Fridays']
        ok('a weekly night is stored by its weekday', len(wk) == 1 and wk[0].get('day') == dkey(TODAY) and 'date' not in wk[0] and wk[0].get('start') == '22:00', ev)
        first = S.js(sid, 'document.querySelector(".woe .woe-when").textContent')
        ok('the list is in date order, and tonight\'s weekly night reads "Tonight, 10pm (weekly)" first', first.startswith('Tonight, 10pm (weekly)'), first)
        wid = wk[0]['id']
        S.js(sid, '(function(){var r=document.querySelector(\'.woe[data-id="%s"]\'); r.querySelector(".woe-edit").click(); return true;})()' % wid)
        S.until(sid, '!document.querySelector(".woe-form").hidden', 5)
        form_set(sid, 4, 'Four decks, one winner')
        click(sid, '.woe-form button', 'Save event')
        S.until(sid, 'document.querySelector(".woe-form").hidden', 15)
        wk2 = [e for e in events() if e.get('id') == wid]
        ok('Edit saves under the same id', len(wk2) == 1 and wk2[0].get('line') == 'Four decks, one winner' and len(events()) == 2, events())
        for w in (1280, 820, 390):
            S.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': 900, 'deviceScaleFactor': 1, 'mobile': w < 600}, session=sid)
            time.sleep(0.6)
            click(sid, '#woBox .woe-add')
            time.sleep(0.4)
            time.sleep(0.2)
            fit = S.json(sid, 'JSON.stringify((function(){var c=document.getElementById("woCard"),r=c.getBoundingClientRect(),over=[];[].forEach.call(c.querySelectorAll("*"),function(n){var b=n.getBoundingClientRect();if(b.width&&b.right>innerWidth+1)over.push((n.className||n.tagName)+":"+Math.round(b.right));});return {w:innerWidth,doc:document.documentElement.scrollWidth,over:over.slice(0,5),btn:Math.round(document.querySelector(".woe-form .go").getBoundingClientRect().height),day:Math.round(document.querySelector(".woe-form select").getBoundingClientRect().height),edit:Math.min.apply(null,[].map.call(document.querySelectorAll("#woBox .woe:not([hidden]) .woe-edit, #woBox .woe:not([hidden]) .woe-rm"),function(x){return Math.round(x.getBoundingClientRect().height);}).concat([999])),rows:[].map.call(document.querySelectorAll("#woBox .woe"),function(x){return Math.round(x.getBoundingClientRect().height);})};})())', {})
            ok('%d wide: nothing on the card is wider than the screen, buttons at least 44px tall' % w, not fit.get('over') and fit.get('doc', 9999) <= w and fit.get('btn', 0) >= 40 and fit.get('day', 0) >= 44, fit)
            if w < 600:
                ok('%d wide: Edit, Copy and Remove are at least 44px tall on a phone' % w, fit.get('edit', 0) >= 44, fit.get('edit'))
            if w >= 820:
                ok('%d wide: each event is one compact row, not a tall card (Dean, round 3)' % w, fit.get('rows') and max(fit['rows']) <= 74, fit.get('rows'))
            if SHOTS: S.shot(sid, os.path.join(SHOTS, 'whats-on-account-%d.png' % w))
            click(sid, '.woe-form button', 'Cancel')
        S.js(sid, '(function(){var r=document.querySelector(\'.woe[data-id="%s"]\'); r.querySelector(".woe-rm").click(); return true;})()' % wid)
        S.until(sid, 'document.querySelectorAll(".woe").length===1', 15)
        ok('Remove takes it off the screen row', [e.get('id') for e in events()] == [ev[0]['id']], events())
        errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
        ok('no script error on the account page', errs == '[]', errs)
        S.close_tab(tid)
    finally:
        S.close()

def tv_and_phone():
    import rig as RIG
    r = RIG.Rig()
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        tom = TODAY + datetime.timedelta(days=1)
        poster = r.base + '/logos/ad-slides/tugun-friday.jpg'
        nights = [
            {'id': 'e1', 'title': 'I ♥ 3181', 'day': dkey(TODAY), 'start': '21:00', 'line': 'Hans DC and Loved DJs in the back bar'},
            {'id': 'e2', 'title': 'Revolver Fridays', 'day': dkey(tom), 'start': '22:00', 'line': 'Four decks, one winner', 'image_url': poster, 'made_by': 'secret'},
            {'id': 'e3', 'title': 'Mount Kujo album launch', 'date': iso(TODAY + datetime.timedelta(days=2)), 'start': '20:00'},
            {'id': 'e4', 'title': 'Long gone gig', 'date': '2026-01-10', 'start': '20:00'},
        ]
        r.W.seed('vp_venue_screen', [{'venue_id': venue, 'slug': slug, 'logo_url': None, 'raffle': None, 'events': nights,
                                     'slides': [{'image_url': r.base + '/logos/ad-slides/tugun-tuesday.jpg', 'seconds': 3}]}], replace=True)
        print('\nTV: the venue\'s nights between games')
        for (W, H) in ((1920, 1080), (1280, 720)):
            tid, sid = r.open('/tv?venue=' + slug, width=W, height=H)
            got = r.until(sid, '(function(){var s=document.querySelector("#tvAds .ad.show .wo-list");return !!s && +getComputedStyle(s.closest(".ad")).opacity>0.9;})()', 30)
            time.sleep(1.2)   # the 0.8 s hand-over has finished
            ok('%dx%d: the What\'s on list slide takes its turn in the loop' % (W, H), got is True, r.ask(sid, '(function(){var a=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(x){return x.style.zIndex==="2";});return a[0]||document.querySelector("#tvAds .ad.show");})() && (function(){var a=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(x){return x.style.zIndex==="2";});return a[0]||document.querySelector("#tvAds .ad.show");})().innerText'))
            m = r.json(sid, 'JSON.stringify((function(){var s=(function(){var a=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(x){return x.style.zIndex==="2";});return a[0]||document.querySelector("#tvAds .ad.show");})(),rows=[].map.call(s.querySelectorAll(".wo-row"),function(x){var b=x.getBoundingClientRect();return {t:x.innerText.replace(/\\s+/g," "),tn:x.classList.contains("tonight"),bot:Math.round(b.bottom),right:Math.round(b.right),bar:getComputedStyle(x,"::before").backgroundColor};});var hd=s.querySelector(".wo-head").getBoundingClientRect(); return {kick:s.querySelector(".wo-kick").textContent,head:s.querySelector(".wo-head").textContent,headTop:Math.round(hd.top),rows:rows,h:innerHeight,w:innerWidth};})())', {})
            rows = m.get('rows') or []
            ok('%dx%d: TEST ALPHA over WHAT\u2019S ON at the top, tonight first with the pink bar, then tomorrow, then the one-off; times as people say them; the past gig never shows' % (W, H),
               m.get('kick') == 'Test Alpha' and m.get('head') == 'What\u2019s on' and m.get('headTop', 999) < m.get('h', 0) * 0.15 and len(rows) == 3 and rows[0]['tn'] and 'TONIGHT' in rows[0]['t'].upper() and '3181' in rows[0]['t'] and '9pm' in rows[0]['t']
               and 'TOMORROW' in rows[1]['t'].upper() and 'Kujo' in rows[2]['t'] and rows[0]['bar'] == 'rgb(255, 31, 142)' and not any('Long gone' in x['t'] for x in rows), m)
            ok('%dx%d: every row fits on the wall' % (W, H), rows and all(x['bot'] <= m['h'] - 8 and x['right'] <= m['w'] for x in rows), rows)
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'whats-on-tv-list-%d.jpg' % W))
            got = r.until(sid, '(function(){var s=document.querySelector("#tvAds .ad.show .wo-poster");return !!s && +getComputedStyle(s.closest(".ad")).opacity>0.9;})()', 30)
            time.sleep(1.2)
            p = r.json(sid, 'JSON.stringify((function(){var s=(function(){var a=[].filter.call(document.querySelectorAll("#tvAds .ad.show"),function(x){return x.style.zIndex==="2";});return a[0]||document.querySelector("#tvAds .ad.show");})(); if(!s||!s.querySelector(".wo-poster")) return {}; var pic=s.querySelector(".wo-pic").getBoundingClientRect(), w=s.querySelector(".wo-words").getBoundingClientRect(); return {bg:s.querySelector(".wo-pic").style.backgroundImage,txt:s.innerText.replace(/\\s+/g," "),pic:[Math.round(pic.width),Math.round(pic.height)],wordsRight:Math.round(w.right),overlap:pic.right>w.left+1,w:innerWidth};})())', {})
            ok('%dx%d: the night with a picture gets a poster slide: the picture whole on the left, the words beside it' % (W, H),
               got is True and 'tugun-friday.jpg' in p.get('bg', '') and 'REVOLVER FRIDAYS' in p.get('txt', '').upper() and 'TOMORROW' in p.get('txt', '').upper() and '10pm' in p.get('txt', '')
               and p.get('pic', [0, 0])[1] > H * 0.6 and not p.get('overlap') and p.get('wordsRight', 9999) <= p.get('w', 0), p)
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'whats-on-tv-poster-%d.jpg' % W))
            ok('%dx%d: no script errors on the TV' % (W, H), r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)

        print('\nPHONE: the week strip on the real trivia phone page')
        for (W, H) in ((390, 664), (375, 667)):
            tid, sid = r.open('/app/trivia/play.html', width=W, height=H)
            r.until(sid, 'typeof VPTonight==="object" && typeof VPWhatsOn==="object" && !!document.getElementById("vpTonight")', 20)
            raw = r.ask(sid, '(function(){var x=new XMLHttpRequest(); x.open("POST","/__worker/join/info",false); x.setRequestHeader("Content-Type","application/json"); x.send(JSON.stringify({code:%s,ad:1})); return x.responseText;})()' % json.dumps(r.W.info['code']))
            info = json.loads(raw) if isinstance(raw, str) and raw.startswith('{') else {}
            evs = info.get('events') or []
            ok('%dx%d: /join/info (ad:1) hands over the three nights still to come, with only their public fields' % (W, H),
               [e.get('title') for e in evs] == ['I ♥ 3181', 'Revolver Fridays', 'Mount Kujo album launch']
               and all(set(e.keys()) <= {'title', 'date', 'day', 'until', 'start', 'line', 'image_url'} for e in evs), evs)
            S = ('(function(ev){var vs=["vNoRoom","vJoin","vWait","vQ","vRes","vFinal","vPR","vDemoEnd","vCall"]; vs.forEach(function(v){var e=document.getElementById(v); if(e) e.classList.toggle("hidden", v!=="vWait");});'
                 'document.getElementById("app").classList.add("vpt-on"); document.getElementById("waitIn").classList.add("hidden"); var tn=document.getElementById("vpTonight"); tn.classList.remove("hidden");'
                 'window.__st=VPTonight.lobby(tn,{name:"The Quizzly Bears",me:"trivia",week:[{day:%s,games:[{game:"trivia",start:"19:30"}]}],events:ev});'
                 'VPPhoneAd.set([{image_url:"https://x.supabase.co/storage/v1/object/public/venue-ads/v/ad.jpg"}],"Test Alpha"); VPPhoneAd.show(true); [].forEach.call(document.querySelectorAll("#vpAd img"),function(i){ i.onerror=null; i.src=location.origin+"/logos/ad-slides/tugun-tuesday.jpg"; }); return true;})(%s)') % (json.dumps(dkey(TODAY)), json.dumps(evs))
            r.ask(sid, S)
            time.sleep(1.2)
            m = r.json(sid, 'JSON.stringify((function(){var rows=[].map.call(document.querySelectorAll("#vpTonight .vpt-night .row"),function(x){return x.innerText.replace(/\\s+/g," ");}); var d=[].map.call(window.__st.buttons,function(b){return b.className;}); var dot=window.__st.buttons[0]; var ad=document.getElementById("vpAd").getBoundingClientRect(), foot=document.querySelector(".pfoot").getBoundingClientRect(); return {rows:rows,days:d,dot:getComputedStyle(dot,"::after").backgroundColor,adBottom:Math.round(ad.bottom),adH:Math.round(ad.height),foot:Math.round(foot.bottom),h:innerHeight,doc:document.documentElement.scrollWidth};})())', {})
            rows = m.get('rows') or []
            ok('%dx%d: the lobby opens as Dean\'s round 7 lobby, our trivia alone, and the strip says "Tap a day"' % (W, H),
               len(rows) == 1 and 'Trivia' in rows[0] and 'Tap a day' in (r.ask(sid, 'document.querySelector("#vpTonight .vpt-week .k").innerText') or ''), rows)
            ok('%dx%d: a dot in the days that have one of the venue\'s nights (white on Today)' % (W, H),
               ' ev' in m.get('days', [''])[0] and ' ev' in m.get('days', ['', ''])[1] and m.get('dot') == 'rgb(255, 255, 255)', m.get('days'))
            ok('%dx%d: the venue\'s ad and our logo still fit on the screen' % (W, H), m.get('adH', 0) > 60 and m.get('foot', 9999) <= m.get('h', 0) and m.get('doc', 9999) <= W, m)
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'whats-on-phone-lobby-%d.jpg' % W))
            r.ask(sid, 'window.__st.buttons[0].click(); true')
            time.sleep(0.3)
            t0 = r.json(sid, 'JSON.stringify([].map.call(document.querySelectorAll("#vpTonight .vpt-night .row"),function(x){return x.innerText.replace(/\\s+/g," ");}))', [])
            ok('%dx%d: tap Today: our trivia, then the venue\'s night badged with its time' % (W, H), len(t0) == 2 and 'Trivia' in t0[0] and '9pm' in t0[1] and '3181' in t0[1], t0)
            r.ask(sid, 'window.__st.buttons[1].click(); true')
            time.sleep(0.3)
            t1 = r.json(sid, 'JSON.stringify([].map.call(document.querySelectorAll("#vpTonight .vpt-night .row"),function(x){return x.innerText.replace(/\\s+/g," ");}))', [])
            hd = r.ask(sid, '(document.querySelector("#vpTonight .vpt-night .nk")||{}).textContent||""')
            ok('%dx%d: tap tomorrow: the card names the day, then the venue\'s night, no "No games this night" over it' % (W, H), len(t1) == 1 and 'Revolver Fridays' in t1[0] and '10pm' in t1[0] and str(hd).lower().startswith(dkey(tom)[:3]), [hd, t1])
            if SHOTS: r.shot(sid, os.path.join(SHOTS, 'whats-on-phone-tomorrow-%d.jpg' % W))
            ok('%dx%d: no script errors on the phone' % (W, H), r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
            r.close_tab(tid)

        print('\nNO "CONNECTED" WORD on any phone (Dean, 6 Nov 2026: "why do we have the connected word again?")')
        for page in ('/app/trivia/play.html', '/app/musical/play.html', '/play.html'):
            tid, sid = r.open(page, width=390, height=664)
            r.until(sid, '!!document.getElementById("statusText") && !!document.getElementById("statusDot")', 20)
            m = r.json(sid, 'JSON.stringify((function(){var d=document.getElementById("statusDot"),t=document.getElementById("statusText"),l=d.parentNode; l.classList.remove("nostatus"); d.classList.remove("on"); t.textContent="Reconnecting"; var re=Math.round(t.getBoundingClientRect().width);'
                            'd.classList.add("on"); t.textContent="Connected"; return {re:re,dot:Math.round(d.getBoundingClientRect().width),w:Math.round(t.getBoundingClientRect().width),pos:getComputedStyle(t).position};})())', {})
            # The bingo phone already shows its status as the dot alone (the words ride the dot's label), so only the
            # trivia and musical phones are held to "Reconnecting" still showing.
            ok('%s: connected is the green dot alone (the word is not seen)%s' % (page, '' if page == '/play.html' else ', and "Reconnecting" still shows'),
               m.get('dot', 0) >= 6 and m.get('w', 9) <= 1 and (page == '/play.html' or m.get('re', 0) > 40), m)
            r.close_tab(tid)
    finally:
        r.close()

def main():
    # Look every half second (as tools/tv-first-slide-in-chrome.test.py does); never clear anybody else's lock.
    end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    while True:
        st, pid, text = gatelib.lock_state()
        if st in ('free', 'mine') and gatelib.hold_lock_or_refuse('whats-on-in-chrome', wait_s=0):
            break
        if time.time() > end:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return 2
        time.sleep(0.5)
    account()
    tv_and_phone()
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
