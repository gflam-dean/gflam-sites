#!/usr/bin/env python3
"""THE OFFER PAGE LEADS WITH THE START, HAS ONE PRICE LINE, AND COUNTS WHERE PEOPLE DROP OFF.

Item 80A, 8 Nov 2026 (reports/signup-fix-5nov: 0 sign-up presses from 104 people in 30 days; the
hero said "See pricing" and "Talk to us", the form was 10.7 phone screens down, and the price box
showed four prices, two crossed out). Reads the shipped files; the analytics file is RUN under jsc.

  python3 tools/offer-page-start-first.test.py

  1. the hero's first button is "Have a play, free" and goes to the form; "See pricing" is second
  2. the form (#claim) is the second section, straight after the hero, before the game modes
  3. ONE price line: one price row, nothing struck out, no price in the hero, none in the form's lede
  4. the email's own words ("have a play for a month on us") sit by the button and by the form
  5. the drop-off events go through vpTrack, which refuses anything that could be personal data
  6. every copy agrees: /offer-nov, /offer-dec, /offer-jan (and the rest) are the ONE nsw.html, and
     no other page carries the offer form; the homepage has no offer and no tracking of these events
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
ok('the hero has "Have a play, free" first, going to the form', links[:1] == [('#claim', 'Have a play, free')], links)
ok('"See pricing" is second, going to the price', links[1:2] == [('#offer', 'See pricing')], links)
ok('the start button is the pink one and "See pricing" the quiet one',
   re.search(r'class="btn btn-primary" href="#claim"[^>]*>Have a play, free', hero) and re.search(r'class="btn btn-ghost" href="#offer"[^>]*>See pricing', hero))
ok('the hero has no competing exit beside the ask ("Talk to us" stays in the nav and the contact section)', 'Talk to us' not in hero and 'Contact' in NSW and 'id="contact"' in NSW, links)

print('2. The form is the second section')
secs = re.findall(r'<section[^>]*\bid="([^"]+)"', BODY)
ok('the sections run hero, form, then the rest', secs[:3] == ['top', 'claim', 'modes'], secs[:4])
ok('the form is above the pricing and the questions', secs.index('claim') < secs.index('offer') < secs.index('faq'), secs)
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
sub = re.search(r'<section class="sec" id="claim">.*?<p class="sec-sub"[^>]*>(.*?)</p>', NSW, re.S).group(1)
ok('the form\'s lede carries no price', '$' not in sub, sub)
sa = NSW[NSW.index('function standardPage'):NSW.index('function endedNow')]
ok('the ended page also shows ONE row ($3.00), not two', sa.count('class="price-row') == 1 and '$3.00' in sa and '$2.85</div>' not in sa)

print('4. The email\'s own words are by the button and the form')
ok('under the hero button: "have a play for a month on us"', 'have a play for a month on us' in hp.lower(), hp)
ok('at the form: "have a play for a month on us"', 'have a play for a month on us' in sub.lower(), sub)
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
   'vp-offer.js' not in IDX and 'vpTrack' not in IDX and 'Have a play, free' not in IDX)
ok('vp-analytics.js is the one place that defines vpTrack', len([p for p in glob.glob(os.path.join(ROOT, 'venueplay', '**', '*.js'), recursive=True) if 'window.vpTrack =' in open(p, encoding='utf-8', errors='replace').read()]) == 1)
txt = re.sub(r'<[^>]+>', ' ', BODY)
ok('brand: no em or en dash anywhere on the page body, "venueplay" never capitalised in the new copy',
   '—' not in hp + sub + offer and '–' not in hp + sub + offer and 'VenuePlay' not in hp + sub + offer)

print('\n%d of %d checks passed' % (passed, passed + failed))
sys.exit(1 if failed else 0)
