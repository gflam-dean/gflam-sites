#!/usr/bin/env python3
"""THE THREE DATABASE FUNCTIONS A TRIVIA NIGHT RUNS ON, EXECUTED FOR REAL ON THE venueplay TEST DATABASE (421 gap 1).

On live, a trivia answer is judged by vp_player_answer, a join by vp_join_context and a TV poll by vp_screen_poll. Every
other suite fakes them: the rig answers "no function" (so the Worker's old fallback path is what gets played) and the jsc
suites hand-write the reply. A wrong status word, a late answer accepted or a join refused would break every trivia night
with every suite green. This suite calls the real functions on real Postgres 17 (the TEST project rkfaftxgzpsmmrzudlqy,
same major as live) for EVERY status they return.

    python3 tools/staging/db-functions-on-test.test.py            both passes (below)
    python3 tools/staging/db-functions-on-test.test.py --pass db  only the functions as they are on TEST
    python3 tools/staging/db-functions-on-test.test.py --pass repo only the repo's migration copies

TWO PASSES, EACH ONE TRANSACTION THAT IS ROLLED BACK. Nothing is left behind and no seed is needed: every fixture (a
venue, its billing row, a group, sessions, players, a question set, games) is made inside the transaction, every case
runs, then ROLLBACK.
  db    the functions as they are on TEST (which check-schema-matches-live keeps the same shape as live)
  repo  the same cases after `create or replace` of the function from the repo's migration file, inside the same rolled-
        back transaction: the SQL in the repo is proven on Postgres before anyone pastes it on live. prove-checks breaks
        those files on purpose and this pass must go red.

COVERAGE IS COUNTED, NOT CLAIMED. Every status word the function's source can return (status := '...') must be hit by a
case here, or be one the foreign keys make impossible (no_session, venue_missing: the suite proves those keys exist), and
every status must be in the game Worker's ANSWER_STATUS table (or it would answer a phone with a 500).

SAFE BY CONSTRUCTION. The connection is tools/staging/run-on-test.py's connect(): the ref must be the TEST ref, live
(ijkzgmdtwtgfkedqspxm) is refused by name, host and user are checked before a socket opens, TLS is verified, then its
read-only "is this alive?" questions run and any answer that looks like live refuses. Inside the transaction the TEST guard
block runs first, so the database itself refuses too. Exit 0 all passed, 1 a check failed, 2 NOT CHECKED (no key file, no
network, refused): a NOT CHECKED is never a pass.
"""
import hashlib, importlib.util, json, os, re, secrets, sys, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TEST_REF = 'rkfaftxgzpsmmrzudlqy'
LIVE_REF = 'ijkzgmdtwtgfkedqspxm'
SUPA = os.path.join(ROOT, 'venueplay-backend', 'supabase')
WORKER = os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-game.js')
FUNCS = {
    'vp_player_answer': os.path.join(SUPA, 'venueplay-99-answer-membership-first.sql'),
    'vp_join_context': os.path.join(SUPA, 'venueplay-132-one-trip-join-context.sql'),
    'vp_screen_poll': os.path.join(SUPA, 'venueplay-72-one-trip-screen-poll.sql'),
}
# Impossible while these foreign keys hold (checked below, not assumed): a game always has its session, a session its venue.
FK_HELD = {'no_session': ('vp_games', 'session_id', 'vp_sessions'), 'venue_missing': ('vp_sessions', 'venue_id', 'vp_venues')}
CODE_ALPHA = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'

GUARD = """do $guard$
declare n bigint;
begin
  if to_regclass('vp_staging.vp_staging_marker') is null then
    raise exception 'REFUSED: no TEST marker here. Nothing was changed.';
  end if;
  execute 'select count(*) from vp_staging.vp_staging_marker where project_ref = ''%s''' into n;
  if n <> 1 then raise exception 'REFUSED: the TEST marker does not name %s. Nothing was changed.'; end if;
  select count(*) into n from auth.users
   where greatest(coalesce(last_sign_in_at, 'epoch'::timestamptz), coalesce(created_at, 'epoch'::timestamptz)) >= '2026-10-01'
     and not (coalesce(email, '') like '%%@example.invalid' or coalesce(phone, '') like '6149157%%');
  if n > 0 then raise exception 'REFUSED: real people sign in here. Is this LIVE? Nothing was changed.'; end if;
end
$guard$""" % (TEST_REF, TEST_REF)

RESULTS = {'ok': 0, 'fail': 0}


def ok(what, cond, extra=''):
    RESULTS['ok' if cond else 'fail'] += 1
    print(('  ok   ' if cond else '  FAIL ') + what + (('   ' + str(extra)[:300]) if (extra != '' and not cond) else ''), flush=True)
    return cond


def load_rot():
    spec = importlib.util.spec_from_file_location('run_on_test', os.path.join(HERE, 'run-on-test.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ------------------------------------------------------------------ the repo's SQL, read offline
def repo_function_sql(fn, path=None):
    """The `create or replace function public.<fn>(...) ... $$;` block from its migration file, nothing else."""
    text = open(path or FUNCS[fn]).read()
    m = re.search(r'create or replace function public\.%s\s*\(' % re.escape(fn), text, re.I)
    if not m:
        raise ValueError('%s: no create or replace function public.%s in %s' % (fn, fn, os.path.basename(path or FUNCS[fn])))
    body = re.search(r'\bas\s+\$\$', text[m.start():], re.I)
    if not body:
        raise ValueError('%s: no $$ body' % fn)
    start = m.start() + body.end()
    end = text.find('\n$$;', start)
    if end < 0:
        raise ValueError('%s: the $$ body does not end' % fn)
    return text[m.start():end + 4]


def statuses_in(sql):
    return set(re.findall(r"status\s*:=\s*'([a-z_]+)'", sql))


def worker_answer_statuses():
    src = open(WORKER).read()
    m = re.search(r'const ANSWER_STATUS = \{(.*?)\n\};', src, re.S)
    return set(re.findall(r'^\s*([a-z_]+):\s*\[', m.group(1), re.M)) if m else set()


def worker_direct_statuses():
    """recorded and already are answered before the table (status === 'recorded' / 'already' in handlePlayerAnswer)."""
    src = open(WORKER).read()
    i = src.find('async function handlePlayerAnswer(')
    body = src[i:src.find('\nasync function ', i + 10)]
    return set(re.findall(r"status === '([a-z_]+)'\)\s*return json\(", body))


# ------------------------------------------------------------------ the fixture, inside the transaction
def code6():
    return ''.join(secrets.choice(CODE_ALPHA) for _ in range(6))


def th():
    return hashlib.sha256(secrets.token_hex(32).encode()).hexdigest()


def build(run):
    """Every row the cases need, made inside the open transaction. Returns the ids."""
    tag = secrets.token_hex(3)
    F = {k: str(uuid.uuid4()) for k in ('found', 'found2', 'group', 'venue', 'venue2', 'venueg', 'sess', 'sess2', 'sessg',
                                        'sessdone', 'qset', 'gt', 'gm', 'gf', 'gnotg', 'gg', 'pa', 'pb', 'pk', 'px', 'pg',
                                        'pdup1', 'pdup2')}
    F.update(slug='test-dbfn-' + tag, slug2='test-dbfn2-' + tag, slugg='test-dbfng-' + tag,
             code=code6(), code2=code6(), codeg=code6(), codedone=code6(),
             ha=th(), hb=th(), hk=th(), hx=th(), hg=th(), dev_a='dbfn-dev-a-' + tag, dev_k='dbfn-dev-k-' + tag,
             dev_dup='dbfn-dev-dup-' + tag)
    for k in ('found', 'found2'):
        run("insert into public.venueplay_founding (id, venue_name, contact_email, status) values (:i::uuid, 'DB functions test', "
            "'dbfn@example.invalid', 'comp')", i=F[k])
    run("insert into public.vp_venue_groups (id, name, billing_email, negotiated_rate_cents, status) values "
        "(:i::uuid, 'DB functions group', 'dbfn@example.invalid', 0, 'active')", i=F['group'])
    run("insert into public.vp_venues (id, founding_id, slug, name, status) values (:i::uuid, :f::uuid, :s, 'DB fn venue', 'active')",
        i=F['venue'], f=F['found'], s=F['slug'])
    run("insert into public.vp_venues (id, founding_id, slug, name, status) values (:i::uuid, :f::uuid, :s, 'DB fn venue 2', 'active')",
        i=F['venue2'], f=F['found2'], s=F['slug2'])
    run("insert into public.vp_venues (id, group_id, slug, name, status) values (:i::uuid, :g::uuid, :s, 'DB fn group venue', 'active')",
        i=F['venueg'], g=F['group'], s=F['slugg'])
    run("insert into public.vp_venue_settings (venue_id, collect_first_name, collect_last_name, collect_postcode, collect_email, "
        "collect_mobile, collect_marketing_optin) values (:v::uuid, true, false, true, false, true, false) "
        "on conflict (venue_id) do update set collect_first_name = true, collect_last_name = false, collect_postcode = true, "
        "collect_email = false, collect_mobile = true, collect_marketing_optin = false", v=F['venue'])
    for s, v, c, st in (('sess', 'venue', 'code', 'running'), ('sess2', 'venue2', 'code2', 'running'),
                        ('sessg', 'venueg', 'codeg', 'running')):
        run("insert into public.vp_sessions (id, venue_id, join_code, status) values (:i::uuid, :v::uuid, :c, :st)",
            i=F[s], v=F[v], c=F[c], st=st)
    run("insert into public.vp_sessions (id, venue_id, join_code, status, ended_at) values (:i::uuid, :v::uuid, :c, 'finished', now())",
        i=F['sessdone'], v=F['venue'], c=F['codedone'])
    run("insert into public.vp_question_sets (id, owner_venue_id, title, visibility, status) values (:i::uuid, :v::uuid, 'DB fn set', "
        "'private', 'active')", i=F['qset'], v=F['venue'])
    for n in (1, 2, 3):
        run("insert into public.vp_questions (set_id, seq, question, options, correct_index) values (:s::uuid, :n, :q, "
            "'[\"A\",\"B\",\"C\",\"D\"]'::jsonb, 1)", s=F['qset'], n=n, q='DB fn question %d' % n)
    for g, s, seq, fmt, st in (('gt', 'sess', 1, 'trivia', 'running'), ('gm', 'sess', 2, 'musical_bingo', 'running'),
                               ('gf', 'sess', 3, 'trivia', 'finished'), ('gnotg', 'sess', 4, 'trivia', 'running'),
                               ('gg', 'sessg', 1, 'trivia', 'running')):
        run("insert into public.vp_games (id, session_id, seq, format, status, config) values (:i::uuid, :s::uuid, :n, :f, :st, "
            "'{}'::jsonb)", i=F[g], s=F[s], n=seq, f=fmt, st=st)
    for g in ('gt', 'gg'):
        run("insert into public.vp_trivia_games (game_id, question_set_id, current_seq, phase, question_ends_at) values "
            "(:g::uuid, :q::uuid, 1, 'asking', now() + interval '60 seconds')", g=F[g], q=F['qset'])
    for p, s, h, kicked, dev, ago in (('pa', 'sess', 'ha', False, 'dev_a', 50), ('pb', 'sess', 'hb', False, None, 40),
                                      ('pk', 'sess', 'hk', True, 'dev_k', 30), ('px', 'sess2', 'hx', False, None, 20),
                                      ('pg', 'sessg', 'hg', False, None, 10)):
        run("insert into public.vp_players (id, session_id, token_hash, kicked, device_id, display_name, joined_at) values "
            "(:i::uuid, :s::uuid, :h, :k, :d, :n, now() - make_interval(secs => :a))",
            i=F[p], s=F[s], h=F[h], k=kicked, d=(F[dev] if dev else None), n='DB fn ' + p, a=ago)
    # a phone that was kicked and joined again: the kicked row stays, a fresh one is made (the unique index on
    # (session, device) only counts rows that are not kicked). A returning phone gets the LIVE row, never the kicked one.
    for p, ago, kicked in (('pdup1', 90, True), ('pdup2', 5, False)):
        run("insert into public.vp_players (id, session_id, token_hash, kicked, device_id, display_name, joined_at) values "
            "(:i::uuid, :s::uuid, :h, :k, :d, 'DB fn dup', now() - make_interval(secs => :a))",
            i=F[p], s=F['sess'], h=th(), k=kicked, d=F['dev_dup'], a=ago)
    return F


# ------------------------------------------------------------------ the cases
def answer(run, h, game, idx, qseq):
    r = run("select status, player_id::text, session_id::text from public.vp_player_answer(:h, :g::uuid, :i, :q)",
            h=h, g=game, i=idx, q=qseq)
    return (r[0][0] if r else None), (r[0] if r else None)


def player_answer_cases(run, F, label):
    hit = set()

    def want(what, status, h, game, idx, qseq, setup=None):
        run('savepoint c')
        try:
            for s in (setup or []):
                run(s[0], **s[1])
            got, row = answer(run, h, game, idx, qseq)
        finally:
            run('rollback to savepoint c')
        hit.add(status)
        return ok('%s vp_player_answer %s -> %s' % (label, what, status), got == status, 'got %r' % (got,))

    # recorded, then the second tap on the same question is 'already' and the first answer stands
    got, row = answer(run, F['ha'], F['gt'], 1, 1)
    hit.add('recorded')
    ok('%s vp_player_answer a first answer -> recorded (and names the player and session)' % label,
       got == 'recorded' and row[1] == F['pa'] and row[2] == F['sess'], row)
    got, _ = answer(run, F['ha'], F['gt'], 2, 1)
    hit.add('already')
    ok('%s vp_player_answer the same phone again -> already' % label, got == 'already', got)
    kept = run("select answer_index from public.vp_trivia_answers where game_id = :g::uuid and player_id = :p::uuid", g=F['gt'], p=F['pa'])
    ok('%s the first answer is the one kept (one row, index 1)' % label, [list(r) for r in kept] == [[1]], kept)
    got, _ = answer(run, F['hb'], F['gt'], 0, None)
    ok('%s vp_player_answer with no qseq (an older phone) -> recorded' % label, got == 'recorded', got)

    want('an unknown token', 'bad_token', th(), F['gt'], 1, 1)
    want('a kicked phone', 'kicked', F['hk'], F['gt'], 1, 1)
    want('a game that does not exist', 'no_game', F['hb'], str(uuid.uuid4()), 1, 1)
    want('a phone from another venue\'s night', 'wrong_game', F['hx'], F['gt'], 1, 1)
    want('another night\'s phone on a MUSICAL game (membership before format, migration 99)', 'wrong_game', F['hx'], F['gm'], 1, 1)
    want('a musical bingo game', 'not_trivia', F['hb'], F['gm'], 1, 1)
    want('a trivia game with no trivia row', 'not_trivia', F['hb'], F['gnotg'], 1, 1)
    want('a finished game', 'not_running', F['hb'], F['gf'], 1, 1)
    want('a closed session', 'session_closed', F['hb'], F['gt'], 1, 1,
         [("update public.vp_sessions set status = 'finished' where id = :s::uuid", {'s': F['sess']})])
    want('a cancelled session', 'session_closed', F['hb'], F['gt'], 1, 1,
         [("update public.vp_sessions set status = 'cancelled' where id = :s::uuid", {'s': F['sess']})])
    want('a suspended venue', 'venue_paused', F['hb'], F['gt'], 1, 1,
         [("update public.vp_venues set status = 'suspended' where id = :v::uuid", {'v': F['venue']})])
    want('a venue whose group is suspended', 'venue_paused', F['hg'], F['gg'], 1, 1,
         [("update public.vp_venue_groups set status = 'suspended' where id = :g::uuid", {'g': F['group']})])
    want('a grouped venue whose group is active', 'recorded', F['hg'], F['gg'], 1, 1)
    want('no question open (revealed)', 'no_question', F['hb'], F['gt'], 1, 1,
         [("update public.vp_trivia_games set phase = 'revealed' where game_id = :g::uuid", {'g': F['gt']})])
    want('no question open (locked)', 'no_question', F['hb'], F['gt'], 1, 1,
         [("update public.vp_trivia_games set phase = 'locked' where game_id = :g::uuid", {'g': F['gt']})])
    want('no question yet (current_seq 0)', 'no_question', F['hb'], F['gt'], 1, 1,
         [("update public.vp_trivia_games set current_seq = 0 where game_id = :g::uuid", {'g': F['gt']})])
    want('an answer after the deadline', 'time_up', F['hb'], F['gt'], 1, 1,
         [("update public.vp_trivia_games set question_ends_at = now() - interval '1 second' where game_id = :g::uuid", {'g': F['gt']})])
    want('no deadline set (host-paced) -> still recorded', 'recorded', F['hb'], F['gt'], 1, 1,
         [("update public.vp_trivia_games set question_ends_at = null where game_id = :g::uuid", {'g': F['gt']}),
          ("delete from public.vp_trivia_answers where game_id = :g::uuid and player_id = :p::uuid", {'g': F['gt'], 'p': F['pb']})])
    want('an answer to the question before', 'moved_on', F['hb'], F['gt'], 1, 2)
    want('a question row that is gone', 'no_question_row', F['hb'], F['gt'], 1, None,
         [("update public.vp_trivia_games set current_seq = 99 where game_id = :g::uuid", {'g': F['gt']})])
    want('index 4 of 4 options', 'bad_index', F['hb'], F['gt'], 4, 1)
    want('index -1', 'bad_index', F['hb'], F['gt'], -1, 1)
    want('no index', 'bad_index', F['hb'], F['gt'], None, 1)
    n = run("select count(*) from public.vp_trivia_answers where game_id = :g::uuid", g=F['gt'])[0][0]
    ok('%s only the two recorded answers were written (refusals write nothing)' % label, n == 2, n)
    return hit


def join_context_cases(run, F, label):
    j = lambda code, dev: run("select public.vp_join_context(:c, :d)::text", c=code, d=dev)[0][0]
    jj = lambda code, dev: json.loads(j(code, dev))
    r = jj(code6(), '')
    ok('%s vp_join_context an unknown code -> session null' % label, r == {'session': None}, r)
    r = jj(F['codedone'], '')
    ok('%s vp_join_context a finished night\'s code -> session null' % label, r == {'session': None}, r)
    r = jj(F['code'], '')
    s = r.get('session') or {}
    ok('%s vp_join_context a new phone: the session' % label, s.get('id') == F['sess'] and s.get('status') == 'running', s)
    ok('%s vp_join_context a new phone: the venue (status, slug, no group)' % label,
       r.get('venue') == {'status': 'active', 'group_id': None, 'slug': F['slug']}, r.get('venue'))
    ok('%s vp_join_context a new phone: no group' % label, r.get('group') is None, r.get('group'))
    row = run("select collect_first_name, collect_last_name, collect_postcode, collect_email, collect_mobile, collect_marketing_optin "
              "from public.vp_venue_settings where venue_id = :v::uuid", v=F['venue'])[0]
    names = ('collect_first_name', 'collect_last_name', 'collect_postcode', 'collect_email', 'collect_mobile', 'collect_marketing_optin')
    ok('%s vp_join_context a new phone: the collect settings, exactly as the venue\'s row holds them' % label,
       r.get('settings') == dict(zip(names, row)), [r.get('settings'), row])
    ok('%s vp_join_context a new phone: prior_id null' % label, r.get('prior_id') is None, r.get('prior_id'))
    run_ids = [g.get('id') for g in r.get('running') or []]
    ok('%s vp_join_context the running games, newest first, finished left out' % label,
       run_ids == [F['gnotg'], F['gm'], F['gt']], run_ids)
    r = jj(F['code'], F['dev_a'])
    ok('%s vp_join_context a RETURNING phone: prior_id is its row' % label, r.get('prior_id') == F['pa'], r.get('prior_id'))
    r = jj(F['code'], F['dev_dup'])
    ok('%s vp_join_context a phone kicked then back: prior_id is its live row, not the kicked one' % label,
       r.get('prior_id') == F['pdup2'], r.get('prior_id'))
    run('savepoint c')
    try:
        run("insert into public.vp_players (session_id, token_hash, device_id) values (:s::uuid, :h, :d)", s=F['sess'], h=th(), d=F['dev_a'])
        twice = True
    except Exception as e:
        twice = '23505' not in str(e)
    run('rollback to savepoint c')
    ok('%s one live seat per phone: a second row for the same device is refused (vp_players_session_device_uniq)' % label, not twice)
    r = jj(F['code'], F['dev_k'])
    ok('%s vp_join_context a KICKED phone coming back: prior_id null (it gets no old seat)' % label, r.get('prior_id') is None, r.get('prior_id'))
    r = jj(F['code2'], F['dev_a'])
    ok('%s vp_join_context the same phone at another venue: prior_id null' % label, r.get('prior_id') is None, r.get('prior_id'))
    r = jj(F['codeg'], '')
    ok('%s vp_join_context a grouped venue: the group and its status' % label,
       r.get('group') == {'status': 'active'} and (r.get('venue') or {}).get('group_id') == F['group'], [r.get('group'), r.get('venue')])
    run('savepoint c')
    run("update public.vp_sessions set status = 'lobby' where id = :s::uuid", s=F['sess'])
    run("update public.vp_games set status = 'finished' where session_id = :s::uuid", s=F['sess'])
    r = jj(F['code'], '')
    run('rollback to savepoint c')
    ok('%s vp_join_context a lobby with nothing running: the session, running = []' % label,
       (r.get('session') or {}).get('status') == 'lobby' and r.get('running') == [], r)


def screen_poll_cases(run, F, label):
    cols = 'id::text, name, slug, status, screen_seen_at, screen_version'
    poll = lambda slug, code, ver: run("select %s from public.vp_screen_poll(:s, :c, :v)" % cols, s=slug, c=code, v=ver)
    seen = lambda: run("select screen_seen_at, screen_version, now() from public.vp_venues where id = :v::uuid", v=F['venue'])[0]
    r = poll(F['slug'], '', 'dbfn-1')
    ok('%s vp_screen_poll by slug -> the venue' % label, len(r) == 1 and r[0][0] == F['venue'] and r[0][2] == F['slug'], r)
    s = seen()
    ok('%s vp_screen_poll writes the heartbeat (seen now, build dbfn-1)' % label, s[0] == s[2] and s[1] == 'dbfn-1', s)
    run("update public.vp_venues set screen_seen_at = now() - interval '10 seconds' where id = :v::uuid", v=F['venue'])
    poll(F['slug'], '', 'dbfn-1')
    s = seen()
    ok('%s vp_screen_poll inside 25 s, same build: NO write' % label, s[0] != s[2], s)
    poll(F['slug'], '', 'dbfn-2')
    s = seen()
    ok('%s vp_screen_poll a new build: written at once' % label, s[0] == s[2] and s[1] == 'dbfn-2', s)
    run("update public.vp_venues set screen_seen_at = now() - interval '30 seconds' where id = :v::uuid", v=F['venue'])
    poll(F['slug'], '', 'dbfn-2')
    s = seen()
    ok('%s vp_screen_poll after 25 s: written' % label, s[0] == s[2], s)
    poll(F['slug'], '', '')
    s = seen()
    ok('%s vp_screen_poll a screen that sends no build is recorded as pre-5-sep' % label, s[1] == 'pre-5-sep', s)
    vcode = run("select join_code from public.vp_venues where id = :v::uuid", v=F['venue'])[0][0]
    if ok('%s the venue has its own join code (vp_venues_fill_code)' % label, bool(vcode) and re.match('^[%s]{6}$' % CODE_ALPHA, vcode or ''), vcode):
        r = poll('', vcode, 'dbfn-3')
        ok('%s vp_screen_poll by code (an older screen with no slug) -> the venue' % label, len(r) == 1 and r[0][0] == F['venue'], r)
        r = poll('NOT A SLUG', vcode, 'dbfn-3')
        ok('%s vp_screen_poll a malformed slug falls through to the code' % label, len(r) == 1 and r[0][0] == F['venue'], r)
    r = poll('test-dbfn-nobody-' + secrets.token_hex(3), code6(), 'dbfn-3')
    ok('%s vp_screen_poll an unknown slug and code -> no row' % label, r == [], r)
    r = poll('', 'bad', 'dbfn-3')
    ok('%s vp_screen_poll a malformed code -> no row' % label, r == [], r)
    run("update public.vp_venues set status = 'suspended' where id = :v::uuid", v=F['venue'])
    r = poll(F['slug'], '', 'dbfn-3')
    ok('%s vp_screen_poll a suspended venue still exists to its own TV' % label, len(r) == 1 and r[0][3] == 'suspended', r)
    run("update public.vp_venues set status = 'active' where id = :v::uuid", v=F['venue'])


def fk_held(run, table, col, ref):
    r = run("select count(*) from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) "
            "where c.contype = 'f' and c.conrelid = ('public.' || :t)::regclass and c.confrelid = ('public.' || :r)::regclass "
            "and a.attname = :c", t=table, r=ref, c=col)[0][0]
    nn = run("select is_nullable from information_schema.columns where table_schema = 'public' and table_name = :t and column_name = :c",
             t=table, c=col)
    return r >= 1 and nn and nn[0][0] == 'NO'


def one_pass(conn, which):
    label = '[%s]' % which
    run = conn.run
    run('begin')
    try:
        run(GUARD)
        ok('%s the TEST guard passes inside the transaction' % label, True)
        sources = {}
        for fn in FUNCS:
            sources[fn] = repo_function_sql(fn)
        if which == 'repo':
            for fn, sql in sources.items():
                run(sql)
                ok('%s %s replaced by the repo copy (%s), inside the rolled-back transaction' % (label, fn, os.path.basename(FUNCS[fn])), True)
            db_src = sources['vp_player_answer']
        else:
            db_src = run("select pg_get_functiondef('public.vp_player_answer(text, uuid, integer, integer)'::regprocedure)")[0][0]
        F = build(run)
        ok('%s the fixture is in (3 venues, a group, 4 sessions, 5 games, 7 players)' % label, True)
        hit = player_answer_cases(run, F, label)
        declared = statuses_in(db_src)
        for st, (t, c, r) in FK_HELD.items():
            if st in declared:
                ok('%s %s cannot happen: %s.%s is NOT NULL and a foreign key to %s' % (label, st, t, c, r), fk_held(run, t, c, r))
                hit.add(st)
        missing = sorted(declared - hit)
        ok('%s every status vp_player_answer can return was played (%d)' % (label, len(declared)), not missing and declared, 'not played: %s' % missing)
        unknown = sorted(declared - worker_answer_statuses() - worker_direct_statuses())
        ok('%s every one of them is in the game Worker\'s ANSWER_STATUS (else a phone gets a 500)' % label, not unknown, 'missing: %s' % unknown)
        join_context_cases(run, F, label)
        screen_poll_cases(run, F, label)
    finally:
        try:
            run('rollback')
        except Exception:
            pass
    left = run("select count(*) from public.vp_venues where slug like 'test-dbfn%'")[0][0]
    ok('%s rolled back: nothing left behind' % label, left == 0, left)


def main(argv):
    passes = ['db', 'repo']
    if '--pass' in argv:
        passes = [argv[argv.index('--pass') + 1]]
    # the offline half first: the repo files must hold the functions at all
    for fn, path in FUNCS.items():
        try:
            sql = repo_function_sql(fn)
            ok('repo %s has %s' % (os.path.basename(path), fn), LIVE_REF not in sql and TEST_REF not in sql)
        except Exception as e:
            ok('repo %s has %s' % (os.path.basename(path), fn), False, e)
    rot = load_rot()
    try:
        conn, how = rot.connect(log=lambda *a: None)
        bad, facts = rot.alive_checks(conn)
    except Exception as e:
        print('NOT CHECKED: could not reach the TEST database through run-on-test.py\'s rails: %s' % str(e)[:300])
        return 2
    if bad:
        print('NOT CHECKED: REFUSED by run-on-test.py\'s alive checks: %s' % '; '.join(bad))
        return 2
    print('  on TEST (%s, Postgres %s, marker %s)' % (how, facts.get('server_version'), facts.get('marker_refs')))
    for p in passes:
        try:
            one_pass(conn, p)
        except Exception as e:
            ok('[%s] the pass ran to the end' % p, False, '%s: %s' % (type(e).__name__, str(e)[:400]))
            try:
                conn.run('rollback')
            except Exception:
                pass
    try:
        conn.close()
    except Exception:
        pass
    total = RESULTS['ok'] + RESULTS['fail']
    if RESULTS['fail']:
        print('\n%d of %d CHECKS FAILED' % (RESULTS['fail'], total))
        return 1
    print('\nALL %d CHECKS PASSED' % total)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
