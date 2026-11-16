#!/usr/bin/env python3
"""EVERY VENUE'S GAME SETTINGS, WRITTEN DOWN BEFORE ANY DEFAULT IS EVER CHANGED (Dean, 7 Nov 2026, INBOX 128).

Dean's rule: a new default applies to NEW venues only, and BEFORE any default changes every venue's settings
(vp_venue_settings.game_prefs) are copied to a dated backup that can be put back in one step. This is that backup.
It changes no default and nothing in the database: it only GETs.

    python3 tools/game-prefs-snapshot.py --live [--out DIR]
        reads every venue (vp_venues) and its game_prefs (vp_venue_settings), exactly as stored, and writes two
        dated files in ~/venue-enrich/reports/game-prefs-snapshot/:
            game-prefs-YYYYMMDD-HHMM.json   everything, to put it back
            game-prefs-YYYYMMDD-HHMM.csv    one line a venue: how many settings it has saved for each game
    python3 tools/game-prefs-snapshot.py --restore-sql <snapshot.json> <out.sql>
        writes the ONE-STEP RESTORE: one transaction that sets each venue's game_prefs back to the snapshot (paste it
        in the Supabase SQL editor). It puts back EVERYTHING in the snapshot, including over choices a venue made
        since, so it is for "a default change went wrong". A venue created after the snapshot is not touched.
        This tool writes the file and never runs it.
    python3 tools/game-prefs-snapshot.py --check <snapshot.json> --live
        read-only: compares the live game_prefs with the snapshot, venue by venue. Exit 0 only when every venue in the
        snapshot is identical. Run it after a restore to prove the restore worked, and after a default change to see
        that no existing venue moved.
    python3 tools/game-prefs-snapshot.py --require-recent [--hours 24] [--dir DIR]
        exit 0 only if a snapshot younger than that exists. A tool that changes a default calls this first.

Only GETs. The key is read into memory, sent as a header, never printed, logged or written. Every read is paged
(limit + offset, ordered) and stops only on an EMPTY page; any read that is not a 200 stops it before a file is
written (a half snapshot looks like a whole one). Main session only. Tests: tools/game-prefs-snapshot.test.py.
"""
import csv, datetime, glob, importlib.util, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('dls_base', os.path.join(HERE, 'draw-looks-snapshot.py'))
_base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_base)
read_env, live_getter, get_all, ReadFailed, PAGE = _base.read_env, _base.live_getter, _base.get_all, _base.ReadFailed, _base.PAGE
sql_text = _base.sql_text

OUT_DIR = os.path.expanduser('~/venue-enrich/reports/game-prefs-snapshot')
GAMES = ('trivia', 'musical', 'bingo', 'raffle', 'members')
FIELDS = ['venue_id', 'name', 'slug', 'had_settings_row'] + ['%s_saved' % g for g in GAMES]


def prefs_of(value):
    return value if isinstance(value, dict) else {}


def take(get, page=PAGE):
    """[{venue_id, name, slug, had_settings_row, game_prefs}] for every venue. Raises ReadFailed on any bad read."""
    venues = get_all(get, 'vp_venues', 'id,name,slug', 'id.asc', page)
    settings = get_all(get, 'vp_venue_settings', 'venue_id,game_prefs', 'venue_id.asc', page)
    by_id = {}
    for s in settings:
        if isinstance(s, dict) and s.get('venue_id'):
            by_id[s['venue_id']] = prefs_of(s.get('game_prefs'))
    out = []
    for v in venues:
        vid = v.get('id')
        out.append({'venue_id': vid, 'name': v.get('name') or '', 'slug': v.get('slug') or '',
                    'had_settings_row': vid in by_id, 'game_prefs': by_id.get(vid, {})})
    out.sort(key=lambda r: ((r['name'] or '').lower(), r['venue_id'] or ''))
    return out


def write(rows, out_dir, now):
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, 'game-prefs-' + now.strftime('%Y%m%d-%H%M'))
    with io.open(stem + '.json', 'w', encoding='utf-8') as f:
        json.dump({'taken_at': now.isoformat(), 'what': "every venue's game_prefs before any default is changed (INBOX 128)",
                   'venues': len(rows), 'rows': rows}, f, indent=1, ensure_ascii=False, sort_keys=True)
    with io.open(stem + '.csv', 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(FIELDS)
        for r in rows:
            gp = r['game_prefs']
            w.writerow([r['venue_id'], r['name'], r['slug'], 'yes' if r['had_settings_row'] else 'no']
                       + [len(gp.get(g)) if isinstance(gp.get(g), dict) else 0 for g in GAMES])
    return stem + '.csv', stem + '.json'


def restore_sql(snapshot):
    """One transaction that sets game_prefs back to the snapshot for every venue that had a settings row, and to {}
    for one that had none (its row may have been made since). Written for a person to read and run."""
    lines = ['-- ONE-STEP RESTORE of every venue\'s game_prefs to the snapshot taken %s (tools/game-prefs-snapshot.py).' % snapshot.get('taken_at', '?'),
             '-- Puts back EVERYTHING in the snapshot, including over choices a venue made since. A venue created after the snapshot is not touched.',
             '-- Not run by any tool. After it, run: python3 tools/game-prefs-snapshot.py --check <snapshot.json> --live  (must say 0 different).',
             'begin;']
    for r in snapshot.get('rows', []):
        vid = r.get('venue_id')
        if not vid:
            continue
        body = json.dumps(prefs_of(r.get('game_prefs')), sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        lines.append("update public.vp_venue_settings set game_prefs = %s::jsonb, updated_at = now() where venue_id = %s;" % (sql_text(body), sql_text(vid)))
    lines.append('commit;')
    return '\n'.join(lines) + '\n'


def compare(snapshot, live_rows):
    """(same, different [venue ids], missing [venue ids with a snapshot row but no live row at all])"""
    live = {r['venue_id']: r for r in live_rows}
    same, diff, gone = 0, [], []
    for r in snapshot.get('rows', []):
        now = live.get(r.get('venue_id'))
        if now is None:
            gone.append(r.get('venue_id'))
        elif json.dumps(prefs_of(now['game_prefs']), sort_keys=True) == json.dumps(prefs_of(r.get('game_prefs')), sort_keys=True):
            same += 1
        else:
            diff.append(r.get('venue_id'))
    return same, diff, gone


def newest(dir_):
    files = sorted(glob.glob(os.path.join(dir_, 'game-prefs-*.json')))
    return files[-1] if files else None


def recent(dir_, hours, now):
    """the newest snapshot file if it was taken within `hours` before `now`, else None"""
    f = newest(dir_)
    if not f:
        return None
    try:
        taken = datetime.datetime.fromisoformat(json.load(io.open(f, encoding='utf-8'))['taken_at'])
    except Exception:
        return None
    age = (now - taken).total_seconds() / 3600.0
    return f if 0 <= age <= hours else None


def opt(argv, name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else None
    return default


def main(argv, get_factory=live_getter, env_reader=read_env, clock=None, out=print):
    now = clock() if clock else datetime.datetime.now()
    if '--restore-sql' in argv:
        i = argv.index('--restore-sql')
        if len(argv) < i + 3:
            out('--restore-sql needs a snapshot file and an output file')
            return 2
        with io.open(argv[i + 1], encoding='utf-8') as f:
            snap = json.load(f)
        with io.open(argv[i + 2], 'w', encoding='utf-8') as f:
            f.write(restore_sql(snap))
        out('Restore SQL written (not run): %s' % argv[i + 2])
        return 0
    if '--require-recent' in argv:
        hours = float(opt(argv, '--hours', 24) or 24)
        f = recent(opt(argv, '--dir', OUT_DIR), hours, now)
        if f:
            out('OK: a snapshot younger than %g hours exists: %s' % (hours, f))
            return 0
        out('NO RECENT SNAPSHOT: take one first (python3 tools/game-prefs-snapshot.py --live). A default is never changed without one.')
        return 1
    if '--live' not in argv:
        out('Reads nothing without --live. Main session only, before any default is changed: python3 tools/game-prefs-snapshot.py --live')
        return 2
    get = get_factory(env_reader())
    if get is None:
        out('NEW_SUPABASE_URL and NEW_SERVICE_KEY are not both in ~/.gflam-migrate.env: nothing was read')
        return 1
    try:
        rows = take(get)
    except ReadFailed as e:
        out('STOPPED: %s' % e)
        return 1
    if '--check' in argv:
        f = opt(argv, '--check')
        if not f:
            out('--check needs a snapshot file')
            return 2
        with io.open(f, encoding='utf-8') as fh:
            snap = json.load(fh)
        same, diff, gone = compare(snap, rows)
        out('%d venues identical to the snapshot, %d different, %d gone' % (same, len(diff), len(gone)))
        for vid in diff[:20]:
            out('  different: %s' % vid)
        return 0 if not diff and not gone else 1
    out_dir = opt(argv, '--out', OUT_DIR)
    if out_dir is None:
        out('--out needs a folder')
        return 2
    c, j = write(rows, out_dir, now)
    saved = sum(1 for r in rows if r['game_prefs'])
    out('%d venues, %d with saved game settings' % (len(rows), saved))
    out('Written: %s' % c)
    out('Written: %s' % j)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
