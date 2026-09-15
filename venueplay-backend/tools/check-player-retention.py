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

A NOTE ON "CLOSED". The database has no closed state. It has active and suspended, so
suspended is what this reads, and a suspended venue may simply be behind on a bill and
coming back. If a real closed state ever exists, point this at that instead: counting
a venue that is coming back would be crying wolf, and a check nobody believes is worse
than no check.
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

    venues = q('vp_venues?select=id,name,status,created_at')
    if not isinstance(venues, list):
        die('could not read the venue list')

    now = datetime.datetime.now(datetime.timezone.utc)
    shut = {}
    for v in venues:
        if v.get('status') == 'active':
            continue
        try:
            born = datetime.datetime.fromisoformat(str(v['created_at']).replace('Z', '+00:00'))
        except Exception:
            continue
        shut[v['id']] = (v['name'], (now - born).days)

    if not shut:
        print('No venue is closed, so there is nothing to have deleted.')
        return 0

    # players hang off a session, members hang off a list, so both need a hop
    sessions = {s['id']: s['venue_id'] for s in q('vp_sessions?select=id,venue_id')}
    rosters = {r['id']: r['venue_id'] for r in q('vp_member_rosters?select=id,venue_id')}

    held = {}
    for p in q('vp_players?select=id,session_id'):
        vid = sessions.get(p.get('session_id'))
        if vid in shut:
            held.setdefault(vid, {'players': 0, 'members': 0})['players'] += 1
    for m in q('vp_members?select=id,roster_id'):
        vid = rosters.get(m.get('roster_id'))
        if vid in shut:
            held.setdefault(vid, {'players': 0, 'members': 0})['members'] += 1

    overdue, waiting = [], []
    for vid, counts in held.items():
        name, age = shut[vid]
        line = '%s: %d player(s), %d member(s), closed %d days ago' % (
            name, counts['players'], counts['members'], age)
        (overdue if age > PROMISE_DAYS else waiting).append((age, line))

    if overdue:
        overdue.sort(reverse=True)
        print('%d venue(s) past the %d days the privacy page promises:' % (len(overdue), PROMISE_DAYS))
        for _, line in overdue:
            print('  ' + line)
        print('')
        print('The page says this data is deleted within %d days of an account closing.' % PROMISE_DAYS)
        print('Nothing deletes it. Either build the sweep or change what the page says,')
        print('and do not leave it saying something that is not happening.')
        return 1

    if waiting:
        waiting.sort(reverse=True)
        soonest = PROMISE_DAYS - waiting[0][0]
        print('Nothing is overdue. The closest is %d days away.' % soonest)
        for _, line in waiting[:4]:
            print('  ' + line)
        print('')
        print('Still nothing that will delete it when the day comes.')
        return 0

    print('Closed venues hold no player or member data.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
