#!/usr/bin/env python3
"""Walk a venue's whole night the way a venue would, against the LIVE system, daily.

WHY THIS EXISTS. On 8 Sep 2026 an owner pressed "Change code", the console showed
them their new code, and the door still answered to the old one. The release gate
was green and every unit test passed, because every test and the backfill agreed
that a venue's code equals the hash of its slug - which was true until somebody
changed one. Nothing that reads code can catch that. Only something that asks the
running system "the code you are SHOWING this venue: does it actually let anyone
in?" can, and that is one question, asked live, read-only, in under a second.

WHAT IT WILL NOT DO. It never writes. It opens no sessions, joins no games, bills
nothing. Every request below is one a TV on a wall or a phone on the join screen
makes anyway (the one POST, /join/info, only reads), so running it every morning
costs a venue nothing and cannot take a night down.

THE SECOND 8 SEP FAULT. The TV, the console and every table talker do not use the
issued code at all: they use a HASH of the slug, computed on the page with no round
trip. The two were equal for every venue until Change code shipped. So this also
asks the door about the code the TV actually sends, and asks /join/info for the
channel a phone will be moved to, and requires it to be that same hash. The first
version of this audit could not see either, because it only ever asked about the
code the console displays.

  python3 daily-venue-audit.py                       the venues in VENUES below
  python3 daily-venue-audit.py --slug the-average-joe --slug some-other-pub
  python3 daily-venue-audit.py --prove               break each check, expect red
"""
import argparse, json, sys, time, urllib.request, urllib.error

GAME = 'https://venueplay-game.dean-tindale.workers.dev'
SITE = 'https://venueplay.com.au'
# NO HAND-MAINTAINED LIST. This said ['the-average-joe'] while SEVENTEEN venues were
# active, so the daily audit cleared the fleet every morning having looked at one pub.
# check-stale-sessions.py carried the identical fault and its docstring already spells
# out what it cost: it reported the-average-joe clean while that venue held a session
# open since 26 August with 4 billable players on it.
#
# Ask the database which venues are active. Falls back to the one name only when there
# are no credentials on this machine, and SAYS SO, because a fallback that looks like a
# full run is the fault all over again.
FALLBACK = ['the-average-joe']


def active_slugs():
    """Every active venue, from the live database. (slugs, how_we_got_them)"""
    try:
        import os
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                        'venueplay-backend', 'tools'))
        from vp_live import live
        L = live()
        if not L.rest_url or not L.service_key:
            return FALLBACK, 'NO CREDENTIALS on this machine, so this is ONE venue, not the fleet'
        req = urllib.request.Request(
            L.rest_url.rstrip('/') + '/rest/v1/vp_venues?status=eq.active&select=slug&order=slug',
            headers={'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key})
        rows = json.load(urllib.request.urlopen(req, timeout=25))
        slugs = [r['slug'] for r in rows if r.get('slug')]
        if not slugs:
            return FALLBACK, 'the database returned NO active venues, which is itself wrong'
        return slugs, '%d active venue(s), from the %s database' % (len(slugs), L.where)
    except Exception as e:
        return FALLBACK, 'could not ask the database (%s), so this is ONE venue, not the fleet' % (
            str(e)[:60])

BAD = []
def fail(what, detail):
    BAD.append((what, detail)); print('  FAIL  %-52s %s' % (what, detail))
def ok(what, note=''):
    print('  ok    %-52s %s' % (what, note))

def get(url, timeout=15):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'venueplay-daily-audit'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace'), (time.time() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), (time.time() - t0) * 1000
    except Exception as e:
        return 0, str(e), (time.time() - t0) * 1000

def jget(url):
    s, body, ms = get(url)
    try: return s, json.loads(body), ms
    except Exception: return s, None, ms

def jpost(url, obj, timeout=15):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(obj).encode('utf-8'), method='POST',
                                     headers={'User-Agent': 'venueplay-daily-audit', 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode('utf-8', 'replace'); st = r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace'); st = e.code
    except Exception as e:
        return 0, None, (time.time() - t0) * 1000
    try: return st, json.loads(body), (time.time() - t0) * 1000
    except Exception: return st, None, (time.time() - t0) * 1000

ALPHABET = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'
def fnv_venue_code(slug):
    """The code tv.html, play.html, vp-session.js and the Worker all derive from a slug.
    Same arithmetic, 32-bit, so the audit asks the door about the code the TV really sends.
    Checked against the live venue: the-average-joe -> 3A7TES."""
    s = ''.join(c for c in str(slug or '').lower() if c.isalnum() and c.isascii())
    h = 2166136261
    for ch in s:
        h ^= ord(ch); h = (h * 16777619) & 0xFFFFFFFF
    x = h or 1; out = ''
    for _ in range(6):
        x = (x * 1103515245 + 12345) & 0xFFFFFFFF; out += ALPHABET[x % len(ALPHABET)]
    return out


def audit_platform():
    print('\nTHE PLATFORM ITSELF')
    s, h, ms = jget(GAME + '/health')
    if s != 200 or not h:
        return fail('the game Worker answers at all', 'HTTP %s - every venue is down' % s)
    ok('the game Worker is up', '%s, %.0fms' % (h.get('build', '?'), ms))
    if not h.get('ok'): fail('the Worker reports itself healthy', 'ok=false, missing=%s' % h.get('missing'))
    else: ok('it has every binding it needs')

    n = h.get('venue_code_clashes')
    if n is None:
        fail('clashing venue codes are being counted', 'health does not report it any more')
    elif n:
        fail('no two venues share a code', '%d clash(es) - BOTH venues are refused, '
             'and any table talker printed with that code is dead' % n)
    else:
        ok('no two venues share a code')

    b = h.get('broadcast_signing') or {}
    if b.get('venues') and b.get('with_a_key') is not None:
        ok('broadcast signing keys', '%s of %s venues hold one, %s enforcing'
           % (b['with_a_key'], b['venues'], b.get('enforcing')))
    else:
        # 8 Sep: these became HEAD count=exact requests instead of two full scans.
        # If the count header is not what the Worker expects this is where it shows.
        fail('broadcast signing can be counted', 'health says %s - the signing figures are unreadable, '
             'so nobody can tell how many rooms are actually protected' % (b or 'nothing'))
    return h


def audit_venue(slug):
    print('\n%s' % slug.upper())

    # 1. The screen a TV on the wall asks for.
    s, scr, ms = jget(GAME + '/screen?probe=1&venue=' + slug)
    if s != 200 or not scr:
        return fail('the TV can load this venue', 'HTTP %s' % s)
    if not scr.get('exists'):
        return fail('the TV finds this venue', 'exists=false - the screen shows "not linked to an account"')
    ok('the TV loads the venue', '%s, %.0fms' % (scr.get('name') or '?', ms))

    # 2. The code the venue is SHOWN.
    code = (scr.get('join_code') or '').strip()
    if not code:
        return fail('the venue has a code to show', 'join_code is empty - nobody can join by code')
    if not all(c in 'ACDEFGHJKMNPQRSTUVWXYZ2345679' for c in code) or len(code) != 6:
        return fail('the code can actually be typed', '"%s" contains a character that is not in the '
                    'alphabet, or is the wrong length' % code)
    ok('the venue is shown a code', code)

    # 3. THE ONE THAT MATTERS. Does that code open that venue's door?
    s, v, ms = jget(GAME + '/venue?probe=1&code=' + code)
    if s != 200 or not v or not v.get('exists'):
        return fail('the code the venue is SHOWN lets people in',
                    '%s is displayed on their console and refused at the door (HTTP %s). '
                    'This is exactly the 8 Sep fault.' % (code, s))
    if (v.get('slug') or '') != slug:
        return fail('the code opens the RIGHT venue',
                    '%s is shown to %s but opens %s - players and opt-ins land at the wrong pub'
                    % (code, slug, v.get('slug')))
    ok('that code opens this venue and no other', '%.0fms' % ms)

    # 4. Same code, second ask. The 8 Sep fault looked intermittent because each
    #    Cloudflare isolate cached separately: one go failed, the next worked.
    misses = 0
    for _ in range(6):
        s2, v2, _ = jget(GAME + '/venue?probe=1&code=' + code)
        if s2 != 200 or not v2 or not v2.get('exists') or v2.get('slug') != slug:
            misses += 1
    if misses:
        fail('the code works EVERY time, not most times',
             '%d of 6 tries failed - a venue would call this "it worked the second time"' % misses)
    else:
        ok('it works on every try, not just the first', '6 of 6')

    # 5. THE CODE THE TV ACTUALLY SENDS. Not the one on the console: tv.html hashes its
    #    slug and polls /venue with that, and it is the channel every phone must be on.
    #    Once an owner presses Change code the two differ, and only this asks about it.
    hashed = fnv_venue_code(slug)
    note = 'same as the shown code' if hashed == code else 'this venue has changed its code: %s on the wall, %s behind it' % (code, hashed)
    s, tvv, ms = jget(GAME + '/venue?probe=1&code=' + hashed)          # a TV that has not reloaded since the fix
    if s != 200 or not tvv or not tvv.get('exists') or (tvv.get('slug') or '') != slug:
        fail('the code the TV polls with still opens this venue',
             '%s (a hash of the slug) got exists=%s slug=%s - in 60 seconds the TV shows "not linked to an '
             'account" and forgets its venue' % (hashed, (tvv or {}).get('exists'), (tvv or {}).get('slug')))
    else:
        ok('the code the TV polls with still opens this venue', '%s, %s' % (hashed, note))
    s, tvv2, ms = jget(GAME + '/venue?probe=1&code=%s&venue=%s&v=daily-audit' % (hashed, slug))   # what a reloaded TV sends
    if s != 200 or not tvv2 or not tvv2.get('exists') or (tvv2.get('slug') or '') != slug:
        fail('the TV poll with the slug on it opens this venue', 'exists=%s' % (tvv2 or {}).get('exists'))
    else:
        ok('the TV poll with the slug on it opens this venue', '%.0fms' % ms)

    # 6. WHERE A PHONE THAT TYPES THE CODE ENDS UP. /join/info tells play.html the venue's
    #    channel; it must be the hash the TV is on, or the phone waits for a host all night.
    s, ji, ms = jpost(GAME + '/join/info', {'code': code})
    if s != 200 or not ji:
        fail('the join screen can ask about the shown code', 'HTTP %s' % s)
    elif not ji.get('channel'):
        fail('a phone typing the shown code is sent to the channel the TV is on',
             '/join/info sends no channel at all: the Worker running is from before 8 Sep and cannot move a '
             'phone. Harmless while the shown code equals %s; the day this venue presses Change code, every '
             'phone that types the new code joins an empty room' % hashed)
    elif ji.get('channel') != hashed:
        fail('a phone typing the shown code is sent to the channel the TV is on',
             '/join/info says channel=%r, the TV is on %s - the phone joins an empty room' % (ji.get('channel'), hashed))
    else:
        ok('a phone typing the shown code is sent to the channel the TV is on', '%s, %.0fms' % (hashed, ms))

    # 7. The pages a venue actually opens.
    for path, needle, what in (('/tv?slug=' + slug, 'CODE_ALPHABET', 'the TV page'),
                               ('/app/', 'venueplay', 'the console')):
        s, body, ms = get(SITE + path)
        if s != 200: fail('%s loads' % what, 'HTTP %s' % s)
        elif needle not in body:
            fail('%s is the real page' % what,
                 'served 200 but without %s - a missing page answers with the homepage' % needle)
        else: ok('%s loads' % what, '%.0fms' % ms)


def prove():
    """A check that cannot go red is decoration. Break each one and require ITS line to go red.

    The first version of this only cut the network, which proves the audit notices an
    outage and nothing else: nine checks, two ways to fail, seven never shown to work.
    This stands up a fake Worker and a fake site on localhost, scripts one wrong answer
    at a time, and requires the check that owns that answer to be the one that fails.
    The fake venue has ALREADY pressed Change code (shown KQ7M2N, channel behind it the
    hash), because that is the case the two newest checks exist for and the live venue
    cannot show it."""
    import http.server, threading, urllib.parse
    global GAME, SITE
    slug = 'the-royal-hotel-4217'
    HASH = fnv_venue_code(slug)
    SHOWN = 'KQ7M2N'
    assert SHOWN != HASH
    state = {'mut': None, 'n': 0}

    class Fake(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def send(self, body, status=200, ctype='application/json'):
            if not isinstance(body, str): body = json.dumps(body)
            b = body.encode('utf-8')
            self.send_response(status); self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            m = state['mut']; u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
            if u.path == '/health':
                h = {'worker': 'venueplay-game', 'build': 'fake', 'ok': True, 'missing': [],
                     'broadcast_signing': {'venues': 1, 'with_a_key': 1, 'enforcing': 0}, 'venue_code_clashes': 0}
                if m == 'bindings': h['ok'] = False; h['missing'] = ['SUPABASE_URL']
                if m == 'clash-count-gone': del h['venue_code_clashes']
                if m == 'clash': h['venue_code_clashes'] = 1
                if m == 'signing-unreadable': h['broadcast_signing'] = {'error': 'could not be read'}
                return self.send(h)
            if u.path == '/screen':
                if m == 'screen-missing': return self.send({'exists': False})
                code = '' if m == 'no-code' else ('AB0O1I' if m == 'untypable' else SHOWN)
                return self.send({'exists': True, 'name': 'The Royal Hotel', 'join_code': code})
            if u.path == '/venue':
                code = (q.get('code') or [''])[0]; by_slug = 'venue' in q
                state['n'] += 1
                if code == SHOWN and not by_slug:
                    if m == 'door-refuses': return self.send({'exists': False})
                    if m == 'wrong-venue': return self.send({'exists': True, 'slug': 'the-royal-hotel-2000', 'name': 'x'})
                    if m == 'flaky' and state['n'] % 3 == 0: return self.send({'exists': False})
                if code == HASH and not by_slug and m == 'tv-hash-refused': return self.send({'exists': False})
                if by_slug and m == 'slug-poll-refused': return self.send({'exists': False})
                if code in (SHOWN, HASH) or by_slug:
                    return self.send({'exists': True, 'slug': slug, 'name': 'The Royal Hotel', 'suspended': False})
                return self.send({'exists': False})
            if u.path == '/tv':
                return self.send('<html>homepage</html>' if m == 'tv-is-homepage' else '<html>CODE_ALPHABET</html>', ctype='text/html')
            if u.path == '/app/':
                return self.send('<html>homepage</html>' if m == 'console-is-homepage' else '<html>venueplay</html>', ctype='text/html')
            return self.send({'error': 'not found'}, 404)
        def do_POST(self):
            m = state['mut']; u = urllib.parse.urlparse(self.path)
            try: self.rfile.read(int(self.headers.get('Content-Length') or 0))
            except Exception: pass
            if u.path == '/join/info':
                if m == 'no-channel': return self.send({'format': '', 'collect': {}})
                if m == 'wrong-channel': return self.send({'format': '', 'channel': 'ZZZZZZ', 'collect': {}})
                return self.send({'format': '', 'channel': HASH, 'collect': {}})
            return self.send({'error': 'not found'}, 404)

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    fake = 'http://127.0.0.1:%d' % srv.server_address[1]
    good_game, good_site = GAME, SITE

    # (mutation, the check that must be the one to go red)
    cases = [
        ('worker-down',         'the game Worker answers at all'),
        ('bindings',            'the Worker reports itself healthy'),
        ('clash-count-gone',    'clashing venue codes are being counted'),
        ('clash',               'no two venues share a code'),
        ('signing-unreadable',  'broadcast signing can be counted'),
        ('screen-missing',      'the TV finds this venue'),
        ('no-code',             'the venue has a code to show'),
        ('untypable',           'the code can actually be typed'),
        ('door-refuses',        'the code the venue is SHOWN lets people in'),
        ('wrong-venue',         'the code opens the RIGHT venue'),
        ('flaky',               'the code works EVERY time, not most times'),
        ('tv-hash-refused',     'the code the TV polls with still opens this venue'),
        ('slug-poll-refused',   'the TV poll with the slug on it opens this venue'),
        ('no-channel',          'a phone typing the shown code is sent to the channel the TV is on'),
        ('wrong-channel',       'a phone typing the shown code is sent to the channel the TV is on'),
        ('tv-is-homepage',      'the TV page is the real page'),
        ('console-is-homepage', 'the console is the real page'),
        ('site-down',           'the TV page loads'),
    ]
    print('PROVING THE CHECKS (each is deliberately broken; the check that owns it must go red)\n')
    import io as _io, contextlib
    passed = 0
    for mut, owner in cases:
        state['mut'] = None if mut in ('worker-down', 'site-down') else mut
        state['n'] = 0
        GAME = 'http://127.0.0.1:9' if mut == 'worker-down' else fake
        SITE = 'http://127.0.0.1:9' if mut == 'site-down' else fake
        del BAD[:]
        with contextlib.redirect_stdout(_io.StringIO()):
            try: audit_platform(); audit_venue(slug)
            except Exception as e: BAD.append(('the audit itself crashed', str(e)))
        red = [w for w, _ in BAD]
        hit = owner in red
        print('  %-22s %-66s %s' % (mut, owner, 'went red, good' if hit else 'STAYED GREEN - BLIND CHECK  (red: %s)' % (red or 'nothing')))
        passed += 1 if hit else 0
    state['mut'] = None; GAME, SITE = good_game, good_site
    del BAD[:]
    with contextlib.redirect_stdout(_io.StringIO()):
        GAME = SITE = fake
        audit_platform(); audit_venue(slug)
    clean = not BAD
    print('  %-22s %-66s %s' % ('nothing broken', 'the whole audit is green on a correct venue', 'green, good' if clean else 'RED ON A GOOD VENUE: %s' % BAD))
    GAME, SITE = good_game, good_site
    srv.shutdown()
    print('\n  %d of %d checks proven%s' % (passed, len(cases), '' if clean else ', and the audit is wrong on a good venue'))
    return 0 if passed == len(cases) and clean else 1


def probe_is_honoured():
    """DOES THE LIVE WORKER ACTUALLY HONOUR probe=1 YET?

    The guard shipped on 11 Sep 2026, but Workers here are deployed by hand, so the
    repo having the fix and the fleet having it are different questions. Until it is
    pasted, every run of this audit writes screen_seen_at for all seventeen venues and
    HQ's SCREEN OK badge reports the health of this tool instead of the venue's TV.

    So do not take the paste on trust: poll a TEST venue with probe=1 and see whether
    its heartbeat moved. Answers (True|False|None, explanation).
    """
    try:
        import os, re, datetime
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                        'venueplay-backend', 'tools'))
        from vp_live import live
        L = live()
        if not L.rest_url or not L.service_key:
            return None, 'no credentials, so it could not be checked'
        h = {'apikey': L.service_key, 'Authorization': 'Bearer ' + L.service_key}

        def seen():
            q = L.rest_url.rstrip('/') + '/rest/v1/vp_venues?slug=eq.test-charlie&select=screen_seen_at'
            r = json.load(urllib.request.urlopen(urllib.request.Request(q, headers=h), timeout=20))
            return (r[0]['screen_seen_at'] if r else None)

        before = seen()
        if before is None:
            return None, 'no test-charlie venue to probe with'
        get(GAME + '/venue?probe=1&code=%s&venue=test-charlie&v=probe-check' % fnv_venue_code('test-charlie'))
        time.sleep(2)
        after = seen()
        if after == before:
            return True, 'the live Worker honours probe=1, so this run leaves no footprint'
        return False, ('the live Worker does NOT honour probe=1 yet, so this run has just marked '
                       'every screen alive. Paste venueplay-game.js. Until then HQ\'s SCREEN OK '
                       'badge is this tool, not the venue\'s TV.')
    except Exception as e:
        return None, 'could not be checked (%s)' % str(e)[:60]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--slug', action='append')
    ap.add_argument('--prove', action='store_true')
    a = ap.parse_args()
    if a.prove: return prove()
    print('VenuePlay daily venue audit - read-only, %s' % time.strftime('%Y-%m-%d %H:%M'))
    if a.slug:
        slugs, how = a.slug, 'named on the command line'
    else:
        slugs, how = active_slugs()
    print('  %s' % how)
    honoured, why = probe_is_honoured()
    print('  %s %s' % ({True: 'read-only:', False: 'WRITES:', None: 'probe:'}[honoured], why))
    audit_platform()
    for slug in slugs:
        audit_venue(slug)
    print()
    if BAD:
        print('%d PROBLEM(S) A VENUE WOULD HIT:' % len(BAD))
        for w, d in BAD: print('  - %s: %s' % (w, d))
        return 1
    print('No problem a venue would hit, across %d venue(s).' % len(slugs))
    return 0

if __name__ == '__main__':
    sys.exit(main())
