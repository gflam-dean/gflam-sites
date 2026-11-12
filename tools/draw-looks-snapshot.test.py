#!/usr/bin/env python3
"""THE DRAW LOOKS SNAPSHOT, WITH A FAKE DATABASE (INBOX 284, 12 Nov 2026). Nothing live is read: the real network
is switched off for the whole run and every read goes to a fake PostgREST that honours limit and offset (offset
first, then limit) and caps a page below the size asked for, the way Supabase's max-rows does.

Checks: every venue is in the files (two pages and more), a venue with no settings row and one with "" are told
apart, the look after the switch is the one rule (ticket / flip, race kept), a read that is not a 200 writes
nothing, the key is never printed or written, it reads nothing without --live, and the restore SQL puts back only
what 191 wrote.

Run: python3 tools/draw-looks-snapshot.test.py      Ends on "ALL N CHECKS PASSED".
"""
import csv, datetime, importlib.util, io, json, os, re, shutil, sys, tempfile, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('dls', os.path.join(ROOT, 'tools', 'draw-looks-snapshot.py'))
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)
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

KEY = 'k' + 'ey-' + 'x' * 30   # a key-shaped value for the leak check, built at run time

VENUES = [{'id': '%08d-0000-0000-0000-000000000000' % i, 'name': 'Venue %03d' % i, 'slug': 'v%d' % i} for i in range(1, 8)]
VENUES.append({'id': '99999999-0000-0000-0000-000000000000', 'name': "O'Reilly's", 'slug': 'oreillys'})
SETTINGS = [
    {'venue_id': VENUES[0]['id'], 'game_prefs': {'raffle': {'draw_style': '', 'draw_time': 'long'}, 'members': {'draw_style': ''}}},
    {'venue_id': VENUES[1]['id'], 'game_prefs': {'raffle': {'draw_style': 'race'}, 'members': {'draw_style': 'race', 'draw_time': 'fast'}}},
    {'venue_id': VENUES[2]['id'], 'game_prefs': {'raffle': {'draw_style': 'ticket'}, 'members': {'draw_style': 'flip'}}},
    {'venue_id': VENUES[3]['id'], 'game_prefs': None},
    {'venue_id': VENUES[4]['id'], 'game_prefs': {'musical': {'pattern': 'one'}}},
    {'venue_id': VENUES[7]['id'], 'game_prefs': {'raffle': {'draw_style': 'now'}, 'members': {'draw_style': 'as_is'}}},
]   # venues 6 and 7 have no settings row


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
        rows = [{k: r.get(k) for k in sel} for r in rows]
        return 200, json.dumps(rows).encode()


TABLES = {'vp_venues': VENUES, 'vp_venue_settings': SETTINGS}
NOW = datetime.datetime(2026, 11, 12, 10, 30)

print('\n== 1. reading every venue, paged ==')
fake = FakeRest(TABLES, max_rows=3)
rows = D.take(fake, page=5)
show('every venue is there although each page came back short (3 of 5 asked)', len(rows) == len(VENUES), len(rows))
show('every read is ordered and paged by limit and offset', all(re.search(r'&order=\w+\.asc&limit=\d+&offset=\d+$', p) for p in fake.paths), fake.paths[:2])
show('it stops only on an empty page', fake.paths[-1].endswith('offset=%d' % len(SETTINGS)) and any(p.endswith('offset=%d' % len(VENUES)) for p in fake.paths))
show('it only ever reads the two tables', set(p.split('?')[0] for p in fake.paths) == {'vp_venues', 'vp_venue_settings'})
R = {r['venue_id']: r for r in rows}
v = lambda i: R[VENUES[i]['id']]
show('"" (the old As now) is kept as "", told apart from never saved (None)', v(0)['raffle_look'] == '' and v(5)['raffle_look'] is None and v(3)['raffle_look'] is None)
show('a venue with no settings row says so; a NULL game_prefs row has one', v(5)['had_settings_row'] is False and v(6)['had_settings_row'] is False and v(3)['had_settings_row'] is True)
show('draw times are kept as stored', v(0)['raffle_draw_time'] == 'long' and v(1)['members_draw_time'] == 'fast' and v(2)['raffle_draw_time'] is None)
show('after the switch: "" and nothing become ticket / flip', v(0)['raffle_look_after'] == 'ticket' and v(0)['members_look_after'] == 'flip' and v(5)['raffle_look_after'] == 'ticket' and v(3)['members_look_after'] == 'flip')
show('after the switch: an explicit race plate stays race', v(1)['raffle_look_after'] == 'race' and v(1)['members_look_after'] == 'race')
show("after the switch: 'now' and 'as_is' become ticket / flip", v(7)['raffle_look_after'] == 'ticket' and v(7)['members_look_after'] == 'flip')
show('the rule is the same as the consoles\' (raffle ticket, members flip)', D.DEFAULT_LOOK == {'raffle': 'ticket', 'members': 'flip'} and D.usual('raffle', 'flip') == 'ticket' and D.usual('members', 'ticket') == 'flip')

print('\n== 2. the files ==')
tmp = tempfile.mkdtemp(prefix='dls-test-')
try:
    lines = []
    rc = D.main(['--live', '--out', tmp], get_factory=lambda env: FakeRest(TABLES), env_reader=lambda: {'NEW_SUPABASE_URL': 'https://example.invalid', 'NEW_SERVICE_KEY': KEY},
                clock=lambda: NOW, out=lines.append)
    csvp, jsonp = os.path.join(tmp, 'draw-looks-20261112-1030.csv'), os.path.join(tmp, 'draw-looks-20261112-1030.json')
    show('a dated CSV and JSON are written', rc == 0 and os.path.isfile(csvp) and os.path.isfile(jsonp), (rc, os.listdir(tmp)))
    js = json.load(open(jsonp, encoding='utf-8'))
    show('the JSON holds every venue with its stored looks', js['venues'] == len(VENUES) and len(js['rows']) == len(VENUES) and any(r['raffle_look'] == '' for r in js['rows']))
    cr = list(csv.DictReader(open(csvp, encoding='utf-8')))
    show('the CSV has a row a venue, with the headings', len(cr) == len(VENUES) and list(cr[0].keys()) == D.FIELDS)
    show('the CSV says (not saved) for a look never saved, "" as an empty cell', any(r['raffle_look'] == D.MISSING for r in cr) and any(r['raffle_look'] == '' for r in cr))
    show('the summary counts venues and how many move', lines[0] == '%d venues' % len(VENUES) and any('will move to ticket' in l for l in lines) and any('will move to flip' in l for l in lines), lines[:3])
    blob = '\n'.join(lines) + open(csvp, encoding='utf-8').read() + open(jsonp, encoding='utf-8').read()
    show('the service key is never printed or written', KEY not in blob and 'example.invalid' not in blob)

    tmp2 = os.path.join(tmp, 'bad')
    lines = []
    rc = D.main(['--live', '--out', tmp2], get_factory=lambda env: FakeRest(TABLES, fail=lambda t, p: t == 'vp_venue_settings' and 'offset=3' in p),
                env_reader=lambda: {'NEW_SUPABASE_URL': 'u', 'NEW_SERVICE_KEY': KEY}, clock=lambda: NOW, out=lines.append)
    show('a read that is not a 200 (even on page 2) writes nothing and says STOPPED', rc == 1 and not os.path.exists(tmp2) and lines and lines[0].startswith('STOPPED'), (rc, lines))
    lines = []
    rc = D.main(['--out', tmp2], get_factory=lambda env: (_ for _ in ()).throw(AssertionError('read')), env_reader=lambda: {}, out=lines.append)
    show('without --live it reads nothing', rc == 2 and not os.path.exists(tmp2))
    lines = []
    rc = D.main(['--live', '--out', tmp2], env_reader=lambda: {'NEW_SUPABASE_URL': 'u'}, out=lines.append)
    show('without the key in the env file it reads nothing and says which values', rc == 1 and 'NEW_SERVICE_KEY' in lines[0] and not os.path.exists(tmp2))

    print('\n== 3. the restore SQL ==')
    outsql = os.path.join(tmp, 'restore.sql')
    D.main(['--restore-sql', jsonp, outsql], out=lambda s: None)
    sql = open(outsql, encoding='utf-8').read()
    show('it is one transaction', sql.count('begin;') == 1 and sql.rstrip().endswith('commit;'))
    show('"" goes back as "" only where the value is still ticket', ("to_jsonb(''::text), true) , updated_at" not in sql) and re.search(r"array\['raffle', 'draw_style'\], to_jsonb\(''::text\), true\), updated_at = now\(\) where venue_id = '00000001-[^']+' and game_prefs -> 'raffle' ->> 'draw_style' = 'ticket';", sql))
    show('a look never saved has its key removed again', re.search(r"jsonb_set\(game_prefs, array\['raffle'\], \(game_prefs -> 'raffle'\) - 'draw_style', true\), updated_at = now\(\) where venue_id = '00000004-", sql))
    show('a race plate and a venue already on ticket / flip get no line', "'00000002-" not in sql and "'00000003-" not in sql)
    show('a venue that had no row: its row goes only while it holds just the two looks', re.search(r"delete from public\.vp_venue_settings where venue_id = '00000006-[^']+' and game_prefs = '\{\"raffle\":\{\"draw_style\":\"ticket\"\},\"members\":\{\"draw_style\":\"flip\"\}\}'::jsonb;", sql))
    show("a quote in a value is doubled (O'Reilly's id is safe; 'now' goes back as text)", "to_jsonb('now'::text)" in sql and "to_jsonb('as_is'::text)" in sql)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\n' + ('FAILED %d of %d' % (BAD[0], RAN[0]) if BAD[0] else 'ALL %d CHECKS PASSED' % RAN[0]))
sys.exit(1 if BAD[0] else 0)
