#!/usr/bin/env python3
"""MIGRATION 114, READ BY POSTGRES'S OWN PARSER (21 Oct 2026).

There is no Postgres on this machine, and the repo has no pattern for running one, so the trigger
cannot be RUN here. Two things stand in for that, and neither is a word search:

  1. The migration proves itself on the live database when Dean runs it: its last block deletes a
     real screen row and changes another directly, requires both to be recorded with via 'direct',
     requires the history to refuse a delete, then rolls all of that back. If any part fails the
     whole migration is rolled back. That is the "a direct delete is captured" test, against the
     real trigger, on the real database.
  2. This file. pglast is libpg_query, the parser Postgres itself uses, so a statement it reads as
     a trigger IS a trigger to Postgres. It parses the migration and every PL/pgSQL body in it and
     asserts on the parse tree: the trigger fires AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW on
     vp_venue_screen; the history has no foreign key (deleting a venue must not delete its history);
     anon, authenticated and the service key cannot write it and venue logins cannot read it; the
     append-only guard covers UPDATE, DELETE and TRUNCATE; the recorder is SECURITY DEFINER with a
     fixed search_path and inserts into the history; the self-test deletes a real row and raises
     when it is not recorded. And across files: the header the Worker sends is the header the
     trigger reads, the columns the Worker reads exist, and RLS-BASELINE.json carries the new locks.

Run from the repo root:  python3 tools/screen-history-sql.test.py
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'venueplay-114-screen-history.sql')
API = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')
BASE = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'RLS-BASELINE.json')
fails = 0


def check(name, ok, saw=None):
    global fails
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok or saw is None else '   saw: ' + str(saw)[:300]))
    if not ok:
        fails += 1


try:
    from pglast import parse_sql, parse_plpgsql
except ImportError:
    print('  FAIL pglast is not installed (python3 -m pip install --user pglast)')
    sys.exit(1)

src = io.open(MIG, encoding='utf-8').read()
H = 'vp_venue_screen_history'
print('the migration parses the way Postgres parses it')
try:
    stmts = [s.stmt for s in parse_sql(src)]
    check('every statement parses (%d)' % len(stmts), len(stmts) >= 15, len(stmts))
except Exception as e:
    stmts = []
    check('every statement parses', False, e)
try:
    bodies = parse_plpgsql(src)
    check('every PL/pgSQL body parses (%d: the guard, the recorder, the check, the self-test)' % len(bodies), len(bodies) == 4, len(bodies))
except Exception as e:
    bodies = []
    check('every PL/pgSQL body parses', False, e)


def kind(n):
    return type(n).__name__


def names(n):
    return [getattr(x, 'sval', None) for x in (n or [])]


def walk_sql(node, out):
    """Every SQL text a PL/pgSQL body runs, from the parse tree."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == 'query' and isinstance(v, str):
                out.append(v)
            walk_sql(v, out)
    elif isinstance(node, list):
        for v in node:
            walk_sql(v, out)


def fn(name):
    for n in stmts:
        if kind(n) == 'CreateFunctionStmt' and names(n.funcname)[-1] == name:
            return n
    return None


def fn_sql(name):
    """The SQL inside one function, by parsing that function's own body."""
    n = fn(name)
    if n is None:
        return []
    body = [o for o in n.options if o.defname == 'as'][0].arg
    text = body[0].sval if isinstance(body, (list, tuple)) else body.sval
    wrapped = 'create function x() returns trigger language plpgsql as $q$' + text + '$q$;'
    out = []
    walk_sql(parse_plpgsql(wrapped), out)
    return out


def opts(name):
    n = fn(name)
    d = {}
    for o in (n.options if n else []):
        if o.defname == 'security':
            d['security'] = bool(o.arg.boolval) if hasattr(o.arg, 'boolval') else str(o.arg)
        if o.defname == 'set':
            d['set'] = o.arg.name if hasattr(o.arg, 'name') else str(o.arg)
    return d


def triggers(table):
    return [n for n in stmts if kind(n) == 'CreateTrigStmt' and n.relation.relname == table]


INSERT, DELETE, UPDATE, TRUNCATE, BEFORE = 4, 8, 16, 32, 2

print('the recorder')
t = [x for x in triggers('vp_venue_screen') if x.trigname == 'vp_venue_screen_capture']
check('a trigger on vp_venue_screen fires AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW',
      len(t) == 1 and t[0].timing == 0 and t[0].events == INSERT | UPDATE | DELETE and t[0].row is True,
      [(x.trigname, x.timing, x.events, x.row) for x in triggers('vp_venue_screen')])
check('...and runs the recorder', len(t) == 1 and names(t[0].funcname)[-1] == 'vp_venue_screen_capture')
o = opts('vp_venue_screen_capture')
check('the recorder is SECURITY DEFINER with a fixed search_path (it writes a table nobody else may)',
      o.get('security') is True and o.get('set') == 'search_path', o)
q = fn_sql('vp_venue_screen_capture')
ins = [x for x in q if re.match(r'\s*insert\s+into\s+public\.' + H + r'\b', x, re.I)]
check('the recorder inserts into the history', len(ins) == 1, q)
check('...the row before AND the row after, and who', bool(ins) and all(c in ins[0] for c in ('old_row', 'new_row', 'actor', 'via', 'db_session_user')), ins)
check('...reading who from the X-VP-Actor request header', any("'x-vp-actor'" in x and 'request.headers' in ' '.join(q) for x in q), q)
check('...and skips an update that moved nothing but the clock', any(re.search(r"\(o - 'updated_at'\) = \(n - 'updated_at'\)", x) for x in q), q)

print('the history: append-only, no way in for a venue, survives its venue')
create = [n for n in stmts if kind(n) == 'CreateStmt' and n.relation.relname == H]
check('the table is created', len(create) == 1)
cols = {}
fk = False
for el in (create[0].tableElts if create else []):
    if kind(el) == 'ColumnDef':
        cols[el.colname] = el
        for c in (el.constraints or []):
            if getattr(c, 'contype', None) is not None and 'FOREIGN' in str(c.contype):
                fk = True
    elif kind(el) == 'Constraint' and 'FOREIGN' in str(el.contype):
        fk = True
check('it has NO foreign key, so deleting a venue (which cascades to its screen row) cannot delete its history', not fk and len(cols) >= 10, list(cols))
check('RLS is switched on', any(kind(n) == 'AlterTableStmt' and n.relation.relname == H and
      any(getattr(c, 'subtype', None) is not None and 'EnableRowSecurity' in str(c.subtype) for c in n.cmds) for n in stmts))
check('no policy is created on it (with RLS on and no policy, a venue login sees nothing)',
      not any(kind(n) == 'CreatePolicyStmt' and n.table.relname == H for n in stmts))
grants = [n for n in stmts if kind(n) == 'GrantStmt' and 'TABLE' in str(n.objtype) and any(getattr(x, 'relname', '') == H for x in n.objects)]
rev = [n for n in grants if not n.is_grant]
gr = [n for n in grants if n.is_grant]
revoked = set(g.rolename for n in rev for g in n.grantees if g.rolename) | (set(['public']) if any(g.rolename is None for n in rev for g in n.grantees) else set())
check('ALL is revoked from public, anon, authenticated AND the service key', revoked >= {'public', 'anon', 'authenticated', 'service_role'} and
      all(not n.privileges for n in rev), revoked)
check('the only grant is SELECT, to the service key (the Worker reads it for HQ; nobody writes it but the recorder)',
      len(gr) == 1 and [p.priv_name for p in gr[0].privileges] == ['select'] and [g.rolename for g in gr[0].grantees] == ['service_role'],
      [([p.priv_name for p in n.privileges], [g.rolename for g in n.grantees]) for n in gr])
guards = triggers(H)
check('a BEFORE UPDATE OR DELETE trigger refuses every change to a recorded row',
      any(x.timing == BEFORE and x.events == UPDATE | DELETE and x.row and names(x.funcname)[-1] == 'vp_venue_screen_history_append_only' for x in guards),
      [(x.trigname, x.timing, x.events) for x in guards])
check('...and a BEFORE TRUNCATE trigger refuses emptying it',
      any(x.timing == BEFORE and x.events == TRUNCATE and names(x.funcname)[-1] == 'vp_venue_screen_history_append_only' for x in guards))
g = fn('vp_venue_screen_history_append_only')
gtext = ''
if g is not None:
    a = [o for o in g.options if o.defname == 'as'][0].arg
    gtext = a[0].sval if isinstance(a, (list, tuple)) else a.sval
check('...whose body raises, whatever it is asked', re.search(r'^\s*begin\s+raise\s+exception', gtext, re.I) is not None and 'return' not in gtext.lower(), gtext)

print('the baseline and the nightly check')
base = [n for n in stmts if kind(n) == 'InsertStmt' and n.relation.relname == H]
bq = parse_sql(src)  # for the raw text of the baseline insert
btxt = [src[s.stmt_location:s.stmt_location + s.stmt_len] for s in bq if kind(s.stmt) == 'InsertStmt']
check('every existing screen row gets a baseline version, once', len(base) == 1 and bool(btxt) and "'baseline'" in btxt[0] and
      re.search(r'from public\.vp_venue_screen s\b', btxt[0]) and 'not exists' in btxt[0], btxt)
o = opts('vp_screen_history_check')
check('the nightly check is SECURITY DEFINER with a fixed search_path', o.get('security') is True and o.get('set') == 'search_path', o)
cq = ' '.join(fn_sql('vp_screen_history_check'))
check('...it writes drift and vanished rows into the history', "'drift'" in cq and "'vanished'" in cq and ('insert into public.' + H) in cq, cq[:200])
fg = [n for n in stmts if kind(n) == 'GrantStmt' and 'FUNCTION' in str(n.objtype)]
def fgrants(name, is_grant):
    return [g.rolename for n in fg if n.is_grant == is_grant and any(names(x.objname)[-1] == name for x in n.objects) for g in n.grantees]
check('...only the service key may run it', fgrants('vp_screen_history_check', True) == ['service_role'] and
      {'anon', 'authenticated'} <= set(fgrants('vp_screen_history_check', False)), (fgrants('vp_screen_history_check', True), fgrants('vp_screen_history_check', False)))

print('the self-test the migration runs on the live database')
do = [s for s in parse_sql(src) if kind(s.stmt) == 'DoStmt']
dtext = src[do[0].stmt_location:do[0].stmt_location + do[0].stmt_len] if do else ''
dq = []
walk_sql(parse_plpgsql(dtext + ';') if dtext else [], dq)
check('it deletes a real screen row directly', any(re.match(r'\s*delete from public\.vp_venue_screen where', x) for x in dq), dq)
check('...and requires that delete to be in the history as via direct, or the migration fails', 'a direct delete was not recorded' in dtext and
      any("op = 'delete' and via = 'direct'" in x for x in dq), dq)
check('...requires a direct update to be recorded, and a clock-only one not to be', 'a direct update was not recorded' in dtext and 'clock-only update was recorded' in dtext)
check('...requires the history to refuse a delete', any(re.match(r'\s*delete from public\.' + H, x) for x in dq) and 'the history let a row be deleted' in dtext)
check('...requires venue logins and the service key to have no way in', all(("has_table_privilege('%s'" % r) in dtext for r in ('anon', 'authenticated', 'service_role')))
check('...and rolls every part of the test back (it ends by raising inside its own block)', "raise exception 'selftest-passed'" in dtext and "sqlerrm <> 'selftest-passed'" in dtext)

print('the Worker and the database agree')
api = io.open(API, encoding='utf-8').read()
m = re.search(r"'(X-VP-Actor)':\s*vpbAsciiHeader", api)
check('the Worker sends the header the trigger reads (header names arrive lower case)', bool(m) and m.group(1).lower() == 'x-vp-actor', m and m.group(1))
sel = re.search(r"'&select=(id,op,old_row,new_row,changed_at,actor,via,db_session_user,db_role,jwt_role)'", api)
check('every column HQ\'s history read asks for exists in the table', bool(sel) and all(c in cols for c in sel.group(1).split(',')),
      sel and [c for c in sel.group(1).split(',') if c not in cols])
check('the ops the Worker puts into words are the ops the table allows', all(("'%s'" % op) in src for op in ('insert', 'update', 'delete', 'baseline', 'drift', 'vanished')) and
      all(("op === '%s'" % op) in api for op in ('baseline', 'insert', 'delete', 'vanished', 'drift')))
check('the nightly call names the function the migration creates', "/rest/v1/rpc/vp_screen_history_check" in api)

print('RLS-BASELINE.json carries the new locks')
b = json.load(io.open(BASE, encoding='utf-8'))
check('the history is in it with RLS on', b['rls'].get(H) == {'enabled': True, 'forced': False}, b['rls'].get(H))
check('no grant to anon or authenticated on it', not [g for g in b['grants'] if g.startswith(H + ' ')])
check('no policy on it', not [k for k in b['policies'] if k.startswith(H + '.')])
for f in ('vp_venue_screen_capture()', 'vp_screen_history_check()'):
    check('%s is a definer function neither venue role can run' % f, b['security_definer_functions'].get(f) == {'anon': False, 'authenticated': False},
          b['security_definer_functions'].get(f))

print('')
print(('%d FAILED' % fails) if fails else 'ALL CHECKS PASSED')
sys.exit(1 if fails else 0)
