#!/usr/bin/env python3
"""WEBSITE AUDIT PART 1, THE SMALL FAULTS (INBOX 361A, 13 Nov 2026).

Opens the REAL public pages in headless Chrome (tools/browser-rig/admin_site.py):
  1. on a phone (375, 390) every link and icon in the public footer (home, help, terms, privacy) is at least 44px
     tall and wide, the Facebook and Instagram icons included, and nothing scrolls sideways
  2. the trivia player page's game code box has an accessible name (it had only a placeholder)
Touches no git and no remote.    python3 tools/website-audit-p1-13nov-in-chrome.test.py
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


FOOT = r'''(function(){ var small=[]; var els=document.querySelectorAll('footer a');
 for(var i=0;i<els.length;i++){ var r=els[i].getBoundingClientRect(); var cs=getComputedStyle(els[i]); if(cs.display==='none'||!r.width) continue;
  if(r.height<43.5||r.width<43.5) small.push((els[i].getAttribute('aria-label')||els[i].textContent.trim()).slice(0,24)+' '+Math.round(r.width)+'x'+Math.round(r.height)); }
 return JSON.stringify({n:els.length,small:small,vw:innerWidth,sw:document.documentElement.scrollWidth,social:document.querySelectorAll('footer .foot-social a').length}); })()'''
S = admin_site.Site(fonts=True)
try:
    for page in ('/help', '/terms', '/privacy'):
        for w, h in ((375, 812), (390, 844)):
            tid, sid = S.open(page, w, h, mobile=True)
            S.until(sid, 'document.readyState==="complete"', 20)
            S.js(sid, 'document.fonts?document.fonts.ready.then(function(){return 1}):1', wait=True, secs=20); time.sleep(1.2)
            M = S.json(sid, FOOT)
            ok('%s %d px: the footer has links and the two social icons' % (page, w), M['n'] >= 6 and M['social'] == 2, M)
            ok('%s %d px: every footer link and icon is at least 44px tall and wide' % (page, w), not M['small'], M['small'])
            ok('%s %d px: the page does not scroll sideways' % (page, w), M['sw'] <= M['vw'], M)
            S.close_tab(tid)
    tid, sid = S.open('/index.html', 375, 812, mobile=True)
    S.until(sid, 'document.readyState==="complete"', 20); time.sleep(1.5)
    M = S.json(sid, FOOT)
    ok('home 375 px: every footer link and icon is at least 44px', not M['small'], M['small'])
    S.close_tab(tid)
    tid, sid = S.open('/app/trivia/play.html', 375, 812, mobile=True)
    S.until(sid, 'document.readyState==="complete"', 20); time.sleep(1.0)
    ok('trivia player: the game code box has an accessible name', S.js(sid, 'document.getElementById("roomIn").getAttribute("aria-label")') == 'Game code')
    S.close_tab(tid)
finally:
    S.close()
print('\nALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '\n%d OF %d CHECKS FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
