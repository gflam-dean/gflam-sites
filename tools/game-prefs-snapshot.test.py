#!/usr/bin/env python3
"""THE GAME SETTINGS SNAPSHOT AND ITS ONE-STEP RESTORE, WITH A FAKE DATABASE (INBOX 128, Dean 7 Nov 2026).
Nothing live is read: the real network is switched off and every read goes to a fake PostgREST that honours limit
and offset and caps a page below the size asked for, the way Supabase's max-rows does.

The restore is PROVEN, not read: the SQL it writes is applied to the fake database by a small interpreter that
understands exactly that one statement shape (anything else in the file fails the test), after the settings have
been changed, added to and wiped, and --check must then say every venue is identical to the snapshot.

Run: python3 tools/game-prefs-snapshot.test.py      Ends on "ALL N CHECKS PASSED".
"""
import copy, datetime, importlib.util, json, os, re, shutil, sys, tempfile, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('gps', os.path.join(ROOT, 'tools', 'game-prefs-snapshot.py'))
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)
RAN, BAD = [0], [0]


def show(name, cond, saw=None):
    RAN[0] += 1
    if cond:
        print('  ok   ' + name)
    else:
        BAD[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: %s' % (saw,)))


def no_network(*a, **k):
    raise AssertionError('the test tried the real network')
urllib.request.urlopen = no_network

KEY = 'k' + 'ey-' + 'x' * 30
IDS = ['%08d-0000-0000-0000-000000000000' % i for i in range(1, 9)]
VENUES = [{'id': IDS[i], 'name': 'Venue %d' % (i + 1), 'slug': 'v%d' % (i + 1)} for i in range(8)]
VENUES[2]['name'] = "O'Reilly's"
SETTINGS = [
    {'venue_id': IDS[0], 'game_prefs': {'trivia': {'rounds': 4, 'speed_bonus': False, 'prizes': ["Nan's hamper", '$50 bar tab']}, 'musical': {'reveal': 'instant'}}},
    {'venue_id': IDS[1], 'game_prefs': {'raffle': {'draw_style': '', 'draw_time': 'long'}, 'members': {'draw_style': 'race'}}},
    {'venue_id': IDS[2], 'game_prefs': {'bingo': {'ticket_kind': 'paper', 'prize': 'Say "hi" \\ and win'}}},
    {'venue_id': IDS[3], 'game_prefs': {}},
    {'venue_id': IDS[4], 'game_prefs': None},
    {'venue_id': IDS[5], 'game_prefs': {'trivia': {'rounds': 3}}},
]   # venues 7 and 8 have no settings row


class FakeRest:
    def __init__(self, tables, max_rows=3, fail=None):
        self.tables, self.max_rows, self.fail, self.paths = tables, max_rows, fail, []

    def __call__(self, path):
        self.paths.append(path)
        t, _, q = path.partition('?')
        if self.fail and self.fail(t, path):
            return 500, b'{"message":"boom"}'
        qs = dict(urllib.parse.parse_qsl(q))
        rows = list(self.tables.get(t, []))
        col, _, way = qs.get('order', '').partition('.')
        if col:
            rows.sort(key=lambda r: r.get(col) or '', reverse=(way == 'desc'))
        off, lim = int(qs.get('offset', 0)), int(qs.get('limit', 10 ** 9))
        rows = rows[off:off + min(lim, self.max_rows)]
        sel = qs.get('select', '*').split(',')
        return 200, json.dumps([{k: r.get(k) for k in sel} for r in rows]).encode()


def apply_sql(sql, settings):
    """Run the restore file against the fake settings table. Only the one statement shape is understood."""
    lines = [l for l in sql.split('\n') if l and not l.startswith('--')]
    assert lines[0] == 'begin;' and lines[-1] == 'commit;', 'not one transaction'
    rx = re.compile(r"^update public\.vp_venue_settings set game_prefs = '((?:[^']|'')*)'::jsonb, updated_at = now\(\) where venue_id = '([0-9a-f-]+)';$")
    n = 0
    for l in lines[1:-1]:
        m = rx.match(l)
        assert m, 'a statement the test does not understand: ' + l[:80]
        body, vid = json.loads(m.group(1).replace("''", "'")), m.group(2)
        for s in settings:
            if s['venue_id'] == vid:
                s['game_prefs'] = body
                n += 1
    return n


NOW = datetime.datetime(2026, 11, 16, 10, 30)
ENVR = lambda: {'NEW_SUPABASE_URL': 'https://example.invalid', 'NEW_SERVICE_KEY': KEY}

print('\n== 1. reading every venue, paged ==')
fake = FakeRest({'vp_venues': VENUES, 'vp_venue_settings': SETTINGS}, max_rows=3)
rows = G.take(fake, page=5)
R = {r['venue_id']: r for r in rows}
show('every venue is there although each page came back short (3 of 5 asked)', len(rows) == len(VENUES), len(rows))
show('every read is ordered and paged, and only the two tables are read', all(re.search(r'&order=\w+\.asc&limit=\d+&offset=\d+$', p) for p in fake.paths) and set(p.split('?')[0] for p in fake.paths) == {'vp_venues', 'vp_venue_settings'})
show('it stops only on an empty page', fake.paths[-1].endswith('offset=%d' % len(SETTINGS)))
show('game_prefs is kept exactly as stored (nested prizes, quotes, a backslash)', R[IDS[0]]['game_prefs'] == SETTINGS[0]['game_prefs'] and R[IDS[2]]['game_prefs'] == SETTINGS[2]['game_prefs'])
show('a venue with no settings row says so; a NULL or empty game_prefs row has one', R[IDS[6]]['had_settings_row'] is False and R[IDS[4]]['had_settings_row'] is True and R[IDS[3]]['had_settings_row'] is True)
show('NULL game_prefs is kept as {}, not lost', R[IDS[4]]['game_prefs'] == {} and R[IDS[6]]['game_prefs'] == {})

print('\n== 2. the files ==')
tmp = tempfile.mkdtemp(prefix='gps-test-')
try:
    lines = []
    rc = G.main(['--live', '--out', tmp], get_factory=lambda env: FakeRest({'vp_venues': VENUES, 'vp_venue_settings': SETTINGS}), env_reader=ENVR, clock=lambda: NOW, out=lines.append)
    jp, cp = os.path.join(tmp, 'game-prefs-20261116-1030.json'), os.path.join(tmp, 'game-prefs-20261116-1030.csv')
    show('a dated JSON and CSV are written', rc == 0 and os.path.isfile(jp) and os.path.isfile(cp), (rc, os.listdir(tmp)))
    snap = json.load(open(jp, encoding='utf-8'))
    show('the JSON holds every venue and when it was taken', snap['venues'] == len(VENUES) and len(snap['rows']) == len(VENUES) and snap['taken_at'].startswith('2026-11-16T10:30'))
    csvt = open(cp, encoding='utf-8').read().split('\n')
    show('the CSV counts saved settings a game for a person to read', csvt[0] == ','.join(G.FIELDS) and any(l.startswith(IDS[0]) and l.endswith(',yes,3,1,0,0,0') for l in csvt), csvt[:3])
    blob = '\n'.join(lines) + open(cp, encoding='utf-8').read() + open(jp, encoding='utf-8').read()
    show('the service key is never printed or written', KEY not in blob and 'example.invalid' not in blob)

    bad = os.path.join(tmp, 'bad')
    lines = []
    rc = G.main(['--live', '--out', bad], get_factory=lambda env: FakeRest({'vp_venues': VENUES, 'vp_venue_settings': SETTINGS}, fail=lambda t, p: t == 'vp_venue_settings' and 'offset=3' in p),
                env_reader=ENVR, clock=lambda: NOW, out=lines.append)
    show('a read that is not a 200 (even on page 2) writes nothing and says STOPPED', rc == 1 and not os.path.exists(bad) and lines[0].startswith('STOPPED'), (rc, lines))
    lines = []
    rc = G.main(['--out', bad], get_factory=lambda env: (_ for _ in ()).throw(AssertionError('read')), env_reader=lambda: {}, out=lines.append)
    show('without --live it reads nothing', rc == 2 and not os.path.exists(bad))
    rc = G.main(['--live', '--out', bad], env_reader=lambda: {'NEW_SUPABASE_URL': 'u'}, out=lambda s: None)
    show('without the key in the env file it reads nothing', rc == 1 and not os.path.exists(bad))

    print('\n== 3. the one-step restore, proven ==')
    sqlp = os.path.join(tmp, 'restore.sql')
    G.main(['--restore-sql', jp, sqlp], out=lambda s: None)
    sql = open(sqlp, encoding='utf-8').read()
    show('it is one transaction, one update a venue, says it is not run by a tool', sql.count('begin;') == 1 and sql.rstrip().endswith('commit;') and sql.count('update public.vp_venue_settings') == len(VENUES) and 'Not run by any tool' in sql)
    show("an apostrophe is doubled and a backslash and a quote survive", "Nan''s hamper" in sql and 'Say \\"hi\\" \\\\ and win' in sql)
    live = copy.deepcopy(SETTINGS)
    live[0]['game_prefs']['trivia']['rounds'] = 9                       # a default-change gone wrong, and later choices
    live[0]['game_prefs']['musical'] = {}
    live[1]['game_prefs'] = {'raffle': {'draw_style': 'ticket'}}
    live[2]['game_prefs']['bingo']['prize'] = 'changed'
    live[3]['game_prefs'] = {'trivia': {'rounds': 1}}
    live.append({'venue_id': IDS[6], 'game_prefs': {'raffle': {'draw_style': 'ticket'}}})   # a row made since for a venue that had none
    new_venue = {'venue_id': 'ffffffff-0000-0000-0000-000000000000', 'game_prefs': {'trivia': {'rounds': 2}}}
    live.append(new_venue)
    venues_live = VENUES + [{'id': new_venue['venue_id'], 'name': 'New', 'slug': 'new'}]
    tables = {'vp_venues': venues_live, 'vp_venue_settings': live}
    lines = []
    rc = G.main(['--check', jp, '--live'], get_factory=lambda env: FakeRest(tables), env_reader=ENVR, clock=lambda: NOW, out=lines.append)
    show('--check before the restore finds the 5 venues that moved (the new venue is not in the snapshot)', rc == 1 and lines[0].startswith('3 venues identical') and '5 different' in lines[0], lines)
    n = apply_sql(sql, live)
    show('the restore file runs as one transaction and touches every settings row (the 6 it had and the one made since for a venue that had none)', n == 7, n)
    lines = []
    rc = G.main(['--check', jp, '--live'], get_factory=lambda env: FakeRest(tables), env_reader=ENVR, clock=lambda: NOW, out=lines.append)
    show('--check after the restore: all 8 venues identical, 0 different, exit 0', rc == 0 and lines[0].startswith('8 venues identical') and ' 0 different' in lines[0], (rc, lines))
    show('a venue created after the snapshot is left exactly as it is', [s for s in live if s['venue_id'] == new_venue['venue_id']][0]['game_prefs'] == {'trivia': {'rounds': 2}})
    rc = G.main(['--check', jp, '--live'], get_factory=lambda env: FakeRest({'vp_venues': VENUES[:7], 'vp_venue_settings': live}), env_reader=ENVR, out=lines.append)
    show('--check says so when a venue in the snapshot is gone', rc == 1)

    print('\n== 4. no default is changed without a recent snapshot ==')
    lines = []
    show('--require-recent: a snapshot taken an hour ago passes', G.main(['--require-recent', '--dir', tmp], clock=lambda: NOW + datetime.timedelta(hours=1), out=lines.append) == 0, lines)
    lines = []
    show('--require-recent: one taken 3 days ago fails and says how to take one', G.main(['--require-recent', '--dir', tmp], clock=lambda: NOW + datetime.timedelta(days=3), out=lines.append) == 1 and 'NO RECENT SNAPSHOT' in lines[0], lines)
    show('--require-recent: an empty folder fails', G.main(['--require-recent', '--dir', os.path.join(tmp, 'none')], clock=lambda: NOW, out=lambda s: None) == 1)
    show('--require-recent --hours 100 accepts the 3 day old one', G.main(['--require-recent', '--hours', '100', '--dir', tmp], clock=lambda: NOW + datetime.timedelta(days=3), out=lambda s: None) == 0)
    show('a snapshot dated in the future is not recent', G.main(['--require-recent', '--dir', tmp], clock=lambda: NOW - datetime.timedelta(hours=2), out=lambda s: None) == 1)
    src = open(os.path.join(ROOT, 'tools', 'game-prefs-snapshot.py'), encoding='utf-8').read()
    show('the tool only reads: no POST, PATCH, PUT or DELETE method anywhere in it', not re.search(r"method\s*=\s*'(POST|PATCH|PUT|DELETE)'", src) and "method='GET'" in open(os.path.join(ROOT, 'tools', 'draw-looks-snapshot.py'), encoding='utf-8').read())
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\n' + ('FAILED %d of %d' % (BAD[0], RAN[0]) if BAD[0] else 'ALL %d CHECKS PASSED' % RAN[0]))
sys.exit(1 if BAD[0] else 0)
