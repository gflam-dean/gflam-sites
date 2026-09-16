#!/usr/bin/env python3
"""Is there a session nobody closed, at ANY venue, that could be billed?

    python3 venueplay-backend/tools/check-stale-sessions.py

WHY THIS IS A MONEY CHECK. /session/close only ever runs in the browser, so a host
who shuts the tablet without signing out leaves the session open. Every later
night's players append to that SAME session, and when it finally closes, one
invoice bills every player who ever played across all of them. This has already
happened once: session 9206e83c sat open for 23 days and collected 12 players
across two separate nights.

WHY IT IS SEPARATE FROM THE ONE IN release-check.py. That one asks the game
Worker's public /play/live endpoint about a HAND-MAINTAINED LIST OF ONE VENUE,
and prints "has no session left open" whenever the answer is anything other than
"live with no game", which includes every case it cannot judge. On 10 Sep 2026 it
said the-average-joe had no session left open while that venue held a session
opened on 26 August, never ended, with 4 billable players and 3 over its plan.
Both statements were true at once: the session reads not-live because it was
CANCELLED, and cancelled is not ended.

So this one asks the DATABASE, which is the only thing that knows what ended_at
is, and it asks about EVERY venue rather than a list somebody has to remember to
update.

WHAT COUNTS AS BILLABLE, and it is not "joined". The metering view counts only
players who actually PLAYED: they hold a bingo card or answered a trivia
question, and are not kicked and not a test player. So a lobby somebody left open
with people sitting in it bills nothing, and is reported here as untidy rather
than as a problem. An unclosed session with billable players is the problem.
"""
import os, subprocess, sys
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vp_live import live

def _find_psql():
    """psql, wherever it actually is.

    This was one hardcoded path to Postgres.app. On a machine without it the tool threw
    a raw FileNotFoundError, which release-check printed as a stack trace, so the line a
    person reads said nothing about what to do. Worse, these checks had never run here at
    all: they were failing earlier on a malformed VP_LIVE, and fixing that only moved the
    failure one step along. A check that cannot run has to SAY it cannot run.
    """
    import shutil, glob as _g
    found = shutil.which('psql')
    if found:
        return found
    pats = ['/Applications/Postgres.app/Contents/Versions/*/bin/psql',
            '/opt/homebrew/bin/psql', '/usr/local/bin/psql',
            '/opt/homebrew/opt/libpq/bin/psql', '/usr/local/opt/libpq/bin/psql',
            '/Library/PostgreSQL/*/bin/psql']
    for p in pats:
        hits = sorted(_g.glob(p))
        if hits:
            return hits[-1]
    return None

PSQL = _find_psql()
ENV  = Path.home() / '.gflam-migrate.env'

SQL = """
select v.slug,
       s.id::text,
       coalesce(s.status,'?'),
       to_char((coalesce(s.opened_at, s.started_at, s.created_at) at time zone v.timezone), 'DD Mon HH24:MI'),
       extract(epoch from (now() - coalesce(s.opened_at, s.started_at, s.created_at)))::bigint / 3600,
       coalesce(m.billable_players, 0),
       coalesce(m.all_players, 0),
       coalesce(m.session_overage, 0)
  from vp_sessions s
  join vp_venues v on v.id = s.venue_id
  left join v_vp_session_metering m on m.session_id = s.id
 where s.ended_at is null
 order by coalesce(s.opened_at, s.started_at, s.created_at);
"""


def _rows_over_rest():
    """The same question as SQL, over PostgREST, in the same row shape: slug, session id,
    status, local open time, hours open, billable players, all players, overage.

    The join is done here rather than in the query because PostgREST embeds only across a
    declared foreign key, and v_vp_session_metering is a view. Three small reads and a
    dictionary is clearer than fighting that, and there are never many open sessions."""
    import json, datetime, re as _re, urllib.request
    env = {}
    try:
        for line in open(os.path.expanduser('~/.gflam-migrate.env')):
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v.strip()
    except Exception:
        return None
    base, key = env.get('NEW_SUPABASE_URL'), env.get('NEW_SERVICE_KEY')
    if not base or not key:
        return None
    def get(path):
        req = urllib.request.Request(base.rstrip('/') + '/rest/v1/' + path,
                                     headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    try:
        sess = get('vp_sessions?ended_at=is.null'
                   '&select=id,status,opened_at,started_at,created_at,venue_id')
        if not sess:
            return []                      # genuinely none open: an empty answer, not a missing one
        ven = {v['id']: v for v in get('vp_venues?select=id,slug,timezone')}
        met = {m['session_id']: m for m in get('v_vp_session_metering'
                                               '?select=session_id,billable_players,all_players,session_overage')}
    except Exception:
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    out = []
    for s in sess:
        v = ven.get(s.get('venue_id'), {})
        raw = s.get('opened_at') or s.get('started_at') or s.get('created_at') or ''
        try:
            t = datetime.datetime.fromisoformat(
                _re.sub(r'\.(\d{1,6})(?=[+-]|Z)',
                        lambda m: '.' + m.group(1).ljust(6, '0'), raw.replace('Z', '+00:00')))
        except Exception:
            t = None
        # The venue's own clock, like the SQL does with "at time zone v.timezone".
        try:
            import zoneinfo
            tz = zoneinfo.ZoneInfo(v.get('timezone') or 'Australia/Brisbane')
        except Exception:
            tz = datetime.timezone(datetime.timedelta(hours=10))
        shown = t.astimezone(tz).strftime('%d %b %H:%M') if t else '(no date)'
        hours = int((now - t).total_seconds() // 3600) if t else 0
        m = met.get(s['id'], {})
        out.append([v.get('slug') or '(no slug)', s['id'], s.get('status') or '?', shown,
                    str(hours), str(m.get('billable_players') or 0),
                    str(m.get('all_players') or 0), str(m.get('session_overage') or 0)])
    return out

def main():
    # NOT 'OLD_DB_URL'. After the move to Sydney, "old" is the abandoned copy: this would
    # have found nothing there, for ever, and reported a clean bill every night. See vp_live.py.
    L = live()
    url = L.db_url
    if not url: print('STOP: no live database configured'); sys.exit(1)
    print('\n' + L.banner())
    """WITHOUT psql, ASK THE REST API INSTEAD OF GIVING UP.

       A session nobody closed bills every player who ever joined it, and this check has
       been red every day because psql is not installed here. "This is a missing tool, not
       a fault in the product" is true, and it is also indistinguishable from the real
       thing when you are reading a gate at midnight. psql stays first; this is so the
       answer exists either way."""
    rows = None
    if PSQL is not None:
        r = subprocess.run([PSQL, url, '-At', '-F', '|', '-c', SQL], capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            print('could not ask the database: ' + (r.stderr or '').strip()[:200]); sys.exit(1)
        rows = [l.split('|') for l in r.stdout.splitlines() if l.strip()]
    else:
        rows = _rows_over_rest()
        if rows is None:
            print('STOP: psql is not installed and the REST fallback could not read the')
            print('      database either, so this check cannot run. Install Postgres.app')
            print('      from https://postgresapp.com, or check NEW_SUPABASE_URL and')
            print('      NEW_SERVICE_KEY in ~/.gflam-migrate.env.')
            sys.exit(1)
        print('(psql is not installed, so this asked the REST API instead)')

    # A session opened today may simply be tonight's, so it is not yet anybody's fault.
    # The nightly sweep runs at 3am Brisbane, so anything past a day has outlived it.
    STALE_HOURS = 24
    problems, untidy, todays = [], [], []
    for slug, sid, status, opened, hours, billable, allp, over in rows:
        hours, billable, allp, over = int(hours), int(billable), int(allp), int(over)
        if hours < STALE_HOURS: todays.append((slug, status, opened, allp))
        elif billable > 0:      problems.append((slug, sid, status, opened, hours, billable, over))
        else:                   untidy.append((slug, sid, status, opened, hours, allp))

    print('\nSESSIONS NOBODY CLOSED')
    print('  %d session(s) have no end time at all.\n' % len(rows))

    if todays:
        print('  Opened in the last day, so possibly just tonight:')
        for slug, status, opened, allp in todays:
            print('    -- %-24s %-10s opened %s, %d player(s) joined' % (slug, status, opened, allp))
        print('')

    if untidy:
        print('  Open past the nightly sweep but NOBODY PLAYED, so nothing can be billed:')
        for slug, sid, status, opened, hours, allp in untidy:
            print('    -- %-24s %-10s opened %s, %d hours ago, %d joined, 0 billable' % (slug, status, opened, hours, allp))
        print('')

    if problems:
        print('  THESE CAN BE BILLED. Each one is players who actually played, sitting in a')
        print('  session that has never been closed:')
        for slug, sid, status, opened, hours, billable, over in problems:
            print('    FAIL %-24s %-10s opened %s, %d hours ago' % (slug, status, opened, hours))
            print('         %d billable player(s), %d over the plan cap' % (billable, over))
            print('         session %s' % sid)
        print('')
        print('  Closing one sets ended_at. Do NOT delete the row: the players and their')
        print('  results hang off it, and the venue may already have been invoiced for them.')
        print('')
        print('%d session(s) can still be billed and nobody has closed them.' % len(problems))
        sys.exit(1)

    print('  Nothing unclosed can be billed.')

if __name__ == '__main__':
    main()
