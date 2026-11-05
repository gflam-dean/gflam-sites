#!/usr/bin/env python3
"""EVERY EMAIL FITS A PHONE (Dean's coordinator, 5 Nov 2026): at 320, 375 and 390 px wide nothing is cut off and nothing
scrolls sideways. An email card that is wider than the screen loses the right-hand end of every line.

Renders the eight site templates (placeholders filled, with a long unbroken link in the venue name and TV address) and the
Worker's venue card, staff card and help desk card (real functions, long content) in headless Chrome, and measures the
document's scrollWidth and every element's right edge. Chrome runs under /tmp/vp-heavy.lock (VP_WAIT_LOCK=<seconds>).
"""
import json, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
LONG = 'https://venueplay.com.au/app/go#t=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123'
FILL = {'venue_name': 'The Wellshot Hotel and Bowls Club', 'support_email': 'hello@venueplay.com.au', 'player_count': '24', 'host_console_url': LONG,
        'tv_url': LONG, 'support_tel': '+61752283667', 'support_phone': '07 5228 3667', 'unsubscribe_url': LONG, 'terms_url': LONG,
        'privacy_url': LONG, 'player_rate': '$2.50', 'due_date': '12 November 2026', 'cancel_url': LONG, 'greeting': 'Hi Sam,',
        'signoff': 'Cheers,<br>the venueplay team<br>venueplay.com.au', 'nobingo_places': 'South Australia'}
fails = ran = 0
def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok or saw is None else '   ' + str(saw)[:300]))
    if not ok: fails += 1

pages = {}
for f in sorted(os.listdir(os.path.join(ROOT, 'venueplay', 'emails'))):
    h = open(os.path.join(ROOT, 'venueplay', 'emails', f), encoding='utf-8').read()
    h = re.sub(r'\{\{([a-z_]+)\}\}', lambda m: FILL.get(m.group(1), '$60.00'), h)
    pages['template ' + f] = h
JS = r'''
var SRC = readFile(arguments[0]);
function lift(src, name) { var m = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  var i = src.indexOf("{", m.index), d = 0; for (var j = i; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) return src.slice(m.index, j + 1); } } }
var VP_ABN = (/const VP_ABN = '([^']+)'/.exec(SRC) || [, ""])[1];
var VP_SUPPORT_PHONE = '07 5228 3667', VP_SUPPORT_TEL = '+61752283667';
["vpaEsc","vpaSupportPhoneHtml","vpaVenueEmailFoot","vpaEmailDocument","vpaVenueEmailCard","vpaStaffPill","vpaStaffCard","helpEmailCard","helpBrandFooter","helpHtml","helpLine","helpLinkify","helpSignsOff","helpCountry","helpRef","helpSignatureHtml","helpThreadDate","helpFirstName","helpThreadHtml","helpReplyHtml"].forEach(function (n) { (0, eval)(lift(SRC, n)); });
var HELP_LINK = (/const HELP_LINK = '([^']+)'/.exec(SRC) || [, ""])[1]; var HELP_THREAD_MAX = 10; var HELP_REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var L = arguments[1], body = '<h1 style="font-size:24px">Thanks, your payment went through</h1><p>Here is the link: ' + L + '</p><p>Email: someone.with.a.very.long.address.for.a.venue@thewellshothotelandbowlsclub.com.au</p>' + vpaVenueEmailFoot(true);
print("@@" + JSON.stringify({ "worker venue card": vpaVenueEmailCard("p", body, "T"), "worker staff card": vpaStaffCard(body, "A"), "worker help card": helpEmailCard(false, body, helpBrandFooter(false), "H", "p"), "worker help reply with thread": helpReplyHtml({ brand: "venueplay", ticket_no: 1002, category: "sales", reply_token: "abcdefghijkl" }, "Hi Sam, the link is " + L + " and the long address someone.with.a.very.long.address.for.a.venue@thewellshothotelandbowlsclub.com.au", "sales@venueplay.com.au", "Kayla", [{ who: "Sam Taylor", at: "2026-11-04T01:00:00Z", body: "Earlier message with a long link " + L }, { who: "Kayla", at: "2026-11-03T01:00:00Z", body: "Our earlier reply " + L }]) }));
'''
tmp = tempfile.mkdtemp(prefix='emailfit-')
open(tmp + '/r.js', 'w').write(JS)
out = subprocess.run([JSC, tmp + '/r.js', '--', os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js'), LONG], capture_output=True, text=True).stdout
pages.update(json.loads(out[out.index('@@') + 2:]))
# Chrome's headless window will not go narrower than about 500 px, so a window-size run lays the email out at 500 and
# only CROPS the picture to 375 (that fooled the first screenshots). The email goes in an iframe of the exact width instead:
# its layout viewport really is 320, 375 or 390 wide.
import html as H
WRAP = ('<!doctype html><body style="margin:0"><iframe id=f style="width:%dpx;height:900px;border:0" srcdoc="%s"></iframe><script>'
        'setTimeout(function(){var d=document.getElementById("f").contentDocument,e=d.documentElement,m=0,bad="";'
        'd.querySelectorAll("*").forEach(function(x){var r=x.getBoundingClientRect();if(r.width>0&&r.right>m){m=r.right;bad=x.tagName+":"+(x.textContent||"").slice(0,30)}});'
        'document.body.insertAdjacentHTML("beforeend","<pre id=probe>"+JSON.stringify({sw:e.scrollWidth,cw:e.clientWidth,right:Math.round(m),el:bad})+"</pre>")},800)</script>')
gatelib.hold_lock_or_refuse('email-fit-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0')))
prof = tempfile.mkdtemp(prefix='emailfit-chrome-')
for name, h in pages.items():
    h = h.replace('src="https://venueplay.com.au/logos/', 'src="file://' + os.path.join(ROOT, 'venueplay', 'logos') + '/')
    for w in (320, 375, 390):
        path = os.path.join(tmp, re.sub(r'\W+', '-', name) + '-%d.html' % w)
        open(path, 'w', encoding='utf-8').write(WRAP % (w, H.escape(h, quote=True)))
        r = subprocess.run([CH, '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--user-data-dir=' + prof, '--window-size=900,900',
                            '--virtual-time-budget=4000', '--dump-dom', 'file://' + path], capture_output=True, text=True, timeout=120)
        m = re.search(r'<pre id="probe">(.*?)</pre>', r.stdout, re.S)
        j = json.loads(m.group(1).replace('&quot;', '"')) if m else {}
        ok = bool(j) and j['cw'] == w and j['sw'] <= j['cw'] and j['right'] <= j['cw'] + 1
        check('%s fits %d px wide (nothing cut off, no sideways scroll)' % (name, w), ok, j or r.stdout[-200:])
print('\n%s' % ('ALL %d CHECKS PASSED' % ran if not fails else '%d of %d FAILED' % (fails, ran)))
sys.exit(1 if fails else 0)
