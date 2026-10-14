/* PARTYPLAY /health SAYS WHETHER ANYBODY CAN SIGN IN, NOT HOW MANY OF US THERE ARE.

   Audit of 14 Oct 2026: the public /health printed "admins":2 to anybody. The check exists to
   catch a locked-out admin (pp_admins empty), and a yes/no answers that without telling the
   world the size of the team. This RUNS the real Worker's fetch handler against a scripted
   database: two admins, none, and an unreadable table.

   Run: jsc partyplay-backend/lib/pp-health-private.test.js   (from the repo root) */
function find(rel) {
  var tries = [rel, '../' + rel, '../../' + rel];
  for (var i = 0; i < tries.length; i++) {
    try { var t = readFile(tries[i]); if (t && t.length > 200) return tries[i]; } catch (e) {}
  }
  throw new Error('cannot find ' + rel);
}
load(find('partyplay-backend/worker/_test-sha256.js'));

globalThis.crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 2654435761) >>> 0; return a; },
                      subtle: { importKey: function () { return Promise.resolve({}); }, sign: function () { return Promise.resolve(new ArrayBuffer(32)); } } };
globalThis.Response = function (body, init) {
  init = init || {}; this._body = body; this.status = init.status || 200; this.ok = this.status < 400;
  var h = init.headers || {};
  this.headers = { _h: h, set: function (k, v) { this._h[k] = v; }, get: function (k) { return this._h[k] || null; } };
  this.json = function () { return Promise.resolve(JSON.parse(this._body)); };
  this.text = function () { return Promise.resolve(String(this._body)); };
};
globalThis.URL = function (u) {
  var m = /^https?:\/\/[^\/]+(\/[^?#]*)?(\?[^#]*)?/.exec(u) || [];
  this.pathname = m[1] || '/';
  var q = (m[2] || '').replace(/^\?/, '');
  this.searchParams = { get: function (k) { var p = q.split('&'); for (var i = 0; i < p.length; i++) { var kv = p[i].split('='); if (kv[0] === k) return kv[1] || ''; } return null; } };
};
globalThis.console = { log: function () {} };
var ANSWER = null;   // what pp_admins answers: a function returning { status, body }
globalThis.fetch = function (url) {
  var a = /pp_admins/.test(url) && ANSWER ? ANSWER() : { status: 200, body: '[]' };
  return Promise.resolve(new Response(a.body, { status: a.status }));
};
var m = { exports: {} };
(new Function('module', 'globalThis', readFile(find('partyplay/lib/pp-licence.js'))))(m, globalThis);
globalThis.PPLicence = m.exports;
(new Function(readFile(find('partyplay-backend/worker/SOURCE-do-not-paste-partyplay-api.js')).replace(/^export default/m, 'globalThis.WORKER =')))();
var W = globalThis.WORKER;

var ENV = { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_1DAY: 'p1', STRIPE_PRICE_3DAY: 'p3',
            SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc', RESEND_API_KEY: 're_test',
            SITE_ORIGIN: 'https://partyplay.com.au', PHOTOS: {} };
function health(env) {
  var req = { method: 'GET', url: 'https://api.partyplay.com.au/health',
              headers: { get: function () { return null; } } };
  return W.fetch(req, env).then(function (r) { return r.json(); });
}
var ran = 0, bad = 0;
function ok(n, c, extra) { ran++; print((c ? '  ok   ' : '  FAIL ') + n + (c || extra === undefined ? '' : '   saw: ' + extra)); if (!c) bad++; }

ANSWER = function () { return { status: 200, body: JSON.stringify([{ mobile: '+61400000001' }, { mobile: '+61400000002' }]) }; };
health(ENV).then(function (d) {
  ok('with two admins it says somebody can sign in', d.admins_ok === true && d.ok === true, JSON.stringify(d));
  ok('and it does not say how many', !('admins' in d) && JSON.stringify(d).indexOf(':2') < 0, JSON.stringify(d));
  ok('control: it still names itself and its build', d.worker === 'partyplay-api' && 'build' in d, JSON.stringify(d));
  ANSWER = function () { return { status: 200, body: '[]' }; };
  return health(ENV);
}).then(function (d) {
  ok('with none, and no ADMIN_KEY, it says nobody can get in, and is not ok', d.admins_ok === false && d.ok === false && /nobody can sign in/i.test(d.warning || ''), JSON.stringify(d));
  ANSWER = function () { return { status: 500, body: '{"message":"boom"}' }; };
  return health(ENV);
}).then(function (d) {
  ok('a table it cannot read says "unknown" (null), never a reassuring yes', d.admins_ok === null, JSON.stringify(d));
}).catch(function (e) { bad++; print('  FAIL threw: ' + (e && e.stack || e)); }).then(function () {
  print('\n' + (ran - bad) + ' of ' + ran + ' checks passed');
  if (bad) throw new Error(bad + ' PartyPlay health checks failed');
});
