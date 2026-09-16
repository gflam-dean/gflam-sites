#!/usr/bin/env python3
"""The 90 days the privacy page promises, and nothing else in this product implements.

venueplay.com.au/privacy says, today:

    When a venue's account is closed, its player list is deleted within 90 days, other
    than anything we have to keep for tax or legal record-keeping.

Nothing deleted anything. This does.

    python3 tools/purge-closed-player-data.py              what WOULD happen. changes nothing.
    python3 tools/purge-closed-player-data.py --apply      does it
    python3 tools/purge-closed-player-data.py --days 60    a shorter window, for a dry run

WHAT COUNTS AS CLOSED, and why it is narrow

  suspended_reason      closed?  why
  ended                 yes      the subscription finished
  archived              yes      archived by HQ or the nightly sweep
  archived_cancelling   yes      the owner cancelled first, then it was archived
  nonpayment            NO       a card that failed. They pay, they come back, and their
                                 members list must still be there.
  manual                NO       an admin switched them off. Reversible by definition.
  ending                NO       the last night is still running. See vpaEndAfterLastNight.

WHEN DID IT CLOSE? Nothing stores it. vp_venues has no closed_at, so the date comes from
the audit row that closed it. **A venue with no audit row is NEVER purged.** A missing
date must never be read as an expired one; that is the same rule the archive sweep uses
and for the same reason.

WHAT HAPPENS TO THE DATA

  vp_players    ANONYMISED, row kept. Name, email, mobile, postcode, IP hash and device
                id are nulled. The row survives so the session still knows it had eleven
                players, which is what the overage billing and the tax record rest on,
                and which the privacy page explicitly carves out.
  vp_captures   DELETED outright. A capture IS the opt-in record. It has no billing
                meaning, so there is nothing to keep.

WHAT IT DELIBERATELY DOES NOT TOUCH, and reports instead

  vp_members, and vp_member_draw_results.winner_name. Those are the venue's own membership
  roll and its draw history, not the "player list" the privacy page names. Quietly
  widening the scope of a deletion is not a decision a tool should make on its own. They
  are counted and shown so Dean can decide.

THE JOINS ARE THE WHOLE RISK. Only vp_captures carries venue_id. vp_players reaches a
venue through vp_sessions, vp_members through vp_member_rosters, and the draw winners
through vp_member_draws. A purge written against venue_id alone would report success and
clear almost nothing.
"""
import argparse, datetime, json, os, re, subprocess, sys

ENV = {}
for _l in open(os.path.expanduser('~/.gflam-migrate.env')):
    if '=' in _l and not _l.startswith('#'):
        _k, _v = _l.split('=', 1)
        ENV[_k] = _v.strip()
URL = ENV['NEW_SUPABASE_URL']
H = ['-H', 'apikey: ' + ENV['NEW_SERVICE_KEY'], '-H', 'Authorization: Bearer ' + ENV['NEW_SERVICE_KEY']]

CLOSED_REASONS = ('ended', 'archived', 'archived_cancelling')
PLAYER_FIELDS = ('display_name', 'email', 'first_name', 'last_name', 'mobile',
                 'postcode', 'ip_hash', 'device_id', 'device_hint')


def sb(method, path, body=None, prefer=None):
    cmd = ['curl', '-sS', '-X', method, URL + '/rest/v1/' + path] + H
    if prefer:
        cmd += ['-H', 'Prefer: ' + prefer]
    if body is not None:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else []
    except Exception:
        return {'_raw': r.stdout[:200]}


def iso(s):
    """Postgres returns 1 to 6 fractional digits; datetime wants exactly 6."""
    s = re.sub(r'\.(\d{1,6})(?=[+-]|Z)', lambda m: '.' + m.group(1).ljust(6, '0'), s.replace('Z', '+00:00'))
    return datetime.datetime.fromisoformat(s)


def ids(rows, key='id'):
    return [r[key] for r in rows if r.get(key)]


def inlist(vals):
    return '(' + ','.join(vals) + ')'


def venue_data(vid):
    """Everything personal that hangs off one venue, through the joins that actually reach it."""
    out = {}
    sess = sb('GET', 'vp_sessions?venue_id=eq.%s&select=id' % vid)
    sids = ids(sess)
    out['sessions'] = sids
    out['players'] = sb('GET', 'vp_players?session_id=in.%s&select=id,email,mobile,first_name,last_name,display_name,postcode,ip_hash,device_id,device_hint'
                        % inlist(sids)) if sids else []
    out['captures'] = sb('GET', 'vp_captures?venue_id=eq.%s&select=id' % vid)
    rost = sb('GET', 'vp_member_rosters?venue_id=eq.%s&select=id' % vid)
    rids = ids(rost)
    out['members'] = sb('GET', 'vp_members?roster_id=in.%s&select=id' % inlist(rids)) if rids else []
    draws = sb('GET', 'vp_member_draws?venue_id=eq.%s&select=id' % vid)
    dids = ids(draws)
    out['winners'] = sb('GET', 'vp_member_draw_results?draw_id=in.%s&select=id,winner_name'
                        % inlist(dids)) if dids else []
    return out


def identifiable(players):
    return [p for p in players if any(p.get(f) for f in PLAYER_FIELDS)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='actually do it')
    ap.add_argument('--days', type=int, default=90)
    a = ap.parse_args()
    now = datetime.datetime.now(datetime.timezone.utc)

    venues = sb('GET', 'vp_venues?status=eq.suspended&select=id,name,suspended_reason')
    closed = [v for v in venues if v.get('suspended_reason') in CLOSED_REASONS]
    audit = sb('GET', 'vp_admin_audit?select=action,target,created_at&order=created_at.desc&limit=2000')

    print('%d suspended venue(s), %d of them closed for good\n' % (len(venues), len(closed)))
    due, waiting, undated = [], [], []
    for v in closed:
        rows = [x for x in audit if (x.get('target') or '') == 'venue:' + v['id']
                and any(k in x['action'] for k in ('archiv', 'suspend', 'cancel'))]
        if not rows:
            undated.append(v)
            continue
        age = (now - iso(rows[0]['created_at'])).days
        (due if age >= a.days else waiting).append((v, age))

    for v, age in sorted(waiting, key=lambda x: -x[1]):
        print('  waiting   %-26s closed %d days ago, %d to go' % (v['name'][:26], age, a.days - age))
    for v in undated:
        print('  SKIPPED   %-26s no audit row, so nothing can date it. Never purged on a guess.'
              % v['name'][:26])
    print()

    if not due:
        print('Nothing is %d days past closing. Nothing to do.' % a.days)
    total_p = total_c = 0
    for v, age in due:
        d = venue_data(v['id'])
        ident = identifiable(d['players'])
        print('  DUE       %-26s closed %d days ago' % (v['name'][:26], age))
        print('              %d session(s), %d player(s), %d of them identifiable'
              % (len(d['sessions']), len(d['players']), len(ident)))
        print('              %d capture(s) to delete' % len(d['captures']))
        keep_m, keep_w = len(d['members']), len([w for w in d['winners'] if w.get('winner_name')])
        if keep_m or keep_w:
            print('              NOT TOUCHED: %d member(s) and %d named draw winner(s). Those are the'
                  % (keep_m, keep_w))
            print('              venue\'s own records, not the "player list". Dean decides.')
        total_p += len(ident)
        total_c += len(d['captures'])
        if a.apply:
            if ident:
                sb('PATCH', 'vp_players?id=in.%s' % inlist(ids(ident)),
                   {f: None for f in PLAYER_FIELDS}, prefer='return=minimal')
            if d['captures']:
                sb('DELETE', 'vp_captures?id=in.%s' % inlist(ids(d['captures'])), prefer='return=minimal')
            after = venue_data(v['id'])
            still = identifiable(after['players'])
            ok = not still and not after['captures']
            print('              %s  %d identifiable player(s) and %d capture(s) remain'
                  % ('PURGED' if ok else 'INCOMPLETE', len(still), len(after['captures'])))
            sb('POST', 'vp_admin_audit', {
                'actor_admin': None, 'actor_label': 'automatic (%d-day player purge)' % a.days,
                'action': 'player_data_purged' if ok else 'player_data_purge_incomplete',
                'target': 'venue:' + v['id'],
                'detail': {'name': v['name'], 'days_since_closed': age,
                           'players_anonymised': len(ident), 'captures_deleted': len(d['captures']),
                           'members_left': keep_m, 'winners_left': keep_w}}, prefer='return=minimal')
            if not ok:
                sys.exit(1)

    if due and not a.apply:
        print('\n  %d player row(s) would be anonymised and %d capture(s) deleted.' % (total_p, total_c))
        print('  Nothing has changed. Run again with --apply.')


main()
