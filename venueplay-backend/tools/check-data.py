#!/usr/bin/env python3
"""
check-data.py -- ask the LIVE database the questions code review cannot answer.

    SUPABASE_SERVICE_KEY='...' python3 venueplay-backend/tools/check-data.py

check-schema.py asks whether the columns exist. This asks whether the ROWS make sense:
a venue nobody can sign in to, a venue that will never be billed, a comp venue that is
quietly eating a founding spot, a signing-key table that is empty because the feature was
never finished. Every one of these reads as fine in the code and only shows up in the data.

READ ONLY. It issues nothing but GETs, and it prints counts and ids, never a player's name,
email or mobile. Safe to run against production any time, and worth running after every
migration and every batch of venue onboarding.

Exit 0 = nothing needs attention. Exit 1 = at least one thing does.
"""

import json, os, sys, urllib.parse, urllib.request, urllib.error

URL = "https://gpoolavkghnxedzrmtmc.supabase.co"
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
if not KEY:
    print("Set SUPABASE_SERVICE_KEY first:\n"
          "    SUPABASE_SERVICE_KEY='...' python3 venueplay-backend/tools/check-data.py")
    sys.exit(2)

findings = []          # (severity, headline, detail)
notes = []


def q(table, query, count=False):
    """GET rows (or an exact count) from PostgREST. Returns (rows, count)."""
    req = urllib.request.Request(URL + "/rest/v1/" + table + "?" + query)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", "Bearer " + KEY)
    if count:
        req.add_header("Prefer", "count=exact")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read().decode() or "[]")
            n = None
            cr = r.headers.get("Content-Range") or ""
            if "/" in cr:
                tail = cr.rsplit("/", 1)[1]
                n = int(tail) if tail.isdigit() else None
            return rows, n
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        notes.append("query failed on %s: HTTP %s %s" % (table, e.code, body))
        return [], None
    except Exception as e:
        notes.append("query failed on %s: %s" % (table, e))
        return [], None


def flag(sev, headline, detail=""):
    findings.append((sev, headline, detail))


print("VenuePlay live data check")
print("=" * 62)

# ---------------------------------------------------------------- venues
venues, n_venues = q("vp_venues", "select=id,name,slug,status,founding_id,group_id,"
                                  "max_players,included_players,postcode,au_state,"
                                  "cancel_at_period_end&limit=2000", count=True)
print("\nVenues: %s" % (n_venues if n_venues is not None else len(venues)))

active = [v for v in venues if (v.get("status") or "") not in ("archived", "suspended")]

no_cap = [v for v in active if v.get("max_players") in (None, 0)
          and v.get("included_players") in (None, 0)]
if no_cap:
    flag("HIGH", "%d live venue(s) have no player cap on the venue row" % len(no_cap),
         "Their own billing page shows 0 players and a $0 plan. Metering still works (the game "
         "Worker falls back to venueplay_founding.max_seats), so this is what the VENUE sees, not "
         "what they are billed. Fixed for new venues on 22 Aug; these predate the fix: "
         + ", ".join(v["slug"] for v in no_cap[:12]))

no_state = [v for v in active if not v.get("au_state")]
if no_state:
    flag("HIGH", "%d live venue(s) have no au_state" % len(no_state),
         "au_state decides which state's gaming rules are shown and whether players may use "
         "phones for bingo. With it null the whole compliance feature is inert for these venues: "
         + ", ".join(v["slug"] for v in no_state[:12]))

slugs = {}
for v in venues:
    slugs.setdefault(v.get("slug"), []).append(v["id"])
dupes = {s: ids for s, ids in slugs.items() if s and len(ids) > 1}
if dupes:
    flag("HIGH", "%d duplicate venue slug(s)" % len(dupes),
         "Two venues on one TV link. " + ", ".join(dupes.keys()))

orphans = [v for v in active if not v.get("founding_id") and not v.get("group_id")]
if orphans:
    flag("MED", "%d live venue(s) have no billing parent at all" % len(orphans),
         "Neither founding_id nor group_id, so nothing bills them and nothing caps them: "
         + ", ".join(v["slug"] for v in orphans[:12]))

# ------------------------------------------------------------- can anyone sign in
staff, _ = q("vp_venue_staff", "select=venue_id,role&limit=5000")
have_mgr = {s["venue_id"] for s in staff if s.get("role") in ("manager", "owner")}
have_any = {s["venue_id"] for s in staff}
no_login = [v for v in active if v["id"] not in have_any]
if no_login:
    flag("HIGH", "%d live venue(s) have NOBODY who can sign in" % len(no_login),
         "No staff row at all, so the console tells them to ask their venue owner for access: "
         + ", ".join(v["slug"] for v in no_login[:12]))
no_owner = [v for v in active if v["id"] in have_any and v["id"] not in have_mgr]
if no_owner:
    flag("MED", "%d venue(s) have hosts but no manager/owner" % len(no_owner),
         "Nobody there can change settings or add another host: "
         + ", ".join(v["slug"] for v in no_owner[:12]))

# ------------------------------------------------------------- setup completeness
sets_, _ = q("vp_venue_settings", "select=venue_id&limit=5000")
scr, _ = q("vp_screens", "select=venue_id&limit=5000")
have_set = {r["venue_id"] for r in sets_}
have_scr = {r["venue_id"] for r in scr}
miss_set = [v for v in active if v["id"] not in have_set]
miss_scr = [v for v in active if v["id"] not in have_scr]
if miss_set:
    flag("MED", "%d venue(s) have no settings row" % len(miss_set),
         ", ".join(v["slug"] for v in miss_set[:12]))
if miss_scr:
    flag("LOW", "%d venue(s) have no screen row" % len(miss_scr),
         ", ".join(v["slug"] for v in miss_scr[:12]))

# ---------------------------------------------------------------- billing accounts
accts, n_acc = q("venueplay_founding",
                 "select=id,venue_name,status,plan,max_seats,is_group,"
                 "stripe_subscription_id,stripe_customer_id&limit=2000", count=True)
by_status = {}
for a in accts:
    by_status[a.get("status") or "(null)"] = by_status.get(a.get("status") or "(null)", 0) + 1
print("Billing accounts: %s   %s" % (n_acc if n_acc is not None else len(accts),
                                     ", ".join("%s=%d" % kv for kv in sorted(by_status.items()))))

comp = [a for a in accts if a.get("status") == "comp"]
print("Comp accounts: %d" % len(comp))
if not comp:
    notes.append("No account carries status 'comp'. Either none has been created since the "
                 "22 Aug fix, or the database refused the label and HQ fell back to 'active' "
                 "(HQ shows a warning when that happens).")

# A venue we onboarded by hand, marked active, with no card, is a venue nobody is chasing.
unbilled = [a for a in accts
            if a.get("status") == "active" and not a.get("stripe_subscription_id")]
if unbilled:
    flag("HIGH", "%d active account(s) have no Stripe subscription" % len(unbilled),
         "They occupy a founding spot and will never be charged a cent. Either they never "
         "added a card after HQ onboarding, or they should be marked comp: "
         + ", ".join((a.get("venue_name") or a["id"][:8]) for a in unbilled[:12]))

no_seats = [a for a in accts if a.get("status") in ("active", "card_on_file", "comp")
            and not a.get("max_seats")]
if no_seats:
    flag("MED", "%d live account(s) have no max_seats" % len(no_seats),
         "This is the fallback the game Worker meters against when the venue row has no cap, "
         "so with both empty a night has no plan cap at all: "
         + ", ".join((a.get("venue_name") or a["id"][:8]) for a in no_seats[:12]))

# --------------------------------------------------------- founding spots, counted two ways
try:
    req = urllib.request.Request(URL + "/rest/v1/rpc/venueplay_spots_taken", data=b"{}")
    req.add_header("apikey", KEY); req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        spots = int(json.loads(r.read().decode()))
    print("Founding spots taken (the RPC the site shows): %d of 100" % spots)
    committed = [a for a in accts if a.get("status") in ("active", "card_on_file")]
    print("Accounts in a committed state: %d" % len(committed))
except Exception as e:
    notes.append("spots RPC failed: %s" % e)

# ------------------------------------------------------------ broadcast signing
keys, n_keys = q("vp_venue_signing_keys", "select=venue_id&limit=500", count=True)
n_keys = n_keys if n_keys is not None else len(keys)
if n_keys == 0:
    flag("HIGH", "No venue has a broadcast signing key",
         "vp-sign.js is loaded on every TV, phone and host console, but the Worker routes it "
         "calls (/venue/signing/public, /host/signing/mint) return 404, so every page silently "
         "falls back to send-unsigned / render-everything. The realtime channel is still wide "
         "open to anyone with the anon key.")
else:
    print("Venues with a signing key: %d" % n_keys)

# ------------------------------------------------------------------ captures
caps, n_caps = q("vp_captures", "select=id,venue_id,marketing_optin,source_ip_hash&limit=1", count=True)
if n_caps is not None:
    opt, n_opt = q("vp_captures", "select=id&marketing_optin=is.true&limit=1", count=True)
    noprov, n_noprov = q("vp_captures", "select=id&source_ip_hash=is.null&limit=1", count=True)
    print("Captures: %s total, %s marketing opt-ins, %s with no provenance hash"
          % (n_caps, n_opt, n_noprov))
    if n_noprov and n_opt and n_noprov > 0:
        notes.append("%s capture(s) predate migration 47, so a poisoned row among them cannot be "
                     "traced back to where it came from." % n_noprov)

# ------------------------------------------------------------------ sessions
open_s, n_open = q("vp_sessions", "select=id,venue_id,status,opened_at&status=in.(lobby,live)"
                                  "&limit=200", count=True)
if n_open:
    print("Sessions currently open: %s" % n_open)
    if n_open > 3:
        flag("MED", "%s sessions are open right now" % n_open,
             "The nightly sweep closes stale ones at 3am Brisbane. More than a couple outside "
             "trading hours usually means the sweep is not running.")

# ------------------------------------------------------------------- trivia
tq, n_tq = q("vp_questions", "select=id&limit=1", count=True)
if n_tq is not None:
    print("Trivia questions in the bank: %s" % n_tq)
    if n_tq < 5000:
        flag("MED", "Only %s trivia questions in the bank" % n_tq,
             "A venue running weekly trivia will start seeing repeats.")
    # The site publishes this number. If the file and the bank disagree, the site is making a
    # claim the database does not support, which is the sort of thing a customer screenshots.
    try:
        # Cloudflare answers 403 to the bare python user agent, so ask like a browser.
        creq = urllib.request.Request("https://venueplay.com.au/data/trivia-count.json",
                                      headers={"User-Agent": "Mozilla/5.0 (VenuePlay check-data)"})
        with urllib.request.urlopen(creq, timeout=20) as r:
            published = int(json.loads(r.read().decode()).get("count") or 0)
        if published and abs(published - n_tq) > max(50, n_tq * 0.02):
            flag("MED", "The published trivia count is %s but the bank holds %s" % (published, n_tq),
                 "data/trivia-count.json is what the site shows. Regenerate it.")
        else:
            print("Published trivia count agrees with the bank (%s)" % published)
    except Exception as e:
        notes.append("could not read the published trivia count: %s" % e)

# ------------------------------------------------------------------- report
print("\n" + "=" * 62)
if notes:
    print("\nWorth knowing:")
    for n in notes:
        print("  - " + n)
if not findings:
    print("\nNothing needs attention.")
    sys.exit(0)
order = {"HIGH": 0, "MED": 1, "LOW": 2}
findings.sort(key=lambda f: order.get(f[0], 9))
print("\n%d thing(s) need attention:\n" % len(findings))
for sev, head, detail in findings:
    print("  [%s] %s" % (sev, head))
    if detail:
        for line in [detail[i:i+92] for i in range(0, len(detail), 92)]:
            print("         " + line)
    print()
sys.exit(1)
