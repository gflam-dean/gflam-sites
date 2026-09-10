#!/usr/bin/env python3
"""Has anybody paid for a party and not been sent their code?

    python3 partyplay-backend/tools/check-paid-not-delivered.py

WHY. PartyPlay is a $50 consumer purchase and the ENTIRE product is delivered by
one email: the party code and the host key. The webhook does this:

    try { await sendLicenceEmail(...); await sb(... welcome_sent_at ...); }
    catch (e) { console.log('licence email failed for ' + code + ': ' + e.message); }

That catch is right. An email that will not send must not undo a payment, and it
must not make Stripe retry a webhook that already granted the licence. But it
means a failed send is a line in a log nobody reads. The row stays 'paid', the
buyer has no code, no host key and no way to run the party they bought, and
NOTHING INSIDE THE BUSINESS KNOWS. The first anyone hears is somebody emailing to
ask where their party went, and only if they bother.

There is a /licence/resend route, so the repair is easy. Finding out is the hard
part, and that is what this does.

WHAT IT WILL NOT DO IS CRY WOLF. welcome_sent_at only exists from migration 12b,
2 Sep 2026. Two licences were paid before that (26 and 29 Aug, both Dean's own
test purchases) and can never have the stamp. They are reported as unjudgeable,
not as failures, because a check that is permanently red is a check nobody looks
at.
"""
import os, subprocess, sys
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', '..', 'venueplay-backend', 'tools'))
from vp_live import live

PSQL = '/Applications/Postgres.app/Contents/Versions/latest/bin/psql'

# The stamp did not exist before this, so a NULL before it means nothing.
STAMP_EXISTS_FROM = '2026-09-02'
# The email is sent inline on the webhook, so it is instant or it failed. This is slack
# for a slow send and for clock skew, not a real delivery window.
GRACE_MINUTES = 15

SQL = """
select coalesce(l.code,'?'),
       coalesce(l.buyer_email,'(no email)'),
       to_char(l.paid_at at time zone 'Australia/Brisbane','DD Mon HH24:MI'),
       (l.paid_at < timestamptz '%s')::text,
       (l.paid_at > now() - interval '%d minutes')::text,
       coalesce(l.party_name,'')
  from pp_licences l
 where l.status = 'paid' and l.welcome_sent_at is null
 order by l.paid_at;
""" % (STAMP_EXISTS_FROM, GRACE_MINUTES)


def main():
    L = live()
    if not L.db_url:
        print('STOP: no live database configured'); sys.exit(1)
    print('\n' + L.banner())
    r = subprocess.run([PSQL, L.db_url, '-At', '-F', '|', '-c', SQL],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print('could not ask the database: ' + (r.stderr or '').strip()[:200]); sys.exit(1)
    rows = [l.split('|') for l in r.stdout.splitlines() if l.strip()]

    old, fresh, stuck = [], [], []
    for code, email, paid, before_stamp, in_grace, party in rows:
        if before_stamp == 'true': old.append((code, email, paid))
        elif in_grace == 'true':   fresh.append((code, email, paid))
        else:                      stuck.append((code, email, paid, party))

    print('\nPAID FOR A PARTY, NEVER SENT THE CODE')
    if old:
        print('  Paid before the stamp existed (2 Sep 2026), so this cannot be judged either way:')
        for code, email, paid in old:
            print('    --   %-8s %-32s paid %s' % (code, email, paid))
    if fresh:
        print('  Paid in the last %d minutes, so the email may still be going out:' % GRACE_MINUTES)
        for code, email, paid in fresh:
            print('    --   %-8s %-32s paid %s' % (code, email, paid))
    if stuck:
        print('  THESE PEOPLE PAID AND HAVE NOTHING. Each one has no code and no host key:')
        for code, email, paid, party in stuck:
            print('    FAIL %-8s %-32s paid %s   %s' % (code, email, paid, party))
        print('')
        print('  Repair: POST /licence/resend with the code. It is built and it works.')
        print('  Then read the Worker log for "licence email failed", because the send is')
        print('  what broke, and it will break again for the next buyer.')
        print('')
        print('%d buyer(s) paid and were never sent their party.' % len(stuck))
        sys.exit(1)

    if not old and not fresh:
        print('  Nothing paid is undelivered.')
    else:
        print('\n  Nothing that can be judged is undelivered.')


if __name__ == '__main__':
    main()
