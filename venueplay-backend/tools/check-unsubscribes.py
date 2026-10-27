#!/usr/bin/env python3
"""Who has asked us to stop, and is anyone still on a send list?

The Spam Act does not care that the opt-out was recorded. It cares that the next
send honours it. So this does both jobs: prints the opt-out list, and checks it
against every CSV that is used for sending.

Run it BEFORE every send, the way check-data.py is run before quoting a number:

    python3 venueplay-backend/tools/check-unsubscribes.py
    python3 venueplay-backend/tools/check-unsubscribes.py --strip

--strip rewrites the send CSVs with the opted-out rows removed, keeping a
.pre-unsub backup of each. Without it, nothing is changed and it only reports.

Credentials come from ~/.gflam-migrate.env and are never printed.
"""
import csv, glob, json, os, sys, urllib.request, urllib.error
from pathlib import Path

ENV  = Path.home() / ".gflam-migrate.env"
LIST = os.path.expanduser("~/venue-enrich")

def die(m):
    print("STOP: " + m); sys.exit(1)

def creds():
    if not ENV.exists(): die("%s is missing" % ENV)
    if oct(ENV.stat().st_mode)[-3:] != "600": die("%s must be mode 600" % ENV)
    e = {}
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); e[k.strip()] = v.strip()
    u, k = e.get("NEW_SUPABASE_URL", ""), e.get("NEW_SERVICE_KEY", "")
    if not u or not k:
        die("NEW_SUPABASE_URL and NEW_SERVICE_KEY must be in %s" % ENV)
    return u, k

def opted_out(url, key):
    """Read the whole list. Service role only: anon cannot select this table."""
    out, offset = set(), 0
    while True:
        req = urllib.request.Request(
            "%s/rest/v1/vp_unsubscribes?select=email&limit=1000&offset=%d" % (url, offset),
            headers={"apikey": key, "Authorization": "Bearer " + key,
                     "User-Agent": "curl/8.7.1", "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                rows = json.loads(r.read() or b"[]")
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf8", "replace")
            if "vp_unsubscribes" in body and "does not exist" in body:
                die("the vp_unsubscribes table is not in the database yet.\n"
                    "      Run venueplay-backend/supabase/venueplay-81-outreach-unsubscribes.sql first.")
            die("could not read the list: HTTP %s %s" % (e.code, body))
        if not rows: break
        for r in rows:
            e_ = (r.get("email") or "").strip().lower()
            if e_: out.add(e_)
        if len(rows) < 1000: break
        offset += 1000
    return out

def main():
    strip = "--strip" in sys.argv
    url, key = creds()
    stop = opted_out(url, key)
    print("opted out: %d address(es)\n" % len(stop))

    files = sorted(glob.glob(os.path.join(LIST, "*.csv")) +
                   glob.glob(os.path.join(LIST, "partyplay", "*.csv")))
    files = [f for f in files if "pre-unsub" not in f and "pre-verify" not in f]
    if not files:
        print("no send lists found in %s" % LIST); return

    total_hits = 0
    for f in files:
        try:
            rows = list(csv.DictReader(open(f, encoding="utf-8-sig")))
        except Exception:
            continue
        if not rows or "email" not in rows[0]:
            continue
        hits = [r for r in rows if (r.get("email") or "").strip().lower() in stop]
        if not hits:
            print("  ok   %-46s %5d rows" % (os.path.basename(f), len(rows)))
            continue
        total_hits += len(hits)
        print("  HIT  %-46s %5d rows, %d opted out" % (os.path.basename(f), len(rows), len(hits)))
        for h in hits[:3]:
            print("         %s" % h.get("email"))
        if strip:
            os.replace(f, f + ".pre-unsub")
            keep = [r for r in rows if (r.get("email") or "").strip().lower() not in stop]
            with open(f, "w", newline="", encoding="utf-8") as out:
                w = csv.DictWriter(out, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(keep)
            print("         stripped, %d -> %d" % (len(rows), len(keep)))

    print()
    if total_hits and not strip:
        print("%d opted-out address(es) are still on a send list." % total_hits)
        print("Run again with --strip to remove them. Do that before you send.")
        sys.exit(1)
    print("No opted-out address is on any send list." if not total_hits
          else "All opted-out addresses removed.")

main()
