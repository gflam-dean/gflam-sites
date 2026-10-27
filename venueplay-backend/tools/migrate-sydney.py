#!/usr/bin/env python3
"""Move every Gflam business off the Singapore Supabase project and onto Sydney.

WHY. The database was created in Southeast Asia (Singapore). Every request from
the Sydney Cloudflare Worker made three or four round trips there, 150 to 300ms
each, so a TV asking "what is on?" took over half a second at rest and a bingo
ball took 1.3 seconds. Load testing on 8 Sep 2026 bent at 172 requests a second,
which is the polling floor for 5,000 venues before any game runs. Sydney puts the
database next to the Worker.

Credentials live ONLY in ~/.gflam-migrate.env (chmod 600, outside the repo).
This script reads them and never prints one. Anything it prints is a count, a
hostname or a table name.

Run in this order, each step refusing to continue if the one before it did not:

  python3 migrate-sydney.py check      read-only: tools, both projects, baseline
  python3 migrate-sydney.py dump       read-only on Singapore: schema + data + auth + storage policies
  python3 migrate-sydney.py restore    WRITES to Sydney (refuses if Sydney is not empty)
  python3 migrate-sydney.py storage    copies bucket files Singapore -> Sydney
  python3 migrate-sydney.py verify     row counts, functions, policies, users, files: old vs new
  python3 migrate-sydney.py rewrite    the repo: old ref + anon key -> new (dry run unless --write)
  python3 migrate-sydney.py checklist  what Dean must paste into Cloudflare and the dashboard

On cut-over day, after the games have stopped:

  python3 migrate-sydney.py dump       again, so the copy is tonight's data
  python3 migrate-sydney.py refresh    empties Sydney's DATA (keeps its schema, so migrations
                                       applied only on Sydney survive) and loads the fresh dump;
                                       --dry-run only reports what it would empty
  python3 migrate-sydney.py storage    again; files already on Sydney at the same size are skipped
  python3 migrate-sydney.py verify     must say ALL MATCH before anything else moves

Nothing here writes to Singapore. It is left exactly as it was, as the rollback.
"""
import os, sys, re, json, base64, subprocess, shutil, urllib.request, urllib.error, mimetypes, time
from pathlib import Path

ENV_FILE = Path.home() / '.gflam-migrate.env'
WORK = Path.home() / '.gflam-migrate'          # dumps live here, never in the repo
REPO = Path(__file__).resolve().parents[2]      # .../sites
PG_BIN_CANDIDATES = [
    '/Applications/Postgres.app/Contents/Versions/latest/bin',
    '/opt/homebrew/opt/libpq/bin', '/opt/homebrew/bin', '/usr/local/bin',
]

def die(msg):
    print('\n  STOP: ' + msg); sys.exit(1)

def load_env():
    if not ENV_FILE.exists(): die(f'{ENV_FILE} is missing')
    mode = oct(ENV_FILE.stat().st_mode)[-3:]
    if mode != '600': die(f'{ENV_FILE} is mode {mode}; run: chmod 600 {ENV_FILE}')
    env = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); env[k.strip()] = v.strip().strip('"').strip("'")
    need = ['OLD_DB_URL', 'OLD_SERVICE_KEY', 'NEW_DB_URL', 'NEW_SUPABASE_URL', 'NEW_ANON_KEY', 'NEW_SERVICE_KEY']
    missing = [k for k in need if not env.get(k)]
    if missing: die('empty lines in the env file: ' + ', '.join(missing))
    for k in ('OLD_DB_URL', 'NEW_DB_URL'):
        if 'YOUR-PASSWORD' in env[k]: die(f'{k} still has the [YOUR-PASSWORD] placeholder in it')
    # The pooler username is postgres.<project ref>, which is how we learn each ref
    # without ever printing the URL.
    def ref_of(url):
        m = re.match(r'postgres(?:ql)?://postgres\.([a-z]{20}):', url)
        if not m: die('a DB URL is not a Supabase pooler URI (user should be postgres.<ref>)')
        return m.group(1)
    env['OLD_REF'] = ref_of(env['OLD_DB_URL'])
    env['NEW_REF'] = ref_of(env['NEW_DB_URL'])
    env['OLD_SUPABASE_URL'] = f"https://{env['OLD_REF']}.supabase.co"
    if env['NEW_REF'] not in env['NEW_SUPABASE_URL']:
        die('NEW_DB_URL and NEW_SUPABASE_URL are for different projects')
    if env['OLD_REF'] == env['NEW_REF']: die('OLD and NEW are the same project')
    env['OLD_HOST'] = f"{env['OLD_REF']}.supabase.co"
    env['NEW_HOST'] = f"{env['NEW_REF']}.supabase.co"
    return env

def pg_bin():
    for d in PG_BIN_CANDIDATES:
        if Path(d, 'pg_dump').exists() and Path(d, 'psql').exists(): return d
    p = shutil.which('pg_dump')
    return str(Path(p).parent) if p else None

def skip_dir(p):
    return '.git' in p.parts or 'worktrees' in p.parts or 'node_modules' in p.parts

# The sites repo, plus the team workspace above it: the HQ dashboard, the skills,
# CLAUDE.md and the design docs all name the project too. The workspace's own
# .claude/skills ARE wanted; the repo's .claude/worktrees (other checkouts) are not.
WORKSPACE = REPO.parent
def walk_all():
    for p in WORKSPACE.rglob('*'):
        if skip_dir(p): continue
        if REPO in p.parents and '.claude' in p.relative_to(REPO).parts: continue
        yield p
def rel(p):
    return str(p.relative_to(WORKSPACE))

def run(cmd, env_extra=None, input_text=None, quiet=False):
    """Run a pg tool. The DB URL travels as an argument; stdout/stderr are shown
    with any URL redacted so a tool error can never echo the password."""
    e = dict(os.environ); e.update(env_extra or {})
    r = subprocess.run(cmd, env=e, input=input_text, capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    out = re.sub(r'postgres(?:ql)?://\S+', '<db-url>', out)
    if not quiet and out.strip(): print('    ' + out.strip().replace('\n', '\n    ')[:4000])
    return r.returncode, out

def psql(url, sql, tuples=True):
    cmd = [PG + '/psql', url, '-v', 'ON_ERROR_STOP=1', '-X', '-q']
    if tuples: cmd += ['-t', '-A', '-F', '\t']
    cmd += ['-c', sql]
    rc, out = run(cmd, quiet=True)
    if rc != 0: die('psql failed: ' + re.sub(r'postgres(?:ql)?://\S+', '<db-url>', out).strip()[:800])
    return [l for l in out.splitlines() if l.strip()]

def rest(base, key, path, method='GET', body=None, headers=None, raw=False, timeout=60):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key}
    h.update(headers or {})
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)): data = bytes(body)
        else: data = json.dumps(body).encode(); h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(base + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
            return r.status, dict(r.headers), (b if raw else (json.loads(b) if b else None))
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()[:300].decode(errors='replace')

# ---------------------------------------------------------------- inventory
def public_tables(base, key):
    st, _, spec = rest(base, key, '/rest/v1/')
    if st != 200 or not isinstance(spec, dict): die(f'cannot read {base}: HTTP {st}')
    return sorted(spec.get('definitions', {}).keys()), [p for p in spec.get('paths', {}) if p.startswith('/rpc/')]

def row_counts(base, key, names):
    out = {}
    for n in names:
        st, h, _ = rest(base, key, f'/rest/v1/{n}?select=*&limit=1', 'HEAD',
                        headers={'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0'})
        cr = h.get('Content-Range', '') or h.get('content-range', '')
        out[n] = int(cr.split('/')[1]) if '/' in cr and cr.split('/')[1] != '*' else None
    return out

def auth_users(base, key):
    users, page = [], 1
    while True:
        st, _, d = rest(base, key, f'/auth/v1/admin/users?page={page}&per_page=1000')
        if st != 200: die(f'auth admin list failed: HTTP {st}')
        got = d.get('users', d if isinstance(d, list) else [])
        users += got
        if len(got) < 1000: break
        page += 1
    return users

def list_objects(base, key, bucket, prefix=''):
    files = []
    offset = 0
    while True:
        st, _, items = rest(base, key, f'/storage/v1/object/list/{bucket}', 'POST',
                            {'prefix': prefix, 'limit': 1000, 'offset': offset,
                             'sortBy': {'column': 'name', 'order': 'asc'}})
        if st != 200: die(f'listing {bucket}/{prefix}: HTTP {st}')
        for it in items:
            path = (prefix + '/' if prefix else '') + it['name']
            if it.get('id') is None: files += list_objects(base, key, bucket, path)   # a folder
            else: files.append({'path': path, 'size': (it.get('metadata') or {}).get('size', 0),
                                'mime': (it.get('metadata') or {}).get('mimetype')})
        if len(items) < 1000: break
        offset += 1000
    return files

def buckets(base, key):
    st, _, b = rest(base, key, '/storage/v1/bucket')
    if st != 200: die(f'bucket list failed: HTTP {st}')
    return b

def db_object_counts(url):
    """How many of each kind of thing sit in the public schema. Compared old vs new."""
    q = """select 'tables', count(*) from pg_tables where schemaname='public'
    union all select 'views', count(*) from pg_views where schemaname='public'
    union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all select 'policies', count(*) from pg_policies where schemaname='public'
    union all select 'storage policies', count(*) from pg_policies where schemaname='storage'
    union all select 'triggers', count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
    union all select 'indexes', count(*) from pg_indexes where schemaname='public'
    union all select 'sequences', count(*) from pg_sequences where schemaname='public'
    union all select 'rls enabled tables', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity
    union all select 'auth users', count(*) from auth.users
    union all select 'auth identities', count(*) from auth.identities
    union all select 'storage objects', count(*) from storage.objects"""
    return {k: int(v) for k, v in (l.split('\t') for l in psql(url, q))}

# ---------------------------------------------------------------- steps
def step_check(env):
    print('\nCHECK (read-only)')
    global PG
    PG = pg_bin()
    print(f"  Postgres tools: {'found at ' + PG if PG else 'NOT INSTALLED (install Postgres.app from postgresapp.com, open it once)'}")
    if PG:
        rc, out = run([PG + '/pg_dump', '--version'], quiet=True); print('  ' + out.strip())
    print(f"  old project ref {env['OLD_REF']}  (Singapore)")
    print(f"  new project ref {env['NEW_REF']}  (Sydney)")
    old_t, old_f = public_tables(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'])
    new_t, new_f = public_tables(env['NEW_SUPABASE_URL'], env['NEW_SERVICE_KEY'])
    print(f"  old REST: {len(old_t)} tables/views, {len(old_f)} functions exposed")
    print(f"  new REST: {len(new_t)} tables/views, {len(new_f)} functions exposed" + ('   <- EMPTY, good' if not new_t else '   <- NOT EMPTY'))
    ou = auth_users(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'])
    print(f"  old auth users: {len(ou)} ({sum(1 for u in ou if u.get('phone'))} phone, {sum(1 for u in ou if u.get('email'))} email)")
    for b in buckets(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY']):
        fs = list_objects(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'], b['id'])
        print(f"  old bucket {b['id']:<14} public={b['public']!s:<5} {len(fs):>4} files, {sum(f['size'] for f in fs)/1e6:.1f} MB")
    if PG:
        for label, url in (('old', env['OLD_DB_URL']), ('new', env['NEW_DB_URL'])):
            t0 = time.time(); v = psql(url, 'show server_version')[0]; dt = time.time() - t0
            print(f"  {label} DB connects: Postgres {v.strip()}  ({dt:.2f}s round trip from here)")
        oc = db_object_counts(env['OLD_DB_URL'])
        print('  old DB holds: ' + ', '.join(f'{v} {k}' for k, v in oc.items()))
    WORK.mkdir(mode=0o700, exist_ok=True)
    counts = row_counts(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'], old_t)
    (WORK / 'old-row-counts.json').write_text(json.dumps(counts, indent=1))
    print(f"  baseline saved: {sum(c for c in counts.values() if isinstance(c, int)):,} rows over {len(counts)} tables/views -> {WORK}/old-row-counts.json")

def step_dump(env):
    print('\nDUMP (read-only on Singapore)')
    global PG
    PG = pg_bin() or die('Postgres tools not installed')
    WORK.mkdir(mode=0o700, exist_ok=True)
    old = env['OLD_DB_URL']
    # 1. schema: tables, views, functions, triggers, policies, grants, sequences, indexes, comments
    rc, _ = run([PG + '/pg_dump', old, '--schema-only', '--schema=public', '--no-owner',
                 '--no-comments' if False else '--quote-all-identifiers', '-f', str(WORK / 'schema.sql')])
    if rc: die('schema dump failed')
    s = (WORK / 'schema.sql').read_text()
    # pg_dump 18 writes CREATE SCHEMA "public", which every Supabase project already
    # has; the restore would stop on its first statement.
    s2 = re.sub(r'^CREATE SCHEMA "public";\n', '', s, flags=re.M)
    # Likewise the "default privileges" Supabase's own admin role sets on every project:
    # they are already there on Sydney and only supabase_admin may set them.
    s2 = re.sub(r'^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" .*\n', '', s2, flags=re.M)
    if s2 != s: (WORK / 'schema.sql').write_text(s2); s = s2; print('  dropped CREATE SCHEMA public and supabase_admin default privileges (already on Sydney)')
    print(f"  schema.sql: {len(s):,} bytes, {s.count('CREATE TABLE')} tables, {s.count('CREATE POLICY')} policies, {s.count('CREATE FUNCTION') + s.count('CREATE OR REPLACE FUNCTION')} functions, {s.count('CREATE TRIGGER')} triggers, {s.count('CREATE VIEW') + s.count('CREATE OR REPLACE VIEW')} views")
    # 2. data for public
    rc, _ = run([PG + '/pg_dump', old, '--data-only', '--schema=public', '--no-owner', '--quote-all-identifiers',
                 '-f', str(WORK / 'data.sql')])
    if rc: die('data dump failed')
    d = (WORK / 'data.sql').read_text()
    tables_with_old_host, cur = set(), None
    for line in d.splitlines():
        if line.startswith('COPY '): cur = line.split('"')[3]
        elif env['OLD_HOST'] in line and cur: tables_with_old_host.add(cur)
    tables_with_old_host = sorted(tables_with_old_host)
    print(f"  data.sql: {len(d)/1e6:.1f} MB, {d.count('COPY ')} tables of rows")
    print(f"  tables holding a URL on the old host (rewritten after restore): {', '.join(tables_with_old_host) or 'none'}")
    (WORK / 'tables-with-old-host.json').write_text(json.dumps(tables_with_old_host))
    # 3. auth users + identities, only the columns BOTH projects have (auth schema versions can differ)
    for tbl in ('users', 'identities'):
        q = f"select column_name from information_schema.columns where table_schema='auth' and table_name='{tbl}' and is_generated='NEVER' order by ordinal_position"
        oc = [l.strip() for l in psql(old, q)]
        nc = [l.strip() for l in psql(env['NEW_DB_URL'], q)]
        cols = [c for c in oc if c in nc]
        skipped = [c for c in oc if c not in nc]
        (WORK / f'auth-{tbl}.cols').write_text('\n'.join(cols))
        collist = ', '.join(f'"{c}"' for c in cols)
        rc, out = run([PG + '/psql', old, '-X', '-q', '-v', 'ON_ERROR_STOP=1',
                       '-c', f"\\copy (select {collist} from auth.{tbl}) to '{WORK}/auth-{tbl}.tsv'"], quiet=True)
        if rc: die(f'auth.{tbl} export failed: ' + out[:400])
        n = sum(1 for _ in open(WORK / f'auth-{tbl}.tsv'))
        print(f"  auth.{tbl}: {n} rows, {len(cols)} columns" + (f" (old-only columns skipped: {', '.join(skipped)})" if skipped else ''))
    # 4. storage: bucket definitions and the policies on storage.objects
    bl = buckets(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'])
    (WORK / 'buckets.json').write_text(json.dumps(bl, indent=1))
    pol = psql(old, "select policyname, cmd, array_to_string(roles, ','), coalesce(qual,''), coalesce(with_check,'') from pg_policies where schemaname='storage' and tablename='objects' order by policyname")
    lines = []
    for l in pol:
        name, cmd, roles, qual, chk = l.split('\t')
        stmt = f'create policy "{name}" on storage.objects for {cmd.lower()} to {roles}'
        if qual and cmd != 'INSERT': stmt += f' using ({qual})'
        if chk and cmd in ('INSERT', 'UPDATE', 'ALL'): stmt += f' with check ({chk})'
        lines.append(stmt + ';')
    (WORK / 'storage-policies.sql').write_text('\n'.join(lines) + '\n')
    print(f"  buckets: {', '.join(b['id'] for b in bl)}; storage policies: {len(lines)}")
    print(f"  dump written under {WORK} (mode 700, outside the repo)")

def step_restore(env, force=False):
    print('\nRESTORE (writes to Sydney)')
    global PG
    PG = pg_bin() or die('Postgres tools not installed')
    new = env['NEW_DB_URL']
    for f in ('schema.sql', 'data.sql', 'auth-users.tsv', 'auth-identities.tsv', 'storage-policies.sql'):
        if not (WORK / f).exists(): die(f'{f} missing; run dump first')
    nc = db_object_counts(new)
    if (nc['tables'] or nc['auth users']) and not force:
        die(f"Sydney is not empty ({nc['tables']} tables, {nc['auth users']} auth users). Reset it in the dashboard, or pass --force to restore on top")
    # schema, all or nothing
    rc, out = run([PG + '/psql', new, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', str(WORK / 'schema.sql')])
    if rc: die('schema restore failed (nothing was kept: single transaction)')
    c = db_object_counts(new)
    print(f"  schema in: {c['tables']} tables, {c['views']} views, {c['functions']} functions, {c['policies']} policies, {c['triggers']} triggers")
    # data with triggers and FK checks off for the load; falls back to disabling triggers per table
    rc, out = run([PG + '/psql', new, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
                   '-c', 'set session_replication_role = replica', '-f', str(WORK / 'data.sql')])
    if rc: die('data restore failed (nothing was kept: single transaction)')
    print('  data in')
    for tbl in ('users', 'identities'):
        cols = (WORK / f'auth-{tbl}.cols').read_text().split()
        collist = ', '.join(f'"{c}"' for c in cols)
        rc, out = run([PG + '/psql', new, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
                       '-c', 'set session_replication_role = replica',
                       '-c', f"\\copy auth.{tbl} ({collist}) from '{WORK}/auth-{tbl}.tsv'"])
        if rc: die(f'auth.{tbl} restore failed')
    print(f"  auth users in: {db_object_counts(new)['auth users']}")
    if (WORK / 'storage-policies.sql').read_text().strip():
        rc, out = run([PG + '/psql', new, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', str(WORK / 'storage-policies.sql')])
        if rc: die('storage policies failed')
        print('  storage policies in')
    rewrite_stored_urls(env)
    print('  restore done')

def rewrite_stored_urls(env):
    """Slide images, logos and the like are stored as full URLs on the old host inside
    text and json columns. Point them at Sydney, table by table, and say how many."""
    new = env['NEW_DB_URL']
    q = f"""select table_name, column_name, data_type from information_schema.columns
            where table_schema='public' and data_type in ('text','character varying','jsonb','json')
            and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE')"""
    total = 0
    for l in psql(new, q):
        t, col, typ = l.split('\t')
        if typ in ('jsonb', 'json'):
            upd = f"""update public."{t}" set "{col}" = replace("{col}"::text, '{env['OLD_HOST']}', '{env['NEW_HOST']}')::{typ} where "{col}"::text like '%{env['OLD_HOST']}%'"""
        else:
            upd = f"""update public."{t}" set "{col}" = replace("{col}", '{env['OLD_HOST']}', '{env['NEW_HOST']}') where "{col}" like '%{env['OLD_HOST']}%'"""
        n = psql(new, f"with u as ({upd} returning 1) select count(*) from u")[0]
        if int(n): print(f"  rewrote {n} URL(s) in {t}.{col}"); total += int(n)
    print(f"  {total} stored URLs now point at Sydney")

def step_refresh(env, dry=False):
    """Cut-over day: Sydney already has the schema (plus whatever migrations went on only
    there, like 71), the auth users and the files. What is stale is the DATA, because
    venues kept trading while we tested. So: empty every public table and every auth
    user, load tonight's dump, repoint stored URLs. The load-test venues go with it,
    which is right: nothing pretend belongs on the project a venue is about to use."""
    print('\nREFRESH Sydney data from the latest dump' + (' (DRY RUN: reports only)' if dry else ''))
    global PG
    PG = pg_bin() or die('Postgres tools not installed')
    new = env['NEW_DB_URL']
    for f in ('data.sql', 'auth-users.tsv', 'auth-identities.tsv'):
        if not (WORK / f).exists(): die(f'{f} missing; run dump first')
    age_min = (time.time() - (WORK / 'data.sql').stat().st_mtime) / 60
    print(f"  dump age: {age_min:.0f} minutes" + ('  (older than an hour: run dump again first, or you will load stale data)' if age_min > 60 else ''))
    tables = [l.strip() for l in psql(new, "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")]
    dumped = set(re.findall(r'^COPY "public"\."([^"]+)"', (WORK / 'data.sql').read_text(), flags=re.M))
    only_new = sorted(set(tables) - dumped)
    before = db_object_counts(new)
    print(f"  Sydney now: {before['tables']} tables, {before['auth users']} auth users; dump carries rows for {len(dumped)} tables")
    if only_new: print(f"  tables on Sydney the dump does not carry (emptied, stay empty): {', '.join(only_new)}")
    can = psql(new, "select has_table_privilege('auth.users','DELETE'), has_table_privilege('auth.identities','DELETE')")[0]
    if 'f' in can.split('\t'): die('this role may not delete auth users on Sydney; reset the project in the dashboard instead')
    if dry:
        print(f"  would empty {len(tables)} public tables and {before['auth users']} auth users, then load the dump and repoint stored URLs")
        return
    if age_min > 60: die('dump is older than an hour; run dump again first')
    tl = ', '.join(f'public."{t}"' for t in tables)
    rc, _ = run([PG + '/psql', new, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
                 '-c', 'set session_replication_role = replica',
                 '-c', f'truncate {tl} restart identity cascade',
                 '-f', str(WORK / 'data.sql')])
    if rc: die('refresh of public data failed (nothing was kept: single transaction)')
    print(f"  public data replaced from the dump")
    for tbl in ('users', 'identities'):
        cols = (WORK / f'auth-{tbl}.cols').read_text().split()
        collist = ', '.join(f'"{c}"' for c in cols)
        rc, out = run([PG + '/psql', new, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
                       '-c', 'set session_replication_role = replica',
                       # DELETE BOTH, EXPLICITLY. This used to delete auth.users only and
                       # leave identities to the ON DELETE CASCADE. That cascade never fires
                       # here: the line above sets session_replication_role = replica, which
                       # switches foreign key triggers OFF, which is the whole point of it for
                       # the data load. So the old identities survived, the COPY hit
                       # "duplicate key value violates unique constraint identities_pkey", and
                       # the refresh stopped with the public data already replaced and auth
                       # half done. Found by rehearsing the move on 10 Sep 2026 rather than on
                       # the morning. Order does not matter with the triggers off, and users is
                       # reloaded before identities is touched either way.
                       '-c', f'delete from auth.{tbl}',
                       '-c', f"\\copy auth.{tbl} ({collist}) from '{WORK}/auth-{tbl}.tsv'"])
        if rc: die(f'auth.{tbl} refresh failed')
    print(f"  auth users in: {db_object_counts(new)['auth users']}")
    rewrite_stored_urls(env)
    print('  refresh done; now run storage, then verify')

def step_storage(env):
    print('\nSTORAGE (copies files Singapore -> Sydney)')
    ob, ok_ = env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY']
    nb, nk = env['NEW_SUPABASE_URL'], env['NEW_SERVICE_KEY']
    have = {b['id'] for b in buckets(nb, nk)}
    for b in buckets(ob, ok_):
        if b['id'] not in have:
            body = {'id': b['id'], 'name': b['name'], 'public': b['public']}
            if b.get('file_size_limit'): body['file_size_limit'] = b['file_size_limit']
            if b.get('allowed_mime_types'): body['allowed_mime_types'] = b['allowed_mime_types']
            st, _, r = rest(nb, nk, '/storage/v1/bucket', 'POST', body)
            if st not in (200, 201): die(f"creating bucket {b['id']}: HTTP {st} {r}")
            print(f"  bucket {b['id']} created (public={b['public']})")
        files = list_objects(ob, ok_, b['id'])
        there = {f['path']: f['size'] for f in list_objects(nb, nk, b['id'])}
        done = bad = skipped = 0; bytes_ = 0
        for f in files:
            if there.get(f['path']) == f['size']: skipped += 1; continue
            st, h, data = rest(ob, ok_, f"/storage/v1/object/{b['id']}/{f['path']}", raw=True)
            if st != 200: print(f"    could not read {f['path']}: HTTP {st}"); bad += 1; continue
            ctype = f['mime'] or h.get('Content-Type') or mimetypes.guess_type(f['path'])[0] or 'application/octet-stream'
            st, _, r = rest(nb, nk, f"/storage/v1/object/{b['id']}/{f['path']}", 'POST', data,
                            headers={'Content-Type': ctype, 'x-upsert': 'true'})
            if st not in (200, 201): print(f"    could not write {f['path']}: HTTP {st} {r}"); bad += 1; continue
            done += 1; bytes_ += len(data)
        print(f"  {b['id']}: {done} of {len(files)} files copied ({bytes_/1e6:.1f} MB), {skipped} already there" + (f", {bad} FAILED" if bad else ''))
        if bad: die('not every file copied; run storage again')

def step_verify(env):
    print('\nVERIFY (old vs new)')
    global PG
    PG = pg_bin() or die('Postgres tools not installed')
    oc, nc = db_object_counts(env['OLD_DB_URL']), db_object_counts(env['NEW_DB_URL'])
    bad = 0
    for k in oc:
        same = oc[k] == nc[k]
        if not same: bad += 1
        print(f"  {'ok  ' if same else 'DIFF'} {k:<20} old {oc[k]:>7}  new {nc[k]:>7}")
    old_t, _ = public_tables(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'])
    orc = row_counts(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'], old_t)
    nrc = row_counts(env['NEW_SUPABASE_URL'], env['NEW_SERVICE_KEY'], old_t)
    diffs = [(t, orc[t], nrc.get(t)) for t in old_t if orc[t] != nrc.get(t)]
    print(f"  row counts: {len(old_t)} tables/views compared, {len(diffs)} differ" +
          (' (old counted before the freeze may have moved on; re-run dump+restore if a live table differs)' if diffs else ''))
    for t, a, b in diffs[:40]: print(f"    DIFF {t:<32} old {a!s:>7} new {b!s:>7}"); bad += 1
    for b in buckets(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY']):
        of = {f['path']: f['size'] for f in list_objects(env['OLD_SUPABASE_URL'], env['OLD_SERVICE_KEY'], b['id'])}
        nf = {f['path']: f['size'] for f in list_objects(env['NEW_SUPABASE_URL'], env['NEW_SERVICE_KEY'], b['id'])}
        missing = [p for p in of if p not in nf]
        sized = [p for p in of if p in nf and of[p] != nf[p]]
        ok = not missing and not sized
        if not ok: bad += 1
        print(f"  {'ok  ' if ok else 'DIFF'} bucket {b['id']:<14} old {len(of)} files, new {len(nf)}" + (f", missing {len(missing)}, size differs {len(sized)}" if not ok else ''))
    left = psql(env['NEW_DB_URL'], f"""select count(*) from storage.objects where name like '%{env['OLD_HOST']}%'""")[0]
    print(f"\n  {'ALL MATCH' if not bad else str(bad) + ' DIFFERENCE(S) - do not cut over'}")
    return bad == 0

def old_anon_key():
    """The anon key is printed in 72 pages. Find it by decoding: a JWT whose payload
    says ref = the old project and role = anon."""
    found = {}
    for p in REPO.rglob('*'):
        if p.is_file() and p.suffix in ('.html', '.js') and not skip_dir(p):
            for m in re.finditer(r'eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+', p.read_text(errors='ignore')):
                try:
                    pay = json.loads(base64.urlsafe_b64decode(m.group(1) + '=' * (-len(m.group(1)) % 4)))
                except Exception: continue
                if pay.get('role') == 'anon': found[m.group(0)] = pay.get('ref')
    return found

def check_new_anon_key(env):
    """NEW_ANON_KEY is what every page will carry. Two shapes are valid: the new
    publishable key (sb_publishable_...), which is checked by asking the new project's
    API to accept it; or a legacy anon JWT, checked by decoding it. Anything else dies."""
    k = env['NEW_ANON_KEY']
    if k.startswith('sb_publishable_'):
        # not /rest/v1/ itself: the API description is secret-key only. A table read is
        # what a page does, and it answers 200 (possibly an empty list) with a good key.
        st, _, _ = rest(env['NEW_SUPABASE_URL'], k, '/rest/v1/vp_venues?select=id&limit=1')
        if st != 200: die(f'NEW_ANON_KEY (publishable) is not accepted by the new project: HTTP {st}')
        return 'publishable key'
    if k.startswith('eyJ') and k.count('.') == 2:
        seg = k.split('.')[1]
        try: pay = json.loads(base64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4)))
        except Exception: die('NEW_ANON_KEY is not a readable key')
        if pay.get('ref') != env['NEW_REF'] or pay.get('role') != 'anon':
            die('NEW_ANON_KEY is not the anon key of the new project')
        return 'legacy anon JWT'
    die('NEW_ANON_KEY is neither a publishable key (sb_publishable_...) nor an anon JWT')

def step_rewrite(env, write=False):
    print('\nREWRITE the repo' + ('' if write else ' (dry run; add --write to change files)'))
    keys = old_anon_key()
    old_keys = [k for k, ref in keys.items() if ref == env['OLD_REF']]
    others = {ref for k, ref in keys.items() if ref != env['OLD_REF']}
    if others: print(f"  note: anon keys for other projects also present: {', '.join(sorted(others))} (left alone)")
    if not old_keys: die('could not find the old anon key in any page')
    print(f'  new key in the pages: {check_new_anon_key(env)}')
    me = Path(__file__).resolve()
    changed = []
    for p in sorted(walk_all()):
        if not p.is_file() or p == me: continue
        # Worker files only name the old project in comments, and changing a byte of a
        # Worker means re-stamping and re-pasting it. Their real setting is SUPABASE_URL
        # in Cloudflare, which the checklist covers. Left alone on purpose.
        if 'worker' in p.parts and p.suffix == '.js': continue
        try: s = p.read_text()
        except Exception: continue
        n = s.replace(env['OLD_REF'], env['NEW_REF'])
        for k in old_keys: n = n.replace(k, env['NEW_ANON_KEY'])
        if n != s:
            changed.append((rel(p), s.count(env['OLD_REF']), sum(s.count(k) for k in old_keys)))
            if write: p.write_text(n)
    for name, r, k in changed: print(f"  {'wrote' if write else 'would change'} {name}  ({r} ref, {k} key)")
    print(f"  {len(changed)} files" + ('' if write else ' would change'))
    if write:
        leftover = [rel(p) for p in walk_all() if p.is_file() and p != me and env['OLD_REF'] in p.read_text(errors='ignore')]
        print(f"  files still naming the old project: {len(leftover)}" + (': ' + ', '.join(leftover[:10]) if leftover else ''))

def step_checklist(env):
    print(f"""
CUT-OVER CHECKLIST (do in this order, during a window with no games running)

  A. Sydney dashboard, Authentication:
     1. Sign In / Providers -> Phone: ON, provider as before; Email: ON if it was.
     2. Hooks -> Send SMS hook: Enable, HTTPS, URL of the venueplay-sms-hook Worker.
        Copy the new hook secret (v1,whsec_...); the base64 part goes into that Worker as SEND_SMS_HOOK_SECRET.
     3. URL Configuration -> Site URL and Redirect URLs: same values as the old project
        (open the old project's page beside it and copy).
     4. Rate limits / OTP expiry: 5 minutes, same as before.

  B. Cloudflare Workers, Settings -> Variables (change ONLY these; leave Stripe, Resend, Mobile Message alone):
     venueplay-game        SUPABASE_URL = {env['NEW_SUPABASE_URL']}
                           SUPABASE_SERVICE_KEY = (Sydney Project Settings -> API Keys -> Secret key, sb_secret_...)
                           SUPABASE_JWT_SECRET  = DELETE this variable. Sydney has no legacy JWT secret;
                                                  both Workers check host logins with the project's public keys.
     venueplay-api         SUPABASE_URL, SUPABASE_SERVICE_KEY; delete SUPABASE_JWT_SECRET  (same as above)
     partyplay-api         SUPABASE_URL, SUPABASE_SERVICE_KEY
     touring-api           SUPABASE_URL, SUPABASE_SERVICE_KEY
     venueplay-sms-hook    SEND_SMS_HOOK_SECRET  (from A2)
     Each Worker restarts itself when a variable is saved; check /health on each afterwards
     (the game Worker's /health says host_login: "public keys only" when the secret is gone).
     Code goes in with tools/deploy-worker.py --live, never by paste.

  C. The sites: `python3 {Path(__file__).name} rewrite --write`, run the gate, commit, push to main.
     Pages go live within a minute or two. TVs pick up the new pages on their next reload
     (HQ -> reload screens). Hosts will be signed out once and sign in again by SMS.

  D. Prove it live: host sign-in by SMS, The Mini Bar TV shows its slides and code,
     start and end a bingo game on The Mini Bar, run the ramp again against the Worker.

  E. Rollback if anything is wrong: revert the commit (old pages) and put the three
     old values back in the Workers (and SUPABASE_JWT_SECRET, which Singapore still needs).
     Singapore has not been touched.

  F. A week later, when nothing has come up: rotate the old project's service key,
     then pause or delete the Singapore project.
""")

if __name__ == '__main__':
    PG = None
    args = sys.argv[1:]
    if not args or args[0] not in ('check', 'dump', 'restore', 'storage', 'verify', 'rewrite', 'checklist', 'refresh'):
        print(__doc__); sys.exit(2)
    env = load_env()
    step = args[0]
    if step == 'check': step_check(env)
    elif step == 'dump': step_dump(env)
    elif step == 'restore': step_restore(env, force='--force' in args)
    elif step == 'storage': step_storage(env)
    elif step == 'verify': sys.exit(0 if step_verify(env) else 1)
    elif step == 'rewrite': step_rewrite(env, write='--write' in args)
    elif step == 'checklist': step_checklist(env)
    elif step == 'refresh': step_refresh(env, dry='--dry-run' in args)
