#!/usr/bin/env python3
"""MAKE THE PER-LEAD LINK CODES for "Play a quick game" (INBOX 412 UPDATE 6, 14 Nov 2026).

For Fable / main to run. This script NEVER touches Instantly, the live lists or the database: it reads a CSV you give it and
writes two files next to it.

  python3 tools/make-lead-codes.py leads.csv [--out DIR] [--days 60] [--base https://venueplay.com.au/quick]

INPUT  leads.csv  with a header row and at least: email, and any of: first_name, venue (or company), postcode, suburb.
OUTPUT (in --out, default the folder of the input; both files are private, treat them like the contacts table):
  lead-links.csv      email, first_name, venue, lead_code, link     <- Fable loads lead_code (or link) into Instantly as a custom variable
  lead-codes-load.sql the INSERTs for vp_quick_leads (migration 195), run in the Supabase SQL editor once the codes are loaded.
                      Only the SHA-256 hash of each code is in the SQL, never the code. THE SALT must be the Worker's: pass it with
                      --salt (the QUICK_LEAD_SALT Worker secret; if that is not set the Worker falls back to SIGNUP_CODE_SALT,
                      then the service key, so use whichever the Worker really has). Without --salt the SQL is not written.

A CODE is 16 random bytes from the operating system (secrets.token_urlsafe), 22 characters, never derived from the email, so it
cannot be guessed or enumerated. A lead appears once per run: run it again for the same lead and you get a NEW code (the old one
stays valid until it expires or is revoked: revoke with  update vp_quick_leads set revoked_at = now() where id = ...).
Links expire after --days (default 60).
"""
import argparse, csv, hashlib, os, secrets, sys, io

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('infile')
    ap.add_argument('--out', default=None)
    ap.add_argument('--days', type=int, default=60)
    ap.add_argument('--base', default='https://venueplay.com.au/quick')
    ap.add_argument('--salt', default=None)
    a = ap.parse_args()
    out = a.out or os.path.dirname(os.path.abspath(a.infile))
    rows = list(csv.DictReader(io.open(a.infile, encoding='utf-8-sig')))
    if not rows or 'email' not in [k.strip().lower() for k in rows[0].keys()]:
        sys.exit('the input needs a header row with an "email" column')
    def g(r, *names):
        for k in r:
            if k and k.strip().lower() in names and (r[k] or '').strip():
                return r[k].strip()
        return ''
    def q(s):
        return "'" + str(s).replace("'", "''") + "'"
    seen, links, sql = set(), [], []
    for r in rows:
        email = g(r, 'email').lower()
        if not email or email in seen:
            continue
        seen.add(email)
        code = secrets.token_urlsafe(16)
        first, venue, pc, sub = g(r, 'first_name', 'firstname'), g(r, 'venue', 'company', 'company_name'), g(r, 'postcode'), g(r, 'suburb')
        links.append([email, first, venue, code, a.base + '?l=' + code])
        if a.salt is not None:
            h = hashlib.sha256((a.salt + '|lead|' + code).encode()).hexdigest()
            pcv = pc if pc.isdigit() and len(pc) == 4 else None
            sql.append("insert into public.vp_quick_leads (code_hash, first_name, venue_name, postcode, suburb, expires_at) values (%s, %s, %s, %s, %s, now() + interval '%d days') on conflict (code_hash) do nothing;" % (
                q(h), q(first[:60]) if first else 'null', q(venue[:120]) if venue else 'null', q(pcv) if pcv else 'null', q(sub[:80]) if sub else 'null', a.days))
    p1 = os.path.join(out, 'lead-links.csv')
    with io.open(p1, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['email', 'first_name', 'venue', 'lead_code', 'link']); w.writerows(links)
    os.chmod(p1, 0o600)
    print('wrote %d links: %s' % (len(links), p1))
    if a.salt is not None:
        p2 = os.path.join(out, 'lead-codes-load.sql')
        with io.open(p2, 'w', encoding='utf-8') as f:
            f.write('-- vp_quick_leads (migration 195). Hashes only. Run once, after the links are loaded.\n' + '\n'.join(sql) + '\n')
        os.chmod(p2, 0o600)
        print('wrote %d inserts: %s' % (len(sql), p2))
    else:
        print('no --salt given: lead-codes-load.sql NOT written (the Worker could not recognise these codes yet)')

if __name__ == '__main__':
    main()
