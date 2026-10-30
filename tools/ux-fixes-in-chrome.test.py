#!/usr/bin/env python3
"""THE 30 OCT 2026 UX FIXES, IN A REAL BROWSER (UX audit 30 Oct; Dean's decisions the same day).

Each of these is a fault you can only see when a browser lays the page out, so each is checked on the
repo's own pages in headless Chrome (tools/browser-rig/rig.py: the REAL game Worker in jsc, supabase-js
swapped for the rig's stand-in):

  1. THE HOMEPAGE HAS ONE HONEST ACTION. "Lock in your price", "Claim your spot" and "Hold my spot, add
     card" read as a deposit or an offer that is not there. The homepage says "Start your free month"
     (the form button "Start my free month", and under it "Next, add your card with Stripe. Nothing is
     charged today."); the floating button matches and stands down while the pricing button or the form
     is on screen; venue name, postcode and max players have visible labels. The offer pages keep
     their own words.
  2. THE PLAYER PHONE SAYS NOTHING BEFORE A CODE IS TRIED. "No room" and an amber dot read as "the
     game is full". Then "Game not found" for a code nobody holds, and "Waiting for the host" (with
     "Waiting for the host to open the game. Keep this open.") for a QR scanned before the lobby.
  3. A SONG TITLE NEVER BREAKS INSIDE A WORD, on the musical phone card at 390 x 690 and on the musical
     TV at 1920 and at 390: each word of every title is on one line, nothing hyphenated, and the title
     fits its square or the wall. The BINGO button is on screen without scrolling at 390 x 690.
  4. THE TV: the floor under the slides is styled from the first frame (it showed the browser's plain
     16px "Game on here" for 10 to 15 seconds on a slow screen), and a new venue with no slides gets a
     loop of its own name ("Trivia, bingo and musical bingo at <venue>. Ask at the bar what's on.")
     with the support email only for whoever is setting the screen up.

    python3 tools/ux-fixes-in-chrome.test.py            screenshots go to $VP_SHOTS if set
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
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def J(v):
    try: return json.loads(v) if isinstance(v, str) else {}
    except Exception: return {}

VISIBLE = ('(function(id){var e=document.getElementById(id);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')
def vis(i): return VISIBLE + '(%s)' % json.dumps(i)

def fnv_code(slug):
    s = ''.join(c for c in str(slug).lower() if c.isalnum()); h = 2166136261
    for c in s: h = ((h ^ ord(c)) * 16777619) & 0xffffffff
    A = 'ACDEFGHJKMNPQRSTUVWXYZ2345679'; x = h or 1; out = ''
    for _ in range(6): x = (x * 1103515245 + 12345) & 0xffffffff; out += A[x % len(A)]
    return out

# Every word of every title under `sel` on ONE line (a Range per word, one client rect each), no hyphen
# added, the no-break rules in force, and the text inside its box (or, for a word wider than a phone's
# square, narrowed whole by a transform that brings it inside).
WORDS = r'''(function(sel){
  var out={n:0, split:[], rules:[], over:[], small:[]};
  Array.prototype.forEach.call(document.querySelectorAll(sel), function(el){
    if(el.classList.contains("free")) return;
    var cs=getComputedStyle(el);
    if(cs.wordBreak!=="normal" || cs.overflowWrap!=="normal" || (cs.hyphens||cs.webkitHyphens)!=="none") out.rules.push([el.textContent, cs.wordBreak, cs.overflowWrap, cs.hyphens]);
    var w=document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while(w.nextNode()){
      var t=w.currentNode, s=t.nodeValue, re=/\S+/g, m;
      while((m=re.exec(s))){
        out.n++;
        var rg=document.createRange(); rg.setStart(t, m.index); rg.setEnd(t, m.index+m[0].length);
        var rects=Array.prototype.filter.call(rg.getClientRects(), function(r){ return r.width>0; });
        if(rects.length!==1) out.split.push(m[0]);
      }
    }
    var box=el.getBoundingClientRect(), inner=el.querySelector(".ct")||el, ib=inner.getBoundingClientRect();
    var fits = inner===el ? el.scrollWidth<=el.clientWidth+1 : (ib.left>=box.left-1 && ib.right<=box.right+1);
    if(!fits) out.over.push([el.textContent, Math.round(ib.width), Math.round(box.width)]);
    if(parseFloat(cs.fontSize)<10) out.small.push([el.textContent, cs.fontSize]);
  });
  return JSON.stringify(out);
})'''
def words(r, sid, sel): return J(r.ask(sid, WORDS + '(%s)' % json.dumps(sel)))

LONG = ['Supercalifragilisticexpialidocious', 'Californication', 'Misunderstanding', 'Wonderwall']


def homepage(r):
    print('\n1. The homepage has one honest action, "Start your free month"')
    tid, s = r.open('/index.html', width=390, height=844)
    ok('CONTROL: the homepage loads with its pricing card and its form', r.until(s, '!!document.getElementById("vp-submit") && !!document.querySelector("#offer .offer-cta a")', 30) is True)
    time.sleep(1.0)
    w = J(r.ask(s, ('JSON.stringify({all:document.body.innerText, price:(document.querySelector("#offer .offer-cta a")||{}).textContent,'
                    'hero:(document.querySelector("[data-cta=hero-claim]")||{}).textContent, submit:document.getElementById("vp-submit").textContent,'
                    'next:(document.getElementById("vp-next")||{}).textContent||"", label:(document.querySelector("#claim .sec-head .label")||{}).textContent,'
                    'fl:((document.getElementById("vpFloatCta")||{}).textContent||"").replace(/\\s+/g," ").trim(),'
                    'below:(function(){var b=document.getElementById("vp-submit"),n=document.getElementById("vp-next");return !!b&&!!n&&n.getBoundingClientRect().top>=b.getBoundingClientRect().bottom-1;})()})')))
    import re
    ok('it never says "Lock in your price", "Claim your spot" or "Hold my spot"',
       bool(w.get('all')) and not re.search(r'lock in your price|claim your spot|hold my spot', w.get('all', ''), re.I),
       re.findall(r'.{20}(?:Lock in your|Claim your spot|Hold my spot).{20}', w.get('all', ''), re.I)[:3])
    ok('the hero, the pricing card and the floating button all say "Start your free month"',
       w.get('hero') == 'Start your free month' and w.get('price') == 'Start your free month' and w.get('fl') == 'Start your free month', [w.get('hero'), w.get('price'), w.get('fl')])
    ok('the form is headed "Free first month"; its button says "Start my free month", and under it "Next, add your card with Stripe. Nothing is charged today."',
       w.get('label') == 'Free first month' and w.get('submit') == 'Start my free month' and w.get('next') == 'Next, add your card with Stripe. Nothing is charged today.' and w.get('below') is True,
       {k: w.get(k) for k in ('label', 'submit', 'next', 'below')})
    FLOAT = '(function(){var c=document.getElementById("vpFloatCta");return !!c&&c.classList.contains("show");})()'
    def scroll_to(sel, block):
        r.ask(s, 'document.querySelector(%s).scrollIntoView({block:%s,behavior:"instant"}); window.dispatchEvent(new Event("scroll")); true' % (json.dumps(sel), json.dumps(block)))
        time.sleep(0.5)
    scroll_to('#how', 'start')
    ok('CONTROL: scrolled past the hero, with neither button in view, the floating button is up', r.ask(s, FLOAT) is True)
    scroll_to('#offer .offer-cta', 'center')
    ok('never two pink buttons at once: the floating one stands down while the pricing card\'s button is on screen', r.ask(s, FLOAT) is False)
    shot(r, s, 'home-pricing-390')
    scroll_to('#vp-submit', 'center')
    ok('and while the sign-up form is on screen', r.ask(s, FLOAT) is False)
    lab = r.ask(s, ('JSON.stringify(Array.prototype.map.call(document.querySelector("#vp-venue-list .venue-row").querySelectorAll("input"),function(i){'
                    'var l=i.closest("label"),t=l&&l.querySelector(".v-lbl"),tr=t&&t.getBoundingClientRect(),ir=i.getBoundingClientRect();'
                    'return [i.className, t?t.textContent:"", !!tr&&tr.width>0&&tr.height>0&&tr.bottom<=ir.top+1];}))'))
    lab = json.loads(lab) if isinstance(lab, str) else []
    ok('venue name, postcode and max players each have a visible label above the box ("Most players in one game on a busy night"), not only a placeholder',
       lab == [['v-name', 'Venue name', True], ['v-postcode', 'Postcode', True], ['v-seats', 'Most players in one game on a busy night', True]], lab)
    shot(r, s, 'home-form-390')
    ok('no script errors on the homepage', r.ask(s, 'window.__errs.length') == 0, r.ask(s, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)
    off = open(os.path.join(RIG.ROOT, 'venueplay', 'nsw.html'), encoding='utf-8').read()
    ok('the offer page keeps its own words ("Lock in your price", "Claim your spot", "Hold my spot, add card")',
       'Lock in your price' in off and 'Claim your spot' in off and 'Hold my spot, add card' in off)


def phone(r):
    print('\n2. The player phone says nothing before a code is tried')
    STATUS = ('JSON.stringify({t:document.getElementById("statusText").textContent, dot:getComputedStyle(document.getElementById("statusDot")).display,'
              'all:document.body.innerText, err:(document.getElementById("roomErr")||{}).textContent||""})')
    tid, p = r.open('/play', width=390, height=844)
    ok('CONTROL: a phone with no code shows the code box', r.until(p, vis('vNoRoom'), 30) is True)
    time.sleep(1.0)
    st = J(r.ask(p, STATUS))
    ok('before a code is tried: no status at all, no "No room", no amber dot', st.get('t') == '' and st.get('dot') == 'none' and 'No room' not in st.get('all', ''), st)
    shot(r, p, 'phone-nocode-390')
    r.close_tab(tid)
    tid, p = r.open('/play?room=' + r.W.info['code'], width=390, height=844)
    ok('CONTROL: a QR link to a venue whose game is not open yet goes to the join screen', r.until(p, vis('vJoin'), 30) is True)
    ok('it says "Waiting for the host to open the game. Keep this open."',
       r.until(p, vis('joinHostNote'), 15) is True and r.ask(p, 'document.getElementById("joinHostNote").textContent') == 'Waiting for the host to open the game. Keep this open.',
       r.ask(p, 'document.getElementById("joinHostNote")&&document.getElementById("joinHostNote").outerHTML'))
    ok('and the status line says "Waiting for the host", not "Ready to join"',
       r.until(p, 'document.getElementById("statusText").textContent==="Waiting for the host"', 15) is True, r.ask(p, 'document.getElementById("statusText").textContent'))
    shot(r, p, 'phone-qr-nogame-390')
    r.close_tab(tid)
    tid, p = r.open('/play?room=ZZZZZZ', width=390, height=844)
    ok('a code nobody holds: "Game not found", and the code box says why',
       r.until(p, 'document.getElementById("statusText").textContent==="Game not found"', 30) is True and
       'There is no game with the code ZZZZZZ right now' in (J(r.ask(p, STATUS)).get('err') or ''), J(r.ask(p, STATUS)))
    r.close_tab(tid)


def musical(r):
    print('\n3. A song title never breaks inside a word, and the BINGO button is on screen')
    tid, m = r.open('/app/musical/play?demo=1', width=390, height=690)
    ok('CONTROL: the musical demo card is dealt, 25 squares', r.until(m, 'document.querySelectorAll("#cardGrid .cc").length===25', 40) is True)
    time.sleep(1.0)
    w = words(r, m, '#cardGrid .cc')
    ok('390 x 690: every word of every title on the card sits on one line (word-break, overflow-wrap and hyphens all off)',
       w.get('n', 0) >= 40 and not w.get('split') and not w.get('rules'), w)
    ok('and every title fits its square', not w.get('over') and not w.get('small'), w)
    r.ask(m, ('(function(){var c=document.querySelectorAll("#cardGrid .cc:not(.free)"),t=%s;for(var i=0;i<t.length;i++){var sp=c[i].querySelector(".ct");(sp||c[i]).textContent=t[i];}'
              'document.getElementById("zoomIn").click();document.getElementById("zoomOut").click();return true;})()') % json.dumps(LONG))
    time.sleep(0.6)
    w = words(r, m, '#cardGrid .cc')
    got = r.ask(m, 'Array.prototype.slice.call(document.querySelectorAll("#cardGrid .cc:not(.free)"),0,4).map(function(c){return c.textContent;}).join("|")')
    ok('CONTROL: four long titles are on the card ("Supercalifragilisticexpialidocious", "Californication", "Misunderstanding", "Wonderwall")', got == '|'.join(LONG), got)
    ok('a word wider than its square is never split: each still on one line, no hyphen', not w.get('split') and not w.get('rules'), w)
    ok('it is fitted whole instead: inside its square, the type no smaller than 10px', not w.get('over') and not w.get('small'), w)
    shot(r, m, 'musical-card-longtitles-390x690')
    r.ask(m, 'window.scrollTo(0,0); true'); time.sleep(0.3)
    b = J(r.ask(m, ('(function(){var b=document.getElementById("bingoBtn"),r=b.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);'
                    'return JSON.stringify({top:r.top,bottom:r.bottom,h:innerHeight,hit:e===b||b.contains(e)});})()')))
    ok('390 x 690, scrolled to the top: the whole BINGO button is on screen and can be tapped, no scrolling',
       b.get('top', -1) >= 0 and b.get('bottom', 9999) <= b.get('h', 0) and b.get('hit') is True, b)
    ok('no script errors on the musical phone', r.ask(m, 'window.__errs.length') == 0, r.ask(m, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)
    # A word longer than a 390 wide wall can hold at the title's own size: it must step the type down, not split.
    TITLE = 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch Supercalifragilisticexpialidocious'
    for wd, ht in ((1920, 1080), (390, 700)):
        tid, t = r.open('/app/musical/screen?demo=1', width=wd, height=ht)
        ok('%d: CONTROL: the musical TV demo is showing a song' % wd,
           r.until(t, '(function(){var e=document.getElementById("tvRun"),n=document.getElementById("tvNow");return !!e&&!e.classList.contains("hidden")&&!!n&&!n.classList.contains("hidden");})()', 60) is True)
        res = {}
        for _ in range(4):   # the demo moves on every few seconds; take the reading while our title is up
            r.ask(t, 'document.getElementById("tvNowTitle").textContent=%s; true' % json.dumps(TITLE))
            time.sleep(0.4)
            res = words(r, t, '#tvNowTitle')
            res['text'] = r.ask(t, 'document.getElementById("tvNowTitle").textContent')
            if res['text'] == TITLE: break
        ok('%d: a long title on the TV: each word on one line, no hyphen, and it fits the wall' % wd,
           res.get('text') == TITLE and res.get('n') == 2 and not res.get('split') and not res.get('rules') and not res.get('over'), res)
        shot(r, t, 'musical-tv-longtitle-%d' % wd)
        r.close_tab(tid)


def tv(r):
    print('\n4. The TV: a styled floor from the first frame, and a new venue\'s own loop')
    NB = '55555555-5555-4555-8555-555555555555'
    r.W.seed('vp_venues', [{'id': NB, 'name': 'The Average Joe', 'slug': 'the-average-joe', 'status': 'active', 'join_code': fnv_code('the-average-joe'),
                            'au_state': 'QLD', 'max_players': 100, 'created_at': '2026-10-28T00:00:00Z', 'suspended_reason': None}])
    tid, t = r.open('/tv?venue=the-average-joe', width=1920, height=1080)
    fl = J(r.until(t, ('(function(){var b=document.querySelector("#tvFloor .adbig");if(!b||document.readyState==="loading")return "";var c=getComputedStyle(b);'
                       'return JSON.stringify({ff:c.fontFamily,fs:parseFloat(c.fontSize),tt:c.textTransform});})()'), 20))
    ok('the floor under the slides is styled (Anton, uppercase, big), never the browser\'s plain 16px',
       'Anton' in (fl.get('ff') or '') and fl.get('fs', 0) >= 34 and fl.get('tt') == 'uppercase', fl)
    LIT = '(function(){var s=document.querySelector("#tvAds .ad.show");return s?s.textContent.replace(/\\s+/g," ").trim():"";})()'
    LINE = 'Trivia, bingo and musical bingo at The Average Joe. Ask at the bar what’s on.'
    lit = r.until(t, '(function(){var t=%s;return t.indexOf(%s)>=0?t:"";})()' % (LIT, json.dumps(LINE)), 30)
    ok('no slides yet: the wall shows the venue\'s own loop, "%s"' % LINE, isinstance(lit, str) and LINE in lit and 'The Average Joe' in lit, r.ask(t, LIT))
    n = r.ask(t, 'document.querySelectorAll("#tvAds .ad").length')
    ok('a loop, not one card: two slides, both the venue\'s own', n == 2 and r.ask(t, 'Array.prototype.every.call(document.querySelectorAll("#tvAds .ad"),function(a){return a.textContent.indexOf("The Average Joe")>=0;})') is True, n)
    SUP = '(function(){var h=document.querySelector("#tvAds .ad.show .adhelp");if(!h)return "none";var b=h.getBoundingClientRect();return (getComputedStyle(h).display!=="none"&&b.height>0)?"shown":"hidden";})()'
    ok('once the screen is confirmed, the room never sees the support email', r.until(t, '!document.body.classList.contains("tv-sup") && %s==="hidden"' % SUP, 20) is True, r.ask(t, SUP))
    shot(r, t, 'tv-noslides-1920')
    r.ask(t, 'document.dispatchEvent(new PointerEvent("pointermove",{bubbles:true})); true'); time.sleep(0.3)
    ok('a mouse move brings it up for whoever is setting the screen up', r.ask(t, SUP) == 'shown', r.ask(t, SUP))
    ok('no script errors on the TV', r.ask(t, 'window.__errs.length') == 0, r.ask(t, 'JSON.stringify(window.__errs)'))
    r.close_tab(tid)
    tid, t = r.open('/tv?venue=no-such-venue-here', width=1280, height=720)
    r.until(t, 'document.readyState!=="loading" && !!document.querySelector("#tvAds .ad.show")', 20)
    ok('a screen whose address is not confirmed shows the support line without a mouse move',
       r.until(t, 'document.body.classList.contains("tv-sup")', 10) is True)
    r.close_tab(tid)


r = RIG.Rig()
try:
    homepage(r)
    phone(r)
    musical(r)
    tv(r)
except Exception:
    import traceback; traceback.print_exc(); bad += 1
finally:
    r.close()

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
