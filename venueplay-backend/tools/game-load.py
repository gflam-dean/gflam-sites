#!/usr/bin/env python3
"""Drive a seeded project like a Tuesday night: thousands of TVs polling, a thousand
rooms mid-game across trivia, musical bingo, bingo and raffles, with a real host login
pressing the buttons in every room and every phone in every trivia room answering.

This is the test load-test.py cannot do. That one is read-only because it points
at production. This one WRITES (answers, song plays, balls and raffle draws all land
in the database), so it refuses the production Workers outright, with no override,
and expects a staging Worker whose SUPABASE_URL is the seeded Sydney project.

What each kind of room does (game-load-seed.py --mix decides how many of each):
  trivia         the host asks the next question every --round-seconds, reveals 6 s
                 before it; every phone answers once per question at a random moment
  musical bingo  the host plays the next song every --song-seconds; phones hold their
                 card and do nothing, bar the odd one reopening the page (/player/card)
  bingo          the host starts a server draw, then calls a ball every --ball-seconds
                 (the Worker holds a ball on the screen 4 s, so 9 s is a brisk caller)
  raffle         the host draws a ticket every --raffle-seconds
  every venue    its TV asks /venue?code= every --poll-seconds, whether it is playing or not

The host is one real Supabase Auth account, staff at every load venue (the seed made
it). Its password is read from ~/.gflam-migrate/load-host.pass and never printed.
Joins are NOT driven: one laptop is one IP and the Worker caps joins per IP at 300 a
minute, correctly. The players are seeded already joined.

Python threads top out around 250 requests a second per process because of the
interpreter lock, so this fans out over several processes. A room's host and its
players live in the same process, so the phones know which question is open.

Run:  python3 game-load.py --target https://venueplay-game-sydney.<acct>.workers.dev --minutes 3
"""
import os, sys, re, json, time, random, argparse, asyncio, hashlib, threading, heapq, subprocess, ssl, http.client, collections, urllib.request, urllib.error, multiprocessing as mp
from pathlib import Path

WORK = Path.home() / '.gflam-migrate'
ENV_FILE = Path.home() / '.gflam-migrate.env'
PASS_FILE = WORK / 'load-host.pass'
PG = '/Applications/Postgres.app/Contents/Versions/latest/bin'
PROD = ('venueplay-game.dean-tindale.workers.dev', 'venueplay-api.dean-tindale.workers.dev', 'partyplay-api.dean-tindale.workers.dev')
UA = {'User-Agent': 'venueplay-game-load/2.0', 'Content-Type': 'application/json'}
CTX = ssl.create_default_context()
LIVE_REF = 'ijkzgmdtwtgfkedqspxm'

def env():
    e = {}
    for line in ENV_FILE.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    for k in ('NEW_DB_URL', 'NEW_SUPABASE_URL', 'NEW_ANON_KEY'):
        if not e.get(k): sys.exit(k + ' missing from the env file')
        if LIVE_REF in e[k]: sys.exit('REFUSED: ' + k + ' is the live project')
    return e

def psql(url, sql):
    r = subprocess.run([PG + '/psql', url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(re.sub(r'postgres(?:ql)?://\S+', '<db-url>', r.stderr)[:300])
    return [l for l in r.stdout.splitlines() if l.strip()]

def host_login(e, email):
    """Sign the load host in with its password from PASS_FILE. Returns (jwt, seconds it lasts)."""
    if not PASS_FILE.exists(): sys.exit(str(PASS_FILE) + ' is missing; run game-load-seed.py first')
    body = json.dumps({'email': email, 'password': PASS_FILE.read_text().strip()}).encode()
    req = urllib.request.Request(e['NEW_SUPABASE_URL'] + '/auth/v1/token?grant_type=password', data=body, method='POST',
                                 headers={'apikey': e['NEW_ANON_KEY'], 'Content-Type': 'application/json'})
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=20).read())
    except urllib.error.HTTPError as x:
        sys.exit('host sign-in failed (HTTP %d): %s' % (x.code, x.read()[:200].decode(errors='replace')))
    return d['access_token'], int(d.get('expires_in', 3600))


# ------------------------------------------------------------------ answers over the room
try:
    import websockets
except ImportError:
    websockets = None


class RoomPhones:
    """PHASE 2: the phones answer over the venue's room instead of writing to the database.

    Thirty phones answering every twenty five seconds was thirty database writes a question,
    which is what took fifteen trivia rooms past what the gateway will serve. With --answers
    room each phone holds one WebSocket to the room named after its game and sends its answer
    there; the room writes it to its own disk and answers straight back, and the host's Reveal
    puts the whole room in with one insert.

    One asyncio loop per worker process owns every socket that process's phones need. The
    game threads call answer() and block on the acknowledgement, so the number this records
    is what the punter's thumb actually waited for, measured the same way as the HTTP one.
    """
    def __init__(self, host):
        self.host = host
        self.loop = asyncio.new_event_loop()
        self.socks, self.waits, self.n = {}, {}, 0
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    async def _reader(self, key, ws):
        try:
            async for raw in ws:
                try: m = json.loads(raw)
                except Exception: continue
                fut = self.waits.pop(m.get('id'), None)
                if fut is not None and not fut.done(): fut.set_result(m.get('t'))
        except Exception:
            pass
        finally:
            if self.socks.get(key) is ws: self.socks.pop(key, None)

    async def _sock(self, key, game):
        ws = self.socks.get(key)
        if ws is not None: return ws
        ws = await websockets.connect('wss://%s/room/ws?room=vpa-%s&role=phone' % (self.host, game),
                                      open_timeout=20, ping_interval=30, close_timeout=5)
        self.socks[key] = ws
        asyncio.ensure_future(self._reader(key, ws))
        return ws

    async def _answer(self, key, game, qseq, idx, h):
        ws = await self._sock(key, game)
        self.n += 1
        mid = 'x%d' % self.n
        fut = self.loop.create_future()
        self.waits[mid] = fut
        await ws.send(json.dumps({'t': 'ans', 'g': game, 'q': qseq, 'i': idx, 'h': h, 'id': mid}))
        try:
            return await asyncio.wait_for(fut, 8)
        finally:
            self.waits.pop(mid, None)

    def answer(self, key, game, qseq, idx, h):
        return asyncio.run_coroutine_threadsafe(self._answer(key, game, qseq, idx, h), self.loop).result(timeout=15)


# ------------------------------------------------------------------ worker process
def worker(idx, target, tvs, rooms, cfg, stop_at, shared, out):
    """tvs: list of codes. rooms: manifest rooms (this process owns their host AND their
    players). Each thread owns a slice and runs a little schedule off a heap."""
    host = re.match(r'https?://([^/]+)', target).group(1)
    lat = collections.defaultdict(list); status = collections.Counter(); errors = collections.Counter()
    phones = RoomPhones(host) if cfg.get('answers') == 'room' else None
    lock = threading.Lock()
    random.seed(idx * 7919)
    start = time.time()
    songs = cfg['songs']
    # per-room state shared between the host thread and the player threads of this process
    # STAGGER THE ROOMS, or the number you measure is one this product never sees.

    # Every room used to start its first question at the SAME INSTANT, so every room
    # reached its first reveal at the same instant too, and a reveal is the expensive
    # one: it scores a whole room and writes the answers. Measured 10 Sep 2026, and it
    # is unmistakable once you look at WHEN the slow requests happened rather than how
    # many there were:

    # 60 rooms   0 slow for the first 10s, then 517 in a burst at 24-29s, then 9 more
    # in the next 95 seconds
    # 36 rooms   0 slow for the first 16s, then 174 in a burst at 28-34s, then NONE

    # The round is 25 seconds. The burst is the first round boundary, arriving for every
    # room at once. That one burst was the whole of the "1% tail of about ten seconds"
    # that looked like the database running out of headroom, and steady state was clean
    # the whole time. Real venues do not start together: they open when they open and
    # drift apart within a question.

    # So each room now starts somewhere inside its first round. --in-step brings back the
    # old behaviour deliberately, because a thundering herd IS worth measuring; it just
    # must not be mistaken for the ordinary case.
    state = {}
    for r in rooms:
        offset = 0 if cfg.get('in_step') else random.uniform(0, cfg['round'])
        state[r['game_id']] = {'qseq': 1, 'asked_at': start + offset, 'draw_id': None,
                               'song_i': idx, 'balls': 0, 'done': False}
    slock = threading.Lock()

    def run_thread(my_tvs, my_players, my_hosts):
        conn = None
        def req(kind, method, path, body=None, headers=None):
            """One request on this thread's kept-open connection. Returns (status, parsed json or None)."""
            nonlocal conn
            t0 = time.time()
            for attempt in (0, 1):
                try:
                    if conn is None: conn = http.client.HTTPSConnection(host, timeout=25, context=CTX)
                    h = dict(UA); h.update(headers or {})
                    conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
                    r = conn.getresponse(); data = r.read(30000)
                    ms = (time.time() - t0) * 1000
                    code = r.status
                    try: parsed = json.loads(data)
                    except Exception: parsed = None
                    if kind == 'answer' and code == 200 and isinstance(parsed, dict):
                        code = 'recorded' if parsed.get('recorded') else 'already'
                    with lock:
                        lat[kind].append(ms); status[(kind, code)] += 1
                        if isinstance(code, int) and code >= 400 and isinstance(parsed, dict) and parsed.get('error'):
                            errors['%s %s: %s' % (kind, code, str(parsed['error'])[:70])] += 1
                    with shared['sent'].get_lock():
                        shared['sent'].value += 1
                        if ms > 1000: shared['slow'].value += 1
                    return code, parsed
                except Exception as e:
                    try: conn.close()
                    except Exception: pass
                    conn = None
                    if attempt:
                        with lock: lat[kind].append((time.time() - t0) * 1000); status[(kind, 0)] += 1; errors[str(e)[:60]] += 1
            return 0, None
        def auth():
            return {'Authorization': 'Bearer ' + shared['jwt'].value.decode()}

        # schedule: (when, kind, payload)
        now = time.time()
        heap = [(now + random.uniform(0, cfg['poll']), 'tv', c) for c in my_tvs]
        for token, room in my_players:
            if room['format'] == 'trivia':
                heap.append((now + random.uniform(1, cfg['round'] - 8), 'answer', (token, room, 0)))
            elif room['format'] == 'musical_bingo':   # bingo phones hold a ticket off the broadcast; no card route
                heap.append((now + random.uniform(5, max(6, stop_at - now - 5)), 'card', (token, room)))
        for room in my_hosts:
            f = room['format']
            # hosts are never in step: the first reveal lands anywhere in the first two rounds
            if f == 'trivia':       heap.append((now + random.uniform(cfg['round'] - 6, 2 * cfg['round'] - 6), 'reveal', room))
            elif f == 'musical_bingo': heap.append((now + random.uniform(1, cfg['song']), 'song', room))
            elif f == 'bingo90':    heap.append((now + random.uniform(1, 10), 'drawstart', room))
            elif f == 'raffle':     heap.append((now + random.uniform(5, cfg['raffle']), 'raffle', room))
        heapq.heapify(heap)
        while heap and time.time() < stop_at:
            when, kind, payload = heap[0]
            if when > time.time():
                # max(0, ...): under load the schedule falls behind and this went negative,
                # which is a ValueError that kills the whole thread and quietly takes its
                # phones out of the test. It happened in the 10 Sep before-run.
                time.sleep(max(0.0, min(0.25, when - time.time()))); continue
            heapq.heappop(heap)
            if kind == 'tv':
                req('tv poll', 'GET', '/venue?code=' + payload)
                heapq.heappush(heap, (when + cfg['poll'], 'tv', payload))
            elif kind == 'answer':
                token, room, last = payload
                with slock: st = dict(state[room['game_id']])
                if st['done']: continue
                if st['qseq'] == last:
                    # the host has not asked the next one yet; look again shortly
                    heapq.heappush(heap, (time.time() + 1.0, 'answer', payload)); continue
                idx = random.randint(0, 1)
                if phones is None:
                    req('answer', 'POST', '/player/answer', {'game_id': room['game_id'], 'answer_index': idx, 'qseq': st['qseq']},
                        {'X-Player-Token': token})
                else:
                    # The room knows a phone by the sha256 of its player token, which is exactly
                    # what the Worker looks a phone up by. The token itself never goes over the wire.
                    t0 = time.time()
                    try:
                        got = phones.answer((room['game_id'], token), room['game_id'], st['qseq'], idx,
                                            hashlib.sha256(token.encode()).hexdigest())
                    except Exception as ex:
                        got = 'no reply'
                        with lock: errors['answer over the room: ' + str(ex)[:60]] += 1
                    ms = (time.time() - t0) * 1000
                    if got in ('ans_ok', 'ans_dup'):
                        with lock:
                            lat['answer'].append(ms)
                            status[('answer', 'recorded' if got == 'ans_ok' else 'already')] += 1
                        with shared['sent'].get_lock():
                            shared['sent'].value += 1
                            if ms > 1000: shared['slow'].value += 1
                    else:
                        # EXACTLY WHAT THE PHONE DOES (trivia/play.html, sendAnswer): the room is
                        # not the judge of a late or refused answer, so ask the Worker, which
                        # answers precisely as it did before there was a room. Without this the
                        # test would quietly drop those answers and flatter itself.
                        with lock: status[('answer', 'room said ' + str(got) + ', asked the Worker')] += 1
                        if os.environ.get('VP_DEBUG_ANS'):
                            print('  DEBUG %7.1fs room said %s for %s qseq %s' % (time.time() - start, got, room['game_id'][:8], st['qseq']), flush=True)
                        req('answer', 'POST', '/player/answer',
                            {'game_id': room['game_id'], 'answer_index': idx, 'qseq': st['qseq']},
                            {'X-Player-Token': token})
                heapq.heappush(heap, (st['asked_at'] + cfg['round'] + random.uniform(1, cfg['round'] - 8), 'answer', (token, room, st['qseq'])))
            elif kind == 'card':
                token, room = payload
                req('player card', 'GET', '/player/card', None, {'X-Player-Token': token})
            elif kind == 'reveal':
                room = payload
                _c, _d = req('host reveal', 'POST', '/host/reveal', {'game_id': room['game_id']}, auth())
                if os.environ.get('VP_DEBUG_ANS'):
                    with slock: _sq = state[room['game_id']]['qseq']
                    print('  DEBUG %7.1fs reveal %s -> %s revealed qseq %s (driver thinks %s)'
                          % (time.time() - start, room['game_id'][:8], _c, (_d or {}).get('qseq'), _sq), flush=True)
                with slock: asked = state[room['game_id']]['asked_at']
                heapq.heappush(heap, (asked + cfg['round'], 'question', room))
            elif kind == 'question':
                room = payload
                code, d = req('host question', 'POST', '/host/question', {'game_id': room['game_id']}, auth())
                t = time.time()
                if os.environ.get('VP_DEBUG_ANS'):
                    print('  DEBUG %7.1fs question %s -> %s qseq %s' % (time.time() - start, room['game_id'][:8], code, (d or {}).get('qseq') or (d or {}).get('done')), flush=True)
                with slock:
                    s = state[room['game_id']]
                    if code == 200 and isinstance(d, dict) and d.get('qseq'):
                        s['qseq'] = int(d['qseq']); s['asked_at'] = t
                    elif code == 200 and isinstance(d, dict) and d.get('done'):
                        s['done'] = True
                    else:
                        s['asked_at'] = t   # keep the rhythm; the phones will try the same question again
                if not state[room['game_id']]['done']:
                    heapq.heappush(heap, (t + cfg['round'] - 6, 'reveal', room))
            elif kind == 'song':
                room = payload
                with slock: s = state[room['game_id']]; i = s['song_i']; s['song_i'] += 1
                req('host song', 'POST', '/host/play', {'game_id': room['game_id'], 'song_id': songs[i % len(songs)]}, auth())
                heapq.heappush(heap, (when + cfg['song'], 'song', room))
            elif kind == 'drawstart':
                room = payload
                code, d = req('host draw start', 'POST', '/host/bingo/draw', {'venue_id': room['venue_id'], 'session_id': room['session_id']}, auth())
                if code == 200 and isinstance(d, dict) and d.get('draw_id'):
                    with slock: state[room['game_id']]['draw_id'] = d['draw_id']; state[room['game_id']]['balls'] = 0
                    heapq.heappush(heap, (time.time() + cfg['ball'], 'ball', room))
                else:
                    heapq.heappush(heap, (time.time() + 15, 'drawstart', room))
            elif kind == 'ball':
                room = payload
                with slock: s = state[room['game_id']]; draw_id = s['draw_id']
                code, d = req('host ball', 'POST', '/host/bingo/ball', {'draw_id': draw_id}, auth())
                with slock: s['balls'] += 1 if code == 200 else 0
                if code == 200 and s['balls'] < 90: heapq.heappush(heap, (when + cfg['ball'], 'ball', room))
                elif code == 200:                   heapq.heappush(heap, (when + 30, 'drawstart', room))      # full house; a new game
                elif code == 429:                   heapq.heappush(heap, (time.time() + 4, 'ball', room))      # the screen still holds the last ball
                else:                               heapq.heappush(heap, (time.time() + 20, 'drawstart', room))
            elif kind == 'raffle':
                room = payload
                code, d = req('host raffle', 'POST', '/host/draw', {'game_id': room['game_id']}, auth())
                heapq.heappush(heap, (when + cfg['raffle'], 'raffle', room))

    players = [('load-token-%s-%d' % (r['slug'], i), r) for r in rooms for i in range(1, r['players'] + 1) if not cfg['no_players']]
    hosts = [] if cfg['no_hosts'] else list(rooms)
    n = max(1, min(120, len(tvs) + len(players) + len(hosts)))
    threads = []
    for t in range(n):
        th = threading.Thread(target=run_thread, args=(tvs[t::n], players[t::n], hosts[t::n]), daemon=True)
        th.start(); threads.append(th)
    for th in threads: th.join()
    out.put((idx, dict(lat), dict(status), dict(errors)))

# ------------------------------------------------------------------ main
def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else 0

def canary(target, code):
    t0 = time.time()
    try:
        c = http.client.HTTPSConnection(re.match(r'https?://([^/]+)', target).group(1), timeout=8, context=CTX)
        c.request('GET', '/venue?code=' + code, headers=UA); r = c.getresponse(); body = r.read(4000); c.close()
        return (time.time() - t0) * 1000, r.status == 200 and b'"exists":true' in body
    except Exception:
        return 99999.0, False

def counts(url):
    """What is actually in the database for the load rooms, one query."""
    r = psql(url, """select
        (select count(*) from vp_trivia_answers a join vp_players p on p.id=a.player_id where p.display_name like 'Load %'),
        (select count(*) from vp_music_plays mp join vp_games g on g.id=mp.game_id join vp_sessions s on s.id=g.session_id join vp_venues v on v.id=s.venue_id where v.slug like 'load-%'),
        (select coalesce(sum(draw_index),0) from vp_bingo_draws d join vp_venues v on v.id=d.venue_id where v.slug like 'load-%'),
        (select count(*) from vp_raffle_results rr join vp_games g on g.id=rr.game_id join vp_sessions s on s.id=g.session_id join vp_venues v on v.id=s.venue_id where v.slug like 'load-%')""")[0]
    a, m, b, rf = (int(x) for x in r.split('|'))
    return {'answers': a, 'songs': m, 'balls': b, 'raffle draws': rf}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', required=True, help='the STAGING game Worker pointed at the seeded project')
    ap.add_argument('--minutes', type=float, default=3)
    ap.add_argument('--venues', type=int, help='use only the first N seeded venues (default all)')
    ap.add_argument('--rooms', type=int, help='use only the first N mid-game rooms (default all in the chosen venues)')
    ap.add_argument('--room-offset', type=int, default=0,
                    help='skip the first N rooms, so a repeat run can use venues the last one did not touch')
    ap.add_argument('--formats', default='trivia,musical_bingo,bingo90,raffle', help='which room formats to drive')
    ap.add_argument('--processes', type=int, default=6)
    ap.add_argument('--round-seconds', type=int, default=25, help='trivia: how often each host asks the next question')
    ap.add_argument('--in-step', action='store_true',
                    help='start every room at the same instant. Real venues do not, and the burst when they all\n                          reveal together was mistaken for the database running out of headroom. Use it to measure\n                          a thundering herd ON PURPOSE, never to measure an ordinary night.')
    ap.add_argument('--song-seconds', type=int, default=40, help='musical bingo: how often each host plays the next song')
    ap.add_argument('--ball-seconds', type=int, default=9, help='bingo: how often each host calls a ball')
    ap.add_argument('--raffle-seconds', type=int, default=60, help='raffle: how often each host draws')
    ap.add_argument('--poll-seconds', type=int, default=30)
    ap.add_argument('--answers', choices=['http', 'room'], default='http',
                    help="how trivia phones answer: 'http' writes one row each (the old road), "
                         "'room' hands the answer to the room and the host's Reveal writes them in one go")
    ap.add_argument('--no-tv', action='store_true'); ap.add_argument('--no-players', action='store_true'); ap.add_argument('--no-hosts', action='store_true')
    a = ap.parse_args()
    if a.answers == 'room':
        try:
            import websockets    # noqa: F401
        except ImportError:
            sys.exit('--answers room needs the websockets package (python3 -m pip install websockets)')
    host = a.target.split('//')[-1].split('/')[0]
    if host in PROD: sys.exit('REFUSED: %s is production. This test writes. Point it at the staging Worker.' % host)
    e = env(); url = e['NEW_DB_URL']
    man = json.loads((WORK / 'load-manifest.json').read_text())
    if 'host' not in man: sys.exit('the manifest is from the old seed; run game-load-seed.py --remove and seed again')
    venues = man['venues'][:a.venues] if a.venues else man['venues']
    slugs = {v['slug'] for v in venues}
    fmts = set(a.formats.split(','))
    rooms = [p for p in man['playing'] if p['slug'] in slugs and p['format'] in fmts]
    if a.room_offset: rooms = rooms[a.room_offset:]
    if a.rooms: rooms = rooms[:a.rooms]
    tvs = [] if a.no_tv else [v['code'] for v in venues]
    by_fmt = collections.Counter(r['format'] for r in rooms)
    n_players = sum(r['players'] for r in rooms if not a.no_players)
    n_trivia_players = sum(r['players'] for r in rooms if r['format'] == 'trivia' and not a.no_players)
    # sanity: does the staging Worker see the seeded project? A load venue must exist there.
    ms, ok = canary(a.target, venues[0]['code'])
    if not ok: sys.exit('%s does not know load venue %s (%s). Is its SUPABASE_URL the seeded Sydney project?' % (host, venues[0]['slug'], venues[0]['code']))
    jwt, ttl = host_login(e, man['host']['email'])
    print('GAME LOAD against %s' % host)
    print('  %s venues polling every %ds (%.0f/s)' % ('{:,}'.format(len(tvs)), a.poll_seconds, len(tvs) / a.poll_seconds))
    print('  %d rooms mid-game: %s' % (len(rooms), ', '.join('%d %s' % (n, f) for f, n in by_fmt.most_common())))
    print('  %s players, %s of them in trivia answering every %ds (%.0f/s)' % ('{:,}'.format(n_players), '{:,}'.format(n_trivia_players), a.round_seconds, n_trivia_players / a.round_seconds))
    hosts_per_s = (by_fmt['trivia'] * 2 / a.round_seconds + by_fmt['musical_bingo'] / a.song_seconds + by_fmt['bingo90'] / a.ball_seconds + by_fmt['raffle'] / a.raffle_seconds) if not a.no_hosts else 0
    print('  hosts: %d logins as one real account, about %.0f button presses a second' % (len(rooms) if not a.no_hosts else 0, hosts_per_s))
    print('  %d processes, %.1f minutes, one TV watched as the canary (%dms before we start)\n' % (a.processes, a.minutes, ms))
    # reset every seeded room so a re-run is comparable
    psql(url, "update vp_trivia_games t set current_seq=1, phase='asking', question_ends_at=now()+interval '1 day' from vp_games g join vp_sessions s on s.id=g.session_id join vp_venues v on v.id=s.venue_id where t.game_id=g.id and v.slug like 'load-%'")
    psql(url, "delete from vp_bingo_draws d using vp_venues v where v.id=d.venue_id and v.slug like 'load-%'")
    before = counts(url)
    shared = {'jwt': mp.Array('c', 4096), 'sent': mp.Value('i', 0), 'slow': mp.Value('i', 0)}
    shared['jwt'].value = jwt.encode()
    cfg = {'round': a.round_seconds, 'song': a.song_seconds, 'ball': a.ball_seconds, 'raffle': a.raffle_seconds, 'poll': a.poll_seconds, 'in_step': a.in_step,
           'songs': man['songs'], 'no_players': a.no_players, 'no_hosts': a.no_hosts, 'answers': a.answers}
    out = mp.Queue()
    stop_at = time.time() + a.minutes * 60
    procs = []
    for i in range(a.processes):
        pr = mp.Process(target=worker, args=(i, a.target, tvs[i::a.processes], rooms[i::a.processes], cfg, stop_at, shared, out))
        pr.start(); procs.append(pr)
    t0 = time.time(); last_sent, last_t = 0, t0; relogin_at = t0 + min(ttl - 300, 3000)
    print('%6s %9s %9s %9s %s' % ('time', 'sent', 'now/s', 'canary', 'over 1s so far'))
    while time.time() < stop_at:
        time.sleep(5)
        cms, cok = canary(a.target, venues[-1]['code'])
        sent, slow = shared['sent'].value, shared['slow'].value
        rate = (sent - last_sent) / max(0.001, time.time() - last_t); last_sent, last_t = sent, time.time()
        print('%5.0fs %9s %8.0f/s %8.0fms %s%s' % (time.time() - t0, '{:,}'.format(sent), rate, cms,
              '%s (%.1f%%)' % ('{:,}'.format(slow), 100.0 * slow / max(1, sent)), '' if cok else '  CANARY FAILED'), flush=True)
        if time.time() > relogin_at:
            try: jwt, ttl = host_login(e, man['host']['email']); shared['jwt'].value = jwt.encode(); relogin_at = time.time() + min(ttl - 300, 3000)
            except SystemExit as x: print('   host re-login failed: %s' % x)
    results = [out.get() for _ in procs]
    for pr in procs: pr.join(timeout=30)
    lat = collections.defaultdict(list); status = collections.Counter(); errors = collections.Counter()
    for _, l, s, er in results:
        for k, v in l.items(): lat[k] += v
        status.update(s); errors.update(er)
    secs = time.time() - t0; sent = sum(len(v) for v in lat.values())
    print('\n' + '=' * 70)
    print('%s requests in %.0fs = %.0f/s  (asked for about %.0f/s)' % ('{:,}'.format(sent), secs, sent / secs, len(tvs) / a.poll_seconds + n_trivia_players / a.round_seconds + hosts_per_s))
    print('\n%-16s %8s %8s %8s %8s %8s' % ('what', 'n', 'p50', 'p95', 'p99', 'max'))
    for k, xs in sorted(lat.items()):
        print('%-16s %8d %7.0fms %7.0fms %7.0fms %7.0fms' % (k, len(xs), pct(xs, .5), pct(xs, .95), pct(xs, .99), max(xs)))
    print('\noutcomes:')
    for (k, c), n in sorted(status.items(), key=lambda x: -x[1]):
        note = {'recorded': 'answer stored', 'already': 'same player, same question (a phone double tap)', 409: 'refused: moved on / not open / held',
                429: 'RATE LIMITED', 0: 'NO REPLY (timeout, refused, socket)', 401: 'LOGIN REFUSED', 403: 'NOT STAFF HERE'}.get(c, 'server error' if isinstance(c, int) and c >= 500 else '')
        print('   %-16s %-9s %7d   %s' % (k, c, n, note))
    if errors:
        print('\nerrors (most common):'); [print('   %5d  %s' % (n, er)) for er, n in errors.most_common(8)]
    after = counts(url)
    print('\nin the database afterwards: ' + ', '.join('+%s %s' % ('{:,}'.format(after[k] - before[k]), k) for k in before))
    print('the Worker said: %s answers recorded, %d songs, %d balls, %d raffle draws'
          % ('{:,}'.format(status[('answer', 'recorded')]), status[('host song', 200)], status[('host ball', 200)], status[('host raffle', 200)]))
    tv = lat.get('tv poll', []); an = lat.get('answer', [])
    hs = [x for k, xs in lat.items() if k.startswith('host') for x in xs]
    bad = sum(n for (k, c), n in status.items() if c in (0, 429, 401, 403) or (isinstance(c, int) and c >= 500))
    print('\nVERDICT: 95%% of TV polls under %.1fs, of phone answers under %.1fs, of host button presses under %.1fs; %s bad replies (no reply, rate limited, login, server error).'
          % (pct(tv, .95) / 1000 if tv else 0, pct(an, .95) / 1000 if an else 0, pct(hs, .95) / 1000 if hs else 0, '{:,}'.format(bad)))
    print('         "No delays" means all three under 1.0s and zero bad replies.')

if __name__ == '__main__':
    main()
