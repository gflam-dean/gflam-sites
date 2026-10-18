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
<script>window.VP={ready:function(){return Promise.resolve({currentVenueId:"11111111-2222-4333-8444-555555555555",staff:[{venue_id:"11111111-2222-4333-8444-555555555555"}]});},
getClient:function(){return{auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:"venue-login-token"}}});}}};}};</script>
<script src="/app/vp-help.js" data-mode="venue" data-brand="venueplay"></script></body></html>''',
    '/__fixture/blank.html': '<!doctype html><html><head><meta charset="utf-8"></head><body>blank</body></html>',
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
      var r = window.__routes[path] || { status: 200, body: { ok: true, ticket_no: 1042 } };
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { "Content-Type": "application/json" } }));
    }
    if (/workers\.dev/.test(u)) return Promise.reject(new Error("the real Worker is never called from this test"));
    return real.apply(this, arguments);
  };
})();
'''


class Tab(object):
    def __init__(self, b, w=375, h=740, mobile=True, pre=''):
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
    check(where + ': Help opens the panel with the FAQ from the data file (%d questions)' % faq_items, got == faq_items, got)
    check(where + ': its title is right', title_has in (t.js('(document.getElementById("vphTitle")||{}).textContent') or ''), t.js('(document.getElementById("vphTitle")||{}).textContent'))
    priv = t.js('Array.prototype.some.call(document.querySelectorAll(".vph-fine a"), function(a){ return a.getAttribute("href")==="/privacy"; })')
    return priv


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
        priv = panel_checks(t, 'bingo phone', len(vp_faq['patron']['items']), 'Help')
        check('bingo phone: the privacy line links the privacy policy', priv is True)
        t.shot('03-bingo-phone-help-panel')
        t.js('document.getElementById("vphMsg").value="My tickets are not showing";document.querySelector(".vph-go").click()')
        time.sleep(0.4)
        check('bingo phone: no email, no send, and it says why', t.js('window.__posts.length') == 0 and 'email' in (t.js('document.querySelector(".vph-err").textContent') or ''))
        # On a real night connect(room) writes the room into #roomLabel, and that is what the widget
        # reads. The scripted demo never connects, so do here exactly what connect() does.
        t.js('document.getElementById("roomLabel").textContent="RYL234"')
        t.js('document.getElementById("vphEmail").value="jo@example.com";document.getElementById("vphName").value="Jo";document.querySelector(".vph-go").click()')
        done = t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        post = (t.js('window.__posts') or [{}])[-1]
        body = post.get('body', {})
        check('bingo phone: the form posts a patron ticket to /help/ticket', post.get('path') == '/help/ticket' and body.get('brand') == 'venueplay' and body.get('kind') == 'patron', post)
        check('bingo phone: the room code and the game ride along, the honeypot is empty, a device id is sent',
              body.get('code') == 'RYL234' and body.get('game') == 'bingo' and body.get('website') == '' and len(body.get('device') or '') >= 16, body)
        check('bingo phone: no login token is sent from a patron page', 'Authorization' not in (post.get('headers') or {}), post.get('headers'))
        check('bingo phone: "Thanks, we\'ll email you" with the ticket number', bool(done) and "Thanks, we'll email you" in done and '#1042' in done, done)
        t.shot('04-bingo-phone-sent')
        t.js('document.querySelector(".vph-x").click()')
        check('bingo phone: the panel closes and the game is back', t.js('!document.getElementById("vphBg") && !!document.getElementById("bingoBtn").offsetParent') is True)
        t.close()

        for path, name in (('/app/musical/play?demo=1', 'musical phone'), ('/app/trivia/play?demo=1', 'trivia phone')):
            print(name.upper())
            t = Tab(b)
            t.go(VP + path)
            t.until('!!document.getElementById("vphLink")', 15)
            time.sleep(1.5)
            link_checks(t, name)
            t.shot(('05-' if 'musical' in name else '06-') + name.replace(' ', '-'))
            check(name + ': Help is in the phone menu too', t.js('!!document.getElementById("vphMenu")') is True)
            t.close()

        print('VENUEPLAY CONSOLE HEADER (the venue form)')
        t = Tab(b, 390, 800)
        t.go(VP + '/__fixture/venue.html')
        check('venue: a Help button sits in the header beside Account', t.until('(function(){var x=document.getElementById("vphLink");return !!x&&x.parentNode.className==="hactions"&&x.nextElementSibling.textContent==="Account";})()', 8) is True)
        panel_checks(t, 'venue', len(vp_faq['venue']['items']), 'venues')
        t.shot('07-venue-help-panel')
        t.js('document.getElementById("vphMsg").value="TV blank";document.querySelector(".vph-go").click()')
        time.sleep(0.3)
        check('venue: no subject, no send', t.js('window.__posts.length') == 0)
        t.js('document.getElementById("vphSubject").value="TV not showing";document.getElementById("vphKind").value="accounts";document.getElementById("vphUrgent").checked=true;document.querySelector(".vph-go").click()')
        done = t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        post = (t.js('window.__posts') or [{}])[-1]
        body = post.get('body', {})
        check('venue: posts to /help/venue/ticket with the venue, the kind and urgent',
              post.get('path') == '/help/venue/ticket' and body.get('venue_id') == '11111111-2222-4333-8444-555555555555' and body.get('category') == 'accounts' and body.get('urgent') is True, post)
        check('venue: with the signed-in login\'s token', (post.get('headers') or {}).get('Authorization') == 'Bearer venue-login-token', post.get('headers'))
        check('venue: shows the ticket number', bool(done) and '#1042' in done, done)
        t.js('window.__routes["/help/venue/ticket"]={status:429,body:{error:"That is a lot of requests in an hour."}};document.querySelector(".vph-x").click();document.getElementById("vphLink").click()')
        t.until('!!document.getElementById("vphSubject")', 5)
        t.js('document.getElementById("vphSubject").value="x";document.getElementById("vphMsg").value="y";document.querySelector(".vph-go").click()')
        err = t.until('(document.querySelector(".vph-err")||{}).textContent', 5)
        check('venue: a refusal from the Worker is shown in its own words, and Send works again',
              err == 'That is a lot of requests in an hour.' and t.js('document.querySelector(".vph-go").disabled') is False, err)
        t.close()

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
        t.js('document.getElementById("vphEmail").value="guest@example.com";document.getElementById("vphMsg").value="Cannot join";document.querySelector(".vph-go").click()')
        t.until('(document.querySelector(".vph-done")||{}).textContent', 8)
        body = ((t.js('window.__posts') or [{}])[-1]).get('body', {})
        check('partyplay guest: a PartyPlay guest ticket with the party code', body.get('brand') == 'partyplay' and body.get('kind') == 'patron' and body.get('code') == 'KFP7QX', body)
        check('partyplay guest: the panel says support@partyplay.com.au, not VenuePlay', 'support@partyplay.com.au' in (t.js('document.body.textContent') or '') and 'venueplay.com.au' not in (t.js('(document.getElementById("vphBg")||document.body).textContent') or ''))
        t.close()

        print('PARTYPLAY HOST CONSOLE')
        t = Tab(b, 390, 800)
        t.go(PP + '/host?code=KFP7QX&key=abc')
        check('partyplay host: Help sits in the top bar', t.until('(function(){var x=document.getElementById("vphLink");return !!x&&x.parentNode.className==="top";})()', 10) is True)
        panel_checks(t, 'partyplay host', len(pp_faq['host']['items']), 'hosts')
        t.shot('09-partyplay-host-panel')
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

        print('HQ: THE HELP DESK TAB, IN THE REAL hq.html WITH ITS OWN STYLES')
        routes = {
            '/admin/help/count': {'body': {'new': 2, 'urgent': 1}},
            '/admin/help/list': {'body': {'tickets': [
                {'id': 'a1', 'ticket_no': 1001, 'brand': 'venueplay', 'category': 'patron_support', 'channel': 'patron_form', 'status': 'new', 'priority': 'urgent', 'venue_id': 'v1', 'subject': 'Tickets not showing', 'created_at': '2026-10-19T09:00:00Z'},
                {'id': 'a2', 'ticket_no': 1002, 'brand': 'partyplay', 'category': 'venue_support', 'channel': 'patron_form', 'status': 'open', 'priority': 'normal', 'room_code': 'KFP7QX', 'subject': 'TV blank', 'created_at': '2026-10-19T10:00:00Z'},
                {'id': 'a3', 'ticket_no': 1003, 'brand': 'venueplay', 'category': 'accounts', 'channel': 'email', 'status': 'waiting', 'priority': 'normal', 'venue_id': 'v1', 'subject': 'Invoice question', 'created_at': '2026-10-18T22:10:00Z'}],
                'venues': {'v1': 'The Royal Hotel'}, 'assignees': ['Dean'], 'all_venues': [{'id': 'v1', 'name': 'The Royal Hotel'}]}},
            '/admin/help/get': {'body': {'ticket': {'id': 'a2', 'ticket_no': 1002, 'brand': 'partyplay', 'category': 'venue_support', 'channel': 'patron_form', 'status': 'open', 'priority': 'normal',
                'subject': 'TV blank', 'message': 'The TV is blank since we pressed start.', 'contact_name': 'Pat', 'contact_email': 'host@example.com', 'room_code': 'KFP7QX', 'created_at': '2026-10-19T10:00:00Z'},
                'notes': [{'kind': 'change', 'body': 'Opened by Dean', 'author': 'Dean', 'created_at': '2026-10-19T10:05:00Z'},
                          {'kind': 'reply', 'body': 'Try reloading the party screen.', 'author': 'Dean (from support@partyplay.com.au)', 'created_at': '2026-10-19T10:07:00Z'}], 'venue_name': ''}},
            '/admin/help/report': {'body': {'from': '2026-10-01', 'to': '2026-10-19', 'rows': [], 'venues': {}, 'report': {'total': 3, 'by_brand': {'venueplay': 2, 'partyplay': 1},
                'by_brand_category': {'venueplay:sales': 2, 'partyplay:venue_support': 1}, 'by_category': {}, 'by_channel': {'phone': 2, 'web_form': 1}, 'by_status': {'closed': 3},
                'closed': 3, 'avg_hours_to_close': 6, 'longest_hours_to_close': 10, 'longest_ticket_no': 2, 'top_venues': [{'name': 'The Royal Hotel', 'count': 2}]}}},
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
            t = Tab(b, w, h, mobile=mobile, pre='window.__routes=' + json.dumps(routes) + ';' + FAKE_HQ_LOGIN)
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
