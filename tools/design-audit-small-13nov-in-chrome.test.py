#!/usr/bin/env python3
"""DESIGN AUDIT 13 NOV 2026, THE SMALL FAULTS (INBOX 353g).

Opens the REAL pages in headless Chrome (tools/browser-rig/admin_site.py) and checks, with the real fonts:
  1. the TV set-up page on a PHONE (375, 390): "Put in the screen code" is one tidy button (its text inside it,
     no taller than 90px) and the Google Play badge is not cropped (its picture is no wider than its box);
     on a TV (1280) the two buttons keep their TV size (26cqw, so 333px)
  2. the host header on a phone (375, 390): the buttons (My email, Switch venue, Account, Help, ...) wrap inside
     the screen, nothing is wider than the screen, on every page that carries the header
  3. the TV set-up page has no spaced capitals (letter-spacing of 0.08em or more on uppercase text)
Touches no git and no remote.    python3 tools/design-audit-small-13nov-in-chrome.test.py
"""
import io, json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1; print('  ok   %s' % label)
    else:
        FAIL[0] += 1; print('  FAIL %s%s' % (label, ('  (%s)' % str(detail)[:500]) if detail != '' else ''))


TV = r'''(function(){ function R(e){ if(!e) return null; var r=e.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; }
 var btn=document.getElementById('tvSetupCode'), gp=document.getElementById('tvPlayLink'), img=gp&&gp.querySelector('img.gp-badge');
 var spaced=[]; [].forEach.call(document.querySelectorAll('body *'),function(e){ var cs=getComputedStyle(e); if(cs.display==='none') return;
   var r=e.getBoundingClientRect(); if(!r.width) return; var fs=parseFloat(cs.fontSize);
   if(cs.textTransform==='uppercase'&&(parseFloat(cs.letterSpacing)||0)/fs>=0.08&&e.childNodes.length&&[].some.call(e.childNodes,function(n){return n.nodeType===3&&n.textContent.trim();})) spaced.push(e.tagName+'.'+e.className); });
 var s=document.querySelector('.su-store'); 
 return JSON.stringify({vw:innerWidth,sw:document.documentElement.scrollWidth,btn:R(btn),gp:R(gp),img:R(img),store:R(s),spaced:spaced}); })()'''
HDR = r'''(function(){ var h=document.getElementById('hactions'); var bs=[].map.call(h?h.children:[],function(b){var r=b.getBoundingClientRect(); return {r:r.right,l:r.left,w:r.width};});
 var cs=h?getComputedStyle(h).display:''; return JSON.stringify({vw:innerWidth,sw:document.documentElement.scrollWidth,disp:cs,bs:bs}); })()'''
import re
SRC = io.open(os.path.join(ROOT, 'venueplay', 'tv.html'), encoding='utf-8').read()
for sel in ('.tv-status', '.tv-fs', '#tvHold .heye', '.tv-join .tjl', '.bvissuelbl'):
    m = re.search(re.escape(sel) + r'\{([^}]*)\}', SRC)
    ok('the CSS of %s has no spaced capitals' % sel, bool(m) and not re.search(r'letter-spacing:\s*\.(0[89]|[1-9])', m.group(1)) and 'text-transform:uppercase' not in m.group(1), m.group(1)[:200] if m else 'rule not found')
S = admin_site.Site(fonts=True)
try:
    for w, h, phone in ((375, 812, True), (390, 844, True), (1280, 800, False)):
        tid, sid = S.open('/tv.html', w, h, mobile=phone)
        S.until(sid, 'document.readyState==="complete"', 20)
        S.js(sid, 'document.fonts?document.fonts.ready.then(function(){return 1}):1', wait=True, secs=20); time.sleep(1.5)
        M = json.loads(S.js(sid, TV)); b, g, im = M['btn'] or {}, M['gp'] or {}, M['img'] or {}
        ok('%d px: the TV set-up page does not scroll sideways' % w, M['sw'] <= M['vw'], M)
        ok('%d px: "Put in the screen code" is a tidy button (inside its card, one or two lines)' % w, b and b['h'] <= 90 and b['w'] >= 200 and b['r'] <= M['vw'], b)
        if im and im['w']:
            ok('%d px: the Google Play badge is not cropped by its box' % w, im['w'] <= g['w'] + 1, [im, g])
        if w == 1280:
            ok('1280 px: on a TV the buttons keep the TV size (26cqw)', 280 <= b['w'] <= 345, b)
        ok('%d px: the TV set-up page has no spaced capitals' % w, not M['spaced'], M['spaced'])
        S.close_tab(tid)
    for page in ('index', 'settings', 'billing', 'onboard', 'marketing', 'report'):
        for w, h in ((375, 812), (390, 844)):
            tid, sid = S.open('/app/%s.html' % page, w, h, mobile=True)
            S.until(sid, 'document.readyState==="complete"', 20); time.sleep(2.0)
            M = json.loads(S.js(sid, HDR))
            shown = M['disp'] not in ('none', '')
            ok('%s %d px: the header buttons stay inside the screen' % (page, w), (not M['bs']) or not shown or (max(x['r'] for x in M['bs']) <= M['vw'] and M['sw'] <= M['vw']), M)
            S.close_tab(tid)
finally:
    S.close()
print('\nALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '\n%d OF %d CHECKS FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
