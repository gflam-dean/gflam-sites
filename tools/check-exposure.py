#!/usr/bin/env python3
"""What is on the public site that was never meant to be.

On 18 Aug the entire 41,000-question bank, the database schema, both Workers and
the seed scripts were all downloadable from venueplay.com.au. The rule meant to
stop it could not work, and nobody knew because nothing ever asked the live site
what it would hand over. The fix was to move those files out of the deployed
directory, and the lesson written down at the top of venueplay/_redirects was:
a file in the deployed directory GETS SERVED, so the only protection is not
putting it there.

Nothing has been checking that since. On 7 Sep all four .test.js files under the
two site directories were still public, and partyplay/lib/pp-trivia-pack.test.js
published /Users/dean.tindale/gflam-sites-current six times over, which tells a
stranger the maintainer's account name and how the machine is laid out.

So this asks production directly, for every file the repo would deploy:

  1. Is anything served that is not part of the site: a test, a migration, a
     backup, a script, a source map, a lock file?
  2. Does anything served name a path on somebody's laptop?
  3. Does anything served carry a key that is not the public one?

It fetches only public URLs and writes nothing.

  python3 tools/check-exposure.py            both sites
  python3 tools/check-exposure.py venueplay  one of them
  python3 tools/check-exposure.py --prove    check that the checks can fail
"""
import os, re, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = {'venueplay': 'https://venueplay.com.au', 'partyplay': 'https://partyplay.com.au'}
UA = {'User-Agent': 'gflam-release-check/1.0 (+exposure audit, read only)'}
RED, GRN, YEL, DIM, OFF = '\033[31m', '\033[32m', '\033[33m', '\033[2m', '\033[0m'

# Things that are not part of a website. A venue never needs any of these, and
# each one tells somebody how the system is built.
NEVER = re.compile(r'\.(test\.js|spec\.js|sql|py|sh|bak|backup|orig|rej|map|lock|env|ini|log)$'
                   r'|(^|/)(\.env|\.git|package(-lock)?\.json|requirements\.txt|Makefile)$', re.I)

# A path on somebody's machine, in a file the world can read.
LOCALPATH = re.compile(rb'/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|[A-Z]:\\\\Users\\\\')

# A Supabase service key is a JWT whose role is service_role. The anon key is
# published on purpose and is fine; this one is not.
SERVICE = re.compile(rb'service_role')


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            return r.status, r.read(2_000_000)
    except urllib.error.HTTPError as e:
        try: return e.code, e.read(200_000)
        except Exception: return e.code, b''
    except Exception:
        return 0, b''


def served(body):
    """True when the response is the file itself, not the homepage stand-in."""
    head = body[:400].lstrip().lower()
    return bool(body) and not (head.startswith(b'<!doctype html') or head.startswith(b'<html'))


def candidates(site):
    """Every path the repo would publish for this site, deepest first."""
    out = []
    base = os.path.join(ROOT, site)
    for dirpath, dirs, names in os.walk(base):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
        for n in names:
            rel = os.path.relpath(os.path.join(dirpath, n), base).replace(os.sep, '/')
            out.append(rel)
    return sorted(out)


def run(which):
    findings = []
    checked = 0
    for site, base in SITES.items():
        if which not in ('both', site):
            continue
        print('\n%s── %s ──%s' % (YEL, base, OFF))
        rels = candidates(site)
        risky = [r for r in rels if NEVER.search(r)]
        print('  %s%d file(s) in the deploy directory, %d of them should not be on a website%s'
              % (DIM, len(rels), len(risky), OFF))

        for rel in risky:
            url = '%s/%s' % (base, rel)
            st, body = get(url)
            checked += 1
            if st == 200 and served(body):
                findings.append('%s is public (%d bytes)' % (url, len(body)))
                print('  %sFAIL%s public  %s  %d bytes' % (RED, OFF, rel[:52], len(body)))

        # And whatever IS meant to be public must not carry a laptop path or a
        # key that is not the public one.
        for rel in [r for r in rels if r.endswith(('.html', '.js', '.json', '.css'))][:400]:
            url = '%s/%s' % (base, rel)
            st, body = get(url)
            checked += 1
            if st != 200 or not served(body):
                continue
            hits = set(LOCALPATH.findall(body))
            if hits:
                findings.append('%s names a local path: %s'
                                % (url, b', '.join(sorted(hits)[:3]).decode('utf-8', 'replace')))
                print('  %sFAIL%s path    %s  %s' % (RED, OFF, rel[:52],
                      b', '.join(sorted(hits)[:2]).decode('utf-8', 'replace')))
            if SERVICE.search(body):
                findings.append('%s mentions service_role' % url)
                print('  %sFAIL%s key     %s  service_role' % (RED, OFF, rel[:52]))

    print('\n' + '=' * 66)
    if findings:
        print('%s%d EXPOSED%s, %d URL(s) asked' % (RED, len(findings), OFF, checked))
        for f in findings:
            print('  - ' + f)
        print('\n%sThe fix is never a rule in _redirects. Pages ignores a bare 404 there.%s' % (DIM, OFF))
        print('%sMove the file out of the deployed directory, into the -backend sibling.%s' % (DIM, OFF))
    else:
        print('%sNothing exposed. %d URL(s) asked.%s' % (GRN, checked, OFF))
    print('\n%sWHAT THIS DOES NOT CHECK%s' % (YEL, OFF))
    print('  A file that is public and SHOULD be, but says too much. Nothing here')
    print('  reads meaning: a comment naming a customer, or an internal price in')
    print('  a page nobody links to, passes every check above.')
    return 1 if findings else 0


def prove():
    """Each rule, given something it must catch and something it must not."""
    cases = [
        ('a .test.js path is flagged',        bool(NEVER.search('lib/pp-trivia-pack.test.js'))),
        ('a .sql path is flagged',            bool(NEVER.search('supabase/venueplay-67.sql'))),
        ('a .py path is flagged',             bool(NEVER.search('tools/add-songs.py'))),
        ('a real page is NOT flagged',        not NEVER.search('app/trivia/host.html')),
        ('a real script is NOT flagged',      not NEVER.search('app/vp-session.js')),
        ('a logo is NOT flagged',             not NEVER.search('logos/venueplay-mark.svg')),
        ('a mac path is found',               bool(LOCALPATH.search(b'readFile("/Users/dean.tindale/x")'))),
        ('a linux path is found',             bool(LOCALPATH.search(b'/home/runner/work'))),
        ('ordinary text is not a path',       not LOCALPATH.search(b'the user of this venue')),
        ('service_role is found',             bool(SERVICE.search(b'"role":"service_role"'))),
        ('the anon role is not flagged',      not SERVICE.search(b'"role":"anon"')),
        ('the homepage reads as unserved',    not served(b'<!doctype html><html>')),
        ('a real script reads as served',     served(b'/* vp-session */\nvar x=1;')),
    ]
    bad = 0
    for name, good in cases:
        print(('  %sok%s   ' % (GRN, OFF) if good else '  %sFAIL%s ' % (RED, OFF)) + name)
        bad += 0 if good else 1
    print('\n%s' % ('%sAll %d proof(s) held.%s' % (GRN, len(cases), OFF) if not bad
                    else '%s%d proof(s) failed.%s' % (RED, bad, OFF)))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--prove' in sys.argv:
        sys.exit(prove())
    w = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 'both'
    sys.exit(run(w))
