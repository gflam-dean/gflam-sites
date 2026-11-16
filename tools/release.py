#!/usr/bin/env python3
"""ONE RELEASE COMMAND, in the order CLAUDE.md gives, that cannot skip step 5.

    python3 tools/release.py             release what is committed on HEAD
    python3 tools/release.py --plan      say what it would do and stop

The release was seven manual steps across five tools and CLAUDE.md itself said step 5 "is
the step that gets skipped". Four audit findings of 20 Sep 2026 were order faults: deploy
before green, stamp before landed, check before deployed, push before commit. This walks
the steps and stops at the first one that is not true:

    0. the tree is clean and every Worker is stamped, every migration the release adds is
       already live (tools/check-migrations-live.py, read-only, INBOX 217), and THE INSTALLED PRE-PUSH HOOK IS THIS
       TREE'S tools/hooks/pre-push (16 Nov 2026: the 27 Oct copy ignored the server record and had no release lanes, so
       Sunday's stamp push re-ran the whole 3.5 h local gate; VP_OLD_HOOK_OK=1 goes on with a loud line)
    0b. THE FAST GATE (INBOX 357A, 13 Nov 2026), ON unless VP_GATE_SERVER=0: tools/gate-server.py run sends this
       exact tree to vp-tests-1, runs its Chrome suites there 4 at a time (about 30 min), and this Mac signs a record
       for the tree only if every one is green on its one run and the server's hash of the files equals this tree's.
       The hook below then leaves those suites out on the Mac. Never fatal: a red, an unreachable server or any fault
       in the record means the hook runs every Chrome suite on the Mac, exactly as before. A range that changes billing
       code: the record covers every Chrome suite but the BILLING SUITES (gate-server.py BILLING_SUITES), which the hook
       runs on the Mac as well (16 Nov 2026).
    1. push the planned commit to main BY SHA (the pre-push hook runs the local gate; a red gate
       refuses the push; the release refuses if origin/main moved, if HEAD moved during the hook,
       or if what landed is not the SHA planned: 27 Oct 2026, the "three" incident)
    2. deploy every LIVE Worker whose file is in the push, and wait for /health
       (Workers first: the site lands minutes later, and a page asking an old Worker for
       something new reaches a customer)
    3. wait until Cloudflare Pages is serving every served file the push changed
    AFTER THE PUSH, LIVE ONLY (16 Nov 2026, tools/fast-release-16nov): the hook gated this exact tree and step 1 proved
    that tree is what landed, so nothing local is run again. Deploy, Pages served, screens looked at, canary night,
    live half, in that order, each stopping the release when it is not true.
    4. a real browser looks at the live screens: verify-live --stamp and commit the stamp when a screen file changed
       (a bookkeeping push the hook lets through: release lanes), verify-live (read only) when none did
    4c. THE CANARY NIGHT (421 gap 2, 16 Nov 2026), OFF until Dean's yes for the first live run, then VP_CANARY=1:
       tools/canary-night.py --target live plays a 3-question trivia night and one musical bingo deal + claim at Test Alpha
       through the live game Worker, with two headless phones and a TV, and reads the rows back. RED (exit 1) = the
       rollback lane runs AT ONCE (release-lanes rollback, --go) back to the last live-checked release and says so.
       NOT RUN (exit 2: refused, a precondition missing) never rolls back; it is said loudly and written to the INBOX.
    5. THE LIVE HALF: release-check.py --live (every check that asks production; its "a browser has looked" line
       needs step 4's stamp). Until 16 Nov 2026 this was the full gate again, about 2 h of the same Chrome on the same
       tree; the local half is the hook's, on the tree step 1 proved landed.
    6. A REAL NIGHT (INBOX 295.1, 12 Nov 2026), ON BY DEFAULT since INBOX 374 (13 Nov 2026); only an explicit VP_REAL_NIGHT=0 plus VP_REAL_NIGHT_REASON turns it off: the release is LIVE but not DONE until
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
    7. record the commit live on main in tools/live-releases.json (only when 6 is green), pushed alone; the rollback
       lane goes back to these (tools/release-lanes.py, Jobs 442, 16 Nov 2026)
    8. one plain line

    python3 tools/release.py --rollback [--to <sha> --reason "why"] [--go]   the ROLLBACK lane (plan unless --go)
    python3 tools/release.py --urgent "<reason>" [--go]                      the URGENT game-fix lane (plan unless --go)

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


def lanes():
    return _load('release_lanes', 'tools/release-lanes.py')


def main():
    # THE TWO FAST LANES (Jobs 442, 16 Nov 2026): tools/release-lanes.py. PLAN unless --go is given.
    if '--rollback' in sys.argv or '--urgent' in sys.argv:
        return lanes().main([a for a in sys.argv[1:] if a != '--plan'])
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
        for l in hook_plan(ROOT):
            print('  would ' + l)
        print('  would run verify-live --stamp (screen files changed)' if screens else '  would run verify-live, read only (no screen file changed)')
        print('  would ' + ('run the Chrome suites on vp-tests-1 first (tools/gate-server.py run), then push'
                            if server_gate_on() else 'not use vp-tests-1 (VP_GATE_SERVER=0): the hook runs every Chrome suite on the Mac'))
        for l in real_night_plan(head):
            print('  would ' + l)
        for l in canary_plan(head):
            print('  would ' + l)
        print('  would run the live half only after the push (release-check.py --live): the hook gates the local half once')
        print('  would then record what is live on main in tools/live-releases.json (the rollback lane\'s list), if the real night is green')
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
    go, line = hook_gate(ROOT)
    if not go:
        stop(line)
    print('  ' + line)
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

    live_sha = head
    step(4, 'a real browser looks at the screens (before the live half: its stamp check is red until this runs)')
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
            live_sha = stamp
    else:
        print('  no screen file in this push: verify-live, read only, on the live screens')
        r = subprocess.run([PY, 'tools/verify-live.py'], cwd=ROOT)
        if r.returncode != 0:
            stop('verify-live is red on the live screens. Read it; a game fault means roll back now: python3 tools/release.py --rollback --go')

    step('4c', 'the canary night: a short real game at Test Alpha on the live system (red = roll back now)')
    for l in canary_step(head, run=subprocess.run):
        print('  ' + l)

    step(5, 'the live half, after (the local half was gated once, by the hook, on the tree that landed)')
    r = live_after(ROOT)
    if r.returncode != 0:
        stop('the live half is red on the live release. Read it; a "this release is live" line means Pages has not finished, '
             'run python3 tools/release-check.py --live again. A game fault: roll back now, python3 tools/release.py --rollback --go')

    step(6, 'a real night on this build: five games, The Mini Bar, the Kogan TV app, the same two phones')
    on, good, lines = real_night(head, run=subprocess.run)
    for l in lines: print('  ' + l)
    if on and not good:
        stop('LIVE, but NOT DONE: %s is not verified until a real night is green for it. Nothing was rolled back. Read the '
             'reasons and the LOOK page above, fix, release again; or (VP_REAL_NIGHT_MODE=hand) play the night, write the '
             'record (tools/real-night-template.md), then python3 tools/real-night-check.py %s says DONE.' % (head[:8], head))

    # THE RECORD THE ROLLBACK LANE READS (Jobs 442, 16 Nov 2026): only a release that passed the full gate AND a real
    # night is written down. A real night turned off by VP_REAL_NIGHT=0 was not played, so nothing is recorded.
    step(7, 'record what is live on main as a release the rollback lane may go back to')
    if on and good:
        lanes().record_live(lanes().Ops(ROOT), print, live_sha, 'release', ROOT)
    else:
        print('  not recorded: no real night was played on it')

    print('\n%sLIVE and checked: %s%s' % (GRN, head[:8], OFF))
    return 0


def canary_on(env=None):
    """(on, why). OFF until Dean says yes to the first live canary; then main sets VP_CANARY=1 (and makes it the default)."""
    env = os.environ if env is None else env
    if (env.get('VP_CANARY') or '').strip() == '1':
        return True, ''
    return False, ('the canary night is OFF: its first live run needs Dean\'s yes (tools/canary-night.py; then VP_CANARY=1). '
                   'NOT CHECKED: no game was played on live by this release')


def canary_plan(build, env=None):
    on, why = canary_on(env)
    if not on:
        return ['not play the canary night (' + why + ')']
    return ['play the canary night at Test Alpha on live after the Workers and Pages are up (tools/canary-night.py --target live); '
            'RED = the rollback lane runs at once']


CANARY_LOG = os.path.expanduser('~/venue-enrich/reports/canary-night')


def canary_step(build, env=None, run=None, roll=None, alert=None):
    """Step 4c (was 3c). Lines to print. Never runs without a runner (only main() passes one). Exit 0 green; exit 1 RED: the rollback
    lane runs with --go AT ONCE and this stops the release; any other exit is NOT RUN: never rolls back, loud + INBOX."""
    env = os.environ if env is None else env
    on, why = canary_on(env)
    if not on:
        return ['%s%s%s' % (YEL, why, OFF)]
    if run is None:
        return ['the canary night was not started: canary_step() was called without a runner']
    try:
        os.makedirs(CANARY_LOG, exist_ok=True)
        report = os.path.join(CANARY_LOG, '%s-%s.json' % (build[:8], time.strftime('%Y%m%d-%H%M%S')))
    except Exception:
        report = None
    argv = [PY, 'tools/canary-night.py', '--target', 'live', '--live-ok-by-dean'] + (['--report', report] if report else [])
    r = run(argv, cwd=ROOT, env=dict(env))
    rc = getattr(r, 'returncode', 2)
    if rc == 0:
        return ['%scanary night GREEN at Test Alpha on live%s' % (GRN, OFF) + (' (%s)' % report if report else '')]
    if rc == 1:
        print('  %sCANARY NIGHT RED on %s: ROLLING BACK NOW with the rollback lane (tools/release.py --rollback --go)%s'
              % (RED, build[:8], OFF))
        reason = 'canary night red on %s (%s)' % (build[:8], report or 'no report')
        rb = (roll or (lambda why: lanes().rollback(lanes().Ops(ROOT), print, go=True, reason=why, root=ROOT)))(reason)
        (alert or (lambda t: lanes().alert(t, print)))('%s; rollback lane exit %s' % (reason, rb))
        stop('the canary night went RED on live, and the rollback lane %s. Read the canary lines above and %s.'
             % ('rolled the release back' if rb == 0 else 'did NOT finish (exit %s): roll back by hand now, python3 tools/release.py --rollback --go' % rb,
                report or 'the release log'))
    (alert or (lambda t: lanes().alert(t, print)))('canary night NOT RUN on %s (exit %s): nothing rolled back, a person must look' % (build[:8], rc))
    return ['%scanary night NOT RUN (exit %s, reasons above): NOTHING ROLLED BACK and NOTHING PLAYED ON LIVE. A person must look.%s'
            % (YEL, rc, OFF)]


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


def real_night_on(env):
    """(on, lines). The real night is ON BY DEFAULT (INBOX 374, 13 Nov 2026). Only an explicit VP_REAL_NIGHT=0 WITH a reason
    (VP_REAL_NIGHT_REASON) turns it off, and the reason is printed into the release log. VP_REAL_NIGHT=0 with no reason is
    ignored (the night runs and the log says why). Anything else, unset or 1, is on."""
    v = (env.get('VP_REAL_NIGHT') or '').strip()
    if v == '0':
        reason = (env.get('VP_REAL_NIGHT_REASON') or '').strip()
        if reason:
            return False, ['real night OFF by an explicit VP_REAL_NIGHT=0, reason: ' + reason]
        return True, ['VP_REAL_NIGHT=0 ignored: turning the real night off needs a reason (VP_REAL_NIGHT_REASON="why") that goes in the release log, so it runs']
    return True, []


def real_night_plan(build, env=None):
    """Lines for --plan: what step 6 would do."""
    env = os.environ if env is None else env
    on, why = real_night_on(env)
    if not on:
        return ['not ask for a real night (' + why[0] + ')']
    if not free_mode(env):
        return why + ['want a hand-played real-night record (VP_REAL_NIGHT_MODE=hand): ' + _rn().record_path(build)]
    fr = _load('real_night_free_plan', 'tools/real-night-free.py')
    return why + ['run the FREE real night after the gate (on by default): tools/real-night-free.py --build ' + build[:8]] + \
           ['  ' + l for l in fr.plan_lines(build, env)] + ['  then judge ' + _rn().record_path(build) + ' (never rolls back)']


def _load(name, rel):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def real_night(build, env=None, run=None):
    """Step 6 (INBOX 295.1, 364/365B, 374). (on, good, lines to print). ON by default; only VP_REAL_NIGHT=0 with VP_REAL_NIGHT_REASON turns it off, and the reason is printed.
    ON (free mode, the default once on): tools/real-night-free.py plays the dry run on the test server, runs verify-live
    --all and shoots the Kogan app, and writes the record; its output streams to the terminal. A red run is NOT done.
    Then, in both modes, the release is done only when tools/real-night-check.py passes the record for this build.
    Nothing here ever rolls back or sends anything."""
    env = os.environ if env is None else env
    on, why = real_night_on(env)
    if not on:
        return False, True, ['%s%s%s' % (DIM, why[0], OFF)]
    if free_mode(env):
        # ONLY main() hands a runner in (13 Nov 2026: a suite that called real_night() without one started a real
        # verify-live --all twice). With none, nothing is started and the step is NOT done.
        if run is None:
            return True, False, why + ['the free real night was not started: real_night() was called without a runner (only release.py main passes one)']
        r = run(free_argv(build), cwd=ROOT, env=dict(env))
        if getattr(r, 'returncode', 1) != 0:
            return True, False, why + ['the free real night is NOT green (tools/real-night-free.py exit %s, reasons above); nothing rolled back'
                                 % getattr(r, 'returncode', '?')]
    good, missing, path = _rn().check(build)
    if good:
        return True, True, why + ['real night recorded: ' + path]
    return True, False, why + ['no real night for this build yet (%s):' % path] + ['  - ' + w for w in missing]


def live_argv():
    """Step 5's command: the live half only. Never the local half (the hook ran it on the tree step 1 proved landed), never
    a Chrome suite, never the heavy lock (release-check.py takes it only when the local half runs)."""
    return [PY, 'tools/release-check.py', '--live']


def live_after(root, run=subprocess.run):
    """Step 5. Prints what it runs and why nothing local runs again, then runs it. Returns the CompletedProcess."""
    argv = live_argv()
    print('  %sthe local half (every Chrome suite included) is not run again: the pre-push hook gated this exact tree and '
          'step 1 proved it is what landed on main%s' % (DIM, OFF))
    print('  running: ' + ' '.join(os.path.basename(a) if i == 0 else a for i, a in enumerate(argv)))
    env = dict(os.environ)
    env.pop('VP_CHROME_GATED', None)
    return run(argv, cwd=root, env=env)


def installed_hook_path(root):
    """Where git runs the pre-push hook from for this checkout (core.hooksPath respected), or ''."""
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}   # inside a hook git exports GIT_DIR
    r = subprocess.run(['git', 'rev-parse', '--git-path', 'hooks/pre-push'], cwd=root, capture_output=True, text=True, env=env)
    p = r.stdout.strip() if r.returncode == 0 else ''
    return os.path.join(root, p) if p and not os.path.isabs(p) else p


def hook_installed(root):
    """(good, why): the installed pre-push hook is byte for byte this tree's tools/hooks/pre-push (16 Nov 2026)."""
    want = os.path.join(root, 'tools', 'hooks', 'pre-push')
    have = installed_hook_path(root)
    try:
        a = io.open(want, 'rb').read()
    except Exception:
        return False, 'this tree has no tools/hooks/pre-push to compare the installed hook with'
    if not have or not os.path.isfile(have):
        return False, 'NO pre-push hook is installed (%s): the push would go out ungated' % (have or 'no hooks path')
    if not os.access(have, os.X_OK):
        return False, 'the installed pre-push hook (%s) is not executable, so git would skip it' % have
    if io.open(have, 'rb').read() != a:
        return False, ('the installed pre-push hook (%s) is not this tree\'s tools/hooks/pre-push: it may ignore the signed '
                       'server record, the billing rule and the release lanes (16 Nov 2026: the 27 Oct copy did, and Sunday '
                       'ran 3.5 h of Chrome twice)' % have)
    return True, 'the installed pre-push hook is this tree\'s tools/hooks/pre-push'


def hook_gate(root, env=None):
    """Step 0's hook check. (go, line): go is False (the release stops before anything is pushed) when the installed hook
    is not this tree's, unless VP_OLD_HOOK_OK=1, which goes on and says so in red."""
    env = os.environ if env is None else env
    good, why = hook_installed(root)
    if good:
        return True, '%s%s%s' % (DIM, why, OFF)
    if (env.get('VP_OLD_HOOK_OK') or '').strip() == '1':
        return True, '%sVP_OLD_HOOK_OK=1, going on anyway: %s%s' % (RED, why, OFF)
    return False, (why + '\nInstall it (a gate change: say so to Dean): bash tools/hooks/install.sh, then release again. '
                   'Or VP_OLD_HOOK_OK=1 to go on with the hook that is there. Nothing was pushed.')


def hook_plan(root):
    good, why = hook_installed(root)
    return ['find ' + why] if good else ['STOP at step 0: ' + why + ' (bash tools/hooks/install.sh, or VP_OLD_HOOK_OK=1)']


if __name__ == '__main__':
    sys.exit(main())
