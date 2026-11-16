#!/usr/bin/env python3
"""THE RUN SHEET, AS ONE COMMAND: play the real-looking staging venues on the test server and build the contact sheets.

    python3 tools/staging/real-venues-run.py                      both seeded venues, both modes, all five games
    python3 tools/staging/real-venues-run.py stage-mini-bar       one venue
    python3 tools/staging/real-venues-run.py --games trivia,bingo stage-harbour-hotel
    python3 tools/staging/real-venues-run.py --signup             also a fresh public sign-up (real-venues-signup.py)
    python3 tools/staging/real-venues-run.py --seed               run seed-real-venues.py first (refresh the venues)

What it does, in order (each step says what it is doing):
 1. On this Mac: reads the TEST project only (the guards in seed-real-venues.py), mints short-lived TEST sign-in
    sessions for the test host (0491 570 001, owner) and the second test login (0491 570 002, a host at Stage Mini Bar
    with a Hosted by card), and reads each venue's join code. Writes one plan file per venue (mode 600).
 2. Copies the plan and FIVE files (this folder's player + sheet, tools/verify-live.py, tools/browser-rig/waits.py) to
    the test server vp-tests-1 under /home/vp/stg-real/<stamp>/. No key file, no repo, no secret leaves the Mac: a
    plan holds TEST sessions that end within the hour, and it is deleted from the server when the run ends.
 3. Runs tools/staging/real-venues-play.py there as user vp (its own Chrome, headless), the venues side by side,
    after checking the server's load (waits while the 1-minute load is over 6: other agents share the server).
 4. Brings the frames back to ~/venue-enrich/reports/staging-real-venues-<date>/<venue>-<HHMM>/ and builds
    index.html in each, plus the day's index.html that links them all.
Never Dean's Mac Chrome, never /tmp/vp-heavy.lock, never a live address.
"""
import datetime, importlib.util, json, os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
_s = importlib.util.spec_from_file_location('seedrv', os.path.join(HERE, 'seed-real-venues.py'))
S = importlib.util.module_from_spec(_s); _s.loader.exec_module(S)

HOST = 'root@65.109.160.187'
KEY = os.path.expanduser('~/.ssh/vp_test_runner')
SSH = ['ssh', '-i', KEY, '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', HOST]
FILES = ['tools/verify-live.py', 'tools/browser-rig/waits.py', 'tools/staging/real-venues-play.py',
         'tools/staging/real-venues-sheet.py', 'tools/staging/real-venues-signup.py']
SEEDED = {
    'stage-mini-bar': {'host_for': {'trivia': 'host2', 'musical': 'host2'}},   # Sam hosts the quiz nights (Hosted by card)
    'stage-harbour-hotel': {'host_for': {}},
}


def say(*a):
    print('[%s]' % time.strftime('%H:%M:%S'), *a); sys.stdout.flush()


def sh(cmd, **kw):
    return subprocess.run(cmd, **kw)


def get_json(url):
    # a browser-like name: Cloudflare answers a bare Python client 403 on the staging hosts
    import urllib.request
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (venueplay staging check)'}), timeout=15))


def build_stamp():
    try:
        h = get_json('https://api-staging.venueplay.com.au/health')
        g = get_json('https://game-staging.venueplay.com.au/health')
        return 'api-staging %s, game-staging %s' % (h.get('build'), g.get('build'))
    except Exception as e:
        return 'health not read: %s' % e


def wait_for_server():
    for _ in range(40):
        r = sh(SSH + ['cat /proc/loadavg'], capture_output=True, text=True)
        try:
            load = float(r.stdout.split()[0])
        except Exception:
            load = 99
        if load <= 6:
            say('test server load %.2f, going' % load); return
        say('test server load %.2f (other agents); waiting a minute' % load); time.sleep(60)
    sys.exit('the test server stayed busy for 40 minutes; try later')


def main():
    args = sys.argv[1:]
    games = ''
    if '--games' in args:
        i = args.index('--games'); games = args[i + 1]; del args[i:i + 2]
    modes = ['nophone', 'phones']
    if '--modes' in args:
        i = args.index('--modes'); modes = args[i + 1].split(','); del args[i:i + 2]
    do_signup = '--signup' in args
    if '--seed' in args:
        say('seeding / refreshing the venues on TEST')
        if sh([sys.executable, os.path.join(HERE, 'seed-real-venues.py')]).returncode:
            sys.exit('seed failed')
    venues = [a for a in args if not a.startswith('--')] or list(SEEDED)
    for v in venues:
        if v not in SEEDED:
            sys.exit('unknown venue %r (seeded: %s)' % (v, ', '.join(SEEDED)))
    S.URL, S.SKEY, S.AKEY = S.load_env()
    day = datetime.date.today().strftime('%d%b').lower().lstrip('0')
    root = os.path.expanduser('~/venue-enrich/reports/staging-real-venues-%s' % day)
    os.makedirs(root, exist_ok=True)
    stamp = time.strftime('%H%M')
    build = build_stamp()
    say('staging is', build)
    owner = S.session_for(S.HOST_UID, 'test-host@example.invalid')
    host2 = S.session_for(S.HOST2_UID, 'test-manager@example.invalid')
    remote = '/home/vp/stg-real/%s-%d' % (stamp, os.getpid())
    sh(SSH + ['mkdir -p %s/tools/browser-rig %s/tools/staging' % (remote, remote)], check=True)
    for f in FILES:
        src = os.path.join(os.path.dirname(TOOLS), f)
        if os.path.exists(src):
            sh(['scp', '-q', '-i', KEY, src, '%s:%s/%s' % (HOST, remote, f)], check=True)
    runs = []
    for slug in venues:
        row = S.rest('GET', 'vp_venues?slug=eq.%s&select=id,name,slug,join_code,au_state' % slug)
        if not row:
            sys.exit('%s is not on TEST: run with --seed' % slug)
        r = row[0]
        plan = {'base': 'https://staging.venueplay.com.au', 'label': slug, 'build': build,
                'venue': {'id': r['id'], 'slug': r['slug'], 'code': r['join_code'], 'name': r['name'], 'state': r['au_state']},
                'sessions': {'owner': owner, 'host2': host2}, 'host_for': SEEDED[slug]['host_for'], 'modes': modes}
        local = os.path.join(root, '.plan-%s-%s.json' % (slug, stamp))
        fd = os.open(local, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, json.dumps(plan).encode()); os.close(fd)
        sh(['scp', '-q', '-i', KEY, local, '%s:%s/plan-%s.json' % (HOST, remote, slug)], check=True)
        os.remove(local)
        runs.append(slug)
    sh(SSH + ['chown -R vp:vp %s' % remote], check=True)
    wait_for_server()
    procs = []
    for slug in runs:
        cmd = ('cd %s && runuser -u vp -- env VP_VL_CHROME=/usr/bin/google-chrome TZ=Australia/Brisbane HOME=/home/vp '
               'python3 tools/staging/real-venues-play.py plan-%s.json out-%s %s > run-%s.log 2>&1; echo rc=$?'
               % (remote, slug, slug, games.replace(',', ' '), slug))
        say('playing', slug, 'on the test server (about 20 minutes)')
        procs.append((slug, subprocess.Popen(SSH + [cmd], stdout=subprocess.PIPE, text=True)))
    if do_signup:
        say('fresh sign-up run: tools/staging/real-venues-signup.py (on the server, beside the venues)')
        procs.append(('signup', subprocess.Popen([sys.executable, os.path.join(HERE, 'real-venues-signup.py'), '--remote', remote, '--root', root],
                                                 stdout=subprocess.PIPE, text=True)))
    for slug, p in procs:
        out, _ = p.communicate()
        say(slug, 'finished', (out or '').strip()[-200:])
    sh(SSH + ['rm -f %s/plan-*.json' % remote])
    for slug in runs:
        dest = os.path.join(root, '%s-%s' % (slug, stamp))
        os.makedirs(dest, exist_ok=True)
        sh(['rsync', '-az', '-e', 'ssh -i ' + KEY, '%s:%s/out-%s/' % (HOST, remote, slug), dest + '/'])
        sh(['scp', '-q', '-i', KEY, '%s:%s/run-%s.log' % (HOST, remote, slug), os.path.join(dest, 'run.log')])
        sh([sys.executable, os.path.join(HERE, 'real-venues-sheet.py'), dest])
    sh([sys.executable, os.path.join(HERE, 'real-venues-sheet.py'), '--day', root])
    say('contact sheets:', os.path.join(root, 'index.html'))


if __name__ == '__main__':
    main()
