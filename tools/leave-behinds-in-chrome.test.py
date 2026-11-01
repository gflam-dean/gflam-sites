#!/usr/bin/env python3
"""THE PRINTED LEAVE-BEHINDS QUOTE ONLY THE STANDARD RATE, ON SCREEN AND ON PAPER, IN CHROME (1 Nov 2026).

On 1 November 2026 all four A4 leave-behinds (/leave-behind for bowls clubs, /leave-behind-pub,
/leave-behind-club, /leave-behind-rsl) still sold the founding offer: "$2.50 /player", "$2.30
/player", "Locked for life", "Offer ends this month", "This rate is offered until the end of the
month". The month had ended. A handout cannot be taken back off a bar, so Dean's rule is that printed
material quotes only the standard rate ($3.00 a player a month, $2.85 annual, first month free) and an
offer lives only on its dated /offer-<month> page. The bingo line also said players "dab along",
which the house rules never say.

This opens each REAL page at its REAL address (the rig serves /leave-behind-pub from
leave-behind-pub.html, as Pages does) and reads what is painted, three ways:

  1. screen media at desktop width (1280) and at phone width (390, where the A4 sheet reflows);
  2. PRINT media at A4 width (Emulation.setEmulatedMedia), which is what a rep's printer is fed;
  3. the real printed PDF (Page.printToPDF with the page's own @page size): exactly one A4 page.

On each: no "$2.50", "$2.30", "lock in", "locked for life", "founding", "dab"/"daub", "roster", an
em or en dash, a .dev address, or any phone number but the 07 landline; every dollar figure is a
standard one; the price panel reads Monthly $3.00 and Annual $2.85 a player with the first month
free; the busy-night line is the agreed one; the three steps are the flyers' (Pick your game, Scan
the code, You press go); 37,000+ questions and 5,000+ songs; the fine print says the venue runs the
game, winners claim from the host, and the state's gaming rules are shown at setup (musical bingo is
not in that list: it is not bingo). The pub page leads with "Run a packed Tuesday. Every Tuesday."

    python3 tools/leave-behinds-in-chrome.test.py [--shots DIR] [--root CHECKOUT]

--shots saves, per page, the desktop screen, the phone screen, the print-media view at A4 width and
the printed PDF (render the PDF to look at the page exactly as it prints).
"""
import argparse, base64, json, os, re, sys, time

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


PAGES = (('/leave-behind', 'bowls club'), ('/leave-behind-pub', 'pub'),
         ('/leave-behind-club', 'club'), ('/leave-behind-rsl', 'RSL'))

# Words a handout may never carry. "No lock-in" (a contract) is fine and is the flyers' own words.
BANNED = re.compile(r'\$2\.50|\$2\.30|\block(?:ed|ing)?\s+(?:it\s+|your\s+\w+\s+)?in\b|locked for life|founding'
                    r'|\bdab\w*|\bdaub\w*|\broster\w*|[—–]|\.dev\b|workers\.dev|offer ends|end of the month', re.I)
STANDARD_DOLLARS = {'$3.00', '$2.85', '$2', '$90'}
BUSY = '$2 per extra player that night, and your host OKs it on screen first.'
STEPS = ['Pick your game', 'Scan the code', 'You press go']
LEGAL = ("Your venue runs each game and sets the prizes, and winners claim from your host. venueplay supplies "
         "the software. Bingo, raffles and members draws follow your state's gaming rules, and we show you what "
         "applies when you set up.")
LANDLINE = '07 5228 3667'

SEE = r'''(function(){
  var vis = function(el){ if(!el) return false; var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
  // textContent, not innerText: the labels are styled upper case, and what is checked is the words.
  var t = function(el){ return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; };
  var prices = Array.prototype.map.call(document.querySelectorAll(".offer .price"), function(p){
    return t(p.querySelector(".lbl")) + "=" + t(p.querySelector(".amt")); });
  var panel = document.querySelector(".offer");
  var mark = document.querySelector(".top .logo svg");
  return JSON.stringify({
    all: document.body.innerText,
    h1: (document.querySelector(".hero h1") || {innerText: ""}).innerText.replace(/\s+/g, " ").trim(),   // the line break is a space
    prices: prices,
    badge: vis(document.querySelector(".offer .badge")) ? t(document.querySelector(".offer .badge")) : null,
    terms: Array.prototype.map.call(document.querySelectorAll(".offer .oterms li > div"), t),
    steps: Array.prototype.map.call(document.querySelectorAll(".steps .st"), t),
    legal: vis(document.querySelector(".legal")) ? t(document.querySelector(".legal")) : "",
    panelBg: panel ? getComputedStyle(panel).backgroundColor : "",
    panelExact: panel ? (getComputedStyle(panel).printColorAdjust || getComputedStyle(panel).webkitPrintColorAdjust || "") : "",
    mark: vis(mark) && !!mark.querySelector("path"),
    word: t(document.querySelector(".top .logo .word")),
    sheetH: document.querySelector(".sheet").getBoundingClientRect().height,
    sheetW: document.querySelector(".sheet").getBoundingClientRect().width,
    sw: document.documentElement.scrollWidth, vw: innerWidth,
    fonts: document.fonts ? document.fonts.status : "n/a"
  });
})()'''


def see(S, sid):
    v = S.js(sid, SEE)
    return json.loads(v) if isinstance(v, str) else {}


def load(S, path, w, h, mobile):
    tid, sid = S.open(path, w, h, mobile=mobile)
    S.until(sid, 'document.readyState==="complete" && !!document.querySelector(".sheet")', 20)
    S.js(sid, 'document.fonts ? document.fonts.ready.then(function(){return true}) : true', wait=True, secs=15)
    time.sleep(0.4)
    return tid, sid


def shot(S, sid, name, full=True):
    if not A.shots:
        return
    os.makedirs(A.shots, exist_ok=True)
    S.js(sid, 'window.scrollTo(0,0); true')
    time.sleep(0.3)
    S.shot(sid, os.path.join(A.shots, name + '.png'), full=full)


def same_copy(tag, v, path):
    """The checks every view must pass: screen, phone and print."""
    allt = v.get('all', '')
    hits = sorted(set(m.group(0) for m in BANNED.finditer(allt)))
    ok('%s: no offer price or banned word ($2.50, $2.30, lock in, founding, dab, roster, em dash, .dev)' % tag,
       allt and not hits, hits)
    dollars = set(re.findall(r'\$\d(?:[\d,]*\d)?(?:\.\d\d)?', allt))
    ok('%s: every dollar figure is a standard one ($3.00, $2.85, $2 a busy-night player, $90 for 30)' % tag,
       dollars and dollars <= STANDARD_DOLLARS and {'$3.00', '$2.85'} <= dollars, sorted(dollars))
    ok('%s: the price panel reads Monthly $3.00 and Annual $2.85 a player, first month free, no lock-in' % tag,
       v.get('prices') == ['Monthly=$3.00 /player', 'Annual=$2.85 /player'] and v.get('badge') == 'First month free'
       and any(x.startswith('First month free.') for x in v.get('terms', []))
       and any(x.startswith('No lock-in, no setup fee.') for x in v.get('terms', [])), (v.get('prices'), v.get('badge'), v.get('terms')))
    ok('%s: a busy night is the agreed line, and 30 players is $90 a month' % tag,
       any(x == 'Big night? ' + BUSY for x in v.get('terms', [])) and any('with 30 players pays $90 a month.' in x for x in v.get('terms', [])),
       v.get('terms'))
    ok('%s: the three steps are the flyers\': Pick your game, Scan the code, You press go' % tag, v.get('steps') == STEPS, v.get('steps'))
    ok('%s: 37,000+ questions and 5,000+ songs' % tag, '37,000+ trivia questions and 5,000+ songs' in re.sub(r'\s+', ' ', allt))
    ok('%s: the fine print: the venue runs it, winners claim from the host, the state\'s rules shown at setup' % tag,
       v.get('legal') == LEGAL and 'musical' not in v.get('legal', '').lower(), v.get('legal'))
    phones = re.findall(r'(?<![\d$.])(?:\+?61\s?|0)[2-478](?:[\s-]?\d){8}\b', allt)
    ok('%s: no phone number but the 07 landline' % tag, all(re.sub(r'\D', '', p) == re.sub(r'\D', '', LANDLINE) for p in phones), phones)
    ok('%s: the VenuePlay mark and word are in the header' % tag, v.get('mark') and v.get('word') == 'VenuePlay', (v.get('mark'), v.get('word')))
    if path == '/leave-behind-pub':
        ok('%s: leads with "Run a packed Tuesday. Every Tuesday."' % tag, (v.get('h1') or '').lower() == 'run a packed tuesday. every tuesday.', v.get('h1'))


def pdf_pages(data):
    """(pages, [width, height] in points) of a PDF Chrome wrote. Its page objects are plain dictionaries."""
    n = len(re.findall(rb'/Type\s*/Page(?![s\w])', data))
    m = re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', data)
    return n, ([float(m.group(1)), float(m.group(2))] if m else None)


S = admin_site.Site(root=A.root, fonts=bool(A.shots))
try:
    for path, who in PAGES:
        name = path.strip('/')
        print('\n%s (%s)' % (path, who))
        f = os.path.join(A.root, 'venueplay', name + '.html')
        ok('%s is served from %s.html and is kept out of search' % (path, name),
           os.path.isfile(f) and re.search(r'<meta name="robots" content="noindex', open(f, encoding='utf-8').read()) is not None)

        tid, sid = load(S, path, 1280, 900, False)
        v = see(S, sid)
        same_copy('%s desktop screen' % name, v, path)
        shot(S, sid, 'leave-behinds-1nov-%s-screen' % name)
        S.close_tab(tid)

        tid, sid = load(S, path, 390, 844, True)
        v = see(S, sid)
        same_copy('%s phone' % name, v, path)
        ok('%s phone: the sheet reflows to the phone, nothing scrolls sideways' % name, v.get('sw', 9999) <= v.get('vw', 0) and v.get('sheetW', 9999) <= 390,
           (v.get('sw'), v.get('vw'), v.get('sheetW')))
        shot(S, sid, 'leave-behinds-1nov-%s-phone' % name)
        S.close_tab(tid)

        # PRINT: the same page, as the printer is given it. A4 at 96 dpi is 794 x 1123 CSS px.
        tid, sid = load(S, path, 794, 1123, False)
        S.B.call('Emulation.setEmulatedMedia', {'media': 'print'}, session=sid)
        time.sleep(0.5)
        v = see(S, sid)
        same_copy('%s print' % name, v, path)
        ok('%s print: the price panel prints dark (#0A0A0B, colours kept exact)' % name,
           v.get('panelBg') == 'rgb(10, 10, 11)' and v.get('panelExact') == 'exact', (v.get('panelBg'), v.get('panelExact')))
        shot(S, sid, 'leave-behinds-1nov-%s-print' % name)
        r = S.B.call('Page.printToPDF', {'preferCSSPageSize': True, 'printBackground': True}, session=sid)
        data = base64.b64decode(r.get('data', ''))
        n, box = pdf_pages(data)
        ok('%s print: the PDF is exactly ONE A4 page (595 x 842 pt)' % name,
           n == 1 and box is not None and abs(box[0] - 595.3) < 2 and abs(box[1] - 841.9) < 2, (n, box, len(data)))
        if A.shots:
            with open(os.path.join(A.shots, 'leave-behinds-1nov-%s.pdf' % name), 'wb') as fh:
                fh.write(data)
        S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 4 * (1 + 3 * 9 + 1 + 1 + 1) + 3
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
