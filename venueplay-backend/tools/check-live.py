#!/usr/bin/env python3
"""
Post-deploy check for VenuePlay. Run it after pushing the site and pasting both Workers.

    python3 tools/check-live.py

It only touches PUBLIC endpoints, so it needs no keys and cannot change anything. It will not
prove a whole trivia night works (nothing but a real night does that), but it catches the things
that silently break a launch: a Worker that did not deploy, CORS blocking the apex, source files
still downloadable, and the migrations that must be in place for billing to count people.

Exit code 0 = everything passed. 1 = something needs looking at.
"""

import json
import sys
import urllib.error
import urllib.request

SITE = "https://www.venueplay.com.au"
APEX = "https://venueplay.com.au"
GAME = "https://venueplay-game.dean-tindale.workers.dev"
BILLING = "https://venueplay-api.dean-tindale.workers.dev"
TIMEOUT = 15

results = []


def record(ok, name, detail=""):
    results.append((ok, name, detail))
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  " + detail) if detail else ""))


# Cloudflare's browser check answers a bare urllib request with HTTP 403 error 1010, which looks
# exactly like "everything is broken". Identify as a normal browser so the results mean something.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def get(url, headers=None, method="GET", body=None):
    req = urllib.request.Request(url, method=method, data=body)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "*/*")
    req.add_header("Accept-Language", "en-AU,en;q=0.9")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    except Exception as e:                      # DNS, TLS, timeout
        return 0, {}, str(e)


print("\nVenuePlay live check\n" + "=" * 60)

print("\nSite")
code, _, body = get(SITE + "/")
record(code == 200, "home page loads", "HTTP %s" % code)
record("venueplay" in body.lower(), "home page has content")
# The overage sentence that used to contradict the terms and the code.
record("your plan just grows to match what you use" not in body,
       "old overage wording is gone from the home page")
record("creativecommons.org/licenses/by-sa" in body,
       "trivia licence attribution present")

code, _, body = get(SITE + "/privacy")
record(code == 200 and "opt out" in body.lower() or "opt-out" in body.lower(),
       "privacy page mentions opting out", "HTTP %s" % code)
record("future feature" not in body.lower(),
       "privacy page no longer calls player capture a future feature")

print("\nSource files must NOT be downloadable")
# These are no longer in the deployed directory at all (they live in venueplay-backend/),
# which is the only reliable way: a _redirects rule cannot stop Pages serving a file that
# is present, and a 404 status in _redirects is silently ignored.
for path in ["/supabase/venueplay-17-manager-permissions.sql",
             "/worker/venueplay-game.js",
             "/worker/venueplay-api-FULL.js",
             "/seed-trivia-TEST.sql",
             "/seed-trivia.py",
             "/data/trivia-library.json",
             "/data/musical-library-full.json"]:
    code, _, _ = get(SITE + path)
    record(code in (403, 404), "not published: " + path, "HTTP %s" % code)

print("\nFiles the site DOES need must still be there")
for path in ["/data/musical-library.json", "/data/trivia-count.json"]:
    code, _, body = get(SITE + path)
    record(code == 200 and body.strip().startswith("{"), "served: " + path, "HTTP %s" % code)

print("\nRobots and sitemap")
code, _, body = get(SITE + "/robots.txt")
record(code == 200 and "sitemap" in body.lower(), "robots.txt served", "HTTP %s" % code)
code, _, body = get(SITE + "/sitemap.xml")
record(code == 200 and "<urlset" in body, "sitemap.xml served", "HTTP %s" % code)

print("\nGame Worker")
code, hdrs, body = get(GAME + "/venue?code=ZZZZZZ")
record(code == 200, "game Worker is up", "HTTP %s" % code)
try:
    record(json.loads(body).get("exists") is False,
           "unknown venue code answers cleanly")
except Exception:
    record(False, "unknown venue code answers cleanly", body[:80])

# CORS from the apex was blocked before, which killed the host console for anyone
# who typed the address without www.
for origin in (SITE, APEX):
    code, hdrs, _ = get(GAME + "/venue?code=ZZZZZZ", headers={"Origin": origin})
    alw = hdrs.get("Access-Control-Allow-Origin", "")
    record(alw in (origin, "*"), "CORS allows " + origin, "got '%s'" % alw)

# /join/info must return the venue name, which the collection notice depends on.
code, _, body = get(GAME + "/join/info", method="POST",
                    headers={"Content-Type": "application/json"},
                    body=json.dumps({"code": "ZZZZZZ"}).encode())
record(code == 200, "/join/info responds", "HTTP %s" % code)
try:
    record("venue_name" in json.loads(body),
           "/join/info returns venue_name (collection notice needs it)")
except Exception:
    record(False, "/join/info returns venue_name", body[:80])

print("\nBilling Worker")
code, hdrs, _ = get(BILLING + "/", headers={"Origin": SITE})
record(code != 0, "billing Worker reachable", "HTTP %s" % code)
alw = hdrs.get("Access-Control-Allow-Origin", "")
record(alw in (SITE, "*", ""), "billing CORS sane", "got '%s'" % alw)

print("\n" + "=" * 60)
failed = [r for r in results if not r[0]]
print("%d checks, %d failed" % (len(results), len(failed)))
if failed:
    print("\nLook at these:")
    for _, name, detail in failed:
        print("  - " + name + (("  (" + detail + ")") if detail else ""))
    print("\nA failing Worker check usually means it was not pasted/deployed.")
    print("A failing 'blocked' check means _redirects did not deploy.")
    sys.exit(1)
print("\nAll good. This does not replace running a real night: see the test list in the report.")
sys.exit(0)
