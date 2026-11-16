#!/usr/bin/env python3
"""THE STAGING SITE BUILD AND THE STAGING SETTINGS, OFFLINE (INBOX 357B / 326, 13 Nov 2026). No network, no database, no git write.

  1. make-staging-site.py builds the REAL venueplay/ into a temp folder: no live address is left anywhere (database,
     api, game Worker, public key, ws:// too), every page carries the vp-env tag first in <head>, the source tree is
     untouched, only addresses and the tag differ, _headers says noindex; the staging answers come from vp-env.js.
  2. It REFUSES: the public key still the placeholder, a staging address that is a live one, staging equal to live,
     the live public key as the staging key, a missing block.
  3. staging-config.json agrees with vp-env.js (hostnames), with the outbox guard (fiction range, example.invalid),
     with the seed (fiction numbers only), with deploy-worker.py (staging slots are not LIVE and match the slot rule);
     holds no secret value; names the TEST_ key names; refuses to set the SMS hook / autopilot / push keys on staging.

Run: python3 tools/staging/staging-site.test.py      Ends on "ALL N CHECKS PASSED".
"""
import importlib.util, json, os, re, shutil, socket, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location('mss', os.path.join(HERE, 'make-staging-site.py'))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
RAN, BAD = [0], [0]


def show(name, cond, saw=None):
    RAN[0] += 1
    if cond:
        print('  ok   ' + name)
    else:
        BAD[0] += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: %s' % (str(saw)[:200],)))


def no_network(*a, **k):
    raise AssertionError('the test tried the network')
socket.socket.connect = no_network
socket.create_connection = no_network


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


SRC = os.path.join(ROOT, 'venueplay')
ENV_JS = os.path.join(SRC, 'app', 'vp-env.js')
live, stg = M.load_env(ENV_JS)
tmp = tempfile.mkdtemp(prefix='staging-site-')
try:
    out = os.path.join(tmp, 'site')
    before = {}
    for dp, dn, fn in os.walk(SRC):
        for f in fn:
            p = os.path.join(dp, f)
            before[p] = os.path.getsize(p)
    r = M.build(SRC, out, allow_placeholder=True)
    show('the real venueplay/ builds (placeholder allowed for this test)', r['ok'], r)
    show('...and builds a real number of files', r.get('files', 0) > 100 and r.get('changed', 0) > 20, r)

    print('1. what the build changes')
    tokens = [live['supabaseUrl'].split('//')[1], M.host(live['api']), M.host(live['game']), live['supabaseAnon'], 'ijkzgmdtwtgfkedqspxm']
    left = []
    pages = untagged = 0
    for dp, dn, fn in os.walk(out):
        for f in fn:
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, out)
            try:
                t = read(p)
            except Exception:
                continue
            if rel != os.path.join('app', 'vp-env.js'):
                for tok in tokens:
                    if tok in t:
                        left.append('%s: %s' % (rel, tok[:30]))
            if f.endswith('.html'):
                pages += 1
                head = re.search(r'<head[^>]*>', t, re.I)
                first = re.search(r'<script[^>]*src="[^"]+"', t[head.end():] if head else t)
                if not (first and first.group(0).endswith('"/app/vp-env.js"')):
                    untagged += 1
    show('no live address, ref or public key is left in any page or script', not left, left[:3])
    show('every page loads vp-env.js as the FIRST script', pages > 40 and untagged == 0, (pages, untagged))
    tv = read(os.path.join(out, 'tv.html'))
    show('tv.html now points at the staging database, key and game Worker', stg['supabaseUrl'].split('//')[1] in tv and stg['supabaseAnon'] in tv and M.host(stg['game']) in tv)
    show('vp-session.js (the shared script) points at staging api and game', M.host(stg['api']) in read(os.path.join(out, 'app', 'vp-session.js')) and M.host(stg['game']) in read(os.path.join(out, 'app', 'vp-session.js')))
    env_out = read(os.path.join(out, 'app', 'vp-env.js'))
    show('vp-env.js is copied whole (it keeps BOTH sets: it is the config)', env_out == read(ENV_JS))
    show('_headers gains noindex', 'X-Robots-Tag: noindex' in read(os.path.join(out, '_headers')))
    show('the build writes staging-build.json', json.loads(read(os.path.join(out, 'staging-build.json')))['staging'] == stg['site'])
    after = {}
    for dp, dn, fn in os.walk(SRC):
        for f in fn:
            p = os.path.join(dp, f)
            after[p] = os.path.getsize(p)
    show('the source tree venueplay/ is untouched', before == after)
    # only addresses and the tag differ: undo them and the pages are the release's pages
    pairs = M.swaps(live, stg)
    odd = []
    for dp, dn, fn in os.walk(SRC):
        for f in fn:
            if not f.endswith(('.html', '.js')):
                continue
            s = os.path.join(dp, f)
            rel = os.path.relpath(s, SRC)
            if rel == os.path.join('app', 'vp-env.js'):
                continue
            back = read(os.path.join(out, rel)).replace(M.TAG + '\n', '', 1)
            for a, b in reversed(pairs):
                back = back.replace(b, a)
            # the Stripe key swap (16 Nov 2026, ec12f3e5): every pk_live_ key became Stripe's TEST key, so both sides are
            # compared with the key written as one placeholder; the build's own refusal keeps pk_live_ out of staging
            back = back.replace(M.STRIPE_TEST_PK, 'pk_live_KEY')
            try:
                if back != M.PK_LIVE.sub('pk_live_KEY', read(s)):
                    odd.append(rel)
            except Exception:
                pass
    show('undo the addresses and the tag and every page is byte-for-byte the release', not odd, odd[:3])

    print('2. what it refuses')
    bad_src = os.path.join(tmp, 'bad')

    def variant(name, mutate, want):
        if os.path.exists(bad_src):
            shutil.rmtree(bad_src)
        os.makedirs(os.path.join(bad_src, 'app'))
        t = mutate(read(ENV_JS))
        open(os.path.join(bad_src, 'app', 'vp-env.js'), 'w').write(t)
        open(os.path.join(bad_src, 'index.html'), 'w').write('<html><head></head><body></body></html>')
        res = M.build(bad_src, os.path.join(tmp, 'badout'), allow_placeholder=False)
        show(name, (not res['ok']) and any(want in p for p in res['problems']), res)
    variant('the placeholder public key is refused', lambda t: t, 'placeholder')
    variant('a staging database that is the live one is refused', lambda t: t.replace('https://gpoolavkghnxedzrmtmc.supabase.co', 'https://ijkzgmdtwtgfkedqspxm.supabase.co').replace('TEST_ANON_KEY_NOT_SET_YET', 'sb_publishable_other'), 'LIVE')
    variant('a staging api that is the live one is refused', lambda t: t.replace('https://api-staging.venueplay.com.au', 'https://api.venueplay.com.au').replace('TEST_ANON_KEY_NOT_SET_YET', 'sb_publishable_other'), 'LIVE')
    variant('the live public key as the staging key is refused', lambda t: t.replace('TEST_ANON_KEY_NOT_SET_YET', 'sb_publishable_9v83FWCSt7Di-jkgTvsMJQ_f6lJPovb'), 'LIVE public key')
    variant('a staging site that is the live site is refused', lambda t: t.replace('https://staging.venueplay.com.au', 'https://www.venueplay.com.au').replace('TEST_ANON_KEY_NOT_SET_YET', 'sb_publishable_other'), 'LIVE')
    variant('a vp-env.js with no STAGING block is refused', lambda t: t.replace('var STAGING', 'var NOTSTAGING'), 'STAGING')
    okv = os.path.join(tmp, 'okout')
    if os.path.exists(bad_src):
        shutil.rmtree(bad_src)
    os.makedirs(os.path.join(bad_src, 'app'))
    open(os.path.join(bad_src, 'app', 'vp-env.js'), 'w').write(read(ENV_JS).replace('TEST_ANON_KEY_NOT_SET_YET', 'sb_publishable_test_one'))
    open(os.path.join(bad_src, 'a.html'), 'w').write('<html><head><title>x</title></head><body><script>var U="https://ijkzgmdtwtgfkedqspxm.supabase.co"; var L="wss://ijkzgmdtwtgfkedqspxm.supabase.co/realtime";</script></body></html>')
    res = M.build(bad_src, okv, allow_placeholder=False)
    ta = read(os.path.join(okv, 'a.html')) if res['ok'] else ''
    show('with a real test key it builds, and wss:// addresses are swapped too', res['ok'] and 'wss://gpoolavkghnxedzrmtmc.supabase.co' in ta and 'ijkz' not in ta, res)
    show('a page with no <head> still gets the tag', M.inject_tag('<p>hi</p>')[0].startswith(M.TAG))
    show('a page that already has the tag is not tagged twice', M.inject_tag('<head><script src="/app/vp-env.js"></script></head>')[1] is False)

    print('3. the settings agree')
    cfg = json.loads(read(os.path.join(HERE, 'staging-config.json')))
    api_h, game_h = cfg['workers']['api']['hostname'], cfg['workers']['game']['hostname']
    show('Worker hostnames equal the ones vp-env.js points pages at', 'https://' + api_h == stg['api'] and 'https://' + game_h == stg['game'] and 'https://' + cfg['site']['hostname'] == stg['site'])
    show('the access lock covers the site and both Workers', sorted(cfg['access_lock']['hostnames']) == sorted([cfg['site']['hostname'], api_h, game_h]))
    show('the test project is the one vp-env.js names', cfg['test_project_ref'] in stg['supabaseUrl'])
    guard = read(os.path.join(ROOT, 'venueplay-backend', 'worker', 'vp-outbox-guard.js'))
    show('the fiction phone range equals the outbox guard\'s', ("testMobilePrefix: '%s'" % cfg['test_mobile_prefix']) in guard)
    show('the test email domain equals the outbox guard\'s', ("testEmailDomain: '%s'" % cfg['test_email_domain']) in guard)
    show('the live ref the guard refuses equals the one the config refuses', ("liveSupabaseRef: '%s'" % cfg['live_project_ref_to_refuse']) in guard)
    seed = read(os.path.join(HERE, 'seed-test-data.sql'))
    show('the seed uses only fiction numbers (no 0400 numbers left)', '61400000' not in seed and '0400000' not in seed and '61' + '49157' in seed and "'0491571'" in seed)
    dw = read(os.path.join(ROOT, 'tools', 'deploy-worker.py'))
    live_set = set(re.findall(r"'([a-z-]+)'", re.search(r'^LIVE = \{(.*?)\}', dw, re.M).group(1)))
    show('the staging Workers are not in deploy-worker.py\'s LIVE set', cfg['workers']['api']['name'] not in live_set and cfg['workers']['game']['name'] not in live_set, live_set)
    show('...and their names start with the live slot name (the slot rule), so deploy-worker.py will take them', cfg['workers']['api']['name'].startswith('venueplay-api') and cfg['workers']['game']['name'].startswith('venueplay-game'))
    show('the key-file names are all TEST_ names', all(v.startswith('TEST_') for v in cfg['key_file_names'].values()), cfg['key_file_names'])
    show('every from_key_file entry names a key-file name that exists', all(v in cfg['key_file_names'] for w in cfg['workers'].values() for v in w['from_key_file'].values()))
    blob = json.dumps(cfg)
    show('no secret-shaped value is in the config', not re.search(r'(sk|rk|pk)_(live|test)_[A-Za-z0-9]|eyJ[A-Za-z0-9]{10}|sb_(publishable|secret)_[A-Za-z0-9]|re_[A-Za-z0-9]{12}', blob))
    show('both staging Workers set VP_ENV=staging', all(w['plain'].get('VP_ENV') == 'staging' for w in cfg['workers'].values()))
    show('the SMS hook, the autopilot key and push keys are never set on staging', all(k in cfg['workers']['api']['never_set'] for k in ('SEND_SMS_HOOK_URL', 'SEND_SMS_HOOK_SECRET', 'PROSPECT_AUTOPILOT_KEY', 'VAPID_PRIVATE_JWK')))
    show('the game Worker is deployed with its room class', '--do-class=VenueRoom' in cfg['workers']['game']['deploy_flags'] and 'RL' in cfg['workers']['game']['kv_bindings'])
    show('the guard\'s send-key list covers every dummy key the config sets', all(("'%s'" % k) in guard for w in cfg['workers'].values() for k in w['dummy_send_keys']))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

if BAD[0]:
    print('\nFAILED %d of %d' % (BAD[0], RAN[0]))
    sys.exit(1)
print('\nALL %d CHECKS PASSED' % RAN[0])
