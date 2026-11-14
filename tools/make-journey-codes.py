#!/usr/bin/env python3
"""MAKE THE TRACKED-LINK CODES (INBOX 413, 15 Nov 2026). For Fable / main to run. NEVER touches Instantly, a live list or the database.

  python3 tools/make-journey-codes.py leads.csv --campaign offer-nov --page offer-nov --steps 1,2,3 --labels play-button,pricing \
          [--out DIR] [--days 120] [--salt SECRET] [--master PATH/master.sqlite] [--first-only]

INPUT  leads.csv, the Instantly export (instantly-backup/<date>/leads.csv): id, email, first_name, company, state, suburb, postcode, custom_variables ...
       Optional columns trivia, bingo, musical_bingo, raffle, members_draw (anything non-empty = runs that game). With --master the
       venue master (venue-master/master.sqlite, opened READ ONLY) is also asked, by email, which games the lead data says they run.
ONE CODE per (lead, email step, link label). A link in an email is  https://venueplay.com.au/<page>/<CODE>  : the page's own address and 6
characters, no query string, no email in it. CODE = 6 characters from an alphabet with no I L O U 0 1, from the operating system's
random source (secrets), never derived from the email, unique within the run. 30^6 = 729 million codes against about 12 thousand live.
OUTPUT (in --out, default the folder of the input; all private, chmod 600, treat like the contacts table):
  journey-links.csv       one row per code: email, lead_ref, campaign, step, label, code, link
  journey-links-wide.csv  one row per lead: email + a column per step and label (link_e1_play_button ...): this is what Fable loads into
                          Instantly as custom variables (the email body uses {{link_e1_play_button}}). Instantly tracking stays OFF.
  journey-links-load.sql  INSERTs for vp_track_links (migration 196). Only the SALTED SHA-256 of each code is in it, never the code.
                          --salt must be the Worker's TRACK_LINK_SALT secret; if the Worker has none set, leave --salt off and the default
                          'vp-track-v1' (what the Worker uses then) is used. lead_ref is the Instantly lead id, or a hash of the email, never the email.
Run it again for the same leads and you get NEW codes; the old ones stay valid until they expire or are revoked:
  update vp_track_links set revoked_at = now() where campaign = '...' and email_step = N;
"""
import argparse, csv, hashlib, io, os, re, secrets, sqlite3, sys

ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'   # no I L O U 0 1: nothing to misread in a plain-text email. Same as VPJ_ALPHABET in the Worker.
STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'NZ']
GAMES = [('trivia', 'trivia'), ('musical_bingo', 'musical_bingo'), ('bingo', 'bingo'), ('raffle', 'raffle'), ('members_draw', 'members_draw')]
STATE_WORDS = {'new south wales': 'NSW', 'victoria': 'VIC', 'queensland': 'QLD', 'south australia': 'SA', 'western australia': 'WA',
               'tasmania': 'TAS', 'northern territory': 'NT', 'australian capital territory': 'ACT', 'new zealand': 'NZ'}


def new_code(used):
    while True:
        c = ''.join(secrets.choice(ALPHABET) for _ in range(6))
        if c not in used:
            used.add(c)
            return c


def code_hash(salt, code):
    return hashlib.sha256((salt + '|track|' + code.upper()).encode('utf-8')).hexdigest()


def state_of(raw):
    s = (raw or '').strip()
    if s.upper() in STATES:
        return s.upper()
    return STATE_WORDS.get(s.lower())


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def games_from_master(master, email):
    """Which games the lead data says a venue runs. Read only. Looks the email up in venues.email / other_emails / in_instantly_emails."""
    if not master or not email:
        return []
    con = sqlite3.connect('file:%s?mode=ro' % master, uri=True)
    try:
        cols = ['trivia', 'bingo', 'musical_bingo', 'raffle', 'members_draw']
        like = '%' + email.lower() + '%'
        r = con.execute('select ' + ','.join(cols) + ' from venues where lower(coalesce(email,"")) = ? or lower(coalesce(other_emails,"")) like ? or lower(coalesce(in_instantly_emails,"")) like ? limit 1',
                        (email.lower(), like, like)).fetchone()
    except sqlite3.Error:
        r = None
    finally:
        con.close()
    if not r:
        return []
    return [g for (g, v) in zip(cols, r) if v not in (None, '', 0, '0', 'no', 'No')]


def build(rows, a, master=None):
    """Pure-ish: rows -> (links, wide, sql lines). No file is written here."""
    campaign, page = a.campaign, a.page
    if not re.fullmatch(r'[a-z0-9-]{1,60}', campaign) or not re.fullmatch(r'[a-z0-9-]{1,40}', page):
        sys.exit('--campaign and --page: lowercase letters, digits and dashes only')
    steps = [int(x) for x in a.steps.split(',') if x.strip()]
    labels = [x.strip() for x in a.labels.split(',') if x.strip()]
    if not steps or not labels or any(not re.fullmatch(r'[a-z0-9-]{1,40}', l) for l in labels):
        sys.exit('--steps like 1,2,3 and --labels like play-button,pricing (lowercase, digits, dashes)')
    if a.first_only:
        pass
    lc = [k for k in rows[0].keys() if k]
    def g(r, *names):
        for k in r:
            if k and k.strip().lower() in names and (r[k] or '').strip():
                return r[k].strip()
        return ''
    used, seen, links, wide, sql = set(), set(), [], [], []
    for r in rows:
        email = g(r, 'email').lower()
        if not email or '@' not in email or email in seen:
            continue
        seen.add(email)
        lead_ref = (g(r, 'id') or 'e' + hashlib.sha256(email.encode()).hexdigest()[:16])[:80]
        first, venue = g(r, 'first_name', 'firstname'), g(r, 'company', 'venue', 'company_name')
        state, pc, sub = state_of(g(r, 'state')), g(r, 'postcode'), g(r, 'suburb')
        pc = pc if re.fullmatch(r'[0-9]{4}', pc) else None
        games = [gm for (col, gm) in GAMES if g(r, col) and g(r, col).lower() not in ('0', 'no', 'false')]
        for gm in games_from_master(master, email):
            if gm not in games:
                games.append(gm)
        wrow = {'email': email}
        for st in steps:
            for lb in labels:
                code = new_code(used)
                link = 'https://venueplay.com.au/%s/%s' % (page, code)
                links.append([email, lead_ref, campaign, st, lb, code, link])
                wrow['link_e%d_%s' % (st, lb.replace('-', '_'))] = link
                sql.append("insert into public.vp_track_links (code_hash, lead_ref, venue_name, first_name, state, postcode, suburb, likely_games, campaign, email_step, link_label, page, expires_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %d, %s, %s, now() + interval '%d days') on conflict (code_hash) do nothing;" % (
                    q(code_hash(a.salt, code)), q(lead_ref), q(venue[:120]) if venue else 'null', q(first[:60]) if first else 'null',
                    q(state) if state else 'null', q(pc) if pc else 'null', q(sub[:80]) if sub else 'null',
                    "'{%s}'" % ','.join(games) if games else "'{}'", q(campaign), st, q(lb), q(page), a.days))
        wide.append(wrow)
    return links, wide, sql


def main(argv=None):
    ap = argparse.ArgumentParser(description='Tracked-link codes for the cold emails (INBOX 413). Never touches Instantly.')
    ap.add_argument('infile')
    ap.add_argument('--campaign', required=True)
    ap.add_argument('--page', default='offer-nov')
    ap.add_argument('--steps', default='1')
    ap.add_argument('--labels', default='play-button')
    ap.add_argument('--out', default=None)
    ap.add_argument('--days', type=int, default=120)
    ap.add_argument('--salt', default='vp-track-v1')
    ap.add_argument('--master', default=None)
    ap.add_argument('--first-only', action='store_true', help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    out = a.out or os.path.dirname(os.path.abspath(a.infile))
    rows = list(csv.DictReader(io.open(a.infile, encoding='utf-8-sig')))
    if not rows or 'email' not in [k.strip().lower() for k in rows[0].keys() if k]:
        sys.exit('the input needs a header row with an "email" column')
    links, wide, sql = build(rows, a, a.master)
    os.makedirs(out, exist_ok=True)
    p1, p2, p3 = (os.path.join(out, n) for n in ('journey-links.csv', 'journey-links-wide.csv', 'journey-links-load.sql'))
    with io.open(p1, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['email', 'lead_ref', 'campaign', 'step', 'label', 'code', 'link']); w.writerows(links)
    cols = ['email'] + sorted({k for r in wide for k in r if k != 'email'})
    with io.open(p2, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(wide)
    with io.open(p3, 'w', encoding='utf-8') as f:
        f.write('-- vp_track_links (migration 196). Salted hashes only. Run once, AFTER the links are loaded into Instantly.\n' + '\n'.join(sql) + '\n')
    for p in (p1, p2, p3):
        os.chmod(p, 0o600)
    print('%d leads, %d codes' % (len(wide), len(links)))
    print('wrote', p1); print('wrote', p2); print('wrote', p3)


if __name__ == '__main__':
    main()
