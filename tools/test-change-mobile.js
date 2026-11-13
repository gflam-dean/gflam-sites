/* CHANGE MY MOBILE, EDIT A HOST'S MOBILE, AND HQ CHANGES A VENUE LOGIN'S MOBILE (INBOX 138, Dean, 8 Nov 2026), RUN.

   "Today a venue login sets its mobile once (first sign-in, text code checked) and can't change it later...
   hosts can only be added or removed, not edited... HQ can only edit PROSPECT details, not a paying venue's."

     1. the REAL billing Worker (tools/rig-billing-worker.js), POST /account/host-mobile (vpbHostMobile):
        the owner, or a manager allowed to add hosts for a host, changes the mobile of a login that is staff
        at a venue on THIS account and nowhere else; never their own, never a full-access login, never a
        venueplay staff login, never a number another login has; a failed read changes nothing; audited
     2. the REAL billing Worker, POST /admin/login-mobile (vpaHandleLoginMobile): HQ Owner only, the login must
        be on the venue named, the confirm must name it, a number another login has is refused, audited;
        /admin/logins says which logins an Owner can change
     3. venueplay/app/vp-change-mobile.js in a small fake DOM with a fake Supabase Auth: the code goes to the
        NEW number through Auth's phone change, nothing is saved until verifyOtp type "phone_change" passes,
        the sign-in page's rules (VPAboutYou.mobileE164), "Code not arriving? Send it again" with a wait
     4. billing.html, run: hostMobileEditor lifted out of the page and run, the Edit mobile button only where
        Remove is, Change my mobile mounted for a venue login and never for HQ View as, the scripts loaded
     5. venueplay/app/vp-logins-hq.js: Change mobile only for an Owner, typed, asked, then sent; Cancel sends nothing
     6. the words: no em or en dash, "venueplay" lowercase, no mobile number written into any of it

   Run from the repo root:  jsc tools/test-change-mobile.js */
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 400))); } }
function section(t) { print(''); print(t); }
function settle() { for (var i = 0; i < 20; i++) drainMicrotasks(); }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

function U(n) { return '60000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var OWNER = U(1), MGR = U(2), MGR_NO = U(3), HOST = U(4), HOST_X = U(5), FULL = U(6), ADMINHOST = U(7), HOST_PUB = U(8), TAKEN = U(9), MARKET = U(10);
var DEAN = U(20), ACCOUNTS = U(21), STRANGER = U(22);
var PUTS = [], AUTH_PAGE_FAIL = false, AUTH_PUT_FAIL = 0, STAFF_FAIL_FOR = null;
var rigFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url); opts = opts || {};
  /* Fail the one staff read of a login's every venue, with its permissions (never the caller's own, which vpbRequireOwner makes first). */
  if (STAFF_FAIL_FOR && u.indexOf('/rest/v1/vp_venue_staff?') !== -1 && u.indexOf('auth_user_id=eq.' + STAFF_FAIL_FOR) !== -1 && u.indexOf('select=venue_id,role,permissions') !== -1) return Promise.resolve(resp(503, 'upstream blip'));
  var one = /\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(u);
  if (one && opts.method === 'PUT') {
    var b = JSON.parse(opts.body); PUTS.push({ id: one[1], body: b });
    if (AUTH_PUT_FAIL) { AUTH_PUT_FAIL--; return Promise.resolve(resp(500, { msg: 'Database error updating user' })); }
    var d = String(b.phone).replace(/[^\d]/g, '');
    if (tbl('auth').some(function (x) { return x.id !== one[1] && String(x.phone || '').replace(/[^\d]/g, '') === d; }))
      return Promise.resolve(resp(422, { msg: 'Phone number already registered by another user', error_code: 'phone_exists' }));
    var hit = tbl('auth').filter(function (x) { return x.id === one[1]; })[0];
    if (!hit) return Promise.resolve(resp(404, { msg: 'User not found' }));
    hit.phone = d; return Promise.resolve(resp(200, hit));
  }
  /* The user list, PAGED the way Auth pages it, so the strict search ends on an empty page. */
  var pg = /\/auth\/v1\/admin\/users\?per_page=(\d+)&page=(\d+)/.exec(u);
  if (pg) {
    if (AUTH_PAGE_FAIL) return Promise.resolve(resp(503, { msg: 'upstream' }));
    var per = +pg[1], page = +pg[2];
    return Promise.resolve(resp(200, { users: tbl('auth').slice((page - 1) * per, page * per) }));
  }
  return rigFetch(url, opts);
};
function world() {
  DB = {}; FAIL = {}; PUTS = []; AUTH_PAGE_FAIL = false; AUTH_PUT_FAIL = 0; STAFF_FAIL_FOR = null;
  DB.venueplay_founding = [{ id: 'f1', contact_email: 'owner@royalhotel.example', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_1' },
                           { id: 'f2', contact_email: 'boss@elsewhere.example', plan: 'monthly', status: 'card_on_file', stripe_subscription_id: 'sub_2' }];
  DB.vp_venues = [{ id: 'vA', name: 'The Royal Hotel', founding_id: 'f1', slug: 'royal', status: 'active', max_players: 80, created_at: '2026-01-01T00:00:00Z' },
                  { id: 'vB', name: 'The Anchor Hotel', founding_id: 'f1', slug: 'anchor', status: 'active', max_players: 50, created_at: '2026-01-02T00:00:00Z' },
                  { id: 'vZ', name: 'Somebody Else Tavern', founding_id: 'f2', slug: 'else', status: 'active', max_players: 50, created_at: '2026-01-03T00:00:00Z' }];
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' }, { auth_user_id: ADMINHOST, label: 'Harry', role: 'staff' }];
  DB.vp_venue_staff = [
    /* The owner is NAMED (migration 146, is_account_owner; security audit 3 Nov 2026 H2), stored as manager the way provisioning writes it. */
    { id: 's1', auth_user_id: OWNER, venue_id: 'vA', role: 'manager', permissions: null, is_account_owner: true }, { id: 's2', auth_user_id: OWNER, venue_id: 'vB', role: 'manager', permissions: null, is_account_owner: true },
    { id: 's3', auth_user_id: MGR, venue_id: 'vA', role: 'manager', permissions: { add_hosts: true, billing: false } },
    { id: 's4', auth_user_id: MGR_NO, venue_id: 'vA', role: 'manager', permissions: { add_hosts: false } },
    { id: 's5', auth_user_id: HOST, venue_id: 'vA', role: 'host', permissions: null, display_name: 'Sam' },
    { id: 's6', auth_user_id: HOST_X, venue_id: 'vA', role: 'host', permissions: null }, { id: 's7', auth_user_id: HOST_X, venue_id: 'vZ', role: 'host', permissions: null },
    { id: 's8', auth_user_id: FULL, venue_id: 'vA', role: 'manager', permissions: null },
    { id: 's9', auth_user_id: ADMINHOST, venue_id: 'vA', role: 'host', permissions: null },
    { id: 's10', auth_user_id: HOST_PUB, venue_id: 'vB', role: 'host', permissions: null },
    { id: 's11', auth_user_id: TAKEN, venue_id: 'vZ', role: 'manager', permissions: null }];
  DB.auth = [{ id: OWNER, email: 'owner@royalhotel.example', phone: '61400000101' }, { id: MGR, email: '', phone: '61400000102' }, { id: MGR_NO, email: '', phone: '61400000103' },
             { id: HOST, email: '', phone: '61400000104' }, { id: HOST_X, email: '', phone: '61400000105' }, { id: FULL, email: 'full@royalhotel.example', phone: '61400000106' },
             { id: ADMINHOST, email: 'harry@gflam.example', phone: '61400000107' }, { id: HOST_PUB, email: '', phone: '61400000108' },
             { id: TAKEN, email: 'boss@elsewhere.example', phone: '61400000999' },
             { id: DEAN, email: 'dean@gflam.example', phone: '' }, { id: ACCOUNTS, email: 'accounts@gflam.example', phone: '' }];
  DB.vp_admin_audit = [];
}
function as(user, body, venueHeader) {
  var txt = JSON.stringify(body || {});
  return { url: 'https://api/x', method: 'POST',
    headers: { get: function (k) { if (k === 'Authorization') return user ? 'Bearer ' + user : ''; if (k === 'X-VP-Venue') return venueHeader || ''; return ''; } },
    text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function phoneOf(id) { return (tbl('auth').filter(function (x) { return x.id === id; })[0] || {}).phone; }
function audits(a) { return tbl('vp_admin_audit').filter(function (x) { return x.action === a; }); }
var HOSTMOB = function (user, b, hdr) { return vpbHostMobile(as(user, b, hdr), ENV, J); };
var HQMOB = function (user, b) { return vpaHandleLoginMobile(as(user, b), ENV, J); };

/* ---------------- a small DOM: enough for a screen built with createElement and textContent ---------------- */
function Node(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.id = ''; this._text = ''; this.className = '';
  this.value = ''; this.disabled = false; this.hidden = false; this.handlers = {}; this.style = { cssText: '', display: '' }; this.innerHTMLSet = false; }
Object.defineProperty(Node.prototype, 'textContent', { get: function () { return this.children.length ? this.children.map(function (c) { return c.textContent; }).join(' ') : this._text; },
  set: function (v) { this.children = []; this._text = String(v); } });
Object.defineProperty(Node.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
Object.defineProperty(Node.prototype, 'innerHTML', { set: function () { this.innerHTMLSet = true; }, get: function () { return ''; } });
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); };
Node.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
Node.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; };
Node.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
Node.prototype.addEventListener = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
Node.prototype.focus = function () {};
Node.prototype.fire = function (ev, extra) { var me = this, out = []; (this.handlers[ev] || []).forEach(function (f) { out.push(f.call(me, Object.assign({ preventDefault: function () {}, key: '' }, extra || {}))); }); return out[0]; };
Node.prototype.click = function () { if (this.disabled) return; return this.fire('click'); };
function newDoc() {
  var d = { body: new Node('body') };
  d.createElement = function (t) { return new Node(t); };
  d.getElementById = function (id) { function walk(n) { if (n.id === id) return n; for (var i = 0; i < n.children.length; i++) { var f = walk(n.children[i]); if (f) return f; } return null; } return walk(d.body); };
  return d;
}
function shown(n) { for (var x = n; x; x = x.parentNode) { if (x.style && x.style.display === 'none') return false; } return true; }
function anyHtml(n) { if (n.innerHTMLSet) return true; for (var i = 0; i < n.children.length; i++) if (anyHtml(n.children[i])) return true; return false; }

(async function () {
  /* ============================== 1. the Edit mobile route ============================== */
  section('1. /account/host-mobile: who may change a host\'s mobile, and to what');
  world();
  var r = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: '0412 345 678' });
  check('the owner changes a host\'s mobile: saved in the sign-in format, with phone_confirm, once', r.status === 200 && r.body.ok && r.body.mobile_last3 === '678' &&
    phoneOf(HOST) === '61412345678' && PUTS.length === 1 && PUTS[0].body.phone === '+61412345678' && PUTS[0].body.phone_confirm === true, { r: r.body, puts: PUTS });
  var a = audits('staff_mobile_changed')[0] || {};
  check('it is audited: which login, by whom, at which venues, old and new last three digits only', a.target === 'login:' + HOST && a.detail.by === OWNER &&
    a.detail.venue_ids.join() === 'vA' && a.detail.from_end === '104' && a.detail.to_end === '678' && JSON.stringify(a).indexOf('412345678') === -1 && a.actor_label === 'owner', a);
  world();
  r = await HOSTMOB(MGR, { auth_user_id: HOST, mobile: '0412345678' });
  check('a manager allowed to add hosts changes a host\'s mobile, recorded as a manager', r.status === 200 && phoneOf(HOST) === '61412345678' && audits('staff_mobile_changed')[0].actor_label === 'manager', r.body);
  world();
  r = await HOSTMOB(MGR_NO, { auth_user_id: HOST, mobile: '0412345678' });
  check('a manager NOT allowed to add hosts is refused, nothing changed', r.status === 403 && phoneOf(HOST) === '61400000104' && !PUTS.length, r.body);
  r = await HOSTMOB(MGR, { auth_user_id: MGR_NO, mobile: '0412345678' });
  check('a manager cannot change another manager\'s mobile', r.status === 403 && phoneOf(MGR_NO) === '61400000103' && !PUTS.length, r.body);
  r = await HOSTMOB(HOST, { auth_user_id: HOST_PUB, mobile: '0412345678' });
  check('a host cannot change anyone\'s', r.status === 403 && !PUTS.length, r.status);
  r = await HOSTMOB(null, { auth_user_id: HOST, mobile: '0412345678' });
  check('nobody signed in: 401', r.status === 401 && !PUTS.length, r.status);
  r = await HOSTMOB(OWNER, { auth_user_id: MGR_NO, mobile: '0412345678' });
  check('the owner can change a restricted manager\'s mobile', r.status === 200 && phoneOf(MGR_NO) === '61412345678', r.body);

  section('   refused, and nothing changes');
  world();
  r = await HOSTMOB(OWNER, { auth_user_id: OWNER, mobile: '0412345678' });
  check('your own mobile is not changed here (Change my mobile texts a code first)', r.status === 400 && /Change my mobile/.test(r.body.error) && !PUTS.length, r.body);
  r = await HOSTMOB(OWNER, { auth_user_id: FULL, mobile: '0412345678' });
  check('a full-access login: refused', r.status === 403 && /full access/.test(r.body.error) && !PUTS.length && phoneOf(FULL) === '61400000106', r.body);
  r = await HOSTMOB(OWNER, { auth_user_id: HOST_X, mobile: '0412345678' });
  check('a host who also signs in at another business\'s venue: refused, sent to us', r.status === 409 && /hello@venueplay\.com\.au/.test(r.body.error) && !PUTS.length && phoneOf(HOST_X) === '61400000105', r.body);
  r = await HOSTMOB(OWNER, { auth_user_id: ADMINHOST, mobile: '0412345678' });
  check('a venueplay staff login: refused', r.status === 409 && !PUTS.length && phoneOf(ADMINHOST) === '61400000107', r.body);
  r = await HOSTMOB(OWNER, { auth_user_id: TAKEN, mobile: '0412345678' });
  check('a login on none of this account\'s venues: 404, nothing changed', r.status === 404 && !PUTS.length, r.body);
  r = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: '0400 000 999' });
  check('a mobile another login already has: 409, never merged, Auth never asked', r.status === 409 && /another login/.test(r.body.error) && !PUTS.length && phoneOf(HOST) === '61400000104', r.body);
  r = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: '0400000104' });
  check('the mobile it already has: 400, nothing sent to Auth', r.status === 400 && /already the mobile/.test(r.body.error) && !PUTS.length, r.body);
  var bads = ['07 5555 1234', '12345', '', '0412 34567'], badOk = true;
  for (var i = 0; i < bads.length; i++) { var rb = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: bads[i] }); if (rb.status !== 400) badOk = false; }
  check('a landline, a short number or nothing: 400 each, nothing sent', badOk && !PUTS.length);
  r = await HOSTMOB(OWNER, { auth_user_id: 'not-an-id', mobile: '0412345678' });
  check('an id that is not an id: 400', r.status === 400 && !PUTS.length, r.status);
  AUTH_PAGE_FAIL = true;
  r = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: '0412345678' });
  AUTH_PAGE_FAIL = false;
  check('Auth will not answer the "who has this number" search: 503, never read as "nobody", nothing changed', r.status === 503 && !PUTS.length && phoneOf(HOST) === '61400000104', r.body);
  STAFF_FAIL_FOR = HOST;
  r = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: '0412345678' });
  STAFF_FAIL_FOR = null;
  check('the staff read fails: 503, never read as "on no other venue", nothing changed', r.status === 503 && !PUTS.length && phoneOf(HOST) === '61400000104', r.status);
  /* Supabase itself refuses a number another login has, even if the search above missed it (two at once). */
  DB.auth.push({ id: U(30), email: '', phone: '61412000111' });
  var realFind = vpaFindAuthUser; vpaFindAuthUser = async function () { return null; };
  r = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: '0412000111' });
  vpaFindAuthUser = realFind;
  check('Auth refuses the number on the update itself: 409, nothing changed, not audited', r.status === 409 && phoneOf(HOST) === '61400000104' && !audits('staff_mobile_changed').length, r.body);
  AUTH_PUT_FAIL = 1;
  r = await HOSTMOB(OWNER, { auth_user_id: HOST, mobile: '0412345678' });
  check('Auth fails the update: 502 in words, nothing changed, not audited', r.status === 502 && /Nothing was changed/.test(r.body.error) && phoneOf(HOST) === '61400000104' && !audits('staff_mobile_changed').length, r.body);

  /* ============================== 2. HQ ============================== */
  section('2. /admin/login-mobile: HQ changes a venue login\'s mobile, Owner only');
  world();
  var L = await vpaHandleLogins(as(DEAN, { venue_id: 'vA' }), ENV, J);
  function byId(list, id) { return (list || []).filter(function (l) { return l.auth_user_id === id; })[0] || {}; }
  /* vp ids here are not UUIDs, so /admin/logins (which wants one) is asked with a UUID venue in its own world below. */
  check('/admin/logins wants a real venue id', L.status === 400, L.status);
  var VU = '80000000-0000-4000-8000-000000000001';
  DB.vp_venues.push({ id: VU, name: 'The Uuid Arms', founding_id: 'f1', slug: 'uuid', status: 'active' });
  DB.vp_venue_staff.push({ id: 's20', auth_user_id: HOST, venue_id: VU, role: 'host' }, { id: 's21', auth_user_id: ADMINHOST, venue_id: VU, role: 'host' });
  L = await vpaHandleLogins(as(DEAN, { venue_id: VU }), ENV, J);
  check('/admin/logins: an Owner may change a venue login, never a venueplay staff login', L.status === 200 && byId(L.body.logins, HOST).can_change_mobile === true && byId(L.body.logins, ADMINHOST).can_change_mobile === false, L.body);
  L = await vpaHandleLogins(as(ACCOUNTS, { venue_id: VU }), ENV, J);
  check('/admin/logins for accounts: none can be changed', L.status === 200 && L.body.logins.every(function (l) { return l.can_change_mobile === false; }), L.body);
  r = await HQMOB(DEAN, { auth_user_id: HOST, venue_id: VU, mobile: '0412 345 678', confirm: 'ending 104' });
  check('Dean changes it: sign-in format, phone_confirm, the new last three digits back', r.status === 200 && r.body.phone_end === '678' && phoneOf(HOST) === '61412345678' && PUTS[0].body.phone === '+61412345678' && PUTS[0].body.phone_confirm === true, r.body);
  a = audits('login_mobile_changed')[0] || {};
  check('audited: who, which login, which venue, the other venues it signs in at, last three digits only', a.actor_admin === DEAN && a.target === 'login:' + HOST && a.detail.venue_id === VU &&
    a.detail.venue_name === 'The Uuid Arms' && a.detail.also_at.indexOf('The Royal Hotel') !== -1 && a.detail.from_end === '104' && a.detail.to_end === '678' && JSON.stringify(a).indexOf('412345678') === -1, a);
  PUTS = [];
  r = await HQMOB(ACCOUNTS, { auth_user_id: HOST, venue_id: VU, mobile: '0412000222', confirm: 'ending 678' });
  var r2 = await HQMOB(STRANGER, { auth_user_id: HOST, venue_id: VU, mobile: '0412000222', confirm: 'ending 678' });
  var r3 = await HQMOB(OWNER, { auth_user_id: HOST, venue_id: VU, mobile: '0412000222', confirm: 'ending 678' });
  check('accounts, a stranger and a venue owner are refused, nothing changed', r.status === 403 && r2.status === 403 && r3.status === 403 && !PUTS.length && phoneOf(HOST) === '61412345678', [r.status, r2.status, r3.status]);
  r = await HQMOB(DEAN, { auth_user_id: HOST, venue_id: VU, mobile: '0412000222', confirm: 'ending 104' });
  check('a confirm that does not name it (its OLD digits now): 400, nothing changed', r.status === 400 && /did not name this login/.test(r.body.error) && !PUTS.length, r.body);
  r = await HQMOB(DEAN, { auth_user_id: HOST, venue_id: VU, mobile: '0412000222' });
  check('no confirm at all: 400', r.status === 400 && !PUTS.length, r.status);
  r = await HQMOB(DEAN, { auth_user_id: ADMINHOST, venue_id: VU, mobile: '0412000222', confirm: 'harry@gflam.example' });
  check('a venueplay staff login: 409, nothing changed', r.status === 409 && !PUTS.length && phoneOf(ADMINHOST) === '61400000107', r.body);
  r = await HQMOB(DEAN, { auth_user_id: TAKEN, venue_id: VU, mobile: '0412000222', confirm: 'boss@elsewhere.example' });
  check('a login that is not on the venue named: 409, nothing changed', r.status === 409 && /not on this venue/.test(r.body.error) && !PUTS.length, r.body);
  r = await HQMOB(DEAN, { auth_user_id: HOST, venue_id: VU, mobile: '0400000999', confirm: 'ending 678' });
  check('a number another login has: 409, nothing changed', r.status === 409 && !PUTS.length && phoneOf(HOST) === '61412345678', r.body);
  r = await HQMOB(DEAN, { auth_user_id: HOST, venue_id: VU, mobile: '07 5555 1234', confirm: 'ending 678' });
  check('a landline: 400, nothing changed', r.status === 400 && !PUTS.length, r.status);
  FAIL['vp_venue_staff:GET'] = 1;
  r = await HQMOB(DEAN, { auth_user_id: HOST, venue_id: VU, mobile: '0412000222', confirm: 'ending 678' });
  FAIL = {};
  check('a failed read: 503, nothing changed', r.status === 503 && !PUTS.length, r.status);

  PUTS = [];
  r = await HOSTMOB(DEAN, { auth_user_id: HOST_PUB, mobile: '0412000333' }, VU);
  check('HQ View as on the account may use Edit mobile too, audited as the admin', r.status === 200 && phoneOf(HOST_PUB) === '61412000333' &&
    (audits('staff_mobile_changed')[0] || {}).actor_admin === DEAN, r.body);

  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('the router sends /account/host-mobile and /admin/login-mobile to these handlers, and one PUT to Auth changes a phone',
    /path === '\/account\/host-mobile'[^\n]*vpbHostMobile\(request, env, json\)/.test(src) && /path === '\/admin\/login-mobile'[^\n]*vpaHandleLoginMobile\(request, env, json\)/.test(src) &&
    (src.match(/method: 'PUT', headers: vpaHeaders\(env\), body: JSON\.stringify\(\{ phone: e164, phone_confirm: true \}\)/g) || []).length === 1);

  /* ============================== 3. Change my mobile ============================== */
  section('3. Change my mobile (vp-change-mobile.js): a code to the NEW number, saved only once it is typed');
  var W = {};
  (new Function('window', readFile('venueplay/app/vp-about-you.js')))(W);
  (new Function('window', readFile('venueplay/app/vp-change-mobile.js')))(W);
  var CM = W.VPChangeMobile;
  check('vp-change-mobile.js loads beside vp-about-you.js and offers mount', !!(CM && typeof CM.mount === 'function' && W.VPAboutYou));
  var CALLS, AUTHPHONE, NEXT, NOW = 1000000;
  function fakeClient(withResend) {
    var auth = {
      updateUser: function (b) { CALLS.push(['updateUser', b]); var n = NEXT.update.shift(); return Promise.resolve(n || { data: { user: { phone: AUTHPHONE } }, error: null }); },
      verifyOtp: function (b) { CALLS.push(['verifyOtp', b]); var n = NEXT.verify.shift();
        if (n) return Promise.resolve(n);
        if (b.token === '123456') { AUTHPHONE = b.phone.replace('+', ''); return Promise.resolve({ data: { user: { phone: AUTHPHONE } }, error: null }); }
        return Promise.resolve({ data: { user: null }, error: { message: 'Token has expired or is invalid' } }); }
    };
    if (withResend) auth.resend = function (b) { CALLS.push(['resend', b]); return Promise.resolve({ error: null }); };
    return { auth: auth };
  }
  function fresh(withResend) {
    CALLS = []; AUTHPHONE = '61400000101'; NEXT = { update: [], verify: [] };
    var d = newDoc(), host = d.createElement('div'); d.body.appendChild(host);
    var changed = [];
    var c = CM.mount(host, { doc: d, client: fakeClient(withResend !== false), phone: '61400000101', now: function () { return NOW; }, onChanged: function (p, w) { changed.push([p, w]); } });
    return { d: d, c: c, changed: changed, $: function (id) { return d.getElementById(id); } };
  }
  var T = fresh();
  check('it shows the number they sign in with now, and a Change my mobile button; the form is closed', /You sign in with 0400 000 101\./.test(T.$('myMobileNow').textContent) &&
    T.$('myMobileBtn').textContent === 'Change my mobile' && !shown(T.$('cmPanel')), T.$('myMobileNow').textContent);
  T.$('myMobileBtn').click();
  check('Change my mobile opens the new number box', shown(T.$('cmStep1')) && shown(T.$('cmMobile')) && !shown(T.$('cmStep2')));
  T.$('cmMobile').value = '07 5555 1234'; await T.c.ask(); settle();
  check('a landline is refused before anything is sent, in plain words', /should start 04/.test(T.$('cmMsg').textContent) && !CALLS.length, T.$('cmMsg').textContent);
  T.$('cmMobile').value = ''; await T.c.ask();
  check('nothing typed: asked for it, nothing sent', /Type your new mobile first/.test(T.$('cmMsg').textContent) && !CALLS.length);
  T.$('cmMobile').value = '0400 000 101'; await T.c.ask();
  check('the number they already have: said, nothing sent', /mobile you sign in with now/.test(T.$('cmMsg').textContent) && !CALLS.length);
  T.$('cmMobile').value = '0412 345 678'; await T.c.ask(); settle();
  check('a new number: Auth\'s phone change is asked for it, in the sign-in format (+614...), and nothing else', CALLS.length === 1 && CALLS[0][0] === 'updateUser' &&
    CALLS[0][1].phone === '+61412345678' && Object.keys(CALLS[0][1]).join() === 'phone', CALLS);
  check('nothing is saved yet: the login still signs in with the old number', AUTHPHONE === '61400000101' && !T.changed.length);
  check('the code box opens and says where the text went', shown(T.$('cmStep2')) && !shown(T.$('cmStep1')) && /0412 345 678/.test(T.$('cmSentTo').textContent), T.$('cmSentTo').textContent);
  T.$('cmCode').value = '12'; await T.c.confirmCode();
  check('a short code is refused before Auth is asked', /6-digit code/.test(T.$('cmMsg').textContent) && CALLS.length === 1);
  T.$('cmCode').value = '999999'; await T.c.confirmCode(); settle();
  check('a wrong code: Auth refuses it, nothing saved, said plainly', CALLS[1][0] === 'verifyOtp' && /didn't match/.test(T.$('cmMsg').textContent) && AUTHPHONE === '61400000101' && !T.changed.length, T.$('cmMsg').textContent);
  NOW += 5000; await T.c.sendAgain();
  check('"Code not arriving? Send it again" within 30 seconds: asked to wait, nothing sent', /30 seconds/.test(T.$('cmMsg').textContent) && CALLS.length === 2 && T.$('cmResend').textContent === 'Code not arriving? Send it again');
  NOW += 30000; await T.c.sendAgain(); settle();
  check('after 30 seconds: a fresh phone_change code to the SAME new number, and it says so', CALLS.length === 3 && CALLS[2][0] === 'resend' && CALLS[2][1].type === 'phone_change' &&
    CALLS[2][1].phone === '+61412345678' && /Sent again/.test(T.$('cmMsg').textContent), CALLS[2]);
  T.$('cmCode').value = '123456'; await T.c.confirmCode(); settle();
  check('the right code: verifyOtp type "phone_change" for the new number; only now is it saved', CALLS[3][0] === 'verifyOtp' && CALLS[3][1].type === 'phone_change' &&
    CALLS[3][1].phone === '+61412345678' && CALLS[3][1].token === '123456' && AUTHPHONE === '61412345678', CALLS[3]);
  check('the page is told, and says the new number and that the old one no longer works', T.changed.length === 1 && T.changed[0][0] === '61412345678' &&
    /now sign in with 0412 345 678\. Your old number no longer works\./.test(T.$('myMobileNow').textContent) && !shown(T.$('cmPanel')), T.$('myMobileNow').textContent);
  T = fresh(false);
  T.$('myMobileBtn').click(); T.$('cmMobile').value = '0412345678'; await T.c.ask(); settle(); NOW += 31000; await T.c.sendAgain(); settle();
  check('an older client with no auth.resend sends again through the phone change itself', CALLS.length === 2 && CALLS[1][0] === 'updateUser' && CALLS[1][1].phone === '+61412345678', CALLS);
  T = fresh();
  NEXT.update.push({ data: null, error: { message: 'Phone number already registered by another user', code: 'phone_exists' } });
  T.$('myMobileBtn').click(); T.$('cmMobile').value = '0400000999'; await T.c.ask(); settle();
  check('a number another login has: said plainly, the code box never opens', /already signs in to venueplay on another login/.test(T.$('cmMsg').textContent) && !shown(T.$('cmStep2')), T.$('cmMsg').textContent);
  NEXT.update.push({ data: null, error: { message: 'Error sending sms' } });
  T.$('cmMobile').value = '0412345678'; await T.c.ask(); settle();
  check('a text that cannot be sent: said plainly, the code box never opens', /couldn't text that number/.test(T.$('cmMsg').textContent) && !shown(T.$('cmStep2')));
  T.$('cmMobile').value = '0412345678'; await T.c.ask(); settle();
  T.$('cmAgain').click();
  check('"Use a different number" goes back to the number box', shown(T.$('cmStep1')) && !shown(T.$('cmStep2')));
  T.$('cmCancel').click();
  check('Cancel closes it, nothing saved', !shown(T.$('cmPanel')) && AUTHPHONE === '61400000101');
  NEXT.verify.push({ data: { user: { phone: '61400000101' } }, error: null });
  T.$('myMobileBtn').click(); T.$('cmMobile').value = '0412345678'; await T.c.ask(); settle(); T.$('cmCode').value = '111111'; await T.c.confirmCode(); settle();
  check('an answer whose phone is not the new number is not read as done', !T.changed.length && /didn't match/.test(T.$('cmMsg').textContent));
  check('nothing it draws is HTML: every word is textContent', !anyHtml(T.d.body));
  check('with no Auth client it draws nothing', CM.mount(newDoc().createElement('div'), { doc: newDoc(), client: null }) === null);

  /* ============================== 4. billing.html ============================== */
  section('4. billing.html: Edit mobile on a host, Change my mobile mounted for a venue login only');
  var page = readFile('venueplay/app/billing.html');
  function lift(src2, name) {
    var at = src2.indexOf('function ' + name + '(');
    if (at < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
    var dd = 0, k = src2.indexOf('{', at);
    do { if (src2[k] === '{') dd++; else if (src2[k] === '}') dd--; k++; } while (dd > 0 && k < src2.length);
    return src2.slice(at, k);
  }
  var PD = newDoc();
  var editor = (new Function('document', 'window', lift(page, 'hostMobileEditor') + '\nreturn hostMobileEditor;'))(PD, W);
  var POSTS = [], SAID = [], RELOADS = 0, ANSWER = { ok: true, mobile_last3: '678' };
  var panel = editor({ auth_user_id: HOST, label: 'Sam' }, function (p, b) { POSTS.push([p, b]); return Promise.resolve(ANSWER); }, function (m, good) { SAID.push([m, good]); }, function () { RELOADS++; });
  PD.body.appendChild(panel);
  function inPanel(tag) { var out = []; (function walk(n) { if (n.tagName === tag) out.push(n); n.children.forEach(walk); })(panel); return out; }
  var inp = inPanel('INPUT')[0], lab = inPanel('LABEL')[0], pmsg = inPanel('P')[1];
  check('the editor starts closed and names the person', panel.style.display === 'none' && lab.textContent === 'New mobile for Sam' && lab.getAttribute('for') === inp.id);
  inp.value = '07 5555 1234'; await panel._save();
  check('a landline is refused on the page, nothing posted', /should start 04/.test(pmsg.textContent) && !POSTS.length, pmsg.textContent);
  inp.value = '0412 345 678'; await panel._save(); settle();
  check('a mobile posts once to /account/host-mobile, the host and the number in the sign-in format', POSTS.length === 1 && POSTS[0][0] === '/account/host-mobile' &&
    POSTS[0][1].auth_user_id === HOST && POSTS[0][1].mobile === '+61412345678', POSTS);
  check('saved: says who now signs in with what, and the list is read again', SAID.length === 1 && SAID[0][1] === true && /^Sam now signs in with 0412 345 678\. Let them know\.$/.test(SAID[0][0]) && RELOADS === 1, SAID);
  ANSWER = { error: 'That mobile already signs in to venueplay on another login, so it cannot go on this one too. Use a different mobile. Nothing was changed.' };
  panel.style.display = 'block'; inp.value = '0400000999'; await panel._save(); settle();
  check('the Worker\'s refusal is shown in the panel, nothing reloaded', /another login/.test(pmsg.textContent) && RELOADS === 1 && panel.style.display === 'block', pmsg.textContent);
  check('the editor is all textContent', !anyHtml(panel));
  var rh = lift(page, 'renderHosts');
  check('Edit mobile is drawn exactly where Remove is (mayTouch), and opens its own editor',
    /mayTouch \? '<button class="edv">Edit venues<\/button><button class="edv edm">Edit mobile<\/button>'( \+ \(hostedReady \? '<button class="edv hbb">Show on TV<\/button>' : ''\) \+ ')?<button class="rm">Remove<\/button>'/.test(rh) &&
    /var em = hostMobileEditor\(h, api, showMsg, loadHosts\)/.test(rh) && /querySelector\("\.edm"\)\.addEventListener/.test(rh), rh.slice(0, 200));
  var mm = (new Function('document', 'window', 'localStorage', '$', 'VP', 'VPChangeMobile', 'showMsg', 'loadHosts',
    lift(page, 'mountMyMobile') + '\nreturn mountMyMobile;'));
  function tryMount(ctx, imp) {
    var d = newDoc(), hostEl = d.createElement('div'), head = d.createElement('div'); hostEl.id = 'myMobile'; head.id = 'mySigninHead'; head.hidden = true;
    d.body.appendChild(head); d.body.appendChild(hostEl);
    var mounted = [];
    var CMfake = { mount: function (h, o) { mounted.push(o); } };
    var fn = mm(d, { VPChangeMobile: CMfake }, { getItem: function () { return imp ? JSON.stringify(imp) : null; } }, function (id) { return d.getElementById(id); },
      { getClient: function () { return { auth: {} }; } }, CMfake, function () {}, function () {});
    fn(ctx);
    return { mounted: mounted, head: head };
  }
  var mt = tryMount({ scope: 'staff', isAdmin: false, user: { id: 'u', phone: '61400000101' } }, null);
  check('a venue login on the account page gets Change my mobile, with its own number', mt.mounted.length === 1 && mt.mounted[0].phone === '61400000101' && mt.head.hidden === false);
  check('HQ View as never does', tryMount({ scope: 'staff', isAdmin: false, user: { id: 'u' } }, { id: 'vA' }).mounted.length === 0 &&
    tryMount({ scope: 'admin', isAdmin: true, user: { id: 'u' } }, null).mounted.length === 0);
  var pageNoComments = page.replace(/<!--[\s\S]*?-->/g, '');
  check('billing.html loads vp-about-you.js and vp-change-mobile.js with real tags, has the place for it, and mounts it after sign-in',
    pageNoComments.indexOf('<script src="/app/vp-about-you.js"></script>') !== -1 && pageNoComments.indexOf('<script src="/app/vp-change-mobile.js"></script>') !== -1 &&
    /<div id="myMobile"><\/div>/.test(pageNoComments) && /loadHosts\(\);[^\n]*\n\s*mountMyMobile\(ctx\);/.test(pageNoComments));

  /* ============================== 5. HQ page ============================== */
  section('5. HQ (vp-logins-hq.js): Change mobile only for an Owner, typed, asked, then sent');
  var BOXES = {};
  function hel(id) { return { id: id, innerHTML: '', attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return this.attrs[k]; },
    querySelector: function (q) { if (q === '.vploginlist') return this.list || (this.list = hel('list')); return null; }, addEventListener: function () {} }; }
  var HQW = { document: { querySelector: function (q) { var m = /data-vplogins="([^"]+)"/.exec(q); return m ? (BOXES[m[1]] || (BOXES[m[1]] = hel('box'))) : null; },
    getElementById: function () { return null; }, addEventListener: function () {} }, VPAboutYou: W.VPAboutYou };
  (new Function(readFile('venueplay/app/vp-logins-hq.js'))).call(HQW);
  var VL = HQW.VPLogins;
  var HP = [], HA = [], HT = [], HANS = [], HOWNER = true, HLIST = null;
  VL.init({ post: function (p, b) { HP.push([p, b]); return Promise.resolve(p === '/admin/logins' ? HLIST : { ok: true, phone_end: '678' }); },
            ask: function (q) { HA.push(q); return Promise.resolve(HANS.length ? HANS.shift() : false); },
            tell: function (m) { HT.push(m); return Promise.resolve(); }, isOwner: function () { return HOWNER; } });
  var PL = { auth_user_id: HOST, email: '', phone_end: '104', role: 'host', can_remove: false, can_change_mobile: true, why_not: 'x',
             venues: [{ id: VU, name: 'The Uuid Arms' }, { id: 'vA', name: 'The Royal Hotel' }] };
  var AL = { auth_user_id: ADMINHOST, email: 'harry@gflam.example', role: 'host', can_remove: false, can_change_mobile: false, why_not: 'y' };
  HLIST = { ok: true, logins: [PL, AL] };
  VL.venueBlock(VU, 'The Uuid Arms');
  await VL.showLogins(VU);
  var lh = BOXES[VU].list.innerHTML;
  check('Change mobile on the login that can change, not on the venueplay staff login', (lh.match(/data-loginmobile=/g) || []).length === 1 && lh.indexOf('data-loginmobile="' + HOST + '"') !== -1, lh);
  HOWNER = false; await VL.showLogins(VU); HOWNER = true;
  check('for anyone but an Owner, no Change mobile', !/data-loginmobile=/.test(BOXES[VU].list.innerHTML));
  HP = []; HA = [];
  var x = await VL.changeMobile(PL, VU, 'The Uuid Arms', '07 5555 1234');
  check('a landline: told, nothing asked, nothing sent', x.invalid === true && !HA.length && !HP.length && /should start 04/.test(HT[HT.length - 1]));
  HANS = [false];
  x = await VL.changeMobile(PL, VU, 'The Uuid Arms', '0412 345 678');
  check('the question names the login, the new number, and the other venue it changes at; Cancel sends nothing', x.cancelled === true && HA.length === 1 && !HP.length &&
    /the mobile ending 104 signs in with to 0412 345 678\?/.test(HA[0]) && /The Royal Hotel/.test(HA[0]) && /old number stops signing in/.test(HA[0]), HA[0]);
  HANS = [true];
  x = await VL.changeMobile(PL, VU, 'The Uuid Arms', '0412 345 678');
  check('OK: one change sent, for that login and venue, the number in the sign-in format, the confirm naming the login', HP.length === 1 && HP[0][0] === '/admin/login-mobile' &&
    HP[0][1].auth_user_id === HOST && HP[0][1].venue_id === VU && HP[0][1].mobile === '+61412345678' && HP[0][1].confirm === 'ending 104' && /^Changed\./.test(HT[HT.length - 1]), HP);
  var hq = readFile('venueplay/app/hq.html').replace(/<!--[\s\S]*?-->/g, '');
  check('hq.html loads vp-about-you.js before vp-logins-hq.js', hq.indexOf('<script src="vp-about-you.js"></script>') !== -1 &&
    hq.indexOf('<script src="vp-about-you.js"></script>') < hq.indexOf('<script src="vp-logins-hq.js"></script>'));

  /* ============================== 6. the words ============================== */
  section('6. The words');
  var wsrc = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  var routes = lift(wsrc, 'vpaSetLoginPhone') + lift(wsrc, 'vpbHostMobile') + lift(wsrc, 'vpaHandleLoginMobile');
  var words = readFile('venueplay/app/vp-change-mobile.js') + lift(page, 'hostMobileEditor') + lift(page, 'mountMyMobile') + readFile('venueplay/app/vp-logins-hq.js') + routes;
  check('no em or en dash anywhere in it', !/[—–]/.test(words));
  check('"venueplay" is never capitalised in anything a person reads', !/VenuePlay|Venueplay/.test(words.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('no mobile number is written into any of it (only the 0400 000 000 example)', !/0[45]\d{2}\s?\d{3}\s?\d{3}/.test(words.replace(/0400 000 000/g, '')) && !/\+?614\d{8}/.test(words));
  finished = true;
})().catch(function (e) { fails++; print('  FAIL the suite threw: ' + (e && e.stack || e)); }).then(function () {
  print('');
  if (!finished) { fails++; print('  FAIL the suite did not run to the end'); }
  print(fails ? 'FAILED: ' + fails + ' of ' + ran + ' checks failed' : 'ALL ' + ran + ' CHECKS PASSED');
});
