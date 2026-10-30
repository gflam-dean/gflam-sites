/* HQ: REMOVE A LOGIN THAT BELONGS TO NO OTHER VENUE, RUN AND NOT READ (Dean, 30 Oct 2026).

   Sarah's end-to-end test was held because her email already had a VenuePlay login from an earlier test,
   and the only way to clear it was the Supabase dashboard. This runs the REAL billing Worker
   (tools/rig-billing-worker.js) through vpaHandleLogins, vpaHandleLoginFind and vpaHandleLoginRemove
   against a fake PostgREST and a fake Supabase Auth that records every delete, and the REAL
   venueplay/app/vp-logins-hq.js against a fake page. It proves:

     1. only HQ sees logins (owner or accounts); only an OWNER removes one
     2. a login on any other venue, or a VenuePlay staff login, is refused and nothing changes
     3. the confirm must name that login's own email ("ending 123" for a mobile-only login)
     4. the removal deletes the venue's staff row then the Auth user, puts the row back if Auth
        refuses, is audited, and a failed read never reads as "on no other venue"
     5. on the page nothing removes a login by itself: a removal starts from a tap, the question names
        the email, Cancel sends nothing; after an archive it asks about each removable login, one by one

   Run from the repo root:  jsc tools/test-remove-login-hq.js */
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { fails++; print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 400))); } }
function section(t) { print(''); print(t); }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };

function U(n) { return '70000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACCOUNTS = U(2), STAFFADMIN = U(3), STRANGER = U(9);
var SARAH = U(11), HOST2 = U(12), PHONEONLY = U(13), ADMINLOGIN = U(14), LONELY = U(15);
var BAR = '80000000-0000-4000-8000-000000000001', PUB = '80000000-0000-4000-8000-000000000002';
var DELETES = [], AUTH_FAIL = false;
var rigFetch2 = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  var u = String(url), m = /\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(u);
  if (m && opts && opts.method === 'DELETE') {
    DELETES.push(m[1]);
    if (AUTH_FAIL) return Promise.resolve(resp(500, { msg: 'Database error deleting user' }));
    DB.auth = tbl('auth').filter(function (x) { return x.id !== m[1]; });
    return Promise.resolve(resp(200, {}));
  }
  return rigFetch2(url, opts);
};
function world() {
  DB = {}; FAIL = {}; DELETES = []; AUTH_FAIL = false;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACCOUNTS, label: 'Accounts', role: 'accounts' },
                           { auth_user_id: STAFFADMIN, label: 'Staff', role: 'staff' }, { auth_user_id: ADMINLOGIN, label: 'Harry', role: 'staff' }];
  DB.vp_venues = [{ id: BAR, name: "Sarah's Test Bar", status: 'active' }, { id: PUB, name: 'Deepwater Hotel', status: 'active' }];
  DB.vp_venue_staff = [{ id: 's1', venue_id: BAR, auth_user_id: SARAH, role: 'manager' }, { id: 's2', venue_id: BAR, auth_user_id: HOST2, role: 'host' },
                       { id: 's3', venue_id: PUB, auth_user_id: HOST2, role: 'host' }, { id: 's4', venue_id: BAR, auth_user_id: PHONEONLY, role: 'host' },
                       { id: 's5', venue_id: BAR, auth_user_id: ADMINLOGIN, role: 'manager' }, { id: 's6', venue_id: PUB, auth_user_id: U(16), role: 'owner' }];
  DB.auth = [{ id: SARAH, email: 'sarah@gflam.com.au', phone: '61400111222' }, { id: HOST2, email: 'host2@example.com', phone: '' },
             { id: PHONEONLY, email: '', phone: '61400333678' }, { id: ADMINLOGIN, email: 'harry@gflam.com.au', phone: '' },
             { id: LONELY, email: 'lonely@example.com', phone: '' }, { id: U(16), email: 'owner@deepwater.example', phone: '' }];
  DB.vp_admin_audit = [];
}
function as(user, path, body) {
  var txt = JSON.stringify(body || {});
  return { url: 'https://api' + path, method: 'POST', headers: { get: function (k) { return k === 'Authorization' && user ? 'Bearer ' + user : ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
var LOGINS = function (user, b) { return vpaHandleLogins(as(user, '/admin/logins', b), ENV, J); };
var FIND = function (user, b) { return vpaHandleLoginFind(as(user, '/admin/login-find', b), ENV, J); };
var REMOVE = function (user, b) { return vpaHandleLoginRemove(as(user, '/admin/login-remove', b), ENV, J); };
function hasAuth(id) { return tbl('auth').some(function (x) { return x.id === id; }); }
function staffOf(id) { return tbl('vp_venue_staff').filter(function (x) { return x.auth_user_id === id; }).map(function (x) { return x.venue_id; }).sort(); }
function audits(a) { return tbl('vp_admin_audit').filter(function (x) { return x.action === a; }); }
function byId(list, id) { return (list || []).filter(function (l) { return l.auth_user_id === id; })[0] || {}; }

(async function () {
  section('1. ONLY HQ SEES LOGINS, ONLY AN OWNER REMOVES ONE');
  world();
  var r = await LOGINS(DEAN, { venue_id: BAR }), L = r.body.logins || [];
  check('Dean sees the venue\'s four logins, each with whether it can go', r.status === 200 && L.length === 4, r.body);
  check('Sarah\'s login, on this venue only: can be removed', byId(L, SARAH).can_remove === true && byId(L, SARAH).email === 'sarah@gflam.com.au' && byId(L, SARAH).why_not === '', byId(L, SARAH));
  check('a login also on Deepwater Hotel: cannot, and it says where', byId(L, HOST2).can_remove === false && /Deepwater Hotel/.test(byId(L, HOST2).why_not), byId(L, HOST2));
  check('a VenuePlay staff login: cannot, and it says why', byId(L, ADMINLOGIN).can_remove === false && /VenuePlay staff login/.test(byId(L, ADMINLOGIN).why_not), byId(L, ADMINLOGIN));
  check('a mobile-only login is shown by its last three digits, never the whole number', byId(L, PHONEONLY).phone_end === '678' && JSON.stringify(r.body).indexOf('400333678') === -1, byId(L, PHONEONLY));
  r = await LOGINS(ACCOUNTS, { venue_id: BAR });
  check('accounts sees them, but none says it can be removed: only an Owner', r.status === 200 && r.body.logins.every(function (l) { return !l.can_remove; }) && /Only an Owner/.test(byId(r.body.logins, SARAH).why_not), r.body);
  r = await LOGINS(STAFFADMIN, { venue_id: BAR });
  var r2 = await LOGINS(SARAH, { venue_id: BAR }), r3 = await LOGINS(null, { venue_id: BAR });
  check('a staff admin, a venue\'s own login and nobody are refused the list', r.status === 403 && r2.status === 403 && r3.status === 401, [r.status, r2.status, r3.status]);
  r = await REMOVE(ACCOUNTS, { auth_user_id: SARAH, venue_id: BAR, confirm: 'sarah@gflam.com.au' });
  var r4 = await REMOVE(SARAH, { auth_user_id: SARAH, venue_id: BAR, confirm: 'sarah@gflam.com.au' });
  check('accounts, and the login itself, cannot remove it: refused, nothing deleted', r.status === 403 && r4.status === 403 && !DELETES.length && hasAuth(SARAH) && staffOf(SARAH).length === 1, [r.status, r4.status, DELETES]);

  section('2. FIND A LOGIN BY EMAIL');
  r = await FIND(DEAN, { email: ' Sarah@GFLAM.com.au ' });
  check('found, with the one venue it is on, removable with that venue', r.status === 200 && r.body.login.auth_user_id === SARAH && r.body.login.venue_id === BAR &&
    r.body.login.venues.length === 1 && r.body.login.venues[0].name === "Sarah's Test Bar" && r.body.login.can_remove === true, r.body);
  r = await FIND(DEAN, { email: 'lonely@example.com' });
  check('a login on no venue: removable, with no venue', r.body.login && r.body.login.venues.length === 0 && r.body.login.venue_id === null && r.body.login.can_remove === true, r.body);
  r = await FIND(DEAN, { email: 'host2@example.com' });
  check('a login on two venues: cannot be removed from here, and it names them', r.body.login.can_remove === false && /Sarah's Test Bar|Deepwater Hotel/.test(r.body.login.why_not), r.body.login);
  r = await FIND(DEAN, { email: 'nobody@example.com' });
  check('no such login: says so (login null)', r.status === 200 && r.body.login === null, r.body);
  r = await FIND(DEAN, { email: 'sarah' });
  check('half an email is refused', r.status === 400, r.status);

  section('3. REFUSED, AND NOTHING CHANGES');
  r = await REMOVE(DEAN, { auth_user_id: SARAH, venue_id: BAR, confirm: 'host2@example.com' });
  check('a confirm that names another login: 400, nothing deleted', r.status === 400 && /did not name this login/.test(r.body.error) && !DELETES.length && staffOf(SARAH).length === 1, r.body);
  r = await REMOVE(DEAN, { auth_user_id: SARAH, venue_id: BAR });
  check('no confirm at all: 400, nothing deleted', r.status === 400 && !DELETES.length, r.status);
  r = await REMOVE(DEAN, { auth_user_id: HOST2, venue_id: BAR, confirm: 'host2@example.com' });
  check('a login that is staff at another venue: 409, still on both venues, not deleted', r.status === 409 && /Deepwater Hotel/.test(r.body.error) && !DELETES.length &&
    staffOf(HOST2).length === 2 && hasAuth(HOST2), r.body);
  r = await REMOVE(DEAN, { auth_user_id: ADMINLOGIN, venue_id: BAR, confirm: 'harry@gflam.com.au' });
  check('a VenuePlay staff login: 409, not deleted', r.status === 409 && !DELETES.length && hasAuth(ADMINLOGIN), r.body);
  r = await REMOVE(DEAN, { auth_user_id: SARAH, confirm: 'sarah@gflam.com.au' });
  check('Sarah\'s login with no venue named: it IS on a venue, so 409, nothing changed', r.status === 409 && !DELETES.length && staffOf(SARAH).length === 1, r.body);
  FAIL['vp_venue_staff:GET'] = 1;
  r = await REMOVE(DEAN, { auth_user_id: HOST2, venue_id: BAR, confirm: 'host2@example.com' });
  check('the database fails on the check: 503, never read as "on no other venue", nothing deleted', r.status === 503 && !DELETES.length && staffOf(HOST2).length === 2, r.body);
  r = await REMOVE(DEAN, { auth_user_id: U(99), confirm: 'x@y.example' });
  check('a login that is not there: 404, nothing deleted', r.status === 404 && !DELETES.length, r.status);
  r = await REMOVE(DEAN, { auth_user_id: 'not-a-uuid', confirm: 'x' });
  check('an id that is not an id: 400', r.status === 400, r.status);

  section('4. REMOVED: the staff row, then the login, audited; put back if Supabase refuses');
  AUTH_FAIL = true;
  r = await REMOVE(DEAN, { auth_user_id: SARAH, venue_id: BAR, confirm: 'sarah@gflam.com.au' });
  check('Supabase refuses the delete: 502, her staff row is put back, the login still there, the failure audited', r.status === 502 && DELETES.length === 1 &&
    staffOf(SARAH).length === 1 && hasAuth(SARAH) && audits('login_remove_failed').length === 1 && !audits('login_removed').length, { r: r.body, staff: staffOf(SARAH) });
  AUTH_FAIL = false; DELETES = [];
  var before = tbl('vp_venue_staff').length;
  r = await REMOVE(DEAN, { auth_user_id: SARAH, venue_id: BAR, confirm: '  SARAH@gflam.com.au ' });
  check('removed: one Supabase delete for her id, her one staff row gone, nobody else\'s touched', r.status === 200 && r.body.ok && DELETES.length === 1 && DELETES[0] === SARAH &&
    !hasAuth(SARAH) && staffOf(SARAH).length === 0 && tbl('vp_venue_staff').length === before - 1 && staffOf(HOST2).length === 2, { r: r.body, d: DELETES });
  var a = audits('login_removed')[0] || {};
  check('the audit says who removed which login, from which venue', a.actor_admin === DEAN && a.target === 'login:' + SARAH && a.detail.email === 'sarah@gflam.com.au' &&
    a.detail.venue_name === "Sarah's Test Bar" && a.detail.staff_rows === 1, a);
  DELETES = [];
  r = await REMOVE(DEAN, { auth_user_id: PHONEONLY, venue_id: BAR, confirm: 'ending 111' });
  var r5 = await REMOVE(DEAN, { auth_user_id: PHONEONLY, venue_id: BAR, confirm: 'ending 678' });
  check('a mobile-only login: the wrong last digits refused, the right ones ("ending 678") remove it', r.status === 400 && r5.status === 200 && DELETES.length === 1 && !hasAuth(PHONEONLY), [r.status, r5.status]);
  DELETES = [];
  r = await REMOVE(DEAN, { auth_user_id: LONELY, confirm: 'lonely@example.com' });
  check('a login on no venue, no venue named: removed', r.status === 200 && DELETES.length === 1 && !hasAuth(LONELY), r.body);

  section('5. ON THE PAGE: nothing removes a login by itself');
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('in the Worker, only the router calls vpaHandleLoginRemove, and nothing else sends a delete to auth/v1/admin/users',
    (src.match(/vpaHandleLoginRemove\(/g) || []).length === 2 && /path === '\/admin\/login-remove'[^\n]*vpaHandleLoginRemove\(request, env, json\)/.test(src) &&
    (src.match(/auth\/v1\/admin\/users\/' \+ encodeURIComponent\(id\), \{ method: 'DELETE'/g) || []).length === 1, (src.match(/vpaHandleLoginRemove\(/g) || []).length);
  // a fake page
  var BOXES = {};
  function el(id) { return { id: id, innerHTML: '', attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return this.attrs[k]; },
    querySelector: function (q) { if (q === '.vploginlist') return this.list || (this.list = el('list')); return null; }, addEventListener: function () {} }; }
  document = { querySelector: function (q) { var m = /data-vplogins="([^"]+)"/.exec(q); return m ? (BOXES[m[1]] || (BOXES[m[1]] = el('box'))) : null; },
               getElementById: function (id) { return BOXES['#' + id] || null; }, addEventListener: function () {} };
  load('venueplay/app/vp-logins-hq.js');
  var POSTS = [], ASKED = [], TOLD = [], ANSWERS = [], OWNER = true, LIST = null;
  VPLogins.init({ post: function (p, b) { POSTS.push([p, b]); return Promise.resolve(p === '/admin/logins' ? LIST : { ok: true }); },
                  ask: function (q) { ASKED.push(q); return Promise.resolve(ANSWERS.length ? ANSWERS.shift() : false); },
                  tell: function (m) { TOLD.push(m); return Promise.resolve(); }, isOwner: function () { return OWNER; } });
  var SL = { auth_user_id: SARAH, email: 'Sarah@gflam.com.au', role: 'manager', can_remove: true, why_not: '' };
  var HL = { auth_user_id: HOST2, email: 'host2@example.com', role: 'host', can_remove: false, why_not: 'It is staff at Deepwater Hotel, so it cannot be removed.' };
  LIST = { ok: true, logins: [SL, HL] };
  VPLogins.venueBlock(BAR, "Sarah's Test Bar");
  check('opening a venue\'s Details draws a Show logins button and asks the Worker NOTHING', POSTS.length === 0 && /data-loginsshow=/.test(BOXES[BAR].innerHTML), BOXES[BAR].innerHTML);
  await VPLogins.showLogins(BAR);
  var listHtml = BOXES[BAR].list.innerHTML;
  check('Show logins lists them: Remove login only on the one that can go; the other says why', POSTS.length === 1 && POSTS[0][0] === '/admin/logins' &&
    (listHtml.match(/data-loginremove=/g) || []).length === 1 && listHtml.indexOf('data-loginremove="' + SARAH + '"') !== -1 && /Deepwater Hotel/.test(listHtml), listHtml);
  OWNER = false; await VPLogins.showLogins(BAR); OWNER = true;
  check('for anyone but an Owner, no Remove login button at all', !/data-loginremove=/.test(BOXES[BAR].list.innerHTML), BOXES[BAR].list.innerHTML);
  check('the question names the email and says it cannot be undone', /Remove the login Sarah@gflam\.com\.au\?/.test(VPLogins.confirmText(SL, "Sarah's Test Bar")) &&
    /cannot be undone/.test(VPLogins.confirmText(SL, "Sarah's Test Bar")) && /only on Sarah's Test Bar/.test(VPLogins.confirmText(SL, "Sarah's Test Bar")));
  POSTS = []; ASKED = []; ANSWERS = [false];
  var x = await VPLogins.remove(SL, BAR, "Sarah's Test Bar");
  check('Cancel on the question: nothing is sent', x.cancelled === true && ASKED.length === 1 && POSTS.length === 0, POSTS);
  ANSWERS = [true];
  await VPLogins.remove(SL, BAR, "Sarah's Test Bar");
  check('OK: one removal is sent, for that login and venue, the confirm being its own email', POSTS.length === 1 && POSTS[0][0] === '/admin/login-remove' &&
    POSTS[0][1].auth_user_id === SARAH && POSTS[0][1].venue_id === BAR && POSTS[0][1].confirm === 'sarah@gflam.com.au' && /Removed the login/.test(TOLD[TOLD.length - 1]), POSTS);
  check('a mobile-only login is confirmed by its last three digits', VPLogins.confirmValue({ email: '', phone_end: '678' }) === 'ending 678');
  POSTS = []; ASKED = []; ANSWERS = [true, true];
  var done = await VPLogins.afterArchive(BAR, "Sarah's Test Bar");
  check('after an archive: asked about the removable login only (not the one on another venue), then its own confirm, then one removal',
    ASKED.length === 2 && /Sarah's Test Bar is archived\. Its login Sarah@gflam\.com\.au belongs to no other venue/.test(ASKED[0]) && /Remove the login Sarah@gflam\.com\.au\?/.test(ASKED[1]) &&
    POSTS.filter(function (p) { return p[0] === '/admin/login-remove'; }).length === 1 && done.length === 1, { asked: ASKED, posts: POSTS });
  POSTS = []; ASKED = []; ANSWERS = [false];
  await VPLogins.afterArchive(BAR, "Sarah's Test Bar");
  check('after an archive, No to "also remove": nothing is removed', ASKED.length === 1 && !POSTS.some(function (p) { return p[0] === '/admin/login-remove'; }), POSTS);
  POSTS = []; ASKED = []; OWNER = false;
  await VPLogins.afterArchive(BAR, "Sarah's Test Bar");
  OWNER = true;
  check('after an archive by anyone but an Owner: not even asked', ASKED.length === 0 && POSTS.length === 0, POSTS);
  var hq = readFile('venueplay/app/hq.html').replace(/<!--[\s\S]*?-->/g, '');
  check('hq.html loads vp-logins-hq.js with a real tag, starts it with its own sign-in, and offers it after an archive and in a venue\'s Details',
    hq.indexOf('<script src="vp-logins-hq.js"></script>') !== -1 && /VPLogins\.init\(\{ post:workerPost, ask:vpAsk, tell:vpTell/.test(hq) &&
    /function archiveVenue[\s\S]{0,1600}VPLogins\.afterArchive\(id, name\)/.test(hq) && /data-vplogins="'\+esc\(v\.id\)\+'"/.test(hq) && /id="rlFind"/.test(hq));
  var words = readFile('venueplay/app/vp-logins-hq.js') + hq.slice(hq.indexOf('Remove a login'), hq.indexOf('Remove a login') + 900);
  check('no em or en dash, no "roster"', !/[\u2014\u2013]/.test(words) && !/roster/i.test(words));

  print('');
  print(fails ? 'FAILED: ' + fails + ' of ' + ran + ' checks failed' : 'ALL ' + ran + ' CHECKS PASSED');
})().catch(function (e) { fails++; print('  FAIL the suite threw: ' + (e && e.stack || e)); print('FAILED: threw'); });
