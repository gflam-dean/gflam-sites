#!/usr/bin/env python3
"""THE HELP DESK PAGES, IN A REAL BROWSER, AT PHONE WIDTH (19 Oct 2026).

Dean: "add a small 'Help' link ... plus a 'Contact support' form". The brief that came with it:
the link must not cover the game or the BINGO button. A text search cannot see that; only a
browser laying the page out can. So this opens the REAL pages from this repo in headless Chrome
at 375 by 740 (an ordinary phone), plays the real demo night until the BINGO button is on screen,
and measures:

  - the Help link exists, is in the page flow (never fixed over the game), is below the BINGO
    button, and no visible control on the page overlaps it
  - the page has not grown sideways (no horizontal scroll at phone width)
  - the panel opens, loads the FAQ from /data/help-faq.json, links the privacy policy
  - the form refuses a missing email, then sends exactly what the Worker expects (room code,
    game, honeypot, device), and shows the ticket number it is told
  - the same for PartyPlay's guest page, host page and home page form, in its own brand
  - the venue form (console header) sends the venue and the login's token, and nothing else
  - HQ's help desk tab: the badge, the list with brands, opening a ticket, the report
  - the Worker's VAPID signature for phone alerts, made by the Worker's own functions, verifies
    under the public key with real WebCrypto (jsc has none, so this is the only place it can)

The Worker is never called: the pages are pointed at https://help.test (window.VP_HELP_API) and a
stand-in answers there, recording every request. Nothing leaves this machine but font requests.

Run from the repo root:  python3 tools/help-desk-pages.test.py
Screenshots for a person to look at:  HELP_DESK_SCREENS=/some/folder python3 tools/help-desk-pages.test.py
"""
import base64, functools, http.server, importlib.util, json, os, re, socketserver, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get('HELP_DESK_SCREENS', '')
spec = importlib.util.spec_from_file_location('verify_live', os.path.join(ROOT, 'tools', 'verify-live.py'))
vl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vl)

fails = 0
ran = 0


def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    if ok:
        print('  ok   ' + name)
    else:
        fails += 1
        print('  FAIL ' + name + ('' if saw is None else '   saw: ' + json.dumps(saw, default=str)[:400]))


# ---------------------------------------------------------------- local servers
FIXTURES = {
    # The venue console header, with a stand-in VP session, loading the REAL widget in venue mode.
    '/__fixture/venue.html': '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0A0A0B;color:#eee;margin:0;font-family:system-ui}header .bar{display:flex;align-items:center;gap:8px;padding:12px}
.hactions{margin-left:auto;display:flex;gap:8px}.hact{padding:7px 14px;border-radius:999px;background:#17171A;color:#eee;border:1px solid #333}</style></head>
<body><header><div class="bar"><b>VenuePlay</b><span class="hactions"><a class="hact" href="#">Account</a><button class="hact">Sign out</button></span></div></header>
<div style="padding:16px">The console.</div>
<script>window.VP={ready:function(){return Promise.resolve({currentVenueId:"11111111-2222-4333-8444-555555555555",venue:{id:"11111111-2222-4333-8444-555555555555",slug:"royal"},staff:[{venue_id:"11111111-2222-4333-8444-555555555555"}]});},
getClient:function(){return{auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:"venue-login-token"}}});}}};}};</script>
<script src="/app/vp-help.js" data-mode="venue" data-brand="venueplay"></script></body></html>''',
    '/__fixture/blank.html': '<!doctype html><html><head><meta charset="utf-8"></head><body>blank</body></html>',
    # A GROUP account (The Mini Bar, 21 Oct 2026: "pick your venue first" with nothing to pick). This login
    # is staff at three venues and the page has no current venue: Help must offer the three by name.
    '/__fixture/group.html': '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0A0A0B;color:#eee;margin:0;font-family:system-ui}header .bar{display:flex;align-items:center;gap:8px;padding:12px}
.hactions{margin-left:auto;display:flex;gap:8px}.hact{padding:7px 14px;border-radius:999px;background:#17171A;color:#eee;border:1px solid #333}</style></head>
<body><header><div class="bar"><b>VenuePlay</b><span class="hactions"><a class="hact" href="#">Account</a></span></div></header>
<script>(function(){var V=[{id:"aaaaaaaa-0000-4000-8000-000000000001",name:"The Mini Bar Broadbeach",slug:"mini-bar-broadbeach"},{id:"aaaaaaaa-0000-4000-8000-000000000002",name:"The Mini Bar Burleigh",slug:"mini-bar-burleigh"},{id:"aaaaaaaa-0000-4000-8000-000000000003",name:"The Mini Bar Tugun",slug:"mini-bar-tugun"}];
window.__asked=[];function q(){var o={select:function(c){__asked.push("select "+c);return o;},in:function(k,ids){__asked.push("in "+ids.length);return o;},order:function(){return o;},range:function(){return o;},then:function(a,b){return Promise.resolve({data:V}).then(a,b);}};return o;}
window.VP={ready:function(){return Promise.resolve({currentVenueId:null,venue:null,isAdmin:false,client:{from:q},staff:V.map(function(v){return{venue_id:v.id,role:"owner"};})});},
getClient:function(){return{auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:"group-token",user:{email:"owner@theminibar.com.au"}}}});}}};}};})();</script>
<script src="/app/vp-help.js" data-mode="venue" data-brand="venueplay"></script></body></html>''',
    # The account page (billing.html) says which venue it shows. Help must use it, with that venue's TV link.
    '/__fixture/account-hook.html': '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><header><div class="bar"><span class="hactions"><a class="hact" href="#">Account</a></span></div></header>
<script>window.VP_HELP_VENUES=function(){return[{id:"aaaaaaaa-0000-4000-8000-000000000001",name:"Broadbeach",slug:"mini-bar-broadbeach"},{id:"aaaaaaaa-0000-4000-8000-000000000002",name:"Burleigh",slug:"mini-bar-burleigh"}];};
window.VP_HELP_VENUE=function(){return "aaaaaaaa-0000-4000-8000-000000000002";};
window.VP={ready:function(){return Promise.resolve({currentVenueId:null,venue:null,isAdmin:true,staff:[]});},
getClient:function(){return{auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:"admin-token",user:{email:"dean@example.com"}}}});}}};}};</script>
<script src="/app/vp-help.js" data-mode="venue" data-brand="venueplay"></script></body></html>''',
}


def serve(folder):
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            p = self.path.split('?')[0]
            if p in FIXTURES:
                body = FIXTURES[p].encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            # Clean URLs, the way Cloudflare Pages serves them (/play is play.html).
            if p != '/' and not os.path.splitext(p)[1] and os.path.isfile(os.path.join(folder, p.lstrip('/') + '.html')):
                self.path = p + '.html' + self.path[len(p):]
            return super().do_GET()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=folder))
    srv.socket.listen(128)   # Python's default queue of 5 drops scripts when a page asks for many at once (browser-rig/rig.py Server, 26 Oct 2026)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d' % srv.server_address[1]


# The help desk Worker, stood in for inside the page. Every request is recorded.
STAND_IN = r'''
window.VP_HELP_API = "https://help.test";
window.__posts = [];
window.__routes = window.__routes || {};
(function () {
  var real = window.fetch;
  window.fetch = function (u, o) {
    u = String(u);
    if (u.indexOf("https://help.test") === 0) {
      var b = {}; try { b = JSON.parse((o && o.body) || "{}"); } catch (e) {}
      var path = u.slice("https://help.test".length);
      window.__posts.push({ path: path, body: b, headers: (o && o.headers) || {} });
      var r = window.__routes[path] || window.__routes[path.split("?")[0]] || { status: 200, body: { ok: true, ticket_no: 1042 } };
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { "Content-Type": "application/json" } }));
    }
    if (/workers\.dev/.test(u)) return Promise.reject(new Error("the real Worker is never called from this test"));
    return real.apply(this, arguments);
  };
})();
'''


def _content(faq_items, issues):
    return {'body': {'faq': faq_items, 'issues': issues}}
def _iss(i, title, n):
    return {'id': '0000000%d-0000-4000-8000-%012d' % (i, i), 'title': title,
            'steps': [{'id': '0000000%d-0000-4000-8000-%012d' % (i, 100 * i + k), 'body': 'Step body %d.%d' % (i, k + 1)} for k in range(n)]}
_vp = json.load(open(os.path.join(ROOT, 'venueplay', 'data', 'help-faq.json')))
_pp = json.load(open(os.path.join(ROOT, 'partyplay', 'data', 'help-faq.json')))
ISSUES = {'venueplay:patron': [_iss(1, 'My game is not showing', 4), _iss(2, 'Something else', 0)],
          'venueplay:venue': [_iss(3, 'The TV is not showing the game', 3), _iss(4, 'A question about my bill', 0)],
          'partyplay:guest': [_iss(5, 'I cannot join the party', 3)], 'partyplay:host': [_iss(6, 'The party screen is blank', 3)]}
ISSUES['venueplay:patron'][0]['steps'][0]['body'] = 'Pull down to refresh the page.'
ISSUES['venueplay:venue'][0]['steps'][1]['body'] = 'Check the TV is showing {tv_link}.'
ISSUES['venueplay:patron'][0]['steps'][3]['body'] = 'Ask the host. They can see who has joined and can get you going.'
DEFAULT_ROUTES = {'/help/triage': {'body': {'ok': True, 'proof': 'proof-from-start'}}}
for key, data in (('venueplay:patron', _vp['patron']), ('venueplay:venue', _vp['venue']), ('partyplay:guest', _pp['guest']), ('partyplay:host', _pp['host'])):
    b_, a_ = key.split(':')
    DEFAULT_ROUTES['/help/content?brand=%s&audience=%s' % (b_, a_)] = _content(data['items'], ISSUES[key])


class Tab(object):
    def __init__(self, b, w=375, h=740, mobile=True, pre='', routes=None):
        merged = dict(DEFAULT_ROUTES)
        merged.update(routes or {})
        pre = 'window.__routes=' + json.dumps(merged) + ';' + pre
        self.b = b
        self.tid = b.call('Target.createTarget', {'url': 'about:blank'})['targetId']
        self.sid = b.call('Target.attachToTarget', {'targetId': self.tid, 'flatten': True})['sessionId']
        b.call('Page.enable', session=self.sid)
        b.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': mobile}, session=self.sid)
        b.call('Page.addScriptToEvaluateOnNewDocument', {'source': pre + STAND_IN}, session=self.sid)
        # Third-party scripts the pages load: never needed here, and a slow CDN must not decide a result.
        b.call('Network.enable', session=self.sid)
        b.call('Network.setBlockedURLs', {'urls': ['*cdn.jsdelivr.net*', '*googletagmanager*', '*facebook*', '*workers.dev*']}, session=self.sid)

    def go(self, url):
        self.b.call('Page.navigate', {'url': url}, session=self.sid)

    def js(self, expr, wait=False):
        r = self.b.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': wait}, session=self.sid)
        if r.get('exceptionDetails'):
            return {'__threw': json.dumps(r['exceptionDetails'])[:300]}
        return r.get('result', {}).get('value')

    def until(self, expr, secs=20):
        end = time.time() + secs
        while time.time() < end:
            v = self.js(expr)
            if v and not (isinstance(v, dict) and v.get('__threw')):
                return v
            time.sleep(0.15)
        return None

    def shot(self, name):
        if not SHOTS:
            return
        os.makedirs(SHOTS, exist_ok=True)
        d = self.b.call('Page.captureScreenshot', {'format': 'png'}, session=self.sid)['data']
        with open(os.path.join(SHOTS, name + '.png'), 'wb') as f:
            f.write(base64.b64decode(d))

    def close(self):
        self.b.close_tab(self.tid)


# Where the Help link sits, and everything that overlaps it.
MEASURE = r'''(function () {
  var L = document.getElementById("vphLink"); if (!L) return { missing: true };
  L.scrollIntoView({ block: "center" });
  var r = L.getBoundingClientRect(), hits = [];
  function vis(e) { var s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity !== 0; }
  Array.prototype.forEach.call(document.querySelectorAll("body *"), function (e) {
    if (e === L || e.contains(L) || L.contains(e) || !vis(e)) return;
    var q = e.getBoundingClientRect(); if (q.width * q.height < 2) return;
    var x = Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)), y = Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top));
    if (x * y > 1) hits.push(e.tagName + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.split(" ").join(".") : ""));
  });
  var c = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  var pos = [], n = L; while (n && n !== document.body) { pos.push(getComputedStyle(n).position); n = n.parentElement; }
  var B = document.getElementById("bingoBtn"), br = B && B.offsetParent ? B.getBoundingClientRect() : null;
  return { w: r.width, h: r.height, hits: hits, centre: !!c && (c === L || L.contains(c)),
           fixed: pos.some(function (p) { return p === "fixed" || p === "sticky"; }),
           below: br ? Math.round(r.top - br.bottom) : null, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
})()'''


def link_checks(t, where):
    m = t.js(MEASURE)
    check(where + ': the Help link is there and big enough to tap', bool(m) and not m.get('missing') and m['w'] >= 30 and m['h'] >= 24, m)
    if not m or m.get('missing'):
        return m
    check(where + ': it sits in the page, never fixed or sticky over the game', m['fixed'] is False, m)
    check(where + ': nothing on the page overlaps it, and it overlaps nothing', m['hits'] == [] and m['centre'], m['hits'])
    check(where + ': no sideways scrolling at phone width', m['scrollW'] <= m['innerW'], [m['scrollW'], m['innerW']])
    return m


def panel_checks(t, where, faq_items, title_has):
    t.js('document.getElementById("vphLink").click()')
    got = t.until('document.querySelectorAll("#vphFaq details").length || 0', 8)
    check(where + ': Help opens with the questions and answers HQ keeps (%d), folded under the issues' % faq_items, got == faq_items and t.js('document.getElementById("vphFaq").open') is False, got)
    check(where + ': its title is right', title_has in (t.js('(document.getElementById("vphTitle")||{}).textContent') or ''), t.js('(document.getElementById("vphTitle")||{}).textContent'))
    check(where + ': it starts with "What\'s your issue?" and the issues, not a form', t.js('document.querySelectorAll("#vphFlow .vph-issue").length') >= 1 and t.js('!document.getElementById("vphMsg")') is True)
    return None


def to_form(t):
    t.js('document.querySelector(".vph-msg").click()')
    t.until('!!document.getElementById("vphMsg")', 5)
    return t.js('Array.prototype.some.call(document.querySelectorAll(".vph-fine a"), function(a){ return a.getAttribute("href")==="/privacy"; })')


def posts(t):
    return t.js('window.__posts') or []


# THE SUPPORT PHONE (20 Oct 2026): 07 5228 3667 is for VENUES. These read what the page has drawn.
NO_PHONE = ('(function(){var t=(document.body.innerText||"")+(document.body.textContent||"");'
            'return !document.querySelector("a[href^=\'tel:\']") && t.indexOf("5228 3667")===-1 && t.indexOf("52283667")===-1;})()')
CALL_LINE = ('(function(){var c=document.getElementById("vphCall");if(!c)return null;var a=c.querySelector("a"),r=c.getBoundingClientRect(),'
             'p=document.querySelector("#vphBg .vph").getBoundingClientRect();'
             'return {text:c.textContent,href:a&&a.getAttribute("href"),link:a&&a.textContent,shown:r.width>0&&r.height>0,'
             'inside:r.left>=p.left-1&&r.right<=p.right+1,scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth};})()')


def call_ok(c):
    return bool(c) and c['href'] == 'tel:+61752283667' and c['link'] == '07 5228 3667' and c['shown'] and c['inside'] \
        and c['text'] == 'Call us on 07 5228 3667. If a game is on right now, press 2.' and c['scrollW'] <= c['innerW']


# The same, on the public help page: the call line drawn into the VENUE card, measured against that card.
def page_call(t):
    return t.js('(function(){var c=document.getElementById("vphCall-venue");if(!c)return null;var a=c.querySelector("a"),r=c.getBoundingClientRect(),'
                'p=document.querySelector("#venue .card").getBoundingClientRect();'
                'return {text:c.textContent,href:a&&a.getAttribute("href"),link:a&&a.textContent,shown:r.width>0&&r.height>0,'
                'inside:r.left>=p.left-1&&r.right<=p.right+1,scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth};})()')


# No phone number and no tel: link inside one part of a page (the /help player part, its footer).
def no_phone_in(t, sel):
    return t.js('(function(){var e=document.querySelector(%s);if(!e)return null;var x=e.textContent||"";'
                'return !e.querySelector("a[href^=\'tel:\']") && x.indexOf("5228 3667")===-1 && x.indexOf("52283667")===-1;})()' % json.dumps(sel))


# Errors a page throws or logs, and any of its own files that failed to load. Installed before the
# page's first script, so nothing it does on load is missed.
ERRWATCH = ('window.__errs=[];window.addEventListener("error",function(e){__errs.push("error: "+(e.message||(e.target&&(e.target.src||e.target.href))||"?"));},true);'
            'window.addEventListener("unhandledrejection",function(e){__errs.push("rejection: "+String(e.reason));});'
            '(function(){var ce=console.error;console.error=function(){__errs.push("console.error: "+Array.prototype.join.call(arguments," "));return ce.apply(console,arguments);};})();')
OWN_FILES_BAD = ('(function(){return performance.getEntriesByType("resource").filter(function(e){return e.name.indexOf(location.origin)===0&&e.responseStatus>=400;})'
                 '.map(function(e){return e.name+" "+e.responseStatus;});})()')


def last_ticket(t):
    return ([x for x in posts(t) if x['path'] == '/help/ticket'][-1:] or [{}])[0]


def group_checks(b, VP):
    """A group account with several venues, and the account page's own venue (21 Oct 2026)."""
    print('A GROUP ACCOUNT (The Mini Bar): HELP WITH NO CURRENT VENUE')
    t = Tab(b, 390, 800)
    t.go(VP + '/__fixture/group.html')
    t.until('!!document.getElementById("vphLink")', 8)
    t.js('document.getElementById("vphLink").click()')
    t.until('!!document.querySelector(".vph-msg")', 5)
    to_form(t)
    opts = t.until('(function(){var p=document.getElementById("vphPick");return p&&p.options.length>1?Array.prototype.map.call(p.options,function(o){return o.textContent;}).join("|"):"";})()', 5)
    check('group: with no current venue, the form asks which venue, listing this login\'s venues by name', opts == 'Choose a venue|The Mini Bar Broadbeach|The Mini Bar Burleigh|The Mini Bar Tugun', opts)
    check('group: and they come from this login\'s own venues (one read, by id)', 'in 3' in (t.js('window.__asked') or []), t.js('window.__asked'))
    lab = t.js('(function(){var r=document.getElementById("vphReply");return r.parentNode.querySelector("label").textContent;})()')
    check('group: a login WITH an email may leave the reply address blank', lab == 'Reply to (optional)', lab)
    t.shot('07d-group-venue-picker')
    t.js('document.getElementById("vphSubject").value="TV";document.getElementById("vphMsg").value="Black screen";document.querySelector(".vph-go").click()')
    time.sleep(0.3)
    check('group: no venue chosen, no send, and it says to choose one', not [x for x in posts(t) if x['path'] == '/help/venue/ticket'] and 'Choose which venue' in (t.js('document.querySelector(".vph-err").textContent') or ''))
    t.js('document.getElementById("vphPick").value="aaaaaaaa-0000-4000-8000-000000000002";document.querySelector(".vph-go").click()')
    t.until('!!document.querySelector(".vph-done")', 8)
    bb = ([x for x in posts(t) if x['path'] == '/help/venue/ticket'][-1:] or [{}])[0].get('body', {})
    check('group: the ticket goes for the venue they chose, with no reply address (their sign-in email is used)', bb.get('venue_id') == 'aaaaaaaa-0000-4000-8000-000000000002' and bb.get('reply_email') == '', bb)
    t.close()

    print('THE ACCOUNT PAGE SAYS WHICH VENUE IT IS SHOWING')
    t = Tab(b, 390, 800, routes={'/help/content?brand=venueplay&audience=venue': _content(_vp['venue']['items'], [{'id': ISSUES['venueplay:venue'][0]['id'], 'title': 'TV', 'steps': [{'id': 's-tv', 'body': 'Check the TV is showing {tv_link}.'}]}])})
    t.go(VP + '/__fixture/account-hook.html')
    t.until('!!document.getElementById("vphLink")', 8)
    t.js('document.getElementById("vphLink").click()')
    t.until('!!document.querySelector("[data-issue]")', 5)
    t.js('document.querySelector("[data-issue]").click()')
    tvs = t.until('(document.querySelector(".vph-stepbody")||{}).textContent', 5)
    check("account page: the TV step names the link of the venue the page is showing", tvs == "Check the TV is showing your venue's TV link, venueplay.com.au/tv?mini-bar-burleigh.", tvs)
    t.js('document.querySelector(".vph-still").click()')
    t.until('!!document.getElementById("vphSubject")', 5)
    check('account page: no picker, the page already said which venue', t.js('!document.getElementById("vphPick")') is True)
    t.js('document.getElementById("vphMsg").value="Still black";document.querySelector(".vph-go").click()')
    t.until('!!document.querySelector(".vph-done")', 8)
    bb = ([x for x in posts(t) if x['path'] == '/help/venue/ticket'][-1:] or [{}])[0].get('body', {})
    check('account page: the ticket is for that venue', bb.get('venue_id') == 'aaaaaaaa-0000-4000-8000-000000000002', bb)
    t.close()


def help_page_checks(b, VP):
    """THE PUBLIC HELP PAGE, /help (21 Oct 2026): the real page, the real widget in "page" mode,
    at desktop and phone width. Every ticket goes to the stand-in Worker, never the real one."""
    vp_faq = json.load(open(os.path.join(ROOT, 'venueplay', 'data', 'help-faq.json')))
    for w, h, mobile, tag in ((1280, 900, False, 'desktop'), (375, 740, True, 'phone')):
        print('THE HELP PAGE, /help, ' + tag.upper())
        t = Tab(b, w, h, mobile=mobile, pre=ERRWATCH)
        t.go(VP + '/help')
        loaded = t.until('document.readyState==="complete" && !!document.querySelector("[data-path=venue]")', 15)
        check(tag + ': /help loads the help page (a clean URL, as Pages serves it)', bool(loaded) and 'Help' in (t.js('document.title') or ''), t.js('location.pathname'))
        check(tag + ': in the site\'s look: the home page\'s header logo, its footer with Help in it, its black',
              t.js('(function(){var w=document.querySelector("header .logo .word");return !!w && w.textContent==="VenuePlay" && !!document.querySelector("footer .foot-meta a[href=\'/help\']") && getComputedStyle(document.body).backgroundColor==="rgb(10, 10, 11)" && getComputedStyle(document.querySelector("h1")).fontFamily.indexOf("Anton")>=0;})()') is True)
        check(tag + ': two clear ways in at the top, "I\'m a venue" and "I\'m a player", and the sales way',
              t.js('Array.prototype.map.call(document.querySelectorAll("[data-path]"),function(x){return x.getAttribute("data-path")+":"+(x.querySelector(".t,b")||{}).textContent;}).join("|")') == "venue:I'm a venue|player:I'm a player|sales:Sales: bring VenuePlay to your venue",
              t.js('Array.prototype.map.call(document.querySelectorAll("[data-path]"),function(x){return x.getAttribute("data-path")+":"+(x.querySelector(".t,b")||{}).textContent;}).join("|")'))
        check(tag + ': nothing is open until they choose, and the page says so', t.js('document.getElementById("venue").hidden && document.getElementById("player").hidden && document.getElementById("sales").hidden && !document.getElementById("pickHint").hidden') is True)
        check(tag + ': no sideways scrolling', t.js('document.documentElement.scrollWidth<=window.innerWidth') is True, [t.js('document.documentElement.scrollWidth'), t.js('window.innerWidth')])
        time.sleep(0.6)
        check(tag + ': the page stays at the top on load (the hidden forms never grab focus and scroll it)', t.js('window.scrollY') == 0, t.js('window.scrollY'))
        t.shot('20-help-%s-top' % tag)

        # ---- the venue way ----
        t.js('document.querySelector("[data-path=venue]").click()')
        got = t.until('document.querySelectorAll("#vphFaq-venue details").length || 0', 8)
        check(tag + ' venue: the venue issues and the venue FAQ (%d), open on the page' % len(vp_faq['venue']['items']),
              got == len(vp_faq['venue']['items']) and t.js('document.getElementById("vphFaq-venue").open') is True and
              t.js('Array.prototype.map.call(document.querySelectorAll("#vphFlow-venue .vph-issue"),function(x){return x.textContent;}).join("|")') == '|'.join(i['title'] for i in ISSUES['venueplay:venue']), got)
        check(tag + ' venue: the player panel stays shut, and the address says #venue', t.js('document.getElementById("player").hidden && location.hash==="#venue" && document.querySelector("[data-path=venue]").getAttribute("aria-selected")==="true"') is True)
        # THE SUPPORT PHONE on /help: drawn by the widget into the venue part, as on the console.
        c = page_call(t)
        check(tag + ' venue: "Call us on 07 5228 3667", a tel:+61752283667 link, above the issues, inside the card, no sideways scroll', call_ok(c), c)
        check(tag + ' venue: the call line is the first thing in the venue help, and there is one of it',
              t.js('(function(){var f=document.getElementById("vphFlow-venue");return !!f.firstElementChild&&f.firstElementChild.id==="vphCall-venue"&&document.querySelectorAll("#venue .vph-call").length===1;})()') is True)
        t.shot('21-help-%s-venue' % tag)
        I3 = ISSUES['venueplay:venue'][0]
        t.js('document.querySelector("#vphFlow-venue [data-issue=\'%s\']").click()' % I3['id'])
        st = t.until('(document.querySelector("#vphFlow-venue .vph-stepno")||{}).textContent', 5)
        check(tag + ' venue: the guided steps run in the page, one at a time ("Step 1 of 3")', st == 'Step 1 of 3', st)
        t.shot('21b-help-%s-venue-step' % tag)
        for k in range(3):
            t.until('!!document.querySelector("#vphFlow-venue .vph-still")', 3)
            if k == 1:
                tvs = t.js('document.querySelector("#vphFlow-venue .vph-stepbody").textContent')
                check(tag + " venue: signed out, the TV step says where the venue's link is, never a raw {tv_link}", tvs == "Check the TV is showing your venue's TV link (it is on your Account page).", tvs)
            t.js('document.querySelector("#vphFlow-venue .vph-still").click()')
        t.until('!!document.getElementById("vphMsg-venue")', 5)
        about = t.js('(document.querySelector("#vphFlow-venue .vph-about")||{}).textContent')
        check(tag + ' venue: after the last step the public venue form opens, about that issue, with name, venue, email, kind',
              about == 'About: ' + I3['title'] and all(t.js('!!document.getElementById("%s")' % i) for i in ('vphName-venue', 'vphVenue-venue', 'vphEmail-venue', 'vphKind-venue')), about)
        c = page_call(t)
        check(tag + ' venue: the public venue form has the call line too, inside the form, tappable',
              call_ok(c) and t.js('!!document.querySelector("#vphFlow-venue .vph-form #vphCall-venue")') is True, c)
        check(tag + ' venue: and the small print under Send does not say the number a second time',
              t.js('document.getElementById("vphFine-venue").textContent') == "We'll reply by email.", t.js('document.getElementById("vphFine-venue").textContent'))
        check(tag + ' venue: its kinds are help, billing and sales', t.js('Array.prototype.map.call(document.getElementById("vphKind-venue").options,function(o){return o.value;}).join()') == 'venue_support,accounts,sales')
        t.shot('21c-help-%s-venue-form' % tag)
        t.js('document.getElementById("vphName-venue").value="Sam";document.getElementById("vphEmail-venue").value="sam@royal.com.au";document.getElementById("vphMsg-venue").value="TV black";document.querySelector("#vphFlow-venue .vph-go").click()')
        time.sleep(0.3)
        check(tag + ' venue: no venue named, no send, and it says why', not [x for x in posts(t) if x['path'] == '/help/ticket'] and 'venue' in (t.js('document.querySelector("#vphFlow-venue .vph-err").textContent') or ''))
        t.js('document.getElementById("vphVenue-venue").value="The Royal Hotel, Tugun";document.querySelector("#vphFlow-venue .vph-go").click()')
        done = t.until('(document.querySelector("#vphFlow-venue .vph-done")||{}).textContent', 8)
        post = last_ticket(t)
        body = post.get('body', {})
        check(tag + ' venue: the ticket reaches the Worker as a VENUE ticket, venue support, with the venue typed and the issue',
              body.get('brand') == 'venueplay' and body.get('kind') == 'venue' and body.get('category') == 'venue_support' and body.get('venue') == 'The Royal Hotel, Tugun' and body.get('issue_id') == I3['id'] and body.get('game') == '' and 'Authorization' not in (post.get('headers') or {}), body)
        check(tag + ' venue: and the page shows the ticket number', bool(done) and '#1042' in done, done)
        if tag == 'phone':
            # The other two venue kinds, from "Or send us a message".
            for kind, want_kind, want_cat in (('accounts', 'venue', 'accounts'), ('sales', 'sales', 'sales')):
                t.go(VP + '/help?k=' + kind + '#venue')   # a fresh load: a bare #venue is the same page
                t.until('!!document.querySelector("#vphFlow-venue .vph-msg")', 10)
                t.js('document.querySelector("#vphFlow-venue .vph-msg").click()')
                t.until('!!document.getElementById("vphKind-venue")', 5)
                t.js('document.getElementById("vphKind-venue").value="%s";document.getElementById("vphName-venue").value="Sam";document.getElementById("vphVenue-venue").value="The Royal";document.getElementById("vphEmail-venue").value="sam@royal.com.au";document.getElementById("vphMsg-venue").value="Question";document.querySelector("#vphFlow-venue .vph-go").click()' % kind)
                t.until('!!document.querySelector("#vphFlow-venue .vph-done")', 8)
                bb = last_ticket(t).get('body', {})
                check('phone venue: "%s" reaches the Worker as kind %s, category %s' % (kind, want_kind, want_cat), bb.get('kind') == want_kind and bb.get('category') == want_cat, bb)

        # ---- the player way ----
        t.go(VP + '/help')
        t.until('!!document.querySelector("[data-path=player]") && !!document.querySelector("#vphFlow-patron .vph-msg")', 10)
        t.js('document.querySelector("[data-path=player]").click()')
        got = t.until('document.querySelectorAll("#vphFaq-patron details").length || 0', 8)
        check(tag + ' player: the player issues and the player FAQ (%d), open on the page' % len(vp_faq['patron']['items']),
              got == len(vp_faq['patron']['items']) and t.js('document.getElementById("vphFaq-patron").open') is True and
              'My game is not showing' in (t.js('document.getElementById("vphFlow-patron").textContent') or ''), got)
        check(tag + ' player: the venue panel is shut, and the player FAQ holds the claim-from-the-host rule', t.js('document.getElementById("venue").hidden') is True and 'claimed from the host, never the bar' in (t.js('document.getElementById("vphFaq-patron").textContent') or ''))
        check(tag + ' player: no sideways scrolling with the FAQ open', t.js('document.documentElement.scrollWidth<=window.innerWidth') is True)
        t.shot('22-help-%s-player' % tag)
        check(tag + ' player: no support phone number or tel: link anywhere in the player help (players use Help; the menu sends them to voicemail)', no_phone_in(t, '#player') is True)
        check(tag + ': and none in this page\'s footer, which a player reads too', no_phone_in(t, 'footer') is True)
        t.js('document.querySelector("#vphFlow-patron .vph-msg").click()')
        t.until('!!document.getElementById("vphMsg-patron")', 5)
        t.js('document.getElementById("vphVenue-patron").value="ryl234";document.getElementById("vphEmail-patron").value="jo@example.com";document.getElementById("vphMsg-patron").value="My tickets vanished";document.querySelector("#vphFlow-patron .vph-go").click()')
        done = t.until('(document.querySelector("#vphFlow-patron .vph-done")||{}).textContent', 8)
        bb = last_ticket(t).get('body', {})
        check(tag + ' player: the ticket reaches the Worker as a PATRON ticket, the room code from what they typed, no game guessed',
              bb.get('kind') == 'patron' and bb.get('brand') == 'venueplay' and bb.get('code') == 'RYL234' and bb.get('game') == '' and not bb.get('category'), bb)
        check(tag + ' player: and shows the ticket number', bool(done) and '#1042' in done, done)
        t.js('document.querySelector("#vphFlow-patron .vph-back").click()')
        t.until('!!document.querySelector("#vphFlow-patron .vph-msg")', 5)
        t.js('document.querySelector("#vphFlow-patron .vph-msg").click()')
        t.until('!!document.getElementById("vphMsg-patron")', 5)
        check(tag + ' player: the player form has no phone line either', no_phone_in(t, '#player') is True and t.js('!document.getElementById("vphCall-patron")') is True)
        t.shot('23-help-%s-player-sent' % tag)

        # ---- the sales way ----
        t.js('window.scrollTo(0,0)')
        t.js('document.querySelector("[data-path=sales]").click()')
        t.until('!document.getElementById("sales").hidden', 3)
        check(tag + ' sales: the enquiry form is on the page', t.js('!!document.getElementById("vphMsg-sales")') is True)
        check(tag + ' sales: and it never asks the player question "Where were you playing?"',
              t.js('!document.getElementById("vphVenue-sales") && !/Where were you playing/.test(document.getElementById("sales").textContent)') is True)
        sr = t.js('(function(){var a=document.querySelector("#sales .reach a[href^=\'tel:\']");if(!a)return null;var r=a.getBoundingClientRect();return {href:a.getAttribute("href"),text:a.textContent,shown:r.width>0&&r.height>0,one:document.querySelectorAll("#sales a[href^=\'tel:\']").length===1,line:a.parentNode.textContent};})()')
        # 23 Oct 2026: the sales form names the sales mailbox, and the public pages no longer carry the number, so
        # this is the one public place a prospective venue is given it.
        check(tag + ' sales: under the form, "or call 07 5228 3667", tappable, once, beside sales@venueplay.com.au',
              bool(sr) and sr['href'] == 'tel:+61752283667' and sr['text'] == '07 5228 3667' and sr['shown'] and sr['one'] and sr['line'] == 'Or email sales@venueplay.com.au, or call 07 5228 3667.', sr)
        t.shot('24-help-%s-sales' % tag)
        t.js('document.getElementById("vphName-sales").value="Lee";document.getElementById("vphEmail-sales").value="lee@pub.com.au";document.getElementById("vphMsg-sales").value="Pricing for two venues?";document.querySelector("#sales .vph-go").click()')
        t.until('!!document.querySelector("#sales .vph-done")', 8)
        bb = last_ticket(t).get('body', {})
        check(tag + ' sales: the ticket reaches the Worker as a SALES ticket', bb.get('kind') == 'sales' and bb.get('brand') == 'venueplay' and bb.get('name') == 'Lee', bb)
        errs = t.js('window.__errs') or []
        bad = t.js(OWN_FILES_BAD) or []
        check(tag + ': no console errors and none of the site\'s own files failed to load', not errs and not bad, errs + bad)
        t.close()
    # /support is the other word people try. Pages serves _redirects; this little server does not,
    # so the rule itself is read, the way test-platform-15-oct.js reads it.
    rules = [l.split() for l in open(os.path.join(ROOT, 'venueplay', '_redirects')).read().splitlines() if l.strip() and not l.strip().startswith('#')]
    check('/support sends people to /help (a 301 in _redirects)', ['/support', '/help', '301'] in rules, [r for r in rules if r and r[0].startswith('/support')])


def main():
    if not os.path.exists(vl.CHROME):
        check('Google Chrome is installed (this suite needs a real browser)', False, vl.CHROME)
        return
    vp_srv, VP = serve(os.path.join(ROOT, 'venueplay'))
    pp_srv, PP = serve(os.path.join(ROOT, 'partyplay'))
    b = vl.Browser()
    try:
        vp_faq = json.load(open(os.path.join(ROOT, 'venueplay', 'data', 'help-faq.json')))
        pp_faq = json.load(open(os.path.join(ROOT, 'partyplay', 'data', 'help-faq.json')))

        print('VENUEPLAY BINGO PHONE, 375 WIDE, A DEMO NIGHT WITH THE BINGO BUTTON ON SCREEN')
        t = Tab(b)
        t.go(VP + '/play?demo=1')
        on = t.until('(function(){var x=document.getElementById("bingoBtn");return !!(x&&x.offsetParent&&x.getBoundingClientRect().height>20);})()', 25)
        check('bingo phone: the demo night reaches the ticket and the BINGO button', bool(on))
        t.until('!!document.getElementById("vphLink")', 5)
        m = link_checks(t, 'bingo phone')
        check('bingo phone: the Help link is below the BINGO button, never on it', m and m.get('below') is not None and m['below'] >= 0, m and m.get('below'))
        t.js('window.scrollTo(0,0)')
        t.shot('01-bingo-phone-top')
        t.js('document.getElementById("vphLink").scrollIntoView({block:"end"})')
        t.shot('02-bingo-phone-help-link')
        check('bingo phone: Help is also in the phone menu, above Leave game',
              t.js('(function(){var m=document.getElementById("vphMenu"),l=document.getElementById("leaveBtn");return !!(m&&l&&m.parentNode===l.parentNode&&m.nextElementSibling===l);})()') is True)
        panel_checks(t, 'bingo phone', len(vp_faq['patron']['items']), 'Help')
        t.shot('03-bingo-phone-help-panel')
        I1 = ISSUES['venueplay:patron'][0]
        STEPS1 = [x['id'] for x in I1['steps']]
        t.js('document.querySelector("[data-issue=\'%s\']").click()' % I1['id'])
        t.until('!!document.querySelector(".vph-step")', 5)
        one = t.js('(function(){var s=document.querySelectorAll(".vph-step");return {n:s.length,no:(document.querySelector(".vph-stepno")||{}).textContent,body:(document.querySelector(".vph-stepbody")||{}).textContent,text:document.getElementById("vphFlow").textContent,faq:!!document.getElementById("vphFaq"),form:!!document.getElementById("vphMsg")};})()')
        check('triage: picking an issue shows ONE step, "Step 1 of 4"', one['n'] == 1 and one['no'] == 'Step 1 of 4' and one['body'] == 'Pull down to refresh the page.', one)
        check('triage: and nothing else: not the next steps, not the FAQ, not the form', 'Step body 1.2' not in one['text'] and 'Ask the host' not in one['text'] and not one['faq'] and not one['form'], one)
        check('triage: two answers only, "Fixed it" and "Still not working"', t.js('Array.prototype.map.call(document.querySelectorAll(".vph-steprow button"),function(b){return b.textContent}).join()') == 'Fixed it,Still not working')
        P = posts(t)
        check('triage: picking it is counted (start)', P and P[-1]['path'] == '/help/triage' and P[-1]['body'].get('kind') == 'start' and P[-1]['body'].get('issue_id') == I1['id'], P[-1:] )
        t.shot('03b-bingo-phone-step-1')
        t.js('document.querySelector(".vph-still").click()')
        two = t.until('(document.querySelector(".vph-stepno")||{}).textContent', 5)
        P = posts(t)
        check('triage: "Still not working" brings step 2, and only step 2', two == 'Step 2 of 4' and t.js('document.querySelector(".vph-stepbody").textContent') == 'Step body 1.2' and t.js('document.querySelectorAll(".vph-step").length') == 1, two)
        check('triage: and counts "not fixed" for step 1', P[-1]['body'].get('kind') == 'not_fixed' and P[-1]['body'].get('step_id') == STEPS1[0], P[-1])
        check('triage: the answer carries the proof its issue\'s start was given', P[-1]['body'].get('proof') == 'proof-from-start' and len(P[-1]['body'].get('device') or '') >= 16, P[-1]['body'])
        t.js('document.querySelector(".vph-fixed").click()')
        done = t.until('(document.querySelector(".vph-done")||{}).textContent', 5)
        P = posts(t)
        check('triage: "Fixed it" thanks them and stops there', bool(done) and 'glad that sorted it' in done and t.js('!document.getElementById("vphMsg")') is True, done)
        check('triage: and counts "fixed" for step 2', P[-1]['body'].get('kind') == 'fixed' and P[-1]['body'].get('step_id') == STEPS1[1], P[-1])
        t.js('document.querySelector("#vphFlow .vph-go").click()')
        check('triage: Done closes Help', t.until('!document.getElementById("vphBg")', 3) is True)
        t.js('document.getElementById("vphLink").click()')
        t.until('!!document.querySelector("[data-issue]")', 5)
        t.js('document.querySelector("[data-issue=\'%s\']").click()' % I1['id'])
        for k in range(3):
            t.until('!!document.querySelector(".vph-still")', 3)
            t.js('document.querySelector(".vph-still").click()')
        four = t.until('(document.querySelector(".vph-stepno")||{}).textContent', 3)
        check('triage: the last step is the pinned one, "Ask the host", Step 4 of 4', four == 'Step 4 of 4' and 'Ask the host' in (t.js('document.querySelector(".vph-stepbody").textContent') or ''), four)
        t.js('document.querySelector(".vph-still").click()')
        about = t.until('(document.querySelector(".vph-about")||{}).textContent', 5)
        check('triage: after the last "Still not working", the form opens, already about that issue', about == 'About: My game is not showing' and t.js('!!document.getElementById("vphMsg") && !document.querySelector(".vph-step")') is True, about)
        t.shot('03c-bingo-phone-form-after-steps')
        check('bingo phone: no support phone number or tel: link anywhere, Help and its form included (players use Help)', t.js(NO_PHONE) is True)
        check('bingo phone: the privacy line links the privacy policy', t.js('Array.prototype.some.call(document.querySelectorAll(".vph-fine a"), function(a){ return a.getAttribute("href")==="/privacy"; })') is True)
        n_before = len(posts(t))
        t.js('document.getElementById("vphMsg").value="My tickets are not showing";document.querySelector(".vph-go").click()')
        time.sleep(0.4)
        check('bingo phone: no email, no send, and it says why', len(posts(t)) == n_before and 'email' in (t.js('document.querySelector(".vph-err").textContent') or ''))
        # On a real night connect(room) writes the room into #roomLabel, and that is what the widget
        # reads. The scripted demo never connects, so do here exactly what connect() does.
        t.js('document.getElementById("roomLabel").textContent="RYL234"')
        t.js('document.getElementById("vphEmail").value="jo@example.com";document.getElementById("vphName").value="Jo";document.querySelector(".vph-go").click()')
        done = t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        post = (t.js('window.__posts') or [{}])[-1]
        body = post.get('body', {})
        check('bingo phone: the form posts a patron ticket to /help/ticket', post.get('path') == '/help/ticket' and body.get('brand') == 'venueplay' and body.get('kind') == 'patron', post)
        check('triage: the ticket carries the issue, so the desk names it and picks its kind', body.get('issue_id') == I1['id'], body)
        check('bingo phone: the room code and the game ride along, the honeypot is empty, a device id is sent',
              body.get('code') == 'RYL234' and body.get('game') == 'bingo' and body.get('website') == '' and len(body.get('device') or '') >= 16, body)
        check('bingo phone: no login token is sent from a patron page', 'Authorization' not in (post.get('headers') or {}), post.get('headers'))
        check('bingo phone: "Thanks, we\'ll email you" with the ticket number', bool(done) and "Thanks, we'll email you" in done and '#1042' in done, done)
        t.shot('04-bingo-phone-sent')
        t.js('document.querySelector(".vph-x").click()')
        check('bingo phone: the panel closes and the game is back', t.js('!document.getElementById("vphBg") && !!document.getElementById("bingoBtn").offsetParent') is True)
        t.js('document.getElementById("vphLink").click()')
        t.until('!!document.querySelector("[data-issue]")', 5)
        t.js('document.querySelector("[data-issue=\'%s\']").click()' % ISSUES['venueplay:patron'][1]['id'])
        check('triage: an issue with no steps ("Something else") goes straight to the form', t.until('!!document.getElementById("vphMsg")', 4) is True and t.js('!document.querySelector(".vph-step")') is True)
        t.close()

        for path, name in (('/app/musical/play?demo=1', 'musical phone'), ('/app/trivia/play?demo=1', 'trivia phone')):
            print(name.upper())
            # The musical phone also proves the fallback: the Worker cannot be reached, so Help shows the
            # FAQ that ships with the site, open, and the form, and no guided steps.
            down = {'/help/content?brand=venueplay&audience=patron': {'status': 500, 'body': {}}} if 'musical' in name else None
            t = Tab(b, routes=down)
            t.go(VP + path)
            t.until('!!document.getElementById("vphLink")', 15)
            time.sleep(1.5)
            link_checks(t, name)
            t.shot(('05-' if 'musical' in name else '06-') + name.replace(' ', '-'))
            check(name + ': Help is in the phone menu too', t.js('!!document.getElementById("vphMenu")') is True)
            t.js('document.getElementById("vphLink").click()')
            t.until('!!document.querySelector(".vph-msg")', 8)
            t.js('document.querySelector(".vph-msg").click()')
            t.until('!!document.getElementById("vphMsg")', 4)
            check(name + ': no support phone number or tel: link, on the page, in Help or in its form', t.js(NO_PHONE) is True)
            t.js('document.querySelector(".vph-x").click()')
            if down:
                t.js('document.getElementById("vphLink").click()')
                got = t.until('document.querySelectorAll("#vphFaq details").length || 0', 8)
                check('Worker down: Help still shows the FAQ from the site, open, and a way to send a message, with no steps',
                      got == len(vp_faq['patron']['items']) and t.js('document.getElementById("vphFaq").open') is True and t.js('!document.querySelector(".vph-issue") && !!document.querySelector(".vph-msg")') is True, got)
            t.close()

        print('VENUEPLAY CONSOLE HEADER (the venue form)')
        t = Tab(b, 390, 800)
        t.go(VP + '/__fixture/venue.html')
        check('venue: a Help button sits in the header beside Account', t.until('(function(){var x=document.getElementById("vphLink");return !!x&&x.parentNode.className==="hactions"&&x.nextElementSibling.textContent==="Account";})()', 8) is True)
        panel_checks(t, 'venue', len(vp_faq['venue']['items']), 'venues')
        t.shot('07-venue-help-panel')
        c = t.js(CALL_LINE)
        check('venue: Help opens with "Call us on 07 5228 3667", a tel:+61752283667 link, inside the panel, no sideways scroll', call_ok(c), c)
        check('venue: the call line is first, above the issues', t.js('(function(){var f=document.getElementById("vphFlow");return !!f.firstElementChild&&f.firstElementChild.id==="vphCall";})()') is True)
        t.js('document.getElementById("vphFaq").open=true;Array.prototype.forEach.call(document.querySelectorAll("#vphFaq details"),function(d){d.open=true;})')
        check('venue: the FAQ says to call 07 5228 3667 and press 2 if a game is on right now',
              'call 07 5228 3667 and press 2' in (t.js('document.getElementById("vphFaq").textContent') or ''))
        t.js('document.getElementById("vphFaq").open=false')
        I3 = ISSUES['venueplay:venue'][0]
        t.js('document.querySelector("[data-issue=\'%s\']").click()' % I3['id'])
        for k in range(3):
            t.until('!!document.querySelector(".vph-still")', 3)
            if k == 0:
                t.shot('07b-venue-step-1')
            if k == 1:
                tvs = t.js('document.querySelector(".vph-stepbody").textContent')
                check("venue: the TV step names this venue's own TV link", tvs == "Check the TV is showing your venue's TV link, venueplay.com.au/tv?royal.", tvs)
            t.js('document.querySelector(".vph-still").click()')
        t.until('!!document.getElementById("vphSubject")', 5)
        check('venue: after the steps, the form opens with the issue as the subject', t.js('document.getElementById("vphSubject").value') == I3['title'], t.js('document.getElementById("vphSubject").value'))
        c = t.js(CALL_LINE)
        check('venue: the contact form has "Call us on 07 5228 3667" beside it, tappable', call_ok(c) and t.js('!!document.querySelector(".vph-form #vphCall")') is True, c)
        t.shot('07c-venue-form-call-line')
        # Dean, 21 Oct 2026: no "Happening now" tick (the Worker marks it urgent when a game is on), and a
        # login with no email (hosts sign in by phone) is ASKED for one, because HQ replies by email only.
        check('venue: there is no "Happening now" tick any more', t.js('!document.getElementById("vphUrgent") && !document.querySelector("#vphFlow input[type=checkbox]") && !/happening (right )?now/i.test(document.getElementById("vphFlow").textContent)') is True)
        lab = t.until('(function(){var r=document.getElementById("vphReply");var l=r&&r.parentNode.querySelector("label");return l&&l.textContent!=="Reply to (optional)"?l.textContent:"";})()', 5)
        check('venue: this login has no email, so the reply address is asked for, not optional', lab == 'Your email, so we can reply', lab)
        check('venue: and no venue picker: the console knows its venue', t.js('!document.getElementById("vphPick")') is True)
        t.shot('07c-venue-form')
        fine = t.js('(function(){var f=document.getElementById("vphFine"),p=document.querySelector(".vph-priv a");return {t:f&&f.textContent,priv:p&&p.getAttribute("href"),sep:!!(p&&f&&!f.contains(p))};})()') or {}
        check('venue: the small print is one clean sentence, with the privacy policy as its own small link',
              fine.get('t') == "We'll reply by email." and fine.get('priv') == '/privacy' and fine.get('sep') is True, fine)
        t.js('document.getElementById("vphSubject").value="";document.getElementById("vphMsg").value="TV blank";document.querySelector(".vph-go").click()')
        time.sleep(0.3)
        check('venue: no subject, no send', not [x for x in posts(t) if x['path'] == '/help/venue/ticket'])
        t.js('document.getElementById("vphSubject").value="TV not showing";document.getElementById("vphKind").value="accounts";document.querySelector(".vph-go").click()')
        time.sleep(0.3)
        check('venue: no reply email from a login that has none: no send, and it says why', not [x for x in posts(t) if x['path'] == '/help/venue/ticket'] and 'email' in (t.js('document.querySelector(".vph-err").textContent') or ''))
        t.js('document.getElementById("vphReply").value="hayley@example.com";document.querySelector(".vph-go").click()')
        done = t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        post = (t.js('window.__posts') or [{}])[-1]
        body = post.get('body', {})
        check('venue: posts to /help/venue/ticket with the venue, the kind and the reply address, and no say on urgency',
              post.get('path') == '/help/venue/ticket' and body.get('venue_id') == '11111111-2222-4333-8444-555555555555' and body.get('category') == 'accounts' and body.get('reply_email') == 'hayley@example.com' and 'urgent' not in body, post)
        check('venue: with the signed-in login\'s token', (post.get('headers') or {}).get('Authorization') == 'Bearer venue-login-token', post.get('headers'))
        check('venue: shows the ticket number', bool(done) and '#1042' in done, done)
        check('venue: the ticket carries the issue the steps were for', body.get('issue_id') == I3['id'], body)
        t.js('window.__routes["/help/venue/ticket"]={status:429,body:{error:"That is a lot of requests in an hour."}};document.querySelector(".vph-x").click();document.getElementById("vphLink").click()')
        t.until('!!document.querySelector(".vph-msg")', 5)
        to_form(t)
        t.js('document.getElementById("vphSubject").value="x";document.getElementById("vphMsg").value="y";document.getElementById("vphReply").value="hayley@example.com";document.querySelector(".vph-go").click()')
        err = t.until('(document.querySelector(".vph-err")||{}).textContent', 5)
        check('venue: a refusal from the Worker is shown in its own words, and Send works again',
              err == 'That is a lot of requests in an hour.' and t.js('document.querySelector(".vph-go").disabled') is False, err)
        t.close()

        group_checks(b, VP)
        help_page_checks(b, VP)

        print('PARTYPLAY GUEST PHONE')
        t = Tab(b)
        t.go(PP + '/play?code=KFP7QX')
        t.until('!!document.getElementById("vphLink")', 15)
        time.sleep(1.0)
        link_checks(t, 'partyplay guest')
        t.js('["cam","vid"].forEach(function(i){var e=document.getElementById(i);if(e)e.hidden=false;})')
        m = t.js(MEASURE)
        check('partyplay guest: the camera and video buttons, when showing, do not cover it', m and m['hits'] == [] and m['centre'], m and m['hits'])
        panel_checks(t, 'partyplay guest', len(pp_faq['guest']['items']), 'Help')
        t.shot('08-partyplay-guest-panel')
        check('partyplay guest: its own issues ("I cannot join the party")', 'I cannot join the party' in (t.js('document.getElementById("vphFlow").textContent') or ''))
        to_form(t)
        check('partyplay guest: the panel says support@partyplay.com.au, not VenuePlay', 'support@partyplay.com.au' in (t.js('document.body.textContent') or '') and 'venueplay.com.au' not in (t.js('(document.getElementById("vphBg")||document.body).textContent') or ''))
        t.js('document.getElementById("vphEmail").value="guest@example.com";document.getElementById("vphMsg").value="Cannot join";document.querySelector(".vph-go").click()')
        t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        body = ((t.js('window.__posts') or [{}])[-1]).get('body', {})
        check('partyplay guest: a PartyPlay guest ticket with the party code', body.get('brand') == 'partyplay' and body.get('kind') == 'patron' and body.get('code') == 'KFP7QX', body)
        check('partyplay guest: no VenuePlay support phone anywhere', t.js(NO_PHONE) is True)
        t.close()

        print('PARTYPLAY HOST CONSOLE')
        t = Tab(b, 390, 800)
        t.go(PP + '/host?code=KFP7QX&key=abc')
        check('partyplay host: Help sits in the top bar', t.until('(function(){var x=document.getElementById("vphLink");return !!x&&x.parentNode.className==="top";})()', 10) is True)
        panel_checks(t, 'partyplay host', len(pp_faq['host']['items']), 'hosts')
        t.shot('09-partyplay-host-panel')
        check('partyplay host: its own issues ("The party screen is blank")', 'The party screen is blank' in (t.js('document.getElementById("vphFlow").textContent') or ''))
        to_form(t)
        check('partyplay host: no VenuePlay support phone, in Help or its form', t.js(NO_PHONE) is True)
        t.js('document.getElementById("vphEmail").value="host@example.com";document.getElementById("vphMsg").value="The TV is blank";document.querySelector(".vph-go").click()')
        t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        post = (t.js('window.__posts') or [{}])[-1]
        body = post.get('body', {})
        check('partyplay host: a PartyPlay host ticket with the party code, and the host key is NOT sent', body.get('brand') == 'partyplay' and body.get('kind') == 'host' and body.get('code') == 'KFP7QX' and 'abc' not in json.dumps(post), body)
        t.close()

        print('PARTYPLAY HOME PAGE CONTACT FORM')
        t = Tab(b, 390, 900)
        t.go(PP + '/')
        check('partyplay home: the contact form is drawn where the page asks', t.until('!!document.querySelector("#ppContact .vph-form")', 10) is True)
        t.js('(function(){var e=document.getElementById("ppContact");document.documentElement.style.scrollBehavior="auto";window.scrollTo(0,e.getBoundingClientRect().top+window.pageYOffset-120);})()')
        time.sleep(0.5)
        t.shot('10-partyplay-home-contact')
        t.js('document.getElementById("vphName").value="Pat";document.getElementById("vphEmail").value="pat@example.com";document.getElementById("vphPhone").value="0400 111 222";document.getElementById("vphMsg").value="Can I book for 60?";document.querySelector(".vph-go").click()')
        done = t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        body = ((t.js('window.__posts') or [{}])[-1]).get('body', {})
        check('partyplay home: a PartyPlay sales enquiry with the phone number', body.get('brand') == 'partyplay' and body.get('kind') == 'sales' and body.get('phone') == '0400 111 222', body)
        check('partyplay home: and the number comes back', bool(done) and '#1042' in done, done)
        check('partyplay home: no sideways scrolling', t.js('document.documentElement.scrollWidth<=window.innerWidth') is True)
        t.close()

        print('TURNSTILE ON THE PUBLIC FORMS (stand-in Turnstile: the gate never depends on Cloudflare)')
        FAKE_TS = ("window.turnstile={_opts:null,_tok:'',_resets:0,render:function(el,o){this._opts=o;el.setAttribute('data-ts','1');return 'w1';},"
                   "getResponse:function(){return this._tok;},reset:function(){this._resets++;}};")
        ts_routes = {'/help/content?brand=partyplay&audience=guest': {'body': dict(DEFAULT_ROUTES['/help/content?brand=partyplay&audience=guest']['body'], turnstile='0x4AAA-test-site')}}
        t = Tab(b, pre=FAKE_TS, routes=ts_routes)
        t.go(PP + '/play?code=KFP7QX')
        t.until('!!document.getElementById("vphLink")', 15)
        t.js('document.getElementById("vphLink").click()')
        t.until('!!document.querySelector(".vph-msg")', 8)
        to_form(t)
        opts = t.until('window.turnstile._opts', 5)
        check('turnstile: with a site key from the Worker, the form shows the managed check above Send', bool(opts) and opts.get('sitekey') == '0x4AAA-test-site' and opts.get('appearance') == 'interaction-only' and t.js('!!document.querySelector(".vph-ts[data-ts]")') is True, opts)
        n0 = len(posts(t))
        t.js('document.getElementById("vphEmail").value="g@example.com";document.getElementById("vphMsg").value="Hi";document.querySelector(".vph-go").click()')
        time.sleep(0.3)
        check('turnstile: until it has answered, Send says to wait and sends nothing', len([x for x in posts(t)[n0:] if x['path'] == '/help/ticket']) == 0 and 'check you are a person' in (t.js('document.querySelector(".vph-err").textContent') or ''))
        t.js('window.turnstile._tok="ts-token-123";document.querySelector(".vph-go").click()')
        t.until('(document.querySelector(".vph-done")||{}).textContent', 5)
        tb = [x for x in posts(t) if x['path'] == '/help/ticket'][-1]['body']
        check('turnstile: its answer goes with the ticket for the Worker to check', tb.get('turnstile') == 'ts-token-123', tb)
        t.close()
        t = Tab(b, 390, 900, pre=FAKE_TS, routes={'/help/config?brand=partyplay': {'body': {'turnstile': '0x4AAA-test-site'}},
                                                   '/help/ticket': {'status': 403, 'body': {'error': 'Please complete the check above Send, then try again.', 'turnstile': True}}})
        t.go(PP + '/')
        t.until('!!document.querySelector("#ppContact .vph-form")', 10)
        check('turnstile: the PartyPlay home page form gets its key from /help/config', t.until('window.turnstile._opts && window.turnstile._opts.sitekey', 5) == '0x4AAA-test-site')
        t.js('window.turnstile._tok="t";document.getElementById("vphName").value="Pat";document.getElementById("vphEmail").value="pat@example.com";document.getElementById("vphMsg").value="Hi";document.querySelector(".vph-go").click()')
        err = t.until('(document.querySelector(".vph-err")||{}).textContent', 5)
        check('turnstile: when the Worker refuses the check, the person is told, and the check resets for another go', err == 'Please complete the check above Send, then try again.' and t.js('window.turnstile._resets') == 1, err)
        t.close()
        t = Tab(b)
        t.go(VP + '/play?demo=1')
        t.until('!!document.getElementById("vphLink")', 15)
        t.js('document.getElementById("vphLink").click()')
        t.until('!!document.querySelector(".vph-msg")', 8)
        to_form(t)
        time.sleep(0.4)
        check('turnstile: with no key from the Worker, nothing is loaded and the form is as before', t.js('!window.turnstile && !document.querySelector("script[src*=turnstile]") && !document.querySelector(".vph-ts[data-ts]")') is True)
        t.close()

        print('HQ: THE HELP DESK TAB, IN THE REAL hq.html WITH ITS OWN STYLES')
        routes = {
            '/admin/help/count': {'body': {'new': 2, 'urgent': 1}},
            '/admin/help/list': {'body': {'tickets': [
                {'id': 'a1', 'ticket_no': 1001, 'brand': 'venueplay', 'category': 'patron_support', 'channel': 'patron_form', 'status': 'new', 'priority': 'urgent', 'venue_id': 'v1', 'subject': 'Tickets not showing', 'created_at': '2026-10-19T09:00:00Z'},
                {'id': 'a2', 'ticket_no': 1002, 'brand': 'partyplay', 'category': 'venue_support', 'channel': 'patron_form', 'status': 'open', 'priority': 'normal', 'room_code': 'KFP7QX', 'subject': 'TV blank', 'created_at': '2026-10-19T10:00:00Z'},
                {'id': 'a3', 'ticket_no': 1003, 'brand': 'venueplay', 'category': 'accounts', 'channel': 'email', 'status': 'waiting', 'priority': 'normal', 'venue_id': 'v1', 'subject': 'Invoice question', 'created_at': '2026-10-18T22:10:00Z'}],
                'venues': {'v1': 'The Royal Hotel'}, 'assignees': ['Dean'], 'all_venues': [{'id': 'v1', 'name': 'The Royal Hotel'}]}},
            '/admin/help/get': {'body': {'ticket': {'id': 'a2', 'ticket_no': 1002, 'brand': 'partyplay', 'category': 'venue_support', 'channel': 'patron_form', 'status': 'open', 'priority': 'normal',
                'subject': 'TV blank', 'message': 'The TV is blank since we pressed start.', 'contact_name': 'Pat', 'contact_email': 'host@example.com', 'room_code': 'KFP7QX', 'created_at': '2026-10-19T10:00:00Z',
                'contact_typed': True, 'contact_email_pending': 'pat@work.example.com'},
                'notes': [{'kind': 'change', 'body': 'Opened by Dean', 'author': 'Dean', 'created_at': '2026-10-19T10:05:00Z'},
                          {'kind': 'reply', 'body': 'Try reloading the party screen.', 'author': 'Dean (from support@partyplay.com.au)', 'created_at': '2026-10-19T10:07:00Z'}], 'venue_name': ''}},
            '/admin/help/report': {'body': {'from': '2026-10-01', 'to': '2026-10-19', 'rows': [], 'venues': {}, 'report': {'total': 3, 'by_brand': {'venueplay': 2, 'partyplay': 1},
                'by_brand_category': {'venueplay:sales': 2, 'partyplay:venue_support': 1}, 'by_category': {}, 'by_channel': {'phone': 2, 'web_form': 1}, 'by_status': {'closed': 3},
                'closed': 3, 'avg_hours_to_close': 6, 'longest_hours_to_close': 10, 'longest_ticket_no': 2, 'top_venues': [{'name': 'The Royal Hotel', 'count': 2}]},
                'triage': [{'issue_id': 'i1', 'title': 'My game is not showing', 'brand': 'venueplay', 'started': 42, 'solved': 31, 'tickets': 4, 'left': 7,
                            'by_step': {'Pull down to refresh the page.': 22, 'Check your phone is online.': 9}}]}},
            '/admin/help/content/get': {'body': {
                'faq': [{'id': 'f1', 'question': 'How do I join a game?', 'answer': 'Scan the QR code.', 'hidden': False},
                        {'id': 'f2', 'question': 'Who gives out the prizes?', 'answer': 'The venue.', 'hidden': True}],
                'issues': [{'id': 'i1', 'title': 'My game is not showing', 'category': 'patron_support', 'hidden': False, 'auto_order': True, 'steps': [
                    {'id': 's1', 'body': 'Pull down to refresh the page.', 'pinned': False, 'hidden': False, 'tries': 64, 'fixes': 22, 'rate': 34.4, 'flagged': False},
                    {'id': 's2', 'body': 'Check your phone is online.', 'pinned': False, 'hidden': False, 'tries': 42, 'fixes': 9, 'rate': 21.4, 'flagged': False},
                    {'id': 's3', 'body': 'Turn it off and on again.', 'pinned': False, 'hidden': False, 'tries': 33, 'fixes': 1, 'rate': 3.0, 'flagged': True},
                    {'id': 's4', 'body': 'Ask the host. They can see who has joined and can get you going.', 'pinned': True, 'hidden': False, 'tries': 32, 'fixes': 20, 'rate': 62.5, 'flagged': False}]},
                    {'id': 'i2', 'title': 'Something else', 'category': 'patron_support', 'hidden': False, 'auto_order': True, 'steps': []}],
                'reorders': [{'id': 'r1', 'created_at': '2026-10-19T03:00:00Z', 'issue_id': 'i1', 'before_ids': ['s2', 's1', 's3', 's4'], 'after_ids': ['s1', 's2', 's3', 's4'],
                              'reason': 'By how often each step fixed it: 1. 34% of 64, 2. 21% of 42, 3. 3% of 33, 4. 63% of 32', 'undone_at': None}],
                'rules': {'min_tries': 20, 'flag_tries': 30, 'flag_rate': 0.05}}},
        }
        # Only the sign-in is stood in: vp-session.js and the Supabase library are blocked, and this
        # VP answers as a signed-in HQ owner whose every database read comes back empty. Everything
        # else (hq.html's markup, its stylesheet, its own scripts) is the real page.
        FAKE_HQ_LOGIN = (
            "(function () {"
            " function q() { var res = { data: [], error: null, count: 0 }, o;"
            "  o = new Proxy(function () {}, { get: function (t, k) { if (k === 'then') { var p = Promise.resolve(res); return p.then.bind(p); }"
            "   if (k === 'catch') { var p2 = Promise.resolve(res); return p2.catch.bind(p2); } return function () { return o; }; }, apply: function () { return o; } });"
            "  return o; }"
            " var client = { from: q, rpc: q, storage: { from: q }, channel: function () { return { on: function () { return this; }, subscribe: function () { return this; }, send: function () {} }; },"
            "  removeChannel: function () {}, auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'hq-admin-token', user: { id: 'u1' } } } }); },"
            "   getUser: function () { return Promise.resolve({ data: { user: { id: 'u1' } } }); }, onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; } } };"
            " window.VP = { getClient: function () { return client; }, requireAuth: function () { return Promise.resolve({ isAdmin: true, adminRole: 'owner', client: client, user: { id: 'u1' }, staff: [] }); },"
            "  guardShift: function () {}, homeHref: function () { return '/app/'; }, signOut: function () {}, listVenues: function () { return Promise.resolve([]); }, setCurrentVenue: function () {} };"
            "})();")
        LIGHT = ('(function(sel){ var bad=[]; Array.prototype.forEach.call(document.querySelectorAll(sel), function(e){'
                 ' var c=getComputedStyle(e).backgroundColor.match(/[0-9]+/g)||[255,255,255]; if (+c[0]+ +c[1]+ +c[2] > 200) bad.push(e.id||e.tagName); }); return bad; })')

        def hq_tab(w, h, mobile):
            t = Tab(b, w, h, mobile=mobile, pre=FAKE_HQ_LOGIN, routes=routes)
            b.call('Network.setBlockedURLs', {'urls': ['*cdn.jsdelivr.net*', '*vp-session.js*', '*workers.dev*', '*googletagmanager*', '*facebook*']}, session=t.sid)
            t.go(VP + '/app/hq.html')
            return t
        t = hq_tab(1280, 900, False)
        badge = t.until('(function(){var b=document.getElementById("hdBadge");return b&&!b.hidden?b.textContent:"";})()', 12)
        check('hq: a Help desk tab in the real HQ nav, with the count of new tickets and urgent called out', badge == '2 (1 urgent)', badge)
        check('hq: the tab is one of HQ\'s own pills', t.js('(function(){var x=document.getElementById("hdTab");return !!x&&x.parentNode.id==="hqNav"&&getComputedStyle(x).borderRadius==="9px";})()') is True)
        check('hq: the count badge is red', t.js('getComputedStyle(document.getElementById("hdBadge")).backgroundColor') == 'rgb(229, 72, 77)')
        t.js('document.getElementById("hdTab").click()')
        rows = t.until('document.querySelectorAll("#hdRows tr[data-id]").length', 8)
        time.sleep(0.5)   # HQ's pills fade their colour over 0.15s: measure and photograph after it
        check('hq: the tab shows the desk and hides the other panes', rows == 3 and t.js('document.getElementById("paneVenues").classList.contains("hidden") && !document.getElementById("paneHelpdesk").classList.contains("hidden")') is True)
        check('hq: the Help desk pill is the pink one now, and Venues is not', t.js('getComputedStyle(document.getElementById("hdTab")).backgroundColor') == 'rgb(255, 31, 142)' and t.js('getComputedStyle(document.querySelector("[data-pane=venues]")).backgroundColor') != 'rgb(255, 31, 142)')
        check('hq: every ticket shows its brand', t.js('Array.prototype.map.call(document.querySelectorAll("#hdRows .hdbrand"),function(x){return x.textContent}).join()') == 'VenuePlay,PartyPlay,VenuePlay')
        check('hq: a PartyPlay ticket says host support, not venue support', 'Host support' in (t.js('document.getElementById("hdRows").textContent') or ''))
        check('hq: every request carries the HQ login', all((p.get('headers') or {}).get('Authorization') == 'Bearer hq-admin-token' for p in (t.js('window.__posts') or [])))
        light = t.js(LIGHT + '("#paneHelpdesk input:not([type=radio]):not([type=checkbox]), #paneHelpdesk select, #paneHelpdesk textarea")')
        check('hq: the filters are HQ\'s dark inputs, dates included, not browser white', light == [], light)
        check('hq: the list is HQ\'s card and table (rounded panel, capitals in the header row)',
              t.js('(function(){var tb=document.getElementById("hdRows").closest(".panel"),th=document.querySelector("#paneHelpdesk th");return getComputedStyle(tb).borderRadius==="16px"&&getComputedStyle(th).textTransform==="uppercase";})()') is True)
        t.shot('11-hq-help-desk-list')
        t.js('document.querySelector("#hdRows tr[data-id=a2]").click()')
        opened = t.until('(document.getElementById("hdTicket")||{}).textContent', 8) or ''
        check('hq: opening a ticket shows it, with the reply address for its brand', '#1002' in opened and 'support@partyplay.com.au' in opened, opened[:200])
        time.sleep(0.6)
        check('hq: an address HQ typed in is marked as such', 'typed by HQ' in opened)
        check('hq: a reply address the customer asked for is held, with a choice, and nothing sent there', 'pat@work.example.com' in (t.js('(document.getElementById("hdPending")||{}).textContent') or '') and t.js('!!document.getElementById("hdUsePending")') is True)
        t.js('document.getElementById("hdUsePending").click()')
        time.sleep(0.4)
        check('hq: "Use" sends HQ\'s decision to the Worker', [x['body'] for x in posts(t) if x['path'] == '/admin/help/contact'][-1:] == [{'id': 'a2', 'use': True}])
        t.until('!!document.getElementById("hdtReplyGo")', 5)
        t.js('window.__routes["/admin/help/reply"]={status:409,body:{error:"This address was typed in by HQ, not given to us by the customer. Check it is right, then confirm to send.",confirm_needed:true,address:"host@example.com"}};'
             'document.getElementById("hdtReply").value="Try reloading";document.getElementById("hdtReplyGo").click()')
        cbox = t.until('(document.getElementById("hdConfirm")||{}).textContent', 5) or ''
        check('hq: a reply to a typed-in address asks, on the page, to confirm that exact address', 'host@example.com' in cbox and 'typed in by HQ' in cbox and t.js('!!document.getElementById("hdConfirmGo")') is True, cbox)
        t.shot('22-hq-typed-address-confirm')
        t.js('window.__routes["/admin/help/reply"]={status:200,body:{ok:true}};document.getElementById("hdConfirmGo").click()')
        time.sleep(0.4)
        rb = [x['body'] for x in posts(t) if x['path'] == '/admin/help/reply'][-1]
        check('hq: confirming resends with that address named', rb.get('confirm_to') == 'host@example.com' and rb.get('body') == 'Try reloading', rb)
        t.until('!!document.getElementById("hdtReply")', 5)
        light = t.js(LIGHT + '("#hdTicket input, #hdTicket select, #hdTicket textarea")')
        check('hq: the ticket card\'s fields and text boxes are HQ\'s dark ones', light == [], light)
        t.js('document.documentElement.style.scrollBehavior="auto";window.scrollTo(0,document.getElementById("hdTicket").getBoundingClientRect().top+window.pageYOffset-20)')
        time.sleep(0.4)
        t.shot('12-hq-help-desk-ticket')
        t.js('document.getElementById("hdrGo").click()')
        rep = t.until('(function(){var x=document.getElementById("hdReport");return x&&/tickets/.test(x.textContent)?x.textContent:"";})()', 8) or ''
        check('hq: the report shows the counts, the time to close and the top venues', '3 tickets' in rep and '6 hours to close on average' in rep and 'The Royal Hotel' in rep, rep[:200])
        check('hq: the report\'s headline numbers are HQ\'s stat cards', t.js('document.querySelectorAll("#hdReport .scard").length') == 4)
        check('hq: the CSV button is ready once a report has run', t.js('document.getElementById("hdrCsv").disabled') is False)
        t.js('window.scrollTo(0,document.getElementById("hdrGo").getBoundingClientRect().top+window.pageYOffset-110)')
        time.sleep(0.4)
        t.shot('13-hq-report')
        check('hq: the report shows the guided steps: solved without a ticket, and which step fixed it',
              'Solved, no ticket' in (t.js('document.getElementById("hdTriage").textContent') or '') and 'Pull down to refresh the page. 22' in (t.js('document.getElementById("hdTriage").innerText') or '').replace('\n', ' '),
              (t.js('document.getElementById("hdTriage").innerText') or '')[:200])
        t.js('window.scrollTo(0,document.getElementById("hdTriage").getBoundingClientRect().top+window.pageYOffset-120)')
        time.sleep(0.3)
        t.shot('18-hq-triage-report')
        print('HQ: THE HELP WORDS EDITOR')
        t.js('document.getElementById("hwSet").value="venueplay:patron";document.getElementById("hwGo").click()')
        t.until('!!document.querySelector("#hwBox [data-issue]")', 8)
        check('hq editor: asks the Worker for one brand and audience', [x for x in posts(t) if x['path'] == '/admin/help/content/get' and x['body'].get('brand') == 'venueplay' and x['body'].get('audience') == 'patron'] != [])
        check('hq editor: each issue with its steps, numbered, with how often each fixed it', t.js('document.querySelectorAll("#hwBox [data-step]").length') == 4 and '64 answers, fixed it 34.4%' in (t.js('document.getElementById("hwBox").textContent') or ''))
        check('hq editor: a step that rarely helps is flagged', t.js('!!document.querySelector("[data-step=s3] .badge.urgent")') is True and t.js('!document.querySelector("[data-step=s1] .badge.urgent")') is True)
        check('hq editor: the pinned step shows as pinned', t.js('document.querySelector("[data-step=s4] [data-f=pinned]").checked') is True)
        check('hq editor: a hidden question shows, dimmed', t.js('document.querySelector("[data-faq=f2]").classList.contains("hwhide")') is True)
        light = t.js(LIGHT + '("#hwBox input:not([type=checkbox]), #hwBox select, #hwBox textarea")')
        check('hq editor: HQ\'s dark fields throughout', light == [], light)
        t.js('window.scrollTo(0,document.getElementById("hwBox").getBoundingClientRect().top+window.pageYOffset-140)')
        time.sleep(0.3)
        t.shot('19-hq-help-words-editor')
        def last(path):
            xs = [x for x in posts(t) if x['path'] == path]
            return xs[-1]['body'] if xs else {}
        t.js('document.querySelector("[data-faq=f1] [data-f=question]").value="How do I join?";document.querySelector("[data-hw=save-faq][data-id=f1]").click()')
        time.sleep(0.4)
        check('hq editor: Save on a question sends its new words', last('/admin/help/content/save') == {'kind': 'faq', 'id': 'f1', 'question': 'How do I join?', 'answer': 'Scan the QR code.', 'hidden': False}, last('/admin/help/content/save'))
        t.js('document.querySelector("[data-step=s3] [data-f=hidden]").checked=true;document.querySelector("[data-hw=save-step][data-id=s3]").click()')
        time.sleep(0.4)
        check('hq editor: hiding a step and saving sends hidden, and only that step', last('/admin/help/content/save') == {'kind': 'step', 'id': 's3', 'body': 'Turn it off and on again.', 'pinned': False, 'hidden': True}, last('/admin/help/content/save'))
        t.js('document.querySelector("[data-hw=move][data-kind=issue][data-id=i2][data-dir=up]").click()')
        time.sleep(0.4)
        check('hq editor: the arrows move an issue up', last('/admin/help/content/move') == {'kind': 'issue', 'id': 'i2', 'dir': 'up'}, last('/admin/help/content/move'))
        t.js('document.querySelector("[data-new-step=i2]").value="Check your email for our reply.";document.querySelector("[data-hw=add-step][data-id=i2]").click()')
        time.sleep(0.4)
        check('hq editor: + Add step adds one to that issue', last('/admin/help/content/save') == {'kind': 'step', 'issue_id': 'i2', 'body': 'Check your email for our reply.'}, last('/admin/help/content/save'))
        t.js('document.querySelector("[data-issue=i1] > .hwacts [data-f=auto_order]").checked=false;document.querySelector("[data-hw=save-issue][data-id=i1]").click()')
        time.sleep(0.4)
        check('hq editor: an issue can be told not to reorder itself', last('/admin/help/content/save') == {'kind': 'issue', 'id': 'i1', 'title': 'My game is not showing', 'category': 'patron_support', 'auto_order': False, 'hidden': False}, last('/admin/help/content/save'))
        check('hq editor: the automatic change is listed, before and after', 'Check your phone is online.' in (t.js('document.getElementById("hwLog").textContent') or '') and t.js('!!document.querySelector("[data-hw=undo][data-id=r1]")') is True)
        t.js('window.scrollTo(0,document.getElementById("hwLog").getBoundingClientRect().top+window.pageYOffset-200)')
        time.sleep(0.3)
        t.shot('20-hq-reorder-log')
        t.js('document.querySelector("[data-hw=undo][data-id=r1]").click()')
        time.sleep(0.4)
        check('hq editor: Undo sends that change back', last('/admin/help/reorder/undo') == {'id': 'r1'}, last('/admin/help/reorder/undo'))
        t.js('window.scrollTo(0,0);document.getElementById("hdLogCall").click()')
        check('hq: Log a call asks what kind of call it was, and for which brand', t.until('!!document.getElementById("hdcCat") && !!document.getElementById("hdcBrand")', 5) is True)
        light = t.js(LIGHT + '("#hdCallBox input, #hdCallBox select, #hdCallBox textarea")')
        check('hq: the Log a call form is HQ\'s dark fields too', light == [], light)
        time.sleep(0.3)
        t.js('window.scrollTo(0,document.getElementById("hdCallBox").getBoundingClientRect().top+window.pageYOffset-80)')
        time.sleep(0.3)
        t.shot('14-hq-log-a-call')
        t.close()
        t = hq_tab(390, 844, True)
        t.until('!!document.getElementById("hdTab")', 12)
        t.js('document.getElementById("hdTab").click()')
        t.until('document.querySelectorAll("#hdRows tr[data-id]").length', 8)
        time.sleep(0.5)
        check('hq on a phone: no sideways scrolling of the page (the table scrolls inside its card)', t.js('document.documentElement.scrollWidth<=window.innerWidth+1') is True, t.js('[document.documentElement.scrollWidth,window.innerWidth]'))
        t.js('document.documentElement.style.scrollBehavior="auto";window.scrollTo(0,document.getElementById("hqNav").getBoundingClientRect().top+window.pageYOffset-10)')
        time.sleep(0.4)
        t.shot('15-hq-help-desk-phone')
        t.js('document.querySelector("#hdRows tr[data-id=a2]").click()')
        t.until('(document.getElementById("hdTicket")||{}).textContent', 8)
        time.sleep(0.6)
        t.js('window.scrollTo(0,document.getElementById("hdTicket").getBoundingClientRect().top+window.pageYOffset-10)')
        time.sleep(0.3)
        t.shot('16-hq-ticket-phone')
        t.js('document.getElementById("hdrGo").click()')
        t.until('document.querySelectorAll("#hdReport .scard").length', 8)
        t.js('window.scrollTo(0,document.getElementById("hdrGo").getBoundingClientRect().top+window.pageYOffset-140)')
        time.sleep(0.4)
        t.shot('17-hq-report-phone')
        t.js('document.getElementById("hwGo").click()')
        t.until('!!document.querySelector("#hwBox [data-step]")', 8)
        time.sleep(0.4)
        check('hq editor on a phone: no sideways scrolling', t.js('document.documentElement.scrollWidth<=window.innerWidth+1') is True, t.js('[document.documentElement.scrollWidth,window.innerWidth]'))
        # A card hides what spills out of it, so "no page scroll" can hide a cut-off control. Measure them.
        cut = t.js('(function(){var w=window.innerWidth,out=[];Array.prototype.forEach.call(document.querySelectorAll("#hwBox button, #hwBox input, #hwBox select, #hwBox textarea, #hwBox label"),function(e){if(e.closest(".tscroll"))return;var r=e.getBoundingClientRect();if(r.width&&(r.right>w-8||r.left<8))out.push((e.textContent||e.getAttribute("data-f")||e.tagName).trim().slice(0,24));});return out.slice(0,6);})()')
        check('hq editor on a phone: every control is inside the screen, none cut off (tables scroll inside their card, as in all of HQ)', cut == [], cut)
        t.js('window.scrollTo(0,document.querySelector("#hwBox [data-issue]").getBoundingClientRect().top+window.pageYOffset-80)')
        time.sleep(0.3)
        t.shot('21-hq-editor-phone')
        t.close()
        hq = open(os.path.join(ROOT, 'venueplay', 'app', 'hq.html'), encoding='utf-8').read()
        hq_live = re.sub(r'<!--.*?-->', '', hq, flags=re.S)
        check('hq.html itself loads the help desk script (a real tag, not a comment)', '<script src="vp-helpdesk-hq.js"></script>' in hq_live)

        print('PHONE ALERTS: THE WORKER\'S VAPID SIGNATURE, CHECKED WITH REAL WEBCRYPTO')
        w = open(os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js'), encoding='utf-8').read()

        def lift(name):
            at = w.find('function ' + name + '(')
            if at < 0:
                return ''
            if w[max(0, at - 6):at] == 'async ':
                at -= 6
            i = w.find('{', at)
            depth = 0
            for j in range(i, len(w)):
                if w[j] == '{':
                    depth += 1
                elif w[j] == '}':
                    depth -= 1
                    if depth == 0:
                        return w[at:j + 1]
            return ''
        src = '\n'.join(lift(n) for n in ('helpB64url', 'helpUtf8Bytes', 'helpVapidAuth'))
        check('the three VAPID functions are in the Worker', src.count('function ') == 3)
        t = Tab(b, 800, 600, mobile=False)
        t.go(VP + '/__fixture/blank.html')
        t.until('document.readyState==="complete"', 5)
        res = t.js('(async function(){' + src + r'''
          var kp = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"}, true, ["sign","verify"]);
          var jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
          var raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
          var env = { VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_PUBLIC_KEY: helpB64url(raw) };
          var h = await helpVapidAuth(env, "https://fcm.googleapis.com/fcm/send/abc123");
          var m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
          function un(s){ s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; var b=atob(s), o=new Uint8Array(b.length); for(var i=0;i<b.length;i++) o[i]=b.charCodeAt(i); return o; }
          var ok = await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"}, kp.publicKey, un(m[3]), new TextEncoder().encode(m[1]+"."+m[2]));
          var claims = JSON.parse(new TextDecoder().decode(un(m[2])));
          var other = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"}, true, ["sign","verify"]);
          var wrong = await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"}, other.publicKey, un(m[3]), new TextEncoder().encode(m[1]+"."+m[2]));
          return { ok: ok, wrong: wrong, aud: claims.aud, exp: claims.exp - Math.floor(Date.now()/1000), k: m[4] === env.VAPID_PUBLIC_KEY, alg: JSON.parse(new TextDecoder().decode(un(m[1]))).alg };
        })()''', wait=True) or {}
        check('the Worker\'s VAPID token verifies under its public key (ES256)', res.get('ok') is True and res.get('alg') == 'ES256', res)
        check('and does NOT verify under any other key', res.get('wrong') is False, res)
        check('it is for the push service\'s origin, names the public key, and lasts at most a day',
              res.get('aud') == 'https://fcm.googleapis.com' and res.get('k') is True and 0 < (res.get('exp') or 0) <= 86400, res)
        # The keys Dean will make with tools/make-vapid-keys.py must be keys the Worker can sign with
        # and a push service can check. Run the real tool, then sign with the real Worker code.
        import subprocess
        out = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'make-vapid-keys.py')], capture_output=True, text=True).stdout
        pub = re.search(r'^VAPID_PUBLIC_KEY\s+(\S+)$', out, re.M)
        jwk = re.search(r'^VAPID_PRIVATE_JWK\s+(\{.*\})$', out, re.M)
        check('make-vapid-keys.py prints a public key and a private JWK', bool(pub and jwk), out[:200])
        if pub and jwk:
            res2 = t.js('(async function(){' + src + r'''
              var env = { VAPID_PRIVATE_JWK: ''' + json.dumps(jwk.group(1)) + ''', VAPID_PUBLIC_KEY: ''' + json.dumps(pub.group(1)) + r''' };
              function un(s){ s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; var b=atob(s), o=new Uint8Array(b.length); for(var i=0;i<b.length;i++) o[i]=b.charCodeAt(i); return o; }
              var pk = await crypto.subtle.importKey("raw", un(env.VAPID_PUBLIC_KEY), {name:"ECDSA",namedCurve:"P-256"}, false, ["verify"]);
              var h = await helpVapidAuth(env, "https://web.push.apple.com/abc");
              var m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
              return await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"}, pk, un(m[3]), new TextEncoder().encode(m[1]+"."+m[2]));
            })()''', wait=True)
            check('keys from make-vapid-keys.py sign in the Worker and verify under the public key it printed', res2 is True, res2)
        t.close()
    finally:
        b.close()
        vp_srv.shutdown()
        pp_srv.shutdown()


try:
    main()
except Exception as e:
    check('the suite ran to the end', False, repr(e))
print('')
print(('%d FAILED, %d run' % (fails, ran)) if fails else ('ALL %d CHECKS PASSED' % ran))
sys.exit(1 if fails else 0)
