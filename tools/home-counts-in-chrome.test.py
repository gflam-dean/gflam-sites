#!/usr/bin/env python3
"""THE HOMEPAGE BANK COUNTS, PAINTED LIVE, WITH A SANE FALLBACK (Dean, 11 Nov 2026, INBOX 233.1).

The homepage said "39,392 questions" (the database held 39,412) and "6,740 songs", typed. Now the page asks
the billing Worker's GET /library-counts through /app/vp-counts.js and says "Thousands" until (or unless)
a good number lands. tools/test-library-counts.js runs the Worker route and the script in jsc; this opens the
REAL venueplay/index.html and venueplay/nsw.html (the /offer-<month> pages) in headless Chrome
(tools/browser-rig/admin_site.py, its own profile, removed on close) and checks what a visitor SEES:

  live      the Worker answers { questions: 39412, songs: 6740 } (answered in the page's own fetch, so the
            numbers are fixed): the two counters read "39,412" and "6,740", on one line each, inside the
            page at 375 and 1440, nothing scrolls sideways, no script error
  real rig  the page talks to the REAL billing Worker on the rig (tools/browser-rig/billing-stdio.js), which
            has no library to count: the route answers nulls and both counters read "Thousands"
  offline   the Worker cannot be reached at all: both counters read "Thousands", never blank, 0 or NaN
  junk      the Worker answers NaN, a string and a negative: "Thousands" again

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait). Touches no git and no remote.

    python3 tools/home-counts-in-chrome.test.py [--shots DIR]
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
        print('  FAIL %s%s' % (label, ('  (%s)' % (str(detail)[:600],)) if detail != '' else ''))


def answer(js_body):
    """A script run before the page's own: /library-counts is answered by js_body (a function returning a
    Promise of a Response), every other request goes on as normal."""
    return ('(function(){var real=window.fetch;window.fetch=function(u,o){'
            'if(String(u).indexOf("/library-counts")!==-1){window.__countsAsked=(window.__countsAsked||0)+1;return (%s)();}'
            'return real.apply(this,arguments);};})();' % js_body)


LIVE = answer('function(){return Promise.resolve(new Response(JSON.stringify({questions:39412,songs:6740}),'
              '{status:200,headers:{"content-type":"application/json"}}));}')
OFFLINE = answer('function(){return Promise.reject(new TypeError("Failed to fetch"));}')
JUNK = answer('function(){return Promise.resolve(new Response(\'{"questions":"39412","songs":-5}\','
              '{status:200,headers:{"content-type":"application/json"}}));}')
SEEN = r'''(function(){
  function one(id){ var e=document.getElementById(id); if(!e) return null; var r=e.getBoundingClientRect();
    var lh=parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;
    return {text:e.textContent, w:r.width, h:r.height, l:r.left, r:r.right, lines:Math.round(r.height/lh)}; }
  return JSON.stringify({q:one('vp-trivia-count'), s:one('vp-music-count'), vw:innerWidth, sw:document.documentElement.scrollWidth,
    asked:window.__countsAsked||0, errs:(window.__errs||[])});
})()'''

sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib  # noqa: E402
_end = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
while True:
    _st, _pid, _text = gatelib.lock_state()
    if _st in ('free', 'mine') and gatelib.hold_lock_or_refuse('home-counts-in-chrome', wait_s=0):
        break
    if time.time() > _end:
        print('  heavy lock held by pid %s ("%s"); gave up waiting' % (_pid, _text[:80]))
        sys.exit(2)
    time.sleep(0.5)

S = admin_site.Site(fonts=True)
try:
    for page in ('/index.html', '/offer-nov'):
        for w, hgt, phone in ((375, 812, True), (1440, 900, False)):
            for case, pre, want_q, want_s in (('live', LIVE, '39,412', '6,740'), ('real rig', None, 'Thousands', 'Thousands'),
                                              ('offline', OFFLINE, 'Thousands', 'Thousands'), ('junk', JUNK, 'Thousands', 'Thousands')):
                if case in ('real rig', 'junk') and w != 375:
                    continue
                tid, sid = S.open(page, w, hgt, mobile=phone, pre=pre)
                S.until(sid, 'document.readyState==="complete" && !!window.VPCounts', 20)
                S.js(sid, 'document.fonts ? document.fonts.ready.then(function(){return 1;}) : 1', wait=True, secs=20)
                if case == 'live':
                    S.until(sid, 'document.getElementById("vp-trivia-count").textContent==="39,412"', 10)
                else:
                    time.sleep(1.5)   # long enough for a fetch to fail and anything wrong to be painted
                S.js(sid, 'document.getElementById("banks").scrollIntoView({block:"center"});true')
                time.sleep(0.4)
                M = S.json(sid, SEEN, default={}) or {}
                q, s = M.get('q') or {}, M.get('s') or {}
                tag = '%s %d px, %s' % (page.strip('/'), w, case)
                ok('%s: questions reads "%s" and songs reads "%s"' % (tag, want_q, want_s),
                   q.get('text') == want_q and s.get('text') == want_s, [q.get('text'), s.get('text')])
                if case != 'real rig':
                    ok('%s: the page asked the Worker for the counts' % tag, M.get('asked', 0) >= 1, M.get('asked'))
                ok('%s: each counter is on one line, inside the page; nothing scrolls sideways; no script error' % tag,
                   q.get('lines') == 1 and s.get('lines') == 1 and q.get('r', 9e9) <= M.get('vw', 0) and s.get('r', 9e9) <= M.get('vw', 0)
                   and q.get('l', -1) >= 0 and M.get('sw', 9e9) <= M.get('vw', 0) and not M.get('errs'),
                   [q, s, M.get('sw'), M.get('vw'), M.get('errs')])
                if A.shots and case in ('live', 'offline'):
                    os.makedirs(A.shots, exist_ok=True)
                    S.shot(sid, os.path.join(A.shots, 'counts-%s-%d-%s.png' % (page.strip('/').replace('.html', ''), w, case)))
                S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 34
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
