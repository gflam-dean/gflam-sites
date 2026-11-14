#!/usr/bin/env python3
"""DESIGN AUDIT 13 NOV 2026, THE OPEN ITEMS (INBOX 354a).

Opens the REAL pages in headless Chrome (tools/browser-rig/admin_site.py) and checks, with the real fonts:
  1. /training at 1280: the ad copy on the venue screen ends above the pair caption (no overlap), the caption's code line is
     not mono, the collapsed phone is hidden (nothing pokes past the stage), the "Live demo" tags are 11px or more
  2. the home page statistic captions ("questions and counting") are the body font at 13px or more, not mono
  3. the sign-in field label on /app is 12px or more; the signage field labels are 12px or more
  4. /live-here-now at 375 and 390: the footer links (Help, Privacy, Terms) are 44px tall
  5. /play on a laptop (1280): the six code boxes are 80px or taller; on a phone (375) they stay 60px
Touches no git and no remote.    python3 tools/design-audit-open-13nov-in-chrome.test.py
"""
import io, json, os, re, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1; print('  ok   %s' % label)
    else:
        FAIL[0] += 1; print('  FAIL %s%s' % (label, ('  (%s)' % str(detail)[:500]) if detail != '' else ''))


TR = r'''(function(){ function R(e){ if(!e) return null; var r=e.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; }
 var ad=document.querySelector('.layerad.show'), sub=ad&&ad.querySelector('.adsub'), pp=document.querySelector('.pairpanel'), code=document.querySelector('.pt-code');
 var ph=document.querySelector('.dev-phone'), soon=document.querySelector('.sp .soon');
 return JSON.stringify({sub:R(sub), pp:R(pp), code:code?getComputedStyle(code).fontFamily:'', phvis:ph?getComputedStyle(ph).visibility:'', soon:soon?parseFloat(getComputedStyle(soon).fontSize):0,
  sw:document.documentElement.scrollWidth, vw:innerWidth}); })()'''
HM = r'''(function(){ var s=document.querySelector('.counter .sub'); var cs=getComputedStyle(s);
 return JSON.stringify({fs:parseFloat(cs.fontSize), ff:cs.fontFamily, sw:document.documentElement.scrollWidth, vw:innerWidth}); })()'''
LHN = r'''(function(){ var a=[].slice.call(document.querySelectorAll('.foot nav a')).map(function(e){var r=e.getBoundingClientRect(); return {h:r.height,w:r.width,r:r.right};});
 return JSON.stringify({a:a, sw:document.documentElement.scrollWidth, vw:innerWidth}); })()'''
PL = r'''(function(){ var b=document.querySelector('.vp-code6 .box'); return JSON.stringify({h:b?parseFloat(getComputedStyle(b).height):0, sw:document.documentElement.scrollWidth, vw:innerWidth}); })()'''
FL = r'''(function(){ var l=document.querySelector('.flabel'); return JSON.stringify({fs:l?parseFloat(getComputedStyle(l).fontSize):0}); })()'''

SIGN = io.open(os.path.join(ROOT, 'venueplay', 'signage.html'), encoding='utf-8').read()
for sel in ('.fld label', '.venue-ro .vlbl', '.plbl'):
    m = re.search(re.escape(sel) + r'\{([^}]*)\}', SIGN)
    fs = re.search(r'font-size:\s*([\d.]+)px', m.group(1)) if m else None
    ok('signage %s is 12px or more' % sel, bool(fs) and float(fs.group(1)) >= 12, m.group(1)[:150] if m else 'rule not found')


def page(S, path, w, h, phone, js, settle=1.5):
    tid, sid = S.open(path, w, h, mobile=phone)
    S.until(sid, 'document.readyState==="complete"', 20)
    S.js(sid, 'document.fonts?document.fonts.ready.then(function(){return 1}):1', wait=True, secs=20); time.sleep(settle)
    M = S.js(sid, js); S.close_tab(tid)
    return json.loads(M) if isinstance(M, str) else {'err': str(M)}


S = admin_site.Site(fonts=True)
try:
    for w, h, ph in ((1280, 800, False), (1440, 900, False)):
        M = page(S, '/training.html', w, h, ph, TR, 2.0)
        sub, pp = M['sub'], M['pp']
        ok('%d px: the ad line on the venue screen ends above the pair caption' % w, bool(sub and pp) and sub['b'] <= pp['t'] + 1, M)
        ok('%d px: the pair caption code line is not mono' % w, 'mono' not in M['code'].lower() and 'jetbrains' not in M['code'].lower(), M['code'])
        ok('%d px: the collapsed phone is hidden' % w, M['phvis'] == 'hidden', M['phvis'])
        ok('%d px: "Live demo" tags are 11px or more' % w, M['soon'] >= 11, M['soon'])
    for w, h, ph in ((375, 812, True), (390, 844, True), (1280, 800, False)):
        M = page(S, '/index.html', w, h, ph, HM, 2.0)
        ok('home %d px: the statistic caption is body font 13px or more' % w, M.get('fs', 0) >= 13 and 'mono' not in M.get('ff', 'mono').lower() and 'jetbrains' not in M.get('ff', 'mono').lower(), M)
        ok('home %d px: no sideways scroll' % w, M.get('sw', 9) <= M.get('vw', 0), M)
    for w, h in ((375, 812), (390, 844)):
        M = page(S, '/live-here-now.html', w, h, True, LHN)
        ok('live-here-now %d px: there is NO footer (no Help, Privacy or Terms links: a game screen, INBOX 405) and nothing scrolls sideways' % w, len(M['a']) == 0 and M.get('sw', 9) <= M.get('vw', 0), M)
    M = page(S, '/app/index.html', 375, 812, True, FL)
    ok('/app sign-in field label is 12px or more', M['fs'] >= 12, M)
    for w, h, ph, want in ((1280, 800, False, 80), (375, 812, True, 0)):
        M = page(S, '/play.html', w, h, ph, PL)
        ok('play %d px: code boxes %s' % (w, 'are 80px or taller' if want else 'stay 60px'), (M['h'] >= want) if want else abs(M['h'] - 60) < 1, M)
        ok('play %d px: no sideways scroll' % w, M.get('sw', 9) <= M.get('vw', 0), M)
finally:
    S.close()
print('\nALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '\n%d OF %d CHECKS FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
