#!/usr/bin/env python3
"""THE VENUEPLAY MARK, DRAWN ONCE, COPIED INTO EVERY PAGE BY THIS TOOL (31 Oct 2026).

The pink play triangle beside the word "VenuePlay" was pasted into 38 places across 29 pages (site
headers and footers, phone pages, host consoles, HQ, leave-behinds, the printed signs). Changing the logo
meant finding all of them by hand.

THE F4 LOGO (1 Nov 2026): the headers now carry the whole lowercase wordmark (letters in currentColor, the
pink triangle in the a), not a triangle beside the word. The drawing lives in ONE file,
venueplay/brand/vp-mark.svg, as groups (wordmark, wordmark-print, and the triangle on its own):

    <g id="mark">        the mark on screens
    <g id="mark-print">  the printed signs (signage.html), a heavier stroke for paper

Every copy in a page is marked with the group it comes from:

    <svg width="20" height="23" viewBox="0 0 26 30" fill="none" data-vp-mark="mark">...</svg>

and this tool writes the group's drawing into each marked copy. The pages keep the drawing INLINE on
purpose. An <svg><use href="/brand/vp-mark.svg#mark"> was tried first and measured in headless Chrome on
a slow connection: the triangle painted 0.1 to 0.5 s after the rest of the header on the public pages
(one more request, revalidated on every visit by _headers' no-cache), and if that one request failed the
triangle stayed missing until a reload. Inline cannot do either, and is pixel-identical to what shipped.

    python3 tools/sync-brand-mark.py            check: every marked copy matches the file (exit 1 if not)
    python3 tools/sync-brand-mark.py --write    write the file's drawing into every marked copy
    python3 tools/sync-brand-mark.py --list     where every copy is

A NEW LOGO: edit the two groups in venueplay/brand/vp-mark.svg (keep the ids, fit the drawing to the
0 0 26 30 box or change the pages' viewBox too), run --write, look at the pages, commit.

Rules the tool enforces on the drawing, because it lands inside HTML and inside JavaScript strings
(training.html builds its screens from one): no single quote, no backslash, no <script, no </svg, and no
id= attributes (a page shows the mark more than once, so an id would be duplicated; inline a filter as a
CSS filter on the page instead, which is how the glow is done today).

Read-only unless --write. Touches only files under venueplay/ that carry data-vp-mark.
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'venueplay')
SOURCE = os.path.join(SITE, 'brand', 'vp-mark.svg')
NAMES = ('wordmark', 'wordmark-print', 'mark', 'mark-print',   # the F4 logo (1 Nov 2026), and the triangle on its own
         'tv-tri', 'tv-word')                                   # "venueplay tv" (3 Nov 2026): TV set-up screens only

COPY = re.compile(r'(<svg\b[^>]*?\bdata-vp-mark="([a-z-]+)"[^>]*>)(.*?)(</svg>)', re.S)


def group(src, gid):
    """The raw markup inside <g id="gid">...</g>, nested groups allowed."""
    m = re.search(r'<g\b[^>]*\bid="%s"[^>]*>' % re.escape(gid), src)
    if not m:
        raise SystemExit('%s has no <g id="%s">' % (os.path.relpath(SOURCE, ROOT), gid))
    depth, i = 1, m.end()
    for t in re.finditer(r'<(/?)g\b[^>]*?(/?)>', src[i:]):
        if t.group(2):          # <g/> opens and closes
            continue
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return src[i:i + t.start()]
    raise SystemExit('<g id="%s"> is never closed' % gid)


def norm(x):
    """One form for comparing two drawings: no whitespace between tags, <a ...></a> written <a .../>."""
    x = re.sub(r'\s+', ' ', x.strip())
    x = re.sub(r'>\s+<', '><', x)
    x = re.sub(r'<([a-zA-Z][\w:-]*)([^<>]*?)\s*></\1>', r'<\1\2/>', x)
    return x


def drawings():
    src = io.open(SOURCE, encoding='utf-8').read()
    src = re.sub(r'<!--.*?-->', '', src, flags=re.S)
    out = {}
    for n in NAMES:
        d = norm(group(src, n))
        bad = [w for w, hit in (("a single quote", "'" in d), ('a backslash', '\\' in d),
                                ('<script', '<script' in d.lower()), ('</svg', '</svg' in d.lower()),
                                ('an id= attribute', re.search(r'\sid\s*=', d) is not None),
                                ('nothing at all', not d)) if hit]
        if bad:
            raise SystemExit('the "%s" drawing in %s has %s; see the rules at the top of this tool'
                             % (n, os.path.relpath(SOURCE, ROOT), ', '.join(bad)))
        out[n] = d
    return out


def files():
    for d, dirs, fs in os.walk(SITE):
        dirs[:] = sorted(x for x in dirs if x != 'brand')
        for f in sorted(fs):
            if f.endswith(('.html', '.js')):
                p = os.path.join(d, f)
                s = io.open(p, encoding='utf-8').read()
                if 'data-vp-mark=' in s:
                    yield p, s


def main(argv):
    write, listing = '--write' in argv, '--list' in argv
    want = drawings()
    copies = stale = 0
    unknown = []
    for p, s in files():
        rel = os.path.relpath(p, ROOT)
        changed = [False]
        def fix(m):
            nonlocal copies, stale
            name = m.group(2)
            line = s.count('\n', 0, m.start()) + 1
            if name not in want:
                unknown.append('%s:%d data-vp-mark="%s"' % (rel, line, name))
                return m.group(0)
            copies += 1
            if listing:
                print('  %s:%d  %s' % (rel, line, name))
            if norm(m.group(3)) == want[name]:
                return m.group(0)
            stale += 1
            if not write:
                print('  DIFFERS  %s:%d  (%s)' % (rel, line, name))
                return m.group(0)
            changed[0] = True
            return m.group(1) + want[name] + m.group(4)
        out = COPY.sub(fix, s)
        if write and changed[0]:
            io.open(p, 'w', encoding='utf-8').write(out)
            print('  wrote    %s' % rel)
    if unknown:
        print('UNKNOWN MARK NAME (the file has: %s):' % ', '.join(NAMES))
        for u in unknown:
            print('  ' + u)
    if copies == 0:
        print('NO marked copies found under venueplay/. A tool that finds nothing checks nothing.')
        return 1
    if write:
        print('%d cop%s of the VenuePlay mark, %d rewritten from %s.' % (copies, 'y' if copies == 1 else 'ies', stale,
                                                                       os.path.relpath(SOURCE, ROOT)))
        return 1 if unknown else 0
    if stale or unknown:
        print('%d of %d copies of the VenuePlay mark differ from %s. Run: python3 tools/sync-brand-mark.py --write'
              % (stale, copies, os.path.relpath(SOURCE, ROOT)))
        return 1
    print('All %d copies of the VenuePlay mark match %s.' % (copies, os.path.relpath(SOURCE, ROOT)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
