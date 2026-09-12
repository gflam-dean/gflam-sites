#!/usr/bin/env python3
"""Seed a Supabase project with thousands of pretend venues, mid-game, for a load test.

THIS ONLY EVER WRITES TO THE NEW (Sydney) PROJECT NAMED IN ~/.gflam-migrate.env,
and only rows whose slug starts with "load-". It refuses the old project by ref.
Everything it creates comes out again with --remove (delete the venues, every child
table cascades; then their billing account rows and the load host), and the cut-over
re-copy replaces the data anyway.

What one seeded venue looks like:
  venueplay_founding a billing account per venue (the venue table insists on one)
  vp_venues          Load Venue 00001, slug load-00001, its own unique join code
  vp_venue_screen    three real slide URLs, so /screen answers a real-sized payload
  vp_venue_staff     the ONE load host is staff (role host) at every load venue, so a
                     single real login can press the buttons in every room. Supabase
                     Auth would refuse a thousand sign-ins from one laptop anyway.
and for the share that is mid-game (default 20%), split by --mix like a Tuesday:
  vp_sessions        running, on the venue's code
  vp_games           seq 1, running, in the room's format
  trivia             vp_trivia_games on the biggest question set, question 1 open
  musical_bingo      vp_music_games on the biggest playlist (the host plays songs)
  bingo90            nothing more: the host starts the server draw through the Worker
  raffle             vp_raffle_games, tickets 1..500, up to 50 draws
  vp_players         a crowd skewed to the low end (30 to 100), each with a token
                     the driver can recompute: 'load-token-<slug>-<n>'

The load host is a real Auth user (load-host-00001@load.invalid). Its password is
made here, never printed, and kept in ~/.gflam-migrate/load-host.pass (mode 600) for
the driver to sign in with.

Run:  python3 game-load-seed.py --venues 5000 --playing 0.20 --mix trivia=50,musical=35,bingo=12,raffle=3
      python3 game-load-seed.py --remove
"""
import os, sys, re, json, argparse, subprocess, secrets, urllib.request, urllib.error
from pathlib import Path

ENV_FILE = Path.home() / '.gflam-migrate.env'
WORK = Path.home() / '.gflam-migrate'
PASS_FILE = WORK / 'load-host.pass'
PG = '/Applications/Postgres.app/Contents/Versions/latest/bin'
OLD_REF_NEVER = 'ijkzgmdtwtgfkedqspxm'   # the live project. Refused by name, whatever the env file says.
HOST_EMAIL = 'load-host-00001@load.invalid'
FORMATS = {'trivia': 'trivia', 'musical': 'musical_bingo', 'bingo': 'bingo90', 'raffle': 'raffle'}

def env():
    e = {}
    for line in ENV_FILE.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    url = e.get('NEW_DB_URL') or sys.exit('NEW_DB_URL missing')
    m = re.match(r'postgres(?:ql)?://postgres\.([a-z]{20}):', url)
    ref = m.group(1) if m else sys.exit('NEW_DB_URL is not a pooler URI')
    if ref == OLD_REF_NEVER: sys.exit('REFUSED: NEW_DB_URL points at the live Singapore project')
    if OLD_REF_NEVER in e.get('NEW_SUPABASE_URL', ''): sys.exit('REFUSED: NEW_SUPABASE_URL is the live Singapore project')
    return url, ref, e

def psql(url, sql):
    r = subprocess.run([PG + '/psql', url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '\t', '-c', sql],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit('psql failed: ' + re.sub(r'postgres(?:ql)?://\S+', '<db-url>', r.stderr)[:600])
    return [l for l in r.stdout.splitlines() if l.strip()]

def auth_admin(e, method, path, body=None):
    """Supabase Auth admin API with the secret key. Returns (status, json)."""
    req = urllib.request.Request(e['NEW_SUPABASE_URL'] + '/auth/v1' + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'apikey': e['NEW_SERVICE_KEY'], 'Authorization': 'Bearer ' + e['NEW_SERVICE_KEY'],
                                          'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=30); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read())
        except Exception: return x.code, {}

def ensure_host(url, e):
    """One real Auth user for every load room. New random password each seed, kept in
    PASS_FILE (mode 600) and nowhere else. Nothing here prints it."""
    for k in ('NEW_SUPABASE_URL', 'NEW_SERVICE_KEY'):
        if not e.get(k): sys.exit(f'{k} missing from the env file (needed to make the load host login)')
    WORK.mkdir(mode=0o700, exist_ok=True)
    password = secrets.token_urlsafe(24)
    rows = psql(url, f"select id from auth.users where email = '{HOST_EMAIL}'")
    if rows:
        uid = rows[0]
        st, d = auth_admin(e, 'PUT', '/admin/users/' + uid, {'password': password, 'email_confirm': True})
        if st != 200: sys.exit(f'could not reset the load host password (HTTP {st}): {d.get("msg") or d.get("message") or d}')
    else:
        st, d = auth_admin(e, 'POST', '/admin/users', {'email': HOST_EMAIL, 'password': password, 'email_confirm': True,
                                                        'user_metadata': {'display_name': 'Load Host'}})
        if st not in (200, 201): sys.exit(f'could not create the load host (HTTP {st}): {d.get("msg") or d.get("message") or d}')
        uid = d['id']
    PASS_FILE.touch(mode=0o600); PASS_FILE.chmod(0o600); PASS_FILE.write_text(password)
    return uid

def parse_mix(s):
    mix = {}
    for part in s.split(','):
        k, v = part.split('='); k = k.strip()
        if k not in FORMATS: sys.exit(f'--mix: unknown format {k} (trivia, musical, bingo, raffle)')
        mix[k] = float(v)
    tot = sum(mix.values()) or sys.exit('--mix adds to zero')
    return {k: v / tot for k, v in mix.items()}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--venues', type=int, default=5000)
    ap.add_argument('--playing', type=float, default=0.20, help='share of venues mid-game')
    ap.add_argument('--mix', default='trivia=50,musical=35,bingo=12,raffle=3', help='how the mid-game rooms split by format')
    ap.add_argument('--players-range', default='30-100')
    ap.add_argument('--remove', action='store_true')
    a = ap.parse_args()
    url, ref, e = env()
    print(f'target project {ref}')
    have = int(psql(url, "select count(*) from vp_venues where slug like 'load-%'")[0])
    if a.remove:
        psql(url, f"delete from vp_venues where slug like 'load-%'; delete from venueplay_founding where contact_email like 'load-%@load.invalid'; delete from auth.users where email = '{HOST_EMAIL}'")
        if PASS_FILE.exists(): PASS_FILE.unlink()
        print(f'removed {have} load venues and everything under them, and the load host')
        return
    if have: sys.exit(f'{have} load venues already there; run --remove first')
    real = int(psql(url, "select count(*) from vp_venues")[0])
    lo, hi = (int(x) for x in a.players_range.split('-'))
    playing = int(a.venues * a.playing)
    mix = parse_mix(a.mix)
    # formats are dealt round-robin over each run of 1,000 rooms (by slug order), so any
    # prefix the driver picks with --venues or --rooms is the same mix as the whole
    per_k = 1000
    b_trivia = int(round(per_k * mix.get('trivia', 0))); b_music = b_trivia + int(round(per_k * mix.get('musical', 0)))
    b_bingo = b_music + int(round(per_k * mix.get('bingo', 0)))
    qset = psql(url, "select s.id, count(q.id), min(q.seq), max(q.seq) from vp_question_sets s join vp_questions q on q.set_id=s.id group by s.id order by 2 desc limit 1")[0].split('\t')
    print(f'question set {qset[0]}: {qset[1]} questions, seq {qset[2]}..{qset[3]}')
    plist = psql(url, "select p.id, count(s.id) from vp_playlists p join vp_playlist_songs s on s.playlist_id=p.id group by p.id order by 2 desc limit 1")[0].split('\t')
    print(f'playlist {plist[0]}: {plist[1]} songs')
    host_uid = ensure_host(url, e)
    print(f'load host {HOST_EMAIL} ready (password in {PASS_FILE}, not shown)')
    sql = f"""
    begin;
    select setseed(0.42);
    -- 1. venues. The code is a spread of the index over the 29-letter alphabet, so
    --    no two load venues share one; a clash with a real venue's code is skipped
    --    by the unique index (on conflict do nothing) and simply not seeded.
    with alpha as (select 'ACDEFGHJKMNPQRSTUVWXYZ2345679'::text a),
    n as (select generate_series(1, {a.venues}) i),
    c as (select i, ((i::bigint * 7919 + 12345) % 594823321) v from n),
    code as (select i, (select string_agg(substr(a, ((v / (29^k)::bigint) % 29)::int + 1, 1), '' order by k desc)
                        from alpha, generate_series(0,5) k) code from c)
    -- every venue must hang off a billing account (vp_venues_one_billing_parent),
    -- so each load venue gets its own, like a real signup
    , acct as (
      insert into venueplay_founding (venue_name, contact_email, postcode, plan, status)
      select 'Load Venue ' || lpad(i::text, 5, '0'), 'load-' || lpad(i::text, 5, '0') || '@load.invalid', '4000', 'monthly', 'card_on_file'
      from n returning id, venue_name)
    insert into vp_venues (founding_id, name, slug, join_code, join_code_set_at, status, postcode, au_state, state, timezone)
    select acct.id, 'Load Venue ' || lpad(i::text, 5, '0'), 'load-' || lpad(i::text, 5, '0'), code, now(), 'active', '4000', 'QLD', 'QLD', 'Australia/Brisbane'
    from code join acct on acct.venue_name = 'Load Venue ' || lpad(code.i::text, 5, '0') on conflict do nothing;
    -- 2. what the TV asks for: real slides copied from an existing venue
    insert into vp_venue_screen (venue_id, slug, slides, draws, raffle)
    select v.id, v.slug, (select slides from vp_venue_screen where jsonb_array_length(slides) >= 3 order by updated_at desc limit 1), '[]'::jsonb, null
    from vp_venues v where v.slug like 'load-%';
    insert into vp_venue_settings (venue_id) select id from vp_venues where slug like 'load-%';
    -- the one load host is staff everywhere, so its login works in every room
    insert into vp_venue_staff (venue_id, auth_user_id, role, display_name)
    select id, '{host_uid}', 'host', 'Load Host' from vp_venues where slug like 'load-%' on conflict do nothing;
    -- 3. the mid-game share: a running session on the venue's own code, format by position
    create temp table load_rooms as
      select v.id venue_id, v.join_code, v.slug, row_number() over (order by v.slug) rn
      from vp_venues v where v.slug like 'load-%' order by v.slug limit {playing};
    alter table load_rooms add column format text;
    -- position within its thousand, spread out: rooms 1..n_trivia-of-1000 sit at the
    -- fractional positions (rn * 1000 / n) mod 1000 would, so a prefix keeps the mix
    update load_rooms set format = case when pos <= {b_trivia} then 'trivia' when pos <= {b_music} then 'musical_bingo'
                                        when pos <= {b_bingo} then 'bingo90' else 'raffle' end
      from (select rn r, (((rn - 1) * 547) % {per_k}) + 1 pos from load_rooms) x where x.r = load_rooms.rn;
    insert into vp_sessions (venue_id, join_code, status, title, opened_at, started_at)
    select venue_id, join_code, 'running', 'Load ' || format, now(), now() from load_rooms;
    insert into vp_games (session_id, seq, format, status, started_at)
    select s.id, 1, r.format, 'running', now() from vp_sessions s join load_rooms r on r.venue_id = s.venue_id;
    insert into vp_trivia_games (game_id, question_set_id, current_seq, phase, question_ends_at, speed_bonus)
    select g.id, '{qset[0]}', 1, 'asking', now() + interval '1 day', true
    from vp_games g join vp_sessions s on s.id=g.session_id join load_rooms r on r.venue_id=s.venue_id where g.format='trivia';
    insert into vp_music_games (game_id, playlist_id, pattern, reveal_mode)
    select g.id, '{plist[0]}', 'one_line', 'manual'
    from vp_games g join vp_sessions s on s.id=g.session_id join load_rooms r on r.venue_id=s.venue_id where g.format='musical_bingo';
    insert into vp_raffle_games (game_id, mode, range_min, range_max, draws_count, allow_redraw)
    select g.id, 'number_range', 1, 500, 50, true
    from vp_games g join vp_sessions s on s.id=g.session_id join load_rooms r on r.venue_id=s.venue_id where g.format='raffle';
    -- 4. the crowd: triangular between {lo} and {hi}, mode near the low end, like a real pub night
    insert into vp_players (session_id, token_hash, display_name, is_test, joined_at)
    select s.id, encode(sha256(('load-token-' || v.slug || '-' || p)::bytea), 'hex'), 'Load ' || p, true, now()
    from vp_sessions s join vp_venues v on v.id=s.venue_id
    cross join lateral (
      select case when u < 0.28 then {lo} + sqrt(u * ({hi}-{lo}) * ({lo} + 0.28*({hi}-{lo}) - {lo}))
                  else {hi} - sqrt((1-u) * ({hi}-{lo}) * ({hi} - ({lo} + 0.28*({hi}-{lo})))) end n
      from (select (('x' || substr(md5(v.slug), 1, 8))::bit(32)::bigint / 4294967296.0) u) r) crowd
    cross join generate_series(1, greatest(1, round(crowd.n))::int) p
    where v.slug like 'load-%';
    commit;
    """
    psql(url, sql)
    rows = psql(url, """select v.slug, v.join_code, v.id, s.id, g.id, g.format, (select count(*) from vp_players p where p.session_id=s.id)
                        from vp_venues v left join vp_sessions s on s.venue_id=v.id left join vp_games g on g.session_id=s.id
                        where v.slug like 'load-%' order by v.slug""")
    venues, playing_rows = [], []
    for l in rows:
        slug, code, vid, sid, gid, fmt, np_ = l.split('\t')
        venues.append({'slug': slug, 'code': code})
        if sid: playing_rows.append({'slug': slug, 'code': code, 'venue_id': vid, 'session_id': sid, 'game_id': gid, 'format': fmt, 'players': int(np_)})
    songs = psql(url, f"select id from vp_playlist_songs where playlist_id = '{plist[0]}' order by seq")
    total_players = sum(p['players'] for p in playing_rows)
    WORK.mkdir(mode=0o700, exist_ok=True)
    (WORK / 'load-manifest.json').write_text(json.dumps({
        'ref': ref, 'question_set_id': qset[0], 'question_seq_max': int(qset[3]),
        'host': {'email': HOST_EMAIL, 'user_id': host_uid}, 'playlist_id': plist[0], 'songs': songs,
        'venues': venues, 'playing': playing_rows}, indent=0))
    by_fmt = {}
    for p in playing_rows: by_fmt[p['format']] = by_fmt.get(p['format'], 0) + 1
    print(f'seeded {len(venues)} load venues (asked {a.venues}; {a.venues-len(venues)} skipped on a code clash) beside {real} real ones')
    print(f'{len(playing_rows)} mid-game: ' + ', '.join(f'{n} {f}' for f, n in sorted(by_fmt.items(), key=lambda x: -x[1])))
    print(f'{total_players:,} players, smallest room {min(p["players"] for p in playing_rows)}, biggest {max(p["players"] for p in playing_rows)}')
    print(f'manifest -> {WORK}/load-manifest.json')

if __name__ == '__main__':
    main()
