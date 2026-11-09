#!/usr/bin/env python3
"""MUSICAL BINGO: THE WORDS IN THE CARD'S SQUARES, SPACED (Dean, 9 Nov 2026).

Dean looked at the 5 Nov review frames (newlook-musical-5nov/final/14-phone-card.png and 15-phone-card-marked.png):
the song words inside the squares were not spaced correctly. Titles sat low (a 19px strip kept for the tick on every
square), sizes jumped from 11px to 20px square to square, and five words carried a hyphen ("Belie-vin'").

This opens the REAL app/musical/play.html from this checkout, joined by code through the stand-in game Worker of
tools/musical-newlook-in-chrome.test.py (shared, imported), and measures every title from its lines AS DRAWN:
  - in the middle of its square: the same space left and right (1.5px), above and below (2px), never tight to the edge
  - lines 1.15 apart
  - broken only between words; a long word's one hyphen only where it cannot fit whole (never "Believin'")
  - ONE size for the card (half the titles or more at it, nearly all the rest one step down), Free at the same size,
    nothing under 10px (but a 40-letter title on a short phone), nothing cut, nothing narrowed but a word wider than
    its square at 10px; the review card at 14px or more from 375 wide (12px at 360 and on a short phone)
  - tapped: the title clear of its tick, not moved and not resized by the tap
  - the card and the claim on screen without scrolling
at 360x740, 375x812, 390x844, 430x932 and a short phone (375x664), with the review card and a card of very long titles.
Takes /tmp/vp-heavy.lock (VP_WAIT_LOCK seconds to wait).

    python3 tools/musical-card-spacing-in-chrome.test.py
"""
import importlib.util, http.server, json, os, sys, threading, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'tools'))
_spec = importlib.util.spec_from_file_location('musical_newlook', os.path.join(HERE, 'tools', 'musical-newlook-in-chrome.test.py'))
MN = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(MN)
CELLS, ROOM, Page, say, apart = MN.CELLS, MN.ROOM, MN.Page, MN.say, MN.apart

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1


# THE WORDS IN THE SQUARES, SPACED (Dean, 9 Nov 2026, on the 5 Nov review frames 14 and 15: "the song/artist words
# inside the card squares are not spaced correctly"). Every title is measured from its lines AS DRAWN (a Range over
# the text, one rect per line), against the square's inside edge: the same space left and right, the same above and
# below, never tight to the edge; lines 1.15 apart; words broken only between words, or once at a long word's own
# hyphen and only when that word cannot fit whole at the size the square has; ONE size for the card (Free too), a
# title smaller only when it needs to be; a marked square's title clear of its tick and exactly where it was before
# the tap. At 360, 375, 390 and 430 wide, on a short phone (375 x 664), with the review card and with very long titles.
SPACING_PROBE = r"""(function(){
  var out=[];
  [].forEach.call(document.querySelectorAll("#cardGrid .cc"), function(c){
    var cb=c.getBoundingClientRect(), s=getComputedStyle(c), inner=[cb.left+c.clientLeft, cb.top+c.clientTop, cb.left+c.clientLeft+c.clientWidth, cb.top+c.clientTop+c.clientHeight];
    var t=c.querySelector(".ct")||c, node=null; for(var n=t.firstChild;n;n=n.nextSibling){ if(n.nodeType===3){ node=n; break; } }
    var L=1e9,T=1e9,R=-1e9,B=-1e9, ys=[], split=[], hy=[], wholeFits=null;
    if(node){
      var rg=document.createRange(); rg.selectNodeContents(node);
      [].forEach.call(rg.getClientRects(), function(r){ if(r.width<0.5) return; L=Math.min(L,r.left);T=Math.min(T,r.top);R=Math.max(R,r.right);B=Math.max(B,r.bottom);
        var y=(r.top+r.bottom)/2; if(!ys.some(function(z){ return Math.abs(z-y)<3; })) ys.push(y); });
      var txt=node.nodeValue, re=/\S+/g, m;
      while((m=re.exec(txt))){ var w=document.createRange(); w.setStart(node,m.index); w.setEnd(node,m.index+m[0].length); var wy=[];
        [].forEach.call(w.getClientRects(),function(r){ if(r.width<0.5) return; var y=(r.top+r.bottom)/2; if(!wy.some(function(z){return Math.abs(z-y)<4;})) wy.push(y); });
        if(wy.length>1){ if(m[0].indexOf("­")>0 && wy.length===2 && (m[0].match(/­/g)||[]).length===1) hy.push(m[0].replace(/­/g,"")); else split.push(m[0]); } }
      if(hy.length){   /* would the word have fitted whole at this size? put it back without its hyphen and look */
        var keep=node.nodeValue; node.nodeValue=keep.replace(/­/g,""); var cs2=getComputedStyle(c);
        wholeFits = t.offsetWidth <= c.clientWidth-parseFloat(cs2.paddingLeft)-parseFloat(cs2.paddingRight)+0.5 && t.offsetHeight <= c.clientHeight-parseFloat(cs2.paddingTop)-parseFloat(cs2.paddingBottom)+0.5;
        node.nodeValue=keep; }
    }
    var a=getComputedStyle(c,"::after"), tick=null;
    if(a.content && a.content!=="none" && a.content!=="normal"){ var tw=parseFloat(a.width), th=parseFloat(a.height), x1=inner[2]-parseFloat(a.right); tick=[x1-tw, inner[1]+parseFloat(a.top), x1, inner[1]+parseFloat(a.top)+th]; }
    out.push({ txt:(node?node.nodeValue:c.textContent).replace(/­/g,""), fs:parseFloat(s.fontSize), lh:parseFloat(s.lineHeight), free:c.classList.contains("free"), daub:c.classList.contains("daub"),
      inner:inner, text:L<1e9?[L,T,R,B]:null, lines:ys.length, split:split, hy:hy, wholeFits:wholeFits, tick:tick, sq:/scale/.test(t.style&&t.style.transform||"") });
  });
  var b=document.getElementById("bingoBtn").getBoundingClientRect();
  return JSON.stringify({ cells:out, btn:[b.left,b.top,b.right,b.bottom], H:innerHeight, scrollH:document.documentElement.scrollHeight });
})()"""
LONG_CARD = ["Supercalifragilisticexpialidocious", "(I Can't Get No) Satisfaction", "Don't Go Breaking My Heart", "Californication", "Total Eclipse of the Heart",
             "I Would Do Anything for Love (But I Won't Do That)", "Misunderstanding", "Somebody That I Used to Know", "Everybody Wants to Rule the World", "Unbelievable",
             "Bohemian Rhapsody", "Sweet Child O' Mine", "FREE", "Smells Like Teen Spirit", "Livin' on a Prayer",
             "Up", "Hey Ya!", "Wonderwall", "September", "Don't Stop Believin'",
             "Islands in the Stream", "Mr. Brightside", "Hotel California", "Thunderstruck", "You Shook Me All Night Long"]


def spacing_checks(tag, x, w, h, std):
    C = x.get('cells') or []
    T = [c for c in C if not c['free'] and c.get('text')]
    if len(C) != 25 or len(T) != 24:
        ok('%s: the card is dealt, 24 titles and Free' % tag, False, [len(C), len(T)]); return
    pads = [(c['text'][0] - c['inner'][0], c['text'][1] - c['inner'][1], c['inner'][2] - c['text'][2], c['inner'][3] - c['text'][3]) for c in T]
    offc = [(c['txt'], [round(v, 1) for v in p]) for c, p in zip(T, pads) if abs(p[0] - p[2]) > 1.5 or abs(p[1] - p[3]) > 2]
    ok('%s: every title in the middle of its square, the same space left and right (within 1.5px) and above and below (within 2px)' % tag, not offc, offc[:5])
    tight = [(c['txt'], [round(v, 1) for v in p]) for c, p in zip(T, pads) if min(p[0], p[2]) < 3 or min(p[1], p[3]) < 2]
    ok('%s: no title tight to its square\'s edge (3px clear at the sides, 2px above and below, measured from the letters\' boxes)' % tag, not tight, tight[:5])
    ok('%s: lines 1.15 apart, not crowded' % tag, all(c['lh'] >= c['fs'] * 1.14 for c in C), sorted(set(round(c['lh'] / c['fs'], 2) for c in C)))
    bad_split = [(c['txt'], c['split']) for c in T if c['split']]
    ok('%s: titles break only between words, never inside one' % tag, not bad_split, bad_split)
    bad_hy = [(c['txt'], c['hy']) for c in T if c['hy'] and (c['wholeFits'] is not False or "'" in ''.join(c['hy']) or len(c['hy']) > 1)]
    ok('%s: a long word takes its one hyphen only where it cannot fit whole at that size (never a word with an apostrophe)' % tag, not bad_hy, bad_hy)
    fs = [c['fs'] for c in T]; top = max(fs); at = sum(1 for f in fs if abs(f - top) < 0.01)
    step = max(10, int(top * 0.85 * 2) / 2.0); near = sum(1 for f in fs if abs(f - top) < 0.01 or abs(f - step) < 0.01)
    ok('%s: ONE size for the card: half the titles or more at the biggest size (%s of 24 at %spx), and %s or more at it or one step down (%spx), not a ladder of sizes' % (tag, at, top, 20 if std else 14, step),
       at >= 12 and near >= (20 if std else 14) and len(set(fs)) <= (4 if std else 7), sorted(fs))
    ok('%s: Free is at the card\'s size' % tag, abs(C[12]['fs'] - top) < 0.01 and C[12]['free'], [C[12]['fs'], top])
    ok('%s: nothing under 10px (but a title of over 40 letters on a short phone, 7px at the least), nothing cut, nothing narrowed but a word wider than its square at 10px' % tag,
       all(c['fs'] >= 10 or (len(c['txt']) > 40 and c['fs'] >= 7) for c in T) and all(c['text'][0] >= c['inner'][0] - 0.5 and c['text'][2] <= c['inner'][2] + 0.5 and c['text'][1] >= c['inner'][1] - 0.5 and c['text'][3] <= c['inner'][3] + 0.5 for c in T)
       and all(not c['sq'] or c['fs'] <= 10 for c in T), [(c['txt'], c['fs'], c['sq']) for c in T if c['fs'] < 10 or (c['sq'] and c['fs'] > 10)])
    if std:
        ok('%s: the review card\'s titles are as big as the square allows: the card size %spx is 12px or more (14px or more from 375 wide on a full-height phone), none under 10px' % (tag, top),
           top >= (14 if (w >= 375 and h >= 800) else 12) and min(fs) >= 10, sorted(fs)[:4])
    ok('%s: the card and the claim fit the screen, no scrolling' % tag, (x.get('scrollH') or 9999) <= h + 1 and (x.get('btn') or [0, 0, 0, 9999])[3] <= h, [x.get('scrollH'), x.get('btn')])


def spacing(B, base):
    print('\nTHE WORDS IN THE SQUARES, SPACED (Dean, 9 Nov 2026): 360, 375, 390, 430 wide and a short phone')
    keep = list(CELLS)
    try:
        for name, cells, marks in (('the review card', keep, ["Never Gonna Give You Up", "Livin' on a Prayer", "Hey Ya!", "Bohemian Rhapsody", "Dancing Queen", "Khe Sanh", "Mr. Brightside", "The Horses", "Africa", "Wonderwall", "September"]),
                                   ('very long titles', LONG_CARD, ["Bohemian Rhapsody", "Sweet Child O' Mine", "Smells Like Teen Spirit", "Livin' on a Prayer", "Supercalifragilisticexpialidocious", "I Would Do Anything for Love (But I Won't Do That)", "Wonderwall", "Up"])):
            for (w, h) in ((360, 740), (375, 812), (390, 844), (430, 932), (375, 664)):
                CELLS[:] = cells
                tag = '%s %dx%d' % (name, w, h)
                P = Page(B, base, '/app/musical/play.html?sting=0&room=' + ROOM, w, h, True, 'try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}')
                try:
                    P.until('document.getElementById("vJoin") && !document.getElementById("vJoin").classList.contains("hidden")', 20); time.sleep(0.6)
                    P.js(say('vp-' + ROOM, [{'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': []}])); time.sleep(0.3)
                    P.js('(function(){ document.getElementById("nameIn").value="Sam"; document.getElementById("joinBtn").click(); return 1; })()')
                    P.until('!document.getElementById("vWait").classList.contains("hidden")', 15); time.sleep(0.3)
                    P.js(say('vp-' + ROOM, [{'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'game_id': 'g1'}]))
                    P.until('!document.getElementById("vCard").classList.contains("hidden") && document.querySelectorAll("#cardGrid .cc").length===25', 15); time.sleep(1.2)
                    x0 = P.obj(SPACING_PROBE) or {}
                    spacing_checks(tag, x0, w, h, cells is keep)
                    for s_ in marks:
                        P.js('(function(){ var c=[].filter.call(document.querySelectorAll("#cardGrid .cc"),function(x){ return (x.textContent||"").replace(/\\u00AD/g,"")===%s; })[0]; if(c) c.click(); return !!c; })()' % json.dumps(s_))
                    time.sleep(0.5)
                    x1 = P.obj(SPACING_PROBE) or {}
                    C0, C1 = x0.get('cells') or [], x1.get('cells') or []
                    mk = [(a, b) for a, b in zip(C0, C1) if b['daub'] and not b['free']]
                    ok('%s: %d squares marked by a tap' % (tag, len(marks)), len(mk) == len(marks), [b['txt'] for a, b in mk])
                    ok('%s: a marked square\'s title is clear of its tick' % tag, all(b['tick'] and b['text'] and apart(b['text'], b['tick']) for a, b in mk) and bool(C1) and C1[12]['tick'] and apart(C1[12]['text'], C1[12]['tick']),
                       [(b['txt'], b['text'], b['tick']) for a, b in mk if not (b['tick'] and b['text'] and apart(b['text'], b['tick']))])
                    ok('%s: and its title has not moved or changed size with the tap' % tag, all(a['text'] and b['text'] and a['fs'] == b['fs'] and max(abs(u - v) for u, v in zip(a['text'], b['text'])) < 0.6 for a, b in mk),
                       [(a['txt'], a['text'], b['text']) for a, b in mk if not (a['text'] and b['text'] and max(abs(u - v) for u, v in zip(a['text'], b['text'])) < 0.6)][:3])
                    if w == 375 and h == 664: P.shot('spacing-%s-375x664' % ('std' if cells is keep else 'long'))
                finally:
                    P.close()
    finally:
        CELLS[:] = keep


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('musical-card-spacing-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), MN.Site)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % srv.server_address[1]
    B = MN.VL.Browser()
    try:
        spacing(B, base)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
