#!/usr/bin/env python3
"""tools/set-worker-secret.py, RUN against a fake Cloudflare API. GATELIB_NO_CHROME.

    python3 tools/set-worker-secret.test.py

urllib.request.urlopen is replaced by a fake Cloudflare that records every request and answers
like the real one (settings GET, secrets PUT). The env file is a temp file, mode 600, with made-up
credentials and a made-up secret value. Every run captures ALL of the tool's output and asserts
the secret value is in none of it, and that nothing under tools/ grew a line containing it.

What it runs:
  1. sets        PUT /secrets carries {name, text, type: secret_text} and nothing else; no code
                 upload; the settings are read back and the binding confirmed by NAME; EXIT 0
  2. refuses     a Worker not on the LIVE allowlist (nothing sent); without --live (nothing sent);
                 an empty or missing value (nothing sent); a bad secret name; an unknown flag
  3. confirms    a fake that accepts the PUT and then does not show the binding is EXIT 2; a fake
                 that drops another binding is EXIT 2; a fake that refuses the PUT is EXIT 1
  4. secrecy     the value appears in no output in any of the above, including when Cloudflare's
                 error message echoes it back
"""
import contextlib, importlib.util, io, json, os, re, shutil, stat, sys, tempfile, urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    (PASS if good else FAIL)[0] += 1
    print('  %s  %s%s' % ('PASS' if good else 'FAIL', label, ('  (%s)' % (detail,)) if detail else ''))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = [path]
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = saved
    return mod


TMP = tempfile.mkdtemp(prefix='set-worker-secret-')
SECRET_VALUE = 'zq8-made-up-value-for-the-test-7731'      # never a real one; the point is it stays off every line
TOKEN = 'cfut_' + 'A' * 40
ACCT = 'ab' * 16


def write_env(**extra):
    p = Path(TMP) / 'env'
    lines = ['# fake env file', 'CF_API_TOKEN=' + TOKEN, 'CF_ACCOUNT_ID=' + ACCT]
    for k, v in extra.items():
        lines.append('%s=%s' % (k, v))
    p.write_text('\n'.join(lines) + '\n')
    os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)
    return p


class FakeCloudflare(object):
    """Answers like api.cloudflare.com for the two routes the tool uses. `bindings` is the live
    binding list; a PUT to /secrets adds or replaces the one named, unless a knob says otherwise."""

    def __init__(self, bindings, refuse_put=False, hide_after_put=False, drop_after_put=None, echo_value=False):
        self.bindings = list(bindings)
        self.calls = []
        self.refuse_put, self.hide_after_put, self.drop_after_put, self.echo_value = refuse_put, hide_after_put, drop_after_put, echo_value

    def __call__(self, req, timeout=None):
        url, method = req.full_url, req.get_method()
        body = req.data.decode() if req.data else ''
        self.calls.append((method, url, body))
        m = re.search(r'/workers/scripts/([^/]+)(/settings|/secrets)?$', url)
        worker, tail = (m.group(1), m.group(2)) if m else (None, None)
        if method == 'GET' and tail == '/settings':
            return self._resp(200, {'success': True, 'result': {'bindings': [{'type': t, 'name': n} for t, n in self.bindings],
                                                                  'compatibility_date': '2026-01-01'}})
        if method == 'PUT' and tail == '/secrets':
            d = json.loads(body)
            if self.refuse_put:
                msg = 'bad request' + ((' for ' + d.get('text', '')) if self.echo_value else '')
                raise urllib.error.HTTPError(url, 400, 'Bad Request', {}, io.BytesIO(json.dumps({'success': False, 'errors': [{'message': msg}]}).encode()))
            if not self.hide_after_put:
                self.bindings = [(t, n) for t, n in self.bindings if n != d['name']] + [('secret_text', d['name'])]
            if self.drop_after_put:
                self.bindings = [(t, n) for t, n in self.bindings if n != self.drop_after_put]
            return self._resp(200, {'success': True, 'result': {'name': d['name'], 'type': d.get('type')}})
        raise urllib.error.HTTPError(url, 404, 'Not Found', {}, io.BytesIO(json.dumps({'success': False, 'errors': [{'message': 'no such route ' + method + ' ' + url}]}).encode()))

    @staticmethod
    def _resp(status, payload):
        class R(object):
            pass
        r = R()
        r.status = status
        r.read = lambda: json.dumps(payload).encode()
        return r


def run(tool, argv, fake, env_path):
    """Run the tool's main in-process with the fake API and the fake env file. Returns (exit, output)."""
    out = io.StringIO()
    saved = urllib.request.urlopen
    urllib.request.urlopen = fake
    tool.dw.ENV_FILE = env_path
    code = None
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            try:
                tool.main(argv)
            except SystemExit as e:
                code = e.code
    finally:
        urllib.request.urlopen = saved
    return code, out.getvalue()


def secret_free(text):
    return SECRET_VALUE not in text and TOKEN not in text


try:
    tool = load('set_worker_secret', os.path.join(TOOLS, 'set-worker-secret.py'))
    live_worker = sorted(tool.LIVE)[0]
    before_tools = {f: os.path.getsize(os.path.join(TOOLS, f)) for f in os.listdir(TOOLS) if os.path.isfile(os.path.join(TOOLS, f))}

    print('1. sets a secret on a LIVE Worker and confirms it by name')
    env = write_env(VP_TEST_SECRET=SECRET_VALUE)
    fake = FakeCloudflare([('plain_text', 'SUPABASE_URL'), ('secret_text', 'OTHER_KEY')])
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, env)
    ok('exit 0 and the last line says EXIT 0', code == 0 and out.strip().splitlines()[-1] == 'EXIT 0', out.strip().splitlines()[-1:])
    puts = [c for c in fake.calls if c[0] == 'PUT']
    ok('exactly one PUT, to /secrets of that Worker', len(puts) == 1 and puts[0][1].endswith('/workers/scripts/%s/secrets' % live_worker), [c[1] for c in puts])
    body = json.loads(puts[0][2]) if puts else {}
    ok('the PUT body is {name, text, type: secret_text} and nothing else',
       set(body) == {'name', 'text', 'type'} and body.get('type') == 'secret_text' and body.get('name') == 'VP_TEST_SECRET', sorted(body))
    ok('the PUT carries the value from the env file', body.get('text') == SECRET_VALUE)
    ok('no code upload: no PUT to the script itself, no multipart', not any(c[0] == 'PUT' and c[1].endswith('/scripts/' + live_worker) for c in fake.calls) and 'multipart' not in out)
    ok('the settings were read before and after', [c for c in fake.calls if c[0] == 'GET'][:2].__len__() == 2 and fake.calls[0][0] == 'GET' and fake.calls[-1][0] == 'GET')
    ok('confirmed by NAME in the binding list after the PUT', 'VP_TEST_SECRET is bound as secret_text' in out and 'confirmed by name' in out)
    ok('the other bindings were not sent or touched', fake.bindings[:2] == [('plain_text', 'SUPABASE_URL'), ('secret_text', 'OTHER_KEY')] and 'keep_bindings' not in puts[0][2])
    ok('the value is on no output line (set)', secret_free(out))
    ok('the output says how long the value is but never what it is', re.search(r'%d characters, never shown' % len(SECRET_VALUE), out) is not None)

    print('\n1b. --from-env reads a different key, and a secret already there is replaced')
    env = write_env(SOME_KEY=SECRET_VALUE)
    fake = FakeCloudflare([('secret_text', 'VP_TEST_SECRET')])
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET', '--from-env', 'SOME_KEY'], fake, env)
    ok('--from-env SOME_KEY sets VP_TEST_SECRET from that key', code == 0 and json.loads([c for c in fake.calls if c[0] == 'PUT'][0][2])['text'] == SECRET_VALUE)
    ok('says it is replacing one already there', 'already there' in out and secret_free(out))

    print('\n2. refusals, with nothing sent')
    env = write_env(VP_TEST_SECRET=SECRET_VALUE)
    fake = FakeCloudflare([])
    code, out = run(tool, ['--live', 'venueplay-game-sydney', 'VP_TEST_SECRET'], fake, env)
    ok('a Worker not on the LIVE allowlist is refused, exit 1', code == 1 and 'not a LIVE Worker' in out, out.strip().splitlines()[:1])
    ok('... and nothing was sent to Cloudflare', fake.calls == [])
    ok('... and the value is on no line', secret_free(out))
    fake = FakeCloudflare([])
    code, out = run(tool, [live_worker, 'VP_TEST_SECRET'], fake, env)
    ok('without --live it is refused, exit 1', code == 1 and 'Add --live' in out)
    ok('... and nothing was sent to Cloudflare', fake.calls == [])
    ok('... and the value is on no line', secret_free(out))
    env_empty = write_env(VP_TEST_SECRET='')
    fake = FakeCloudflare([])
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, env_empty)
    ok('an EMPTY value is refused, exit 1', code == 1 and 'missing or empty' in out and fake.calls == [])
    env_missing = write_env()
    fake = FakeCloudflare([])
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, env_missing)
    ok('a MISSING key is refused, exit 1', code == 1 and 'missing or empty' in out and fake.calls == [])
    fake = FakeCloudflare([])
    code, out = run(tool, ['--live', live_worker, 'not-a-name'], fake, env)
    ok('a secret name that is not SHOUTING_SNAKE_CASE is refused', code == 1 and 'not a secret name' in out and fake.calls == [])
    fake = FakeCloudflare([])
    code, out = run(tool, ['--live', '--force', live_worker, 'VP_TEST_SECRET'], fake, env)
    ok('an unknown flag is refused', code == 1 and 'unknown flag' in out and fake.calls == [])
    fake = FakeCloudflare([])
    code, out = run(tool, ['--live', live_worker], fake, env)
    ok('a missing secret name is a usage error', code == 1 and 'usage' in out and fake.calls == [])
    bad_mode = write_env(VP_TEST_SECRET=SECRET_VALUE)
    os.chmod(bad_mode, 0o644)
    fake = FakeCloudflare([])
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, bad_mode)
    ok('an env file that is not mode 600 is refused (the deploy tool\'s rule)', code == 1 and 'mode 600' in out and fake.calls == [] and secret_free(out))

    print('\n3. the confirmation is real: a PUT that does not show up is not a success')
    env = write_env(VP_TEST_SECRET=SECRET_VALUE)
    fake = FakeCloudflare([('plain_text', 'SUPABASE_URL')], hide_after_put=True)
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, env)
    ok('accepted but not in the binding list afterwards: EXIT 2, says NOT in the binding list', code == 2 and 'NOT in the binding list' in out and out.strip().endswith('EXIT 2 (the PUT was accepted but the binding is not confirmed)'))
    fake = FakeCloudflare([('plain_text', 'SUPABASE_URL'), ('kv_namespace', 'CACHE')], drop_after_put='CACHE')
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, env)
    ok('another binding gone after the PUT: EXIT 2, names it', code == 2 and 'bindings LOST' in out and 'CACHE' in out)
    fake = FakeCloudflare([('plain_text', 'SUPABASE_URL')], refuse_put=True)
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, env)
    ok('Cloudflare refuses the PUT: EXIT 1, nothing set', code == 1 and 'Cloudflare refused' in out and out.strip().endswith('EXIT 1 (nothing was set)'))

    print('\n4. the value is never printed, even when Cloudflare echoes it back')
    fake = FakeCloudflare([('plain_text', 'SUPABASE_URL')], refuse_put=True, echo_value=True)
    code, out = run(tool, ['--live', live_worker, 'VP_TEST_SECRET'], fake, env)
    ok('an API error that echoes the value is printed with <redacted> in its place', code == 1 and '<redacted>' in out and secret_free(out), out.strip().splitlines()[-2:])
    ok('the token is on no line either', TOKEN not in out)
    after_tools = {f: os.path.getsize(os.path.join(TOOLS, f)) for f in os.listdir(TOOLS) if os.path.isfile(os.path.join(TOOLS, f))}
    ok('the tool wrote no file under tools/ (no log)', after_tools == before_tools, sorted(set(after_tools) ^ set(before_tools)))
    src = io.open(os.path.join(TOOLS, 'set-worker-secret.py'), encoding='utf-8').read()
    ok('every print in the tool goes through the scrub (say), never print() directly',
       len(re.findall(r'^\s*print\(', src, re.M)) == 1 and 'def say' in src)
    ok('the allowlist is deploy-worker\'s LIVE set, imported, not a copy', 'LIVE = dw.LIVE' in src and tool.LIVE is tool.dw.LIVE)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
