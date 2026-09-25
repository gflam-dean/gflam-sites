/* EVERY BILLING EMAIL LEAVES A RECORD OF WHAT HAPPENED TO IT.

   Audit, 25 Sep 2026: the payment reminder sent and swallowed everything (six invoice.upcoming
   events, no evidence of one reminder), and the welcome wrote welcome_email_sent whatever
   happened, which both lies and blocks the retry. The receipt was fixed the same way on 11 Sep.
   This RUNS the shipped vpaWelcomeOnce/vpaFireWelcome and vpaFireUpcomingEmail with Resend
   answering yes and no, and reads the vp_admin_audit rows they write.

   Run:  jsc tools/test-email-outcomes-recorded.js
*/
var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js')
  .replace(/^export default/m, 'var _d =')
  .replace(/^export\s+(?=(async\s+)?(class|function|const|let|var)\b)/mg, '')
  .replace(/^export\s*\{[^}]*\}\s*;?/mg, '');
console = { log: function () {}, warn: function () {}, error: function () {} };
(0, eval)(src);

var PASS = 0, FAIL = 0;
function check(name, cond, saw) {
  if (cond) { PASS++; print('  ok   ' + name); }
  else { FAIL++; print('  FAIL ' + name + (saw !== undefined ? '   saw: ' + JSON.stringify(saw).slice(0, 300) : '')); }
}

var resendOk = true, resendCalls = 0, rows = [], prior = [], optedOut = false;
fetch = function (url, opts) {
  url = String(url);
  var m = /\/emails\/([a-z-]+\.html)$/.exec(url);
  if (m) { var tpl = readFile('venueplay/emails/' + m[1]); return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(tpl); } }); }
  if (/api\.resend\.com/.test(url)) {
    resendCalls++;
    return Promise.resolve({ ok: resendOk, status: resendOk ? 200 : 422,
      json: function () { return Promise.resolve(resendOk ? { id: 're_1' } : { message: 'bad' }); } });
  }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); } });
};
vpaInsert = function (env, table, row) { rows.push({ table: table, row: row }); return Promise.resolve({}); };
vpaSelect = function (env, table, q) {
  if (table === 'vp_admin_audit') return Promise.resolve(prior);
  if (table === 'venueplay_founding') return Promise.resolve([{ payment_reminders: optedOut ? false : true }]);
  return Promise.resolve([]);
};
function audit(action) { return rows.filter(function (r) { return r.table === 'vp_admin_audit' && r.row.action === action; }); }

var ENV = { RESEND_API_KEY: 'k', SITE_URL: 'https://venueplay.com.au' };
var SESSION = { metadata: { tier: 'founding' }, created: Math.floor(Date.now() / 1000) };
var F = { contact_email: 'owner@pub.com', contact_name: 'Sam', plan: 'monthly', max_seats: 40 };
function welcome(env) {
  return vpaWelcomeOnce(env, SESSION, 'acct-1', function () {
    return vpaFireWelcome(env, SESSION, F, [{ name: 'The Pub', seats: 40, slug: 'the-pub' }], false);
  });
}
var INV = { id: 'in_1', customer: 'cus_1', customer_email: 'owner@pub.com', amount_due: 250,
            lines: { data: [] }, next_payment_attempt: 1790000000 };

(async function () {
  /* WELCOME */
  rows = []; resendOk = true;
  var r1 = await welcome(ENV);
  check('a welcome Resend accepted is recorded as sent, with its id',
        r1 === true && audit('welcome_email_sent').length === 1 && audit('welcome_email_sent')[0].row.detail.resend_id === 're_1',
        audit('welcome_email_sent'));
  rows = []; resendOk = false;
  var r2 = await welcome(ENV);
  check('a welcome Resend REFUSED is not recorded as sent', r2 === false && audit('welcome_email_sent').length === 0, rows);
  check('...it is recorded as not sent, with the reason', audit('welcome_email_not_sent').length === 1 &&
        /Resend refused/.test(audit('welcome_email_not_sent')[0].row.detail.outcome), audit('welcome_email_not_sent'));
  rows = []; resendOk = true;
  await welcome({ SITE_URL: 'https://venueplay.com.au' });
  check('no Resend key: recorded as not sent, never as sent',
        audit('welcome_email_sent').length === 0 && /no Resend key/.test((audit('welcome_email_not_sent')[0] || { row: { detail: {} } }).row.detail.outcome), rows);
  rows = []; prior = [{ id: 'x' }]; resendCalls = 0;
  await welcome(ENV);
  check('control: an account already welcomed is not sent a second one', resendCalls === 0 && rows.length === 0, rows);
  prior = [];

  /* PAYMENT REMINDER */
  rows = []; resendOk = true; optedOut = false;
  await vpaFireUpcomingEmail(ENV, INV);
  var up = audit('invoice_upcoming_email');
  check('a reminder that went is recorded as sent, with its id', up.length === 1 && up[0].row.detail.outcome === 'sent' && up[0].row.detail.resend_id === 're_1', up);
  rows = []; resendOk = false;
  await vpaFireUpcomingEmail(ENV, INV);
  up = audit('invoice_upcoming_email');
  check('a reminder Resend refused is recorded as not sent', up.length === 1 && /Resend refused/.test(up[0].row.detail.outcome), up);
  rows = []; resendOk = true; resendCalls = 0;
  await vpaFireUpcomingEmail(ENV, { id: 'in_2', customer: 'cus_1', customer_email: 'owner@pub.com', amount_due: 0 });
  up = audit('invoice_upcoming_email');
  check('a $0 bill sends nothing and says why', resendCalls === 0 && up.length === 1 && /\$0 due/.test(up[0].row.detail.outcome), up);
  rows = []; optedOut = true; resendCalls = 0;
  await vpaFireUpcomingEmail(ENV, INV);
  up = audit('invoice_upcoming_email');
  check('a venue that turned reminders off gets none, and that is recorded', resendCalls === 0 && up.length === 1 && /turned reminders off/.test(up[0].row.detail.outcome), up);
  optedOut = false;
  rows = [];
  await vpaFireUpcomingEmail({ SITE_URL: 'x' }, INV);
  up = audit('invoice_upcoming_email');
  check('no Resend key: recorded, not silent', up.length === 1 && /no Resend key/.test(up[0].row.detail.outcome), up);

  print('');
  print(PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL) throw new Error(FAIL + ' check(s) failed');
  print('ALL ' + PASS + ' CHECKS PASSED');
})().catch(function (e) { print('CRASH ' + (e && e.stack || e)); throw e; });
