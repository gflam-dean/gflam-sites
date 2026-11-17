/* NO EMAIL TO A QUICK SIGN-UP'S PLACEHOLDER (18 Nov 2026, fix/no-mail-to-placeholder). A quick sign-up's login is
   m<digits>.<hex>@phone.venueplay.com.au (vpqPlaceholderEmail). A review found HQ's Approve emailing it, and the audit
   of 18 Nov found more doors to it (the HQ sign-in link reads the login's email, the cancel and last-day emails read
   every login's email, a help desk ticket raised from the console takes the login's email). ONE guard closes them all:
   the outbox guard block every Worker installs on fetch takes placeholder addresses off any Resend send, and refuses
   (422) a send left with nobody.

   This RUNS the guard block lifted from the LIVE billing Worker (venueplay-api-FULL.js; test-outbox-guard.js proves the
   other copies are the same text), and RUNS the Worker's own send helpers (vpaSendEmail, helpSendEmail and the prospect
   welcome) through it, with a stand-in network.

   Run from the repo root:  jsc tools/test-no-mail-to-placeholder.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
var API = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
function lift(text) {
  var a = text.indexOf('/* OUTBOX GUARD BEGIN'), b = text.indexOf('/* OUTBOX GUARD END */');
  if (a < 0 || b < 0) throw new Error('no OUTBOX GUARD block: a test that cannot find its subject cannot fail');
  return text.slice(a, b + '/* OUTBOX GUARD END */'.length);
}
function fn(name) {   // one top-level function of the Worker, as written
  var a = API.indexOf('\nasync function ' + name + '(');
  if (a < 0) a = API.indexOf('\nfunction ' + name + '(');
  if (a < 0) throw new Error('no function ' + name + ' in the billing Worker');
  var b = API.indexOf('\n}\n', a);
  return API.slice(a, b + 3);
}
var SRC = lift(API);

function FakeResponse(body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; this.ok = this.status >= 200 && this.status < 300; }
FakeResponse.prototype.json = function () { return Promise.resolve(JSON.parse(this.body)); };
function FakeURL(s) { var m = /^https?:\/\/([^\/?#:]+)/.exec(s); if (!m) throw new TypeError('bad url'); this.hostname = m[1]; this.href = s; }
globalThis.Response = FakeResponse; globalThis.URL = FakeURL;
var logs = []; globalThis.console = { log: function (s) { logs.push(String(s)); } };

var W = null;
function boot(env) {   // a fresh isolate: new stand-in network, the guard installed as the Worker installs it
  var sent = [];
  globalThis.fetch = function (input, init) { sent.push({ url: typeof input === 'string' ? input : input.url, init: init, to: (function () { try { return JSON.parse(init.body); } catch (e) { return null; } })() }); return Promise.resolve(new FakeResponse('{"id":"real-1"}', { status: 200 })); };
  globalThis.__vpgInstalled = false; globalThis.__vpOutbox = []; logs = [];
  W = (new Function('return (function(){' + SRC + '\n'
    + 'const VPA_PROSPECT_REPLY_TO = "hello@venueplay.com.au";\n'
    + 'function helpPlainFromHtml(h) { return String(h || ""); }\n'
    + 'async function vpaRenderProspectWelcome() { return "<p>welcome</p>"; }\n'
    + 'function vpaProspectFrom() { return "Harry at venueplay <hello@send.venueplay.com.au>"; }\n'
    + 'function vpaProspectSubject(v) { return "Your venueplay for " + v; }\n'
    + 'async function vpUnsubHeaders() { return {}; }\n'
    + fn('vpaSendEmail') + fn('helpSendEmail') + fn('vpaFireProspectWelcome')
    + '\nreturn { VPG: VPG, vpgInstall: vpgInstall, vpgIsPlaceholderEmail: vpgIsPlaceholderEmail, vpaSendEmail: vpaSendEmail, helpSendEmail: helpSendEmail, vpaFireProspectWelcome: vpaFireProspectWelcome };})()'))();
  W.vpgInstall(env);
  return sent;
}
var RESEND = 'https://api.resend.com/emails';
var PH = 'm412345678.a1b2c3d4e5f6@phone.venueplay.com.au';
var LIVE = { RESEND_API_KEY: 're_live_x' };
var STG = { VP_ENV: 'staging', SUPABASE_URL: 'https://testproj.supabase.co', RESEND_API_KEY: 'staging-dummy', STRIPE_SECRET_KEY: 'sk_test_abc' };
function post(body) { return { method: 'POST', headers: {}, body: JSON.stringify(body) }; }

var SECS = [];
print('the settings');
SECS.push(async function () {
  boot(LIVE);
  var m = /const VPQ_PLACEHOLDER_DOMAIN = '([^']+)'/.exec(API);
  check('the guard\'s domain is the very domain quick sign-ups are given (VPQ_PLACEHOLDER_DOMAIN)', !!m && W.VPG.placeholderEmailDomain === m[1], m && m[1]);
  check('a placeholder is one, in any case, bare or "Name <addr>"', W.vpgIsPlaceholderEmail(PH) && W.vpgIsPlaceholderEmail(PH.toUpperCase()) && W.vpgIsPlaceholderEmail('Jo <' + PH + '>') && W.vpgIsPlaceholderEmail(' ' + PH + ' '));
  check('look-alikes are NOT (another subdomain, a longer domain, venueplay itself, empty)', !W.vpgIsPlaceholderEmail('a@notphone.venueplay.com.au') && !W.vpgIsPlaceholderEmail('a@phone.venueplay.com.au.evil.com') && !W.vpgIsPlaceholderEmail('a@venueplay.com.au') && !W.vpgIsPlaceholderEmail('') && !W.vpgIsPlaceholderEmail('phone.venueplay.com.au'));
  var sends = (API.match(/fetch\('https:\/\/api\.resend\.com\/emails', \{/g) || []).length;
  var aliased = /^(const|let|var) [A-Za-z_$][\w$]* = (globalThis\.)?fetch\b/m.test(API);
  check('every Resend send in the billing Worker is a plain fetch( (so it passes the guard), and nothing keeps the unguarded fetch', sends >= 10 && !aliased, { sends: sends, aliased: aliased });
});

print('LIVE: never to a placeholder, real people untouched');
SECS.push(async function () {
  var sent = boot(LIVE), x;
  x = await globalThis.fetch(RESEND, post({ to: [PH], subject: 'Welcome' }));
  check('an email only to a placeholder is NOT sent', sent.length === 0, sent);
  check('...and the caller is told it failed (422, marked), never a false "sent"', x && x.status === 422 && x.ok === false && x.headers['x-vp-outbox-guard'] === 'refused-placeholder', x && x.status);
  check('...with one log line that says why', logs.filter(function (l) { return /^\[outbox-guard\] placeholder POST api\.resend\.com \(1 placeholder address on phone\.venueplay\.com\.au and nobody else: NOT SENT\)$/.test(l); }).length === 1, logs);
  x = await globalThis.fetch(RESEND, post({ to: 'Jo <' + PH.toUpperCase() + '>', subject: 's' }));
  check('a single "to" string, any case, with a name, is refused too', sent.length === 0 && x.status === 422);
  x = await globalThis.fetch(RESEND, post({ to: ['owner@realpub.com.au', PH], cc: [PH], bcc: PH, subject: 's' }));
  check('a list with a real person goes to the real person only (to, cc and bcc cleared of the placeholder)', sent.length === 1 && JSON.stringify(sent[0].to.to) === '["owner@realpub.com.au"]' && sent[0].to.cc === undefined && sent[0].to.bcc === undefined && x.status === 200, sent[0] && sent[0].to);
  check('...the rest of the message is unchanged', sent[0] && sent[0].to.subject === 's' && sent[0].init.method === 'POST');
  x = await globalThis.fetch(RESEND, post({ to: ['owner@realpub.com.au'], cc: [PH] }));
  check('a placeholder only in cc is taken off and the email still goes to "to"', sent.length === 2 && sent[1].to.cc === undefined && x.status === 200);
  x = await globalThis.fetch(RESEND + '/batch', post([{ to: [PH], subject: 'a' }, { to: ['b@realpub.com.au'], subject: 'b' }]));
  check('a batch with a message left with nobody is refused whole (no half-sent batch)', sent.length === 2 && x.status === 422);
  var body = JSON.stringify({ to: ['owner@realpub.com.au'], subject: 'untouched' });
  x = await globalThis.fetch(RESEND, { method: 'POST', headers: {}, body: body });
  check('a real email goes byte for byte as it was', sent.length === 3 && sent[2].init.body === body && x.status === 200);
  x = await globalThis.fetch(RESEND, post({ to: ['a@notphone.venueplay.com.au'] }));
  check('a look-alike address is sent', sent.length === 4);
  x = await globalThis.fetch(RESEND + '/abc/cancel', { method: 'POST' });
  check('a cancel with no body passes', sent.length === 5);
  x = await globalThis.fetch('https://api.mobilemessage.com.au/v1/messages', post({ messages: [{ to: '+61412345678', message: 'hi' }] }));
  check('a text (not email) is never touched', sent.length === 6);
});

print('STAGING: refused the same way (not a fake "sent")');
SECS.push(async function () {
  var sent = boot(STG), x;
  x = await globalThis.fetch(RESEND, post({ to: [PH] }));
  check('staging refuses a placeholder-only email with the same 422', sent.length === 0 && x.status === 422, x && x.status);
  x = await globalThis.fetch(RESEND, post({ to: ['owner@realpub.com.au', PH] }));
  check('...and a mixed one still never leaves staging (outbox "sent")', sent.length === 0 && x.status === 200 && /staging-blocked/.test(x.body));
  check('...the staging outbox holds it with the placeholder already gone', globalThis.__vpOutbox.some(function (r) { return r.kind === 'send' && r.to.length === 1; }), globalThis.__vpOutbox);
});

print('THE WORKER\'S OWN SENDERS, run through the guard');
SECS.push(async function () {
  var sent = boot(LIVE), r;
  r = await W.vpaSendEmail(LIVE, PH, 'Your venueplay sign-in link', '<p>x</p>');
  check('vpaSendEmail (sign-in link, cancel, last day, members reminder, monthly report...) to a placeholder: nothing sent, returns false', r === false && sent.length === 0, r);
  r = await W.helpSendEmail(LIVE, { to: PH, from: 'venueplay Help Desk <hello@send.venueplay.com.au>', subject: 'We got your message', html: '<p>x</p>' });
  check('helpSendEmail (help desk acknowledgement and replies) to a placeholder: nothing sent, returns false', r === false && sent.length === 0, r);
  r = await W.vpaFireProspectWelcome(LIVE, { email: PH, venueName: 'The Test Pub' });
  check('the prospect welcome (what HQ Approve sends) to a placeholder: nothing sent, { ok: false } so HQ is told it did not go', r && r.ok === false && sent.length === 0, r);
  r = await W.vpaSendEmail(LIVE, 'owner@realpub.com.au', 'Hi', '<p>x</p>');
  check('vpaSendEmail to a real owner still sends', r === true && sent.length === 1);
  r = await W.vpaFireProspectWelcome(LIVE, { email: 'owner@realpub.com.au', venueName: 'The Test Pub' });
  check('the prospect welcome to a real email still sends', r && r.ok === true && sent.length === 2, r);
});

(async function () { for (var i = 0; i < SECS.length; i++) await SECS[i](); print(fails ? ran + ' checks, ' + fails + ' failed' : 'ALL ' + ran + ' CHECKS PASSED'); if (fails) exit(1); })().catch(function (e) { print('CRASH ' + e + ' ' + (e && e.stack)); exit(1); });
