#!/usr/bin/env python3
"""DOES THE LOCK SQL ACTUALLY STOP A STRANGER WRITING THE TOUR TABLES?

touring-backend/supabase/lock-touring-writes.sql (Dean runs it as ~/RUN-ME-GFLAM-LOCK.sql)
is applied here to the live rules as they stood on 19 Oct 2026, captured read-only into
touring-backend/supabase/live-policies-2026-10-19.json, and Postgres's own rule for a
write is then asked of the result for the public roles:

    a role may write a table only if it holds the GRANT for that command, and, with row
    level security on, at least one PERMISSIVE policy for that command (or ALL) names
    the role or PUBLIC.

There is no Postgres on this machine, and the live database is not ours to experiment on,
so this is a model of that one rule, not the database itself. What keeps it honest:
every statement in the SQL must be one the model understands (an unknown statement is a
FAIL, not a skip), and the model is first shown to see the holes that are there today.

    python3 tools/touring-lock.test.py
"""
import copy, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'touring-backend', 'supabase', 'live-policies-2026-10-19.json')
SQL = {'sydney': os.path.join(ROOT, 'touring-backend', 'supabase', 'lock-touring-writes.sql'),
       'singapore': os.path.join(ROOT, 'touring-backend', 'supabase', 'lock-touring-writes-SINGAPORE.sql')}
REF = {'sydney': 'ijkzgmdtwtgfkedqspxm', 'singapore': 'gpoolavkghnxedzrmtmc'}

LOCKED = ['shows', 'reviews', 'experience', 'ticket_milestones', 'tour_categories',
          'artists', 'venues', 'show_artists']
READ_BY_PAGES = ['shows', 'reviews', 'experience', 'ticket_milestones', 'tour_categories']
PUBLIC_ROLES = ['anon', 'authenticated']     # signup is open, so authenticated is the public too
WRITES = ['INSERT', 'UPDATE', 'DELETE']

PASS, FAIL, failures = [0], [0], []


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  PASS  %s%s' % (label, ('  (%s)' % (detail,)) if detail else ''))
    else:
        FAIL[0] += 1
        failures.append(label)
        print('  FAIL  %s%s' % (label, ('  (%s)' % (detail,)) if detail else ''))


def statements(sql):
    """Top-level statements, with comments removed and do-blocks kept whole."""
    sql = re.sub(r'--[^\n]*', '', sql)
    out, buf, in_dollar = [], [], False
    for part in re.split(r'(\$\$|;)', sql):
        if part == '$$':
            in_dollar = not in_dollar
            buf.append(part)
        elif part == ';' and not in_dollar:
            s = ''.join(buf).strip()
            if s:
                out.append(s)
            buf = []
        else:
            buf.append(part)
    tail = ''.join(buf).strip()
    if tail:
        out.append(tail)
    return out


def apply(state, sql):
    """Apply the SQL to the model. Returns (state, statements not understood, buckets set)."""
    st = copy.deepcopy(state)
    unknown, buckets = [], {}
    for s in statements(sql):
        flat = ' '.join(s.split())
        low = flat.lower()
        if low in ('begin', 'commit'):
            continue
        m = re.match(r'drop policy if exists "([^"]+)" on ([a-z_]+)\.([a-z_]+)$', flat, re.I)
        if m:
            key = '%s.%s' % (m.group(2), m.group(3))
            if key in st:
                st[key]['policies'] = [p for p in st[key]['policies'] if p['name'] != m.group(1)]
            continue
        m = re.match(r'revoke (.+?) on (.+?) from (.+)$', flat, re.I)
        if m:
            privs = [p.strip().upper() for p in m.group(1).split(',')]
            tables = [t.strip() for t in m.group(2).split(',')]
            roles = [r.strip() for r in m.group(3).split(',')]
            for t in tables:
                if t in st:
                    for r in roles:
                        st[t]['grants'][r] = [g for g in st[t]['grants'].get(r, []) if g not in privs]
            continue
        m = re.match(r"update storage\.buckets set file_size_limit = (\d+), allowed_mime_types = array\[(.+?)\] where id = '([^']+)'$", flat, re.I)
        if m:
            buckets[m.group(3)] = {'limit': int(m.group(1)),
                                   'types': [x.strip().strip("'") for x in m.group(2).split(',')]}
            continue
        if low.startswith('do $$') or low.startswith('select '):
            continue          # the SQL's own self-check, and the read-only listing at the end
        unknown.append(flat[:80])
    return st, unknown, buckets


def can(st, table, role, cmd, bucket=None):
    t = st[table]
    if cmd not in t['grants'].get(role, []):
        return False
    if not t['rls']:
        return True
    for p in t['policies']:
        if p.get('permissive', 'PERMISSIVE') != 'PERMISSIVE':
            continue
        if p['cmd'] not in (cmd, 'ALL'):
            continue
        if not (set(p['roles']) & {role, 'public'}):
            continue
        if bucket is not None:
            cond = (p.get('check') or '') + (p.get('using') or '')
            if bucket not in cond:
                continue
        return True
    return False


def all_grants(st):
    """The case the lock has to survive: someone (or a dashboard table rebuild) hands the
    public roles every privilege back. Only policies stand between them and the data then."""
    st = copy.deepcopy(st)
    for k in st:
        for r in PUBLIC_ROLES:
            st[k]['grants'][r] = ['SELECT'] + WRITES
    return st


fixture = json.load(io.open(FIX, encoding='utf-8'))
for project in ('sydney', 'singapore'):
    print('-- %s' % project)
    before = fixture['projects'][project]
    sql = io.open(SQL[project], encoding='utf-8').read()
    after, unknown, buckets = apply(before, sql)

    ok('%s: every statement in the lock SQL is understood by this model' % project, not unknown, unknown[:2])
    ok('%s: the SQL names its own project and not the other' % project,
       REF[project] in sql.split('begin;')[0] and REF['singapore' if project == 'sydney' else 'sydney'] not in sql)

    # The model must SEE today's holes, or a green "after" means nothing.
    ok('%s: before the lock, anybody can upload to tour-images' % project,
       can(before, 'storage.objects', 'anon', 'INSERT', 'tour-images'))
    ok('%s: before the lock, one GRANT away from anybody writing shows' % project,
       can(all_grants(before), 'public.shows', 'anon', 'UPDATE'))

    still = ['%s %s %s' % (t, r, c) for t in LOCKED for r in PUBLIC_ROLES for c in WRITES
             if can(after, 'public.' + t, r, c)]
    ok('%s: after the lock, an anon write to shows is refused' % project,
       not can(after, 'public.shows', 'anon', 'INSERT') and not can(after, 'public.shows', 'anon', 'UPDATE')
       and not can(after, 'public.shows', 'anon', 'DELETE'))
    ok('%s: after the lock, no public role can write any tour table' % project, not still, still[:4])
    held = ['%s %s %s' % (t, r, c) for t in LOCKED for r in PUBLIC_ROLES for c in WRITES
            if c in after['public.' + t]['grants'].get(r, [])]
    ok('%s: and no public role even holds a write grant on one' % project, not held, held[:4])
    regrant = all_grants(after)
    still = ['%s %s %s' % (t, r, c) for t in LOCKED for r in PUBLIC_ROLES for c in WRITES
             if can(regrant, 'public.' + t, r, c)]
    ok('%s: and still none if every grant were handed back' % project, not still, still[:4])
    ok('%s: after the lock, nobody but the service key can upload to tour-images' % project,
       not any(can(all_grants(after), 'storage.objects', r, 'INSERT', 'tour-images') for r in PUBLIC_ROLES))
    blind = [t for t in READ_BY_PAGES if not can(after, 'public.' + t, 'anon', 'SELECT')]
    ok('%s: the public pages can still read what they read' % project, not blind, blind)
    b = buckets.get('tour-images') or {}
    ok('%s: tour-images takes only pictures of 2 MB or less' % project,
       b.get('limit') == 2 * 1024 * 1024 and set(b.get('types', [])) == {'image/jpeg', 'image/png', 'image/webp'}, b)
    ok('%s: the SQL checks its own work and refuses to finish if it did not hold' % project,
       sql.count('raise exception') >= 3 and sql.count('begin;') == 2 and sql.count('commit;') == 2)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
EXPECTED = 24
if PASS[0] + FAIL[0] != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, PASS[0] + FAIL[0]))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
