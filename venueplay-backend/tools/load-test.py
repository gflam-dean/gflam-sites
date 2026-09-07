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
import urllib.request, urllib.error

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


def call(stats, kind, url, body=None, timeout=20):
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


def plan(args):
    """Print the load at a ladder of sizes, because the interesting number is not
    any one of them - it is where the curve crosses a limit."""
    ladder = args.ladder or [args.venues]
    print('%-9s %9s %9s %9s %9s   %s' % ('VENUES', 'polls/s', 'answers/s', 'TOTAL/s',
                                         'channels', 'what gives out first'))
    for v in ladder:
        p = PROFILES[args.profile]
        polls = v / float(args.poll_seconds)
        trivia_venues = int(v * p['trivia'])
        answers = trivia_venues * args.players / max(1, args.seconds_per_question)
        sess = v * p['sessions'] / 60.0
        total = polls + answers + sess
        chans = v
        subs = int(v * p['trivia'] * args.players)
        note = ''
        if subs > 500 * 200:      note = 'Realtime subscribers'
        elif total > 1000:        note = 'PostgREST / db pool'
        elif chans > 10000:       note = 'Realtime channels'
        elif total > 200:         note = 'watch db pool'
        print('%-9s %9.0f %9.0f %9.0f %9d   %s' % ('{:,}'.format(v), polls, answers, total, chans, note))
    print()
    print('  polls/s     every TV asks /venue?code= every %ds whether or not a game is on.' % args.poll_seconds)
    print('              This is the FLOOR. It never stops, 24 hours a day.')
    print('  answers/s   %d%% of venues playing trivia, %d players each, one answer per %ds.'
          % (PROFILES[args.profile]['trivia'] * 100, args.players, args.seconds_per_question))
    print('              Bingo is broadcast-only and costs the Worker nothing, so trivia is')
    print('              the shape that matters. This is the number that breaks things.')
    print('  channels    one Realtime channel per venue with a screen on, plus a subscriber')
    print('              per phone. Channels are cheap; subscribers are what is metered.')
    print()
    print('CURRENT vs EVER-EXISTED. A cancelled venue costs nothing per second: no screen')
    print('polls, no channel, no players. It costs ROWS. 50,000 venues that have ever')
    print('existed with 3,000 live is the 3,000 row of this table for load, and a 50,000-')
    print('row vp_venues for the database. Those are different questions - the second one')
    print('is answered by index-check.py, not by this.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', help='base URL of the game Worker to hit')
    ap.add_argument('--venues', type=int, default=3000)
    ap.add_argument('--players', type=int, default=120)
    ap.add_argument('--minutes', type=float, default=2)
    ap.add_argument('--profile', choices=list(PROFILES), default='peak')
    ap.add_argument('--threads', type=int, default=40)
    ap.add_argument('--seconds-per-question', type=int, default=20)
    ap.add_argument('--ladder', type=lambda s:[int(x) for x in s.split(',')],
                    help='comma-separated venue counts, e.g. 500,3000,10000,50000')
    ap.add_argument('--poll-seconds', type=int, default=30)
    ap.add_argument('--plan', action='store_true', help='print the shape of the load and stop')
    ap.add_argument('--write', action='store_true', help='also POST (opens sessions). Default is read-only.')
    ap.add_argument('--yes-production', action='store_true')
    args = ap.parse_args()

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
                           max(1, args.venues * p['trivia'] * args.players)))

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
