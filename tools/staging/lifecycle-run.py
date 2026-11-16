#!/usr/bin/env python3
"""STAGING FULL CIRCLE, EVERY NIGHT (Dean, 16 Nov 2026, Jobs rows 440 + 441: "we're actually actively fixing everything
not as a reactive thing"). The test pubs live a whole venue life on the TEST project, and every step is checked:

  1 PLAYERS    at Stage Mini Bar, Stage Harbour Hotel and the newest "Stage New Pub", test phones join a game through the
               staging game Worker's own /join (the request a phone makes) and leave details with the venue's one
               offers tick set different ways; one player plays at two pubs on DIFFERENT accounts (ticked at one, not
               the other). Then: each owner's opt-in download lists exactly the people who ticked at their venue; a
               visiting host gets no player details (download refused, the tables read as that host return nothing);
               venueplay's own and the hosts' marketing lists hold none of the players (nobody ticked a box for them).
  2 MESSAGES   what each pub and player would be sent, read from the staging outbox; the timing and Dean's send window
               (Mon to Fri 9 to 12 and 2 to 5, venue local time; instant replies exempt); the house words (lowercase
               venueplay, no em dash, no .dev link, the word "free"); nothing doubled or missing. Says plainly what the
               outbox cannot show yet.
  3 CANCEL     (Mondays, or --cancel-now) the oldest "Stage New Pub ####" cancels through the real route the cancel
               page posts (/account/cancel-venue) with a different reason each week; the cancel screen's offer for that
               reason; the venue's state and HQ's record; Stripe TEST: no charge after the cancel; player data KEPT.
  4 90 DAYS    a cancelled Stage New Pub gets extra player details planted in every table that can hold them, its dates
               are moved back 91 days (TEST only), and the SAME nightly sweep live runs (sweepRetention, lifted word for
               word out of venueplay-game.js) runs on the test server against TEST. Then every table is searched for
               that pub's people: all gone, the opt-in download empty, and the same person at a pub still trading kept.
  5 ALERTS     any failure = one plain-English line for Dean's phone. DRY RUN unless --alerts on (main switches it on).
  6 PAGE       ~/venue-enrich/reports/staging-lifecycle-<date>/index.html (+ results.json).

SAFE BY CONSTRUCTION. Only the TEST project (rkfaftxgzpsmmrzudlqy), the staging Workers (api-staging, game-staging) and
the staging site; Stripe only with a sk_test_ key and only to READ. Every address is checked before it is called and
anything else (the live project ijkzgmdtwtgfkedqspxm, api./game.venueplay.com.au, a live Stripe key) stops the run.
The browser-free parts run on this Mac; the sweep runs in node on the test server vp-tests-1 (the TEST key goes over
ssh on stdin and is never written there). Never Dean's Mac Chrome, never /tmp/vp-heavy.lock.

    python3 tools/staging/lifecycle-run.py                   the nightly run (cancel only on Mondays), alerts DRY RUN
    python3 tools/staging/lifecycle-run.py --cancel-now      cancel this run whatever the day
    python3 tools/staging/lifecycle-run.py --steps players,messages
    python3 tools/staging/lifecycle-run.py --alerts on       send the alert for real (main, with Dean's yes)
    python3 tools/staging/lifecycle-run.py --check-guards    the guards only, nothing called
Idempotent: re-running makes new test players under a new run tag and reuses the pubs; nothing outside TEST is written.
"""
import datetime, html, importlib.util, json, os, random, re, subprocess, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
_s = importlib.util.spec_from_file_location('seedrv', os.path.join(HERE, 'seed-real-venues.py'))
S = importlib.util.module_from_spec(_s); _s.loader.exec_module(S)

TEST_REF, LIVE_REF = S.TEST_REF, S.LIVE_REF
API, GAME, SITE = S.API, S.GAME, S.SITE
SERVER = 'root@65.109.160.187'
SSH_KEY = os.path.expanduser('~/.ssh/vp_test_runner')
SSH = ['ssh', '-i', SSH_KEY, '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-o', 'BatchMode=yes', SERVER]
BRISBANE = datetime.timezone(datetime.timedelta(hours=10))
NOW = datetime.datetime.now(BRISBANE)
RUN = 'lc%s' % NOW.strftime('%d%m%H%M')          # run tag, in every planted name and email
REPORTS = os.path.expanduser('~/venue-enrich/reports')
CONSENT = 'vpc-3-14nov'
MINI, HARBOUR = S.A, S.B
CANCEL_REASONS = ['not_using', 'expensive', 'players', 'closing', 'switched', 'pausing', 'other']   # billing.html order
STATE_TZ = {'QLD': 'Australia/Brisbane', 'NSW': 'Australia/Sydney', 'VIC': 'Australia/Melbourne', 'ACT': 'Australia/Sydney',
            'TAS': 'Australia/Hobart', 'SA': 'Australia/Adelaide', 'WA': 'Australia/Perth', 'NT': 'Australia/Darwin'}

RESULTS = []


# ============================================================================================ results + guards
def say(*a):
    print('[%s]' % time.strftime('%H:%M:%S'), *a); sys.stdout.flush()


def rec(step, check, status, said, evidence=''):
    """status: ok | fault (the product is wrong) | gap (this tool or staging cannot see it yet) | info"""
    RESULTS.append({'step': step, 'check': check, 'status': status, 'said': said, 'evidence': str(evidence)[:1500]})
    say('%-5s %-9s %s: %s' % (status.upper(), step, check, said))


def allowed(url):
    u = urllib.parse.urlparse(url)
    host = u.hostname or ''
    if LIVE_REF in url:
        return False
    if host in ('api.venueplay.com.au', 'game.venueplay.com.au', 'venueplay.com.au', 'www.venueplay.com.au'):
        return False
    return host in ('%s.supabase.co' % TEST_REF, 'api-staging.venueplay.com.au', 'game-staging.venueplay.com.au',
                    'staging.venueplay.com.au', 'api.stripe.com')


def call(method, url, body=None, headers=None, raw=False):
    if not allowed(url):
        sys.exit('lifecycle-run: refusing an address that is not TEST/staging: ' + url)
    # Supabase refuses a secret key from anything that looks like a browser; Cloudflare in front of the staging hosts
    # refuses a bare client. So each gets the name it accepts.
    ua = 'venueplay-staging-lifecycle' if ('supabase.co' in url or 'stripe.com' in url) else 'Mozilla/5.0 (venueplay staging lifecycle)'
    h = {'Content-Type': 'application/json', 'User-Agent': ua}
    h.update(headers or {})
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, timeout=60)
        t = resp.read().decode('utf-8', 'replace')
        if raw:
            return resp.status, dict(resp.headers), t
        return json.loads(t) if t.strip() else None
    except urllib.error.HTTPError as x:
        t = x.read()[:2000].decode('utf-8', 'replace')
        if raw:
            return x.code, dict(x.headers), t
        try:
            j = json.loads(t)
        except Exception:
            j = {'body': t}
        if isinstance(j, dict):
            j['__error'] = x.code
            return j
        return {'__error': x.code, 'body': t}


def err(r):
    return isinstance(r, dict) and (r.get('__error') or (r.get('error') and not r.get('ok')))


def rest(method, path, body=None, prefer='return=representation', token=None):
    h = {'apikey': S.SKEY, 'Authorization': 'Bearer ' + S.SKEY, 'Prefer': prefer}
    if token:   # read AS a signed-in person (their row level security), never the service key
        h = {'apikey': S.AKEY, 'Authorization': 'Bearer ' + token}
    return call(method, S.URL + '/rest/v1/' + path, body, h)


def rows(path, **kw):
    r = rest('GET', path, **kw)
    if err(r):
        raise RuntimeError('read %s: %s' % (path.split('?')[0], json.dumps(r)[:300]))
    return r or []


def api(path, body, tok, venue=None):
    h = {'Authorization': 'Bearer ' + tok, 'Origin': SITE}
    if venue:
        h['X-VP-Venue'] = venue
    return call('POST', API + path, body, h)


def game(path, body, tok=None, venue=None, method='POST'):
    h = {'Origin': SITE}
    if tok:
        h['Authorization'] = 'Bearer ' + tok
    if venue:
        h['X-VP-Venue'] = venue
    return call(method, GAME + path, body, h)


def env_file():
    e = {}
    for line in open(os.path.expanduser('~/.gflam-migrate.env')):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            e[k.replace('export ', '').strip()] = v.strip().strip('"').strip("'")
    return e


def guards():
    S.URL, S.SKEY, S.AKEY = S.load_env()          # refuses anything but the TEST project
    if S.URL != 'https://%s.supabase.co' % TEST_REF:
        sys.exit('lifecycle-run: TEST_SUPABASE_URL is not the TEST project. Refusing.')
    sk = env_file().get('TEST_STRIPE_SECRET_KEY', '')
    stripe_ok = sk.startswith('sk_test_') or sk.startswith('rk_test_')
    for u in (API, GAME, SITE):
        if not allowed(u):
            sys.exit('lifecycle-run: not a staging address: ' + u)
    return sk if stripe_ok else ''


def stripe_get(path, sk):
    if not (sk.startswith('sk_test_') or sk.startswith('rk_test_')):
        return {'__error': 'no TEST key'}
    return call('GET', 'https://api.stripe.com/v1/' + path, None, {'Authorization': 'Bearer ' + sk})


# ============================================================================================ the pubs
def owner_session():
    return S.session_for(S.HOST_UID, 'test-host@example.invalid')


def host2_session():
    return S.session_for(S.HOST2_UID, 'test-manager@example.invalid')


def new_pubs():
    """Every Stage New Pub on TEST, oldest first."""
    return rows('vp_venues?name=like.Stage%20New%20Pub*&select=id,name,slug,status,suspended_reason,closed_at,'
                'player_data_purged_at,founding_id,au_state,timezone,created_at&order=created_at.asc')


def pub_owner(venue_id):
    st = rows('vp_venue_staff?venue_id=eq.%s&role=eq.owner&select=auth_user_id' % venue_id)
    if not st:
        return None, None
    uid = st[0]['auth_user_id']
    u = call('GET', S.URL + '/auth/v1/admin/users/' + uid, None, {'apikey': S.SKEY, 'Authorization': 'Bearer ' + S.SKEY})
    email = (u or {}).get('email') if isinstance(u, dict) else None
    return uid, email


def make_standin_pub():
    """No Stage New Pub has got past the card page, so the lifecycle makes one the way HQ's prospect setup leaves a
    free-month pub (an account, a venue, an owner login, a prospect row), on TEST only, named so it is plainly a
    stand-in. It is used ONLY when no real sign-up is active, and the report says so."""
    tag = NOW.strftime('%d%m')
    email = 'lc-owner-%s-%04d@example.invalid' % (RUN, random.randint(0, 9999))
    u = call('POST', S.URL + '/auth/v1/admin/users', {'email': email, 'email_confirm': True,
                                                      'user_metadata': {'staging': 'lifecycle stand-in'}},
             {'apikey': S.SKEY, 'Authorization': 'Bearer ' + S.SKEY})
    if err(u) or not u.get('id'):
        raise RuntimeError('could not make the stand-in owner login: %s' % json.dumps(u)[:300])
    uid = u['id']
    name = 'Stage New Pub %s (stand-in)' % tag
    slug = 'stage-new-pub-%s-%s' % (tag, RUN[-4:])
    f = rest('POST', 'venueplay_founding', {'venue_name': name, 'contact_name': 'Lee Lifecycle (staging test)',
                                            'contact_email': email, 'mobile': '0491579%03d' % random.randint(0, 999),
                                            'postcode': '3121', 'max_seats': 40, 'plan': 'monthly', 'status': 'active',
                                            'marketing_opt_in': False, 'is_group': False})
    if err(f):
        raise RuntimeError('founding insert: %s' % json.dumps(f)[:300])
    fid = f[0]['id']
    v = rest('POST', 'vp_venues', {'founding_id': fid, 'name': name, 'slug': slug, 'status': 'active', 'state': 'VIC',
                                   'au_state': 'VIC', 'postcode': '3121', 'suburb': 'Richmond', 'timezone': 'Australia/Melbourne',
                                   'max_players': 40, 'compliance_accepted_at': NOW.isoformat(), 'entity_type': 'for_profit'})
    if err(v):
        raise RuntimeError('venue insert: %s' % json.dumps(v)[:300])
    vid = v[0]['id']
    for path, body in (('vp_venue_staff', {'venue_id': vid, 'auth_user_id': uid, 'role': 'owner', 'display_name': 'Lee Lifecycle',
                                           'is_account_owner': True}),
                       ('vp_prospects', {'venue_id': vid, 'founding_id': fid, 'source': 'hq', 'created_label': 'staging lifecycle stand-in', 'contact_name': 'Lee Lifecycle',
                                         'email': email, 'auth_user_id': uid,
                                         'first_signin_at': (NOW - datetime.timedelta(days=10)).isoformat(),
                                         'free_month_ends_at': (NOW + datetime.timedelta(days=20)).isoformat()})):
        r = rest('POST', path, body)
        if err(r):
            # take the half-made pub away again, so the next run does not pick up a pub with no prospect row
            for t, q in (('vp_venue_staff', 'venue_id=eq.' + vid), ('vp_prospects', 'venue_id=eq.' + vid),
                         ('vp_venue_settings', 'venue_id=eq.' + vid), ('vp_venues', 'id=eq.' + vid), ('venueplay_founding', 'id=eq.' + fid)):
                rest('DELETE', t + '?' + q, prefer='return=minimal')
            raise RuntimeError('%s insert: %s' % (path, json.dumps(r)[:300]))
    have = rows('vp_venue_settings?venue_id=eq.%s&select=venue_id' % vid)
    if not have:
        r = rest('POST', 'vp_venue_settings', {'venue_id': vid})
        if err(r):
            raise RuntimeError('settings insert: %s' % json.dumps(r)[:300])
    return {'id': vid, 'name': name, 'slug': slug, 'au_state': 'VIC', 'timezone': 'Australia/Melbourne', 'standin': True,
            'owner_uid': uid, 'owner_email': email, 'founding_id': fid}


def collect_on(venue_id, last_name=False):
    """The venue collects email, mobile and the offers tick (what a pub that wants a list switches on). An
    @example.invalid account is not approved to collect by the database's own gate (migration 82: the contact email
    domain must read like a venue, or HQ ticks optin_release_approved), so the run gives the TEST account HQ's tick
    first, the same switch HQ uses for a real pub on a gmail address."""
    v = rows('vp_venues?id=eq.%s&select=founding_id' % venue_id)
    if v and v[0].get('founding_id'):
        rest('PATCH', 'venueplay_founding?id=eq.%s' % v[0]['founding_id'], {'optin_release_approved': True}, prefer='return=minimal')
    want = {'collect_first_name': True, 'collect_email': True, 'collect_mobile': True, 'collect_marketing_optin': True,
            'collect_last_name': bool(last_name)}
    r = rest('PATCH', 'vp_venue_settings?venue_id=eq.%s' % venue_id, want)
    back = rows('vp_venue_settings?venue_id=eq.%s&select=%s' % (venue_id, ','.join(want)))
    return bool(back) and all(back[0].get(k) == v for k, v in want.items()), (r if err(r) else back)


# ============================================================================================ 1 PLAYERS
def open_session(tok, venue_id):
    before = rows('vp_sessions?venue_id=eq.%s&status=in.(lobby,running,paused)&select=id,join_code' % venue_id)
    r = game('/session', {'venue_id': venue_id, 'format': 'trivia'}, tok, venue_id)
    if err(r):
        return None, False, r
    sid = r.get('session_id') or r.get('id') or (r.get('session') or {}).get('id')
    code = r.get('join_code') or r.get('code') or (r.get('session') or {}).get('join_code')
    if not (sid and code):
        s = rows('vp_sessions?venue_id=eq.%s&status=in.(lobby,running,paused)&select=id,join_code&order=created_at.desc&limit=1' % venue_id)
        if s:
            sid, code = s[0]['id'], s[0]['join_code']
    ours = not any(b['id'] == sid for b in before)
    return {'id': sid, 'code': code}, ours, r


def join(code, p):
    body = {'code': code, 'name': p['first'], 'pid': 'lcpid%s%06d' % (RUN, random.randint(0, 999999)),
            'first_name': p['first'], 'consent_version': CONSENT, 'marketing_optin': bool(p['tick'])}
    for k in ('last_name', 'email', 'mobile'):
        if p.get(k):
            body[k] = p[k]
    return game('/join', body)


def people(tag):
    """The test players. Emails @example.invalid, mobiles in the 0491 57x fiction range, the run tag in every name."""
    m = lambda n: '04915%05d' % (80000 + (int(NOW.strftime('%H%M')) * 7 + n) % 20000)
    e = lambda who: 'lc-%s-%s@example.invalid' % (who, tag)
    shared = {'first': 'Shay', 'last_name': 'Shared%s' % tag, 'email': e('shared'), 'mobile': m(9), 'key': 'shared'}
    return {
        'mini': [dict(first='Alex', last_name='Alpha%s' % tag, email=e('alex'), mobile=m(1), tick=True, key='alex'),
                 dict(first='Bree', last_name='Bravo%s' % tag, email=e('bree'), tick=False, key='bree'),
                 dict(first='Cody', last_name='Charlie%s' % tag, mobile=m(3), tick=True, key='cody'),
                 dict(first='Dana', last_name='Delta%s' % tag, tick=True, key='dana'),             # ticked, no address
                 dict(shared, tick=True)],
        'harbour': [dict(first='Erin', last_name='Echo%s' % tag, email=e('erin'), tick=True, key='erin'),
                    dict(first='Finn', last_name='Fox%s' % tag, email=e('finn'), mobile=m(6), tick=False, key='finn')],
        'newpub': [dict(first='Gus', last_name='Golf%s' % tag, email=e('gus'), mobile=m(7), tick=True, key='gus'),
                   dict(first='Hana', last_name='Hotel%s' % tag, email=e('hana'), tick=False, key='hana'),
                   dict(shared, tick=False)],
    }


def expected_optins(ps, last_name_collected):
    out = set()
    for p in ps:
        if p['tick'] and (p.get('email') or p.get('mobile')):
            out.add((p.get('email') or '').lower() or p.get('mobile'))
    return out


def parse_csv(text):
    import csv, io
    return list(csv.DictReader(io.StringIO(text or '')))


def step_players(ctx):
    st = 'players'
    tag = RUN
    P = people(tag)
    ctx['people'] = P
    pubs = [('mini', MINI['id'], MINI['name'], ctx['owner'], False), ('harbour', HARBOUR['id'], HARBOUR['name'], ctx['owner'], True)]
    np = ctx.get('newpub')
    if np and np.get('status', 'active') == 'active':
        pubs.append(('newpub', np['id'], np['name'], ctx['np_tok'], False))
    else:
        rec(st, 'a Stage New Pub to play at', 'gap', 'no active Stage New Pub, so the two-account player check is skipped')
    sessions = {}
    for key, vid, name, tok, lastn in pubs:
        ok, back = collect_on(vid, last_name=lastn)
        rec(st, '%s collects email, mobile and the offers tick' % name, 'ok' if ok else 'fault',
            'switched on and read back' if ok else 'the settings would not switch on', back)
        s, ours, raw = open_session(tok, vid)
        if not s:
            rec(st, '%s opens a game for phones' % name, 'fault', 'the owner could not open a game', raw)
            continue
        sessions[key] = dict(s, ours=ours, venue_id=vid, name=name)
        rec(st, '%s opens a game for phones' % name, 'ok', 'join code %s%s' % (s['code'], '' if ours else ' (a game already open there was used, and is left open)'))
    ctx['sessions'] = sessions
    joined = {}
    for key, s in sessions.items():
        for p in P[key]:
            r = join(s['code'], p)
            good = isinstance(r, dict) and r.get('token') and not err(r)
            joined.setdefault(key, []).append(p['key'])
            if not good:
                rec(st, '%s joins %s' % (p['first'], s['name']), 'fault', 'the join was refused', r)
            time.sleep(0.4)
    # what each venue holds, read straight from the table
    for key, s in sessions.items():
        held = rows('vp_players?session_id=eq.%s&select=first_name,last_name,email,mobile,marketing_optin,consent_version'
                    '&or=(last_name.like.*%s*,first_name.in.(Dana,Shay,Alex,Bree,Cody,Erin,Finn,Gus,Hana))' % (s['id'], tag))
        mine = [h for h in held if (h.get('email') or '').find(tag) >= 0 or (h.get('last_name') or '').find(tag) >= 0
                or (h.get('mobile') or '') in [p.get('mobile') for p in P[key]]]
        want_last = key == 'harbour'
        bad = []
        for p in P[key]:
            h = [x for x in held if (p.get('email') and x.get('email') == p['email']) or (p.get('mobile') and x.get('mobile') == p['mobile'])
                 or (not p.get('email') and not p.get('mobile') and x.get('first_name') == p['first'])]
            if not h:
                bad.append('%s: no row with their details' % p['first']); continue
            h = h[-1]
            if bool(h.get('last_name')) != want_last:
                bad.append('%s: last name %s but the venue %s it' % (p['first'], 'kept' if h.get('last_name') else 'not kept',
                                                                       'collects' if want_last else 'does not collect'))
            tick_ok = bool(h.get('marketing_optin')) == bool(p['tick'] and (p.get('email') or p.get('mobile')))
            if not tick_ok:
                bad.append('%s: offers tick recorded %s, they %s' % (p['first'], h.get('marketing_optin'), 'ticked' if p['tick'] else 'did not tick'))
        rec(st, '%s keeps what each phone left, and only that' % s['name'], 'fault' if bad else 'ok',
            '; '.join(bad) if bad else '%d players, details and ticks as given%s' % (len(P[key]), ' (Dana ticked with no address: not kept as an opt-in)' if key == 'mini' else ''),
            json.dumps(mine)[:800])
    # each owner's download
    for key, s in sessions.items():
        tok = ctx['np_tok'] if key == 'newpub' else ctx['owner']
        r = api('/account/optin-export', {}, tok, s['venue_id'])
        if err(r) or not isinstance(r, dict) or 'csv' not in r:
            rec(st, '%s owner downloads the opt-in list' % s['name'], 'fault', 'the download was refused', r); continue
        lines = parse_csv(r['csv'])
        got = set()
        for ln in lines:
            if ln.get('Venue') != s['name']:
                continue
            em = (ln.get('Email') or '').lower()
            if tag in em or (ln.get('Mobile') or '') in [p.get('mobile') for k in P for p in P[k] if p.get('mobile')]:
                got.add(em or ln.get('Mobile'))
        want = expected_optins(P[key], key == 'harbour')
        leak = [ln for ln in lines if tag in (ln.get('Email') or '').lower() and ln.get('Venue') != s['name']
                and ln.get('Venue') not in [x['name'] for k2, x in sessions.items() if (ctx['np_tok'] if k2 == 'newpub' else ctx['owner']) == tok]]
        if got == want and not leak:
            rec(st, '%s owner downloads exactly who ticked there' % s['name'], 'ok', '%d of %d players (%s)' % (len(got), len(P[key]), ', '.join(sorted(got))))
        else:
            rec(st, '%s owner downloads exactly who ticked there' % s['name'], 'fault',
                'expected %s, the file has %s%s' % (sorted(want), sorted(got), ('; and other accounts\' people: %s' % leak) if leak else ''),
                r['csv'][:800])
    # the shared player: ticked at Stage Mini Bar, not at the new pub (another account)
    if 'newpub' in sessions:
        r = api('/account/optin-export', {}, ctx['np_tok'], sessions['newpub']['venue_id'])
        csvt = (r or {}).get('csv', '') if isinstance(r, dict) else ''
        sh = P['mini'][-1]['email']
        rec(st, 'one player at two pubs: the pub where they did not tick never gets them', 'fault' if sh in csvt else 'ok',
            ('%s is in %s\'s file' % (sh, sessions['newpub']['name'])) if sh in csvt else
            '%s ticked at Stage Mini Bar only; not in the new pub\'s file' % sh)
    # a visiting host: 0491 570 002 hosts at Stage Mini Bar only
    h2 = ctx['host2']
    for key in ('mini', 'harbour'):
        if key not in sessions:
            continue
        s = sessions[key]
        r = api('/account/optin-export', {}, h2, s['venue_id'])
        refused = err(r) or not (isinstance(r, dict) and r.get('csv'))
        names_in = isinstance(r, dict) and tag in (r.get('csv') or '')
        rec(st, 'a visiting host cannot download %s\'s players' % s['name'], 'ok' if (refused and not names_in) else 'fault',
            ('refused: %s' % (r.get('error') if isinstance(r, dict) else r))[:200] if refused else 'the host got the file', r if not refused else '')
        pl = rest('GET', 'vp_players?session_id=eq.%s&select=email,mobile,last_name' % s['id'], token=h2)
        vw = rest('GET', 'v_vp_player_optins?venue_id=eq.%s&select=email,mobile' % s['venue_id'], token=h2)
        cp = rest('GET', 'vp_captures?venue_id=eq.%s&select=email,mobile,last_name' % s['venue_id'], token=h2)
        leaked, refused = [], []
        for nm, rr in (('vp_players', pl), ('v_vp_player_optins', vw), ('vp_captures', cp)):
            if isinstance(rr, list):
                leaked += ['%s: %s' % (nm, x) for x in rr if any(x.get(c) for c in ('email', 'mobile', 'last_name'))]
            elif isinstance(rr, dict) and rr.get('code') == '42501':
                refused.append(nm)
        # signed-in people cannot read these at all (permission denied, owner included): the Worker's export is the only door
        rec(st, 'a visiting host reads no player details at %s (database, as that host)' % s['name'],
            'fault' if leaked else 'ok', ('%d rows with details: %s' % (len(leaked), leaked[:3])) if leaked else
            'refused by the database: %s; nothing with an email, mobile or last name from the rest' % (', '.join(refused) or 'none'),
            json.dumps({'vp_players': pl, 'v_vp_player_optins': vw, 'vp_captures': cp})[:600])
        if key == 'harbour':
            ros = [x['id'] for x in rows('vp_member_rosters?venue_id=eq.%s&select=id' % s['venue_id'])]
            mem = rest('GET', 'vp_members?roster_id=in.(%s)&select=first_name,last_name&limit=5' % ','.join(ros), token=h2) if ros else []
            n = len(mem) if isinstance(mem, list) else 0
            rec(st, 'a host from another pub reads no members list at Stage Harbour Hotel', 'fault' if n else 'ok',
                ('%d member names readable as that host' % n) if n else
                'vp_members as that host: 0 rows of Harbour\'s %d list(s)' % len(ros), mem if n else '')
    # marketing lists for the other two senders: venueplay's own (vp_subscribers) and hosts' (vp_host_updates_optin)
    allmail = sorted({p['email'] for k in P for p in P[k] if p.get('email')})
    q = ','.join(allmail)
    subs = rows('vp_subscribers?email=in.(%s)&select=email,status' % q)
    hosts = rows('vp_host_updates_optin?email=in.(%s)&select=email,opted_in' % q)
    mk = rows('vp_marketing_optins?email=in.(%s)&select=email,venue_id' % q)
    rec(st, 'venueplay\'s own list holds no player (none ticked a venueplay box)', 'fault' if subs else 'ok',
        ('%d on it: %s' % (len(subs), subs)) if subs else '0 of %d test emails in vp_subscribers' % len(allmail))
    rec(st, 'the hosts\' updates list holds no player', 'fault' if hosts else 'ok',
        ('%d on it: %s' % (len(hosts), hosts)) if hosts else '0 of %d test emails in vp_host_updates_optin' % len(allmail))
    rec(st, 'the venues\' added-by-hand marketing list holds no player who only played', 'fault' if mk else 'ok',
        ('%d: %s' % (len(mk), mk)) if mk else '0 in vp_marketing_optins')
    rec(st, 'per-sender boxes for players', 'gap',
        'a player sees ONE box, "Send me offers from {venue}" (venueplay/app/vp-consent.js). There is no venueplay box and '
        'no host box for players, so "ticked for that sender" can only be tested for the venue; the venueplay and host '
        'lists are checked to hold no player at all.')
    rec(st, 'service messages to players', 'gap',
        'the product sends players no service email or text that staging can trigger without a browser (the purchase '
        'raffle entry is the only one, and it needs the host console). Not checked this run.')
    for key, s in sessions.items():
        if s.get('ours'):
            tok = ctx['np_tok'] if key == 'newpub' else ctx['owner']
            game('/session/close', {'session_id': s['id']}, tok, s['venue_id'])


# ============================================================================================ 2 MESSAGES
CF = 'https://api.cloudflare.com/client/v4/accounts/%s'


def cf(path):
    e = env_file()
    if not e.get('CF_API_TOKEN'):
        return {'__error': 'no token'}
    r = urllib.request.Request((CF % e['CF_ACCOUNT_ID']) + path, headers={'Authorization': 'Bearer ' + e['CF_API_TOKEN']})
    try:
        return json.load(urllib.request.urlopen(r, timeout=30))
    except urllib.error.HTTPError as x:
        return {'__error': x.code}


HOUSE = [('em dash', re.compile('—|&mdash;|\\\\u2014')),
         ('capital VenuePlay', re.compile(r'\b(?:VenuePlay|Venueplay|VENUEPLAY)\b')),
         ('.dev link', re.compile(r'workers\.dev|pages\.dev|https?://[a-z0-9.-]+\.dev\b')),
         ('the word "free"', re.compile(r'\bfree\b', re.I))]


def message_strings(src):
    """The words of every email and text the Worker builds: string literals inside functions whose names say they send
    (email, sms, text, mail, welcome, remind, nudge, confirm, goodbye, alert, notify), skipping comments."""
    out = []
    lines = src.split('\n')
    fn, depth = None, 0
    fn_re = re.compile(r'^(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(')
    send_re = re.compile(r'(email|sms|text|mail|welcome|remind|nudge|confirm|goodbye|notify|letter|subject|body)', re.I)
    lit = re.compile(r"'((?:[^'\\]|\\.){12,})'|\"((?:[^\"\\]|\\.){12,})\"|`((?:[^`\\]|\\.){12,})`")
    in_block = False
    for i, ln in enumerate(lines, 1):
        m = fn_re.match(ln)
        if m:
            fn = m.group(1) if send_re.search(m.group(1)) else None
        s = ln.strip()
        if in_block:
            if '*/' in s:
                in_block = False
            continue
        if s.startswith('/*'):
            in_block = '*/' not in s
            continue
        if s.startswith('//') or s.startswith('*') or not fn:
            continue
        code = ln.split(' // ')[0]
        for mm in lit.finditer(code):
            t = next(g for g in mm.groups() if g)
            if ' ' in t and re.search('[a-z]{3,} [a-z]{3,}', t):
                out.append((i, fn, t))
    return out


def in_window(dt_local):
    """Dean's send window: Mon to Fri, 9 to 12 and 2 to 5, the venue's local time."""
    return dt_local.weekday() < 5 and (9 <= dt_local.hour < 12 or 14 <= dt_local.hour < 17)


def step_messages(ctx):
    st = 'messages'
    # the outbox itself
    gsrc = open(os.path.join(REPO, 'venueplay-backend/worker/vp-outbox-guard.js')).read()
    keeps = 'globalThis.__vpOutbox' in gsrc
    slice3 = "slice(-3)" in gsrc
    rec(st, 'read the staging outbox', 'gap',
        'the outbox guard keeps each blocked send in the Worker\'s memory only (globalThis.__vpOutbox, last 50, per '
        'isolate, gone on the next deploy or idle), with the kind, host and the LAST 3 DIGITS of each address, and no '
        'subject or words. No route reads it. So no email or text can be read back yet.' if keeps and slice3 else
        'outbox guard source changed: re-check how it keeps messages', 'vp-outbox-guard.js vpgRecord()')
    obs = []
    for w in ('venueplay-api-staging', 'venueplay-game-staging'):
        a = cf('/workers/scripts/%s/script-settings' % w)
        b = cf('/workers/scripts/%s/schedules' % w)
        o = (a.get('result') or {}).get('observability') if isinstance(a, dict) else None
        sch = ((b.get('result') or {}).get('schedules') if isinstance(b, dict) else None)
        obs.append((w, o, sch))
    rec(st, 'the Workers keep their logs (the guard\'s log line is the only other record)',
        'gap' if all(not o for _, o, _ in obs) else 'ok',
        '; '.join('%s observability %s' % (w, 'ON' if o else 'off') for w, o, _ in obs), obs)
    no_cron = [w for w, _, sch in obs if sch is not None and not sch]
    if no_cron:
        rec(st, 'the staging Workers run their timed jobs', 'fault',
            'no Cron Trigger on %s, so on staging the day-3 nudge, the card reminders, the monthly email on the 1st, the '
            'members list reminder, the last-day warning and the 90-day sweep NEVER run: nothing time-based can be seen '
            'on staging. Live\'s game Worker runs "0 17 * * *" (venueplay-game.js note); the api Worker has scheduled() '
            'jobs too.' % ' and '.join(no_cron), obs)
    # what the database remembers sending (the welcome is the one send with its own row)
    wl = rows('vp_prospect_welcomes?select=venue_id,email,send_at,status,created_at&order=created_at.desc&limit=200')
    late = []
    for w in wl:
        if w.get('status') in ('sent', 'delivered') and w.get('send_at') and w.get('created_at'):
            a = datetime.datetime.fromisoformat(w['created_at'].replace('Z', '+00:00'))
            b = datetime.datetime.fromisoformat(w['send_at'].replace('Z', '+00:00'))
            if (b - a).total_seconds() > 900:
                late.append(w)
    rec(st, 'welcome emails on TEST went at once (an instant reply, so outside the window is fine)',
        'info' if not wl else ('fault' if late else 'ok'),
        ('no welcome rows on TEST to check' if not wl else ('%d of %d welcomes waited more than 15 minutes' % (len(late), len(wl)) if late
                                                            else '%d welcome rows, each sent within 15 minutes' % len(wl))), late[:5])
    # the cancel email: which cancellations tell the venue
    src = open(os.path.join(REPO, 'venueplay-backend/worker/venueplay-api-FULL.js')).read()
    m = re.search(r'async function vpbTrialCancelVenue\(.*?\n}\n', src, re.S)
    trial_mails_venue = bool(m and ('vpaFireCancelConfirm' in m.group(0) or 'vpaSendEmail' in m.group(0)))
    rec(st, 'a free-month pub that cancels is sent a cancel email', 'ok' if trial_mails_venue else 'fault',
        'yes' if trial_mails_venue else
        'no: vpbTrialCancelVenue (Your account) and vpaProspectCancel (the cancel link) only tell HQ (vpaTrialCancelAlert); '
        'only a PAID cancel sends the venue vpaFireCancelConfirm. Read in the code: the outbox cannot show it yet.',
        'venueplay-api-FULL.js vpbTrialCancelVenue')
    # house words, every message string in both Workers
    found = {k: [] for k, _ in HOUSE}
    total = 0
    for f in ('venueplay-api-FULL.js', 'venueplay-game.js'):
        s = open(os.path.join(REPO, 'venueplay-backend/worker', f)).read()
        for ln, fn, t in message_strings(s):
            total += 1
            for k, rx in HOUSE:
                if rx.search(t):
                    found[k].append('%s:%d %s: %s' % (f.replace('venueplay-', ''), ln, fn, t[:140]))
    for k, _ in HOUSE:
        hits = found[k]
        if k == 'the word "free"':
            rec(st, 'house words: %s in message text' % k, 'info' if hits else 'ok',
                ('%d strings use it (most are "free month", the product\'s own offer; main to say which are wrong)' % len(hits)) if hits
                else 'none in %d message strings' % total, '\n'.join(hits[:12]))
        else:
            rec(st, 'house words: no %s in message text' % k, 'fault' if hits else 'ok',
                ('%d strings: %s' % (len(hits), hits[0])) if hits else 'none in %d message strings' % total, '\n'.join(hits[:12]))
    # the email files the site sends from
    edir = os.path.join(REPO, 'venueplay/emails')
    bad = []
    for fn in sorted(os.listdir(edir)):
        if fn.endswith('.html'):
            t = re.sub(r'<style.*?</style>|<!--.*?-->', '', open(os.path.join(edir, fn)).read(), flags=re.S)
            text = re.sub(r'<[^>]+>', ' ', t)
            for k, rx in HOUSE[:3]:
                if rx.search(text) or (k == '.dev link' and rx.search(t)):
                    bad.append('%s: %s' % (fn, k))
    rec(st, 'house words in the email templates (venueplay/emails/)', 'fault' if bad else 'ok',
        '; '.join(bad) if bad else 'none in %d files' % len([f for f in os.listdir(edir) if f.endswith('.html')]))
    rec(st, 'timing of the day-3 nudge, the monthly email and duplicates', 'gap',
        'cannot be checked from the outbox (above) and the timed jobs do not run on staging (above). The send window code '
        '(vpaSendAllowedAt) is unit tested in the repo; this run does not re-prove it.')


# ============================================================================================ 3 CANCEL
def step_cancel(ctx, force):
    st = 'cancel'
    if NOW.weekday() != 0 and not force:
        rec(st, 'weekly cancel', 'info', 'not Monday: no cancel this run (use --cancel-now)'); return
    pubs = [p for p in new_pubs() if p['status'] == 'active' and not p.get('closed_at')]
    real = [p for p in pubs if '(stand-in)' not in p['name']]
    target = (real or pubs or [None])[0]
    if not target:
        rec(st, 'the oldest Stage New Pub cancels', 'gap', 'no active Stage New Pub on TEST'); return
    if not real:
        rec(st, 'a real sign-up to cancel', 'gap',
            'no "Stage New Pub" sign-up has ever got past the card page (every one is still pending in venueplay_founding), '
            'so the stand-in pub is cancelled instead: %s' % target['name'])
    uid, email = pub_owner(target['id'])
    if not uid:
        rec(st, 'the oldest Stage New Pub cancels', 'fault', '%s has no owner login' % target['name']); return
    tok = S.session_for(uid, email)['access_token']
    week = int(NOW.strftime('%V'))
    reason = CANCEL_REASONS[week % len(CANCEL_REASONS)]
    ctx['cancel_reason'] = reason
    sc = api('/account/cancel-screen', {'venue_id': target['id']}, tok, target['id'])
    kp = isinstance(sc, dict) and sc.get('keep_plan')
    if reason == 'closing':
        offer = 'Hand the account to the new owner (the page shows it for this reason without asking the Worker)'
        rec(st, 'the offer for "%s"' % reason, 'ok', offer)
    else:
        rec(st, 'the offer for "%s"' % reason, 'ok' if kp else 'fault',
            ('"%s" (%s)' % (kp.get('title'), kp.get('sub'))) if kp else
            'none: /account/cancel-screen returns no keep_plan, so billing.html shows no offer for this reason (Dean, 10 Nov: '
            '"Keep the basics" on every reason except closing)', json.dumps(sc)[:600])
    before = rows('vp_players?select=id,email,session_id,vp_sessions!inner(venue_id)&vp_sessions.venue_id=eq.%s&email=not.is.null' % target['id'])
    r = api('/account/cancel-venue', {'venue_id': target['id'], 'reason': reason,
                                      'reason_detail': 'staging lifecycle test %s' % RUN}, tok, target['id'])
    if err(r):
        rec(st, '%s cancels through /account/cancel-venue' % target['name'], 'fault', 'refused', r); return
    rec(st, '%s cancels through /account/cancel-venue (reason "%s")' % (target['name'], reason), 'ok',
        (r.get('text') or json.dumps(r))[:240])
    ctx['cancelled'] = target['id']
    v = rows('vp_venues?id=eq.%s&select=status,suspended_reason,closed_at,cancel_at_period_end' % target['id'])[0]
    pr = rows('vp_prospects?venue_id=eq.%s&select=cancelled_at' % target['id'])
    au = rows("vp_admin_audit?target=eq.venue:%s&action=in.(prospect_cancelled,venue_cancel_scheduled)&select=action,detail,created_at&order=created_at.desc&limit=1" % target['id'])
    good = (au and (au[0]['detail'] or {}).get('reason') == reason)
    rec(st, 'HQ\'s record has the reason', 'ok' if good else 'fault',
        ('%s, reason %s' % (au[0]['action'], au[0]['detail'].get('reason'))) if au else 'no audit row', au)
    rec(st, 'the venue after the cancel', 'info',
        'status %s, reason %s, closed_at %s, prospect cancelled_at %s (a free month keeps playing to its end date)' %
        (v['status'], v['suspended_reason'], v['closed_at'], pr and pr[0]['cancelled_at']))
    after = rows('vp_players?select=id,email,session_id,vp_sessions!inner(venue_id)&vp_sessions.venue_id=eq.%s&email=not.is.null' % target['id'])
    rec(st, 'player details kept after the cancel (the 90 days have not passed)', 'ok' if len(after) == len(before) else 'fault',
        '%d players with an email before, %d after' % (len(before), len(after)))
    sk = ctx.get('stripe_key')
    if not sk:
        rec(st, 'Stripe TEST: last bill and no charge after the cancel', 'gap', 'no TEST Stripe key on this Mac'); return
    f = rows('venueplay_founding?id=eq.%s&select=stripe_customer_id,stripe_subscription_id,contact_email' % target['founding_id'])
    cust = f and f[0].get('stripe_customer_id')
    if not cust:
        allc = stripe_get('customers/search?query=%s' % urllib.parse.quote("email~'example.invalid'"), sk)
        n = len((allc or {}).get('data') or []) if isinstance(allc, dict) else 0
        rec(st, 'Stripe TEST: last bill and no charge after the cancel', 'gap',
            '%s has no Stripe customer (a free month, no card). Stripe TEST holds %d @example.invalid customers in all%s.'
            % (target['name'], n, '' if n else ': no staging pub has ever reached a card'), allc if n else '')
        return
    ch = stripe_get('charges?customer=%s&limit=20' % cust, sk)
    cut = int(time.time()) - 60
    later = [c for c in (ch.get('data') or []) if c.get('created', 0) > cut and c.get('paid')]
    rec(st, 'Stripe TEST: no charge after the cancel', 'fault' if later else 'ok',
        ('%d charge(s) after: %s' % (len(later), [c['id'] for c in later])) if later else 'no charge after the cancel')


# ============================================================================================ 4 90 DAYS
LIFT = ['sbHeaders', 'sbGet', 'sbCount', 'sbGetAll', 'sbPatch', 'enc', 'httpError', 'dbError', 'errRef', 'randomTokenHex', 'sweepRetention']


def lift(src, name):
    i = src.find('async function ' + name + '(')
    if i < 0:
        i = src.find('function ' + name + '(')
    if i < 0:
        raise RuntimeError('cannot find %s in venueplay-game.js' % name)
    d, k = 0, src.find('{', i)
    while True:
        if src[k] == '{':
            d += 1
        elif src[k] == '}':
            d -= 1
        k += 1
        if d == 0:
            break
    return src[i:k]


def sweep_harness():
    src = open(os.path.join(REPO, 'venueplay-backend/worker/venueplay-game.js')).read()
    days = re.search(r'^const RETENTION_DAYS = (\d+);', src, re.M)
    if not days:
        raise RuntimeError('RETENTION_DAYS not found')
    body = '\n'.join(lift(src, n) for n in LIFT)
    js = ('"use strict";\n/* lifecycle-run.py: live\'s nightly 90-day sweep (venueplay-game.js sweepRetention, lifted word for word) run\n'
          '   against the TEST project. Reads {SUPABASE_URL, SUPABASE_SERVICE_KEY} as JSON on stdin; refuses anything not TEST. */\n'
          'const TEST = "https://%s.supabase.co";\n'
          'const _real = globalThis.fetch;\n'
          'globalThis.fetch = function (u, o) { if (String(u).indexOf(TEST + "/") !== 0) throw new Error("harness: refusing " + u); return _real(u, o); };\n'
          'const RETENTION_DAYS = %s;\n%s\n'
          'let raw = ""; process.stdin.on("data", (c) => raw += c); process.stdin.on("end", async () => {\n'
          '  const env = JSON.parse(raw);\n'
          '  if (env.SUPABASE_URL !== TEST || String(env.SUPABASE_SERVICE_KEY).indexOf("%s") >= 0) { console.log(JSON.stringify({ error: "not TEST" })); process.exit(2); }\n'
          '  const r = await sweepRetention(env); console.log(JSON.stringify(r));\n'
          '});\n') % (TEST_REF, days.group(1), body, LIVE_REF)
    return js


def run_sweep_on_server():
    js = sweep_harness()
    remote = '/home/vp/stg-lifecycle/%s' % RUN
    p = subprocess.run(SSH + ['mkdir -p %s && cat > %s/sweep.js && chown -R vp:vp /home/vp/stg-lifecycle' % (remote, remote)],
                       input=js, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError('could not copy the sweep to the test server: %s' % p.stderr[:200])
    envj = json.dumps({'SUPABASE_URL': S.URL, 'SUPABASE_SERVICE_KEY': S.SKEY})
    p = subprocess.run(SSH + ['runuser -u vp -- node %s/sweep.js' % remote], input=envj, text=True, capture_output=True, timeout=300)
    out = (p.stdout or '').strip().split('\n')[-1]
    try:
        return json.loads(out), js
    except Exception:
        return {'error': 'no answer from the sweep: %s %s' % (out[:200], (p.stderr or '')[:300])}, js


def plant(vid, tag, step):
    """Player details in every other table that can hold a person for this venue, each carrying the run tag."""
    planted, failed = [], []

    def put(table, body):
        r = rest('POST', table, body)
        if err(r):
            failed.append('%s: %s' % (table, (r.get('message') or r.get('body') or r.get('error') or '')[:160]))
            return None
        planted.append(table)
        return r[0] if isinstance(r, list) and r else None
    ros = put('vp_member_rosters', {'venue_id': vid, 'name': 'Members %s' % tag})
    mem = None
    if ros:
        mem = put('vp_members', {'roster_id': ros['id'], 'member_number': 900000 + random.randint(0, 99999), 'first_name': 'Mia', 'last_name': 'Member%s' % tag})
    dr = put('vp_member_draws', {'venue_id': vid, 'roster_id': ros and ros['id'], 'name': 'Draw %s' % tag})
    if dr:
        put('vp_member_draw_results', {'draw_id': dr['id'], 'member_id': mem and mem['id'], 'member_number': mem and mem['member_number'],
                                       'winner_name': 'Mia Member%s' % tag, 'outcome': 'claimed', 'amount_cents': 1000})
    pr = put('vp_purchase_raffles', {'venue_id': vid, 'name': 'Raffle %s' % tag, 'status': 'drawn',
                                     'starts_at': (NOW - datetime.timedelta(days=5)).isoformat(),
                                     'closes_at': (NOW - datetime.timedelta(days=1)).isoformat(),
                                     'draw_at': (NOW - datetime.timedelta(days=1)).isoformat(), 'prizes': [{'text': 'Meat tray'}]})
    if pr:
        ent = put('vp_purchase_raffle_entrants', {'raffle_id': pr['id'], 'venue_id': vid, 'phone': '+61491578%03d' % random.randint(0, 999),
                                                  'first_name': 'Rae', 'last_name': 'Raffle%s' % tag, 'email': 'lc-rae-%s@example.invalid' % tag,
                                                  'marketing_opt_in': True, 'age_confirmed_at': NOW.isoformat(),
                                                  'opted_in_at': NOW.isoformat()})
        if ent:
            put('vp_purchase_raffle_draws', {'raffle_id': pr['id'], 'venue_id': vid, 'prize_index': 0, 'prize_text': 'Meat tray',
                                             'entrant_id': ent['id'], 'winner_name': 'Rae Raffle%s' % tag, 'phone_last3': '123',
                                             'winner_entries': 1, 'entries_total': 1, 'entrants_total': 1, 'pick_index': 0,
                                             'outcome': 'drawn', 'drawn_at': NOW.isoformat()})
    put('vp_marketing_optins', {'venue_id': vid, 'name': 'Mo Marketing%s' % tag, 'email': 'lc-mo-%s@example.invalid' % tag,
                                'consent_at': NOW.isoformat(), 'unsubscribe_token': '%032x' % random.getrandbits(128)})
    jg = put('vp_jag_games', {'id': str(__import__('uuid').uuid4()), 'venue_id': vid, 'name': 'Jag %s' % tag, 'deck_size': 52,
                              'commitment': '%064x' % random.getrandbits(256)})
    if jg:
        put('vp_jag_turns', {'id': str(__import__('uuid').uuid4()), 'jag_id': jg['id'], 'card': 1, 'winner_name': 'Jo Jackpot%s' % tag,
                             'night': NOW.date().isoformat()})
    # the phone's own "join the list" with no game on (a real route)
    r = game('/join/list', {'code': rows('vp_venues?id=eq.%s&select=join_code' % vid)[0].get('join_code') or '',
                            'email': 'lc-list-%s@example.invalid' % tag, 'marketing_optin': True, 'consent_version': CONSENT,
                            'pid': 'lcpidlist%s' % tag})
    if isinstance(r, dict) and r.get('stored'):
        planted.append('vp_captures (via /join/list)')
    else:
        failed.append('vp_captures via /join/list: %s' % json.dumps(r)[:160])
    return planted, failed


PII_COLS = ('email', 'mobile', 'phone', 'first_name', 'last_name', 'display_name', 'winner_name', 'contact_name')
# "name" is a THING's name almost everywhere (a draw, a members list, a raffle); in these it is a person's.
PERSON_NAME_TABLES = ('vp_marketing_optins',)


def search_everywhere(tag):
    """Every table and view on TEST with a column that can hold a person, searched for the run tag."""
    req = urllib.request.Request(S.URL + '/rest/v1/', headers={'apikey': S.SKEY, 'Authorization': 'Bearer ' + S.SKEY,
                                                               'Accept': 'application/openapi+json'})
    defs = json.load(urllib.request.urlopen(req, timeout=60)).get('definitions', {})
    hits, searched = {}, 0
    for t, d in sorted(defs.items()):
        cols = [c for c in (d.get('properties') or {}) if c in PII_COLS or 'email' in c or (c == 'name' and t in PERSON_NAME_TABLES)]
        cols = [c for c in cols if (d['properties'][c].get('type') == 'string')]
        if not cols:
            continue
        searched += 1
        q = 'or=(%s)' % ','.join('%s.ilike.*%s*' % (c, tag) for c in cols)
        r = rest('GET', '%s?%s&select=%s&limit=20' % (t, q, ','.join(cols)))
        if isinstance(r, list) and r:
            hits[t] = r
    return hits, searched


def step_deletion(ctx):
    st = '90 days'
    tgt = None
    for p in new_pubs():
        if p.get('player_data_purged_at'):
            continue
        if ctx.get('cancelled') == p['id'] or p['status'] == 'suspended' or (
                rows('vp_prospects?venue_id=eq.%s&cancelled_at=not.is.null&select=venue_id' % p['id'])):
            tgt = p; break
    if not tgt:
        rec(st, 'a cancelled Stage New Pub to clear', 'gap', 'none on TEST this run'); return
    tag = RUN
    vid = tgt['id']
    planted, failed = plant(vid, tag + 'x', st)
    ptag = tag + 'x'
    rec(st, 'player details planted in every other table that can hold them at %s' % tgt['name'],
        'ok' if not failed else 'gap', '%s%s' % (', '.join(planted), ('; could not plant: ' + '; '.join(failed)) if failed else ''))
    before, _ = search_everywhere(tag)
    rec(st, 'before the sweep: where %s\'s people are' % tgt['name'], 'info',
        ', '.join('%s %d' % (t, len(r)) for t, r in sorted(before.items())))
    back = (NOW - datetime.timedelta(days=91)).astimezone(datetime.timezone.utc).isoformat()
    r = rest('PATCH', 'vp_venues?id=eq.%s&name=like.Stage%%20New%%20Pub*' % vid,
             {'status': 'suspended', 'suspended_reason': 'cancelled', 'closed_at': back})
    rest('PATCH', 'vp_prospects?venue_id=eq.%s' % vid, {'cancelled_at': back})
    rec(st, 'dates moved back 91 days (TEST only)', 'fault' if err(r) else 'ok', 'closed_at %s' % back, r if err(r) else '')
    res, js = run_sweep_on_server()
    ctx['sweep_js_lines'] = js.count('\n')
    rec(st, 'live\'s nightly sweep (sweepRetention) ran against TEST on the test server', 'fault' if res.get('error') else 'ok',
        json.dumps(res))
    v = rows('vp_venues?id=eq.%s&select=player_data_purged_at,name,slug,status' % vid)[0]
    rec(st, '%s is stamped as cleared and its own details kept' % tgt['name'], 'ok' if v['player_data_purged_at'] and v['name'] else 'fault',
        'player_data_purged_at %s, name "%s" kept' % (v['player_data_purged_at'], v['name']))
    after, n = search_everywhere(tag)
    # the people of pubs still trading are expected to stay
    act = {MINI['id'], HARBOUR['id']}
    left = {}
    for t, rr in after.items():
        keep = []
        for x in rr:
            blob = json.dumps(x)
            if ptag in blob:
                keep.append(x); continue
            # a game player of this run: which pub?
            if t in ('vp_players',):
                em = x.get('email')
                if em:
                    w = rows('vp_players?email=eq.%s&select=session_id,vp_sessions!inner(venue_id)' % urllib.parse.quote(em))
                    if any((y.get('vp_sessions') or {}).get('venue_id') == vid for y in w):
                        keep.append(x)
        if keep:
            left[t] = keep
    np_people = [p for p in ctx.get('people', {}).get('newpub', []) if p['key'] != 'shared']
    np_left = []
    for p in np_people:
        if p.get('email'):
            w = rows('vp_players?email=eq.%s&select=email' % urllib.parse.quote(p['email']))
            if w:
                np_left.append(p['email'])
    if np_left:
        left['vp_players (the pub\'s game players)'] = np_left
    rec(st, 'every table searched (%d tables and views with a name, email or phone column)' % n,
        'fault' if left else 'ok',
        ('still holding %s\'s people after the sweep: %s' % (tgt['name'], '; '.join('%s (%d)' % (t, len(r)) for t, r in sorted(left.items()))))
        if left else 'none of %s\'s people anywhere' % tgt['name'], json.dumps(left)[:1500])
    sh = [p for p in ctx.get('people', {}).get('mini', []) if p['key'] == 'shared']
    if sh:
        w = rows('vp_players?email=eq.%s&select=email,mobile,session_id,vp_sessions!inner(venue_id)' % urllib.parse.quote(sh[0]['email']))
        at_mini = [y for y in w if (y.get('vp_sessions') or {}).get('venue_id') == MINI['id']]
        at_np = [y for y in w if (y.get('vp_sessions') or {}).get('venue_id') == vid]
        rec(st, 'the same player at a pub still trading is kept', 'ok' if at_mini and not at_np else 'fault',
            '%s: %d row(s) at Stage Mini Bar kept, %d at the cleared pub' % (sh[0]['email'], len(at_mini), len(at_np)))
    uid, email = pub_owner(vid)
    if uid:
        tok = S.session_for(uid, email)['access_token']
        r = api('/account/optin-export', {}, tok, vid)
        has = isinstance(r, dict) and tag in (r.get('csv') or '')
        rec(st, 'the cleared pub\'s own download', 'fault' if has else 'ok',
            'still lists its people' if has else ('empty' if isinstance(r, dict) and 'csv' in r else 'refused: %s' % (r or {}).get('error', r)))
    rec(st, 'backup copies', 'gap', 'Supabase\'s own daily backups of TEST cannot be read from here; live\'s are a separate '
        'question (Supabase keeps them for its plan\'s window, outside the sweep). Not checked.')


# ============================================================================================ 5 ALERTS + 6 PAGE
def alert_line(results):
    bad = [r for r in results if r['status'] == 'fault']
    if not bad:
        return None
    first = bad[0]
    more = (' and %d more' % (len(bad) - 1)) if len(bad) > 1 else ''
    return ('Staging full circle: %s (%s)%s. Page: staging-lifecycle-%s' % (first['check'], first['said'][:90], more,
                                                                            NOW.strftime('%d%b').lower().lstrip('0')))[:230]


def send_alert(line, on):
    """THE ONE SWITCH. Dry run unless main passes --alerts on (with Dean's yes). The channel is the one the Mac's own
    jobs use for Dean (promises/check-promises.py send_email: Resend, venueplay key, to dean@gflam.com.au), so it lands
    as a phone mail notification; macOS notification if that fails. No em dash, no price."""
    if not line:
        return 'nothing to alert'
    if not on:
        return 'DRY RUN, would send to dean@gflam.com.au: "%s"' % line
    sys.path.insert(0, os.path.expanduser('~/venue-enrich'))
    try:
        import vp_email
        e = env_file()
        m = vp_email.apply({'from': 'venueplay checks <hello@venueplay.com.au>', 'to': ['dean@gflam.com.au'],
                            'subject': line[:120], 'text': line}, kind='action')
        assert m['to'] == ['dean@gflam.com.au']
        req = urllib.request.Request('https://api.resend.com/emails', method='POST', data=json.dumps(m).encode(),
                                     headers={'Authorization': 'Bearer ' + e.get('RESEND_VENUEPLAY_KEY', ''),
                                              'Content-Type': 'application/json', 'User-Agent': 'gflam-staging-lifecycle/1.0'})
        urllib.request.urlopen(req, timeout=30)
        return 'sent to dean@gflam.com.au'
    except Exception as x:
        subprocess.run(['osascript', '-e', 'display notification "%s" with title "Staging full circle"' % line.replace('"', "'")[:180]])
        return 'email failed (%s), Mac notification shown' % str(x)[:80]


def page(results, alert_said, outdir):
    esc = html.escape
    col = {'ok': 'var(--ok)', 'fault': 'var(--bad)', 'gap': 'var(--gap)', 'info': 'var(--mut)'}
    word = {'ok': 'OK', 'fault': 'FAULT', 'gap': 'CANNOT SEE YET', 'info': 'NOTE'}
    n = {k: len([r for r in results if r['status'] == k]) for k in col}
    rows_html = []
    step = None
    for r in results:
        if r['step'] != step:
            step = r['step']
            rows_html.append('<h2>%s</h2>' % esc(step.capitalize()))
        ev = ('<details><summary>evidence</summary><pre>%s</pre></details>' % esc(r['evidence'])) if r['evidence'] else ''
        rows_html.append('<div class="r"><span class="b" style="background:%s">%s</span><div><b>%s</b><br>%s%s</div></div>'
                         % (col[r['status']], word[r['status']], esc(r['check']), esc(r['said']), ev))
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Staging full circle</title><style>'
            ':root{--bg:#fff;--fg:#151515;--mut:#666;--ok:#1a7f37;--bad:#c62828;--gap:#a15c00;--line:#e5e5e5}'
            '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121212;--fg:#eee;--mut:#aaa;--ok:#2ea043;--bad:#ef5350;--gap:#d18b1f;--line:#333}}'
            ':root[data-theme="dark"]{--bg:#121212;--fg:#eee;--mut:#aaa;--ok:#2ea043;--bad:#ef5350;--gap:#d18b1f;--line:#333}'
            'body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px}'
            'h1{font-size:22px;margin:8px 0}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}'
            '.r{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}.b{flex:0 0 auto;color:#fff;border-radius:4px;'
            'font-size:12px;font-weight:700;padding:2px 8px;height:fit-content;min-width:64px;text-align:center}'
            'pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:color-mix(in srgb,var(--fg) 6%%,transparent);padding:8px}'
            '.sum{color:var(--mut)}</style></head><body>'
            '<h1>Staging full circle, %s</h1><p class="sum">Run %s on the TEST project and the staging Workers only. '
            '%d OK, %d faults, %d the tool or staging cannot see yet, %d notes. Alert: %s</p>%s</body></html>'
            % (esc(NOW.strftime('%a %d %b %Y, %H:%M')), esc(RUN), n['ok'], n['fault'], n['gap'], n['info'], esc(alert_said), ''.join(rows_html)))


# ============================================================================================ main
def main():
    args = sys.argv[1:]
    steps = ['players', 'messages', 'cancel', 'deletion']
    if '--steps' in args:
        steps = args[args.index('--steps') + 1].split(',')
    alerts_on = '--alerts' in args and args[args.index('--alerts') + 1] == 'on'
    sk = guards()
    if '--check-guards' in args:
        print('guards OK: TEST project, staging Workers%s' % (', Stripe TEST key' if sk else ', no Stripe TEST key')); return
    ctx = {'stripe_key': sk}
    say('run', RUN, 'steps', ','.join(steps))
    ctx['owner'] = owner_session()['access_token']
    ctx['host2'] = host2_session()['access_token']
    if 'players' in steps or 'cancel' in steps:
        act = [p for p in new_pubs() if p['status'] == 'active' and not p.get('closed_at')]
        np = act[-1] if act else None
        if not np:
            np = make_standin_pub()
            rec('players', 'a Stage New Pub for the players', 'info', 'made the stand-in %s (no sign-up has got past the card page)' % np['name'])
        uid, email = pub_owner(np['id'])
        ctx['newpub'] = np
        ctx['np_tok'] = S.session_for(uid, email)['access_token']
    for name, fn in (('players', lambda: step_players(ctx)), ('messages', lambda: step_messages(ctx)),
                     ('cancel', lambda: step_cancel(ctx, '--cancel-now' in args)), ('deletion', lambda: step_deletion(ctx))):
        if name not in steps:
            continue
        try:
            fn()
        except Exception as x:
            import traceback
            rec(name, 'the step itself', 'gap', 'the tool broke: %s' % str(x)[:200], traceback.format_exc()[-1200:])
    line = alert_line(RESULTS)
    said = send_alert(line, alerts_on)
    say('alert:', said)
    outdir = os.path.join(REPORTS, 'staging-lifecycle-%s' % NOW.strftime('%d%b').lower().lstrip('0'))
    os.makedirs(outdir, exist_ok=True)
    open(os.path.join(outdir, 'index.html'), 'w').write(page(RESULTS, said, outdir))
    json.dump({'run': RUN, 'at': NOW.isoformat(), 'alert': said, 'results': RESULTS}, open(os.path.join(outdir, 'results-%s.json' % RUN), 'w'), indent=1)
    say('page:', os.path.join(outdir, 'index.html'))
    return 1 if any(r['status'] == 'fault' for r in RESULTS) else 0


if __name__ == '__main__':
    sys.exit(main())
