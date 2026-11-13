#!/usr/bin/env python3
"""MIGRATIONS 145, 146 AND 147 (security audit 3 Nov 2026), READ BY POSTGRES'S OWN PARSER.

There is no Postgres on this machine (see tools/screen-history-sql.test.py for why this is the
pattern), so each migration also proves itself when Dean runs it: a self-check block raises and
rolls the whole thing back if the hole is not shut. This file is the other half. pglast is
libpg_query, the parser Postgres itself uses, so a statement it reads as a REVOKE is a REVOKE. It
asserts on the parse trees and across files:

  145 (H1)  the manager UPDATE policy on vp_venues is dropped; UPDATE is revoked from anon and
            authenticated; authenticated gets back UPDATE on group_id ONLY; and every direct
            browser write to vp_venues anywhere under venueplay/ writes only granted columns, so
            the migration cannot break a page.
  146 (H2)  vp_venue_staff.is_account_owner boolean not null default false; the backfill sets it
            true; a BEFORE INSERT FOR EACH ROW trigger marks new owners and can never raise; the
            owner rule block is byte-identical in the migration and its read-only pre-check; the
            pre-check is SELECTs only; and the billing Worker reads the same column name and falls
            back only on 42703 (column does not exist).
  147 (M4)  a UNIQUE partial index on vp_purchase_raffle_draws (raffle_id, prize_index) WHERE
            outcome = 'drawn'; the pre-check is a SELECT only; the Worker's insert writes those
            three columns and turns a 409 into "just been drawn on another screen".

Run from the repo root:  python3 tools/security-3nov-sql.test.py
"""
import glob, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUP = os.path.join(ROOT, 'venueplay-backend', 'supabase')
API = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js')
GAME = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-game.js')
fails = 0
ran = 0


def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok or saw is None else '   saw: ' + str(saw)[:300]))
    if not ok:
        fails += 1


try:
    from pglast import parse_sql, parse_plpgsql
except ImportError:
    print('  FAIL pglast is not installed (python3 -m pip install --user pglast)')
    sys.exit(1)


def read(p):
    return io.open(p, encoding='utf-8').read()


def stmts(path):
    return [s.stmt for s in parse_sql(read(path))]


def kind(x):
    return type(x).__name__


def one(pattern):
    hits = sorted(glob.glob(os.path.join(SUP, pattern)))
    return hits[0] if len(hits) == 1 else None


# ------------------------------------------------------------------ 145
print('145: a venue login can no longer write its own vp_venues row')
M145 = one('venueplay-145-*.sql')
check('exactly one migration 145', bool(M145))
s145 = stmts(M145) if M145 else []
drops = [x for x in s145 if kind(x) == 'DropStmt' and 'POLICY' in str(x.removeType)
         and any(o[-1].sval == 'vp_venues_manager_update' and o[-2].sval == 'vp_venues' for o in x.objects)]
check('drops policy vp_venues_manager_update on vp_venues', len(drops) == 1)


def grants(ss, is_grant):
    out = []
    for x in ss:
        if kind(x) != 'GrantStmt' or bool(x.is_grant) != is_grant:
            continue
        rels = [o.relname for o in (x.objects or []) if kind(o) == 'RangeVar']
        roles = [g.rolename for g in (x.grantees or [])]
        for p in (x.privileges or []):
            cols = [c.sval for c in (p.cols or [])]
            out.append((tuple(rels), p.priv_name, tuple(cols), tuple(roles)))
    return out


rev = grants(s145, False)
gra = grants(s145, True)
check('revokes table UPDATE on vp_venues from authenticated',
      any(r == ('vp_venues',) and p == 'update' and not c and 'authenticated' in ro for r, p, c, ro in rev), rev)
check('revokes table UPDATE on vp_venues from anon',
      any(r == ('vp_venues',) and p == 'update' and not c and 'anon' in ro for r, p, c, ro in rev), rev)
upd_grants = [(c, ro) for r, p, c, ro in gra if r == ('vp_venues',) and p == 'update']
check('grants back UPDATE on vp_venues to authenticated for named columns only, never the whole table',
      len(upd_grants) == 1 and upd_grants[0][0] and 'authenticated' in upd_grants[0][1], upd_grants)
granted_cols = set(upd_grants[0][0]) if upd_grants else set()
check('none of the billing columns is granted back',
      not (granted_cols & {'max_players', 'status', 'suspended_reason', 'pending_players', 'founding_id',
                           'broadcast_enforce', 'last_trivia_at', 'last_musical_at'}), granted_cols)
check('the migration self-checks and raises (so a half-applied run rolls back)',
      any(kind(x) == 'DoStmt' for x in s145) and 'raise exception' in read(M145).lower())

# Every direct browser write to vp_venues: only granted columns.
WRITE_RX = re.compile(r"""from\(\s*["']vp_venues["']\s*\)\s*\.\s*(update|upsert|insert|delete)\s*\(\s*(\{[^}]*\})?""", re.S)
writes = []
for dirpath, _, files in os.walk(os.path.join(ROOT, 'venueplay')):
    if 'vendor' in dirpath or 'node_modules' in dirpath:
        continue
    for f in files:
        if not f.endswith(('.html', '.js')):
            continue
        p = os.path.join(dirpath, f)
        for m in WRITE_RX.finditer(read(p)):
            keys = set(re.findall(r'([A-Za-z_][A-Za-z0-9_]*)\s*:', m.group(2) or ''))
            writes.append((os.path.relpath(p, ROOT), m.group(1), keys))
check('the scan finds the one known browser write (HQ group tick), so it is not blind',
      any(w[0] == 'venueplay/app/hq.html' and w[1] == 'update' and w[2] == {'group_id'} for w in writes), writes)
bad = [w for w in writes if w[1] != 'update' or not w[2] or not w[2] <= granted_cols]
check('every browser write to vp_venues is an update of granted columns only', not bad, bad)
check('no page writes vp_venues through a raw /rest/v1 PATCH',
      not [p for p in glob.glob(os.path.join(ROOT, 'venueplay', '**', '*.*'), recursive=True)
           if p.endswith(('.html', '.js')) and 'vendor' not in p
           and re.search(r"rest/v1/vp_venues[^'\"]*['\"][^;]{0,200}method\s*:\s*['\"](PATCH|POST|DELETE)", read(p))])

# ------------------------------------------------------------------ 146
print('146: the account owner is named')
M146 = one('venueplay-146-*.sql')
P146 = os.path.join(SUP, 'PRECHECK-account-owner-146-READ-ONLY.sql')
check('exactly one migration 146 and its pre-check', bool(M146) and os.path.exists(P146))
s146 = stmts(M146) if M146 else []
alters = [x for x in s146 if kind(x) == 'AlterTableStmt' and x.relation.relname == 'vp_venue_staff']
coldef = None
for a in alters:
    for c in a.cmds:
        d = getattr(c, 'def_', None) or getattr(c, 'def', None)
        if d is not None and kind(d) == 'ColumnDef' and d.colname == 'is_account_owner':
            coldef = d
check('adds vp_venue_staff.is_account_owner', coldef is not None)
if coldef is not None:
    tname = coldef.typeName.names[-1].sval
    cons = [str(c.contype) for c in (coldef.constraints or [])]
    check('boolean, not null, default false', tname == 'bool' and any('NOTNULL' in c for c in cons)
          and any('DEFAULT' in c for c in cons), (tname, cons))
ups = [x for x in s146 if kind(x) == 'UpdateStmt' and x.relation.relname == 'vp_venue_staff']
check('the backfill sets is_account_owner = true on vp_venue_staff',
      len(ups) == 1 and any(t.name == 'is_account_owner' and 'true' in str(t.val).lower() for t in ups[0].targetList))
trig = [x for x in s146 if kind(x) == 'CreateTrigStmt']
check('a BEFORE INSERT FOR EACH ROW trigger on vp_venue_staff',
      len(trig) == 1 and trig[0].relation.relname == 'vp_venue_staff' and trig[0].row
      and (trig[0].timing & 2) and (trig[0].events & 4), trig and trig[0])
fn = [x for x in s146 if kind(x) == 'CreateFunctionStmt']
check('the trigger calls the function the migration creates',
      len(fn) == 1 and trig and trig[0].funcname[-1].sval == fn[0].funcname[-1].sval)
if fn:
    body_src = read(M146)
    bm = re.search(r'as \$\$(.*?)\$\$;', body_src, re.S)
    check('the function body parses as PL/pgSQL', bool(bm) and bool(parse_plpgsql(body_src[body_src.find('create or replace function'):body_src.find('$$;', bm.start()) + 3])))
    check('the trigger can never raise (exception when others returns the row)',
          bool(bm) and re.search(r'exception\s+when\s+others\s+then\s+return\s+new', bm.group(1), re.I))


def block(path):
    t = read(path)
    a = t.find('-- >>> WHO IS EACH ACCOUNT')
    b = t.find('-- <<< end of the shared block')
    return t[a:b] if a >= 0 and b > a else None


b1, b2 = (block(M146) if M146 else None), block(P146) if os.path.exists(P146) else None
check('the owner rule block is identical in the migration and the pre-check', b1 and b1 == b2)
check('the pre-check uses it twice (summary and every login), identical both times',
      read(P146).count(b2 or 'x') == 2 if b2 else False)
pre = stmts(P146) if os.path.exists(P146) else []
check('the pre-check is SELECTs only (nothing in it can write)', pre and all(kind(x) == 'SelectStmt' for x in pre), [kind(x) for x in pre])
check('the owner rule reads the account contact email and mobile', b1 and 'f.contact_email' in b1 and 'f.mobile' in b1)

api = read(API)
check('the billing Worker reads is_account_owner by that exact name (the run-time behaviour is in tools/test-account-owner-marker.js)',
      "&select=venue_id,role,permissions,is_account_owner'" in api)

# ------------------------------------------------------------------ 147
print('147: one winner per purchase raffle prize')
M147 = one('venueplay-147-*.sql')
P147 = os.path.join(SUP, 'PRECHECK-raffle-double-winners-147-READ-ONLY.sql')
check('exactly one migration 147 and its pre-check', bool(M147) and os.path.exists(P147))
s147 = stmts(M147) if M147 else []
idx = [x for x in s147 if kind(x) == 'IndexStmt']
ok_idx = (len(idx) == 1 and idx[0].unique and idx[0].relation.relname == 'vp_purchase_raffle_draws'
          and [e.name for e in idx[0].indexParams] == ['raffle_id', 'prize_index'])
check('a UNIQUE index on vp_purchase_raffle_draws (raffle_id, prize_index)', ok_idx, idx)
w = idx[0].whereClause if idx else None
check("partial: WHERE outcome = 'drawn' (a redrawn prize can be drawn again)",
      w is not None and kind(w) == 'A_Expr' and w.name[0].sval == '=' and w.lexpr.fields[0].sval == 'outcome'
      and w.rexpr.val.sval == 'drawn', w)
check('duplicates are marked redrawn before the index is built, never deleted',
      M147 and not [x for x in s147 if kind(x) == 'DeleteStmt'] and "set outcome = 'redrawn'" in read(M147)
      and read(M147).find("set outcome = 'redrawn'") < read(M147).find('create unique index'))
pre7 = stmts(P147) if os.path.exists(P147) else []
check('the pre-check is a SELECT only', pre7 and all(kind(x) == 'SelectStmt' for x in pre7))
game = read(GAME)
dm = re.search(r'async function handlePraffleDraw\(.*?\n\}\n', game, re.S)
d = dm.group(0) if dm else ''
check('the Worker insert writes raffle_id, prize_index and outcome drawn',
      bool(re.search(r"const row = \{ raffle_id: r\.id, venue_id: g\.venue\.id, prize_index: prizeIndex,", d)) and "outcome: 'drawn'" in d)
check('the Worker answers 409 already_drawn when the index refuses',
      bool(re.search(r"if \(e && e\.status === 409\) \{\s*return json\(\{ error: 'That prize has just been drawn on another screen\.[^']*', already_drawn: true \}, 409\);", d)))

print('')
if fails:
    print('%d FAILED, %d run' % (fails, ran))
    sys.exit(1)
print('ALL %d CHECKS PASSED' % ran)
