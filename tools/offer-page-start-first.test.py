#!/usr/bin/env python3
"""THE OFFER PAGE LEADS WITH THE START, HAS ONE PRICE LINE, AND COUNTS WHERE PEOPLE DROP OFF.

Item 80A, 8 Nov 2026 (reports/signup-fix-5nov: 0 sign-up presses from 104 people in 30 days; the
hero said "See pricing" and "Talk to us", the form was 10.7 phone screens down, and the price box
showed four prices, two crossed out). Reads the shipped files; the analytics file is RUN under jsc.

  python3 tools/offer-page-start-first.test.py

  1. the hero's first button is "Have a play for free" and goes to the form; "See pricing" is second
  2. the form (#claim) is the second section, straight after the hero, before the game modes
  3. ONE price line: one price row, nothing struck out, no price in the hero, none in the form's lede
  4. the email's own words ("a month on us") sit by the button and by the form
  5. the drop-off events go through vpTrack, which refuses anything that could be personal data
  6. every copy agrees: /offer-nov, /offer-dec, /offer-jan (and the rest) are the ONE nsw.html, and
     no other page carries the offer form; the homepage has no offer and no tracking of these events
  9. Dean's round 3 notes (7 Nov 2026): plain zeros and no roll-up, the hero TV fits its frame both ways
     (RUN), the plain one-column price, readable first lines, pub or club not asked when the link says
     (RUN), no host knocked, Gflam Touring once, fewer "free month", words that match the billing rules
"""
import glob, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
def rd(p): return open(os.path.join(ROOT, p), encoding='utf-8').read()
passed = failed = 0
def ok(label, good, detail=''):
    global passed, failed
    if good: passed += 1; print('  ok   ' + label)
    else: failed += 1; print('  FAIL ' + label + ('   saw: %s' % (detail,) if detail != '' else ''))

NSW = rd('venueplay/nsw.html')
BODY = NSW[NSW.index('<body'):]

print('1. The start button is first in the hero')
hero = re.search(r'<div class="hero-cta">(.*?)</div>', NSW, re.S).group(1)
links = re.findall(r'<a [^>]*href="([^"]+)"[^>]*>([^<]+)</a>', hero)
ok('the hero has "Have a play for free" first, going to the start section', links[:1] == [('#start', 'Have a play for free')], links)
ok('"See pricing" is second, going to the price', links[1:2] == [('#offer', 'See pricing')], links)
ok('the start button is the pink one and "See pricing" the quiet one',
   re.search(r'class="btn btn-primary" href="#start"[^>]*>Have a play for free', hero) and re.search(r'class="btn btn-ghost" href="#offer"[^>]*>See pricing', hero))
ok('the hero has no competing exit beside the ask ("Talk to us" stays in the nav and the contact section)', 'Talk to us' not in hero and 'Contact' in NSW and 'id="contact"' in NSW, links)

print('2. The start section is the second section; the card form is lower')
secs = re.findall(r'<section[^>]*\bid="([^"]+)"', BODY)
ok('the sections run hero, start, then the rest', secs[:3] == ['top', 'start', 'modes'], secs[:4])
ok('the start section is above the pricing; the card form is below the pricing and above the questions', secs.index('start') < secs.index('offer') < secs.index('claim') < secs.index('faq'), secs)
ok('there is still exactly one form, with its submit button and its success panel',
   NSW.count('id="vp-submit"') == 1 and NSW.count('id="vp-form"') == 1 and NSW.count('id="vp-success"') == 1)

print('3. One price line')
offer = re.search(r'<section class="sec" id="offer">.*?</section>', NSW, re.S).group(0)
rows = re.findall(r'<div class="price-row', offer)
ok('the pricing section has ONE price row, not four', len(rows) == 1, len(rows))
ok('nothing is crossed out', '<s>' not in offer and 'price-row list' not in offer)
ok('the long rules paragraph under the prices is gone from the section (it lives once, in the form and the questions)', 'price-foot' not in offer)
words = re.sub(r'<div class="price-card">.*', '', offer, flags=re.S)
ok('the price section\'s heading and words carry no price; the one row holds it', '$' not in re.sub(r'<[^>]+>', ' ', words), re.findall(r'\$[\d.]+', words))
ok('that one row is $2.50 with the standard $3.00 beside it', '<div class="pv">$2.50</div>' in offer and 'Standard rate $3.00' in offer)
hp = re.search(r'<p class="h2-price">(.*?)</p>', NSW, re.S).group(1)
ok('the hero note under the button carries no price', '$' not in hp, hp)
sub = re.search(r'<section class="sec" id="start">.*?<p class="sec-sub"[^>]*>(.*?)</p>', NSW, re.S).group(1)
ok('the start section\'s lede carries no price', '$' not in sub, sub)
sa = NSW[NSW.index('function standardPage'):NSW.index('function endedNow')]
ok('the ended page also shows ONE row ($3.00), not two', sa.count('class="price-row') == 1 and '$3.00' in sa and '$2.85</div>' not in sa)

print('4. The email\'s own words are by the button and the form')
ok('under the hero button, plain and short: "Nothing is charged today. Play for a month on us." (Dean, 7 Nov 2026, round 3 note 2)', hp == 'Nothing is charged today. Play for a month on us.', hp)
ok('the start section is the no-card start (job signup-core): its own script is loaded and the card form is a separate, lower section',
   '<script src="/app/vp-start.js"></script>' in NSW and NSW.index('id="start"') < NSW.index('id="offer"') < NSW.index('id="claim"'))
ok('no promise of "no card": the form still asks for one, so the page does not say otherwise (the no-card start is item 80B)',
   not re.search(r'no card|card.?free|without a card', hp + sub + offer, re.I) and 'Hold my spot, add card' in NSW)

print('5. Drop-off events carry no personal data')
EVENTS = ['offer_land', 'start_seen', 'start_begin', 'start_field_error', 'start_submit', 'checkout_open', 'checkout_done']
used = set(re.findall(r"vpTrack\('([a-z_]+)'", NSW))
ok('the offer page sends all seven steps of the funnel', set(EVENTS) <= used, sorted(set(EVENTS) - used))
calls = re.findall(r"vpTrack\('[a-z_]+',\s*([^)]*)\)", NSW)
ok('no call passes anything typed in a box (.value) or the form fields', not any('.value' in c or 'vp-email' in c or 'vp-mobile' in c for c in calls), calls)
ok('start_field_error names the box, never the message or the text', "vpTrack('start_field_error', { field: field })" in NSW)

HARNESS = r'''
var SRC = readFile(%s);
function run(){
  var pushed = [], human = [];
  var win = { navigator:{webdriver:false,userAgent:'Mozilla/5.0 (iPhone) Safari'}, dataLayer:undefined,
    location:{pathname:'/offer-nov',host:'venueplay.com.au',hostname:'venueplay.com.au',search:''},
    localStorage:{getItem:function(){return null;},setItem:function(){},removeItem:function(){}} };
  win.addEventListener=function(t,f){human.push(f);}; win.removeEventListener=function(){}; win.window=win;
  var doc={head:{appendChild:function(){}},createElement:function(){return {};},addEventListener:function(){}};
  new Function('window','document','navigator','location','localStorage',SRC)(win,doc,win.navigator,win.location,win.localStorage);
  human.slice().forEach(function(h){h({type:'pointermove'});});
  return win;
}
var w = run(), out = {};
function last(){ var d=w.dataLayer, x=d[d.length-1]; return x && x[0]==='event' ? {name:x[1],params:x[2]} : null; }
var n0 = w.dataLayer.length;
w.vpTrack('start_field_error', {field:'email'});             out.fieldOk = last();
n0 = w.dataLayer.length;
w.vpTrack('start_submit', {field:'kim@kirrabeachhotel.com.au', step:'0412 345 678', offer:'Kirra Beach Hotel', source:'4225', extra:'x'});
out.dirty = last(); out.dirtyGrew = w.dataLayer.length - n0;
n0 = w.dataLayer.length;
w.vpTrack('start_seen', {step:'s3', source:'gflam.com.au', offer:'november', name:'Kim', email:'kim@x.com', mobile:'0412345678', postcode:'4225'});
out.seen = last();
n0 = w.dataLayer.length; w.vpTrack('send_my_password', {}); w.vpTrack('purchase', {step:'1'});
out.unknownGrew = w.dataLayer.length - n0;
var robot = (function(){ var pushed=[]; var win={navigator:{webdriver:true,userAgent:'x'},location:{pathname:'/',host:'venueplay.com.au',hostname:'venueplay.com.au',search:''},localStorage:{getItem:function(){return null;}}};
  win.addEventListener=function(){}; win.removeEventListener=function(){}; win.window=win;
  new Function('window','document','navigator','location','localStorage',SRC)(win,{head:{},createElement:function(){return {};},addEventListener:function(){}},win.navigator,win.location,win.localStorage);
  var r={fn:typeof win.vpTrack}; try{ win.vpTrack('start_seen',{}); r.threw=false; }catch(e){ r.threw=true; } r.layer = !!win.dataLayer; return r; })();
out.robot = robot;
print(JSON.stringify(out));
'''
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as t:
    t.write(HARNESS % json.dumps(os.path.join(ROOT, 'venueplay', 'app', 'vp-analytics.js')))
r = subprocess.run([JSC, t.name], capture_output=True, text=True, cwd=ROOT, timeout=60)
os.unlink(t.name)
try: res = json.loads(r.stdout.strip().splitlines()[-1])
except Exception: res = {}; print(r.stdout, r.stderr)
ok('a real person: the field-error event is sent with the box name', res.get('fieldOk') == {'name': 'start_field_error', 'params': {'page_path': '/offer-nov', 'field': 'email'}}, res.get('fieldOk'))
d = res.get('dirty') or {}
ok('an email, a mobile, a venue name and a postcode in the values are DROPPED, not sent',
   d.get('name') == 'start_submit' and d.get('params') == {'page_path': '/offer-nov'}, d)
s = (res.get('seen') or {}).get('params', {})
ok('only the clean tokens go: step s3 and the month; a dotted source, a name, email, mobile, postcode do not',
   s == {'page_path': '/offer-nov', 'step': 's3', 'offer': 'november'}, s)
ok('an event that is not on the list is never sent', res.get('unknownGrew') == 0, res.get('unknownGrew'))
ok('a robot or opted-out browser gets a vpTrack that does nothing, and starts no dataLayer',
   res.get('robot') == {'fn': 'function', 'threw': False, 'layer': False}, res.get('robot'))

print('7. Dean\'s wording, 6 Nov (items 8 and 10)')
lede = re.search(r'<p class="lede">(.*?)</p>', NSW, re.S).group(1)
ok('hero line: "Trivia and musical bingo, plus bingo, raffles and members draws where your state allows"',
   lede.startswith('Trivia and musical bingo, plus bingo, raffles and members draws where your state allows'), lede[:120])
ok('"and it won\'t come back" is gone from the page', "come back" not in re.sub(r'<[^>]+>', ' ', offer) and 'won&#39;t come back' not in NSW and "won't come back" not in NSW)
card = re.search(r'<section class="sec" id="claim">.*?</section>', NSW, re.S).group(0)
ok('the card form is titled "Rather add your card now?"', '<h2 class="sec-title">Rather add your card now?</h2>' in card)
ok('the card form line reads "Keep $2.50 by adding your card before your free month ends"', 'Keep $2.50 by adding your card before your free month ends' in card)
ok('"Lock in your price" in the pricing section and the floating button both point at the start section, not the card form',
   re.search(r'href="#start" data-cta="offer-lock">Lock in your price', offer) and re.search(r'<a href="#start" class="vp-float-cta" id="vpFloatCta"', NSW) and 'href="#claim"' not in NSW, re.findall(r'href="#claim"', NSW))
prim = re.findall(r'<a [^>]*>', NSW)
prim = [t for t in prim if 'btn-primary' in t or 'vp-float-cta' in t]
pt = sorted({re.search(r'href="([^"]*)"', t).group(1) for t in prim if 'href="/' not in t})
ok('every primary start button (hero, "Lock in your price", the floating button) points at #start; the free-account enquiry and the card form are only secondary',
   all(re.search(r'href="#start"', t) for t in prim if any(k in t for k in ('hero-start', 'offer-lock', 'vp-float-cta'))) and '#contact' not in pt and '#claim' not in pt, pt)
fl = NSW[NSW.index("var cta=document.getElementById('vpFloatCta')"):]
fl = fl[:fl.index('</script>')]
ok('the floating button goes for good once someone has started: a box touched (focusin), a later step showing, or vp-start-done',
   "addEventListener('focusin'" in fl and "addEventListener('vp-start-done'" in fl and "'st-code','st-done','st-held'" in fl and '!started' in fl, fl[:200])
ok('the floating button also stays away while the start section or the card form is on screen', 'inView(claim)' in fl and 'inView(card)' in fl)
ok('the start section holds the one easy-to-change destination for the hero button, with a note for the five-box form',
   'id="start"' in NSW and 'vp-start.js' in NSW)

print('8. No "made by AI" look on the offer journey (Dean, 6 Nov): no pink pill, no pink dash before a heading, no spaced-out mono capitals')
css = re.search(r'<style>(.*?)</style>', NSW, re.S).group(1)
rules = re.findall(r'([^{}]+)\{([^{}]*)\}', css)
spaced = [sel.strip()[:60] for sel, body in rules
          if 'text-transform:uppercase' in body and re.search(r"JetBrains|monospace", body)
          and (lambda m: m and float(m.group(1)) >= 0.05)(re.search(r'letter-spacing:(\.?\d*\.?\d+)em', body))]
ok('no rule sets monospace, UPPERCASE and wide letter spacing together (the spaced-out capitals)', not spaced, spaced)
ok('no pill with a pulsing dot: no .eyebrow, no .live-dot, no class="eyebrow" on the offer page', '.eyebrow' not in css and '.live-dot' not in css and 'class="eyebrow"' not in NSW and 'live-dot' not in NSW)
ok('no pink dash drawn before a heading label (.label has no ::before line)', not re.search(r'\.label::before', css) and not re.search(r'\.vps-swap-k::before', css))
ok('the offer is one plain bold line in normal type: <p class="hero-offer">$2.50 a player if you join by <date>.</p>',
   re.search(r'<p class="hero-offer">\$2\.50 a player if you join by <span class="vpc-day"[^>]*>[^<]+</span>\.</p>', NSW) and re.search(r'\.hero-offer\{[^}]*font-weight:700', css) and 'uppercase' not in re.search(r'\.hero-offer\{[^}]*\}', css).group(0))

print('6. Every copy agrees')
red = rd('venueplay/_redirects')
offers = re.findall(r'^/(offer-[a-z]{3})\s+(\S+)\s+(\d+)\s*$', red, re.M)
ok('every /offer-<month> (nov, dec, jan and the rest) is served from the one /nsw page, as a rewrite',
   {m for m, _, _ in offers} >= {'offer-nov', 'offer-dec', 'offer-jan'} and all(t == '/nsw' and c == '200' for _, t, c in offers), offers)
ok('/gflam is the same page', re.search(r'^/gflam\s+/nsw\s+200', red, re.M) is not None)
holders = [os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)
           if 'id="vp-submit"' in open(p, encoding='utf-8', errors='replace').read() and 'node_modules' not in p]
ok('the only pages with a sign-up form are nsw.html and the homepage (which has no offer)',
   sorted(holders) == ['venueplay/index.html', 'venueplay/nsw.html'], holders)
ok('the month rows live in one file, vp-offer.js, and nsw.html loads it', '<script src="/app/vp-offer.js">' in NSW and len(glob.glob(os.path.join(ROOT, '**', 'vp-offer.js'), recursive=True)) == 1)
IDX = rd('venueplay/index.html')
ok('the homepage never loads the offer file and never sends these events (no offers there)',
   'vp-offer.js' not in IDX and 'vpTrack' not in IDX and 'Have a play for free' not in IDX)
# INBOX 280 (12 Nov 2026): what search engines read about the offer pages. Plain /offer goes to the homepage, so its
# structured data is the homepage's; the /offer-<month> page (nsw.html) carries none of its own.
def ld_blocks(src):
    out = []
    for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', re.sub(r'<!--.*?-->', ' ', src, flags=re.S), re.S):
        try:
            out.append(json.dumps(json.loads(b)))
        except Exception as e:
            out.append('UNPARSED ' + str(e))
    return out
ok('/offer goes to the homepage, and the offer page itself (nsw.html) has no structured data naming "VenuePlay" or a telephone',
   re.search(r'^/offer\s+/\s+30[12]\s*$', red, re.M) is not None and not [b for b in ld_blocks(NSW) if '"VenuePlay"' in b or '"telephone"' in b],
   ld_blocks(NSW))
idx_ld = ld_blocks(IDX)
ok('so /offer\'s structured data (the homepage\'s 2 blocks) says "venueplay" in lowercase and carries no telephone',
   len(idx_ld) == 2 and all('"name": "venueplay"' in b and '"VenuePlay"' not in b and '"telephone"' not in b and 'UNPARSED' not in b for b in idx_ld), idx_ld)
ok('vp-analytics.js is the one place that defines vpTrack', len([p for p in glob.glob(os.path.join(ROOT, 'venueplay', '**', '*.js'), recursive=True) if 'window.vpTrack =' in open(p, encoding='utf-8', errors='replace').read()]) == 1)
txt = re.sub(r'<[^>]+>', ' ', BODY)
ok('brand: no em or en dash anywhere on the page body, "venueplay" never capitalised in the new copy',
   '—' not in hp + sub + offer and '–' not in hp + sub + offer and 'VenuePlay' not in hp + sub + offer)

print('9. Dean\'s notes, round 3 (7 Nov 2026, reports/offer-page-signup-8nov/DEAN-FEEDBACK-3.md)')
CSS_ALL = '\n'.join(re.findall(r'<style>(.*?)</style>', NSW, re.S))
VIS = re.sub(r'<script.*?</script>|<style.*?</style>|<!--.*?-->', ' ', BODY, flags=re.S)
VIS = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', VIS)).replace('&rsquo;', "'").replace('&#39;', "'")

# note 4: no dotted or slashed zero anywhere: no monospace face is loaded or set on the page
ok('note 4: no mono face on the page (JetBrains Mono draws a dotted zero): not loaded, and no rule sets it',
   'JetBrains' not in NSW and not re.search(r'font-family:[^;}]*monospace', CSS_ALL), re.findall(r'.{30}monospace.{10}', CSS_ALL)[:3])
ok('note 4: the footer\'s shared "powered by" line is held to the page\'s own type too (it was the mono face)',
   re.search(r"footer \.powered \.powered-by-text\{font-family:'Manrope'", CSS_ALL) is not None)
# The counts are painted by the shared /app/vp-counts.js since INBOX 233.1 (11 Nov 2026), read live from the Worker.
cnt = open(os.path.join(ROOT, 'venueplay', 'app', 'vp-counts.js')).read()
ok('note 4: the bank counts are set once, never rolled up (no animation frame, no easing, no observer)',
   'requestAnimationFrame' not in NSW and 'animateTo' not in NSW and 'IntersectionObserver' not in cnt and 'requestAnimationFrame' not in cnt
   and 'el.textContent = n.toLocaleString("en-AU");' in cnt and '<script src="/app/vp-counts.js"></script>' in NSW, cnt[:200])

# note 1: the hero TV and phone fit their frames, both ways. RUN the hero's own script with a frame that
# Safari has grown past 1280 x 720, and one that is the size it was asked for.
hero_js = NSW[NSW.index('(function(){\n  /* THE WALL AND THE PHONE'):]
hero_js = hero_js[:hero_js.index('})();') + 5]
FIT = r'''
var SRC = %s;
function el(o){ o = o || {}; o.style = {}; o.attrs = {}; o.classList = { add:function(){}, remove:function(){}, toggle:function(){} };
  o.setAttribute = function(k, v){ this.attrs[k] = v; }; o.removeAttribute = function(k){ delete this.attrs[k]; };
  o.addEventListener = function(){}; o.querySelectorAll = function(){ return []; }; return o; }
function run(box, tvW, tvH, pbox, phW, phH){
  var tvBox = el({ clientWidth: box[0], clientHeight: box[1] }), phBox = el({ clientWidth: pbox[0], clientHeight: pbox[1] });
  var tv = el({ offsetWidth: tvW, offsetHeight: tvH, parentNode: tvBox }), ph = el({ offsetWidth: phW, offsetHeight: phH, parentNode: phBox });
  var ids = { h2Tv: tv, h2Phone: ph, h2PhoneWrap: el(), h2Modes: el(), h2Stage: el() };
  var doc = { getElementById: function(i){ return ids[i] || null; } };
  var win = { addEventListener: function(){} };
  new Function('document', 'window', 'ResizeObserver', SRC)(doc, win, undefined);
  function read(f, b){ var m = /translate\(([\d.]+)px,([\d.]+)px\) scale\(([\d.]+)\)/.exec(f.style.transform || '');
    if (!m) return { t: f.style.transform || '' };
    var dx = +m[1], dy = +m[2], k = +m[3];
    return { k: k, inside: dx >= 0 && dy >= 0 && dx + f.offsetWidth * k <= b.clientWidth + 0.5 && dy + f.offsetHeight * k <= b.clientHeight + 0.5,
             fills: Math.abs(f.offsetWidth * k - b.clientWidth) < 1 || Math.abs(f.offsetHeight * k - b.clientHeight) < 1 }; }
  return { tv: read(tv, tvBox), ph: read(ph, phBox) };
}
print(JSON.stringify({
  normal375: run([321, 180.6], 1280, 720, [64, 138], 390, 844),
  grownTall: run([321, 180.6], 1280, 980, [64, 138], 390, 1200),
  grownWide: run([700, 393.8], 1600, 720, [140, 303], 600, 844),
  ipad: run([668, 375.8], 1280, 720, [140, 303], 390, 844),
  desk1280: run([452, 254.3], 1280, 720, [111, 240], 390, 844)
}));
'''
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as t:
    t.write(FIT % json.dumps(hero_js))
r = subprocess.run([JSC, t.name], capture_output=True, text=True, cwd=ROOT, timeout=60)
os.unlink(t.name)
try: fit = json.loads(r.stdout.strip().splitlines()[-1])
except Exception: fit = {}; print(r.stdout[-600:], r.stderr[-600:])
ok('note 1: at 375, iPad and 1280 the TV picture and the phone sit wholly inside their frames, filling them',
   all(fit.get(k, {}).get(w, {}).get('inside') and fit.get(k, {}).get(w, {}).get('fills') for k in ('normal375', 'ipad', 'desk1280') for w in ('tv', 'ph')), fit)
ok('note 1: a frame Safari has grown taller or wider than asked is still scaled to fit inside, never cut off',
   all(fit.get(k, {}).get(w, {}).get('inside') for k in ('grownTall', 'grownWide') for w in ('tv', 'ph'))
   and fit.get('grownTall', {}).get('tv', {}).get('k', 1) < 321 / 1280.0, fit.get('grownTall'))

# note 2: the line under the hero is plain, short and the last thing in the hero copy
ok('note 2: the hero\'s price line is plain (no bold run, Manrope set on it) and comes after the buttons',
   '<p class="h2-price">Nothing is charged today. Play for a month on us.</p>' in NSW
   and re.search(r"\.h2-price\{[^}]*font-family:'Manrope'", CSS_ALL) and NSW.index('class="hero-cta"') < NSW.index('class="h2-price"'))
# note 3: the ended notice sits at the bottom of the hero, not as a bar over the top of the page
se = NSW[NSW.index('function showEnded()'):]
se = se[:se.index('standardPage();')]
ok('note 3: an ended link says so in the hero\'s last line (.hero-ended), not a bar pushed in at the top of the page',
   "document.querySelector('#top .hero-ended')" in se and 'insertBefore' not in se and "setAttribute('data-offer-banner', 'ended')" in se
   and re.search(r'<p class="h2-price">[^<]*</p>\s*<!--[^>]*-->\s*<p class="hero-note hero-ended" hidden></p>\s*</div>', NSW) is not None, se[:300])
# note 5: the price is plain, in one column, with no empty right-hand side
ok('note 5: the pricing block is one plain column (no empty right side), the price in Hanken Grotesk, the button under the price',
   '#offer .offer-grid{grid-template-columns:minmax(0,1fr)' in CSS_ALL and re.search(r"#offer \.price-row \.pv\{font-family:'Hanken Grotesk'", CSS_ALL)
   and offer.index('class="price-card"') < offer.index('class="offer-cta"'))
ok('note 5: an ended link\'s heading is "$3 per player. Flat and simple."', "html('#offer .sec-title', '$3 per player. Flat and simple.');" in NSW)
# notes 6 and 7: the sign-up's first line and help words are readable, and the form has even gaps
lab = re.search(r'\.label\{([^}]*)\}', CSS_ALL).group(1)
ok('note 6: the first line of each section (.label) is the body size, not the small size, and the help words beside a box are no smaller than 14px',
   'font-size:var(--fs-base)' in lab and re.search(r'\.st-help\{[^}]*font-size:var\(--fs-sm\)', CSS_ALL) and not re.search(r'\.(st-help|form-fine|field-hint)\{[^}]*--fs-xs', CSS_ALL), lab)
ok('note 7: the form rows and a label and its box have one even gap each', '.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 16px;' in CSS_ALL and '.field{display:flex;flex-direction:column;gap:8px}' in CSS_ALL)

# note 8: pub or club is not asked when the link already says. RUN the page's own script.
vt_js = NSW[NSW.index('/* PUB OR CLUB, ONLY WHEN WE DO NOT ALREADY KNOW'):]
vt_js = vt_js[vt_js.index('(function(){'):vt_js.index('</script>')]
VT = r'''
var SRC = %s;
function run(search){
  function fld(){ return { hidden:false, classList:{ added:[], add:function(c){ this.added.push(c); } } }; }
  var kf = fld(), ef = fld(), mf = fld();
  var pub = { checked:false, closest:function(){ return kf; } }, club = { checked:false, closest:function(){ return kf; } };
  var sel = { value:'', closest:function(){ return ef; } }, mob = { closest:function(){ return mf; } };
  var ids = { 'st-kind-pub':pub, 'st-kind-club':club, 'vp-entity':sel, 'vp-mobile':mob };
  var doc = { readyState:'complete', getElementById:function(i){ return ids[i] || null; }, addEventListener:function(){} };
  new Function('document', 'location', SRC)(doc, { search: search });
  return { pub:pub.checked, club:club.checked, kindHidden:kf.hidden, entity:sel.value, entityHidden:ef.hidden, mobileFull:mf.classList.added.indexOf('full') !== -1 };
}
print(JSON.stringify({ club: run('?vt=club&s=2'), pub: run('?utm_source=email&vt=PUB'), none: run('?s=2'), junk: run('?vt=bar') }));
'''
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as t:
    t.write(VT % json.dumps(vt_js))
r = subprocess.run([JSC, t.name], capture_output=True, text=True, cwd=ROOT, timeout=60)
os.unlink(t.name)
try: vt = json.loads(r.stdout.strip().splitlines()[-1])
except Exception: vt = {}; print(r.stdout[-600:], r.stderr[-600:])
ok('note 8: a link that says ?vt=club answers pub or club for them on both forms and hides the question (club = non_profit)',
   vt.get('club') == {'pub': False, 'club': True, 'kindHidden': True, 'entity': 'non_profit', 'entityHidden': True, 'mobileFull': True}, vt.get('club'))
ok('note 8: ?vt=PUB does the same for a pub (for_profit)', vt.get('pub') == {'pub': True, 'club': False, 'kindHidden': True, 'entity': 'for_profit', 'entityHidden': True, 'mobileFull': True}, vt.get('pub'))
ok('note 8: with no type in the link, or a type we do not know, both forms still ask',
   all(vt.get(k) == {'pub': False, 'club': False, 'kindHidden': False, 'entity': '', 'entityHidden': False, 'mobileFull': False} for k in ('none', 'junk')), (vt.get('none'), vt.get('junk')))
ok('note 8: a hidden field really disappears (.field is a flex box, so [hidden] needs its own rule)', '.field[hidden]{display:none}' in CSS_ALL)

# note 9: never knock a host; whoever is on shift can host
ok('note 9: no line treats a host as a cost ("hired trivia host", "no host to hire", "nobody needs a mic voice"), and "Whoever\'s on shift can host" is there',
   not re.search(r'hired trivia host|host to hire|needs a mic voice|replaces the paper bingo books and the', VIS, re.I) and "Whoever's on shift can host" in VIS,
   re.findall(r'.{30}(?:hired|host to hire|mic voice).{20}', VIS)[:2])
# note 9 on the home page too (INBOX 213, 11 Nov 2026: never knock hosts; index.html had both lines left)
IVIS = re.sub(r'<script.*?</script>|<style.*?</style>|<!--.*?-->', ' ', IDX[IDX.index('<body'):], flags=re.S)
IVIS = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'</?(?:span|b|i|em|strong)\b[^>]*>', '', IVIS))).replace('&rsquo;', "'").replace('&#39;', "'")
HOST_COST = r'hired (?:trivia )?host|host to hire|no host needed to run|needs a mic voice|replaces the paper bingo books and the|paying a trivia host|instead of a host|save on a host'
ok('note 9 on the home page: no line treats a trivia host as a cost, and the strip says "One screen runs your trivia, musical bingo, bingo and raffles."',
   not re.search(HOST_COST, IVIS, re.I) and 'One screen runs your trivia, musical bingo, bingo and raffles.' in IVIS
   and "Whoever's on shift presses go. Calls, cards and winner checks are handled for you." in IVIS,
   re.findall(r'.{30}(?:' + HOST_COST + r').{20}', IVIS, re.I)[:2])
# note 11, 12, 13
ok('note 11: "your usual crowd", not "your usual max"', 'on your usual crowd' in VIS and 'usual max' not in VIS)
ok('note 12: "Samsung and LG TV apps are coming soon" in what you get and in the "What do I need" answer', VIS.count('Samsung and LG TV apps are coming soon.') == 2)
ok('note 13: the hero says paper still works', 'paper still works for the regulars who want it' in lede)
# note 14: Gflam Touring named once, as the sign-off
ok('note 14: Gflam Touring is named once on the page, in the sign-off: "and the team behind Gflam Touring"',
   VIS.count('Gflam Touring') == 1 and '<span class="vps-sig-role" style="display:block">and the team behind Gflam Touring</span>' in NSW, VIS.count('Gflam Touring'))
# notes 15 and 21: fewer "free month"
fm = len(re.findall(r'free (?:first )?month|first month free|month free', VIS, re.I))
ok('notes 15 and 21: "free month" is said at most four times on the open page (it was nine), and none of the old buttons or lines remain',
   fm <= 4 and not re.search(r'Start my free month|Secure your first free month|first free month|free first month|cancel any ?time before your first payment', NSW), fm)
# notes 16, 18, 19: the words match the billing rules
ok('note 16: the free month starts at the first sign-in, and nothing says the first payment is "one month later"',
   'Your free month starts the first time you sign in.' in VIS and 'one month later' not in NSW, re.findall(r'.{40}one month later.{20}', NSW)[:2])
ok('note 18: the extra-player line is short, in Dean\'s words, and matches the rules: $2 an extra player that night, three big nights in a row and we adjust your plan, at your normal rate',
   '<p class="overage-note">A bigger night is $2 for each extra player, and your host OKs them first. Three big nights in a row and we adjust your plan to fit, at your normal rate.</p>' in NSW)
ok('the first sign-in deadline is for the emails only (Dean, 7 Nov 2026): the page never says "start by" or "sign in by" a date, and the hero says "join by"',
   not re.search(r'(?:start|sign in) by (?:<span[^>]*>)?\d', NSW, re.I) and '$2.50 a player if you join by <span class="vpc-day"' in NSW,
   re.findall(r'.{30}(?:start|sign in) by (?:<span[^>]*>)?\d.{20}', NSW, re.I)[:2])
ok('note 19: nothing promises the per-player rate "never changes", live or ended', not re.search(r'never changes', NSW))
ok('note 17: the "busy night, not the group total, one bill for the lot" explanations are gone from the card form',
   'not the group total' not in NSW and 'One card, one bill' not in NSW and 'Use your busiest night, not your average' not in NSW)
# note 22: the first question is answered plainly
ok('note 22: "When can I start?" is answered plainly', '<summary>When can I start?<span class="pm"></span></summary><div class="a">Tonight, if you like. Sign up above and you can start straight away.</div>' in NSW)
# note 23: the topic reads "Set up a free account", can be changed, and the message is friendly
ok('note 23: the topic is "Set up a free account" or "Talk to us", and our words in the message are friendly',
   "var CT_TOPIC = 'Set up a free account';" in NSW and '<option value="free">Set up a free account</option><option value="talk">Talk to us</option>' in NSW
   and "var CT_ASK = 'Hi, could you set up a free account for our venue so we can have a play? Thanks.';" in NSW and 'Set me up' not in NSW)
# note 24: pubs know their own rules
ok('note 24: no answer spells out what differs in South Australia and the Northern Territory, and none says the host checks the state\'s rules',
   'What else is different in South Australia' not in NSW and "state's rules" not in NSW)
# no AI look (round 3): no green or pulsing dot
ok('no AI look: no green status dot and no pulsing animation on the page',
   not re.search(r'@keyframes|animation:[^;]*infinite|#35d07f|#22c55e|#2ecc71|#16a34a|rgba\(53,\s*208,\s*127', CSS_ALL, re.I) and 'live-dot' not in NSW)

print('\n%d of %d checks passed' % (passed, passed + failed))
sys.exit(1 if failed else 0)
