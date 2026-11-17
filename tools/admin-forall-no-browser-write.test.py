#!/usr/bin/env python3
"""NO BROWSER PAGE WRITES ANY TABLE MIGRATION 218 MADE SELECT-ONLY (18 Nov 2026, review R2/R3).

Migration 218 revokes every write right on 17 tables from anon and authenticated, so a page that wrote one of them
from the browser would fail with "permission denied" on the live database. This walks EVERY .html and .js under
venueplay/ on disk (jsc cannot list a folder; vendor/ is skipped: it is supabase-js itself) and fails on:
  1. a .from("<table>") of any of the 17 that is not followed straight away by .select( (a write, or a query builder
     kept in a variable that could be written through later)
  2. a write (.insert/.update/.upsert/.delete) within 600 characters after a .from("<table>") of the 17, before the
     next .from(  (belt and braces for 1)
  3. a .from(<not a string>) whose chain writes (a table name built at run time could be one of the 17)
  4. a write call with no .from( in the 600 characters before it, unless it is on the allowlist below (false positives:
     the Cache API's caches.delete, a Map/Set delete)
  5. a raw fetch to /rest/v1/<table> for any of the 17
  6. a .rpc("<name>") to anything that is NOT a SECURITY DEFINER function in RLS-BASELINE.json (an invoker function runs
     with the browser's own grants, so it could write a table under the caller's rights)
It also proves the scanner can see a write (positive controls: the four tables a browser DOES write today, left out of
218, are found), and that its 17 are exactly the 17 the migration locks.

    python3 tools/admin-forall-no-browser-write.test.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQL = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'venueplay-218-admin-forall-lockdown.sql')
BASE = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'RLS-BASELINE.json')
PASS, FAIL = [0], [0]


def ok(name, cond, saw=None):
    if cond:
        PASS[0] += 1
        print('  ok   ' + name)
    else:
        FAIL[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: ' + repr(saw)[:400]))


TABLES = sorted('vp_admin_audit vp_billing_usage vp_discounts vp_group_invoice_lines vp_group_invoices vp_member_draw_results '
                'vp_member_draws vp_member_rosters vp_optin_exports vp_playlist_songs vp_playlists vp_question_sets vp_questions '
                'vp_raffle_prizes vp_raffle_schedules vp_screen_slides vp_screens'.split())
LEFT_OUT = ['vp_venue_staff', 'vp_venue_groups', 'vp_venues', 'vp_venue_settings']
# Write calls that are not the database (checked by hand 18 Nov 2026): the help desk's push cache.
NOT_DB = [re.compile(r'caches\.delete\($'), re.compile(r'\b(map|set|seen|cache|M|S)\.delete\($', re.I)]
WINDOW = 600
FROM_LIT = re.compile(r'\.from\(\s*["\'`]([a-z_0-9]+)["\'`]\s*\)')
FROM_ANY = re.compile(r'\.from\(')
WRITE = re.compile(r'\.\s*(insert|update|upsert|delete)\s*\(')


def pages():
    out = []
    for root, dirs, files in os.walk(os.path.join(ROOT, 'venueplay')):
        dirs[:] = [d for d in dirs if d != 'vendor']
        for f in files:
            if f.endswith(('.html', '.js')):
                out.append(os.path.join(root, f))
    return sorted(out)


def line_of(s, i):
    return s.count('\n', 0, i) + 1


def scan(files):
    """{'writes': [(table, file:line, verb)], 'not_select': [...], 'nonlit_writes': [...], 'loose': [...], 'rest': [...],
    'rpc': [(name, file:line)], 'refs': n}"""
    r = {'writes': [], 'not_select': [], 'nonlit_writes': [], 'loose': [], 'rest': [], 'rpc': [], 'refs': 0}
    for p in files:
        s = open(p, encoding='utf-8', errors='replace').read()
        rel = os.path.relpath(p, ROOT)
        for m in re.finditer(r'\.from\(', s):
            lit = FROM_LIT.match(s, m.start())
            seg = s[m.end():m.end() + WINDOW]
            nxt = FROM_ANY.search(seg)
            if nxt:
                seg = seg[:nxt.start()]
            w = WRITE.search(seg)
            where = '%s:%d' % (rel, line_of(s, m.start()))
            if lit:
                t = lit.group(1)
                if t in TABLES:
                    r['refs'] += 1
                    if not re.match(r'\s*\.\s*select\s*\(', s[lit.end():]):
                        r['not_select'].append((t, where))
                if w:
                    r['writes'].append((t, where, w.group(1)))
            else:
                # Array.from( / Buffer.from( and friends are not the database.
                if re.search(r'(Array|Buffer|Uint8Array|Int32Array|Object|String)$', s[max(0, m.start() - 12):m.start()]):
                    continue
                if w:
                    r['nonlit_writes'].append((where, w.group(1)))
        for m in WRITE.finditer(s):
            if '.from(' in s[max(0, m.start() - WINDOW):m.start()]:
                continue
            head = s[max(0, m.start() - 40):m.end()].replace('\n', ' ')
            if any(rx.search(head.replace(' ', '')) or rx.search(head) for rx in NOT_DB):
                continue
            r['loose'].append(('%s:%d' % (rel, line_of(s, m.start())), head))
        for m in re.finditer(r'rest/v1/([a-z_0-9]+)', s):
            if m.group(1) in TABLES:
                r['rest'].append((m.group(1), '%s:%d' % (rel, line_of(s, m.start()))))
        for m in re.finditer(r'\.rpc\(\s*["\'`]([a-z_0-9]+)["\'`]', s):
            r['rpc'].append((m.group(1), '%s:%d' % (rel, line_of(s, m.start()))))
    return r


print('1. the scanner and the migration agree')
sql = open(SQL, encoding='utf-8').read()
locked = sorted(set(re.findall(r'^revoke insert, update, delete, truncate, references, trigger on public\.([a-z_0-9]+) from public, anon, authenticated;$',
                               sql, re.M)))
ok('the 17 tables scanned are exactly the 17 migration 218 makes SELECT-only', locked == TABLES, locked)
files = pages()
ok('walked every page and script under venueplay/ (vendor skipped): more than 100 files, hq.html, onboard.html and vp-session.js among them',
   len(files) > 100 and all(any(f.endswith(x) for f in files) for x in ('app/hq.html', 'app/onboard.html', 'app/vp-session.js', 'tv.html')),
   len(files))
R = scan(files)
# Positive controls: the same scanner, asked about the four left-out tables, must find their browser writes.
TABLES_SAVED = TABLES
TABLES = LEFT_OUT
ctrl = scan(files)
TABLES = TABLES_SAVED
found = sorted(set(t for t, _, _ in ctrl['writes']))
ok('POSITIVE CONTROL: the scanner finds the browser writes we know about (vp_venue_staff onboard.html, vp_venue_groups and vp_venues '
   'hq.html, vp_venue_settings vp-session.js), so a zero below means zero', found == sorted(LEFT_OUT), ctrl['writes'])
ok('...and it sees the 17 tables read (at least 20 .from() reads of them)', R['refs'] >= 20, R['refs'])

print('')
print('2. no browser write to any of the 17')
ok('no page writes any of the 17 tables (.insert/.update/.upsert/.delete after .from("<table>"))',
   [x for x in R['writes'] if x[0] in TABLES] == [], [x for x in R['writes'] if x[0] in TABLES])
ok('every .from("<one of the 17>") is a .select( straight away (no query builder kept to write through later)', R['not_select'] == [], R['not_select'])
ok('no .from(<a name built at run time>) chain writes (billing.html and members/host.html read that way only)', R['nonlit_writes'] == [], R['nonlit_writes'])
ok('no write call sits outside a .from( chain, apart from the Cache API / Map deletes allowed above', R['loose'] == [], R['loose'])
ok('no page posts to /rest/v1/<one of the 17>', R['rest'] == [], R['rest'])
base = json.load(open(BASE, encoding='utf-8'))
definer = set(k.split('(')[0] for k in base['security_definer_functions'])
bad_rpc = [x for x in R['rpc'] if x[0] not in definer]
# Comments are scanned too (on purpose: stricter). On 18 Nov 2026 the only .rpc( text in any page is a COMMENT in hq.html
# naming venueplay_spots_taken (a definer function); no page calls an RPC.
ok('every .rpc() named in a page is a SECURITY DEFINER function (grants do not reach inside it): ' + (', '.join(sorted(set(n for n, _ in R['rpc']))) or 'none'),
   bad_rpc == [], bad_rpc)

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 10
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
