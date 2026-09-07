#!/usr/bin/env python3
"""Fail if any inline script calls a function that is never defined.

This exists because two showstoppers shipped: play.html called showCamera() and
run.html called runBingo(), neither of which existed. Both pages returned HTTP
200 the whole time, so the old smoke test was perfectly happy.

Comments ARE stripped, by a scanner that tracks state rather than a regex. An
earlier attempt used a regex, an apostrophe in a comment ("host\'s") opened a
fake string, and it swallowed real code and reported half the codebase missing.
A scanner does not have that problem: it knows whether it is inside a string
before it decides what a quote means. Without this, a function named in a comment
("see claimIdentity() in play.html") counted as a call, and five perfectly good
files reported as broken.

Strings are left ALONE on purpose, which is why the CSS list below exists: the
style text inside them mentions clamp() and var() and those are not calls.
"""
import io, os, re, glob, sys

CSS = set("""clamp var calc rgba rgb hsl hsla translate translateX translateY scale
 rotate url linear-gradient radial-gradient cubic-bezier minmax repeat blur
 drop-shadow env attr counter""".split())
# cubic-bezier( matches as bezier(, because a hyphen cannot be part of a JS name.
CSS |= {w.split("-")[-1] for w in list(CSS) if "-" in w}

BUILTIN = set("""if for while switch catch function return typeof new delete void do else try
 parseInt parseFloat Number String Boolean Array Object JSON Math Date Promise RegExp Error
 TypeError Intl Blob File FormData URL URLSearchParams Image MediaRecorder Uint8Array Uint32Array
 setTimeout setInterval clearTimeout clearInterval fetch alert confirm prompt requestAnimationFrame
 encodeURIComponent decodeURIComponent isNaN isFinite console document window navigator localStorage
 sessionStorage crypto Intl gtag dataLayer supabase
 atob btoa getComputedStyle encodeURI decodeURI structuredClone queueMicrotask
 AbortController Headers Request Response AudioContext webkitAudioContext
 IntersectionObserver ResizeObserver MutationObserver
 fbq
 PPConfig PPLicence PPTicket PPQuiz PPPhoto PPVideo VPSign VPGaming VPFollow VPScreenRouter""".split())

def strip_comments(src):
    """Remove // and /* */ while knowing what is a string and what is not.

    The cases that matter, all of which have bitten us:
      "https://x"    the // is inside a string and is not a comment
      // host\'s        the apostrophe is in a comment and opens nothing
      /* it\'s fine */  same, in a block
      `a ${b} c`      template literals
    """
    out = []
    i, n = 0, len(src)
    quote = None            # the character that opened the string we are in
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\":
                if i + 1 < n:
                    out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            elif c == "\n" and quote != "`":
                # SELF-HEALING. A ' or " string cannot span a newline in
                # JavaScript, so if we are still "inside" one at the end of a
                # line we were wrong: almost always a quote inside a regex
                # literal, like replace(/'/g, ""). Without this the scanner
                # treated the whole rest of the file as one long string, no
                # comment after that point was ever removed, and functions named
                # in comments read as undefined calls. Only backticks may run on.
                quote = None
            i += 1
            continue
        if c in "\"\'`":
            quote = c
            out.append(c)
            i += 1
            continue
        # A REGEX LITERAL IS NOT CODE EITHER.
        #
        # tv.html carries /(^|\/)tv(\.html)?$/i, and "tv(" inside it read as a
        # call to a function named tv. It went unnoticed for as long as that
        # file happened to have a local `var tv` somewhere, and surfaced the day
        # a refactor removed it - as a FAILING gate on a correct change, which
        # is the most expensive kind of false alarm: it teaches people that red
        # means nothing.
        #
        # Telling a regex from a division is the classic ambiguity. The standard
        # test is what came before it: after a value (an identifier, a number, a
        # closing bracket) a slash is division, and after an operator, a comma,
        # an opening bracket or the start of a statement it opens a regex.
        if c == "/" and i + 1 < n and src[i + 1] not in "/*":
            k = len(out) - 1
            while k >= 0 and out[k] in " \t\n":
                k -= 1
            prev = out[k] if k >= 0 else ""
            if prev == "" or prev in "(,=:[!&|?{};+-*%<>~^":
                j = i + 1
                while j < n:
                    if src[j] == "\\":
                        j += 2
                        continue
                    if src[j] == "\n":
                        break            # a regex cannot span a line: we were wrong
                    if src[j] == "/":
                        while j + 1 < n and src[j + 1].isalpha():
                            j += 1       # trailing flags
                        out.append(" ")  # the whole literal becomes whitespace
                        i = j + 1
                        break
                    j += 1
                else:
                    j = n
                if i == j + 1 or (j < n and src[j] == "/"):
                    continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            i += 2
            while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def javascript_in(path):
    """The script a file actually runs.

    A .js file is all script. An HTML file is whatever is inside <script> tags
    that have no src, INCLUDING ones with attributes: the old pattern was a bare
    <script> and quietly skipped every <script type="module"> and every tag with
    so much as a defer on it.
    """
    src = io.open(path, encoding="utf-8").read()
    if path.endswith(".js"):
        # `export default` is a module keyword; the checker only wants the body.
        return strip_comments(re.sub(r"^export default", "var _x =", src, flags=re.M))
    out = []
    for tag, body in re.findall(r"(<script(?![^>]*\bsrc=)[^>]*>)(.*?)</script>", src, re.S):
        t = re.search(r"type\s*=\s*[\"\']([^\"\']+)", tag)
        # application/ld+json is data for search engines, not code.
        if t and not re.match(r"(text/javascript|module|application/javascript)$", t.group(1).strip()):
            continue
        out.append(body)
    return strip_comments("\n".join(out))


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
    # `var a = 1, b = 2, c = 3` used to register only `a`, so b and c read as
    # undefined. Take every name in the declaration list.
    for decl in re.findall(r"(?:var|let|const)\s+([^;\n]{0,400})", js):
        for nm in re.findall(r"(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?==|,|$)", decl):
            defined.add(nm)
    defined |= set(re.findall(r"(?:var|let|const)\s+([A-Za-z_$][\w$]*)", js))
    # Object-method shorthand: `async scheduled(event, env, ctx) {` and
    # `fetch(request, env) {`. Without this the DEFINITION reads as a call to
    # itself, and a Worker's own entry points were reported as undefined.
    defined |= set(re.findall(r"(?m)^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{", js))
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
