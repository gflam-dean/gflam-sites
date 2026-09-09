#!/usr/bin/env python3
"""PLAY A GAME, ON A STAGING WORKER, AND CHECK THE ROOM CARRIES IT.

    python3 tools/play-a-game.py                       # venueplay-game-sydney
    python3 tools/play-a-game.py venueplay-game-sydney

WHY THIS EXISTS. Dean, 10 Sep 2026: "moving forward i think you should be running a test
game or something to check right? even if its in a non production test."

He is right, and the morning that produced this proves it. Four separate faults reached a
real venue in one morning and every one of them would have been caught by a machine
pretending to be a host, a TV and a phone for thirty seconds:

  1. The room accepted {type:...} and every page sends {t:...}, so it silently dropped
     every ball. Three green test suites and a passing smoke test all said it worked,
     because all three only ever sent a shape the tests invented.
  2. ?room=1 collided with the player page's own game-code parameter, so the phone showed
     "No room" and connected to nothing.
  3. The host console's opening burst went out before its signing key had loaded, and an
     enforcing venue's TV binned the lot.
  4. The room branch returned out of connect(), so the console rendered a header and
     nothing else.

None of those is a hard bug. All four were invisible: every screen said it was fine.

WHAT THIS DOES. It opens two real WebSockets to a room on a STAGING Worker, one tagged
host and one tagged tv, sends the messages a real console sends in the order it sends
them, and requires the TV to hear each one. It then checks presence rises and falls. It
is deliberately dumb: no page, no browser, no mocking of the thing under test.

WHAT IT DOES NOT DO. It cannot sign, so it cannot prove the enforce path; that needs a
browser with a host login. It does not touch the database. It REFUSES a live Worker.
"""
import asyncio, json, secrets, sys, time, urllib.request, urllib.error

LIVE = {'venueplay-game', 'venueplay-api', 'partyplay-api', 'touring-api', 'venueplay-sms', 'drag-bingo-music'}
name = sys.argv[1] if len(sys.argv) > 1 else 'venueplay-game-sydney'
if name in LIVE:
    print(f'STOP: {name} is LIVE. A test game runs on staging, never in front of a room.'); sys.exit(1)
HOST = f'{name}.dean-tindale.workers.dev'
ROOM = 'vp-game-' + secrets.token_hex(4)

try:
    import websockets
except ImportError:
    print('STOP: the websockets package is not installed (python3 -m pip install websockets)'); sys.exit(1)

bad = 0
def ok(what, cond, extra=''):
    global bad
    print(('  ok   ' if cond else '  FAIL ') + what + (('   ' + str(extra)) if (extra and not cond) else ''))
    if not cond: bad += 1

def presence():
    req = urllib.request.Request(f'https://{HOST}/room/presence?room={ROOM}',
                                 headers={'User-Agent': 'venueplay-play-a-game/1.0'})
    try:
        r = urllib.request.urlopen(req, timeout=15); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read())
        except Exception: return x.code, {}

# The order a bingo console really speaks in, taken from venueplay/app/index.html.
# If this list stops matching the console, this test stops meaning anything, so it names
# where it came from rather than being a list somebody invented.
A_REAL_NIGHT = [
    {'t': 'host_here'},
    {'t': 'rollcall'},
    {'t': 'mode', 'mode': 'bingo'},
    {'t': 'state', 'pattern': 'one', 'prize': 'a jug', 'called': [], 'active': False},
    {'t': 'players', 'count': 2},
    {'t': 'cards', 'pid': 'p1', 'cards': [[1, 2, 3]]},
    {'t': 'started'},
    {'t': 'ball', 'n': 7, 'idx': 1},
    {'t': 'ball', 'n': 42, 'idx': 2},
    {'t': 'claim_pending', 'pid': 'p1', 'name': 'Sam'},
    {'t': 'winner', 'name': 'Sam', 'prize': 'a jug'},
    {'t': 'idle'},
]

async def main():
    print(f'a test game on {HOST}, room {ROOM}\n')
    print('== 1. is the room server there at all? ==')
    st, d = presence()
    if st == 503:
        print('  the Worker answers 503 "room server not enabled": no ROOM binding on this Worker.')
        print('  deploy it with --do-class=VenueRoom and run this again.'); sys.exit(1)
    ok('presence answers for an empty room', st == 200 and d.get('total') == 0, f'{st} {d}')

    print('\n== 2. a host, a TV and two phones walk in ==')
    ws = f'wss://{HOST}/room/ws?room={ROOM}&role='
    async with websockets.connect(ws + 'host', open_timeout=15) as host, \
               websockets.connect(ws + 'tv', open_timeout=15) as tv, \
               websockets.connect(ws + 'phone', open_timeout=15) as p1, \
               websockets.connect(ws + 'phone', open_timeout=15) as p2:
        await asyncio.sleep(0.5)
        st, d = presence()
        ok('presence sees all four, by role',
           d.get('host') == 1 and d.get('tv') == 1 and d.get('phone') == 2, json.dumps(d))

        print('\n== 3. the console plays a night, and the room carries every message ==')
        slowest = 0.0
        for msg in A_REAL_NIGHT:
            t0 = time.time()
            await host.send(json.dumps(msg))
            try:
                heard_tv = json.loads(await asyncio.wait_for(tv.recv(), timeout=5))
                heard_p1 = json.loads(await asyncio.wait_for(p1.recv(), timeout=5))
            except asyncio.TimeoutError:
                heard_tv = heard_p1 = None
            took = time.time() - t0
            slowest = max(slowest, took)
            ok(f"{msg['t']:<14} reaches the TV and a phone",
               heard_tv == msg and heard_p1 == msg,
               f'sent {msg}, TV got {heard_tv}, phone got {heard_p1}')
        print(f'         (slowest message host -> room -> screen: {slowest * 1000:.0f} ms)')

        print('\n== 4. a phone answers back, and the host hears it ==')
        await p2.send(json.dumps({'t': 'join', 'pid': 'p2', 'name': 'Alex', 'cards': 1}))
        try:
            heard = json.loads(await asyncio.wait_for(host.recv(), timeout=5))
        except asyncio.TimeoutError:
            heard = None
        ok('the host hears a phone join', heard is not None and heard.get('t') == 'join', repr(heard))

        print('\n== 5. nobody hears their own voice ==')
        await host.send(json.dumps({'t': 'ball', 'n': 90}))
        await asyncio.sleep(0.4)
        try:
            echo = await asyncio.wait_for(host.recv(), timeout=1.0)
        except asyncio.TimeoutError:
            echo = None
        ok('the console does not hear its own ball', echo is None, repr(echo))

    await asyncio.sleep(0.5)
    print('\n== 6. everyone goes home ==')
    st, d = presence()
    ok('the room empties', d.get('total') == 0, json.dumps(d))

asyncio.run(main())
print()
if bad:
    print(f'{bad} CHECK(S) FAILED. Do not put this build in front of a room.'); sys.exit(1)
print('THE TEST GAME PLAYED THROUGH. Every message the console sends reached the TV and a phone.')
