#!/usr/bin/env python3
"""THE HOME PAGE HERO, "RUN A PACKED TUESDAY. EVERY TUESDAY.", LINED UP AT EVERY WIDTH (2 Nov 2026).

Dean, on his iPhone, 2 Nov 2026: the section "looks out of alignment with a logo in the corner".
Measured with the real fonts: on any screen over 900px (an iPad, a laptop, an iPhone asking for the
desktop site) the heading box was centred in the LEFT-aligned copy column, so "RUN A PACKED" started
about 54px in from the venueplay wordmark in the corner, the words under it and the buttons. The cause
was the site-wide centring rule `.hero h1{margin:auto}` (written for the one-column heroes) landing on
the two-column hero after its own `.hero2 h1{margin:0}`. On a phone the hero is one column and is
centred on purpose (Dean, 23 Sep 2026), and must stay that way.

Opens the REAL venueplay/index.html in headless Chrome (tools/browser-rig/admin_site.py, its own
profile, removed on close) with the real fonts, and at each width:
  phone (375, 390, 430): the heading, its every line, the lede and the buttons are centred on the
     screen within 2px; nothing overlaps the heading; nothing scrolls sideways
  wide (980, 1024, 1280): the heading's left edge is the lede's, the buttons' and the wordmark's,
     within 1px; nothing overlaps the heading; nothing scrolls sideways

Touches no git and no remote. Screenshots with --shots DIR.

    python3 tools/home-hero-in-chrome.test.py [--shots DIR]
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


MEASURE = r'''(function(){
  function R(el){ if(!el) return null; var r=el.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; }
  var h=document.querySelector('#top h1');
  var lines=[]; if(h){ var rg=document.createRange(); rg.selectNodeContents(h);
    // one box per visual line: merge the client rects that share a top
    [].forEach.call(rg.getClientRects(), function(r){ if(!r.width) return; var t=Math.round(r.top);
      var L=lines.filter(function(x){return Math.abs(x.t-t)<4;})[0]; if(L){L.l=Math.min(L.l,r.left);L.r=Math.max(L.r,r.right);} else lines.push({t:t,l:r.left,r:r.right}); }); }
  var hits=[]; if(h){ var hb=h.getBoundingClientRect();
    [].forEach.call(document.querySelectorAll('body *'), function(e){ if(e.contains(h)||h.contains(e)) return;
      var r=e.getBoundingClientRect(); if(!r.width||!r.height) return; var cs=getComputedStyle(e);
      if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0) return;
      if(r.left<hb.right-1&&r.right>hb.left+1&&r.top<hb.bottom-1&&r.bottom>hb.top+1) hits.push(e.tagName+'.'+String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className).slice(0,40)); }); }
  return JSON.stringify({vw:innerWidth, sw:document.documentElement.scrollWidth, h1:R(h), lines:lines,
    lede:R(document.querySelector('#top .lede')), cta:R(document.querySelector('#top .hero-cta .btn')),
    price:R(document.querySelector('#top .h2-price')), logo:R(document.querySelector('header .logo svg, header .logo img, header .logo')),
    ledeText:(function(){var l=document.querySelector('#top .lede'); if(!l) return null; var rg=document.createRange(); rg.selectNodeContents(l); var rs=[].filter.call(rg.getClientRects(),function(r){return r.width>0;}); return rs.length?{l:Math.min.apply(null,rs.map(function(r){return r.left;})),r:Math.max.apply(null,rs.map(function(r){return r.right;}))}:null;})(),
    over:hits, fonts:document.fonts?document.fonts.status:''});
})()'''

S = admin_site.Site(fonts=True)
try:
    for w, h, phone in ((375, 812, True), (390, 844, True), (430, 932, True), (980, 1200, False), (1024, 768, False), (1280, 900, False)):
        tid, sid = S.open('/index.html', w, h, mobile=phone)
        S.until(sid, 'document.readyState==="complete"', 20)
        S.js(sid, 'document.fonts ? document.fonts.ready.then(function(){return 1;}) : 1', wait=True, secs=20)
        time.sleep(1.2)
        S.js(sid, 'scrollTo(0,0);true')
        time.sleep(0.3)
        M = S.js(sid, MEASURE)
        M = json.loads(M) if isinstance(M, str) else {}
        tag = '%d px' % w
        h1, lede, cta, logo, lines = M.get('h1') or {}, M.get('lede') or {}, M.get('cta') or {}, M.get('logo') or {}, M.get('lines') or []
        ok('%s: the fonts loaded, the page does not scroll sideways' % tag, M.get('fonts') == 'loaded' and M.get('sw', 9999) <= M.get('vw', 0), [M.get('fonts'), M.get('sw'), M.get('vw')])
        ok('%s: nothing overlaps the heading (no logo, badge or demo on it)' % tag, h1 and not M.get('over'), M.get('over'))
        if w == 375:
            # INBOX 280 (12 Nov 2026): what Google reads off the page as served. Every structured-data name is
            # "venueplay" in lowercase, and no block publishes the support landline (it is never public).
            LD = S.js(sid, '(function(){var n=[],t=0,bad=[];function walk(o){if(Array.isArray(o)){o.forEach(walk);return;}if(o&&typeof o==="object"){Object.keys(o).forEach(function(k){if(k==="name")n.push(o[k]);if(k==="telephone")t++;walk(o[k]);});}}'
                       '[].forEach.call(document.querySelectorAll(\'script[type="application/ld+json"]\'),function(s){try{walk(JSON.parse(s.textContent));}catch(e){bad.push(String(e));}});'
                       'return JSON.stringify({blocks:document.querySelectorAll(\'script[type="application/ld+json"]\').length,names:n,tel:t,bad:bad});})()')
            LD = json.loads(LD) if isinstance(LD, str) else {}
            ok('structured data: both blocks parse and all 4 names say "venueplay", lowercase, never "VenuePlay"',
               LD.get('blocks') == 2 and not LD.get('bad') and LD.get('names') == ['venueplay'] * 4, LD)
            ok('structured data: no "telephone" anywhere in it (the support line is never on a public page)',
               LD.get('blocks') == 2 and LD.get('tel') == 0, LD)
        if phone:
            mid = M['vw'] / 2.0
            cen = lambda b: (b['l'] + b['r']) / 2.0
            ok('%s: the heading box and every one of its %d lines are centred on the screen (within 2px)' % (tag, len(lines)),
               h1 and len(lines) >= 2 and abs(cen(h1) - mid) <= 2 and all(abs(cen(L) - mid) <= 2 for L in lines), [mid, h1, lines])
            ok('%s: the words under it and the first button are centred too' % tag,
               lede and cta and abs(cen(lede) - mid) <= 2 and abs(cen(cta) - mid) <= 2, [mid, lede, cta])
        else:
            lt = M.get('ledeText') or {}
            ok('%s: the heading starts where the words under it, the first button and the price line start (within 1px)' % tag,
               h1 and lt and cta and abs(h1['l'] - lt['l']) <= 1 and abs(h1['l'] - cta['l']) <= 1 and abs(h1['l'] - (M.get('price') or {}).get('l', -99)) <= 1,
               [h1.get('l'), lt.get('l'), cta.get('l'), (M.get('price') or {}).get('l')])
            ok('%s: and its first line starts there too, in line with the wordmark in the corner' % tag,
               lines and abs(lines[0]['l'] - h1['l']) <= 3 and logo and abs(h1['l'] - logo['l']) <= 3, [lines[:1], h1.get('l'), logo.get('l')])
        # Job 447 (Dean, 16 Nov 2026): the demo telly is centred, stands on a neck and foot, and the phone never covers its screen.
        T = S.js(sid, '(function(){function R(e){if(!e)return null;var r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width};}'
                      'return JSON.stringify({stage:R(document.getElementById("h2Stage")),tv:R(document.querySelector(".h2-tv")),scr:R(document.querySelector(".h2-tvscreen")),'
                      'stand:R(document.querySelector(".h2-tvstand")),ph:R(document.querySelector(".h2-phonebox")),'
                      'neck:getComputedStyle(document.querySelector(".h2-tvstand"),"::before").content+" "+getComputedStyle(document.querySelector(".h2-tvstand"),"::before").width,foot:getComputedStyle(document.querySelector(".h2-tvstand"),"::after").content+" "+getComputedStyle(document.querySelector(".h2-tvstand"),"::after").width});})()')
        T = json.loads(T) if isinstance(T, str) else {}
        st, tv, sc, sd, ph = [T.get(k) or {} for k in ('stage', 'tv', 'scr', 'stand', 'ph')]
        ok('%s: the demo TV is centred in its stage (within 2px) and stands on a neck and a foot below it' % tag,
           st and tv and sd and abs((tv['l'] + tv['r']) / 2 - (st['l'] + st['r']) / 2) <= 2 and sd['t'] >= tv['b'] - 1 and sd['b'] - sd['t'] >= 16
           and str(T.get('neck', '')).startswith('"" ') and str(T.get('foot', '')).startswith('"" ') and not str(T.get('neck')).endswith(' 0px'), T)
        ok('%s: the phone sits beside the TV and does not cover any of its screen' % tag,
           ph and sc and (ph['l'] >= sc['r'] - 1 or ph['t'] >= sc['b'] - 1) and ph['r'] <= st['r'] + 1, T)
        if A.shots:
            os.makedirs(A.shots, exist_ok=True)
            S.shot(sid, os.path.join(A.shots, 'home-hero-%d.png' % w))
        S.close_tab(tid)
finally:
    S.close()

total = PASS[0] + FAIL[0]
print('')
EXPECTED = 38
if total != EXPECTED:
    print('EXPECTED %d checks and ran %d.' % (EXPECTED, total))
    sys.exit(1)
print(('ALL %d CHECKS PASSED' % total) if not FAIL[0] else ('%d of %d checks passed' % (PASS[0], total)))
sys.exit(1 if FAIL[0] else 0)
