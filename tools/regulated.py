#!/usr/bin/env python3
"""THE REGULATED BINGO CODE CANNOT CHANGE SILENTLY (Dean, 19 Oct 2026: "it has to be perfect and nothing can
change those OLGR settings").

The bingo draw, ticket maker, claim rule and tablet-fallback switch live in two files, named and versioned
together as VP-DRAW:

    venueplay-backend/worker/vp-draw.js   the server half (copied into venueplay-game.js, which deploys as one file)
    venueplay/app/vp-draw.js              the tablet half (loaded by the bingo console)

tools/regulated-manifest.json holds the version and a SHA-256 of each file, and one hash over all of it
(the manifest hash). The game Worker carries that hash as VP_DRAW_MANIFEST and reports it, with the
version, on /health, so what is running can be checked against what was described to OLGR.

    python3 tools/regulated.py --check     the gate runs this: exit 1 on anything below
    python3 tools/regulated.py --update    after a deliberate change: copies the Worker module into
                                           venueplay-game.js, rewrites the manifest and VP_DRAW_MANIFEST.
                                           REFUSES unless the version was raised in BOTH halves.
                                           Then run tools/stamp-workers.py.

--check fails when:
  1. the copy of the Worker module inside venueplay-game.js differs from the module by one byte
  2. either file's SHA-256 differs from the manifest (changed without --update)
  3. the version in either half differs from the manifest's, or from the other half
  4. the switch (TABLET_FALLBACK_OFF_STATES) differs between the two halves
  5. VP_DRAW_MANIFEST / VP_DRAW_VERSION in the Worker differ from the manifest
  6. against the manifest on origin/main (what is live), a file changed but the version did not.
     Skipped, and said so, where there is no git history (a scratch copy) or main has no manifest yet.
"""
import hashlib, io, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER_MODULE = 'venueplay-backend/worker/vp-draw.js'
CONSOLE_MODULE = 'venueplay/app/vp-draw.js'
FILES = [WORKER_MODULE, CONSOLE_MODULE]
GAME = 'venueplay-backend/worker/venueplay-game.js'
MANIFEST = 'tools/regulated-manifest.json'
BEGIN = '/* ===== VP-DRAW BEGIN: generated from venueplay-backend/worker/vp-draw.js by tools/regulated.py. Do not edit here. ===== */\n'
END = '/* ===== VP-DRAW END ===== */\n'
PLACEHOLDER = '@@VPDRAW@@\n'


def read(root, rel):
    return io.open(os.path.join(root, rel), encoding='utf-8', newline='').read()


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def worker_version(text):
    m = re.search(r"^const VP_DRAW_VERSION = '([^']+)';", text, re.M)
    return m.group(1) if m else None


def console_version(text):
    m = re.search(r'^\s*var VERSION = "([^"]+)";', text, re.M)
    return m.group(1) if m else None


def worker_switch(text):
    m = re.search(r'^const TABLET_FALLBACK_OFF_STATES = new Set\(\[([^\]]*)\]\);', text, re.M)
    return None if not m else sorted(x.strip().strip('\'"') for x in m.group(1).split(',') if x.strip())


def console_switch(text):
    m = re.search(r'^\s*var TABLET_FALLBACK_OFF_STATES = \[([^\]]*)\];', text, re.M)
    return None if not m else sorted(x.strip().strip('\'"') for x in m.group(1).split(',') if x.strip())


STRIP_BEGIN = '  // ---- VP-STRIP BEGIN'
STRIP_END = '  // ---- VP-STRIP END ----'


def strip_block(text):
    """The shared strip algorithm, as text, or None. Both halves must carry exactly the same block."""
    i, j = text.find(STRIP_BEGIN), text.find(STRIP_END)
    return None if i < 0 or j < i else text[i:j + len(STRIP_END)]


def manifest_hash(version, files):
    lines = [version] + ['%s %s' % (files[k], k) for k in sorted(files)]
    return sha('\n'.join(lines) + '\n')


def inline_block(game, module):
    """venueplay-game.js with the module copied between the markers (or in place of the placeholder)."""
    block = BEGIN + module + ('' if module.endswith('\n') else '\n') + END
    if PLACEHOLDER in game:
        return game.replace(PLACEHOLDER, block, 1)
    i, j = game.find(BEGIN), game.find(END)
    if i < 0 or j < i:
        raise SystemExit('venueplay-game.js has no VP-DRAW markers and no placeholder')
    return game[:i] + block + game[j + len(END):]


def copy_in_game(game):
    i, j = game.find(BEGIN), game.find(END)
    if i < 0 or j < i:
        return None
    return game[i + len(BEGIN):j]


def base_manifest(root):
    """The manifest on origin/main, or None (and why) when there is nothing to compare with."""
    try:
        r = subprocess.run(['git', 'show', 'origin/main:' + MANIFEST], cwd=root, capture_output=True, text=True)
    except Exception as e:
        return None, 'git unavailable (%s)' % e
    if r.returncode != 0:
        return None, 'origin/main has no manifest yet, or this copy has no git history'
    try:
        return json.loads(r.stdout), ''
    except ValueError:
        return None, 'the manifest on origin/main does not parse'


def check(root, base=None, base_why=''):
    """Every problem, as a list of plain sentences. Empty means clean."""
    bad = []
    wm, cm, game = read(root, WORKER_MODULE), read(root, CONSOLE_MODULE), read(root, GAME)
    try:
        man = json.loads(read(root, MANIFEST))
    except Exception:
        return ['tools/regulated-manifest.json is missing or does not parse: run python3 tools/regulated.py --update']
    copy = copy_in_game(game)
    if copy is None:
        bad.append('venueplay-game.js has no VP-DRAW block: run python3 tools/regulated.py --update')
    elif copy != wm and copy != wm + ('' if wm.endswith('\n') else '\n'):
        bad.append('the VP-DRAW copy inside venueplay-game.js differs from venueplay-backend/worker/vp-draw.js: edit the module, never the copy, then --update')
    now = {WORKER_MODULE: sha(wm), CONSOLE_MODULE: sha(cm)}
    for f in FILES:
        if man.get('files', {}).get(f) != now[f]:
            bad.append('%s changed without the manifest: raise the version in both halves and run python3 tools/regulated.py --update' % f)
    wv, cv = worker_version(wm), console_version(cm)
    if not wv or not cv or wv != cv:
        bad.append('the two halves carry different versions (%s, %s)' % (wv, cv))
    if man.get('version') != wv:
        bad.append('the manifest says %s but the module says %s' % (man.get('version'), wv))
    ws, cs = worker_switch(wm), console_switch(cm)
    if ws is None or cs is None or ws != cs:
        bad.append('the tablet fallback switch differs between the halves (server %s, tablet %s)' % (ws, cs))
    sw, sc = strip_block(wm), strip_block(cm)
    if sw is None or sc is None or sw != sc:
        bad.append('the strip algorithm (VP-STRIP) is not the same text in both halves: the tablet must make tickets exactly as the server does')
    if not any(c.get('version') == man.get('version') and c.get('reason') for c in man.get('changes', [])):
        bad.append('the manifest records no reason for version %s: run --update with --reason "why"' % man.get('version'))
    mh = manifest_hash(man.get('version', ''), man.get('files', {}))
    if man.get('manifest_hash') != mh:
        bad.append('the manifest hash does not match its own contents')
    m = re.search(r"^const VP_DRAW_MANIFEST = '([0-9a-f]*)';", game, re.M)
    if not m or m.group(1) != man.get('manifest_hash'):
        bad.append('venueplay-game.js reports a different manifest hash on /health than the manifest (VP_DRAW_MANIFEST)')
    if base is not None:
        changed = [f for f in FILES if base.get('files', {}).get(f) != now[f]]
        if changed and base.get('version') == wv:
            bad.append('%s changed since what is on main but the version is still %s: a regulated change must raise the version' % (', '.join(changed), wv))
    return bad


def update(root, reason=''):
    wm, cm = read(root, WORKER_MODULE), read(root, CONSOLE_MODULE)
    if strip_block(wm) is None or strip_block(wm) != strip_block(cm):
        raise SystemExit('REFUSED: the strip algorithm (VP-STRIP) must be the same text in both halves')
    wv, cv = worker_version(wm), console_version(cm)
    if not wv or wv != cv:
        raise SystemExit('REFUSED: the two halves must carry the same version (server %s, tablet %s)' % (wv, cv))
    if worker_switch(wm) != console_switch(cm):
        raise SystemExit('REFUSED: the tablet fallback switch must be the same list in both halves')
    files = {WORKER_MODULE: sha(wm), CONSOLE_MODULE: sha(cm)}
    try:
        old = json.loads(read(root, MANIFEST))
    except Exception:
        old = None
    if old and old.get('files') != files and old.get('version') == wv:
        raise SystemExit('REFUSED: the regulated files changed but the version is still %s. Raise VP_DRAW_VERSION '
                         'in venueplay-backend/worker/vp-draw.js and VERSION in venueplay/app/vp-draw.js first.' % wv)
    changes = list((old or {}).get('changes', []))
    if not any(c.get('version') == wv for c in changes):
        if not reason:
            raise SystemExit('REFUSED: a new version needs its reason on the record: --reason "what changed and why"')
        changes.append({'version': wv, 'reason': reason})
    elif reason:
        for c in changes:
            if c.get('version') == wv: c['reason'] = reason
    man = {'name': 'VP-DRAW', 'version': wv, 'files': files, 'manifest_hash': manifest_hash(wv, files), 'changes': changes,
           'note': 'Written by tools/regulated.py --update. Never edit by hand: the gate recomputes every hash.'}
    io.open(os.path.join(root, MANIFEST), 'w', encoding='utf-8').write(json.dumps(man, indent=1, sort_keys=True) + '\n')
    game = inline_block(read(root, GAME), wm)
    game, n = re.subn(r"^const VP_DRAW_MANIFEST = '[0-9a-f]*';", "const VP_DRAW_MANIFEST = '%s';" % man['manifest_hash'], game, flags=re.M)
    if n != 1:
        raise SystemExit('venueplay-game.js needs exactly one line: const VP_DRAW_MANIFEST = \'\';')
    io.open(os.path.join(root, GAME), 'w', encoding='utf-8', newline='').write(game)
    print('VP-DRAW %s: manifest %s written; the Worker copy and VP_DRAW_MANIFEST updated. Now run tools/stamp-workers.py.' % (wv, man['manifest_hash'][:12]))


if __name__ == '__main__':
    root = ROOT
    if '--root' in sys.argv:
        root = sys.argv[sys.argv.index('--root') + 1]
    if '--update' in sys.argv:
        update(root, sys.argv[sys.argv.index('--reason') + 1] if '--reason' in sys.argv else '')
        sys.exit(0)
    base, why = (None, 'not asked') if '--no-base' in sys.argv else base_manifest(root)
    problems = check(root, base, why)
    for p in problems:
        print('  FAIL ' + p)
    if base is None:
        print('  note: not compared with what is live (%s)' % why)
    if problems:
        sys.exit(1)
    man = json.loads(read(root, MANIFEST))
    print('VP-DRAW %s, manifest %s: both halves match the manifest' % (man['version'], man['manifest_hash'][:12]))
