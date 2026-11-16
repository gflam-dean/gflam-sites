#!/usr/bin/env python3
"""PLAY A REAL NIGHT ON STAGING, AT A VENUE THAT LOOKS LIKE A REAL PUB (Dean, 15 and 16 Nov 2026).

On 15 Nov Dean found, on live at The Mini Bar, faults our plays had missed: "Thanks for playing" after every question
with no phone joined, the venue's name twice top left, the time's-up buzzer out of step, a host console you had to
scroll. They were missed because our plays always had phones joined, checked words instead of what a person sees, and
the one staging venue had no logo, no slides and no sounds. This plays all five games, in the order a venue does
(trivia, musical bingo, bingo, raffle, members draw), at ONE staging venue, TWICE each:

    nophone   the host alone with 0 phones joined (the first thing every new venue does)
    phones    with 2 phones joined (Ann and Ben, fiction mobiles 0491 570 111 / 112: the outbox guard sends nothing)

and saves what a person would see, for a person to LOOK at:
    TV        every frame at 1920x1080 AND 1280x720 (two TVs on the venue, as in a real pub)
    console   the host console at 390x844 AND 375x667 at every step, plus "is the main button on screen without a scroll"
    phones    each phone at 390x844
    branding  on every TV frame: how many times the venue shows (its logo, its name in words) and whether a "Hosted by"
              card is there too. More than one = FLAG for a person to look (the doubled logo / doubled name of 15 Nov)
Then writes index.html, the contact sheet, in the out folder (tools/staging/real-venues-sheet.py does the page).

Runs anywhere Chrome runs (the test server vp-tests-1 is the place: never Dean's Mac while a release gate runs). It
reads NO key: the plan file (made on the Mac by real-venues-run.sh from the TEST project only) holds the venue and the
TEST sign-in sessions. It opens only https://staging.venueplay.com.au and refuses anything else.

    python3 tools/staging/real-venues-play.py <plan.json> <out dir> [game ...]
    VP_VL_CHROME=/usr/bin/google-chrome   the Chrome to use (Linux)
"""
import base64, json, os, re, sys, time, traceback
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS); sys.path.insert(0, os.path.join(TOOLS, 'browser-rig'))
import importlib.util
_spec = importlib.util.spec_from_file_location('VL', os.path.join(TOOLS, 'verify-live.py'))
VL = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(VL)
if os.environ.get('VP_VL_CHROME'):
    VL.CHROME = os.environ['VP_VL_CHROME']
import waits

BASE = 'https://staging.venueplay.com.au'
TEST_REF = 'rkfaftxgzpsmmrzudlqy'
SKEY = 'sb-%s-auth-token' % TEST_REF
PLAN = json.load(open(sys.argv[1]))
OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
ONLY = sys.argv[3:]
if PLAN.get('base', BASE) != BASE:
    sys.exit('refusing: the plan names %r, not the staging site' % PLAN.get('base'))
V = PLAN['venue']
VENUE, SLUG, CODE, VNAME = V['id'], V['slug'], V['code'], V['name']
SESS = PLAN['sessions']            # {'owner': {...}, 'host2': {...}}
HOST_FOR = PLAN.get('host_for', {})   # game -> which session runs its console (default owner)
MODES = PLAN.get('modes', ['nophone', 'phones'])
PHONES = [('A', 'Ann', '0491570111'), ('B', 'Ben', '0491570112')]
LOG = open(os.path.join(OUT, 'log.txt'), 'a')
RES = []
FRAMES = []   # {game, mode, step, kind: tv|console|phone, size, png, brand}


def log(*a):
    s = ' '.join(str(x) for x in a); print(s); LOG.write(s + '\n'); LOG.flush(); sys.stdout.flush()


B = VL.Browser()


def save():
    json.dump({'venue': V, 'results': RES, 'frames': FRAMES, 'started': STARTED, 'plan_label': PLAN.get('label', ''),
               'build': PLAN.get('build', '')}, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)


def rec(game, mode, step, ok, note='', png=''):
    RES.append({'game': game, 'mode': mode, 'step': step, 'ok': bool(ok), 'note': str(note)[:700], 'png': png})
    log(('  ok   ' if ok else '  FAIL ') + '%s/%s: %s  %s' % (game, mode, step, '' if ok else str(note)[:300]))
    save()


def guard_url(path):
    u = BASE + path
    if not u.startswith(BASE + '/'):
        sys.exit('refusing ' + u)
    return u


def STORE(tag):
    return r'''(function(){ var P=%s, S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem;
  function mine(st){ try{ return st===window.localStorage; }catch(e){ return false; } }
  S.getItem=function(x){ return mine(this) ? g.call(this, P+x) : g.call(this, x); };
  S.setItem=function(x,v){ return mine(this) ? s.call(this, P+x, v) : s.call(this, x, v); };
  S.removeItem=function(x){ return mine(this) ? r.call(this, P+x) : r.call(this, x); };
  window.__errs=[]; window.addEventListener("error",function(e){window.__errs.push(String(e.message)+" @ "+(e.filename||"")+":"+(e.lineno||""));});
})();''' % json.dumps('ph' + tag + ':')


def HOST_BEFORE(sess):
    return ('(function(){try{var k=%s; if(!localStorage.getItem(k)) localStorage.setItem(k,%s);'
            'localStorage.setItem("vpCurrentVenue",%s); localStorage.setItem("vpVenuePick",JSON.stringify({id:%s,at:Date.now()}));'
            'localStorage.setItem("vpUpdatesAsked","1");}catch(e){}'
            'window.__vpRigNoReview=true; window.__errs=[]; window.addEventListener("error",function(e){window.__errs.push(String(e.message)+" @ "+(e.filename||"")+":"+(e.lineno||""));});'
            'window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+String(e.reason&&e.reason.message||e.reason));});})();'
            % (json.dumps(SKEY), json.dumps(json.dumps(sess)), json.dumps(VENUE), json.dumps(VENUE)))


SIZES = {}   # sid -> (w, h)


def open_(path, before, w, h, own_context=False):
    params = {'url': 'about:blank', 'newWindow': True}
    if own_context:   # its own cookies and storage: a host login never leaks into the TV or a phone
        params['browserContextId'] = B.call('Target.createBrowserContext', {})['browserContextId']
    tid = B.call('Target.createTarget', params)['targetId']
    sid = B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
    B.call('Page.enable', {}, session=sid)
    B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': w < 600}, session=sid)
    B.call('Page.addScriptToEvaluateOnNewDocument', {'source': before}, session=sid)
    B.call('Page.navigate', {'url': guard_url(path)}, session=sid)
    SIZES[sid] = (w, h)
    return tid, sid


def js(sid, expr, wait=8):
    r = B.evaluate(sid, expr, wait)
    return 'HUNG' if r is None else r.get('result', {}).get('value')


def until(sid, expr, secs=15):
    return waits.until(lambda e: js(sid, e), expr, secs, every=0.4)


def text(sid, n=400):
    return js(sid, 'document.body ? document.body.innerText.replace(/\\s+/g," ").slice(0,%d) : ""' % n) or ''


def _png(sid, name):
    try:
        r = B.call('Page.captureScreenshot', {'format': 'png'}, session=sid)
        p = os.path.join(OUT, name + '.png')
        open(p, 'wb').write(base64.b64decode(r['data']))
        return name + '.png'
    except Exception as e:
        log('  shot failed', name, e); return ''


# ---------------------------------------------------------------- what a person sees: branding on a TV frame
BRAND = r'''(function(NAME){
  function vis(el, win){ if(!el) return false; var r=el.getBoundingClientRect(); if(r.width<4||r.height<4) return false;
    if(r.bottom<0||r.right<0||r.top>win.innerHeight||r.left>win.innerWidth) return false;
    for(var e=el; e && e.nodeType===1; e=e.parentElement){ var cs=win.getComputedStyle(e); if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity)<0.05) return false; }
    /* on top, not under the game frame: the middle (or a corner) of it must be this element when asked what is there */
    var pts=[[r.left+r.width/2,r.top+r.height/2],[r.left+3,r.top+3],[r.right-3,r.bottom-3]], d=el.ownerDocument;
    for(var k=0;k<pts.length;k++){ var x=Math.max(0,Math.min(win.innerWidth-1,pts[k][0])), y=Math.max(0,Math.min(win.innerHeight-1,pts[k][1]));
      var top=d.elementFromPoint(x,y); if(top && (top===el || el.contains(top) || top.contains(el))) return true; }
    return false; }
  var out={logos:[], names:[], hosted:[], vp:0};
  var key=NAME.toLowerCase().replace(/^the\s+/,"").replace(/[^a-z0-9 ]/g,"").trim();
  function scan(doc, win, where){
    [].forEach.call(doc.querySelectorAll("img"), function(i){ if(!vis(i,win)) return; var s=(i.currentSrc||i.src||"");
      if(/venue-logos\/hosts\//.test(s)) out.hosted.push(where+"img"); else if(/venue-logos\//.test(s)) out.logos.push(where+(i.id||i.className||"img"));
      else if(/\/logos?\/|venueplay/i.test(s)) out.vp++; });
    [].forEach.call(doc.querySelectorAll("*"), function(e){ var b=win.getComputedStyle(e).backgroundImage||""; if(/venue-logos\//.test(b) && !/hosts\//.test(b) && vis(e,win)) out.logos.push(where+"bg:"+(e.id||e.className||e.tagName)); });
    var w=doc.createTreeWalker(doc.body||doc, NodeFilter.SHOW_TEXT, null), n;
    while((n=w.nextNode())){ var t=(n.nodeValue||"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim(); if(!t) continue;
      var p=n.parentElement; if(!p||!vis(p,win)) continue;
      if(key && t.indexOf(key)>=0) out.names.push(where+(p.id||p.className||p.tagName)+": "+n.nodeValue.trim().slice(0,50));
      if(/hosted by/.test(t)) out.hosted.push(where+"text: "+n.nodeValue.trim().slice(0,50)); }
  }
  scan(document, window, "");
  var f=document.getElementById("gameFrame"); try{ if(f&&f.style.display!=="none"&&f.contentDocument&&f.contentDocument.body) scan(f.contentDocument, f.contentWindow, "frame:"); }catch(e){}
  out.count=out.logos.length+out.names.length; out.flag = out.count>1 || (out.count>=1 && out.hosted.length>0 && out.count>1);
  return JSON.stringify(out); })(%s)'''


def brand(sid):
    try:
        return json.loads(js(sid, BRAND % json.dumps(VNAME)) or '{}')
    except Exception:
        return {}


TVS = []   # [(sid, label)]


def tvshot(game, mode, step):
    """Both TVs, full frame, plus the branding count on the big one."""
    time.sleep(0.6)
    bd = None
    for sid, lab in TVS:
        p = _png(sid, '%s-%s-tv%s-%s' % (game, mode, lab, step))
        b = brand(sid) if lab == '1080' else None
        if b is not None:
            bd = b
        FRAMES.append({'game': game, 'mode': mode, 'step': step, 'kind': 'tv', 'size': lab, 'png': p, 'brand': b, 'text': tvtext(sid)[:300]})
    if bd and bd.get('count', 0) > 1:
        rec(game, mode, 'TV %s: venue shown once (logo/name)' % step, False,
            'FLAG duplicated branding: logos %s, name in words %s, hosted by %s' % (bd.get('logos'), bd.get('names'), bd.get('hosted')))
    save()
    return bd


# THE MAIN BUTTON at each moment, in order of what a host presses next; End game / Back to ads only when nothing else is there
PRIMARY = ['First question', 'Next question', 'Reveal answer', 'Reveal leaderboard', 'Announce', 'Start calling numbers',
           'Next number', 'Call next', 'Call', 'Play song', 'Play next song', 'Next song', 'Draw', 'Start game', 'Start the quiz',
           'Open the lobby', 'Open lobby', 'Start', 'Claim', 'Paid', 'End game', 'Back to ads']
ABOVE = ('''(function(P){var vis=[].filter.call(document.querySelectorAll("button"),function(x){var r=x.getBoundingClientRect();
  var cs=getComputedStyle(x); return r.height>0 && !x.disabled && cs.visibility!=="hidden" && cs.display!=="none";});
  for(var i=0;i<P.length;i++){ var low=P[i].toLowerCase(); for(var j=0;j<vis.length;j++){ var t=vis[j].textContent.replace(/\\s+/g," ").trim();
    if(t.toLowerCase().indexOf(low)===0){ var r=vis[j].getBoundingClientRect();
      return JSON.stringify({main:t.slice(0,40), bottom:Math.round(r.bottom), vh:innerHeight, onscreen:r.top>=0 && r.bottom<=innerHeight}); } } }
  return JSON.stringify({main:null});})(%s)''' % json.dumps(PRIMARY))


def console(game, mode, host, step):
    """The console at 390x844 and 375x667: picture, does it fit, is the main button on screen."""
    out = {}
    for (w, h) in ((390, 844), (375, 667)):
        if (w, h) != SIZES.get(host):
            B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': True}, session=host)
            SIZES[host] = (w, h); time.sleep(0.9)
        else:
            time.sleep(0.5)
        try: a = json.loads(js(host, ABOVE) or '{}')
        except Exception: a = {}
        p = _png(host, '%s-%s-console%d-%s' % (game, mode, w, step))
        FRAMES.append({'game': game, 'mode': mode, 'step': step, 'kind': 'console', 'size': '%dx%d' % (w, h), 'png': p, 'main': a})
        out[w] = a
        if a.get('main') and not a.get('onscreen'):
            rec(game, mode, 'console %dx%d %s: main button "%s" on screen without a scroll' % (w, h, step, a.get('main')), False,
                'its bottom is at %s px, the screen is %s px' % (a.get('bottom'), a.get('vh')), p)
    B.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True}, session=host)
    SIZES[host] = (390, 844)
    save()
    return out


def phoneshot(game, mode, ph, tag, step):
    p = _png(ph, '%s-%s-phone%s-%s' % (game, mode, tag, step))
    FRAMES.append({'game': game, 'mode': mode, 'step': step, 'kind': 'phone', 'size': tag, 'png': p, 'text': text(ph, 200)})
    save(); return p


def click_text(sid, t):
    return js(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button,a"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]; if(!b) return false; b.click(); return true; })()' % json.dumps(t))


def click_rx(sid, rx):
    return js(sid, '(function(){ var b=[].filter.call(document.querySelectorAll("button,a"),function(x){ return %s.test(x.textContent.trim()) && x.getBoundingClientRect().height>0 && !x.disabled; })[0]; if(!b) return ""; b.click(); return b.textContent.trim().slice(0,60); })()' % rx)


def has_btn(t):
    return '!![].filter.call(document.querySelectorAll("button"),function(x){ return x.textContent.trim()===%s && x.getBoundingClientRect().height>0; })[0]' % json.dumps(t)


def tap(sid, i): js(sid, 'setTimeout(function(){ var e=document.getElementById(%s); if(e) e.click(); }, 0); true' % json.dumps(i))


def buttons(sid):
    return js(sid, 'JSON.stringify([].filter.call(document.querySelectorAll("button"),function(x){return x.getBoundingClientRect().height>0;}).map(function(x){return x.textContent.trim().slice(0,30);}).slice(0,40))')


ERRT = '((document.getElementById("hostErrText")||{}).textContent||"")'
TAKEOVER = '(function(){var b=document.getElementById("vpTakeoverGo"); if(b && b.offsetParent!==null){ b.click(); return true; } return false;})()'
ASKGO = '(function(){var b=document.getElementById("vpAskGo")||document.querySelector(".vp-ask button"); if(b && b.offsetParent!==null){ b.click(); return true; } return false;})()'
ACCEPT = ('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){ return x.offsetParent!==null && '
          '/I understand|Accept|Start as a free|Start anyway|Yes, start|Continue|Got it|Open the lobby here|Not now/i.test(x.textContent); })[0]; if(b) b.click(); return !!b;})()')
TERMS = ('(function(){var b=document.getElementById("vpTermsGo"); if(!b||b.offsetParent===null) return false; '
         'var box=b.parentElement&&b.parentElement.parentElement; if(box) [].forEach.call(box.querySelectorAll("input[type=checkbox]"),function(x){ if(x.offsetParent!==null && !x.checked) x.click(); }); b.click(); return true;})()')


CONFIRM = ('(function(){var n=0; [].forEach.call(document.querySelectorAll("input[type=checkbox]"),function(c){var l=c.closest("label")||c.parentElement;'
           ' if(c.offsetParent!==null && !c.checked && l && /I confirm|I understand|conductor|I accept/i.test(l.textContent)){ c.click(); n++; }}); return n;})()')


def dialogs(sid, rounds=3):
    for _ in range(rounds):
        time.sleep(0.8)
        js(sid, CONFIRM)
        # the state rules popup (vp-gaming.js) is position:fixed, so offsetParent is null: press its own button
        if js(sid, '(function(){var b=document.querySelector(".vpg-go"); if(!b) return false; b.click(); return true;})()') is True:
            continue
        if not (js(sid, TERMS) or js(sid, TAKEOVER) or js(sid, ASKGO) or js(sid, ACCEPT)):
            break


OPEN_GAME = ('(function(){var t=document.body.innerText; var c=document.getElementById("cancelLobbyBtn"); var e=document.getElementById("endGameBtn");'
             'return (c&&c.offsetParent!==null&&c.style.display!=="none") || (e&&e.offsetParent!==null) || /Question \\d+ of|answered|Final scores|Now playing|Start calling numbers|Close lobby/i.test(t);})()')


def end_any(sid, label=''):
    for i in range(5):
        dialogs(sid, 2)
        if js(sid, OPEN_GAME) is not True:
            return True
        c = click_rx(sid, '/^(End game|End round|Close lobby|End the game)$/i'); time.sleep(1.5)
        k = click_rx(sid, '/^(End game|End it|Yes, end( it)?|End now|End the game|Close lobby|Close it|Yes)$/i'); time.sleep(1)
        tap(sid, 'endGameBtn'); time.sleep(1.2); tap(sid, 'endGameBtn'); dialogs(sid, 2)
        log('  end_any', label, i, c, k); time.sleep(3)
    return js(sid, OPEN_GAME) is not True


TVFRAME = '(function(){var f=document.getElementById("gameFrame"); return (f && f.style.display!=="none") ? (f.getAttribute("src")||"") : "";})()'
TVTEXT = ('(function(){var t=document.body.innerText; var f=document.getElementById("gameFrame"); try{ if(f&&f.style.display!=="none"&&f.contentDocument) t+=" || FRAME: "+f.contentDocument.body.innerText; }catch(e){} return t.replace(/\\s+/g," ").slice(0,700);})()')


def tvtext(tv): return js(tv, TVTEXT) or ''


def tv_ads(tv, secs=40):
    return until(tv, '(function(){var f=document.getElementById("gameFrame"); return !f || f.style.display==="none" || !f.getAttribute("src");})()', secs) is True


def errs(sid): return js(sid, 'JSON.stringify(window.__errs||[])') or '[]'


def no_throw(G, mode, sids):
    e = [errs(s) for s in sids]
    rec(G, mode, 'no page threw', all(x in ('[]', None) for x in e), e)


def host_tab(game, path):
    who = HOST_FOR.get(game, 'owner')
    return open_(path, HOST_BEFORE(SESS[who]), 390, 844, own_context=True) + (who,)


def phone_join(tag, name, mobile):
    tid, ph = open_('/play?room=' + CODE, STORE(tag), 390, 844)
    got = until(ph, '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!n && !!b && n.offsetParent!==null && !b.disabled;})()', 60)
    p = _png(ph, 'phone%s-join-form-%d' % (tag, int(time.time())))
    if got is not True and re.search(r"YOU.RE IN", text(ph), re.I):
        return tid, ph, True, ['already in (remembered phone)', js(ph, 'location.pathname'), text(ph)], p
    if got is not True:
        return tid, ph, False, ['join form never ready', js(ph, 'location.href'), text(ph)], p
    js(ph, '(function(){var n=document.getElementById("nameIn"); n.value=%s; n.dispatchEvent(new Event("input",{bubbles:true}));'
           '[].forEach.call(document.querySelectorAll("input[type=tel]"),function(t){ if(t.offsetParent!==null){ t.value=%s; t.dispatchEvent(new Event("input",{bubbles:true})); } });'
           'document.getElementById("joinBtn").click(); return true;})()' % (json.dumps(name), json.dumps(mobile)))
    gone = until(ph, '!(function(){var n=document.getElementById("nameIn"); return !!n && n.offsetParent!==null;})()', 25)
    if gone is not True:
        js(ph, '(function(){[].forEach.call(document.querySelectorAll("input[type=tel]"),function(t){ if(t.offsetParent!==null){ t.value=%s; t.dispatchEvent(new Event("input",{bubbles:true})); } }); var b=document.getElementById("joinBtn"); if(b) b.click(); return 1;})()' % json.dumps(mobile))
        gone = until(ph, '!(function(){var n=document.getElementById("nameIn"); return !!n && n.offsetParent!==null;})()', 20)
    note = [js(ph, 'location.pathname'), text(ph)]
    time.sleep(6)
    again = js(ph, '(function(){var n=document.getElementById("nameIn"), b=document.getElementById("joinBtn"); return !!b && b.offsetParent!==null;})()')
    if again:
        note.append('ASKED TO JOIN AGAIN on ' + str(js(ph, 'location.pathname')) + ': ' + text(ph, 200))
        js(ph, '(function(){var n=document.getElementById("nameIn"); if(n && n.offsetParent!==null && !n.value){ n.value=%s; n.dispatchEvent(new Event("input",{bubbles:true})); } var b=document.getElementById("joinBtn"); if(b) b.click(); return 1;})()' % json.dumps(name))
        time.sleep(4)
    return tid, ph, gone is True, note, p


def join_phones(G, mode):
    out = []
    if mode != 'phones':
        return out
    for tag, name, mob in PHONES:
        t, ph, joined, note, p = phone_join(tag, name, mob)
        rec(G, mode, 'phone %s (%s) joins' % (tag, name), joined, note, p)
        phoneshot(G, mode, ph, tag, 'joined')
        out.append((t, ph, tag))
    return out


def close_all(*tids):
    for t in tids:
        if t:
            try: B.close_tab(t)
            except Exception: pass


# ============================================================== TRIVIA
def trivia(mode):
    G = 'trivia'
    t_h, host, who = host_tab(G, '/app/trivia/host.html?venue=' + VENUE)
    ok = until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !document.getElementById("startBtn").disabled', 60) is True
    time.sleep(3)
    rec(G, mode, 'console loads signed in (%s)' % who, ok, text(host))
    console(G, mode, host, '01-setup')
    if not ok:
        close_all(t_h); return
    rec(G, mode, 'leftover game cleared before start', end_any(host, 'pre'), text(host, 200))
    js(host, 'var c=document.getElementById("cfgCount"); if(c){ c.value="2"; c.dispatchEvent(new Event("input")); c.dispatchEvent(new Event("change")); } true')
    tap(host, 'startBtn'); dialogs(host)
    lob = until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 30) is True
    rec(G, mode, 'lobby opens', lob, [js(host, ERRT), text(host)])
    console(G, mode, host, '02-lobby')
    tvt = until(TVS[0][0], '/trivia/.test(%s)' % TVFRAME, 40) is True; time.sleep(3)
    rec(G, mode, 'TV takes the trivia lobby', tvt, [js(TVS[0][0], TVFRAME), tvtext(TVS[0][0])])
    tvshot(G, mode, '02-lobby')
    phones = join_phones(G, mode)
    if phones:
        time.sleep(2); console(G, mode, host, '03-lobby-with-phones'); tvshot(G, mode, '03-lobby-with-phones')
    tap(host, 'startBtn'); dialogs(host)
    st = until(host, has_btn('First question'), 30) is True
    rec(G, mode, 'quiz starts (First question button)', st, [js(host, ERRT), buttons(host), text(host)])
    console(G, mode, host, '04-started'); tvshot(G, mode, '04-started')
    click_text(host, 'First question')
    nq = 0
    for qn in (1, 2):
        if qn == 2 and not click_text(host, 'Next question'):
            break
        nq += 1
        time.sleep(4)
        tvshot(G, mode, '1%d-q%d' % (qn, qn)); t = tvtext(TVS[0][0])
        rec(G, mode, 'TV shows question %d' % qn, re.search(r'Question\s*%d|Q%d' % (qn, qn), t, re.I) is not None, t)
        rec(G, mode, 'TV question %d: no "Thanks for playing"' % qn, not re.search(r'thanks for playing', t, re.I), t)
        console(G, mode, host, '1%d-q%d' % (qn, qn))
        for i, (_, ph, tag) in enumerate(phones):
            a = until(ph, 'document.querySelectorAll("#pAnswers .pans").length>=2', 25) is True
            rec(G, mode, 'question %d reaches phone %s' % (qn, tag), a, text(ph))
            phoneshot(G, mode, ph, tag, '1%d-q%d' % (qn, qn))
            js(ph, '(function(){var b=document.querySelectorAll("#pAnswers .pans")[%d]; if(b) b.click(); return 1;})()' % i)
        t0 = time.time(); seen = None; mid = False
        while time.time() - t0 < 32:
            t = tvtext(TVS[0][0])
            if not mid and time.time() - t0 > 8:
                tvshot(G, mode, '1%d-q%d-clock' % (qn, qn)); mid = True
            if re.search(r"time'?s up|times up|answer is|correct answer", t, re.I):
                seen = round(time.time() - t0, 1); break
            time.sleep(0.5)
        tvshot(G, mode, '1%d-q%d-timeup' % (qn, qn))
        rec(G, mode, 'q%d time up on the TV (%s s after the 4 s mark)' % (qn, seen), seen is not None, tvtext(TVS[0][0]))
        rec(G, mode, 'TV q%d at time up: no "Thanks for playing"' % qn, not re.search(r'thanks for playing', tvtext(TVS[0][0]), re.I), tvtext(TVS[0][0]))
        click_text(host, 'Reveal answer'); time.sleep(4)
        t = tvtext(TVS[0][0]); tvshot(G, mode, '1%d-q%d-reveal' % (qn, qn))
        rec(G, mode, 'TV q%d reveal: no "Thanks for playing" between questions' % qn, not re.search(r'thanks for playing', t, re.I), t)
        rec(G, mode, 'TV q%d reveal: no empty LEADERBOARD' % qn, not (re.search(r'leaderboard', t, re.I) and not re.search(r'Ann|Ben|\d+\s*pts', t)), t)
        for _, ph, tag in phones:
            phoneshot(G, mode, ph, tag, '1%d-q%d-reveal' % (qn, qn))
        console(G, mode, host, '1%d-q%d-reveal' % (qn, qn))
        time.sleep(2)
    rec(G, mode, 'questions played', nq >= 1, nq)
    if click_text(host, 'Reveal leaderboard'):
        time.sleep(4); t = tvtext(TVS[0][0]); tvshot(G, mode, '30-leaderboard')
        if phones:
            rec(G, mode, 'TV leaderboard names a player', re.search(r'Ann|Ben', t) is not None, t)
        else:
            rec(G, mode, 'TV with no players: no empty LEADERBOARD painted', not re.search(r'leaderboard', t, re.I) or re.search(r'\d+\s*pts', t, re.I), t)
        console(G, mode, host, '30-leaderboard')
        for k in range(4):
            time.sleep(3)
            if not (click_text(host, 'Announce 3rd') or click_text(host, 'Announce 2nd') or click_text(host, 'Announce the winner') or click_text(host, 'Announce 1st')):
                break
            time.sleep(2); tvshot(G, mode, '3%d-podium' % (k + 1))
        time.sleep(3); tvshot(G, mode, '35-final')
        if phones:
            ft = tvtext(TVS[0][0])
            rec(G, mode, 'TV final scores name both players', 'Ann' in ft and 'Ben' in ft, ft)
        for _, ph, tag in phones:
            phoneshot(G, mode, ph, tag, '35-final')
    else:
        rec(G, mode, 'Reveal leaderboard button present', False, [buttons(host), text(host)])
    console(G, mode, host, '40-end')
    js(host, 'setTimeout(function(){ var b=document.getElementById("toAdsBtn"); if(b && b.offsetParent!==null) b.click(); }, 0); true'); dialogs(host)
    time.sleep(3)
    for _ in range(3):
        st = js(host, '(function(){return /Question|REVEAL|answered|Final scores|podium|Announce/i.test(document.body.innerText) ? "open" : "closed";})()')
        if st != 'open': break
        click_rx(host, '/^(End game|Back to ads|Close lobby)$/i'); time.sleep(1.5)
        click_rx(host, '/^(End game|End it|Yes, end|End now|End the game|Yes)$/i'); dialogs(host); time.sleep(3)
    end_any(host, 'end')
    ad = tv_ads(TVS[0][0], 40)
    rec(G, mode, 'game ends, TV back to ads', ad, [js(TVS[0][0], TVFRAME), buttons(host)])
    tvshot(G, mode, '45-after')
    no_throw(G, mode, [s for s, _ in TVS] + [host] + [p for _, p, _ in phones])
    close_all(t_h, *[t for t, _, _ in phones])


# ============================================================== MUSICAL BINGO
def musical(mode):
    G = 'musical'
    t_h, host, who = host_tab(G, '/app/musical/host.html?venue=' + VENUE)
    ok = until(host, 'document.readyState==="complete" && !!document.getElementById("startBtn") && !!document.querySelector("#plGrid .plcard")', 60) is True
    time.sleep(3)
    rec(G, mode, 'console loads (%s)' % who, ok, text(host)); console(G, mode, host, '01-setup')
    if not ok:
        close_all(t_h); return
    rec(G, mode, 'leftover game cleared before start', end_any(host, 'pre'), text(host, 200))
    js(host, 'if(!document.querySelector("#plGrid .plcard.on")){ var c=document.querySelector("#plGrid .plcard"); if(c) c.click(); } true')
    tap(host, 'startBtn'); dialogs(host)
    lob = until(host, '(function(){var e=document.getElementById("cancelLobbyBtn"); return !!e && e.style.display!=="none";})()', 30) is True
    rec(G, mode, 'lobby opens', lob, [js(host, ERRT), text(host)])
    console(G, mode, host, '02-lobby')
    tvt = until(TVS[0][0], '/musical/.test(%s)' % TVFRAME, 40) is True; time.sleep(4)
    rec(G, mode, 'TV takes musical bingo', tvt, [js(TVS[0][0], TVFRAME), tvtext(TVS[0][0])]); tvshot(G, mode, '02-lobby')
    phones = join_phones(G, mode)
    tap(host, 'startBtn'); dialogs(host)
    until(host, '!/Starting\\.\\.\\./.test(document.body.innerText) && !(function(e){return !!e && e.offsetParent!==null && e.style.display!=="none";})(document.getElementById("cancelLobbyBtn"))', 60)
    time.sleep(4)
    rec(G, mode, 'game starts (the console shows Pause / Play song)', re.search(r'"(Pause|Play song)', buttons(host) or '') is not None, [js(host, ERRT), buttons(host)])
    console(G, mode, host, '03-playing'); time.sleep(5); tvshot(G, mode, '03-playing')
    for _, ph, tag in phones:
        c = until(ph, 'document.querySelectorAll("#cardGrid .cc").length===25', 30) is True
        rec(G, mode, 'phone %s dealt a 25-square card' % tag, c, text(ph)); phoneshot(G, mode, ph, tag, '03-card')
    for k in (1, 2):
        b = click_rx(host, '/^(Play song|Next song|Play next song|Play)$/i')
        rec(G, mode, 'song %d played from the console (%s)' % (k, b or 'no Play button'), bool(b), buttons(host))
        time.sleep(4); tvshot(G, mode, '1%d-song%d' % (k, k)); console(G, mode, host, '1%d-song%d' % (k, k))
        time.sleep(6)
    rec(G, mode, 'no false "TV has no sound" warning', not re.search(r'TV has no sound', js(host, 'document.body.innerText') or '', re.I), text(host))
    tap(host, 'endGameBtn'); time.sleep(1.3); tap(host, 'endGameBtn'); dialogs(host)
    end_any(host, 'end')
    ad = tv_ads(TVS[0][0], 40)
    rec(G, mode, 'game ends, TV back to ads', ad, [js(TVS[0][0], TVFRAME), buttons(host)])
    tvshot(G, mode, '45-after'); console(G, mode, host, '45-after')
    no_throw(G, mode, [s for s, _ in TVS] + [host] + [p for _, p, _ in phones])
    close_all(t_h, *[t for t, _, _ in phones])


# ============================================================== BINGO
def bingo(mode):
    G = 'bingo'
    t_h, host, who = host_tab(G, '/app/?venue=' + VENUE)
    ok = until(host, '!!document.querySelector(\'[data-game="bingo"]\') && document.querySelector(\'[data-game="bingo"]\').offsetParent!==null', 60) is True
    time.sleep(2)
    rec(G, mode, 'games menu shows bingo (%s)' % who, ok, text(host)); console(G, mode, host, '00-menu')
    if not ok:
        close_all(t_h); return
    js(host, 'document.querySelector(\'[data-game="bingo"]\').click(); true')
    until(host, '!document.getElementById("setupBlock").classList.contains("hidden")', 20); time.sleep(3); dialogs(host)
    rec(G, mode, 'leftover game cleared before start', end_any(host, 'pre'), text(host, 200))
    js(host, ('var $=function(i){return document.getElementById(i)}; if($("paidSel")){ $("paidSel").value=""; $("paidSel").dispatchEvent(new Event("change")); }'
              'if($("cardsSel")) $("cardsSel").value="1"; var cc=$("callerChk"); if(cc && cc.checked){ cc.click(); } true'))
    console(G, mode, host, '01-setup')
    tap(host, 'startBtn'); dialogs(host)
    lob = until(host, 'document.getElementById("startBtn").textContent==="Start calling numbers"', 25) is True
    rec(G, mode, 'lobby opens', lob, [js(host, 'document.getElementById("startBtn").textContent'), js(host, ERRT), text(host)])
    console(G, mode, host, '02-lobby')
    tvt = until(TVS[0][0], '/BINGO/i.test(document.body.innerText) || /bingo/.test(%s)' % TVFRAME, 40) is True; time.sleep(3)
    rec(G, mode, 'TV takes bingo', tvt, tvtext(TVS[0][0])); tvshot(G, mode, '02-lobby')
    phones = join_phones(G, mode)
    tap(host, 'startBtn'); dialogs(host)
    calls = 0
    for _ in range(8):
        r = until(host, '(function(b){ return !!b && !b.disabled && b.offsetParent!==null; })(document.getElementById("nextBtn"))', 20)
        if r is not True:
            break
        time.sleep(1.5); tap(host, 'nextBtn'); calls += 1
        until(host, '/%d of 90/.test((document.getElementById("liveCount")||{}).textContent||"")' % calls, 8)
        if calls in (1, 5):
            time.sleep(2); tvshot(G, mode, '1%d-ball%d' % (calls, calls)); console(G, mode, host, '1%d-ball%d' % (calls, calls))
    rec(G, mode, 'balls called: %d' % calls, calls >= 5, [js(host, '(document.getElementById("liveCount")||{}).textContent'), js(host, ERRT), buttons(host)])
    tvs = until(TVS[0][0], '/\\b%d\\s*of\\s*90/i.test(document.body.innerText)' % calls, 8) is True
    rec(G, mode, 'TV shows %d of 90' % calls, tvs, tvtext(TVS[0][0])); tvshot(G, mode, '20-calling'); console(G, mode, host, '20-calling')
    for _, ph, tag in phones:
        s = until(ph, '/%d of 90/.test((document.getElementById("hdrBallCount")||{}).textContent||"")' % calls, 8) is True
        rec(G, mode, 'phone %s in step (%d of 90)' % (tag, calls), s, text(ph)); phoneshot(G, mode, ph, tag, '20-ticket')
    tap(host, 'endGameBtn'); dialogs(host)
    end_any(host, 'end')
    ad = tv_ads(TVS[0][0], 40) and until(TVS[0][0], '!/Last called/i.test(document.body.innerText)', 20) is True
    rec(G, mode, 'game ends, TV back to ads', ad, tvtext(TVS[0][0])); tvshot(G, mode, '45-after')
    no_throw(G, mode, [s for s, _ in TVS] + [host] + [p for _, p, _ in phones])
    close_all(t_h, *[t for t, _, _ in phones])


# ============================================================== RAFFLE / MEMBERS DRAW
def draw(kind, mode):
    G = kind
    t_h, host, who = host_tab(G, '/app/%s/host.html?venue=%s' % (kind, VENUE))
    ok = until(host, 'document.readyState==="complete" && !!document.getElementById("drawBtn") && document.getElementById("drawBtn").offsetParent!==null', 60) is True
    time.sleep(3)
    rec(G, mode, 'console loads with a Draw button (%s)' % who, ok, text(host)); console(G, mode, host, '01-setup')
    if not ok:
        close_all(t_h); return
    if kind == 'raffle':
        js(host, 'var b=document.querySelector("#prizePresets button"); if(b) b.click(); true'); time.sleep(1)
    if kind == 'members' and re.search(r'No draw set up', text(host, 20000)):
        rec(G, mode, 'the seeded members draw is there', False, text(host, 400))
    phones = []
    if mode == 'phones':
        for tag, _, _ in PHONES:
            t, ph = open_('/play?room=' + CODE, STORE(tag), 390, 844); time.sleep(6)
            phones.append((t, ph, tag)); phoneshot(G, mode, ph, tag, '01-waiting')
    until(host, '!!document.querySelector("#tvLine .tvline-btn")', 30); js(host, 'var b=document.querySelector("#tvLine .tvline-btn"); if(b) b.click(); true')
    tvt = until(TVS[0][0], '/%s/.test(%s)' % (kind, TVFRAME), 40) is True; time.sleep(4)
    rec(G, mode, 'TV takes the %s' % kind, tvt, [js(TVS[0][0], TVFRAME), tvtext(TVS[0][0])]); tvshot(G, mode, '02-lobby')
    console(G, mode, host, '02-ready')
    js(host, 'setTimeout(function(){ document.getElementById("drawBtn").click(); }, 0); true')
    for _ in range(12):
        if js(host, 'document.getElementById("drawBtn").disabled || document.getElementById("winnerCard").classList.contains("show")') is True:
            break
        js(host, ACCEPT); time.sleep(1)
    for k, wait in enumerate((1, 2, 3, 4)):
        time.sleep(wait); tvshot(G, mode, '1%d-draw' % k)
    w = until(host, 'document.getElementById("winnerCard").classList.contains("show")', 40) is True
    time.sleep(2)
    rec(G, mode, 'winner shown on console', w, [js(host, 'document.getElementById("winnerCard").innerText.replace(/\\s+/g," ")'), js(host, ERRT)])
    tvshot(G, mode, '20-winner'); console(G, mode, host, '20-winner')
    t = tvtext(TVS[0][0])
    rec(G, mode, 'TV winner screen has no "$0"', not re.search(r'\$\s*0\b(?!\.)', t), t)
    if kind == 'members':
        rec(G, mode, 'TV never shows a member as "Last,First"', not re.search(r'\b[A-Z][a-z]+,[A-Z][a-z]+\b', t), t)
    for _, ph, tag in phones:
        phoneshot(G, mode, ph, tag, '20-winner')
    if w:
        js(host, 'document.getElementById("claimBtn").click(); true'); dialogs(host); time.sleep(2); tvshot(G, mode, '30-claimed')
    js(host, 'setTimeout(function(){ var b=document.getElementById("toAdsBtn"); if(b) b.click(); }, 0); true'); dialogs(host)
    ad = tv_ads(TVS[0][0], 40)
    rec(G, mode, 'ends, TV back to ads', ad, [js(TVS[0][0], TVFRAME), buttons(host)]); tvshot(G, mode, '45-after')
    no_throw(G, mode, [s for s, _ in TVS] + [host] + [p for _, p, _ in phones])
    close_all(t_h, *[t for t, _, _ in phones])


STARTED = time.strftime('%Y-%m-%d %H:%M:%S')


def main():
    log('== real-venues-play', VNAME, SLUG, 'start', STARTED, 'modes', MODES)
    for lab, (w, h) in (('1080', (1920, 1080)), ('720', (1280, 720))):
        t, sid = open_('/tv?venue=' + SLUG, STORE('TV' + lab), w, h)
        TVS.append((sid, lab))
    ok = all(until(s, 'document.readyState==="complete"', 40) is True for s, _ in TVS) and tv_ads(TVS[0][0], 30)
    time.sleep(10)
    rec('tv', '-', 'TV page up on its ads (both TVs)', ok, tvtext(TVS[0][0]))
    for k in range(3):
        tvshot('tv', '-', '0%d-ads' % k); time.sleep(8)
    plan = [('trivia', trivia), ('musical', musical), ('bingo', bingo),
            ('raffle', lambda m: draw('raffle', m)), ('members', lambda m: draw('members', m))]
    for name, fn in plan:
        if ONLY and name not in ONLY:
            continue
        for mode in MODES:
            log('\n== %s / %s  %s' % (name, mode, time.strftime('%H:%M:%S')))
            try:
                fn(mode)
            except Exception:
                rec(name, mode, 'driver error', False, traceback.format_exc()[-600:])
            time.sleep(3)
            if not tv_ads(TVS[0][0], 5):
                log('  TV not on ads after %s/%s; waiting' % (name, mode)); tv_ads(TVS[0][0], 30)
    log('== done', time.strftime('%H:%M:%S'), 'results', len(RES), 'fails', sum(1 for r in RES if not r['ok']))


try:
    main()
finally:
    save()
    try: B.close()
    except Exception: pass
