#!/usr/bin/env python3
"""Deploy a Worker file to a named Cloudflare Worker over the API. No dashboard, no paste.

    python3 tools/deploy-worker.py venueplay-game-sydney venueplay-backend/worker/venueplay-game.js
    python3 tools/deploy-worker.py --live venueplay-game venueplay-backend/worker/venueplay-game.js
    python3 tools/deploy-worker.py --list

What it does, in order, and it stops at the first thing that is wrong:
  1. Reads CF_API_TOKEN and CF_ACCOUNT_ID from ~/.gflam-migrate.env (mode 600, outside
     the repo). Never prints either.
  2. Refuses a file whose BUILD stamp does not match its own contents (run
     tools/stamp-workers.py first), because /health would then report a build that is not
     the one running, and that is the one number every check trusts.
  3. Refuses a LIVE Worker (one a venue is on) unless --live is given, and refuses the
     wrong file for a slot by name: venueplay-game.js only goes to a Worker whose name
     starts venueplay-game, and so on. On 31 Aug the game Worker was pasted into the
     billing slot and nobody could sign up until it was noticed. Not again.
  4. Uploads the file, KEEPING every variable, secret and binding the Worker already has
     (Cloudflare's keep_bindings). Variables are set in the dashboard; this only ships code.
  5. Waits until the Worker's own /health answers with the file's build stamp, and says so.
     "It uploaded" is not evidence; /health answering with the right build is.

The token can only edit Workers (the "Edit Cloudflare Workers" template): no DNS, no
billing, no Pages.

--do-class=VenueRoom (added 9 Sep 2026 for the room server, see
venueplay-backend/worker/ROOM-SERVER.md; NOT YET EXERCISED against the API): binds a
Durable Object class the file exports as env.ROOM. The first time the class is seen on
that Worker the upload carries a new_sqlite_classes migration; every time after, the
existing binding is simply kept, because Cloudflare rejects a "new class" migration for
a class that already exists. Needs the Workers Paid plan for anything beyond 100k
requests a day. Staging first, always.
"""
import io, json, re, sys, time, urllib.request, urllib.error
from pathlib import Path

ENV_FILE = Path.home() / '.gflam-migrate.env'
REPO = Path(__file__).resolve().parents[1]
API = 'https://api.cloudflare.com/client/v4'
HEALTH_HOST = '{name}.dean-tindale.workers.dev'

# A venue is on these. Anything else is staging and may be deployed freely.
LIVE = {'venueplay-game', 'venueplay-api', 'partyplay-api', 'touring-api', 'venueplay-sms', 'drag-bingo-music'}
# Which file belongs in which slot. The slot name must START with the key.
SLOT_OF_FILE = {
    'venueplay-game.js':            'venueplay-game',
    'venueplay-api-FULL.js':        'venueplay-api',
    'DEPLOY-partyplay-api.js':      'partyplay-api',
    'touring-api.js':               'touring-api',
    'venueplay-sms-hook.js':        'venueplay-sms',
}
NEVER_PASTE = {'venueplay-api.js', 'SOURCE-do-not-paste-partyplay-api.js'}   # stubs and sources

sys.path.insert(0, str(REPO / 'tools'))
from stamp_workers import fingerprint, STAMP   # the same hash the gate and /health use

def die(msg):
    print('STOP: ' + msg); sys.exit(1)

def creds():
    if not ENV_FILE.exists(): die(f'{ENV_FILE} is missing')
    if oct(ENV_FILE.stat().st_mode)[-3:] != '600': die(f'{ENV_FILE} must be mode 600')
    e = {}
    for line in ENV_FILE.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip()
    tok, acct = e.get('CF_API_TOKEN', ''), e.get('CF_ACCOUNT_ID', '')
    if not tok.startswith('cfut_') and not re.fullmatch(r'[A-Za-z0-9_-]{30,}', tok): die('CF_API_TOKEN is not set in the env file')
    if not re.fullmatch(r'[0-9a-f]{32}', acct): die('CF_ACCOUNT_ID is not set (32 hex characters) in the env file')
    return tok, acct

def cf(tok, method, path, body=None, content_type=None):
    req = urllib.request.Request(API + path, data=body, method=method, headers={'Authorization': 'Bearer ' + tok})
    if content_type: req.add_header('Content-Type', content_type)
    try:
        r = urllib.request.urlopen(req, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as x:
        try: return x.code, json.loads(x.read())
        except Exception: return x.code, {'errors': [{'message': 'unreadable error body'}]}

def errors(d):
    return '; '.join(str(m.get('message')) for m in d.get('errors', [])) or 'unknown error'

def list_workers(tok, acct):
    st, d = cf(tok, 'GET', f'/accounts/{acct}/workers/scripts')
    if st != 200: die('could not list Workers: ' + errors(d))
    for s in sorted(d['result'], key=lambda s: s['id']):
        name = s['id']
        health = fetch_health(name)
        print(f"  {'LIVE   ' if name in LIVE else 'staging'}  {name:<24} {health}")

def fetch_health(name):
    req = urllib.request.Request(f'https://{HEALTH_HOST.format(name=name)}/health', headers={'User-Agent': 'venueplay-deploy/1.0'})
    try:
        r = urllib.request.urlopen(req, timeout=15); d = json.loads(r.read())
        return f"build {d.get('build', '?')}" + ('' if d.get('ok') else f"  NOT OK missing={d.get('missing')}")
    except urllib.error.HTTPError as x:
        return f'/health answered {x.code}'
    except Exception as x:
        return f'/health unreachable ({type(x).__name__})'

DO_BINDING = 'ROOM'   # the name the Worker reads: env.ROOM

def upload(tok, acct, name, path, do_class=None):
    src = path.read_text()
    m = STAMP.search(src)
    if not m: die(f'{path.name} has no BUILD stamp line; run tools/stamp-workers.py')
    stamped, actual = m.group(1), fingerprint(src)
    if stamped != actual: die(f'{path.name} is stamped {stamped} but hashes to {actual}; run tools/stamp-workers.py')
    if do_class and not re.search(r'^export\s+class\s+' + re.escape(do_class) + r'\b', src, re.M):
        die(f'{path.name} does not "export class {do_class}"; a Durable Object binding to it would fail at upload')
    # current settings: keep the compatibility date and confirm the bindings we are keeping
    st, d = cf(tok, 'GET', f'/accounts/{acct}/workers/scripts/{name}/settings')
    if st != 200: die(f'could not read settings of {name}: ' + errors(d))
    cur = d['result']
    kept = [(b['type'], b['name']) for b in cur.get('bindings', [])]
    print(f"  keeping {len(kept)} binding(s): " + ', '.join(n for _, n in kept))
    meta = {
        'main_module': 'worker.js',
        'compatibility_date': cur.get('compatibility_date') or '2026-01-01',
        'compatibility_flags': cur.get('compatibility_flags') or [],
        'keep_bindings': sorted({t for t, _ in kept} | {'secret_text', 'plain_text', 'kv_namespace'}),
    }
    if do_class:
        have = [b for b in cur.get('bindings', []) if b.get('type') == 'durable_object_namespace' and b.get('class_name') == do_class]
        if have:
            print(f'  Durable Object {do_class} already bound as {have[0].get("name")}; keeping it')
        else:
            # First time: the class must be created by a migration in the same upload, and the
            # binding is sent explicitly (keep_bindings only keeps what already exists).
            meta['migrations'] = {'new_sqlite_classes': [do_class]}
            meta['bindings'] = [{'type': 'durable_object_namespace', 'name': DO_BINDING, 'class_name': do_class}]
            print(f'  first deploy of Durable Object {do_class}: creating it and binding it as {DO_BINDING}')
    boundary = 'vp' + str(int(time.time() * 1000))
    body = io.BytesIO()
    def part(fieldname, filename, ctype, data):
        body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{fieldname}"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode())
        body.write(data); body.write(b'\r\n')
    part('metadata', 'metadata.json', 'application/json', json.dumps(meta).encode())
    part('worker.js', 'worker.js', 'application/javascript+module', src.encode())
    body.write(f'--{boundary}--\r\n'.encode())
    st, d = cf(tok, 'PUT', f'/accounts/{acct}/workers/scripts/{name}', body.getvalue(), f'multipart/form-data; boundary={boundary}')
    if st != 200: die(f'upload to {name} failed ({st}): ' + errors(d))
    print(f'  uploaded {path.name} ({len(src):,} bytes) to {name}')
    # after: bindings still there?
    st, d = cf(tok, 'GET', f'/accounts/{acct}/workers/scripts/{name}/settings')
    after = [(b['type'], b['name']) for b in d.get('result', {}).get('bindings', [])] if st == 200 else []
    lost = sorted(set(kept) - set(after))
    if lost: die(f'bindings LOST in the upload: {lost}. Re-add them in the dashboard before anything else.')
    return stamped

def wait_for_build(name, stamp, seconds=90):
    t0 = time.time()
    while time.time() - t0 < seconds:
        h = fetch_health(name)
        if stamp in h and 'NOT OK' not in h:
            print(f'  /health on {name}: {h}  ({time.time() - t0:.0f}s)'); return True
        time.sleep(3)
    print(f'  /health on {name} after {seconds}s: {h}'); return False

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    tok, acct = creds()
    if '--list' in flags or not args:
        print('Workers in the account (build per /health):'); list_workers(tok, acct); return
    if len(args) != 2: die('usage: deploy-worker.py [--live] <worker name> <file>')
    name, path = args[0], (REPO / args[1]).resolve() if not Path(args[1]).is_absolute() else Path(args[1])
    if not path.exists(): die(f'{path} does not exist')
    if path.name in NEVER_PASTE: die(f'{path.name} is a stub or a source file, never deployed. See the CLAUDE.md deploy rules.')
    slot = SLOT_OF_FILE.get(path.name)
    if not slot: die(f'{path.name} is not a Worker file this tool knows ({", ".join(SLOT_OF_FILE)})')
    if not name.startswith(slot): die(f'{path.name} belongs in a Worker named {slot}*, not {name}')
    if name in LIVE and '--live' not in flags: die(f'{name} is LIVE (a venue is on it). Add --live if you mean it, after the gate is green.')
    do_class = None
    for f in flags:
        if f.startswith('--do-class='):
            do_class = f.split('=', 1)[1]
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', do_class): die(f'--do-class needs a class name, got {do_class!r}')
    unknown = flags - {'--live', '--list'} - {f for f in flags if f.startswith('--do-class=')}
    if unknown: die('unknown flag(s): ' + ', '.join(sorted(unknown)))
    print(f"DEPLOY {path.name} -> {name}{'  (LIVE)' if name in LIVE else '  (staging)'}")
    print(f'  before: {fetch_health(name)}')
    stamp = upload(tok, acct, name, path, do_class)
    ok = wait_for_build(name, stamp)
    print('DEPLOYED and proved by /health' if ok else 'UPLOADED but /health has not confirmed the build; do not trust it yet')
    sys.exit(0 if ok else 2)

if __name__ == '__main__':
    main()
