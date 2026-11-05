#!/usr/bin/env python3
"""THE HOST CONSOLE FROM A HOST'S POINT OF VIEW: every main screen, as pictures (Dean, 4 Nov 2026, round 3 P).

Not a test. Opens the shipped console pages in headless Chrome against the repo's own rigs, signed in as
  single   the owner of ONE venue (Test Alpha, QLD), the way most pubs see it
  group    the owner of TWO venues (Deepwater Hotel and The Royal Arms, NSW), the way a group sees it
at phone width (390 x 844, an iPhone, island-safe: the pages pad for the safe areas themselves) and iPad width
(820 x 1180), and saves one PNG per screen. Nothing is written to any live service: the game Worker and the
billing Worker run in jsc behind a pipe with a fake database (tools/browser-rig/rig.py, admin_site.py).

Screens: sign-in, Play (the game picker), the venue question (group only), bingo setup, trivia, musical bingo,
raffle and members draw setup (Advanced settings open), Your account (Billing, People, Nights, Screen, Draws
with each fold, Marketing), Game settings, the monthly report.

    python3 tools/console-round3-shots.py --root ~/gflam-ai-team/sites-wt-release-4nov --out DIR --tag before
    python3 tools/console-round3-shots.py --out DIR --tag after          (this checkout)
    python3 tools/console-round3-shots.py --index DIR                    (write DIR/index.html from the PNGs there)

--root serves another checkout's venueplay/ (a pristine release, for "before"); the rig files are always this
checkout's. One Chrome at a time: the heavy lock is held for the run (VP_WAIT_LOCK seconds to wait for it).
"""
import argparse, io, json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=REPO)
ap.add_argument('--out')
ap.add_argument('--tag', default='after')
ap.add_argument('--index', help='only write index.html for the PNGs in this folder')
ap.add_argument('--only', help='single or group')
A = ap.parse_args()

WIDTHS = ((390, 844), (820, 1180))
IPHONE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
             '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')

# The screens, in the order a host meets them, with the note letters they answer.
SCREENS = [
    ('signin', 'Sign in', ''), ('venue-pick', 'Which venue are you at? (a host with more than one venue)', 'M N'),
    ('play', 'Play, the main screen', 'M N O U'), ('bingo-setup', 'Bingo setup', 'O U'),
    ('trivia-setup', 'Trivia setup', 'O U'), ('musical-setup', 'Musical bingo setup', 'O U'),
    ('raffle-setup', 'Raffle setup', 'O U'), ('members-setup', 'Members draw setup, Advanced settings open', 'O S T U'),
    ('account-billing', 'Your account: Billing', 'R U'), ('account-people', 'Your account: People', 'R U'),
    ('account-nights', 'Your account: Nights', 'R U'), ('account-screen', 'Your account: Screen', 'R U'),
    ('account-draws-raffles', 'Your account: Draws, Raffles fold', 'R U'),
    ('account-draws-members', 'Your account: Draws, Members draws fold', 'R S T U'),
    ('account-draws-permits', 'Your account: Draws, Permits fold', 'Q R U'),
    ('account-marketing', 'Your account: Marketing', 'R U'), ('settings', 'Game settings', 'O R U'),
    ('report', 'Monthly report', 'U'),
]


def write_index(folder):
    """DIR/index.html. With DIR/before and DIR/after present, the side-by-side of the two; else the PNGs in DIR."""
    subs = [d for d in ('before', 'after') if os.path.isdir(os.path.join(folder, d))]
    if subs:
        files = sorted(d + '/' + f for d in subs for f in os.listdir(os.path.join(folder, d)) if f.endswith('.png'))
    else:
        files = sorted(f for f in os.listdir(folder) if f.endswith('.png'))
    tags = [t for t in ('before', 'after') if any(os.path.basename(f).startswith(t + '-') for f in files)]
    rows = []
    for persona in ('single', 'group'):
        for key, title, letters in SCREENS:
            for w, h in WIDTHS:
                cells = []
                for tag in tags:
                    f = '%s-%s-%s-%d.png' % (tag, persona, key, w)
                    if subs: f = tag + '/' + f
                    cells.append('<figure><figcaption>%s</figcaption>%s</figure>' % (
                        tag, ('<img src="%s" loading="lazy">' % f) if f in files else '<div class="none">no picture</div>'))
                if any('<img' in c for c in cells):
                    rows.append('<section><h2>%s host: %s <small>%dpx wide%s</small></h2><div class="pair n%d">%s</div></section>' % (
                        persona, title, w, (', notes ' + letters) if letters else '', len(tags), ''.join(cells)))
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Host console round 3: %s</title>'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<style>body{margin:0;padding:24px;background:#0A0A0B;color:#E7E7EC;font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif}'
            'h1{font-size:22px;margin:0 0 6px}p{color:#A6A6B0;margin:0 0 22px}h2{font-size:15px;margin:28px 0 10px}h2 small{color:#8A8A94;font-weight:400;margin-left:8px}'
            '.pair{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(360px,1fr))}.pair.n1{grid-template-columns:minmax(300px,520px)}'
            'figure{margin:0}figcaption{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8A8A94;margin:0 0 6px}'
            'img{width:100%%;display:block;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#000}'
            '.none{border:1px dashed rgba(255,255,255,.2);border-radius:10px;padding:40px;text-align:center;color:#8A8A94}</style></head><body>'
            '<h1>Host console, round 3 (6 Nov release): %s</h1>'
            '<p>Headless Chrome against the repo rigs, no live data. "single" is the owner of one venue (Test Alpha, QLD, on the console; Deepwater Hotel, NSW, on the account pages: the two rigs have their own venue); "group" the owner of two '
            '(Deepwater Hotel and The Royal Arms, NSW). 390px is an iPhone, 820px an iPad. Pictures are the full page, so long ones scroll.</p>%s</body></html>'
            % (' and '.join(tags), ' and '.join(tags) if len(tags) > 1 else tags[0] if tags else '', ''.join(rows)))
    io.open(os.path.join(folder, 'index.html'), 'w', encoding='utf-8').write(html)
    print('wrote %s (%d pictures)' % (os.path.join(folder, 'index.html'), len(files)))


if A.index:
    write_index(A.index)
    sys.exit(0)
if not A.out:
    ap.error('--out DIR is needed')

import gatelib  # noqa: E402
if not gatelib.hold_lock_or_refuse('console-round3-shots', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    sys.exit(2)
import rig as RIG  # noqa: E402
import admin_site  # noqa: E402

ROOT = os.path.abspath(A.root)
os.makedirs(A.out, exist_ok=True)
RIG.ROOT = ROOT   # the game rig serves and runs the other checkout (Worker cwd and the pages), rig files stay ours


def shot_path(persona, key, w):
    return os.path.join(A.out, '%s-%s-%s-%d.png' % (A.tag, persona, key, w))


def phone_ua(B, sid, mobile):
    if mobile:
        B.call('Emulation.setUserAgentOverride', {'userAgent': IPHONE_UA, 'platform': 'iPhone'}, session=sid)
        B.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5}, session=sid)


# ------------------------------------------------------------------ the console (game Worker rig)
def console_shots(persona):
    r = RIG.Rig(host_pages=('/app/trivia/host.html', '/app/musical/host.html', '/app/members/host.html', '/app/raffle/host.html'))
    V1 = r.W.info['venue']
    if persona == 'group':
        V2 = '33333333-3333-4333-8333-333333333332'   # never the rig's own venue id (worker-stdio.js VENUE), or two rows name ONE venue
        v2 = {'id': V2, 'name': 'The Royal Arms', 'slug': 'the-royal-arms', 'status': 'active', 'suspended_reason': None,
              'join_code': 'RYL456', 'au_state': 'NSW', 'max_players': 60, 'included_players': None,
              'created_at': '2026-09-02T00:00:00Z', 'postcode': '2000', 'logo_url': None, 'paid_entry_enabled': False}
        r.db['vp_venues'] = [dict(r.db['vp_venues'][0], name='Deepwater Hotel', au_state='NSW', postcode='2371'), v2]
        r.db['vp_venue_staff'] = r.db['vp_venue_staff'] + [{'auth_user_id': RIG.UID, 'venue_id': V2, 'role': 'owner', 'display_name': 'Test Host'}]
        r.W.seed('vp_venues', [v2])

    def fullshot(sid, path, full=True):
        import base64
        res = r.B.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': bool(full)}, session=sid)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(res['data']))

    def open_page(path, w, h, before=None):
        tid = r.B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        sid = r.B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        r.B.call('Page.enable', {}, session=sid)
        r.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True}, session=sid)
        phone_ua(r.B, sid, True)
        if before:
            r.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': before}, session=sid)
        r.B.call('Page.navigate', {'url': r.base + path}, session=sid)
        return tid, sid

    try:
        for w, h in WIDTHS:
            # sign-in: nobody signed in, the page's own sign-in card
            tid, sid = open_page('/app/', w, h, before='window.__FAKE_TEST={signedIn:false};')
            r.until(sid, '!document.getElementById("vSignIn").classList.contains("hidden")', 20); time.sleep(1.2)
            fullshot(sid, shot_path(persona, 'signin', w), False); r.close_tab(tid)

            # Play: a fresh shift (no venue pick remembered), a connected console
            tid, sid = open_page('/app/', w, h, before='try{localStorage.removeItem("vpVenuePick");localStorage.removeItem("vpCurrentVenue")}catch(e){}')
            if persona == 'group':
                r.until(sid, 'document.querySelectorAll("#venuePickList button").length > 1', 25); time.sleep(0.8)
                fullshot(sid, shot_path(persona, 'venue-pick', w), False)
                r.ask(sid, '[].filter.call(document.querySelectorAll("#venuePickList button"),function(b){return /Deepwater/.test(b.textContent)})[0].click(); true')
            r.until(sid, '!document.getElementById("vConsole").classList.contains("hidden") && !document.getElementById("gameSelect").classList.contains("hidden")', 30)
            time.sleep(2.0)
            fullshot(sid, shot_path(persona, 'play', w), True)
            # bingo setup, on the same page
            r.ask(sid, 'document.querySelector(\'#gamePicker .pk[data-game="bingo"]\').click(); true')
            r.until(sid, '!document.getElementById("bingoView").classList.contains("hidden")', 15); time.sleep(1.5)
            fullshot(sid, shot_path(persona, 'bingo-setup', w), True)
            r.close_tab(tid)

            # the other games' setup pages, each its own page (they read the venue the console just chose)
            for key, path, ready in (('trivia-setup', '/app/trivia/host.html', 'document.readyState==="complete"'),
                                     ('musical-setup', '/app/musical/host.html', 'document.readyState==="complete"'),
                                     ('raffle-setup', '/app/raffle/host.html', 'document.readyState==="complete"'),
                                     ('members-setup', '/app/members/host.html', 'document.readyState==="complete"')):
                tid, sid = open_page(path, w, h)
                r.until(sid, ready, 25); time.sleep(3.0)
                if key == 'members-setup':
                    r.ask(sid, 'var d=document.getElementById("membersAdv"); if(d) d.open=true; true'); time.sleep(0.6)
                fullshot(sid, shot_path(persona, key, w), True)
                r.close_tab(tid)
        print('  console pictures done: %s' % persona)
    finally:
        r.close()


# ------------------------------------------------------------------ Your account, Game settings, the report (billing Worker rig)
def account_shots(persona):
    real_fake_db = admin_site.fake_db

    def one_venue_db(info, admin):
        """The single-venue host on the account pages: the billing Worker's own first venue (Deepwater Hotel, NSW)
        and nothing else. The Worker's rows are its own, so the page and the Worker must name the same venue."""
        db = real_fake_db(info, admin)
        db['vp_venues'] = [db['vp_venues'][0]]
        db['vp_venue_staff'] = [s for s in db['vp_venue_staff'] if s['venue_id'] == info['venue']]
        return db
    if persona == 'single':
        admin_site.fake_db = one_venue_db
    S = admin_site.Site(root=ROOT, fonts=True)
    V1 = S.W.info['venue']
    # prizes recorded, so the Permits fold has a total to weigh against the state's line (Q)
    S.extra_db['v_vp_prizes_given'] = [{'venue_id': V1, 'prizes_given_count': 5, 'prizes_given_value_cents': 95000,
                                        'cash_given_count': 3, 'cash_given_value_cents': 80000}]
    UP = ('document.getElementById("content") && document.getElementById("content").style.display!=="none" && '
          'document.getElementById("s-plan").textContent!=="–"')

    def tab(sid, name):
        S.js(sid, 'document.querySelector(\'.tabs button[data-tab="%s"]\').click(); true' % name); time.sleep(1.5)

    def fold(sid, name):
        S.js(sid, 'var h=document.querySelector(\'#tp-draws .acchead[data-acc="%s"]\'); if(h && !h.classList.contains("open")) h.click(); true' % name); time.sleep(1.2)

    try:
        for w, h in WIDTHS:
            tid, sid = S.open('/app/billing.html', w, h, True, pre='try{localStorage.removeItem("vpAcctTab");localStorage.removeItem("vpDrawsFold")}catch(e){}')
            S.until(sid, UP, 30); time.sleep(1.5)
            S.shot(sid, shot_path(persona, 'account-billing', w), full=True)
            for name in ('people', 'nights', 'screen'):
                tab(sid, name); S.shot(sid, shot_path(persona, 'account-%s' % name, w), full=True)
            tab(sid, 'draws')
            S.until(sid, 'document.querySelectorAll("#rfList, #mdList").length===2', 10); time.sleep(1.5)
            fold(sid, 'raffles'); S.shot(sid, shot_path(persona, 'account-draws-raffles', w), full=True)
            fold(sid, 'members'); S.shot(sid, shot_path(persona, 'account-draws-members', w), full=True)
            fold(sid, 'permits'); time.sleep(1.0); S.shot(sid, shot_path(persona, 'account-draws-permits', w), full=True)
            tab(sid, 'marketing'); S.shot(sid, shot_path(persona, 'account-marketing', w), full=True)
            S.close_tab(tid)

            tid, sid = S.open('/app/settings.html', w, h, True)
            S.until(sid, '!document.getElementById("body").classList.contains("hidden")', 25); time.sleep(1.5)
            S.shot(sid, shot_path(persona, 'settings', w), full=True); S.close_tab(tid)

            tid, sid = S.open('/app/report.html', w, h, True)
            S.until(sid, '!document.getElementById("emptyState").classList.contains("hidden") || !document.getElementById("body").classList.contains("hidden") || document.getElementById("msg").textContent', 25)
            time.sleep(1.2)
            S.shot(sid, shot_path(persona, 'report', w), full=True); S.close_tab(tid)
        print('  account pictures done: %s' % persona)
    finally:
        S.close()
        admin_site.fake_db = real_fake_db


for persona in ('single', 'group'):
    if A.only and A.only != persona:
        continue
    print('%s, %s host' % (A.tag, persona))
    console_shots(persona)
    account_shots(persona)
write_index(A.out)
