#!/usr/bin/env python3
"""Every column the code names, asked of the live database. Including the ones
only ever WRITTEN, and the ones inside an order= clause.

WHY THIS EXISTS, and why the tool it supersedes was not enough.

Three faults found on 5 Sep 2026 were all one thing: a column name the database
does not have. PostgREST rejects the WHOLE statement when a name is unknown, and
the code around it turns that error into an empty list or swallows it, so nothing
looks broken:

  pp_licences.activated_days   PATCHed by POST /licence/start in the same body as
                               activated_at. The write failed, activated_at was
                               never set, and NOBODY COULD START A PARTY THEY HAD
                               PAID FOR. Silent for as long as it stood.
  vp_member_draw_results.created_at   an order= clause. The select was rejected,
                               the catch swallowed it, and the members draw
                               announced the RESET jackpot: a room told the winner
                               took $2,400 watched the screen count up to $500.
  vp_games.created_at          HQ's retention panel. vpaSelect turned the
                               rejection into [], so every night ever recorded
                               read "games: 0, abandoned: true".

check-schema.py existed and could not see any of them. Its own docstring says so:
it skips write bodies and runtime-built selects, and it only looks at
venueplay-backend, so PartyPlay was never covered. It also was not wired into the
release gate, so it never ran unless somebody remembered.

WHAT THIS READS
  select=a,b,c            in a query string, however it is concatenated
  order=col.desc          the clause that broke the members draw
  on=col / eq / filters   col=eq.x, col=in.(...), col=is.null and the rest
  WRITE BODIES            object literals handed to sbInsert / sbPatch / sbUpsert
                          and to PartyPlay's sb(env, 't', {method, body})
  supabase-js             .from('t').select('a,b')

A column the probe cannot reach is SKIPPED and counted separately. A skip is not a
pass. It means nobody asked.

  check-columns.py            probe with the public key
  check-columns.py --list     print what it extracted and probe nothing
"""
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
import concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUPA = "https://gpoolavkghnxedzrmtmc.supabase.co"
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

# Not a secret: it is printed in every page on the site.
def anon_key():
    for p in ('venueplay/play.html', 'partyplay/play.html'):
        try:
            m = re.search(r'eyJ[A-Za-z0-9_.-]{80,}', io.open(os.path.join(ROOT, p), encoding='utf-8').read())
            if m:
                return m.group(0)
        except Exception:
            pass
    sys.exit("cannot find the anon key in any page")

SKIP_KEYS = {'method', 'body', 'headers', 'signal', 'select', 'order', 'limit', 'offset',
             'apikey', 'authorization', 'prefer', 'content-type', 'on_conflict'}
NOT_A_COLUMN = re.compile(r'^(and|or|not|count|sum|avg|min|max|\*|)$', re.I)


def files():
    out = []
    for base in ('venueplay', 'venueplay-backend', 'partyplay', 'partyplay-backend'):
        d = os.path.join(ROOT, base)
        if not os.path.isdir(d):
            continue
        for dirpath, _, names in os.walk(d):
            if 'node_modules' in dirpath or 'emails' in dirpath:
                continue
            for n in names:
                if n.endswith('.test.js'):
                    continue
                if n.endswith('.js') or n.endswith('.html'):
                    out.append(os.path.join(dirpath, n))
    return out


def balanced(src, i):
    """The text inside the parens starting at src[i] == '(', or None."""
    if i >= len(src) or src[i] != '(':
        return None
    d = 0
    for j in range(i, len(src)):
        if src[j] == '(':
            d += 1
        elif src[j] == ')':
            d -= 1
            if d == 0:
                return src[i + 1:j]
    return None


def obj_keys(src, i):
    """Keys of the object literal starting at src[i] == '{'. One level only."""
    if i >= len(src) or src[i] != '{':
        return []
    d, j, keys = 0, i, []
    while j < len(src):
        c = src[j]
        if c == '{':
            d += 1
            if d == 1:
                seg_start = j + 1
        elif c == '}':
            d -= 1
            if d == 0:
                seg = src[seg_start:j]
                # top-level keys only: drop nested braces
                flat, dd = [], 0
                for ch in seg:
                    if ch in '{[(':
                        dd += 1
                    elif ch in '}])':
                        dd -= 1
                    flat.append(ch if dd == 0 else ' ')
                for m in re.finditer(r"(?:^|,)\s*(?:'([A-Za-z_]\w*)'|\"([A-Za-z_]\w*)\"|([A-Za-z_]\w*))\s*:", ''.join(flat)):
                    keys.append(m.group(1) or m.group(2) or m.group(3))
                return keys
        j += 1
    return keys


def extract(path):
    """[(table, column, why)] for one file."""
    src = io.open(path, encoding='utf-8', errors='replace').read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'^\s*//.*$', '', src, flags=re.M)
    found = []

    # 1. Worker helpers, bounded to their OWN call.
    #
    # The first version scanned a fixed window past each call, so it swallowed the
    # NEXT call's columns and filed them under this table: 288 "missing" columns,
    # nearly all of them real columns on a different table
    # (vp_venues.stripe_customer_id belongs to venueplay_founding). A check with a
    # 45% false-positive rate buries the three real ones. So walk to the matching
    # close paren and look only inside.
    for m in re.finditer(r"\b(?:sbGet|sbInsert|sbPatch|sbUpsert|sbDelete|vpaSelect|vpaInsert|vpaPatch|sb)\s*\(", src):
        call = balanced(src, src.index('(', m.start()))
        if call is None:
            continue
        tm = re.match(r"\s*env\s*,\s*['\"]([a-z_]+)(\?[^'\"]*)?['\"]", call)
        if not tm:
            continue
        table = tm.group(1)
        if tm.group(2):
            found += from_query(table, tm.group(2))
        rest = call[tm.end():]
        for q in re.findall(r"['\"]([^'\"]*(?:select=|order=|=eq\.|=in\.|=is\.|=neq\.|=lt\.|=gt\.)[^'\"]*)['\"]", rest):
            found += from_query(table, q)
        # a write body inside THIS call only
        for bm in re.finditer(r"\{", rest):
            keys = obj_keys(rest, bm.start())
            if keys:
                for k in keys:
                    if k.lower() not in SKIP_KEYS:
                        found.append((table, k, 'write body'))
                break
        # PartyPlay wraps the body: sb(env,'t',{method:'PATCH', body: JSON.stringify({...})})
        jm = re.search(r"JSON\.stringify\(\s*\[?\s*(\{)", rest)
        if jm:
            for k in obj_keys(rest, jm.start(1)):
                if k.lower() not in SKIP_KEYS:
                    found.append((table, k, 'write body'))

    # 3. supabase-js .from('t').select('a,b')
    #
    # Bounded to THIS chain. A fixed 300-char tail ran into the next .from() in an
    # array of queries and filed its columns under the wrong table: it reported
    # vp_venue_groups.period_month when the code says
    # .from("vp_billing_usage").order("period_month"). Stop at the next .from( or
    # the end of the statement, whichever comes first.
    for m in re.finditer(r"\.from\(\s*['\"]([a-z_]+)['\"]\s*\)", src):
        table = m.group(1)
        tail = src[m.end():m.end() + 400]
        for stop in (tail.find('.from('), tail.find(';')):
            if stop > 0:
                tail = tail[:stop]
        sel = re.search(r"\.select\(\s*['\"]([^'\"]*)['\"]", tail)
        if sel:
            found += from_query(table, 'select=' + sel.group(1))
        for om in re.finditer(r"\.(?:order|eq|neq|gt|lt|gte|lte|is|in)\(\s*['\"]([A-Za-z_]\w*)['\"]", tail):
            found.append((table, om.group(1), 'filter'))

    # 4. Raw REST urls: /rest/v1/table?select=...
    for m in re.finditer(r"/rest/v1/([a-z_]+)\?([^'\"`\s]*)", src):
        found += from_query(m.group(1), m.group(2))

    out = []
    for t, c, why in found:
        c = c.strip()
        if not c or NOT_A_COLUMN.match(c) or c.lower() in SKIP_KEYS:
            continue
        if not re.match(r'^[A-Za-z_]\w*$', c):
            continue
        out.append((t, c, why))
    return out


def from_query(table, q):
    got = []
    for m in re.finditer(r'select=([^&\'"]*)', q):
        for part in m.group(1).split(','):
            part = part.split('(')[0].split('!')[0].split(':')[-1].strip()
            if part and part != '*':
                got.append((table, part, 'select'))
    for m in re.finditer(r'order=([A-Za-z_]\w*)', q):
        got.append((table, m.group(1), 'order'))
    for m in re.finditer(r'(?:^|&)([A-Za-z_]\w*)=(?:eq|neq|gt|gte|lt|lte|is|in|like|ilike|not)\.', q):
        got.append((table, m.group(1), 'filter'))
    return got


def probe(key, table, col):
    url = '%s/rest/v1/%s?select=%s&limit=1' % (SUPA, table, col)
    req = urllib.request.Request(url, headers={'apikey': key, 'authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            json.loads(r.read().decode('utf-8', 'replace'))
            return 'ok', ''
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception:
            return 'skip', 'HTTP %s' % e.code
        code, msg = d.get('code'), str(d.get('message') or '')
        if code == '42703' or 'does not exist' in msg:
            return 'missing', msg[:90]
        if code == '42P01' or 'not exist' in msg and 'relation' in msg:
            return 'notable', msg[:90]
        if code == '42501' or 'permission denied' in msg:
            return 'skip', 'no grant for the public key'
        return 'skip', ('%s %s' % (code, msg))[:90]
    except Exception as e:
        return 'skip', str(e)[:60]


def main():
    pairs = {}
    for f in files():
        for t, c, why in extract(f):
            pairs.setdefault((t, c), set()).add((os.path.relpath(f, ROOT), why))
    pairs = {k: v for k, v in pairs.items() if k[0].startswith(('vp_', 'pp_', 'venueplay_', 'v_vp_', 'reviews', 'shows', 'venues', 'signups', 'contacts', 'experience', 'tour_categories', 'ticket_milestones'))}
    print('\n%sCOLUMNS THE CODE NAMES%s  %d pair(s) across %d table(s)'
          % (YEL, OFF, len(pairs), len({t for t, _ in pairs})))
    if '--list' in sys.argv:
        for (t, c), where in sorted(pairs.items()):
            print('   %-34s %-28s %s' % (t, c, sorted(where)[0][1]))
        return 0

    key = anon_key()
    # PROVE THE PROBE WORKS BEFORE BELIEVING A CLEAN RUN. A name that cannot exist
    # must come back missing, and one that does must come back ok. Without this the
    # whole run could be a wall of false passes.
    bad_state, _ = probe(key, 'vp_venues', 'a_column_that_cannot_exist')
    good_state, _ = probe(key, 'vp_venues', 'id')
    if bad_state != 'missing' or good_state != 'ok':
        print('  %sSTOP%s the probe itself is not working: a nonsense column came back "%s" '
              'and a real one came back "%s". Every result below would be meaningless.'
              % (RED, OFF, bad_state, good_state))
        return 2
    print('  %sprobe verified%s  a nonsense column reads missing, a real one reads ok\n' % (DIM, OFF))

    results = {}
    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(probe, key, t, c): (t, c) for (t, c) in pairs}
        for fu in cf.as_completed(futs):
            results[futs[fu]] = fu.result()

    missing = [(k, v) for k, v in results.items() if v[0] == 'missing']
    notable = [(k, v) for k, v in results.items() if v[0] == 'notable']
    skipped = [(k, v) for k, v in results.items() if v[0] == 'skip']
    okc = sum(1 for v in results.values() if v[0] == 'ok')

    for (t, c), (_, msg) in sorted(missing):
        where = sorted(pairs[(t, c)])
        print('  %sMISSING%s %s.%s' % (RED, OFF, t, c))
        for w, why in where[:3]:
            print('           %s  (%s)' % (w, why))
    for (t, c), (_, msg) in sorted(notable):
        print('  %sNO TABLE%s %s (asked for %s)' % (RED, OFF, t, c))

    print('\n  %d present, %s%d MISSING%s, %d no such table, %d skipped'
          % (okc, RED if missing else DIM, len(missing), OFF, len(notable), len(skipped)))
    if skipped:
        tt = sorted({t for (t, _), _ in skipped})
        print('  %sskipped is not a pass. The public key cannot reach: %s%s'
              % (DIM, ', '.join(tt[:8]), OFF))
    return 1 if (missing or notable) else 0


sys.exit(main())
