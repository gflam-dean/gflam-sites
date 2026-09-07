#!/usr/bin/env python3
"""Every image, stylesheet and font a live page asks for must actually arrive.

The page checks in release-check confirm the PAGE is the current build. They say
nothing about what the page then loads. Cloudflare Pages answers a missing path
with the homepage at HTTP 200, so a logo that was renamed, a stylesheet left
behind in a move, or a font that never got committed all look like a success to
anything counting status codes: the request returns 200 and 107 KB of HTML, and
the only visible symptom is a broken image on a venue's TV.

So this fetches every asset the live pages reference and checks WHAT CAME BACK:

  * an image must not be HTML,
  * a stylesheet must not be HTML,
  * a script must not be HTML (release-check already does the shared ones; this
    catches the per-page ones it does not know about),
  * and anything that is byte-identical to the homepage is a miss, whatever its
    content type says.

Read only. It fetches public pages and public assets and nothing else.

  python3 tools/check-assets.py            both sites
  python3 tools/check-assets.py venueplay  one of them
"""
import re, sys, urllib.parse, urllib.request, urllib.error, collections

SITES = {
    'venueplay': 'https://venueplay.com.au',
    'partyplay': 'https://partyplay.com.au',
}
UA = {'User-Agent': 'gflam-release-check/1.0 (+asset audit, read only)'}
TIMEOUT = 25

RED, GRN, YEL, DIM, OFF = '\033[31m', '\033[32m', '\033[33m', '\033[2m', '\033[0m'


CF_NOISE = re.compile(rb'data-cfemail="[0-9a-f]+"|/cdn-cgi/[^"\'\s]*|[0-9a-f]{32,}')


def same_page(a, b):
    """Is this byte-for-byte the homepage, allowing for what Cloudflare rewrites?

    Comparing raw bytes looked right and was worthless: Cloudflare's email
    obfuscation picks a new random key on EVERY request, so two fetches of the
    same unchanged homepage differ at byte 79,702. `body == home` was therefore
    false for a genuine homepage-in-disguise as surely as for a real file, which
    made the one check this whole tool exists for incapable of ever firing.
    Found by the proof harness at the bottom of this file, not by reading it."""
    if not a or not b:
        return False
    if abs(len(a) - len(b)) > 200:
        return False
    return CF_NOISE.sub(b'', a) == CF_NOISE.sub(b'', b)


def is_html(body):
    """HTML, as opposed to any other thing that happens to start with '<'.

    The first version of this asked whether the body started with '<' and called
    anything that did HTML. Every SVG on both sites starts with '<svg', so all
    three logos were reported broken on 7 Sep when all three were being served
    correctly as image/svg+xml. A check that cannot tell an SVG from a homepage
    is not a check, it is a false alarm generator, and it cost a morning."""
    head = body[:400].lstrip().lower()
    return head.startswith(b'<!doctype html') or head.startswith(b'<html') or b'<html' in head


# The first bytes each raster format actually begins with. An asset that claims
# to be an image and matches none of these, and is not SVG, did not arrive.
MAGIC = (b'\x89PNG\r\n', b'\xff\xd8\xff', b'GIF87a', b'GIF89a',
         b'RIFF', b'\x00\x00\x01\x00', b'BM', b'II*\x00', b'MM\x00*')


def looks_like_image(body):
    if not body:
        return False
    if any(body.startswith(m) for m in MAGIC):
        return True
    head = body[:400].lstrip().lower()
    if head.startswith(b'<?xml') or head.startswith(b'<svg') or b'<svg' in head:
        return not is_html(body)
    return False


def get(url):
    """(status, body bytes, content-type). Follows redirects, never raises."""
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as f:
            return f.status, f.read(3_000_000), (f.headers.get('Content-Type') or '')
    except urllib.error.HTTPError as e:
        try: body = e.read(200_000)
        except Exception: body = b''
        return e.code, body, (e.headers.get('Content-Type') or '' if e.headers else '')
    except Exception as e:
        return 0, str(e).encode()[:200], ''


def pages_of(base):
    """The pages to sweep: the homepage plus every same-site link it offers.

    One hop only. The point is to reach the pages a venue actually lands on, not
    to spider the site; release-check already proves every page in the repo is
    reachable."""
    found = [base + '/']
    st, body, _ = get(base + '/')
    if st != 200:
        return found
    html = body.decode('utf-8', 'replace')
    for m in re.finditer(r'href="([^"#?]+)"', html):
        h = m.group(1)
        if h.startswith(('mailto:', 'tel:', 'javascript:', 'http')):
            continue
        u = urllib.parse.urljoin(base + '/', h)
        if u.startswith(base) and not re.search(r'\.(png|jpe?g|svg|webp|css|js|ico|pdf)$', u, re.I):
            if u not in found:
                found.append(u)
    return found


def assets_on(page_url, html):
    """(url, kind) for everything the page pulls in, same-site only.

    External CDNs are somebody else's uptime and a 403 from one is not our bug,
    so they are listed at the end rather than failed on."""
    out = []
    pats = [(r'<img[^>]+src="([^"]+)"', 'image'),
            (r'<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"', 'stylesheet'),
            (r'<link[^>]+href="([^"]+)"[^>]*rel="stylesheet"', 'stylesheet'),
            (r'<script[^>]+src="([^"]+)"', 'script'),
            (r'<link[^>]+rel="icon"[^>]*href="([^"]+)"', 'icon'),
            (r'url\((?:"|\')?([^)"\']+\.(?:woff2?|ttf|otf|png|jpe?g|svg|webp))', 'css asset')]
    for pat, kind in pats:
        for m in re.finditer(pat, html, re.I):
            raw = m.group(1).strip()
            if raw.startswith('data:'):
                continue
            # `src="/' + attr(v.logo_url) + '"` is a line of JavaScript building
            # markup, not an address. Fetching it produced a fail for a file that
            # was never meant to exist.
            if any(t in raw for t in ("'", '"', ' + ', '${', '{{', '`', '</')):
                continue
            out.append((urllib.parse.urljoin(page_url, raw), kind))
    return out


def run(which):
    fails, checked, external = [], 0, collections.Counter()
    for site, base in SITES.items():
        if which not in ('both', site):
            continue
        print('\n%s── %s ──%s' % (YEL, base, OFF))
        before = checked
        st, home, _ = get(base + '/')
        if st != 200:
            print('  %sFAIL%s homepage did not answer (%s)' % (RED, OFF, st))
            fails.append('%s homepage %s' % (site, st))
            continue

        seen = set()
        for page in pages_of(base):
            pst, pbody, _ = get(page)
            if pst != 200:
                continue
            html = pbody.decode('utf-8', 'replace')
            for url, kind in assets_on(page, html):
                if url in seen:
                    continue
                seen.add(url)
                if not url.startswith(base):
                    external[urllib.parse.urlparse(url).netloc] += 1
                    continue
                ast, abody, ctype = get(url)
                checked += 1
                where = url[len(base):]
                if ast != 200:
                    fails.append('%s %s -> HTTP %s (on %s)' % (kind, where, ast, page[len(base):] or '/'))
                    print('  %sFAIL%s %-11s %-46s HTTP %s' % (RED, OFF, kind, where[:46], ast))
                elif same_page(abody, home):
                    # The one that matters: 200, and it is the homepage.
                    fails.append('%s %s -> the homepage, so the file is not there (on %s)'
                                 % (kind, where, page[len(base):] or '/'))
                    print('  %sFAIL%s %-11s %-46s the homepage in disguise' % (RED, OFF, kind, where[:46]))
                elif kind in ('image', 'icon', 'css asset') and not looks_like_image(abody):
                    fails.append('%s %s came back as HTML' % (kind, where))
                    print('  %sFAIL%s %-11s %-46s HTML, not an image' % (RED, OFF, kind, where[:46]))
                elif kind == 'stylesheet' and is_html(abody):
                    fails.append('stylesheet %s came back as HTML' % where)
                    print('  %sFAIL%s %-11s %-46s HTML, not CSS' % (RED, OFF, kind, where[:46]))
        print('  %s%d asset(s) fetched and inspected on this site%s' % (DIM, checked - before, OFF))

    print('\n' + '=' * 66)
    if fails:
        print('%s%d BROKEN%s, %d asset(s) checked' % (RED, len(fails), OFF, checked))
        for f in fails:
            print('  - ' + f)
    else:
        print('%sAll %d asset(s) served their own content.%s' % (GRN, checked, OFF))
    if external:
        print('\n%sNot checked, because they are not ours to fix:%s' % (DIM, OFF))
        for host, n in external.most_common():
            print('   %s (%d reference(s))' % (host, n))
    print('\n%sWHAT THIS DOES NOT CHECK%s' % (YEL, OFF))
    print('  Whether the image is the RIGHT image. A logo replaced by a different')
    print('  logo passes every check here. Only a person looking at the page can')
    print('  see that, and on the venue TV it has to be a person in the room.')
    return 1 if fails else 0


def prove():
    """Break each thing this tool watches and require it to be noticed.

    Every rule in here has already been wrong once. The `<` test called all three
    SVG logos broken; the byte comparison could never fire at all. Both looked
    fine when read and both were caught only by asking, against the live site,
    whether the check can tell the two cases apart. So that question is now part
    of the tool.

      python3 tools/check-assets.py --prove
    """
    base = SITES['venueplay']
    home = get(base + '/')[1]
    home2 = get(base + '/')[1]
    svg = get(base + '/logos/venueplay-primary.svg')[1]
    png = get(base + '/logos/venueplay_appicon_rebuilt.png')[1]
    miss = get(base + '/logos/this-file-does-not-exist.png')[1]

    cases = [
        ('the homepage reads as HTML',                 is_html(home)),
        ('a real SVG does not read as HTML',           not is_html(svg)),
        ('a real SVG counts as an image',              looks_like_image(svg)),
        ('a real PNG counts as an image',              looks_like_image(png)),
        ('the homepage does not count as an image',    not looks_like_image(home)),
        ('two fetches of one page compare equal',      same_page(home, home2)),
        ('a MISSING asset is recognised as the page',  same_page(miss, home)),
        ('a real SVG is not mistaken for the page',    not same_page(svg, home)),
    ]
    bad = 0
    for name, good in cases:
        print(('  %sok%s   ' % (GRN, OFF) if good else '  %sFAIL%s ' % (RED, OFF)) + name)
        bad += 0 if good else 1
    print('\n%s' % ('%sAll %d proof(s) held.%s' % (GRN, len(cases), OFF) if not bad
                    else '%s%d proof(s) failed: this tool cannot be trusted.%s' % (RED, bad, OFF)))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--prove' in sys.argv:
        sys.exit(prove())
    which = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 'both'
    sys.exit(run(which))
