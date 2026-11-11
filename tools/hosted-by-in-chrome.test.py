#!/usr/bin/env python3
"""HOSTED BY ON THE TV, AS CHROME PAINTS IT, AND THE TWO-PUB HOST (Dean, 6 Nov 2026, INBOX 120; migration 181).

A venue's trivia host, or their trivia company, shows "Hosted by <name>" and their logo on the TV during their
nights. Three parts, each on the REAL pages served from this checkout:

  1. THE TWO-PUB HOST, a real room (tools/browser-rig: the real game Worker in jsc, the signed-in host's own
     console, tv.html on each venue's link). One host login, Sam, holds a host row at Test Alpha and at The
     Anchor, two venues on two different accounts, each with Hosted by switched on for trivia and Sam's one
     card (the world tools/test-hosted-by.js builds through the Account page):
       - /app lists both venues and Switch venue moves the console from one to the other
       - a trivia night runs at each: lobby, a question, the reveal, the scores, End game
       - each venue's TV shows "Hosted by Quiz Co Trivia", with the card's logo address, beside the venue's
         name or logo, on the lobby, the question and the end screen, and never another venue's
  2. THE WALL (the sales-page demos, ?demo=1, on Chrome's virtual clock) at 1920x1080 and 1280x720, the
     trivia lobby, a question, the scores and the podium, and musical bingo's lobby and a song:
       - the line sits BESIDE the venue's logo (its middle on the logo's middle), or UNDER the venue's name
         when there is no logo, inside the screen
       - it never overlaps the venue's logo or name, our venueplay mark, the game's name, the question, the
         answers, the join QR and code, or a score row
       - the venue's logo and our mark are exactly where they are without it (nothing pushed)
       - the host's logo is never taller than the venue's own, and the words are at least 12px
     with a round crest (Tugun), a wide 6.6:1 wordmark, and no logo at all; with and without a host logo
  3. THE SETTING, Account > People > a host's row > Hosted by (tools/browser-rig/admin_site.py, the real
     billing Worker), at 375 and 390 (phone), 768 (iPad) and 1280 (laptop):
       - nothing scrolls sideways, every button and tick box is at least 44px tall, the name box is 16px
         text (no zoom on an iPhone), the panel lines up inside the row
       - choosing a logo, typing a name and ticking trivia saves through /account/hosted-by-save: the card
         and this venue's switch are what the Worker stored, and the row then says so

VP_SHOTS=<dir> saves every picture (the Hosted by review set). Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK
seconds to wait) and never clears anybody else's.

    VP_WAIT_LOCK=1800 python3 tools/hosted-by-in-chrome.test.py
"""
import base64, http.server, importlib.util, io, json, os, sys, tempfile, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
_spec = importlib.util.spec_from_file_location('nl', os.path.join(ROOT, 'tools', 'trivia-newlook-in-chrome.test.py'))
NL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(NL)
SHOTS = os.environ.get('VP_SHOTS', '')
ONLY = os.environ.get('VP_ONLY', '')          # "rooms", "wall" or "people": one part, for a quicker look
ran = bad = 0
NAME = 'Quiz Co Trivia'
LONG = 'Smith and Sons Quiz Nights Qld'   # 30 characters; the setting takes 32 at most


def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1


def shot_path(name):
    return os.path.join(SHOTS, name) if SHOTS else ''


# A host's logo: a round yellow badge and a white wordmark, the shape trivia companies use.
HOST_LOGO = ('<svg xmlns="http://www.w3.org/2000/svg" width="440" height="200" viewBox="0 0 440 200">'
             '<circle cx="100" cy="100" r="92" fill="#FFC24B"/>'
             '<text x="100" y="132" font-family="Arial Black,Arial" font-size="96" font-weight="900" fill="#1a1200" text-anchor="middle">Q</text>'
             '<text x="212" y="96" font-family="Arial Black,Arial" font-size="70" font-weight="900" fill="#fff">QUIZ</text>'
             '<text x="212" y="170" font-family="Arial Black,Arial" font-size="70" font-weight="900" fill="#FFC24B">CO.</text></svg>')


# ------------------------------------------------------------------------------------------------ 1. two pubs
TVHB = r'''(function(){ var f=document.getElementById("gameFrame"), d=f && f.contentDocument; if(!d) return JSON.stringify({none:1});
  function shown(e){ if(!e) return false; var s=d.defaultView.getComputedStyle(e), b=e.getBoundingClientRect(); return !e.hidden && !e.classList.contains("hidden") && s.display!=="none" && s.visibility!=="hidden" && b.width>0 && b.height>0; }
  var lay=[].filter.call(d.querySelectorAll(".layer"),function(l){ return shown(l); })[0];
  var hb=d.getElementById("hostedBy"), img=hb && hb.querySelector(".hb-logo");
  return JSON.stringify({ layer: lay ? lay.id : null, hb: shown(hb), name: hb ? (hb.querySelector(".hb-name")||{}).textContent : null,
    lbl: hb ? (hb.querySelector(".hb-lbl")||{}).textContent : null, src: img ? (img.getAttribute("src")||"") : null,
    venue: (d.getElementById("venueNameTag")||{}).textContent||"", errs: (f.contentWindow.__errs||[]).length }); })()'''


def click_btn(r, sid, text):
    return r.ask(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(text))


def wait_btn(r, sid, text, secs=25):
    return r.until(sid, '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(text), secs)


ERRT = 'JSON.stringify([(document.getElementById("hostErrText")||{}).textContent, [].map.call(document.querySelectorAll("button"),function(x){return x.textContent.trim();}).filter(Boolean).join("|")])'


def night(r, venue, slug, set_id, other_slug):
    """One trivia night at one venue, the TV on the venue's link, the console on whichever venue /app last chose."""
    tag = venue['name']
    t1, tv = r.open('/tv?venue=' + slug, width=1920, height=1080)
    r.until(tv, '!!document.getElementById("adsRoot")', 20)
    t2, host = r.open('/app/trivia/host.html', width=1280, height=900)
    r.until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 30); time.sleep(2)
    here = r.ask(host, 'localStorage.getItem("vpCurrentVenue")')
    ok('%s: the console is on %s, the venue Switch venue chose' % (tag, tag), here == venue['id'], here)
    r.ask(host, '(function(){ var s=document.getElementById("setSel"); if(s){ s.value=%s; s.dispatchEvent(new Event("change")); } var c=document.getElementById("cfgCount"); c.value="2"; c.dispatchEvent(new Event("input")); return true; })()' % json.dumps(set_id))
    r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(2)
    if r.ask(host, '!!document.getElementById("vpTakeover")') is True:
        r.ask(host, 'document.getElementById("vpTakeoverGo").click(); true'); time.sleep(2)
    ok('%s: the host opens the lobby' % tag, r.until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 20) is True, r.ask(host, ERRT))
    r.until(tv, '(function(){ var o=JSON.parse(%s); return o.layer==="tvLobby" && o.hb===true; })()' % TVHB, 30)
    w = r.json(tv, TVHB)
    ok('%s TV, lobby: "Hosted by %s" is on the wall' % (tag, NAME), w.get('layer') == 'tvLobby' and w.get('hb') is True and w.get('name') == NAME and (w.get('lbl') or '').lower() == 'hosted by', w)
    ok('%s TV: with the card\'s own logo address (our storage, hosts/)' % tag, (w.get('src') or '').startswith('https://fake.supabase.co/storage/v1/object/public/venue-logos/hosts/'), w.get('src'))
    if SHOTS: r.shot(tv, shot_path('room-%s-lobby-1920.jpg' % slug))
    r.ask(host, 'setTimeout(function(){ document.getElementById("startBtn").click(); }, 0); true'); time.sleep(1)
    for _ in range(3):
        if r.ask(host, '!!document.getElementById("vpAskGo") || !!document.querySelector(".vp-ask button")') is True:
            r.ask(host, '(function(){ var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); b.click(); return true; })()'); time.sleep(1)
    ok('%s: the round starts' % tag, wait_btn(r, host, 'First question', 30) is True, r.ask(host, ERRT))
    click_btn(r, host, 'First question')
    ok('%s: the first question is up' % tag, wait_btn(r, host, 'Reveal answer', 30) is True, r.ask(host, ERRT))
    r.until(tv, 'JSON.parse(%s).layer==="tvQ"' % TVHB, 20)
    w = r.json(tv, TVHB)
    ok('%s TV, question: still "Hosted by %s"' % (tag, NAME), w.get('layer') == 'tvQ' and w.get('hb') is True and w.get('name') == NAME, w)
    time.sleep(1.5)   # past the slide's entrance, so the picture is not a blurred in-between frame
    if SHOTS: r.shot(tv, shot_path('room-%s-question-1920.jpg' % slug))
    click_btn(r, host, 'Reveal answer')
    ok('%s: revealed' % tag, wait_btn(r, host, 'Next question', 20) is True, r.ask(host, ERRT))
    click_btn(r, host, 'Next question')
    ok('%s: question two' % tag, wait_btn(r, host, 'Reveal answer', 30) is True, r.ask(host, ERRT))
    click_btn(r, host, 'Reveal answer')
    ok('%s: the last reveal offers the scores' % tag, wait_btn(r, host, 'Reveal leaderboard', 20) is True, r.ask(host, ERRT))
    click_btn(r, host, 'Reveal leaderboard')
    r.until(tv, 'JSON.parse(%s).layer==="tvBoard"' % TVHB, 25)
    w = r.json(tv, TVHB)
    ok('%s TV, end of the quiz: still "Hosted by %s"' % (tag, NAME), w.get('layer') == 'tvBoard' and w.get('hb') is True and w.get('name') == NAME, w)
    ok('%s TV: no script error on the wall' % tag, w.get('errs') == 0, r.ask(tv, 'JSON.stringify(document.getElementById("gameFrame").contentWindow.__errs)'))
    if SHOTS: r.shot(tv, shot_path('room-%s-end-1920.jpg' % slug))
    r.ask(host, 'document.getElementById("toAdsBtn").click(); true')
    time.sleep(2)
    errs = r.ask(host, 'JSON.stringify(window.__errs)')
    ok('%s: no script error on the console' % tag, errs == '[]', errs)
    r.close_tab(t2); r.close_tab(t1)


def rooms():
    print('\n1. THE TWO-PUB HOST: one login, two venues on two accounts, a trivia night at each')
    import rig as RIG
    r = RIG.Rig(host_pages=('/app/trivia/host.html',))
    try:
        A = {'id': r.W.info['venue'], 'name': 'Test Alpha', 'slug': r.W.info['slug']}
        B = {'id': '44444444-4444-4444-8444-444444444444', 'name': 'The Anchor', 'slug': 'the-anchor'}
        uid = RIG.UID
        logo = 'https://fake.supabase.co/storage/v1/object/public/venue-logos/hosts/%s/quizco.png' % uid
        SA, SB = '33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333332'
        # The page's own view (fake supabase-js): Sam is a HOST at both, each on its own account.
        r.db['vp_venues'][0]['founding_id'] = 'f-alpha'
        vb = dict(r.db['vp_venues'][0], id=B['id'], name=B['name'], slug=B['slug'], join_code='KTQ7MV', founding_id='f-anchor')
        r.db['vp_venues'].append(vb)
        r.db['vp_venue_staff'] = [{'auth_user_id': uid, 'venue_id': A['id'], 'role': 'host', 'display_name': 'Sam'},
                                  {'auth_user_id': uid, 'venue_id': B['id'], 'role': 'host', 'display_name': 'Sam the quizmaster'}]
        sets = [{'id': SA, 'title': 'Pub Classics', 'question_count': 2, 'visibility': 'public', 'owner_venue_id': A['id'], 'status': 'active'},
                {'id': SB, 'title': 'Anchor Night', 'question_count': 2, 'visibility': 'public', 'owner_venue_id': B['id'], 'status': 'active'}]
        r.db['vp_question_sets'] = sets
        # The Worker's database: the same two rows with each venue's switch, and Sam's one card.
        r.W.seed('vp_venues', [{'id': B['id'], 'name': B['name'], 'slug': B['slug'], 'status': 'active', 'join_code': 'KTQ7MV', 'au_state': 'QLD', 'max_players': 100, 'created_at': '2026-02-01T00:00:00Z'}])
        r.W.seed('vp_venue_staff', [{'id': 'st-a', 'auth_user_id': uid, 'venue_id': A['id'], 'role': 'host', 'hosted_by': {'trivia': True, 'musical': False}},
                                    {'id': 'st-b', 'auth_user_id': uid, 'venue_id': B['id'], 'role': 'host', 'hosted_by': {'trivia': True, 'musical': True}}], True)
        r.W.seed('vp_host_brands', [{'auth_user_id': uid, 'name': NAME, 'logo_url': logo}], True)
        r.W.seed('vp_question_sets', sets, True)
        r.W.seed('vp_questions', [{'id': 'q-%s-%d' % (s['id'][-1], i), 'set_id': s['id'], 'seq': i, 'question': '%s question %d?' % (s['title'], i), 'text': '%s question %d?' % (s['title'], i),
                                   'options': ['Red', 'Green', 'Blue', 'Gold'], 'correct_index': 2} for s in sets for i in (1, 2)])

        t0, app = r.open('/app/', width=1280, height=900)
        names = r.until(app, '(function(){ var b=[].map.call(document.querySelectorAll("#venuePickList button"),function(x){ return x.textContent.trim(); }); return b.length>=2 ? b.sort().join(", ") : false; })()', 30)
        ok('/app asks which venue, and lists both of Sam\'s (two accounts)', names == 'Test Alpha, The Anchor', names or r.ask(app, 'document.body.innerText.slice(0,300)'))
        r.ask(app, '[].filter.call(document.querySelectorAll("#venuePickList button"),function(x){ return x.textContent.trim()==="Test Alpha"; })[0].click(); true')
        ok('picking Test Alpha makes it the console\'s venue', r.until(app, 'localStorage.getItem("vpCurrentVenue")===%s' % json.dumps(A['id']), 15) is True, r.ask(app, 'localStorage.getItem("vpCurrentVenue")'))
        night(r, A, A['slug'], SA, B['slug'])

        print('Switch venue, then a night at The Anchor')
        r.ask(app, 'location.reload(); true'); time.sleep(3)
        r.until(app, '(function(){ var s=document.getElementById("switchVenue"), t=document.getElementById("venueSwitchInline"); return (!!s && s.offsetParent!==null) || (!!t && t.offsetParent!==null); })()', 30)
        r.ask(app, '(function(){ var s=document.getElementById("switchVenue"); if(!(s && s.offsetParent!==null)) s=document.getElementById("venueSwitchInline"); s.click(); return true; })()')
        names = r.until(app, '(function(){ var b=[].map.call(document.querySelectorAll("#venuePickList button"),function(x){ return x.textContent.trim(); }); return b.length>=2 ? b.sort().join(", ") : false; })()', 20)
        ok('Switch venue offers both venues again', names == 'Test Alpha, The Anchor', names)
        r.ask(app, '[].filter.call(document.querySelectorAll("#venuePickList button"),function(x){ return x.textContent.trim()==="The Anchor"; })[0].click(); true')
        ok('picking The Anchor switches the console\'s venue', r.until(app, 'localStorage.getItem("vpCurrentVenue")===%s' % json.dumps(B['id']), 15) is True, r.ask(app, 'localStorage.getItem("vpCurrentVenue")'))
        night(r, B, B['slug'], SB, A['slug'])
        asked = [c for c in r.W.calls if c == '/host/hosted-by']
        ok('each console asked the game Worker for its card (/host/hosted-by), once a console', len(asked) == 2, r.W.calls[-40:])
        r.close_tab(t0)
    finally:
        r.close()


# ------------------------------------------------------------------------------------------------ 2. the wall
class Site(NL.Site):
    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == '/x-fixture/host-logo.svg':
            return self.send(200, HOST_LOGO, 'image/svg+xml')
        return NL.Site.do_GET(self)


WALL = r'''(function(){
  try{ if(window.VPTvGame) VPTvGame.alignTitles(); }catch(e){}
  function R(e){ if(!e) return null; var cs=getComputedStyle(e); if(e.hidden || cs.display==="none" || cs.visibility==="hidden") return null; var b=e.getBoundingClientRect(); return (b.width>0&&b.height>0) ? [b.left,b.top,b.right,b.bottom] : null; }
  function on(l){ return !l.classList.contains("hidden") && getComputedStyle(l).display!=="none"; }
  var lay=[].filter.call(document.querySelectorAll(".layer"),on)[0];
  var hb=document.getElementById("hostedBy"), img=hb && hb.querySelector(".hb-logo"), nm=hb && hb.querySelector(".hb-name"), lb=hb && hb.querySelector(".hb-lbl");
  var parts=[], kids=[];
  if(lay){ [".qtext",".answers .ans",".qrbig",".scanplay",".codebox",".joinurl",".lobbyname","#tvBoardRows .brow",".pod",".podium > *",".nowplaying",".np",".songcard",".jsub"].forEach(function(sel){
    [].forEach.call(lay.querySelectorAll(sel),function(e){ var r=R(e); if(r) parts.push({sel:sel, r:r}); }); });
    [].forEach.call(lay.children,function(k){ var r=R(k); if(r) kids.push(r); }); }
  var mk=document.querySelector(".tv-corner .vn svg, .tv-corner svg");
  var ti=lay && lay.querySelector(".toplbl .tl-night");
  return JSON.stringify({ W:innerWidth, H:innerHeight, layer: lay ? lay.id : null, tf: lay ? (lay.style.transform||"") : null, hb: R(hb), name: nm ? nm.textContent : null,
    nameFs: nm ? parseFloat(getComputedStyle(nm).fontSize) : 0, gap: (hb && hb.querySelector(".hb-text") && hb.querySelector(".hb-text").parentNode===hb) ? (parseFloat(getComputedStyle(hb.querySelector(".hb-text")).rowGap) || 0) : 0, lblFs: lb ? parseFloat(getComputedStyle(lb).fontSize) : 0, lblR: R(lb), nameR: R(nm),
    img: R(img), imgOk: !!img && img.complete && img.naturalWidth>0, logo: R(document.getElementById("venueLogo")),
    tag: R(document.getElementById("venueNameTag")), mark: R(mk), title: R(ti), parts: parts, kids: kids });
})()'''


def overlap(a, b, pad=0):
    return bool(a and b) and a[0] < b[2] - pad and b[0] < a[2] - pad and a[1] < b[3] - pad and b[1] < a[3] - pad


def same(a, b, tol=1.0):
    return (a is None and b is None) or (bool(a and b) and all(abs(x - y) <= tol for x, y in zip(a, b)))


names = {}


def wall_checks(tag, m, base, host_logo, venue, mode):
    hb, W, H = m.get('hb'), m.get('W', 0), m.get('H', 0)
    want_layer = {'lobby': 'tvLobby', 'question': 'tvQ', 'board': 'tvBoard', 'podium': 'tvPodium'}.get(tag.rsplit(', ', 1)[-1])
    if want_layer and 'musical' not in tag:
        ok('%s: the picture is of the %s slide (%s)' % (tag, tag.rsplit(', ', 1)[-1], want_layer), m.get('layer') == want_layer, m.get('layer'))
    if 'musical' in tag and tag.endswith('lobby'):
        ok('%s: the picture is of the lobby (scan to play, the code)' % tag, m.get('layer') == 'tvLobby', m.get('layer'))
    nm = names.get(tag, NAME)
    ok('%s: "Hosted by %s" is on the wall' % (tag, nm), bool(hb) and m.get('name') == nm, m.get('name'))
    if not hb: return
    inset = max(14, round(0.012 * W))
    ok('%s: inside the screen, at least the venue logo\'s own margin from the left edge (%dpx)' % (tag, inset), hb[0] >= inset - 0.5 and hb[1] >= 0 and hb[2] <= W, hb)
    ok('%s: big enough to read across a pub: the name %.0fpx (about 30 at 1080), HOSTED BY %.0fpx (about 18)' % (tag, m.get('nameFs'), m.get('lblFs')),
       m.get('nameFs', 0) >= 0.024 * H and m.get('lblFs', 0) >= 0.0155 * H, (m.get('nameFs'), m.get('lblFs')))
    ok('%s: clear of our venueplay mark and the game\'s name' % tag, not overlap(hb, m.get('mark')) and not overlap(hb, m.get('title')), [hb, m.get('mark'), m.get('title')])
    # B lifts a slide that reaches the bottom (musical bingo's song chip, the podium) a few pixels clear of the line,
    # so its game name may move by up to 0.6% of the height there; the logos never move, and in A nothing moves.
    tt = 1.0 if mode == 'top' else 0.006 * H
    ok('%s: the header does not move: the venue logo and our mark exactly, the game\'s name %s' % (tag, 'exactly' if mode == 'top' else 'within %.0fpx' % tt),
       same(m.get('logo'), base.get('logo')) and same(m.get('mark'), base.get('mark')) and same(m.get('title'), base.get('title'), tt),
       [m.get('logo'), base.get('logo'), m.get('mark'), base.get('mark'), m.get('title'), base.get('title')])
    hits = [p for p in m.get('parts') or [] if overlap(hb, p['r'], 1)]
    ok('%s: clear of the question, the answers, the join and the scores' % tag, not hits, hits[:3])
    L = m.get('logo') if venue != 'none' else m.get('tag')
    if mode == 'top':
        ok('%s: the slide does not move at all (every part of it where it is without the line)' % tag,
           m.get('tf') == base.get('tf') and len(m.get('kids') or []) == len(base.get('kids') or []) and all(same(a, b) for a, b in zip(m.get('kids') or [], base.get('kids') or [])),
           [m.get('tf'), base.get('tf')])
        ok('%s: BESIDE the venue\'s %s, on its line, never on it' % (tag, 'name' if venue == 'none' else 'logo'), bool(L) and hb[0] >= L[2] and not overlap(hb, L), [hb, L])
        if L:
            mid = lambda r: (r[1] + r[3]) / 2
            mk = m.get('mark')
            top_floor = max(inset, min(L[1], mk[1]) if mk else L[1])
            ok('%s: the whole block centred on the venue %s\'s middle (within 2px, or held at the logos\' top)' % (tag, 'name' if venue == 'none' else 'logo'),
               abs(mid(hb) - mid(L)) <= 2 or abs(hb[1] - top_floor) <= 1, [hb, L, mk])
            # 15 Nov 2026: beside a wide wordmark or a name, centring put HOSTED BY above everything, 14px from the top.
            ok('%s: never higher than the venue %s and our mark (top %.0f, at least %.0f), so a TV that crops its edges keeps it' % (tag, 'name' if venue == 'none' else 'logo', hb[1], top_floor),
               hb[1] >= top_floor - 1, [hb, L, mk])
            ok('%s: inside the header band: no lower than the venue %s or 15%% of the height' % (tag, 'name' if venue == 'none' else 'logo'), hb[3] <= max(L[3], 0.15 * H) + 1, [hb, L])
        ok('%s: one shape: HOSTED BY above the name' % tag, bool(m.get('lblR')) and bool(m.get('nameR')) and m['lblR'][3] <= m['nameR'][1] + 1, [m.get('lblR'), m.get('nameR')])
    else:
        x0 = L[0] if L else inset
        ok('%s: along the bottom, left-aligned with the venue %s (%dpx)' % (tag, 'name' if venue == 'none' else 'logo', x0), abs(hb[0] - x0) <= 1 and hb[1] > 0.8 * H, [hb, L])
        ok('%s: clear of the bottom edge for overscan (%.0fpx, at least 40)' % (tag, H - hb[3]), H - hb[3] >= 39.5, hb)
        ok('%s: no part of the slide runs under it or off the screen' % tag, all(not overlap(hb, k, 1) and k[3] <= H for k in m.get('kids') or []), [k for k in m.get('kids') or [] if overlap(hb, k, 1)][:2])
    if host_logo:
        img = m.get('img')
        ok('%s: the host\'s logo has loaded' % tag, m.get('imgOk') is True and bool(img), img)
        if img and mode == 'top':
            ih, iw = img[3] - img[1], img[2] - img[0]
            want = round(0.7 * (m['logo'][3] - m['logo'][1])) if venue != 'none' else round(0.044 * H)
            # 15 Nov 2026: never smaller than its own words (HOSTED BY over the name); beside a wide wordmark the 70%
            # rule alone made it about 20px tall at 720.
            words = round((m['lblR'][3] - m['lblR'][1]) + m.get('gap', 0) + 1.15 * m.get('nameFs', 0)) if m.get('lblR') else 0   # HOSTED BY over one line of the name
            want = max(want, words)
            ok('%s: the host\'s logo is 70%% of the venue logo\'s height or as tall as HOSTED BY over one line of the name, whichever is more (%.0f against %.0f), or held to 13%% of the width' % (tag, ih, want),
               abs(ih - want) <= 1.5 or iw >= 0.13 * W - 1.5, [ih, iw, want])
            ok('%s: the host\'s logo is at least as tall as HOSTED BY over one line of the name (%.0f against %.0f)' % (tag, ih, words),
               words > 0 and ih >= words - 1.5, [ih, words])
    else:
        ok('%s: no host logo, so no empty space for one' % tag, m.get('img') is None, m.get('img'))


def wall(B, base):
    print('\n2. THE WALL: trivia and musical bingo at 1920x1080 and 1280x720, option A (top) and option B (bottom)')
    # THE LOBBY IS 0 TO 0.9 s OF THE DEMO with the opening show off (round 2 caught the question at 2.5 s and called it the
    # lobby): measured at 0.7 s, with the titles put on the logos' line as the wall's own one-second tick does.
    # Since 7 Nov 2026 the trivia demo shows the scores only at the round's end, after the podium (36 s, then 41 s), and
    # the musical bingo demo opens on the game and comes back to its lobby at 39 s (old-tv and trivia-newlook use the
    # same times). The states must be in time order: the clock only runs forward.
    trivia = [('lobby', 700), ('question', 4000), ('podium', 36000), ('board', 41000)]
    short = [('lobby', 700), ('question', 4000)]
    musical = [('song', 6000), ('lobby', 39000)]
    NL.SHOTS = ''   # the new-look suite's own pictures are not wanted here
    for w, h in ((1920, 1080), (1280, 720)):
        for venue, vq in (('crest', ''), ('wide', '&logo=/__fixture/wide-logo.svg'), ('none', '&logo=none')):
            st = trivia if venue == 'crest' else short
            basem = NL.load(B, base, '/app/trivia/screen.html?demo=1&sting=0' + vq, w, h, False, st, WALL)
            if SHOTS and venue == 'crest':
                snap(B, base, '/app/trivia/screen.html?demo=1&sting=0' + vq, w, h, st, 'tv-trivia-%dx%d-crest-nohost' % (w, h))
            for mode in ('top', 'bottom'):
                for host_logo in ((True, False) if (venue == 'crest' and mode == 'top') else (True,)):
                    q = '&hostedby=' + urllib.parse.quote(NAME) + ('&hostlogo=/x-fixture/host-logo.svg' if host_logo else '') + ('&hostedat=bottom' if mode == 'bottom' else '')
                    m = NL.load(B, base, '/app/trivia/screen.html?demo=1&sting=0' + vq + q, w, h, False, st, WALL)
                    for name, _ in st:
                        t = '%s trivia %dx%d %s venue logo, %s, %s' % ('A' if mode == 'top' else 'B', w, h, venue, 'host logo' if host_logo else 'name only', name)
                        wall_checks(t, m.get(name) or {}, basem.get(name) or {}, host_logo, venue, mode)
                    if SHOTS:
                        snap(B, base, '/app/trivia/screen.html?demo=1&sting=0' + vq + q, w, h, st,
                             'tv-%s-trivia-%dx%d-%s-%s' % ('A' if mode == 'top' else 'B', w, h, venue, 'hostlogo' if host_logo else 'nameonly'))
        basem = NL.load(B, base, '/app/musical/screen.html?demo=1&sting=0', w, h, False, musical, WALL)
        for mode in ('top', 'bottom'):
            q = '&hostedby=' + urllib.parse.quote(NAME) + '&hostlogo=/x-fixture/host-logo.svg' + ('&hostedat=bottom' if mode == 'bottom' else '')
            m = NL.load(B, base, '/app/musical/screen.html?demo=1&sting=0' + q, w, h, False, musical, WALL)
            for name, _ in musical:
                wall_checks('%s musical bingo %dx%d crest, host logo, %s' % ('A' if mode == 'top' else 'B', w, h, name), m.get(name) or {}, basem.get(name) or {}, True, 'crest', mode)
            if SHOTS:
                snap(B, base, '/app/musical/screen.html?demo=1&sting=0' + q, w, h, musical, 'tv-%s-musical-%dx%d-crest-hostlogo' % ('A' if mode == 'top' else 'B', w, h))
        # A LONG NAME (design review 2): wraps to two lines at most and stops short of the game's name, on the
        # short TRIVIA and the long MUSICAL BINGO.
        q = '&hostedby=' + urllib.parse.quote(LONG) + '&hostlogo=/x-fixture/host-logo.svg'
        for page, st, base_m, stem in (('trivia', trivia, NL.load(B, base, '/app/trivia/screen.html?demo=1&sting=0', w, h, False, trivia, WALL), 'trivia'),
                                       ('musical', musical, basem, 'musical')):
            m = NL.load(B, base, '/app/%s/screen.html?demo=1&sting=0' % page + q, w, h, False, st, WALL)
            for name, _ in st:
                t = 'A %s %dx%d crest, a long name, %s' % ('musical bingo' if page == 'musical' else 'trivia', w, h, name)
                names[t] = LONG
                x = m.get(name) or {}
                wall_checks(t, x, base_m.get(name) or {}, True, 'crest', 'top')
                nr, fs, ti, hb = x.get('nameR'), x.get('nameFs', 0), x.get('title'), x.get('hb')
                ok('%s: the name wraps to two lines at most' % t, bool(nr) and (nr[3] - nr[1]) <= 2 * 1.15 * fs + 2 and (nr[3] - nr[1]) > 1.5 * fs, [nr, fs])
                ok('%s: and stops at least %dpx short of the game\'s name' % (t, max(16, round(0.016 * w))), bool(hb and ti) and hb[2] <= ti[0] - max(16, round(0.016 * w)) + 1, [hb, ti])
            if SHOTS:
                snap(B, base, '/app/%s/screen.html?demo=1&sting=0' % page + q, w, h, st, 'tv-A-%s-%dx%d-crest-longname' % (stem, w, h))


def snap(B, base, path, w, h, states, stem):
    """The same states again, saved as pictures (PNG, the size of the TV)."""
    tid = B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    try:
        B.call('Page.enable', {}, session=sid)
        B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, session=sid)
        B.call('Page.addScriptToEvaluateOnNewDocument', {'source': NL.HOOK}, session=sid)
        B.call('Emulation.setVirtualTimePolicy', {'policy': 'pause', 'initialVirtualTime': NL.T0 / 1000.0}, session=sid)
        B.call('Page.navigate', {'url': base + path}, session=sid)
        at = 0
        for name, ms in states:
            B.call('Emulation.setVirtualTimePolicy', {'policy': 'pauseIfNetworkFetchesPending', 'budget': ms - at}, session=sid)
            end = time.time() + 120
            while time.time() < end:
                r = B.evaluate(sid, 'Date.now()', 10)
                v = r and r.get('result', {}).get('value')
                if v and v >= NL.T0 + ms - 5: break
                time.sleep(0.2)
            at = ms
            B.evaluate(sid, NL.FREEZE, 20); B.evaluate(sid, 'try{ if(window.VPTvGame) VPTvGame.alignTitles(); }catch(e){} true', 10); time.sleep(0.5)
            png = base64.b64decode(B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)['data'])
            open(shot_path('%s-%s.png' % (stem, name)), 'wb').write(png)
    finally:
        B.close_tab(tid)


# ------------------------------------------------------------------------------------------------ 3. people
PEOPLE = r'''(function(){
  function seen(e){ if(!e||!e.offsetParent) return false; var r=e.getBoundingClientRect(); return r.width>0&&r.height>0; }
  var de=document.documentElement, row=[].filter.call(document.querySelectorAll("#hosts .hostrow"),function(r){ return /Sam/.test(r.textContent); })[0];
  var p=row && row.querySelector(".hbpanel");
  var ctl=p ? [].filter.call(p.querySelectorAll("button, .hb-pick, .hostchk, input[type=text]"),seen).map(function(e){ var r=e.getBoundingClientRect(); return {t:(e.textContent||e.placeholder||"").trim().slice(0,30), h:Math.round(r.height), l:Math.floor(r.left), r:Math.ceil(r.right)}; }) : [];
  var rr=row ? row.getBoundingClientRect() : null, inp=p && p.querySelector(".hb-name");
  var tiny=p ? [].filter.call(p.querySelectorAll("*"),function(e){ return seen(e) && e.children.length===0 && (e.textContent||"").trim() && parseFloat(getComputedStyle(e).fontSize)<12.5; }).map(function(e){ return e.textContent.trim().slice(0,30)+" "+getComputedStyle(e).fontSize; }) : [];
  return JSON.stringify({ vw:innerWidth, dsw:de.scrollWidth, dcw:de.clientWidth, row: !!row, open: seen(p), btn: !!(row && row.querySelector(".hbb")),
    rowL: rr ? Math.floor(rr.left) : 0, rowR: rr ? Math.ceil(rr.right) : 0, ctl: ctl, inpFs: inp ? parseFloat(getComputedStyle(inp).fontSize) : 0,
    small: row ? (row.querySelector(".hn small")||{}).textContent : "", btnText: row && row.querySelector(".hbb") ? row.querySelector(".hbb").textContent.trim() : "", where: p && p.querySelector(".hb-where") ? Math.round(p.querySelector(".hb-where").getBoundingClientRect().top - p.getBoundingClientRect().top) : null, tiny: tiny, errs: (window.__errs||[]).length });
})()'''


TAPS = r'''(function(){ var p=document.querySelector(".hbpanel"), bad=[];
  [".hb-cancel",".hb-rmlogo",".hb-save",".hb-pick"].forEach(function(sel){ var e=p.querySelector(sel); if(!e) { bad.push(sel+" missing"); return; }
    var was=e.style.visibility; e.style.visibility="visible"; e.scrollIntoView({block:"center"}); var r=e.getBoundingClientRect(), x=r.left+r.width/2;
    [r.top+3, r.top+r.height/2, r.bottom-3].forEach(function(y){ var hit=document.elementFromPoint(x,y); if(!(hit===e||e.contains(hit))) bad.push(sel+" at "+Math.round(y)+" hits "+(hit?hit.className:"nothing")); });
    if(r.height<44) bad.push(sel+" "+Math.round(r.height)+"px tall"); e.style.visibility=was; });
  return bad.length ? bad.join("; ") : "ok"; })()'''


def people():
    print('\n3. THE SETTING: Account > People > Hosted by, phone, iPad and laptop')
    import admin_site
    S = admin_site.Site(fonts=bool(SHOTS))
    sam = '55555555-5555-4555-8555-555555555555'
    tmp = tempfile.mkdtemp(prefix='hostedby-')
    logo_file = os.path.join(tmp, 'quizco.svg')
    io.open(logo_file, 'w', encoding='utf-8').write(HOST_LOGO)
    try:
        info = S.W.info
        staff = S.W.table('vp_venue_staff')
        staff = [s for s in staff if s.get('auth_user_id') != sam] + [
            {'id': 's-sam1', 'auth_user_id': sam, 'venue_id': info['venue'], 'role': 'host', 'permissions': None, 'display_name': 'Sam Quizmaster'},
            {'id': 's-sam2', 'auth_user_id': sam, 'venue_id': info['venue2'], 'role': 'host', 'permissions': None, 'display_name': 'Sam Quizmaster'}]
        S.W.seed('vp_venue_staff', staff)
        S.W.seed('vp_host_brands', [])
        first = True
        for w, h, phone, label in [(375, 812, True, 'phone 375'), (390, 844, True, 'phone 390'), (768, 1024, True, 'iPad 768'), (1280, 900, False, 'laptop 1280')]:
            tid, sid = S.open('/app/billing.html#people', w, h, phone)
            S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector("#hosts .hostrow")', 30)
            time.sleep(1)
            S.js(sid, '(function(){ var b=document.querySelector(\'.tabs button[data-tab="people"]\'); if(b) b.click(); return true; })()'); time.sleep(0.5)
            m = json.loads(S.js(sid, PEOPLE))
            ok('%s: Sam\'s row has a Show on TV button' % label, m.get('row') is True and m.get('btn') is True and m.get('btnText') == 'Show on TV', m)
            S.js(sid, '(function(){ var row=[].filter.call(document.querySelectorAll("#hosts .hostrow"),function(r){ return /Sam/.test(r.textContent); })[0]; row.querySelector(".hbb").click(); row.scrollIntoView({block:"start"}); return true; })()')
            time.sleep(0.6)
            if first:
                if SHOTS: S.shot(sid, shot_path('people-%d-empty.png' % w), False)
                S.js(sid, '(function(){ var row=[].filter.call(document.querySelectorAll("#hosts .hostrow"),function(r){ return /Sam/.test(r.textContent); })[0]; row.querySelector(".hbb").setAttribute("data-t","1"); row.querySelector(".hb-pick input").id="hbFileT"; return true; })()')
                before = json.loads(S.js(sid, PEOPLE)).get('where')
                S.set_file(sid, '#hbFileT', logo_file)
                ok('%s: a chosen logo shows in the dark chip before Save' % label,
                   S.until(sid, '/^url\\("data:image/.test(document.querySelector(".hbpanel .hb-thumb").style.backgroundImage)', 15) is True,
                   S.js(sid, 'document.querySelector(".hbpanel .hb-thumb").style.backgroundImage.slice(0,40)'))
                time.sleep(0.3)   # measured once the picked logo is painted, not before it has loaded
                after = json.loads(S.js(sid, PEOPLE)).get('where')
                ok('%s: nothing jumps when a logo is picked (the next heading stays at %spx)' % (label, before), before is not None and before == after, (before, after))
                S.js(sid, '(function(){ var p=document.querySelector(".hbpanel"); var i=p.querySelector(".hb-name"); i.value=%s; i.dispatchEvent(new Event("input")); var t=p.querySelector(\'.hb-g[value="trivia"]\'); t.click(); return true; })()' % json.dumps(NAME))
                time.sleep(0.3)
                if SHOTS: S.shot(sid, shot_path('people-%d-filled.png' % w), False)
                S.js(sid, 'document.querySelector(".hbpanel .hb-save").click(); true')
                saved = S.until(sid, '(function(){ var e=document.querySelector("#hosts .hbsaved"); return !!e && /^Saved\\. It shows on the TV from their next game/.test(e.textContent); })()', 20)
                ok('%s: Save says, on Sam\'s row, that it shows from their next game' % label, saved is True, S.js(sid, '(document.querySelector("#hosts .hbsaved")||{}).textContent'))
                ok('%s: and only there: no second Saved message at the foot of the page' % label, not S.js(sid, '/Saved/.test(document.getElementById("msg").textContent)'), S.js(sid, 'document.getElementById("msg").textContent'))
                br = S.W.table('vp_host_brands')
                rows = [s for s in S.W.table('vp_venue_staff') if s.get('auth_user_id') == sam]
                ok('the Worker stored ONE card for Sam\'s login, with a logo in venue-logos/hosts/<login>/', len(br) == 1 and br[0].get('name') == NAME and '/venue-logos/hosts/%s/' % sam in (br[0].get('logo_url') or ''), br)
                here = [s for s in rows if s.get('venue_id') == info['venue']]
                ok('and trivia switched on at the venue shown, nothing at the other', here and here[0].get('hosted_by') == {'trivia': True, 'musical': False}
                   and all(s.get('hosted_by') in (None,) for s in rows if s.get('venue_id') != info['venue']), rows)
                S.until(sid, '/Shows on the TV for trivia/.test(document.querySelector("#hosts").textContent)', 15)
                ok('%s: the row says Saved, under Sam\'s name' % label, S.until(sid, '(function(){ var e=document.querySelector("#hosts .hbsaved"); return !!e && /^Saved\\. It shows on the TV/.test(e.textContent) && e.getBoundingClientRect().height>0; })()', 10) is True,
                   S.js(sid, '(document.querySelector("#hosts .hbsaved")||{}).textContent'))
                if SHOTS: S.shot(sid, shot_path('people-%d-saved-line.png' % w), False)
                first = False
                S.close_tab(tid)
                tid, sid = S.open('/app/billing.html#people', w, h, phone)
                S.until(sid, 'document.getElementById("content").style.display!=="none" && !!document.querySelector("#hosts .hostrow")', 30); time.sleep(1)
                S.js(sid, '(function(){ var b=document.querySelector(\'.tabs button[data-tab="people"]\'); if(b) b.click(); return true; })()'); time.sleep(0.5)
                S.js(sid, '(function(){ var row=[].filter.call(document.querySelectorAll("#hosts .hostrow"),function(r){ return /Sam/.test(r.textContent); })[0]; row.querySelector(".hbb").click(); row.scrollIntoView({block:"start"}); return true; })()')
                time.sleep(0.6)
            m = json.loads(S.js(sid, PEOPLE))
            ok('%s: the row says it shows on the TV for trivia' % label, 'Shows on the TV for trivia' in (m.get('small') or ''), m.get('small'))
            ok('%s: the panel is open, the saved name in the box' % label, m.get('open') is True and S.js(sid, 'document.querySelector(".hbpanel .hb-name").value') == NAME, m)
            ok('%s: nothing on the page scrolls sideways (%s <= %s)' % (label, m.get('dsw'), m.get('dcw')), m.get('dsw', 1) <= m.get('dcw', 0), m)
            short = [c for c in m.get('ctl') or [] if c['h'] < 44]
            ok('%s: every button, tick box and the name box is at least 44px tall' % label, not short, short)
            outside = [c for c in m.get('ctl') or [] if c['l'] < m.get('rowL', 0) or c['r'] > m.get('rowR', 0)]
            ok('%s: everything in the panel sits inside the row' % label, not outside, outside)
            hits = S.js(sid, TAPS)
            ok('%s: Cancel and Remove logo take a tap anywhere in a 44px band, not only on their words' % label, hits == 'ok', hits)
            ok('%s: the name box is 16px text (an iPhone does not zoom)' % label, m.get('inpFs', 0) >= 16, m.get('inpFs'))
            ok('%s: no text in the panel under 12.5px' % label, not m.get('tiny'), m.get('tiny'))
            ok('%s: no script error' % label, m.get('errs') == 0, S.js(sid, 'JSON.stringify(window.__errs)'))
            if SHOTS: S.shot(sid, shot_path('people-%d-saved.png' % w), False)
            S.close_tab(tid)
    finally:
        S.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('hosted-by-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    if ONLY in ('', 'rooms'):
        rooms()
    if ONLY in ('', 'wall'):
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Site)
        srv.socket.listen(128)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:%d' % srv.server_address[1]
        B = NL.VL.Browser()
        try:
            wall(B, base)
        finally:
            B.close(); srv.shutdown()
    if ONLY in ('', 'people'):
        people()
    print('')
    print(('%d FAILED, %d run' % (bad, ran)) if bad else ('ALL %d CHECKS PASSED' % ran))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
