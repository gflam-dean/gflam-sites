#!/usr/bin/env python3
"""ONE RELEASE COMMAND, in the order CLAUDE.md gives, that cannot skip step 5.

    python3 tools/release.py             release what is committed on HEAD
    python3 tools/release.py --plan      say what it would do and stop

The release was seven manual steps across five tools and CLAUDE.md itself said step 5 "is
the step that gets skipped". Four audit findings of 20 Sep 2026 were order faults: deploy
before green, stamp before landed, check before deployed, push before commit. This walks
the steps and stops at the first one that is not true:

    0. the tree is clean and every Worker is stamped
    1. push HEAD:main (the pre-push hook runs the local gate; a red gate refuses the push)
    2. deploy every LIVE Worker whose file is in the push, and wait for /health
       (Workers first: the site lands minutes later, and a page asking an old Worker for
       something new reaches a customer)
    3. wait until Cloudflare Pages is serving every served file the push changed
    4. run the full gate (release-check.py, live half included)
    5. if a screen file changed, run verify-live --stamp and commit the stamp
    6. one plain line

It calls the existing tools; it adds no judgement of its own. Secrets stay in
~/.gflam-migrate.env, read by the tools that need them, never printed here.
"""
import io, os, re, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'

# Worker file in the repo -> the LIVE Worker it goes to. Nothing else is deployed by this.
LIVE_WORKERS = {
    'venueplay-backend/worker/venueplay-game.js': 'venueplay-game',
    'venueplay-backend/worker/venueplay-api-FULL.js': 'venueplay-api',
    'partyplay-backend/worker/DEPLOY-partyplay-api.js': 'partyplay-api',
    'venueplay-backend/worker/venueplay-sms-hook.js': 'venueplay-sms',
}
SCREEN_FILES = ('venueplay/tv.html', 'venueplay/app/trivia/screen.html', 'venueplay/app/musical/screen.html',
                'venueplay/app/raffle/screen.html', 'venueplay/app/members/screen.html', 'venueplay/app/vp-',
                'venueplay/screen-check.html', 'partyplay/tv.html', 'partyplay/play.html', 'partyplay/host.html',
                'partyplay/practice.html', 'partyplay/index.html', 'partyplay/screen-check.html')


def sh(args, **kw):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, **kw)


def step(n, text):
    print('\n%s%s. %s%s' % (YEL, n, text, OFF))


def stop(why):
    print('\n%sSTOPPED.%s %s' % (RED, OFF, why))
    sys.exit(1)


def main():
    plan = '--plan' in sys.argv
    head = sh(['git', 'rev-parse', 'HEAD']).stdout.strip()
    upstream = sh(['git', 'rev-parse', '@{u}']).stdout.strip()
    if not head:
        stop('not a git checkout')
    changed = sh(['git', 'diff', '--name-only', upstream + '..HEAD']).stdout.split() if upstream else \
              sh(['git', 'diff', '--name-only', 'HEAD~1..HEAD']).stdout.split()
    workers = [f for f in changed if f in LIVE_WORKERS]
    served = [f for f in changed if f.startswith(('venueplay/', 'partyplay/')) and f.endswith(('.html', '.js'))
              and '/emails/' not in f and not f.endswith('.test.js')]
    screens = [f for f in changed if any(f.startswith(w) for w in SCREEN_FILES)]

    print('%sRELEASE of %s%s' % (YEL, head[:8], OFF))
    ahead = sh(['git', 'rev-list', '--count', upstream + '..HEAD']).stdout.strip() if upstream else '?'
    print('  %s commit(s) not yet on origin/main; %d file(s) changed: %d served, %d Worker(s), %d screen file(s)'
          % (ahead, len(changed), len(served), len(workers), len(screens)))
    if plan:
        for w in workers: print('  would deploy %s -> %s' % (w, LIVE_WORKERS[w]))
        for f in served[:8]: print('  would wait for %s to be served' % f)
        if screens: print('  would run verify-live --stamp (screen files changed)')
        return 0

    step(0, 'the tree is clean and every Worker is stamped')
    dirty = sh(['git', 'status', '--porcelain', '--', 'venueplay', 'partyplay', 'venueplay-backend', 'partyplay-backend', 'tools']).stdout.strip()
    if dirty:
        stop('uncommitted changes would not be in the push:\n' + dirty[:600] + '\nCommit or stash them first.')
    r = sh([PY, 'tools/stamp-workers.py', '--check'])
    if r.returncode != 0:
        stop('a Worker changed without being restamped. Run python3 tools/stamp-workers.py, commit, and release again.')
    print('  ok')

    step(1, 'push HEAD:main (the hook runs the local gate)')
    r = subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=ROOT)
    if r.returncode != 0:
        stop('the push was refused. Read the gate output above; do not bypass it.')

    step(2, 'deploy the Workers in this push, and prove each by /health')
    if not workers:
        print('  none in this push')
    for w in workers:
        r = subprocess.run([PY, 'tools/deploy-worker.py', '--live', LIVE_WORKERS[w], w], cwd=ROOT)
        if r.returncode != 0:
            stop('%s did not deploy. Nothing after this is safe to assume.' % w)

    step(3, 'wait until Cloudflare Pages serves every changed file')
    if served:
        sys.path.insert(0, os.path.join(ROOT, 'tools'))
        import importlib.util
        spec = importlib.util.spec_from_file_location('rc', os.path.join(ROOT, 'tools', 'release-check.py'))
        rc = importlib.util.module_from_spec(spec)
        saved = sys.argv; sys.argv = ['release-check.py', '--local']
        try:
            spec.loader.exec_module(rc)
        except SystemExit:
            pass
        sys.argv = saved
        deadline, started = time.time() + 30 * 60, time.time()
        while True:
            stale = [f for f in served if rc.live_matches_local(f) is False]
            if not stale:
                print('  live after %d seconds' % (time.time() - started)); break
            if time.time() > deadline:
                stop('still serving the old build after 30 minutes for: ' + ', '.join(stale[:4]))
            print('  %s... %d still on the old build, e.g. %s%s' % (DIM, len(stale), stale[0], OFF))
            time.sleep(30)
    else:
        print('  nothing served changed')

    step(4, 'the full gate, after')
    r = subprocess.run([PY, 'tools/release-check.py'], cwd=ROOT)
    if r.returncode != 0:
        stop('the full gate is red on the live release. Read it; a "this release is live" line means Pages has not finished, run python3 tools/release-check.py again.')

    step(5, 'a real browser looks at the screens')
    if screens:
        r = subprocess.run([PY, 'tools/verify-live.py', '--stamp'], cwd=ROOT)
        if r.returncode != 0:
            stop('verify-live did not pass or refused to stamp. Read it.')
        sh(['git', 'add', '.verify-live.json'])
        msg = ('Screens verified live for %s\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n'
               'Claude-Session: https://claude.ai/code/session_015i3GErAW38ivKHruEW6N8q') % head[:8]
        r = sh(['git', 'commit', '-q', '-m', msg])
        if r.returncode == 0:
            r2 = subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=ROOT)
            if r2.returncode != 0:
                stop('the stamp commit did not push; push it by hand: git push origin HEAD:main')
    else:
        print('  no screen file in this push; nothing to look at')

    print('\n%sLIVE and checked: %s%s' % (GRN, head[:8], OFF))
    return 0


if __name__ == '__main__':
    sys.exit(main())
