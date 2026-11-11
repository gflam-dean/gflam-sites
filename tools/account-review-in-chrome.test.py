#!/usr/bin/env python3
"""YOUR ACCOUNT, THE FULL REVIEW, IN A REAL CHROME (Dean, 5 Nov 2026, INBOX items 21, 33, 34 and 35).

The shipped billing.html and settings.html, served by tools/browser-rig/admin_site.py with the REAL billing Worker
behind them, signed in as the test accounts tools/browser-rig/account_demo.py builds (made-up venues, no live data):

  item 33  each state shows the right tabs and opens on Billing: active (all seven), cancelled before the end date
           (all seven), paused prospect, cancelled and ended, and closed (Billing, Draws and Marketing only, opening on
           Billing whatever tab was open last); after leaving, Draws is read only (the jackpot and when it last ran, the
           members list, the winners download), Marketing is the opt-in download only, and Billing says what is kept
  item 34  one venue: Game settings shows that venue's settings in the tab with no list to pick from; two venues: one row
           each; the note sending you to the Marketing tab for the opt-in list is gone
  item 35  no description paragraph under "Your account"
  item 21  b the owner sees each host's full mobile; c no "All venues" with one venue; d the Draws folds all start closed
           with a one-line summary each, and "Not on the TV yet" is gone; e the Your screen card says venueplay.com.au/tv
           and the venue's screen code, each with a Copy button
  and at 375 wide nothing on any tab scrolls sideways, with no script error.

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait): one Chrome suite at a time on this Mac.

    python3 tools/account-review-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import gatelib  # noqa: E402
import account_demo  # noqa: E402

PASS, FAIL = [0], [0]
if not gatelib.hold_lock_or_refuse('account-review-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
    print('REFUSED: another live Chrome run holds /tmp/vp-heavy.lock')
    sys.exit(3)


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1
        print('  ok   %s' % label)
    else:
        FAIL[0] += 1
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:400],)) if detail != '' else ''))


UP = 'document.getElementById("content") && document.getElementById("content").style.display!=="none"'
STATE = r'''JSON.stringify({tabs:[].filter.call(document.querySelectorAll(".tabs button"),function(b){return b.offsetParent}).map(function(b){return b.getAttribute("data-tab")}),
  on:(document.querySelector(".tabs button.on")||{getAttribute:function(){return null}}).getAttribute("data-tab"),
  lede:!!(document.getElementById("lede")&&document.getElementById("lede").offsetParent),
  left:(document.getElementById("leftCard")&&!document.getElementById("leftCard").hidden)?document.getElementById("leftCard").innerText:"",
  sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth, errs:window.__errs||[]})'''


def tab(S, sid, name, wait=0.5):
    S.js(sid, 'var b=document.querySelector(\'.tabs button[data-tab="%s"]\'); b&&b.click(); true' % name)
    time.sleep(wait)


def text_of(S, sid, sel):
    return S.js(sid, '(function(e){return e?e.innerText:""})(document.querySelector(%s))' % json.dumps(sel)) or ''


ALL = ['billing', 'people', 'nights', 'screen', 'draws', 'marketing', 'settings']
LEFT = ['billing', 'draws', 'marketing']
for key, want_tabs in [('alpha', ALL), ('echo', ALL), ('bravo', LEFT), ('charlie', LEFT), ('delta', LEFT), ('foxtrot', ALL)]:
    S = account_demo.build(key, root=ROOT, browser=True, fonts=False)
    try:
        print('\n%s (%s)' % (key, account_demo.LABEL[[a for a in account_demo.ACCOUNTS if a[0] == key][0][5]]))
        tid, sid = S.open('/app/billing.html#screen', 375, 812, True)   # the last tab "remembered" is Screen
        S.until(sid, UP, 25)
        time.sleep(1.5)
        st = S.json(sid, STATE, {})
        ok('%s: the tabs shown are %s' % (key, ','.join(want_tabs)), st.get('tabs') == want_tabs, st.get('tabs'))
        if want_tabs == LEFT:
            ok('%s: it opens on Billing, not the Screen tab it was asked for' % key, st.get('on') == 'billing', st.get('on'))
            ok('%s: Billing says what is kept, and until when' % key, 'kept until' in st.get('left', '') and 'privacy policy' in st.get('left', ''), st.get('left'))
            ok('%s: the plan tiles, venues and payment reminders are hidden' % key,
               S.js(sid, '!document.querySelector("#tp-billing .sumrows").offsetParent && !document.getElementById("venues").offsetParent && !document.getElementById("reminders").closest(".card").offsetParent') is True)
            tab(S, sid, 'draws', 1.0)
            d = text_of(S, sid, '#leftDraws')
            ok('%s: Draws is read only: the members draw, its jackpot and when it last ran' % key,
               'Friday Members Draw' in d and 'Jackpot $450' in d and 'Last drawn 30 October 2026' in d, d[:300])
            ok('%s: Draws shows the members list count and its download' % key, '5 members in your list.' in d and 'Download your members list (CSV)' in d, d[:300])
            ok('%s: Draws keeps the winners download' % key, S.js(sid, '!!document.getElementById("dlCsv").offsetParent') is True)
            ok('%s: the setup folds are hidden' % key, S.js(sid, '[].every.call(document.querySelectorAll("#tp-draws .acchead"),function(h){return !h.offsetParent})') is True)
            tab(S, sid, 'marketing')
            ok('%s: Marketing is the opt-in download only (no venue link, no table signs)' % key,
               S.js(sid, '!!document.getElementById("optinExport").offsetParent && !document.getElementById("venueLinkVal").offsetParent && !document.getElementById("signageLink").offsetParent') is True)
            if key == 'bravo':
                ok('bravo: the paused prospect is told the free month ended, with Add your card', 'free month has ended' in st.get('left', '') and 'Add your card' in st.get('left', ''), st.get('left'))
        else:
            ok('%s: an active account opens on the tab it was asked for' % key, st.get('on') == 'screen', st.get('on'))
            ok('%s: no left-the-account card' % key, st.get('left') == '', st.get('left'))
        ok('%s: no description paragraph under "Your account"' % key, st.get('lede') is False, st.get('lede'))
        for t in want_tabs:
            tab(S, sid, t, 1.2 if t == 'settings' else 0.5)
            m = S.json(sid, STATE, {})
            ok('%s %s: nothing scrolls sideways at 375 (%s <= %s)' % (key, t, m.get('sw'), m.get('cw')), isinstance(m.get('sw'), int) and m['sw'] <= m.get('cw', 0), m)
        if key in ('alpha', 'foxtrot'):
            tab(S, sid, 'settings', 2.0)
            fr = S.js(sid, 'JSON.stringify({frames:document.querySelectorAll("#playerData iframe.setframe").length,src:(document.querySelector("#playerData iframe.setframe")||{}).src||"",rows:document.querySelectorAll("#playerData a.venue").length,h:(document.querySelector("#playerData iframe.setframe")||{offsetHeight:0}).offsetHeight,note:/opt-in list is under the Marketing tab/.test(document.getElementById("tp-settings").innerText)})')
            fr = json.loads(fr or '{}')
            if key == 'alpha':
                ok('alpha: one venue: Game settings shows that venue\'s settings in the tab, no list to pick from',
                   fr.get('frames') == 1 and fr.get('rows') == 0 and 'settings.html?venue=' in fr.get('src', '') and 'embed=1' in fr.get('src', ''), fr)
                ok('alpha: the settings frame grows to fit them (taller than 600px)', fr.get('h', 0) > 600, fr)
                inner = S.js(sid, '(function(){try{var d=document.querySelector("#playerData iframe.setframe").contentDocument;return JSON.stringify({header:!!(d.querySelector("header")&&d.querySelector("header").offsetParent),save:!!d.getElementById("saveBtn"),code:d.getElementById("venueCodeVal").textContent})}catch(e){return "{}"}})()')
                inner = json.loads(inner or '{}')
                ok('alpha: inside it, no second header, and the Save button and the venue code are there', inner.get('header') is False and inner.get('save') is True and inner.get('code') == 'TALPHA', inner)
            else:
                ok('foxtrot: two venues: one row each, no frame', fr.get('frames') == 0 and fr.get('rows') == 2, fr)
            ok('%s: no note sending you to the Marketing tab for the opt-in list' % key, fr.get('note') is False, fr)
        if key == 'alpha':
            tab(S, sid, 'people', 1.0)
            p = text_of(S, sid, '#hosts')
            ok('alpha: the owner sees each host\'s full mobile', '0400 111 222' in p and '0400 333 444' in p and 'mobile ending' not in p, p[:300])
            ok('alpha: one venue: never "All venues"', 'All venues' not in S.js(sid, 'document.getElementById("tp-people").innerText'), p[:200])
            tab(S, sid, 'draws', 1.0)
            f = S.json(sid, 'JSON.stringify({open:[].map.call(document.querySelectorAll("#tp-draws .acchead"),function(h){return h.classList.contains("open")}),bodies:[].map.call(document.querySelectorAll("#tp-draws .accbody"),function(b){return b.offsetParent!==null}),sums:[].map.call(document.querySelectorAll("#tp-draws .accsum"),function(s){return s.textContent}),txt:document.getElementById("tp-draws").innerText})', {})
            # Since 6 Nov 2026 (Dean) "Who won what" is a fourth fold at the bottom; it is a record, not a setting, so the
            # one-line summary is asked of the three setting folds.
            ok('alpha: every Draws fold starts closed', f.get('open') == [False, False, False, False] and f.get('bodies') == [False, False, False, False], f.get('open'))
            ok('alpha: each setting fold heading carries a one-line summary', len(f.get('sums') or []) == 4 and all(s.strip() for s in (f.get('sums') or [])[:3]), f.get('sums'))
            ok('alpha: "Not on the TV yet" is gone', 'Not on the TV yet' not in f.get('txt', ''), f.get('sums'))
            tab(S, sid, 'screen', 1.5)
            sc = S.json(sid, 'JSON.stringify({url:document.getElementById("scrUrl").textContent,code:document.getElementById("scrCode").textContent,copies:[].filter.call(document.querySelectorAll("#screenCard .scrcopy"),function(b){return b.offsetParent&&b.getBoundingClientRect().height>=44}).length})', {})
            ok('alpha: Your screen says venueplay.com.au/tv and the screen code TALPHA', sc.get('url') == 'venueplay.com.au/tv' and sc.get('code') == 'TALPHA', sc)
            ok('alpha: each line has a Copy button a finger can hit (44px)', sc.get('copies') == 2, sc)
        errs = S.js(sid, 'JSON.stringify(window.__errs||[])')
        ok('%s: no script error' % key, errs == '[]', errs)
        S.close_tab(tid)
    finally:
        S.close()

print('')
print(('%d FAILED, %d passed' % (FAIL[0], PASS[0])) if FAIL[0] else ('ALL %d CHECKS PASSED' % PASS[0]))
sys.exit(1 if FAIL[0] else 0)
