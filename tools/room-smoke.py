#!/usr/bin/env python3
"""Smoke test for the room server on a STAGING Worker. Two sockets, one speaks, the
other hears it, presence says two. See venueplay-backend/worker/ROOM-SERVER.md.

    python3 tools/room-smoke.py                       # venueplay-game-sydney
    python3 tools/room-smoke.py venueplay-game-sydney

WRITTEN OVERNIGHT 9 SEP 2026 AND NOT YET RUN. It needs the room routes wired into the
Worker and the Worker deployed with --do-class=VenueRoom first; until then it should
stop at step 1 with "room server not enabled (503)", which is the correct answer for a
Worker without the binding.

It refuses a LIVE Worker outright: the room name it uses is made up (vp-smoke-...), so
it could not touch a venue's channel, but nothing in this repo probes live for sport.
Uses the `websockets` package (15.x is installed on this Mac).
"""
import asyncio, json, secrets, sys, time, urllib.request, urllib.error

LIVE = {'venueplay-game', 'venueplay-api', 'partyplay-api', 'touring-api', 'venueplay-sms', 'drag-bingo-music'}
name = sys.argv[1] if len(sys.argv) > 1 else 'venueplay-game-sydney'
if name in LIVE:
    print(f'STOP: {name} is LIVE. This test only runs against staging.'); sys.exit(1)
HOST = f'{name}.dean-tindale.workers.dev'
ROOM = 'vp-smoke-' + secrets.token_hex(4)

try:
    import websockets
except ImportError:
    print('STOP: the websockets package is not installed (python3 -m pip install websockets)'); sys.exit(1)

bad = 0
def ok(what, cond, extra=''):
    global bad
    print(('  ok   ' if cond else '  FAIL ') + what + (('   ' + extra) if (extra and not cond) else ''))
    if not cond: bad += 1

def presence():
    req = urllib.request.Request(f'https://{HOST}/room/presence?room={ROOM}', headers={'User-Agent': 'venueplay-room-smoke/1.0'})
    try:
        r = urllib.request.urlopen(req, timeout=15); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read())
        except Exception: return x.code, {}

async def main():
    print(f'room smoke on {HOST}, room {ROOM}')
    print('== 1. is the room server there? ==')
    st, d = presence()
    if st == 503:
        print('  the Worker answers 503 "room server not enabled": no ROOM binding yet. Nothing more to test.')
        print('  (deploy with --do-class=VenueRoom after wiring the routes, then run this again)')
        return
    ok('presence answers 200 for an empty room', st == 200, f'{st} {d}')
    ok('and counts nobody', d.get('total') == 0, json.dumps(d))

    print('== 2. two screens join ==')
    ws_url = f'wss://{HOST}/room/ws?room={ROOM}&role='
    async with websockets.connect(ws_url + 'tv', open_timeout=15) as tv, \
               websockets.connect(ws_url + 'host', open_timeout=15) as host:
        await asyncio.sleep(0.5)
        st, d = presence()
        ok('presence sees one tv and one host', d.get('tv') == 1 and d.get('host') == 1 and d.get('total') == 2, json.dumps(d))

        print('== 3. the host speaks ==')
        msg = {'type': 'smoke', 'n': 42, 't': time.time()}
        t0 = time.time()
        await host.send(json.dumps(msg))
        try:
            heard = json.loads(await asyncio.wait_for(tv.recv(), timeout=5))
        except asyncio.TimeoutError:
            heard = None
        ok('the TV heard it within 5 s', heard is not None and heard.get('type') == 'smoke' and heard.get('n') == 42, repr(heard))
        if heard: print(f'         ({(time.time() - t0) * 1000:.0f} ms host -> room -> tv)')
        try:
            echo = await asyncio.wait_for(host.recv(), timeout=1.5)
        except asyncio.TimeoutError:
            echo = None
        ok('the host did NOT hear its own message', echo is None, repr(echo))

        print('== 4. junk goes nowhere ==')
        await host.send('not json')
        await host.send(json.dumps({'no': 'type'}))
        try:
            junk = await asyncio.wait_for(tv.recv(), timeout=1.5)
        except asyncio.TimeoutError:
            junk = None
        ok('not-JSON and no-type messages were dropped', junk is None, repr(junk))

    await asyncio.sleep(0.5)
    print('== 5. they leave ==')
    st, d = presence()
    ok('presence is back to nobody', d.get('total') == 0, json.dumps(d))

asyncio.run(main())
print()
if bad:
    print(f'{bad} CHECK(S) FAILED'); sys.exit(1)
print('ROOM SMOKE PASSED')
