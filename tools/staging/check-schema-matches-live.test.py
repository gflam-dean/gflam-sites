#!/usr/bin/env python3
"""THE TEST-DATABASE SCRIPTS, OFFLINE (INBOX 326, 12 Nov 2026). Nothing here connects to any database:
the network is switched off for the whole run, the fixtures are made up, and build-test-schema.sh only
writes files into a temp folder.

Checks:
  1. check-schema-matches-live.py: identical snapshots MATCH; every part, broken on purpose one at a
     time, goes red and names the part; swapped files go red; a skipped required part goes red;
     the repo-baselines form works; a bad file exits 2.
  2. --check-content: the real content list passes against the real COLUMNS-BASELINE.json; a list
     naming a table with people in it fails.
  3. The TEST lock: wipe, seed and guard.sql carry the SAME guard block, it is the first thing after
     "begin;", the wipe and marker headers say NEVER LIVE in capitals, and nothing in tools/staging
     names the live ref except as a thing to refuse.
  4. build-test-schema.sh: refuses a dump with rows, cleans what migrate-sydney.py had to clean,
     puts the guard first and extensions before tables, and --migrations joins files in number order.

Run: python3 tools/staging/check-schema-matches-live.test.py      Ends on "ALL N CHECKS PASSED".
"""
import copy, importlib.util, io, json, os, re, shutil, socket, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FX = os.path.join(HERE, 'fixtures')
spec = importlib.util.spec_from_file_location('csm', os.path.join(HERE, 'check-schema-matches-live.py'))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)
RAN, BAD = [0], [0]


def show(name, cond, saw=None):
    RAN[0] += 1
    if cond:
        print('  ok   ' + name)
    else:
        BAD[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: %s' % (saw,)))


def no_network(*a, **k):
    raise AssertionError('the test tried the network')
socket.socket.connect = no_network
socket.create_connection = no_network


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


LIVE = json.loads(read(os.path.join(FX, 'live-snapshot.json')))
TEST = json.loads(read(os.path.join(FX, 'test-snapshot.json')))


def run_compare(live, test):
    lines = []
    code, diffs = C.compare(live, test, out=lines.append)
    return code, diffs, '\n'.join(lines)


print('== 1. the schema check ==')
code, diffs, text = run_compare(LIVE, TEST)
show('identical shapes MATCH and exit 0', code == 0 and text.strip().endswith(')') and 'MATCH' in text, text)
show('all 16 parts were compared', 'in 16 parts' in text, text)

# Every part, broken on purpose: each must go red and name what differs.
BREAKS = {
    'rls':        lambda s: s['rls']['vp_members'].update(enabled=False),
    'policies':   lambda s: s['policies'].pop('vp_members.staff write'),
    'grants':     lambda s: s['grants'].append('vp_members anon SELECT'),
    'views':      lambda s: s['views'].append('v_vp_extra'),
    'security_definer_functions': lambda s: s['security_definer_functions']['vp_is_staff(v uuid)'].update(anon=True),
    'columns':    lambda s: s['columns']['vp_venues'].pop(),
    'functions':  lambda s: s['functions'].update({'vp_is_staff(v uuid)': 'ffffffffffffffffffffffffffffffff'}),
    'triggers':   lambda s: s['triggers'].clear(),
    'indexes':    lambda s: s['indexes'].clear(),
    'constraints': lambda s: s['constraints'].update({'vp_venues.vp_venues_pkey': 'PRIMARY KEY (slug)'}),
    'enums':      lambda s: s['enums']['vp_role'].pop(),
    'sequences':  lambda s: s['sequences'].clear(),
    'extensions': lambda s: s['extensions'].update(pgcrypto='1.2'),
    'realtime_publication': lambda s: s['realtime_publication'].clear(),
    'storage_buckets': lambda s: s['storage_buckets']['venue-logos'].update(public=False),
    'storage_policies': lambda s: s['storage_policies'].clear(),
}
show('every part has a break (none left blind)', set(BREAKS) == set(C.PARTS), sorted(set(C.PARTS) - set(BREAKS)))
for part, brk in BREAKS.items():
    t = copy.deepcopy(TEST)
    brk(t)
    code, diffs, text = run_compare(LIVE, t)
    show('broken %s goes red' % part, code == 1 and diffs and 'DOES NOT MATCH' in text, text[-200:])

t = copy.deepcopy(TEST); t['columns']['vp_members'][2][1] = 'integer:int4'
code, diffs, text = run_compare(LIVE, t)
show('a column whose TYPE differs goes red, and says which column', code == 1 and any('vp_members.member_number' in d for d in diffs), diffs)
t = copy.deepcopy(TEST); t['policies']['vp_venues.staff read']['using'] = 'true'
code, diffs, text = run_compare(LIVE, t)
show('a policy opened to everyone (USING true) goes red on both sides', code == 1 and any(d.startswith('ONLY ON TEST: policy vp_venues.staff read') for d in diffs), diffs)

code, diffs, text = run_compare(TEST, LIVE)
show('files swapped round go red (test file has no marker, live file has one)', code == 1 and 'no TEST marker' in text and 'carries a TEST marker' in text, text)
t = copy.deepcopy(TEST); t['staging_marker'] = 'ijkzgmdtwtgfkedqspxm'
code, diffs, text = run_compare(LIVE, t)
show('a "test" file marked with the live ref goes red', code == 1, text)
t = copy.deepcopy(TEST); del t['grants']
code, diffs, text = run_compare(LIVE, t)
show('a required part missing from one file is NOT a pass', code == 1 and 'NOT COMPARED' in text and 'required part' in text, text)
t = copy.deepcopy(TEST); del t['triggers']
code, diffs, text = run_compare(LIVE, t)
show('an optional part missing is said out loud (NOT COMPARED) but the rest can match', code == 0 and 'NOT COMPARED' in text and 'triggers' in text, text)

lines = []
rc = C.main(['--live-baselines', os.path.join(FX, 'rls-baseline.json'), os.path.join(FX, 'columns-baseline.json'),
             '--test', os.path.join(FX, 'test-snapshot.json')], out=lines.append)
show('against the repo baselines: MATCH on the five lock parts and column names', rc == 0 and 'in 6 parts' in lines[-1] and any('by NAME only' in l for l in lines), lines)
tmp = tempfile.mkdtemp()
try:
    t = copy.deepcopy(TEST); t['columns']['vp_venues'].append(['extra', 'text:text', 'YES', ''])
    p = os.path.join(tmp, 't.json'); open(p, 'w').write('\n' + json.dumps(t) + '\n\n')
    lines = []
    rc = C.main(['--live-baselines', os.path.join(FX, 'rls-baseline.json'), os.path.join(FX, 'columns-baseline.json'), '--test', p], out=lines.append)
    show('against the baselines, an extra test column goes red (and psql blank lines are fine)', rc == 1 and any('ONLY ON TEST: column vp_venues.extra' in l for l in lines), lines)
    p2 = os.path.join(tmp, 'bad.json'); open(p2, 'w').write('ERROR: permission denied')
    lines = []
    rc = C.main(['--live', os.path.join(FX, 'live-snapshot.json'), '--test', p2], out=lines.append)
    show('a file that is not JSON exits 2 and says so', rc == 2 and lines and lines[0].startswith('STOP'), lines)
    lines = []
    rc = C.main(['--live', os.path.join(FX, 'live-snapshot.json')], out=lines.append)
    show('no --test file exits 2 with the usage', rc == 2 and any('usage' in l for l in lines), lines)
    lines = []
    rc = C.main(['--live', os.path.join(FX, 'live-snapshot.json'), '--test'], out=lines.append)
    show('an option with no file name after it exits 2', rc == 2, lines)

    print('\n== 2. the content list ==')
    cols = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'COLUMNS-BASELINE.json')
    lines = []
    rc = C.main(['--check-content', os.path.join(HERE, 'content-tables.txt'), '--columns', cols], out=lines.append)
    show('the real content list passes against the real COLUMNS-BASELINE.json', rc == 0 and 'CONTENT LIST OK' in lines[-1], lines)
    show('it names the "who edited it" columns for a person to glance at', any(l.startswith('look: vp_help_faq.updated_by') for l in lines), lines)
    for table, col in (('vp_players', 'email'), ('vp_members', 'first_name'), ('vp_captures', 'mobile'), ('pp_licences', 'buyer_name'),
                       ('vp_signup_starts', 'ip_key'), ('vp_marketing_optins', 'unsubscribe_token')):
        bad = os.path.join(tmp, 'bad-%s.txt' % table); open(bad, 'w').write('vp_help_faq\n%s\n' % table)
        lines = []
        rc = C.main(['--check-content', bad, '--columns', cols], out=lines.append)
        show('a content list naming %s fails on %s' % (table, col), rc == 1 and any(('%s.%s' % (table, col)) in l for l in lines), lines)
    bad = os.path.join(tmp, 'nosuch.txt'); open(bad, 'w').write('vp_not_a_table\n')
    lines = []
    show('a table not in the columns file fails', C.main(['--check-content', bad, '--columns', cols], out=lines.append) == 1, lines)
    bad = os.path.join(tmp, 'empty.txt'); open(bad, 'w').write('# nothing\n')
    lines = []
    show('an empty list fails', C.main(['--check-content', bad, '--columns', cols], out=lines.append) == 1, lines)

    print('\n== 3. the TEST lock ==')
    def guard_of(text):
        m = re.search(r'-- VP-STAGING-GUARD-BEGIN\n.*?-- VP-STAGING-GUARD-END', text, re.S)
        return m.group(0) if m else None
    g = guard_of(read(os.path.join(HERE, 'guard.sql')))
    show('guard.sql has the guard block', g is not None and 'gpoolavkghnxedzrmtmc' in g and "'2026-10-01'" in g)
    for name in ('wipe-test-db.sql', 'seed-test-data.sql'):
        s = read(os.path.join(HERE, name))
        show('%s carries the SAME guard block as guard.sql' % name, guard_of(s) == g)
        body = re.sub(r'--[^\n]*', '', s).strip()
        show('%s: the guard is the first statement after "begin;"' % name, body.startswith('begin;') and body[len('begin;'):].strip().startswith('do $guard$'))
        show('%s ends in commit, so a refusal undoes everything' % name, body.rstrip().endswith('commit;'))
    for name in ('wipe-test-db.sql', '01-mark-this-as-test.sql', 'seed-test-data.sql'):
        head = read(os.path.join(HERE, name))[:800]
        show('%s header says RUN ONLY ON THE OLD PROJECT gpoolavkghnxedzrmtmc, NEVER LIVE' % name,
             'RUN ONLY ON THE OLD PROJECT gpoolavkghnxedzrmtmc' in head and 'NEVER LIVE' in head)
    w = read(os.path.join(HERE, 'wipe-test-db.sql'))
    show('the wipe refuses while Storage still has files', "select count(*) from storage.objects" in w and 'REFUSED' in w)
    show('the wipe never drops the marker schema', 'drop schema vp_staging' not in w.lower() and 'drop schema public cascade;' in w)
    m = read(os.path.join(HERE, '01-mark-this-as-test.sql'))
    show('the marker refuses until a name replaces CHANGE-ME', "who text := 'CHANGE-ME'" in m and "if who = 'CHANGE-ME'" in m)
    show('the marker table can only ever hold the old ref', "check (project_ref = 'gpoolavkghnxedzrmtmc')" in m)
    show('the marker refuses a database with real sign-ins since 1 Oct', "'2026-10-01'" in m and 'looks like the LIVE project' in m)
    for name in sorted(os.listdir(HERE)):
        p = os.path.join(HERE, name)
        if not os.path.isfile(p) or name.endswith('.test.py') or name == 'README.md':
            continue
        s = read(p)
        for line in s.splitlines():
            if 'ijkzgmdtwtgfkedqspxm' in line and not re.search(r'NEVER|refuse|names the LIVE|LIVE_REF|live project|LIVE project|IS ijkz|must NOT|does not name|On LIVE|read-only', line, re.I):
                show('%s names the live ref only to refuse it' % name, False, line.strip()[:120])
                break
        else:
            RAN[0] += 1
    sp = read(os.path.join(HERE, 'schema-snapshot.sql'))
    body = re.sub(r'--[^\n]*', '', sp)
    show('schema-snapshot.sql is read-only (read only transaction, rollback, no write words)',
         'begin transaction read only;' in body and body.strip().endswith('rollback;')
         and not re.search(r'\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b', body, re.I))
    lx = re.sub(r'--[^\n]*', '', read(os.path.join(HERE, 'live-extras.sql')))
    show('live-extras.sql only SELECTs (the write words are inside the text it prints)',
         'begin transaction read only;' in lx and lx.strip().endswith('rollback;')
         and all(l.strip().startswith(('select', 'from', 'where', 'order', "'", 'id,', 'case', 'array_to', 'policyname', 'begin', 'rollback', ')'))
                 or not l.strip() for l in lx.splitlines()))

    print('\n== 4. build-test-schema.sh (writes files only) ==')
    sh = os.path.join(HERE, 'build-test-schema.sh')
    env = dict(os.environ, HOME=tmp)
    out = os.path.join(tmp, 'out.sql')
    r = subprocess.run(['bash', sh, '--from-dump', os.path.join(FX, 'live-schema-dump.sql'),
                        '--extras', os.path.join(FX, 'live-extras-out.sql'), '--out', out], capture_output=True, text=True, env=env)
    show('from a schema dump it writes a file and says nothing was run', r.returncode == 0 and 'Nothing was run' in r.stdout, r.stderr)
    s = read(out) if os.path.exists(out) else ''
    body = re.sub(r'--[^\n]*', '', s).strip()
    show('the written file starts "begin;" then the TEST lock', body.startswith('begin;') and guard_of(s) == g and body[6:].strip().startswith('do $guard$'))
    show('it ends in commit', body.endswith('commit;'))
    show('CREATE SCHEMA public, supabase_admin default privileges, transaction_timeout and \\restrict are removed',
         'CREATE SCHEMA "public"' not in s and 'supabase_admin' not in s and 'transaction_timeout' not in s and '\\restrict' not in s and '\\unrestrict' not in s)
    show('the tables, row security and grants are kept', 'CREATE TABLE "public"."vp_venues"' in s and 'ENABLE ROW LEVEL SECURITY' in s and 'GRANT SELECT' in s)
    show('extensions come before the tables, buckets and realtime after',
         0 < s.find('create extension') < s.find('CREATE TABLE') < s.find('alter publication') and s.find('insert into storage.buckets') > s.find('CREATE TABLE'))
    rowsdump = os.path.join(tmp, 'rows.sql'); open(rowsdump, 'w').write(read(os.path.join(FX, 'live-schema-dump.sql')) + 'COPY "public"."vp_players" ("id") FROM stdin;\n')
    out2 = os.path.join(tmp, 'out2.sql')
    r = subprocess.run(['bash', sh, '--from-dump', rowsdump, '--out', out2], capture_output=True, text=True, env=env)
    show('a dump with ROWS in it is refused and nothing is written', r.returncode != 0 and 'ROWS' in r.stderr and not os.path.exists(out2), r.stderr)
    r = subprocess.run(['bash', sh, '--from-dump', os.path.join(FX, 'live-schema-dump.sql'), '--out', os.path.join(ROOT, 'x.sql')], capture_output=True, text=True, env=env)
    show('it refuses to write inside the repo', r.returncode != 0 and not os.path.exists(os.path.join(ROOT, 'x.sql')), r.stderr)
    out3 = os.path.join(tmp, 'out3.sql')
    r = subprocess.run(['bash', sh, '--migrations', '--from', '185', '--out', out3], capture_output=True, text=True, env=env)
    s3 = read(out3) if os.path.exists(out3) else ''
    nums = [int(n) for n in re.findall(r'-- FILE: venueplay-backend/supabase/venueplay-(\d+)-', s3)]
    show('--migrations --from 185 joins only 185 and up, in number order', r.returncode == 0 and nums and nums == sorted(nums) and min(nums) == 185, (r.stderr, nums))
    show('--migrations puts the TEST lock before the first file', guard_of(s3) == g and s3.find('VP-STAGING-GUARD-BEGIN') < s3.find('-- FILE:'))
    r = subprocess.run(['bash', sh, '--migrations', '--from', 'abc', '--out', out3], capture_output=True, text=True, env=env)
    show('--from with a non-number is refused', r.returncode != 0, r.stderr)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\n' + ('FAILED %d of %d' % (BAD[0], RAN[0]) if BAD[0] else 'ALL %d CHECKS PASSED' % RAN[0]))
sys.exit(1 if BAD[0] else 0)
