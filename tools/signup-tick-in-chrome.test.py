#!/usr/bin/env python3
"""THE SIGNUP TICK, END TO END: THE PAGE IN CHROME, THE REAL /checkout, THE REAL PROVISIONING, HQ.

Until this release a single-venue signup never recorded the tick (the Terms and Privacy Policy, and
"our venue is responsible for its gaming compliance"): it was checked only in the browser, and the
single-venue provisioning path wrote nothing, so every self-serve venue read "NOT accepted" in HQ
(audit 20 Oct 2026, C5). Now the page sends it, /checkout refuses without it and stamps WHEN it was
given on the lead, provisioning records it on the venue from that fact, and HQ shows who and when.

This opens the REAL signup pages (venueplay/index.html and the offer page venueplay/nsw.html) in
headless Chrome (tools/browser-rig/admin_site.py) with the REAL billing Worker behind them in jsc
(only Stripe, Resend and the database are fakes), provisions the lead through the REAL
vpaProvisionFromCheckout as the Stripe webhook does, then opens HQ on that database.

    python3 tools/signup-tick-in-chrome.test.py [--shots DIR] [--root CHECKOUT]
"""
import argparse, json, os, sys, time

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
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


# The page's own fetch goes to the real Worker. Only the redirect to Stripe afterwards is kept on this
# page (the answer's url becomes a hash), so the test can read what happened.
KEEP = ('(function(){ window.__checkout=[]; var real=window.fetch; window.fetch=function(u,o){'
        ' if(!/\\/checkout$/.test(String(u))) return real.apply(this, arguments);'
        ' var sent=null; try{ sent=JSON.parse(o.body); }catch(e){}'
        ' return real.apply(this, arguments).then(function(r){ return r.json().then(function(j){'
        '   window.__checkout.push({ sent:sent, status:r.status, body:j });'
        '   if(j && j.url) j.url="#went-to-stripe"; if(j) delete j.client_secret;'
        '   return new Response(JSON.stringify(j), { status:r.status, headers:{ "Content-Type":"application/json" } }); }); }); };'
        ' return true; })()')


def shot(S, sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'))


def fill(S, sid, offer, who, email, venue, postcode, entity, tick):
    S.js(sid, ('(function(o){var $=function(i){return document.getElementById(i)};'
               'var r=document.querySelector("#vp-venue-list .venue-row");r.querySelector(".v-name").value=o.venue;r.querySelector(".v-seats").value="80";'
               'var p=r.querySelector(".v-postcode");p.value=o.postcode;p.dispatchEvent(new Event("input",{bubbles:true}));'
               'if(o.offer){var e=$("vp-entity");e.value=o.entity;e.dispatchEvent(new Event("change",{bubbles:true}));}'
               'else document.querySelector(\'#vp-entity-seg [data-entity="\'+o.entity+\'"]\').click();'
               '$("vp-name").value=o.who;$("vp-email").value=o.email;$("vp-mobile").value="0412 345 678";$("vp-consent").checked=o.tick;'
               'return true;})(%s)') % json.dumps({'offer': offer, 'who': who, 'email': email, 'venue': venue, 'postcode': postcode,
                                                   'entity': entity, 'tick': tick}))
    time.sleep(0.3)


def leads(S):
    return S.W.table('venueplay_founding')


S = admin_site.Site(root=A.root, fonts=bool(A.shots), live_tables=['vp_venues'])
try:
    for page, offer in (('/index.html', False), ('/nsw', True)):
        label = 'the offer page' if offer else 'the signup page'
        print('%s (%s)' % (label, page))
        tid, sid = S.open(page, width=1280, height=1000)
        S.until(sid, '!!document.querySelector("#vp-venue-list .v-postcode") && !!document.getElementById("vp-consent")', 20)
        time.sleep(0.8)
        S.js(sid, KEEP)
        before = len(leads(S))
        venue = 'Kirra Hotel' if not offer else 'Coogee Bowls Club'
        fill(S, sid, offer, 'Sam Signup', 'sam@kirrahotel.com.au' if not offer else 'sam@coogeebowls.com.au',
             venue, '4225' if not offer else '2034', 'for_profit' if not offer else 'non_profit', False)
        S.js(sid, 'document.getElementById("vp-submit").click(); true')
        S.until(sid, 'document.getElementById("vp-err").classList.contains("show")', 5)
        err = S.js(sid, 'document.getElementById("vp-err").offsetParent!==null ? document.getElementById("vp-err").textContent : ""') or ''
        ok('%s: unticked, the page says what the tick confirms, in sight' % label,
           'Terms and Privacy Policy' in err and 'gaming compliance' in err, err)
        time.sleep(0.5)
        ok('%s: ...and nothing is sent: no lead saved, Stripe never asked' % label,
           S.js(sid, 'window.__checkout.length') == 0 and len(leads(S)) == before, (S.js(sid, 'JSON.stringify(window.__checkout)'), len(leads(S))))
        if not offer:
            S.js(sid, 'document.getElementById("vp-err").scrollIntoView({block:"center",behavior:"instant"}); true')
            shot(S, sid, 'signup-without-the-tick')
        # A page that skips its own check (an old tab, a script): the Worker refuses on its own.
        direct = S.js(sid, ('fetch("/__api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify('
                            '{name:"Sam Signup",email:"sneaky@kirrahotel.com.au",mobile:"0412 345 678",postcode:"4225",plan:"monthly",'
                            'venues:[{name:"Sneaky Hotel",seats:80,postcode:"4225",entity_type:"for_profit"}]})})'
                            '.then(function(r){return r.json().then(function(j){return JSON.stringify({s:r.status,e:j.error||""});});})'), wait=True)
        d = json.loads(direct) if isinstance(direct, str) else {}
        ok('%s: a request without the tick is refused by the Worker itself (400), and saves nothing' % label,
           d.get('s') == 400 and 'gaming compliance' in d.get('e', '') and len(leads(S)) == before, (d, len(leads(S))))
        S.js(sid, 'document.getElementById("vp-consent").checked=true; document.getElementById("vp-submit").click(); true')
        S.until(sid, 'window.__checkout.length===1', 15)
        got = S.js(sid, 'JSON.stringify(window.__checkout[0]||null)')
        c = json.loads(got) if isinstance(got, str) else None
        ok('%s: ticked, the request carries compliance_accepted: true and the real /checkout goes ahead' % label,
           bool(c) and c['sent'].get('compliance_accepted') is True and c['status'] == 200 and (c['body'] or {}).get('url'), c)
        lead = [l for l in leads(S) if l.get('venue_name') == venue]
        vj = (lead[0].get('venues_json') or [{}])[0] if lead else {}
        ok('%s: the lead carries WHEN the tick was given, on its venue' % label,
           bool(lead) and isinstance(vj.get('compliance_accepted_at'), str) and len(vj.get('compliance_accepted_at')) >= 20, vj)
        ok('%s: no script error' % label, S.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', S.js(sid, 'JSON.stringify(window.__errs||[])'))
        S.close_tab(tid)

    print('\nthe Stripe webhook provisions the single-venue signup (the path that never recorded it)')
    made = {}
    for venue in ('Kirra Hotel', 'Coogee Bowls Club'):
        lead = [l for l in leads(S) if l.get('venue_name') == venue][0]
        r = S.W.provision({'id': 'cs_' + lead['id'][:8], 'client_reference_id': lead['id'], 'metadata': {'tier': 'founding', 'row_id': lead['id']},
                           'customer': 'cus_t', 'subscription': 'sub_t', 'created': int(time.time()),
                           'customer_details': {'name': 'Sam Signup', 'email': lead['contact_email']}})
        row = [v for v in S.W.table('vp_venues') if v.get('founding_id') == lead['id']]
        made[venue] = (lead, row[0] if row else {}, r)
    for venue, (lead, row, r) in made.items():
        ticked = ((lead.get('venues_json') or [{}])[0]).get('compliance_accepted_at')
        ok('%s: provisioned, and the venue records the tick: by Sam Signup, at the moment it was ticked' % venue,
           r.get('status') == 200 and row.get('compliance_accepted_by') == 'Sam Signup' and row.get('compliance_accepted_at') == ticked,
           (r, {k: row.get(k) for k in ('name', 'compliance_accepted_at', 'compliance_accepted_by', 'entity_type')}, ticked))
    old = {'id': 'f-old-lead', 'venue_name': 'The Unticked Inn', 'postcode': '2000', 'contact_email': 'olly@theuntickedinn.com.au',
           'contact_name': 'Olly Old', 'plan': 'monthly', 'status': 'pending', 'max_seats': 40, 'is_group': False,
           'venues_json': [{'name': 'The Unticked Inn', 'seats': 40, 'postcode': '2000', 'entity_type': 'for_profit'}]}
    S.W.seed('venueplay_founding', leads(S) + [old])
    S.W.provision({'id': 'cs_old', 'client_reference_id': old['id'], 'metadata': {'tier': 'founding', 'row_id': old['id']},
                   'customer': 'cus_o', 'subscription': 'sub_o', 'created': int(time.time())})
    orow = [v for v in S.W.table('vp_venues') if v.get('founding_id') == old['id']]
    ok('a lead saved before the tick was recorded is provisioned as NOT accepted, never assumed',
       bool(orow) and orow[0].get('compliance_accepted_at') is None and orow[0].get('compliance_accepted_by') is None, orow)

    print('\nHQ shows it on the venue')
    S.W.seed('vp_platform_admins', [{'auth_user_id': S.W.info['uid'], 'role': 'owner', 'label': 'Dean'}])
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1100)
    S.until(sid, 'document.querySelectorAll("button[data-details]").length > 0', 20)
    for venue in ('Kirra Hotel', 'The Unticked Inn'):
        vid = [v for v in S.W.table('vp_venues') if v.get('name') == venue][0]['id']
        S.js(sid, 'var b=document.querySelector(\'button[data-details="%s"]\'); if(b) b.click(); true' % vid)
        S.until(sid, '!!document.querySelector(\'[data-complianceout="%s"]\')' % vid, 10)
        txt = S.js(sid, '(function(){var o=document.querySelector(\'[data-complianceout="%s"]\'); var box=o?o.parentNode:null; return box?box.innerText.replace(/\\s+/g," "):"";})()' % vid) or ''
        if venue == 'Kirra Hotel':
            ok('Kirra Hotel: "compliance line accepted ... by Sam Signup", and its club-or-pub answer instead of a red "not asked"',
               'compliance line accepted' in txt and 'by Sam Signup' in txt and 'NOT accepted' not in txt and 'a pub' in txt and 'not asked' not in txt, txt)
            S.js(sid, 'document.querySelector(\'[data-complianceout="%s"]\').scrollIntoView({block:"center",behavior:"instant"}); true' % vid)
            time.sleep(0.4)
            shot(S, sid, 'hq-terms-accepted')
        else:
            ok('The Unticked Inn: HQ says NOT accepted and why, so someone asks them', 'NOT accepted: no record of the tick' in txt, txt)
    ok('no script error on HQ', S.js(sid, 'JSON.stringify(window.__errs||[])') == '[]', S.js(sid, 'JSON.stringify(window.__errs||[])'))
    S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
print('%d of %d checks passed' % (PASS[0], total))
EXPECTED = 19
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
sys.exit(1 if FAIL[0] else 0)
