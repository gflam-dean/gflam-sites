#!/usr/bin/env python3
"""Every link on the sites, followed.

The pages themselves are already checked: the release check asks whether each
one serves. Nothing has ever asked whether the links ON them go anywhere. That
gap is about to matter, because the cold outreach sends venue owners to these
pages, and a 404 in front of a stranger is the whole first impression.

OUR OWN LINKS ARE CHECKED AGAINST THE REPO, NOT OVER HTTP, and that is not a
shortcut. Cloudflare Pages answers any path it does not have with the homepage
and a 200, so /logos/typo.png and /a-page-that-never-existed both come back
looking perfectly healthy. Following our own links over HTTP would report every
one of them as fine. The repo knows the truth: either the file is there or it
is not.

What it follows, per page:
  - internal href and src, resolved to a file in the repo (pages, scripts,
    styles, images, logos, downloads)
  - external href, HEAD only, and a failure there is reported as a WARNING:
    somebody else's site being down is not our release being broken
  - mailto: and tel: are checked for shape, not dialled

What it does NOT do: run JavaScript. A link a script writes into the page is
invisible here, and so is anything behind a login. It says so at the end rather
than letting a green tick imply more than it checked.

  check-links.py [venueplay|partyplay|both] [--external]
"""
import io, os, re, sys, ssl, urllib.request, urllib.error, urllib.parse
import threading, queue, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = {'venueplay': ('https://venueplay.com.au', os.path.join(ROOT, 'venueplay')),
         'partyplay': ('https://partyplay.com.au', os.path.join(ROOT, 'partyplay'))}
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/126 Safari/537.36'}
CTX = ssl.create_default_context()
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

ATTR = re.compile(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', re.I)
SKIP = re.compile(r'^(#|javascript:|data:|blob:|about:)', re.I)
# The email templates are not pages, they are documents with holes in them, and
# {{support_email}} is a hole, not a broken address. Same for a src the Worker
# fills in. Anything with a placeholder in it is skipped wherever it appears.
PLACEHOLDER = re.compile(r'\{\{|\}\}|\$\{')
MAIL = re.compile(r'^mailto:([^?]+)', re.I)
TEL  = re.compile(r'^tel:(.+)', re.I)
ADDR = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')


def head(url, method='HEAD', t=15):
    req = urllib.request.Request(url, headers=UA, method=method)
    try:
        with urllib.request.urlopen(req, timeout=t, context=CTX) as f:
            return f.getcode(), None
    except urllib.error.HTTPError as e:
        # Plenty of servers refuse HEAD but serve the page perfectly well.
        if method == 'HEAD' and e.code in (403, 405, 501):
            return head(url, 'GET', t)
        return e.code, None
    except Exception as e:
        return None, str(e)[:60]


def links_in(path):
    src = io.open(path, encoding='utf-8', errors='replace').read()
    src = re.sub(r'<!--.*?-->', '', src, flags=re.S)
    # A comment inside a script is not markup, so the HTML comment strip above
    # leaves it, and index.html explains an old bug with the words src="..." in
    # it. That is prose about an attribute, not an attribute. Block comments go;
    # line comments are left alone because every URL has // in it.
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    out = []
    for u in ATTR.findall(src):
        u = u.strip()
        if '...' in u:          # what somebody writes when they mean "and so on"
            continue
        out.append(u)
    return out


def check(which='both', external=False):
    bad, warn, seen = [], [], collections.Counter()
    for site in (['venueplay', 'partyplay'] if which == 'both' else [which]):
        base, folder = SITES[site]
        if not os.path.isdir(folder):
            continue
        # One walk, relative paths, no second list to get out of step with the
        # first. The earlier version kept the top level as bare filenames and the
        # rest as relative paths, compared the two, and silently scanned only the
        # top level: a deliberately broken link in app/ was not reported.
        pages = []
        for d, _, fs in os.walk(folder):
            for f in sorted(fs):
                if f.endswith('.html'):
                    pages.append(os.path.relpath(os.path.join(d, f), folder))
        pages.sort()
        todo = queue.Queue()
        for page in pages:
            p = os.path.join(folder, page)
            for u in links_in(p):
                if SKIP.match(u) or PLACEHOLDER.search(u):
                    continue
                m = MAIL.match(u)
                if m:
                    if not ADDR.match(m.group(1).strip()):
                        bad.append((site, page, u, 'not an address'))
                    continue
                m = TEL.match(u)
                if m:
                    if not re.fullmatch(r'[0-9+ ()\-]{6,}', m.group(1).strip()):
                        bad.append((site, page, u, 'not a phone number'))
                    continue
                if u.startswith('http') and not u.startswith(base):
                    if external:
                        todo.put((site, page, u, False))
                    continue
                # Ours, however it was written. Resolve it to a path, then to a
                # file. A directory-style path is index.html; an extensionless
                # one is the .html Pages serves for it.
                rel = u[len(base):] if u.startswith(base) else u
                rel = rel.split('#')[0].split('?')[0]
                if not rel:
                    continue
                if not rel.startswith('/'):
                    d = os.path.dirname(page)
                    rel = '/' + os.path.normpath(os.path.join(d, rel)) if d else '/' + rel
                target = rel.lstrip('/')
                cands = [target, target + '.html', os.path.join(target, 'index.html')]
                if target in ('', '/'):
                    cands = ['index.html']
                found = any(os.path.isfile(os.path.join(folder, c)) for c in cands if c)
                seen[base + rel] += 1
                if not found:
                    bad.append((site, page, rel, 'no such file in the repo'))

        lock = threading.Lock()
        def work():
            while True:
                try: site_, page_, url_, inside_ = todo.get_nowait()
                except queue.Empty: return
                with lock:
                    if seen[url_]:
                        seen[url_] += 1; continue
                    seen[url_] = 1
                code, err = head(url_)
                with lock:
                    if code and 200 <= code < 400:
                        continue
                    row = (site_, page_, url_, 'HTTP %s' % code if code else err)
                    (bad if inside_ else warn).append(row)
        ts = [threading.Thread(target=work, daemon=True) for _ in range(10)]
        [t.start() for t in ts]; [t.join() for t in ts]

    for site, page, url, why in bad:
        print('%sBROKEN%s %s/%s  ->  %s  %s(%s)%s' % (RED, OFF, site, page, url, DIM, why, OFF))
    for site, page, url, why in warn:
        print('%swarn  %s %s/%s  ->  %s  (%s)' % (YEL, OFF, site, page, url, why))
    print('\n  %d link(s) followed, %d unique' % (sum(seen.values()), len(seen)))
    if bad:
        print('  %s%d broken link(s) on our own site%s' % (RED, len(bad), OFF))
    else:
        print('  %sAll good. Every link on our own pages goes somewhere.%s' % (GRN, OFF))
    print('  %sNot checked: links a script writes at runtime, anything behind a '
          'login, whether a file in the repo actually reached production (the '
          'release check answers that), and %s.%s'
          % (DIM, 'external sites' if not external else
             'whether an external page still says what it used to', OFF))
    return 1 if bad else 0


if __name__ == '__main__':
    which = 'both'
    for a in sys.argv[1:]:
        if a in SITES: which = a
    sys.exit(check(which, '--external' in sys.argv))
