#!/usr/bin/env python3
"""THE ACCOUNT PAGE'S BILLING WORDS, IN A REAL BROWSER (Dean, 30 Oct 2026).

Dean: tax invoices are issued by Stripe and the name a venue deals with is VenuePlay. Never "Gflam
Group" on anything a venue sees, and never "founding". (Our paid-invoice email delivers Stripe's
tax invoice and says "Tax invoice"; this page hands the invoices over behind "Open".) The emails are run by
tools/test-receipts-plain-words.js; this is the page: venueplay/app/billing.html (Your account >
Billing), served by tools/browser-rig/admin_site.py with the REAL billing Worker behind it in jsc.

The plan tile, the next payment, the past-due notice and the invoices card all come from one
/account/summary answer, so each state a venue can be in is the Worker's own answer with the state
laid over it (tier, plan, comp, past due), and the page is read as a venue reads it: the text the
browser actually painted (innerText), at desktop and at phone width.

    python3 tools/billing-words-in-chrome.test.py          screenshots go to $VP_SHOTS if set
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

# Lay a state over the Worker's own /account/summary answer, before the page's scripts run.
OVERLAY = r'''(function(st){var F=window.fetch;window.fetch=function(u,o){var p=F.apply(this,arguments);
  if(String(u).indexOf("/account/summary")<0) return p;
  return p.then(function(r){return r.clone().json().then(function(d){
    if(d&&!d.error){ for(var k in st) d[k]=st[k]; window.__summary=d; }
    return new Response(JSON.stringify(d),{status:r.status,headers:{"Content-Type":"application/json"}});
  },function(){return r;});});};})(%s);'''

BILLING_UP = 'document.getElementById("content").style.display!=="none" && !!document.getElementById("s-plan") && document.getElementById("s-plan").textContent!=="–"'
READ = ('JSON.stringify({all:document.getElementById("content").innerText, title:document.title,'
        'plan:document.getElementById("s-plan").textContent, sub:document.getElementById("s-plan-sub").textContent,'
        'pd:(document.getElementById("pastDue").style.display!=="none")?document.getElementById("pastDueText").textContent:"",'
        'sum:!!window.__summary})')

STATES = [
    ('a venue on the offer, monthly', {'tier': 'founding', 'plan': 'monthly', 'rate': 2.5, 'comp': False, 'past_due': False},
     'Monthly', '$2.50 per player · offer rate'),
    ('a venue on the offer, yearly', {'tier': 'founding', 'plan': 'annual', 'rate': 2.0, 'comp': False, 'past_due': False},
     'Yearly', '$2.00 per player · offer rate'),
    ('a venue on the standard rate', {'tier': 'standard', 'plan': 'monthly', 'rate': 3.0, 'comp': False, 'past_due': False},
     'Monthly', '$3.00 per player'),
    ('an account that is on us', {'tier': 'founding', 'plan': 'monthly', 'comp': True, 'past_due': False},
     'On us', 'nothing to pay'),
    ('a card that did not go through', {'tier': 'founding', 'plan': 'monthly', 'rate': 2.5, 'comp': False, 'past_due': True,
                                         'failed_payment': {'date': '24 October 2026', 'amount': '$100.00', 'pay_url': 'https://invoice.stripe.com/i/acct_x/test_1'}},
     'Monthly', '$2.50 per player · offer rate'),
]


def main():
    S = admin_site.Site()
    try:
        for (name, st, plan, sub) in STATES:
            for (w, h, mob) in ((1100, 1000, False), (390, 844, True)):
                where = '%s, %d wide' % (name, w)
                tid, sid = S.open('/app/billing.html', w, h, mob, pre=OVERLAY % json.dumps(st))
                up = S.until(sid, BILLING_UP, 30)
                d = {}
                try: d = json.loads(S.js(sid, READ) or '{}')
                except Exception: pass
                ok('%s: CONTROL: the Billing tab is up, from the Worker\'s own answer with the state laid over it' % where, up is True and d.get('sum') is True,
                   [up, S.js(sid, 'document.getElementById("loading").textContent')])
                text = d.get('all', '') + ' ' + d.get('title', '')
                ok('%s: never "founding"' % where, not re.search(r'founding', text, re.I), re.findall(r'.{0,40}founding.{0,40}', text, re.I)[:2])
                ok('%s: never Gflam' % where, not re.search(r'gflam', text, re.I), re.findall(r'.{0,40}gflam.{0,40}', text, re.I)[:2])
                # "Tax invoice" is right where we deliver Stripe's (Dean, 31 Oct 2026), so it is not banned here:
                # the page's job is to hand over Stripe's invoices, by name, behind "Open".
                ok('%s: the invoices card hands over Stripe\'s invoices: "View or download every invoice"' % where,
                   'View or download every invoice, or update the card we bill.' in text or (st.get('comp') and 'Your invoices' not in text), re.findall(r'.{0,60}invoice.{0,60}', text, re.I)[:3])
                ok('%s: the plan tile reads "%s", "%s"' % (where, plan, sub), d.get('plan') == plan and d.get('sub') == sub, [d.get('plan'), d.get('sub')])
                if st.get('past_due'):
                    ok('%s: the notice names the date and amount, in plain words' % where,
                       d.get('pd', '').startswith('Your payment on 24 October 2026 of $100.00 did not go through.'), d.get('pd'))
                if SHOTS: S.shot(sid, os.path.join(SHOTS, 'billing-%s-%d.png' % (re.sub(r'\W+', '-', name), w)), True)
                ok('%s: no script errors' % where, S.js(sid, '(window.__errs||[]).length') == 0, S.js(sid, 'JSON.stringify(window.__errs||[])'))
                S.close_tab(tid)
    finally:
        S.close()


try:
    main()
except Exception:
    import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
