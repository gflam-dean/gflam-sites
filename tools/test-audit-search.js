/* HQ's Audit search, Billing health and "Invite them back": RUN, not read.

   Dean, 21 Oct 2026: the Audit tab becomes a search (venue, dates, what changed, who did it, newest
   first, paged on the server, plain sentences); every billing line names its venue and repeats fold
   into one line; a contacted cancellation gets a way back that charges nobody.

   Runs the REAL billing Worker on tools/rig-billing-worker.js:
     /admin/audit-search    owner/accounts only; each filter narrows on the DATABASE (the rig answers
                            the same and=(...) logic PostgREST does); pages by cursor with no entry
                            lost or repeated across 300 rows, ties on the same instant included;
                            sentences name the venue, never a Stripe id or JSON; the categories do
                            not overlap; database-side screen changes (migration 114) appear, and
                            the search still works before 114
     /admin/billing-health  three declines of one Stripe customer fold into ONE line naming the venue
                            and its account; paid-since is said; a venue in a group names the group
     /admin/invite-back     emails the account contact a link to Keep this venue; changes no venue
                            row, calls no Stripe; refuses a venue that is not leaving, a grouped one,
                            and anyone but owner/accounts

   Run from the repo root:  jsc tools/test-audit-search.js
*/
load('tools/rig-billing-worker.js');
var fails = 0, ran = 0, finished = false;
function check(name, ok, saw) { ran++; if (ok) print('  ok   ' + name); else { print('  FAIL ' + name + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw).slice(0, 500))); fails++; } }
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
var URL = function (u) { var m = /^(https?:\/\/[^\/?#]+)([^?#]*)(\?[^#]*)?/.exec(String(u)); this.origin = m[1]; this.pathname = m[2] || '/'; var q = (m[3] || '').slice(1);
  this.searchParams = { get: function (k) { var hit = q.split('&').map(function (kv) { var i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }).filter(function (kv) { return decodeURIComponent(kv[0]) === k; })[0]; return hit ? decodeURIComponent(hit[1] || '') : null; } }; };
if (typeof btoa === 'undefined') { btoa = function (s) { var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = ''; for (var i = 0; i < s.length; i += 3) { var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2), n = (a << 16) | ((b || 0) << 8) | (c || 0); o += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (isNaN(b) ? '=' : A[(n >> 6) & 63]) + (isNaN(c) ? '=' : A[n & 63]); } return o; }; }
var STRIPE_CALLS = 0, rigFetch = globalThis.fetch, NO_HISTORY = false;
globalThis.fetch = function (url, opts) {
  var u = String(url);
  if (u.indexOf('api.stripe.com') !== -1) STRIPE_CALLS++;
  if (NO_HISTORY && /vp_venue_screen_history/.test(u)) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{"code":"PGRST205"}'); } });
  return rigFetch(url, opts);
};

function U(n) { return 'b0000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return 'c0000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var DEAN = U(1), ACC = U(2), STAFF = U(3), OWNER = U(4);
var TUG = V(1), ROY = V(2), LEAVE = V(3), KIRRA = V(4), ENDED = V(5), ARCH = V(6);
var NOW = Date.UTC(2026, 9, 21, 2, 0, 0);
function ago(days, min) { return new Date(NOW - days * 86400000 - (min || 0) * 60000).toISOString(); }
var ID = 0;
function row(action, days, target, who, admin, detail, min) { ID++; return { id: 'r' + ('0000' + ID).slice(-5), created_at: ago(days, min), action: action, target: target || null, actor_label: who === undefined ? 'system' : who, actor_admin: admin || null, detail: detail || {} }; }
function world() {
  DB = {}; FAIL = {}; sent.length = 0; STRIPE_CALLS = 0; NO_HISTORY = false; ID = 0;
  DB.vp_platform_admins = [{ auth_user_id: DEAN, label: 'Dean', role: 'owner' }, { auth_user_id: ACC, label: 'Sam', role: 'accounts' }, { auth_user_id: STAFF, label: 'Pat', role: 'staff' }];
  DB.vp_venue_groups = [{ id: 'g1', name: 'Coastline Hotels' }];
  DB.venueplay_founding = [{ id: 'f1', venue_name: 'Tugun Bowls Club', stripe_customer_id: 'cus_T', contact_email: 'tugun@example.com', contact_name: 'Terry Tugun' },
                           { id: 'f2', venue_name: 'The Royal Arms', stripe_customer_id: 'cus_R', contact_email: 'royal@example.com' },
                           { id: 'f3', venue_name: 'Leaving Lounge', stripe_customer_id: 'cus_L', contact_email: 'leave@example.com', contact_name: 'Lee' },
                           { id: 'f5', venue_name: 'Ended Bowls', stripe_customer_id: 'cus_E', contact_email: null }];
  DB.vp_venues = [{ id: TUG, name: 'Tugun Bowls Club', founding_id: 'f1', group_id: null, status: 'active', cancel_at_period_end: false },
                  { id: ROY, name: 'The Royal Arms', founding_id: 'f2', group_id: null, status: 'active', cancel_at_period_end: false },
                  { id: LEAVE, name: 'Leaving Lounge', founding_id: 'f3', group_id: null, status: 'active', cancel_at_period_end: true },
                  { id: KIRRA, name: 'Coastline Kirra', founding_id: null, group_id: 'g1', status: 'active', cancel_at_period_end: true },
                  { id: ENDED, name: 'Ended Bowls', founding_id: 'f5', group_id: null, status: 'suspended', suspended_reason: 'ended', cancel_at_period_end: true }];
  DB.vp_venue_staff = [{ auth_user_id: OWNER, venue_id: TUG, role: 'owner' }];
  DB.vp_venue_screen_history = [];
  DB.vp_admin_audit = [
    row('payment_failed_email', 1, 'customer:cus_T', 'stripe', null, { what: 'your VenuePlay subscription', amount: '$264.00', reason_line: 'The bank declined it without giving a reason.' }),
    row('payment_failed_email', 4, 'customer:cus_T', 'stripe', null, { what: 'your VenuePlay subscription', amount: '$264.00', reason_line: 'The bank declined it without giving a reason.' }),
    row('payment_failed_email', 9, 'customer:cus_T', 'stripe', null, { what: 'your VenuePlay subscription', amount: '$264.00', reason_line: 'Insufficient funds.' }),
    row('payment_failed_email', 6, 'customer:cus_R', 'stripe', null, { what: 'The Royal Arms - Extra Player - 12/10/2026', amount: '$4.00' }),
    row('invoice_receipt_email', 2, 'customer:cus_R', 'stripe', null, { outcome: 'sent' }),
    row('overage_charged', 3, 'venue:' + KIRRA, 'system', null, { amount_cents: 1200 }),
    row('logo_set', 2, 'venue:' + TUG, 'owner', null, { before: { logo_url: null, slides: 2 }, after: { logo_url: 'x', slides: 2 } }),
    row('discount_applied', 3, 'venue:' + ROY, 'Dean', DEAN, { kind: 'percent', value: 20, months: 3 }),
    row('venue_cancel_scheduled', 12, 'venue:' + LEAVE, 'owner', null, { reason_label: 'It costs too much', ends: '30 Oct 2026' }),
    row('screen_command', 1, 'venue:' + TUG, 'Dean', null, {}),                // an HQ admin the game Worker records by label only
    row('auto_archive_run', 5, null, 'automatic (30-day archive)', null, { archived: 1 }),
    row('paper_printed', 5, 'venue:' + ROY, null, null, {}),                  // no label at all: automatic
    row('some_new_thing', 2, 'venue:' + ROY, 'Dean', DEAN, { z: 1 }),        // an action nobody wrote a sentence for
  ];
}
function req(user, path, body) {
  var txt = JSON.stringify(body || {});
  return { url: 'https://api' + path, method: body ? 'POST' : 'GET', headers: { get: function (k) { return k === 'Authorization' && user ? 'Bearer ' + user : ''; } },
           text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } };
}
function search(user, qs) { return vpaHandleAuditSearch(req(user, '/admin/audit-search?' + (qs || '')), ENV, J); }
function keys(r) { return (r.body.rows || []).map(function (x) { return x.raw && x.raw.action; }); }
function enc(s) { return encodeURIComponent(s); }

(async function () {
  print('who may search');
  world();
  var r = await search(STAFF, '');
  check('a staff admin is refused', r.status === 403, r);
  r = await search(OWNER, '');
  check('a venue owner is refused', r.status === 403, r);
  r = await search('', '');
  check('nobody is refused', r.status === 401, r);
  r = await search(ACC, '');
  check('an accounts admin may', r.status === 200 && r.body.rows.length === 13, r.body);

  print('newest first, in sentences, with the venue named');
  r = await search(DEAN, '');
  var rows = r.body.rows;
  check('newest first', rows.every(function (x, i) { return i === 0 || Date.parse(rows[i - 1].at) >= Date.parse(x.at); }), rows.map(function (x) { return x.at; }));
  var decl = rows.filter(function (x) { return x.raw.action === 'payment_failed_email' && x.raw.target === 'customer:cus_T'; })[0];
  check('a declined subscription names the venue, not the Stripe customer', /Tugun Bowls Club/.test(decl.sentence) && decl.sentence.indexOf('cus_') === -1 && /declined/.test(decl.sentence), decl.sentence);
  check('...and is filed under Billing, by Automatic (Stripe)', decl.kind === 'billing' && decl.who === 'Automatic (Stripe)' && decl.who_kind === 'system', decl);
  var kir = rows.filter(function (x) { return x.raw.action === 'overage_charged'; })[0];
  check('a grouped venue is named with its group', /Coastline Kirra \(Coastline Hotels\)/.test(kir.sentence), kir.sentence);
  var odd = rows.filter(function (x) { return x.raw.action === 'some_new_thing'; })[0];
  check('an action with no sentence of its own reads as words, never JSON', odd.sentence === 'Some new thing: The Royal Arms.' && odd.kind === 'other', odd);
  check('no sentence anywhere carries JSON or an id', rows.every(function (x) { return !/[{}]|[0-9a-f]{8}-[0-9a-f]{4}/.test(x.sentence); }), rows.map(function (x) { return x.sentence; }));
  check('the raw row comes too, for the page\'s details', rows.every(function (x) { return x.raw && x.raw.action; }));

  print('each filter narrows on the database');
  r = await search(DEAN, 'venue=' + TUG);
  check('venue: only rows about Tugun (the declines are account rows, so the venue filter is exact)', r.body.rows.length === 2 && r.body.rows.every(function (x) { return x.venue_id === TUG; }), keys(r));
  r = await search(DEAN, 'kind=billing');
  check('kind billing: the six money rows and the discount, nothing else', r.body.rows.length === 7 && r.body.rows.every(function (x) { return x.kind === 'billing'; }), keys(r));
  r = await search(DEAN, 'kind=screen');
  check('kind screen: the logo and the screen command', JSON.stringify(keys(r).sort()) === '["logo_set","screen_command"]', keys(r));
  r = await search(DEAN, 'kind=other');
  check('kind other: only what no category claims', JSON.stringify(keys(r)) === '["some_new_thing"]', keys(r));
  r = await search(DEAN, 'who=hq');
  check('who hq: Dean, including the row the game Worker wrote with his label only', JSON.stringify(keys(r).sort()) === '["discount_applied","screen_command","some_new_thing"]', keys(r));
  r = await search(DEAN, 'who=venue');
  check('who venue: the venue logins', JSON.stringify(keys(r).sort()) === '["logo_set","venue_cancel_scheduled"]', keys(r));
  r = await search(DEAN, 'who=system');
  check('who automatic: Stripe, the nightly job, and a row with no label', keys(r).length === 8 && keys(r).indexOf('auto_archive_run') !== -1 && keys(r).indexOf('paper_printed') !== -1, keys(r));
  r = await search(DEAN, 'from=' + enc(ago(4.5)) + '&to=' + enc(ago(1.5)));
  check('dates: only what happened between them', r.body.rows.length > 0 && r.body.rows.every(function (x) { var t = Date.parse(x.at); return t >= Date.parse(ago(4.5)) && t < Date.parse(ago(1.5)); }) &&
    keys(r).indexOf('payment_failed_email') !== -1, keys(r));
  r = await search(DEAN, 'kind=billing&who=hq');
  check('two filters together: billing AND by HQ is the discount alone', r.status === 200 && JSON.stringify(keys(r)) === '["discount_applied"]', keys(r));
  r = await search(DEAN, 'kind=nonsense');
  check('a made-up kind is refused, not ignored', r.status === 400, r);
  r = await search(DEAN, 'venue=nope');
  check('a venue that is not an id is refused', r.status === 400, r);

  print('the categories do not overlap');
  var clash = [];
  vpaAuditKinds().forEach(function (a) { vpaAuditKinds().forEach(function (b) { if (a === b) return;
    a.prefixes.forEach(function (p) { b.prefixes.forEach(function (q) { if (p.indexOf(q) === 0 || q.indexOf(p) === 0) clash.push(a.key + ':' + p + ' / ' + b.key + ':' + q); }); }); }); });
  check('no action can be in two categories', clash.length === 0, clash);

  print('paging, by cursor, on the server');
  world();
  for (var i = 0; i < 300; i++) DB.vp_admin_audit.push(row('players_increased', 20 + Math.floor(i / 4) * 0.01, 'venue:' + ROY, 'owner', null, { from: i, to: i + 1 }, 0));
  // Ten rows on the SAME instant, straddling a page edge.
  var tie = ago(30);
  for (var t = 0; t < 10; t++) { var tr = row('venue_code_refreshed', 0, 'venue:' + ROY); tr.created_at = tie; DB.vp_admin_audit.push(tr); }
  var all = DB.vp_admin_audit.length, seen = {}, pages = 0, dup = 0, cursor = '', order = true, lastT = Infinity;
  do {
    r = await search(DEAN, 'size=50' + (cursor ? '&before=' + cursor : ''));
    pages++;
    r.body.rows.forEach(function (x) { if (seen[x.key]) dup++; seen[x.key] = 1; var tt = Date.parse(x.at); if (tt > lastT) order = false; lastT = tt; });
    cursor = r.body.next;
  } while (cursor && pages < 20);
  check('every one of ' + all + ' rows comes back exactly once, across pages of 50', Object.keys(seen).length === all && dup === 0, [Object.keys(seen).length, all, dup]);
  check('in ' + Math.ceil(all / 50) + ' pages, and the last says there are no more', pages === Math.ceil(all / 50) && !cursor, pages);
  check('newest first across every page', order);
  r = await search(DEAN, 'size=50');
  check('a page is the size asked for', r.body.rows.length === 50, r.body.rows.length);
  r = await search(DEAN, 'before=garbage');
  check('a broken page link says to start again', r.status === 400, r);

  print('screen settings changed outside VenuePlay are in the record');
  world();
  DB.vp_venue_screen_history = [
    { id: 7, venue_id: TUG, slug: 'tugun-bowls', op: 'delete', old_row: { logo_url: 'x', slides: [{ image_url: 'y' }] }, new_row: null, changed_at: ago(0.5), via: 'direct', db_session_user: 'postgres' },
    { id: 8, venue_id: TUG, slug: 'tugun-bowls', op: 'update', old_row: {}, new_row: { slides: [] }, changed_at: ago(0.6), via: 'venue', actor: { label: 'owner' } },
  ];
  r = await search(DEAN, '');
  var h = r.body.rows[0];
  check('a direct delete is the newest entry, marked outside VenuePlay, naming Tugun', h.screen_history === true && h.who_kind === 'outside' && /DELETED/.test(h.sentence) && /Tugun/.test(h.sentence), h);
  check('a change made through the Worker is not repeated from the history (its audit row stands for it)', r.body.rows.filter(function (x) { return x.screen_history; }).length === 1);
  r = await search(DEAN, 'who=outside');
  check('who outside: only the database-side change', r.body.rows.length === 1 && r.body.rows[0].screen_history, keys(r));
  r = await search(DEAN, 'kind=billing');
  check('a billing search does not bring screen history in', r.body.rows.every(function (x) { return !x.screen_history; }));
  NO_HISTORY = true;
  r = await search(DEAN, '');
  check('before migration 114 the search still answers', r.status === 200 && r.body.rows.length === 13, r);

  print('billing health: one line per venue, named');
  world();
  var b = await vpaHandleBillingHealth(req(DEAN, '/admin/billing-health'), ENV, J);
  var lines = b.body.lines || [];
  var tug = lines.filter(function (l) { return l.venue === 'Tugun Bowls Club'; });
  check('three declines of the same card are ONE line, naming Tugun Bowls Club', tug.length === 1 && tug[0].failures === 3, lines);
  check('...still failing, with the bank\'s words, the last attempt and the amount', tug[0].state === 'bad' && /declined/i.test(tug[0].status) && /without giving a reason/.test(tug[0].status) &&
    tug[0].last_attempt === ago(1) && tug[0].last_amount === '$264.00', tug[0]);
  check('...with the history underneath, newest first', tug[0].history.length === 3 && tug[0].history[0].at === ago(1), tug[0].history);
  var roy = lines.filter(function (l) { return l.venue === 'The Royal Arms'; })[0];
  check('a venue that paid after its decline says paid since', roy && roy.state === 'recovered' && /Paid since/.test(roy.status), roy);
  var kir2 = lines.filter(function (l) { return l.venue === 'Coastline Kirra'; })[0];
  check('a grouped venue\'s line names its group, and is fine', kir2 && kir2.group === 'Coastline Hotels' && kir2.state === 'ok', kir2);
  check('the ones that need a look come first', lines[0].state === 'bad', lines.map(function (l) { return l.state; }));
  check('no line is named by a Stripe id', lines.every(function (l) { return String(l.venue).indexOf('cus_') === -1; }), lines);
  b = await vpaHandleBillingHealth(req(STAFF, '/admin/billing-health'), ENV, J);
  check('a staff admin is refused', b.status === 403, b);

  print('invite them back: an email, never a charge');
  world();
  var before = JSON.stringify(DB.vp_venues);
  var iv = await vpaHandleInviteBack(req(STAFF, '/admin/invite-back', { venue_id: LEAVE }), ENV, J);
  check('a staff admin is refused', iv.status === 403 && sent.length === 0, iv);
  iv = await vpaHandleInviteBack(req(DEAN, '/admin/invite-back', { venue_id: LEAVE }), ENV, J);
  check('Dean invites Leaving Lounge back: one email, to the account contact', iv.status === 200 && sent.length === 1 && sent[0].to[0] === 'leave@example.com', [iv, sent]);
  check('...which links to their own account page and says nothing is charged unless they tap Keep this venue',
    /\/app\/billing\.html/.test(sent[0].html) && /Keep this venue/.test(sent[0].html) && /nothing is charged unless you do/.test(sent[0].html), sent[0] && sent[0].html);
  check('...and changes no venue and never calls Stripe', JSON.stringify(DB.vp_venues) === before && STRIPE_CALLS === 0, STRIPE_CALLS);
  var au = DB.vp_admin_audit.filter(function (a) { return a.action === 'venue_invited_back'; });
  check('...and is in the audit, by Dean, with where it went', au.length === 1 && au[0].actor_label === 'Dean' && au[0].detail.to === 'leave@example.com', au);
  iv = await vpaHandleInviteBack(req(DEAN, '/admin/invite-back', { venue_id: TUG }), ENV, J);
  check('a venue that is not leaving is refused', iv.status === 409 && sent.length === 1, iv);
  iv = await vpaHandleInviteBack(req(DEAN, '/admin/invite-back', { venue_id: KIRRA }), ENV, J);
  check('a grouped venue is refused (no card of theirs)', iv.status === 409 && /group/.test(iv.body.error), iv);
  iv = await vpaHandleInviteBack(req(DEAN, '/admin/invite-back', { venue_id: ENDED }), ENV, J);
  check('an account with no contact email says ring them', iv.status === 409 && /Ring them/.test(iv.body.error), iv);

  print('the routes are reachable');
  var src = readFile('venueplay-backend/worker/venueplay-api-FULL.js');
  ["'GET'  && path === '/admin/audit-search'", "'GET'  && path === '/admin/billing-health'", "'POST' && path === '/admin/invite-back'"].forEach(function (s) {
    check('the dispatcher has ' + s.replace(/[' &=]+/g, ' ').trim(), src.indexOf(s) !== -1);
  });
  finished = true;
})().catch(function (e) { fails++; print('  FAIL threw: ' + (e && e.stack || e)); });
drainMicrotasks();
if (!finished) { fails++; print('  FAIL the suite did not finish'); }
print('');
print(fails ? (fails + ' FAILED, ' + ran + ' run') : ('ALL ' + ran + ' CHECKS PASSED'));
