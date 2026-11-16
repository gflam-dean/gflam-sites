#!/usr/bin/env python3
"""Two venues on the venueplay TEST database that look like real pubs (Dean, 16 Nov 2026: "on the test server you do
maybe 2-3 different venues with logos etc"; then "maybe two venues and then sign up a new one").

On 15 Nov live faults at The Mini Bar (a doubled logo on the TV, the buzzer timing) could not be seen on staging because
the only staging venue had no logo, no slides and no sounds. These two are set up the way real venues are, mostly
through the staging Workers' own routes as the test host, so the same checks and writes a venue's own console makes run:

  A  Stage Mini Bar (QLD)  a dark wordmark logo on a transparent background (the hard case on a dark TV), 4 TV slides
     incl. a "scan to join" slide, What's on with 3 nights, game sounds ON, the time's-up buzzer ON, a saved draw look
     (raffle race, members flip), a raffle (2 on the list, prize buttons) and a members draw on a members list of 20.
     A second login (the TEST manager, 0491 570 002) is a HOST here with a "Hosted by" card (name + logo) for trivia and
     musical bingo, so the TV can show venue logo + venue name + hosted by in one frame: the duplicated-branding check.
     --logo box swaps the logo for the same wordmark in a white box (how many real uploads look).
  B  Stage Harbour Hotel (NSW)  NO logo; the NSW rules (vp-permits.js NEEDS: raffle and members draw "conditional",
     bingo free entry only, no paid bingo at a pub): a raffle authority held by a charity and a trade promotion number
     recorded; a members list of 30 written "Last,First" in one name box (a club export with one Name column); a members
     draw with draw moments ON (countdown) and the winner takes the screen ON; a purchase raffle SET UP to start in two
     days (not started, TEST only).

The third venue is a fresh public sign-up every run (tools/staging/real-venues-play.py --signup), not this script.

SAFE BY CONSTRUCTION. Reads TEST_SUPABASE_URL / TEST_SERVICE_KEY / TEST_ANON_KEY from ~/.gflam-migrate.env and refuses
to run unless the URL is exactly the TEST project (rkfaftxgzpsmmrzudlqy) and nothing it will call names live: it
refuses the LIVE project (ijkzgmdtwtgfkedqspxm, api.venueplay.com.au, game.venueplay.com.au). The Workers it calls are the staging ones only.
Every row has a fixed id (5eed00b*), so a re-run updates in place: idempotent. Prints no key.

    python3 tools/staging/seed-real-venues.py              seed / refresh both
    python3 tools/staging/seed-real-venues.py --logo box   Stage Mini Bar's logo in a white box instead
    python3 tools/staging/seed-real-venues.py --check      read back and say what each venue has (writes nothing)
    python3 tools/staging/seed-real-venues.py --dry-run    the guards only
"""
import base64, datetime, hashlib, io, json, os, sys, time, urllib.error, urllib.request

TEST_REF = 'rkfaftxgzpsmmrzudlqy'
LIVE_REF = 'ijkzgmdtwtgfkedqspxm'
TEST_URL = 'https://%s.supabase.co' % TEST_REF
API = 'https://api-staging.venueplay.com.au'
GAME = 'https://game-staging.venueplay.com.au'
SITE = 'https://staging.venueplay.com.au'
HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'real-venues')

HOST_UID = '5eed0001-0000-4000-8000-000000000001'      # 0491 570 001, owner of the TEST venues (seed-test-data.sql)
HOST2_UID = '5eed0001-0000-4000-8000-000000000002'     # 0491 570 002, a HOST at Stage Mini Bar with a Hosted by card

A = dict(id='5eed00b2-0000-4000-8000-0000000000a1', founding='5eed00b4-0000-4000-8000-0000000000a1',
         slug='stage-mini-bar', name='Stage Mini Bar', state='QLD', postcode='4227', suburb='Varsity Lakes',
         tz='Australia/Brisbane', staff='5eed00b5-0000-4000-8000-0000000000a1', roster='5eed00b6-0000-4000-8000-0000000000a1',
         draw='5eed00b7-0000-4000-8000-0000000000a1')
B = dict(id='5eed00b2-0000-4000-8000-0000000000b1', founding='5eed00b4-0000-4000-8000-0000000000b1',
         slug='stage-harbour-hotel', name='Stage Harbour Hotel', state='NSW', postcode='2060', suburb='North Sydney',
         tz='Australia/Sydney', staff='5eed00b5-0000-4000-8000-0000000000b1', roster='5eed00b6-0000-4000-8000-0000000000b1',
         draw='5eed00b7-0000-4000-8000-0000000000b1', praffle='5eed00b8-0000-4000-8000-0000000000b1')
HOST2_STAFF = '5eed00b5-0000-4000-8000-0000000000a2'
VENUES = (A, B)


def die(msg):
    sys.exit('seed-real-venues: ' + msg)


def load_env():
    e = {}
    p = os.path.expanduser('~/.gflam-migrate.env')
    if not os.path.exists(p):
        die('no ~/.gflam-migrate.env')
    for line in open(p):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            e[k.replace('export ', '').strip()] = v.strip().strip('"').strip("'")
    url = e.get('TEST_SUPABASE_URL', '').rstrip('/')
    if url != TEST_URL:
        die('TEST_SUPABASE_URL is not the TEST project %s. Refusing.' % TEST_REF)
    for k in ('TEST_SERVICE_KEY', 'TEST_ANON_KEY'):
        if not e.get(k):
            die(k + ' missing')
        if LIVE_REF in e[k]:
            die(k + ' names the LIVE project. Refusing.')
    for u in (API, GAME, SITE):
        if LIVE_REF in u or not ('-staging.' in u or u.startswith('https://staging.')):
            die('not a staging address: ' + u)
    return url, e['TEST_SERVICE_KEY'], e['TEST_ANON_KEY']


URL, SKEY, AKEY = None, None, None


def http(method, url, body=None, headers=None, raw=None, timeout=40):
    if LIVE_REF in url or url.startswith('https://api.venueplay') or url.startswith('https://game.venueplay'):
        die('refusing a live address')
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Content-Type': 'application/json', 'User-Agent': 'venueplay-staging-seed'}
    h.update(headers or {})
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        t = urllib.request.urlopen(r, timeout=timeout).read().decode()
        return json.loads(t) if t.strip() else None
    except urllib.error.HTTPError as x:
        return {'__error': x.code, 'body': x.read()[:500].decode('utf-8', 'replace')}


def svc():
    return {'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY}


def rest(method, path, body=None, prefer='return=representation'):
    h = svc(); h['Prefer'] = prefer
    return http(method, URL + '/rest/v1/' + path, body, h)


def upsert(table, rows, conflict='id'):
    r = rest('POST', table + '?on_conflict=' + conflict, rows, 'resolution=merge-duplicates,return=minimal')
    if isinstance(r, dict) and r.get('__error'):
        die('%s upsert failed: %s %s' % (table, r['__error'], r['body'][:300]))
    print('  %-24s %d row(s)' % (table, len(rows)))


def ok(r, what):
    if isinstance(r, dict) and (r.get('__error') or r.get('error')):
        die('%s failed: %s' % (what, json.dumps(r)[:400]))
    return r


def session_for(uid, email):
    """A TEST login session minted with the TEST service key (no text is sent, no code typed): the staging test path."""
    g = http('POST', URL + '/auth/v1/admin/generate_link', {'type': 'magiclink', 'email': email}, svc())
    th = (g.get('properties') or g).get('hashed_token') if isinstance(g, dict) else None
    if not th:
        die('could not make a sign-in link for ' + email + ': ' + json.dumps(g)[:200])
    s = http('POST', URL + '/auth/v1/verify', {'type': 'magiclink', 'token_hash': th}, {'apikey': AKEY, 'Authorization': 'Bearer ' + AKEY})
    if not (isinstance(s, dict) and s.get('access_token') and s.get('user', {}).get('id') == uid):
        die('unexpected sign-in for ' + email)
    if 'expires_at' not in s:
        s['expires_at'] = int(time.time()) + int(s.get('expires_in', 3600))
    return s


def as_host(tok, venue_id=None):
    # X-VP-Venue: the test host holds venues on several TEST accounts; the header picks this venue's account,
    # exactly as the account page does when a login has more than one.
    h = {'Authorization': 'Bearer ' + tok, 'Origin': SITE}
    if venue_id:
        h['X-VP-Venue'] = venue_id
    return h


# ------------------------------------------------------------------ pictures (made here, never a real venue's)
def font(size, bold=True):
    from PIL import ImageFont
    for p in (['/System/Library/Fonts/Supplemental/Futura.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
              if bold else ['/System/Library/Fonts/Supplemental/Georgia.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf']):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size, index=4 if p.endswith('Futura.ttc') else 0)
            except Exception:
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    pass
    return ImageFont.load_default()


def png(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True); return b.getvalue()


def make_art():
    """The logos and slides, written to tools/staging/real-venues/ (committed, so the test server needs no PIL)."""
    os.makedirs(ART, exist_ok=True)
    want = ['stage-mini-bar-logo-dark.png', 'stage-mini-bar-logo-box.png', 'stage-new-pub-logo-light.png',
            'hosted-by-sam.png'] + ['stage-mini-bar-slide-%d.png' % i for i in range(1, 5)]
    if all(os.path.exists(os.path.join(ART, w)) for w in want):
        return
    from PIL import Image, ImageDraw
    ink = (24, 24, 28, 255)
    # A: dark wordmark, transparent
    im = Image.new('RGBA', (900, 300), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse((20, 40, 240, 260), outline=ink, width=14)
    d.text((130, 150), 'SMB', font=font(70), fill=ink, anchor='mm')
    d.text((270, 110), 'STAGE MINI BAR', font=font(70), fill=ink, anchor='lm')
    d.text((274, 200), 'VARSITY LAKES  .  EST 2026', font=font(34, False), fill=ink, anchor='lm')
    open(os.path.join(ART, 'stage-mini-bar-logo-dark.png'), 'wb').write(png(im))
    bx = Image.new('RGBA', (980, 380), (255, 255, 255, 255)); bx.paste(im, (40, 40), im)
    open(os.path.join(ART, 'stage-mini-bar-logo-box.png'), 'wb').write(png(bx))
    # sign-up venue: a light (cream) wordmark, transparent
    cream = (246, 236, 205, 255)
    im = Image.new('RGBA', (900, 320), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((10, 10, 890, 310), radius=40, outline=cream, width=10)
    d.text((450, 130), 'THE NEW PUB', font=font(96), fill=cream, anchor='mm')
    d.text((450, 235), 'HOTEL  .  BEER GARDEN  .  VIC', font=font(36, False), fill=cream, anchor='mm')
    open(os.path.join(ART, 'stage-new-pub-logo-light.png'), 'wb').write(png(im))
    # Hosted by card logo
    im = Image.new('RGBA', (400, 400), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse((10, 10, 390, 390), fill=(255, 196, 0, 255))
    d.text((200, 170), 'QUIZ', font=font(90), fill=(20, 20, 20, 255), anchor='mm')
    d.text((200, 265), 'with Sam', font=font(48, False), fill=(20, 20, 20, 255), anchor='mm')
    open(os.path.join(ART, 'hosted-by-sam.png'), 'wb').write(png(im))
    # 4 slides, 1920x1080 (the venue's own ads)
    slides = [((120, 24, 40), 'HAPPY HOUR', '4 to 6 pm every weekday', '$6 pots  .  $8 house wines'),
              ((16, 70, 60), 'STEAK NIGHT', 'Every Wednesday', '300 g rump, chips and salad $22'),
              ((30, 40, 110), 'THURSDAY TRIVIA', '7 pm, free entry, teams up to 6', 'Bar tab for the winning team'),
              ((20, 20, 24), 'PLAY ON YOUR PHONE', 'Scan the code to join tonight', 'Trivia, musical bingo, bingo')]
    for i, (bg, t1, t2, t3) in enumerate(slides, 1):
        im = Image.new('RGB', (1920, 1080), bg); d = ImageDraw.Draw(im)
        for k in range(0, 1080, 6):
            d.line((0, k, 1920, k), fill=tuple(min(255, c + (k // 60)) for c in bg))
        x = 140 if i == 4 else 960
        anchor = 'lm' if i == 4 else 'mm'
        d.text((x, 430), t1, font=font(150), fill=(255, 255, 255), anchor=anchor)
        d.text((x, 590), t2, font=font(70, False), fill=(240, 240, 240), anchor=anchor)
        d.text((x, 700), t3, font=font(60, False), fill=(255, 210, 90), anchor=anchor)
        d.text((x if i == 4 else 960, 960), 'STAGE MINI BAR', font=font(44), fill=(255, 255, 255), anchor=anchor)
        b = io.BytesIO(); im.save(b, 'JPEG', quality=86)
        open(os.path.join(ART, 'stage-mini-bar-slide-%d.png' % i), 'wb').write(png(im) if False else b.getvalue())
    print('  made the pictures in', ART)


def data_url(path, kind=None):
    raw = open(path, 'rb').read()
    kind = kind or ('image/jpeg' if raw[:3] == b'\xff\xd8\xff' else 'image/png')
    return 'data:%s;base64,%s' % (kind, base64.b64encode(raw).decode())


# ------------------------------------------------------------------ the venues
MEMBERS_A = ['Ava Brown', 'Liam Wilson', 'Mia Taylor', 'Noah Smith', 'Isla Jones', 'Leo Martin', 'Ruby White',
             'Jack Thompson', 'Zoe Harris', 'Oscar Walker', 'Chloe King', 'Henry Wright', 'Grace Scott', 'Archie Green',
             'Ella Baker', 'Lucas Adams', 'Sienna Hill', 'Mason Clark', 'Lily Young', 'Hudson Lewis']
LASTFIRST_B = ['Nguyen,Tom', 'Smith,Jodie', "O'Brien,Kate", 'Papadopoulos,Nick', 'Williams,Shane', 'Tran,Linh', 'Kelly,Brendan',
               'Singh,Harpreet', 'Murphy,Sean', 'Rossi,Marco', 'Chen,Wei', 'MacDonald,Fiona', 'Johnson,Darren', 'Patel,Priya',
               'Brown,Kylie', 'Walsh,Michael', 'Lee,Daniel', 'Anderson,Belinda', 'Cooper,Ricky', 'Hughes,Tanya', 'Kaur,Simran',
               'Russo,Gina', 'Edwards,Paul', 'Ryan,Siobhan', 'Taylor,Craig', 'Fernandez,Ana', 'Wood,Garry', 'Kim,Soo-jin',
               'Morgan,Leanne', 'Van der Berg,Pieter']


def base_rows(v, logo_note=''):
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    upsert('venueplay_founding', [{'id': v['founding'], 'venue_name': v['name'], 'contact_name': 'venueplay testing',
                                   'contact_email': 'test-host@example.invalid', 'mobile': '0491570001', 'postcode': v['postcode'],
                                   'max_seats': 1, 'status': 'comp', 'marketing_opt_in': False, 'is_group': False}])
    upsert('vp_venues', [{'id': v['id'], 'founding_id': v['founding'], 'slug': v['slug'], 'name': v['name'], 'state': v['state'],
                          'au_state': v['state'], 'postcode': v['postcode'], 'suburb': v['suburb'], 'status': 'active',
                          'timezone': v['tz'], 'included_players': 40, 'hide_from_trusted': True, 'entity_type': 'for_profit',
                          'terms_required': False, 'privacy_terms_accepted_at': now}])
    upsert('vp_venue_settings', [{'venue_id': v['id']}], 'venue_id')
    upsert('vp_venue_staff', [{'id': v['staff'], 'venue_id': v['id'], 'auth_user_id': HOST_UID, 'role': 'owner',
                               'display_name': 'Test Host', 'is_account_owner': True}])


def prefs(v, game, p):
    r = rest('POST', 'rpc/vp_set_game_prefs', {'p_venue_id': v['id'], 'p_game': game, 'p_prefs': p})
    ok(r, 'game prefs ' + game)


def settings(v, row):
    r = rest('PATCH', 'vp_venue_settings?venue_id=eq.' + v['id'], row)
    ok(r, 'settings')


def members(v, names, lastfirst):
    upsert('vp_member_rosters', [{'id': v['roster'], 'venue_id': v['id'], 'name': 'Members list'}])
    rows = []
    tag = '0a' if v is A else '0b'   # a fixed id per member, distinct per venue
    for i, n in enumerate(names):
        mid = '5eed00b9-0000-4000-8000-%s%010d' % (tag, i + 1)
        if lastfirst:
            rows.append({'id': mid, 'roster_id': v['roster'], 'member_number': 1001 + i, 'first_name': n, 'last_name': None, 'status': 'valid'})
        else:
            f, l = n.split(' ', 1)
            rows.append({'id': mid, 'roster_id': v['roster'], 'member_number': 101 + i, 'first_name': f, 'last_name': l, 'status': 'valid'})
    rest('DELETE', 'vp_members?roster_id=eq.' + v['roster'], None, 'return=minimal')   # our own fixed list, rewritten whole
    upsert('vp_members', rows)


def member_draw(v, name, start, inc, day, t):
    today = datetime.date.today().isoformat()
    upsert('vp_member_draws', [{'id': v['draw'], 'venue_id': v['id'], 'roster_id': v['roster'], 'name': name,
                                'starting_amount_cents': start, 'increment_cents': inc, 'current_jackpot_cents': start,
                                'draw_day': day, 'draw_time': t, 'date_started': today, 'archived_at': None, 'reserve_cents': 0}])


def screen(v, tok, slides=None, raffles=None):
    body = {'venue_id': v['id']}
    if slides is not None:
        body['slides'] = slides
    if raffles is not None:
        body['raffles'] = raffles
    ok(http('POST', API + '/account/screen-save', body, as_host(tok, v['id'])), 'screen-save ' + v['slug'])


def whats_on(v, tok, events):
    cur = ok(http('POST', API + '/account/screen-get', {'venue_id': v['id']}, as_host(tok, v['id'])), 'screen-get')
    for e in (cur.get('events') or []):
        ok(http('POST', API + '/account/whats-on-remove', {'venue_id': v['id'], 'id': e['id']}, as_host(tok, v['id'])), 'whats-on-remove')
    for ev in events:
        ok(http('POST', API + '/account/whats-on-save', {'venue_id': v['id'], 'event': ev}, as_host(tok, v['id'])), 'whats-on-save ' + json.dumps(ev))
    print('  whats on                 %d event(s)' % len(events))


def logo(v, tok, path):
    r = ok(http('POST', API + '/account/logo-upload', {'venue_id': v['id'], 'data': data_url(path, 'image/png')}, as_host(tok, v['id'])), 'logo-upload')
    print('  logo                     %s (%sx%s, transparent %s)' % (os.path.basename(path), r.get('width'), r.get('height'), r.get('transparent')))
    return r.get('url')


def no_logo(v, tok):
    ok(http('POST', API + '/account/logo-remove', {'venue_id': v['id']}, as_host(tok, v['id'])), 'logo-remove')


def permit(v, tok, kind, p):
    ok(http('POST', API + '/account/permits', {'venue_id': v['id'], 'kind': kind, 'permit': p}, as_host(tok, v['id'])), 'permits ' + kind)


def compliance(v, tok):
    r = http('POST', API + '/account/compliance-accept', {'venue_id': v['id'], 'accepted': True, 'by': 'Test Host (staging seed)'}, as_host(tok, v['id']))
    if isinstance(r, dict) and (r.get('__error') or r.get('error')):
        # the route's own words decide; fall back to the column the console reads, TEST only
        rest('PATCH', 'vp_venues?id=eq.' + v['id'] + '&compliance_accepted_at=is.null',
             {'compliance_accepted_at': datetime.datetime.utcnow().isoformat() + 'Z', 'compliance_accepted_by': HOST_UID})
        print('  compliance               accepted (column; route said %s)' % json.dumps(r)[:160])
    else:
        print('  compliance               accepted')


def seed_a(tok, logo_kind):
    v = A
    print('\n== A', v['name'], v['id'])
    base_rows(v)
    compliance(v, tok)
    logo(v, tok, os.path.join(ART, 'stage-mini-bar-logo-%s.png' % ('box' if logo_kind == 'box' else 'dark')))
    urls = []
    for i in range(1, 5):
        r = ok(http('POST', API + '/account/screen-upload', {'venue_id': v['id'], 'data': data_url(os.path.join(ART, 'stage-mini-bar-slide-%d.png' % i), 'image/jpeg')}, as_host(tok, v['id'])), 'slide upload')
        urls.append(r['url'])
    slides = [{'image_url': u, 'seconds': 8} for u in urls]
    slides[3]['qr'] = True   # "scan to join": the TV puts the venue's join QR on it
    screen(v, tok, slides=slides, raffles=[{'id': 'r-stage-meat', 'label': 'Friday meat tray raffle', 'day': 'Friday', 'time': '6:30 pm'},
                                           {'id': 'r-stage-sun', 'label': 'Sunday arvo raffle', 'day': 'Sunday', 'time': '3 pm'}])
    print('  slides                   4 (slide 4 = scan to join)')
    whats_on(v, tok, [{'link': 'night', 'day': 'thu', 'game': 'trivia'},
                      {'link': 'night', 'day': 'fri', 'game': 'musical'},
                      {'title': 'Steak night', 'day': 'wed', 'start': '17:30', 'line': '300 g rump $22'}])
    settings(v, {'name_display': 'abbrev_last', 'collect_first_name': True, 'collect_mobile': True, 'auto_game_promos': True,
                 'screen_rotation_seconds': 8, 'trivia_time_limit_s': 20})
    prefs(v, 'trivia', {'set_id': '5eed00aa-0000-4000-8000-000000000001', 'count': 3, 'time_s': 20, 'base_points': 100,
                        'speed_bonus': True, 'buzzer': True, 'buzzer_where': 'tv', 'sounds': True, 'prize_list': ['$50 bar tab', 'Jug of beer']})
    prefs(v, 'musical', {'sounds': True, 'pattern': 'one', 'prize': 'Bar tab', 'reveal': 'instant'})
    prefs(v, 'bingo', {'sounds': True, 'caller': False, 'pattern': 'one', 'prize': 'Meat tray', 'prizes': {'one': 'Meat tray', 'full': '$100 voucher'},
                       'cards': 1, 'allow_early': False, 'ticket_kind': 'phone'})
    prefs(v, 'raffle', {'prizes': ['Meat Tray', '$100 Bar Tab', 'Seafood Platter', 'Bottle of Whisky'], 'draw_style': 'race', 'draw_time': 'normal',
                        'range_min': 1, 'range_max': 150, 'tickets_from': 'bar', 'announce_prize': True, 'pick_order': False, 'allow_redraw': True})
    members(v, MEMBERS_A, False)
    member_draw(v, 'Thursday members draw', 50000, 5000, 'Thursday', '8 pm')
    prefs(v, 'members', {'draw_id': v['draw'], 'draw_style': 'flip', 'draw_time': 'normal'})
    print('  members                  20 on the list, draw $500 + $50 a week, look flip')
    # the second login hosts here, with a Hosted by card (logo + name) for trivia and musical bingo
    upsert('vp_venue_staff', [{'id': HOST2_STAFF, 'venue_id': v['id'], 'auth_user_id': HOST2_UID, 'role': 'host',
                               'display_name': 'Sam (test host)', 'is_account_owner': False}])
    r = http('POST', API + '/account/hosted-by-save', {'venue_id': v['id'], 'auth_user_id': HOST2_UID, 'name': 'Quiz with Sam',
                                                     'trivia': True, 'musical': True, 'logo_data': data_url(os.path.join(ART, 'hosted-by-sam.png'), 'image/png')}, as_host(tok, v['id']))
    ok(r, 'hosted-by-save')
    print('  hosted by                Quiz with Sam (logo) on trivia + musical, login 0491 570 002')


def seed_b(tok):
    v = B
    print('\n== B', v['name'], v['id'])
    base_rows(v)
    compliance(v, tok)
    no_logo(v, tok)
    rest('PATCH', 'vp_venues?id=eq.' + v['id'], {'paid_entry_enabled': False, 'number_bingo_on': False, 'purchase_raffle_on': True})
    permit(v, tok, 'raffle', {'holder': 'npo', 'npo_name': 'North Shore Surf Rescue (test charity)', 'authorised_on': '2026-11-01', 'note': 'TEST only'})
    permit(v, tok, 'members', {'holder': 'venue', 'number': 'TP-TEST-2026-0001', 'authorised_on': '2026-10-15', 'expires': '2027-10-14', 'note': 'TEST only'})
    print('  permits                  raffle (charity authority), members draw (trade promotion number)')
    screen(v, tok, slides=[], raffles=[{'id': 'r-harbour-sat', 'label': 'Saturday charity raffle', 'day': 'Saturday', 'time': '5 pm'}])
    whats_on(v, tok, [{'link': 'night', 'day': 'tue', 'game': 'trivia'}, {'link': 'night', 'day': 'sat', 'game': 'raffles'}])
    settings(v, {'name_display': 'abbrev_last', 'collect_first_name': True, 'collect_mobile': True, 'collect_marketing_optin': True,
                 'auto_game_promos': True, 'trivia_time_limit_s': 20})
    prefs(v, 'trivia', {'set_id': '5eed00aa-0000-4000-8000-000000000001', 'count': 3, 'time_s': 20, 'buzzer': True, 'buzzer_where': 'tv',
                        'sounds': False, 'double_points': True, 'double_last': 1, 'speed_bonus': True})
    prefs(v, 'musical', {'sounds': False, 'pattern': 'any', 'prize': 'Schooner each'})
    prefs(v, 'bingo', {'sounds': False, 'caller': False, 'pattern': 'one', 'prize': 'Free entry: chocolate box', 'cards': 1, 'ticket_kind': 'phone'})
    prefs(v, 'raffle', {'prizes': ['Meat Tray', 'Seafood Box'], 'draw_style': 'ticket', 'draw_time': 'normal', 'draw_countdown': True,
                        'range_min': 1, 'range_max': 300})
    members(v, LASTFIRST_B, True)
    member_draw(v, 'Members badge draw', 30000, 10000, 'Friday', '7 pm')
    prefs(v, 'members', {'draw_id': v['draw'], 'draw_style': 'race', 'draw_time': 'short', 'draw_winner_big': True, 'draw_countdown': True})
    print('  members                  30 written Last,First; draw $300 + $100; draw moments ON, winner takes the screen ON')
    start = datetime.datetime.utcnow().replace(microsecond=0) + datetime.timedelta(days=2)
    upsert('vp_purchase_raffles', [{'id': v['praffle'], 'venue_id': v['id'], 'name': 'Christmas hamper raffle (TEST)',
                                    'promoter': 'Stage Harbour Hotel', 'description': 'Spend $20 at the bar for a ticket. TEST only.',
                                    'prizes': [{'label': 'Christmas hamper', 'value_cents': 50000}, {'label': '$100 bar tab', 'value_cents': 10000}],
                                    'starts_at': start.isoformat() + 'Z', 'closes_at': (start + datetime.timedelta(days=30)).isoformat() + 'Z',
                                    'draw_at': (start + datetime.timedelta(days=30, hours=2)).isoformat() + 'Z', 'draw_place': 'Main bar',
                                    'daily_cap': 5, 'terms_text': 'TEST purchase raffle on the staging database. Not a real promotion.',
                                    'status': 'open', 'created_by': 'seed-real-venues'}])
    print('  purchase raffle          set up, starts', start.date().isoformat(), '(not started)')


def check():
    for v in VENUES:
        row = (rest('GET', 'vp_venues?id=eq.%s&select=id,name,slug,au_state,join_code,permits,compliance_accepted_at,purchase_raffle_on' % v['id']) or [{}])
        scr = (rest('GET', 'vp_venue_screen?venue_id=eq.%s&select=logo_url,slides,events,raffles' % v['id']) or [{}])
        st = (rest('GET', 'vp_venue_settings?venue_id=eq.%s&select=game_prefs' % v['id']) or [{}])
        mem = rest('GET', 'vp_members?roster_id=eq.%s&select=id' % v['roster']) or []
        r, s = (row[0] if row else {}), (scr[0] if scr else {})
        gp = (st[0] if st else {}).get('game_prefs') or {}
        print('%s  %s  slug %s  code %s  logo %s  slides %d  events %d  raffles %d  members %d  compliance %s  permits %s  sounds %s' % (
            v['id'], r.get('name'), r.get('slug'), r.get('join_code'), 'yes' if s.get('logo_url') else 'NO', len(s.get('slides') or []),
            len(s.get('events') or []), len(s.get('raffles') or []), len(mem), 'yes' if r.get('compliance_accepted_at') else 'no',
            ','.join(sorted((r.get('permits') or {}).keys())) or '-', {g: (gp.get(g) or {}).get('sounds') for g in ('trivia', 'musical', 'bingo')}))


def main():
    global URL, SKEY, AKEY
    URL, SKEY, AKEY = load_env()
    args = sys.argv[1:]
    print('TEST project', TEST_REF, '| staging Workers only')
    if '--dry-run' in args:
        print('guards ok; nothing written'); return
    if '--check' in args:
        check(); return
    logo_kind = 'box' if ('--logo' in args and args[args.index('--logo') + 1:][:1] == ['box']) else 'dark'
    make_art()
    tok = session_for(HOST_UID, 'test-host@example.invalid')['access_token']
    seed_a(tok, logo_kind)
    seed_b(tok)
    print('\n== read back'); check()
    print('SEED DONE')


if __name__ == '__main__':
    main()
