#!/usr/bin/env python3
"""RUN A tools/staging SQL FILE ON THE venueplay TEST DATABASE, AND NOWHERE ELSE.

    python3 tools/staging/run-on-test.py probe
    python3 tools/staging/run-on-test.py run tools/staging/01-mark-this-as-test.sql --who "main 14 Nov"
    python3 tools/staging/run-on-test.py run ~/.gflam-migrate/test-schema-dump.sql
    python3 tools/staging/run-on-test.py run ~/.gflam-migrate/test-schema-migrations.sql --per-file
    python3 tools/staging/run-on-test.py run tools/staging/seed-test-data.sql
    python3 tools/staging/run-on-test.py snapshot ~/.gflam-migrate/test-snapshot.json
    python3 tools/staging/run-on-test.py counts

For a Mac without psql (14 Nov 2026: Postgres.app is gone). Uses pg8000 (pure Python).

WHERE THE ADDRESS COMES FROM. ~/.gflam-migrate.env: TEST_SUPABASE_REF and TEST_DB_PASSWORD only (read
here, never printed, never written anywhere). The address is built in memory: the Sydney pooler
(user postgres.<ref>, session mode 5432) first, then the direct host db.<ref>.supabase.co.

THE RAILS, in this order, before ANY statement:
  1. the ref from the key file must be exactly the TEST ref (rkfaftxgzpsmmrzudlqy); the LIVE project
     ijkzgmdtwtgfkedqspxm is refused by name; TEST_SUPABASE_URL, if set, must name the TEST ref and not the live one;
  2. the host AND the user of every address it tries must contain the TEST ref and not the live ref
     (checked before a socket is opened);
  3. once connected, read only: current_database(), inet_server_addr(), and the same "is this alive?"
     questions 01-mark-this-as-test.sql asks (real sign-ins since 1 Oct 2026, venues or game sessions
     since 1 Oct 2026). Any of those = REFUSED, nothing run. If the marker exists it must name the
     TEST ref;
  4. a file that changes anything must carry the TEST guard block (guard.sql), so the database itself
     refuses too; 01-mark-this-as-test.sql is the one exception (it IS the marker) and needs --who;
     wipe-test-db.sql needs --i-mean-wipe; psql backslash commands are refused (not plain SQL).
Every file runs as one statement batch; a failure rolls that batch back. Logs row counts, never a
secret. Exit 0 ok, 1 refused or failed.
"""
import argparse
import json
import os
import re
import ssl
import sys
from pathlib import Path

TEST_REF = 'rkfaftxgzpsmmrzudlqy'
LIVE_REF = 'ijkzgmdtwtgfkedqspxm'
REGION = 'ap-southeast-2'
ENV_FILE = Path(os.environ.get('VP_STAGING_ENV_FILE') or (Path.home() / '.gflam-migrate.env'))
HERE = Path(__file__).resolve().parent
GUARD_BEGIN, GUARD_END = '-- VP-STAGING-GUARD-BEGIN', '-- VP-STAGING-GUARD-END'
SINCE = '2026-10-01'


class Refused(Exception):
    pass


def read_names(path=None, names=('TEST_SUPABASE_REF', 'TEST_DB_PASSWORD', 'TEST_SUPABASE_URL')):
    """Only the named TEST_ values; everything else in the key file is never even kept."""
    out = {}
    p = Path(path) if path else ENV_FILE
    if not p.exists():
        return out
    for line in p.read_text().splitlines():
        if '=' not in line or line.lstrip().startswith('#'):
            continue
        k, v = line.split('=', 1)
        k = k.strip()
        if k in names:
            out[k] = v.strip().strip('"').strip("'")
    return out


def target_problems(ref, host, user, supabase_url=''):
    """Every reason this address is not the TEST database. Empty list = allowed."""
    bad = []
    for label, val in (('ref', ref), ('host', host), ('user', user), ('TEST_SUPABASE_URL', supabase_url)):
        if LIVE_REF in (val or ''):
            bad.append('%s names the LIVE project' % label)
    if ref != TEST_REF:
        bad.append('the ref is not the TEST ref')
    if TEST_REF not in (host or '') and TEST_REF not in (user or ''):
        bad.append('neither host nor user names the TEST ref')
    if TEST_REF not in (user or ''):
        bad.append('the user does not name the TEST ref')
    if supabase_url and TEST_REF not in supabase_url:
        bad.append('TEST_SUPABASE_URL does not name the TEST ref')
    return bad


def candidates(ref):
    """(label, host, port, user). Pooler session mode first (IPv4), then direct (often IPv6 only)."""
    return [
        ('pooler aws-0 session', 'aws-0-%s.pooler.supabase.com' % REGION, 5432, 'postgres.%s' % ref),
        ('pooler aws-1 session', 'aws-1-%s.pooler.supabase.com' % REGION, 5432, 'postgres.%s' % ref),
        ('direct', 'db.%s.supabase.co' % ref, 5432, 'postgres.%s' % ref),
    ]


CA_FILE = Path(os.environ.get('VP_SUPABASE_CA') or (Path.home() / '.gflam-migrate' / 'supabase-ca.crt'))
CA_HELP = ('save Supabase\'s CA certificate (Supabase dashboard, the TEST project, Database settings, SSL Configuration, '
           'Download certificate) as %s, then run again')


def tls_context(ca_file=None):
    """FAILS CLOSED (14 Nov 2026, security review). Always checks the certificate chain AND the host name, never
    anything less. Supabase signs its database certificates with its own CA, which the Mac does not trust, so the
    CA file from the dashboard is needed (CA_FILE); without it the system trust store is used, still fully
    verified, and Supabase's certificate is refused (connect() then says where to save the file). The host name
    matches: the pooler's certificate is *.pooler.supabase.com, the direct host's is db.<ref>.supabase.co (both
    read by a no-password TLS probe, 14 Nov). TLS is set up before any password is sent, so a refused
    certificate means the password never leaves the Mac. Returns (context, CA file used or None)."""
    ca = Path(ca_file) if ca_file else CA_FILE
    have = ca.exists()
    ctx = ssl.create_default_context(cafile=str(ca)) if have else ssl.create_default_context()
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx, (str(ca) if have else None)


def connect(env=None, log=print, _connect=None):
    env = env if env is not None else read_names()
    ref = env.get('TEST_SUPABASE_REF', '')
    pw = env.get('TEST_DB_PASSWORD', '')
    url = env.get('TEST_SUPABASE_URL', '')
    first = target_problems(ref, 'db.%s.supabase.co' % ref, 'postgres.%s' % ref, url)
    if first:
        raise Refused('REFUSED before connecting: ' + '; '.join(first))
    if not pw:
        raise Refused('TEST_DB_PASSWORD is not in %s' % ENV_FILE)
    if _connect is None:
        import pg8000.native
        _connect = pg8000.native.Connection
    errors = []
    ctx, ca_used = tls_context()
    cert_refused = False
    for label, host, port, user in candidates(ref):
        bad = target_problems(ref, host, user, url)
        if bad:
            errors.append('%s refused: %s' % (label, '; '.join(bad)))
            continue
        try:
            conn = _connect(user=user, password=pw, host=host, port=port, database='postgres',
                            ssl_context=ctx, timeout=30,
                            application_name='vp-staging-run-on-test')
        except Exception as e:  # never print the exception args raw: they can echo the address
            if isinstance(e, ssl.SSLCertVerificationError) or 'CERTIFICATE_VERIFY_FAILED' in str(e):
                cert_refused = True
            msg = type(e).__name__ + ': ' + re.sub(r'password\S*', 'password=***', str(e))[:200]
            errors.append('%s (%s:%d): %s' % (label, host, port, msg))
            continue
        log('connected: %s, %s:%d as %s' % (label, host, port, user))
        return conn, label
    if cert_refused and not ca_used:
        raise Refused('REFUSED: the database certificate could not be verified and nothing was sent (no password). '
                      + CA_HELP % CA_FILE + '.\n  ' + '\n  '.join(errors))
    raise Refused('could not connect to TEST (certificate %s):\n  ' % ('checked against ' + ca_used if ca_used else 'checked against the system store')
                  + '\n  '.join(errors))


def q(conn, sql):
    return conn.run(sql)


def alive_checks(conn):
    """The questions 01-mark-this-as-test.sql asks, read only. Returns (problems, facts)."""
    facts, bad = {}, []
    db, addr, who, ver = q(conn, "select current_database(), coalesce(inet_server_addr()::text, ''), current_user, "
                                 "current_setting('server_version')")[0]
    facts.update(database=db, server_addr=addr, user=who, server_version=ver)
    n = q(conn, "select count(*) from auth.users where greatest(coalesce(last_sign_in_at, 'epoch'::timestamptz), "
                "coalesce(created_at, 'epoch'::timestamptz)) >= '%s' and not (coalesce(email, '') like "
                "'%%@example.invalid' or coalesce(phone, '') like '6149157%%')" % SINCE)[0][0]
    facts['real_signins_since_1_oct'] = n
    if n:
        bad.append('%d real sign-in(s) since 1 Oct 2026: this looks like LIVE' % n)
    has = lambda t: q(conn, "select to_regclass('%s') is not null" % t)[0][0]
    marker = has('vp_staging.vp_staging_marker')
    facts['marker'] = bool(marker)
    if has('public.vp_venues'):
        # 'stage-' venues are the staging pubs (seed-real-venues.py) and the staging sign-ups (real-venues-signup.py,
        # 16 Nov 2026). They count as TEST only where the marker already is: on a database with no marker every
        # non-test- venue still refuses.
        n = q(conn, "select count(*) from public.vp_venues where created_at >= '%s' and slug not like 'test-%%'%s"
                    % (SINCE, " and slug not like 'stage-%'" if marker else ''))[0][0]
        facts['real_venues_since_1_oct'] = n
        if n:
            bad.append('%d non-test venue(s) created since 1 Oct 2026: this looks like LIVE' % n)
    if has('public.vp_sessions') and not marker:
        n = q(conn, "select count(*) from public.vp_sessions where created_at >= '%s'" % SINCE)[0][0]
        if n:
            bad.append('%d game session(s) since 1 Oct 2026 and no marker: this looks like LIVE' % n)
    if marker:
        refs = [r[0] for r in q(conn, 'select project_ref from vp_staging.vp_staging_marker')]
        facts['marker_refs'] = refs
        if refs != [TEST_REF]:
            bad.append('the marker does not name exactly the TEST ref')
    return bad, facts


def file_problems(path, text, who=None, wipe_ok=False):
    name = Path(path).name
    bad = []
    if any(l.startswith('\\') for l in text.splitlines()):
        bad.append('it has psql backslash commands (\\restrict etc.): rebuild it with build-test-schema.sh')
    if name == '01-mark-this-as-test.sql':
        if not who or who == 'CHANGE-ME':
            bad.append('the marker needs --who "<your name>"')
        if "check (project_ref = '%s')" % TEST_REF not in text:
            bad.append('this marker file does not pin the TEST ref')
        return bad
    if name == 'schema-snapshot.sql':
        bad.append('schema-snapshot.sql is read only: use the snapshot command')
        return bad
    if name == 'wipe-test-db.sql' and not wipe_ok:
        bad.append('the wipe DESTROYS everything on TEST: add --i-mean-wipe')
    g = text.find(GUARD_BEGIN)
    if g < 0 or text.find(GUARD_END) < g:
        bad.append('no TEST guard block (guard.sql) in the file')
    else:
        block = text[g:text.find(GUARD_END)]
        if "project_ref = ''%s''" % TEST_REF not in block:
            bad.append('the guard block does not name the TEST ref')
    return bad


# NOT "end;": that is how a plpgsql block ends (14 Nov 2026: stripping it broke 24 files, each rolled back on its own).
INNER_TX = re.compile(r'^\s*(begin|commit|start transaction)\s*;\s*$', re.I | re.M)
CONCURRENTLY = re.compile(r'\bconcurrently\b', re.I)


def split_files(text):
    """A --migrations output: (guard block, [(file name, body)]). Inner begin/commit removed: each file
    runs as its own transaction, with the guard first."""
    g0, g1 = text.find(GUARD_BEGIN), text.find(GUARD_END)
    guard = text[g0:g1 + len(GUARD_END)]
    parts = re.split(r'^-- =+\n-- FILE: (\S+)\n-- =+\n', text[g1:], flags=re.M)
    out = []
    for i in range(1, len(parts), 2):
        out.append((parts[i], INNER_TX.sub('', parts[i + 1])))
    return guard, out


def run_batch(conn, sql):
    conn.notices.clear() if hasattr(conn, 'notices') else None
    try:
        q(conn, sql)
        ok, err = True, ''
    except Exception as e:
        ok, err = False, str(getattr(e, 'args', [''])[0] if getattr(e, 'args', None) else e)[:600]
        try:
            q(conn, 'rollback')
        except Exception:
            pass
    notes = [n.get(b'M', b'').decode() if isinstance(n, dict) else str(n) for n in list(getattr(conn, 'notices', []))]
    return ok, err, notes


COUNT_SQL = """
select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('public', 'vp_staging') order by 1"""


def counts(conn):
    rows = {}
    for (t,) in q(conn, COUNT_SQL):
        s, r = t.split('.', 1)
        rows[t] = q(conn, 'select count(*) from "%s"."%s"' % (s, r))[0][0]
    rows['auth.users'] = q(conn, 'select count(*) from auth.users')[0][0]
    rows['auth.identities'] = q(conn, 'select count(*) from auth.identities')[0][0]
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('probe')
    r = sub.add_parser('run'); r.add_argument('file'); r.add_argument('--who'); r.add_argument('--per-file', action='store_true')
    r.add_argument('--only', help='with --per-file: only these migration numbers, e.g. 80,82,192')
    r.add_argument('--i-mean-wipe', action='store_true')
    s = sub.add_parser('snapshot'); s.add_argument('out')
    sub.add_parser('counts')
    a = ap.parse_args(argv)

    text = None
    if a.cmd == 'run':
        text = Path(a.file).expanduser().read_text()
        bad = file_problems(a.file, text, a.who, a.i_mean_wipe)
        if bad:
            print('REFUSED (%s): %s. Nothing was run.' % (Path(a.file).name, '; '.join(bad)))
            return 1
    if a.cmd == 'snapshot':
        out = Path(a.out).expanduser().resolve()
        if str(out).startswith(str(HERE.parent.parent) + os.sep):
            print('REFUSED: write the snapshot outside the repo (e.g. ~/.gflam-migrate/). Nothing was run.')
            return 1
    try:
        conn, label = connect()
        bad, facts = alive_checks(conn)
    except Refused as e:
        print(e); return 1
    print('TEST facts: ' + json.dumps(facts, default=str))
    if bad:
        print('REFUSED: ' + '; '.join(bad) + '. Nothing was run.'); conn.close(); return 1
    rc = 0
    if a.cmd == 'probe':
        print('PROBE OK: the TEST database answers, nothing was changed.')
    elif a.cmd == 'counts':
        q(conn, 'set default_transaction_read_only = on')
        for t, n in counts(conn).items():
            print('  %-50s %d' % (t, n))
    elif a.cmd == 'snapshot':
        q(conn, 'set default_transaction_read_only = on')
        rows = q(conn, (HERE / 'schema-snapshot.sql').read_text())
        line = rows[-1][0] if rows else ''
        line = line if isinstance(line, str) else json.dumps(line)
        json.loads(line)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(line + '\n')
        print('SNAPSHOT written: %s (%d bytes)' % (out, len(line)))
    elif a.cmd == 'run':
        name = Path(a.file).name
        if name == '01-mark-this-as-test.sql':
            text = text.replace("who text := 'CHANGE-ME';", "who text := '%s';" % a.who.replace("'", "''"), 1)
        if a.per_file:
            guard, files = split_files(text)
            okn = 0
            if a.only:
                want = set(x.strip() for x in a.only.split(','))
                files = [(fn, b) for fn, b in files
                         if re.sub(r'^.*venueplay-(\d+)-.*$', r'\1', fn) in want or any(w and w in fn for w in want)]
            for fname, body in files:
                if CONCURRENTLY.search(re.sub(r'(?m)--.*$', '', body)):
                    # CREATE INDEX CONCURRENTLY cannot run in a transaction: the guard runs first on its own,
                    # then each statement on its own (a file like this holds one index and nothing else).
                    ok, err, notes = run_batch(conn, guard)
                    for stmt in [x for x in re.sub(r'(?m)--.*$', '', body).split(';') if x.strip()]:
                        if ok:
                            ok, err, notes = run_batch(conn, stmt)
                else:
                    ok, err, notes = run_batch(conn, 'begin;\n' + guard + '\n' + body + '\ncommit;')
                okn += ok
                print('  %s %s%s' % ('OK    ' if ok else 'FAILED', fname, '' if ok else ': ' + err.replace('\n', ' ')))
            print('%d of %d migration file(s) applied; each failed file was rolled back on its own' % (okn, len(files)))
            rc = 0 if okn == len(files) else 1
        else:
            ok, err, notes = run_batch(conn, text)
            for n in notes:
                print('  notice: ' + n)
            print(('DONE %s' % name) if ok else ('FAILED %s (rolled back): %s' % (name, err)))
            rc = 0 if ok else 1
        try:
            for t, n in counts(conn).items():
                if n:
                    print('  rows %-46s %d' % (t, n))
        except Exception as e:
            print('  (counts unavailable: %s)' % type(e).__name__)
    conn.close()
    return rc


if __name__ == '__main__':
    sys.exit(main())
