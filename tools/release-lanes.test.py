#!/usr/bin/env python3
"""THE TWO RELEASE LANES DO WHAT THEY SAY, WITHOUT A NETWORK (Jobs 442, 16 Nov 2026).

    python3 tools/release-lanes.test.py

A bare git repository in a temp folder stands in for GitHub; a clone of it stands in for this checkout. Workers,
Pages, the test server, the gate tools and the signing key are fakes on tools/release-lanes.py's Ops. Proven here:

  ROLLBACK  refuses a target that is not in the record of live-checked releases (unless --to AND --reason); refuses
            past a migration that would break the older code (and takes an additive one); picks the release before
            the live one by default; never force-pushes, never rewrites history (main's old head is an ancestor of the
            rollback commit); puts each changed Worker back with --emergency="rollback to <sha8>"; keeps migrations and
            the record as they are on main; plan mode pushes nothing
  URGENT    refuses a billing change (by path, and by a money hunk in a Worker); runs the money/sign-in/player suites
            and the real-night dry run; signs a record the hook accepts; falls back to the rollback lane when the
            after-gate is red, and never rolls back when a step could not run
  HOOK      lets through only bookkeeping, a true rollback and a signed urgent tree; anything else gets the gate
Every git call goes to a local path. GATELIB_NO_CHROME: it names verify-live.py only as a fake tool; it starts no browser.
"""
import importlib.util, io, json, os, re, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail and not good else ''))


TMP = tempfile.mkdtemp(prefix='release-lanes-')
os.environ['VP_LANES_LOG_DIR'] = os.path.join(TMP, 'logs')
os.environ['VP_LANES_FAULTS'] = os.path.join(TMP, 'INBOX.md')
HOOKS = os.path.join(TMP, 'no-hooks'); os.makedirs(HOOKS)
ENV = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t',
           GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1')
for k in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR'):
    ENV.pop(k, None)

spec = importlib.util.spec_from_file_location('release_lanes_under_test', os.path.join(ROOT, 'tools', 'release-lanes.py'))
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)

GAME = 'venueplay-backend/worker/venueplay-game.js'
API = 'venueplay-backend/worker/venueplay-api-FULL.js'
WORKERS = {GAME: 'venueplay-game', API: 'venueplay-api'}
KEY = b'k' * 32


def sh(cwd, *args):
    return subprocess.run(['git'] + list(args), cwd=cwd, env=ENV, capture_output=True, text=True)


def write(cwd, rel, text):
    p = os.path.join(cwd, rel)
    os.makedirs(os.path.dirname(p) or cwd, exist_ok=True)
    io.open(p, 'w', encoding='utf-8').write(text)


def commit(cwd, files, msg):
    for rel, text in files.items():
        if text is None:
            sh(cwd, 'rm', '-q', rel)
        else:
            write(cwd, rel, text)
    sh(cwd, 'add', '-A'); sh(cwd, 'commit', '-q', '-m', msg)
    return sh(cwd, 'rev-parse', 'HEAD').stdout.strip()


def push(cwd):
    r = sh(cwd, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
    assert r.returncode == 0, r.stderr


def worker(stamp, body='play()'):
    return "const BUILD = '16 Nov 2026, 10:00 · %s';\nfunction f() { %s }\n" % (stamp, body)


class Fake(L.Ops):
    """Real git on temp folders; everything else is pretend."""

    def __init__(self, root, rcs=None, stale_rounds=1, server=(True, ''), key=KEY):
        L.Ops.__init__(self, root)
        self.calls, self.gitcalls, self.rcs = [], [], rcs or {}
        self.healths = {}
        self.stale_rounds, self.server, self._key = stale_rounds, server, key
        self.spawned, self.t = [], 1000.0

    def env(self):
        return dict(ENV)

    def git(self, cwd, *args):
        self.gitcalls.append(args)
        return L.Ops.git(self, cwd, *args)

    def run(self, argv, cwd, say, env=None):
        self.calls.append(list(argv))
        tool = os.path.basename(argv[1])
        if tool == 'deploy-worker.py':
            f = argv[-1]
            self.healths[argv[-2]] = 'build ' + L.stamp_in(io.open(os.path.join(cwd, f), encoding='utf-8').read())
        if tool == 'verify-live.py' and '--stamp' in argv:
            write(cwd, '.verify-live.json', json.dumps({'commit': 'x', 'n': len(self.calls)}))
        rc = self.rcs.get(tool, 0)
        return rc(argv) if callable(rc) else rc

    def health(self, name):
        return self.healths.get(name, 'build 00000000')

    def stale_pages(self, root, files):
        self.stale_rounds -= 1
        return list(files) if self.stale_rounds >= 0 else []

    def server_suites(self, root, suites, say):
        self.calls.append(['server'] + list(suites))
        res = {s: {'rc': 0, 'last': 'ok', 'checks': 5} for s in suites}
        return self.server[0], self.server[1], res, L.tree_of(self, root, 'HEAD')

    def key(self):
        return (self._key, '') if self._key else (None, 'no key')

    def spawn(self, argv, cwd, log):
        self.spawned.append(argv)
        return 4242

    def sleep(self, s):
        self.t += s

    def now(self):
        return self.t


class Say:
    def __init__(self):
        self.lines, self.path = [], ''

    def __call__(self, line=''):
        self.lines.append(re.sub(r'\x1b\[[0-9;]*m', '', line))

    def text(self):
        return '\n'.join(self.lines)


N = [0]


def fresh():
    """origin + clone. History: A (recorded), B (recorded), C (live on main, recorded). Returns dict of shas."""
    N[0] += 1
    bare = os.path.join(TMP, 'o%d.git' % N[0]); clone = os.path.join(TMP, 'c%d' % N[0])
    subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', bare], env=ENV, check=True)
    subprocess.run(['git', 'clone', '-q', bare, clone], env=ENV, check=True, capture_output=True)
    sh(clone, 'checkout', '-q', '-b', 'main'); sh(clone, 'config', 'core.hooksPath', HOOKS)
    s = {}
    s['A'] = commit(clone, {'venueplay/tv.html': '<p>A</p>\n', GAME: worker('aaaaaaaa'), API: worker('11111111', 'bill()'),
                            'venueplay-backend/supabase/venueplay-100-base.sql': 'create table t (a int);\n',
                            L.RECORD: L.record_text([])}, 'A')
    s['B'] = commit(clone, {'venueplay/tv.html': '<p>B</p>\n', GAME: worker('bbbbbbbb')}, 'B')
    s['C'] = commit(clone, {'venueplay/tv.html': '<p>C</p>\n', 'venueplay/app/trivia/play.html': '<p>new</p>\n',
                            GAME: worker('cccccccc'),
                            'venueplay-backend/supabase/venueplay-101-add.sql': 'alter table t add column b text;\n'}, 'C')
    s['R'] = commit(clone, {L.RECORD: L.record_text([{'sha': s['A'], 'lane': 'release'}, {'sha': s['B'], 'lane': 'release'},
                                                       {'sha': s['C'], 'lane': 'release'}])}, 'record')
    push(clone)
    return bare, clone, s


def remote(bare):
    return sh(bare, 'rev-parse', 'refs/heads/main').stdout.strip()


def forced(gitcalls):
    return [a for a in gitcalls if 'push' in a and any(x in ('-f', '--force', '--force-with-lease', '--mirror') or
                                                         x.startswith(('+', '--force')) for x in a)]


print('ROLLBACK LANE')
bare, clone, s = fresh()
# 1. default target = the release before the live one, plan pushes nothing
ops, say = Fake(clone), Say()
rc = L.rollback(ops, say, go=False, root=clone, workers=WORKERS)
ok('plan: exit 0 and the default target is the live-checked release before main (B)', rc == 0 and ('%s (the live-checked release before' % s['B'][:8]) in say.text(), say.text()[-300:])
ok('plan: nothing pushed, nothing deployed', remote(bare) == s['R'] and not any('deploy-worker.py' in ' '.join(c) for c in ops.calls))
ok('plan: the additive migration since B is named fine', 'fine: venueplay-backend/supabase/venueplay-101-add.sql' in say.text())

# 2. a target not in the record is refused without --to + --reason
x = commit(clone, {'venueplay/tv.html': '<p>X unrecorded</p>\n'}, 'X'); push(clone)
y = commit(clone, {'venueplay/tv.html': '<p>Y</p>\n'}, 'Y'); push(clone)
ops, say = Fake(clone), Say()
rc = L.rollback(ops, say, go=True, to=x, root=clone, workers=WORKERS)
ok('refuses a target that is not live-checked (--to with no --reason)', rc == 1 and 'is not in tools/live-releases.json' in say.text(), say.text()[-200:])
ok('  and pushed nothing', remote(bare) == y)
rc = L.rollback(Fake(clone), Say(), go=False, to=x, reason='the venue is mid-game and B is too old', root=clone, workers=WORKERS)
ok('the same target is allowed with --to AND --reason', rc == 0)

# 3. main is NOT recorded (Y never passed its checks): the default is the newest recorded release, C
ops, say = Fake(clone), Say()
rc = L.rollback(ops, say, go=False, root=clone, workers=WORKERS)
ok('main not live-checked: the default is the newest live-checked release (C)', rc == 0 and s['C'][:8] + ' (the newest live-checked' in say.text(), say.text()[-300:])

# 4. a breaking migration between target and main refuses; --allow-migration with a reason overrides
bare, clone, s = fresh()
d = commit(clone, {'venueplay/tv.html': '<p>D</p>\n', 'venueplay-backend/supabase/venueplay-102-drop.sql':
                   '-- drops the old column\nalter table t drop column b;\n'}, 'D'); push(clone)
ops, say = Fake(clone), Say()
rc = L.rollback(ops, say, go=True, to=s['B'], root=clone, workers=WORKERS)
ok('refuses to roll back past a migration that drops a column', rc == 1 and 'BREAKS THE OLDER CODE: venueplay-backend/supabase/venueplay-102-drop.sql' in say.text(), say.text()[-300:])
ok('  and pushed nothing', remote(bare) == d)
rc = L.rollback(Fake(clone), Say(), go=False, to=s['B'], reason='read it: nothing old reads column b',
                allow=('venueplay-102-drop.sql',), root=clone, workers=WORKERS)
ok('--allow-migration <file> with --reason lets it through (plan)', rc == 0)
rc = L.rollback(Fake(clone), Say(), go=False, to=s['B'], allow=('venueplay-102-drop.sql',), root=clone, workers=WORKERS)
ok('--allow-migration without --reason does not', rc == 1)

# 5. the real thing, on fakes: revert, never force, Workers back with --emergency, checks run
bare, clone, s = fresh()
ops, say = Fake(clone, stale_rounds=2), Say()
rc = L.rollback(ops, say, go=True, root=clone, workers=WORKERS)
new = remote(bare)
ok('GO: exit 0 and main moved to a new rollback commit', rc == 0 and new not in s.values(), say.text()[-400:])
ok('GO: history kept, the old head is an ancestor of the rollback commit', sh(clone, 'merge-base', '--is-ancestor', s['R'], new).returncode == 0)
sh(clone, 'fetch', '-q', 'origin')
diff = sh(clone, 'diff', '--name-only', s['B'], new).stdout.split()
ok('GO: every file is B\'s except the migrations and the record', sorted(diff) == sorted(['venueplay-backend/supabase/venueplay-101-add.sql', L.RECORD]), diff)
ok('GO: a page added after B is gone again', sh(clone, 'cat-file', '-e', new + ':venueplay/app/trivia/play.html').returncode != 0)
ok('GO: never a force push', not forced(ops.gitcalls) and any('push' in a for a in ops.gitcalls))
dep = [c for c in ops.calls if os.path.basename(c[1]) == 'deploy-worker.py']
ok('GO: the game Worker went back with --emergency="rollback to <B8>", the billing Worker untouched',
   len(dep) == 1 and '--emergency=rollback to %s' % s['B'][:8] in dep[0] and dep[0][-2:] == ['venueplay-game', GAME], dep)
ok('GO: /health answers B\'s stamp', ops.healths.get('venueplay-game') == 'build bbbbbbbb')
ok('GO: waited for Pages, then the live checks (release-check --live, verify-live without --stamp)',
   [os.path.basename(c[1]) for c in ops.calls][-2:] == ['release-check.py', 'verify-live.py'] and '--stamp' not in ops.calls[-1]
   and 'still on the other build' in say.text())
ok('GO: the temporary worktree is gone', sh(clone, 'worktree', 'list').stdout.count('\n') == 1)
ok('GO: a message for Dean was written', 'FOR DEAN: Rolled back main to %s' % s['B'][:8] in say.text())
try:
    ops.git(clone, 'push', '--force', 'origin', 'HEAD:main'); refused = False
except L.Stop:
    refused = True
ok('Ops.git itself refuses a force push', refused)

# 6. a Worker that does not answer the old stamp stops the lane
bare, clone, s = fresh()
ops = Fake(clone, stale_rounds=0)
ops.health = lambda name: 'build cccccccc'
say = Say()
rc = L.rollback(ops, say, go=True, root=clone, workers=WORKERS)
ok('a rolled-back Worker still answering the new stamp stops the lane', rc == 1 and 'answers' in say.text() and 'after its rollback deploy' in say.text())

# 7. live checks red after the rollback: exit 1 and a line for a person
bare, clone, s = fresh()
ops, say = Fake(clone, rcs={'verify-live.py': 1}, stale_rounds=0), Say()
rc = L.rollback(ops, say, go=True, root=clone, workers=WORKERS)
ok('live checks red after the rollback: exit 1 and the INBOX is told', rc == 1 and 'ROLLED BACK but the live checks are red' in io.open(os.environ['VP_LANES_FAULTS']).read())

print('\nMIGRATIONS')
cm = L.classify_migration
ok('additive: create table, add a nullable column, an index', cm('create table x (a int);\nalter table x add column b text;\ncreate index i on x(a);')[0] == [])
ok('breaking: drop table', cm('drop table x;')[0] != [])
ok('breaking: rename column', cm('alter table x rename column a to b;')[0] != [])
ok('breaking: NOT NULL with no default', cm('alter table x add column c text not null;')[0] != [])
ok('additive: NOT NULL with a default', cm("alter table x add column c text not null default 'a';")[0] == [])
ok('breaking: set not null', cm('alter table x alter column a set not null;')[0] != [])
ok('a word in a comment is not a statement', cm('-- we do not drop table x here\ncreate table y (a int);')[0] == [])
ok('locking a table the migration creates is fine; revoking on an older one is not',
   cm('create table public.n (a int);\nrevoke all on public.n from public, anon, authenticated;')[0] == []
   and cm('revoke all on public.old from anon;')[0] != []
   and cm('create or replace function public.f(a int) returns int as $$ select 1 $$ language sql;\n'
          'revoke execute on function public.f(int) from anon;')[0] == [])
ok('emptying its own backup table is fine; deleting from an older table is not',
   cm('create table b (a int);\ndelete from b;')[0] == [] and cm('delete from vp_players where x = 1;')[0] != []
   and cm('create trigger t before truncate on public.x for each row execute function f();')[0] == [])
ok('a replaced policy is fine, a dropped one is not', cm('drop policy p on x;\ncreate policy p on x using (true);')[0] == [] and cm('drop policy p on x;')[0] != [])

print('\nURGENT LANE')
CHROME = ['phone-signin-in-chrome.test.py', 'billing-words-in-chrome.test.py', 'tv-sting-in-chrome.test.py',
          'signin-logo-in-chrome.test.py', 'trivia-ux-in-chrome.test.py', L.DRY_RUN_SUITE, 'consent-split-in-chrome.test.py']
KW = dict(workers=WORKERS, chrome=CHROME, mac_only=('signin-logo-in-chrome.test.py',),
          impact=lambda b, h: ['tools/tv-sting-in-chrome.test.py'], naming=lambda f: ['tools/trivia-ux-in-chrome.test.py'],
          accepted_suite=lambda name, e: '' if e.get('rc') == 0 else 'red')
bare, clone, s = fresh()
commit(clone, {'venueplay/app/billing.html': '<p>pay</p>\n'}, 'billing page')
say = Say()
rc = L.urgent(Fake(clone), say, 'trivia frozen', go=False, root=clone, **KW)
ok('refuses a billing page change', rc == 1 and 'venueplay/app/billing.html (a billing file by its name)' in say.text(), say.text()[-200:])

bare, clone, s = fresh()
commit(clone, {GAME: worker('dddddddd', 'play(); stripeCharge()')}, 'game worker touches stripe')
say = Say()
rc = L.urgent(Fake(clone), say, 'bingo stuck', go=False, root=clone, **KW)
ok('refuses a game Worker hunk that mentions Stripe', rc == 1 and 'BILLING: %s' % GAME in say.text(), say.text()[-200:])

bare, clone, s = fresh()
commit(clone, {GAME: worker('eeeeeeee', 'play(); fixFreeze()')}, 'game fix')
say = Say()
rc = L.urgent(Fake(clone), say, '', go=False, root=clone, **KW)
ok('refuses with no reason', rc == 1 and 'needs the reason' in say.text())
say = Say()
rc = L.urgent(Fake(clone), say, 'trivia frozen at question 3', go=False, root=clone, **KW)
t = say.text()
ok('a game-only fix plans: exit 0', rc == 0, t[-300:])
ok('suites: impact + Worker-naming + money/sign-in/player + the dry run, MAC_ONLY left out',
   all(x in t for x in ('tv-sting-in-chrome.test.py', 'trivia-ux-in-chrome.test.py', 'phone-signin-in-chrome.test.py',
                         'billing-words-in-chrome.test.py', 'consent-split-in-chrome.test.py', L.DRY_RUN_SUITE))
   and 'left out (MAC_ONLY, runs in the after-gate): signin-logo-in-chrome.test.py' in t)

ops, say = Fake(clone, stale_rounds=0), Say()
rc = L.urgent(ops, say, 'trivia frozen at question 3', go=True, root=clone, **KW)
head = sh(clone, 'rev-parse', 'HEAD').stdout.strip()
ok('GO: pushed by SHA after the server suites and the local gate', rc == 0 and remote(bare) == head and ops.calls and
   any(c[0] == 'server' for c in ops.calls) and any('--skip-chrome' in c for c in ops.calls), say.text()[-300:])
ok('GO: the Worker deployed WITHOUT --emergency', any(os.path.basename(c[1]) == 'deploy-worker.py' and not any('--emergency' in a for a in c) for c in ops.calls))
ok('GO: the after-gate was started in the background', ops.spawned and ops.spawned[0][2] == 'after-gate' and head in ops.spawned[0])
ok('GO: never a force push', not forced(ops.gitcalls))
tree = L.tree_of(ops, clone, head)
recp = L.urgent_record_path(tree)
ok('GO: a signed urgent record for this tree is on disk', os.path.isfile(recp))

ops, say = Fake(clone, server=(False, '1 suite(s) red on the server: tv-sting')), Say()
commit(clone, {'venueplay/tv.html': '<p>urgent 2</p>\n'}, 'u2')
before = remote(bare)
rc = L.urgent(ops, say, 'tv frozen', go=True, root=clone, **KW)
ok('a red server suite stops the urgent lane before the push', rc == 1 and remote(bare) == before)

print('\nAFTER-GATE')
bare, clone, s = fresh()
u = commit(clone, {GAME: worker('ffffffff', 'fix()')}, 'urgent fix'); push(clone)
rolled = []
ops, say = Fake(clone), Say()
rc = L.after_gate(ops, say, u, 'trivia frozen', root=clone,
                  steps=lambda w: [('server', ['py', 'gate-server.py'], True), ('full gate', ['py', 'release-check.py'], False)],
                  roll=lambda r: rolled.append(r) or 0)
ops.rcs['release-check.py'] = 1
rc = L.after_gate(ops, say, u, 'trivia frozen', root=clone,
                  steps=lambda w: [('server', ['py', 'gate-server.py'], True), ('full gate', ['py', 'release-check.py'], False)],
                  roll=lambda r: rolled.append(r) or 0)
ok('after-gate red: the rollback lane runs, with the reason', rc == 1 and rolled and 'failed its after-gate (full gate)' in rolled[-1], rolled)
rolled[:] = []
ops.rcs['release-check.py'] = 3
rc = L.after_gate(ops, say, u, 'trivia frozen', root=clone,
                  steps=lambda w: [('full gate', ['py', 'release-check.py'], False)], roll=lambda r: rolled.append(r) or 0)
ok('a step that could not run (exit 3) never rolls back; a person is told', rc == 2 and not rolled)
bare, clone, s = fresh()
u = commit(clone, {GAME: worker('ffffffff', 'fix()')}, 'urgent fix'); push(clone)
ops, say, rolled = Fake(clone, rcs={'release-check.py': 0}), Say(), []
rc = L.after_gate(ops, say, u, 'x', root=clone, steps=lambda w: [('full gate', ['py', 'release-check.py'], False)],
                  roll=lambda r: rolled.append(r) or 0)
sh(clone, 'fetch', '-q', 'origin')
rec = L.read_record(sh(clone, 'show', 'origin/main:' + L.RECORD).stdout)
ok('after-gate green: the urgent build is recorded as live-checked, by a bookkeeping push', rc == 0 and not rolled and rec[-1]['sha'] == u, say.text()[-200:])
bare, clone, s = fresh()
u = commit(clone, {GAME: worker('ffffffff', 'fix()')}, 'urgent fix'); push(clone)
commit(clone, {'venueplay/tv.html': '<p>someone else</p>\n'}, 'other'); push(clone)
ops, say, rolled = Fake(clone, rcs={'release-check.py': 1}), Say(), []
rc = L.after_gate(ops, say, u, 'x', root=clone, steps=lambda w: [('full gate', ['py', 'release-check.py'], False)],
                  roll=lambda r: rolled.append(r) or 0)
ok('after-gate red but main moved on: no automatic rollback', rc == 1 and not rolled)

print('\nTHE HOOK')
bare, clone, s = fresh()
ops = Fake(clone)
ok('a plain change is not accepted (the gate runs)', not L.hook_accept(ops, clone, commit(clone, {'venueplay/tv.html': '<p>new</p>\n'}, 'n'), s['R'])[0])
sh(clone, 'reset', '-q', '--hard', s['R'])
ok('a bookkeeping push is accepted', L.hook_accept(ops, clone, commit(clone, {'.verify-live.json': '{}\n'}, 'stamp'), s['R'])[0])
sh(clone, 'reset', '-q', '--hard', s['R'])
sh(clone, 'read-tree', '-u', '--reset', s['B']); sh(clone, 'checkout', s['R'], '--', L.RECORD, 'venueplay-backend/supabase/venueplay-101-add.sql')
rb = commit(clone, {}, 'rollback to B')
good, why = L.hook_accept(ops, clone, rb, s['R'])
ok('a true rollback to a live-checked release is accepted', good, why)
sneak = commit(clone, {'venueplay/tv.html': '<p>sneaked in</p>\n'}, 'sneak')
ok('a rollback with one more change in it is not', not L.hook_accept(ops, clone, sneak, s['R'])[0])
sh(clone, 'reset', '-q', '--hard', s['R'])
sh(clone, 'read-tree', '-u', '--reset', s['B']); sh(clone, 'checkout', s['R'], '--', L.RECORD)
nomig = commit(clone, {'venueplay-backend/supabase/venueplay-101-add.sql': 'drop table t;\n'}, 'rollback with a kept file rewritten')
ok('a rollback whose kept file is neither the target\'s nor main\'s is not', not L.hook_accept(ops, clone, nomig, s['R'])[0])
ok('a push to no existing main is not', not L.hook_accept(ops, clone, rb, '0' * 40)[0])
sh(clone, 'reset', '-q', '--hard', s['R'])
uf = commit(clone, {'venueplay/tv.html': '<p>urgent</p>\n'}, 'urgent')
tr = L.tree_of(ops, clone, uf)
acc = lambda n, e: '' if e.get('rc') == 0 else 'red'
body = {'v': L.URGENT_VERSION, 'lane': 'urgent', 'tree': tr, 'time': ops.now(), 'local_gate': 'green',
        'suites': {L.DRY_RUN_SUITE: {'rc': 0}}}
os.makedirs(L.URGENT_DIR, exist_ok=True)
io.open(L.urgent_record_path(tr), 'w').write(json.dumps(L.sign_urgent(body, KEY)))
ok('a signed urgent record for this tree is accepted', L.hook_accept(ops, clone, uf, s['R'], KEY, acc)[0])
ok('  but not with another key', not L.hook_accept(ops, clone, uf, s['R'], b'z' * 32, acc)[0])
ok('  nor an hour later', not L.hook_accept(ops, clone, uf, s['R'], KEY, acc, now=ops.now() + 3601)[0])
edited = dict(L.sign_urgent(body, KEY)); edited['local_gate'] = 'green'; edited['suites'] = {L.DRY_RUN_SUITE: {'rc': 1}}
io.open(L.urgent_record_path(tr), 'w').write(json.dumps(edited))
ok('  nor once edited after signing', not L.hook_accept(ops, clone, uf, s['R'], KEY, acc)[0])

print('\nTHE REAL HOOK CALLS IT')
hook = io.open(os.path.join(ROOT, 'tools', 'hooks', 'pre-push'), encoding='utf-8').read()
i, j = hook.find('release-lanes.py" hook-accept'), hook.find('tools/release-check.py" --local $CHROME_FLAG')
ok('pre-push asks hook-accept before its gate, only for one push of this checkout to main',
   0 < i < j and '[ -n "$CHROME_FLAG" ] && [ "$PUSH_REFS" = "1" ] && [ "$PUSH_REF" = "refs/heads/main" ]' in hook)
rel = io.open(os.path.join(ROOT, 'tools', 'release.py'), encoding='utf-8').read()
ok('release.py records a release only when its real night is green', "    if on and good:\n        lanes().record_live(" in rel)

shutil.rmtree(TMP, ignore_errors=True)
print('\n%d passed, %d failed' % (PASS[0], FAIL[0]))
if FAIL[0]:
    sys.exit(1)
print('All %d checks passed' % PASS[0])
