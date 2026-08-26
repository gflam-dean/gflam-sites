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
import io, re, glob, sys

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

bad = 0
for f in sorted(glob.glob("site/*.html")):
    src = io.open(f, encoding="utf-8").read()
    js = "\n".join(re.findall(r"<script>(.*?)</script>", src, re.S))
    if not js.strip():
        continue

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
    print("  ok   every function called is defined")
sys.exit(1 if bad else 0)
