#!/usr/bin/env python3
"""Do the live database and the Sydney one actually hold the same shape?

    python3 venueplay-backend/tools/check-databases-match.py

WHY. Saturday's cut-over points every Worker at Sydney. Anything the live database
has that Sydney does not, disappears at that moment, and nearly none of it fails
loudly: a missing TRIGGER means a rule silently stops applying, a missing UNIQUE
INDEX means a guard silently stops guarding, a missing FUNCTION means the Worker
takes its fallback path and only gets slower. You find out from a venue.

It found two real ones on 10 Sep 2026, both of which the ledger got backwards:
Sydney was missing migration 77's owner-only settings trigger, so a manager could
have changed the columns only an owner may change; and 74's index. The ledger said
73 and 76 were "not on live" when live had both.

WHAT IT COMPARES. Tables, columns and their types, functions, triggers, indexes,
and row level security policies. NOT rows: the two hold different data on purpose.

A difference is not automatically a fault. Read each one and decide. What this tool
guarantees is that you decide, rather than finding out during a game.
"""
import subprocess, sys
from pathlib import Path

PSQL = '/Applications/Postgres.app/Contents/Versions/latest/bin/psql'
ENV  = Path.home() / '.gflam-migrate.env'

# Only our own objects. PostgREST, Supabase auth and the extensions live in other
# schemas and are managed by Supabase, so a difference there is noise.
PLURAL = {'table': 'tables', 'column': 'columns', 'function': 'functions',
          'trigger': 'triggers', 'index': 'indexes', 'policy': 'policies'}

QUERIES = {
 'table':    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
 'column':   "select table_name||'.'||column_name||' '||data_type from information_schema.columns where table_schema='public'",
 'function': "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
 'trigger':  "select c.relname||' -> '||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal",
 'index':    "select tablename||' -> '||indexname from pg_indexes where schemaname='public'",
 'policy':   "select tablename||' -> '||policyname from pg_policies where schemaname='public'",
}

def env():
    e = {}
    for l in ENV.read_text().splitlines():
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1); e[k.strip()] = v.strip()
    return e

def ask(url, sql):
    r = subprocess.run([PSQL, url, '-At', '-c', sql], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print('  could not query the database: ' + (r.stderr or '').strip()[:200]); sys.exit(1)
    return set(x for x in r.stdout.splitlines() if x.strip())

def main():
    e = env()
    live, syd = e.get('OLD_DB_URL'), e.get('NEW_DB_URL')
    if not live or not syd:
        print('STOP: OLD_DB_URL and NEW_DB_URL must both be in %s' % ENV); sys.exit(1)

    # WHICH ONE IS LIVE IS A QUESTION, NOT A CONSTANT. This said "(Singapore)" in the
    # heading, which stopped being true at 12:45 on 12 Sep 2026 and would have had somebody
    # reading this output backwards: it now compares the ABANDONED copy against the live one.
    from vp_live import live as _live
    _L = _live()
    _old_is_live = (_L.where == 'Singapore')
    print('\nComparing Singapore with Sydney.  LIVE IS %s.' % _L.where.upper())
    if not _old_is_live:
        print('  Read this the other way round: the left column is now the abandoned copy.')
    print('Only the shape is compared. The rows are different on purpose.\n')
    gaps = 0
    for kind, sql in QUERIES.items():
        a, b = ask(live, sql), ask(syd, sql)
        missing, extra = sorted(a - b), sorted(b - a)
        if not missing and not extra:
            print('  ok   %-9s %d, the same on both' % (PLURAL[kind], len(a)))
            continue
        if missing:
            gaps += len(missing)
            print('  GAP  %-9s %d on LIVE that SYDNEY DOES NOT HAVE.' % (PLURAL[kind], len(missing)))
            print('       At cut-over these stop existing:')
            for m in missing[:12]: print('         - ' + m)
            if len(missing) > 12: print('         ... and %d more' % (len(missing) - 12))
        if extra:
            print('  --   %-9s %d on SYDNEY that live does not have (usually fine: newer work):' % (PLURAL[kind], len(extra)))
            for m in extra[:8]: print('         + ' + m)
            if len(extra) > 8: print('         ... and %d more' % (len(extra) - 8))

    print('')
    if gaps:
        print('%s exist%s on live and NOT on Sydney. Read %s before cutting over:'
              % ('1 thing' if gaps == 1 else '%d things' % gaps, 's' if gaps == 1 else '',
                 'it' if gaps == 1 else 'each one'))
        print('a missing trigger or unique index does not fail loudly, it just stops protecting you.')
        sys.exit(1)
    print('Sydney has everything live has. Nothing disappears at cut-over.')

if __name__ == '__main__':
    main()
