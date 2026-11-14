#!/usr/bin/env python3
"""WEBSITE AUDIT PART 2, THE SMALL FAULTS (INBOX 361A, 13 Nov 2026), the signed-in side.

Opens the REAL signed-in pages in headless Chrome (tools/browser-rig/admin_site.py, signed in as a venue owner):
  1. host console on a phone: the greeting toast sits at the bottom, never on top of the venueplay wordmark
  2. console and account inputs have an accessible name: trivia round settings, members draw settings, raffle claim time,
     the account page's max players boxes (one per venue, named for the venue) and the add-a-venue boxes
  3. the marketing page's brand kit does not name a colour after Gflam
Touches no git and no remote.    python3 tools/website-audit-p2-13nov-in-chrome.test.py
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1; print('  ok   %s' % label)
    else:
        FAIL[0] += 1; print('  FAIL %s%s' % (label, ('  (%s)' % str(detail)[:500]) if detail != '' else ''))


NAMED = r'''(function(ids){var bad=[];ids.forEach(function(id){var e=document.getElementById(id);if(!e){bad.push(id+' missing');return}
 var has=(e.labels&&e.labels.length)||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby');if(!has)bad.push(id);});return JSON.stringify(bad);})(%s)'''
S = admin_site.Site(fonts=False)
try:
    tid, sid = S.open('/app/index.html?as=owner', 375, 812, mobile=True)
    S.until(sid, 'document.getElementById("greetToast")&&document.getElementById("greetToast").classList.contains("show")', 20); time.sleep(0.8)
    M = S.json(sid, 'JSON.stringify((function(){var t=document.getElementById("greetToast").getBoundingClientRect();return {top:t.top,bottom:t.bottom,vh:innerHeight,txt:document.getElementById("greetToast").textContent}})())')
    ok('host console, 375 phone: the greeting is showing', M['txt'].startswith('Good'), M)
    ok('host console, 375 phone: the greeting sits in the lower half, clear of the venueplay wordmark', M['top'] > M['vh'] / 2, M)
    S.close_tab(tid)
    # INBOX 399 (b): "Good evening" never overlaps the venueplay logo (nor the venue's own logo) on the host home, at 320, 375 and 430
    BOXES = r'''JSON.stringify((function(){var t=document.getElementById("greetToast"),tr=t.getBoundingClientRect(),R=function(e){var b=e.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}};
      var hit=function(a,b){return a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b};
      var els=[].slice.call(document.querySelectorAll("header .brand svg.vp-wm,header img#venueLogo,header .bar button,header .bar a")).filter(function(e){var b=e.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(e).visibility!=="hidden"});
      var wm=document.querySelector("header .brand svg.vp-wm");
      return {toast:R(t),txt:t.textContent,wordmark:wm?R(wm):null,vh:innerHeight,n:els.length,hits:els.filter(function(e){return hit(R(e),R(t))}).map(function(e){return e.id||e.tagName})};})())'''
    for vw in (320, 375, 430):
        tid, sid = S.open('/app/index.html?as=owner', vw, 812, mobile=True)
        S.until(sid, 'document.getElementById("greetToast")&&document.getElementById("greetToast").classList.contains("show")', 20); time.sleep(0.8)
        Q = S.json(sid, BOXES)
        ok('host home, %d phone: the greeting and the venueplay wordmark are both on screen and their boxes do not intersect' % vw,
           Q['txt'].startswith('Good') and Q['wordmark'] and Q['wordmark']['w'] > 40 and 'svg' not in Q['hits'], Q)
        ok('host home, %d phone: the greeting touches nothing else in the header either (venue logo, buttons)' % vw, not Q['hits'] and Q['n'] >= 1, Q)
        if vw == 375:
            import os as _os
            if _os.environ.get('VP_SHOTS'): S.shot(sid, _os.path.join(_os.environ['VP_SHOTS'], 'good-evening-375.png'), full=False)
        S.close_tab(tid)
    for page, ids in (('/app/trivia/host.html', ['cfgCount', 'cfgTime', 'cfgBase']),
                      ('/app/members/host.html', ['setSince', 'setDay', 'setClaim', 'setStart', 'setInc']),
                      ('/app/raffle/host.html', ['rfTime'])):
        tid, sid = S.open(page + '?as=owner', 390, 844, mobile=True)
        S.until(sid, 'document.readyState==="complete"', 25); time.sleep(1.5)
        bad = S.json(sid, NAMED % json.dumps(ids))
        ok('%s: %s have an accessible name' % (page, ', '.join(ids)), not bad, bad)
        S.close_tab(tid)
    tid, sid = S.open('/app/billing?as=owner', 390, 844, mobile=True)
    S.until(sid, 'document.querySelectorAll(".stepper input").length>=2', 25); time.sleep(1.0)
    names = S.json(sid, 'JSON.stringify([].slice.call(document.querySelectorAll(".stepper input")).map(function(i){return i.getAttribute("aria-label")}))')
    ok('account: each venue max players box is named for its venue', names == ['Maximum players at Deepwater Hotel', 'Maximum players at The Royal Arms'], names)
    bad = S.json(sid, NAMED % json.dumps(['add-seats', 'add-postcode']))
    ok('account: the add-a-venue max players and postcode boxes have an accessible name', not bad, bad)
    S.close_tab(tid)
    tid, sid = S.open('/app/marketing?as=owner', 390, 844, mobile=True)
    S.until(sid, 'document.readyState==="complete"', 25); time.sleep(1.5)
    txt = S.js(sid, 'document.body.innerText')
    ok('marketing brand kit: the pink is "venueplay pink", no Gflam name', 'venueplay pink' in txt and 'Gflam' not in txt, txt[txt.find('Colours'):txt.find('Colours') + 120] if 'Colours' in txt else txt[:80])
    S.close_tab(tid)
finally:
    S.close()
print('\nALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '\n%d OF %d CHECKS FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
