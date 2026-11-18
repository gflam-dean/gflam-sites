/* THE MONTHLY EMAIL SWEEP SKIPS WHO MUST NOT BE EMAILED (INBOX 650a, 19 Nov 2026).
   Report: reports/monthly-email-and-stop-flag-19nov.md. vprMonthlySweep picked its recipient from
   venueplay_founding.contact_email and skipped only test venues, cancelled free months, no nights, no address
   and unsubscribes. It never read vp_prospects.no_contact (HQ's Do not contact) and never read the Resend
   webhook's bounce and spam-complaint rows (vp_admin_audit, email_bounced / email_marked_spam, detail.address),
   so a bounced or complaining address was mailed again on 1 Dec, which costs sender reputation.

   Runs the REAL Worker on tools/rig-billing-worker.js, clock pinned, no network. Nothing is sent anywhere:
   the rig's fake Resend only records what would have gone.
   Run from the repo root:  jsc tools/test-monthly-sweep-skip.js */
load('tools/rig-billing-worker.js');
function fnv(bytes, seed) { var out = new Uint8Array(32), h = (2166136261 ^ seed) >>> 0; for (var r = 0; r < 32; r++) { for (var i = 0; i < bytes.length; i++) { h ^= bytes[i] + r; h = Math.imul(h, 16777619) >>> 0; } out[r] = h & 255; } return out; }
if (typeof TextEncoder === 'undefined') { TextEncoder = function () {}; TextEncoder.prototype.encode = function (s) { s = unescape(encodeURIComponent(String(s))); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }; }
if (typeof crypto === 'undefined') crypto = { subtle: {
  importKey: function (fmt, raw) { return Promise.resolve({ k: fnv(new Uint8Array(raw), 2)[0] }); },
  sign: function (alg, key, data) { return Promise.resolve(fnv(new Uint8Array(data), 3 + key.k).buffer); } } };
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
var REAL_NOW = Date.now;
var NOW = Date.parse('2026-11-02T00:00:00Z');          // 10am Mon 2 Nov in Brisbane: inside the send window, October is finished
Date.now = function () { return NOW; };
var ENVON = Object.assign({}, ENV, { MONTHLY_REPORTS: 'on', VP_UNSUB_SECRET: 'u' });

/* How the bounce read is made to fail: a request for the bounce rows (and only those) answers 503, or throws. */
var BOUNCE_READ = null, BOUNCE_READS = 0;
var RIG_FETCH = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = decodeURIComponent(String(url));
  if (u.indexOf('/rest/v1/vp_admin_audit') !== -1 && u.indexOf('email_bounced') !== -1 && !(opts && opts.method && opts.method !== 'GET')) {
    BOUNCE_READS++;
    if (BOUNCE_READ === 'status') return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('upstream blip'); } });
    if (BOUNCE_READ === 'throw') return Promise.reject(new Error('network down'));
  }
  return RIG_FETCH(url, opts);
};

var V = { ok: 'a1', nc: 'a2', bounce: 'a3', spam: 'a4', unsub: 'a5', cx: 'a6', test: 'a7', other: 'a8', leaving: 'a9' };
function vid(k) { return 'b0000000-0000-4000-8000-0000000000' + V[k]; }
var EMAIL = { ok: 'ok@pub-ok.com.au', nc: 'nc@pub-nc.com.au', bounce: 'gone@pub-bounce.com.au', spam: 'angry@pub-spam.com.au', unsub: 'quit@pub-unsub.com.au',
              cx: 'cx@pub-cx.com.au', test: 'dean@test.com.au', other: 'other@pub-other.com.au', leaving: 'leave@pub-leave.com.au' };
var NAME = { ok: 'The OK Pub', nc: 'The NoContact Pub', bounce: 'The Bounce Pub', spam: 'The Spam Pub', unsub: 'The Unsub Pub', cx: 'The Cancelled Pub', test: 'Test Alpha', other: 'The Other Pub', leaving: 'The Leaving Pub' };
function world() {
  DB = {}; sent.length = 0; FAIL = {}; BOUNCE_READ = null; BOUNCE_READS = 0; vprForget();
  DB.venueplay_founding = []; DB.vp_venues = []; DB.vp_sessions = []; DB.vp_games = []; DB.vp_players = [];
  Object.keys(V).forEach(function (k, i) {
    var f = 'f' + k;
    DB.venueplay_founding.push({ id: f, contact_email: EMAIL[k], contact_name: 'Sam', plan: 'monthly', status: 'card_on_file' });
    DB.vp_venues.push({ id: vid(k), name: NAME[k], founding_id: f, slug: 's-' + k, status: 'active', timezone: 'Australia/Brisbane', created_at: '2026-08-01T00:00:00Z' });
    DB.vp_sessions.push({ id: 'S' + k, venue_id: vid(k), created_at: '2026-10-10T08:00:00Z', opened_at: '2026-10-10T08:00:00Z', ended_at: '2026-10-10T12:00:00Z' });
    DB.vp_games.push({ id: 'g' + k, session_id: 'S' + k, format: 'trivia', started_at: '2026-10-10T09:00:00Z' });
    for (var n = 0; n < 3; n++) DB.vp_players.push({ id: 'p' + k + n, session_id: 'S' + k, device_id: 'd' + k + n, is_test: false, kicked: false, joined_at: '2026-10-10T08:40:00Z', played_at: '2026-10-10T09:01:00Z' });
  });
  DB.vp_admin_audit = []; DB.vp_unsubscribes = [{ email: EMAIL.unsub }];
  DB.vp_prospects = [{ venue_id: vid('cx'), cancelled_at: '2026-10-20T00:00:00Z', no_contact: false }, { venue_id: vid('nc'), cancelled_at: null, no_contact: true },
                     { venue_id: vid('ok'), cancelled_at: null, no_contact: false }];
}
function bounceRow(action, addr, venueKey) { return { id: 100 + DB.vp_admin_audit.length, actor_admin: null, actor_label: 'system', action: action, target: venueKey ? 'venue:' + vid(venueKey) : 'email:' + addr,
  detail: { address: addr, subject: 'Your October at ...', reason: 'x', leaving: false, venues: [] }, created_at: '2026-10-15T00:00:00Z' }; }
function tos() { return sent.map(function (m) { return m.to[0]; }).sort().join(); }
function whyOf(k) { var r = DB.vp_admin_audit.filter(function (a) { return a.action === 'monthly_report_skipped' && a.target === 'month-report:' + vid(k) + ':2026-10'; })[0]; return r && r.detail.why; }

(async function () {
  print('the baseline: what the sweep skipped before still holds');
  world();
  var r0 = await vprMonthlySweep(ENVON, NOW);
  check('with no bounce rows the sweep runs and the OK pub gets October',r0.month === '2026-10' && sent.map(function (m) { return m.to[0]; }).indexOf(EMAIL.ok) !== -1, tos());
  check('a normal venue is still included', sent.some(function (m) { return m.to[0] === EMAIL.ok; }), tos());
  check('the test venue is still skipped', whyOf('test') === 'test venue' && !sent.some(function (m) { return m.to[0] === EMAIL.test; }), whyOf('test'));
  check('the unsubscribed contact is still skipped', whyOf('unsub') === 'unsubscribed' && !sent.some(function (m) { return m.to[0] === EMAIL.unsub; }), whyOf('unsub'));
  check('the cancelled free month is still skipped', whyOf('cx') === 'cancelled their free month' && !sent.some(function (m) { return m.to[0] === EMAIL.cx; }), whyOf('cx'));

  print('Do not contact (vp_prospects.no_contact = true)');
  world();
  await vprMonthlySweep(ENVON, NOW);
  check('a venue HQ marked Do not contact gets no report', !sent.some(function (m) { return m.to[0] === EMAIL.nc; }), tos());
  check('and the skip is recorded with its own reason', whyOf('nc') === 'do not contact', whyOf('nc'));
  check('a prospect row with no_contact false is still mailed', sent.some(function (m) { return m.to[0] === EMAIL.ok; }), tos());

  print('a bounced address (the Resend webhook wrote email_bounced)');
  world();
  DB.vp_admin_audit.push(bounceRow('email_bounced', EMAIL.bounce, 'bounce'));
  await vprMonthlySweep(ENVON, NOW);
  check('the address that bounced is not in the send list', !sent.some(function (m) { return m.to[0] === EMAIL.bounce; }), tos());
  check('and the skip is recorded: address bounced', whyOf('bounce') === 'address bounced', whyOf('bounce'));
  check('every other venue is untouched by it', sent.some(function (m) { return m.to[0] === EMAIL.ok; }) && sent.some(function (m) { return m.to[0] === EMAIL.other; }), tos());

  print('a spam complaint (the webhook wrote email_marked_spam)');
  world();
  DB.vp_admin_audit.push(bounceRow('email_marked_spam', EMAIL.spam, 'spam'));
  await vprMonthlySweep(ENVON, NOW);
  check('the address that marked us as spam is not in the send list', !sent.some(function (m) { return m.to[0] === EMAIL.spam; }), tos());
  check('and the skip is recorded: address bounced', whyOf('spam') === 'address bounced', whyOf('spam'));

  print('how the address is matched');
  world();
  DB.vp_admin_audit.push(bounceRow('email_bounced', '  GONE@Pub-Bounce.com.au ', null));       // a bounce with no venue match: target is email:...
  await vprMonthlySweep(ENVON, NOW);
  check('upper case and spaces in the webhook row still match, and no venue match on the row is needed', !sent.some(function (m) { return m.to[0] === EMAIL.bounce; }), tos());
  world();
  DB.vp_admin_audit.push(bounceRow('email_bounced', 'someone.else@elsewhere.com.au', null));
  DB.vp_admin_audit.push(bounceRow('venue_leaving_email_delivered', EMAIL.leaving, 'leaving'));  // not a bounce: delivered
  DB.vp_admin_audit.push({ id: 999, action: 'email_bounced', target: 'email:none', detail: null, created_at: '2026-10-15T00:00:00Z' });   // a row with no detail does not break the read
  await vprMonthlySweep(ENVON, NOW);
  check('another address bouncing, a delivered row and a row with no detail skip nobody else', sent.some(function (m) { return m.to[0] === EMAIL.leaving; }) && sent.some(function (m) { return m.to[0] === EMAIL.ok; }), tos());

  print('the bounce read FAILS: closed. Nobody is emailed, the sweep does not throw, the next tick looks again');
  for (var mode of ['status', 'throw']) {
    world(); BOUNCE_READ = mode;
    var res, threw = null;
    try { res = await vprMonthlySweep(ENVON, NOW); } catch (e) { threw = String(e); }
    check('read fails (' + mode + '): nobody is emailed', sent.length === 0, tos());
    check('read fails (' + mode + '): the sweep holds the tick instead of throwing, like the cancelled list', threw === null && res && res.waiting === true && res.sent === 0 && /bounce/.test(res.why || ''), [threw, res]);
    check('read fails (' + mode + '): nothing is written as skipped or sent, so the next tick looks at every venue again', DB.vp_admin_audit.filter(function (a) { return /^monthly_report_/.test(a.action); }).length === 0, DB.vp_admin_audit.length);
    BOUNCE_READ = null;
    var again = await vprMonthlySweep(ENVON, NOW);
    check('read fails (' + mode + '): once it works again the venues are mailed', sent.some(function (m) { return m.to[0] === EMAIL.ok; }) && again.sent > 0, tos());
  }
  world(); FAIL['vp_prospects:GET'] = 1;
  var hold = await vprMonthlySweep(ENVON, NOW);
  check('the prospects read (cancelled and Do not contact) failing also holds, as before: nobody emailed', hold.waiting === true && sent.length === 0, hold);

  Date.now = REAL_NOW;
  print(fails ? (fails + ' of ' + ran + ' checks FAILED') : ('ALL ' + ran + ' CHECKS PASSED'));
})().catch(function (e) { print('  FAIL the suite threw: ' + e + '\n' + (e && e.stack)); print('1 of 1 checks FAILED'); });
