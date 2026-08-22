#!/usr/bin/env python3
"""
repair-venue.py -- fix the three things check-data.py finds on a hand-built venue.

    SUPABASE_SERVICE_KEY='...' python3 venueplay-backend/tools/repair-venue.py <slug> [--apply]

Without --apply it says what it WOULD change and touches nothing. With --apply it writes.

WHAT IT REPAIRS, and only these:
  * vp_venues.max_players    from the account's max_seats, when the venue row has no cap.
                             The venue's own billing page reads this column, so with it null
                             they are shown 0 players and a $0 plan. Metering never depended
                             on it (the game Worker falls back to the account), so this is
                             what the venue SEES, not what they are charged.
  * vp_venues.postcode       only if you pass --postcode, because a guess here is worse than
                             a blank: au_state decides which state's gaming rules apply.
  * vp_venues.au_state       derived from the postcode, never guessed from anything else.
  * a manager login          only with --manager-mobile 04xxxxxxxx. Creates the phone-OTP auth
                             user (or reuses the existing one) and the vp_venue_staff row, the
                             same two writes the Worker does at signup. Without a staff row
                             nobody at the venue can sign in at all.

WHAT IT WILL NOT DO
  * Change a billing status. Whether a venue is comp or should be chased for a card is a
    decision, not a repair. The SQL for it is one line and you should mean it.
"""

import json, os, sys, urllib.parse, urllib.request, urllib.error

URL = "https://gpoolavkghnxedzrmtmc.supabase.co"
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
if not KEY:
    sys.exit("Set SUPABASE_SERVICE_KEY first.")

args = [a for a in sys.argv[1:]]
APPLY = "--apply" in args
postcode = None
mobile_in = None
for i, a in enumerate(args):
    if a == "--postcode" and i + 1 < len(args):
        postcode = "".join(ch for ch in args[i + 1] if ch.isdigit())[:4]
    if a == "--manager-mobile" and i + 1 < len(args):
        mobile_in = args[i + 1]
consumed = {postcode, mobile_in}
slugs = [a for a in args if not a.startswith("--") and a not in consumed]
if not slugs:
    sys.exit("Give me a venue slug. See the docstring at the top of this file.")
slug = slugs[0]

# A LITERAL port of vpaStateFromPostcode in venueplay-api-FULL.js. Do not "improve" it here:
# my first pass added the PO Box ranges (5800-5999, 6800-6999, 7800-7999) that the Worker
# deliberately leaves out, and shifted the NSW boundary by one. Two answers to "which state is
# this venue in" is how a venue ends up shown the wrong gaming rules.
def state_from_postcode(pc):
    digits = "".join(ch for ch in str(pc or "") if ch.isdigit())
    if not digits:
        return None
    n = int(digits)
    if (200 <= n <= 299) or (2600 <= n <= 2618) or (2900 <= n <= 2920): return "ACT"
    if (1000 <= n <= 2599) or (2619 <= n <= 2899) or (2921 <= n <= 2999): return "NSW"
    if (3000 <= n <= 3999) or (8000 <= n <= 8999): return "VIC"
    if (4000 <= n <= 4999) or (9000 <= n <= 9999): return "QLD"
    if 5000 <= n <= 5799: return "SA"
    if 6000 <= n <= 6797: return "WA"
    if 7000 <= n <= 7799: return "TAS"
    if 800 <= n <= 999: return "NT"
    return None


def norm_mobile_au(raw):
    """Same normalisation the Worker uses: only a real AU mobile can receive a sign-in code."""
    d = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if d.startswith("61"):
        d = "0" + d[2:]
    if len(d) == 9 and d.startswith("4"):
        d = "0" + d
    if len(d) != 10 or not d.startswith("04"):
        return None
    return "+61" + d[1:]


def auth_call(method, path, body=None):
    """Supabase Auth admin API. Separate from PostgREST, different base path."""
    req = urllib.request.Request(URL + "/auth/v1/" + path, method=method,
                                 data=json.dumps(body).encode() if body else None)
    req.add_header("apikey", KEY); req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return {"_error": e.read().decode()[:300], "_code": e.code}


def call(method, path, body=None):
    req = urllib.request.Request(URL + "/rest/v1/" + path, method=method,
                                 data=json.dumps(body).encode() if body else None)
    req.add_header("apikey", KEY); req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "[]")
    except urllib.error.HTTPError as e:
        sys.exit("%s %s failed: HTTP %s %s" % (method, path, e.code, e.read().decode()[:300]))

vs = call("GET", "vp_venues?slug=eq." + urllib.parse.quote(slug) +
          "&select=id,name,slug,max_players,postcode,au_state,founding_id,group_id&limit=1")
if not vs:
    sys.exit("No venue with slug '%s'." % slug)
v = vs[0]
print("%s  (%s)" % (v.get("name") or slug, slug))
print("  max_players %-8s postcode %-6s au_state %s"
      % (v.get("max_players"), v.get("postcode"), v.get("au_state")))

patch = {}

if not v.get("max_players"):
    if v.get("founding_id"):
        a = call("GET", "venueplay_founding?id=eq." + urllib.parse.quote(v["founding_id"]) +
                 "&select=max_seats,venue_name&limit=1")
        seats = (a[0].get("max_seats") if a else None)
        if seats:
            patch["max_players"] = int(seats)
            print("  -> max_players = %s (from the account's max_seats)" % seats)
        else:
            print("  !! no cap anywhere: the account has no max_seats either. Set the plan in HQ first.")
    else:
        print("  !! no billing parent, so there is no cap to copy. Fix the billing link first.")

pc = postcode or v.get("postcode")
if postcode and postcode != v.get("postcode"):
    patch["postcode"] = postcode
    print("  -> postcode = %s" % postcode)
if not v.get("au_state"):
    st = state_from_postcode(pc)
    if st:
        patch["au_state"] = st
        print("  -> au_state = %s (from postcode %s)" % (st, pc))
    else:
        print("  !! cannot set au_state: no usable postcode. Re-run with --postcode 4224")

# ---- the login, only when asked for ----
staff = call("GET", "vp_venue_staff?venue_id=eq." + urllib.parse.quote(v["id"]) + "&select=id,role")
print("  staff rows   %s" % len(staff))
mobile = None
if mobile_in:
    mobile = norm_mobile_au(mobile_in)
    if not mobile:
        sys.exit("  !! '%s' is not an Australian mobile. They sign in by text code, so a landline "
                 "leaves the venue with no way in." % mobile_in)
    if staff:
        print("  -> %s already has %s staff row(s); a login will be ADDED alongside them" % (slug, len(staff)))
    print("  -> manager login for %s" % mobile)
elif not staff:
    print("  !! NOBODY CAN SIGN IN at this venue. Re-run with --manager-mobile 04xxxxxxxx")

if not patch and not mobile:
    print("\nNothing to repair.")
    sys.exit(0)
if not APPLY:
    print("\nDry run. Add --apply to write these.")
    sys.exit(0)

if patch:
    call("PATCH", "vp_venues?id=eq." + urllib.parse.quote(v["id"]), patch)
    print("\nApplied: %s" % ", ".join(sorted(patch)))

if mobile:
    # Create the phone-OTP user, or find the one that already exists. Same two writes the Worker
    # does at signup: an auth user, then the staff row that ties them to THIS venue.
    u = auth_call("POST", "admin/users", {"phone": mobile, "phone_confirm": True,
                                          "user_metadata": {"venue": v.get("name") or slug}})
    uid = u.get("id")
    if not uid:
        found = auth_call("GET", "admin/users?page=1&per_page=200")
        for row in (found.get("users") or []):
            if row.get("phone") in (mobile, mobile.lstrip("+")):
                uid = row.get("id"); break
        if uid:
            print("that mobile already had a login; reusing it")
        else:
            sys.exit("Could not create or find a login for %s: %s" % (mobile, u.get("_error") or u))
    call("POST", "vp_venue_staff", {"venue_id": v["id"], "auth_user_id": uid,
                                    "role": "manager",
                                    "display_name": (v.get("name") or slug) + " manager"})
    print("Login added: %s can now sign in at venueplay.com.au/app and will be texted a code." % mobile)
