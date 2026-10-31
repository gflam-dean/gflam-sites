#!/usr/bin/env python3
"""NO .dev ADDRESS IN ANYTHING A CUSTOMER'S BROWSER, TV, PHONE OR INBOX CAN SEE (31 Oct 2026).

Dean, 31 Oct 2026, a standing rule: "Don't put any .dev links into anything marketing or website
or email customer facing." The same day he gave every Worker its own name on our domains:

    api.venueplay.com.au      venueplay-api    (was venueplay-api.dean-tindale.workers.dev)
    game.venueplay.com.au     venueplay-game   (was venueplay-game.dean-tindale.workers.dev)
    api.partyplay.com.au      partyplay-api    (was partyplay-api.dean-tindale.workers.dev)
    api.gflamtouring.com.au   touring-api      (was touring-api.dean-tindale.workers.dev)

The old addresses keep answering (the TV app, old emails, cached pages), but nothing we serve or
send names them. What this RUNS:

  1. the detector itself, on lines that must and must not count, so a scanner that has gone
     blind (a regex that never matches) is red, not a green "nothing found"
  2. every file under every site folder Cloudflare Pages serves (venueplay, partyplay, touring,
     vending, theminibar, group, drag-bingo): pages, scripts, email templates, llms.txt,
     sitemaps, _headers, manifests, SVGs. Comments count too: view-source is customer facing
  3. the help desk and FAQ words that migrations put in the database (venueplay-backend/supabase,
     the SQL itself, not its -- comments): the help pages show them
  4. every page that calls a Worker calls it on one of the four names above, and each of the four
     is called from somewhere (so the scan saw the real constants, not an empty tree)
  5. the Gflam Touring / Drag Bingo mail-out's unsubscribe link, footer and List-Unsubscribe
     header, built by touring-backend/lib/gflam_unsub.py itself with a test key

The emails the VenuePlay billing Worker renders are RUN by tools/test-no-workersdev-links.js
(every builder, the headers, the review buttons, the staff text) and PartyPlay's header by
partyplay-backend/lib/pp-worker-15-oct.test.js.

ALLOWED, and only these: nothing under the site folders. Test fixtures and the deploy tooling
live outside them (tools/, *-backend/), which is why they are not scanned.

  python3 tools/no-dev-links.test.py
"""
import io, os, re, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = ['venueplay', 'partyplay', 'touring', 'vending', 'theminibar', 'group', 'drag-bingo']
NEW = {'api.venueplay.com.au': 'venueplay-api', 'game.venueplay.com.au': 'venueplay-game',
       'api.partyplay.com.au': 'partyplay-api', 'api.gflamtouring.com.au': 'touring-api'}
BINARY = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp3', '.mp4', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip')

# Any host whose last label is "dev": workers.dev, pages.dev, web.dev, resend.dev, a staging.dev.
# Not a CSS class (.dev-tv, .dev{), not prose about ".dev links", not a word that merely ends in dev.
DEV_HOST = re.compile(r'(?<![A-Za-z0-9.-])((?:[A-Za-z0-9-]+\.)+dev)(?![A-Za-z0-9-])', re.I)
# A Worker constant in a page: any https address named like our Worker hosts used to be or are now.
WORKER_CALL = re.compile(r'https://((?:[a-z0-9-]+\.)*(?:workers\.dev|venueplay\.com\.au|partyplay\.com\.au|gflamtouring\.com\.au))\b')

fails = 0
ran = 0


def ok(what, cond, saw=''):
    global fails, ran
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + what + (('   saw: ' + str(saw)[:400]) if (saw != '' and not cond) else ''), flush=True)
    if not cond:
        fails += 1


def hits(text):
    return [m.group(1) for m in DEV_HOST.finditer(text)]


def scan_tree(base, folders):
    """[(relative path, line number, host)] for every .dev host in every text file under folders."""
    out, files = [], 0
    for top in folders:
        d0 = os.path.join(base, top)
        for d, dirs, fs in os.walk(d0):
            dirs[:] = [x for x in dirs if not x.startswith('.') and x != 'node_modules']
            for f in sorted(fs):
                if f.startswith('.') and f not in ('.well-known',):
                    continue
                if f.lower().endswith(BINARY):
                    continue
                p = os.path.join(d, f)
                try:
                    if os.path.getsize(p) > 8 * 1024 * 1024:
                        continue
                    text = io.open(p, encoding='utf-8').read()
                except (UnicodeDecodeError, OSError):
                    continue
                files += 1
                for i, line in enumerate(text.splitlines(), 1):
                    for h in hits(line):
                        out.append((os.path.relpath(p, base), i, h))
    return out, files


print('No .dev address in anything a customer can see')

print('\nThe detector, on lines that must and must not count')
MUST = ['var VP_GAME_API=\'https://venueplay-game.dean-tindale.workers.dev\';',
        'fetch("https://abc123.venueplay.pages.dev/app")',
        '<a href="https://web.dev/articles/vitals">',
        'List-Unsubscribe: <https://touring-api.dean-tindale.workers.dev/unsubscribe?e=a>',
        'to: bounced@resend.dev',
        '<!-- it used to be on partyplay-api.dean-tindale.workers.dev -->',
        'var A = "HTTPS://STAGING.EXAMPLE.DEV/x";']
NOT = ['.dev-tv{flex:1.62 1 0;min-width:0}', '.stage.two .dev-phone{display:none}', '.dev.infocus .devlbl{color:red}',
       'Dean: "Don\'t put any .dev links into anything"', 'var API = "https://api.venueplay.com.au";',
       'https://game.venueplay.com.au/room/ws', 'the developer said', 'a .devices list']
ok('it finds a .dev host in each of %d lines that carry one' % len(MUST), all(hits(s) for s in MUST), [s for s in MUST if not hits(s)])
ok('and nothing in %d lines that only look like one (CSS classes, prose, our own names)' % len(NOT), not any(hits(s) for s in NOT), [(s, hits(s)) for s in NOT if hits(s)])
# The tree scan itself, on a made-up site: one planted address in a comment, one in a template,
# one in llms.txt. All three must come back, or a green run below means nothing.
with tempfile.TemporaryDirectory() as tmp:
    os.makedirs(os.path.join(tmp, 'site', 'emails'))
    io.open(os.path.join(tmp, 'site', 'index.html'), 'w', encoding='utf-8').write('<p>hi</p>\n<!-- old: https://x.workers.dev -->\n<div class="dev-tv"></div>\n')
    io.open(os.path.join(tmp, 'site', 'emails', 'w.html'), 'w', encoding='utf-8').write('<a href="{{site}}/a">a</a><a href="https://preview.pages.dev/b">b</a>')
    io.open(os.path.join(tmp, 'site', 'llms.txt'), 'w', encoding='utf-8').write('API: https://api.venueplay.com.au\nStaging: staging.example.dev\n')
    io.open(os.path.join(tmp, 'site', 'logo.png'), 'wb').write(b'\x89PNG x.workers.dev')
    got, n = scan_tree(tmp, ['site'])
ok('the tree scan finds all three planted addresses (a comment, an email template, llms.txt) and skips images',
   sorted(h for _, _, h in got) == ['preview.pages.dev', 'staging.example.dev', 'x.workers.dev'] and n == 3, (got, n))

print('\nEvery file the sites serve')
found, nfiles = scan_tree(ROOT, [s for s in SITES if os.path.isdir(os.path.join(ROOT, s))])
ok('%d files read across %s' % (nfiles, ', '.join(s for s in SITES if os.path.isdir(os.path.join(ROOT, s)))), nfiles > 250, nfiles)
for site in SITES:
    if not os.path.isdir(os.path.join(ROOT, site)):
        continue
    mine = [x for x in found if x[0].split(os.sep)[0] == site]
    ok('%s/: no .dev address in any page, script, template, comment or text file' % site, not mine,
       '; '.join('%s:%d %s' % x for x in mine[:6]))
for t in sorted(os.listdir(os.path.join(ROOT, 'venueplay', 'emails'))):
    if t.endswith('.html'):
        body = io.open(os.path.join(ROOT, 'venueplay', 'emails', t), encoding='utf-8').read()
        ok('venueplay/emails/%s: no .dev address, and no Worker address at all (links in an email are on venueplay.com.au)' % t,
           not hits(body) and not re.search(r'https://(api|game)\.venueplay\.com\.au', body), hits(body))

print('\nWhat migrations put on the help pages')
sql_hits = []
sqldir = os.path.join(ROOT, 'venueplay-backend', 'supabase')
for f in sorted(os.listdir(sqldir)):
    if f.endswith('.sql'):
        for i, line in enumerate(io.open(os.path.join(sqldir, f), encoding='utf-8', errors='replace').read().splitlines(), 1):
            code = line.split('--', 1)[0] if not line.lstrip().startswith('--') else ''
            for h in hits(code):
                sql_hits.append('%s:%d %s' % (f, i, h))
ok('no .dev address in the SQL of any migration (FAQ answers, help topics, templates); comments are not shown', not sql_hits, sql_hits[:6])

print('\nEvery page calls the Workers on their own names')
calls = {}
for site in ('venueplay', 'partyplay', 'touring'):
    for d, dirs, fs in os.walk(os.path.join(ROOT, site)):
        for f in fs:
            if f.endswith(('.html', '.js')):
                p = os.path.join(d, f)
                for m in WORKER_CALL.finditer(io.open(p, encoding='utf-8', errors='replace').read()):
                    calls.setdefault(m.group(1), set()).add(os.path.relpath(p, ROOT))
for host, worker in sorted(NEW.items()):
    ok('%s (%s) is what the pages call: %d file(s)' % (host, worker, len(calls.get(host, ()))), len(calls.get(host, ())) > 0, sorted(calls))
ok('no page calls a Worker on any other API-looking name (an old Cloudflare address, a typo of ours)',
   not [h for h in calls if h.endswith('workers.dev') or (h.split('.')[0] in ('api', 'game') and h not in NEW)],
   sorted(h for h in calls if h.endswith('workers.dev') or (h.split('.')[0] in ('api', 'game') and h not in NEW)))
game_pages = sorted(calls.get('game.venueplay.com.au', ()))
for must in ('venueplay/tv.html', 'venueplay/play.html', 'venueplay/app/vp-session.js', 'venueplay/app/index.html',
             'venueplay/app/trivia/screen.html', 'venueplay/app/musical/screen.html', 'venueplay/app/raffle/screen.html',
             'venueplay/app/members/screen.html'):
    ok('%s talks to the game Worker on game.venueplay.com.au' % must, must in game_pages, game_pages[:8])

print('\nThe Drag Bingo / Gflam Touring mail-out, built by gflam_unsub.py itself')
sys.path.insert(0, os.path.join(ROOT, 'touring-backend', 'lib'))
import gflam_unsub   # noqa: E402
KEY = 'test-key-not-the-real-secret'
link = gflam_unsub.link('Queen@Example.com', 'dragbingo-jan27', key=KEY)
hdr = gflam_unsub.headers('Queen@Example.com', 'dragbingo-jan27', key=KEY)
foot_h = gflam_unsub.footer_html('Queen@Example.com', 'dragbingo-jan27', key=KEY)
foot_t = gflam_unsub.footer_text('Queen@Example.com', 'dragbingo-jan27', key=KEY)
ok('the unsubscribe link is the touring Worker on https://api.gflamtouring.com.au/unsubscribe, with the token',
   re.match(r'^https://api\.gflamtouring\.com\.au/unsubscribe\?e=queen%40example\.com&t=[0-9a-f]{32}&c=dragbingo-jan27$', link) is not None, link)
ok('the List-Unsubscribe header names api.gflamtouring.com.au first, then the mailto, with the one-click Post header',
   hdr.get('List-Unsubscribe') == '<%s>, <mailto:hello@gflamtouring.com.au?subject=unsubscribe>' % link and hdr.get('List-Unsubscribe-Post') == 'List-Unsubscribe=One-Click', hdr)
ok('the footer (html and text) and the headers carry no .dev address',
   not hits(foot_h) and not hits(foot_t) and not hits(' '.join(hdr.values())) and link in foot_t, [hits(foot_h), hits(foot_t)])

print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
