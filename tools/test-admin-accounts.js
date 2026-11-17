/* HQ's list of every account, through the Worker (18 Nov 2026, reports/founding-reads-18nov.md).

   HQ read venueplay_founding from the browser. RLS lets only the Workers read it, so the read
   came back [] with no error: the Admin opt-in table always said "No self-serve accounts yet"
   and every Groups billing badge said "Card account". Now GET /admin/accounts answers it.

   Runs the REAL billing Worker on tools/rig-billing-worker.js, with the REAL vpaRequireAdmin;
   only the JWT signature check is stood in for (the token IS the user id). Then lifts HQ's own
   readAccounts / applyAccounts / acctStatusOf out of hq.html and runs them.

     owner and accounts get every account, paged past the database's row cap, short pages too
     staff is refused 403, no token 401, a bad token 401
     the reply has no mobile, no contact name, no Stripe id: has_sub only
     a failed page is a 503, never a short list
     HQ: a staff login asks nothing and is told why; a failure rejects (so "Could not read"
     shows); the badges read has_sub; no browser read of venueplay_founding is left in hq.html

   Run from the repo root:  jsc tools/test-admin-accounts.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); fails++; } }
vpaVerifyJWT = async function (t) { return (t && t !== 'forged') ? { sub: t } : null; };

/* A LOWER max-rows than the page asked for, the case CLAUDE.md warns about: every page comes
   back short, and a loop that stops on a short page stops after one. */
var PAGE_CAP = 0, rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  return rigFetch(url, opts).then(function (res) {
    if (!PAGE_CAP || u.indexOf('/rest/v1/venueplay_founding') === -1 || !res.ok) return res;
    return res.json().then(function (rows) {
      var cut = Array.isArray(rows) ? rows.slice(0, PAGE_CAP) : rows;
      return { ok: true, status: 200, json: function () { return Promise.resolve(cut); }, text: function () { return Promise.resolve(JSON.stringify(cut)); } };
    });
  });
};

var DEAN = 'u-owner', SAM = 'u-accounts', PAT = 'u-staff', NOBODY = 'u-not-admin';
function pad(n) { return ('00000' + n).slice(-5); }
function world(n) {
  DB = {}; FAIL = {}; PAGE_CAP = 0;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: SAM, label: 'Sam', role: 'accounts' }, { auth_user_id: PAT, label: 'Pat', role: 'staff' }];
  DB.venueplay_founding = [
    { id: 'f-00001', venue_name: 'Tugun Bowls Club', contact_email: 'tugun@example.com', contact_name: 'Terry Tugun', mobile: '0412 345 678', optin_release_approved: true, status: 'active', bill_by_invoice: false, stripe_subscription_id: 'sub_T', stripe_customer_id: 'cus_T' },
    { id: 'f-00002', venue_name: 'The Royal Arms', contact_email: 'royal@example.com', contact_name: 'Rae', mobile: '+61412000111', optin_release_approved: false, status: 'pending', bill_by_invoice: false, stripe_subscription_id: null, stripe_customer_id: null },
    { id: 'f-00003', venue_name: 'Coastline Hotels', contact_email: 'acc@coast.example.com', contact_name: 'Cee', mobile: '0400 000 003', optin_release_approved: null, status: 'active', bill_by_invoice: true, stripe_subscription_id: null, stripe_customer_id: 'cus_C' }];
  for (var i = 4; i <= n; i++) DB.venueplay_founding.push({ id: 'f-' + pad(i), venue_name: 'Venue ' + i, contact_email: 'v' + i + '@example.com', contact_name: 'Person ' + i, mobile: '04' + ('00000000' + i).slice(-8), optin_release_approved: null, status: 'active', bill_by_invoice: false, stripe_subscription_id: 'sub_' + i, stripe_customer_id: 'cus_' + i });
}
function req(user) { return { url: 'https://api/admin/accounts', method: 'GET', headers: { get: function (k) { return k === 'Authorization' && user ? 'Bearer ' + user : ''; } } }; }
function get(user) { return vpaHandleAdminAccounts(req(user), ENV, J); }

/* HQ's own functions, lifted out of hq.html by counting braces. */
var HQ = readFile('venueplay/app/hq.html');
function cut(src, name) {
  var at = src.indexOf('function ' + name + '(');
  if (at === -1) return null;
  var open = src.indexOf('{', at), depth = 0;
  for (var j = open; j < src.length; j++) { var ch = src.charAt(j); if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); } }
  return null;
}
var S = { adminRole: 'owner' }, ASKED = [], WG = null;
function canBilling() { return S.adminRole === 'owner' || S.adminRole === 'accounts'; }
function workerGet(path) { ASKED.push(path); return WG(path); }
var LIFT = '';
['readAccounts', 'applyAccounts', 'acctStatusOf'].forEach(function (n) { var b = cut(HQ, n); check('hq.html has ' + n, !!b); LIFT += (b || '') + '\n'; });
(0, eval)(LIFT);

(async function () {
  print('who may read it (the real vpaRequireAdmin)');
  world(3);
  var o = await get(DEAN);
  check('the owner gets every account', o.status === 200 && o.body.ok === true && (o.body.accounts || []).length === 3, o);
  var a = await get(SAM);
  check('an accounts login gets them too', a.status === 200 && (a.body.accounts || []).length === 3, a);
  var s = await get(PAT);
  check('a staff login is refused 403 and given no rows', s.status === 403 && !s.body.accounts, s);
  var x = await get(NOBODY);
  check('a signed-in login that is not an HQ admin is refused 403', x.status === 403 && !x.body.accounts, x);
  var n = await get(null);
  check('no token is refused 401', n.status === 401 && !n.body.accounts, n);
  var f = await get('forged');
  check('a token that does not verify is refused 401', f.status === 401 && !f.body.accounts, f);

  print('what it sends (only what the screens show)');
  var whole = JSON.stringify(o.body);
  check('no mobile anywhere in the reply, in any form', !/mobile/i.test(whole) && whole.indexOf('0412') === -1 && whole.indexOf('61412') === -1 && whole.indexOf('0400') === -1, whole);
  check('no contact name and no Stripe id', whole.indexOf('Terry') === -1 && whole.indexOf('contact_name') === -1 && whole.indexOf('sub_T') === -1 && whole.indexOf('cus_') === -1, whole);
  var keys = Object.keys(o.body.accounts[0]).sort().join(',');
  check('each account carries exactly the seven fields HQ uses', keys === 'bill_by_invoice,contact_email,has_sub,id,optin_release_approved,status,venue_name', keys);
  var by = {}; o.body.accounts.forEach(function (r) { by[r.id] = r; });
  check('has_sub is true for a subscription and false without one', by['f-00001'].has_sub === true && by['f-00002'].has_sub === false && by['f-00003'].has_sub === false, by);
  check('approved, never, and not yet decided stay three different answers', by['f-00001'].optin_release_approved === true && by['f-00002'].optin_release_approved === false && by['f-00003'].optin_release_approved === null, by);
  check('name, email, status and invoicing come through as stored', by['f-00003'].venue_name === 'Coastline Hotels' && by['f-00003'].contact_email === 'acc@coast.example.com' && by['f-00003'].bill_by_invoice === true && by['f-00002'].status === 'pending', by['f-00003']);

  print('every account, not the first thousand');
  world(1203);
  var big = await get(DEAN);
  var ids = (big.body.accounts || []).map(function (r) { return r.id; });
  check('1,203 accounts past the database\'s 1,000 row cap: all 1,203 come back', ids.length === 1203, ids.length);
  check('none repeated, the last one included', ids.filter(function (v, i) { return ids.indexOf(v) === i; }).length === 1203 && ids.indexOf('f-01203') !== -1);
  world(23); PAGE_CAP = 7;
  var shortP = await get(DEAN);
  check('when the database hands back pages SHORTER than asked, every account still comes back', (shortP.body.accounts || []).length === 23, (shortP.body.accounts || []).length);
  world(1203); FAIL['venueplay_founding:GET'] = 0;
  var calls = 0, before = globalThis.fetch;
  globalThis.fetch = function (url, opts) { if (String(url).indexOf('/rest/v1/venueplay_founding') !== -1 && ++calls === 2) FAIL['venueplay_founding:GET'] = 1; return before(url, opts); };
  var broke = await get(DEAN);
  globalThis.fetch = before;
  check('a page that fails halfway is a 503, never a short list', broke.status === 503 && !broke.body.accounts, { status: broke.status, n: (broke.body.accounts || []).length });

  print('HQ (its own functions from hq.html)');
  check('hq.html no longer reads venueplay_founding from the browser', !/from\(\s*["']venueplay_founding["']\s*\)/.test(HQ));
  check('the dispatcher routes GET /admin/accounts to the handler', /request\.method === 'GET'\s+&& path === '\/admin\/accounts'\s+&& typeof vpaHandleAdminAccounts === 'function'\)\s+return await vpaHandleAdminAccounts\(/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')));
  world(3);
  S = { adminRole: 'staff' }; ASKED = [];
  WG = function () { return Promise.resolve({ error: 'should not be asked' }); };
  var st = await readAccounts(); applyAccounts(st);
  check('a staff login asks the Worker nothing and is told only owner and accounts can see the list', ASKED.length === 0 && S.accountsNotAllowed === true && S.accountsFailed === false, [ASKED, S.accountsNotAllowed]);
  S = { adminRole: 'owner' }; ASKED = [];
  WG = function (p) { return get(DEAN).then(function (r) { return r.body; }); };
  applyAccounts(await readAccounts());
  check('the owner\'s HQ asks /admin/accounts once and fills the list', ASKED.join() === '/admin/accounts' && S.accounts.length === 3 && S.accountsFailed === false && !S.accountsNotAllowed, ASKED);
  check('badge: a card subscription reads Paying by card', acctStatusOf('f-00001').txt === 'Paying by card', acctStatusOf('f-00001'));
  check('badge: pending with no card reads No card yet', acctStatusOf('f-00002').txt === 'No card yet', acctStatusOf('f-00002'));
  check('badge: invoiced reads Invoiced', acctStatusOf('f-00003').txt === 'Invoiced', acctStatusOf('f-00003'));
  WG = function () { return get(PAT).then(function (r) { return r.body; }); };
  var threw = null; try { await readAccounts(); } catch (e) { threw = e; }
  check('a refusal from the Worker REJECTS, so HQ says Could not read, not "No self-serve accounts yet"', !!threw);
  applyAccounts(null);
  check('and the failed read is marked failed, with no stale badges', S.accountsFailed === true && Object.keys(S.acctStatus).length === 0);
  finished = true;
})().catch(function (e) { print('  FAIL the test itself threw: ' + e + '\n' + e.stack); fails++; });
drainMicrotasks();
if (!finished) { print('  FAIL the test did not run to the end'); fails++; }
if (fails) throw new Error('admin accounts: ' + fails + ' of ' + ran + ' failed');
print('ALL ' + ran + ' CHECKS PASSED');
