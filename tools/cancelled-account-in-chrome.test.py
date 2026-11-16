#!/usr/bin/env python3
"""A CANCELLED VENUE'S ACCOUNT PAGE, IN A REAL BROWSER (Dean, 11 Nov 2026, INBOX 236, 237, 238, 240, 241.2).

Bodalla Pub cancelled its free month on 11 Nov (under the old code, which switched it off), and was switched back on
by hand: status active, cancelled_at 11 Nov 01:42Z kept, free month to 10 Dec, no card. Its Billing tab still offered
the plan, This month / Next month, "NEXT PAYMENT $25.00 per month when you add your card", the - / + buttons,
"Cancel this venue", "+ Add another venue" and "Email me before each payment".

The REAL billing.html with the REAL billing Worker in jsc behind it (tools/browser-rig/admin_site.py), the venue
seeded into the rig's fake database only (its row shape is Bodalla's, renamed Test Bravo; the years are 2099 so
nothing here depends on today's date). Nothing is sent anywhere.

  1. Cancelled, still on: ONE message above the tabs, "Cancelled on 11 November. Your free month runs until
     10 December, nothing to pay." with "Keep my free month going"; none of the billing rows or buttons above;
     the venue row names it, players read only. At 375 and 1440.
  2. "Keep my free month going" undoes it in the Worker and the normal Billing tab comes back.
  3. The same free month switched off: the left card says it was a free month ("You cancelled your free month"),
     never "subscription", and there is no "on hold for the moment" bar.
  4. A paid venue cancelled and off: "Your games are off", never "on hold for the moment".
  5. Every width: the sticky tab strip stops BELOW the header when the page scrolls (INBOX 238 layout bug).
  6. Left, on the Draws tab: "Download your members list (CSV)" makes members-list.csv with the header "Member number,
     First name,Surname" and this venue's members in member number order (12 Nov 2026, INBOX 278: it shipped asking
     vp_members for "number", the column is member_number, and errored for every left venue). vp_members and
     vp_member_rosters answer by the LIVE column list (COLUMNS-BASELINE.json, admin_site schema_tables), so a
     column the database does not have is refused here as it is live. At 375 and 1440.

    python3 tools/cancelled-account-in-chrome.test.py [--shots DIR]      pictures at 375 and 1440 when --shots is given
"""
import argparse, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
SHOTS = A.shots or os.environ.get('VP_SHOTS', '')
ran = bad = 0


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond:
        bad += 1


S = admin_site.Site(fonts=bool(SHOTS), live_tables=['vp_venues', 'vp_venue_staff'])
UID, V1 = S.W.info['uid'], S.W.info['venue']
BILLING_UP = 'document.getElementById("content").style.display!=="none" && document.getElementById("venues").children.length>0'
MSG = 'Cancelled on 11 November. Your free month runs until 10 December, nothing to pay.'

VENUE = {'id': V1, 'name': 'Test Bravo', 'slug': 'test-bravo', 'status': 'active', 'suspended_reason': None, 'closed_at': None,
         'join_code': 'BRV123', 'au_state': 'NSW', 'postcode': '2537', 'max_players': 10, 'included_players': None,
         'created_at': '2099-11-09T00:00:00Z', 'timezone': 'Australia/Sydney', 'founding_id': 'f1', 'cancel_at_period_end': False,
         'entity_type': 'for_profit', 'paid_entry_enabled': False, 'weekly_limit_off': False}
# Bodalla Pub's prospect row, the years moved to 2099: first sign-in 10 Nov, month to 11:59:59pm 10 Dec Brisbane,
# cancelled 11 Nov 11:42am Brisbane (01:42Z), not paused, no card.
PROSPECT = {'venue_id': V1, 'founding_id': 'f1', 'first_signin_at': '2099-11-10T03:00:00.000Z', 'free_month_ends_at': '2099-12-10T13:59:59.000Z',
            'paused_at': None, 'cancelled_at': '2099-11-11T01:42:00.000Z', 'offer_rate': 2.5, 'reminders_sent': [], 'card_choice': None}


def world(venue=None, prospect=None, founding=None, restart=True):
    S.W.env(VPB_SELF_RESTART='1' if restart else '')
    v = dict(VENUE); v.update(venue or {})
    S.W.seed('vp_venues', [v])
    S.W.seed('vp_venue_staff', [{'auth_user_id': UID, 'venue_id': V1, 'role': 'owner', 'display_name': 'Olive Owner'}])
    f = {'id': 'f1', 'venue_name': 'Test Bravo', 'contact_email': 'owner@test.local', 'contact_name': 'Olive Owner', 'plan': 'monthly',
         'status': 'pending', 'max_seats': 10, 'stripe_subscription_id': None, 'stripe_customer_id': None}
    f.update(founding or {})
    S.W.seed('venueplay_founding', [f])
    S.W.seed('vp_prospects', [dict(PROSPECT, **(prospect or {}))] if prospect is not False else [])


READ = r'''JSON.stringify((function(){
  function vis(e){ if(!e) return false; for(var x=e; x && x!==document.body; x=x.parentElement){ var s=getComputedStyle(x); if(s.display==="none"||x.hidden) return false; } return true; }
  var top=document.getElementById("cxTop"), lc=document.getElementById("leftCard"), bp=document.getElementById("tp-billing");
  return { top: vis(top) ? top.innerText.trim() : "", keep: vis(document.getElementById("cxKeep")),
    left: vis(lc) ? lc.innerText.trim() : "",
    summary: vis(document.querySelector("#tp-billing > .card")), portal: vis(document.getElementById("portalBtn")), next: vis(document.getElementById("s-next-amt")),
    add: vis(document.getElementById("addToggle")), reminders: vis(document.getElementById("reminders")),
    stepper: !![].filter.call(document.querySelectorAll("#venues .stepper"), vis).length,
    canx: !![].filter.call(document.querySelectorAll("#venues .canxlink"), vis).length,
    row: (document.querySelector("#venues .venue")||{}).innerText || "",
    billingText: vis(bp) ? bp.innerText : "", bar: !!document.getElementById("vpSuspendBar"),
    all: document.body.innerText, wide: document.documentElement.scrollWidth > window.innerWidth,
    errs: (window.__errs||[]).length };
})())'''

STICK = r'''JSON.stringify((function(){
  var tabs=document.querySelector(".tabs"), h=document.querySelector("header");
  /* a long tab, the way a venue with many slides has one: sticky only holds inside #content */ var sp=document.createElement("div"); sp.style.height="3000px"; document.getElementById("content").appendChild(sp); window.scrollTo(0, 1500);
  var t=tabs.getBoundingClientRect(), hb=h.getBoundingClientRect();
  /* what is painted just under the header's bottom edge at the strip's centre: the strip, not the page */
  var x=Math.round(t.left+t.width/2), atTop=document.elementFromPoint(x, Math.round(hb.bottom)-2);
  return { tabTop: Math.round(t.top), hdrBottom: Math.round(hb.bottom), inHeader: !!(atTop && h.contains(atTop)), y: window.scrollY };
})())'''


def opened(w, h, mobile):
    tid, sid = S.open('/app/billing.html', w, h, mobile)
    up = S.until(sid, BILLING_UP, 25)
    S.settled(sid, 'document.getElementById("venues").innerText', 10)
    return tid, sid, up


try:
    print('\n1. Cancelled in its free month, still on (Bodalla Pub\'s row)')
    world()
    for (w, h, mob) in ((375, 812, True), (1440, 900, False)):
        where = '%d wide' % w
        tid, sid, up = opened(w, h, mob)
        d = S.json(sid, READ, {})
        ok('%s: CONTROL: the Worker answered and the venue is listed' % where, up is True and 'Test Bravo' in d.get('row', ''), [up, d.get('row')])
        ok('%s: ONE message above the tabs, Dean\'s words with both dates' % where, d.get('top', '').startswith(MSG), d.get('top'))
        ok('%s: with "Keep my free month going"' % where, d.get('keep') is True and 'Keep my free month going' in d.get('top', ''), d.get('top'))
        ok('%s: no plan, This month / Next month or NEXT PAYMENT' % where, not d.get('summary') and not d.get('next') and 'Next payment' not in d.get('billingText', ''), [d.get('summary'), d.get('next')])
        ok('%s: no - / + buttons and no "Cancel this venue"' % where, not d.get('stepper') and not d.get('canx'), [d.get('stepper'), d.get('canx')])
        ok('%s: no "+ Add another venue" and no "Email me before each payment"' % where, not d.get('add') and not d.get('reminders'), [d.get('add'), d.get('reminders')])
        ok('%s: the venue row: cancelled on 11 November, 10 players, read only' % where, re.search(r'Cancelled on 11 November\s*.\s*10 players', d.get('row', '')) is not None, d.get('row'))
        ok('%s: never "subscription", "on hold" or "$25"' % where, not re.search(r'subscription|on hold|\$25', d.get('billingText', '') + d.get('top', ''), re.I), d.get('billingText', '')[:300])
        ok('%s: no dash, lowercase venueplay, fits, no script errors' % where, not re.search('[—–]', d.get('top', '') + d.get('row', '')) and 'VenuePlay' not in d.get('all', '')
           and not d.get('wide') and d.get('errs') == 0, [d.get('wide'), S.js(sid, 'JSON.stringify(window.__errs||[])')])
        if SHOTS:
            S.js(sid, 'window.scrollTo(0,0)')
            S.shot(sid, os.path.join(SHOTS, 'bodalla-billing-%d.png' % w), True)
        S.close_tab(tid)

    print('\n2. "Keep my free month going" carries the same month on')
    tid, sid, up = opened(1440, 900, False)
    S.js(sid, 'document.getElementById("cxKeep").click()')
    back = S.until(sid, 'document.getElementById("cxTop").hidden===true && !!document.querySelector("#venues .stepper")', 20)
    pr = [p for p in S.W.table('vp_prospects') if p['venue_id'] == V1][0]
    d = S.json(sid, READ, {})
    ok('the Worker undid the cancel, the end date unchanged', not pr.get('cancelled_at') and pr.get('free_month_ends_at') == PROSPECT['free_month_ends_at'], pr)
    ok('and the page is the normal Billing tab again (the plan, the stepper, Cancel this venue)', back is True and d.get('summary') and d.get('stepper') and d.get('canx') and not d.get('top'),
       [back, d.get('summary'), d.get('stepper'), d.get('canx'), d.get('top')])
    S.close_tab(tid)

    print('\n3. The same free month, switched off')
    world(venue={'status': 'suspended', 'suspended_reason': 'cancelled', 'closed_at': '2099-12-11T00:00:00Z'})
    for (w, h, mob) in ((375, 812, True), (1440, 900, False)):
        where = '%d wide' % w
        tid, sid = S.open('/app/billing.html', w, h, mob)
        S.until(sid, 'document.getElementById("leftCard").hidden===false', 25)
        S.settled(sid, 'document.getElementById("leftCard").innerText', 10)
        d = S.json(sid, READ, {})
        ok('%s: the left card says it was their free month, and nothing was charged' % where, d.get('left', '').startswith('You cancelled your free month, so your games are off') and
           'nothing was ever charged' in d.get('left', ''), d.get('left', '')[:300])
        ok('%s: never "subscription" or "on hold", no orange bar, no "still on" message' % where, not re.search(r'subscription|on hold', d.get('left', ''), re.I) and not d.get('bar') and not d.get('top'),
           [d.get('left', '')[:200], d.get('bar'), d.get('top')])
        ok('%s: no plan rows, no Cancel this venue, and no Invoices & card (no card, nothing to open)' % where, not d.get('summary') and not d.get('canx') and not d.get('portal'),
           [d.get('summary'), d.get('canx'), d.get('portal')])
        if SHOTS:
            S.js(sid, 'window.scrollTo(0,0)')
            S.shot(sid, os.path.join(SHOTS, 'free-month-off-billing-%d.png' % w), True)
        S.close_tab(tid)

    print('\n4. A paid venue, cancelled and off')
    world(venue={'status': 'suspended', 'suspended_reason': 'cancelled', 'closed_at': '2099-12-11T00:00:00Z', 'max_players': 40},
          prospect=False, founding={'status': 'card_on_file', 'stripe_subscription_id': 'sub_rig', 'stripe_customer_id': 'cus_rig'})
    tid, sid = S.open('/app/billing.html', 1440, 900, False)
    S.until(sid, 'document.getElementById("leftCard").hidden===false', 25)
    S.settled(sid, 'document.getElementById("leftCard").innerText', 10)
    d = S.json(sid, READ, {})
    ok('paid: "Your games are off", it was cancelled, nothing has been lost', d.get('left', '').startswith('Your games are off') and 'nothing has been lost' in d.get('left', '').lower()
       and 'free month' not in d.get('left', ''), d.get('left', '')[:300])
    ok('paid: never "on hold for the moment", no orange bar', 'on hold' not in d.get('all', '') and not d.get('bar'), d.get('bar'))
    if SHOTS:
        S.js(sid, 'window.scrollTo(0,0)')
        S.shot(sid, os.path.join(SHOTS, 'paid-off-billing-1440.png'), True)
    S.close_tab(tid)

    print('\n4b. A paid venue whose card failed and Stripe gave up (Thu 19 Nov): it has left, the 90-day date is shown')
    # The webhook (tools/test-failed-card-left.js) turns 'nonpayment' into 'ended' with closed_at when Stripe ends the
    # subscription. The restart switch is OFF, as it is live today.
    world(venue={'status': 'suspended', 'suspended_reason': 'ended', 'closed_at': '2099-12-11T00:00:00Z', 'max_players': 40},
          prospect=False, founding={'status': 'card_on_file', 'stripe_subscription_id': 'sub_rig', 'stripe_customer_id': 'cus_rig'}, restart=False)
    for (w, h, mob) in ((375, 812, True), (390, 844, True), (1440, 900, False)):
        where = '%d wide' % w
        tid, sid = S.open('/app/billing.html', w, h, mob)
        S.until(sid, 'document.getElementById("leftCard").hidden===false', 25)
        S.settled(sid, 'document.getElementById("leftCard").innerText', 10)
        d = S.json(sid, READ, {})
        ok('%s: the left card says the subscription has ended and when the player details go (11 March 2100), never "update your card"' % where,
           d.get('left', '').startswith('Your subscription has ended') and 'kept until 11 March 2100' in d.get('left', '') and 'update your card' not in d.get('left', '').lower(),
           d.get('left', '')[:400])
        ok('%s: Billing, Draws and Marketing only; no plan rows, no Cancel this venue, nothing wider than the screen' % where,
           not d.get('summary') and not d.get('canx') and not d.get('wide') and d.get('errs') == 0
           and S.js(sid, '[].filter.call(document.querySelectorAll(".tabs button"), function(b){return b.style.display!=="none";}).map(function(b){return b.getAttribute("data-tab");}).join(",")') == 'billing,draws,marketing',
           [d.get('summary'), d.get('canx'), d.get('wide'), d.get('errs')])
        if SHOTS:
            S.js(sid, 'window.scrollTo(0,0)')
            S.shot(sid, os.path.join(SHOTS, 'failed-card-ended-billing-%d.png' % w), True)
        S.close_tab(tid)

    print('\n5. The sticky tab strip stops below the header (every venue, every tab)')
    world(prospect=False, founding={'status': 'card_on_file', 'stripe_subscription_id': 'sub_rig', 'stripe_customer_id': 'cus_rig'})
    for (w, h, mob) in ((375, 812, True), (1440, 900, False)):
        for tab in ('billing', 'screen'):
            where = '%d wide, %s' % (w, tab)
            tid, sid, up = opened(w, h, mob)
            S.js(sid, 'document.querySelector(\'.tabs button[data-tab="%s"]\').click()' % tab)
            s = S.json(sid, STICK, {})
            ok('%s: scrolled, the strip sits below the header (strip top %s >= header bottom %s), nothing of it under the header' % (where, s.get('tabTop'), s.get('hdrBottom')),
               s.get('y', 0) > 0 and s.get('tabTop', -1) >= s.get('hdrBottom', 999) and s.get('inHeader') is True, s)
            if SHOTS and tab == 'billing':
                S.shot(sid, os.path.join(SHOTS, 'tabs-sticky-%d.png' % w), False)
            S.close_tab(tid)

    print('\n6. Left: the members list downloads as a CSV (real column names)')
    V9 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'
    S.schema_tables = ['vp_members', 'vp_member_rosters']
    S.extra_db = {
        'vp_member_rosters': [{'id': 'r1', 'venue_id': V1, 'name': 'Members', 'created_at': '2099-01-01T00:00:00Z'},
                              {'id': 'r2', 'venue_id': V1, 'name': 'Life members', 'created_at': '2099-01-02T00:00:00Z'},
                              {'id': 'r9', 'venue_id': V9, 'name': 'Another venue', 'created_at': '2099-01-03T00:00:00Z'}],
        'vp_members': [{'id': 'm3', 'roster_id': 'r1', 'member_number': '1010', 'first_name': 'Ann', 'last_name': 'Lee', 'status': 'active', 'note': None, 'updated_at': None},
                       {'id': 'm1', 'roster_id': 'r2', 'member_number': '1001', 'first_name': 'Bob, Jr', 'last_name': 'O"Neil', 'status': 'active', 'note': None, 'updated_at': None},
                       {'id': 'm2', 'roster_id': 'r1', 'member_number': '1002', 'first_name': 'Cat', 'last_name': 'Ng', 'status': 'active', 'note': None, 'updated_at': None},
                       {'id': 'm9', 'roster_id': 'r9', 'member_number': '1000', 'first_name': 'Not', 'last_name': 'Ours', 'status': 'active', 'note': None, 'updated_at': None}],
    }
    world(venue={'status': 'suspended', 'suspended_reason': 'cancelled', 'closed_at': '2099-12-11T00:00:00Z'})
    WANT = 'Member number,First name,Surname\n1001,"Bob, Jr","O""Neil"\n1002,Cat,Ng\n1010,Ann,Lee\n'
    HOOK = r'''(function(){ window.__csv = null; window.__csvName = null; window.__csvMsg = null;
      var make = URL.createObjectURL; URL.createObjectURL = function(b){ b.text().then(function(t){ window.__csv = t; }); return make.call(URL, b); };
      HTMLAnchorElement.prototype.click = function(){ if (this.download) window.__csvName = this.download; };
      return "hooked"; })()'''
    for (w, h, mob) in ((375, 812, True), (1440, 900, False)):
        where = '%d wide' % w
        tid, sid = S.open('/app/billing.html', w, h, mob)
        S.until(sid, 'document.getElementById("leftCard").hidden===false', 25)
        S.js(sid, 'document.querySelector(\'.tabs button[data-tab="draws"]\').click()')
        shown = S.until(sid, '(function(){var b=document.getElementById("leftMembersCsv"); return !!b && !b.hidden && b.offsetParent!==null;})()', 20)
        probe = S.json(sid, r'''(function(){ var out = {}; window.__probe = out;
          VP.getClient().from("vp_members").select("number").limit(1).then(function(r){ out.bad = r && r.error ? r.error.code : "none"; });
          VP.getClient().from("vp_members").select("member_number").limit(1).then(function(r){ out.good = r && r.error ? r.error.code : "ok"; });
          return JSON.stringify(out); })()''', {})
        S.until(sid, 'window.__probe && window.__probe.bad && window.__probe.good', 10)
        pr = S.json(sid, 'JSON.stringify(window.__probe)', {})
        ok('%s: CONTROL: the stand-in refuses vp_members."number" (42703) and reads member_number, as the live database does' % where,
           pr.get('bad') == '42703' and pr.get('good') == 'ok', pr)
        ok('%s: the Draws tab shows "Download your members list (CSV)" beside "3 members in your list."' % where,
           shown is True and '3 members in your list.' in (S.js(sid, 'document.getElementById("leftMembersCount").textContent') or ''),
           [shown, S.js(sid, 'document.getElementById("leftMembersCount").textContent')])
        S.js(sid, HOOK)
        S.js(sid, 'document.getElementById("leftMembersCsv").click()')
        got = S.until(sid, 'typeof window.__csv === "string"', 15)
        csv = S.js(sid, 'window.__csv') or ''
        msg = S.js(sid, '(document.getElementById("msg")||{}).textContent || ""') or ''
        ok('%s: a file is made, members-list.csv, no "Could not download" message' % where,
           got is True and S.js(sid, 'window.__csvName') == 'members-list.csv' and 'Could not download' not in msg, [got, msg[:160]])
        ok('%s: the header is "Member number,First name,Surname"' % where, csv.split('\n')[0] == 'Member number,First name,Surname', csv[:120])
        ok('%s: this venue\'s three members in member number order, a comma and a quote kept, another venue\'s left out' % where, csv == WANT, csv[:300])
        S.close_tab(tid)
    S.schema_tables = []
    S.extra_db = {}
finally:
    S.close()

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
