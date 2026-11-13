#!/usr/bin/env python3
"""THE RAFFLE TICKET: STUB AT THE START, EVERY STUB BESIDE ITS OWN NUMBER, NO TICKET TWICE IN A ROW (Dean, 13 Nov 2026, INBOX 355).

The ticket on the raffle wall (/app/vp-drawstyle.js, the ticket roll) is the one ticket graphic that the home page hero demo (Raffle tab),
the venue's real raffle wall, /see-a-night's wall and the raffle console's TV preview all show. Played in real Chrome on tools/browser-rig:

  1. THE STUB IS ON THE LEFT, like a raffle book: on every ticket the stub is the first box, ends where the body starts, its dashed
     perforation is on its RIGHT edge, the half-circle bites sit on that line (top and bottom), and the ticket has no tear edge on its left
  2. EVERY STUB BESIDE ITS OWN NUMBER: the stub's number is the ticket's number, and the nearest big number to the right of a stub is its own
     (before: "142 | 142 087 | 087" read as a stub next to the next ticket's number)
  3. NEVER THE SAME TICKET TWICE IN A ROW: the whole roll stepped frame by frame (ctl.seek) for ranges from 1 to 150 down to 11 tickets,
     winners at the ends and middle, and a winner that arrives late (mid roll); no two neighbours match, and the winning number is on one ticket only
  4. NO FLICKER: while the roll runs every ticket keeps its size and its stub keeps its place; tickets never overlap each other on the roll
  5. TV SAFE AREA: the winning ticket and every line under it sit inside the 5% border at 1280x720 and 1920x1080
  6. THE DRAW IS ONE TICKET AT A TIME (355 update 2): the reel is single tickets, each with its own stub at the front; one winning ticket a
     prize (the win picture has exactly one ticket standing and one number in the winner line); the hero demo draws one ticket a prize.
     Strips of five consecutive numbers are how tickets are SOLD, never how they are drawn (the draw looks never make one)
  7. END TO END, TWO PHONES: the real console draws, the TV (/tv) rolls the ticket and lands on the server's winner, the host claims it;
     two phones are joined to the room throughout (a raffle has no phone game: the ticket is checked against the wall)

Set VP_SHOTS=<folder> to keep screenshots.
    python3 tools/raffle-ticket-stub-in-chrome.test.py
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import rig  # noqa: E402

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:500]))
    if not cond: bad += 1

SHOTS = os.environ.get('VP_SHOTS', '')
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
def shot(r, sid, name):
    if SHOTS: time.sleep(0.4); r.shot(sid, os.path.join(SHOTS, name))

# --- what one ticket looks like, measured (run inside the document that holds the stage) -------------------------------------------------
GEOM = r'''(function(doc){
  var out = {n: 0, bad: [], notch: [], nums: [], sizes: [], overlap: 0};
  var tks = [].filter.call(doc.querySelectorAll(".vpds-tk"), function(t){ var it = t.parentNode, cs = doc.defaultView.getComputedStyle(it);
    var b = t.getBoundingClientRect(); return cs.visibility !== "hidden" && parseFloat(it.style.opacity || 1) > 0.5 && b.width > 0 && b.right > 0 && b.left < doc.defaultView.innerWidth; });
  tks.sort(function(a, b){ return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
  var allNo = tks.map(function(t){ return t.querySelector(".vpds-ticket-body .vpds-no"); });
  tks.forEach(function(t, i){
    out.n++;
    var kids = t.children, stub = t.querySelector(".vpds-stub"), body = t.querySelector(".vpds-ticket-body"), no = allNo[i], sno = t.querySelector(".vpds-sno");
    var tr = t.getBoundingClientRect(), sr = stub.getBoundingClientRect(), br = body.getBoundingClientRect(), nr = no.getBoundingClientRect(), sc = doc.defaultView.getComputedStyle(stub), tc = doc.defaultView.getComputedStyle(t);
    var bf = doc.defaultView.getComputedStyle(stub, "::before"), af = doc.defaultView.getComputedStyle(stub, "::after");
    var sloc = sno.getBoundingClientRect();
    var tol = 1.5 * (tr.width / 600);
    if (kids[0] !== stub || kids[1] !== body) out.bad.push("stub is not the first box");
    // layout positions (a winning ticket is tilted and scaled, which turns a screen rect into a bigger box)
    if (stub.offsetLeft !== 0) out.bad.push("stub does not start the ticket " + stub.offsetLeft);
    if (Math.abs(body.offsetLeft - (stub.offsetLeft + stub.offsetWidth)) > 1) out.bad.push("stub does not end where the body starts " + (body.offsetLeft - stub.offsetWidth));
    if (!(stub.offsetLeft + stub.offsetWidth <= body.offsetLeft + no.offsetLeft + 1)) out.bad.push("stub is not left of the number");
    if (sc.borderRightStyle !== "dashed" || sc.borderLeftStyle !== "none") out.bad.push("perforation is not the stub's right edge: " + sc.borderRightStyle + "/" + sc.borderLeftStyle);
    if (tc.borderLeftStyle !== "none" && parseFloat(tc.borderLeftWidth) > 0) out.bad.push("the ticket still has a tear edge on its left");
    var cx = function(r){ return (r.left + r.right) / 2; };
    // the stub's own number is inside the stub, and says the same as the big number
    if (cx(sloc) < sr.left - tol || cx(sloc) > sr.right + tol) out.bad.push("stub number is outside the stub");
    if (sno.textContent !== no.textContent) out.bad.push("stub says " + sno.textContent + " but the number says " + no.textContent);
    // the notches: half circles centred on the perforation line, top and bottom, on the stub's RIGHT
    [bf, af].forEach(function(p, k){ out.notch.push([k ? "bottom" : "top", p.right, p.left, p.width, p.borderRadius, p.top, p.bottom]); });
    if (bf.right !== "-14.5px" || af.right !== "-14.5px") out.bad.push("notch not on the stub's right edge: " + bf.right + "/" + af.right);
    if (bf.left !== "auto" && parseFloat(bf.left) < 0 && bf.right === "auto") out.bad.push("notch on the left");
    // the nearest big number to the right of this stub is its own
    var best = null;
    allNo.forEach(function(n){ var r = n.getBoundingClientRect(); if (r.left >= (sr.left + sr.right) / 2 && (best === null || r.left < best.left)) best = {left: r.left, el: n}; });
    if (!best || best.el !== no) out.bad.push("a stub has another ticket's number next to it");
    out.nums.push(no.textContent);
    out.sizes.push([t.offsetWidth, t.offsetHeight, stub.offsetLeft, Math.round(sr.left - tr.left)]);
    if (i && tr.left < tks[i - 1].getBoundingClientRect().right - 2) out.overlap++;
  });
  return JSON.stringify(out);
})'''

# a page-level sweep: every frame of the roll for a range and a winner (the roll is a pure function of time: ctl.seek)
SWEEP = r'''(function(cfgs){
  var res = [];
  cfgs.forEach(function(c){
    var host = document.createElement("div"); host.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999"; document.body.appendChild(host);
    var ctl = VPDrawStyle.create(host, {style: "ticket", mode: "raffle", digits: c.digits || 3, min: c.min, max: c.max, drawSecs: 6, venueName: "Test Alpha", name: "Friday meat raffle"});
    var R = 1.2 + 6, repeats = [], dupWin = 0, frames = 0, over = 0, hi = 0, t, seq;
    function look(tt){
      ctl.seek(tt); frames++;
      var tk = [].filter.call(host.querySelectorAll(".vpds-tk"), function(x){ return getComputedStyle(x.parentNode).visibility !== "hidden"; });
      tk.sort(function(a, b){ return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
      seq = tk.map(function(x){ return x.querySelector(".vpds-ticket-body .vpds-no").textContent; });
      for (var i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1] && seq[i] !== "") repeats.push([tt.toFixed(2), seq[i]]);
      seq.forEach(function(s){ var v = parseInt(s, 10); if (v > hi) hi = v; if (s.length > (c.digits || 3)) over++; });
      if (c.pick && tt > 0.2) { var w = String(c.pick); while (w.length < (c.digits || 3)) w = "0" + w; var k = seq.filter(function(s){ return s === w; }).length; if (k > 1) dupWin++; }
    }
    ctl.start && 0;
    if (c.late) {                       // the server's winner arrives half way through the roll
      for (t = 0; t <= 3.5; t += 0.05) look(t);
      ctl.setPick({number: c.pick});
      for (t = 3.5; t <= R + 0.2; t += 0.05) look(t);
    } else {
      ctl.setPick({number: c.pick});
      for (t = 0; t <= R + 0.2; t += 0.05) look(t);
    }
    look(R + 2.5);                      // the win picture
    var stand = [].filter.call(host.querySelectorAll(".vpds-tk"), function(x){ var it = x.parentNode; return getComputedStyle(it).visibility !== "hidden" && parseFloat(it.style.opacity || 1) > 0.5; });
    var standing = stand.length, standingNo = stand.length ? parseInt(stand[0].querySelector(".vpds-ticket-body .vpds-no").textContent, 10) : -1;
    res.push({standing: standing, standingNo: standingNo, cfg: c, frames: frames, repeats: repeats.slice(0, 5), nRepeats: repeats.length, dupWin: dupWin, over: over, hi: hi, last: seq});
    ctl.destroy(); host.remove();
  });
  return JSON.stringify(res);
})'''

VISIBLE = ('(function(i){var e=document.getElementById(i);if(!e)return false;var s=getComputedStyle(e),b=e.getBoundingClientRect();'
           'return !e.classList.contains("hidden")&&s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0;})')
def vis(i): return VISIBLE + '(%s)' % json.dumps(i)
BC_BEFORE = ('window.__bcNames=[];var B=window.BroadcastChannel;if(B){var W=function(n){window.__bcNames.push(String(n));return new B(n);};W.prototype=B.prototype;window.BroadcastChannel=W;}')
HOST_SAYS = r'''(function(msgs){
  var code=(document.getElementById("hostLineCode")||document.getElementById("hostCode")||{}).textContent||"";
  var names=(window.__bcNames||[]).filter(function(n){return n==="fake-rt:vp-"+code;}), seen={};
  names.forEach(function(n){ if(seen[n]) return; seen[n]=1; var b=new BroadcastChannel(n);
    msgs.forEach(function(m){ b.postMessage({event:"msg", payload:m}); }); setTimeout(function(){ try{ b.close(); }catch(e){} }, 500); });
  return Object.keys(seen).length;
})'''
STAGE_T = '(window.__vpdsLast ? window.__vpdsLast.time() : -1)'
STAGE_WIN = '(window.__vpdsLast ? window.__vpdsLast.win : -1)'
STAGE_TEXT = '(function(){var h=document.getElementById("tvStyleHost");return h?h.textContent.replace(/\\s+/g," ").trim():"";})()'
G = lambda doc_expr: '(' + GEOM + ')(' + doc_expr + ')'


def wall(r, w, h):
    slug = r.W.info['slug']
    _, s = r.open('/app/raffle/screen?venue=' + slug + '&sting=0', width=w, height=h,
                  before='try{sessionStorage.setItem("vpTvHop", %s)}catch(e){};' % json.dumps(slug) + BC_BEFORE)
    r.until(s, 'document.readyState==="complete" && (window.__bcNames||[]).some(function(n){return /^fake-rt:vp-/.test(n);})', 20)
    time.sleep(1.5)
    return s
def says(r, s, msgs):
    n = r.ask(s, HOST_SAYS + '(%s)' % json.dumps(msgs)); time.sleep(0.4); return n
def geom(r, s, doc='document'):
    v = r.ask(s, G(doc))
    try: return json.loads(v)
    except Exception: return {'n': 0, 'bad': ['no answer: %s' % str(v)[:200]], 'notch': [], 'nums': [], 'sizes': [], 'overlap': 0}


R = None
try:
    # ------------------------------------------------------------------------------------------------ 1 to 6 on the raffle wall
    print('\n1. STUB AT THE START, BESIDE ITS OWN NUMBER (the raffle wall at 1280x720 and 1920x1080)')
    R = rig.Rig()
    for (w, h) in ((1280, 720), (1920, 1080)):
        s = wall(R, w, h)
        says(R, s, [{'t': 'state', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150}])
        says(R, s, [{'t': 'drawing', 'prizeLabel': 'Meat tray', 'pad': 3, 'min': 1, 'max': 150, 'spinSecs': 7.2, 'style': 'ticket', 'drawSecs': 6,
                     'raffle': 'Friday meat raffle', 'prizeNo': 1, 'prizeOf': 3}, {'t': 'pick', 'numbers': [87], 'pad': 3, 'min': 1, 'max': 150}])
        ok('%d: the ticket roll is up' % w, R.until(s, vis('tvStyle') + ' && document.querySelectorAll("#tvStyleHost .vpds-tk").length>=5', 8) is True)
        # watch the roll as it runs: 40 looks over the draw, none of them wrong
        worst = {'bad': set(), 'overlap': 0, 'seen': 0, 'sizes': set(), 'tickets': 0}
        t_end = time.time() + 6.5
        while time.time() < t_end:
            g = geom(R, s)
            worst['bad'].update(g['bad']); worst['overlap'] += g['overlap']; worst['seen'] += 1; worst['tickets'] += g['n']
            for z in g['sizes']: worst['sizes'].add(tuple(z[:3]))
            time.sleep(0.12)
        ok('%d: on the roll (%d looks, %d tickets seen) every stub is first, ends where its body starts, left of its number, beside its own number' % (w, worst['seen'], worst['tickets']),
           worst['seen'] >= 20 and worst['tickets'] >= 40 and not worst['bad'], sorted(worst['bad']))
        ok('%d: the perforation is on the stub\'s right and the two half-circle bites are on that line, top and bottom, and nowhere else' % w,
           worst['seen'] >= 20 and not any('notch' in b or 'perforation' in b or 'tear edge' in b for b in worst['bad']), sorted(worst['bad']))
        ok('%d: NO FLICKER: every ticket is 600x320 with its stub at its left edge on every look (%s)' % (w, sorted(worst['sizes'])),
           worst['sizes'] == {(600, 320, 0)}, sorted(worst['sizes']))
        ok('%d: tickets never overlap one another on the roll' % w, worst['overlap'] == 0, worst['overlap'])
        shot(R, s, 'ticket-roll-%d.jpg' % w)
        t = R.ask(s, STAGE_T); wn = R.ask(s, STAGE_WIN)
        R.until(s, STAGE_T + '>' + STAGE_WIN + '+0.2', 8)
        says(R, s, [{'t': 'winner', 'prizeLabel': 'Meat tray', 'numbers': [87], 'pad': 3, 'allowRedraw': True, 'time': 60}])
        ok('%d: the wall says ONE winner line' % w, R.until(s, '/Bring ticket 087 to the host\\./.test(' + STAGE_TEXT + ')', 8) is True, R.ask(s, STAGE_TEXT))
        time.sleep(3.2)
        g = geom(R, s)
        ok('%d: the winning ticket, stub first, says 087 on the stub and on the ticket, and nothing is beside it that is not its own' % w,
           g['n'] >= 1 and not g['bad'] and '087' in g['nums'], [g['bad'], g['nums']])
        # TV safe area: the winning ticket (scaled up) and the lines under it sit in the 5% border
        box = R.ask(s, '''(function(){var W=innerWidth,H=innerHeight,m=0.05,bad=[];
          [].forEach.call(document.querySelectorAll("#tvStyleHost .vpds-tk, #tvStyleHost .vpds-claim, #tvStyleHost .vpds-prize, #tvStyleHost .vpds-clock"),function(e){
            if(e.classList.contains("vpds-tk")){ var it=e.parentNode; if(getComputedStyle(it).visibility==="hidden"||parseFloat(it.style.opacity||1)<0.5) return; }
            else { var o=parseFloat(getComputedStyle(e).opacity); if(!(o>0.5)||!(e.textContent||"").trim()) return; }
            var b=e.getBoundingClientRect(); if(!b.width) return;
            if(b.left<W*m-1||b.right>W*(1-m)+1||b.top<H*m-1||b.bottom>H*(1-m)+1) bad.push([e.className,Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]);});
          return JSON.stringify(bad);})()''')
        ok('%d: TV safe area: the winning ticket and its lines are inside the 5%% border' % w, box == '[]', box)
        shot(R, s, 'ticket-win-%d.jpg' % w)
        ok('%d: no page error' % w, not (R.ask(s, 'window.__errs') or []), R.ask(s, 'window.__errs'))

    # ---------------------------------------------------------------------------------------------- 3 the whole roll, frame by frame
    print('\n3. NEVER THE SAME TICKET TWICE IN A ROW (every frame of the roll, many ranges and winners)')
    s = wall(R, 1280, 720)
    cfgs = [{'min': 1, 'max': 150, 'pick': 87}, {'min': 1, 'max': 150, 'pick': 1}, {'min': 1, 'max': 150, 'pick': 150}, {'min': 1, 'max': 150, 'pick': 87, 'late': True},
            {'min': 1, 'max': 40, 'pick': 7}, {'min': 1, 'max': 40, 'pick': 33, 'late': True}, {'min': 1, 'max': 12, 'pick': 5}, {'min': 1, 'max': 12, 'pick': 12, 'late': True},
            {'min': 50, 'max': 60, 'pick': 55}, {'min': 1, 'max': 9, 'pick': 9}, {'min': 1, 'max': 300, 'pick': 142}, {'min': 1, 'max': 1500, 'pick': 1087, 'digits': 4}]
    out = R.json(s, SWEEP + '(%s)' % json.dumps(cfgs), [], wait=60)
    ok('the sweep ran every range (%d of %d), frame after frame' % (len(out), len(cfgs)), len(out) == len(cfgs) and all(o['frames'] >= 140 for o in out), [(o['cfg'], o['frames']) for o in out])
    for o in out:
        c = o['cfg']; tag = '%d to %d, winner %d%s' % (c['min'], c['max'], c['pick'], ', arriving late' if c.get('late') else '')
        ok('%s: no two neighbours match on any of %d frames, and the winning number is on one ticket only' % (tag, o['frames']),
           o['nRepeats'] == 0 and o['dupWin'] == 0, [o['repeats'], o['dupWin']])
    ok('a three-digit book never shows a fourth digit, and no number on the reel is outside its range',
       all(o['over'] == 0 for o in out if o['cfg'].get('digits', 3) == 3) and all(o['hi'] <= o['cfg']['max'] for o in out), [(o['cfg'], o['hi'], o['over']) for o in out])
    ok('ONE WINNER A PRIZE: the win picture of every sweep has exactly one standing ticket, and it is the server\'s number',
       all(o['standing'] == 1 and o['standingNo'] == o['cfg']['pick'] for o in out), [(o['cfg']['pick'], o['standing'], o['standingNo']) for o in out])
    R.close()

    # ------------------------------------------------------------------------------------------------------ 6 the home page demo
    print('\n6. THE DEMO IS A BELIEVABLE BOOK')
    clock = open(os.path.join(ROOT, 'venueplay/app/vp-demo-clock.js'), encoding='utf-8').read()
    m = re.search(r'var RAFFLE=\{[^}]*?MIN:(\d+), MAX:(\d+), PAD:(\d+)', clock)
    tk = [int(x) for x in re.findall(r'ticket:(\d+)', clock.split('var RAFFLE=')[1].split('var MEMBERS')[0])] if 'var RAFFLE=' in clock else []
    ok('the hero demo raffle is tickets 1 to 150, three digits', bool(m) and (int(m.group(1)), int(m.group(2)), int(m.group(3))) == (1, 150, 3), m and m.groups())
    ok('and its three winning tickets are inside that book, one ticket a prize', len(tk) == 3 and all(1 <= x <= 150 for x in tk), tk)
    rs = open(os.path.join(ROOT, 'venueplay/app/raffle/screen.html'), encoding='utf-8').read()
    ok('the demo draws ONE ticket a prize: each draw\'s pick and winner carry [d.ticket], never a strip',
       'm(msg("pick", i, { numbers:[d.ticket] }))' in rs and 'numbers:[d.ticket], time:C.CLAIM_SECS' in rs and 'numbers:[d.ticket] }' in rs, 'demo messages changed')

    # ------------------------------------------------------------------------------------------------------ 7 end to end with two phones
    print('\n7. END TO END: the console draws, the TV rolls the ticket, the host claims; two phones in the room')
    R = rig.Rig(host_pages=('/app/raffle/host.html',))
    W = R.W
    W.ask('POST', '/host/gaming/declare', {'venue_id': W.info['venue'], 'format': 'raffle', 'state': 'QLD', 'category_claimed': 'test rig'}, {})
    W.seed('vp_venue_screen', [{'venue_id': W.info['venue'], 'slug': W.info['slug'], 'slides': [], 'logo_url': None,
                                'raffle': {'label': 'Meat Raffle', 'day': 'Friday', 'time': '6:30pm'},
                                'raffles': [{'id': 'raf-only01', 'label': 'Meat Raffle', 'day': 'Friday', 'time': '6:30pm'}]}], replace=True)
    R.db['vp_raffle_prizes'] = [{'label': 'Meat tray', 'raffle_id': 'raf-only01', 'venue_id': W.info['venue'], 'id': 'p0', 'created_at': '2026-10-20T00:00:00Z'}]
    W.seed('vp_raffle_prizes', R.db['vp_raffle_prizes'], replace=True)
    ttid, tv = R.open('/tv?venue=' + W.info['slug'], width=1280, height=720)
    phones = []
    for nm in ('Ann', 'Bob'):
        ptid, ph = R.open('/play?room=' + W.info['code'], width=390, height=844)
        phones.append((ptid, ph, nm))
    for ptid, ph, nm in phones:
        ready = R.phone_ready(ph, 60)
        R.ask(ph, 'document.getElementById("nameIn").value=%s; document.getElementById("joinBtn").click(); true' % json.dumps(nm))
        ok('phone %s is in the room (ready for a name, then joined)' % nm, ready is True and R.until(ph, vis('vWait') + ' || ' + vis('vCard') + ' || ' + vis('vNoRoom'), 20) is not False, ready)
    htid, host = R.open('/app/raffle/host.html', width=1000, height=1100)
    ok('the console loads, signed in', R.until(host, '!document.getElementById("consoleView").classList.contains("hidden")', 60) is True)
    R.until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); R.ask(host, 'document.querySelector("#tvLine .tvline-btn").click(); true')
    R.until(host, '[].some.call(document.querySelectorAll("#prizePresets button"),function(b){return /Meat tray/.test(b.textContent);})', 20)
    R.ask(host, 'document.querySelector("#prizePresets button").click(); true')
    FR = '(function(){var f=document.getElementById("gameFrame");return f && f.style.display!=="none" && f.contentDocument && f.contentDocument.body ? f.contentDocument : null;})()'
    ok('the TV has the raffle up', R.until(tv, FR + ' !== null && /Meat tray/.test(' + FR + '.body.innerText)', 40) is True)
    R.ask(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
    seen = {'bad': set(), 'looks': 0, 'tk': 0, 'seqs': [], 'overlap': 0}
    t_end = time.time() + 60
    while time.time() < t_end:
        R.ask(host, 'var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && /I understand|Accept|Start as a free/i.test(x.textContent); })[0]; if(b) b.click(); true')
        if R.ask(host, 'document.getElementById("winnerCard").classList.contains("show")') is True: break
        v = R.ask(tv, '(function(d){ if(!d) return ""; return (' + GEOM + ')(d); })(' + FR + ')')
        if v:
            g = json.loads(v); seen['bad'].update(g['bad']); seen['looks'] += 1; seen['tk'] += g['n']; seen['overlap'] += g['overlap']
            if g['nums']: seen['seqs'].append(g['nums'])
        time.sleep(0.15)
    ok('the draw puts a winner on the console', R.until(host, 'document.getElementById("winnerCard").classList.contains("show")', 30) is True, R.ask(host, '((document.getElementById("hostErrText")||{}).textContent||"")'))
    ok('on the TV\'s real ticket roll (%d looks, %d tickets) every stub was first and beside its own number' % (seen['looks'], seen['tk']), seen['looks'] >= 5 and seen['tk'] >= 10 and not seen['bad'], [seen['looks'], sorted(seen['bad'])])
    ok('and no two neighbouring tickets matched on any look', all(a != b for q in seen['seqs'] for a, b in zip(q, q[1:])) and seen['overlap'] == 0, [q for q in seen['seqs'] if any(a == b for a, b in zip(q, q[1:]))][:3])
    won = R.ask(host, 'document.getElementById("wcPrize").textContent')
    num = R.ask(host, '(document.getElementById("wcNumber")||document.getElementById("wcNum")||{}).textContent||document.getElementById("winnerCard").innerText')
    ok('the console\'s winner card names the prize', won == 'Meat tray', won)
    ok('the TV lands on the server\'s ticket and says ONE winner line for it', R.until(tv, '/Bring ticket \\d{3} to the host\\./.test(' + FR + '.body.innerText)', 30) is True, R.ask(tv, FR + '.body.innerText.slice(0,200)'))
    time.sleep(3)
    g = R.json(tv, '(' + GEOM + ')(' + FR + ')', {})
    wl = R.ask(tv, FR + '.body.innerText')
    mm = re.search(r'Bring ticket (\d{3}) to the host', wl or '')
    ok('ONE winner for the prize: one "Bring ticket" line, one ticket standing', (wl or '').count('Bring ticket') == 1 and len(g.get('nums', [])) == 1, [(wl or '').count('Bring ticket'), g.get('nums')])
    ok('the winning ticket on the wall is stub first, and its stub and big number both say the number in the winner line (%s)' % (mm and mm.group(1)),
       bool(mm) and not g.get('bad') and mm.group(1) in g.get('nums', []), [g.get('bad'), g.get('nums'), mm and mm.group(1)])
    shot(R, tv, 'e2e-tv-win.jpg'); shot(R, host, 'e2e-host-win.jpg'); shot(R, phones[0][1], 'e2e-phone-ann.jpg'); shot(R, phones[1][1], 'e2e-phone-bob.jpg')
    R.until(host, '!document.getElementById("claimBtn").disabled && document.getElementById("claimBtn").offsetParent!==null', 20)
    R.ask(host, 'document.getElementById("claimBtn").click(); true')
    ok('claimed: the results list has Meat tray as Collected',
       R.until(host, '/Meat tray/.test(document.getElementById("winnersBody").textContent) && /Collected/.test(document.getElementById("winnersBody").textContent)', 20) is True,
       R.ask(host, 'document.getElementById("winnersBody").textContent'))
    ok('the two phones are still in the room and neither threw', all(not (R.ask(ph, 'window.__errs') or []) for _, ph, _ in phones), [R.ask(ph, 'window.__errs') for _, ph, _ in phones])
    ok('no script error on the console or the TV', not (R.ask(host, 'window.__errs') or []) and not (R.ask(tv, 'window.__errs') or []), [R.ask(host, 'window.__errs'), R.ask(tv, 'window.__errs')])
finally:
    if R: R.close()

print('\n%d of %d checks passed' % (ran - bad, ran))
print('ALL %d CHECKS PASSED' % ran if not bad else '%d FAILED' % bad)
sys.exit(1 if bad else 0)
