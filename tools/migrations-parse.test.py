#!/usr/bin/env python3
"""EVERY MIGRATION PARSES AS POSTGRES BEFORE DEAN IS HANDED IT.

19 Oct 2026: migration 106 failed in the Supabase editor (42601 at line 294) on a stray
duplicate line of FAQ text. No test had ever PARSED a migration; Dean found it by running it.

This hands every VenuePlay and PartyPlay migration to libpg_query (pglast), the parser
Postgres itself uses, statement by statement, and every plpgsql function body to the
plpgsql parser as well. It cannot say a migration is RIGHT (there is no database here), only
that Postgres will read it. Then it checks the shape of migration 107 (the unlimited nights
switch) from the parse tree rather than by word search:
  - the column is a boolean, not null, default false, on public.vp_venues
  - the guard trigger is BEFORE, FOR EACH ROW, on INSERT and on UPDATE OF weekly_limit_off
  - the guard function lets the service role and a platform admin through, and puts the old
    value back for anybody else (assignment new.weekly_limit_off := old.weekly_limit_off)
  - it is NOT security definer (RLS-BASELINE.json lists definer functions; this adds none)

    python3 tools/migrations-parse.test.py
"""
import glob, io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  PASS  %s%s' % (label, ('  (%s)' % detail) if detail else ''))
    else:
        FAIL[0] += 1
        print('  FAIL  %s%s' % (label, ('  (%s)' % detail) if detail else ''))


try:
    import pglast
    from pglast.stream import RawStream
except Exception as e:  # pragma: no cover
    print('  FAIL  pglast is not installed (python3 -m pip install --user pglast): %s' % e)
    print('0 of 1 checks passed')
    sys.exit(1)

files = sorted(glob.glob(os.path.join(ROOT, 'venueplay-backend', 'supabase', '*.sql'))) + \
        sorted(glob.glob(os.path.join(ROOT, 'partyplay-backend', 'supabase', '*.sql')))
bad_sql, bad_pl, funcs = [], [], 0
trees = {}
for f in files:
    src = io.open(f, encoding='utf-8').read()
    try:
        stmts = pglast.parse_sql(src)
    except Exception as e:
        bad_sql.append('%s: %s' % (os.path.basename(f), str(e)[:120]))
        continue
    trees[os.path.basename(f)] = stmts
    for x in stmts:
        n = x.stmt
        if type(n).__name__ != 'CreateFunctionStmt':
            continue
        lang = [o.arg.sval for o in (n.options or ()) if o.defname == 'language']
        if lang and lang[0] == 'plpgsql':
            funcs += 1
            try:
                pglast.parse_plpgsql(RawStream()(x))
            except Exception as e:
                bad_pl.append('%s: %s' % (os.path.basename(f), str(e)[:120]))
ok('every migration parses as Postgres SQL', not bad_sql and len(files) > 100,
   '; '.join(bad_sql[:3]) if bad_sql else '%d files' % len(files))
ok('every plpgsql function body parses', not bad_pl and funcs > 10,
   '; '.join(bad_pl[:3]) if bad_pl else '%d function bodies' % funcs)

# ---- migration 107 -----------------------------------------------------------------
M = 'venueplay-107-unlimited-nights-switch.sql'
st = trees.get(M)
ok('migration 107 is present and parses', st is not None)
st = st or []


def kind(x):
    return type(x.stmt).__name__


col = None
for x in st:
    if kind(x) == 'AlterTableStmt' and x.stmt.relation.relname == 'vp_venues':
        for c in x.stmt.cmds:
            d = getattr(c, 'def_', None)
            if d is not None and type(d).__name__ == 'ColumnDef' and d.colname == 'weekly_limit_off':
                col = d
tname = '.'.join(n.sval for n in col.typeName.names) if col else ''
cons = [type(c).__name__ + ':' + str(c.contype) for c in (col.constraints or ())] if col else []
default_false = False
if col:
    for c in col.constraints or ():
        if 'DEFAULT' in str(c.contype) and c.raw_expr is not None:
            default_false = 'false' in RawStream()(c.raw_expr).lower() or getattr(getattr(c.raw_expr, 'val', None), 'boolval', None) is False
ok('107 adds vp_venues.weekly_limit_off boolean not null default false',
   col is not None and tname.endswith('bool') and any('NOTNULL' in c for c in cons) and default_false,
   '%s %s' % (tname, cons))

trig = [x.stmt for x in st if kind(x) == 'CreateTrigStmt' and x.stmt.trigname == 'vp_venues_weekly_limit_guard']
t = trig[0] if trig else None
cols = [c.sval for c in (t.columns or ())] if t else []
# pg trigger bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16
ok('107 guard trigger is BEFORE, FOR EACH ROW, on vp_venues',
   t is not None and t.relation.relname == 'vp_venues' and t.row and (t.timing & 2) == 2,
   t and ('timing=%s row=%s' % (t.timing, t.row)))
ok('...and fires on INSERT and on UPDATE OF weekly_limit_off',
   t is not None and (t.events & 4) and (t.events & 16) and cols == ['weekly_limit_off'],
   t and ('events=%s columns=%s' % (t.events, cols)))

fn = [x for x in st if kind(x) == 'CreateFunctionStmt' and x.stmt.funcname[-1].sval == 'vp_venues_weekly_limit_guard']
body = ''
definer = None
if fn:
    for o in fn[0].stmt.options or ():
        if o.defname == 'as':
            body = ''.join(a.sval for a in o.arg)
        if o.defname == 'security':
            definer = bool(o.arg.boolval)
low = ' '.join(body.lower().split())
ok('107 guard lets the service role and a platform admin through',
   "coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.vp_is_platform_admin()" in low, low[:160])
ok('...and puts the old value back for a venue login',
   'new.weekly_limit_off := old.weekly_limit_off;' in low and "new.weekly_limit_off := false;" in low, low[-200:])
ok('...and is not security definer (no change to the RLS baseline)', fn and not definer, definer)

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 9
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
