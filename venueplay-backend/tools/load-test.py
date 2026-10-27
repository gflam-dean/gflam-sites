#!/usr/bin/env python3
"""What breaks first when 3,000 venues are on VenuePlay at once.

WHY THIS EXISTS. The question is not "does a game work", which the gate now
answers, but "does it still work when three thousand venues are doing it". Those
fail differently: nothing throws, latency climbs, a connection pool empties, and
the first symptom is a room of people watching a screen that has stopped.

WHAT IT MODELS, from the real request mix rather than a guess:

  * SCREEN POLLS dominate and never stop. Every TV asks /venue?code= every
    thirty seconds whether a game is on or not. Three thousand venues is 100
    requests a second of floor before anybody plays anything.
  * BINGO IS BROADCAST-ONLY. Players do not touch the Worker during a bingo
    game; the host broadcasts and phones listen. So bingo costs almost nothing
    server-side and a lot on Realtime channels.
  * TRIVIA IS THE BURSTY ONE. Every player POSTs an answer per question, and the
    reveal scores them all in one request. Two hundred players times ten
    questions is where the Worker's subrequest limit bit once already.
  * SESSION LIFECYCLE is rare but heavy: open, close, the overage count.

SAFETY. It refuses the production Workers unless you pass --yes-production, and
even then read-only mode is the default. Dean has a live venue on these Workers
and a load test that takes their night down is worse than no load test.

  python3 load-test.py --target https://staging.example.workers.dev --venues 3000
  python3 load-test.py --target ... --venues 3000 --minutes 5 --profile peak
  python3 load-test.py --plan            just print what it WOULD send, and stop
"""
import argparse, collections, json, os, random, ssl, statistics, string, sys, threading, time
import http.client, urllib.parse, urllib.request, urllib.error

PROD = ('venueplay-game.dean-tindale.workers.dev',
        'venueplay-api.dean-tindale.workers.dev',
        'partyplay-api.dean-tindale.workers.dev')
ALPHA = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'
UA = {'User-Agent': 'venueplay-load-test/1.0', 'Content-Type': 'application/json'}
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE


def code():
    return ''.join(random.choice(ALPHA) for _ in range(6))


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.lat = collections.defaultdict(list)
        self.status = collections.Counter()
        self.errors = collections.Counter()
        self.sent = 0

    def add(self, kind, ms, status, err=None):
        with self.lock:
            self.sent += 1
            self.lat[kind].append(ms)
            self.status[status] += 1
            if err:
                self.errors[str(err)[:70]] += 1

    def report(self, seconds):
        print('\n' + '=' * 66)
        print('%d request(s) in %.0fs  =  %.0f/sec' % (self.sent, seconds, self.sent / max(1, seconds)))
        print('\n%-22s %7s %7s %7s %7s %7s' % ('what', 'n', 'p50', 'p95', 'p99', 'max'))
        for kind, xs in sorted(self.lat.items()):
            if not xs: continue
            xs = sorted(xs)
            def pct(p): return xs[min(len(xs) - 1, int(len(xs) * p))]
            print('%-22s %7d %6.0fms %6.0fms %6.0fms %6.0fms'
                  % (kind, len(xs), pct(.50), pct(.95), pct(.99), xs[-1]))
        print('\nHTTP status:')
        for s, n in self.status.most_common():
            flag = ''
            if s == 429: flag = '   <- rate limited'
            elif s == 0: flag = '   <- no reply at all (timeout, refused, socket)'
            elif isinstance(s, int) and s >= 500: flag = '   <- the server fell over'
            print('   %-6s %6d%s' % (s, n, flag))
        if self.errors:
            print('\nerrors:')
            for e, n in self.errors.most_common(6):
                print('   %5d  %s' % (n, e))


# A REAL TELEVISION DOES NOT RECONNECT FOR EVERY POLL.
#
# urllib opens a new connection per request, so every single call paid for a TCP
# handshake and a full TLS negotiation. Against a Worker over the internet that is
# several round trips of pure setup on top of the request, which does three things
# wrong: it caps what this laptop can generate (the live run stalled at 51/sec
# while the same tool does 700/sec locally), it makes the measured latency mostly
# handshake, and it puts a load on the far end that no real client produces.
#
# One connection per thread, reused, which is what a screen on a wall actually
# does. A connection that dies is rebuilt on the next call rather than failing it.
_conns = threading.local()

def _conn(url):
    parts = urllib.parse.urlsplit(url)
    key = (parts.scheme, parts.netloc)
    have = getattr(_conns, 'c', None)
    if have and have[0] == key:
        return have[1], parts
    if have:
        try: have[1].close()
        except Exception: pass
    if parts.scheme == 'https':
        c = http.client.HTTPSConnection(parts.netloc, timeout=20, context=CTX)
    else:
        c = http.client.HTTPConnection(parts.netloc, timeout=20)
    _conns.c = (key, c)
    return c, parts


def call(stats, kind, url, body=None, timeout=20):
    """One request on this thread's kept-open connection."""
    t0 = time.time()
    path = urllib.parse.urlsplit(url)
    path = (path.path or '/') + (('?' + path.query) if path.query else '')
    for attempt in (0, 1):
        try:
            c, _ = _conn(url)
            data = json.dumps(body).encode() if body is not None else None
            c.request('POST' if data else 'GET', path, body=data, headers=UA)
            r = c.getresponse()
            r.read(200000)
            stats.add(kind, (time.time() - t0) * 1000, r.status)
            return
        except Exception as e:
            # A kept connection can be closed by the far end between calls. That is
            # normal and is not a failure of the system under test - rebuild once
            # and only report if the retry also fails.
            try: _conns.c[1].close()
            except Exception: pass
            _conns.c = None
            if attempt:
                stats.add(kind, (time.time() - t0) * 1000, 0, e)


def _call_no_keepalive(stats, kind, url, body=None, timeout=20):
    t0 = time.time()
    try:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers=UA,
                                     method='POST' if body is not None else 'GET')
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            r.read(200000)
            stats.add(kind, (time.time() - t0) * 1000, r.status)
    except urllib.error.HTTPError as e:
        stats.add(kind, (time.time() - t0) * 1000, e.code)
    except Exception as e:
        stats.add(kind, (time.time() - t0) * 1000, 0, e)


PROFILES = {
    # share of venues doing each thing at once
    'quiet': dict(polling=1.00, trivia=0.00, sessions=0.00),
    'normal': dict(polling=1.00, trivia=0.03, sessions=0.01),
    'peak':  dict(polling=1.00, trivia=0.10, sessions=0.04),
}


def crowd(n, lo, hi, seed=7):
    """How many people are actually in each room.

    A flat "120 players per venue" is fiction and it flatters the numbers in both
    directions: it invents load at the small venues that will never have it, and
    it hides the big rooms that are the ones which actually hurt. Real pub game
    nights are skewed - most venues run a modest crowd and a few run a very big
    one - so this samples a triangular distribution with its mode near the low
    end, which is the shape Dean described: thirty to a hundred, mostly nearer
    thirty, with a tail.

    Seeded, so two runs of the same size are comparable to each other."""
    r = random.Random(seed)
    mode = lo + (hi - lo) * 0.28
    return [max(1, int(round(r.triangular(lo, hi, mode)))) for _ in range(max(1, n))]


def describe(xs):
    xs = sorted(xs)
    def p(q): return xs[min(len(xs) - 1, int(len(xs) * q))]
    return dict(n=len(xs), total=sum(xs), median=p(.5), mean=sum(xs) / float(len(xs)),
                p90=p(.9), lo=xs[0], hi=xs[-1])


def plan(args):
    """Print the load at a ladder of sizes, because the interesting number is not
    any one of them - it is where the curve crosses a limit."""
    ladder = args.ladder or [args.venues]
    lo, hi = args.players_range
    print('players per venue: %d to %d, skewed to the low end (most rooms are modest,' % (lo, hi))
    print('a few are big, and the big ones are what actually hurt)\n')
    print('%-9s %9s %9s %9s %9s %11s   %s'
          % ('VENUES', 'playing', 'people', 'polls/s', 'answers/s', 'TOTAL/s', 'first to give out'))
    for v in ladder:
        pr = PROFILES[args.profile]
        playing = int(v * pr['trivia'])
        c = describe(crowd(max(1, playing), lo, hi))
        polls = v / float(args.poll_seconds)
        answers = c['total'] / float(args.seconds_per_question)
        sess = v * pr['sessions'] / 60.0
        total = polls + answers + sess
        note = ''
        if c['total'] > 100000:   note = 'Realtime subscribers'
        elif total > 1000:        note = 'PostgREST / db pool'
        elif v > 10000:           note = 'Realtime channels'
        elif total > 200:         note = 'watch db pool'
        print('%-9s %9d %9s %9.0f %9.0f %11.0f   %s'
              % ('{:,}'.format(v), playing, '{:,}'.format(c['total']), polls, answers, total, note))

    pr = PROFILES[args.profile]
    playing = max(1, int(args.venues * pr['trivia']))
    c = describe(crowd(playing, lo, hi))
    print()
    print('At %s venues on the "%s" profile, %d are mid-game and the crowd looks like:'
          % ('{:,}'.format(args.venues), args.profile, playing))
    print('   smallest %d, median %d, mean %.0f, 90th percentile %d, biggest %d, %s people in total'
          % (c['lo'], c['median'], c['mean'], c['p90'], c['hi'], '{:,}'.format(c['total'])))
    print()
    print('  polls/s     every TV asks /venue?code= every %ds whether a game is on or not.' % args.poll_seconds)
    print('              This is the FLOOR. It never stops, 24 hours a day.')
    print('  answers/s   one answer per player per %ds, summed over the real crowd above,' % args.seconds_per_question)
    print('              not a flat number multiplied out. Bingo is broadcast-only and')
    print('              costs the Worker nothing, so trivia is the shape that matters.')
    print('  people      also the Realtime subscriber count, which is what Supabase meters:')
    print('              500 included on Pro, then $10 per 1,000.')
    print()
    print('CURRENT vs EVER-EXISTED. A cancelled venue costs nothing per second: no screen')
    print('polls, no channel, no players. It costs ROWS, and Supabase has no row limit on')
    print('any plan. 50,000 ever-existed with 3,000 trading is the 3,000 row for load.')


def canary(url, slug):
    """Is the REAL venue still fine? This is the whole safety mechanism.

    Not "is my load generator happy" - that says nothing about the room with the
    TV on the wall. This asks the exact question the venue's own screen asks, on
    every step up, and the ramp stops the moment the answer gets slow. A live
    venue's night is worth more than a complete set of numbers."""
    t0 = time.time()
    try:
        req = urllib.request.Request(url + '/screen?venue=' + slug, headers=UA)
        with urllib.request.urlopen(req, timeout=8, context=CTX) as r:
            body = r.read(4000)
            return (time.time() - t0) * 1000, (b'"exists":true' in body)
    except Exception:
        return 99999.0, False


def ramp(args):
    """Climb until something bends, then stop. Never sustain load that is hurting.

    A flat 1,900/sec test answers "did it survive", which you cannot run against
    production. A ramp answers "where is the knee", which is the number you
    actually want, and it can run against production because it is reading the
    same endpoints a TV reads and it aborts itself the moment the live venue
    slows down. You find the ceiling without ever standing on it."""
    on_prod = args.target.split('//')[-1].split('/')[0] in PROD
    print('RAMP against %s%s' % (args.target, '   [PRODUCTION]' if on_prod else ''))
    if on_prod:
        print('This is the live system. It is read-only - the same GETs a TV already')
        print('makes - it starts below normal traffic, and it stops itself the moment')
        print('the live venue slows. No session is opened and nothing is written.')
    print('read-only, and it stops itself the moment %s slows down.\n' % args.canary)

        # The baseline must be MEASURED, not sampled once. The first call to a
        # Worker is a cold start and can be ten times the warm number; taking that
        # as the baseline sets every threshold below far too high, which is how a
        # safety check ends up permitting the thing it exists to stop.
    warm = []
    for _ in range(6):
        ms, okk = canary(args.target, args.canary)
        if not okk:
            print('ABORT before starting: %s is not answering healthily right now.' % args.canary)
            print('Never start a ramp against a system that is already struggling.')
            return 2
        warm.append(ms)
    warm.sort(); base_ms = warm[len(warm)//2]
    print('baseline: %s answers in %.0fms (median of 6, fastest %.0f, slowest %.0f)'
          % (args.canary, base_ms, warm[0], warm[-1]))
    if warm[-1] > max(3000, base_ms * 4):
        print('NOTE: one warm call took %.1f seconds against a %.0fms median. That is a stall,'
              % (warm[-1] / 1000.0, base_ms))
        print('      not noise, and a venue hitting it sees the screen hang. Worth chasing')
        print('      separately from anything this ramp finds.')
    print()

    print('%9s %9s %9s %9s %9s   %s' % ('target/s', 'actual/s', 'p50', 'p95', 'errors', 'live venue'))
    stages = [25, 50, 100, 200, 400, 800, 1600, 3200]
    knee = None
    history = []
    codes = [args.code] if args.code else []
    for rate in stages:
        st = Stats(); stop = threading.Event()
        # HOW MANY THREADS IT TAKES IS SET BY LATENCY, NOT BY THE RATE.
        # Little's Law: to hold R requests a second when each takes L seconds you
        # need R*L of them in flight. Sizing threads off the rate alone produced
        # 4 threads against a 750ms endpoint, which can never exceed about 5/sec,
        # and the run then reported 6/sec as though that were a finding about the
        # server. It was a finding about the test.
        need = int(rate * (base_ms / 1000.0) * 1.3) + 2
        nthreads = max(4, min(args.threads, need))
        delay = max(0.0, nthreads / float(rate) - (base_ms / 1000.0))
        if need > args.threads:
            print('%9d   needs ~%d threads at %.0fms latency, capped at %d - this laptop '
                  'cannot generate this rate' % (rate, need, base_ms, args.threads))
            break

        def worker():
            while not stop.is_set():
                if codes and random.random() < 0.5:
                    call(st, 'code', args.target + '/venue?code=' + random.choice(codes))
                else:
                    call(st, 'screen', args.target + '/screen?venue=' + args.canary)
                time.sleep(delay)

        ts = [threading.Thread(target=worker, daemon=True) for _ in range(nthreads)]
        for t in ts: t.start()
        time.sleep(args.stage_seconds)
        stop.set(); time.sleep(0.4)

        allms = sorted(x for v in st.lat.values() for x in v)
        if not allms:
            print('%9d   no requests completed - stopping' % rate); break
        p50 = allms[len(allms)//2]; p95 = allms[min(len(allms)-1, int(len(allms)*.95))]
        bad = sum(n for c, n in st.status.items() if c == 0 or c == 429 or (isinstance(c,int) and c >= 500))
        actual = st.sent / float(args.stage_seconds)
        live_ms, live_ok = canary(args.target, args.canary)

        # THRESHOLDS THAT CAN ACTUALLY TRIP.
        # These first had a 1500ms floor, so a canary going from 7ms to 355ms -
        # fifty times slower, a screen a venue would watch stutter - was reported
        # as "held cleanly". A floor that high means the check cannot fail on a
        # fast system, which is every system worth protecting. The floor is now
        # 250ms, which is roughly where a person notices, and the multiple does
        # the work on anything slower than that.
        # A MULTIPLE IS NOT ENOUGH ON ITS OWN.
        # Three times a 567ms baseline is 1.7 seconds, and a television taking
        # 1.7 seconds to answer is bad whatever multiple that happens to be. On
        # 8 Sep the canary reached 1500ms and this let it through because 1500
        # is less than 1701. So there is an absolute ceiling as well, and the
        # tighter of the two wins.
        ceil_ms = max(250, min(base_ms * 3, args.max_live_ms))
        hurt = []
        if not live_ok:                  hurt.append('LIVE VENUE FAILED')
        elif live_ms > ceil_ms:          hurt.append('live venue %.0fms, was %.0f (ceiling %.0f)'
                                                     % (live_ms, base_ms, ceil_ms))
        if bad:                          hurt.append('%d errors/429s' % bad)
        if p95 > max(800, base_ms * 5):  hurt.append('p95 %.0fms' % p95)
        history.append((actual, p50, p95, live_ms))

        print('%9d %9.0f %7.0fms %7.0fms %9d   %s'
              % (rate, actual, p50, p95, bad, ('%.0fms' % live_ms) if live_ok else 'FAILED'))
        if hurt:
            print('\nSTOPPED at %d/sec: %s' % (rate, '; '.join(hurt)))
            break
        # The knee is what was MEASURED, never what was asked for. Crediting the
        # target rate claims a ceiling the test never actually reached.
        knee = actual
        if actual < rate * 0.6:
            # WHICH END RAN OUT? Falling short of the target rate does not say.
            # If the request times CLIMBED while the rate stalled, the far end is
            # the thing bending and the shortfall is a symptom of it. If they
            # stayed flat, this machine simply could not push harder. Reporting
            # the first as the second is how a real ceiling gets written off as a
            # laptop limitation, which is exactly what this printed on 8 Sep while
            # the live venue had gone from 512ms to 1500ms.
            first = history[0] if history else (actual, p50, p95, live_ms)
            rose = (p95 > first[2] * 1.4) or (live_ms > first[3] * 1.4)
            print()
            if rose:
                # The stage that bent is not a stage that held. Crediting it would
                # print "the server was bending at 29/sec" and "held cleanly to
                # 29/sec" in the same breath. The last CLEAN stage is the answer.
                knee = history[-2][0] if len(history) > 1 else None
                print('STOPPED at %d/sec: only reached %.0f/sec AND the times climbed while '
                      'it stalled (p95 %.0f to %.0fms, live venue %.0f to %.0fms).'
                      % (rate, actual, first[2], p95, first[3], live_ms))
                print('That pattern is the SERVER bending, not this laptop running out.')
                print('The last stage that was actually clean is the honest number; this one')
                print('is already degraded. Confirm from a second machine before trusting it.')
            else:
                print('STOPPED at %d/sec: only reached %.0f/sec, and the times did NOT climb '
                      '(p95 %.0f to %.0fms).' % (rate, actual, first[2], p95))
                print('Flat latency with a stalled rate is this laptop running out, not the')
                print('server. Everything above %.0f/sec is untested, not proven.' % actual)
            break

    print()
    if knee:
        print('Held cleanly to a MEASURED %.0f requests/sec.' % knee)
        print('At %ds screen polls that is about %s venues just for the polling floor.'
              % (args.poll_seconds, '{:,}'.format(int(knee * args.poll_seconds))))
        print('Trivia is on top of that and is the bigger number - see --plan.')
    else:
        print('Nothing held cleanly. Something is wrong before load is the issue.')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', help='base URL of the game Worker to hit')
    ap.add_argument('--venues', type=int, default=3000)
    ap.add_argument('--players-range', default='30-100',
                    type=lambda t: tuple(int(x) for x in t.split('-')),
                    help='people per venue, low-high; skewed to the low end (default 30-100)')
    ap.add_argument('--minutes', type=float, default=2)
    ap.add_argument('--profile', choices=list(PROFILES), default='peak')
    ap.add_argument('--threads', type=int, default=250)
    ap.add_argument('--seconds-per-question', type=int, default=20)
    ap.add_argument('--ladder', type=lambda s:[int(x) for x in s.split(',')],
                    help='comma-separated venue counts, e.g. 500,3000,10000,50000')
    ap.add_argument('--poll-seconds', type=int, default=30)
    ap.add_argument('--ramp', action='store_true',
                    help='climb until something bends, aborting if the live venue slows')
    ap.add_argument('--canary', default='the-average-joe',
                    help='the REAL venue whose health stops the test')
    ap.add_argument('--code', help='a real venue code, to exercise the code lookup too')
    ap.add_argument('--stage-seconds', type=int, default=20)
    ap.add_argument('--max-live-ms', type=int, default=1200,
                    help='absolute ceiling for the live venue, whatever the multiple')
    ap.add_argument('--plan', action='store_true', help='print the shape of the load and stop')
    ap.add_argument('--write', action='store_true', help='also POST (opens sessions). Default is read-only.')
    ap.add_argument('--yes-production', action='store_true')
    args = ap.parse_args()

    if args.ramp and args.target:
        host = args.target.split('//')[-1].split('/')[0]
        if args.write:
            print('REFUSED: a ramp is read-only. --write would put junk in real tables.')
            return 2
        return ramp(args)

    if args.plan or not args.target:
        plan(args)
        if not args.target:
            print('\nNo --target given, so nothing was sent. Point it at a staging Worker to run it.')
        return 0

    host = args.target.split('//')[-1].split('/')[0]
    if host in PROD and not args.yes_production:
        print('REFUSED: %s is production, and a live venue is on it.' % host)
        print('A load test that takes their night down is worse than no load test.')
        print('Point --target at a staging Worker, or pass --yes-production if you have')
        print('genuinely decided to do this to the real one.')
        return 2
    if args.write and host in PROD:
        print('REFUSED: --write against production would open real sessions and bill real venues.')
        return 2

    stats = Stats()
    stop = threading.Event()
    p = PROFILES[args.profile]
    codes = [code() for _ in range(min(args.venues, 4000))]

    def screen_poller():
        while not stop.is_set():
            call(stats, 'screen poll', args.target + '/venue?code=' + random.choice(codes))
            time.sleep(max(0.001, 30.0 * args.threads / max(1, args.venues)))

    def trivia_player():
        while not stop.is_set():
            call(stats, 'play/live', args.target + '/play/live?code=' + random.choice(codes))
            time.sleep(max(0.001, args.seconds_per_question * args.threads /
                           max(1, args.venues * p['trivia'] * args.players_range[1])))

    threads = []
    for i in range(args.threads):
        fn = screen_poller if (i % 3) else trivia_player
        t = threading.Thread(target=fn, daemon=True); t.start(); threads.append(t)

    t0 = time.time()
    print('running %.1f min against %s ... (%d threads)' % (args.minutes, host, args.threads), flush=True)
    try:
        while time.time() - t0 < args.minutes * 60:
            time.sleep(5)
            print('   %4.0fs  %d sent' % (time.time() - t0, stats.sent), flush=True)
    except KeyboardInterrupt:
        pass
    stop.set(); time.sleep(1)
    stats.report(time.time() - t0)
    return 0


if __name__ == '__main__':
    sys.exit(main())
