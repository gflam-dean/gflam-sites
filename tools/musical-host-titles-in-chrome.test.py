#!/usr/bin/env python3
"""A SONG TITLE NEVER BREAKS INSIDE A WORD ON THE HOST'S OWN CARD (Dean, 31 Oct 2026).

The phone card and the musical TV were fixed on 30 Oct 2026 (e646efe7, checked by
tools/ux-fixes-in-chrome.test.py). The host console's mini card, the one the host reads to judge a
BINGO claim (venueplay/app/musical/host.html, renderClaimCard), still had overflow-wrap:anywhere and
hyphens:auto, so "Supercalifragilisticexpialidocious" came out in three pieces and "Californication"
as "Californi / cation". Same rule now: lines break only between words, no hyphens, and a word too
wide for its square steps the type down (10px to 8px), then is narrowed whole, never split.

This RUNS the real console in headless Chrome (tools/browser-rig/rig.py: the real game Worker in jsc,
supabase-js swapped for the rig's stand-in, the host signed in): opens a lobby, starts the game, and
hands it a claim the way a phone does (a "claim" broadcast on the console's own channel) whose card
carries long titles. Then it reads what the browser painted: one client rect per word, the no-break
rules in force, each title inside its square, the long word on a smaller type, five equal columns.
Twice: at tablet width (1024 x 768, how hosts run it) and at phone width (390 x 844, after a resize,
so the refit on resize is run too).

    python3 tools/musical-host-titles-in-chrome.test.py      screenshots go to $VP_SHOTS if set
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

LONG = ['Supercalifragilisticexpialidocious', 'Californication', 'Misunderstanding', 'Wonderwall']
OTHERS = ["Sweet Child O' Mine", 'Bohemian Rhapsody', "Don't Stop Believin'", 'I Wanna Dance with Somebody (Who Loves Me)',
          "Livin' on a Prayer", 'Mr. Brightside', 'Uptown Funk', 'Total Eclipse of the Heart', 'Unbelievable',
          'Africa', 'Valerie', 'Dancing Queen', 'Come On Eileen', 'Never Gonna Give You Up', 'Thunderstruck',
          'Torn', 'Footloose', "Summer of '69", 'Shake It Off', 'Rolling in the Deep']
TITLES = LONG + OTHERS     # 24 songs, the FREE square goes in the middle
CELLS = []
for i in range(25):
    if i == 12: CELLS.append(0)
    else:
        t = TITLES[i if i < 12 else i - 1]
        CELLS.append({'song_id': 'song-%02d' % i, 'title': t})

# Record every realtime channel the page opens (the rig's supabase stand-in carries them on
# BroadcastChannel 'fake-rt:<name>'), so the test can speak on the console's own channel as a phone does.
BEFORE = ('(function(){var B=window.BroadcastChannel;if(!B)return;window.__bcNames=[];'
          'var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;})();')

CLAIM = r'''(function(cells){
  var names=(window.__bcNames||[]).filter(function(n){return /^fake-rt:vp-/.test(n);});
  var seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1;
    var b=new BroadcastChannel(n);
    b.postMessage({event:"msg", payload:{t:"claim", claim_id:"claim-long-titles", pid:"p-long-titles", name:"Ann",
      cardNo:"042", cells:cells, claimed_at:new Date().toISOString()}});
    setTimeout(function(){ try{ b.close(); }catch(e){} }, 500);
  });
  return Object.keys(seen).length;
})'''

# Every word of every title on the host's mini card on ONE line (a Range per word, one client rect each),
# the no-break rules in force, each title (its .ct span, transform and all) inside its square, the type
# never under the 8px floor, and the five columns the same width.
WORDS = r'''(function(){
  var out={n:0, split:[], rules:[], over:[], small:[], cells:0, sizes:{}, widths:[]};
  var card=document.querySelector("#claimQueue .mini5");
  if(!card) return JSON.stringify(out);
  Array.prototype.forEach.call(card.querySelectorAll(".mc"), function(el, idx){
    out.cells++;
    if(idx<5) out.widths.push(Math.round(el.getBoundingClientRect().width*10)/10);
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
        if(rects.length!==1) out.split.push(m[0]+" ("+rects.length+" pieces)");
      }
    }
    var box=el.getBoundingClientRect(), inner=el.querySelector(".ct")||el, ib=inner.getBoundingClientRect();
    if(!(ib.left>=box.left-1 && ib.right<=box.right+1)) out.over.push([el.textContent, Math.round(ib.width), Math.round(box.width)]);
    if(parseFloat(cs.fontSize)<8) out.small.push([el.textContent, cs.fontSize]);
    out.sizes[el.textContent]=parseFloat(cs.fontSize);
  });
  return JSON.stringify(out);
})()'''

RUNNING = '!document.getElementById("liveBlock").classList.contains("hidden")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'


def check_card(r, sid, where):
    w = J(r.ask(sid, WORDS))
    ok('%s: CONTROL: the claim card is drawn whole, 25 squares, the long titles on it' % where,
       w.get('cells') == 25 and all(t in w.get('sizes', {}) for t in LONG), {k: w.get(k) for k in ('cells', 'sizes')})
    ok('%s: word-break, overflow-wrap and hyphens are all off on every square' % where, w.get('n', 0) >= 40 and not w.get('rules'), w.get('rules') or w.get('n'))
    ok('%s: every word of every title sits on one line, none split ("Supercalifragilisticexpialidocious", "Californication" whole)' % where,
       w.get('n', 0) >= 40 and not w.get('split'), w.get('split'))
    ok('%s: and every title is inside its square' % where, w.get('cells') == 25 and not w.get('over'), w.get('over'))
    sz = w.get('sizes', {})
    ok('%s: the word too wide for its square stepped the type down instead (under 10px), never below the 8px floor' % where,
       0 < sz.get(LONG[0], 0) < 10 and not w.get('small'), [sz.get(LONG[0]), w.get('small')])
    ok('%s: a short title keeps the full 10px' % where, sz.get('Torn') == 10, sz.get('Torn'))
    ws = w.get('widths', [])
    ok('%s: the five columns are the same width (a long word no longer widens its column)' % where,
       len(ws) == 5 and max(ws) - min(ws) <= 1, ws)


def host_card():
    print('\nThe host console\'s claim card: song titles never break inside a word')
    r = RIG.Rig(host_pages=('/app/musical/host.html',))
    try:
        tid, h = r.open('/app/musical/host.html', before=BEFORE, width=1024, height=768)
        ok('CONTROL: the musical console loads, signed in', r.until(h, 'document.readyState==="complete" && !!document.getElementById("startBtn")', 40) is True)
        time.sleep(3)
        r.ask(h, 'document.getElementById("prizeInput").value="Bar tab"; true')
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        r.until(h, LOBBY, 15)
        r.ask(h, 'document.getElementById("startBtn").click(); true')
        ok('CONTROL: a game is running (lobby opened, then Start game)', r.until(h, RUNNING, 20) is True,
           r.ask(h, '((document.getElementById("hostErrText")||{}).textContent||"")+" | "+JSON.stringify(window.__errs)'))
        n = 0
        for _ in range(3):
            n = r.ask(h, CLAIM + '(%s)' % json.dumps(CELLS))
            if r.until(h, 'document.querySelectorAll("#claimQueue .mini5 .mc").length===25', 6) is True: break
        ok('CONTROL: a phone\'s claim reaches the console and its card is drawn', r.ask(h, 'document.querySelectorAll("#claimQueue .mini5 .mc").length') == 25,
           [n, r.ask(h, 'JSON.stringify(window.__bcNames)'), r.ask(h, 'document.getElementById("claimQueue").innerText.slice(0,200)')])
        r.ask(h, 'var q=document.getElementById("claimQueue"); if(q&&q.scrollIntoView) q.scrollIntoView({block:"center"}); true')
        time.sleep(0.8)
        check_card(r, h, '1024 x 768 (tablet)')
        shot(r, h, 'musical-host-claimcard-1024')
        r.B.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True}, session=h)
        time.sleep(1.2)
        check_card(r, h, '390 x 844 (phone, after a resize)')
        shot(r, h, 'musical-host-claimcard-390')
        ok('no script errors on the musical console', r.ask(h, 'window.__errs.length') == 0, r.ask(h, 'JSON.stringify(window.__errs)'))
        r.close_tab(tid)
    finally:
        r.close()


try:
    host_card()
except Exception:
    import traceback; traceback.print_exc(); bad += 1

print('\n%d of %d checks passed' % (ran - bad, ran))
sys.exit(1 if bad else 0)
