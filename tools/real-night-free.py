#!/usr/bin/env python3
"""THE FREE REAL NIGHT: RELEASE.PY'S STEP 6 WITH NO DEAN STEP AND NO SMS (INBOX 364/365B, 13 Nov 2026).

    python3 tools/real-night-free.py --build <sha>              run it, write the record + LOOK page, exit 0 only if green
    python3 tools/real-night-free.py --build <sha> --plan       say what it would run and stop
    python3 tools/real-night-free.py --build <sha> --no-verify-live --no-kogan
                                                                the dry run alone (the record then says SKIPPED: NOT done)

Dean, 13 Nov 2026: "I don't need to be your babysitter ... you can do it yourself for free." No SMS number (A$19/month,
Dean said no), no live host sign-in, no Dean step. After a deploy, release.py (step 6, only when VP_REAL_NIGHT=1) runs
this, and the release is DONE only when (1) and (2) are green:

  (1) THE DRY RUN ON THE TEST SERVER, ON THE RELEASE TREE. tools/real-night-dryrun-in-chrome.test.py (all five games back
      to back, one TV window, the same two phones, The Mini Bar's saved settings) is sent to vp-tests-1 through the fast
      gate's own machinery (tools/gate-server.py: remote-run.sh with a fresh nonce and the manifest of this exact tree;
      the server hashes the files before and after and echoes the nonce). Judged HERE from the raw output with the
      gate's own pass judge and ledger count. Refused if the checkout is dirty, if the tree moved during the run, or if
      the server's run cannot be tied to this tree. Its screenshots come back from the server's per-tree folder and are
      attached only when the suite's night.json agrees with the run that was judged.
  (2) VERIFY-LIVE --ALL against LIVE, read-only (tools/verify-live.py --all, never --stamp). Runs on this Mac at the
      same time as (1).
  (3) THE KOGAN TV APP, INFORMATIONAL. One screenshot per game through VP_RN_KOGAN_TOOL (default main's
      ~/venue-enrich/reports/real-night/kogan/kogan-shot.sh), each capped at VP_RN_KOGAN_TIMEOUT seconds (default 90).
      The first failure or timeout skips the rest with the reason written down. A dark TV never fails the release and
      never hangs it. The record says honestly "Kogan app shots: n of 5": the app was SHOT as it stood after the
      deploy, it was not played.

It writes <VP_REAL_NIGHT_DIR or ~/venue-enrich/reports/real-night>/<build8>.md (judged by tools/real-night-check.py,
automated mode) and <build8>/ beside it: LOOK.html, shots/, kogan/, dryrun.txt, verify-live.txt.

WHAT IT NEVER DOES: roll anything back, touch a live venue (verify-live only watches screens), send anything (no email,
no text, no push: a red is written to the build session's INBOX file, VP_RN_FAULTS moves it), or run when the kill file
is there (VP_RN_KILL_FILE, default ~/venue-enrich/reports/real-night/STOP: checked before every part).
"""
import argparse, concurrent.futures, datetime, hashlib, html, importlib.util, io, json, os, re, secrets, shlex, shutil
import signal, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
SUITE = 'real-night-dryrun-in-chrome.test.py'
SERVER_SHOTS = '/home/vp/venue-enrich/reports/real-night-shots'
SSH_KEY = os.path.expanduser('~/.ssh/vp_test_runner')
DEFAULT_KOGAN_TOOL = os.path.expanduser('~/venue-enrich/reports/real-night/kogan/kogan-shot.sh')
DEFAULT_KILL_FILE = os.path.expanduser('~/venue-enrich/reports/real-night/STOP')
DEFAULT_FAULTS = os.path.expanduser('~/venue-enrich/builds/INBOX.md')
WHO = 'real-night-free (automated)'
VL_GREEN = 'Every screen checked is painting what it should.'
GAMES = (('01-', 'Trivia', 'trivia'), ('02-', 'Musical bingo', 'musical'), ('03-', 'Bingo', 'bingo'),
         ('04-', 'Raffle', 'raffle'), ('05-', 'Members draw', 'members'))
TV_PICK = ('01-trivia-tv-question', '02-musical-tv-playing', '03-bingo-tv', '04-raffle-tv-draw', '05-members-tv-draw')
PHONE_PICK = ('01-trivia-phone-A-question', '02-musical-phone-A-card', '03-bingo-phone-A', '04-raffle-phone-A-draw',
              '05-members-phone-A-draw')
ANSI = re.compile(r'\x1b\[[0-9;]*m')


def load(name, rel, root=ROOT):
    spec = importlib.util.spec_from_file_location(name, os.path.join(root, rel))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Stopped(Exception):
    pass


def killed(kill_file):
    if kill_file and os.path.exists(kill_file):
        raise Stopped('the kill file %s is there' % kill_file)


def tool_of(env):
    return env.get('VP_RN_KOGAN_TOOL') or DEFAULT_KOGAN_TOOL


def kogan_argv(tool, out):
    """How the Kogan tool is called. '{out}' in VP_RN_KOGAN_TOOL is replaced (e.g. 'python3 tools/kogan-shot.py --out
    {out}'); otherwise the tool takes the png path as its one argument, as main's kogan-shot.sh does."""
    if '{out}' in tool:
        return [a.replace('{out}', out) for a in shlex.split(tool)]
    if tool.endswith('.sh'):
        return ['bash', tool, out]
    if tool.endswith('.py'):
        return [PY, tool, out]
    return [tool, out]


def kogan_tool_present(tool):
    if '{out}' in tool:
        first = [a for a in shlex.split(tool) if not a.startswith('-')]
        exe = shutil.which(first[0]) if first else None
        rest = [a for a in first[1:] if a.endswith(('.py', '.sh'))]
        return bool(exe) and all(os.path.isfile(os.path.join(ROOT, a) if not os.path.isabs(a) else a) for a in rest)
    return os.path.isfile(tool)


def run_capped(argv, timeout, cwd=None):
    """(rc or 'timeout', output). The whole process group dies at the cap, so an sdb child cannot hold the release."""
    p = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        out, _ = p.communicate(timeout=timeout)
        return p.returncode, out or ''
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except Exception:
            pass
        try:
            out, _ = p.communicate(timeout=5)
        except Exception:
            out = ''
        return 'timeout', out or ''


def is_png(path):
    try:
        with open(path, 'rb') as fh:
            head = fh.read(8)
        return head == b'\x89PNG\r\n\x1a\n' and os.path.getsize(path) > 100
    except Exception:
        return False


# ------------------------------------------------------------------------------------------------ (1) the dry run

def remote_runner(root):
    """runner(nonce, paths, timeout) -> (results file or '', tail of what remote-run.sh said), through the fast gate's
    own remote-run.sh (its path is gate-server.py's, fixed), one suite, -j 1."""
    gs = load('gate_server_for_rn', 'tools/gate-server.py', root)

    def run(nonce, paths, timeout):
        fd, plist = tempfile.mkstemp(prefix='rn-paths-', suffix='.bin')
        with os.fdopen(fd, 'wb') as fh:
            fh.write(b'\0'.join(paths))
        try:
            env = dict(os.environ, VP_RUN_NONCE=nonce, VP_RUN_PATHS=plist)
            p = subprocess.run(['bash', gs.REMOTE_RUN, root, '-j', '1', 'tools/' + SUITE], capture_output=True, text=True,
                               env=env, timeout=timeout)
            said = (p.stdout or '') + (p.stderr or '')
        except subprocess.TimeoutExpired:
            return '', 'remote-run.sh did not finish in %d min' % (timeout // 60)
        finally:
            os.remove(plist)
        m = re.findall(r'^results: (\S+\.jsonl)$', said, re.M)
        return (m[-1] if m else ''), '\n'.join(said.strip().splitlines()[-6:])
    return run


def remote_fetch(root):
    """fetch(dest) -> '' or why not: the server's per-tree shot folder (the suite writes it) copied into dest."""
    gs = load('gate_server_for_rn_fetch', 'tools/gate-server.py', root)

    def fetch(dest):
        os.makedirs(dest, exist_ok=True)
        src = 'root@%s:%s/%s/' % (gs.HOST, SERVER_SHOTS, os.path.basename(root))
        try:
            r = subprocess.run(['rsync', '-az', '-e', 'ssh -i %s -o ConnectTimeout=20' % SSH_KEY, src, dest + '/'],
                               capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            return 'the shots did not come back in 5 min'
        return '' if r.returncode == 0 else 'the shots did not come back (rsync %d)' % r.returncode
    return fetch


def dry_run(root, out_dir, runner, fetch, timeout=40 * 60, say=print):
    """(1). Returns a dict: green, why, checks, tree, head, files, fails, shots_ok, shots_why."""
    gs = load('gate_server_for_rn_dry', 'tools/gate-server.py', root)
    res = {'green': False, 'why': '', 'checks': 0, 'tree': '', 'head': '', 'files': 0, 'fails': [], 'shots_ok': False,
           'shots_why': 'not fetched'}
    tree, head, dirty = gs.current_tree(root)
    res['tree'], res['head'] = tree, head
    if not tree:
        res['why'] = 'the checkout is dirty, so the server would run files that are not the release: ' + dirty[:200]
        return res
    digest, paths = gs.manifest(root)
    if not digest:
        res['why'] = 'the manifest of this tree could not be read'
        return res
    res['files'] = len(paths)
    nonce = secrets.token_hex(16)
    t0 = time.time()
    say('  (1) dry run: %s on vp-tests-1, tree %s (%d files, nonce bound)' % (SUITE, tree[:12], len(paths)))
    path, tail = runner(nonce, paths, timeout)
    if not path or not os.path.isfile(path):
        res['why'] = 'the server sent no results (%s)' % (tail.strip().splitlines()[-1] if tail.strip() else 'nothing said')
        return res
    entry_from = gs.judge_raw(root)
    run, entry, raw = {}, None, ''
    for line in io.open(path, encoding='utf-8'):
        d = json.loads(line)
        if isinstance(d.get('run'), dict):
            run = d['run']
        if os.path.basename(str(d.get('suite', ''))) == SUITE:
            entry, raw = entry_from(d), d.get('out') if isinstance(d.get('out'), str) else ''
    io.open(os.path.join(out_dir, 'dryrun.txt'), 'w', encoding='utf-8').write(raw or '(no output came back)\n')
    tree2, _, _ = gs.current_tree(root)
    if tree2 != tree:
        res['why'] = 'the checkout changed while the dry run ran (tree %s, now %s)' % (tree[:12], (tree2 or 'dirty')[:12])
        return res
    why = gs.run_bound(run, nonce, digest)
    if why:
        res['why'] = why
        return res
    if entry is None:
        res['why'] = 'the server ran no %s' % SUITE
        return res
    res['checks'] = entry.get('checks') or 0
    res['fails'] = [l.strip() for l in (raw or '').splitlines() if l.strip().startswith('FAIL ')][:20]
    why = gs.suite_accepted(SUITE, entry, gs.ledger(root).get('tools/' + SUITE), gs.suite_passed_rule(root))
    if why:
        res['why'] = why
    else:
        res['green'] = True
    shots = os.path.join(out_dir, 'shots')
    got = fetch(shots)
    if got:
        res['shots_why'] = got
        return res
    try:
        night = json.load(io.open(os.path.join(shots, 'night.json'), encoding='utf-8'))
    except Exception:
        night = None
    if not isinstance(night, dict):
        res['shots_why'] = 'the server folder has no night.json, so the shots cannot be tied to this run'
    elif night.get('tree_name') != os.path.basename(root):
        res['shots_why'] = 'the shots are another tree\'s (%r)' % night.get('tree_name')
    elif night.get('ran') != res['checks'] + len(res['fails']) or night.get('bad') != len(res['fails']):
        res['shots_why'] = 'the shots are from another run (it ran %r, %r failed; this run %d, %d)' % (
            night.get('ran'), night.get('bad'), res['checks'] + len(res['fails']), len(res['fails']))
    elif not isinstance(night.get('finished'), (int, float)) or night['finished'] < t0 - 600:
        res['shots_why'] = 'the shots finished before this run started'
    else:
        res['shots_ok'], res['shots_why'] = True, ''
    return res


# ------------------------------------------------------------------------------------------------ (2) verify-live --all

def verify_live_runner(root):
    def run(timeout):
        return run_capped([PY, 'tools/verify-live.py', '--all'], timeout, cwd=root)
    return run


def verify_live(out_dir, runner, timeout=75 * 60, say=print):
    say('  (2) verify-live --all against LIVE (read-only, this Mac)')
    rc, out = runner(timeout)
    plain = ANSI.sub('', out or '')
    io.open(os.path.join(out_dir, 'verify-live.txt'), 'w', encoding='utf-8').write(plain or '(no output)\n')
    venues = len(re.findall(r'^\s+\S+ \.\.\. all \d+ checks passed', plain, re.M))
    bad = [l.strip() for l in plain.splitlines() if re.match(r'^\s+\S+ \.\.\. ', l) and 'checks passed' not in l][:10]
    if rc == 'timeout':
        return {'green': False, 'why': 'verify-live --all did not finish in %d min' % (timeout // 60), 'venues': venues, 'bad': bad}
    if rc != 0 or VL_GREEN not in plain:
        return {'green': False, 'why': 'verify-live --all exit %s%s' % (rc, (': ' + bad[0]) if bad else ''), 'venues': venues, 'bad': bad}
    if venues == 0:
        return {'green': False, 'why': 'verify-live --all said green but checked no venue', 'venues': 0, 'bad': bad}
    return {'green': True, 'why': '', 'venues': venues, 'bad': []}


# ------------------------------------------------------------------------------------------------ (3) the Kogan app

def kogan_shots(out_dir, tool, timeout, kill_file=None, run=run_capped, say=print):
    """[(game, file name under kogan/ or None, note)] for the five games. Informational: never raises, never waits
    longer than one capped call once the TV has failed to answer."""
    kd = os.path.join(out_dir, 'kogan')
    os.makedirs(kd, exist_ok=True)
    rows, dark = [], ''
    if not kogan_tool_present(tool):
        dark = 'the Kogan tool %s is not on this Mac' % tool
    for prefix, game, word in GAMES:
        if not dark and kill_file and os.path.exists(kill_file):
            dark = 'the kill file is there'
        if dark:
            rows.append((game, None, 'skipped (%s)' % dark))
            continue
        name = '%s%s.png' % (prefix, word)
        out = os.path.join(kd, name)
        rc, said = run(kogan_argv(tool, out), timeout)
        if rc == 0 and is_png(out):
            rows.append((game, name, 'the app as it stood on the TV'))
            say('  (3) Kogan app shot for %s' % game)
            continue
        if rc == 'timeout':
            dark = 'the TV did not answer in %ds' % timeout
        else:
            last = (said or '').strip().splitlines()[-1:] or ['no output']
            dark = 'the Kogan tool exit %s: %s' % (rc, last[0][:120]) if rc != 0 else 'the Kogan tool wrote no PNG'
        rows.append((game, None, 'skipped (%s)' % dark))
        say('  (3) Kogan app: %s; the rest skipped, the release is not held for it' % dark)
    return rows


# ------------------------------------------------------------------------------------------------ the record and LOOK

def fails_of(fails, word):
    """The dry run's FAIL lines that name this game ('FAIL bingo: ...' is Bingo, 'FAIL musical: ...' is not)."""
    return [f for f in fails if re.match(r'^FAIL\s+%s\b' % word, f, re.I)]


def pick(files, want, prefix, part):
    if want in files:
        return want
    return next((f for f in files if f.startswith(prefix) and part in f), None)


def game_shots(shots_dir):
    files = sorted(os.path.splitext(f)[0] for f in os.listdir(shots_dir) if f.endswith('.jpg')) if os.path.isdir(shots_dir) else []
    out = {}
    for i, (prefix, game, word) in enumerate(GAMES):
        mine = [f for f in files if f.startswith(prefix) or f.startswith(word + '-end-')]
        out[game] = {'tv': pick(files, TV_PICK[i], prefix, '-tv'), 'phone': pick(files, PHONE_PICK[i], prefix, 'phone-'), 'all': mine}
    return out


def write_record(record_dir, build, b8dir, dr, vl, kg, look_rel, vl_skipped=False):
    sub = os.path.basename(b8dir)
    shots = game_shots(os.path.join(b8dir, 'shots')) if dr['shots_ok'] else {g: {'tv': None, 'phone': None, 'all': []} for _, g, _ in GAMES}
    n = sum(1 for _, f, _ in kg if f)
    lines = ['# Real night (automated, free): %s' % build[:8], '',
             'Build: %s' % build,
             'Mode: automated, tools/real-night-free.py (no Dean step, no SMS)',
             'Date: %s Brisbane' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
             'Venue: The Mini Bar saved settings on the test server rig (vp-tests-1), not the live venue',
             'TV: Chrome /tv (test server) 1280x720, one window all night',
             'Kogan app shots: %d of %d (informational: the app was shot as it stood after the deploy, not played)' % (n, len(GAMES)),
             'Phone A: headless Chrome phone A 390x844 (test server)',
             'Phone B: headless Chrome phone B 390x844 (test server)',
             'Settings: The Mini Bar style saved settings (tools/fixtures/live-prefs-shapes.json), never fresh defaults',
             'Tree: %s (commit %s), %d files matched on the server, nonce bound' % (dr['tree'] or 'none', (dr['head'] or '')[:8], dr['files']),
             'Dry run: %s' % ('GREEN, %d checks, %s on vp-tests-1' % (dr['checks'], SUITE) if dr['green'] else 'RED, ' + dr['why'].replace(':', ' -')),
             'Verify live: %s' % ('SKIPPED (--no-verify-live), NOT done' if vl_skipped else
                                  'GREEN, verify-live.py --all, %d venues, read-only' % vl['venues'] if vl['green'] else 'RED, ' + vl['why'].replace(':', ' -')),
             'Look: %s' % look_rel, '']
    if not dr['shots_ok']:
        lines.insert(-1, 'Shots: not attached (%s)' % dr['shots_why'].replace(':', ' -'))
    for (prefix, game, word), (_, kfile, note) in zip(GAMES, kg):
        s = shots[game]
        lines.append('## %s' % game)
        if s['tv']:
            lines.append('TV shot: %s/shots/%s.jpg' % (sub, s['tv']))
        if s['phone']:
            lines.append('Phone shot: %s/shots/%s.jpg' % (sub, s['phone']))
        lines.append('Kogan shot: %s' % ('%s/kogan/%s' % (sub, kfile) if kfile else note.replace(':', ' -')))
        lines.append('Phones: A, B')
        mine = fails_of(dr['fails'], word)
        res = 'PASS' if (dr['green'] and (vl['green'] or vl_skipped) and not mine) else 'FAIL'
        lines.append('Result: %s by %s' % (res, WHO))
        for f in mine[:5]:
            lines.append('- %s' % f.replace(':', ' -')[:200])
        lines.append('')
    path = os.path.join(record_dir, build[:8] + '.md')
    io.open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    return path


def write_look(b8dir, build, dr, vl, kg, verdict, reasons):
    e = html.escape
    shots = game_shots(os.path.join(b8dir, 'shots')) if dr['shots_ok'] else {}
    rows = []
    for (prefix, game, word), (_, kfile, note) in zip(GAMES, kg):
        figs = ''.join('<figure><img loading="lazy" src="shots/%s.jpg" alt="%s"><figcaption>%s</figcaption></figure>' % (e(f), e(f), e(f))
                       for f in (shots.get(game) or {}).get('all', []))
        figs += ('<figure><img loading="lazy" src="kogan/%s" alt="Kogan"><figcaption>Kogan app (shot, not played)</figcaption></figure>' % e(kfile)
                 if kfile else '<p class="none">Kogan app: %s</p>' % e(note))
        mine = fails_of(dr['fails'], word)
        rows.append('<section class="%s"><h3>%s</h3><div class="shots">%s</div>%s</section>' % (
            'red' if mine else '', e(game), figs or '<p class="none">no shots</p>',
            '<ul>%s</ul>' % ''.join('<li class="bad">%s</li>' % e(f) for f in mine) if mine else ''))
    vlbad = ''.join('<li class="bad">%s</li>' % e(b) for b in vl.get('bad', []))
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Real night %(b)s</title><style>
:root{--bg:#fff;--fg:#16161a;--mut:#666;--line:#e3e3e8;--ok:#0a7a3e;--bad:#c0262d;--card:#f6f6f8}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#eee;--mut:#aaa;--line:#2c2c31;--ok:#4bd18a;--bad:#ff6b6b;--card:#1b1b1f}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}h1{font-size:22px;margin:4px 0}.v{font-weight:700;color:%(vc)s}
.meta{color:var(--mut)}.why{background:var(--card);border-left:4px solid var(--bad);padding:10px 12px}
section{border-top:1px solid var(--line);padding:12px 0}section.red h3{color:var(--bad)}h3{margin:0 0 8px;font-size:16px}
.shots{display:flex;gap:10px;overflow-x:auto}figure{margin:0;flex:0 0 auto}
figure img{height:220px;border:1px solid var(--line);border-radius:6px;display:block}figcaption{font-size:12px;color:var(--mut)}
ul{margin:8px 0 0;padding-left:18px}li.bad{color:var(--bad);font-weight:600}.none{color:var(--mut)}
</style></head><body><main>
<h1>Real night on %(b)s: <span class="v">%(v)s</span></h1>
<p class="meta">Automated and free: the dry run on the test server (Chrome /tv and two headless phones, The Mini Bar's saved settings), verify-live --all on live, and the Kogan TV app shot (not played): %(kn)d of 5. %(when)s.</p>
<p class="meta">Dry run: %(dr)s<br>Verify live: %(vl)s<br>Tree %(tree)s.</p>
%(first)s%(vlbad)s
%(rows)s
</main></body></html>''' % {
        'b': e(build[:8]), 'v': verdict, 'vc': 'var(--ok)' if verdict == 'GREEN' else 'var(--bad)',
        'kn': sum(1 for _, f, _ in kg if f), 'when': e(datetime.datetime.now().strftime('%d %b %Y %H:%M')),
        'dr': e('GREEN, %d checks' % dr['checks'] if dr['green'] else 'RED: ' + dr['why']),
        'vl': e('GREEN, %d venues' % vl['venues'] if vl['green'] else 'RED: ' + vl['why']), 'tree': e((dr['tree'] or 'none')[:12]),
        'first': '<p class="why">%s</p>' % '<br>'.join(e(r) for r in reasons[:6]) if reasons else '',
        'vlbad': '<ul>%s</ul>' % vlbad if vlbad else '', 'rows': '\n'.join(rows)}
    p = os.path.join(b8dir, 'LOOK.html')
    io.open(p, 'w', encoding='utf-8').write(page)
    return p


def write_fault(path, build, reasons, look):
    """A red night goes to the build session's INBOX file. Local file only: nothing is sent to anyone."""
    body = ['', '## REAL NIGHT (free) RED on %s (tools/real-night-free.py, %s)' % (build[:8], datetime.datetime.now().strftime('%d %b %H:%M'))]
    body += ['- ' + r for r in reasons[:8]] + ['Look page: %s' % look, 'Nothing rolled back. Dean NOT told (test server + read-only checks only).', '']
    with io.open(path, 'a', encoding='utf-8') as fh:
        fh.write('\n'.join(body) + '\n')


# ------------------------------------------------------------------------------------------------ the whole step

def run_night(build, root=ROOT, record_dir=None, runner=None, fetch=None, vl_runner=None, kogan_run=run_capped, env=None,
              verify=True, kogan=True, say=print):
    """Returns (green, reasons, record path, look path)."""
    env = os.environ if env is None else env
    rn = load('real_night_check_for_free', 'tools/real-night-check.py', root)
    record_dir = record_dir or rn.record_dir()
    kill_file = env.get('VP_RN_KILL_FILE') or DEFAULT_KILL_FILE
    b8dir = os.path.join(record_dir, build[:8])
    os.makedirs(b8dir, exist_ok=True)
    for old in ('shots', 'kogan'):
        shutil.rmtree(os.path.join(b8dir, old), ignore_errors=True)
    for old in ('LOOK.html', 'dryrun.txt', 'verify-live.txt'):
        if os.path.exists(os.path.join(b8dir, old)):
            os.remove(os.path.join(b8dir, old))
    look_rel = os.path.join(build[:8], 'LOOK.html')
    dr = {'green': False, 'why': 'not run', 'checks': 0, 'tree': '', 'head': '', 'files': 0, 'fails': [], 'shots_ok': False, 'shots_why': 'not run'}
    vl = {'green': False, 'why': 'not run', 'venues': 0, 'bad': []}
    kg = [(g, None, 'skipped (not run)') for _, g, _ in GAMES]
    reasons = []
    try:
        killed(kill_file)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            f1 = ex.submit(dry_run, root, b8dir, runner or remote_runner(root), fetch or remote_fetch(root),
                           int(env.get('VP_RN_DRYRUN_MINUTES') or 40) * 60, say)
            f2 = ex.submit(verify_live, b8dir, vl_runner or verify_live_runner(root), int(env.get('VP_RN_VERIFY_MINUTES') or 75) * 60, say) if verify else None
            dr = f1.result()
            if f2 is not None:
                vl = f2.result()
        killed(kill_file)
        if kogan:
            kg = kogan_shots(b8dir, tool_of(env), int(env.get('VP_RN_KOGAN_TIMEOUT') or 90), kill_file, kogan_run, say)
        else:
            kg = [(g, None, 'skipped (--no-kogan)') for _, g, _ in GAMES]
    except Stopped as s:
        reasons.append('stopped: %s' % s)
    except Exception as e:
        reasons.append('the step broke (%s: %s)' % (type(e).__name__, str(e)[:160]))
    if not dr['green']:
        reasons.append('(1) the dry run on the test server is not green: %s' % dr['why'])
    if not verify:
        reasons.append('(2) verify-live --all was skipped (--no-verify-live), so this is not a release record')
    elif not vl['green']:
        reasons.append('(2) verify-live --all is not green: %s' % vl['why'])
    if dr['green'] and not dr['shots_ok']:
        reasons.append('(1) the dry run shots did not come back: %s' % dr['shots_why'])
    path = write_record(record_dir, build, b8dir, dr, vl, kg, look_rel, vl_skipped=not verify)
    look = write_look(b8dir, build, dr, vl, kg, 'GREEN' if not reasons else 'RED', reasons)
    good, why, _ = rn.check(build, path)
    for w in why:
        if not any(w in r for r in reasons):
            reasons.append('the record: ' + w)
    green = not reasons
    look = write_look(b8dir, build, dr, vl, kg, 'GREEN' if green else 'RED', reasons)
    if not green and env.get('VP_RN_FAULTS', DEFAULT_FAULTS):
        try:
            write_fault(env.get('VP_RN_FAULTS', DEFAULT_FAULTS), build, reasons, look)
        except Exception:
            pass
    return green, reasons, path, look


def plan_lines(build, env=None):
    env = os.environ if env is None else env
    tool = tool_of(env)
    return ['(1) %s on vp-tests-1 against this tree (fast gate machinery: nonce + manifest), judged here' % SUITE,
            '(2) verify-live.py --all against LIVE, read-only, at the same time',
            '(3) the Kogan app shot once per game via %s (%ss cap each, informational, skipped if the TV is dark%s)'
            % (tool, env.get('VP_RN_KOGAN_TIMEOUT') or 90, '' if kogan_tool_present(tool) else '; the tool is NOT on this Mac'),
            'record: %s/%s.md + %s/LOOK.html' % (load('rn_plan', 'tools/real-night-check.py').record_dir(), build[:8], build[:8])]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument('--build', required=True)
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--no-verify-live', action='store_true')
    ap.add_argument('--no-kogan', action='store_true')
    a = ap.parse_args(argv)
    if not re.fullmatch(r'[0-9a-f]{8,40}', a.build):
        print('--build must be a commit id (8 to 40 hex characters)')
        return 2
    if a.plan:
        for l in plan_lines(a.build):
            print('  would run ' + l)
        return 0
    green, reasons, path, look = run_night(a.build, verify=not a.no_verify_live, kogan=not a.no_kogan)
    if green:
        print('REAL NIGHT (free) GREEN for %s: %s\n  look: %s' % (a.build[:8], path, look))
        return 0
    print('REAL NIGHT (free) NOT GREEN for %s (%s):' % (a.build[:8], path))
    for r in reasons:
        print('  - ' + r)
    print('  look: ' + look)
    return 1


if __name__ == '__main__':
    sys.exit(main())
