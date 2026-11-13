#!/usr/bin/env python3
"""WEBSITE AUDIT, SMALL BATCH 2 (13 Nov 2026): the small, no-decision findings left after parts 1, 1b and 2.

Opens the REAL pages in headless Chrome (tools/browser-rig/admin_site.py) and presses the real Tab key:
  a. home, the offer page and /see-a-night have ONE <main id="main">, header and footer outside it, and a skip link that is the
     first Tab stop, shows when focused and lands on the content
  b. /play, the trivia player and the musical player have exactly one h1; /play has a meta description
  c. a keyboard user sees a ring on the 'venueplay TV app' and 'Help page' links (open the FAQ) and on the /play Continue button
  d. the header links on help, terms and privacy are 44px tall on a phone, the bar keeps its height
  e. HQ's filters, search boxes and date boxes have an accessible name
  f. the in-app tab titles all read 'venueplay: <page>'
  g. the four host consoles and HQ have one h1, looking as the old span/div did
  h. /app/try and /live-here-now have one h1; the live-here-now headings keep their size and spacing
  i. terms and privacy carry the share tags
Touches no git and no remote.    python3 tools/website-audit-small-batch2-13nov-in-chrome.test.py
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1; print('  ok   %s' % label)
    else:
        FAIL[0] += 1; print('  FAIL %s%s' % (label, ('  (%s)' % str(detail)[:500]) if detail != '' else ''))


def key(S, sid, k, code, vk, shift=False):
    for t in ('rawKeyDown', 'keyUp'):
        S.B.call('Input.dispatchKeyEvent', {'type': t, 'key': k, 'code': code, 'windowsVirtualKeyCode': vk, 'modifiers': 8 if shift else 0}, session=sid)


def tab(S, sid):
    key(S, sid, 'Tab', 'Tab', 9)


def tab_to(S, sid, want_js, limit=160):
    """Press Tab until `want_js` (an expression on document.activeElement `e`) is true. The element's state at that moment, or None."""
    for _ in range(limit):
        tab(S, sid)
        r = S.js(sid, '(function(){var e=document.activeElement;if(!e||e===document.body)return null;if(!(%s))return null;'
                      'var c=getComputedStyle(e);var r=e.getBoundingClientRect();return JSON.stringify({tag:e.tagName,id:e.id,txt:(e.textContent||"").trim().slice(0,30),'
                      'ol:c.outlineStyle,olw:parseFloat(c.outlineWidth)||0,olc:c.outlineColor,top:Math.round(r.top),fv:e.matches(":focus-visible")})})()' % want_js)
        if isinstance(r, str):
            return json.loads(r)
    return None


def load(S, path, w=1280, h=900, mobile=False, secs=3.0):
    tid, sid = S.open(path, w, h, mobile=mobile)
    S.until(sid, 'document.readyState==="complete"', 25); time.sleep(secs)
    return tid, sid


H1S = 'JSON.stringify([].map.call(document.querySelectorAll("h1"),function(e){return (e.textContent||"").trim()}))'
NAMED = r'''(function(ids){var bad=[];ids.forEach(function(id){var e=document.getElementById(id);if(!e){bad.push(id+' missing');return}
 var has=(e.labels&&e.labels.length)||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby');if(!has)bad.push(id);});return JSON.stringify(bad);})(%s)'''
S = admin_site.Site(fonts=False)
try:
    # ---- a. main landmark and skip link ----
    for page, what in (('/index.html', 'home'), ('/nsw.html', 'offer page'), ('/see-a-night.html', '/see-a-night')):
        tid, sid = load(S, page)
        M = S.json(sid, '''JSON.stringify((function(){var m=document.querySelectorAll("main"),a=document.querySelector("a.vp-skip");var hd=document.querySelector("header"),ft=document.querySelector("footer");
          return {n:m.length,id:m[0]&&m[0].id,href:a&&a.getAttribute("href"),headIn:!!(hd&&m[0]&&m[0].contains(hd)),footIn:!!(ft&&m[0]&&m[0].contains(ft)),h1In:!!(m[0]&&m[0].querySelector("h1")),
          offscreen:a&&a.getBoundingClientRect().bottom<=0}})())''')
        ok('%s: one <main id="main">, with the page heading inside it, and the skip link points at it' % what, M['n'] == 1 and M['id'] == 'main' and M['href'] == '#main' and M['h1In'], M)
        ok('%s: the header and the footer sit outside <main>' % what, not M['headIn'] and not M['footIn'], M)
        ok('%s: the skip link is out of sight until it has focus' % what, M['offscreen'] is True, M)
        r = tab_to(S, sid, 'e.classList.contains("vp-skip")', 3)
        ok('%s: the first Tab stop is the skip link, and it is on screen when focused' % what, bool(r) and 0 <= r['top'] < 80, r)
        key(S, sid, 'Enter', 'Enter', 13)
        time.sleep(0.5)
        ok('%s: Enter on the skip link moves to the content' % what, S.js(sid, 'location.hash') == '#main', S.js(sid, 'location.hash'))
        S.close_tab(tid)
    # ---- b. player pages: one h1 ----
    for page, what, want in (('/play.html', '/play', 'Join'), ('/app/trivia/play.html', 'the trivia player', 'trivia'), ('/app/musical/play.html', 'the musical bingo player', 'musical bingo')):
        tid, sid = load(S, page, 375, 812, True, 2.0)
        h = S.json(sid, H1S)
        ok('%s: exactly one h1, and it says what the page is' % what, len(h) == 1 and want.lower() in h[0].lower(), h)
        S.close_tab(tid)
    tid, sid = load(S, '/play.html', 375, 812, True, 1.5)
    d = S.js(sid, '(document.querySelector("meta[name=description]")||{}).content||""')
    ok('/play has a meta description of a sentence', isinstance(d, str) and len(d) > 60, d)
    S.close_tab(tid)
    # ---- c. a ring for a keyboard user ----
    for page in ('/index.html', '/nsw.html'):
        tid, sid = load(S, page)
        S.js(sid, 'document.querySelectorAll("#faq details").forEach(function(d){d.open=true})')
        for txt, want in (('venueplay TV app', 'e.tagName==="A"&&/venueplay TV app/.test(e.textContent)'), ('Help page', 'e.tagName==="A"&&/^Help page$/.test(e.textContent.trim())')):
            r = tab_to(S, sid, want, 220)
            ok('%s: tabbing to the "%s" link shows a ring' % (page, txt), bool(r) and r['ol'] != 'none' and r['olw'] >= 2, r)
        S.close_tab(tid)
    tid, sid = load(S, '/play.html', 375, 812, True, 2.0)
    S.js(sid, 'var i=document.getElementById("roomIn");i.value="ACDE23";i.dispatchEvent(new Event("input",{bubbles:true}))'); time.sleep(0.6)
    r = tab_to(S, sid, 'e.id==="roomBtn"', 12)
    ok('/play: tabbing to the Continue button shows a ring', bool(r) and r['ol'] != 'none' and r['olw'] >= 2, r)
    S.close_tab(tid)
    # ---- d. header taps ----
    for page, sel, what in (('/help.html', 'header .logo', 'the logo'), ('/terms.html', 'header .brand', 'the logo'), ('/terms.html', 'header .back', '"Back to site"'),
                            ('/privacy.html', 'header .brand', 'the logo'), ('/privacy.html', 'header .back', '"Back to site"')):
        for w in (375, 390):
            tid, sid = load(S, page, w, 844, True, 1.2)
            M = S.json(sid, 'JSON.stringify((function(){var e=document.querySelector("%s"),r=e.getBoundingClientRect(),h=document.querySelector("header").getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),bar:Math.round(h.height)}})())' % sel)
            ok('%s %d px: %s is a 44px tap, the bar keeps its height' % (page, w, what), M['h'] >= 44 and M['w'] >= 44 and M['bar'] in (65, 69), M)
            S.close_tab(tid)
    # ---- e, f, g. HQ ----
    tid, sid = load(S, '/app/hq.html?as=admin', 1280, 900, False, 3.0)
    ids = ['venueSearch', 'venueFilter', 'cxFilter', 'gSearch', 'gFilter', 'goMonths', 'screensAction', 'reloadScreensWhen', 'tmName', 'tmMobile', 'tmRole', 'tmEmail', 'rpQuery', 'rlQuery', 'xeroFrom', 'xeroTo', 'nvComplianceBy']
    bad = S.json(sid, NAMED % json.dumps(ids))
    ok('HQ: the filters, search boxes, date boxes and team boxes have an accessible name', not bad, bad)
    S.js(sid, 'document.getElementById("hdTab").click()'); S.until(sid, '!!document.getElementById("hdfQ")', 20); time.sleep(1.0)
    bad = S.json(sid, NAMED % json.dumps(['hdfQ', 'hdfBrand', 'hdfCat', 'hdfCh', 'hdfVenue']))
    ok('HQ help desk: the search box and the four filters have an accessible name', not bad, bad)
    ok('HQ: the tab title is "venueplay: Admin"', S.js(sid, 'document.title') == 'venueplay: Admin', S.js(sid, 'document.title'))
    h = S.json(sid, H1S)
    ok('HQ: one h1, "venueplay Admin"', h == ['venueplay Admin'], h)
    M = S.json(sid, 'JSON.stringify((function(){var e=document.querySelector("h1"),c=getComputedStyle(e);return {m:c.marginTop+" "+c.marginBottom,fs:c.fontSize,fw:c.fontWeight}})())')
    ok('HQ: the h1 looks as the old heading did (22px, 800, no margin)', M == {'m': '0px 0px', 'fs': '22px', 'fw': '800'}, M)
    S.close_tab(tid)
    # ---- g. consoles ----
    for page, word, look in (('/app/trivia/host.html', 'Trivia', '11px|700'), ('/app/musical/host.html', 'Musical Bingo', '11px|700'), ('/app/raffle/host.html', 'Raffle', '14px|800'), ('/app/members/host.html', 'Members Draw', '14px|800')):
        tid, sid = load(S, page + '?as=owner', 1280, 900, False, 2.0)
        h = S.json(sid, H1S)
        ok('%s: one h1, "%s"' % (page, word), h == [word], h)
        M = S.json(sid, 'JSON.stringify((function(){var e=document.querySelector("h1"),c=getComputedStyle(e);return {m:c.marginTop+" "+c.marginBottom,fs:c.fontSize,fw:c.fontWeight}})())')
        ok('%s: the h1 has no margin and the size the span had (%s)' % (page, look), M['m'] == '0px 0px' and '%s|%s' % (M['fs'], M['fw']) == look, M)
        S.close_tab(tid)
    # ---- h. one h1 on /app/try and /live-here-now ----
    tid, sid = load(S, '/app/try.html?as=owner', 390, 844, True, 1.5)
    h = S.json(sid, H1S)
    ok('/app/try: one h1 (the other steps are h2)', h == ['Have a play for free'], h)
    M = S.json(sid, 'JSON.stringify([].map.call(document.querySelectorAll("h2.sh"),function(e){var c=getComputedStyle(e);return [c.fontSize,c.fontWeight,c.marginTop,c.marginBottom,c.lineHeight].join("|")}))')
    ok('/app/try: the four step headings keep the old heading look', len(M) == 4 and set(M) == {'25px|800|0px|10px|30px'}, M)
    S.close_tab(tid)
    tid, sid = load(S, '/live-here-now', 375, 812, True, 2.0)
    h = S.json(sid, H1S)
    ok('/live-here-now: one h1, the header name', h == ['60-second trivia'], h)
    M = S.json(sid, 'JSON.stringify((function(){var c=getComputedStyle(document.querySelector("h1"));return [c.fontSize,c.fontWeight,c.marginTop,c.marginBottom].join("|")})())')
    ok('/live-here-now: the header h1 looks as the span did (20px, 800, no margin)', M == '20px|800|0px|0px', M)
    M = S.json(sid, '''JSON.stringify([].map.call(document.querySelectorAll("h2.pbig,h2.q,#scoreN"),function(e){e.hidden=false;var p=e.parentNode;while(p&&p!==document.body){p.hidden=false;p=p.parentNode}var c=getComputedStyle(e);return [e.id,c.marginTop,c.marginBottom,c.fontSize,c.fontWeight].join("|")}))''')
    ok('/live-here-now: the four step headings keep their size and spacing', M == ['nameHead|8px|0px|39.375px|400', 'whereHead|8px|0px|39.375px|400', 'q|0px|0px|24px|800', 'scoreN|6px|0px|82.5px|400'], M)
    S.close_tab(tid)
    # ---- f. titles, read from what the site serves ----
    tid, sid = load(S, '/index.html', 800, 600, False, 0.5)
    PAGES = ['/app/billing.html', '/app/index.html', '/app/settings.html', '/app/hq.html', '/app/report.html', '/app/marketing.html', '/app/sound-help.html', '/add-card.html', '/rate/index.html',
             '/prospect/cancel/index.html', '/app/trivia/builder.html', '/app/trivia/host.html', '/app/trivia/play.html', '/app/trivia/screen.html', '/app/musical/host.html', '/app/musical/play.html',
             '/app/musical/screen.html', '/app/raffle/host.html', '/app/raffle/screen.html', '/app/members/host.html', '/app/members/screen.html', '/app/topanswers/screen.html', '/app/purchase-raffle/index.html',
             '/play.html', '/tv.html', '/training.html', '/signage.html', '/app/onboard.html', '/app/try.html']
    out = S.js(sid, '''(function(pages){return Promise.all(pages.map(function(p){return fetch(p).then(function(r){return r.text()}).then(function(t){var m=/<title>([^<]*)<\\/title>/.exec(t);return [p,m?m[1]:"(none)"]})})).then(function(a){return JSON.stringify(a)})})(%s)''' % json.dumps(PAGES), wait=True, secs=40)
    rows = json.loads(out) if isinstance(out, str) else []
    wrong = [r for r in rows if not (r[1].startswith('venueplay: ') and len(r[1]) > 14 and '·' not in r[1])]
    ok('every in-app and player page title reads "venueplay: <page>" (%d pages)' % len(rows), len(rows) == len(PAGES) and not wrong, wrong or out)
    S.close_tab(tid)
    # ---- i. share tags on terms and privacy ----
    for page, canon in (('/terms.html', 'https://venueplay.com.au/terms'), ('/privacy.html', 'https://venueplay.com.au/privacy')):
        tid, sid = load(S, page, 800, 600, False, 0.8)
        M = S.json(sid, '''JSON.stringify((function(){function m(p){var e=document.querySelector('meta[property="'+p+'"],meta[name="'+p+'"]');return e&&e.content}
          return {t:m("og:title"),d:m("og:description"),u:m("og:url"),i:m("og:image"),c:m("twitter:card"),ti:m("twitter:image"),title:document.title,desc:m("description")}})())''')
        ok('%s: share title, description, url and image are there' % page, M['t'] == M['title'] and M['d'] == M['desc'] and M['u'] == canon and (M['i'] or '').startswith('https://venueplay.com.au/logos/venueplay-share.png') and M['c'] == 'summary_large_image' and M['ti'] == M['i'], M)
        S.close_tab(tid)
    tid, sid = load(S, '/index.html', 800, 600, False, 0.5)
    st = S.js(sid, 'fetch("/logos/venueplay-share.png").then(function(r){return r.status+" "+r.headers.get("content-type")})', wait=True)
    ok('the share image the tags name is served', st == '200 image/png', st)
    S.close_tab(tid)
finally:
    S.close()
print('\nALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '\n%d OF %d CHECKS FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
