#!/usr/bin/env python3
"""Is PartyPlay actually keeping the promise its privacy page makes?

privacy.html tells a guest three things about a finished party:

    "The whole album is deleted 30 days after the party ends."
    "The nickname is deleted when the album is."
    "Guest emails are deleted with everything else from that party, 30 days after it."

runPhotoSweep in the Worker does all three, on a Cron Trigger every fifteen minutes.
The gate checks the code is there and that a cron calls it. NOTHING CHECKED WHETHER IT
IS ACTUALLY KEEPING UP, and it cannot: if the sweep throws, it returns {ok:false} into a
scheduled handler that nobody reads, and the only symptom is guest email addresses still
sitting in a table while the page says they went a month ago.

This is the PartyPlay half of venueplay-backend/tools/check-player-retention.py, and it
asks the database rather than the code:

    1. photo rows whose own delete_after has passed and are still here
    2. pp_players rows for a party that finished more than the keep window ago
    3. pp_album_requests rows, the same, and those hold EMAIL ADDRESSES

THE KEEP WINDOW IS READ OUT OF THE WORKER, never written here. Two copies of that number
is the fault this whole file exists to catch a different version of.

Read only. Nothing is deleted, no address is printed, no key is printed.

    exit 0   nothing is overdue, and it says how close the nearest one is
    exit 1   something the page says is gone is still here

Run: python3 partyplay-backend/tools/check-partyplay-retention.py
"""
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV = os.path.expanduser('~/.gflam-migrate.env')
WORKER = os.path.join(ROOT, 'partyplay-backend', 'worker',
                      'SOURCE-do-not-paste-partyplay-api.js')

GRN, RED, YEL, DIM, OFF = '\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m'


def die(msg):
    print('STOP: ' + msg)
    sys.exit(1)


def keep_days():
    """The one place the number lives. If it moves, this moves with it."""
    if not os.path.isfile(WORKER):
        die('cannot find the Worker, so the keep window is unknown: %s' % WORKER)
    src = open(WORKER, encoding='utf-8').read()
    src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    m = re.search(r'ALBUM_KEEP_DAYS\s*=\s*(\d+)', src)
    if not m:
        die('ALBUM_KEEP_DAYS is not in the Worker any more, so nothing owns the number')
    return int(m.group(1))


def env():
    if not os.path.isfile(ENV):
        die('%s is missing, so this cannot reach the database' % ENV)
    out = {}
    for line in open(ENV):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def get(url, key, path):
    req = urllib.request.Request(
        url + '/rest/v1/' + path,
        headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                 'User-Agent': 'curl/8.7.1'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read().decode())
    except urllib.error.HTTPError as e:
        die('the database refused %s: HTTP %s' % (path.split('?')[0], e.code))
    except Exception as e:
        die('could not reach the database: %s' % str(e)[:80])


def days_since(iso, now):
    if not iso:
        return None
    try:
        return (now - datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))).days
    except Exception:
        return None


def main():
    days = keep_days()
    e = env()
    url = e.get('NEW_SUPABASE_URL', '').rstrip('/')
    key = e.get('NEW_SERVICE_KEY', '')
    if not url or not key:
        die('NEW_SUPABASE_URL and NEW_SERVICE_KEY must both be in %s' % ENV)
    now = datetime.datetime.now(datetime.timezone.utc)

    print('\n%sWhat PartyPlay promises a guest about a finished party%s' % (YEL, OFF))
    print('%s  the keep window is %d days, read out of the Worker%s\n' % (DIM, days, OFF))

    overdue = 0
    soonest = None

    # 1. PHOTOS. Each row carries its own delete_after, so the row itself says when.
    photos = get(url, key, 'pp_photos?select=id,delete_after&limit=2000')
    late = [p for p in photos
            if p.get('delete_after') and (days_since(p['delete_after'], now) or -1) > 0]
    if late:
        print('  %sSTILL HERE%s  %d photo row(s) past their own delete_after'
              % (RED, OFF, len(late)))
        overdue += len(late)
    else:
        print('  %sok%s          %d photo row(s), none past its delete_after'
              % (GRN, OFF, len(photos)))
        for p in photos:
            d = days_since(p.get('delete_after'), now)
            if d is not None and d <= 0:
                soonest = -d if soonest is None else min(soonest, -d)

    # 2 and 3. THE PEOPLE. Anything belonging to a party that finished more than the
    # keep window ago should be gone: nicknames in pp_players, EMAIL ADDRESSES in
    # pp_album_requests.
    lic = get(url, key, 'pp_licences?select=id,code,expires_at&limit=2000')
    finished, waiting = set(), []
    for l in lic:
        d = days_since(l.get('expires_at'), now)
        if d is None:
            continue
        if d > days:
            finished.add(l['id'])
        else:
            waiting.append(days - d)
    if waiting:
        soonest = min(waiting) if soonest is None else min(soonest, min(waiting))

    for table, what in (('pp_players', 'guest nickname(s)'),
                        ('pp_album_requests', 'guest EMAIL ADDRESS(es)')):
        rows = get(url, key, '%s?select=id,licence_id&limit=5000' % table)
        left = [r for r in rows if r.get('licence_id') in finished]
        if left:
            print('  %sSTILL HERE%s  %d %s from a party that finished over %d days ago'
                  % (RED, OFF, len(left), what, days))
            overdue += len(left)
        else:
            print('  %sok%s          %d row(s) in %s, none from a finished party'
                  % (GRN, OFF, len(rows), table))

    print('')
    if overdue:
        print('%s%d row(s) the privacy page says are gone are still here.%s'
              % (RED, overdue, OFF))
        print('runPhotoSweep is on a Cron Trigger and returns {ok:false} into a handler')
        print('nobody reads, so a sweep that is throwing looks exactly like one with')
        print('nothing to do. Run it by hand through the admin endpoint and read what it')
        print('says, or check the Worker logs for "personal data sweep failed".')
        return 1

    if soonest is not None:
        print('%sNothing is overdue. The closest is %d day(s) away.%s' % (GRN, soonest, OFF))
    else:
        print('%sNothing is overdue, and nothing is clocked yet either.%s' % (GRN, OFF))
        print('%s  That is not the same as the sweep working. It has had nothing to do.%s'
              % (DIM, OFF))
    return 0


if __name__ == '__main__':
    sys.exit(main())
