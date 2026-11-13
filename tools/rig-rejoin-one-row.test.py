#!/usr/bin/env python3
"""A PHONE THAT JOINS TWICE IS STILL ONE ROW, IN THE BROWSER RIG AS ON THE LIVE DATABASE (13 Nov 2026).

one-phone-a-night-in-chrome went red under load, 2 of 53, in both full Chrome passes of the Tuesday tree: the musical
session held [Ann, Bob, Bob]. Traced on the test server (reports/one-phone-race-13nov): when the machine is busy, the
musical phone's re-join (checkStaleJoin) is answered BEFORE the /player/card it sent with its old trivia token, so the
"stale" answer lands after the re-join, drops the new token and the page joins a SECOND time, one join after the other,
17 ms apart. The live Worker takes a phone back onto its own row (same session, same device id) and only rotates its
token. The rig did not: its fake database gave player rows the id 'pl-<n>', handleJoin only reuses a row whose id is a
UUID, and so in the rig, and only there, every re-join by the same phone wrote a new row.

This suite sends that exact pair of joins straight to the rig's Worker (tools/browser-rig/worker-stdio.js, the real
game Worker in jsc), with no browser and no timing, and says what the database holds:

  the rig's player ids are UUIDs, the shape the live database mints
  the night's order: trivia joined, trivia finished, musical lobby open, the phone joins, then joins again at once
      -> the musical session holds ONE row for that phone, and both joins name the same row
      -> the second token works, the first is refused (rotated onto the same row, as live)
  a second phone in the same lobby is a second row (two phones are never collapsed)
  a page that sends no device id still gets a row each time (no key, no reuse: the safe direction)

    python3 tools/rig-rejoin-one-row.test.py

GATELIB_NO_CHROME: it imports the browser rig for its Worker pipe only (rig.Worker, jsc); no Chrome is started.
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

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
TRIVIA = '7e1a0000-0000-4000-8000-000000000001'
MUSICAL = '7e1a0000-0000-4000-8000-000000000002'
ANN, BOB = 'annphone0000000000000001', 'bobphone0000000000000002'


def main():
    W = rig.Worker()
    def table(name):
        with W.lock:
            W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
            return json.loads(W.p.stdout.readline())['body']
    def join(pid, name):
        body = {'code': W.info['code'], 'name': name}
        if pid: body['pid'] = pid
        return W.ask('POST', '/join', body, {})
    def card(tok):
        return W.ask('GET', '/player/card', {}, {'X-Player-Token': tok}).get('status')
    def rows(sid, pid=None):
        return [p for p in table('vp_players') if p.get('session_id') == sid and (pid is None or p.get('device_id') == pid)]
    try:
        v, code = W.info['venue'], W.info['code']
        sess = lambda sid, fmt, st: {'id': sid, 'venue_id': v, 'join_code': code, 'status': st, 'lobby_format': fmt,
                                     'created_at': '2026-11-13T08:00:00Z'}

        print('\nTRIVIA: the phone joins once')
        W.seed('vp_sessions', [sess(TRIVIA, 'trivia', 'lobby')], replace=True)
        r0 = join(ANN, 'Ann')
        ok('the phone joins the trivia lobby', r0.get('status') == 200 and bool((r0.get('body') or {}).get('token')), r0)
        tr = rows(TRIVIA, ANN)
        ok('CONTROL: the rig mints a player row id in the live shape (a UUID), as Postgres does', len(tr) == 1 and bool(UUID.match(str(tr[0].get('id')))),
           [p.get('id') for p in tr])

        print('\nMUSICAL BINGO: trivia is over, the lobby opens, the phone joins and at once joins again')
        W.seed('vp_sessions', [sess(TRIVIA, 'trivia', 'finished'), sess(MUSICAL, 'musical_bingo', 'lobby')], replace=True)
        r1 = join(ANN, 'Ann')
        r2 = join(ANN, 'Ann')   # the second, sequential join the musical page sends when a stale card answer lands late
        t1, t2 = (r1.get('body') or {}).get('token'), (r2.get('body') or {}).get('token')
        ok('both joins are answered with a token', r1.get('status') == 200 and r2.get('status') == 200 and bool(t1) and bool(t2), [r1.get('status'), r2.get('status')])
        mr = rows(MUSICAL, ANN)
        ok('the musical session holds ONE row for that phone, not two (one phone = one player)', len(mr) == 1,
           [(p.get('display_name'), p.get('device_id'), p.get('id')) for p in mr])
        ok('and that row is new to this session (the trivia row stays in trivia)', len(rows(TRIVIA, ANN)) == 1 and (not mr or mr[0].get('id') != tr[0].get('id')),
           [p.get('id') for p in rows(TRIVIA, ANN)])
        ok('the second join\'s token works on that row', card(t2) == 200, card(t2))
        ok('the first join\'s token is refused: the second join rotated a fresh token onto the SAME row, as live', card(t1) == 401, card(t1))

        print('\nTWO PHONES ARE TWO PLAYERS; NO DEVICE ID, NO REUSE')
        rb = join(BOB, 'Bob')
        ok('a second phone in the same lobby is a second row', rb.get('status') == 200 and len(rows(MUSICAL)) == 2 and len(rows(MUSICAL, BOB)) == 1,
           [(p.get('display_name'), p.get('device_id')) for p in rows(MUSICAL)])
        n0 = len(rows(MUSICAL))
        join('', 'Old page'); join('', 'Old page')
        ok('a page that sends no device id gets a row each time (nothing to key on, so nobody is merged)', len(rows(MUSICAL)) == n0 + 2,
           len(rows(MUSICAL)) - n0)
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
