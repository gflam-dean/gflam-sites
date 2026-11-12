#!/usr/bin/env python3
"""EVERY LIVE VENUE'S SAVED GAME SETTINGS, AS THE SHAPES A TEST CAN PLAY (Dean, 12 Nov 2026, INBOX 295.3).

Dean's real night on The Mini Bar played the OLD draw looks because of what the venue had saved (game_prefs), while
every suite in the gate started from fresh defaults. tools/real-settings-in-chrome.test.py plays every game with
each distinct saved shape instead. This makes the shapes, from a read-only export, with no network of its own:

    python3 tools/prefs-shapes.py <export.json>              rewrite tools/fixtures/live-prefs-shapes.json
    python3 tools/prefs-shapes.py <export.json> --print      say what it would write, write nothing

<export.json> is what ~/venue-enrich/reports/real-night/export-prefs.sql returns (main runs it in the Supabase SQL
editor, read-only, and saves the one cell): a JSON array of {"status", "state", "prefs"} per venue, prefs being
vp_venue_settings.game_prefs (or {} for a venue with none). No venue name, id or prize text comes out of it.

A SHAPE is one game's saved keys that change how the game PLAYS (SHAPE_KEYS below), with prize words replaced by
"Prize". Two venues with the same playable choices are one shape; "nothing saved" is a shape too (the defaults are
real for every venue that never saved). Each shape keeps how many venues have it, so a red line says how many rooms
would see the fault. Never a live read: this file never opens a connection.
"""
import io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'fixtures', 'live-prefs-shapes.json')
GAMES = ('trivia', 'musical', 'bingo', 'raffle', 'members')
# The keys that change how a night PLAYS (what the console starts on, what the TV and phones show). Prize words,
# prize lists, theme-night names and set ids are left out: they are words or live ids, not a different game.
SHAPE_KEYS = {
    'trivia':  ('count', 'time_s', 'base_points', 'speed_bonus', 'double_points', 'double_last', 'buzzer', 'buzzer_where',
                'set_mode', 'picture_round', 'end_suspense', 'round_board', 'rounds'),
    'musical': ('playlist', 'playlists', 'hits_only', 'pattern', 'reveal', 'rounds', 'prize'),
    'bingo':   ('caller', 'pattern', 'cards', 'allow_early', 'ticket_kind', 'rounds', 'prize'),
    'raffle':  ('draw_style', 'draw_time', 'allow_redraw', 'spin_seconds', 'jackpot_on', 'pick_order', 'announce_prize',
                'tickets_from', 'range_min', 'range_max'),
    'members': ('draw_style', 'draw_time'),
}
WORDS = ('prize',)   # kept as "there is one", never the venue's own words


def shape_of(game, prefs):
    """The playable part of one game's saved prefs, or None for "nothing saved"."""
    p = prefs.get(game) if isinstance(prefs, dict) else None
    if not isinstance(p, dict) or not p:
        return None
    out = {}
    for k in SHAPE_KEYS[game]:
        if k not in p:
            continue
        v = p[k]
        if k in WORDS:
            v = 'Prize' if isinstance(v, str) and v.strip() else None
            if v is None:
                continue
        if game == 'bingo' and k == 'pattern' and isinstance(v, str) and v.startswith('c:'):
            v = 'c:custom'   # the venue's own pattern: its id is theirs; the console falls back when it is not in the list
        out[k] = v
    return out


def shapes(rows):
    """{game: [{"shape": {...} or None, "venues": n}, ...]} most venues first, then by the shape's text."""
    res = {}
    for g in GAMES:
        n = {}
        for r in rows:
            s = shape_of(g, (r or {}).get('prefs') or {})
            key = json.dumps(s, sort_keys=True)
            n[key] = n.get(key, 0) + 1
        res[g] = [{'shape': json.loads(k), 'venues': c} for k, c in sorted(n.items(), key=lambda kv: (-kv[1], kv[0]))]
    return res


def load_export(path):
    data = json.load(io.open(path, encoding='utf-8'))
    if isinstance(data, dict) and 'rows' in data:
        data = data['rows']
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict) and 'rows' in data[0]:
        data = data[0]['rows']   # the SQL editor's one row, one column, saved as it is
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, list):
        raise ValueError('the export is not a list of venues')
    for r in data:
        if not isinstance(r, dict) or not isinstance(r.get('prefs', {}), dict):
            raise ValueError('a row is not {"status", "state", "prefs"}: %r' % (r,))
    return data


def build(rows, source):
    return {'source': source, 'venues': len(rows),
            'statuses': {s: sum(1 for r in rows if r.get('status') == s) for s in sorted({str(r.get('status')) for r in rows})},
            'games': shapes(rows)}


def main(argv):
    if len(argv) < 2:
        print('usage: prefs-shapes.py <export.json> [--print]'); return 2
    rows = load_export(argv[1])
    out = build(rows, 'live export %s (%s)' % (os.path.basename(argv[1]), 'tools/prefs-shapes.py'))
    text = json.dumps(out, indent=1, sort_keys=True) + '\n'
    if '--print' in argv:
        print(text); return 0
    io.open(OUT, 'w', encoding='utf-8').write(text)
    print('wrote %s: %d venues, %s' % (OUT, len(rows), ', '.join('%s %d shapes' % (g, len(out['games'][g])) for g in GAMES)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
