#!/usr/bin/env python3
"""OUR LICENSED VENUES, KEYED BY THE ONE MATCHER, READY TO LOAD (INBOX 81; migration 171).

The no-card start (/start) makes an account straight away only for a venue on our licensed venues list.
That list is on the Mac: the two files the prospect autopilot already calls "our lists of licensed venues"
(prospect-autopilot.py venue_rows()):

    ~/venue-enrich/venueplay-SEND-pubs-and-clubs.csv     the send list      (company_name, postcode, suburb, state)
    ~/venue-enrich/partyplay-fit-2026-10-27/master.csv   the venue master   (Venue, Postcode, Suburb/Town, State),
                                                         from the state liquor and gaming registers

Every name is keyed by vpVenueKey, run from venueplay-backend/worker/vp-venue-match.js under jsc, so the list and
the Worker can never key a name two ways (there is no Python copy of the matcher). One row per name key and postcode.
A row with no 4-digit postcode cannot be matched (the postcode decides it) and is counted, not loaded. A master row
marked "not a venue" in Do Not Send is left out. Nothing is filtered by Type: it is a licence class, not a
description (CLAUDE.md).

    python3 tools/build-licensed-venues.py                 counts only, writes nothing
    python3 tools/build-licensed-venues.py --sql OUT.sql   also writes the inserts for Dean to run after 171

It reads and writes local files only. It never connects to the database.
"""
import csv
import io
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~/venue-enrich')
SOURCES = (
    (os.path.join(HOME, 'venueplay-SEND-pubs-and-clubs.csv'), 'send list',
     {'name': 'company_name', 'postcode': 'postcode', 'suburb': 'suburb', 'state': 'state'}),
    (os.path.join(HOME, 'partyplay-fit-2026-10-27', 'master.csv'), 'venue master list',
     {'name': 'Venue', 'postcode': 'Postcode', 'suburb': 'Suburb/Town', 'state': 'State'}),
)
STATES = {'NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'}
MATCHER = os.path.join(ROOT, 'venueplay-backend', 'worker', 'vp-venue-match.js')


def keys_for(names):
    """vpVenueKey and vpVenuePostcode for every (name, postcode), by the matcher itself under jsc."""
    with tempfile.TemporaryDirectory() as d:
        inp = os.path.join(d, 'in.json')
        drv = os.path.join(d, 'drive.js')
        with io.open(inp, 'w', encoding='utf-8') as fh:
            json.dump(names, fh)
        with io.open(drv, 'w', encoding='utf-8') as fh:
            fh.write('var rows = JSON.parse(readFile(%s));\n'
                     'print(JSON.stringify(rows.map(function (r) { return [vpVenueKey(r[0]), vpVenuePostcode(r[1])]; })));\n'
                     % json.dumps(inp))
        out = subprocess.run(['jsc', MATCHER, drv], capture_output=True, text=True)
        if out.returncode != 0:
            raise SystemExit('jsc could not run the matcher: ' + (out.stderr or out.stdout)[:400])
        return json.loads(out.stdout)


def build():
    raw, missing = [], []
    for path, label, cols in SOURCES:
        if not os.path.exists(path):
            missing.append(path)
            continue
        with io.open(path, newline='', encoding='utf-8', errors='replace') as fh:
            for r in csv.DictReader(fh):
                name = (r.get(cols['name']) or '').strip()
                if not name:
                    continue
                if label == 'venue master list' and (r.get('Do Not Send') or '').strip().lower().startswith('not a venue'):
                    continue
                raw.append({'name': name, 'postcode': (r.get(cols['postcode']) or '').strip(),
                            'suburb': (r.get(cols['suburb']) or '').strip()[:80] or None,
                            'state': (r.get(cols['state']) or '').strip().upper(), 'source': label})
    keyed = keys_for([[x['name'], x['postcode']] for x in raw])
    out, seen, no_pc = [], set(), 0
    for x, (k, pc) in zip(raw, keyed):
        if not k:
            continue
        if not pc:
            no_pc += 1
            continue
        if (k, pc) in seen:
            continue
        seen.add((k, pc))
        out.append({'name': x['name'][:200], 'name_key': k[:200], 'postcode': pc, 'suburb': x['suburb'],
                    'au_state': x['state'] if x['state'] in STATES else None, 'source': x['source']})
    return out, {'read': len(raw), 'no_postcode': no_pc, 'rows': len(out), 'missing_files': missing}


def sql_lit(v):
    return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"


def main(argv):
    rows, stats = build()
    print('read %(read)d named rows; %(no_postcode)d have no 4-digit postcode (not loadable); %(rows)d unique name and postcode rows' % stats)
    for m in stats['missing_files']:
        print('MISSING: ' + m)
    if '--sql' in argv:
        dest = argv[argv.index('--sql') + 1]
        with io.open(dest, 'w', encoding='utf-8') as fh:
            fh.write('-- Rows for vp_licensed_venues (migration 171), from tools/build-licensed-venues.py. Run after 171.\n')
            fh.write('begin;\ndelete from public.vp_licensed_venues;\n')
            for i in range(0, len(rows), 500):
                chunk = rows[i:i + 500]
                fh.write('insert into public.vp_licensed_venues (name, name_key, postcode, suburb, au_state, source) values\n')
                fh.write(',\n'.join('(%s, %s, %s, %s, %s, %s)' % tuple(sql_lit(r[k]) for k in
                                    ('name', 'name_key', 'postcode', 'suburb', 'au_state', 'source')) for r in chunk))
                fh.write('\non conflict (name_key, postcode) do nothing;\n')
            fh.write('commit;\n-- expects %d rows: select count(*) from public.vp_licensed_venues;\n' % len(rows))
        print('wrote ' + dest)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
