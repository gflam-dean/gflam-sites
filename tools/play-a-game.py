#!/usr/bin/env python3
"""PLAY A GAME, IN EVERY FORMAT, ON A STAGING WORKER, AND CHECK THE ROOM CARRIES IT.

    python3 tools/play-a-game.py                          # every format, staging
    python3 tools/play-a-game.py --format trivia          # one of them
    python3 tools/play-a-game.py venueplay-game-sydney --format musical

Formats: bingo, trivia, musical, members, raffle, or all (the default).

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

WHAT THIS DOES. For each format it opens real WebSockets to a room on a STAGING Worker,
one tagged host, one tagged tv and one tagged phone, sends the messages that format's
console really sends in the order it really sends them, and requires the right screens to
hear each one. It then checks the things that actually broke: a phone that arrives late,
junk that must reach nobody, a screen that reconnects, and presence falling back to zero.
It is deliberately dumb: no page, no browser, no mocking of the thing under test.

TWO ROOMS, NOT ONE. Trivia and musical bingo hold TWO channels at once, and this test
holds two sockets for the host to match:

    the screen channel   "vp-" + VP.venueCode("trivia-<slug>")   trivia/host.html:1058
                         "vp-" + VP.venueCode("musical-<slug>")  musical/host.html:1891
    the players channel  "vp-" + the session join code           trivia/host.html:726
                                                                 musical/host.html:1269

bcast() writes to both (trivia/host.html:326, musical/host.html:630), send() writes to the
screen channel only and gsend() to the players channel only. So this test does not just
check that a message arrives, it checks it does NOT arrive on the other channel. Bingo,
members draw and raffle each hold one channel: index.html:2371, members/host.html:710,
raffle/host.html:880.

WHAT IT DOES NOT DO. It cannot sign, so it cannot prove the enforce path; that needs a
browser with a host login. It does not touch the database. It REFUSES a live Worker.
"""
import asyncio, contextlib, hashlib, json, secrets, sys, time, urllib.request, urllib.error, uuid

LIVE = {'venueplay-game', 'venueplay-api', 'partyplay-api', 'touring-api', 'venueplay-sms', 'drag-bingo-music'}

# ---- arguments -------------------------------------------------------------
ALL_FORMATS = ['bingo', 'trivia', 'musical', 'members', 'raffle']
name = 'venueplay-game-sydney'
want = 'all'
args = sys.argv[1:]
i = 0
while i < len(args):
    a = args[i]
    if a == '--format':
        i += 1
        want = args[i] if i < len(args) else ''
    elif a.startswith('--format='):
        want = a.split('=', 1)[1]
    elif a.startswith('-'):
        print(f'STOP: I do not know the option {a}. Use --format <name>.'); sys.exit(2)
    else:
        name = a
    i += 1

if want == 'all':
    formats = list(ALL_FORMATS)
elif want in ALL_FORMATS:
    formats = [want]
else:
    print(f'STOP: {want!r} is not a format. Pick one of: ' + ', '.join(ALL_FORMATS) + ', or all.'); sys.exit(2)

if name in LIVE:
    print(f'STOP: {name} is LIVE. A test game runs on staging, never in front of a room.'); sys.exit(1)
HOST = f'{name}.dean-tindale.workers.dev'
BASE = 'vp-game-' + secrets.token_hex(4)     # made up, so it can never be a real venue's room

try:
    import websockets
except ImportError:
    print('STOP: the websockets package is not installed (python3 -m pip install websockets)'); sys.exit(1)

bad = 0
def ok(what, cond, extra=''):
    global bad
    # flush, because a run that is going red waits on a timeout for every message and a
    # buffered log looks exactly like a hung tool.
    print(('  ok   ' if cond else '  FAIL ') + what + (('   ' + str(extra)) if (extra and not cond) else ''), flush=True)
    if not cond: bad += 1

def presence(room):
    req = urllib.request.Request(f'https://{HOST}/room/presence?room={room}',
                                 headers={'User-Agent': 'venueplay-play-a-game/2.0'})
    try:
        r = urllib.request.urlopen(req, timeout=15); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read())
        except Exception: return x.code, {}

# ---------------------------------------------------------------------------
# THE MESSAGES. Every list below was read out of the console that sends it, and every
# line number is where that exact object is built. If a console changes and this list
# does not, the test stops meaning anything, so nothing here is invented.
#
# Each entry is (who must hear it, the message):
#   'both'  the console's bcast(): the screen channel AND the players channel
#   'tv'    the console's send():  the screen channel only, and the phone must NOT hear it
#   'phone' the console's gsend(): the players channel only, and the TV must NOT hear it
# On a one-channel format (bingo, members, raffle) everything is 'both', because there
# is only the one channel and everyone on it hears everything.
# ---------------------------------------------------------------------------

# BINGO, from venueplay/app/index.html. One channel: index.html:2371.
BINGO = [
    ('both', {'t': 'host_here'}),                                                            # index.html:2376
    ('both', {'t': 'rollcall'}),                                                             # index.html:2385
    ('both', {'t': 'mode', 'mode': 'bingo'}),                                                # index.html:1672
    ('both', {'t': 'state', 'pattern': 'line', 'prize': 'a jug', 'defaultCards': 1,
              'paidMode': False, 'allowEarly': False, 'called': [], 'active': False,
              'playerCount': 2, 'join_code': 'AB12CD'}),                                     # index.html:1370
    ('both', {'t': 'players', 'count': 2}),                                                  # index.html:1522
    ('both', {'t': 'cards', 'pid': 'p1',
              'cards': [{'cells': [1, 16, 31, 46, 61], 'cardNo': '001'}]}),                  # index.html:1521
    ('both', {'t': 'started', 'pattern': 'line', 'prize': 'a jug', 'defaultCards': 1}),      # index.html:1948
    ('both', {'t': 'ball', 'number': 7, 'called': [7], 'index': 1}),                         # index.html:2128
    ('both', {'t': 'ball', 'number': 42, 'called': [7, 42], 'index': 2}),                    # index.html:2128
    ('both', {'t': 'claim_pending', 'name': 'Sam', 'names': ['Sam']}),                       # index.html:1519
    ('both', {'t': 'winner', 'pid': 'p1', 'name': 'Sam', 'cardNo': '001', 'pattern': 'line',
              'prize': 'a jug',
              'winners': [{'pid': 'p1', 'name': 'Sam', 'cardNo': '001'}],
              'shared': False, 'cont': False}),                                              # index.html:2199
    ('both', {'t': 'resume', 'pid': 'p1'}),                                                  # index.html:2179
    ('both', {'t': 'idle'}),                                                                 # index.html:1732
    ('both', {'t': 'to_ads'}),                                                               # index.html:912
]

# TRIVIA, from venueplay/app/trivia/host.html. Screen channel host.html:911, players
# channel host.html:342, bcast() writes to both at host.html:326.
_ENDS = 1757460000000
TRIVIA = [
    ('tv',    {'t': 'host_here'}),                                                           # trivia/host.html:915
    ('tv',    {'t': 'session', 'session_id': 'sess-test', 'join_code': 'AB12CD'}),           # trivia/host.html:727
    ('both',  {'t': 'mode', 'mode': 'trivia', 'title': 'Tuesday Quiz'}),                     # trivia/host.html:739
    ('phone', {'t': 'rollcall'}),                                                            # trivia/host.html:345
    ('both',  {'t': 'players', 'count': 2}),                                                 # trivia/host.html:742
    ('both',  {'t': 'started', 'game_id': 'game-test', 'question_count': 10,
               'colour': '#8b5cf6', 'title': 'Tuesday Quiz'}),                               # trivia/host.html:770
    ('both',  {'t': 'question', 'game_id': 'game-test', 'qseq': 1, 'qi': 1, 'qtotal': 10,
               'text': 'Which Australian city hosts the Melbourne Cup?',
               'options': ['Sydney', 'Melbourne', 'Perth', 'Hobart'],
               'endsAt': _ENDS, 'secs': 30, 'colour': '#8b5cf6', 'imageUrl': ''}),           # trivia/host.html:788
    ('both',  {'t': 'time', 'qseq': 1, 'endsAt': _ENDS, 'secs': 12}),                        # trivia/host.html:687
    ('tv',    {'t': 'answered', 'count': 2}),                                                # trivia/host.html:904
    ('both',  {'t': 'lock'}),                                                                # trivia/host.html:791
    ('both',  {'t': 'reveal', 'qseq': 1, 'correctIndex': 1,
               'options': ['Sydney', 'Melbourne', 'Perth', 'Hobart'],
               'split': [0, 2, 0, 0],
               'leaderboard': [{'name': 'Sam', 'score': 140}, {'name': 'Alex', 'score': 120}]}),   # trivia/host.html:814
    ('both',  {'t': 'leaderboard', 'title': 'Leaderboard',
               'rows': [{'name': 'Sam', 'score': 140}, {'name': 'Alex', 'score': 120}]}),    # trivia/host.html:820
    ('both',  {'t': 'podium',
               'top': [{'name': 'Sam', 'score': 140}, {'name': 'Alex', 'score': 120}],
               'rows': [{'name': 'Sam', 'score': 140}, {'name': 'Alex', 'score': 120}]}),    # trivia/host.html:848
    ('both',  {'t': 'leaderboard', 'title': 'Final scores',
               'rows': [{'name': 'Sam', 'score': 140}, {'name': 'Alex', 'score': 120}]}),    # trivia/host.html:849
    ('both',  {'t': 'idle'}),                                                                # trivia/host.html:857
    ('both',  {'t': 'to_ads'}),                                                              # trivia/host.html:1124
]

# MUSICAL BINGO, from venueplay/app/musical/host.html. Screen channel host.html:1620,
# players channel host.html:633, bcast() writes to both at host.html:630.
MUSICAL = [
    ('tv',    {'t': 'host_here'}),                                                           # musical/host.html:1628
    ('tv',    {'t': 'session', 'session_id': 'sess-test', 'join_code': 'AB12CD'}),           # musical/host.html:1632
    ('both',  {'t': 'mode', 'mode': 'musical'}),                                             # musical/host.html:1289
    ('phone', {'t': 'rollcall'}),                                                            # musical/host.html:636
    ('both',  {'t': 'volume', 'level': 0.8}),                                                # musical/host.html:879
    ('both',  {'t': 'state', 'pattern': 'line', 'prize': 'a jug', 'played': [],
               'played_ids': [], 'active': False, 'lobby': True, 'autoDaub': False,
               'playerCount': 2, 'game_id': 'game-test'}),                                   # musical/host.html:822
    ('both',  {'t': 'players', 'count': 2}),                                                 # musical/host.html:824
    ('both',  {'t': 'started', 'pattern': 'line', 'prize': 'a jug', 'autoDaub': False,
               'game_id': 'game-test'}),                                                     # musical/host.html:1361
    ('both',  {'t': 'played', 'replay': False, 'title': 'Down Under', 'artist': 'Men At Work',
               'previewUrl': '', 'artworkUrl': '', 'played': ['Down Under'],
               'played_ids': ['s1'], 'autoDaub': False, 'reveal': 'end'}),                   # musical/host.html:977
    ('both',  {'t': 'clipctl', 'action': 'play'}),                                           # musical/host.html:1068
    ('both',  {'t': 'reveal', 'title': 'Down Under', 'artist': 'Men At Work'}),              # musical/host.html:963
    ('both',  {'t': 'claim_pending', 'name': 'Sam', 'count': 1}),                            # musical/host.html:709
    ('both',  {'t': 'resume', 'pid': 'p1', 'more': 0}),                                      # musical/host.html:1544
    ('both',  {'t': 'winner', 'pid': 'p1', 'name': 'Sam', 'cardNo': '001', 'pids': ['p1'],
               'names': ['Sam'], 'cardNos': ['001'], 'split': False}),                        # musical/host.html:1444
    ('both',  {'t': 'carryon', 'pattern': 'full', 'prize': 'the house prize',
               'played': ['Down Under']}),                                                   # musical/host.html:1530
    ('both',  {'t': 'idle'}),                                                                # musical/host.html:1518
    ('tv',    {'t': 'to_ads'}),                                                              # musical/host.html:1520
]

# MEMBERS DRAW, from venueplay/app/members/host.html. One channel: members/host.html:710.
# There is no players channel: a members draw has no phones in the game, so everything
# the console sends goes to the screen.
MEMBERS = [
    ('both', {'t': 'host_here'}),                                                            # members/host.html:717
    ('both', {'t': 'mode', 'mode': 'members'}),                                              # members/host.html:717
    ('both', {'t': 'state', 'drawName': 'Thursday Members Draw', 'jackpotCents': 125000,
              'playing': False, 'draws': [{'id': 'd1', 'name': 'Thursday Members Draw'}]}),  # members/host.html:370
    ('both', {'t': 'drawing', 'drawName': 'Thursday Members Draw', 'minNumber': 1,
              'maxNumber': 4000, 'spinSecs': 8}),                                            # members/host.html:541
    ('both', {'t': 'winner', 'number': 1234, 'name': 'Sam Taylor', 'claimSecs': 180}),       # members/host.html:559
    ('both', {'t': 'claimed', 'name': 'Sam Taylor', 'amountCents': 125000,
              'nextResetCents': 20000}),                                                     # members/host.html:595
    ('both', {'t': 'rollover', 'nextJackpotCents': 135000, 'incrementCents': 10000,
              'missedNumber': 1234, 'missedName': 'Sam Taylor'}),                            # members/host.html:610
    ('both', {'t': 'idle', 'drawName': 'Thursday Members Draw', 'jackpotCents': 135000,
              'draws': [{'id': 'd1', 'name': 'Thursday Members Draw'}]}),                    # members/host.html:372
    ('both', {'t': 'to_ads'}),                                                               # members/host.html:828
]

# RAFFLE, from venueplay/app/raffle/host.html. One channel: raffle/host.html:880.
# Same as the members draw: the tickets are paper, so there are no phones on a channel.
RAFFLE = [
    ('both', {'t': 'host_here'}),                                                            # raffle/host.html:887
    ('both', {'t': 'mode', 'mode': 'raffle'}),                                               # raffle/host.html:887
    ('both', {'t': 'state', 'prizeLabel': 'Meat tray 1', 'pad': 3, 'min': 1, 'max': 400}),   # raffle/host.html:621
    ('both', {'t': 'drawing', 'prizeLabel': 'Meat tray 1', 'pad': 3, 'min': 1, 'max': 400,
              'spinSecs': 6}),                                                               # raffle/host.html:622
    ('both', {'t': 'winner', 'numbers': [117], 'prizeLabel': 'Meat tray 1',
              'allowRedraw': True, 'pad': 3, 'min': 1, 'max': 400, 'time': 60}),             # raffle/host.html:746
    ('both', {'t': 'redraw', 'numbers': [117], 'pad': 3, 'min': 1, 'max': 400,
              'prizeLabel': 'Meat tray 1', 'noticeMs': 2500}),                               # raffle/host.html:829
    ('both', {'t': 'claimed', 'numbers': [118], 'prizeLabel': 'Meat tray 1', 'pad': 3,
              'min': 1, 'max': 400}),                                                        # raffle/host.html:803
    ('both', {'t': 'idle', 'prizeLabel': 'Meat tray 2', 'pad': 3, 'min': 1, 'max': 400,
              'next': True, 'prizes': ['Meat tray 2']}),                                     # raffle/host.html:619
    ('both', {'t': 'to_ads'}),                                                               # raffle/host.html:1078
]

SPEC = {
    'bingo':   {'title': 'bingo',        'two': False, 'msgs': BINGO},
    'trivia':  {'title': 'trivia',       'two': True,  'msgs': TRIVIA},
    'musical': {'title': 'musical bingo', 'two': True, 'msgs': MUSICAL},
    'members': {'title': 'members draw', 'two': False, 'msgs': MEMBERS},
    'raffle':  {'title': 'raffle',       'two': False, 'msgs': RAFFLE},
}

# The room drops a socket's 21st message inside one second (venueplay-room.js,
# ROOM_MAX_PER_SEC). A real console never gets close. Pace the test so the cap is not
# what this is measuring.
PACE = 0.07

# A message crosses the room in about 25 ms. Three seconds is 100 times that, and it is
# also what a whole red run costs per dropped message, so it is not set any higher.
HEARD_TIMEOUT = 3.0

async def recv(sock, timeout=HEARD_TIMEOUT):
    try:
        return json.loads(await asyncio.wait_for(sock.recv(), timeout=timeout))
    except (asyncio.TimeoutError, ValueError):
        return None
    except Exception:
        return None

async def silent(sock, timeout=0.8):
    """Returns None when nothing arrived, which is what most of these checks want."""
    try:
        return await asyncio.wait_for(sock.recv(), timeout=timeout)
    except asyncio.TimeoutError:
        return None
    except Exception:
        return None

async def drain(sock):
    while await silent(sock, 0.15) is not None:
        pass

def wsurl(room, role):
    return f'wss://{HOST}/room/ws?room={room}&role={role}'

async def presence_until(room, pred, secs=4.0):
    """Presence is read over HTTPS, so a socket that has just closed can take a moment to
    disappear. Poll rather than sleep and hope."""
    end = time.time() + secs
    st, d = presence(room)
    while time.time() < end and not pred(d):
        time.sleep(0.3)
        st, d = presence(room)
    return st, d


async def play(fmt):
    spec = SPEC[fmt]
    two = spec['two']
    tv_room = f'{BASE}-{fmt}'
    play_room = f'{tv_room}-play' if two else tv_room

    print(f'\n\n########## {spec["title"].upper()} ##########')
    if two:
        print(f'screen channel  {tv_room}')
        print(f'players channel {play_room}')
    else:
        print(f'one channel     {tv_room}')

    print('\n== 1. is the room server there at all? ==')
    st, d = presence(tv_room)
    if st == 503:
        print('  the Worker answers 503 "room server not enabled": no ROOM binding on this Worker.')
        print('  deploy it with --do-class=VenueRoom and run this again.')
        return False
    ok('presence answers for an empty room', st == 200 and d.get('total') == 0, f'{st} {d}')

    print('\n== 2. a host, a TV and a phone walk in ==')
    stack = contextlib.AsyncExitStack()
    async with stack:
        conn = lambda room, role: stack.enter_async_context(
            websockets.connect(wsurl(room, role), open_timeout=15))
        host_tv = await conn(tv_room, 'host')
        tv = await conn(tv_room, 'tv')
        if two:
            host_play = await conn(play_room, 'host')
            phone = await conn(play_room, 'phone')
        else:
            host_play = host_tv
            phone = await conn(tv_room, 'phone')
        await asyncio.sleep(0.5)

        if two:
            st, d = presence(tv_room)
            ok('presence sees the host and the TV on the screen channel',
               d.get('host') == 1 and d.get('tv') == 1 and d.get('phone') == 0, json.dumps(d))
            st, d = presence(play_room)
            ok('presence sees the host and the phone on the players channel',
               d.get('host') == 1 and d.get('phone') == 1 and d.get('tv') == 0, json.dumps(d))
        else:
            st, d = presence(tv_room)
            ok('presence sees all three, by role',
               d.get('host') == 1 and d.get('tv') == 1 and d.get('phone') == 1, json.dumps(d))

        print('\n== 3. the console plays a night, and the room carries every message ==')
        slowest = 0.0
        for who, msg in spec['msgs']:
            t0 = time.time()
            if who in ('both', 'tv'):
                await host_tv.send(json.dumps(msg))
            # bcast() on a two-channel format is two sends, one per channel. On a
            # one-channel format host_play IS host_tv, so sending again would put two
            # copies of every message on the wall.
            if two and who in ('both', 'phone'):
                await host_play.send(json.dumps(msg))
            heard_tv = await recv(tv) if who in ('both', 'tv') else await silent(tv)
            heard_ph = await recv(phone) if who in ('both', 'phone') else await silent(phone)
            took = time.time() - t0
            slowest = max(slowest, took)
            if who == 'both':
                good = heard_tv == msg and heard_ph == msg
                label = 'reaches the TV and a phone'
            elif who == 'tv':
                good = heard_tv == msg and heard_ph is None
                label = 'reaches the TV, and no phone hears it'
            else:
                good = heard_ph == msg and heard_tv is None
                label = 'reaches a phone, and the TV does not hear it'
            ok(f'{msg["t"]:<14} {label}', good,
               f'sent {msg}, TV got {heard_tv}, phone got {heard_ph}')
            await asyncio.sleep(PACE)
        print(f'         (slowest message host to room to screen: {slowest * 1000:.0f} ms)')

        if fmt == 'trivia':
            """PHASE 2: THE PHONES' ANSWERS ARE HELD BY THE ROOM, NOT WRITTEN ONE BY ONE.

            Thirty phones answering every twenty five seconds was thirty database writes a
            question, and that is what took fifteen trivia venues past what the database
            will serve (the TVs went from an 89 ms check-in to a 19 second one). Now the
            phone hands its answer to a room named after the game and the host's Reveal
            writes the lot in one go.

            What this can prove from outside, and does: the room takes an answer and says
            so, it never lets another phone or the screen see what somebody picked, a
            second answer from the same phone cannot change the first, junk is refused,
            and an answer survives the phone's socket dying, which is the only evidence
            from out here that it went to disk rather than to a variable.

            What it CANNOT prove from outside, on purpose: the handover itself. There is
            no public route that hands a room's answers over or closes a question, because
            those are the night's result and nothing on the internet gets to ask for them.
            That half is proved by venueplay-room.test.js against the class, and by
            game-load.py, which plays real games with a real host and counts the rows.
            """
            game = str(uuid.uuid4())
            aroom = 'vpa-' + game
            h1 = hashlib.sha256(b'phone-one-token').hexdigest()
            h2 = hashlib.sha256(b'phone-two-token').hexdigest()
            print('\n== 3b. the answers room holds a question ==')
            print(f'answers room    {aroom}')
            st, d = presence(aroom)
            ok('a game nobody has answered yet has an empty room', st == 200 and d.get('total') == 0, f'{st} {d}')
            ph1 = await conn(aroom, 'phone')
            ph2 = await conn(aroom, 'phone')
            watch = await conn(aroom, 'tv')
            await asyncio.sleep(0.4)

            t0 = time.time()
            await ph1.send(json.dumps({'t': 'ans', 'g': game, 'q': 1, 'i': 2, 'h': h1, 'id': 'a1'}))
            got = await recv(ph1)
            took = (time.time() - t0) * 1000
            ok('the phone is told its answer is in', got is not None and got.get('t') == 'ans_ok' and got.get('id') == 'a1' and got.get('q') == 1, repr(got))
            print(f'         (phone to room and back: {took:.0f} ms)')
            leak_tv, leak_ph = await silent(watch), await silent(ph2)
            ok('and nobody else in the room learns what it picked',
               leak_tv is None and leak_ph is None, f'screen got {leak_tv}, other phone got {leak_ph}')

            await ph1.send(json.dumps({'t': 'ans', 'g': game, 'q': 1, 'i': 3, 'h': h1, 'id': 'a2'}))
            got = await recv(ph1)
            ok('the same phone answering again is told its first answer stands',
               got is not None and got.get('t') == 'ans_dup', repr(got))

            await ph2.send(json.dumps({'t': 'ans', 'g': game, 'q': 1, 'i': 0, 'h': h2, 'id': 'b1'}))
            got = await recv(ph2)
            ok('a second phone is held under its own name', got is not None and got.get('t') == 'ans_ok', repr(got))

            await ph2.send(json.dumps({'t': 'ans', 'g': game, 'q': 1, 'i': 0, 'h': h1, 'id': 'b2'}))
            got = await recv(ph2)
            ok('one phone may not answer as another', got is not None and got.get('t') == 'ans_no', repr(got))

            await ph1.send(json.dumps({'t': 'ans', 'g': game, 'q': 1, 'i': 99, 'h': h1, 'id': 'a3'}))
            got = await recv(ph1)
            ok('an option nobody could have tapped is refused', got is not None and got.get('t') == 'ans_no', repr(got))
            await ph1.send(json.dumps({'t': 'ans', 'g': 'not-a-game', 'q': 1, 'i': 1, 'h': h1, 'id': 'a4'}))
            got = await recv(ph1)
            ok('a made-up game id is refused', got is not None and got.get('t') == 'ans_no', repr(got))

            await ph1.send(json.dumps({'t': 'join', 'pid': 'p1', 'tok': 'a-token-shaped-thing'}))
            leak_tv = await silent(watch)
            ok('a message carrying a token reaches nobody', leak_tv is None, repr(leak_tv))

            # THE ONE THAT MATTERS: the answer is on disk, not in a variable. Kill the socket
            # that gave it, come back as a new one, and the room still knows the answer stands.
            await ph1.close()
            await asyncio.sleep(0.5)
            back = await conn(aroom, 'phone')
            await asyncio.sleep(0.3)
            await back.send(json.dumps({'t': 'ans', 'g': game, 'q': 1, 'i': 3, 'h': h1, 'id': 'c1'}))
            got = await recv(back)
            ok('an answer outlives the phone that gave it, so it was written down',
               got is not None and got.get('t') == 'ans_dup', repr(got))

            await back.send(json.dumps({'t': 'ans', 'g': game, 'q': 2, 'i': 1, 'h': h1, 'id': 'c2'}))
            got = await recv(back)
            ok('and the next question is a clean sheet', got is not None and got.get('t') == 'ans_ok', repr(got))
            await ph2.close(); await back.close(); await watch.close()
            await asyncio.sleep(0.3)
            await drain(tv); await drain(phone)
            if two: await drain(host_tv); await drain(host_play)

        print('\n== 4. a phone that turns up mid game can speak, and the host hears it ==')
        late = await conn(play_room, 'phone')
        await asyncio.sleep(0.3)
        await late.send(json.dumps({'t': 'join', 'pid': 'p9', 'name': 'Jo', 'cards': 1}))
        heard = await recv(host_play)
        ok('the host hears a phone that joined late',
           heard is not None and heard.get('t') == 'join' and heard.get('pid') == 'p9', repr(heard))
        await drain(tv); await drain(phone)
        if two: await drain(host_tv)

        await asyncio.sleep(PACE)
        await host_play.send(json.dumps({'t': 'players', 'count': 3}))
        back = await recv(late)
        ok('and the late phone hears the next message from the host',
           back == {'t': 'players', 'count': 3}, repr(back))
        await drain(tv); await drain(phone)
        await late.close()
        await asyncio.sleep(0.3)
        await drain(tv); await drain(phone)

        print('\n== 5. junk reaches nobody ==')
        await asyncio.sleep(PACE)
        await host_tv.send(json.dumps({'n': 1, 'called': [7]}))     # a message with no type at all
        leak_tv = await silent(tv)
        leak_ph = None if two else await silent(phone)
        ok('a message with no type reaches nobody', leak_tv is None and leak_ph is None,
           f'TV got {leak_tv}, phone got {leak_ph}')
        await asyncio.sleep(PACE)
        await host_tv.send('this is not JSON at all')
        leak_tv = await silent(tv)
        leak_ph = None if two else await silent(phone)
        ok('a message that is not JSON reaches nobody', leak_tv is None and leak_ph is None,
           f'TV got {leak_tv}, phone got {leak_ph}')
        await asyncio.sleep(PACE)
        await host_tv.send(json.dumps({'t': 'host_here'}))
        alive = await recv(tv)
        ok('and the socket still works after the junk', alive == {'t': 'host_here'}, repr(alive))
        await drain(phone)

        print('\n== 6. the screen drops off and comes back ==')
        await tv.close()
        st, d = await presence_until(tv_room, lambda x: x.get('tv') == 0)
        ok('presence notices the screen has gone', d.get('tv') == 0, json.dumps(d))
        tv2 = await conn(tv_room, 'tv')
        await asyncio.sleep(0.4)
        await drain(phone)
        await host_tv.send(json.dumps({'t': 'mode', 'mode': fmt}))
        back = await recv(tv2)
        ok('a screen that reconnects still gets the next message',
           back == {'t': 'mode', 'mode': fmt}, repr(back))
        st, d = await presence_until(tv_room, lambda x: x.get('tv') == 1)
        ok('and presence counts the reconnected screen once, not twice',
           d.get('tv') == 1, json.dumps(d))
        await drain(phone)

        print('\n== 7. nobody hears their own voice ==')
        await asyncio.sleep(PACE)
        await host_tv.send(json.dumps({'t': 'idle'}))
        echo = await silent(host_tv, 1.0)
        ok('the console does not hear its own message', echo is None, repr(echo))

    await asyncio.sleep(0.6)
    print('\n== 8. everyone goes home ==')
    st, d = await presence_until(tv_room, lambda x: x.get('total') == 0)
    ok('the screen channel empties', d.get('total') == 0, json.dumps(d))
    if two:
        st, d = await presence_until(play_room, lambda x: x.get('total') == 0)
        ok('the players channel empties', d.get('total') == 0, json.dumps(d))
    return True



async def crosstalk(a, b):
    """Two formats running in the same venue at the same time must not hear each other.

    They meet on different channel names on purpose: VP.venueCode("trivia-<slug>") is not
    VP.venueCode("musical-<slug>") (trivia/host.html:1058, musical/host.html:1891,
    members/host.html:815, raffle/host.html:1031, and bingo's plain VP.venueCode(slug) at
    index.html:751). If that ever collapses to one name, a trivia question lands on the
    musical bingo screen and nothing on either screen says so."""
    print(f'\n\n########## TWO FORMATS AT ONCE: {a} AND {b} ##########')
    room_a, room_b = f'{BASE}-{a}', f'{BASE}-{b}'
    ok('the two formats ask for different room names', room_a != room_b, f'{room_a} vs {room_b}')
    async with websockets.connect(wsurl(room_a, 'host'), open_timeout=15) as host_a, \
               websockets.connect(wsurl(room_a, 'tv'), open_timeout=15) as tv_a, \
               websockets.connect(wsurl(room_b, 'host'), open_timeout=15) as host_b, \
               websockets.connect(wsurl(room_b, 'tv'), open_timeout=15) as tv_b:
        await asyncio.sleep(0.5)
        msg_a = {'t': 'mode', 'mode': a}
        await host_a.send(json.dumps(msg_a))
        heard_a = await recv(tv_a)
        heard_b = await silent(tv_b)
        ok(f'the {a} screen hears the {a} console', heard_a == msg_a, repr(heard_a))
        ok(f'the {b} screen hears nothing of it', heard_b is None, repr(heard_b))

        await asyncio.sleep(PACE)
        msg_b = {'t': 'mode', 'mode': b}
        await host_b.send(json.dumps(msg_b))
        heard_b = await recv(tv_b)
        heard_a = await silent(tv_a)
        ok(f'the {b} screen hears the {b} console', heard_b == msg_b, repr(heard_b))
        ok(f'the {a} screen hears nothing of it', heard_a is None, repr(heard_a))

        st, d = presence(room_a)
        ok(f'presence for {a} counts only the {a} room', d.get('total') == 2, json.dumps(d))


async def main():
    print(f'a test game on {HOST}, rooms under {BASE}')
    print('formats: ' + ', '.join(formats))
    for fmt in formats:
        alive = await play(fmt)
        if not alive:
            sys.exit(1)
    pair = formats if len(formats) > 1 else [formats[0], 'bingo' if formats[0] != 'bingo' else 'trivia']
    await crosstalk(pair[0], pair[1])

asyncio.run(main())
print()
if bad:
    print(f'{bad} CHECK(S) FAILED. Do not put this build in front of a room.'); sys.exit(1)
print('THE TEST GAME PLAYED THROUGH IN EVERY FORMAT ASKED FOR.')
print('Every message each console sends reached the screens that should hear it, and none')
print('reached the ones that should not.')
