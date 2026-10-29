#!/usr/bin/env python3
"""THE HOMEPAGE PRICE AND THE PUBLIC FOOTER, IN CHROME, AT PHONE WIDTH (Dean's phone test, 29 Oct 2026).

Two things Dean found on his phone, both of which only a browser laying the page out can see:

  1. THE PRICE. The offer page said "$2.50 a player, if you lock it in by 30 November"; the homepage
     card said Monthly $3.00 and "Your rate is $3 per player, per month, and it never changes." Both
     pages now read the month's offer from ONE file, venueplay/app/vp-offer.js. This opens the REAL
     homepage with the REAL billing Worker behind it (tools/browser-rig/admin_site.py, jsc) and checks
     that, inside the offer's month with its code live, every price on the page is the offer's, the
     $3 standard rate is named as the price after the closing day, and a signup sends the code so the
     Worker charges the offer price (the Stripe price it asks for). Then with the code shut in the
     Worker (the page goes back to $3 and sends no code), and after the month has ended (the page
     never offers it). The clock is pinned inside and after the month the FILE names, never read
     from the machine's own date.

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
RATE = lambda kind, plan: float(re.search(kind + r":\s*\{\s*monthly:\s*([\d.]+),\s*annual:\s*([\d.]+)", OFFER_JS).group(1 if plan == 'monthly' else 2))
OM, OA, SM, SA = RATE('offer', 'monthly'), RATE('offer', 'annual'), RATE('standard', 'monthly'), RATE('standard', 'annual')
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
  var lines = {}, links = f.querySelectorAll(".foot-links a");
  Array.prototype.forEach.call(links, function (a) { var r = a.getBoundingClientRect(); var k = Math.round(r.top / 6);
    (lines[k] = lines[k] || []).push([r.left, r.right]); });
  var lineMids = Object.keys(lines).map(function (k) { var L = lines[k]; return Math.round((Math.min.apply(null, L.map(function (x) { return x[0]; })) + Math.max.apply(null, L.map(function (x) { return x[1]; }))) / 2); });
  var dots = Array.prototype.filter.call(f.querySelectorAll(".foot-links .dot"), function (d) { return d.getBoundingClientRect().width > 0; }).length;
  var copy = null, w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { if (/Gflam Group Pty Ltd/.test(w.currentNode.nodeValue)) copy = w.currentNode; }
  var cb = null, oneLine = false; if (copy) { var rg = document.createRange(); rg.selectNodeContents(copy); cb = rg.getBoundingClientRect().bottom;
    var yr = f.querySelector("#vp-year"), rr = rg.getClientRects(); oneLine = !!yr && rr.length >= 1 && Math.abs(yr.getBoundingClientRect().top - rr[0].top) <= 4; }
  var bar = document.querySelector(".vp-float-cta.show"), barTop = bar ? bar.getBoundingClientRect().top : innerHeight;
  return JSON.stringify({ vw: innerWidth, sw: document.documentElement.scrollWidth, brand: mid(f.querySelector(".foot-brand")),
    powered: mid(f.querySelector(".powered")), social: mid(f.querySelector(".foot-social")), lineMids: lineMids, lineCount: lineMids.length,
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
    print('THE HOMEPAGE, INSIDE THE %s OFFER, ITS CODE LIVE IN THE WORKER' % MON3)
    S.W.env(FOUNDING_CODES=CODE)
    tid, sid = S.open('/index.html', 390, 844, mobile=True, pre=pre(INSIDE_MS))
    S.until(sid, 'document.documentElement.getAttribute("data-offer")===%s && window.__asked.some(function(u){return /\\/founding\\?code=/.test(u);})' % json.dumps(CODE), 20)
    time.sleep(1.2)       # the Worker's answer has come back and been acted on
    c = card(S, sid)
    ok('the page shows the month\'s offer, and asked the Worker whether %s is open' % CODE,
       c.get('offer') == CODE and any(('/founding?code=' + CODE) in u for u in (S.js(sid, 'window.__asked') or [])), c.get('offer'))
    ok('the card: Monthly %s struck to %s, Annual %s struck to %s, and the standard %s named as the price after %s'
       % (m2(SM), m2(OM), m2(SA), m2(OA), m2(SM), DAY),
       c.get('rows') == ['Monthly=%s %s' % (m2(SM), m2(OM)), 'Annual=%s %s' % (m2(SA), m2(OA)), 'After %s=%s' % (DAY, m2(SM))], c.get('rows'))
    ok('the heading and the words beside the card say the offer and its closing day, and $3 as the standard rate',
       money(OM) in c.get('title', '') and DAY in c.get('title', '') and DATE in c.get('sub', '') and ('standard rate is ' + money(SM)) in c.get('sub', ''), [c.get('title'), c.get('sub')])
    ok('"it never changes" is gone; the small print says the offer rate is kept while the subscription stays active',
       'never changes' not in c.get('all', '') and DAY in c.get('foot', '') and 'for as long as your subscription stays active' in c.get('foot', ''), c.get('foot'))
    ok('the hero, "what you get", both FAQ answers and the plan buttons all say the offer price',
       money(30 * OM) in c.get('hero', '') and money(OM) in c.get('incl', '') and money(OM) in c.get('faq', '') and m2(OA) in c.get('faq', '')
       and money(OM) in c.get('bill', '') and c.get('plans') == ['%s / player' % m2(OM), '%s / player' % m2(OA)],
       [c.get('hero'), c.get('incl'), c.get('faq'), c.get('bill'), c.get('plans')])
    ok('no price anywhere on the page still says the standard rate is what they will pay',
       ('pays %s a month' % money(30 * SM)) not in c.get('all', '') and ('%s / player' % m2(SM)) not in c.get('all', ''), '')
    S.js(sid, 'document.getElementById("offer").scrollIntoView({block:"start",behavior:"instant"}); window.scrollBy(0,-60); true')
    time.sleep(0.4)
    shot(S, sid, 'home-pricing-offer-390')
    S.js(sid, KEEP)
    S.js(sid, FILL)
    time.sleep(0.4)
    est = S.js(sid, 'document.getElementById("vp-estimate").textContent') or ''
    ok('the estimate prices 80 players at the offer rate', ('80 players × %s' % m2(OM)) in est, est)
    S.js(sid, 'document.getElementById("vp-submit").click(); true')
    S.until(sid, 'window.__checkout.length===1', 15)
    got = S.js(sid, 'JSON.stringify(window.__checkout[0]||null)')
    ck = json.loads(got) if isinstance(got, str) else None
    stripe = [x for x in S.W.stripe() if '/checkout/sessions' in x.get('url', '')]
    ok('a signup sends the code, and the real Worker asks Stripe for the OFFER price, not the standard one',
       bool(ck) and ck['sent'].get('founding_code') == CODE and ck['status'] == 200 and bool(stripe)
       and 'price_F_M' in stripe[-1]['body'] and 'price_S_M' not in stripe[-1]['body'], (ck and ck['sent'].get('founding_code'), stripe[-1:] and stripe[-1]['body'][:300]))
    ok('no script error on the homepage', S.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', S.js(sid, 'JSON.stringify(window.__errs||[])'))
    S.close_tab(tid)

    print('\nTHE SAME MONTH, BUT THE WORKER SAYS THE CODE IS SHUT')
    S.W.env(FOUNDING_CODES='')
    tid, sid = S.open('/index.html', 390, 844, mobile=True, pre=pre(INSIDE_MS))
    S.until(sid, 'window.__asked.some(function(u){return /\\/founding\\?code=/.test(u);})', 20)
    S.until(sid, '!document.documentElement.getAttribute("data-offer")', 10)
    time.sleep(0.6)
    c = card(S, sid)
    ok('the page goes back to the standard rate, exactly as typed in the file',
       c.get('offer') is None and c.get('rows') == ['Monthly=%s' % m2(SM), 'Annual=%s' % m2(SA)] and 'never changes' in c.get('foot', '')
       and c.get('plans') == ['%s / player' % m2(SM), '%s / player' % m2(SA)], [c.get('offer'), c.get('rows'), c.get('foot')])
    S.js(sid, KEEP)
    S.js(sid, FILL)
    S.js(sid, 'document.getElementById("vp-submit").click(); true')
    S.until(sid, 'window.__checkout.length===1', 15)
    got = S.js(sid, 'JSON.stringify(window.__checkout[0]||null)')
    ck = json.loads(got) if isinstance(got, str) else None
    ok('and a signup sends no code: the venue is told $3 and charged $3', bool(ck) and ck['sent'].get('founding_code') == '', ck and ck['sent'])
    S.close_tab(tid)

    print('\nAFTER THE MONTH HAS ENDED')
    S.W.env(FOUNDING_CODES=CODE)
    tid, sid = S.open('/index.html', 390, 844, mobile=True, pre=pre(AFTER_MS))
    S.until(sid, '!!document.getElementById("priceRows")', 20)
    time.sleep(1.5)
    c = card(S, sid)
    asked = S.js(sid, 'window.__asked') or []
    ok('the page never offers an ended month, and does not even ask the Worker about it',
       c.get('offer') is None and c.get('rows') == ['Monthly=%s' % m2(SM), 'Annual=%s' % m2(SA)] and not any('/founding' in u for u in asked), [c.get('rows'), [u for u in asked if 'founding' in u]])
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
        ok('%s: every line of links is centred, and no dot is left at the end of a line' % name,
           f.get('links', 0) >= 4 and f.get('lineCount', 0) >= 1 and all(abs(x - mid) <= 3 for x in f.get('lineMids', [])) and f.get('dots') == 0, f)
        ok('%s: the copyright line is one line ("(c) 2026 Gflam Group..."), wholly above the sticky bar%s, and nothing scrolls sideways' % (name, '' if page in ('/help.html', '/terms.html', '/privacy.html') else ' (shown)'),
           f.get('copyBottom') is not None and f.get('oneLine') is True and f['copyBottom'] <= f['barTop'] - 4 and f.get('sw', 999) <= f.get('vw', 0)
           and (f.get('bar') or page in ('/help.html', '/terms.html', '/privacy.html')), f)
        shot(S, sid, 'footer-%s-390' % page.strip('/').replace('.html', ''))
        S.close_tab(tid)

    print('\nTHE FOOTER AT DESKTOP WIDTH IS AS IT WAS')
    tid, sid = S.open('/index.html', 1280, 900, pre=pre(INSIDE_MS))
    S.until(sid, '!!document.querySelector("footer .foot-links")', 20)
    time.sleep(0.8)
    v = S.js(sid, FOOT)
    f = json.loads(v) if isinstance(v, str) else {}
    ok('desktop: the footer is still a row, with the dots between the links', f.get('dir') == 'row' and f.get('dots') == f.get('links', 0) - 1 and f.get('lineCount') == 1, f)
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 29
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
