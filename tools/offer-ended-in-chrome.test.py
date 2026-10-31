#!/usr/bin/env python3
"""AN ENDED MONTH'S OFFER LINK QUOTES THE STANDARD RATE, EVERYWHERE ON THE PAGE, IN CHROME (1 Nov 2026).

On 1 November 2026 /nsw and /offer-oct (the October offer, OFFER-OCT-2026, which ended at midnight
on 31 October, Brisbane) showed "This offer ended on 31 October ... the standard rate of $3.00" in a
banner, and went on promising "$2.50 a player, if you lock it in by 31 October", "$75 a month" for
30 players, "$2.50 locked for life" in the pricing card, the plan buttons and the FAQ. The page
contradicted itself on price. Dean's rule: when a month's code ends, "that link says the offer ended
and quotes the standard rate", and it never moves the venue onto next month's offer.

This opens the REAL nsw.html, served at the REAL addresses (venueplay/_redirects: /offer-oct is
nsw.html), with the billing Worker's GET /founding answer stubbed, and the REAL billing Worker
(tools/browser-rig/admin_site.py, jsc) taking the signup:

  1. /nsw and /offer-oct, Worker says open:false, at phone and desktop width: the banner says the
     offer ended on 31 October; no "$2.50", "$2.30", "$75", "lock it in", "lock in", "locked for
     life", "30 November" or "November" anywhere visible (every FAQ opened first); every dollar
     figure on the page is a standard one; the pricing card is the homepage's (Monthly $3.00, Annual
     $2.85); a 30-player pub pays $90 a month; the estimate prices $3.00 and $2.85; and a signup sends
     NO code, so the real Worker asks Stripe for the STANDARD price.
  2. /offer-nov, Worker says open:true: the November offer exactly as it was, the same words as when
     the Worker never answers, and the signup sends OFFER-NOV-2026.
  3. /offer-oct, Worker unreachable (network error, or HTTP 500): the page is left exactly as it is.

    python3 tools/offer-ended-in-chrome.test.py [--shots DIR] [--root CHECKOUT]
"""
import argparse, json, os, re, sys, time

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
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:600],)) if detail != '' else ''))


OFFER_JS = open(os.path.join(A.root, 'venueplay', 'app', 'vp-offer.js'), encoding='utf-8').read()
REDIRECTS = open(os.path.join(A.root, 'venueplay', '_redirects'), encoding='utf-8').read()


def pre(mode):
    """Before the page's own scripts: GET /founding answers as `mode` says, every other call goes to the rig's
    real Worker, and every address the page asks for and every /checkout it sends is written down."""
    return ('(function(){var MODE=%s;window.__asked=[];window.__checkout=[];var real=window.fetch;'
            'window.fetch=function(u,o){var s=String(u);window.__asked.push(s);'
            ' if(/\\/founding\\?/.test(s)){var code=decodeURIComponent((s.split("code=")[1]||""));'
            '  if(MODE==="down") return Promise.reject(new TypeError("Failed to fetch"));'
            '  if(MODE==="never") return new Promise(function(){});'
            '  if(MODE==="500") return Promise.resolve(new Response("{}",{status:500,headers:{"Content-Type":"application/json"}}));'
            '  return Promise.resolve(new Response(JSON.stringify({code:code,open:MODE==="open"}),{status:200,headers:{"Content-Type":"application/json"}}));}'
            ' if(!/\\/checkout$/.test(s)) return real.apply(this,arguments);'
            ' var sent=null;try{sent=JSON.parse(o.body);}catch(e){}'
            ' return real.apply(this,arguments).then(function(r){return r.json().then(function(j){'
            '  window.__checkout.push({sent:sent,status:r.status});'
            '  if(j&&j.url) j.url="#went-to-stripe"; if(j) delete j.client_secret;'
            '  return new Response(JSON.stringify(j),{status:r.status,headers:{"Content-Type":"application/json"}});});});};'
            '})();') % json.dumps(mode)


# Everything a reader can see, with every FAQ opened (a closed <details> keeps its answer out of innerText).
SEE = r'''(function(){
  Array.prototype.forEach.call(document.querySelectorAll("details"), function(d){ d.open = true; });
  var vis = function(el){ if(!el) return false; var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
  var eb = document.querySelector("#top .eyebrow");
  var rows = Array.prototype.map.call(document.querySelectorAll("#offer .price-row"), function(r){
    return r.querySelector("b").textContent + "=" + r.querySelector(".pv").textContent.replace(/\s+/g, " ").trim(); });
  return JSON.stringify({
    all: document.body.innerText,
    ended: document.documentElement.getAttribute("data-offer"),
    banner: document.body.firstElementChild && document.body.firstElementChild.tagName === "DIV" ? document.body.firstElementChild.innerText : "",
    eyebrow: vis(eb) ? eb.innerText : null,
    heroPrice: (document.querySelector("#top .h2-price") || {}).innerText || "",
    rows: rows,
    title: (document.querySelector("#offer .sec-title") || {}).innerText || "",
    plans: Array.prototype.map.call(document.querySelectorAll("#vp-plan button small"), function(s){ return s.textContent; }),
    submit: document.getElementById("vp-submit").textContent,
    float: (document.getElementById("vpFloatCta") || {}).textContent || "",
    meta: (document.querySelector('meta[name="description"]') || {}).content || "",
    og: (document.querySelector('meta[property="og:description"]') || {}).content || "",
    code: (window.VP_OFFER || {}).code || null,
    asked: window.__asked.filter(function(u){ return /\/founding\?/.test(u); }),
    errs: window.__errs || [],
    sw: document.documentElement.scrollWidth, vw: innerWidth
  });
})()'''

FILL = ('(function(seats){var $=function(i){return document.getElementById(i)};'
        'var r=document.querySelector("#vp-venue-list .venue-row");r.querySelector(".v-name").value="Kirra Beach Hotel";'
        'var p=r.querySelector(".v-postcode");p.value="4225";p.dispatchEvent(new Event("input",{bubbles:true}));'
        'var s=r.querySelector(".v-seats");s.value=String(seats);s.dispatchEvent(new Event("input",{bubbles:true}));'
        '$("vp-entity").value="for_profit";$("vp-entity").dispatchEvent(new Event("change",{bubbles:true}));'
        '$("vp-name").value="Kim Offer";$("vp-email").value="kim@kirrabeachhotel.com.au";$("vp-mobile").value="0412 345 678";$("vp-consent").checked=true;'
        'return $("vp-estimate").textContent;})(%d)')

# Offer words that must never show once the offer has ended. "No lock-in" (a contract) is fine.
OFFER_WORDS = re.compile(r'\$2\.50|\$2\.30|\$75\b|lock it in|\block(?:ed)? in\b|locked for life|30 November|November', re.I)
STANDARD_DOLLARS = {'$3', '$3.00', '$2.85', '$90', '$2', '$1', '$0', '$5,000'}


def see(S, sid):
    v = S.js(sid, SEE)
    return json.loads(v) if isinstance(v, str) else {}


def shot(S, sid, name, scroll_to=None):
    if not A.shots:
        return
    os.makedirs(A.shots, exist_ok=True)
    S.js(sid, 'window.scrollTo({top:0,behavior:"instant"}); true' if not scroll_to else
         'document.querySelector(%s).scrollIntoView({block:"start",behavior:"instant"}); window.scrollBy(0,-70); true' % json.dumps(scroll_to))
    time.sleep(0.6)
    S.shot(sid, os.path.join(A.shots, name + '.png'))


def load(S, path, mode, w, h, mobile):
    tid, sid = S.open(path, w, h, mobile=mobile, pre=pre(mode))
    S.until(sid, '!!window.VP_OFFER && !!document.getElementById("vp-submit") && window.__asked.some(function(u){return /\\/founding\\?/.test(u);})', 20)
    if mode == 'closed':
        S.until(sid, 'document.documentElement.getAttribute("data-offer")==="ended"', 10)
    time.sleep(1.2)   # let any answer land and the page do whatever it is going to do
    return tid, sid


def signup(S, sid, seats=30):
    S.js(sid, FILL % seats)
    time.sleep(0.3)
    S.js(sid, 'document.getElementById("vp-submit").click(); true')
    S.until(sid, 'window.__checkout.length===1', 15)
    v = S.js(sid, 'JSON.stringify(window.__checkout[0]||null)')
    return json.loads(v) if isinstance(v, str) else None


S = admin_site.Site(root=A.root, fonts=bool(A.shots))
try:
    print('THE ADDRESSES ARE THE REAL ONES')
    ok('venueplay/_redirects serves /offer-oct and /offer-nov from /nsw, the file this opens there',
       re.search(r'^/offer-oct\s+/nsw\s+200\s*$', REDIRECTS, re.M) and re.search(r'^/offer-nov\s+/nsw\s+200\s*$', REDIRECTS, re.M)
       and S.rewrites().get('/offer-oct') == '/nsw', S.rewrites())
    ok('the October row is marked ended in vp-offer.js and still says 31 October',
       bool(re.search(r"oct:\s*\{\s*code:\s*'OFFER-OCT-2026',[^}\n]*day:\s*'31 October'[^}\n]*ended:\s*true", OFFER_JS)))

    stripe_before = 0
    for path, w, h, mobile, tag in (('/nsw', 390, 844, True, 'nsw-phone'), ('/offer-oct', 390, 844, True, 'offer-oct-phone'),
                                    ('/offer-oct', 1280, 900, False, 'offer-oct-desktop')):
        print('\n%s AT %d PX, THE WORKER SAYS THE OCTOBER CODE IS SHUT' % (path, w))
        tid, sid = load(S, path, 'closed', w, h, mobile)
        v = see(S, sid)
        allt = v.get('all', '')
        ok('%s asked the Worker about OFFER-OCT-2026, and the page knows the offer ended' % tag,
           v.get('code') == 'OFFER-OCT-2026' and any('OFFER-OCT-2026' in a for a in v.get('asked', [])) and v.get('ended') == 'ended', v.get('asked'))
        ok('%s: the banner says "This offer ended on 31 October." and quotes $3.00 a player' % tag,
           v.get('banner', '').startswith('This offer ended on 31 October.') and '$3.00 per player a month' in v.get('banner', ''), v.get('banner'))
        hits = sorted(set(m.group(0) for m in OFFER_WORDS.finditer(allt)))
        ok('%s: no offer price or promise anywhere visible ($2.50, $2.30, $75, lock it in, locked for life, November)' % tag,
           not hits, [hits] + re.findall(r'.{40}(?:\$2\.50|\$2\.30|lock it in|locked for life|November).{30}', allt)[:3])
        dollars = set(re.findall(r'\$\d(?:[\d,]*\d)?(?:\.\d\d)?', allt))
        ok('%s: every dollar figure on the page is a standard one' % tag, dollars and dollars <= STANDARD_DOLLARS, sorted(dollars - STANDARD_DOLLARS))
        ok('%s: the offer badge is gone and the hero says a 30-player pub pays $90 a month' % tag,
           v.get('eyebrow') is None and v.get('heroPrice') == 'First month free. Then a pub with 30 players pays $90 a month. No lock-in, cancel anytime.', (v.get('eyebrow'), v.get('heroPrice')))
        ok('%s: the pricing card is the homepage\'s: Monthly $3.00, Annual $2.85, under "$3 per player. Simple and flat."' % tag,
           v.get('rows') == ['Monthly=$3.00', 'Annual=$2.85'] and re.sub(r'\s+', ' ', v.get('title', '')).lower() == '$3 per player. simple and flat.', (v.get('rows'), v.get('title')))
        ok('%s: the plan buttons, the FAQ and the page description quote $3 and $2.85' % tag,
           v.get('plans') == ['$3.00 / player', '$2.85 / player'] and 'How much does it cost?' in allt
           and 'Pay monthly at $3 a player, or yearly for $2.85 a player.' in allt
           and '$3 per player, per month' in v.get('meta', '') and '$2.50' not in v.get('og', ''), (v.get('plans'), v.get('meta')))
        ok('%s: the buttons say "Start your free month", as the homepage does' % tag,
           v.get('submit') == 'Start my free month' and 'Start your free month' in v.get('float', ''), (v.get('submit'), v.get('float')))
        ok('%s: no script error, nothing scrolls sideways' % tag, not v.get('errs') and v.get('sw', 9999) <= v.get('vw', 0), (v.get('errs'), v.get('sw'), v.get('vw')))
        shot(S, sid, 'offer-ended-1nov-%s-top' % tag)
        shot(S, sid, 'offer-ended-1nov-%s-pricing' % tag, '#offer')
        if tag == 'offer-oct-phone':
            S.js(sid, 'document.querySelectorAll("details").forEach(function(d){d.open=false;}); true')
            est = S.js(sid, FILL % 30) or ''
            ok('the estimate prices 30 players at $3.00: $90.00 a month', '$90.00' in est and '30 players × $3.00' in est, est)
            S.js(sid, 'document.querySelector(\'#vp-plan [data-plan="annual"]\').click(); true')
            est = S.js(sid, 'document.getElementById("vp-estimate").textContent') or ''
            ok('annual prices $2.85 a player', '30 players × $2.85 × 12' in est and '$1026.00' in est, est)
            S.js(sid, 'document.querySelector(\'#vp-plan [data-plan="monthly"]\').click(); true')
            shot(S, sid, 'offer-ended-1nov-%s-signup' % tag, '#claim')
            ck = signup(S, sid)
            stripe = [x for x in S.W.stripe() if '/checkout/sessions' in x.get('url', '')]
            ok('a signup sends NO offer code, and the real Worker asks Stripe for the STANDARD monthly price',
               bool(ck) and ck['sent'].get('founding_code') == '' and ck['status'] == 200 and len(stripe) == stripe_before + 1
               and 'price_S_M' in stripe[-1]['body'] and 'price_F_M' not in stripe[-1]['body'],
               (ck and ck['sent'].get('founding_code'), ck and ck['status'], stripe[-1:] and stripe[-1]['body'][:300]))
            stripe_before = len(stripe)
        S.close_tab(tid)

    print('\n/offer-nov, THE WORKER SAYS THE NOVEMBER CODE IS OPEN')
    tid, sid = load(S, '/offer-nov', 'never', 390, 844, True)
    base = see(S, sid)
    S.close_tab(tid)
    tid, sid = load(S, '/offer-nov', 'open', 390, 844, True)
    v = see(S, sid)
    ok('/offer-nov asked about OFFER-NOV-2026 and shows no ended banner',
       any('OFFER-NOV-2026' in a for a in v.get('asked', [])) and v.get('ended') is None and 'This offer ended' not in v.get('all', ''), v.get('asked'))
    ok('/offer-nov reads exactly as when the Worker never answers (the November offer, unchanged)',
       v.get('all') and v.get('all') == base.get('all') and v.get('rows') == base.get('rows'), '')
    ok('/offer-nov still offers $2.50 to 30 November: the badge, $75 for 30 players, the card and the plan buttons',
       (v.get('eyebrow') or '').lower().endswith('30 november') and '$2.50 a player' in (v.get('eyebrow') or '').lower() and '$75 a month' in v.get('heroPrice', '')
       and v.get('rows') == ['First month=$0', 'Standard=$3.00', 'Monthly=$3.00 $2.50', 'Annual=$2.85 $2.30']
       and v.get('plans') == ['$2.50 / player', '$2.30 / player'] and v.get('submit') == 'Hold my spot, add card', (v.get('eyebrow'), v.get('heroPrice'), v.get('rows'), v.get('plans')))
    shot(S, sid, 'offer-ended-1nov-offer-nov-phone-top')
    ck = signup(S, sid)
    ok('a November signup still sends OFFER-NOV-2026', bool(ck) and ck['sent'].get('founding_code') == 'OFFER-NOV-2026', ck and ck['sent'].get('founding_code'))
    S.close_tab(tid)

    print('\n/offer-oct, THE WORKER CANNOT BE REACHED: THE PAGE IS LEFT AS IT IS')
    tid, sid = load(S, '/offer-oct', 'never', 390, 844, True)
    base = see(S, sid)
    S.close_tab(tid)
    for mode, what in (('down', 'a network error'), ('500', 'HTTP 500')):
        tid, sid = load(S, '/offer-oct', mode, 390, 844, True)
        v = see(S, sid)
        ok('%s: no banner, nothing rewritten, the same words as when the Worker never answers' % what,
           v.get('ended') is None and 'This offer ended' not in v.get('all', '') and v.get('all') == base.get('all')
           and (v.get('eyebrow') or '').lower().endswith('31 october') and v.get('plans') == ['$2.50 / player', '$2.30 / player'], (v.get('ended'), v.get('eyebrow')))
        ok('%s: no script error' % what, not v.get('errs'), v.get('errs'))
        S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 40
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
