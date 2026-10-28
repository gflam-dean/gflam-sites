/* TWO LEGAL GAPS FROM THE COMPLIANCE MATRIX OF 28 OCT 2026, RUN, NOT WORD-SEARCHED.

   Gap 10 (G19): a venue with no state. Rules "for that jurisdiction and venue" (Anisimoff Legal 9380,
   1 Oct 2026, point 5) cannot be shown without a state, yet two venues sat with no state and paid
   entry ON. Now:
     vp-gaming.js assess()           a PAID game at a venue with no known state is hard-blocked to free
                                     entry, as every other "may not charge" is; free stays open; musical
                                     bingo is not bingo and is untouched
     billing Worker /admin/venue-gaming   clearing the postcode switches paid entry off (it only did so
                                     for a NEW state before), and paid entry still cannot go on without one
     hq.html                         a "Needs a state" filter that finds every such venue, and a badge
   The game Worker never knows whether a game is paid (the paid lock lives in the console, matrix V5),
   so there is nothing there to refuse: the console block and the HQ switch are the two places.

   Gap 8 (V3): "prudent to verify VIC permit numbers before providing the platform" (8 Oct 2026, point
   1(a) and point 4). HQ ticks that a person checked a recorded Victorian permit against the VGCCC
   register, and the record says who and when. No automation.
     billing Worker /admin/permit-register-check and /admin/venue-compliance
     hq.html registerChecksHtml

   Run from the repo root:  jsc tools/test-legal-gaps-28-oct.js */
var ran = 0, bad = 0;
function check(n, c, saw) { ran++; if (c) print('  ok   ' + n); else { bad++; print('  FAIL ' + n + (saw !== undefined ? '   saw: ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 300) : '')); } }
function section(t) { print(''); print(t); }

/* ---------------- 1. assess() at a venue with no state ---------------- */
var window = this; window.document = undefined;
load('venueplay/app/vp-gaming.js');
var G = this.VPGaming;
function txt(a) { return [a.headline].concat(a.points, a.warnings).join(' | '); }
section('1. A paid game at a venue with no known state starts as free entry only');
['bingo', 'raffle', 'members'].forEach(function (f) {
  var a = G.assess({ state: null, entityType: 'non_profit', format: f, paidEntry: true, paidEntryEnabled: true });
  check('paid ' + f + ', no state, a club with paid entry ON: hard-blocked to free entry', a.hardBlock === true && a.ok === false, a);
  check('paid ' + f + ', no state: it says why, in words', /Until we know which state this venue is in, games here start as free entry only\./.test(txt(a)), txt(a));
});
var free0 = G.assess({ state: null, entityType: 'non_profit', format: 'bingo', paidEntry: false, paidEntryEnabled: true });
check('a FREE game with no state is never blocked (free entry is lawful everywhere)', free0.hardBlock === false && free0.ok === true, free0);
check('and it still asks for the postcode', /Add this venue’s postcode/.test(txt(free0)), txt(free0));
var mus0 = G.assess({ state: null, entityType: 'non_profit', format: 'musical', paidEntry: true, paidEntryEnabled: true });
check('musical bingo is not bingo: a paid musical night with no state is not blocked by the state rule', mus0.hardBlock === false, mus0);
var nsw = G.assess({ state: 'NSW', entityType: 'non_profit', format: 'raffle', paidEntry: true, paidEntryEnabled: true, permits: {} });
check('a club WITH a state is not hit by the no-state block', !/Until we know which state/.test(txt(nsw)), txt(nsw));

/* ---------------- 2. HQ: the "Needs a state" filter and badge ---------------- */
function lift(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name + ': a test that cannot find its subject cannot fail');
  var d = 0, k = src.indexOf('{', i);
  do { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; } while (d > 0 && k < src.length);
  return src.slice(i, k);
}
var HQ = readFile('venueplay/app/hq.html');
var hqEsc = (new Function('return (' + lift(HQ, 'esc') + ');'))();
var S = { vFilter: 'all', vSearch: '', showLeft: false, live: {} };
var hqFns = (new Function('S', 'esc', 'isArchived', 'hasLeft', 'hideAsTest', 'isTest', 'isCancelling',
  lift(HQ, 'needsState') + '\n' + lift(HQ, 'needsStateBadge') + '\n' + lift(HQ, 'venuePasses') +
  '\nreturn { needsState: needsState, needsStateBadge: needsStateBadge, venuePasses: venuePasses };'))(
  S, hqEsc, function (v) { return v.suspended_reason === 'archived'; }, function (v) { return v.status === 'ended' || v.suspended_reason === 'archived'; },
  function (v) { return !!v.test; }, function (v) { return !!v.test; }, function () { return false; });
var VENUES = [
  { id: 'a', name: 'The Anchor Hotel', slug: 'anchor', status: 'suspended', au_state: null, paid_entry_enabled: true },
  { id: 'b', name: 'Riverside Bowls Club', slug: 'riverside', status: 'suspended', au_state: '', paid_entry_enabled: true },
  { id: 'c', name: 'Tugun Bowls Club', slug: 'tugun', status: 'active', au_state: 'QLD', paid_entry_enabled: false },
  { id: 'd', name: 'Old Test Pub', slug: 'oldtest', status: 'ended', au_state: null, test: true, paid_entry_enabled: false },
  { id: 'e', name: 'Quiet Inn', slug: 'quiet', status: 'active', au_state: null, paid_entry_enabled: false }
];
section('2. HQ finds every venue that needs a state');
check('the venue filter offers "Needs a state"', /<option value="needsstate">Needs a state<\/option>/.test(HQ));
S.vFilter = 'needsstate';
var hit = VENUES.filter(function (v) { return hqFns.venuePasses(v); }).map(function (v) { return v.id; }).join(',');
check('it lists every venue with no state, suspended, ended or test included, and none with one', hit === 'a,b,d,e', hit);
S.vSearch = 'river';
hit = VENUES.filter(function (v) { return hqFns.venuePasses(v); }).map(function (v) { return v.id; }).join(',');
check('the search box still narrows it', hit === 'b', hit);
S.vSearch = ''; S.vFilter = 'all';
hit = VENUES.filter(function (v) { return hqFns.venuePasses(v); }).map(function (v) { return v.id; }).join(',');
check('"All venues" is unchanged by it (ended and test venues still hidden there)', hit === 'a,b,c,e', hit);
var bA = hqFns.needsStateBadge(VENUES[0]), bE = hqFns.needsStateBadge(VENUES[4]), bC = hqFns.needsStateBadge(VENUES[2]);
check('a no-state row carries a "Needs a state" badge', />Needs a state</.test(bA) && />Needs a state</.test(bE), bA);
check('and a second badge when paid entry is still ON there', />Paid entry ON</.test(bA) && !/Paid entry ON/.test(bE), bA);
check('a venue with a state carries neither', bC === '', bC);
check('the badge is painted on the row', /var statusCell = stateBadgeFor\(v\) \+ needsStateBadge\(v\);/.test(HQ));

/* ---------------- 3. HQ: the VGCCC register tick ---------------- */
section('3. HQ shows the VGCCC register check beside a recorded Victorian permit');
var reg = (new Function('esc', 'fmtWhen', lift(HQ, 'registerChecksHtml') + '\nreturn registerChecksHtml;'))(hqEsc, function (t) { return 'WHEN(' + t + ')'; });
var vicNone = reg('V', { venue: { au_state: 'VIC' }, recorded: { bingo: true }, permits: { bingo: { number: 'MGP-123' } }, register_checks: {} });
check('a recorded VIC bingo permit, never checked: "not checked" and a tick box for it', /bingo number MGP-123/.test(vicNone) && /not checked/.test(vicNone) &&
  /<input type="checkbox" data-regcheck="V" data-regkind="bingo"/.test(vicNone) && /I checked it against the VGCCC register/.test(vicNone), vicNone);
var vicDone = reg('V', { venue: { au_state: 'VIC' }, recorded: { bingo: true }, permits: { bingo: { number: 'MGP-123' } }, register_checks: { bingo: { at: '2026-10-28T03:00:00Z', by: 'Dean', number: 'MGP-123', current: true } } });
check('checked: who and when, and no box to tick again', /checked WHEN\(2026-10-28T03:00:00Z\) by Dean/.test(vicDone) && !/data-regcheck/.test(vicDone), vicDone);
var vicOld = reg('V', { venue: { au_state: 'VIC' }, recorded: { bingo: true }, permits: { bingo: { number: 'MGP-999' } }, register_checks: { bingo: { at: '2026-10-01T03:00:00Z', by: 'Dean', number: 'MGP-123', current: false } } });
check('a permit changed since the check reads as not checked, and offers the box again', /not checked since the permit changed/.test(vicOld) && /data-regcheck/.test(vicOld), vicOld);
check('a Victorian venue with nothing recorded is told there is nothing to check',
  /nothing to check/.test(reg('V', { venue: { au_state: 'VIC' }, recorded: {}, permits: {}, register_checks: {} })));
check('outside Victoria nothing is shown', reg('V', { venue: { au_state: 'NSW' }, recorded: { bingo: true }, permits: { bingo: { number: '1' } } }) === '');
check('a raffle run under a charity\'s authority is named by the charity', /raffle under Lions Club's authority/.test(
  reg('V', { venue: { au_state: 'VIC' }, recorded: { raffle: true }, permits: { raffle: { holder: 'npo', npo_name: 'Lions Club', authorised_on: '2026-10-01' } }, register_checks: {} })));
check('ticking the box posts it (the change handler on the venue rows)', /var rc=e\.target\.closest\("input\[data-regcheck\]"\);\s*if\(rc && rc\.checked\) markRegisterChecked\(rc\);/.test(HQ));
var mark = lift(HQ, 'markRegisterChecked'), posted = [];
(new Function('workerPost', 'document', 'loadCompliance', 'vpTell', mark + '\nreturn markRegisterChecked;'))(
  function (p, b) { posted.push({ p: p, b: b }); return Promise.resolve({ ok: true }); }, { querySelector: function () { return {}; } }, function () { posted.push('reload'); }, function () {})(
  { getAttribute: function (k) { return k === 'data-regcheck' ? 'V7' : 'bingo'; }, disabled: false, checked: true });
drainMicrotasks();
check('the box sends the venue and the kind to /admin/permit-register-check, then re-reads the card',
  posted.length === 2 && posted[0].p === '/admin/permit-register-check' && posted[0].b.venue_id === 'V7' && posted[0].b.kind === 'bingo' && posted[1] === 'reload', posted);

/* ---------------- 3b. PartyPlay's buy page: the private-use declaration (gap 6) ---------------- */
section('3b. PartyPlay /start asks for the private-use declaration and sends it (gap 6)');
var START = readFile('partyplay/start.html');
var startJs = (function () { var i = START.indexOf('<script>\n(function(){'); var j = START.indexOf('</script>', i); return i >= 0 ? START.slice(i + 8, j) : ''; })();
function PEl(id) { this.id = id; this.value = ''; this.checked = false; this.disabled = false; this.textContent = ''; this.h = {}; var cl = {}; this.cls = cl;
  this.classList = { add: function (c) { cl[c] = 1; }, remove: function (c) { delete cl[c]; } }; }
PEl.prototype.addEventListener = function (e, f) { (this.h[e] = this.h[e] || []).push(f); };
PEl.prototype.focus = function () {};
function startPage() {
  var els = {}; ['f', 'go', 'err', 'confirmText', 'name', 'email', 'mobile', 'party', 'optin', 'privateUse', 'privErr'].forEach(function (id) { els[id] = new PEl(id); });
  var radio = new PEl('d1'); radio.value = '1'; radio.checked = true;
  els.f.querySelector = function () { return radio; }; els.f.querySelectorAll = function () { return [radio]; };
  var posts = [];
  var doc = { getElementById: function (id) { return els[id] || null; } };
  var win = { addEventListener: function () {}, location: null };
  var fetchP = function (u, o) { posts.push({ url: u, body: JSON.parse(o.body) }); return new Promise(function () {}); };
  (new Function('document', 'window', 'fetch', 'PPConfig', 'PPLicence', startJs))(doc, win, fetchP, { API: 'https://pp-api' },
    { plan: function (d) { return { days: d, cents: d === 3 ? 12000 : 5000, label: d === 3 ? '3 days' : '24 hours' }; } });
  function submit() { (els.f.h.submit || []).forEach(function (fn) { fn({ preventDefault: function () {} }); }); }
  return { els: els, posts: posts, submit: submit };
}
check('the buy page carries the private-use tick, in the words the letters accepted',
  /<input type="checkbox" id="privateUse" required>/.test(START) &&
  /This is for a private party\. It is not for a pub, club, business, fundraiser or promotion, and nobody pays to play\./.test(START));
var SP = startPage();
SP.els.name.value = 'Nicole'; SP.els.email.value = 'n@example.com';
SP.submit();
check('unticked, the page sends nothing and says why, beside the tick', SP.posts.length === 0 && /private parties only/.test(SP.els.privErr.textContent) && SP.els.privErr.cls.show === 1, SP.els.privErr.textContent);
SP.els.privateUse.checked = true; SP.submit();
check('ticked, the checkout carries private_use:true', SP.posts.length === 1 && SP.posts[0].url === 'https://pp-api/checkout' && SP.posts[0].body.private_use === true, SP.posts);
check('and the message beside the tick is cleared', SP.els.privErr.textContent === '' && !SP.els.privErr.cls.show);

/* ---------------- 4. the billing Worker ---------------- */
load('tools/rig-billing-worker.js');
vpaVerifyJWT = async function (t) { return t ? { sub: t } : null; };
function U(n) { return '52000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
function V(n) { return '62000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
var ADMIN = U(9), STAFFADMIN = U(8), OWNER = U(1);
var VIC = V(1), NSWV = V(2), NOST = V(3);
function as(user, body) {
  var h = { Authorization: 'Bearer ' + user }, t = JSON.stringify(body || {});
  return { url: 'https://api/x', headers: { get: function (k) { return h[k] || ''; } }, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(JSON.parse(t)); } };
}
function get(user, url) { return { url: url, headers: { get: function (k) { return k === 'Authorization' ? 'Bearer ' + user : ''; } }, text: function () { return Promise.resolve(''); } }; }
function world() {
  DB = {}; sent.length = 0; FAIL = {};
  DB.vp_platform_admins = [{ auth_user_id: ADMIN, label: 'Dean', role: 'owner' }, { auth_user_id: STAFFADMIN, label: 'Helper', role: 'staff' }];
  DB.vp_venues = [{ id: VIC, name: 'The Melbourne Club', au_state: 'VIC', postcode: '3000', entity_type: 'non_profit', paid_entry_enabled: true, permits: { bingo: { number: 'MGP-123', holder: 'venue' } } },
                  { id: NSWV, name: 'Sydney Club', au_state: 'NSW', postcode: '2000', entity_type: 'non_profit', paid_entry_enabled: true, permits: { bingo: { number: 'N-1', holder: 'venue' } } },
                  { id: NOST, name: 'Riverside Bowls Club', au_state: null, postcode: null, entity_type: 'non_profit', paid_entry_enabled: true, permits: {} }];
  DB.vp_venue_staff = [{ id: 's1', auth_user_id: OWNER, venue_id: VIC, role: 'owner', permissions: null }];
  DB.vp_admin_audit = []; DB.vp_gaming_declarations = [];
}
function vrow(id) { return DB.vp_venues.filter(function (v) { return v.id === id; })[0] || {}; }
function checks() { return DB.vp_admin_audit.filter(function (a) { return a.action === 'permit_register_checked'; }); }

(async function () {
  section('4. The billing Worker records a register check, Victoria only, HQ only');
  world();
  var r = await vpaHandlePermitRegisterCheck(as(OWNER, { venue_id: VIC, kind: 'bingo' }), ENV, J);
  check('the venue\'s own owner cannot mark its permit checked', r.status === 403 && checks().length === 0, r);
  r = await vpaHandlePermitRegisterCheck(as(STAFFADMIN, { venue_id: VIC, kind: 'bingo' }), ENV, J);
  check('an HQ staff login cannot either: owner and accounts only', r.status === 403 && checks().length === 0, r);
  r = await vpaHandlePermitRegisterCheck(as(ADMIN, { venue_id: VIC, kind: 'pokies' }), ENV, J);
  check('a kind that is not bingo, raffle or members is refused', r.status === 400 && checks().length === 0, r);
  r = await vpaHandlePermitRegisterCheck(as(ADMIN, { venue_id: NSWV, kind: 'bingo' }), ENV, J);
  check('a permit outside Victoria is refused: the VGCCC register is Victoria\'s', r.status === 409 && /Victorian/.test(r.body.error) && checks().length === 0, r);
  r = await vpaHandlePermitRegisterCheck(as(ADMIN, { venue_id: VIC, kind: 'raffle' }), ENV, J);
  check('a kind with nothing recorded is refused: nothing to check', r.status === 409 && /nothing to check/.test(r.body.error) && checks().length === 0, r);
  r = await vpaHandlePermitRegisterCheck(as(ADMIN, { venue_id: VIC, kind: 'bingo' }), ENV, J);
  var a0 = checks()[0] || { detail: {} };
  check('HQ marks the recorded VIC bingo permit checked: ok, by whom', r.status === 200 && r.body.ok === true && r.body.check.by === 'Dean' && r.body.check.number === 'MGP-123', r.body);
  check('the record is an audit row naming who, the venue, the register and the number checked',
    checks().length === 1 && a0.actor_admin === ADMIN && a0.actor_label === 'Dean' && a0.target === 'venue:' + VIC &&
    a0.detail.kind === 'bingo' && a0.detail.register === 'VGCCC' && a0.detail.number === 'MGP-123' && !!a0.created_at, a0);
  check('nothing on the venue row moved (the venue can write that row; it cannot write the audit)', JSON.stringify(vrow(VIC).permits) === JSON.stringify({ bingo: { number: 'MGP-123', holder: 'venue' } }));
  r = await vpaHandleVenueCompliance(get(ADMIN, 'https://api/x?venue_id=' + VIC), ENV, J);
  var rc = (r.body.register_checks || {}).bingo || {};
  check('HQ\'s compliance read says checked, when and by whom, and that it is the permit on record', rc.current === true && rc.by === 'Dean' && rc.number === 'MGP-123' && !!rc.at, r.body.register_checks);
  vrow(VIC).permits = { bingo: { number: 'MGP-999', holder: 'venue' } };
  r = await vpaHandleVenueCompliance(get(ADMIN, 'https://api/x?venue_id=' + VIC), ENV, J);
  check('the venue records a different number: the old check no longer counts', (r.body.register_checks || {}).bingo && r.body.register_checks.bingo.current === false, r.body.register_checks);
  r = await vpaHandleVenueCompliance(get(ADMIN, 'https://api/x?venue_id=' + NSWV), ENV, J);
  check('outside Victoria the read carries no register checks', r.status === 200 && JSON.stringify(r.body.register_checks) === '{}', r.body.register_checks);
  check('the route is wired as an HQ POST', /path === '\/admin\/permit-register-check' && typeof vpaHandlePermitRegisterCheck === 'function'\) return await vpaHandlePermitRegisterCheck\(request, env, json\)/.test(readFile('venueplay-backend/worker/venueplay-api-FULL.js')));

  section('5. The billing Worker never leaves paid entry ON at a venue with no state');
  world();
  r = await vpaHandleVenueGaming(as(ADMIN, { venue_id: VIC, postcode: '' }), ENV, J);
  check('clearing a venue\'s postcode clears its state AND switches paid entry off', r.status === 200 && vrow(VIC).au_state === null && vrow(VIC).paid_entry_enabled === false, vrow(VIC));
  world();
  r = await vpaHandleVenueGaming(as(ADMIN, { venue_id: NOST, paid_entry_enabled: true }), ENV, J);
  check('paid entry cannot be switched on for a venue with no state', r.status === 409 && /postcode/.test(r.body.error), r);
  world();
  r = await vpaHandleVenueGaming(as(ADMIN, { venue_id: NOST, postcode: '3000' }), ENV, J);
  check('setting a Victorian postcode on a no-state club keeps paid entry (Victoria allows a club to charge)', r.status === 200 && vrow(NOST).au_state === 'VIC' && vrow(NOST).paid_entry_enabled === true, vrow(NOST));
  world();
  r = await vpaHandleVenueGaming(as(ADMIN, { venue_id: NSWV, postcode: '2010' }), ENV, J);
  check('moving within a state that allows it leaves paid entry alone', r.status === 200 && vrow(NSWV).paid_entry_enabled === true, vrow(NSWV));

  if (bad) throw new Error('legal gaps 28 Oct: ' + bad + ' of ' + ran + ' failed');
  print('PASS ' + ran + ' checks');
})().catch(function (e) { print('  FAIL ' + (e && e.stack || e)); throw e; });
drainMicrotasks();
