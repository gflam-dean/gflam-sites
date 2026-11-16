#!/usr/bin/env python3
"""TWO FAST RELEASE LANES: ROLL BACK IN ABOUT 10 MINUTES, SHIP A GAME FIX IN ABOUT 20 (Jobs 442, 16 Nov 2026).

Dean, 16 Nov 2026: "if there's an issue with the game, it should be rolled back straight away", and the same for
billing when he has not answered (memory game-fault-roll-back-straight-away.md). The full release (tools/release.py)
is two hours of gate plus a real night. These two lanes are what to reach for when a venue is waiting.

    python3 tools/release.py --rollback                       PLAN: back to the last release that passed AND was played live
    python3 tools/release.py --rollback --to <sha> --reason "why"   PLAN: a named commit (one not in the record needs --reason)
    python3 tools/release.py --urgent "<reason>"              PLAN: a GAME fix on HEAD, the short gate, then push
    ... add --go to either to do it. Without --go NOTHING is pushed, deployed or written to the repo.

Both print every step and log every line to ~/venue-enrich/reports/release-lanes/ (VP_LANES_LOG_DIR moves it).

THE RECORD OF LIVE-CHECKED RELEASES: tools/live-releases.json (tracked). release.py appends the commit that is live on
main after its step 6 (the real night) is green, commits it alone and pushes it; the pre-push hook lets a push through
without the gate when it changes nothing but that file and .verify-live.json (hook_accept, "bookkeeping"). The
rollback lane reads the record AS IT IS ON ORIGIN'S MAIN, never a local copy.

ROLLBACK (--rollback):
  R0. origin's main (ls-remote) is M; the record is read from M
  R1. the target: --to <sha>, or the newest recorded release older than the one M is (when M is recorded), or the
      newest recorded release (when M is not: a release that went out and never passed its checks). REFUSED when it is
      not an ancestor of M, when it is M, or when it is not in the record and --to/--reason were not both given
  R2. every migration added between the target and M is read: additive ones (create table, add a nullable column, an
      index, a policy, a data update) are fine and named; a breaking one (drop, rename, a column set NOT NULL or
      retyped, a NOT NULL column with no default, a revoke, a delete) REFUSES, because the older code would meet a
      database it does not know. --allow-migration <file> with --reason overrides one, by name
  R3. the rollback commit, built in a TEMPORARY worktree (the caller's checkout is never touched): M's files set back
      to the target's (git read-tree), then M's own copies kept of KEEP_PATHS (the migrations, which are live in the
      database whatever the code says; this record; the lane tools and the hook, so the push can be accepted). One
      commit on top of M, which reverts every commit in target..M. History is never rewritten
  R4. pushed BY SHA, never forced (release.push semantics: refused if M moved, refused unless the remote is the planned
      SHA after). The pre-push hook lets it through without the Chrome gate (hook_accept, "rollback") ONLY because every
      file in it is either the target's (gated, played live) or M's (gated): anything else and the hook runs its gate
  R5. every LIVE Worker whose file changed in target..M goes back up with deploy-worker.py --live
      --emergency="rollback to <target8>" (the ONLY place a lane uses --emergency), proved by /health
  R6. waits until Pages serves the target's copy of every served file that changed (30 min cap)
  R7. every LIVE Worker's /health answers the stamp in its file in the rollback commit (a Worker that changed: STOP if
      not; one that did not: a loud warning, it was already behind)
  R8. the live checks: release-check.py --live, then verify-live.py (read only, no --stamp). No Chrome re-gate: the
      target already passed one and was played live
  R9. one plain line, and a message for Dean in the log: what was rolled back, from what to what, why

URGENT FIX (--urgent "<reason>"), GAME FAULTS ONLY:
  U0. the reason is required; the tree is clean; HEAD is ahead of origin's main and contains it
  U1. REFUSED when any billing file changed: a path that names stripe/invoice/billing/receipt/payment/checkout/pricing/
      refund/overage/metering, or a hunk of a Worker (any *-backend/worker or lib .js) or of a served page that mentions
      money (MONEY_WORDS / PAGE_MONEY_WORDS). Billing goes through the full release, or the rollback lane
  U2. stamps, the regulated bingo code (regulated.py --check) and every new migration live (check-migrations-live.py)
  U3. the suites: every Chrome suite suite-impact.py says the change reaches (the branch's own changed suites, suites
      that name what it removes, suites that open the pages it changes), every Chrome suite that names a changed
      Worker, every money / sign-in / player-data suite (ALWAYS_RX), and the real-night dry run. MAC_ONLY suites are
      left out and named (gate-server.MAC_ONLY)
  U4. those suites on vp-tests-1 (remote-run.sh through gate-server's nonce + manifest), and at the same time the
      non-Chrome local gate here (release-check.py --local --skip-chrome). Both green: a record is SIGNED on this Mac
      with the gate key for this exact tree (URGENT_DIR, 60 min); the hook accepts the push on it ("urgent")
  U5. push by SHA; U6. Workers (deploy-worker.py --live, its own fast gate, no --emergency); U7. Pages served;
  U8. verify-live --stamp when a screen file changed (a bookkeeping push)
  U9. THE FULL GATE IN THE BACKGROUND (after-gate, in its own temporary worktree): gate-server.py run, release-check.py
      --chrome-record (live half included), the free real night. All green: the release is recorded as live-checked.
      Red: the rollback lane runs (--go) back to the last live-checked release, and a line goes to the build INBOX.
      A step that could not run at all (exit other than 0/1) never rolls back: it is written to the INBOX for a person.

WHAT THESE NEVER DO: force-push, rewrite history, touch Stripe or any customer's money (a billing rollback rolls back
CODE; charges are listed for Dean, never refunded or re-charged), run without --go, or use --emergency outside R5.

Tested without a network by tools/release-lanes.test.py (a bare git repo for GitHub, fake Workers and Pages).
"""
import hashlib, hmac, importlib.util, io, json, os, re, secrets, shutil, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
RECORD = 'tools/live-releases.json'
LANE_TOOLS = ('tools/release-lanes.py', 'tools/release-lanes.test.py', 'tools/release.py', 'tools/hooks/pre-push')
BOOKKEEPING = (RECORD, '.verify-live.json')
MIG_RX = re.compile(r'^(venueplay|partyplay|touring)-backend/(supabase/)?[^/]+\.sql$')
LOG_DIR = os.environ.get('VP_LANES_LOG_DIR') or os.path.expanduser('~/venue-enrich/reports/release-lanes')
URGENT_DIR = os.path.join(LOG_DIR, 'urgent-records')
FAULTS = os.environ.get('VP_LANES_FAULTS') or os.path.expanduser('~/venue-enrich/builds/INBOX.md')
URGENT_MAX_AGE_S = 60 * 60
URGENT_VERSION = 1
DRY_RUN_SUITE = 'real-night-dryrun-in-chrome.test.py'

# Money, sign-in and player data: always run by the urgent lane, whatever the change reaches.
ALWAYS_RX = re.compile(r'^(?!touring-)(.*(billing|subscribe|trial|cancelled-account|paid|purchase|offer-free-play|offer-ended|'
                       r'try-demo|signup|signin|sign-in|welcome|wizard|consent|details|optin|members|player|account|'
                       r'session-lifecycle|one-phone|rejoin|join))')
BILLING_PATH_RX = re.compile(r'(stripe|invoice|billing|receipt|payment|checkout|pricing|refund|overage|metering)', re.I)
WORKER_CODE_RX = re.compile(r'^(venueplay|partyplay|touring)-backend/(worker|lib)/[^/]+\.js$')
MONEY_WORDS = re.compile(r'(stripe|invoice|billing|\bcharge|refund|subscription|receipt|payment|checkout|overage|metering|'
                         r'prorat|pro-rata|\bgst\b|discount|\bprice)', re.I)
PAGE_MONEY_WORDS = re.compile(r'(stripe|invoice|billing|checkout|subscription|refund)', re.I)

# Migration statements an OLDER build cannot live with (R2). Read on SQL with comments and literals blanked.
BREAKING = [
    ('drops a table, view, function, type or schema', r'\bdrop\s+(table|view|materialized\s+view|function|type|schema)\b'),
    ('drops a column', r'\bdrop\s+column\b'),
    ('renames something', r'\brename\b'),
    ('retypes a column', r'\balter\s+column\s+[\w"]+\s+(set\s+data\s+)?type\b'),
    ('sets a column NOT NULL', r'\bset\s+not\s+null\b'),
    ('drops a default', r'\bdrop\s+default\b'),
]
# A revoke or delete is breaking only on something the migration did not create itself (locking a new table, or
# emptying its own backup table, is how every careful migration here ends).
ON_OLD = [('takes a grant away', re.compile(r'\brevoke\b[^;]*?\bon\s+(?:table\s+|function\s+|sequence\s+)?([\w."]+)')),
          ('deletes rows', re.compile(r'(?:^|;)\s*(?:delete\s+from|truncate(?:\s+table)?)\s+([\w."]+)'))]
CREATES = re.compile(r'\bcreate\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view|function|sequence)\s+(?:if\s+not\s+exists\s+)?([\w."]+)')
NOT_FORWARD = re.compile(r'^(PRECHECK|CHECK|ROLLBACK)-')
ADD_NOT_NULL = re.compile(r'\badd\s+column\s+(if\s+not\s+exists\s+)?[\w"]+\s+[^,;]*?\bnot\s+null\b[^,;]*', re.I)
GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'


def load(name, rel, root=ROOT):
    spec = importlib.util.spec_from_file_location(name, os.path.join(root, rel))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Stop(Exception):
    """A lane step that is not true. The lane stops there; nothing after it runs."""


# ------------------------------------------------------------------------------------------------ the log

class Log:
    def __init__(self, lane, plan, out=None, path=None):
        self.out = out if out is not None else sys.stdout
        if path is None:
            os.makedirs(LOG_DIR, exist_ok=True)
            path = os.path.join(LOG_DIR, '%s-%s%s.log' % (lane, time.strftime('%Y%m%d-%H%M%S'), '-plan' if plan else ''))
        self.path = path
        self.fh = io.open(path, 'a', encoding='utf-8') if path else None

    def __call__(self, line=''):
        self.out.write(line + '\n')
        self.out.flush()
        if self.fh:
            self.fh.write(re.sub(r'\x1b\[[0-9;]*m', '', line) + '\n')
            self.fh.flush()


# ------------------------------------------------------------------------------------------------ the real world

class Ops:
    """Everything a lane does to the world, in one place, so the suite can stand a fake in for each."""

    def __init__(self, root=ROOT):
        self.root = root

    def env(self):
        return {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}

    def git(self, cwd, *args):
        if 'push' in args and any(a in ('-f', '--force', '--force-with-lease', '--mirror') or a.startswith(('+', '--force'))
                                  for a in args):
            raise Stop('a force push was asked for (%s). The lanes never force-push.' % ' '.join(args))
        return subprocess.run(['git'] + list(args), cwd=cwd, capture_output=True, text=True, env=self.env())

    def run(self, argv, cwd, say, env=None):
        """Run a tool, streaming its output into the log. Returns its exit code."""
        p = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                             env=dict(self.env(), **(env or {})))
        for line in p.stdout:
            say('    ' + line.rstrip('\n'))
        return p.wait()

    def remote_main(self, cwd):
        r = self.git(cwd, 'ls-remote', 'origin', 'refs/heads/main')
        return r.stdout.split()[0] if r.returncode == 0 and r.stdout.split() else ''

    def health(self, worker):
        dw = load('deploy_worker_for_lanes', 'tools/deploy-worker.py', self.root)
        return dw.fetch_health(worker)

    def stale_pages(self, root, files):
        rc = _release_check(root)
        return [f for f in files if rc.live_matches_local(f) is False]

    def server_suites(self, root, suites, say):
        """(green, why, results, tree): the suites on vp-tests-1 through gate-server's own machinery."""
        gs = load('gate_server_for_lanes', 'tools/gate-server.py', root)
        tree, head, dirty = gs.current_tree(root)
        if not tree:
            return False, 'the checkout is dirty: ' + dirty[:200], {}, ''
        digest, paths = gs.manifest(root)
        nonce = secrets.token_hex(16)
        results, red, run = gs.collect(root, gs.remote_runner(root), suites, nonce, paths, say=say)
        tree2, _, _ = gs.current_tree(root)
        if tree2 != tree:
            return False, 'the checkout changed while the suites ran', results, tree
        why = gs.run_bound(run, nonce, digest)
        if why:
            return False, why, results, tree
        if red:
            return False, '%d suite(s) red on the server: %s' % (len(red), ', '.join(red[:6])), results, tree
        return True, '', results, tree

    def key(self):
        gs = load('gate_server_for_lanes_key', 'tools/gate-server.py', self.root)
        return gs.read_key()

    def spawn(self, argv, cwd, log_path):
        fh = io.open(log_path, 'a', encoding='utf-8')
        p = subprocess.Popen(argv, cwd=cwd, stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             start_new_session=True, env=self.env())
        return p.pid

    def sleep(self, s):
        time.sleep(s)

    def now(self):
        return time.time()


def _release_check(root):
    """release-check.py of `root` as a module, the way release.py's step 3 loads it (its ROOT is that tree)."""
    spec = importlib.util.spec_from_file_location('rc_for_lanes', os.path.join(root, 'tools', 'release-check.py'))
    rc = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = ['release-check.py', '--local']
    try:
        spec.loader.exec_module(rc)
    except SystemExit:
        pass
    finally:
        sys.argv = saved
    return rc


def _release(root=ROOT):
    return load('release_for_lanes', 'tools/release.py', root)


# ------------------------------------------------------------------------------------------------ git helpers

def git_ok(ops, cwd, *args):
    r = ops.git(cwd, *args)
    if r.returncode != 0:
        raise Stop('git %s failed: %s' % (' '.join(args[:4]), (r.stderr or r.stdout).strip()[:300]))
    return r.stdout


def tree_of(ops, cwd, sha):
    r = ops.git(cwd, 'rev-parse', sha + '^{tree}')
    return r.stdout.strip() if r.returncode == 0 else ''


def is_ancestor(ops, cwd, a, b):
    return ops.git(cwd, 'merge-base', '--is-ancestor', a, b).returncode == 0


def changed_between(ops, cwd, a, b):
    return [l for l in git_ok(ops, cwd, 'diff', '--name-only', '--no-renames', a, b).split('\n') if l]


def blob(ops, cwd, sha, path):
    r = ops.git(cwd, 'rev-parse', '%s:%s' % (sha, path))
    return r.stdout.strip() if r.returncode == 0 else ''


def show(ops, cwd, sha, path):
    r = ops.git(cwd, 'show', '%s:%s' % (sha, path))
    return r.stdout if r.returncode == 0 else None


def is_keep(path):
    return path in (RECORD,) + LANE_TOOLS or bool(MIG_RX.match(path))


# ------------------------------------------------------------------------------------------------ the record

def read_record(text):
    """[{sha, when, lane, ...}] in the order they were written. A missing or unreadable record is empty."""
    try:
        d = json.loads(text or '')
    except Exception:
        return []
    rel = d.get('releases') if isinstance(d, dict) else None
    return [r for r in rel if isinstance(r, dict) and re.fullmatch(r'[0-9a-f]{40}', str(r.get('sha', '')))] if isinstance(rel, list) else []


def record_text(entries):
    return json.dumps({'about': 'Releases that passed the full gate AND a real night, newest last. Written by '
                                'tools/release.py (and the urgent lane\'s after-gate) through tools/release-lanes.py; read '
                                'by the rollback lane from origin\'s main. Never edit by hand.',
                       'releases': entries}, indent=1) + '\n'


def same_as(ops, cwd, a, b):
    """Do commits a and b carry the same files, KEEP_PATHS aside? (A rollback commit is its target; a record commit
    is the release it records.)"""
    return all(is_keep(p) for p in changed_between(ops, cwd, a, b))


def pick_target(ops, cwd, main, entries, to=None):
    """(target sha, why it was picked, in_record). Raises Stop when there is no target."""
    known = [e['sha'] for e in entries if ops.git(cwd, 'cat-file', '-e', e['sha'] + '^{commit}').returncode == 0]
    if to:
        full = ops.git(cwd, 'rev-parse', '--verify', to + '^{commit}').stdout.strip()
        if not full:
            raise Stop('--to %s is not a commit in this clone (git fetch first)' % to)
        return full, 'named with --to', full in known
    current = None
    for i in range(len(known) - 1, -1, -1):
        if is_ancestor(ops, cwd, known[i], main) and same_as(ops, cwd, known[i], main):
            current = i
            break
    pool = known[:current] if current is not None else known
    for sha in reversed(pool):
        if sha == main or not is_ancestor(ops, cwd, sha, main):
            continue
        if current is not None and same_as(ops, cwd, sha, known[current]):
            continue
        why = ('the live-checked release before the one on main (%s)' % known[current][:8]) if current is not None else \
              'the newest live-checked release (what is on main, %s, never passed its checks)' % main[:8]
        return sha, why, True
    raise Stop('no live-checked release to go back to in %s on main (%d recorded). Name one with --to <sha> --reason "why".'
               % (RECORD, len(entries)))


# ------------------------------------------------------------------------------------------------ migrations (R2)

def _strip_sql(sql):
    try:
        return load('cml_for_lanes', 'tools/check-migrations-live.py')._strip(sql)
    except Exception:
        return re.sub(r'--[^\n]*', '', sql)


def classify_migration(sql):
    """(breaking reasons, notes). Empty reasons = an older build runs on the database after it."""
    if re.search(r'^\s*--\s*rollback-safe:\s*\S', sql, re.M | re.I):
        return [], ['marked "-- rollback-safe:" by its author']
    s = _strip_sql(sql).lower()
    reasons = [what for what, rx in BREAKING if re.search(rx, s)]
    base = lambda n: n.replace('"', '').split('.')[-1]
    made_here = {base(n) for n in CREATES.findall(s)}
    # a function body ($$ ... $$) runs when it is called, not when the migration runs: its deletes are not the migration's
    top = re.sub(r'\$(\w*)\$.*?\$\1\$', ' ', s, flags=re.S)
    for what, rx in ON_OLD:
        old = sorted({base(n) for n in rx.findall(top if what == 'deletes rows' else s)} - made_here)
        if old:
            reasons.append('%s (%s)' % (what, ', '.join(old)[:80]))
    # "drop policy X" followed by "create policy X" is a replacement, not a removal
    if re.search(r'\bdrop\s+policy\b', s):
        dropped = set(re.findall(r'\bdrop\s+policy\s+(?:if\s+exists\s+)?"?([\w ]+?)"?\s+on\b', s))
        made = set(re.findall(r'\bcreate\s+policy\s+"?([\w ]+?)"?\s+on\b', s))
        if dropped - made:
            reasons.append('drops a policy it does not re-create (%s)' % ', '.join(sorted(dropped - made))[:80])
    for m in ADD_NOT_NULL.finditer(s):
        if 'default' not in m.group(0):
            reasons.append('adds a NOT NULL column with no default (an older build\'s inserts would fail)')
            break
    notes = []
    if re.search(r'\bcreate\s+or\s+replace\s+function\b', s):
        notes.append('replaces a function body (the older build calls the new one)')
    if re.search(r'\b(update\s+[\w."]+\s+set|insert\s+into)\b', s):
        notes.append('changes rows')
    return reasons, notes


def migrations_between(ops, cwd, target, main, allow=()):
    """(fine [(file, notes)], breaking [(file, reasons)]) for every migration file added after target up to main."""
    names = [l for l in git_ok(ops, cwd, 'diff', '--name-only', '--no-renames', '--diff-filter=AM', target, main).split('\n')
             if l and MIG_RX.match(l)]
    fine, bad = [], []
    for n in sorted(names):
        if NOT_FORWARD.match(os.path.basename(n)):
            fine.append((n, ['a %s script, not a forward migration: not read' % NOT_FORWARD.match(os.path.basename(n)).group(1)]))
            continue
        reasons, notes = classify_migration(show(ops, cwd, main, n) or '')
        if reasons and (os.path.basename(n) in allow or n in allow):
            fine.append((n, ['ALLOWED by --allow-migration despite: ' + '; '.join(reasons)]))
        elif reasons:
            bad.append((n, reasons))
        else:
            fine.append((n, notes or ['additive']))
    return fine, bad


# ------------------------------------------------------------------------------------------------ billing (U1)

def billing_hits(ops, cwd, base, head):
    """Why this change touches money, one line per reason; empty when it does not."""
    hits = []
    for f in changed_between(ops, cwd, base, head):
        if BILLING_PATH_RX.search(f):
            hits.append('%s (a billing file by its name)' % f)
            continue
        words = MONEY_WORDS if WORKER_CODE_RX.match(f) else PAGE_MONEY_WORDS if f.startswith(('venueplay/', 'partyplay/')) else None
        if words is None or f.endswith(('.test.js', '.test.py')):
            continue
        diff = git_ok(ops, cwd, 'diff', '-U6', '--no-renames', base, head, '--', f)
        for hunk in re.split(r'(?m)^@@', diff)[1:]:
            m = words.search(hunk)
            if m:
                hits.append('%s, the hunk at @@%s mentions "%s"' % (f, hunk.split('\n', 1)[0][:70], m.group(0)))
                break
    return hits


# ------------------------------------------------------------------------------------------------ urgent suites (U3)

def urgent_suites(ops, cwd, base, head, chrome, mac_only, impact, naming):
    """(suites to run on the server, why each, left out). chrome: every Chrome suite basename. impact(base, head) ->
    Chrome suite paths suite-impact reaches. naming(worker file) -> suite paths that name it."""
    why = {}
    for s in impact(base, head):
        why.setdefault(os.path.basename(s), 'suite-impact: the change reaches it')
    for f in changed_between(ops, cwd, base, head):
        if WORKER_CODE_RX.match(f):
            for s in naming(f):
                why.setdefault(os.path.basename(s), 'names %s' % os.path.basename(f))
    for s in chrome:
        if ALWAYS_RX.search(s):
            why.setdefault(s, 'money, sign-in or player data')
    why[DRY_RUN_SUITE] = 'the real-night dry run'
    run = sorted(s for s in why if s in chrome and s not in mac_only)
    left = sorted(s for s in why if s in mac_only)
    return run, why, left


# ------------------------------------------------------------------------------------------------ the urgent record

def _canon(body):
    return json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def sign_urgent(body, key):
    body = {k: v for k, v in body.items() if k != 'sig'}
    out = dict(body)
    out['sig'] = hmac.new(key, _canon(body), hashlib.sha256).hexdigest()
    return out


def verify_urgent(raw, tree, key, now, accepted_suite):
    """'' when a signed urgent record covers this exact tree, else why not. accepted_suite(name, entry) -> '' or why."""
    try:
        rec = json.loads(raw or '')
    except Exception:
        return 'no readable urgent record for this tree'
    if not isinstance(rec, dict) or key is None:
        return 'no urgent record, or no key to check it with'
    sig = rec.get('sig')
    body = {k: v for k, v in rec.items() if k != 'sig'}
    if not isinstance(sig, str) or not hmac.compare_digest(hmac.new(key, _canon(body), hashlib.sha256).hexdigest(), sig):
        return 'the urgent record is not signed by this Mac\'s key, or was edited after it was signed'
    if rec.get('v') != URGENT_VERSION or rec.get('lane') != 'urgent':
        return 'not an urgent record of this version'
    if rec.get('tree') != tree:
        return 'the urgent record is for another tree'
    t = rec.get('time')
    if not isinstance(t, (int, float)) or t > now + 60 or now - t >= URGENT_MAX_AGE_S:
        return 'the urgent record is stale or dated in the future'
    if rec.get('local_gate') != 'green':
        return 'the non-Chrome local gate was not green'
    suites = rec.get('suites')
    if not isinstance(suites, dict) or DRY_RUN_SUITE not in suites:
        return 'the urgent record has no real-night dry run'
    for s, e in suites.items():
        w = accepted_suite(s, e)
        if w:
            return '%s is not green in the urgent record: %s' % (s, w)
    return ''


def urgent_record_path(tree):
    return os.path.join(URGENT_DIR, tree + '.json')


# ------------------------------------------------------------------------------------------------ the hook (R4/U5)

def hook_accept(ops, cwd, pushed, remote, key=None, accepted_suite=None, now=None):
    """(accepted, why). The pre-push hook asks this before its gate. Accepted ONLY when every file in the push has
    already been through a gate:
      bookkeeping  the push changes nothing but the record and .verify-live.json on top of what is on main
      rollback     every file is a live-checked release's, or (KEEP_PATHS) exactly what is on main now
      urgent       a record signed on this Mac says the urgent lane gated this exact tree under an hour ago
    Anything else: not accepted, and the hook runs its gate as it always has."""
    if not re.fullmatch(r'[0-9a-f]{40}', pushed or '') or not re.fullmatch(r'[0-9a-f]{40}', remote or '') or set(remote) == {'0'}:
        return False, 'not a push to an existing main'
    if not is_ancestor(ops, cwd, remote, pushed):
        return False, 'the push does not contain what is on main'
    diff = changed_between(ops, cwd, remote, pushed)
    if diff and all(p in BOOKKEEPING for p in diff):
        return True, 'bookkeeping only (%s): nothing that runs changed' % ', '.join(diff)
    entries = read_record(show(ops, cwd, remote, RECORD))
    for e in reversed(entries):
        sha = e['sha']
        if ops.git(cwd, 'cat-file', '-e', sha + '^{commit}').returncode != 0 or not is_ancestor(ops, cwd, sha, remote):
            continue
        other = changed_between(ops, cwd, sha, pushed)
        if all(is_keep(p) and blob(ops, cwd, pushed, p) == blob(ops, cwd, remote, p) for p in other):
            return True, ('rollback to %s, a release that passed the full gate and a real night; every other file is '
                          'what is on main now (%d kept)' % (sha[:8], len(other)))
    if key is not None and accepted_suite is not None:
        tree = tree_of(ops, cwd, pushed)
        p = urgent_record_path(tree)
        raw = io.open(p, encoding='utf-8').read() if os.path.isfile(p) else None
        why = verify_urgent(raw, tree, key, ops.now() if now is None else now, accepted_suite)
        if not why:
            return True, 'urgent lane: this exact tree passed the urgent gate (signed record)'
        return False, why
    return False, 'no lane covers this push'


# ------------------------------------------------------------------------------------------------ shared steps

def wait_pages(ops, root, files, say, cap_s=30 * 60, every_s=30):
    if not files:
        say('  nothing served changed')
        return
    t0 = ops.now()
    while True:
        stale = ops.stale_pages(root, files)
        if not stale:
            say('  Pages serves all %d file(s), after %d s' % (len(files), ops.now() - t0))
            return
        if ops.now() - t0 > cap_s:
            raise Stop('Pages still serves the old copy after %d min of: %s' % (cap_s // 60, ', '.join(stale[:4])))
        say('  %s... %d still on the other build, e.g. %s%s' % (DIM, len(stale), stale[0], OFF))
        ops.sleep(every_s)


def stamp_in(text):
    m = re.search(r"^const BUILD = '(?:.*· )?([0-9a-f]{8})';", text or '', re.M)
    return m.group(1) if m else ''


def push_sha(ops, cwd, sha, expected_remote, what, say):
    """release.push_exactly's rules, for a commit that may live in another worktree: refuse if main moved, push the SHA
    by name (never forced), refuse unless main is that SHA after."""
    now = ops.remote_main(cwd)
    if now != expected_remote:
        raise Stop('origin/main moved (%s, expected %s): someone else pushed. Nothing was pushed.' % (now[:8], expected_remote[:8]))
    r = ops.git(cwd, 'push', 'origin', sha + ':refs/heads/main')
    if r.returncode != 0:
        say('    ' + (r.stderr or '').strip()[-600:])
        raise Stop('the %s was refused (above). Do not bypass the hook.' % what)
    landed = ops.remote_main(cwd)
    if landed != sha:
        raise Stop('origin/main is %s after the %s, not the planned %s' % (landed[:8] or 'unreadable', what, sha[:8]))
    say('  origin/main is %s, as planned' % sha[:8])


def served_of(files):
    return [f for f in files if f.startswith(('venueplay/', 'partyplay/')) and f.endswith(('.html', '.js'))
            and '/emails/' not in f and not f.endswith('.test.js')]


def alert(text, say):
    """One line to the build session's INBOX (the place real-night-free writes its reds). Never sends anything."""
    try:
        with io.open(FAULTS, 'a', encoding='utf-8') as fh:
            fh.write('\n- %s RELEASE LANE: %s\n' % (time.strftime('%Y-%m-%d %H:%M'), text))
        say('  written to ' + FAULTS)
    except Exception as e:
        say('  could not write to %s (%s); tell Dean: %s' % (FAULTS, type(e).__name__, text))


# ------------------------------------------------------------------------------------------------ ROLLBACK

def rollback(ops, say, go=False, to=None, reason='', allow=(), root=ROOT, workers=None):
    """The rollback lane. Returns 0 done (or planned), 1 stopped. Never force-pushes, never rewrites history."""
    workers = workers if workers is not None else _release().LIVE_WORKERS
    say('%sROLLBACK LANE%s %s' % (YEL, OFF, '(GO)' if go else '(PLAN: nothing is pushed or deployed; add --go)'))
    wt = None
    try:
        say('\nR0. what is on main, and the record of live-checked releases on it')
        main = ops.remote_main(root)
        if not main:
            raise Stop('could not read origin/main (git ls-remote). Nothing was done.')
        git_ok(ops, root, 'fetch', '-q', 'origin', 'main')
        entries = read_record(show(ops, root, main, RECORD))
        say('  origin/main is %s; %s on it lists %d live-checked release(s)' % (main[:8], RECORD, len(entries)))

        say('\nR1. the target')
        target, why, recorded = pick_target(ops, root, main, entries, to)
        if target == main:
            raise Stop('the target %s is what is on main already' % target[:8])
        if not is_ancestor(ops, root, target, main):
            raise Stop('the target %s is not an ancestor of main %s: a rollback only goes back' % (target[:8], main[:8]))
        if not recorded:
            if not (to and reason.strip()):
                raise Stop('%s is not in %s (it never passed the full gate AND a real night). Roll back to it only with '
                           '--to %s --reason "why".' % (target[:8], RECORD, target[:8]))
            say('  %sNOT a live-checked release; allowed by --to with the reason: %s%s' % (YEL, reason, OFF))
        commits = [l for l in git_ok(ops, root, 'rev-list', '--first-parent', '%s..%s' % (target, main)).split('\n') if l]
        say('  %s (%s): %d commit(s) on main after it' % (target[:8], why, len(commits)))
        for c in commits[:12]:
            say('    ' + git_ok(ops, root, 'log', '-1', '--format=%h %s', c).strip()[:110])

        say('\nR2. database changes since the target (the database is NOT rolled back)')
        fine, bad = migrations_between(ops, root, target, main, allow if reason.strip() else ())
        for n, notes in fine:
            say('  fine: %s (%s)' % (n, '; '.join(notes)))
        if not fine and not bad:
            say('  none')
        if bad:
            for n, reasons in bad:
                say('  %sBREAKS THE OLDER CODE: %s: %s%s' % (RED, n, '; '.join(reasons), OFF))
            raise Stop('a migration since %s would break the older code (above). Pick a later target, or after reading it '
                       'pass --allow-migration <file> with --reason.' % target[:8])

        changed = changed_between(ops, root, target, main)
        back = [f for f in changed if not is_keep(f)]
        wk = [f for f in back if f in workers]
        served = served_of(back)
        say('\nR3. the rollback commit: %d file(s) back to %s, kept as on main: %s'
            % (len(back), target[:8], ', '.join(sorted(f for f in changed if is_keep(f))) or 'nothing'))
        say('  Workers to put back: %s' % (', '.join('%s -> %s' % (f, workers[f]) for f in wk) or 'none'))
        say('  served files Pages must serve again: %d' % len(served))
        if not go:
            for line in ('R4. push it by SHA (never forced); ' + ('the hook accepts it as a rollback without the Chrome gate' if recorded
                         else 'the hook runs its FULL gate: the target is not live-checked, so nothing vouches for its files'),
                         'R5. deploy-worker.py --live --emergency="rollback to %s" for each Worker above' % target[:8],
                         'R6. wait until Pages serves the target\'s copy of each served file (30 min cap)',
                         'R7. every LIVE Worker\'s /health answers its stamp in the rollback commit',
                         'R8. release-check.py --live, then verify-live.py (read only)',
                         'R9. a message for Dean in the log'):
                say('  would ' + line)
            say('\n%sPLAN ONLY. Nothing was pushed or deployed.%s Log: %s' % (DIM, OFF, getattr(say, 'path', '')))
            return 0

        wt = tempfile.mkdtemp(prefix='vp-rollback-')
        git_ok(ops, root, 'worktree', 'add', '-q', '--detach', wt, main)
        git_ok(ops, wt, 'read-tree', '-u', '--reset', target)
        for f in changed:
            if is_keep(f):
                if blob(ops, wt, main, f):
                    git_ok(ops, wt, 'checkout', main, '--', f)
                else:
                    git_ok(ops, wt, 'rm', '-q', '--cached', '--ignore-unmatch', '--', f)
                    p = os.path.join(wt, f)
                    if os.path.isfile(p):
                        os.remove(p)
        msg = ('Rollback to %s: %s\n\nReverts %d commit(s), %s..%s, as one commit: every file back to %s except the '
               'migrations (live in the database), %s and the release lanes. Made by tools/release.py --rollback.\n\n'
               'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
               'Claude-Session: https://claude.ai/code/session_01Y8oH1QFku5kfGVCtv2QKLs'
               % (target[:8], reason.strip() or why, len(commits), target[:8], main[:8], target[:8], RECORD))
        git_ok(ops, wt, 'commit', '-q', '--allow-empty', '-m', msg)
        rb = git_ok(ops, wt, 'rev-parse', 'HEAD').strip()
        say('  made %s on top of %s' % (rb[:8], main[:8]))

        say('\nR4. push %s to main by SHA' % rb[:8])
        push_sha(ops, wt, rb, main, 'rollback push', say)

        say('\nR5. put the Workers back')
        if not wk:
            say('  none changed')
        for f in wk:
            rc = ops.run([PY, 'tools/deploy-worker.py', '--live', '--emergency=rollback to %s' % target[:8], workers[f], f], wt, say)
            if rc != 0:
                raise Stop('%s did not go back up (exit %s). Pages are rolling back; the Worker is not. Tell Dean now.' % (f, rc))

        say('\nR6. wait until Pages serves the target\'s files')
        wait_pages(ops, wt, [f for f in served if os.path.isfile(os.path.join(wt, f))], say)

        say('\nR7. every LIVE Worker answers the stamp in the rollback commit')
        for f, name in sorted(workers.items(), key=lambda kv: kv[1]):
            want = stamp_in(show(ops, wt, rb, f))
            if not want:
                continue
            got = ops.health(name)
            if want in (got or ''):
                say('  %s: %s' % (name, got))
            elif f in wk:
                raise Stop('%s answers %r, not %s, after its rollback deploy' % (name, got, want))
            else:
                say('  %sWARNING %s answers %r, not %s, and did not change in this rollback: it was already behind%s'
                    % (YEL, name, got, want, OFF))

        say('\nR8. the live checks (no Chrome re-gate: %s passed one and was played live)' % target[:8])
        red = []
        for argv in ([PY, 'tools/release-check.py', '--live'], [PY, 'tools/verify-live.py']):
            rc = ops.run(argv, wt, say)
            if rc != 0:
                red.append('%s exit %s' % (os.path.basename(argv[1]), rc))
        msg = ('Rolled back main to %s (%s), from %s, by %s. Reason: %s. %d commit(s) undone; Workers put back: %s. '
               'Fix next morning with the full checks.' % (target[:8], why, main[:8], rb[:8], reason.strip() or 'not given',
                                                         len(commits), ', '.join(workers[f] for f in wk) or 'none'))
        say('\nR9. FOR DEAN: ' + msg)
        if red:
            alert('ROLLED BACK but the live checks are red (%s). %s' % ('; '.join(red), msg), say)
            say('\n%sROLLED BACK to %s, but the live checks are red: %s. Tell Dean now.%s' % (RED, target[:8], '; '.join(red), OFF))
            return 1
        alert(msg, say)
        say('\n%sROLLED BACK and checked live: main is %s (the files of %s)%s' % (GRN, rb[:8], target[:8], OFF))
        return 0
    except Stop as e:
        say('\n%sROLLBACK STOPPED.%s %s' % (RED, OFF, e))
        return 1
    finally:
        if wt:
            ops.git(root, 'worktree', 'remove', '--force', wt)
            shutil.rmtree(wt, ignore_errors=True)


# ------------------------------------------------------------------------------------------------ URGENT FIX

def urgent(ops, say, reason, go=False, root=ROOT, workers=None, chrome=None, mac_only=None, impact=None, naming=None,
           accepted_suite=None):
    """The urgent-fix lane. Returns 0 pushed (or planned), 1 stopped."""
    if workers is None or chrome is None or mac_only is None or impact is None or naming is None or accepted_suite is None:
        gs = load('gate_server_for_urgent', 'tools/gate-server.py')
        workers = _release().LIVE_WORKERS if workers is None else workers
        chrome = gs.chrome_suites(ROOT) if chrome is None else chrome
        mac_only = gs.MAC_ONLY if mac_only is None else mac_only
        if accepted_suite is None:
            counts, rule = gs.ledger(ROOT), gs.suite_passed_rule(ROOT)
            accepted_suite = lambda s, e: gs.suite_accepted(s, e, counts.get('tools/' + s), rule)
        if impact is None:
            si = load('suite_impact_for_urgent', 'tools/suite-impact.py')
            impact = lambda b, h: si.reached_chrome_suites(b, h)
        if naming is None:
            dw = load('deploy_worker_for_urgent', 'tools/deploy-worker.py')
            gl = load('gatelib_for_urgent', 'tools/gatelib.py')
            naming = lambda f: [s for s in dw.suites_naming(os.path.basename(f), '') if gl.uses_chrome(os.path.join(ROOT, s))]
    say('%sURGENT-FIX LANE%s %s' % (YEL, OFF, '(GO)' if go else '(PLAN: nothing is pushed or deployed; add --go)'))
    try:
        say('\nU0. the reason, a clean tree, and HEAD on top of main')
        if not (reason or '').strip():
            raise Stop('--urgent needs the reason in words: --urgent "what is broken in the game"')
        say('  reason: ' + reason.strip())
        dirty = ops.git(root, 'status', '--porcelain', '--', 'venueplay', 'partyplay', 'venueplay-backend',
                        'partyplay-backend', 'touring-backend', 'tools').stdout.strip()
        if dirty:
            raise Stop('uncommitted changes would not be in the push:\n' + dirty[:400])
        main = ops.remote_main(root)
        if not main:
            raise Stop('could not read origin/main (git ls-remote)')
        git_ok(ops, root, 'fetch', '-q', 'origin', 'main')
        head = git_ok(ops, root, 'rev-parse', 'HEAD').strip()
        if head == main or not is_ancestor(ops, root, main, head):
            raise Stop('HEAD %s is not ahead of origin/main %s: rebase the fix on main first' % (head[:8], main[:8]))
        changed = changed_between(ops, root, main, head)
        say('  %s on top of %s: %d file(s) changed' % (head[:8], main[:8], len(changed)))

        say('\nU1. no billing file in it (game faults only)')
        hits = billing_hits(ops, root, main, head)
        if hits:
            for h in hits[:12]:
                say('  %sBILLING: %s%s' % (RED, h, OFF))
            raise Stop('this change touches billing (above). The urgent lane is for GAME faults only: use the full '
                       'release (python3 tools/release.py), or the rollback lane.')
        say('  none')

        say('\nU2. stamps, the regulated bingo code, and every new migration live')
        for argv, why in (([PY, 'tools/stamp-workers.py', '--check'], 'a Worker changed without being restamped'),
                          ([PY, 'tools/regulated.py', '--check'], 'the regulated bingo code does not match its manifest'),
                          ([PY, 'tools/check-migrations-live.py', '--base', main], 'a migration in it is not live yet')):
            if not go:
                say('  would run ' + ' '.join(argv[1:]))
                continue
            if ops.run(argv, root, say) != 0:
                raise Stop(why + ' (above)')

        say('\nU3. the suites')
        suites, why, left = urgent_suites(ops, root, main, head, chrome, mac_only, impact, naming)
        for s in suites:
            say('  %-58s %s' % (s, why[s]))
        for s in left:
            say('  %sleft out (MAC_ONLY, runs in the after-gate): %s%s' % (DIM, s, OFF))
        wk = [f for f in changed if f in workers]
        served = served_of(changed)
        if not go:
            for line in ('U4. those %d suites on vp-tests-1, 4 at a time, with release-check.py --local --skip-chrome here; '
                         'both green = a signed urgent record for this tree' % len(suites),
                         'U5. push %s by SHA; the hook accepts it on the urgent record' % head[:8],
                         'U6. deploy %s (deploy-worker.py --live, no --emergency)' % (', '.join(workers[f] for f in wk) or 'no Worker'),
                         'U7. wait until Pages serves %d changed file(s)' % len(served),
                         'U8. verify-live --stamp if a screen file changed',
                         'U9. the full gate in the background (gate-server run, release-check.py --chrome-record, the free '
                         'real night); red = the rollback lane, --go, back to the last live-checked release'):
                say('  would ' + line)
            say('\n%sPLAN ONLY. Nothing was pushed or deployed.%s Log: %s' % (DIM, OFF, getattr(say, 'path', '')))
            return 0

        say('\nU4. the suites on vp-tests-1 and the non-Chrome local gate here, at the same time')
        local = {}

        def local_gate():
            local['rc'] = ops.run([PY, 'tools/release-check.py', '--local', '--skip-chrome'], root, say)
        th = threading.Thread(target=local_gate)
        th.start()
        green, why_red, results, tree = ops.server_suites(root, suites, say)
        th.join()
        if local.get('rc') != 0:
            raise Stop('the non-Chrome local gate is red (exit %s, above). Nothing was pushed.' % local.get('rc'))
        if not green:
            raise Stop('the suites are not green on vp-tests-1: %s. Nothing was pushed.' % why_red)
        if tree != tree_of(ops, root, head):
            raise Stop('the server judged tree %s, HEAD is tree %s' % (tree[:12], tree_of(ops, root, head)[:12]))
        key, kwhy = ops.key()
        if key is None:
            raise Stop('no gate key to sign the urgent record with: ' + kwhy)
        rec = sign_urgent({'v': URGENT_VERSION, 'lane': 'urgent', 'tree': tree, 'head': head, 'time': ops.now(),
                           'when': time.strftime('%Y-%m-%d %H:%M:%S'), 'reason': reason.strip(), 'local_gate': 'green',
                           'suites': results}, key)
        os.makedirs(URGENT_DIR, mode=0o700, exist_ok=True)
        with io.open(urgent_record_path(tree), 'w', encoding='utf-8') as fh:
            json.dump(rec, fh, indent=1, sort_keys=True)
        say('  green: %d suites on the server, the local gate here; signed %s' % (len(results), urgent_record_path(tree)))

        say('\nU5. push %s to main by SHA' % head[:8])
        push_sha(ops, root, head, main, 'urgent push', say)

        say('\nU6. deploy the Workers in it')
        if not wk:
            say('  none')
        for f in wk:
            if ops.run([PY, 'tools/deploy-worker.py', '--live', workers[f], f], root, say) != 0:
                raise Stop('%s did not deploy. The push is out; nothing after this is safe to assume. Roll back: '
                           'python3 tools/release.py --rollback --go' % f)

        say('\nU7. wait until Pages serves every changed file')
        wait_pages(ops, root, served, say)

        live = head
        say('\nU8. a real browser looks at the screens')
        screens = [f for f in changed if any(f.startswith(w) for w in _release().SCREEN_FILES)]
        if screens:
            if ops.run([PY, 'tools/verify-live.py', '--stamp'], root, say) != 0:
                raise Stop('verify-live did not pass. Roll back: python3 tools/release.py --rollback --go')
            git_ok(ops, root, 'add', '.verify-live.json')
            if ops.git(root, 'commit', '-q', '-m', 'Screens verified live for %s\n\nCo-Authored-By: Claude Opus 5.5 '
                       '<noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Y8oH1QFku5kfGVCtv2QKLs'
                       % head[:8]).returncode == 0:
                live = git_ok(ops, root, 'rev-parse', 'HEAD').strip()
                push_sha(ops, root, live, head, 'stamp push', say)
        else:
            say('  no screen file changed')

        say('\nU9. the full gate in the background')
        log = os.path.join(LOG_DIR, 'after-gate-%s-%s.log' % (live[:8], time.strftime('%Y%m%d-%H%M%S')))
        pid = ops.spawn([PY, 'tools/release-lanes.py', 'after-gate', '--build', live, '--reason', reason.strip()], root, log)
        say('  running as pid %s; log %s. Red = the rollback lane runs by itself.' % (pid, log))
        say('\n%sLIVE (urgent): %s. NOT DONE until the after-gate is green.%s' % (GRN, live[:8], OFF))
        return 0
    except Stop as e:
        say('\n%sURGENT STOPPED.%s %s' % (RED, OFF, e))
        return 1


# ------------------------------------------------------------------------------------------------ AFTER-GATE (U9)

def after_gate(ops, say, build, reason, root=ROOT, steps=None, roll=None):
    """The full gate on the urgent build, in its own worktree. Returns 0 green (recorded), 1 red (rolled back or tried),
    2 could not judge (a person is told, nothing rolled back). steps(wt) -> [(label, argv)]; roll(reason) -> rc."""
    wt = tempfile.mkdtemp(prefix='vp-after-gate-')
    try:
        git_ok(ops, root, 'worktree', 'add', '-q', '--detach', wt, build)
        steps = steps or (lambda w: [('the Chrome suites on vp-tests-1', [PY, 'tools/gate-server.py', 'run'], True),
                                     ('the full gate, live half included', [PY, 'tools/release-check.py', '--chrome-record'], False),
                                     ('the free real night', [PY, 'tools/real-night-free.py', '--build', build], False)])
        for label, argv, advisory in steps(wt):
            say('\n  after-gate: ' + label)
            rc = ops.run(argv, wt, say, env={'VP_WAIT_LOCK': '3600'})
            if rc == 0 or advisory:
                continue
            if rc != 1:
                alert('the after-gate for urgent %s could not run %s (exit %s). NOT rolled back; a person must look. '
                      'Reason for the fix: %s' % (build[:8], label, rc, reason), say)
                return 2
            main = ops.remote_main(root)
            git_ok(ops, root, 'fetch', '-q', 'origin', 'main')
            if not (main == build or (is_ancestor(ops, root, build, main) and same_as(ops, root, build, main))):
                alert('the after-gate for urgent %s is RED (%s) but main has moved on to %s: NOT rolled back. Look now.'
                      % (build[:8], label, main[:8]), say)
                return 1
            why = 'urgent fix %s failed its after-gate (%s)' % (build[:8], label)
            say('  %sRED: %s. Rolling back.%s' % (RED, why, OFF))
            rc2 = (roll or (lambda r: rollback(ops, say, go=True, reason=r, root=root)))(why)
            if rc2 != 0:
                alert('%s, and the rollback lane STOPPED (log above). Look now.' % why, say)
            return 1
        say('\n  after-gate green: recording %s as live-checked' % build[:8])
        record_live(ops, say, build, 'urgent', root)
        return 0
    finally:
        ops.git(root, 'worktree', 'remove', '--force', wt)
        shutil.rmtree(wt, ignore_errors=True)


# ------------------------------------------------------------------------------------------------ recording a release

def record_live(ops, say, sha, lane, root=ROOT, push=True):
    """Append `sha` (what is live on main now) to the record, commit only that file in a temporary worktree at main,
    and push it (a bookkeeping push the hook lets through). Never fatal to the release that called it."""
    wt = tempfile.mkdtemp(prefix='vp-record-')
    try:
        main = ops.remote_main(root)
        if main != sha:
            say('  %snot recorded: origin/main is %s, not %s%s' % (YEL, main[:8], sha[:8], OFF))
            return False
        git_ok(ops, root, 'worktree', 'add', '-q', '--detach', wt, sha)
        entries = read_record(show(ops, wt, sha, RECORD))
        if any(e['sha'] == sha for e in entries):
            say('  %s is already recorded' % sha[:8])
            return True
        entries.append({'sha': sha, 'when': time.strftime('%Y-%m-%d %H:%M:%S %z'), 'lane': lane})
        with io.open(os.path.join(wt, RECORD), 'w', encoding='utf-8') as fh:
            fh.write(record_text(entries))
        git_ok(ops, wt, 'add', RECORD)
        git_ok(ops, wt, 'commit', '-q', '-m', 'Live-checked: %s (%s)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
               'Claude-Session: https://claude.ai/code/session_01Y8oH1QFku5kfGVCtv2QKLs' % (sha[:8], lane))
        new = git_ok(ops, wt, 'rev-parse', 'HEAD').strip()
        if push:
            push_sha(ops, wt, new, sha, 'record push', say)
        say('  recorded %s in %s' % (sha[:8], RECORD))
        return True
    except Stop as e:
        say('  %snot recorded: %s%s' % (YEL, e, OFF))
        return False
    finally:
        ops.git(root, 'worktree', 'remove', '--force', wt)
        shutil.rmtree(wt, ignore_errors=True)


# ------------------------------------------------------------------------------------------------ the command line

def _arg(argv, name):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
        raise SystemExit('%s needs a value' % name)
    return None


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    ops = Ops(ROOT)
    go = '--go' in argv
    if argv and argv[0] == 'hook-accept':
        if len(argv) < 3:
            return 1
        gs = load('gate_server_for_hook', 'tools/gate-server.py', ROOT)
        key, _ = gs.read_key()
        counts, rule = gs.ledger(ROOT), gs.suite_passed_rule(ROOT)
        try:
            good, why = hook_accept(ops, ROOT, argv[1], argv[2], key, lambda s, e: gs.suite_accepted(s, e, counts.get('tools/' + s), rule))
        except Stop as e:
            good, why = False, str(e)
        print('  release lane: %s: %s' % ('ACCEPTED' if good else 'not used', why))
        return 0 if good else 1
    if argv and argv[0] == 'after-gate':
        say = Log('after-gate', False)
        return after_gate(ops, say, _arg(argv, '--build'), _arg(argv, '--reason') or '')
    if '--rollback' in argv:
        say = Log('rollback', not go)
        allow = tuple(argv[i + 1] for i, a in enumerate(argv) if a == '--allow-migration' and i + 1 < len(argv))
        return rollback(ops, say, go=go, to=_arg(argv, '--to'), reason=_arg(argv, '--reason') or '', allow=allow)
    if '--urgent' in argv:
        say = Log('urgent', not go)
        return urgent(ops, say, _arg(argv, '--urgent') or '', go=go)
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
