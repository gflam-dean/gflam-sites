#!/usr/bin/env python3
"""A FRESH SIGN-UP ON STAGING, EVERY RUN, AS A NEW PUB WOULD (Dean, 16 Nov 2026: "maybe two venues and then sign up a
new one"; his goal: sign-up + sign-in + card is THE flow, judged by taps to signed in).

From the public home page at https://staging.venueplay.com.au a new Victorian pub, "Stage New Pub <ddmm>", signs up
with a fiction mobile (0491 57x xxx) and an @example.invalid email, so the outbox guard sends nothing real. Every screen
is saved at 390x844 AND 375x667 and every tap is counted. Then:

  CARD      Only when staging billing is Stripe TEST mode (the Mac half checks it before the run: the TEST secret key is
            sk_test_, the Stripe webhook to api-staging is livemode false, the guard on api-staging refuses a live key).
            Only Stripe's published test card, 4242 4242 4242 4242. If staging is not test mode it stops at the card.
  SIGN-IN   staging cannot text a code (no SMS hook, by design), so the page's own sign-in steps are tapped up to "send
            the code" and counted, and the session is then the staging test path: the Mac half mints a TEST session for
            the new login (only an @example.invalid login on a "Stage New Pub" venue) and hands it over.
  WIZARD    the setup wizard with its defaults, the light logo uploaded if it asks for one.
  GAMES     its first game, trivia, host only with 0 phones; then trivia with 2 phones (real-venues-play.py, same frames).
Older "Stage New Pub ####" venues are left on TEST and renamed "... (old sign-up)" so they are easy to find.

    python3 tools/staging/real-venues-signup.py                 Mac: the whole thing (server does the browser)
    python3 tools/staging/real-venues-signup.py --drive <job>   server: the browser half (started by the Mac half)
"""
import base64, datetime, importlib.util, json, os, re, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
BASE = 'https://staging.venueplay.com.au'
TEST_CARD = ['4242', '4242', '4242', '4242']   # Stripe's published test card (stripe.com/docs/testing)


# =====================================================================================  SERVER HALF (the browser)
def drive(job_dir):
    sys.path.insert(0, TOOLS); sys.path.insert(0, os.path.join(TOOLS, 'browser-rig'))
    spec = importlib.util.spec_from_file_location('VL', os.path.join(TOOLS, 'verify-live.py'))
    VL = importlib.util.module_from_spec(spec); spec.loader.exec_module(VL)
    if os.environ.get('VP_VL_CHROME'):
        VL.CHROME = os.environ['VP_VL_CHROME']
    import waits
    job = json.load(open(os.path.join(job_dir, 'job.json')))
    OUT = os.path.join(job_dir, 'out'); os.makedirs(OUT, exist_ok=True)
    LOG = open(os.path.join(OUT, 'log.txt'), 'a')
    RES, FR = [], []
    TAPS = {'n': 0, 'list': []}
    state = {'signed_in_taps': None, 'card_taps': None, 'to_code_taps': None}

    def log(*a):
        s = ' '.join(str(x) for x in a); print(s); LOG.write(s + '\n'); LOG.flush(); sys.stdout.flush()

    def save():
        json.dump({'venue': {'name': job['venue'], 'slug': '', 'id': '', 'state': 'VIC'}, 'results': RES, 'frames': FR,
                   'started': job['started'], 'plan_label': 'signup', 'build': job.get('build', ''),
                   'taps': TAPS, 'state': state, 'summary': summary()}, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)

    def summary():
        t = TAPS['list']
        return ('<b>%s</b> signed up from the home page. Taps (a tap = one press on a box, button or tick; typing is not '
                'counted): <b>%s</b> to the card form, <b>%s</b> to "send me the code", <b>%s</b> to signed in (with the '
                'staging test path standing in for typing the texted code, which a person would do in 1 to 2 more taps).'
                '<br>Taps in order: %s') % (html_esc(job['venue']), state['card_taps'], state['to_code_taps'], state['signed_in_taps'],
                                           html_esc(' | '.join(t)))

    def html_esc(s): return str(s).replace('&', '&amp;').replace('<', '&lt;')

    def rec(step, ok, note=''):
        RES.append({'game': 'signup', 'mode': '-', 'step': step, 'ok': bool(ok), 'note': str(note)[:700], 'png': ''})
        log(('  ok   ' if ok else '  FAIL ') + step + '  ' + ('' if ok else str(note)[:300])); save()

    B = VL.Browser()
    ctx = B.call('Target.createBrowserContext', {})['browserContextId']
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'browserContextId': ctx})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    B.call('Page.enable', {}, session=sid); B.call('Network.enable', {}, session=sid)
    B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message));});'}, session=sid)
    size = {'wh': (390, 844)}

    def metrics(w, h):
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': True}, session=sid)
        size['wh'] = (w, h)
    metrics(390, 844)

    def js(expr, wait=10):
        r = B.evaluate(sid, expr, wait)
        return 'HUNG' if r is None else r.get('result', {}).get('value')

    def until(expr, secs=20):
        return waits.until(lambda e: js(e), expr, secs, every=0.4)

    def nav(url):
        if not (url.startswith(BASE + '/') or url == BASE):
            sys.exit('refusing ' + url)
        B.call('Page.navigate', {'url': url}, session=sid)
        time.sleep(1); until('document.readyState==="complete"', 40); time.sleep(1.5)

    def text(n=500):
        return js('document.body ? document.body.innerText.replace(/\\s+/g," ").slice(0,%d) : ""' % n) or ''

    def shot(step, kind='page'):
        """The screen as it is, at 390x844 and at 375x667 (the viewport only: what a person sees without scrolling)."""
        for (w, h) in ((390, 844), (375, 667)):
            if size['wh'] != (w, h):
                metrics(w, h); time.sleep(0.9)
            try:
                r = B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
                name = 'signup-%s-%d.png' % (step, w)
                open(os.path.join(OUT, name), 'wb').write(base64.b64decode(r['data']))
                FR.append({'game': job.get('frame_game', 'signup'), 'mode': '-', 'step': step, 'kind': 'console', 'size': '%dx%d' % (w, h),
                           'png': name, 'note': ('%s | %s' % (js('location.pathname+location.search'), text(160)))[:260]})
            except Exception as e:
                log('shot failed', step, e)
        metrics(390, 844); time.sleep(0.4); save()

    def center(sel_js):
        """Scroll the element into view and give its middle, as a finger would aim."""
        r = js('(function(){var e=%s; if(!e) return null; e.scrollIntoView({block:"center"}); var b=e.getBoundingClientRect(); '
               'return JSON.stringify([b.left+b.width/2, b.top+b.height/2, b.width, b.height]);})()' % sel_js)
        if not r or r == 'HUNG':
            return None
        time.sleep(0.4)
        r = js('(function(){var e=%s; var b=e.getBoundingClientRect(); return JSON.stringify([b.left+b.width/2, b.top+b.height/2]);})()' % sel_js)
        return json.loads(r) if r and r != 'HUNG' else None

    def tap(sel_js, why):
        c = center(sel_js)
        if not c:
            log('  could not find to tap:', why); return False
        for t in ('mousePressed', 'mouseReleased'):
            B.call('Input.dispatchMouseEvent', {'type': t, 'x': c[0], 'y': c[1], 'button': 'left', 'clickCount': 1}, session=sid)
        TAPS['n'] += 1; TAPS['list'].append(why); log('  tap %d: %s' % (TAPS['n'], why))
        time.sleep(0.5); return True

    def type_(s):
        B.call('Input.insertText', {'text': s}, session=sid); time.sleep(0.3)

    def field(sel_js, value, why):
        if tap(sel_js, why):
            js('(function(){var e=%s; if(e){ e.select && e.select(); }})()' % sel_js)
            type_(value); return True
        return False

    q = lambda css: 'document.querySelector(%s)' % json.dumps(css)
    byText = lambda rx, tags='button,a': ('[].filter.call(document.querySelectorAll(%s),function(x){var r=x.getBoundingClientRect(); return r.height>0 && %s.test(x.textContent.replace(/\\s+/g," ").trim());})[0]' % (json.dumps(tags), rx))

    # ------------------------------------------------ 1. the home page, as a pub owner on a phone finds it
    nav(BASE + '/')
    rec('home page opens', 'venueplay' in text(2000).lower(), text(200)); shot('01-home')
    tap(byText('/^Start your free month$/'), 'Start your free month (home)')
    time.sleep(1.5); shot('02-claim-form')
    rows = js('document.querySelectorAll(".v-name").length')
    rec('sign-up form has a venue row', (rows or 0) >= 1, rows)
    field(q('.v-name'), job['venue'], 'venue name box')
    field(q('.v-postcode'), job['postcode'], 'postcode box')
    seats = js('(function(){var e=document.querySelector(".v-seats"); return e ? (e.value||"") : "none";})()')
    if not seats:
        field(q('.v-seats'), '40', 'max players box')
    field(q('#vp-name'), job['person'], 'your name box')
    field(q('#vp-email'), job['email'], 'email box')
    field(q('#vp-mobile'), job['mobile'], 'mobile box')
    tap(q('[data-entity="for_profit"]'), 'pub (not a club)')
    shot('03-form-filled')
    tap(q('#vp-consent'), 'Terms tick')
    shot('04-ready-to-submit')

    # ------------------------------------------------ 2. the card
    if not job.get('stripe_test'):
        rec('card step: staging billing is NOT Stripe test mode, stopped before the card', False, job.get('stripe_why'))
        save(); B.close(); return
    tap(q('#vp-submit'), 'Start my free month (submit)')
    t0 = time.time(); where = ''
    while time.time() - t0 < 40:
        where = js('location.href') or ''
        emb = js('(function(){var o=document.getElementById("vp-embed-overlay"); return !!o && o.classList.contains("show");})()')
        if 'checkout.stripe.com' in where or emb is True:
            break
        time.sleep(1)
    time.sleep(6)
    shot('05-card-form')
    state['card_taps'] = TAPS['n']
    emb = js('(function(){var o=document.getElementById("vp-embed-overlay"); return !!o && o.classList.contains("show");})()') is True
    err = js('(function(){var e=document.querySelector(".err.show,#vp-err.show,.form-err.show"); return e ? e.textContent.trim() : "";})()') or ''
    rec('card form opens (%s)' % ('card form on our page' if emb else ('Stripe page' if 'checkout.stripe.com' in where else 'nothing')), emb or 'checkout.stripe.com' in where, [where[:120], err, text(200)])
    if emb:
        mounted = until('(function(){var f=document.querySelector("#vp-embed-overlay iframe"); return !!f && f.getBoundingClientRect().height>200;})()', 25) is True
        time.sleep(15)
        shot('06-embedded-after-wait')
        live_pk = job.get('page_pk_mode') == 'live'
        rec('the staging page carries a TEST publishable key (a live key cannot draw a TEST card form: it stays grey)', not live_pk,
            'VP_STRIPE_PK on the staging home page is pk_%s_..., the Worker makes TEST mode sessions' % job.get('page_pk_mode'))
        if not mounted or live_pk or job.get('force_redirect'):
            # The staging page carries the LIVE publishable key with a TEST mode session: the embedded form cannot mount.
            # Go the page's own fallback: Stripe.js blocked, so it takes the classic Stripe-hosted page (still TEST mode).
            log('  embedded card form did not draw; taking the page\'s redirect path with Stripe.js blocked')
            # Stripe.js never takes hold on OUR page (only there: Stripe's own page needs its own scripts), so the page's
            # own test (typeof window.Stripe) picks the classic redirect to Stripe's TEST mode page
            B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'if(location.host==="staging.venueplay.com.au"){try{Object.defineProperty(window,"Stripe",{get:function(){return undefined;},set:function(){},configurable:false});}catch(e){}}'}, session=sid)
            nav(BASE + '/?card=again#claim'); time.sleep(2)   # a real reload, not a hash jump
            TAPS['list'].append('(page reloaded: the card form had not drawn)')
            for sel, val in (('.v-name', job['venue']), ('.v-postcode', job['postcode']), ('.v-seats', '40'), ('#vp-name', job['person']), ('#vp-email', job['email']), ('#vp-mobile', job['mobile'])):
                js('(function(){var e=document.querySelector(%s); if(e){ e.value=%s; e.dispatchEvent(new Event("input",{bubbles:true})); }})()' % (json.dumps(sel), json.dumps(val)))
            js('(function(){var b=document.querySelector(\'[data-entity="for_profit"]\'); if(b) b.click(); var c=document.getElementById("vp-consent"); if(c && !c.checked) c.click(); document.getElementById("vp-submit").click();})()')
            until('location.host==="checkout.stripe.com"', 40); time.sleep(5)
            perr = js('(function(){var e=document.querySelector(".show[id*=err], .err.show"); return e ? e.textContent.trim() : "";})()')
            if perr: rec('the card page opens (the form said: %s)' % perr, False, perr)
            where = js('location.href') or ''
            shot('07-stripe-page')
    if 'checkout.stripe.com' in (js('location.href') or ''):
        rec('Stripe page is TEST mode (says so)', re.search(r'test mode|sandbox|TEST', text(3000)) is not None, text(300))
        until('!!document.querySelector("#cardNumber")', 30)
        if js('!!document.querySelector("#email") && !document.querySelector("#email").value'):
            field(q('#email'), job['email'], 'Stripe: email')
        field(q('#cardNumber'), ''.join(TEST_CARD), 'Stripe: card number (test card)')
        field(q('#cardExpiry'), '12 / 34', 'Stripe: expiry')
        field(q('#cardCvc'), '123', 'Stripe: CVC')
        if js('!!document.querySelector("#billingName")'):
            field(q('#billingName'), job['person'], 'Stripe: name on card')
        if js('(function(){var e=document.querySelector("#billingPostalCode"); return !!e && e.offsetParent!==null;})()'):
            field(q('#billingPostalCode'), job['postcode'], 'Stripe: postcode')
        shot('08-stripe-filled')
        tap('document.querySelector(".SubmitButton") || document.querySelector("button[type=submit]")', 'Stripe: Start trial / Subscribe')
        back = until('location.host==="staging.venueplay.com.au"', 90) is True
        time.sleep(4); shot('09-back-from-stripe')
        rec('back on venueplay after the card', back, [js('location.href'), text(300)])
    if 'checkout.stripe.com' in (js('location.href') or '') or not js('location.host==="staging.venueplay.com.au"'):
        rec('STOPPED AT THE CARD: the Stripe TEST card page did not draw in this browser, so no account was made', False,
            [(js('location.href') or '')[:60], text(200)])
        shot('09-stopped-at-card'); save()
        try: B.close()
        except Exception: pass
        return
    ok_page = js('(function(){var s=document.getElementById("vp-success"); return !!s && s.classList.contains("show");})()') is True
    rec('success screen shows after the card', ok_page, [js('location.href'), text(300)])
    if ok_page:
        js('document.getElementById("vp-success").scrollIntoView({block:"center"}); true'); time.sleep(1); shot('09b-success')

    # ------------------------------------------------ 3. signing in (the page's own steps, then the staging test path)
    if not tap(byText('/Sign in and set up your screen/i'), 'Sign in and set up your screen'):
        nav(BASE + '/app/')
    time.sleep(3); shot('10-signin')
    tel = '[].filter.call(document.querySelectorAll("input[type=tel]"),function(x){return x.getBoundingClientRect().height>0;})[0]'
    if js('!!(%s)' % tel):
        field(tel, job['mobile'], 'sign-in: mobile box')
        tap(byText('/send|text me|get (my|a) code|sign in|next|continue/i', 'button'), 'sign-in: send me the code')
        time.sleep(4); shot('11-signin-after-send')
        state['to_code_taps'] = TAPS['n']
        rec('sign-in: what a staging tester sees after "send the code" (no text can leave staging)', True, text(300))
    else:
        rec('sign-in page shows a mobile box', False, text(300))
    # ask the Mac half for the TEST session of this new login
    open(os.path.join(job_dir, 'need-session.json'), 'w').write(json.dumps({'email': job['email'], 'at': time.time()}))
    t0 = time.time()
    while not os.path.exists(os.path.join(job_dir, 'session.json')) and time.time() - t0 < 600:
        time.sleep(2)
    if not os.path.exists(os.path.join(job_dir, 'session.json')):
        rec('the new login exists on TEST (the Mac half found it)', False, 'no session after 10 minutes'); save(); B.close(); return
    got = json.load(open(os.path.join(job_dir, 'session.json')))
    if got.get('error'):
        rec('the new login exists on TEST (the Mac half found it)', False, got['error']); save(); B.close(); return
    sess, venue = got['session'], got['venue']
    os.remove(os.path.join(job_dir, 'session.json'))
    key = 'sb-rkfaftxgzpsmmrzudlqy-auth-token'
    js('(function(){localStorage.setItem(%s,%s); localStorage.setItem("vpCurrentVenue",%s); return 1;})()' % (json.dumps(key), json.dumps(json.dumps(sess)), json.dumps(venue['id'])))
    nav(BASE + '/app/'); time.sleep(4)
    state['signed_in_taps'] = TAPS['n']
    rec('signed in: the console opens for %s' % venue['name'], re.search(r'sign in|enter your mobile', text(600), re.I) is None, text(300))
    shot('12-first-screen-signed-in')

    # ------------------------------------------------ 4. the setup wizard with its defaults
    PRIMARY = '/^(Next|Continue|Save and continue|Looks right|Yes|Yes, that.s us|Done|Finish|Let.s go|Start|Got it|I agree|Accept|Skip|Skip for now|Not now|Later|Maybe later|Remind me later|Next step|Save)\\b/i'
    seen = []
    for step in range(1, 31):
        t = text(400)
        fileinp = js('(function(){var f=[].filter.call(document.querySelectorAll("input[type=file]"),function(x){var l=x.closest("label,section,div"); return !!l && l.getBoundingClientRect().height>0 && /logo/i.test(l.textContent);})[0]; return !!f;})()')
        if fileinp is True and not state.get('logo_done'):
            doc = B.call('DOM.getDocument', {'depth': 1}, session=sid)
            nid = B.call('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': 'input[type=file]'}, session=sid)['nodeId']
            B.call('DOM.setFileInputFiles', {'files': [os.path.join(job_dir, 'logo.png')], 'nodeId': nid}, session=sid)
            TAPS['n'] += 2; TAPS['list'].append('wizard: choose logo + pick the file'); state['logo_done'] = True
            time.sleep(5); shot('2%02d-wizard-logo' % step); continue
        for cb in range(3):   # a required tick (the Terms) is ticked as a person would
            if not js('(function(){var c=[].filter.call(document.querySelectorAll("input[type=checkbox]"),function(x){var r=(x.closest("label")||x).getBoundingClientRect(); return r.height>0 && !x.checked && /terms|agree|accept|responsible/i.test((x.closest("label")||x.parentElement).textContent);})[0]; if(!c) return false; c.setAttribute("data-vp-tick","1"); return true;})()'):
                break
            tap(q('[data-vp-tick="1"]'), 'wizard: tick'); js('(function(){var c=document.querySelector("[data-vp-tick]"); if(c) c.removeAttribute("data-vp-tick");})()')
        shot('2%02d-wizard' % step)
        label = js('(function(){var b=%s; return b ? b.textContent.replace(/\\s+/g," ").trim().slice(0,50) : "";})()' % byText(PRIMARY, 'button'))
        if not label:
            log('  wizard: no next button; done at step', step); break
        seen.append(label)
        if len(seen) > 4 and len(set(seen[-4:])) == 1 and t == text(400):
            rec('wizard moves on (stuck on "%s")' % label, False, t); break
        tap(byText(PRIMARY, 'button'), 'wizard: ' + label)
        time.sleep(3)
    rec('setup wizard walked with its defaults (%d screens)' % len(seen), len(seen) >= 1, ' > '.join(seen))
    shot('30-after-wizard')
    open(os.path.join(job_dir, 'wizard-done.json'), 'w').write(json.dumps({'venue': venue, 'steps': seen}))
    save()
    try: B.close()
    except Exception: pass


# =====================================================================================  MAC HALF
def mac():
    spec = importlib.util.spec_from_file_location('seedrv', os.path.join(HERE, 'seed-real-venues.py'))
    S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
    spec = importlib.util.spec_from_file_location('runrv', os.path.join(HERE, 'real-venues-run.py'))
    R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
    S.URL, S.SKEY, S.AKEY = S.load_env()
    say = R.say
    args = sys.argv[1:]
    root = args[args.index('--root') + 1] if '--root' in args else os.path.expanduser(
        '~/venue-enrich/reports/staging-real-venues-%s' % datetime.date.today().strftime('%d%b').lower().lstrip('0'))
    os.makedirs(root, exist_ok=True)
    now = datetime.datetime.now()
    ddmm = now.strftime('%d%m')
    # mark the older sign-ups, keep them
    olds = S.rest('GET', 'vp_venues?name=like.Stage%20New%20Pub%20*&select=id,name') or []
    for o in olds:
        if not o['name'].startswith('Stage New Pub ' + ddmm) and '(old sign-up)' not in o['name']:
            S.rest('PATCH', 'vp_venues?id=eq.' + o['id'], {'name': o['name'] + ' (old sign-up)'})
            say('marked', o['name'], '->', o['name'] + ' (old sign-up)')
    taken = {o['name'] for o in olds}
    name = 'Stage New Pub ' + ddmm
    k = 2
    while name in taken:
        name = 'Stage New Pub %s-%d' % (ddmm, k); k += 1
    stamp = now.strftime('%H%M')
    mob = '049157' + '%04d' % (3000 + (now.hour * 60 + now.minute) % 7000)   # 0491 57x xxx, never 0001/0002/0111/0112
    email = 'signup-%s-%s@example.invalid' % (ddmm, stamp)
    # is staging billing Stripe TEST mode? (read only, no key printed)
    env = {}
    for line in open(os.path.expanduser('~/.gflam-migrate.env')):
        if '=' in line and not line.startswith('#'):
            a, b = line.strip().split('=', 1); env[a.replace('export ', '').strip()] = b.strip().strip('"').strip("'")
    sk = env.get('TEST_STRIPE_SECRET_KEY', '')
    why = []
    test_mode = sk.startswith('sk_' + 'test_')
    if not test_mode:
        why.append('the TEST Stripe key in the key file is not a test-mode key')
    else:
        import urllib.request
        rq = urllib.request.Request('https://api.stripe.com/v1/webhook_endpoints?limit=20', headers={'Authorization': 'Bearer ' + sk})
        hooks = json.load(urllib.request.urlopen(rq, timeout=20)).get('data', [])
        st = [h for h in hooks if h.get('url') == 'https://api-staging.venueplay.com.au/webhook']
        if not st or st[0].get('livemode') or st[0].get('status') != 'enabled':
            test_mode = False; why.append('no enabled TEST-mode Stripe webhook to api-staging/webhook')
    h = R.get_json('https://api-staging.venueplay.com.au/health')
    if not h.get('ok'):
        test_mode = False; why.append('api-staging /health is not ok (the guard refuses a live Stripe key with a 503)')
    import urllib.request as _u
    page = _u.urlopen(_u.Request(BASE + '/', headers={'User-Agent': 'Mozilla/5.0 (venueplay staging check)'}), timeout=20).read().decode('utf-8', 'replace')
    pk = re.search(r"VP_STRIPE_PK\s*=\s*'(pk_[a-z]+)_", page)
    pk_mode = pk.group(1)[3:] if pk else 'none'   # 'live' or 'test'
    say('Stripe: Worker side TEST mode %s; the staging home page publishable key is %s_...' % (test_mode, pk_mode))
    job = {'venue': name, 'postcode': '3121', 'person': 'Sam Signup (staging test)', 'email': email, 'mobile': mob,
           'started': now.strftime('%Y-%m-%d %H:%M:%S'), 'stripe_test': test_mode, 'stripe_why': '; '.join(why),
           'build': R.build_stamp(), 'page_pk_mode': pk_mode}
    remote = '/home/vp/stg-real/signup-%s-%d' % (stamp, os.getpid())
    R.sh(R.SSH + ['mkdir -p %s/tools/browser-rig %s/tools/staging' % (remote, remote)], check=True)
    for f in R.FILES:
        src = os.path.join(os.path.dirname(TOOLS), f)
        if os.path.exists(src):
            R.sh(['scp', '-q', '-i', R.KEY, src, '%s:%s/%s' % (R.HOST, remote, f)], check=True)
    tmp = os.path.join(root, '.job-%s.json' % stamp)
    open(tmp, 'w').write(json.dumps(job))
    R.sh(['scp', '-q', '-i', R.KEY, tmp, '%s:%s/job.json' % (R.HOST, remote)], check=True); os.remove(tmp)
    R.sh(['scp', '-q', '-i', R.KEY, os.path.join(HERE, 'real-venues', 'stage-new-pub-logo-light.png'), '%s:%s/logo.png' % (R.HOST, remote)], check=True)
    R.sh(R.SSH + ['chown -R vp:vp %s' % remote], check=True)
    R.wait_for_server()
    say('sign-up: %s, %s, %s (server drives the browser)' % (name, mob, email))
    p = subprocess.Popen(R.SSH + ['cd %s && runuser -u vp -- env VP_VL_CHROME=/usr/bin/google-chrome HOME=/home/vp TZ=Australia/Brisbane '
                                  'python3 tools/staging/real-venues-signup.py --drive %s > run.log 2>&1; echo rc=$?' % (remote, remote)],
                         stdout=subprocess.PIPE, text=True)
    venue = None
    while p.poll() is None:
        time.sleep(4)
        r = R.sh(R.SSH + ['test -f %s/need-session.json && echo yes' % remote], capture_output=True, text=True)
        if 'yes' not in r.stdout:
            continue
        R.sh(R.SSH + ['rm -f %s/need-session.json' % remote])
        answer = {}
        for _ in range(30):   # the Stripe webhook makes the account a few seconds after the card
            st = S.rest('GET', 'vp_venues?name=eq.%s&select=id,name,slug,join_code,au_state,founding_id' % __import__('urllib.parse').parse.quote(name)) or []
            if st and not (isinstance(st, dict)):
                break
            time.sleep(5)
        if not st or isinstance(st, dict):
            answer = {'error': 'no venue called %s on TEST after the card (the webhook did not make the account)' % name}
        else:
            venue = st[0]
            staff = S.rest('GET', 'vp_venue_staff?venue_id=eq.%s&role=eq.owner&select=auth_user_id' % venue['id']) or []
            if not staff:
                answer = {'error': 'the venue has no owner login'}
            else:
                uid = staff[0]['auth_user_id']
                u = S.http('GET', S.URL + '/auth/v1/admin/users/' + uid, None, S.svc()) or {}
                em = (u.get('email') or '').lower()
                if not em.endswith('@example.invalid') or not venue['name'].startswith('Stage New Pub'):
                    answer = {'error': 'refused: the login is not a TEST sign-up (%s)' % em}
                else:
                    sess = S.session_for(uid, em)
                    answer = {'session': sess, 'venue': venue}
        loc = os.path.join(root, '.sess-%s.json' % stamp)
        fd = os.open(loc, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, json.dumps(answer).encode()); os.close(fd)
        R.sh(['scp', '-q', '-i', R.KEY, loc, '%s:%s/session.json.tmp' % (R.HOST, remote)])
        R.sh(R.SSH + ['chown vp:vp %s/session.json.tmp && mv %s/session.json.tmp %s/session.json' % (remote, remote, remote)])
        os.remove(loc)
        say('handed over the TEST session' if 'session' in answer else answer.get('error'))
    say('sign-up browser half finished', (p.stdout.read() or '').strip()[-80:])
    dest = os.path.join(root, 'signup-%s' % stamp)
    os.makedirs(dest, exist_ok=True)
    R.sh(['rsync', '-az', '-e', 'ssh -i ' + R.KEY, '%s:%s/out/' % (R.HOST, remote), dest + '/'])
    R.sh(['scp', '-q', '-i', R.KEY, '%s:%s/run.log' % (R.HOST, remote), os.path.join(dest, 'run.log')])
    R.sh(R.SSH + ['rm -f %s/session.json %s/job.json' % (remote, remote)])
    # its first games: trivia host only, then trivia with 2 phones
    if venue:
        venue = (S.rest('GET', 'vp_venues?id=eq.%s&select=id,name,slug,join_code,au_state' % venue['id']) or [venue])[0]
        uid = (S.rest('GET', 'vp_venue_staff?venue_id=eq.%s&role=eq.owner&select=auth_user_id' % venue['id']) or [{}])[0].get('auth_user_id')
        em = ((S.http('GET', S.URL + '/auth/v1/admin/users/' + uid, None, S.svc()) or {}).get('email') or '').lower()
        for modes, sub in ((['nophone'], 'first-game-host-only'), (['phones'], 'first-game-2-phones')):
            plan = {'base': BASE, 'label': sub, 'build': job['build'],
                    'venue': {'id': venue['id'], 'slug': venue['slug'], 'code': venue['join_code'], 'name': venue['name'], 'state': venue['au_state']},
                    'sessions': {'owner': S.session_for(uid, em)}, 'host_for': {}, 'modes': modes}
            loc = os.path.join(root, '.plan-%s-%s.json' % (sub, stamp))
            fd = os.open(loc, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, json.dumps(plan).encode()); os.close(fd)
            R.sh(['scp', '-q', '-i', R.KEY, loc, '%s:%s/plan-%s.json' % (R.HOST, remote, sub)]); os.remove(loc)
            R.sh(R.SSH + ['chown -R vp:vp %s' % remote])
            say('first game at the new venue:', sub)
            R.sh(R.SSH + ['cd %s && runuser -u vp -- env VP_VL_CHROME=/usr/bin/google-chrome HOME=/home/vp TZ=Australia/Brisbane '
                          'python3 tools/staging/real-venues-play.py plan-%s.json out-%s trivia > run-%s.log 2>&1; rm -f plan-%s.json; echo rc=$?'
                          % (remote, sub, sub, sub, sub)])
            d2 = os.path.join(dest, sub); os.makedirs(d2, exist_ok=True)
            R.sh(['rsync', '-az', '-e', 'ssh -i ' + R.KEY, '%s:%s/out-%s/' % (R.HOST, remote, sub), d2 + '/'])
            R.sh([sys.executable, os.path.join(HERE, 'real-venues-sheet.py'), d2])
    R.sh([sys.executable, os.path.join(HERE, 'real-venues-sheet.py'), dest])
    R.sh([sys.executable, os.path.join(HERE, 'real-venues-sheet.py'), '--day', root])
    say('sign-up contact sheet:', os.path.join(dest, 'index.html'))


if __name__ == '__main__':
    if sys.argv[1:2] == ['--drive']:
        drive(sys.argv[2])
    else:
        mac()
