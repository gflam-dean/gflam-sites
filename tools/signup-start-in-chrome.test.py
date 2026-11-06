#!/usr/bin/env python3
"""THE NO-CARD START ON /offer-nov, PLAYED IN CHROME AS A BRAND-NEW VENUE (Dean, 5 Nov 2026; INBOX 80B, 81, 93, 96, 97).

Opens the REAL nsw.html at /offer-nov with the REAL billing Worker behind it (tools/browser-rig/admin_site.py, jsc;
the SMS hook, Stripe, Resend and the database are the rig's fakes), at phone and laptop width, and plays it:

  1. the hero's first button reads "Have a play for free" and goes to the five boxes (#start);
  2. AUTOFILL (INBOX 93): the boxes are a real <form>, each with name= and autocomplete= (organization,
     postal-code, name, tel, email), the code form is a real <form> whose first box is autocomplete one-time-code,
     both submit with a real submit button; the six code boxes sit apart, on one row, inside the screen;
  3. no terms tick box, the line "By starting you agree to the Terms and Conditions and Privacy Policy";
  4. a venue on our licensed list: the code from the text, typed into the boxes, makes the account, and the done
     screen reads Dean's words exactly, with the venue's TV code and the try-it demo slot (JOB B1) under it;
  5. a fake name: "Thanks, we'll check your venue and get you set up, usually within a business day.", nothing
     made; HQ > Prospects lists it under Sign-ups to check and Approve makes the account;
  6. not switched on (no SMS settings): the boxes hand over to the Talk to us form, filled in, as Friday's stopgap;
  7. nothing reached Stripe and no game session was opened.

    python3 tools/signup-start-in-chrome.test.py [--root CHECKOUT] [--shots DIR]
"""
import argparse, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=ROOT)
ap.add_argument('--shots', default='')
A = ap.parse_args()

PASS, FAIL = [0], [0]
HELD = "Thanks, we'll check your venue and get you set up, usually within a business day."   # Dean's words, as the Worker says them
DONE = ['Your trivia night is ready.', 'Your venue is set up with sample nights to try it.', 'Your first month starts now.']


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:700],)) if detail != '' else ''))


FORMS = r'''(function(){
  function f(id){var e=document.getElementById(id);return e?{form:!!e.closest("form")&&e.closest("form").id,name:e.getAttribute("name")||"",ac:e.getAttribute("autocomplete")||"",type:e.type,im:e.getAttribute("inputmode")||""}:null;}
  var go=document.getElementById("st-go"),ck=document.getElementById("st-check"),sf=document.getElementById("st-form"),cf=document.getElementById("st-code");
  return {five:["st-venue","st-postcode","st-name","st-mobile","st-email"].map(f),code:[1,2,3,4,5,6].map(function(i){return f("st-c"+i);}),
    goSubmit:!!go&&go.type==="submit"&&go.form===sf,go:go?go.textContent.trim():"",ckSubmit:!!ck&&ck.type==="submit"&&ck.form===cf,
    sfTag:sf?sf.tagName:"",cfTag:cf?cf.tagName:"",legal:(document.querySelector("#st-form .st-legal")||{}).textContent||"",
    ticks:document.querySelectorAll("#st-form input[type=checkbox]").length,
    labels:[].map.call(document.querySelectorAll("#st-form label"),function(l){return l.textContent.replace(/\s+/g," ").trim();})};})()'''
HERO = ('(function(){var a=[].map.call(document.querySelectorAll("#top .hero-cta a"),function(x){return {t:x.textContent.trim(),href:x.getAttribute("href")};});'
        'return a;})()')


def fill(sid, venue, postcode, name, mobile, email, kind='pub'):
    S.js(sid, '(function(){function v(i,x){var e=document.getElementById(i);e.value=x;e.dispatchEvent(new Event("input",{bubbles:true}));}'
              'v("st-venue",%r);v("st-postcode",%r);v("st-name",%r);v("st-mobile",%r);v("st-email",%r);'
              '%s'
              'document.getElementById("st-go").click();return true;})()' % (venue, postcode, name, mobile, email,
                  ('document.getElementById("st-kind-%s").click();' % kind) if kind else ''))


def type_code(sid, code, paste=False):
    if paste:   # autofill from the text puts the whole code in the first box
        S.js(sid, '(function(){var e=document.getElementById("st-c1");e.focus();e.value=%r;e.dispatchEvent(new Event("input",{bubbles:true}));return true;})()' % code)
        return
    for i, d in enumerate(code):
        S.js(sid, '(function(){var e=document.activeElement&&document.activeElement.id&&document.activeElement.id.indexOf("st-c")===0?document.activeElement:document.getElementById("st-c%d");'
                  'e.value=%r;e.dispatchEvent(new Event("input",{bubbles:true}));return true;})()' % (i + 1, d))
        time.sleep(0.05)


def last_code(mobile):
    t = [x for x in S.W._send({'ask': 'texts'})['body'] if (x.get('user') or {}).get('phone') == mobile]
    return t[-1]['sms']['otp'] if t else None


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name))


S = admin_site.Site(root=A.root, fonts=bool(A.shots))
try:
    S.W.env(SEND_SMS_HOOK_URL='https://sms-hook.rig/', SEND_SMS_HOOK_SECRET='dGVzdC1zZWNyZXQtb25seQ==')
    S.W.seed('vp_licensed_venues', [
        {'id': 1, 'name': 'Kirra Beach Hotel', 'name_key': 'kirra-beach-hotel', 'postcode': '4225', 'suburb': 'Kirra', 'au_state': 'QLD', 'source': 'venue master list'},
        {'id': 2, 'name': 'The Railway Hotel', 'name_key': 'railway-hotel', 'postcode': '2000', 'suburb': 'Sydney', 'au_state': 'NSW', 'source': 'send list'}])
    for t in ('vp_signup_starts', 'vp_prospects', 'vp_help_tickets', 'vp_sessions', 'vp_prospect_welcomes', 'auth'):
        S.W.seed(t, [])
    S.W.seed('vp_platform_admins', [{'auth_user_id': S.W.info['uid'], 'role': 'owner', 'label': 'Dean'}])

    print('THE ADDRESS IS THE REAL ONE')
    ok('/offer-nov is served from nsw.html', S.rewrites().get('/offer-nov') == '/nsw', S.rewrites().get('/offer-nov'))

    for w, h, mobile, n, VEN, PC, ST in ((390, 844, True, 1, 'Kirra Beach Hotel', '4225', 'QLD'), (1280, 900, False, 2, 'The Railway Hotel', '2000', 'NSW')):
        where = '%dpx' % w
        print('\n/offer-nov AT %s: A BRAND-NEW VENUE ON OUR LICENSED LIST' % where)
        tid, sid = S.open('/offer-nov', w, h, mobile=mobile)
        S.until(sid, '!!window.VPStart && !!document.getElementById("st-go")', 20)
        b = S.json(sid, HERO, [])
        ok('%s: the hero\'s first button is "Have a play for free" and goes to the five boxes' % where,
           len(b) >= 2 and b[0]['t'] == 'Have a play for free' and b[0]['href'] == '#start', b[:2])
        f = S.json(sid, FORMS, {})
        five = f.get('five') or []
        ok('%s: AUTOFILL: the five boxes are one real form, each with its name= and autocomplete= word' % where,
           f.get('sfTag') == 'FORM' and [(x or {}).get('form') for x in five] == ['st-form'] * 5 and
           [((x or {}).get('name'), (x or {}).get('ac')) for x in five] == [('organization', 'organization'), ('postal-code', 'postal-code'), ('name', 'name'), ('tel', 'tel'), ('email', 'email')]
           and five[3]['type'] == 'tel' and five[4]['type'] == 'email' and five[1]['im'] == 'numeric', five)
        code = f.get('code') or []
        ok('%s: AUTOFILL: the code is a real form; its first box is one-time-code (the iPhone offers the code from the text)' % where,
           f.get('cfTag') == 'FORM' and all((x or {}).get('form') == 'st-code' for x in code) and code and code[0]['ac'] == 'one-time-code'
           and code[0]['name'] == 'one-time-code' and all(x['im'] == 'numeric' for x in code), code)
        ok('%s: both buttons are real submit buttons (a tap and the keyboard\'s Go both work); the start reads "Have a play for free"' % where,
           f.get('goSubmit') and f.get('ckSubmit') and f.get('go') == 'Have a play for free', f)
        ok('%s: no terms tick box, the line instead, word for word' % where,
           f.get('ticks') == 0 and re.sub(r'\s+', ' ', f.get('legal', '')).strip() == 'By starting you agree to the Terms and Conditions and Privacy Policy.', f.get('legal'))
        ok('%s: Email is labelled just "Email" with the helper "Your account emails come here"' % where,
           'Email Your account emails come here' in (f.get('labels') or []), f.get('labels'))
        k = S.json(sid, '(function(){var r=[].map.call(document.querySelectorAll("#st-form input[name=venue-kind]"),function(e){var b=e.parentNode.getBoundingClientRect();'
                        'return {v:e.value,c:e.checked,req:e.required,f:e.form&&e.form.id,t:e.parentNode.textContent.trim(),h:Math.round(b.height),l:Math.round(b.left),r:Math.round(b.right)};});'
                        'return {r:r,vw:document.documentElement.clientWidth,lbl:(document.getElementById("st-kind-lbl")||{}).textContent};})()', {})
        kr = k.get('r') or []
        ok('%s: PUB OR CLUB: one honest two-way choice in the form, nothing preselected, required, at least 44px tall, inside the screen' % where,
           [x['v'] for x in kr] == ['pub', 'club'] and [x['t'] for x in kr] == ['Pub', 'Club'] and not any(x['c'] for x in kr) and kr[0]['req']
           and all(x['f'] == 'st-form' and x['h'] >= 44 and x['l'] >= 0 and x['r'] <= k.get('vw', 0) for x in kr) and k.get('lbl') == 'Is it a pub or a club?', k)
        S.js(sid, '(function(){function v(i,x){document.getElementById(i).value=x;}v("st-venue","X Hotel");v("st-postcode","4225");v("st-name","N");v("st-mobile","0412 000 000");v("st-email","n@x.example");document.getElementById("st-go").click();return true;})()')
        nk = S.until(sid, 'document.getElementById("st-err").textContent', 5)
        ok('%s: pressing on without choosing says "Choose pub or club." and sends nothing' % where, nk == 'Choose pub or club.' and not [c for c in S.W.calls if c[0] == '/start/begin' and (c[1] or {}).get('venue') == 'X Hotel'], nk)
        S.js(sid, 'document.querySelector("#top .hero-cta a").click(); true')
        before = len(S.W.table('venueplay_founding'))
        mob = '0412 555 00%d' % n
        e164 = '+6141255500%d' % n
        fill(sid, VEN, PC, 'Kim Offer', mob, 'kim%d@venue%d.com.au' % (n, n), kind=('pub' if n == 1 else 'club'))
        S.until(sid, '!document.getElementById("st-code").hidden', 15)
        shot(sid, 'start-code-%s.png' % where)
        end = S.js(sid, 'document.getElementById("st-end").textContent')
        ok('%s: the code screen says the mobile it went to (the last three digits)' % where, end == mob.replace(' ', '')[-3:], end)
        lay = S.json(sid, '(function(){var r=[].map.call(document.querySelectorAll(".st-boxes input"),function(e){var b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.right),Math.round(b.top),Math.round(b.height)];});return {r:r,vw:document.documentElement.clientWidth};})()', {})
        r = lay.get('r') or []
        ok('%s: six code boxes on one row, spaced at least 8px apart, at least 52px tall, inside the screen' % where,
           len(r) == 6 and len(set(x[2] for x in r)) == 1 and all(r[i + 1][0] - r[i][1] >= 8 for i in range(5)) and all(x[3] >= 52 for x in r)
           and r[0][0] >= 0 and r[-1][1] <= lay.get('vw', 0), lay)
        c = last_code(e164)
        ok('%s: the code was texted to their mobile through the SMS hook, and nothing is made before it is typed' % where,
           bool(c) and len(S.W.table('venueplay_founding')) == before, (c, len(S.W.table('venueplay_founding')) - before))
        type_code(sid, c, paste=(n == 2))
        S.until(sid, '!document.getElementById("st-done").hidden', 20)
        shot(sid, 'start-done-%s.png' % where)
        d = S.json(sid, '(function(){var e=document.getElementById("st-done");return {lines:[].map.call(e.querySelectorAll(":scope > .st-h, :scope > .st-p"),function(x){return x.textContent.trim();}),'
                        'tv:document.getElementById("st-tvline").textContent.replace(/\\s+/g," ").trim(),code:document.getElementById("st-tvcode").textContent.trim(),'
                        'slot:!!document.getElementById("st-try-slot"),slotAfterTv:!!(document.getElementById("st-tvline").compareDocumentPosition(document.getElementById("st-try-slot"))&4),'
                        'open:document.getElementById("st-open").getAttribute("href")};})()', {})
        ok('%s: %s' % (where, 'typed one by one, the code makes the account' if n == 1 else 'filled in one go (autofill), the code makes the account'),
           len(S.W.table('venueplay_founding')) == before + 1, len(S.W.table('venueplay_founding')) - before)
        ok('%s: the done screen reads Dean\'s three lines, word for word' % where, d.get('lines') == DONE, d.get('lines'))
        ok('%s: then "To see it on your TV, go to venueplay.com.au/tv and type this code: <their code>", just the code' % where,
           bool(d.get('code')) and d.get('tv') == 'To see it on your TV, go to venueplay.com.au/tv and type this code: ' + d.get('code'), d)
        ok('%s: the try-it demo slot is under it (JOB B1), and the console button signs them in' % where,
           d.get('slot') and d.get('slotAfterTv') and '/app/go' in (d.get('open') or ''), d)
        S.close_tab(tid)

    print('\nTHE ACCOUNT IS THE PROSPECT ACCOUNT, AND NOTHING IS BILLED')
    made = [v for v in S.W.table('vp_venues') if (v.get('name'), v.get('postcode')) in (('Kirra Beach Hotel', '4225'), ('The Railway Hotel', '2000'))]
    ok('two venues made, each at 10 players, the state from the postcode, and pub or club as they chose (Kirra a pub, the Railway a club)',
       len(made) == 2 and all(v.get('max_players') == 10 for v in made) and sorted((v.get('au_state'), v.get('entity_type')) for v in made) == [('NSW', 'non_profit'), ('QLD', 'for_profit')],
       [(v.get('max_players'), v.get('au_state'), v.get('entity_type')) for v in made])
    ok('Stripe was never called, and no game session was opened', not S.W.stripe() and not S.W.table('vp_sessions'), (S.W.stripe(), S.W.table('vp_sessions')))
    ok('HQ > Prospects will list them as self sign-ups', sum(1 for p in S.W.table('vp_prospects') if p.get('source') == 'self') == 2,
       [p.get('source') for p in S.W.table('vp_prospects')])

    print('\nA FAKE NAME WITH A REAL POSTCODE: MADE STRAIGHT AWAY, FLAGGED FOR HQ (Dean, 6 Nov 2026)')
    tid, sid = S.open('/offer-nov', 390, 844, mobile=True)
    S.until(sid, '!!window.VPStart && !!document.getElementById("st-go")', 20)
    nf = len(S.W.table('venueplay_founding'))
    fill(sid, 'Totally Made Up Tavern', '4225', 'Pat Faker', '0412 555 009', 'pat@madeup.example')
    S.until(sid, '!document.getElementById("st-code").hidden', 15)
    type_code(sid, last_code('+61412555009'))
    S.until(sid, '!document.getElementById("st-done").hidden', 20)
    ok('the account is made straight away and the done screen shows', len(S.W.table('venueplay_founding')) == nf + 1 and
       S.json(sid, '[].map.call(document.querySelectorAll("#st-done > .st-h,#st-done > .st-p"),function(x){return x.textContent.trim();})', []) == DONE)
    S.close_tab(tid)

    print('\nA MOBILE ALREADY ON VENUEPLAY, WITH A NEW EMAIL: HELD, DEAN\'S WORDS')
    tid, sid = S.open('/offer-nov', 390, 844, mobile=True)
    S.until(sid, '!!window.VPStart && !!document.getElementById("st-go")', 20)
    nf = len(S.W.table('venueplay_founding'))
    fill(sid, 'Second Venue Hotel', '4225', 'Pat Faker', '0412 555 009', 'pat.second@madeup.example', kind='club')
    S.until(sid, '!document.getElementById("st-code").hidden', 15)
    type_code(sid, last_code('+61412555009'))
    S.until(sid, '!document.getElementById("st-held").hidden', 20)
    shot(sid, 'start-held-390px.png')
    words = S.js(sid, 'document.getElementById("st-held-words").textContent.trim()')
    ok('the page says Dean\'s words, word for word', words == HELD, words)
    ok('no account and no free month were made', len(S.W.table('venueplay_founding')) == nf, len(S.W.table('venueplay_founding')) - nf)
    S.close_tab(tid)

    print('\nHQ > PROSPECTS: SIGN-UPS TO CHECK, ONE TAP EACH')
    tid, sid = S.B.open_tab('about:blank')
    S.B.call('Page.enable', {}, session=sid)
    S.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.VP_PROSPECTS_API="/__api";'}, session=sid)
    S.B.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
    S.B.call('Page.navigate', {'url': S.base + '/app/hq.html?as=admin'}, session=sid)
    S.until(sid, '!!document.querySelector("#prTab:not([hidden])")', 25)
    S.js(sid, 'document.getElementById("prTab").click(); true')
    S.until(sid, '!!document.querySelector("#prHeld [data-st-approve]") && !!document.querySelector("#prHeld [data-st-checked]")', 20)
    shot(sid, 'hq-signups-to-check.png')
    row = S.js(sid, 'document.getElementById("prHeld").textContent.replace(/\\s+/g," ")') or ''
    ok('the made account not on our list is there, saying so, with a Checked button', 'Totally Made Up Tavern' in row and 'Not on our licensed venues list, check' in row, row[:400])
    ok('the held one is there with what they typed and why', 'Second Venue Hotel' in row and 'pat.second@madeup.example' in row and 'Already on venueplay' in row, row[:400])
    S.js(sid, 'document.querySelector("#prHeld [data-st-checked]").click(); true')
    S.until(sid, '!document.querySelector("#prHeld [data-st-checked]")', 20)
    ok('Checked takes the made one off the list and makes nothing', 'Totally Made Up Tavern' not in (S.js(sid, 'document.getElementById("prBody").textContent') or '').split('Prospects')[0]
       and len(S.W.table('venueplay_founding')) == nf, len(S.W.table('venueplay_founding')) - nf)
    S.js(sid, 'document.querySelector("#prHeld [data-st-approve]").click(); true')
    S.until(sid, '!document.querySelector("#prHeld [data-st-approve]")', 20)
    hv = [v for v in S.W.table('vp_venues') if v.get('name') == 'Second Venue Hotel']
    ok('Approve makes the normal account, as the club they chose, and the row goes', len(S.W.table('venueplay_founding')) == nf + 1 and
       len(hv) == 1 and hv[0].get('entity_type') == 'non_profit', [(v.get('name'), v.get('entity_type')) for v in hv])
    ok('and the welcome is sent to them', any('pat.second@madeup.example' in str(m.get('to')) for m in S.W.sent()), [m.get('to') for m in S.W.sent()][-3:])
    S.close_tab(tid)

    print('\nNOT SWITCHED ON YET: THE BOXES HAND OVER TO TALK TO US (FRIDAY\'S STOPGAP)')
    S.W.env(SEND_SMS_HOOK_URL='')
    tid, sid = S.open('/offer-nov', 390, 844, mobile=True)
    S.until(sid, '!!window.VPStart && !!document.getElementById("st-go")', 20)
    fill(sid, 'Lennox Hotel', '2478', 'Lee Off', '0412 555 010', 'lee@lennox.example')
    S.until(sid, '!document.getElementById("ct-topic").hidden', 15)
    ct = S.json(sid, '(function(){function v(i){return document.getElementById(i).value;}return {n:v("ct-name"),e:v("ct-email"),v:v("ct-venue"),p:v("ct-postcode"),ph:v("ct-phone"),m:v("ct-message")};})()', {})
    ok('the Talk to us form is set to "Set me up a free account", filled with what they typed', ct.get('n') == 'Lee Off' and ct.get('e') == 'lee@lennox.example'
       and ct.get('v') == 'Lennox Hotel' and ct.get('p') == '2478' and ct.get('ph') == '0412 555 010' and (ct.get('m') or '').startswith('Set me up a free account'), ct)
    errs = S.js(sid, 'window.__errs') or []
    ok('no script errors on the page', not errs, errs)
    S.close_tab(tid)
finally:
    S.close()

print('\nTHE WORDS KEEP THE HOUSE RULES')
js = open(os.path.join(A.root, 'venueplay', 'app', 'vp-start.js'), encoding='utf-8').read()
page = open(os.path.join(A.root, 'venueplay', 'nsw.html'), encoding='utf-8').read()
blk = page[page.find('<section class="sec" id="start">'):page.find('<!-- ===================== GAME MODES')]
ok('no em or en dash and no capitalised VenuePlay in the start form or its script', blk and not re.search('[—–]|VenuePlay', blk + js), re.findall('.{20}(?:[—–]|VenuePlay).{20}', blk + js)[:3])
home = open(os.path.join(A.root, 'venueplay', 'index.html'), encoding='utf-8').read()
ok('the home page has no start form (no offers on the home page)', 'id="st-form"' not in home and 'vp-start.js' not in home)

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 46
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
