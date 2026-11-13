#!/usr/bin/env python3
"""ONE RELEASE COMMAND, in the order CLAUDE.md gives, that cannot skip step 5.

    python3 tools/release.py             release what is committed on HEAD
    python3 tools/release.py --plan      say what it would do and stop

The release was seven manual steps across five tools and CLAUDE.md itself said step 5 "is
the step that gets skipped". Four audit findings of 20 Sep 2026 were order faults: deploy
before green, stamp before landed, check before deployed, push before commit. This walks
the steps and stops at the first one that is not true:

    0. the tree is clean and every Worker is stamped, and every migration the release adds is
       already live (tools/check-migrations-live.py, read-only, INBOX 217)
    0b. THE FAST GATE (INBOX 357A, 13 Nov 2026), ON unless VP_GATE_SERVER=0: tools/gate-server.py run sends this
       exact tree to vp-tests-1, runs its Chrome suites there 4 at a time (about 30 min), and this Mac signs a record
       for the tree only if every one is green on its one run and the server's hash of the files equals this tree's.
       The hook below then leaves those suites out on the Mac. Never fatal: a red, an unreachable server or any fault
       in the record means the hook runs every Chrome suite on the Mac, exactly as before.
    1. push the planned commit to main BY SHA (the pre-push hook runs the local gate; a red gate
       refuses the push; the release refuses if origin/main moved, if HEAD moved during the hook,
       or if what landed is not the SHA planned: 27 Oct 2026, the "three" incident)
    2. deploy every LIVE Worker whose file is in the push, and wait for /health
       (Workers first: the site lands minutes later, and a page asking an old Worker for
       something new reaches a customer)
    3. wait until Cloudflare Pages is serving every served file the push changed
    4. if a screen file changed, run verify-live --stamp and commit the stamp (the full
       gate's "a browser has looked" line is red until this has happened)
    5. run the full gate (release-check.py, live half included). Since 27 Oct 2026: when the
       pre-push hook gated THIS exact tree green under two hours ago (tools/gate-record.json,
       written by the hook, read by tools/gate-record.py) the Chrome suites are left out
       (--skip-chrome) and every other local check plus the whole live half still runs, with
       the reason printed. Any other state is the full gate, as before.
    6. A REAL NIGHT (INBOX 295.1, 12 Nov 2026), OFF until VP_REAL_NIGHT=1: the release is LIVE but not DONE until
       ~/venue-enrich/reports/real-night/<build[:8]>.md records all five games played back to back on The Mini Bar
       with the Kogan TV app and the same two phones, a TV shot, a phone shot and a PASS by a named person for each
       (tools/real-night-check.py judges it; tools/real-night-template.md is the form). Off by default because the
       night is played after the push: main and Dean switch it on.
       SINCE 13 Nov 2026 (INBOX 364/365B, FREE: no Dean step, no SMS): ON, step 6 first runs
       tools/real-night-free.py --build <sha>: (1) the real-night dry run on vp-tests-1 against this exact tree (the fast
       gate's nonce + manifest), (2) verify-live --all against live, read-only, (3) the Kogan TV app shot per game IF the
       TV answers (informational, capped, skipped with a note when dark). It writes the record and a LOOK page; the release
       is DONE only when (1) and (2) are green and tools/real-night-check.py passes that record. Red = LIVE but NOT DONE,
       exit 1. It never rolls back, never sends anything. VP_REAL_NIGHT_MODE=hand keeps the hand-played record instead.
    7. one plain line

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
    'touring-backend/worker/DEPLOY-touring-api.js': 'touring-api',
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


def remote_main():
    """What origin's main points at RIGHT NOW, asked of the remote, not of the local origin/main copy."""
    r = sh(['git', 'ls-remote', 'origin', 'refs/heads/main'])
    return r.stdout.split()[0] if r.returncode == 0 and r.stdout.split() else ''


def push_exactly(sha, expected_remote, what):
    """PUSH ONE NAMED COMMIT, AND PROVE IT IS WHAT ARRIVED (27 Oct 2026, the "three" incident).

    `git push origin HEAD:main` resolves HEAD AFTER the pre-push hook has run. On 27 Oct the hook's gate
    ran a test whose throwaway `git init` re-initialised this checkout and committed "one", "two",
    "three" onto the real branch; the gate printed green for the tree on disk, git printed
    18e2c58d..a62b6e87, and send-pack pushed "three". Every page served <html>three</html> for 29
    minutes. So:
      1. refuse if origin's main is not where it was when this release started (someone else pushed)
      2. push the SHA by name, never HEAD
      3. refuse if HEAD or its tree moved while the hook ran (the gate touched the repo)
      4. refuse unless origin's main now equals the SHA that was planned
    Returns nothing; every failure stops the release."""
    now = remote_main()
    if expected_remote and now != expected_remote:
        stop('origin/main moved while this release was being prepared (%s, expected %s). '
             'git fetch, look at what landed, rebase, and release again.' % (now[:8], expected_remote[:8]))
    tree_before = sh(['git', 'rev-parse', sha + '^{tree}']).stdout.strip()
    r = subprocess.run(['git', 'push', 'origin', sha + ':refs/heads/main'], cwd=ROOT)
    head_after = sh(['git', 'rev-parse', 'HEAD']).stdout.strip()
    tree_after = sh(['git', 'rev-parse', 'HEAD^{tree}']).stdout.strip()
    if head_after != sha or tree_after != tree_before:
        stop('HEAD moved while the %s was being pushed (planned %s, now %s). Something the hook ran touched '
             'this checkout. Nothing after this is safe; find what moved it before releasing again.'
             % (what, sha[:8], head_after[:8]))
    if r.returncode != 0:
        stop('the %s was refused. Read the gate output above; do not bypass it.' % what)
    landed = remote_main()
    if landed != sha:
        stop('origin/main is %s after the %s, not the %s that was planned. Do not continue: look at '
             'what is on GitHub before anything deploys.' % (landed[:8] or 'unreadable', what, sha[:8]))
    print('  %sorigin/main is %s, as planned%s' % (DIM, sha[:8], OFF))


def main():
    plan = '--plan' in sys.argv
    head = sh(['git', 'rev-parse', 'HEAD']).stdout.strip()
    if not head:
        stop('not a git checkout')
    # WHAT THIS RELEASE CHANGES IS MEASURED AGAINST ORIGIN'S MAIN, AS THE REMOTE REPORTS IT. Not @{u}: a
    # worktree branch with no upstream fell through to HEAD~1..HEAD on 27 Oct 2026, so a 35-file release
    # (two Workers, two screen scripts) was read as "one ledger commit, nothing to deploy", the push went
    # out, and the pages ran against the old Workers until someone deployed them by hand.
    upstream = remote_main()
    if not upstream:
        stop('could not read origin/main from GitHub (git ls-remote). No network, or no access; nothing was pushed.')
    changed = sh(['git', 'diff', '--name-only', upstream + '..HEAD']).stdout.split()
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
        print('  would ' + ('run the Chrome suites on vp-tests-1 first (tools/gate-server.py run), then push'
                            if server_gate_on() else 'not use vp-tests-1 (VP_GATE_SERVER=0): the hook runs every Chrome suite on the Mac'))
        for l in real_night_plan(head):
            print('  would ' + l)
        return 0

    step(0, 'the tree is clean and every Worker is stamped')
    dirty = sh(['git', 'status', '--porcelain', '--', 'venueplay', 'partyplay', 'venueplay-backend', 'partyplay-backend', 'tools']).stdout.strip()
    if dirty:
        stop('uncommitted changes would not be in the push:\n' + dirty[:600] + '\nCommit or stash them first.')
    r = sh([PY, 'tools/stamp-workers.py', '--check'])
    if r.returncode != 0:
        stop('a Worker changed without being restamped. Run python3 tools/stamp-workers.py, commit, and release again.')
    # THE REGULATED BINGO CODE (VP-DRAW, 19 Oct 2026). Nothing in it ships unless the version was raised and the
    # manifest regenerated in the same commit, compared with what is on main. The pre-push gate checks it too;
    # it is here as well so a release refuses before it pushes anything, whatever the hook does.
    r = sh([PY, 'tools/regulated.py', '--check'])
    if r.returncode != 0:
        stop('the regulated bingo code (VP-DRAW) does not match its manifest or its version:\n' + (r.stdout + r.stderr)[-800:] +
             '\nRaise the version in both halves of vp-draw.js, run python3 tools/regulated.py --update, then stamp, commit and release again.')
    print('  ok')

    # SNAPSHOT BEFORE THE PUSH: origin's main as the remote reports it, so the push can refuse if it
    # moves, and so what lands can be compared with what was planned (push_exactly).
    remote_before = remote_main()
    if not remote_before:
        stop('could not read origin/main from GitHub (git ls-remote). No network, or no access; nothing was pushed.')
    # EVERY MIGRATION THIS RELEASE ADDS IS ALREADY LIVE (INBOX 217, Dean 11 Nov 2026). Dean runs them
    # early; the code that reads a new column must never land before it. Asked against origin's main AS THE
    # REMOTE REPORTS IT (not the local origin/main copy), read-only, before anything is pushed. The hook's
    # local gate asks the same (D55); this is here as well so a release refuses before it pushes anything.
    r = sh([PY, 'tools/check-migrations-live.py', '--base', remote_before])
    print('\n'.join('  ' + l for l in (r.stdout or '').strip().splitlines()[-16:]))
    if r.returncode != 0:
        stop('a migration in this release is not on the live database yet (above). Dean runs it first, '
             'then release again. Nothing was pushed.')
    step('0b', 'the Chrome suites on vp-tests-1, 4 at a time, signed here for this exact tree')
    for l in server_gate(ROOT):
        print('  ' + l)
    step(1, 'push %s to main by name (the hook runs the local gate)' % head[:8])
    push_exactly(head, remote_before, 'push')

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

    step(4, 'a real browser looks at the screens (before the gate: its stamp check is red until this runs)')
    if screens:
        r = subprocess.run([PY, 'tools/verify-live.py', '--stamp'], cwd=ROOT)
        if r.returncode != 0:
            stop('verify-live did not pass or refused to stamp. Read it.')
        sh(['git', 'add', '.verify-live.json'])
        msg = ('Screens verified live for %s\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n'
               'Claude-Session: https://claude.ai/code/session_015i3GErAW38ivKHruEW6N8q') % head[:8]
        r = sh(['git', 'commit', '-q', '-m', msg])
        if r.returncode == 0:
            stamp = sh(['git', 'rev-parse', 'HEAD']).stdout.strip()
            push_exactly(stamp, head, 'stamp push')
    else:
        print('  no screen file in this push; nothing to look at')

    step(5, 'the full gate, after')
    r = gate_after(ROOT)
    if r.returncode != 0:
        stop('the full gate is red on the live release. Read it; a "this release is live" line means Pages has not finished, run python3 tools/release-check.py again.')

    step(6, 'a real night on this build: five games, The Mini Bar, the Kogan TV app, the same two phones')
    on, good, lines = real_night(head, run=subprocess.run)
    for l in lines: print('  ' + l)
    if on and not good:
        stop('LIVE, but NOT DONE: %s is not verified until a real night is green for it. Nothing was rolled back. Read the '
             'reasons and the LOOK page above, fix, release again; or (VP_REAL_NIGHT_MODE=hand) play the night, write the '
             'record (tools/real-night-template.md), then python3 tools/real-night-check.py %s says DONE.' % (head[:8], head))

    print('\n%sLIVE and checked: %s%s' % (GRN, head[:8], OFF))
    return 0


def server_gate_on(env=None):
    env = os.environ if env is None else env
    return env.get('VP_GATE_SERVER', '1') != '0' and os.path.isfile(os.path.join(ROOT, 'tools', 'gate-server.py'))


def server_gate(root, env=None, run=subprocess.run):
    """Step 0b. Lines to print. Runs tools/gate-server.py run unless VP_GATE_SERVER=0. NEVER stops the release and
    never decides anything itself: the hook asks gate-server.accepted() and runs on the Mac whatever is not covered."""
    env = os.environ if env is None else env
    if not server_gate_on(env):
        return ['%soff (VP_GATE_SERVER=0): the hook runs every Chrome suite on this Mac%s' % (DIM, OFF)]
    t0 = time.time()
    r = run([PY, 'tools/gate-server.py', 'run'], cwd=root)
    took = '%d min' % ((time.time() - t0) // 60)
    if getattr(r, 'returncode', 1) == 0:
        return ['%ssigned in %s: the hook leaves the covered Chrome suites out on this Mac%s' % (GRN, took, OFF)]
    return ['%sno record (%s, above): the hook runs every Chrome suite on this Mac, as before%s' % (YEL, took, OFF)]


def _rn():
    import importlib.util
    spec = importlib.util.spec_from_file_location('real_night_check', os.path.join(ROOT, 'tools', 'real-night-check.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def free_mode(env):
    """The FREE automated night (tools/real-night-free.py) unless VP_REAL_NIGHT_MODE=hand."""
    return (env.get('VP_REAL_NIGHT_MODE') or 'free').strip().lower() != 'hand'


def free_argv(build):
    return [PY, 'tools/real-night-free.py', '--build', build]


def real_night_plan(build, env=None):
    """Lines for --plan: what step 6 would do."""
    env = os.environ if env is None else env
    if (env.get('VP_REAL_NIGHT') or '') != '1':
        return ['not ask for a real night (VP_REAL_NIGHT is not 1)']
    if not free_mode(env):
        return ['want a hand-played real-night record (VP_REAL_NIGHT=1, VP_REAL_NIGHT_MODE=hand): ' + _rn().record_path(build)]
    fr = _load('real_night_free_plan', 'tools/real-night-free.py')
    return ['run the FREE real night after the gate (VP_REAL_NIGHT=1): tools/real-night-free.py --build ' + build[:8]] + \
           ['  ' + l for l in fr.plan_lines(build, env)] + ['  then judge ' + _rn().record_path(build) + ' (never rolls back)']


def _load(name, rel):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def real_night(build, env=None, run=None):
    """Step 6 (INBOX 295.1, 364/365B). (on, good, lines to print). OFF unless VP_REAL_NIGHT=1, and then it says so.
    ON (free mode, the default once on): tools/real-night-free.py plays the dry run on the test server, runs verify-live
    --all and shoots the Kogan app, and writes the record; its output streams to the terminal. A red run is NOT done.
    Then, in both modes, the release is done only when tools/real-night-check.py passes the record for this build.
    Nothing here ever rolls back or sends anything."""
    env = os.environ if env is None else env
    if env.get('VP_REAL_NIGHT') != '1':
        return False, True, ['%soff: VP_REAL_NIGHT is not 1, so no real-night record is asked for yet (main and Dean switch it on)%s' % (DIM, OFF)]
    if free_mode(env):
        # ONLY main() hands a runner in (13 Nov 2026: a suite that called real_night() without one started a real
        # verify-live --all twice). With none, nothing is started and the step is NOT done.
        if run is None:
            return True, False, ['the free real night was not started: real_night() was called without a runner (only release.py main passes one)']
        r = run(free_argv(build), cwd=ROOT, env=dict(env))
        if getattr(r, 'returncode', 1) != 0:
            return True, False, ['the free real night is NOT green (tools/real-night-free.py exit %s, reasons above); nothing rolled back'
                                 % getattr(r, 'returncode', '?')]
    good, why, path = _rn().check(build)
    if good:
        return True, True, ['real night recorded: ' + path]
    return True, False, ['no real night for this build yet (%s):' % path] + ['  - ' + w for w in why]


def gate_argv(root):
    """The release-check.py command step 5 runs, and the one-line reason, from the pre-push gate's
    record (tools/gate-record.py). ONLY when the hook gated this exact tree green under two hours ago
    are the Chrome suites left out (--skip-chrome: every other local check and the whole live half
    still run). Otherwise the full gate, as before. The reason is printed either way."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('gate_record', os.path.join(root, 'tools', 'gate-record.py'))
    gr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gr)
    skip, why = gr.decide(root)
    argv = [PY, 'tools/release-check.py'] + (['--skip-chrome'] if skip else [])
    return argv, why


def gate_after(root, run=subprocess.run):
    """Step 5. Prints why it is running what it runs, then runs it. Returns the CompletedProcess."""
    argv, why = gate_argv(root)
    print('  %s%s%s' % (DIM, why, OFF))
    print('  running: ' + ' '.join(os.path.basename(a) if i == 0 else a for i, a in enumerate(argv)))
    # The gate's summary says in red that a --skip-chrome run is "NOT a release gate", which is right
    # for a prove run and wrong here: the Chrome half WAS gated, by the hook, on this tree. So the
    # gate is told the reason and prints that instead (release-check.py, summary).
    env = dict(os.environ)
    # Never inherited: a gate run INSIDE step 5 (gate-record.test.py is one) would otherwise carry this
    # release's reason into a full-gate child and call a plain run "skipped on purpose" (27 Oct 2026).
    env.pop('VP_CHROME_GATED', None)
    if '--skip-chrome' in argv:
        env['VP_CHROME_GATED'] = why
    return run(argv, cwd=root, env=env)


if __name__ == '__main__':
    sys.exit(main())
