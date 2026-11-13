#!/usr/bin/env python3
"""EVERY TV SCREEN'S FLOOR RUNS EDGE TO EDGE; ONLY ITS CONTENT KEEPS TO THE 5% SAFE BOX (INBOX 375, 13 Nov 2026).

Dean on the Kogan TV, 13 Nov: the screen "does not fit the whole screen". The wall (.tv) and the floor under the
slides (#tvFloor) had been moved 5% in from each edge for the TV safe area (INBOX 287.1, /app/vp-tvsafe.css), and
they carried their own paint: the floor rgb(10,10,11) inside, the page rgb(5,5,6) round it. On the TV that is a
lighter box in a black frame (~/venue-enrich/reports/real-night/kogan/shot-103.png, "Setting up this screen").
The rule now (tools/TV-SAFE-AREA-DECISION.md): backgrounds, glows, dims and the floor are FULL-BLEED, one colour
from the window's edge to the safe box and on in; only words, logos, QR codes and cards keep inside the 5% box.

What this checks, by PIXELS, in headless Chrome on the browser rig, at 1920x1080, 1280x720 and 960x540, on:
the "Setting up this screen" loading wall, the idle wall, the slides loop (a photo slide, a typed slide, the
members draws card, the raffle card, What's on), the bare /tv set-up screen, the home page's Advertising demo
(/tv?demo=1&ads=1), the bingo demo night on /tv, and the trivia, musical bingo, raffle, members draw and Top
Answers screens in their own demo nights, and the bingo demo as an older TV (Chromium 68) draws it. At every look it takes three pictures in a row:

    R   the FLOOR: the same screen with every piece of content hidden (anything with words of its own, an <img>,
        <canvas>, <video> or <svg>, in the page and its same-site frames): what is left is backgrounds, glows,
        dims, slide photos and cards' own boxes
    A   the screen as the room sees it
    R2  the floor again (so a look taken while something moves is not judged)

  1. NO FRAME: in R (8 strips per edge, each strip's rows or columns averaged, so a gradient's dithering is not a
     step), the colour 3px inside the safe line is what the colour outside it, carried on at its own slope, would be:
     a glow or gradient crosses the line smoothly, a ground that stops at the safe box steps there.
     A floor that stops at the safe box (the 13 Nov fault: 5 levels, rgb(5,5,6) to rgb(10,10,11)) is a step.
     The outer edge's colour and the floor's colour just inside the safe box are printed for each look.
     A full-bleed slide photo is not a frame: strips over a photo that reaches every edge are skipped, and the
     photo must reach every edge.
  2. NO CONTENT IN THE BORDER: across the 5% border band, A and the floor R must match; a point where A
     differs from R (and R2 agrees with R, so nothing was moving) is content in the border: a word, a logo,
     a QR or a card's words. "Painted in the border" here means "differs from the floor" (the DOM check in
     tools/tv-safe-area-in-chrome.test.py measures the same thing by element boxes).
  CONTROL: each screen had looks, and in them content that differs from its floor INSIDE the safe box, so a
  page where hiding did nothing (or nothing drew) cannot pass by being blank.

Takes the heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.
VP_SHOTS=<dir> also saves, per screen and size, the room's picture (A) of the first six looks and of any failing one.

    python3 tools/tv-fullbleed-in-chrome.test.py
"""
import base64, io, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib
from PIL import Image

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:600]))
    sys.stdout.flush()
    if not cond: bad += 1

def take_lock(tool='tv-fullbleed-in-chrome'):
    deadline = time.time() + int(os.environ.get('VP_WAIT_LOCK', '0') or 0)
    said = False
    while True:
        state, pid, text = gatelib.lock_state()
        if state == 'stale':
            print('  heavy lock is STALE (pid %s, "%s"). Not clearing somebody else\'s lock: refusing.' % (pid, text[:80]))
            return False
        if state in ('free', 'mine') and gatelib.hold_lock_or_refuse(tool, wait_s=0):
            return True
        if time.time() > deadline:
            print('  heavy lock held by pid %s ("%s"); gave up waiting' % (pid, text[:80])); return False
        if not said:
            print('  heavy lock held by pid %s ("%s"), waiting' % (pid, text[:80])); said = True
        time.sleep(0.5)

# HIDE THE CONTENT (in the page and its same-site frames): the same notion of "content" as the safe-area suite's
# OUTSIDE (an element with a text node of its own, or an img/canvas/video/svg). Each gets visibility:hidden
# !important inline, its old inline value kept so SHOW puts it back exactly. Boxes with no words of their own
# (the wall, the floor, slides, dims, cards' own backgrounds) are left as they are: that is the floor.
HIDE = r'''(function(){ var n=0; window.__fbHid=[];
  function own(el){ for(var c=el.firstChild;c;c=c.nextSibling) if(c.nodeType===3&&/\S/.test(c.nodeValue)) return true; return false; }
  function walk(doc){ var all=doc.body?doc.body.getElementsByTagName("*"):[];
    for(var i=0;i<all.length;i++){ var el=all[i], tg=el.tagName;
      if(tg==="IFRAME"){ try{ if(el.contentDocument) walk(el.contentDocument); }catch(e){} continue; }
      if(tg==="SCRIPT"||tg==="STYLE"||tg==="NOSCRIPT"||tg==="TEMPLATE") continue;
      /* confetti is a celebration, not the floor: hidden with the content (14 Nov 2026) */
      if(/^(IMG|CANVAS|VIDEO|svg|SVG)$/.test(tg) || own(el) || /(^|\s)confetti(\s|$)/.test(typeof el.className==="string"?el.className:"") || el.id==="vpCfLayer"){
        window.__fbHid.push([el, el.style.getPropertyValue("visibility"), el.style.getPropertyPriority("visibility")]);
        el.style.setProperty("visibility","hidden","important"); n++; } } }
  walk(document); return n; })()'''
SHOW = r'''(function(){ var h=window.__fbHid||[]; for(var i=0;i<h.length;i++){ var el=h[i][0];
    if(h[i][1]) el.style.setProperty("visibility",h[i][1],h[i][2]); else el.style.removeProperty("visibility"); }
  window.__fbHid=[]; return h.length; })()'''
# Full-bleed slide photos on the wall now (in window px), and what is on the wall, for the report.
PHOTOS = r'''JSON.stringify((function(){ var out=[];
  [].forEach.call(document.querySelectorAll("#tvAds .ad .adimg, .wo-bleed, [data-fullbleed]"),function(p){
    var s=p.closest(".ad")||p, o=+getComputedStyle(s).opacity; if(o<0.02) return; var r=p.getBoundingClientRect();
    if(r.width<2||r.height<2) return; out.push([Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]); });
  return out; })())'''
STATE = r'''(function(){ var bits=[];
  try{ var f=document.getElementById("gameFrame"); if(f&&f.style.display!=="none"&&f.src) bits.push("game:"+f.src.split("/app/")[1].split("?")[0]); }catch(e){}
  var s=document.querySelector("#tvAds .ad.show"); if(s&&!(document.getElementById("adsRoot")||{}).hidden) bits.push("slide:"+s.className.replace(/\bad\b|\bshow\b|\blayer\b|\bsnap\b/g,"").trim().split(/\s+/).join("."));
  [].forEach.call(document.querySelectorAll(".tv > .layer:not(.hidden), .tv > [id]:not(.hidden)"),function(l){ var c=getComputedStyle(l);
    if(c.display!=="none"&&c.visibility!=="hidden"&&+c.opacity>0.5&&l.id&&!/^(tvAds|adsRoot|winBurst|tvStatus|tvCorner)$/.test(l.id)) bits.push(l.id); });
  if(document.body.classList.contains("tv-loading")) bits.push("loading");
  var b=document.getElementById("ballReveal"); if(b&&b.classList.contains("live")) bits.push("ballreveal");
  return bits.join(" ")||(document.body.className||"page"); })()'''


# The members draws card on the wall, when it is the lit slide: its heading's case and spacing, and the fonts of its times.
DRAWS_TYPE = r'''(function(){ var s=document.querySelector("#tvAds .ad.show .adweek"); if(!s) return null; var c=s.closest(".ad"), t=c.querySelector(".adtag");
  var cs=getComputedStyle(t), ls=cs.letterSpacing; return {head:t.textContent, tag:[cs.textTransform, (ls==="0px"||ls==="normal")?"normal":ls],
  fonts:[].map.call(c.querySelectorAll(".wktime, .wkday .tn"), function(e){ return getComputedStyle(e).fontFamily; })}; })()'''


def png(r, sid):
    d = r.B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
    return Image.open(io.BytesIO(base64.b64decode(d['data']))).convert('RGB')


def dmax(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def inside(x, y, rects):
    for (l, t, rr, b) in rects:
        if l <= x < rr and t <= y < b: return True
    return False


STEP = 2.0   # levels, on strip averages two pixels apart: a gradient moves well under 1; the 13 Nov frame was 5


def frames(R, R2, W, H, photos):
    """Steps in the floor between the window's edge and just inside the safe box. 8 strips per edge; each strip's
    pixels on one row (top/bottom edges) or column (left/right) are averaged, then the profile is walked inward.
    A pixel that differs between the two floor pictures (R, R2) is moving (confetti, a ball rolling in) and is left out."""
    px, p2 = R.load(), R2.load()
    mx, my = int(round(W * 0.05)), int(round(H * 0.05))
    found, report = [], {}
    full = [p for p in photos if p[0] <= 0 and p[1] <= 0 and p[2] >= W and p[3] >= H]
    for edge in ('top', 'bottom', 'left', 'right'):
        horiz = edge in ('top', 'bottom')
        span = (mx + 6, W - mx - 6) if horiz else (my + 6, H - my - 6)
        depth = (my if horiz else mx) + 6
        n = 8
        for k in range(n):
            a = span[0] + (span[1] - span[0]) * k // n
            b = span[0] + (span[1] - span[0]) * (k + 1) // n
            prof = []
            for dpt in range(depth + 1):
                acc, cnt = [0, 0, 0], 0
                for u in range(a, b, 2):
                    x, y = ((u, dpt) if edge == 'top' else (u, H - 1 - dpt) if edge == 'bottom'
                            else (dpt, u) if edge == 'left' else (W - 1 - dpt, u))
                    if inside(x, y, photos): continue
                    c = px[x, y]
                    if dmax(c, p2[x, y]) > 6: continue   # moving (confetti, a ball rolling): not the floor
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; cnt += 1
                prof.append(None if cnt < 8 else (acc[0] / cnt, acc[1] / cnt, acc[2] / cnt))
            if k == n // 2 and prof and prof[0] is not None and prof[-1] is not None:
                report[edge] = [tuple(int(round(v)) for v in prof[0]), tuple(int(round(v)) for v in prof[-1])]
            # THE STEP IS JUDGED AT THE SAFE LINE, against the floor's own slope (14 Nov 2026, INBOX 375 follow-up). A ground
            # inset to the safe box ends exactly there: the colour 3px inside differs from what the colour outside, carried on
            # at its own slope, would be. A gradient, a glow or a blurred backdrop changes smoothly across the line and is not
            # a step; a box that stops at the line is (the 13 Nov fault: 5 levels; the threshold is 2).
            s0 = (my if horiz else mx)
            o9, o3, i3 = s0 - 9, s0 - 3, s0 + 3
            if i3 < len(prof) and prof[o9] is not None and prof[o3] is not None and prof[i3] is not None:
                want = [prof[o3][j] + (prof[o3][j] - prof[o9][j]) for j in range(3)]   # 6px on at the outside's own slope
                d = max(abs(prof[i3][j] - want[j]) for j in range(3))
                if d >= STEP:
                    found.append('%s strip %d at the safe line (%dpx in): outside %s, inside %s' % (edge, k, s0, tuple(int(round(v)) for v in prof[o3]), tuple(int(round(v)) for v in prof[i3])))
    return found, report, bool(full)


def border_content(A, R, R2, W, H):
    """Points in the 5% border band where the room's picture differs from the floor, R and R2 agreeing."""
    pa, pr, p2 = A.load(), R.load(), R2.load()
    mx, my = int(round(W * 0.05)), int(round(H * 0.05))
    hits, moving, box = 0, 0, None
    for y in range(0, H, 3):
        band_row = y < my - 1 or y >= H - my + 1
        xs = range(0, W, 3) if band_row else list(range(0, mx - 1, 3)) + list(range(W - mx + 1, W, 3))
        for x in xs:
            r1 = pr[x, y]
            if dmax(r1, p2[x, y]) > 6: moving += 1; continue
            if dmax(pa[x, y], r1) > 40:
                hits += 1
                box = [x, y, x, y] if box is None else [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
    return hits, moving, box


def content_inside(A, R, W, H):
    pa, pr = A.load(), R.load()
    mx, my = int(round(W * 0.05)), int(round(H * 0.05))
    n = 0
    for y in range(my + 4, H - my - 4, 9):
        for x in range(mx + 4, W - mx - 4, 9):
            if dmax(pa[x, y], pr[x, y]) > 40: n += 1
    return n


class Screen(object):
    def __init__(self, label, w, h):
        self.label, self.w, self.h = label, w, h
        self.looks, self.inside, self.frame_bad, self.content_bad, self.edges, self.states = 0, 0, [], [], [], []
        self.photo_ok, self.shot_n = True, 0

    def look(self, r, sid, tag=''):
        try:
            hid = r.ask(sid, HIDE)
            R = png(r, sid)
            r.ask(sid, SHOW)
            A = png(r, sid)
            r.ask(sid, HIDE)
            R2 = png(r, sid)
            r.ask(sid, SHOW)
        except Exception as e:
            try: r.ask(sid, SHOW)
            except Exception: pass
            self.states.append('look failed: %s' % e); return
        W, H = A.size
        photos = r.json(sid, PHOTOS, default=[]) or []
        state = (tag + ' ' + str(r.ask(sid, STATE) or '')).strip()
        self.states.append(state)
        self.looks += 1
        fr, rep, full = frames(R, R2, W, H, photos)
        if photos and not full:
            # a slide photo on the wall must reach every edge (Dean, 9 Nov: no black border round a slide)
            self.photo_ok = False
            fr.append('a slide photo that does not reach the edges: %s' % photos)
        if rep: self.edges.append((state, rep))
        if fr: self.frame_bad.append((state, fr[:4]))
        hits, moving, box = border_content(A, R, R2, W, H)
        if hits >= 3: self.content_bad.append((state, hits, box))
        self.inside = max(self.inside, content_inside(A, R, W, H))
        if SHOTS and (self.shot_n < 6 or (fr or hits >= 3) and self.shot_n < 14):
            base = os.path.join(SHOTS, 'fb-%s-%dx%d-%d' % (self.label.split(':')[0].replace(' ', '-').replace('/', ''), W, H, self.shot_n))
            A.save(base + '.png'); self.shot_n += 1
            if hits >= 3: R.save(base + '-floor.png')

    def judge(self):
        L = '%s at %dx%d' % (self.label, self.w, self.h)
        ok('%s: the floor runs to the window edges, no frame at the safe box (%d looks)' % (L, self.looks),
           self.looks > 0 and not self.frame_bad, self.frame_bad[:3] or self.states[-3:])
        ok('%s: nothing differs from the floor in the 5%% border (words, logos, QR, cards stay inside)' % L,
           self.looks > 0 and not self.content_bad, self.content_bad[:3])
        ok('CONTROL: %s had looks with content inside the safe box (%d looks, %d content points inside)' % (L, self.looks, self.inside),
           self.looks >= 1 and self.inside >= 20, [self.looks, self.inside, self.states[-3:]])
        if self.edges:
            st, rep = self.edges[0]
            print('       edge vs floor (outer px, just inside safe box), first look [%s]: %s' % (st, ', '.join('%s %s %s' % (k, v[0], v[1]) for k, v in sorted(rep.items()))))
        print('       states seen: %s' % ' | '.join(sorted(set(self.states)))[:400])


SIZES = [(1920, 1080), (1280, 720), (960, 540)]
# For proving a mutation quickly by hand (never set by the gate): VP_FB_ONLY=wall,bingo (scene keys: wall = /tv loading, idle
# and slides; or a DEMOS label's first word) and VP_FB_SIZES=1920x1080. Unset, every scene at every size runs.
ONLY = [x for x in os.environ.get('VP_FB_ONLY', '').split(',') if x]
if os.environ.get('VP_FB_SIZES'): SIZES = [tuple(int(v) for v in z.split('x')) for z in os.environ['VP_FB_SIZES'].split(',')]


def wall_scenes(RIG, w, h, quick):
    """/tv on the rig's venue: loading, idle, then the slides loop with every kind of slide."""
    r = RIG.Rig(hold={'/__worker/screen': 7})
    try:
        slug, venue = r.W.info['slug'], r.W.info['venue']
        # LOADING then IDLE: a venue with nothing on its wall yet.
        r.W.seed('vp_venue_screen', [{'venue_id': venue, 'slug': slug, 'logo_url': None, 'raffle': None, 'slides': [], 'events': []}], replace=True)
        load, idle = Screen('loading: /tv "Setting up this screen"', w, h), Screen('idle: /tv, a venue with no slides', w, h)
        tid, sid = r.open('/tv?venue=' + slug, width=w, height=h)
        r.until(sid, 'document.readyState==="complete" && document.body.classList.contains("tv-loading")', 15)
        time.sleep(1.5); load.look(r, sid, 'loading')
        time.sleep(1.5); load.look(r, sid, 'loading')
        r.until(sid, '!document.body.classList.contains("tv-loading")', 30)
        time.sleep(2.5); idle.look(r, sid, 'idle')
        time.sleep(3.0); idle.look(r, sid, 'idle')
        r.close_tab(tid)
        load.judge(); idle.judge()

        # THE SLIDES LOOP: a photo slide, a typed slide, the members draws, a raffle, What's on (with a picture).
        evs = [{'id': 'e1', 'title': 'Roast Night', 'day': 'tue', 'line': '$10', 'image_url': r.base + '/logos/ad-slides/tugun-tuesday.jpg'},
               {'id': 'e2', 'title': 'Steak Night', 'day': 'thu', 'line': '$15'},
               {'id': 'k1', 'link': 'draw', 'ref': 'Members draw'}, {'id': 'k3', 'link': 'night', 'day': 'tue', 'game': 'trivia'}]
        slides = [{'image_url': r.base + '/logos/ad-slides/tugun-friday.jpg', 'seconds': 5},
                  {'tag': 'Every Wednesday', 'head': 'Trivia night', 'sub': 'From 7pm, teams of up to six', 'accent': 'pink', 'seconds': 5},
                  {'image_url': r.base + '/logos/ad-slides/tugun-thursday.jpg', 'seconds': 5, 'qr': True}]
        r.W.seed('vp_venue_screen', [{'venue_id': venue, 'slug': slug, 'logo_url': None, 'events': evs, 'slides': slides,
                                     'raffle': None, 'raffles': [{'label': 'Meat raffle', 'day': 'Tuesday', 'time': '6:30pm'}]}], replace=True)
        r.W.seed('vp_venue_settings', [{'venue_id': venue, 'setup_answers': {'week': [{'day': 'tue', 'games': [{'game': 'trivia', 'start': '19:30'}]}]}}], replace=True)
        r.W.seed('v_vp_screen_draws', [{'slug': slug, 'name': 'Members draw', 'draw_day': 'Tuesday', 'draw_time': '7pm', 'current_jackpot_cents': 123400, 'timezone': 'Australia/Brisbane'}], replace=True)
        loop = Screen('slides: the /tv slides loop (photo, typed, draws, raffle, What\'s on)', w, h)
        tid, sid = r.open('/tv?venue=' + slug, width=w, height=h)
        r.until(sid, 'document.readyState==="complete" && !document.body.classList.contains("tv-loading") && !!document.querySelector("#tvAds .ad.show")', 40)
        seen, last, t_end, draws = set(), None, time.time() + (60 if quick else 95), None
        while time.time() < t_end and len(seen) < 6:
            cur = r.ask(sid, '(function(){var s=document.querySelector("#tvAds .ad.show");return s?(s.className+"|"+(s.textContent||"").slice(0,40)):"";})()')
            if cur and cur != last:
                time.sleep(1.3)   # the slide's .8 s fade in
                loop.look(r, sid, 'slide'); seen.add(cur.split('|')[0]); last = cur
                if draws is None: draws = r.json(sid, DRAWS_TYPE, default=None)
            time.sleep(0.4)
        r.close_tab(tid)
        loop.judge()
        # NO "MADE BY AI" LOOK on the members draws card (Dean, 6 Nov 2026; INBOX 375): its heading was pink spaced capitals
        # and its times monospace. Now the heading is as typed (sentence case, no letter spacing) and the times normal type.
        ok('slides loop at %dx%d: the members draws card heading is plain sentence case (not spaced capitals) and its times and "Tonight" are not monospace' % (w, h),
           bool(draws) and draws.get('tag') == ['none', 'normal'] and draws.get('head', '').startswith('This week') and not any('mono' in f.lower() for f in draws.get('fonts', [])) and len(draws.get('fonts', [])) >= 1, draws)
        ok('CONTROL: slides loop at %dx%d: the loop showed at least 4 kinds of slide (%d: %s)' % (w, h, len(seen), sorted(seen)), len(seen) >= 4, sorted(seen))
    finally:
        r.close()


DEMOS = [
    ('bare: /tv with no venue (set up this screen)', '/tv', 4),
    ('ads demo: /tv?demo=1&ads=1 (the home page Advertising view)', '/tv?demo=1&ads=1', 18),
    ('bingo: /tv?demo=1, the bingo demo night', '/tv?demo=1', 34),
    ('trivia: /app/trivia/screen?demo=1', '/app/trivia/screen?demo=1', 30),
    ('musical: /app/musical/screen?demo=1', '/app/musical/screen?demo=1', 30),
    ('raffle: /app/raffle/screen?demo=1', '/app/raffle/screen?demo=1', 26),
    ('members: /app/members/screen?demo=1', '/app/members/screen?demo=1', 26),
    ('topanswers: /app/topanswers/screen?demo=1', '/app/topanswers/screen?demo=1', 24),
    # an older TV (Chromium 68, ?oldtv=68 strips what it cannot read; tools/old-tv-in-chrome.test.py): the grounds still bleed
    ('oldtv: /tv?demo=1&oldtv=68, the bingo demo as an older TV draws it', '/tv?demo=1&oldtv=68', 16),
]


def demo_scenes(RIG, w, h, quick):
    r = RIG.Rig()
    try:
        for (label, path, secs) in DEMOS:
            if ONLY and label.split(':')[0] not in ONLY: continue
            s = Screen(label, w, h)
            tid, sid = r.open(path, width=w, height=h)
            r.until(sid, 'document.readyState==="complete"', 20)
            time.sleep(2.0)
            t_end = time.time() + (max(6, secs // 2) if quick else secs)
            while True:
                s.look(r, sid)
                if time.time() >= t_end: break
                time.sleep(2.2)
            r.close_tab(tid)
            s.judge()
    finally:
        r.close()


def main():
    if not take_lock():
        return 2
    import rig as RIG
    for (w, h) in SIZES:
        quick = w != 1920
        print('\n%dx%d: /tv loading, idle and the slides loop' % (w, h))
        if not ONLY or 'wall' in ONLY: wall_scenes(RIG, w, h, quick)
        print('\n%dx%d: the set-up screen, the demos and every game screen' % (w, h))
        demo_scenes(RIG, w, h, quick)
    # the gate reads the last line: "ALL n CHECKS PASSED" is a pass (release-check suite_passed)
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
