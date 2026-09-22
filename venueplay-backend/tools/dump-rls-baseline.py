#!/usr/bin/env python3
"""THE LIVE DATABASE'S LOCKS, WRITTEN DOWN, AND CHECKED AGAINST.

    python3 venueplay-backend/tools/dump-rls-baseline.py            rewrite the baseline from live
    python3 venueplay-backend/tools/dump-rls-baseline.py --check    live must match the baseline

The browser reads and writes vp_members, vp_venue_staff, vp_venues and more straight from the
user's token, so row-level security is the only wall between two venues. Yet no file in this
repo created those policies: the live database was rebuilt from a schema dump and the Sydney
relock was a hand-typed list (audit, 20 Sep 2026). This asks Postgres itself, for every table
in public: is RLS on, every policy (command, roles, USING, WITH CHECK), every grant to anon
and authenticated, and every view and SECURITY DEFINER function those two roles can reach,
and writes venueplay-backend/supabase/RLS-BASELINE.json. --check reads the same and names
every difference, so a policy dropped by hand in the dashboard turns the live gate red.

Read-only. Needs NEW_DB_URL in ~/.gflam-migrate.env and the pg8000 package
(python3 -m pip install --user pg8000). Never prints the URL.
"""
import io, json, os, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'RLS-BASELINE.json')

Q = {
    'rls': "select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace "
           "where n.nspname='public' and c.relkind='r' order by 1",
    'policies': "select tablename, policyname, cmd, permissive, array_to_string(roles, ','), coalesce(qual,''), coalesce(with_check,'') "
                "from pg_policies where schemaname='public' order by 1,2",
    'grants': "select table_name, grantee, privilege_type from information_schema.role_table_grants "
              "where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3",
    'views': "select table_name from information_schema.views where table_schema='public' order by 1",
    'secdef': "select p.proname, pg_get_function_identity_arguments(p.oid), "
              "  has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute') "
              "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef order by 1,2",
}


def connect():
    env = {}
    try:
        for l in open(os.path.expanduser('~/.gflam-migrate.env')):
            l = l.strip()
            if '=' in l and not l.startswith('#'):
                k, v = l.split('=', 1); env[k] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    url = env.get('NEW_DB_URL')
    if not url:
        print('STOP: NEW_DB_URL is not in ~/.gflam-migrate.env, so this cannot ask the database.'); sys.exit(1)
    try:
        import pg8000.native
    except ImportError:
        print('STOP: the pg8000 package is not installed. Run: python3 -m pip install --user pg8000'); sys.exit(1)
    u = urllib.parse.urlparse(url)
    return pg8000.native.Connection(user=urllib.parse.unquote(u.username or ''), password=urllib.parse.unquote(u.password or ''),
                                    host=u.hostname, port=u.port or 5432, database=u.path.lstrip('/'), ssl_context=True)


def snapshot():
    con = connect()
    try:
        con.run("set transaction read only")
        out = {}
        out['rls'] = {r[0]: {'enabled': bool(r[1]), 'forced': bool(r[2])} for r in con.run(Q['rls'])}
        out['policies'] = {'%s.%s' % (r[0], r[1]): {'cmd': r[2], 'permissive': r[3], 'roles': r[4], 'using': r[5], 'with_check': r[6]}
                           for r in con.run(Q['policies'])}
        out['grants'] = sorted('%s %s %s' % (r[0], r[1], r[2]) for r in con.run(Q['grants']))
        out['views'] = sorted(r[0] for r in con.run(Q['views']))
        out['security_definer_functions'] = {'%s(%s)' % (r[0], r[1]): {'anon': bool(r[2]), 'authenticated': bool(r[3])} for r in con.run(Q['secdef'])}
        return out
    finally:
        con.close()


def flatten(snap):
    """One line per fact, so two snapshots diff as sets of sentences."""
    lines = set()
    for t, v in snap['rls'].items():
        lines.add('rls %s enabled=%s forced=%s' % (t, v['enabled'], v['forced']))
    for k, v in snap['policies'].items():
        lines.add('policy %s cmd=%s permissive=%s roles=%s using=%s check=%s' % (k, v['cmd'], v['permissive'], v['roles'], v['using'], v['with_check']))
    for g in snap['grants']:
        lines.add('grant ' + g)
    for vw in snap['views']:
        lines.add('view ' + vw)
    for k, v in snap['security_definer_functions'].items():
        lines.add('secdef %s anon=%s authenticated=%s' % (k, v['anon'], v['authenticated']))
    return lines


def main():
    live = snapshot()
    if '--check' in sys.argv:
        try:
            base = json.load(io.open(OUT, encoding='utf-8'))
        except Exception:
            print('FAIL: no baseline at %s. Run this tool without --check to write one.' % os.path.relpath(OUT, ROOT)); return 1
        a, b = flatten(base), flatten(live)
        gone, new = sorted(a - b), sorted(b - a)
        off = sorted(t for t, v in live['rls'].items() if not v['enabled'])
        for t in off:
            print('FAIL: row security is OFF on public.%s' % t)
        for l in gone:
            print('FAIL: in the baseline, not live: ' + l[:160])
        for l in new:
            print('FAIL: live, not in the baseline: ' + l[:160])
        if off or gone or new:
            print('%d difference(s). If the live change was deliberate, rewrite the baseline and commit it: that diff is the record.' % (len(off) + len(gone) + len(new)))
            return 1
        print('PASS: live matches the baseline. %d tables, %d policies, %d grants, %d views, %d security definer functions.'
              % (len(live['rls']), len(live['policies']), len(live['grants']), len(live['views']), len(live['security_definer_functions'])))
        return 0
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(live, fh, indent=1, sort_keys=True); fh.write('\n')
    print('wrote %s: %d tables (RLS off on %d), %d policies, %d grants to anon/authenticated, %d views, %d security definer functions'
          % (os.path.relpath(OUT, ROOT), len(live['rls']), sum(1 for v in live['rls'].values() if not v['enabled']),
             len(live['policies']), len(live['grants']), len(live['views']), len(live['security_definer_functions'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
