#!/usr/bin/env python3
"""TRIVIA ON A REAL NIGHT: THE WALL NEVER BLINKS, AND ENDING EARLY STILL CROWNS THE WINNERS (INBOX 282.5, 12 Nov 2026).

Dean played trivia on The Mini Bar with the Kogan TV app and two phones (reports/live-play-12nov/FINDINGS.md):
  T4  he ended the quiz at question 8 with End round -> OK: no winners podium on the TV, and the phones said "That's a
      wrap" with no place; another night the phone said GAME ENDED with no "How was that?" (Dean's rule: every game's
      end asks).
  T6  the TV flickered to the logo screen during the game, between the questions and the answers.
  T2  the phone's "Right · yours" tag sat over the answer's words.
  T3  the phone's end screen showed the points, not the place.

This plays it on the browser rig (tools/browser-rig/rig.py: the REAL game Worker in jsc with a fake database, the
shipped console, tv.html with the trivia wall in its game frame, and two phones with their own storage), and keeps a
TIMELINE on the TV and on each phone: every change of what is on screen (the TV's layer in the game frame, or the
ads / the hold card when the frame is not up; the phone's view), with the time it happened, plus every message each
window hears. A blink shorter than the eye can name is still a line in the timeline.

  THE NIGHT  a 3 question quiz: question 1, both phones answer, the answer, the leaderboard, question 2, both answer,
             the answer. On the TV from question 1 on: never the lobby (the logo and join screen) again, never the ads
             or the hold card, and no screen up for less than 0.7 s (a blink). On each phone: question, result,
             question, result, with no waiting screen and nothing in between.
  RECONNECT  the TV says hello mid-question and again on the answer (what a TV that reconnects does: the Kogan app on
             pub wifi), and the console replays what is on. The wall must keep what it shows: the question's cards
             are not drawn again (its ring not reset), the answer's reveal is not played again, and the leaderboard
             still comes up about 5 s after the answer, not pulled forward by the replay. Before 12 Nov each of these
             redrew the wall: the flicker Dean saw (T6).
  END EARLY  End round at question 2 of 3 -> OK: the TV runs the winners' reveal (the podium, the winner), never the
             lobby or the ads first; each phone gets its final screen WITH its place (1st place / You finished 2nd),
             and is asked "How was that?". The place is as plain as the points (white, bold, 18px or more).
  MID-QUESTION  a second quiz ended while question 1 is still open, before anyone answered: no scores, so the TV goes
             back to its lobby, and each phone's end screen still asks "How was that?" (never a bare GAME ENDED).
  TAGS       on each phone's result, the "Right · yours" / "Yours" / "Right answer" tag never overlaps the answer's
             words or letter (measured on the real result, at 390x844 and with a long two-line answer at 375x667).

VP_SHOTS=<dir> keeps screenshots. Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait).

    python3 tools/trivia-ux-in-chrome.test.py
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
SET = '5e75e75e-0000-4000-8000-000000000282'
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:700]))
    sys.stdout.flush()
    if not cond: bad += 1

# Each phone keeps its localStorage under its own prefix (two phones, two storages, one browser): the same trick as
# tools/one-phone-a-night-in-chrome.test.py, which explains why.
def PHONE_STORE(tag):
    return r'''(function(){ var P=%s, S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem, k=S.key, c=S.clear;
  function mine(st){ try{ return st===window.localStorage; }catch(e){ return false; } }
  S.getItem=function(x){ return mine(this) ? g.call(this, P+x) : g.call(this, x); };
  S.setItem=function(x,v){ return mine(this) ? s.call(this, P+x, v) : s.call(this, x, v); };
  S.removeItem=function(x){ return mine(this) ? r.call(this, P+x) : r.call(this, x); };
  S.clear=function(){ if(!mine(this)) return c.call(this); var ks=[]; for(var i=0;i<this.length;i++){ var q=k.call(this,i); if(q && q.indexOf(P)===0) ks.push(q); } ks.forEach(function(q){ r.call(window.localStorage,q); }); };
})();''' % json.dumps('phone-' + tag + ':')

# THE TIMELINE. Run in every window and every frame before the page's own scripts. Every message a fake Realtime
# channel delivers is logged ([ms, channel, type, qseq]); what is on screen is logged on every DOM change that could
# change it (a MutationObserver, so nothing is missed between two polls): in the trivia wall, the visible .layer;
# in tv.html, "frame" while the game frame is up, else "ads" or "hold"; on a phone, the visible .view.
TIMELINE = r'''(function(){
  var T0=Date.now(); window.__tl=[]; window.__msgs=[]; window.__T0=T0;
  var BC=window.BroadcastChannel;
  if(BC){ window.BroadcastChannel=function(n){ var b=new BC(n);
    if(String(n).indexOf("fake-rt:")===0) b.addEventListener("message", function(e){ var p=e.data&&e.data.payload; if(p&&p.t) window.__msgs.push([Date.now()-T0, String(n).slice(8), p.t, p.qseq||p.qi||"", p.to?"to":""]); });
    return b; }; }
  function vis(e){ if(!e) return false; if(e.classList.contains("hidden")) return false; var s=getComputedStyle(e); return s.display!=="none" && s.visibility!=="hidden"; }
  function now(){
    var d=document;
    if(d.getElementById("gameFrame")){
      var f=d.getElementById("gameFrame");
      if(f.style.display!=="none" && f.getAttribute("src") && f.getAttribute("src")!=="about:blank") return "frame";
      var h=d.getElementById("tvHold"); if(h && vis(h)) return "hold";
      return "ads";
    }
    if(d.getElementById("tvLobby") && d.querySelector(".layer")){
      var l=[].filter.call(d.querySelectorAll(".layer"), vis).map(function(x){ return x.id; });
      return l.join("+")||"none";
    }
    var v=[].filter.call(d.querySelectorAll(".view"), function(x){ return !x.classList.contains("hidden"); }).map(function(x){ return x.id; });
    return v.join("+")||"none";
  }
  var last="";
  function note(){ var s; try{ s=now(); }catch(e){ return; } if(s!==last){ last=s; window.__tl.push([Date.now()-T0, s]); } }
  window.__tlNote=note;
  function go(){ note(); try{ new MutationObserver(note).observe(document.documentElement, { attributes:true, attributeFilter:["class","style","src","hidden"], subtree:true, childList:true }); }catch(e){} }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", go); else go();
})();'''

R = None
def js(sid, expr, wait=8): return R.ask(sid, expr, wait)
def table(name):
    W = R.W
    with W.lock:
        W.p.stdin.write(json.dumps({'table': name}) + '\n'); W.p.stdin.flush()
        return json.loads(W.p.stdout.readline())['body']
def shot(sid, name):
    if SHOTS: time.sleep(0.4); R.shot(sid, os.path.join(SHOTS, name + '.jpg'))
def text(sid): return js(sid, 'document.body.innerText.replace(/\\s+/g," ").slice(0,260)')
def tap(sid, el_id): js(sid, 'setTimeout(function(){ document.getElementById(%s).click(); }, 0); true' % json.dumps(el_id))
def click_text(sid, t):
    return js(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; setTimeout(function(){ b.click(); }, 0); return true; })()' % json.dumps(t))
def has_btn(t):
    return '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(t)
ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")'
LOBBY = '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()'
TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b){ b.click(); return true; } return false;})()'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
def answer_dialogs(sid, rounds=3):
    for _ in range(rounds):
        time.sleep(0.8)
        if not (js(sid, TAKEOVER) or js(sid, ASKGO) or js(sid, ACCEPT)): break
JOIN_FORM = '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && b.offsetParent!==null;})()'
ASKED = '!!document.querySelector("#vFinal .vpfb button[data-rate]") && document.querySelector("#vFinal .vpfb button[data-rate]").getBoundingClientRect().height>0'
FINAL = '!document.getElementById("vFinal").classList.contains("hidden")'
FRAME = 'document.getElementById("gameFrame").contentWindow'
def tv_tl(tv):
    """tv.html's own timeline and the trivia wall's (the frame's), each [ms since its own start, state]; the frame's
    times are moved onto the top page's clock."""
    top = R.json(tv, 'JSON.stringify({ tl: window.__tl, T0: window.__T0 })', {}) or {}
    fr = R.json(tv, '(function(){ try{ var w=%s; return JSON.stringify({ tl: w.__tl||[], T0: w.__T0||0, msgs: w.__msgs||[] }); }catch(e){ return "{}"; } })()' % FRAME, {}) or {}
    off = (fr.get('T0') or 0) - (top.get('T0') or 0)
    return top.get('tl') or [], [[t + off, s] for t, s in (fr.get('tl') or [])], [[m[0] + off] + m[1:] for m in (fr.get('msgs') or [])]
def ph_tl(ph): return R.json(ph, 'JSON.stringify({ tl: window.__tl||[], msgs: window.__msgs||[] })', {}) or {}

# The tag on a result card against the card's words and letter: a box that overlaps another by more than a pixel.
TAGS = r'''(function(){ var out=[];
  [].forEach.call(document.querySelectorAll("#pResAnswers .pans"), function(b, i){ var tg=b.querySelector(".tg"); if(!tg) return;
    var t=tg.getBoundingClientRect();
    [b.querySelector(".pt"), b.querySelector(".pl")].forEach(function(x){ if(!x) return;
      // the words' own lines (a centred one-line answer's box is wider than its words), each cut to its line height (a
      // text rect is the font's whole ascent and descent, taller than the line the words are set on)
      var rr=[]; try{ var rg=document.createRange(); rg.selectNodeContents(x); rr=[].slice.call(rg.getClientRects()); }catch(e){}
      if(!rr.length) rr=[x.getBoundingClientRect()];
      var cs=getComputedStyle(x), lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.12;
      rr=rr.map(function(q){ var p=Math.max(0,(q.height-lh)/2); return { left:q.left, right:q.right, top:q.top+p, bottom:q.bottom-p }; });
      rr.forEach(function(r){ var w=Math.min(t.right,r.right)-Math.max(t.left,r.left), h=Math.min(t.bottom,r.bottom)-Math.max(t.top,r.top);
        if(w>1 && h>1) out.push({ card:i, tag:tg.textContent, over:x.className, by:[Math.round(w),Math.round(h)] }); });
    });
  });
  return JSON.stringify({ n: document.querySelectorAll("#pResAnswers .pans .tg").length, over: out }); })()'''


def blinks(tl, start, end, short=700):
    """Screens that were up for less than `short` ms between start and end (the last one runs to `end`)."""
    seg = [x for x in tl if start <= x[0] <= end]
    out = []
    for i in range(len(seg) - 1):
        if seg[i + 1][0] - seg[i][0] < short: out.append((seg[i][1], seg[i + 1][0] - seg[i][0]))
    return out


# The TV's own "hello" (what a TV that reconnects sends; the console answers it by replaying what is on), said on the
# trivia wall's channel, the one its questions arrive on.
def tv_hello(tv):
    return js(tv, '(function(){ var w=%s, m=(w.__msgs||[]).filter(function(x){ return x[2]==="question"; }).pop(); if(!m) return false;'
                  ' var c=new BroadcastChannel("fake-rt:"+m[1]); c.postMessage({ event:"msg", payload:{ t:"tv_here", hello:true } }); c.close(); return m[1]; })()' % FRAME)
# Was the card on the wall drawn again? The test marks the first answer card; a redraw replaces it with a fresh one.
MARKED = ('(function(){ try{ var d=%s.document; var a=d.querySelector("#tvAnswers .ans"), r=d.querySelector("#tvRevAnswers .ans");'
          ' var revUp=!d.getElementById("tvReveal").classList.contains("hidden");'
          ' return JSON.stringify({ q: (!d.getElementById("tvQ").classList.contains("hidden") && a) ? !!a.__vpMark : null, rev: (revUp && r) ? !!r.__vpMark : null }); }catch(e){ return "{}"; } })()') % FRAME


def seed_board(gid, sess):
    pts = {}
    for a in table('vp_trivia_answers'):
        if a.get('game_id') == gid: pts[a.get('player_id')] = pts.get(a.get('player_id'), 0) + (a.get('points_awarded') or 0)
    rows = [{'game_id': gid, 'player_id': p.get('id'), 'display_name': p.get('display_name'), 'points': pts.get(p.get('id'), 0)}
            for p in table('vp_players') if p.get('session_id') == sess]
    R.W.seed('v_vp_trivia_leaderboard', rows, replace=True)
    return rows


def open_quiz(host, tv, n):
    js(host, 'document.getElementById("cfgCount").value="%d"; document.getElementById("cfgCount").dispatchEvent(new Event("input")); true' % n)
    tap(host, 'startBtn'); answer_dialogs(host)
    return R.until(host, LOBBY, 20) is True


# The console shows the host the right answer (".opt.correct"); the questions come in the Worker's own order.
RIGHT = '((document.querySelector("#runBody .opt.correct .otx")||{}).textContent||"")'
def play_question(host, phones, label, mid=None):
    """Phone A taps the right answer, phone B a wrong one. mid(): run while the question is up, before the reveal."""
    click_text(host, 'First question') or click_text(host, 'Next question')
    for tag, ph in phones:
        ok('%s: the question reaches phone %s' % (label, tag), R.until(ph, '!document.getElementById("vQ").classList.contains("hidden") && document.querySelectorAll("#pAnswers .pans:not(:disabled)").length===4', 30) is True, text(ph))
    R.until(host, RIGHT, 10)
    right = js(host, RIGHT)
    time.sleep(1.2)
    if mid: mid()
    for i, (tag, ph) in enumerate(phones):
        js(ph, '(function(r, mine){ var bs=[].slice.call(document.querySelectorAll("#pAnswers .pans")); var b=bs.filter(function(x){ return (x.querySelector(".pt").textContent===r)===mine; })[0]; b.click(); return true; })(%s, %s)'
           % (json.dumps(right), 'true' if i == 0 else 'false'))
        ok('%s: phone %s answers' % (label, tag), R.until(ph, '/Answer in|Locked in/i.test(document.body.innerText) || !!document.querySelector("#pAnswers .pans.picked")', 15) is True, text(ph))
    time.sleep(0.8)
    click_text(host, 'Reveal answer')
    for tag, ph in phones:
        ok('%s: the answer reaches phone %s' % (label, tag), R.until(ph, '!document.getElementById("vRes").classList.contains("hidden")', 25) is True, text(ph))


def night():
    global R
    R = rig.Rig(host_pages=('/app/trivia/host.html', '/app/index.html'))
    W = R.W
    code = W.info['code']
    with W.lock:   # tonight is tonight: a question's end time comes from the Worker's clock (see one-phone-a-night)
        W.p.stdin.write(json.dumps({'now': int(time.time() * 1000)}) + '\n'); W.p.stdin.flush(); W.p.stdout.readline()
    R.db['vp_question_sets'] = [{'id': SET, 'title': 'Pub Classics', 'question_count': 3, 'visibility': 'public', 'owner_venue_id': W.info['venue'], 'status': 'active'}]
    W.seed('vp_question_sets', R.db['vp_question_sets'])
    W.seed('vp_questions', [
        {'id': 'q-1', 'set_id': SET, 'seq': 1, 'question': 'Which colour is the sky?', 'text': 'Which colour is the sky?', 'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2},
        {'id': 'q-2', 'set_id': SET, 'seq': 2, 'question': 'Which is the deepest natural lake in Australia, in Tasmania?', 'text': 'Which is the deepest natural lake in Australia, in Tasmania?',
         'options': ['Lake St Clair, in the Central Highlands of Tasmania', 'Lake Pedder', 'Great Lake', 'Lake Gordon'], 'correct_index': 0},
        {'id': 'q-3', 'set_id': SET, 'seq': 3, 'question': 'Which city hosted the 2000 Olympics?', 'text': 'Which city hosted the 2000 Olympics?', 'options': ['Melbourne', 'Sydney', 'Brisbane', 'Perth'], 'correct_index': 1}])
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None}], replace=True)
    t_tv, tv = R.open('/tv?venue=' + W.info['slug'] + '&sting=0', before=TIMELINE, width=1280, height=720)

    print('\nTHE NIGHT: a 3 question quiz, two phones')
    t_h, host = R.open('/app/trivia/host.html?venue=' + W.info['venue'], width=1280, height=900)
    ok('the console loads', R.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 40) is True, text(host))
    time.sleep(2)
    ok('the lobby is open', open_quiz(host, tv, 3), js(host, ERRT))
    phones = []
    for tag, name, w, h in (('A', 'Ann', 390, 844), ('B', 'Bob', 375, 667)):
        tid, ph = R.open('/play?room=' + code + '&sting=0', before=PHONE_STORE(tag) + TIMELINE, width=w, height=h)
        phones.append((tag, ph))
        ok('phone %s reaches the join form' % tag, R.until(ph, JOIN_FORM + ' && !document.getElementById("joinBtn").disabled', 90) is True, [js(ph, 'location.pathname'), text(ph)])
        time.sleep(1)
        js(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(name))
        R.until(ph, '!' + JOIN_FORM, 20)
    ok('the console counts 2 players', R.until(host, 'document.getElementById("playerCount").textContent==="2"', 25) is True, js(host, 'document.getElementById("playerCount").textContent'))
    ok('CONTROL: the TV has the trivia wall in its game frame', R.until(tv, '!!document.getElementById("gameFrame").contentDocument && /trivia\\/screen/.test(document.getElementById("gameFrame").src) && document.getElementById("gameFrame").style.display!=="none"', 30) is True,
       js(tv, 'document.getElementById("gameFrame").src'))
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('the quiz starts', R.until(host, has_btn('First question'), 30) is True, js(host, ERRT))
    tg = [g for g in table('vp_games') if g.get('format') == 'trivia']
    gid, sess = tg[-1]['id'], tg[-1].get('session_id')
    t_q1 = js(tv, 'Date.now()-window.__T0')
    p_q1 = [js(ph, 'Date.now()-window.__T0') for _, ph in phones]
    def hello_q():
        mark_tv()
        tv_hello(tv)
        time.sleep(2.5)
        ok('question 1, the TV reconnects mid-question (it says hello, the console replays the question): the same question stays up, not drawn again',
           R.json(tv, MARKED, {}) == {'q': True, 'rev': None}, [R.json(tv, MARKED, {}), tv_tl(tv)[1][-4:]])
    def mark_tv():
        js(tv, '(function(){ try{ var d=%s.document; var a=d.querySelector("#tvAnswers .ans"); if(a) a.__vpMark=1; var r=d.querySelector("#tvRevAnswers .ans"); if(r) r.__vpMark=1; return true; }catch(e){ return false; } })()' % FRAME)
    play_question(host, phones, 'question 1', mid=hello_q)
    seed_board(gid, sess)
    shot(phones[0][1], 'q1-result-A'); shot(phones[1][1], 'q1-result-B')
    ok('question 1: the TV puts the leaderboard up after the answer', R.until(tv, '(function(){ try{ return !%s.document.getElementById("tvBoard").classList.contains("hidden"); }catch(e){ return false; } })()' % FRAME, 15) is True,
       tv_tl(tv)[1][-6:])
    time.sleep(1.5)
    play_question(host, phones, 'question 2')
    time.sleep(1.0)
    js(tv, '(function(){ try{ var d=%s.document; var r=d.querySelector("#tvRevAnswers .ans"); if(r) r.__vpMark=1; return true; }catch(e){ return false; } })()' % FRAME)
    tv_hello(tv)
    time.sleep(1.2)
    ok('question 2, the TV reconnects on the answer (the console replays the answer): the answer stays up as it is, its reveal not played again',
       R.json(tv, MARKED, {}).get('rev') is True, [R.json(tv, MARKED, {}), tv_tl(tv)[1][-4:]])
    time.sleep(6)
    fr = tv_tl(tv)[1]
    t_rev = max([t for t, st in fr if st == 'tvReveal'] or [0])
    nxt = [x for x in fr if x[0] > t_rev]
    ok('question 2: and the leaderboard still comes up when it should (about 5 s after the answer), not pulled forward by the replay',
       bool(nxt) and nxt[0][1] == 'tvBoard' and nxt[0][0] - t_rev >= 4500, [t_rev, nxt[:3]])
    seed_board(gid, sess)
    for tag, ph in phones:
        tags = R.json(ph, TAGS, {}) or {}
        ok('question 2, phone %s: the result tags are up (%s) and none sits over the answer\'s words or letter' % (tag, tags.get('n')), (tags.get('n') or 0) >= 1 and not tags.get('over'), tags)
        shot(ph, 'q2-result-' + tag)
    time.sleep(1.0)
    top, frame, fmsgs = tv_tl(tv)
    ok('the TV: from question 1 on, the game frame never gave way to the ads or the hold card', all(s == 'frame' for t, s in top if t >= t_q1), [x for x in top if x[0] >= t_q1 - 2000])
    q_on = [t for t, s in frame if s == 'tvQ']
    first_q = q_on[0] if q_on else None
    after = [x for x in frame if first_q is not None and x[0] >= first_q]
    ok('the TV: from question 1 on, the wall never went back to its lobby (the logo and join screen)', bool(after) and not any('tvLobby' in s for _, s in after), after)
    end_ms = js(tv, 'Date.now()-window.__T0')
    bl = blinks(frame, first_q or 0, end_ms)
    ok('the TV: no screen was up for less than 0.7 s between the questions and the answers (no blink)', first_q is not None and not bl, [bl, after, fmsgs[-30:]])
    for (tag, ph), t0 in zip(phones, p_q1):
        d = ph_tl(ph)
        seq = [s for t, s in d.get('tl') or [] if t >= t0]
        ok('phone %s: question, result, question, result, nothing in between (%s)' % (tag, ' > '.join(seq)), seq == ['vQ', 'vRes', 'vQ', 'vRes'], [seq, (d.get('msgs') or [])[-30:]])

    print('\nEND EARLY: End round at question 2 of 3')
    t_end = js(tv, 'Date.now()-window.__T0')
    p_end = [js(ph, 'Date.now()-window.__T0') for _, ph in phones]
    ok('CONTROL: question 2 of 3 is revealed and End round is there', R.json(host, 'JSON.stringify([].map.call(document.querySelectorAll("#runBody button"),function(b){return b.textContent.trim();}))', []) and
       'Next question' in (R.json(host, 'JSON.stringify([].map.call(document.querySelectorAll("#runBody button"),function(b){return b.textContent.trim();}))', []) or []), text(host))
    click_text(host, 'End round'); answer_dialogs(host)
    ok('end early: the TV runs the winners\' reveal (the podium)', R.until(tv, '(function(){ try{ return !%s.document.getElementById("tvPodium").classList.contains("hidden"); }catch(e){ return false; } })()' % FRAME, 20) is True,
       tv_tl(tv)[1][-8:])
    ok('end early: and reaches the winner', R.until(tv, '(function(){ try{ var d=%s.document; return !d.getElementById("tvPodium").classList.contains("hidden") && /winner|tonight/i.test(d.getElementById("tvPodTitle").textContent) && !d.querySelector("#tvPodiumCols .pcol.hid"); }catch(e){ return false; } })()' % FRAME, 40) is True,
       js(tv, '(function(){ try{ return %s.document.getElementById("tvPodTitle").textContent; }catch(e){ return ""; } })()' % FRAME))
    shot(tv, 'end-early-tv-podium')
    top, frame, fmsgs = tv_tl(tv)
    ok('end early: the TV never went to its lobby or the ads first', not any('tvLobby' in s for t, s in frame if t >= t_end) and all(s == 'frame' for t, s in top if t >= t_end),
       [[x for x in frame if x[0] >= t_end], [x for x in top if x[0] >= t_end]])
    for (tag, ph), want in zip(phones, ('1st place', 'You finished 2nd')):
        ok('end early: phone %s is on its final screen' % tag, R.until(ph, FINAL, 30) is True, text(ph))
        ok('end early: phone %s says its place ("%s")' % (tag, want), R.until(ph, 'document.getElementById("finalRank").textContent.indexOf(%s)>=0' % json.dumps(want), 30) is True,
           js(ph, 'document.getElementById("vFinal").innerText'))
        st = R.json(ph, '(function(){ var r=document.getElementById("finalRank"), s=getComputedStyle(r), p=document.getElementById("finalScore").getBoundingClientRect(), b=r.getBoundingClientRect();'
                        ' return JSON.stringify({ col:s.color, fs:parseFloat(s.fontSize), fw:+s.fontWeight, under: b.top>=p.bottom-1 && b.top-p.bottom<=16 }); })()', {}) or {}
        ok('end early: phone %s\'s place is as plain as the points: white, bold, at least 18px, right under them (%s)' % (tag, st),
           st.get('col') == 'rgb(255, 255, 255)' and (st.get('fs') or 0) >= 18 and (st.get('fw') or 0) >= 700 and st.get('under') is True, st)
        ok('end early: phone %s is asked "How was that?"' % tag, R.until(ph, ASKED, 75) is True, text(ph))
        shot(ph, 'end-early-final-' + tag)
        fit = R.json(ph, 'JSON.stringify({ sh: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), H: innerHeight, sw: document.documentElement.scrollWidth, W: document.documentElement.clientWidth })', {}) or {}
        ok('end early: phone %s\'s final screen fits one screen, no scroll (%s)' % (tag, fit), (fit.get('sh') or 9999) <= (fit.get('H') or 0) + 1 and fit.get('sw') == fit.get('W'), fit)
    errs = [js(s, 'JSON.stringify(window.__errs||[])') for _, s in phones] + [js(host, 'JSON.stringify(window.__errs||[])')]
    ok('no page threw anything (both phones, the console)', all(e in ('[]', None) for e in errs), errs)

    print('\nMID-QUESTION: a second quiz ended with question 1 open, nobody answered yet')
    click_text(host, 'Start a new round'); time.sleep(2); answer_dialogs(host)
    ok('the next lobby opens', open_quiz(host, tv, 3) or R.until(host, LOBBY, 10) is True, [text(host), js(host, ERRT)])
    for tag, ph in phones:
        R.until(ph, '!document.getElementById("vWait").classList.contains("hidden") || !document.getElementById("vFinal").classList.contains("hidden")', 20)
    tap(host, 'startBtn'); answer_dialogs(host)
    ok('the second quiz starts', R.until(host, has_btn('First question'), 30) is True, js(host, ERRT))
    click_text(host, 'First question')
    for tag, ph in phones:
        ok('the question reaches phone %s' % tag, R.until(ph, '!document.getElementById("vQ").classList.contains("hidden") && document.querySelectorAll("#pAnswers .pans:not(:disabled)").length===4', 30) is True, text(ph))
    time.sleep(1.0)
    click_text(host, 'End round'); answer_dialogs(host)
    for tag, ph in phones:
        ok('mid-question: phone %s leaves the question' % tag, R.until(ph, 'document.getElementById("vQ").classList.contains("hidden")', 20) is True, text(ph))
        ok('mid-question: phone %s is asked "How was that?" (never a bare GAME ENDED)' % tag, R.until(ph, ASKED, 20) is True, text(ph))
        shot(ph, 'mid-question-end-' + tag)
    ok('mid-question: no scores, so the TV is back on its lobby, not a podium of nobody', R.until(tv, '(function(){ try{ var d=%s.document; return !d.getElementById("tvLobby").classList.contains("hidden"); }catch(e){ return document.getElementById("gameFrame").style.display==="none"; } })()' % FRAME, 20) is True,
       tv_tl(tv)[1][-6:])
    errs = [js(s, 'JSON.stringify(window.__errs||[])') for _, s in phones] + [js(host, 'JSON.stringify(window.__errs||[])')]
    ok('no page threw anything (both phones, the console)', all(e in ('[]', None) for e in errs), errs)


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('trivia-ux-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    try:
        night()
    except Exception as e:
        import traceback; traceback.print_exc()
        ok('the night ran to the end', False, repr(e))
    finally:
        if R: R.close()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
