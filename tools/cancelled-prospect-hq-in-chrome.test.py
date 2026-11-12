#!/usr/bin/env python3
"""BODALLA PUB IN HQ > PROSPECTS AND ON ITS OWN BILLING TAB, IN A REAL BROWSER (Dean, 12 Nov 2026, INBOX 301).

Bodalla Pub cancelled its free month on 11 Nov and was switched back on by hand. Main then set its cancel reason by a
direct write to its prospect_cancelled audit row: reason other / "Something else" / "Other: thought this was
SportsPick ...", keeps_until 10 Dec. Live HQ still showed only "Cancelled 11 Nov": no "on until 10 Dec", no reason.

The cause: its month was SET BY HAND (free_month_ends_at 10 Dec) with no first_signin_at, and vpaTrialKeepsUntil
answered "no month" for that, so the Worker sent no on_until (HQ) and no ends_words (Billing's Cancelled card).

The REAL hq.html and billing.html, the REAL billing Worker in jsc behind them (tools/browser-rig/admin_site.py), the
rows seeded into the rig's fake database only. Bodalla's shape, renamed, the years moved to 2099 (2099 has the same
weekdays as 2026: Wed 11 Nov, Thu 10 Dec), so nothing depends on today's date. Nothing is sent anywhere.

  1. HQ > Prospects, the month set by hand (no first sign-in) AND the month from a first sign-in: the chip
     "Cancelled 11 Nov", the details "Cancelled Wed 11 Nov, on until Thu 10 Dec", "Why they cancelled: Something
     else" with the free text quoted (and escaped).
  2. The venue's own Billing tab, the month set by hand: the ONE Cancelled card, "Cancelled on 11 November. Your free
     month runs until 10 December, nothing to pay." with "Keep my free month going", no plan or payment rows.

    python3 tools/cancelled-prospect-hq-in-chrome.test.py [--shots DIR]
"""
import argparse, os, re, sys, time

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


S = admin_site.Site(fonts=bool(SHOTS), live_tables=['vp_venues', 'vp_admin_audit'])
UID, V1, V2 = S.W.info['uid'], S.W.info['venue'], S.W.info['venue2']
NOTE = 'Other: thought this was SportsPick <b>x</b>'

def venue(vid, name, fid):
    return {'id': vid, 'name': name, 'slug': name.lower().replace(' ', '-'), 'status': 'active', 'suspended_reason': None, 'closed_at': None,
            'join_code': 'BOD%03d' % len(name), 'au_state': 'NSW', 'postcode': '2545', 'max_players': 10, 'included_players': None,
            'created_at': '2099-11-09T12:54:00Z', 'timezone': 'Australia/Sydney', 'founding_id': fid, 'group_id': None,
            'cancel_at_period_end': False, 'entity_type': 'for_profit', 'paid_entry_enabled': False, 'weekly_limit_off': False}


def prospect(vid, fid, first):
    # Bodalla Pub's row: month to 11:59:59pm 10 Dec Brisbane, cancelled 11 Nov 11:42am Brisbane (01:42Z), not paused, no card.
    return {'venue_id': vid, 'founding_id': fid, 'auth_user_id': UID, 'source': 'autopilot', 'contact_name': 'Paul',
            'email': fid + '@pub.test', 'phone': None, 'website': None, 'created_at': '2099-11-09T12:54:00.000Z',
            'called_at': None, 'called_label': None, 'call_note': None, 'call_requested': False,
            'first_signin_at': first, 'free_month_ends_at': '2099-12-10T13:59:59.000Z', 'offer_rate': 2.5,
            'card_choice': None, 'card_choice_at': None, 'reminders_sent': [], 'paused_at': None,
            'cancelled_at': '2099-11-11T01:42:00.000Z'}


def cancelled_row(vid):
    # The audit row exactly as main wrote it for Bodalla (12 Nov 2026), the dates moved to 2099.
    return {'actor_admin': None, 'actor_label': 'the venue (cancel link)', 'action': 'prospect_cancelled', 'target': 'venue:' + vid,
            'created_at': '2099-11-11T01:42:00.000Z',
            'detail': {'name': 'Bodalla', 'via': 'link', 'reason': 'other', 'reason_label': 'Something else', 'reason_detail': NOTE,
                       'keeps_until': '2099-12-10T13:59:59.000Z'}}


S.W.env(VPB_SELF_RESTART='1')
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_venues', [venue(V1, 'Hand Set Pub', 'f1'), venue(V2, 'Signed In Pub', 'f2')])
S.W.seed('venueplay_founding', [{'id': f, 'venue_name': n, 'contact_email': f + '@pub.test', 'contact_name': 'Paul', 'plan': 'monthly',
                                 'status': 'pending', 'max_seats': 10, 'stripe_subscription_id': None, 'stripe_customer_id': None,
                                 'bill_by_invoice': False} for f, n in (('f1', 'Hand Set Pub'), ('f2', 'Signed In Pub'))])
S.W.seed('vp_prospects', [prospect(V1, 'f1', None), prospect(V2, 'f2', '2099-11-09T13:25:00.000Z')])
S.W.seed('vp_venue_staff', [{'auth_user_id': UID, 'venue_id': V1, 'role': 'owner', 'display_name': 'Paul'},
                            {'auth_user_id': UID, 'venue_id': V2, 'role': 'owner', 'display_name': 'Paul'}])
S.W.seed('auth', [{'id': UID, 'email': 'f1@pub.test', 'phone': '', 'last_sign_in_at': '2099-11-09T13:25:00.000Z'}])
S.W.seed('vp_prospect_welcomes', [])
S.W.seed('vp_sessions', [])
S.W.seed('vp_game_reports', [])
S.W.seed('vp_admin_audit', [cancelled_row(V1), cancelled_row(V2)])

CARD = '''JSON.stringify((function(id){var c=document.querySelector('#paneProspects .prcard[data-pr-id="'+id+'"]');if(!c)return null;
  var b=c.querySelector("[data-pr-status]");if(b&&b.getAttribute("aria-expanded")!=="true")b.click();
  var why=c.querySelector("[data-pr-why]");
  return {st:b&&b.getAttribute("data-pr-status"),chip:b?b.textContent:"",ends:(c.querySelector("[data-pr-ends]")||{}).textContent||"",
    why:why?why.textContent.replace(/\\s+/g," ").trim():"",note:(c.querySelector("[data-pr-whynote]")||{}).textContent||"",
    tag:!!(why&&why.querySelector("b"))};})("%s"))'''


def open_hq(width, height, mobile=False):
    # The rig rewrites the Worker address in HTML only; vp-prospects-hq.js honours window.VP_PROSPECTS_API.
    tid, sid = S.open('/app/hq.html?as=admin', width, height, mobile, pre='window.VP_PROSPECTS_API="/__api";')
    S.until(sid, '!!document.querySelector("#prTab:not([hidden])")', 25)
    S.js(sid, 'document.getElementById("prTab").click(); true')
    S.until(sid, 'document.querySelectorAll("#paneProspects .prcard").length >= 2', 20)
    time.sleep(0.4)
    return tid, sid


try:
    for (w, h, mob) in ((1280, 1000, False), (375, 812, True)):
        print('\n1. HQ > Prospects at %d wide' % w)
        tid, sid = open_hq(w, h, mob)
        for vid, label in ((V1, 'month set by hand (Bodalla)'), (V2, 'month from a first sign-in')):
            c = S.json(sid, CARD % vid, {}) or {}
            time.sleep(0.2)
            c = S.json(sid, CARD % vid, {}) or {}
            ok('%d, %s: the chip reads "Cancelled 11 Nov"' % (w, label), c.get('st') == 'cancelled' and c.get('chip') == 'Cancelled 11 Nov', c)
            ok('%d, %s: the details read "Cancelled Wed 11 Nov, on until Thu 10 Dec"' % (w, label), c.get('ends') == 'Cancelled Wed 11 Nov, on until Thu 10 Dec', c)
            ok('%d, %s: Why they cancelled: Something else, with their own words quoted, the tag shown as text' % (w, label),
               c.get('why', '').startswith('Something else') and c.get('note') == '“' + NOTE + '”' and not c.get('tag'), c)
        wide = S.js(sid, 'document.scrollingElement.scrollWidth - window.innerWidth')
        ok('%d: no sideways scroll, no script errors' % w, isinstance(wide, (int, float)) and wide <= 1 and S.js(sid, '(window.__errs||[]).length') == 0,
           [wide, S.js(sid, 'JSON.stringify(window.__errs||[])')])
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            S.js(sid, 'document.querySelector(\'#paneProspects .prcard[data-pr-id="%s"]\').scrollIntoView(); true' % V1)
            S.shot(sid, os.path.join(SHOTS, 'hq-prospects-%d.png' % w), False)
        S.close_tab(tid)

    print('\n2. Its own Billing tab, the month set by hand')
    MSG = 'Cancelled on 11 November. Your free month runs until 10 December, nothing to pay.'
    for (w, h, mob) in ((375, 812, True), (1440, 900, False)):
        tid, sid = S.open('/app/billing.html', w, h, mob, pre='try{localStorage.setItem("vpVenuePick",JSON.stringify({id:"%s"}))}catch(e){}' % V1)
        up = S.until(sid, 'document.getElementById("content").style.display!=="none" && document.getElementById("venues").children.length>0', 25)
        S.settled(sid, 'document.getElementById("venues").innerText', 10)
        d = S.json(sid, r'''JSON.stringify((function(){
          function vis(e){ if(!e) return false; for(var x=e; x && x!==document.body; x=x.parentElement){ var s=getComputedStyle(x); if(s.display==="none"||x.hidden) return false; } return true; }
          var top=document.getElementById("cxTop");
          return { top: vis(top) ? top.innerText.trim() : "", keep: vis(document.getElementById("cxKeep")),
            summary: vis(document.querySelector("#tp-billing > .card")), next: vis(document.getElementById("s-next-amt")),
            row: (document.querySelector("#venues .venue")||{}).innerText || "" };
        })())''', {}) or {}
        ok('%d: CONTROL: the Worker answered and Hand Set Pub is listed' % w, up is True and 'Hand Set Pub' in d.get('row', ''), [up, d.get('row')])
        ok('%d: the ONE Cancelled card with both dates and "Keep my free month going"' % w,
           d.get('top', '').startswith(MSG) and d.get('keep') is True, d.get('top'))
        ok('%d: no plan card and no NEXT PAYMENT' % w, not d.get('summary') and not d.get('next'), [d.get('summary'), d.get('next')])
        if SHOTS:
            S.shot(sid, os.path.join(SHOTS, 'billing-hand-set-%d.png' % w), True)
        S.close_tab(tid)

    print('\n3. Nothing was sent')
    ok('the rig recorded no email or text', not (S.W.table('vp_email_log') or []) and not [a for a in (S.W.table('vp_admin_audit') or [])
       if a.get('action') in ('trial_end_note', 'prospect_reminder_sent', 'members_reminder_sent')], S.W.table('vp_admin_audit'))
finally:
    S.close()

print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
