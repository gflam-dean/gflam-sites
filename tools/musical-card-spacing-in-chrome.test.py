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
10 NOV 2026 (Dean's live sign-off, builds INBOX 140) REPLACES the 9 Nov size and hyphen rules: ONE size for the whole card,
15px or more, NO hyphen ever (a title's own hyphen is not a break either), a card that cannot hold 15px on the screen's
width made wider and swiped, nothing cut; a note under the card (the early-mark note) moves and resizes no square; Free
has its own look. Also the card from the live check (Test Charlie, "Sur-render", "Thunder-struck").
Drives a real headless Chrome through verify-live.py's browser (imported via musical-newlook-in-chrome.test.py).
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
    var L=1e9,T=1e9,R=-1e9,B=-1e9, ys=[], split=[], hy=[], wholeFits=null, lr=[];
    if(node){
      var rg=document.createRange(); rg.selectNodeContents(node);
      [].forEach.call(rg.getClientRects(), function(r){ if(r.width<0.5) return; lr.push([r.left,r.top,r.right,r.bottom]); L=Math.min(L,r.left);T=Math.min(T,r.top);R=Math.max(R,r.right);B=Math.max(B,r.bottom);
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
    if(a.content && a.content!=="none" && a.content!=="normal" && a.display!=="none"){ var tw=parseFloat(a.width), th=parseFloat(a.height), x1=inner[2]-parseFloat(a.right); tick=[x1-tw, inner[1]+parseFloat(a.top), x1, inner[1]+parseFloat(a.top)+th]; }
    out.push({ lines_r:lr, bg:s.backgroundColor, tile:[cb.left,cb.top,cb.right,cb.bottom], raw:(node?node.nodeValue:c.textContent), txt:(node?node.nodeValue:c.textContent).replace(/­/g,""), fs:parseFloat(s.fontSize), lh:parseFloat(s.lineHeight), free:c.classList.contains("free"), daub:c.classList.contains("daub"),
      inner:inner, text:L<1e9?[L,T,R,B]:null, lines:ys.length, split:split, hy:hy, wholeFits:wholeFits, tick:tick, sq:/scale/.test(t.style&&t.style.transform||"") });
  });
  var b=document.getElementById("bingoBtn").getBoundingClientRect();
  var g=document.getElementById("cardGrid"), sl=document.getElementById("noteSlot"), nb=document.getElementById("bingoNote");
  var sr=sl?sl.getBoundingClientRect():null;
  return JSON.stringify({ cells:out, btn:[b.left,b.top,b.right,b.bottom], H:innerHeight, scrollH:document.documentElement.scrollHeight, scrollW:document.documentElement.scrollWidth,
    aw:parseFloat(g.style.getPropertyValue("--aw")||"1"), slot:sr?[sr.left,sr.top,sr.right,sr.bottom]:null, note:(nb && !nb.classList.contains("hidden"))?nb.textContent:"",
    noteBox:(nb && !nb.classList.contains("hidden"))?(function(r){ return [r.left,r.top,r.right,r.bottom]; })(nb.getBoundingClientRect()):null,
    hint:(function(h){ return h && !h.classList.contains("hidden") ? h.textContent : ""; })(document.getElementById("noteHint")) });
})()"""
LONG_CARD = ["Supercalifragilisticexpialidocious", "(I Can't Get No) Satisfaction", "Don't Go Breaking My Heart", "Californication", "Total Eclipse of the Heart",
             "I Would Do Anything for Love (But I Won't Do That)", "Misunderstanding", "Somebody That I Used to Know", "Everybody Wants to Rule the World", "Unbelievable",
             "Bohemian Rhapsody", "Sweet Child O' Mine", "FREE", "Smells Like Teen Spirit", "Livin' on a Prayer",
             "Up", "Hey Ya!", "Wonderwall", "September", "Don't Stop Believin'",
             "Islands in the Stream", "Mr. Brightside", "Hotel California", "Thunderstruck", "You Shook Me All Night Long"]
# Test Charlie's card at Dean's 10 Nov 2026 live sign-off (shot 34): "Sur-render", "Thunder-struck", 9px titles
LIVE_CARD = ["I'd Do Anything for Love (But I Won't Do That)", "I Want You to Want Me", "Gimme Shelter", "Life in the Fast Lane", "My Coo-Ca-Choo",
             "Take a Long Line", "Don't Stop Believin'", "You Took the Words Right Out of My Mouth (Hot Summer Night)", "Am I Ever Gonna See Your Face Again", "Surrender",
             "Down Down", "Thunderstruck", "FREE", "I Got You Babe", "In the Summertime",
             "Great Southern Land", "Oh, Pretty Woman", "Laughter In The Rain", "Bad Company", "Keep Your Hands to Yourself",
             "Baba O'Riley", "Gimme Some Lovin'", "The Mighty Quinn", "Cold As Ice", "The Horses"]


def spacing_checks(tag, x, w, h, std):
    """Dean's 10 Nov 2026 rules (live sign-off, builds INBOX 140): ONE size for the whole card, 15px or more, NO hyphen
    ever, lines broken on spaces only, nothing cut; a card that cannot make 15px on the screen's width is made wider
    and swiped (never smaller first); Free its own look."""
    C = x.get('cells') or []
    T = [c for c in C if not c['free'] and c.get('text')]
    if len(C) != 25 or len(T) != 24:
        ok('%s: the card is dealt, 24 titles and Free' % tag, False, [len(C), len(T)]); return
    pads = [(c['text'][0] - c['inner'][0], c['text'][1] - c['inner'][1], c['inner'][2] - c['text'][2], c['inner'][3] - c['text'][3]) for c in T]
    offc = [(c['txt'], [round(v, 1) for v in p]) for c, p in zip(T, pads) if abs(p[0] - p[2]) > 1.5 or abs(p[1] - p[3]) > 2.5]
    ok('%s: every title in the middle of its square (left/right within 1.5px, above/below within 2.5px)' % tag, not offc, offc[:5])
    tight = [(c['txt'], [round(v, 1) for v in p]) for c, p in zip(T, pads) if min(p[0], p[2]) < 3 or min(p[1], p[3]) < 2]
    ok('%s: no title tight to its square\'s edge (3px at the sides, 2px above and below)' % tag, not tight, tight[:5])
    ok('%s: lines 1.15 apart' % tag, all(c['lh'] >= c['fs'] * 1.14 for c in C), sorted(set(round(c['lh'] / c['fs'], 2) for c in C)))
    bad_split = [(c['txt'], c['split'] + c['hy']) for c in T if c['split'] or c['hy']]
    ok('%s: NO hyphen and no word broken: lines break on spaces only (Dean, 10 Nov 2026)' % tag, not bad_split and not any('\u00ad' in (c.get('raw') or '') for c in T), bad_split)
    fs = sorted(set(c['fs'] for c in C))
    ok('%s: ONE size for the whole card, Free included (%s)' % (tag, fs), len(fs) == 1, fs)
    aw = x.get('aw') or 1
    ok('%s: 15px or more (%spx), unless even the widest card (2.2x) cannot hold a word (aw %s)' % (tag, fs[0], aw), fs[0] >= 15 or aw >= 2.19, [fs, aw])
    ok('%s: the card is only made wider when 15px cannot fit on the screen\'s width (aw %s, %spx)' % (tag, aw, fs[0]), aw <= 1.001 or abs(fs[0] - 15) < 0.01 or aw >= 2.19, [aw, fs])
    cut = [c['txt'] for c in T if not (c['text'][0] >= c['inner'][0] - 0.5 and c['text'][2] <= c['inner'][2] + 0.5 and c['text'][1] >= c['inner'][1] - 0.5 and c['text'][3] <= c['inner'][3] + 0.5) or (c['sq'] and not (aw >= 2.19 and c['fs'] <= 11))]
    ok('%s: nothing cut off, and nothing narrowed but a word no phone can hold (at 11px on the widest card)' % tag, not cut, cut)
    hs = [round(c['tile'][3] - c['tile'][1], 1) for c in C]
    ok('%s: every square 64px tall or more (%s)' % (tag, min(hs)), min(hs) >= 64 - 0.5, hs[:5])
    ok('%s: Free looks different from a marked square (its own colour, no tick)' % tag, C[12]['free'] and not C[12]['tick'] and C[12]['bg'] not in ('rgb(43, 13, 29)',), [C[12]['bg'], C[12]['tick']])
    ok('%s: the page never scrolls sideways (only the card does, inside its own frame)' % tag, (x.get('scrollW') or 9999) <= w + 1, x.get('scrollW'))
    ok('%s: the card and the claim fit the screen, no scrolling' % tag, (x.get('scrollH') or 9999) <= h + 1 and (x.get('btn') or [0, 0, 0, 9999])[3] <= h, [x.get('scrollH'), x.get('btn')])
    ok('%s: the slot under the card says "%s"' % (tag, x.get('hint')), x.get('hint') == ('Swipe the card sideways to see every song.' if aw > 1.001 else 'Tap a song when you hear it.'), [x.get('hint'), aw])


def note_checks(tag, x0, x1):
    """The card never shrinks for a note (Dean, 10 Nov 2026): the same squares, the same sizes, before and after."""
    C0, C1 = x0.get('cells') or [], x1.get('cells') or []
    ok('%s: the early-mark note is up after the claim tap ("%s")' % (tag, x1.get('note')), 'not played yet' in (x1.get('note') or ''), x1.get('note'))
    moved = [(a['txt'], a['tile'], b['tile']) for a, b in zip(C0, C1) if max(abs(u - v) for u, v in zip(a['tile'], b['tile'])) > 0.5 or a['fs'] != b['fs']]
    ok('%s: with the note up, every square is exactly where and as big as it was, and the same font size' % tag, len(C0) == 25 and len(C1) == 25 and not moved, moved[:3])
    nb, sl = x1.get('noteBox'), x1.get('slot')
    ok('%s: the note sits inside its own slot, under the card' % tag, bool(nb and sl) and nb[1] >= sl[1] - 0.5 and nb[3] <= sl[3] + 0.5 and nb[1] >= max(c['tile'][3] for c in C1) - 0.5, [nb, sl])
    ok('%s: the slot did not change size' % tag, bool(x0.get('slot') and sl) and abs((x0['slot'][3] - x0['slot'][1]) - (sl[3] - sl[1])) < 0.5, [x0.get('slot'), sl])
    cut = [c['txt'] for c in T_(C1) if not (c['text'][1] >= c['inner'][1] - 0.5 and c['text'][3] <= c['inner'][3] + 0.5 and c['text'][2] <= c['inner'][2] + 0.5)]
    ok('%s: with the note up, no title cut off' % tag, not cut, cut)


def T_(C):
    return [c for c in C if not c['free'] and c.get('text')]


def spacing(B, base):
    print('\nTHE CARD: ONE SIZE, 15px, NO HYPHEN, NEVER SHRUNK BY A NOTE (Dean, 10 Nov 2026): 360, 375, 390, 430 wide and a short phone')
    keep = list(CELLS)
    try:
        for name, cells, marks in (('the review card', keep, ["Never Gonna Give You Up", "Livin' on a Prayer", "Hey Ya!", "Bohemian Rhapsody", "Dancing Queen", "Khe Sanh", "Mr. Brightside", "The Horses", "Africa", "Wonderwall", "September"]),
                                   ('the 10 Nov live card', LIVE_CARD, ["Down Down", "Thunderstruck", "I Got You Babe", "In the Summertime", "Surrender"]),
                                   ('very long titles', LONG_CARD, ["Bohemian Rhapsody", "Sweet Child O' Mine", "Smells Like Teen Spirit", "Livin' on a Prayer", "Supercalifragilisticexpialidocious", "I Would Do Anything for Love (But I Won't Do That)", "Wonderwall", "Up"])):
            for (w, h) in ((360, 740), (375, 812), (390, 844), (430, 932), (375, 664), (390, 690)):
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
                        P.js('(function(){ var c=[].filter.call(document.querySelectorAll("#cardGrid .cc"),function(x){ return (x.getAttribute("aria-label")||x.textContent||"")===%s; })[0]; if(c) c.click(); return !!c; })()' % json.dumps(s_))
                    time.sleep(0.5)
                    x1 = P.obj(SPACING_PROBE) or {}
                    C0, C1 = x0.get('cells') or [], x1.get('cells') or []
                    mk = [(a, b) for a, b in zip(C0, C1) if b['daub'] and not b['free']]
                    ok('%s: %d squares marked by a tap' % (tag, len(marks)), len(mk) == len(marks), [b['txt'] for a, b in mk])
                    ok('%s: a marked square\'s title (every line as drawn) is clear of its tick' % tag, all(b['tick'] and b['lines_r'] and all(apart(r, b['tick']) for r in b['lines_r']) for a, b in mk),
                       [(b['txt'], b['lines_r'], b['tick']) for a, b in mk if not (b['tick'] and b['lines_r'] and all(apart(r, b['tick']) for r in b['lines_r']))])
                    ok('%s: and its title has not moved or changed size with the tap' % tag, all(a['text'] and b['text'] and a['fs'] == b['fs'] and max(abs(u - v) for u, v in zip(a['text'], b['text'])) < 0.6 for a, b in mk),
                       [(a['txt'], a['text'], b['text']) for a, b in mk if not (a['text'] and b['text'] and max(abs(u - v) for u, v in zip(a['text'], b['text'])) < 0.6)][:3])
                    P.js('document.getElementById("bingoBtn").click()'); time.sleep(0.6)
                    x2 = P.obj(SPACING_PROBE) or {}
                    note_checks(tag, x1, x2)
                    if w == 375 and h == 664: P.shot('spacing-%s-375x664' % ('std' if cells is keep else 'live' if cells is LIVE_CARD else 'long'))
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
