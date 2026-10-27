/* A Stripe event that FAILED must be run again when Stripe sends it again.

   This RUNS handleWebhook out of the deployed file against an in-memory vp_stripe_events
   table. The clock is ours, so "one minute later" means exactly that. What is asserted is
   what Stripe is told (the status code, because a 200 means "never send this again") and
   whether the work was actually done.

   Run:  jsc tools/test-webhook-retry-is-not-dropped.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {} };
function Response(body, init) { this.body = body; this.status = (init && init.status) || 200; }
(0, eval)(src);

var ENV = { SUPABASE_URL: 'https://sb.invalid', SUPABASE_SERVICE_KEY: 'k', STRIPE_WEBHOOK_SECRET: 'w' };
var NOW = Date.parse('2026-09-19T10:00:00Z');
Date.now = function () { return NOW; };

var events, sbCalls, provisioned, failFirst, hang;
function arm(opts) {
  events = {}; sbCalls = 0; provisioned = 0; failFirst = !!opts.failFirst; hang = !!opts.hang;
  fetch = function (url, opt) {
    opt = opt || {}; var m = opt.method || 'GET'; url = String(url);
    function R(ok, data) { return Promise.resolve({ ok: ok, status: ok ? 200 : 500,
      json: function () { return Promise.resolve(data); }, text: function () { return Promise.resolve(JSON.stringify(data)); } }); }
    if (/vp_stripe_events/.test(url)) {
      if (m === 'POST') {
        var b = JSON.parse(opt.body);
        if (events[b.event_id]) return R(true, []);
        events[b.event_id] = { event_id: b.event_id, claimed_at: new Date(NOW).toISOString(), completed_at: null, attempts: 1 };
        return R(true, [events[b.event_id]]);
      }
      var id = decodeURIComponent(/event_id=eq\.([^&]+)/.exec(url)[1]);
      if (m === 'PATCH') {
        /* The filter is honoured, like the real thing: a release must not touch a finished row. */
        if (/completed_at=is\.null/.test(url) && events[id] && events[id].completed_at) return R(true, []);
        var p = JSON.parse(opt.body); for (var k in p) events[id][k] = p[k]; return R(true, []);
      }
      return R(true, events[id] ? [events[id]] : []);
    }
    return R(true, []);
  };
  verifyStripeSig = function () { return Promise.resolve(true); };
  sbUpdate = function () {
    sbCalls++;
    if (hang) return new Promise(function () {});           // a Worker that was killed mid-flight never answers
    if (failFirst && sbCalls === 1) return Promise.reject(new Error('venueplay_founding update failed (503)'));
    return Promise.resolve();
  };
  vpaProvisionFromCheckout = function () { provisioned++; return Promise.resolve(); };
}

var EVT = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { client_reference_id: 'row_1', customer: 'cus_1', subscription: 'sub_1' } } });
function deliver() {
  var out = null, err = null;
  handleWebhook({ headers: { get: function () { return 'sig'; } }, text: function () { return Promise.resolve(EVT); } }, ENV, {})
    .then(function (r) { out = r; }, function (e) { err = e; });
  drainMicrotasks();
  return err ? { threw: String(err.message || err) } : (out ? { status: out.status } : { pending: true });
}

var fails = 0;
function check(name, ok, saw) {
  if (ok) print('  ok   ' + name);
  else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw))); fails++; }
}

print('a signup is paid, and our database blips while we record it');
arm({ failFirst: true });
var d1 = deliver();
check('the first delivery fails out loud, so Stripe will retry', !!d1.threw, d1);
check('and is NOT marked finished', events.evt_1 && !events.evt_1.completed_at, events.evt_1);
NOW += 60 * 1000;
var d2 = deliver();
check('the retry ONE MINUTE later is run, not waved away', provisioned === 1, { told: d2, provisioned: provisioned });
check('and only then is Stripe told 200', d2.status === 200 && !!events.evt_1.completed_at, [d2, events.evt_1]);
check('the ledger remembers it took two goes', Number(events.evt_1.attempts) === 2, events.evt_1);
NOW += 60 * 1000;
var d3 = deliver();
check('a third copy of a FINISHED event is a real duplicate: 200, and nothing runs twice', d3.status === 200 && provisioned === 1, [d3, provisioned]);

print('two copies arrive together, and the first is still working');
arm({ hang: true });
var h1 = deliver();
check('the first is mid-flight', !!h1.pending, h1);
hang = false;
var h2 = deliver();
check('the second does not run the work again', provisioned === 0, provisioned);
check('and is NOT told 200, because nothing has been finished yet', h2.status !== 200 && h2.status >= 400, h2);
NOW += 6 * 60 * 1000;
var h3 = deliver();
check('if the first one died, the retry after the window takes it over', h3.status === 200 && provisioned === 1, [h3, provisioned]);

print('the ordinary case');
arm({});
var o1 = deliver();
check('one delivery, handled once, 200', o1.status === 200 && provisioned === 1 && !!events.evt_1.completed_at, [o1, provisioned]);

if (fails) { throw new Error('webhook retry: ' + fails + ' failed'); }
print('PASS');
