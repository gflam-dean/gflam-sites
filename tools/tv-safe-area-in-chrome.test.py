#!/usr/bin/env python3
"""EVERY TV SCREEN INSIDE A 5% TITLE-SAFE MARGIN, IN A REAL BROWSER (INBOX 287.1 / 295.2f, 12 Nov 2026).

Dean's photos of the Kogan TV app (12 Nov): the venue logo top left and the called board on the right
looked cut off. A TV may crop its picture's edges (overscan), so every TV screen keeps its words, numbers,
logos and pictures inside the middle 90% of the picture: 5% in from each edge (/app/vp-tvsafe.css).

What this plays, on the browser rig: /tv and the trivia, musical bingo, raffle and members draw screens in
their own demo nights (?demo=1, which run every state of the game by themselves), at 1920x1080 and 1280x720.
Every second and a half for the length of the demo it measures every piece of content that is painted on
the screen (an element with words of its own, an <img>, <canvas> or <video>, or a shape an <svg> draws, showing, not
transparent, and the part of it not clipped away by a box around it) and fails if any of it reaches into
the 5% border (an <svg> by the shapes it draws, not its box). Each screen's wall box (.tv) must also start 5% in.

    python3 tools/tv-safe-area-in-chrome.test.py          screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'browser-rig'))
import rig as RIG

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    sys.stdout.flush()
    if not cond: bad += 1

# Everything painted outside the safe box, as "tag#id.class 'words' [l,t,r,b]". A piece of content is an
# element with a text node of its own, or an img/svg/canvas/video; it counts when it is showing (display,
# visibility, opacity through its parents) and only the part not clipped by an overflow box around it.
# Elements inside a same-site frame are measured in the frame and moved by the frame's own place.
OUTSIDE = r'''(function(){
  var W=innerWidth,H=innerHeight,mx=W*0.05,my=H*0.05,out=[],seen=0;
  function vis(el,win){ var o=1; for(var e=el;e&&e.nodeType===1;e=e.parentElement){ var s=win.getComputedStyle(e);
      if(s.display==="none"||s.visibility==="hidden") return 0; o*=parseFloat(s.opacity||"1"); } return o; }
  function clip(el,win,r){ var a={l:r.left,t:r.top,r:r.right,b:r.bottom};
    for(var e=el.parentElement;e&&e.nodeType===1;e=e.parentElement){ var s=win.getComputedStyle(e);
      if(s.overflow!=="visible"||s.overflowX!=="visible"||s.overflowY!=="visible"){ var c=e.getBoundingClientRect();
        a.l=Math.max(a.l,c.left);a.t=Math.max(a.t,c.top);a.r=Math.min(a.r,c.right);a.b=Math.min(a.b,c.bottom);} }
    a.l=Math.max(a.l,0);a.t=Math.max(a.t,0);a.r=Math.min(a.r,win.innerWidth);a.b=Math.min(a.b,win.innerHeight); return a; }
  function own(el){ for(var n=el.firstChild;n;n=n.nextSibling) if(n.nodeType===3&&/\S/.test(n.nodeValue)) return n.nodeValue.replace(/\s+/g," ").trim(); return ""; }
  function walk(doc,win,dx,dy){
    var all=doc.body?doc.body.getElementsByTagName("*"):[];
    for(var i=0;i<all.length;i++){ var el=all[i], tg=el.tagName;
      if(tg==="IFRAME"){ try{ var f=el.contentDocument; if(f&&vis(el,win)>0.05){ var fr=el.getBoundingClientRect(); walk(f,el.contentWindow,dx+fr.left,dy+fr.top); } }catch(e){} continue; }
      if(tg==="SCRIPT"||tg==="STYLE"||tg==="NOSCRIPT"||tg==="TEMPLATE") continue;
      /* An <svg> is measured by what it DRAWS (its paths, shapes, words, pictures), not its box: the start-of-game
         show is a full-window svg stage whose art sits in the middle of it. */
      var w=own(el), media=/^(IMG|CANVAS|VIDEO|path|rect|circle|ellipse|polygon|polyline|line|text|image|use)$/.test(tg);
      if(tg==="svg"||tg==="SVG"||tg==="g"||tg==="defs"||tg==="clipPath"||tg==="mask"||tg==="filter") continue;
      if(el.closest&&el.closest("defs,clipPath,mask,filter,pattern,symbol")) continue;
      if(!w&&!media) continue;
      var r=el.getBoundingClientRect(); if(r.width<1||r.height<1) continue;
      if(vis(el,win)<0.05) continue;
      var a=clip(el,win,r); if(a.r-a.l<1||a.b-a.t<1) continue;
      a.l+=dx;a.r+=dx;a.t+=dy;a.b+=dy; seen++;
      if(a.l<mx-1||a.t<my-1||a.r>W-mx+1||a.b>H-my+1)
        out.push(tg.toLowerCase()+(el.id?"#"+el.id:"")+(typeof el.className==="string"&&el.className?"."+el.className.split(/\s+/)[0]:"")+
                 (w?" '"+w.slice(0,24)+"'":"")+" ["+[a.l,a.t,a.r,a.b].map(Math.round).join(",")+"]");
    }
  }
  walk(document,window,0,0);
  return JSON.stringify({seen:seen,out:out.slice(0,12),n:out.length});
})()'''

# Where each screen's wall box (.tv) sits: its left, top, right and bottom gaps to the window, in px.
TV_BOX = '(function(){var t=document.querySelector(".tv");if(!t)return null;var r=t.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(innerWidth-r.right),Math.round(innerHeight-r.bottom)];})()'

SCREENS = [
    ('the TV (/tv), the bingo demo night', '/tv?demo=1&venue=%(slug)s', 34),
    ('the trivia screen', '/app/trivia/screen?demo=1', 30),
    ('the musical bingo screen', '/app/musical/screen?demo=1', 30),
    ('the raffle screen', '/app/raffle/screen?demo=1', 26),
    ('the members draw screen', '/app/members/screen?demo=1', 26),
]
SIZES = [(1920, 1080), (1280, 720)]


def one(r, label, path, secs, w, h):
    tid, sid = r.open(path % {'slug': r.W.info['slug']}, width=w, height=h)
    try:
        r.until(sid, 'document.readyState==="complete"', 20)
        time.sleep(1.5)
        box = r.ask(sid, TV_BOX)
        want = [round(w * 0.05), round(h * 0.05), round(w * 0.05), round(h * 0.05)]
        ok('%s at %dx%d: its wall sits 5%% in from every edge %s' % (label, w, h, want),
           isinstance(box, list) and all(abs(a - b) <= 1 for a, b in zip(box, want)), box)
        worst, seen, t_end, k = None, 0, time.time() + secs, 0
        while time.time() < t_end:
            v = r.json(sid, OUTSIDE, default={}) or {}
            seen = max(seen, v.get('seen', 0))
            if v.get('n') and worst is None:
                worst = v
                if SHOTS: r.shot(sid, os.path.join(SHOTS, 'safe-%s-%dx%d.jpg' % (path.split('?')[0].strip('/').replace('/', '-'), w, h)))
            k += 1
            time.sleep(1.5)
        ok('CONTROL: %s at %dx%d painted content to measure (%d pieces at most, %d looks)' % (label, w, h, seen, k), seen >= 5, seen)
        ok('%s at %dx%d: nothing painted in the 5%% border for the whole demo' % (label, w, h), worst is None, worst)
    finally:
        r.close_tab(tid)


if __name__ == '__main__':
    r = RIG.Rig()
    try:
        for (label, path, secs) in SCREENS:
            for (w, h) in SIZES:
                one(r, label, path, secs if w == 1920 else max(12, secs // 2), w, h)
    finally:
        r.close()
    # the gate reads the last line: "ALL n CHECKS PASSED" is a pass (release-check suite_passed)
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
