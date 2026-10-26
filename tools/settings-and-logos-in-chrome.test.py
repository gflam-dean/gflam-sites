#!/usr/bin/env python3
"""VENUE SETTINGS ASKS ONLY WHAT APPLIES, AND HQ CHOOSES THE WEBSITE LOGOS, IN THE REAL PAGES.

Dean, 20 Oct 2026:
  1. "I dont want a venue to be able to put it on our website we should choose". HQ > Venues >
     Details has a "Show logo on our website" switch (owner and accounts admins, through the real
     /admin/venue-gaming, audited); the "Hide from homepage" button is gone; Your account > Screen
     no longer has the venue's own tick.
  2. Venue settings "arent spaced out good or look good", and The Jolly Jess (an NSW non-profit)
     was full of permit questions it does not need: "if we dont need them to do it we dont need it
     to clog our system". The page is in grouped sections that hold together at phone width, and
     since 24 Oct 2026 its one permit card (bingo) comes from VPPermits.NEEDS (/app/vp-permits.js),
     shown only where the venue's state needs one; raffles and members draws are under Your
     account > Draws (tools/account-structure-in-chrome.test.py runs those).

This opens the REAL settings.html, hq.html and billing.html in headless Chrome
(tools/browser-rig/admin_site.py) with the REAL billing Worker behind them, so a saved permit and
a flipped switch are what the real routes wrote.

    python3 tools/settings-and-logos-in-chrome.test.py [--shots DIR] [--root CHECKOUT]
"""
import argparse, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
ap.add_argument('--root', default=ROOT)
A = ap.parse_args()

PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (detail,)) if detail != '' else ''))


def vid(n):
    return '22222222-2222-4222-8222-%012d' % (222222222220 + n)


W0 = admin_site.BillingWorker(A.root)
INFO = W0.info
W0.close()
UID = INFO['uid']
BASE = {'status': 'active', 'suspended_reason': None, 'max_players': 80, 'included_players': None,
        'created_at': '2026-09-01T00:00:00Z', 'founding_id': 'f1', 'paid_entry_enabled': False,
        'weekly_limit_off': False, 'permits': {}, 'venue_kind': None, 'compliance_accepted_at': '2026-10-16T00:00:00Z'}
VEN = {   # key: (id, name, slug, state, postcode, tz, entity, paid)
    'nsw_club': (INFO['venue'], 'The Jolly Jess', 'the-jolly-jess', 'NSW', '2040', 'Australia/Sydney', 'non_profit', False),
    'vic_club': (INFO['venue2'], 'Fitzroy Social', 'fitzroy-social', 'VIC', '3065', 'Australia/Melbourne', 'non_profit', True),
    'qld_club': (vid(4), 'Tugun Bowls Club', 'tugun-bowls', 'QLD', '4224', 'Australia/Brisbane', 'non_profit', False),
    'nsw_pub':  (vid(5), 'Deepwater Hotel', 'deepwater-hotel', 'NSW', '2371', 'Australia/Sydney', 'for_profit', False),
    'vic_new':  (vid(6), 'Brunswick Arms', 'brunswick-arms', 'VIC', '3056', 'Australia/Melbourne', None, False),
    'act_club': (vid(7), 'Weston Creek Club', 'weston-creek-club', 'ACT', '2611', 'Australia/Sydney', 'non_profit', True),
}
PERMITS_ON_FILE = {vid(7): {'raffle': {'number': '', 'holder': 'npo', 'npo_name': 'Lions Club of Weston', 'authorised_on': '2026-10-01',
                                       'expires': None, 'note': 'kept from before'}}}
ROWS = [dict(BASE, id=v[0], name=v[1], slug=v[2], au_state=v[3], postcode=v[4], timezone=v[5], entity_type=v[6],
             paid_entry_enabled=v[7], join_code=v[2][:3].upper() + '123', permits=PERMITS_ON_FILE.get(v[0], {})) for v in VEN.values()]
STAFF = [{'auth_user_id': UID, 'venue_id': v[0], 'role': 'owner', 'display_name': 'Olive Owner'} for v in VEN.values()
         if v[0] not in (INFO['venue'], INFO['venue2'])]
SETTINGS = [dict(venue_id=v[0], name_display='abbrev_last', collect_first_name=True, collect_last_name=False,
                 collect_postcode=False, collect_email=True, collect_mobile=False, collect_marketing_optin=True) for v in VEN.values()]

S = admin_site.Site(root=A.root, fonts=bool(A.shots),
                    extra_db={'vp_venues': ROWS, 'vp_venue_staff': STAFF, 'vp_venue_settings': SETTINGS})
S.W.seed('vp_venues', [dict(r, show_logo_on_site=False) for r in ROWS])
S.W.seed('vp_venue_staff', [{'id': 's%d' % i, 'auth_user_id': UID, 'venue_id': v[0], 'role': 'owner', 'permissions': None,
                             'display_name': 'Olive Owner'} for i, v in enumerate(VEN.values())])


def settings(key, width=1280, mobile=False):
    tid, sid = S.open('/app/settings.html?venue=' + VEN[key][0], width=width, mobile=mobile)
    S.until(sid, '!document.getElementById("body").classList.contains("hidden")', 20)
    time.sleep(1.0)
    return tid, sid


def shot(sid, name, width, mobile):
    if not A.shots:
        return
    os.makedirs(A.shots, exist_ok=True)
    h = S.js(sid, 'Math.ceil(document.documentElement.scrollHeight)')
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': int(h or 900),
             'deviceScaleFactor': 2 if mobile else 1, 'mobile': mobile}, session=sid)
    time.sleep(0.5)
    S.shot(sid, os.path.join(A.shots, name + '.png'))


PERMITS = '''JSON.stringify({card: (function(){var c=document.getElementById("permitsCard"); return !!c && c.offsetParent!==null;})(),
  kinds: Array.prototype.map.call(document.querySelectorAll("#permitsWrap .permit"), function(p){
    var vis=function(sel){ var e=p.querySelector(sel); return !!e && e.offsetParent!==null; };
    return { kind:p.getAttribute("data-kind"), status:(p.querySelector(".pstatus")||{}).textContent||"",
             number:vis(".pnumber"), expires:vis(".pexpires"), save:vis(".psave") }; }),
  draws: (function(){var a=document.querySelector('#permitsIntro a[href="billing.html#draws"]'); return !!a && a.offsetParent!==null;})(),
  text: document.body.innerText, errs: window.__errs||[] })'''

try:
    import json
    seen = {}
    for key in ('nsw_club', 'qld_club', 'vic_club', 'nsw_pub', 'vic_new', 'act_club'):
        tid, sid = settings(key)
        seen[key] = json.loads(S.js(sid, PERMITS))
        if key in ('nsw_club', 'qld_club', 'vic_club'):
            shot(sid, 'after-%s-desktop' % key, 1280, False)
        S.close_tab(tid)

    print('New South Wales needs no bingo permit, so the Jolly Jess and an NSW pub are asked for none')
    for key in ('nsw_club', 'nsw_pub'):
        x = seen[key]
        ok('%s: no Gaming details section, no permit field anywhere' % VEN[key][1],
           not x['card'] and not x['kinds'] and 'Permit, licence or authority number' not in x['text'], x['kinds'])
    x = seen['nsw_club']
    ok('the Jolly Jess still has its venue code, name display and player questions, under headings',
       all(h in x['text'].upper() for h in ('VENUE DETAILS', 'ON THE BIG SCREEN', 'PLAYERS')) and (VEN['nsw_club'][2][:3].upper() + '123') in x['text'], x['text'][:400])

    print('\nQueensland, Victoria and the ACT: the bingo card only (raffles and members draws are under Draws)')
    for key in ('qld_club', 'vic_club', 'vic_new', 'act_club'):
        x = seen[key]
        ok('%s (%s): Gaming details shows the bingo card and nothing else, with the link to Draws' % (VEN[key][1], VEN[key][3]),
           x['card'] and [p['kind'] for p in x['kinds']] == ['bingo'] and x['kinds'][0]['number'] and x['kinds'][0]['save'] and x['draws'], x['kinds'])
    ok('nothing on any settings page says musical bingo counts as bingo, or names it at all in the permit card',
       all('musical bingo counts' not in seen[k]['text'].lower() for k in seen) and 'musical' not in json.dumps(seen['vic_club']['kinds']).lower())

    print('\nsaving the VIC bingo permit goes through the real Worker')
    tid, sid = settings('vic_club')
    S.js(sid, '(function(){var p=document.querySelector(\'.permit[data-kind="bingo"]\'); p.querySelector(".pnumber").value="MGP-55021"; p.querySelector(".psave").click(); return true;})()')
    S.until(sid, '/Recorded/.test(document.querySelector(\'.permit[data-kind="bingo"] .pstatus\').textContent)', 10)
    row = [v for v in S.W.table('vp_venues') if v['id'] == VEN['vic_club'][0]]
    pb = (row[0].get('permits') or {}).get('bingo', {}) if row else {}
    ok('the venue\'s bingo permit is stored, held by the venue', pb.get('number') == 'MGP-55021' and pb.get('holder') == 'venue', pb)
    ok('and the card now says Recorded', 'Recorded' in (S.js(sid, 'document.querySelector(\'.permit[data-kind="bingo"] .pstatus\').textContent') or ''))
    S.close_tab(tid)

    print('\nat phone width')
    for key in ('vic_club', 'nsw_club', 'qld_club'):
        tid, sid = settings(key, width=390, mobile=True)
        wide = S.js(sid, '(function(){ if (document.documentElement.scrollWidth > window.innerWidth + 1) return false; var bad=[]; document.querySelectorAll(".card, .permit input, .psave").forEach(function(e){ var r=e.getBoundingClientRect(); if (r.width && (r.left < 0 || r.right > window.innerWidth + 1)) bad.push(e.className); }); return bad.length ? bad : true; })()')
        ok('%s: nothing runs off the side of a 390px phone' % VEN[key][1], wide is True, wide)
        shot(sid, 'after-%s-phone' % key, 390, True)
        S.close_tab(tid)
    ok('no script error on any settings page', all(not seen[k]['errs'] for k in seen), {k: seen[k]['errs'] for k in seen})

    print('\nYour account > Screen no longer lets a venue put itself on our website')
    tid, sid = S.open('/app/billing.html')
    S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector(\'[data-tab="screen"]\')', 20)
    S.js(sid, 'document.querySelector(\'[data-tab="screen"]\').click(); true')
    S.until(sid, '!!document.getElementById("logoFile")', 10)
    time.sleep(1.0)
    ok('no "Show our logo on the VenuePlay website" tick', S.js(sid, '!document.getElementById("logoOnSite") && !/Show our logo on the VenuePlay website/.test(document.body.innerText)') is True)
    S.close_tab(tid)
finally:
    S.close()

# HQ, as Dean, on the rig's two stock venues: Deepwater Hotel has a logo, The Royal Arms has none.
H = admin_site.Site(root=A.root, fonts=bool(A.shots), extra_db={'vp_venue_screen': [
    {'venue_id': INFO['venue'], 'logo_url': 'https://db/storage/v1/object/public/venue-logos/%s/%s.png' % (INFO['venue'], 'a' * 64)}]})
try:
    print('\nHQ: "Show logo on our website", clicked, through the real Worker')
    H.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
    tid, sid = H.open('/app/hq.html?as=admin')
    H.until(sid, 'document.querySelectorAll("button[data-details]").length > 0', 20)
    H.js(sid, 'document.querySelector(\'button[data-details="%s"]\').click(); true' % INFO['venue'])
    box = 'document.querySelector(\'input.logosite[data-vid="%s"]\')' % INFO['venue']
    H.until(sid, '!!%s' % box, 10)
    label = H.js(sid, '(function(){var b=%s; return b ? b.closest("label").textContent.trim() + "|" + b.checked + "|" + b.disabled : "none";})()' % box)
    ok('the Details panel shows "Show logo on our website", off', label == 'Show logo on our website|false|false', label)
    ok('the old "Hide from homepage" button is gone', H.js(sid, '!/Hide from homepage|Show on homepage/.test(document.body.innerText) && !document.querySelector("[data-hidehp]")') is True)
    note = H.js(sid, '%s.closest("div").querySelector(".note").textContent' % box)
    ok('Deepwater has a logo, so there is no "no logo" warning', isinstance(note, str) and 'no logo uploaded' not in note, note)
    H.js(sid, '%s.click(); true' % box)
    H.until(sid, '!!%s && %s.checked && !%s.disabled' % (box, box, box), 10)
    row = [v for v in H.W.table('vp_venues') if v['id'] == INFO['venue']]
    ok('clicking it switches the venue on in the database, through /admin/venue-gaming', row and row[0].get('show_logo_on_site') is True, row and row[0].get('show_logo_on_site'))
    aud = [a for a in H.W.table('vp_admin_audit') if a.get('action') == 'venue_logo_on_site_on']
    ok('and the audit log records Dean, the venue, off to on',
       len(aud) == 1 and aud[0].get('actor_label') == 'Dean' and aud[0].get('target') == 'venue:' + INFO['venue'] and (aud[0].get('detail') or {}).get('to') is True, aud)
    H.js(sid, '%s.click(); true' % box)
    H.until(sid, '!!%s && !%s.checked && !%s.disabled' % (box, box, box), 10)
    row = [v for v in H.W.table('vp_venues') if v['id'] == INFO['venue']]
    ok('clicking again switches it off, recorded too', row and row[0].get('show_logo_on_site') is False and
       len([a for a in H.W.table('vp_admin_audit') if a.get('action') == 'venue_logo_on_site_off']) == 1, row and row[0].get('show_logo_on_site'))
    H.js(sid, 'document.querySelector(\'button[data-details="%s"]\').click(); true' % INFO['venue2'])
    box2 = 'document.querySelector(\'input.logosite[data-vid="%s"]\')' % INFO['venue2']
    H.until(sid, '!!%s' % box2, 10)
    note = H.js(sid, '%s.closest("div").querySelector(".note").textContent' % box2)
    ok('a venue with no logo yet says nothing shows until it adds one (Tugun Bowls Club today)', isinstance(note, str) and 'no logo uploaded yet' in note, note)
    ok('no script error on HQ', H.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', H.js(sid, 'JSON.stringify(window.__errs||[])'))
    H.close_tab(tid)
finally:
    H.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 30
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
