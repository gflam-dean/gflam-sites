#!/usr/bin/env python3
"""Set ONE secret on a LIVE Cloudflare Worker over the API, by NAME. The value is never shown.

    python3 tools/set-worker-secret.py --live venueplay-api VP_UNSUB_SECRET
    python3 tools/set-worker-secret.py --live touring-api GFLAM_UNSUB_SECRET
    python3 tools/set-worker-secret.py --live touring-api GFLAM_UNSUB_SECRET --from-env SOME_OTHER_KEY

WHY THIS EXISTS (27 Oct 2026). tools/deploy-worker.py ships CODE and deliberately keeps every
binding the Worker already has; it has no way to ADD a secret, so a release that needs a new one
(GFLAM_UNSUB_SECRET on touring-api, VP_UNSUB_SECRET on venueplay-api) had to stop and wait for a
dashboard. This is the missing half. It is built on the same Cloudflare API, the same token and
account id (CF_API_TOKEN, CF_ACCOUNT_ID in ~/.gflam-migrate.env, mode 600) and the same LIVE
Worker allowlist as the deploy tool, imported from it so the two cannot drift.

THE VALUE. It lives in ~/.gflam-migrate.env under the secret's own name (or --from-env <KEY>),
put there by Dean. This tool reads it by name and sends it to Cloudflare and nothing else: it is
never printed, never logged, never written anywhere, and every line this tool prints is passed
through a scrub that replaces the value with <redacted> should an API error ever echo it back.
(Dean, 8 Sep 2026: "you told me to never give you my secret". A token pasted into chat is burned.)

What it does, in order, and it stops at the first thing that is wrong:
  1. Refuses a Worker name that is not on the LIVE allowlist (deploy-worker.LIVE). This tool is
     for the Workers a venue is on; a staging Worker's secrets go through the dashboard.
  2. Refuses without --live, so the command says out loud that it touches a live venue.
  3. Refuses a secret name that is not SHOUTING_SNAKE_CASE, and refuses an EMPTY value (a key
     missing from the env file, or present with nothing after the =). An empty secret would
     deploy fine and make every signed link fail, quietly.
  4. PUT /accounts/{id}/workers/scripts/{name}/secrets with {name, text, type: secret_text}.
     Cloudflare adds or replaces that ONE binding; no other variable, secret, KV or Durable
     Object binding is sent or touched. It never uploads code.
  5. Reads the Worker's settings back and confirms a secret_text binding of that NAME is there.
     "Cloudflare said 200" is not evidence; the binding list is. Secret values cannot be read
     back from Cloudflare, by design, so the confirmation is by name only, and says so.

The last line is always EXIT n: 0 set and confirmed, 1 refused or nothing set, 2 the PUT was
accepted but the binding did not show in the settings afterwards.
"""
import importlib.util, io, json, os, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _deploy_worker():
    """deploy-worker.py as a module: its LIVE allowlist, creds(), cf() and errors() are THE ones."""
    spec = importlib.util.spec_from_file_location('deploy_worker', str(HERE / 'deploy-worker.py'))
    mod = importlib.util.module_from_spec(spec)
    saved = sys.argv
    sys.argv = ['deploy-worker.py']
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = saved
    return mod


dw = _deploy_worker()
LIVE = dw.LIVE
NAME_RE = re.compile(r'^[A-Z][A-Z0-9_]{1,63}$')

_SCRUB = []     # every value this process has read; nothing printed may contain one


def say(text):
    """The only way this tool prints. A value that somehow reached a line is replaced."""
    for v in _SCRUB:
        if v and v in text:
            text = text.replace(v, '<redacted>')
    print(text)


def die(msg, code=1):
    say('STOP: ' + msg)
    say('EXIT %d (nothing was set)' % code if code == 1 else 'EXIT %d' % code)
    sys.exit(code)


def read_env_value(key, env_file=None):
    """The value under `key` in the env file, or '' when it is missing or empty. Not printed."""
    env_file = Path(env_file or dw.ENV_FILE)
    if not env_file.exists():
        return ''
    for line in env_file.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            if k.strip() == key:
                return v.strip()
    return ''


def put_secret(tok, acct, worker, name, value):
    """Add or replace ONE secret_text binding. Returns (status, body)."""
    body = json.dumps({'name': name, 'text': value, 'type': 'secret_text'}).encode()
    return dw.cf(tok, 'PUT', f'/accounts/{acct}/workers/scripts/{worker}/secrets', body, 'application/json')


def bindings_of(tok, acct, worker):
    """[(type, name)] of every binding the Worker has now, or None if settings could not be read."""
    st, d = dw.cf(tok, 'GET', f'/accounts/{acct}/workers/scripts/{worker}/settings')
    if st != 200:
        return None, dw.errors(d)
    return [(b.get('type'), b.get('name')) for b in (d.get('result') or {}).get('bindings', [])], ''


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    flags = [a for a in argv if a.startswith('--')]
    args = [a for a in argv if not a.startswith('--')]
    from_env = None
    if '--from-env' in flags:
        i = argv.index('--from-env')
        if i + 1 >= len(argv) or argv[i + 1].startswith('--'):
            die('--from-env needs the env file key after it')
        from_env = argv[i + 1]
        args = [a for a in args if a != from_env]
        flags = [f for f in flags if f != '--from-env']
    unknown = sorted(set(flags) - {'--live'})
    if unknown:
        die('unknown flag(s): ' + ', '.join(unknown))
    if len(args) != 2:
        die('usage: set-worker-secret.py --live <worker name> <SECRET_NAME> [--from-env <env key>]')
    worker, name = args
    if worker not in LIVE:
        die(f'{worker} is not a LIVE Worker this tool knows ({", ".join(sorted(LIVE))}). '
            'Staging secrets go through the dashboard.')
    if '--live' not in flags:
        die(f'{worker} is LIVE (a venue is on it). Add --live if you mean it.')
    if not NAME_RE.match(name):
        die(f'{name!r} is not a secret name (SHOUTING_SNAKE_CASE, letters, digits and underscores)')
    key = from_env or name
    if not NAME_RE.match(key):
        die(f'{key!r} is not an env file key')
    value = read_env_value(key)
    if value:
        _SCRUB.append(value)
    if not value:
        die(f'{key} is missing or empty in {dw.ENV_FILE}. Put it there (mode 600) and run again. '
            'Never paste it into chat.')
    tok, acct = dw.creds()
    _SCRUB.extend([tok])
    say(f'SET SECRET {name} on {worker}  (LIVE)  value from {dw.ENV_FILE.name}:{key}, {len(value)} characters, never shown')

    before, err = bindings_of(tok, acct, worker)
    if before is None:
        die(f'could not read settings of {worker}: {err}')
    had = any(t == 'secret_text' and n == name for t, n in before)
    say(f'  before: {len(before)} binding(s); {name} is {"already there (will be replaced)" if had else "not there yet"}')

    st, d = put_secret(tok, acct, worker, name, value)
    if st not in (200, 201) or not d.get('success', True):   # 29 Oct 2026: Cloudflare answers 201 when a secret is created
        die(f'Cloudflare refused the secret ({st}): {dw.errors(d)}')
    say(f'  Cloudflare accepted {name} as secret_text')

    after, err = bindings_of(tok, acct, worker)
    if after is None:
        say(f'  could not read settings back: {err}')
        say('EXIT 2 (the PUT was accepted but the binding is not confirmed)')
        sys.exit(2)
    present = any(t == 'secret_text' and n == name for t, n in after)
    lost = sorted(set(before) - set(after))
    if lost:
        say(f'  bindings LOST: {lost}. Re-add them in the dashboard before anything else.')
        say('EXIT 2 (the PUT was accepted but other bindings are gone)')
        sys.exit(2)
    if not present:
        say(f'  {name} is NOT in the binding list after the PUT: {[n for _, n in after]}')
        say('EXIT 2 (the PUT was accepted but the binding is not confirmed)')
        sys.exit(2)
    say(f'  after: {len(after)} binding(s); {name} is bound as secret_text (confirmed by name; Cloudflare never returns values)')
    say(f'SET and confirmed: {name} on {worker}')
    say('EXIT 0')
    sys.exit(0)


if __name__ == '__main__':
    main()
