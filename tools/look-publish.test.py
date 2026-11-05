#!/usr/bin/env python3
"""tools/look-publish.py, RUN against prospect folders made here (build job 7, 5 Nov 2026).

A venue whose website photos were poor never has a slide uploaded, the code is 128 random URL-safe bits and
survives a republish, nothing personal reaches look.json, nothing lists the codes, and an ended offer is
refused. Every folder, register and output directory is a temporary one: the real prospects and the real
register (~/venue-enrich/look-codes.json) are never touched.
Run: python3 tools/look-publish.test.py
"""
import importlib.util, io, json, os, re, struct, sys, tempfile, calendar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('look_publish', os.path.join(ROOT, 'tools', 'look-publish.py'))
lp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lp)

bad = ran = 0


def ok(name, cond, saw=None):
    global bad, ran
    ran += 1
    if cond:
        print('  ok   ' + name)
    else:
        bad += 1
        print('  FAIL ' + name + ('   saw: %r' % (saw,) if saw is not None else ''))


def jpeg(w=1920, h=1080, exif=False):
    """A JPEG's header as the slide maker writes it: SOI, JFIF, (Exif), SOF0 with the size, EOI."""
    b = b'\xff\xd8' + b'\xff\xe0' + struct.pack('>H', 16) + b'JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    if exif:
        b += b'\xff\xe1' + struct.pack('>H', 16) + b'Exif\x00\x00' + b'\x00' * 8
    b += b'\xff\xc0' + struct.pack('>HBHHB', 11, 8, h, w, 1) + b'\x01\x11\x00'
    return b + b'\x00' * 64 + b'\xff\xd9'


TMP = tempfile.mkdtemp(prefix='look-publish-test-')
OUT = os.path.join(TMP, 'look-data')
REG = os.path.join(TMP, 'look-codes.json')
DEC15 = calendar.timegm((2026, 12, 15, 2, 0, 0))      # fixed clocks, never today's
DEC3 = calendar.timegm((2026, 12, 3, 2, 0, 0))


def prospect(name, photos, n=6, social=True, prospect_extra=None, sizes=None, exif_at=None, missing_at=None):
    folder = os.path.join(TMP, 'prospects', name)
    sdir = os.path.join(folder, 'slides')
    os.makedirs(sdir)
    slides = []
    for i in range(n):
        f = '%02d-s%d.jpg' % (i + 1, i)
        slides.append({'key': 'k%d' % i, 'head': 'Head %d' % i, 'file': f,
                       'photo': {'url': 'https://x/%d.jpg' % i, 'size': [2000, 1500]} if i < photos else None})
    if social:
        slides.append({'key': 'social', 'head': 'Follow us on Facebook', 'file': '%02d-social.jpg' % (n + 1), 'photo': None})
    for i, s in enumerate(slides):
        if missing_at == i:
            continue
        w, h = (sizes or {}).get(i, (1920, 1080))
        io.open(os.path.join(sdir, s['file']), 'wb').write(jpeg(w, h, exif=(exif_at == i)))
    json.dump({'venue': name, 'slides': slides}, io.open(os.path.join(sdir, 'plan.json'), 'w'))
    p = {'company': name, 'short_name': name, 'reply_email': 'owner@example.com', 'first_name': 'Sam',
         'mobile': '0400 000 000', 'postcode': '4000', 'their_words': 'yes please'}
    p.update(prospect_extra or {})
    json.dump(p, io.open(os.path.join(folder, 'prospect.json'), 'w'))
    return folder


def files(code):
    d = os.path.join(OUT, code)
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


def manifest(code):
    return json.load(io.open(os.path.join(OUT, code, 'look.json')))


pub = lambda f, **k: lp.publish(f, out=OUT, register=REG, now=k.pop('now', DEC3), **k)

# ---- the code
c1, c2 = lp.new_code(), lp.new_code()
ok('a code is 22 URL-safe characters (16 random bytes, 128 bits)', len(c1) == 22 and re.match(r'^[A-Za-z0-9_-]{22}$', c1), c1)
ok('two codes are never the same', c1 != c2)
ok('the code comes from secrets, not random', 'secrets.token_urlsafe(16)' in io.open(os.path.join(ROOT, 'tools', 'look-publish.py')).read()
   and 'import random' not in io.open(os.path.join(ROOT, 'tools', 'look-publish.py')).read())

# ---- a good venue
good = prospect('The Good Arms', photos=3)
r = pub(good)
ok('3 real photos of 6: their slides go up', r['mode'] == 'slides' and r['slides'] == 7, r)
ok('the link is venueplay.com.au/look/<code>', r['url'] == 'https://venueplay.com.au/look/' + r['code'], r['url'])
ok('the slides are renamed 01.jpg.. beside look.json, nothing else', files(r['code']) == ['01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg', '07.jpg', 'look.json'], files(r['code']))
m = manifest(r['code'])
ok('look.json says the venue, the mode, the offer and the slides', m['v'] == 1 and m['venue'] == 'The Good Arms' and m['mode'] == 'slides' and m['offer'] == 'dec', m)
ok('each slide says whether it carries a real photo, and which is the social one',
   [s['photo'] for s in m['slides']] == [True, True, True, False, False, False, False] and m['slides'][-1]['social'] is True)
blob = json.dumps(m)
ok('nothing personal in look.json (no email, name, mobile, postcode, their words)',
   not any(x in blob for x in ('owner@example.com', 'Sam', '0400', '4000', 'yes please', 'https://x/')), blob)
reg = json.load(io.open(REG))
ok('the register records the code and folder, outside the site folder', reg[r['code']]['folder'] == good and not REG.startswith(OUT))
ok('no index, list or sitemap is written beside the codes', sorted(os.listdir(OUT)) == [r['code']], os.listdir(OUT))

# ---- republish keeps the link; --new-code replaces it
r2 = pub(good)
ok('publishing the same folder again keeps its code (the emailed link still works)', r2['code'] == r['code'])
r3 = pub(good, fresh=True)
ok('a new code removes the old folder and marks it removed', r3['code'] != r['code'] and not os.path.isdir(os.path.join(OUT, r['code']))
   and json.load(io.open(REG))[r['code']].get('removed_at'))

# ---- poor photos: never uploaded
poor = prospect('The Poor Arms', photos=2)
rp = pub(poor)
ok('2 real photos of 6 (needs_social_photos): the demo', rp['mode'] == 'demo' and rp['slides'] == 0, rp)
ok('...and not one of its slides is copied', files(rp['code']) == ['look.json'], files(rp['code']))
ok('...and look.json lists no slides', manifest(rp['code'])['slides'] == [] and manifest(rp['code'])['mode'] == 'demo')
ok('no real photo at all: the demo', pub(prospect('The Drawn Arms', photos=0))['mode'] == 'demo')
ok('prospect.json saying needs_social_photos is the demo', pub(prospect('The Flagged Arms', photos=6, prospect_extra={'needs_social_photos': True}))['mode'] == 'demo')
ok('2 slides, both photos, no social: too few, the demo', pub(prospect('The Tiny Arms', photos=2, n=2, social=False))['mode'] == 'demo')
ok('a slide that is not 1920 x 1080 makes it the demo', pub(prospect('The Soft Arms', photos=6, sizes={2: (1200, 675)}))['mode'] == 'demo')
ok('a slide carrying camera data (Exif) makes it the demo', pub(prospect('The Exif Arms', photos=6, exif_at=1))['mode'] == 'demo')
ok('a slide file that is missing makes it the demo', pub(prospect('The Gap Arms', photos=6, missing_at=0))['mode'] == 'demo')
nop = os.path.join(TMP, 'prospects', 'NoPlan'); os.makedirs(nop); json.dump({'company': 'No Plan Hotel'}, io.open(os.path.join(nop, 'prospect.json'), 'w'))
ok('no slides/plan.json at all: the demo, with the venue name', pub(nop)['mode'] == 'demo' and pub(nop)['venue'] == 'No Plan Hotel')

# ---- the name
nm = prospect('Lil Miss Collins', photos=3, prospect_extra={'short_name': 'your Crows Nest venue'})
ok('the venue name is the company, never the reply\'s short_name phrase', pub(nm)['venue'] == 'Lil Miss Collins')
ok('jpeg_size reads the slide maker\'s size', lp.jpeg_size(os.path.join(good, 'slides', '01-s0.jpg')) == (1920, 1080))

# ---- the offer
try:
    pub(prospect('The Late Arms', photos=3), offer='oct'); ok('an ended offer (October) is refused', False)
except lp.Refused:
    ok('an ended offer (October) is refused', True)
try:
    pub(prospect('The Odd Arms', photos=3), offer='xyz'); ok('an unknown offer month is refused', False)
except lp.Refused:
    ok('an unknown offer month is refused', True)
ok('default offer: the month the campaigns link (December before the 10th)', lp.default_offer(DEC3) == 'dec', lp.default_offer(DEC3))
ok('...and next month from the rollover\'s switch day (the 10th)', lp.default_offer(DEC15) == 'jan', lp.default_offer(DEC15))
ok('an explicit --offer wins', pub(prospect('The Dec Arms', photos=3), offer='dec')['offer'] == 'dec')

# ---- dry run and remove
dr = prospect('The Dry Arms', photos=3)
rd = lp.publish(dr, out=OUT, register=REG, dry=True, now=DEC15)
ok('a dry run writes nothing', not os.path.isdir(os.path.join(OUT, rd['code'])) and rd['code'] not in json.load(io.open(REG)))
rr = pub(prospect('The Gone Arms', photos=3))
lp.remove(rr['code'], OUT, REG)
ok('--remove takes the folder off the site and marks the register', not os.path.isdir(os.path.join(OUT, rr['code'])) and json.load(io.open(REG))[rr['code']].get('removed_at'))
try:
    lp.remove('../../venueplay', OUT, REG); ok('--remove refuses anything that is not a code', False)
except lp.Refused:
    ok('--remove refuses anything that is not a code', True)

print(('FAILED %d of %d' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
