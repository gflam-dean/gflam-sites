#!/usr/bin/env python3
"""THE FLIP BOARD SHOWS THE WHOLE WINNER NAME (INBOX 426 item 6, 16 Nov 2026).

On the real-night run of 16 Nov the name row of the members draw's flip board lost the bottom of its letters under the flap line, at
both TV sizes (reports/tue17-real-night, members 13-drawing, 20-winner). The type was 96 px lifted 17 px (vp-drawstyle.js makeMod), so the
caps rode the top of the row and the seam sliced the feet; a long name also ran past the flap's sides. On the browser rig, the real
members screen at the TV sizes 1920x1080 and 1280x720, for a short, a very short, a descender-heavy (g, j, y) and a long name:

  1. every letter of the name sits inside the name flap: the ink of the type (measured from the font the page is really using)
     starts at least 4 px below the flap's top and ends at least 4 px above its bottom, descenders included
  2. the name fits across the flap with room at both sides (a long name steps down in size, never runs out of the flap)
  3. the name is centred on the seam (the cap line and the baseline sit the same distance either side), like the digits
  4. the flap is the same height as before and the board, prize line, claim line and clock all stay inside the screen
  VP_SHOTS=<dir> keeps a picture of every case.

    python3 tools/tv-flip-name-in-chrome.test.py
"""
import importlib.util, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig')); sys.path.insert(0, HERE)
import rig as RIG
import gatelib

spec = importlib.util.spec_from_file_location('tvd', os.path.join(HERE, 'tv-drawstyle-in-chrome.test.py'))
T = importlib.util.module_from_spec(spec); spec.loader.exec_module(T)
SHOTS = os.environ.get('VP_SHOTS', '')
if not SHOTS and os.path.isdir('/home/vp/venue-enrich/reports'):
    SHOTS = '/home/vp/venue-enrich/reports/flip-name-shots'
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
ran = bad = 0
NAMES = ['Mia Wilson', 'Jo Li', 'Gregory Jaquelyn Young', 'Alexandria Montgomery-Smith']


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    sys.stdout.flush()
    if not cond: bad += 1


# In the name flap's own pixels (the page may be scaled to the TV: everything is divided back by the scale). The ink of the TEXT shown on the
# top half (the bottom half is the same text at the same place) is measured with canvas from the half's computed font; the line box is the flap's height, so the baseline is
# (lineHeight - (fontAscent + fontDescent)) / 2 + fontAscent below the top of the text box.
MEAS = r'''(function(){
 var ms=document.querySelectorAll("#tvStyleHost .vpds-m"), m=ms[ms.length-1]; if(!m) return null;
 var mr=m.getBoundingClientRect(), k=mr.width/m.offsetWidth, out={h:m.offsetHeight,w:m.offsetWidth,k:k,halves:[]};
 var cv=document.createElement("canvas").getContext("2d");
 [].forEach.call(m.querySelectorAll(".vpds-ht"),function(h){
   var ch=h.querySelector(".vpds-ch"), cs=getComputedStyle(ch), txt=ch.textContent; if(!txt.trim()) return;
   if(h.style.visibility==="hidden"||getComputedStyle(h).visibility==="hidden") return;
   cv.font=cs.font; cv.textAlign="center"; var t=cv.measureText(txt), fa=t.fontBoundingBoxAscent, fd=t.fontBoundingBoxDescent, lh=parseFloat(cs.lineHeight);
   var base=(lh-(fa+fd))/2+fa+parseFloat(ch.style.top||0);   // the top half starts at the flap's top, so this is in flap pixels
   out.halves.push({cls:h.className,txt:txt,font:cs.font,size:parseFloat(cs.fontSize),inkTop:base-t.actualBoundingBoxAscent,inkBottom:base+t.actualBoundingBoxDescent,
     inkLeft:(m.offsetWidth/2)-t.actualBoundingBoxLeft,inkRight:(m.offsetWidth/2)+t.actualBoundingBoxRight,base:base,
     capTop:base-cv.measureText("H").actualBoundingBoxAscent, mid:base-cv.measureText("H").actualBoundingBoxAscent/2});
 });
 return JSON.stringify(out);})()'''


def run(w, h):
    print('\nTV %dx%d' % (w, h))
    for ni, nm in enumerate(NAMES):
        r = RIG.Rig()
        try:
            s = T.screen(r, '/app/members/screen', w, h)
            T.says(r, s, [{'t': 'drawing', 'drawName': 'Thursday draw', 'minNumber': 1, 'maxNumber': 900, 'spinSecs': 4.2, 'style': 'flip', 'drawSecs': 3},
                          {'t': 'pick', 'number': 107, 'name': nm}])
            time.sleep(5.2)
            T.says(r, s, [{'t': 'winner', 'number': 107, 'name': nm, 'claimSecs': 30}])
            time.sleep(3.5)
            raw = r.ask(s, MEAS)
            m = json.loads(raw) if raw and raw != 'HUNG' else None
            tag = '%dx%d-%s' % (w, h, nm.split()[0].lower())
            if SHOTS: r.shot(s, os.path.join(SHOTS, 'flip-%s.jpg' % tag))
            ok('%s: the name flap is on the board with its name' % nm, bool(m) and bool(m['halves']) and all(nm in x['txt'] for x in m['halves']), raw)
            if not m or not m['halves']: continue
            H, W = m['h'], m['w']
            ok('%s: the flap is still 124 px tall' % nm, H == 124, H)
            top = min(x['inkTop'] for x in m['halves']); bot = max(x['inkBottom'] for x in m['halves'])
            ok('%s: the top of the letters is at least 4 px inside the flap' % nm, top >= 4, [round(top, 1), H])
            ok('%s: the bottom of the letters, descenders included, is at least 4 px inside the flap' % nm, bot <= H - 4, [round(bot, 1), H])
            left = min(x['inkLeft'] for x in m['halves']); right = max(x['inkRight'] for x in m['halves'])
            ok('%s: the name fits across the flap with room at both sides' % nm, left >= 8 and right <= W - 8, [round(left, 1), round(right, 1), W])
            x0 = m['halves'][0]
            ok('%s: the capital letters are centred on the seam (the middle of a capital is within 6 px of the middle of the flap)' % nm, abs(x0['mid'] - H / 2.0) <= 6, [round(x0['mid'], 1), H / 2.0])
            ok('%s: the board, prize, claim and clock stay inside the screen' % nm, T.inside(r, s) == [], T.inside(r, s))
        finally:
            r.close()


if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('tv-flip-name-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    run(1920, 1080)
    run(1280, 720)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
