#!/usr/bin/env python3
"""THE DRAG BINGO CLUB OFFER PAGE (touring/drag-bingo-at-the-bowlo/clubs.html, 27 Oct 2026).

A club secretary scans the QR on a letter and lands here. The page has one job, the form, and a
handful of claims that must stay true. This loads the file, parses it as HTML, lifts the form's
logic (the block between BEGIN/END CLUB FORM LOGIC) and RUNS it under jsc with real inputs, then
checks what the page says against the brief (~/venue-enrich/drag-bingo-b2b-2026-10-27/offer.md):

  - the form: every field the brief names, the hidden ref, a submit button, an error slot, a
    success state, the privacy line; the logic refuses an empty club, a short phone, a bad email,
    a missing state or room size, accepts a good enquiry, builds the Web3Forms payload with the
    Touring key and kind drag_bingo_club_enquiry, and reads ?ref= off the address but only ours
  - the money lines: "costs the club nothing", "Tickets [$30] plus booking fee" on both sizes,
    the club keeps the bar, kitchen and gaming, and the deal split is still a marked bracket
  - the proof numbers, exactly as the export has them: 223, 113, 336, $9,566, and never "sold out"
  - the three performers named, with the bracket that says the line-up is confirmed per date
  - no VenuePlay (a club page, not a software page), no em dash (the gate's own pattern),
    never "roster", GA4 for Touring and Drag Bingo, the Touring pixel, https://www. on every
    cross-domain Gflam link, every same-site link resolving to a file, the room photo present
    and referenced, the 5-step grid on an explicit repeat(5,1fr) (never auto-fill), the mailing
    list block posting to public.signups as drag_bingo, the canonical and the sitemap entry

Run from the repo root:  python3 tools/drag-bingo-clubs-page.test.py
"""
import io, json, os, re, subprocess, sys, tempfile
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = 'touring/drag-bingo-at-the-bowlo/clubs.html'
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
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


src = read(PAGE)
check('the page exists and is a whole HTML document', src.startswith('<!DOCTYPE html>') and src.rstrip().endswith('</html>'))


# ---------------------------------------------------------------- parse it, the way a browser would
class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields, self.links, self.imgs, self.text, self.skip = {}, [], [], [], 0
        self.forms, self.buttons, self.in_summary, self.summaries = [], [], False, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style'):
            self.skip += 1
        if tag in ('input', 'select', 'textarea') and a.get('id'):
            self.fields[a['id']] = (tag, a.get('type', ''), a.get('name', ''))
        if tag == 'a' and a.get('href'):
            self.links.append(a['href'])
        if tag == 'img':
            self.imgs.append(a.get('src', ''))
        if tag == 'form':
            self.forms.append(a.get('id', ''))
        if tag == 'button':
            self.buttons.append((a.get('id', ''), a.get('type', '')))
        if tag == 'summary':
            self.in_summary = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1
        if tag == 'summary':
            self.in_summary = False

    def handle_data(self, d):
        if not self.skip:
            self.text.append(d)
            if self.in_summary:
                self.summaries.append(d.strip())


p = Page()
p.feed(src)
copy = re.sub(r'\s+', ' ', ' '.join(p.text))

# ---------------------------------------------------------------- the form
for fid, want in [('dbc-club', 'input'), ('dbc-name', 'input'), ('dbc-role', 'input'), ('dbc-phone', 'input'),
                  ('dbc-email', 'input'), ('dbc-state', 'select'), ('dbc-room', 'select'), ('dbc-month', 'select')]:
    check('form field %s is a %s' % (fid, want), p.fields.get(fid, ('',))[0] == want, p.fields.get(fid))
check('the hidden ref field is there', p.fields.get('dbc-ref', ('', ''))[1] == 'hidden', p.fields.get('dbc-ref'))
check('the enquiry is a real <form id="dbcf"> with a submit button, an error slot and a success state',
      'dbcf' in p.forms and ('dbc-send', 'submit') in p.buttons and 'id="dbc-err"' in src and 'id="dbcz"' in src)
check('the room sizes offered are the brief\'s three', all(x in src for x in ('>Under 100 seats<', '>100 to 250 seats<', '>250 seats or more<')))
check('the privacy line sits under the form and links the privacy policy',
      'Your details go to Dean at Gflam Touring and nobody else' in copy and '/privacy-policy' in p.links)
check('the thank-you says Dean will call within one business day', copy.count('Dean will call you within one business day') >= 1)

# ---------------------------------------------------------------- run the form logic
m = re.search(r'/\* BEGIN CLUB FORM LOGIC \*/(.*?)/\* END CLUB FORM LOGIC \*/', src, re.S)
check('the form logic is a marked, pure block (no fetch, no document inside it)',
      bool(m) and 'fetch(' not in m.group(1) and 'document.' not in m.group(1))
logic = m.group(1) if m else ''
harness = logic + r'''
var out = [];
var good = { club: ' Tugun Bowls Club ', name: 'Sam', role: 'Secretary', phone: '0432 071 622', email: 'sam@club.com.au', state: 'QLD', room: '250 or more', month: 'March 2027' };
out.push(['good', clubFormCheck(good)]);
out.push(['noclub', clubFormCheck(Object.assign({}, good, { club: '  ' }))]);
out.push(['shortphone', clubFormCheck(Object.assign({}, good, { phone: '12 34' }))]);
out.push(['bademail', clubFormCheck(Object.assign({}, good, { email: 'sam at club' }))]);
out.push(['nostate', clubFormCheck(Object.assign({}, good, { state: '' }))]);
out.push(['noroom', clubFormCheck(Object.assign({}, good, { room: '' }))]);
out.push(['nomonth', clubFormCheck(Object.assign({}, good, { month: '', role: '' }))]);
out.push(['ref-letter', clubFormRef('?ref=post-letter')]);
out.push(['ref-card', clubFormRef('?x=1&ref=POST-CARD#ask')]);
out.push(['ref-stranger', clubFormRef('?ref=<script>')]);
out.push(['ref-none', clubFormRef('')]);
out.push(['payload', clubFormPayload(good, 'post-letter')]);
out.push(['payload-direct', clubFormPayload(Object.assign({}, good, { month: '' }), '')]);
print(JSON.stringify(out));
'''
res = {}
if os.path.isfile(JSC):
    with tempfile.TemporaryDirectory(prefix='dbc-') as d:
        hp = os.path.join(d, 'h.js')
        io.open(hp, 'w', encoding='utf-8').write(harness)
        r = subprocess.run([JSC, hp], capture_output=True, text=True, timeout=60)
    try:
        res = dict(json.loads(r.stdout.strip().splitlines()[-1]))
    except Exception as e:
        res = {'error': (r.stdout + r.stderr)[-300:]}
check('the logic runs under jsc', 'error' not in res and bool(res), res.get('error'))
check('a complete enquiry is accepted', res.get('good') == '', res.get('good'))
check('an empty club name is refused, and the message says so', bool(res.get('noclub')) and 'club' in res.get('noclub', ''), res.get('noclub'))
check('a phone number under 8 digits is refused', bool(res.get('shortphone')) and 'phone' in res.get('shortphone', ''), res.get('shortphone'))
check('an email without an @ and a dot is refused', bool(res.get('bademail')) and 'email' in res.get('bademail', ''), res.get('bademail'))
check('no state is refused (the permit answer differs by state)', bool(res.get('nostate')) and 'state' in res.get('nostate', ''), res.get('nostate'))
check('no room size is refused (it picks the show)', bool(res.get('noroom')) and 'seats' in res.get('noroom', ''), res.get('noroom'))
check('month and role are optional', res.get('nomonth') == '', res.get('nomonth'))
check('?ref=post-letter is kept, ?ref=POST-CARD is kept lower-cased, a stranger\'s ref becomes "other", none is empty',
      res.get('ref-letter') == 'post-letter' and res.get('ref-card') == 'post-card' and res.get('ref-stranger') == 'other' and res.get('ref-none') == '',
      [res.get('ref-letter'), res.get('ref-card'), res.get('ref-stranger'), res.get('ref-none')])
pl = res.get('payload') or {}
check('the payload carries the Touring Web3Forms key, a subject naming the club, kind drag_bingo_club_enquiry, the ref and the page',
      pl.get('access_key') == '37c805da-5dee-4732-8441-7c3ebb532a66' and pl.get('subject') == 'Drag Bingo club enquiry: Tugun Bowls Club'
      and pl.get('kind') == 'drag_bingo_club_enquiry' and pl.get('ref') == 'post-letter' and pl.get('room_size') == '250 or more'
      and pl.get('page', '').endswith('/drag-bingo-at-the-bowlo/clubs'), pl)
pd = res.get('payload-direct') or {}
check('with no ref the payload says direct, and no month says Not sure yet', pd.get('ref') == 'direct' and pd.get('preferred_month') == 'Not sure yet', pd)
check('the page posts that payload to Web3Forms (the way contact.html and work-with-us.html do)',
      "fetch('https://api.web3forms.com/submit'" in src and 'JSON.stringify(clubFormPayload(v, ref))' in src)

# ---------------------------------------------------------------- the money lines
check('the hero says it costs the club nothing', 'It costs the club nothing.' in copy)
check('both sizes carry the ticket line: Tickets [$30] plus booking fee', len(re.findall(r'Tickets \[\$30\] plus booking fee', copy)) == 2, re.findall(r'Tickets[^.]{0,40}booking fee', copy))
check('the club keeps the bar, the kitchen and gaming', 'The club keeps everything over the bar, the kitchen and gaming' in copy)
check('the deal split is still Dean\'s bracket, not a number somebody invented', '[keeps the ticket money]' in copy)
check('the two room sizes are stated', 'Rooms of 250 or more' in copy and 'Rooms of 100 to 250' in copy and 'Minimum room: 100 seats' in copy)

# ---------------------------------------------------------------- the proof, true to the export
# Read from the proof STRIP itself, not the whole page: the FAQ answer repeats "223 tickets on the
# first night", and a whole-page search stayed green with the strip changed to 245 (proven blind
# on 27 Oct 2026, the first time this was run).
sm = re.search(r'<section[^>]*id="proof".*?</section>', src, re.S)
strip = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', sm.group(0))) if sm else ''
check('the proof strip is its own section', bool(sm))
for n, where in (('223', 'tickets on the first night'), ('113', 'tickets on the second'), ('336', 'tickets across two nights'), ('$9,566', 'in ticket sales')):
    check('proof strip: %s %s' % (n, where), re.search(re.escape(n) + r'\s+' + re.escape(where), strip) is not None, strip[:200])
check('the strip carries no other number than those four and the two dates', sorted(set(re.findall(r'\$?[\d,]{3,}', strip))) == ['$9,566', '113', '2026', '223', '336'], re.findall(r'\$?[\d,]{3,}', strip))
check('the FAQ repeats the same two night counts', '223 tickets on the first night and 113 on the second' in copy)
check('the source note names Tugun Bowls Club and both dates', 'Tugun Bowls Club, 6 June and 24 October 2026' in copy)
check('never "sold out" (neither Tugun night is recorded as one)', 'sold out' not in copy.lower())
check('no bar take and no cash-prize promise', 'bar take' not in copy.lower() and 'cash prize' not in copy.lower().replace('cash prize is promised', ''))
check('the three performers are named, with the per-date bracket',
      all(q in copy for q in ('Vollie LaVont', 'ShuShu Funtanna', 'Scarlett Fever')) and '[Line-up confirmed when a date is booked]' in copy)
check('the five questions clubs ask are the brief\'s five',
      p.summaries == ['Do we pay anything?', 'How many people will come?', 'Is it family friendly?', 'Do we need a permit?', 'What if it does not sell?'], p.summaries)

# ---------------------------------------------------------------- house rules and plumbing
check('no VenuePlay on a club page', 'venueplay' not in src.lower())
check('no em dash in copy (the gate\'s own pattern)', re.search(r'\w\s*[—–]\s*\w', copy) is None, re.findall(r'.{20}[—–].{20}', copy)[:3])
check('never "roster"', 'roster' not in copy.lower())
check('GA4 for Touring and for Drag Bingo, and the Touring pixel',
      "gtag('config', 'G-V36EX4RX85')" in src and "gtag('config', 'G-F70HEE34EK')" in src and "fbq('init', '1597842404816132')" in src)
check('the form sends a GA4 event and a pixel Lead on success', "gtag('event', 'club_enquiry'" in src and "fbq('track', 'Lead')" in src)
cross = [l for l in p.links if re.match(r'https?://(?!www\.)[a-z0-9.-]*gflam', l)]
check('every cross-domain Gflam link has https://www.', not cross, cross)
missing = []
for l in p.links:
    if l.startswith(('http', 'mailto:', 'tel:', '#')):
        continue
    path = l.split('#')[0].split('?')[0]
    cands = [path.lstrip('/'), path.lstrip('/') + '.html', os.path.join(path.lstrip('/'), 'index.html')]
    if not any(c and os.path.isfile(os.path.join(ROOT, 'touring', c)) for c in cands):
        missing.append(l)
check('every same-site link resolves to a file in touring/', not missing, missing)
check('the room photo is in the repo and on the page', os.path.isfile(os.path.join(ROOT, 'touring', 'drag-bingo-at-the-bowlo', 'tugun-room.jpg'))
      and '/drag-bingo-at-the-bowlo/tugun-room.jpg' in p.imgs)
check('the 5-step grid is an explicit repeat(5,1fr), never auto-fill', '.steps{display:grid;grid-template-columns:repeat(5,1fr)' in src and 'auto-fill' not in src)
check('the mailing list block posts to public.signups as drag_bingo, signup_type signup',
      "/rest/v1/signups'" in src and "source:'drag_bingo',signup_type:'signup'" in src and 'dbsfa' in p.fields and 'dbsfc' in p.fields)
check('the canonical is the clubs address', '<link rel="canonical" href="https://www.gflamtouring.com.au/drag-bingo-at-the-bowlo/clubs">' in src)
check('the sitemap lists it', '<loc>https://www.gflamtouring.com.au/drag-bingo-at-the-bowlo/clubs</loc>' in read('touring/sitemap.xml'))

print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
