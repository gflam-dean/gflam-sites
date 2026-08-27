#!/usr/bin/env python3
"""Fail if any inline script calls a function that is never defined.

This exists because two showstoppers shipped: play.html called showCamera() and
run.html called runBingo(), neither of which existed. Both pages returned HTTP
200 the whole time, so the old smoke test was perfectly happy.

Deliberately naive and deliberately NOT clever about strings: an earlier version
tried to strip string literals first and an apostrophe in a comment ("host's")
opened a fake string that swallowed real code, so it reported half the codebase
as missing. Instead we keep a list of the CSS functions that appear inside our
style strings and ignore those by name.
"""
import io, os, re, glob, sys

CSS = set("""clamp var calc rgba rgb hsl hsla translate translateX translateY scale
 rotate url linear-gradient radial-gradient cubic-bezier minmax repeat blur
 drop-shadow env attr counter""".split())

BUILTIN = set("""if for while switch catch function return typeof new delete void do else try
 parseInt parseFloat Number String Boolean Array Object JSON Math Date Promise RegExp Error
 TypeError Intl Blob File FormData URL URLSearchParams Image MediaRecorder Uint8Array Uint32Array
 setTimeout setInterval clearTimeout clearInterval fetch alert confirm prompt requestAnimationFrame
 encodeURIComponent decodeURIComponent isNaN isFinite console document window navigator localStorage
 sessionStorage crypto Intl gtag dataLayer supabase
 PPConfig PPLicence PPTicket PPQuiz PPPhoto PPVideo""".split())

def javascript_in(path):
    """The script a file actually runs.

    A .js file is all script. An HTML file is whatever is inside <script> tags
    that have no src, INCLUDING ones with attributes: the old pattern was a bare
    <script> and quietly skipped every <script type="module"> and every tag with
    so much as a defer on it.
    """
    src = io.open(path, encoding="utf-8").read()
    if path.endswith(".js"):
        return src
    return "\n".join(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", src, re.S))


# Files named on the command line, or every page and shared script if none are.
# The old version globbed site/*.html and IGNORED its arguments entirely, so
# running it on a Worker reported "ok" without ever opening the file. That is how
# a call to a function that does not exist reached production twice.
targets = [a for a in sys.argv[1:] if not a.startswith("-")]
if not targets:
    targets = sorted(glob.glob("site/*.html")) + sorted(glob.glob("site/lib/*.js")) \
            + sorted(glob.glob("lib/*.js"))
    # Test files run under jsc, not a browser, and use its print/readFile. They
    # ship to nobody, so checking them only produces noise.
    targets = [t for t in targets if not t.endswith(".test.js")]

missing_files = [t for t in targets if not os.path.isfile(t)]
for t in missing_files:
    print("  FAIL %s does not exist" % t)

bad = len(missing_files)
checked = 0
for f in [t for t in targets if os.path.isfile(t)]:
    js = javascript_in(f)
    if not js.strip():
        print("  note %-38s no script in it, nothing to check" % f)
        continue
    checked += 1

    defined = set()
    defined |= set(re.findall(r"function\s+([A-Za-z_$][\w$]*)", js))          # function foo(
    defined |= set(re.findall(r"(?:var|let|const)\s+([A-Za-z_$][\w$]*)", js)) # var foo =
    for m in re.finditer(r"function[^(]*\(([^)]*)\)", js):                    # parameters
        for a in m.group(1).split(","):
            a = a.strip()
            if a:
                defined.add(a)

    # A real call has no space before the bracket. Prose does: "the host brought (or
    # picked)". That one rule removes almost every false positive without needing
    # to parse strings, which is the thing that went wrong last time.
    called = set(re.findall(r"(?<![.\w$])([a-z_$][\w$]*)\(", js))
    missing = sorted(called - defined - BUILTIN - CSS)
    if missing:
        print("  FAIL %-16s calls but never defines: %s" % (f, ", ".join(missing)))
        bad += 1

if bad:
    print("  %d file(s) would throw a ReferenceError at runtime" % bad)
else:
    print("  ok   every function called is defined, across %d file%s"
          % (checked, "" if checked == 1 else "s"))
sys.exit(1 if bad else 0)
