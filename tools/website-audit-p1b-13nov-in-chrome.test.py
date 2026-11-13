#!/usr/bin/env python3
"""WEBSITE AUDIT PART 1b, THE SMALL FAULTS (INBOX 361A, 13 Nov 2026): back, refresh, two tabs, scans and flows.

Real Chrome, the shipped pages, on tools/browser-rig (the billing Worker rig and the game Worker rig):
  1. the sign-up wizard's code step (the Worker's answers are stubbed in the page, because the billing rig has no /start routes):
     a wrong code and a run-out code each SAY so (the boxes empty and the words stay; clearCode() used to wipe them), and three
     quick taps on "Send it again" send ONE text, not three
  2. the help form on a dropped connection says "We could not send that" with the email address, never the browser's own
     "Failed to fetch" / "Load failed"
  3. the paper card scan screen sits above the console's red banner (the banner covered the card number and the Winner badge)
Touches no git and no remote.    python3 tools/website-audit-p1b-13nov-in-chrome.test.py
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'browser-rig'))
import admin_site  # noqa: E402
import rig as RIG  # noqa: E402
PASS, FAIL = [0], [0]


def ok(label, good, detail=''):
    if good:
        PASS[0] += 1; print('  ok   %s' % label)
    else:
        FAIL[0] += 1; print('  FAIL %s%s' % (label, ('  (%s)' % str(detail)[:500]) if detail != '' else ''))


STUB = '''(function(){var real=window.fetch; window.__st={calls:[],verify:"wrong"}; window.fetch=function(u,o){u=String(u); var m=/\\/start\\/(begin|verify|resend)/.exec(u); if(!m) return real.apply(this,arguments);
 window.__st.calls.push(m[1]); var r,s=200; if(m[1]==="begin") r={ok:true,start_id:"s-1"}; else if(m[1]==="resend") r={ok:true};
 else if(window.__st.verify==="gone"){ r={ok:false,gone:true,error:"That code has run out. Tap Send it again for a new one."}; s=410; }
 else { r={ok:false,error:"That code is not right. Check the text and try again."}; s=400; }
 return new Promise(function(res){setTimeout(function(){res(new Response(JSON.stringify(r),{status:s,headers:{"Content-Type":"application/json"}}))},150)}) }})();'''
S = admin_site.Site(fonts=False)
R = None
try:
    def op(path, w=390, h=844, stub=False):
        tid = S.B.call('Target.createTarget', {'url': 'about:blank', 'newWindow': True})['targetId']
        sid = S.B.call('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
        S.B.call('Page.enable', {}, session=sid)
        S.B.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': True}, session=sid)
        if stub: S.B.call('Page.addScriptToEvaluateOnNewDocument', {'source': STUB}, session=sid)
        S.B.call('Page.navigate', {'url': S.base + path}, session=sid)
        S.until(sid, 'document.readyState==="complete"', 25); time.sleep(1.0)
        return tid, sid

    def fill(sid, sel, val):
        S.js(sid, '(function(){var e=document.querySelector(%s);e.focus();e.value=%s;e.dispatchEvent(new Event("input",{bubbles:true}));})()' % (json.dumps(sel), json.dumps(val)))

    def paste(sid, val):
        S.js(sid, '(function(){var c=document.getElementById("st-c1");c.focus();var dt=new DataTransfer();dt.setData("text",%s);c.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));})()' % json.dumps(val))

    # ---- 1. the code step
    tid, sid = op('/offer-nov', stub=True)
    for sel, v in (('#st-venue', 'Audit Tester Hotel'), ('#st-postcode', '4217'), ('#st-name', 'Audit Tester'), ('#st-mobile', '0400000000'), ('#st-email', 'audit@example.com')):
        fill(sid, sel, v)
    S.js(sid, 'document.getElementById("st-kind-pub").click(); document.getElementById("st-go").click(); true')
    ok('the wizard reaches the code step (stubbed Worker)', S.until(sid, '!document.getElementById("st-code").hidden', 10) is True)
    paste(sid, '123456'); time.sleep(1.2)
    t = S.js(sid, 'document.getElementById("st-cerr").textContent')
    boxes = S.js(sid, '[1,2,3,4,5,6].map(function(i){return document.getElementById("st-c"+i).value}).join("")')
    ok('a wrong code says so ("That code is not right") and the boxes are emptied', 'not right' in (t or '') and boxes == '', [t, boxes])
    S.js(sid, 'window.__st.verify="gone"; true'); paste(sid, '654321'); time.sleep(1.2)
    t = S.js(sid, 'document.getElementById("st-cerr").textContent')
    ok('a run-out code says so ("That code has run out") and is still on the code step', 'run out' in (t or '') and S.js(sid, '!document.getElementById("st-code").hidden') is True, t)
    S.js(sid, 'var b=document.getElementById("st-resend");b.click();b.click();b.click();true'); time.sleep(1.0)
    n = S.js(sid, 'window.__st.calls.filter(function(c){return c==="resend"}).length')
    ok('three quick taps on "Send it again" send ONE text', n == 1, n)
    S.close_tab(tid)

    # ---- 2. the help form on a dropped connection
    tid, sid = op('/help#player')
    S.js(sid, '[].filter.call(document.querySelectorAll("#helpDesk button"),function(b){return /send us a message/i.test(b.textContent)&&b.getBoundingClientRect().width>0}).forEach(function(b){b.click()});true'); time.sleep(0.8)
    F = '[].filter.call(document.querySelectorAll(".vph-form"),function(f){return f.getBoundingClientRect().width>0})[0]'
    S.js(sid, '(function(){var f=%s; function set(rx,v){var e=[].filter.call(f.querySelectorAll("input,textarea"),function(e){return rx.test(e.id)})[0]; if(e){e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}))}} set(/Email/,"a@example.com"); set(/Msg/,"audit ignore");})()' % F)
    S.B.call('Network.enable', {}, session=sid)
    S.B.call('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}, session=sid)
    S.js(sid, '(function(){var f=%s; f.querySelector(".vph-go").click();})()' % F); time.sleep(1.5)
    t = S.js(sid, '(function(){var f=%s; return f.querySelector(".vph-err").textContent})()' % F) or ''
    ok('help form, connection down: the customer is told "We could not send that" with the email, not the browser\'s words', 'We could not send that' in t and '@' in t and 'fetch' not in t.lower() and 'load failed' not in t.lower(), t)
    S.close_tab(tid)

    # ---- 3. the paper card scan screen over the console banner
    R = RIG.Rig(host_pages=('/app/musical/host.html',))
    tid, sid = R.open('/app/musical/host.html', width=390, height=844)
    R.until(sid, 'document.readyState==="complete" && !!window.VPPaperCheck && !!document.getElementById("startBtn")', 40); time.sleep(2)
    R.ask(sid, 'VPPaperCheck.check("HTTPS://VENUEPLAY.COM.AU/C/1ABCDEF01PC4FZZZZZZZZ"); true'); time.sleep(2)
    # hostError() is private to the page, so put the banner where it puts it: on <body>, fixed, z-index 90, under the header
    R.ask(sid, '(function(){var b=document.getElementById("hostErrBar"); document.getElementById("hostErrText").textContent="No screen is connected, so the music is coming out of this device."; document.body.appendChild(b); b.style.position="fixed"; b.style.left="0"; b.style.right="0"; b.style.zIndex="90"; b.style.top="52px"; b.style.background="#2A0B14"; b.classList.add("show");})(); true'); time.sleep(0.6)
    top = R.ask(sid, '(function(){var b=document.getElementById("hostErrBar"); b.classList.add("show"); var br=b.getBoundingClientRect(); var hit=0, n=0; for(var y=Math.round(br.top)+8; y<br.bottom-4; y+=12){ n++; var e=document.elementFromPoint(200,y); if(e && e.closest(".ppc")) hit++; } return JSON.stringify({bar:br.height>20, inside:n>0 && hit===n, n:n, hit:hit});})()')
    d = json.loads(top) if isinstance(top, str) else {}
    ok('the console banner is up and the scan screen is above it (the card heading is not covered)', d.get('bar') is True and d.get('inside') is True, top)
    R.close_tab(tid)
finally:
    S.close()
    if R: R.close()
print('\nALL %d CHECKS PASSED' % PASS[0] if not FAIL[0] else '\n%d OF %d CHECKS FAILED' % (FAIL[0], PASS[0] + FAIL[0]))
sys.exit(1 if FAIL[0] else 0)
