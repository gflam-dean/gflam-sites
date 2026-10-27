#!/usr/bin/env python3
"""HQ'S "LET THEM RUN ONE MORE NIGHT", IN THE REAL PAGE, AGAINST THE REAL BILLING WORKER.

Dean, 20 Oct 2026: "it would be shit to not be able to fix something to let a venue play a night on a
night". Migration 110: a platform admin lets a venue start ONE more trivia or musical bingo night in
the next 24 hours, and it is used up on its own (the game Worker enforces and spends it:
tools/test-night-pass.js). This is the HQ end.

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py) signed in as an owner
admin. vp_venues and vp_admin_audit are read from the real billing Worker's database, so what a click
writes is what the page reads back after a reload, as it is live.
  - each venue card shows the pass state: none, Waiting (what for, until when, who granted it), Used
    (which format, when), Expired
  - choosing Trivia and "Let them run one more night" writes the pass through /admin/night-pass:
    trivia, 24 hours, granted by Dean, an audit row; the card says Waiting at once and after a reload
  - Cancel the pass ends a waiting one, with its own audit row

    python3 tools/night-pass-hq-in-chrome.test.py [--shots DIR]
"""
import argparse, datetime, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))


NOW = datetime.datetime.now(datetime.timezone.utc)
def at(hours):
    return (NOW + datetime.timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
def vid(n):
    return '30000000-0000-4000-8000-%012d' % n
def venue(n, name, **kw):
    v = {'id': vid(n), 'name': name, 'slug': name.lower().replace(' ', '-'), 'status': 'active', 'suspended_reason': None,
         'created_at': at(-24 * 400), 'timezone': 'Australia/Brisbane', 'founding_id': None, 'group_id': None,
         'max_players': 60, 'au_state': 'QLD', 'postcode': '4000', 'cancel_at_period_end': False, 'weekly_limit_off': False,
         'night_pass_format': None, 'night_pass_until': None, 'night_pass_granted_at': None, 'night_pass_granted_by': None,
         'night_pass_used_at': None, 'night_pass_used_format': None, 'night_pass_used_session': None}
    v.update(kw)
    return v


DEEP, WAIT, USED, LAPSED = 1, 2, 3, 4
VENUES = [
    venue(DEEP, 'Deepwater Hotel'),
    venue(WAIT, 'Waiting Tavern', night_pass_format='musical_bingo', night_pass_until=at(10), night_pass_granted_at=at(-14), night_pass_granted_by='Sam'),
    venue(USED, 'Used Arms', night_pass_format='either', night_pass_until=at(5), night_pass_granted_at=at(-19), night_pass_granted_by='Sam',
          night_pass_used_at=at(-2), night_pass_used_format='trivia', night_pass_used_session='90000000-0000-4000-8000-000000000001'),
    venue(LAPSED, 'Lapsed Inn', night_pass_format='trivia', night_pass_until=at(-3), night_pass_granted_at=at(-27), night_pass_granted_by='Sam'),
]

S = admin_site.Site(fonts=bool(A.shots), live_tables=['vp_venues', 'vp_admin_audit'])
UID = S.W.info['uid']
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_venues', VENUES)
S.W.seed('vp_sessions', [])
S.W.seed('vp_game_reports', [])
S.W.seed('vp_admin_audit', [])


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'))


def details(sid, n):
    S.js(sid, 'document.querySelector(\'button[data-details="%s"]\').click(); true' % vid(n))
    return S.until(sid, '!!document.querySelector(\'.nightpass[data-vid="%s"]\')' % vid(n), 10)


def card(sid, n):
    return S.js(sid, '(function(){var c=document.querySelector(\'.nightpass[data-vid="%s"]\');return c?c.innerText.replace(/\\s+/g," "):"";})()' % vid(n)) or ''


def state(sid, n):
    return S.js(sid, '(function(){var b=document.querySelector(\'.nightpass[data-vid="%s"] [data-npstate]\');return b?b.getAttribute("data-npstate"):"none";})()' % vid(n))


def row(n):
    return [v for v in S.W.table('vp_venues') if v['id'] == vid(n)][0]


def audits(action):
    return [a for a in S.W.table('vp_admin_audit') if a.get('action') == action]


try:
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1100)
    S.until(sid, 'document.querySelectorAll("#venueRows .vn").length > 0', 20)
    time.sleep(1)

    print('\nthe card shows the pass as it stands')
    ok('Deepwater Hotel: none given, and the button to give one', details(sid, DEEP) and state(sid, DEEP) == 'none' and 'None given' in card(sid, DEEP)
       and S.js(sid, '!!document.querySelector(\'button[data-npgrant="%s"]\')' % vid(DEEP)) is True, card(sid, DEEP))
    ok('...and says what it does, in plain words', 'ONE more trivia or musical bingo night in the next 24 hours' in card(sid, DEEP), card(sid, DEEP))
    ok('Waiting Tavern: Waiting, for musical bingo, granted by Sam, with a Cancel button',
       details(sid, WAIT) and state(sid, WAIT) == 'waiting' and 'One more musical bingo night, until' in card(sid, WAIT) and 'Granted by Sam' in card(sid, WAIT)
       and S.js(sid, '!!document.querySelector(\'button[data-npcancel="%s"]\')' % vid(WAIT)) is True, card(sid, WAIT))
    ok('Used Arms: Used, for a trivia night, and when', details(sid, USED) and state(sid, USED) == 'used' and 'Used for a trivia night on' in card(sid, USED), card(sid, USED))
    ok('Lapsed Inn: Expired, not used', details(sid, LAPSED) and state(sid, LAPSED) == 'expired' and 'Not used' in card(sid, LAPSED), card(sid, LAPSED))
    shot(sid, 'hq-night-pass-states')

    print('\ngive Deepwater Hotel one more trivia night')
    details(sid, DEEP) if S.js(sid, '!document.querySelector(\'.nightpass[data-vid="%s"]\')' % vid(DEEP)) else None
    S.js(sid, 'var f=document.querySelector(\'select.npfmt[data-vid="%s"]\'); f.value="trivia"; true' % vid(DEEP))
    S.js(sid, 'document.querySelector(\'button[data-npgrant="%s"]\').click(); true' % vid(DEEP))
    ok('the card says Waiting, one more trivia night', S.until(sid, '(function(){var b=document.querySelector(\'.nightpass[data-vid="%s"] [data-npstate]\');return b && b.getAttribute("data-npstate")==="waiting";})()' % vid(DEEP), 10) is True
       and 'One more trivia night, until' in card(sid, DEEP), card(sid, DEEP))
    r = row(DEEP)
    left = (datetime.datetime.strptime(r['night_pass_until'][:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc) - NOW).total_seconds() / 3600.0 if r.get('night_pass_until') else 0
    ok('the Worker wrote it: trivia, 24 hours, granted by Dean, nothing used',
       r.get('night_pass_format') == 'trivia' and 23.5 < left < 24.5 and r.get('night_pass_granted_by') == 'Dean' and r.get('night_pass_used_at') is None, r)
    g = audits('venue_night_pass_granted')
    ok('...with an audit row by Dean for this venue', len(g) == 1 and g[0].get('actor_label') == 'Dean' and g[0].get('target') == 'venue:' + vid(DEEP), g)
    shot(sid, 'hq-night-pass-granted')

    print('\ncancel the waiting pass at Waiting Tavern')
    if S.js(sid, '!document.querySelector(\'button[data-npcancel="%s"]\')' % vid(WAIT)):
        details(sid, WAIT)
    S.js(sid, 'document.querySelector(\'button[data-npcancel="%s"]\').click(); true' % vid(WAIT))
    ok('the card says Expired', S.until(sid, '(function(){var b=document.querySelector(\'.nightpass[data-vid="%s"] [data-npstate]\');return b && b.getAttribute("data-npstate")==="expired";})()' % vid(WAIT), 10) is True, card(sid, WAIT))
    c = audits('venue_night_pass_cancelled')
    ok('...recorded as cancelled, by Dean', len(c) == 1 and c[0].get('actor_label') == 'Dean' and c[0].get('target') == 'venue:' + vid(WAIT), c)

    print('\nafter a reload, the page reads it back from the database')
    S.close_tab(tid)
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1100)
    S.until(sid, 'document.querySelectorAll("#venueRows .vn").length > 0', 20)
    time.sleep(1)
    ok('Deepwater Hotel still shows Waiting', details(sid, DEEP) and state(sid, DEEP) == 'waiting', card(sid, DEEP))
    ok('Waiting Tavern still shows Expired', details(sid, WAIT) and state(sid, WAIT) == 'expired', card(sid, WAIT))
    errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
    ok('no script error on the page', errs == '[]', errs)
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('\n%d of %d checks passed' % (PASS[0], total))
EXPECTED = 13
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
