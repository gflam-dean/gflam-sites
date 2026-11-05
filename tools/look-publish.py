#!/usr/bin/env python3
"""PUBLISH ONE VENUE'S TV SLIDES TO venueplay.com.au/look/<code> (build job 7, 5 Nov 2026).

The prospect autopilot (~/venue-enrich/prospect-autopilot.py, a live Mac job: read only) makes a venue's TV
slides from its website into ~/venue-enrich/prospects/<date>-<venue>/slides/ with a plan.json that says, per
slide, whether it carries a real photo of theirs or a drawn panel. This copies the slides that may be shown
into venueplay/look-data/<code>/ with a look.json for venueplay/look.html, and records the code in a private
register OUTSIDE the repo, so the main session can put the link in the email.

    python3 tools/look-publish.py ~/venue-enrich/prospects/2026-11-05-moonchild-bistro [--offer dec] [--dry-run]
    python3 tools/look-publish.py --remove <code>
    python3 tools/look-publish.py --list            the register, printed here (never on the site)

THE CODE. secrets.token_urlsafe(16): 22 URL-safe characters, 128 random bits. Re-publishing the same folder
keeps its code (the link already in an email keeps working); --new-code makes a fresh one and removes the old.

POOR PHOTOS ARE NEVER SHOWN (the brief, and venueplay-slides-quality-bar). "Poor" is what the autopilot
already records: the same rule as its needs_social_photos(), fewer real photos (slides with a photo of
theirs, from their site or picked by eye from their socials) than min(3, the slides that can carry one).
prospect.json saying needs_social_photos is poor too. Fewer than 3 slides, a missing plan.json, or a slide
file that is not a 1920 x 1080 JPEG also means the demo. A poor venue's slides are never copied at all: its
look.json says mode "demo" and the page plays the real screen's demo with the venue's name round it.

NOTHING PERSONAL. look.json holds the venue's name, the slide file names and headlines (their own website's
words), whether each has a photo, and the offer month. Never the email, a first name, a phone or a postcode.

This tool never commits, pushes or deploys. The main session commits venueplay/look-data and releases.
"""
import io, json, os, re, secrets, shutil, struct, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'venueplay', 'look-data')
REGISTER = os.path.expanduser('~/venue-enrich/look-codes.json')
OFFER_JS = os.path.join(ROOT, 'venueplay', 'app', 'vp-offer.js')
MIN_REAL_PHOTOS = 3          # prospect-autopilot.py MIN_REAL_PHOTOS
MIN_SLIDES = 3
MAX_SLIDES = 12
MAX_BYTES = 2 * 1024 * 1024
SWITCH_DAY = 10              # ~/venue-enrich/offer-rollover.py: campaigns move to next month's link on the 10th
CODE_RX = re.compile(r'^[A-Za-z0-9_-]{22,64}$')
MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']


class Refused(Exception):
    pass


def new_code():
    return secrets.token_urlsafe(16)


def jpeg_size(path):
    """(width, height) of a baseline or progressive JPEG, or None when it is not one."""
    with io.open(path, 'rb') as fh:
        data = fh.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or data[:2] != b'\xff\xd8':
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        seg = struct.unpack('>H', data[i + 2:i + 4])[0]
        if marker == 0xE1 and data[i + 4:i + 8] == b'Exif':
            return None      # camera data (place, time) never goes up; the slide maker writes none
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return (w, h)
        i += 2 + seg
    return None


def poor_photos(slides):
    """prospect-autopilot needs_social_photos(), plus: no slide that can carry a photo at all is poor."""
    can = sum(1 for s in slides if s.get('key') != 'social')
    real = sum(1 for s in slides if s.get('photo'))
    return can == 0 or real < min(MIN_REAL_PHOTOS, can)


def offer_rows():
    src = io.open(OFFER_JS, encoding='utf-8').read()
    rows = {}
    for m in re.finditer(r"(\w{3}):\s*\{\s*code:\s*'([A-Z0-9-]+)'[^}]*?\}", src):
        rows[m.group(1)] = {'code': m.group(2), 'ended': 'ended: true' in m.group(0)}
    return rows


def default_offer(now=None):
    """The month the live campaigns link today: this month, or next month from the rollover's switch day."""
    t = time.gmtime((now if now is not None else time.time()) + 10 * 3600)
    k = t.tm_mon - 1 + (1 if t.tm_mday >= SWITCH_DAY else 0)
    return MON3[k % 12]


def decide(folder):
    """(venue name, mode, [(source path, slide)]) for one prospect folder. Raises Refused for no venue name."""
    pj = os.path.join(folder, 'prospect.json')
    prospect = json.load(io.open(pj, encoding='utf-8')) if os.path.isfile(pj) else {}
    sdir = os.path.join(folder, 'slides')
    plan = {}
    try:
        plan = json.load(io.open(os.path.join(sdir, 'plan.json'), encoding='utf-8'))
    except Exception:
        plan = {}
    # company first: short_name can be a phrase for the reply ("your Crows Nest venue" for Lil Miss Collins)
    venue = (prospect.get('company') or plan.get('venue') or '').strip()
    if venue.lower().startswith('your '):
        venue = ''
    if not venue:
        raise Refused('no venue name in prospect.json (company) or slides/plan.json (venue)')
    slides = [s for s in (plan.get('slides') or []) if isinstance(s, dict)][:MAX_SLIDES]
    ok = []
    for s in slides:
        f = s.get('file') or ''
        p = os.path.join(sdir, os.path.basename(f))
        if f and os.path.isfile(p) and jpeg_size(p) == (1920, 1080):
            ok.append((p, s))
    if (len(ok) != len(slides) or len(ok) < MIN_SLIDES or poor_photos([s for _, s in ok])
            or prospect.get('needs_social_photos') is True):
        return venue, 'demo', []
    return venue, 'slides', ok


def load_register(path):
    try:
        return json.load(io.open(path, encoding='utf-8'))
    except FileNotFoundError:
        return {}


def save_register(path, reg):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    json.dump(reg, io.open(tmp, 'w', encoding='utf-8'), indent=1, sort_keys=True)
    os.replace(tmp, path)


def remove(code, out, register):
    if not CODE_RX.match(code or ''):
        raise Refused('not a look code: %r' % code)
    d = os.path.join(out, code)
    if os.path.isdir(d):
        shutil.rmtree(d)
    reg = load_register(register)
    if code in reg:
        reg[code]['removed_at'] = time.strftime('%Y-%m-%dT%H:%M')
        save_register(register, reg)
    return d


def publish(folder, offer=None, out=OUT, register=REGISTER, dry=False, fresh=False, now=None):
    folder = os.path.abspath(os.path.expanduser(folder))
    if not os.path.isdir(folder):
        raise Refused('no such prospect folder: %s' % folder)
    rows = offer_rows()
    offer = offer or default_offer(now)
    if offer not in rows or rows[offer]['ended']:
        raise Refused('no open offer row %r in venueplay/app/vp-offer.js' % offer)
    venue, mode, slides = decide(folder)
    reg = load_register(register)
    old = [c for c, r in reg.items() if r.get('folder') == folder and not r.get('removed_at')]
    code = old[0] if old and not fresh else new_code()
    while code in reg and not old:
        code = new_code()
    manifest = {'v': 1, 'venue': venue, 'mode': mode, 'offer': offer, 'slides': []}
    copies = []
    for i, (src, s) in enumerate(slides, 1):
        name = '%02d.jpg' % i
        manifest['slides'].append({'file': name, 'head': (s.get('head') or '')[:120],
                                   'photo': bool(s.get('photo')), 'social': s.get('key') == 'social'})
        copies.append((src, name))
    result = {'code': code, 'url': 'https://venueplay.com.au/look/' + code, 'venue': venue, 'mode': mode,
              'offer': offer, 'slides': len(copies)}
    if dry:
        return result
    d = os.path.join(out, code)
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    for src, name in copies:
        shutil.copyfile(src, os.path.join(d, name))
    json.dump(manifest, io.open(os.path.join(d, 'look.json'), 'w', encoding='utf-8'), indent=1)
    for c in old:
        if c != code:
            remove(c, out, register)
            reg = load_register(register)
    reg[code] = {'folder': folder, 'venue': venue, 'mode': mode, 'offer': offer, 'slides': len(copies),
                 'published_at': time.strftime('%Y-%m-%dT%H:%M')}
    save_register(register, reg)
    return result


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    flag = lambda n: ('--' + n) in argv
    val = lambda n: argv[argv.index('--' + n) + 1] if ('--' + n) in argv and argv.index('--' + n) + 1 < len(argv) else None
    out = val('out') or OUT
    register = val('register') or REGISTER
    for n in ('out', 'register', 'offer', 'remove'):
        v = val(n)
        if v in args:
            args.remove(v)
    try:
        if flag('list'):
            for c, r in sorted(load_register(register).items(), key=lambda x: x[1].get('published_at', '')):
                print('%s  %-6s %-5s %s%s' % (c, r.get('mode'), r.get('offer'), r.get('venue'), '  (removed)' if r.get('removed_at') else ''))
            return 0
        if flag('remove'):
            print('removed %s' % remove(val('remove'), out, register))
            return 0
        if len(args) != 1:
            print(__doc__)
            return 2
        r = publish(args[0], offer=val('offer'), out=out, register=register, dry=flag('dry-run'), fresh=flag('new-code'))
        print('%s %s: %s, %d slide(s), offer %s\n  %s' % ('WOULD PUBLISH' if flag('dry-run') else 'PUBLISHED',
              r['venue'], 'their slides' if r['mode'] == 'slides' else 'the demo (photos too poor or too few slides)',
              r['slides'], r['offer'], r['url']))
        return 0
    except Refused as e:
        print('REFUSED: %s' % e)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
