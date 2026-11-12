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
12 NOV 2026, OPTION C (Dean via main INBOX 323, 12 Nov; tools/MUSICAL-CARD-DECISION.md) REPLACES the 10 Nov "15px or
more" and the wider, swiped card: all five columns on one screen, NO swipe, ever; a long word takes the WHOLE card down
evenly to 10px (one size still; 11px could not hold the review card at 360 wide or on a short phone clear of the
ticks, so the floor is 10px); only at 10px may a word too wide for its square be narrowed, whole. Plus the text-size
row in the slot under the card for the first 30 seconds of the game, then in the menu, the size kept (vp-mzoom).
12 NOV 2026 ~20:35, PER SQUARE (Dean via main INBOX 337, 12 Nov) REPLACES "one size for the whole card": every square
takes the biggest size that fits its OWN title, broken between words; only a square that cannot fit (one long word, or a
very long title) goes smaller, never the whole card; Free at the middle size of the titles. Real Pub Classics cards too.
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
    var up=null;   /* INBOX 337: 1px bigger, would this title still sit inside its square on whole words, clear of a 10px tick? */
    if(!c.classList.contains("free") && t!==c && node){
      var fs0=c.style.fontSize, tf0=t.style.transform, f1=parseFloat(s.fontSize)+1; c.style.fontSize=f1+"px"; t.style.transform="";
      var cs1=getComputedStyle(c), W1=c.clientWidth-parseFloat(cs1.paddingLeft)-parseFloat(cs1.paddingRight), H1=c.clientHeight-parseFloat(cs1.paddingTop)-parseFloat(cs1.paddingBottom);
      var cb1=c.getBoundingClientRect(), x0=cb1.right-c.clientLeft-3-10-1, y1=cb1.top+c.clientTop+3+10+1, clear=true, rg1=document.createRange(); rg1.selectNodeContents(node);
      [].forEach.call(rg1.getClientRects(), function(r){ if(r.width>0.5 && r.top<y1 && r.right>x0) clear=false; });
      up = t.offsetWidth<=W1+0.5 && t.offsetHeight<=H1+0.5 && clear;
      c.style.fontSize=fs0; t.style.transform=tf0; }
    out.push({ up:up, lines_r:lr, bg:s.backgroundColor, tile:[cb.left,cb.top,cb.right,cb.bottom], raw:(node?node.nodeValue:c.textContent), txt:(node?node.nodeValue:c.textContent).replace(/­/g,""), fs:parseFloat(s.fontSize), lh:parseFloat(s.lineHeight), free:c.classList.contains("free"), daub:c.classList.contains("daub"),
      inner:inner, text:L<1e9?[L,T,R,B]:null, lines:ys.length, split:split, hy:hy, wholeFits:wholeFits, tick:tick, sq:/scale/.test(t.style&&t.style.transform||"") });
  });
  var b=document.getElementById("bingoBtn").getBoundingClientRect();
  var g=document.getElementById("cardGrid"), sl=document.getElementById("noteSlot"), nb=document.getElementById("bingoNote");
  var sr=sl?sl.getBoundingClientRect():null;
  return JSON.stringify({ cells:out, btn:[b.left,b.top,b.right,b.bottom], H:innerHeight, scrollH:document.documentElement.scrollHeight, scrollW:document.documentElement.scrollWidth,
    aw:parseFloat(g.style.getPropertyValue("--aw")||"1"), slot:sr?[sr.left,sr.top,sr.right,sr.bottom]:null, note:(nb && !nb.classList.contains("hidden"))?nb.textContent:"",
    noteBox:(nb && !nb.classList.contains("hidden"))?(function(r){ return [r.left,r.top,r.right,r.bottom]; })(nb.getBoundingClientRect()):null,
    hint:(function(h){ return h && !h.classList.contains("hidden") ? h.textContent : ""; })(document.getElementById("noteHint")),
    sizeNow:(function(z){ if(!z || z.classList.contains("hidden")) return null; var r=z.getBoundingClientRect(), d=document.getElementById("szDown").getBoundingClientRect(), u=document.getElementById("szUp").getBoundingClientRect();
      return { box:[r.left,r.top,r.right,r.bottom], down:[d.left,d.top,d.right,d.bottom], up:[u.left,u.top,u.right,u.bottom], txt:z.textContent }; })(document.getElementById("sizeNow")) });
})()"""
LONG_CARD = ["Supercalifragilisticexpialidocious", "(I Can't Get No) Satisfaction", "Don't Go Breaking My Heart", "Californication", "Total Eclipse of the Heart",
             "I Would Do Anything for Love (But I Won't Do That)", "Misunderstanding", "Somebody That I Used to Know", "Everybody Wants to Rule the World", "Unbelievable",
             "Bohemian Rhapsody", "Sweet Child O' Mine", "FREE", "Smells Like Teen Spirit", "Livin' on a Prayer",
             "Up", "Hey Ya!", "Wonderwall", "September", "Don't Stop Believin'",
             "Islands in the Stream", "Mr. Brightside", "Hotel California", "Thunderstruck", "You Shook Me All Night Long"]
# 12 Nov 2026 (option C): a card whose every word fits at 15px on the narrowest phone; it must stay 15px or more,
# so a fitter that shrinks a card for nothing is red (the other three cards all hold a long word and go down evenly).
SHORT_CARD = ["Up", "Help!", "Faith", "Jump", "Kiss", "Vogue", "Angie", "Layla", "Creep", "Torn", "Hello", "Hurt",
              "FREE", "Fame", "Iris", "Toxic", "Waves", "Hero", "Wings", "Shout", "Mama", "Lola", "Smile", "Rio", "Gold"]
# 12 Nov 2026 (INBOX 337): REAL cards from the Pub Classics playlist (venueplay/data/musical-library.json). PUB_CARD is a
# card as dealt (a seeded draw of 24 Pub Classics titles); PUB_LONG holds the 20 longest Pub Classics titles as the square
# shows them, plus the four with the longest single words.
PUB_CARD = ["You Might Think", "Shout", "Nutbush City Limits", "In the Summertime", "Hitch Hiker", "Thunderstruck", "Wonderwall", "Wild Thing",
            "Cathy's Clown", "Boom Boom", "Who Can It Be Now?", "Needles and Pins", "FREE", "Living Doll", "Great Southern Land",
            "How Am I Supposed to Live Without You", "Blue Sky Mine", "Ooh La La", "Grease", "I'd Do Anything for Love (But I Won't Do That)",
            "Because I Love You", "Overkill", "Reckless", "Bad Company", "Don't Go Breaking My Heart"]
PUB_LONG = ["When the Going Gets Tough, The Tough Get Going", "Tie a Yellow Ribbon 'Round the Ole Oak Tree", "You Took the Words Right Out of My Mouth",
            "(I Can't Help) Falling in Love With You", "How Am I Supposed to Live Without You", "Have You Ever Really Loved a Woman?",
            "Am I Ever Gonna See Your Face Again", "All I Wanna Do Is Make Love to You", "Rockin' Around the Christmas Tree",
            "(Everything I Do) I Do It for You", "I Just Want to Be Your Everything", "Can't Stop Myself from Loving You", "FREE",
            "The Best Things In Life Are Free", "These Boots Are Made for Walkin'", "Everybody Needs Somebody to Love", "You've Lost That Lovin' Feelin'",
            "Killing Me Softly with His Song", "I Just Called To Say I Love You", "Lay Back In the Arms of Someone", "Before the Next Teardrop Falls",
            "Thunderstruck", "Wonderwall", "That's Entertainment", "L.A. International Airport"]
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
    # REPINNED 12 Nov 2026 (Dean via main INBOX 337, 12 Nov): was "ONE size for the whole card, Free included". Now every
    # square takes the biggest size that fits ITS OWN title; only a square that cannot fit goes smaller, never the card.
    small = [(c['txt'], c['fs']) for c in T if c.get('up') and c['fs'] + 1 <= 20 + 0.01 and not c['sq']]
    ok('%s: every title is the biggest size that fits its own square (1px bigger would not fit; sizes %s to %s)' % (tag, fs[0], fs[-1]), not small, small[:5])
    ts = sorted(c['fs'] for c in T); mid = ts[len(ts) // 2]
    ok('%s: Free is drawn at the middle size of the titles (%spx, middle %spx)' % (tag, C[12]['fs'], mid), abs(C[12]['fs'] - mid) < 0.01, [C[12]['fs'], ts])
    if std is True or std == 'pub':
        ok('%s: a long word brings only its own square down: the card is not one size (%s to %spx)' % (tag, fs[0], fs[-1]), fs[-1] >= fs[0] + 3, fs)
    aw = x.get('aw') or 1
    # REPINNED 12 Nov 2026 (option C, Dean via main INBOX 323): was "15px or more unless the widest card (2.2x) cannot hold a word"
    ok('%s: 10px or more (%spx): a long word brings the whole card down evenly, never under 10px (option C)' % (tag, fs[0]), fs[0] >= 10 - 0.01, [fs, aw])
    if std == 'short':
        ok('%s: a card of short titles stays 15px or more (%spx): only a long word ever brings the card down' % (tag, fs[0]), fs[0] >= 15 - 0.01, fs)
    # REPINNED 12 Nov 2026 (option C): was "the card is only made wider when 15px cannot fit on the screen's width"
    right = max(c['tile'][2] for c in C)
    ok('%s: the card is never wider than the screen: all five columns on it, no sideways swipe (aw %s, right edge %s)' % (tag, aw, round(right, 1)), aw <= 1.001 and right <= w - 16 + 1, [aw, right, w])
    # REPINNED 12 Nov 2026 (option C): was "nothing narrowed but a word no phone can hold (at 11px on the widest card)"
    cut = [c['txt'] for c in T if not (c['text'][0] >= c['inner'][0] - 0.5 and c['text'][2] <= c['inner'][2] + 0.5 and c['text'][1] >= c['inner'][1] - 0.5 and c['text'][3] <= c['inner'][3] + 0.5) or (c['sq'] and not c['fs'] <= 10)]
    ok('%s: nothing cut off, and nothing narrowed but a word too wide for its square at 10px (narrowed whole, never split)' % tag, not cut, cut)
    hs = [round(c['tile'][3] - c['tile'][1], 1) for c in C]
    ok('%s: every square 64px tall or more (%s)' % (tag, min(hs)), min(hs) >= 64 - 0.5, hs[:5])
    ok('%s: Free looks different from a marked square (its own colour, no tick)' % tag, C[12]['free'] and not C[12]['tick'] and C[12]['bg'] not in ('rgb(43, 13, 29)',), [C[12]['bg'], C[12]['tick']])
    ok('%s: the page never scrolls sideways, and nor does the card (option C)' % tag, (x.get('scrollW') or 9999) <= w + 1, x.get('scrollW'))
    ok('%s: the card and the claim fit the screen, no scrolling' % tag, (x.get('scrollH') or 9999) <= h + 1 and (x.get('btn') or [0, 0, 0, 9999])[3] <= h, [x.get('scrollH'), x.get('btn')])
    # REPINNED 12 Nov 2026: there is no swipe line any more; for the first 30 seconds the slot holds the text-size row instead
    sz = x.get('sizeNow')
    ok('%s: the slot under the card says "Tap a song when you hear it." or, in the first 30 seconds, shows the text size row (%s)' % (tag, 'size row' if sz else x.get('hint')),
       (x.get('hint') == 'Tap a song when you hear it.' and not sz) or (bool(sz) and x.get('hint') == '' and 'Text size' in (sz or {}).get('txt', '')), [x.get('hint'), sz, aw])
    if sz:
        sl = x.get('slot') or [0, 0, 0, 0]
        inside = all(b[1] >= sl[1] - 0.5 and b[3] <= sl[3] + 0.5 and b[0] >= -0.5 and b[2] <= w + 0.5 for b in (sz['box'], sz['down'], sz['up']))
        ok('%s: the text size row sits inside the slot under the card, both buttons 44px or taller' % tag, inside and min(sz['down'][3] - sz['down'][1], sz['up'][3] - sz['up'][1]) >= 44 - 0.5, [sz, sl])


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
    print('\nTHE CARD: EVERY SQUARE ITS OWN BIGGEST SIZE (INBOX 337), NO HYPHEN, NEVER SHRUNK BY A NOTE: 360, 375, 390, 430 wide and a short phone')
    keep = list(CELLS)
    try:
        for name, cells, marks in (('the review card', keep, ["Never Gonna Give You Up", "Livin' on a Prayer", "Hey Ya!", "Bohemian Rhapsody", "Dancing Queen", "Khe Sanh", "Mr. Brightside", "The Horses", "Africa", "Wonderwall", "September"]),
                                   ('short titles', SHORT_CARD, ["Up", "Help!", "Faith", "Jump", "Kiss"]),
                                   ('the 10 Nov live card', LIVE_CARD, ["Down Down", "Thunderstruck", "I Got You Babe", "In the Summertime", "Surrender"]),
                                   ('the Pub Classics card', PUB_CARD, ["Thunderstruck", "Wonderwall", "Shout", "How Am I Supposed to Live Without You", "Hitch Hiker"]),
                                   ('the 20 longest Pub Classics titles', PUB_LONG, ["Thunderstruck", "When the Going Gets Tough, The Tough Get Going", "L.A. International Airport", "Wonderwall"]),
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
                    spacing_checks(tag, x0, w, h, 'short' if cells is SHORT_CARD else 'pub' if cells is PUB_CARD else (cells is keep))
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
                    if w == 375 and h == 664: P.shot('spacing-%s-375x664' % ('std' if cells is keep else 'live' if cells is LIVE_CARD else 'pub' if cells is PUB_CARD else 'publong' if cells is PUB_LONG else 'long'))
                finally:
                    P.close()
    finally:
        CELLS[:] = keep


SIZE_PROBE = r"""(function(){ var z=document.getElementById("sizeNow"), m=document.getElementById("zoomIn"), f=[].map.call(document.querySelectorAll("#cardGrid .cc"),function(c){ return parseFloat(getComputedStyle(c).fontSize); });
  var mz=null; try{ mz=localStorage.getItem("vp-mzoom"); }catch(e){}
  return JSON.stringify({ all:f, on:!!(z && !z.classList.contains("hidden")), menu:!!(m && m.closest("#menuPanel")), fs:f.length?Math.min.apply(null,f):0, mz:mz, hint:document.getElementById("noteHint").classList.contains("hidden")?"":document.getElementById("noteHint").textContent }); })()"""


def size_row(B, base):
    """THE TEXT SIZE PLUS/MINUS (Dean via main INBOX 323, 12 Nov 2026): on the card for the first 30 seconds of the game,
    then it hides into the menu (still there); "+" makes the whole card bigger, even on a card with a long word; the chosen
    size is kept (a new page in the same night comes back at it); a reload does not bring the row back after 30 seconds."""
    print('\nTHE TEXT SIZE ROW: FIRST 30 SECONDS ON THE CARD, THEN IN THE MENU, THE SIZE KEPT (Dean via main INBOX 323, 12 Nov 2026)')
    keep = list(CELLS)
    CELLS[:] = keep
    w, h = 390, 844
    P = Page(B, base, '/app/musical/play.html?sting=0&room=' + ROOM, w, h, True, 'try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}')
    try:
        P.until('document.getElementById("vJoin") && !document.getElementById("vJoin").classList.contains("hidden")', 20); time.sleep(0.6)
        P.js(say('vp-' + ROOM, [{'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': []}])); time.sleep(0.3)
        P.js('(function(){ document.getElementById("nameIn").value="Sam"; document.getElementById("joinBtn").click(); return 1; })()')
        P.until('!document.getElementById("vWait").classList.contains("hidden")', 15); time.sleep(0.3)
        P.js(say('vp-' + ROOM, [{'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'game_id': 'gsize'}]))
        ok('size row: CONTROL the card is dealt', bool(P.until('!document.getElementById("vCard").classList.contains("hidden") && document.querySelectorAll("#cardGrid .cc").length===25', 15)))
        t0 = time.time(); time.sleep(1.2)
        a = P.obj(SIZE_PROBE) or {}
        ok('size row: on the card at the start of the game, the quiet hint out of its way', a.get('on') is True and a.get('hint') == '', a)
        P.js('document.getElementById("szUp").click(); true'); time.sleep(0.8)
        b = P.obj(SIZE_PROBE) or {}
        ok('size row: "+" makes the whole card bigger (%spx to %spx), even with Wonderwall on it, and the size is kept (vp-mzoom %s)' % (a.get('fs'), b.get('fs'), b.get('mz')),
           (b.get('fs') or 0) > (a.get('fs') or 0) + 0.4 and b.get('mz') == '1.2', [a, b])
        # 12 Nov 2026 (INBOX 337): per square, "+" raises every square's top size and the floor; no square gets smaller
        aa, bb = a.get('all') or [], b.get('all') or []
        ok('size row: "+" makes no square smaller, and raises the squares that were at the top size or the floor (%d of %d bigger)' % (sum(1 for u, v in zip(aa, bb) if v > u + 0.4), len(aa)),
           len(aa) == 25 and len(bb) == 25 and all(v >= u - 0.01 for u, v in zip(aa, bb)) and any(v > u + 0.4 for u, v in zip(aa, bb)), [aa, bb])
        P.js('document.getElementById("szDown").click(); true'); time.sleep(0.8)
        c = P.obj(SIZE_PROBE) or {}
        ok('size row: "-" takes it back (%spx)' % c.get('fs'), abs((c.get('fs') or 0) - (a.get('fs') or 0)) < 0.3 and c.get('mz') == '1', [a, c])
        P.js('document.getElementById("szUp").click(); true'); time.sleep(0.5)
        left = 30.5 - (time.time() - t0)
        if left > 0: time.sleep(left)
        gone = P.until('document.getElementById("sizeNow").classList.contains("hidden")', 5)
        d = P.obj(SIZE_PROBE) or {}
        ok('size row: gone after 30 seconds, the hint back, the card the clean main screen', bool(gone) and d.get('on') is False and d.get('hint') == 'Tap a song when you hear it.', d)
        ok('size row: still in the menu (Text size, A / A) after it hides', d.get('menu') is True, d)
        ok('size row: the bigger size stays after it hides', (d.get('fs') or 0) > (a.get('fs') or 0) + 0.4 and d.get('mz') == '1.2', [a, d])
    finally:
        P.close()
    P = Page(B, base, '/app/musical/play.html?sting=0&room=' + ROOM, w, h, True, '')
    try:
        P.until('document.getElementById("vJoin") && !document.getElementById("vJoin").classList.contains("hidden")', 20); time.sleep(0.6)
        P.js(say('vp-' + ROOM, [{'t': 'state', 'lobby': True, 'active': False, 'pattern': 'one', 'prize': 'Meat tray', 'played': []}])); time.sleep(0.3)
        P.js('(function(){ document.getElementById("nameIn").value="Sam"; document.getElementById("joinBtn").click(); return 1; })()')
        P.until('!document.getElementById("vWait").classList.contains("hidden")', 15); time.sleep(0.3)
        P.js(say('vp-' + ROOM, [{'t': 'started', 'pattern': 'one', 'prize': 'Meat tray', 'game_id': 'gsize2'}]))
        P.until('!document.getElementById("vCard").classList.contains("hidden") && document.querySelectorAll("#cardGrid .cc").length===25', 15); time.sleep(1.2)
        e = P.obj(SIZE_PROBE) or {}
        ok('size row: a new page later the same night comes back at the chosen size (vp-mzoom %s, %spx)' % (e.get('mz'), e.get('fs')), e.get('mz') == '1.2' and (e.get('fs') or 0) > (a.get('fs') or 0) + 0.4, [a, e])
    finally:
        P.close()
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
        size_row(B, base)
    finally:
        B.close(); srv.shutdown()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
