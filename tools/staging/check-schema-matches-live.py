#!/usr/bin/env python3
"""DOES THE TEST DATABASE HAVE EXACTLY LIVE'S SHAPE? Offline: reads two files, connects to nothing.

    check-schema-matches-live.py --live LIVE.json --test TEST.json
    check-schema-matches-live.py --live-baselines RLS-BASELINE.json COLUMNS-BASELINE.json --test TEST.json
    check-schema-matches-live.py --check-content content-tables.txt --columns COLUMNS-BASELINE.json

The JSON files come from tools/staging/schema-snapshot.sql, run read-only on each project (README).
The second form compares TEST against the baselines already in the repo
(venueplay-backend/supabase/RLS-BASELINE.json and COLUMNS-BASELINE.json, written from live by
venueplay-backend/tools/dump-rls-baseline.py), so it needs no live dump at all; it can only
compare what the baselines record (locks and column names).

WHY. A test night proves nothing if the test database is not live's shape. A missing policy
means a test passes that live would refuse; a missing column means live breaks where the test
was fine. Every release, before the staging play-through: diff = 0, or it says what differs.

WHAT IT COMPARES. Every part present in BOTH files: rls, policies, grants (anon/authenticated),
views, security definer functions, columns (name; plus type, nullable and default when both
files have them), functions (definition md5), triggers, indexes, constraints, enums, sequences,
extensions, the realtime publication, storage buckets, storage policies. A part missing from one
file is printed as NOT COMPARED: a skip is not a pass. rls, policies, grants and columns must be
compared, or it fails.

IT ALSO CHECKS THE FILES ARE THE RIGHT WAY ROUND. A test snapshot must carry the TEST marker
(gpoolavkghnxedzrmtmc); a live snapshot must not. Swapped files fail.

Exit 0 = MATCH, 1 = differences (or a required part not compared), 2 = a file could not be read.
"""
import json
import re
import sys

TEST_REF = 'gpoolavkghnxedzrmtmc'
LIVE_REF = 'ijkzgmdtwtgfkedqspxm'
REQUIRED = ('rls', 'policies', 'grants', 'columns')
PARTS = ('rls', 'policies', 'grants', 'views', 'security_definer_functions', 'columns', 'functions', 'triggers',
         'indexes', 'constraints', 'enums', 'sequences', 'extensions', 'realtime_publication',
         'storage_buckets', 'storage_policies')

# A column that can hold a person. Used to refuse content tables that would copy people from live.
PERSON = re.compile(r'(^|_)(email|e164|phone|mobile|first_name|last_name|display_name|winner_name|contact_name|'
                    r'buyer_name|nickname|address|street|ip|ip_hash|ip_key|token|token_hash|device_id|pid)($|_)')
PERSON_WARN = re.compile(r'_by$|^author$|^actor')


def load(path):
    try:
        with open(path, encoding='utf-8') as f:
            text = f.read().strip()
    except OSError as e:
        raise SystemExit2('cannot read %s: %s' % (path, e))
    try:
        return json.loads(text)
    except ValueError as e:
        # psql -A -t can wrap the one JSON line in blank or notice lines; use the line that starts with {
        line = next((l for l in text.splitlines() if l.strip().startswith('{')), '')
        try:
            return json.loads(line)
        except ValueError:
            raise SystemExit2('%s is not JSON (%s)' % (path, e))


class SystemExit2(Exception):
    pass


def from_baselines(rls_path, cols_path):
    """The repo baselines, in the snapshot's shape. Columns are names only."""
    rls = load(rls_path)
    cols = load(cols_path)
    snap = {k: rls[k] for k in ('rls', 'policies', 'grants', 'views', 'security_definer_functions') if k in rls}
    snap['columns'] = cols
    snap['kind'] = 'repo-baselines'
    return snap


def facts(snap, part, names_only_columns=False):
    """One line per fact, so two snapshots diff as two sets of sentences."""
    v = snap.get(part)
    out = set()
    if v is None:
        return None
    if part == 'rls':
        for t, x in v.items():
            out.add('rls %s enabled=%s forced=%s' % (t, x.get('enabled'), x.get('forced')))
    elif part in ('policies', 'storage_policies'):
        for k, x in v.items():
            out.add('%s %s cmd=%s permissive=%s roles=%s using=%s check=%s' % (
                part[:-3] + 'y', k, x.get('cmd'), x.get('permissive'), x.get('roles'), x.get('using'), x.get('with_check')))
    elif part == 'security_definer_functions':
        for k, x in v.items():
            out.add('secdef %s anon=%s authenticated=%s' % (k, x.get('anon'), x.get('authenticated')))
    elif part == 'columns':
        for t, cols in v.items():
            for c in cols:
                if isinstance(c, list):
                    if names_only_columns:
                        out.add('column %s.%s' % (t, c[0]))
                    else:
                        out.add('column %s.%s type=%s null=%s default=%s' % (t, c[0], c[1], c[2], c[3]))
                else:
                    out.add('column %s.%s' % (t, c))
    elif isinstance(v, dict):
        for k, x in v.items():
            out.add('%s %s = %s' % (part, k, json.dumps(x, sort_keys=True)))
    elif isinstance(v, list):
        for x in v:
            out.add('%s %s' % (part, x))
    else:
        out.add('%s %s' % (part, v))
    return out


def columns_detailed(snap):
    cols = snap.get('columns') or {}
    return bool(cols) and all(isinstance(c, list) for cs in cols.values() for c in cs)


def compare(live, test, out=print):
    """Returns (exit_code, differences)."""
    bad = []
    if test.get('kind') == 'venueplay-schema-snapshot' and test.get('staging_marker') != TEST_REF:
        bad.append('the TEST file has no TEST marker (%s): it was not taken on the TEST project' % TEST_REF)
    if live.get('kind') == 'venueplay-schema-snapshot' and live.get('staging_marker'):
        bad.append('the LIVE file carries a TEST marker: it was taken on the TEST project, not live')
    if bad:
        for b in bad:
            out('FAIL: ' + b)
        return 1, bad

    names_only = not (columns_detailed(live) and columns_detailed(test))
    diffs, compared, skipped, n_facts = [], [], [], 0
    for part in PARTS:
        a = facts(live, part, names_only)
        b = facts(test, part, names_only)
        if a is None or b is None:
            skipped.append(part)
            continue
        compared.append(part)
        n_facts += len(a)
        for l in sorted(a - b):
            diffs.append('ONLY ON LIVE: ' + l)
        for l in sorted(b - a):
            diffs.append('ONLY ON TEST: ' + l)

    for d in diffs:
        out(d[:300])
    missing_required = [p for p in REQUIRED if p not in compared]
    if skipped:
        out('NOT COMPARED (missing from one file, a skip is not a pass): ' + ', '.join(skipped))
    if names_only:
        out('note: columns compared by NAME only (one file has no types)')
    if missing_required:
        out('FAIL: required part(s) not compared: ' + ', '.join(missing_required))
        return 1, diffs + ['not compared: ' + p for p in missing_required]
    if diffs:
        out('FAIL: TEST DOES NOT MATCH LIVE: %d difference(s) in %d part(s) compared' % (len(diffs), len(compared)))
        return 1, diffs
    out('MATCH: test schema matches live (%d facts in %d parts: %s)' % (n_facts, len(compared), ', '.join(compared)))
    return 0, []


def check_content(list_path, columns_path, out=print):
    """Refuse a content list that names a table able to hold a person."""
    cols = load(columns_path)
    bad, warn, n = [], [], 0
    with open(list_path, encoding='utf-8') as f:
        for line in f:
            line = line.split('#', 1)[0].strip()
            if not line:
                continue
            n += 1
            t = line.split()[0]
            if t not in cols:
                bad.append('%s is not a table in the columns file' % t)
                continue
            for c in cols[t]:
                c = c[0] if isinstance(c, list) else c
                if PERSON.search(c):
                    bad.append('%s.%s can hold a person' % (t, c))
                elif PERSON_WARN.search(c):
                    warn.append('%s.%s (who edited it: a staff label, a person should glance at it once)' % (t, c))
    for w in warn:
        out('look: ' + w)
    for b in bad:
        out('FAIL: ' + b)
    if n == 0:
        out('FAIL: the content list is empty')
        return 1
    if bad:
        return 1
    out('CONTENT LIST OK: %d table(s), no column that can hold a person' % n)
    return 0


def main(argv, out=print):
    try:
        if '--check-content' in argv:
            i = argv.index('--check-content')
            j = argv.index('--columns')
            return check_content(argv[i + 1], argv[j + 1], out)
        if '--test' not in argv or not ('--live' in argv or '--live-baselines' in argv):
            out(__doc__.strip().split('\n\n')[0])
            out('usage: --live LIVE.json --test TEST.json | --live-baselines RLS.json COLUMNS.json --test TEST.json')
            return 2
        test = load(argv[argv.index('--test') + 1])
        if '--live-baselines' in argv:
            i = argv.index('--live-baselines')
            live = from_baselines(argv[i + 1], argv[i + 2])
        else:
            live = load(argv[argv.index('--live') + 1])
        code, _ = compare(live, test, out)
        return code
    except SystemExit2 as e:
        out('STOP: %s' % e)
        return 2
    except (IndexError, ValueError):
        out('STOP: a file name is missing after an option (see --help)')
        return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
