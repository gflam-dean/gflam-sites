#!/usr/bin/env python3
"""Build the favicon set for VenuePlay, PartyPlay and Gflam Touring from the real marks.

Why this exists (Search Console audit, 23 Oct 2026): Google showed venueplay.com.au
with a dark rounded square inside its circular favicon slot, /favicon.ico answered
404, and the touring, group, vending and Mini Bar sites all carried a data: URI
icon, which Google cannot crawl at all (their results show the generic globe).

Google's favicon rules, which this file follows: a square icon that is a multiple
of 48 px, at a stable URL on the same host, round-safe because Google (and iOS,
Android, Teams) crop it to a circle. So every icon here is the brand mark centred
on a full-bleed square with nothing of value in the corners.

Sources, never redrawn:
  venueplay/logos/venueplay-mark.svg    the neon triangle (the VenuePlay icon)
  partyplay/logos/partyplay-mark.svg    the triangle with confetti
  touring: the pink full stop from the Gflam. wordmark (touring/logo.png), which
           is also what the site's old data: URI favicon was

Outputs, per site folder:
  favicon.svg, favicon.ico (16/32/48), favicon-32.png, favicon-48.png,
  apple-touch-icon.png (180), icon-192.png, icon-512.png

Rendering: the SVG composite is painted by headless Chrome at 512 px, then the
PNG sizes are resampled from that with Pillow. One Chrome at a time, its own
temporary profile, never Dean's.

  python3 tools/build-favicons.py            all three
  python3 tools/build-favicons.py venueplay  one
"""
import os, re, subprocess, sys, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

try:
    from PIL import Image
except ImportError:
    sys.exit('needs Pillow: python3 -m pip install --user pillow')

# One entry per site. box = where the mark's viewBox sits inside the 512 square.
SITES = {
    'venueplay': dict(
        bg='#0A0A0B',
        mark='venueplay/logos/venueplay-mark.svg',
        box=(56, 56, 400, 400),       # 128-unit mark scaled 3.125x: triangle corners stay 173 px from centre, inside the 256 px circle
    ),
    'partyplay': dict(
        bg='#12101A',
        mark='partyplay/logos/partyplay-mark.svg',
        box=(88, 110, 360, 307),      # same placement as partyplay-appicon.svg (translate 88,110 scale 2.4)
    ),
    'touring': dict(
        bg='#000000',
        mark=None,                    # drawn below: the pink full stop
        dot=('#fe65c3', 150),
    ),
}


def composite_svg(site):
    s = SITES[site]
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
             '<rect width="512" height="512" fill="%s"/>' % s['bg']]
    if s['mark']:
        src = open(os.path.join(ROOT, s['mark']), encoding='utf-8').read()
        m = re.search(r'<svg\b[^>]*viewBox="([^"]+)"[^>]*>', src)
        if not m:
            sys.exit('no viewBox in ' + s['mark'])
        inner = src[m.end():src.rindex('</svg>')]
        x, y, w, h = s['box']
        parts.append('<svg x="%d" y="%d" width="%d" height="%d" viewBox="%s">%s</svg>' % (x, y, w, h, m.group(1), inner))
    else:
        colour, r = s['dot']
        parts.append('<circle cx="256" cy="256" r="%d" fill="%s"/>' % (r, colour))
    parts.append('</svg>')
    return '\n'.join(parts)


def render_512(svg_text, out_png):
    tmp = tempfile.mkdtemp(prefix='favicon-')
    try:
        html = os.path.join(tmp, 'icon.html')
        with open(html, 'w', encoding='utf-8') as f:
            f.write('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden;background:#000}svg{display:block}</style></head><body>' + svg_text + '</body></html>')
        cmd = [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
               '--no-default-browser-check', '--window-size=512,512', '--force-device-scale-factor=1',
               '--user-data-dir=' + os.path.join(tmp, 'profile'), '--screenshot=' + out_png, 'file://' + html]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    im = Image.open(out_png)
    if im.size != (512, 512):
        sys.exit('Chrome painted %s, not 512x512' % (im.size,))


def build(site):
    folder = os.path.join(ROOT, site)
    svg = composite_svg(site)
    with open(os.path.join(folder, 'favicon.svg'), 'w', encoding='utf-8') as f:
        f.write(svg + '\n')
    big = os.path.join(folder, 'icon-512.png')
    render_512(svg, big)
    im = Image.open(big).convert('RGB')   # full-bleed square: no alpha, so no grey halo in a circle crop
    im.save(big, optimize=True)
    for name, size in (('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-48.png', 48), ('favicon-32.png', 32)):
        im.resize((size, size), Image.LANCZOS).save(os.path.join(folder, name), optimize=True)
    im.resize((48, 48), Image.LANCZOS).save(os.path.join(folder, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    # Say what was made, with the one fact that matters for Google: square and 48-multiples.
    for name in ('favicon.ico', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'):
        p = os.path.join(folder, name)
        w, h = Image.open(p).size
        print('%-10s %-22s %4dx%-4d %6d bytes' % (site, name, w, h, os.path.getsize(p)))


if __name__ == '__main__':
    if not os.path.exists(CHROME):
        sys.exit('Chrome not found at ' + CHROME)
    wanted = sys.argv[1:] or list(SITES)
    for site in wanted:
        if site not in SITES:
            sys.exit('unknown site %s (one of %s)' % (site, ', '.join(SITES)))
        build(site)
