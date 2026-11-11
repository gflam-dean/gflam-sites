#!/usr/bin/env python3
"""MIGRATION 191 AND ITS ROLLBACK, SIMULATED (Dean, 12 Nov 2026, INBOX 284). No database is touched.

There is no Postgres on this Mac, so this does two things that together stand in for a dry run:

  A. READS the two SQL files and pins, statement by statement, the parts that decide which venue changes and to what:
     the snapshot before any change, the guard, the WHERE of each update ("not in ('ticket', 'race')"), the one key
     each update merges, the row made for a venue with none, the rollback's WHERE and the row it deletes.
  B. RUNS a model of those exact statements (the same jsonb rules: ->> on a missing key or a non-object is NULL,
     coalesce to '', jsonb_set with create, || merge, ON CONFLICT DO NOTHING) over venues in every state that
     matters, and checks the outcome: '' / 'now' / 'as_is' / missing / the other game's look become ticket and flip,
     an explicit race plate is kept, every other setting is kept, a second run changes nothing, the guard stops
     everything, and the rollback puts every venue's two looks back exactly (a look chosen since is kept).

A change to the SQL that the model does not follow turns part A red, so the model cannot quietly drift from the file.

Run: python3 tools/migration-191-sim.test.py      Ends on "ALL N CHECKS PASSED".
"""
import copy, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(ROOT, 'venueplay-backend/supabase/venueplay-191-draw-looks-every-venue.sql')
RB = os.path.join(ROOT, 'venueplay-backend/supabase/ROLLBACK-draw-looks-191.sql')
RAN = [0]
BAD = [0]


def show(name, cond, saw=None):
    RAN[0] += 1
    if cond:
        print('  ok   ' + name)
    else:
        BAD[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: %s' % (saw,)))


def statements(path):
    try:
        src = open(path, encoding='utf-8').read()
    except OSError:
        return []
    src = re.sub(r'--[^\n]*', '', src)
    out, buf, in_dollar = [], [], False
    for line in src.split('\n'):
        buf.append(line)
        if line.count('$$') % 2:
            in_dollar = not in_dollar
        if not in_dollar and line.rstrip().endswith(';'):
            s = re.sub(r'\s+', ' ', '\n'.join(buf)).strip()
            if s:
                out.append(s)
            buf = []
    return out


def find(stmts, *needles):
    for i, s in enumerate(stmts):
        if all(n in s for n in needles):
            return i, s
    return -1, ''


# ---------------------------------------------------------------- A. the SQL, statement by statement
print('\n== A. migration 191 as written ==')
M = statements(MIG)
show('the file is there and has its statements', len(M) >= 9, len(M))
show('it runs in one transaction (begin first, commit last)', bool(M) and M[0].lower() == 'begin;' and M[-1].lower() == 'commit;', (M[:1], M[-1:]))
i_tbl, s_tbl = find(M, 'create table if not exists public.vp_backup_191_draw_looks')
show('the snapshot table: venue_id primary key, had_row, game_prefs, taken_at', i_tbl > 0 and 'venue_id uuid primary key' in s_tbl and 'had_row boolean not null' in s_tbl and 'game_prefs jsonb' in s_tbl)
i_rls, _ = find(M, 'alter table public.vp_backup_191_draw_looks enable row level security')
i_rev, _ = find(M, 'revoke all on public.vp_backup_191_draw_looks from anon, authenticated')
show('the snapshot table is locked (RLS on, nothing granted)', i_rls > 0 and i_rev > 0)
i_snap, s_snap = find(M, 'insert into public.vp_backup_191_draw_looks')
show('the snapshot copies every venue (left join, had_row) and keeps the first one taken (on conflict do nothing)',
     i_snap > 0 and 'from public.vp_venues v left join public.vp_venue_settings s on s.venue_id = v.id' in s_snap
     and '(s.venue_id is not null), s.game_prefs' in s_snap and s_snap.endswith('on conflict (venue_id) do nothing;'), s_snap[:200])
i_guard, s_guard = find(M, 'do $$', 'vp_backup_191_draw_looks', 'raise exception')
show('the guard: any venue without a snapshot row stops the whole migration', i_guard > i_snap and 'not exists (select 1 from public.vp_backup_191_draw_looks b where b.venue_id = v.id)' in s_guard and 'if missing > 0 then raise exception' in s_guard, s_guard[:160])
i_raf, s_raf = find(M, 'update public.vp_venue_settings', "array['raffle']")
i_mem, s_mem = find(M, 'update public.vp_venue_settings', "array['members']")
show('both updates come after the snapshot and the guard', min(i_raf, i_mem) > i_guard > i_snap > 0, (i_snap, i_guard, i_raf, i_mem))
show("raffle: only where the look is not already 'ticket' or 'race'", s_raf.endswith("where coalesce(s.game_prefs -> 'raffle' ->> 'draw_style', '') not in ('ticket', 'race');"), s_raf[-110:])
show("raffle: merges ONE key, draw_style 'ticket', into the raffle object (a non-object is started fresh)", """when jsonb_typeof(s.game_prefs -> 'raffle') = 'object' then s.game_prefs -> 'raffle' else '{}'::jsonb end) || '{"draw_style":"ticket"}'::jsonb, true)""" in s_raf)
show("members: only where the look is not already 'flip' or 'race'", s_mem.endswith("where coalesce(s.game_prefs -> 'members' ->> 'draw_style', '') not in ('flip', 'race');"), s_mem[-110:])
show("members: merges ONE key, draw_style 'flip'", """when jsonb_typeof(s.game_prefs -> 'members') = 'object' then s.game_prefs -> 'members' else '{}'::jsonb end) || '{"draw_style":"flip"}'::jsonb, true)""" in s_mem)
NEWROW = {"raffle": {"draw_style": "ticket"}, "members": {"draw_style": "flip"}}
i_ins, s_ins = find(M, 'insert into public.vp_venue_settings')
lit = re.search(r"select v\.id, '(\{.*?\})'::jsonb, now\(\)", s_ins)
show('a venue with no settings row gets a row holding only the two looks', i_ins > i_mem and bool(lit) and json.loads(lit.group(1)) == NEWROW and 'where not exists (select 1 from public.vp_venue_settings s where s.venue_id = v.id)' in s_ins, s_ins[:200])
show('nothing in 191 deletes a row or touches any other key or table', not any(re.match(r'(delete|drop|truncate)\b', s, re.I) for s in M)
     and len([s for s in M if s.lower().startswith('update ')]) == 2)

print('\n== A. the rollback as written ==')
R = statements(RB)
show('the rollback file is there, one transaction', len(R) >= 5 and R[0].lower() == 'begin;' and R[-1].lower() == 'commit;', len(R))
show('it stops if there is no snapshot', bool(find(R, 'do $$', "to_regclass('public.vp_backup_191_draw_looks') is null", 'raise exception')[1]))
_, r_raf = find(R, 'update public.vp_venue_settings', "array['raffle', 'draw_style']")
_, r_mem = find(R, 'update public.vp_venue_settings', "array['members', 'draw_style']")
show("raffle back: only rows that had one, still on the 'ticket' 191 wrote, where the snapshot said otherwise",
     "where b.venue_id = s.venue_id and b.had_row and s.game_prefs -> 'raffle' ->> 'draw_style' = 'ticket' and (b.game_prefs -> 'raffle' ->> 'draw_style') is distinct from 'ticket';" in r_raf, r_raf[-220:])
show("members back: the same with 'flip'",
     "where b.venue_id = s.venue_id and b.had_row and s.game_prefs -> 'members' ->> 'draw_style' = 'flip' and (b.game_prefs -> 'members' ->> 'draw_style') is distinct from 'flip';" in r_mem, r_mem[-220:])
show('the snapshot value goes back when it had the key; otherwise the key is removed',
     "then jsonb_set(s.game_prefs, array['raffle', 'draw_style'], b.game_prefs -> 'raffle' -> 'draw_style', true) else jsonb_set(s.game_prefs, array['raffle'], (s.game_prefs -> 'raffle') - 'draw_style', true) end" in r_raf
     and "then jsonb_set(s.game_prefs, array['members', 'draw_style'], b.game_prefs -> 'members' -> 'draw_style', true) else jsonb_set(s.game_prefs, array['members'], (s.game_prefs -> 'members') - 'draw_style', true) end" in r_mem)
_, r_del = find(R, 'delete from public.vp_venue_settings')
dl = re.search(r"s\.game_prefs = '(\{.*?\})'::jsonb", r_del)
show('a row 191 made is removed only while it still holds just the two looks', 'and not b.had_row' in r_del and bool(dl) and json.loads(dl.group(1)) == NEWROW, r_del[:200])
show('the rollback is not numbered (two 191 files would turn the gate red)', not re.match(r'\w+?-(\d+[a-z]?)-', os.path.basename(RB)))


# ---------------------------------------------------------------- B. the model, run
def arrow2(prefs, game):
    """game_prefs -> game ->> 'draw_style' (NULL on a missing key, a NULL prefs or a non-object)"""
    if not isinstance(prefs, dict):
        return None
    g = prefs.get(game)
    if not isinstance(g, dict):
        return None
    v = g.get('draw_style')
    if v is None:
        return None
    return v if isinstance(v, str) else json.dumps(v)


def merge_one(prefs, game, look):
    p = copy.deepcopy(prefs) if isinstance(prefs, dict) else {}
    g = p.get(game) if isinstance(p.get(game), dict) else {}
    g = dict(g)
    g['draw_style'] = look
    p[game] = g
    return p


class DB:
    def __init__(self, venues, settings):
        self.venues = list(venues)
        self.settings = copy.deepcopy(settings)   # venue_id -> {'game_prefs': ..., 'touched': n}
        self.backup = None


def migrate(db, break_snapshot_for=None):
    snap0 = copy.deepcopy(db.backup)
    set0 = copy.deepcopy(db.settings)
    if db.backup is None:
        db.backup = {}
    for v in db.venues:                     # insert ... on conflict do nothing
        if v in db.backup or v == break_snapshot_for:
            continue
        row = db.settings.get(v)
        db.backup[v] = {'had_row': row is not None, 'game_prefs': copy.deepcopy(row['game_prefs']) if row else None}
    if any(v not in db.backup for v in db.venues):   # the guard: raise, the transaction rolls back
        db.backup, db.settings = snap0, set0
        raise RuntimeError('Migration 191 stopped')
    for game, look, keep in (('raffle', 'ticket', ('ticket', 'race')), ('members', 'flip', ('flip', 'race'))):
        for v, row in db.settings.items():
            if (arrow2(row['game_prefs'], game) or '') not in keep:
                row['game_prefs'] = merge_one(row['game_prefs'], game, look)
                row['touched'] = row.get('touched', 0) + 1
    for v in db.venues:
        if v not in db.settings:
            db.settings[v] = {'game_prefs': copy.deepcopy(NEWROW), 'touched': 1}


def rollback(db):
    if db.backup is None:
        raise RuntimeError('Rollback 191 stopped')
    for game, wrote in (('raffle', 'ticket'), ('members', 'flip')):
        for v, b in db.backup.items():
            row = db.settings.get(v)
            if not row or not b['had_row']:
                continue
            if arrow2(row['game_prefs'], game) != wrote or arrow2(b['game_prefs'], game) == wrote:
                continue
            bg = b['game_prefs'].get(game) if isinstance(b['game_prefs'], dict) else None
            p = copy.deepcopy(row['game_prefs'])
            if isinstance(bg, dict) and 'draw_style' in bg:
                p[game]['draw_style'] = bg['draw_style']
            else:
                g = dict(p[game]); g.pop('draw_style', None); p[game] = g
            row['game_prefs'] = p
    for v, b in db.backup.items():
        if not b['had_row'] and v in db.settings and db.settings[v]['game_prefs'] == NEWROW:
            del db.settings[v]


VENUES = ['as_now', 'race_both', 'already_new', 'no_row', 'null_prefs', 'old_words', 'not_object', 'no_keys', 'race_raffle_only']
SETTINGS = {
    'as_now': {'game_prefs': {'raffle': {'draw_style': '', 'draw_time': 'long', 'prizes': ['Meat tray']}, 'members': {'draw_style': '', 'draw_id': 'd1'}, 'musical': {'pattern': 'one'}}},
    'race_both': {'game_prefs': {'raffle': {'draw_style': 'race', 'draw_time': 'fast'}, 'members': {'draw_style': 'race'}}},
    'already_new': {'game_prefs': {'raffle': {'draw_style': 'ticket'}, 'members': {'draw_style': 'flip'}}},
    'null_prefs': {'game_prefs': None},
    'old_words': {'game_prefs': {'raffle': {'draw_style': 'now'}, 'members': {'draw_style': 'as_is'}}},
    'not_object': {'game_prefs': {'raffle': 'x', 'members': {'draw_style': 'ticket'}, 'trivia': {'round_board': True}}},
    'no_keys': {'game_prefs': {'raffle': {'range_min': 1}, 'trivia': {'end_suspense': False}}},
    'race_raffle_only': {'game_prefs': {'raffle': {'draw_style': 'race'}, 'members': {'draw_style': 'classic'}}},
}

print('\n== B. the model, run over every kind of venue ==')
db = DB(VENUES, SETTINGS)
migrate(db)
look = lambda v, g: arrow2(db.settings[v]['game_prefs'], g)
show("every venue's raffle is the ticket roll or a race plate it chose", all(look(v, 'raffle') in ('ticket', 'race') for v in VENUES), {v: look(v, 'raffle') for v in VENUES})
show("every venue's members draw is the flip board or a race plate it chose", all(look(v, 'members') in ('flip', 'race') for v in VENUES), {v: look(v, 'members') for v in VENUES})
show("'' (the old \"As now\") becomes ticket and flip", look('as_now', 'raffle') == 'ticket' and look('as_now', 'members') == 'flip')
show("'now', 'as_is' and 'classic' become the new looks, never the old draw", look('old_words', 'raffle') == 'ticket' and look('old_words', 'members') == 'flip' and look('race_raffle_only', 'members') == 'flip')
show('an explicit race plate is kept, for a raffle and for a members draw', look('race_both', 'raffle') == 'race' and look('race_both', 'members') == 'race' and look('race_raffle_only', 'raffle') == 'race')
show("a raffle look on a members draw ('ticket') becomes the flip board", look('not_object', 'members') == 'flip')
show('every other setting is kept (draw time, prizes, draw id, musical, trivia)', db.settings['as_now']['game_prefs']['raffle']['draw_time'] == 'long' and db.settings['as_now']['game_prefs']['raffle']['prizes'] == ['Meat tray']
     and db.settings['as_now']['game_prefs']['members']['draw_id'] == 'd1' and db.settings['as_now']['game_prefs']['musical'] == {'pattern': 'one'}
     and db.settings['race_both']['game_prefs']['raffle']['draw_time'] == 'fast' and db.settings['no_keys']['game_prefs']['raffle']['range_min'] == 1
     and db.settings['no_keys']['game_prefs']['trivia'] == {'end_suspense': False} and db.settings['not_object']['game_prefs']['trivia'] == {'round_board': True})
show('a venue already on the new looks, or on the race plate, is not touched (no write at all)', 'touched' not in db.settings['already_new'] and 'touched' not in db.settings['race_both'])
show('a venue with no settings row gets one with only the two looks', db.settings['no_row']['game_prefs'] == NEWROW)
show('a NULL game_prefs gets the two looks', db.settings['null_prefs']['game_prefs'] == NEWROW)
show('the snapshot holds every venue as it was, and whether it had a row', set(db.backup) == set(VENUES) and db.backup['no_row']['had_row'] is False
     and db.backup['as_now']['game_prefs'] == SETTINGS['as_now']['game_prefs'] and db.backup['null_prefs']['had_row'] is True)

after1 = copy.deepcopy(db.settings)
snap1 = copy.deepcopy(db.backup)
migrate(db)
show('a second run changes nothing and keeps the first snapshot', db.settings == after1 and db.backup == snap1)

db.settings['race_raffle_only']['game_prefs']['members']['draw_style'] = 'race'   # a venue picks the race plate on the console after 191
db.settings['as_now']['game_prefs']['raffle']['prizes'] = ['Hamper']               # and saves other settings since
rollback(db)
look = lambda v, g: arrow2(db.settings[v]['game_prefs'], g) if v in db.settings else 'NO ROW'
same_as_before = all(look(v, g) == arrow2(SETTINGS[v]['game_prefs'], g) for v in SETTINGS for g in ('raffle', 'members') if v != 'race_raffle_only')
show('the rollback puts every venue\'s two looks back exactly as the snapshot had them', same_as_before, {v: (look(v, 'raffle'), look(v, 'members')) for v in SETTINGS})
show('a key the venue never had is removed again (no draw_style appears)', 'draw_style' not in db.settings['no_keys']['game_prefs']['raffle'] and 'draw_style' not in db.settings['no_keys']['game_prefs']['members'])
show('the row 191 made is removed', 'no_row' not in db.settings)
show('a look chosen on the console after 191 is kept by the rollback', look('race_raffle_only', 'members') == 'race' and look('race_raffle_only', 'raffle') == 'race')
show('settings saved since are kept by the rollback', db.settings['as_now']['game_prefs']['raffle']['prizes'] == ['Hamper'] and db.settings['as_now']['game_prefs']['raffle']['draw_time'] == 'long')
r1 = copy.deepcopy(db.settings)
rollback(db)
show('a second rollback changes nothing', db.settings == r1)

db2 = DB(VENUES, SETTINGS)
try:
    migrate(db2, break_snapshot_for='as_now')
    stopped = False
except RuntimeError:
    stopped = True
show('the guard: a venue without a snapshot stops it, and nothing at all is changed', stopped and db2.settings == SETTINGS and db2.backup is None)
db3 = DB(VENUES, SETTINGS)
try:
    rollback(db3)
    stopped = False
except RuntimeError:
    stopped = True
show('the rollback stops when there is no snapshot', stopped and db3.settings == SETTINGS)

print('\n' + ('FAILED %d of %d' % (BAD[0], RAN[0]) if BAD[0] else 'ALL %d CHECKS PASSED' % RAN[0]))
sys.exit(1 if BAD[0] else 0)
