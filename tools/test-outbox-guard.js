/* THE OUTBOX GUARD (INBOX 357B / 326, 13 Nov 2026). This RUNS the real guard block, lifted from each of the three Workers
   that can send (venueplay-api-FULL.js, venueplay-game.js, venueplay-sms-hook.js), with a stand-in for the network, and
   asks: on STAGING, does anything real leave (email, text, push, SMS hook, a write to a live venueplay address, a live
   Stripe key, the live database)? On LIVE, does a real message still go through untouched? Are the four copies the same?
   Does every handler call the guard first? The network, the clock and Cloudflare's Response/URL are stood in for.

   Run from the repo root:  jsc tools/test-outbox-guard.js
*/
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 300))); } }
var FILES = ['venueplay-backend/worker/venueplay-api-FULL.js', 'venueplay-backend/worker/venueplay-game.js', 'venueplay-backend/worker/venueplay-sms-hook.js'];
function lift(text, label) {
  var a = text.indexOf('/* OUTBOX GUARD BEGIN'), b = text.indexOf('/* OUTBOX GUARD END */');
  if (a < 0 || b < 0) throw new Error('no OUTBOX GUARD block in ' + label + ': a test that cannot find its subject cannot fail');
  return text.slice(a, b + '/* OUTBOX GUARD END */'.length);
}
var SRC = lift(readFile('venueplay-backend/worker/vp-outbox-guard.js'), 'vp-outbox-guard.js');
print('four copies, one text');
var WK = {};
FILES.forEach(function (f) {
  var t = readFile(f); WK[f] = t;
  check(f.split('/').pop() + ' carries the exact guard block', lift(t, f) === SRC);
  var m = t.match(/export default \{\s*\n\s*async fetch\(request, env\) \{\s*\n([^\n]*)/);
  check(f.split('/').pop() + ': fetch() installs the guard and refuses an unsafe setup on its first line', !!(m && /vpgInstall\(env\)/.test(m[1]) && /vpgRefuse\(env\)/.test(m[1])), m && m[1]);
  if (/async scheduled\(event, env, ctx\) \{/.test(t)) {
    var s = t.match(/async scheduled\(event, env, ctx\) \{\s*\n([^\n]*)/);
    check(f.split('/').pop() + ': scheduled() installs the guard and refuses an unsafe setup on its first line', !!(s && /vpgInstall\(env\)/.test(s[1]) && /vpgStagingProblem\(env\)/.test(s[1])), s && s[1]);
  }
});

/* stand-ins */
function FakeResponse(body, init) { this.body = body; this.status = (init && init.status) || 200; this.headers = (init && init.headers) || {}; this.ok = this.status >= 200 && this.status < 300; }
FakeResponse.prototype.json = function () { return Promise.resolve(JSON.parse(this.body)); };
function FakeURL(s) { var m = /^https?:\/\/([^\/?#:]+)/.exec(s); if (!m) throw new TypeError('bad url'); this.hostname = m[1]; this.href = s; }
globalThis.Response = FakeResponse; globalThis.URL = FakeURL;
var logs = []; globalThis.console = { log: function (s) { logs.push(String(s)); } };

function boot(env) {   // fresh isolate: new stand-in network, new guard
  var sent = [];
  globalThis.fetch = function (input, init) { sent.push({ url: typeof input === 'string' ? input : input.url, init: init }); return Promise.resolve(new FakeResponse('{"real":true}', { status: 200 })); };
  globalThis.__vpgInstalled = false; globalThis.__vpOutbox = [];
  var G = (new Function('return (function(){' + SRC + '\nreturn { VPG: VPG, vpgInstall: vpgInstall, vpgRefuse: vpgRefuse, vpgStagingProblem: vpgStagingProblem, vpgIsTestMobile: vpgIsTestMobile, vpgIsTestEmail: vpgIsTestEmail, vpgRecipients: vpgRecipients };})()'))();
  G.vpgInstall(env);
  return { G: G, sent: sent };
}
async function go(rig, url, init) { return await globalThis.fetch(url, init); }

var STG = { VP_ENV: 'staging', SUPABASE_URL: 'https://testproj.supabase.co', RESEND_API_KEY: 'staging-dummy', SEND_SMS_HOOK_URL: 'https://hook.example-staging-hook.workers.dev/sms', STRIPE_SECRET_KEY: 'sk_test_' + 'abc' };
var RESEND = 'https://api.resend.com/emails', MM = 'https://api.mobilemessage.com.au/v1/messages', CS = 'https://rest.clicksend.com/v3/sms/send';
function post(body, headers) { return { method: 'POST', headers: headers || {}, body: JSON.stringify(body) }; }

var SECS = [], TITLES = [];
print('STAGING: nothing real leaves');
SECS.push(async function () {
  var r = boot(STG), x;
  x = await go(r, RESEND, post({ to: ['pub@realpub.com.au'], subject: 's' }));
  check('an email to a REAL address is not sent', r.sent.length === 0, r.sent);
  check('...but the caller sees a believable "sent" (id, 200)', x && x.status === 200 && /"id":"staging-blocked-1"/.test(x.body), x && x.body);
  check('...and it is marked, and kept in the outbox', x && x.headers['x-vp-outbox-guard'] === 'blocked' && globalThis.__vpOutbox.length === 1 && globalThis.__vpOutbox[0].kind === 'send');
  x = await go(r, MM, post({ messages: [{ to: '+61400000001', message: 'hi' }] }));
  check('a text via Mobile Message is not sent, answered in its own shape', r.sent.length === 0 && /"results":\[\{"to":"\+61400000001","status":"success"/.test(x.body), x && x.body);
  x = await go(r, CS, post({ messages: [{ to: '+61412345678', body: 'hi' }] }));
  check('a text via ClickSend is not sent, answered in its own shape', r.sent.length === 0 && /"response_code":"SUCCESS"/.test(x.body) && /"status":"SUCCESS"/.test(x.body), x && x.body);
  x = await go(r, 'https://fcm.googleapis.com/fcm/send/abc', { method: 'POST', body: '' });
  check('a web push message is not sent', r.sent.length === 0);
  x = await go(r, 'https://api.twilio.com/2010-04-01/Accounts/x/Messages.json', { method: 'POST', body: '' });
  check('Twilio is not reached', r.sent.length === 0);
  x = await go(r, 'https://hook.example-staging-hook.workers.dev/sms', post({ phone: '61412345678' }));
  check('the SMS hook address is not called', r.sent.length === 0);
  x = await go(r, 'https://api.venueplay.com.au/billing/x', post({ a: 1 }));
  check('a WRITE to the live api address is stopped', r.sent.length === 0 && x.headers['x-vp-outbox-guard'] === 'blocked');
  x = await go(r, 'https://game.venueplay.com.au/venue', { method: 'DELETE' });
  check('a DELETE to the live game address is stopped', r.sent.length === 0);
  await go(r, 'https://www.venueplay.com.au/emails/welcome.html');
  check('a READ of the live site (an email template) still works', r.sent.length === 1);
  await go(r, 'https://api-staging.venueplay.com.au/health', post({ a: 1 }));
  await go(r, 'https://game-staging.venueplay.com.au/health', post({ a: 1 }));
  check('staging\'s own addresses are reachable', r.sent.length === 3);
  var n0 = r.sent.length;
  x = await go(r, 'https://ijkzgmdtwtgfkedqspxm.supabase.co/rest/v1/vp_venues', { method: 'GET' });
  check('the LIVE database is unreachable, even to read', r.sent.length === n0 && x.status === 403, x && x.status);
  x = await go(r, 'https://ijkzgmdtwtgfkedqspxm.supabase.co/rest/v1/vp_venues', { method: 'POST', body: '{}' });
  check('...and to write', r.sent.length === n0 && x.status === 403);
  await go(r, 'https://testproj.supabase.co/rest/v1/vp_venues', { method: 'POST', body: '{}' });
  check('the test database is reachable', r.sent.length === n0 + 1);
  x = await go(r, 'https://api.stripe.com/v1/customers', { method: 'POST', headers: { Authorization: 'Bearer sk_test_abc' }, body: 'a=1' });
  check('Stripe with a TEST key goes through', r.sent.length === n0 + 2);
  var live = 'sk_' + 'live_' + 'zzz';
  x = await go(r, 'https://api.stripe.com/v1/customers', { method: 'POST', headers: { Authorization: 'Bearer ' + live }, body: 'a=1' });
  check('Stripe with a LIVE key is refused', r.sent.length === n0 + 2 && x.status === 401 && /LIVE Stripe key/.test(x.body), x && x.body);
  x = await go(r, 'https://api.stripe.com/v1/customers', { method: 'POST', headers: { Authorization: 'Bearer ' + 'rk_' + 'live_' + 'zzz' }, body: 'a=1' });
  check('...a restricted live key too', r.sent.length === n0 + 2 && x.status === 401);
  x = await go(r, 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: 'x=1' });
  check('other lookups (Turnstile) are untouched', r.sent.length === n0 + 3);
  check('a malformed address falls through to the real fetch, never throws', (await (async function () { try { await go(r, 'not a url', {}); return true; } catch (e) { return false; } })()));
  check('the outbox is capped at 50', (await (async function () { for (var i = 0; i < 70; i++) await go(r, RESEND, post({ to: ['a@b.com.au'] })); return globalThis.__vpOutbox.length === 50; })()));
});

print('STAGING: the Worker refuses to run on an unsafe setup');
SECS.push(async function () {
  var r = boot(STG), G = r.G;
  check('a clean staging setup is allowed', G.vpgStagingProblem(STG) === '' && G.vpgRefuse(STG) === null);
  var liveKey = 'sk_' + 'live_' + 'zzz';
  function bad(label, patch, re) {
    var e = {}; for (var k in STG) e[k] = STG[k]; for (var k2 in patch) e[k2] = patch[k2];
    var p = G.vpgStagingProblem(e), rf = G.vpgRefuse(e);
    check(label + ' is refused with a 503', re.test(p) && rf && rf.status === 503 && rf.headers['x-vp-outbox-guard'] === 'refused', p);
  }
  bad('a LIVE Stripe key', { STRIPE_SECRET_KEY: liveKey }, /LIVE Stripe key/);
  bad('a restricted LIVE Stripe key', { STRIPE_SECRET_KEY: 'rk_' + 'live_' + 'q' }, /LIVE Stripe key/);
  bad('the LIVE database address', { SUPABASE_URL: 'https://ijkzgmdtwtgfkedqspxm.supabase.co' }, /LIVE database/);
  bad('a real-looking Resend key', { RESEND_API_KEY: 're_' + 'realkey123' }, /RESEND_API_KEY looks like a real key/);
  bad('a Mobile Message password', { MOBILEMESSAGE_PASSWORD: 'hunter2' }, /MOBILEMESSAGE_PASSWORD/);
  bad('a ClickSend key', { CLICKSEND_API_KEY: 'ABCDEF' }, /CLICKSEND_API_KEY/);
  var okDummy = {}; for (var k in STG) okDummy[k] = STG[k]; okDummy.CLICKSEND_API_KEY = 'staging-x'; okDummy.STRIPE_SECRET_KEY = '';
  check('dummy "staging-" send keys and no Stripe key are allowed', G.vpgStagingProblem(okDummy) === '');
  var liveEnv = { SUPABASE_URL: 'https://ijkzgmdtwtgfkedqspxm.supabase.co', RESEND_API_KEY: 're_' + 'real', STRIPE_SECRET_KEY: liveKey };
  check('LIVE (no VP_ENV) is never refused for having real keys', G.vpgStagingProblem(liveEnv) === '' && G.vpgRefuse(liveEnv) === null);
  var typo = { VP_ENV: 'Staging ', SUPABASE_URL: liveEnv.SUPABASE_URL };
  check('a mistyped VP_ENV is NOT staging (live behaviour, nothing refused): documented trap', G.vpgStagingProblem(typo) === '');
});

print('LIVE: real messages still go, test messages never do');
SECS.push(async function () {
  var LIVE = { SUPABASE_URL: 'https://ijkzgmdtwtgfkedqspxm.supabase.co', RESEND_API_KEY: 're_' + 'real' };
  var r = boot(LIVE), x;
  x = await go(r, RESEND, post({ to: ['pub@realpub.com.au'] }));
  check('an email to a real address is sent', r.sent.length === 1 && /"real":true/.test(x.body));
  x = await go(r, RESEND, post({ to: 'someone@realpub.com.au', reply_to: 'a@example.invalid' }));
  check('a real recipient with a test reply-to is sent', r.sent.length === 2);
  x = await go(r, RESEND, post({ to: ['t1@example.invalid', 'T2@Example.Invalid'] }));
  check('an email only to example.invalid is not delivered', r.sent.length === 2 && /staging-blocked/.test(x.body));
  x = await go(r, RESEND, post({ to: ['t1@example.invalid', 'pub@realpub.com.au'] }));
  check('a mixed list is sent as it was (never silently trimmed)', r.sent.length === 3);
  x = await go(r, MM, post({ messages: [{ to: '+61491570123', message: 'hi' }] }));
  check('a text to a fiction number (+61 491 570 123) is not sent', r.sent.length === 3 && /"status":"success"/.test(x.body));
  x = await go(r, CS, post({ messages: [{ to: '0491 579 999', body: 'hi' }] }));
  check('...0491 579 999 in national form too', r.sent.length === 3);
  x = await go(r, MM, post({ messages: [{ to: '+61491580000', message: 'hi' }] }));
  check('+61 491 580 000 (outside the range) IS sent', r.sent.length === 4);
  x = await go(r, MM, post({ messages: [{ to: '+61491560999', message: 'hi' }] }));
  check('+61 491 560 999 (outside the range) IS sent', r.sent.length === 5);
  x = await go(r, MM, post({ messages: [{ to: '0400000001', message: 'hi' }] }));
  check('0400 000 001 is a normal number and IS sent (so seeds must use the fiction range)', r.sent.length === 6);
  x = await go(r, MM, post({ messages: [{ to: '+61412345678', message: 'hi' }] }));
  check('a real mobile is sent', r.sent.length === 7);
  x = await go(r, RESEND, { method: 'POST', body: 'not json' });
  check('an unreadable body passes through untouched', r.sent.length === 8);
  x = await go(r, RESEND, { method: 'POST', body: JSON.stringify({ subject: 'no recipient' }) });
  check('a body with no recipient passes through untouched', r.sent.length === 9);
  await go(r, RESEND + '/abc', { method: 'GET' });
  check('a GET passes through', r.sent.length === 10);
  await go(r, 'https://api.venueplay.com.au/x', post({ a: 1 }));
  check('a write to the live api from LIVE is not touched', r.sent.length === 11);
  await go(r, 'https://api.stripe.com/v1/x', { method: 'POST', headers: { Authorization: 'Bearer ' + 'sk_' + 'live_' + 'z' } });
  check('live Stripe from LIVE is not touched', r.sent.length === 12);
  var before = globalThis.fetch; r.G.vpgInstall(LIVE);
  check('installing twice does not wrap twice', globalThis.fetch === before);
});

print('the table');
SECS.push(async function () {
  var G = boot({}).G;
  check('0491 570 000 / 0491 579 999 are test mobiles', G.vpgIsTestMobile('0491 570 000') && G.vpgIsTestMobile('+61 491 579 999') && G.vpgIsTestMobile('61491575000'));
  check('0491 580 000, 0491 569 999, 0400 000 001, empty, short are not', !G.vpgIsTestMobile('0491 580 000') && !G.vpgIsTestMobile('0491 569 999') && !G.vpgIsTestMobile('0400000001') && !G.vpgIsTestMobile('') && !G.vpgIsTestMobile('04915'));
  check('example.invalid addresses are test emails, others are not', G.vpgIsTestEmail('a@example.invalid') && G.vpgIsTestEmail('A@EXAMPLE.INVALID') && G.vpgIsTestEmail('Name <a@example.invalid>') && !G.vpgIsTestEmail('a@example.com') && !G.vpgIsTestEmail('a@notexample.invalid') && !G.vpgIsTestEmail('example.invalid'));
  check('every setting lives in VPG (prefix, domain, live ref, dummy prefix)', G.VPG.testMobilePrefix === '6149157' && G.VPG.testEmailDomain === 'example.invalid' && G.VPG.liveSupabaseRef === 'ijkzgmdtwtgfkedqspxm' && G.VPG.dummyKeyPrefix === 'staging-');
  check('recipients are read from to / destination / nested messages', G.vpgRecipients('{"to":["a@b.c"],"messages":[{"to":"+61400"},{"destination":"x"}]}').join('|') === 'a@b.c|+61400|x');
});

(async function () { for (var i = 0; i < SECS.length; i++) await SECS[i](); print(fails ? ran + ' checks, ' + fails + ' failed' : 'ALL ' + ran + ' CHECKS PASSED'); if (fails) exit(1); })().catch(function (e) { print('CRASH ' + e + ' ' + (e && e.stack)); exit(1); });
