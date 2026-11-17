#!/usr/bin/env python3
"""THE CANARY NIGHT: A SHORT REAL GAME ON THE REAL SYSTEM, AT A TEST VENUE, AFTER EVERY DEPLOY (421 gap 2, 16 Nov 2026).

    python3 tools/canary-night.py --target staging                 staging Workers + the TEST database (safe any time)
    python3 tools/canary-night.py --target staging --no-musical    trivia only
    python3 tools/canary-night.py --target live --live-ok-by-dean  LIVE, Test Alpha only (release.py step 3c; Dean's yes)
    python3 tools/canary-night.py --target staging --report out.json

No game was ever played on the real system before or after a push: the live gate reads, it never plays. A release could be
green and still fail the first real lobby. This is one host, one TV and two phones, all headless, through the REAL game
Worker, the REAL database functions and the REAL tables, at a TEST venue:

  TV       GET /screen?venue=<slug> (vp_screen_poll), then follows the night on GET /snapshot like a screen does
  host     a real host sign-in (Supabase Auth, minted with the project's service key: no text, no code typed), then
           POST /session, /host/game, /host/question, /host/reveal, /host/trivia/board, /host/game/end, /session/close
  phones   POST /join (vp_join_context) twice for phone A (a returning phone keeps its seat), /player/answer
           (vp_player_answer), /player/score, and for musical bingo /player/card + /player/claim

  TRIVIA   3 questions: A answers right, B wrong, A taps again ("already"); the TV shows the same question as the console;
           reveal; the TV shows the answer; the board has A above B; after question 3 the Worker says done; the podium is
           A first; game end (twice: the second says already)
  MUSICAL  one deal: B claims with nothing played (refused: invalid), the host rejects it; the host plays A's top row;
           A claims (valid); the host confirms; game end
  THEN     session close, and the database is read back: 1 session finished, exactly 2 players (what billing counts),
           1 trivia + 1 musical game finished, 6 answers, 2 claims (B rejected invalid, A confirmed valid)

WHAT IT NEVER DOES. Never touches a venue that is not on the allow-list (ALLOW, by slug; the id is read from that target's
own venue table and every call is checked against it). Never a venue that can be charged (a Stripe subscription or a
non-comp billing row: refused before anything is opened), never a venue whose host login is staff anywhere that is not on the
allow-list. Never writes to the database directly (every REST call is a GET; the only POSTs to Supabase are Auth's
generate_link and verify, which send nothing). Never calls the billing Worker or Stripe. Players give a first name only
("Canary A"/"Canary B"): no mobile, no email, so nothing can be texted or emailed. Every URL is checked against the target's
own short list of hosts before it is opened. A night already on at the venue is never touched (exit 2).

LIVE needs Dean's yes for the first run: --target live refuses without --live-ok-by-dean, and needs VP_CANARY_HOST_EMAIL
(an @example.invalid host login that is staff ONLY at Test Alpha) in ~/.gflam-migrate.env. Test Alpha also needs HQ's
"unlimited nights" switch (weekly_limit_off) or the once-a-week rule would stop the second canary of the week.

Exit 0 green. Exit 1 RED: the real system did something wrong (release.py rolls back on this). Exit 2 NOT RUN: refused,
a precondition is missing or the night could not start (release.py never rolls back on this; it says so loudly).
"""
import hashlib, json, os, secrets, sys, time, urllib.error, urllib.parse, urllib.request

TEST_REF = 'rkfaftxgzpsmmrzudlqy'
LIVE_REF = 'ijkzgmdtwtgfkedqspxm'
ALLOW = ('test-alpha', 'test-bravo', 'test-charlie')     # the ONLY venues a canary may play at (memory: lobbies always OK)
DEFAULT_VENUE = 'test-alpha'
UA = 'Mozilla/5.0 (venueplay canary night)'               # Cloudflare answers a bare Python client 403 on the staging hosts
TARGETS = {
    'staging': {
        'game': 'https://game-staging.venueplay.com.au',
        'site': 'https://staging.venueplay.com.au',
        'ref': TEST_REF,
        'keys': ('TEST_SUPABASE_URL', 'TEST_SERVICE_KEY', 'TEST_ANON_KEY'),
        'host_email': 'test-host@example.invalid',       # 0491 570 001, owner of the TEST venues (seed-test-data.sql)
        'host_email_key': None,
    },
    'live': {
        'game': 'https://game.venueplay.com.au',
        'site': 'https://www.venueplay.com.au',
        'ref': LIVE_REF,
        'keys': ('NEW_SUPABASE_URL', 'NEW_SERVICE_KEY', 'NEW_ANON_KEY'),
        'host_email': None,
        'host_email_key': 'VP_CANARY_HOST_EMAIL',        # made by Dean/main on live; staff ONLY at Test Alpha
    },
}


class NotRun(Exception):
    """A refusal or a missing precondition: nothing was wrong with the product (exit 2)."""


class Red(Exception):
    """The real system did something wrong (exit 1)."""


def read_env(path=None):
    p = path or os.environ.get('VP_CANARY_ENV_FILE') or os.path.expanduser('~/.gflam-migrate.env')
    out = {}
    if not os.path.exists(p):
        return out
    for line in open(p):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k.replace('export ', '').strip()] = v.strip().strip('"').strip("'")
    return out


def target_config(name, env, live_ok=False):
    """The settings for one target, or NotRun with every reason. Nothing is opened here."""
    if name not in TARGETS:
        raise NotRun('unknown target %r (staging or live)' % name)
    t = dict(TARGETS[name])
    if name == 'live' and not live_ok:
        raise NotRun('LIVE needs Dean\'s yes: --live-ok-by-dean (release.py passes it only when VP_CANARY=1)')
    ku, ks, ka = t['keys']
    url, skey, akey = env.get(ku, '').rstrip('/'), env.get(ks, ''), env.get(ka, '')
    bad = []
    if not (url and skey and akey):
        bad.append('%s, %s and %s must all be in the key file' % t['keys'])
    if url != 'https://%s.supabase.co' % t['ref']:
        bad.append('%s is not the %s project (%s)' % (ku, name, t['ref']))
    other = LIVE_REF if name == 'staging' else TEST_REF
    for k in t['keys']:
        if other in env.get(k, ''):
            bad.append('%s names the other project' % k)
    if name == 'staging' and (LIVE_REF in t['game'] or '-staging.' not in t['game']):
        bad.append('the staging game Worker address is not a staging one')
    email = t['host_email'] or env.get(t['host_email_key'] or '', '')
    if not email:
        bad.append('no canary host login: %s is not in the key file' % t['host_email_key'])
    elif not email.endswith('@example.invalid'):
        bad.append('the canary host login must be an @example.invalid address')
    if bad:
        raise NotRun('; '.join(bad))
    t.update(name=name, supabase=url, service_key=skey, anon_key=akey, host_email=email)
    t['hosts'] = {urllib.parse.urlparse(t['game']).hostname, urllib.parse.urlparse(url).hostname}
    return t


class Net:
    """Every request goes through here. Only the target's own hosts; Supabase REST is GET only; the only Supabase POSTs
    are Auth's generate_link and verify. Returns (status, parsed json or text)."""

    def __init__(self, cfg, opener=None):
        self.cfg = cfg
        self.opener = opener or self._urllib
        self.log = []

    def check(self, method, url):
        u = urllib.parse.urlparse(url)
        if u.scheme != 'https' or u.hostname not in self.cfg['hosts']:
            raise NotRun('refused: %s is not one of this target\'s hosts %s' % (u.hostname, sorted(self.cfg['hosts'])))
        other = LIVE_REF if self.cfg['name'] == 'staging' else TEST_REF
        if other in url:
            raise NotRun('refused: %s names the other project' % u.hostname)
        if u.hostname == urllib.parse.urlparse(self.cfg['supabase']).hostname:
            if u.path.startswith('/rest/') and method != 'GET':
                raise NotRun('refused: the canary never writes to the database directly (%s %s)' % (method, u.path))
            if u.path.startswith('/auth/') and method != 'GET' and u.path not in ('/auth/v1/admin/generate_link', '/auth/v1/verify'):
                raise NotRun('refused: %s %s' % (method, u.path))
            if u.path.startswith('/rest/v1/rpc/'):
                raise NotRun('refused: the canary never calls a database function itself (the Worker does)')

    def __call__(self, method, url, body=None, headers=None):
        self.check(method, url)
        # Supabase refuses its secret key from anything that looks like a browser; Cloudflare refuses a bare client on the
        # staging game host. So: a plain name for Supabase, a browser-like one for the game Worker.
        sb = urllib.parse.urlparse(url).hostname == urllib.parse.urlparse(self.cfg['supabase']).hostname
        h = {'User-Agent': 'venueplay-canary-night/1.0' if sb else UA, 'Content-Type': 'application/json'}
        h.update(headers or {})
        t0 = time.time()
        status, data = self.opener(method, url, body, h)
        self.log.append({'m': method, 'path': urllib.parse.urlparse(url).path, 'status': status, 'ms': int((time.time() - t0) * 1000)})
        return status, data

    @staticmethod
    def _urllib(method, url, body, headers):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            r = urllib.request.urlopen(req, timeout=30)
            status, raw = r.status, r.read()
        except urllib.error.HTTPError as x:
            status, raw = x.code, x.read()
        txt = raw.decode('utf-8', 'replace')
        try:
            return status, json.loads(txt) if txt.strip() else None
        except ValueError:
            return status, txt[:300]


class Canary:
    def __init__(self, cfg, net, venue_slug=DEFAULT_VENUE, musical=True, say=print, sleep=time.sleep):
        if venue_slug not in ALLOW:
            raise NotRun('refused: %r is not on the canary allow-list %s' % (venue_slug, list(ALLOW)))
        self.cfg, self.net, self.slug, self.musical, self.say, self.sleep = cfg, net, venue_slug, musical, say, sleep
        self.checks, self.failed = [], []
        self.session_id = self.venue_id = self.token = None
        self.closed = False

    # ---------------------------------------------------------------- plumbing
    def ok(self, what, cond, extra=''):
        self.checks.append((what, bool(cond)))
        self.say(('  ok   ' if cond else '  FAIL ') + what + (('   ' + str(extra)[:300]) if (not cond and extra != '') else ''))
        if not cond:
            self.failed.append(what)
        return bool(cond)

    def must(self, what, cond, extra=''):
        if not self.ok(what, cond, extra):
            raise Red(what)

    def rest(self, path):
        k = self.cfg['service_key']
        st, d = self.net('GET', self.cfg['supabase'] + '/rest/v1/' + path, None, {'apikey': k, 'Authorization': 'Bearer ' + k})
        if st != 200 or not isinstance(d, list):
            raise NotRun('could not read %s (%s)' % (path.split('?')[0], st))
        return d

    def game(self, method, path, body=None, token=None, player=None):
        h = {'Origin': self.cfg['site']}
        if token:
            h['Authorization'] = 'Bearer ' + token
        if player:
            h['X-Player-Token'] = player
        return self.net(method, self.cfg['game'] + path, body, h)

    def host(self, path, body):
        return self.game('POST', path, body, token=self.token)

    # ---------------------------------------------------------------- before anything is opened
    def preflight(self):
        st, h = self.game('GET', '/health')
        if st != 200 or not isinstance(h, dict) or h.get('ok') is not True:
            raise Red('the game Worker /health is not ok (%s %s)' % (st, str(h)[:120]))
        self.ok('game Worker /health ok (%s)' % h.get('build'), True)
        vs = self.rest('vp_venues?slug=eq.%s&select=id,slug,name,status,founding_id,group_id,max_players,included_players,'
                       'weekly_limit_off' % self.slug)
        if len(vs) != 1:
            raise NotRun('%s is not in this target\'s venue table' % self.slug)
        v = vs[0]
        self.venue_id, self.venue = v['id'], v
        if v.get('slug') != self.slug or not str(v.get('name', '')).startswith('Test '):
            raise NotRun('refused: %s is not named like a test venue (%r)' % (self.slug, v.get('name')))
        if v.get('status') != 'active':
            raise NotRun('%s is not active' % self.slug)
        if v.get('weekly_limit_off') is not True:
            raise NotRun('%s still has the once-a-week rule: HQ must switch on unlimited nights for it first' % self.slug)
        cap = v.get('max_players') if v.get('max_players') is not None else v.get('included_players')
        if cap is not None and int(cap) < 3:
            raise NotRun('%s plan is %s players; the canary needs room for 2 under the plan' % (self.slug, cap))
        if v.get('founding_id'):
            f = self.rest('venueplay_founding?id=eq.%s&select=status,stripe_customer_id,stripe_subscription_id' % v['founding_id'])
            if f and (f[0].get('stripe_subscription_id') or f[0].get('stripe_customer_id') or f[0].get('status') != 'comp'):
                why = [w for w, bad in (('a Stripe subscription', f[0].get('stripe_subscription_id')),
                                        ('a Stripe customer', f[0].get('stripe_customer_id')),
                                        ('billing status %r, not comp' % f[0].get('status'), f[0].get('status') != 'comp')) if bad]
                raise NotRun('refused: %s could be charged: %s' % (self.slug, ', '.join(why)))
        # the host login, by Supabase Auth (minted with the service key: no text, no email, no code)
        k, a = self.cfg['service_key'], self.cfg['anon_key']
        st, g = self.net('POST', self.cfg['supabase'] + '/auth/v1/admin/generate_link',
                         {'type': 'magiclink', 'email': self.cfg['host_email']}, {'apikey': k, 'Authorization': 'Bearer ' + k})
        th = isinstance(g, dict) and ((g.get('properties') or {}).get('hashed_token') or g.get('hashed_token'))
        if st != 200 or not th:
            raise NotRun('could not make the canary host sign-in (%s)' % st)
        st, s = self.net('POST', self.cfg['supabase'] + '/auth/v1/verify', {'type': 'magiclink', 'token_hash': th},
                         {'apikey': a, 'Authorization': 'Bearer ' + a})
        if st != 200 or not isinstance(s, dict) or not s.get('access_token'):
            msg = (s.get('error_code') or s.get('code') or '', s.get('msg') or s.get('error_description') or s.get('message') or '') if isinstance(s, dict) else ('', str(s)[:120])
            raise NotRun('the canary host sign-in was refused (%s %s: %s)' % (st, msg[0], msg[1]))
        self.token, uid = s['access_token'], (s.get('user') or {}).get('id')
        staff = self.rest('vp_venue_staff?auth_user_id=eq.%s&select=venue_id,role' % uid)
        ids = {r['venue_id'] for r in staff}
        if self.venue_id not in ids:
            raise NotRun('the canary host is not staff at %s' % self.slug)
        allowed = {r['id'] for r in self.rest('vp_venues?slug=in.(%s)&select=id' % ','.join(ALLOW))}
        if self.cfg['name'] == 'staging':
            # every venue on the TEST database is a made-up one (test- seed, stage- pubs and sign-ups); the rail is for live
            allowed |= {r['id'] for r in self.rest('vp_venues?or=(slug.like.test-*,slug.like.stage-*)&select=id')}
        if ids - allowed:
            raise NotRun('refused: the canary host login is staff at %d venue(s) that are not test venues' % len(ids - allowed))
        live = self.rest('vp_sessions?venue_id=eq.%s&status=in.(lobby,running,paused)&select=id' % self.venue_id)
        if live:
            raise NotRun('a night is already on at %s (session %s): never touched' % (self.slug, live[0]['id'][:8]))
        sets = self.rest('vp_question_sets?visibility=eq.library&owner_venue_id=is.null&status=eq.active&question_count=gte.3'
                         '&select=id,title&order=title.asc&limit=1')
        if not sets:
            raise NotRun('no library question set with 3 questions')
        self.set_id = sets[0]['id']
        self.playlist_id = None
        if self.musical:
            pls = self.rest('vp_playlists?owner_venue_id=is.null&song_count=gte.24&select=id,title&order=title.asc&limit=1')
            if not pls:
                raise NotRun('no library playlist with 24 songs for musical bingo')
            self.playlist_id = pls[0]['id']
        self.ok('preflight: %s is a test venue, comp, unlimited nights, nobody playing; host signed in, staff at test venues only'
                % self.slug, True)

    # ---------------------------------------------------------------- the night
    def tv(self):
        st, d = self.game('GET', '/snapshot?session=' + self.session_id)
        self.must('TV /snapshot answers', st == 200 and isinstance(d, dict), st)
        return d

    def join(self, name, pid):
        st, d = self.game('POST', '/join', {'code': self.code, 'name': name, 'pid': pid})
        self.must('phone %s joins (/join, vp_join_context)' % name, st == 200 and isinstance(d, dict) and d.get('token'), [st, d])
        return d['token']

    def night(self):
        st, scr = self.game('GET', '/screen?venue=%s&v=canary' % self.slug)
        self.must('TV finds its venue (/screen, vp_screen_poll)', st == 200 and isinstance(scr, dict) and scr.get('exists') is not False
                  and scr.get('name') == self.venue['name'], [st, scr])
        st, s = self.host('/session', {'venue_id': self.venue_id, 'format': 'trivia', 'road': 'room'})
        self.must('host opens the night (/session)', st == 200 and isinstance(s, dict) and s.get('session_id') and s.get('join_code'), [st, s])
        if s.get('reused'):
            # somebody opened a night in the second since the preflight: theirs, never touched, never closed, not a fault
            raise NotRun('a night was opened at %s while the canary started (session %s): left alone' % (self.slug, str(s.get('session_id'))[:8]))
        self.ok('it is a NEW night, not one somebody had open', True)
        self.session_id, self.code = s['session_id'], s['join_code']
        tag = secrets.token_hex(4)
        pa, pb = 'canary-a-' + tag, 'canary-b-' + tag
        ta = self.join('Canary A', pa)
        tb = self.join('Canary B', pb)
        ta2 = self.join('Canary A', pa)
        snap = self.tv()
        self.must('a returning phone keeps its seat: the room holds 2 players, not 3 (what billing counts)', snap.get('player_count') == 2, snap.get('player_count'))
        ta = ta2 or ta
        # ---------------- trivia
        st, g = self.host('/host/game', {'session_id': self.session_id, 'format': 'trivia', 'question_set_id': self.set_id,
                                         'question_count': 3, 'time_limit_s': 30, 'title': 'Canary night', 'prize': 'none'})
        self.must('host starts a 3-question trivia game (/host/game)', st == 200 and isinstance(g, dict) and g.get('game_id'), [st, g])
        self.ok('the game holds 3 questions', g.get('question_count') == 3, g.get('question_count'))
        gid = self.trivia_game = g['game_id']
        for n in (1, 2, 3):
            st, q = self.host('/host/question', {'game_id': gid})
            self.must('Q%d: host asks (/host/question)' % n, st == 200 and isinstance(q, dict) and q.get('qseq') is not None
                      and isinstance(q.get('correct_index'), int) and q.get('options'), [st, q])
            self.ok('Q%d: the console says question %d of 3' % (n, n), q.get('qi') == n and q.get('qtotal') == 3, [q.get('qi'), q.get('qtotal')])
            right, nopts = q['correct_index'], len(q['options'])
            wrong = (right + 1) % nopts
            tq = (self.tv().get('game') or {}).get('question') or {}
            self.ok('Q%d: the TV shows the same question as the console' % n, tq.get('qseq') == q['qseq'] and tq.get('text') == q.get('text'), [tq.get('text'), q.get('text')])
            self.ok('Q%d: the TV is not given the answer before the reveal' % n, 'correct_index' not in tq, tq)
            st, a = self.game('POST', '/player/answer', {'game_id': gid, 'answer_index': right, 'qseq': q['qseq']}, player=ta)
            self.must('Q%d: phone A answers (vp_player_answer: recorded)' % n, st == 200 and isinstance(a, dict) and a.get('recorded') is True, [st, a])
            st, b = self.game('POST', '/player/answer', {'game_id': gid, 'answer_index': wrong, 'qseq': q['qseq']}, player=tb)
            self.must('Q%d: phone B answers (recorded)' % n, st == 200 and isinstance(b, dict) and b.get('recorded') is True, [st, b])
            st, a2 = self.game('POST', '/player/answer', {'game_id': gid, 'answer_index': wrong, 'qseq': q['qseq']}, player=ta)
            self.ok('Q%d: phone A taps again: already answered, the first answer stands' % n,
                    st == 200 and isinstance(a2, dict) and a2.get('recorded') is False and a2.get('reason') == 'already_answered', [st, a2])
            st, r = self.host('/host/reveal', {'game_id': gid})
            self.must('Q%d: host reveals (/host/reveal)' % n, st == 200 and isinstance(r, dict) and r.get('correct_index') == right, [st, r])
            board = r.get('leaderboard') or []
            self.ok('Q%d: the board has A above B' % n, len(board) == 2 and board[0].get('name') == 'Canary A'
                    and (board[0].get('points') or 0) > (board[1].get('points') or 0), board)
            tg = (self.tv().get('game') or {})
            self.ok('Q%d: the TV shows the answer after the reveal' % n, tg.get('phase') == 'revealed'
                    and (tg.get('question') or {}).get('correct_index') == right, [tg.get('phase'), (tg.get('question') or {}).get('correct_index')])
            st, sc = self.game('GET', '/player/score?game=%s&q=%s' % (gid, q['qseq']), player=ta)
            la = (sc or {}).get('last') or {} if isinstance(sc, dict) else {}
            self.ok('Q%d: phone A is told it was right, first of 2 (/player/score)' % n, st == 200 and la.get('qseq') == q['qseq']
                    and la.get('is_correct') is True and sc.get('rank') == 1 and sc.get('players_count') == 2 and (sc.get('total') or 0) > 0, [st, sc])
            st, sb = self.game('GET', '/player/score?game=%s&q=%s' % (gid, q['qseq']), player=tb)
            lb = (sb or {}).get('last') or {} if isinstance(sb, dict) else {}
            self.ok('Q%d: phone B is told it was wrong, second of 2' % n, st == 200 and lb.get('qseq') == q['qseq']
                    and lb.get('is_correct') is False and sb.get('rank') == 2, [st, sb])
        st, q = self.host('/host/question', {'game_id': gid})
        self.ok('after question 3 the Worker says the game is done', st == 200 and isinstance(q, dict) and q.get('done') is True, [st, q])
        st, bd = self.host('/host/trivia/board', {'game_id': gid})
        pod = (bd or {}).get('leaderboard') if isinstance(bd, dict) else None
        self.ok('the podium: Canary A first, Canary B second', st == 200 and pod and [p.get('name') for p in pod] == ['Canary A', 'Canary B'], [st, bd])
        st, e = self.host('/host/game/end', {'game_id': gid})
        self.must('host ends the trivia game (/host/game/end)', st == 200 and isinstance(e, dict) and e.get('status') == 'finished' and not e.get('already'), [st, e])
        st, e2 = self.host('/host/game/end', {'game_id': gid})
        self.ok('a second End changes nothing (already)', st == 200 and isinstance(e2, dict) and e2.get('already') is True, [st, e2])
        self.ok('the TV leaves the quiz', (self.tv().get('game') or {}).get('format') != 'trivia', '')
        # ---------------- musical bingo: one deal, a wrong claim refused, a right claim confirmed
        self.musical_game = None
        if self.musical:
            st, m = self.host('/host/game', {'session_id': self.session_id, 'format': 'musical', 'playlist_id': self.playlist_id,
                                             'pattern': 'one_line', 'prize': 'none', 'title': 'Canary musical'})
            self.must('host starts musical bingo (/host/game)', st == 200 and isinstance(m, dict) and m.get('game_id'), [st, m])
            mid = self.musical_game = m['game_id']
            st, ca = self.game('GET', '/player/card?game=' + mid, player=ta)
            st2, cb = self.game('GET', '/player/card?game=' + mid, player=tb)
            cells_a = (ca or {}).get('cells') if isinstance(ca, dict) else None
            self.must('both phones are dealt a card (/player/card)', st == 200 and st2 == 200 and isinstance(cells_a, list) and len(cells_a) == 25
                      and isinstance((cb or {}).get('cells'), list), [st, st2])
            self.ok('the two cards differ', cells_a != cb.get('cells'), '')
            st, wb = self.game('POST', '/player/claim', {'game_id': mid}, player=tb)
            self.must('phone B claims with nothing played: refused (auto_verdict invalid)', st == 200 and isinstance(wb, dict)
                      and wb.get('auto_verdict') == 'invalid' and wb.get('claim_id'), [st, wb])
            st, rj = self.host('/host/claim/resolve', {'claim_id': wb['claim_id'], 'decision': 'reject'})
            self.must('host rejects B\'s claim', st == 200 and isinstance(rj, dict) and rj.get('status') == 'rejected', [st, rj])
            row = [c for c in cells_a[0:5]]
            for c in row:
                st, p = self.host('/host/play', {'game_id': mid, 'song_id': c['song_id']})
                self.must('host plays "%s" (/host/play)' % str(c.get('title', ''))[:30], st == 200 and isinstance(p, dict) and p.get('song_id') == c['song_id'], [st, p])
            tvm = self.tv().get('game') or {}
            self.ok('the TV shows the 5 songs played', tvm.get('format') == 'musical_bingo' and tvm.get('played_count') == 5, tvm.get('played_count'))
            st, wa = self.game('POST', '/player/claim', {'game_id': mid}, player=ta)
            self.must('phone A claims its top row: valid', st == 200 and isinstance(wa, dict) and wa.get('auto_verdict') == 'valid', [st, wa])
            self.ok('the Worker names the 5 winning squares', sorted(wa.get('winning_cells') or []) == [0, 1, 2, 3, 4], wa.get('winning_cells'))
            st, cf = self.host('/host/claim/resolve', {'claim_id': wa['claim_id'], 'decision': 'confirm'})
            self.must('host confirms A\'s win', st == 200 and isinstance(cf, dict) and cf.get('status') == 'confirmed', [st, cf])
            st, e = self.host('/host/game/end', {'game_id': mid})
            self.must('host ends musical bingo', st == 200 and isinstance(e, dict) and e.get('status') == 'finished', [st, e])
        self.close()
        self.readback()

    def close(self):
        if self.session_id and not self.closed:
            st, c = self.host('/session/close', {'session_id': self.session_id})
            self.closed = st == 200 and isinstance(c, dict) and c.get('status') == 'finished'
            self.ok('host closes the night (/session/close)', self.closed, [st, c])

    def readback(self):
        sid = self.session_id
        s = self.rest('vp_sessions?id=eq.%s&select=status,venue_id' % sid)
        self.ok('database: the night is finished, at %s' % self.slug, s and s[0]['status'] == 'finished' and s[0]['venue_id'] == self.venue_id, s)
        pl = self.rest('vp_players?session_id=eq.%s&kicked=eq.false&select=display_name,device_id' % sid)
        self.ok('database: exactly 2 players (billing counts 2)', sorted(p['display_name'] for p in pl) == ['Canary A', 'Canary B']
                and len({p['device_id'] for p in pl}) == 2, pl)
        gs = self.rest('vp_games?session_id=eq.%s&select=format,status&order=seq.asc' % sid)
        want = [{'format': 'trivia', 'status': 'finished'}] + ([{'format': 'musical_bingo', 'status': 'finished'}] if self.musical else [])
        self.ok('database: the games, each finished', gs == want, gs)
        an = self.rest('vp_trivia_answers?game_id=eq.%s&select=answer_index' % self.trivia_game)
        self.ok('database: 6 trivia answers (2 phones x 3 questions, the second taps not kept)', len(an) == 6, len(an))
        if self.musical_game:
            cl = self.rest('vp_claims?game_id=eq.%s&select=auto_verdict,status&order=claimed_at.asc' % self.musical_game)
            self.ok('database: 2 claims, B invalid rejected then A valid confirmed',
                    cl == [{'auto_verdict': 'invalid', 'status': 'rejected'}, {'auto_verdict': 'valid', 'status': 'confirmed'}], cl)

    def run(self):
        """0 green, 1 red, 2 not run. The night is always closed, whatever happened."""
        try:
            self.preflight()
        except NotRun as e:
            self.say('NOT RUN: %s' % e)
            return 2
        except Red as e:
            self.say('RED: %s' % e)
            return 1
        try:
            self.night()
        except NotRun as e:
            self.say('NOT RUN: %s' % e)
            self.safe_close()
            return 2 if not self.session_id else 1
        except Red as e:
            self.say('RED at: %s' % e)
            self.safe_close()
            return 1
        except Exception as e:   # a crash mid-night on the real system is red: a venue would have met it
            self.say('RED: %s: %s' % (type(e).__name__, str(e)[:300]))
            self.safe_close()
            return 1
        if self.failed:
            self.say('RED: %d of %d checks failed: %s' % (len(self.failed), len(self.checks), '; '.join(self.failed[:6])))
            return 1
        self.say('CANARY GREEN: %d checks, %s' % (len(self.checks), self.slug))
        return 0

    def safe_close(self):
        try:
            self.close()
        except Exception as e:
            self.say('  (closing the night failed too: %s)' % str(e)[:200])


def main(argv=None, env=None, opener=None, say=print):
    argv = list(sys.argv[1:] if argv is None else argv)
    target = argv[argv.index('--target') + 1] if '--target' in argv else 'staging'
    venue = argv[argv.index('--venue') + 1] if '--venue' in argv else DEFAULT_VENUE
    report = argv[argv.index('--report') + 1] if '--report' in argv else None
    env = read_env() if env is None else env
    t0 = time.time()
    try:
        cfg = target_config(target, env, live_ok='--live-ok-by-dean' in argv)
        net = Net(cfg, opener)
        c = Canary(cfg, net, venue, musical='--no-musical' not in argv, say=say)
    except NotRun as e:
        say('NOT RUN: %s' % e)
        return 2
    say('CANARY NIGHT on %s at %s (%s)' % (target, venue, cfg['game']))
    rc = c.run()
    if report:
        with open(report, 'w') as f:
            json.dump({'target': target, 'venue': venue, 'exit': rc, 'seconds': int(time.time() - t0), 'session': c.session_id,
                       'checks': c.checks, 'failed': c.failed, 'calls': net.log}, f, indent=1)
    return rc


if __name__ == '__main__':
    sys.exit(main())
