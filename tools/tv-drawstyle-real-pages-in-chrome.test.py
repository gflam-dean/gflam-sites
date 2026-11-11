#!/usr/bin/env python3
"""THE DRAW LOOKS INSIDE THE REAL TV PAGES, LAID OUT AND MEASURED (11 Nov 2026, INBOX 207).

Why this exists: on the real raffle TV the ticket roll broke at the win. The ticket's pink frame and its number fell out of
the ticket and sat over "Meat tray", because /app/raffle/screen.html has its own `.body` rule (the frame between the header and
the strip) and /app/vp-drawstyle.js named the ticket's inner div "body". The draw-looks suites passed, because nothing measured
the look INSIDE the page that shows it with that page's own CSS in force.

So, on the rig (tools/browser-rig/rig.py: the repo's pages in headless Chrome), for BOTH real screens (/app/raffle/screen and
/app/members/screen), at 1920x1080 and 1280x720, EVERY look in BOTH modes (ticket roll, flip board, race plate; raffle and
members) is made on the screen's own #tvStyleHost, given the pick and stepped to its win picture, then:

  1. THE SAME AS ON A BARE PAGE: every box of the stage is measured with the page's CSS on, then again with every page
     stylesheet switched off but the look's own (and the fonts), and the two must match to a pixel, with the same position,
     display and text alignment. Any rule of the host page reaching into the look (a shared class name, an inherited
     alignment) shows here, whichever class it is.
  2. THE TICKET: the inner part (the pink frame's box) sits inside the paper ticket and is the frame's anchor (positioned),
     the number sits inside the frame, and the prize line and the winner line sit below the ticket, never over it.
  3. THE MEMBER CARD: everything printed on it is inside the card; the prize and winner line are clear of it.
  4. THE FLIP BOARD: every flap is inside the board; the prize and winner line are below it.
  5. THE RACE PLATE: the number and the name are inside the white plate, the prize in the top band, the line in the bottom one.
  6. every line of words on the wall is inside the screen.

Screenshots go to $VP_SHOTS if set.
    python3 tools/tv-drawstyle-real-pages-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import rig as RIG
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:1500]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

LOOKS = (('ticket', 'raffle'), ('ticket', 'members'), ('flip', 'raffle'), ('flip', 'members'), ('race', 'raffle'), ('race', 'members'))
PAGES = ('/app/raffle/screen', '/app/members/screen')
SIZES = ((1920, 1080), (1280, 720))

# make the look on the page's own host, as the page does, and step it to the win picture
MAKE = r'''(function(style, mode){
  var host=document.getElementById("tvStyleHost"), lay=document.getElementById("tvStyle");
  Array.prototype.forEach.call(document.querySelectorAll(".layer"),function(l){ if(l!==lay) l.classList.add("hidden"); });
  lay.classList.remove("hidden");
  if(window.__rpCtl){ try{ window.__rpCtl.destroy(); }catch(e){} }
  var c=VPDrawStyle.create(host,{style:style, mode:mode, digits:3, min:1, max:150, drawSecs:6, prize:"Meat tray",
    venueName:"Bodalla Pub", name:"Sunday meats", prizeNo:1, prizeOf:32, drawn:[12,88]});
  window.__rpCtl=c; c.setPick({number:47, name:"J. Hollis"}); c.setClock("Claim within 2:59"); c.seek(c.total);
  return c.style;
})'''

# every box of the stage, in the stage's own 1920 units, with the styles a host page could change
MEASURE = r'''(function(){
  var host=document.getElementById("tvStyleHost"), st=host.querySelector(".vpds-stage"); if(!st) return null;
  var sb=st.getBoundingClientRect(), k=sb.width/1920, out=[];
  Array.prototype.forEach.call(st.querySelectorAll("*"),function(e,i){
    var b=e.getBoundingClientRect(), cs=getComputedStyle(e);
    out.push({i:i, c:(typeof e.className==="string"?e.className:"")||e.tagName.toLowerCase(),
      r:[(b.left-sb.left)/k,(b.top-sb.top)/k,b.width/k,b.height/k].map(function(x){return Math.round(x*10)/10;}),
      p:cs.position, d:cs.display, ta:cs.textAlign, fs:cs.fontSize});
  });
  return out;
})()'''

# the same, with every page stylesheet off but the look's own and the fonts
BARE = r'''(function(){
  var off=[];
  Array.prototype.forEach.call(document.styleSheets,function(s){
    var n=s.ownerNode, href=(n&&n.href)||"";
    if(n && n.id==="vpdsCss") return; if(/fonts\.googleapis/.test(href)) return;
    if(!s.disabled){ s.disabled=true; off.push(s); }
  });
  var m=%s;
  off.forEach(function(s){ s.disabled=false; });
  return m;
})()''' % MEASURE

# the geometry the eye checks, in screen px; text by its own glyph box (a Range), not the full-width line it sits in
GEOM = r'''(function(style, mode){
  var host=document.getElementById("tvStyleHost");
  function R(e){ if(!e) return null; var b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}; }
  /* a line of words: across, the glyphs' own extent (a Range; a nowrap line can run past its box); down, its line box (the
     element, whose height is its line-height), since a face's ascent reaches above the line it is set on */
  function T(e){ if(!e||!(e.textContent||"").trim()||!e.getClientRects().length) return null; var g=document.createRange(); g.selectNodeContents(e); var b=g.getBoundingClientRect(), x=e.getBoundingClientRect();
    if(getComputedStyle(e).display==="inline") x=b; return {l:b.left,t:x.top,r:b.right,b:x.bottom,w:b.width,h:x.height}; }
  var o={W:innerWidth,H:innerHeight, prize:T(host.querySelector(".vpds-prize")), claim:T(host.querySelector(".vpds-claim")),
         clock:T(host.querySelector(".vpds-clock")), pno:T(host.querySelector(".vpds-pno"))};
  if(style==="ticket"){
    var win=null; Array.prototype.forEach.call(host.querySelectorAll(".vpds-it"),function(d){ if(d.style.zIndex==="5") win=d; });
    var card=win&&win.firstElementChild; o.card=R(card);
    if(mode==="raffle"){
      var inner=card&&card.firstElementChild; o.inner=R(inner); o.innerPos=inner?getComputedStyle(inner).position:"";
      var fr=inner?getComputedStyle(inner,"::before"):null; o.framePos=fr?fr.position:"";
      o.parts=inner?Array.prototype.map.call(inner.children,function(c){ return {c:c.className, t:T(c)}; }):[];
      o.no=T(inner&&inner.lastElementChild);
    } else {
      o.parts=card?Array.prototype.map.call(card.children,function(c){ return {c:c.className, t:(c.tagName==="IMG"||c.className.indexOf("band")>=0)?(c.offsetWidth?R(c):null):T(c)}; }):[];
    }
  } else if(style==="flip"){
    o.board=R(host.querySelector(".vpds-board"));
    o.flaps=Array.prototype.map.call(host.querySelectorAll(".vpds-m"),R);
  } else {
    o.top=R(host.querySelector(".vpds-top")); o.plate=R(host.querySelector(".vpds-plate")); o.bot=R(host.querySelector(".vpds-bot"));
    var best=null; Array.prototype.forEach.call(host.querySelectorAll(".vpds-ri"),function(d){ var b=d.getBoundingClientRect();
      if(d.style.visibility!=="hidden" && o.plate && Math.abs((b.top+b.bottom)/2-(o.plate.t+o.plate.b)/2)<8) best=d; });
    o.no=T(best&&best.firstElementChild); o.wname=T(host.querySelector(".vpds-wname"));
  }
  return JSON.stringify(o);
})'''

def inside(a, b, tol=2):
    return bool(a) and bool(b) and a['l'] >= b['l'] - tol and a['t'] >= b['t'] - tol and a['r'] <= b['r'] + tol and a['b'] <= b['b'] + tol
def clear(a, b, tol=0):
    """a and b do not overlap (either missing counts as clear only when it has no words to show)"""
    if not a or not b: return True
    return a['r'] <= b['l'] + tol or a['l'] >= b['r'] - tol or a['b'] <= b['t'] + tol or a['t'] >= b['b'] - tol
def centred_in(a, b, tol=4):
    """a's words run across inside b, and a's middle is inside b (a tall face's ascent may reach past a band it is set in)"""
    if not a or not b: return False
    m = (a['t'] + a['b']) / 2
    return a['l'] >= b['l'] - tol and a['r'] <= b['r'] + tol and b['t'] - tol <= m <= b['b'] + tol
def onscreen(a, W, H):
    return a is None or (a['l'] >= -1 and a['t'] >= -1 and a['r'] <= W + 1 and a['b'] <= H + 1)

def diff(real, bare):
    if not real or not bare or len(real) != len(bare): return ['element count %s vs %s' % (len(real or []), len(bare or []))]
    out = []
    for a, b in zip(real, bare):
        if a['r'][2] == 0 and a['r'][3] == 0 and b['r'][2] == 0 and b['r'][3] == 0: continue   # paints nothing
        if any(abs(x - y) > 1.0 for x, y in zip(a['r'], b['r'])) or a['p'] != b['p'] or a['d'] != b['d'] or a['ta'] != b['ta'] or a['fs'] != b['fs']:
            out.append('%s: page %s %s %s %s / bare %s %s %s %s' % (a['c'], a['r'], a['p'], a['ta'], a['fs'], b['r'], b['p'], b['ta'], b['fs']))
    return out

def screen(r, path, width, height):
    slug = r.W.info['slug']
    _, s = r.open(path + '?venue=' + slug + '&sting=0', width=width, height=height,
                  before='try{sessionStorage.setItem("vpTvHop", %s)}catch(e){};' % json.dumps(slug))
    r.until(s, 'document.readyState==="complete" && !!window.VPDrawStyle && !!document.getElementById("tvStyleHost")', 20)
    r.until(s, 'document.fonts && document.fonts.status==="loaded"', 10)
    time.sleep(1.0)
    return s

def run():
    r = RIG.Rig()
    try:
        for path in PAGES:
            page = path.split('/')[2]
            for (w, h) in SIZES:
                print('\n%s at %dx%d' % (path, w, h))
                s = screen(r, path, w, h)
                for style, mode in LOOKS:
                    tag = '%s %dx%d %s/%s' % (page, w, h, style, mode)
                    got = r.ask(s, MAKE + '(%s,%s)' % (json.dumps(style), json.dumps(mode)))
                    time.sleep(0.3)
                    if got != style:
                        ok(tag + ': the look is made on the page', False, got); continue
                    real = r.ask(s, MEASURE); bare = r.ask(s, BARE)
                    d = diff(real, bare)
                    ok(tag + ': the look is laid out exactly as on a bare page (no rule of the screen reaches into it)', not d, d[:4])
                    g = r.json(s, GEOM + '(%s,%s)' % (json.dumps(style), json.dumps(mode)), {}) or {}
                    W, H = g.get('W'), g.get('H')
                    words = [g.get(k) for k in ('prize', 'claim', 'clock', 'pno')]
                    ok(tag + ': every line of words is inside the screen', all(onscreen(x, W, H) for x in words), words)
                    if style == 'ticket' and mode == 'raffle':
                        ok(tag + ': the pink frame\'s box sits inside the paper ticket and anchors the frame', inside(g.get('inner'), g.get('card')) and g.get('innerPos') == 'relative' and g.get('framePos') == 'absolute', [g.get('inner'), g.get('card'), g.get('innerPos'), g.get('framePos')])
                        ok(tag + ': the number, venue, "Raffle ticket" and the raffle\'s name sit inside the frame', bool(g.get('no')) and all(inside(p['t'], g.get('inner')) for p in g.get('parts', []) if p['t']), [g.get('inner'), [p for p in g.get('parts', []) if p['t'] and not inside(p['t'], g.get('inner'))]])
                        ok(tag + ': the frame and the number are clear of the prize and the winner line (they sit below the ticket)', bool(g.get('prize')) and clear(g.get('prize'), g.get('inner')) and clear(g.get('claim'), g.get('inner')) and clear(g.get('prize'), g.get('no')) and g['prize']['t'] >= g['inner']['b'] - 2, [g.get('prize'), g.get('claim'), g.get('inner'), g.get('no')])
                    elif style == 'ticket':
                        ok(tag + ': everything printed on the member card is inside it', bool(g.get('card')) and all(inside(p['t'], g.get('card')) for p in g.get('parts', []) if p['t']), [g.get('card'), [p for p in g.get('parts', []) if p['t'] and not inside(p['t'], g.get('card'))]])
                        ok(tag + ': the card\'s number and name are clear of the prize and the winner line', all(clear(g.get(k), p['t']) for k in ('prize', 'claim') for p in g.get('parts', []) if p['t'] and p['c'] in ('vpds-no', 'vpds-nm', 'no', 'nm')), [g.get('prize'), g.get('claim'), g.get('parts')])
                    elif style == 'flip':
                        ok(tag + ': every flap is inside the board', bool(g.get('flaps')) and all(inside(f, g.get('board')) for f in g['flaps']), [g.get('board'), g.get('flaps')])
                        ok(tag + ': the prize and the winner line sit below the board', bool(g.get('prize')) and g['prize']['t'] >= g['board']['b'] - 2 and clear(g.get('claim'), g.get('board')), [g.get('prize'), g.get('claim'), g.get('board')])
                    else:
                        ok(tag + ': the number and the name are inside the white plate', centred_in(g.get('no'), g.get('plate')) and (mode == 'raffle' or centred_in(g.get('wname'), g.get('plate'))), [g.get('no'), g.get('wname'), g.get('plate')])
                        ok(tag + ': the prize is in the top band and the winner line in the bottom band', centred_in(g.get('prize'), g.get('top')) and centred_in(g.get('claim'), g.get('bot')), [g.get('prize'), g.get('top'), g.get('claim'), g.get('bot')])
                    shot(r, s, 'real-%s-%s-%s-%dx%d' % (page, style, mode, w, h))
                errs = r.ask(s, 'window.__errs') or []
                ok('%s %dx%d: no page errors' % (page, w, h), not errs, errs)
    finally:
        r.close()

if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('tv-drawstyle-real-pages-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    run()
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
