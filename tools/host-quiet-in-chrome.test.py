#!/usr/bin/env python3
"""A CONNECTED HOST CONSOLE SAYS NOTHING, AND HQ VIEW AS OF A PROSPECT SHOWS THE CONSOLE (Dean, 11 Nov 2026,
INBOX 193 and 194).

Dean, 7 Nov: "We only ever need to know if there's an error." No status dot and no "Connected" / "Ready" /
"Waiting for screen" words on any host console or in HQ View as; a real drop still says "Reconnecting".
And HQ "View as" a venue set up for a prospect that has not accepted the Terms (Revolver Upstairs) showed
the card with "section 6" jargon, a pink "Bingo" tag and a blank page under it.

It opens the REAL consoles (bingo /app, trivia, musical bingo, raffle, members draw) in headless Chrome
through tools/browser-rig/admin_site.py (the stand-in supabase-js, its realtime carried between tabs), and:
  connected   once the channel is up, and again after a TV says tv_here: no dot painted, no words
              in the header, the bingo "Venue screen" chip empty
  a drop      the line goes down (the fake channel loses it the way supabase-js does): "Reconnecting"
              is painted; the line comes back: the words go again
  view as     HQ, viewing a prospect venue with no Terms record: the card in Dean's words, "Read the
              Terms", no "section 6", the header tag never "Bingo", and the venue's console under it

Takes /tmp/vp-heavy.lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    python3 tools/host-quiet-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)

ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1

# Before the page's own scripts: the fake channel follows a line we can cut (window.__down), navigator.onLine
# follows it too (so the channel drops in about a second, as supabase-js does on "offline"), and every
# BroadcastChannel name is noted, so the test can speak as the TV on the console's own channel.
PRE = ('window.__FAKE_LINE_WATCH=true; window.__down=false; window.__lineDown=function(){return window.__down===true;};'
       'try{Object.defineProperty(Navigator.prototype,"onLine",{configurable:true,get:function(){return window.__down!==true;}});}catch(e){}'
       'window.__bcNames=[]; (function(){var B=window.BroadcastChannel; if(!B) return;'
       ' window.BroadcastChannel=function(n){ if(window.__bcNames.indexOf(n)<0) window.__bcNames.push(n); return new B(n); };'
       ' window.BroadcastChannel.prototype=B.prototype;})();')

HEAD = ('JSON.stringify((function(){var d=document.getElementById("statusDot"), t=document.getElementById("statusText"),'
        ' c=document.getElementById("pairedChip"); function W(e){ if(!e) return 0; var b=e.getBoundingClientRect();'
        ' return (getComputedStyle(e).display==="none"||getComputedStyle(e).visibility==="hidden") ? 0 : Math.round(b.width); }'
        ' var who=t?t.closest(".who"):null;'
        ' return {dot:W(d), said:t?t.textContent:"", shown:(who&&W(who)>0)?W(t):0, conn:t?t.getAttribute("data-conn"):null,'
        ' chip:c?c.textContent:null, tag:(document.getElementById("headerTag")||{}).textContent||""};})())')

WORDS = ('Connected', 'Ready', 'Waiting for screen', 'TV not connected', 'TV connected', 'Not connected', 'Signed in', 'connected', 'ready')

TV_HERE = ('(function(){ (window.__bcNames||[]).forEach(function(n){ if(n.indexOf("fake-rt:")!==0) return;'
           ' var b=new BroadcastChannel(n); b.postMessage({event:"msg", payload:{t:"tv_here"}}); setTimeout(function(){ b.close(); }, 200); });'
           ' return (window.__bcNames||[]).length; })()')


def quiet(h):
    """No dot painted, nothing in the header that names the connection."""
    words = [w for w in WORDS if w in (h.get('said') or '') or w in (h.get('chip') or '')]
    return h.get('dot', 9) < 1 and not words and (h.get('shown', 9) <= 1 or 'venueplay Admin' in (h.get('said') or ''))


def consoles(S, V1):
    pages = [('the bingo console', '/app/?venue=' + V1),
             ('the trivia console', '/app/trivia/host.html?venue=' + V1),
             ('the musical bingo console', '/app/musical/host.html?venue=' + V1),
             ('the raffle console', '/app/raffle/host.html?venue=' + V1),
             ('the members draw console', '/app/members/host.html?venue=' + V1)]
    for name, path in pages:
        print('\n' + name.upper() + ' (' + path.split('?')[0] + ')')
        tid, sid = S.open(path, 1280, 900, False, pre=PRE)
        if name == 'the bingo console':
            # the stand-in owner has two venues: the console asks which one first (console-round3-6nov does the same)
            if S.until(sid, 'document.querySelectorAll("#venuePickList button").length > 1', 25) is True:
                S.js(sid, '[].filter.call(document.querySelectorAll("#venuePickList button"),function(b){return b.textContent==="Deepwater Hotel"})[0].click(); true')
        up = S.until(sid, '/^(up|tv)$/.test((document.getElementById("statusText")||{getAttribute:function(){return "";}}).getAttribute("data-conn")||"")', 40)
        ok(name + ': the channel comes up', up is True, S.json(sid, HEAD, {}))
        time.sleep(0.6)
        h = S.json(sid, HEAD, {})
        ok(name + ': connected says nothing: no dot, no "Connected", "Ready" or "Waiting for screen" words', up is True and quiet(h), h)
        n = S.js(sid, TV_HERE)
        got = S.until(sid, 'document.getElementById("statusText").getAttribute("data-conn")==="tv"', 10)
        h = S.json(sid, HEAD, {})
        ok(name + ': the TV says hello, and still nothing: no dot, no "Connected"', got is True and quiet(h), [n, h])
        S.js(sid, 'window.__down=true; try{ window.dispatchEvent(new Event("offline")); }catch(e){} true')
        drop = S.until(sid, '/Reconnecting/.test(document.getElementById("statusText").textContent + " " + ((document.getElementById("pairedChip")||{}).textContent||""))', 15)
        h = S.json(sid, HEAD, {})
        if name == 'the bingo console':
            # a venue's own bingo console has no header status at all: the drop is said beside "Venue screen"
            seen = 'Reconnecting' in (h.get('chip') or '')
        else:
            seen = h.get('said') == 'Reconnecting' and h.get('shown', 0) > 1
        ok(name + ': a real drop shows "Reconnecting", in words, with no dot', drop is True and seen and h.get('dot', 9) < 1, h)
        S.js(sid, 'window.__down=false; try{ window.dispatchEvent(new Event("online")); }catch(e){} true')
        back = S.until(sid, '!/Reconnecting/.test(document.getElementById("statusText").textContent + " " + ((document.getElementById("pairedChip")||{}).textContent||""))', 20)
        h = S.json(sid, HEAD, {})
        ok(name + ': the line comes back, and the words go again', back is True and quiet(h), h)
        ok(name + ': no script errors', S.js(sid, 'window.__errs.length') == 0, S.js(sid, 'JSON.stringify(window.__errs)'))
        S.close_tab(tid)


CARD = ('JSON.stringify((function(){var c=document.getElementById("vpTermsCard"); var wrap=document.querySelector(".wrap");'
        ' var kids=wrap?[].filter.call(wrap.children,function(k){ return k!==c && k.getBoundingClientRect().height>40 && getComputedStyle(k).display!=="none"; }):[];'
        ' var a=c?c.querySelector("a"):null;'
        ' return {card:!!c, h2:c&&c.querySelector("h2")?c.querySelector("h2").textContent:"", ps:c?[].map.call(c.querySelectorAll("p"),function(p){return p.textContent;}):[],'
        ' link:a?a.textContent:"", href:a?a.getAttribute("href"):"", all:c?c.textContent:"", tick:!!document.getElementById("vpTermsTick"),'
        ' below:kids.map(function(k){ return k.id||k.className; }), belowH:kids.reduce(function(s,k){ return s+k.getBoundingClientRect().height; },0),'
        ' cardBottom:c?Math.round(c.getBoundingClientRect().bottom):0,'
        ' firstBelow:kids.length?Math.round(kids[0].getBoundingClientRect().top):0};})())')


def view_as(V2):
    import admin_site
    print('\nHQ VIEW AS A PROSPECT THAT HAS NOT ACCEPTED THE TERMS (Revolver Upstairs, 11 Nov 2026)')
    S2 = admin_site.Site()
    try:
        info = S2.W.info
        v1, v2 = info['venue'], info['venue2']
        base = admin_site.fake_db(info, True)['vp_venues']
        prospect = dict(base[1], name='Test Revolver Upstairs', slug='test-revolver-upstairs', terms_required=True,
                        compliance_accepted_at=None, compliance_accepted_by=None)
        S2.extra_db = {'vp_venues': [base[0], prospect]}
        pre = PRE + ('try{ localStorage.setItem("vpImpersonate", JSON.stringify({id:%s, name:"Test Revolver Upstairs"}));'
                     ' localStorage.setItem("vpCurrentVenue", %s); sessionStorage.setItem("vpVenueExplicit", %s); }catch(e){}'
                     # every word the header tag is ever given, not just the last one: a "Bingo" for a moment is still
                     # "Bingo". The page may set it before DOMContentLoaded, so the setter itself is watched.
                     ' window.__tags=[]; (function(){ var D=Object.getOwnPropertyDescriptor(Node.prototype,"textContent");'
                     ' Object.defineProperty(Node.prototype,"textContent",{configurable:true, get:D.get, set:function(v){'
                     ' if(this && this.id==="headerTag") window.__tags.push(String(v)); return D.set.call(this, v); }}); })();'
                     % (json.dumps(v2), json.dumps(v2), json.dumps(v2)))
        tid, sid = S2.open('/app/?as=admin', 1280, 900, False, pre=pre)
        S2.until(sid, '!!document.getElementById("vpTermsCard")', 30)
        time.sleep(2.5)
        c = S2.json(sid, CARD, {})
        ok('HQ sees the card', c.get('card') is True, c)
        ok('its title, in Dean\'s words: "Test Revolver Upstairs hasn\'t accepted the Terms yet, so games can\'t start"',
           c.get('h2') == "Test Revolver Upstairs hasn't accepted the Terms yet, so games can't start", c.get('h2'))
        ok('its line: "Only the venue\'s owner or a manager can accept them when they sign in. Their TV keeps showing their ads."',
           "Only the venue's owner or a manager can accept them when they sign in. Their TV keeps showing their ads." in (c.get('ps') or []), c.get('ps'))
        ok('the link says "Read the Terms" and goes to /terms', c.get('link') == 'Read the Terms' and c.get('href') == '/terms', [c.get('link'), c.get('href')])
        ok('no "section 6" jargon anywhere on the card, and no tick for HQ', 'section 6' not in (c.get('all') or '').lower() and c.get('tick') is False, c.get('all'))
        ok('below the card the page is not blank: the venue\'s console is there for HQ to check',
           c.get('belowH', 0) > 150 and c.get('firstBelow', 0) >= c.get('cardBottom', 9999) - 2, c)
        h = S2.json(sid, HEAD, {})
        tags = S2.js(sid, 'JSON.stringify(window.__tags||null)')
        ok('the header tag is the plain console label, and never once says "Bingo" on the way there',
           h.get('tag') == 'Play' and isinstance(tags, str) and tags != 'null' and 'Bingo' not in tags, [h.get('tag'), tags])
        ok('the header names View as, with no dot and no "Connected" / "Ready" words',
           'venueplay Admin' in (h.get('said') or '') and 'Test Revolver Upstairs' in (h.get('said') or '') and quiet(h), h)
        ok('view as: no script errors', S2.js(sid, 'window.__errs.length') == 0, S2.js(sid, 'JSON.stringify(window.__errs)'))
        if os.environ.get('VP_SHOTS'):
            S2.shot(sid, os.path.join(os.environ['VP_SHOTS'], 'view-as-terms.png'), full=True)
        S2.close_tab(tid)
    finally:
        S2.close()


def main():
    import gatelib
    if not gatelib.hold_lock_or_refuse('host-quiet-in-chrome.test.py', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0') or 0)):
        print('\n0 of 1 checks passed'); sys.exit(1)
    import admin_site
    S = admin_site.Site()
    try:
        consoles(S, S.W.info['venue'])
    finally:
        S.close()
    view_as(None)
    print('\n' + ('ALL %d CHECKS PASSED' % ran if not bad else '%d OF %d CHECKS FAILED' % (bad, ran)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
