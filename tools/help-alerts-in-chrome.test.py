#!/usr/bin/env python3
"""HQ > HELP DESK > ALERTS ON THIS DEVICE, IN THE REAL PAGE, AGAINST THE REAL BILLING WORKER
(Dean, 2 Nov 2026: "every different email needs its own notifications for different teams", then
"split notifications by brand too").

Opens the REAL hq.html in headless Chrome (tools/browser-rig/admin_site.py), signed in as an HQ owner,
with the REAL venueplay-api-FULL.js answering every /admin/help/ request from a fake database. The
browser's push machinery is stood in for (headless Chrome cannot be granted notifications): the
service worker registration, the push subscription and the permission prompt. Everything the page
draws and sends, and everything the Worker stores, is real.

  Ticks       two columns, venueplay and PartyPlay, a tick per kind in that brand's own words (Host
              and Guest support on PartyPlay), Urgent ones per brand, Bad player feedback on venueplay
              only; a new device starts with every tick
  Quick picks Every ticket, Only urgent ones and sales, Only bad player feedback, Untick all
  Save        PartyPlay support only reaches the Worker as ticks and is stored as that list; nothing
              ticked is refused on the page; an old "urgent_sales" device opens showing its ticks
  Phone       390 wide: both columns on screen, no sideways scrolling

    python3 tools/help-alerts-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


EP = 'https://fcm.googleapis.com/fcm/send/chrome-alerts-test'
# The browser's push machinery, stood in for before the page's own scripts run. window.__hasSub says
# whether this device already holds a subscription (an old device) or not (a new one).
PRE = r'''(function(){
  var EP = %s;
  window.__hasSub = false;
  var sub = function(){ return { endpoint: EP, unsubscribe: function(){ window.__hasSub = false; return Promise.resolve(true); } }; };
  var pm = { getSubscription: function(){ return Promise.resolve(window.__hasSub ? sub() : null); },
             subscribe: function(){ window.__hasSub = true; return Promise.resolve(sub()); } };
  var reg = { active: {}, pushManager: pm };
  var sw = { register: function(){ return Promise.resolve(reg); }, getRegistration: function(){ return Promise.resolve(window.__hasSub ? reg : undefined); } };
  Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: function(){ return sw; }, configurable: true });
  if (!('PushManager' in window)) window.PushManager = function(){};
  if (!('Notification' in window)) window.Notification = function(){};
  window.Notification.requestPermission = function(){ return Promise.resolve('granted'); };
  var store = {};
  Object.defineProperty(window, 'caches', { configurable: true, value: {
    open: function(n){ return Promise.resolve({ put: function(k, v){ store[k] = v; return Promise.resolve(); }, match: function(k){ return Promise.resolve(store[k]); } }); },
    delete: function(){ store = {}; return Promise.resolve(true); } } });
})();''' % json.dumps(EP)

S = admin_site.Site(fonts=bool(A.shots))
UID = S.W.info['uid']
S.W.seed('vp_platform_admins', [{'auth_user_id': UID, 'role': 'owner', 'label': 'Dean'}])
S.W.seed('vp_help_tickets', [])
S.W.seed('vp_help_push_subs', [])
S.W.env(VAPID_PUBLIC_KEY='BPubKeyForTheRigOnly', VAPID_PRIVATE_JWK=json.dumps({'d': 'd', 'x': 'x', 'y': 'y'}))


def js(sid, e):
    return S.js(sid, e)


def click(sid, sel):
    return js(sid, '(function(){var b=document.querySelector(%s); if(!b) return false; b.click(); return true;})()' % json.dumps(sel))


def ticks(sid):
    return js(sid, '[].filter.call(document.querySelectorAll("input[name=hdaT]"),function(x){return x.checked;}).map(function(x){return x.value;})') or []


def shot(sid, name):
    if A.shots:
        os.makedirs(A.shots, exist_ok=True)
        S.shot(sid, os.path.join(A.shots, name + '.png'))


def open_box(sid):
    click(sid, '#hdAlert')
    return S.until(sid, '!document.getElementById("hdAlertBox").classList.contains("hidden") && document.querySelectorAll("input[name=hdaT]").length > 0', 10)


ALL = sorted(['venueplay:venue_support', 'venueplay:patron_support', 'venueplay:accounts', 'venueplay:sales', 'venueplay:general',
              'venueplay:urgent', 'venueplay:bad_feedback', 'partyplay:venue_support', 'partyplay:patron_support',
              'partyplay:accounts', 'partyplay:sales', 'partyplay:general', 'partyplay:urgent'])
try:
    tid, sid = S.open('/app/hq.html?as=admin', 1280, 1000, pre=PRE)
    S.until(sid, '!!document.getElementById("hdTab")', 25)
    click(sid, '#hdTab')
    S.until(sid, '!!document.getElementById("hdAlert")', 10)
    print('\nTicks')
    ok('the alert settings open', open_box(sid) is True)
    time.sleep(0.4)
    cols = js(sid, '[].map.call(document.querySelectorAll("#hdaTicks [data-hda-brand]"),function(c){return [c.getAttribute("data-hda-brand"),c.querySelector(".cxname").textContent,'
                   '[].map.call(c.querySelectorAll("label"),function(l){return l.textContent.trim();})];})')
    ok('two columns, venueplay then PartyPlay', bool(cols) and [c[1] for c in cols] == ['venueplay', 'PartyPlay'], cols)
    ok('venueplay: Venue support, Player support, Accounts, Sales, General, Urgent ones, Bad player feedback',
       bool(cols) and cols[0][2] == ['Venue support', 'Player support', 'Accounts', 'Sales', 'General', 'Urgent ones, any kind', 'Bad player feedback'], cols and cols[0][2])
    ok('PartyPlay in its own words (Host and Guest support), and no bad player feedback',
       bool(cols) and cols[1][2] == ['Host support', 'Guest support', 'Accounts', 'Sales', 'General', 'Urgent ones, any kind'], cols and cols[1][2])
    ok('a new device starts with every tick, so no alert is lost', sorted(ticks(sid)) == ALL, ticks(sid))
    side = js(sid, '(function(){var c=document.querySelectorAll("#hdaTicks [data-hda-brand]");var a=c[0].getBoundingClientRect(),b=c[1].getBoundingClientRect();return [Math.abs(a.top-b.top)<2, b.left>a.right-1];})()')
    ok('the two columns sit side by side', side == [True, True], side)
    shot(sid, '01-alerts-desk')

    print('\nQuick picks')
    click(sid, '[data-hda-preset][value="none"]')
    ok('Untick all clears every tick', ticks(sid) == [], ticks(sid))
    click(sid, '[data-hda-preset][value="urgent_sales"]')
    ok('Only urgent ones and sales ticks urgent and sales on both brands, and bad player feedback',
       sorted(ticks(sid)) == sorted(['venueplay:sales', 'venueplay:urgent', 'venueplay:bad_feedback', 'partyplay:sales', 'partyplay:urgent']), ticks(sid))
    click(sid, '[data-hda-preset][value="bad_feedback"]')
    ok('Only bad player feedback ticks just that', ticks(sid) == ['venueplay:bad_feedback'], ticks(sid))
    click(sid, '[data-hda-preset][value="all"]')
    ok('Every ticket ticks everything again', sorted(ticks(sid)) == ALL, ticks(sid))

    print('\nSave')
    click(sid, '[data-hda-preset][value="none"]')
    n0 = len(S.W.calls)
    click(sid, '#hdaOn')
    time.sleep(0.6)
    msg = js(sid, 'document.getElementById("hdaMsg").textContent')
    ok('nothing ticked is refused on the page, and nothing is sent', 'Tick at least one' in (msg or '') and not [p for p, b in S.W.calls[n0:] if p.startswith('/admin/help/push/subscribe')], msg)
    click(sid, 'input[value="partyplay:venue_support"]')
    click(sid, 'input[value="partyplay:patron_support"]')
    n0 = len(S.W.calls)
    click(sid, '#hdaOn')
    S.until(sid, '/Alerts are on/.test(document.getElementById("hdaMsg").textContent)', 10)
    sent = [b for p, b in S.W.calls[n0:] if p == '/admin/help/push/subscribe']
    ok('PartyPlay support only reaches the Worker as those two ticks', bool(sent) and sorted(sent[-1].get('ticks') or []) == ['partyplay:patron_support', 'partyplay:venue_support'] and 'filter' not in sent[-1], sent)
    rows = S.W.table('vp_help_push_subs')
    ok('the Worker stores that choice for this device, one row', len(rows) == 1 and rows[0].get('filter') == 'partyplay:venue_support,partyplay:patron_support' and rows[0].get('endpoint') == EP, rows)
    ok('the page says alerts are on', 'Alerts are on for this device' in (js(sid, 'document.getElementById("hdaMsg").textContent') or ''))
    shot(sid, '02-alerts-saved')

    print('\nAn old device')
    S.W.seed('vp_help_push_subs', [dict(rows[0], filter='urgent_sales')])
    click(sid, '#hdAlert')   # close
    ok('it opens again', open_box(sid) is True)
    S.until(sid, '/These are its ticks/.test(document.getElementById("hdaMsg").textContent)', 10)
    ok('an old "urgent ones and sales" device opens showing those ticks',
       sorted(ticks(sid)) == sorted(['venueplay:sales', 'venueplay:urgent', 'venueplay:bad_feedback', 'partyplay:sales', 'partyplay:urgent']), ticks(sid))
    errs = js(sid, 'window.__errs') or []
    ok('no script errors', errs == [], errs)
    S.close_tab(tid)

    print('\nPhone')
    tid, sid = S.open('/app/hq.html?as=admin', 390, 844, mobile=True, pre=PRE)
    S.until(sid, '!!document.getElementById("hdTab")', 25)
    click(sid, '#hdTab')
    S.until(sid, '!!document.getElementById("hdAlert")', 10)
    open_box(sid)
    time.sleep(0.4)
    js(sid, 'document.documentElement.style.scrollBehavior="auto";document.getElementById("hdAlertBox").scrollIntoView();true')
    time.sleep(0.3)
    cut = js(sid, '(function(){var w=window.innerWidth,out=[];[].forEach.call(document.querySelectorAll("#hdAlertBox label, #hdAlertBox button"),function(e){var r=e.getBoundingClientRect();if(r.width&&(r.right>w-4||r.left<4))out.push(e.textContent.trim().slice(0,24));});return out;})()')
    ok('at 390 wide every tick and button is on screen, no sideways scrolling', cut == [] and js(sid, 'document.documentElement.scrollWidth<=window.innerWidth+1') is True, cut)
    shot(sid, '03-alerts-phone')
    errs = js(sid, 'window.__errs') or []
    ok('no script errors on the phone either', errs == [], errs)
    S.close_tab(tid)
finally:
    S.close()

print('\n%d of %d checks passed' % (PASS[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
