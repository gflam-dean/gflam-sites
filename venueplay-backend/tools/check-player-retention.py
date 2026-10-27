#!/usr/bin/env python3
"""The privacy page makes a promise about deleting player data. Nothing keeps it.

    "When a venue's account is closed, its player list is deleted within 90 days,
     other than anything we have to keep for tax or legal record-keeping."
                                                     venueplay/privacy.html

Nothing implements that. Searched on 15 Sep 2026: the only tables either Worker ever
deletes from are vp_venue_staff, vp_questions, vp_question_sets, vp_raffle_prizes and
vp_discounts, plus one vp_members row at a time when a member asks to come off a list.
The nightly cron ARCHIVES a venue, which sets a status. It removes nothing.

So this is not a bug in something that runs. It is a promise with no machinery behind
it, which is the harder kind to notice, because every day it looks fine until the day
it does not.

READ ONLY. It counts and reports. It deletes nothing, ever, and it must not: erasing
personal data is not a thing a check should do on its own.

  green  nothing is past the 90 days yet, and it says how long the closest one has
  red    a venue has been closed longer than the page promises and its people are
         still on the database

WHAT "CLOSED" MEANS is the same thing it means to the purge: suspended, for a reason that
means gone (ended, cancelled, archived), dated from vp_venues.closed_at. A venue that is
merely behind on a bill is NOT closed and is not counted. One definition, in two places
that must agree: here, and sweepRetention in venueplay-game.js.
"""
import datetime
import json
import os
import subprocess
import sys

ENV = os.path.expanduser('~/.gflam-migrate.env')
PROMISE_DAYS = 90


def die(msg):
    print('STOP: ' + msg)
    sys.exit(1)


def env():
    if not os.path.isfile(ENV):
        die('%s is missing, so this cannot reach the database' % ENV)
    out = {}
    for line in open(ENV):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k] = v.strip()
    return out


def when(text):
    """A Postgres timestamp, whatever it looks like. Postgres drops trailing zeros from the
    fraction ('17:00:56.13+00:00') and this Python's fromisoformat wants exactly three or six
    digits, so the first run of this tool reported a venue closed YESTERDAY as having no closing
    date at all. The fraction is of no interest here, so it goes."""
    import re
    t = re.sub(r'\.\d+', '', str(text).strip().replace('Z', '+00:00').replace(' ', 'T'))
    try:
        d = datetime.datetime.fromisoformat(t)
    except Exception:
        return None
    return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)


def main():
    e = env()
    url, key = e.get('NEW_SUPABASE_URL'), e.get('NEW_SERVICE_KEY')
    if not url or not key:
        die('NEW_SUPABASE_URL and NEW_SERVICE_KEY must be in %s' % ENV)

    def q(path):
        r = subprocess.run(['curl', '-sS', url + '/rest/v1/' + path,
                            '-H', 'apikey: ' + key, '-H', 'Authorization: Bearer ' + key],
                           capture_output=True, text=True)
        try:
            return json.loads(r.stdout)
        except Exception:
            die('the database did not answer with JSON: ' + r.stdout[:160])

    # ONE DEFINITION OF CLOSED, the one the purge itself uses (sweepRetention in the game Worker):
    # suspended, for a reason that means gone, with closed_at saying since when. This used to
    # date "closed" from the venue's CREATION date and count every non-active venue, so it
    # disagreed with the other 90-day check on the same day (36 days against 83) and was set
    # to turn the gate red in late October over a venue that had closed the week before.
    # Found by audit, 20 Sep 2026.
    CLOSED = ('ended', 'cancelled', 'archived', 'archived_cancelling')

    def q_all(path, order='id'):
        """Every row. One read stops at 1,000 without a word, and these tables only grow. Pages
        in a stable order and stops on an EMPTY page: a short page is not the end."""
        out, off = [], 0
        while True:
            page = q('%s&order=%s.asc&limit=1000&offset=%d' % (path, order, off))
            if not isinstance(page, list):
                die('could not read %s' % path.split('?')[0])
            if not page:
                return out
            out.extend(page); off += len(page)
            if off > 2000000:
                die('%s did not end after two million rows' % path.split('?')[0])

    venues = q_all('vp_venues?select=id,name,status,suspended_reason,closed_at,player_data_purged_at')
    now = datetime.datetime.now(datetime.timezone.utc)
    shut, undated = {}, []
    for v in venues:
        if v.get('status') != 'suspended' or v.get('suspended_reason') not in CLOSED:
            continue
        if not v.get('closed_at'):
            undated.append(v['name']); continue
        since = when(v['closed_at'])
        if since is None:
            undated.append(v['name'] + ' (closed_at is %r, which is not a date)' % v['closed_at']); continue
        shut[v['id']] = (v['name'], (now - since).days, bool(v.get('player_data_purged_at')))

    if undated:
        # A closed venue with no clock can never come due, which is the promise failing quietly.
        print('%d closed venue(s) have NO closed_at, so their 90 days never start:' % len(undated))
        for n in undated[:8]:
            print('  ' + n)
        return 1
    if not shut:
        print('No venue is closed, so there is nothing to have deleted. (%d venues read)' % len(venues))
        return 0

    # WHAT "STILL HOLDING" MEANS. The purge BLANKS a row, it does not delete it: the head counts
    # are billing records. So a row existing proves nothing either way. What is counted is a row
    # that still says who somebody is.
    sessions = {x['id']: x['venue_id'] for x in q_all('vp_sessions?select=id,venue_id')}
    rosters = {x['id']: x['venue_id'] for x in q_all('vp_member_rosters?select=id,venue_id')}
    held = {}
    for pl in q_all('vp_players?or=(email.not.is.null,mobile.not.is.null,first_name.not.is.null,last_name.not.is.null)&select=id,session_id'):
        vid = sessions.get(pl.get('session_id'))
        if vid in shut:
            held.setdefault(vid, {'players': 0, 'members': 0})['players'] += 1
    for m in q_all('vp_members?or=(first_name.not.is.null,last_name.not.is.null)&select=id,roster_id'):
        vid = rosters.get(m.get('roster_id'))
        if vid in shut:
            held.setdefault(vid, {'players': 0, 'members': 0})['members'] += 1

    overdue, waiting = [], []
    for vid, (name, age, purged) in shut.items():
        c = held.get(vid, {'players': 0, 'members': 0})
        line = '%s: %d player(s) and %d member(s) still named, closed %d days ago%s' % (
            name, c['players'], c['members'], age, ', marked purged' if purged else '')
        if c['players'] or c['members']:
            (overdue if age > PROMISE_DAYS else waiting).append((age, line))
        elif age > PROMISE_DAYS and not purged:
            overdue.append((age, '%s: nothing left to name anybody, but never marked purged, closed %d days ago' % (name, age)))

    if overdue:
        overdue.sort(reverse=True)
        print('%d venue(s) past the %d days the privacy page promises:' % (len(overdue), PROMISE_DAYS))
        for _, line in overdue:
            print('  ' + line)
        print('')
        print('The nightly sweep in the game Worker (sweepRetention) should have blanked these.')
        print('Look at vp_admin_audit for retention_sweep rows and at the Worker\'s cron.')
        return 1

    if waiting:
        waiting.sort(reverse=True)
        print('Nothing is overdue. %d closed venue(s) still hold names; the closest is %d days away.' % (
            len(waiting), PROMISE_DAYS - waiting[0][0]))
        for _, line in waiting[:4]:
            print('  ' + line)
        return 0

    print('%d closed venue(s), and none of them still names a player or a member.' % len(shut))
    return 0


if __name__ == '__main__':
    sys.exit(main())
