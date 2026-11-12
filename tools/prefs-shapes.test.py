#!/usr/bin/env python3
"""THE SAVED-SETTINGS SHAPES (tools/prefs-shapes.py, INBOX 295.3, 12 Nov 2026). RUN, not read.

    python3 tools/prefs-shapes.test.py

Feeds tools/prefs-shapes.py exports shaped as the read-only SQL returns them and checks the shapes the real-settings
suite plays: one game's playable keys only, prize words never copied (a venue's own words stay in the database),
a venue's own bingo pattern id never copied, "nothing saved" kept as a shape, venues with the same choices counted
as one shape, most venues first; the SQL editor's one-cell answer read as it is saved; a row that is not a venue
refused; --print writes nothing. Then the committed fixture, tools/fixtures/live-prefs-shapes.json: every game has
shapes and "nothing saved" among them, and no shape carries a key the tool would not keep or a prize word.
No network, no database: the tool has neither.
"""
import importlib.util, io, json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

spec = importlib.util.spec_from_file_location('prefs_shapes', os.path.join(ROOT, 'tools', 'prefs-shapes.py'))
PS = importlib.util.module_from_spec(spec); spec.loader.exec_module(PS)

print('\none venue, one game')
mini = {'musical': {'playlist': 'pub-classics', 'playlist_name': 'Pub Classics', 'hits_only': True, 'pattern': 'one', 'reveal': 'end',
                    'prize': 'Dean\'s $50 bar tab', 'prize_swaps': [{'week': '2026-11-09', 'prizes': ['x']}]},
        'trivia': {'count': 20, 'time_s': 20, 'set_id': '11111111-1111-4111-8111-111111111111', 'theme_nights': ['Taylor Swift'], 'prize_list': ['Jug']},
        'bingo': {'pattern': 'c:0f0f0f0f-0000-4000-8000-000000000001', 'cards': 2, 'prize': 'Meat tray', 'prizes': {'one': 'Jug'}},
        'raffle': {'draw_style': '', 'draw_time': 'short', 'prizes': ['Meat tray', 'Voucher']}}
m = PS.shape_of('musical', mini)
ok('musical keeps the playable keys (playlist, well-known only, pattern, reveal)', m.get('playlist') == 'pub-classics' and m.get('hits_only') is True and m.get('pattern') == 'one' and m.get('reveal') == 'end', m)
ok('and never the venue\'s prize words: a prize becomes "Prize"', m.get('prize') == 'Prize' and 'bar tab' not in json.dumps(m).lower(), m)
ok('and nothing that is not play (the playlist\'s name, prize swaps)', 'playlist_name' not in m and 'prize_swaps' not in m, m)
t = PS.shape_of('trivia', mini)
ok('trivia keeps count and seconds, never the live set id, theme nights or prize list', t == {'count': 20, 'time_s': 20}, t)
b = PS.shape_of('bingo', mini)
ok('bingo: a venue\'s own pattern is "c:custom", never its id', b.get('pattern') == 'c:custom' and '0f0f0f0f' not in json.dumps(b), b)
ok('bingo: the per-pattern prize words are not copied', 'prizes' not in b and b.get('prize') == 'Prize', b)
r = PS.shape_of('raffle', mini)
ok('raffle: the old "" draw look is KEPT as it is (the shape that played the old draw on 12 Nov)', r == {'draw_style': '', 'draw_time': 'short'}, r)
ok('members: nothing saved is None', PS.shape_of('members', mini) is None)
ok('an empty game object is "nothing saved" too', PS.shape_of('members', {'members': {}}) is None)
ok('a blank prize is dropped, not "Prize"', 'prize' not in (PS.shape_of('bingo', {'bingo': {'prize': '  ', 'cards': 1}}) or {}), PS.shape_of('bingo', {'bingo': {'prize': '  ', 'cards': 1}}))

print('\nmany venues')
rows = [{'status': 'active', 'state': 'QLD', 'prefs': {}}] * 5 + \
       [{'status': 'active', 'state': 'NSW', 'prefs': {'raffle': {'draw_style': 'race', 'prizes': ['A']}}}] * 2 + \
       [{'status': 'active', 'state': 'VIC', 'prefs': {'raffle': {'draw_style': 'race', 'prizes': ['B', 'C']}}}] + \
       [{'status': 'cancelled', 'state': 'QLD', 'prefs': mini}]
sh = PS.shapes(rows)
ok('every game is there', sorted(sh) == sorted(PS.GAMES), sorted(sh))
ok('raffle: three venues with race plate and different prizes are ONE shape of 3', {'shape': {'draw_style': 'race'}, 'venues': 3} in sh['raffle'], sh['raffle'])
ok('raffle: nothing saved is a shape of its own (5 venues), first: most venues first', sh['raffle'][0] == {'shape': None, 'venues': 5}, sh['raffle'])
ok('the counts add up to every venue in the export, for every game', all(sum(x['venues'] for x in sh[g]) == len(rows) for g in PS.GAMES), {g: sum(x['venues'] for x in sh[g]) for g in PS.GAMES})
out = PS.build(rows, 'test')
ok('build() says how many venues and how many of each status', out['venues'] == 9 and out['statuses'] == {'active': 8, 'cancelled': 1}, out['statuses'])

print('\nthe export, as main saves it')
tmp = tempfile.mkdtemp(prefix='prefs-shapes-')
def write(name, obj):
    p = os.path.join(tmp, name); io.open(p, 'w', encoding='utf-8').write(obj if isinstance(obj, str) else json.dumps(obj)); return p
ok('a plain list', len(PS.load_export(write('a.json', rows))) == 9)
ok('the SQL editor\'s one row, one cell ([{"rows": [...]}])', len(PS.load_export(write('b.json', [{'rows': rows}]))) == 9)
ok('the cell saved as a JSON string', len(PS.load_export(write('c.json', json.dumps(json.dumps(rows))))) == 9)
for nm, bad_obj in (('not a list', {'x': 1}), ('a row that is not a venue', [1, 2]), ('prefs that are not an object', [{'prefs': [1]}])):
    try:
        PS.load_export(write('d.json', bad_obj)); refused = False
    except (ValueError, TypeError):
        refused = True
    ok('refused: %s' % nm, refused)
src = write('e.json', rows)
fx = os.path.join(ROOT, 'tools', 'fixtures', 'live-prefs-shapes.json')
before = io.open(fx, 'rb').read()
r = subprocess.run([sys.executable, 'tools/prefs-shapes.py', src, '--print'], cwd=ROOT, capture_output=True, text=True)
ok('--print says what it would write and writes nothing', r.returncode == 0 and '"games"' in r.stdout and io.open(fx, 'rb').read() == before, (r.returncode, r.stdout[:200]))
PS.OUT = os.path.join(tmp, 'out.json')
PS.main(['prefs-shapes.py', src])
got = json.load(io.open(PS.OUT, encoding='utf-8'))
ok('without --print it writes the fixture (here to a temp file): the shapes and a source line', got['games'] == sh and 'live export' in got['source'], got.get('source'))

print('\nthe committed fixture (tools/fixtures/live-prefs-shapes.json)')
F = json.load(io.open(fx, encoding='utf-8'))
G = F.get('games') or {}
ok('it names its source', bool(F.get('source')), F.get('source'))
for g in PS.GAMES:
    ok('%s: shapes, "nothing saved" among them, every one with a venue count' % g, bool(G.get(g)) and any(x.get('shape') is None for x in G[g]) and all(isinstance(x.get('venues'), int) and x['venues'] >= 1 for x in G[g]), G.get(g))
    extra = [k for x in G.get(g, []) for k in (x.get('shape') or {}) if k not in PS.SHAPE_KEYS[g]]
    ok('%s: no key the tool would not keep' % g, not extra, extra)
words = [x['shape'].get('prize') for g in PS.GAMES for x in G.get(g, []) if x.get('shape') and 'prize' in x['shape']]
ok('no prize word but "Prize" anywhere in it', all(w == 'Prize' for w in words), words)

print('\n' + ('%d FAILED, %d run' % (bad, ran) if bad else 'ALL %d CHECKS PASSED' % ran))
sys.exit(1 if bad else 0)
