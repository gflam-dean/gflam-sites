#!/usr/bin/env python3
"""THE SUPPORT PHONE: ONE NUMBER, WHERE A VENUE LOOKS, AND NOWHERE A PLAYER DOES (20 Oct 2026).

Dean: VenuePlay has a support line, 07 5228 3667, a Crazytel menu (1 sales, 2 a venue running a
game, 3 players, 4 accounts). Written exactly "07 5228 3667", linked as tel:+61752283667, wherever
a venue or a venue that might be one looks for help; never on a player's phone screen.

THE ONE PLACE is the billing Worker: VP_SUPPORT_PHONE and VP_SUPPORT_TEL. Every email takes it
from there (venueplay-backend/worker/support-phone-emails.test.js runs them). A static page cannot
import a constant, so the site carries the number as text, and this suite is what makes those
copies one answer: it reads the Worker's two strings and then

  - every phone number and every tel: link in every file we serve, every migration and the Worker
    must be THAT number (a typo, an old number or a second number anywhere is red)
  - the help widget's own copy is the same two strings
  - the places a venue looks for HELP have it: the /help page (venue part and sales form), the
    console's Help panel, the venue FAQ, and the four email templates (as the tags the Worker
    fills). Since 23 Oct 2026 (Dean) the PUBLIC pages do not: the sales pages, terms, privacy,
    llms.txt and the structured data point at the help page instead
  - the places a player looks never do: the bingo, musical bingo and trivia phones, the TV, the
    player FAQ, and all of PartyPlay bar the one shared widget file (where it is gated to
    VenuePlay venues, which help-desk-pages.test.py proves in a browser)

Run from the repo root:  python3 tools/support-phone.test.py
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = ran = 0


def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok or saw is None else '   saw: ' + json.dumps(saw, default=str)[:300]))
    if not ok:
        fails += 1


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace') as f:
        return f.read()


def no_comments(s, kind):
    if kind == 'html':
        return re.sub(r'<!--.*?-->', ' ', s, flags=re.S)
    if kind == 'js':
        s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
        return re.sub(r'(^|[^:\\])//[^\n]*', r'\1', s)
    if kind == 'sql':
        return re.sub(r'--[^\n]*', ' ', s)
    return s


# ---------------------------------------------------------------- the one place
W = read('venueplay-backend/worker/venueplay-api-FULL.js')
m1 = re.findall(r"^const VP_SUPPORT_PHONE = '([^']+)';", W, re.M)
m2 = re.findall(r"^const VP_SUPPORT_TEL = '([^']+)';", W, re.M)
check('the billing Worker defines the number once, VP_SUPPORT_PHONE and VP_SUPPORT_TEL', len(m1) == 1 and len(m2) == 1, [m1, m2])
SHOW = m1[0] if m1 else '07 5228 3667'
TEL = m2[0] if m2 else '+61752283667'
DIGITS = re.sub(r'\D', '', SHOW)
check('it is written the Australian way, "07 5228 3667", and the tel: link is the same number in +61 form',
      SHOW == '07 5228 3667' and TEL == '+61' + DIGITS[1:], [SHOW, TEL])

# ---------------------------------------------------------------- every copy is this one
SERVED = []
for base in ('venueplay', 'partyplay'):
    for d, dirs, fs in os.walk(os.path.join(ROOT, base)):
        dirs[:] = [x for x in dirs if x not in ('node_modules', '.git')]
        for f in fs:
            # JSON is words only where a person reads it: the Help FAQ. The rest is song and question
            # data, whose catalogue codes look like phone numbers and are not.
            if f.endswith('.json') and f != 'help-faq.json':
                continue
            if f.endswith(('.html', '.js', '.json', '.txt', '.xml', '.css')) and not f.endswith('.test.js'):
                SERVED.append(os.path.relpath(os.path.join(d, f), ROOT))
OTHER = ['venueplay-backend/worker/venueplay-api-FULL.js', 'venueplay-backend/worker/venueplay-game.js']
for d in ('venueplay-backend/supabase', 'partyplay-backend/supabase'):
    if os.path.isdir(os.path.join(ROOT, d)):
        OTHER += [os.path.join(d, f) for f in sorted(os.listdir(os.path.join(ROOT, d))) if f.endswith('.sql')]

# An Australian landline or 13/1300/1800 number, spaced any way, and any tel: link with digits in it.
# Mobiles (04..) are left alone: the sites show "0400 000 000" as a placeholder in phone fields.
LANDLINE = re.compile(r'(?<![\d+])(?:\(0[2378]\)\s?|0[2378][\s-]?)\d{4}[\s-]?\d{4}(?!\d)|(?<!\d)1[38]00[\s-]?\d{3}[\s-]?\d{3}(?!\d)')
INTL = re.compile(r'\+61[\s-]?\(?[2378]\)?[\s-]?\d{4}[\s-]?\d{4}(?!\d)')
TEL_LINK = re.compile(r'tel:([+\d][\d\s().-]*\d)')
wrong, where_found = [], []
for rel in SERVED + OTHER:
    kind = 'html' if rel.endswith('.html') else 'js' if rel.endswith('.js') else 'sql' if rel.endswith('.sql') else ''
    s = no_comments(read(rel), kind)
    hits = [(h, 'display') for h in LANDLINE.findall(s)] + [(h, 'intl') for h in INTL.findall(s)] + [(h, 'tel') for h in TEL_LINK.findall(s)]
    for h, k in hits:
        ok_ = (h == SHOW) if k == 'display' else (re.sub(r'[^\d+]', '', h) == TEL and (k != 'tel' or h == TEL))
        if not ok_:
            wrong.append('%s: %s' % (rel, h))
    if hits:
        where_found.append(rel)
SEEN = ['venueplay/help.html', 'venueplay/data/help-faq.json', 'venueplay/app/vp-help.js',
        'venueplay-backend/worker/venueplay-api-FULL.js', 'venueplay-backend/supabase/venueplay-112-help-faq-support-phone.sql']
check('the sweep below is not blind: it found the number in each place it is meant to be', all(x in where_found for x in SEEN),
      [x for x in SEEN if x not in where_found])
check('every phone number and tel: link we serve, send or store is exactly "%s" / tel:%s' % (SHOW, TEL), not wrong, wrong[:6])

# ---------------------------------------------------------------- the widget's own copy
H = read('venueplay/app/vp-help.js')
mw = re.search(r'var SUPPORT_PHONE = BRAND === "venueplay" \? \{ show: "([^"]+)", tel: "([^"]+)" \} : null;', H)
gate = re.search(r'function phoneFor\(ctx\) \{ return ctx && \(ctx\.mode === "venue" \|\| ctx\.mode === "venue_public"\) \? SUPPORT_PHONE : null; \}', H)
check('the help widget holds the same two strings, for VenuePlay only, and hands them only to a venue form (the console\'s, or /help\'s venue part)',
      bool(mw) and mw.group(1) == SHOW and mw.group(2) == TEL and bool(gate) and no_comments(H, 'js').count('SUPPORT_PHONE') == 2, mw and mw.groups())
check('the PartyPlay copy of the widget is the same file, so it is gated the same way', read('partyplay/lib/vp-help.js') == H)

# ---------------------------------------------------------------- where a venue looks, and where the public does not
# 23 Oct 2026, Dean: phone numbers come OFF every public page. The number lives in the help sections
# (the /help page's venue part and sales form, the console's Help panel, the venue FAQ) and in the
# emails a venue gets. The sales pages, terms, privacy, llms.txt and the structured data point at
# the help page instead. Until this date the checks below asserted the opposite.
def has_link(s):
    return ('<a href="tel:%s">%s</a>' % (TEL, SHOW)) in s or re.search(r'<a [^>]*href="tel:%s"[^>]*>%s</a>' % (re.escape(TEL), re.escape(SHOW)), s) is not None


def no_phone(s):
    return SHOW not in s and DIGITS not in s and 'tel:' not in s


for page in ('venueplay/index.html', 'venueplay/nsw.html'):
    s = no_comments(read(page), 'html')
    foot = s[s.find('<footer'):s.find('</footer>')]
    check(page + ': the footer has the email and no phone number', bool(foot) and 'hello@venueplay.com.au' in foot and no_phone(foot), foot[-300:])
    form = re.search(r'<p class="form-fine">Or email us directly at <a href="mailto:sales@venueplay\.com\.au">sales@venueplay\.com\.au</a></p>', s)
    check(page + ': the contact form offers sales@venueplay.com.au and no phone number', bool(form), s[s.find('<p class="form-fine">'):s.find('<p class="form-fine">') + 200])
    faq = re.search(r'<summary>What support do I get\?.*?</details>', s, re.S)
    check(page + ': the "What support do I get?" answer sends venues to the Help page for the number, says press 2, and carries no number itself',
          bool(faq) and 'href="/help"' in faq.group(0) and 'press 2' in faq.group(0) and no_phone(faq.group(0)), faq and faq.group(0)[-260:])
for page in ('venueplay/terms.html', 'venueplay/privacy.html'):
    s = no_comments(read(page), 'html')
    block = re.search(r'Contact us</h2>\s*<p>(.*?)</p>', s, re.S)
    check(page + ': "Contact us" lists the email and the ABN, and no phone', bool(block) and 'Email: ' in block.group(1) and 'ABN' in block.group(1) and 'Phone' not in block.group(1) and no_phone(block.group(1)), block and block.group(1))
    foot = s[s.find('<footer'):s.find('</footer>')]
    check(page + ': and nor does the footer', bool(foot) and no_phone(foot))

s = read('venueplay/index.html')
ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', s, re.S)
try:
    data = json.loads(ld.group(1)) if ld else {}
except Exception as e:
    data = {'error': str(e)}
pub = data.get('publisher') or {}
cp = pub.get('contactPoint') or {}
check('the home page structured data still parses, names a support ContactPoint by email, and carries no telephone',
      pub.get('@type') == 'Organization' and cp.get('@type') == 'ContactPoint' and cp.get('contactType') == 'customer support'
      and cp.get('email') == 'support@venueplay.com.au' and 'telephone' not in cp and 'telephone' not in pub, data)

PUBLIC = ['venueplay/index.html', 'venueplay/nsw.html', 'venueplay/terms.html', 'venueplay/privacy.html', 'venueplay/see-a-night.html',
          'venueplay/404.html', 'venueplay/llms.txt', 'venueplay/sitemap.xml', 'venueplay/add-card.html', 'venueplay/unsubscribe.html']
bad = [p for p in PUBLIC if not no_phone(no_comments(read(p), 'html' if p.endswith('.html') else ''))]
check('no public VenuePlay page carries the number or a tel: link (the sales pages, terms, privacy, llms.txt, 404, see-a-night, add-card, unsubscribe)', not bad, bad)

# The public help page (21 Oct 2026). The venue part's call line is the widget's (help-desk-pages.test.py
# runs it); the page's own copy is under the sales form. Its player part and its footer never carry it.
s = no_comments(read('venueplay/help.html'), 'html')
def part(pid):
    m = re.search(r'<div class="panel" id="%s".*?(?=<div class="panel" id=|</section>)' % pid, s, re.S)
    return m.group(0) if m else ''
sales = part('sales')
check('/help: under the sales form, "or call 07 5228 3667", tappable, beside sales@venueplay.com.au', has_link(sales) and 'or call <a' in sales and 'mailto:sales@venueplay.com.au' in sales, sales[-260:])
pl, foot = part('player'), s[s.find('<footer'):s.find('</footer>')]
check('/help: the player part and the footer have no phone number and no tel: link',
      bool(pl) and bool(foot) and no_phone(pl) and no_phone(foot), [pl[-200:], foot[-200:]])

llms = read('venueplay/llms.txt')
check('llms.txt (what an assistant reads about us) names the three mailboxes and sends the phone to the help page',
      'support@venueplay.com.au' in llms and 'accounts@venueplay.com.au' in llms and 'sales@venueplay.com.au' in llms and 'help page' in llms and no_phone(llms))

faq = json.load(open(os.path.join(ROOT, 'venueplay', 'data', 'help-faq.json'), encoding='utf-8'))
contact = [it for it in faq['venue']['items'] if it['q'] == 'Contacting us']
check('the venue FAQ "Contacting us" says: if a game is on right now, call %s and press 2' % SHOW,
      len(contact) == 1 and ('call %s and press 2' % SHOW) in contact[0]['a'], contact)

for t in ('welcome', 'welcome-group', 'welcome-hq', 'venue-onboarding', 'welcome-prospect'):
    s = no_comments(read('venueplay/emails/%s.html' % t), 'html')
    check('email template %s: its footer has the call line, as the tags the Worker fills (one place)' % t,
          re.search(r'<a href="tel:\{\{support_tel\}\}"[^>]*>\{\{support_phone\}\}</a> and press 2', s) is not None and SHOW not in s)

# ---------------------------------------------------------------- where a player looks
PLAYER = ['venueplay/play.html', 'venueplay/app/musical/play.html', 'venueplay/app/trivia/play.html', 'venueplay/tv.html']
bad = [p for p in PLAYER if SHOW in read(p) or DIGITS in read(p) or 'tel:' in read(p)]
check('no player phone screen and not the TV: bingo, musical bingo, trivia, tv.html', not bad, bad)
pat = [it['q'] for it in faq['patron']['items'] if SHOW in it['a'] or DIGITS in it['a']]
check('the player FAQ has no phone line (players use Help; the menu sends them to voicemail)', not pat, pat)
pp = [p for p in SERVED if p.startswith('partyplay/') and p != 'partyplay/lib/vp-help.js' and (SHOW in read(p) or DIGITS in read(p) or TEL in read(p))]
check('nothing in PartyPlay carries the VenuePlay number (bar the shared widget, gated off there)', not pp, pp)

print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
