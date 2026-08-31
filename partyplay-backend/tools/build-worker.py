#!/usr/bin/env python3
"""Build the paste-able Worker from the source.

The source refers to PPLicence but does not contain it, because the browser
shares that file. This inlines it at the marker, stamps the build, and refuses
to write anything that does not parse.
"""
import io, os, re, subprocess, hashlib, datetime, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'worker', 'SOURCE-do-not-paste-partyplay-api.js')
LIB  = os.path.join(ROOT, 'lib', 'pp-licence.js')
OUT  = os.path.join(ROOT, 'worker', 'DEPLOY-partyplay-api.js')
JSC  = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'

MARK = ('// The licence window rules live in one place and are shared with the browser.\n'
        '// Paste lib/pp-licence.js above this line when deploying, or inline it. It is\n'
        '// referenced here as PPLicence.')

src = io.open(SRC, encoding='utf-8').read()
lib = io.open(LIB, encoding='utf-8').read()

if src.count(MARK) != 1:
    sys.exit('the licence marker is not in the source exactly once, found %d' % src.count(MARK))

# the browser file assigns to module.exports or a global; in the Worker it is
# just a const, so wrap it and take what it exports.
inlined = ('/* ---- lib/pp-licence.js, inlined at build time. Edit the file, not this. ---- */\n'
           'const PPLicence = (function () {\n'
           '  const module = { exports: {} };\n'
           + lib + '\n'
           '  return module.exports;\n'
           '}());\n')
built = src.replace(MARK, inlined)

stamp = datetime.datetime.now().strftime('%d %b %Y, %H:%M:%S')
fp = hashlib.sha256(built.encode('utf-8')).hexdigest()[:12]
header = ('/* PASTE THIS ONE.\n'
          '   Built %s   fingerprint %s\n'
          '   If that time is not within the last few minutes, close this window and reopen. */\n'
          % (stamp, fp))
built = header + built

# It must parse before it is allowed to land on disk.
probe = os.path.join('/tmp', 'pp-build-probe.js')
io.open(probe, 'w', encoding='utf-8').write(re.sub(r'^export default', 'var _d =', built, flags=re.M))
r = subprocess.run([JSC, '-e',
    'try{ new Function(readFile("%s")); print("OK"); }catch(e){ print("ERR "+e); }' % probe],
    capture_output=True, text=True)
if 'OK' not in r.stdout:
    sys.exit('refusing to write, the build does not parse:\n' + r.stdout + r.stderr)

# and PPLicence must actually be reachable, not just syntactically present
r2 = subprocess.run([JSC, '-e',
    'var f=new Function(readFile("%s")+"\\n; return typeof PPLicence===\\"object\\" && typeof PPLicence.plan===\\"function\\";");'
    'print(f() ? "LIVE" : "DEAD");' % probe], capture_output=True, text=True)
if 'LIVE' not in r2.stdout:
    sys.exit('refusing to write, PPLicence did not inline correctly:\n' + r2.stdout + r2.stderr)

# Atomic: a half-written Worker is a file somebody could paste. See stamp-workers.py.
_tmp = OUT + '.writing'
with io.open(_tmp, 'w', encoding='utf-8') as _f:
    _f.write(built); _f.flush(); os.fsync(_f.fileno())
os.replace(_tmp, OUT)
print('  %s' % OUT)
print('  %d lines, fingerprint %s, built %s' % (built.count('\n') + 1, fp, stamp))
