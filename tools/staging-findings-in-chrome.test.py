#!/usr/bin/env python3
"""THE SMALL FAULTS FROM THE FIRST PLAY OF THE REAL-LOOKING STAGING VENUES (16 Nov 2026), PLAYED IN CHROME (17 Nov 2026).

On the rig (tools/browser-rig/rig.py, headless Chrome), the real trivia and members walls hear a host on their own channel:

  1. A SHORT LEADERBOARD FILLS THE WALL: two players after question 1 were two thin rows at the top of an empty black screen. Up to five
     rows are bigger and centred in the space under the title, at 1280x720 and 1920x1080, inside the 5% safe box; a full board of ten is
     exactly the size it was (measured on the wall's own board markup, filled as renderBoardPaged fills it)
  2. THE MEMBERS WALL'S BOARD TITLE is in the new-look title style (Anton, white, no letter spacing), never the spaced pink mono caps eyebrow
     the AI-look rule bans; the single-draw title the same
  3. no page errors

    python3 tools/staging-findings-in-chrome.test.py       screenshots go to $VP_SHOTS if set
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import rig as RIG
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: time.sleep(0.4); r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

BC_BEFORE = ('window.__bcNames=[];var B=window.BroadcastChannel;if(B){var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;}')
HOST_SAYS = r'''(function(msgs){
  var code=(document.getElementById("hostLineCode")||document.getElementById("hostCode")||{}).textContent||"";
  var names=(window.__bcNames||[]).filter(function(n){return /^fake-rt:vp-/.test(n) && (!code || n==="fake-rt:vp-"+code);}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    msgs.forEach(function(m){ b.postMessage({event:"msg", payload:m}); }); setTimeout(function(){ try{ b.close(); }catch(e){} }, 500); });
  return Object.keys(seen).length;
})'''
def screen(r, path, width, height):
    slug = r.W.info['slug']
    _, s = r.open(path + '?venue=' + slug + '&sting=0', width=width, height=height,
                  before='try{sessionStorage.setItem("vpTvHop", %s)}catch(e){};' % json.dumps(slug) + BC_BEFORE)
    r.until(s, 'document.readyState==="complete" && (window.__bcNames||[]).some(function(n){return /^fake-rt:vp-/.test(n);})', 20)
    time.sleep(1.5)
    return s
def says(r, s, msgs):
    n = r.ask(s, HOST_SAYS + '(%s)' % json.dumps(msgs)); time.sleep(0.8); return n

BOARD = r'''(function(){var lay=document.getElementById("tvBoard"),box=document.getElementById("tvBoardRows"),t=document.getElementById("tvBoardTitle");
  if(!lay||lay.classList.contains("hidden")) return null;
  var rr=[].map.call(box.querySelectorAll(".brow"),function(e){var b=e.getBoundingClientRect();return {t:b.top,b:b.bottom,l:b.left,r:b.right,h:b.height,rank:e.querySelector(".r").textContent,fs:parseFloat(getComputedStyle(e.querySelector(".n")).fontSize)};});
  var bb=box.getBoundingClientRect(),tb=t.getBoundingClientRect();
  return JSON.stringify({rows:rr,box:{t:bb.top,b:bb.bottom},title:{b:tb.bottom},W:innerWidth,H:innerHeight});})()'''

# The wall's own board, filled the way renderBoardPaged fills it (one .brow per team: place, name, points). The trivia wall's channel
# needs a signed host on the rig, so the rows are put in directly: what is measured is the wall's own CSS on its own markup.
FILL = r'''(function(n){var lay=document.getElementById("tvBoard"),box=document.getElementById("tvBoardRows");
  [].forEach.call(document.querySelectorAll(".layer"),function(l){l.classList.add("hidden");}); lay.classList.remove("hidden");
  var hc=document.getElementById("tvHoldCard"); if(hc) hc.style.display="none";   /* the waiting card a wall with no host shows: not part of the board */
  document.getElementById("tvBoardTitle").textContent="Leaderboard"; box.innerHTML="";
  for(var i=0;i<n;i++){var r=document.createElement("div");r.className="brow"+(i===0?" top1":"");
    [["r",String(i+1)],["n","Team "+(i+1)],["s",String(1000-i*50)]].forEach(function(c){var e=document.createElement("span");e.className=c[0];e.textContent=c[1];r.appendChild(e);});
    box.appendChild(r);} return box.children.length;})'''
def fill(r, s, n):
    r.ask(s, FILL + '(%d)' % n); time.sleep(0.4)

def part_board():
    print('\n1. A SHORT LEADERBOARD FILLS THE WALL (staging, 16 Nov: two thin rows at the top of an empty screen)')
    r = RIG.Rig()
    try:
        for (w, h) in ((1280, 720), (1920, 1080)):
            s = screen(r, '/app/trivia/screen', w, h)
            fill(r, s, 10)
            full = (r.json(s, BOARD, {}) or {})
            fill(r, s, 2)
            two = (r.json(s, BOARD, {}) or {})
            fr, tr = full.get('rows') or [], two.get('rows') or []
            ok('%d: a full board of ten is ten rows, all inside the wall, the size it always was' % w, len(fr) == 10 and all(x['b'] <= h * 0.95 + 1 for x in fr) and abs(fr[0]['h'] - 0.0295 * w) < 0.006 * w,
               [len(fr), fr and fr[-1]['b'], fr and round(fr[0]['h'], 1)])
            ok('%d: two players: two rows, each at least 1.5 times the height of a full board\'s row, the names bigger too' % w,
               len(tr) == 2 and fr and min(x['h'] for x in tr) >= 1.5 * fr[0]['h'] and min(x['fs'] for x in tr) >= 1.4 * fr[0]['fs'], [len(tr), [round(x['h'], 1) for x in tr], fr and round(fr[0]['h'], 1)])
            if len(tr) == 2:
                above, below = tr[0]['t'] - two['box']['t'], two['box']['b'] - tr[-1]['b']
                ok('%d: and centred in the space under the title (gap above %d, below %d), not stuck to the top' % (w, above, below), abs(above - below) <= 0.02 * h + 2 and above > 0.08 * h, [above, below])
                ok('%d: inside the 5%% safe box, below the title' % w, tr[0]['t'] > two['title']['b'] and tr[-1]['b'] <= h * 0.95 + 1 and tr[0]['l'] >= w * 0.05 - 1 and tr[0]['r'] <= w * 0.95 + 1, tr)
            shot(r, s, 'board-two-%d' % w)
            fill(r, s, 5)
            five = (r.json(s, BOARD, {}) or {}).get('rows') or []
            ok('%d: five players: the big rows still all fit inside the safe box' % w, len(five) == 5 and fr and min(x['h'] for x in five) >= 1.5 * fr[0]['h'] and five[-1]['b'] <= h * 0.95 + 1, [len(five), five and five[-1]['b']])
            fill(r, s, 6)
            six = (r.json(s, BOARD, {}) or {}).get('rows') or []
            ok('%d: six players: the ordinary rows, as before' % w, len(six) == 6 and fr and abs(six[0]['h'] - fr[0]['h']) < 1.5, [len(six), six and six[0]['h']])
            ok('%d: no page errors' % w, not (r.ask(s, 'window.__errs') or []), r.ask(s, 'window.__errs'))
    finally:
        r.close()

TITLE = r'''(function(sel){var e=document.querySelector(sel);if(!e)return null;var c=getComputedStyle(e);
  return JSON.stringify({text:e.textContent,ff:c.fontFamily,ls:c.letterSpacing,col:c.color,fs:parseFloat(c.fontSize),vis:!!e.offsetParent});})'''
def part_members_title():
    print('\n2. THE MEMBERS WALL\'S BOARD TITLE IN THE NEW LOOK (no spaced pink mono caps)')
    r = RIG.Rig()
    try:
        for (w, h) in ((1280, 720), (1920, 1080)):
            s = screen(r, '/app/members/screen', w, h)
            says(r, s, [{'t': 'state', 'drawName': 'Members badge draw', 'jackpotCents': 30000, 'playing': False,
                         'draws': [{'id': 'a', 'name': 'Members badge draw', 'jackpotCents': 30000, 'drawDay': 'Friday', 'drawTime': '7 pm'},
                                   {'id': 'b', 'name': 'Thursday draw', 'jackpotCents': 10000, 'drawDay': 'Thursday', 'drawTime': '6 pm'}]}])
            r.until(s, '!document.getElementById("idleBoardWrap").classList.contains("hidden")', 6)
            t = (r.json(s, TITLE + '("#idleBoardWrap .boardhd")', {}) or {})
            ok('%d: the board says This week\'s members draws, on show' % w, t.get('text') == 'This week’s members draws' and t.get('vis') is True, t)
            ok('%d: in Anton, white, with no letter spacing (not JetBrains Mono, not pink, not spaced)' % w,
               'Anton' in (t.get('ff') or '') and 'JetBrains' not in (t.get('ff') or '') and t.get('ls') in ('normal', '0px') and t.get('col') == 'rgb(255, 255, 255)', t)
            ok('%d: a heading size (at least 3%% of the wall\'s width)' % w, (t.get('fs') or 0) >= 0.03 * w * 0.9, t.get('fs'))
            shot(r, s, 'members-board-title-%d' % w)
            one = (r.json(s, TITLE + '("#idleDrawName")', {}) or {})
            ok('%d: the single-draw title is the same style' % w, 'Anton' in (one.get('ff') or '') and one.get('ls') in ('normal', '0px'), one)
            ok('%d: no page errors' % w, not (r.ask(s, 'window.__errs') or []), r.ask(s, 'window.__errs'))
    finally:
        r.close()

if __name__ == '__main__':
    if not gatelib.hold_lock_or_refuse('staging-findings-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        sys.exit(2)
    only = sys.argv[1:]
    if not only or 'board' in only: part_board()
    if not only or 'members' in only: part_members_title()
    print('\nALL %d CHECKS PASSED' % ran if not bad else '\n%d OF %d CHECKS FAILED' % (bad, ran))
    sys.exit(1 if bad else 0)
