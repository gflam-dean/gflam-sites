#!/usr/bin/env python3
"""THE FOOT OF EVERY EMAIL, ON A PHONE (Dean, 12 Nov 2026, INBOX 276.A).

Dean, on the free month email: "You're getting this email because we set up venueplay for Bodalla Pub at your request"
looked stupid run in with everything else. The rule for ALL our emails: the "why you are getting this" line, a GAP, the
venueplay logo, then the other lines, each on ONE line on a phone, and the PHONE NUMBER never wrapped (in a row).

This RUNS the shipped billing Worker in jsc (fetch, the database and the auth API stubbed, nothing sent) and renders the
real email each sender hands to Resend, then lays each one out in headless Chrome in an iframe exactly 320, 375 and 390
px wide (the window cannot go that narrow, so a window-size run would only crop) and measures:
  - the foot block is there: data-vp-foot="block", its FIRST thing is the venueplay logo (the solid header file, so a
    mail app's dark mode cannot lose it), and every line after it is 12px or more;
  - when the email says why they are getting it, that line is ABOVE the logo with a clear gap (24px or more);
  - at 375 and 390 every foot line is ONE line (one line box tall), and at 320 none runs off the card;
  - EVERY tel: link in the email (body and foot) is one line box: 07 5228 3667 never breaks, at all three widths;
  - nothing in the email is wider than the screen.
The help desk emails carry the brand's signature (logo, phone) above their own one-line foot and are checked for the
phone and the width only; the staff alerts (the cancel alert and the like) go to us and are not venue email.

Chrome runs under /tmp/vp-heavy.lock (VP_WAIT_LOCK=<seconds>).
"""
import html as H, json, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gatelib
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

fails = ran = 0
def check(name, ok, saw=None):
    global fails, ran
    ran += 1
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok or saw is None else '   ' + str(saw)[:400]))
    if not ok: fails += 1

JS = r'''
var src = readFile(arguments[0]).replace(/^export default/m, 'var _d =').replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '').replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
var ROOT = arguments[1];
console = { log: function () {}, warn: function () {}, error: function () {} };
if (typeof AbortController === 'undefined') { AbortController = function () { this.signal = {}; }; AbortController.prototype.abort = function () {}; }
if (typeof clearTimeout === 'undefined') { clearTimeout = function () {}; }
if (typeof setTimeout === 'undefined') { setTimeout = function (f) { Promise.resolve().then(f); return 1; }; }
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
crypto = { subtle: { digest: function (a, b) { return Promise.resolve(fnv(new Uint8Array(b), 1).buffer); },
  importKey: function (f, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (a, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } },
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 37) & 255; return a; }, randomUUID: function () { return '00000000-0000-4000-8000-000000000000'; } };
(0, eval)(src);
function drain() { if (typeof drainMicrotasks === 'function') for (var i = 0; i < 80; i++) drainMicrotasks(); }
var sent = [];
fetch = function (url, opts) {
  url = String(url);
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) { var t = readFile(ROOT + '/venueplay/emails/' + m[1]); return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(t); } }); }
  if (/api\.resend\.com\/emails$/.test(url)) { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ id: 'e1' }); }, text: function () { return Promise.resolve('{"id":"e1"}'); } }); }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); }, text: function () { return Promise.resolve('[]'); } });
};
vpaInsert = function () { return Promise.resolve({}); };
vpaPatch = function () { return Promise.resolve({}); };
vpaAudit = function () { return Promise.resolve(true); };
var DBX = {};
vpaSelect = function (env, table, q) {
  if (DBX[table]) return Promise.resolve(DBX[table]);
  if (table === 'venueplay_founding') return Promise.resolve([{ id: 'f1', contact_email: 'owner@pub.com', contact_name: 'Sam', payment_reminders: true, plan: 'monthly', max_seats: 40 }]);
  return Promise.resolve([]);
};
var ENV = { RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au', CARD_LINK_SECRET: 's3cret', FOUNDING_CODES: 'OFFER-NOV-2026', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' };
var INV = { id: 'in_ABC123', number: 'ABC-0001', customer: 'cus_1', customer_email: 'owner@pub.com', amount_paid: 6000, amount_due: 6000,
  hosted_invoice_url: 'https://invoice.stripe.com/i/acct_x/test_1', invoice_pdf: 'https://pay.stripe.com/invoice/acct_x/test_1/pdf',
  next_payment_attempt: 1796342400, status_transitions: { paid_at: 1796342400 }, subscription: 'sub_1',
  lines: { data: [{ description: '24 Players × Founding Membership (Monthly) (at $2.50 / month)', amount: 6000, quantity: 24, period: { start: 1796306400, end: 1798984800 } }] } };
function clone(o, extra) { var c = JSON.parse(JSON.stringify(o)); for (var k in (extra || {})) c[k] = extra[k]; return c; }
var OUT = {}, ERR = {};
function grab(name) { var m = sent[sent.length - 1]; if (m && m.html) OUT[name] = m.html; else ERR[name] = 'nothing sent'; sent = []; }
async function one(name, f) { sent = []; try { var r = await f(); if (r && r.html && !sent.length) OUT[name] = r.html; else if (typeof r === 'string') OUT[name] = r; else grab(name); } catch (e) { ERR[name] = String(e) + ' ' + String(e && e.stack).slice(0, 300); } }
async function main() {
  await one('welcome (one venue)', function () { return vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 }, [{ name: 'The Wellshot Hotel and Bowls Club', seats: 40, slug: 'the-royal-hotel-4220' }], false); });
  await one('welcome (group)', function () { return vpaFireWelcome(ENV, { metadata: { tier: 'founding' } }, { contact_email: 'owner@group.com', contact_name: 'Sam', plan: 'monthly' }, [{ name: 'The Anchor', seats: 30, slug: 'the-anchor-2000' }, { name: 'The Crown', seats: 50, slug: 'the-crown-3000' }], true); });
  await one('welcome (HQ set up)', function () { return vpaFireHqWelcome(ENV, { email: 'o@pub.com', venueName: 'The Royal Hotel', seats: 24, foundingId: 'f1' }); });
  await one('host onboarding (a new venue, to the owner)', function () { return vpbFireVenueOnboarding(ENV, { email: 'o@pub.com', venueName: 'The Crown', loginVenues: 2 }); });
  await one('welcome (prospect, set up for them)', function () { return vpaRenderProspectWelcome(ENV, { email: 'gm@pub.com', firstName: 'Paul', venueName: 'Bodalla Pub', seats: 10, offerCode: 'OFFER-NOV-2026', mobile: '0412345678', mobileLogin: true }).then(function (x) { return typeof x === 'string' ? x : x.html; }); });
  await one('welcome (self sign-up)', function () { return vpsRenderReady(ENV, { venueName: 'The Royal Hotel', contactName: 'Sam', mobileWords: '0412 345 678', tvCode: 'TV0001', email: 'o@pub.com' }); });
  var R = { firstName: 'Paul', venueName: 'Bodalla Pub', endsWordsX: 1, endsWords: 'Thu 10 December', offerRate: 2.5, cardUrl: 'https://venueplay.com.au/add-card?f=f1&t=x', cancelUrl: 'https://venueplay.com.au/prospect/cancel/?f=f1&t=x', email: 'gm@pub.com' };
  var ST = { ok: true, nights: 4, totalGames: 6, totalPlayers: 148, subscribers: 32, regulars: 21, biggest: { players: 47, at: '2026-11-27T09:30:00Z' } };
  await one('free month reminder (day 3)', function () { return vpaRenderProspectReminder(ENV, Object.assign({}, R, { kind: 'early', daysLeft: 27, stats: null })); });
  await one('free month reminder (one week left)', function () { return vpaRenderProspectReminder(ENV, Object.assign({}, R, { kind: 'last', daysLeft: 8, stats: ST })); });
  await one('free month reminder (last day, the card reminder)', function () { return vpaRenderProspectReminder(ENV, Object.assign({}, R, { kind: 'final', daysLeft: 1, stats: ST })); });
  await one('free month end (after a cancel)', function () { return vpaRenderTrialEndNote(ENV, { venueName: 'Bodalla Pub', firstName: 'Paul', email: 'bodallahotel@gmail.com', endsLong: 'Thursday 10 December', endsShort: '10 December', cardUrl: 'https://venueplay.com.au/add-card?f=f1&t=x' }); });
  await one('members list reminder', function () { return vpaRenderMembersReminder(ENV, { venueName: 'Bodalla Pub', firstName: 'Paul', day: 'tue' }); });
  vpaAuthGetUser = function () { return Promise.resolve({ id: 'u1', email: 'paul@bodallapub.com.au', phone: '61412345678', user_metadata: { full_name: 'Paul Smith' } }); };
  vpaProspectLinkWindow = function () { return Promise.resolve(null); };
  vpaMintSigninLinkFor = function () { return Promise.resolve({ token: 'tok123', expiresAt: Date.now() + 90 * 86400000, shortened: false }); };
  DBX.vp_venue_staff = [{ venue_id: 'v1', role: 'owner' }]; DBX.vp_venues = [{ id: 'v1', name: 'Bodalla Pub' }]; DBX.vp_signin_links = [];
  await one('sign-in link', function () { return vpaSendSigninLink(ENV, 'u1', 'v1', { hq: true }); });
  DBX = {};
  await one('payment reminder (before a charge)', function () { return vpaFireUpcomingEmail(ENV, clone(INV, { amount_paid: 0 })); });
  await one('receipt (tax invoice link)', function () { return vpaFireInvoiceEmail(ENV, INV); });
  await one('payment failed', function () { return vpaFirePaymentFailedEmail(ENV, clone(INV, { amount_paid: 0, attempt_count: 1, billing_reason: 'subscription_cycle' }), null, true); });
  await one('cancel confirmed (leaving)', function () { return vpaLeavingHtml(ENV, { heading: 'Your cancellation is confirmed', lead: 'Bodalla Pub stays on until Friday 4 December.', rows: [['Last day', 'Friday 4 December']] }); });
  await one('subscriber confirmation (monthly email)', function () { return vpsConfirmationEmail(ENV, 'player@example.com', 'Bodalla Pub', Date.parse('2026-11-12T00:00:00Z')); });
  await one('invite back (winback foot)', function () { return vpUnsubFooterHtml(ENV, 'owner@pub.com', 'winback').then(function (f) { return vpaVenueEmailCard('p', '<p>Keep Bodalla Pub on venueplay?</p>' + f, 'Keep'); }); });
  await one('monthly report foot', function () { return vpUnsubFooterHtml(ENV, 'owner@pub.com', 'monthly-report').then(function (f) { return vpaVenueEmailCard('p', '<p>Your October at Bodalla Pub</p>' + f, 'Report'); }); });
  await one('help desk acknowledgement (signature carries the logo)', function () { return helpAckHtml ? helpAckHtml({ brand: 'venueplay', ticket_no: 1001, contact_name: 'Jo', category: 'sales' }) : null; });
  print('@@' + JSON.stringify({ out: OUT, err: ERR }));
}
main().then(function () {}, function (e) { print('@@' + JSON.stringify({ out: OUT, err: { main: String(e) } })); });
drain();
'''
tmp = tempfile.mkdtemp(prefix='emailfoot-')
open(tmp + '/r.js', 'w').write(JS)
r = subprocess.run([JSC, tmp + '/r.js', '--', os.path.join(ROOT, 'venueplay-backend', 'worker', 'venueplay-api-FULL.js'), ROOT], capture_output=True, text=True, timeout=120)
txt = r.stdout
j = json.loads(txt[txt.index('@@') + 2:].strip().splitlines()[0]) if '@@' in txt else {'out': {}, 'err': {'jsc': (r.stderr or txt)[-400:]}}
pages, errs = j['out'], j['err']
# The two site templates the Worker has no sender for today keep the same foot by hand.
FILL = {'venue_name': 'The Wellshot Hotel and Bowls Club', 'support_email': 'hello@venueplay.com.au', 'support_tel': '+61752283667', 'support_phone': '07 5228 3667'}
for f in ('upcoming-payment.html', 'upcoming-payment-group.html'):
    h = open(os.path.join(ROOT, 'venueplay', 'emails', f), encoding='utf-8').read()
    pages['template ' + f] = re.sub(r'\{\{([a-z_]+)\}\}', lambda m: FILL.get(m.group(1), '$60.00'), h)
HELP = {k for k in pages if k.startswith('help desk')}
# A player who signed up for the monthly email is not a venue: the support line is for venues only (VP_SUPPORT_PHONE's
# note: never on a player's screen). The two upcoming-payment templates point at the accounts mailbox, as they always have.
NOPHONE = {'subscriber confirmation (monthly email)', 'template upcoming-payment.html', 'template upcoming-payment-group.html'}
EXPECT = ['welcome (one venue)', 'welcome (group)', 'welcome (HQ set up)', 'host onboarding (a new venue, to the owner)', 'welcome (prospect, set up for them)',
          'welcome (self sign-up)', 'free month reminder (day 3)', 'free month reminder (one week left)', 'free month reminder (last day, the card reminder)',
          'free month end (after a cancel)', 'members list reminder', 'sign-in link', 'payment reminder (before a charge)', 'receipt (tax invoice link)',
          'payment failed', 'cancel confirmed (leaving)', 'subscriber confirmation (monthly email)', 'invite back (winback foot)', 'monthly report foot']
WHY = {'free month end (after a cancel)', 'welcome (prospect, set up for them)', 'welcome (self sign-up)', 'free month reminder (day 3)', 'free month reminder (one week left)',
       'free month reminder (last day, the card reminder)', 'subscriber confirmation (monthly email)', 'invite back (winback foot)', 'monthly report foot'}
print('Every email we send a venue: rendered by the real Worker (%d) + 2 site templates\n' % len(EXPECT))
for n in EXPECT:
    check('%s: the real sender built it' % n, n in pages, errs.get(n))

PROBE = r'''
setTimeout(function(){var d=document.getElementById("f").contentDocument,w=d.defaultView,e=d.documentElement,o={sw:e.scrollWidth,cw:e.clientWidth};
function lines(x){var cs=w.getComputedStyle(x),lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.5,r=x.getBoundingClientRect();return {h:r.height,lh:lh,fs:parseFloat(cs.fontSize),n:Math.round(r.height/lh),right:r.right,t:(x.textContent||"").replace(/\s+/g," ").trim().slice(0,70)};}
var b=d.querySelector('[data-vp-foot="block"]');o.block=!!b;
if(b){var first=b.querySelector("img,p");o.firstImg=first&&first.tagName==="IMG"?{src:first.getAttribute("src"),alt:first.getAttribute("alt"),top:first.getBoundingClientRect().top,w:first.getBoundingClientRect().width}:null;
o.lines=[].map.call(b.querySelectorAll('[data-vp-foot="line"]'),lines);}
var y=d.querySelector('[data-vp-foot="why"]');o.why=y?{bottom:y.getBoundingClientRect().bottom,t:(y.textContent||"").slice(0,60)}:null;
o.tels=[].map.call(d.querySelectorAll('a[href^="tel:"]'),function(a){var rs=a.getClientRects(),cs=w.getComputedStyle(a),lh=parseFloat(w.getComputedStyle(a.parentElement).lineHeight)||parseFloat(cs.fontSize)*1.5;
 var sp=a.parentElement,unit=(sp&&w.getComputedStyle(sp).whiteSpace==="nowrap")?Math.round(sp.getBoundingClientRect().height/lh):0;return {rects:rs.length,h:a.getBoundingClientRect().height,lh:lh,t:a.textContent,unit:unit,after:sp?(sp.textContent||"").slice(0,40):""};});
var m=0;d.querySelectorAll("*").forEach(function(x){var r=x.getBoundingClientRect();if(r.width>0&&r.right>m)m=r.right;});o.right=Math.round(m);
document.body.insertAdjacentHTML("beforeend","<pre id=probe>"+JSON.stringify(o)+"</pre>")},900)'''
WRAP = '<!doctype html><body style="margin:0"><iframe id=f style="width:%dpx;height:1400px;border:0" srcdoc="%s"></iframe><script>' + PROBE + '</script>'
gatelib.hold_lock_or_refuse('email-footer-in-chrome', wait_s=int(os.environ.get('VP_WAIT_LOCK', '0')))
prof = tempfile.mkdtemp(prefix='emailfoot-chrome-')
shots = os.environ.get('VP_EMAIL_FOOT_SHOTS')   # a folder: also writes each email at 375 and 600 as .html for the report page
for name in sorted(pages):
    h = pages[name].replace('src="https://venueplay.com.au/logos/', 'src="file://' + os.path.join(ROOT, 'venueplay', 'logos') + '/')
    if shots:
        os.makedirs(shots, exist_ok=True)
        open(os.path.join(shots, re.sub(r'\W+', '-', name).strip('-') + '.html'), 'w', encoding='utf-8').write(pages[name])
    for wpx in (320, 375, 390):
        path = os.path.join(tmp, re.sub(r'\W+', '-', name) + '-%d.html' % wpx)
        open(path, 'w', encoding='utf-8').write(WRAP % (wpx, H.escape(h, quote=True)))
        cr = subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--user-data-dir=' + prof, '--window-size=900,1500',
                             '--virtual-time-budget=4000', '--dump-dom', 'file://' + path], capture_output=True, text=True, timeout=120)
        m = re.search(r'<pre id="probe">(.*?)</pre>', cr.stdout, re.S)
        o = json.loads(H.unescape(m.group(1))) if m else {}
        tag = '%s at %d px' % (name, wpx)
        check(tag + ': nothing wider than the screen', bool(o) and o['cw'] == wpx and o['sw'] <= o['cw'] and o['right'] <= o['cw'] + 1, o and {k: o[k] for k in ('sw', 'cw', 'right')})
        tels = (o or {}).get('tels') or []
        check(tag + (': no support phone (not a venue email), and no tel: link at all' if name in NOPHONE else ': the phone number is in it, and every 07 5228 3667 sits on ONE line (never broken)'),
              (not tels) if name in NOPHONE else bool(tels) and all(t['t'] == '07 5228 3667' and t['rects'] == 1 and t['h'] <= t['lh'] * 1.3 for t in tels), tels)
        if name in HELP:
            continue
        if name not in NOPHONE:
            check(tag + ': the phone and what follows it ("and press 2." or ".") are one unbreakable piece (white-space:nowrap, one line box)',
                  any(t['unit'] == 1 for t in tels), tels)
        fi = (o or {}).get('firstImg') or {}
        check(tag + ': the foot block is there and starts with the venueplay logo (the solid header file, dark mode safe)',
              bool(o.get('block')) and fi.get('alt') == 'venueplay' and 'venueplay-email-header-solid.png' in (fi.get('src') or '') and 90 <= fi.get('w', 0) <= 120, o.get('block') and fi)
        ls = o.get('lines') or []
        check(tag + ': at least one small-print line under the logo, every one 12px or more', bool(ls) and all(l['fs'] >= 12 for l in ls), ls)
        if wpx in (375, 390):
            bad = [l for l in ls if l['n'] != 1]
            check(tag + ': EVERY foot line is ONE line (%d lines)' % len(ls), bool(ls) and not bad, bad)
        if name in WHY:
            y = o.get('why')
            check(tag + ': the "why you are getting this" line sits ABOVE the logo with a clear gap (24px or more)',
                  bool(y) and bool(fi) and fi['top'] - y['bottom'] >= 24, y and fi and {'gap': round(fi['top'] - y['bottom'])})
print('\n%s' % ('ALL %d CHECKS PASSED' % ran if not fails else '%d of %d FAILED' % (fails, ran)))
sys.exit(1 if fails else 0)
