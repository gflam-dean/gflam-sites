#!/usr/bin/env python3
"""tools/canary-night.py and release.py step 3c, offline (421 gap 2, 16 Nov 2026). No network: a fake game Worker and a fake
Supabase stand in, and each can be told to get one thing wrong.

  GREEN    a correct night is green (exit 0), every call went to the target's own hosts, the database was only read
  REFUSED  every rail says NOT RUN (exit 2) BEFORE a night is opened: live without Dean's yes, a venue off the allow-list,
           a chargeable venue, a non-comp account, the once-a-week rule still on, a host login that is staff at a real
           venue, a night already on, the wrong project, a real email for the host, a foreign host, a REST write, an RPC
  RED      each product fault the canary exists for is red (exit 1), and the night is still closed afterwards
  RELEASE  step 3c: OFF by default and says NOT CHECKED; green passes; RED runs the rollback lane with --go and stops;
           NOT RUN never rolls back and writes to the INBOX; no runner = nothing started
"""
import copy, importlib.util, io, json, os, sys, urllib.parse, uuid
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, rel))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


C = load('canary_night', 'canary-night.py')
R = load('release_for_canary', 'release.py')
TEST_REF, LIVE_REF = C.TEST_REF, C.LIVE_REF
N = {'ok': 0, 'fail': 0}


def ok(what, cond, extra=''):
    N['ok' if cond else 'fail'] += 1
    print(('  ok   ' if cond else '  FAIL ') + what + (('   ' + str(extra)[:300]) if (not cond and extra != '') else ''), flush=True)


ENV = {'TEST_SUPABASE_URL': 'https://%s.supabase.co' % TEST_REF, 'TEST_SERVICE_KEY': 'svc-test', 'TEST_ANON_KEY': 'anon-test',
       'NEW_SUPABASE_URL': 'https://%s.supabase.co' % LIVE_REF, 'NEW_SERVICE_KEY': 'svc-live', 'NEW_ANON_KEY': 'anon-live',
       'VP_CANARY_HOST_EMAIL': 'canary-host@example.invalid'}


class World:
    """The game Worker + Supabase, in memory, playing a night correctly unless a fault is named."""

    def __init__(self, faults=(), target='staging', **over):
        self.f = set(faults)
        self.target = target
        self.alpha = str(uuid.uuid4())
        self.real = str(uuid.uuid4())
        self.uid = str(uuid.uuid4())
        self.venue = {'id': self.alpha, 'slug': 'test-alpha', 'name': 'Test Alpha', 'status': 'active', 'founding_id': 'f1',
                      'group_id': None, 'max_players': None, 'included_players': 40, 'weekly_limit_off': True}
        self.venue.update(over.get('venue', {}))
        self.founding = {'status': 'comp', 'stripe_customer_id': None, 'stripe_subscription_id': None}
        self.founding.update(over.get('founding', {}))
        self.staff = [{'venue_id': self.alpha, 'role': 'owner'}] + over.get('extra_staff', [])
        self.live_sessions = over.get('live_sessions', [])
        self.calls, self.writes = [], []
        self.session = None
        self.players = {}      # token -> {name, pid}
        self.games = []
        self.answers = {}      # (game, qseq, token) -> idx
        self.claims = []
        self.played = []
        self.qn = 0
        self.qopen = None
        self.phase = 'idle'
        self.scores = {}
        self.closed = False
        self.cards = {}
        self.join_bodies = []

    # -------- helpers
    def game_of(self, gid):
        return next(g for g in self.games if g['id'] == gid)

    def __call__(self, method, url, body, headers):
        u = urllib.parse.urlparse(url)
        self.calls.append((method, u.hostname, u.path))
        if u.hostname.endswith('supabase.co'):
            return self.supabase(method, u, body, headers)
        return self.worker(method, u, body or {}, headers)

    def supabase(self, method, u, body, headers):
        if u.path == '/auth/v1/admin/generate_link':
            return 200, {'properties': {'hashed_token': 'h'}}
        if u.path == '/auth/v1/verify':
            return 200, {'access_token': 'host-jwt', 'user': {'id': self.uid}}
        if method != 'GET':
            self.writes.append(u.path)
            return 201, []
        t = u.path.rsplit('/', 1)[-1]
        q = u.query
        if t == 'vp_venues':
            if 'slug=eq.' in q:
                # any slug answers (with a test-looking name) so the allow-list is the ONLY thing that can refuse it
                slug = q.split('slug=eq.', 1)[1].split('&', 1)[0]
                v = dict(self.venue)
                if slug != 'test-alpha':
                    v.update(slug=slug, name='Test ' + slug)
                return 200, [v]
            if 'slug=in.' in q:
                return 200, [{'id': self.alpha}]
            if 'slug.like.test-' in q:
                return 200, [{'id': self.alpha}]
            return 200, []
        if t == 'venueplay_founding':
            return 200, [dict(self.founding)]
        if t == 'vp_venue_staff':
            return 200, list(self.staff)
        if t == 'vp_sessions':
            if 'status=in.' in q:
                return 200, list(self.live_sessions)
            return 200, [{'status': 'finished' if self.closed and 'not_closed_in_db' not in self.f else 'running', 'venue_id': self.alpha}]
        if t == 'vp_question_sets':
            return 200, [{'id': 'qs1', 'title': 'General'}]
        if t == 'vp_playlists':
            return 200, [{'id': 'pl1', 'title': 'Pub Classics'}]
        if t == 'vp_players':
            rows = [{'display_name': p['name'], 'device_id': p['pid']} for p in self.players.values()]
            if 'db_extra_player' in self.f:
                rows.append({'display_name': 'Ghost', 'device_id': 'x'})
            return 200, rows
        if t == 'vp_games':
            return 200, [{'format': g['format'], 'status': g['status']} for g in self.games]
        if t == 'vp_trivia_answers':
            n = len(self.answers) - (1 if 'db_answer_lost' in self.f else 0)
            return 200, [{'answer_index': 0}] * n
        if t == 'vp_claims':
            rows = [{'auto_verdict': c['verdict'], 'status': c['status']} for c in self.claims]
            return 200, rows[:1] if 'db_claim_lost' in self.f else rows
        return 404, {'message': 'no table'}

    def worker(self, method, u, b, h):
        p = u.path
        qs = dict(urllib.parse.parse_qsl(u.query))
        tok = h.get('X-Player-Token')
        if p == '/health':
            return (200, {'ok': 'health_bad' not in self.f, 'build': 'fake'})
        if p == '/screen':
            return 200, ({'exists': False} if 'tv_lost' in self.f else {'exists': True, 'name': self.venue['name']})
        if p == '/session':
            self.session = 's1'
            return 200, {'session_id': 's1', 'join_code': 'ABCDEF', 'reused': 'reused' in self.f}
        if p == '/join':
            self.join_bodies.append(dict(b))
            for t0, pl in self.players.items():
                if pl['pid'] == b['pid'] and 'rejoin_new_seat' not in self.f:
                    return 200, {'token': t0}
            t0 = 'tok-%d' % len(self.players)
            self.players[t0] = {'name': b['name'], 'pid': b['pid']}
            return 200, {'token': t0}
        if p == '/snapshot':
            g = next((x for x in self.games if x['status'] == 'running'), None)
            snap = {'player_count': len(self.players) + (1 if 'snap_count_3' in self.f else 0), 'game': None}
            if g and g['format'] == 'trivia':
                q = None
                if self.qopen:
                    q = {'qseq': self.qopen['qseq'] + (1 if 'tv_wrong_q' in self.f else 0), 'text': self.qopen['text']}
                    if self.phase == 'revealed' or 'tv_early_answer' in self.f:
                        q['correct_index'] = self.qopen['correct_index']
                snap['game'] = {'format': 'trivia', 'phase': self.phase, 'question': q}
            elif g:
                snap['game'] = {'format': 'musical_bingo', 'played_count': len(self.played)}
            return 200, snap
        if p == '/host/game':
            gid = 'g%d' % (len(self.games) + 1)
            fmt = 'trivia' if b['format'] == 'trivia' else 'musical_bingo'
            self.games.append({'id': gid, 'format': fmt, 'status': 'running'})
            return 200, {'game_id': gid, 'question_count': 3}
        if p == '/host/question':
            if self.qn >= 3:
                return 200, ({'done': True} if 'no_done' not in self.f else {'qseq': 99})
            self.qn += 1
            self.qopen = {'qseq': self.qn * 3, 'qi': self.qn, 'qtotal': 3, 'text': 'Q%d?' % self.qn, 'options': ['a', 'b', 'c', 'd'],
                          'correct_index': 1}
            self.phase = 'asking'
            return 200, dict(self.qopen)
        if p == '/player/answer':
            key = (b['game_id'], b['qseq'], tok)
            if key in self.answers:
                if 'double_answer' in self.f:
                    return 200, {'ok': True, 'recorded': True}
                return 200, {'ok': True, 'recorded': False, 'reason': 'already_answered'}
            if 'answer_refused' in self.f and self.qn == 2:
                return 409, {'error': 'Time is up for this question'}
            self.answers[key] = b['answer_index']
            if b['answer_index'] == self.qopen['correct_index']:
                self.scores[tok] = self.scores.get(tok, 0) + 100
            return 200, {'ok': True, 'recorded': True}
        if p == '/host/reveal':
            self.phase = 'revealed'
            b0 = self.board()
            if 'reveal_board_flipped' in self.f:
                b0.reverse()
            return 200, {'correct_index': self.qopen['correct_index'], 'leaderboard': b0}
        if p == '/player/score':
            rank = sorted(self.players, key=lambda t: -self.scores.get(t, 0)).index(tok) + 1
            mine = self.answers.get((qs['game'], int(qs['q']), tok))
            return 200, {'total': self.scores.get(tok, 0), 'rank': rank, 'players_count': len(self.players),
                         'last': {'qseq': int(qs['q']), 'is_correct': (mine == 1) != ('score_flipped' in self.f)}}
        if p == '/host/trivia/board':
            return 200, {'leaderboard': self.board()}
        if p == '/host/game/end':
            g = self.game_of(b['game_id'])
            if g['status'] == 'finished':
                return 200, {'status': 'finished', 'already': True}
            if 'end_fails' not in self.f:
                g['status'] = 'finished'
            self.qopen = None
            return 200, {'status': 'finished'}
        if p == '/player/card':
            cells = [{'song_id': 's%s-%d' % (tok, i), 'title': 'Song %d' % i} for i in range(25)]
            self.cards[tok] = cells
            return 200, {'cells': cells}
        if p == '/player/claim':
            first = self.cards[tok][:5]
            valid = all(c['song_id'] in self.played for c in first) != ('claim_judged_wrong' in self.f)
            if 'a_win_refused' in self.f and self.played:
                valid = False
            c = {'id': 'c%d' % len(self.claims), 'verdict': 'valid' if valid else 'invalid', 'status': 'pending'}
            self.claims.append(c)
            return 200, {'claim_id': c['id'], 'auto_verdict': c['verdict'], 'winning_cells': [0, 1, 2, 3, 4] if valid else None}
        if p == '/host/claim/resolve':
            c = next(x for x in self.claims if x['id'] == b['claim_id'])
            c['status'] = 'confirmed' if b['decision'] == 'confirm' else 'rejected'
            return 200, {'status': c['status']}
        if p == '/host/play':
            if 'play_lost' not in self.f:
                self.played.append(b['song_id'])
            return 200, {'song_id': b['song_id']}
        if p == '/session/close':
            if 'close_fails' in self.f:
                return 500, {'error': 'boom'}
            self.closed = True
            return 200, {'status': 'finished'}
        return 404, {'error': 'no route ' + p}

    def board(self):
        rows = [{'name': self.players[t]['name'], 'points': self.scores.get(t, 0)} for t in self.players]
        rows.sort(key=lambda r: -r['points'])
        if 'board_flipped' in self.f:
            rows.reverse()
        return rows


def play(faults=(), argv=('--target', 'staging'), env=None, **over):
    w = World(faults, **over)
    out = io.StringIO()
    with redirect_stdout(out):
        rc = C.main(list(argv), env=dict(ENV if env is None else env), opener=w, say=print)
    return rc, w, out.getvalue()


def game_posts(w):
    return [c for c in w.calls if c[0] == 'POST' and c[1].startswith('game')]


# ------------------------------------------------------------------ GREEN
rc, w, out = play()
ok('GREEN: a correct night is green (exit 0)', rc == 0, out[-600:])
n_checks = out.count('  ok   ')
ok('GREEN: it ran 80 or more checks (%d)' % n_checks, n_checks >= 80, n_checks)
ok('GREEN: every call went to the staging game Worker or the TEST project, nothing else',
   all(h in ('game-staging.venueplay.com.au', '%s.supabase.co' % TEST_REF) for _, h, _ in w.calls), {h for _, h, _ in w.calls})
ok('GREEN: the database was never written directly', w.writes == [], w.writes)
ok('GREEN: no billing Worker, no Stripe', not any('api' in h.split('.')[0] or 'stripe' in h for _, h, _ in w.calls))
ok('GREEN: the night was closed', w.closed)
ok('GREEN: three questions asked, three reveals', sum(1 for c in w.calls if c[2] == '/host/reveal') == 3)
ok('GREEN: musical bingo was dealt and a claim confirmed', any(c['status'] == 'confirmed' for c in w.claims))
ok('GREEN: phones gave a first name only (no mobile, no email reached /join)',
   len(w.join_bodies) == 3 and all(set(b) == {'code', 'name', 'pid'} and b['name'].startswith('Canary ') for b in w.join_bodies), w.join_bodies)
ok('GREEN: nothing the canary sent anywhere holds a mobile or an email', not any(k in json.dumps(w.join_bodies) for k in ('mobile', 'email', '@')))
rc, w, out = play(argv=('--target', 'staging', '--no-musical'))
ok('GREEN: --no-musical plays trivia only', rc == 0 and not w.claims and len(w.games) == 1, out[-300:])

# ------------------------------------------------------------------ REFUSED (exit 2, nothing opened)
def refused(label, rc, w, out):
    ok('REFUSED: %s -> NOT RUN, exit 2' % label, rc == 2, out[-400:])
    ok('REFUSED: %s -> no night opened, no game call made' % label, not game_posts(w), game_posts(w))


rc, w, out = play(argv=('--target', 'live'), target='live')
refused('live without --live-ok-by-dean', rc, w, out)
ok('REFUSED: live without the flag names Dean\'s yes', 'Dean' in out, out[-200:])
rc, w, out = play(argv=('--target', 'staging', '--venue', 'the-mini-bar'))
refused('a venue not on the allow-list', rc, w, out)
rc, w, out = play(founding={'stripe_subscription_id': 'sub_1'})
refused('a venue with a Stripe subscription', rc, w, out)
rc, w, out = play(founding={'stripe_customer_id': 'cus_1'})
refused('a venue with a Stripe customer', rc, w, out)
rc, w, out = play(founding={'status': 'active'})
refused('a paying (non-comp) account', rc, w, out)
rc, w, out = play(venue={'weekly_limit_off': False})
refused('the once-a-week rule still on', rc, w, out)
rc, w, out = play(venue={'name': 'The Royal Hotel'})
refused('a venue not named like a test venue', rc, w, out)
rc, w, out = play(venue={'included_players': 1})
refused('a plan too small for 2 players (would bill overage)', rc, w, out)
rc, w, out = play(argv=('--target', 'live', '--live-ok-by-dean'), target='live', extra_staff=[{'venue_id': 'real-venue', 'role': 'owner'}])
refused('a live host login that is staff at a real venue', rc, w, out)
rc, w, out = play(live_sessions=[{'id': 'someone-elses-night'}])
refused('a night already on at Test Alpha', rc, w, out)
env = dict(ENV); env['TEST_SUPABASE_URL'] = 'https://%s.supabase.co' % LIVE_REF
rc, w, out = play(env=env)
refused('staging pointed at the LIVE project', rc, w, out)
env = dict(ENV); env['VP_CANARY_HOST_EMAIL'] = 'dean@gflam.com.au'
rc, w, out = play(argv=('--target', 'live', '--live-ok-by-dean'), env=env, target='live')
refused('a live host login with a real email', rc, w, out)
env = dict(ENV); env.pop('VP_CANARY_HOST_EMAIL')
rc, w, out = play(argv=('--target', 'live', '--live-ok-by-dean'), env=env, target='live')
refused('live with no canary host login in the key file', rc, w, out)
cfg = C.target_config('staging', ENV)
net = C.Net(cfg, opener=lambda *a: (200, {}))
for label, m, url in (('a host that is not the target\'s', 'GET', 'https://api.venueplay.com.au/health'),
                      ('the live game Worker from staging', 'POST', 'https://game.venueplay.com.au/session'),
                      ('a REST write', 'POST', 'https://%s.supabase.co/rest/v1/vp_venues' % TEST_REF),
                      ('a REST delete', 'DELETE', 'https://%s.supabase.co/rest/v1/vp_players' % TEST_REF),
                      ('a database function called directly', 'GET', 'https://%s.supabase.co/rest/v1/rpc/vp_player_answer' % TEST_REF),
                      ('an Auth admin write', 'POST', 'https://%s.supabase.co/auth/v1/admin/users' % TEST_REF),
                      ('plain http', 'GET', 'http://game-staging.venueplay.com.au/health')):
    try:
        net(m, url)
        ok('Net refuses %s' % label, False, 'it went through')
    except C.NotRun:
        ok('Net refuses %s' % label, True)

# ------------------------------------------------------------------ RED (exit 1, night still closed)
for fault, label in (('health_bad', 'the game Worker /health is not ok'),
                     ('tv_lost', 'the TV cannot find its venue'),
                     ('reused', 'the Worker hands back somebody else\'s open night'),
                     ('rejoin_new_seat', 'a returning phone gets a second seat (billed twice)'),
                     ('tv_wrong_q', 'the TV shows a different question from the console'),
                     ('tv_early_answer', 'the TV is given the answer before the reveal'),
                     ('answer_refused', 'an answer in time is refused'),
                     ('double_answer', 'a second tap is recorded'),
                     ('board_flipped', 'the board puts the wrong player first'),
                     ('reveal_board_flipped', 'the reveal\'s board puts the wrong player first'),
                     ('snap_count_3', 'the room counts 3 players for 2 phones (what billing counts)'),
                     ('a_win_refused', 'a real musical bingo win is refused'),
                     ('score_flipped', 'a phone is told the wrong result'),
                     ('no_done', 'the quiz does not end after the last question'),
                     ('end_fails', 'End leaves the game running'),
                     ('claim_judged_wrong', 'the Worker judges a claim wrong'),
                     ('play_lost', 'a played song is not recorded'),
                     ('close_fails', 'the night will not close'),
                     ('not_closed_in_db', 'the database still has the night open'),
                     ('db_extra_player', 'the database holds a third player'),
                     ('db_answer_lost', 'an answer is missing from the database'),
                     ('db_claim_lost', 'the winning claim is missing from the database')):
    rc, w, out = play((fault,))
    if fault == 'reused':
        ok('NOT RUN: %s -> exit 2 (a race with a real host is not a product fault: no rollback)' % label, rc == 2, out[-300:])
        ok('NOT RUN: %s -> that night is left alone (never closed by the canary)' % label, not any(c[2] == '/session/close' for c in w.calls))
        continue
    ok('RED: %s -> exit 1' % label, rc == 1, out[-300:])
    ok('RED: %s -> the night was still closed (or closing was tried)' % label,
       w.closed or any(c[2] == '/session/close' for c in w.calls) or not w.session, w.calls[-3:])

# ------------------------------------------------------------------ RELEASE step 3c
lines = R.canary_step('abcdef1234', env={}, run=lambda *a, **k: (_ for _ in ()).throw(AssertionError('ran')))
ok('RELEASE: the canary is OFF by default, says Dean\'s yes and NOT CHECKED, and starts nothing',
   any('Dean' in l and 'NOT CHECKED' in l for l in lines), lines)
lines = R.canary_step('abcdef1234', env={'VP_CANARY': '1'}, run=None)
ok('RELEASE: with no runner nothing is started', any('not started' in l for l in lines), lines)


class P:
    def __init__(self, rc):
        self.returncode = rc


seen = {}


def runner(rc):
    def run(argv, cwd=None, env=None):
        seen['argv'] = argv
        return P(rc)
    return run


rolled, alerts = [], []
lines = R.canary_step('abcdef1234', env={'VP_CANARY': '1'}, run=runner(0), roll=lambda why: rolled.append(why) or 0, alert=alerts.append)
ok('RELEASE: green -> one GREEN line, no rollback, no alert', any('GREEN' in l for l in lines) and not rolled and not alerts, lines)
ok('RELEASE: it plays LIVE with Dean\'s flag, Test Alpha by default', seen['argv'][1:5] == ['tools/canary-night.py', '--target', 'live', '--live-ok-by-dean']
   and '--venue' not in seen['argv'], seen['argv'])
rolled, alerts = [], []
buf = io.StringIO()
stopped = False
try:
    with redirect_stdout(buf):
        R.canary_step('abcdef1234', env={'VP_CANARY': '1'}, run=runner(1), roll=lambda why: rolled.append(why) or 0, alert=alerts.append)
except SystemExit:
    stopped = True
ok('RELEASE: RED -> the rollback lane runs at once', len(rolled) == 1 and 'canary' in rolled[0], rolled)
ok('RELEASE: RED -> the release stops, and says it rolled back', stopped and 'ROLLING BACK' in buf.getvalue() and 'rolled the release back' in buf.getvalue(), buf.getvalue()[-300:])
ok('RELEASE: RED -> a line goes to the INBOX', len(alerts) == 1, alerts)
rolled, alerts = [], []
buf = io.StringIO()
try:
    with redirect_stdout(buf):
        R.canary_step('abcdef1234', env={'VP_CANARY': '1'}, run=runner(1), roll=lambda why: rolled.append(why) or 1, alert=alerts.append)
except SystemExit:
    pass
ok('RELEASE: RED and the rollback lane fails -> says roll back by hand now', 'roll back by hand now' in buf.getvalue(), buf.getvalue()[-300:])
rolled, alerts = [], []
lines = R.canary_step('abcdef1234', env={'VP_CANARY': '1'}, run=runner(2), roll=lambda why: rolled.append(why) or 0, alert=alerts.append)
ok('RELEASE: NOT RUN -> never rolls back', not rolled, rolled)
ok('RELEASE: NOT RUN -> loud line and an INBOX line', any('NOT RUN' in l and 'NOTHING ROLLED BACK' in l for l in lines) and len(alerts) == 1, [lines, alerts])
plan = R.canary_plan('abcdef1234', env={})
ok('RELEASE: --plan says the canary is off until Dean says yes', plan and 'not play the canary' in plan[0], plan)
src = open(os.path.join(HERE, 'release.py')).read()
i3, i4 = src.find("step('3c'"), src.find('step(4,')
ok('RELEASE: step 3c runs after the Workers and Pages (3) and before the gate (5)', 0 < src.find('step(3,') < i3 < i4 < src.find('step(5,'))
ok('RELEASE: main() hands step 3c a runner', 'canary_step(head, run=subprocess.run)' in src)

total = N['ok'] + N['fail']
if N['fail']:
    print('\n%d of %d CHECKS FAILED' % (N['fail'], total))
    sys.exit(1)
print('\nALL %d CHECKS PASSED' % total)
