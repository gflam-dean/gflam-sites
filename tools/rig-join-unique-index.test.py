#!/usr/bin/env python3
"""TWO OVERLAPPING JOINS FROM ONE PHONE CANNOT MAKE TWO ROWS, BEFORE OR AFTER THE UNIQUE INDEX (migration 192, 13 Nov 2026).

handleJoin looks for the phone's row (same session, same device id) and inserts one only when it finds none. Two joins
from one phone that overlap can both find nothing. Migration 192 adds vp_players_session_device_uniq, one row per
(session_id, device_id) where device_id is not null and kicked = false, and handleJoin treats the database's unique
violation as "already joined": it takes the phone back onto the row that won. The code has to be right on BOTH sides
of the index, because Dean runs the migration early by hand and the Worker ships on its own day.

The browser rig (tools/browser-rig/worker-stdio.js: the real game Worker in jsc, a fake database) now enforces the index
like Postgres does, and can make the other join win at the instant of the insert ({race}), which a Worker that answers one
request at a time could never interleave on its own. No Chrome, no timing.

  AFTER the index: the race loses -> 200, ONE row (the winner's), its token rotated to this join's, name kept, snapshot sent
  BEFORE the index ({rigIndex:false}): the same race still answers 200 with a working token (the Worker's old path, unchanged)
  a kicked row does not block the index (a removed phone can join afresh), two phones are two rows, no device id = no index
  the migration file: one statement, partial predicate (no null device ids, not kicked), CONCURRENTLY, IF NOT EXISTS,
    and a header that says NOT RUN, gives the read-only duplicate SELECT and the keep-the-oldest clean-up BEFORE the index

    python3 tools/rig-join-unique-index.test.py

GATELIB_NO_CHROME: imports the browser rig for its Worker pipe only (rig.Worker, jsc); no Chrome is started.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
os.chdir(ROOT)
import rig  # noqa: E402

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    sys.stdout.flush()
    if not cond: bad += 1

S1 = '7e1b0000-0000-4000-8000-000000000001'
S2 = '7e1b0000-0000-4000-8000-000000000002'
ANN, BOB = 'annphone0000000000000001', 'bobphone0000000000000002'
MIG = os.path.join(ROOT, 'venueplay-backend', 'supabase', 'venueplay-192-one-phone-one-player-index.sql')


def main():
    W = rig.Worker()
    def raw(msg):
        with W.lock:
            W.p.stdin.write(json.dumps(msg) + '\n'); W.p.stdin.flush()
            return json.loads(W.p.stdout.readline())['body']
    def table(name): return raw({'table': name})
    def join(pid, name):
        body = {'code': W.info['code'], 'name': name}
        if pid: body['pid'] = pid
        return W.ask('POST', '/join', body, {})
    def card(tok): return W.ask('GET', '/player/card', {}, {'X-Player-Token': tok}).get('status')
    def rows(sid, pid=None, live=False):
        return [p for p in table('vp_players') if p.get('session_id') == sid and (pid is None or p.get('device_id') == pid) and (not live or p.get('kicked') is not True)]
    try:
        v, code = W.info['venue'], W.info['code']
        def lobby(sid):
            W.seed('vp_sessions', [{'id': sid, 'venue_id': v, 'join_code': code, 'status': 'lobby', 'lobby_format': 'musical_bingo',
                                    'created_at': '2026-11-13T08:00:00Z'}], replace=True)
            W.seed('vp_players', [], replace=True)

        print('\nAFTER THE INDEX: the other join wins the race')
        raw({'rigIndex': True})
        lobby(S1)
        ok('CONTROL: the rig refuses a second live row for one (session, device), as the index does',
           (join(ANN, 'Ann').get('status') == 200 and len(rows(S1, ANN)) == 1), rows(S1, ANN))
        lobby(S1)
        raw({'race': {'device_id': ANN, 'row': {'display_name': 'Winner'}}})
        r = join(ANN, 'Ann')
        tok = (r.get('body') or {}).get('token')
        ok('the losing join is answered 200 with a token and the room (it is "already joined", not an error)',
           r.get('status') == 200 and bool(tok) and bool((r.get('body') or {}).get('snapshot')), r)
        ok('the session holds ONE row for the phone: the winner\'s', len(rows(S1, ANN)) == 1, [(p.get('display_name'), p.get('id')) for p in rows(S1, ANN)])
        ok('that row carries this join\'s name', rows(S1, ANN) and rows(S1, ANN)[0].get('display_name') == 'Ann', [p.get('display_name') for p in rows(S1, ANN)])
        ok('and this join\'s token works on it (the winner\'s token is rotated off, as a plain re-join does)', card(tok) == 200, card(tok))
        r2 = join(ANN, 'Ann')
        ok('a later plain re-join still lands on the same single row', r2.get('status') == 200 and len(rows(S1, ANN)) == 1, len(rows(S1, ANN)))

        print('\nBEFORE THE INDEX: the same race, the Worker as it was')
        raw({'rigIndex': False})
        lobby(S2)
        raw({'race': {'device_id': ANN}})
        r = join(ANN, 'Ann')
        tok = (r.get('body') or {}).get('token')
        ok('the join still answers 200 with a working token (nothing throws, the new catch is never taken)', r.get('status') == 200 and bool(tok) and card(tok) == 200, r)
        ok('and the twin is exactly what the index exists to stop: two rows with no index (CONTROL that the race really ran)', len(rows(S2, ANN)) == 2, len(rows(S2, ANN)))
        raw({'rigIndex': True})

        print('\nWHAT THE INDEX LEAVES ALONE')
        lobby(S1)
        raw({'race': {'device_id': ANN, 'row': {'kicked': True, 'display_name': 'Removed'}}})
        r = join(ANN, 'Ann')
        ok('a KICKED row for the phone does not block it: it joins afresh', r.get('status') == 200 and len(rows(S1, ANN, live=True)) == 1 and len(rows(S1, ANN)) == 2,
           [(p.get('display_name'), p.get('kicked')) for p in rows(S1, ANN)])
        lobby(S1)
        W.seed('vp_players', [{'id': '7e1b0000-0000-4000-8000-0000000000bb', 'session_id': S1, 'device_id': ANN, 'kicked': True, 'display_name': 'Removed', 'token_hash': 'h-k', 'joined_at': '2026-11-13T06:00:00Z'}])
        raw({'race': {'device_id': ANN, 'row': {'display_name': 'Winner'}}})
        r = join(ANN, 'Ann')
        names = sorted((p.get('display_name'), p.get('kicked')) for p in rows(S1, ANN))
        ok('a lost race with an older KICKED row for the phone lands on the LIVE row, never the removed one', r.get('status') == 200 and names == [('Ann', False), ('Removed', True)], names)
        lobby(S1)
        join(ANN, 'Ann'); join(BOB, 'Bob')
        ok('two phones are two rows', len(rows(S1, ANN)) == 1 and len(rows(S1, BOB)) == 1 and len(rows(S1)) == 2, len(rows(S1)))
        n0 = len(rows(S1))
        a, b = join('', 'Old page'), join('', 'Old page')
        ok('no device id, no index entry: an old page gets a row each time (nobody is merged)', a.get('status') == 200 and b.get('status') == 200 and len(rows(S1)) == n0 + 2, len(rows(S1)) - n0)
        lobby(S1); lobby(S2)
        W.seed('vp_sessions', [{'id': S1, 'venue_id': v, 'join_code': code, 'status': 'finished', 'created_at': '2026-11-13T07:00:00Z'},
                               {'id': S2, 'venue_id': v, 'join_code': code, 'status': 'lobby', 'lobby_format': 'musical_bingo', 'created_at': '2026-11-13T08:00:00Z'}], replace=True)
        W.seed('vp_players', [{'id': '7e1b0000-0000-4000-8000-0000000000aa', 'session_id': S1, 'device_id': ANN, 'kicked': False, 'display_name': 'Ann', 'token_hash': 'h-x'}], replace=True)
        r = join(ANN, 'Ann')
        ok('the same phone in ANOTHER session is another row (the index is per session)', r.get('status') == 200 and len(rows(S2, ANN)) == 1 and len(rows(S1, ANN)) == 1, r)

        print('\nTHE MIGRATION FILE')
        sql = open(MIG).read() if os.path.exists(MIG) else ''
        code_only = re.sub(r'--[^\n]*', '', sql)
        stmts = [s.strip() for s in code_only.split(';') if s.strip()]
        ok('migration 192 exists and holds exactly ONE statement (CONCURRENTLY cannot share a transaction)', len(stmts) == 1, len(stmts))
        st = re.sub(r'\s+', ' ', stmts[0]).lower() if stmts else ''
        ok('it is CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS on vp_players (session_id, device_id)',
           st.startswith('create unique index concurrently if not exists ') and ' on vp_players (session_id, device_id)' in st, st)
        ok('the predicate leaves out null device ids and kicked rows', st.endswith('where device_id is not null and kicked = false'), st)
        h = re.sub(r'\s+', ' ', ' '.join(l[2:] for l in sql.split('\n') if l.startswith('--')))
        ok('the header says NOT RUN and that main checks the LIVE database, not the comment', 'NOT RUN' in h and re.search(r'LIVE database', h) is not None, h[:200])
        ok('the header gives the read-only SELECT that finds existing duplicates', 'group by session_id, device_id having count(*) > 1' in h, '')
        ok('the header gives a clean-up that keeps the OLDEST row and deletes nothing', 'the oldest' in h.lower() and 'kicked = true' in h and 'Do NOT delete' in h, '')
        ok('and puts that clean-up before the index', sql.find('IF THERE ARE DUPLICATES') != -1 and sql.find('IF THERE ARE DUPLICATES') < sql.lower().find('create unique index concurrently'), '')
    except Exception as e:
        import traceback; traceback.print_exc()
        ok('the scenes ran to the end', False, repr(e))
    finally:
        W.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
