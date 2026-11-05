#!/usr/bin/env python3
"""YOUR ACCOUNT: EVERY TAB FITS, AND THE BILLING INTRO IS ON BILLING ONLY (Dean, 5 Nov 2026, INBOX item 20).

Dean, on the venue's Account page (venueplay/app/billing.html):
  a) "the tab row scrolls sideways": seven tabs at 14px with 16px padding were wider than the 642px column,
     so on a desktop and an iPad the row scrolled with a scrollbar under it, and on a phone each tab was
     39px tall with 14px text. Now the row wraps and never scrolls: one row on a desktop or iPad, two even
     rows on a phone (Billing, People, Nights, Screen / Draws, Marketing, Game settings), every tab 48px
     tall with 15px text.
  b) "up the top it says we've still got host, next payment and everything on this page": the owner's
     intro ("Your plan, venues, hosts and next payment. ...") sat above the tabs, so it showed on every
     tab. It shows on Billing only now; the venue drop-down above the tabs stays on every tab.

This opens the REAL billing.html (tools/browser-rig/admin_site.py) as the owner of two venues, with the
REAL billing Worker in jsc behind it, at 320, 375, 390 and 768 (phone mode) and 1280 (desktop), and on
EVERY tab measures:
  - nothing on the page scrolls sideways (document scrollWidth <= clientWidth), nor the tab row itself
  - every tab is on screen, at least 44px tall, its text at least 15px and not clipped, and the row is
    never more than two rows
  - a tap in the middle of each tab lands on that tab and opens its panel
  - the plan summary and the billing intro are visible on Billing and on no other tab, and the venue
    drop-down is visible on every tab
The showTab logic itself is also RUN under jsc by tools/test-account-tabs.js.

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait): one Chrome suite at a time on this Mac.

    python3 tools/account-tabs-in-chrome.test.py [--shots DIR]
"""
import argparse, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import gatelib  # noqa: E402
import admin_site  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--shots')
A = ap.parse_args()
PASS, FAIL = [0], [0]

if not gatelib.hold_lock_or_refuse('account-tabs-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    print('REFUSED: another live Chrome run holds /tmp/vp-heavy.lock')
    sys.exit(3)


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


def read(sid, expr):
    """A rig answer that is JSON text, as a dict. Anything else (an exception the page threw, None) is
    returned as {'_saw': ...} so the failing line says what the page answered."""
    raw = S.js(sid, expr)
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except ValueError:
            pass
    return {'_saw': raw}


TABS = ['billing', 'people', 'nights', 'screen', 'draws', 'marketing', 'settings']
BILLING_UP = 'document.getElementById("content").style.display!=="none"'
MEASURE = r'''(function(){
  function seen(e){ if(!e||!e.offsetParent) return false; var r=e.getBoundingClientRect(); return r.width>0&&r.height>0; }
  var de=document.documentElement, row=document.querySelector(".tabs"), bs=[].slice.call(row.querySelectorAll("button"));
  var tops={};
  var tabs=bs.map(function(b){ var r=b.getBoundingClientRect(), cs=getComputedStyle(b); tops[Math.round(r.top)]=1;
    return {id:b.getAttribute("data-tab"), shown:seen(b), l:Math.floor(r.left), r:Math.ceil(r.right), h:Math.round(r.height*10)/10,
            fs:parseFloat(cs.fontSize), clip:b.scrollWidth>b.clientWidth+1, on:b.classList.contains("on")}; });
  var sum=document.querySelector(".sumrows");
  return JSON.stringify({vw:innerWidth, dsw:de.scrollWidth, dcw:de.clientWidth, rsw:row.scrollWidth, rcw:row.clientWidth,
    rows:Object.keys(tops).length, tabs:tabs, panel:(document.querySelector(".tabpanel.on")||{}).id||"",
    summary:seen(sum), intro:seen(document.getElementById("lede")), introText:(document.getElementById("lede")||{}).textContent||"",
    pick:seen(document.getElementById("acctPick"))});
})()'''
# A tap in the middle of a tab: what is under the finger there, and does it open that tab.
TAP = r'''(function(id){
  var b=document.querySelector('.tabs button[data-tab="'+id+'"]'); b.scrollIntoView({block:"nearest"});
  var r=b.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2, hit=document.elementFromPoint(x,y);
  var mine=!!hit&&(hit===b||b.contains(hit)); if(mine) hit.click();
  return JSON.stringify({mine:mine, hit:hit?(hit.tagName+"."+hit.className+"#"+(hit.getAttribute("data-tab")||"")):null});
})(%s)'''

S = admin_site.Site()
try:
    for w, h, phone in [(320, 700, True), (375, 812, True), (390, 844, True), (768, 1024, True), (1280, 900, False)]:
        print('\nYOUR ACCOUNT at %d wide%s' % (w, ' (phone)' if phone else ' (desktop)'))
        tid, sid = S.open('/app/billing.html#billing', w, h, phone)
        S.until(sid, BILLING_UP, 25)
        S.until(sid, '!!document.querySelector("#venues .vrow, #venues > *")', 20)
        time.sleep(1.0)
        seen_on = {}
        for tab in TABS:
            tap = read(sid, TAP % json.dumps(tab))
            time.sleep(0.35)
            m = read(sid, MEASURE)
            seen_on[tab] = m
            tabs = m.get('tabs') or []
            ok('%d %s: a tap in the middle of the tab lands on it and opens its panel' % (w, tab),
               tap.get('mine') is True and m.get('panel') == 'tp-' + tab and [t['id'] for t in tabs if t.get('on')] == [tab], (tap, m.get('panel')))
            ok('%d %s: nothing on the page scrolls sideways (scrollWidth %s <= clientWidth %s)' % (w, tab, m.get('dsw'), m.get('dcw')),
               isinstance(m.get('dsw'), int) and m['dsw'] <= m.get('dcw', 0), m)
            ok('%d %s: the tab row does not scroll sideways (scrollWidth %s <= clientWidth %s)' % (w, tab, m.get('rsw'), m.get('rcw')),
               isinstance(m.get('rsw'), int) and m['rsw'] <= m.get('rcw', 0), m)
            if tab == 'billing':
                ok('%d: all seven tabs are on screen, inside the window' % w,
                   len(tabs) == 7 and all(t['shown'] and t['l'] >= 0 and t['r'] <= m.get('vw', 0) for t in tabs), tabs)
                ok('%d: every tab is at least 44px tall (a fingertip)' % w, len(tabs) == 7 and all(t['h'] >= 44 for t in tabs), [(t['id'], t['h']) for t in tabs])
                ok('%d: every tab label is at least 15px and none is cut off' % w,
                   len(tabs) == 7 and all(t['fs'] >= 15 and not t['clip'] for t in tabs), [(t['id'], t['fs'], t['clip']) for t in tabs])
                ok('%d: the tabs sit in no more than two rows' % w, 1 <= m.get('rows', 0) <= 2, m.get('rows'))
            want = (tab == 'billing')
            ok('%d %s: the plan summary is %s' % (w, tab, 'shown' if want else 'not shown'), m.get('summary') is want, m.get('summary'))
            ok('%d %s: the billing intro ("Your plan, venues, hosts and next payment") is %s' % (w, tab, 'shown' if want else 'not shown'),
               m.get('intro') is want and (not want or 'next payment' in m.get('introText', '')), (m.get('intro'), m.get('introText', '')[:60]))
            ok('%d %s: the venue drop-down above the tabs is still there' % (w, tab), m.get('pick') is True, m.get('pick'))
            if A.shots and w in (375, 1280) and tab in ('billing', 'people'):
                S.shot(sid, os.path.join(A.shots, 'account-tabs-%s-%d.png' % (tab, w)), False)
        errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
        ok('%d: no script error going through every tab' % w, errs == '[]', errs)
        S.close_tab(tid)
finally:
    S.close()

print('')
print(('%d FAILED, %d run' % (FAIL[0], PASS[0] + FAIL[0])) if FAIL[0] else ('ALL %d CHECKS PASSED' % PASS[0]))
sys.exit(1 if FAIL[0] else 0)
