#!/usr/bin/env python3
"""THE HOMEPAGE PRICE AND THE PUBLIC FOOTER, IN CHROME, AT PHONE WIDTH (Dean's phone test, 29 Oct 2026).

Two things Dean found on his phone, both of which only a browser laying the page out can see:

  1. NO OFFER ON THE HOMEPAGE. Dean, 29 Oct 2026: "Never put offers on the home page unless I say so."
     The offer page (/nsw, /offer-<mon>) reads its rows from venueplay/app/vp-offer.js; the homepage
     sells the standard rate. With the month's code LIVE in the REAL billing Worker
     (tools/browser-rig/admin_site.py, jsc) and the clock pinned inside that month (read from the
     file, never the machine's date), this opens the homepage and checks it shows no offer price, no
     closing day and no struck-out price, does not load vp-offer.js or ask the Worker about a code,
     and that a signup sends no offer code, so the Worker asks Stripe for the STANDARD price. And
     that the offer page still picks its row from the shared file.

  2. THE FOOTER. At 390 px the logo, "Powered by Gflam Touring", the Facebook and Instagram icons and
     the link row did not line up, the links wrapped leaving a dot at the end of a line, and the pink
     sticky bar covered the copyright line. On every public page with that footer (home, the offer
     page, help, terms, privacy) this measures, scrolled to the bottom: each part centred, each line
     of links centred with no dot showing, the copyright line wholly above the sticky bar, and no
     sideways scroll. And once at desktop width, that the footer there is as it was.

    python3 tools/site-offer-footer-in-chrome.test.py [--shots DIR] [--root CHECKOUT]
"""
import argparse, calendar, datetime, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
ap.add_argument('--root', default=ROOT)
A = ap.parse_args()

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:500],)) if detail != '' else ''))


# ---- the offer the file is written for, and a moment inside its month and one after it ----
OFFER_JS = open(os.path.join(A.root, 'venueplay', 'app', 'vp-offer.js'), encoding='utf-8').read()
WF = re.search(r"var\s+WRITTEN_FOR\s*=\s*'([a-z]{3})'", OFFER_JS).group(1)
ROW = re.search(WF + r":\s*\{\s*code:\s*'(OFFER-([A-Z]{3})-(20\d\d))',\s*date:\s*'([^']+)',\s*day:\s*'([^']+)'", OFFER_JS)
CODE, MON3, YEAR, DATE, DAY = ROW.group(1), ROW.group(2), int(ROW.group(3)), ROW.group(4), ROW.group(5)
MI = [m.upper()[:3] for m in calendar.month_name].index(MON3)
END_UTC = datetime.datetime(YEAR + (MI == 12), MI % 12 + 1, 1, tzinfo=datetime.timezone.utc) - datetime.timedelta(hours=10)
INSIDE_MS = int((END_UTC - datetime.timedelta(days=5)).timestamp() * 1000)
AFTER_MS = int((END_UTC + datetime.timedelta(days=2)).timestamp() * 1000)


def money(n):
    return '$%s' % (('%.2f' % n) if n % 1 else '%d' % n)


def m2(n):
    return '$%.2f' % n


def pre(clock_ms):
    """Before the page's own scripts: a fixed clock for Date.now, and a note of every address the page fetches."""
    return ('(function(){var T=%d,p0=performance.now();Date.now=function(){return T+Math.floor(performance.now()-p0);};'
            'window.__asked=[];var rf=window.fetch;window.fetch=function(u){window.__asked.push(String(u));return rf.apply(this,arguments);};})();') % clock_ms


KEEP = ('(function(){ window.__checkout=[]; var real=window.fetch; window.fetch=function(u,o){'
        ' if(!/\\/checkout$/.test(String(u))) return real.apply(this, arguments);'
        ' var sent=null; try{ sent=JSON.parse(o.body); }catch(e){}'
        ' return real.apply(this, arguments).then(function(r){ return r.json().then(function(j){'
        '   window.__checkout.push({ sent:sent, status:r.status, body:JSON.parse(JSON.stringify(j)) });'
        '   if(j && j.url) j.url="#went-to-stripe"; if(j) delete j.client_secret;'
        '   return new Response(JSON.stringify(j), { status:r.status, headers:{ "Content-Type":"application/json" } }); }); }); };'
        ' return true; })()')

FILL = ('(function(){var $=function(i){return document.getElementById(i)};'
        'var r=document.querySelector("#vp-venue-list .venue-row");r.querySelector(".v-name").value="Kirra Beach Hotel";'
        'var s=r.querySelector(".v-seats");s.value="80";s.dispatchEvent(new Event("input",{bubbles:true}));'
        'var p=r.querySelector(".v-postcode");p.value="4225";p.dispatchEvent(new Event("input",{bubbles:true}));'
        'document.querySelector(\'#vp-entity-seg [data-entity="for_profit"]\').click();'
        '$("vp-name").value="Kim Offer";$("vp-email").value="kim@kirrabeachhotel.com.au";$("vp-mobile").value="0412 345 678";$("vp-consent").checked=true;'
        'return true;})()')

CARD = ('JSON.stringify({rows:Array.prototype.map.call(document.querySelectorAll("#priceRows .price-row"),function(r){return r.querySelector("b").textContent+"="+r.querySelector(".pv").textContent.replace(/\\s+/g," ").trim();}),'
        'title:document.getElementById("offerTitle").textContent,sub:document.getElementById("offerSub").textContent,foot:document.getElementById("priceFootRate").textContent,'
        'hero:document.getElementById("heroRate").textContent,faq:document.getElementById("faqCost").textContent,bill:document.getElementById("faqBillingRate").textContent,'
        'incl:document.getElementById("inclPrice").textContent,plans:[document.getElementById("planMonthlyRate").textContent,document.getElementById("planAnnualRate").textContent],'
        'est:document.getElementById("vp-estimate").textContent,offer:document.documentElement.getAttribute("data-offer"),'
        'all:document.body.innerText})')

# Scrolled to the bottom: where each part of the footer sits, and what is under the sticky bar.
FOOT = r'''(function(){
  window.scrollTo({top: document.documentElement.scrollHeight, behavior: "instant"});
  var f = document.querySelector("footer"); if (!f) return JSON.stringify({none:true});
  var mid = function (el) { if (!el) return null; var r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); };
  var lines = {}, lineTxt = {}, links = f.querySelectorAll(".foot-links a");
  Array.prototype.forEach.call(links, function (a) { var r = a.getBoundingClientRect(); var k = Math.round(r.top / 6);
    (lines[k] = lines[k] || []).push([r.left, r.right]); (lineTxt[k] = lineTxt[k] || []).push(a.textContent.trim()); });
  var lineTexts = Object.keys(lineTxt).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return lineTxt[k].join(' | '); });
  var lineMids = Object.keys(lines).map(function (k) { var L = lines[k]; return Math.round((Math.min.apply(null, L.map(function (x) { return x[0]; })) + Math.max.apply(null, L.map(function (x) { return x[1]; }))) / 2); });
  var dots = Array.prototype.filter.call(f.querySelectorAll(".foot-links .dot"), function (d) { return d.getBoundingClientRect().width > 0; }).length;
  var copy = null, w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { if (/Gflam Group Pty Ltd/.test(w.currentNode.nodeValue)) copy = w.currentNode; }
  function rgc(n){ var q = document.createRange(); q.selectNodeContents(n); return q.getBoundingClientRect(); }
  var cb = null, oneLine = false; if (copy) { var rg = document.createRange(); rg.selectNodeContents(copy); cb = rg.getBoundingClientRect().bottom;
    var yr = f.querySelector("#vp-year"), rr = rg.getClientRects(); oneLine = !!yr && rr.length === 1 && Math.abs(yr.getBoundingClientRect().top - rr[0].top) <= 4; }
  var bar = document.querySelector(".vp-float-cta.show"), barTop = bar ? bar.getBoundingClientRect().top : innerHeight;
  return JSON.stringify({ vw: innerWidth, sw: document.documentElement.scrollWidth, brand: mid(f.querySelector(".foot-brand")),
    textBottom: (function (t) { return t ? Math.round(t.getBoundingClientRect().bottom) : null; })(f.querySelector(".powered .powered-by-text")),
    textW: (function (t) { return t ? Math.round(t.getBoundingClientRect().width) : 0; })(f.querySelector(".powered .powered-by-text")),
    textMid: mid(f.querySelector(".powered .powered-by-text")),
    poweredTop: (function (i) { return i ? Math.round(i.getBoundingClientRect().top) : 0; })(f.querySelector(".powered img.powered-by")),
    poweredH: (function (i) { return i ? Math.round(i.getBoundingClientRect().height * 10) / 10 : null; })(f.querySelector(".powered img.powered-by")),
    poweredW: (function (i) { return i ? Math.round(i.getBoundingClientRect().width * 10) / 10 : null; })(f.querySelector(".powered img.powered-by")),
    /* the venueplay letters' own width: the inline wordmark is drawn edge to edge; the primary logo file
       (viewBox -101 -829 4876 1136) has 100 units of glow room either side of its 4676-unit letters */
    markW: (function (b) { var i = b && b.querySelector("img[src*='venueplay-primary']"), v = b && b.querySelector("svg[data-vp-mark='wordmark']");
      if (i) return Math.round(i.getBoundingClientRect().width * 4676 / 4876 * 10) / 10; if (v) return Math.round(v.getBoundingClientRect().width * 10) / 10; return null; })(f.querySelector(".foot-brand")),
    gapAbove: Math.round(parseFloat(getComputedStyle(f).marginTop)), padTop: Math.round(parseFloat(getComputedStyle(f).paddingTop)),
    powered: mid(f.querySelector(".powered")), social: mid(f.querySelector(".foot-social")), lineMids: lineMids, lineCount: lineMids.length, lineTexts: lineTexts, copyW: (function(){ return copy ? Math.round((function(r){return r.width;})(rgc(copy))) : 0; })(), copyFs: copy ? parseFloat(getComputedStyle(copy.parentNode).fontSize) : 0,
    links: links.length, dots: dots, copyBottom: cb, oneLine: oneLine, barTop: barTop, bar: !!bar, dir: getComputedStyle(f.querySelector(".foot")).flexDirection });
})()'''


def shot(S, sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'))


def card(S, sid):
    v = S.js(sid, CARD)
    return json.loads(v) if isinstance(v, str) else {}


S = admin_site.Site(root=A.root, fonts=bool(A.shots))
try:
    print('THE HOMEPAGE NEVER SHOWS AN OFFER, EVEN INSIDE THE %s OFFER WITH ITS CODE LIVE' % MON3)
    S.W.env(FOUNDING_CODES=CODE)
    tid, sid = S.open('/index.html', 390, 844, mobile=True, pre=pre(INSIDE_MS))
    S.until(sid, '!!document.getElementById("vp-submit") && !!document.querySelector("#offer .price-card")', 20)
    time.sleep(1.5)
    h = S.js(sid, ('JSON.stringify({all:document.body.innerText, s:document.querySelectorAll("#offer s, #offer .price-row.list").length,'
                   'rows:Array.prototype.map.call(document.querySelectorAll("#offer .price-row"),function(r){return r.querySelector("b").textContent+"="+r.querySelector(".pv").textContent.trim();}),'
                   'scripts:Array.prototype.map.call(document.scripts,function(x){return x.src||"";}).filter(function(x){return /vp-offer/.test(x);}).length,'
                   'asked:window.__asked.filter(function(u){return /\\/founding/.test(u);}).length, offer:!!window.VPOffer})'))
    h = json.loads(h) if isinstance(h, str) else {}
    allt = h.get('all', '')
    ok('the pricing card is the standard rate: Monthly $3.00, Annual $2.85, nothing struck out',
       h.get('rows') == ['Monthly=$3.00', 'Annual=$2.85'] and h.get('s') == 0, h.get('rows'))
    ok('no offer price and no closing day anywhere on the homepage ($2.50, $2.30, "%s", "%s")' % (DAY, CODE),
       not re.search(r'\$2\.(50|30)\b', allt) and DAY not in allt and DATE not in allt and CODE not in allt,
       re.findall(r'.{30}(?:\$2\.50|\$2\.30|%s).{30}' % re.escape(DAY), allt)[:3])
    ok('the price words say the per-player rate never changes and only the monthly bill moves, with a plan move up '
       '(no "the only time your monthly changes" beside "the rate never changes"; Dean, 4 Nov 2026)',
       'Your rate of $3 per player, per month, never changes. Your monthly bill moves only when your plan moves up.' in allt
       and 'Your rate per player never changes: that plan move is the only thing that changes your monthly bill.' in allt
       and 'only time your monthly changes' not in allt, re.findall(r'.{0,60}never changes.{0,80}', allt)[:3])
    ok('the homepage does not load the offer file or ask the Worker about a code',
       h.get('scripts') == 0 and h.get('asked') == 0 and h.get('offer') is False, h)
    S.js(sid, 'document.getElementById("offer").scrollIntoView({block:"start",behavior:"instant"}); window.scrollBy(0,-60); true')
    time.sleep(0.4)
    shot(S, sid, 'home-pricing-standard-390')
    S.js(sid, KEEP)
    S.js(sid, FILL)
    time.sleep(0.4)
    est = S.js(sid, 'document.getElementById("vp-estimate").textContent') or ''
    ok('the estimate prices 80 players at the standard $3.00', '80 players \u00d7 $3.00' in est, est)
    S.js(sid, 'document.getElementById("vp-submit").click(); true')
    S.until(sid, 'window.__checkout.length===1', 15)
    got = S.js(sid, 'JSON.stringify(window.__checkout[0]||null)')
    ck = json.loads(got) if isinstance(got, str) else None
    stripe = [x for x in S.W.stripe() if '/checkout/sessions' in x.get('url', '')]
    ok('a homepage signup sends no offer code, and the real Worker asks Stripe for the STANDARD price',
       bool(ck) and not ck['sent'].get('founding_code') and ck['status'] == 200 and bool(stripe)
       and 'price_S_M' in stripe[-1]['body'] and 'price_F_M' not in stripe[-1]['body'], (ck and ck['sent'].get('founding_code'), stripe[-1:] and stripe[-1]['body'][:300]))
    ok('no script error on the homepage', S.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', S.js(sid, 'JSON.stringify(window.__errs||[])'))
    S.close_tab(tid)

    print('\nTHE OFFER PAGE READS THE SAME FILE')
    tid, sid = S.open('/nsw.html', 390, 844, mobile=True, pre=pre(INSIDE_MS))
    S.until(sid, '!!window.VP_OFFER', 20)
    o = S.js(sid, 'JSON.stringify({code:window.VP_OFFER.code,days:Array.prototype.map.call(document.querySelectorAll(".vpc-day"),function(e){return e.textContent;}),same:window.VP_OFFER===VPOffer.OFFERS.oct})')
    o = json.loads(o) if isinstance(o, str) else {}
    ok('/nsw (no month in its address) still shows the October row, from VPOffer, in every vpc-day span',
       o.get('code') == 'OFFER-OCT-2026' and o.get('same') is True and o.get('days') and all(d == '31 October' for d in o['days']), o)
    S.close_tab(tid)

    print('\nTHE FOOTER AT 390 PX, SCROLLED TO THE BOTTOM')
    for page, name in (('/index.html', 'home'), ('/nsw.html', 'the offer page'), ('/help.html', 'help'), ('/terms.html', 'terms'), ('/privacy.html', 'privacy')):
        tid, sid = S.open(page, 390, 844, mobile=True, pre=pre(INSIDE_MS))
        S.until(sid, '!!document.querySelector("footer .foot-links")', 20)
        time.sleep(1.0)
        S.js(sid, 'window.scrollTo({top: document.documentElement.scrollHeight, behavior: "instant"}); true')
        time.sleep(0.8)
        v = S.js(sid, FOOT)
        f = json.loads(v) if isinstance(v, str) else {}
        mid = (f.get('vw') or 390) / 2.0
        centred = all(x is not None and abs(x - mid) <= 3 for x in (f.get('brand'), f.get('powered'), f.get('social')))
        ok('%s: the logo, "Powered by Gflam Touring" and the social icons are centred' % name, centred, f)
        ok('%s: the powered-by block is two lines, centred: "powered by" over the Gflam logo, the Gflam logo about 104px wide, no wider than the screen (Dean, 5 Nov 2026)' % name,
           f.get('poweredW') and 98 <= f['poweredW'] <= 110 and f.get('textBottom') is not None
           and f['textBottom'] <= f.get('poweredTop', 0) + 1 and f.get('textW', 0) > 20 and abs(f.get('textMid', 0) - mid) <= 3 and f['poweredW'] <= f.get('vw', 0), (f.get('poweredW'), f.get('markW'), f.get('poweredH')))
        ok('%s: the footer sits lower, with a tad less room above it than before (about 25%% less, 48px), sized for a phone: 44 to 52px of space and 44 to 56px inside before the logo' % name,
           44 <= f.get('gapAbove', 0) <= 52 and 44 <= f.get('padTop', 0) <= 56, (f.get('gapAbove'), f.get('padTop')))
        ok('%s: every line of links is centred, and no dot is left at the end of a line' % name,
           f.get('links', 0) >= 4 and f.get('lineCount', 0) >= 1 and all(abs(x - mid) <= 3 for x in f.get('lineMids', [])) and f.get('dots') == 0, f)
        LT = f.get('lineTexts') or []
        ok('%s: the footer links sit on three centred lines, grouped as page links / FAQs, Help, Contact / Privacy, Terms (Dean, 5 Nov 2026)' % name,
           len(LT) == 3 and LT[2] == 'Privacy | Terms' and LT[0].split(' | ')[0] in ('Play', 'Home')
           and (LT[1] == 'FAQs | Help | Contact' or (page in ('/terms.html', '/privacy.html') and LT[1] == 'Help')), LT)
        ok('%s: the copyright line is on ONE line at 390, in a font of 11px or more' % name,
           f.get('oneLine') is True and f.get('copyW', 999) <= f.get('vw', 0) - 24 and f.get('copyFs', 0) >= 11, (f.get('copyW'), f.get('copyFs'), f.get('oneLine')))
        ok('%s: the copyright line is one line ("(c) 2026 Gflam Group..."), wholly above the sticky bar%s, and nothing scrolls sideways' % (name, '' if page in ('/help.html', '/terms.html', '/privacy.html') else ' (shown)'),
           f.get('copyBottom') is not None and f.get('oneLine') is True and f['copyBottom'] <= f['barTop'] - 4 and f.get('sw', 999) <= f.get('vw', 0)
           and (f.get('bar') or page in ('/help.html', '/terms.html', '/privacy.html')), f)
        shot(S, sid, 'footer-%s-390' % page.strip('/').replace('.html', ''))
        S.close_tab(tid)

    print('\nTHE FOOTER AT 375px')
    for page in ('/index.html', '/nsw.html', '/help.html', '/terms.html', '/privacy.html'):
        tid, sid = S.open(page, 375, 812, mobile=True, pre=pre(INSIDE_MS))
        S.until(sid, '!!document.querySelector("footer .foot-links")', 20)
        time.sleep(0.8)
        S.js(sid, 'window.scrollTo({top: document.documentElement.scrollHeight, behavior: "instant"}); true')
        time.sleep(0.6)
        v = S.js(sid, FOOT)
        f = json.loads(v) if isinstance(v, str) else {}
        ok('%s at 375: the copyright is one line, the links are three lines, and nothing scrolls sideways' % page,
           f.get('oneLine') is True and f.get('copyW', 999) <= 375 - 24 and f.get('lineCount') == 3 and f.get('sw', 999) <= 375, (f.get('oneLine'), f.get('copyW'), f.get('lineCount'), f.get('sw')))
        S.close_tab(tid)

    print('\nTHE POWERED-BY BLOCK FITS A 320px SCREEN')
    tid, sid = S.open('/index.html', 320, 640, mobile=True, pre=pre(INSIDE_MS))
    S.until(sid, '!!document.querySelector("footer .foot-links")', 20)
    time.sleep(0.8)
    S.js(sid, 'window.scrollTo({top: document.documentElement.scrollHeight, behavior: "instant"}); true')
    time.sleep(0.6)
    v = S.js(sid, FOOT)
    f = json.loads(v) if isinstance(v, str) else {}
    ok('at 320px the two-line powered-by block is inside the screen, the logo 98 to 110px, and nothing scrolls sideways',
       f.get('poweredW') and 98 <= f['poweredW'] <= 110 and f.get('sw', 999) <= 320 and f.get('textBottom') is not None, (f.get('poweredW'), f.get('sw')))
    S.close_tab(tid)

    print('\nTHE FOOTER AT DESKTOP WIDTH IS AS IT WAS')
    tid, sid = S.open('/index.html', 1280, 900, pre=pre(INSIDE_MS))
    S.until(sid, '!!document.querySelector("footer .foot-links")', 20)
    time.sleep(0.8)
    v = S.js(sid, FOOT)
    f = json.loads(v) if isinstance(v, str) else {}
    ok('desktop: the footer is still a row, with the dots between the links', f.get('dir') == 'row' and f.get('dots') == f.get('links', 0) - 1 and f.get('lineCount') == 1, f)
    ok('desktop: the footer has 90px or more of space above it and the powered-by Gflam logo is about 104px wide (Dean, 5 Nov 2026)',
       f.get('gapAbove', 0) >= 90 and f.get('padTop', 0) >= 60 and f.get('poweredW') and 98 <= f['poweredW'] <= 110,
       (f.get('gapAbove'), f.get('padTop'), f.get('poweredW'), f.get('markW')))
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 51   # +5: the powered-by line measured on each page (3 Nov 2026 evening); +7 (4 Nov 2026): the footer gap on each page, the desktop footer, the price words
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
