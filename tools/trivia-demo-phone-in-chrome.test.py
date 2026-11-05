#!/usr/bin/env python3
"""THE TRIVIA DEMO PHONE: IT PLAYS ITSELF ONLY WHEN IT IS EMBEDDED (Dean, 4 Nov 2026).

The live trivia demo TV (Tugun Bowls Club, code VENUE2) carries a QR that opens /app/trivia/play?demo=1 on a
real phone. That page is also the phone in the sales pages' frames, where it taps its own answers so the loop
shows the game. On a real phone the first question "answered itself" before the person could. Dean: someone
who scans it wants to play, not watch it play itself. Now:

  EMBEDDED  (in a frame: index.html, nsw.html, see-a-night.html)   it still plays itself, exactly as before
  ON ITS OWN (the top window, e.g. from the QR)                      five questions the PERSON answers: the
            normal clock, reveal and the Worker's own points (100, and up to half again for speed), never a
            tap made for them; then "That's how it works." and "Want this at your venue?", which opens a short
            call-back form posting a SALES ticket (source demo-phone) to the public /help/ticket route

Opens the REAL pages in headless Chrome on the browser rig (tools/browser-rig/rig.py). The billing Worker's
/help routes are stood in for in the page itself (window.VP_HELP_API pointed at an address the test answers),
so what the page SENDS is what is checked here; what the Worker DOES with it is tools/test-help-desk.js.

Takes the repo's heavy lock first (VP_WAIT_LOCK seconds to wait) and never clears anybody else's.

    VP_SHOTS=/some/dir python3 tools/trivia-demo-phone-in-chrome.test.py
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'browser-rig'))
sys.path.insert(0, HERE)
import gatelib

SHOTS = os.environ.get('VP_SHOTS', '')
ran = bad = 0
def ok(name, cond, saw=''):
    global ran, bad
    ran += 1
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '   saw: ' + str(saw)[:400]))
    if not cond: bad += 1
def shot(r, sid, name):
    if SHOTS: r.shot(sid, os.path.join(SHOTS, name + '.jpg'))

def take_lock(tool='trivia-demo-phone-in-chrome'):
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

PHONE = '/app/trivia/play?demo=1'
# The billing Worker, stood in for: /help/config (no Turnstile key, as live today) and /help/ticket, recorded.
# window.__cbFail = a status and error the next ticket answers with instead.
STUB = r'''(function(){ window.__cb=[]; window.VP_HELP_API="https://help.test.invalid"; var F=window.fetch;
  window.fetch=function(u,o){ u=String(u); if(u.indexOf("https://help.test.invalid")!==0) return F.apply(this, arguments);
    window.__cb.push({ u:u, method:(o&&o.method)||"GET", body:(o&&o.body)||"" });
    var fail=/\/help\/ticket$/.test(u) && window.__cbFail, st=fail ? fail.status : 200;
    var out=/\/help\/ticket$/.test(u) ? (fail ? { error:fail.error } : { ok:true, ticket_no:4321 }) : { turnstile:null };
    if(fail) window.__cbFail=null;
    return Promise.resolve(new Response(JSON.stringify(out), { status:st, headers:{ "Content-Type":"application/json" } })); }; })();'''

# What the phone shows: the view, the label, the buttons and which are picked or disabled, the status line.
SEE = r'''(function(d){ d=d||document; var v=[].filter.call(d.querySelectorAll(".view"),function(x){return !x.classList.contains("hidden");})[0];
  var b=[].map.call(d.querySelectorAll("#pAnswers .pans"),function(e){return {picked:e.classList.contains("picked"), off:!!e.disabled};});
  function t(id){ var e=d.getElementById(id); return e ? (e.textContent||"").replace(/\s+/g," ").trim() : ""; }
  return { view:v?v.id:"", mode:d.documentElement.getAttribute("data-vp-demo-mode"), lbl:t("pqCount"), status:t("pStatus"), btns:b,
           tag:t("pResTag"), pts:t("pResPts"), tot:t("pResTot"), head:t("waitHead"), msg:t("waitMsg"),
           go:!!(d.getElementById("demoGo") && d.getElementById("demoGo").offsetParent) }; })'''
def see(r, sid, frame=False):
    v = r.ask(sid, SEE + ('(document.querySelector("iframe") && document.querySelector("iframe").contentDocument)' if frame else '()'))
    return v if isinstance(v, dict) else {}
def picked(v): return sum(1 for b in v.get('btns') or [] if b.get('picked'))
def tap(r, sid, i): return r.ask(sid, '(function(){var b=document.querySelectorAll("#pAnswers .pans")[%d]; if(!b||b.disabled) return false; b.click(); return true;})()' % i)
def on_q(r, sid, n, secs=12):
    return r.until(sid, '(function(){var v=document.getElementById("vQ"); return !v.classList.contains("hidden") && document.getElementById("pqCount").textContent.indexOf("Question %d of 5")===0;})()' % n, secs)
def on_res(r, sid, secs=4):
    return r.until(sid, '!document.getElementById("vRes").classList.contains("hidden")', secs)
def pts(v):
    try: return int((v.get('pts') or '').replace('+', ''))
    except Exception: return None

def embedded(r):
    print('\n1. EMBEDDED: in a sales page frame it still plays itself')
    tid, sid = r.open('/index.html', width=1280, height=900)
    ok('CONTROL: the home page frames the trivia phone in its ?demo=1 mode',
       r.until(sid, '(function(f){return !!f && /\\/app\\/trivia\\/play\\?demo=1/.test(f.getAttribute("src")||"");})(document.getElementById("h2Phone"))', 20) is True,
       r.ask(sid, 'document.getElementById("h2Phone") && document.getElementById("h2Phone").getAttribute("src")'))
    FR = '(document.getElementById("h2Phone").contentDocument||{})'
    ok('index.html: the framed phone knows it is embedded (data-vp-demo-mode auto)',
       r.until(sid, '(function(d){return !!d.documentElement && d.documentElement.getAttribute("data-vp-demo-mode")==="auto";})(%s)' % FR, 20) is True,
       r.ask(sid, '(function(d){return d.documentElement && d.documentElement.getAttribute("data-vp-demo-mode");})(%s)' % FR))
    got = r.until(sid, '(function(d){return !!d.querySelector && d.querySelectorAll("#pAnswers .pans.picked").length===1;})(%s)' % FR, 15)
    ok('index.html: and it taps its own first answer, as the sales loop always has', got is True, got)
    ok('index.html: then shows its own result', r.until(sid, '(function(d){var v=d.getElementById&&d.getElementById("vRes"); return !!v && !v.classList.contains("hidden");})(%s)' % FR, 8) is True)
    shot(r, sid, 'demo-phone-1-index')
    r.close_tab(tid)
    # Any page that frames it (see-a-night.html, nsw.html, and the next one somebody writes): a bare frame.
    tid, sid = r.open('/__blank', width=600, height=900)
    r.until(sid, 'document.readyState==="complete"', 10)
    r.ask(sid, '(function(){var f=document.createElement("iframe"); f.style.cssText="width:390px;height:844px;border:0"; f.src=%s; document.body.appendChild(f); return true;})()' % json.dumps(PHONE + '&sting=0'))
    r.until(sid, '(function(f){return !!(f&&f.contentDocument&&f.contentDocument.getElementById("vQ"));})(document.querySelector("iframe"))', 15)
    ok('a bare frame: the phone in it is in auto mode', r.until(sid, '(function(f){return f.contentDocument.documentElement.getAttribute("data-vp-demo-mode")==="auto";})(document.querySelector("iframe"))', 10) is True)
    got = r.until(sid, '(function(f){return f.contentDocument.querySelectorAll("#pAnswers .pans.picked").length===1;})(document.querySelector("iframe"))', 10)
    ok('a bare frame: it answers question 1 by itself (B, Sydney) with nobody tapping', got is True and see(r, sid, True).get('btns', [{}, {}])[1].get('picked') is True, see(r, sid, True))
    r.close_tab(tid)

def standalone(r):
    print('\n2. ON ITS OWN (the QR on the demo TV): the person plays, nothing is tapped for them')
    tid, sid = r.open(PHONE + '&sting=0', before=STUB, width=390, height=844)
    ok('CONTROL: the page is up', r.until(sid, 'document.readyState==="complete" && !!document.getElementById("vWait")', 20) is True)
    v = see(r, sid)
    ok('opened on its own, it is in solo mode (data-vp-demo-mode solo)', v.get('mode') == 'solo', v)
    ok('it starts on "Have a go" with a Start button, and asks nothing yet', v.get('view') == 'vWait' and v.get('head') == 'Have a go' and v.get('go') is True, v)
    time.sleep(6)
    v = see(r, sid)
    ok('six seconds later it is still waiting for them: no question has started by itself', v.get('view') == 'vWait' and not v.get('btns'), v)
    shot(r, sid, 'demo-phone-2-start')
    r.ask(sid, 'document.getElementById("demoGo").click()')
    ok('tap Start: question 1 of 5 comes up', on_q(r, sid, 1) is True, see(r, sid))
    time.sleep(6)   # the embedded round taps its first answer at 3.4 s
    v = see(r, sid)
    ok('six seconds into question 1: nothing is picked, every answer can still be tapped', picked(v) == 0 and len(v.get('btns') or []) == 4 and not any(b.get('off') for b in v['btns']), v)
    ok('and it says "Tap your answer"', v.get('status') == 'Tap your answer', v)
    ok('the clock ring is counting the normal 20 seconds down', r.ask(sid, '(function(n){n=parseInt(n,10); return n>=12 && n<=15;})(document.getElementById("pqCdNum").textContent)') is True,
       r.ask(sid, 'document.getElementById("pqCdNum").textContent'))
    shot(r, sid, 'demo-phone-3-question')
    ok('they tap B (Sydney)', tap(r, sid, 1) is True)
    v = see(r, sid)
    ok('their pick is locked in: B picked, the rest dim and off', v.get('btns') and v['btns'][1].get('picked') and all(b.get('off') for b in v['btns']), v)
    ok('the reveal follows their tap', on_res(r, sid) is True, see(r, sid))
    v = see(r, sid)
    p1 = pts(v)
    ok('Correct! with the Worker\'s points for a quick right answer (100 and a speed bonus, at most 150)', v.get('tag') == 'Correct!' and p1 is not None and 100 < p1 <= 150, v)
    ok('and the total is those points', v.get('tot') == str(p1), v)
    shot(r, sid, 'demo-phone-4-right')
    ok('question 2 comes up by itself after the result', on_q(r, sid, 2, 10) is True, see(r, sid))
    time.sleep(9)
    v = see(r, sid)
    ok('nine seconds into question 2 with no tap: still nothing picked for them', picked(v) == 0 and v.get('view') == 'vQ', v)
    ok('left alone, the clock runs out and the reveal says No answer, +0', on_res(r, sid, 16) is True and see(r, sid).get('tag') == 'No answer' and see(r, sid).get('pts') == '0', see(r, sid))
    ok('question 3', on_q(r, sid, 3, 10) is True, see(r, sid))
    tap(r, sid, 1)   # Cold Chisel: wrong (AC/DC)
    ok('a wrong tap is "Not this time", 0 points', on_res(r, sid) is True and see(r, sid).get('tag') == 'Not this time' and see(r, sid).get('pts') == '0', see(r, sid))
    ok('question 4', on_q(r, sid, 4, 10) is True, see(r, sid))
    time.sleep(12)   # longer than question 1's six seconds, so less of the speed bonus is left
    tap(r, sid, 2)   # 18
    on_res(r, sid); p4 = pts(see(r, sid))
    ok('a slower right answer still scores, with less bonus than the quick one', see(r, sid).get('tag') == 'Correct!' and p4 is not None and 100 <= p4 < p1, [p1, p4])
    ok('question 5', on_q(r, sid, 5, 10) is True, see(r, sid))
    tap(r, sid, 1)   # the Great Barrier Reef
    on_res(r, sid); p5 = pts(see(r, sid)) or 0
    ok('the end card: "That\'s how it works."', r.until(sid, '!document.getElementById("vDemoEnd").classList.contains("hidden")', 10) is True, see(r, sid))
    end = r.ask(sid, '({ s:document.getElementById("demoScore").textContent, r:document.getElementById("demoRight").textContent, h:document.querySelector("#vDemoEnd .pbig").textContent, w:document.getElementById("demoWant").textContent })') or {}
    ok('it adds up their own points and says 3 of 5 right', end.get('s') == '%d points' % (p1 + p4 + p5) and end.get('r') == 'You got 3 of 5 right.' and end.get('h') == 'That\'s how it works.', [end, p1, p4, p5])
    ok('and offers "Want this at your venue?"', end.get('w') == 'Want this at your venue?', end)
    shot(r, sid, 'demo-phone-5-end')
    return tid, sid

def callback(r, tid, sid):
    print('\n3. "Want this at your venue?": the call-back form')
    r.ask(sid, 'document.getElementById("demoWant").click()')
    ok('it opens the call-back form', r.until(sid, '!document.getElementById("vCall").classList.contains("hidden")', 5) is True)
    f = r.ask(sid, r'''(function(){ function L(id){ var l=document.querySelector('label[for="'+id+'"]'); return l ? l.textContent.replace(/\s+/g," ").trim() : ""; }
        var a=document.querySelector("#vCall .dpriv a"), t=document.body.innerText;
        return { name:L("cbName"), venue:L("cbVenue"), place:L("cbPlace"), mob:L("cbMobile"), email:L("cbEmail"),
                 times:[].map.call(document.querySelectorAll("#cbTime button"),function(b){return b.textContent;}),
                 priv:a ? a.getAttribute("href") : "", hp:!!document.querySelector("#cbWebsite") && document.getElementById("cbWebsite").getBoundingClientRect().right<=0,
                 tel:!!document.querySelector('a[href^="tel:"]') || /5228\s*3667/.test(document.documentElement.innerHTML),
                 small:[].filter.call(document.querySelectorAll("#vCall *"),function(e){ return e.offsetParent && e.childNodes.length && [].some.call(e.childNodes,function(n){return n.nodeType===3 && n.textContent.trim();}) && parseFloat(getComputedStyle(e).fontSize)<15; }).map(function(e){return e.id||e.className;}) }; })()''') or {}
    ok('the fields: first name, venue name, suburb or postcode, mobile, email (optional)',
       [f.get('name'), f.get('venue'), f.get('place'), f.get('mob'), f.get('email')] == ['First name', 'Venue name', 'Suburb or postcode', 'Mobile', 'Email (optional)'], f)
    ok('best time to call: morning, afternoon or evening', f.get('times') == ['Morning', 'Afternoon', 'Evening'], f)
    ok('a privacy line linking /privacy', f.get('priv') == '/privacy', f)
    ok('a honeypot nobody sees', f.get('hp') is True, f)
    ok('no phone number of ours anywhere on this public page', f.get('tel') is False, f)
    ok('nothing on the form under 15px', f.get('small') == [], f.get('small'))
    shot(r, sid, 'demo-phone-6-form')
    r.ask(sid, 'document.getElementById("cbSend").click()')
    e = r.ask(sid, 'document.getElementById("cbErr").textContent')
    ok('Send with nothing filled in: it asks for the first name, and sends nothing', e == 'Put in your first name.' and r.ask(sid, 'window.__cb.filter(function(c){return /help\\/ticket/.test(c.u);}).length') == 0, e)
    FILL = r'''(function(m){ function v(id,x){ var e=document.getElementById(id); e.value=x; e.dispatchEvent(new Event("input",{bubbles:true})); }
        v("cbName","Kim"); v("cbVenue","The Commercial Hotel"); v("cbPlace","Murwillumbah"); v("cbMobile",m); v("cbEmail",""); return true; })'''
    r.ask(sid, FILL + '("0712 345")')
    r.ask(sid, 'document.getElementById("cbSend").click()')
    ok('a number that is not a mobile is refused on the phone', r.ask(sid, 'document.getElementById("cbErr").textContent') == 'Put in a mobile number, like 0412 345 678.')
    r.ask(sid, FILL + '("0412 345 678")')
    r.ask(sid, 'document.getElementById("cbSend").click()')
    ok('no best time picked: it asks for one', r.ask(sid, 'document.getElementById("cbErr").textContent') == 'Pick the best time to call.')
    r.ask(sid, 'document.querySelector(\'#cbTime [data-t="afternoon"]\').click()')
    ok('Afternoon is picked, and says so to a screen reader', r.ask(sid, 'document.querySelector(\'#cbTime [data-t="afternoon"]\').getAttribute("aria-checked")==="true" && document.querySelectorAll("#cbTime .on").length===1') is True)
    r.ask(sid, 'window.__cbFail={status:429, error:"You have sent a few already. Give us a little while to call."}; document.getElementById("cbSend").click(); true')
    ok('a refusal from the Worker is shown in its own words, and the form stays', r.until(sid, 'document.getElementById("cbErr").textContent==="You have sent a few already. Give us a little while to call."', 5) is True
       and r.ask(sid, '!document.getElementById("callForm").classList.contains("hidden") && !document.getElementById("cbSend").disabled') is True,
       r.ask(sid, 'document.getElementById("cbErr").textContent'))
    r.ask(sid, 'document.getElementById("cbSend").click()')
    ok('sent: "Thanks, we\'ll give you a call"', r.until(sid, '!document.getElementById("cbDone").classList.contains("hidden") && document.getElementById("callForm").classList.contains("hidden")', 5) is True)
    ok('with their name and the time they picked', r.ask(sid, 'document.getElementById("cbDoneLine").textContent') == 'Thanks, Kim. We’ll call you in the afternoon.', r.ask(sid, 'document.getElementById("cbDoneLine").textContent'))
    calls = r.ask(sid, 'JSON.stringify(window.__cb)') or '[]'
    calls = json.loads(calls)
    tk = [c for c in calls if c['u'].endswith('/help/ticket')]
    body = json.loads(tk[-1]['body']) if tk else {}
    ok('it posted to the public /help/ticket route (the existing sales ticket route)', len(tk) == 2 and all(c['method'] == 'POST' for c in tk), calls)
    ok('as a venueplay SALES ticket tagged source demo-phone', body.get('brand') == 'venueplay' and body.get('kind') == 'sales' and body.get('source') == 'demo-phone', body)
    ok('with the name, the venue and its place, the mobile as digits, no email, and the best time',
       body.get('name') == 'Kim' and body.get('venue_name') == 'The Commercial Hotel' and body.get('locality') == 'Murwillumbah' and body.get('phone') == '0412345678'
       and body.get('email') == '' and body.get('best_time') == 'afternoon', body)
    ok('the honeypot went empty, a device id went with it, and no message was written by the page', body.get('website') == '' and bool(body.get('device')) and 'message' not in body, body)
    ok('it asked /help/config first (Turnstile only if the Worker hands out a key; today it does not)', any(c['u'].endswith('/help/config?brand=venueplay') for c in calls), calls)
    shot(r, sid, 'demo-phone-7-thanks')
    ok('no script errors on the solo demo', r.ask(sid, 'window.__errs.length') == 0, r.ask(sid, 'JSON.stringify(window.__errs)'))
    r.ask(sid, 'document.getElementById("cbAgain").click()')
    ok('"Play the demo again" goes back to "Have a go"', see(r, sid).get('view') == 'vWait' and see(r, sid).get('head') == 'Have a go' and see(r, sid).get('go') is True, see(r, sid))
    r.close_tab(tid)

def show_and_hook(r):
    print('\n4. THE SHOW, AND THE TEST HOOK')
    tid, sid = r.open(PHONE, before=STUB, width=390, height=844)
    r.until(sid, 'document.readyState==="complete" && !!window.VPSting && !!document.getElementById("demoGo")', 20)
    time.sleep(1.5)
    ok('on its own, the start-of-game show waits for Start too', r.ask(sid, 'VPSting.stats().plays===0') is True, r.ask(sid, 'JSON.stringify(VPSting.stats())'))
    r.ask(sid, 'document.getElementById("demoGo").click()')
    ok('Start plays it, with no made-up player name ("LET’S PLAY", "TRIVIA")', r.until(sid, 'VPSting.playing()', 5) is True and r.ask(sid, 'VPSting.shown()') == ['LET’S PLAY', 'TRIVIA'], r.ask(sid, 'VPSting.shown()'))
    ok('and the first question follows it', on_q(r, sid, 1, 10) is True, see(r, sid))
    r.close_tab(tid)
    tid, sid = r.open(PHONE + '&sting=0', before='window.__vpDemoAutoplay=true;', width=390, height=844)
    ok('window.__vpDemoAutoplay (set by a test before the page runs, never by an address) gives the sales-page round on its own',
       r.until(sid, 'document.documentElement.getAttribute("data-vp-demo-mode")==="auto" && document.querySelectorAll("#pAnswers .pans.picked").length===1', 12) is True, see(r, sid))
    r.close_tab(tid)
    tid, sid = r.open(PHONE + '&sting=0&autoplay=1&embed=1&__vpDemoAutoplay=true', width=390, height=844)
    r.until(sid, 'document.readyState==="complete"', 15); time.sleep(6)
    ok('no address turns the self-playing round on in a top window (autoplay=1, embed=1, the hook\'s name)', see(r, sid).get('mode') == 'solo' and see(r, sid).get('view') == 'vWait', see(r, sid))
    r.close_tab(tid)

def main():
    if not take_lock():
        return 2
    import rig as RIG
    r = RIG.Rig()
    try:
        embedded(r)
        tid, sid = standalone(r)
        callback(r, tid, sid)
        show_and_hook(r)
    except Exception:
        import traceback; traceback.print_exc()
        global bad; bad += 1
    finally:
        r.close()
    print('\n%d of %d checks passed' % (ran - bad, ran))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
