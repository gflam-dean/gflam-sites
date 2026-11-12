#!/usr/bin/env python3
"""EVERY VENUE'S DRAW LOOK, WRITTEN DOWN BEFORE MIGRATION 191 SWITCHES THEM (Dean, 12 Nov 2026, INBOX 284).

READ-ONLY. Reads every venue (vp_venues) and its saved settings (vp_venue_settings.game_prefs) from the live
database with the service key in ~/.gflam-migrate.env (NEW_SUPABASE_URL, NEW_SERVICE_KEY), and writes, per venue:
the raffle look and draw time, the members draw look and draw time, exactly as stored (empty = "" saved by the old
"As now"; missing = never saved), and the look each will be after the switch. Two files, same name, dated:

    ~/venue-enrich/reports/draw-looks-snapshot/draw-looks-YYYYMMDD-HHMM.csv    (for a person)
    ~/venue-enrich/reports/draw-looks-snapshot/draw-looks-YYYYMMDD-HHMM.json   (to put it back)

Only GETs. The key is read into memory and sent as a header; it is never printed, logged or written. Every read is
paged (limit + offset, ordered) and stops only on an EMPTY page, never a short one (Supabase's max-rows can sit
below the page size). Any read that is not a 200 stops it before a file is written: a half snapshot is worse than
none, because it looks like a whole one.

PUTTING IT BACK. Migration 191 keeps its own snapshot table and ROLLBACK-draw-looks-191.sql restores from it. If
that table is ever gone, this writes the same restore as SQL from a snapshot file (it changes nothing itself):

    python3 tools/draw-looks-snapshot.py --restore-sql <snapshot.json> <out.sql>

Usage (main session only, BEFORE migration 191 runs):
    python3 tools/draw-looks-snapshot.py --live [--out DIR]
With no --live it reads nothing and says so. Tests: tools/draw-looks-snapshot.test.py (a fake HTTP layer).
"""
import csv, datetime, io, json, os, sys, urllib.error, urllib.parse, urllib.request

ENV_FILE = os.path.expanduser('~/.gflam-migrate.env')
OUT_DIR = os.path.expanduser('~/venue-enrich/reports/draw-looks-snapshot')
PAGE = 1000
DEFAULT_LOOK = {'raffle': 'ticket', 'members': 'flip'}   # the same rule as VPDrawStyle.usual in /app/vp-drawstyle.js
CHOICES = {'raffle': ('ticket', 'race'), 'members': ('flip', 'race')}
FIELDS = ['venue_id', 'name', 'slug', 'had_settings_row',
          'raffle_look', 'raffle_draw_time', 'members_look', 'members_draw_time',
          'raffle_look_after', 'members_look_after']
MISSING = '(not saved)'


def read_env(path=ENV_FILE):
    env = {}
    try:
        for line in io.open(path, encoding='utf-8'):
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env


def live_getter(env):
    """path -> (status, body bytes): a GET of /rest/v1/<path> with the service key. None without both values.
    The key never leaves this closure."""
    base = (env.get('NEW_SUPABASE_URL') or '').rstrip('/')
    key = env.get('NEW_SERVICE_KEY') or ''
    if not base or not key:
        return None

    def get(path):
        req = urllib.request.Request(base + '/rest/v1/' + path, method='GET',
                                     headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b''
        except Exception as e:
            return 0, ('%s' % type(e).__name__).encode()
    return get


class ReadFailed(Exception):
    pass


def get_all(get, table, select, order, page=PAGE):
    """Every row, paged by limit/offset in a fixed order; stops only on an EMPTY page."""
    rows, offset = [], 0
    while True:
        path = '%s?select=%s&order=%s&limit=%d&offset=%d' % (table, urllib.parse.quote(select, safe=',_'), order, page, offset)
        status, body = get(path)
        if status != 200:
            raise ReadFailed('%s answered %s (offset %d): nothing was written' % (table, status, offset))
        try:
            got = json.loads(body.decode('utf-8') or '[]')
        except ValueError:
            raise ReadFailed('%s did not answer JSON (offset %d): nothing was written' % (table, offset))
        if not isinstance(got, list):
            raise ReadFailed('%s did not answer a list (offset %d): nothing was written' % (table, offset))
        if not got:
            return rows
        rows.extend(got)
        offset += len(got)


def stored(prefs, game, key):
    """the raw stored value: None when never saved (no settings, no game object, no key)"""
    if not isinstance(prefs, dict):
        return None
    g = prefs.get(game)
    if not isinstance(g, dict) or key not in g:
        return None
    return g[key]


def usual(game, value):
    return value if isinstance(value, str) and value in CHOICES[game] else DEFAULT_LOOK[game]


def take(get, page=PAGE):
    """[{venue row}] for every venue, sorted by name then id. Raises ReadFailed on any bad read."""
    venues = get_all(get, 'vp_venues', 'id,name,slug', 'id.asc', page)
    settings = get_all(get, 'vp_venue_settings', 'venue_id,game_prefs', 'venue_id.asc', page)
    by_id = {}
    for s in settings:
        if isinstance(s, dict) and s.get('venue_id'):
            by_id[s['venue_id']] = s.get('game_prefs')
    out = []
    for v in venues:
        vid = v.get('id')
        had = vid in by_id
        prefs = by_id.get(vid)
        r = {'venue_id': vid, 'name': v.get('name') or '', 'slug': v.get('slug') or '', 'had_settings_row': had}
        for game in ('raffle', 'members'):
            r[game + '_look'] = stored(prefs, game, 'draw_style')
            r[game + '_draw_time'] = stored(prefs, game, 'draw_time')
            r[game + '_look_after'] = usual(game, r[game + '_look'])
        out.append(r)
    out.sort(key=lambda r: ((r['name'] or '').lower(), r['venue_id'] or ''))
    return out


def write(rows, out_dir, now):
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, 'draw-looks-' + now.strftime('%Y%m%d-%H%M'))
    with io.open(stem + '.json', 'w', encoding='utf-8') as f:
        json.dump({'taken_at': now.isoformat(), 'what': 'every venue\'s draw look before migration 191 (INBOX 284)',
                   'venues': len(rows), 'rows': rows}, f, indent=1, ensure_ascii=False)
    with io.open(stem + '.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(FIELDS)
        for r in rows:
            w.writerow([MISSING if r[k] is None else ('yes' if r[k] is True else 'no' if r[k] is False else r[k]) for k in FIELDS])
    return stem + '.csv', stem + '.json'


def summary(rows):
    n = len(rows)
    out = ['%d venues' % n]
    for game in ('raffle', 'members'):
        counts = {}
        for r in rows:
            k = r[game + '_look']
            k = MISSING if k is None else ('"" (As now)' if k == '' else k)
            counts[k] = counts.get(k, 0) + 1
        moving = len([r for r in rows if r[game + '_look'] != r[game + '_look_after']])
        out.append('%s look now: %s; %d will move to %s' % (game, ', '.join('%s %d' % (k, counts[k]) for k in sorted(counts)), moving, DEFAULT_LOOK[game]))
    return out


def sql_text(v):
    return "'" + str(v).replace("'", "''") + "'"


def restore_sql(snapshot):
    """SQL that puts each venue's two stored looks back as the snapshot had them (only where the value is still
    the one migration 191 wrote). Written for a person to read and run; this tool never runs it."""
    lines = ['-- Restore of the draw looks from the snapshot taken %s (tools/draw-looks-snapshot.py).' % snapshot.get('taken_at', '?'),
             '-- Puts back only a look that is still the one migration 191 wrote (ticket / flip). Not run by any tool.', 'begin;']
    for r in snapshot.get('rows', []):
        vid = r.get('venue_id') or ''
        if not r.get('had_settings_row'):
            lines.append("delete from public.vp_venue_settings where venue_id = %s and game_prefs = "
                         "'{\"raffle\":{\"draw_style\":\"ticket\"},\"members\":{\"draw_style\":\"flip\"}}'::jsonb;" % sql_text(vid))
            continue
        for game, wrote in (('raffle', 'ticket'), ('members', 'flip')):
            old = r.get(game + '_look')
            if old in CHOICES[game]:   # 191 left it alone (ticket / flip, or the race plate): a later console choice is kept
                continue
            if old is None:
                setter = "jsonb_set(game_prefs, array['%s'], (game_prefs -> '%s') - 'draw_style', true)" % (game, game)
            else:
                setter = "jsonb_set(game_prefs, array['%s', 'draw_style'], to_jsonb(%s::text), true)" % (game, sql_text(old))
            lines.append("update public.vp_venue_settings set game_prefs = %s, updated_at = now() where venue_id = %s "
                         "and game_prefs -> '%s' ->> 'draw_style' = '%s';" % (setter, sql_text(vid), game, wrote))
    lines.append('commit;')
    return '\n'.join(lines) + '\n'


def main(argv, get_factory=live_getter, env_reader=read_env, clock=None, out=print):
    if len(argv) >= 3 and argv[0] == '--restore-sql':
        with io.open(argv[1], encoding='utf-8') as f:
            snap = json.load(f)
        with io.open(argv[2], 'w', encoding='utf-8') as f:
            f.write(restore_sql(snap))
        out('Restore SQL written (not run): %s' % argv[2])
        return 0
    if '--live' not in argv:
        out('Reads nothing without --live. Main session only, before migration 191: python3 tools/draw-looks-snapshot.py --live')
        return 2
    out_dir = OUT_DIR
    if '--out' in argv:
        i = argv.index('--out')
        if i + 1 >= len(argv):
            out('--out needs a folder')
            return 2
        out_dir = argv[i + 1]
    get = get_factory(env_reader())
    if get is None:
        out('NEW_SUPABASE_URL and NEW_SERVICE_KEY are not both in ~/.gflam-migrate.env: nothing was read')
        return 1
    try:
        rows = take(get)
    except ReadFailed as e:
        out('STOPPED: %s' % e)
        return 1
    now = clock() if clock else datetime.datetime.now()
    c, j = write(rows, out_dir, now)
    for line in summary(rows):
        out(line)
    out('Written: %s' % c)
    out('Written: %s' % j)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
