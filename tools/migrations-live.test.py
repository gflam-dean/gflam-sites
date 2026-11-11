#!/usr/bin/env python3
"""tools/check-migrations-live.py, with a FAKE database: no network, no key.

INBOX 217 (Dean, 11 Nov 2026): every migration a release adds must already be live before the
push. The tool reads each new migration for what it creates and asks the live database. This
proves the reading and the verdicts against a fake that answers the way PostgREST does
(404 PGRST205 for a missing table, 400 42703 for a missing column, the /rest/v1/ schema document
for functions), so a mutation that breaks the parser or the judgement turns this red.

    python3 tools/migrations-live.test.py
"""
import importlib.util, io, json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('cml', os.path.join(ROOT, 'tools', 'check-migrations-live.py'))
cml = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cml)

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  PASS  %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL  %s%s' % (label, ('  (%s)' % str(detail)[:300]) if detail else ''))


class FakeDb:
    """tables: {name: set(columns)}; rpcs: set(names); rows: {table: n rows}. Records every path asked."""
    def __init__(self, tables, rpcs=(), rows=None, broken=False):
        self.tables, self.rpcs, self.rows, self.broken, self.asked = tables, set(rpcs), rows or {}, broken, []

    def __call__(self, path, accept='application/json'):
        self.asked.append(path)
        if self.broken:
            return 500, b'{"message":"upstream"}'
        if path == '':
            return 200, json.dumps({'paths': dict([('/' + t, {}) for t in self.tables] +
                                                  [('/rpc/' + f, {}) for f in self.rpcs])}).encode()
        table, _, query = path.partition('?')
        if table not in self.tables:
            return 404, b'{"code":"PGRST205","message":"Could not find the table"}'
        sel = ''
        for kv in query.split('&'):
            if kv.startswith('select='):
                sel = kv[len('select='):]
        for c in [c for c in sel.split(',') if c and c != '*']:
            if c not in self.tables[table]:
                return 400, json.dumps({'code': '42703', 'message': 'column %s.%s does not exist' % (table, c)}).encode()
        return 200, json.dumps([{}] * min(1, self.rows.get(table, 0))).encode()


def judge_sql(sql, get, num=999):
    d = tempfile.mkdtemp(prefix='mlive-test-')
    try:
        rel = 'venueplay-backend/supabase/venueplay-%03d-test.sql' % num
        os.makedirs(os.path.join(d, os.path.dirname(rel)))
        io.open(os.path.join(d, rel), 'w', encoding='utf-8').write(sql)
        return cml.judge(d, [(num, rel)], get)[0]
    finally:
        shutil.rmtree(d, ignore_errors=True)


def real(n):
    import glob
    f = glob.glob(os.path.join(ROOT, 'venueplay-backend', 'supabase', 'venueplay-%03d-*.sql' % n))
    return io.open(f[0], encoding='utf-8').read() if f else ''


print('\nReading what a migration creates')
p = cml.parse(real(184))
ok('184: create table vp_help_blocklist with its columns, the seed insert seen as data',
   'vp_help_blocklist' in p['tables'] and {'kind', 'value', 'reason'} <= set(p['tables']['vp_help_blocklist'])
   and 'insert' in p['kinds'], p)
p = cml.parse(real(141))
ok('141: the two columns added inside a DO block, and the view',
   ('vp_subscribers', 'postcode') in p['columns'] and ('vp_subscribers', 'au_state') in p['columns']
   and 'v_vp_subscribers_monthly' in p['views'], p)
p = cml.parse(real(117))
ok('117: an alter table split over two lines still names its column',
   ('vp_venue_screen', 'raffles') in p['columns'] and ('vp_raffle_prizes', 'raffle_id') in p['columns'], p['columns'])
p = cml.parse(real(174))
ok('174: upper-case ALTER TABLE ... ADD COLUMN IF NOT EXISTS, and ADD CONSTRAINT is not a column',
   p['columns'] == [('vp_players', 'consent_version'), ('vp_captures', 'consent_version')], p['columns'])
p = cml.parse("-- alter table public.vp_x add column in_a_comment text;\n"
              "comment on table public.vp_y is 'alter table vp_z add column in_a_string int;';\n"
              "/* create table public.vp_ghost (a int); */\n")
ok('a statement inside a comment or a string is not read as one',
   not p['columns'] and not p['tables'], p)
p = cml.parse('create table public.vp_new (id uuid primary key, venue_id uuid, constraint c unique (venue_id));\n'
              'alter table public.vp_new add column venue_id uuid;\n'
              'alter table vp_old rename column a to b;\n')
asks = cml.plan(p)
ok('a constraint line is not a column, and a column of a table made in the same file is asked once',
   p['tables']['vp_new'] == ['id', 'venue_id'] and [a[0] for a in asks] == ['table vp_new', 'column vp_old.b'], asks)
p = cml.parse('create or replace function public.vp_do_thing(a int) returns int language sql as $$ select 1 $$;\n'
              'create function vp_guard() returns trigger language plpgsql as $$ begin return new; end $$;\n'
              'create table storage.other (a int);\n')
ok('a function is asked by name, a trigger function and another schema are said and not asked',
   p['functions'] == ['vp_do_thing'] and any('vp_guard' in u for u in p['unseen']) and p['outside'] == ['storage.other'], p)

print('\nThe verdicts, against a fake database')
live = FakeDb({'vp_help_blocklist': {'id', 'kind', 'value', 'reason', 'blocked_by', 'from_ticket_no', 'created_at'},
               'vp_venues': {'id', 'name'}}, rpcs={'vp_do_thing'}, rows={'vp_venues': 3})
n, good, line = judge_sql(real(184), live, 184)
ok('184 on a database that has the table: green, says live', good and 'Migration 184 is live' in line, line)
gone = FakeDb({'vp_venues': {'id'}})
n, good, line = judge_sql(real(184), gone, 184)
ok('184 on a database without the table: RED, "Migration 184 is not live yet: Dean runs it first"',
   not good and line.startswith('Migration 184 is not live yet: Dean runs it first') and 'vp_help_blocklist' in line, line)
n, good, line = judge_sql('alter table public.vp_venues add column zz_not_real text;', live)
ok('a made-up column: RED, names the column',
   not good and 'is not live yet: Dean runs it first' in line and 'vp_venues.zz_not_real' in line, line)
n, good, line = judge_sql('-- NOT RUN: Dean runs this\nalter table public.vp_venues add column name text;', live)
ok('a column that is there is green whatever the NOT RUN comment says', good, line)
n, good, line = judge_sql('alter table public.vp_venues add column name text;', FakeDb({}, broken=True))
ok('a database that answers 500: RED, never "live"', not good and 'could not be confirmed live' in line, line)
n, good, line = judge_sql('alter table public.vp_venues add column name text;', None)
ok('no key in the env file: RED, says why', not good and 'NEW_SERVICE_KEY' in line, line)
n, good, line = judge_sql('create or replace function public.vp_do_thing() returns int language sql as $$ select 1 $$;', live)
ok('a function in the live schema document: green', good, line)
n, good, line = judge_sql('create or replace function public.vp_not_there() returns int language sql as $$ select 1 $$;', live)
ok('a function missing from the live schema document: RED', not good and 'function vp_not_there()' in line, line)
ok('...and no function was CALLED: only the schema document and selects were asked',
   all(not a.startswith('rpc/') for a in live.asked), live.asked)
n, good, line = judge_sql('drop policy if exists p on vp_venues;\ncreate policy p on vp_venues for select using (true);\n'
                          'create index if not exists i on vp_venues (name);', live)
ok('policy and index only: "cannot be probed (policy/index only)", not failed',
   good and 'cannot be probed (policy/index only)' in line, line)
n, good, line = judge_sql("update public.vp_venues set name = 'x' where name = 'y';", live)
ok('a data-only update with no row guard: "cannot be probed (data change only", not failed',
   good and 'cannot be probed (data change only' in line, line)

print('\nA guarded data update is compared with the live row (INBOX 246)')


class FakeRows:
    """{table: {id: {col: value}}}: answers GET T?select=a,b&id=eq.X the way PostgREST does."""
    def __init__(self, data, broken=False):
        self.data, self.broken, self.asked = data, broken, []

    def __call__(self, path, accept='application/json'):
        self.asked.append(path)
        if self.broken:
            return 500, b'{"message":"upstream"}'
        table, _, query = path.partition('?')
        if table not in self.data:
            return 404, b'{"code":"PGRST205"}'
        q = dict(kv.split('=', 1) for kv in query.split('&') if '=' in kv)
        rid = cml.urllib.parse.unquote(q.get('id', '')[3:])
        sel = q.get('select', '').split(',')
        row = self.data[table].get(rid)
        return 200, json.dumps([dict((c, row.get(c)) for c in sel)] if row else []).encode()


import re as _re
FAQ = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b'
SENTENCE = ('If your free month ends with no card on your account, your games pause. Your TV keeps showing your ads '
            'and nothing is lost. Adding a card switches everything back on.')
w113 = cml.guards(real(113))
W113 = [g for g in w113 if g['key'][1] == FAQ][0]['sets']['answer']
W106 = [g for g in w113 if g['key'][1] == FAQ][0]['guard']['answer']
g162 = cml.guards(real(162))
ok('162 is read as ONE guarded update of vp_help_faq %s, guarded on answer' % FAQ[:8],
   len(g162) == 1 and g162[0]['table'] == 'vp_help_faq' and g162[0]['key'] == ('id', FAQ)
   and list(g162[0]['guard']) == ['answer'], g162)
ok("162's guard is migration 113's words (the live words), not 106's",
   g162 and g162[0]['guard']['answer'] == W113 and W113 != W106, g162 and g162[0]['guard']['answer'][:80])
ok("162 sets 113's words plus Dean's sentence, appended once at the end, and the grace is not in it",
   g162 and g162[0]['sets']['answer'] == W113 + ' ' + SENTENCE and g162[0]['sets']['answer'].count(SENTENCE) == 1
   and not _re.search(r'grace|5[- ]day|five days', g162[0]['sets']['answer'], _re.I), g162 and g162[0]['sets'])


def run162(answer):
    """Postgres-free run of 162 against one row: the update (only on the guard's exact words), then the
    DO block's check (raises unless the row now holds the new words). (answer after, raised)."""
    g = g162[0]
    if answer == g['guard']['answer']:
        answer = g['sets']['answer']
    s, lits = cml._lits(real(162))
    do = _re.search(r'\bdo\s+\$\$(.*?)\$\$', s, _re.S | _re.I)
    want = [lits[int(t)] for t in _re.findall(r'and\s+answer\s*=\s*__LIT(\d+)__', do.group(1))] if do else []
    raised = not (want and answer == want[0])
    return answer, raised and 'raise exception' in (do.group(1) if do else '')


a1, r1 = run162(W113)
a2, r2 = run162(a1)
ok('run against the live words (113): the sentence is appended, no raise', a1 == W113 + ' ' + SENTENCE and not r1, (a1[-80:], r1))
ok('run twice: still appended once, no raise', a2 == a1 and a2.count(SENTENCE) == 1 and not r2, (a2.count(SENTENCE), r2))
a3, r3 = run162(W106)
ok("run against words HQ or another migration changed (106's): nothing changes and it RAISES", a3 == W106 and r3, r3)

n, good, line = judge_sql(real(162), FakeRows({'vp_help_faq': {FAQ: {'answer': W113}}}), 162)
ok('162 against a live row holding 113\'s words: green, "matches live"', good and 'matches live' in line, line)
n, good, line = judge_sql(real(162), FakeRows({'vp_help_faq': {FAQ: {'answer': W113 + ' ' + SENTENCE}}}), 162)
ok('162 against a live row it has already changed: green, "already applied live"', good and 'already applied live' in line, line)
old162 = real(162).replace(W113.replace("'", "''") + "';", W106.replace("'", "''") + "';", 1)
n, good, line = judge_sql(old162, FakeRows({'vp_help_faq': {FAQ: {'answer': W113}}}), 162)
ok('THE FIRST 162 (guarded on 106\'s words) against the live 113 row: RED "Migration 162 guard no longer matches live: rewrite it"',
   not good and line.startswith('Migration 162 guard no longer matches live: rewrite it'), line)
n, good, line = judge_sql(real(162), FakeRows({'vp_help_faq': {}}), 162)
ok('a guarded update whose row is gone: RED', not good and 'guard no longer matches live' in line, line)
n, good, line = judge_sql(real(162), FakeRows({}, broken=True), 162)
ok('a database that answers 500 on the guard: RED, never green', not good and 'could not be compared' in line, line)
n, good, line = judge_sql(real(162), None, 162)
ok('no key: a guarded update is RED, says why', not good and 'NEW_SERVICE_KEY' in line, line)
fk = FakeRows({'vp_help_faq': {FAQ: {'answer': W113}}})
judge_sql(real(162), fk, 162)
ok('the guard is asked with one read-only select of the guard column by id', fk.asked == [
   'vp_help_faq?select=answer&id=eq.' + FAQ], fk.asked)
n, good, line = judge_sql('-- live-probe: vp_venues?select=id&limit=1\nupdate vp_venues set name = name;', live)
ok('a documented live-probe that finds a row: green', good and 'probe vp_venues' in line, line)
n, good, line = judge_sql('-- live-probe: vp_help_blocklist?select=id&limit=1\ninsert into vp_help_blocklist (kind) values (1);', live)
ok('a documented live-probe that finds no row: RED', not good and 'no row' in line, line)
n, good, line = judge_sql('-- live-probe: rpc/vp_do_thing\nupdate vp_venues set name = name;', live)
ok('a live-probe may not call a function: RED, nothing called', not good and all(not a.startswith('rpc/') for a in live.asked), line)

print('\nThe key is never printed')
d = tempfile.mkdtemp(prefix='mlive-env-')
try:
    sentinel = 'TESTKEY' + 'x' * 20 + 'notreal'
    envf = os.path.join(d, 'env')
    io.open(envf, 'w').write('# comment\nNEW_SUPABASE_URL=http://127.0.0.1:9\nNEW_SERVICE_KEY="%s"\n' % sentinel)
    get = cml.live_getter(cml.read_env(envf))
    n, good, line = judge_sql('alter table public.vp_venues add column name text;', get)
    ok('a database that cannot be reached is RED, and the line does not carry the key',
       not good and sentinel not in line and 'could not be confirmed live' in line, line.replace(sentinel, '<KEY>'))
    ok('an env file without both values gives no getter at all', cml.live_getter({'NEW_SUPABASE_URL': 'x'}) is None)
finally:
    shutil.rmtree(d, ignore_errors=True)

print('\nWhich migrations are new (a throwaway git repo, never this checkout)')
for k in [k for k in os.environ if k.startswith('GIT_')]:
    os.environ.pop(k)
g = tempfile.mkdtemp(prefix='mlive-git-')
try:
    def git(*a):
        return subprocess.run(['git', '-C', g] + list(a), capture_output=True, text=True)
    sup = os.path.join(g, 'venueplay-backend', 'supabase')
    os.makedirs(sup)
    io.open(os.path.join(sup, 'venueplay-100-old.sql'), 'w').write('select 1;\n')
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'release')
    io.open(os.path.join(sup, 'venueplay-100-old.sql'), 'a').write('-- edited, already on main\n')
    io.open(os.path.join(sup, 'venueplay-101-new.sql'), 'w').write('select 1;\n')
    io.open(os.path.join(sup, 'MIGRATIONS.md'), 'w').write('notes\n')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'branch')
    io.open(os.path.join(sup, 'venueplay-102-untracked.sql'), 'w').write('select 1;\n')
    got, err = cml.new_migrations(g, 'main')
    ok('added on the branch and new on disk count; an edit to one main has, and a non-migration, do not',
       not err and [x[0] for x in got] == [101, 102], (got, err))
    got, err = cml.new_migrations(g, 'no-such-ref')
    ok('a base git cannot find is an error, never "no new migration"', bool(err) and got == [], (got, err))
finally:
    shutil.rmtree(g, ignore_errors=True)

print('\nWired in: the release refuses before it pushes, and the gate asks')
import re
rel = io.open(os.path.join(ROOT, 'tools', 'release.py'), encoding='utf-8').read()
i, j = rel.find("'tools/check-migrations-live.py', '--base', remote_before"), rel.find("step(1, 'push")
blk = rel[i:j] if 0 <= i < j else ''
ok('release.py asks check-migrations-live.py against the remote main BEFORE step 1 (the push) and stops on red',
   bool(blk) and re.search(r"if r\.returncode != 0:\s*\n\s*stop\(", blk) is not None, (i, j))
gate = io.open(os.path.join(ROOT, 'tools', 'release-check.py'), encoding='utf-8').read()
k = gate.find("head('D55. Every migration this release adds is already live')")
g = gate[k:gate.find("head('D20.", k)] if k >= 0 else ''
ok('the gate (D55, the local half the pre-push hook runs) runs it and is red unless every line passed',
   "'check-migrations-live.py'" in g and 'rc == 0 and not bad' in g and "m.group(1) == m.group(2)" in g
   and "startswith('FAIL')" in g, g[:120])

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 40
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
